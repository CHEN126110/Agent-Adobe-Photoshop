#!/usr/bin/env node

const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  buildAgentRequestLifecycle
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-request-lifecycle.ts'));
const {
  buildAgentExecutionLifecycleSnapshot,
  isAgentExecutionLifecycleBoundaryOk
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-execution-lifecycle.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function makeLifecycle(overrides = {}) {
  return buildAgentRequestLifecycle({
    userInput: overrides.userInput || '帮我调整图层顺序',
    context: {
      isPluginConnected: overrides.isPluginConnected !== false,
      photoshopContext: {
        hasDocument: overrides.hasDocument !== false,
        documentName: 'C-1141.psd',
        layerCount: 4
      }
    },
    routeSource: overrides.routeSource || 'deterministic_route',
    route: overrides.route || 'skill_execution',
    skillId: Object.prototype.hasOwnProperty.call(overrides, 'skillId') ? overrides.skillId : 'layer-management',
    executionKind: overrides.executionKind || 'deterministic_skill',
    reason: '测试用 lifecycle 证据。',
    blockers: overrides.blockers || [],
    warnings: overrides.warnings || []
  });
}

function assertBoundary(snapshot) {
  assert(snapshot.evidenceOnly === true, 'snapshot must be evidence-only', snapshot);
  assert(snapshot.userVisible === true, 'snapshot must be user visible', snapshot);
  assert(snapshot.isProviderThinking === false, 'snapshot must not claim provider thinking', snapshot);
  assert(snapshot.canClaimModelReasoning === false, 'snapshot must not claim model reasoning', snapshot);
  assert(snapshot.canClaimTaskCompletion === false, 'snapshot must not claim task completion', snapshot);
  assert(snapshot.mustNotRunProvider === true, 'snapshot must not run provider', snapshot);
  assert(snapshot.mustNotRunPhotoshop === true, 'snapshot must not run Photoshop', snapshot);
  assert(isAgentExecutionLifecycleBoundaryOk(snapshot) === true, 'boundary helper should pass', snapshot);
}

const initial = buildAgentExecutionLifecycleSnapshot({
  visibleActivity: {
    title: '当前执行',
    kind: 'router',
    agentId: 'agent-router',
    agentLabel: 'Agent Router',
    source: 'initial',
    userVisible: true,
    showAsThinking: false,
    isProviderThinking: false,
    canClaimModelReasoning: false
  }
});
assert(initial.phase === 'routing', 'missing lifecycle should show routing phase', initial);
assert(initial.actor.label === 'Agent Router', 'initial actor should be Agent Router', initial);
assert(initial.requiredNextEvidence.includes('agent_request_lifecycle_required'), 'missing lifecycle should require lifecycle evidence', initial);
assertBoundary(initial);

const skillReady = buildAgentExecutionLifecycleSnapshot({
  lifecycle: makeLifecycle(),
  visibleActivity: {
    title: '当前执行',
    kind: 'skill',
    agentId: 'layer-management',
    agentLabel: 'Layer Management',
    source: 'skill_event',
    userVisible: true,
    showAsThinking: false,
    isProviderThinking: false,
    canClaimModelReasoning: false
  },
  status: 'running',
  toolCallCount: 0
});
assert(skillReady.phase === 'executing_skill', 'deterministic skill should show executing_skill phase', skillReady);
assert(skillReady.actor.id === 'layer-management', 'skill actor should come from visible activity', skillReady);
assert(skillReady.route.skillId === 'layer-management', 'snapshot should preserve skill id', skillReady);
assertBoundary(skillReady);

const toolRunning = buildAgentExecutionLifecycleSnapshot({
  lifecycle: makeLifecycle(),
  status: 'running',
  toolCallCount: 2,
  activeToolName: 'reorderLayer'
});
assert(toolRunning.phase === 'executing_tools', 'active tool evidence should show executing_tools phase', toolRunning);
assert(toolRunning.toolEvidence.activeToolName === 'reorderLayer', 'active tool name should be preserved', toolRunning);
assertBoundary(toolRunning);

const blocked = buildAgentExecutionLifecycleSnapshot({
  lifecycle: makeLifecycle({
    isPluginConnected: false,
    hasDocument: false
  }),
  status: 'running'
});
assert(blocked.phase === 'waiting_for_context', 'blocked lifecycle should show waiting_for_context phase', blocked);
assert(blocked.blockers.length > 0, 'blocked lifecycle should expose blockers', blocked);
assertBoundary(blocked);

const completedChat = buildAgentExecutionLifecycleSnapshot({
  lifecycle: makeLifecycle({
    route: 'direct_response',
    routeSource: 'model_router',
    skillId: undefined,
    executionKind: 'none'
  }),
  status: 'completed',
  toolCallCount: 0
});
assert(completedChat.phase === 'completed', 'completed direct response should show completed phase', completedChat);
assert(completedChat.route.route === 'direct_response', 'direct response route should be preserved', completedChat);
assert(completedChat.toolEvidence.toolCallCount === 0, 'chat response should have no tools', completedChat);
assertBoundary(completedChat);

const serialized = JSON.stringify({
  initial,
  skillReady,
  toolRunning,
  blocked,
  completedChat
});
assert(!serialized.includes('正在准备'), 'snapshot must not contain fake waiting copy');
assert(!serialized.includes('等待响应'), 'snapshot must not contain fake waiting copy');
assert(!serialized.includes('模型真实思考'), 'snapshot must not claim model thinking');

console.log(JSON.stringify({
  success: true,
  checks: [
    'missing lifecycle remains routing evidence without fake thinking',
    'deterministic skill lifecycle maps to executing_skill',
    'active tool evidence maps to executing_tools',
    'blocked Photoshop context maps to waiting_for_context',
    'completed direct response maps to completed',
    'snapshot boundary forbids provider, Photoshop and model-reasoning claims'
  ]
}, null, 2));
