#!/usr/bin/env node

const path = require('path');

const memoryStore = new Map();
global.localStorage = {
  getItem: (key) => memoryStore.has(key) ? memoryStore.get(key) : null,
  setItem: (key, value) => memoryStore.set(key, String(value)),
  removeItem: (key) => memoryStore.delete(key),
  clear: () => memoryStore.clear()
};

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const repoRoot = path.resolve(__dirname, '..');

const {
  buildBusinessSkillMemoryEvidence
} = require(path.join(repoRoot, 'src', 'shared', 'business-skill-memory-evidence.ts'));
const {
  buildDetailPagePlannerEvidence,
  buildSkuBatchPlannerEvidence
} = require(path.join(repoRoot, 'src', 'renderer', 'services', 'skill-executors', 'design-planner-evidence.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoRawPayload(value, label) {
  const serialized = JSON.stringify(value);
  const forbidden = ['raw-image-payload', 'base64-image-payload', 'data:image/'];
  const found = forbidden.filter((token) => serialized.includes(token));
  assert(found.length === 0, `${label} must not retain raw image-like payloads: ${found.join(', ')}`, value);
}

function assertNoConfidence(value, label) {
  const serialized = JSON.stringify(value);
  assert(!serialized.includes('"confidence"') && !serialized.includes('置信'), `${label} must not expose confidence fields`, value);
}

const localMemoryKnowledge = [
  {
    id: 'local-memory:user-preference-style-clean',
    title: '偏好风格：浅色干净',
    intent: 'rule',
    sourceType: 'local_case',
    summary: '用户偏好风格为 浅色干净，可影响策略排序，但不能替代视觉证据。',
    evidence: ['记忆类型：user_preference', '来源：manual_setting', 'manual_setting：来自用户偏好设置。'],
    tags: ['design-memory', 'user_preference', 'manual_setting', 'style', '浅色干净'],
    allowedUses: ['prompt_context', 'user_reference'],
    evidenceLevel: 'local_case',
    sourceRank: 78,
    updatedAt: '2026-05-26T00:00:00.000Z'
  },
  {
    id: 'local-memory:user-preference-font-puhuiti',
    title: '常用字体：阿里巴巴普惠体',
    intent: 'rule',
    sourceType: 'local_case',
    summary: '用户历史操作中多次使用或记录了字体 阿里巴巴普惠体，只能作为排版候选偏好。',
    evidence: ['记忆类型：user_preference', '来源：inferred_from_operations', 'inferred_from_operations：来自本地记忆的字体偏好，未等同于当前任务要求。'],
    tags: ['design-memory', 'user_preference', 'inferred_from_operations', 'font', 'typography', '阿里巴巴普惠体'],
    allowedUses: ['prompt_context', 'user_reference'],
    evidenceLevel: 'local_case',
    sourceRank: 52
  },
  {
    id: 'local-memory:user-preference-color-ecru',
    title: '常用颜色：奶白',
    intent: 'rule',
    sourceType: 'local_case',
    summary: '用户历史操作中记录了颜色 奶白，只能作为配色候选偏好。',
    evidence: ['记忆类型：user_preference', '来源：inferred_from_operations', 'inferred_from_operations：来自本地记忆的颜色偏好，不能覆盖商品、品牌或平台规范。'],
    tags: ['design-memory', 'user_preference', 'inferred_from_operations', 'color', '奶白'],
    allowedUses: ['prompt_context', 'user_reference'],
    evidenceLevel: 'local_case',
    sourceRank: 52
  },
  {
    id: 'local-memory:blocked-direct-action',
    title: '不能进入策略的动作',
    intent: 'reference',
    sourceType: 'local_case',
    summary: '该项只能用于直接 Photoshop 动作 raw-image-payload data:image/png;base64,abc。',
    evidence: ['should be filtered'],
    tags: ['design-memory', 'user_preference'],
    allowedUses: ['direct_photoshop_action'],
    evidenceLevel: 'local_case',
    sourceRank: 100
  }
];

function run() {
  const detailEvidence = buildBusinessSkillMemoryEvidence({
    scenario: 'detail-page',
    userText: '帮我做详情页，保持浅色干净',
    knowledgeResults: localMemoryKnowledge
  });
  assert(detailEvidence.version === 'business-skill-memory-evidence/v0', 'business memory evidence version mismatch', detailEvidence);
  assert(detailEvidence.scenario === 'detail-page', 'detail evidence scenario mismatch', detailEvidence);
  assert(detailEvidence.status === 'available', 'detail page memory should be available', detailEvidence);
  assert(detailEvidence.preferenceSummary.sourceResultCount === 3, 'detail page should count only usable local memories', detailEvidence.preferenceSummary);
  assert(detailEvidence.preferenceSummary.stylePreferences.includes('浅色干净'), 'detail page should extract style preference', detailEvidence.preferenceSummary);
  assert(detailEvidence.preferenceSummary.typographyPreferences.includes('阿里巴巴普惠体'), 'detail page should extract typography preference', detailEvidence.preferenceSummary);
  assert(detailEvidence.preferenceSummary.colorPreferences.includes('奶白'), 'detail page should extract color preference', detailEvidence.preferenceSummary);
  assert(detailEvidence.strategyInputPatch.designMemory.sourceResultCount === 3, 'detail evidence should expose generic designMemory patch', detailEvidence.strategyInputPatch);
  assert(detailEvidence.noPhotoshopWrites === true && detailEvidence.mustNotExecutePhotoshop === true, 'detail evidence must be read-only', detailEvidence);
  assertNoRawPayload(detailEvidence, 'detail page business memory evidence');
  assertNoConfidence(detailEvidence, 'detail page business memory evidence');

  const skuEvidence = buildBusinessSkillMemoryEvidence({
    scenario: 'sku',
    userText: '帮我做 SKU 和自选备注',
    knowledgeResults: localMemoryKnowledge
  });
  assert(skuEvidence.scenario === 'sku', 'SKU evidence scenario mismatch', skuEvidence);
  assert(skuEvidence.preferenceSummary.sourceResultCount === 3, 'SKU should count only usable local memories', skuEvidence.preferenceSummary);
  assert(skuEvidence.limitations.some((item) => item.includes('不能改变 SKU 自选备注')), 'SKU evidence should preserve note intent boundary', skuEvidence.limitations);
  assertNoRawPayload(skuEvidence, 'SKU business memory evidence');
  assertNoConfidence(skuEvidence, 'SKU business memory evidence');

  const detailPlanner = buildDetailPagePlannerEvidence({
    userInput: '帮我做详情页',
    params: { knowledgeResults: localMemoryKnowledge },
    context: { projectContext: { projectPath: 'C:/project' } },
    projectPath: 'C:/project',
    screenCount: 8,
    mode: 'inspect',
    readinessMode: 'inspect',
    screenPlanCount: 0
  });
  assert(detailPlanner.businessSkillMemoryEvidence?.scenario === 'detail-page', 'detail planner should expose business memory evidence', detailPlanner.businessSkillMemoryEvidence);
  assert(detailPlanner.businessSkillMemoryEvidence.preferenceSummary.sourceResultCount === 3, 'detail planner memory count mismatch', detailPlanner.businessSkillMemoryEvidence);
  assertNoConfidence(detailPlanner.businessSkillMemoryEvidence, 'detail planner memory evidence');

  const skuPlanner = buildSkuBatchPlannerEvidence({
    userInput: '帮我做 SKU 自选备注',
    params: { knowledgeResults: localMemoryKnowledge },
    context: { projectContext: { projectPath: 'C:/project' } },
    projectPath: 'C:/project',
    comboSizes: [2, 3, 4],
    colorCount: 5,
    totalCombinations: 30,
    processedSizeCount: 0
  });
  assert(skuPlanner.businessSkillMemoryEvidence?.scenario === 'sku', 'SKU planner should expose business memory evidence', skuPlanner.businessSkillMemoryEvidence);
  assert(skuPlanner.businessSkillMemoryEvidence.preferenceSummary.sourceResultCount === 3, 'SKU planner memory count mismatch', skuPlanner.businessSkillMemoryEvidence);
  assert(
    skuPlanner.businessSkillMemoryEvidence.limitations.some((item) => item.includes('不能改变 SKU 自选备注')),
    'SKU planner memory evidence must preserve note boundary',
    skuPlanner.businessSkillMemoryEvidence
  );
  assertNoRawPayload(skuPlanner.businessSkillMemoryEvidence, 'SKU planner memory evidence');
  assertNoConfidence(skuPlanner.businessSkillMemoryEvidence, 'SKU planner memory evidence');

  console.log(JSON.stringify({
    success: true,
    checks: [
      'detail-page and SKU consume local_case preferences as structured businessSkillMemoryEvidence',
      'business memory evidence stays read-only and optional',
      'direct Photoshop actions and raw image payloads are filtered',
      'SKU memory evidence preserves self-select note intent boundaries',
      'detail/SKU planner evidence exposes memory without tool execution'
    ]
  }, null, 2));
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
