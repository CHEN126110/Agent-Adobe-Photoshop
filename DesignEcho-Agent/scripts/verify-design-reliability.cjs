#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const os = require("os");
const path = require("path");
const ts = require("typescript");

const {
  REVIEW_VERSION,
  buildCaseDigest,
  buildDesignReliabilityCohortReport,
  calculateWeightedOverall,
  compareDesignReliabilityCohorts,
  deriveDesignReliabilityRunObservation,
  evaluateDesignReliabilityReleaseGates,
  requiredComparisonEvidenceKinds,
  validateDesignReliabilityCase,
  validateDesignReliabilityReview,
  validateDesignReliabilityRun
} = require("./lib/design-reliability-contract.cjs");
const {
  buildCanonicalAttemptSafetyLedger,
  buildPreflight,
  buildStatus,
  buildSuiteCaseSetDigest,
  buildSuiteRubricSetDigest,
  buildLiveAttemptCoverage,
  collectSidecars,
  evaluateFixtureInventory,
  evaluateLiveEnvironmentSafety,
  inspectEditablePsd,
  isOfficialAttemptCohortReady,
  loadSuite,
  retainContextuallyValidAttemptEvents,
  resolveReliabilityEvidenceRoots,
  sidecarRoots,
  validateAttemptEventStateMachine,
  validateDebugBridgeReceipt,
  validateMutationBaselineAgainstObservation
} = require("./design-reliability.cjs");

const ROOT = path.resolve(__dirname, "..");
const CASE_PATH = path.join(
  ROOT,
  "benchmarks",
  "design-reliability",
  "cases",
  "main-image-c1163-v1.json"
);
const RUBRIC_PATH = path.join(
  ROOT,
  "benchmarks",
  "design-reliability",
  "rubrics",
  "main-image-commercial-v1.json"
);

function loadSelfContainedTypeScriptModule(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    },
    fileName: filePath,
    reportDiagnostics: true
  });
  const diagnostics = transpiled.diagnostics || [];
  assert.strictEqual(diagnostics.length, 0, `TypeScript helper transpile failed: ${diagnostics.length}`);
  const loaded = new Module(filePath, module);
  loaded.filename = filePath;
  loaded.paths = module.paths;
  loaded._compile(transpiled.outputText, filePath);
  return loaded.exports;
}
const SKU_CASE_PATH = path.join(
  ROOT,
  "benchmarks",
  "design-reliability",
  "cases",
  "sku-c1163-v1.json"
);
const SKU_RUBRIC_PATH = path.join(
  ROOT,
  "benchmarks",
  "design-reliability",
  "rubrics",
  "sku-production-v1.json"
);

function readCase() {
  return JSON.parse(fs.readFileSync(CASE_PATH, "utf8"));
}

function readRubric() {
  return JSON.parse(fs.readFileSync(RUBRIC_PATH, "utf8"));
}

function readSkuCase() {
  return JSON.parse(fs.readFileSync(SKU_CASE_PATH, "utf8"));
}

function readSkuRubric() {
  return JSON.parse(fs.readFileSync(SKU_RUBRIC_PATH, "utf8"));
}

function mutationCall(seq, elapsedMs, historyStateId) {
  return {
    seq,
    name: "composeDesign",
    riskClass: "write",
    activityClass: "mutation",
    origin: "model_tool_call",
    success: true,
    elapsedMs,
    photoshopMutationCommit: {
      version: "photoshop-mutation-commit/v1",
      basis: "same_execute_as_modal",
      bindingStrength: "document_revision",
      mutationObserved: true,
      toolActionCompleted: true,
      before: { documentId: 8, historyStateId: historyStateId - 1, activeLayerId: 4 },
      after: { documentId: 8, historyStateId, activeLayerId: 4 }
    },
    photoshopHistoryTransition: {
      version: "photoshop-history-transition/v1",
      basis: "acceptance_snapshot_pair",
      mutationObserved: true,
      documentChanged: false,
      before: { documentId: 8, historyStateId: historyStateId - 1 },
      after: { documentId: 8, historyStateId }
    },
    summary: "mutation committed",
    argsKeys: ["spec"]
  };
}

function historyTransitionMutationCall(seq, elapsedMs, historyStateId) {
  const call = mutationCall(seq, elapsedMs, historyStateId);
  delete call.photoshopMutationCommit;
  call.summary = "mutation committed by successful history transition";
  return call;
}

function observationCall(seq, name, elapsedMs, historyStateId = 18) {
  return {
    seq,
    name,
    riskClass: "read",
    activityClass: "observation",
    success: true,
    elapsedMs,
    photoshopObservationRef: { documentId: 8, historyStateId },
    summary: "readback",
    argsKeys: []
  };
}

function saveCall(seq, elapsedMs) {
  return {
    seq,
    name: "saveDocument",
    riskClass: "write",
    activityClass: "mutation",
    success: true,
    elapsedMs,
    summary: "saved",
    argsKeys: ["format"]
  };
}

function runRecord(input) {
  return {
    version: "agent-run-record/v0",
    runId: input.runId,
    ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
    endedAt: input.endedAt,
    goal: "用这个项目里的素材帮我做一张 800×800 的商品主图。",
    projectPath: "C:\\fixtures\\main-image-c1163-v1",
    conversationScope: {
      conversationId: "conversation-1",
      branchId: "branch-1"
    },
    iterations: Number.isSafeInteger(input.iterations) ? input.iterations : 3,
    stopReason: input.stopReason,
    success: input.success,
    toolCalls: input.toolCalls,
    droppedToolCalls: 0,
    blockers: input.blockers || [],
    warnings: [],
    runtimeSession: {
      sessionId: "runtime-session-1",
      runId: input.runId,
      generation: input.generation,
      issuedAt: input.issuedAt,
      skillId: "ecommerce.main_image",
      taskType: "ecommerce.main_image.v1",
      accounting: {
        modelCallCount: 2,
        ...(Number.isSafeInteger(input.performanceIterations)
          ? {
              performanceUsage: {
                modelCalls: 0,
                toolCalls: 0,
                iterations: input.performanceIterations,
                visionCandidates: 0,
                visualAnalyses: 0,
                activeElapsedMs: 0,
                observationKeys: []
              }
            }
          : {})
      },
      taskRun: {
        taskRunId: "task-run-1",
        status: input.taskRunStatus
      }
    }
  };
}

function evidenceRefs() {
  return [
    { kind: "editable_psd", ref: "output/main.psd", digest: `sha256:${"a".repeat(64)}`, verified: true },
    { kind: "raster_export", ref: "output/main.jpg", digest: `sha256:${"b".repeat(64)}`, verified: true },
    { kind: "fixture_instance", ref: "receipt:fixture-instance:test", digest: `sha256:${"f".repeat(64)}`, verified: true },
    { kind: "runtime_model_identity", ref: "receipt:runtime-model", digest: `sha256:${"1".repeat(64)}`, verified: true },
    { kind: "expected_project_binding", ref: "receipt:project-binding", digest: `sha256:${"c".repeat(64)}`, verified: true },
    { kind: "source_input_integrity", ref: "receipt:source-integrity", digest: `sha256:${"d".repeat(64)}`, verified: true }
  ];
}

function buildPassingObservation() {
  const first = runRecord({
    runId: "run-1",
    generation: 1,
    issuedAt: "2026-08-24T00:00:00.000Z",
    endedAt: "2026-08-24T00:00:10.000Z",
    success: true,
    stopReason: "awaiting_user_confirmation",
    taskRunStatus: "waiting_user",
    toolCalls: []
  });
  const second = runRecord({
    runId: "run-2",
    parentRunId: "run-1",
    generation: 2,
    issuedAt: "2026-08-24T00:00:20.000Z",
    endedAt: "2026-08-24T00:00:40.000Z",
    success: true,
    stopReason: "final_response",
    taskRunStatus: "completed",
    toolCalls: [
      historyTransitionMutationCall(1, 2000, 18),
      observationCall(2, "getAcceptanceSnapshot", 4000),
      observationCall(3, "getCanvasSnapshot", 5000),
      saveCall(4, 6000)
    ]
  });
  return deriveDesignReliabilityRunObservation({
    caseSpec: readCase(),
    runRecords: [first, second],
    cohortId: "candidate",
    repeatIndex: 1,
    userInterventionCount: 1,
    fixtureDigest: `sha256:${"e".repeat(64)}`,
    environment: {
      gitCommit: "abc123",
      dirty: false,
      provider: "provider-a",
      modelId: "model-a"
    },
    evidenceRefs: evidenceRefs()
  });
}

