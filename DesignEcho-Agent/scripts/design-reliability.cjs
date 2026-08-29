#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { readPsd } = require("ag-psd");
const sharp = require("sharp");
const { spawnSync } = require("child_process");
const {
  buildPhotoshopRuntimeBinding,
  photoshopRuntimeBindingsMatch,
  validatePhotoshopRuntimeBinding,
  verifyPhotoshopRuntimeBuildIdentity
} = require("./lib/photoshop-runtime-build-identity.cjs");
const {
  createDesignReliabilityReviewPacket,
  verifyDesignReliabilityReviewerResponse
} = require("./lib/design-reliability-review-packet.cjs");

const {
  ATTRIBUTION_OWNERS,
  ATTRIBUTION_STATUSES,
  ATTRIBUTION_VERSION,
  COMPARISON_EVIDENCE_KINDS,
  FAILURE_MODES,
  LEGACY_REVIEW_VERSION,
  PAIRWISE_OUTCOMES,
  REVIEW_DECISIONS,
  REVIEW_VERSION,
  RUN_VERSION,
  TASK_FAMILIES,
  artifactGeometryMatchesCase,
  attributionMatchesDesignReliabilityCohort,
  buildDesignReliabilityCohortReport,
  buildDesignReliabilityGeneratedFixtureContent,
  buildDesignReliabilityLiveRunProtocolDigest,
  buildRubricDigest,
  calculateWeightedOverall,
  compareDesignReliabilityCohorts,
  deriveDesignReliabilityRunObservation,
  evaluateDesignReliabilityReleaseGates,
  resolveStrictReviewRunVerdict,
  resolveDesignReliabilityLiveRunProtocol,
  resolveDesignReliabilityAttributionSubject,
  sha256Text,
  stableStringify,
  validateAgentRunRecordChain,
  validateDesignReliabilityAttribution,
  validateDesignReliabilityCase,
  validateDesignReliabilityReview,
  validateDesignReliabilityRun
} = require("./lib/design-reliability-contract.cjs");

const ROOT = path.resolve(__dirname, "..");
const BENCHMARK_ROOT = path.join(ROOT, "benchmarks", "design-reliability");
const MANIFEST_PATH = path.join(BENCHMARK_ROOT, "suites.manifest.json");
const LEGACY_DATA_ROOT = path.join(ROOT, "tmp", "design-reliability");
const DEFAULT_DATA_ROOT = resolvePersistentDataRoot();
const CANONICAL_ATTEMPT_EVENTS_ROOT = path.join(DEFAULT_DATA_ROOT, "attempt-events");
const CANONICAL_REVIEW_BUNDLES_ROOT = path.join(DEFAULT_DATA_ROOT, "review-verification-bundles");
const OFFICIAL_REVIEW_DISK_TRUST = Symbol.for("designecho.designReliability.officialReviewDiskVerified");
const REVIEW_VERIFICATION_BUNDLE_VERSION = "design-reliability-review-verification-bundle/v1";
const DEFAULT_DEBUG_BRIDGE = "http://127.0.0.1:8767";
const DEFAULT_PHOTOSHOP_MCP_HEALTH = "http://127.0.0.1:8768/health";
const DEFAULT_PHOTOSHOP_MCP_ENDPOINT = "http://127.0.0.1:8768/mcp";
const CONTROLLED_PROJECT_METADATA_REF = ".designecho/project.json";
const PROJECT_METADATA_VERSION = "1.0";
const PROJECT_METADATA_KEYS = new Set([
  "version",
  "createdAt",
  "lastOpenedAt",
  "projectPath",
  "projectName",
  "folderMappings",
  "imageClassifications",
  "designPlan"
]);
const PROJECT_FOLDER_TYPES = new Set(["source", "psd", "mainImage", "detail", "sku", "unknown"]);
const PROJECT_IMAGE_TYPES = new Set([
  "product",
  "model",
  "detail",
  "scene",
  "package",
  "material",
  "psd",
  "design",
  "video",
  "unknown"
]);
const PROJECT_DESIGN_PLAN_KEYS = new Set(["mainImage", "sku", "detail"]);
const PROJECT_DESIGN_STATUSES = new Set(["pending", "in_progress", "done"]);
const MIN_LIVE_RUN_TIMEOUT_MS = 1000;
const MAX_LIVE_RUN_TIMEOUT_MS = 40 * 60 * 1000;
const LIVE_ATTEMPT_EVENT_VERSION = "design-reliability-attempt-event/v1";
const LIVE_RUN_ACTOR_CAPABILITIES = new Map([
  ["autonomous_zero_correction", Object.freeze({
    capabilityId: "guarded-natural-chat-submit/v1",
    protocolKind: "autonomous_zero_correction",
    receiptVersion: "debug-bridge-chat-submit-receipt/v1",
    dispatchProtocol: dispatchAutonomousZeroCorrectionProtocol
  })]
]);
const DEBUG_BRIDGE_CHAT_PREFLIGHT_VERSION = "debug-bridge-chat-preflight/v2";
const DEBUG_BRIDGE_CHAT_FAILURE_VERSION = "debug-bridge-chat-execution-failure/v1";
const SAFE_PRE_SUBMIT_STAGES = new Set([
  "bridge_preflight",
  "main_preflight",
  "renderer_preflight",
  "before_handle_send"
]);

function controlledProjectMetadataSchemaSnapshot() {
  return {
    version: PROJECT_METADATA_VERSION,
    keys: [...PROJECT_METADATA_KEYS].sort(),
    folderTypes: [...PROJECT_FOLDER_TYPES].sort(),
    imageTypes: [...PROJECT_IMAGE_TYPES].sort(),
    designPlanKeys: [...PROJECT_DESIGN_PLAN_KEYS].sort(),
    designStatuses: [...PROJECT_DESIGN_STATUSES].sort()
  };
}

function resolveLiveRunActorCapability(caseSpec) {
  const protocol = resolveDesignReliabilityLiveRunProtocol(caseSpec);
  const capability = LIVE_RUN_ACTOR_CAPABILITIES.get(protocol.kind);
  if (!capability) return undefined;
  if (capability.protocolKind !== protocol.kind
    || typeof capability.dispatchProtocol !== "function") return undefined;
  if (protocol.kind === "predeclared_user_interaction"
    && cleanString(protocol.actorCapabilityId) !== capability.capabilityId) {
    return undefined;
  }
  return capability;
}

function validateActiveCaseLiveRunActor(caseSpec) {
  if (caseSpec?.status !== "active") return { ready: false, reason: "case_not_active" };
  const protocol = resolveDesignReliabilityLiveRunProtocol(caseSpec);
  const capability = resolveLiveRunActorCapability(caseSpec);
  if (!capability) {
    return {
      ready: false,
      reason: "live_run_actor_capability_unavailable",
      protocolKind: protocol.kind,
      actorCapabilityId: cleanString(protocol.actorCapabilityId) || null
    };
  }
  return {
    ready: true,
    protocolKind: protocol.kind,
    actorCapabilityId: capability.capabilityId,
    receiptVersion: capability.receiptVersion
  };
}

function resolvePersistentDataRoot() {
  if (process.platform === "win32") {
    const appData = cleanString(process.env.APPDATA);
    const base = appData || path.join(os.homedir(), "AppData", "Roaming");
    return path.resolve(base, "designecho-agent", "design-reliability");
  }
  if (process.platform === "darwin") {
    return path.resolve(
      os.homedir(),
      "Library",
      "Application Support",
      "designecho-agent",
      "design-reliability"
    );
  }
  const xdgConfigHome = cleanString(process.env.XDG_CONFIG_HOME);
  const base = xdgConfigHome || path.join(os.homedir(), ".config");
  return path.resolve(base, "designecho-agent", "design-reliability");
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rate(numerator, denominator) {
  return {
    numerator,
    denominator,
    value: denominator > 0 ? numerator / denominator : null
  };
}

function distribution(values) {
  const sorted = (Array.isArray(values) ? values : [])
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  if (sorted.length === 0) return { count: 0, median: null, p90: null };
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
  const p90Index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1));
  return {
    count: sorted.length,
    median,
    p90: sorted[p90Index]
  };
}

function parseArgs(argv) {
  const positional = [];
  const values = new Map();
  const flags = new Set();
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      flags.add(token);
      continue;
    }
    const existing = values.get(token) || [];
    existing.push(next);
    values.set(token, existing);
    index += 1;
  }
  return {
    command: positional[0] || "help",
    positional: positional.slice(1),
    flags,
    values,
    hasFlag(name) {
      return flags.has(name);
    },
    get(name, fallback = "") {
      const entries = values.get(name);
      return entries && entries.length > 0 ? entries.at(-1) : fallback;
    },
    getAll(name) {
      return values.get(name) || [];
    }
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonExclusive(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

function ensurePrivateDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directoryPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("canonical private bundle root 必须是普通目录。 ");
  }
  if (process.platform !== "win32") fs.chmodSync(directoryPath, 0o700);
}

function hardenPrivateTree(rootPath) {
  if (process.platform === "win32" || !fs.existsSync(rootPath)) return;
  const stack = [rootPath];
  while (stack.length > 0) {
    const current = stack.pop();
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error("canonical private bundle 不能包含符号链接。 ");
    if (stat.isDirectory()) {
      fs.chmodSync(current, 0o700);
      for (const entry of fs.readdirSync(current)) stack.push(path.join(current, entry));
    } else if (stat.isFile()) {
      fs.chmodSync(current, 0o600);
    }
  }
}

function assertPrivateTreePermissions(rootPath) {
  if (process.platform === "win32") return;
  const stack = [rootPath];
  while (stack.length > 0) {
    const current = stack.pop();
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
      throw new Error("canonical private bundle 权限不是 owner-only。 ");
    }
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) stack.push(path.join(current, entry));
    }
  }
}

function writePrivateJsonExclusive(filePath, value) {
  writeJsonExclusive(filePath, value);
  if (process.platform !== "win32") fs.chmodSync(filePath, 0o600);
}

function writePreflightReport(report, dataRoot = DEFAULT_DATA_ROOT) {
  const generatedAt = cleanString(report?.generatedAt) || new Date().toISOString();
  const timestamp = generatedAt.replace(/[-:.TZ]/g, "").slice(0, 14) || "unknown-time";
  const reportId = `preflight-${timestamp}-${crypto.randomBytes(6).toString("hex")}`;
  const reportPath = resolveSidecarOutputPath(dataRoot, ["preflight"], reportId);
  writeJsonExclusive(reportPath, report);
  return reportPath;
}

function shouldPersistPreflightReport(args) {
  return Boolean(args?.hasFlag?.("--write-report"));
}

function safePathSegment(value) {
  const normalized = String(value || "").trim().replace(/[^A-Za-z0-9._-]+/g, "-");
  if (!normalized || normalized === "." || normalized === "..") return "unknown";
  return normalized;
}

function resolveSidecarOutputPath(root, directorySegments, fileId) {
  const safeSegments = (Array.isArray(directorySegments) ? directorySegments : [])
    .map(safePathSegment);
  return resolveInside(root, path.join(...safeSegments, `${safePathSegment(fileId)}.json`));
}

function buildLiveAttemptId(caseId) {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `${safePathSegment(caseId)}-attempt-${timestamp}-${crypto.randomBytes(6).toString("hex")}`;
}

function sanitizeAttemptDiagnostic(value) {
  return String(value || "")
    .split(ROOT).join("[PROJECT_ROOT]")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;"']+/ig, "$1[redacted]")
    .replace(/((?:api[_\s-]?key|(?:[a-z0-9]+[_\s-]?)?token|secret|password|credential|client[_\s-]?secret)\s*[:=]\s*)["']?[^\s,;"']+/ig, "$1[redacted]")
    .replace(/\b(?:sk|key|token)-[A-Za-z0-9_-]{12,}\b/g, "[redacted]")
    .replace(/([?&](?:api[_-]?key|(?:[a-z0-9]+[_-]?)?token|secret|password|credential|client[_-]?secret)=)[^&#\s]+/ig, "$1[redacted]")
    .replace(/file:\/{2,3}(?:[A-Za-z]:|\/)[^\r\n,;"'|)]*/ig, "[LOCAL_PATH]")
    .replace(/\\\\[^\r\n"'|,;)]+/g, "[LOCAL_PATH]")
    .replace(/[A-Za-z]:[\\/][^\r\n"'|,;)]*/g, "[LOCAL_PATH]")
    .replace(/(^|[\s("'=:])\/(?!\/)[^\r\n"'|,;)]*/g, "$1[LOCAL_PATH]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function resolveLoopbackDebugBridge(value) {
  const raw = cleanString(value) || DEFAULT_DEBUG_BRIDGE;
  let target;
  try {
    target = new URL(raw);
  } catch {
    throw new Error("--debug-bridge 必须是有效的本机 HTTP 地址。");
  }
  const hostname = target.hostname.toLowerCase();
  const loopback = hostname === "127.0.0.1"
    || hostname === "localhost"
    || hostname === "[::1]"
    || hostname === "::1";
  const pathName = target.pathname.replace(/\/+$/g, "") || "";
  if (target.protocol !== "http:"
    || !loopback
    || target.username
    || target.password
    || target.search
    || target.hash
    || pathName) {
    throw new Error("--debug-bridge 只允许无凭据、无路径的 loopback HTTP origin（127.0.0.1、localhost 或 [::1]）。");
  }
  return target.origin;
}

function classifyLiveAttemptFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|timed out|超时/i.test(message)) return "timeout_unknown_write_state";
  if (/provider|subscription|usage|quota|订阅|额度|模型服务/i.test(message)) return "provider_failed";
  if (/RunRecord|artifact|evidence|receipt|收据|证据/i.test(message)) return "evidence_incomplete";
  if (/Photoshop|UXP|文档|写入|document/i.test(message)) return "photoshop_or_document_failed";
  if (/不一致|指定提交|指定模型|指定 Provider|fixture/i.test(message)) return "submission_rejected";
  return "execution_failed";
}

function readDebugBridgeExecutionFailure(value) {
  if (!isRecord(value)) return null;
  const candidate = isRecord(value.debugBridgeFailure)
    ? value.debugBridgeFailure
    : (isRecord(value.failure) ? value.failure : null);
  if (!candidate
    || candidate.version !== DEBUG_BRIDGE_CHAT_FAILURE_VERSION
    || typeof candidate.stage !== "string"
    || typeof candidate.writePossible !== "boolean"
    || !cleanString(candidate.message)) {
    return null;
  }
  return {
    version: DEBUG_BRIDGE_CHAT_FAILURE_VERSION,
    stage: cleanString(candidate.stage),
    writePossible: candidate.writePossible === true,
    message: cleanString(candidate.message).slice(0, 500),
    ...(cleanString(candidate.code) ? { code: cleanString(candidate.code).slice(0, 120) } : {}),
    ...(cleanString(candidate.requestId)
      ? { requestId: cleanString(candidate.requestId).slice(0, 160) }
      : {})
  };
}

function readDebugBridgeFailureFromError(error) {
  if (!isRecord(error)) return null;
  return readDebugBridgeExecutionFailure(error)
    || readDebugBridgeExecutionFailure(error.debugBridgeResponse);
}

function isSafePreSubmitFailure(failure) {
  return Boolean(
    failure
    && failure.writePossible === false
    && SAFE_PRE_SUBMIT_STAGES.has(failure.stage)
  );
}

function classifyUntrustedDebugBridgeFailure(error) {
  const failure = readDebugBridgeFailureFromError(error);
  return isSafePreSubmitFailure(failure)
    ? "submission_rejected_before_execution"
    : "submission_unknown_write_state";
}

function resolveLiveRunTimeout(manifest, args) {
  const suiteTimeoutMs = manifest?.liveRunPolicy?.timeoutMs;
  if (!Number.isSafeInteger(suiteTimeoutMs)
    || suiteTimeoutMs < MIN_LIVE_RUN_TIMEOUT_MS
    || suiteTimeoutMs > MAX_LIVE_RUN_TIMEOUT_MS) {
    throw new Error("Suite liveRunPolicy.timeoutMs 非法，拒绝启动正式采集。 ");
  }
  const overrideRaw = cleanString(args?.get?.("--timeout-ms"));
  if (!overrideRaw) return suiteTimeoutMs;
  if (!/^\d+$/.test(overrideRaw)) {
    throw new Error("--timeout-ms 必须是与 Suite 固定策略一致的整数。 ");
  }
  const overrideMs = Number(overrideRaw);
  if (!Number.isSafeInteger(overrideMs) || overrideMs !== suiteTimeoutMs) {
    throw new Error(
      `--timeout-ms=${overrideRaw} 与 Suite 固定质量优先值 ${suiteTimeoutMs}ms 不一致，拒绝形成漂移 cohort。`
    );
  }
  return suiteTimeoutMs;
}

function writeLiveAttemptEvent(context, sequence, eventType, payload = {}) {
  const event = {
    version: LIVE_ATTEMPT_EVENT_VERSION,
    eventId: `${context.attemptId}:${sequence}:${eventType}`,
    attemptId: context.attemptId,
    sequence,
    eventType,
    occurredAt: new Date().toISOString(),
    caseRef: context.caseRef,
    cohortId: context.cohortId,
    repeatIndex: context.repeatIndex,
    provider: context.provider,
    modelId: context.modelId,
    timeoutMs: context.timeoutMs,
    fixtureRef: context.fixtureRef,
    environment: context.environment,
    instructionDigest: context.instructionDigest,
    rubricDigest: context.rubricDigest,
    suiteCaseSetDigest: context.suiteCaseSetDigest,
    suiteRubricSetDigest: context.suiteRubricSetDigest,
    cohortFingerprint: context.cohortFingerprint,
    attemptFingerprint: context.attemptFingerprint,
    liveRunProtocol: context.liveRunProtocol,
    ...payload,
    boundaries: {
      appendOnlyDevelopmentEvidence: true,
      neverAffectsRuntime: true,
      absolutePathsNotPersisted: true,
      rawPromptAndResponseNotPersisted: true
    }
  };
  const eventPath = path.join(
    CANONICAL_ATTEMPT_EVENTS_ROOT,
    safePathSegment(context.cohortId),
    safePathSegment(context.attemptId),
    `${String(sequence).padStart(2, "0")}-${safePathSegment(eventType)}.json`
  );
  const validation = validateLiveAttemptEvent(event);
  if (!validation.ok) {
    throw new Error(`拒绝写入无效 Attempt event：${validation.errors.join("；")}`);
  }
  writeJsonExclusive(eventPath, event);
  return { event, eventPath };
}

function buildLiveAttemptContextFromEvent(event) {
  return {
    attemptId: event.attemptId,
    caseRef: event.caseRef,
    cohortId: event.cohortId,
    repeatIndex: event.repeatIndex,
    provider: event.provider,
    modelId: event.modelId,
    timeoutMs: event.timeoutMs,
    fixtureRef: event.fixtureRef,
    environment: event.environment,
    instructionDigest: event.instructionDigest,
    rubricDigest: event.rubricDigest,
    suiteCaseSetDigest: event.suiteCaseSetDigest,
    suiteRubricSetDigest: event.suiteRubricSetDigest,
    cohortFingerprint: event.cohortFingerprint,
    attemptFingerprint: event.attemptFingerprint,
    liveRunProtocol: event.liveRunProtocol
  };
}

function resolveInside(root, relativePath) {
  const absoluteRoot = path.resolve(root);
  const absolutePath = path.resolve(absoluteRoot, relativePath);
  const relative = path.relative(absoluteRoot, absolutePath);
  if (!relative || relative === ".") return absolutePath;
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`路径越出允许根目录：${relativePath}`);
  }
  return absolutePath;
}

function isPathInside(parentPath, childPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function normalizeRelativePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

function isUnsafeProjectRelativeRef(value) {
  const normalized = normalizeRelativePath(value).trim();
  return !normalized
    || normalized.includes("\0")
    || normalized.includes(":")
    || path.isAbsolute(normalized)
    || normalized.startsWith("/")
    || normalized.startsWith("//")
    || normalized.split("/").includes("..");
}

function normalizePathIdentity(value) {
  const raw = cleanString(value);
  if (!raw) return "";
  const normalized = path.resolve(raw)
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isSameOrNestedRealPath(parentPath, candidatePath) {
  const parentIdentity = normalizePathIdentity(parentPath);
  const candidateIdentity = normalizePathIdentity(candidatePath);
  return Boolean(
    parentIdentity
    && candidateIdentity
    && (candidateIdentity === parentIdentity || candidateIdentity.startsWith(`${parentIdentity}/`))
  );
}

function resolveProjectedRealPath(targetPath) {
  let existingAncestor = path.resolve(targetPath);
  const suffix = [];
  while (!fs.existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) {
      throw new Error(`无法解析路径的真实父目录：${targetPath}`);
    }
    suffix.unshift(path.basename(existingAncestor));
    existingAncestor = parent;
  }
  return path.resolve(fs.realpathSync.native(existingAncestor), ...suffix);
}

function assertFixtureDestinationOutsideSource(sourceRoot, destination) {
  const sourceRealPath = fs.realpathSync.native(sourceRoot);
  const destinationRealPath = resolveProjectedRealPath(destination);
  if (isSameOrNestedRealPath(sourceRealPath, destinationRealPath)) {
    throw new Error("destination 的真实路径不能位于源项目内部（包括 junction / symlink）。 ");
  }
  return sourceRealPath;
}

function fileSha256(filePath) {
  const hash = crypto.createHash("sha256");
  const buffer = fs.readFileSync(filePath);
  hash.update(buffer);
  return `sha256:${hash.digest("hex")}`;
}

function validateRubric(rubric) {
  const errors = [];
  if (!isRecord(rubric) || rubric.version !== "design-reliability-rubric/v1") {
    return { ok: false, errors: ["Rubric version 非法。"] };
  }
  if (!cleanString(rubric.rubricId)) errors.push("rubricId 不能为空。");
  if (!TASK_FAMILIES.includes(rubric.taskFamily)) {
    errors.push("Rubric taskFamily 非法。");
  }
  if (rubric.scale !== "0..1") errors.push("Rubric scale 必须严格为 0..1。");
  const anchorValues = rubric.scoreAnchorValues;
  if (!isRecord(anchorValues)
    || anchorValues.poor !== 0
    || anchorValues.acceptable !== 0.5
    || anchorValues.strong !== 0.75
    || anchorValues.excellent !== 1
    || Object.keys(anchorValues).length !== 4) {
    errors.push("Rubric scoreAnchorValues 必须统一为 poor=0、acceptable=0.5、strong=0.75、excellent=1。");
  }
  if (!Array.isArray(rubric.dimensions) || rubric.dimensions.length === 0) {
    errors.push("dimensions 不能为空。");
  } else {
    const ids = new Set();
    let weightTotal = 0;
    for (const dimension of rubric.dimensions) {
      const id = cleanString(dimension?.id);
      if (!id || ids.has(id)) errors.push(`Rubric 维度重复或为空：${id || "unknown"}`);
      ids.add(id);
      if (typeof dimension?.weight !== "number" || dimension.weight <= 0 || dimension.weight > 1) {
        errors.push(`Rubric 维度 ${id || "unknown"} 的 weight 非法。`);
      } else {
        weightTotal += dimension.weight;
      }
      if (!cleanString(dimension?.description)) {
        errors.push(`Rubric 维度 ${id || "unknown"} 缺少可判断的 description。`);
      }
      const anchors = dimension?.scoreAnchors;
      if (!isRecord(anchors)
        || ["poor", "acceptable", "strong", "excellent"].some((key) => !cleanString(anchors[key]))) {
        errors.push(`Rubric 维度 ${id || "unknown"} 缺少 poor/acceptable/strong/excellent 评分锚点。`);
      } else if (new Set(Object.values(anchors).map(cleanString)).size !== 4) {
        errors.push(`Rubric 维度 ${id || "unknown"} 的四级评分锚点必须相互不同。`);
      }
    }
    if (Math.abs(weightTotal - 1) > 0.000001) {
      errors.push(`Rubric 权重之和必须为 1，当前为 ${weightTotal}。`);
    }
  }
  if (!isRecord(rubric.decisionRule)
    || rubric.decisionRule.passRequiresNoBlocker !== true
    || !Number.isFinite(rubric.decisionRule.passMinimumOverall)
    || rubric.decisionRule.passMinimumOverall < 0
    || rubric.decisionRule.passMinimumOverall > 1
    || !Array.isArray(rubric.decisionRule.blockingConditions)
    || rubric.decisionRule.blockingConditions.length === 0
    || rubric.decisionRule.blockingConditions.some((item) => !cleanString(item))) {
    errors.push("Rubric decisionRule 缺少通过阈值或明确 blocker。 ");
  }
  if (!isRecord(rubric.boundaries)
    || rubric.boundaries.humanVerdictRequired !== true
    || rubric.boundaries.machineMetricsCannotJudgeAesthetics !== true) {
    errors.push("Rubric 缺少人工审美 owner 边界。 ");
  }
  return { ok: errors.length === 0, errors };
}

function loadSuite() {
  const manifest = readJson(MANIFEST_PATH);
  const errors = [];
  if (manifest.version !== "design-reliability-suite/v1") errors.push("Suite manifest version 非法。");
  if (!cleanString(manifest.suiteId)) errors.push("Suite manifest 缺少 suiteId。");
  if (!Array.isArray(manifest.cases) || manifest.cases.length === 0) errors.push("Suite manifest 没有 Case。");
  if (!Array.isArray(manifest.rubrics) || manifest.rubrics.length === 0) errors.push("Suite manifest 没有 Rubric。");
  const requiredReleaseGateNumbers = [
    "minimumRunsPerFamily",
    "minimumRunsPerCase",
    "technicalDeliveryRate",
    "humanUsableRate",
    "completedPostWriteReadbackRate",
    "completedArtifactEvidenceRate",
    "falseCompletionRate",
    "wrongDocumentOrOverwriteCount",
    "userInterventionMedian",
    "userInterventionP90"
  ];
  if (!isRecord(manifest.releaseGates)) {
    errors.push("Suite manifest 缺少 releaseGates。");
  } else {
    for (const key of requiredReleaseGateNumbers) {
      if (!Number.isFinite(manifest.releaseGates[key])) errors.push(`releaseGates.${key} 必须是有限数字。`);
    }
    if (!Number.isInteger(manifest.releaseGates.minimumRunsPerFamily)
      || manifest.releaseGates.minimumRunsPerFamily < 1) {
      errors.push("releaseGates.minimumRunsPerFamily 必须是正整数。");
    }
    if (!Number.isInteger(manifest.releaseGates.minimumRunsPerCase)
      || manifest.releaseGates.minimumRunsPerCase < 1) {
      errors.push("releaseGates.minimumRunsPerCase 必须是正整数。");
    }
    for (const key of [
      "technicalDeliveryRate",
      "humanUsableRate",
      "completedPostWriteReadbackRate",
      "completedArtifactEvidenceRate",
      "falseCompletionRate"
    ]) {
      const value = manifest.releaseGates[key];
      if (Number.isFinite(value) && (value < 0 || value > 1)) {
        errors.push(`releaseGates.${key} 必须位于 0..1。`);
      }
    }
    for (const key of [
      "wrongDocumentOrOverwriteCount",
      "userInterventionMedian",
      "userInterventionP90"
    ]) {
      const value = manifest.releaseGates[key];
      if (Number.isFinite(value) && value < 0) errors.push(`releaseGates.${key} 不得小于 0。`);
    }
    if (Number.isFinite(manifest.releaseGates.userInterventionMedian)
      && Number.isFinite(manifest.releaseGates.userInterventionP90)
      && manifest.releaseGates.userInterventionMedian > manifest.releaseGates.userInterventionP90) {
      errors.push("releaseGates.userInterventionMedian 不得高于 userInterventionP90。");
    }
    if (manifest.releaseGates.qualityBeforeSpeed !== true) {
      errors.push("releaseGates.qualityBeforeSpeed 必须为 true；当前阶段不能用速度换质量。 ");
    }
  }
  if (!isRecord(manifest.liveRunPolicy)) {
    errors.push("Suite manifest 缺少 liveRunPolicy。 ");
  } else {
    if (manifest.liveRunPolicy.qualityBeforeSpeed !== true) {
      errors.push("liveRunPolicy.qualityBeforeSpeed 必须为 true。 ");
    }
    if (!Number.isSafeInteger(manifest.liveRunPolicy.timeoutMs)
      || manifest.liveRunPolicy.timeoutMs < MIN_LIVE_RUN_TIMEOUT_MS
      || manifest.liveRunPolicy.timeoutMs > MAX_LIVE_RUN_TIMEOUT_MS) {
      errors.push(
        `liveRunPolicy.timeoutMs 必须是 ${MIN_LIVE_RUN_TIMEOUT_MS}..${MAX_LIVE_RUN_TIMEOUT_MS} 的安全整数。`
      );
    }
    if (manifest.liveRunPolicy.timeoutOverridePolicy !== "must_match_suite") {
      errors.push("liveRunPolicy.timeoutOverridePolicy 必须为 must_match_suite。 ");
    }
  }
  if (!isRecord(manifest.boundaries)
    || manifest.boundaries.devBenchmarkOnly !== true
    || manifest.boundaries.neverAffectsRuntime !== true
    || manifest.boundaries.humanOwnsAestheticVerdict !== true) {
    errors.push("Suite manifest 边界声明不完整。 ");
  }
  const cases = [];
  for (const relativePath of manifest.cases || []) {
    const absolutePath = resolveInside(BENCHMARK_ROOT, relativePath);
    if (!fs.existsSync(absolutePath)) {
      errors.push(`Case 文件不存在：${relativePath}`);
      continue;
    }
    const caseSpec = readJson(absolutePath);
    const validation = validateDesignReliabilityCase(caseSpec);
    if (!validation.ok) {
      validation.errors.forEach((error) => errors.push(`${relativePath}: ${error}`));
    }
    if (caseSpec.suiteId !== manifest.suiteId) errors.push(`${relativePath}: suiteId 与 manifest 不一致。`);
    if (caseSpec.status === "active") {
      const actorVerdict = validateActiveCaseLiveRunActor(caseSpec);
      if (!actorVerdict.ready) {
        errors.push(
          `${relativePath}: active Case 的 live-run actor 不可用（${actorVerdict.protocolKind || "unknown"}`
          + `${actorVerdict.actorCapabilityId ? ` / ${actorVerdict.actorCapabilityId}` : ""}）。`
        );
      }
    }
    cases.push({ ...caseSpec, __file: absolutePath });
  }
  const rubrics = [];
  for (const relativePath of manifest.rubrics || []) {
    const absolutePath = resolveInside(BENCHMARK_ROOT, relativePath);
    if (!fs.existsSync(absolutePath)) {
      errors.push(`Rubric 文件不存在：${relativePath}`);
      continue;
    }
    const rubric = readJson(absolutePath);
    const validation = validateRubric(rubric);
    if (!validation.ok) validation.errors.forEach((error) => errors.push(`${relativePath}: ${error}`));
    rubrics.push({ ...rubric, __file: absolutePath });
  }
  const caseIds = cases.map((item) => item.caseId);
  if (new Set(caseIds).size !== caseIds.length) errors.push("Case id 重复。");
  const rubricIds = rubrics.map((item) => item.rubricId);
  if (new Set(rubricIds).size !== rubricIds.length) errors.push("Rubric id 重复。");
  for (const caseSpec of cases) {
    const rubric = rubrics.find((item) => item.rubricId === caseSpec.oracle?.rubricId);
    if (!rubric) {
      errors.push(`${caseSpec.caseId}: 找不到 rubric ${caseSpec.oracle?.rubricId || "unknown"}。`);
    } else if (rubric.taskFamily !== caseSpec.taskFamily) {
      errors.push(`${caseSpec.caseId}: taskFamily 与 rubric ${rubric.rubricId} 不一致。`);
    }
  }
  return { manifest, cases, rubrics, errors, ok: errors.length === 0 };
}

function buildSuiteCaseSetDigest(suite) {
  return sha256Text(stableStringify(suite.cases
    .filter((caseSpec) => caseSpec.status === "active")
    .map((caseSpec) => ({
      caseId: caseSpec.caseId,
      revision: caseSpec.revision,
      caseDigest: caseSpec.caseDigest,
      taskFamily: caseSpec.taskFamily,
      executionModel: caseSpec.executionModel,
      fixtureId: caseSpec.task?.fixtureId,
      instructionDigest: sha256Text(caseSpec.task?.instruction || ""),
      rubricId: caseSpec.oracle?.rubricId
    }))
    .sort((left, right) => left.caseId.localeCompare(right.caseId))));
}

function buildSuiteRubricSetDigest(suite) {
  return sha256Text(stableStringify(suite.rubrics
    .map((rubric) => ({
      rubricId: rubric.rubricId,
      rubricDigest: buildRubricDigest(rubric)
    }))
    .sort((left, right) => left.rubricId.localeCompare(right.rubricId))));
}

function deriveLiveCohortFingerprint(input) {
  const environment = input?.environment || {};
  return sha256Text(stableStringify({
    suiteId: cleanString(input?.suiteId),
    suiteCaseSetDigest: cleanString(input?.suiteCaseSetDigest),
    suiteRubricSetDigest: cleanString(input?.suiteRubricSetDigest),
    gitCommit: cleanString(environment.gitCommit),
    dirtyFingerprint: cleanString(environment.dirtyFingerprint),
    runtimeGitCommit: cleanString(environment.runtimeGitCommit),
    runtimeBuildId: cleanString(environment.runtimeBuildId),
    runtimeAppVersion: cleanString(environment.runtimeAppVersion),
    photoshopRuntimeBuildId: cleanString(environment.photoshopRuntimeBuildId),
    photoshopRuntimeGitCommit: cleanString(environment.photoshopRuntimeGitCommit),
    photoshopRuntimeSourceDigest: cleanString(environment.photoshopRuntimeSourceDigest),
    photoshopRuntimeArtifactDigest: cleanString(environment.photoshopRuntimeArtifactDigest),
    photoshopRuntimeManifestDigest: cleanString(environment.photoshopRuntimeManifestDigest),
    photoshopRuntimeBindingDigest: cleanString(environment.photoshopRuntimeBindingDigest),
    mainImageCanvasDigest: cleanString(environment.mainImageCanvasDigest),
    provider: cleanString(input?.provider),
    modelId: cleanString(input?.modelId),
    timeoutMs: Number(input?.timeoutMs)
  }));
}

function deriveLiveAttemptFingerprint(input) {
  return sha256Text(stableStringify({
    cohortFingerprint: cleanString(input?.cohortFingerprint),
    caseId: cleanString(input?.caseRef?.caseId),
    caseRevision: input?.caseRef?.revision,
    caseDigest: cleanString(input?.caseRef?.caseDigest),
    fixtureDigest: cleanString(input?.fixtureRef?.fixtureDigest),
    workspaceSemanticDigest: cleanString(input?.fixtureRef?.workspaceSemanticDigest),
    fixtureInstanceId: cleanString(input?.fixtureRef?.instanceId),
    instructionDigest: cleanString(input?.instructionDigest),
    rubricDigest: cleanString(input?.rubricDigest),
    liveRunProtocolKind: cleanString(input?.liveRunProtocol?.kind),
    liveRunProtocolDigest: cleanString(input?.liveRunProtocol?.digest),
    repeatIndex: input?.repeatIndex
  }));
}

function collectJsonFiles(root) {
  if (!fs.existsSync(root)) return [];
  if (path.basename(path.resolve(root)) === path.basename(CANONICAL_REVIEW_BUNDLES_ROOT)
    || path.resolve(root) === path.resolve(CANONICAL_REVIEW_BUNDLES_ROOT)
    || isPathInside(CANONICAL_REVIEW_BUNDLES_ROOT, root)) {
    return [];
  }
  const pending = [root];
  const files = [];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === path.basename(CANONICAL_REVIEW_BUNDLES_ROOT)
          || path.resolve(absolutePath) === path.resolve(CANONICAL_REVIEW_BUNDLES_ROOT)
          || isPathInside(CANONICAL_REVIEW_BUNDLES_ROOT, absolutePath)) {
          continue;
        }
        pending.push(absolutePath);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        files.push(absolutePath);
      }
    }
  }
  return files.sort();
}

function validateLiveAttemptEvent(event) {
  const errors = [];
  if (event?.version !== LIVE_ATTEMPT_EVENT_VERSION) errors.push("Attempt event version 非法。");
  if (!cleanString(event?.eventId)) errors.push("Attempt eventId 不能为空。");
  if (!cleanString(event?.attemptId)) errors.push("Attempt attemptId 不能为空。");
  if (!Number.isSafeInteger(event?.sequence) || event.sequence < 1) errors.push("Attempt sequence 非法。");
  if (!["armed", "submission_started", "terminal", "reconciled"].includes(event?.eventType)) {
    errors.push("Attempt eventType 非法。");
  }
  if (!cleanString(event?.caseRef?.caseId) || !cleanString(event?.cohortId)) {
    errors.push("Attempt 缺少 Case 或 cohort 身份。");
  }
  if (!Number.isInteger(event?.repeatIndex) || event.repeatIndex < 1) {
    errors.push("Attempt repeatIndex 必须是正整数。 ");
  }
  if (!cleanString(event?.provider) || !cleanString(event?.modelId)) {
    errors.push("Attempt 缺少 Provider / Model 身份。");
  }
  if (!cleanString(event?.cohortFingerprint) || !cleanString(event?.attemptFingerprint)) {
    errors.push("Attempt 缺少 cohort / attempt 指纹。");
  }
  if (!isRecord(event?.liveRunProtocol)
    || !cleanString(event.liveRunProtocol.kind)
    || !/^sha256:[a-f0-9]{64}$/.test(cleanString(event.liveRunProtocol.digest).toLowerCase())) {
    errors.push("Attempt 缺少冻结的 liveRunProtocol 身份。 ");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(
    cleanString(event?.fixtureRef?.workspaceSemanticDigest).toLowerCase()
  )) {
    errors.push("Attempt 缺少 Workspace 语义状态摘要。 ");
  }
  if (!cleanString(event?.suiteCaseSetDigest) || !cleanString(event?.suiteRubricSetDigest)) {
    errors.push("Attempt 缺少当前 Suite Case / Rubric 摘要。");
  }
  const photoshopRuntimeBinding = event?.environment?.photoshopRuntimeBinding;
  const photoshopRuntimeBindingDigest = cleanString(
    event?.environment?.photoshopRuntimeBindingDigest
  );
  if (!validatePhotoshopRuntimeBinding(photoshopRuntimeBinding)
    || !photoshopRuntimeBindingDigest
    || photoshopRuntimeBindingDigest !== sha256Text(stableStringify(photoshopRuntimeBinding))
    || cleanString(event?.environment?.photoshopRuntimeBuildId)
      !== cleanString(photoshopRuntimeBinding?.live?.buildId)) {
    errors.push("Attempt 没有绑定可重算的 Photoshop Runtime 完整身份。");
  }
  if (["terminal", "reconciled"].includes(event?.eventType) && !cleanString(event?.status)) {
    errors.push("Attempt 终态 / 对账事件缺少 status。");
  }
  if (event?.eventType === "terminal") {
    if (event.interactionMetricsKnown === true) {
      if (!Number.isInteger(event.protocolInteractionCount) || event.protocolInteractionCount < 0
        || !Number.isInteger(event.userDesignCorrectionCount) || event.userDesignCorrectionCount < 0) {
        errors.push("已知交互指标必须提供非负整数的协议交互数与用户设计纠错数。 ");
      }
    } else if (event.protocolInteractionCount !== undefined
      || event.userDesignCorrectionCount !== undefined) {
      errors.push("交互指标未知时不能夹带推测计数。 ");
    }
  }
  return { ok: errors.length === 0, errors };
}

function collectSidecars(dataRoots, options = {}) {
  const runs = [];
  const reviews = [];
  const attributions = [];
  const attemptEvents = [];
  const invalid = [];
  const excludedEvidence = [];
  const seenIds = new Set();
  for (const root of dataRoots) {
    for (const filePath of collectJsonFiles(root)) {
      let payload;
      try {
        payload = readJson(filePath);
      } catch (error) {
        const normalizedPath = normalizeRelativePath(filePath);
        invalid.push({
          file: filePath,
          kind: normalizedPath.includes("/attempt-events/") ? "attempt_event" : "unknown",
          errors: [error.message]
        });
        continue;
      }
      let validation;
      let identity;
      if (payload?.version === RUN_VERSION) {
        validation = validateDesignReliabilityRun(payload);
        identity = payload.runObservationId;
        if (validation.ok) runs.push(payload);
      } else if (payload?.version === REVIEW_VERSION) {
        validation = validateDesignReliabilityReview(payload);
        identity = payload.reviewId;
        if (validation.ok) reviews.push(payload);
      } else if (payload?.version === LEGACY_REVIEW_VERSION) {
        excludedEvidence.push({
          kind: "human_review",
          id: cleanString(payload.reviewId) || normalizeRelativePath(filePath),
          reason: "historical_review_protocol_non_official"
        });
        continue;
      } else if (payload?.version === ATTRIBUTION_VERSION) {
        validation = validateDesignReliabilityAttribution(payload);
        identity = payload.attributionId;
        if (validation.ok) attributions.push(payload);
      } else if (payload?.version === LIVE_ATTEMPT_EVENT_VERSION) {
        validation = validateLiveAttemptEvent(payload);
        identity = payload.eventId;
        if (validation.ok) attemptEvents.push(payload);
      } else {
        if (options.strictAttemptEvents === true) {
          invalid.push({
            file: filePath,
            kind: "attempt_event",
            errors: ["canonical Attempt 目录只能包含受支持的 Attempt event。"]
          });
        }
        continue;
      }
      const sidecarKind = payload?.version === LIVE_ATTEMPT_EVENT_VERSION
        ? "attempt_event"
        : "other";
      if (!validation.ok) invalid.push({ file: filePath, kind: sidecarKind, errors: validation.errors });
      if (cleanString(identity)) {
        if (seenIds.has(identity)) {
          invalid.push({ file: filePath, kind: sidecarKind, errors: [`重复 sidecar id：${identity}`] });
        }
        seenIds.add(identity);
      }
    }
  }
  return { runs, reviews, attributions, attemptEvents, invalid, excludedEvidence };
}

function findCase(suite, caseId) {
  const caseSpec = suite.cases.find((item) => item.caseId === caseId);
  if (!caseSpec) throw new Error(`找不到 Case：${caseId}`);
  return caseSpec;
}

function readGitEnvironment() {
  const spawnOptions = {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  };
  const commitResult = spawnSync("git", ["rev-parse", "HEAD"], {
    ...spawnOptions
  });
  const statusResult = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    ...spawnOptions
  });
  const diffResult = spawnSync("git", ["diff", "--binary", "HEAD", "--"], {
    ...spawnOptions
  });
  const untrackedResult = spawnSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
    ...spawnOptions
  });
  const commit = commitResult.status === 0 ? cleanString(commitResult.stdout) : "unknown";
  const status = statusResult.status === 0 ? String(statusResult.stdout || "") : "unknown";
  const trackedDiffDigest = diffResult.status === 0
    ? sha256Text(String(diffResult.stdout || ""))
    : "unknown";
  const untrackedFiles = untrackedResult.status === 0
    ? String(untrackedResult.stdout || "").split("\0").filter(Boolean).sort()
    : [];
  const untrackedDigests = untrackedFiles.map((relativeRef) => {
    const absolutePath = resolveInside(ROOT, relativeRef);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      return { ref: normalizeRelativePath(relativeRef), missing: true };
    }
    return {
      ref: normalizeRelativePath(relativeRef),
      size: fs.statSync(absolutePath).size,
      digest: fileSha256(absolutePath)
    };
  });
  return {
    gitCommit: commit,
    dirty: Boolean(status.trim()),
    dirtyFingerprint: sha256Text(stableStringify({
      status,
      trackedDiffDigest,
      untrackedDigests
    }))
  };
}

function fixtureInputs(cases) {
  const byRef = new Map();
  for (const caseSpec of cases) {
    const inputs = [
      ...caseSpec.task.agentVisibleInputs,
      ...(caseSpec.task.agentVisibleReferences || []).map((input) => ({
        ...input,
        role: input.role || "user_provided_reference"
      })),
      ...(caseSpec.task.fixtureGeneratedInputs || []).map((input) => ({
        ...input,
        generatedContent: buildDesignReliabilityGeneratedFixtureContent(input)
      }))
    ];
    for (const input of inputs) {
      const ref = normalizeRelativePath(input.ref);
      const existing = byRef.get(ref);
      if (!existing) {
        byRef.set(ref, {
          ref,
          roles: [input.role],
          caseIds: [caseSpec.caseId],
          ...(cleanString(input.digest) ? { expectedDigest: cleanString(input.digest).toLowerCase() } : {}),
          ...(input.generatedContent !== undefined
            ? { generatedContent: String(input.generatedContent) }
            : {})
        });
        continue;
      }
      if (existing.generatedContent !== input.generatedContent) {
        throw new Error(`同一 fixture ref 同时声明为不同来源或内容：${ref}`);
      }
      const expectedDigest = cleanString(input.digest).toLowerCase();
      if (expectedDigest && existing.expectedDigest && existing.expectedDigest !== expectedDigest) {
        throw new Error(`同一 fixture ref 声明了不同冻结摘要：${ref}`);
      }
      if (expectedDigest && !existing.expectedDigest) existing.expectedDigest = expectedDigest;
      if (!existing.roles.includes(input.role)) existing.roles.push(input.role);
      if (!existing.caseIds.includes(caseSpec.caseId)) existing.caseIds.push(caseSpec.caseId);
    }
  }
  return [...byRef.values()].sort((left, right) => left.ref.localeCompare(right.ref));
}

function collectFixtureFileRefs(root) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return { files: [], unsafeLinks: [] };
  if (fs.lstatSync(root).isSymbolicLink()) return { files: [], unsafeLinks: ["."] };
  const pending = [path.resolve(root)];
  const files = [];
  const unsafeLinks = [];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        unsafeLinks.push(normalizeRelativePath(path.relative(root, absolutePath)));
        continue;
      }
      if (entry.isDirectory()) {
        pending.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      files.push(normalizeRelativePath(path.relative(root, absolutePath)));
    }
  }
  return { files: files.sort(), unsafeLinks: unsafeLinks.sort() };
}

