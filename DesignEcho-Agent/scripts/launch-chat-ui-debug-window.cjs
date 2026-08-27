#!/usr/bin/env node
"use strict";

const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const TMP_ROOT = path.join(ROOT, "tmp");
const DEBUG_USER_DATA_ROOT = path.resolve(os.tmpdir(), "designecho-agent-debug-user-data");
const LAST_LAUNCH_JSON = path.join(TMP_ROOT, "chat-ui-debug-window-last-launch.json");

function usage() {
  return [
    "Usage: node scripts/launch-chat-ui-debug-window.cjs [--port 9223|auto] [--port-offset 20000] [--use-default-runtime-ports] [--preflight-only] [--log-file <path>] [--fake-model] [--fake-model-fixture <name>] [--fake-photoshop] [--empty-photoshop] [--isolated-user-data] [--seed-user-state] [--model <configured-model-id>] [--project <path>] [--self-test]",
    "",
    "Launches a persistent DesignEcho Electron window with the chat test bridge and a CDP port.",
    "This command does not close the window automatically; use inspect-chat-ui-running-window.cjs to attach to it.",
    "The debug window uses an isolated runtime port block by default so it does not disturb a normal running Agent window.",
    "Use --use-default-runtime-ports only after the normal runtime has stopped; the debug window becomes the sole owner for live Photoshop validation.",
    "--model requires --seed-user-state and changes only a minimal credential-free preference seed in OS temp; it never copies API keys or rewrites normal DesignEcho userData.",
    "With --seed-user-state, --project is written as the only explicit project in that isolated seed; normal current/recent projects are never copied."
  ].join("\n");
}

function parseArgs(argv) {
  const parsed = {
    port: 9223,
    autoPort: false,
    portOffset: 20000,
    useDefaultRuntimePorts: false,
    preflightOnly: false,
    logFile: "",
    fakeModel: false,
    fakeModelFixture: "",
    fakePhotoshop: false,
    emptyPhotoshop: false,
    isolatedUserData: false,
    seedUserState: false,
    modelId: "",
    projectPath: "",
    selfTest: false
  };

  let explicitPortOffset = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--self-test") {
      parsed.selfTest = true;
      continue;
    }
    if (arg === "--port") {
      applyPortArg(parsed, argv[index + 1] || "");
      index += 1;
      continue;
    }
    if (arg.startsWith("--port=")) {
      applyPortArg(parsed, arg.slice("--port=".length));
      continue;
    }
    if (arg === "--port-offset") {
      parsed.portOffset = Number.parseInt(argv[index + 1], 10);
      explicitPortOffset = true;
      index += 1;
      continue;
    }
    if (arg.startsWith("--port-offset=")) {
      parsed.portOffset = Number.parseInt(arg.slice("--port-offset=".length), 10);
      explicitPortOffset = true;
      continue;
    }
    if (arg === "--use-default-runtime-ports") {
      parsed.useDefaultRuntimePorts = true;
      continue;
    }
    if (arg === "--preflight-only") {
      parsed.preflightOnly = true;
      continue;
    }
    if (arg === "--log-file") {
      parsed.logFile = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--log-file=")) {
      parsed.logFile = arg.slice("--log-file=".length);
      continue;
    }
    if (arg === "--fake-model") {
      parsed.fakeModel = true;
      continue;
    }
    if (arg === "--fake-model-fixture") {
      parsed.fakeModelFixture = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--fake-model-fixture=")) {
      parsed.fakeModelFixture = arg.slice("--fake-model-fixture=".length);
      continue;
    }
    if (arg === "--fake-photoshop") {
      parsed.fakePhotoshop = true;
      continue;
    }
    if (arg === "--empty-photoshop") {
      parsed.emptyPhotoshop = true;
      continue;
    }
    if (arg === "--isolated-user-data") {
      parsed.isolatedUserData = true;
      continue;
    }
    if (arg === "--seed-user-state") {
      parsed.seedUserState = true;
      parsed.isolatedUserData = true;
      continue;
    }
    if (arg === "--model") {
      parsed.modelId = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--model=")) {
      parsed.modelId = arg.slice("--model=".length);
      continue;
    }
    if (arg === "--project") {
      parsed.projectPath = argv[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--project=")) {
      parsed.projectPath = arg.slice("--project=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (parsed.useDefaultRuntimePorts) {
    if (explicitPortOffset && parsed.portOffset !== 0) {
      throw new Error("--use-default-runtime-ports cannot be combined with a non-zero --port-offset.");
    }
    parsed.portOffset = 0;
  }

  if (!parsed.autoPort && (!Number.isInteger(parsed.port) || parsed.port < 1024 || parsed.port > 65535)) {
    throw new Error("--port must be an integer between 1024 and 65535.");
  }
  if (!Number.isInteger(parsed.portOffset) || parsed.portOffset < 0 || parsed.portOffset > 50000) {
    throw new Error("--port-offset must be an integer between 0 and 50000.");
  }
  if (parsed.modelId) {
    if (!parsed.seedUserState) {
      throw new Error("--model requires --seed-user-state so the normal DesignEcho userData remains untouched.");
    }
    if (!/^[A-Za-z0-9._:-]{1,256}$/.test(parsed.modelId)) {
      throw new Error("--model must be a configured model id containing only letters, numbers, dot, underscore, colon, or hyphen.");
    }
  }

  return parsed;
}

function applyPortArg(parsed, value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "auto") {
    parsed.autoPort = true;
    parsed.port = 0;
    return;
  }
  parsed.autoPort = false;
  parsed.port = Number.parseInt(value, 10);
}

