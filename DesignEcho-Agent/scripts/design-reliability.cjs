#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawnSync } = require("child_process");

const {
  ATTRIBUTION_OWNERS,
  ATTRIBUTION_STATUSES,
  ATTRIBUTION_VERSION,
  COMPARISON_EVIDENCE_KINDS,
  FAILURE_MODES,
  PAIRWISE_OUTCOMES,
  REVIEW_DECISIONS,
  REVIEW_VERSION,
  RUN_VERSION,
  buildDesignReliabilityCohortReport,
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
const DEFAULT_DEBUG_BRIDGE = "http://127.0.0.1:8767";
const DEFAULT_PHOTOSHOP_MCP_HEALTH = "http://127.0.0.1:8768/health";
const MAX_LIVE_RUN_TIMEOUT_MS = 30 * 60 * 1000;

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function normalizePathIdentity(value) {
  const raw = cleanString(value);
  if (!raw) return "";
  const normalized = path.resolve(raw)
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
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
    }
    if (Math.abs(weightTotal - 1) > 0.000001) {
      errors.push(`Rubric 权重之和必须为 1，当前为 ${weightTotal}。`);
    }
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
    if (!rubricIds.includes(caseSpec.oracle?.rubricId)) {
      errors.push(`${caseSpec.caseId}: 找不到 rubric ${caseSpec.oracle?.rubricId || "unknown"}。`);
    }
  }
  return { manifest, cases, rubrics, errors, ok: errors.length === 0 };
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

function collectSidecars(dataRoots) {
  const runs = [];
  const reviews = [];
  const attributions = [];
  const invalid = [];
  const seenIds = new Set();
  for (const root of dataRoots) {
    for (const filePath of collectJsonFiles(root)) {
      let payload;
      try {
        payload = readJson(filePath);
      } catch (error) {
        invalid.push({ file: filePath, errors: [error.message] });
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
      } else if (payload?.version === ATTRIBUTION_VERSION) {
        validation = validateDesignReliabilityAttribution(payload);
        identity = payload.attributionId;
        if (validation.ok) attributions.push(payload);
      } else {
        continue;
      }
      if (!validation.ok) invalid.push({ file: filePath, errors: validation.errors });
      if (cleanString(identity)) {
        if (seenIds.has(identity)) invalid.push({ file: filePath, errors: [`重复 sidecar id：${identity}`] });
        seenIds.add(identity);
      }
    }
  }
  return { runs, reviews, attributions, invalid };
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
    for (const input of caseSpec.task.agentVisibleInputs) {
      const ref = normalizeRelativePath(input.ref);
      const existing = byRef.get(ref);
      if (!existing) {
        byRef.set(ref, { ref, roles: [input.role], caseIds: [caseSpec.caseId] });
        continue;
      }
      if (!existing.roles.includes(input.role)) existing.roles.push(input.role);
      if (!existing.caseIds.includes(caseSpec.caseId)) existing.caseIds.push(caseSpec.caseId);
    }
  }
  return [...byRef.values()].sort((left, right) => left.ref.localeCompare(right.ref));
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
  const files = [];
  const missing = [];
  for (const input of inputs) {
    const absolutePath = resolveInside(fixtureRoot, input.ref);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
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
    ready: missing.length === 0,
    fixtureDigest,
    files,
    missing,
    boundaries: {
      reviewOnlyReferencesExcluded: true,
      absolutePathsNotPersisted: true
    }
  };
}

function prepareFixture(suite, args) {
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
  if (fs.existsSync(destination)) {
    const existing = fs.readdirSync(destination);
    if (existing.length > 0) throw new Error(`destination 已存在且非空，拒绝覆盖：${destination}`);
  } else {
    fs.mkdirSync(destination, { recursive: true });
  }
  const selectedCases = selectFixtureCases(suite, args);
  const inputs = fixtureInputs(selectedCases);
  const missing = [];
  const copied = [];
  for (const input of inputs) {
    const sourcePath = resolveInside(sourceRoot, input.ref);
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      missing.push(input.ref);
      continue;
    }
    const destinationPath = resolveInside(destination, input.ref);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
    copied.push(input.ref);
  }
  if (missing.length > 0) {
    throw new Error(`源 fixture 缺少 ${missing.length} 个文件：${missing.join("、")}`);
  }
  const inspection = inspectFixture(selectedCases, destination);
  const compactTime = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const instanceId = `fixture-${compactTime}-${crypto.randomBytes(6).toString("hex")}`;
  const report = {
    version: "design-reliability-fixture/v1",
    instanceId,
    fixtureId: selectedCases[0]?.task?.fixtureId || "unknown",
    suiteId: suite.manifest.suiteId,
    caseIds: selectedCases.map((item) => item.caseId).sort(),
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
  const reportPath = path.join(DEFAULT_DATA_ROOT, "fixtures", `${report.fixtureId}-${instanceId}.json`);
  writeJsonExclusive(reportPath, report);
  return { report, reportPath, destination };
}

