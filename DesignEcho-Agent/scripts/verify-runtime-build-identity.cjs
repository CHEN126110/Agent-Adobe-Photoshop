#!/usr/bin/env node
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

require("ts-node").register({
  transpileOnly: true,
  project: path.resolve(__dirname, "..", "tsconfig.main.json")
});

const {
  captureRuntimeBuildIdentity
} = require("../src/main/services/runtime-build-identity.ts");
const {
  buildRuntimeBuildManifest,
  writeRuntimeBuildManifest
} = require("./write-runtime-build-manifest.cjs");
const {
  buildPhotoshopRuntimeBinding,
  calculatePhotoshopSourceDigest,
  photoshopRuntimeBindingsMatch,
  verifyPhotoshopRuntimeBuildIdentity
} = require("./lib/photoshop-runtime-build-identity.cjs");
const {
  createRuntimeBuildIdentity: createPhotoshopRuntimeBuildIdentity,
  createRuntimeBuildManifest: createPhotoshopRuntimeBuildManifest
} = require("../../DesignEcho-UXP/scripts/runtime-build-identity.cjs");

const APP_VERSION = "9.8.7-test";
const GIT_COMMIT = "0123456789abcdef0123456789abcdef01234567";

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(value[key])}`
  )).join(",")}}`;
}

function sha256(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  return `sha256:${crypto.createHash("sha256").update(buffer).digest("hex")}`;
}

function createAppRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "designecho-runtime-identity-"));
  fs.mkdirSync(path.join(root, "dist", "main", "main"), { recursive: true });
  fs.mkdirSync(path.join(root, "dist", "renderer"), { recursive: true });
  fs.writeFileSync(path.join(root, "dist", "main", "main", "index.js"), "module.exports = 'main-v1';\n", "utf8");
  fs.writeFileSync(path.join(root, "dist", "renderer", "index.html"), "<main>renderer-v1</main>\n", "utf8");
  writeRuntimeBuildManifest({
    root,
    appVersion: APP_VERSION,
    gitIdentity: { gitCommit: GIT_COMMIT, gitDirty: false },
    builtAt: "2026-08-26T00:00:00.000Z"
  });
  return root;
}

function capture(root, appVersion = APP_VERSION) {
  return captureRuntimeBuildIdentity({
    appRoot: root,
    appVersion,
    environment: {}
  });
}

