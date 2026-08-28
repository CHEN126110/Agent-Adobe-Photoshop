#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  formatWorkspaceReport,
  inspectProjectDependencies,
  inspectWorkspaceDependencies,
  isPackageApplicable,
  isRequiredInstalledPackage,
  matchesRuntimeConstraint,
  normalizeBinEntries
} = require("./check-workspace-dependency-integrity.cjs");

const tempRoots = [];

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, "utf8");
}

function createProjectFixture(options = {}) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "designecho-deps-"));
  tempRoots.push(projectRoot);
  const packageJson = options.packageJson || {
    name: "fixture",
    version: "1.0.0",
    dependencies: { alpha: "1.0.0" },
    devDependencies: { tool: "2.0.0" }
  };
  const lockJson = options.lockJson || {
    name: "fixture",
    lockfileVersion: 3,
    packages: {
      "": {
        name: "fixture",
        version: "1.0.0",
        dependencies: { alpha: "1.0.0" },
        devDependencies: { tool: "2.0.0" }
      },
      "node_modules/alpha": { version: "1.0.0" },
      "node_modules/tool": { version: "2.0.0", bin: { tool: "bin/tool.js" } },
      "node_modules/optional-native": { version: "3.0.0", optional: true },
      "node_modules/current-platform-payload": {
        version: "3.1.0",
        optional: true,
        os: ["win32"],
        cpu: ["x64"]
      },
      "node_modules/darwin-only": { version: "4.0.0", optional: true, os: ["darwin"] },
      "node_modules/nested/node_modules/required-child": { version: "5.0.0" }
    }
  };
  writeJson(path.join(projectRoot, "package.json"), packageJson);
  writeJson(path.join(projectRoot, "package-lock.json"), lockJson);
  writeJson(path.join(projectRoot, "node_modules", "alpha", "package.json"), {
    name: "alpha",
    version: "1.0.0"
  });
  writeJson(path.join(projectRoot, "node_modules", "tool", "package.json"), {
    name: "tool",
    version: "2.0.0",
    bin: { tool: "bin/tool.js" }
  });
  writeText(path.join(projectRoot, "node_modules", "tool", "bin", "tool.js"), "#!/usr/bin/env node\n");
  writeJson(
    path.join(projectRoot, "node_modules", "current-platform-payload", "package.json"),
    { name: "current-platform-payload", version: "3.1.0" }
  );
  writeJson(
    path.join(projectRoot, "node_modules", "nested", "node_modules", "required-child", "package.json"),
    { name: "required-child", version: "5.0.0" }
  );
  writeText(
    path.join(projectRoot, "node_modules", ".bin", "tool.cmd"),
    "@echo off\r\nnode \"%~dp0%\\..\\tool\\bin\\tool.js\" %*\r\n"
  );
  writeText(
    path.join(projectRoot, "node_modules", ".bin", "tool"),
    "#!/bin/sh\nnode \"$basedir/../tool/bin/tool.js\" \"$@\"\n"
  );
  return projectRoot;
}

function issueCodes(report) {
  return report.issues.map((issue) => issue.code);
}

function runCase(name, fn) {
  fn();
  console.log(`✅ ${name}`);
}

