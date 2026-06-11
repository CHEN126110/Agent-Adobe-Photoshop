const path = require('path');

require('ts-node').register({
  transpileOnly: true,
  project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const {
  buildAgentIntentDeliberationGate,
  isAgentIntentDeliberationGateBoundaryOk
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-intent-deliberation-gate.ts'));
const {
  buildAgentRequestLifecycle
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-request-lifecycle.ts'));
const {
  DesignAgentEngine
} = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-agent', 'engine.ts'));
const skillExecutors = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'index.ts'));
const {
  buildAgentDiagnosticEvidence
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-diagnostic-evidence.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function makeContext(userInput, overrides = {}) {
  return {
    userInput,
    conversationHistory: [],
    isPluginConnected: true,
    photoshopContext: {
      hasDocument: true,
      documentName: 'test.psd',
      activeLayerName: '图层 1',
      layerCount: 12
    },
    projectContext: {
      projectPath: 'C:/UXP/2.0/test-project',
      projectImageCount: 8
    },
    ...overrides
  };
}

function makeLifecycle(overrides = {}) {
  return buildAgentRequestLifecycle({
    userInput: overrides.userInput || '帮我关闭文档不保存',
    context: makeContext(overrides.userInput || '帮我关闭文档不保存'),
    routeSource: overrides.routeSource || 'model_router',
    route: overrides.route || 'skill_execution',
    skillId: overrides.skillId || 'document-management',
    intentSummary: overrides.intentSummary || '模型选择了文档管理能力。',
    reason: overrides.reason || '测试用生命周期证据。',
    executionKind: overrides.executionKind || 'deterministic_skill',
    blockers: overrides.blockers || []
  });
}

function assertGateBoundary(gate) {
  assert(gate.version === 'agent-intent-deliberation-gate/v0', 'gate version mismatch', gate);
  assert(gate.evidenceOnly === true, 'gate must be evidence-only', gate);
  assert(gate.userVisible === false, 'gate must stay hidden from user-visible thinking', gate);
  assert(gate.canClaimModelReasoning === false, 'gate must not claim model reasoning', gate);
  assert(gate.canClaimDesignQuality === false, 'gate must not claim design quality', gate);
  assert(gate.mustNotChangeRouting === true, 'gate must not change routing', gate);
  assert(gate.mustNotRunProvider === true, 'gate must not run provider', gate);
  assert(gate.mustNotRunPhotoshop === true, 'gate must not run Photoshop', gate);
  assert(isAgentIntentDeliberationGateBoundaryOk(gate) === true, 'boundary helper should pass', gate);
}

const modelSelectedGate = buildAgentIntentDeliberationGate({
  lifecycle: makeLifecycle()
});
assert(modelSelectedGate.status === 'model_selected', 'model_router skill route should be model_selected', modelSelectedGate);
assert(modelSelectedGate.modelConsulted === true, 'model_selected should mark model consulted', modelSelectedGate);
assert(modelSelectedGate.fallbackUsed === false, 'model_selected should not mark fallback', modelSelectedGate);
assertGateBoundary(modelSelectedGate);

const deterministicFallbackGate = buildAgentIntentDeliberationGate({
  lifecycle: makeLifecycle({
    routeSource: 'deterministic_route',
    reason: '模型路由未覆盖时，使用确定性路由执行对应能力。'
  })
});
assert(deterministicFallbackGate.status === 'deterministic_fallback', 'deterministic route should be fallback', deterministicFallbackGate);
assert(deterministicFallbackGate.modelConsulted === false, 'fallback helper should not fabricate model consultation', deterministicFallbackGate);
assert(deterministicFallbackGate.fallbackUsed === true, 'deterministic route should mark fallback', deterministicFallbackGate);
assertGateBoundary(deterministicFallbackGate);

const clarifyGate = buildAgentIntentDeliberationGate({
  lifecycle: makeLifecycle({
    route: 'clarification_needed',
    skillId: undefined,
    executionKind: 'none',
    reason: '模型路由判断信息不足，先向用户澄清。'
  })
});
assert(clarifyGate.status === 'clarify_first', 'clarification route should be clarify_first', clarifyGate);
assert(clarifyGate.nextAction === 'ask_user_clarification', 'clarify_first should ask user clarification', clarifyGate);
assertGateBoundary(clarifyGate);

const systemBlockedGate = buildAgentIntentDeliberationGate({
  lifecycle: makeLifecycle({
    routeSource: 'system',
    route: 'direct_response',
    skillId: 'matte-product',
    executionKind: 'none',
    blockers: ['抠图能力当前暂不从 Agent 对话端执行。'],
    reason: '抠图质量和性能尚未完成验收，暂不允许 Agent 自动触发抠图工具。'
  })
});
assert(systemBlockedGate.status === 'system_blocked', 'system route should be system_blocked', systemBlockedGate);
assert(systemBlockedGate.nextAction === 'respect_system_boundary', 'system_blocked should preserve system boundary', systemBlockedGate);
assertGateBoundary(systemBlockedGate);

const localFallbackGate = buildAgentIntentDeliberationGate({
  lifecycle: makeLifecycle({
    routeSource: 'lightweight_intent',
    route: 'direct_response',
    skillId: undefined,
    executionKind: 'none',
    reason: '轻量意图识别为 greeting，模型回复不可用后使用本地回复。'
  })
});
assert(localFallbackGate.status === 'model_unavailable_local_fallback', 'local fallback should be explicit', localFallbackGate);
assert(localFallbackGate.fallbackUsed === true, 'local fallback should mark fallback', localFallbackGate);
assertGateBoundary(localFallbackGate);

const originalGetSkillExecutor = skillExecutors.getSkillExecutor;
const originalExecuteSkillWithExecutor = skillExecutors.executeSkillWithExecutor;

async function runEngineChecks() {
  const executed = [];
  skillExecutors.getSkillExecutor = () => ({ id: 'fake' });
  skillExecutors.executeSkillWithExecutor = async (skillId, input) => {
    executed.push({ skillId, params: input.params });
    return { success: true, message: `${skillId} done`, toolResults: [{ toolName: skillId, success: true }] };
  };

  try {
    const engine = new DesignAgentEngine();
    const modelSkillResult = await engine.run(makeContext('帮我关闭文档不保存'), {
      callModel: async () => ({
        text: JSON.stringify({
          route: 'skill_execution',
          skillId: 'document-management',
          intentSummary: '关闭当前文档且不保存。',
          skillParams: { action: 'close', save: false }
        })
      })
    });
    assert(
      modelSkillResult.data?.agentIntentDeliberationGate?.status === 'model_selected',
      'engine should attach model_selected gate to model skill route',
      modelSkillResult.data
    );

    const fallbackResult = await engine.run(makeContext('帮我关闭文档不保存'), {
      callModel: async () => ({ text: '{}' })
    });
    assert(
      fallbackResult.data?.agentIntentDeliberationGate?.status === 'deterministic_fallback',
      'engine should attach deterministic_fallback gate after empty model route',
      fallbackResult.data
    );

    const clarificationResult = await engine.run(makeContext('帮我处理一下详情页'), {
      callModel: async () => ({
        text: JSON.stringify({
          route: 'clarification_needed',
          thinking: '详情页处理目标不明确。',
          clarificationQuestion: '你是要检查当前详情页模板，还是从零新建详情页？'
        })
      })
    });
    assert(
      clarificationResult.data?.agentIntentDeliberationGate?.status === 'clarify_first',
      'engine should attach clarify_first gate',
      clarificationResult.data
    );

    const pausedMattingResult = await engine.run(makeContext('帮我抠图'), {
      callModel: async () => ({ text: 'should-not-be-called' })
    });
    assert(
      pausedMattingResult.data?.agentIntentDeliberationGate?.status === 'system_blocked',
      'engine should attach system_blocked gate for paused matting',
      pausedMattingResult.data
    );

    const localFallbackResult = await engine.run(makeContext('你好啊'), {});
    assert(
      localFallbackResult.data?.agentIntentDeliberationGate?.status === 'model_unavailable_local_fallback',
      'engine should attach local fallback gate when no provider is available',
      localFallbackResult.data
    );

    const diagnosticEvidence = buildAgentDiagnosticEvidence(modelSkillResult.data);
    assert(
      diagnosticEvidence?.evidenceKeys?.includes('agentIntentDeliberationGate'),
      'diagnostic evidence should expose the deliberation gate as hidden evidence',
      diagnosticEvidence
    );

    const serialized = JSON.stringify({
      modelSkillResult,
      fallbackResult,
      clarificationResult,
      pausedMattingResult,
      localFallbackResult,
      diagnosticEvidence
    });
    assert(!serialized.includes('正在准备'), 'gate must not emit pseudo waiting copy');
    assert(!serialized.includes('等待响应'), 'gate must not emit pseudo waiting copy');
    assert(!serialized.includes('模型真实思考'), 'gate must not pretend to be model thinking');

    return executed;
  } finally {
    skillExecutors.getSkillExecutor = originalGetSkillExecutor;
    skillExecutors.executeSkillWithExecutor = originalExecuteSkillWithExecutor;
  }
}

runEngineChecks().then((executed) => {
  console.log(JSON.stringify({
    success: true,
    executedCount: executed.length,
    statuses: [
      modelSelectedGate.status,
      deterministicFallbackGate.status,
      clarifyGate.status,
      systemBlockedGate.status,
      localFallbackGate.status
    ],
    checks: [
      'shared gate classifies model selected',
      'shared gate classifies deterministic fallback',
      'shared gate classifies clarify first',
      'shared gate classifies system blocked',
      'shared gate classifies local fallback',
      'engine attaches gate to runtime result data',
      'diagnostic evidence carries gate hidden-only'
    ]
  }, null, 2));
}).catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