function rewriteManifest(root, mutate) {
  const manifestPath = path.join(root, "dist", "runtime-build-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  mutate(manifest);
  manifest.artifactDigest = sha256(stableStringify({
    mainFiles: manifest.mainFiles,
    rendererFiles: manifest.rendererFiles
  }));
  const { manifestDigest: _oldDigest, ...core } = manifest;
  manifest.manifestDigest = sha256(stableStringify(core));
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function withAppRoot(test) {
  const root = createAppRoot();
  try {
    test(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function createPhotoshopRuntimeRoot(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "designecho-photoshop-runtime-"));
  const sourceRoot = path.join(root, "src");
  const distRoot = path.join(root, "dist");
  fs.mkdirSync(sourceRoot, { recursive: true });
  fs.mkdirSync(distRoot, { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, "index.ts"), "export const runtime = 'test';\n", "utf8");
  const gitDirty = options.gitDirty === true;
  const identity = createPhotoshopRuntimeBuildIdentity({
    repoRoot: root,
    uxpRoot: root,
    buildMode: "production",
    builtAt: "2026-08-27T00:00:00.000Z",
    gitIdentity: {
      gitCommit: GIT_COMMIT,
      gitDirty,
      dirtyScope: "DesignEcho-UXP"
    }
  });
  const runtimeBuffer = Buffer.from("module.exports = 'photoshop-runtime';\n", "utf8");
  const manifest = createPhotoshopRuntimeBuildManifest(identity, runtimeBuffer);
  fs.writeFileSync(path.join(distRoot, "runtime.js"), runtimeBuffer);
  fs.writeFileSync(
    path.join(distRoot, "runtime-build-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  const currentCheckoutIdentity = {
    gitCommit: identity.gitCommit,
    gitDirty: identity.gitDirty,
    dirtyScope: identity.dirtyScope,
    sourceDigest: identity.sourceDigest
  };
  const liveRuntime = {
    ...identity,
    loadedAt: "2026-08-27T00:00:01.000Z",
    features: ["diagnoseState.runtimeInfo"]
  };
  return { root, identity, manifest, currentCheckoutIdentity, liveRuntime };
}

function withPhotoshopRuntimeRoot(options, test) {
  const fixture = createPhotoshopRuntimeRoot(options);
  try {
    test(fixture);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

withAppRoot((root) => {
  const identity = capture(root);
  assert.equal(identity.source, "build_manifest");
  assert.equal(identity.artifactsVerified, true);
  assert.equal(identity.gitCommit, GIT_COMMIT);
  assert.equal(identity.gitDirty, false);
  assert.ok(identity.artifactDigest?.startsWith("sha256:"));
  assert.ok(identity.manifestDigest?.startsWith("sha256:"));
});

withAppRoot((root) => {
  fs.appendFileSync(path.join(root, "dist", "renderer", "index.html"), "tampered\n", "utf8");
  assert.equal(capture(root).artifactsVerified, false, "listed artifact tampering must fail");
});

withAppRoot((root) => {
  const manifestPath = path.join(root, "dist", "runtime-build-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.manifestDigest = `sha256:${"0".repeat(64)}`;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
  assert.equal(capture(root).artifactsVerified, false, "manifest digest tampering must fail");
});

withAppRoot((root) => {
  const escapedPath = path.join(root, "outside.js");
  fs.writeFileSync(escapedPath, "outside\n", "utf8");
  rewriteManifest(root, (manifest) => {
    manifest.mainFiles[0] = {
      ref: "../outside.js",
      size: fs.statSync(escapedPath).size,
      digest: sha256(fs.readFileSync(escapedPath))
    };
  });
  assert.equal(capture(root).artifactsVerified, false, "manifest path escape must fail");
});

withAppRoot((root) => {
  assert.equal(capture(root, "different-version").artifactsVerified, false, "appVersion mismatch must fail");
});

for (const collectionName of ["mainFiles", "rendererFiles"]) {
  withAppRoot((root) => {
    rewriteManifest(root, (manifest) => {
      manifest[collectionName] = [];
    });
    assert.equal(capture(root).artifactsVerified, false, `${collectionName} cannot be empty`);
  });
}

for (const missingDirectory of ["main", "renderer"]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "designecho-runtime-missing-"));
  try {
    const presentDirectory = missingDirectory === "main" ? "renderer" : "main";
    fs.mkdirSync(path.join(root, "dist", presentDirectory), { recursive: true });
    fs.writeFileSync(path.join(root, "dist", presentDirectory, "entry.js"), "entry\n", "utf8");
    assert.throws(() => buildRuntimeBuildManifest({
      root,
      appVersion: APP_VERSION,
      gitIdentity: { gitCommit: GIT_COMMIT, gitDirty: false }
    }), /构建产物目录不存在|需要非空/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

withAppRoot((root) => {
  const startupIdentity = capture(root);
  assert.equal(startupIdentity.artifactsVerified, true);
  fs.writeFileSync(path.join(root, "dist", "main", "main", "index.js"), "module.exports = 'main-v2';\n", "utf8");
  const freshIdentity = capture(root);
  assert.equal(freshIdentity.artifactsVerified, false, "fresh capture must detect post-start rewrite");
});

withPhotoshopRuntimeRoot({ gitDirty: true }, (fixture) => {
  assert.equal(
    calculatePhotoshopSourceDigest(path.join(fixture.root, "src")),
    fixture.identity.sourceDigest,
    "Agent-side source digest must independently reproduce the UXP build digest"
  );
  const verification = verifyPhotoshopRuntimeBuildIdentity({
    repoRoot: fixture.root,
    uxpRoot: fixture.root,
    currentCheckoutIdentity: fixture.currentCheckoutIdentity,
    liveRuntime: fixture.liveRuntime
  });
  assert.equal(verification.ready, true, "matching dirty artifacts, checkout, and live runtime must verify");
  assert.equal(verification.artifacts.artifactsVerified, true);
  assert.equal(verification.manifestMatchesCurrentCheckout, true);
  assert.equal(verification.live.matchesManifest, true);
  assert.equal(verification.live.matchesCurrentCheckout, true);
  assert.equal(verification.artifacts.identity.gitDirty, true, "dirty identity must remain explicit");
  const binding = buildPhotoshopRuntimeBinding(verification);
  assert.ok(binding, "verified artifacts and live Runtime must produce a full Debug Bridge binding");
  assert.equal(binding.runtimeDigest, fixture.manifest.runtimeFile.digest);
  assert.equal(binding.manifestDigest, fixture.manifest.manifestDigest);
  assert.equal(photoshopRuntimeBindingsMatch(binding, binding), true);
  assert.equal(photoshopRuntimeBindingsMatch(binding, {
    ...binding,
    live: {
      ...binding.live,
      loadedAt: "2026-08-27T00:00:02.000Z"
    }
  }), false, "same buildId after a UXP reload must not reuse the previous live binding");
});

withPhotoshopRuntimeRoot({ gitDirty: false }, (fixture) => {
  fs.appendFileSync(path.join(fixture.root, "dist", "runtime.js"), "tampered\n", "utf8");
  const verification = verifyPhotoshopRuntimeBuildIdentity({
    repoRoot: fixture.root,
    uxpRoot: fixture.root,
    currentCheckoutIdentity: fixture.currentCheckoutIdentity,
    liveRuntime: fixture.liveRuntime
  });
  assert.equal(verification.ready, false);
  assert.equal(verification.artifacts.runtimeDigestVerified, false);
  assert.ok(
    verification.issues.some((issue) => issue.code === "runtime_digest_mismatch"),
    "runtime.js tampering must be reported"
  );
});

withPhotoshopRuntimeRoot({ gitDirty: false }, (fixture) => {
  const manifestPath = path.join(fixture.root, "dist", "runtime-build-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.manifestDigest = `sha256:${"0".repeat(64)}`;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const verification = verifyPhotoshopRuntimeBuildIdentity({
    repoRoot: fixture.root,
    uxpRoot: fixture.root,
    currentCheckoutIdentity: fixture.currentCheckoutIdentity
  });
  assert.equal(verification.artifacts.manifestDigestVerified, false);
  assert.ok(
    verification.issues.some((issue) => issue.code === "manifest_digest_mismatch"),
    "manifest tampering must be reported"
  );
});

withPhotoshopRuntimeRoot({ gitDirty: false }, (fixture) => {
  const manifestPath = path.join(fixture.root, "dist", "runtime-build-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.unversionedField = true;
  const { manifestDigest: _oldDigest, ...manifestCore } = manifest;
  manifest.manifestDigest = sha256(stableStringify(manifestCore));
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const verification = verifyPhotoshopRuntimeBuildIdentity({
    repoRoot: fixture.root,
    uxpRoot: fixture.root,
    currentCheckoutIdentity: fixture.currentCheckoutIdentity
  });
  assert.equal(verification.artifacts.schemaVerified, false);
  assert.ok(
    verification.issues.some((issue) => issue.code === "manifest_schema_mismatch"),
    "manifest fields outside the versioned schema must be rejected even with a recomputed digest"
  );
});

withPhotoshopRuntimeRoot({ gitDirty: true }, (fixture) => {
  const verification = verifyPhotoshopRuntimeBuildIdentity({
    repoRoot: fixture.root,
    uxpRoot: fixture.root,
    currentCheckoutIdentity: {
      ...fixture.currentCheckoutIdentity,
      gitDirty: false
    },
    liveRuntime: fixture.liveRuntime
  });
  assert.equal(verification.ready, false);
  assert.equal(verification.manifestMatchesCurrentCheckout, false);
  assert.ok(
    verification.issues.some((issue) => issue.code === "manifest_checkout_gitDirty_mismatch"),
    "build-time dirty state must be compared with the current UXP checkout"
  );
});

withPhotoshopRuntimeRoot({ gitDirty: false }, (fixture) => {
  const sameBuildIdButDifferentRuntime = {
    ...fixture.liveRuntime,
    builtAt: "2026-08-27T00:00:02.000Z"
  };
  assert.equal(sameBuildIdButDifferentRuntime.buildId, fixture.liveRuntime.buildId);
  const verification = verifyPhotoshopRuntimeBuildIdentity({
    repoRoot: fixture.root,
    uxpRoot: fixture.root,
    currentCheckoutIdentity: fixture.currentCheckoutIdentity,
    liveRuntime: sameBuildIdButDifferentRuntime
  });
  assert.equal(verification.ready, false);
  assert.equal(verification.live.schemaVerified, true);
  assert.equal(verification.live.matchesManifest, false);
  assert.ok(
    verification.issues.some((issue) => issue.code === "live_manifest_builtAt_mismatch"),
    "a matching buildId must not hide a mismatched live runtime identity"
  );
});

withPhotoshopRuntimeRoot({ gitDirty: false }, (fixture) => {
  const verification = verifyPhotoshopRuntimeBuildIdentity({
    repoRoot: fixture.root,
    uxpRoot: fixture.root,
    currentCheckoutIdentity: fixture.currentCheckoutIdentity,
    requireLive: true
  });
  assert.equal(verification.ready, false);
  assert.ok(
    verification.issues.some((issue) => issue.code === "live_runtime_identity_unavailable"),
    "a live-required verification must not fall back to disk-only identity"
  );
});

console.log("[OK] Runtime build identity verifies Agent and Photoshop artifacts, full live identity, dirty state, tampering, drift, and path escape.");
