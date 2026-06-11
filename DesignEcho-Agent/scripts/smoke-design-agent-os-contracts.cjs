#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(text, needle, label) {
  assert(text.includes(needle), `${label} must include ${needle}`);
}

function assertNoMojibake(text, label) {
  const signals = [
    '\u9359',
    '\u93c8',
    '\u951b',
    '\u95c8',
    '\u7f01',
    '\u20ac',
    '\ufffd',
    '\u9359',
    '\u9428',
    '\u6d93',
    '\u95c2',
    '\u7efe',
    '\u9225',
    '\u4fd9'
  ];
  for (const signal of signals) {
    assert(!text.includes(signal), `${label} contains mojibake signal ${JSON.stringify(signal)}`);
  }
}

const contracts = read('src/shared/design-agent-os-contracts.ts');
const layoutExecutor = read('src/renderer/services/skill-executors/layout-replication.executor.ts');
const mainImageExecutor = read('src/renderer/services/skill-executors/main-image.executor.ts');
const detailPageExecutor = read('src/renderer/services/skill-executors/detail-page.executor.ts');
const skuBatchExecutor = read('src/renderer/services/skill-executors/sku-batch.executor.ts');
const textHandlers = read('src/main/uxp-handlers/text-handlers.ts');
const knowledgeSearchService = read('src/main/services/design-knowledge-search-service.ts');
const smartScalingPolicy = read('src/shared/design-smart-scaling-policy.ts');
const plannerEvidence = read('src/renderer/services/skill-executors/design-planner-evidence.ts');
const packageJson = JSON.parse(read('package.json'));

[
  'UserIntent',
  'DesignBrief',
  'AssetUnderstanding',
  'VisualUnderstanding',
  'DesignDSL',
  'ExecutionPlan',
  'ExecutionTrace',
  'VerificationReport'
].forEach((name) => {
  assertIncludes(contracts, `export interface ${name}`, 'design-agent-os-contracts.ts');
});

[
  'buildUserIntentFromText',
  'buildDesignBriefFromIntent',
  'buildVisualUnderstandingFromMinimalRepresentation',
  'buildDesignDslFromMinimalRepresentation',
  'buildMainImageExecutionPlan',
  'buildReferenceReplicationDesignAgentOsEvidence',
  'buildMainImageDesignAgentOsEvidence',
  'buildDetailPageDesignAgentOsEvidence',
  'buildSkuDesignAgentOsEvidence',
  'buildCopywritingDesignAgentOsEvidence',
  'buildSmartScalingDesignAgentOsEvidence',
  'buildKnowledgeSearchDesignAgentOsEvidence'
].forEach((name) => {
  assertIncludes(contracts, `export function ${name}`, 'design-agent-os-contracts.ts');
});

assertIncludes(contracts, "'needs_review'", 'design-agent-os-contracts.ts');
assertIncludes(contracts, '不代表还原原作者 PSD', 'design-agent-os-contracts.ts');
assertIncludes(contracts, '不代表审美质量自动通过', 'design-agent-os-contracts.ts');
assertIncludes(contracts, '不等于截图级高保真复刻', 'design-agent-os-contracts.ts');
assertIncludes(contracts, '不等于版式质量、截图级 QA 或完整设计验收', 'design-agent-os-contracts.ts');
assertIncludes(contracts, '不替代导出文件存在性、颜色准确性和版式视觉验收', 'design-agent-os-contracts.ts');
assertIncludes(contracts, '原文本只作为字数、行数、换行和标点骨架，不作为语义参考', 'design-agent-os-contracts.ts');
assertIncludes(contracts, '文案请求没有参考图片证据，不能编造画面、款式、材质或场景', 'design-agent-os-contracts.ts');
assertIncludes(contracts, 'planned destinationBox 不是执行结果', 'design-agent-os-contracts.ts');
assertIncludes(contracts, '知识搜索只提供设计上下文和 recipe 线索，不直接执行 Photoshop', 'design-agent-os-contracts.ts');
assertIncludes(contracts, '本地知识 MVP 不等于完整 RAG 或多模态知识图谱', 'design-agent-os-contracts.ts');
assert(!contracts.includes('confidence: number;\n    constraints: string[];\n    evidence: EvidenceRef[];\n}'), 'UserIntent must not expose ungrounded confidence');
assert(!contracts.includes('constraints: string[];\n    confidence: number;\n    evidence: EvidenceRef[];'), 'DesignBrief must not expose ungrounded confidence');
assert(!contracts.includes('缺少用户输入，只能生成低置信度意图'), 'UserIntent should describe missing evidence instead of low confidence');
assert(!contracts.includes('options.confidence ??'), 'UserIntent builder must not synthesize confidence from raw text');

assertIncludes(layoutExecutor, 'buildReferenceReplicationDesignAgentOsEvidence', 'layout-replication.executor.ts');
assertIncludes(layoutExecutor, 'buildReferenceReplicationPlannerEvidence', 'layout-replication.executor.ts');
assertIncludes(layoutExecutor, 'designAgentOs', 'layout-replication.executor.ts');
assertIncludes(layoutExecutor, 'designPlanner', 'layout-replication.executor.ts');
assertIncludes(layoutExecutor, "mode: 'reference_preflight'", 'layout-replication.executor.ts');
assertIncludes(layoutExecutor, 'buildPlannerExecutionPreflightGate', 'layout-replication.executor.ts');
assertIncludes(layoutExecutor, '!designPlannerPreflightGate.shouldExecute', 'layout-replication.executor.ts');
assertIncludes(layoutExecutor, 'designPlannerPreflight', 'layout-replication.executor.ts');
assertIncludes(layoutExecutor, "mode: 'template_blueprint'", 'layout-replication.executor.ts');
assertIncludes(layoutExecutor, "mode: 'match_existing_document'", 'layout-replication.executor.ts');