function readFixtureInstance(fixtureRoot, selectedCases, inspection) {
  const reportsRoot = path.join(DEFAULT_DATA_ROOT, "fixtures");
  if (!fs.existsSync(reportsRoot)) return undefined;
  const expectedCaseIds = selectedCases.map((item) => item.caseId).sort();
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
        !== stableStringify(expectedCaseIds)) {
      continue;
    }
    const expectedPathBinding = sha256Text(
      `${report.instanceId}|${normalizePathIdentity(fixtureRoot)}`
    );
    if (report.pathBindingDigest !== expectedPathBinding) continue;
    return {
      instanceId: report.instanceId,
      fixtureDigest: report.fixtureDigest,
      pathBindingDigest: report.pathBindingDigest,
      preparedAt: report.preparedAt
    };
  }
  return undefined;
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

function outputEvidenceFromChanges(
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
    evidenceRefs.push({
      kind,
      ref,
      digest: fileSha256(absolutePath),
      size: fs.statSync(absolutePath).size,
      verified: true
    });
  }
  if (caseSpec.taskFamily === "sku") {
    const rasterRefs = evidenceRefs.filter((item) => item.kind === "raster_export").map((item) => item.ref).sort();
    const expectedCount = Number(caseSpec.oracle?.outputInventory?.exactRasterExports);
    evidenceRefs.push({
      kind: "sku_output_inventory",
      ref: "receipt:sku-output-inventory",
      digest: sha256Text(stableStringify(rasterRefs)),
      count: rasterRefs.length,
      expectedCount: Number.isInteger(expectedCount) ? expectedCount : undefined,
      verified: Number.isInteger(expectedCount) ? rasterRefs.length === expectedCount : rasterRefs.length > 0
    });
  }
  return evidenceRefs;
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
    evidenceRefs: parseEvidenceArgs(args, fixtureRoot)
  });
  const validation = validateDesignReliabilityRun(observation);
  if (!validation.ok) throw new Error(validation.errors.join("；"));
  const outputPath = path.join(
    DEFAULT_DATA_ROOT,
    "runs",
    observation.cohortId,
    `${observation.runObservationId}.json`
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
    reviewerId,
    reviewedAt: timestamp,
    blindedToCohort: !args.hasFlag("--not-blinded"),
    blindedToCandidateOrigin: args.hasFlag("--blinded-to-candidate-origin"),
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
  const outputPath = path.join(DEFAULT_DATA_ROOT, "reviews", run.runObservationId, `${reviewId}.json`);
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
  const outputPath = path.join(DEFAULT_DATA_ROOT, "attributions", run.runObservationId, `${attributionId}.json`);
  writeJsonExclusive(outputPath, attribution);
  return { attribution, outputPath };
}

function sidecarRoots(args) {
  const requested = args.getAll("--data-root").map((item) => path.resolve(item));
  if (requested.length > 0) return requested;
  return [DEFAULT_DATA_ROOT, path.join(BENCHMARK_ROOT, "curated")];
}

function retainContextuallyValidReviews(sidecars, suite) {
  const runById = new Map(sidecars.runs.map((run) => [run.runObservationId, run]));
  const validReviews = [];
  for (const review of sidecars.reviews) {
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
  return { ...sidecars, reviews: validReviews };
}

function buildStatus(suite, args) {
  const sidecars = retainContextuallyValidReviews(
    collectSidecars(sidecarRoots(args)),
    suite
  );
  const cohortIds = [...new Set(sidecars.runs.map((run) => run.cohortId))].sort();
  const requestedCohort = args.get("--cohort");
  const reports = {};
  for (const cohortId of cohortIds) {
    if (requestedCohort && cohortId !== requestedCohort) continue;
    reports[cohortId] = buildDesignReliabilityCohortReport({
      suiteId: suite.manifest.suiteId,
      cohortId,
      cases: suite.cases,
      runs: sidecars.runs,
      reviews: sidecars.reviews,
      attributions: sidecars.attributions
    });
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
      invalidSidecars: sidecars.invalid
    },
    reports,
    releaseGateEvaluations,
    officialRateAvailable: Object.values(releaseGateEvaluations).some((evaluation) => (
      evaluation.sampleReady === true
    )),
    boundaries: [
      "未绑定固定 Case 的历史运行不进入正式成功率分母。",
      "没有人工评审时只能报告技术可靠性，不能宣称设计质量达标。",
      "不同 caseSetDigest 的 cohort 禁止直接比较。"
    ]
  };
}