async function main() {
  const guardedBaselineModule = loadSelfContainedTypeScriptModule(path.join(
    ROOT,
    "src",
    "shared",
    "guarded-photoshop-execution-baseline.ts"
  ));
  const expectedPhotoshopBuildId = "photoshop-runtime-build-v1";
  const passingBaseline = guardedBaselineModule.createGuardedPhotoshopExecutionBaseline({
    requestId: "debug-request-pass",
    expectedPhotoshopRuntimeBuildId: expectedPhotoshopBuildId
  });
  let runtimeObservationCount = 0;
  let documentObservationCount = 0;
  let fakeMutationDispatchCount = 0;
  const passingObservers = {
    observePhotoshopRuntimeBuildId: async () => {
      runtimeObservationCount += 1;
      return expectedPhotoshopBuildId;
    },
    observeOpenDocumentCount: async () => {
      documentObservationCount += 1;
      return 0;
    },
    now: () => "2026-08-26T00:00:00.000Z"
  };
  const concurrentBaselineDecisions = await Promise.all([
    guardedBaselineModule.enforceGuardedPhotoshopExecutionBaseline(
      passingBaseline,
      "createDocument",
      passingObservers
    ),
    guardedBaselineModule.enforceGuardedPhotoshopExecutionBaseline(
      passingBaseline,
      "createRectangle",
      passingObservers
    )
  ]);
  for (const decision of concurrentBaselineDecisions) {
    if (decision.ready) fakeMutationDispatchCount += 1;
  }
  assert(concurrentBaselineDecisions.every((decision) => decision.ready === true));
  assert.strictEqual(runtimeObservationCount, 1, "并发首次写只能读取一次 Runtime Build");
  assert.strictEqual(documentObservationCount, 1, "并发首次写只能读取一次 no-open baseline");
  assert.strictEqual(fakeMutationDispatchCount, 2, "通过后同一请求的后续 mutation 可继续执行");

  for (const blockedCase of [
    { name: "runtime mismatch", runtimeBuildId: "other-build", openDocuments: 0 },
    { name: "document already open", runtimeBuildId: expectedPhotoshopBuildId, openDocuments: 1 },
    { name: "document state unavailable", runtimeBuildId: expectedPhotoshopBuildId, openDocuments: undefined }
  ]) {
    const baseline = guardedBaselineModule.createGuardedPhotoshopExecutionBaseline({
      requestId: `debug-request-${blockedCase.name}`,
      expectedPhotoshopRuntimeBuildId: expectedPhotoshopBuildId
    });
    const decision = await guardedBaselineModule.enforceGuardedPhotoshopExecutionBaseline(
      baseline,
      "createDocument",
      {
        observePhotoshopRuntimeBuildId: async () => blockedCase.runtimeBuildId,
        observeOpenDocumentCount: async () => blockedCase.openDocuments
      }
    );
    assert.strictEqual(decision.ready, false, `${blockedCase.name} must block before mutation dispatch`);
    assert.strictEqual(decision.receipt.status, "blocked");
  }

  const toolExecutorSource = fs.readFileSync(path.join(
    ROOT,
    "src",
    "renderer",
    "services",
    "tool-executor.service.ts"
  ), "utf8");
  const autonomousExecutorSource = fs.readFileSync(path.join(
    ROOT,
    "src",
    "renderer",
    "services",
    "skill-executors",
    "autonomous-agent.executor.ts"
  ), "utf8");
  const debugBridgeSource = fs.readFileSync(path.join(
    ROOT,
    "src",
    "main",
    "services",
    "debug-bridge-service.ts"
  ), "utf8");
  const chatPanelSource = fs.readFileSync(path.join(
    ROOT,
    "src",
    "renderer",
    "components",
    "ChatPanel.tsx"
  ), "utf8");
  const mainProcessSource = fs.readFileSync(path.join(
    ROOT,
    "src",
    "main",
    "index.ts"
  ), "utf8");
  const baselineGateIndex = toolExecutorSource.indexOf("enforceGuardedPhotoshopExecutionBaseline(");
  const lowLevelDispatchIndex = toolExecutorSource.indexOf("return await callPhotoshopMcpTool(method, params");
  assert(baselineGateIndex > 0 && baselineGateIndex < lowLevelDispatchIndex,
    "首次受控副作用 baseline 必须位于唯一底层 Photoshop MCP dispatch 之前");
  assert(toolExecutorSource.includes("isAgentToolExecutionGuarded(publicToolName, params)"),
    "photoshop_write 与 save_export 必须共用同一个首次副作用 baseline");
  assert(toolExecutorSource.includes("'quickExport'")
    && toolExecutorSource.includes("'saveDocument',\n                    saveParams")
    && toolExecutorSource.includes("options,\n                    'saveDocument'"),
  "quickExport/saveDocument 重定向必须把 request-scoped options 带到唯一 dispatch gate");
  assert(toolExecutorSource.includes("'quickExport',\n                        exportParams")
    && toolExecutorSource.includes("options,\n                        'quickExport'"),
  "saveDocument/quickExport 反向重定向也必须把 request-scoped options 带到唯一 dispatch gate");
  assert(toolExecutorSource.includes("executeToolCall('createRectangle'")
    && toolExecutorSource.includes("}, options)"),
  "composeDesign 内部原子写必须保留同一个 ToolCallExecutionOptions");
  assert(autonomousExecutorSource.includes("guardedPhotoshopExecutionBaseline: context.guardedPhotoshopExecutionBaseline"),
    "direct 与 Skill guarded atomic 必须继承 request-scoped baseline");
  assert(!autonomousExecutorSource.includes("autonomousParams?.guardedPhotoshopExecutionBaseline"),
    "模型 Tool 参数不得伪造受控 Debug baseline");
  assert(autonomousExecutorSource.includes("createExecuteToolForTeammate(denyProviderTool, baseExecutionOptions)"),
    "teammate Tool 执行必须继承相同的 signed baseline options");
  assert(debugBridgeSource.includes("typeof body.expectedPhotoshopRuntimeBuildId === 'string'")
    && debugBridgeSource.includes("Boolean(body.expectedPhotoshopRuntimeBuildId.trim())"),
  "受控 Debug POST 缺少 expectedPhotoshopRuntimeBuildId 时必须在协议入口拒绝");
  assert(chatPanelSource.includes("completedPhotoshopRuntimeBuildId !== expectedPhotoshopRuntimeBuildId")
    && chatPanelSource.includes("任务完成时 Photoshop Runtime Build 已变化或无法读取"),
  "受控 Debug bridge 必须在完成时 Photoshop Build 漂移处直接 fail closed");
  assert.strictEqual(
    chatPanelSource.split("createGuardedPhotoshopExecutionBaseline({").length - 1,
    1,
    "baseline 只能由正式 Debug submit owner 按请求签发一次"
  );
  assert(chatPanelSource.includes("cancelledDebugBridgeRequestIdsRef.current.add(requestId)")
    && chatPanelSource.includes("throwIfDebugRequestCancelled();")
    && chatPanelSource.includes("cancelledDebugBridgeRequestIdsRef.current.has(guardedDebugRequestId)"),
  "Debug 超时取消必须覆盖 AbortController 建立前的写前预检窗口，不得在超时后晚启动模型或 Photoshop 写入");
  const guardedDebugRequestIndex = chatPanelSource.indexOf("const guardedDebugRequestId = String(");
  const slashCommandIndex = chatPanelSource.indexOf("userInput.startsWith('/')", guardedDebugRequestIndex);
  const quickCommandIndex = chatPanelSource.indexOf("await tryQuickCommand(userInput)", slashCommandIndex);
  assert(guardedDebugRequestIndex > 0
    && slashCommandIndex > guardedDebugRequestIndex
    && quickCommandIndex > slashCommandIndex
    && chatPanelSource.slice(guardedDebugRequestIndex, slashCommandIndex).includes(
      "cancelledDebugBridgeRequestIdsRef.current.has(guardedDebugRequestId)"
    )
    && chatPanelSource.slice(guardedDebugRequestIndex, quickCommandIndex).includes(
      "if (!guardedDebugRequestId && !interactiveContinuationRequest"
    ),
  "受控 Debug 请求必须在斜杠/单词快捷命令前检查取消，并跳过不携带 baseline 的本地快捷写入");
  const debugTimeoutStart = mainProcessSource.indexOf("const timer = setTimeout(() => {");
  const debugCleanupStart = mainProcessSource.indexOf("const cleanup = (): void => {", debugTimeoutStart);
  const debugTimeoutBody = mainProcessSource.slice(debugTimeoutStart, debugCleanupStart);
  assert(debugTimeoutStart > 0
    && debugCleanupStart > debugTimeoutStart
    && debugTimeoutBody.includes("mainWindow.webContents.send('debug-bridge:chat-cancel', { requestId })")
    && !debugTimeoutBody.includes("cleanup();")
    && !debugTimeoutBody.includes("debugChatSubmissionLeaseId = null"),
  "Main 超时必须向同一 requestId 发送取消，并保留单飞 lease 直到 Renderer 返回闭合结果");
  assert(mainProcessSource.includes("if (timedOut) {")
    && mainProcessSource.includes("debugChatSubmissionLeaseId === requestId"),
  "Renderer 迟到结果必须只闭合超时 lease，不得再将结果当成本轮成功");

  const malformedPsdDir = fs.mkdtempSync(path.join(os.tmpdir(), "designecho-psd-evidence-"));
  try {
    const malformedPsdPath = path.join(malformedPsdDir, "header-only.psd");
    const header = Buffer.alloc(26);
    header.write("8BPS", 0, "ascii");
    header.writeUInt16BE(1, 4);
    header.writeUInt16BE(3, 12);
    header.writeUInt32BE(800, 14);
    header.writeUInt32BE(800, 18);
    header.writeUInt16BE(8, 22);
    header.writeUInt16BE(3, 24);
    fs.writeFileSync(malformedPsdPath, header);
    assert.strictEqual(
      inspectEditablePsd(malformedPsdPath),
      null,
      "只有合法 26 字节文件头、没有完整 PSD 结构的文件不得成为 editable_psd 证据"
    );
  } finally {
    fs.rmSync(malformedPsdDir, { recursive: true, force: true });
  }
  const caseSpec = readCase();
  assert.strictEqual(validateDesignReliabilityCase(caseSpec).ok, true, "real case must validate");

  const expectedCommit = "a".repeat(40);
  const safeLiveEnvironmentInput = {
    currentGitEnvironment: { gitCommit: expectedCommit, dirty: false },
    expectedProjectPath: "C:/fixture/project",
    systemStatus: {
      ok: true,
      result: {
        pluginConnected: true,
        runtimeBuildIdentity: {
          version: "designecho-runtime-build-identity/v1",
          buildId: "designecho-test-build",
          processStartedAt: "2026-08-26T00:00:00.000Z",
          capturedAt: "2026-08-26T00:00:01.000Z",
          appVersion: "1.0.0",
          source: "build_manifest",
          gitCommit: expectedCommit,
          gitDirty: false,
          artifactDigest: `sha256:${"b".repeat(64)}`,
          manifestDigest: `sha256:${"c".repeat(64)}`,
          artifactsVerified: true,
          fakeModelEnabled: false,
          fakePhotoshopEnabled: false
        },
        pluginConnectionDiagnostics: { pendingRequestCount: 0 }
      }
    },
    connectionStatus: { ok: true, result: { connected: true } },
    photoshopDiagnosisStatus: {
      ok: true,
      result: {
        success: true,
        state: {
          runtime: {
            buildId: "photoshop-tool-stability/v1",
            loadedAt: "2026-08-26T00:00:00.000Z"
          }
        }
      }
    },
    projectRootStatus: {
      ok: true,
      result: { success: true, projectRoot: "C:/fixture/project" }
    },
    documentListStatus: {
      ok: true,
      result: { success: true, documents: [], count: 0 }
    }
  };
  const safeLiveEnvironment = evaluateLiveEnvironmentSafety(safeLiveEnvironmentInput);
  assert.strictEqual(safeLiveEnvironment.ready, true, "clean matching runtime with zero documents should pass");

  const validDebugReceipt = {
    version: "debug-bridge-chat-submit-receipt/v1",
    requestId: "debug-request-1",
    conversationId: "conversation-1",
    submittedProjectPath: "C:/fixture/project",
    completedProjectPath: "C:/fixture/project",
    expectedProjectMatchedAtSubmission: true,
    projectUnchangedThroughCompletion: true,
    submittedModelId: "model-a",
    completedModelId: "model-a",
    submittedApiModelId: "model-a",
    completedApiModelId: "model-a",
    provider: "provider-a",
    modelUnchangedThroughCompletion: true,
    expectedModelMatchedAtSubmission: true,
    runtimeIdentityMatchedAtSubmission: true,
    runtimeBuildIdentity: safeLiveEnvironmentInput.systemStatus.result.runtimeBuildIdentity,
    completedRuntimeBuildIdentity: safeLiveEnvironmentInput.systemStatus.result.runtimeBuildIdentity,
    runtimeArtifactsUnchangedThroughCompletion: true,
    photoshopDocumentPolicy: "none_open",
    photoshopDocumentGuardPassedAtSubmission: true,
    openPhotoshopDocumentCountAtSubmission: 0,
    expectedPhotoshopRuntimeBuildId: expectedPhotoshopBuildId,
    submittedPhotoshopRuntimeBuildId: expectedPhotoshopBuildId,
    completedPhotoshopRuntimeBuildId: expectedPhotoshopBuildId,
    expectedPhotoshopRuntimeMatchedAtSubmission: true,
    photoshopRuntimeUnchangedThroughCompletion: true,
    firstPhotoshopMutationBaseline: {
      version: "guarded-photoshop-execution-baseline-receipt/v0",
      status: "not_reached",
      requestId: "debug-request-1",
      expectedPhotoshopRuntimeBuildId: expectedPhotoshopBuildId
    }
  };
  const validDebugReceiptInput = {
    fixtureRoot: "C:/fixture/project",
    provider: "provider-a",
    modelId: "model-a",
    gitCommit: expectedCommit,
    runtimeBuildId: "designecho-test-build",
    photoshopRuntimeBuildId: expectedPhotoshopBuildId
  };
  assert.strictEqual(validateDebugBridgeReceipt(
    { result: { receipt: validDebugReceipt } },
    validDebugReceiptInput
  ).ok, true, "提交前、首次写与完成后协议字段完整时 receipt 必须可信");
  const missingExpectedPhotoshopBuild = JSON.parse(JSON.stringify(validDebugReceipt));
  delete missingExpectedPhotoshopBuild.expectedPhotoshopRuntimeBuildId;
  assert.strictEqual(validateDebugBridgeReceipt(
    { result: { receipt: missingExpectedPhotoshopBuild } },
    validDebugReceiptInput
  ).ok, false, "缺 expectedPhotoshopRuntimeBuildId 不得静默兼容");
  const completedPhotoshopBuildDrift = {
    ...validDebugReceipt,
    completedPhotoshopRuntimeBuildId: "other-photoshop-build",
    photoshopRuntimeUnchangedThroughCompletion: false
  };
  assert.strictEqual(validateDebugBridgeReceipt(
    { result: { receipt: completedPhotoshopBuildDrift } },
    validDebugReceiptInput
  ).ok, false, "Photoshop Runtime Build 完成时漂移必须拒绝");
  const completedRuntimeArtifactDrift = {
    ...validDebugReceipt,
    completedRuntimeBuildIdentity: {
      ...validDebugReceipt.completedRuntimeBuildIdentity,
      artifactDigest: `sha256:${"f".repeat(64)}`
    },
    runtimeArtifactsUnchangedThroughCompletion: false
  };
  assert.strictEqual(validateDebugBridgeReceipt(
    { result: { receipt: completedRuntimeArtifactDrift } },
    validDebugReceiptInput
  ).ok, false, "DesignEcho artifact/manifest 完成时漂移必须被正式收据验证拒绝");
  const incompleteRuntimeIdentity = JSON.parse(JSON.stringify(validDebugReceipt));
  delete incompleteRuntimeIdentity.runtimeBuildIdentity.manifestDigest;
  delete incompleteRuntimeIdentity.runtimeBuildIdentity.capturedAt;
  delete incompleteRuntimeIdentity.completedRuntimeBuildIdentity.buildId;
  delete incompleteRuntimeIdentity.completedRuntimeBuildIdentity.fakePhotoshopEnabled;
  assert.strictEqual(validateDebugBridgeReceipt(
    { result: { receipt: incompleteRuntimeIdentity } },
    validDebugReceiptInput
  ).ok, false, "DesignEcho 构建摘要、捕获时间、buildId 或真实运行标志缺失时不得靠两端同时缺字段通过");
  assert.strictEqual(validateMutationBaselineAgainstObservation(
    validDebugReceipt,
    { observed: { observedMutationCalls: 0 } },
    expectedPhotoshopBuildId
  ).ok, true, "没有 mutation 时 not_reached 由技术交付判失败，不伪造成协议错误");
  assert.strictEqual(validateMutationBaselineAgainstObservation(
    validDebugReceipt,
    { observed: { observedMutationCalls: 1 } },
    expectedPhotoshopBuildId
  ).ok, false, "已有 mutation 时 baseline=not_reached 必须拒绝");
  const blockedMutationReceipt = {
    ...validDebugReceipt,
    firstPhotoshopMutationBaseline: {
      version: "guarded-photoshop-execution-baseline-receipt/v0",
      status: "blocked",
      requestId: "debug-request-1",
      expectedPhotoshopRuntimeBuildId: expectedPhotoshopBuildId,
      error: "Photoshop 当前已有既有文档"
    }
  };
  assert.strictEqual(validateDebugBridgeReceipt(
    { result: { receipt: blockedMutationReceipt } },
    validDebugReceiptInput
  ).ok, true, "写前已确定阻断的 baseline receipt 是可信失败，不得升级成 unknown-write");
  assert.strictEqual(validateMutationBaselineAgainstObservation(
    blockedMutationReceipt,
    { observed: { observedMutationCalls: 0 } },
    expectedPhotoshopBuildId
  ).ok, true);
  const passedMutationReceipt = {
    ...validDebugReceipt,
    firstPhotoshopMutationBaseline: {
      version: "guarded-photoshop-execution-baseline-receipt/v0",
      status: "passed",
      requestId: "debug-request-1",
      expectedPhotoshopRuntimeBuildId: expectedPhotoshopBuildId,
      observedPhotoshopRuntimeBuildId: expectedPhotoshopBuildId,
      openDocumentCount: 0,
      firstMutationToolName: "createDocument"
    }
  };
  assert.strictEqual(validateMutationBaselineAgainstObservation(
    passedMutationReceipt,
    { observed: { observedMutationCalls: 1 } },
    expectedPhotoshopBuildId
  ).ok, true, "真实 mutation 与 passed baseline 必须能够闭合");

  const userDocumentOpen = evaluateLiveEnvironmentSafety({
    ...safeLiveEnvironmentInput,
    documentListStatus: {
      ok: true,
      result: {
        success: true,
        documents: [{ id: 132, name: "SKU", pathState: "unsaved" }],
        count: 1
      }
    }
  });
  assert.strictEqual(userDocumentOpen.ready, false);
  assert(userDocumentOpen.blockers.includes("photoshop_documents_open"));
  assert.strictEqual(userDocumentOpen.photoshop.hasUnsavedDocument, true);

  const staleRuntime = evaluateLiveEnvironmentSafety({
    ...safeLiveEnvironmentInput,
    systemStatus: {
      ...safeLiveEnvironmentInput.systemStatus,
      result: {
        ...safeLiveEnvironmentInput.systemStatus.result,
        runtimeBuildIdentity: {
          ...safeLiveEnvironmentInput.systemStatus.result.runtimeBuildIdentity,
          gitCommit: "b".repeat(40)
        }
      }
    }
  });
  assert(staleRuntime.blockers.includes("runtime_git_commit_mismatch"));

  const oldRuntimeWithoutIdentity = evaluateLiveEnvironmentSafety({
    ...safeLiveEnvironmentInput,
    systemStatus: {
      ...safeLiveEnvironmentInput.systemStatus,
      result: {
        pluginConnected: true,
        pluginConnectionDiagnostics: { pendingRequestCount: 0 }
      }
    }
  });
  assert(oldRuntimeWithoutIdentity.blockers.includes("runtime_build_identity_unavailable"));

  const wrongProject = evaluateLiveEnvironmentSafety({
    ...safeLiveEnvironmentInput,
    projectRootStatus: {
      ok: true,
      result: { success: true, projectRoot: "C:/another/project" }
    }
  });
  assert(wrongProject.blockers.includes("current_project_not_bound_to_fixture"));

  const fakeRuntime = evaluateLiveEnvironmentSafety({
    ...safeLiveEnvironmentInput,
    systemStatus: {
      ...safeLiveEnvironmentInput.systemStatus,
      result: {
        ...safeLiveEnvironmentInput.systemStatus.result,
        runtimeBuildIdentity: {
          ...safeLiveEnvironmentInput.systemStatus.result.runtimeBuildIdentity,
          fakeModelEnabled: true
        }
      }
    }
  });
  assert(fakeRuntime.blockers.includes("fake_model_runtime_enabled"));

  const cleanFixtureInventory = evaluateFixtureInventory(
    ["S82646/a.jpg", "S82646/b.jpg"],
    ["S82646/a.jpg", "S82646/b.jpg"]
  );
  assert.strictEqual(cleanFixtureInventory.freshRunReady, true);
  const leakedFixtureInventory = evaluateFixtureInventory(
    ["S82646/a.jpg", "S82646/b.jpg"],
    [
      "S82646/a.jpg",
      "S82646/b.jpg",
      ".designecho/design-state.json",
      "主图/旧成稿.psd"
    ]
  );
  assert.strictEqual(leakedFixtureInventory.ready, true, "expected inputs may still exist in a polluted fixture");
  assert.strictEqual(leakedFixtureInventory.freshRunReady, false);
  assert.deepStrictEqual(leakedFixtureInventory.unexpected, [
    ".designecho/design-state.json",
    "主图/旧成稿.psd"
  ]);

  const attemptEventBase = {
    version: "design-reliability-attempt-event/v1",
    attemptId: "attempt-1",
    caseRef: { caseId: caseSpec.caseId },
    cohortId: "cohort-attempt-denominator",
    provider: "provider-a",
    modelId: "model-a",
    fixtureRef: { instanceId: "fixture-1", fixtureDigest: `sha256:${"d".repeat(64)}` },
    suiteCaseSetDigest: `sha256:${"1".repeat(64)}`,
    suiteRubricSetDigest: `sha256:${"2".repeat(64)}`,
    cohortFingerprint: `sha256:${"3".repeat(64)}`,
    attemptFingerprint: `sha256:${"4".repeat(64)}`
  };
  const attemptCoverage = buildLiveAttemptCoverage([
    { ...attemptEventBase, eventId: "attempt-1:1:armed", sequence: 1, eventType: "armed" },
    { ...attemptEventBase, eventId: "attempt-1:2:submission_started", sequence: 2, eventType: "submission_started" },
    {
      ...attemptEventBase,
      eventId: "attempt-1:3:terminal",
      sequence: 3,
      eventType: "terminal",
      status: "provider_failed"
    },
    {
      ...attemptEventBase,
      attemptId: "attempt-2",
      attemptFingerprint: `sha256:${"5".repeat(64)}`,
      eventId: "attempt-2:1:armed",
      sequence: 1,
      eventType: "armed"
    },
    {
      ...attemptEventBase,
      attemptId: "attempt-2",
      attemptFingerprint: `sha256:${"5".repeat(64)}`,
      eventId: "attempt-2:2:submission_started",
      sequence: 2,
      eventType: "submission_started"
    }
  ], [], { cases: [caseSpec] });
  assert.strictEqual(attemptCoverage.submittedAttempts, 2);
  assert.strictEqual(attemptCoverage.terminalAttempts, 1);
  assert.strictEqual(attemptCoverage.attemptsWithoutTerminal, 1);
  assert.strictEqual(
    attemptCoverage.byCohort["cohort-attempt-denominator"].statuses.provider_failed,
    1
  );
  assert.strictEqual(
    attemptCoverage.byCohort["cohort-attempt-denominator"].technicalDeliveryRate.value,
    0,
    "submitted failures without Run Observation must remain in the Attempt denominator as failures"
  );
  assert.strictEqual(
    attemptCoverage.byCohort["cohort-attempt-denominator"].allSubmittedAttemptsTerminal,
    false,
    "unclosed submitted attempts must keep the cohort sample incomplete"
  );

  const unsafeCase = JSON.parse(JSON.stringify(caseSpec));
  unsafeCase.task.agentVisibleInputs[0].ref = "C:\\private\\image.jpg";
  unsafeCase.caseDigest = buildCaseDigest(unsafeCase);
  assert.strictEqual(validateDesignReliabilityCase(unsafeCase).ok, false, "absolute fixture refs must fail");

  const passing = buildPassingObservation();
  assert.strictEqual(validateDesignReliabilityRun(passing).ok, true, "derived run must validate");
  assert.strictEqual(passing.sourceRunRefs.length, 2, "one TaskRun may span multiple Agent runs");
  assert.strictEqual(passing.observed.correctSkillBinding, true);
  assert.strictEqual(passing.observed.writeToolSuccesses, 2, "save is a write-class tool success");
  assert.strictEqual(passing.observed.observedMutationCalls, 1, "save success is not a Photoshop history mutation");
  assert.strictEqual(
    passing.observed.committedMutationCalls,
    1,
    "successful history transition must use the same committed-mutation semantics as production"
  );
  assert.strictEqual(
    passing.observed.decisionPreservation.status,
    "passed",
    "Agentic 设计写入全部由模型发起时，一级决策保全证据应通过"
  );
  assert.strictEqual(passing.observed.decisionPreservation.attemptedDesignMutationCount, 1);
  assert.strictEqual(passing.observed.decisionPreservation.committedDesignMutationCount, 1);
  assert.strictEqual(passing.observed.decisionPreservation.modelOwnedCommittedMutationCount, 1);
  assert.strictEqual(passing.observed.decisionPreservation.harnessCommittedMutationCount, 0);
  assert.strictEqual(passing.observed.postWriteStructureReadback, true);
  assert.strictEqual(passing.observed.postWriteVisualReadback, true);
  assert.strictEqual(passing.observed.postWriteReadbackTargetVerified, true);
  assert.strictEqual(passing.observed.technicalDeliveryPassed, true);
  assert.strictEqual(passing.observed.falseCompletionSuspected, false);
  assert.strictEqual(passing.observed.userInterventionCount, 1);
  assert.strictEqual(passing.observed.modelCalls, 4, "TaskRun 应聚合多个 generation 的模型调用数");
  assert.strictEqual(
    passing.observed.iterations,
    6,
    "缺少 performanceUsage 的旧 RunRecord 链仍按每代本地 iterations 求和"
  );

  const cumulativeRoot = runRecord({
    runId: "run-cumulative-root",
    generation: 1,
    issuedAt: "2026-08-24T00:03:00.000Z",
    endedAt: "2026-08-24T00:03:20.000Z",
    success: false,
    stopReason: "final_response",
    taskRunStatus: "failed",
    iterations: 15,
    performanceIterations: 15,
    toolCalls: []
  });
  const cumulativeChild = runRecord({
    runId: "run-cumulative-child",
    parentRunId: "run-cumulative-root",
    generation: 2,
    issuedAt: "2026-08-24T00:03:20.000Z",
    endedAt: "2026-08-24T00:03:40.000Z",
    success: false,
    stopReason: "performance_budget",
    taskRunStatus: "failed",
    iterations: 30,
    performanceIterations: 30,
    toolCalls: []
  });
  const cumulativeObservation = deriveDesignReliabilityRunObservation({
    caseSpec,
    runRecords: [cumulativeRoot, cumulativeChild],
    cohortId: "candidate",
    userInterventionCount: 0,
    environment: { provider: "provider-a", modelId: "model-a" },
    evidenceRefs: []
  });
  assert.strictEqual(
    cumulativeObservation.observed.iterations,
    30,
    "当前 Runtime 的终代累计 iterations 不得与上一代再次相加"
  );

  const cumulativeSingle = runRecord({
    runId: "run-cumulative-single",
    generation: 1,
    issuedAt: "2026-08-24T00:04:00.000Z",
    endedAt: "2026-08-24T00:04:20.000Z",
    success: false,
    stopReason: "performance_budget",
    taskRunStatus: "failed",
    iterations: 6,
    performanceIterations: 6,
    toolCalls: []
  });
  const cumulativeSingleObservation = deriveDesignReliabilityRunObservation({
    caseSpec,
    runRecords: [cumulativeSingle],
    cohortId: "candidate",
    userInterventionCount: 0,
    environment: { provider: "provider-a", modelId: "model-a" },
    evidenceRefs: []
  });
  assert.strictEqual(cumulativeSingleObservation.observed.iterations, 6);

  const terminalNeedsReviewRecord = runRecord({
    runId: "run-terminal-needs-review",
    generation: 1,
    issuedAt: "2026-08-24T00:05:00.000Z",
    endedAt: "2026-08-24T00:05:20.000Z",
    success: false,
    stopReason: "final_response",
    taskRunStatus: "failed",
    toolCalls: [
      historyTransitionMutationCall(1, 2000, 28),
      observationCall(2, "getAcceptanceSnapshot", 4000, 28),
      observationCall(3, "getCanvasSnapshot", 5000, 28),
      saveCall(4, 6000)
    ]
  });
  delete terminalNeedsReviewRecord.runtimeSession;
  terminalNeedsReviewRecord.runtimeContractStatus = {
    version: "runtime-contract-status/v0",
    status: "resolved",
    selectedTaskType: "ecommerce.main_image.v1",
    manifestSkillId: "ecommerce.main_image",
    selectionSource: "explicit_runtime_declaration",
    reason: "resolved",
    boundaries: {
      doesNotExecuteSkill: true,
      doesNotGrantToolPermission: true
    }
  };
  terminalNeedsReviewRecord.quality = {
    executionStatus: "needs_review",
    verdictStatus: "needs_review",
    artifactStatus: "artifact_incomplete"
  };
  const terminalNeedsReview = deriveDesignReliabilityRunObservation({
    caseSpec,
    runRecords: [terminalNeedsReviewRecord],
    cohortId: "candidate",
    userInterventionCount: 0,
    environment: { provider: "provider-a", modelId: "model-a" },
    evidenceRefs: evidenceRefs()
  });
  assert.strictEqual(terminalNeedsReview.observed.runStatus, "needs_review");
  assert.strictEqual(
    terminalNeedsReview.observed.machineChecks.find((check) => check.id === "terminal_task_run")?.status,
    "passed",
    "needs_review is a terminal run state even though human quality review remains separate"
  );
  assert.strictEqual(
    terminalNeedsReview.observed.technicalDeliveryPassed,
    true,
    "complete receipts may pass technical delivery while Human Review still owns aesthetics"
  );

  const waitingUserRecord = runRecord({
    runId: "run-waiting-user",
    generation: 1,
    issuedAt: "2026-08-24T00:06:00.000Z",
    endedAt: "2026-08-24T00:06:20.000Z",
    success: true,
    stopReason: "awaiting_user_confirmation",
    taskRunStatus: "waiting_user",
    toolCalls: [
      historyTransitionMutationCall(1, 2000, 29),
      observationCall(2, "getAcceptanceSnapshot", 4000, 29),
      observationCall(3, "getCanvasSnapshot", 5000, 29),
      saveCall(4, 6000)
    ]
  });
  const waitingUserObservation = deriveDesignReliabilityRunObservation({
    caseSpec,
    runRecords: [waitingUserRecord],
    cohortId: "candidate",
    userInterventionCount: 0,
    environment: { provider: "provider-a", modelId: "model-a" },
    evidenceRefs: evidenceRefs()
  });
  assert.strictEqual(waitingUserObservation.observed.runStatus, "waiting_user");
  assert.strictEqual(
    waitingUserObservation.observed.machineChecks.find((check) => check.id === "terminal_task_run")?.status,
    "failed",
    "waiting_user is not a technical terminal state for zero-intervention fixed cases"
  );
  assert.strictEqual(waitingUserObservation.observed.technicalDeliveryPassed, false);
  assert(
    waitingUserObservation.observed.symptoms.some((symptom) => (
      symptom.code === "user_intervention_required_before_completion"
    )),
    "waiting_user must remain visible as an interaction failure instead of being renamed needs_review"
  );

  const agenticManifestRecord = runRecord({
    runId: "run-agentic-manifest",
    generation: 1,
    issuedAt: "2026-08-24T00:10:00.000Z",
    endedAt: "2026-08-24T00:10:10.000Z",
    success: false,
    stopReason: "error",
    taskRunStatus: "failed",
    toolCalls: []
  });
  delete agenticManifestRecord.runtimeSession;
  agenticManifestRecord.runtimeContractStatus = {
    version: "runtime-contract-status/v0",
    status: "resolved",
    selectedTaskType: "ecommerce.main_image.v1",
    manifestSkillId: "ecommerce.main_image",
    selectionSource: "explicit_runtime_declaration",
    reason: "结构化 Skill 选择已经解析到唯一 Runtime Manifest。",
    boundaries: {
      doesNotExecuteSkill: true,
      doesNotGrantToolPermission: true
    }
  };
  const agenticManifestObservation = deriveDesignReliabilityRunObservation({
    caseSpec,
    runRecords: [agenticManifestRecord],
    cohortId: "candidate",
    environment: { provider: "provider-a", modelId: "model-a" },
    evidenceRefs: []
  });
  assert.strictEqual(
    agenticManifestObservation.observed.correctSkillBinding,
    true,
    "agentic resolved Manifest 必须在没有 staged RuntimeSession 或 legacy Skill Tool 时证明绑定"
  );

  const mismatchedAgenticManifestRecord = JSON.parse(JSON.stringify(agenticManifestRecord));
  mismatchedAgenticManifestRecord.runId = "run-agentic-manifest-mismatch";
  mismatchedAgenticManifestRecord.runtimeContractStatus.selectedTaskType = "design.single_canvas_visual.v1";
  mismatchedAgenticManifestRecord.runtimeContractStatus.manifestSkillId = "design.single_canvas_visual";
  const mismatchedAgenticManifestObservation = deriveDesignReliabilityRunObservation({
    caseSpec,
    runRecords: [mismatchedAgenticManifestRecord],
    cohortId: "candidate",
    environment: { provider: "provider-a", modelId: "model-a" },
    evidenceRefs: []
  });
  assert.strictEqual(
    mismatchedAgenticManifestObservation.observed.correctSkillBinding,
    false,
    "另一个合法但不匹配 Case 的 agentic Manifest 不得取得正确 Skill 绑定信用"
  );

  const declarationOnlyRecord = JSON.parse(JSON.stringify(agenticManifestRecord));
  declarationOnlyRecord.runId = "run-agentic-declaration-only";
  delete declarationOnlyRecord.runtimeContractStatus;
  declarationOnlyRecord.toolCalls = [{
    seq: 1,
    name: "declareDesignIntent",
    riskClass: "read",
    activityClass: "control",
    success: true,
    summary: "declaration accepted",
    argsKeys: ["taskTypeId"]
  }];
  const declarationOnlyObservation = deriveDesignReliabilityRunObservation({
    caseSpec,
    runRecords: [declarationOnlyRecord],
    cohortId: "candidate",
    environment: { provider: "provider-a", modelId: "model-a" },
    evidenceRefs: []
  });
  assert.strictEqual(
    declarationOnlyObservation.observed.correctSkillBinding,
    false,
    "declareDesignIntent success 本身不能替代 Resolver 签发的 Manifest 身份摘要"
  );

  const falseCompletionRecord = runRecord({
    runId: "run-false",
    generation: 1,
    issuedAt: "2026-08-24T01:00:00.000Z",
    endedAt: "2026-08-24T01:00:10.000Z",
    success: true,
    stopReason: "final_response",
    taskRunStatus: "completed",
    toolCalls: [saveCall(1, 1000)]
  });
  const falseCompletion = deriveDesignReliabilityRunObservation({
    caseSpec,
    runRecords: [falseCompletionRecord],
    cohortId: "candidate",
    environment: { provider: "provider-a", modelId: "model-a" },
    evidenceRefs: []
  });
  assert.strictEqual(falseCompletion.observed.writeToolSuccesses, 1);
  assert.strictEqual(falseCompletion.observed.observedMutationCalls, 0);
  assert.strictEqual(falseCompletion.observed.technicalDeliveryPassed, false);
  assert.strictEqual(falseCompletion.observed.falseCompletionSuspected, true);
  assert.strictEqual(
    falseCompletion.observed.decisionPreservation.status,
    "unscorable",
    "只有保存、没有设计写入时不能伪造决策保全通过"
  );

  const harnessOwnedMutation = mutationCall(1, 1000, 19);
  harnessOwnedMutation.origin = "harness_compact_workflow_owner";
  harnessOwnedMutation.success = false;
  harnessOwnedMutation.summary = "Harness write attempt failed";
  delete harnessOwnedMutation.photoshopMutationCommit;
  delete harnessOwnedMutation.photoshopHistoryTransition;
  const harnessOwnedRecord = runRecord({
    runId: "run-harness-owned-write",
    generation: 1,
    issuedAt: "2026-08-24T01:02:00.000Z",
    endedAt: "2026-08-24T01:02:10.000Z",
    success: false,
    stopReason: "final_response",
    taskRunStatus: "failed",
    toolCalls: [harnessOwnedMutation]
  });
  const harnessOwnedObservation = deriveDesignReliabilityRunObservation({
    caseSpec,
    runRecords: [harnessOwnedRecord],
    cohortId: "candidate",
    environment: { provider: "provider-a", modelId: "model-a" },
    evidenceRefs: []
  });
  assert.strictEqual(validateDesignReliabilityRun(harnessOwnedObservation).ok, true);
  assert.strictEqual(
    harnessOwnedObservation.observed.decisionPreservation.status,
    "unscorable",
    "未提交的 Harness 写入尝试不能冒充成稿已经被篡改"
  );
  assert.strictEqual(harnessOwnedObservation.observed.decisionPreservation.harnessAttemptCount, 1);
  assert.strictEqual(harnessOwnedObservation.observed.decisionPreservation.harnessWriteAttemptObserved, true);
  assert.strictEqual(
    harnessOwnedObservation.observed.decisionPreservation.committedDesignMutationCount,
    0,
    "失败的 Harness 写入只进入尝试诊断，不能进入真实提交分母"
  );

  const committedHarnessMutation = mutationCall(1, 1000, 20);
  committedHarnessMutation.origin = "harness_compact_workflow_owner";
  const committedHarnessRecord = runRecord({
    runId: "run-harness-committed-write",
    generation: 1,
    issuedAt: "2026-08-24T01:02:20.000Z",
    endedAt: "2026-08-24T01:02:30.000Z",
    success: false,
    stopReason: "final_response",
    taskRunStatus: "failed",
    toolCalls: [committedHarnessMutation]
  });
  const committedHarnessObservation = deriveDesignReliabilityRunObservation({
    caseSpec,
    runRecords: [committedHarnessRecord],
    cohortId: "candidate",
    environment: { provider: "provider-a", modelId: "model-a" },
    evidenceRefs: []
  });
  assert.strictEqual(
    committedHarnessObservation.observed.decisionPreservation.status,
    "failed",
    "只有真实已提交的 Harness-origin 设计写入才判为决策保全失败"
  );

  const failedModelMutation = mutationCall(1, 1000, 21);
  failedModelMutation.success = false;
  delete failedModelMutation.photoshopMutationCommit;
  delete failedModelMutation.photoshopHistoryTransition;
  const failedModelRecord = runRecord({
    runId: "run-model-failed-write",
    generation: 1,
    issuedAt: "2026-08-24T01:02:40.000Z",
    endedAt: "2026-08-24T01:02:50.000Z",
    success: false,
    stopReason: "final_response",
    taskRunStatus: "failed",
    toolCalls: [failedModelMutation]
  });
  const failedModelObservation = deriveDesignReliabilityRunObservation({
    caseSpec,
    runRecords: [failedModelRecord],
    cohortId: "candidate",
    environment: { provider: "provider-a", modelId: "model-a" },
    evidenceRefs: []
  });
  assert.strictEqual(
    failedModelObservation.observed.decisionPreservation.status,
    "unscorable",
    "失败的模型写入不能伪造 Agent 决策已经落到成稿"
  );

  const uncommittedModelMutation = mutationCall(1, 1000, 22);
  delete uncommittedModelMutation.photoshopMutationCommit;
  delete uncommittedModelMutation.photoshopHistoryTransition;
  const uncommittedModelRecord = runRecord({
    runId: "run-model-uncommitted-write",
    generation: 1,
    issuedAt: "2026-08-24T01:03:00.000Z",
    endedAt: "2026-08-24T01:03:10.000Z",
    success: true,
    stopReason: "final_response",
    taskRunStatus: "failed",
    toolCalls: [uncommittedModelMutation]
  });
  const uncommittedModelObservation = deriveDesignReliabilityRunObservation({
    caseSpec,
    runRecords: [uncommittedModelRecord],
    cohortId: "candidate",
    environment: { provider: "provider-a", modelId: "model-a" },
    evidenceRefs: []
  });
  assert.strictEqual(
    uncommittedModelObservation.observed.decisionPreservation.status,
    "unscorable",
    "success=true 但没有 Host mutation proof 时不能判为模型主导通过"
  );

  const stagedCase = JSON.parse(JSON.stringify(caseSpec));
  stagedCase.executionModel = "staged";
  stagedCase.caseDigest = buildCaseDigest(stagedCase);
  const stagedObservation = deriveDesignReliabilityRunObservation({
    caseSpec: stagedCase,
    runRecords: [harnessOwnedRecord],
    cohortId: "candidate",
    environment: { provider: "provider-a", modelId: "model-a" },
    evidenceRefs: []
  });
  assert.strictEqual(
    stagedObservation.observed.decisionPreservation.status,
    "unscorable",
    "Staged 生产在缺少参数等价收据时不能把工具来源冒充为模型决策保全"
  );

  const unrelated = runRecord({
    runId: "run-unrelated",
    generation: 3,
    issuedAt: "2026-08-24T01:01:00.000Z",
    endedAt: "2026-08-24T01:01:10.000Z",
    success: true,
    stopReason: "final_response",
    taskRunStatus: "completed",
    toolCalls: [
      observationCall(1, "getLayerHierarchy", 1000),
      observationCall(2, "getCanvasSnapshot", 1200),
      saveCall(3, 1500)
    ]
  });
  unrelated.runtimeSession.taskRun.taskRunId = "task-run-unrelated";
  unrelated.runtimeSession.sessionId = "runtime-session-unrelated";
  unrelated.conversationScope = { conversationId: "conversation-2", branchId: "branch-2" };
  assert.throws(
    () => deriveDesignReliabilityRunObservation({
      caseSpec,
      runRecords: [falseCompletionRecord, unrelated],
      cohortId: "candidate",
      evidenceRefs: evidenceRefs()
    }),
    /RunRecord 链不合法/,
    "不同 TaskRun / 会话的 mutation 与交付证据不得拼成假成功"
  );

  const rubric = readRubric();
  const passingScores = Object.fromEntries(rubric.dimensions.map((dimension) => [dimension.id, 0.8]));
  const review = {
    version: REVIEW_VERSION,
    reviewId: "review-1",
    runObservationId: passing.runObservationId,
    rubricId: caseSpec.oracle.rubricId,
    reviewerId: "designer-a",
    reviewedAt: "2026-08-24T02:00:00.000Z",
    blindedToCohort: true,
    blindedToCandidateOrigin: true,
    evidenceRefs: [
      "candidate:output/main.jpg",
      "anchor:user-design:main-image-c1163",
      "anchor:eagle:item-MPTG3FF6XEROR"
    ],
    comparisonEvidenceKinds: requiredComparisonEvidenceKinds(caseSpec),
    comparisonEvidenceRefs: [
      { kind: "candidate_final", ref: "candidate:output/main.jpg" },
      { kind: "user_design_anchor", ref: "anchor:user-design:main-image-c1163" },
      { kind: "eagle_anchor", ref: "anchor:eagle:item-MPTG3FF6XEROR" }
    ],
    decision: "pass",
    scores: passingScores,
    weightedOverall: calculateWeightedOverall(rubric, passingScores),
    pairwiseOutcome: "comparable",
    findings: [],
    blockers: [],
    confidence: "high",
    missingEvidence: [],
    boundaries: { devBenchmarkSidecarOnly: true, neverAffectsRuntime: true }
  };
  assert.strictEqual(review.weightedOverall, 0.8, "weightedOverall 必须按 rubric 权重自动计算");
  assert.strictEqual(
    validateDesignReliabilityReview(review, { rubric, caseSpec, run: passing, enforceBlindProtocol: true }).ok,
    true,
    "完整盲评协议、阈值、pairwise 与适用参考齐全时 pass 才合法"
  );

  const formalAttemptRun = JSON.parse(JSON.stringify(passing));
  formalAttemptRun.cohortId = "cohort-formal-denominator";
  const formalAttemptReview = {
    ...JSON.parse(JSON.stringify(review)),
    reviewId: "review-formal-attempt",
    runObservationId: formalAttemptRun.runObservationId
  };
  const formalCohortFingerprint = `sha256:${"7".repeat(64)}`;
  const formalSuiteCaseSetDigest = `sha256:${"8".repeat(64)}`;
  const formalSuiteRubricSetDigest = `sha256:${"9".repeat(64)}`;
  const formalRuntimeEnvironment = {
    gitCommit: "formal-git-commit",
    dirty: false,
    runtimeGitCommit: "formal-git-commit",
    runtimeBuildId: "formal-runtime-build",
    runtimeAppVersion: "1.0.0",
    photoshopRuntimeBuildId: "formal-photoshop-build"
  };
  function formalAttemptEvents(input) {
    const inputCase = input.caseSpec;
    const base = {
      version: "design-reliability-attempt-event/v1",
      attemptId: input.attemptId,
      caseRef: {
        caseId: inputCase.caseId,
        revision: inputCase.revision,
        caseDigest: inputCase.caseDigest
      },
      cohortId: "cohort-formal-denominator",
      repeatIndex: input.repeatIndex || 1,
      provider: "provider-a",
      modelId: "model-a",
      fixtureRef: {
        instanceId: input.fixtureInstanceId,
        fixtureDigest: input.fixtureDigest
      },
      environment: formalRuntimeEnvironment,
      instructionDigest: input.instructionDigest,
      rubricDigest: input.rubricDigest,
      suiteCaseSetDigest: formalSuiteCaseSetDigest,
      suiteRubricSetDigest: formalSuiteRubricSetDigest,
      cohortFingerprint: formalCohortFingerprint,
      attemptFingerprint: input.attemptFingerprint
    };
    return [
      {
        ...base,
        eventId: `${input.attemptId}:1:armed`,
        sequence: 1,
        eventType: "armed",
        occurredAt: "2026-08-26T00:00:01.000Z"
      },
      {
        ...base,
        eventId: `${input.attemptId}:2:submission_started`,
        sequence: 2,
        eventType: "submission_started",
        occurredAt: "2026-08-26T00:00:02.000Z"
      },
      {
        ...base,
        eventId: `${input.attemptId}:3:terminal`,
        sequence: 3,
        eventType: "terminal",
        occurredAt: "2026-08-26T00:00:03.000Z",
        status: input.status,
        ...(input.runObservationId ? { runObservationId: input.runObservationId } : {})
      }
    ];
  }
  const formalPassInput = {
    attemptId: "attempt-formal-pass",
    caseSpec,
    fixtureInstanceId: "fixture-formal-pass",
    fixtureDigest: `sha256:${"a".repeat(64)}`,
    attemptFingerprint: `sha256:${"b".repeat(64)}`,
    instructionDigest: `sha256:${"e".repeat(64)}`,
    rubricDigest: `sha256:${"f".repeat(64)}`,
    status: "technical_delivery_passed",
    runObservationId: formalAttemptRun.runObservationId
  };
  formalAttemptRun.attempt = {
    attemptId: formalPassInput.attemptId,
    attemptFingerprint: formalPassInput.attemptFingerprint,
    repeatIndex: 1
  };
  formalAttemptRun.cohortDimensions = {
    ...formalAttemptRun.cohortDimensions,
    provider: "provider-a",
    requestedModelId: "model-a",
    fixtureInstanceId: formalPassInput.fixtureInstanceId,
    fixtureDigest: formalPassInput.fixtureDigest,
    instructionDigest: formalPassInput.instructionDigest,
    rubricDigest: formalPassInput.rubricDigest,
    suiteCaseSetDigest: formalSuiteCaseSetDigest,
    suiteRubricSetDigest: formalSuiteRubricSetDigest,
    cohortFingerprint: formalCohortFingerprint,
    ...formalRuntimeEnvironment
  };
  const formalAttemptCoverage = buildLiveAttemptCoverage([
    ...formalAttemptEvents(formalPassInput),
    ...formalAttemptEvents({
      attemptId: "attempt-formal-provider-fail",
      caseSpec: readSkuCase(),
      fixtureInstanceId: "fixture-formal-fail",
      fixtureDigest: `sha256:${"c".repeat(64)}`,
      attemptFingerprint: `sha256:${"d".repeat(64)}`,
      instructionDigest: `sha256:${"1".repeat(64)}`,
      rubricDigest: `sha256:${"2".repeat(64)}`,
      status: "provider_failed"
    })
  ], [formalAttemptRun], { cases: [caseSpec, readSkuCase()] }, [formalAttemptReview]);
  const formalAttemptCohort = formalAttemptCoverage.byCohort["cohort-formal-denominator"];
  assert.strictEqual(formalAttemptCohort.homogeneous, true,
    "不同 Case 与一次性 fixture 必须共享 cohort 协议指纹，而不是被误判为环境混杂");
  assert.deepStrictEqual(formalAttemptCohort.technicalDeliveryRate, {
    numerator: 1,
    denominator: 2,
    value: 0.5
  }, "Provider 失败必须作为 0 留在所有 submitted Attempt 的正式分母中");
  assert.deepStrictEqual(formalAttemptCohort.commercialUsableRate, {
    numerator: 1,
    denominator: 2,
    value: 0.5
  });
  assert.strictEqual(formalAttemptCohort.protocolValid, true);
  assert.strictEqual(formalAttemptCohort.allSubmittedAttemptsTerminal, true);
  assert.strictEqual(isOfficialAttemptCohortReady(formalAttemptCohort), true,
    "只有同质、协议有效、全终态且无 unknown-write 的 Attempt cohort 才能声明正式成功率");

  const reusedRunCoverage = buildLiveAttemptCoverage([
    ...formalAttemptEvents(formalPassInput),
    ...formalAttemptEvents({
      ...formalPassInput,
      attemptId: "attempt-formal-pass-duplicate-link",
      fixtureInstanceId: "fixture-formal-pass-duplicate-link",
      attemptFingerprint: `sha256:${"6".repeat(64)}`
    })
  ], [formalAttemptRun], { cases: [caseSpec] }, [formalAttemptReview]);
  const reusedRunCohort = reusedRunCoverage.byCohort["cohort-formal-denominator"];
  assert.strictEqual(reusedRunCohort.protocolValid, false,
    "同一个 RunObservation 被多个 Attempt 引用时必须让 cohort 失去正式协议资格");
  assert.strictEqual(reusedRunCohort.technicalDeliveryRate.numerator, 0,
    "重复引用不能把一次通过放大成多个成功样本");
  assert.strictEqual(reusedRunCohort.commercialUsableRate.numerator, 0);

  const timeoutDriftEvents = formalAttemptEvents(formalPassInput);
  timeoutDriftEvents[2].timeoutMs = 123456;
  const timeoutDriftCoverage = buildLiveAttemptCoverage(
    timeoutDriftEvents,
    [formalAttemptRun],
    { cases: [caseSpec] },
    [formalAttemptReview]
  );
  const timeoutDriftCohort = timeoutDriftCoverage.byCohort["cohort-formal-denominator"];
  assert.strictEqual(timeoutDriftCohort.protocolValid, false,
    "Attempt terminal 修改 timeoutMs 时必须被统一身份 key 判为漂移");
  assert.strictEqual(timeoutDriftCohort.technicalDeliveryRate.numerator, 0,
    "timeout 不一致的 RunObservation 不能绑定成技术通过");
  assert.strictEqual(isOfficialAttemptCohortReady(timeoutDriftCohort), false,
    "协议漂移 cohort 不得被 release gate 绕过后宣称已通过实机可靠性");
  const buildPreflightSource = buildPreflight.toString();
  assert(buildPreflightSource.includes("isOfficialAttemptCohortReady(")
    && buildPreflightSource.includes("attemptSafetyLedger.unresolvedAttemptCount === 0"),
  "preflight.liveEvidencePassed 必须消费同 cohort 的官方 Attempt 协议与 canonical 未闭合账本，不得只看 Run/Review release gate");

  const validStateMachineEvents = formalAttemptEvents(formalPassInput);
  assert.deepStrictEqual(
    validateAttemptEventStateMachine(formalPassInput.attemptId, validStateMachineEvents),
    [],
    "Writer 生成的冒号 eventId 与 1→2→3 顺序必须通过严格状态机"
  );
  const invalidStateMachineEvents = JSON.parse(JSON.stringify(validStateMachineEvents));
  invalidStateMachineEvents[1].sequence = 3;
  invalidStateMachineEvents[1].eventId = `${formalPassInput.attemptId}:3:submission_started`;
  assert(
    validateAttemptEventStateMachine(formalPassInput.attemptId, invalidStateMachineEvents)
      .includes("attempt_sequence_invalid"),
    "跳号或倒序 Event 必须被严格状态机拒绝"
  );
  assert.strictEqual(
    buildCanonicalAttemptSafetyLedger(invalidStateMachineEvents).unresolvedAttemptCount,
    0,
    "已有确定 terminal 的协议坏样本应失去官方资格，但不能造成无法 reconciliation 的写入死锁"
  );
  const duplicateTerminalEvents = formalAttemptEvents({
    ...formalPassInput,
    status: "provider_failed",
    runObservationId: undefined
  });
  duplicateTerminalEvents.push({
    ...duplicateTerminalEvents[2],
    eventId: `${formalPassInput.attemptId}:4:terminal`,
    sequence: 4,
    occurredAt: "2026-08-26T00:00:04.000Z",
    status: "submission_unknown_write_state"
  });
  assert.strictEqual(
    buildCanonicalAttemptSafetyLedger(duplicateTerminalEvents).unresolvedAttemptCount,
    1,
    "重复 terminal 中任意一条为 unknown-write 时 canonical safety ledger 必须保持未解决"
  );

  const fullSuite = loadSuite();
  assert.strictEqual(fullSuite.ok, true);
  const currentCase = fullSuite.cases.find((item) => item.caseId === caseSpec.caseId);
  const currentContextBase = {
    ...formalAttemptEvents(formalPassInput)[0],
    caseRef: {
      caseId: currentCase.caseId,
      revision: currentCase.revision,
      caseDigest: currentCase.caseDigest
    },
    suiteCaseSetDigest: buildSuiteCaseSetDigest(fullSuite),
    suiteRubricSetDigest: buildSuiteRubricSetDigest(fullSuite)
  };
  const staleAttemptEvents = [
    { ...currentContextBase, caseRef: { ...currentContextBase.caseRef, caseDigest: "sha256:stale" } },
    {
      ...currentContextBase,
      eventId: "stale-attempt:2:submission_started",
      attemptId: "stale-attempt",
      sequence: 2,
      eventType: "submission_started",
      caseRef: { ...currentContextBase.caseRef, caseDigest: "sha256:stale" }
    }
  ];
  staleAttemptEvents[0].eventId = "stale-attempt:1:armed";
  staleAttemptEvents[0].attemptId = "stale-attempt";
  const staleExcluded = [];
  assert.deepStrictEqual(
    retainContextuallyValidAttemptEvents(staleAttemptEvents, fullSuite, staleExcluded),
    [],
    "旧 Case revision/digest 的 Attempt 不得进入当前 submitted 分母"
  );
  assert.strictEqual(staleExcluded[0]?.id, "stale-attempt");
  const staleSafetyLedger = buildCanonicalAttemptSafetyLedger(staleAttemptEvents);
  assert(staleSafetyLedger.usedFixtureInstanceIds.includes(formalPassInput.fixtureInstanceId),
    "旧 Suite Attempt 虽不进入当前统计，仍必须保留 fixture 一次性使用事实");
  assert.strictEqual(staleSafetyLedger.unresolvedAttemptCount, 1,
    "旧 Suite 中未闭合的 submission 仍是 canonical 安全事实，不能被上下文过滤隐藏");

  const currentAttemptWithDrift = [
    { ...currentContextBase, eventId: "current-drift:1:armed", attemptId: "current-drift" },
    {
      ...currentContextBase,
      eventId: "current-drift:2:submission_started",
      attemptId: "current-drift",
      sequence: 2,
      eventType: "submission_started"
    },
    {
      ...currentContextBase,
      eventId: "current-drift:3:terminal",
      attemptId: "current-drift",
      sequence: 3,
      eventType: "terminal",
      status: "provider_failed",
      caseRef: { ...currentContextBase.caseRef, caseDigest: "sha256:drifted-after-submission" }
    }
  ];
  const driftExcluded = [];
  assert.strictEqual(
    retainContextuallyValidAttemptEvents(currentAttemptWithDrift, fullSuite, driftExcluded).length,
    3,
    "当前 submission 后发生身份漂移必须留在分母并由协议校验暴露，不能被上下文过滤静默删除"
  );
  assert.strictEqual(driftExcluded.length, 0);

  const inactiveSuite = JSON.parse(JSON.stringify(fullSuite));
  const inactiveCase = inactiveSuite.cases.find((item) => item.caseId === currentCase.caseId);
  inactiveCase.status = "retired";
  const inactiveAttemptEvents = currentAttemptWithDrift.slice(0, 2).map((event) => ({
    ...event,
    caseRef: {
      caseId: inactiveCase.caseId,
      revision: inactiveCase.revision,
      caseDigest: inactiveCase.caseDigest
    },
    suiteCaseSetDigest: buildSuiteCaseSetDigest(inactiveSuite),
    suiteRubricSetDigest: buildSuiteRubricSetDigest(inactiveSuite)
  }));
  const inactiveExcluded = [];
  assert.deepStrictEqual(
    retainContextuallyValidAttemptEvents(inactiveAttemptEvents, inactiveSuite, inactiveExcluded),
    [],
    "inactive / retired Case Attempt 不能进入当前 family 分母"
  );
  assert.strictEqual(inactiveExcluded[0]?.id, "current-drift");

  const customDataRoot = path.join(os.tmpdir(), "designecho-custom-reliability-root");
  const roots = sidecarRoots({ getAll: () => [customDataRoot] });
  assert(roots.includes(path.join(ROOT, "tmp", "design-reliability")),
    "自定义 data-root 不能替换 canonical Attempt 安全账本");
  assert(roots.includes(customDataRoot), "自定义 data-root 仍可作为附加报告来源");
  const evidenceRoots = resolveReliabilityEvidenceRoots({ getAll: () => [customDataRoot] });
  assert(evidenceRoots.reportRoots.includes(customDataRoot));
  assert.strictEqual(evidenceRoots.canonicalAttemptRoots.length, 1);
  assert(!evidenceRoots.canonicalAttemptRoots.includes(customDataRoot),
    "自定义 report root 的 terminal/reconciled Event 不能进入 canonical 写入安全账本");
  const injectedAttemptRoot = fs.mkdtempSync(path.join(os.tmpdir(), "designecho-injected-attempt-"));
  try {
    const injectedAttempt = {
      ...currentContextBase,
      eventId: "custom-root-attempt:1:armed",
      attemptId: "custom-root-attempt",
      sequence: 1,
      eventType: "armed"
    };
    fs.writeFileSync(
      path.join(injectedAttemptRoot, "custom-root-attempt.json"),
      `${JSON.stringify(injectedAttempt, null, 2)}\n`,
      "utf8"
    );
    const emptyStatusArgs = {
      getAll: () => [],
      get: (_name, fallback) => fallback
    };
    const injectedStatusArgs = {
      getAll: (name) => name === "--data-root" ? [injectedAttemptRoot] : [],
      get: (_name, fallback) => fallback
    };
    const canonicalAttemptCount = buildStatus(fullSuite, emptyStatusArgs)
      .evidence.attemptCoverage.totalAttempts;
    const injectedAttemptCount = buildStatus(fullSuite, injectedStatusArgs)
      .evidence.attemptCoverage.totalAttempts;
    assert.strictEqual(injectedAttemptCount, canonicalAttemptCount,
      "--data-root 中伪造的 Attempt Event 不得进入正式分母；分母只能消费 canonical append-only 账本");
  } finally {
    fs.rmSync(injectedAttemptRoot, { recursive: true, force: true });
  }
  const invalidLedgerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "designecho-invalid-ledger-"));
  try {
    const invalidAttemptDir = path.join(invalidLedgerRoot, "attempt-events", "cohort", "attempt");
    fs.mkdirSync(invalidAttemptDir, { recursive: true });
    fs.writeFileSync(path.join(invalidAttemptDir, "02-submission_started.json"), "{", "utf8");
    const invalidLedgerSidecars = collectSidecars([invalidLedgerRoot]);
    assert.strictEqual(invalidLedgerSidecars.invalid[0]?.kind, "attempt_event",
      "损坏的 canonical Attempt 文件必须保留安全账本身份，供 preflight fail closed");
  } finally {
    fs.rmSync(invalidLedgerRoot, { recursive: true, force: true });
  }

  const lowScorePass = JSON.parse(JSON.stringify(review));
  lowScorePass.scores = Object.fromEntries(rubric.dimensions.map((dimension) => [dimension.id, 0.6]));
  lowScorePass.weightedOverall = calculateWeightedOverall(rubric, lowScorePass.scores);
  assert.strictEqual(
    validateDesignReliabilityReview(lowScorePass, { rubric, caseSpec, run: passing, enforceBlindProtocol: true }).ok,
    false,
    "低于 rubric 阈值的 decision=pass 必须失败"
  );

  const skuCase = readSkuCase();
  const skuRubric = readSkuRubric();
  const skuRun = JSON.parse(JSON.stringify(passing));
  skuRun.runObservationId = "sku-review-run";
  skuRun.caseRef = {
    suiteId: skuCase.suiteId,
    caseId: skuCase.caseId,
    revision: skuCase.revision,
    caseDigest: skuCase.caseDigest
  };
  const belowSkuThresholdScores = Object.fromEntries(
    skuRubric.dimensions.map((dimension) => [dimension.id, 0.79])
  );
  const belowSkuThresholdPass = {
    ...JSON.parse(JSON.stringify(review)),
    runObservationId: skuRun.runObservationId,
    rubricId: skuRubric.rubricId,
    scores: belowSkuThresholdScores,
    weightedOverall: calculateWeightedOverall(skuRubric, belowSkuThresholdScores),
    comparisonEvidenceKinds: requiredComparisonEvidenceKinds(skuCase),
    comparisonEvidenceRefs: review.comparisonEvidenceRefs.filter((item) => (
      requiredComparisonEvidenceKinds(skuCase).includes(item.kind)
    ))
  };
  assert.strictEqual(
    validateDesignReliabilityReview(belowSkuThresholdPass, {
      rubric: skuRubric,
      caseSpec: skuCase,
      run: skuRun,
      enforceBlindProtocol: true
    }).ok,
    false,
    "SKU decision=pass 必须达到 0.80 rubric 阈值"
  );

  const exposedCandidatePass = JSON.parse(JSON.stringify(review));
  exposedCandidatePass.blindedToCandidateOrigin = false;
  assert.strictEqual(
    validateDesignReliabilityReview(exposedCandidatePass, { rubric, caseSpec, run: passing, enforceBlindProtocol: true }).ok,
    false,
    "知道候选来源的结果不能记录为盲评 pass"
  );

  const weakerPass = JSON.parse(JSON.stringify(review));
  weakerPass.pairwiseOutcome = "weaker";
  assert.strictEqual(
    validateDesignReliabilityReview(weakerPass, { rubric, caseSpec, run: passing, enforceBlindProtocol: true }).ok,
    false,
    "pairwise weaker 不能记录为 pass"
  );

  const incompleteComparisonPass = JSON.parse(JSON.stringify(review));
  incompleteComparisonPass.comparisonEvidenceKinds = ["candidate_final", "user_design_anchor"];
  incompleteComparisonPass.comparisonEvidenceRefs = incompleteComparisonPass.comparisonEvidenceRefs.filter((item) => (
    item.kind !== "eagle_anchor"
  ));
  assert.strictEqual(
    validateDesignReliabilityReview(incompleteComparisonPass, { rubric, caseSpec, run: passing, enforceBlindProtocol: true }).ok,
    false,
    "Case 存在 Eagle anchor 时，缺少 Eagle 比较证据不能记录为 pass"
  );

  const unboundComparisonPass = JSON.parse(JSON.stringify(review));
  unboundComparisonPass.evidenceRefs = ["untyped-single-token"];
  assert.strictEqual(
    validateDesignReliabilityReview(unboundComparisonPass, {
      rubric,
      caseSpec,
      run: passing,
      enforceBlindProtocol: true
    }).ok,
    false,
    "comparisonEvidenceKinds 齐全但没有逐项绑定到 evidenceRefs 时不能记录为 pass"
  );

  const hiddenAbsolutePathPass = JSON.parse(JSON.stringify(review));
  const hiddenAbsoluteRef = "candidate:C:\\Users\\example\\secret.jpg";
  hiddenAbsolutePathPass.evidenceRefs = hiddenAbsolutePathPass.evidenceRefs.map((ref) => (
    ref.startsWith("candidate:") ? hiddenAbsoluteRef : ref
  ));
  hiddenAbsolutePathPass.comparisonEvidenceRefs = hiddenAbsolutePathPass.comparisonEvidenceRefs.map((item) => (
    item.kind === "candidate_final" ? { ...item, ref: hiddenAbsoluteRef } : item
  ));
  assert.strictEqual(
    validateDesignReliabilityReview(hiddenAbsolutePathPass, {
      rubric,
      caseSpec,
      run: passing,
      enforceBlindProtocol: true
    }).ok,
    false,
    "typed ref 的类型前缀后不能隐藏绝对用户路径"
  );

  const blockerPass = JSON.parse(JSON.stringify(review));
  blockerPass.blockers = ["critical_product_mismatch"];
  assert.strictEqual(
    validateDesignReliabilityReview(blockerPass, { rubric, caseSpec, run: passing, enforceBlindProtocol: true }).ok,
    false,
    "含 blocker 的评审不能记录为 pass"
  );

  const invalidPairwise = JSON.parse(JSON.stringify(review));
  invalidPairwise.decision = "needs_fix";
  invalidPairwise.pairwiseOutcome = "similar_enough";
  assert.strictEqual(
    validateDesignReliabilityReview(invalidPairwise, { rubric, caseSpec, run: passing, enforceBlindProtocol: true }).ok,
    false,
    "pairwiseOutcome 必须使用固定枚举"
  );

  const mismatchedWeightedOverall = JSON.parse(JSON.stringify(review));
  mismatchedWeightedOverall.weightedOverall = 0.91;
  assert.strictEqual(
    validateDesignReliabilityReview(mismatchedWeightedOverall, { rubric, caseSpec, run: passing, enforceBlindProtocol: true }).ok,
    false,
    "手工伪造 weightedOverall 必须被自动计算对账拒绝"
  );

  const legacyNeedsFix = {
    version: REVIEW_VERSION,
    reviewId: "legacy-review",
    runObservationId: passing.runObservationId,
    rubricId: caseSpec.oracle.rubricId,
    reviewerId: "designer-a",
    reviewedAt: "2026-08-24T01:00:00.000Z",
    blindedToCohort: true,
    evidenceRefs: ["legacy-review-evidence"],
    decision: "needs_fix",
    scores: passingScores,
    pairwiseOutcome: "weaker",
    findings: [],
    confidence: "medium",
    missingEvidence: [],
    boundaries: { devBenchmarkSidecarOnly: true, neverAffectsRuntime: true }
  };
  assert.strictEqual(
    validateDesignReliabilityReview(legacyNeedsFix, { rubric, caseSpec, run: passing }).ok,
    true,
    "历史 needs_fix sidecar 可继续读取，但不能升级为新协议 pass"
  );
  const report = buildDesignReliabilityCohortReport({
    suiteId: caseSpec.suiteId,
    cohortId: "candidate",
    cases: [caseSpec],
    runs: [passing, falseCompletion],
    reviews: [review],
    attributions: [],
    generatedAt: "2026-08-24T03:00:00.000Z"
  });
  assert.deepStrictEqual(report.overall.reliability.technicalDeliveryRate, {
    numerator: 1,
    denominator: 2,
    value: 0.5
  });
  assert.deepStrictEqual(report.overall.reliability.falseCompletionRate, {
    numerator: 1,
    denominator: 2,
    value: 0.5
  });
  assert.strictEqual(report.coverage.humanReviewedRuns, 1);
  assert.strictEqual(report.overall.quality.humanPassRate.denominator, 1);
  assert.deepStrictEqual(report.overall.reliability.agenticDecisionPreservationEvidenceCoverage, {
    numerator: 1,
    denominator: 2,
    value: 0.5
  });
  assert.deepStrictEqual(report.overall.reliability.agenticLevelOneDecisionPreservationRate, {
    numerator: 1,
    denominator: 1,
    value: 1
  });
  assert.strictEqual(report.overall.reliability.agenticHarnessWriteAttemptRunCount, 0);

  const conflictingReview = {
    ...JSON.parse(JSON.stringify(review)),
    reviewId: "review-conflict",
    decision: "needs_fix",
    pairwiseOutcome: "weaker"
  };
  const conflictReport = buildDesignReliabilityCohortReport({
    suiteId: caseSpec.suiteId,
    cohortId: "candidate",
    cases: [caseSpec],
    runs: [passing],
    reviews: [review, conflictingReview],
    attributions: []
  });
  assert.strictEqual(conflictReport.overall.quality.conflictingReviewRunCount, 1);
  assert.strictEqual(conflictReport.overall.quality.humanUsableRate.numerator, 0,
    "同一成稿出现 pass / needs_fix 冲突时不能按任一 pass 冒充商业可用");
  assert.strictEqual(
    report.cohortIntegrity.homogeneous,
    false,
    "同一 cohort 混入不同 Git / dirty / model / fixture 维度时必须显式失去同质性"
  );

  const differentCaseSet = JSON.parse(JSON.stringify(report));
  differentCaseSet.selector.caseSetDigest = `sha256:${"d".repeat(64)}`;
  assert.strictEqual(compareDesignReliabilityCohorts(report, differentCaseSet).comparable, false);
  assert.strictEqual(compareDesignReliabilityCohorts(report, report).comparable, true);

  const releaseGates = {
    minimumRunsPerFamily: 5,
    minimumRunsPerCase: 5,
    technicalDeliveryRate: 0.8,
    humanUsableRate: 0.7,
    completedPostWriteReadbackRate: 1,
    completedArtifactEvidenceRate: 1,
    falseCompletionRate: 0,
    wrongDocumentOrOverwriteCount: 0,
    userInterventionMedian: 0,
    userInterventionP90: 1
  };
  const passingFamily = {
    runs: 5,
    reliability: {
      technicalDeliveryRate: { numerator: 4, denominator: 5, value: 0.8 },
      completedPostWriteReadbackRate: { numerator: 5, denominator: 5, value: 1 },
      completedArtifactEvidenceRate: { numerator: 5, denominator: 5, value: 1 },
      falseCompletionRate: { numerator: 0, denominator: 5, value: 0 },
      wrongDocumentOrOverwriteCount: 0
    },
    quality: {
      humanReviewedRate: { numerator: 5, denominator: 5, value: 1 },
      strictHumanReviewedRate: { numerator: 5, denominator: 5, value: 1 },
      humanUsableRate: { numerator: 4, denominator: 5, value: 0.8 }
    },
    efficiency: { userInterventions: { count: 5, median: 0, p90: 1 } }
  };
  const releaseReport = {
    coverage: { missingCaseIds: [] },
    cohortIntegrity: {
      homogeneous: true,
      explicitFingerprintCoverage: { numerator: 15, denominator: 15, value: 1 }
    },
    byCase: {
      "case-a": JSON.parse(JSON.stringify(passingFamily))
    },
    byTaskFamily: Object.fromEntries(["main_image", "detail_page", "sku"].map((family) => [
      family,
      JSON.parse(JSON.stringify(passingFamily))
    ]))
  };
  const passingGateEvaluation = evaluateDesignReliabilityReleaseGates(releaseReport, releaseGates);
  assert.strictEqual(passingGateEvaluation.sampleReady, true, "每类五次且全部完成人工评审后才能形成正式成功率");
  assert.strictEqual(passingGateEvaluation.passed, true, "发布指标恰好达到清单阈值时必须通过");

  const unboundCohort = JSON.parse(JSON.stringify(releaseReport));
  unboundCohort.cohortIntegrity.explicitFingerprintCoverage = {
    numerator: 0,
    denominator: 15,
    value: 0
  };
  const unboundCohortEvaluation = evaluateDesignReliabilityReleaseGates(unboundCohort, releaseGates);
  assert.strictEqual(unboundCohortEvaluation.sampleReady, false);
  assert.strictEqual(unboundCohortEvaluation.passed, false, "自由文本 cohortId 不能代替受控维度指纹");

  const underSampledCase = JSON.parse(JSON.stringify(releaseReport));
  underSampledCase.byCase["case-a"].runs = 1;
  underSampledCase.byCase["case-a"].quality.strictHumanReviewedRate = {
    numerator: 1,
    denominator: 1,
    value: 1
  };
  const underSampledCaseEvaluation = evaluateDesignReliabilityReleaseGates(underSampledCase, releaseGates);
  assert.strictEqual(underSampledCaseEvaluation.sampleReady, false);
  assert.strictEqual(
    underSampledCaseEvaluation.checksByCase["case-a"].minimumRunsPerCase,
    false,
    "同一任务族总样本足够也不能掩盖单个 Case 样本不足"
  );

  const onePerfectRun = JSON.parse(JSON.stringify(releaseReport));
  for (const family of Object.keys(onePerfectRun.byTaskFamily)) {
    const familyReport = onePerfectRun.byTaskFamily[family];
    familyReport.runs = 1;
    familyReport.quality.humanReviewedRate = { numerator: 1, denominator: 1, value: 1 };
    familyReport.quality.strictHumanReviewedRate = { numerator: 1, denominator: 1, value: 1 };
    familyReport.quality.humanUsableRate = { numerator: 1, denominator: 1, value: 1 };
    familyReport.efficiency.userInterventions = { count: 1, median: 0, p90: 0 };
  }
  const oneRunEvaluation = evaluateDesignReliabilityReleaseGates(onePerfectRun, releaseGates);
  assert.strictEqual(oneRunEvaluation.sampleReady, false, "单次满分不得伪装成正式成功率");
  assert.strictEqual(oneRunEvaluation.passed, false, "单次满分不得越过 minimumRunsPerFamily");

  const partiallyReviewed = JSON.parse(JSON.stringify(releaseReport));
  partiallyReviewed.byTaskFamily.main_image.quality.humanReviewedRate = {
    numerator: 1,
    denominator: 5,
    value: 0.2
  };
  partiallyReviewed.byTaskFamily.main_image.quality.strictHumanReviewedRate = {
    numerator: 1,
    denominator: 5,
    value: 0.2
  };
  partiallyReviewed.byTaskFamily.main_image.quality.humanUsableRate = {
    numerator: 1,
    denominator: 5,
    value: 0.2
  };
  const partialReviewEvaluation = evaluateDesignReliabilityReleaseGates(partiallyReviewed, releaseGates);
  assert.strictEqual(partialReviewEvaluation.sampleReady, false, "只评审一小部分运行时正式成功率不可用");
  assert.strictEqual(partialReviewEvaluation.passed, false, "humanPassRate=1 不能掩盖大部分运行未评审");
  assert.ok(
    partialReviewEvaluation.checksByFamily.main_image.failedChecks.includes("minimumHumanReviewedRunsPerFamily"),
    "门禁报告必须指出人工评审样本不足"
  );

  console.log("Design Reliability 纯逻辑验证通过：TaskRun 合并、真实 mutation、假完成、人工评审分母、发布门禁与 cohort 可比性均已覆盖。");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
