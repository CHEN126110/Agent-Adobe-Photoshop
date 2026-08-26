#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..");
const agentRoot = path.join(repoRoot, "DesignEcho-Agent");
const uxpRoot = path.join(repoRoot, "DesignEcho-UXP");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const COMMANDS = [
  { label: "规划一致性", cwd: agentRoot, args: ["run", "maintenance:planning-check"] },
  { label: "仓库卫生", cwd: agentRoot, args: ["run", "maintenance:repo-hygiene:check"] },
  { label: "中文编码", cwd: agentRoot, args: ["run", "check:repository-encoding"] },
  { label: "入口文档同步", cwd: agentRoot, args: ["run", "audit:entry-doc-sync"] },
  { label: "工具注册表", cwd: agentRoot, args: ["run", "audit:tools"] },
  { label: "Handler 注册", cwd: agentRoot, args: ["run", "audit:handlers"] },
  { label: "Skill 声明", cwd: agentRoot, args: ["run", "audit:skill-standard"] },
  { label: "通用执行器", cwd: agentRoot, args: ["run", "audit:executor-generic"] },
  { label: "Agent 简化棘轮", cwd: agentRoot, args: ["run", "audit:simplification-ratchet"] },
  { label: "业务边界", cwd: agentRoot, args: ["run", "audit:agent-business-boundaries"] },
  { label: "能力解析", cwd: agentRoot, args: ["run", "audit:capability-resolver"] },
  { label: "Agent 模型用途与多模态边界", cwd: agentRoot, args: ["run", "test:model-usage-classification"] },
  { label: "二进制图像内存边界", cwd: agentRoot, args: ["run", "test:binary-message-store"] },
  { label: "Agent 上下文事实保持", cwd: agentRoot, args: ["run", "test:agent-context-manager"] },
  { label: "Skill 包契约", cwd: agentRoot, args: ["run", "audit:skill-package-contract"] },
  { label: "Runtime 声明解析", cwd: agentRoot, args: ["run", "audit:runtime-declaration"] },
  { label: "Prompt 能力治理", cwd: agentRoot, args: ["run", "audit:prompt-capability-governance"] },
  { label: "门禁定义手册", cwd: agentRoot, args: ["run", "audit:gates"] },
  { label: "三态能力折叠", cwd: agentRoot, args: ["run", "audit:tristate-collapse"] },
  { label: "品类词条库", cwd: agentRoot, args: ["run", "audit:category-terms"] },
  { label: "Design Intelligence 契约", cwd: agentRoot, args: ["run", "audit:design-intelligence"] },
  { label: "命题状态机", cwd: agentRoot, args: ["run", "test:proposition-ledger"] },
  { label: "Intelligence 持久化", cwd: agentRoot, args: ["run", "test:intelligence-stores"] },
  { label: "设计作者权边界", cwd: agentRoot, args: ["run", "test:design-authorship-boundary"] },
  { label: "一次成稿设计稿契约", cwd: agentRoot, args: ["run", "test:compose-design-spec"] },
  { label: "设计任务卡", cwd: agentRoot, args: ["run", "test:design-task-card"] },
  { label: "对不对核对器", cwd: agentRoot, args: ["run", "test:design-fact-check"] },
  { label: "设计评审器", cwd: agentRoot, args: ["run", "test:design-evaluator"] },
  { label: "近期成稿指纹（别每次都一样）", cwd: agentRoot, args: ["run", "test:recent-designs"] },
  { label: "让用户帮我选（选项卡）", cwd: agentRoot, args: ["run", "test:user-choice-request"] },
  { label: "学习候选区", cwd: agentRoot, args: ["run", "test:design-learning-candidates"] },
  { label: "运行事实账本", cwd: agentRoot, args: ["run", "test:run-fact-ledger"] },
  { label: "终审候选与参考证据", cwd: agentRoot, args: ["run", "test:design-final-comparison-evidence"] },
  { label: "终审跨代可信证据", cwd: agentRoot, args: ["run", "test:trusted-final-comparison-evidence"] },
  { label: "终审 Provider 逐图出站回执", cwd: agentRoot, args: ["run", "test:model-visual-presentation-receipt"] },
  { label: "设计可靠性评测契约", cwd: agentRoot, args: ["run", "test:design-reliability"] },
  { label: "隔离调试窗口与模型冻结", cwd: agentRoot, args: ["run", "test:debug-window-launcher"] },
  { label: "Runtime 构建身份", cwd: agentRoot, args: ["run", "test:runtime-build-identity"] },
  { label: "主体框纯逻辑", cwd: agentRoot, args: ["run", "test:subject-box"] },
  { label: "图片落位写前预览", cwd: agentRoot, args: ["run", "test:image-placement-preview"] },
  { label: "SKU 模板 handoff", cwd: agentRoot, args: ["run", "test:sku-template-handoff"] },
  { label: "Agent 核心测试", cwd: agentRoot, args: ["test"] },
  { label: "Agent 类型检查", cwd: agentRoot, args: ["run", "build:typecheck:renderer"] },
  { label: "Electron preload sandbox 边界", cwd: agentRoot, args: ["run", "test:preload-sandbox-boundary"] },
  { label: "UXP 核心测试", cwd: uxpRoot, args: ["test"] },
  { label: "UXP 构建", cwd: uxpRoot, args: ["run", "build"] }
];

function runCommand(command) {
  console.log(`[core-validation] ${command.label}`);
  const result = spawnSync(npmCommand, command.args, {
    cwd: command.cwd,
    stdio: "inherit",
    windowsHide: true,
    shell: process.platform === "win32"
  });

  if (result.error) {
    console.error(`[core-validation] ${command.label} 启动失败: ${result.error.message}`);
    return 1;
  }

  if (result.status !== 0) {
    console.error(`[core-validation] ${command.label} 失败，退出码 ${result.status ?? 1}`);
    return result.status ?? 1;
  }

  return 0;
}

function collectSmokeArtifacts(root) {
  const scriptsRoot = path.join(root, "scripts");
  if (!fs.existsSync(scriptsRoot)) return [];

  const pending = [scriptsRoot];
  const artifacts = [];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolutePath);
        continue;
      }
      if (entry.isFile() && /smokes?/i.test(entry.name)) {
        artifacts.push(path.relative(repoRoot, absolutePath));
      }
    }
  }
  return artifacts;
}

function assertSmokeRetired() {
  const smokeArtifacts = [
    ...collectSmokeArtifacts(agentRoot),
    ...collectSmokeArtifacts(uxpRoot)
  ];
  const packageSmokeCommands = [];
  for (const packagePath of [path.join(agentRoot, "package.json"), path.join(uxpRoot, "package.json")]) {
    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    for (const [name, command] of Object.entries(packageJson.scripts || {})) {
      if (/smoke/i.test(name) || /smoke/i.test(command)) {
        packageSmokeCommands.push(`${path.relative(repoRoot, packagePath)}:${name}`);
      }
    }
  }

  if (smokeArtifacts.length > 0 || packageSmokeCommands.length > 0) {
    const details = [...smokeArtifacts, ...packageSmokeCommands].join("\n");
    throw new Error(`检测到已退役的 smoke 入口，请删除或改为真实可复用验证：\n${details}`);
  }
}

function main() {
  assertSmokeRetired();
  for (const command of COMMANDS) {
    const status = runCommand(command);
    if (status !== 0) {
      process.exitCode = status;
      return;
    }
  }

  console.log(`[core-validation] 通过：${COMMANDS.length} 个核心检查，无 smoke 依赖`);
}

main();