function resolveElectronBin() {
  try {
    return require("electron");
  } catch (error) {
    throw new Error(`Unable to resolve Electron binary. Run npm install first. ${error.message}`);
  }
}

function ensureBuiltApp() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const mainEntry = path.join(ROOT, pkg.main || "dist/main/main/index.js");
  const rendererEntry = path.join(ROOT, "dist", "renderer", "index.html");
  if (!fs.existsSync(mainEntry) || !fs.existsSync(rendererEntry)) {
    throw new Error("Missing built Electron output. Run npm run build before launching the debug window.");
  }
}

function buildEnv(parsed) {
  const projectPath = parsed.projectPath
    ? path.resolve(parsed.projectPath)
    : ensureDefaultProjectPath();
  const env = {
    ...process.env,
    DESIGNECHO_CHAT_TEST_BRIDGE: "1",
    DESIGNECHO_REMOTE_DEBUGGING_PORT: String(parsed.port),
    DESIGNECHO_PORT_OFFSET: String(parsed.portOffset),
    DESIGNECHO_SKIP_PORT_CLEANUP: "1",
    ELECTRON_DISABLE_SECURITY_WARNINGS: "true"
  };

  if (parsed.fakeModel) env.DESIGNECHO_CHAT_TEST_FAKE_MODEL = "1";
  if (parsed.fakeModelFixture) {
    env.DESIGNECHO_CHAT_TEST_FAKE_MODEL = "1";
    env.DESIGNECHO_CHAT_TEST_FAKE_MODEL_FIXTURE = parsed.fakeModelFixture;
  }
  if (parsed.fakePhotoshop) env.DESIGNECHO_CHAT_TEST_FAKE_PHOTOSHOP = "1";
  if (parsed.emptyPhotoshop) env.DESIGNECHO_CHAT_TEST_FAKE_PHOTOSHOP_EMPTY = "1";
  if (projectPath) env.DESIGNECHO_CHAT_TEST_PROJECT_PATH = projectPath;

  if (parsed.isolatedUserData) {
    const userDataDir = resolveIsolatedUserDataDir(parsed);
    resetIsolatedUserDataDir(userDataDir);
    if (parsed.seedUserState) {
      const seededState = seedUserStateStore(userDataDir, projectPath);
      if (parsed.modelId) {
        if (!seededState) {
          throw new Error("Cannot apply --model because the normal DesignEcho state store does not exist.");
        }
        overrideSeededModelPreferences(seededState.destination, parsed.modelId);
      }
    }
    env.DESIGNECHO_TEST_USER_DATA_DIR = userDataDir;
  }

  return env;
}

