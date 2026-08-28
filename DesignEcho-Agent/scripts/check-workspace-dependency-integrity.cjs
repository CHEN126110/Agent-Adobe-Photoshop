#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function readJsonFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  return JSON.parse(text);
}

function normalizeConstraintList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.length > 0) return [value];
  return [];
}

function matchesRuntimeConstraint(value, currentValue) {
  const constraints = normalizeConstraintList(value);
  if (constraints.length === 0) return true;
  if (constraints.includes("!any") || constraints.includes(`!${currentValue}`)) return false;

  const positive = constraints.filter((item) => !item.startsWith("!"));
  return positive.length === 0
    || positive.includes("any")
    || positive.includes(currentValue);
}

function detectRuntimeLibc(platform) {
  if (platform !== "linux") return null;
  const report = typeof process.report?.getReport === "function"
    ? process.report.getReport()
    : null;
  if (report?.header?.glibcVersionRuntime) return "glibc";
  return "musl";
}

function isPackageApplicable(entry, runtime) {
  if (!matchesRuntimeConstraint(entry.os, runtime.platform)) return false;
  if (!matchesRuntimeConstraint(entry.cpu, runtime.arch)) return false;

  const libcConstraints = normalizeConstraintList(entry.libc);
  if (libcConstraints.length === 0 || runtime.platform !== "linux") return true;
  if (!runtime.libc) return false;
  return matchesRuntimeConstraint(libcConstraints, runtime.libc);
}

function isRequiredInstalledPackage(entry, runtime) {
  if (entry.inBundle === true || !isPackageApplicable(entry, runtime)) return false;
  if (entry.optional !== true) return true;

  // npm 将平台二进制也标为 optional，以便同一 lockfile 跨平台安装。
  // 对当前 OS/CPU/libc 明确适用的 payload，缺失通常会让 SDK、sharp、
  // esbuild 等在运行或构建时才失败，因此开发环境 preflight 必须提前发现。
  return normalizeConstraintList(entry.os).length > 0
    || normalizeConstraintList(entry.cpu).length > 0
    || normalizeConstraintList(entry.libc).length > 0;
}

function collectDirectDependencies(packageJson) {
  return {
    dependencies: { ...(packageJson.dependencies || {}) },
    devDependencies: { ...(packageJson.devDependencies || {}) },
    optionalDependencies: { ...(packageJson.optionalDependencies || {}) },
    peerDependencies: { ...(packageJson.peerDependencies || {}) }
  };
}

function compareDirectDependencyMaps(packageJson, lockRoot, issues) {
  const declared = collectDirectDependencies(packageJson);
  for (const section of Object.keys(declared)) {
    const packageEntries = declared[section];
    const lockEntries = lockRoot[section] || {};
    const names = new Set([
      ...Object.keys(packageEntries),
      ...Object.keys(lockEntries)
    ]);

    for (const name of names) {
      const declaredSpec = packageEntries[name];
      const lockedSpec = lockEntries[name];
      if (declaredSpec === lockedSpec) continue;
      issues.push({
        code: "LOCK_ROOT_MISMATCH",
        packagePath: name,
        detail: `${section}: package.json=${declaredSpec ?? "<missing>"}, package-lock=${lockedSpec ?? "<missing>"}`
      });
    }
  }
}

function packageDirectoryForLockPath(projectRoot, lockPackagePath) {
  const resolved = path.resolve(projectRoot, ...lockPackagePath.split("/"));
  const rootWithSeparator = `${path.resolve(projectRoot)}${path.sep}`;
  if (!resolved.startsWith(rootWithSeparator)) return null;
  return resolved;
}

