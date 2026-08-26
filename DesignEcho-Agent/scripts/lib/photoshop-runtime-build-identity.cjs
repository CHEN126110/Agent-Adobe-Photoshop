"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PHOTOSHOP_RUNTIME_VERSION = "designecho-uxp-runtime-build/v1";
const PHOTOSHOP_RUNTIME_MANIFEST_VERSION = "designecho-uxp-runtime-build-manifest/v1";
const VERIFICATION_VERSION = "designecho-photoshop-runtime-build-verification/v1";
const DEBUG_BRIDGE_BINDING_VERSION = "debug-bridge-photoshop-runtime-binding/v1";
const MANIFEST_KEYS = [
  "buildId",
  "buildMode",
  "builtAt",
  "dirtyScope",
  "gitCommit",
  "gitDirty",
  "manifestDigest",
  "runtimeFile",
  "sourceDigest",
  "version"
];
const RUNTIME_FILE_KEYS = ["digest", "ref", "size"];
const LIVE_RUNTIME_KEYS = [
  "buildId",
  "buildMode",
  "builtAt",
  "dirtyScope",
  "features",
  "gitCommit",
  "gitDirty",
  "loadedAt",
  "sourceDigest",
  "version"
];
const LIVE_MANIFEST_FIELDS = [
  "buildId",
  "builtAt",
  "buildMode",
  "gitCommit",
  "gitDirty",
  "dirtyScope",
  "sourceDigest"
];
const CHECKOUT_FIELDS = ["gitCommit", "gitDirty", "dirtyScope", "sourceDigest"];

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(value[key])}`
  )).join(",")}}`;
}

function sha256Buffer(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return `sha256:${crypto.createHash("sha256").update(buffer).digest("hex")}`;
}

function isExactObject(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return actualKeys.length === sortedExpectedKeys.length
    && actualKeys.every((key, index) => key === sortedExpectedKeys[index]);
}

function isCanonicalIsoTimestamp(value) {
  if (typeof value !== "string" || !value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isSha256Digest(value) {
  return /^sha256:[0-9a-f]{64}$/.test(String(value || ""));
}

function isGitCommit(value) {
  return /^[0-9a-f]{40}$/.test(String(value || ""));
}

function createIssue(code, message, detail = {}) {
  return { code, message, ...detail };
}

function collectSourceFiles(sourceRoot) {
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw new Error(`UXP 源目录不存在：${sourceRoot}`);
  }
  const pending = [sourceRoot];
  const files = [];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      files.push({
        absolutePath,
        relativePath: path.relative(sourceRoot, absolutePath).replace(/\\/g, "/")
      });
    }
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function calculatePhotoshopSourceDigest(sourceRoot) {
  const files = collectSourceFiles(path.resolve(sourceRoot));
  if (files.length === 0) throw new Error("UXP 源目录为空，无法核对构建源摘要。");
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    const content = fs.readFileSync(file.absolutePath);
    hash.update(Buffer.from(`${file.relativePath}\0${content.length}\0`, "utf8"));
    hash.update(content);
    hash.update(Buffer.from("\0", "utf8"));
  }
  return `sha256:${hash.digest("hex")}`;
}

function deriveBuildId(identity) {
  const dirtySuffix = identity.gitDirty ? "-dirty" : "";
  return [
    "designecho-uxp",
    identity.buildMode,
    identity.gitCommit.slice(0, 12),
    identity.sourceDigest.slice("sha256:".length, "sha256:".length + 12)
  ].join("-") + dirtySuffix;
}

