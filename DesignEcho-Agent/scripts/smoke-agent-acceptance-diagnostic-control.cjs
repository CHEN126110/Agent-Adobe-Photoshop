const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  buildAgentRunDebugBundleFromMessage,
  evaluateAgentAcceptance
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-acceptance-contracts.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function makeCase(id) {
  return {
    id,
    title: 'Acceptance diagnostic control smoke',
    userInput: '帮我做详情页',
    mode: 'offline',
    tags: ['acceptance', 'diagnostic-control'],
    expectation: {
      shouldUseTools: false
    }
  };
}

function evaluateWithControlDecision(controlDecision) {
  const acceptanceCase = makeCase('diagnostic-control-smoke');
  const bundle = buildAgentRunDebugBundleFromMessage({
    acceptanceCase,
    message: {
      content: '需要补充视觉证据后再判断设计质量。',
      agentDiagnosticEvidence: {
        version: 'agent-diagnostic-evidence/v0',
        evidenceKeys: ['businessSkillVisualEvidenceControlDecision'],
        rawPayloadRedacted: true,
        warnings: [],
        businessSkillVisualEvidenceControlDecision: controlDecision
      }
    }
  });
  return evaluateAgentAcceptance(acceptanceCase, bundle);
}

const validReport = evaluateWithControlDecision({
  version: 'business-skill-visual-evidence-control-decision/v0',
  decision: 'needs_visual_evidence_before_quality_claim',
  canContinueExistingExecution: true,
  canClaimDesignQuality: false,
  resultEvidenceOnly: true,
  mustNotChangeExecutor: true,
  requiredNextEvidence: ['visual_understanding', 'screenshot_qa', 'manual_review'],
  reasons: ['Visual understanding is missing.']
});

assert(
  validReport.evidence.businessSkillVisualEvidenceControlDecision,
  'acceptance report should expose structured business visual control decision evidence',
  validReport
);
assert(
  validReport.evidence.businessSkillVisualEvidenceControlDecision.decision === 'needs_visual_evidence_before_quality_claim',
  'acceptance report should expose the decision kind',
  validReport.evidence.businessSkillVisualEvidenceControlDecision
);
assert(
  validReport.evidence.businessSkillVisualEvidenceControlDecision.canClaimDesignQuality === false,
  'acceptance report should preserve canClaimDesignQuality=false',
  validReport.evidence.businessSkillVisualEvidenceControlDecision
);
assert(
  validReport.evidence.businessSkillVisualEvidenceControlDecision.resultEvidenceOnly === true,
  'acceptance report should preserve resultEvidenceOnly=true',
  validReport.evidence.businessSkillVisualEvidenceControlDecision
);
assert(
  validReport.warnings.some((warning) => warning.includes('needs_visual_evidence_before_quality_claim')),
  'acceptance report should surface the control decision as a warning for developer review',
  validReport
);

const invalidQualityReport = evaluateWithControlDecision({
  version: 'business-skill-visual-evidence-control-decision/v0',
  decision: 'needs_visual_evidence_before_quality_claim',
  canContinueExistingExecution: true,
  canClaimDesignQuality: true,
  resultEvidenceOnly: true,
  mustNotChangeExecutor: true,
  requiredNextEvidence: []
});

assert(
  invalidQualityReport.status === 'failed',
  'acceptance report should fail if diagnostic control decision claims design quality',
  invalidQualityReport
);
assert(
  invalidQualityReport.blockers.some((blocker) => blocker.includes('canClaimDesignQuality=false')),
  'acceptance report should explain no-quality-claim boundary violations',
  invalidQualityReport
);

const invalidResultOnlyReport = evaluateWithControlDecision({
  version: 'business-skill-visual-evidence-control-decision/v0',
  decision: 'refresh_completed_after_execution',
  canContinueExistingExecution: true,
  canClaimDesignQuality: false,
  resultEvidenceOnly: false,
  mustNotChangeExecutor: true,
  requiredNextEvidence: []
});

assert(
  invalidResultOnlyReport.status === 'failed',
  'acceptance report should fail if diagnostic control decision is not result-only evidence',
  invalidResultOnlyReport
);
assert(
  invalidResultOnlyReport.blockers.some((blocker) => blocker.includes('resultEvidenceOnly=true')),
  'acceptance report should explain result-only boundary violations',
  invalidResultOnlyReport
);

console.log(JSON.stringify({
  success: true,
  checks: [
    'acceptance report exposes business visual control decision evidence',
    'acceptance report surfaces control decision warnings for developer review',
    'acceptance report fails no-quality-claim boundary violations',
    'acceptance report fails result-only boundary violations'
  ]
}, null, 2));
