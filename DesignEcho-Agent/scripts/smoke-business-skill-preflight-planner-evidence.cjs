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
  buildBusinessSkillExecutionPreflightGate
} = require('../src/shared/business-skill-execution-preflight-gate.ts');
const {
  buildBusinessSkillPreflightPlannerEvidence
} = require('../src/shared/business-skill-preflight-planner-evidence.ts');
const {
  attachBusinessSkillExecutionPreflightGateToResult,
  buildBusinessSkillExecutionPreflightGateForSkill
} = require('../src/renderer/services/skill-executors/business-skill-visual-evidence-gate.ts');

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoRawPayload(value, label) {
  const text = JSON.stringify(value);
  const forbidden = ['base64-image-payload', 'raw-image-payload', 'dataUrl', 'pixels', 'buffer'];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains raw payload markers: ${found.join(', ')}`);
}

function assertNoPseudoThinking(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const forbidden = ['正在思考', '等待响应', '请求已发送', '正在准备', '稍等'];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains pseudo-thinking copy: ${found.join(', ')}`);
}

function buildFullContextEvidence() {
  return {
    hasProjectContext: true,
    hasAssetIndex: true,
    hasVisualSamplingPlan: true,
    hasVisualUnderstanding: true,
    hasTemplateEvidence: true
  };
}