function evaluateFixtureInventory(expectedRefsInput, actualRefsInput) {
  const expectedRefs = [...new Set((expectedRefsInput || []).map(normalizeRelativePath))].sort();
  const actualRefs = [...new Set((actualRefsInput || []).map(normalizeRelativePath))].sort();
  const expectedSet = new Set(expectedRefs);
  const actualSet = new Set(actualRefs);
  const missing = expectedRefs.filter((ref) => !actualSet.has(ref));
  const workspaceMetadataRefs = actualRefs.filter((ref) => ref === CONTROLLED_PROJECT_METADATA_REF);
  const unexpected = actualRefs.filter((ref) => (
    !expectedSet.has(ref) && ref !== CONTROLLED_PROJECT_METADATA_REF
  ));
  return {
    ready: missing.length === 0,
    freshRunReady: missing.length === 0 && unexpected.length === 0,
    expectedFileCount: expectedRefs.length,
    actualFileCount: actualRefs.length,
    actualInputFileCount: actualRefs.filter((ref) => expectedSet.has(ref)).length,
    missing,
    unexpected,
    workspaceMetadataRefs
  };
}

function isValidIsoTimestamp(value) {
  if (!cleanString(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function validateStringEnumRecord(value, allowedValues) {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([key, entryValue]) => (
    cleanString(key) === key
    && key.length > 0
    && !isUnsafeProjectRelativeRef(key)
    && typeof entryValue === "string"
    && allowedValues.has(entryValue)
  ));
}

function validateProjectDesignPlan(value) {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  if (Object.keys(value).some((key) => !PROJECT_DESIGN_PLAN_KEYS.has(key))) return false;
  return Object.values(value).every((entry) => (
    isRecord(entry)
    && Object.keys(entry).length === 1
    && PROJECT_DESIGN_STATUSES.has(entry.status)
  ));
}

function normalizeProjectSemanticRecord(value) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right)));
}

function buildProjectSemanticMetadataSnapshot(metadata) {
  const value = isRecord(metadata) ? metadata : {};
  return {
    folderMappings: normalizeProjectSemanticRecord(value.folderMappings),
    imageClassifications: normalizeProjectSemanticRecord(value.imageClassifications),
    designPlan: normalizeProjectSemanticRecord(value.designPlan)
  };
}

function inspectControlledProjectMetadata(fixtureRoot, actualRefs) {
  const present = actualRefs.includes(CONTROLLED_PROJECT_METADATA_REF);
  if (!present) {
    const semanticSnapshot = buildProjectSemanticMetadataSnapshot(undefined);
    return {
      ref: CONTROLLED_PROJECT_METADATA_REF,
      present: false,
      ready: true,
      schemaValid: true,
      projectRootMatches: true,
      semanticSnapshot,
      semanticDigest: sha256Text(stableStringify(semanticSnapshot)),
      errors: []
    };
  }
  const metadataPath = resolveInside(fixtureRoot, CONTROLLED_PROJECT_METADATA_REF);
  let metadata;
  try {
    metadata = readJson(metadataPath);
  } catch {
    const semanticSnapshot = buildProjectSemanticMetadataSnapshot(undefined);
    return {
      ref: CONTROLLED_PROJECT_METADATA_REF,
      present: true,
      ready: false,
      schemaValid: false,
      projectRootMatches: false,
      semanticSnapshot,
      semanticDigest: sha256Text(stableStringify(semanticSnapshot)),
      errors: ["project_metadata_invalid_json"]
    };
  }
  const errors = [];
  if (!isRecord(metadata)) {
    errors.push("project_metadata_schema_invalid");
  } else if (Object.keys(metadata).some((key) => !PROJECT_METADATA_KEYS.has(key))
    || metadata.version !== PROJECT_METADATA_VERSION
    || !isValidIsoTimestamp(metadata.createdAt)
    || !isValidIsoTimestamp(metadata.lastOpenedAt)
    || !cleanString(metadata.projectPath)
    || cleanString(metadata.projectName) !== path.basename(path.resolve(fixtureRoot))
    || !validateStringEnumRecord(metadata.folderMappings, PROJECT_FOLDER_TYPES)
    || !validateStringEnumRecord(metadata.imageClassifications, PROJECT_IMAGE_TYPES)
    || !validateProjectDesignPlan(metadata.designPlan)) {
    errors.push("project_metadata_schema_invalid");
  }
  let projectRootMatches = false;
  if (isRecord(metadata) && cleanString(metadata.projectPath)) {
    const declaredPath = path.resolve(metadata.projectPath);
    if (fs.existsSync(declaredPath) && fs.statSync(declaredPath).isDirectory()) {
      projectRootMatches = normalizePathIdentity(fs.realpathSync.native(declaredPath))
        === normalizePathIdentity(fs.realpathSync.native(fixtureRoot));
    }
  }
  if (!projectRootMatches) errors.push("project_metadata_root_mismatch");
  const semanticSnapshot = buildProjectSemanticMetadataSnapshot(metadata);
  return {
    ref: CONTROLLED_PROJECT_METADATA_REF,
    present: true,
    ready: errors.length === 0,
    schemaValid: !errors.includes("project_metadata_schema_invalid"),
    projectRootMatches,
    semanticSnapshot,
    semanticDigest: sha256Text(stableStringify(semanticSnapshot)),
    errors: [...new Set(errors)]
  };
}

function selectFixtureCases(suite, args) {
  const requestedCaseId = args.get("--case");
  if (requestedCaseId) return [findCase(suite, requestedCaseId)];
  const requestedFixtureId = args.get("--fixture-id");
  if (requestedFixtureId) {
    const selected = suite.cases.filter((item) => item.task?.fixtureId === requestedFixtureId);
    if (selected.length === 0) throw new Error(`找不到 fixtureId：${requestedFixtureId}`);
    return selected;
  }
  const active = suite.cases.filter((item) => item.status === "active");
  const fixtureIds = [...new Set(active.map((item) => item.task?.fixtureId).filter(Boolean))];
  if (fixtureIds.length === 1) return active;
  throw new Error(`当前套件包含 ${fixtureIds.length} 个独立 fixture，请使用 --case 或 --fixture-id 明确选择。`);
}

function inspectFixture(cases, fixtureRoot) {
  const inputs = fixtureInputs(cases);
  const expectedRefs = inputs.map((input) => normalizeRelativePath(input.ref));
  const collected = collectFixtureFileRefs(fixtureRoot);
  const actualRefs = collected.files;
  const inventory = evaluateFixtureInventory(expectedRefs, actualRefs);
  const workspaceMetadata = inspectControlledProjectMetadata(fixtureRoot, actualRefs);
  const files = [];
  const missing = [];
  const digestMismatches = [];
  for (const input of inputs) {
    const absolutePath = resolveInside(fixtureRoot, input.ref);
    if (!fs.existsSync(absolutePath)
      || fs.lstatSync(absolutePath).isSymbolicLink()
      || !fs.statSync(absolutePath).isFile()) {
      missing.push(input.ref);
      continue;
    }
    const digest = fileSha256(absolutePath);
    if (input.expectedDigest && digest !== input.expectedDigest) {
      digestMismatches.push({
        ref: input.ref,
        expectedDigest: input.expectedDigest,
        actualDigest: digest
      });
    }
    files.push({
      ref: input.ref,
      size: fs.statSync(absolutePath).size,
      digest,
      roles: [...input.roles].sort(),
      caseIds: [...input.caseIds].sort()
    });
  }
  const fixtureDigest = sha256Text(stableStringify(files.map((file) => ({
    ref: file.ref,
    size: file.size,
    digest: file.digest
  }))));
  return {
    ready: missing.length === 0
      && digestMismatches.length === 0
      && collected.unsafeLinks.length === 0,
    freshRunReady: missing.length === 0
      && digestMismatches.length === 0
      && inventory.unexpected.length === 0
      && workspaceMetadata.ready
      && collected.unsafeLinks.length === 0,
    fixtureDigest,
    files,
    missing,
    digestMismatches,
    unexpected: inventory.unexpected,
    workspaceMetadata,
    unsafeLinks: collected.unsafeLinks,
    actualFileCount: actualRefs.length,
    actualInputFileCount: inventory.actualInputFileCount,
    expectedFileCount: expectedRefs.length,
    boundaries: {
      reviewOnlyReferencesExcluded: true,
      agentVisibleReferenceDigestsVerified: true,
      absolutePathsNotPersisted: true,
      unexpectedFilesFailFreshRun: true,
      onlyExactProjectMetadataAllowed: true,
      projectMetadataExcludedFromFixtureDigest: true,
      unsafeLinksFailFixture: true
    }
  };
}

function prepareFixture(suite, args, dataRoot = DEFAULT_DATA_ROOT) {
  const sourceRoot = path.resolve(args.get("--source-root"));
  const destination = path.resolve(args.get("--destination"));
  if (!args.hasFlag("--allow-create")) {
    throw new Error("prepare-fixture 需要显式 --allow-create；它只创建一次性副本，不修改源目录。 ");
  }
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw new Error(`source-root 不存在或不是目录：${sourceRoot}`);
  }
  if (sourceRoot === destination) throw new Error("destination 不能等于 source-root。 ");
  const sourceToDestination = path.relative(sourceRoot, destination);
  if (sourceToDestination && !sourceToDestination.startsWith("..") && !path.isAbsolute(sourceToDestination)) {
    throw new Error("destination 不能放在源项目内部。 ");
  }
  const sourceRealPath = assertFixtureDestinationOutsideSource(sourceRoot, destination);
  const selectedCases = selectFixtureCases(suite, args);
  if (selectedCases.length !== 1) {
    throw new Error(
      `fixtureId ${selectedCases[0]?.task?.fixtureId || 'unknown'} 被 ${selectedCases.length} 个 Case 共用；`
      + '正式 live fixture 必须使用 --case 单独准备，不能生成随后会被单 Case 判为 unexpected 的联合目录。'
    );
  }
  const inputs = fixtureInputs(selectedCases);
  const missing = inputs
    .filter((input) => {
      if (input.generatedContent !== undefined) return false;
      const sourcePath = resolveInside(sourceRoot, input.ref);
      return !fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile();
    })
    .map((input) => input.ref);
  if (missing.length > 0) {
    throw new Error(`源 fixture 缺少 ${missing.length} 个文件：${missing.join("、")}`);
  }
  for (const input of inputs) {
    if (input.generatedContent !== undefined) continue;
    const sourcePath = resolveInside(sourceRoot, input.ref);
    const sourceInputRealPath = fs.realpathSync.native(sourcePath);
    if (!isSameOrNestedRealPath(sourceRealPath, sourceInputRealPath)) {
      throw new Error(`源 fixture 输入通过 junction / symlink 越出源项目：${input.ref}`);
    }
  }
  if (fs.existsSync(destination)) {
    if (fs.lstatSync(destination).isSymbolicLink()) {
      throw new Error(`destination 不能是 junction / symlink：${destination}`);
    }
    const existing = fs.readdirSync(destination);
    if (existing.length > 0) throw new Error(`destination 已存在且非空，拒绝覆盖：${destination}`);
  } else {
    fs.mkdirSync(destination, { recursive: true });
  }
  assertFixtureDestinationOutsideSource(sourceRoot, destination);
  const copied = [];
  for (const input of inputs) {
    const destinationPath = resolveInside(destination, input.ref);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    if (input.generatedContent !== undefined) {
      fs.writeFileSync(destinationPath, input.generatedContent, {
        encoding: "utf8",
        flag: "wx"
      });
    } else {
      const sourcePath = resolveInside(sourceRoot, input.ref);
      fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
    }
    copied.push(input.ref);
  }
  const inspection = inspectFixture(selectedCases, destination);
  if (!inspection.freshRunReady) {
    throw new Error(`新 fixture 不安全或出现未声明文件：${[
      ...inspection.missing.map((ref) => `missing:${ref}`),
      ...inspection.digestMismatches.map((item) => `digest-mismatch:${item.ref}`),
      ...inspection.unexpected,
      ...inspection.unsafeLinks.map((ref) => `junction/symlink:${ref}`)
    ].join("、")}`);
  }
  const compactTime = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const instanceId = `fixture-${compactTime}-${crypto.randomBytes(6).toString("hex")}`;
  const report = {
    version: "design-reliability-fixture/v1",
    instanceId,
    fixtureId: selectedCases[0]?.task?.fixtureId || "unknown",
    suiteId: suite.manifest.suiteId,
    caseIds: selectedCases.map((item) => item.caseId).sort(),
    caseRefs: selectedCases.map((item) => ({
      caseId: item.caseId,
      revision: item.revision,
      caseDigest: item.caseDigest
    })).sort((left, right) => left.caseId.localeCompare(right.caseId)),
    preparedAt: new Date().toISOString(),
    copiedFileCount: copied.length,
    fixtureDigest: inspection.fixtureDigest,
    pathBindingDigest: sha256Text(`${instanceId}|${normalizePathIdentity(destination)}`),
    files: inspection.files,
    boundaries: {
      sourceProjectUntouched: true,
      reviewOnlyReferencesExcluded: true,
      absolutePathsNotPersisted: true,
      benchmarkMetadataNotWrittenIntoAgentProject: true
    }
  };
  const reportPath = resolveInside(dataRoot, path.join(
    "fixtures",
    `${safePathSegment(report.fixtureId)}-${safePathSegment(instanceId)}.json`
  ));
  writeJsonExclusive(reportPath, report);
  return { report, reportPath, destination };
}

function readFixtureInstance(fixtureRoot, selectedCases, inspection, dataRoot = DEFAULT_DATA_ROOT) {
  const reportsRoot = path.join(dataRoot, "fixtures");
  if (!fs.existsSync(reportsRoot)) return undefined;
  const expectedCaseIds = selectedCases.map((item) => item.caseId).sort();
  const expectedCaseRefs = selectedCases.map((item) => ({
    caseId: item.caseId,
    revision: item.revision,
    caseDigest: item.caseDigest
  })).sort((left, right) => left.caseId.localeCompare(right.caseId));
  const matches = [];
  for (const filePath of collectJsonFiles(reportsRoot)) {
    let report;
    try {
      report = readJson(filePath);
    } catch {
      continue;
    }
    if (report?.version !== "design-reliability-fixture/v1"
      || !cleanString(report.instanceId)
      || report.fixtureDigest !== inspection.fixtureDigest
      || stableStringify(Array.isArray(report.caseIds) ? [...report.caseIds].sort() : [])
        !== stableStringify(expectedCaseIds)
      || stableStringify(Array.isArray(report.caseRefs) ? report.caseRefs : [])
        !== stableStringify(expectedCaseRefs)) {
      continue;
    }
    const expectedPathBinding = sha256Text(
      `${report.instanceId}|${normalizePathIdentity(fixtureRoot)}`
    );
    if (report.pathBindingDigest !== expectedPathBinding) continue;
    matches.push({
      instanceId: report.instanceId,
      fixtureDigest: report.fixtureDigest,
      pathBindingDigest: report.pathBindingDigest,
      preparedAt: report.preparedAt
    });
  }
  return matches.length === 1 ? matches[0] : undefined;
}

