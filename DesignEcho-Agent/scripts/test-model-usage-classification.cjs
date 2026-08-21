#!/usr/bin/env node
/**
 * 模型用途分类单元测试。
 *
 * 起因：OpenRouter 上 google/gemini-3-pro-image、openai/gpt-5-image 这类专用出图模型
 * 被判成了 conversation，进而出现在 Agent 主模型候选里。根因是图像分支曾要求
 * 「必须不能返回文本」，而 chat completions 形态的图像模型 output_modalities 是
 * ["image","text"]——出图的同时也回文字。
 *
 * 这里守两条对称的线，缺一不可：
 *   1. 出图模型（output 含 image）必须判为 image-generation，哪怕它同时出文字；
 *   2. 视觉对话模型（image 在 input、output 只有 text）必须仍是 conversation。
 * 只测第 1 条会让人放心地把第 2 条改坏。
 *
 * 运行方式：npm run test:model-usage-classification
 * 说明：无测试框架，自包含断言；require 的是 src/shared 下真实契约源，而非复制逻辑。
 */

const fs = require('fs');
const path = require('path');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const { classifyModelUsage } = require(
    path.resolve(__dirname, '..', 'src', 'shared', 'config', 'model-usage-classification.ts')
);
const {
    DEFAULT_MODEL_PREFERENCES,
    applyModelPreferencesPatch,
    normalizeModelPreferences
} = require(
    path.resolve(__dirname, '..', 'src', 'shared', 'config', 'models.config.ts')
);
const {
    getAgentWorkerModels,
    getModelPriorityForConversationTask,
    getModelRecoveryPriorityForConversationTask
} = require(
    path.resolve(__dirname, '..', 'src', 'shared', 'model-selection.ts')
);
const { buildMultimodalModelDispatchPlan } = require(
    path.resolve(__dirname, '..', 'src', 'shared', 'multimodal-model-dispatch.ts')
);
const { buildAllPrimaryModelOptionGroups } = require(
    path.resolve(__dirname, '..', 'src', 'shared', 'config', 'primary-model-options.ts')
);

let failures = 0;

function expectKind(label, input, expectedKind) {
    const result = classifyModelUsage(input);
    const actual = result?.kind;
    if (actual === expectedKind) {
        console.log(`  [通过] ${label} → ${actual}（依据 ${result?.confidence}）`);
    } else {
        failures += 1;
        console.log(`  [失败] ${label} → 期望 ${expectedKind}，实际 ${actual}`);
    }
}

