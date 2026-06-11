const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

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
    title: 'Acceptance diagnostic export smoke',
    userInput: '帮我做详情页',
    mode: 'desktop_bridge',
    tags: ['acceptance', 'desktop-export', 'diagnostic-control'],
    expectation: {
      shouldUseTools: false
    }
  };
}

function makeBundle(acceptanceCase, controlDecision) {
  return buildAgentRunDebugBundleFromMessage({
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
}

const validCase = makeCase('diagnostic-export-valid');
const validBundle = makeBundle(validCase, {
  version: 'business-skill-visual-evidence-control-decision/v0',
  decision: 'needs_visual_evidence_before_quality_claim',
  canContinueExistingExecution: true,
  canClaimDesignQuality: false,
  resultEvidenceOnly: true,
  mustNotChangeExecutor: true,
  requiredNextEvidence: ['visual_understanding', 'screenshot_qa', 'manual_review'],
  reasons: ['Visual understanding is missing.']
});
const validReport = evaluateAgentAcceptance(validCase, validBundle);
const validExport = buildAgentAcceptanceDebugExport({ bundle: validBundle, report: validReport });

assert(
  validExport.acceptanceDiagnostics.version === 'agent-acceptance-diagnostics/v0',
  'debug export should include a stable diagnostics envelope',
  validExport
);
assert(
  validExport.acceptanceDiagnostics.caseId === validCase.id,
  'debug export diagnostics should keep the case id',
  validExport.acceptanceDiagnostics
);
assert(
  validExport.acceptanceDiagnostics.diagnosticEvidenceKeys.includes('businessSkillVisualEvidenceControlDecision'),
  'debug export diagnostics should preserve diagnostic evidence keys',
  validExport.acceptanceDiagnostics
);
assert(
  validExport.acceptanceDiagnostics.businessSkillVisualEvidenceControlDecision?.decision === 'needs_visual_evidence_before_quality_claim',
  'debug export diagnostics should expose the structured control decision',
  validExport.acceptanceDiagnostics
);
assert(
  validExport.acceptanceDiagnostics.qualityClaimBoundaryOk === true,
  'debug export diagnostics should mark valid no-quality-claim boundary as ok',
  validExport.acceptanceDiagnostics
);
assert(
  validExport.acceptanceDiagnostics.resultOnlyBoundaryOk === true,
  'debug export diagnostics should mark valid result-only boundary as ok',
  validExport.acceptanceDiagnostics
);
assert(
  validExport.bundle === validBundle && validExport.report === validReport,
  'debug export should preserve the existing bundle and report objects without cloning or dropping fields'
);

const invalidCase = makeCase('diagnostic-export-invalid');
const invalidBundle = makeBundle(invalidCase, {
  version: 'business-skill-visual-evidence-control-decision/v0',
  decision: 'refresh_completed_after_execution',
  canContinueExistingExecution: true,
  canClaimDesignQuality: true,
  resultEvidenceOnly: false,
  mustNotChangeExecutor: true,
  requiredNextEvidence: []
});
const invalidReport = evaluateAgentAcceptance(invalidCase, invalidBundle);
const invalidExport = buildAgentAcceptanceDebugExport({ bundle: invalidBundle, report: invalidReport });

assert(
  invalidExport.report.status === 'failed',
  'invalid diagnostic control boundaries should still fail the shared acceptance report',
  invalidExport.report
);
assert(
  invalidExport.acceptanceDiagnostics.qualityClaimBoundaryOk === false,
  'debug export diagnostics should expose quality-claim boundary violations',
  invalidExport.acceptanceDiagnostics
);
assert(
  invalidExport.acceptanceDiagnostics.resultOnlyBoundaryOk === false,
  'debug export diagnostics should expose result-only boundary violations',
  invalidExport.acceptanceDiagnostics
);
assert(
  invalidExport.acceptanceDiagnostics.blockerCount > 0,
  'debug export diagnostics should expose blocker counts for triage',
  invalidExport.acceptanceDiagnostics
);

console.log(JSON.stringify({
  success: true,
  checks: [
    'desktop/debug acceptance export includes a stable diagnostics envelope',
    'diagnostics preserve structured business visual control decision evidence',
    'diagnostics expose no-quality-claim and result-only boundary status',
    'debug export preserves existing bundle and report objects'
  ]
}, null, 2));
