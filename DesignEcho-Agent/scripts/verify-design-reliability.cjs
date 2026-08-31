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
  artifactGeometryMatchesCase,
  ATTRIBUTION_VERSION,
  LEGACY_REVIEW_VERSION,
  REVIEW_VERSION,
  attributionMatchesDesignReliabilityCohort,
  buildCaseDigest,
  buildComparisonEvidenceDigest,
  buildDesignReliabilityGeneratedFixtureContent,
  buildDesignReliabilityLiveRunProtocolDigest,
  buildExpectedComparisonEvidenceList,
  buildRubricDigest,
  buildReviewPacketProjectionDigest,
  buildDesignReliabilityCohortReport,
  calculateWeightedOverall,
  compareDesignReliabilityCohorts,
  deriveDesignReliabilityRunObservation,
  evaluateDesignReliabilityReleaseGates,
  getDesignReliabilityComparisonReferences,
  requiredComparisonEvidenceKinds,
  resolveDesignReliabilityAttributionSubject,
  sha256Text,
  stableStringify,
  validateDesignReliabilityCase,
  validateDesignReliabilityAttribution,
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
  PHOTOSHOP_RUNTIME_LEASE_CONFLICT,
  acquirePhotoshopRuntimeLease,
  inspectPhotoshopRuntimeLease,
  releasePhotoshopRuntimeLease
} = require("./lib/design-reliability-photoshop-runtime-lease.cjs");
const {
  buildCanonicalAttemptSafetyLedger,
  buildAttemptCohortReportContext,
  buildFirstMutationBaselineProof,
  buildLiveEnvironmentPhotoshopReadBatch,
  classifyUntrustedDebugBridgeFailure,
  buildPreflight,
  buildSkuLiveDeliveryEvidence,
  buildStatus,
  buildSuiteCaseSetDigest,
  buildSuiteRubricSetDigest,
  buildLiveAttemptCoverage,
  collectSidecars,
  controlledProjectMetadataSchemaSnapshot,
  deriveLiveAttemptFingerprint,
  deriveLiveCohortFingerprint,
  evaluateFixtureInventory,
  evaluateAttributableAttemptEvents,
  evaluateOfficialAttemptEligibility,
  evaluateDebugRendererPreflight,
  evaluateLiveEnvironmentSafety,
  extractLiveEnvironmentPhotoshopRead,
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
  resolveLiveRunTimeout,
  resolveAttributionCliSubject,
  resolveLoopbackDebugBridge,
  resolveReliabilityEvidenceRoots,
  resolveSidecarOutputPath,
  runLiveCase,
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
const {
  buildDebugBridgeInteractionReceipt,
  createDebugBridgeInteractionLedger,
  readDebugBridgeInteractionReceipt,
  recordDebugBridgeInteraction,
  MAX_DEBUG_BRIDGE_CHAT_TIMEOUT_MS
} = require(path.join(ROOT, "src", "shared", "debug-bridge-chat.ts"));
const {
  enrichPhotoshopDocumentInventory
} = require(path.join(ROOT, "src", "shared", "photoshop-document-inventory.ts"));
const {
  buildOperatingContextPromptSection,
  buildOperatingContextSnapshot
} = require(path.join(
  ROOT,
  "src",
  "shared",
  "agent-runtime-v5",
  "operating-context-snapshot.ts"
));
const {
  MAIN_IMAGE_MANIFEST
} = require(path.join(ROOT, "src", "shared", "agent-runtime-v5", "manifests", "main-image.manifest.ts"));
const {
  DETAIL_PAGE_MANIFEST
} = require(path.join(ROOT, "src", "shared", "agent-runtime-v5", "manifests", "detail-page.manifest.ts"));
const {
  armDebugProjectReferenceProviderReceipt,
  clearDebugProjectReferenceProviderReceipt,
  commitDebugProjectReferenceProviderReceipt,
  prepareDebugProjectReferenceProviderCandidate,
  readDebugProjectReferenceProviderCandidateKeys,
  readDebugProjectReferenceProviderReceipt
} = require(path.join(
  ROOT,
  "src",
  "main",
  "services",
  "debug-project-reference-provider-receipt.ts"
));
const {
  buildModelVisualPresentationReceipt
} = require(path.join(
  ROOT,
  "src",
  "shared",
  "model-visual-presentation-receipt.ts"
));
const {
  normalizeDebugFinalArtifactRefs
} = require(path.join(ROOT, "src", "shared", "debug-final-artifact-refs.ts"));
const {
  resolveRuntimeExecutionTarget
} = require(path.join(
  ROOT,
  "src",
  "shared",
  "agent-runtime-v5",
  "runtime-execution-target.ts"
));
const {
  projectAgenticFinalDeliveryEvidence
} = require(path.join(
  ROOT,
  "src",
  "renderer",
  "services",
  "agent-runtime",
  "agentic-final-delivery-evidence.ts"
));
const {
  collectAgentFinalDeliveryDebugProjection
} = require(path.join(
  ROOT,
  "src",
  "renderer",
  "services",
  "agent-runtime",
  "final-delivery-artifact-collector.ts"
));
const {
  resolveDebugProjectReferenceTransportMetadata,
  runWithDebugProjectReferenceTransportScope
} = require(path.join(
  ROOT,
  "src",
  "renderer",
  "services",
  "debug-bridge-project-reference.ts"
));
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
const REFERENCE_CASE_PATH = path.join(
  ROOT,
  "benchmarks",
  "design-reliability",
  "cases",
  "reference-replication-c1163-from-c1164-v1.json"
);
const REFERENCE_RUBRIC_PATH = path.join(
  ROOT,
  "benchmarks",
  "design-reliability",
  "rubrics",
  "reference-replication-main-image-v1.json"
);
const SKU_INTERACTION_CASE_PATH = path.join(
  ROOT,
  "benchmarks",
  "design-reliability",
  "cases",
  "sku-c1163-interaction-v1.json"
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

function readReferenceCase() {
  return JSON.parse(fs.readFileSync(REFERENCE_CASE_PATH, "utf8"));
}

function readReferenceRubric() {
  return JSON.parse(fs.readFileSync(REFERENCE_RUBRIC_PATH, "utf8"));
}

function readSkuInteractionCase() {
  return JSON.parse(fs.readFileSync(SKU_INTERACTION_CASE_PATH, "utf8"));
}

function sha256Buffer(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function buildDebugProviderReceiptFixture(options = {}) {
  const duplicateNormalizedPixels = options.duplicateNormalizedPixels === true;
  const firstBytes = Buffer.from("debug-reference-normalized-pixels-a", "utf8");
  const secondBytes = duplicateNormalizedPixels
    ? firstBytes
    : Buffer.from("debug-reference-normalized-pixels-b", "utf8");
  const byteSets = options.referenceCount === 1
    ? [firstBytes]
    : [firstBytes, secondBytes];
  const attachments = byteSets.map((bytes, index) => ({
    version: "debug-bridge-project-asset-attachment/v1",
    relativePath: `参考/目标-${index + 1}.jpg`,
    label: `目标参考 ${index + 1}`,
    sourceDigest: sha256Text(`source-file-${index + 1}`),
    payloadDigest: sha256Buffer(bytes),
    mediaType: "image/jpeg",
    width: 100 + index,
    height: 100 + index,
    data: bytes.toString("base64")
  }));
  const bindingEvidence = attachments.map((attachment) => ({
    relativePath: attachment.relativePath,
    sourceDigest: attachment.sourceDigest,
    payloadDigest: attachment.payloadDigest,
    mediaType: attachment.mediaType,
    width: attachment.width,
    height: attachment.height
  }));
  const binding = {
    version: "debug-bridge-project-asset-payload-binding/v1",
    bindingDigest: sha256Buffer(Buffer.from(JSON.stringify(bindingEvidence), "utf8")),
    referenceCount: attachments.length
  };
  const messages = [{
    role: "user",
    contentBlocks: attachments.map((attachment) => ({
      type: "image",
      data: attachment.data,
      mediaType: attachment.mediaType
    }))
  }];
  const token = "a".repeat(64);
  const metadata = {
    version: "debug-bridge-model-transport-metadata/v1",
    projectReferenceLeaseToken: token,
    projectReferenceBindingDigest: binding.bindingDigest
  };
  return { attachments, binding, messages, token, metadata };
}

function fullSuiteInputDigestsAreFrozen(cases) {
  return cases.every((caseSpec) => (
    (caseSpec.task?.agentVisibleInputs || []).every((input) => (
      /^sha256:[a-f0-9]{64}$/.test(String(input.digest || "").toLowerCase())
    ))
  ));
}

function literalUnionValues(typeNode) {
  if (!typeNode) return [];
  const nodes = ts.isUnionTypeNode(typeNode) ? typeNode.types : [typeNode];
  return nodes.map((node) => (
    ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)
      ? node.literal.text
      : ""
  )).filter(Boolean).sort();
}

function readProductionProjectConfigSchema() {
  const filePath = path.join(ROOT, "src", "main", "services", "ecommerce-project-service.ts");
  const source = fs.readFileSync(filePath, "utf8");
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const folderType = sourceFile.statements.find((node) => (
    ts.isTypeAliasDeclaration(node) && node.name.text === "FolderType"
  ));
  const imageType = sourceFile.statements.find((node) => (
    ts.isTypeAliasDeclaration(node) && node.name.text === "ImageType"
  ));
  const projectConfig = sourceFile.statements.find((node) => (
    ts.isInterfaceDeclaration(node) && node.name.text === "ProjectConfig"
  ));
  assert(folderType && imageType && projectConfig, "生产 ProjectConfig 类型声明必须可解析");
  const projectMembers = projectConfig.members;
  const designPlanMember = projectMembers.find((member) => member.name?.getText(sourceFile) === "designPlan");
  assert(designPlanMember && ts.isTypeLiteralNode(designPlanMember.type), "ProjectConfig.designPlan 必须保持结构化类型");
  const designPlanKeys = designPlanMember.type.members
    .map((member) => member.name?.getText(sourceFile) || "")
    .filter(Boolean)
    .sort();
  const designStatuses = [...new Set(designPlanMember.type.members.flatMap((member) => {
    if (!member.type || !ts.isTypeLiteralNode(member.type)) return [];
    const statusMember = member.type.members.find((item) => item.name?.getText(sourceFile) === "status");
    return literalUnionValues(statusMember?.type);
  }))].sort();
  return {
    version: source.includes("version: '1.0'") ? "1.0" : "unknown",
    keys: projectMembers.map((member) => member.name?.getText(sourceFile) || "").filter(Boolean).sort(),
    folderTypes: literalUnionValues(folderType.type),
    imageTypes: literalUnionValues(imageType.type),
    designPlanKeys,
    designStatuses
  };
}

function buildComparisonRefsForTest(caseSpec, run) {
  return buildExpectedComparisonEvidenceList(caseSpec, run);
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
  const interactionLedger = createDebugBridgeInteractionLedger(
    "debug-interaction-fixture",
    "2026-08-29T00:00:00.000Z"
  );
  recordDebugBridgeInteraction(interactionLedger, "protocol_interaction");
  recordDebugBridgeInteraction(interactionLedger, "user_design_correction");
  const interactionReceipt = buildDebugBridgeInteractionReceipt(
    interactionLedger,
    "2026-08-29T00:01:00.000Z"
  );
  assert.deepStrictEqual(readDebugBridgeInteractionReceipt(interactionReceipt), interactionReceipt);
  assert.strictEqual(interactionReceipt.protocolInteractionCount, 1);
  assert.strictEqual(interactionReceipt.userDesignCorrectionCount, 1);
  assert.strictEqual(readDebugBridgeInteractionReceipt({
    ...interactionReceipt,
    userDesignCorrectionCount: -1
  }), undefined, "交互计数不能是负数");
  assert.strictEqual(readDebugBridgeInteractionReceipt({
    ...interactionReceipt,
    requestId: ""
  }), undefined, "交互收据必须绑定请求身份");

  const loadedSuite = loadSuite();
  for (const caseSpec of loadedSuite.cases) {
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(caseSpec, "__file"),
      false,
      "loadSuite 不能把开发侧文件定位信息混入正式 Case 对象"
    );
    assert.strictEqual(
      validateDesignReliabilityCase(caseSpec).ok,
      true,
      "loadSuite 返回的 Case 必须仍能通过正式 Case schema"
    );
  }
  for (const rubric of loadedSuite.rubrics) {
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(rubric, "__file"),
      false,
      "loadSuite 不能把开发侧文件定位信息混入正式 Rubric 对象"
    );
    assert.strictEqual(
      validateRubric(rubric).ok,
      true,
      "loadSuite 返回的 Rubric 必须仍能通过正式 Rubric schema"
    );
  }
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
  const dirtyOutsideDocument = {
    id: 41,
    name: "用户工作稿.psd",
    isActive: true,
    pathState: "saved",
    editState: "dirty",
    projectAffinity: "outside_current_project",
    historyStateRef: { documentId: 41, historyStateId: 101 }
  };
  const dirtyUnsavedDocument = {
    id: 42,
    name: "800",
    isActive: false,
    pathState: "unsaved",
    editState: "dirty",
    projectAffinity: "unknown",
    historyStateRef: { documentId: 42, historyStateId: 202 }
  };
  const passingBaseline = guardedBaselineModule.createGuardedPhotoshopExecutionBaseline({
    requestId: "debug-request-pass",
    expectedPhotoshopRuntimeBuildId: expectedPhotoshopBuildId,
    expectedPhotoshopRuntimeBinding: baselineRuntimeBinding,
    expectedProjectPath: "C:/fixture-r32",
    initialDocuments: [dirtyOutsideDocument, dirtyUnsavedDocument]
  });
  let runtimeObservationCount = 0;
  let documentObservationCount = 0;
  let fakeMutationDispatchCount = 0;
  const passingObservers = {
    observePhotoshopRuntimeIdentity: async () => {
      runtimeObservationCount += 1;
      return baselineRuntimeIdentity;
    },
    observeOpenDocuments: async () => {
      documentObservationCount += 1;
      return [dirtyOutsideDocument, dirtyUnsavedDocument];
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
  assert.strictEqual(documentObservationCount, 1, "并发首次写只能读取一次对象级文档 baseline");
  assert.strictEqual(fakeMutationDispatchCount, 2, "通过后同一请求的后续 mutation 可继续执行");
  assert.strictEqual(concurrentBaselineDecisions[0].receipt.initialDirtyOutsideFixtureDocumentCount, 2,
    "路径明确与未保存的前置 dirty 文档都必须被对象级保护，而不是升级成全局阻塞");
  assert.deepStrictEqual(
    concurrentBaselineDecisions[0].receipt.initialProtectedDocumentRefs,
    [
      { documentId: 41, historyStateId: 101 },
      { documentId: 42, historyStateId: 202 }
    ],
    "提交收据必须冻结每个前置 Photoshop 对象的 document revision"
  );
  assert.strictEqual(
    concurrentBaselineDecisions[0].receipt.preexistingDocumentRevisionsUnchanged,
    true,
    "首写收据必须带出由对象 revision 对比得到的不变事实，不能只留在内存 assessment"
  );
  const completionDecision = await guardedBaselineModule.completeGuardedPhotoshopExecutionBaseline(
    passingBaseline,
    {
      observeOpenDocuments: async () => [
        { ...dirtyOutsideDocument, isActive: false },
        dirtyUnsavedDocument,
        {
          id: 80,
          name: "r32-main-image.psd",
          isActive: true,
          pathState: "saved",
          editState: "clean",
          projectAffinity: "current_project",
          historyStateRef: { documentId: 80, historyStateId: 808 }
        }
      ],
      now: () => "2026-08-26T00:00:05.000Z"
    }
  );
  assert.strictEqual(completionDecision.ready, true,
    "任务完成时允许新增已保存到 fixture 的目标文档，但所有前置对象必须保持原 revision");
  assert.strictEqual(completionDecision.receipt.completionStatus, "passed");
  assert.strictEqual(
    completionDecision.receipt.completionPreexistingDocumentRevisionsUnchanged,
    true
  );

  const recoverableSelectionBaseline = guardedBaselineModule.createGuardedPhotoshopExecutionBaseline({
    requestId: "debug-request-recoverable-first-tool",
    expectedPhotoshopRuntimeBuildId: expectedPhotoshopBuildId,
    expectedPhotoshopRuntimeBinding: baselineRuntimeBinding,
    expectedProjectPath: "C:/fixture-r32",
    initialDocuments: [dirtyOutsideDocument, dirtyUnsavedDocument]
  });
  let recoverableRuntimeObservationCount = 0;
  let recoverableDocumentObservationCount = 0;
  const recoverableObservers = {
    observePhotoshopRuntimeIdentity: async () => {
      recoverableRuntimeObservationCount += 1;
      return baselineRuntimeIdentity;
    },
    observeOpenDocuments: async () => {
      recoverableDocumentObservationCount += 1;
      return [dirtyOutsideDocument, dirtyUnsavedDocument];
    }
  };
  const rejectedFirstTool = await guardedBaselineModule.enforceGuardedPhotoshopExecutionBaseline(
    recoverableSelectionBaseline,
    "placeImage",
    recoverableObservers
  );
  assert.strictEqual(rejectedFirstTool.ready, false,
    "错误首写工具必须在 Photoshop dispatch 前拒绝");
  assert.strictEqual(rejectedFirstTool.receipt.status, "not_reached",
    "没有 Host 副作用的工具选择错误不能伪造成已执行或永久 blocked mutation");
  assert.strictEqual(rejectedFirstTool.retryableWithinTaskRun, true);
  assert.strictEqual(rejectedFirstTool.nextRequiredTool, "createDocument");
  assert.strictEqual(recoverableSelectionBaseline.state, "pending");
  assert.strictEqual(recoverableSelectionBaseline.firstMutationToolName, undefined);
  const recoveredFirstMutation = await guardedBaselineModule.enforceGuardedPhotoshopExecutionBaseline(
    recoverableSelectionBaseline,
    "createDocument",
    recoverableObservers
  );
  assert.strictEqual(recoveredFirstMutation.ready, true,
    "被写前拒绝且未产生副作用后，正确 createDocument 必须重新检查并取得首写资格");
  assert.strictEqual(recoveredFirstMutation.receipt.status, "passed");
  assert.strictEqual(recoveredFirstMutation.receipt.firstMutationToolName, "createDocument");
  assert.strictEqual(recoverableRuntimeObservationCount, 2,
    "恢复尝试不能复用错误首选时的 Runtime 观察");
  assert.strictEqual(recoverableDocumentObservationCount, 2,
    "恢复尝试不能复用错误首选时的文档 revision 观察");

  const driftAfterRecoverableRejectionBaseline =
    guardedBaselineModule.createGuardedPhotoshopExecutionBaseline({
      requestId: "debug-request-drift-after-recoverable-rejection",
      expectedPhotoshopRuntimeBuildId: expectedPhotoshopBuildId,
      expectedPhotoshopRuntimeBinding: baselineRuntimeBinding,
      expectedProjectPath: "C:/fixture-r32",
      initialDocuments: [dirtyOutsideDocument, dirtyUnsavedDocument]
    });
  const rejectedBeforeRevisionDrift = await guardedBaselineModule.enforceGuardedPhotoshopExecutionBaseline(
    driftAfterRecoverableRejectionBaseline,
    "placeImage",
    passingObservers
  );
  assert.strictEqual(rejectedBeforeRevisionDrift.retryableWithinTaskRun, true);
  const blockedAfterRevisionDrift = await guardedBaselineModule.enforceGuardedPhotoshopExecutionBaseline(
    driftAfterRecoverableRejectionBaseline,
    "createDocument",
    {
      observePhotoshopRuntimeIdentity: async () => baselineRuntimeIdentity,
      observeOpenDocuments: async () => [
        dirtyOutsideDocument,
        {
          ...dirtyUnsavedDocument,
          historyStateRef: { documentId: 42, historyStateId: 203 }
        }
      ]
    }
  );
  assert.strictEqual(blockedAfterRevisionDrift.ready, false);
  assert.strictEqual(blockedAfterRevisionDrift.receipt.status, "blocked",
    "可恢复拒绝后的真实 revision 漂移必须永久失败关闭");
  assert.strictEqual(
    blockedAfterRevisionDrift.receipt.preexistingDocumentRevisionsUnchanged,
    false,
    "真实 revision 漂移必须在首写收据中显式带出 false，不能伪造为通过"
  );
  assert.strictEqual(blockedAfterRevisionDrift.retryableWithinTaskRun, undefined);
  assert.match(blockedAfterRevisionDrift.error, /preexisting_document_revision_changed/);
  const stillBlockedAfterSafeFactsReturn = await guardedBaselineModule.enforceGuardedPhotoshopExecutionBaseline(
    driftAfterRecoverableRejectionBaseline,
    "createDocument",
    passingObservers
  );
  assert.strictEqual(stillBlockedAfterSafeFactsReturn.receipt.status, "blocked",
    "真实 revision 漂移不能因后续观察看似恢复而在同一 TaskRun 解锁");

  for (const completionFailure of [
    {
      name: "preexisting revision changed",
      documents: [
        dirtyOutsideDocument,
        {
          ...dirtyUnsavedDocument,
          historyStateRef: { documentId: 42, historyStateId: 203 }
        }
      ],
      expected: /preexisting_document_revision_changed/
    },
    {
      name: "preexisting document missing",
      documents: [dirtyOutsideDocument],
      expected: /preexisting_document_missing/
    },
    {
      name: "new external document at completion",
      documents: [
        dirtyOutsideDocument,
        dirtyUnsavedDocument,
        {
          id: 81,
          name: "外部新增.psd",
          isActive: true,
          pathState: "saved",
          editState: "clean",
          projectAffinity: "outside_current_project",
          historyStateRef: { documentId: 81, historyStateId: 818 }
        }
      ],
      expected: /new_outside_document_opened/
    }
  ]) {
    const completionBaseline = guardedBaselineModule.createGuardedPhotoshopExecutionBaseline({
      requestId: `debug-completion-${completionFailure.name}`,
      expectedPhotoshopRuntimeBuildId: expectedPhotoshopBuildId,
      expectedPhotoshopRuntimeBinding: baselineRuntimeBinding,
      expectedProjectPath: "C:/fixture-r32",
      initialDocuments: [dirtyOutsideDocument, dirtyUnsavedDocument]
    });
    const firstMutationDecision = await guardedBaselineModule.enforceGuardedPhotoshopExecutionBaseline(
      completionBaseline,
      "createDocument",
      passingObservers
    );
    assert.strictEqual(firstMutationDecision.ready, true);
    const failedCompletion = await guardedBaselineModule.completeGuardedPhotoshopExecutionBaseline(
      completionBaseline,
      { observeOpenDocuments: async () => completionFailure.documents }
    );
    assert.strictEqual(failedCompletion.ready, false, `${completionFailure.name} must fail closed`);
    assert.strictEqual(failedCompletion.receipt.completionStatus, "blocked");
    assert.match(failedCompletion.error, completionFailure.expected);
  }

  for (const blockedCase of [
    {
      name: "same build reloaded",
      runtimeIdentity: {
        ...baselineRuntimeIdentity,
        loadedAt: "2026-08-26T00:00:02.000Z"
      },
      toolName: "createDocument",
      openDocuments: [dirtyOutsideDocument, dirtyUnsavedDocument]
    },
    {
      name: "new outside document",
      runtimeIdentity: baselineRuntimeIdentity,
      toolName: "createDocument",
      openDocuments: [
        dirtyOutsideDocument,
        dirtyUnsavedDocument,
        {
          ...dirtyOutsideDocument,
          id: 43,
          name: "后来打开.psd",
          historyStateRef: { documentId: 43, historyStateId: 303 }
        }
      ]
    },
    {
      name: "document state unavailable",
      runtimeIdentity: baselineRuntimeIdentity,
      toolName: "createDocument",
      openDocuments: undefined
    }
  ]) {
    const baseline = guardedBaselineModule.createGuardedPhotoshopExecutionBaseline({
      requestId: `debug-request-${blockedCase.name}`,
      expectedPhotoshopRuntimeBuildId: expectedPhotoshopBuildId,
      expectedPhotoshopRuntimeBinding: baselineRuntimeBinding,
      expectedProjectPath: "C:/fixture-r32",
      initialDocuments: [dirtyOutsideDocument, dirtyUnsavedDocument]
    });
    const decision = await guardedBaselineModule.enforceGuardedPhotoshopExecutionBaseline(
      baseline,
      blockedCase.toolName,
      {
        observePhotoshopRuntimeIdentity: async () => blockedCase.runtimeIdentity,
        observeOpenDocuments: async () => blockedCase.openDocuments
      }
    );
    assert.strictEqual(decision.ready, false, `${blockedCase.name} must block before mutation dispatch`);
    assert.strictEqual(decision.receipt.status, "blocked");
  }
  assert.throws(() => guardedBaselineModule.createGuardedPhotoshopExecutionBaseline({
    requestId: "debug-request-fixture-already-open",
    expectedPhotoshopRuntimeBuildId: expectedPhotoshopBuildId,
    expectedPhotoshopRuntimeBinding: baselineRuntimeBinding,
    expectedProjectPath: "C:/fixture-r32",
    initialDocuments: [{
      ...dirtyOutsideDocument,
      id: 51,
      name: "fixture.psd",
      editState: "clean",
      projectAffinity: "current_project",
      historyStateRef: { documentId: 51, historyStateId: 404 }
    }]
  }), /fixture_document_already_open/,
  "提交时已存在 fixture 文档必须视为样本污染，而不是要求用户关闭所有其它文档");
  assert.throws(() => guardedBaselineModule.createGuardedPhotoshopExecutionBaseline({
    requestId: "debug-request-unsaved-without-revision",
    expectedPhotoshopRuntimeBuildId: expectedPhotoshopBuildId,
    expectedPhotoshopRuntimeBinding: baselineRuntimeBinding,
    expectedProjectPath: "C:/fixture-r32",
    initialDocuments: [{
      ...dirtyUnsavedDocument,
      historyStateRef: undefined
    }]
  }), /document_ownership_unresolved/,
  "未保存文档只有在 Host 返回稳定 document revision 时才能作为受保护前置对象放行");
  const openedFixtureBaseline = guardedBaselineModule.createGuardedPhotoshopExecutionBaseline({
    requestId: "debug-request-fixture-opened-by-run",
    expectedPhotoshopRuntimeBuildId: expectedPhotoshopBuildId,
    expectedPhotoshopRuntimeBinding: baselineRuntimeBinding,
    expectedProjectPath: "C:/fixture-r32",
    initialDocuments: [dirtyOutsideDocument, dirtyUnsavedDocument]
  });
  const openedFixtureDecision = await guardedBaselineModule.enforceGuardedPhotoshopExecutionBaseline(
    openedFixtureBaseline,
    "createRectangle",
    {
      observePhotoshopRuntimeIdentity: async () => baselineRuntimeIdentity,
      observeOpenDocuments: async () => [{
        ...dirtyOutsideDocument,
        isActive: false
      }, {
        ...dirtyUnsavedDocument,
        isActive: false
      }, {
        id: 52,
        name: "fixture.psd",
        isActive: true,
        pathState: "saved",
        editState: "clean",
        projectAffinity: "current_project",
        historyStateRef: { documentId: 52, historyStateId: 505 }
      }]
    }
  );
  assert.strictEqual(openedFixtureDecision.ready, false,
    "从零创作 Case 的首次写入必须由 createDocument 生产新目标，不能把后来打开的 fixture 输入文档当成写目标");
  assert.match(openedFixtureDecision.error, /fixture_document_opened_before_first_mutation/);

  const duplicatePixelFixture = buildDebugProviderReceiptFixture({
    duplicateNormalizedPixels: true
  });
  const debugTransportSubmission = {
    attachments: duplicatePixelFixture.attachments,
    binding: duplicatePixelFixture.binding,
    images: [],
    contentParts: []
  };
  await assert.rejects(
    () => runWithDebugProjectReferenceTransportScope({
      leaseToken: duplicatePixelFixture.token,
      submission: debugTransportSubmission,
      operation: async () => resolveDebugProjectReferenceTransportMetadata([
        { role: "user", contentBlocks: [] }
      ])
    }),
    /首个 Agent 模型请求没有唯一携带/,
    "Renderer Debug scope 必须在首个自主模型请求丢图时直接停止"
  );
  const scopedTransportMetadata = await runWithDebugProjectReferenceTransportScope({
    leaseToken: duplicatePixelFixture.token,
    submission: debugTransportSubmission,
    operation: async () => resolveDebugProjectReferenceTransportMetadata(
      duplicatePixelFixture.messages
    )
  });
  assert.deepStrictEqual(scopedTransportMetadata, duplicatePixelFixture.metadata,
    "Renderer 只能为当前 scope 中唯一匹配的有序像素签发 IPC transport metadata");
  assert.strictEqual(resolveDebugProjectReferenceTransportMetadata(
    duplicatePixelFixture.messages
  ), undefined, "handleSend Promise 闭合后 Debug transport scope 必须清空");
  const providerReceiptRequestId = "debug-provider-receipt-contract";
  armDebugProjectReferenceProviderReceipt({
    requestId: providerReceiptRequestId,
    leaseToken: duplicatePixelFixture.token,
    attachments: duplicatePixelFixture.attachments,
    binding: duplicatePixelFixture.binding
  });
  try {
    assert.throws(
      () => prepareDebugProjectReferenceProviderCandidate(
        duplicatePixelFixture.messages,
        "chat_with_tools",
        undefined
      ),
      /模型传输租约/,
      "活动租约缺少 transport metadata 时必须在 Provider 前失败"
    );
    assert.throws(
      () => prepareDebugProjectReferenceProviderCandidate(
        duplicatePixelFixture.messages,
        "chat_with_tools",
        {
          ...duplicatePixelFixture.metadata,
          projectReferenceLeaseToken: "b".repeat(64)
        }
      ),
      /模型传输租约/,
      "相同像素的普通或旧 token 调用不能消费当前 Debug 租约"
    );
    const candidate = prepareDebugProjectReferenceProviderCandidate(
      duplicatePixelFixture.messages,
      "chat_with_tools",
      duplicatePixelFixture.metadata
    );
    assert(candidate, "正确 token、binding 与有序像素必须形成 Provider candidate");
    const candidateKeys = readDebugProjectReferenceProviderCandidateKeys(candidate);
    assert.strictEqual(new Set(candidateKeys).size, duplicatePixelFixture.attachments.length,
      "不同来源即使规范化像素相同，也必须以 ordinal/binding 生成唯一 candidate key");
    assert.strictEqual(readDebugProjectReferenceProviderReceipt(providerReceiptRequestId), undefined,
      "只准备 candidate 不能冒充 Provider 已成功返回");
    assert.strictEqual(commitDebugProjectReferenceProviderReceipt(candidate, {
      provider: "openai-codex",
      modelId: "gpt-debug-contract"
    }), undefined, "Codex 缺少真实 outgoing presentation receipt 时不能签收");
    const visualReceipt = buildModelVisualPresentationReceipt({
      provider: "openai-codex",
      attemptId: "c".repeat(64),
      candidateKeys,
      serializedImages: duplicatePixelFixture.attachments.map((attachment) => ({
        mediaType: attachment.mediaType,
        decodedByteSha256: attachment.payloadDigest.slice(7),
        decodedByteLength: Buffer.from(attachment.data, "base64").length
      }))
    });
    const committed = commitDebugProjectReferenceProviderReceipt(candidate, {
      provider: "openai-codex",
      modelId: "gpt-debug-contract",
      visualPresentationReceipt: visualReceipt
    });
    assert(committed
      && committed.provider === "openai-codex"
      && committed.modelId === "gpt-debug-contract"
      && committed.transport === "chat_with_tools"
      && /^sha256:[a-f0-9]{64}$/.test(committed.providerAttemptRef)
      && Date.parse(committed.matchedAt) <= Date.parse(committed.committedAt),
    "Main 只能在成功 Provider turn 后签发带模型、传输、尝试与时序的收据");
    assert.deepStrictEqual(
      readDebugProjectReferenceProviderReceipt(providerReceiptRequestId),
      committed,
      "完成端只能按同一 Debug requestId 读取 Main 收据"
    );
  } finally {
    clearDebugProjectReferenceProviderReceipt(providerReceiptRequestId);
  }

  assert.strictEqual(prepareDebugProjectReferenceProviderCandidate(
    duplicatePixelFixture.messages,
    "chat_with_tools",
    duplicatePixelFixture.metadata
  ), null, "租约清理后相同像素不能复活旧请求");

  const genericFixture = buildDebugProviderReceiptFixture({ referenceCount: 1 });
  const genericRequestId = "debug-provider-generic-contract";
  armDebugProjectReferenceProviderReceipt({
    requestId: genericRequestId,
    leaseToken: genericFixture.token,
    attachments: genericFixture.attachments,
    binding: genericFixture.binding
  });
  try {
    assert.throws(
      () => prepareDebugProjectReferenceProviderCandidate(
        [{ role: "user", contentBlocks: [] }],
        "chat_with_tools",
        genericFixture.metadata
      ),
      /目标参考像素/,
      "活动租约的模型消息丢图时不能调用 Provider"
    );
    const candidate = prepareDebugProjectReferenceProviderCandidate(
      genericFixture.messages,
      "chat_with_tools",
      genericFixture.metadata
    );
    assert.strictEqual(commitDebugProjectReferenceProviderReceipt(candidate, {
      provider: "openai",
      modelId: "gpt-generic-contract",
      formattedRequest: { messages: [{ role: "user", content: [] }] }
    }), undefined, "非 Codex adapter 丢失图片时不能在成功响应后补签");
    const formattedRequest = {
      messages: [{
        role: "user",
        content: genericFixture.attachments.map((attachment) => ({
          type: "image_url",
          image_url: {
            url: `data:${attachment.mediaType};base64,${attachment.data}`
          }
        }))
      }]
    };
    assert(commitDebugProjectReferenceProviderReceipt(candidate, {
      provider: "openai",
      modelId: "gpt-generic-contract",
      formattedRequest
    }), "只有 adapter 序列化后的实际请求仍含精确像素时才允许签收");
  } finally {
    clearDebugProjectReferenceProviderReceipt(genericRequestId);
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
  const photoshopUxpLoaderSource = fs.readFileSync(path.join(
    ROOT,
    "scripts",
    "load-photoshop-uxp-plugin.cjs"
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
  const appSource = fs.readFileSync(path.join(
    ROOT,
    "src",
    "renderer",
    "App.tsx"
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
  const debugProjectReferenceSource = fs.readFileSync(path.join(
    ROOT,
    "src",
    "renderer",
    "services",
    "debug-bridge-project-reference.ts"
  ), "utf8");
  const debugProviderReceiptSource = fs.readFileSync(path.join(
    ROOT,
    "src",
    "main",
    "services",
    "debug-project-reference-provider-receipt.ts"
  ), "utf8");
  const modelServiceSource = fs.readFileSync(path.join(
    ROOT,
    "src",
    "main",
    "services",
    "model-service.ts"
  ), "utf8");
  const streamHandlersSource = fs.readFileSync(path.join(
    ROOT,
    "src",
    "main",
    "ipc-handlers",
    "stream-handlers.ts"
  ), "utf8");
  const websocketHandlersSource = fs.readFileSync(path.join(
    ROOT,
    "src",
    "main",
    "ipc-handlers",
    "websocket-handlers.ts"
  ), "utf8");
  const agentOrchestrationContextSource = fs.readFileSync(path.join(
    ROOT,
    "src",
    "renderer",
    "services",
    "agent-orchestration",
    "context.ts"
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
  assert(toolExecutorSource.includes("guarded_first_photoshop_mutation_requires_create_document")
    && toolExecutorSource.includes("retryableWithinTaskRun: true")
    && toolExecutorSource.includes("nextRequiredTool: baselineDecision.nextRequiredTool"),
  "无副作用首写工具拒绝必须给出结构化恢复出口，真实 baseline 失败仍保持原终止 code");
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
    && chatPanelSource.includes("mainImageCanvas: { ...normalizedDimensionSpec.mainImage }")
    && !chatPanelSource.includes("apiKeys: state.apiKeys"),
  "Debug preflight 必须只返回脱敏模型/Provider/项目/尺寸事实，不得暴露凭据");
  const debugCancelHandlerStart = chatPanelSource.indexOf("onDebugBridgeChatCancel");
  const debugCancelHandlerEnd = chatPanelSource.indexOf("}, [stopGeneration]);", debugCancelHandlerStart);
  const debugCancelHandlerSource = chatPanelSource.slice(debugCancelHandlerStart, debugCancelHandlerEnd);
  assert(debugCancelHandlerStart > 0
    && debugCancelHandlerEnd > debugCancelHandlerStart
    && debugCancelHandlerSource.includes("ui.interruptionKind = 'request_cancelled'")
    && !debugCancelHandlerSource.includes("markActiveAgentRunStopped();"),
  "Debug Bridge timeout 只能记录外部请求取消，不能提前伪造用户点击停止");
  const handleSendStageIndex = chatPanelSource.indexOf("executionStage = 'handle_send_started'");
  const debugReferenceScopeCallIndex = chatPanelSource.indexOf(
    "await runWithDebugProjectReferenceTransportScope({",
    handleSendStageIndex
  );
  const handleSendCallIndex = chatPanelSource.indexOf(
    "operation: () => handleSend({",
    debugReferenceScopeCallIndex
  );
  assert(handleSendStageIndex > 0
    && debugReferenceScopeCallIndex > handleSendStageIndex
    && handleSendCallIndex > debugReferenceScopeCallIndex
    && chatPanelSource.slice(handleSendStageIndex, debugReferenceScopeCallIndex).includes("writePossible = true")
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
  assert(debugBridgeSource.includes(".toBuffer({ resolveWithObject: true })")
    && debugBridgeSource.includes("projectAssetAttachments: verifiedProjectAssetPayload.attachments")
    && debugBridgeSource.includes("debugBridgeProjectAssetProviderReceiptMatches(")
    && debugProjectReferenceSource.includes("kind: 'uploaded_image' as const")
    && debugProjectReferenceSource.includes("runWithDebugProjectReferenceTransportScope")
    && debugProjectReferenceSource.includes("resolveDebugProjectReferenceTransportMetadata")
    && chatPanelSource.includes("images: preparedProjectReferences.images")
    && chatPanelSource.includes("runWithDebugProjectReferenceTransportScope({")
    && !chatPanelSource.includes("buildDebugProjectReferenceProviderReceipt({")
    && autonomousExecutorSource.includes("resolveDebugProjectReferenceTransportMetadata(messages)")
    && preloadSource.includes("debugTransportMetadata?: DebugBridgeModelTransportMetadata")
    && websocketHandlersSource.includes("debugTransportMetadata")
    && streamHandlersSource.includes("debugTransportMetadata")
    && debugProviderReceiptSource.includes("debug_project_reference_transport_metadata_invalid")
    && debugProviderReceiptSource.includes("debug_project_reference_provider_pixels_missing")
    && modelServiceSource.includes("requireDebugProjectReferenceProviderReceipt(")
    && modelServiceSource.includes("if (debugProjectReferenceCandidate) {")
    && mainProcessSource.includes("crypto.randomBytes(32).toString('hex')")
    && mainProcessSource.includes("projectAssetProviderBindingReceipt: _rendererProjectAssetProviderBindingReceipt")
    && designReliabilityCliSource.includes("projectAssetProviderBindingReceipt"),
  "用户目标参考必须由 Main 解码、以 Debug-only IPC 租约绑定实际 Provider 请求并在成功返回后签收；Renderer 不能自签或覆盖");
  const modelStreamRunIndex = modelServiceSource.indexOf(
    "private async runChatWithToolsStream("
  );
  const debugStreamReceiptGateIndex = modelServiceSource.indexOf(
    "if (debugProjectReferenceCandidate) {",
    modelStreamRunIndex
  );
  const directOpenRouterStreamIndex = modelServiceSource.indexOf(
    "if (provider === 'openrouter') {",
    modelStreamRunIndex
  );
  assert(modelStreamRunIndex > 0
    && debugStreamReceiptGateIndex > modelStreamRunIndex
    && directOpenRouterStreamIndex > debugStreamReceiptGateIndex
    && modelServiceSource.slice(
      debugStreamReceiptGateIndex,
      directOpenRouterStreamIndex
    ).includes("() => this.chatWithTools(")
    && modelServiceSource.slice(
      debugStreamReceiptGateIndex,
      directOpenRouterStreamIndex
    ).includes("type: 'done'"),
  "携带参考租约的流式请求必须先走非流式收据闭环，再发布唯一 terminal/tool 结果");
  assert(debugBridgeSource.includes("readDebugWorkspaceSemanticDigest(")
    && agentOrchestrationContextSource.includes("verifyExpectedWorkspaceSemanticDigest(")
    && agentOrchestrationContextSource.includes("expectedWorkspaceSemanticDigest")
    && chatPanelSource.includes("debugWorkspaceSemanticBinding.onConsumed(")
    && chatPanelSource.includes("consumedWorkspaceSemanticDigest !== expectedWorkspaceSemanticDigest")
    && designReliabilityCliSource.includes("receipt.consumedWorkspaceSemanticDigest")
    && designReliabilityCliSource.includes("expectedWorkspaceSemanticDigest: input.workspaceSemanticDigest")
    && designReliabilityCliSource.includes(
      "workspaceSemanticDigest: fixtureBefore.workspaceMetadata.semanticDigest"
    ),
  "workspace semantic identity 必须贯穿 CLI、Main 与 Agent 实际消费的项目上下文，不能用旁路预读冒充绑定");
  const debugBridgeProjectSeedIndex = appSource.indexOf(
    "const projectPath = window.designEcho?.getDebugBridgeLaunchProjectPath?.();"
  );
  const debugBridgeProjectSeedEnd = appSource.indexOf(
    "}, [commitProjectSession]);",
    debugBridgeProjectSeedIndex
  );
  const debugBridgeProjectSeedSource = appSource.slice(
    debugBridgeProjectSeedIndex,
    debugBridgeProjectSeedEnd
  );
  assert(preloadSource.includes(
    "const debugBridgeLaunchProjectPath = process.env.DESIGNECHO_CHAT_TEST_BRIDGE === '1'"
  )
    && preloadSource.includes("process.env.DESIGNECHO_CHAT_TEST_PROJECT_PATH")
    && preloadSource.includes(
      "getDebugBridgeLaunchProjectPath: (): string | null => debugBridgeLaunchProjectPath || null"
    )
    && debugBridgeProjectSeedIndex > 0
    && debugBridgeProjectSeedEnd > debugBridgeProjectSeedIndex
    && !debugBridgeProjectSeedSource.includes("designechoChatTestProjectPath")
    && !debugBridgeProjectSeedSource.includes("process.env.NODE_ENV"),
  "production benchmark 项目必须来自 Main 授权的启动上下文，不能依赖 development 编译分支或 Renderer URL 自签");
  const runLivePreflightIndex = designReliabilityCliSource.indexOf("const preflight = await buildPreflight");
  const runLiveLeaseIndex = designReliabilityCliSource.indexOf(
    "const runtimeLease = acquirePhotoshopRuntimeLease({",
    runLivePreflightIndex
  );
  const runLiveLeaseRevalidationIndex = designReliabilityCliSource.indexOf(
    "const leasedPhotoshopRuntime = await inspectPhotoshopRuntimeBinding(args);",
    runLiveLeaseIndex
  );
  const runLiveArmedIndex = designReliabilityCliSource.indexOf("const armedAttempt = writeLiveAttemptEvent", runLivePreflightIndex);
  assert(runLivePreflightIndex > 0
    && runLiveLeaseIndex > runLivePreflightIndex
    && runLiveLeaseRevalidationIndex > runLiveLeaseIndex
    && runLiveArmedIndex > runLiveLeaseRevalidationIndex
    && runLiveArmedIndex > runLivePreflightIndex
    && designReliabilityCliSource.includes("renderer_model_mismatch")
    && designReliabilityCliSource.includes("renderer_provider_mismatch")
    && designReliabilityCliSource.includes("renderer_project_not_bound_to_fixture")
    && designReliabilityCliSource.includes("renderer_design_dimension_mismatch")
    && designReliabilityCliSource.includes('canvasAuthority === "runtime_setting"')
    && designReliabilityCliSource.includes("classifyUntrustedDebugBridgeFailure(error)"),
  "run-live 必须在 armed 前核对 Renderer 模型/Provider/项目/尺寸，并只按结构化副作用事实分流终态");
  assert(designReliabilityCliSource.includes("releasePhotoshopRuntimeLease(runtimeLease)")
    && photoshopUxpLoaderSource.includes("purpose: 'uxp_loader'")
    && photoshopUxpLoaderSource.includes("acquirePhotoshopRuntimeLease({")
    && photoshopUxpLoaderSource.includes("releasePhotoshopRuntimeLease(runtimeLease)"),
  "正式采集与官方 UXP loader 必须竞争同一开发期 Runtime 租约，并在 finally 释放");

  const runtimeLeaseTestRoot = fs.mkdtempSync(path.join(os.tmpdir(), "designecho-runtime-lease-"));
  try {
    const firstLease = acquirePhotoshopRuntimeLease({
      dataRoot: runtimeLeaseTestRoot,
      purpose: "formal_capture",
      ownerId: "attempt-a",
      ownerPid: 41001,
      ownerProcessStartedAtMs: 1_000,
      nowMs: 2_000,
      ttlMs: 20_000,
      processAlive: () => true
    });
    assert.strictEqual(
      inspectPhotoshopRuntimeLease({
        dataRoot: runtimeLeaseTestRoot,
        nowMs: 3_000,
        processAlive: () => true
      }).status,
      "active",
      "存活 owner 的未到期正式采集租约必须保持 active"
    );
    assert.throws(
      () => acquirePhotoshopRuntimeLease({
        dataRoot: runtimeLeaseTestRoot,
        purpose: "uxp_loader",
        ownerId: "loader-b",
        ownerPid: 41002,
        ownerProcessStartedAtMs: 2_500,
        nowMs: 3_000,
        ttlMs: 20_000,
        processAlive: () => true
      }),
      (error) => error?.code === PHOTOSHOP_RUNTIME_LEASE_CONFLICT,
      "正式采集期间另一个 UXP loader 必须在 Host mutation 前被同一租约拒绝"
    );
    assert.strictEqual(
      releasePhotoshopRuntimeLease({
        leasePath: firstLease.leasePath,
        leaseId: "00000000-0000-0000-0000-000000000000"
      }).released,
      false,
      "错误 leaseId 不能释放另一个 owner 的租约"
    );
    assert.strictEqual(releasePhotoshopRuntimeLease(firstLease).released, true,
      "原 owner 必须能够释放自己的租约");

    const expiredLease = acquirePhotoshopRuntimeLease({
      dataRoot: runtimeLeaseTestRoot,
      purpose: "uxp_loader",
      ownerId: "expired-loader",
      ownerPid: 41003,
      ownerProcessStartedAtMs: 5_000,
      nowMs: 6_000,
      ttlMs: 10_000,
      processAlive: () => true
    });
    const expiredButAliveInspection = inspectPhotoshopRuntimeLease({
      dataRoot: runtimeLeaseTestRoot,
      nowMs: 20_000,
      processAlive: () => true
    });
    assert.strictEqual(expiredButAliveInspection.status, "active",
      "TTL 只限制预期采集窗口；持有进程仍存活时不得把它误判为可删除陈旧租约");
    assert.strictEqual(expiredButAliveInspection.expired, true);
    const replacementLease = acquirePhotoshopRuntimeLease({
      dataRoot: runtimeLeaseTestRoot,
      purpose: "formal_capture",
      ownerId: "attempt-c",
      ownerPid: 41004,
      ownerProcessStartedAtMs: 19_000,
      nowMs: 20_000,
      ttlMs: 20_000,
      processAlive: (pid) => pid !== expiredLease.lease.ownerPid
    });
    assert.notStrictEqual(expiredLease.lease.leaseId, replacementLease.lease.leaseId,
      "持有进程已退出的陈旧租约必须可回收，不能永久阻塞后续正式采集");
    assert.strictEqual(releasePhotoshopRuntimeLease(expiredLease).released, false,
      "旧 owner 在租约被回收后不能删除新 owner 的租约");
    assert.strictEqual(releasePhotoshopRuntimeLease(replacementLease).released, true);
  } finally {
    fs.rmSync(runtimeLeaseTestRoot, { recursive: true, force: true });
  }
  assert(designReliabilityCliSource.includes(
    '全局写状态安全账本未清账: ${status.evidence.attemptSafetyLedger.unresolvedAttemptCount}'
  ), "status 必须把当前 Case 覆盖与跨 revision 的全局写状态安全账本分开显示");
  const fingerprintInput = {
    suiteId: "suite-timeout-proof",
    suiteCaseSetDigest: sha256Text("case-set"),
    suiteRubricSetDigest: sha256Text("rubric-set"),
    environment: {
      gitCommit: "a".repeat(40),
      dirtyFingerprint: sha256Text("clean"),
      runtimeGitCommit: "a".repeat(40),
      runtimeBuildId: "runtime-build",
      runtimeAppVersion: "1.0.0",
      photoshopRuntimeBuildId: "photoshop-build",
      photoshopRuntimeGitCommit: "a".repeat(40),
      photoshopRuntimeSourceDigest: sha256Text("photoshop-source"),
      photoshopRuntimeArtifactDigest: sha256Text("photoshop-artifact"),
      photoshopRuntimeManifestDigest: sha256Text("photoshop-manifest"),
      photoshopRuntimeBindingDigest: sha256Text("photoshop-binding"),
      mainImageCanvasDigest: sha256Text("main-image-1440")
    },
    provider: "provider",
    modelId: "model",
    timeoutMs: 900000
  };
  assert.notStrictEqual(
    deriveLiveCohortFingerprint(fingerprintInput),
    deriveLiveCohortFingerprint({ ...fingerprintInput, timeoutMs: 899999 }),
    "Suite 固定 timeout 必须进入唯一可重算 cohort fingerprint，不能只影响 HTTP 等待行为"
  );
  assert.notStrictEqual(
    deriveLiveCohortFingerprint(fingerprintInput),
    deriveLiveCohortFingerprint({
      ...fingerprintInput,
      environment: {
        ...fingerprintInput.environment,
        mainImageCanvasDigest: sha256Text("main-image-800")
      }
    }),
    "用户可见设计尺寸必须进入 cohort fingerprint，不能把 800 与 1440 的结果混为同一环境"
  );
  assert(!designReliabilityCliSource.includes("userInterventionCount: 0,")
    && designReliabilityCliSource.includes(
      "userInterventionCount: protocolInteractionCount + userDesignCorrectionCount"
    )
    && designReliabilityCliSource.includes("interactionMetricsKnown: true")
    && designReliabilityCliSource.includes("interactionReceiptVerifiedByMain"),
  "正式介入指标必须来自 Main 验证的 request-bound UI 事件收据，不能因只发送一条自然请求就硬编码为 0");
  assert(chatPanelSource.includes("createDebugBridgeInteractionLedger(")
    && chatPanelSource.includes("classifyDebugUserInteractionAction(normalizedActionId)")
    && chatPanelSource.includes("recordActiveDebugUserInteraction('user_design_correction')")
    && chatPanelSource.includes("recordActiveDebugUserInteraction('protocol_interaction')")
    && chatPanelSource.includes("buildDebugBridgeInteractionReceipt(")
    && mainProcessSource.includes("readDebugBridgeInteractionReceipt(")
    && mainProcessSource.includes("interactionReceiptVerifiedByMain: true"),
  "用户消息、任务交互卡和停止动作必须进入同一 Debug UI 事件账本，并由 Main 重新验证后才能计数");

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
  assert.strictEqual(caseSpec.oracle.outputContract.canvasAuthority, "user_instruction",
    "显式写出 800×800 的 Case 必须以用户指令为尺寸 authority，不受当前默认设置阻断");
  const realReferenceCase = readReferenceCase();
  const realReferenceRubric = readReferenceRubric();
  assert.strictEqual(validateDesignReliabilityCase(realReferenceCase).ok, true,
    "首条跨商品真实参考复刻 Case 必须通过统一契约");
  assert.strictEqual(realReferenceCase.oracle.outputContract.canvasAuthority, "user_instruction");
  assert.strictEqual(validateRubric(realReferenceRubric).ok, true,
    "参考复刻必须使用同任务族的独立人工 Rubric，不能借主图 family 绕过校验");
  assert.strictEqual(artifactGeometryMatchesCase(realReferenceCase, { width: 800, height: 800 }), true);
  assert.strictEqual(artifactGeometryMatchesCase(realReferenceCase, { width: 1500, height: 1500 }), false,
    "参考复刻必须消费通用 outputContract，不能因 family 名不同而让错误尺寸通过");
  assert.strictEqual(realReferenceCase.task.agentVisibleReferences.length, 1);
  assert(realReferenceCase.task.reviewOnlyReferences.every((reference) => (
    reference.ref !== realReferenceCase.task.agentVisibleReferences[0].ref
    && reference.digest !== realReferenceCase.task.agentVisibleReferences[0].digest
  )), "跨商品目标参考不能与同商品隐藏答案或 Eagle 锚点复用身份");
  const autonomousSkuCase = readSkuCase();
  const interactiveSkuCase = readSkuInteractionCase();
  assert.strictEqual(autonomousSkuCase.liveRunProtocol.kind, "autonomous_zero_correction");
  assert(fullSuiteInputDigestsAreFrozen([
    caseSpec,
    realReferenceCase,
    autonomousSkuCase,
    interactiveSkuCase
  ]), "固定质量 Case 的全部非生成输入必须冻结 SHA-256");
  assert(autonomousSkuCase.oracle.invariants.every((item) => !item.includes("确认卡续跑")),
    "信息完整的 SKU 质量 Case 不能同时要求确认卡协议");
  assert.strictEqual(validateDesignReliabilityCase(interactiveSkuCase).ok, true,
    "SKU 专属卡协议必须作为独立 draft Case 通过同一契约");
  assert.strictEqual(interactiveSkuCase.status, "draft",
    "dev user actor 与真实交互收据未落地前，交互 Case 不能进入正式分母");
  assert.strictEqual(interactiveSkuCase.liveRunProtocol.steps[0].answer, undefined,
    "公开 Case 不能保存 evaluator 私有交互答案");
  assert.strictEqual(interactiveSkuCase.oracle.outputInventory, undefined,
    "公开交互 Case 不能用答案派生文件名泄漏私有组合");
  assert.strictEqual(interactiveSkuCase.oracle.privateOutputInventoryBinding, undefined,
    "交互答案与输出期望必须绑定同一个私有 manifest，不能维护第二个可漂移绑定");
  assert.strictEqual(interactiveSkuCase.liveRunProtocol.steps[0].requiredSizes, undefined,
    "答案派生的规格不能留在公开交互协议中");
  const publicInteractiveCaseText = JSON.stringify(interactiveSkuCase);
  assert(!publicInteractiveCaseText.includes("2/3/4")
    && !publicInteractiveCaseText.includes("双组合数量")
    && !publicInteractiveCaseText.includes('\"requiredSizes\"'),
  "公开交互 Case 的自然语言与字段名都不能泄漏私有规格答案");
  assert.deepStrictEqual(interactiveSkuCase.task.reviewOnlyReferences, [],
    "答案派生的语义文件名与锚点只能由私有评测 manifest 解析");
  const forgedPrivateBinding = JSON.parse(JSON.stringify(interactiveSkuCase));
  forgedPrivateBinding.liveRunProtocol.privateEvaluationBinding.manifestId = "";
  forgedPrivateBinding.caseDigest = buildCaseDigest(forgedPrivateBinding);
  assert.strictEqual(validateDesignReliabilityCase(forgedPrivateBinding).ok, false,
    "交互协议必须绑定统一、不可变且不泄漏答案的私有评测 manifest 身份");
  const protocolWithUnknownLeakField = JSON.parse(JSON.stringify(interactiveSkuCase));
  protocolWithUnknownLeakField.liveRunProtocol.initialPromptLeak = { groups: [[1, 2, 3]] };
  protocolWithUnknownLeakField.caseDigest = buildCaseDigest(protocolWithUnknownLeakField);
  assert.strictEqual(validateDesignReliabilityCase(protocolWithUnknownLeakField).ok, false,
    "liveRunProtocol 顶层必须严格拒绝可能夹带私有答案的未知字段");
  const autonomousWithHiddenStep = JSON.parse(JSON.stringify(autonomousSkuCase));
  autonomousWithHiddenStep.liveRunProtocol.steps = interactiveSkuCase.liveRunProtocol.steps;
  autonomousWithHiddenStep.caseDigest = buildCaseDigest(autonomousWithHiddenStep);
  assert.strictEqual(validateDesignReliabilityCase(autonomousWithHiddenStep).ok, false,
    "自主零纠错协议不能夹带预声明答案或隐式用户步骤");

  const referenceReplicationCase = JSON.parse(JSON.stringify(caseSpec));
  referenceReplicationCase.caseId = "reference-replication-contract-v1";
  referenceReplicationCase.revision = 1;
  referenceReplicationCase.taskFamily = "reference_replication";
  referenceReplicationCase.task = {
    ...referenceReplicationCase.task,
    fixtureId: "reference-replication-contract-fixture-v1",
    agentVisibleInputs: [],
    fixtureGeneratedInputs: [],
    agentVisibleReferences: [{
      kind: "user_design",
      ref: "参考/用户明确提供的目标图.png",
      digest: sha256Text("agent-visible-reference")
    }],
    reviewOnlyReferences: [{
      kind: "eagle_item",
      ref: "eagle:item:hidden-quality-anchor",
      digest: `sha256:${"2".repeat(64)}`
    }]
  };
  referenceReplicationCase.caseDigest = buildCaseDigest(referenceReplicationCase);
  assert.strictEqual(validateDesignReliabilityCase(referenceReplicationCase).ok, true,
    "参考复刻 Case 必须显式区分 Agent 可见目标参考与隐藏评审锚点");
  assert.deepStrictEqual(
    getDesignReliabilityComparisonReferences(referenceReplicationCase).map((item) => item.ref),
    ["参考/用户明确提供的目标图.png", "eagle:item:hidden-quality-anchor"],
    "评审证据必须同时包含显式目标上下文与隐藏质量锚点，但二者不能使用同一种 pairwise 语义"
  );
  const leakedReferenceCase = JSON.parse(JSON.stringify(referenceReplicationCase));
  leakedReferenceCase.task.reviewOnlyReferences[0] = {
    ...leakedReferenceCase.task.reviewOnlyReferences[0],
    ref: leakedReferenceCase.task.agentVisibleReferences[0].ref
  };
  leakedReferenceCase.caseDigest = buildCaseDigest(leakedReferenceCase);
  assert.strictEqual(validateDesignReliabilityCase(leakedReferenceCase).ok, false,
    "隐藏评审锚点与 Agent 可见参考复用同一 ref 时必须拒绝，不能泄漏答案");
  const leakedInputDigestCase = JSON.parse(JSON.stringify(referenceReplicationCase));
  leakedInputDigestCase.task.agentVisibleInputs = [{
    ref: "摄影输入/伪装成素材.jpg",
    role: "product_candidate",
    digest: leakedInputDigestCase.task.reviewOnlyReferences[0].digest
  }];
  leakedInputDigestCase.caseDigest = buildCaseDigest(leakedInputDigestCase);
  assert.strictEqual(validateDesignReliabilityCase(leakedInputDigestCase).ok, false,
    "隐藏锚点即使换 ref，也不能用相同内容摘要伪装成普通 Agent 输入");
  const leakedGeneratedDigestCase = JSON.parse(JSON.stringify(referenceReplicationCase));
  leakedGeneratedDigestCase.task.fixtureGeneratedInputs = [{
    ref: "测试输入/事实.json",
    role: "verified_product_brief",
    encoding: "utf8",
    facts: { product_type: "女士浅口隐形袜" }
  }];
  leakedGeneratedDigestCase.boundaries.fixtureGeneratedInputsContainFactsOnly = true;
  leakedGeneratedDigestCase.task.reviewOnlyReferences[0].digest = sha256Text(
    buildDesignReliabilityGeneratedFixtureContent(
      leakedGeneratedDigestCase.task.fixtureGeneratedInputs[0]
    )
  );
  leakedGeneratedDigestCase.caseDigest = buildCaseDigest(leakedGeneratedDigestCase);
  assert.strictEqual(validateDesignReliabilityCase(leakedGeneratedDigestCase).ok, false,
    "fixture 生成内容的真实摘要也必须参与 review-only 防泄漏检查");
  const visibleEagleCase = JSON.parse(JSON.stringify(referenceReplicationCase));
  visibleEagleCase.task.agentVisibleReferences = [{
    kind: "eagle_item",
    ref: "eagle:item:cannot-materialize-directly",
    digest: `sha256:${"3".repeat(64)}`
  }];
  visibleEagleCase.caseDigest = buildCaseDigest(visibleEagleCase);
  assert.strictEqual(validateDesignReliabilityCase(visibleEagleCase).ok, false,
    "没有显式物化协议时，Agent 可见 Eagle ID 不能成为 prepare-fixture 永远无法复制的伪合法 Case");

  const attributionBoundaries = {
    devBenchmarkSidecarOnly: true,
    neverAffectsRuntime: true,
    cannotBecomeRuntimeGate: true
  };
  const attemptAttribution = {
    version: ATTRIBUTION_VERSION,
    attributionId: "attempt-provider-failure",
    subject: { attemptId: "attempt-without-run-observation" },
    symptomCode: "provider_timeout",
    owner: "model_provider",
    failureMode: "provider",
    status: "confirmed",
    confidence: "high",
    evidenceRefs: ["attempt:terminal:provider_failed"],
    rationale: "提交后 Provider 失败，尚未形成 Run Observation。",
    attributedBy: "engineer",
    attributedAt: "2026-08-27T00:00:00.000Z",
    boundaries: attributionBoundaries
  };
  assert.strictEqual(validateDesignReliabilityAttribution(attemptAttribution).ok, true,
    "进入正式分母但没有 Run Observation 的 Attempt 必须仍可被同一 Attribution schema 归因");
  const resolvedAttemptAttribution = resolveDesignReliabilityAttributionSubject(attemptAttribution);
  assert.strictEqual(resolvedAttemptAttribution?.kind, "attempt");
  assert.strictEqual(resolvedAttemptAttribution?.attemptId, "attempt-without-run-observation");
  assert.strictEqual(attributionMatchesDesignReliabilityCohort(attemptAttribution, {
    runObservationIds: [],
    attemptIds: ["attempt-without-run-observation"]
  }), true);
  const mixedAttributionSubject = {
    ...attemptAttribution,
    runObservationId: "legacy-run-must-not-mix"
  };
  assert.strictEqual(validateDesignReliabilityAttribution(mixedAttributionSubject).ok, false,
    "新 subject union 不能再混入旧顶层身份形成第三种协议");

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
  const photoshopReadBatch = buildLiveEnvironmentPhotoshopReadBatch();
  assert.deepStrictEqual(photoshopReadBatch, {
    allowWrites: false,
    delayMs: 50,
    calls: [
      { name: "diagnoseState", arguments: { verbose: false } },
      { name: "listDocuments", arguments: { includeDetails: true, includeHistoryState: true } }
    ]
  }, "live preflight 必须由一个只读串行 batch 获取 Runtime identity 与完整文档清单");
  const photoshopReadBatchStatus = {
    ok: true,
    result: {
      success: true,
      results: [
        { name: "diagnoseState", success: true, result: { state: { runtime: safePhotoshopRuntime } } },
        { name: "listDocuments", success: true, result: { success: true, documents: [], count: 0 } }
      ]
    }
  };
  assert.deepStrictEqual(
    extractLiveEnvironmentPhotoshopRead(photoshopReadBatchStatus, "diagnoseState"),
    { ok: true, result: { state: { runtime: safePhotoshopRuntime } } },
    "batch 中的 Runtime identity 读回必须保留原结果"
  );
  assert.deepStrictEqual(
    extractLiveEnvironmentPhotoshopRead(photoshopReadBatchStatus, "listDocuments"),
    { ok: true, result: { success: true, documents: [], count: 0 } },
    "batch 中的文档清单读回必须保留原结果"
  );
  assert.strictEqual(
    extractLiveEnvironmentPhotoshopRead({ ok: true, result: { success: false, results: [] } }, "diagnoseState").ok,
    false,
    "批次缺少 Runtime identity 结果时必须失败关闭"
  );
  assert.strictEqual(
    extractLiveEnvironmentPhotoshopRead({
      ok: true,
      result: { results: [{ name: "listDocuments", success: false, error: "timeout" }] }
    }, "listDocuments").ok,
    false,
    "批次内单个 Photoshop 读取失败时不能被批次 success 掩盖"
  );
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
  const dirtyOutsideInventory = enrichPhotoshopDocumentInventory({
    success: true,
    documents: [{
      id: 132,
      name: "SKU.psb",
      isActive: true,
      path: "E:/WERKE/C-1258/PSD/SKU.psb",
      pathState: "saved",
      editState: "dirty",
      historyStateRef: { documentId: 132, historyStateId: 212 },
      width: 4672,
      height: 7008,
      layerCount: 24
    }]
  }, "C:/fixture/project");
  assert.strictEqual(dirtyOutsideInventory.documents[0].projectAffinity, "outside_current_project");
  assert.strictEqual(dirtyOutsideInventory.documents[0].editState, "dirty");
  const documentStateSnapshot = buildOperatingContextSnapshot({
    snapshotId: "operating:document-state-audit",
    correlationId: "run:document-state-audit",
    capturedAt: "2026-08-26T00:00:02.000Z",
    workspace: {
      revision: "workspace:document-state-audit",
      project: {
        projectId: "fixture-project",
        projectName: "fixture",
        projectPath: "C:/fixture/project"
      }
    },
    photoshop: {
      revision: "photoshop:document-state-audit",
      connection: "connected",
      documentState: "present",
      openDocuments: dirtyOutsideInventory.documents,
      document: {
        documentId: 132,
        name: "SKU.psb",
        editState: "dirty",
        width: 4672,
        height: 7008,
        layerCount: 24
      }
    }
  });
  const documentStatePrompt = buildOperatingContextPromptSection(documentStateSnapshot);
  assert(documentStatePrompt.includes("editState=dirty"));
  assert(documentStatePrompt.includes("projectAffinity=outside_current_project"));
  assert(documentStatePrompt.includes("不代表当前任务拥有、应保存或应关闭该文档"));
  assert.strictEqual(evaluateLiveEnvironmentSafety({
    ...safeLiveEnvironmentInput,
    photoshopRuntimeBuildVerification: {
      ...safePhotoshopBuildVerification,
      ready: false,
      issues: [{ code: "runtime_digest_mismatch" }]
    }
  }).blockers.includes("photoshop_runtime_build_identity_mismatch"), true,
  "磁盘 runtime.js、清单、checkout 或 live 身份任一不一致时必须阻止正式 Case");

  const matchingRendererProbe = {
    reachable: true,
    status: 200,
    responseBody: {
      success: true,
      guardedWriteProtocol: "debug-bridge-chat-submit/v1",
      renderer: {
        version: "debug-bridge-chat-preflight/v2",
        capturedAt: "2026-08-26T00:00:00.000Z",
        selectedProvider: "openai-codex",
        selectedModelId: "codex-subscription-gpt-5-6-sol",
        selectedApiModelId: "gpt-5.6-sol",
        selectedModelResolved: true,
        projectPath: "C:/fixture/project",
        mainImageCanvas: { width: 1440, height: 1440 },
        chatBusy: false
      }
    }
  };
  const matchingRendererPreflight = evaluateDebugRendererPreflight({
    probe: matchingRendererProbe,
    expectedProvider: "openai-codex",
    expectedModelId: "gpt-5.6-sol",
    expectedProjectPath: "C:/fixture/project",
    expectedMainImageCanvas: { width: 1440, height: 1440 }
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
          version: "debug-bridge-chat-preflight/v2",
          capturedAt: "2026-08-26T00:00:00.000Z",
          selectedProvider: "claude-subscription",
          selectedModelId: "claude-subscription-opus",
          selectedApiModelId: "opus",
          selectedModelResolved: true,
          projectPath: "C:/fixture/project",
          mainImageCanvas: { width: 1440, height: 1440 },
          chatBusy: false
        }
      }
    },
    expectedProvider: "openai-codex",
    expectedModelId: "gpt-5.6-sol",
    expectedProjectPath: "C:/fixture/project",
    expectedMainImageCanvas: { width: 1440, height: 1440 }
  }).ready, false, "错误模型不得等到 submission_started 后才发现");
  assert.strictEqual(evaluateDebugRendererPreflight({
    probe: matchingRendererProbe,
    expectedProvider: "openai-codex",
    expectedModelId: "gpt-5.6-sol",
    expectedProjectPath: "C:/fixture/project",
    expectedMainImageCanvas: { width: 800, height: 800 }
  }).ready, false, "Case 画布规格与 Renderer 当前尺寸不一致时必须在写前失败");
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
    version: "debug-bridge-chat-submit-receipt/v4",
    requestId: "debug-request-1",
    conversationId: "conversation-1",
    submittedProjectPath: "C:/fixture/project",
    completedProjectPath: "C:/fixture/project",
    expectedProjectMatchedAtSubmission: true,
    projectUnchangedThroughCompletion: true,
    expectedWorkspaceSemanticDigest: sha256Text("workspace-semantic"),
    consumedWorkspaceSemanticDigest: sha256Text("workspace-semantic"),
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
    photoshopDocumentPolicy: "preserve_preexisting_documents",
    photoshopDocumentGuardPassedAtSubmission: true,
    openPhotoshopDocumentCountAtSubmission: 1,
    openFixtureDocumentCountAtSubmission: 0,
    openOutsideFixtureDocumentCountAtSubmission: 1,
    unresolvedDocumentOwnershipCountAtSubmission: 0,
    dirtyOutsideFixtureDocumentCountAtSubmission: 1,
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
      version: "guarded-photoshop-execution-baseline-receipt/v2",
      status: "not_reached",
      requestId: "debug-request-1",
      documentPolicy: "preserve_preexisting_documents",
      expectedProjectPath: "C:/fixture/project",
      initialOpenDocumentCount: 1,
      initialOpenOutsideFixtureDocumentCount: 1,
      initialDirtyOutsideFixtureDocumentCount: 1,
      initialProtectedDocumentRefs: [{ documentId: 41, historyStateId: 101 }],
      expectedPhotoshopRuntimeBuildId: verifiedPhotoshopBuildId,
      expectedPhotoshopRuntimeBinding: safePhotoshopRuntimeBinding,
      completionStatus: "passed",
      completionCheckedAt: "2026-08-26T00:09:59.000Z",
      completionOpenDocumentCount: 2,
      completionOpenFixtureDocumentCount: 1,
      completionOpenOutsideFixtureDocumentCount: 1,
      completionUnresolvedOwnershipDocumentCount: 0,
      completionDirtyOutsideFixtureDocumentCount: 1,
      completionPreexistingDocumentRevisionsUnchanged: true
    },
    interactionReceipt: {
      version: "debug-bridge-interaction-receipt/v1",
      requestId: "debug-request-1",
      startedAt: "2026-08-26T00:00:00.000Z",
      completedAt: "2026-08-26T00:10:00.000Z",
      protocolInteractionCount: 0,
      userDesignCorrectionCount: 0,
      source: "renderer_ui_event_ledger"
    },
    interactionReceiptVerifiedByMain: true,
    finalArtifactRefs: ["主图/候选.psd", "主图/候选.jpg"]
  };
  const validDebugReceiptInput = {
    fixtureRoot: "C:/fixture/project",
    provider: "provider-a",
    modelId: "model-a",
    gitCommit: expectedCommit,
    runtimeBuildId: "designecho-test-build",
    photoshopRuntimeBuildId: verifiedPhotoshopBuildId,
    photoshopRuntimeBinding: safePhotoshopRuntimeBinding,
    workspaceSemanticDigest: sha256Text("workspace-semantic")
  };
  assert.strictEqual(validateDebugBridgeReceipt(
    { result: { receipt: validDebugReceipt } },
    validDebugReceiptInput
  ).ok, true, "提交前、首次写与完成后协议字段完整时 receipt 必须可信");
  const producerBackedBaseline = guardedBaselineModule.createGuardedPhotoshopExecutionBaseline({
    requestId: "debug-request-1",
    expectedPhotoshopRuntimeBuildId: verifiedPhotoshopBuildId,
    expectedPhotoshopRuntimeBinding: safePhotoshopRuntimeBinding,
    expectedProjectPath: "C:/fixture/project",
    initialDocuments: [dirtyOutsideDocument]
  });
  const producerBackedFirstMutation = await guardedBaselineModule.enforceGuardedPhotoshopExecutionBaseline(
    producerBackedBaseline,
    "createDocument",
    {
      observePhotoshopRuntimeIdentity: async () => safePhotoshopRuntime,
      observeOpenDocuments: async () => [dirtyOutsideDocument],
      now: () => "2026-08-26T00:00:03.000Z"
    }
  );
  assert.strictEqual(producerBackedFirstMutation.ready, true);
  const producerBackedCompletion = await guardedBaselineModule.completeGuardedPhotoshopExecutionBaseline(
    producerBackedBaseline,
    {
      observeOpenDocuments: async () => [
        { ...dirtyOutsideDocument, isActive: false },
        {
          id: 80,
          name: "候选.psd",
          isActive: true,
          pathState: "saved",
          editState: "clean",
          projectAffinity: "current_project",
          historyStateRef: { documentId: 80, historyStateId: 808 }
        }
      ],
      now: () => "2026-08-26T00:09:59.000Z"
    }
  );
  assert.strictEqual(producerBackedCompletion.ready, true);
  assert.strictEqual(validateDebugBridgeReceipt(
    {
      result: {
        receipt: {
          ...validDebugReceipt,
          firstPhotoshopMutationBaseline: producerBackedCompletion.receipt
        }
      }
    },
    validDebugReceiptInput
  ).ok, true,
  "Guarded baseline producer 的真实完成收据必须能直接通过 Reliability consumer，禁止手写 fixture 掩盖协议漂移");
  const missingInteractionReceipt = JSON.parse(JSON.stringify(validDebugReceipt));
  delete missingInteractionReceipt.interactionReceipt;
  assert.strictEqual(validateDebugBridgeReceipt(
    { result: { receipt: missingInteractionReceipt } },
    validDebugReceiptInput
  ).ok, false, "缺少交互事件收据时不能伪造零人工介入");
  const mismatchedInteractionRequest = {
    ...validDebugReceipt,
    interactionReceipt: {
      ...validDebugReceipt.interactionReceipt,
      requestId: "other-debug-request"
    }
  };
  assert.strictEqual(validateDebugBridgeReceipt(
    { result: { receipt: mismatchedInteractionRequest } },
    validDebugReceiptInput
  ).ok, false, "另一请求的交互计数不能复用到当前 Attempt");
  const workspaceSemanticDriftReceipt = {
    ...validDebugReceipt,
    consumedWorkspaceSemanticDigest: sha256Text("workspace-semantic-drift")
  };
  assert.strictEqual(validateDebugBridgeReceipt(
    { result: { receipt: workspaceSemanticDriftReceipt } },
    validDebugReceiptInput
  ).ok, false, "Agent 实际消费的项目语义摘要漂移必须拒绝进入正式 Attempt");
  const targetReference = {
    version: "debug-bridge-project-asset-reference/v1",
    relativePath: "参考/目标.jpg",
    label: "用户提供的目标参考",
    digest: sha256Text("target-reference-source")
  };
  const targetReferenceBindingDigest = sha256Text("normalized-target-reference-payload");
  const referenceBoundReceipt = {
    ...validDebugReceipt,
    projectAssetReferences: [targetReference],
    projectAssetPayloadBinding: {
      version: "debug-bridge-project-asset-payload-binding/v1",
      bindingDigest: targetReferenceBindingDigest,
      referenceCount: 1
    },
    projectAssetProviderBindingReceipt: {
      version: "debug-bridge-project-asset-provider-receipt/v1",
      bindingDigest: targetReferenceBindingDigest,
      referenceCount: 1,
      visualBlockCount: 1,
      matchedAtProviderBoundary: true,
      provider: "provider-a",
      modelId: "model-a",
      transport: "chat_with_tools",
      providerAttemptRef: sha256Text("provider-attempt-a"),
      matchedAt: "2026-08-26T00:00:01.000Z",
      committedAt: "2026-08-26T00:00:02.000Z"
    }
  };
  const referenceBoundInput = {
    ...validDebugReceiptInput,
    projectAssetReferences: [targetReference]
  };
  assert.strictEqual(validateDebugBridgeReceipt(
    { result: { receipt: referenceBoundReceipt } },
    referenceBoundInput
  ).ok, true, "目标参考必须以 Main 像素绑定和 Provider 视觉块收据共同证明");
  const mutationAfterReferenceReceipt = {
    ...referenceBoundReceipt,
    firstPhotoshopMutationBaseline: {
      version: "guarded-photoshop-execution-baseline-receipt/v2",
      status: "passed",
      requestId: "debug-request-1",
      documentPolicy: "preserve_preexisting_documents",
      expectedProjectPath: "C:/fixture/project",
      initialOpenDocumentCount: 1,
      initialOpenOutsideFixtureDocumentCount: 1,
      initialDirtyOutsideFixtureDocumentCount: 1,
      initialProtectedDocumentRefs: [{ documentId: 41, historyStateId: 101 }],
      expectedPhotoshopRuntimeBuildId: verifiedPhotoshopBuildId,
      expectedPhotoshopRuntimeBinding: safePhotoshopRuntimeBinding,
      firstMutationToolName: "createDocument",
      checkedAt: "2026-08-26T00:00:03.000Z",
      openDocumentCount: 1,
      openFixtureDocumentCount: 0,
      openOutsideFixtureDocumentCount: 1,
      unresolvedOwnershipDocumentCount: 0,
      dirtyOutsideFixtureDocumentCount: 1,
      preexistingDocumentRevisionsUnchanged: true,
      observedPhotoshopRuntimeBuildId: verifiedPhotoshopBuildId,
      observedPhotoshopRuntimeIdentity: safePhotoshopRuntime,
      completionStatus: "passed",
      completionCheckedAt: "2026-08-26T00:09:59.000Z",
      completionOpenDocumentCount: 2,
      completionOpenFixtureDocumentCount: 1,
      completionOpenOutsideFixtureDocumentCount: 1,
      completionUnresolvedOwnershipDocumentCount: 0,
      completionDirtyOutsideFixtureDocumentCount: 1,
      completionPreexistingDocumentRevisionsUnchanged: true
    }
  };
  assert.strictEqual(validateDebugBridgeReceipt(
    { result: { receipt: mutationAfterReferenceReceipt } },
    referenceBoundInput
  ).ok, true, "Provider 参考收据早于首次 Photoshop 写入时才可证明设计前看过参考");
  const lateProviderReferenceReceipt = {
    ...mutationAfterReferenceReceipt,
    projectAssetProviderBindingReceipt: {
      ...mutationAfterReferenceReceipt.projectAssetProviderBindingReceipt,
      matchedAt: "2026-08-26T00:00:04.000Z",
      committedAt: "2026-08-26T00:00:05.000Z"
    }
  };
  assert.strictEqual(validateDebugBridgeReceipt(
    { result: { receipt: lateProviderReferenceReceipt } },
    referenceBoundInput
  ).ok, false, "设计完成后才补看的参考不能冒充首次写入前的设计依据");
  const pathOnlyReferenceReceipt = JSON.parse(JSON.stringify(referenceBoundReceipt));
  delete pathOnlyReferenceReceipt.projectAssetProviderBindingReceipt;
  assert.strictEqual(validateDebugBridgeReceipt(
    { result: { receipt: pathOnlyReferenceReceipt } },
    referenceBoundInput
  ).ok, false, "只回显参考路径与源摘要不能冒充模型已经看到像素");
  const firstMutationBaselineProof = buildFirstMutationBaselineProof(validDebugReceipt);
  assert.strictEqual(firstMutationBaselineProof.version,
    "design-reliability-first-mutation-baseline-proof/v2");
  assert.strictEqual(firstMutationBaselineProof.status, "not_reached");
  assert.strictEqual(firstMutationBaselineProof.documentPolicy, "preserve_preexisting_documents");
  assert.strictEqual(firstMutationBaselineProof.initialProtectedDocumentCount, 1);
  assert.match(firstMutationBaselineProof.initialProtectedDocumentRefsDigest, /^sha256:[a-f0-9]{64}$/);
  assert.strictEqual(firstMutationBaselineProof.completionStatus, "passed");
  assert.strictEqual(firstMutationBaselineProof.completionPreexistingDocumentRevisionsUnchanged, true);
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
      version: "guarded-photoshop-execution-baseline-receipt/v2",
      status: "blocked",
      requestId: "debug-request-1",
      documentPolicy: "preserve_preexisting_documents",
      expectedProjectPath: "C:/fixture/project",
      initialOpenDocumentCount: 1,
      initialOpenOutsideFixtureDocumentCount: 1,
      initialDirtyOutsideFixtureDocumentCount: 1,
      initialProtectedDocumentRefs: [{ documentId: 41, historyStateId: 101 }],
      expectedPhotoshopRuntimeBuildId: verifiedPhotoshopBuildId,
      expectedPhotoshopRuntimeBinding: safePhotoshopRuntimeBinding,
      error: "Photoshop 当前已有既有文档",
      completionStatus: "passed",
      completionCheckedAt: "2026-08-26T00:09:59.000Z",
      completionOpenDocumentCount: 1,
      completionOpenFixtureDocumentCount: 0,
      completionOpenOutsideFixtureDocumentCount: 1,
      completionUnresolvedOwnershipDocumentCount: 0,
      completionDirtyOutsideFixtureDocumentCount: 1,
      completionPreexistingDocumentRevisionsUnchanged: true
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
      version: "guarded-photoshop-execution-baseline-receipt/v2",
      status: "passed",
      requestId: "debug-request-1",
      documentPolicy: "preserve_preexisting_documents",
      expectedProjectPath: "C:/fixture/project",
      initialOpenDocumentCount: 1,
      initialOpenOutsideFixtureDocumentCount: 1,
      initialDirtyOutsideFixtureDocumentCount: 1,
      initialProtectedDocumentRefs: [{ documentId: 41, historyStateId: 101 }],
      expectedPhotoshopRuntimeBuildId: verifiedPhotoshopBuildId,
      expectedPhotoshopRuntimeBinding: safePhotoshopRuntimeBinding,
      observedPhotoshopRuntimeBuildId: verifiedPhotoshopBuildId,
      observedPhotoshopRuntimeIdentity: safePhotoshopRuntime,
      openDocumentCount: 1,
      openFixtureDocumentCount: 0,
      openOutsideFixtureDocumentCount: 1,
      unresolvedOwnershipDocumentCount: 0,
      dirtyOutsideFixtureDocumentCount: 1,
      preexistingDocumentRevisionsUnchanged: true,
      firstMutationToolName: "createDocument",
      checkedAt: "2026-08-26T00:00:03.000Z",
      completionStatus: "passed",
      completionCheckedAt: "2026-08-26T00:09:59.000Z",
      completionOpenDocumentCount: 2,
      completionOpenFixtureDocumentCount: 1,
      completionOpenOutsideFixtureDocumentCount: 1,
      completionUnresolvedOwnershipDocumentCount: 0,
      completionDirtyOutsideFixtureDocumentCount: 1,
      completionPreexistingDocumentRevisionsUnchanged: true
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
        documents: [{
          id: 132,
          name: "SKU",
          pathState: "unsaved",
          editState: "dirty"
        }],
        count: 1
      }
    }
  });
  assert.strictEqual(userDocumentOpen.ready, false);
  assert(userDocumentOpen.blockers.includes("photoshop_documents_open"));
  assert.strictEqual(userDocumentOpen.photoshop.hasUnsavedDocument, true);
  assert.strictEqual(userDocumentOpen.photoshop.hasDirtyDocument, true);

  const unrelatedDocumentReconciliation = evaluateLiveEnvironmentSafety({
    ...safeLiveEnvironmentInput,
    documentPolicy: "no_fixture_documents",
    documentListStatus: {
      ok: true,
      result: dirtyOutsideInventory
    }
  });
  assert.strictEqual(unrelatedDocumentReconciliation.ready, true,
    "有明确外部路径的无关文档不得阻塞正式 Attempt 或原 fixture reconciliation");
  assert.strictEqual(unrelatedDocumentReconciliation.checks.noOpenPhotoshopDocuments, false);
  assert.strictEqual(unrelatedDocumentReconciliation.checks.noOpenFixtureDocuments, true);
  assert.strictEqual(unrelatedDocumentReconciliation.checks.openDocumentOwnershipResolved, true);
  assert.strictEqual(unrelatedDocumentReconciliation.photoshop.openOutsideFixtureDocumentCount, 1);
  assert.strictEqual(unrelatedDocumentReconciliation.photoshop.hasDirtyDocument, true,
    "无关文档的 dirty 事实必须保留，但不能被误解为当前 TaskRun 所有权");

  const unsavedProtectedDocument = evaluateLiveEnvironmentSafety({
    ...safeLiveEnvironmentInput,
    documentPolicy: "no_fixture_documents",
    documentListStatus: {
      ok: true,
      result: {
        success: true,
        documents: [{
          id: 133,
          name: "800",
          pathState: "unsaved",
          editState: "dirty",
          historyStateRef: { documentId: 133, historyStateId: 313 }
        }]
      }
    }
  });
  assert.strictEqual(unsavedProtectedDocument.ready, true,
    "未保存文档只要有稳定 Host revision，就应作为 TaskRun 前置对象保护而不是要求用户关闭");
  assert.strictEqual(unsavedProtectedDocument.photoshop.openOutsideFixtureDocumentCount, 1);
  assert.strictEqual(unsavedProtectedDocument.checks.openDocumentOwnershipResolved, true);

  const unknownDocumentOwnership = evaluateLiveEnvironmentSafety({
    ...safeLiveEnvironmentInput,
    documentPolicy: "no_fixture_documents",
    documentListStatus: {
      ok: true,
      result: {
        success: true,
        documents: [{ id: 133, name: "未命名-1", pathState: "unsaved", editState: "dirty" }]
      }
    }
  });
  assert.strictEqual(unknownDocumentOwnership.ready, false);
  assert(unknownDocumentOwnership.blockers.includes("photoshop_document_ownership_unresolved"));

  const fixtureDocumentStillOpen = evaluateLiveEnvironmentSafety({
    ...safeLiveEnvironmentInput,
    documentPolicy: "no_fixture_documents",
    documentListStatus: {
      ok: true,
      result: {
        success: true,
        documents: [{
          id: 134,
          name: "候选.psd",
          path: "C:/fixture/project/主图/候选.psd",
          pathState: "saved",
          editState: "clean",
          historyStateRef: { documentId: 134, historyStateId: 414 }
        }]
      }
    }
  });
  assert.strictEqual(fixtureDocumentStillOpen.ready, false);
  assert(fixtureDocumentStillOpen.blockers.includes("photoshop_fixture_documents_open"));

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

  assert.deepStrictEqual(
    controlledProjectMetadataSchemaSnapshot(),
    readProductionProjectConfigSchema(),
    "评测器允许的 project.json schema 必须与生产 ProjectConfig 同步，新增字段或枚举不能静默漂移"
  );

  const cleanFixtureInventory = evaluateFixtureInventory(
    ["S82646/a.jpg", "S82646/b.jpg"],
    ["S82646/a.jpg", "S82646/b.jpg"]
  );
  assert.strictEqual(cleanFixtureInventory.freshRunReady, true);
  const controlledMetadataInventory = evaluateFixtureInventory(
    ["S82646/a.jpg", "S82646/b.jpg"],
    ["S82646/a.jpg", "S82646/b.jpg", ".designecho/project.json"]
  );
  assert.strictEqual(controlledMetadataInventory.freshRunReady, true,
    "精确的项目身份 metadata 应与冻结输入分轴，不得把已打开 fixture 误判为污染");
  assert.deepStrictEqual(controlledMetadataInventory.workspaceMetadataRefs, [
    ".designecho/project.json"
  ]);
  assert.strictEqual(controlledMetadataInventory.actualInputFileCount, 2,
    "Workspace metadata 不能混入冻结输入数量");
  const extraMetadataInventory = evaluateFixtureInventory(
    ["S82646/a.jpg", "S82646/b.jpg"],
    [
      "S82646/a.jpg",
      "S82646/b.jpg",
      ".designecho/project.json",
      ".designecho/project-copy.json"
    ]
  );
  assert.strictEqual(extraMetadataInventory.freshRunReady, false,
    "只有精确 .designecho/project.json 可以进入受控 metadata 轴");
  assert.deepStrictEqual(extraMetadataInventory.unexpected, [
    ".designecho/project-copy.json"
  ]);
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
    repeatIndex: 1,
    liveRunProtocol: {
      kind: "autonomous_zero_correction",
      digest: buildDesignReliabilityLiveRunProtocolDigest(caseSpec)
    },
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
  const targetContextSourcePath = path.join(anonymousSourceRoot, "user-target-reference.jpg");
  await sharp({
    create: { width: 48, height: 48, channels: 3, background: { r: 240, g: 210, b: 120 } }
  }).jpeg({ quality: 92 }).toFile(targetContextSourcePath);
  const targetContextDigest = `sha256:${crypto.createHash("sha256")
    .update(fs.readFileSync(targetContextSourcePath)).digest("hex")}`;
  const packetCaseSpec = JSON.parse(JSON.stringify(caseSpec));
  packetCaseSpec.oracle.outputContract.exactRasterExports = 2;
  packetCaseSpec.task.agentVisibleReferences = [{
    kind: "user_design",
    ref: "参考/用户目标方向.jpg",
    digest: targetContextDigest,
    role: "user_provided_target_reference"
  }];
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
    if (item.kind === "target_reference_context") {
      return { evidenceRef: item.ref, sourcePath: targetContextSourcePath };
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
  let fakeImageError = null;
  try {
    await createDesignReliabilityReviewPacket({
      caseSpec: packetCaseSpec,
      run: anonymousPacketRun,
      rubric,
      sourceBindings: fakeImageBindings,
      reviewerPacketDirectory: path.join(anonymousPacketRoot, "fake-image-packet"),
      sealedMappingPath: path.join(anonymousSealedRoot, "fake-image-mapping.json")
    });
  } catch (error) {
    fakeImageError = error;
  }
  assert.match(
    fakeImageError instanceof Error ? fakeImageError.message : "",
    /可解码的真实图片/
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
    if (item.kind === "target_reference_context") {
      return { evidenceRef: item.ref, sourcePath: targetContextSourcePath };
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
  assert.strictEqual(packetCreation.packet.contextGroups.length, 1,
    "用户给 Agent 的目标参考必须作为明确目标上下文展示给评审者");
  assert.strictEqual(packetCreation.packet.contextGroups[0].role, "user_target_reference");
  assert.strictEqual(
    packetCreation.packet.anonymousGroups.length,
    packetComparisonRefs.filter((item) => item.kind !== "target_reference_context").length,
    "目标参考不能混进候选与质量锚点的匿名 pairwise 集合"
  );
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
    "target-reference:",
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
  const firstRubricDimensionId = rubric.dimensions[0].id;
  assert.deepStrictEqual(officialAnonymousReport.overall.quality.weightedOverall, {
    count: 1,
    median: diskVerifiedSidecars.reviews[0].weightedOverall,
    p90: diskVerifiedSidecars.reviews[0].weightedOverall
  }, "严格盲评必须保留总体分数中位数与 P90，不能只剩 pass 布尔值");
  assert.deepStrictEqual(
    officialAnonymousReport.overall.quality.dimensionScores[firstRubricDimensionId],
    {
      count: 1,
      median: diskVerifiedSidecars.reviews[0].scores[firstRubricDimensionId],
      p90: diskVerifiedSidecars.reviews[0].scores[firstRubricDimensionId]
    },
    "构图、层级等 rubric 维度必须分别聚合，才能定位设计效果变化"
  );
  assert.strictEqual(
    officialAnonymousReport.overall.quality.pairwiseOutcomes[
      diskVerifiedSidecars.reviews[0].pairwiseOutcome
    ],
    1,
    "相对用户设计 / Eagle 锚点的 pairwise 结论必须保留分布"
  );
  const duplicateReviewerReport = buildDesignReliabilityCohortReport({
    suiteId: packetCaseSpec.suiteId,
    cohortId: "candidate",
    cases: [packetCaseSpec],
    rubrics: [rubric],
    runs: [anonymousPacketRun],
    reviews: [diskVerifiedSidecars.reviews[0], diskVerifiedSidecars.reviews[0]],
    attributions: []
  });
  assert.strictEqual(duplicateReviewerReport.overall.quality.conflictingReviewRunCount, 1,
    "同一 reviewer 对同一 Run 重复提交必须要求裁决，不能用重复分数改变 Run 中位数");
  assert.strictEqual(duplicateReviewerReport.overall.quality.weightedOverall.count, 0,
    "重复 reviewer 的同一 Run 不能进入正式审美分布");
  const improvedAnonymousReport = JSON.parse(JSON.stringify(officialAnonymousReport));
  improvedAnonymousReport.cohortId = "candidate-improved";
  improvedAnonymousReport.overall.quality.dimensionScores[firstRubricDimensionId].median = Math.min(
    1,
    officialAnonymousReport.overall.quality.dimensionScores[firstRubricDimensionId].median + 0.05
  );
  const anonymousComparison = compareDesignReliabilityCohorts(
    withComparableAttemptShape(officialAnonymousReport, 1, 1),
    withComparableAttemptShape(improvedAnonymousReport, 1, 1)
  );
  assert.strictEqual(anonymousComparison.comparable, true);
  assert.strictEqual(
    anonymousComparison.deltas.dimensionMedianScores[firstRubricDimensionId],
    Math.round((
      improvedAnonymousReport.overall.quality.dimensionScores[firstRubricDimensionId].median
      - officialAnonymousReport.overall.quality.dimensionScores[firstRubricDimensionId].median
    ) * 10000) / 10000,
    "cohort compare 必须直接显示具体审美维度的中位数变化"
  );
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
  const formalSkuCase = readSkuCase();
  const formalSuite = {
    manifest: { suiteId: caseSpec.suiteId },
    cases: [caseSpec, formalSkuCase],
    rubrics: [rubric, readSkuRubric()]
  };
  const formalSuiteCaseSetDigest = buildSuiteCaseSetDigest(formalSuite);
  const formalSuiteRubricSetDigest = buildSuiteRubricSetDigest(formalSuite);
  const formalRuntimeEnvironment = {
    gitCommit: "a".repeat(40),
    dirty: false,
    dirtyFingerprint: sha256Text("formal-clean-worktree"),
    runtimeGitCommit: "a".repeat(40),
    runtimeBuildId: "formal-runtime-build",
    runtimeAppVersion: "1.0.0",
    timeoutMs: 900000,
    photoshopRuntimeBuildId: safePhotoshopRuntimeBinding.live.buildId,
    photoshopRuntimeGitCommit: safePhotoshopRuntimeBinding.live.gitCommit,
    photoshopRuntimeSourceDigest: safePhotoshopRuntimeBinding.live.sourceDigest,
    photoshopRuntimeArtifactDigest: safePhotoshopRuntimeBinding.runtimeDigest,
    photoshopRuntimeManifestDigest: safePhotoshopRuntimeBinding.manifestDigest,
    photoshopRuntimeBinding: safePhotoshopRuntimeBinding,
    photoshopRuntimeBindingDigest: sha256Text(stableStringify(safePhotoshopRuntimeBinding))
  };
  const formalCohortFingerprint = deriveLiveCohortFingerprint({
    suiteId: formalSuite.manifest.suiteId,
    suiteCaseSetDigest: formalSuiteCaseSetDigest,
    suiteRubricSetDigest: formalSuiteRubricSetDigest,
    environment: formalRuntimeEnvironment,
    provider: "provider-a",
    modelId: "model-a",
    timeoutMs: 900000
  });
  function formalAttemptEvents(input) {
    const inputCase = input.caseSpec;
    const inputRubric = formalSuite.rubrics.find((item) => item.rubricId === inputCase.oracle.rubricId);
    const fixtureRef = {
      instanceId: input.fixtureInstanceId,
      fixtureDigest: input.fixtureDigest,
      workspaceSemanticDigest: input.workspaceSemanticDigest || sha256Text("workspace-default"),
      pathBindingDigest: input.pathBindingDigest || sha256Text(`path-${input.fixtureInstanceId}`)
    };
    const liveRunProtocol = {
      kind: inputCase.liveRunProtocol?.kind || "autonomous_zero_correction",
      digest: buildDesignReliabilityLiveRunProtocolDigest(inputCase)
    };
    const caseRef = {
      caseId: inputCase.caseId,
      revision: inputCase.revision,
      caseDigest: inputCase.caseDigest
    };
    const instructionDigest = sha256Text(inputCase.task.instruction);
    const rubricDigest = buildRubricDigest(inputRubric);
    const attemptFingerprint = deriveLiveAttemptFingerprint({
      cohortFingerprint: formalCohortFingerprint,
      caseRef,
      fixtureRef,
      instructionDigest,
      rubricDigest,
      liveRunProtocol,
      repeatIndex: input.repeatIndex || 1
    });
    const base = {
      version: "design-reliability-attempt-event/v1",
      attemptId: input.attemptId,
      caseRef,
      cohortId: "cohort-formal-denominator",
      repeatIndex: input.repeatIndex || 1,
      provider: "provider-a",
      modelId: "model-a",
      timeoutMs: 900000,
      liveRunProtocol,
      fixtureRef,
      environment: formalRuntimeEnvironment,
      instructionDigest,
      rubricDigest,
      suiteCaseSetDigest: formalSuiteCaseSetDigest,
      suiteRubricSetDigest: formalSuiteRubricSetDigest,
      cohortFingerprint: formalCohortFingerprint,
      attemptFingerprint
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
        interactionMetricsKnown: true,
        protocolInteractionCount: 0,
        userDesignCorrectionCount: 0,
        ...(input.runObservationId ? { runObservationId: input.runObservationId } : {})
      }
    ];
  }
  const formalPassInput = {
    attemptId: "attempt-formal-pass",
    caseSpec,
    fixtureInstanceId: "fixture-formal-pass",
    fixtureDigest: `sha256:${"a".repeat(64)}`,
    status: "technical_delivery_passed",
    runObservationId: formalAttemptRun.runObservationId
  };
  const formalPassEvents = formalAttemptEvents(formalPassInput);
  const formalPassIdentity = formalPassEvents[0];
  formalAttemptRun.attempt = {
    attemptId: formalPassInput.attemptId,
    attemptFingerprint: formalPassIdentity.attemptFingerprint,
    repeatIndex: 1
  };
  formalAttemptRun.cohortDimensions = {
    ...formalAttemptRun.cohortDimensions,
    provider: "provider-a",
    requestedModelId: "model-a",
    fixtureInstanceId: formalPassInput.fixtureInstanceId,
    fixtureDigest: formalPassInput.fixtureDigest,
    workspaceSemanticDigest: formalPassIdentity.fixtureRef.workspaceSemanticDigest,
    instructionDigest: formalPassIdentity.instructionDigest,
    rubricDigest: formalPassIdentity.rubricDigest,
    liveRunProtocolKind: "autonomous_zero_correction",
    liveRunProtocolDigest: buildDesignReliabilityLiveRunProtocolDigest(caseSpec),
    suiteCaseSetDigest: formalSuiteCaseSetDigest,
    suiteRubricSetDigest: formalSuiteRubricSetDigest,
    cohortFingerprint: formalCohortFingerprint,
    ...formalRuntimeEnvironment
  };
  const formalFailInput = {
    attemptId: "attempt-formal-provider-fail",
    caseSpec: formalSkuCase,
    fixtureInstanceId: "fixture-formal-fail",
    fixtureDigest: `sha256:${"c".repeat(64)}`,
    status: "provider_failed"
  };
  const formalFailEvents = formalAttemptEvents(formalFailInput);
  const formalAttemptCoverage = buildLiveAttemptCoverage([
    ...formalPassEvents,
    ...formalFailEvents
  ], [formalAttemptRun], formalSuite, [formalAttemptReview]);
  const formalAttemptReportContext = buildAttemptCohortReportContext([
    ...formalPassEvents,
    ...formalFailEvents
  ], "cohort-formal-denominator");
  assert.deepStrictEqual(formalAttemptReportContext.attemptIds.sort(), [
    "attempt-formal-pass",
    "attempt-formal-provider-fail"
  ]);
  assert.deepStrictEqual(formalAttemptReportContext.attemptFixtureDigestsByCase, {
    [caseSpec.caseId]: [sha256Text(stableStringify({
      fixtureDigest: formalPassInput.fixtureDigest,
      workspaceSemanticDigest: formalPassEvents[0].fixtureRef.workspaceSemanticDigest
    }))],
    [formalSkuCase.caseId]: [sha256Text(stableStringify({
      fixtureDigest: formalFailInput.fixtureDigest,
      workspaceSemanticDigest: formalFailEvents[0].fixtureRef.workspaceSemanticDigest
    }))]
  }, "失败 Attempt 的 fixture 身份也必须进入 cohort 比较条件，不能只看有 Run 的成功样本");
  assert.strictEqual(formalAttemptReportContext.comparisonControlProfiles.length, 1);
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
  const forgedFingerprintEvents = JSON.parse(JSON.stringify(formalPassEvents));
  for (const event of forgedFingerprintEvents) {
    event.cohortFingerprint = sha256Text("forged-opaque-cohort");
    event.attemptFingerprint = sha256Text("forged-opaque-attempt");
  }
  const forgedFingerprintVerdict = evaluateOfficialAttemptEligibility(
    formalPassInput.attemptId,
    forgedFingerprintEvents,
    formalSuite
  );
  assert.strictEqual(forgedFingerprintVerdict.valid, false,
    "读取 canonical Attempt 时必须重算 cohort/attempt fingerprint，不能相信 writer 提供的不透明字符串");
  assert(forgedFingerprintVerdict.protocolIssues.includes("cohort_fingerprint_mismatch"));
  const wrongRubricEvents = JSON.parse(JSON.stringify(formalPassEvents));
  const wrongRubricDigest = sha256Text("wrong-case-rubric");
  const wrongRubricAttemptFingerprint = deriveLiveAttemptFingerprint({
    cohortFingerprint: formalCohortFingerprint,
    caseRef: wrongRubricEvents[0].caseRef,
    fixtureRef: wrongRubricEvents[0].fixtureRef,
    instructionDigest: wrongRubricEvents[0].instructionDigest,
    rubricDigest: wrongRubricDigest,
    liveRunProtocol: wrongRubricEvents[0].liveRunProtocol,
    repeatIndex: wrongRubricEvents[0].repeatIndex
  });
  for (const event of wrongRubricEvents) {
    event.rubricDigest = wrongRubricDigest;
    event.attemptFingerprint = wrongRubricAttemptFingerprint;
  }
  assert.strictEqual(
    evaluateOfficialAttemptEligibility(formalPassInput.attemptId, wrongRubricEvents, formalSuite).valid,
    false,
    "Attempt 即使内部自洽，也必须与当前 Case 权威 Rubric 摘要一致"
  );
  const unknownWriteEvents = formalAttemptEvents({
    ...formalPassInput,
    attemptId: "attempt-unknown-write-reconciled",
    status: "submission_unknown_write_state",
    runObservationId: undefined
  });
  unknownWriteEvents.push({
    ...unknownWriteEvents[2],
    eventId: "attempt-unknown-write-reconciled:4:reconciled",
    sequence: 4,
    eventType: "reconciled",
    occurredAt: "2026-08-26T00:00:04.000Z",
    status: "reconciled_after_runtime_restart",
    priorStatus: "submission_unknown_write_state"
  });
  const unknownWriteCoverage = buildLiveAttemptCoverage(
    unknownWriteEvents,
    [],
    formalSuite,
    []
  ).byCohort["cohort-formal-denominator"];
  assert.strictEqual(unknownWriteCoverage.protocolValid, true,
    "身份一致的 reconciliation 应能闭合事件协议");
  assert.strictEqual(unknownWriteCoverage.unknownWriteStateCount, 1,
    "reconciliation 只解除未来运行阻塞，不能抹掉本 Attempt 曾发生 unknown-write 的安全事故");
  assert.strictEqual(isOfficialAttemptCohortReady(unknownWriteCoverage), false);

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
    && buildPreflightSource.includes("attemptSafetyLedger.unresolvedAttemptCount === 0")
    && buildPreflightSource.includes("TASK_FAMILIES.every"),
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
  assert.strictEqual(fullSuite.cases.filter((item) => item.status === "active").length, 5,
    "正式 Suite 应包含主图、unseen 主图、详情页、自主 SKU 与真实参考复刻五个 active Case");
  assert.strictEqual(fullSuite.cases.filter((item) => item.status === "draft").length, 1,
    "SKU 交互协议在 actor/receipt 完成前只能保留一个 draft Case");
  assert(designReliabilityCliSource.includes(
    "dispatchProtocol: dispatchAutonomousZeroCorrectionProtocol"
  )
    && designReliabilityCliSource.includes("actorCapability.dispatchProtocol({")
    && designReliabilityCliSource.includes("validateLiveActorDispatchResult(")
    && designReliabilityCliSource.includes(
      "交互协议必须由专用私有评测 dispatcher 完整实现后才能注册"
    )
    && !designReliabilityCliSource.includes("typeof capability.resolvePrivateEvaluation")
    && !designReliabilityCliSource.includes("typeof capability.verifyInteractionReceipts")
    && !designReliabilityCliSource.includes("typeof capability.deriveInteractionMetrics"),
  "live actor 必须以一个真实执行且验证完整协议的 dispatcher 注册，不能用 metadata 或分散的 no-op hooks 解锁");
  assert.strictEqual(fullSuiteInputDigestsAreFrozen(fullSuite.cases), true,
    "Suite 中所有源文件与 Agent 可见参考都必须冻结真实 SHA-256");
  await assert.rejects(
    () => runLiveCase(fullSuite, parseArgs([
      "node",
      "design-reliability.cjs",
      "run-live",
      "--case",
      caseSpec.caseId,
      "--provider",
      "provider-a",
      "--model",
      "model-a",
      "--repeat",
      "0",
      "--live",
      "--allow-photoshop-write"
    ])),
    /repeat 必须是正整数.*不会检查 fixture/,
    "无效 repeatIndex 必须在 fixture、网络或 Photoshop 检查之前失败关闭"
  );
  await assert.rejects(
    () => runLiveCase(fullSuite, parseArgs([
      "node",
      "design-reliability.cjs",
      "run-live",
      "--case",
      interactiveSkuCase.caseId,
      "--provider",
      "provider-a",
      "--model",
      "model-a",
      "--live",
      "--allow-photoshop-write"
    ])),
    /只允许 active Case/,
    "尚无 dev user actor 的交互 Case 必须在任何 fixture 或 Photoshop 检查前拒绝 live"
  );
  const accidentallyActivatedInteractionCase = JSON.parse(JSON.stringify(interactiveSkuCase));
  accidentallyActivatedInteractionCase.status = "active";
  accidentallyActivatedInteractionCase.revision += 1;
  accidentallyActivatedInteractionCase.caseDigest = buildCaseDigest(accidentallyActivatedInteractionCase);
  await assert.rejects(
    () => runLiveCase({
      ...fullSuite,
      cases: fullSuite.cases.map((item) => (
        item.caseId === accidentallyActivatedInteractionCase.caseId
          ? accidentallyActivatedInteractionCase
          : item
      ))
    }, parseArgs([
      "node",
      "design-reliability.cjs",
      "run-live",
      "--case",
      accidentallyActivatedInteractionCase.caseId,
      "--provider",
      "provider-a",
      "--model",
      "model-a",
      "--live",
      "--allow-photoshop-write"
    ])),
    /evaluator actor capability/,
    "交互 Case 即使被误改 active，也必须因 actor capability 未注册在 fixture/Photoshop 前失败关闭"
  );

  const interactionFixtureTempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "designecho-interaction-fixture-"));
  const interactionFixtureSource = path.join(interactionFixtureTempRoot, "source");
  const interactionFixtureDestination = path.join(interactionFixtureTempRoot, "destination");
  const interactionFixtureReports = path.join(interactionFixtureTempRoot, "reports");
  const interactionFixtureCase = JSON.parse(JSON.stringify(interactiveSkuCase));
  for (const input of interactionFixtureCase.task.agentVisibleInputs) {
    const sourcePath = path.join(interactionFixtureSource, ...input.ref.split("/"));
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, `color-source:${input.ref}`, "utf8");
    input.digest = `sha256:${crypto.createHash("sha256")
      .update(fs.readFileSync(sourcePath)).digest("hex")}`;
  }
  interactionFixtureCase.revision += 1;
  interactionFixtureCase.caseDigest = buildCaseDigest(interactionFixtureCase);
  try {
    prepareFixture(
      { manifest: fullSuite.manifest, cases: [interactionFixtureCase] },
      parseArgs([
        "node",
        "design-reliability.cjs",
        "prepare-fixture",
        "--case",
        interactionFixtureCase.caseId,
        "--source-root",
        interactionFixtureSource,
        "--destination",
        interactionFixtureDestination,
        "--allow-create"
      ]),
      interactionFixtureReports
    );
    const fixtureText = fs.readdirSync(interactionFixtureDestination, { recursive: true })
      .map(String)
      .filter((relativeRef) => {
        const filePath = path.join(interactionFixtureDestination, relativeRef);
        return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
      })
      .map((relativeRef) => fs.readFileSync(path.join(interactionFixtureDestination, relativeRef), "utf8"))
      .join("\n");
    assert(!fixtureText.includes('"combos"')
      && !JSON.stringify(interactionFixtureCase).includes('"combos"'),
    "evaluator 私有用户组合答案不能进入公开 Case 或 fixture");
  } finally {
    fs.rmSync(interactionFixtureTempRoot, { recursive: true, force: true });
  }
  const runSubjectTempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "designecho-attribution-subject-"));
  const runSubjectPath = path.join(runSubjectTempRoot, "run.json");
  fs.writeFileSync(runSubjectPath, `${JSON.stringify(passing, null, 2)}\n`, "utf8");
  try {
    assert.deepStrictEqual(
      resolveAttributionCliSubject(fullSuite, parseArgs([
        "node",
        "design-reliability.cjs",
        "record-attribution",
        "--run-observation",
        runSubjectPath
      ])).subject,
      { runObservationId: passing.runObservationId },
      "CLI 必须把合法当前 Run 规范化为唯一 subject union"
    );
    assert.throws(
      () => resolveAttributionCliSubject(fullSuite, parseArgs([
        "node",
        "design-reliability.cjs",
        "record-attribution",
        "--run-observation",
        runSubjectPath,
        "--attempt-id",
        "attempt-mixed"
      ])),
      /必须且只能提供/,
      "CLI 不能同时接受 Run 与 Attempt 两个归因身份"
    );
  } finally {
    fs.rmSync(runSubjectTempRoot, { recursive: true, force: true });
  }

  const currentAttemptId = "attempt-current-without-run";
  const currentAttemptAttribution = {
    ...attemptAttribution,
    attributionId: "current-attempt-provider-failure",
    subject: { attemptId: currentAttemptId }
  };
  const currentAttemptSeedEvents = formalAttemptEvents({
    attemptId: currentAttemptId,
    caseSpec,
    fixtureInstanceId: "fixture-current-without-run",
    fixtureDigest: `sha256:${"4".repeat(64)}`,
    status: "provider_failed"
  });
  const currentSuiteCaseSetDigest = buildSuiteCaseSetDigest(fullSuite);
  const currentSuiteRubricSetDigest = buildSuiteRubricSetDigest(fullSuite);
  const currentCohortFingerprint = deriveLiveCohortFingerprint({
    suiteId: fullSuite.manifest.suiteId,
    suiteCaseSetDigest: currentSuiteCaseSetDigest,
    suiteRubricSetDigest: currentSuiteRubricSetDigest,
    environment: formalRuntimeEnvironment,
    provider: "provider-a",
    modelId: "model-a",
    timeoutMs: 900000
  });
  const currentAttemptFingerprint = deriveLiveAttemptFingerprint({
    cohortFingerprint: currentCohortFingerprint,
    caseRef: currentAttemptSeedEvents[0].caseRef,
    fixtureRef: currentAttemptSeedEvents[0].fixtureRef,
    instructionDigest: sha256Text(caseSpec.task.instruction),
    rubricDigest: buildRubricDigest(rubric),
    liveRunProtocol: currentAttemptSeedEvents[0].liveRunProtocol,
    repeatIndex: currentAttemptSeedEvents[0].repeatIndex
  });
  const currentAttemptEvents = currentAttemptSeedEvents.map((event) => ({
    ...event,
    instructionDigest: sha256Text(caseSpec.task.instruction),
    rubricDigest: buildRubricDigest(rubric),
    suiteCaseSetDigest: currentSuiteCaseSetDigest,
    suiteRubricSetDigest: currentSuiteRubricSetDigest,
    cohortFingerprint: currentCohortFingerprint,
    attemptFingerprint: currentAttemptFingerprint
  }));
  const retainedAttemptAttribution = retainContextuallyValidReviews({
    runs: [],
    reviews: [],
    attributions: [currentAttemptAttribution],
    attemptEvents: currentAttemptEvents,
    invalid: [],
    excludedEvidence: []
  }, fullSuite);
  assert.strictEqual(retainedAttemptAttribution.attributions.length, 1,
    "CLI sidecar 过滤必须保留当前 Suite 中已提交但没有 Run Observation 的 Attempt 归因");
  assert.strictEqual(retainedAttemptAttribution.excludedEvidence.length, 0);
  assert.strictEqual(
    evaluateAttributableAttemptEvents(currentAttemptId, currentAttemptEvents, fullSuite).valid,
    true
  );
  const duplicateTerminalAttemptEvents = [
    ...currentAttemptEvents,
    {
      ...currentAttemptEvents[2],
      eventId: `${currentAttemptId}:4:terminal`,
      sequence: 4,
      occurredAt: "2026-08-26T00:00:04.000Z"
    }
  ];
  const invalidatedAttemptAttribution = retainContextuallyValidReviews({
    runs: [],
    reviews: [],
    attributions: [currentAttemptAttribution],
    attemptEvents: duplicateTerminalAttemptEvents,
    invalid: [],
    excludedEvidence: []
  }, fullSuite);
  assert.strictEqual(invalidatedAttemptAttribution.attributions.length, 0,
    "归因创建后 Attempt 若出现重复 terminal 或协议漂移，汇总必须撤销其当前有效归因资格");
  assert.strictEqual(invalidatedAttemptAttribution.excludedEvidence.some((item) => (
    item.id === currentAttemptAttribution.attributionId
    && item.reason === "bound_attempt_not_current"
  )), true);
  assert.strictEqual(fullSuite.manifest.liveRunPolicy.timeoutMs, 2100000,
    "正式实机采集必须由 Suite 固定质量优先 timeout，并给 30 分钟 Agent 预算保留终态结算窗口");
  const unseenMainImageCase = fullSuite.cases.find((item) => (
    item.caseId === "main-image-pink-coffee-unseen-v1"
  ));
  assert.strictEqual(unseenMainImageCase?.oracle?.outputContract?.canvasAuthority, "runtime_setting",
    "未在自然需求中写尺寸的主图 Case 必须绑定当前用户可见主图设置");
  const longestCreativeSoftTimeBudgetMs = Math.max(
    MAIN_IMAGE_MANIFEST.performance_profile.budget.soft_time_budget_ms,
    DETAIL_PAGE_MANIFEST.performance_profile.budget.soft_time_budget_ms
  );
  assert(fullSuite.manifest.liveRunPolicy.timeoutMs - longestCreativeSoftTimeBudgetMs >= 300000,
    "外层正式采集 timeout 必须比最长创意 Agent 软预算至少多 5 分钟，避免终态与取消竞态");
  assert(fullSuite.manifest.liveRunPolicy.timeoutMs <= MAX_DEBUG_BRIDGE_CHAT_TIMEOUT_MS,
    "Suite timeout 不得超过三端 Debug Bridge 共同硬上限");
  assert.strictEqual(
    resolveLiveRunTimeout(fullSuite.manifest, parseArgs([
      "node",
      "design-reliability.cjs",
      "run-live"
    ])),
    2100000,
    "CLI 未显式覆盖时必须使用 Suite timeout，不能回落到隐藏的五分钟默认值"
  );
  assert.strictEqual(
    resolveLiveRunTimeout(fullSuite.manifest, parseArgs([
      "node",
      "design-reliability.cjs",
      "run-live",
      "--timeout-ms",
      "2100000"
    ])),
    2100000,
    "显式 timeout 只有与 Suite policy 完全一致时才可接受"
  );
  assert.throws(
    () => resolveLiveRunTimeout(fullSuite.manifest, parseArgs([
      "node",
      "design-reliability.cjs",
      "run-live",
      "--timeout-ms",
      "300000"
    ])),
    /与 Suite 固定质量优先值 2100000ms 不一致/,
    "旧五分钟覆盖不得静默形成另一个 cohort"
  );
  assert.throws(
    () => resolveLiveRunTimeout(fullSuite.manifest, parseArgs([
      "node",
      "design-reliability.cjs",
      "run-live",
      "--timeout-ms",
      "not-a-number"
    ])),
    /必须是与 Suite 固定策略一致的整数/,
    "非法 timeout 不能被兜底为 Suite 值并伪装成有效请求"
  );
  assert.throws(
    () => resolveLiveRunTimeout({ ...fullSuite.manifest, liveRunPolicy: undefined }, parseArgs([
      "node",
      "design-reliability.cjs",
      "run-live"
    ])),
    /liveRunPolicy\.timeoutMs 非法/,
    "Suite 缺失 timeout policy 时不能启动正式采集"
  );
  assert.throws(
    () => resolveLiveRunTimeout({
      ...fullSuite.manifest,
      liveRunPolicy: { ...fullSuite.manifest.liveRunPolicy, timeoutMs: 0 }
    }, parseArgs([
      "node",
      "design-reliability.cjs",
      "run-live"
    ])),
    /liveRunPolicy\.timeoutMs 非法/,
    "Suite 非法 timeout policy 不能被 CLI 默认值掩盖"
  );
  const invalidAnchorRubric = JSON.parse(JSON.stringify(readRubric()));
  invalidAnchorRubric.scoreAnchorValues.strong = 0.8;
  assert.strictEqual(validateRubric(invalidAnchorRubric).ok, false,
    "Rubric 的数值锚点必须全套固定，不能只靠四段描述自行漂移");
  assert(fullSuite.cases.every((suiteCase) => {
    const rubric = fullSuite.rubrics.find((item) => item.rubricId === suiteCase.oracle?.rubricId);
    return rubric && rubric.taskFamily === suiteCase.taskFamily;
  }), "Suite 中 Case 与其 Rubric 的 taskFamily 必须逐项一致");
  const referenceFixtureTempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "designecho-reference-fixture-"));
  const referenceFixtureSource = path.join(referenceFixtureTempRoot, "source");
  const referenceFixtureDestination = path.join(referenceFixtureTempRoot, "destination");
  const referenceFixtureReports = path.join(referenceFixtureTempRoot, "reports");
  const visibleReferencePath = path.join(
    referenceFixtureSource,
    ...referenceReplicationCase.task.agentVisibleReferences[0].ref.split("/")
  );
  fs.mkdirSync(path.dirname(visibleReferencePath), { recursive: true });
  fs.writeFileSync(visibleReferencePath, "agent-visible-reference", "utf8");
  const hiddenReferenceDecoyPath = path.join(referenceFixtureSource, "隐藏评审锚点.png");
  fs.writeFileSync(hiddenReferenceDecoyPath, "review-only", "utf8");
  try {
    const preparedReferenceFixture = prepareFixture(
      { manifest: fullSuite.manifest, cases: [referenceReplicationCase] },
      parseArgs([
        "node",
        "design-reliability.cjs",
        "prepare-fixture",
        "--case",
        referenceReplicationCase.caseId,
        "--source-root",
        referenceFixtureSource,
        "--destination",
        referenceFixtureDestination,
        "--allow-create"
      ]),
      referenceFixtureReports
    );
    assert.strictEqual(preparedReferenceFixture.report.copiedFileCount, 1,
      "reference_replication fixture 只复制用户明确给 Agent 的参考");
    assert.strictEqual(fs.existsSync(path.join(
      referenceFixtureDestination,
      ...referenceReplicationCase.task.agentVisibleReferences[0].ref.split("/")
    )), true);
    assert.strictEqual(fs.existsSync(path.join(referenceFixtureDestination, "隐藏评审锚点.png")), false,
      "review-only 锚点不能进入 Agent 项目");
    const copiedVisibleReferencePath = path.join(
      referenceFixtureDestination,
      ...referenceReplicationCase.task.agentVisibleReferences[0].ref.split("/")
    );
    fs.writeFileSync(copiedVisibleReferencePath, "changed-reference", "utf8");
    const changedReferenceInspection = inspectFixture(
      [referenceReplicationCase],
      referenceFixtureDestination
    );
    assert.strictEqual(changedReferenceInspection.ready, false,
      "Agent 可见目标参考内容变化后不得继续沿用 Case 中冻结的参考身份");
    assert.deepStrictEqual(
      changedReferenceInspection.digestMismatches.map((item) => item.ref),
      [referenceReplicationCase.task.agentVisibleReferences[0].ref]
    );
  } finally {
    fs.rmSync(referenceFixtureTempRoot, { recursive: true, force: true });
  }
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
  const currentCase = JSON.parse(JSON.stringify(
    fullSuite.cases.find((item) => item.caseId === caseSpec.caseId)
  ));
  const generatedFixtureTempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "designecho-generated-fixture-"));
  const generatedFixtureSource = path.join(generatedFixtureTempRoot, "source");
  const generatedFixtureDestination = path.join(generatedFixtureTempRoot, "destination");
  const generatedFixtureReports = path.join(generatedFixtureTempRoot, "reports");
  fs.mkdirSync(generatedFixtureSource, { recursive: true });
  for (const input of currentCase.task.agentVisibleInputs) {
    const sourcePath = path.join(generatedFixtureSource, ...input.ref.replace(/\\/g, "/").split("/"));
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, `fixture:${input.ref}`, "utf8");
    input.digest = `sha256:${crypto.createHash("sha256")
      .update(fs.readFileSync(sourcePath)).digest("hex")}`;
  }
  currentCase.revision += 1;
  currentCase.caseDigest = buildCaseDigest(currentCase);
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

    const metadataDir = path.join(generatedFixtureDestination, ".designecho");
    const metadataPath = path.join(metadataDir, "project.json");
    fs.mkdirSync(metadataDir, { recursive: true });
    const validProjectMetadata = {
      version: "1.0",
      createdAt: "2026-08-27T00:00:00.000Z",
      lastOpenedAt: "2026-08-27T00:00:00.000Z",
      projectPath: generatedFixtureDestination,
      projectName: path.basename(generatedFixtureDestination),
      folderMappings: {},
      imageClassifications: {},
      designPlan: {
        mainImage: { status: "pending" },
        sku: { status: "pending" },
        detail: { status: "pending" }
      }
    };
    fs.writeFileSync(metadataPath, `${JSON.stringify(validProjectMetadata, null, 2)}\n`, "utf8");
    const controlledMetadataInspection = inspectFixture(
      [currentCase],
      generatedFixtureDestination
    );
    assert.strictEqual(controlledMetadataInspection.freshRunReady, true,
      "合法且绑定当前 fixture 根的 project.json 不得阻断独立样本");
    assert.strictEqual(controlledMetadataInspection.workspaceMetadata.ready, true);
    assert.strictEqual(
      controlledMetadataInspection.fixtureDigest,
      preparedInspection.fixtureDigest,
      "Workspace metadata 不能改变冻结输入摘要或 fixture instance 身份"
    );
    assert.notStrictEqual(
      controlledMetadataInspection.workspaceMetadata.semanticDigest,
      preparedInspection.workspaceMetadata.semanticDigest,
      "会影响 Agent 判断的项目分类与设计状态必须形成独立语义摘要"
    );
    fs.writeFileSync(metadataPath, `${JSON.stringify({
      ...validProjectMetadata,
      lastOpenedAt: "2026-08-27T00:01:00.000Z"
    }, null, 2)}\n`, "utf8");
    const timestampOnlyInspection = inspectFixture([currentCase], generatedFixtureDestination);
    assert.strictEqual(
      timestampOnlyInspection.workspaceMetadata.semanticDigest,
      controlledMetadataInspection.workspaceMetadata.semanticDigest,
      "lastOpenedAt 等易变字段不能制造假样本漂移"
    );
    fs.writeFileSync(metadataPath, `${JSON.stringify({
      ...validProjectMetadata,
      designPlan: {
        ...validProjectMetadata.designPlan,
        mainImage: { status: "done" }
      }
    }, null, 2)}\n`, "utf8");
    const changedSemanticInspection = inspectFixture([currentCase], generatedFixtureDestination);
    assert.notStrictEqual(
      changedSemanticInspection.workspaceMetadata.semanticDigest,
      controlledMetadataInspection.workspaceMetadata.semanticDigest,
      "不同 designPlan 或素材语义状态不能混进同一正式 cohort"
    );

    fs.writeFileSync(metadataPath, `${JSON.stringify({
      ...validProjectMetadata,
      projectPath: generatedFixtureSource
    }, null, 2)}\n`, "utf8");
    const forgedRootInspection = inspectFixture([currentCase], generatedFixtureDestination);
    assert.strictEqual(forgedRootInspection.freshRunReady, false,
      "project.json 声称属于另一个项目根时必须拒绝");
    assert(forgedRootInspection.workspaceMetadata.errors.includes("project_metadata_root_mismatch"));

    fs.writeFileSync(metadataPath, `${JSON.stringify({
      ...validProjectMetadata,
      ignoreEverythingUnderDesignecho: true
    }, null, 2)}\n`, "utf8");
    const forgedSchemaInspection = inspectFixture([currentCase], generatedFixtureDestination);
    assert.strictEqual(forgedSchemaInspection.freshRunReady, false,
      "伪造字段不能把 project.json 变成目录级忽略开关");
    assert(forgedSchemaInspection.workspaceMetadata.errors.includes("project_metadata_schema_invalid"));

    fs.writeFileSync(metadataPath, `${JSON.stringify({
      ...validProjectMetadata,
      folderMappings: { S82646: "pretend_fixture_is_clean" }
    }, null, 2)}\n`, "utf8");
    const invalidEnumInspection = inspectFixture([currentCase], generatedFixtureDestination);
    assert.strictEqual(invalidEnumInspection.freshRunReady, false,
      "project.json 中无效分类枚举必须按 schema 失败");
    assert(invalidEnumInspection.workspaceMetadata.errors.includes("project_metadata_schema_invalid"));

    fs.writeFileSync(metadataPath, `${JSON.stringify(validProjectMetadata, null, 2)}\n`, "utf8");
    fs.writeFileSync(path.join(metadataDir, "design-state.json"), "{}\n", "utf8");
    fs.mkdirSync(path.join(metadataDir, "runs"), { recursive: true });
    fs.writeFileSync(path.join(metadataDir, "runs", "run-stale.json"), "{}\n", "utf8");
    const oldOutputDir = path.join(generatedFixtureDestination, "主图");
    fs.mkdirSync(oldOutputDir, { recursive: true });
    fs.writeFileSync(path.join(oldOutputDir, "旧成稿.psd"), "stale", "utf8");
    fs.writeFileSync(path.join(oldOutputDir, "旧导出.jpg"), "stale", "utf8");
    const pollutedWorkspaceInspection = inspectFixture([currentCase], generatedFixtureDestination);
    assert.strictEqual(pollutedWorkspaceInspection.freshRunReady, false,
      "受控 project.json 不能扩张成对 .designecho、旧 PSD 或输出目录的笼统忽略");
    assert.deepStrictEqual(pollutedWorkspaceInspection.unexpected, [
      ".designecho/design-state.json",
      ".designecho/runs/run-stale.json",
      "主图/旧导出.jpg",
      "主图/旧成稿.psd"
    ]);
  } finally {
    fs.rmSync(generatedFixtureTempRoot, { recursive: true, force: true });
  }
  const currentSuiteCase = fullSuite.cases.find((item) => item.caseId === caseSpec.caseId);
  const currentContextBase = {
    ...formalAttemptEvents(formalPassInput)[0],
    caseRef: {
      caseId: currentSuiteCase.caseId,
      revision: currentSuiteCase.revision,
      caseDigest: currentSuiteCase.caseDigest
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
  const inactiveCase = inactiveSuite.cases.find((item) => item.caseId === currentSuiteCase.caseId);
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
  const unknownAttemptVersionRoot = fs.mkdtempSync(path.join(os.tmpdir(), "designecho-unknown-attempt-version-"));
  try {
    fs.writeFileSync(
      path.join(unknownAttemptVersionRoot, "future-event.json"),
      `${JSON.stringify({ version: "design-reliability-attempt-event/v99" }, null, 2)}\n`,
      "utf8"
    );
    const unknownVersionSidecars = collectSidecars(
      [unknownAttemptVersionRoot],
      { strictAttemptEvents: true }
    );
    assert.strictEqual(unknownVersionSidecars.invalid[0]?.kind, "attempt_event");
    assert.match(
      unknownVersionSidecars.invalid[0]?.errors?.[0] || "",
      /只能包含受支持的 Attempt event/,
      "canonical Attempt 目录中的未知版本不能被静默跳过"
    );
  } finally {
    fs.rmSync(unknownAttemptVersionRoot, { recursive: true, force: true });
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
  const attemptAttributionReport = buildDesignReliabilityCohortReport({
    suiteId: caseSpec.suiteId,
    cohortId: "candidate",
    cases: [caseSpec],
    rubrics: [rubric],
    runs: [passing],
    reviews: [],
    attributions: [attemptAttribution],
    attemptIds: ["attempt-without-run-observation"]
  });
  assert.strictEqual(attemptAttributionReport.attribution.confirmedCount, 1,
    "没有 Run Observation 的提交失败归因必须进入所属 cohort，而不是从报告里消失");
  assert.deepStrictEqual(attemptAttributionReport.attribution.bySubjectKind, {
    run_observation: 0,
    attempt: 1
  });

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

  function metricRate(numerator, denominator) {
    return {
      numerator,
      denominator,
      value: denominator > 0 ? Math.round((numerator / denominator) * 10000) / 10000 : null
    };
  }

  function reshapeRunAggregate(aggregate, runs, technical, strictReviewed, usable) {
    aggregate.runs = runs;
    aggregate.reliability.technicalDeliveryRate = metricRate(technical, runs);
    aggregate.quality.strictHumanReviewedRate = metricRate(strictReviewed, runs);
    aggregate.quality.humanPassRate = metricRate(usable, strictReviewed);
    aggregate.quality.humanUsableRate = metricRate(usable, runs);
    aggregate.quality.weightedOverall.count = strictReviewed;
    aggregate.quality.pairwiseComparableOrBetterRate = metricRate(usable, strictReviewed);
    for (const distributionValue of Object.values(aggregate.quality.dimensionScores || {})) {
      distributionValue.count = strictReviewed;
    }
  }

  function withComparableAttemptShape(inputReport, technicalValue, commercialValue) {
    const shaped = JSON.parse(JSON.stringify(inputReport));
    const caseIds = Object.keys(shaped.byCase);
    const submittedPerCase = 5;
    const submitted = caseIds.length * submittedPerCase;
    const technicalPassedPerCase = Math.round(submittedPerCase * technicalValue);
    const commercialUsablePerCase = Math.round(submittedPerCase * commercialValue);
    const technicalPassed = technicalPassedPerCase * caseIds.length;
    const commercialUsable = commercialUsablePerCase * caseIds.length;
    shaped.selector.comparisonControlProfiles = [{
      provider: "provider-a",
      modelId: "model-a",
      timeoutMs: 900000
    }];
    shaped.selector.minimumDesignQualityReviewedRunsPerCase = 4;
    shaped.selector.fixtureDigestsByCase = Object.fromEntries(caseIds.map((caseId, index) => [
      caseId,
      [sha256Text(`fixture-identity-${index}`)]
    ]));
    shaped.attempts = {
      submitted,
      homogeneous: true,
      protocolValid: true,
      allSubmittedAttemptsTerminal: true,
      unknownWriteStateCount: 0,
      strictReviewConflictCount: 0,
      fixtureIdentityReady: true,
      controlProfileCount: 1,
      interactionMetricsKnownCount: submitted,
      technicalDeliveryPassed: technicalPassed,
      strictReviewedTechnicalPasses: technicalPassed,
      commercialUsable,
      strictReviewCoverageOfTechnicalPasses: {
        numerator: technicalPassed,
        denominator: technicalPassed,
        value: technicalPassed > 0 ? 1 : null
      },
      technicalDeliveryRate: {
        numerator: technicalPassed,
        denominator: submitted,
        value: technicalValue
      },
      commercialUsableRate: {
        numerator: commercialUsable,
        denominator: submitted,
        value: commercialValue
      },
      byCase: Object.fromEntries(caseIds.map((caseId) => [caseId, {
        submitted: submittedPerCase,
        technicalDeliveryPassed: technicalPassedPerCase,
        strictReviewedTechnicalPasses: technicalPassedPerCase,
        commercialUsable: commercialUsablePerCase,
        interactionMetricsKnown: submittedPerCase
      }])),
      byTaskFamily: {
        main_image: {
          submitted,
          technicalDeliveryPassed: technicalPassed,
          strictReviewedTechnicalPasses: technicalPassed,
          commercialUsable,
          interactionMetricsKnown: submitted
        }
      },
      submittedRepeatIndexesByCase: Object.fromEntries(caseIds.map((caseId) => [
        caseId,
        [1, 2, 3, 4, 5]
      ]))
    };
    reshapeRunAggregate(
      shaped.overall,
      technicalPassed,
      technicalPassed,
      technicalPassed,
      commercialUsable
    );
    for (const caseId of caseIds) {
      reshapeRunAggregate(
        shaped.byCase[caseId],
        technicalPassedPerCase,
        technicalPassedPerCase,
        technicalPassedPerCase,
        commercialUsablePerCase
      );
    }
    for (const familyAggregate of Object.values(shaped.byTaskFamily)) {
      reshapeRunAggregate(
        familyAggregate,
        technicalPassed,
        technicalPassed,
        technicalPassed,
        commercialUsable
      );
    }
    shaped.coverage.runs = technicalPassed;
    return shaped;
  }
  const comparableBaseline = withComparableAttemptShape(officialAnonymousReport, 0.8, 0.6);
  const comparableCandidate = withComparableAttemptShape(officialAnonymousReport, 0.2, 0.2);
  comparableCandidate.cohortId = "candidate-regressed";
  comparableCandidate.overall.reliability.technicalDeliveryRate = {
    numerator: 1,
    denominator: 1,
    value: 1
  };
  const attemptDenominatorComparison = compareDesignReliabilityCohorts(
    comparableBaseline,
    comparableCandidate
  );
  assert.strictEqual(attemptDenominatorComparison.comparable, false,
    "每 Case 只有一个幸存成稿时不能形成正式设计质量比较");
  assert.strictEqual(attemptDenominatorComparison.technicalDiagnosticComparable, true);
  assert.strictEqual(attemptDenominatorComparison.technicalDeltas.technicalDeliveryRate, -0.6,
    "技术诊断仍必须使用全部 submitted Attempt 分母，不能让唯一幸存 Run 的 100% 掩盖真实回退");

  const allFailedBaseline = withComparableAttemptShape(officialAnonymousReport, 0, 0);
  const allFailedCandidate = withComparableAttemptShape(officialAnonymousReport, 0, 0);
  allFailedCandidate.cohortId = "candidate-all-failed";
  const allFailedComparison = compareDesignReliabilityCohorts(allFailedBaseline, allFailedCandidate);
  assert.strictEqual(allFailedComparison.comparable, false);
  assert.strictEqual(allFailedComparison.technicalDiagnosticComparable, true);
  assert.strictEqual(allFailedComparison.designQualityComparable, false,
    "全部 Attempt 失败且零盲评时只能比较技术失败率，不能生成设计质量结论");

  const mixedFixtureIdentity = JSON.parse(JSON.stringify(comparableBaseline));
  mixedFixtureIdentity.selector.fixtureDigestsByCase[caseSpec.caseId].push(sha256Text("second-fixture"));
  assert.strictEqual(
    compareDesignReliabilityCohorts(comparableBaseline, mixedFixtureIdentity).technicalDiagnosticComparable,
    false,
    "同一 Case 混入两个 fixture 语义身份时不能比较"
  );

  const impossibleAttemptArithmetic = JSON.parse(JSON.stringify(comparableBaseline));
  impossibleAttemptArithmetic.attempts.technicalDeliveryPassed = 10;
  impossibleAttemptArithmetic.attempts.strictReviewedTechnicalPasses = 10;
  impossibleAttemptArithmetic.attempts.commercialUsable = 10;
  impossibleAttemptArithmetic.attempts.technicalDeliveryRate = { numerator: 10, denominator: 5, value: 2 };
  impossibleAttemptArithmetic.attempts.commercialUsableRate = { numerator: 10, denominator: 5, value: 2 };
  impossibleAttemptArithmetic.attempts.strictReviewCoverageOfTechnicalPasses = {
    numerator: 10,
    denominator: 10,
    value: 1
  };
  assert.strictEqual(
    compareDesignReliabilityCohorts(comparableBaseline, impossibleAttemptArithmetic)
      .technicalDiagnosticComparable,
    false,
    "成功数大于提交数或与逐 Case/逐任务族算术不一致时必须拒绝比较"
  );

  const differentCaseSet = JSON.parse(JSON.stringify(comparableBaseline));
  differentCaseSet.selector.caseSetDigest = `sha256:${"d".repeat(64)}`;
  assert.strictEqual(compareDesignReliabilityCohorts(comparableBaseline, differentCaseSet).comparable, false);
  const differentRubricSet = JSON.parse(JSON.stringify(comparableBaseline));
  differentRubricSet.selector.rubricSetDigest = `sha256:${"e".repeat(64)}`;
  assert.strictEqual(compareDesignReliabilityCohorts(comparableBaseline, differentRubricSet).comparable, false,
    "Rubric 内容身份不同的 cohort 禁止直接比较");
  const differentModelControl = JSON.parse(JSON.stringify(comparableBaseline));
  differentModelControl.selector.comparisonControlProfiles = [{
    provider: "provider-a",
    modelId: "model-b",
    timeoutMs: 900000
  }];
  assert.strictEqual(compareDesignReliabilityCohorts(comparableBaseline, differentModelControl).comparable, false,
    "Provider、模型或 timeout 不同的 cohort 不能归因给代码治理效果");
  const differentRepeatCoverage = JSON.parse(JSON.stringify(comparableCandidate));
  differentRepeatCoverage.attempts.submitted = 4;
  differentRepeatCoverage.attempts.byCase[caseSpec.caseId].submitted = 4;
  differentRepeatCoverage.attempts.submittedRepeatIndexesByCase[caseSpec.caseId] = [1, 2, 3, 4];
  assert.strictEqual(
    compareDesignReliabilityCohorts(comparableBaseline, differentRepeatCoverage).comparable,
    false,
    "逐 Case 重复次数不同的 cohort 不能比较"
  );
  const coercedDuplicateRepeatCoverage = JSON.parse(JSON.stringify(comparableBaseline));
  coercedDuplicateRepeatCoverage.attempts.submittedRepeatIndexesByCase[caseSpec.caseId] = [
    1,
    "01",
    "+1",
    "1.0",
    "1e0"
  ];
  assert.strictEqual(
    compareDesignReliabilityCohorts(comparableBaseline, coercedDuplicateRepeatCoverage)
      .technicalDiagnosticComparable,
    false,
    "repeatIndex 必须是原生正整数；不同字符串写法不能把同一次重复伪装成多个样本"
  );
  const gappedRepeatCoverage = JSON.parse(JSON.stringify(comparableBaseline));
  gappedRepeatCoverage.attempts.submittedRepeatIndexesByCase[caseSpec.caseId] = [1, 2, 3, 4, 6];
  assert.strictEqual(
    compareDesignReliabilityCohorts(comparableBaseline, gappedRepeatCoverage)
      .technicalDiagnosticComparable,
    false,
    "逐 Case repeatIndex 必须无缺口覆盖 1..submitted"
  );
  const originalTaskFamily = comparableBaseline.selector.caseTaskFamilies[caseSpec.caseId];
  const changedTaskFamily = originalTaskFamily === "sku" ? "main_image" : "sku";
  const changedTaskFamilyBinding = JSON.parse(JSON.stringify(comparableBaseline));
  changedTaskFamilyBinding.selector.caseTaskFamilies[caseSpec.caseId] = changedTaskFamily;
  changedTaskFamilyBinding.byTaskFamily[changedTaskFamily] =
    changedTaskFamilyBinding.byTaskFamily[originalTaskFamily];
  delete changedTaskFamilyBinding.byTaskFamily[originalTaskFamily];
  changedTaskFamilyBinding.attempts.byTaskFamily[changedTaskFamily] =
    changedTaskFamilyBinding.attempts.byTaskFamily[originalTaskFamily];
  delete changedTaskFamilyBinding.attempts.byTaskFamily[originalTaskFamily];
  assert.strictEqual(
    compareDesignReliabilityCohorts(comparableBaseline, changedTaskFamilyBinding)
      .technicalDiagnosticComparable,
    false,
    "相同 Case 不能在 baseline 与 candidate 间漂移到不同任务族"
  );
  const recurringRateBaseline = JSON.parse(JSON.stringify(comparableBaseline));
  const recurringRateFamily = recurringRateBaseline.selector.caseTaskFamilies[caseSpec.caseId];
  recurringRateBaseline.cohortId = "baseline-recurring-rate";
  recurringRateBaseline.selector.minimumDesignQualityReviewedRunsPerCase = 1;
  recurringRateBaseline.attempts.submitted = 3;
  recurringRateBaseline.attempts.interactionMetricsKnownCount = 3;
  recurringRateBaseline.attempts.technicalDeliveryPassed = 1;
  recurringRateBaseline.attempts.strictReviewedTechnicalPasses = 1;
  recurringRateBaseline.attempts.commercialUsable = 1;
  recurringRateBaseline.attempts.technicalDeliveryRate = metricRate(1, 3);
  recurringRateBaseline.attempts.commercialUsableRate = metricRate(1, 3);
  recurringRateBaseline.attempts.strictReviewCoverageOfTechnicalPasses = metricRate(1, 1);
  recurringRateBaseline.attempts.byCase[caseSpec.caseId] = {
    submitted: 3,
    technicalDeliveryPassed: 1,
    strictReviewedTechnicalPasses: 1,
    commercialUsable: 1,
    interactionMetricsKnown: 3
  };
  recurringRateBaseline.attempts.byTaskFamily[recurringRateFamily] = {
    submitted: 3,
    technicalDeliveryPassed: 1,
    strictReviewedTechnicalPasses: 1,
    commercialUsable: 1,
    interactionMetricsKnown: 3
  };
  recurringRateBaseline.attempts.submittedRepeatIndexesByCase[caseSpec.caseId] = [1, 2, 3];
  reshapeRunAggregate(recurringRateBaseline.overall, 1, 1, 1, 1);
  reshapeRunAggregate(recurringRateBaseline.byCase[caseSpec.caseId], 1, 1, 1, 1);
  reshapeRunAggregate(recurringRateBaseline.byTaskFamily[recurringRateFamily], 1, 1, 1, 1);
  recurringRateBaseline.coverage.runs = 1;
  const recurringRateCandidate = JSON.parse(JSON.stringify(recurringRateBaseline));
  recurringRateCandidate.cohortId = "candidate-recurring-rate";
  assert.strictEqual(
    compareDesignReliabilityCohorts(recurringRateBaseline, recurringRateCandidate).comparable,
    true,
    "报告率按四位小数规范化后，1/3 这类循环小数不能被误判为算术损坏"
  );
  const invalidAttemptProtocol = JSON.parse(JSON.stringify(comparableCandidate));
  invalidAttemptProtocol.attempts.protocolValid = false;
  assert.strictEqual(compareDesignReliabilityCohorts(comparableBaseline, invalidAttemptProtocol).comparable, false,
    "Attempt 协议损坏的 cohort 不能进入前后结论");
  assert.strictEqual(compareDesignReliabilityCohorts(comparableBaseline, comparableBaseline).comparable, true);

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

  const r38Revision = { documentId: 6145, historyStateId: 6156 };
  const r38ReviewedTarget = resolveRuntimeExecutionTarget({
    result: { success: true, documentId: r38Revision.documentId }
  });
  assert.ok(r38ReviewedTarget, "r38 形态必须能建立不透明目标身份");
  const r38ToolLog = [
    {
      callId: "mutation-call",
      name: "transformLayer",
      arguments: { documentId: r38Revision.documentId },
      result: { success: true, documentId: r38Revision.documentId }
    },
    {
      callId: "save-psd-call",
      name: "saveDocument",
      arguments: { documentId: r38Revision.documentId, format: "psd" },
      result: {
        success: true,
        documentId: r38Revision.documentId,
        savedPath: "C:\\fixture\\主图\\主图.psd",
        sourceHistoryStateRef: r38Revision
      }
    },
    {
      callId: "save-jpg-call",
      name: "saveDocument",
      arguments: { documentId: r38Revision.documentId, format: "jpg" },
      result: {
        success: true,
        documentId: r38Revision.documentId,
        savedPath: "C:\\fixture\\主图\\主图.jpg",
        sourceHistoryStateRef: r38Revision
      }
    }
  ];
  const r38DeliveryEvidence = projectAgenticFinalDeliveryEvidence({
    deliveryOutputs: ["main_image_psd", "main_image_preview"],
    requirements: [{ id: "production-delivery", label: "交付", status: "passed" }],
    toolCallLog: r38ToolLog,
    reviewedTarget: r38ReviewedTarget,
    reviewedHistoryStateRef: r38Revision
  });
  assert.deepStrictEqual(
    r38DeliveryEvidence.resultRefs,
    ["save-psd-call", "save-jpg-call"],
    "同 revision 的 saveDocument PSD + JPG 必须形成精确 E2 result refs"
  );
  const r38DebugProjection = collectAgentFinalDeliveryDebugProjection({
    entries: r38ToolLog,
    resultRefs: r38DeliveryEvidence.resultRefs,
    includeProducerReceipts: true
  });
  assert.deepStrictEqual(
    normalizeDebugFinalArtifactRefs(r38DebugProjection.paths, "C:\\fixture"),
    ["主图/主图.psd", "主图/主图.jpg"],
    "r38 producer refs 必须机械贯穿 Debug relative finalArtifactRefs"
  );
  const staleR38ToolLog = JSON.parse(JSON.stringify(r38ToolLog));
  staleR38ToolLog[2].result.sourceHistoryStateRef.historyStateId += 1;
  assert.strictEqual(
    projectAgenticFinalDeliveryEvidence({
      deliveryOutputs: ["main_image_psd", "main_image_preview"],
      requirements: [{ id: "production-delivery", label: "交付", status: "passed" }],
      toolCallLog: staleR38ToolLog,
      reviewedTarget: r38ReviewedTarget,
      reviewedHistoryStateRef: r38Revision
    }).status,
    "incomplete",
    "任一交付 revision 不匹配时不得拼接旧文件或扫描目录补造最终稿"
  );

  console.log("Design Reliability 纯逻辑验证通过：TaskRun 合并、真实 mutation、假完成、人工评审分母、发布门禁与 cohort 可比性均已覆盖。");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
