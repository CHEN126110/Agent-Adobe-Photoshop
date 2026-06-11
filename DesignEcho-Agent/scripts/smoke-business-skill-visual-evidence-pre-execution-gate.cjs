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
  buildBusinessSkillVisualEvidencePreExecutionGate
} = require('../src/shared/business-skill-visual-evidence-pre-execution-gate.ts');
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

function buildVisualSamplingPlan(scenario = 'sku') {
  return {
    planVersion: 'project-visual-sampling/v0',
    mode: 'bounded-metadata-plan',
    scenario,
    maxCandidates: 2,
    selectedCandidates: [buildCandidate(1), buildCandidate(2)],
    skippedCandidateCount: 0,
    cacheSummary: { hit: 0, miss: 2, stale: 0, shouldAnalyze: 2 },
    warnings: [],
    limitations: [],
    evidence: []
  };
}

function buildProjectContext(options = {}) {
  const entriesWithInsight = options.entriesWithInsight || 0;
  const scenario = options.scenario || 'sku';
  return {
    projectPath: 'D:/demo',
    assetIndex: { summary: { totalImages: 2 }, visionCandidates: [] },
    visualSamplingPlan: buildVisualSamplingPlan(scenario),
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

function installVisualRuntime(counters, order) {
  global.window = {
    designEcho: {
      buildProjectContextSnapshot: async (options) => {
        counters.snapshotCalls += 1;
        counters.snapshotScenario = options?.visualSamplingScenario;
        order.push(`snapshot:${options?.visualSamplingScenario}`);
        const visualSamplingPlan = buildVisualSamplingPlan(options?.visualSamplingScenario);
        const visualInsightCache = {
          summary: {
            totalEntries: 0,
            entriesWithInsight: 0,
            entriesWithRawPayloadRemoved: 0
          }
        };
        return {
          success: true,
          source: 'runtime-project-service',
          projectPath: options?.projectPath || 'D:/demo',
          projectName: options?.projectName || 'demo',
          assetIndex: { summary: { totalImages: 2 }, visionCandidates: [] },
          visualSamplingPlan,
          visualInsightCache,
          contextSnapshot: {
            snapshotVersion: 'context-snapshot/v0',
            project: { path: options?.projectPath || 'D:/demo', name: options?.projectName || 'demo' },
            selectedAssetPaths: options?.selectedAssetPaths || [],
            userConstraints: [],
            taskHistory: [],
            unverifiedItems: [],
            visualSamplingPlan,
            visualInsightCache,
            readiness: { status: 'needs_review' },
            warnings: [],
            limitations: [],
            evidence: []
          },
          warnings: [],
          limitations: []
        };
      },
      analyzeAssetContent: async (imagePath) => {
        counters.analyzeCalls += 1;
        order.push(`analyze:${path.basename(imagePath)}`);
        return {
          success: true,
          analysis: {
            description: `袜子素材 ${path.basename(imagePath)}`,
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
        order.push('write-cache');
        return { ok: true };
      }
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
  assert(found.length === 0, `${label} contains raw or model payload markers: ${found.join(', ')}`);
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
    packageJson.scripts?.['smoke:business-skill:visual-evidence-pre-execution-gate'] ===
      'node scripts/smoke-business-skill-visual-evidence-pre-execution-gate.cjs',
    'package.json should expose smoke:business-skill:visual-evidence-pre-execution-gate'
  );
  assert(
    String(packageJson.scripts?.['maintenance:preflight'] || '').includes('smoke:business-skill:visual-evidence-pre-execution-gate'),
    'maintenance:preflight should include pre-execution visual evidence smoke'
  );
}

async function runSharedGateChecks() {
  const defaultGate = buildBusinessSkillVisualEvidencePreExecutionGate({
    skillId: 'sku-batch',
    projectPath: 'D:/demo',
    visualSamplingPlan: buildVisualSamplingPlan(),
    hasProjectContext: true,
    hasAssetIndex: true,
    hasVisualSamplingPlan: true,
    hasVisualUnderstanding: false
  });
  assert(defaultGate.status === 'needs_visual_evidence', 'default missing visual evidence should be evidence-only', defaultGate);
  assert(defaultGate.canRunBusinessExecutor === true, 'default gate must not block existing business skill execution');
  assert(defaultGate.shouldRunRefreshBeforeExecution === false, 'default gate must not run refresh without explicit opt-in');
  assert(defaultGate.canClaimDesignQuality === false, 'pre-execution gate must not claim design quality');

  const strictBlocked = buildBusinessSkillVisualEvidencePreExecutionGate({
    skillId: 'sku-batch',
    projectPath: 'D:/demo',
    visualSamplingPlan: buildVisualSamplingPlan(),
    hasProjectContext: true,
    hasAssetIndex: true,
    hasVisualSamplingPlan: true,
    hasVisualUnderstanding: false,
    requireBeforeExecution: true
  });
  assert(strictBlocked.status === 'blocked_strict_missing_visual_evidence', 'strict missing evidence should block', strictBlocked);
  assert(strictBlocked.canRunBusinessExecutor === false, 'strict missing evidence should not run business executor');

  const runBefore = buildBusinessSkillVisualEvidencePreExecutionGate({
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
    runtimeCanWriteCache: true,
    maxCandidates: 2
  });
  assert(runBefore.status === 'refresh_ready_before_execution', 'explicit run-before should prepare refresh', runBefore);
  assert(runBefore.shouldRunRefreshBeforeExecution === true, 'explicit run-before should be runnable');
  assert(runBefore.refreshPlan?.status === 'ready', 'explicit run-before should include ready fill plan');

  const ready = buildBusinessSkillVisualEvidencePreExecutionGate({
    skillId: 'sku-batch',
    projectPath: 'D:/demo',
    visualSamplingPlan: buildVisualSamplingPlan(),
    hasProjectContext: true,
    hasAssetIndex: true,
    hasVisualSamplingPlan: true,
    hasVisualUnderstanding: true,
    enabled: true,
    runBeforeExecution: true,
    runtimeCanAnalyze: true,
    runtimeCanWriteCache: true
  });
  assert(ready.status === 'ready_existing_visual_evidence', 'existing visual understanding should be ready', ready);
  assert(ready.shouldRunRefreshBeforeExecution === false, 'existing visual evidence should not refresh again by default');

  const scenarioMismatch = buildBusinessSkillVisualEvidencePreExecutionGate({
    skillId: 'detail-page-design',
    projectPath: 'D:/demo',
    visualSamplingPlan: buildVisualSamplingPlan('general-design'),
    expectedVisualSamplingScenario: 'detail-page',
    hasProjectContext: true,
    hasAssetIndex: true,
    hasVisualSamplingPlan: true,
    hasVisualUnderstanding: true
  });
  assert(scenarioMismatch.status === 'needs_visual_evidence', 'visual evidence from a mismatched scenario must not be treated as ready', scenarioMismatch);
  assert(
    scenarioMismatch.requiredNextEvidence.includes('visual_sampling_scenario_match_required'),
    'scenario mismatch should require a skill-specific visual sampling plan',
    scenarioMismatch
  );
  assert(
    scenarioMismatch.warnings.some((item) => item.includes('VisualSamplingPlan scenario')),
    'scenario mismatch should be diagnosable in gate warnings',
    scenarioMismatch
  );

  const strictScenarioMismatch = buildBusinessSkillVisualEvidencePreExecutionGate({
    skillId: 'main-image-design',
    projectPath: 'D:/demo',
    visualSamplingPlan: buildVisualSamplingPlan('general-design'),
    expectedVisualSamplingScenario: 'main-image',
    hasProjectContext: true,
    hasAssetIndex: true,
    hasVisualSamplingPlan: true,
    hasVisualUnderstanding: true,
    requireBeforeExecution: true
  });
  assert(strictScenarioMismatch.status === 'blocked_strict_missing_visual_evidence', 'strict scenario mismatch should block before execution', strictScenarioMismatch);
  assert(
    strictScenarioMismatch.blockers.includes('visual_sampling_scenario_mismatch'),
    'strict scenario mismatch should expose a stable blocker',
    strictScenarioMismatch
  );
}

async function runUnifiedExecutorChecks() {
  const counters = {
    executeCalls: 0,
    snapshotCalls: 0,
    snapshotScenario: undefined,
    analyzeCalls: 0,
    writeCalls: 0,
    writtenEntryCount: 0
  };
  const order = [];

  registerSkillExecutor({
    skillId: 'sku-batch',
    execute: async (params) => {
      counters.executeCalls += 1;
      order.push('executor');
      const entriesWithInsight = params.context?.projectContext?.visualInsightCache?.summary?.entriesWithInsight;
      assert(entriesWithInsight === 2, 'pre-execution refresh should update readonly project context before business executor', params.context?.projectContext);
      assert(
        params.context?.projectContext?.visualSamplingPlan?.scenario === 'sku',
        'unified executor should refresh generic context into the skill-specific visual sampling scenario before business executor',
        params.context?.projectContext?.visualSamplingPlan
      );
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

  installVisualRuntime(counters, order);
  const executeParams = buildExecuteParams({
    enableBusinessVisualEvidenceRefresh: true,
    runBusinessVisualEvidenceRefreshBeforeExecution: true,
    visualEvidenceRefreshRuntimeReady: true,
    visualEvidenceRefreshMaxCandidates: 2,
    rawImage: 'raw-image-payload'
  });
  executeParams.context.projectContext = buildProjectContext({ scenario: 'general-design' });
  const result = await executeSkillWithExecutor('sku-batch', executeParams);
  uninstallVisualRuntime();

  assert(counters.snapshotCalls === 1, 'unified executor should request one scenario-specific readonly context snapshot');
  assert(counters.snapshotScenario === 'sku', 'unified executor should request sku visualSamplingScenario', counters);
  assert(counters.executeCalls === 1, 'business executor should run exactly once');
  assert(counters.analyzeCalls === 2, 'pre-execution runner should analyze bounded candidates before business executor');
  assert(counters.writeCalls === 1, 'pre-execution runner should write visual cache once');
  assert(counters.writtenEntryCount === 2, 'pre-execution runner should write bounded cache entries');
  assert(order.indexOf('write-cache') >= 0 && order.indexOf('executor') > order.indexOf('write-cache'), 'visual refresh should finish before business executor', order);
  assert(order.indexOf('snapshot:sku') >= 0 && order.indexOf('analyze:sock-1.jpg') > order.indexOf('snapshot:sku'), 'scenario-specific snapshot should be prepared before visual refresh', order);
  assert(result.success === true, 'pre-execution evidence must preserve business success', result);
  assert(result.message === 'fixture sku executor result', 'pre-execution evidence must preserve business message', result);
  assert(result.data.fixtureBusinessData === true, 'pre-execution evidence must preserve business data');
  assert(result.data.businessSkillVisualEvidencePreExecutionGate.status === 'refresh_ready_before_execution', 'result should attach pre-execution gate');
  assert(result.data.businessSkillVisualEvidencePreExecutionRun.status === 'completed', 'result should attach pre-execution run summary');
  assert(result.data.businessSkillExecutionPreflightGate.status === 'ready_for_existing_execution', 'pre-execution refresh should satisfy existing execution preflight');
  assertNoRawPayload(result, 'executeSkillWithExecutor result');
  assertNoPseudoThinking(result, 'executeSkillWithExecutor result');
}

async function runStrictBlockingCheck() {
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
  assert(executeCalls === 0, 'strict missing visual evidence should block before business executor');
  assert(result.success === false, 'strict missing visual evidence should return a failed skill result');
  assert(result.error === 'business_visual_evidence_required_before_execution', 'strict block should expose stable error code', result);
  assert(result.data.businessSkillVisualEvidencePreExecutionGate.status === 'blocked_strict_missing_visual_evidence', 'strict block should attach gate evidence');
}

function runSourceChecks() {
  const sharedSource = read('src/shared/business-skill-visual-evidence-pre-execution-gate.ts');
  const contextSource = read('src/renderer/services/agent-orchestration/context.ts');
  const wrapperSource = read('src/renderer/services/skill-executors/business-skill-visual-evidence-gate.ts');
  const indexSource = read('src/renderer/services/skill-executors/index.ts');
  const changeBoundariesSource = read('scripts/report-change-boundaries.cjs');
  const architectureSource = read('scripts/report-agent-architecture.cjs');
  const cockpitSource = read('scripts/report-project-cockpit.cjs');

  assert(sharedSource.includes('canClaimDesignQuality: false'), 'shared gate should permanently deny quality claims');
  assert(contextSource.includes('visualSamplingScenario'), 'project context builder should accept visualSamplingScenario');
  assert(contextSource.includes('visualSamplingScenario ||'), 'project context builder should default scenario only at the boundary');
  assert(wrapperSource.includes('buildBusinessSkillVisualEvidencePreExecutionGate'), 'wrapper should build pre-execution gate');
  assert(wrapperSource.includes('getBusinessVisualEvidenceScenarioForSkill'), 'wrapper should expose skill-to-visual-sampling scenario resolution');
  assert(wrapperSource.includes('prepareBusinessSkillProjectContextForScenario'), 'wrapper should prepare skill-specific project context before gates');
  assert(wrapperSource.includes('runBusinessSkillVisualEvidenceRefreshBeforeExecution'), 'wrapper should expose pre-execution runner');
  assert(indexSource.includes('prepareBusinessSkillProjectContextForScenario'), 'unified executor should prepare scenario-specific project context before business gates');
  assert(indexSource.includes('runBusinessSkillVisualEvidenceRefreshBeforeExecution'), 'unified executor should run pre-execution visual evidence');
  assert(indexSource.includes('attachBusinessSkillVisualEvidencePreExecutionToResult'), 'unified executor should attach pre-execution evidence');
  assert(changeBoundariesSource.includes('visual-evidence-pre-execution-gate'), 'change boundary report should know pre-execution gate');
  assert(architectureSource.includes('businessSkillVisualEvidencePreExecutionGate'), 'architecture report should expose pre-execution gate');
  assert(cockpitSource.includes('businessSkillVisualEvidencePreExecutionGate'), 'project cockpit should expose pre-execution gate');
}

async function run() {
  await runSharedGateChecks();
  await runUnifiedExecutorChecks();
  await runStrictBlockingCheck();
  runSourceChecks();
  assertPackageRegistration();

  console.log(JSON.stringify({
    success: true,
    checks: [
      'pre-execution visual evidence gate is evidence-only and non-blocking by default',
      'strict missing visual evidence blocks only after explicit strict opt-in',
      'explicit run-before refresh updates readonly context before business executor',
      'unified skill executor preserves business result and attaches redacted evidence',
      'maintenance reports and preflight expose the new gate'
    ]
  }, null, 2));
}

run().catch((error) => {
  uninstallVisualRuntime();
  console.error(error);
  process.exit(1);
});
