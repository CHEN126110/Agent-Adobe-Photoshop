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
  buildBusinessSkillExecutionIntake
} = require('../src/shared/business-skill-execution-intake.ts');
const {
  buildBusinessSkillVisualEvidencePreExecutionGate
} = require('../src/shared/business-skill-visual-evidence-pre-execution-gate.ts');
const {
  buildBusinessSkillExecutionPreflightGate
} = require('../src/shared/business-skill-execution-preflight-gate.ts');
const {
  buildBusinessSkillPreflightPlannerEvidence
} = require('../src/shared/business-skill-preflight-planner-evidence.ts');
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

function buildVisualSamplingPlan() {
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

function buildProjectContext(entriesWithInsight = 0) {
  return {
    projectPath: 'D:/demo',
    assetIndex: { summary: { totalImages: 2 }, visionCandidates: [] },
    visualSamplingPlan: buildVisualSamplingPlan(),
    visualInsightCache: {
      summary: {
        totalEntries: entriesWithInsight,
        entriesWithInsight,
        entriesWithRawPayloadRemoved: 0
      }
    }
  };
}

function buildExecuteParams(params = {}) {
  const toolEvents = [];
  return {
    toolEvents,
    params,
    callbacks: {
      onStep: (event) => toolEvents.push(event),
      onProgress: () => undefined,
      onMessage: () => undefined
    },
    context: {
      userInput: '帮我做 SKU',
      conversationHistory: [],
      isPluginConnected: true,
      projectContext: buildProjectContext()
    }
  };
}

function installVisualRuntime() {
  global.window = {
    designEcho: {
      analyzeAssetContent: async (imagePath) => ({
        success: true,
        analysis: {
          description: `袜子素材 ${path.basename(imagePath)}`,
          category: 'socks',
          mainSubject: 'socks',
          colors: ['white'],
          style: 'ecommerce',
          scene: 'product'
        }
      }),
      writeProjectVisualInsightCache: async () => ({ ok: true })
    }
  };
}

function uninstallVisualRuntime() {
  delete global.window;
}

function assertNoRawPayload(value, label) {
  const text = JSON.stringify(value);
  const forbidden = ['base64-image-payload', 'raw-image-payload', 'dataUrl', 'pixels', 'buffer'];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains raw image payload markers: ${found.join(', ')}`);
}

function assertNoPseudoThinking(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const forbidden = ['正在思考', '等待响应', '请求已发送', '正在准备', '稍等'];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains pseudo-thinking copy: ${found.join(', ')}`);
}

function assertPackageRegistration() {
  const packageJson = JSON.parse(read('package.json'));
  assert(
    packageJson.scripts?.['smoke:business-skill:execution-intake'] ===
      'node scripts/smoke-business-skill-execution-intake.cjs',
    'package.json should expose smoke:business-skill:execution-intake'
  );
  assert(
    String(packageJson.scripts?.['maintenance:preflight'] || '').includes('smoke:business-skill:execution-intake'),
    'maintenance:preflight should include business skill execution intake smoke'
  );
}