function buildProjectContext() {
  return {
    projectPath: 'D:/demo-project',
    assetIndex: {
      indexVersion: 'project-asset-index/v0',
      generatedAt: '2026-05-16T00:00:00.000Z',
      projectPath: 'D:/demo-project',
      assets: [],
      visionCandidates: [],
      summary: {
        totalFiles: 1,
        totalImages: 1,
        totalDesignDocuments: 1,
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
      scenario: 'sku',
      maxCandidates: 2,
      selectedCandidates: [{
        assetId: 'asset-1',
        path: 'D:/demo-project/source/asset-1.jpg',
        role: 'raw-product-still',
        priority: 80,
        score: 120,
        reason: 'fixture',
        cacheKey: 'project-visual:asset-1',
        cacheStatus: 'hit',
        shouldAnalyze: false,
        cachedInsight: {
          assetId: 'asset-1',
          path: 'D:/demo-project/source/asset-1.jpg',
          summary: '袜子素材 fixture',
          productType: '袜子'
        },
        evidence: []
      }],
      skippedCandidateCount: 0,
      cacheSummary: { hit: 1, miss: 0, stale: 0, shouldAnalyze: 0 },
      warnings: [],
      limitations: []
    },
    visualInsightCache: {
      cacheVersion: 'project-visual-insight-cache/v0',
      source: 'persisted-project-cache',
      exists: true,
      entries: [{
        cacheKey: 'project-visual:asset-1',
        assetId: 'asset-1',
        path: 'D:/demo-project/source/asset-1.jpg',
        insight: {
          assetId: 'asset-1',
          path: 'D:/demo-project/source/asset-1.jpg',
          summary: '袜子素材 fixture',
          productType: '袜子'
        }
      }],
      summary: { totalEntries: 1, entriesWithInsight: 1, entriesWithRawPayloadRemoved: 0 },
      warnings: [],
      limitations: [],
      evidence: []
    }
  };
}

function buildExecuteParams(projectContext) {
  return {
    params: { prompt: '帮我做 SKU', rawImage: 'raw-image-payload' },
    context: {
      userInput: '帮我做 SKU',
      conversationHistory: [],
      isPluginConnected: true,
      projectContext
    }
  };
}

function assertPackageRegistration() {
  const packageJson = JSON.parse(read('package.json'));
  assert(
    packageJson.scripts?.['smoke:business-skill:preflight-planner-evidence'] ===
      'node scripts/smoke-business-skill-preflight-planner-evidence.cjs',
    'package.json should expose smoke:business-skill:preflight-planner-evidence'
  );
  assert(
    String(packageJson.scripts?.['maintenance:preflight'] || '').includes('smoke:business-skill:preflight-planner-evidence'),
    'maintenance:preflight should include smoke:business-skill:preflight-planner-evidence'
  );
}

function run() {
  const readyGate = buildBusinessSkillExecutionPreflightGate({
    skillId: 'sku-batch',
    requestKind: 'execute_existing',
    contextEvidence: buildFullContextEvidence()
  });
  const readyEvidence = buildBusinessSkillPreflightPlannerEvidence(readyGate);
  assert(readyEvidence.version === 'business-skill-preflight-planner-evidence/v0', 'planner evidence should expose stable version', readyEvidence);
  assert(readyEvidence.plannerDisposition === 'can_continue_existing_execution', 'ready existing execution should map to continue disposition', readyEvidence);
  assert(readyEvidence.canContinueExistingExecution === true, 'ready evidence should allow existing executor continuation', readyEvidence);
  assert(readyEvidence.canClaimDesignQuality === false, 'planner evidence must not claim design quality', readyEvidence);
  assert(readyEvidence.mustNotChangeExecutor === true, 'planner evidence must be result evidence only', readyEvidence);
  assert(readyEvidence.resultEvidenceOnly === true, 'planner evidence must not be a runtime blocker', readyEvidence);

  const needsContextGate = buildBusinessSkillExecutionPreflightGate({
    skillId: 'main-image-design',
    requestKind: 'execute_existing',
    contextEvidence: { hasProjectContext: true }
  });
  const needsContextEvidence = buildBusinessSkillPreflightPlannerEvidence(needsContextGate);
  assert(needsContextEvidence.plannerDisposition === 'needs_context_before_quality_claim', 'needs_context should not be presented as design completion', needsContextEvidence);
  assert(needsContextEvidence.canContinueExistingExecution === false, 'missing context should not be treated as ready evidence', needsContextEvidence);
  assert(needsContextEvidence.requiredNextEvidence.includes('asset_index_required'), 'needs_context evidence should preserve required evidence', needsContextEvidence);

  const blockedGate = buildBusinessSkillExecutionPreflightGate({
    skillId: 'detail-page-design',
    requestKind: 'business_strategy',
    userCheckpointConfirmed: false,
    implementationEvidence: { rawImage: 'raw-image-payload' },
    contextEvidence: {}
  });
  const blockedEvidence = buildBusinessSkillPreflightPlannerEvidence(blockedGate);
  assert(blockedEvidence.plannerDisposition === 'blocked_before_strategy_change', 'blocked strategy gate should map to strategy block', blockedEvidence);
  assert(blockedEvidence.canChangeBusinessStrategy === false, 'blocked strategy gate must not permit business strategy change', blockedEvidence);
  assert(blockedEvidence.blockers.includes('user_checkpoint_required'), 'planner evidence should preserve user checkpoint blocker', blockedEvidence);

  const executorGate = buildBusinessSkillExecutionPreflightGateForSkill(
    'sku-batch',
    buildExecuteParams(buildProjectContext()),
    { success: true, message: 'ok', data: { designAgentOs: { version: 'fixture' }, skuPlan: { id: 'sku-fixture' } } }
  );
  const wrapped = attachBusinessSkillExecutionPreflightGateToResult(
    { success: true, message: 'ok', data: { existing: true } },
    executorGate
  );
  assert(wrapped.success === true, 'planner evidence attachment must preserve executor success');
  assert(wrapped.data.existing === true, 'planner evidence attachment must preserve existing data');
  assert(wrapped.data.businessSkillExecutionPreflightGate, 'wrapped result should keep raw preflight gate');
  assert(wrapped.data.businessSkillPreflightPlannerEvidence, 'wrapped result should include planner control evidence');
  assert(
    wrapped.data.businessSkillPreflightPlannerEvidence.plannerDisposition === 'can_continue_existing_execution',
    'wrapped planner evidence should be derived from gate',
    wrapped
  );

  const wrapperSource = read('src/renderer/services/skill-executors/business-skill-visual-evidence-gate.ts');
  assert(wrapperSource.includes('buildBusinessSkillPreflightPlannerEvidence'), 'skill wrapper should build planner evidence from execution preflight gate');
  assert(!/analyzeAssetContent\s*\(/.test(wrapperSource), 'planner evidence wrapper must not call visual analyzer');
  assert(!/writeProjectVisualInsightCache\s*\(/.test(wrapperSource), 'planner evidence wrapper must not write visual cache');
  assert(!wrapperSource.includes('executeToolCall'), 'planner evidence wrapper must not call Photoshop tools');

  assertPackageRegistration();
  [
    ['readyEvidence', readyEvidence],
    ['needsContextEvidence', needsContextEvidence],
    ['blockedEvidence', blockedEvidence],
    ['wrapped', wrapped],
    ['wrapperSource', wrapperSource]
  ].forEach(([label, value]) => {
    assertNoRawPayload(value, label);
    assertNoPseudoThinking(value, label);
  });

  console.log(JSON.stringify({
    success: true,
    checks: [
      'business skill preflight gate maps to planner/control evidence',
      'planner evidence cannot claim design quality',
      'needs_context and blocked gates preserve blockers and required evidence',
      'unified skill executor attaches planner evidence without changing result success',
      'planner evidence wrapper does not call models, cache writers or Photoshop tools'
    ]
  }, null, 2));
}

run();