function parseEvidenceArgs(args, fixtureRoot) {
  const evidenceRefs = [];
  for (const encoded of args.getAll("--evidence")) {
    const separator = encoded.indexOf("=");
    if (separator <= 0) throw new Error(`--evidence 必须使用 kind=relative/path：${encoded}`);
    const kind = encoded.slice(0, separator).trim();
    const relativeRef = normalizeRelativePath(encoded.slice(separator + 1));
    const absolutePath = resolveInside(fixtureRoot, relativeRef);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      throw new Error(`证据文件不存在：${relativeRef}`);
    }
    evidenceRefs.push({
      kind,
      ref: relativeRef,
      digest: fileSha256(absolutePath),
      size: fs.statSync(absolutePath).size,
      verified: true
    });
  }
  return evidenceRefs;
}

function normalizeDeclaredFinalArtifactRefs(value) {
  const refs = (Array.isArray(value) ? value : []).map(normalizeRelativePath);
  const unsafe = refs.find(isUnsafeProjectRelativeRef);
  if (unsafe) throw new Error(`Agent 最终交付声明包含不安全项目引用：${unsafe}`);
  return [...new Set(refs.filter(Boolean))].sort();
}

function buildAgentFinalArtifactManifest(declaredRefsInput, evidenceRefs) {
  const declaredRefs = normalizeDeclaredFinalArtifactRefs(declaredRefsInput);
  const evidenceByRef = new Map(evidenceRefs.map((evidence) => [
    normalizeRelativePath(evidence.ref),
    evidence
  ]));
  const artifacts = declaredRefs.map((ref) => {
    const evidence = evidenceByRef.get(ref);
    if (!evidence
      || evidence.verified !== true
      || !["editable_psd", "raster_export"].includes(evidence.kind)) {
      throw new Error(`Agent 最终交付声明没有绑定已验证 PSD/位图产物：${ref}`);
    }
    return {
      kind: evidence.kind,
      ref,
      digest: evidence.digest
    };
  });
  return {
    version: "design-reliability-final-artifact-manifest/v1",
    declaredBy: "agent_delivery_receipt",
    artifacts,
    manifestDigest: sha256Text(stableStringify(artifacts))
  };
}

function collectRunRecordFiles(fixtureRoot) {
  const runsRoot = path.join(fixtureRoot, ".designecho", "runs");
  if (!fs.existsSync(runsRoot)) return [];
  return fs.readdirSync(runsRoot)
    .filter((name) => name.startsWith("run-") && name.endsWith(".json"))
    .map((name) => path.join(runsRoot, name))
    .sort();
}

function snapshotProjectFiles(projectRoot) {
  const pending = [projectRoot];
  const files = new Map();
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === ".designecho") continue;
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativeRef = normalizeRelativePath(path.relative(projectRoot, absolutePath));
      const stat = fs.statSync(absolutePath);
      files.set(relativeRef, { size: stat.size, mtimeMs: Math.round(stat.mtimeMs) });
    }
  }
  return files;
}

function changedProjectFiles(before, after) {
  const changed = [];
  for (const [ref, state] of after.entries()) {
    const previous = before.get(ref);
    if (!previous || previous.size !== state.size || previous.mtimeMs !== state.mtimeMs) changed.push(ref);
  }
  return changed.sort();
}

function readPsdHeader(filePath) {
  const handle = fs.openSync(filePath, "r");
  const header = Buffer.alloc(26);
  let bytesRead = 0;
  try {
    bytesRead = fs.readSync(handle, header, 0, header.length, 0);
  } finally {
    fs.closeSync(handle);
  }
  if (bytesRead !== header.length || header.toString("ascii", 0, 4) !== "8BPS") return null;
  const version = header.readUInt16BE(4);
  if (version !== 1 && version !== 2) return null;
  return {
    format: version === 1 ? "psd" : "psb",
    channels: header.readUInt16BE(12),
    height: header.readUInt32BE(14),
    width: header.readUInt32BE(18),
    depth: header.readUInt16BE(22),
    colorMode: header.readUInt16BE(24)
  };
}

function countPsdLayers(children) {
  if (!Array.isArray(children)) return 0;
  return children.reduce((total, layer) => (
    total + 1 + countPsdLayers(layer?.children)
  ), 0);
}

function inspectEditablePsd(filePath) {
  const header = readPsdHeader(filePath);
  if (!header) return null;
  const fileSize = fs.statSync(filePath).size;
  // 正式证据宁可缺失也不能因解析超大、未知文件而拖垮评测进程。超限文件可在
  // Photoshop 中走 reopen + 结构读回，但这里不会仅凭 26 字节文件头宣称可编辑。
  if (fileSize > 512 * 1024 * 1024) return null;
  try {
    const parsed = readPsd(fs.readFileSync(filePath), {
      skipLayerImageData: true,
      skipCompositeImageData: true,
      skipThumbnail: true
    });
    const width = Number(parsed?.width);
    const height = Number(parsed?.height);
    const layerCount = countPsdLayers(parsed?.children);
    if (!Number.isFinite(width)
      || !Number.isFinite(height)
      || width !== header.width
      || height !== header.height
      || layerCount < 2) {
      return null;
    }
    return {
      ...header,
      width,
      height,
      layerCount,
      completeParseVerified: true
    };
  } catch {
    return null;
  }
}

function exactRefSetMatches(actualInput, expectedInput) {
  const actual = normalizeDeclaredFinalArtifactRefs(actualInput);
  const expected = normalizeDeclaredFinalArtifactRefs(expectedInput);
  return actual.length === expected.length
    && stableStringify(actual) === stableStringify(expected);
}

function buildSkuLiveDeliveryEvidence(caseSpec, bindingProof, evidenceRefs) {
  if (caseSpec.taskFamily !== "sku") return [];
  const source = bindingProof?.skuDeliveryEvidence;
  if (!isRecord(source) || source.version !== "debug-sku-delivery-evidence/v2") return [];
  const receipt = source.runtimeDeliveryReceipt;
  const exportReadback = source.skuExportReadback;
  const editableReadback = source.skuEditableDeliveryReadback;
  const expectedRasterRefs = Array.isArray(caseSpec.oracle?.outputInventory?.expectedRasterRefs)
    ? caseSpec.oracle.outputInventory.expectedRasterRefs.map(normalizeRelativePath)
    : [];
  const expectedEditableRefs = Array.isArray(caseSpec.oracle?.outputInventory?.expectedEditableRefs)
    ? caseSpec.oracle.outputInventory.expectedEditableRefs.map(normalizeRelativePath)
    : [];
  const expectedCount = Number(caseSpec.oracle?.outputInventory?.exactRasterExports);
  const expectedEditableCount = Number(caseSpec.oracle?.outputInventory?.exactEditableDocuments);
  const expectedFinalRefs = [...expectedRasterRefs, ...expectedEditableRefs];
  if (!Number.isInteger(expectedCount)
    || expectedCount <= 0
    || expectedEditableCount !== expectedCount
    || expectedRasterRefs.length !== expectedCount
    || expectedEditableRefs.length !== expectedCount
    || !isRecord(receipt)
    || receipt.status !== "ready"
    || receipt.settlementScope !== "multi_document_task"
    || !Array.isArray(receipt.outputs)
    || !["editable_sku_batch_documents", "sku_images", "sku_manifest", "review_report"]
      .every((output) => receipt.outputs.includes(output))
    || !Array.isArray(receipt.resultRefs)
    || receipt.resultRefs.length !== expectedCount
    || new Set(receipt.resultRefs).size !== expectedCount
    || !Array.isArray(receipt.resultRefProofs)
    || receipt.resultRefProofs.length !== expectedCount
    || !receipt.resultRefProofs.every((proof) => (
      isRecord(proof)
      && proof.effect === "save_export"
      && receipt.resultRefs.includes(proof.resultRef)
    ))
    || !Array.isArray(receipt.artifacts)
    || receipt.artifacts.length !== expectedCount * 2
    || !exactRefSetMatches(bindingProof.finalArtifactRefs, expectedFinalRefs)) {
    return [];
  }
  const rasterArtifacts = receipt.artifacts.filter((artifact) => (
    artifact?.kind === "raster_export" && artifact?.proof === "file_probe"
  ));
  const editableArtifacts = receipt.artifacts.filter((artifact) => (
    artifact?.kind === "editable_document"
    && artifact?.proof === "staged_editable_document_promotion"
  ));
  const artifactByRef = new Map();
  for (const artifact of receipt.artifacts) {
    if (!isRecord(artifact)) return [];
    const ref = normalizeRelativePath(artifact?.path);
    const sha256 = cleanString(artifact?.fileIdentity?.sha256).toLowerCase();
    const byteLength = Number(artifact?.fileIdentity?.byteLength);
    const documentId = Number(artifact?.sourceHistoryStateRef?.documentId);
    const historyStateId = Number(artifact?.sourceHistoryStateRef?.historyStateId);
    if (!ref
      || artifactByRef.has(ref)
      || !/^[a-f0-9]{64}$/.test(sha256)
      || !Number.isSafeInteger(byteLength)
      || byteLength <= 0
      || !Number.isSafeInteger(documentId)
      || documentId <= 0
      || !Number.isSafeInteger(historyStateId)
      || historyStateId <= 0) {
      return [];
    }
    artifactByRef.set(ref, {
      ...artifact,
      ref,
      fileIdentity: { sha256, byteLength },
      sourceHistoryStateRef: { documentId, historyStateId }
    });
  }
  if (rasterArtifacts.length !== expectedCount
    || editableArtifacts.length !== expectedCount
    || !exactRefSetMatches(rasterArtifacts.map((artifact) => artifact.path), expectedRasterRefs)
    || !exactRefSetMatches(editableArtifacts.map((artifact) => artifact.path), expectedEditableRefs)
    || !isRecord(exportReadback)
    || exportReadback.version !== "sku-export-readback/v0"
    || exportReadback.status !== "ready_for_review"
    || exportReadback.expectedExportCount !== expectedCount
    || exportReadback.actualExportCount !== expectedCount
    || exportReadback.fileProbeCount !== expectedCount
    || exportReadback.okFileProbeCount !== expectedCount
    || exportReadback.failedFileProbeCount !== 0
    || exportReadback.missingFileProbeCount !== 0
    || exportReadback.dimensionMismatchCount !== 0
    || exportReadback.staleFileProbeCount !== 0
    || exportReadback.visualMetricBlockerCount !== 0
    || exportReadback.missingVisualMetricCount !== 0
    || !isRecord(editableReadback)
    || editableReadback.version !== "sku-editable-delivery-readback/v1"
    || editableReadback.status !== "ready"
    || editableReadback.expectedCount !== expectedCount
    || editableReadback.verifiedCount !== expectedCount
    || !exactRefSetMatches(editableReadback.expectedPaths, expectedEditableRefs)
    || !exactRefSetMatches(editableReadback.verifiedPaths, expectedEditableRefs)
    || !Array.isArray(editableReadback.missingItemIds)
    || editableReadback.missingItemIds.length !== 0
    || !Array.isArray(editableReadback.violations)
    || editableReadback.violations.length !== 0
    || !Array.isArray(editableReadback.items)
    || editableReadback.items.length !== expectedCount) {
    return [];
  }
  const itemIds = new Set();
  const itemRasterRefs = [];
  const itemEditableRefs = [];
  for (const item of editableReadback.items) {
    const rasterRef = normalizeRelativePath(item?.rasterPath);
    const editableRef = normalizeRelativePath(item?.editablePath);
    const rasterArtifact = artifactByRef.get(rasterRef);
    const editableArtifact = artifactByRef.get(editableRef);
    const itemSha256 = cleanString(item?.fileIdentity?.sha256).toLowerCase();
    const itemByteLength = Number(item?.fileIdentity?.byteLength);
    if (!isRecord(item)
      || !cleanString(item.itemId)
      || itemIds.has(item.itemId)
      || item.promotionVerified !== true
      || !["new_path", "modified_since_baseline"].includes(item.freshnessProof)
      || !cleanString(item.templateName)
      || !Array.isArray(item.combination)
      || item.combination.length === 0
      || !Array.isArray(item.copiedLayerIds)
      || !Array.isArray(item.copiedLayerNames)
      || item.copiedLayerIds.length !== item.combination.length
      || item.copiedLayerNames.length !== item.combination.length
      || item.copiedLayerIds.some((layerId) => !Number.isSafeInteger(layerId) || layerId <= 0)
      || item.copiedLayerNames.some((name) => !cleanString(name))
      || !isRecord(item.sourceHistoryStateRef)
      || !Number.isSafeInteger(item.sourceHistoryStateRef.documentId)
      || item.sourceHistoryStateRef.documentId <= 0
      || !Number.isSafeInteger(item.sourceHistoryStateRef.historyStateId)
      || item.sourceHistoryStateRef.historyStateId <= 0
      || !rasterArtifact
      || !editableArtifact
      || !/^[a-f0-9]{64}$/.test(itemSha256)
      || !Number.isSafeInteger(itemByteLength)
      || itemByteLength <= 0
      || editableArtifact.fileIdentity.sha256 !== itemSha256
      || editableArtifact.fileIdentity.byteLength !== itemByteLength
      || rasterArtifact.sourceHistoryStateRef.documentId !== item.sourceHistoryStateRef.documentId
      || rasterArtifact.sourceHistoryStateRef.historyStateId !== item.sourceHistoryStateRef.historyStateId
      || editableArtifact.sourceHistoryStateRef.documentId !== item.sourceHistoryStateRef.documentId
      || editableArtifact.sourceHistoryStateRef.historyStateId !== item.sourceHistoryStateRef.historyStateId) {
      return [];
    }
    itemIds.add(item.itemId);
    itemRasterRefs.push(normalizeRelativePath(item.rasterPath));
    itemEditableRefs.push(normalizeRelativePath(item.editablePath));
  }
  if (!exactRefSetMatches(itemRasterRefs, expectedRasterRefs)
    || !exactRefSetMatches(itemEditableRefs, expectedEditableRefs)) {
    return [];
  }
  const rasterEvidence = evidenceRefs.filter((evidence) => (
    evidence.kind === "raster_export" && evidence.verified === true
  ));
  const editableEvidence = evidenceRefs.filter((evidence) => (
    evidence.kind === "editable_psd" && evidence.verified === true
  ));
  if (!exactRefSetMatches(rasterEvidence.map((evidence) => evidence.ref), expectedRasterRefs)
    || !exactRefSetMatches(editableEvidence.map((evidence) => evidence.ref), expectedEditableRefs)) {
    return [];
  }
  const evidenceByRef = new Map(
    [...rasterEvidence, ...editableEvidence].map((evidence) => [normalizeRelativePath(evidence.ref), evidence])
  );
  for (const [ref, artifact] of artifactByRef) {
    const evidence = evidenceByRef.get(ref);
    const expectedKind = artifact.kind === "raster_export" ? "raster_export" : "editable_psd";
    if (!evidence
      || evidence.kind !== expectedKind
      || cleanString(evidence.digest).toLowerCase() !== `sha256:${artifact.fileIdentity.sha256}`
      || Number(evidence.size) !== artifact.fileIdentity.byteLength) {
      return [];
    }
  }
  const pairedReceiptFact = {
    outputs: receipt.outputs,
    resultRefs: receipt.resultRefs,
    resultRefProofs: receipt.resultRefProofs,
    artifacts: receipt.artifacts
  };
  const structureFact = editableReadback.items.map((item) => ({
    itemId: item.itemId,
    editablePath: item.editablePath,
    templateName: item.templateName,
    combination: item.combination,
    sourceHistoryStateRef: item.sourceHistoryStateRef,
    fileIdentity: item.fileIdentity,
    copiedLayerIds: item.copiedLayerIds,
    copiedLayerNames: item.copiedLayerNames
  }));
  const visualFact = {
    exportReadback,
    rasterArtifacts: rasterEvidence.map((evidence) => ({
      ref: evidence.ref,
      digest: evidence.digest,
      artifactMetadata: evidence.artifactMetadata
    }))
  };
  const pairFact = editableReadback.items.map((item) => ({
    itemId: item.itemId,
    rasterPath: item.rasterPath,
    editablePath: item.editablePath,
    sourceHistoryStateRef: item.sourceHistoryStateRef,
    rasterFileIdentity: artifactByRef.get(normalizeRelativePath(item.rasterPath))?.fileIdentity,
    editableFileIdentity: item.fileIdentity
  }));
  return [{
    kind: "paired_editable_delivery_receipt",
    ref: "receipt:sku-paired-editable-delivery",
    digest: sha256Text(stableStringify(pairedReceiptFact)),
    count: expectedCount,
    verified: true
  }, {
    kind: "sku_structure_readback_set",
    ref: "receipt:sku-structure-readback-set",
    digest: sha256Text(stableStringify(structureFact)),
    count: structureFact.length,
    verified: true
  }, {
    kind: "sku_visual_readback_set",
    ref: "receipt:sku-visual-readback-set",
    digest: sha256Text(stableStringify(visualFact)),
    count: rasterEvidence.length,
    verified: true
  }, {
    kind: "sku_pair_binding",
    ref: "receipt:sku-pair-binding",
    digest: sha256Text(stableStringify(pairFact)),
    count: pairFact.length,
    verified: true
  }];
}

async function outputEvidenceFromChanges(
  caseSpec,
  fixtureRoot,
  changedRefs,
  bindingProof,
  integrityBefore,
  integrityAfter
) {
  const evidenceRefs = [{
    kind: "fixture_instance",
    ref: `receipt:fixture-instance:${bindingProof.fixtureInstance.instanceId}`,
    digest: sha256Text(stableStringify(bindingProof.fixtureInstance)),
    verified: bindingProof.fixtureInstanceVerified === true
  }, {
    kind: "runtime_model_identity",
    ref: "receipt:runtime-model-identity",
    digest: bindingProof.modelIdentityDigest,
    verified: bindingProof.modelIdentityVerified === true
  }, {
    kind: "expected_project_binding",
    ref: "receipt:expected-project-binding",
    digest: bindingProof.projectBindingDigest,
    verified: bindingProof.projectBindingVerified === true
  }, {
    kind: "source_input_integrity",
    ref: "receipt:source-input-integrity",
    digest: sha256Text(`${integrityBefore.fixtureDigest}|${integrityAfter.fixtureDigest}`),
    verified: integrityBefore.fixtureDigest === integrityAfter.fixtureDigest
  }];
  const inputRefs = new Set(caseSpec.task.agentVisibleInputs.map((item) => normalizeRelativePath(item.ref)));
  const outputRefs = changedRefs.filter((ref) => !inputRefs.has(ref));
  for (const ref of outputRefs) {
    const extension = path.extname(ref).toLowerCase();
    let kind = "";
    if (extension === ".psd" || extension === ".psb") kind = "editable_psd";
    if ([".jpg", ".jpeg", ".png", ".webp"].includes(extension)) kind = "raster_export";
    if (!kind) continue;
    const absolutePath = resolveInside(fixtureRoot, ref);
    const metadata = kind === "editable_psd"
      ? inspectEditablePsd(absolutePath)
      : await sharp(absolutePath, { failOn: "error" }).metadata();
    if (!artifactGeometryMatchesCase(caseSpec, metadata)) continue;
    evidenceRefs.push({
      kind,
      ref,
      digest: fileSha256(absolutePath),
      size: fs.statSync(absolutePath).size,
      verified: true,
      artifactMetadata: {
        format: cleanString(metadata?.format) || extension.slice(1),
        width: metadata.width,
        height: metadata.height,
        ...(Number.isFinite(metadata.channels) ? { channels: metadata.channels } : {}),
        ...(Number.isFinite(metadata.depth) ? { depth: metadata.depth } : {}),
        ...(Number.isFinite(metadata.layerCount) ? { layerCount: metadata.layerCount } : {}),
        ...(metadata.completeParseVerified === true ? { completeParseVerified: true } : {})
      }
    });
  }
  const finalArtifactRefs = normalizeDeclaredFinalArtifactRefs(bindingProof.finalArtifactRefs);
  if (caseSpec.taskFamily === "sku") {
    const rasterRefs = finalArtifactRefs.filter((ref) => (
      evidenceRefs.some((item) => item.kind === "raster_export" && item.ref === ref && item.verified === true)
    )).sort();
    const expectedCount = Number(caseSpec.oracle?.outputInventory?.exactRasterExports);
    const expectedRefs = [...new Set(
      Array.isArray(caseSpec.oracle?.outputInventory?.expectedRasterRefs)
        ? caseSpec.oracle.outputInventory.expectedRasterRefs.map(normalizeRelativePath)
        : []
    )].sort();
    evidenceRefs.push({
      kind: "sku_output_inventory",
      ref: "receipt:sku-output-inventory",
      digest: sha256Text(stableStringify(rasterRefs)),
      count: rasterRefs.length,
      expectedCount: Number.isInteger(expectedCount) ? expectedCount : undefined,
      verified: Number.isInteger(expectedCount)
        && rasterRefs.length === expectedCount
        && expectedRefs.length === expectedCount
        && stableStringify(rasterRefs) === stableStringify(expectedRefs),
      expectedRefsDigest: sha256Text(stableStringify(expectedRefs))
    });
    evidenceRefs.push(...buildSkuLiveDeliveryEvidence(caseSpec, bindingProof, evidenceRefs));
  }
  return {
    evidenceRefs,
    finalArtifactManifest: buildAgentFinalArtifactManifest(finalArtifactRefs, evidenceRefs)
  };
}

function recordRun(suite, args) {
  const caseSpec = findCase(suite, args.get("--case"));
  if (caseSpec.status !== "active") {
    throw new Error(`record-run 只接受 active Case；${caseSpec.caseId} 当前为 ${caseSpec.status}。`);
  }
  const runRecordPaths = args.getAll("--run-record").map((item) => path.resolve(item));
  if (runRecordPaths.length === 0) throw new Error("record-run 至少需要一个 --run-record。 ");
  const runRecords = runRecordPaths.map((filePath) => readJson(filePath));
  const fixtureRoot = path.resolve(args.get("--fixture-root"));
  if (!fs.existsSync(fixtureRoot) || !fs.statSync(fixtureRoot).isDirectory()) {
    throw new Error("record-run 需要有效的 --fixture-root，用于验证产物且不会把绝对路径写入 sidecar。 ");
  }
  const fixture = inspectFixture([caseSpec], fixtureRoot);
  if (!fixture.ready) throw new Error(`fixture 缺少输入：${fixture.missing.join("、")}`);
  const runtimeModelIdentity = readRunModelIdentity(runRecords);
  const requestedProvider = args.get("--provider");
  const requestedModelId = args.get("--model");
  if (runtimeModelIdentity.ok && (
    (requestedProvider && requestedProvider !== runtimeModelIdentity.identity.provider)
    || (requestedModelId && requestedModelId !== runtimeModelIdentity.identity.modelId)
  )) {
    throw new Error("手工填写的 Provider / Model 与 RunRecord Runtime 身份不一致。");
  }
  const environment = {
    ...readGitEnvironment(),
    provider: runtimeModelIdentity.ok ? runtimeModelIdentity.identity.provider : "unknown",
    modelId: runtimeModelIdentity.ok ? runtimeModelIdentity.identity.modelId : "unknown"
  };
  const evidenceRefs = parseEvidenceArgs(args, fixtureRoot);
  const finalArtifactManifest = buildAgentFinalArtifactManifest(
    args.getAll("--final-artifact"),
    evidenceRefs
  );
  const observation = deriveDesignReliabilityRunObservation({
    caseSpec,
    runRecords,
    expectedProjectPath: fixtureRoot,
    cohortId: args.get("--cohort", "candidate"),
    repeatIndex: Number(args.get("--repeat", "1")),
    userInterventionCount: args.get("--user-interventions") === ""
      ? undefined
      : Number(args.get("--user-interventions")),
    fixtureDigest: fixture.fixtureDigest,
    environment,
    evidenceRefs,
    finalArtifactManifest
  });
  const validation = validateDesignReliabilityRun(observation);
  if (!validation.ok) throw new Error(validation.errors.join("；"));
  const outputPath = resolveSidecarOutputPath(
    DEFAULT_DATA_ROOT,
    ["runs", observation.cohortId],
    observation.runObservationId
  );
  writeJsonExclusive(outputPath, observation);
  return { observation, outputPath };
}

function parseScores(value) {
  const scores = {};
  for (const pair of String(value || "").split(",").map((item) => item.trim()).filter(Boolean)) {
    const separator = pair.indexOf("=");
    if (separator <= 0) throw new Error(`评分必须使用 dimension=0..1：${pair}`);
    const key = pair.slice(0, separator).trim();
    const number = Number(pair.slice(separator + 1));
    if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`评分越界：${pair}`);
    scores[key] = number;
  }
  return scores;
}

function parseComparisonEvidenceRefs(args) {
  const refs = [];
  const identities = new Set();
  for (const encoded of args.getAll("--comparison-evidence-ref")) {
    const separator = encoded.indexOf("=");
    if (separator <= 0) {
      throw new Error(`--comparison-evidence-ref 必须使用 kind=ref：${encoded}`);
    }
    const kind = cleanString(encoded.slice(0, separator));
    const ref = cleanString(encoded.slice(separator + 1));
    if (!COMPARISON_EVIDENCE_KINDS.includes(kind)) {
      throw new Error(`--comparison-evidence-ref kind 非法：${kind}`);
    }
    if (!ref) throw new Error(`--comparison-evidence-ref 缺少 ref：${encoded}`);
    const identity = `${kind}\u0000${ref}`;
    if (identities.has(identity)) throw new Error(`--comparison-evidence-ref 重复：${encoded}`);
    identities.add(identity);
    refs.push({ kind, ref });
  }
  return refs;
}