function runSharedHelperChecks() {
  const defaultPreGate = buildBusinessSkillVisualEvidencePreExecutionGate({
    skillId: 'sku-batch',
    projectPath: 'D:/demo',
    visualSamplingPlan: buildVisualSamplingPlan(),
    hasProjectContext: true,
    hasAssetIndex: true,
    hasVisualSamplingPlan: true,
    hasVisualUnderstanding: false
  });
  const defaultIntake = buildBusinessSkillExecutionIntake({
    skillId: 'sku-batch',
    stage: 'before_executor',
    preExecutionGate: defaultPreGate
  });
  assert(defaultIntake.decision === 'run_existing_executor_with_evidence_warning', 'default missing visual evidence should warn but allow execution', defaultIntake);
  assert(defaultIntake.canRunBusinessExecutor === true, 'default intake must allow business executor');
  assert(defaultIntake.shouldRunPreExecutionRefresh === false, 'default intake must not run visual refresh');
  assert(defaultIntake.canClaimDesignQuality === false, 'intake must not claim design quality');
  assert(defaultIntake.mustNotChangeBusinessStrategy === true, 'intake must not change business strategy');
  assert(defaultIntake.userVisible === false, 'intake must stay hidden diagnostic/control evidence');

  const strictPreGate = buildBusinessSkillVisualEvidencePreExecutionGate({
    skillId: 'sku-batch',
    projectPath: 'D:/demo',
    visualSamplingPlan: buildVisualSamplingPlan(),
    hasProjectContext: true,
    hasAssetIndex: true,
    hasVisualSamplingPlan: true,
    hasVisualUnderstanding: false,
    requireBeforeExecution: true
  });
  const strictIntake = buildBusinessSkillExecutionIntake({
    skillId: 'sku-batch',
    stage: 'before_executor',
    preExecutionGate: strictPreGate
  });
  assert(strictIntake.decision === 'blocked_by_strict_visual_evidence', 'strict missing visual evidence should block', strictIntake);
  assert(strictIntake.canRunBusinessExecutor === false, 'strict intake must not allow business executor');
  assert(strictIntake.blockers.includes('visual_understanding_required_before_execution'), 'strict intake should expose stable blocker');

  const refreshPreGate = buildBusinessSkillVisualEvidencePreExecutionGate({
    skillId: 'sku-batch',
    projectPath: 'D:/demo',
    visualSamplingPlan: buildVisualSamplingPlan(),
    hasProjectContext: true,
    hasAssetIndex: true,
    hasVisualSamplingPlan: true,
    hasVisualUnderstanding: false,
    enabled: true,
    runBeforeExecution: true,
    runtimeCanAnalyze: true,
    runtimeCanWriteCache: true
  });
  const refreshIntake = buildBusinessSkillExecutionIntake({
    skillId: 'sku-batch',
    stage: 'before_executor',
    preExecutionGate: refreshPreGate
  });
  assert(refreshIntake.decision === 'run_pre_execution_refresh_then_executor', 'explicit run-before should select refresh-then-executor', refreshIntake);
  assert(refreshIntake.shouldRunPreExecutionRefresh === true, 'refresh intake should request pre-execution refresh');

  const readyPreflightGate = buildBusinessSkillExecutionPreflightGate({
    skillId: 'sku-batch',
    requestKind: 'execute_existing',
    contextEvidence: {
      hasProjectContext: true,
      hasAssetIndex: true,
      hasVisualSamplingPlan: true,
      hasVisualUnderstanding: true,
      hasTemplateEvidence: true
    }
  });
  const plannerEvidence = buildBusinessSkillPreflightPlannerEvidence(readyPreflightGate);
  const readyIntake = buildBusinessSkillExecutionIntake({
    skillId: 'sku-batch',
    stage: 'after_executor',
    executionPreflightGate: readyPreflightGate,
    plannerEvidence
  });
  assert(readyIntake.decision === 'can_continue_existing_execution', 'ready planner evidence should continue existing execution', readyIntake);
  assert(readyIntake.requiredNextEvidence.length === 0, 'ready intake should not require more evidence');
}

