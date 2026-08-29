"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PHOTOSHOP_RUNTIME_LEASE_VERSION = "design-reliability-photoshop-runtime-lease/v1";
const PHOTOSHOP_RUNTIME_LEASE_FILE = "photoshop-runtime-lease.json";
const PHOTOSHOP_RUNTIME_LEASE_CONFLICT = "photoshop_runtime_lease_active";
const MIN_LEASE_TTL_MS = 10_000;
const MAX_LEASE_TTL_MS = 45 * 60 * 1000;
const RECENT_INVALID_LEASE_GRACE_MS = 5_000;
const LEASE_PURPOSES = new Set([
  "formal_capture",
  "uxp_loader"
]);

function cleanText(value, limit = 240) {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function cleanPath(value) {
  return typeof value === "string" ? value.trim() : "";
}

function resolveDesignReliabilityDataRoot(options = {}) {
  const platform = cleanText(options.platform || process.platform, 40);
  const environment = options.environment || process.env;
  const homeDirectory = cleanPath(options.homeDirectory || os.homedir());
  if (platform === "win32") {
    const appData = cleanPath(environment.APPDATA);
    const base = appData || path.join(homeDirectory, "AppData", "Roaming");
    return path.resolve(base, "designecho-agent", "design-reliability");
  }
  if (platform === "darwin") {
    return path.resolve(
      homeDirectory,
      "Library",
      "Application Support",
      "designecho-agent",
      "design-reliability"
    );
  }
  const xdgConfigHome = cleanPath(environment.XDG_CONFIG_HOME);
  const base = xdgConfigHome || path.join(homeDirectory, ".config");
  return path.resolve(base, "designecho-agent", "design-reliability");
}

function resolvePhotoshopRuntimeLeasePath(options = {}) {
  const dataRoot = cleanPath(options.dataRoot)
    ? path.resolve(options.dataRoot)
    : resolveDesignReliabilityDataRoot(options);
  return path.join(dataRoot, PHOTOSHOP_RUNTIME_LEASE_FILE);
}

function normalizeNowMs(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric) : Date.now();
}

function normalizeLeaseTtlMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 60_000;
  return Math.max(MIN_LEASE_TTL_MS, Math.min(MAX_LEASE_TTL_MS, Math.round(numeric)));
}

function isCanonicalIsoTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isValidLeaseRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const expectedKeys = [
    "acquiredAt",
    "boundaries",
    "expiresAt",
    "leaseId",
    "ownerId",
    "ownerPid",
    "ownerProcessStartedAt",
    "purpose",
    "version"
  ];
  if (keys.length !== expectedKeys.length
    || keys.some((key, index) => key !== expectedKeys[index])) return false;
  if (value.version !== PHOTOSHOP_RUNTIME_LEASE_VERSION
    || !LEASE_PURPOSES.has(value.purpose)
    || typeof value.leaseId !== "string"
    || !/^[0-9a-f-]{36}$/i.test(value.leaseId)
    || typeof value.ownerId !== "string"
    || !value.ownerId.trim()
    || value.ownerId.length > 240
    || !Number.isSafeInteger(value.ownerPid)
    || value.ownerPid < 1
    || !isCanonicalIsoTimestamp(value.ownerProcessStartedAt)
    || !isCanonicalIsoTimestamp(value.acquiredAt)
    || !isCanonicalIsoTimestamp(value.expiresAt)
    || Date.parse(value.ownerProcessStartedAt) > Date.parse(value.acquiredAt)
    || Date.parse(value.acquiredAt) >= Date.parse(value.expiresAt)) return false;
  const boundaries = value.boundaries;
  return Boolean(
    boundaries
    && typeof boundaries === "object"
    && !Array.isArray(boundaries)
    && Object.keys(boundaries).length === 3
    && boundaries.developmentOnly === true
    && boundaries.doesNotGrantPhotoshopPermission === true
    && boundaries.doesNotChooseDesign === true
  );
}

function probeProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function inspectPhotoshopRuntimeLease(options = {}) {
  const leasePath = resolvePhotoshopRuntimeLeasePath(options);
  if (!fs.existsSync(leasePath)) {
    return {
      status: "absent",
      leasePath
    };
  }

  const nowMs = normalizeNowMs(options.nowMs);
  let stat;
  let parsed;
  try {
    stat = fs.statSync(leasePath);
    parsed = JSON.parse(fs.readFileSync(leasePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        status: "absent",
        leasePath
      };
    }
    const ageMs = stat ? Math.max(0, nowMs - stat.mtimeMs) : 0;
    return {
      status: ageMs < RECENT_INVALID_LEASE_GRACE_MS ? "active_unknown" : "stale",
      leasePath,
      reason: "lease_record_unreadable",
      ageMs,
      fileIdentity: stat ? { mtimeMs: stat.mtimeMs, size: stat.size } : undefined
    };
  }

  if (!isValidLeaseRecord(parsed)) {
    const ageMs = Math.max(0, nowMs - stat.mtimeMs);
    return {
      status: ageMs < RECENT_INVALID_LEASE_GRACE_MS ? "active_unknown" : "stale",
      leasePath,
      reason: "lease_record_invalid",
      ageMs,
      fileIdentity: { mtimeMs: stat.mtimeMs, size: stat.size }
    };
  }

  const processAlive = typeof options.processAlive === "function"
    ? options.processAlive
    : probeProcessAlive;
  const expired = Date.parse(parsed.expiresAt) <= nowMs;
  const ownerAlive = processAlive(parsed.ownerPid) === true;
  if (ownerAlive) {
    return {
      status: "active",
      leasePath,
      lease: parsed,
      ownerAlive: true,
      expired
    };
  }
  return {
    status: "stale",
    leasePath,
    lease: parsed,
    ownerAlive,
    expired,
    reason: "lease_owner_not_alive"
  };
}

