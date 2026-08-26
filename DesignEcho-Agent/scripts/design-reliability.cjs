#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { readPsd } = require("ag-psd");
const sharp = require("sharp");
const { spawnSync } = require("child_process");

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
  buildDesignReliabilityCohortReport,
  buildRubricDigest,
  calculateWeightedOverall,
  deriveDesignReliabilityRunObservation,
  evaluateDesignReliabilityReleaseGates,
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
const DEFAULT_DATA_ROOT = path.join(ROOT, "tmp", "design-reliability");
const CANONICAL_ATTEMPT_EVENTS_ROOT = path.join(DEFAULT_DATA_ROOT, "attempt-events");
const DEFAULT_DEBUG_BRIDGE = "http://127.0.0.1:8767";
const DEFAULT_PHOTOSHOP_MCP_HEALTH = "http://127.0.0.1:8768/health";
const DEFAULT_PHOTOSHOP_MCP_ENDPOINT = "http://127.0.0.1:8768/mcp";
const MAX_LIVE_RUN_TIMEOUT_MS = 30 * 60 * 1000;
const LIVE_ATTEMPT_EVENT_VERSION = "design-reliability-attempt-event/v1";

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

function writeJsonReplace(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
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
    .replace(/[A-Za-z]:[\\/][^\r\n"']+/g, "[LOCAL_PATH]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
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
  writeJsonExclusive(eventPath, event);
  return { event, eventPath };
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
  if (!["main_image", "detail_page", "sku"].includes(rubric.taskFamily)) {
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

function collectJsonFiles(root) {
  if (!fs.existsSync(root)) return [];
  const pending = [root];
  const files = [];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
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
  if (!cleanString(event?.provider) || !cleanString(event?.modelId)) {
    errors.push("Attempt 缺少 Provider / Model 身份。");
  }
  if (!cleanString(event?.cohortFingerprint) || !cleanString(event?.attemptFingerprint)) {
    errors.push("Attempt 缺少 cohort / attempt 指纹。");
  }
  if (!cleanString(event?.suiteCaseSetDigest) || !cleanString(event?.suiteRubricSetDigest)) {
    errors.push("Attempt 缺少当前 Suite Case / Rubric 摘要。");
  }
  if (["terminal", "reconciled"].includes(event?.eventType) && !cleanString(event?.status)) {
    errors.push("Attempt 终态 / 对账事件缺少 status。");
  }
  return { ok: errors.length === 0, errors };
}

function collectSidecars(dataRoots) {
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
      ...(caseSpec.task.fixtureGeneratedInputs || []).map((input) => ({
        ...input,
        generatedContent: `${JSON.stringify({
          version: "design-reliability-fixture-facts/v1",
          facts: input.facts,
          boundaries: {
            factsOnly: true,
            noAssetSelection: true,
            noLayoutPreset: true,
            designerOwnsVisualDecisions: true
          }
        }, null, 2)}\n`
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
          ...(input.generatedContent !== undefined
            ? { generatedContent: String(input.generatedContent) }
            : {})
        });
        continue;
      }
      if (existing.generatedContent !== input.generatedContent) {
        throw new Error(`同一 fixture ref 同时声明为不同来源或内容：${ref}`);
      }
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
  const unexpected = actualRefs.filter((ref) => !expectedSet.has(ref));
  return {
    ready: missing.length === 0,
    freshRunReady: missing.length === 0 && unexpected.length === 0,
    expectedFileCount: expectedRefs.length,
    actualFileCount: actualRefs.length,
    missing,
    unexpected
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
  const files = [];
  const missing = [];
  for (const input of inputs) {
    const absolutePath = resolveInside(fixtureRoot, input.ref);
    if (!fs.existsSync(absolutePath)
      || fs.lstatSync(absolutePath).isSymbolicLink()
      || !fs.statSync(absolutePath).isFile()) {
      missing.push(input.ref);
      continue;
    }
    files.push({
      ref: input.ref,
      size: fs.statSync(absolutePath).size,
      digest: fileSha256(absolutePath),
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
    ready: missing.length === 0 && collected.unsafeLinks.length === 0,
    freshRunReady: missing.length === 0
      && inventory.unexpected.length === 0
      && collected.unsafeLinks.length === 0,
    fixtureDigest,
    files,
    missing,
    unexpected: inventory.unexpected,
    unsafeLinks: collected.unsafeLinks,
    actualFileCount: actualRefs.length,
    expectedFileCount: expectedRefs.length,
    boundaries: {
      reviewOnlyReferencesExcluded: true,
      absolutePathsNotPersisted: true,
      unexpectedFilesFailFreshRun: true,
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

function artifactGeometryMatchesCase(caseSpec, metadata) {
  if (!metadata || !Number.isFinite(metadata.width) || !Number.isFinite(metadata.height)) return false;
  if (metadata.width <= 0 || metadata.height <= 0) return false;
  if (caseSpec.taskFamily === "main_image") {
    return metadata.width === 800 && metadata.height === 800;
  }
  return true;
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
  if (!isRecord(source) || source.version !== "debug-sku-delivery-evidence/v1") return [];
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
      || item.sourceHistoryStateRef.historyStateId <= 0) {
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
    sourceHistoryStateRef: item.sourceHistoryStateRef
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

function recordAttribution(args) {
  const runPath = path.resolve(args.get("--run-observation"));
  const run = readJson(runPath);
  const runValidation = validateDesignReliabilityRun(run);
  if (!runValidation.ok) throw new Error(`Run observation 不合法：${runValidation.errors.join("；")}`);
  const owner = args.get("--owner", "unknown");
  const failureMode = args.get("--failure-mode", "unknown");
  const status = args.get("--status", "hypothesis");
  if (!ATTRIBUTION_OWNERS.includes(owner)) throw new Error(`owner 非法：${owner}`);
  if (!FAILURE_MODES.includes(failureMode)) throw new Error(`failure-mode 非法：${failureMode}`);
  if (!ATTRIBUTION_STATUSES.includes(status)) throw new Error(`status 非法：${status}`);
  const rationale = args.get("--rationale");
  if (!rationale) throw new Error("--rationale 不能为空。 ");
  const timestamp = new Date().toISOString();
  const attributionId = `${run.runObservationId}-${failureMode}-${timestamp.replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  const attribution = {
    version: ATTRIBUTION_VERSION,
    attributionId,
    runObservationId: run.runObservationId,
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
    ["attributions", run.runObservationId],
    attributionId
  );
  writeJsonExclusive(outputPath, attribution);
  return { attribution, outputPath };
}

function sidecarRoots(args) {
  const requested = args.getAll("--data-root").map((item) => path.resolve(item));
  // Attempt 安全账本始终由 canonical DEFAULT_DATA_ROOT 提供；--data-root 只能追加
  // 报告来源，不能把既有 armed / unknown-write / fixture 使用记录从 preflight 隐藏。
  return [...new Set([
    DEFAULT_DATA_ROOT,
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
    if (validRunIds.has(attribution.runObservationId)) return true;
    excludedEvidence.push({
      kind: "attribution",
      id: attribution.attributionId,
      reason: "bound_run_not_current"
    });
    return false;
  });
  const validAttemptEvents = retainContextuallyValidAttemptEvents(
    sidecars.attemptEvents,
    suite,
    excludedEvidence
  );
  return {
    ...sidecars,
    runs: validRuns,
    reviews: validReviews,
    attributions: validAttributions,
    attemptEvents: validAttemptEvents,
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
    && Array.isArray(review?.blockers);
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
    const decisions = [...new Set(runReviews.map((review) => review.decision))];
    verdicts.set(runObservationId, {
      reviewed: true,
      conflict: decisions.length !== 1,
      decision: decisions.length === 1 ? decisions[0] : "needs_adjudication",
      reviewCount: runReviews.length
    });
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
    attemptFingerprint: event?.attemptFingerprint
  });
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
    && dimensions.provider === event.provider
    && dimensions.requestedModelId === event.modelId
    && dimensions.gitCommit === environment.gitCommit
    && dimensions.dirty === false
    && environment.dirty === false
    && dimensions.runtimeGitCommit === environment.runtimeGitCommit
    && dimensions.runtimeBuildId === environment.runtimeBuildId
    && dimensions.runtimeAppVersion === environment.runtimeAppVersion
    && dimensions.photoshopRuntimeBuildId === environment.photoshopRuntimeBuildId
    && dimensions.timeoutMs === event.timeoutMs
    && dimensions.instructionDigest === event.instructionDigest
    && dimensions.rubricDigest === event.rubricDigest
    && dimensions.suiteCaseSetDigest === event.suiteCaseSetDigest
    && dimensions.suiteRubricSetDigest === event.suiteRubricSetDigest
    && dimensions.cohortFingerprint === event.cohortFingerprint;
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
    const identityKeys = ordered.map(buildAttemptEventIdentityKey);
    const eventTypeCounts = ordered.reduce((counts, event) => {
      counts[event.eventType] = (counts[event.eventType] || 0) + 1;
      return counts;
    }, {});
    const protocolIssues = validateAttemptEventStateMachine(attemptId, ordered);
    if (eventTypeCounts.armed !== 1) protocolIssues.push("armed_event_count_invalid");
    if ((eventTypeCounts.submission_started || 0) > 1) protocolIssues.push("submission_event_count_invalid");
    if ((terminal || reconciliation) && eventTypeCounts.submission_started !== 1) {
      protocolIssues.push("submission_event_count_invalid");
    }
    if ((eventTypeCounts.terminal || 0) > 1) protocolIssues.push("terminal_event_count_invalid");
    if ((eventTypeCounts.reconciled || 0) > 1) protocolIssues.push("reconciliation_event_count_invalid");
    if (reconciliation && !terminal) protocolIssues.push("reconciliation_without_terminal");
    if (new Set(identityKeys).size !== 1) protocolIssues.push("attempt_identity_drift");
    if (submitted && !cleanString(submitted.cohortFingerprint)) protocolIssues.push("cohort_fingerprint_missing");
    if (submitted && !cleanString(submitted.attemptFingerprint)) protocolIssues.push("attempt_fingerprint_missing");
    if (submitted && (!cleanString(submitted.suiteCaseSetDigest) || !cleanString(submitted.suiteRubricSetDigest))) {
      protocolIssues.push("suite_protocol_digest_missing");
    }
    const runObservationId = cleanString(terminal?.runObservationId) || null;
    const linkedRun = runObservationId ? runById.get(runObservationId) : undefined;
    const identityEvent = terminal || submitted || armed;
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
    const reviewVerdict = linkedRunValid
      ? strictReviewVerdicts.get(runObservationId)
      : undefined;
    summaries.push({
      attemptId,
      caseId,
      taskFamily: caseSpec?.taskFamily || "unknown",
      cohortId: terminal?.cohortId || submitted?.cohortId || armed?.cohortId || "unknown",
      cohortFingerprint: cleanString(
        terminal?.cohortFingerprint || submitted?.cohortFingerprint || armed?.cohortFingerprint
      ) || null,
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
      status: reconciliation?.status
        || terminal?.status
        || (submitted ? "submitted_without_terminal" : "armed_not_submitted"),
      runObservationId,
      linkedRunValid,
      protocolIssues,
      protocolValid: protocolIssues.length === 0,
      technicalDeliveryPassed: Boolean(
        terminalClaimsTechnicalPass
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
      linkedRunObservationIds: [],
      byTaskFamily: {},
      byCase: {}
    };
    cohort.attempts += 1;
    if (summary.armed) cohort.armed += 1;
    if (summary.submitted) cohort.submitted += 1;
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
    const family = cohort.byTaskFamily[summary.taskFamily] || {
      submitted: 0,
      terminal: 0,
      technicalDeliveryPassed: 0,
      strictReviewedTechnicalPasses: 0,
      commercialUsable: 0,
      statuses: {}
    };
    if (summary.submitted) family.submitted += 1;
    if (summary.terminal) family.terminal += 1;
    if (summary.technicalDeliveryPassed) family.technicalDeliveryPassed += 1;
    if (summary.technicalDeliveryPassed && summary.strictReviewReady) {
      family.strictReviewedTechnicalPasses += 1;
    }
    if (summary.commercialUsable) family.commercialUsable += 1;
    family.statuses[summary.status] = (family.statuses[summary.status] || 0) + 1;
    cohort.byTaskFamily[summary.taskFamily] = family;
    const caseEntry = cohort.byCase[summary.caseId] || {
      submitted: 0,
      terminal: 0,
      technicalDeliveryPassed: 0,
      strictReviewedTechnicalPasses: 0,
      commercialUsable: 0,
      statuses: {}
    };
    if (summary.submitted) caseEntry.submitted += 1;
    if (summary.terminal) caseEntry.terminal += 1;
    if (summary.technicalDeliveryPassed) caseEntry.technicalDeliveryPassed += 1;
    if (summary.technicalDeliveryPassed && summary.strictReviewReady) {
      caseEntry.strictReviewedTechnicalPasses += 1;
    }
    if (summary.commercialUsable) caseEntry.commercialUsable += 1;
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
    cohort.homogeneous = cohort.submitted > 0
      && submittedSummaries.every((summary) => Boolean(summary.cohortFingerprint))
      && new Set(submittedSummaries.map((summary) => summary.cohortFingerprint)).size === 1;
    cohort.runObservationDiagnosticCoverage = rate(linkedRunIds.size, cohort.submitted);
    cohort.unlinkedRunObservationCount = Math.max(0, cohortRunCount - linkedRunIds.size);
    const technicalPassed = submittedSummaries.filter((summary) => summary.technicalDeliveryPassed).length;
    const strictReviewedTechnicalPasses = submittedSummaries.filter((summary) => (
      summary.technicalDeliveryPassed && summary.strictReviewReady
    )).length;
    const commercialUsable = submittedSummaries.filter((summary) => summary.commercialUsable).length;
    cohort.technicalDeliveryRate = rate(technicalPassed, cohort.submitted);
    cohort.commercialUsableRate = rate(commercialUsable, cohort.submitted);
    cohort.strictReviewCoverageOfTechnicalPasses = rate(
      strictReviewedTechnicalPasses,
      technicalPassed
    );
    cohort.strictReviewConflictCount = submittedSummaries.filter((summary) => summary.strictReviewConflict).length;
    cohort.unknownWriteStateCount = submittedSummaries.filter((summary) => (
      String(summary.status || "").includes("unknown_write_state")
    )).length;
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
  );
}

function buildStatus(suite, args) {
  const evidenceRoots = resolveReliabilityEvidenceRoots(args);
  const canonicalAttemptSidecars = collectSidecars(evidenceRoots.canonicalAttemptRoots);
  const collectedSidecars = collectSidecars(evidenceRoots.reportRoots);
  const attemptSafetyLedger = buildCanonicalAttemptSafetyLedger(canonicalAttemptSidecars.attemptEvents);
  // Run / Review / Attribution 可以从附加 report root 读取，但正式 Attempt
  // 分母只能来自 run-live 的 canonical append-only 账本。否则 --data-root
  // 中伪造的 terminal 链可以绕过真实提交失败。
  const sidecars = retainContextuallyValidReviews({
    ...collectedSidecars,
    attemptEvents: canonicalAttemptSidecars.attemptEvents
  }, suite);
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
    const report = buildDesignReliabilityCohortReport({
      suiteId: suite.manifest.suiteId,
      cohortId,
      cases: suite.cases,
      rubrics: suite.rubrics,
      runs: reportRuns,
      reviews: sidecars.reviews,
      attributions: sidecars.attributions
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
    success: suite.ok && sidecars.invalid.length === 0,
    generatedAt: new Date().toISOString(),
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
      "不同 caseSetDigest、rubricSetDigest 或 fixtureDigest 的 cohort 禁止直接比较。"
    ]
  };
}

function httpProbe(url, timeoutMs = 1200, headers = {}) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: timeoutMs, headers }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        resolve({
          reachable: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          bodyPreview: body.slice(0, 240)
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
          reject(new Error(`Debug Bridge HTTP ${response.statusCode}: ${responseBody?.error || responseText.slice(0, 200)}`));
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

function normalizeOpenDocumentState(documentList) {
  const result = documentList?.ok ? documentList.result : undefined;
  const documents = Array.isArray(result?.documents) ? result.documents : undefined;
  if (!documents || result?.success === false) {
    return {
      verified: false,
      count: null,
      hasUnsavedDocument: null
    };
  }
  return {
    verified: true,
    count: documents.length,
    hasUnsavedDocument: documents.some((document) => document?.pathState === "unsaved")
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
  const projectRootResult = input.projectRootStatus?.ok ? input.projectRootStatus.result : undefined;
  const documents = normalizeOpenDocumentState(input.documentListStatus);
  const expectedProjectPath = normalizePathIdentity(input.expectedProjectPath);
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
  } else if (documents.count > 0) {
    blockers.push("photoshop_documents_open");
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
      noPendingPhotoshopRequests: pendingRequestCount === 0,
      currentProjectMatchesFixture: Boolean(
        expectedProjectPath
        && currentProjectPath === expectedProjectPath
      ),
      photoshopDocumentStateVerified: documents.verified,
      noOpenPhotoshopDocuments: documents.verified && documents.count === 0
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
      connected: connection?.connected === true,
      runtimeBuildId: cleanString(photoshopRuntime?.buildId) || null,
      runtimeLoadedAt: cleanString(photoshopRuntime?.loadedAt) || null,
      pendingRequestCount: Number.isFinite(pendingRequestCount) ? pendingRequestCount : null,
      openDocumentCount: documents.count,
      hasUnsavedDocument: documents.hasUnsavedDocument
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

async function inspectLiveEnvironment(args, fixtureRoot) {
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
  return evaluateLiveEnvironmentSafety({
    currentGitEnvironment: readGitEnvironment(),
    expectedProjectPath: fixtureRoot,
    systemStatus,
    connectionStatus,
    photoshopDiagnosisStatus,
    projectRootStatus,
    documentListStatus
  });
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
  const firstMutationBaseline = receipt.firstPhotoshopMutationBaseline;
  if (!isRecord(firstMutationBaseline)
    || firstMutationBaseline.version !== "guarded-photoshop-execution-baseline-receipt/v0"
    || !["not_reached", "passed", "blocked"].includes(firstMutationBaseline.status)
    || cleanString(firstMutationBaseline.requestId) !== cleanString(receipt.requestId)
    || cleanString(firstMutationBaseline.expectedPhotoshopRuntimeBuildId)
      !== expectedPhotoshopRuntimeBuildId) {
    errors.push("运行窗口没有返回可信的首次 Photoshop 写入隔离基线收据。");
  } else if (firstMutationBaseline.status === "blocked"
    && !cleanString(firstMutationBaseline.error)) {
    errors.push("首次 Photoshop 写入隔离基线声明 blocked 但没有失败事实。");
  } else if (firstMutationBaseline.status === "passed"
    && (firstMutationBaseline.openDocumentCount !== 0
      || cleanString(firstMutationBaseline.observedPhotoshopRuntimeBuildId)
        !== expectedPhotoshopRuntimeBuildId
      || !cleanString(firstMutationBaseline.firstMutationToolName))) {
    errors.push("首次 Photoshop 写入隔离基线收据与空文档或 Runtime Build 事实不一致。");
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

function validateMutationBaselineAgainstObservation(receipt, observation, expectedBuildId) {
  const observedMutationCalls = Number(observation?.observed?.observedMutationCalls || 0);
  if (observedMutationCalls <= 0) return { ok: true, errors: [] };
  const baseline = receipt?.firstPhotoshopMutationBaseline;
  const errors = [];
  if (!isRecord(baseline)
    || baseline.status !== "passed"
    || baseline.openDocumentCount !== 0
    || cleanString(baseline.observedPhotoshopRuntimeBuildId) !== cleanString(expectedBuildId)) {
    errors.push("RunRecord 已观察到 Photoshop 写入，但首次写入隔离基线没有通过。");
  }
  return { ok: errors.length === 0, errors };
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
  const fixtureRoot = path.resolve(args.get("--fixture-root"));
  if (!fs.existsSync(fixtureRoot) || !fs.statSync(fixtureRoot).isDirectory()) {
    throw new Error("run-live 需要有效的 --fixture-root。 ");
  }
  const fixtureBefore = inspectFixture([caseSpec], fixtureRoot);
  if (!fixtureBefore.ready) throw new Error(`fixture 缺少输入：${fixtureBefore.missing.join("、")}`);
  if (!fixtureBefore.freshRunReady) {
    throw new Error(`fixture 已包含未声明文件，不能复用为独立样本：${fixtureBefore.unexpected.join("、")}`);
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
  const timeoutMs = Math.max(
    1000,
    Math.min(Number(args.get("--timeout-ms", "300000")) || 300000, MAX_LIVE_RUN_TIMEOUT_MS)
  );
  const cohortId = args.get("--cohort", "candidate");
  const repeatIndex = Number(args.get("--repeat", "1"));
  const rubric = suite.rubrics.find((item) => item.rubricId === caseSpec.oracle.rubricId);
  const rubricDigest = buildRubricDigest(rubric);
  const instructionDigest = sha256Text(caseSpec.task.instruction);
  const runtime = preflight.infrastructure.liveEnvironment.runtime;
  const runtimeBuildId = runtime?.buildId;
  const photoshopRuntimeBuildId = preflight.infrastructure.liveEnvironment.photoshop.runtimeBuildId;
  const suiteCaseSetDigest = buildSuiteCaseSetDigest(suite);
  const suiteRubricSetDigest = buildSuiteRubricSetDigest(suite);
  const cohortFingerprint = sha256Text(stableStringify({
    suiteId: suite.manifest.suiteId,
    suiteCaseSetDigest,
    suiteRubricSetDigest,
    gitCommit: environmentAtSubmission.gitCommit,
    dirtyFingerprint: environmentAtSubmission.dirtyFingerprint,
    runtimeGitCommit: runtime?.gitCommit,
    runtimeBuildId,
    runtimeAppVersion: runtime?.appVersion,
    photoshopRuntimeBuildId,
    provider,
    modelId,
    timeoutMs
  }));
  const attemptFingerprint = sha256Text(stableStringify({
    cohortFingerprint,
    caseId: caseSpec.caseId,
    caseRevision: caseSpec.revision,
    caseDigest: caseSpec.caseDigest,
    fixtureDigest: fixtureBefore.fixtureDigest,
    fixtureInstanceId: preflight.fixture.instance.instanceId,
    instructionDigest,
    rubricDigest,
    repeatIndex
  }));
  const attemptContext = {
    attemptId: buildLiveAttemptId(caseSpec.caseId),
    caseRef: {
      caseId: caseSpec.caseId,
      revision: caseSpec.revision,
      caseDigest: caseSpec.caseDigest
    },
    cohortId,
    repeatIndex,
    provider,
    modelId,
    timeoutMs,
    fixtureRef: {
      instanceId: preflight.fixture.instance.instanceId,
      fixtureDigest: fixtureBefore.fixtureDigest,
      pathBindingDigest: preflight.fixture.instance.pathBindingDigest
    },
    environment: {
      ...environmentAtSubmission,
      runtimeGitCommit: runtime?.gitCommit,
      runtimeBuildId,
      runtimeAppVersion: runtime?.appVersion,
      photoshopRuntimeBuildId,
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
  const debugBridge = args.get("--debug-bridge", DEFAULT_DEBUG_BRIDGE);
  const debugToken = args.get("--debug-token", process.env.DESIGNECHO_DEBUG_TOKEN || "");
  if (!debugToken) {
    throw new Error("run-live 需要 --debug-token 或 DESIGNECHO_DEBUG_TOKEN；未授权的本地进程不能启动真实 Agent 写入。");
  }
  const armedAttempt = writeLiveAttemptEvent(attemptContext, 1, "armed", {
    status: "armed",
    zeroInRunHumanCorrectionPolicy: true
  });
  const submissionAttempt = writeLiveAttemptEvent(attemptContext, 2, "submission_started", {
    status: "submitted",
    endpointKind: "debug_bridge_chat_submit"
  });
  let trustedCompletionReceipt = false;
  try {
    const response = await httpPostJson(`${debugBridge}/chat/submit`, {
      text: caseSpec.task.instruction,
      timeoutMs,
      resetConversation: true,
      disableSkillBridges: false,
      expectedProjectPath: fixtureRoot,
      expectedRuntimeGitCommit: environmentAtSubmission.gitCommit,
      expectedRuntimeBuildId: runtimeBuildId,
      expectedPhotoshopRuntimeBuildId: photoshopRuntimeBuildId,
      expectedProvider: provider,
      expectedModelId: modelId,
      requireCleanRuntimeGitState: true,
      requireNoOpenPhotoshopDocuments: true
    }, timeoutMs + 5000, {
      "x-designecho-debug-token": debugToken
    });
    const receiptValidation = validateDebugBridgeReceipt(response, {
      fixtureRoot,
      provider,
      modelId,
      gitCommit: environmentAtSubmission.gitCommit,
      runtimeBuildId,
      photoshopRuntimeBuildId
    });
    if (!receiptValidation.ok) {
      throw new Error(`Debug Bridge 运行收据不可信：${receiptValidation.errors.join("；")}`);
    }
    trustedCompletionReceipt = true;
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
      // run-live 只提交一条自然请求，运行中不会注入确认或纠偏消息；waiting_user 仍按自主失败记录。
      userInterventionCount: 0,
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
        timeoutMs,
        instructionDigest,
        rubricDigest,
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
      technicalDeliveryPassed: observation.observed.technicalDeliveryPassed === true
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
    writeLiveAttemptEvent(attemptContext, 3, "terminal", {
      status: trustedCompletionReceipt
        ? classifyLiveAttemptFailure(error)
        : "submission_unknown_write_state",
      technicalDeliveryPassed: false,
      diagnostic: sanitizeAttemptDiagnostic(error instanceof Error ? error.message : String(error))
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
  const sidecars = collectSidecars([CANONICAL_ATTEMPT_EVENTS_ROOT]);
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
  const liveEnvironment = await inspectLiveEnvironment(args, fixtureRoot);
  const unresolvedEvent = terminal || submitted;
  const terminalAt = Date.parse(unresolvedEvent.occurredAt);
  const runtimeStartedAt = Date.parse(liveEnvironment.runtime?.processStartedAt || "");
  if (!liveEnvironment.ready
    || !Number.isFinite(terminalAt)
    || !Number.isFinite(runtimeStartedAt)
    || runtimeStartedAt <= terminalAt) {
    throw new Error(
      "Reconciliation 需要在该异常之后重启最新干净 Runtime，并确认原项目已绑定、Photoshop 无打开文档且无待处理请求。"
    );
  }
  const context = {
    attemptId: unresolvedEvent.attemptId,
    caseRef: unresolvedEvent.caseRef,
    cohortId: unresolvedEvent.cohortId,
    repeatIndex: unresolvedEvent.repeatIndex,
    provider: unresolvedEvent.provider,
    modelId: unresolvedEvent.modelId,
    timeoutMs: unresolvedEvent.timeoutMs,
    fixtureRef: unresolvedEvent.fixtureRef,
    environment: unresolvedEvent.environment,
    instructionDigest: unresolvedEvent.instructionDigest,
    rubricDigest: unresolvedEvent.rubricDigest,
    suiteCaseSetDigest: unresolvedEvent.suiteCaseSetDigest,
    suiteRubricSetDigest: unresolvedEvent.suiteRubricSetDigest,
    cohortFingerprint: unresolvedEvent.cohortFingerprint,
    attemptFingerprint: unresolvedEvent.attemptFingerprint
  };
  if (!terminal) {
    writeLiveAttemptEvent(context, 3, "terminal", {
      status: "submission_unknown_write_state",
      technicalDeliveryPassed: false,
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
      noPendingPhotoshopRequests: true,
      noOpenPhotoshopDocuments: true,
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
  if (fixtureRoot) {
    const absoluteFixtureRoot = path.resolve(fixtureRoot);
    if (fs.existsSync(absoluteFixtureRoot) && fs.statSync(absoluteFixtureRoot).isDirectory()) {
      let selectedCases;
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
  const [debugBridge, debugWriteAuthorization, photoshopMcp] = await Promise.all([
    httpProbe(`${args.get("--debug-bridge", DEFAULT_DEBUG_BRIDGE)}/health`),
    debugToken
      ? httpProbe(
        `${args.get("--debug-bridge", DEFAULT_DEBUG_BRIDGE)}/chat/submit/preflight`,
        1200,
        { "x-designecho-debug-token": debugToken }
      )
      : Promise.resolve({ reachable: false, reason: "debug_write_token_missing" }),
    httpProbe(args.get("--photoshop-health", DEFAULT_PHOTOSHOP_MCP_HEALTH))
  ]);
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
  const status = buildStatus(suite, args);
  const fixtureInstanceAlreadyUsed = Boolean(
    fixture.instance?.instanceId
    && status.evidence.attemptSafetyLedger.usedFixtureInstanceIds.includes(fixture.instance.instanceId)
  );
  const unreconciledLiveAttempt = status.evidence.attemptSafetyLedger.unresolvedAttemptCount > 0;
  const invalidAttemptSidecar = status.evidence.canonicalAttemptInvalidSidecars.some((item) => (
    item?.kind === "attempt_event"
  ));
  const activeFamilies = new Set(suite.cases.filter((item) => item.status === "active").map((item) => item.taskFamily));
  const caseCoverageReady = ["main_image", "detail_page", "sku"].every((family) => activeFamilies.has(family));
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
    ...(fixture.freshRunReady ? [] : ["disposable_fixture_contains_unexpected_files"]),
    ...(fixture.instanceReady ? [] : ["disposable_fixture_instance_unverified"]),
    ...(fixtureInstanceAlreadyUsed ? ["disposable_fixture_instance_already_used"] : []),
    ...(debugBridge.reachable ? [] : ["debug_bridge_unreachable"]),
    ...(debugWriteTokenSupplied ? [] : ["debug_write_token_missing"]),
    ...(debugWriteAuthorization.reachable ? [] : ["debug_write_authorization_failed"]),
    ...(photoshopMcp.reachable ? [] : ["photoshop_mcp_unreachable"]),
    ...liveEnvironment.blockers,
    ...(invalidAttemptSidecar ? ["attempt_safety_ledger_invalid"] : []),
    ...(unreconciledLiveAttempt ? ["unreconciled_live_attempt_exists"] : [])
  ];
  const readyForLiveCapture = captureBlockers.length === 0;
  const releaseBlockers = liveEvidencePassed
    ? []
    : ["three_skill_live_quality_evidence_incomplete"];
  return {
    success: true,
    generatedAt: new Date().toISOString(),
    mode: "read_only_design_reliability_preflight",
    caseCoverageReady,
    fixture,
    infrastructure: {
      debugBridge,
      debugWriteTokenSupplied,
      debugWriteAuthorization,
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
      "readyForLiveCapture 只在 Runtime 提交版本、当前项目、Photoshop 空文档基线与请求队列均可信时表示可以开始采集，不表示三类 Skill 已通过。",
      "liveEvidencePassed 逐项消费 suites.manifest.json 的发布门禁；样本、人工评审或证据不足均不能通过。"
    ]
  };
}

function printStatus(status) {
  console.log("DesignEcho Design Reliability");
  console.log(`Suite: ${status.suite.suiteId}`);
  console.log(`固定 Case: ${status.suite.activeCases.length}`);
  for (const item of status.suite.activeCases) {
    console.log(`  - ${item.taskFamily}: ${item.caseId} · ${item.instruction}`);
  }
  console.log(`Run Observation: ${status.evidence.runObservations}`);
  console.log(`Attempt Submission: ${status.evidence.attemptCoverage.submittedAttempts}`);
  console.log(`Attempt Terminal: ${status.evidence.attemptCoverage.terminalAttempts}`);
  console.log(`Attempt 未闭合: ${status.evidence.attemptCoverage.attemptsWithoutTerminal}`);
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
    "  preflight [--case id|--fixture-id id] [--fixture-root dir] [--require-live]",
    "      只读检查 fixture、Debug Bridge、Photoshop MCP 与已有实机证据。",
    "  prepare-fixture --case id|--fixture-id id --source-root dir --destination dir --allow-create",
    "      只复制 Agent 可见输入到一次性目录；用户成稿/Eagle 参考不会复制。",
    "  run-live --case id --fixture-root dir --provider id --model id --live --allow-photoshop-write",
    "      --debug-token token（或 DESIGNECHO_DEBUG_TOKEN）",
    "      通过当前 DesignEcho 窗口提交自然请求；提交前强制当前项目与 fixture 精确匹配。",
    "  reconcile-live-attempt --attempt-id id --fixture-root dir",
    "      超时或断连后，只在 Runtime 已重启、无打开文档/待处理请求且仍绑定原 fixture 时追加对账收据。",
    "  record-run --case id --run-record file [--run-record file...] --fixture-root dir",
    "      --cohort id --provider id --model id --repeat N --user-interventions N",
    "      --evidence editable_psd=relative/path --evidence raster_export=relative/path",
    "      --final-artifact relative/path（可重复；必须来自 Agent delivery receipt，不得把全部导出猜成最终稿）",
    "  record-review --run-observation file --reviewer alias --decision pass|needs_fix|unscorable",
    "      --scores dimension=0.8,... [--pairwise comparable|better|weaker]",
    "      --blinded-to-candidate-origin --comparison-evidence-ref candidate_final=candidate:relative/path@sha256:<64位摘要>",
    "      --comparison-evidence-ref user_design_anchor=user-design:<Case中的相对路径>",
    "      --comparison-evidence-ref eagle_anchor=eagle:item:<Case中的条目ID> [--blocker text]",
    "      当前 record-review 只生成 bound_self_reported 诊断评审；匿名评审包落地前不计入正式成功率。",
    "  record-attribution --run-observation file --owner owner --failure-mode mode",
    "      --status hypothesis|confirmed|rejected --rationale text --evidence-ref token",
    "",
    "所有生成 sidecar 默认写入 tmp/design-reliability，append-only，不反写 Runtime 或 Case。"
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
    const status = buildStatus(suite, args);
    if (args.hasFlag("--json")) console.log(JSON.stringify(status, null, 2));
    else printStatus(status);
    return;
  }
  if (args.command === "preflight") {
    const report = await buildPreflight(suite, args);
    const reportPath = path.join(DEFAULT_DATA_ROOT, "preflight", "latest.json");
    writeJsonReplace(reportPath, report);
    console.log(JSON.stringify({ ...report, reportPath }, null, 2));
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
  if (args.command === "record-attribution") {
    const result = recordAttribution(args);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  throw new Error(`未知命令：${args.command}`);
}

module.exports = {
  buildAttemptEventIdentityKey,
  buildCanonicalAttemptSafetyLedger,
  buildSuiteCaseSetDigest,
  buildSuiteRubricSetDigest,
  buildPreflight,
  buildLiveAttemptCoverage,
  buildStatus,
  buildSkuLiveDeliveryEvidence,
  collectSidecars,
  evaluateLiveEnvironmentSafety,
  evaluateFixtureInventory,
  inspectFixture,
  inspectEditablePsd,
  isOfficialAttemptCohortReady,
  loadSuite,
  parseArgs,
  prepareFixture,
  readFixtureInstance,
  recordAttribution,
  recordReview,
  recordRun,
  reconcileLiveAttempt,
  resolveReliabilityEvidenceRoots,
  resolveSidecarOutputPath,
  retainContextuallyValidAttemptEvents,
  retainContextuallyValidReviews,
  runObservationMatchesAttempt,
  sidecarRoots,
  validateAttemptEventStateMachine,
  validateDebugBridgeReceipt,
  validateRubric,
  validateMutationBaselineAgainstObservation,
  runLiveCase
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}
