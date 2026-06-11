#!/usr/bin/env node

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    target: 'ES2020',
    module: 'CommonJS',
    moduleResolution: 'node',
    esModuleInterop: true,
    skipLibCheck: true
  }
});

const fs = require('fs');
const path = require('path');

const {
  buildBusinessSkillVisualEvidenceGate
} = require('../src/shared/business-skill-visual-evidence-gate.ts');
const {
  attachBusinessVisualEvidenceGateToResult,
  buildBusinessVisualEvidenceGateForSkill,
  isBusinessVisualEvidenceSkill
} = require('../src/renderer/services/skill-executors/business-skill-visual-evidence-gate.ts');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoMojibake(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const suspiciousTokens = [
    0x93B4,
    0x93C9,
    0x7487,
    0x951B,
    0xFFFD
  ].map((codePoint) => String.fromCodePoint(codePoint));
  const found = suspiciousTokens.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains mojibake tokens: ${found.join(', ')}`);
}

function assertNoRawPayload(value, label) {
  const text = JSON.stringify(value);
  const forbidden = ['base64', 'rawImage', 'pixels', 'buffer', 'dataUrl'];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains raw payload markers: ${found.join(', ')}`);
}

function buildProjectContext(options = {}) {
  return {
    projectPath: 'D:/demo-project',
    assetIndex: {
      indexVersion: 'project-asset-index/v0',
      generatedAt: '2026-05-15T00:00:00.000Z',
      projectPath: 'D:/demo-project',
      assets: [],
      visionCandidates: [
        {
          assetId: 'asset-1',
          path: 'D:/demo-project/source/asset-1.jpg',
          role: 'raw-product-still',
          priority: 80,
          reason: 'fixture'
        }
      ],
      summary: {
        totalFiles: 1,
        totalImages: 1,
        totalDesignDocuments: 0,
        roleCounts: {},
        folderRoleCounts: {},
        extensionCounts: {},
        colorNames: [],
        skuConfigCount: 0
      },
      skillReadiness: [],
      warnings: [],
      limitations: []
    },
    visualSamplingPlan: {
      planVersion: 'project-visual-sampling/v0',
      mode: 'bounded-metadata-plan',
      scenario: options.scenario || 'main-image',
      maxCandidates: 2,
      selectedCandidates: [
        {
          assetId: 'asset-1',
          path: 'D:/demo-project/source/asset-1.jpg',
          role: 'raw-product-still',
          priority: 80,
          score: 120,
          reason: 'fixture',
          cacheKey: 'project-visual:asset-1',
          cacheStatus: options.cacheHit ? 'hit' : 'miss',
          shouldAnalyze: !options.cacheHit,
          requiredEvidence: ['visual evidence'],
          cachedInsight: options.cacheHit ? {
            assetId: 'asset-1',
            path: 'D:/demo-project/source/asset-1.jpg',
            summary: '真实视觉摘要 fixture',
            productType: '袜子',
            evidence: []
          } : undefined,
          evidence: []
        }
      ],
      skippedCandidateCount: 0,
      cacheSummary: options.cacheHit
        ? { hit: 1, miss: 0, stale: 0, shouldAnalyze: 0 }
        : { hit: 0, miss: 1, stale: 0, shouldAnalyze: 1 },
      warnings: [],
      limitations: []
    },
    visualInsightCache: {
      cacheVersion: 'project-visual-insight-cache/v0',
      source: options.cacheHit ? 'persisted-project-cache' : 'missing',
      exists: Boolean(options.cacheHit),
      entries: options.cacheHit ? [{
        cacheKey: 'project-visual:asset-1',
        assetId: 'asset-1',
        path: 'D:/demo-project/source/asset-1.jpg',
        insight: {
          assetId: 'asset-1',
          path: 'D:/demo-project/source/asset-1.jpg',
          summary: '真实视觉摘要 fixture',
          productType: '袜子'
        }
      }] : [],
      summary: options.cacheHit
        ? { totalEntries: 1, entriesWithInsight: 1, entriesWithRawPayloadRemoved: 0 }
        : { totalEntries: 0, entriesWithInsight: 0, entriesWithRawPayloadRemoved: 0 },
      warnings: [],
      limitations: [],
      evidence: []
    }
  };
}