function ensureDefaultProjectPath() {
  const projectPath = path.join(TMP_ROOT, "chat-ui-debug-project");
  const subdirs = ["assets", "PSD", "SKU", "main-image", "detail-page"];
  fs.mkdirSync(projectPath, { recursive: true });
  for (const subdir of subdirs) {
    fs.mkdirSync(path.join(projectPath, subdir), { recursive: true });
  }
  return projectPath;
}

function resolveIsolatedUserDataDir(parsed) {
  return path.join(DEBUG_USER_DATA_ROOT, `window-${parsed.port}`);
}

function assertSafeDebugUserDataPath(userDataDir, debugRoot = DEBUG_USER_DATA_ROOT) {
  const systemTempRoot = fs.realpathSync.native(path.resolve(os.tmpdir()));
  const root = path.resolve(debugRoot);
  const target = path.resolve(userDataDir);
  const rootRelativeToTemp = path.relative(systemTempRoot, root);
  const relative = path.relative(root, target);
  if (!rootRelativeToTemp
    || rootRelativeToTemp.startsWith("..")
    || path.isAbsolute(rootRelativeToTemp)
    || !relative
    || relative.startsWith("..")
    || path.isAbsolute(relative)) {
    throw new Error("Refusing to reset an isolated userData path outside the OS temporary debug root.");
  }
  for (const candidate of [root, target]) {
    if (!fs.existsSync(candidate)) continue;
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("Refusing to reset an isolated userData path through a symlink, junction, or non-directory.");
    }
    const realCandidate = fs.realpathSync.native(candidate);
    const realRelative = path.relative(systemTempRoot, realCandidate);
    if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      throw new Error("Refusing to reset an isolated userData path whose real target escapes OS temp.");
    }
  }
}

function resetIsolatedUserDataDir(userDataDir, debugRoot = DEBUG_USER_DATA_ROOT) {
  fs.mkdirSync(debugRoot, { recursive: true, mode: 0o700 });
  assertSafeDebugUserDataPath(userDataDir, debugRoot);
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.mkdirSync(userDataDir, { recursive: false, mode: 0o700 });
  assertSafeDebugUserDataPath(userDataDir, debugRoot);
}

function getCurrentUserStateStorePath() {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "designecho-agent", "app-state-store.json");
  }
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "designecho-agent",
      "app-state-store.json"
    );
  }
  const configRoot = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configRoot, "designecho-agent", "app-state-store.json");
}

