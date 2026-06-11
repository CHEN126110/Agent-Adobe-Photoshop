#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const agentRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(agentRoot, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assertIncludes(content, needle, label) {
  if (!content.includes(needle)) {
    throw new Error(`${label} missing: ${needle}`);
  }
}

function assertNotIncludes(content, needle, label) {
  if (content.includes(needle)) {
    throw new Error(`${label} contains unexpected text: ${needle}`);
  }
}

const webview = read('DesignEcho-Agent/public/webview/index.html');
const textHandler = read('DesignEcho-Agent/src/main/uxp-handlers/text-handlers.ts');
const uxpBridge = read('DesignEcho-UXP/src/index.ts');
const copywritingFramework = read('DesignEcho-Agent/src/shared/design-copywriting-framework.ts');

for (const id of [
  'optimizeCreativeStyle',
  'optimizeTargetAudience',
  'optimizeLockedKeywords',
  'optimizeDescription',
  'optimizeUseCanvasBtn',
  'optimizeImageSourceHint',
  'optimizeImageInput'
]) {
  assertIncludes(webview, id, 'copy optimization UI');
}

for (const removedUiToken of [
  '设计语境',
  '调整方向与边界',
  'optimizeContentType',
  'optimizeCopyRole',
  'optimizeForbiddenKeywords',
  'optimizeMaxChars',
  'optimizeRevisionNote',
  'optimizeFeedbackTags',
  'optimize-feedback-chip'
]) {
  assertNotIncludes(webview, removedUiToken, 'simplified copy optimization UI');
}

for (const fakeProgressToken of [
  '_optimizeGenSteps',
  '正在分析人群与商品信息',
  '正在生成三版候选文案',
  'AI 创作中，请稍候',
  '即将完成'
]) {
  assertNotIncludes(webview, fakeProgressToken, 'copywriting fake progress UI');
  assertNotIncludes(uxpBridge, fakeProgressToken, 'copywriting fake progress bridge');
}

for (const uiToken of [
  'optimize-candidate-card',
  'candidateDetails',
  'fitStatus',
  'optimize-candidate-badge'
]) {
  assertIncludes(webview, uiToken, 'copy optimization candidate card UI');
}

for (const key of [
  'creativeStyle',
  'targetAudience',
  'lockedKeywords',
  'description'
]) {
  assertIncludes(webview, key, 'webview payload');
  assertIncludes(uxpBridge, key, 'UXP optimize-text forwarding');
  assertIncludes(textHandler, key, 'Agent optimize-text handler');
}

for (const imageContextToken of [
  '默认自动使用当前画面',
  '使用当前画面',
  'optimizeTextImageCaptured',
  'applyOptimizeReferenceImage',
  'optimizeTextUseCanvasSnapshot',
  'captureOptimizeTextCanvasSnapshot',
  'canvas-auto'
]) {
  assertIncludes(webview + '\n' + uxpBridge, imageContextToken, 'copywriting image context interaction');
}

for (const legacyKey of [
  'contentType',
  'copyRole',
  'forbiddenKeywords',
  'revisionNote',
  'goals',
  'maxChars'
]) {
  assertIncludes(uxpBridge, legacyKey, 'UXP optimize-text forwarding compatibility');
  assertIncludes(textHandler, legacyKey, 'Agent optimize-text handler compatibility');
}

for (const detailToken of [
  'buildCandidateDetail',
  'lengthDiff',
  'missingKeywords',
  'forbiddenHits',
  'fitLabel',
  'candidateMatchesLayoutSkeleton',
  'buildLayoutSkeletonDescription',
  'layoutSkeleton'
]) {
  assertIncludes(textHandler, detailToken, 'Agent candidate detail contract');
}

for (const promptText of [
  '文案撰写专家',
  '目标人群与兴趣方向',
  '版式骨架',
  '不包含当前文本语义',
  '不要围绕原文做同义改写',
  '内容场景',
  '文案角色',
  '本轮优化目标',
  '禁止出现的词',
  '用户对上一轮结果的具体反馈',
  '上下文完整性检查',
  '不得编造画面、功能、材质、场景或用户痛点'
]) {
  assertIncludes(textHandler, promptText, 'optimize prompt contract');
}

for (const removedPromptToken of [
  'lineTemplateDesc',
  '版式参考文本',
  '每行字数尽量接近',
  '默认只接受',
  '降级候选',
  '「${originalText}」',
  'getPreferredCharDiff',
  'fallbackCandidates'
]) {
  assertNotIncludes(textHandler, removedPromptToken, 'strict layout prompt contract');
}

for (const strictCandidateUiToken of [
  'canApply',
  '不符合版式',
  'optimize-apply-btn'
]) {
  assertIncludes(webview, strictCandidateUiToken, 'strict copywriting candidate UI');
}

for (const integrationToken of [
  'buildCopywritingContextChecklist',
  'formatCopywritingFrameworkForPrompt',
  'copywritingContext.missing'
]) {
  assertIncludes(textHandler, integrationToken, 'text handler copywriting framework integration');
}

for (const frameworkToken of [
  'COPYWRITING_TEMPLATES',
  'COPYWRITING_SCORE_CRITERIA',
  'COPYWRITING_SAFETY_RULES',
  'buildCopywritingContextChecklist',
  'formatCopywritingFrameworkForPrompt',
  '图文文案撰写框架',
  '目标人群 + 兴趣方向 + 图片真实信息 + 用户使用场景 + 产品解决的问题 + 有记忆点的表达',
  'COPYWRITING_PROCESS',
  'COPYWRITING_PISBEC'
]) {
  assertIncludes(copywritingFramework, frameworkToken, 'copywriting framework module');
}

const mojibakeSamples = [0x9359, 0x7487, 0x923F, 0xFFFD].map(codePoint => String.fromCodePoint(codePoint));

for (const mojibake of mojibakeSamples) {
  assertNotIncludes(webview, mojibake, 'webview');
  assertNotIncludes(textHandler, mojibake, 'text handler');
  assertNotIncludes(uxpBridge, mojibake, 'UXP bridge');
  assertNotIncludes(copywritingFramework, mojibake, 'copywriting framework');
}

console.log(JSON.stringify({
  success: true,
  checks: [
    'copywriting UI keeps only style, target audience, retained keywords, product brief, reference image, and candidate cards',
    'copywriting UI includes target audience as the minimal people/interest input',
    'copy optimization UI removes design context and adjustment-boundary modules',
    'copywriting UI and UXP bridge do not show timed fake model-progress stages',
    'copy optimization candidate cards expose fit status and detail evidence',
    'copywriting framework is available to the Agent prompt without fake thinking',
    'webview sends only the simplified user-facing fields to UXP',
    'UXP and Agent keep compatibility for legacy structured fields',
    'Agent prompt, candidate filtering, and candidate detail generation consume compatible fields'
  ]
}, null, 2));
