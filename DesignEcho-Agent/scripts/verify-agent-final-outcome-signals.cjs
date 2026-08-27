#!/usr/bin/env node
/* eslint-disable no-console */

const assert = require('assert');
const path = require('path');

const root = path.resolve(__dirname, '..');
require('ts-node').register({
  transpileOnly: true,
  project: path.join(root, 'tsconfig.main.json')
});
const {
  projectAgentFinalOutcomeSignals
} = require(path.join(root, 'src', 'shared', 'agent-final-outcome-signals.ts'));
const {
  projectAgentActionDisposition
} = require(path.join(root, 'src', 'shared', 'agent-action-disposition.ts'));

const attempt = {
  failedToolCalls: 2,
  acceptanceFailed: 1,
  acceptanceNeedsReview: 3,
  noDocumentChangeRisks: 1
};

const completed = projectAgentFinalOutcomeSignals({
  stopReason: 'final_response',
  taskCompletionStatus: 'completed',
  designVerdictDeliverable: true,
  attempt
});
assert.deepStrictEqual(completed.attempt, attempt);
assert.deepStrictEqual(completed.completionBlocking, {
  failedToolCalls: 0,
  acceptanceFailed: 0,
  acceptanceNeedsReview: 0,
  noDocumentChangeRisks: 0
});
assert.strictEqual(completed.supersededByVerifiedTerminalEvidence, true);

const forcedSummaryAfterCompletion = projectAgentFinalOutcomeSignals({
  stopReason: 'tool_budget_final_response',
  taskCompletionStatus: 'completed',
  designVerdictDeliverable: true,
  attempt
});
assert.strictEqual(forcedSummaryAfterCompletion.supersededByVerifiedTerminalEvidence, true);

const emptySummaryAfterCompletion = projectAgentFinalOutcomeSignals({
  stopReason: 'empty_final_response',
  taskCompletionStatus: 'completed',
  designVerdictDeliverable: true,
  attempt
});
assert.strictEqual(emptySummaryAfterCompletion.supersededByVerifiedTerminalEvidence, true);

for (const projection of [
  projectAgentFinalOutcomeSignals({
    stopReason: 'final_response',
    taskCompletionStatus: 'needs_review',
    designVerdictDeliverable: true,
    attempt
  }),
  projectAgentFinalOutcomeSignals({
    stopReason: 'final_response',
    taskCompletionStatus: 'completed',
    designVerdictDeliverable: false,
    attempt
  }),
  projectAgentFinalOutcomeSignals({
    stopReason: 'error',
    taskCompletionStatus: 'completed',
    designVerdictDeliverable: true,
    attempt
  }),
  projectAgentFinalOutcomeSignals({
    stopReason: 'final_response',
    taskCompletionStatus: 'completed',
    designVerdictDeliverable: true,
    terminalSkillOutcomeUnverified: true,
    attempt
  }),
  projectAgentFinalOutcomeSignals({
    stopReason: 'final_response',
    taskCompletionStatus: 'completed',
    designVerdictDeliverable: true,
    designQualityHardBlocked: true,
    attempt
  })
]) {
  assert.deepStrictEqual(projection.completionBlocking, attempt);
  assert.strictEqual(projection.supersededByVerifiedTerminalEvidence, false);
}

const softQualityFinding = projectAgentFinalOutcomeSignals({
  stopReason: 'final_response',
  taskCompletionStatus: 'completed',
  designVerdictDeliverable: true,
  attempt
});
assert.deepStrictEqual(softQualityFinding.completionBlocking, {
  failedToolCalls: 0,
  acceptanceFailed: 0,
  acceptanceNeedsReview: 0,
  noDocumentChangeRisks: 0
});

const normalized = projectAgentFinalOutcomeSignals({
  stopReason: 'final_response',
  taskCompletionStatus: 'failed',
  attempt: {
    failedToolCalls: -1,
    acceptanceFailed: Number.NaN,
    acceptanceNeedsReview: 1.8,
    noDocumentChangeRisks: 0
  }
});
assert.deepStrictEqual(normalized.attempt, {
  failedToolCalls: 0,
  acceptanceFailed: 0,
  acceptanceNeedsReview: 1,
  noDocumentChangeRisks: 0
});

assert.deepStrictEqual(projectAgentActionDisposition({
  isSkill: true,
  hasPendingInteractiveConfirmation: true,
  result: {
    success: false,
    skillOutcome: {
      version: 'skill-execution-outcome/v0',
      status: 'awaiting_confirmation',
      summary: '等待确认',
      outputs: [],
      blockers: [],
      warnings: []
    }
  }
}), {
  disposition: 'awaiting_user',
  userVisible: false,
  countsAsUnresolvedFailure: false
});

assert.deepStrictEqual(projectAgentActionDisposition({
  isSkill: true,
  result: {
    success: true,
    skillOutcome: {
      version: 'skill-execution-outcome/v0',
      status: 'executed',
      summary: '生产已完成，交回 Agent 看图',
      outputs: ['设计稿'],
      blockers: [],
      warnings: []
    },
    data: {
      agentReActContinuation: {
        status: 'needs_decision',
        nextAction: 'decide_next'
      }
    }
  }
}), {
  disposition: 'handoff',
  userVisible: false,
  countsAsUnresolvedFailure: false
});

assert.deepStrictEqual(projectAgentActionDisposition({
  isSkill: true,
  result: {
    success: false,
    nonFatal: true,
    data: {
      agentReActContinuation: {
        status: 'needs_repair',
        nextAction: 'repair'
      }
    }
  }
}), {
  disposition: 'handoff',
  userVisible: false,
  countsAsUnresolvedFailure: false
});

assert.deepStrictEqual(projectAgentActionDisposition({
  isSkill: false,
  result: {
    success: false,
    error: '真实工具失败'
  }
}), {
  disposition: 'recoverable_failure',
  userVisible: false,
  countsAsUnresolvedFailure: true
});

assert.deepStrictEqual(projectAgentActionDisposition({
  isSkill: false,
  result: {
    success: true
  }
}), {
  disposition: 'completed',
  userVisible: true,
  countsAsUnresolvedFailure: false
});

console.log(JSON.stringify({
  success: true,
  checks: [
    'verified terminal evidence supersedes earlier attempt failures',
    'forced final prose can complete only after structured completion closes',
    'empty final prose cannot overturn a closed structured result',
    'qualified quality blockers, non-terminal failures, and unknown Skill effects remain blocking',
    'soft quality findings remain visible without rewriting artifact completion',
    'attempt counts remain available for diagnostics',
    'invalid counters are normalized without manufacturing progress',
    'awaiting-user and Agent handoff are not projected as failed actions',
    'raw failed attempts remain recoverable failures until terminal completion is evaluated'
  ]
}, null, 2));
