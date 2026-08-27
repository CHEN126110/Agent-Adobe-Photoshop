#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const Module = require("module");
const os = require("os");
const path = require("path");
const sharp = require("sharp");
const ts = require("typescript");

const {
  LEGACY_REVIEW_VERSION,
  REVIEW_VERSION,
  buildCaseDigest,
  buildComparisonEvidenceDigest,
  buildRubricDigest,
  buildReviewPacketProjectionDigest,
  buildDesignReliabilityCohortReport,
  calculateWeightedOverall,
  compareDesignReliabilityCohorts,
  deriveDesignReliabilityRunObservation,
  evaluateDesignReliabilityReleaseGates,
  requiredComparisonEvidenceKinds,
  sha256Text,
  stableStringify,
  validateDesignReliabilityCase,
  validateDesignReliabilityReview,
  validateDesignReliabilityRun
} = require("./lib/design-reliability-contract.cjs");
const {
  REVIEWER_RESPONSE_VERSION,
  createDesignReliabilityReviewPacket,
  verifyDesignReliabilityReviewerResponse
} = require("./lib/design-reliability-review-packet.cjs");
const {
  buildPhotoshopRuntimeBinding,
  deriveBuildId
} = require("./lib/photoshop-runtime-build-identity.cjs");
const {
  buildCanonicalAttemptSafetyLedger,
  buildFirstMutationBaselineProof,
  classifyUntrustedDebugBridgeFailure,
  buildPreflight,
  buildSkuLiveDeliveryEvidence,
  buildStatus,
  buildSuiteCaseSetDigest,
  buildSuiteRubricSetDigest,
  buildLiveAttemptCoverage,
  collectSidecars,
  evaluateFixtureInventory,
  evaluateDebugRendererPreflight,
  evaluateLiveEnvironmentSafety,
  inspectFixture,
  inspectEditablePsd,
  isOfficialAttemptCohortReady,
  loadSuite,
  parseArgs,
  parseReviewPacketSourceBindings,
  prepareFixture,
  prepareAnonymousReviewPacket,
  readFixtureInstance,
  recordAnonymousReview,
  readDebugBridgeExecutionFailure,
  revalidateOfficialReviewBundles,
  retainContextuallyValidReviews,
  retainContextuallyValidAttemptEvents,
  resolveLoopbackDebugBridge,
  resolveReliabilityEvidenceRoots,
  resolveSidecarOutputPath,
  sanitizeAttemptDiagnostic,
  shouldPersistPreflightReport,
  sidecarRoots,
  validateAttemptEventStateMachine,
  validateDebugBridgeReceipt,
  validateRubric,
  validateMutationBaselineAgainstObservation,
  writePreflightReport
} = require("./design-reliability.cjs");

const ROOT = path.resolve(__dirname, "..");
require("ts-node").register({
  transpileOnly: true,
  project: path.join(ROOT, "tsconfig.main.json")
});
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
const {
  buildRuntimeDeliveryReceipt,
  findRuntimeDeliverySourceHistoryStateRef,
  readRuntimeDeliveryReceipt
} = require(path.join(
  ROOT,
  "src",
  "shared",
  "agent-runtime-v5",
  "runtime-delivery-receipt.ts"
));
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
const DETAIL_CASE_PATH = path.join(
  ROOT,
  "benchmarks",
  "design-reliability",
  "cases",
  "detail-page-c1163-v1.json"
);
const DETAIL_RUBRIC_PATH = path.join(
  ROOT,
  "benchmarks",
  "design-reliability",
  "rubrics",
  "detail-page-commercial-v1.json"
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

function readDetailCase() {
  return JSON.parse(fs.readFileSync(DETAIL_CASE_PATH, "utf8"));
}

function readDetailRubric() {
  return JSON.parse(fs.readFileSync(DETAIL_RUBRIC_PATH, "utf8"));
}

function buildComparisonRefsForTest(caseSpec, run) {
  const finalRasterRefs = new Set((run.finalArtifactManifest?.artifacts || [])
    .filter((item) => item.kind === "raster_export")
    .map((item) => item.ref));
  const candidateRefs = (run.evidenceRefs || [])
    .filter((item) => item.kind === "raster_export"
      && item.verified === true
      && finalRasterRefs.has(item.ref))
    .map((item) => ({
      kind: "candidate_final",
      ref: `candidate:${String(item.ref).replace(/\\/g, "/")}@${String(item.digest).toLowerCase()}`
    }));
  const referenceRefs = (caseSpec.task?.reviewOnlyReferences || []).map((reference) => ({
    kind: reference.kind === "user_design" ? "user_design_anchor" : "eagle_anchor",
    ref: reference.kind === "user_design"
      ? `user-design:${reference.ref}@${reference.digest}`
      : `${reference.ref}@${reference.digest}`
  }));
  return [...candidateRefs, ...referenceRefs];
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

function finalArtifactManifest(refs = evidenceRefs()) {
  const artifacts = refs
    .filter((item) => ["editable_psd", "raster_export"].includes(item.kind) && item.verified === true)
    .map((item) => ({ kind: item.kind, ref: item.ref, digest: item.digest }))
    .sort((left, right) => left.ref.localeCompare(right.ref) || left.kind.localeCompare(right.kind));
  return {
    version: "design-reliability-final-artifact-manifest/v1",
    declaredBy: "agent_delivery_receipt",
    artifacts,
    manifestDigest: sha256Text(stableStringify(artifacts))
  };
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
    evidenceRefs: evidenceRefs(),
    finalArtifactManifest: finalArtifactManifest()
  });
}