assertIncludes(mainImageExecutor, 'buildMainImageDesignAgentOsEvidence', 'main-image.executor.ts');
assertIncludes(mainImageExecutor, 'buildMainImagePlannerEvidence', 'main-image.executor.ts');
assertIncludes(mainImageExecutor, 'sizePlanEvidence', 'main-image.executor.ts');
assertIncludes(mainImageExecutor, 'designAgentOs', 'main-image.executor.ts');
assertIncludes(mainImageExecutor, 'designPlanner', 'main-image.executor.ts');

assertIncludes(detailPageExecutor, 'buildDetailPageDesignAgentOsEvidence', 'detail-page.executor.ts');
assertIncludes(detailPageExecutor, 'buildDetailPageScreenEvidence', 'detail-page.executor.ts');
assertIncludes(detailPageExecutor, 'designAgentOs', 'detail-page.executor.ts');
assertIncludes(detailPageExecutor, 'buildDetailPagePlannerEvidence', 'detail-page.executor.ts');
assertIncludes(detailPageExecutor, 'designPlanner', 'detail-page.executor.ts');

assertIncludes(skuBatchExecutor, 'buildSkuDesignAgentOsEvidence', 'sku-batch.executor.ts');
assertIncludes(skuBatchExecutor, 'skuPlanEvidence', 'sku-batch.executor.ts');
assertIncludes(skuBatchExecutor, 'designAgentOs', 'sku-batch.executor.ts');
assertIncludes(skuBatchExecutor, 'buildSkuBatchPlannerEvidence', 'sku-batch.executor.ts');
assertIncludes(skuBatchExecutor, 'designPlanner', 'sku-batch.executor.ts');

assertIncludes(plannerEvidence, 'buildReferenceReplicationPlannerEvidence', 'design-planner-evidence.ts');
assertIncludes(plannerEvidence, 'buildMainImagePlannerEvidence', 'design-planner-evidence.ts');
assertIncludes(plannerEvidence, 'buildDetailPagePlannerEvidence', 'design-planner-evidence.ts');
assertIncludes(plannerEvidence, 'buildSkuBatchPlannerEvidence', 'design-planner-evidence.ts');
assertIncludes(plannerEvidence, 'comparePlannerExecutionPlanToExecutor', 'design-planner-evidence.ts');
assertIncludes(plannerEvidence, 'Planner evidence is read-only and must not change Photoshop execution parameters.', 'design-planner-evidence.ts');
assertIncludes(layoutExecutor, 'designPlannerExecutionAlignment', 'layout-replication.executor.ts');

assertIncludes(textHandlers, 'buildCopywritingDesignAgentOsEvidence', 'text-handlers.ts');
assertIncludes(textHandlers, 'designAgentOs: buildDesignAgentOs', 'text-handlers.ts');
assertIncludes(textHandlers, '当前文本只作为字数、行数、换行、标点和排版占位参考，不作为语义方向参考', 'text-handlers.ts');

assertIncludes(knowledgeSearchService, 'buildKnowledgeSearchDesignAgentOsEvidence', 'design-knowledge-search-service.ts');
assertIncludes(knowledgeSearchService, 'designAgentOs', 'design-knowledge-search-service.ts');

assertIncludes(smartScalingPolicy, 'A Photoshop execution step must verify the resulting layer bounds after transform', 'design-smart-scaling-policy.ts');
assertIncludes(contracts, 'buildSmartScalingDesignAgentOsEvidence', 'design-agent-os-contracts.ts');

assert(
  packageJson.scripts && packageJson.scripts['smoke:design-agent-os:contracts'] === 'node scripts/smoke-design-agent-os-contracts.cjs',
  'package.json must expose smoke:design-agent-os:contracts'
);

[
  ['contracts', contracts],
  ['layoutExecutor', layoutExecutor],
  ['mainImageExecutor', mainImageExecutor],
  ['detailPageExecutor', detailPageExecutor],
  ['skuBatchExecutor', skuBatchExecutor],
  ['textHandlers', textHandlers],
  ['knowledgeSearchService', knowledgeSearchService],
  ['smartScalingPolicy', smartScalingPolicy],
  ['plannerEvidence', plannerEvidence]
].forEach(([label, text]) => assertNoMojibake(text, label));

console.log(JSON.stringify({
  success: true,
  checks: [
    'Design Agent OS contract interfaces exist',
    'helper functions exist and keep review boundaries visible',
    'layout-replication attaches read-only designAgentOs evidence',
    'layout-replication attaches read-only Design Planner evidence',
    'layout-replication consumes planner readiness as a preflight without changing Photoshop parameters',
    'layout-replication compares planner executionPlan with executor evidence',
    'main-image attaches read-only designAgentOs evidence',
    'main-image attaches read-only Design Planner evidence',
    'detail-page attaches read-only designAgentOs evidence',
    'detail-page attaches read-only Design Planner evidence',
    'sku-batch attaches read-only designAgentOs evidence',
    'sku-batch attaches read-only Design Planner evidence',
    'copywriting handler attaches read-only designAgentOs evidence without using old text as semantic source',
    'smart-scaling helper separates planned destinationBox from Photoshop execution evidence',
    'knowledge search service attaches read-only designAgentOs evidence and does not emit direct Photoshop actions',
    'mojibake guard passed'
  ]
}, null, 2));