function recordReview(suite, args) {
  const runPath = path.resolve(args.get("--run-observation"));
  const run = readJson(runPath);
  const runValidation = validateDesignReliabilityRun(run);
  if (!runValidation.ok) throw new Error(`Run observation 不合法：${runValidation.errors.join("；")}`);
  const caseSpec = findCase(suite, run.caseRef.caseId);
  const rubric = suite.rubrics.find((item) => item.rubricId === caseSpec.oracle.rubricId);
  const decision = args.get("--decision");
  if (!REVIEW_DECISIONS.includes(decision)) throw new Error(`--decision 必须是 ${REVIEW_DECISIONS.join(" / ")}。`);
  const pairwiseOutcome = args.get("--pairwise", "unscorable");
  if (!PAIRWISE_OUTCOMES.includes(pairwiseOutcome)) {
    throw new Error(`--pairwise 必须是 ${PAIRWISE_OUTCOMES.join(" / ")}。`);
  }
  const scores = parseScores(args.get("--scores"));
  const rubricDimensions = new Set(rubric.dimensions.map((item) => item.id));
  for (const dimension of Object.keys(scores)) {
    if (!rubricDimensions.has(dimension)) throw new Error(`Rubric 不包含评分维度：${dimension}`);
  }
  if (decision !== "unscorable" && Object.keys(scores).length !== rubricDimensions.size) {
    throw new Error(`可评分结果必须填写全部 ${rubricDimensions.size} 个维度。`);
  }
  const weightedOverall = decision === "unscorable"
    ? undefined
    : calculateWeightedOverall(rubric, scores);
  if (decision !== "unscorable" && typeof weightedOverall !== "number") {
    throw new Error("当前 scores 无法按 rubric 自动计算 weightedOverall。 ");
  }
  const reviewerId = args.get("--reviewer");
  if (!reviewerId) throw new Error("--reviewer 不能为空，建议使用本地代号。 ");
  const comparisonEvidenceRefs = parseComparisonEvidenceRefs(args);
  const comparisonEvidenceKinds = [...new Set(comparisonEvidenceRefs.map((item) => item.kind))];
  const declaredComparisonEvidenceKinds = [
    ...new Set(args.getAll("--comparison-evidence-kind").map(cleanString).filter(Boolean))
  ];
  if (declaredComparisonEvidenceKinds.length > 0
    && declaredComparisonEvidenceKinds.slice().sort().join("\u0000")
      !== comparisonEvidenceKinds.slice().sort().join("\u0000")) {
    throw new Error("--comparison-evidence-kind 不能独立声明；必须与 --comparison-evidence-ref 一一对应。 ");
  }
  const findings = args.get("--findings-json") ? readJson(path.resolve(args.get("--findings-json"))) : [];
  const blockers = [...new Set(args.getAll("--blocker").map(cleanString).filter(Boolean))];
  const timestamp = new Date().toISOString();
  const reviewId = `${run.runObservationId}-${reviewerId}-${timestamp.replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  const review = {
    version: REVIEW_VERSION,
    reviewId,
    runObservationId: run.runObservationId,
    rubricId: rubric.rubricId,
    rubricDigest: buildRubricDigest(rubric),
    reviewerId,
    reviewedAt: timestamp,
    blindedToCohort: !args.hasFlag("--not-blinded"),
    blindedToCandidateOrigin: args.hasFlag("--blinded-to-candidate-origin"),
    evidenceProtocol: "bound_self_reported",
    evidenceRefs: [...new Set([
      ...args.getAll("--evidence-ref"),
      ...comparisonEvidenceRefs.map((item) => item.ref)
    ])],
    comparisonEvidenceKinds,
    comparisonEvidenceRefs,
    decision,
    scores,
    ...(weightedOverall !== undefined ? { weightedOverall } : {}),
    pairwiseOutcome,
    findings,
    blockers,
    confidence: args.get("--confidence", "medium"),
    missingEvidence: args.getAll("--missing-evidence"),
    boundaries: {
      devBenchmarkSidecarOnly: true,
      neverAffectsRuntime: true,
      humanOwnsAestheticVerdict: true
    }
  };
  const validation = validateDesignReliabilityReview(review, {
    rubric,
    caseSpec,
    run,
    enforceBlindProtocol: true
  });
  if (!validation.ok) throw new Error(validation.errors.join("；"));
  const outputPath = resolveSidecarOutputPath(
    DEFAULT_DATA_ROOT,
    ["reviews", run.runObservationId],
    reviewId
  );
  writeJsonExclusive(outputPath, review);
  return { review, outputPath };
}

function readReviewPacketContext(suite, args) {
  const caseId = args.get("--case");
  const runObservationPath = args.get("--run-observation");
  if (!caseId || !runObservationPath) {
    throw new Error("匿名评审包需要 --case 与 --run-observation。 ");
  }
  const caseSpec = findCase(suite, caseId);
  const run = readJson(path.resolve(runObservationPath));
  const rubric = suite.rubrics.find((item) => item.rubricId === caseSpec.oracle?.rubricId);
  if (!rubric) throw new Error(`Case ${caseId} 缺少 Rubric。`);
  return { caseSpec, run, rubric };
}

function parseReviewPacketSourceBindings(args) {
  const bindings = [];
  const bindingsJsonPath = args.get("--source-bindings-json");
  if (bindingsJsonPath) {
    const fromFile = readJson(path.resolve(bindingsJsonPath));
    if (!Array.isArray(fromFile)) {
      throw new Error("--source-bindings-json 必须是 [{evidenceRef,sourcePath}] 数组。 ");
    }
    bindings.push(...fromFile);
  }
  for (const encoded of args.getAll("--source-binding")) {
    const separator = encoded.indexOf("=");
    if (separator <= 0 || separator === encoded.length - 1) {
      throw new Error("--source-binding 格式必须是 evidenceRef=绝对文件路径。 ");
    }
    bindings.push({
      evidenceRef: encoded.slice(0, separator),
      sourcePath: encoded.slice(separator + 1)
    });
  }
  if (bindings.length === 0) {
    throw new Error("prepare-review-packet 需要 --source-bindings-json 或至少一个 --source-binding。 ");
  }
  return bindings;
}

function reviewBundleDirectory(packetId, bundleRoot = CANONICAL_REVIEW_BUNDLES_ROOT) {
  return resolveInside(bundleRoot, safePathSegment(packetId));
}

function markReviewDiskVerified(review) {
  Object.defineProperty(review, OFFICIAL_REVIEW_DISK_TRUST, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false
  });
  return review;
}

async function prepareAnonymousReviewPacket(suite, args, bundleRoot = CANONICAL_REVIEW_BUNDLES_ROOT) {
  if (!args.hasFlag("--allow-create")) {
    throw new Error("prepare-review-packet 需要显式 --allow-create；目标目录和密封映射均为 fail-if-exists。 ");
  }
  const reviewerPacketDirectory = args.get("--reviewer-packet-dir");
  if (!reviewerPacketDirectory) {
    throw new Error("prepare-review-packet 需要 --reviewer-packet-dir。 ");
  }
  const context = readReviewPacketContext(suite, args);
  const packetId = `review-packet-${crypto.randomBytes(16).toString("hex")}`;
  ensurePrivateDirectory(bundleRoot);
  const bundleDirectory = reviewBundleDirectory(packetId, bundleRoot);
  fs.mkdirSync(bundleDirectory, { mode: 0o700 });
  if (process.platform !== "win32") fs.chmodSync(bundleDirectory, 0o700);
  const sealedMappingPath = path.join(bundleDirectory, "sealed-mapping.json");
  const result = await createDesignReliabilityReviewPacket({
    ...context,
    sourceBindings: parseReviewPacketSourceBindings(args),
    reviewerPacketDirectory: path.resolve(reviewerPacketDirectory),
    sealedMappingPath,
    packetId
  });
  if (process.platform !== "win32") fs.chmodSync(sealedMappingPath, 0o600);
  writePrivateJsonExclusive(path.join(bundleDirectory, "preparation.json"), {
    version: "design-reliability-review-bundle-preparation/v1",
    packetId,
    packetDigest: result.packet.packetDigest,
    caseRef: {
      caseId: context.caseSpec.caseId,
      revision: context.caseSpec.revision,
      caseDigest: context.caseSpec.caseDigest
    },
    runObservationId: context.run.runObservationId,
    createdAt: result.packet.createdAt,
    boundaries: {
      privateCanonicalRecord: true,
      neverGiveToReviewer: true
    }
  });
  return {
    success: true,
    packetId: result.packet.packetId,
    packetDigest: result.packet.packetDigest,
    anonymousItemCount: result.packet.anonymousGroups.length,
    reviewerPacketDirectory: result.reviewerPacketDirectory,
    boundaries: {
      sealedMappingNotPrinted: true,
      sealedMappingStoredInCanonicalPrivateBundle: true,
      reviewerPacketContainsNoOriginMetadata: true,
      failIfExists: true
    }
  };
}

async function recordAnonymousReview(
  suite,
  args,
  dataRoot = DEFAULT_DATA_ROOT,
  bundleRoot = CANONICAL_REVIEW_BUNDLES_ROOT
) {
  const packetId = args.get("--packet-id");
  const reviewerPacketDirectory = args.get("--reviewer-packet-dir");
  const reviewerResponsePath = args.get("--reviewer-response");
  if (!packetId || !reviewerPacketDirectory || !reviewerResponsePath) {
    throw new Error("record-anonymous-review 需要 --packet-id、--reviewer-packet-dir 与 --reviewer-response。 ");
  }
  const context = readReviewPacketContext(suite, args);
  const bundleDirectory = reviewBundleDirectory(packetId, bundleRoot);
  const preparationPath = path.join(bundleDirectory, "preparation.json");
  const sealedMappingPath = path.join(bundleDirectory, "sealed-mapping.json");
  if (!fs.existsSync(preparationPath) || !fs.existsSync(sealedMappingPath)) {
    throw new Error(`packetId ${packetId} 没有完整的 canonical 私有准备记录。`);
  }
  const preparation = readJson(preparationPath);
  if (preparation.version !== "design-reliability-review-bundle-preparation/v1"
    || preparation.packetId !== packetId
    || preparation.runObservationId !== context.run.runObservationId
    || preparation.caseRef?.caseId !== context.caseSpec.caseId
    || preparation.caseRef?.revision !== context.caseSpec.revision
    || preparation.caseRef?.caseDigest !== context.caseSpec.caseDigest
    || preparation.boundaries?.privateCanonicalRecord !== true
    || preparation.boundaries?.neverGiveToReviewer !== true) {
    throw new Error("packetId 的私有准备记录与当前 Case / Run 不一致。 ");
  }
  const archivedPacketDirectory = path.join(bundleDirectory, "reviewer-packet");
  const archivedResponsePath = path.join(bundleDirectory, "reviewer-response.json");
  if (fs.existsSync(archivedPacketDirectory) || fs.existsSync(archivedResponsePath)) {
    throw new Error("该 packetId 已经归档过评审材料；official bundle 必须 fail-if-exists。 ");
  }
  fs.cpSync(path.resolve(reviewerPacketDirectory), archivedPacketDirectory, {
    recursive: true,
    errorOnExist: true,
    force: false
  });
  fs.copyFileSync(path.resolve(reviewerResponsePath), archivedResponsePath, fs.constants.COPYFILE_EXCL);
  hardenPrivateTree(archivedPacketDirectory);
  if (process.platform !== "win32") fs.chmodSync(archivedResponsePath, 0o600);
  const verifiedAt = new Date().toISOString();
  const result = await verifyDesignReliabilityReviewerResponse({
    ...context,
    reviewerPacketDirectory: archivedPacketDirectory,
    sealedMappingPath,
    reviewerResponsePath: archivedResponsePath,
    verifiedAt
  });
  if (result.verifiedPacketProof.packetDigest !== preparation.packetDigest) {
    throw new Error("归档 public packet 与 prepare 阶段冻结摘要不一致。 ");
  }
  const bundleManifest = {
    version: REVIEW_VERIFICATION_BUNDLE_VERSION,
    packetId,
    reviewId: result.review.reviewId,
    runObservationId: result.review.runObservationId,
    caseRef: result.verifiedPacketProof.caseRef,
    verifiedAt,
    files: {
      reviewerPacketDirectory: "reviewer-packet",
      sealedMapping: "sealed-mapping.json",
      reviewerResponse: "reviewer-response.json"
    },
    packetDigest: result.verifiedPacketProof.packetDigest,
    sealedMappingDigest: result.verifiedPacketProof.sealedMappingDigest,
    reviewerResponseDigest: result.verifiedPacketProof.reviewerResponseDigest,
    reviewProjectionDigest: result.verifiedPacketProof.reviewProjectionDigest,
    boundaries: {
      canonicalVerificationBundle: true,
      diskRevalidationRequiredForStrictMetrics: true,
      failIfExists: true
    }
  };
  bundleManifest.bundleDigest = sha256Text(stableStringify(bundleManifest));
  writePrivateJsonExclusive(path.join(bundleDirectory, "bundle.json"), bundleManifest);
  const outputPath = resolveSidecarOutputPath(
    dataRoot,
    ["reviews", result.review.runObservationId],
    result.review.reviewId
  );
  writeJsonExclusive(outputPath, result.review);
  markReviewDiskVerified(result.review);
  return {
    success: true,
    review: result.review,
    outputPath,
    packetId: result.verifiedPacketProof.packetId,
    evidenceProtocol: result.review.evidenceProtocol,
    boundaries: {
      strictTrustIsProcessLocal: true,
      bundlePathNotPrinted: true
    }
  };
}

function evaluateAttributableAttemptEvents(attemptId, events, suite) {
  return evaluateOfficialAttemptEligibility(attemptId, events, suite);
}

function resolveAttributionCliSubject(suite, args) {
  const runObservationPath = cleanString(args.get("--run-observation"));
  const attemptId = cleanString(args.get("--attempt-id"));
  if (Boolean(runObservationPath) === Boolean(attemptId)) {
    throw new Error("record-attribution 必须且只能提供 --run-observation 或 --attempt-id 其中一项。 ");
  }
  if (runObservationPath) {
    const run = readJson(path.resolve(runObservationPath));
    const runValidation = validateDesignReliabilityRun(run);
    if (!runValidation.ok) {
      throw new Error(`Run observation 不合法：${runValidation.errors.join("；")}`);
    }
    const caseSpec = findCase(suite, run.caseRef?.caseId);
    if (run.caseRef?.suiteId !== caseSpec.suiteId
      || run.caseRef?.revision !== caseSpec.revision
      || run.caseRef?.caseDigest !== caseSpec.caseDigest) {
      throw new Error("Run observation 不属于当前固定 Suite / Case revision。 ");
    }
    return {
      subject: { runObservationId: run.runObservationId },
      subjectId: run.runObservationId,
      outputSegments: ["attributions", "run-observations", run.runObservationId]
    };
  }

  const collected = collectSidecars([CANONICAL_ATTEMPT_EVENTS_ROOT], { strictAttemptEvents: true });
  const currentEvents = retainContextuallyValidAttemptEvents(
    collected.attemptEvents,
    suite,
    []
  ).filter((event) => event.attemptId === attemptId);
  const attemptVerdict = evaluateAttributableAttemptEvents(attemptId, currentEvents, suite);
  if (!attemptVerdict.valid) {
    throw new Error(
      `Attempt 不存在、尚未形成可归因终态，或不属于当前 Suite：${[
        ...(attemptVerdict.protocolIssues.length > 0
          ? attemptVerdict.protocolIssues
          : ["attempt_not_found"])
      ].join("、")}`
    );
  }
  return {
    subject: { attemptId },
    subjectId: attemptId,
    outputSegments: ["attributions", "attempts", attemptId]
  };
}

function recordAttribution(suite, args) {
  const subjectContext = resolveAttributionCliSubject(suite, args);
  const owner = args.get("--owner", "unknown");
  const failureMode = args.get("--failure-mode", "unknown");
  const status = args.get("--status", "hypothesis");
  if (!ATTRIBUTION_OWNERS.includes(owner)) throw new Error(`owner 非法：${owner}`);
  if (!FAILURE_MODES.includes(failureMode)) throw new Error(`failure-mode 非法：${failureMode}`);
  if (!ATTRIBUTION_STATUSES.includes(status)) throw new Error(`status 非法：${status}`);
  const rationale = args.get("--rationale");
  if (!rationale) throw new Error("--rationale 不能为空。 ");
  const timestamp = new Date().toISOString();
  const attributionId = `${subjectContext.subjectId}-${failureMode}-${timestamp.replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  const attribution = {
    version: ATTRIBUTION_VERSION,
    attributionId,
    subject: subjectContext.subject,
    symptomCode: args.get("--symptom", "unknown"),
    owner,
    failureMode,
    status,
    confidence: args.get("--confidence", "medium"),
    evidenceRefs: args.getAll("--evidence-ref"),
    rationale,
    attributedBy: args.get("--by", "engineer"),
    attributedAt: timestamp,
    boundaries: {
      devBenchmarkSidecarOnly: true,
      neverAffectsRuntime: true,
      cannotBecomeRuntimeGate: true
    }
  };
  const validation = validateDesignReliabilityAttribution(attribution);
  if (!validation.ok) throw new Error(validation.errors.join("；"));
  const outputPath = resolveSidecarOutputPath(
    DEFAULT_DATA_ROOT,
    subjectContext.outputSegments,
    attributionId
  );
  writeJsonExclusive(outputPath, attribution);
  return { attribution, outputPath };
}

function sidecarRoots(args) {
  const requested = args.getAll("--data-root").map((item) => path.resolve(item));
  // Attempt 安全账本始终由仓库外的 canonical DEFAULT_DATA_ROOT 提供；--data-root
  // 只能追加报告来源，不能把既有 armed / unknown-write / fixture 使用记录从
  // preflight 隐藏。仓库内旧 tmp 仅作历史报告兼容读取，不再承担正式分母。
  return [...new Set([
    DEFAULT_DATA_ROOT,
    LEGACY_DATA_ROOT,
    path.join(BENCHMARK_ROOT, "curated"),
    ...requested
  ])];
}

function resolveReliabilityEvidenceRoots(args) {
  return {
    reportRoots: sidecarRoots(args),
    canonicalAttemptRoots: [CANONICAL_ATTEMPT_EVENTS_ROOT]
  };
}

function retainContextuallyValidAttemptEvents(attemptEvents, suite, excludedEvidence) {
  const caseById = new Map(suite.cases.map((caseSpec) => [caseSpec.caseId, caseSpec]));
  const currentCaseSetDigest = buildSuiteCaseSetDigest(suite);
  const currentRubricSetDigest = buildSuiteRubricSetDigest(suite);
  const eventsByAttempt = new Map();
  for (const event of attemptEvents) {
    const current = eventsByAttempt.get(event.attemptId) || [];
    current.push(event);
    eventsByAttempt.set(event.attemptId, current);
  }
  const validEvents = [];
  for (const [attemptId, events] of eventsByAttempt.entries()) {
    // submission_started owns the official denominator. Decide whether an Attempt belongs to
    // the current Suite from that event (or armed for a pre-submit crash), then keep the whole
    // chain so later identity drift is diagnosed instead of silently removed from the denominator.
    const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
    const anchor = ordered.find((event) => event.eventType === "submission_started")
      || ordered.find((event) => event.eventType === "armed")
      || ordered[0];
    const caseSpec = caseById.get(anchor?.caseRef?.caseId);
    const current = Boolean(
      anchor
      && caseSpec
      && caseSpec.status === "active"
      && anchor.caseRef?.revision === caseSpec.revision
      && anchor.caseRef?.caseDigest === caseSpec.caseDigest
      && anchor.suiteCaseSetDigest === currentCaseSetDigest
      && anchor.suiteRubricSetDigest === currentRubricSetDigest
    );
    if (current) {
      validEvents.push(...events);
      continue;
    }
    excludedEvidence.push({
      kind: "attempt",
      id: attemptId,
      reason: "suite_or_case_revision_digest_not_current"
    });
  }
  return validEvents;
}

function retainContextuallyValidReviews(sidecars, suite) {
  const currentCases = new Map(suite.cases.map((caseSpec) => [caseSpec.caseId, caseSpec]));
  const validRuns = [];
  const excludedEvidence = Array.isArray(sidecars.excludedEvidence)
    ? [...sidecars.excludedEvidence]
    : [];
  for (const run of sidecars.runs) {
    const caseSpec = currentCases.get(run.caseRef?.caseId);
    const current = Boolean(
      caseSpec
      && caseSpec.status === "active"
      && run.caseRef?.suiteId === caseSpec.suiteId
      && run.caseRef?.revision === caseSpec.revision
      && run.caseRef?.caseDigest === caseSpec.caseDigest
    );
    if (current) {
      validRuns.push(run);
    } else {
      excludedEvidence.push({
        kind: "run_observation",
        id: run.runObservationId,
        reason: "case_revision_or_digest_not_current"
      });
    }
  }
  const validRunIds = new Set(validRuns.map((run) => run.runObservationId));
  const validAttemptEvents = retainContextuallyValidAttemptEvents(
    sidecars.attemptEvents,
    suite,
    excludedEvidence
  );
  const eventsByAttempt = new Map();
  for (const event of validAttemptEvents) {
    const current = eventsByAttempt.get(event.attemptId) || [];
    current.push(event);
    eventsByAttempt.set(event.attemptId, current);
  }
  const validAttemptIds = new Set([...eventsByAttempt.entries()]
    .filter(([attemptId, events]) => evaluateAttributableAttemptEvents(attemptId, events, suite).valid)
    .map(([attemptId]) => attemptId));
  const runById = new Map(validRuns.map((run) => [run.runObservationId, run]));
  const validReviews = [];
  for (const review of sidecars.reviews) {
    if (!validRunIds.has(review.runObservationId)) {
      excludedEvidence.push({
        kind: "human_review",
        id: review.reviewId,
        reason: "bound_run_not_current"
      });
      continue;
    }
    const run = runById.get(review.runObservationId);
    const caseSpec = run
      ? suite.cases.find((item) => item.caseId === run.caseRef?.caseId)
      : undefined;
    const rubric = caseSpec
      ? suite.rubrics.find((item) => item.rubricId === caseSpec.oracle?.rubricId)
      : undefined;
    if (!run || !caseSpec || !rubric) {
      sidecars.invalid.push({
        file: `review:${review.reviewId || "unknown"}`,
        errors: ["人工评审无法绑定到当前固定 Case、Run 与 rubric。"]
      });
      continue;
    }
    const validation = validateDesignReliabilityReview(review, { rubric, caseSpec, run });
    if (!validation.ok) {
      sidecars.invalid.push({
        file: `review:${review.reviewId || "unknown"}`,
        errors: validation.errors
      });
      continue;
    }
    validReviews.push(review);
  }
  const validAttributions = sidecars.attributions.filter((attribution) => {
    if (attributionMatchesDesignReliabilityCohort(attribution, {
      runObservationIds: validRunIds,
      attemptIds: validAttemptIds
    })) return true;
    const subject = resolveDesignReliabilityAttributionSubject(attribution);
    excludedEvidence.push({
      kind: "attribution",
      id: attribution.attributionId,
      reason: subject?.kind === "attempt"
        ? "bound_attempt_not_current"
        : "bound_run_not_current"
    });
    return false;
  });
  return {
    ...sidecars,
    runs: validRuns,
    reviews: validReviews,
    attributions: validAttributions,
    attemptEvents: validAttemptEvents,
    excludedEvidence
  };
}

function buildReviewBundleDigest(bundle) {
  const projection = JSON.parse(JSON.stringify(bundle));
  delete projection.bundleDigest;
  return sha256Text(stableStringify(projection));
}

async function revalidateOfficialReviewBundles(
  sidecars,
  suite,
  bundleRoot = CANONICAL_REVIEW_BUNDLES_ROOT
) {
  const runById = new Map(sidecars.runs.map((run) => [run.runObservationId, run]));
  const reviews = sidecars.reviews.map((review) => JSON.parse(JSON.stringify(review)));
  const excludedEvidence = Array.isArray(sidecars.excludedEvidence)
    ? [...sidecars.excludedEvidence]
    : [];
  for (const review of reviews) {
    if (review.evidenceProtocol !== "anonymous_packet_verified") continue;
    const packetId = cleanString(review.verifiedPacketProof?.packetId);
    const run = runById.get(review.runObservationId);
    const caseSpec = run
      ? suite.cases.find((item) => item.caseId === run.caseRef?.caseId)
      : undefined;
    const rubric = caseSpec
      ? suite.rubrics.find((item) => item.rubricId === caseSpec.oracle?.rubricId)
      : undefined;
    try {
      if (!packetId || !run || !caseSpec || !rubric) {
        throw new Error("Review 缺少 canonical bundle 重验所需上下文。");
      }
      const bundleRootStat = fs.lstatSync(bundleRoot);
      if (!bundleRootStat.isDirectory() || bundleRootStat.isSymbolicLink()) {
        throw new Error("canonical review bundle root 不是普通目录。");
      }
      const bundleDirectory = reviewBundleDirectory(packetId, bundleRoot);
      const bundleStat = fs.lstatSync(bundleDirectory);
      if (!bundleStat.isDirectory() || bundleStat.isSymbolicLink()) {
        throw new Error("canonical review bundle 不是普通目录。");
      }
      assertPrivateTreePermissions(bundleDirectory);
      const bundle = readJson(path.join(bundleDirectory, "bundle.json"));
      if (bundle.version !== REVIEW_VERIFICATION_BUNDLE_VERSION
        || bundle.packetId !== packetId
        || bundle.reviewId !== review.reviewId
        || bundle.runObservationId !== review.runObservationId
        || bundle.caseRef?.caseId !== caseSpec.caseId
        || bundle.caseRef?.revision !== caseSpec.revision
        || bundle.caseRef?.caseDigest !== caseSpec.caseDigest
        || bundle.bundleDigest !== buildReviewBundleDigest(bundle)
        || bundle.files?.reviewerPacketDirectory !== "reviewer-packet"
        || bundle.files?.sealedMapping !== "sealed-mapping.json"
        || bundle.files?.reviewerResponse !== "reviewer-response.json"
        || bundle.boundaries?.canonicalVerificationBundle !== true
        || bundle.boundaries?.diskRevalidationRequiredForStrictMetrics !== true
        || bundle.boundaries?.failIfExists !== true) {
        throw new Error("canonical review bundle manifest 不完整或摘要不匹配。");
      }
      const result = await verifyDesignReliabilityReviewerResponse({
        caseSpec,
        run,
        rubric,
        reviewerPacketDirectory: path.join(bundleDirectory, "reviewer-packet"),
        sealedMappingPath: path.join(bundleDirectory, "sealed-mapping.json"),
        reviewerResponsePath: path.join(bundleDirectory, "reviewer-response.json"),
        verifiedAt: bundle.verifiedAt
      });
      if (stableStringify(result.review) !== stableStringify(review)
        || result.verifiedPacketProof.packetDigest !== bundle.packetDigest
        || result.verifiedPacketProof.sealedMappingDigest !== bundle.sealedMappingDigest
        || result.verifiedPacketProof.reviewerResponseDigest !== bundle.reviewerResponseDigest
        || result.verifiedPacketProof.reviewProjectionDigest !== bundle.reviewProjectionDigest) {
        throw new Error("canonical bundle 重验结果与持久化 Review 不一致。");
      }
      markReviewDiskVerified(review);
    } catch (error) {
      excludedEvidence.push({
        kind: "human_review",
        id: review.reviewId,
        reason: "official_review_bundle_unverified",
        detail: sanitizeAttemptDiagnostic(error instanceof Error ? error.message : String(error))
      });
    }
  }
  return {
    ...sidecars,
    reviews,
    excludedEvidence
  };
}

function isStrictBlindReview(review) {
  return review?.evidenceProtocol === "anonymous_packet_verified"
    && review?.blindedToCohort === true
    && review?.blindedToCandidateOrigin === true
    && Number.isFinite(review?.weightedOverall)
    && Array.isArray(review?.comparisonEvidenceRefs)
    && review.comparisonEvidenceRefs.length > 0
    && Array.isArray(review?.blockers)
    && review[OFFICIAL_REVIEW_DISK_TRUST] === true;
}

function buildStrictReviewVerdicts(reviews) {
  const byRun = new Map();
  for (const review of reviews.filter(isStrictBlindReview)) {
    const current = byRun.get(review.runObservationId) || [];
    current.push(review);
    byRun.set(review.runObservationId, current);
  }
  const verdicts = new Map();
  for (const [runObservationId, runReviews] of byRun.entries()) {
    verdicts.set(runObservationId, resolveStrictReviewRunVerdict(runReviews));
  }
  return verdicts;
}

function validateAttemptEventStateMachine(attemptId, ordered) {
  const issues = [];
  const expectedTypes = ["armed", "submission_started", "terminal", "reconciled"];
  let previousOccurredAt = null;
  for (let index = 0; index < ordered.length; index += 1) {
    const event = ordered[index];
    const expectedSequence = index + 1;
    const expectedType = expectedTypes[index];
    if (event.sequence !== expectedSequence) issues.push("attempt_sequence_invalid");
    if (event.eventType !== expectedType) issues.push("attempt_transition_invalid");
    if (event.eventId !== `${attemptId}:${event.sequence}:${event.eventType}`) {
      issues.push("attempt_event_id_invalid");
    }
    const occurredAt = Date.parse(event.occurredAt);
    if (!Number.isFinite(occurredAt)) {
      issues.push("attempt_occurred_at_invalid");
    } else if (previousOccurredAt !== null && occurredAt < previousOccurredAt) {
      issues.push("attempt_time_not_monotonic");
    }
    if (Number.isFinite(occurredAt)) previousOccurredAt = occurredAt;
  }
  if (ordered.length > expectedTypes.length) issues.push("attempt_event_count_exceeded");
  const terminal = ordered.find((event) => event.eventType === "terminal");
  const reconciliation = ordered.find((event) => event.eventType === "reconciled");
  if (reconciliation && !String(terminal?.status || "").includes("unknown_write_state")) {
    issues.push("reconciliation_requires_unknown_write_terminal");
  }
  return [...new Set(issues)];
}

function buildAttemptEventIdentityKey(event) {
  return stableStringify({
    attemptId: event?.attemptId,
    caseRef: event?.caseRef,
    cohortId: event?.cohortId,
    repeatIndex: event?.repeatIndex,
    provider: event?.provider,
    modelId: event?.modelId,
    timeoutMs: event?.timeoutMs,
    fixtureRef: event?.fixtureRef,
    environment: event?.environment,
    instructionDigest: event?.instructionDigest,
    rubricDigest: event?.rubricDigest,
    suiteCaseSetDigest: event?.suiteCaseSetDigest,
    suiteRubricSetDigest: event?.suiteRubricSetDigest,
    cohortFingerprint: event?.cohortFingerprint,
    attemptFingerprint: event?.attemptFingerprint,
    liveRunProtocol: event?.liveRunProtocol
  });
}

function evaluateOfficialAttemptEligibility(attemptId, events, suite) {
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  const eventTypeCounts = ordered.reduce((counts, event) => {
    counts[event.eventType] = (counts[event.eventType] || 0) + 1;
    return counts;
  }, {});
  const issues = validateAttemptEventStateMachine(attemptId, ordered);
  if (eventTypeCounts.armed !== 1) issues.push("armed_event_count_invalid");
  if (eventTypeCounts.submission_started !== 1) issues.push("submission_event_count_invalid");
  if (eventTypeCounts.terminal !== 1) issues.push("terminal_event_count_invalid");
  if ((eventTypeCounts.reconciled || 0) > 1) issues.push("reconciliation_event_count_invalid");
  if (new Set(ordered.map(buildAttemptEventIdentityKey)).size !== 1) {
    issues.push("attempt_identity_drift");
  }
  for (const event of ordered) {
    const validation = validateLiveAttemptEvent(event);
    if (!validation.ok) issues.push(...validation.errors.map((error) => `event_invalid:${error}`));
  }
  const anchor = ordered.find((event) => event.eventType === "submission_started")
    || ordered.find((event) => event.eventType === "armed")
    || ordered[0];
  const caseSpec = suite?.cases?.find((item) => item.caseId === anchor?.caseRef?.caseId);
  const rubric = caseSpec
    ? suite?.rubrics?.find((item) => item.rubricId === caseSpec.oracle?.rubricId)
    : undefined;
  if (!caseSpec || caseSpec.status !== "active") {
    issues.push("case_not_current_active");
  } else {
    if (anchor.caseRef?.revision !== caseSpec.revision
      || anchor.caseRef?.caseDigest !== caseSpec.caseDigest) {
      issues.push("case_identity_mismatch");
    }
    if (anchor.suiteCaseSetDigest !== buildSuiteCaseSetDigest(suite)
      || anchor.suiteRubricSetDigest !== buildSuiteRubricSetDigest(suite)) {
      issues.push("suite_protocol_digest_mismatch");
    }
    if (anchor.instructionDigest !== sha256Text(caseSpec.task?.instruction || "")) {
      issues.push("instruction_digest_mismatch");
    }
    if (!rubric || anchor.rubricDigest !== buildRubricDigest(rubric)) {
      issues.push("rubric_digest_mismatch");
    }
    const expectedProtocol = resolveDesignReliabilityLiveRunProtocol(caseSpec);
    const expectedProtocolDigest = buildDesignReliabilityLiveRunProtocolDigest(caseSpec);
    if (anchor.liveRunProtocol?.kind !== expectedProtocol.kind
      || anchor.liveRunProtocol?.digest !== expectedProtocolDigest) {
      issues.push("live_run_protocol_identity_mismatch");
    }
    if (!resolveLiveRunActorCapability(caseSpec)) {
      issues.push("live_run_actor_capability_unavailable");
    }
  }
  if (!Number.isInteger(anchor?.repeatIndex) || anchor.repeatIndex < 1) {
    issues.push("repeat_index_invalid");
  }
  if (anchor?.environment?.dirty !== false) issues.push("runtime_git_state_not_clean");
  for (const fieldName of [
    "fixtureDigest",
    "workspaceSemanticDigest",
    "pathBindingDigest"
  ]) {
    if (!/^sha256:[a-f0-9]{64}$/.test(cleanString(anchor?.fixtureRef?.[fieldName]).toLowerCase())) {
      issues.push(`fixture_${fieldName}_invalid`);
    }
  }
  if (!cleanString(anchor?.fixtureRef?.instanceId)) issues.push("fixture_instance_id_missing");
  const derivedCohortFingerprint = anchor && suite
    ? deriveLiveCohortFingerprint({
        suiteId: suite.manifest?.suiteId,
        suiteCaseSetDigest: anchor.suiteCaseSetDigest,
        suiteRubricSetDigest: anchor.suiteRubricSetDigest,
        environment: anchor.environment,
        provider: anchor.provider,
        modelId: anchor.modelId,
        timeoutMs: anchor.timeoutMs
      })
    : "";
  if (!derivedCohortFingerprint || anchor?.cohortFingerprint !== derivedCohortFingerprint) {
    issues.push("cohort_fingerprint_mismatch");
  }
  const derivedAttemptFingerprint = anchor
    ? deriveLiveAttemptFingerprint({
        cohortFingerprint: derivedCohortFingerprint,
        caseRef: anchor.caseRef,
        fixtureRef: anchor.fixtureRef,
        instructionDigest: anchor.instructionDigest,
        rubricDigest: anchor.rubricDigest,
        liveRunProtocol: anchor.liveRunProtocol,
        repeatIndex: anchor.repeatIndex
      })
    : "";
  if (!derivedAttemptFingerprint || anchor?.attemptFingerprint !== derivedAttemptFingerprint) {
    issues.push("attempt_fingerprint_mismatch");
  }
  return {
    valid: ordered.length > 0 && issues.length === 0,
    ordered,
    anchor,
    caseSpec,
    derivedCohortFingerprint,
    derivedAttemptFingerprint,
    protocolIssues: [...new Set(issues)]
  };
}

function runObservationMatchesAttempt(run, event, caseSpec, attemptId) {
  if (!run || !event || !caseSpec) return false;
  const dimensions = run.cohortDimensions || {};
  const runAttempt = run.attempt || {};
  const environment = event.environment || {};
  return run.cohortId === event.cohortId
    && run.caseRef?.suiteId === caseSpec.suiteId
    && run.caseRef?.caseId === event.caseRef?.caseId
    && run.caseRef?.revision === event.caseRef?.revision
    && run.caseRef?.caseDigest === event.caseRef?.caseDigest
    && runAttempt.attemptId === attemptId
    && runAttempt.attemptFingerprint === event.attemptFingerprint
    && runAttempt.repeatIndex === event.repeatIndex
    && dimensions.fixtureInstanceId === event.fixtureRef?.instanceId
    && dimensions.fixtureDigest === event.fixtureRef?.fixtureDigest
    && dimensions.workspaceSemanticDigest === event.fixtureRef?.workspaceSemanticDigest
    && dimensions.provider === event.provider
    && dimensions.requestedModelId === event.modelId
    && dimensions.gitCommit === environment.gitCommit
    && dimensions.dirty === false
    && environment.dirty === false
    && dimensions.runtimeGitCommit === environment.runtimeGitCommit
    && dimensions.runtimeBuildId === environment.runtimeBuildId
    && dimensions.runtimeAppVersion === environment.runtimeAppVersion
    && dimensions.photoshopRuntimeBuildId === environment.photoshopRuntimeBuildId
    && dimensions.photoshopRuntimeBindingDigest === environment.photoshopRuntimeBindingDigest
    && dimensions.timeoutMs === event.timeoutMs
    && dimensions.instructionDigest === event.instructionDigest
    && dimensions.rubricDigest === event.rubricDigest
    && dimensions.suiteCaseSetDigest === event.suiteCaseSetDigest
    && dimensions.suiteRubricSetDigest === event.suiteRubricSetDigest
    && dimensions.cohortFingerprint === event.cohortFingerprint
    && dimensions.liveRunProtocolKind === event.liveRunProtocol?.kind
    && dimensions.liveRunProtocolDigest === event.liveRunProtocol?.digest;
}

function buildLiveAttemptCoverage(attemptEvents, runs, suite, reviews = []) {
  const caseById = new Map(suite.cases.map((caseSpec) => [caseSpec.caseId, caseSpec]));
  const runById = new Map(runs.map((run) => [run.runObservationId, run]));
  const strictReviewVerdicts = buildStrictReviewVerdicts(reviews);
  const attempts = new Map();
  for (const event of attemptEvents) {
    const current = attempts.get(event.attemptId) || [];
    current.push(event);
    attempts.set(event.attemptId, current);
  }
  const summaries = [];
  for (const [attemptId, events] of attempts.entries()) {
    const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
    const armed = ordered.find((event) => event.eventType === "armed");
    const submitted = ordered.find((event) => event.eventType === "submission_started");
    const terminals = ordered.filter((event) => event.eventType === "terminal");
    const terminal = terminals.at(-1);
    const reconciliations = ordered.filter((event) => event.eventType === "reconciled");
    const reconciliation = reconciliations.at(-1);
    const caseId = reconciliation?.caseRef?.caseId
      || terminal?.caseRef?.caseId
      || submitted?.caseRef?.caseId
      || armed?.caseRef?.caseId;
    const caseSpec = caseById.get(caseId);
    const eligibility = evaluateOfficialAttemptEligibility(attemptId, ordered, suite);
    const protocolIssues = [...eligibility.protocolIssues];
    const runObservationId = cleanString(terminal?.runObservationId) || null;
    const linkedRun = runObservationId ? runById.get(runObservationId) : undefined;
    const identityEvent = eligibility.anchor || terminal || submitted || armed;
    const linkedRunValid = runObservationMatchesAttempt(
      linkedRun,
      identityEvent,
      caseSpec,
      attemptId
    );
    const terminalClaimsTechnicalPass = terminal?.status === "technical_delivery_passed";
    if (terminalClaimsTechnicalPass && !linkedRunValid) {
      protocolIssues.push("technical_pass_run_observation_missing");
    }
    const fixtureDigest = cleanString(identityEvent?.fixtureRef?.fixtureDigest).toLowerCase();
    const workspaceSemanticDigest = cleanString(
      identityEvent?.fixtureRef?.workspaceSemanticDigest
    ).toLowerCase();
    const fixtureIdentityDigest = /^sha256:[a-f0-9]{64}$/.test(fixtureDigest)
      && /^sha256:[a-f0-9]{64}$/.test(workspaceSemanticDigest)
      ? sha256Text(stableStringify({ fixtureDigest, workspaceSemanticDigest }))
      : null;
    const unknownWriteIncident = String(terminal?.status || "").includes("unknown_write_state");
    const interactionMetricsKnown = terminal?.interactionMetricsKnown === true;
    const reviewVerdict = linkedRunValid
      ? strictReviewVerdicts.get(runObservationId)
      : undefined;
    summaries.push({
      attemptId,
      caseId,
      repeatIndex: Number.isInteger(identityEvent?.repeatIndex) ? identityEvent.repeatIndex : null,
      taskFamily: caseSpec?.taskFamily || "unknown",
      cohortId: terminal?.cohortId || submitted?.cohortId || armed?.cohortId || "unknown",
      cohortFingerprint: cleanString(
        terminal?.cohortFingerprint || submitted?.cohortFingerprint || armed?.cohortFingerprint
      ) || null,
      derivedCohortFingerprint: eligibility.derivedCohortFingerprint || null,
      fixtureIdentityDigest,
      controlProfile: identityEvent ? {
        provider: cleanString(identityEvent.provider),
        modelId: cleanString(identityEvent.modelId),
        timeoutMs: Number(identityEvent.timeoutMs)
      } : null,
      fixtureInstanceId: cleanString(
        terminal?.fixtureRef?.instanceId
        || submitted?.fixtureRef?.instanceId
        || armed?.fixtureRef?.instanceId
      ) || null,
      armed: Boolean(armed),
      submitted: Boolean(submitted),
      terminal: Boolean(terminal),
      reconciled: Boolean(reconciliation),
      duplicateTerminalCount: Math.max(0, terminals.length - 1),
      status: terminal?.status
        || (submitted ? "submitted_without_terminal" : "armed_not_submitted"),
      reconciliationStatus: reconciliation?.status || null,
      unknownWriteIncident,
      interactionMetricsKnown,
      protocolInteractionCount: interactionMetricsKnown
        ? Number(terminal?.protocolInteractionCount) || 0
        : null,
      userDesignCorrectionCount: interactionMetricsKnown
        ? Number(terminal?.userDesignCorrectionCount) || 0
        : null,
      runObservationId,
      linkedRunValid,
      protocolIssues,
      protocolValid: protocolIssues.length === 0,
      technicalDeliveryPassed: Boolean(
        protocolIssues.length === 0
        && terminalClaimsTechnicalPass
        && linkedRunValid
        && linkedRun?.observed?.technicalDeliveryPassed === true
      ),
      strictReviewReady: reviewVerdict?.reviewed === true && reviewVerdict.conflict !== true,
      strictReviewConflict: reviewVerdict?.conflict === true,
      commercialUsable: Boolean(
        terminalClaimsTechnicalPass
        && linkedRunValid
        && linkedRun?.observed?.technicalDeliveryPassed === true
        && reviewVerdict?.conflict !== true
        && reviewVerdict?.decision === "pass"
      )
    });
  }
  const summariesByRunObservationId = new Map();
  for (const summary of summaries.filter((item) => item.submitted && item.runObservationId)) {
    const current = summariesByRunObservationId.get(summary.runObservationId) || [];
    current.push(summary);
    summariesByRunObservationId.set(summary.runObservationId, current);
  }
  for (const duplicateSummaries of summariesByRunObservationId.values()) {
    if (duplicateSummaries.length <= 1) continue;
    for (const summary of duplicateSummaries) {
      summary.protocolIssues.push("run_observation_reused_by_multiple_attempts");
      summary.protocolIssues = [...new Set(summary.protocolIssues)];
      summary.protocolValid = false;
      summary.linkedRunValid = false;
      summary.technicalDeliveryPassed = false;
      summary.strictReviewReady = false;
      summary.commercialUsable = false;
    }
  }
  const summariesByCaseRepeat = new Map();
  for (const summary of summaries.filter((item) => item.submitted)) {
    const identity = `${summary.cohortId}\u0000${summary.caseId}\u0000${summary.repeatIndex}`;
    const current = summariesByCaseRepeat.get(identity) || [];
    current.push(summary);
    summariesByCaseRepeat.set(identity, current);
  }
  for (const duplicateSummaries of summariesByCaseRepeat.values()) {
    if (duplicateSummaries.length <= 1) continue;
    for (const summary of duplicateSummaries) {
      summary.protocolIssues.push("case_repeat_reused_by_multiple_attempts");
      summary.protocolIssues = [...new Set(summary.protocolIssues)];
      summary.protocolValid = false;
      summary.technicalDeliveryPassed = false;
      summary.strictReviewReady = false;
      summary.commercialUsable = false;
    }
  }
  const byCohort = Object.create(null);
  for (const summary of summaries) {
    const cohort = byCohort[summary.cohortId] || {
      attempts: 0,
      armed: 0,
      submitted: 0,
      terminal: 0,
      linkedRunObservations: 0,
      duplicateTerminalEvents: 0,
      protocolInvalidAttempts: 0,
      submittedProtocolInvalidAttempts: 0,
      statuses: {},
      cohortFingerprints: [],
      derivedCohortFingerprints: [],
      fixtureIdentityDigestsByCase: {},
      comparisonControlProfiles: [],
      linkedRunObservationIds: [],
      submittedRepeatIndexesByCase: {},
      byTaskFamily: {},
      byCase: {}
    };
    cohort.attempts += 1;
    if (summary.armed) cohort.armed += 1;
    if (summary.submitted) cohort.submitted += 1;
    if (summary.submitted && summary.caseId && Number.isInteger(summary.repeatIndex)) {
      const repeatIndexes = cohort.submittedRepeatIndexesByCase[summary.caseId] || [];
      if (!repeatIndexes.includes(summary.repeatIndex)) repeatIndexes.push(summary.repeatIndex);
      cohort.submittedRepeatIndexesByCase[summary.caseId] = repeatIndexes.sort((left, right) => left - right);
    }
    if (summary.terminal) cohort.terminal += 1;
    if (summary.linkedRunValid) {
      cohort.linkedRunObservations += 1;
      cohort.linkedRunObservationIds.push(summary.runObservationId);
    }
    cohort.duplicateTerminalEvents += summary.duplicateTerminalCount;
    if (!summary.protocolValid) cohort.protocolInvalidAttempts += 1;
    if (summary.submitted && !summary.protocolValid) cohort.submittedProtocolInvalidAttempts += 1;
    cohort.statuses[summary.status] = (cohort.statuses[summary.status] || 0) + 1;
    if (summary.cohortFingerprint && !cohort.cohortFingerprints.includes(summary.cohortFingerprint)) {
      cohort.cohortFingerprints.push(summary.cohortFingerprint);
    }
    if (summary.derivedCohortFingerprint
      && !cohort.derivedCohortFingerprints.includes(summary.derivedCohortFingerprint)) {
      cohort.derivedCohortFingerprints.push(summary.derivedCohortFingerprint);
    }
    if (summary.submitted && summary.caseId && summary.fixtureIdentityDigest) {
      const digests = cohort.fixtureIdentityDigestsByCase[summary.caseId] || [];
      if (!digests.includes(summary.fixtureIdentityDigest)) digests.push(summary.fixtureIdentityDigest);
      cohort.fixtureIdentityDigestsByCase[summary.caseId] = digests.sort();
    }
    if (summary.submitted && summary.controlProfile) {
      const identity = stableStringify(summary.controlProfile);
      if (!cohort.comparisonControlProfiles.some((item) => stableStringify(item) === identity)) {
        cohort.comparisonControlProfiles.push(summary.controlProfile);
      }
    }
    const family = cohort.byTaskFamily[summary.taskFamily] || {
      submitted: 0,
      terminal: 0,
      technicalDeliveryPassed: 0,
      strictReviewedTechnicalPasses: 0,
      commercialUsable: 0,
      interactionMetricsKnown: 0,
      protocolInteractionCount: 0,
      userDesignCorrectionCount: 0,
      protocolInteractionValues: [],
      userDesignCorrectionValues: [],
      statuses: {}
    };
    if (summary.submitted) family.submitted += 1;
    if (summary.terminal) family.terminal += 1;
    if (summary.technicalDeliveryPassed) family.technicalDeliveryPassed += 1;
    if (summary.technicalDeliveryPassed && summary.strictReviewReady) {
      family.strictReviewedTechnicalPasses += 1;
    }
    if (summary.commercialUsable) family.commercialUsable += 1;
    if (summary.interactionMetricsKnown) {
      family.interactionMetricsKnown += 1;
      family.protocolInteractionCount += summary.protocolInteractionCount;
      family.userDesignCorrectionCount += summary.userDesignCorrectionCount;
      family.protocolInteractionValues.push(summary.protocolInteractionCount);
      family.userDesignCorrectionValues.push(summary.userDesignCorrectionCount);
    }
    family.statuses[summary.status] = (family.statuses[summary.status] || 0) + 1;
    cohort.byTaskFamily[summary.taskFamily] = family;
    const caseEntry = cohort.byCase[summary.caseId] || {
      submitted: 0,
      terminal: 0,
      technicalDeliveryPassed: 0,
      strictReviewedTechnicalPasses: 0,
      commercialUsable: 0,
      interactionMetricsKnown: 0,
      protocolInteractionCount: 0,
      userDesignCorrectionCount: 0,
      protocolInteractionValues: [],
      userDesignCorrectionValues: [],
      statuses: {}
    };
    if (summary.submitted) caseEntry.submitted += 1;
    if (summary.terminal) caseEntry.terminal += 1;
    if (summary.technicalDeliveryPassed) caseEntry.technicalDeliveryPassed += 1;
    if (summary.technicalDeliveryPassed && summary.strictReviewReady) {
      caseEntry.strictReviewedTechnicalPasses += 1;
    }
    if (summary.commercialUsable) caseEntry.commercialUsable += 1;
    if (summary.interactionMetricsKnown) {
      caseEntry.interactionMetricsKnown += 1;
      caseEntry.protocolInteractionCount += summary.protocolInteractionCount;
      caseEntry.userDesignCorrectionCount += summary.userDesignCorrectionCount;
      caseEntry.protocolInteractionValues.push(summary.protocolInteractionCount);
      caseEntry.userDesignCorrectionValues.push(summary.userDesignCorrectionCount);
    }
    caseEntry.statuses[summary.status] = (caseEntry.statuses[summary.status] || 0) + 1;
    cohort.byCase[summary.caseId] = caseEntry;
    byCohort[summary.cohortId] = cohort;
  }
  const runIds = new Set(runs.map((run) => run.runObservationId));
  for (const [cohortId, cohort] of Object.entries(byCohort)) {
    const cohortSummaries = summaries.filter((summary) => summary.cohortId === cohortId);
    const submittedSummaries = cohortSummaries.filter((summary) => summary.submitted);
    const linkedRunIds = new Set(cohortSummaries
      .map((summary) => summary.runObservationId)
      .filter((runObservationId) => runIds.has(runObservationId)));
    const cohortRunCount = runs.filter((run) => run.cohortId === cohortId).length;
    cohort.linkedRunObservations = linkedRunIds.size;
    cohort.allSubmittedAttemptsTerminal = cohort.submitted > 0
      && submittedSummaries.every((summary) => summary.terminal && summary.duplicateTerminalCount === 0);
    cohort.protocolValid = cohort.submitted > 0 && cohort.submittedProtocolInvalidAttempts === 0;
    const fixtureIdentityReady = Object.values(cohort.fixtureIdentityDigestsByCase)
      .every((digests) => Array.isArray(digests) && digests.length === 1);
    cohort.fixtureIdentityReady = fixtureIdentityReady;
    cohort.controlProfileCount = cohort.comparisonControlProfiles.length;
    cohort.homogeneous = cohort.submitted > 0
      && cohort.protocolValid === true
      && submittedSummaries.every((summary) => Boolean(summary.derivedCohortFingerprint))
      && new Set(submittedSummaries.map((summary) => summary.derivedCohortFingerprint)).size === 1
      && cohort.controlProfileCount === 1
      && fixtureIdentityReady;
    cohort.runObservationDiagnosticCoverage = rate(linkedRunIds.size, cohort.submitted);
    cohort.unlinkedRunObservationCount = Math.max(0, cohortRunCount - linkedRunIds.size);
    const technicalPassed = submittedSummaries.filter((summary) => summary.technicalDeliveryPassed).length;
    const strictReviewedTechnicalPasses = submittedSummaries.filter((summary) => (
      summary.technicalDeliveryPassed && summary.strictReviewReady
    )).length;
    const commercialUsable = submittedSummaries.filter((summary) => summary.commercialUsable).length;
    cohort.technicalDeliveryRate = rate(technicalPassed, cohort.submitted);
    cohort.commercialUsableRate = rate(commercialUsable, cohort.submitted);
    cohort.technicalDeliveryPassed = technicalPassed;
    cohort.strictReviewedTechnicalPasses = strictReviewedTechnicalPasses;
    cohort.commercialUsable = commercialUsable;
    cohort.strictReviewCoverageOfTechnicalPasses = rate(
      strictReviewedTechnicalPasses,
      technicalPassed
    );
    cohort.strictReviewConflictCount = submittedSummaries.filter((summary) => summary.strictReviewConflict).length;
    cohort.unknownWriteStateCount = submittedSummaries.filter((summary) => (
      summary.unknownWriteIncident === true
    )).length;
    cohort.interactionMetricsKnownCount = submittedSummaries.filter((summary) => (
      summary.interactionMetricsKnown === true
    )).length;
    cohort.protocolInteractionCount = submittedSummaries.reduce((total, summary) => (
      total + (summary.interactionMetricsKnown ? summary.protocolInteractionCount : 0)
    ), 0);
    cohort.userDesignCorrectionCount = submittedSummaries.reduce((total, summary) => (
      total + (summary.interactionMetricsKnown ? summary.userDesignCorrectionCount : 0)
    ), 0);
    cohort.protocolInteractions = distribution(submittedSummaries
      .filter((summary) => summary.interactionMetricsKnown)
      .map((summary) => summary.protocolInteractionCount));
    cohort.userDesignCorrections = distribution(submittedSummaries
      .filter((summary) => summary.interactionMetricsKnown)
      .map((summary) => summary.userDesignCorrectionCount));
    for (const aggregate of [
      ...Object.values(cohort.byTaskFamily),
      ...Object.values(cohort.byCase)
    ]) {
      aggregate.technicalDeliveryRate = rate(aggregate.technicalDeliveryPassed, aggregate.submitted);
      aggregate.commercialUsableRate = rate(aggregate.commercialUsable, aggregate.submitted);
      aggregate.strictReviewCoverageOfTechnicalPasses = rate(
        aggregate.strictReviewedTechnicalPasses,
        aggregate.technicalDeliveryPassed
      );
      aggregate.protocolInteractions = distribution(aggregate.protocolInteractionValues);
      aggregate.userDesignCorrections = distribution(aggregate.userDesignCorrectionValues);
      delete aggregate.protocolInteractionValues;
      delete aggregate.userDesignCorrectionValues;
    }
  }
  return {
    version: "design-reliability-attempt-coverage/v1",
    totalAttempts: summaries.length,
    submittedAttempts: summaries.filter((summary) => summary.submitted).length,
    terminalAttempts: summaries.filter((summary) => summary.terminal).length,
    attemptsWithoutTerminal: summaries.filter((summary) => summary.submitted && !summary.terminal).length,
    usedFixtureInstanceIds: [...new Set(summaries
      .filter((summary) => summary.armed && summary.fixtureInstanceId)
      .map((summary) => summary.fixtureInstanceId))].sort(),
    byCohort
  };
}

function buildCanonicalAttemptSafetyLedger(attemptEvents) {
  const eventsByAttempt = new Map();
  for (const event of attemptEvents) {
    const current = eventsByAttempt.get(event.attemptId) || [];
    current.push(event);
    eventsByAttempt.set(event.attemptId, current);
  }
  const usedFixtureInstanceIds = new Set();
  const unresolvedAttemptIds = [];
  for (const [attemptId, events] of eventsByAttempt.entries()) {
    const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
    const armed = ordered.find((event) => event.eventType === "armed");
    const submitted = ordered.find((event) => event.eventType === "submission_started");
    const terminals = ordered.filter((event) => event.eventType === "terminal");
    const terminal = terminals.at(-1);
    const reconciliation = ordered.find((event) => event.eventType === "reconciled");
    const fixtureInstanceId = cleanString(
      armed?.fixtureRef?.instanceId || submitted?.fixtureRef?.instanceId
    );
    if (armed && fixtureInstanceId) usedFixtureInstanceIds.add(fixtureInstanceId);
    if (!submitted) continue;
    const identityKeys = new Set(ordered.map(buildAttemptEventIdentityKey));
    const stateMachineValid = validateAttemptEventStateMachine(attemptId, ordered).length === 0
      && identityKeys.size === 1;
    const anyUnknownWriteState = terminals.some((event) => (
      String(event?.status || "").includes("unknown_write_state")
    ));
    const safelyReconciled = terminals.length === 1
      && stateMachineValid
      && anyUnknownWriteState
      && Boolean(reconciliation);
    // A deterministic terminal remains safe for future writes even when its benchmark protocol
    // metadata is malformed; that Attempt will still be excluded from official rates. Only a
    // missing terminal or an unreconciled unknown-write terminal is a live execution hazard.
    if (terminals.length !== 1 || (anyUnknownWriteState && !safelyReconciled)) {
      unresolvedAttemptIds.push(attemptId);
    }
  }
  return {
    version: "design-reliability-attempt-safety-ledger/v1",
    usedFixtureInstanceIds: [...usedFixtureInstanceIds].sort(),
    unresolvedAttemptIds: [...new Set(unresolvedAttemptIds)].sort(),
    unresolvedAttemptCount: new Set(unresolvedAttemptIds).size
  };
}

function isOfficialAttemptCohortReady(attemptCohort) {
  return Boolean(
    attemptCohort
    && attemptCohort.homogeneous === true
    && attemptCohort.protocolValid === true
    && attemptCohort.allSubmittedAttemptsTerminal === true
    && attemptCohort.unknownWriteStateCount === 0
    && attemptCohort.fixtureIdentityReady === true
    && attemptCohort.controlProfileCount === 1
    && attemptCohort.interactionMetricsKnownCount === attemptCohort.submitted
  );
}

function buildAttemptCohortReportContext(attemptEvents, cohortId) {
  const submissions = (Array.isArray(attemptEvents) ? attemptEvents : []).filter((event) => (
    event.eventType === "submission_started" && event.cohortId === cohortId
  ));
  const attemptFixtureDigestsByCase = {};
  for (const event of submissions) {
    const caseId = cleanString(event.caseRef?.caseId);
    const fixtureDigest = cleanString(event.fixtureRef?.fixtureDigest).toLowerCase();
    const workspaceSemanticDigest = cleanString(
      event.fixtureRef?.workspaceSemanticDigest
    ).toLowerCase();
    if (!caseId
      || !/^sha256:[a-f0-9]{64}$/.test(fixtureDigest)
      || !/^sha256:[a-f0-9]{64}$/.test(workspaceSemanticDigest)) continue;
    const fixtureIdentityDigest = sha256Text(stableStringify({
      fixtureDigest,
      workspaceSemanticDigest
    }));
    const current = attemptFixtureDigestsByCase[caseId] || [];
    if (!current.includes(fixtureIdentityDigest)) current.push(fixtureIdentityDigest);
    attemptFixtureDigestsByCase[caseId] = current.sort();
  }
  return {
    attemptIds: [...new Set(submissions.map((event) => event.attemptId).filter(cleanString))],
    attemptFixtureDigestsByCase,
    comparisonControlProfiles: [...new Map(submissions.map((event) => {
      const profile = {
        provider: event.provider,
        modelId: event.modelId,
        timeoutMs: event.timeoutMs
      };
      return [stableStringify(profile), profile];
    })).values()]
  };
}

async function buildStatus(suite, args) {
  const evidenceRoots = resolveReliabilityEvidenceRoots(args);
  const canonicalAttemptSidecars = collectSidecars(
    evidenceRoots.canonicalAttemptRoots,
    { strictAttemptEvents: true }
  );
  const collectedSidecars = collectSidecars(evidenceRoots.reportRoots);
  const attemptSafetyLedger = buildCanonicalAttemptSafetyLedger(canonicalAttemptSidecars.attemptEvents);
  // Run / Review / Attribution 可以从附加 report root 读取，但正式 Attempt
  // 分母只能来自 run-live 的 canonical append-only 账本。否则 --data-root
  // 中伪造的 terminal 链可以绕过真实提交失败。
  const contextuallyValidSidecars = retainContextuallyValidReviews({
    ...collectedSidecars,
    attemptEvents: canonicalAttemptSidecars.attemptEvents
  }, suite);
  const sidecars = await revalidateOfficialReviewBundles(contextuallyValidSidecars, suite);
  const attemptCoverage = buildLiveAttemptCoverage(
    sidecars.attemptEvents,
    sidecars.runs,
    suite,
    sidecars.reviews
  );
  const cohortIds = [...new Set([
    ...sidecars.runs.map((run) => run.cohortId),
    ...Object.keys(attemptCoverage.byCohort)
  ])].sort();
  const requestedCohort = args.get("--cohort");
  const reports = {};
  for (const cohortId of cohortIds) {
    if (requestedCohort && cohortId !== requestedCohort) continue;
    const attemptCohort = attemptCoverage.byCohort[cohortId];
    const linkedRunIds = new Set(attemptCohort?.linkedRunObservationIds || []);
    const reportRuns = attemptCohort?.submitted > 0
      ? sidecars.runs.filter((run) => linkedRunIds.has(run.runObservationId))
      : sidecars.runs;
    const attemptReportContext = buildAttemptCohortReportContext(sidecars.attemptEvents, cohortId);
    const report = buildDesignReliabilityCohortReport({
      suiteId: suite.manifest.suiteId,
      cohortId,
      cases: suite.cases,
      rubrics: suite.rubrics,
      runs: reportRuns,
      reviews: sidecars.reviews,
      attributions: sidecars.attributions,
      minimumDesignQualityReviewedRunsPerCase: Math.max(
        1,
        Math.ceil(
          Number(suite.manifest.releaseGates?.minimumRunsPerCase || 1)
          * Number(suite.manifest.releaseGates?.technicalDeliveryRate || 1)
        )
      ),
      ...attemptReportContext
    });
    reports[cohortId] = {
      ...report,
      ...(attemptCohort ? { attempts: attemptCohort } : {})
    };
  }
  const releaseGateEvaluations = Object.fromEntries(Object.entries(reports).map(([cohortId, report]) => [
    cohortId,
    evaluateDesignReliabilityReleaseGates(report, suite.manifest.releaseGates)
  ]));
  return {
    success: suite.ok
      && sidecars.invalid.length === 0
      && canonicalAttemptSidecars.invalid.length === 0,
    generatedAt: new Date().toISOString(),
    storage: {
      canonicalDataRoot: DEFAULT_DATA_ROOT,
      canonicalAttemptEventsRoot: CANONICAL_ATTEMPT_EVENTS_ROOT,
      legacyReportRoot: LEGACY_DATA_ROOT,
      repositoryCleanupSafe: true
    },
    suite: {
      suiteId: suite.manifest.suiteId,
      activeCases: suite.cases.filter((item) => item.status === "active").map((item) => ({
        caseId: item.caseId,
        taskFamily: item.taskFamily,
        instruction: item.task.instruction,
        rubricId: item.oracle.rubricId
      }))
    },
    evidence: {
      runObservations: sidecars.runs.length,
      humanReviews: sidecars.reviews.length,
      attributions: sidecars.attributions.length,
      attemptEvents: sidecars.attemptEvents.length,
      attemptCoverage,
      attemptSafetyLedger,
      canonicalAttemptInvalidSidecars: canonicalAttemptSidecars.invalid,
      invalidSidecars: sidecars.invalid,
      excludedEvidence: sidecars.excludedEvidence || []
    },
    reports,
    releaseGateEvaluations,
    officialRateAvailable: sidecars.invalid.length === 0
      && canonicalAttemptSidecars.invalid.length === 0
      && Object.entries(releaseGateEvaluations).some(([cohortId, evaluation]) => (
        evaluation.sampleReady === true
        && isOfficialAttemptCohortReady(attemptCoverage.byCohort[cohortId])
      )),
    boundaries: [
      "未绑定固定 Case 的历史运行不进入正式成功率分母。",
      "请求一旦进入 submission_started 就必须有 terminal Attempt；缺少 Run Observation 的失败不会被静默移出分母。",
      "没有人工评审时只能报告技术可靠性，不能宣称设计质量达标。",
      "anonymous proof 只有在 canonical verification bundle 每次磁盘重验通过后才进入 strict；附加 data root 只能提供诊断记录。",
      "不同 caseSetDigest、rubricSetDigest 或 fixtureDigest 的 cohort 禁止直接比较。"
    ]
  };
}

async function buildCohortComparison(suite, args) {
  const baselineCohortId = cleanString(args.get("--baseline-cohort"));
  const candidateCohortId = cleanString(args.get("--candidate-cohort"));
  if (!baselineCohortId || !candidateCohortId) {
    throw new Error("compare 需要 --baseline-cohort 与 --candidate-cohort。 ");
  }
  if (baselineCohortId === candidateCohortId) {
    throw new Error("baseline 与 candidate 必须是两个不同 cohort。 ");
  }
  const status = await buildStatus(suite, args);
  const baseline = status.reports[baselineCohortId];
  const candidate = status.reports[candidateCohortId];
  if (!baseline || !candidate) {
    const missing = [
      ...(baseline ? [] : [baselineCohortId]),
      ...(candidate ? [] : [candidateCohortId])
    ];
    throw new Error(`找不到 cohort report：${missing.join("、")}`);
  }
  const baselineGate = status.releaseGateEvaluations[baselineCohortId];
  const candidateGate = status.releaseGateEvaluations[candidateCohortId];
  let comparison = compareDesignReliabilityCohorts(baseline, candidate);
  if (status.success !== true) {
    comparison = {
      comparable: false,
      reason: "当前证据目录包含无效 sidecar，必须先修复证据链，不能比较 cohort。"
    };
  } else if (comparison.comparable === true
    && (baselineGate?.sampleReady !== true || candidateGate?.sampleReady !== true)) {
    comparison = {
      ...comparison,
      comparable: false,
      reason: "baseline 或 candidate 尚未达到固定 Case 重复数、严格盲评覆盖与介入指标完整度，当前只能分别诊断，不能形成正式前后结论。"
    };
  }
  return {
    success: comparison.comparable === true,
    generatedAt: new Date().toISOString(),
    baselineCohortId,
    candidateCohortId,
    comparison,
    releaseGateEvaluations: {
      baseline: baselineGate,
      candidate: candidateGate
    },
    boundaries: {
      sameCaseRubricAndFixtureRequired: true,
      noCrossCaseAverageComparison: true,
      devBenchmarkOnly: true
    }
  };
}

function httpProbe(url, timeoutMs = 1200, headers = {}) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: timeoutMs, headers }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        let responseBody = null;
        try {
          responseBody = body ? JSON.parse(body) : null;
        } catch {
          responseBody = null;
        }
        resolve({
          reachable: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          bodyPreview: body.slice(0, 240),
          responseBody
        });
      });
    });
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", (error) => resolve({ reachable: false, reason: error.code || error.message }));
  });
}

