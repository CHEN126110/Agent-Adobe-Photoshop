const fs = require('fs');
const path = require('path');
require('ts-node').register({ transpileOnly: true, project: path.resolve(__dirname, '..', 'tsconfig.main.json') });

const {
  buildAgentIntentControlPlaneDecision
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-intent-control-plane.ts'));
const {
  buildAgentRequestLifecycle
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-request-lifecycle.ts'));
const {
  buildAgentTaskPlanningContract
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-task-planning-contract.ts'));
const {
  buildAgentTaskPublicPlanExecutionRequest
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-task-public-plan-execution-request.ts'));
const {
  buildAgentTaskPublicPlanApprovalRecord
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-task-public-plan-approval-record.ts'));
const {
  runAgentTaskPublicPlanControlledRunner
} = require(path.resolve(__dirname, '..', 'src', 'shared', 'agent-task-public-plan-controlled-runner.ts'));
const { DesignAgentEngine } = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'design-agent', 'engine.ts'));
const skillExecutors = require(path.resolve(__dirname, '..', 'src', 'renderer', 'services', 'skill-executors', 'index.ts'));

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeReport(payload) {
  const outDir = path.join(__dirname, '..', 'tmp');
  ensureDir(outDir);
  const jsonPath = path.join(outDir, 'agent-planning-contract-smoke.json');
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  return { json: jsonPath };
}

function assert(condition, message, details) {
  if (!condition) {
    const error = new Error(message);
    error.details = details;
    throw error;
  }
}

function createContext(userInput, overrides = {}) {
  const base = {
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
      projectImageCount: 8,
      projectImageFolders: [],
      sampleImagePaths: []
    }
  };

  return {
    ...base,
    ...overrides,
    photoshopContext: {
      ...base.photoshopContext,
      ...(overrides.photoshopContext || {})
    },
    projectContext: {
      ...base.projectContext,
      ...(overrides.projectContext || {})
    }
  };
}

function lifecycleFor(input, routeOptions = {}) {
  return buildAgentRequestLifecycle({
    userInput: input,
    context: createContext(input),
    ...routeOptions
  });
}

function planFor(input, routeOptions = {}) {
  const intentControlPlane = buildAgentIntentControlPlaneDecision({
    userInput: input,
    hasDocument: true,
    photoshopConnected: true
  });
  const lifecycle = lifecycleFor(input, routeOptions);
  return buildAgentTaskPlanningContract({
    userInput: input,
    intentControlPlane,
    lifecycle,
    context: createContext(input),
    skillId: routeOptions.skillId,
    mode: routeOptions.mode,
    skillParams: routeOptions.skillParams
  });
}

function containsForbiddenField(value, pathParts = []) {
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...pathParts, key];
    if (/confidence|置信/i.test(key)) return childPath.join('.');
    if (key !== 'rawPayloadRedacted'
      && /(localPath|projectPath|filePath|thumbnailPath|sampleImagePaths|selectedProjectImagePath|rawSnapshot|rawPayload|imageData|base64|score)/i.test(key)) {
      return childPath.join('.');
    }
    if (typeof child === 'string' && /(data:image|base64,|[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/])/i.test(child)) return childPath.join('.');
    const nested = containsForbiddenField(child, childPath);
    if (nested) return nested;
  }
  return null;
}