function validateManifestSchema(manifest) {
  const issues = [];
  if (!isExactObject(manifest, MANIFEST_KEYS)) {
    issues.push(createIssue(
      "manifest_schema_mismatch",
      "Photoshop Runtime 构建清单字段与 v1 schema 不一致。"
    ));
    return issues;
  }
  if (manifest.version !== PHOTOSHOP_RUNTIME_MANIFEST_VERSION) {
    issues.push(createIssue("manifest_version_mismatch", "Photoshop Runtime 构建清单版本不受支持。"));
  }
  if (typeof manifest.buildId !== "string" || !manifest.buildId) {
    issues.push(createIssue("manifest_build_id_invalid", "Photoshop Runtime buildId 无效。"));
  }
  if (!isCanonicalIsoTimestamp(manifest.builtAt)) {
    issues.push(createIssue("manifest_built_at_invalid", "Photoshop Runtime builtAt 不是规范 ISO 时间。"));
  }
  if (manifest.buildMode !== "development" && manifest.buildMode !== "production") {
    issues.push(createIssue("manifest_build_mode_invalid", "Photoshop Runtime buildMode 无效。"));
  }
  if (!isGitCommit(manifest.gitCommit)) {
    issues.push(createIssue("manifest_git_commit_invalid", "Photoshop Runtime gitCommit 无效。"));
  }
  if (typeof manifest.gitDirty !== "boolean") {
    issues.push(createIssue("manifest_git_dirty_invalid", "Photoshop Runtime gitDirty 必须是布尔值。"));
  }
  if (typeof manifest.dirtyScope !== "string" || !manifest.dirtyScope.trim()) {
    issues.push(createIssue("manifest_dirty_scope_invalid", "Photoshop Runtime dirtyScope 无效。"));
  }
  if (!isSha256Digest(manifest.sourceDigest)) {
    issues.push(createIssue("manifest_source_digest_invalid", "Photoshop Runtime sourceDigest 无效。"));
  }
  if (!isSha256Digest(manifest.manifestDigest)) {
    issues.push(createIssue("manifest_digest_invalid", "Photoshop Runtime manifestDigest 无效。"));
  }
  if (!isExactObject(manifest.runtimeFile, RUNTIME_FILE_KEYS)) {
    issues.push(createIssue("runtime_file_schema_mismatch", "Photoshop Runtime 文件清单字段无效。"));
  } else {
    if (manifest.runtimeFile.ref !== "runtime.js") {
      issues.push(createIssue("runtime_file_ref_invalid", "Photoshop Runtime 清单只能绑定 dist/runtime.js。"));
    }
    if (!Number.isSafeInteger(manifest.runtimeFile.size) || manifest.runtimeFile.size <= 0) {
      issues.push(createIssue("runtime_file_size_invalid", "Photoshop Runtime 文件大小无效。"));
    }
    if (!isSha256Digest(manifest.runtimeFile.digest)) {
      issues.push(createIssue("runtime_file_digest_invalid", "Photoshop Runtime 文件摘要无效。"));
    }
  }
  if (issues.length === 0 && manifest.buildId !== deriveBuildId(manifest)) {
    issues.push(createIssue(
      "manifest_build_id_derivation_mismatch",
      "Photoshop Runtime buildId 与 commit、源摘要、模式或 dirty 状态不一致。"
    ));
  }
  return issues;
}

function validateLiveRuntimeSchema(runtime) {
  const issues = [];
  if (!isExactObject(runtime, LIVE_RUNTIME_KEYS)) {
    issues.push(createIssue(
      "live_runtime_schema_mismatch",
      "diagnoseState 返回的 Photoshop Runtime 身份字段与 v1 schema 不一致。"
    ));
    return issues;
  }
  if (runtime.version !== PHOTOSHOP_RUNTIME_VERSION) {
    issues.push(createIssue("live_runtime_version_mismatch", "diagnoseState Runtime 版本不受支持。"));
  }
  if (typeof runtime.buildId !== "string" || !runtime.buildId) {
    issues.push(createIssue("live_runtime_build_id_invalid", "diagnoseState Runtime buildId 无效。"));
  }
  if (!isCanonicalIsoTimestamp(runtime.builtAt) || !isCanonicalIsoTimestamp(runtime.loadedAt)) {
    issues.push(createIssue("live_runtime_timestamp_invalid", "diagnoseState Runtime 时间字段无效。"));
  }
  if (runtime.buildMode !== "development" && runtime.buildMode !== "production") {
    issues.push(createIssue("live_runtime_build_mode_invalid", "diagnoseState Runtime buildMode 无效。"));
  }
  if (!isGitCommit(runtime.gitCommit)) {
    issues.push(createIssue("live_runtime_git_commit_invalid", "diagnoseState Runtime gitCommit 无效。"));
  }
  if (typeof runtime.gitDirty !== "boolean") {
    issues.push(createIssue("live_runtime_git_dirty_invalid", "diagnoseState Runtime gitDirty 必须是布尔值。"));
  }
  if (typeof runtime.dirtyScope !== "string" || !runtime.dirtyScope.trim()) {
    issues.push(createIssue("live_runtime_dirty_scope_invalid", "diagnoseState Runtime dirtyScope 无效。"));
  }
  if (!isSha256Digest(runtime.sourceDigest)) {
    issues.push(createIssue("live_runtime_source_digest_invalid", "diagnoseState Runtime sourceDigest 无效。"));
  }
  if (!Array.isArray(runtime.features)
    || runtime.features.some((feature) => typeof feature !== "string" || !feature.trim())) {
    issues.push(createIssue("live_runtime_features_invalid", "diagnoseState Runtime features 无效。"));
  }
  if (issues.length === 0 && runtime.buildId !== deriveBuildId(runtime)) {
    issues.push(createIssue(
      "live_runtime_build_id_derivation_mismatch",
      "diagnoseState Runtime buildId 与其完整身份字段不一致。"
    ));
  }
  return issues;
}

