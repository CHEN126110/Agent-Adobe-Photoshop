"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const RUNTIME_BUILD_VERSION = "designecho-uxp-runtime-build/v1";
const RUNTIME_MANIFEST_VERSION = "designecho-uxp-runtime-build-manifest/v1";

function stableStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(",")}]`;
    }
    if (!value || typeof value !== "object") {
        return JSON.stringify(value);
    }
    return `{${Object.keys(value).sort().map((key) => (
        `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(",")}}`;
}

function sha256Buffer(value) {
    const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
    return `sha256:${crypto.createHash("sha256").update(buffer).digest("hex")}`;
}

function collectFiles(root) {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        throw new Error(`UXP 源目录不存在：${root}`);
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
            files.push({
                absolutePath,
                relativePath: path.relative(root, absolutePath).replace(/\\/g, "/")
            });
        }
    }
    return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function calculateSourceDigest(sourceRoot) {
    const files = collectFiles(path.resolve(sourceRoot));
    if (files.length === 0) {
        throw new Error("UXP 源目录为空，拒绝生成 Runtime 构建身份。");
    }
    const hash = crypto.createHash("sha256");
    for (const file of files) {
        const content = fs.readFileSync(file.absolutePath);
        hash.update(Buffer.from(`${file.relativePath}\0${content.length}\0`, "utf8"));
        hash.update(content);
        hash.update(Buffer.from("\0", "utf8"));
    }
    return `sha256:${hash.digest("hex")}`;
}

function readGitIdentity(repoRoot, uxpRoot) {
    const options = {
        cwd: path.resolve(repoRoot),
        encoding: "utf8",
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 16 * 1024 * 1024
    };
    const commitResult = spawnSync("git", ["rev-parse", "HEAD"], options);
    const relativeUxpRoot = path.relative(path.resolve(repoRoot), path.resolve(uxpRoot))
        .replace(/\\/g, "/");
    const statusResult = spawnSync(
        "git",
        ["status", "--porcelain=v1", "--untracked-files=all", "--", relativeUxpRoot],
        options
    );
    const gitCommit = commitResult.status === 0
        ? String(commitResult.stdout || "").trim().toLowerCase()
        : "";
    if (!/^[0-9a-f]{40}$/.test(gitCommit) || statusResult.status !== 0) {
        throw new Error("无法取得 UXP 构建时 Git 身份，拒绝生成不可追溯的 Runtime。");
    }
    return {
        gitCommit,
        gitDirty: Boolean(String(statusResult.stdout || "").trim()),
        dirtyScope: relativeUxpRoot
    };
}

function createRuntimeBuildIdentity(input) {
    const uxpRoot = path.resolve(input.uxpRoot);
    const sourceDigest = calculateSourceDigest(path.join(uxpRoot, "src"));
    const git = input.gitIdentity || readGitIdentity(input.repoRoot, uxpRoot);
    const buildMode = input.buildMode === "production" ? "production" : "development";
    const dirtySuffix = git.gitDirty ? "-dirty" : "";
    const buildId = [
        "designecho-uxp",
        buildMode,
        git.gitCommit.slice(0, 12),
        sourceDigest.slice("sha256:".length, "sha256:".length + 12)
    ].join("-") + dirtySuffix;
    return {
        version: RUNTIME_BUILD_VERSION,
        buildId,
        builtAt: input.builtAt || new Date().toISOString(),
        buildMode,
        gitCommit: git.gitCommit,
        gitDirty: git.gitDirty,
        dirtyScope: git.dirtyScope,
        sourceDigest
    };
}

function createRuntimeBuildManifest(identity, runtimeAsset) {
    const runtimeBuffer = Buffer.isBuffer(runtimeAsset)
        ? runtimeAsset
        : Buffer.from(runtimeAsset);
    const manifestCore = {
        version: RUNTIME_MANIFEST_VERSION,
        buildId: identity.buildId,
        builtAt: identity.builtAt,
        buildMode: identity.buildMode,
        gitCommit: identity.gitCommit,
        gitDirty: identity.gitDirty,
        dirtyScope: identity.dirtyScope,
        sourceDigest: identity.sourceDigest,
        runtimeFile: {
            ref: "runtime.js",
            size: runtimeBuffer.length,
            digest: sha256Buffer(runtimeBuffer)
        }
    };
    return {
        ...manifestCore,
        manifestDigest: sha256Buffer(Buffer.from(stableStringify(manifestCore), "utf8"))
    };
}

function verifyRuntimeBuildManifest(manifest, runtimeAsset) {
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return false;
    if (manifest.version !== RUNTIME_MANIFEST_VERSION) return false;
    if (!/^[0-9a-f]{40}$/.test(String(manifest.gitCommit || "").toLowerCase())) return false;
    if (!/^sha256:[0-9a-f]{64}$/.test(String(manifest.sourceDigest || ""))) return false;
    if (typeof manifest.gitDirty !== "boolean") return false;
    if (!manifest.runtimeFile || manifest.runtimeFile.ref !== "runtime.js") return false;
    const runtimeBuffer = Buffer.isBuffer(runtimeAsset)
        ? runtimeAsset
        : Buffer.from(runtimeAsset);
    if (manifest.runtimeFile.size !== runtimeBuffer.length) return false;
    if (manifest.runtimeFile.digest !== sha256Buffer(runtimeBuffer)) return false;
    const { manifestDigest, ...manifestCore } = manifest;
    return manifestDigest === sha256Buffer(Buffer.from(stableStringify(manifestCore), "utf8"));
}

module.exports = {
    RUNTIME_BUILD_VERSION,
    RUNTIME_MANIFEST_VERSION,
    calculateSourceDigest,
    createRuntimeBuildIdentity,
    createRuntimeBuildManifest,
    sha256Buffer,
    stableStringify,
    verifyRuntimeBuildManifest
};