function buildLeaseConflictError(inspection) {
  const lease = inspection.lease;
  const owner = lease
    ? `${lease.purpose}:${lease.ownerId}:pid=${lease.ownerPid}:expires=${lease.expiresAt}`
    : "lease_record_being_committed";
  const error = new Error(
    `${PHOTOSHOP_RUNTIME_LEASE_CONFLICT}: Photoshop Runtime 正由 ${owner} 独占；`
    + "当前操作不会替换 UXP，请等待持有者结束。"
  );
  error.code = PHOTOSHOP_RUNTIME_LEASE_CONFLICT;
  error.lease = lease;
  return error;
}

function removeStaleLease(inspection) {
  if (inspection.status !== "stale") return false;
  try {
    if (inspection.lease) {
      const current = JSON.parse(fs.readFileSync(inspection.leasePath, "utf8"));
      if (!isValidLeaseRecord(current)
        || current.leaseId !== inspection.lease.leaseId) return false;
    } else if (inspection.fileIdentity) {
      const currentStat = fs.statSync(inspection.leasePath);
      if (currentStat.mtimeMs !== inspection.fileIdentity.mtimeMs
        || currentStat.size !== inspection.fileIdentity.size) return false;
    } else {
      return false;
    }
    fs.unlinkSync(inspection.leasePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
}

function acquirePhotoshopRuntimeLease(options = {}) {
  const purpose = cleanText(options.purpose, 80);
  const ownerId = cleanText(options.ownerId, 240);
  if (!LEASE_PURPOSES.has(purpose)) {
    throw new Error(`非法 Photoshop Runtime lease purpose：${purpose || "empty"}`);
  }
  if (!ownerId) throw new Error("Photoshop Runtime lease 缺少 ownerId。");

  const leasePath = resolvePhotoshopRuntimeLeasePath(options);
  fs.mkdirSync(path.dirname(leasePath), { recursive: true });
  const nowMs = normalizeNowMs(options.nowMs);
  const ttlMs = normalizeLeaseTtlMs(options.ttlMs);
  const ownerPid = Number.isSafeInteger(options.ownerPid) && options.ownerPid > 0
    ? options.ownerPid
    : process.pid;
  const processStartedAtMs = Number.isFinite(Number(options.ownerProcessStartedAtMs))
    ? Math.round(Number(options.ownerProcessStartedAtMs))
    : Math.max(0, nowMs - Math.round(process.uptime() * 1000));
  const lease = {
    version: PHOTOSHOP_RUNTIME_LEASE_VERSION,
    purpose,
    leaseId: crypto.randomUUID(),
    ownerId,
    ownerPid,
    ownerProcessStartedAt: new Date(Math.min(processStartedAtMs, nowMs)).toISOString(),
    acquiredAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
    boundaries: {
      developmentOnly: true,
      doesNotGrantPhotoshopPermission: true,
      doesNotChooseDesign: true
    }
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const inspection = inspectPhotoshopRuntimeLease({
      ...options,
      dataRoot: path.dirname(leasePath),
      nowMs
    });
    if (inspection.status === "active" || inspection.status === "active_unknown") {
      throw buildLeaseConflictError(inspection);
    }
    if (inspection.status === "stale") removeStaleLease(inspection);

    let descriptor;
    try {
      descriptor = fs.openSync(leasePath, "wx", 0o600);
      fs.writeFileSync(descriptor, `${JSON.stringify(lease, null, 2)}\n`, "utf8");
      fs.fsyncSync(descriptor);
      return {
        leasePath,
        lease
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }
  throw buildLeaseConflictError(inspectPhotoshopRuntimeLease({
    ...options,
    dataRoot: path.dirname(leasePath),
    nowMs
  }));
}

function releasePhotoshopRuntimeLease(handle) {
  const leasePath = cleanPath(handle?.leasePath);
  const leaseId = cleanText(handle?.lease?.leaseId || handle?.leaseId, 80);
  if (!leasePath || !leaseId) {
    return { released: false, reason: "lease_handle_invalid" };
  }
  if (!fs.existsSync(leasePath)) {
    return { released: false, reason: "lease_already_absent" };
  }
  let current;
  try {
    current = JSON.parse(fs.readFileSync(leasePath, "utf8"));
  } catch {
    return { released: false, reason: "lease_record_unreadable" };
  }
  if (!isValidLeaseRecord(current) || current.leaseId !== leaseId) {
    return { released: false, reason: "lease_owner_mismatch" };
  }
  try {
    fs.unlinkSync(leasePath);
    return { released: true, reason: "released" };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { released: false, reason: "lease_already_absent" };
    }
    return {
      released: false,
      reason: `lease_release_failed:${cleanText(error?.message || error, 180)}`
    };
  }
}

module.exports = {
  MAX_LEASE_TTL_MS,
  PHOTOSHOP_RUNTIME_LEASE_CONFLICT,
  PHOTOSHOP_RUNTIME_LEASE_VERSION,
  acquirePhotoshopRuntimeLease,
  inspectPhotoshopRuntimeLease,
  isValidLeaseRecord,
  releasePhotoshopRuntimeLease,
  resolveDesignReliabilityDataRoot,
  resolvePhotoshopRuntimeLeasePath
};