function run() {
  assert(isBusinessVisualEvidenceSkill('main-image-design'), 'main-image-design should be gated');
  assert(isBusinessVisualEvidenceSkill('detail-page-design'), 'detail-page-design should be gated');
  assert(isBusinessVisualEvidenceSkill('sku-batch'), 'sku-batch should be gated');
  assert(isBusinessVisualEvidenceSkill('layout-replication'), 'layout-replication should be gated');
  assert(!isBusinessVisualEvidenceSkill('document-management'), 'document-management should not be gated');
  assert(!isBusinessVisualEvidenceSkill('layer-management'), 'layer-management should not be gated');
  assert(!isBusinessVisualEvidenceSkill('visual-analysis'), 'visual-analysis should not be treated as business design skill gate');

  const missingGate = buildBusinessSkillVisualEvidenceGate({
    scenario: 'main-image',
    enforcement: 'evidence-only',
    requiresVisualEvidence: true
  });
  assert(missingGate.status === 'needs_context_snapshot', `missing context should require snapshot: ${JSON.stringify(missingGate)}`);
  assert(missingGate.shouldExecute === true, 'evidence-only missing context must not change executor behavior');

  const strictGate = buildBusinessSkillVisualEvidenceGate({
    scenario: 'main-image',
    enforcement: 'strict',
    requiresVisualEvidence: true
  });
  assert(strictGate.shouldExecute === false, 'strict missing context should block only when explicitly requested');
  assert(strictGate.blockers.length > 0, 'strict missing context should expose blockers');

  const params = { prompt: '帮我做主图', nested: { value: 1 } };
  const frozenParamsBefore = JSON.stringify(params);
  const gate = buildBusinessVisualEvidenceGateForSkill('main-image-design', {
    params,
    context: { userInput: '帮我做主图', conversationHistory: [], isPluginConnected: true, projectContext: buildProjectContext({ cacheHit: true }) }
  });
  assert(gate?.status === 'ready', `cached context should be ready: ${JSON.stringify(gate)}`);
  assert(JSON.stringify(params) === frozenParamsBefore, 'gate must not mutate params');
  assert(gate.cacheSummary.entriesWithInsight === 1, 'gate should read visual insight cache summary');

  const skuGate = buildBusinessVisualEvidenceGateForSkill('sku-batch', {
    params: { sizes: [2, 3] },
    context: { userInput: '帮我做 SKU', conversationHistory: [], isPluginConnected: true, projectContext: buildProjectContext({ scenario: 'sku', cacheHit: false }) }
  });
  assert(skuGate?.scenario === 'sku', `sku-batch should map to sku scenario: ${JSON.stringify(skuGate)}`);
  assert(skuGate.status === 'needs_visual_insight', `cache miss should need insight: ${JSON.stringify(skuGate)}`);
  assert(skuGate.shouldExecute === true, 'evidence-only cache miss should not change executor behavior');

  const nonBusinessGate = buildBusinessVisualEvidenceGateForSkill('document-management', {
    params: {},
    context: { userInput: '保存文档', conversationHistory: [], isPluginConnected: true }
  });
  assert(nonBusinessGate === undefined, 'non-business skill should not build gate');

  const result = attachBusinessVisualEvidenceGateToResult({ success: true, message: 'ok', data: { existing: true } }, gate);
  assert(result.data.existing === true, 'existing result data should be preserved');
  assert(result.data.businessVisualEvidenceGate.status === 'ready', 'gate should be appended to result data');
  assert(result.data.businessVisualEvidenceFeedback.feedbackVersion === 'business-skill-visual-evidence-feedback/v0', 'feedback should be appended to result data');
  assert(result.data.businessVisualEvidenceFeedback.userVisible === false, 'ready feedback should not become a visible warning');

  const indexSource = read('src/renderer/services/skill-executors/index.ts');
  const wrapperSource = read('src/renderer/services/skill-executors/business-skill-visual-evidence-gate.ts');
  assert(indexSource.includes('buildBusinessVisualEvidenceGateForSkill'), 'skill executor entrypoint should build gate');
  assert(indexSource.includes('attachBusinessVisualEvidenceGateToResult'), 'skill executor entrypoint should append gate');
  assert(wrapperSource.includes('businessVisualEvidenceFeedback'), 'gate wrapper should append feedback beside gate');
  assert(!wrapperSource.includes('analyzeAssetContent'), 'gate wrapper must not call visual analyzer');
  assert(!wrapperSource.includes('writeProjectVisualInsightCache'), 'gate wrapper must not write visual cache');
  assert(!wrapperSource.includes('executeToolCall'), 'gate wrapper must not call Photoshop tools');

  [
    ['missingGate', missingGate],
    ['strictGate', strictGate],
    ['gate', gate],
    ['skuGate', skuGate],
    ['result', result],
    ['indexSource', indexSource],
    ['wrapperSource', wrapperSource]
  ].forEach(([label, value]) => {
    assertNoMojibake(value, label);
    assertNoRawPayload(value, label);
  });

  console.log(JSON.stringify({
    success: true,
    checks: [
      'business visual evidence gate applies only to main-image, detail-page, sku and reference replication skills',
      'non-business tools do not receive the gate',
      'evidence-only mode does not block execution or mutate params',
      'strict mode can block only when explicitly requested',
      'gate reads VisualSamplingPlan and VisualInsightCache summaries without calling analyzer or writer',
      'skill executor entrypoint appends businessVisualEvidenceGate to result data'
    ]
  }, null, 2));
}

run();
