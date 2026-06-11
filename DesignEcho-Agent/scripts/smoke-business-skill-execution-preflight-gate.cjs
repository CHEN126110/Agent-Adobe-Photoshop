#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

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

const ROOT = path.resolve(__dirname, '..');

const {
  BUSINESS_SKILL_EXECUTION_PREFLIGHT_SKILL_IDS,
  buildBusinessSkillExecutionPreflightGate
} = require('../src/shared/business-skill-execution-preflight-gate.ts');

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function read(relativePath) {
  const filePath = path.join(ROOT, relativePath);
  assert(fs.existsSync(filePath), `${relativePath} is missing`);
  return fs.readFileSync(filePath, 'utf8');
}

function readPackageJson() {
  return JSON.parse(read('package.json'));
}

function assertNoRawPayload(value, label) {
  const serialized = JSON.stringify(value);
  assert(!serialized.includes('raw-image-payload'), `${label} must not keep raw image payload`, value);
  assert(!serialized.includes('base64-image-payload'), `${label} must not keep base64 image payload`, value);
}

function buildFullEvidence() {
  return {
    designStandards: true,
    knowledgeRecipeSource: true,
    visualEvidencePlan: true,
    photoshopToolPlan: true,
    qaAcceptancePlan: true,
    performanceBudget: true
  };
}

function assertSkillCoverage() {
  assert(
    BUSINESS_SKILL_EXECUTION_PREFLIGHT_SKILL_IDS.join(',') === 'main-image-design,detail-page-design,sku-batch',
    'execution preflight gate must cover the three business design skills only',
    BUSINESS_SKILL_EXECUTION_PREFLIGHT_SKILL_IDS
  );
}

function assertStrategyChangesAreBlockedWithoutCheckpoint(skillId) {
  const gate = buildBusinessSkillExecutionPreflightGate({
    skillId,
    requestKind: 'business_strategy',
    userCheckpointConfirmed: false,
    implementationEvidence: {
      fexBenchmarkOnly: true,
      rawImage: 'raw-image-payload',
      imageData: 'base64-image-payload'
    },
    contextEvidence: {}
  });

  assert(gate.status === 'blocked', `${skillId} strategy changes should block without user checkpoint`, gate);
  assert(gate.canChangeBusinessStrategy === false, `${skillId} must not allow strategy changes`, gate);
  assert(gate.blockers.includes('user_checkpoint_required'), `${skillId} should require user checkpoint`, gate);
  assert(
    gate.blockers.includes('required_business_skill_evidence_missing'),
    `${skillId} should require implementation evidence`,
    gate
  );
  assert(
    gate.warnings.includes('fex_benchmark_is_not_business_strategy_evidence'),
    `${skillId} should not accept FEX as strategy evidence`,
    gate
  );
  assert(
    gate.claimBoundary.includes('does_not_prove_business_skill_design_quality'),
    `${skillId} should expose quality claim boundary`,
    gate
  );
  assertNoRawPayload(gate, `${skillId} blocked gate`);
}

function assertInfraOnlyIsAllowedWithoutStrategyPermission(skillId) {
  const gate = buildBusinessSkillExecutionPreflightGate({
    skillId,
    requestKind: 'infra_evidence',
    userCheckpointConfirmed: false,
    implementationEvidence: {
      toolOnlyPanelFeature: true
    },
    contextEvidence: {}
  });

  assert(gate.status === 'ready_for_infra_only', `${skillId} infra evidence should be allowed`, gate);
  assert(gate.canChangeBusinessStrategy === false, `${skillId} infra gate must not allow strategy changes`, gate);
  assert(
    gate.allowedActions.includes('attach_readonly_evidence'),
    `${skillId} infra gate should allow readonly evidence attachment`,
    gate
  );
  assert(
    gate.warnings.includes('tool_only_panel_feature_is_not_agent_skill_strategy_evidence'),
    `${skillId} should preserve panel tool vs Agent skill boundary`,
    gate
  );
}

