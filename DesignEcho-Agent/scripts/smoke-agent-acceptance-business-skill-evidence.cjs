const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  buildAgentDiagnosticEvidence
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-diagnostic-evidence.ts'));
const {
  buildAgentRunDebugBundleFromMessage,
  evaluateAgentAcceptance
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-acceptance-contracts.ts'));
const {
  buildAgentAcceptanceDebugExport
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-acceptance-export.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function makeCase(id) {
  return {
    id,
    title: 'Business skill acceptance evidence smoke',
    userInput: '帮我做详情页',
    mode: 'desktop_bridge',
    tags: ['acceptance', 'business-skill-evidence'],
    expectation: {
      shouldUseTools: false
    }
  };
}

function makeBusinessSkillExecutionPlanIntake(overrides = {}) {
  return {
    version: 'business-skill-execution-plan-intake/v0',
    skillId: 'detail-page-design',
    status: 'executed_with_trace_needs_verification',
    evidenceOnly: true,
    userVisible: false,
    canClaimDesignQuality: false,
    mustNotChangeBusinessStrategy: true,
    mustNotChangeExecutor: true,
    executionPlanEvidence: {
      hasDesignAgentOs: true,
      hasExecutionPlan: true,
      stepCount: 3,
      operations: ['placeImage', 'setText'],
      hasExecutionTrace: true,
      toolCallCount: 2,
      successfulToolCalls: 2,
      failedToolCalls: 0,
      hasVerificationReport: false
    },
    sourceEvidence: ['design_agent_os_execution_plan', 'design_agent_os_execution_trace'],
    requiredNextEvidence: ['screenshot_or_manual_review_required'],
    blockers: [],
    warnings: ['已有工具调用追踪，但仍需要截图、bounds 或人工验收。'],
    limitations: ['该 intake 是隐藏执行计划证据，不是模型思考，不进入 Pondering。'],
    evidence: [],
    rawImageBase64: 'should-be-redacted',
    ...overrides
  };
}

function makeImagePlacementIntake(overrides = {}) {
  return {
    version: 'business-skill-image-placement-verification-intake/v0',
    skillId: 'detail-page-design',
    status: 'needs_screenshot_or_actual_bounds',
    evidenceOnly: true,
    userVisible: false,
    canClaimDesignQuality: false,
    geometryOnly: true,
    requiredNextEvidence: ['photoshop_actual_bounds_or_screenshot_required'],
    blockers: [],
    warnings: ['缺少真实 Photoshop actualBounds 或截图。'],
    evidence: [],
    imageData: 'should-be-redacted',
    ...overrides
  };
}

function makeBundle(acceptanceCase, diagnosticEvidence) {
  return buildAgentRunDebugBundleFromMessage({
    acceptanceCase,
    message: {
      content: '已生成隐藏验收证据，仍需截图或人工验收。',
      agentDiagnosticEvidence: diagnosticEvidence
    }
  });
}

const diagnosticEvidence = buildAgentDiagnosticEvidence({
  businessSkillExecutionPlanIntake: makeBusinessSkillExecutionPlanIntake(),
  businessSkillImagePlacementVerificationIntake: makeImagePlacementIntake(),
  arbitraryRawImagePayload: 'top-level-raw-payload'
});

assert(diagnosticEvidence, 'diagnostic evidence should be built for business skill evidence intake');
assert(
  diagnosticEvidence.evidenceKeys.includes('businessSkillExecutionPlanIntake'),
  'diagnostic evidence should include businessSkillExecutionPlanIntake',
  diagnosticEvidence
);
assert(
  diagnosticEvidence.evidenceKeys.includes('businessSkillImagePlacementVerificationIntake'),
  'diagnostic evidence should include businessSkillImagePlacementVerificationIntake',
  diagnosticEvidence
);
assert(
  !JSON.stringify(diagnosticEvidence).includes('should-be-redacted')
    && !JSON.stringify(diagnosticEvidence).includes('top-level-raw-payload'),
  'diagnostic evidence should redact raw payload-like fields',
  diagnosticEvidence
);

const validCase = makeCase('business-skill-evidence-valid');
const validBundle = makeBundle(validCase, diagnosticEvidence);
const validReport = evaluateAgentAcceptance(validCase, validBundle);
const validExport = buildAgentAcceptanceDebugExport({ bundle: validBundle, report: validReport });

assert(
  validReport.evidence.businessSkillExecutionPlanIntake?.status === 'executed_with_trace_needs_verification',
  'acceptance report should expose execution plan intake status',
  validReport.evidence
);
assert(
  validReport.evidence.businessSkillImagePlacementVerificationIntake?.status === 'needs_screenshot_or_actual_bounds',
  'acceptance report should expose image placement intake status',
  validReport.evidence
);
assert(
  validExport.acceptanceDiagnostics.businessSkillExecutionPlanIntake?.status === 'executed_with_trace_needs_verification',
  'acceptance diagnostics should preserve execution plan intake',
  validExport.acceptanceDiagnostics
);
assert(
  validExport.acceptanceDiagnostics.executionPlanIntakeBoundaryOk === true,
  'acceptance diagnostics should mark execution plan intake boundary as ok',
  validExport.acceptanceDiagnostics
);
assert(
  validExport.acceptanceDiagnostics.imagePlacementIntakeBoundaryOk === true,
  'acceptance diagnostics should mark image placement intake boundary as ok',
  validExport.acceptanceDiagnostics
);
assert(
  validReport.warnings.some((warning) => warning.includes('business skill execution plan evidence')),
  'acceptance report should surface execution plan evidence as developer warning',
  validReport.warnings
);

const invalidCase = makeCase('business-skill-evidence-invalid');
const invalidDiagnosticEvidence = buildAgentDiagnosticEvidence({
  businessSkillExecutionPlanIntake: makeBusinessSkillExecutionPlanIntake({
    userVisible: true,
    canClaimDesignQuality: true
  })
});
const invalidBundle = makeBundle(invalidCase, invalidDiagnosticEvidence);
const invalidReport = evaluateAgentAcceptance(invalidCase, invalidBundle);
const invalidExport = buildAgentAcceptanceDebugExport({ bundle: invalidBundle, report: invalidReport });

assert(
  invalidReport.status === 'failed',
  'acceptance report should fail when business skill intake violates hidden/no-quality boundary',
  invalidReport
);
assert(
  invalidReport.blockers.some((blocker) => blocker.includes('canClaimDesignQuality=false')),
  'acceptance report should explain no-quality-claim boundary violations',
  invalidReport.blockers
);
assert(
  invalidExport.acceptanceDiagnostics.executionPlanIntakeBoundaryOk === false,
  'acceptance diagnostics should expose execution plan intake boundary violation',
  invalidExport.acceptanceDiagnostics
);

console.log(JSON.stringify({
  success: true,
  checks: [
    'business skill execution plan and placement intakes enter diagnostic evidence',
    'raw payload-like fields remain redacted',
    'acceptance report and diagnostics expose intake statuses',
    'acceptance report fails hidden/no-quality boundary violations'
  ]
}, null, 2));