function readInstalledPackageManifest(packageDirectory, lockPackagePath, issues) {
  const manifestPath = path.join(packageDirectory, "package.json");
  if (!fs.existsSync(manifestPath)) {
    issues.push({
      code: "PACKAGE_MANIFEST_MISSING",
      packagePath: lockPackagePath,
      detail: "安装目录存在，但 package.json 缺失"
    });
    return null;
  }

  try {
    return readJsonFile(manifestPath);
  } catch (error) {
    issues.push({
      code: "PACKAGE_MANIFEST_INVALID",
      packagePath: lockPackagePath,
      detail: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

function inspectRequiredLockPackages(projectRoot, lockJson, runtime, issues) {
  const lockPackages = lockJson.packages || {};
  let requiredPackageCount = 0;
  let installedRequiredPackageCount = 0;

  for (const [lockPackagePath, entry] of Object.entries(lockPackages)) {
    if (!lockPackagePath || entry.inBundle === true) continue;
    const applicable = isPackageApplicable(entry, runtime);
    if (entry.optional !== true && !applicable) {
      issues.push({
        code: "REQUIRED_PACKAGE_PLATFORM_INCOMPATIBLE",
        packagePath: lockPackagePath,
        detail: `当前 ${runtime.platform}/${runtime.arch} 不满足 non-optional lock 记录`
      });
      continue;
    }
    if (!isRequiredInstalledPackage(entry, runtime)) continue;

    requiredPackageCount += 1;
    const packageDirectory = packageDirectoryForLockPath(projectRoot, lockPackagePath);
    if (!packageDirectory) {
      issues.push({
        code: "LOCK_PACKAGE_PATH_ESCAPE",
        packagePath: lockPackagePath,
        detail: "lock location 逃出项目根目录"
      });
      continue;
    }
    if (!fs.existsSync(packageDirectory)) {
      issues.push({
        code: "REQUIRED_PACKAGE_MISSING",
        packagePath: lockPackagePath,
        detail: entry.version ? `lock version ${entry.version}` : "lock package path missing"
      });
      continue;
    }

    installedRequiredPackageCount += 1;
    if (entry.link === true) {
      const stats = fs.lstatSync(packageDirectory);
      const expectedTarget = entry.resolved
        ? path.resolve(projectRoot, entry.resolved)
        : null;
      if (!stats.isSymbolicLink()) {
        issues.push({
          code: "PACKAGE_LINK_INVALID",
          packagePath: lockPackagePath,
          detail: "lock 声明 link=true，但安装路径不是符号链接或 junction"
        });
        continue;
      }
      if (!expectedTarget || !fs.existsSync(expectedTarget)) {
        issues.push({
          code: "PACKAGE_LINK_TARGET_MISSING",
          packagePath: lockPackagePath,
          detail: `lock target ${entry.resolved ?? "<missing>"} 不存在`
        });
        continue;
      }
      if (fs.realpathSync(packageDirectory) !== fs.realpathSync(expectedTarget)) {
        issues.push({
          code: "PACKAGE_LINK_TARGET_MISMATCH",
          packagePath: lockPackagePath,
          detail: `actual=${fs.realpathSync(packageDirectory)}, lock=${fs.realpathSync(expectedTarget)}`
        });
      }
      continue;
    }

    const installedManifest = readInstalledPackageManifest(
      packageDirectory,
      lockPackagePath,
      issues
    );
    if (!installedManifest || !entry.version) continue;
    if (entry.name && installedManifest.name !== entry.name) {
      issues.push({
        code: "PACKAGE_NAME_MISMATCH",
        packagePath: lockPackagePath,
        detail: `installed=${installedManifest.name ?? "<missing>"}, lock=${entry.name}`
      });
    }
    if (installedManifest.version === entry.version) continue;

    issues.push({
      code: "PACKAGE_VERSION_MISMATCH",
      packagePath: lockPackagePath,
      detail: `installed=${installedManifest.version ?? "<missing>"}, lock=${entry.version}`
    });
  }

  return { requiredPackageCount, installedRequiredPackageCount };
}

function normalizeBinEntries(packageName, packageRecord) {
  if (typeof packageRecord.bin === "string") {
    const commandName = packageName.includes("/")
      ? packageName.slice(packageName.lastIndexOf("/") + 1)
      : packageName;
    return [{ commandName, target: packageRecord.bin }];
  }
  if (!packageRecord.bin || typeof packageRecord.bin !== "object") return [];
  return Object.entries(packageRecord.bin).map(([commandName, target]) => ({
    commandName,
    target
  }));
}

function launcherNamesForRuntime(commandName, platform) {
  if (platform === "win32") return [`${commandName}.cmd`, commandName];
  return [commandName];
}

function normalizeLauncherText(value) {
  return value.replaceAll("\\", "/").toLowerCase();
}

function inspectDirectBinLaunchers(projectRoot, packageJson, lockJson, runtime, issues, warnings) {
  const directDependencies = {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {})
  };
  for (const packageName of Object.keys(packageJson.optionalDependencies || {})) {
    const entry = lockJson.packages?.[`node_modules/${packageName}`];
    if (entry && isRequiredInstalledPackage(entry, runtime)) {
      directDependencies[packageName] = packageJson.optionalDependencies[packageName];
    }
  }
  const commandOwners = new Map();

  for (const packageName of Object.keys(directDependencies)) {
    const lockPackagePath = `node_modules/${packageName}`;
    const lockEntry = lockJson.packages?.[lockPackagePath];
    const packageDirectory = packageDirectoryForLockPath(
      projectRoot,
      lockPackagePath
    );
    if (!lockEntry || !packageDirectory || !fs.existsSync(packageDirectory)) continue;

    for (const binEntry of normalizeBinEntries(packageName, lockEntry)) {
      if (typeof binEntry.target !== "string" || binEntry.target.length === 0) continue;
      if (binEntry.commandName.includes("/") || binEntry.commandName.includes("\\")) {
        issues.push({
          code: "DIRECT_BIN_COMMAND_INVALID",
          packagePath: `${lockPackagePath}:${binEntry.commandName}`,
          detail: "CLI 命令名不能包含路径分隔符"
        });
        continue;
      }
      const targetPath = path.resolve(packageDirectory, ...binEntry.target.split("/"));
      const packageRootWithSeparator = `${packageDirectory}${path.sep}`;
      if (!targetPath.startsWith(packageRootWithSeparator)) {
        issues.push({
          code: "DIRECT_BIN_TARGET_ESCAPE",
          packagePath: `${lockPackagePath}/${binEntry.target}`,
          detail: `CLI ${binEntry.commandName} 的 target 逃出包目录`
        });
        continue;
      }
      if (!fs.existsSync(targetPath)) {
        issues.push({
          code: "DIRECT_BIN_TARGET_MISSING",
          packagePath: `${lockPackagePath}/${binEntry.target}`,
          detail: `CLI ${binEntry.commandName} 的 lock target 不存在`
        });
      }
      const owners = commandOwners.get(binEntry.commandName) || [];
      owners.push({ packageName, target: binEntry.target });
      commandOwners.set(binEntry.commandName, owners);
    }
  }

  for (const [commandName, owners] of commandOwners) {
    if (owners.length > 1) {
      warnings.push({
        code: "DIRECT_BIN_OWNER_CONFLICT",
        packagePath: `node_modules/.bin/${commandName}`,
        detail: owners.map((owner) => owner.packageName).join(", ")
      });
    }

    for (const launcherName of launcherNamesForRuntime(commandName, runtime.platform)) {
      const launcherPath = path.join(projectRoot, "node_modules", ".bin", launcherName);
      if (!fs.existsSync(launcherPath) || fs.statSync(launcherPath).size === 0) {
        issues.push({
          code: "DIRECT_BIN_LAUNCHER_MISSING",
          packagePath: `node_modules/.bin/${launcherName}`,
          detail: "直接依赖声明了 CLI，但 npm 启动器缺失或为空"
        });
        continue;
      }

      const launcherText = normalizeLauncherText(fs.readFileSync(launcherPath, "utf8"));
      const pointsToKnownOwner = owners.some((owner) => {
        const expected = normalizeLauncherText(`../${owner.packageName}/${owner.target}`);
        return launcherText.includes(expected);
      });
      if (pointsToKnownOwner) continue;
      issues.push({
        code: "DIRECT_BIN_LAUNCHER_STALE",
        packagePath: `node_modules/.bin/${launcherName}`,
        detail: `启动器没有指向当前 lock 的 ${owners.map((owner) => owner.packageName).join(" / ")}`
      });
    }
  }

  return { directBinCount: commandOwners.size };
}

function inspectProjectDependencies(options) {
  const projectRoot = path.resolve(options.projectRoot);
  const runtime = {
    platform: options.platform || process.platform,
    arch: options.arch || process.arch,
    libc: options.libc === undefined
      ? detectRuntimeLibc(options.platform || process.platform)
      : options.libc
  };
  const report = {
    label: options.label || path.basename(projectRoot),
    projectRoot,
    ok: false,
    requiredPackageCount: 0,
    installedRequiredPackageCount: 0,
    directBinCount: 0,
    issues: [],
    warnings: []
  };
  const packagePath = path.join(projectRoot, "package.json");
  const lockPath = path.join(projectRoot, "package-lock.json");
  const nodeModulesPath = path.join(projectRoot, "node_modules");

  for (const requiredPath of [packagePath, lockPath, nodeModulesPath]) {
    if (fs.existsSync(requiredPath)) continue;
    report.issues.push({
      code: "PROJECT_DEPENDENCY_INPUT_MISSING",
      packagePath: path.relative(projectRoot, requiredPath),
      detail: "依赖完整性检查所需路径不存在"
    });
  }
  if (report.issues.length > 0) return report;

  let packageJson;
  let lockJson;
  try {
    packageJson = readJsonFile(packagePath);
    lockJson = readJsonFile(lockPath);
  } catch (error) {
    report.issues.push({
      code: "PROJECT_DEPENDENCY_JSON_INVALID",
      packagePath: "package.json/package-lock.json",
      detail: error instanceof Error ? error.message : String(error)
    });
    return report;
  }

  if (!Number.isInteger(lockJson.lockfileVersion) || lockJson.lockfileVersion < 2) {
    report.issues.push({
      code: "LOCKFILE_VERSION_UNSUPPORTED",
      packagePath: "package-lock.json",
      detail: `lockfileVersion=${lockJson.lockfileVersion ?? "<missing>"}`
    });
    return report;
  }
  if (!lockJson.packages || !lockJson.packages[""]) {
    report.issues.push({
      code: "LOCK_ROOT_MISSING",
      packagePath: "package-lock.json",
      detail: "packages[\"\"] 缺失"
    });
    return report;
  }

  const lockRoot = lockJson.packages[""];
  for (const field of ["name", "version"]) {
    const declaredValue = packageJson[field];
    const lockedValue = lockRoot[field];
    if (declaredValue === lockedValue) continue;
    report.issues.push({
      code: "LOCK_ROOT_IDENTITY_MISMATCH",
      packagePath: field,
      detail: `package.json=${declaredValue ?? "<missing>"}, package-lock=${lockedValue ?? "<missing>"}`
    });
  }

  compareDirectDependencyMaps(packageJson, lockRoot, report.issues);
  const packageCounts = inspectRequiredLockPackages(
    projectRoot,
    lockJson,
    runtime,
    report.issues
  );
  const binCounts = inspectDirectBinLaunchers(
    projectRoot,
    packageJson,
    lockJson,
    runtime,
    report.issues,
    report.warnings
  );

  report.requiredPackageCount = packageCounts.requiredPackageCount;
  report.installedRequiredPackageCount = packageCounts.installedRequiredPackageCount;
  report.directBinCount = binCounts.directBinCount;
  report.ok = report.issues.length === 0;
  return report;
}

function inspectWorkspaceDependencies(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.resolve(__dirname, "..", ".."));
  const projects = options.projects || [
    { label: "DesignEcho-Agent", projectRoot: path.join(repoRoot, "DesignEcho-Agent") },
    { label: "DesignEcho-UXP", projectRoot: path.join(repoRoot, "DesignEcho-UXP") }
  ];
  const reports = projects.map((project) => inspectProjectDependencies({
    ...project,
    platform: options.platform,
    arch: options.arch,
    libc: options.libc
  }));
  return {
    ok: reports.every((report) => report.ok),
    runtime: {
      platform: options.platform || process.platform,
      arch: options.arch || process.arch
    },
    reports
  };
}

function formatWorkspaceReport(workspaceReport) {
  const lines = [];
  for (const report of workspaceReport.reports) {
    lines.push(
      `[dependency-integrity] ${report.label}: ${report.ok ? "通过" : "失败"}`
      + `（required ${report.installedRequiredPackageCount}/${report.requiredPackageCount}, direct bins ${report.directBinCount}）`
    );
    for (const issue of report.issues) {
      lines.push(`  - ${issue.code} ${issue.packagePath}: ${issue.detail}`);
    }
    for (const warning of report.warnings) {
      lines.push(`  - [warning] ${warning.code} ${warning.packagePath}: ${warning.detail}`);
    }
  }
  if (!workspaceReport.ok) {
    lines.push("[dependency-integrity] 已在重型验证前停止。请先关闭可能锁定 node_modules 的应用，再按当前 lockfile 修复依赖；本检查不会自动安装或改写文件。");
  }
  return lines.join("\n");
}

function main() {
  const report = inspectWorkspaceDependencies();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatWorkspaceReport(report));
  }
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  formatWorkspaceReport,
  inspectProjectDependencies,
  inspectWorkspaceDependencies,
  isPackageApplicable,
  isRequiredInstalledPackage,
  matchesRuntimeConstraint,
  normalizeBinEntries
};