function seedUserStateStore(userDataDir, projectPath = "") {
  const source = getCurrentUserStateStorePath();
  if (!fs.existsSync(source)) return null;
  const destination = path.join(userDataDir, "app-state-store.json");
  const parsed = JSON.parse(fs.readFileSync(source, "utf8"));
  const sanitized = buildSanitizedSeedStateStore(parsed, projectPath);
  if (!sanitized) return null;
  fs.writeFileSync(destination, `${JSON.stringify(sanitized, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });
  return { source, destination };
}

function parsePersistedProjection(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readModelPreferencesFromProjection(value) {
  const projection = parsePersistedProjection(value);
  const preferences = projection?.state?.modelPreferences || projection?.modelPreferences;
  return sanitizeModelPreferences(preferences);
}

function sanitizeModelPreferenceBucket(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const output = {};
  for (const key of ["layoutAnalysis", "textOptimize", "visualAnalyze"]) {
    if (typeof value[key] === "string") output[key] = value[key];
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function sanitizeModelPreferences(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const primaryModel = typeof value.primaryModel === "string" ? value.primaryModel.trim() : "";
  if (!primaryModel) return null;
  const localBucket = sanitizeModelPreferenceBucket(value.preferredLocalModels);
  const cloudBucket = sanitizeModelPreferenceBucket(value.preferredCloudModels);
  const output = {
    primaryModel,
    visualModel: typeof value.visualModel === "string" && value.visualModel.trim()
      ? value.visualModel.trim()
      : primaryModel
  };
  if (value.mode === "local" || value.mode === "cloud") output.mode = value.mode;
  if (typeof value.autoFallback === "boolean") output.autoFallback = value.autoFallback;
  if (localBucket) output.preferredLocalModels = localBucket;
  if (cloudBucket) output.preferredCloudModels = cloudBucket;
  if (value.thinking && typeof value.thinking === "object" && typeof value.thinking.enabled === "boolean") {
    output.thinking = { enabled: value.thinking.enabled };
  }
  return output;
}

function buildExplicitProjectSeed(projectPath) {
  const normalizedPath = String(projectPath || "").trim();
  if (!normalizedPath) return null;
  const resolvedPath = path.resolve(normalizedPath);
  const now = Date.now();
  return {
    id: "chat-ui-debug-project",
    name: path.basename(resolvedPath) || "DesignEcho Debug Project",
    path: resolvedPath,
    createdAt: now,
    lastOpenedAt: now,
    folders: {}
  };
}

function buildSanitizedSeedStateStore(sourceState, projectPath = "") {
  const entries = sourceState?.entries && typeof sourceState.entries === "object"
    ? sourceState.entries
    : {};
  const persistedProjection = parsePersistedProjection(entries["designecho-storage"])
    || parsePersistedProjection(sourceState?.["designecho-storage"]);
  const rendererProjection = parsePersistedProjection(entries.rendererState)
    || parsePersistedProjection(sourceState?.rendererState);
  const modelPreferences = readModelPreferencesFromProjection(persistedProjection)
    || readModelPreferencesFromProjection(rendererProjection);
  if (!modelPreferences) return null;
  const persistedVersion = Number.isInteger(persistedProjection?.version)
    ? persistedProjection.version
    : undefined;
  const explicitProject = buildExplicitProjectSeed(projectPath);
  const safePersistedProjection = {
    ...(persistedVersion !== undefined ? { version: persistedVersion } : {}),
    state: {
      modelPreferences: JSON.parse(JSON.stringify(modelPreferences)),
      ...(explicitProject
        ? {
          currentProject: explicitProject,
          recentProjects: [explicitProject]
        }
        : {})
    }
  };
  const safeRendererProjection = {
    modelPreferences: JSON.parse(JSON.stringify(modelPreferences))
  };
  return {
    updatedAt: Date.now(),
    entries: {
      "designecho-storage": JSON.stringify(safePersistedProjection),
      rendererState: JSON.stringify(safeRendererProjection)
    }
  };
}

function overrideSeededModelPreferences(stateStorePath, modelId) {
  const state = JSON.parse(fs.readFileSync(stateStorePath, "utf8"));
  const projections = [];
  if (state?.entries && typeof state.entries === "object") {
    for (const key of ["designecho-storage", "rendererState"]) {
      const projection = parsePersistedProjection(state.entries[key]);
      if (projection) projections.push({ key, projection, serialized: true });
    }
  } else {
    for (const key of ["designecho-storage", "rendererState"]) {
      const projection = parsePersistedProjection(state?.[key]);
      if (projection) projections.push({ key, projection, serialized: false });
    }
  }
  const targets = projections
    .map(({ projection }) => ({
      projection,
      preferences: sanitizeModelPreferences(
        projection?.state?.modelPreferences || projection?.modelPreferences
      )
    }))
    .filter(({ preferences }) => Boolean(preferences));
  if (targets.length === 0) {
    throw new Error("The seeded DesignEcho state does not contain a recognized modelPreferences object.");
  }
  for (const target of targets) {
    const preferences = target.preferences;
    preferences.primaryModel = modelId;
    preferences.visualModel = modelId;
    if (target.projection?.state?.modelPreferences) {
      target.projection.state.modelPreferences = preferences;
    } else {
      target.projection.modelPreferences = preferences;
    }
  }
  for (const { key, projection, serialized } of projections) {
    if (serialized) state.entries[key] = JSON.stringify(projection);
    else state[key] = projection;
  }
  const tempPath = `${stateStorePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  fs.renameSync(tempPath, stateStorePath);
  return targets.length;
}

function resolveLaunchPorts(parsed) {
  const offset = Number(parsed.portOffset || 0);
  return [
    { label: "CDP remote debugging", port: parsed.port },
    { label: "Agent WebSocket bridge", port: 8765 + offset },
    { label: "Agent WebView server", port: 8766 + offset },
    { label: "Agent debug bridge", port: 8767 + offset },
    { label: "Agent MCP host", port: 8768 + offset }
  ];
}

function isTcpPortOpenOnHost(port, host) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    socket.setTimeout(350);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

async function isTcpPortOpen(port) {
  const checks = await Promise.all([
    isTcpPortOpenOnHost(port, "127.0.0.1"),
    isTcpPortOpenOnHost(port, "::1")
  ]);
  return checks.some(Boolean);
}

function buildAutoCdpPortCandidates() {
  return Array.from({ length: 18 }, (_, index) => 9223 + index);
}

async function resolveAutoCdpPort(parsed) {
  if (!parsed.autoPort) return parsed;
  for (const candidatePort of buildAutoCdpPortCandidates()) {
    if (!(await isTcpPortOpen(candidatePort))) {
      return {
        ...parsed,
        port: candidatePort,
        autoPortResolved: true
      };
    }
  }
  throw createNoUsageError(
    `No free CDP port was found in ${buildAutoCdpPortCandidates().join(", ")}. Close an old debug window or pass --port <free-port>.`
  );
}

function readPortOwnerSummary(port) {
  if (process.platform !== "win32") return "";
  const command = [
    "$items = Get-NetTCPConnection -LocalPort " + Number(port) + " -ErrorAction SilentlyContinue | Select-Object -First 8 LocalAddress,LocalPort,State,OwningProcess;",
    "$rows = foreach ($item in $items) {",
    "  $proc = Get-Process -Id $item.OwningProcess -ErrorAction SilentlyContinue;",
    "  [PSCustomObject]@{ LocalAddress=$item.LocalAddress; LocalPort=$item.LocalPort; State=$item.State.ToString(); OwningProcess=$item.OwningProcess; ProcessName=$proc.ProcessName; Path=$proc.Path }",
    "};",
    "$rows | ConvertTo-Json -Compress"
  ].join(" ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 3000
  });
  if (result.status !== 0 || !String(result.stdout || "").trim()) return "";
  try {
    const parsed = JSON.parse(String(result.stdout).trim());
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    const owners = [];
    const seen = new Set();
    for (const row of rows) {
      const key = `${row.OwningProcess}:${row.ProcessName || ""}:${row.Path || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      owners.push(`PID ${row.OwningProcess} ${row.ProcessName || "unknown"}${row.Path ? ` (${row.Path})` : ""}`);
    }
    return owners.join("; ");
  } catch {
    return String(result.stdout).trim().replace(/\s+/g, " ");
  }
}

function createNoUsageError(message) {
  const error = new Error(message);
  error.showUsage = false;
  return error;
}

async function assertLaunchPortsAvailable(parsed) {
  const ports = resolveLaunchPorts(parsed);
  const busy = [];
  const seen = new Set();
  for (const item of ports) {
    if (seen.has(item.port)) continue;
    seen.add(item.port);
    if (await isTcpPortOpen(item.port)) {
      busy.push({
        ...item,
        ownerSummary: readPortOwnerSummary(item.port)
      });
    }
  }
  if (busy.length === 0) return;

  const lines = [
    "Cannot launch the DesignEcho debug chat window because required ports are already in use.",
    ...busy.map((item) => [
      `- ${item.label}: ${item.port}`,
      item.ownerSummary ? `  owner: ${item.ownerSummary}` : ""
    ].filter(Boolean).join("\n")),
    "",
    parsed.useDefaultRuntimePorts
      ? "Default runtime ports are already occupied. Close or intentionally switch the existing Agent runtime before launching with --use-default-runtime-ports."
      : "Choose a different --port or --port-offset, or close the existing debug window using those ports."
  ];
  throw createNoUsageError(lines.join("\n"));
}

function runSelfTest() {
  const seeded9223 = parseArgs(["--port", "9223", "--seed-user-state"]);
  const seeded9224 = parseArgs(["--port", "9224", "--seed-user-state"]);
  const autoPort = parseArgs(["--port", "auto"]);
  const defaultRuntime = parseArgs(["--use-default-runtime-ports"]);
  const preflightOnly = parseArgs(["--preflight-only"]);
  const fixedModel = parseArgs([
    "--port",
    "9225",
    "--seed-user-state",
    "--model",
    "codex-subscription-gpt-5-6-sol"
  ]);
  if (autoPort.autoPort !== true || autoPort.port !== 0) {
    throw new Error("--port auto must preserve auto port mode until launch preflight resolves it");
  }
  if (!buildAutoCdpPortCandidates().includes(9223) || !buildAutoCdpPortCandidates().includes(9240)) {
    throw new Error("auto CDP port candidates must cover 9223 through 9240");
  }
  if (preflightOnly.preflightOnly !== true) {
    throw new Error("--preflight-only must be parsed as a launch preflight mode");
  }
  if (defaultRuntime.portOffset !== 0 || defaultRuntime.useDefaultRuntimePorts !== true) {
    throw new Error("--use-default-runtime-ports must force the default runtime port block");
  }
  assertThrows(
    () => parseArgs(["--use-default-runtime-ports", "--port-offset", "20000"]),
    "--use-default-runtime-ports cannot be combined with a non-zero --port-offset."
  );
  assertThrows(
    () => parseArgs(["--model", "codex-subscription-gpt-5-6-sol"]),
    "--model requires --seed-user-state"
  );
  if (fixedModel.modelId !== "codex-subscription-gpt-5-6-sol") {
    throw new Error("--model must preserve the configured model id");
  }
  const modelStateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "designecho-debug-model-"));
  try {
    const modelStatePath = path.join(modelStateRoot, "app-state-store.json");
    fs.writeFileSync(modelStatePath, JSON.stringify({
      "designecho-storage": {
        state: { modelPreferences: { primaryModel: "old-primary", visualModel: "old-visual" } }
      },
      rendererState: {
        modelPreferences: { primaryModel: "old-primary", visualModel: "old-visual" }
      },
      unrelatedSecret: "must-stay-untouched"
    }), "utf8");
    const updatedTargets = overrideSeededModelPreferences(
      modelStatePath,
      fixedModel.modelId
    );
    const updatedState = JSON.parse(fs.readFileSync(modelStatePath, "utf8"));
    if (updatedTargets !== 2
      || updatedState["designecho-storage"].state.modelPreferences.primaryModel !== fixedModel.modelId
      || updatedState["designecho-storage"].state.modelPreferences.visualModel !== fixedModel.modelId
      || updatedState.rendererState.modelPreferences.primaryModel !== fixedModel.modelId
      || updatedState.rendererState.modelPreferences.visualModel !== fixedModel.modelId
      || updatedState.unrelatedSecret !== "must-stay-untouched") {
      throw new Error("isolated model override must update only both model preference projections");
    }
    const sourceState = {
      entries: {
        "designecho-storage": JSON.stringify({
          version: 41,
          state: {
            modelPreferences: {
              primaryModel: "old-primary",
              visualModel: "old-visual",
              debugToken: "nested-secret-must-not-be-copied"
            },
            apiKeys: { openrouter: "secret-must-not-be-copied" },
            conversations: [{ content: "private" }]
          }
        }),
        rendererState: JSON.stringify({
          modelPreferences: { primaryModel: "old-primary", visualModel: "old-visual" },
          apiKeys: { google: "secret-must-not-be-copied" },
          currentProject: { path: "C:/private" }
        }),
        unrelated: "private-entry"
      }
    };
    const safeSeed = buildSanitizedSeedStateStore(sourceState);
    const safeSeedText = JSON.stringify(safeSeed);
    if (!safeSeed
      || safeSeedText.includes("secret-must-not-be-copied")
      || safeSeedText.includes("nested-secret-must-not-be-copied")
      || safeSeedText.includes("conversations")
      || safeSeedText.includes("currentProject")
      || safeSeedText.includes("unrelated")) {
      throw new Error("isolated state seed must retain only credential-free model preferences");
    }
    const explicitProjectRoot = path.join(modelStateRoot, "explicit-fixture");
    fs.mkdirSync(explicitProjectRoot);
    const explicitProjectSeed = buildSanitizedSeedStateStore(sourceState, explicitProjectRoot);
    const explicitProjection = parsePersistedProjection(
      explicitProjectSeed?.entries?.["designecho-storage"]
    );
    const explicitSeedText = JSON.stringify(explicitProjectSeed);
    if (explicitProjection?.state?.currentProject?.path !== path.resolve(explicitProjectRoot)
      || explicitProjection?.state?.recentProjects?.length !== 1
      || explicitProjection.state.recentProjects[0]?.path !== path.resolve(explicitProjectRoot)
      || explicitSeedText.includes("C:/private")
      || explicitSeedText.includes("secret-must-not-be-copied")) {
      throw new Error("an explicit debug project must replace private project state only inside the isolated seed");
    }
  } finally {
    fs.rmSync(modelStateRoot, { recursive: true, force: true });
  }
  const dir9223 = resolveIsolatedUserDataDir(seeded9223);
  const dir9224 = resolveIsolatedUserDataDir(seeded9224);
  if (dir9223 === dir9224) {
    throw new Error("isolated debug userData directories must be port-specific");
  }
  if (!dir9223.endsWith(path.join("designecho-agent-debug-user-data", "window-9223"))) {
    throw new Error(`unexpected userData dir for 9223: ${dir9223}`);
  }
  if (!dir9224.endsWith(path.join("designecho-agent-debug-user-data", "window-9224"))) {
    throw new Error(`unexpected userData dir for 9224: ${dir9224}`);
  }
  assertThrows(
    () => assertSafeDebugUserDataPath(path.resolve(DEBUG_USER_DATA_ROOT, "..", "outside")),
    "outside the OS temporary debug root"
  );
  const reparseTestRoot = fs.mkdtempSync(path.join(os.tmpdir(), "designecho-debug-reparse-test-"));
  const reparseOutside = fs.mkdtempSync(path.join(os.tmpdir(), "designecho-debug-reparse-outside-"));
  try {
    const linkedRoot = path.join(reparseTestRoot, "linked-root");
    fs.symlinkSync(reparseOutside, linkedRoot, process.platform === "win32" ? "junction" : "dir");
    assertThrows(
      () => assertSafeDebugUserDataPath(path.join(linkedRoot, "window-9223"), linkedRoot),
      "symlink, junction, or non-directory"
    );
    const realRoot = path.join(reparseTestRoot, "real-root");
    fs.mkdirSync(realRoot);
    const linkedTarget = path.join(realRoot, "window-9223");
    fs.symlinkSync(reparseOutside, linkedTarget, process.platform === "win32" ? "junction" : "dir");
    assertThrows(
      () => assertSafeDebugUserDataPath(linkedTarget, realRoot),
      "symlink, junction, or non-directory"
    );
  } finally {
    fs.rmSync(reparseTestRoot, { recursive: true, force: true });
    fs.rmSync(reparseOutside, { recursive: true, force: true });
  }
  const isolatedPorts = resolveLaunchPorts(seeded9223).map((item) => item.port);
  if (!isolatedPorts.includes(28768)) {
    throw new Error(`isolated runtime ports must include the offset MCP host port: ${isolatedPorts.join(",")}`);
  }
  const defaultPorts = resolveLaunchPorts(defaultRuntime).map((item) => item.port);
  for (const expectedPort of [8765, 8766, 8767, 8768]) {
    if (!defaultPorts.includes(expectedPort)) {
      throw new Error(`default runtime ports must include ${expectedPort}: ${defaultPorts.join(",")}`);
    }
  }
  console.log("launch-chat-ui-debug-window self-test passed");
}

function assertThrows(fn, expectedMessage) {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(expectedMessage)) return;
    throw new Error(`Expected error containing "${expectedMessage}", got "${message}"`);
  }
  throw new Error(`Expected function to throw "${expectedMessage}"`);
}

function openLogFile(parsed) {
  if (!parsed.logFile) return null;
  const resolvedLogFile = path.resolve(ROOT, parsed.logFile);
  fs.mkdirSync(path.dirname(resolvedLogFile), { recursive: true });
  const stream = fs.createWriteStream(resolvedLogFile, { flags: "a", encoding: "utf8" });
  stream.write(`\n\n[${new Date().toISOString()}] Launching DesignEcho debug chat window\n`);
  return { path: resolvedLogFile, stream };
}

function writeLastLaunchState(parsed, child) {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  fs.writeFileSync(LAST_LAUNCH_JSON, JSON.stringify({
    version: "chat-ui-debug-window-last-launch/v0",
    generatedAt: new Date().toISOString(),
    port: parsed.port,
    cdpEndpoint: `http://127.0.0.1:${parsed.port}`,
    portOffset: parsed.portOffset,
    useDefaultRuntimePorts: parsed.useDefaultRuntimePorts,
    autoPortResolved: Boolean(parsed.autoPortResolved),
    pid: child?.pid || null
  }, null, 2), "utf8");
}