function resolveDefaultPaths(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, "..", "..", ".."));
  const uxpRoot = path.resolve(options.uxpRoot || path.join(repoRoot, "DesignEcho-UXP"));
  const distRoot = path.join(uxpRoot, "dist");
  return {
    repoRoot,
    uxpRoot,
    sourceRoot: path.join(uxpRoot, "src"),
    manifestPath: path.join(distRoot, "runtime-build-manifest.json"),
    runtimePath: path.join(distRoot, "runtime.js")
  };
}

function readPhotoshopRuntimeBuildArtifacts(options = {}) {
  const paths = resolveDefaultPaths(options);
  const issues = [];
  let manifest = null;
  let runtimeBuffer = null;

  if (!fs.existsSync(paths.manifestPath) || !fs.statSync(paths.manifestPath).isFile()) {
    issues.push(createIssue("manifest_missing", "未找到 Photoshop Runtime 构建清单。"));
  } else {
    try {
      manifest = JSON.parse(fs.readFileSync(paths.manifestPath, "utf8"));
    } catch (error) {
      issues.push(createIssue(
        "manifest_parse_failed",
        `Photoshop Runtime 构建清单无法解析：${error instanceof Error ? error.message : String(error)}`
      ));
    }
  }
  if (!fs.existsSync(paths.runtimePath) || !fs.statSync(paths.runtimePath).isFile()) {
    issues.push(createIssue("runtime_file_missing", "未找到 Photoshop Runtime 构建文件。"));
  } else {
    runtimeBuffer = fs.readFileSync(paths.runtimePath);
  }

  const schemaIssues = manifest ? validateManifestSchema(manifest) : [];
  issues.push(...schemaIssues);
  const schemaVerified = Boolean(manifest && schemaIssues.length === 0);
  let manifestDigestVerified = false;
  let runtimeDigestVerified = false;
  if (schemaVerified) {
    const { manifestDigest, ...manifestCore } = manifest;
    manifestDigestVerified = manifestDigest
      === sha256Buffer(Buffer.from(stableStringify(manifestCore), "utf8"));
    if (!manifestDigestVerified) {
      issues.push(createIssue("manifest_digest_mismatch", "Photoshop Runtime 构建清单自摘要不匹配。"));
    }
    if (runtimeBuffer) {
      runtimeDigestVerified = manifest.runtimeFile.size === runtimeBuffer.length
        && manifest.runtimeFile.digest === sha256Buffer(runtimeBuffer);
      if (!runtimeDigestVerified) {
        issues.push(createIssue("runtime_digest_mismatch", "runtime.js 大小或 SHA-256 与构建清单不匹配。"));
      }
    }
  }

  return {
    version: VERIFICATION_VERSION,
    paths: {
      manifestPath: paths.manifestPath,
      runtimePath: paths.runtimePath
    },
    schemaVerified,
    manifestDigestVerified,
    runtimeDigestVerified,
    artifactsVerified: schemaVerified && manifestDigestVerified && runtimeDigestVerified,
    identity: schemaVerified ? {
      version: manifest.version,
      buildId: manifest.buildId,
      builtAt: manifest.builtAt,
      buildMode: manifest.buildMode,
      gitCommit: manifest.gitCommit,
      gitDirty: manifest.gitDirty,
      dirtyScope: manifest.dirtyScope,
      sourceDigest: manifest.sourceDigest,
      runtimeDigest: manifest.runtimeFile.digest,
      manifestDigest: manifest.manifestDigest
    } : null,
    manifest: schemaVerified ? manifest : null,
    issues
  };
}