function assertStrategyReadyRequiresAllEvidence(skillId) {
  const gate = buildBusinessSkillExecutionPreflightGate({
    skillId,
    requestKind: 'business_strategy',
    userCheckpointConfirmed: true,
    implementationEvidence: buildFullEvidence(),
    contextEvidence: {
      hasProjectContext: true,
      hasAssetIndex: true,
      hasVisualSamplingPlan: true,
      hasVisualUnderstanding: true,
      hasTemplateEvidence: true
    },
    acceptance: {
      mode: 'desktop-fake-photoshop'
    }
  });

  assert(gate.status === 'ready_for_strategy_design', `${skillId} strategy should be ready with full evidence`, gate);
  assert(gate.canChangeBusinessStrategy === true, `${skillId} should allow strategy only when fully ready`, gate);
  assert(
    gate.requiredNextEvidence.length === 0,
    `${skillId} should not require more evidence when fully ready`,
    gate
  );
  assert(
    gate.warnings.includes('fake_photoshop_boundary'),
    `${skillId} should retain fake Photoshop boundary when using desktop fake mode`,
    gate
  );
}

function assertExistingExecutionRequiresContext(skillId) {
  const missingContext = buildBusinessSkillExecutionPreflightGate({
    skillId,
    requestKind: 'execute_existing',
    userCheckpointConfirmed: false,
    implementationEvidence: {},
    contextEvidence: {
      hasProjectContext: true
    },
    acceptance: {
      mode: 'offline-static'
    }
  });

  assert(missingContext.status === 'needs_context', `${skillId} existing execution should require context`, missingContext);
  assert(
    missingContext.requiredNextEvidence.includes('asset_index_required'),
    `${skillId} should require asset index before existing execution`,
    missingContext
  );
  assert(
    missingContext.requiredNextEvidence.includes('visual_understanding_required'),
    `${skillId} should require visual understanding before existing execution`,
    missingContext
  );

  const ready = buildBusinessSkillExecutionPreflightGate({
    skillId,
    requestKind: 'execute_existing',
    userCheckpointConfirmed: false,
    implementationEvidence: {},
    contextEvidence: {
      hasProjectContext: true,
      hasAssetIndex: true,
      hasVisualSamplingPlan: true,
      hasVisualUnderstanding: true,
      hasTemplateEvidence: true
    },
    acceptance: {
      mode: 'offline-static'
    }
  });

  assert(ready.status === 'ready_for_existing_execution', `${skillId} existing execution should be ready with context`, ready);
  assert(
    ready.claimBoundary.includes('offline_acceptance_does_not_prove_photoshop_write'),
    `${skillId} should keep offline acceptance boundary`,
    ready
  );
}

function assertLiveAcceptanceMustBeAvailable(skillId) {
  const gate = buildBusinessSkillExecutionPreflightGate({
    skillId,
    requestKind: 'execute_existing',
    userCheckpointConfirmed: false,
    implementationEvidence: {},
    contextEvidence: {
      hasProjectContext: true,
      hasAssetIndex: true,
      hasVisualSamplingPlan: true,
      hasVisualUnderstanding: true,
      hasTemplateEvidence: true
    },
    acceptance: {
      mode: 'live-photoshop-disposable'
    }
  });

  assert(gate.status === 'blocked', `${skillId} should block unavailable live acceptance`, gate);
  assert(
    gate.blockers.includes('acceptance_mode_not_available'),
    `${skillId} should report unavailable acceptance mode`,
    gate
  );
}

function assertPackageRegistration() {
  const packageJson = readPackageJson();
  const scripts = packageJson.scripts || {};
  assert(
    scripts['smoke:business-skill:execution-preflight-gate'] ===
      'node scripts/smoke-business-skill-execution-preflight-gate.cjs',
    'package.json should expose smoke:business-skill:execution-preflight-gate'
  );
  assert(
    String(scripts['maintenance:preflight'] || '').includes('smoke:business-skill:execution-preflight-gate'),
    'maintenance:preflight should include smoke:business-skill:execution-preflight-gate'
  );
}

function run() {
  assertSkillCoverage();

  for (const skillId of BUSINESS_SKILL_EXECUTION_PREFLIGHT_SKILL_IDS) {
    assertStrategyChangesAreBlockedWithoutCheckpoint(skillId);
    assertInfraOnlyIsAllowedWithoutStrategyPermission(skillId);
    assertStrategyReadyRequiresAllEvidence(skillId);
    assertExistingExecutionRequiresContext(skillId);
    assertLiveAcceptanceMustBeAvailable(skillId);
  }

  assertPackageRegistration();

  return {
    success: true,
    checkedSkills: BUSINESS_SKILL_EXECUTION_PREFLIGHT_SKILL_IDS
  };
}

try {
  console.log(JSON.stringify(run(), null, 2));
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