async function runUnifiedExecutorChecks() {
  let executeCalls = 0;
  registerSkillExecutor({
    skillId: 'sku-batch',
    execute: async () => {
      executeCalls += 1;
      return {
        success: true,
        message: 'fixture sku executor result',
        data: {
          fixtureBusinessData: true,
          skuPlan: { id: 'fixture-sku-plan' }
        }
      };
    }
  });

  installVisualRuntime();
  const result = await executeSkillWithExecutor('sku-batch', buildExecuteParams({
    enableBusinessVisualEvidenceRefresh: true,
    runBusinessVisualEvidenceRefreshBeforeExecution: true,
    visualEvidenceRefreshRuntimeReady: true,
    visualEvidenceRefreshMaxCandidates: 2,
    rawImage: 'raw-image-payload'
  }));
  uninstallVisualRuntime();

  assert(executeCalls === 1, 'business executor should still run exactly once');
  assert(result.success === true, 'business execution intake must preserve result success', result);
  assert(result.data.fixtureBusinessData === true, 'business execution intake must preserve existing data');
  assert(result.data.businessSkillExecutionIntake, 'unified result should attach businessSkillExecutionIntake');
  assert(result.data.businessSkillExecutionIntake.decision === 'can_continue_existing_execution', 'final intake should reflect refreshed visual evidence and ready execution', result.data.businessSkillExecutionIntake);
  assert(result.data.businessSkillExecutionIntake.sourceEvidence.includes('pre_execution_gate'), 'intake should cite pre-execution gate source');
  assert(result.data.businessSkillExecutionIntake.sourceEvidence.includes('planner_evidence'), 'intake should cite planner evidence source');
  assert(result.data.businessSkillExecutionIntake.canClaimDesignQuality === false, 'intake must not claim design quality');
  assertNoRawPayload(result, 'executeSkillWithExecutor result');
  assertNoPseudoThinking(result, 'executeSkillWithExecutor result');
}

async function runStrictBlockWiringCheck() {
  let executeCalls = 0;
  registerSkillExecutor({
    skillId: 'sku-batch',
    execute: async () => {
      executeCalls += 1;
      return { success: true, message: 'should not run' };
    }
  });

  const result = await executeSkillWithExecutor('sku-batch', buildExecuteParams({
    requireBusinessVisualEvidenceBeforeExecution: true
  }));
  assert(executeCalls === 0, 'strict intake should block before executor');
  assert(result.success === false, 'strict intake should return failed result');
  assert(result.data.businessSkillExecutionIntake, 'strict blocked result should attach intake');
  assert(result.data.businessSkillExecutionIntake.decision === 'blocked_by_strict_visual_evidence', 'strict result should expose intake decision');
}

function runSourceChecks() {
  const intakeSource = read('src/shared/business-skill-execution-intake.ts');
  const wrapperSource = read('src/renderer/services/skill-executors/business-skill-visual-evidence-gate.ts');
  const indexSource = read('src/renderer/services/skill-executors/index.ts');
  const architectureSource = read('scripts/report-agent-architecture.cjs');
  const cockpitSource = read('scripts/report-project-cockpit.cjs');
  const changeBoundariesSource = read('scripts/report-change-boundaries.cjs');

  assert(intakeSource.includes('canClaimDesignQuality: false'), 'execution intake should deny quality claims');
  assert(intakeSource.includes('mustNotChangeBusinessStrategy: true'), 'execution intake should not change business strategy');
  assert(wrapperSource.includes('attachBusinessSkillExecutionIntakeToResult'), 'wrapper should expose intake attachment');
  assert(indexSource.includes('buildBusinessSkillExecutionIntakeForSkill'), 'unified executor should build intake');
  assert(architectureSource.includes('businessSkillExecutionIntake'), 'architecture report should expose intake');
  assert(cockpitSource.includes('businessSkillExecutionIntake'), 'project cockpit should expose intake');
  assert(changeBoundariesSource.includes('execution-intake'), 'change boundary report should classify intake');
}

async function run() {
  runSharedHelperChecks();
  await runUnifiedExecutorChecks();
  await runStrictBlockWiringCheck();
  runSourceChecks();
  assertPackageRegistration();

  console.log(JSON.stringify({
    success: true,
    checks: [
      'business skill execution intake summarizes pre-execution visual evidence and planner evidence',
      'default missing visual evidence warns but does not block existing business executor',
      'explicit run-before selects pre-execution refresh before executor',
      'strict missing visual evidence blocks only when explicitly required',
      'unified skill executor attaches redacted hidden intake evidence without changing business result'
    ]
  }, null, 2));
}

run().catch((error) => {
  uninstallVisualRuntime();
  console.error(error);
  process.exit(1);
});