function validateCheckoutIdentity(identity) {
  return Boolean(
    identity
    && isGitCommit(identity.gitCommit)
    && typeof identity.gitDirty === "boolean"
    && typeof identity.dirtyScope === "string"
    && identity.dirtyScope.trim()
    && isSha256Digest(identity.sourceDigest)
  );
}

function readCurrentPhotoshopCheckoutIdentity(options = {}) {
  if (options.currentCheckoutIdentity) {
    if (!validateCheckoutIdentity(options.currentCheckoutIdentity)) {
      throw new Error("注入的 Photoshop checkout 身份无效。");
    }
    return { ...options.currentCheckoutIdentity };
  }
  const paths = resolveDefaultPaths(options);
  const relativeUxpRoot = path.relative(paths.repoRoot, paths.uxpRoot).replace(/\\/g, "/");
  const spawnOptions = {
    cwd: paths.repoRoot,
    encoding: "utf8",
    windowsHide: true,
    timeout: 5000,
    maxBuffer: 16 * 1024 * 1024
  };
  const commitResult = spawnSync("git", ["rev-parse", "HEAD"], spawnOptions);
  const statusResult = spawnSync(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all", "--", relativeUxpRoot],
    spawnOptions
  );
  const gitCommit = commitResult.status === 0
    ? String(commitResult.stdout || "").trim().toLowerCase()
    : "";
  if (!isGitCommit(gitCommit) || statusResult.status !== 0) {
    throw new Error("无法取得当前 Photoshop UXP checkout 的 Git 身份。");
  }
  return {
    gitCommit,
    gitDirty: Boolean(String(statusResult.stdout || "").trim()),
    dirtyScope: relativeUxpRoot,
    sourceDigest: calculatePhotoshopSourceDigest(paths.sourceRoot)
  };
}

function compareFields(actual, expected, fields, scope) {
  const mismatches = [];
  for (const field of fields) {
    if (actual?.[field] === expected?.[field]) continue;
    mismatches.push(createIssue(
      `${scope}_${field}_mismatch`,
      `${scope} 的 ${field} 不匹配。`,
      { field, expected: expected?.[field] ?? null, actual: actual?.[field] ?? null }
    ));
  }
  return mismatches;
}

function buildPhotoshopRuntimeBinding(verification) {
  const liveIdentity = verification?.live?.identity;
  const artifactIdentity = verification?.artifacts?.identity;
  if (verification?.ready !== true
    || !liveIdentity
    || !artifactIdentity
    || !isSha256Digest(artifactIdentity.runtimeDigest)
    || !isSha256Digest(artifactIdentity.manifestDigest)) {
    return null;
  }
  return {
    version: DEBUG_BRIDGE_BINDING_VERSION,
    live: { ...liveIdentity, features: [...liveIdentity.features] },
    runtimeDigest: artifactIdentity.runtimeDigest,
    manifestDigest: artifactIdentity.manifestDigest
  };
}

function validatePhotoshopRuntimeBinding(value) {
  if (!isExactObject(value, ["version", "live", "runtimeDigest", "manifestDigest"])
    || value.version !== DEBUG_BRIDGE_BINDING_VERSION
    || !isSha256Digest(value.runtimeDigest)
    || !isSha256Digest(value.manifestDigest)) {
    return false;
  }
  return validateLiveRuntimeSchema(value.live).length === 0;
}

function photoshopRuntimeBindingsMatch(left, right) {
  if (!validatePhotoshopRuntimeBinding(left) || !validatePhotoshopRuntimeBinding(right)) {
    return false;
  }
  return stableStringify(left) === stableStringify(right);
}