async function run() {
  const cases = [];

  function record(name, fn) {
    try {
      const details = fn();
      cases.push({ name, status: 'pass', details: JSON.stringify(details || {}) });
    } catch (error) {
      cases.push({
        name,
        status: 'fail',
        details: JSON.stringify({
          message: error.message,
          details: error.details || null
        })
      });
    }
  }

  record('capability-question-produces-direct-response-plan-without-tools', () => {
    const plan = planFor('你都能帮我做什么', {
      routeSource: 'intent_control_plane',
      route: 'direct_response',
      reason: '能力询问'
    });
    assert(plan.version === 'agent-task-planning-contract/v0', 'wrong version', plan);
    assert(plan.status === 'ready_direct_response', 'capability question should be direct response', plan);
    assert(plan.allowedToolScope === 'none', 'capability question must not allow tools', plan);
    assert(plan.executionPlan.canExecuteTools === false, 'direct response must not execute tools', plan);
    assert(plan.executionPlan.steps.length === 1, 'direct response plan should have one answer step', plan);
    assert(plan.qualityClaim.canClaimDesignComplete === false, 'must not claim design complete', plan);
    assert(!containsForbiddenField(plan), 'plan contains forbidden confidence/raw field', containsForbiddenField(plan));
    return plan;
  });

  record('ambiguous-request-blocks-before-tools-and-lists-missing-brief-fields', () => {
    const plan = planFor('帮我处理一下', {
      routeSource: 'intent_control_plane',
      route: 'clarification_needed',
      reason: '缺少目标'
    });
    assert(plan.status === 'blocked_needs_clarification', 'ambiguous request should block', plan);
    assert(plan.executionPlan.canExecuteTools === false, 'ambiguous request must not execute tools', plan);
    assert(plan.blockers.includes('missing_target'), 'should require target', plan);
    assert(plan.blockers.includes('missing_action'), 'should require action', plan);
    assert(plan.blockers.includes('missing_deliverable'), 'should require deliverable', plan);
    return plan;
  });

  record('project-overview-produces-readonly-plan-only', () => {
    const plan = planFor('当前是什么项目', {
      routeSource: 'deterministic_route',
      route: 'skill_execution',
      skillId: 'project-image-analysis',
      skillParams: { analysisMode: 'content' },
      reason: '只读项目概览'
    });
    assert(plan.status === 'ready_read_only_plan', 'project overview should be read-only', plan);
    assert(plan.allowedToolScope === 'read_only', 'project overview must only allow read-only scope', plan);
    assert(plan.executionPlan.canExecuteTools === true, 'read-only inspection can execute read-only tool', plan);
    assert(plan.executionPlan.steps.every((step) => step.allowedToolScope !== 'write_photoshop'), 'read-only plan must not include write steps', plan);
    assert(plan.executionPlan.steps.some((step) => step.allowedToolScope === 'read_only'), 'read-only plan should include at least one read-only inspection step', plan);
    assert(plan.designBrief.deliverables.includes('project_overview'), 'should deliver project overview', plan);
    return plan;
  });

  record('sku-request-produces-business-design-plan-with-self-select-notes', () => {
    const plan = planFor('帮我做SKU', {
      routeSource: 'model_router',
      route: 'skill_execution',
      skillId: 'sku-batch',
      skillParams: {},
      reason: 'SKU 执行'
    });
    assert(plan.status === 'ready_for_controlled_execution_plan', 'sku should be controlled execution plan', plan);
    assert(plan.designBrief.scenario === 'sku', 'sku scenario expected', plan);
    assert(plan.designBrief.deliverables.includes('sku_color_combinations'), 'SKU should include color combinations', plan);
    assert(plan.designBrief.deliverables.includes('sku_self_select_notes'), 'SKU should include self-select notes by default', plan);
    assert(plan.requiredEvidence.includes('project_sku_document'), 'SKU should require project SKU document evidence', plan);
    assert(plan.requiredEvidence.includes('project_asset_index'), 'SKU should require project asset index', plan);
    assert(plan.executionPlan.steps.some((step) => step.phase === 'inspect' && step.allowedToolScope === 'read_only'), 'SKU needs inspect step', plan);
    assert(plan.executionPlan.steps.some((step) => step.phase === 'execute' && step.skillId === 'sku-batch'), 'SKU needs controlled execute step', plan);
    assert(plan.executionPlan.steps.some((step) => step.phase === 'verify'), 'SKU needs verify step', plan);
    return plan;
  });

  record('open-design-request-requires-model-plan-before-autonomous-tools', () => {
    const plan = planFor('帮我根据当前画面做一个更高级的设计', {
      routeSource: 'model_router',
      route: 'autonomous_agent',
      skillId: 'autonomous-agent',
      reason: '开放式设计'
    });
    assert(plan.status === 'ready_for_model_planning', 'open design should require model planning', plan);
    assert(plan.allowedToolScope === 'write_photoshop', 'open design may eventually write after planning', plan);
    assert(plan.executionPlan.canExecuteTools === false, 'open design plan must not execute tools before model plan', plan);
    assert(plan.requiredEvidence.includes('design_brief'), 'open design needs design brief', plan);
    assert(plan.requiredEvidence.includes('verification_targets'), 'open design needs verification targets', plan);
    return plan;
  });

  function openDesignTaskPlan() {
    return planFor('帮我根据当前画面做一个更高级的设计', {
      routeSource: 'model_router',
      route: 'autonomous_agent',
      skillId: 'autonomous-agent',
      reason: '开放式设计'
    });
  }

  function publicPlan(overrides = {}) {
    return {
      status: 'ready',
      canExecuteTools: false,
      message: '公开设计计划：确认 C:/UXP/2.0/C-1163/open-design.psd 后，再创建标题文字并移动图层。',
      proposedWriteTools: ['createTextLayer', 'moveLayer'],
      readbackTargets: ['layer_hierarchy', 'acceptance_snapshot'],
      executionPlanSummary: '根据 C:/UXP/2.0/C-1163/open-design.psd 创建标题文字并移动图层，执行后读回验收快照。',
      ...overrides
    };
  }

  function publicPlanRuntimeOperations() {
    return [{
      operationId: 'public-plan-op-title',
      toolName: 'createTextLayer',
      params: { content: '轻盈透气', x: 160, y: 180, fontSize: 48 },
      readbackTargets: ['layer_hierarchy', 'acceptance_snapshot']
    }, {
      operationId: 'public-plan-op-title-offset',
      toolName: 'moveLayer',
      params: { layerId: 501, x: 20, y: 0, relative: true },
      readbackTargets: ['acceptance_snapshot']
    }];
  }

  record('public-plan-confirmed-request-still-blocks-until-controlled-runner-enabled', () => {
    const request = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan: openDesignTaskPlan(),
      publicPlan: publicPlan(),
      userConfirmed: true
    });
    assert(request.status === 'blocked_execution_request_disabled', 'confirmed public plan must still block by default', request);
    assert(request.userConfirmed === true, 'request should record user confirmation', request);
    assert(request.canStartControlledRunner === false, 'request must not start runner without explicit enable', request);
    assert(request.shouldRunPhotoshop === false, 'request must not write Photoshop', request);
    assert(request.mustNotRunWriteTools === true, 'request must not run write tools', request);
    assert(request.approvedWriteTools.includes('createTextLayer'), 'request should keep approved write tool list', request);
    assert(!containsForbiddenField(request), 'request contains forbidden confidence/raw field', containsForbiddenField(request));
    return request;
  });

  record('public-plan-request-ready-only-after-confirmation-and-explicit-runner-enable', () => {
    const request = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan: openDesignTaskPlan(),
      publicPlan: publicPlan(),
      userConfirmed: true,
      enableControlledExecutionRequest: true
    });
    assert(request.status === 'ready_for_controlled_execution_request', 'request should only become ready after explicit enable', request);
    assert(request.canStartControlledRunner === true, 'request should allow controlled runner handoff', request);
    assert(request.shouldRunPhotoshop === false, 'request itself must not write Photoshop', request);
    assert(request.operationRequests.length === 2, 'request should create one operation request per proposed write tool', request);
    assert(request.operationRequests.every((item) => item.readbackTargets.includes('acceptance_snapshot')), 'operation request should require readback', request);
    assert(!containsForbiddenField(request), 'request contains forbidden confidence/raw field', containsForbiddenField(request));
    return request;
  });

  record('public-plan-request-blocks-unapproved-write-tools', () => {
    const request = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan: openDesignTaskPlan(),
      publicPlan: publicPlan({
        proposedWriteTools: ['createTextLayer', 'executeScript']
      }),
      runtimeAllowedWriteTools: ['createTextLayer'],
      userConfirmed: true,
      enableControlledExecutionRequest: true
    });
    assert(request.status === 'blocked_write_tool_not_allowed', 'unapproved write tool should block', request);
    assert(request.blockedWriteTools.includes('executeScript'), 'blocked tool should be surfaced', request);
    assert(request.canStartControlledRunner === false, 'blocked request must not start runner', request);
    assert(request.mustNotRunWriteTools === true, 'blocked request must not run write tools', request);
    return request;
  });

  record('public-plan-request-blocks-missing-write-tool-plan', () => {
    const request = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan: openDesignTaskPlan(),
      publicPlan: publicPlan({
        proposedWriteTools: [],
        writeToolAllowlist: []
      }),
      userConfirmed: true,
      enableControlledExecutionRequest: true
    });
    assert(request.status === 'blocked_missing_write_tool_allowlist', 'missing proposed write tools should block', request);
    assert(request.canStartControlledRunner === false, 'missing tool plan must not start runner', request);
    assert(request.operationRequests.length === 0, 'missing write tools must not create operations', request);
    return request;
  });

  record('public-plan-request-blocks-missing-readback-targets', () => {
    const request = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan: openDesignTaskPlan(),
      publicPlan: publicPlan({
        readbackTargets: []
      }),
      userConfirmed: true,
      enableControlledExecutionRequest: true
    });
    assert(request.status === 'blocked_missing_readback_targets', 'missing readback targets should block', request);
    assert(request.canStartControlledRunner === false, 'missing readback targets must not start runner', request);
    assert(request.operationRequests.length === 0, 'missing readback targets must not create operations', request);
    return request;
  });

  record('public-plan-approval-record-uses-selected-pending-request-without-tools', () => {
    const agentTaskPlan = openDesignTaskPlan();
    const selectedPlan = publicPlan({
      message: '公开设计计划：用户选择的计划。',
      executionPlanSummary: '用户选择的计划执行摘要。'
    });
    const newerPlan = publicPlan({
      message: '公开设计计划：较新的待确认计划。',
      executionPlanSummary: '较新的待确认计划执行摘要。'
    });
    const selectedPendingRequest = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan,
      publicPlan: selectedPlan
    });
    const newerPendingRequest = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan,
      publicPlan: newerPlan
    });
    const record = buildAgentTaskPublicPlanApprovalRecord({
      userInput: '确认执行公开计划',
      sourceMessageId: 'selected-public-plan',
      conversationHistory: [{
        id: 'selected-public-plan',
        role: 'assistant',
        content: selectedPlan.message,
        agentTaskPlan,
        agentTaskPublicPlan: selectedPlan,
        agentTaskPublicPlanExecutionRequest: selectedPendingRequest
      }, {
        id: 'newer-public-plan',
        role: 'assistant',
        content: newerPlan.message,
        agentTaskPlan,
        agentTaskPublicPlan: newerPlan,
        agentTaskPublicPlanExecutionRequest: newerPendingRequest
      }]
    });
    assert(selectedPendingRequest.status === 'blocked_pending_user_confirmation', 'fixture pending request should stay pending', selectedPendingRequest);
    assert(record.status === 'approved_controlled_execution_request', 'approval record should approve selected pending request', record);
    assert(record.userConfirmed === true, 'approval should record explicit confirmation', record);
    assert(record.enableControlledExecutionRequest === true, 'approval should enable controlled request handoff', record);
    assert(record.mustNotRunWriteTools === true, 'approval record must not execute write tools', record);
    assert(record.allowedWriteTools.includes('createTextLayer'), 'approval should preserve allowed write tools', record);
    assert(record.sourceMessageId === 'selected-public-plan', 'approval should preserve selected source message id', record);
    assert(record.agentTaskPublicPlan?.message === '公开设计计划：用户选择的计划。', 'approval should not switch to a newer pending plan', record);
    assert(!containsForbiddenField(record), 'approval record contains forbidden confidence/raw field', containsForbiddenField(record));
    return record;
  });

  record('public-plan-controlled-runner-defaults-to-dry-run-without-tools', () => {
    const request = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan: openDesignTaskPlan(),
      publicPlan: publicPlan(),
      userConfirmed: true,
      enableControlledExecutionRequest: true
    });
    const run = runAgentTaskPublicPlanControlledRunner({ request });
    assert(run.version === 'agent-task-public-plan-controlled-runner/v0', 'controlled runner should expose stable version', run);
    assert(run.status === 'completed_dry_run', 'controlled runner should default to dry-run', run);
    assert(run.executionTarget === 'dry-run', 'default target should be dry-run', run);
    assert(run.shouldRunPhotoshop === false, 'dry-run must not write Photoshop', run);
    assert(run.mustNotRunWriteTools === true, 'dry-run must not run write tools', run);
    assert(run.executedWriteTools.length === 0, 'dry-run must not record executed write tools', run);
    assert(run.operationRequests.length === request.operationRequests.length, 'dry-run should preserve operation requests', run);
    assert(run.readbackTargets.includes('acceptance_snapshot'), 'dry-run should preserve readback targets', run);
    assert(!containsForbiddenField(run), 'controlled runner contains forbidden confidence/raw field', containsForbiddenField(run));
    return run;
  });

  record('public-plan-controlled-runner-fake-adapter-requires-readback-and-stops-on-failure', () => {
    const request = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan: openDesignTaskPlan(),
      publicPlan: publicPlan(),
      userConfirmed: true,
      enableControlledExecutionRequest: true
    });
    const missingAdapterRun = runAgentTaskPublicPlanControlledRunner({
      request,
      executionTarget: 'fake-adapter'
    });
    assert(missingAdapterRun.status === 'blocked_adapter_required', 'fake runner should require adapter', missingAdapterRun);

    const missingReadbackRun = runAgentTaskPublicPlanControlledRunner({
      request,
      executionTarget: 'fake-adapter',
      adapter: {
        runWriteOperation: () => ({ success: true })
      }
    });
    assert(missingReadbackRun.status === 'blocked_readback_adapter_required', 'fake runner should require readback adapter', missingReadbackRun);

    const verifiedRun = runAgentTaskPublicPlanControlledRunner({
      request,
      executionTarget: 'fake-adapter',
      adapter: {
        runWriteOperation: (operation) => ({ success: true, data: { operationId: operation.operationId } }),
        readbackAfterOperation: (_operation, target) => ({ success: true, data: { target } })
      }
    });
    assert(verifiedRun.status === 'completed_fake_adapter_verified', 'fake runner should execute and read back', verifiedRun);
    assert(verifiedRun.operationResults.length === request.operationRequests.length, 'fake runner should execute all operations', verifiedRun);
    assert(verifiedRun.readbackResults.length === request.operationRequests.length * request.readbackTargets.length, 'fake runner should read back after each operation', verifiedRun);
    assert(verifiedRun.mustNotRunWriteTools === true, 'fake runner must still avoid real write tools', verifiedRun);

    const failedWriteRun = runAgentTaskPublicPlanControlledRunner({
      request,
      executionTarget: 'fake-adapter',
      adapter: {
        runWriteOperation: () => ({ success: false, error: 'fake write failed' }),
        readbackAfterOperation: () => ({ success: true })
      }
    });
    assert(failedWriteRun.status === 'failed_write_operation', 'fake runner should stop on write failure', failedWriteRun);
    assert(failedWriteRun.readbackResults.length === 0, 'fake runner should not read back after failed write', failedWriteRun);

    const failedReadbackRun = runAgentTaskPublicPlanControlledRunner({
      request,
      executionTarget: 'fake-adapter',
      adapter: {
        runWriteOperation: () => ({ success: true }),
        readbackAfterOperation: (_operation, target) => (
          target === 'acceptance_snapshot'
            ? { success: false, error: 'acceptance readback failed' }
            : { success: true }
        )
      }
    });
    assert(failedReadbackRun.status === 'failed_readback', 'fake runner should stop on readback failure', failedReadbackRun);
    assert(String(failedReadbackRun.readbackResults.at(-1)?.error || '').includes('acceptance readback failed'), 'readback failure should preserve reason', failedReadbackRun);
    return {
      missingAdapterRun,
      missingReadbackRun,
      verifiedRun,
      failedWriteRun,
      failedReadbackRun
    };
  });

  record('public-plan-controlled-live-runner-requires-permission-adapter-and-replayable-params', () => {
    const summaryOnlyRequest = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan: openDesignTaskPlan(),
      publicPlan: publicPlan(),
      userConfirmed: true,
      enableControlledExecutionRequest: true
    });
    const withoutPermissionRun = runAgentTaskPublicPlanControlledRunner({
      request: summaryOnlyRequest,
      executionTarget: 'live-photoshop'
    });
    assert(withoutPermissionRun.status === 'blocked_live_write_permission_missing', 'live public-plan runner should require explicit write permission', withoutPermissionRun);
    assert(withoutPermissionRun.evidenceOnly === true, 'blocked live public-plan runner should remain evidence-only', withoutPermissionRun);
    assert(withoutPermissionRun.shouldRunPhotoshop === false, 'blocked live public-plan runner must not run Photoshop', withoutPermissionRun);
    assert(withoutPermissionRun.executedWriteTools.length === 0, 'blocked live public-plan runner must not record writes', withoutPermissionRun);

    const permissionWithoutTargetRun = runAgentTaskPublicPlanControlledRunner({
      request: summaryOnlyRequest,
      allowPhotoshopWrites: true,
      adapter: {
        runWriteOperation: () => ({ success: true }),
        readbackAfterOperation: () => ({ success: true })
      }
    });
    assert(permissionWithoutTargetRun.status === 'completed_dry_run', 'write permission alone should not switch public-plan runner into live Photoshop target', permissionWithoutTargetRun);
    assert(permissionWithoutTargetRun.executedWriteTools.length === 0, 'write permission without live target must not execute writes', permissionWithoutTargetRun);

    const missingAdapterRun = runAgentTaskPublicPlanControlledRunner({
      request: summaryOnlyRequest,
      executionTarget: 'live-photoshop',
      allowPhotoshopWrites: true
    });
    assert(missingAdapterRun.status === 'blocked_live_adapter_required', 'live public-plan runner should require injected adapter', missingAdapterRun);
    assert(missingAdapterRun.executedWriteTools.length === 0, 'missing live adapter must block before writes', missingAdapterRun);

    let missingParamsCalls = 0;
    const missingParamsRun = runAgentTaskPublicPlanControlledRunner({
      request: summaryOnlyRequest,
      executionTarget: 'live-photoshop',
      allowPhotoshopWrites: true,
      adapter: {
        runWriteOperation: () => {
          missingParamsCalls += 1;
          return { success: true };
        },
        readbackAfterOperation: () => ({ success: true })
      }
    });
    assert(missingParamsRun.status === 'blocked_live_operation_params_required', 'live public-plan runner should not infer write params from summaries', missingParamsRun);
    assert(missingParamsCalls === 0, 'missing params should block before adapter calls', missingParamsRun);

    const replayableRequest = buildAgentTaskPublicPlanExecutionRequest({
      agentTaskPlan: openDesignTaskPlan(),
      publicPlan: publicPlan(),
      runtimeOperationRequests: publicPlanRuntimeOperations(),
      userConfirmed: true,
      enableControlledExecutionRequest: true
    });
    const liveAdapter = {
      calls: [],
      readbacks: [],
      runWriteOperation: (operation) => {
        liveAdapter.calls.push(operation);
        return { success: true, data: { operationId: operation.operationId, toolName: operation.toolName } };
      },
      readbackAfterOperation: (operation, target) => {
        liveAdapter.readbacks.push({ operation, target });
        return { success: true, data: { target, operationId: operation.operationId } };
      }
    };
    const verifiedRun = runAgentTaskPublicPlanControlledRunner({
      request: replayableRequest,
      executionTarget: 'live-photoshop',
      allowPhotoshopWrites: true,
      adapter: liveAdapter
    });
    assert(replayableRequest.operationRequests.every((operation) => operation.params), 'replayable public-plan request should preserve runtime operation params', replayableRequest);
    assert(verifiedRun.status === 'completed_live_adapter_verified', 'live public-plan runner should execute through injected adapter after all gates', verifiedRun);
    assert(verifiedRun.evidenceOnly === false, 'successful live public-plan runner should no longer be evidence-only', verifiedRun);
    assert(verifiedRun.shouldRunPhotoshop === true, 'successful live public-plan runner should expose Photoshop execution', verifiedRun);
    assert(verifiedRun.mustNotRunWriteTools === false, 'successful live public-plan runner should allow writes only through adapter', verifiedRun);
    assert(liveAdapter.calls.length === replayableRequest.operationRequests.length, 'live adapter should execute every replayable operation', liveAdapter.calls);
    assert(liveAdapter.readbacks.length === replayableRequest.operationRequests.reduce((count, operation) => count + operation.readbackTargets.length, 0), 'live adapter should read back after every write', liveAdapter.readbacks);
    assert(verifiedRun.executedWriteTools.join(',') === 'createTextLayer,moveLayer', 'live run should record adapter-executed write tools', verifiedRun);
    assert(!containsForbiddenField(verifiedRun), 'verified live public-plan run contains forbidden confidence/raw field', containsForbiddenField(verifiedRun));
    return {
      withoutPermissionRun,
      permissionWithoutTargetRun,
      missingAdapterRun,
      missingParamsRun,
      verifiedRun
    };
  });

  const originalGetSkillExecutor = skillExecutors.getSkillExecutor;
  const originalExecuteSkillWithExecutor = skillExecutors.executeSkillWithExecutor;
  const engine = new DesignAgentEngine();
  let executed = [];
  skillExecutors.getSkillExecutor = (skillId) => ({ id: skillId, execute: async () => ({ success: true }) });
  skillExecutors.executeSkillWithExecutor = async (skillId, payload) => {
    executed.push({ skillId, params: payload?.params || null });
    return { success: true, message: `executed:${skillId}` };
  };

  try {
    const result = await engine.run(createContext('当前是什么项目'), {
      callModel: async () => ({
        text: JSON.stringify({
          route: 'autonomous_agent',
          thinking: '错误地想进入自主工具循环。'
        })
      })
    });
    cases.push({
      name: 'engine-attaches-agent-task-plan-to-results',
      status:
        result?.data?.agentTaskPlan?.version === 'agent-task-planning-contract/v0'
        && result?.data?.agentTaskPlan?.status === 'ready_read_only_plan'
        && result?.data?.agentTaskPlan?.executionPlan?.canExecuteTools === true
        && executed.length === 1
        && executed[0].skillId === 'project-image-analysis'
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ result, executed })
    });

    executed = [];
    const autonomousResult = await engine.run(createContext('帮我根据当前画面做一个更高级的设计'), {
      callModel: async (_messages, requestOptions) => {
        if (requestOptions?.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'autonomous_agent',
              skillId: 'autonomous-agent',
              intentSummary: '用户要求基于当前画面做开放式设计。'
            })
          };
        }
        return { text: '' };
      }
    });
    cases.push({
      name: 'engine-blocks-autonomous-tools-when-agent-task-plan-needs-model-planning',
      status:
        autonomousResult?.success === false
        && autonomousResult?.error === 'agent_task_plan_requires_model_planning'
        && autonomousResult?.data?.agentTaskPlan?.status === 'ready_for_model_planning'
        && autonomousResult?.data?.agentTaskPlan?.executionPlan?.canExecuteTools === false
        && executed.length === 0
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ result: autonomousResult, executed })
    });

    executed = [];
    const plannedAutonomousResult = await engine.run(createContext('帮我根据当前画面做一个更高级的设计'), {
      callModel: async (_messages, requestOptions) => {
        if (requestOptions?.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'autonomous_agent',
              skillId: 'autonomous-agent',
              intentSummary: '用户要求基于当前画面做开放式设计。'
            })
          };
        }
        if (requestOptions?.purpose === 'agent_task_public_plan') {
          return {
            text: '公开设计计划：先读取当前画面和项目上下文，确认主视觉、信息层级、可修改范围和验收目标；再给出工具白名单，等待用户确认后才进入 Photoshop 执行。'
          };
        }
        return { text: '' };
      }
    });
    cases.push({
      name: 'engine-returns-public-model-plan-for-open-design-before-tools',
      status:
        plannedAutonomousResult?.success === true
        && /公开设计计划/.test(plannedAutonomousResult?.message || '')
        && plannedAutonomousResult?.data?.agentTaskPlan?.status === 'ready_for_model_planning'
        && plannedAutonomousResult?.data?.agentTaskPublicPlan?.source === 'model'
        && plannedAutonomousResult?.data?.agentTaskPublicPlan?.canExecuteTools === false
        && executed.length === 0
          ? 'pass'
          : 'fail',
      details: JSON.stringify({ result: plannedAutonomousResult, executed })
    });

    executed = [];
    let publicPlanPrompt = '';
    const readonlyCalls = [];
    const modelPurposes = [];
    const readonlyContextResult = await engine.run(createContext('帮我根据当前画面做一个更高级的设计', {
      photoshopContext: {
        documentName: 'open-design.psd',
        layerCount: 5
      },
      projectContext: {
        projectPath: 'C:/UXP/2.0/C-1163',
        projectImageCount: 8
      },
      resumeReadonlyToolHandlers: {
        getDocumentInfo: async () => {
          readonlyCalls.push('getDocumentInfo');
          return {
            name: 'open-design.psd',
            width: 1440,
            height: 1440,
            localPath: 'C:/UXP/2.0/C-1163/PSD/open-design.psd'
          };
        },
        getLayerHierarchy: async () => {
          readonlyCalls.push('getLayerHierarchy');
          return {
            layerCount: 5,
            groups: ['主视觉', '文案'],
            rawSnapshot: 'data:image/png;base64,SHOULD_NOT_LEAK'
          };
        },
        getProjectContextSnapshot: async () => {
          readonlyCalls.push('getProjectContextSnapshot');
          return {
            projectName: 'C-1163',
            projectPath: 'C:/UXP/2.0/C-1163',
            imageCount: 8
          };
        },
        getAcceptanceSnapshot: async () => {
          readonlyCalls.push('getAcceptanceSnapshot');
          return {
            documentName: 'open-design.psd',
            layerCount: 5,
            width: 1440,
            height: 1440
          };
        }
      }
    }), {
      callModel: async (messages, requestOptions) => {
        modelPurposes.push(requestOptions?.purpose || 'unknown');
        if (requestOptions?.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'autonomous_agent',
              skillId: 'autonomous-agent',
              intentSummary: '用户要求基于当前画面做开放式设计。'
            })
          };
        }
        if (requestOptions?.purpose === 'agent_task_public_plan') {
          publicPlanPrompt = messages.map((message) => String(message.content || '')).join('\n');
          return {
            text: '公开设计计划：先依据 open-design.psd、主视觉和 C-1163 的素材摘要确认设计方向，再说明排版、修图和验收目标；本轮不执行 Photoshop。'
          };
        }
        return { text: '' };
      }
    });
    cases.push({
      name: 'engine-refreshes-readonly-context-before-public-plan',
      status:
        readonlyContextResult?.success === true
        && readonlyContextResult?.data?.agentTaskPublicPlanReadonlyContext?.status === 'completed_readonly_refresh'
        && readonlyContextResult?.data?.agentTaskPublicPlanReadonlyContext?.completedTools?.includes('getDocumentInfo')
        && readonlyContextResult?.data?.agentTaskPublicPlanReadonlyContext?.completedTools?.includes('getLayerHierarchy')
        && readonlyContextResult?.data?.agentTaskPublicPlanReadonlyContext?.completedTools?.includes('getProjectContextSnapshot')
        && readonlyContextResult?.data?.agentTaskPlan?.executionPlan?.canExecuteTools === false
        && readonlyContextResult?.data?.agentTaskPublicPlan?.canExecuteTools === false
        && !readonlyContextResult?.data?.toolResults
        && readonlyCalls.length === 4
        && readonlyCalls.every((toolName) => [
          'getDocumentInfo',
          'getLayerHierarchy',
          'getProjectContextSnapshot',
          'getAcceptanceSnapshot',
          'getDocumentSnapshot'
        ].includes(toolName))
        && modelPurposes.length === 2
        && modelPurposes.every((purpose) => ['router', 'agent_task_public_plan'].includes(purpose))
        && /open-design\.psd/.test(publicPlanPrompt)
        && /主视觉/.test(publicPlanPrompt)
        && /C-1163/.test(publicPlanPrompt)
        && !/C:\/UXP\/2\.0/.test(publicPlanPrompt)
        && !/data:image|base64/i.test(publicPlanPrompt)
        && !containsForbiddenField(readonlyContextResult?.data?.agentTaskPublicPlanReadonlyContext)
        && executed.length === 0
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        result: readonlyContextResult,
        executed,
        publicPlanPrompt,
        readonlyCalls,
        modelPurposes
      })
    });

    executed = [];
    const publicPlanAuthorizationPurposes = [];
    const publicPlanAuthorizationResult = await engine.run(createContext('帮我根据当前画面做一个更高级的设计', {
      photoshopContext: {
        documentName: 'open-design.psd',
        layerCount: 5
      },
      projectContext: {
        projectPath: 'C:/UXP/2.0/C-1163',
        projectImageCount: 8
      }
    }), {
      callModel: async (_messages, requestOptions) => {
        publicPlanAuthorizationPurposes.push(requestOptions?.purpose || 'unknown');
        if (requestOptions?.purpose === 'router') {
          return {
            text: JSON.stringify({
              route: 'autonomous_agent',
              skillId: 'autonomous-agent',
              intentSummary: '用户要求基于当前画面做开放式设计。'
            })
          };
        }
        if (requestOptions?.purpose === 'agent_task_public_plan') {
          return {
            text: JSON.stringify({
              message: '公开设计计划：先确认 open-design.psd 的主视觉层级，再规划文案、图片置入和验收读回；等待用户确认后才允许受控执行。',
              writeToolAllowlist: ['createTextLayer', 'moveLayer'],
              readbackTargets: ['layer_hierarchy', 'acceptance_snapshot'],
              requiresUserConfirmation: true,
              executionPlanSummary: '创建标题文字并移动到安全区域，执行后读回图层层级和验收快照。'
            })
          };
        }
        return { text: '' };
      }
    });
    cases.push({
      name: 'engine-builds-public-plan-confirmation-request-without-running-tools',
      status:
        publicPlanAuthorizationResult?.success === true
        && /公开设计计划/.test(publicPlanAuthorizationResult?.message || '')
        && publicPlanAuthorizationResult?.data?.agentTaskPublicPlan?.proposedWriteTools?.includes('createTextLayer')
        && publicPlanAuthorizationResult?.data?.agentTaskPublicPlan?.proposedWriteTools?.includes('moveLayer')
        && publicPlanAuthorizationResult?.data?.agentTaskPublicPlan?.readbackTargets?.includes('layer_hierarchy')
        && publicPlanAuthorizationResult?.data?.agentTaskPublicPlanExecutionRequest?.version === 'agent-task-public-plan-execution-request/v0'
        && publicPlanAuthorizationResult?.data?.agentTaskPublicPlanExecutionRequest?.status === 'blocked_pending_user_confirmation'
        && publicPlanAuthorizationResult?.data?.agentTaskPublicPlanExecutionRequest?.requiresExplicitUserConfirmation === true
        && publicPlanAuthorizationResult?.data?.agentTaskPublicPlanExecutionRequest?.canStartControlledRunner === false
        && publicPlanAuthorizationResult?.data?.agentTaskPublicPlanExecutionRequest?.mustNotRunWriteTools === true
        && publicPlanAuthorizationResult?.data?.agentTaskPublicPlanExecutionRequest?.proposedWriteTools?.includes('createTextLayer')
        && publicPlanAuthorizationResult?.data?.agentTaskPublicPlanExecutionRequest?.readbackTargets?.includes('acceptance_snapshot')
        && !containsForbiddenField(publicPlanAuthorizationResult?.data?.agentTaskPublicPlanExecutionRequest)
        && publicPlanAuthorizationPurposes.every((purpose) => ['router', 'agent_task_public_plan'].includes(purpose))
        && executed.length === 0
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        result: publicPlanAuthorizationResult,
        executed,
        publicPlanAuthorizationPurposes
      })
    });

    executed = [];
    const approvedPublicPlanPurposes = [];
    const approvedPublicPlanResult = await engine.run(createContext('确认执行公开计划', {
      conversationHistory: [
        {
          role: 'user',
          content: '帮我根据当前画面做一个更高级的设计'
        },
        {
          role: 'assistant',
          content: publicPlanAuthorizationResult?.message || '',
          agentTaskPlan: publicPlanAuthorizationResult?.data?.agentTaskPlan,
          agentTaskPublicPlan: publicPlanAuthorizationResult?.data?.agentTaskPublicPlan,
          agentTaskPublicPlanExecutionRequest: publicPlanAuthorizationResult?.data?.agentTaskPublicPlanExecutionRequest,
          metadata: {
            agentTaskPlan: publicPlanAuthorizationResult?.data?.agentTaskPlan,
            agentTaskPublicPlan: publicPlanAuthorizationResult?.data?.agentTaskPublicPlan,
            agentTaskPublicPlanExecutionRequest: publicPlanAuthorizationResult?.data?.agentTaskPublicPlanExecutionRequest
          }
        }
      ],
      photoshopContext: {
        documentName: 'open-design.psd',
        layerCount: 5
      },
      projectContext: {
        projectPath: 'C:/UXP/2.0/C-1163',
        projectImageCount: 8
      }
    }), {
      callModel: async (_messages, requestOptions) => {
        approvedPublicPlanPurposes.push(requestOptions?.purpose || 'unknown');
        throw new Error(`confirmation flow must not call model: ${requestOptions?.purpose || 'unknown'}`);
      }
    });
    cases.push({
      name: 'engine-turns-public-plan-confirmation-into-controlled-request-without-tools',
      status:
        approvedPublicPlanResult?.success === true
        && /已确认公开计划/.test(approvedPublicPlanResult?.message || '')
        && approvedPublicPlanResult?.data?.agentTaskPublicPlanApprovalRecord?.status === 'approved_controlled_execution_request'
        && approvedPublicPlanResult?.data?.agentTaskPublicPlanExecutionRequest?.status === 'ready_for_controlled_execution_request'
        && approvedPublicPlanResult?.data?.agentTaskPublicPlanExecutionRequest?.canStartControlledRunner === true
        && approvedPublicPlanResult?.data?.agentTaskPublicPlanExecutionRequest?.shouldRunPhotoshop === false
        && approvedPublicPlanResult?.data?.agentTaskPublicPlanExecutionRequest?.mustNotRunWriteTools === true
        && approvedPublicPlanResult?.data?.agentTaskPublicPlanControlledRun?.version === 'agent-task-public-plan-controlled-runner/v0'
        && approvedPublicPlanResult?.data?.agentTaskPublicPlanControlledRun?.status === 'completed_dry_run'
        && approvedPublicPlanResult?.data?.agentTaskPublicPlanControlledRun?.shouldRunPhotoshop === false
        && approvedPublicPlanResult?.data?.agentTaskPublicPlanControlledRun?.mustNotRunWriteTools === true
        && Array.isArray(approvedPublicPlanResult?.data?.agentTaskPublicPlanControlledRun?.executedWriteTools)
        && approvedPublicPlanResult.data.agentTaskPublicPlanControlledRun.executedWriteTools.length === 0
        && !containsForbiddenField(approvedPublicPlanResult?.data?.agentTaskPublicPlanApprovalRecord)
        && !containsForbiddenField(approvedPublicPlanResult?.data?.agentTaskPublicPlanExecutionRequest)
        && !containsForbiddenField(approvedPublicPlanResult?.data?.agentTaskPublicPlanControlledRun)
        && approvedPublicPlanPurposes.length === 0
        && executed.length === 0
          ? 'pass'
          : 'fail',
      details: JSON.stringify({
        result: approvedPublicPlanResult,
        executed,
        approvedPublicPlanPurposes
      })
    });
  } finally {
    skillExecutors.getSkillExecutor = originalGetSkillExecutor;
    skillExecutors.executeSkillWithExecutor = originalExecuteSkillWithExecutor;
  }

  const success = cases.every((item) => item.status === 'pass');
  const report = writeReport({ success, cases });
  console.log(JSON.stringify({ success, cases, report }, null, 2));
  process.exit(success ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