function httpPostJson(url, payload, timeoutMs, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = JSON.stringify(payload);
    const request = http.request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: "POST",
      timeout: timeoutMs,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(body),
        ...extraHeaders
      }
    }, (response) => {
      let responseText = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { responseText += chunk; });
      response.on("end", () => {
        let responseBody = null;
        try {
          responseBody = responseText ? JSON.parse(responseText) : null;
        } catch {
          responseBody = { parseError: true, preview: responseText.slice(0, 500) };
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const error = new Error(
            `Debug Bridge HTTP ${response.statusCode}: ${responseBody?.error || responseText.slice(0, 200)}`
          );
          error.debugBridgeResponse = responseBody;
          const failure = readDebugBridgeExecutionFailure(responseBody);
          if (failure) error.debugBridgeFailure = failure;
          reject(error);
          return;
        }
        resolve(responseBody);
      });
    });
    request.on("timeout", () => request.destroy(new Error(`Debug Bridge 请求超过 ${timeoutMs}ms`)));
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

async function executeGuardedNaturalChatActor(input) {
  return httpPostJson(`${input.debugBridge}/chat/submit`, {
    text: input.caseSpec.task.instruction,
    timeoutMs: input.timeoutMs,
    resetConversation: true,
    disableSkillBridges: false,
    projectAssetReferences: input.projectAssetReferences,
    expectedProjectPath: input.fixtureRoot,
    expectedRuntimeGitCommit: input.gitCommit,
    expectedRuntimeBuildId: input.runtimeBuildId,
    expectedPhotoshopRuntimeBuildId: input.photoshopRuntimeBuildId,
    expectedPhotoshopRuntimeBinding: input.photoshopRuntimeBinding,
    expectedProvider: input.provider,
    expectedModelId: input.modelId,
    expectedWorkspaceSemanticDigest: input.workspaceSemanticDigest,
    requireCleanRuntimeGitState: true,
    requireNoOpenPhotoshopDocuments: true
  }, input.timeoutMs + 5000, {
    "x-designecho-debug-token": input.debugToken
  });
}