function httpProbe(url, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
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

function httpPostJson(url, payload, timeoutMs) {
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
        "content-length": Buffer.byteLength(body)
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
    || !submittedModelMatches
    || !completedModelMatches) {
    errors.push(`运行窗口返回的模型身份与请求记录不一致（期望 ${input.modelId}，实际 ${submittedModelId || "unknown"}${submittedApiModelId ? ` / ${submittedApiModelId}` : ""}）。`);
  }
  if (provider !== input.provider) errors.push("运行窗口返回的 Provider 与请求记录不一致。");
  if (!cleanString(receipt.conversationId)) errors.push("运行窗口没有返回对话身份。");
  return { ok: errors.length === 0, errors, receipt };
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
  const beforeRunFiles = new Set(collectRunRecordFiles(fixtureRoot));
  const beforeProjectFiles = snapshotProjectFiles(fixtureRoot);
  const timeoutMs = Math.max(
    1000,
    Math.min(Number(args.get("--timeout-ms", "300000")) || 300000, MAX_LIVE_RUN_TIMEOUT_MS)
  );
  const debugBridge = args.get("--debug-bridge", DEFAULT_DEBUG_BRIDGE);
  const response = await httpPostJson(`${debugBridge}/chat/submit`, {
    text: caseSpec.task.instruction,
    timeoutMs,
    resetConversation: true,
    disableSkillBridges: false,
    expectedProjectPath: fixtureRoot
  }, timeoutMs + 5000);
  const receiptValidation = validateDebugBridgeReceipt(response, {
    fixtureRoot,
    provider,
    modelId
  });
  if (!receiptValidation.ok) {
    throw new Error(`Debug Bridge 运行收据不可信：${receiptValidation.errors.join("；")}`);
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
  const evidenceRefs = outputEvidenceFromChanges(
    caseSpec,
    fixtureRoot,
    changedRefs,
    {
      fixtureInstance,
      fixtureInstanceVerified: true,
      modelIdentityDigest,
      modelIdentityVerified: true,
      projectBindingDigest,
      projectBindingVerified: receiptValidation.ok && sourceInputIntact
    },
    fixtureBefore,
    fixtureAfter
  );
  const observation = deriveDesignReliabilityRunObservation({
    caseSpec,
    runRecords,
    expectedProjectPath: fixtureRoot,
    cohortId: args.get("--cohort", "candidate"),
    repeatIndex: Number(args.get("--repeat", "1")),
    userInterventionCount: Number(args.get("--user-interventions", "0")),
    fixtureDigest: fixtureBefore.fixtureDigest,
    environment: {
      ...environmentAtSubmission,
      provider: runModelIdentity.identity.provider,
      modelId: runModelIdentity.identity.modelId
    },
    evidenceRefs
  });
  const validation = validateDesignReliabilityRun(observation);
  if (!validation.ok) throw new Error(validation.errors.join("；"));
  const outputPath = path.join(DEFAULT_DATA_ROOT, "runs", observation.cohortId, `${observation.runObservationId}.json`);
  writeJsonExclusive(outputPath, observation);
  const attemptReport = {
    version: "design-reliability-live-attempt/v1",
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
  const attemptPath = path.join(DEFAULT_DATA_ROOT, "attempts", `${observation.runObservationId}.json`);
  writeJsonExclusive(attemptPath, attemptReport);
  return { observation, outputPath, attemptReport, attemptPath };
}

async function buildPreflight(suite, args) {
  const fixtureRoot = args.get("--fixture-root");
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
  const [debugBridge, photoshopMcp] = await Promise.all([
    httpProbe(`${args.get("--debug-bridge", DEFAULT_DEBUG_BRIDGE)}/health`),
    httpProbe(args.get("--photoshop-health", DEFAULT_PHOTOSHOP_MCP_HEALTH))
  ]);
  const status = buildStatus(suite, args);
  const activeFamilies = new Set(suite.cases.filter((item) => item.status === "active").map((item) => item.taskFamily));
  const caseCoverageReady = ["main_image", "detail_page", "sku"].every((family) => activeFamilies.has(family));
  const readyForLiveCapture = suite.ok
    && caseCoverageReady
    && fixture.ready === true
    && fixture.instanceReady === true
    && debugBridge.reachable === true
    && photoshopMcp.reachable === true;
  const liveEvidencePassed = Object.values(status.releaseGateEvaluations).some((evaluation) => (
    evaluation.passed === true
  ));
  return {
    success: true,
    generatedAt: new Date().toISOString(),
    mode: "read_only_design_reliability_preflight",
    caseCoverageReady,
    fixture,
    infrastructure: {
      debugBridge,
      photoshopMcp,
      expectedProjectBindingEnforcedAtSubmission: true
    },
    readyForLiveCapture,
    liveEvidencePassed,
    releaseGateEvaluations: status.releaseGateEvaluations,
    blockers: [
      ...(caseCoverageReady ? [] : ["fixed_case_coverage_missing"]),
      ...(fixture.ready ? [] : ["disposable_fixture_not_ready"]),
      ...(fixture.instanceReady ? [] : ["disposable_fixture_instance_unverified"]),
      ...(debugBridge.reachable ? [] : ["debug_bridge_unreachable"]),
      ...(photoshopMcp.reachable ? [] : ["photoshop_mcp_unreachable"]),
      ...(liveEvidencePassed ? [] : ["three_skill_live_quality_evidence_incomplete"])
    ],
    boundaries: [
      "此命令只读，不调用模型或 Photoshop 写工具。",
      "readyForLiveCapture 只表示可以开始采集，不表示三类 Skill 已通过。",
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
  console.log(`Human Review: ${status.evidence.humanReviews}`);
  console.log(`Attribution: ${status.evidence.attributions}`);
  console.log(`正式成功率可用: ${status.officialRateAvailable ? "是" : "否（尚未形成完整固定 cohort + 人工评审）"}`);
  for (const [cohortId, report] of Object.entries(status.reports)) {
    console.log(`\nCohort ${cohortId}`);
    console.log(`  Case 覆盖: ${report.coverage.coveredCases}/${report.coverage.eligibleCases}`);
    console.log(`  技术交付: ${formatRate(report.overall.reliability.technicalDeliveryRate)}`);
    console.log(`  真实写入: ${formatRate(report.overall.reliability.observedMutationRate)}`);
    console.log(`  写后看图: ${formatRate(report.overall.reliability.postWriteVisualReadbackRate)}`);
    console.log(`  假完成: ${formatRate(report.overall.reliability.falseCompletionRate)}`);
    console.log(`  Agentic 决策归属证据: ${formatRate(report.overall.reliability.agenticDecisionPreservationEvidenceCoverage)}`);
    console.log(`  Agentic 模型主导（一级）: ${formatRate(report.overall.reliability.agenticLevelOneDecisionPreservationRate)}`);
    console.log(`  Agentic Harness 写入尝试: ${report.overall.reliability.agenticHarnessWriteAttemptRunCount}`);
    console.log(`  人工可用: ${formatRate(report.overall.quality.humanPassRate)}`);
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
    "      通过当前 DesignEcho 窗口提交自然请求；提交前强制当前项目与 fixture 精确匹配。",
    "  record-run --case id --run-record file [--run-record file...] --fixture-root dir",
    "      --cohort id --provider id --model id --repeat N --user-interventions N",
    "      --evidence editable_psd=relative/path --evidence raster_export=relative/path",
    "  record-review --run-observation file --reviewer alias --decision pass|needs_fix|unscorable",
    "      --scores dimension=0.8,... [--pairwise comparable|better|weaker]",
    "      --blinded-to-candidate-origin --comparison-evidence-ref candidate_final=candidate:relative/path",
    "      --comparison-evidence-ref user_design_anchor=anchor:user-design:token",
    "      --comparison-evidence-ref eagle_anchor=eagle:item-id [--blocker text]",
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
  buildPreflight,
  buildStatus,
  collectSidecars,
  inspectFixture,
  loadSuite,
  parseArgs,
  prepareFixture,
  recordAttribution,
  recordReview,
  recordRun,
  runLiveCase
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}
