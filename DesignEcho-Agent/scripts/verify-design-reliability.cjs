#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  REVIEW_VERSION,
  buildCaseDigest,
  buildDesignReliabilityCohortReport,
  compareDesignReliabilityCohorts,
  deriveDesignReliabilityRunObservation,
  evaluateDesignReliabilityReleaseGates,
  validateDesignReliabilityCase,
  validateDesignReliabilityRun
} = require("./lib/design-reliability-contract.cjs");

const ROOT = path.resolve(__dirname, "..");
const CASE_PATH = path.join(
  ROOT,
  "benchmarks",
  "design-reliability",
  "cases",
  "main-image-c1163-v1.json"
);

function readCase() {
  return JSON.parse(fs.readFileSync(CASE_PATH, "utf8"));
}

function mutationCall(seq, elapsedMs, historyStateId) {
  return {
    seq,
    name: "composeDesign",
    riskClass: "write",
    activityClass: "mutation",
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

function main() {
  const caseSpec = readCase();
  assert.strictEqual(validateDesignReliabilityCase(caseSpec).ok, true, "real case must validate");

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

  const review = {
    version: REVIEW_VERSION,
    reviewId: "review-1",
    runObservationId: passing.runObservationId,
    rubricId: caseSpec.oracle.rubricId,
    reviewerId: "designer-a",
    reviewedAt: "2026-08-24T02:00:00.000Z",
    blindedToCohort: true,
    evidenceRefs: ["output/main.jpg"],
    decision: "pass",
    scores: { overall: 0.8 },
    findings: [],
    confidence: "high",
    missingEvidence: [],
    boundaries: { devBenchmarkSidecarOnly: true, neverAffectsRuntime: true }
  };
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

  const differentCaseSet = JSON.parse(JSON.stringify(report));
  differentCaseSet.selector.caseSetDigest = `sha256:${"d".repeat(64)}`;
  assert.strictEqual(compareDesignReliabilityCohorts(report, differentCaseSet).comparable, false);
  assert.strictEqual(compareDesignReliabilityCohorts(report, report).comparable, true);

  const releaseGates = {
    minimumRunsPerFamily: 5,
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
      humanUsableRate: { numerator: 4, denominator: 5, value: 0.8 }
    },
    efficiency: { userInterventions: { count: 5, median: 0, p90: 1 } }
  };
  const releaseReport = {
    coverage: { missingCaseIds: [] },
    byTaskFamily: Object.fromEntries(["main_image", "detail_page", "sku"].map((family) => [
      family,
      JSON.parse(JSON.stringify(passingFamily))
    ]))
  };
  const passingGateEvaluation = evaluateDesignReliabilityReleaseGates(releaseReport, releaseGates);
  assert.strictEqual(passingGateEvaluation.sampleReady, true, "每类五次且全部完成人工评审后才能形成正式成功率");
  assert.strictEqual(passingGateEvaluation.passed, true, "发布指标恰好达到清单阈值时必须通过");

  const onePerfectRun = JSON.parse(JSON.stringify(releaseReport));
  for (const family of Object.keys(onePerfectRun.byTaskFamily)) {
    const familyReport = onePerfectRun.byTaskFamily[family];
    familyReport.runs = 1;
    familyReport.quality.humanReviewedRate = { numerator: 1, denominator: 1, value: 1 };
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

main();