function parseMcpToolResult(response) {
  if (isRecord(response?.error)) {
    throw new Error(`MCP ${response.error.code || "error"}: ${response.error.message || "unknown error"}`);
  }
  const content = Array.isArray(response?.result?.content) ? response.result.content : [];
  const text = content.find((item) => item?.type === "text")?.text;
  if (typeof text !== "string") return response?.result;
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  if (typeof parsed !== "string") return parsed;
  try {
    return JSON.parse(parsed);
  } catch {
    return parsed;
  }
}

async function callMcpTool(endpoint, name, args = {}, timeoutMs = 5000) {
  const response = await httpPostJson(endpoint, {
    jsonrpc: "2.0",
    id: `design-reliability-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    method: "tools/call",
    params: { name, arguments: args }
  }, timeoutMs);
  return parseMcpToolResult(response);
}

async function safeCallMcpTool(endpoint, name, args = {}, timeoutMs = 5000) {
  try {
    return { ok: true, result: await callMcpTool(endpoint, name, args, timeoutMs) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function normalizeDocumentPathForSafety(value) {
  const raw = cleanString(value);
  if (!raw) return "";
  const withoutFileScheme = raw.replace(/^file:\/{2,3}/i, "");
  try {
    return normalizePathIdentity(decodeURI(withoutFileScheme));
  } catch {
    return normalizePathIdentity(withoutFileScheme);
  }
}

function normalizeOpenDocumentState(documentList, expectedProjectPath) {
  const result = documentList?.ok ? documentList.result : undefined;
  const documents = Array.isArray(result?.documents) ? result.documents : undefined;
  if (!documents || result?.success === false) {
    return {
      verified: false,
      count: null,
      hasUnsavedDocument: null,
      hasDirtyDocument: null,
      fixtureDocumentCount: null,
      outsideFixtureDocumentCount: null,
      unresolvedOwnershipDocumentCount: null
    };
  }
  const expectedProjectIdentity = normalizePathIdentity(expectedProjectPath);
  let fixtureDocumentCount = 0;
  let outsideFixtureDocumentCount = 0;
  let unresolvedOwnershipDocumentCount = 0;
  for (const document of documents) {
    const pathState = cleanString(document?.pathState);
    const documentPath = normalizeDocumentPathForSafety(document?.path);
    if (pathState !== "saved" || !documentPath || !expectedProjectIdentity) {
      unresolvedOwnershipDocumentCount += 1;
      continue;
    }
    if (isSameOrNestedRealPath(expectedProjectIdentity, documentPath)) {
      fixtureDocumentCount += 1;
    } else {
      outsideFixtureDocumentCount += 1;
    }
  }
  return {
    verified: true,
    count: documents.length,
    hasUnsavedDocument: documents.some((document) => document?.pathState === "unsaved"),
    hasDirtyDocument: documents.some((document) => document?.editState === "dirty"),
    fixtureDocumentCount,
    outsideFixtureDocumentCount,
    unresolvedOwnershipDocumentCount
  };
}

function evaluateLiveEnvironmentSafety(input) {
  const blockers = [];
  const currentGit = input.currentGitEnvironment || {};
  const systemStatus = input.systemStatus?.ok ? input.systemStatus.result : undefined;
  const runtimeIdentity = systemStatus?.runtimeBuildIdentity;
  const connection = input.connectionStatus?.ok ? input.connectionStatus.result : undefined;
  const photoshopDiagnosis = input.photoshopDiagnosisStatus?.ok
    ? input.photoshopDiagnosisStatus.result
    : undefined;
  const photoshopRuntime = photoshopDiagnosis?.state?.runtime;
  const photoshopBuildVerification = isRecord(input.photoshopRuntimeBuildVerification)
    ? input.photoshopRuntimeBuildVerification
    : null;
  const verifiedPhotoshopBuildIdentity = isRecord(photoshopBuildVerification?.artifacts?.identity)
    ? photoshopBuildVerification.artifacts.identity
    : null;
  const photoshopRuntimeBinding = buildPhotoshopRuntimeBinding(photoshopBuildVerification);
  const projectRootResult = input.projectRootStatus?.ok ? input.projectRootStatus.result : undefined;
  const documentPolicy = input.documentPolicy === "no_fixture_documents"
    ? "no_fixture_documents"
    : "none_open";
  const expectedProjectPath = normalizePathIdentity(input.expectedProjectPath);
  const documents = normalizeOpenDocumentState(
    input.documentListStatus,
    expectedProjectPath
  );
  const currentProjectPath = normalizePathIdentity(projectRootResult?.projectRoot);
  const pendingRequestCount = Number(systemStatus?.pluginConnectionDiagnostics?.pendingRequestCount);

  if (!input.systemStatus?.ok) blockers.push("runtime_status_unavailable");
  if (runtimeIdentity?.version !== "designecho-runtime-build-identity/v1"
    || !cleanString(runtimeIdentity?.gitCommit)
    || !cleanString(runtimeIdentity?.buildId)
    || runtimeIdentity?.artifactsVerified !== true) {
    blockers.push("runtime_build_identity_unavailable");
  } else {
    if (runtimeIdentity.gitCommit !== currentGit.gitCommit) blockers.push("runtime_git_commit_mismatch");
    if (runtimeIdentity.gitDirty !== false) blockers.push("runtime_started_from_dirty_worktree");
    if (runtimeIdentity.fakeModelEnabled === true) blockers.push("fake_model_runtime_enabled");
    if (runtimeIdentity.fakePhotoshopEnabled === true) blockers.push("fake_photoshop_runtime_enabled");
  }
  if (currentGit.dirty !== false) blockers.push("current_worktree_dirty");
  if (!input.connectionStatus?.ok || connection?.connected !== true || systemStatus?.pluginConnected !== true) {
    blockers.push("photoshop_plugin_not_connected");
  }
  if (!input.photoshopDiagnosisStatus?.ok || !cleanString(photoshopRuntime?.buildId)) {
    blockers.push("photoshop_runtime_identity_unavailable");
  }
  if (photoshopBuildVerification?.version !== "designecho-photoshop-runtime-build-verification/v1"
    || photoshopBuildVerification.ready !== true
    || !photoshopRuntimeBinding) {
    blockers.push("photoshop_runtime_build_identity_mismatch");
  } else {
    if (verifiedPhotoshopBuildIdentity?.gitDirty !== false) {
      blockers.push("photoshop_runtime_built_from_dirty_worktree");
    }
    if (verifiedPhotoshopBuildIdentity?.buildMode !== "production") {
      blockers.push("photoshop_runtime_not_production");
    }
  }
  if (!Number.isFinite(pendingRequestCount)) {
    blockers.push("photoshop_pending_request_state_unavailable");
  } else if (pendingRequestCount > 0) {
    blockers.push("photoshop_requests_pending");
  }
  if (!input.projectRootStatus?.ok || !expectedProjectPath || currentProjectPath !== expectedProjectPath) {
    blockers.push("current_project_not_bound_to_fixture");
  }
  if (!documents.verified) {
    blockers.push("photoshop_document_state_unavailable");
  } else if (documentPolicy === "none_open" && documents.count > 0) {
    blockers.push("photoshop_documents_open");
  } else if (documentPolicy === "no_fixture_documents") {
    if (documents.unresolvedOwnershipDocumentCount > 0) {
      blockers.push("photoshop_document_ownership_unresolved");
    }
    if (documents.fixtureDocumentCount > 0) {
      blockers.push("photoshop_fixture_documents_open");
    }
  }

  return {
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)],
    checks: {
      runtimeIdentityAvailable: runtimeIdentity?.version === "designecho-runtime-build-identity/v1"
        && runtimeIdentity?.artifactsVerified === true,
      runtimeCommitMatchesCurrentHead: Boolean(
        runtimeIdentity?.gitCommit
        && runtimeIdentity.gitCommit === currentGit.gitCommit
      ),
      runtimeStartedClean: runtimeIdentity?.gitDirty === false,
      realModelRuntime: runtimeIdentity?.fakeModelEnabled === false,
      realPhotoshopRuntime: runtimeIdentity?.fakePhotoshopEnabled === false,
      currentWorktreeClean: currentGit.dirty === false,
      photoshopConnected: connection?.connected === true && systemStatus?.pluginConnected === true,
      photoshopRuntimeIdentityAvailable: Boolean(cleanString(photoshopRuntime?.buildId)),
      photoshopRuntimeArtifactsVerified: photoshopBuildVerification?.artifacts?.artifactsVerified === true,
      photoshopRuntimeManifestMatchesCheckout: photoshopBuildVerification?.manifestMatchesCurrentCheckout === true,
      photoshopRuntimeMatchesManifest: photoshopBuildVerification?.live?.matchesManifest === true,
      photoshopRuntimeMatchesCheckout: photoshopBuildVerification?.live?.matchesCurrentCheckout === true,
      photoshopRuntimeBuiltClean: verifiedPhotoshopBuildIdentity?.gitDirty === false,
      photoshopRuntimeProductionBuild: verifiedPhotoshopBuildIdentity?.buildMode === "production",
      noPendingPhotoshopRequests: pendingRequestCount === 0,
      currentProjectMatchesFixture: Boolean(
        expectedProjectPath
        && currentProjectPath === expectedProjectPath
      ),
      photoshopDocumentStateVerified: documents.verified,
      noOpenPhotoshopDocuments: documents.verified && documents.count === 0,
      noOpenFixtureDocuments: documents.verified && documents.fixtureDocumentCount === 0,
      openDocumentOwnershipResolved: documents.verified
        && documents.unresolvedOwnershipDocumentCount === 0
    },
    runtime: runtimeIdentity?.version === "designecho-runtime-build-identity/v1"
      ? {
        version: runtimeIdentity.version,
        buildId: runtimeIdentity.buildId,
        processStartedAt: runtimeIdentity.processStartedAt,
        appVersion: runtimeIdentity.appVersion,
        source: runtimeIdentity.source,
        gitCommit: runtimeIdentity.gitCommit,
        gitDirty: runtimeIdentity.gitDirty,
        artifactDigest: runtimeIdentity.artifactDigest,
        manifestDigest: runtimeIdentity.manifestDigest,
        artifactsVerified: runtimeIdentity.artifactsVerified === true,
        fakeModelEnabled: runtimeIdentity.fakeModelEnabled === true,
        fakePhotoshopEnabled: runtimeIdentity.fakePhotoshopEnabled === true
      }
      : null,
    photoshop: {
      documentPolicy,
      connected: connection?.connected === true,
      runtimeBuildId: cleanString(photoshopRuntime?.buildId) || null,
      runtimeLoadedAt: cleanString(photoshopRuntime?.loadedAt) || null,
      runtimeGitCommit: cleanString(photoshopRuntime?.gitCommit) || null,
      runtimeSourceDigest: cleanString(photoshopRuntime?.sourceDigest) || null,
      runtimeArtifactDigest: cleanString(verifiedPhotoshopBuildIdentity?.runtimeDigest) || null,
      runtimeManifestDigest: cleanString(verifiedPhotoshopBuildIdentity?.manifestDigest) || null,
      runtimeBinding: photoshopRuntimeBinding,
      buildIdentityVerified: photoshopBuildVerification?.ready === true,
      buildIdentityIssueCodes: Array.isArray(photoshopBuildVerification?.issues)
        ? photoshopBuildVerification.issues.map((issue) => cleanString(issue?.code)).filter(Boolean)
        : [],
      pendingRequestCount: Number.isFinite(pendingRequestCount) ? pendingRequestCount : null,
      openDocumentCount: documents.count,
      hasUnsavedDocument: documents.hasUnsavedDocument,
      hasDirtyDocument: documents.hasDirtyDocument,
      openFixtureDocumentCount: documents.fixtureDocumentCount,
      openOutsideFixtureDocumentCount: documents.outsideFixtureDocumentCount,
      unresolvedOwnershipDocumentCount: documents.unresolvedOwnershipDocumentCount
    },
    project: {
      expectedFixtureSupplied: Boolean(expectedProjectPath),
      currentProjectMatchesFixture: Boolean(
        expectedProjectPath
        && currentProjectPath === expectedProjectPath
      )
    }
  };
}

async function inspectLiveEnvironment(args, fixtureRoot, options = {}) {
  const endpoint = args.get("--photoshop-mcp", DEFAULT_PHOTOSHOP_MCP_ENDPOINT);
  const [systemStatus, connectionStatus, photoshopDiagnosisStatus, projectRootStatus, documentListStatus] = await Promise.all([
    safeCallMcpTool(endpoint, "system.status"),
    safeCallMcpTool(endpoint, "photoshop.connection_status"),
    safeCallMcpTool(endpoint, "photoshop.tools.call", {
      name: "diagnoseState",
      arguments: { verbose: false }
    }),
    safeCallMcpTool(endpoint, "resource.get_project_root"),
    safeCallMcpTool(endpoint, "photoshop.tools.call", {
      name: "listDocuments",
      arguments: { includeDetails: true }
    })
  ]);
  const livePhotoshopRuntime = photoshopDiagnosisStatus?.ok
    ? photoshopDiagnosisStatus.result?.state?.runtime
    : undefined;
  let photoshopRuntimeBuildVerification;
  try {
    photoshopRuntimeBuildVerification = verifyPhotoshopRuntimeBuildIdentity({
      liveRuntime: livePhotoshopRuntime,
      requireLive: true
    });
  } catch (error) {
    photoshopRuntimeBuildVerification = {
      version: "designecho-photoshop-runtime-build-verification/v1",
      ready: false,
      issues: [{
        code: "photoshop_runtime_build_verification_failed",
        message: error instanceof Error ? error.message : String(error)
      }]
    };
  }
  return evaluateLiveEnvironmentSafety({
    currentGitEnvironment: readGitEnvironment(),
    expectedProjectPath: fixtureRoot,
    documentPolicy: options.documentPolicy,
    systemStatus,
    connectionStatus,
    photoshopDiagnosisStatus,
    photoshopRuntimeBuildVerification,
    projectRootStatus,
    documentListStatus
  });
}

async function inspectPhotoshopRuntimeBinding(args) {
  const endpoint = args.get("--photoshop-mcp", DEFAULT_PHOTOSHOP_MCP_ENDPOINT);
  const diagnosis = await safeCallMcpTool(endpoint, "photoshop.tools.call", {
    name: "diagnoseState",
    arguments: { verbose: false }
  });
  if (!diagnosis.ok) {
    return {
      ready: false,
      binding: null,
      issues: [{ code: "photoshop_runtime_diagnosis_failed", message: diagnosis.error }]
    };
  }
  let verification;
  try {
    verification = verifyPhotoshopRuntimeBuildIdentity({
      liveRuntime: diagnosis.result?.state?.runtime,
      requireLive: true
    });
  } catch (error) {
    return {
      ready: false,
      binding: null,
      issues: [{
        code: "photoshop_runtime_build_verification_failed",
        message: error instanceof Error ? error.message : String(error)
      }]
    };
  }
  const binding = buildPhotoshopRuntimeBinding(verification);
  return {
    ready: verification.ready === true && Boolean(binding),
    binding,
    issues: verification.issues || []
  };
}

function summarizeDebugResponse(response) {
  const result = response?.result;
  const snapshot = isRecord(result?.snapshot) ? result.snapshot : result;
  const receipt = isRecord(result?.receipt) ? result.receipt : undefined;
  return {
    responseSuccess: response?.success === true,
    resultType: Array.isArray(result) ? "array" : typeof result,
    resultKeys: isRecord(result) ? Object.keys(result).sort().slice(0, 30) : [],
    messageCount: Array.isArray(snapshot?.messages) ? snapshot.messages.length : undefined,
    isLoading: snapshot?.isLoading === true,
    receiptVersion: cleanString(receipt?.version) || undefined,
    projectGuardPassed: receipt?.expectedProjectMatchedAtSubmission === true
      && receipt?.projectUnchangedThroughCompletion === true,
    modelIdentityReturned: Boolean(cleanString(receipt?.modelId) || cleanString(receipt?.submittedModelId))
  };
}

function validateDebugBridgeReceipt(response, input) {
  const receipt = response?.result?.receipt;
  const errors = [];
  if (!isRecord(receipt) || receipt.version !== "debug-bridge-chat-submit-receipt/v1") {
    return { ok: false, errors: ["运行窗口没有返回 debug-bridge-chat-submit-receipt/v1。"] };
  }
  const expectedProjectPath = normalizePathIdentity(input.fixtureRoot);
  const submittedProjectPath = normalizePathIdentity(receipt.submittedProjectPath);
  const completedProjectPath = normalizePathIdentity(receipt.completedProjectPath);
  if (receipt.expectedProjectMatchedAtSubmission !== true
    || submittedProjectPath !== expectedProjectPath) {
    errors.push("提交时项目路径没有与 fixture 精确匹配。");
  }
  if (receipt.projectUnchangedThroughCompletion !== true
    || completedProjectPath !== expectedProjectPath) {
    errors.push("任务执行期间项目身份发生变化或无法证明未变化。");
  }
  const expectedWorkspaceSemanticDigest = cleanString(input.workspaceSemanticDigest).toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/.test(expectedWorkspaceSemanticDigest)
    || cleanString(receipt.expectedWorkspaceSemanticDigest).toLowerCase()
      !== expectedWorkspaceSemanticDigest
    || cleanString(receipt.consumedWorkspaceSemanticDigest).toLowerCase()
      !== expectedWorkspaceSemanticDigest) {
    errors.push("运行窗口没有证明 Agent 实际消费的项目语义快照匹配 Attempt 身份。 ");
  }
  const expectedProjectAssetReferences = Array.isArray(input.projectAssetReferences)
    ? input.projectAssetReferences
    : [];
  const submittedProjectAssetReferences = Array.isArray(receipt.projectAssetReferences)
    ? receipt.projectAssetReferences
    : [];
  if (stableStringify(submittedProjectAssetReferences)
    !== stableStringify(expectedProjectAssetReferences)) {
    errors.push("运行窗口没有证明用户目标参考以相同项目相对路径和源内容摘要进入本轮消息。 ");
  }
  let providerBinding = null;
  if (expectedProjectAssetReferences.length > 0) {
    const payloadBinding = receipt.projectAssetPayloadBinding;
    providerBinding = receipt.projectAssetProviderBindingReceipt;
    const expectedProviderReceiptKeys = [
      "bindingDigest",
      "committedAt",
      "matchedAt",
      "matchedAtProviderBoundary",
      "modelId",
      "provider",
      "providerAttemptRef",
      "referenceCount",
      "transport",
      "version",
      "visualBlockCount"
    ];
    const matchedAt = Date.parse(cleanString(providerBinding?.matchedAt));
    const committedAt = Date.parse(cleanString(providerBinding?.committedAt));
    if (!isRecord(payloadBinding)
      || payloadBinding.version !== "debug-bridge-project-asset-payload-binding/v1"
      || !/^sha256:[a-f0-9]{64}$/.test(cleanString(payloadBinding.bindingDigest))
      || payloadBinding.referenceCount !== expectedProjectAssetReferences.length
      || !isRecord(providerBinding)
      || stableStringify(Object.keys(providerBinding).sort())
        !== stableStringify(expectedProviderReceiptKeys)
      || providerBinding.version !== "debug-bridge-project-asset-provider-receipt/v1"
      || cleanString(providerBinding.bindingDigest) !== cleanString(payloadBinding.bindingDigest)
      || providerBinding.referenceCount !== expectedProjectAssetReferences.length
      || providerBinding.visualBlockCount !== expectedProjectAssetReferences.length
      || providerBinding.matchedAtProviderBoundary !== true
      || !cleanString(providerBinding.provider)
      || !cleanString(providerBinding.modelId)
      || !["chat", "chat_with_tools", "chat_with_tools_stream"].includes(
        cleanString(providerBinding.transport)
      )
      || !/^sha256:[a-f0-9]{64}$/.test(cleanString(providerBinding.providerAttemptRef))
      || !Number.isFinite(matchedAt)
      || !Number.isFinite(committedAt)
      || new Date(matchedAt).toISOString() !== cleanString(providerBinding.matchedAt)
      || new Date(committedAt).toISOString() !== cleanString(providerBinding.committedAt)
      || matchedAt > committedAt) {
      errors.push("运行窗口没有证明 Main 验真的目标参考像素进入同一次 Provider 视觉请求。 ");
    }
  }
  const submittedModelId = cleanString(receipt.submittedModelId);
  const completedModelId = cleanString(receipt.completedModelId);
  const submittedApiModelId = cleanString(receipt.submittedApiModelId);
  const completedApiModelId = cleanString(receipt.completedApiModelId);
  const provider = cleanString(receipt.provider);
  const submittedModelMatches = submittedModelId === input.modelId
    || submittedApiModelId === input.modelId;
  const completedModelMatches = completedModelId === input.modelId
    || completedApiModelId === input.modelId;
  if (receipt.modelUnchangedThroughCompletion !== true
    || receipt.expectedModelMatchedAtSubmission !== true
    || !submittedModelMatches
    || !completedModelMatches) {
    errors.push(`运行窗口返回的模型身份与请求记录不一致（期望 ${input.modelId}，实际 ${submittedModelId || "unknown"}${submittedApiModelId ? ` / ${submittedApiModelId}` : ""}）。`);
  }
  if (provider !== input.provider) errors.push("运行窗口返回的 Provider 与请求记录不一致。");
  if (providerBinding) {
    const providerBindingModelId = cleanString(providerBinding.modelId);
    const providerBindingModelMatches = providerBindingModelId === input.modelId
      || providerBindingModelId === submittedModelId
      || providerBindingModelId === submittedApiModelId;
    if (cleanString(providerBinding.provider) !== input.provider
      || !providerBindingModelMatches) {
      errors.push("目标参考 Provider 收据没有绑定本次实际模型与 Provider。 ");
    }
  }
  const runtimeIdentity = receipt.runtimeBuildIdentity;
  const completedRuntimeIdentity = receipt.completedRuntimeBuildIdentity;
  const submittedRuntimeCapturedAt = Date.parse(cleanString(runtimeIdentity?.capturedAt));
  const completedRuntimeCapturedAt = Date.parse(cleanString(completedRuntimeIdentity?.capturedAt));
  if (receipt.runtimeIdentityMatchedAtSubmission !== true
    || runtimeIdentity?.version !== "designecho-runtime-build-identity/v1"
    || runtimeIdentity?.source !== "build_manifest"
    || !cleanString(runtimeIdentity?.appVersion)
    || !Number.isFinite(submittedRuntimeCapturedAt)
    || runtimeIdentity?.gitCommit !== input.gitCommit
    || runtimeIdentity?.buildId !== input.runtimeBuildId
    || runtimeIdentity?.gitDirty !== false
    || runtimeIdentity?.artifactsVerified !== true
    || !cleanString(runtimeIdentity?.buildId)
    || !cleanString(runtimeIdentity?.artifactDigest)
    || !cleanString(runtimeIdentity?.manifestDigest)
    || runtimeIdentity?.fakeModelEnabled !== false
    || runtimeIdentity?.fakePhotoshopEnabled !== false) {
    errors.push("运行窗口没有证明本轮由指定的干净真实 Runtime 执行。");
  }
  if (receipt.runtimeArtifactsUnchangedThroughCompletion !== true
    || completedRuntimeIdentity?.version !== "designecho-runtime-build-identity/v1"
    || completedRuntimeIdentity?.source !== "build_manifest"
    || completedRuntimeIdentity?.appVersion !== runtimeIdentity?.appVersion
    || completedRuntimeIdentity?.buildId !== runtimeIdentity?.buildId
    || !Number.isFinite(completedRuntimeCapturedAt)
    || completedRuntimeCapturedAt < submittedRuntimeCapturedAt
    || completedRuntimeIdentity?.gitCommit !== runtimeIdentity?.gitCommit
    || completedRuntimeIdentity?.buildId !== runtimeIdentity?.buildId
    || completedRuntimeIdentity?.artifactDigest !== runtimeIdentity?.artifactDigest
    || completedRuntimeIdentity?.manifestDigest !== runtimeIdentity?.manifestDigest
    || completedRuntimeIdentity?.gitDirty !== false
    || completedRuntimeIdentity?.artifactsVerified !== true
    || completedRuntimeIdentity?.fakeModelEnabled !== false
    || completedRuntimeIdentity?.fakePhotoshopEnabled !== false) {
    errors.push("运行窗口没有证明 DesignEcho 构建产物在任务完成前保持完全一致。");
  }
  if (receipt.photoshopDocumentPolicy !== "none_open"
    || receipt.photoshopDocumentGuardPassedAtSubmission !== true
    || receipt.openPhotoshopDocumentCountAtSubmission !== 0) {
    errors.push("运行窗口没有证明提交模型前 Photoshop 处于空文档隔离基线。");
  }
  const expectedPhotoshopRuntimeBuildId = cleanString(input.photoshopRuntimeBuildId);
  const expectedPhotoshopRuntimeBinding = input.photoshopRuntimeBinding;
  const submittedPhotoshopRuntimeBuildId = cleanString(receipt.submittedPhotoshopRuntimeBuildId);
  const completedPhotoshopRuntimeBuildId = cleanString(receipt.completedPhotoshopRuntimeBuildId);
  if (!expectedPhotoshopRuntimeBuildId
    || cleanString(receipt.expectedPhotoshopRuntimeBuildId) !== expectedPhotoshopRuntimeBuildId
    || submittedPhotoshopRuntimeBuildId !== expectedPhotoshopRuntimeBuildId
    || completedPhotoshopRuntimeBuildId !== expectedPhotoshopRuntimeBuildId
    || receipt.expectedPhotoshopRuntimeMatchedAtSubmission !== true
    || receipt.photoshopRuntimeUnchangedThroughCompletion !== true) {
    errors.push("运行窗口没有证明 Photoshop Runtime Build 在提交前与完成后始终匹配指定版本。");
  }
  const receiptExpectedPhotoshopRuntimeBinding = receipt.expectedPhotoshopRuntimeBinding;
  const submittedPhotoshopRuntimeBinding = validatePhotoshopRuntimeBinding(
    expectedPhotoshopRuntimeBinding
  ) && isRecord(receipt.submittedPhotoshopRuntimeIdentity)
    ? {
      ...expectedPhotoshopRuntimeBinding,
      live: receipt.submittedPhotoshopRuntimeIdentity
    }
    : null;
  const completedPhotoshopRuntimeBinding = validatePhotoshopRuntimeBinding(
    expectedPhotoshopRuntimeBinding
  ) && isRecord(receipt.completedPhotoshopRuntimeIdentity)
    ? {
      ...expectedPhotoshopRuntimeBinding,
      live: receipt.completedPhotoshopRuntimeIdentity
    }
    : null;
  if (!validatePhotoshopRuntimeBinding(expectedPhotoshopRuntimeBinding)
    || !validatePhotoshopRuntimeBinding(receiptExpectedPhotoshopRuntimeBinding)
    || !photoshopRuntimeBindingsMatch(
      receiptExpectedPhotoshopRuntimeBinding,
      expectedPhotoshopRuntimeBinding
    )
    || !photoshopRuntimeBindingsMatch(
      submittedPhotoshopRuntimeBinding,
      expectedPhotoshopRuntimeBinding
    )
    || !photoshopRuntimeBindingsMatch(
      completedPhotoshopRuntimeBinding,
      expectedPhotoshopRuntimeBinding
    )
    || receipt.photoshopRuntimeBindingMatchedAtSubmission !== true
    || receipt.photoshopRuntimeBindingUnchangedThroughCompletion !== true) {
    errors.push("运行窗口没有把 Photoshop live 全身份与 runtime.js / manifest 摘要贯穿提交和完成收据。");
  }
  const firstMutationBaseline = receipt.firstPhotoshopMutationBaseline;
  if (!isRecord(firstMutationBaseline)
    || firstMutationBaseline.version !== "guarded-photoshop-execution-baseline-receipt/v0"
    || !["not_reached", "passed", "blocked"].includes(firstMutationBaseline.status)
    || cleanString(firstMutationBaseline.requestId) !== cleanString(receipt.requestId)
    || cleanString(firstMutationBaseline.expectedPhotoshopRuntimeBuildId)
      !== expectedPhotoshopRuntimeBuildId
    || !validatePhotoshopRuntimeBinding(firstMutationBaseline.expectedPhotoshopRuntimeBinding)
    || !photoshopRuntimeBindingsMatch(
      firstMutationBaseline.expectedPhotoshopRuntimeBinding,
      expectedPhotoshopRuntimeBinding
    )) {
    errors.push("运行窗口没有返回可信的首次 Photoshop 写入隔离基线收据。");
  } else if (firstMutationBaseline.status === "blocked"
    && !cleanString(firstMutationBaseline.error)) {
    errors.push("首次 Photoshop 写入隔离基线声明 blocked 但没有失败事实。");
  } else if (firstMutationBaseline.status === "passed"
    && (firstMutationBaseline.openDocumentCount !== 0
      || !Number.isFinite(Date.parse(cleanString(firstMutationBaseline.checkedAt)))
      || cleanString(firstMutationBaseline.observedPhotoshopRuntimeBuildId)
        !== expectedPhotoshopRuntimeBuildId
      || !photoshopRuntimeBindingsMatch({
        ...expectedPhotoshopRuntimeBinding,
        live: firstMutationBaseline.observedPhotoshopRuntimeIdentity
      }, expectedPhotoshopRuntimeBinding)
      || !cleanString(firstMutationBaseline.firstMutationToolName))) {
    errors.push("首次 Photoshop 写入隔离基线收据与空文档或 Runtime Build 事实不一致。");
  }
  if (providerBinding && firstMutationBaseline?.status === "passed") {
    const providerCommittedAt = Date.parse(cleanString(providerBinding.committedAt));
    const firstMutationCheckedAt = Date.parse(cleanString(firstMutationBaseline.checkedAt));
    if (!Number.isFinite(providerCommittedAt)
      || !Number.isFinite(firstMutationCheckedAt)
      || providerCommittedAt > firstMutationCheckedAt) {
      errors.push("目标参考只在首次 Photoshop 写入之后才被 Provider 确认，不能证明设计决策使用了该参考。 ");
    }
  }
  if (!cleanString(receipt.requestId)) errors.push("运行窗口没有返回请求身份。");
  if (!cleanString(receipt.conversationId)) errors.push("运行窗口没有返回对话身份。");
  if (!Array.isArray(receipt.finalArtifactRefs)
    || receipt.finalArtifactRefs.length === 0
    || receipt.finalArtifactRefs.some((ref) => {
      const normalized = normalizeRelativePath(ref);
      return isUnsafeProjectRelativeRef(normalized);
    })) {
    errors.push("运行窗口没有返回 Agent 交付声明绑定的安全 finalArtifactRefs。 ");
  }
  return { ok: errors.length === 0, errors, receipt };
}

async function dispatchAutonomousZeroCorrectionProtocol(input) {
  const response = await executeGuardedNaturalChatActor(input);
  const receiptValidation = validateDebugBridgeReceipt(response, input);
  if (!receiptValidation.ok) {
    throw new Error(`Debug Bridge 运行收据不可信：${receiptValidation.errors.join("；")}`);
  }
  return {
    version: "design-reliability-live-actor-dispatch/v1",
    protocolKind: "autonomous_zero_correction",
    capabilityId: "guarded-natural-chat-submit/v1",
    receiptVersion: "debug-bridge-chat-submit-receipt/v1",
    response,
    receiptValidation
  };
}

function validateLiveActorDispatchResult(result, protocol, capability) {
  const errors = [];
  if (!isRecord(result)
    || result.version !== "design-reliability-live-actor-dispatch/v1") {
    return { ok: false, errors: ["actor 没有返回统一的 protocol dispatch 收据。"] };
  }
  if (result.protocolKind !== protocol.kind
    || result.protocolKind !== capability.protocolKind) {
    errors.push("actor dispatch 的协议类型与 Case/Capability 不一致。");
  }
  if (result.capabilityId !== capability.capabilityId) {
    errors.push("actor dispatch 的 capability 身份不一致。");
  }
  if (result.receiptVersion !== capability.receiptVersion
    || result.receiptValidation?.receipt?.version !== capability.receiptVersion) {
    errors.push("actor dispatch 的完成收据版本不一致。");
  }
  if (result.receiptValidation?.ok !== true) {
    errors.push("actor dispatch 没有返回已验证的完成收据。");
  }
  if (protocol.kind === "predeclared_user_interaction") {
    errors.push("交互协议必须由专用私有评测 dispatcher 完整实现后才能注册，通用 runner 不接受分散的占位 hook。");
  }
  return { ok: errors.length === 0, errors };
}

function validateMutationBaselineAgainstObservation(receipt, observation, expectedBuildId) {
  const observedMutationCalls = Number(observation?.observed?.observedMutationCalls || 0);
  if (observedMutationCalls <= 0) return { ok: true, errors: [] };
  const baseline = receipt?.firstPhotoshopMutationBaseline;
  const errors = [];
  if (!isRecord(baseline)
    || baseline.status !== "passed"
    || baseline.openDocumentCount !== 0
    || cleanString(baseline.observedPhotoshopRuntimeBuildId) !== cleanString(expectedBuildId)
    || !validatePhotoshopRuntimeBinding(baseline.expectedPhotoshopRuntimeBinding)
    || !photoshopRuntimeBindingsMatch({
      ...baseline.expectedPhotoshopRuntimeBinding,
      live: baseline.observedPhotoshopRuntimeIdentity
    }, baseline.expectedPhotoshopRuntimeBinding)) {
    errors.push("RunRecord 已观察到 Photoshop 写入，但首次写入隔离基线没有通过。");
  }
  return { ok: errors.length === 0, errors };
}

function buildFirstMutationBaselineProof(receipt) {
  const baseline = isRecord(receipt?.firstPhotoshopMutationBaseline)
    ? receipt.firstPhotoshopMutationBaseline
    : null;
  if (!baseline
    || baseline.version !== "guarded-photoshop-execution-baseline-receipt/v0"
    || !["not_reached", "passed", "blocked"].includes(baseline.status)
    || !cleanString(baseline.requestId)
    || !cleanString(baseline.expectedPhotoshopRuntimeBuildId)
    || !validatePhotoshopRuntimeBinding(baseline.expectedPhotoshopRuntimeBinding)) {
    return null;
  }
  const expectedPhotoshopRuntimeBindingDigest = sha256Text(
    stableStringify(baseline.expectedPhotoshopRuntimeBinding)
  );
  const proofCore = {
    version: "design-reliability-first-mutation-baseline-proof/v1",
    status: baseline.status,
    requestIdDigest: sha256Text(cleanString(baseline.requestId)),
    expectedPhotoshopRuntimeBuildId: cleanString(baseline.expectedPhotoshopRuntimeBuildId),
    expectedPhotoshopRuntimeBindingDigest,
    ...(cleanString(baseline.observedPhotoshopRuntimeBuildId)
      ? { observedPhotoshopRuntimeBuildId: cleanString(baseline.observedPhotoshopRuntimeBuildId) }
      : {}),
    ...(Number.isSafeInteger(baseline.openDocumentCount)
      ? { openDocumentCount: baseline.openDocumentCount }
      : {}),
    ...(cleanString(baseline.firstMutationToolName)
      ? { firstMutationToolName: cleanString(baseline.firstMutationToolName).slice(0, 160) }
      : {})
  };
  return {
    ...proofCore,
    proofDigest: sha256Text(stableStringify(proofCore)),
    boundaries: {
      responsePayloadNotPersisted: true,
      rawToolPayloadNotPersisted: true,
      absolutePathsNotPersisted: true
    }
  };
}

function readRunModelIdentity(runRecords) {
  const identities = runRecords.map((record) => record?.modelIdentity);
  if (identities.some((identity) => (
    identity?.version !== "agent-run-model-identity/v0"
    || identity?.source !== "runtime-selected-model"
    || !cleanString(identity?.modelId)
    || !cleanString(identity?.provider)
  ))) {
    return { ok: false, errors: ["RunRecord 缺少 Runtime 实际模型身份。"] };
  }
  const keys = identities.map((identity) => stableStringify({
    modelId: identity.modelId,
    provider: identity.provider,
    apiModelId: cleanString(identity.apiModelId) || undefined
  }));
  if (new Set(keys).size !== 1) {
    return { ok: false, errors: ["同一 RunRecord 链使用了多个模型身份。"] };
  }
  return { ok: true, identity: identities[0] };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBoundRunRecordChain(input) {
  const deadline = Date.now() + 20_000;
  let lastSignature = "";
  let stableSince = 0;
  let lastErrors = [];
  while (Date.now() <= deadline) {
    const newRunFiles = collectRunRecordFiles(input.fixtureRoot)
      .filter((filePath) => !input.beforeRunFiles.has(filePath));
    const candidates = [];
    for (const filePath of newRunFiles) {
      let record;
      try {
        record = readJson(filePath);
      } catch {
        continue;
      }
      if (record?.version !== "agent-run-record/v0") continue;
      if (cleanString(record.goal) !== input.caseSpec.task.instruction) continue;
      if (normalizePathIdentity(record.projectPath) !== normalizePathIdentity(input.fixtureRoot)) continue;
      if (cleanString(record?.conversationScope?.conversationId) !== input.conversationId) continue;
      candidates.push({ filePath, record });
    }
    const signature = candidates.map((item) => item.filePath).sort().join("\n");
    if (signature && signature === lastSignature) {
      if (!stableSince) stableSince = Date.now();
    } else {
      stableSince = signature ? Date.now() : 0;
      lastSignature = signature;
    }
    if (candidates.length > 0 && stableSince && Date.now() - stableSince >= 1500) {
      const records = candidates.map((item) => item.record);
      const validation = validateAgentRunRecordChain(records, {
        expectedGoal: input.caseSpec.task.instruction,
        expectedProjectPath: input.fixtureRoot
      });
      if (validation.ok) {
        return {
          runRecordPaths: candidates.map((item) => item.filePath),
          runRecords: records
        };
      }
      lastErrors = validation.errors;
    }
    await delay(250);
  }
  throw new Error(lastErrors.length > 0
    ? `新增 RunRecord 无法组成唯一任务链：${lastErrors.join("；")}`
    : "Chat 已返回，但 20 秒内没有落盘属于本次对话的 AgentRunRecord。"
  );
}

async function runLiveCase(suite, args) {
  if (!args.hasFlag("--live") || !args.hasFlag("--allow-photoshop-write")) {
    throw new Error("run-live 需要同时显式提供 --live 与 --allow-photoshop-write。 ");
  }
  const provider = args.get("--provider");
  const modelId = args.get("--model");
  if (!provider || !modelId) throw new Error("run-live 必须记录 --provider 与 --model，不能把 unknown 混入正式 cohort。 ");
  const caseSpec = findCase(suite, args.get("--case"));
  if (caseSpec.status !== "active") {
    throw new Error(`run-live 只允许 active Case；${caseSpec.caseId} 当前为 ${caseSpec.status}。`);
  }
  const actorVerdict = validateActiveCaseLiveRunActor(caseSpec);
  if (!actorVerdict.ready) {
    throw new Error(
      `run-live 缺少 ${actorVerdict.protocolKind || "unknown"} 的受控 evaluator actor capability`
      + `${actorVerdict.actorCapabilityId ? `（${actorVerdict.actorCapabilityId}）` : ""}；`
      + "不会把交互协议当作普通自然请求提交。"
    );
  }
  const actorCapability = resolveLiveRunActorCapability(caseSpec);
  if (!actorCapability) {
    throw new Error("run-live actor capability 在验证后消失，本轮不会继续。 ");
  }
  const repeatIndex = Number(args.get("--repeat", "1"));
  if (!Number.isInteger(repeatIndex) || repeatIndex < 1) {
    throw new Error("run-live 的 --repeat 必须是正整数；不会检查 fixture、连接 Photoshop 或写入无效 Attempt。 ");
  }
  const timeoutMs = resolveLiveRunTimeout(suite.manifest, args);
  const fixtureRoot = path.resolve(args.get("--fixture-root"));
  if (!fs.existsSync(fixtureRoot) || !fs.statSync(fixtureRoot).isDirectory()) {
    throw new Error("run-live 需要有效的 --fixture-root。 ");
  }
  const fixtureBefore = inspectFixture([caseSpec], fixtureRoot);
  if (!fixtureBefore.ready) {
    throw new Error(`fixture 输入身份不完整：${[
      ...fixtureBefore.missing.map((ref) => `missing:${ref}`),
      ...fixtureBefore.digestMismatches.map((item) => `digest-mismatch:${item.ref}`),
      ...fixtureBefore.unsafeLinks.map((ref) => `junction/symlink:${ref}`)
    ].join("、")}`);
  }
  if (!fixtureBefore.freshRunReady) {
    const freshnessFailures = [
      ...fixtureBefore.unexpected,
      ...fixtureBefore.workspaceMetadata.errors.map((code) => `workspace-metadata:${code}`),
      ...fixtureBefore.unsafeLinks.map((ref) => `junction/symlink:${ref}`)
    ];
    throw new Error(`fixture 不是可复用的独立样本：${freshnessFailures.join("、")}`);
  }
  const preflight = await buildPreflight(suite, {
    ...args,
    get(name, fallback = "") {
      if (name === "--fixture-root") return fixtureRoot;
      return args.get(name, fallback);
    }
  });
  if (!preflight.readyForLiveCapture) {
    throw new Error(`实机采集前置条件不完整：${preflight.blockers.join("、")}`);
  }
  const environmentAtSubmission = readGitEnvironment();
  if (environmentAtSubmission.dirty) {
    throw new Error("正式成功率样本要求提交时 Git 工作树干净。 ");
  }
  const beforeRunFiles = new Set(collectRunRecordFiles(fixtureRoot));
  const beforeProjectFiles = snapshotProjectFiles(fixtureRoot);
  const cohortId = args.get("--cohort", "candidate");
  const rubric = suite.rubrics.find((item) => item.rubricId === caseSpec.oracle.rubricId);
  const rubricDigest = buildRubricDigest(rubric);
  const instructionDigest = sha256Text(caseSpec.task.instruction);
  const liveRunProtocol = resolveDesignReliabilityLiveRunProtocol(caseSpec);
  const liveRunProtocolDigest = buildDesignReliabilityLiveRunProtocolDigest(caseSpec);
  const runtime = preflight.infrastructure.liveEnvironment.runtime;
  const runtimeBuildId = runtime?.buildId;
  const photoshopRuntime = preflight.infrastructure.liveEnvironment.photoshop;
  const photoshopRuntimeBuildId = photoshopRuntime.runtimeBuildId;
  const photoshopRuntimeGitCommit = photoshopRuntime.runtimeGitCommit;
  const photoshopRuntimeSourceDigest = photoshopRuntime.runtimeSourceDigest;
  const photoshopRuntimeArtifactDigest = photoshopRuntime.runtimeArtifactDigest;
  const photoshopRuntimeManifestDigest = photoshopRuntime.runtimeManifestDigest;
  const photoshopRuntimeBinding = photoshopRuntime.runtimeBinding;
  if (!validatePhotoshopRuntimeBinding(photoshopRuntimeBinding)) {
    throw new Error("正式样本缺少可验证的 Photoshop Runtime 完整身份。 ");
  }
  const photoshopRuntimeBindingDigest = sha256Text(stableStringify(photoshopRuntimeBinding));
  const mainImageCanvasDigest = sha256Text(stableStringify({
    mainImage: preflight.infrastructure.rendererPreflight.currentMainImageCanvas
  }));
  const suiteCaseSetDigest = buildSuiteCaseSetDigest(suite);
  const suiteRubricSetDigest = buildSuiteRubricSetDigest(suite);
  const attemptEnvironment = {
    ...environmentAtSubmission,
    runtimeGitCommit: runtime?.gitCommit,
    runtimeBuildId,
    runtimeAppVersion: runtime?.appVersion,
    photoshopRuntimeBuildId,
    photoshopRuntimeGitCommit,
    photoshopRuntimeSourceDigest,
    photoshopRuntimeArtifactDigest,
    photoshopRuntimeManifestDigest,
    photoshopRuntimeBinding,
    photoshopRuntimeBindingDigest,
    mainImageCanvasDigest
  };
  const cohortFingerprint = deriveLiveCohortFingerprint({
    suiteId: suite.manifest.suiteId,
    suiteCaseSetDigest,
    suiteRubricSetDigest,
    environment: attemptEnvironment,
    provider,
    modelId,
    timeoutMs
  });
  const liveRunProtocolIdentity = {
    kind: liveRunProtocol.kind,
    digest: liveRunProtocolDigest
  };
  const fixtureRef = {
    instanceId: preflight.fixture.instance.instanceId,
    fixtureDigest: fixtureBefore.fixtureDigest,
    workspaceSemanticDigest: fixtureBefore.workspaceMetadata.semanticDigest,
    pathBindingDigest: preflight.fixture.instance.pathBindingDigest
  };
  const caseRef = {
    caseId: caseSpec.caseId,
    revision: caseSpec.revision,
    caseDigest: caseSpec.caseDigest
  };
  const attemptFingerprint = deriveLiveAttemptFingerprint({
    cohortFingerprint,
    caseRef,
    fixtureRef,
    instructionDigest,
    rubricDigest,
    liveRunProtocol: liveRunProtocolIdentity,
    repeatIndex
  });
  const attemptContext = {
    attemptId: buildLiveAttemptId(caseSpec.caseId),
    caseRef,
    cohortId,
    repeatIndex,
    provider,
    modelId,
    timeoutMs,
    liveRunProtocol: liveRunProtocolIdentity,
    fixtureRef,
    environment: {
      ...attemptEnvironment,
      suiteCaseSetDigest,
      suiteRubricSetDigest,
      cohortFingerprint
    },
    instructionDigest,
    rubricDigest,
    suiteCaseSetDigest,
    suiteRubricSetDigest,
    attemptFingerprint,
    cohortFingerprint
  };
  const debugBridge = resolveLoopbackDebugBridge(args.get("--debug-bridge", DEFAULT_DEBUG_BRIDGE));
  const debugToken = args.get("--debug-token", process.env.DESIGNECHO_DEBUG_TOKEN || "");
  if (!debugToken) {
    throw new Error("run-live 需要 --debug-token 或 DESIGNECHO_DEBUG_TOKEN；未授权的本地进程不能启动真实 Agent 写入。");
  }
  const armedAttempt = writeLiveAttemptEvent(attemptContext, 1, "armed", {
    status: "armed",
    interactionMetricsRequireReceipts: true
  });
  const submissionAttempt = writeLiveAttemptEvent(attemptContext, 2, "submission_started", {
    status: "submitted",
    endpointKind: "debug_bridge_chat_submit"
  });
  let trustedCompletionReceipt = false;
  const projectAssetReferences = (caseSpec.task.agentVisibleReferences || []).map((reference) => ({
    version: "debug-bridge-project-asset-reference/v1",
    relativePath: normalizeRelativePath(reference.ref),
    label: cleanString(reference.role) === "user_provided_target_reference"
      ? "用户提供的目标参考"
      : "用户参考",
    digest: cleanString(reference.digest).toLowerCase()
  }));
  try {
    const actorDispatch = await actorCapability.dispatchProtocol({
      debugBridge,
      debugToken,
      caseSpec,
      timeoutMs,
      fixtureRoot,
      provider,
      modelId,
      gitCommit: environmentAtSubmission.gitCommit,
      runtimeBuildId,
      photoshopRuntimeBuildId,
      photoshopRuntimeBinding,
      workspaceSemanticDigest: fixtureBefore.workspaceMetadata.semanticDigest,
      projectAssetReferences
    });
    const actorDispatchValidation = validateLiveActorDispatchResult(
      actorDispatch,
      liveRunProtocol,
      actorCapability
    );
    if (!actorDispatchValidation.ok) {
      throw new Error(`Live actor protocol dispatch 不可信：${actorDispatchValidation.errors.join("；")}`);
    }
    const response = actorDispatch.response;
    const receiptValidation = actorDispatch.receiptValidation;
    trustedCompletionReceipt = true;
    const completionPhotoshopRuntime = await inspectPhotoshopRuntimeBinding(args);
    if (!completionPhotoshopRuntime.ready
      || !photoshopRuntimeBindingsMatch(
        completionPhotoshopRuntime.binding,
        photoshopRuntimeBinding
      )) {
      const issueCodes = (completionPhotoshopRuntime.issues || [])
        .map((issue) => cleanString(issue?.code))
        .filter(Boolean);
      throw new Error(
        `Photoshop Runtime 在任务完成时未通过独立全身份复验：${issueCodes.join("、") || "runtime_binding_drift"}`
      );
    }
    const settled = await waitForBoundRunRecordChain({
      fixtureRoot,
      beforeRunFiles,
      caseSpec,
      conversationId: receiptValidation.receipt.conversationId
    });
    const runRecords = settled.runRecords;
    const runModelIdentity = readRunModelIdentity(runRecords);
    if (!runModelIdentity.ok) {
      throw new Error(runModelIdentity.errors.join("；"));
    }
    const runModelMatches = runModelIdentity.identity.modelId === modelId
      || cleanString(runModelIdentity.identity.apiModelId) === modelId;
    if (!runModelMatches
      || runModelIdentity.identity.provider !== provider) {
      throw new Error(`RunRecord 的 Runtime 模型身份与本次期望模型不一致（期望 ${modelId}，实际 ${runModelIdentity.identity.modelId}${runModelIdentity.identity.apiModelId ? ` / ${runModelIdentity.identity.apiModelId}` : ""}）。`);
    }
    const afterProjectFiles = snapshotProjectFiles(fixtureRoot);
    const changedRefs = changedProjectFiles(beforeProjectFiles, afterProjectFiles);
    const fixtureAfter = inspectFixture([caseSpec], fixtureRoot);
    const fixtureInstance = preflight.fixture.instance;
    const sourceInputIntact = fixtureBefore.fixtureDigest === fixtureAfter.fixtureDigest;
    const projectBindingDigest = sha256Text(stableStringify({
      fixtureInstanceId: fixtureInstance.instanceId,
      pathBindingDigest: fixtureInstance.pathBindingDigest,
      conversationId: receiptValidation.receipt.conversationId,
      sourceRunIds: runRecords.map((record) => record.runId),
      submittedProjectMatched: receiptValidation.receipt.expectedProjectMatchedAtSubmission === true,
      projectUnchanged: receiptValidation.receipt.projectUnchangedThroughCompletion === true
    }));
    const modelIdentityDigest = sha256Text(stableStringify({
      modelId: runModelIdentity.identity.modelId,
      provider: runModelIdentity.identity.provider,
      apiModelId: cleanString(runModelIdentity.identity.apiModelId) || undefined,
      receiptModelId: receiptValidation.receipt.submittedModelId,
      receiptApiModelId: cleanString(receiptValidation.receipt.submittedApiModelId) || undefined,
      receiptProvider: receiptValidation.receipt.provider
    }));
    const evidenceBundle = await outputEvidenceFromChanges(
      caseSpec,
      fixtureRoot,
      changedRefs,
      {
        fixtureInstance,
        fixtureInstanceVerified: true,
        modelIdentityDigest,
        modelIdentityVerified: true,
        projectBindingDigest,
        projectBindingVerified: receiptValidation.ok && sourceInputIntact,
        finalArtifactRefs: receiptValidation.receipt.finalArtifactRefs,
        skuDeliveryEvidence: receiptValidation.receipt.skuDeliveryEvidence
      },
      fixtureBefore,
      fixtureAfter
    );
    const observation = deriveDesignReliabilityRunObservation({
      caseSpec,
      runRecords,
      expectedProjectPath: fixtureRoot,
      cohortId,
      repeatIndex,
      // 当前 Debug 协议还没有 Provider / operation 级交互收据。只发送一条自然请求
      // 不能证明用户没有从 UI 介入；保持 unknown，禁止用伪造的 0 通过发布门禁。
      userInterventionCount: undefined,
      fixtureDigest: fixtureBefore.fixtureDigest,
      environment: {
        ...environmentAtSubmission,
        attemptId: attemptContext.attemptId,
        attemptFingerprint,
        provider: runModelIdentity.identity.provider,
        modelId: runModelIdentity.identity.modelId,
        requestedModelId: modelId,
        runtimeGitCommit: runtime?.gitCommit,
        runtimeBuildId,
        runtimeAppVersion: runtime?.appVersion,
        photoshopRuntimeBuildId,
        photoshopRuntimeBindingDigest,
        mainImageCanvasDigest,
        timeoutMs,
        instructionDigest,
        rubricDigest,
        liveRunProtocolKind: liveRunProtocol.kind,
        liveRunProtocolDigest,
        workspaceSemanticDigest: fixtureBefore.workspaceMetadata.semanticDigest,
        fixtureInstanceId: preflight.fixture.instance.instanceId,
        suiteCaseSetDigest,
        suiteRubricSetDigest,
        cohortFingerprint
      },
      evidenceRefs: evidenceBundle.evidenceRefs,
      finalArtifactManifest: evidenceBundle.finalArtifactManifest
    });
    const baselineValidation = validateMutationBaselineAgainstObservation(
      receiptValidation.receipt,
      observation,
      photoshopRuntimeBuildId
    );
    if (!baselineValidation.ok) throw new Error(baselineValidation.errors.join("；"));
    const validation = validateDesignReliabilityRun(observation);
    if (!validation.ok) throw new Error(validation.errors.join("；"));
    const outputPath = resolveSidecarOutputPath(
      DEFAULT_DATA_ROOT,
      ["runs", observation.cohortId],
      observation.runObservationId
    );
    writeJsonExclusive(outputPath, observation);
    const attemptReport = {
      version: "design-reliability-live-attempt/v1",
      attemptId: attemptContext.attemptId,
      attemptedAt: new Date().toISOString(),
      caseId: caseSpec.caseId,
      cohortId: observation.cohortId,
      runObservationId: observation.runObservationId,
      sourceRunIds: observation.sourceRunRefs.map((item) => item.agentRunId),
      changedOutputRefs: changedRefs.filter((ref) => !caseSpec.task.agentVisibleInputs.some((input) => normalizeRelativePath(input.ref) === ref)),
      debugResponse: summarizeDebugResponse(response),
      firstMutationBaselineProof: buildFirstMutationBaselineProof(receiptValidation.receipt),
      status: observation.observed.technicalDeliveryPassed ? "technical_delivery_passed" : "evidence_incomplete",
      boundaries: {
        noRuntimeStateChangedByRecorder: true,
        responsePayloadNotPersisted: true,
        absolutePathsNotPersisted: true,
        aestheticReviewStillRequired: true
      }
    };
    const attemptPath = resolveSidecarOutputPath(
      DEFAULT_DATA_ROOT,
      ["attempts"],
      observation.runObservationId
    );
    writeJsonExclusive(attemptPath, attemptReport);
    const terminalStatus = observation.observed.technicalDeliveryPassed
      ? "technical_delivery_passed"
      : "evidence_incomplete";
    const terminalAttempt = writeLiveAttemptEvent(attemptContext, 3, "terminal", {
      status: terminalStatus,
      runObservationId: observation.runObservationId,
      sourceRunIds: observation.sourceRunRefs.map((item) => item.agentRunId),
      technicalDeliveryPassed: observation.observed.technicalDeliveryPassed === true,
      interactionMetricsKnown: false,
      firstMutationBaselineProof: buildFirstMutationBaselineProof(receiptValidation.receipt)
    });
    return {
      observation,
      outputPath,
      attemptReport,
      attemptPath,
      liveAttempt: {
        attemptId: attemptContext.attemptId,
        armedEventPath: armedAttempt.eventPath,
        submissionEventPath: submissionAttempt.eventPath,
        terminalEventPath: terminalAttempt.eventPath
      }
    };
  } catch (error) {
    const debugBridgeFailure = readDebugBridgeFailureFromError(error);
    writeLiveAttemptEvent(attemptContext, 3, "terminal", {
      status: trustedCompletionReceipt
        ? classifyLiveAttemptFailure(error)
        : classifyUntrustedDebugBridgeFailure(error),
      technicalDeliveryPassed: false,
      interactionMetricsKnown: false,
      diagnostic: sanitizeAttemptDiagnostic(error instanceof Error ? error.message : String(error)),
      ...(debugBridgeFailure ? {
        debugBridgeFailure: {
          version: debugBridgeFailure.version,
          stage: debugBridgeFailure.stage,
          writePossible: debugBridgeFailure.writePossible,
          ...(debugBridgeFailure.code ? { code: debugBridgeFailure.code } : {})
        }
      } : {})
    });
    throw error;
  }
}

async function reconcileLiveAttempt(args) {
  const attemptId = args.get("--attempt-id");
  const fixtureRoot = path.resolve(args.get("--fixture-root"));
  if (!attemptId || !args.get("--fixture-root")) {
    throw new Error("reconcile-live-attempt 需要 --attempt-id 与原 --fixture-root。");
  }
  if (!fs.existsSync(fixtureRoot) || !fs.statSync(fixtureRoot).isDirectory()) {
    throw new Error("原 fixture-root 不存在，无法核对超时后的项目与 Photoshop 状态。");
  }
  const sidecars = collectSidecars(
    [CANONICAL_ATTEMPT_EVENTS_ROOT],
    { strictAttemptEvents: true }
  );
  const events = sidecars.attemptEvents
    .filter((event) => event.attemptId === attemptId)
    .sort((left, right) => left.sequence - right.sequence);
  if (events.length === 0) throw new Error(`找不到 Attempt：${attemptId}`);
  if (events.some((event) => event.eventType === "reconciled")) {
    throw new Error(`Attempt ${attemptId} 已经完成 reconciliation，不能重复追加。`);
  }
  const submitted = events.filter((event) => event.eventType === "submission_started").at(-1);
  const terminal = events.filter((event) => event.eventType === "terminal").at(-1);
  if (!submitted) {
    throw new Error("只有已经进入 submission_started 的 Attempt 才需要执行 reconciliation。");
  }
  if (terminal && !String(terminal.status || "").includes("unknown_write_state")) {
    throw new Error("当前 terminal 已是确定终态，不需要执行 unknown-write reconciliation。");
  }
  const eventIdentities = new Set(events.map(buildAttemptEventIdentityKey));
  if (eventIdentities.size !== 1) {
    throw new Error("Attempt 事件身份已经漂移，不能自动完成 reconciliation。");
  }
  const liveEnvironment = await inspectLiveEnvironment(args, fixtureRoot, {
    documentPolicy: "no_fixture_documents"
  });
  const unresolvedEvent = terminal || submitted;
  const terminalAt = Date.parse(unresolvedEvent.occurredAt);
  const runtimeStartedAt = Date.parse(liveEnvironment.runtime?.processStartedAt || "");
  const photoshopRuntimeLoadedAt = Date.parse(liveEnvironment.photoshop?.runtimeLoadedAt || "");
  if (!liveEnvironment.ready
    || !Number.isFinite(terminalAt)
    || !Number.isFinite(runtimeStartedAt)
    || runtimeStartedAt <= terminalAt
    || !Number.isFinite(photoshopRuntimeLoadedAt)
    || photoshopRuntimeLoadedAt <= terminalAt) {
    throw new Error(
      "Reconciliation 需要在异常后重启最新干净 Agent / Photoshop Runtime、绑定原项目、清空待处理请求，并证明所有打开文档都不属于原 fixture。"
    );
  }
  const context = buildLiveAttemptContextFromEvent(unresolvedEvent);
  if (!terminal) {
    writeLiveAttemptEvent(context, 3, "terminal", {
      status: "submission_unknown_write_state",
      technicalDeliveryPassed: false,
      interactionMetricsKnown: false,
      diagnostic: "recorder_interrupted_before_terminal_event"
    });
  }
  const result = writeLiveAttemptEvent(context, 4, "reconciled", {
    status: "reconciled_after_runtime_restart",
    priorStatus: terminal?.status || "submitted_without_terminal",
    runtimeBuildId: liveEnvironment.runtime.buildId,
    runtimeProcessStartedAt: liveEnvironment.runtime.processStartedAt,
    photoshopRuntimeBuildId: liveEnvironment.photoshop.runtimeBuildId,
    reconciliationFacts: {
      runtimeRestartedAfterFailure: true,
      photoshopRuntimeReloadedAfterFailure: true,
      noPendingPhotoshopRequests: true,
      noOpenAttemptFixtureDocuments: true,
      openDocumentOwnershipResolved: true,
      openUnrelatedPhotoshopDocumentCount:
        liveEnvironment.photoshop.openOutsideFixtureDocumentCount,
      documentPolicy: "no_fixture_documents",
      projectMatchesOriginalFixture: true
    }
  });
  return {
    success: true,
    attemptId,
    eventPath: result.eventPath,
    status: result.event.status
  };
}

function evaluateDebugRendererPreflight(input) {
  const responseBody = isRecord(input?.probe?.responseBody)
    ? input.probe.responseBody
    : null;
  const renderer = isRecord(responseBody?.renderer) ? responseBody.renderer : null;
  const expectedProvider = cleanString(input?.expectedProvider);
  const expectedModelId = cleanString(input?.expectedModelId);
  const expectedProjectPath = normalizePathIdentity(input?.expectedProjectPath);
  const selectedProvider = cleanString(renderer?.selectedProvider);
  const selectedModelId = cleanString(renderer?.selectedModelId);
  const selectedApiModelId = cleanString(renderer?.selectedApiModelId);
  const rendererMainImageCanvas = isRecord(renderer?.mainImageCanvas)
    && Number.isSafeInteger(renderer.mainImageCanvas.width)
    && Number.isSafeInteger(renderer.mainImageCanvas.height)
    ? {
        width: renderer.mainImageCanvas.width,
        height: renderer.mainImageCanvas.height
      }
    : null;
  const expectedMainImageCanvas = isRecord(input?.expectedMainImageCanvas)
    && Number.isSafeInteger(input.expectedMainImageCanvas.width)
    && Number.isSafeInteger(input.expectedMainImageCanvas.height)
    ? {
        width: input.expectedMainImageCanvas.width,
        height: input.expectedMainImageCanvas.height
      }
    : null;
  const capturedAt = Date.parse(cleanString(renderer?.capturedAt));
  const available = Boolean(
    input?.probe?.reachable === true
    && responseBody?.success === true
    && responseBody?.guardedWriteProtocol === "debug-bridge-chat-submit/v1"
    && renderer?.version === DEBUG_BRIDGE_CHAT_PREFLIGHT_VERSION
    && Number.isFinite(capturedAt)
    && typeof renderer?.selectedModelResolved === "boolean"
    && typeof renderer?.projectPath === "string"
    && rendererMainImageCanvas !== null
    && typeof renderer?.chatBusy === "boolean"
  );
  const providerMatches = Boolean(
    available
    && expectedProvider
    && selectedProvider === expectedProvider
  );
  const modelMatches = Boolean(
    available
    && expectedModelId
    && (selectedModelId === expectedModelId || selectedApiModelId === expectedModelId)
  );
  const projectMatches = Boolean(
    available
    && expectedProjectPath
    && normalizePathIdentity(renderer.projectPath) === expectedProjectPath
  );
  const designDimensionMatches = Boolean(
    available
    && (!expectedMainImageCanvas
      || (rendererMainImageCanvas?.width === expectedMainImageCanvas.width
        && rendererMainImageCanvas?.height === expectedMainImageCanvas.height))
  );
  return {
    version: "design-reliability-renderer-preflight/v2",
    available,
    expectedProviderSupplied: Boolean(expectedProvider),
    expectedModelSupplied: Boolean(expectedModelId),
    selectedProvider,
    selectedModelId,
    selectedApiModelId,
    selectedModelResolved: renderer?.selectedModelResolved === true,
    providerMatches,
    modelMatches,
    projectMatches,
    expectedMainImageCanvasSupplied: Boolean(expectedMainImageCanvas),
    expectedMainImageCanvas,
    currentMainImageCanvas: rendererMainImageCanvas,
    designDimensionMatches,
    chatBusy: renderer?.chatBusy === true,
    ready: Boolean(
      available
      && renderer?.selectedModelResolved === true
      && providerMatches
      && modelMatches
      && projectMatches
      && designDimensionMatches
      && renderer?.chatBusy === false
    )
  };
}

function summarizeDebugWriteAuthorization(probe) {
  const responseBody = isRecord(probe?.responseBody) ? probe.responseBody : null;
  const failure = readDebugBridgeExecutionFailure(responseBody);
  return {
    reachable: probe?.reachable === true,
    ...(Number.isInteger(probe?.status) ? { status: probe.status } : {}),
    ...(cleanString(probe?.reason) ? { reason: cleanString(probe.reason) } : {}),
    guardedWriteProtocol: cleanString(responseBody?.guardedWriteProtocol) || null,
    ...(failure ? {
      failure: {
        version: failure.version,
        stage: failure.stage,
        writePossible: failure.writePossible,
        ...(failure.code ? { code: failure.code } : {})
      }
    } : {})
  };
}

async function buildPreflight(suite, args) {
  const fixtureRoot = args.get("--fixture-root");
  const debugWriteTokenSupplied = Boolean(
    args.get("--debug-token", process.env.DESIGNECHO_DEBUG_TOKEN || "")
  );
  let fixture = {
    supplied: false,
    ready: false,
    reason: "未提供 --fixture-root；不会猜测或直接使用原始项目。"
  };
  let selectedCases;
  if (fixtureRoot) {
    const absoluteFixtureRoot = path.resolve(fixtureRoot);
    if (fs.existsSync(absoluteFixtureRoot) && fs.statSync(absoluteFixtureRoot).isDirectory()) {
      try {
        selectedCases = selectFixtureCases(suite, args);
      } catch (error) {
        fixture = {
          supplied: true,
          ready: false,
          reason: error instanceof Error ? error.message : String(error)
        };
      }
      if (selectedCases) {
        const inspection = inspectFixture(selectedCases, absoluteFixtureRoot);
        const instance = inspection.ready
          ? readFixtureInstance(absoluteFixtureRoot, selectedCases, inspection)
          : undefined;
        fixture = {
          supplied: true,
          ...inspection,
          instanceReady: Boolean(instance),
          ...(instance ? { instance } : {
            instanceReason: '该目录没有与自身路径绑定的 prepare-fixture 实例收据；拒绝把原始项目当成一次性测试副本。'
          })
        };
      }
    } else {
      fixture = { supplied: true, ready: false, reason: "fixture-root 不存在或不是目录。" };
    }
  }
  const debugToken = args.get("--debug-token", process.env.DESIGNECHO_DEBUG_TOKEN || "");
  const debugBridgeUrl = resolveLoopbackDebugBridge(
    args.get("--debug-bridge", DEFAULT_DEBUG_BRIDGE)
  );
  const [debugBridge, debugWriteAuthorization, photoshopMcp] = await Promise.all([
    httpProbe(`${debugBridgeUrl}/health`),
    debugToken
      ? httpProbe(
        `${debugBridgeUrl}/chat/submit/preflight`,
        1200,
        { "x-designecho-debug-token": debugToken }
      )
      : Promise.resolve({ reachable: false, reason: "debug_write_token_missing" }),
    httpProbe(args.get("--photoshop-health", DEFAULT_PHOTOSHOP_MCP_HEALTH))
  ]);
  const expectedMainImageCanvas = selectedCases?.length === 1
    && selectedCases[0]?.oracle?.outputContract?.canvasAuthority === "runtime_setting"
    && isRecord(selectedCases[0]?.oracle?.outputContract?.canvas)
    ? selectedCases[0].oracle.outputContract.canvas
    : undefined;
  const rendererPreflight = evaluateDebugRendererPreflight({
    probe: debugWriteAuthorization,
    expectedProvider: args.get("--provider"),
    expectedModelId: args.get("--model"),
    expectedProjectPath: fixture.supplied && fixture.ready === true
      ? path.resolve(fixtureRoot)
      : "",
    expectedMainImageCanvas
  });
  const debugWriteAuthorizationSummary = summarizeDebugWriteAuthorization(
    debugWriteAuthorization
  );
  const liveEnvironment = photoshopMcp.reachable === true
    ? await inspectLiveEnvironment(
      args,
      fixture.supplied && fixture.ready === true ? path.resolve(fixtureRoot) : ""
    )
    : {
      ready: false,
      blockers: ["photoshop_mcp_unreachable"],
      checks: {},
      runtime: null,
      photoshop: {
        connected: false,
        runtimeBuildId: null,
        runtimeLoadedAt: null,
        pendingRequestCount: null,
        openDocumentCount: null,
        hasUnsavedDocument: null
      },
      project: {
        expectedFixtureSupplied: Boolean(fixtureRoot),
        currentProjectMatchesFixture: false
      }
    };
  const status = await buildStatus(suite, args);
  const fixtureInstanceAlreadyUsed = Boolean(
    fixture.instance?.instanceId
    && status.evidence.attemptSafetyLedger.usedFixtureInstanceIds.includes(fixture.instance.instanceId)
  );
  const unreconciledLiveAttempt = status.evidence.attemptSafetyLedger.unresolvedAttemptCount > 0;
  const invalidAttemptSidecar = status.evidence.canonicalAttemptInvalidSidecars.some((item) => (
    item?.kind === "attempt_event"
  ));
  const activeFamilies = new Set(suite.cases.filter((item) => item.status === "active").map((item) => item.taskFamily));
  const caseCoverageReady = TASK_FAMILIES.every((family) => activeFamilies.has(family));
  const liveEvidencePassed = status.success === true
    && status.evidence.attemptSafetyLedger.unresolvedAttemptCount === 0
    && Object.entries(status.releaseGateEvaluations).some(([cohortId, evaluation]) => (
      evaluation.passed === true
      && isOfficialAttemptCohortReady(status.evidence.attemptCoverage.byCohort[cohortId])
    ));
  const captureBlockers = [
    ...(suite.ok ? [] : ["suite_invalid"]),
    ...(caseCoverageReady ? [] : ["fixed_case_coverage_missing"]),
    ...(fixture.ready ? [] : ["disposable_fixture_not_ready"]),
    ...(Array.isArray(fixture.unexpected) && fixture.unexpected.length > 0
      ? ["disposable_fixture_contains_unexpected_files"]
      : []),
    ...(fixture.workspaceMetadata?.ready === false
      ? ["disposable_fixture_workspace_metadata_invalid"]
      : []),
    ...(fixture.instanceReady ? [] : ["disposable_fixture_instance_unverified"]),
    ...(fixtureInstanceAlreadyUsed ? ["disposable_fixture_instance_already_used"] : []),
    ...(debugBridge.reachable ? [] : ["debug_bridge_unreachable"]),
    ...(debugWriteTokenSupplied ? [] : ["debug_write_token_missing"]),
    ...(debugWriteAuthorization.reachable ? [] : ["debug_write_authorization_failed"]),
    ...(rendererPreflight.expectedProviderSupplied ? [] : ["expected_provider_missing"]),
    ...(rendererPreflight.expectedModelSupplied ? [] : ["expected_model_missing"]),
    ...(rendererPreflight.available ? [] : ["debug_renderer_preflight_unavailable"]),
    ...(rendererPreflight.available && !rendererPreflight.selectedModelResolved
      ? ["renderer_selected_model_unresolved"]
      : []),
    ...(rendererPreflight.available
      && rendererPreflight.expectedProviderSupplied
      && !rendererPreflight.providerMatches
      ? ["renderer_provider_mismatch"]
      : []),
    ...(rendererPreflight.available
      && rendererPreflight.expectedModelSupplied
      && !rendererPreflight.modelMatches
      ? ["renderer_model_mismatch"]
      : []),
    ...(rendererPreflight.available && !rendererPreflight.projectMatches
      ? ["renderer_project_not_bound_to_fixture"]
      : []),
    ...(rendererPreflight.available
      && rendererPreflight.expectedMainImageCanvasSupplied
      && !rendererPreflight.designDimensionMatches
      ? ["renderer_design_dimension_mismatch"]
      : []),
    ...(rendererPreflight.available && rendererPreflight.chatBusy
      ? ["renderer_chat_busy"]
      : []),
    ...(photoshopMcp.reachable ? [] : ["photoshop_mcp_unreachable"]),
    ...liveEnvironment.blockers,
    ...(invalidAttemptSidecar ? ["attempt_safety_ledger_invalid"] : []),
    ...(unreconciledLiveAttempt ? ["unreconciled_live_attempt_exists"] : [])
  ];
  const readyForLiveCapture = captureBlockers.length === 0;
  const releaseBlockers = liveEvidencePassed
    ? []
    : ["fixed_design_reliability_evidence_incomplete"];
  return {
    success: true,
    generatedAt: new Date().toISOString(),
    mode: "read_only_design_reliability_preflight",
    caseCoverageReady,
    fixture,
    infrastructure: {
      debugBridge,
      debugWriteTokenSupplied,
      debugWriteAuthorization: debugWriteAuthorizationSummary,
      rendererPreflight,
      photoshopMcp,
      liveEnvironment,
      unreconciledLiveAttempt,
      fixtureInstanceAlreadyUsed,
      expectedProjectBindingEnforcedAtSubmission: true
    },
    readyForLiveCapture,
    liveEvidencePassed,
    releaseGateEvaluations: status.releaseGateEvaluations,
    captureBlockers,
    releaseBlockers,
    blockers: captureBlockers,
    boundaries: [
      "此命令只读，不调用模型或 Photoshop 写工具。",
      "readyForLiveCapture 只在 Runtime 提交版本、当前项目、Photoshop 空文档基线与请求队列均可信时表示可以开始采集，不表示当前固定任务族已经通过。",
      "liveEvidencePassed 逐项消费 suites.manifest.json 的发布门禁；样本、人工评审或证据不足均不能通过。"
    ]
  };
}

function printStatus(status) {
  console.log("DesignEcho Design Reliability");
  console.log(`持久账本: ${status.storage.canonicalDataRoot}`);
  console.log(`Suite: ${status.suite.suiteId}`);
  console.log(`固定 Case: ${status.suite.activeCases.length}`);
  for (const item of status.suite.activeCases) {
    console.log(`  - ${item.taskFamily}: ${item.caseId} · ${item.instruction}`);
  }
  console.log(`Run Observation: ${status.evidence.runObservations}`);
  console.log(`当前 Case revision Attempt Submission: ${status.evidence.attemptCoverage.submittedAttempts}`);
  console.log(`当前 Case revision Attempt Terminal: ${status.evidence.attemptCoverage.terminalAttempts}`);
  console.log(`当前 Case revision Attempt 未闭合: ${status.evidence.attemptCoverage.attemptsWithoutTerminal}`);
  console.log(`全局写状态安全账本未清账: ${status.evidence.attemptSafetyLedger.unresolvedAttemptCount}`);
  console.log(`Human Review: ${status.evidence.humanReviews}`);
  console.log(`Attribution: ${status.evidence.attributions}`);
  console.log(`正式成功率可用: ${status.officialRateAvailable ? "是" : "否（尚未形成完整固定 cohort + 人工评审）"}`);
  for (const [cohortId, report] of Object.entries(status.reports)) {
    console.log(`\nCohort ${cohortId}`);
    console.log(`  Case 覆盖: ${report.coverage.coveredCases}/${report.coverage.eligibleCases}`);
    const attemptCohort = status.evidence.attemptCoverage.byCohort[cohortId];
    console.log(`  Attempt 分母: ${attemptCohort?.submitted || 0}（终态 ${attemptCohort?.terminal || 0}，Run Observation 绑定 ${attemptCohort?.linkedRunObservations || 0}）`);
    console.log(`  全 Attempt 技术交付: ${formatRate(attemptCohort?.technicalDeliveryRate)}`);
    console.log(`  全 Attempt 商业可用: ${formatRate(attemptCohort?.commercialUsableRate)}`);
    console.log(`  成稿严格盲评覆盖: ${formatRate(attemptCohort?.strictReviewCoverageOfTechnicalPasses)}`);
    console.log(`  已绑定 Run 技术交付（诊断）: ${formatRate(report.overall.reliability.technicalDeliveryRate)}`);
    console.log(`  真实写入: ${formatRate(report.overall.reliability.observedMutationRate)}`);
    console.log(`  写后看图: ${formatRate(report.overall.reliability.postWriteVisualReadbackRate)}`);
    console.log(`  假完成: ${formatRate(report.overall.reliability.falseCompletionRate)}`);
    console.log(`  Agentic 决策归属证据: ${formatRate(report.overall.reliability.agenticDecisionPreservationEvidenceCoverage)}`);
    console.log(`  Agentic 模型主导（一级）: ${formatRate(report.overall.reliability.agenticLevelOneDecisionPreservationRate)}`);
    console.log(`  Agentic Harness 写入尝试: ${report.overall.reliability.agenticHarnessWriteAttemptRunCount}`);
    console.log(`  人工评审记录覆盖: ${formatRate(report.overall.quality.humanReviewedRate)}`);
    console.log(`  严格盲评覆盖: ${formatRate(report.overall.quality.strictHumanReviewedRate)}`);
    console.log(`  已评审样本通过: ${formatRate(report.overall.quality.humanPassRate)}`);
    console.log(`  已绑定 Run 商业可用（诊断）: ${formatRate(report.overall.quality.humanUsableRate)}`);
  }
}

function formatRate(value) {
  if (!value || value.denominator === 0 || value.value === null) return "无可用分母";
  return `${value.numerator}/${value.denominator} (${(value.value * 100).toFixed(1)}%)`;
}

function printHelp() {
  console.log([
    "DesignEcho Design Reliability CLI",
    "",
    "命令：",
    "  validate",
    "      校验固定 Case、Rubric、digest 与开发/生产边界。",
    "  status [--cohort id] [--data-root dir]",
    "      汇总固定 cohort；没有 Case 身份的历史 Run 不进入分母。",
    "  compare --baseline-cohort id --candidate-cohort id [--data-root dir]",
    "      仅在 Case、Rubric 与逐 Case fixture 摘要一致时比较前后 cohort。",
    "  preflight [--case id|--fixture-id id] [--fixture-root dir] [--provider id] [--model id] [--require-capture-ready] [--require-live] [--write-report]",
    "      默认零落盘地只读检查 fixture、Renderer 当前模型/项目、Debug Bridge、Photoshop MCP 与已有实机证据；显式 --write-report 才追加保存报告。",
    "      --require-capture-ready 检查能否安全开始下一次实机 Case；--require-live 检查当前全部 active Case 任务族的正式发布证据是否完整。",
    "  prepare-fixture --case id|--fixture-id id --source-root dir --destination dir --allow-create",
    "      只复制 Agent 可见输入到一次性目录；用户成稿/Eagle 参考不会复制。",
    "  run-live --case id --fixture-root dir --provider id --model id --live --allow-photoshop-write",
    "      --debug-token token（或 DESIGNECHO_DEBUG_TOKEN）",
    "      通过当前 DesignEcho 窗口提交自然请求；提交前强制当前项目与 fixture 精确匹配；timeout 由 Suite 固定，显式覆盖必须完全一致。",
    "  reconcile-live-attempt --attempt-id id --fixture-root dir",
    "      超时或断连后，只在 Runtime 已重启、无打开文档/待处理请求且仍绑定原 fixture 时追加对账收据。",
    "  record-run --case id --run-record file [--run-record file...] --fixture-root dir",
    "      --cohort id --provider id --model id --repeat N --user-interventions N",
    "      --evidence editable_psd=relative/path --evidence raster_export=relative/path",
    "      --final-artifact relative/path（可重复；必须来自 Agent delivery receipt，不得把全部导出猜成最终稿）",
    "  record-review --run-observation file --reviewer alias --decision pass|needs_fix|unscorable",
    "      --scores dimension=0.8,... [--pairwise comparable|better|weaker]",
    "      --blinded-to-candidate-origin --comparison-evidence-ref candidate_final=candidate:relative/path@sha256:<64位摘要>",
    "      --comparison-evidence-ref user_design_anchor=user-design:<Case相对路径>@sha256:<冻结摘要>",
    "      --comparison-evidence-ref eagle_anchor=eagle:item:<条目ID>@sha256:<冻结摘要> [--blocker text]",
    "      record-review 始终只生成 bound_self_reported 诊断评审；正式成功率必须走下面的匿名评审包命令。",
    "  prepare-review-packet --case id --run-observation file --reviewer-packet-dir dir --allow-create",
    "      --source-bindings-json file，或重复 --source-binding evidenceRef=绝对文件路径；密封映射按 packetId 自动私有保存且不打印路径。",
    "  record-anonymous-review --case id --run-observation file --packet-id id --reviewer-packet-dir dir --reviewer-response file",
    "      归档 canonical verification bundle；status 每次从磁盘重算包、映射、响应和资产后才授予 strict 身份。",
    "  record-attribution (--run-observation file | --attempt-id id) --owner owner --failure-mode mode",
    "      --status hypothesis|confirmed|rejected --rationale text --evidence-ref token",
    "",
    `所有正式 sidecar 默认写入仓库外持久目录 ${DEFAULT_DATA_ROOT}，append-only，不反写 Runtime 或 Case；仓库卫生清理不会重置成功率分母。`
  ].join("\n"));
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.command === "help" || args.hasFlag("--help")) {
    printHelp();
    return;
  }
  const suite = loadSuite();
  if (args.command === "validate") {
    if (!suite.ok) throw new Error(suite.errors.join("\n"));
    console.log(`Design Reliability 契约通过：${suite.cases.length} 个 Case，${suite.rubrics.length} 个 Rubric。`);
    return;
  }
  if (!suite.ok) throw new Error(`Design Reliability 套件无效：\n${suite.errors.join("\n")}`);
  if (args.command === "status" || args.command === "report") {
    const status = await buildStatus(suite, args);
    if (args.hasFlag("--json")) console.log(JSON.stringify(status, null, 2));
    else printStatus(status);
    return;
  }
  if (args.command === "compare") {
    const comparison = await buildCohortComparison(suite, args);
    console.log(JSON.stringify(comparison, null, 2));
    if (!comparison.success) process.exitCode = 1;
    return;
  }
  if (args.command === "preflight") {
    const report = await buildPreflight(suite, args);
    const reportPath = shouldPersistPreflightReport(args)
      ? writePreflightReport(report)
      : undefined;
    console.log(JSON.stringify({
      ...report,
      reportPersisted: Boolean(reportPath),
      ...(reportPath ? { reportPath } : {})
    }, null, 2));
    if (args.hasFlag("--require-capture-ready") && report.readyForLiveCapture !== true) process.exitCode = 1;
    if (args.hasFlag("--require-live") && report.liveEvidencePassed !== true) process.exitCode = 1;
    return;
  }
  if (args.command === "prepare-fixture") {
    const result = prepareFixture(suite, args);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (args.command === "record-run") {
    const result = recordRun(suite, args);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (args.command === "run-live") {
    const result = await runLiveCase(suite, args);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (args.command === "reconcile-live-attempt") {
    const result = await reconcileLiveAttempt(args);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (args.command === "record-review") {
    const result = recordReview(suite, args);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (args.command === "prepare-review-packet") {
    const result = await prepareAnonymousReviewPacket(suite, args);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (args.command === "record-anonymous-review") {
    const result = await recordAnonymousReview(suite, args);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (args.command === "record-attribution") {
    const result = recordAttribution(suite, args);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  throw new Error(`未知命令：${args.command}`);
}

module.exports = {
  artifactGeometryMatchesCase,
  buildAttemptEventIdentityKey,
  buildAttemptCohortReportContext,
  buildCanonicalAttemptSafetyLedger,
  buildFirstMutationBaselineProof,
  classifyUntrustedDebugBridgeFailure,
  buildSuiteCaseSetDigest,
  buildSuiteRubricSetDigest,
  buildPreflight,
  buildCohortComparison,
  buildLiveAttemptCoverage,
  buildStatus,
  buildSkuLiveDeliveryEvidence,
  collectSidecars,
  controlledProjectMetadataSchemaSnapshot,
  deriveLiveAttemptFingerprint,
  deriveLiveCohortFingerprint,
  evaluateLiveEnvironmentSafety,
  evaluateAttributableAttemptEvents,
  evaluateOfficialAttemptEligibility,
  evaluateDebugRendererPreflight,
  evaluateFixtureInventory,
  inspectFixture,
  inspectEditablePsd,
  isOfficialAttemptCohortReady,
  loadSuite,
  parseArgs,
  parseReviewPacketSourceBindings,
  prepareFixture,
  prepareAnonymousReviewPacket,
  readFixtureInstance,
  readDebugBridgeExecutionFailure,
  revalidateOfficialReviewBundles,
  recordAttribution,
  recordAnonymousReview,
  recordReview,
  recordRun,
  reconcileLiveAttempt,
  resolveReliabilityEvidenceRoots,
  resolveAttributionCliSubject,
  resolveLiveRunTimeout,
  resolveLiveRunActorCapability,
  resolveLoopbackDebugBridge,
  resolveSidecarOutputPath,
  retainContextuallyValidAttemptEvents,
  retainContextuallyValidReviews,
  runObservationMatchesAttempt,
  sidecarRoots,
  shouldPersistPreflightReport,
  sanitizeAttemptDiagnostic,
  validateAttemptEventStateMachine,
  validateDebugBridgeReceipt,
  validateRubric,
  validateMutationBaselineAgainstObservation,
  writePreflightReport,
  runLiveCase
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}
