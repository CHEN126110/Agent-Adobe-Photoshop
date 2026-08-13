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

const path = require('path');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const { classifyModelUsage } = require(
    path.resolve(__dirname, '..', 'src', 'shared', 'config', 'model-usage-classification.ts')
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

console.log('=== 出图模型：output 含 image，同时也出文字 ===');
// 这是 OpenRouter 上所有 chat completions 形态图像模型的真实形状
expectKind(
    'google/gemini-3-pro-image',
    { apiModelId: 'google/gemini-3-pro-image', inputModalities: ['text', 'image'], outputModalities: ['image', 'text'] },
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

console.log(`\n${failures === 0 ? '全部通过' : failures + ' 项失败'}`);
process.exit(failures === 0 ? 0 : 1);
