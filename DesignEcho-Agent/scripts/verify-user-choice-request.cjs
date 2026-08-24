// 「让用户帮我选」纯逻辑测试：单问 / 多问归一、必须给倾向项、回复措辞、全自动口径。
const path = require('path');
const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.main.json') });
const {
    canAutoResolveUserChoiceRequest,
    canSubmitUserChoiceAnswers,
    normalizeUserChoiceRequest,
    formatUserChoiceReply,
    describeAutoDecision
} = require(path.join(root, 'src/shared/user-choice-request.ts'));
const {
    buildSkuComboEditorInteractiveCard
} = require(path.join(root, 'src/shared/sku-combo-interactive-card.ts'));
const {
    listSkillInteractiveCardProviders,
    prepareSkillInteractiveCardSubmission
} = require(path.join(root, 'src/renderer/services/skill-executors/interaction-cards/registry.ts'));

let failed = 0;
function check(name, condition, detail) { if (condition) { console.log(`✅ ${name}`); return; } failed += 1; console.log(`❌ ${name}${detail ? ' — ' + detail : ''}`); }

const bad = normalizeUserChoiceRequest({
    decisionKind: 'preference', impact: 'material', question: '主图用哪种图？', why: '不同主体会改变画面表达',
    options: [{ label: '模特上脚' }]
});
check('只有一个选项被驳回', !bad.ok && bad.issues.some((i) => /至少给 2 个/.test(i)), JSON.stringify(bad.issues));
check('没给倾向项被驳回', !bad.ok && bad.issues.some((i) => /recommendedId/.test(i)));
check('没有问题类型被驳回', !normalizeUserChoiceRequest({ impact: 'material', question: '选哪个方向？', why: '方向会改变成稿', options: ['A', 'B'] }).ok);
check('没有实质影响声明被驳回', !normalizeUserChoiceRequest({ decisionKind: 'preference', question: '选哪个方向？', why: '方向会改变成稿', options: ['A', 'B'], recommendedId: 'A' }).ok);

const single = normalizeUserChoiceRequest({
    decisionKind: 'preference', impact: 'material',
    question: '主图用模特上脚图还是平铺图？', why: '主体选择会改变主图的视觉表达',
    options: [{ id: 'model', label: '模特上脚', detail: '有穿着感' }, { id: 'flat', label: '平铺', detail: '看清图案' }],
    recommendedId: 'flat'
});
check('单问归一成 1 题', single.ok && single.request.questions.length === 1 && single.request.questions[0].recommendedId === 'flat', JSON.stringify(single.issues));
check('recommended 也可按 label 匹配', normalizeUserChoiceRequest({ decisionKind: 'preference', impact: 'material', question: '用哪种方案？', why: '方案会改变最终构图方向', options: ['A 方案', 'B 方案'], recommendedId: 'B 方案' }).request.questions[0].recommendedId === 'opt-2');

const multi = normalizeUserChoiceRequest({
    intro: '开工前三件事要你定',
    questions: [
        { id: 'ip', decisionKind: 'approval', impact: 'high', question: '能不能用 Hello Kitty 形象？', why: '涉及第三方形象授权，不能由 Agent 推断', options: [{ id: 'y', label: '能，有授权' }, { id: 'n', label: '不能，只用袜子本身' }] },
        { id: 'platform', decisionKind: 'required_fact', impact: 'high', question: '主图走哪个平台规格？', why: '交付平台决定画布尺寸和验收规格', options: ['淘宝 800', '拼多多 750', '抖音 1440'] },
        { decisionKind: 'preference', impact: 'material', question: '这轮先出几张？', why: '数量会改变本轮生产范围和耗时', options: ['1 张先看', '5 张一套'], recommendedId: '1 张先看' }
    ]
});
check('多问归一 3 题且 id 齐', multi.ok && multi.request.questions.length === 3 && multi.request.questions[2].id === 'q-3', JSON.stringify(multi.issues));
check('超过 3 题被驳回', !normalizeUserChoiceRequest({ questions: Array.from({ length: 4 }).map((_, i) => ({ decisionKind: 'preference', impact: 'material', question: `问题 ${i} 是什么？`, why: '这个选择会改变最终结果', options: ['a', 'b'], recommendedId: 'a' })) }).ok);
check('事实问题不能带模型推荐', !normalizeUserChoiceRequest({ decisionKind: 'required_fact', impact: 'high', question: '是否拥有品牌授权？', why: '授权事实只能由用户确认', options: ['有', '没有'], recommendedId: '有' }).ok);
check('纯偏好可由自动模式处理', canAutoResolveUserChoiceRequest(single.request));
check('事实或授权必须等待用户', !canAutoResolveUserChoiceRequest(multi.request));