function compareLivePhotoshopRuntimeIdentity(input) {
  const liveRuntime = input.liveRuntime;
  const manifestIdentity = input.manifestIdentity;
  const currentCheckoutIdentity = input.currentCheckoutIdentity;
  const schemaIssues = validateLiveRuntimeSchema(liveRuntime);
  const manifestMismatches = schemaIssues.length === 0 && manifestIdentity
    ? compareFields(liveRuntime, manifestIdentity, LIVE_MANIFEST_FIELDS, "live_manifest")
    : [];
  const checkoutMismatches = schemaIssues.length === 0 && currentCheckoutIdentity
    ? compareFields(liveRuntime, currentCheckoutIdentity, CHECKOUT_FIELDS, "live_checkout")
    : [];
  return {
    schemaVerified: schemaIssues.length === 0,
    matchesManifest: schemaIssues.length === 0
      && Boolean(manifestIdentity)
      && manifestMismatches.length === 0,
    matchesCurrentCheckout: schemaIssues.length === 0
      && Boolean(currentCheckoutIdentity)
      && checkoutMismatches.length === 0,
    identity: schemaIssues.length === 0 ? { ...liveRuntime, features: [...liveRuntime.features] } : null,
    issues: [...schemaIssues, ...manifestMismatches, ...checkoutMismatches]
  };
}

function verifyPhotoshopRuntimeBuildIdentity(options = {}) {
  const artifacts = readPhotoshopRuntimeBuildArtifacts(options);
  let currentCheckout = null;
  const issues = [...artifacts.issues];
  try {
    currentCheckout = readCurrentPhotoshopCheckoutIdentity(options);
  } catch (error) {
    issues.push(createIssue(
      "current_checkout_identity_unavailable",
      error instanceof Error ? error.message : String(error)
    ));
  }
  const manifestCheckoutMismatches = artifacts.identity && currentCheckout
    ? compareFields(artifacts.identity, currentCheckout, CHECKOUT_FIELDS, "manifest_checkout")
    : [];
  issues.push(...manifestCheckoutMismatches);
  const manifestMatchesCurrentCheckout = Boolean(
    artifacts.identity
    && currentCheckout
    && manifestCheckoutMismatches.length === 0
  );
  const liveProvided = options.liveRuntime !== undefined && options.liveRuntime !== null;
  const liveRequired = options.requireLive === true;
  const live = liveProvided
    ? compareLivePhotoshopRuntimeIdentity({
      liveRuntime: options.liveRuntime,
      manifestIdentity: artifacts.identity,
      currentCheckoutIdentity: currentCheckout
    })
    : null;
  if (live) issues.push(...live.issues);
  if (liveRequired && !liveProvided) {
    issues.push(createIssue(
      "live_runtime_identity_unavailable",
      "本次验证要求 diagnoseState Runtime 身份，但当前没有可比较的 live Runtime。"
    ));
  }
  const ready = artifacts.artifactsVerified
    && manifestMatchesCurrentCheckout
    && (!liveRequired || liveProvided)
    && (!liveProvided || Boolean(live?.matchesManifest && live?.matchesCurrentCheckout));
  return {
    version: VERIFICATION_VERSION,
    capturedAt: new Date().toISOString(),
    ready,
    liveProvided,
    liveRequired,
    artifacts,
    currentCheckout,
    manifestMatchesCurrentCheckout,
    live,
    issues
  };
}

module.exports = {
  DEBUG_BRIDGE_BINDING_VERSION,
  PHOTOSHOP_RUNTIME_MANIFEST_VERSION,
  PHOTOSHOP_RUNTIME_VERSION,
  VERIFICATION_VERSION,
  calculatePhotoshopSourceDigest,
  buildPhotoshopRuntimeBinding,
  compareLivePhotoshopRuntimeIdentity,
  deriveBuildId,
  readCurrentPhotoshopCheckoutIdentity,
  readPhotoshopRuntimeBuildArtifacts,
  photoshopRuntimeBindingsMatch,
  validatePhotoshopRuntimeBinding,
  verifyPhotoshopRuntimeBuildIdentity
};
