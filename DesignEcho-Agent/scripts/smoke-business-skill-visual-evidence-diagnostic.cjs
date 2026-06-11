const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  buildAgentDiagnosticEvidence
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-diagnostic-evidence.ts'));
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

const businessSkillVisualEvidenceControlDecision = {
  version: 'business-skill-visual-evidence-control-decision/v0',
  decision: 'needs_visual_evidence_before_quality_claim',
  canContinueExistingExecution: true,
  canClaimDesignQuality: false,
  resultEvidenceOnly: true,
  mustNotChangeExecutor: true,
  reasons: [
    'Visual understanding is missing or stale.',
    'Business skill output cannot claim design quality without refreshed evidence.'
  ],
  requiredNextEvidence: ['visual_understanding', 'screenshot_qa', 'manual_review'],
  rawImageBase64: 'should-be-redacted',
  nested: {
    imageData: 'should-also-be-redacted'
  }
};

const diagnosticEvidence = buildAgentDiagnosticEvidence({
  businessSkillVisualEvidenceControlDecision,
  rawImagePayload: 'top-level-raw-image',
  arbitraryRuntimeBlob: {
    shouldNotLeak: true
  }
});

assert(diagnosticEvidence, 'diagnostic evidence should be built from business skill control decision');
assert(
  diagnosticEvidence.evidenceKeys.includes('businessSkillVisualEvidenceControlDecision'),
  'diagnostic evidence should preserve businessSkillVisualEvidenceControlDecision key',
  diagnosticEvidence
);
assert(
  diagnosticEvidence.businessSkillVisualEvidenceControlDecision.canClaimDesignQuality === false,
  'diagnostic evidence should preserve no-quality-claim boundary',
  diagnosticEvidence
);
assert(
  diagnosticEvidence.businessSkillVisualEvidenceControlDecision.resultEvidenceOnly === true,
  'diagnostic evidence should preserve result-only boundary',
  diagnosticEvidence
);
assert(
  !Object.prototype.hasOwnProperty.call(diagnosticEvidence, 'arbitraryRuntimeBlob'),
  'diagnostic evidence should not copy arbitrary runtime blobs',
  diagnosticEvidence
);
assert(
  !JSON.stringify(diagnosticEvidence).includes('should-be-redacted')
    && !JSON.stringify(diagnosticEvidence).includes('top-level-raw-image'),
  'diagnostic evidence should redact raw image payload-like fields',
  diagnosticEvidence
);
assert(
  !JSON.stringify(diagnosticEvidence).includes('正在思考')
    && !JSON.stringify(diagnosticEvidence).includes('等待响应')
    && !JSON.stringify(diagnosticEvidence).includes('请求已发送')
    && !JSON.stringify(diagnosticEvidence).includes('正在准备')
    && !JSON.stringify(diagnosticEvidence).includes('稍等'),
  'diagnostic evidence must not introduce pseudo-thinking copy',
  diagnosticEvidence
);

const acceptanceCase = {
  id: 'business-visual-control-diagnostic-smoke',
  title: 'Business visual control decision diagnostic smoke',
  userInput: '帮我做一个详情页',
  mode: 'offline',
  tags: ['business-skill', 'diagnostic-evidence'],
  expectation: {
    shouldUseTools: false
  }
};

const bundle = buildAgentRunDebugBundleFromMessage({
  acceptanceCase,
  message: {
    content: '需要补充视觉证据后再判断设计质量。',
    agentDiagnosticEvidence: diagnosticEvidence
  }
});

const report = evaluateAgentAcceptance(acceptanceCase, bundle);

assert(bundle.diagnosticEvidence, 'acceptance debug bundle should carry diagnostic evidence');
assert(
  bundle.diagnosticEvidence.evidenceKeys.includes('businessSkillVisualEvidenceControlDecision'),
  'acceptance debug bundle should preserve the control decision evidence key',
  bundle.diagnosticEvidence
);
assert(
  report.evidence.diagnosticEvidenceKeys.includes('businessSkillVisualEvidenceControlDecision'),
  'acceptance report should expose the control decision diagnostic key',
  report
);
assert(
  report.status !== 'failed',
  'offline diagnostic case should not fail merely because it carries hidden evidence',
  report
);

console.log(JSON.stringify({
  success: true,
  checks: [
    'business visual evidence control decision enters hidden diagnostic evidence',
    'diagnostic evidence preserves no-quality-claim and result-only boundaries',
    'diagnostic evidence redacts raw payload-like fields',
    'acceptance debug bundle and report expose the diagnostic evidence key without pseudo-thinking copy'
  ]
}, null, 2));
