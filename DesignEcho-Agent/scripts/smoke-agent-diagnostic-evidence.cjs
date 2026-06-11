const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  buildAgentDiagnosticEvidence
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-diagnostic-evidence.ts'));
const {
  buildAgentRunDebugBundleFromMessage
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-acceptance-contracts.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

const detailPageSkillReadiness = {
  version: 'detail-page-skill-readiness/v0',
  status: 'needs_context',
  canInspect: true,
  canExecute: false,
  requiredNextEvidence: ['project_visual_evidence'],
  blockers: [],
  warnings: ['缺少项目视觉证据'],
  rawImageBase64: 'should-be-redacted',
  nested: {
    imageData: 'should-be-redacted'
  }
};

const diagnosticEvidence = buildAgentDiagnosticEvidence({
  detailPageSkillReadiness,
  agentResumeReadonlyContextExecutor: {
    version: 'agent-resume-readonly-context-executor/v0',
    status: 'completed_readonly_refresh',
    evidenceOnly: true,
    rawPayloadRedacted: true,
    mustNotRunWriteTools: true,
    evidence: {
      documentSnapshot: {
        rawPayload: 'should-be-redacted',
        rawPayloadRedacted: true
      }
    }
  },
  agentResumePlanning: {
    version: 'agent-resume-planning/v0',
    status: 'model_resume_plan_available',
    evidenceOnly: true,
    rawPayloadRedacted: true,
    shouldRunPhotoshop: false,
    mustNotRunWriteTools: true,
    modelPlanText: '{"photoshopWritesAllowed":false}'
  },
  agentResumeExecutionGate: {
    version: 'agent-resume-execution-gate/v0',
    status: 'blocked_pending_user_approval',
    evidenceOnly: true,
    rawPayloadRedacted: true,
    shouldRunPhotoshop: false,
    mustNotRunWriteTools: true,
    canDispatchWriteTools: false,
    executionPlan: {
      rawPayload: 'should-be-redacted',
      rawPayloadRedacted: true
    }
  },
  agentResumeControlledExecutionRequest: {
    version: 'agent-resume-controlled-execution-request/v0',
    status: 'blocked_execution_gate_not_ready',
    evidenceOnly: true,
    rawPayloadRedacted: true,
    shouldRunPhotoshop: false,
    mustNotRunWriteTools: true,
    operationRequests: [
      {
        toolName: 'reorderLayer',
        params: {
          rawPayload: 'should-be-redacted',
          rawPayloadRedacted: true
        }
      }
    ]
  },
  agentResumeControlledExecutionRunner: {
    version: 'agent-resume-controlled-execution-runner/v0',
    status: 'blocked_request_not_ready',
    evidenceOnly: true,
    rawPayloadRedacted: true,
    shouldRunPhotoshop: false,
    executedWriteTools: [],
    operationRequests: [
      {
        toolName: 'reorderLayer',
        params: {
          rawPayload: 'should-be-redacted',
          rawPayloadRedacted: true
        }
      }
    ]
  },
  imageData: 'top-level-raw-image',
  irrelevantRuntimeBlob: { ok: true }
});

assert(diagnosticEvidence, 'diagnostic evidence should be built when a supported key exists');
assert(diagnosticEvidence.version === 'agent-diagnostic-evidence/v0', 'diagnostic evidence should expose a stable version', diagnosticEvidence);
assert(diagnosticEvidence.rawPayloadRedacted === true, 'diagnostic evidence should mark raw payload redaction', diagnosticEvidence);
assert(
  diagnosticEvidence.evidenceKeys.includes('detailPageSkillReadiness'),
  'diagnostic evidence should list safe evidence keys',
  diagnosticEvidence
);
assert(
  diagnosticEvidence.evidenceKeys.includes('agentResumeReadonlyContextExecutor')
    && diagnosticEvidence.evidenceKeys.includes('agentResumePlanning')
    && diagnosticEvidence.evidenceKeys.includes('agentResumeExecutionGate')
    && diagnosticEvidence.evidenceKeys.includes('agentResumeControlledExecutionRequest')
    && diagnosticEvidence.evidenceKeys.includes('agentResumeControlledExecutionRunner'),
  'diagnostic evidence should include AGENT-168 resume evidence keys',
  diagnosticEvidence
);
assert(
  diagnosticEvidence.agentResumeReadonlyContextExecutor.rawPayloadRedacted === true
    && diagnosticEvidence.agentResumePlanning.rawPayloadRedacted === true
    && diagnosticEvidence.agentResumeExecutionGate.rawPayloadRedacted === true
    && diagnosticEvidence.agentResumeControlledExecutionRequest.rawPayloadRedacted === true
    && diagnosticEvidence.agentResumeControlledExecutionRunner.rawPayloadRedacted === true,
  'diagnostic evidence should preserve rawPayloadRedacted booleans on resume evidence',
  diagnosticEvidence
);
assert(
  !JSON.stringify(diagnosticEvidence).includes('should-be-redacted')
    && !JSON.stringify(diagnosticEvidence).includes('top-level-raw-image'),
  'diagnostic evidence should redact raw image payload-like fields',
  diagnosticEvidence
);
assert(
  !Object.prototype.hasOwnProperty.call(diagnosticEvidence, 'irrelevantRuntimeBlob'),
  'diagnostic evidence should keep an allowlist instead of copying arbitrary result data',
  diagnosticEvidence
);

const bundle = buildAgentRunDebugBundleFromMessage({
  acceptanceCase: {
    id: 'diagnostic-evidence-smoke',
    title: 'Diagnostic evidence smoke',
    userInput: '检查详情页模板',
    mode: 'offline',
    tags: ['diagnostic-evidence'],
    expectation: {
      shouldUseTools: false
    }
  },
  message: {
    content: '已检查，需要补充视觉证据。',
    agentDiagnosticEvidence: diagnosticEvidence
  }
});

assert(bundle.diagnosticEvidence, 'acceptance debug bundle should carry hidden diagnostic evidence');
assert(
  bundle.diagnosticEvidence.evidenceKeys.includes('detailPageSkillReadiness'),
  'acceptance debug bundle should keep the detail-page readiness evidence key',
  bundle.diagnosticEvidence
);
assert(
  bundle.diagnosticEvidence.evidenceKeys.includes('agentResumeReadonlyContextExecutor')
    && bundle.diagnosticEvidence.evidenceKeys.includes('agentResumePlanning')
    && bundle.diagnosticEvidence.evidenceKeys.includes('agentResumeExecutionGate')
    && bundle.diagnosticEvidence.evidenceKeys.includes('agentResumeControlledExecutionRequest')
    && bundle.diagnosticEvidence.evidenceKeys.includes('agentResumeControlledExecutionRunner'),
  'acceptance debug bundle should keep AGENT-168 resume evidence keys',
  bundle.diagnosticEvidence
);

console.log(JSON.stringify({
  success: true,
  checks: [
    'safe diagnostic evidence is built from whitelisted result data',
    'raw image payload-like fields are redacted',
    'AGENT-168 resume evidence keys are preserved',
    'acceptance debug bundle preserves hidden diagnostic evidence'
  ]
}, null, 2));
