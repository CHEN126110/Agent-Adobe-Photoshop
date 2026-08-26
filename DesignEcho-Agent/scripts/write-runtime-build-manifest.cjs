#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");

function sha256Buffer(buffer) {
  return `sha256:${crypto.createHash("sha256").update(buffer).digest("hex")}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(value[key])}`
  )).join(",")}}`;
}

function collectFiles(root, prefix) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`构建产物目录不存在：${root}`);
  }
  const pending = [root];
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
      const relativePath = path.relative(root, absolutePath).replace(/\\/g, "/");
      const content = fs.readFileSync(absolutePath);
      files.push({
        ref: `${prefix}/${relativePath}`,
        size: content.length,
        digest: sha256Buffer(content)
      });
    }
  }
  return files.sort((left, right) => left.ref.localeCompare(right.ref));
}

function readGitIdentity() {
  const options = {
    cwd: ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 5000,
    maxBuffer: 16 * 1024 * 1024
  };
  const commitResult = spawnSync("git", ["rev-parse", "HEAD"], options);
  const statusResult = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], options);
  const gitCommit = commitResult.status === 0
    ? String(commitResult.stdout || "").trim().toLowerCase()
    : "";
  if (!/^[0-9a-f]{40}$/.test(gitCommit) || statusResult.status !== 0) {
    throw new Error("无法取得构建时 Git 身份，拒绝生成可用于正式评测的 Runtime 清单。");
  }
  return {
    gitCommit,
    gitDirty: Boolean(String(statusResult.stdout || "").trim())
  };
}

function buildRuntimeBuildManifest(input) {
  const root = path.resolve(input.root);
  const distRoot = path.join(root, "dist");
  const mainFiles = collectFiles(path.join(distRoot, "main"), "main");
  const rendererFiles = collectFiles(path.join(distRoot, "renderer"), "renderer");
  if (mainFiles.length === 0 || rendererFiles.length === 0) {
    throw new Error("Runtime build manifest 需要非空的 main 与 renderer 构建产物。");
  }
  const git = input.gitIdentity || readGitIdentity();
  const artifactDigest = sha256Buffer(Buffer.from(stableStringify({ mainFiles, rendererFiles }), "utf8"));
  const buildId = `designecho-${git.gitCommit.slice(0, 12)}-${artifactDigest.slice(-12)}`;
  const manifestCore = {
    version: "designecho-runtime-build-manifest/v1",
    buildId,
    builtAt: input.builtAt || new Date().toISOString(),
    appVersion: String(input.appVersion || "unknown"),
    gitCommit: git.gitCommit,
    gitDirty: git.gitDirty,
    artifactDigest,
    mainFiles,
    rendererFiles
  };
  return {
    ...manifestCore,
    manifestDigest: sha256Buffer(Buffer.from(stableStringify(manifestCore), "utf8"))
  };
}

function writeRuntimeBuildManifest(input) {
  const root = path.resolve(input.root);
  const manifestPath = path.join(root, "dist", "runtime-build-manifest.json");
  const manifest = buildRuntimeBuildManifest(input);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const tempPath = `${manifestPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, manifestPath);
  return manifest;
}

function main() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const manifest = writeRuntimeBuildManifest({
    root: ROOT,
    appVersion: String(packageJson.version || "unknown"),
    gitIdentity: readGitIdentity()
  });
  console.log(`Runtime build manifest: ${manifest.buildId}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildRuntimeBuildManifest,
  writeRuntimeBuildManifest
};
