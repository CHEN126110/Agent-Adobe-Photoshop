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
  runBusinessSkillVisualEvidenceRefreshAfterExecution
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

function buildCandidate(index) {
  return {
    assetId: `asset-${index}`,
    path: `D:/demo/source/sock-${index}.jpg`,
    role: 'raw-product-still',
    priority: 90 - index,
    score: 100 - index,
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
    maxCandidates: 3,
    selectedCandidates: [
      buildCandidate(1),
      buildCandidate(2)
    ],
    skippedCandidateCount: 0,
    cacheSummary: { hit: 0, miss: 2, stale: 0, shouldAnalyze: 2 },
    warnings: [],
    limitations: [],
    evidence: []
  };
}

function buildExecuteParams(params = {}) {
  return {
    params,
    context: {
      userInput: '帮我做 SKU',
      conversationHistory: [],
      isPluginConnected: true,
      projectContext: {
        projectPath: 'D:/demo',
        assetIndex: { summary: { totalImages: 2 }, visionCandidates: [] },
        visualSamplingPlan: buildVisualSamplingPlan(),
        visualInsightCache: {
          summary: { totalEntries: 0, entriesWithInsight: 0, entriesWithRawPayloadRemoved: 0 }
        }
      }
    }
  };
}

function buildGate() {
  return buildBusinessSkillExecutionPreflightGate({
    skillId: 'sku-batch',
    requestKind: 'execute_existing',
    contextEvidence: {
      hasProjectContext: true,
      hasAssetIndex: true,
      hasVisualSamplingPlan: true,
      hasTemplateEvidence: true
    }
  });
}

function assertNoRawPayload(value, label) {
  const text = JSON.stringify(value);
  const forbidden = ['base64-image-payload', 'raw-image-payload', 'dataUrl', 'pixels', 'buffer', 'analysis'];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains raw or model payload markers: ${found.join(', ')}`);
}

async function run() {
  let callCount = 0;
  const fakeRunCacheFill = async (input) => {
    callCount += 1;
    assert(input.enabled === true, 'runner should call cache fill with explicit enabled=true');
    assert(input.maxCandidates === 2, 'runner should pass bounded candidate count');
    return {
      status: 'partial',
      analyzedCount: 2,
      successCount: 1,
      failedCount: 1,
      entries: [{ cacheKey: 'redacted-entry' }],
      warnings: ['one candidate failed'],
      limitations: ['summary only'],
      evidence: [{
        source: 'project-visual-insight-cache-fill',
        summary: 'fixture cache fill',
        status: 'needs_review'
      }]
    };
  };

  const baseResult = { success: true, message: 'business result', data: { existing: true } };
  const gate = buildGate();

  const disabled = await runBusinessSkillVisualEvidenceRefreshAfterExecution(
    baseResult,
    gate,
    buildExecuteParams({
      enableBusinessVisualEvidenceRefresh: true,
      visualEvidenceRefreshRuntimeReady: true,
      visualEvidenceRefreshMaxCandidates: 2
    }),
    { runCacheFill: fakeRunCacheFill }
  );
  assert(callCount === 0, 'runner must not execute without runBusinessVisualEvidenceRefresh');
  assert(disabled.success === true && disabled.data.existing === true, 'disabled runner must preserve original result');
  assert(disabled.data.businessSkillVisualEvidenceRefreshRun.status === 'skipped_runner_disabled', 'disabled runner should expose skipped status');

  const executed = await runBusinessSkillVisualEvidenceRefreshAfterExecution(
    baseResult,
    gate,
    buildExecuteParams({
      enableBusinessVisualEvidenceRefresh: true,
      runBusinessVisualEvidenceRefresh: true,
      visualEvidenceRefreshRuntimeReady: true,
      visualEvidenceRefreshMaxCandidates: 2
    }),
    { runCacheFill: fakeRunCacheFill }
  );
  assert(callCount === 1, 'explicit runner opt-in should call cache fill exactly once');
  assert(executed.success === true && executed.message === 'business result', 'runner must preserve business result status and message');
  assert(executed.data.existing === true, 'runner must preserve existing data');
  assert(executed.data.businessSkillVisualEvidenceRefreshPlan.status === 'ready', 'runner should attach the ready refresh plan');
  assert(executed.data.businessSkillVisualEvidenceRefreshRun.status === 'partial', 'runner should attach redacted run summary');
  assert(executed.data.businessSkillVisualEvidenceRefreshRun.successCount === 1, 'runner summary should include success count');
  assert(!executed.data.businessSkillVisualEvidenceRefreshRun.entries, 'runner summary must not expose cache entries');

  const failed = await runBusinessSkillVisualEvidenceRefreshAfterExecution(
    baseResult,
    gate,
    buildExecuteParams({
      enableBusinessVisualEvidenceRefresh: true,
      runBusinessVisualEvidenceRefresh: true,
      visualEvidenceRefreshRuntimeReady: true
    }),
    { runCacheFill: async () => { throw new Error('provider quota exceeded'); } }
  );
  assert(failed.success === true, 'runner failure must not flip business result success');
  assert(failed.data.businessSkillVisualEvidenceRefreshRun.status === 'failed', 'runner failure should be recorded as failed evidence');
  assert(String(failed.data.businessSkillVisualEvidenceRefreshRun.error || '').includes('provider quota exceeded'), 'runner failure should expose concise error text');

  const indexSource = read('src/renderer/services/skill-executors/index.ts');
  const executorCallIndex = indexSource.indexOf('await executor.execute(executeParams)');
  const runnerCallIndex = indexSource.indexOf('await runBusinessSkillVisualEvidenceRefreshAfterExecution');
  assert(runnerCallIndex > executorCallIndex, 'visual evidence refresh runner must run after the business executor');

  const packageJson = JSON.parse(read('package.json'));
  assert(
    packageJson.scripts?.['smoke:business-skill:visual-evidence-refresh-runner'] ===
      'node scripts/smoke-business-skill-visual-evidence-refresh-runner.cjs',
    'package.json should expose smoke:business-skill:visual-evidence-refresh-runner'
  );
  assert(
    String(packageJson.scripts?.['maintenance:preflight'] || '').includes('smoke:business-skill:visual-evidence-refresh-runner'),
    'maintenance:preflight should include visual evidence refresh runner smoke'
  );

  [
    ['disabled', disabled],
    ['executed', executed],
    ['failed', failed]
  ].forEach(([label, value]) => assertNoRawPayload(value, label));

  console.log(JSON.stringify({
    success: true,
    checks: [
      'runner stays skipped unless a second explicit run flag is present',
      'runner executes only after the business executor and preserves business result',
      'runner writes only redacted summary evidence to result data',
      'runner failures are evidence-only and do not flip business success'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