function cleanup() {
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function main() {
  try {
    runCase("平台约束支持 allow、deny 与无约束", () => {
      assert.strictEqual(matchesRuntimeConstraint(undefined, "win32"), true);
      assert.strictEqual(matchesRuntimeConstraint(["win32", "linux"], "win32"), true);
      assert.strictEqual(matchesRuntimeConstraint(["!win32"], "win32"), false);
      assert.strictEqual(matchesRuntimeConstraint(["!darwin"], "win32"), true);
    });

    runCase("OS/CPU 不适用包在当前平台不构成 required 缺口", () => {
      assert.strictEqual(isPackageApplicable({ os: ["darwin"] }, {
        platform: "win32", arch: "x64", libc: null
      }), false);
      assert.strictEqual(isRequiredInstalledPackage({
        optional: true,
        os: ["win32"],
        cpu: ["x64"]
      }, {
        platform: "win32", arch: "x64", libc: null
      }), true);
      assert.strictEqual(isRequiredInstalledPackage({ optional: true }, {
        platform: "win32", arch: "x64", libc: null
      }), false);
      assert.strictEqual(isPackageApplicable({ cpu: ["arm64"] }, {
        platform: "win32", arch: "x64", libc: null
      }), false);
    });

    runCase("bin 字符串和映射都能生成命令身份", () => {
      assert.deepStrictEqual(normalizeBinEntries("@scope/tool", { bin: "cli.js" }), [
        { commandName: "tool", target: "cli.js" }
      ]);
      assert.deepStrictEqual(normalizeBinEntries("tool", { bin: { one: "a.js", two: "b.js" } }), [
        { commandName: "one", target: "a.js" },
        { commandName: "two", target: "b.js" }
      ]);
    });

    runCase("完整 fixture 同时通过嵌套包、optional 与 Windows bin 检查", () => {
      const projectRoot = createProjectFixture();
      const report = inspectProjectDependencies({
        label: "fixture",
        projectRoot,
        platform: "win32",
        arch: "x64",
        libc: null
      });
      assert.strictEqual(report.ok, true, formatWorkspaceReport({ reports: [report] }));
      assert.strictEqual(report.requiredPackageCount, 4);
      assert.strictEqual(report.installedRequiredPackageCount, 4);
      assert.strictEqual(report.directBinCount, 1);
    });

    runCase("一次检查聚合全部 required 缺包而不是只报告第一项", () => {
      const projectRoot = createProjectFixture();
      fs.rmSync(path.join(projectRoot, "node_modules", "alpha"), { recursive: true });
      fs.rmSync(
        path.join(projectRoot, "node_modules", "nested", "node_modules", "required-child"),
        { recursive: true }
      );
      const report = inspectProjectDependencies({
        projectRoot,
        platform: "win32",
        arch: "x64",
        libc: null
      });
      const missing = report.issues.filter((issue) => issue.code === "REQUIRED_PACKAGE_MISSING");
      assert.strictEqual(missing.length, 2);
      assert(missing.some((issue) => issue.packagePath === "node_modules/alpha"));
      assert(missing.some((issue) => issue.packagePath.endsWith("required-child")));
    });

    runCase("optional 与当前平台不适用包缺失不会制造假失败", () => {
      const projectRoot = createProjectFixture();
      const report = inspectProjectDependencies({
        projectRoot,
        platform: "win32",
        arch: "x64",
        libc: null
      });
      assert(!report.issues.some((issue) => issue.packagePath.includes("optional-native")));
      assert(!report.issues.some((issue) => issue.packagePath.includes("darwin-only")));
    });

    runCase("当前平台 optional 二进制缺失会在 SDK 或构建启动前失败", () => {
      const projectRoot = createProjectFixture();
      fs.rmSync(
        path.join(projectRoot, "node_modules", "current-platform-payload"),
        { recursive: true }
      );
      const report = inspectProjectDependencies({
        projectRoot,
        platform: "win32",
        arch: "x64",
        libc: null
      });
      const missing = report.issues.find((issue) => (
        issue.code === "REQUIRED_PACKAGE_MISSING"
        && issue.packagePath.endsWith("current-platform-payload")
      ));
      assert(missing);
    });

    runCase("安装版本与 lock 不一致时明确失败", () => {
      const projectRoot = createProjectFixture();
      writeJson(path.join(projectRoot, "node_modules", "alpha", "package.json"), {
        name: "alpha",
        version: "9.9.9"
      });
      const report = inspectProjectDependencies({
        projectRoot,
        platform: "win32",
        arch: "x64",
        libc: null
      });
      assert(issueCodes(report).includes("PACKAGE_VERSION_MISMATCH"));
    });

    runCase("直接依赖 CLI 缺 Windows 启动器时在重型验证前失败", () => {
      const projectRoot = createProjectFixture();
      fs.rmSync(path.join(projectRoot, "node_modules", ".bin", "tool.cmd"));
      const report = inspectProjectDependencies({
        projectRoot,
        platform: "win32",
        arch: "x64",
        libc: null
      });
      assert(issueCodes(report).includes("DIRECT_BIN_LAUNCHER_MISSING"));
    });

    runCase("CLI 的 lock target 缺失时不能被旧启动器冒充完整", () => {
      const projectRoot = createProjectFixture();
      fs.rmSync(path.join(projectRoot, "node_modules", "tool", "bin", "tool.js"));
      const report = inspectProjectDependencies({
        projectRoot,
        platform: "win32",
        arch: "x64",
        libc: null
      });
      assert(issueCodes(report).includes("DIRECT_BIN_TARGET_MISSING"));
    });

    runCase("残留启动器没有指向当前 lock owner 时明确失败", () => {
      const projectRoot = createProjectFixture();
      writeText(
        path.join(projectRoot, "node_modules", ".bin", "tool.cmd"),
        "@echo off\r\nnode \"%~dp0%\\..\\old-tool\\bin\\tool.js\" %*\r\n"
      );
      writeText(
        path.join(projectRoot, "node_modules", ".bin", "tool"),
        "#!/bin/sh\nnode \"$basedir/../old-tool/bin/tool.js\" \"$@\"\n"
      );
      const report = inspectProjectDependencies({
        projectRoot,
        platform: "win32",
        arch: "x64",
        libc: null
      });
      assert.strictEqual(
        report.issues.filter((issue) => issue.code === "DIRECT_BIN_LAUNCHER_STALE").length,
        2
      );
    });

    runCase("package.json 与 lock 根声明漂移时明确列出字段", () => {
      const projectRoot = createProjectFixture();
      const packagePath = path.join(projectRoot, "package.json");
      const packageJson = readFixtureJson(packagePath);
      packageJson.dependencies.alpha = "^2.0.0";
      writeJson(packagePath, packageJson);
      const report = inspectProjectDependencies({
        projectRoot,
        platform: "win32",
        arch: "x64",
        libc: null
      });
      const mismatch = report.issues.find((issue) => issue.code === "LOCK_ROOT_MISMATCH");
      assert(mismatch);
      assert(mismatch.detail.includes("package.json=^2.0.0"));
      assert(mismatch.detail.includes("package-lock=1.0.0"));
    });

    runCase("non-optional lock 节点与当前平台冲突时报告锁树问题", () => {
      const projectRoot = createProjectFixture();
      const lockPath = path.join(projectRoot, "package-lock.json");
      const lockJson = readFixtureJson(lockPath);
      lockJson.packages["node_modules/impossible"] = {
        version: "1.0.0",
        os: ["darwin"]
      };
      writeJson(lockPath, lockJson);
      const report = inspectProjectDependencies({
        projectRoot,
        platform: "win32",
        arch: "x64",
        libc: null
      });
      assert(issueCodes(report).includes("REQUIRED_PACKAGE_PLATFORM_INCOMPATIBLE"));
    });

    runCase("恶意 lock location 不能逃出项目根目录", () => {
      const projectRoot = createProjectFixture();
      const lockPath = path.join(projectRoot, "package-lock.json");
      const lockJson = readFixtureJson(lockPath);
      lockJson.packages["../escaped-package"] = { version: "1.0.0" };
      writeJson(lockPath, lockJson);
      const report = inspectProjectDependencies({
        projectRoot,
        platform: "win32",
        arch: "x64",
        libc: null
      });
      assert(issueCodes(report).includes("LOCK_PACKAGE_PATH_ESCAPE"));
    });

    runCase("根 name/version 漂移与损坏 JSON 都不会进入重型验证", () => {
      const identityRoot = createProjectFixture();
      const identityPackagePath = path.join(identityRoot, "package.json");
      const identityPackage = readFixtureJson(identityPackagePath);
      identityPackage.version = "2.0.0";
      writeJson(identityPackagePath, identityPackage);
      const identityReport = inspectProjectDependencies({
        projectRoot: identityRoot,
        platform: "win32",
        arch: "x64",
        libc: null
      });
      assert(issueCodes(identityReport).includes("LOCK_ROOT_IDENTITY_MISMATCH"));

      const corruptRoot = createProjectFixture();
      writeText(path.join(corruptRoot, "package-lock.json"), "{not-json\n");
      const corruptReport = inspectProjectDependencies({
        projectRoot: corruptRoot,
        platform: "win32",
        arch: "x64",
        libc: null
      });
      assert(issueCodes(corruptReport).includes("PROJECT_DEPENDENCY_JSON_INVALID"));
    });

    runCase("bin target 不能通过 .. 逃出所属包目录", () => {
      const projectRoot = createProjectFixture();
      const lockPath = path.join(projectRoot, "package-lock.json");
      const lockJson = readFixtureJson(lockPath);
      lockJson.packages["node_modules/tool"].bin.tool = "../alpha/package.json";
      writeJson(lockPath, lockJson);
      const report = inspectProjectDependencies({
        projectRoot,
        platform: "win32",
        arch: "x64",
        libc: null
      });
      assert(issueCodes(report).includes("DIRECT_BIN_TARGET_ESCAPE"));
    });

    runCase("工作区同时汇总 Agent 与 UXP 报告", () => {
      const first = createProjectFixture();
      const second = createProjectFixture();
      fs.rmSync(path.join(second, "node_modules", "alpha"), { recursive: true });
      const workspace = inspectWorkspaceDependencies({
        projects: [
          { label: "Agent", projectRoot: first },
          { label: "UXP", projectRoot: second }
        ],
        platform: "win32",
        arch: "x64",
        libc: null
      });
      assert.strictEqual(workspace.ok, false);
      assert.strictEqual(workspace.reports.length, 2);
      assert.strictEqual(workspace.reports[0].ok, true);
      assert.strictEqual(workspace.reports[1].ok, false);
      assert(formatWorkspaceReport(workspace).includes("重型验证前停止"));
    });

    console.log("\n工作区依赖完整性契约验证通过（17 项）。");
  } finally {
    cleanup();
  }
}

function readFixtureJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

main();
