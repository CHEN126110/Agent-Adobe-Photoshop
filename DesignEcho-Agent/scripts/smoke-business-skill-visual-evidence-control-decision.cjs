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
  buildBusinessSkillVisualEvidenceRefreshPlan
} = require('../src/shared/business-skill-visual-evidence-refresh-plan.ts');
const {
  buildBusinessSkillVisualEvidenceControlDecision
} = require('../src/shared/business-skill-visual-evidence-control-decision.ts');
const {
  executeSkillWithExecutor,
  registerSkillExecutor
} = require('../src/renderer/services/skill-executors/index.ts');

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
  assert(found.length === 0, `${label} contains raw image payload markers: ${found.join(', ')}`);
}

function assertNoPseudoThinking(value, label) {
  const text = JSON.stringify(value);
  const forbidden = ['正在思考', '等待响应', '请求已发送', '正在准备', '稍等'];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains pseudo-thinking copy: ${found.join(', ')}`);
}

function buildCandidate(index) {
  return {
    assetId: `asset-${index}`,
    path: `D:/demo/source/sock-${index}.jpg`,
    role: 'raw-product-still',
    priority: 100 - index,
    score: 90 - index,
    reason: `fixture ${index}`,
    cacheKey: `project-visual:fixture-${index}`,
    cacheStatus: 'miss',
    shouldAnalyze: true,
    requiredEvidence: ['visual evidence required'],
    evidence: []
  };
}

function buildSamplingPlan() {
  return {
    planVersion: 'project-visual-sampling/v0',
    mode: 'bounded-metadata-plan',
    scenario: 'sku',
    maxCandidates: 2,
    selectedCandidates: [buildCandidate(1), buildCandidate(2)],
    skippedCandidateCount: 0,
    cacheSummary: { hit: 0, miss: 2, stale: 0, shouldAnalyze: 2 },
    warnings: [],
    limitations: [],
    evidence: []
  };
}

function buildPlannerEvidence({ hasVisualUnderstanding, requestKind = 'execute_existing', skillId = 'sku-batch' } = {}) {
  const gate = buildBusinessSkillExecutionPreflightGate({
    skillId,
    requestKind,
    userCheckpointConfirmed: requestKind === 'business_strategy',
    contextEvidence: {
      hasProjectContext: true,
      hasAssetIndex: true,
      hasVisualSamplingPlan: true,
      hasVisualUnderstanding: hasVisualUnderstanding === true,
      hasTemplateEvidence: true
    }
  });
  return buildBusinessSkillPreflightPlannerEvidence(gate);
}

function buildRefreshPlan(plannerEvidence, overrides = {}) {
  return buildBusinessSkillVisualEvidenceRefreshPlan({
    skillId: plannerEvidence.skillId,
    plannerEvidence,
    projectPath: 'D:/demo',
    visualSamplingPlan: buildSamplingPlan(),
    enabled: overrides.enabled,
    runtimeCanAnalyze: overrides.runtimeCanAnalyze,
    runtimeCanWriteCache: overrides.runtimeCanWriteCache,
    maxCandidates: 2
  });
}

function installVisualRuntime(counters) {
  global.window = {
    designEcho: {
      analyzeAssetContent: async () => {
        counters.analyzeCalls += 1;
        return {
          success: true,
          analysis: {
            description: '袜子素材 fixture',
            category: 'socks',
            mainSubject: 'socks',
            colors: ['white'],
            style: 'ecommerce',
            scene: 'product'
          }
        };
      },
      writeProjectVisualInsightCache: async (options) => {
        counters.writeCalls += 1;
        counters.writtenEntryCount += Array.isArray(options?.entries) ? options.entries.length : 0;
        return { ok: true };
      }
    }
  };
}

function uninstallVisualRuntime() {
  delete global.window;
}

function buildExecuteParams(params = {}) {
  return {
    params: {
      enableBusinessVisualEvidenceRefresh: true,
      runBusinessVisualEvidenceRefresh: true,
      visualEvidenceRefreshMaxCandidates: 2,
      ...params
    },
    callbacks: {
      onStep: () => undefined,
      onProgress: () => undefined,
      onMessage: () => undefined
    },
    context: {
      userInput: '帮我做 SKU',
      conversationHistory: [],
      isPluginConnected: true,
      projectContext: {
        projectPath: 'D:/demo',
        assetIndex: { summary: { totalImages: 2 }, visionCandidates: [] },
        visualSamplingPlan: buildSamplingPlan(),
        visualInsightCache: {
          summary: { totalEntries: 0, entriesWithInsight: 0, entriesWithRawPayloadRemoved: 0 }
        }
      }
    }
  };
}

async function run() {
  const visualReadyEvidence = buildPlannerEvidence({ hasVisualUnderstanding: true });
  const visualReadyPlan = buildRefreshPlan(visualReadyEvidence, { enabled: true, runtimeCanAnalyze: true, runtimeCanWriteCache: true });
  const visualReadyDecision = buildBusinessSkillVisualEvidenceControlDecision({
    plannerEvidence: visualReadyEvidence,
    refreshPlan: visualReadyPlan
  });
  assert(visualReadyDecision.version === 'business-skill-visual-evidence-control-decision/v0', 'decision should expose stable version');
  assert(visualReadyDecision.decision === 'can_continue_existing_execution', 'ready visual evidence should continue existing execution', visualReadyDecision);
  assert(visualReadyDecision.canContinueExistingExecution === true, 'ready visual evidence should not block existing executor', visualReadyDecision);
  assert(visualReadyDecision.canClaimDesignQuality === false, 'decision must never claim business design quality', visualReadyDecision);

  const missingEvidence = buildPlannerEvidence({ hasVisualUnderstanding: false });
  const blockedPlan = buildRefreshPlan(missingEvidence, { enabled: true, runtimeCanAnalyze: false, runtimeCanWriteCache: false });
  const needsVisualDecision = buildBusinessSkillVisualEvidenceControlDecision({
    plannerEvidence: missingEvidence,
    refreshPlan: blockedPlan
  });
  assert(needsVisualDecision.decision === 'needs_visual_evidence_before_quality_claim', 'runtime gap should ask for visual evidence before quality claim', needsVisualDecision);
  assert(needsVisualDecision.shouldAskForVisualEvidence === true, 'runtime gap should request visual evidence', needsVisualDecision);
  assert(needsVisualDecision.canContinueExistingExecution === false, 'missing visual evidence should not be marked ready', needsVisualDecision);

  const readyPlan = buildRefreshPlan(missingEvidence, { enabled: true, runtimeCanAnalyze: true, runtimeCanWriteCache: true });
  const readyRefreshDecision = buildBusinessSkillVisualEvidenceControlDecision({
    plannerEvidence: missingEvidence,
    refreshPlan: readyPlan
  });
  assert(readyRefreshDecision.decision === 'refresh_ready_after_explicit_opt_in', 'ready refresh plan should be explicit opt-in decision', readyRefreshDecision);
  assert(readyRefreshDecision.shouldRunRefreshForFutureExecution === true, 'ready refresh plan should request future refresh run', readyRefreshDecision);

  const completedDecision = buildBusinessSkillVisualEvidenceControlDecision({
    plannerEvidence: missingEvidence,
    refreshPlan: readyPlan,
    refreshRun: {
      version: 'business-skill-visual-evidence-refresh-run/v0',
      status: 'completed',
      attempted: true,
      planStatus: 'ready',
      analyzedCount: 2,
      successCount: 2,
      failedCount: 0,
      writtenEntryCount: 2,
      warnings: [],
      limitations: [],
      evidence: []
    }
  });
  assert(completedDecision.decision === 'refresh_completed_after_execution', 'successful refresh run should be visible as completed evidence', completedDecision);
  assert(completedDecision.visualEvidenceRefreshed === true, 'successful refresh should mark visual evidence refreshed for future runs', completedDecision);

  const failedDecision = buildBusinessSkillVisualEvidenceControlDecision({
    plannerEvidence: missingEvidence,
    refreshPlan: readyPlan,
    refreshRun: {
      version: 'business-skill-visual-evidence-refresh-run/v0',
      status: 'failed',
      attempted: true,
      planStatus: 'ready',
      analyzedCount: 0,
      successCount: 0,
      failedCount: 0,
      writtenEntryCount: 0,
      warnings: ['fixture failure'],
      limitations: [],
      evidence: [],
      error: 'fixture failure'
    }
  });
  assert(failedDecision.decision === 'refresh_failed_evidence_only', 'failed refresh must remain evidence-only', failedDecision);
  assert(failedDecision.canContinueExistingExecution === false, 'failed refresh should not become ready evidence', failedDecision);

  const blockedStrategy = buildPlannerEvidence({
    hasVisualUnderstanding: false,
    requestKind: 'business_strategy',
    skillId: 'detail-page-design'
  });
  const blockedDecision = buildBusinessSkillVisualEvidenceControlDecision({ plannerEvidence: blockedStrategy });
  assert(blockedDecision.decision === 'blocked_before_strategy_change', 'strategy changes should remain blocked without checkpoint', blockedDecision);
  assert(blockedDecision.mustNotChangeExecutor === true, 'decision must not allow executor mutation', blockedDecision);

  const counters = { analyzeCalls: 0, writeCalls: 0, writtenEntryCount: 0 };
  registerSkillExecutor({
    skillId: 'sku-batch',
    execute: async () => ({
      success: true,
      message: 'fixture sku executor result',
      data: {
        fixtureBusinessData: true,
        skuPlan: { id: 'fixture-sku-plan' }
      }
    })
  });

  installVisualRuntime(counters);
  const executorResult = await executeSkillWithExecutor('sku-batch', buildExecuteParams());
  uninstallVisualRuntime();
  const executorDecision = executorResult.data.businessSkillVisualEvidenceControlDecision;
  assert(executorResult.success === true, 'control decision must preserve executor result success', executorResult);
  assert(executorDecision, 'unified executor should attach businessSkillVisualEvidenceControlDecision', executorResult);
  assert(executorDecision.decision === 'refresh_completed_after_execution', 'unified executor should expose completed refresh decision', executorDecision);
  assert(executorDecision.canClaimDesignQuality === false, 'unified executor decision must not claim design quality', executorDecision);
  assert(executorDecision.resultEvidenceOnly === true, 'unified executor decision must remain result-only evidence', executorDecision);

  const packageJson = JSON.parse(read('package.json'));
  assert(
    packageJson.scripts?.['smoke:business-skill:visual-evidence-control-decision'] ===
      'node scripts/smoke-business-skill-visual-evidence-control-decision.cjs',
    'package.json should expose smoke:business-skill:visual-evidence-control-decision'
  );
  assert(
    String(packageJson.scripts?.['maintenance:preflight'] || '').includes('smoke:business-skill:visual-evidence-control-decision'),
    'maintenance:preflight should include control decision smoke'
  );

  const wrapperSource = read('src/renderer/services/skill-executors/business-skill-visual-evidence-gate.ts');
  assert(wrapperSource.includes('attachBusinessSkillVisualEvidenceControlDecisionToResult'), 'skill wrapper should attach visual evidence control decision');

  [
    ['visualReadyDecision', visualReadyDecision],
    ['needsVisualDecision', needsVisualDecision],
    ['readyRefreshDecision', readyRefreshDecision],
    ['completedDecision', completedDecision],
    ['failedDecision', failedDecision],
    ['blockedDecision', blockedDecision],
    ['executorResult', executorResult]
  ].forEach(([label, value]) => {
    assertNoRawPayload(value, label);
    assertNoPseudoThinking(value, label);
  });

  console.log(JSON.stringify({
    success: true,
    checks: [
      'visual evidence control decision normalizes planner, refresh plan and refresh run states',
      'decision remains evidence-only and cannot claim design quality',
      'unified skill executor attaches the decision without changing business result success',
      'control decision contains no raw image payload or pseudo-thinking copy'
    ]
  }, null, 2));
}

run().catch((error) => {
  uninstallVisualRuntime();
  console.error(error);
  process.exit(1);
});