function expectEqual(label, actual, expected) {
    const passed = JSON.stringify(actual) === JSON.stringify(expected);
    if (passed) {
        console.log(`  [通过] ${label}`);
        return;
    }
    failures += 1;
    console.log(`  [失败] ${label} → 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

console.log('=== 出图模型：output 含 image，同时也出文字 ===');
// 这是 OpenRouter 上所有 chat completions 形态图像模型的真实形状
expectKind(
    'google/gemini-3-pro-image（GA alias，同旗舰）',
    { apiModelId: 'google/gemini-3-pro-image', inputModalities: ['text', 'image'], outputModalities: ['image', 'text'] },
    'image-generation'
);

expectKind(
    'google/gemini-3-pro-image-preview（旗舰 4K 快照）',
    { apiModelId: 'google/gemini-3-pro-image-preview', inputModalities: ['text', 'image'], outputModalities: ['image', 'text'] },
    'image-generation'
);
expectKind(
    'openai/gpt-5-image',
    { apiModelId: 'openai/gpt-5-image', inputModalities: ['text', 'image'], outputModalities: ['image', 'text'] },
    'image-generation'
);
expectKind(
    'google/gemini-3.1-flash-lite-image（名字正则够不着，只能靠模态）',
    { apiModelId: 'google/gemini-3.1-flash-lite-image', inputModalities: ['text', 'image'], outputModalities: ['image', 'text'] },
    'image-generation'
);

console.log('\n=== 出图模型：output 只有 image ===');
expectKind(
    '纯文生图',
    { apiModelId: 'vendor/text2img', inputModalities: ['text'], outputModalities: ['image'] },
    'image-generation'
);

console.log('\n=== 反向不误伤：视觉对话模型必须仍是 conversation ===');
// image 在 input，不在 output——这是能看图的对话模型，不是出图模型
expectKind(
    '视觉对话模型（吃图、只出文字）',
    { apiModelId: 'anthropic/claude-x', inputModalities: ['text', 'image'], outputModalities: ['text'] },
    'conversation'
);
expectKind(
    '纯文本对话模型',
    { apiModelId: 'deepseek/deepseek-v4', inputModalities: ['text'], outputModalities: ['text'] },
    'conversation'
);

console.log('\n=== 其他用途不受影响 ===');
expectKind(
    'embedding',
    { apiModelId: 'vendor/text-embedding-3', supportedMethods: ['embed'], outputModalities: [] },
    'embedding'
);
expectKind(
    'reranking',
    { apiModelId: 'vendor/bge-reranker', supportedMethods: ['rerank'], outputModalities: [] },
    'reranking'
);
expectKind(
    '视频生成（仍要求不出文字）',
    { apiModelId: 'vendor/veo', inputModalities: ['text'], outputModalities: ['video'] },
    'video-generation'
);

console.log('\n=== provider 显式声明优先于模态推断 ===');
expectKind(
    'declaredKind=image 覆盖模态',
    { apiModelId: 'vendor/whatever', declaredKind: 'image', outputModalities: ['text'] },
    'image-generation'
);

console.log('\n=== 单一视觉多模态 Agent 模型迁移与路由 ===');
const knownVisionPrimary = normalizeModelPreferences({
    ...DEFAULT_MODEL_PREFERENCES,
    primaryModel: 'xiaomi-mimo-v2.5',
    visualModel: 'google-gemini-3-pro'
});
expectEqual('已知视觉 primary 优先', knownVisionPrimary.primaryModel, 'xiaomi-mimo-v2.5');
expectEqual('legacy visual 归一为同一镜像', knownVisionPrimary.visualModel, 'xiaomi-mimo-v2.5');

const knownLegacyVision = normalizeModelPreferences({
    ...DEFAULT_MODEL_PREFERENCES,
    primaryModel: 'xiaomi-mimo-v2.5-pro',
    visualModel: 'google-gemini-3-pro'
});
expectEqual('文本 primary 不覆盖已知视觉 legacy visual', knownLegacyVision.primaryModel, 'google-gemini-3-pro');

const coldSubscriptionModelId = 'codex-subscription-cold-start-vision-model';
const unknownLegacyVision = normalizeModelPreferences({
    ...DEFAULT_MODEL_PREFERENCES,
    primaryModel: 'xiaomi-mimo-v2.5-pro',
    visualModel: coldSubscriptionModelId
});
expectEqual('冷启动未知 legacy visual 保留身份', unknownLegacyVision.primaryModel, coldSubscriptionModelId);
expectEqual(
    '未知模型未获 supportsVision=true 前不能进入 Agent 路由',
    getModelPriorityForConversationTask(unknownLegacyVision, 'visual'),
    []
);

const unknownPrimaryModelId = 'future-primary-model-without-runtime-catalog';
const unknownVisualModelId = 'future-legacy-visual-without-runtime-catalog';
const bothUnknown = normalizeModelPreferences({
    ...DEFAULT_MODEL_PREFERENCES,
    primaryModel: unknownPrimaryModelId,
    visualModel: unknownVisualModelId
});
expectEqual('两个未知槽迁移时保留 canonical primary', bothUnknown.primaryModel, unknownPrimaryModelId);

const coldSubscriptionWithKnownLegacy = normalizeModelPreferences({
    ...DEFAULT_MODEL_PREFERENCES,
    primaryModel: 'codex-subscription-gpt-5-6-sol-cold-start',
    visualModel: 'google-gemini-3-pro'
});
expectEqual(
    '订阅模型目录冷启动时不被已知 legacy visual 静默覆盖',
    coldSubscriptionWithKnownLegacy.primaryModel,
    'codex-subscription-gpt-5-6-sol-cold-start'
);

const explicitKnownText = normalizeModelPreferences({
    ...DEFAULT_MODEL_PREFERENCES,
    primaryModel: 'xiaomi-mimo-v2.5-pro',
    visualModel: 'local-qwen2.5-14b'
});
expectEqual('显式已知文本模型不被迁移暗换', explicitKnownText.primaryModel, 'xiaomi-mimo-v2.5-pro');
expectEqual(
    '显式文本模型被运行时 fail closed',
    getModelPriorityForConversationTask(explicitKnownText, 'logic'),
    []
);

const patchedFromLegacy = applyModelPreferencesPatch(
    DEFAULT_MODEL_PREFERENCES,
    { visualModel: 'google-gemini-3-pro' }
);
expectEqual('legacy-only visual patch 不被 base.primaryModel 抢占', patchedFromLegacy.primaryModel, 'google-gemini-3-pro');
expectEqual('legacy-only patch 同步唯一模型镜像', patchedFromLegacy.visualModel, 'google-gemini-3-pro');

for (const taskType of ['general', 'logic', 'copywriting', 'visual']) {
    expectEqual(
        `${taskType} 任务都使用同一 Agent 模型`,
        getModelPriorityForConversationTask(patchedFromLegacy, taskType),
        ['google-gemini-3-pro']
    );
}
expectEqual(
    '恢复候选不再跨模型 fallback',
    getModelRecoveryPriorityForConversationTask(patchedFromLegacy, 'visual'),
    ['google-gemini-3-pro']
);

const workers = getAgentWorkerModels(patchedFromLegacy, {
    mode: patchedFromLegacy.mode,
    includeFallback: true
});
expectEqual('兼容 worker 槽严格共用同一模型', workers, {
    vision: 'google-gemini-3-pro',
    copy: 'google-gemini-3-pro',
    logic: 'google-gemini-3-pro'
});

const fallbackEnabled = normalizeModelPreferences({
    ...patchedFromLegacy,
    autoFallback: true
});
expectEqual('历史 autoFallback=true 归一为真实单模型状态', fallbackEnabled.autoFallback, false);
expectEqual(
    '请求 fallback 时仍只有唯一 Agent 模型',
    getModelPriorityForConversationTask(fallbackEnabled, 'visual', { includeFallback: true }),
    ['google-gemini-3-pro']
);

const teammateRoles = [
    'scene-analyst',
    'market-researcher',
    'copywriter',
    'design-strategist',
    'executor',
    'critic'
];
for (const role of teammateRoles) {
    const plan = buildMultimodalModelDispatchPlan({
        consumer: 'teammate',
        role,
        prefs: patchedFromLegacy,
        explicitModelId: 'xiaomi-mimo-v2.5'
    });
    expectEqual(`${role} 不能用 explicitModelId 绕开统一模型`, plan.selectedModelId, 'google-gemini-3-pro');
    expectEqual(`${role} 候选只有统一模型`, plan.candidateModelIds, ['google-gemini-3-pro']);
}

const primaryDispatch = buildMultimodalModelDispatchPlan({
    consumer: 'primary-agent',
    taskType: 'logic',
    prefs: patchedFromLegacy,
    explicitModelId: 'xiaomi-mimo-v2.5'
});
expectEqual('主 Agent 的显式 override 不能形成第二模型', primaryDispatch.selectedModelId, 'google-gemini-3-pro');

function dynamicModel(id, overrides = {}) {
    return {
        id,
        name: id,
        source: 'cloud',
        provider: 'openrouter',
        apiModelId: `vendor/${id}`,
        roles: ['general'],
        capabilities: ['text-generation'],
        usageKind: 'conversation',
        usageConfidence: 'declared',
        supportsVision: true,
        supportsToolUse: true,
        supportsStreaming: true,
        maxTokens: 8192,
        ...overrides
    };
}

const optionGroups = buildAllPrimaryModelOptionGroups([
    dynamicModel('test-agent-valid'),
    dynamicModel('test-agent-text-only', { supportsVision: false }),
    dynamicModel('test-agent-no-tools', { supportsToolUse: false }),
    dynamicModel('test-image-generator', {
        usageKind: 'image-generation',
        roles: [],
        capabilities: ['image-generation']
    })
]);
const optionIds = optionGroups.flatMap(group => group.options.map(option => option.id));
expectEqual('候选包含视觉且可工具调用的对话模型', optionIds.includes('test-agent-valid'), true);
expectEqual('候选排除纯文本模型', optionIds.includes('test-agent-text-only'), false);
expectEqual('候选排除明确不支持工具调用的视觉模型', optionIds.includes('test-agent-no-tools'), false);
expectEqual('候选排除图片生成模型', optionIds.includes('test-image-generator'), false);

const pollutedPreferences = normalizeModelPreferences({
    ...patchedFromLegacy,
    dynamicModels: [{ id: 'must-not-leak' }],
    unknownLegacyField: 'must-not-leak'
});
expectEqual(
    '归一化结果不传播 IPC 动态目录和未知旧字段',
    {
        dynamicModels: Object.prototype.hasOwnProperty.call(pollutedPreferences, 'dynamicModels'),
        unknownLegacyField: Object.prototype.hasOwnProperty.call(pollutedPreferences, 'unknownLegacyField')
    },
    { dynamicModels: false, unknownLegacyField: false }
);

const referenceReplicationSources = [
    path.resolve(__dirname, '..', 'src', 'renderer', 'hooks', 'useReferenceReplication.ts'),
    path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'layout-replication.executor.ts')
].map(filePath => fs.readFileSync(filePath, 'utf8')).join('\n');
expectEqual(
    '参考复刻不再藏有文本模型兜底',
    /local-qwen2\.5-7b|openrouter-qwen\/qwen-2\.5-72b-instruct/.test(referenceReplicationSources),
    false
);

console.log(`\n${failures === 0 ? '全部通过' : failures + ' 项失败'}`);
process.exit(failures === 0 ? 0 : 1);
