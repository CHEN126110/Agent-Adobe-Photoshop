#!/usr/bin/env node

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    target: 'ES2020',
    module: 'CommonJS',
    moduleResolution: 'node',
    esModuleInterop: true,
    skipLibCheck: true
  }
});

const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const {
  buildEcommerceSocksChildDispatchRun,
  buildEcommerceSocksDesignEntryEvidence,
  buildEcommerceSocksDispatchAuthorization,
  buildEcommerceSocksDispatchDecision,
  buildEcommerceSocksDispatchLifecycle,
  buildEcommerceSocksDispatchOrchestrationPlan
} = require(path.join(ROOT, 'src', 'shared', 'ecommerce-socks-design.ts'));
const {
  executeSkillWithExecutor,
  getSkillExecutor,
  registerSkillExecutor
} = require(path.join(ROOT, 'src', 'renderer', 'services', 'skill-executors', 'index.ts'));

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : '';
    throw new Error(`${message}${suffix}`);
  }
}

function assertNoPseudoThinking(value, label) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const forbidden = ['正在思考', '等待响应', '请求已发送', '正在准备', '稍等'];
  const found = forbidden.filter((token) => text.includes(token));
  assert(found.length === 0, `${label} contains pseudo-thinking copy: ${found.join(', ')}`);
}

function installChildExecutorOverrides(overrides) {
  const originals = new Map();

  for (const [skillId, execute] of Object.entries(overrides)) {
    originals.set(skillId, getSkillExecutor(skillId));
    registerSkillExecutor({
      skillId,
      execute
    });
  }

  return () => {
    for (const [skillId, executor] of originals.entries()) {
      if (executor) {
        registerSkillExecutor(executor);
      }
    }
  };
}

function buildFixture(params = {}) {
  const evidence = buildEcommerceSocksDesignEntryEvidence({
    userIntent: '帮我完成整套袜子电商设计',
    deliverables: ['main-image', 'detail-page', 'sku']
  });
  const dispatchDecision = buildEcommerceSocksDispatchDecision({
    childSkills: evidence.childSkills,
    executeChildren: params.executeChildren,
    confirmChildDispatch: params.confirmChildDispatch,
    childDispatchImplementationReady: params.childDispatchImplementationReady
  });
  const dispatchLifecycle = buildEcommerceSocksDispatchLifecycle({
    userIntent: evidence.userIntent,
    childSkills: evidence.childSkills,
    dispatchDecision
  });
  const dispatchOrchestration = buildEcommerceSocksDispatchOrchestrationPlan({
    childSkills: evidence.childSkills,
    dispatchDecision,
    dispatchLifecycle
  });
  const dispatchAuthorization = buildEcommerceSocksDispatchAuthorization({
    dispatchDecision,
    dispatchOrchestration,
    userDeniedChildDispatch: params.userDeniedChildDispatch
  });

  return {
    evidence,
    dispatchDecision,
    dispatchLifecycle,
    dispatchOrchestration,
    dispatchAuthorization
  };
}