async function main() {
  let parsed = parseArgs(process.argv.slice(2));
  if (parsed.selfTest) {
    runSelfTest();
    return;
  }
  parsed = await resolveAutoCdpPort(parsed);
  await assertLaunchPortsAvailable(parsed);
  if (parsed.preflightOnly) {
    console.log("DesignEcho debug chat window launch preflight passed.");
    if (parsed.autoPortResolved) {
      console.log(`Selected CDP port: ${parsed.port}`);
    }
    console.log(`Runtime port offset: ${parsed.portOffset}`);
    if (parsed.useDefaultRuntimePorts) {
      console.log("Default runtime ports are available for a debug window launch.");
    }
    return;
  }
  ensureBuiltApp();

  const electronBin = resolveElectronBin();
  const log = openLogFile(parsed);
  const launchEnv = buildEnv(parsed);
  const child = spawn(electronBin, [ROOT], {
    cwd: ROOT,
    env: launchEnv,
    stdio: log ? ["ignore", "pipe", "pipe"] : "inherit",
    windowsHide: false
  });
  writeLastLaunchState(parsed, child);

  child.on("exit", () => {
    if (!parsed.isolatedUserData) return;
    const userDataDir = resolveIsolatedUserDataDir(parsed);
    assertSafeDebugUserDataPath(userDataDir);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  if (log) {
    child.stdout?.pipe(log.stream, { end: false });
    child.stderr?.pipe(log.stream, { end: false });
    child.on("exit", () => {
      log.stream.end(`[${new Date().toISOString()}] Electron child exited\n`);
    });
  }

  console.log(`DesignEcho debug chat window launched. cdp=http://127.0.0.1:${parsed.port}`);
  console.log(`Runtime port offset: ${parsed.portOffset}`);
  if (parsed.useDefaultRuntimePorts) {
    console.log("Default runtime ports enabled: this window is the sole DesignEcho runtime owner for live Photoshop validation.");
  }
  if (log) console.log(`Log file: ${log.path}`);
  console.log("Use: node scripts/inspect-chat-ui-running-window.cjs --port " + parsed.port);

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

try {
  main().catch((error) => {
    console.error(error.message);
    if (error.showUsage !== false) {
      console.error("");
      console.error(usage());
    }
    process.exit(1);
  });
} catch (error) {
  console.error(error.message);
  if (error.showUsage !== false) {
    console.error("");
    console.error(usage());
  }
  process.exit(1);
}