const q = single.request;
check('回复措辞：选项', formatUserChoiceReply(q, [{ questionId: q.questions[0].id, optionId: 'model' }]) === '关于「主图用模特上脚图还是平铺图？」：我选「模特上脚」');
check('回复措辞：自由文本', /：用两张拼$/.test(formatUserChoiceReply(q, [{ questionId: q.questions[0].id, freeText: '用两张拼' }])));
check('回复措辞：交给它定', /你自己定$/.test(formatUserChoiceReply(q, [])));
const multiReply = formatUserChoiceReply(multi.request, [{ questionId: 'ip', optionId: 'n' }]);
check('多问回复逐题一行、未答事实不伪装成委托', multiReply.split('\n').length === 3 && /不能，只用袜子本身/.test(multiReply) && /未回答/.test(multiReply), multiReply);
check('事实与授权未回答时不能提交', !canSubmitUserChoiceAnswers(multi.request, [{ questionId: 'ip', optionId: 'n' }]));
check('事实与授权回答后可提交，偏好可留给 Agent', canSubmitUserChoiceAnswers(multi.request, [
    { questionId: 'ip', optionId: 'n' },
    { questionId: 'platform', optionId: 'opt-1' }
]));
check('全自动口径只按可自动处理的偏好倾向项', /「平铺」/.test(describeAutoDecision(q)));

const skuCard = buildSkuComboEditorInteractiveCard({
    colorSlots: [
        { slot: 1, label: '红色' },
        { slot: 2, label: '蓝色' },
        { slot: 3, label: '白色' }
    ],
    requiredSizes: [2]
});
const preparedSkuSubmission = prepareSkillInteractiveCardSubmission(
    skuCard,
    skuCard.payload.initialValue
);
check(
    'SKU 组合卡由 Skill Provider 准备提交',
    preparedSkuSubmission.status === 'ready'
        && preparedSkuSubmission.submission.kind === 'sku_combo_editor'
        && preparedSkuSubmission.resumePolicy === 'required'
);
check(
    '未注册业务卡不会被通用提交器猜测处理',
    prepareSkillInteractiveCardSubmission({
        version: 'interactive-card/v0', id: 'unknown', kind: 'unknown_business_card', title: '未知', payload: {}
    }, {}).status === 'unsupported'
);

const chatPanelSource = require('fs').readFileSync(path.join(root, 'src/renderer/components/ChatPanel.tsx'), 'utf8');
const cardHostSource = require('fs').readFileSync(path.join(root, 'src/renderer/components/message/blocks/InteractiveCardBlock.tsx'), 'utf8');
const toolExecutorSource = require('fs').readFileSync(path.join(root, 'src/renderer/services/tool-executor.service.ts'), 'utf8');
const toolSchemaSource = require('fs').readFileSync(path.join(root, 'src/renderer/services/agent-runtime/tool-schemas.ts'), 'utf8');
const skillCardRegistrySource = require('fs').readFileSync(path.join(root, 'src/renderer/services/skill-executors/interaction-cards/registry.ts'), 'utf8');
const capabilityBridgeSource = require('fs').readFileSync(path.join(root, 'src/shared/agent-runtime-v5/tool-capability-bridge.ts'), 'utf8');
check('ChatPanel 不再导入 SKU 组合卡领域代码', !/sku-combo-interactive-card|SkuComboEditor|validateSkuComboEditorValue/.test(chatPanelSource));
check('ChatPanel 不再处理 SKU 专属卡片动作', !/submitSkuHumanReviewCard|sku-human-review-card|isSkuHumanReviewCard/.test(chatPanelSource));
check('通用卡片 Host 不再包含 SKU 业务渲染分支', !/sku_combo_editor|sku_human_review|SkuCombo|SkuHumanReview/.test(cardHostSource));
check('通用卡片 Tool 不再包含 SKU 类型特判', !/cardKind\s*===\s*['"]sku_combo_editor['"]/.test(toolExecutorSource));
check('不稳定的空泛确认卡类型已关闭', !/generic_confirmation/.test(toolSchemaSource) && !/generic_confirmation/.test(toolExecutorSource));
check('SKU 组合与人工复核卡都由 Skill Provider 注册', /skuComboInteractiveCardProvider/.test(skillCardRegistrySource) && /skuHumanReviewInteractiveCardProvider/.test(skillCardRegistrySource));
const skillCardProviders = listSkillInteractiveCardProviders();
check(
    '每个 SKU 业务卡 Provider 都声明 Skill owner',
    skillCardProviders.length === 2
        && skillCardProviders.every((provider) => provider.ownerSkillId === 'sku-batch'),
    JSON.stringify(skillCardProviders)
);
check(
    '业务卡 Provider 的 kind/version 注册键唯一',
    new Set(skillCardProviders.map((provider) => `${provider.kind}@${provider.payloadVersion}`)).size === skillCardProviders.length
);
check(
    '确认能力映射到选择卡而不是可编辑草稿卡',
    /'agent\.interaction\.requestConfirmation': \['askUserToChoose'\]/.test(capabilityBridgeSource)
        && !/'agent\.interaction\.requestConfirmation': \['createInteractiveCard'\]/.test(capabilityBridgeSource)
);
check(
    '浏览器导航和交互是独立的按需 Provider 能力',
    /'web\.navigatePage': \['navigateBrowserTab'\]/.test(capabilityBridgeSource)
        && /'web\.interactPage': \['interactWithBrowserPage'\]/.test(capabilityBridgeSource)
);
check('选择卡提交通过结构化内部恢复', /kind:\s*['"]user_choice_submitted['"]/.test(chatPanelSource) && /internalResumeRequest:\s*request/.test(chatPanelSource));

if (failed > 0) { console.log(`\n${failed} 项失败`); process.exit(1); }
console.log('\n全部通过');
