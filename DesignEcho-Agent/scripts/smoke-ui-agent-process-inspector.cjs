#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  buildAgentRequestLifecycle
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-request-lifecycle.ts'));
const {
  buildAgentProcessInspector
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-process-inspector.ts'));

const ROOT = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function makeLifecycle(overrides = {}) {
  return buildAgentRequestLifecycle({
    userInput: overrides.userInput || '帮我看看当前项目',
    context: {
      isPluginConnected: true,
      photoshopContext: {
        hasDocument: true,
        documentName: 'C-1160.psd',
        layerCount: 8
      }
    },
    routeSource: overrides.routeSource || 'model_decision',
    route: overrides.route || 'skill_execution',
    skillId: overrides.skillId || 'project-image-analysis',
    executionKind: overrides.executionKind || 'deterministic_skill',
    reason: '测试用 lifecycle 证据。',
    blockers: overrides.blockers || [],
    warnings: overrides.warnings || []
  });
}

const empty = buildAgentProcessInspector({
  messages: [],
  isLoading: false,
  generatedAt: '2026-05-27T00:00:00.000Z'
});
assert(empty.status === 'no_evidence', 'empty conversation should expose no_evidence status', empty);
assert(empty.source === 'empty_conversation', 'empty conversation should not pretend there is message evidence', empty);
assert(empty.canClaimDesignQuality === false, 'inspector must not claim design quality', empty);
assert(empty.canClaimProviderThinking === false, 'inspector must not claim provider thinking', empty);
assert(empty.canRunProvider === false, 'inspector must not run provider', empty);
assert(empty.canRunPhotoshop === false, 'inspector must not run Photoshop', empty);
assert(empty.lifecycleBoundaryOk === true, 'empty inspector lifecycle boundary should be explicit and safe', empty);

const loading = buildAgentProcessInspector({
  messages: [{ id: 'u1', role: 'user' }],
  isLoading: true,
  generatedAt: '2026-05-27T00:00:00.000Z'
});
assert(loading.status === 'running', 'loading state should be visible as running status', loading);
assert(loading.source === 'loading_state', 'loading without assistant evidence should use loading_state source', loading);
assert(loading.lifecycleSnapshot.mustNotRunProvider === true, 'loading inspector must remain readonly', loading);
assert(loading.lifecycleSnapshot.mustNotRunPhotoshop === true, 'loading inspector must remain Photoshop-free', loading);

const completed = buildAgentProcessInspector({
  messages: [
    { id: 'u1', role: 'user' },
    {
      id: 'a1',
      role: 'assistant',
      agentRequestLifecycle: makeLifecycle(),
      executionSummary: {
        status: 'completed',
        stopReason: 'final_response',
        toolCallCount: 2,
        successfulToolCalls: 2,
        failedToolCalls: 0,
        acceptanceVerified: 1,
        acceptanceFailed: 0,
        acceptanceNeedsReview: 0,
        lastToolName: 'analyzeAssetContent',
        blockers: [],
        warnings: [],
        summaryText: '执行状态：已完成'
      }
    }
  ],
  isLoading: false,
  generatedAt: '2026-05-27T00:00:00.000Z'
});
assert(completed.status === 'completed', 'completed summary should drive completed status', completed);
assert(completed.source === 'message_evidence', 'completed inspector should cite message evidence', completed);
assert(completed.toolLabel.includes('2 次工具调用'), 'completed inspector should expose tool evidence', completed);
assert(completed.qa.verified === 1, 'completed inspector should expose QA verified count', completed);
assert(completed.evidenceItems.some((item) => item.id === 'request-lifecycle' && item.state === 'present'), 'completed inspector should expose lifecycle evidence', completed);

const blockedLifecycle = makeLifecycle({
  blockers: ['agent_tool_decision_contract_blocked'],
  warnings: ['缺少当前 Photoshop 文档读回证据。']
});
const failed = buildAgentProcessInspector({
  messages: [
    { id: 'u1', role: 'user' },
    {
      id: 'a2',
      role: 'assistant',
      agentRequestLifecycle: blockedLifecycle,
      executionSummary: {
        status: 'failed',
        stopReason: 'tool_preflight_blocked',
        toolCallCount: 0,
        successfulToolCalls: 0,
        failedToolCalls: 0,
        acceptanceVerified: 0,
        acceptanceFailed: 0,
        acceptanceNeedsReview: 1,
        blockers: ['工具执行前置检查未通过'],
        warnings: ['不会继续执行 Photoshop 写入。'],
        summaryText: '执行状态：未完成'
      }
    }
  ],
  isLoading: false,
  generatedAt: '2026-05-27T00:00:00.000Z'
});
assert(failed.status === 'failed', 'failed summary should drive failed status', failed);
assert(failed.blockers.includes('工具执行前置检查未通过'), 'failed inspector should expose summary blockers', failed);
assert(failed.blockers.includes('agent_tool_decision_contract_blocked'), 'failed inspector should merge lifecycle blockers', failed);
assert(failed.evidenceItems.some((item) => item.id === 'blockers' && item.state === 'blocked'), 'failed inspector should mark blocker evidence', failed);
assert(failed.qa.needsReview === 1, 'failed inspector should preserve review count', failed);

const combinedText = JSON.stringify({ empty, loading, completed, failed });
for (const forbidden of ['confidence', '置信', '等待响应', '请求已发送', '正在准备']) {
  assert(!combinedText.includes(forbidden), `inspector payload must not expose forbidden marker: ${forbidden}`);
}

const workbench = read('src/renderer/components/DesignAgentWorkbench.tsx');
const packageJson = read('package.json');
const changeBoundaries = read('scripts/report-change-boundaries.cjs');
const maintenance = read('scripts/validate-maintenance-hygiene.cjs');

assert(!workbench.includes("buildAgentProcessInspector"), 'Workbench should not mount the process inspector by default');
assert(!workbench.includes("useAppStore"), 'Workbench should not read message state only for a hidden inspector');
assert(!workbench.includes('data-testid="workbench-agent-process-status"'), 'Workbench should not expose process status in the default surface');
assert(!workbench.includes('data-testid="workbench-agent-process-evidence-list"'), 'Workbench should not expose process detail lists in the default surface');
assert(!workbench.includes('data-testid="workbench-agent-qa-summary"'), 'Workbench should not expose QA summary in the default surface');
assert(!workbench.includes('executeToolCall'), 'Workbench process inspector must not execute tools');
assert(!workbench.includes('processWithUnifiedAgent'), 'Workbench process inspector must not call Agent runtime');
assert(!workbench.includes('streamChatAsync'), 'Workbench process inspector must not call providers');
assert(!workbench.includes('window.designEcho'), 'Workbench process inspector must not call desktop APIs directly');
assert(packageJson.includes('"smoke:ui:agent-process-inspector"'), 'package script should expose agent process inspector smoke');
assert(packageJson.includes('smoke:ui:agent-process-inspector'), 'maintenance preflight should run agent process inspector smoke');
assert(changeBoundaries.includes('smoke:ui:agent-process-inspector'), 'change boundaries should include the process inspector validation');
assert(changeBoundaries.includes('agent-process-inspector'), 'change boundaries should include the shared process inspector contract');
assert(maintenance.includes('smoke-ui-agent-process-inspector.cjs'), 'maintenance hygiene should run/check process inspector smoke');
assert(exists('src/shared/agent-process-inspector.ts'), 'shared process inspector contract should exist');

console.log(JSON.stringify({
  success: true,
  checks: [
    'agent process inspector view model derives no-evidence, running, completed and failed states from message evidence',
    'inspector payload stays evidence-only and cannot claim design quality, provider thinking, provider calls or Photoshop writes',
    'Workbench no longer mounts the inspector in the default user surface',
    'package, maintenance preflight, change boundaries and maintenance hygiene are wired'
  ]
}, null, 2));