async function run() {
  assert(
    typeof buildEcommerceSocksChildDispatchRun === 'function',
    'child dispatch runner helper should be exported'
  );

  const defaultFixture = buildFixture();
  const blocked = buildEcommerceSocksChildDispatchRun({
    dispatchAuthorization: defaultFixture.dispatchAuthorization,
    dispatchOrchestration: defaultFixture.dispatchOrchestration
  });
  assert(blocked.version === 'ecommerce-socks-child-dispatch-run/v0', 'run should expose version', blocked);
  assert(blocked.status === 'blocked', 'default child dispatch run should be blocked', blocked);
  assert(blocked.canCallChildExecutors === false, 'run must not call child executors by default', blocked);
  assert(blocked.childExecutionPath === 'none', 'blocked run should expose no child execution path', blocked);
  assert(blocked.childRuns.length === 0, 'blocked run should not fabricate child run records', blocked);
  assert(blocked.noPhotoshopWrites === true, 'run must not write Photoshop', blocked);
  assert(blocked.canClaimDesignComplete === false, 'run must not claim design completion', blocked);

  const approvedFixture = buildFixture({
    executeChildren: true,
    confirmChildDispatch: true
  });
  const dryRun = buildEcommerceSocksChildDispatchRun({
    dispatchAuthorization: approvedFixture.dispatchAuthorization,
    dispatchOrchestration: approvedFixture.dispatchOrchestration,
    dryRunChildDispatch: true
  });
  assert(dryRun.status === 'dry_run_reported', 'explicit dry run should produce dispatch report skeleton', dryRun);
  assert(dryRun.canCallChildExecutors === false, 'dry run must not call child executors', dryRun);
  assert(dryRun.childExecutionPath === 'dry_run', 'dry run should expose dry_run child execution path', dryRun);
  assert(
    JSON.stringify(dryRun.childRuns.map((item) => item.skillId))
      === JSON.stringify(['main-image-design', 'detail-page-design', 'sku-batch']),
    'dry run should preserve child skill order',
    dryRun.childRuns
  );
  assert(
    dryRun.childRuns.every((item) => item.state === 'dry_run_skipped'),
    'dry run child records should be marked skipped',
    dryRun.childRuns
  );
  assert(
    dryRun.childRuns.every((item) => item.expectedReportKey.endsWith('Report')),
    'dry run should retain expected child report keys',
    dryRun.childRuns
  );
  assert(
    dryRun.parentSummary.requiredChildReports.length === 3,
    'dry run should expose parent aggregation requirements',
    dryRun.parentSummary
  );
  assert(
    dryRun.parentSummary.canAggregateQuality === false,
    'dry run must not aggregate quality without real child reports',
    dryRun.parentSummary
  );
  const executableDryRunFixture = buildFixture({
    executeChildren: true,
    confirmChildDispatch: true,
    childDispatchImplementationReady: true
  });
  const executableDryRun = buildEcommerceSocksChildDispatchRun({
    dispatchAuthorization: executableDryRunFixture.dispatchAuthorization,
    dispatchOrchestration: executableDryRunFixture.dispatchOrchestration,
    dryRunChildDispatch: true
  });
  assert(executableDryRun.status === 'dry_run_reported', 'dry run should override executable dispatch mode', executableDryRun);
  assert(executableDryRun.canCallChildExecutors === false, 'dry run must not call child executors even when dispatch is executable', executableDryRun);
  assert(executableDryRun.noPhotoshopWrites === true, 'dry run must keep noPhotoshopWrites=true', executableDryRun);

  const executor = getSkillExecutor('ecommerce-socks-design');
  assert(executor, 'ecommerce-socks-design executor should be registered');

  const steps = [];
  const result = await executor.execute({
    params: {
      userIntent: '帮我完成整套袜子电商设计',
      deliverables: ['main-image', 'detail-page', 'sku'],
      executeChildren: true,
      confirmChildDispatch: true,
      enableChildDispatch: true,
      dryRunChildDispatch: true
    },
    callbacks: {
      onStep: (event) => steps.push(event),
      onMessage: () => undefined,
      onProgress: () => undefined
    },
    context: {
      userInput: '帮我完成整套袜子电商设计',
      isPluginConnected: true,
      conversationHistory: [],
      projectContext: {
        projectPath: 'D:/demo/socks-project',
        projectImageCount: 18
      },
      photoshopContext: {
        hasDocument: true,
        documentName: '详情页.psb'
      }
    }
  });

  assert(
    result.data?.ecommerceSocksChildDispatchRun?.version === 'ecommerce-socks-child-dispatch-run/v0',
    'executor should expose child dispatch run evidence',
    result.data
  );
  assert(
    result.data.ecommerceSocksChildDispatchRun.status === 'dry_run_reported',
    'executor should expose dry-run child dispatch evidence even when real dispatch switch is enabled',
    result.data.ecommerceSocksChildDispatchRun
  );
  assert(
    result.data.ecommerceSocksChildDispatchRun.noPhotoshopWrites === true
      && result.data.ecommerceSocksChildDispatchRun.canCallChildExecutors === false,
    'executor dry-run mode must stay no-write and no-child-call',
    result.data.ecommerceSocksChildDispatchRun
  );
  assert(
    result.data.ecommerceSocksDesign.childDispatchRun === result.data.ecommerceSocksChildDispatchRun,
    'entry evidence should reference the same child dispatch run evidence',
    result.data
  );
  assert(
    !steps.some((item) => ['main-image-design', 'detail-page-design', 'sku-batch'].includes(item.toolName)),
    'child dispatch dry run must not emit real child skill execution events',
    steps
  );
  assertNoPseudoThinking(result, 'child dispatch runner result');
  assertNoPseudoThinking(steps, 'child dispatch runner steps');

  const realSteps = [];
  const childCalls = [];
  const restoreRealDispatchChildren = installChildExecutorOverrides({
    'main-image-design': async () => {
      childCalls.push('main-image-design');
      return {
        success: true,
        message: 'main image child done',
        data: {
          status: 'completed',
          outputCount: 1,
          canClaimOutputQuality: false
        }
      };
    },
    'detail-page-design': async () => {
      childCalls.push('detail-page-design');
      return {
        success: false,
        message: 'detail page blocked',
        error: 'missing visual evidence',
        data: {
          status: 'failed',
          blockers: ['missing_visual_evidence']
        }
      };
    },
    'sku-batch': async () => {
      childCalls.push('sku-batch');
      return { success: true, message: 'sku should not run' };
    }
  });
  let realDispatchResult;
  try {
    realDispatchResult = await executeSkillWithExecutor('ecommerce-socks-design', {
      params: {
        userIntent: '帮我完成整套袜子电商设计',
        deliverables: ['main-image', 'detail-page', 'sku'],
        executeChildren: true,
        confirmChildDispatch: true,
        enableChildDispatch: true
      },
      callbacks: {
        onStep: (event) => realSteps.push(event),
        onMessage: () => undefined,
        onProgress: () => undefined
      },
      context: {
        userInput: '帮我完成整套袜子电商设计',
        isPluginConnected: true,
        conversationHistory: [],
        projectContext: {
          projectPath: 'D:/demo/socks-project',
          projectImageCount: 18
        },
        photoshopContext: {
          hasDocument: true,
          documentName: '详情页.psb'
        }
      }
    });
  } finally {
    restoreRealDispatchChildren();
  }

  assert(
    JSON.stringify(childCalls) === JSON.stringify(['main-image-design', 'detail-page-design']),
    'real child dispatch should run in order and stop after first failed child',
    childCalls
  );
  assert(
    realDispatchResult.data?.ecommerceSocksDispatchDecision?.canDispatchChildren === true,
    'explicit triple opt-in should enable child dispatch decision',
    realDispatchResult.data?.ecommerceSocksDispatchDecision
  );
  assert(
    realDispatchResult.data?.ecommerceSocksDispatchAuthorization?.status === 'approved',
    'explicit triple opt-in should be approved before child execution',
    realDispatchResult.data?.ecommerceSocksDispatchAuthorization
  );
  assert(
    realDispatchResult.data?.ecommerceSocksChildDispatchRun?.status === 'failed',
    'failed child should make parent child dispatch run failed',
    realDispatchResult.data?.ecommerceSocksChildDispatchRun
  );
  assert(
    realDispatchResult.data?.ecommerceSocksChildDispatchRun?.childExecutionPath === 'unified_executor',
    'real child dispatch should route through the unified executeSkillWithExecutor wrapper',
    realDispatchResult.data?.ecommerceSocksChildDispatchRun
  );
  assert(
    !realDispatchResult.data?.ecommerceSocksChildDispatchRun?.warnings?.some((item) => String(item).includes('direct_executor')),
    'real child dispatch should not keep the old direct_executor limitation warning',
    realDispatchResult.data?.ecommerceSocksChildDispatchRun
  );
  assert(
    realDispatchResult.success === false,
    'failed real child dispatch should make the parent AgentResult unsuccessful',
    realDispatchResult
  );
  assert(
    realDispatchResult.data?.ecommerceSocksDesign?.executionMode === 'dispatch',
    'real child dispatch should mark parent evidence executionMode=dispatch',
    realDispatchResult.data?.ecommerceSocksDesign
  );
  assert(
    !String(realDispatchResult.message || '').includes('不执行 Photoshop 写入'),
    'real child dispatch message must not claim that no Photoshop write can occur',
    realDispatchResult.message
  );
  assert(
    realDispatchResult.data?.ecommerceSocksChildReportAggregation?.status === 'blocked_missing_reports',
    'parent aggregation should stay blocked when later child report is missing after stop-on-failure',
    realDispatchResult.data?.ecommerceSocksChildReportAggregation
  );
  assert(
    realDispatchResult.data?.ecommerceSocksDesign?.canClaimDesignComplete === false,
    'parent skill must not claim full design completion even after child dispatch attempt',
    realDispatchResult.data?.ecommerceSocksDesign
  );
  assert(
    realDispatchResult.data?.ecommerceSocksChildDispatchRun?.noPhotoshopWrites === false,
    'real child dispatch must expose that child executors may write Photoshop',
    realDispatchResult.data?.ecommerceSocksChildDispatchRun
  );
  assert(
    realDispatchResult.data?.ecommerceSocksChildDispatchRun?.parentNoPhotoshopWrites === true,
    'parent skill itself must remain a coordinator with no direct Photoshop writes',
    realDispatchResult.data?.ecommerceSocksChildDispatchRun
  );
  assert(
    realDispatchResult.data?.ecommerceSocksChildDispatchRun?.childRuns?.find((item) => item.skillId === 'sku-batch')?.state === 'not_run_after_failure',
    'child dispatch run must not pretend later children were executed after stop-on-failure',
    realDispatchResult.data?.ecommerceSocksChildDispatchRun?.childRuns
  );
  assert(
    realSteps.some((item) => item.toolName === 'main-image-design')
      && realSteps.some((item) => item.toolName === 'detail-page-design')
      && !realSteps.some((item) => item.toolName === 'sku-batch'),
    'step events should expose actual child workers and preserve stop-on-failure',
    realSteps
  );
  assertNoPseudoThinking(realDispatchResult, 'real child dispatch result');
  assertNoPseudoThinking(realSteps, 'real child dispatch steps');

  const failedStatusCalls = [];
  const restoreFailedStatusChildren = installChildExecutorOverrides({
    'main-image-design': async () => {
      failedStatusCalls.push('main-image-design');
      return {
        success: true,
        message: 'declared failed in data',
        data: {
          status: 'failed',
          blockers: ['declared_failed_status']
        }
      };
    },
    'detail-page-design': async () => {
      failedStatusCalls.push('detail-page-design');
      return { success: true, message: 'detail should not run' };
    }
  });
  let failedStatusResult;
  try {
    failedStatusResult = await executeSkillWithExecutor('ecommerce-socks-design', {
      params: {
        userIntent: '帮我完成整套袜子电商设计',
        deliverables: ['main-image', 'detail-page', 'sku'],
        executeChildren: true,
        confirmChildDispatch: true,
        enableChildDispatch: true
      },
      callbacks: {
        onStep: () => undefined,
        onMessage: () => undefined,
        onProgress: () => undefined
      },
      context: {
        userInput: '帮我完成整套袜子电商设计',
        isPluginConnected: true,
        conversationHistory: []
      }
    });
  } finally {
    restoreFailedStatusChildren();
  }

  assert(
    JSON.stringify(failedStatusCalls) === JSON.stringify(['main-image-design']),
    'child dispatch should stop when a child returns success=true but data.status=failed',
    failedStatusCalls
  );
  assert(
    failedStatusResult.data?.ecommerceSocksChildDispatchRun?.status === 'failed',
    'data.status=failed should normalize to failed child dispatch run',
    failedStatusResult.data?.ecommerceSocksChildDispatchRun
  );

  const throwingCalls = [];
  const restoreThrowingChildren = installChildExecutorOverrides({
    'main-image-design': async () => {
      throwingCalls.push('main-image-design');
      throw new Error('child exploded');
    },
    'detail-page-design': async () => {
      throwingCalls.push('detail-page-design');
      return { success: true, message: 'detail should not run' };
    }
  });
  let throwingResult;
  try {
    throwingResult = await executeSkillWithExecutor('ecommerce-socks-design', {
      params: {
        userIntent: '帮我完成整套袜子电商设计',
        deliverables: ['main-image', 'detail-page', 'sku'],
        executeChildren: true,
        confirmChildDispatch: true,
        enableChildDispatch: true
      },
      callbacks: {
        onStep: () => undefined,
        onMessage: () => undefined,
        onProgress: () => undefined
      },
      context: {
        userInput: '帮我完成整套袜子电商设计',
        isPluginConnected: true,
        conversationHistory: []
      }
    });
  } finally {
    restoreThrowingChildren();
  }
  assert(
    JSON.stringify(throwingCalls) === JSON.stringify(['main-image-design']),
    'child dispatch should convert a child exception to a failed report and stop',
    throwingCalls
  );
  assert(
    throwingResult.data?.ecommerceSocksChildDispatchRun?.childRuns?.[0]?.error === 'child exploded',
    'child exception should be preserved as structured child run error',
    throwingResult.data?.ecommerceSocksChildDispatchRun?.childRuns
  );

  console.log(JSON.stringify({
    success: true,
    checks: [
      'child dispatch runner helper exports stable run evidence',
      'default run stays blocked and does not fabricate child results',
      'explicit dry run reports child order and expected report keys without running child skills',
      'executor exposes child dispatch run evidence without executing child skills',
      'dry-run dispatch evidence does not write Photoshop or claim design completion',
      'explicit triple opt-in can run child executors in order with stop-on-failure',
      'real child dispatch routes through the unified executeSkillWithExecutor wrapper',
      'failed child dispatch makes parent AgentResult unsuccessful and executionMode=dispatch',
      'child data.status=failed and child exceptions both stop later children',
      'later child records are marked not_run_after_failure instead of fabricated execution',
      'parent remains coordinator-only and cannot claim design completion after child dispatch'
    ]
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