async function main() {
  assert.strictEqual(resolveLoopbackDebugBridge("http://127.0.0.1:8767"), "http://127.0.0.1:8767");
  assert.strictEqual(resolveLoopbackDebugBridge("http://localhost:8767/"), "http://localhost:8767");
  assert.strictEqual(resolveLoopbackDebugBridge("http://[::1]:8767"), "http://[::1]:8767");
  for (const unsafeDebugBridge of [
    "https://127.0.0.1:8767",
    "http://example.com:8767",
    "http://user:pass@127.0.0.1:8767",
    "http://127.0.0.1:8767/chat",
    "http://127.0.0.1:8767?token=secret",
    "http://127.0.0.1:8767#fragment"
  ]) {
    assert.throws(
      () => resolveLoopbackDebugBridge(unsafeDebugBridge),
      /loopback|本机 HTTP/,
      `Debug Bridge 必须拒绝非本机安全 origin：${unsafeDebugBridge}`
    );
  }
  const sanitizedDiagnostic = sanitizeAttemptDiagnostic([
    "Authorization: Bearer bearer-secret-value",
    "api_key=api-secret-value",
    "debug_token: debug-secret-value",
    "refresh_token=refresh-secret-value",
    "token: generic-secret-value",
    "password=password-secret-value",
    "sk-abcdefghijklmnop",
    "C:\\Users\\person\\private.psd",
    "C:\\Users\\John Doe\\private design.psd",
    "\\\\server\\share\\private.psd",
    "\\\\server\\Customer Files\\private design.psd",
    "/Users/person/private.psd",
    "/Volumes/customer/private.psd",
    "/Volumes/Customer Files/private design.psd",
    "/var/folders/aa/private.psd",
    "/opt/designecho/private.json",
    "/mnt/project/private.psd",
    "/workspace/customer/private.psd",
    "/root/private/token.txt",
    "/data/Customer Files/private.psd",
    "/srv/customer/private.psd",
    "/media/customer/private.psd",
    "/app/customer/private.psd",
    "/run/user/1000/private.psd",
    "error_code=E42"
  ].join(" | "));
  for (const leaked of [
    "bearer-secret-value",
    "api-secret-value",
    "debug-secret-value",
    "refresh-secret-value",
    "generic-secret-value",
    "password-secret-value",
    "abcdefghijklmnop",
    "person/private.psd",
    "John Doe",
    "server\\share",
    "Customer Files",
    "customer/private.psd",
    "designecho/private.json",
    "project/private.psd",
    "private/token.txt"
  ]) {
    assert.strictEqual(sanitizedDiagnostic.includes(leaked), false, `Attempt diagnostic 泄露：${leaked}`);
  }
  assert.ok(sanitizedDiagnostic.includes("[redacted]"));
  assert.ok(sanitizedDiagnostic.includes("[LOCAL_PATH]"));
  assert.ok(sanitizedDiagnostic.includes("error_code=E42"), "脱敏后必须保留非敏感错误码");
  const debugFinalArtifactRefsModule = loadSelfContainedTypeScriptModule(path.join(
    ROOT,
    "src",
    "shared",
    "debug-final-artifact-refs.ts"
  ));
  assert.deepStrictEqual(
    debugFinalArtifactRefsModule.normalizeDebugFinalArtifactRefs([
      "C:\\fixture\\project\\主图\\成稿.psd",
      "C:\\fixture\\project\\主图\\成稿.jpg",
      "C:\\fixture\\project-other\\secret.jpg",
      "../escape.png",
      "file:C:/escape.png",
      "主图/成稿.jpg"
    ], "C:\\fixture\\project"),
    ["主图/成稿.psd", "主图/成稿.jpg"],
    "Debug 最终交付收据只能保留当前 fixture 内由 Runtime 验证的相对文件引用"
  );
  const skuDebugProjectRoot = "C:\\fixture\\project";
  const skuRasterRefs = ["SKU/2双装/1白色+黑色.jpg", "SKU/2双装/2浅肤+深肤.jpg"];
  const skuEditableRefs = [
    "SKU/可编辑/2双装/1白色+黑色.psb",
    "SKU/可编辑/2双装/2浅肤+深肤.psb"
  ];
  const skuRasterFileIdentities = skuRasterRefs.map((_ref, index) => ({
    sha256: String(index + 1).repeat(64).slice(0, 64),
    byteLength: 10_000 + index
  }));
  const skuEditableFileIdentities = skuEditableRefs.map((_ref, index) => ({
    sha256: String(index + 3).repeat(64).slice(0, 64),
    byteLength: 20_000 + index
  }));
  const absoluteSkuRef = (ref) => `${skuDebugProjectRoot}\\${ref.replace(/\//g, "\\")}`;
  const skuDebugSource = {
    version: "agent-debug-sku-delivery-source/v1",
    runtimeDeliveryReceipt: {
      status: "ready",
      settlementScope: "multi_document_task",
      outputs: ["editable_sku_batch_documents", "sku_images", "sku_manifest", "review_report"],
      resultRefs: ["workflow:sku-batch:export:1", "workflow:sku-batch:export:2"],
      resultRefProofs: [
        { resultRef: "workflow:sku-batch:export:1", effect: "save_export" },
        { resultRef: "workflow:sku-batch:export:2", effect: "save_export" }
      ],
      artifacts: skuRasterRefs.flatMap((ref, index) => ([{
        path: absoluteSkuRef(ref),
        kind: "raster_export",
        proof: "file_probe",
        fileIdentity: skuRasterFileIdentities[index],
        sourceHistoryStateRef: { documentId: 90 + index, historyStateId: 700 + index }
      }, {
        path: absoluteSkuRef(skuEditableRefs[index]),
        kind: "editable_document",
        proof: "staged_editable_document_promotion",
        fileIdentity: skuEditableFileIdentities[index],
        sourceHistoryStateRef: { documentId: 90 + index, historyStateId: 700 + index }
      }]))
    },
    skuExportReadback: {
      version: "sku-export-readback/v0",
      status: "ready_for_review",
      expectedExportCount: 2,
      actualExportCount: 2,
      fileProbeCount: 2,
      okFileProbeCount: 2,
      failedFileProbeCount: 0,
      missingFileProbeCount: 0,
      dimensionMismatchCount: 0,
      staleFileProbeCount: 0,
      visualMetricBlockerCount: 0,
      missingVisualMetricCount: 0
    },
    skuEditableDeliveryReadback: {
      version: "sku-editable-delivery-readback/v1",
      status: "ready",
      expectedCount: 2,
      verifiedCount: 2,
      expectedPaths: skuEditableRefs.map(absoluteSkuRef),
      verifiedPaths: skuEditableRefs.map(absoluteSkuRef),
      missingItemIds: [],
      violations: [],
      items: skuRasterRefs.map((rasterRef, index) => ({
        itemId: `combo:2:${index + 1}`,
        rasterPath: absoluteSkuRef(rasterRef),
        editablePath: absoluteSkuRef(skuEditableRefs[index]),
        templateName: "2双装",
        combination: index === 0 ? ["白色", "黑色"] : ["浅肤", "深肤"],
        sourceHistoryStateRef: { documentId: 90 + index, historyStateId: 700 + index },
        fileIdentity: skuEditableFileIdentities[index],
        copiedLayerIds: [300 + index * 2, 301 + index * 2],
        copiedLayerNames: index === 0 ? ["SKU_01_白色", "SKU_02_黑色"] : ["SKU_01_浅肤", "SKU_02_深肤"],
        freshnessProof: "new_path",
        promotionVerified: true
      }))
    }
  };
  const normalizedSkuDebugEvidence = debugFinalArtifactRefsModule.normalizeDebugSkuDeliveryEvidence(
    skuDebugSource,
    skuDebugProjectRoot
  );
  assert(normalizedSkuDebugEvidence, "完整的 paired SKU Debug source 必须形成项目相对证据投影");
  const malformedSkuDebugSources = [
    { path: ["skuEditableDeliveryReadback", "verifiedCount"], value: 1 },
    { path: ["skuEditableDeliveryReadback", "missingItemIds"], value: ["combo:2:2"] },
    { path: ["skuExportReadback", "failedFileProbeCount"], value: 1 },
    { path: ["skuExportReadback", "missingVisualMetricCount"], value: 1 },
    { path: ["runtimeDeliveryReceipt", "outputs"], value: ["sku_images"] },
    {
      path: ["runtimeDeliveryReceipt", "artifacts", 0, "path"],
      value: absoluteSkuRef("SKU/2双装/错位.jpg")
    },
    {
      path: ["runtimeDeliveryReceipt", "artifacts", 0, "fileIdentity", "sha256"],
      value: "not-a-sha256"
    },
    {
      path: ["runtimeDeliveryReceipt", "artifacts", 1, "sourceHistoryStateRef", "historyStateId"],
      value: 999
    },
    {
      path: ["skuEditableDeliveryReadback", "items", 0, "fileIdentity", "byteLength"],
      value: 1
    }
  ];
  for (const mutation of malformedSkuDebugSources) {
    const forged = JSON.parse(JSON.stringify(skuDebugSource));
    let target = forged;
    for (const segment of mutation.path.slice(0, -1)) target = target[segment];
    target[mutation.path.at(-1)] = mutation.value;
    assert.strictEqual(
      debugFinalArtifactRefsModule.normalizeDebugSkuDeliveryEvidence(forged, skuDebugProjectRoot),
      undefined,
      `自相矛盾的 SKU Debug source 必须失败关闭：${mutation.path.join(".")}`
    );
  }
  const skuEvidenceCase = {
    taskFamily: "sku",
    oracle: {
      outputInventory: {
        exactRasterExports: 2,
        exactEditableDocuments: 2,
        expectedRasterRefs: skuRasterRefs,
        expectedEditableRefs: skuEditableRefs
      }
    }
  };
  const skuArtifactEvidenceRefs = [
    ...skuRasterRefs.map((ref, index) => ({
      kind: "raster_export",
      ref,
       digest: `sha256:${skuRasterFileIdentities[index].sha256}`,
       size: skuRasterFileIdentities[index].byteLength,
      verified: true,
      artifactMetadata: { format: "jpeg", width: 1000, height: 1000 }
    })),
    ...skuEditableRefs.map((ref, index) => ({
      kind: "editable_psd",
      ref,
       digest: `sha256:${skuEditableFileIdentities[index].sha256}`,
       size: skuEditableFileIdentities[index].byteLength,
      verified: true,
      artifactMetadata: { format: "psb", width: 1000, height: 1000, layerCount: 3 }
    }))
  ];
  assert.strictEqual(buildSkuLiveDeliveryEvidence(
    skuEvidenceCase,
    {
      finalArtifactRefs: [...skuRasterRefs, ...skuEditableRefs],
      skuDeliveryEvidence: normalizedSkuDebugEvidence
    },
    skuArtifactEvidenceRefs
  ).length, 4, "完整 producer receipt/readback/file evidence 必须签发四种 SKU live evidence");
  assert.strictEqual(buildSkuLiveDeliveryEvidence(
    skuEvidenceCase,
    { finalArtifactRefs: [...skuRasterRefs, ...skuEditableRefs] },
    skuArtifactEvidenceRefs
  ).length, 0, "缺少 Runtime producer source 时不能按扩展名补造 SKU live evidence");
  const forgedNormalizedSkuEvidence = JSON.parse(JSON.stringify(normalizedSkuDebugEvidence));
  forgedNormalizedSkuEvidence.runtimeDeliveryReceipt.artifacts[0].path = "SKU/2双装/错位.jpg";
  assert.strictEqual(buildSkuLiveDeliveryEvidence(
    skuEvidenceCase,
    {
      finalArtifactRefs: [...skuRasterRefs, ...skuEditableRefs],
      skuDeliveryEvidence: forgedNormalizedSkuEvidence
    },
    skuArtifactEvidenceRefs
  ).length, 0, "伪造或错位的 Runtime producer source 不能签发 SKU live evidence");
  const replacedAfterProbeEvidenceRefs = JSON.parse(JSON.stringify(skuArtifactEvidenceRefs));
  replacedAfterProbeEvidenceRefs[0].digest = `sha256:${"e".repeat(64)}`;
  assert.strictEqual(buildSkuLiveDeliveryEvidence(
    skuEvidenceCase,
    {
      finalArtifactRefs: [...skuRasterRefs, ...skuEditableRefs],
      skuDeliveryEvidence: normalizedSkuDebugEvidence
    },
    replacedAfterProbeEvidenceRefs
  ).length, 0, "文件在生产者探针后被替换时，当前 evidence SHA-256 必须使正式 SKU 证据失败关闭");
  const guardedBaselineModule = loadSelfContainedTypeScriptModule(path.join(
    ROOT,
    "src",
    "shared",
    "guarded-photoshop-execution-baseline.ts"
  ));
  const baselineRuntimeIdentity = {
    version: "designecho-uxp-runtime-build/v1",
    buildId: "",
    builtAt: "2026-08-26T00:00:00.000Z",
    loadedAt: "2026-08-26T00:00:01.000Z",
    buildMode: "production",
    gitCommit: "b".repeat(40),
    gitDirty: false,
    dirtyScope: "DesignEcho-UXP",
    sourceDigest: `sha256:${"c".repeat(64)}`,
    features: ["diagnoseState.runtimeInfo"]
  };
  baselineRuntimeIdentity.buildId = deriveBuildId(baselineRuntimeIdentity);
  const expectedPhotoshopBuildId = baselineRuntimeIdentity.buildId;
  const baselineRuntimeBinding = {
    version: "debug-bridge-photoshop-runtime-binding/v1",
    live: baselineRuntimeIdentity,
    runtimeDigest: `sha256:${"d".repeat(64)}`,
    manifestDigest: `sha256:${"e".repeat(64)}`
  };
  const passingBaseline = guardedBaselineModule.createGuardedPhotoshopExecutionBaseline({
    requestId: "debug-request-pass",
    expectedPhotoshopRuntimeBuildId: expectedPhotoshopBuildId,
    expectedPhotoshopRuntimeBinding: baselineRuntimeBinding
  });
  let runtimeObservationCount = 0;
  let documentObservationCount = 0;
  let fakeMutationDispatchCount = 0;
  const passingObservers = {
    observePhotoshopRuntimeIdentity: async () => {
      runtimeObservationCount += 1;
      return baselineRuntimeIdentity;
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
    {
      name: "same build reloaded",
      runtimeIdentity: {
        ...baselineRuntimeIdentity,
        loadedAt: "2026-08-26T00:00:02.000Z"
      },
      openDocuments: 0
    },
    { name: "document already open", runtimeIdentity: baselineRuntimeIdentity, openDocuments: 1 },
    { name: "document state unavailable", runtimeIdentity: baselineRuntimeIdentity, openDocuments: undefined }
  ]) {
    const baseline = guardedBaselineModule.createGuardedPhotoshopExecutionBaseline({
      requestId: `debug-request-${blockedCase.name}`,
      expectedPhotoshopRuntimeBuildId: expectedPhotoshopBuildId,
      expectedPhotoshopRuntimeBinding: baselineRuntimeBinding
    });
    const decision = await guardedBaselineModule.enforceGuardedPhotoshopExecutionBaseline(
      baseline,
      "createDocument",
      {
        observePhotoshopRuntimeIdentity: async () => blockedCase.runtimeIdentity,
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
  const agentRuntimeSource = fs.readFileSync(path.join(
    ROOT,
    "src",
    "renderer",
    "services",
    "agent-runtime",
    "agent.ts"
  ), "utf8");
  const mainImageExecutorSource = fs.readFileSync(path.join(
    ROOT,
    "src",
    "renderer",
    "services",
    "skill-executors",
    "main-image.executor.ts"
  ), "utf8");
  const mainImageDeliveryRuntimeSource = fs.readFileSync(path.join(
    ROOT,
    "src",
    "renderer",
    "services",
    "skill-executors",
    "main-image-delivery-runtime.ts"
  ), "utf8");
  const skuBatchExecutorSource = fs.readFileSync(path.join(
    ROOT,
    "src",
    "renderer",
    "services",
    "skill-executors",
    "sku-batch.executor.ts"
  ), "utf8");
  const skuEditableDeliverySource = fs.readFileSync(path.join(
    ROOT,
    "src",
    "renderer",
    "services",
    "skill-executors",
    "sku-editable-delivery.service.ts"
  ), "utf8");
  const skuExportTransactionSource = fs.readFileSync(path.join(
    ROOT,
    "src",
    "renderer",
    "services",
    "skill-executors",
    "sku-export-transaction.service.ts"
  ), "utf8");
  const runtimeStagedDeliverySource = fs.readFileSync(path.join(
    ROOT,
    "src",
    "renderer",
    "services",
    "skill-executors",
    "runtime-staged-delivery.service.ts"
  ), "utf8");
  const stagedDeliveryPromotionSource = fs.readFileSync(path.join(
    ROOT,
    "src",
    "renderer",
    "services",
    "skill-executors",
    "staged-delivery-promotion.service.ts"
  ), "utf8");
  const agentSkillAtomicToolExecutionSource = fs.readFileSync(path.join(
    ROOT,
    "src",
    "shared",
    "agent-skill-atomic-tool-execution.ts"
  ), "utf8");
  const finalArtifactPathsSource = fs.readFileSync(path.join(
    ROOT,
    "src",
    "shared",
    "runtime-final-artifact-paths.ts"
  ), "utf8");
  const agentFinalArtifactCollectorSource = fs.readFileSync(path.join(
    ROOT,
    "src",
    "renderer",
    "services",
    "agent-runtime",
    "final-delivery-artifact-collector.ts"
  ), "utf8");
  const debugFinalArtifactSidecarSource = fs.readFileSync(path.join(
    ROOT,
    "src",
    "renderer",
    "services",
    "debug-final-artifact-sidecar.ts"
  ), "utf8");
  const debugFinalArtifactRefsSource = fs.readFileSync(path.join(
    ROOT,
    "src",
    "shared",
    "debug-final-artifact-refs.ts"
  ), "utf8");
  const designReliabilityCliSource = fs.readFileSync(path.join(
    ROOT,
    "scripts",
    "design-reliability.cjs"
  ), "utf8");
  const agentRuntimeTypesSource = fs.readFileSync(path.join(
    ROOT,
    "src",
    "renderer",
    "services",
    "agent-runtime",
    "types.ts"
  ), "utf8");
  const debugBridgeSource = fs.readFileSync(path.join(
    ROOT,
    "src",
    "main",
    "services",
    "debug-bridge-service.ts"
  ), "utf8");
  const preloadSource = fs.readFileSync(path.join(
    ROOT,
    "src",
    "main",
    "preload.ts"
  ), "utf8");
  const debugBridgeChatContractSource = fs.readFileSync(path.join(
    ROOT,
    "src",
    "shared",
    "debug-bridge-chat.ts"
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
    && debugBridgeSource.includes("readDebugBridgePhotoshopRuntimeBinding(")
    && debugBridgeSource.includes("expectedPhotoshopRuntimeBinding?.live.buildId"),
  "受控 Debug POST 必须在协议入口同时要求 buildId 与版本化完整 Runtime binding");
  assert(chatPanelSource.includes("debugBridgePhotoshopRuntimeLiveIdentitiesMatch(")
    && chatPanelSource.includes("任务完成时 Photoshop Runtime 完整身份已变化或无法读取")
    && mainProcessSource.includes("photoshop_runtime_binding_changed")
    && designReliabilityCliSource.includes("inspectPhotoshopRuntimeBinding(args)"),
  "受控 Debug bridge 必须在提交、完成与 recorder 独立复验三处按完整身份 fail closed");
  assert(chatPanelSource.includes("readDebugFinalArtifactPaths(debugRequestId)")
    && chatPanelSource.includes("finalArtifactRefs,")
    && chatPanelSource.includes("normalizeDebugFinalArtifactRefs("),
  "正式收据必须消费 Runtime 已验证交付结果，而不是扫描目录或把全部导出猜成最终稿");
  assert(agentRuntimeSource.includes("delete data.finalDeliveryArtifactRequestId;")
    && agentRuntimeSource.includes("delete data.finalDeliveryArtifactPaths;")
    && agentRuntimeSource.includes("executionSummary.runtimeDeliveryResultRefs = Array.from(new Set(")
    && !agentRuntimeTypesSource.includes("captureFinalDeliveryArtifactPaths")
    && agentFinalArtifactCollectorSource.includes("collectRuntimeFinalArtifactPaths({")
    && agentFinalArtifactCollectorSource.includes("producerReceiptCallRefs,")
    && agentFinalArtifactCollectorSource.includes("producerReceiptE2CallRefs,")
    && finalArtifactPathsSource.includes("readRuntimeDeliveryReceipt(entry.result)")
    && finalArtifactPathsSource.includes("samePhotoshopHistoryStateRef(receipt.sourceHistoryStateRef, input.finalRevision)")
    && finalArtifactPathsSource.includes("hasMutationAfter(input.timeline, index)")
    && finalArtifactPathsSource.includes("receipt.settlementScope === 'multi_document_task'")
    && finalArtifactPathsSource.includes("index !== latestMutationIndex")
    && finalArtifactPathsSource.includes("e2BoundCompositeProducer")
    && finalArtifactPathsSource.includes("if (!e2BoundCompositeProducer || index !== latestMutationIndex)")
    && !agentRuntimeSource.includes("data.finalDeliveryArtifactPaths = [...finalDeliveryArtifactPaths]")
    && autonomousExecutorSource.includes("context?.guardedPhotoshopExecutionBaseline")
    && autonomousExecutorSource.includes("result.executionSummary?.runtimeDeliveryResultRefs")
    && agentFinalArtifactCollectorSource.includes("collectAgentFinalDeliveryDebugProjection(")
    && agentFinalArtifactCollectorSource.includes("collectDebugSkuDeliverySource(")
    && autonomousExecutorSource.includes("collectAgentFinalDeliveryDebugProjection({")
    && autonomousExecutorSource.includes("publishDebugFinalDeliveryProjection(guardedFinalDeliveryRequestId, projection)")
    && !autonomousExecutorSource.includes("finalDeliveryArtifactRequestId:")
    && !autonomousExecutorSource.includes("finalDeliveryArtifactPaths:")
    && debugFinalArtifactSidecarSource.includes("debugFinalArtifactCaptureByRequest.has(normalizedRequestId)")
    && debugFinalArtifactSidecarSource.includes("export function publishDebugFinalDeliveryProjection(")
    && debugFinalArtifactSidecarSource.includes("skuDeliverySource: projection.skuDeliverySource")
    && debugFinalArtifactSidecarSource.includes("export function readDebugSkuDeliverySource(")
    && chatPanelSource.includes("beginDebugFinalArtifactCapture(debugRequestId)")
    && chatPanelSource.includes("clearDebugFinalArtifactCapture(debugRequestId)")
    && chatPanelSource.includes("normalizeDebugSkuDeliveryEvidence(")
    && chatPanelSource.includes("readDebugSkuDeliverySource(debugRequestId)")
    && chatPanelSource.includes("...(skuDeliveryEvidence ? { skuDeliveryEvidence } : {})")
    && debugFinalArtifactRefsSource.includes("export function normalizeDebugSkuDeliveryEvidence(")
    && debugFinalArtifactRefsSource.includes("receipt.artifacts.length === 0")
    && debugFinalArtifactRefsSource.includes("items.length !== editableReadback.items.length")
    && designReliabilityCliSource.includes("function buildSkuLiveDeliveryEvidence(")
    && designReliabilityCliSource.includes("const source = bindingProof?.skuDeliveryEvidence")
    && designReliabilityCliSource.includes("receipt.artifacts.length !== expectedCount * 2")
    && !chatPanelSource.includes("runtimeResultData?.finalDeliveryArtifactRequestId")
    && !chatPanelSource.includes("runtimeResultData?.finalDeliveryArtifactPaths"),
  "最终交付路径与 SKU producer 证据只能由 E2 调用谱系投影到受控 Debug sidecar，并经 fail-closed 规范化后进入可靠性证据；AgentConfig 与普通 result.data 不得承载调试路径");
  assert(mainImageExecutorSource.includes("runtimeDeliveryPlanAuthority?.freeze({")
    && mainImageExecutorSource.includes("runtimeDeliveryPlanAuthority.executeStagedArtifacts({")
    && mainImageExecutorSource.includes("inspectMainImageStagedDeliveryBeforePromotion({")
    && mainImageExecutorSource.includes("promoteRuntimeStagedDelivery({")
    && mainImageExecutorSource.includes("runtimeDeliveryPlanAuthority.acceptExternalCommit({")
    && mainImageExecutorSource.includes("buildMainImageDeliveryRuntimeEvidence({")
    && !mainImageExecutorSource.includes("runtimeDeliveryPlanAuthority.executeArtifacts({")
    && mainImageDeliveryRuntimeSource.includes("buildRuntimeDeliveryReceipt({")
    && mainImageDeliveryRuntimeSource.includes(
      "const settlementScope: RuntimeDeliverySettlementScope = input.plan.documents.length === 1"
    )
    && mainImageDeliveryRuntimeSource.includes("? 'single_document_revision'")
    && mainImageDeliveryRuntimeSource.includes(": 'multi_document_task';")
    && mainImageDeliveryRuntimeSource.includes("runtimeArtifacts.length === plannedArtifacts.length")
    && mainImageDeliveryRuntimeSource.includes("resultRefs.length === plannedArtifacts.length")
    && mainImageDeliveryRuntimeSource.includes("sourceHistoryRolesSatisfied")
    && mainImageDeliveryRuntimeSource.includes("input.externalCommitAccepted === true")
    && mainImageDeliveryRuntimeSource.includes("committedFilesMatchPlan")
    && mainImageDeliveryRuntimeSource.includes("expectedDeliveryPlan: input.plan.typedPlan")
    && mainImageDeliveryRuntimeSource.includes("effect: 'save_export' as const")
    && !mainImageExecutorSource.includes("runtimeFinalArtifactReceipt")
    && !mainImageDeliveryRuntimeSource.includes("runtimeFinalArtifactReceipt")
    && runtimeStagedDeliverySource.includes("return promoteRuntimeBoundStagedDeliverySet({")
    && runtimeStagedDeliverySource.includes("runtimeDeliveryPlanBinding: binding")
    && runtimeStagedDeliverySource.includes("artifactId: artifact.artifactId")
    && runtimeStagedDeliverySource.includes("destinationPath: artifact.path")
    && stagedDeliveryPromotionSource.includes("validateCommittedFiles({")
    && stagedDeliveryPromotionSource.includes(
      "runtimeDeliveryCommitReceipt: issueRuntimeOwnedSkillExternalDeliveryCommitReceipt({"
    )
    && agentSkillAtomicToolExecutionSource.includes(
      "RUNTIME_OWNED_SKILL_EXTERNAL_DELIVERY_COMMIT_RECEIPTS.has(commitInput.receipt)"
    )
    && skuBatchExecutorSource.includes("settlementScope: 'multi_document_task'")
    && skuBatchExecutorSource.includes("buildRuntimeDeliveryReceipt({")
    && !skuBatchExecutorSource.includes("runtimeFinalArtifactReceipt")
    && skuBatchExecutorSource.includes("runtimeDeliveryPlanAuthority.freeze({")
    && skuBatchExecutorSource.includes("promoteSkuStagedDeliverySet({")
    && skuBatchExecutorSource.includes("runtimeDeliveryPlanAuthority.acceptExternalCommit({")
    && skuBatchExecutorSource.includes("const runtimeArtifactSetExact = runtimeDeliveryArtifacts.length")
    && skuBatchExecutorSource.includes("&& runtimeDeliveryPlanCommitBound;")
    && skuBatchExecutorSource.includes("'editable_sku_batch_documents',")
    && skuBatchExecutorSource.includes('buildSkuRuntimeDeliveryArtifacts({')
    && skuBatchExecutorSource.includes("skuEditableDeliveryReadback.status === 'ready'")
    && skuBatchExecutorSource.includes("expectedDeliveryPlan: expectedExportInventory.deliveryPlanDigest")
    && skuEditableDeliverySource.includes("hasVerifiedEditableDocumentArtifact(record)")
    && skuEditableDeliverySource.includes("proof: 'staged_editable_document_promotion'")
    && skuEditableDeliverySource.includes('editableReceipt?.promotionVerified === true')
    && skuEditableDeliverySource.includes("structure.autoLayoutQaStatus !== 'ready'")
    && skuEditableDeliverySource.includes("verifySkuExportFreshness({")
    && skuExportTransactionSource.includes("const promoted = await promoteRuntimeBoundStagedDeliverySet({")
    && skuExportTransactionSource.includes(
      "runtimeDeliveryPlanBinding: input.runtimeDeliveryPlanBinding"
    )
    && skuBatchExecutorSource.includes("effect: 'save_export' as const")
    && skuBatchExecutorSource.includes("skuExportReadback.status === 'ready_for_review'"),
  "主图和 SKU 复合 Skill 必须把写前冻结计划、事务提交和文件读回绑定到精确 typed receipt");
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
  const submitChatToCurrentWindowIndex = mainProcessSource.indexOf(
    "function submitChatToCurrentWindow"
  );
  const debugTimeoutStart = mainProcessSource.indexOf(
    "const timer = setTimeout(() => {",
    submitChatToCurrentWindowIndex
  );
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
  assert(debugBridgeSource.includes("onChatSubmitPreflight")
    && debugBridgeSource.includes("renderer: rendererSnapshot")
    && preloadSource.includes("onDebugBridgeChatPreflight")
    && chatPanelSource.includes("selectedApiModelId: String(selectedModel?.apiModelId || '').trim()")
    && chatPanelSource.includes("projectPath: String(state.currentProject?.path || '').trim()")
    && !chatPanelSource.includes("apiKeys: state.apiKeys"),
  "Debug preflight 必须只返回脱敏模型/Provider/项目事实，不得暴露凭据");
  const handleSendStageIndex = chatPanelSource.indexOf("executionStage = 'handle_send_started'");
  const handleSendCallIndex = chatPanelSource.indexOf("await handleSend({", handleSendStageIndex);
  assert(handleSendStageIndex > 0
    && handleSendCallIndex > handleSendStageIndex
    && chatPanelSource.slice(handleSendStageIndex, handleSendCallIndex).includes("writePossible = true")
    && chatPanelSource.includes("return await submitAndWait();")
    && chatPanelSource.includes("return await runWithSkillBridgesSuppressed(submitAndWait);")
    && debugBridgeChatContractSource.includes("'before_handle_send'")
    && debugBridgeChatContractSource.includes("writePossible: boolean"),
  "结构化拒绝必须在 handleSend 前保持 writePossible=false，进入 handleSend 前同步翻为 true");
  assert(mainProcessSource.includes("readDebugBridgeChatExecutionFailure(payload)")
    && preloadSource.includes("readPreloadDebugBridgeChatFailureEnvelope(result)")
    && debugBridgeSource.includes("error: failure.message,")
    && debugBridgeSource.includes("sendExecutionFailure("),
  "Renderer/Main/HTTP 必须原样传递结构化执行阶段与副作用可能性");
  const runLivePreflightIndex = designReliabilityCliSource.indexOf("const preflight = await buildPreflight");
  const runLiveArmedIndex = designReliabilityCliSource.indexOf("const armedAttempt = writeLiveAttemptEvent", runLivePreflightIndex);
  assert(runLivePreflightIndex > 0
    && runLiveArmedIndex > runLivePreflightIndex
    && designReliabilityCliSource.includes("renderer_model_mismatch")
    && designReliabilityCliSource.includes("renderer_provider_mismatch")
    && designReliabilityCliSource.includes("renderer_project_not_bound_to_fixture")
    && designReliabilityCliSource.includes("classifyUntrustedDebugBridgeFailure(error)"),
  "run-live 必须在 armed 前核对 Renderer 模型/Provider/项目，并只按结构化副作用事实分流终态");

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
  const expectedPhotoshopSourceDigest = `sha256:${"d".repeat(64)}`;
  const verifiedPhotoshopBuildId = deriveBuildId({
    buildMode: "production",
    gitCommit: expectedCommit,
    gitDirty: false,
    sourceDigest: expectedPhotoshopSourceDigest
  });
  const safePhotoshopRuntime = {
    version: "designecho-uxp-runtime-build/v1",
    buildId: verifiedPhotoshopBuildId,
    builtAt: "2026-08-26T00:00:00.000Z",
    loadedAt: "2026-08-26T00:00:01.000Z",
    buildMode: "production",
    gitCommit: expectedCommit,
    gitDirty: false,
    dirtyScope: "DesignEcho-UXP",
    sourceDigest: expectedPhotoshopSourceDigest,
    features: ["diagnoseState.runtimeInfo"]
  };
  const safePhotoshopBuildVerification = {
    version: "designecho-photoshop-runtime-build-verification/v1",
    ready: true,
    artifacts: {
      artifactsVerified: true,
      identity: {
        ...safePhotoshopRuntime,
        runtimeDigest: `sha256:${"e".repeat(64)}`,
        manifestDigest: `sha256:${"f".repeat(64)}`
      }
    },
    manifestMatchesCurrentCheckout: true,
    live: {
      identity: safePhotoshopRuntime,
      matchesManifest: true,
      matchesCurrentCheckout: true
    },
    issues: []
  };
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
          runtime: safePhotoshopRuntime
        }
      }
    },
    photoshopRuntimeBuildVerification: safePhotoshopBuildVerification,
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
  assert.strictEqual(safeLiveEnvironment.checks.photoshopRuntimeArtifactsVerified, true);
  assert.strictEqual(safeLiveEnvironment.photoshop.runtimeArtifactDigest, `sha256:${"e".repeat(64)}`);
  const safePhotoshopRuntimeBinding = buildPhotoshopRuntimeBinding(
    safePhotoshopBuildVerification
  );
  assert.deepStrictEqual(
    safeLiveEnvironment.photoshop.runtimeBinding,
    safePhotoshopRuntimeBinding,
    "preflight 必须把已独立验证的 live 全身份与 runtime/manifest 摘要签成正式绑定"
  );
  assert.strictEqual(evaluateLiveEnvironmentSafety({
    ...safeLiveEnvironmentInput,
    photoshopRuntimeBuildVerification: {
      ...safePhotoshopBuildVerification,
      ready: false,
      issues: [{ code: "runtime_digest_mismatch" }]
    }
  }).blockers.includes("photoshop_runtime_build_identity_mismatch"), true,
  "磁盘 runtime.js、清单、checkout 或 live 身份任一不一致时必须阻止正式 Case");

  const matchingRendererPreflight = evaluateDebugRendererPreflight({
    probe: {
      reachable: true,
      status: 200,
      responseBody: {
        success: true,
        guardedWriteProtocol: "debug-bridge-chat-submit/v1",
        renderer: {
          version: "debug-bridge-chat-preflight/v1",
          capturedAt: "2026-08-26T00:00:00.000Z",
          selectedProvider: "openai-codex",
          selectedModelId: "codex-subscription-gpt-5-6-sol",
          selectedApiModelId: "gpt-5.6-sol",
          selectedModelResolved: true,
          projectPath: "C:/fixture/project",
          chatBusy: false
        }
      }
    },
    expectedProvider: "openai-codex",
    expectedModelId: "gpt-5.6-sol",
    expectedProjectPath: "C:/fixture/project"
  });
  assert.strictEqual(matchingRendererPreflight.ready, true,
    "Renderer 模型 API ID、Provider 与项目均匹配时应通过写前预检");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(matchingRendererPreflight, "projectPath"), false,
    "持久化 preflight 摘要不得复制 Renderer 的本机绝对项目路径");
  assert.strictEqual(evaluateDebugRendererPreflight({
    ...matchingRendererPreflight,
    probe: {
      reachable: true,
      responseBody: {
        success: true,
        guardedWriteProtocol: "debug-bridge-chat-submit/v1",
        renderer: {
          version: "debug-bridge-chat-preflight/v1",
          capturedAt: "2026-08-26T00:00:00.000Z",
          selectedProvider: "claude-subscription",
          selectedModelId: "claude-subscription-opus",
          selectedApiModelId: "opus",
          selectedModelResolved: true,
          projectPath: "C:/fixture/project",
          chatBusy: false
        }
      }
    },
    expectedProvider: "openai-codex",
    expectedModelId: "gpt-5.6-sol",
    expectedProjectPath: "C:/fixture/project"
  }).ready, false, "错误模型不得等到 submission_started 后才发现");
  const safePreSubmitFailure = {
    version: "debug-bridge-chat-execution-failure/v1",
    stage: "before_handle_send",
    writePossible: false,
    message: "selected model mismatch",
    code: "renderer_submission_rejected_before_handle_send"
  };
  assert.deepStrictEqual(
    readDebugBridgeExecutionFailure({ failure: safePreSubmitFailure }),
    safePreSubmitFailure
  );
  assert.strictEqual(classifyUntrustedDebugBridgeFailure({
    debugBridgeResponse: { failure: safePreSubmitFailure }
  }), "submission_rejected_before_execution",
  "handleSend 前的结构化拒绝必须形成安全终态，不要求 unknown-write reconciliation");
  assert.strictEqual(classifyUntrustedDebugBridgeFailure({
    debugBridgeFailure: {
      ...safePreSubmitFailure,
      stage: "handle_send_started",
      writePossible: true
    }
  }), "submission_unknown_write_state",
  "进入 handleSend 后没有 completion receipt 时必须保持 unknown-write");
  assert.strictEqual(classifyUntrustedDebugBridgeFailure(new Error("模型不一致")),
    "submission_unknown_write_state",
  "不得再用错误文案猜测写入安全性");

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
    expectedPhotoshopRuntimeBuildId: verifiedPhotoshopBuildId,
    expectedPhotoshopRuntimeBinding: safePhotoshopRuntimeBinding,
    submittedPhotoshopRuntimeIdentity: safePhotoshopRuntime,
    completedPhotoshopRuntimeIdentity: safePhotoshopRuntime,
    submittedPhotoshopRuntimeBuildId: verifiedPhotoshopBuildId,
    completedPhotoshopRuntimeBuildId: verifiedPhotoshopBuildId,
    expectedPhotoshopRuntimeMatchedAtSubmission: true,
    photoshopRuntimeUnchangedThroughCompletion: true,
    photoshopRuntimeBindingMatchedAtSubmission: true,
    photoshopRuntimeBindingUnchangedThroughCompletion: true,
    firstPhotoshopMutationBaseline: {
      version: "guarded-photoshop-execution-baseline-receipt/v0",
      status: "not_reached",
      requestId: "debug-request-1",
      expectedPhotoshopRuntimeBuildId: verifiedPhotoshopBuildId,
      expectedPhotoshopRuntimeBinding: safePhotoshopRuntimeBinding
    },
    finalArtifactRefs: ["主图/候选.psd", "主图/候选.jpg"]
  };
  const validDebugReceiptInput = {
    fixtureRoot: "C:/fixture/project",
    provider: "provider-a",
    modelId: "model-a",
    gitCommit: expectedCommit,
    runtimeBuildId: "designecho-test-build",
    photoshopRuntimeBuildId: verifiedPhotoshopBuildId,
    photoshopRuntimeBinding: safePhotoshopRuntimeBinding
  };
  assert.strictEqual(validateDebugBridgeReceipt(
    { result: { receipt: validDebugReceipt } },
    validDebugReceiptInput
  ).ok, true, "提交前、首次写与完成后协议字段完整时 receipt 必须可信");
  const firstMutationBaselineProof = buildFirstMutationBaselineProof(validDebugReceipt);
  assert.strictEqual(firstMutationBaselineProof.status, "not_reached");
  assert.match(firstMutationBaselineProof.requestIdDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(firstMutationBaselineProof.proofDigest, /^sha256:[a-f0-9]{64}$/);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(firstMutationBaselineProof, "requestId"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(firstMutationBaselineProof, "error"), false,
    "Attempt 只持久化脱敏首次写入证明，不能保存原始响应或错误正文");
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
  const sameBuildIdDifferentLiveIdentity = {
    ...validDebugReceipt,
    submittedPhotoshopRuntimeIdentity: {
      ...safePhotoshopRuntime,
      builtAt: "2026-08-26T00:00:02.000Z"
    }
  };
  assert.strictEqual(validateDebugBridgeReceipt(
    { result: { receipt: sameBuildIdDifferentLiveIdentity } },
    validDebugReceiptInput
  ).ok, false,
  "preflight 后重载同 buildId、不同 builtAt 的 UXP Runtime 必须被完整身份收据拒绝");
  const sameBuildIdDifferentRuntimeArtifact = {
    ...validDebugReceipt,
    expectedPhotoshopRuntimeBinding: {
      ...safePhotoshopRuntimeBinding,
      runtimeDigest: `sha256:${"0".repeat(64)}`
    }
  };
  assert.strictEqual(validateDebugBridgeReceipt(
    { result: { receipt: sameBuildIdDifferentRuntimeArtifact } },
    validDebugReceiptInput
  ).ok, false,
  "同 buildId 但 runtime.js 摘要漂移的收据不得复用 preflight 身份");
  const sameBuildIdReloadedAtCompletion = {
    ...validDebugReceipt,
    completedPhotoshopRuntimeIdentity: {
      ...safePhotoshopRuntime,
      loadedAt: "2026-08-26T00:00:03.000Z"
    }
  };
  assert.strictEqual(validateDebugBridgeReceipt(
    { result: { receipt: sameBuildIdReloadedAtCompletion } },
    validDebugReceiptInput
  ).ok, false,
  "执行中重新加载同 buildId Runtime 必须因 loadedAt 漂移被拒绝");
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
    verifiedPhotoshopBuildId
  ).ok, true, "没有 mutation 时 not_reached 由技术交付判失败，不伪造成协议错误");
  assert.strictEqual(validateMutationBaselineAgainstObservation(
    validDebugReceipt,
    { observed: { observedMutationCalls: 1 } },
    verifiedPhotoshopBuildId
  ).ok, false, "已有 mutation 时 baseline=not_reached 必须拒绝");
  const blockedMutationReceipt = {
    ...validDebugReceipt,
    firstPhotoshopMutationBaseline: {
      version: "guarded-photoshop-execution-baseline-receipt/v0",
      status: "blocked",
      requestId: "debug-request-1",
      expectedPhotoshopRuntimeBuildId: verifiedPhotoshopBuildId,
      expectedPhotoshopRuntimeBinding: safePhotoshopRuntimeBinding,
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
    verifiedPhotoshopBuildId
  ).ok, true);
  const passedMutationReceipt = {
    ...validDebugReceipt,
    firstPhotoshopMutationBaseline: {
      version: "guarded-photoshop-execution-baseline-receipt/v0",
      status: "passed",
      requestId: "debug-request-1",
      expectedPhotoshopRuntimeBuildId: verifiedPhotoshopBuildId,
      expectedPhotoshopRuntimeBinding: safePhotoshopRuntimeBinding,
      observedPhotoshopRuntimeBuildId: verifiedPhotoshopBuildId,
      observedPhotoshopRuntimeIdentity: safePhotoshopRuntime,
      openDocumentCount: 0,
      firstMutationToolName: "createDocument"
    }
  };
  assert.strictEqual(validateMutationBaselineAgainstObservation(
    passedMutationReceipt,
    { observed: { observedMutationCalls: 1 } },
    verifiedPhotoshopBuildId
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
  const designDirectiveFactsCase = JSON.parse(JSON.stringify(caseSpec));
  designDirectiveFactsCase.task.fixtureGeneratedInputs[0].facts.product_claims[0].value = "主体居中并使用浅粉背景色";
  designDirectiveFactsCase.caseDigest = buildCaseDigest(designDirectiveFactsCase);
  assert.strictEqual(
    validateDesignReliabilityCase(designDirectiveFactsCase).ok,
    false,
    "带 provenance 的 claim 也不能伪装设计指令进入 fixture facts"
  );
  const designDirectiveProductTypeCase = JSON.parse(JSON.stringify(caseSpec));
  designDirectiveProductTypeCase.task.fixtureGeneratedInputs[0].facts.product_type = "主体居中并使用浅粉背景色";
  designDirectiveProductTypeCase.caseDigest = buildCaseDigest(designDirectiveProductTypeCase);
  assert.strictEqual(validateDesignReliabilityCase(designDirectiveProductTypeCase).ok, false,
    "所有自由文本事实叶子都必须拒绝设计指令，不只检查 product_claims");
  const designDirectiveColorMappingCase = JSON.parse(JSON.stringify(readSkuCase()));
  designDirectiveColorMappingCase.task.fixtureGeneratedInputs[0]
    .facts.color_mapping["1"].displayName = "主体居中粉底白字";
  designDirectiveColorMappingCase.caseDigest = buildCaseDigest(designDirectiveColorMappingCase);
  assert.strictEqual(validateDesignReliabilityCase(designDirectiveColorMappingCase).ok, false,
    "颜色映射的展示名也不能夹带版式、配色或排版决定");
  const unknownFactCase = JSON.parse(JSON.stringify(caseSpec));
  unknownFactCase.task.fixtureGeneratedInputs[0].facts.selected_asset = "S82646/YYC_8814.jpg";
  unknownFactCase.caseDigest = buildCaseDigest(unknownFactCase);
  assert.strictEqual(validateDesignReliabilityCase(unknownFactCase).ok, false,
    "fixture facts 未知字段不得偷渡素材或版式选择");

  const exactFinalArtifactReceipt = buildRuntimeDeliveryReceipt({
    status: "ready",
    settlementScope: "single_document_revision",
    outputs: ["main_image_preview"],
    resultRefs: ["main-image-export-1"],
    sourceHistoryStateRef: { documentId: 7, historyStateId: 20 },
    artifacts: [{
      path: "C:/fixture/project/主图/最终候选.jpg",
      kind: "raster_export",
      proof: "file_probe"
    }]
  });
  const readExactFinalArtifactReceipt = readRuntimeDeliveryReceipt({
    success: true,
    data: {
      runtimeDeliveryReceipt: exactFinalArtifactReceipt,
      unrelatedPreviewPath: "C:/fixture/project/主图/过程预览.jpg"
    }
  });
  assert.deepStrictEqual(
    readExactFinalArtifactReceipt?.artifacts.map((artifact) => artifact.path),
    ["C:/fixture/project/主图/最终候选.jpg"],
    "typed final-artifact receipt 只能返回生产者声明的精确最终集合，不能扫描同一结果中的其他路径"
  );
  assert.deepStrictEqual(
    readExactFinalArtifactReceipt?.sourceHistoryStateRef,
    { documentId: 7, historyStateId: 20 },
    "通用交付收据必须保留精确 Host 源版本，供最终集合结算而不是供 benchmark/debug 持久化"
  );
  const multiDocumentResultRefs = Array.from(
    { length: 19 },
    (_, index) => `workflow:sku-batch:export:${index + 1}`
  );
  const multiDocumentFinalArtifactReceipt = buildRuntimeDeliveryReceipt({
    status: "ready",
    settlementScope: "multi_document_task",
    outputs: ["sku_images"],
    resultRefs: multiDocumentResultRefs,
    resultRefProofs: multiDocumentResultRefs.map((resultRef) => ({
      resultRef,
      effect: "save_export"
    })),
    artifacts: Array.from({ length: 19 }, (_, index) => ({
      path: `C:/fixture/project/SKU/${String(index + 1).padStart(2, "0")}.jpg`,
      kind: "raster_export",
      proof: "file_probe",
      fileIdentity: {
        sha256: (index + 1).toString(16).padStart(64, "0"),
        byteLength: 10_000 + index
      },
      sourceHistoryStateRef: { documentId: index + 1, historyStateId: index + 101 }
    }))
  });
  assert.strictEqual(multiDocumentFinalArtifactReceipt.status, "ready",
    "跨 Photoshop 文档的 SKU 精确批次必须诚实声明 multi_document_task，而不是伪造单 revision");
  assert.strictEqual(multiDocumentFinalArtifactReceipt.sourceHistoryStateRef, undefined,
    "multi_document_task 不得携带虚假的单一 Photoshop 源版本");
  assert.strictEqual(buildRuntimeDeliveryReceipt({
    status: "ready",
    settlementScope: "multi_document_task",
    outputs: ["sku_images"],
    resultRefs: ["workflow:sku-batch:export:1"],
    resultRefProofs: [{ resultRef: "workflow:sku-batch:export:1", effect: "save_export" }],
    sourceHistoryStateRef: { documentId: 7, historyStateId: 20 },
    artifacts: [{
      path: "C:/fixture/project/SKU/错误单版本.jpg",
      kind: "raster_export",
      proof: "file_probe",
      fileIdentity: { sha256: "a".repeat(64), byteLength: 10_000 },
      sourceHistoryStateRef: { documentId: 7, historyStateId: 20 }
    }]
  }).status, "incomplete", "多文档批次不能伪装为单一 Photoshop revision");
  assert.strictEqual(findRuntimeDeliverySourceHistoryStateRef([
    { sourceHistoryStateRef: { documentId: 7, historyStateId: 20 } },
    { sourceHistoryStateRef: { documentId: 8, historyStateId: 30 } }
  ]), undefined, "跨文档生产结果不能被压成一个共同 sourceHistoryStateRef");
  assert.deepStrictEqual(findRuntimeDeliverySourceHistoryStateRef([
    { historyStateRef: { documentId: 7, historyStateId: 10 } },
    { historyStateRef: { documentId: 7, historyStateId: 11 } }
  ], {
    historyStateRef: { documentId: 7, historyStateId: 12 }
  }), { documentId: 7, historyStateId: 12 },
  "主图早期多次写入不能让共同 revision 求交失败；只接受显式最终 acceptance 的稳定版本");
  assert.strictEqual(findRuntimeDeliverySourceHistoryStateRef([
    { sourceHistoryStateRef: { documentId: 7, historyStateId: 11 } }
  ], {
    historyStateRef: { documentId: 7, historyStateId: 12 }
  }), undefined, "文件提交 source revision 与最终 acceptance 不一致时必须拒绝");
  assert.strictEqual(findRuntimeDeliverySourceHistoryStateRef([
    { sourceHistoryStateRef: { documentId: 7, historyStateId: 0 } }
  ], {
    historyStateRef: { documentId: 7, historyStateId: 12 }
  }), undefined, "无效 export source revision 不能被最终 acceptance 静默覆盖");
  assert.strictEqual(
    Object.keys(exactFinalArtifactReceipt).some((key) => /benchmark|debug|finalDeliveryArtifactPaths/i.test(key)),
    false,
    "生产 typed receipt 不得夹带 benchmark/debug 专属状态或瞬态最终路径"
  );
  const forgedFinalArtifactReceipt = JSON.parse(JSON.stringify(exactFinalArtifactReceipt));
  forgedFinalArtifactReceipt.boundaries.completesDeliveryByItself = true;
  assert.strictEqual(readRuntimeDeliveryReceipt({
    data: { runtimeDeliveryReceipt: forgedFinalArtifactReceipt }
  }), undefined, "最终文件收据不能取得任务完成权");
  const legacyFinalArtifactReceipt = JSON.parse(JSON.stringify(exactFinalArtifactReceipt));
  legacyFinalArtifactReceipt.version = "runtime-delivery-receipt/v0";
  const legacyDeliveryReceipt = readRuntimeDeliveryReceipt({
    data: { runtimeDeliveryReceipt: legacyFinalArtifactReceipt }
  });
  assert.strictEqual(legacyDeliveryReceipt?.status, "incomplete",
    "v0 交付收据只能作为历史不完整事实读取");
  assert.deepStrictEqual(legacyDeliveryReceipt?.artifacts, [],
    "旧协议不能携带新版精确最终文件集合");
  const invalidRevisionFinalArtifactReceipt = JSON.parse(JSON.stringify(exactFinalArtifactReceipt));
  invalidRevisionFinalArtifactReceipt.sourceHistoryStateRef.historyStateId = 0;
  assert.strictEqual(readRuntimeDeliveryReceipt({
    data: { runtimeDeliveryReceipt: invalidRevisionFinalArtifactReceipt }
  }), undefined, "无效 Host revision 不能取得最终集合结算资格");
  assert.strictEqual(buildRuntimeDeliveryReceipt({
    status: "ready",
    settlementScope: "single_document_revision",
    outputs: ["main_image_preview"],
    resultRefs: ["main-image-export-invalid"],
    sourceHistoryStateRef: { documentId: 7, historyStateId: 20 },
    artifacts: [{
      path: "C:/fixture/project/主图/伪装成品.txt",
      kind: "raster_export",
      proof: "file_probe"
    }]
  }).status, "incomplete", "文件类型与 artifact kind 不一致时必须 fail closed");

  const passing = buildPassingObservation();
  assert.strictEqual(validateDesignReliabilityRun(passing).ok, true, "derived run must validate");
  for (const unsafeRef of [
    "debug:C:\\Users\\x.png",
    "file:C:/x.png",
    "../private.jpg",
    "debug:/etc/passwd",
    "receipt:/Users/x"
  ]) {
    const unsafeRun = JSON.parse(JSON.stringify(passing));
    unsafeRun.evidenceRefs.push({ kind: "debug", ref: unsafeRef, verified: true });
    assert.strictEqual(validateDesignReliabilityRun(unsafeRun).ok, false,
      `Run evidence 必须拒绝不安全引用：${unsafeRef}`);
  }
  const sidecarRoot = path.join(os.tmpdir(), "designecho-sidecar-path-test");
  const safeSidecarPath = resolveSidecarOutputPath(
    sidecarRoot,
    ["reviews", "../../outside"],
    "debug:C:\\Users\\review.json"
  );
  assert.strictEqual(path.relative(sidecarRoot, safeSidecarPath).startsWith(".."), false,
    "sidecar 文件名 ID 必须经过安全化并保持在指定 root 内");
  const dotDotSidecarPath = resolveSidecarOutputPath(sidecarRoot, ["reviews", ".."], "..");
  assert.strictEqual(path.relative(sidecarRoot, dotDotSidecarPath).startsWith(".."), false,
    "sidecar 的精确 .. ID 也不能穿越 root");
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
    evidenceRefs: evidenceRefs(),
    finalArtifactManifest: finalArtifactManifest()
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
  const expectedReviewComparisonRefs = [
    {
      kind: 'candidate_final',
      ref: `candidate:output/main.jpg@sha256:${'b'.repeat(64)}`
    },
    ...caseSpec.task.reviewOnlyReferences.map((reference) => ({
      kind: reference.kind === 'user_design' ? 'user_design_anchor' : 'eagle_anchor',
      ref: reference.kind === 'user_design'
        ? `user-design:${reference.ref}@${reference.digest}`
        : `${reference.ref}@${reference.digest}`
    }))
  ];
  const review = {
    version: REVIEW_VERSION,
    reviewId: "review-1",
    runObservationId: passing.runObservationId,
    rubricId: caseSpec.oracle.rubricId,
    rubricDigest: buildRubricDigest(rubric),
    reviewerId: "designer-a",
    reviewedAt: "2026-08-24T02:00:00.000Z",
    blindedToCohort: true,
    blindedToCandidateOrigin: true,
    evidenceProtocol: "bound_self_reported",
    evidenceRefs: expectedReviewComparisonRefs.map((item) => item.ref),
    comparisonEvidenceKinds: requiredComparisonEvidenceKinds(caseSpec),
    comparisonEvidenceRefs: expectedReviewComparisonRefs,
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
    "当前 Run / Case 证据绑定、阈值、pairwise 与适用参考齐全时诊断评审才合法"
  );
  const runWithPreview = JSON.parse(JSON.stringify(passing));
  runWithPreview.evidenceRefs.push({
    kind: "raster_export",
    ref: "output/preview.jpg",
    digest: `sha256:${"8".repeat(64)}`,
    verified: true
  });
  assert.strictEqual(
    validateDesignReliabilityReview(review, {
      rubric,
      caseSpec,
      run: runWithPreview,
      enforceBlindProtocol: true
    }).ok,
    true,
    "未进入 Agent finalArtifactManifest 的预览图不得被强制当作最终候选"
  );
  const runWithoutFinalManifest = JSON.parse(JSON.stringify(passing));
  delete runWithoutFinalManifest.finalArtifactManifest;
  assert.strictEqual(
    validateDesignReliabilityReview(review, {
      rubric,
      caseSpec,
      run: runWithoutFinalManifest,
      enforceBlindProtocol: true
    }).ok,
    false,
    "可评分 Review 必须绑定 Agent 声明的最终交付清单，不能把全部导出自动视为最终稿"
  );
  const previewAsFinalReview = JSON.parse(JSON.stringify(review));
  const previewRef = `candidate:output/preview.jpg@sha256:${"8".repeat(64)}`;
  previewAsFinalReview.evidenceRefs.push(previewRef);
  previewAsFinalReview.comparisonEvidenceRefs.push({ kind: "candidate_final", ref: previewRef });
  assert.strictEqual(
    validateDesignReliabilityReview(previewAsFinalReview, {
      rubric,
      caseSpec,
      run: runWithPreview,
      enforceBlindProtocol: true
    }).ok,
    false,
    "评审不得把 Run 中存在但未声明为最终交付的预览图夹带进候选集合"
  );
  for (const unsafeRef of [
    "debug:C:\\Users\\x.png",
    "file:C:/x.png",
    "../private.jpg",
    "debug:/etc/passwd",
    "receipt:/Users/x"
  ]) {
    const unsafeReview = JSON.parse(JSON.stringify(review));
    unsafeReview.evidenceRefs.push(unsafeRef);
    assert.strictEqual(
      validateDesignReliabilityReview(unsafeReview, {
        rubric,
        caseSpec,
        run: passing,
        enforceBlindProtocol: true
      }).ok,
      false,
      `Review evidence 必须拒绝不安全引用：${unsafeRef}`
    );
  }
  const unsupportedAnonymousReview = {
    ...JSON.parse(JSON.stringify(review)),
    evidenceProtocol: "anonymous_packet_verified"
  };
  assert.strictEqual(
    validateDesignReliabilityReview(unsupportedAnonymousReview, {
      rubric,
      caseSpec,
      run: passing,
      enforceBlindProtocol: true
    }).ok,
    false,
    "匿名评审包尚未接入验证器时，自报协议不得进入正式成功率"
  );

  const anonymousPacketRoot = fs.mkdtempSync(path.join(os.tmpdir(), "designecho-anonymous-review-"));
  const anonymousSourceRoot = path.join(anonymousPacketRoot, "sources");
  const anonymousSealedRoot = path.join(anonymousPacketRoot, "sealed");
  const reviewerPacketDirectory = path.join(anonymousPacketRoot, "reviewer-packet");
  const sealedMappingPath = path.join(anonymousSealedRoot, "mapping.json");
  fs.mkdirSync(anonymousSourceRoot, { recursive: true });
  fs.mkdirSync(anonymousSealedRoot, { recursive: true });
  const candidateSourcePath = path.join(anonymousSourceRoot, "candidate-final.jpg");
  await sharp({
    create: { width: 48, height: 48, channels: 3, background: { r: 210, g: 120, b: 130 } }
  }).withMetadata({ exif: { IFD0: { Artist: "candidate-origin-secret" } } })
    .jpeg({ quality: 92 })
    .toFile(candidateSourcePath);
  const candidateDigest = `sha256:${crypto.createHash("sha256")
    .update(fs.readFileSync(candidateSourcePath)).digest("hex")}`;
  const secondCandidateSourcePath = path.join(anonymousSourceRoot, "candidate-final-second.jpg");
  await sharp({
    create: { width: 48, height: 48, channels: 3, background: { r: 80, g: 150, b: 220 } }
  }).jpeg({ quality: 92 }).toFile(secondCandidateSourcePath);
  const secondCandidateDigest = `sha256:${crypto.createHash("sha256")
    .update(fs.readFileSync(secondCandidateSourcePath)).digest("hex")}`;
  const packetCaseSpec = JSON.parse(JSON.stringify(caseSpec));
  const anchorSourceByBaseRef = new Map();
  for (let index = 0; index < packetCaseSpec.task.reviewOnlyReferences.length; index += 1) {
    const reference = packetCaseSpec.task.reviewOnlyReferences[index];
    const sourcePath = path.join(anonymousSourceRoot, `anchor-${String(index).padStart(2, "0")}.jpg`);
    await sharp({
      create: {
        width: 48,
        height: 48,
        channels: 3,
        background: { r: 30 + index * 20, g: 200 - index * 10, b: 60 + index * 15 }
      }
    }).jpeg({ quality: 90 }).toFile(sourcePath);
    reference.digest = `sha256:${crypto.createHash("sha256")
      .update(fs.readFileSync(sourcePath)).digest("hex")}`;
    anchorSourceByBaseRef.set(reference.ref, sourcePath);
  }
  packetCaseSpec.revision += 1;
  packetCaseSpec.caseDigest = buildCaseDigest(packetCaseSpec);
  const anonymousPacketRun = JSON.parse(JSON.stringify(passing));
  anonymousPacketRun.caseRef.revision = packetCaseSpec.revision;
  anonymousPacketRun.caseRef.caseDigest = packetCaseSpec.caseDigest;
  const packetRasterEvidence = anonymousPacketRun.evidenceRefs.find((item) => item.kind === "raster_export");
  packetRasterEvidence.digest = candidateDigest;
  anonymousPacketRun.evidenceRefs.push({
    kind: "raster_export",
    ref: "output/main-alt.jpg",
    digest: secondCandidateDigest,
    verified: true
  });
  anonymousPacketRun.finalArtifactManifest = finalArtifactManifest(anonymousPacketRun.evidenceRefs);
  const packetComparisonRefs = buildComparisonRefsForTest(packetCaseSpec, anonymousPacketRun);
  const sourceBindings = packetComparisonRefs.map((item, index) => {
    if (item.kind === "candidate_final") {
      return {
        evidenceRef: item.ref,
        sourcePath: item.ref.includes("main-alt.jpg") ? secondCandidateSourcePath : candidateSourcePath
      };
    }
    const baseRef = item.ref
      .replace(/^user-design:/, "")
      .replace(/^eagle:item:/, "eagle:item:")
      .replace(/@sha256:[a-f0-9]{64}$/i, "");
    return { evidenceRef: item.ref, sourcePath: anchorSourceByBaseRef.get(baseRef) };
  });
  const fakeImagePath = path.join(anonymousSourceRoot, "not-an-image.jpg");
  fs.writeFileSync(fakeImagePath, "not an image", "utf8");
  const fakeImageBindings = JSON.parse(JSON.stringify(sourceBindings));
  fakeImageBindings.find((item) => item.evidenceRef.startsWith("user-design:")).sourcePath = fakeImagePath;
  await assert.rejects(
    () => createDesignReliabilityReviewPacket({
      caseSpec: packetCaseSpec,
      run: anonymousPacketRun,
      rubric,
      sourceBindings: fakeImageBindings,
      reviewerPacketDirectory: path.join(anonymousPacketRoot, "fake-image-packet"),
      sealedMappingPath: path.join(anonymousSealedRoot, "fake-image-mapping.json")
    }),
    /可解码的真实图片/,
    "仅有图片扩展名的文本文件不能进入匿名评审包"
  );
  const duplicateReferenceCase = JSON.parse(JSON.stringify(packetCaseSpec));
  duplicateReferenceCase.task.reviewOnlyReferences[1].digest =
    duplicateReferenceCase.task.reviewOnlyReferences[0].digest;
  duplicateReferenceCase.caseDigest = buildCaseDigest(duplicateReferenceCase);
  assert.strictEqual(validateDesignReliabilityCase(duplicateReferenceCase).ok, false,
    "Case 必须拒绝两个参考冻结相同内容摘要");
  const unfrozenReferenceCase = JSON.parse(JSON.stringify(packetCaseSpec));
  delete unfrozenReferenceCase.task.reviewOnlyReferences[0].digest;
  unfrozenReferenceCase.caseDigest = buildCaseDigest(unfrozenReferenceCase);
  assert.strictEqual(validateDesignReliabilityCase(unfrozenReferenceCase).ok, false,
    "Case 中任何用户设计或 Eagle 参考缺少冻结摘要时都必须拒绝");
  const candidateAsAnchorCase = JSON.parse(JSON.stringify(packetCaseSpec));
  candidateAsAnchorCase.task.reviewOnlyReferences[0].digest = candidateDigest;
  candidateAsAnchorCase.caseDigest = buildCaseDigest(candidateAsAnchorCase);
  const candidateAsAnchorRun = JSON.parse(JSON.stringify(anonymousPacketRun));
  candidateAsAnchorRun.caseRef.caseDigest = candidateAsAnchorCase.caseDigest;
  const candidateAsAnchorRefs = buildComparisonRefsForTest(candidateAsAnchorCase, candidateAsAnchorRun);
  const candidateAsAnchorBindings = candidateAsAnchorRefs.map((item) => {
    if (item.kind === "candidate_final" || item.ref.includes(candidateDigest)) {
      return {
        evidenceRef: item.ref,
        sourcePath: item.ref.includes("main-alt.jpg") ? secondCandidateSourcePath : candidateSourcePath
      };
    }
    const baseRef = item.ref
      .replace(/^user-design:/, "")
      .replace(/@sha256:[a-f0-9]{64}$/i, "");
    return { evidenceRef: item.ref, sourcePath: anchorSourceByBaseRef.get(baseRef) };
  });
  await assert.rejects(
    () => createDesignReliabilityReviewPacket({
      caseSpec: candidateAsAnchorCase,
      run: candidateAsAnchorRun,
      rubric,
      sourceBindings: candidateAsAnchorBindings,
      reviewerPacketDirectory: path.join(anonymousPacketRoot, "candidate-anchor-packet"),
      sealedMappingPath: path.join(anonymousSealedRoot, "candidate-anchor-mapping.json")
    }),
    /相同内容摘要|参考锚点不能绑定候选/,
    "参考锚点不能复用候选成稿内容"
  );
  const packetCreation = await createDesignReliabilityReviewPacket({
    caseSpec: packetCaseSpec,
    run: anonymousPacketRun,
    rubric,
    sourceBindings,
    reviewerPacketDirectory,
    sealedMappingPath,
    packetId: "review-packet-contract-test",
    createdAt: "2026-08-24T01:30:00.000Z",
    randomBytes(size) {
      return Buffer.alloc(size, 0x5a);
    }
  });
  assert.strictEqual(fs.existsSync(path.join(reviewerPacketDirectory, "packet.json")), true);
  assert.strictEqual(fs.existsSync(sealedMappingPath), true);
  assert.strictEqual(fs.existsSync(path.join(reviewerPacketDirectory, "mapping.json")), false,
    "sealed mapping 不能混入发给评审者的目录");
  assert.strictEqual(
    packetCreation.packet.anonymousGroups.every((group) => (
      group.assets.length === 1
      && Object.keys(group.assets[0]).sort().join(",") === "assetId,ref"
    )),
    true,
    "公开包必须把候选与锚点统一拆成单文件匿名项，且不能暴露源文件 digest / size"
  );
  assert.strictEqual(packetCreation.packet.anonymousGroups.length, packetComparisonRefs.length,
    "多候选输出不能通过匿名组基数暴露其来源集合");
  for (const group of packetCreation.packet.anonymousGroups) {
    const publicAssetRef = group.assets[0].ref;
    assert.strictEqual(path.extname(publicAssetRef), ".png", "公开匿名资产必须统一为 PNG");
    const publicAssetPath = path.join(reviewerPacketDirectory, ...publicAssetRef.split("/"));
    const publicMetadata = await sharp(publicAssetPath).metadata();
    assert.strictEqual(publicMetadata.format, "png");
    assert.strictEqual(publicMetadata.space, "srgb");
    assert.strictEqual(Boolean(publicMetadata.exif || publicMetadata.xmp || publicMetadata.iptc), false,
      "公开匿名资产不能保留源 EXIF / XMP / IPTC");
    assert.strictEqual(fs.readFileSync(publicAssetPath).includes(Buffer.from("candidate-origin-secret")), false,
      "公开匿名资产不能保留源作者或来源标记");
  }
  const publicPacketText = fs.readFileSync(path.join(reviewerPacketDirectory, "packet.json"), "utf8");
  for (const privateValue of [
    anonymousSourceRoot,
    anonymousPacketRun.runObservationId,
    caseSpec.caseId,
    "candidate:",
    "user-design:",
    "eagle:item:"
  ]) {
    assert.strictEqual(publicPacketText.includes(privateValue), false,
      `公开匿名包不能泄漏来源或运行身份：${privateValue}`);
  }
  assert.strictEqual(publicPacketText.includes(candidateDigest), false,
    "公开匿名包不能暴露可用于已知文件反查的源资产摘要");
  assert.strictEqual(publicPacketText.includes(secondCandidateDigest), false);
  await assert.rejects(
    () => createDesignReliabilityReviewPacket({
      caseSpec: packetCaseSpec,
      run: anonymousPacketRun,
      rubric,
      sourceBindings,
      reviewerPacketDirectory,
      sealedMappingPath,
      packetId: "review-packet-contract-test-duplicate"
    }),
    /fail-if-exists|已存在/,
    "匿名包目标存在时必须拒绝覆盖"
  );
  const packetLabels = packetCreation.packet.anonymousGroups.map((group) => group.label).sort();
  const responseAssessments = packetLabels.map((label) => ({
    label,
    decision: "pass",
    scores: passingScores,
    findings: [],
    blockers: [],
    confidence: "high",
    missingEvidence: []
  }));
  const pairwiseComparisons = [];
  for (let left = 0; left < packetLabels.length; left += 1) {
    for (let right = left + 1; right < packetLabels.length; right += 1) {
      pairwiseComparisons.push({
        leftLabel: packetLabels[left],
        rightLabel: packetLabels[right],
        outcome: "comparable",
        rationale: "两组商业完成度相当。"
      });
    }
  }
  const reviewerResponse = {
    version: REVIEWER_RESPONSE_VERSION,
    packetId: packetCreation.packet.packetId,
    packetDigest: packetCreation.packet.packetDigest,
    rubricId: rubric.rubricId,
    rubricDigest: buildRubricDigest(rubric),
    reviewerId: "designer-anonymous-a",
    reviewedAt: "2026-08-24T02:00:00.000Z",
    assessments: responseAssessments,
    pairwiseComparisons
  };
  const verifiedAnonymous = await verifyDesignReliabilityReviewerResponse({
    caseSpec: packetCaseSpec,
    run: anonymousPacketRun,
    rubric,
    reviewerPacketDirectory,
    sealedMappingPath,
    reviewerResponse,
    verifiedAt: "2026-08-24T02:00:01.000Z"
  });
  assert.strictEqual(
    validateDesignReliabilityReview(verifiedAnonymous.review, {
      rubric,
      caseSpec: packetCaseSpec,
      run: anonymousPacketRun,
      enforceBlindProtocol: true
    }).ok,
    true,
    "只有文件、映射、随机标签、完整响应和 Review 投影全部复核后才接受匿名协议"
  );
  const packetSuite = { cases: [packetCaseSpec], rubrics: [rubric] };
  const cliPacketDirectory = path.join(anonymousPacketRoot, "reviewer-packet-cli");
  const cliBundleRoot = path.join(anonymousPacketRoot, "review-verification-bundles");
  const sourceBindingsPath = path.join(anonymousSourceRoot, "bindings.json");
  const runObservationPath = path.join(anonymousSourceRoot, "run-observation.json");
  fs.writeFileSync(sourceBindingsPath, `${JSON.stringify(sourceBindings, null, 2)}\n`, "utf8");
  fs.writeFileSync(runObservationPath, `${JSON.stringify(anonymousPacketRun, null, 2)}\n`, "utf8");
  const preparePacketArgs = parseArgs([
    "node",
    "design-reliability.cjs",
    "prepare-review-packet",
    "--case",
    packetCaseSpec.caseId,
    "--run-observation",
    runObservationPath,
    "--reviewer-packet-dir",
    cliPacketDirectory,
    "--source-bindings-json",
    sourceBindingsPath,
    "--allow-create"
  ]);
  assert.strictEqual(parseReviewPacketSourceBindings(preparePacketArgs).length, sourceBindings.length);
  const cliPacketResult = await prepareAnonymousReviewPacket(packetSuite, preparePacketArgs, cliBundleRoot);
  assert.strictEqual(cliPacketResult.success, true);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(cliPacketResult, "sealedMapping"), false,
    "prepare-review-packet CLI 不能把密封来源映射打印到 stdout");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(cliPacketResult, "sealedMappingPath"), false,
    "prepare-review-packet CLI 不能泄漏密封映射路径");
  const cliPrivateBundleDirectory = path.join(cliBundleRoot, cliPacketResult.packetId);
  const preparationText = fs.readFileSync(
    path.join(cliPrivateBundleDirectory, "preparation.json"),
    "utf8"
  );
  assert.strictEqual(preparationText.includes(cliPacketDirectory), false,
    "私有 preparation 也不应持久化外部公开包绝对路径");
  if (process.platform !== "win32") {
    assert.strictEqual(fs.statSync(cliBundleRoot).mode & 0o077, 0);
    assert.strictEqual(fs.statSync(cliPrivateBundleDirectory).mode & 0o077, 0);
    assert.strictEqual(
      fs.statSync(path.join(cliPrivateBundleDirectory, "sealed-mapping.json")).mode & 0o077,
      0
    );
  }
  const cliPacket = JSON.parse(fs.readFileSync(path.join(cliPacketDirectory, "packet.json"), "utf8"));
  const cliLabels = cliPacket.anonymousGroups.map((group) => group.label).sort();
  const cliPairwiseComparisons = [];
  for (let left = 0; left < cliLabels.length; left += 1) {
    for (let right = left + 1; right < cliLabels.length; right += 1) {
      cliPairwiseComparisons.push({
        leftLabel: cliLabels[left],
        rightLabel: cliLabels[right],
        outcome: "comparable",
        rationale: "两组商业完成度相当。"
      });
    }
  }
  const cliResponsePath = path.join(anonymousSourceRoot, "reviewer-response.json");
  fs.writeFileSync(cliResponsePath, `${JSON.stringify({
    version: REVIEWER_RESPONSE_VERSION,
    packetId: cliPacket.packetId,
    packetDigest: cliPacket.packetDigest,
    rubricId: rubric.rubricId,
    rubricDigest: buildRubricDigest(rubric),
    reviewerId: "designer-cli-a",
    reviewedAt: "2026-08-24T02:30:00.000Z",
    assessments: cliLabels.map((label) => ({
      label,
      decision: "pass",
      scores: passingScores,
      findings: [],
      blockers: [],
      confidence: "high",
      missingEvidence: []
    })),
    pairwiseComparisons: cliPairwiseComparisons
  }, null, 2)}\n`, "utf8");
  const recordPacketArgs = parseArgs([
    "node",
    "design-reliability.cjs",
    "record-anonymous-review",
    "--case",
    packetCaseSpec.caseId,
    "--run-observation",
    runObservationPath,
    "--packet-id",
    cliPacketResult.packetId,
    "--reviewer-packet-dir",
    cliPacketDirectory,
    "--reviewer-response",
    cliResponsePath
  ]);
  const recordedAnonymous = await recordAnonymousReview(
    packetSuite,
    recordPacketArgs,
    path.join(anonymousPacketRoot, "recorded"),
    cliBundleRoot
  );
  assert.strictEqual(recordedAnonymous.evidenceProtocol, "anonymous_packet_verified");
  assert.strictEqual(fs.existsSync(recordedAnonymous.outputPath), true,
    "record-anonymous-review CLI 必须把已验证 Review 追加到指定可靠性数据根");
  const persistedAnonymousReview = JSON.parse(fs.readFileSync(recordedAnonymous.outputPath, "utf8"));
  const diskVerifiedSidecars = await revalidateOfficialReviewBundles({
    runs: [anonymousPacketRun],
    reviews: [persistedAnonymousReview],
    attributions: [],
    attemptEvents: [],
    invalid: [],
    excludedEvidence: []
  }, packetSuite, cliBundleRoot);
  assert.strictEqual(diskVerifiedSidecars.excludedEvidence.length, 0);
  assert.strictEqual(
    collectSidecars([cliBundleRoot]).runs.length
      + collectSidecars([cliBundleRoot]).reviews.length
      + collectSidecars([cliBundleRoot]).invalid.length,
    0,
    "通用 sidecar 扫描必须跳过 canonical 私有 bundle，避免 mapping/preparation 被误报 invalid"
  );
  const anonymousReport = buildDesignReliabilityCohortReport({
    suiteId: packetCaseSpec.suiteId,
    cohortId: "candidate",
    cases: [packetCaseSpec],
    rubrics: [rubric],
    runs: [anonymousPacketRun],
    reviews: [verifiedAnonymous.review],
    attributions: []
  });
  assert.strictEqual(anonymousReport.overall.quality.strictHumanReviewedRate.numerator, 0,
    "仅有可序列化 proof、未从 canonical bundle 磁盘重验的 Review 不能进入 strict");
  assert.strictEqual(anonymousReport.overall.quality.humanPassRate.numerator, 0);
  const officialAnonymousReport = buildDesignReliabilityCohortReport({
    suiteId: packetCaseSpec.suiteId,
    cohortId: "candidate",
    cases: [packetCaseSpec],
    rubrics: [rubric],
    runs: [anonymousPacketRun],
    reviews: [diskVerifiedSidecars.reviews[0]],
    attributions: []
  });
  assert.strictEqual(officialAnonymousReport.overall.quality.strictHumanReviewedRate.numerator, 1,
    "只有 canonical bundle 磁盘验证后附加进程内信任标记的 Review 才能进入 strict");
  const forgedAnonymousReview = JSON.parse(JSON.stringify(verifiedAnonymous.review));
  forgedAnonymousReview.reviewId = "review-forged-without-bundle";
  forgedAnonymousReview.verifiedPacketProof.packetId = "review-packet-forged-without-disk";
  for (const field of [
    "packetDigest",
    "sealedMappingDigest",
    "reviewerResponseDigest",
    "assetSetDigest",
    "sourceBindingDigest"
  ]) {
    forgedAnonymousReview.verifiedPacketProof[field] = `sha256:${"f".repeat(64)}`;
  }
  forgedAnonymousReview.verifiedPacketProof.comparisonEvidenceDigest = buildComparisonEvidenceDigest(
    forgedAnonymousReview.comparisonEvidenceRefs
  );
  forgedAnonymousReview.verifiedPacketProof.reviewProjectionDigest = buildReviewPacketProjectionDigest(
    forgedAnonymousReview
  );
  assert.strictEqual(validateDesignReliabilityReview(forgedAnonymousReview, {
    rubric,
    caseSpec: packetCaseSpec,
    run: anonymousPacketRun,
    enforceBlindProtocol: true
  }).ok, true, "可序列化 proof 仍可作为诊断格式读取，但不能拥有 official strict 信任");
  const forgedCustomRoot = path.join(anonymousPacketRoot, "custom-report-root");
  fs.mkdirSync(path.join(forgedCustomRoot, "reviews"), { recursive: true });
  fs.writeFileSync(
    path.join(forgedCustomRoot, "reviews", "forged.json"),
    `${JSON.stringify(forgedAnonymousReview, null, 2)}\n`,
    "utf8"
  );
  fs.mkdirSync(path.join(forgedCustomRoot, "runs"), { recursive: true });
  fs.writeFileSync(
    path.join(forgedCustomRoot, "runs", "run.json"),
    `${JSON.stringify(anonymousPacketRun, null, 2)}\n`,
    "utf8"
  );
  const forgedCollected = collectSidecars([forgedCustomRoot]);
  const forgedContextual = retainContextuallyValidReviews(forgedCollected, packetSuite);
  const forgedRevalidated = await revalidateOfficialReviewBundles(
    forgedContextual,
    packetSuite,
    cliBundleRoot
  );
  const forgedReport = buildDesignReliabilityCohortReport({
    suiteId: packetCaseSpec.suiteId,
    cohortId: "candidate",
    cases: [packetCaseSpec],
    rubrics: [rubric],
    runs: [anonymousPacketRun],
    reviews: forgedRevalidated.reviews,
    attributions: []
  });
  assert.strictEqual(forgedReport.overall.quality.strictHumanReviewedRate.numerator, 0,
    "--data-root 中从零伪造的 proof 不能进入 official strict");
  assert(forgedRevalidated.excludedEvidence.some((item) => (
    item.id === forgedAnonymousReview.reviewId
    && item.reason === "official_review_bundle_unverified"
  )));
  const officialBundleDirectory = path.join(cliBundleRoot, cliPacketResult.packetId);
  const officialBundleManifestPath = path.join(officialBundleDirectory, "bundle.json");
  const hiddenBundleManifestPath = path.join(officialBundleDirectory, "bundle.json.missing-test");
  fs.renameSync(officialBundleManifestPath, hiddenBundleManifestPath);
  const missingBundleRevalidation = await revalidateOfficialReviewBundles({
    runs: [anonymousPacketRun],
    reviews: [persistedAnonymousReview],
    attributions: [],
    attemptEvents: [],
    invalid: [],
    excludedEvidence: []
  }, packetSuite, cliBundleRoot);
  assert.strictEqual(buildDesignReliabilityCohortReport({
    suiteId: packetCaseSpec.suiteId,
    cohortId: "candidate",
    cases: [packetCaseSpec],
    rubrics: [rubric],
    runs: [anonymousPacketRun],
    reviews: missingBundleRevalidation.reviews,
    attributions: []
  }).overall.quality.strictHumanReviewedRate.numerator, 0,
  "canonical bundle manifest 缺失时不能沿用旧的进程内 strict 信任");
  fs.renameSync(hiddenBundleManifestPath, officialBundleManifestPath);
  const archivedPacket = JSON.parse(fs.readFileSync(
    path.join(officialBundleDirectory, "reviewer-packet", "packet.json"),
    "utf8"
  ));
  const archivedAssetPath = path.join(
    officialBundleDirectory,
    "reviewer-packet",
    ...archivedPacket.anonymousGroups[0].assets[0].ref.split("/")
  );
  const archivedAssetBytes = fs.readFileSync(archivedAssetPath);
  fs.appendFileSync(archivedAssetPath, "bundle-tamper");
  const tamperedBundleRevalidation = await revalidateOfficialReviewBundles({
    runs: [anonymousPacketRun],
    reviews: [persistedAnonymousReview],
    attributions: [],
    attemptEvents: [],
    invalid: [],
    excludedEvidence: []
  }, packetSuite, cliBundleRoot);
  assert.strictEqual(buildDesignReliabilityCohortReport({
    suiteId: packetCaseSpec.suiteId,
    cohortId: "candidate",
    cases: [packetCaseSpec],
    rubrics: [rubric],
    runs: [anonymousPacketRun],
    reviews: tamperedBundleRevalidation.reviews,
    attributions: []
  }).overall.quality.strictHumanReviewedRate.numerator, 0,
  "canonical bundle 资产被篡改时必须撤销 strict 信任");
  fs.writeFileSync(archivedAssetPath, archivedAssetBytes);
  const changedAfterProof = JSON.parse(JSON.stringify(verifiedAnonymous.review));
  changedAfterProof.decision = "needs_fix";
  changedAfterProof.pairwiseOutcome = "weaker";
  assert.strictEqual(
    validateDesignReliabilityReview(changedAfterProof, {
      rubric,
      caseSpec: packetCaseSpec,
      run: anonymousPacketRun,
      enforceBlindProtocol: true
    }).ok,
    false,
    "verifiedPacketProof 不能复用到被修改过的 Review"
  );
  const incompleteBlindResponse = JSON.parse(JSON.stringify(reviewerResponse));
  incompleteBlindResponse.assessments.pop();
  await assert.rejects(
    () => verifyDesignReliabilityReviewerResponse({
      caseSpec: packetCaseSpec,
      run: anonymousPacketRun,
      rubric,
      reviewerPacketDirectory,
      sealedMappingPath,
      reviewerResponse: incompleteBlindResponse
    }),
    /每个匿名组恰好评审一次/,
    "评审者不能只对事后猜中的候选标签给分"
  );
  const originalSealedMappingText = fs.readFileSync(sealedMappingPath, "utf8");
  const tamperedSealedMapping = JSON.parse(originalSealedMappingText);
  tamperedSealedMapping.groups[0].assets[0].digest = `sha256:${"0".repeat(64)}`;
  fs.writeFileSync(sealedMappingPath, JSON.stringify(tamperedSealedMapping, null, 2), "utf8");
  await assert.rejects(
    () => verifyDesignReliabilityReviewerResponse({
      caseSpec: packetCaseSpec,
      run: anonymousPacketRun,
      rubric,
      reviewerPacketDirectory,
      sealedMappingPath,
      reviewerResponse
    }),
    /sealed mapping 摘要校验失败/,
    "密封来源映射被修改后不能继续签发 proof"
  );
  fs.writeFileSync(sealedMappingPath, originalSealedMappingText, "utf8");
  const unexpectedPublicFile = path.join(reviewerPacketDirectory, "origin.txt");
  fs.writeFileSync(unexpectedPublicFile, "candidate", "utf8");
  await assert.rejects(
    () => verifyDesignReliabilityReviewerResponse({
      caseSpec: packetCaseSpec,
      run: anonymousPacketRun,
      rubric,
      reviewerPacketDirectory,
      sealedMappingPath,
      reviewerResponse
    }),
    /未声明文件/,
    "公开匿名包不能夹带未声明的来源提示文件"
  );
  fs.rmSync(unexpectedPublicFile);
  const firstAnonymousAsset = packetCreation.packet.anonymousGroups[0].assets[0].ref;
  fs.appendFileSync(path.join(reviewerPacketDirectory, ...firstAnonymousAsset.split("/")), "tampered");
  await assert.rejects(
    () => verifyDesignReliabilityReviewerResponse({
      caseSpec: packetCaseSpec,
      run: anonymousPacketRun,
      rubric,
      reviewerPacketDirectory,
      sealedMappingPath,
      reviewerResponse
    }),
    /哈希或字节数校验失败/,
    "匿名包中的任何资产被替换后都不能继续签发可信 proof"
  );
  fs.rmSync(anonymousPacketRoot, { recursive: true, force: true });

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
    photoshopRuntimeBuildId: safePhotoshopRuntimeBinding.live.buildId,
    photoshopRuntimeBinding: safePhotoshopRuntimeBinding,
    photoshopRuntimeBindingDigest: sha256Text(stableStringify(safePhotoshopRuntimeBinding))
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
    numerator: 0,
    denominator: 2,
    value: 0
  }, "bound_self_reported 只能提供诊断分数，不能冒充正式商业可用样本");
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
  const invalidAnchorRubric = JSON.parse(JSON.stringify(readRubric()));
  invalidAnchorRubric.scoreAnchorValues.strong = 0.8;
  assert.strictEqual(validateRubric(invalidAnchorRubric).ok, false,
    "Rubric 的数值锚点必须全套固定，不能只靠四段描述自行漂移");
  assert(fullSuite.cases.every((suiteCase) => {
    const rubric = fullSuite.rubrics.find((item) => item.rubricId === suiteCase.oracle?.rubricId);
    return rubric && rubric.taskFamily === suiteCase.taskFamily;
  }), "Suite 中 Case 与其 Rubric 的 taskFamily 必须逐项一致");
  const unionFixtureTempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'designecho-union-fixture-'));
  const unionFixtureSource = path.join(unionFixtureTempRoot, 'source');
  const unionFixtureDestination = path.join(unionFixtureTempRoot, 'destination');
  fs.mkdirSync(unionFixtureSource, { recursive: true });
  try {
    assert.throws(
      () => prepareFixture(fullSuite, parseArgs([
        'node',
        'design-reliability.cjs',
        'prepare-fixture',
        '--fixture-id',
        'neveralone-c1163-input-v1',
        '--source-root',
        unionFixtureSource,
        '--destination',
        unionFixtureDestination,
        '--allow-create'
      ])),
      /正式 live fixture 必须使用 --case 单独准备/,
      '多个 Case 共用 fixtureId 时不得创建随后无法用于单 Case live 的联合目录'
    );
    assert.strictEqual(
      fs.existsSync(unionFixtureDestination),
      false,
      'prepare-fixture 在验证 source 与 Case 唯一性之前不得留下部分目标目录'
    );
  } finally {
    fs.rmSync(unionFixtureTempRoot, { recursive: true, force: true });
  }
  const junctionFixtureTempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "designecho-junction-fixture-"));
  const junctionFixtureSource = path.join(junctionFixtureTempRoot, "source");
  const junctionFixtureTarget = path.join(junctionFixtureSource, "junction-target");
  const junctionFixtureDestination = path.join(junctionFixtureTempRoot, "destination-link");
  fs.mkdirSync(junctionFixtureTarget, { recursive: true });
  try {
    fs.symlinkSync(
      junctionFixtureTarget,
      junctionFixtureDestination,
      process.platform === "win32" ? "junction" : "dir"
    );
    assert.throws(
      () => prepareFixture(fullSuite, parseArgs([
        "node",
        "design-reliability.cjs",
        "prepare-fixture",
        "--case",
        caseSpec.caseId,
        "--source-root",
        junctionFixtureSource,
        "--destination",
        junctionFixtureDestination,
        "--allow-create"
      ])),
      /真实路径不能位于源项目内部|junction \/ symlink/,
      "destination 通过 junction / symlink 回指源项目时必须在复制前拒绝"
    );
    assert.strictEqual(fs.readdirSync(junctionFixtureTarget).length, 0,
      "被拒绝的 junction fixture 不得向源项目写入任何文件");
  } finally {
    fs.rmSync(junctionFixtureTempRoot, { recursive: true, force: true });
  }
  const unsafeInventoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "designecho-unsafe-inventory-"));
  const unsafeInventoryTarget = fs.mkdtempSync(path.join(os.tmpdir(), "designecho-unsafe-target-"));
  try {
    fs.symlinkSync(
      unsafeInventoryTarget,
      path.join(unsafeInventoryRoot, ".hidden-input"),
      process.platform === "win32" ? "junction" : "dir"
    );
    const unsafeInspection = inspectFixture([caseSpec], unsafeInventoryRoot);
    assert.deepStrictEqual(unsafeInspection.unsafeLinks, [".hidden-input"]);
    assert.strictEqual(unsafeInspection.ready, false);
    assert.strictEqual(unsafeInspection.freshRunReady, false,
      "fixture 内隐藏 junction / symlink 必须显式阻止 fresh run");
  } finally {
    fs.rmSync(unsafeInventoryRoot, { recursive: true, force: true });
    fs.rmSync(unsafeInventoryTarget, { recursive: true, force: true });
  }
  const currentCase = fullSuite.cases.find((item) => item.caseId === caseSpec.caseId);
  const generatedFixtureTempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "designecho-generated-fixture-"));
  const generatedFixtureSource = path.join(generatedFixtureTempRoot, "source");
  const generatedFixtureDestination = path.join(generatedFixtureTempRoot, "destination");
  const generatedFixtureReports = path.join(generatedFixtureTempRoot, "reports");
  fs.mkdirSync(generatedFixtureSource, { recursive: true });
  for (const input of currentCase.task.agentVisibleInputs) {
    const sourcePath = path.join(generatedFixtureSource, ...input.ref.replace(/\\/g, "/").split("/"));
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, `fixture:${input.ref}`, "utf8");
  }
  try {
    const preparedGeneratedFixture = prepareFixture(
      { manifest: fullSuite.manifest, cases: [currentCase] },
      parseArgs([
        "node",
        "design-reliability.cjs",
        "prepare-fixture",
        "--case",
        currentCase.caseId,
        "--source-root",
        generatedFixtureSource,
        "--destination",
        generatedFixtureDestination,
        "--allow-create"
      ]),
      generatedFixtureReports
    );
    const generatedInput = currentCase.task.fixtureGeneratedInputs[0];
    const generatedBrief = path.join(
      generatedFixtureDestination,
      ...generatedInput.ref.replace(/\\/g, "/").split("/")
    );
    assert.strictEqual(fs.existsSync(generatedBrief), true,
      "prepare-fixture 必须把 Case 中冻结的事实 brief 写入 Agent 可见测试目录");
    const generatedFacts = JSON.parse(fs.readFileSync(generatedBrief, "utf8"));
    assert.strictEqual(generatedFacts.boundaries.factsOnly, true);
    assert(Array.isArray(generatedFacts.facts.product_claims));
    assert(generatedFacts.facts.product_claims.every((claim) => claim.provenance?.kind));
    assert.strictEqual(
      fs.existsSync(path.join(
        generatedFixtureSource,
        ...generatedInput.ref.replace(/\\/g, "/").split("/")
      )),
      false,
      "测试事实输入不能反写用户源项目"
    );
    assert.strictEqual(
      preparedGeneratedFixture.report.copiedFileCount,
      currentCase.task.agentVisibleInputs.length + currentCase.task.fixtureGeneratedInputs.length
    );
    assert.deepStrictEqual(preparedGeneratedFixture.report.caseRefs, [{
      caseId: currentCase.caseId,
      revision: currentCase.revision,
      caseDigest: currentCase.caseDigest
    }], "fixture receipt 必须绑定 Case revision 与 digest，不能只存 caseId");
    const preparedInspection = inspectFixture([currentCase], generatedFixtureDestination);
    assert(readFixtureInstance(
      generatedFixtureDestination,
      [currentCase],
      preparedInspection,
      generatedFixtureReports
    ), "同一 Case revision/digest 应能读回 fixture receipt");
    const revisedCase = { ...currentCase, revision: currentCase.revision + 1 };
    assert.strictEqual(readFixtureInstance(
      generatedFixtureDestination,
      [revisedCase],
      preparedInspection,
      generatedFixtureReports
    ), undefined, "Case revision 变化后旧 fixture receipt 必须失效");
  } finally {
    fs.rmSync(generatedFixtureTempRoot, { recursive: true, force: true });
  }
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
  const persistentDataRoot = roots[0];
  const legacyDataRoot = path.join(ROOT, "tmp", "design-reliability");
  const relativeToRepoTmp = path.relative(path.join(ROOT, "tmp"), persistentDataRoot);
  assert(relativeToRepoTmp.startsWith("..") || path.isAbsolute(relativeToRepoTmp),
    "canonical Attempt 安全账本必须位于仓库 tmp 之外，不能被 repo hygiene 清空");
  assert(roots.includes(legacyDataRoot), "旧 tmp 报告应保持只读兼容来源");
  assert(roots.includes(customDataRoot), "自定义 data-root 仍可作为附加报告来源");
  const evidenceRoots = resolveReliabilityEvidenceRoots({ getAll: () => [customDataRoot] });
  assert(evidenceRoots.reportRoots.includes(customDataRoot));
  assert.strictEqual(evidenceRoots.canonicalAttemptRoots.length, 1);
  assert(evidenceRoots.canonicalAttemptRoots[0].startsWith(persistentDataRoot),
    "正式 Attempt 分母必须绑定仓库外持久根目录");
  assert(!evidenceRoots.canonicalAttemptRoots.includes(customDataRoot),
    "自定义 report root 的 terminal/reconciled Event 不能进入 canonical 写入安全账本");
  assert.strictEqual(
    shouldPersistPreflightReport(parseArgs(["node", "design-reliability.cjs", "preflight"])),
    false,
    "preflight 默认必须零落盘"
  );
  assert.strictEqual(
    shouldPersistPreflightReport(parseArgs([
      "node",
      "design-reliability.cjs",
      "preflight",
      "--write-report"
    ])),
    true,
    "只有显式 --write-report 才允许保存 preflight 报告"
  );
  const preflightReportRoot = fs.mkdtempSync(path.join(os.tmpdir(), "designecho-preflight-report-"));
  try {
    const samplePreflight = {
      success: true,
      generatedAt: "2026-08-27T12:34:56.000Z",
      mode: "read_only_design_reliability_preflight"
    };
    const firstPreflightPath = writePreflightReport(samplePreflight, preflightReportRoot);
    const secondPreflightPath = writePreflightReport(samplePreflight, preflightReportRoot);
    assert.notStrictEqual(firstPreflightPath, secondPreflightPath,
      "显式保存的 preflight 报告必须追加新文件，不能覆盖 latest.json");
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(firstPreflightPath, "utf8")), samplePreflight);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(secondPreflightPath, "utf8")), samplePreflight);
  } finally {
    fs.rmSync(preflightReportRoot, { recursive: true, force: true });
  }
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
    const canonicalStatus = await buildStatus(fullSuite, emptyStatusArgs);
    assert.strictEqual(canonicalStatus.storage.repositoryCleanupSafe, true);
    assert.strictEqual(canonicalStatus.storage.canonicalDataRoot, persistentDataRoot);
    const canonicalAttemptCount = canonicalStatus.evidence.attemptCoverage.totalAttempts;
    const injectedAttemptCount = (await buildStatus(fullSuite, injectedStatusArgs))
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
    rubricDigest: buildRubricDigest(skuRubric),
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

  const skuMultiOutputRun = JSON.parse(JSON.stringify(skuRun));
  skuMultiOutputRun.evidenceRefs = [
    ...skuMultiOutputRun.evidenceRefs.filter((item) => (
      item.kind !== "raster_export" && item.kind !== "editable_psd"
    )),
    ...skuCase.oracle.outputInventory.expectedRasterRefs.map((ref, index) => ({
      kind: "raster_export",
      ref,
      digest: `sha256:${(index + 1).toString(16).padStart(64, "0")}`,
      size: 1000 + index,
      verified: true
    })),
    ...skuCase.oracle.outputInventory.expectedEditableRefs.map((ref, index) => ({
      kind: "editable_psd",
      ref,
      digest: `sha256:${(index + 101).toString(16).padStart(64, "0")}`,
      size: 5000 + index,
      verified: true
    })),
    ...[
      "paired_editable_delivery_receipt",
      "sku_structure_readback_set",
      "sku_visual_readback_set",
      "sku_pair_binding"
    ].map((kind) => ({
      kind,
      ref: `evidence/${kind}.json`,
      verified: true
    }))
  ];
  skuMultiOutputRun.finalArtifactManifest = finalArtifactManifest(skuMultiOutputRun.evidenceRefs);
  const skuMultiComparisonRefs = buildComparisonRefsForTest(skuCase, skuMultiOutputRun);
  const skuPassingScores = Object.fromEntries(
    skuRubric.dimensions.map((dimension) => [dimension.id, 0.85])
  );
  const skuMultiOutputReview = {
    ...JSON.parse(JSON.stringify(review)),
    reviewId: "review-sku-multi-output",
    runObservationId: skuMultiOutputRun.runObservationId,
    rubricId: skuRubric.rubricId,
    rubricDigest: buildRubricDigest(skuRubric),
    evidenceRefs: skuMultiComparisonRefs.map((item) => item.ref),
    comparisonEvidenceKinds: requiredComparisonEvidenceKinds(skuCase),
    comparisonEvidenceRefs: skuMultiComparisonRefs,
    scores: skuPassingScores,
    weightedOverall: calculateWeightedOverall(skuRubric, skuPassingScores)
  };
  assert.strictEqual(
    validateDesignReliabilityReview(skuMultiOutputReview, {
      rubric: skuRubric,
      caseSpec: skuCase,
      run: skuMultiOutputRun,
      enforceBlindProtocol: true
    }).ok,
    true,
    "SKU 的 19 组 JPG/PSB 必须能够作为同一个完整候选集合通过绑定"
  );
  const wrongSkuNamesRun = JSON.parse(JSON.stringify(skuMultiOutputRun));
  const wrongSkuRaster = wrongSkuNamesRun.evidenceRefs.find((item) => item.kind === "raster_export");
  wrongSkuRaster.ref = "SKU/2双装/错误命名.jpg";
  wrongSkuNamesRun.finalArtifactManifest = finalArtifactManifest(wrongSkuNamesRun.evidenceRefs);
  const wrongSkuNameComparisonRefs = buildComparisonRefsForTest(skuCase, wrongSkuNamesRun);
  const wrongSkuNamesReview = {
    ...JSON.parse(JSON.stringify(skuMultiOutputReview)),
    evidenceRefs: wrongSkuNameComparisonRefs.map((item) => item.ref),
    comparisonEvidenceRefs: wrongSkuNameComparisonRefs
  };
  assert.strictEqual(
    validateDesignReliabilityReview(wrongSkuNamesReview, {
      rubric: skuRubric,
      caseSpec: skuCase,
      run: wrongSkuNamesRun,
      enforceBlindProtocol: true
    }).ok,
    false,
    "SKU 即使仍有 19 张也必须逐项匹配冻结的文件名，不能只按数量通过"
  );
  const missingSkuOutputReview = JSON.parse(JSON.stringify(skuMultiOutputReview));
  missingSkuOutputReview.comparisonEvidenceRefs = missingSkuOutputReview.comparisonEvidenceRefs
    .filter((item, index) => item.kind !== "candidate_final" || index !== 0);
  missingSkuOutputReview.comparisonEvidenceKinds = [
    ...new Set(missingSkuOutputReview.comparisonEvidenceRefs.map((item) => item.kind))
  ];
  assert.strictEqual(
    validateDesignReliabilityReview(missingSkuOutputReview, {
      rubric: skuRubric,
      caseSpec: skuCase,
      run: skuMultiOutputRun,
      enforceBlindProtocol: true
    }).ok,
    false,
    "SKU 候选集合漏掉任一最终导出时必须拒绝"
  );
  const extraSkuOutputReview = JSON.parse(JSON.stringify(skuMultiOutputReview));
  const extraSkuRef = `candidate:output/not-in-run.jpg@sha256:${"f".repeat(64)}`;
  extraSkuOutputReview.evidenceRefs.push(extraSkuRef);
  extraSkuOutputReview.comparisonEvidenceRefs.push({
    kind: "candidate_final",
    ref: extraSkuRef
  });
  assert.strictEqual(
    validateDesignReliabilityReview(extraSkuOutputReview, {
      rubric: skuRubric,
      caseSpec: skuCase,
      run: skuMultiOutputRun,
      enforceBlindProtocol: true
    }).ok,
    false,
    "SKU 候选集合夹带 Run 外导出时必须拒绝"
  );

  const detailCase = readDetailCase();
  const detailRubric = readDetailRubric();
  const detailMultiOutputRun = JSON.parse(JSON.stringify(passing));
  detailMultiOutputRun.runObservationId = "detail-review-run";
  detailMultiOutputRun.caseRef = {
    suiteId: detailCase.suiteId,
    caseId: detailCase.caseId,
    revision: detailCase.revision,
    caseDigest: detailCase.caseDigest
  };
  detailMultiOutputRun.evidenceRefs = [
    ...detailMultiOutputRun.evidenceRefs.filter((item) => item.kind !== "raster_export"),
    ...Array.from({ length: 3 }, (_, index) => ({
      kind: "raster_export",
      ref: `output/detail-${index + 1}.jpg`,
      digest: `sha256:${(index + 31).toString(16).padStart(64, "0")}`,
      size: 2000 + index,
      verified: true
    }))
  ];
  detailMultiOutputRun.finalArtifactManifest = finalArtifactManifest(detailMultiOutputRun.evidenceRefs);
  const detailComparisonRefs = buildComparisonRefsForTest(detailCase, detailMultiOutputRun);
  const detailScores = Object.fromEntries(
    detailRubric.dimensions.map((dimension) => [dimension.id, 0.85])
  );
  const detailMultiOutputReview = {
    ...JSON.parse(JSON.stringify(review)),
    reviewId: "review-detail-multi-output",
    runObservationId: detailMultiOutputRun.runObservationId,
    rubricId: detailRubric.rubricId,
    rubricDigest: buildRubricDigest(detailRubric),
    evidenceRefs: detailComparisonRefs.map((item) => item.ref),
    comparisonEvidenceKinds: requiredComparisonEvidenceKinds(detailCase),
    comparisonEvidenceRefs: detailComparisonRefs,
    scores: detailScores,
    weightedOverall: calculateWeightedOverall(detailRubric, detailScores)
  };
  assert.strictEqual(
    validateDesignReliabilityReview(detailMultiOutputReview, {
      rubric: detailRubric,
      caseSpec: detailCase,
      run: detailMultiOutputRun,
      enforceBlindProtocol: true
    }).ok,
    true,
    "详情页多屏最终导出必须作为完整候选集合通过绑定"
  );
  const missingDetailOutputReview = JSON.parse(JSON.stringify(detailMultiOutputReview));
  const detailCandidateIndex = missingDetailOutputReview.comparisonEvidenceRefs
    .findIndex((item) => item.kind === "candidate_final");
  missingDetailOutputReview.comparisonEvidenceRefs.splice(detailCandidateIndex, 1);
  assert.strictEqual(
    validateDesignReliabilityReview(missingDetailOutputReview, {
      rubric: detailRubric,
      caseSpec: detailCase,
      run: detailMultiOutputRun,
      enforceBlindProtocol: true
    }).ok,
    false,
    "详情页多屏漏掉任一最终导出时必须拒绝"
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

  const formattedButFakeEvidencePass = JSON.parse(JSON.stringify(review));
  formattedButFakeEvidencePass.comparisonEvidenceRefs = [
    { kind: 'candidate_final', ref: `candidate:not-real.png@sha256:${'9'.repeat(64)}` },
    { kind: 'user_design_anchor', ref: 'user-design:not-in-case.png' },
    { kind: 'eagle_anchor', ref: 'eagle:item:not-in-case' }
  ];
  formattedButFakeEvidencePass.evidenceRefs = formattedButFakeEvidencePass.comparisonEvidenceRefs
    .map((item) => item.ref);
  assert.strictEqual(
    validateDesignReliabilityReview(formattedButFakeEvidencePass, {
      rubric,
      caseSpec,
      run: passing,
      enforceBlindProtocol: true
    }).ok,
    false,
    '格式正确但不属于当前 Run / Case 的候选、用户成稿和 Eagle 引用不能伪造严格盲评'
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

  const extraAbsoluteEvidencePass = JSON.parse(JSON.stringify(review));
  extraAbsoluteEvidencePass.evidenceRefs.push("C:\\Users\\example\\private-review.png");
  assert.strictEqual(
    validateDesignReliabilityReview(extraAbsoluteEvidencePass, {
      rubric,
      caseSpec,
      run: passing,
      enforceBlindProtocol: true
    }).ok,
    false,
    "comparison refs 合法时也不能在普通 evidenceRefs 中夹带绝对用户路径"
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
  const mismatchedRubricDigest = JSON.parse(JSON.stringify(review));
  mismatchedRubricDigest.rubricDigest = `sha256:${"0".repeat(64)}`;
  assert.strictEqual(
    validateDesignReliabilityReview(mismatchedRubricDigest, {
      rubric,
      caseSpec,
      run: passing,
      enforceBlindProtocol: true
    }).ok,
    false,
    "Review v2 必须绑定当前 Rubric 内容摘要，不能只绑定 rubricId"
  );

  const legacyNeedsFix = {
    version: LEGACY_REVIEW_VERSION,
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
  const reviewRoundTripRoot = fs.mkdtempSync(path.join(os.tmpdir(), "designecho-review-roundtrip-"));
  fs.mkdirSync(path.join(reviewRoundTripRoot, "runs"), { recursive: true });
  fs.mkdirSync(path.join(reviewRoundTripRoot, "reviews"), { recursive: true });
  fs.writeFileSync(
    path.join(reviewRoundTripRoot, "runs", "run.json"),
    JSON.stringify(passing, null, 2),
    "utf8"
  );
  fs.writeFileSync(
    path.join(reviewRoundTripRoot, "reviews", "review.json"),
    JSON.stringify(review, null, 2),
    "utf8"
  );
  fs.writeFileSync(
    path.join(reviewRoundTripRoot, "reviews", "legacy.json"),
    JSON.stringify(legacyNeedsFix, null, 2),
    "utf8"
  );
  const collectedReviewRoundTrip = collectSidecars([reviewRoundTripRoot]);
  assert.strictEqual(collectedReviewRoundTrip.reviews.length, 1,
    "合法 v2 Review 在无上下文 sidecar 扫描阶段不得被误判为无效");
  assert.strictEqual(collectedReviewRoundTrip.invalid.length, 0);
  assert.strictEqual(collectedReviewRoundTrip.excludedEvidence.some((item) => (
    item.id === legacyNeedsFix.reviewId
    && item.reason === "historical_review_protocol_non_official"
  )), true, "旧 v1 Review 应保留为 historical_non_official，而不是同版本突然损坏");
  const retainedReviewRoundTrip = retainContextuallyValidReviews(
    collectedReviewRoundTrip,
    { cases: [caseSpec], rubrics: [rubric] }
  );
  assert.strictEqual(retainedReviewRoundTrip.reviews.length, 1,
    "Review 经 collectSidecars 后必须还能完成当前 Case / Run / Rubric 精确绑定");
  fs.rmSync(reviewRoundTripRoot, { recursive: true, force: true });
  const report = buildDesignReliabilityCohortReport({
    suiteId: caseSpec.suiteId,
    cohortId: "candidate",
    cases: [caseSpec],
    rubrics: [rubric],
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
  assert.strictEqual(report.overall.quality.strictHumanReviewedRate.numerator, 0);
  assert.strictEqual(report.overall.quality.humanPassRate.denominator, 0,
    "自报来源盲评没有匿名包收据时不得进入正式通过率分母");
  assert.strictEqual(report.overall.quality.humanUsableRate.numerator, 0);
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
    rubrics: [rubric],
    runs: [passing],
    reviews: [review, conflictingReview],
    attributions: []
  });
  assert.strictEqual(conflictReport.overall.quality.conflictingReviewRunCount, 0,
    "诊断评审冲突不得伪装成正式严格评审冲突统计");
  assert.strictEqual(conflictReport.overall.quality.humanUsableRate.numerator, 0,
    "同一成稿出现 pass / needs_fix 冲突时不能按任一 pass 冒充商业可用");
  assert.strictEqual(
    report.cohortIntegrity.homogeneous,
    false,
    "同一 cohort 混入不同 Git / dirty / model / fixture 维度时必须显式失去同质性"
  );
  const changedFixtureRun = JSON.parse(JSON.stringify(passing));
  changedFixtureRun.runObservationId = "same-case-different-fixture";
  changedFixtureRun.cohortDimensions.fixtureDigest = `sha256:${"9".repeat(64)}`;
  const fixtureIdentityReport = buildDesignReliabilityCohortReport({
    suiteId: caseSpec.suiteId,
    cohortId: "candidate",
    cases: [caseSpec],
    rubrics: [rubric],
    runs: [passing, changedFixtureRun],
    reviews: [],
    attributions: []
  });
  assert.strictEqual(fixtureIdentityReport.cohortIntegrity.homogeneous, false,
    "同一 Case 但 fixtureDigest 不同的样本不得被视为同质 cohort");

  const differentCaseSet = JSON.parse(JSON.stringify(report));
  differentCaseSet.selector.caseSetDigest = `sha256:${"d".repeat(64)}`;
  assert.strictEqual(compareDesignReliabilityCohorts(report, differentCaseSet).comparable, false);
  const differentRubricSet = JSON.parse(JSON.stringify(report));
  differentRubricSet.selector.rubricSetDigest = `sha256:${"e".repeat(64)}`;
  assert.strictEqual(compareDesignReliabilityCohorts(report, differentRubricSet).comparable, false,
    "Rubric 内容身份不同的 cohort 禁止直接比较");
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
