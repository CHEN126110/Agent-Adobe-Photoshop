#!/usr/bin/env node
"use strict";

/**
 * 入口文档同步审计：防止 CLAUDE.md / AGENTS.md 的项目认知与代码漂移（打地鼠病根）。
 *
 * 检查项：
 * 1. 根级 CLAUDE.md 与 AGENTS.md 第 6 行起逐字节一致（前 5 行允许身份差异），且均为 UTF-8 无 BOM。
 * 2. 文档中引用的 `npm run <script>` 必须存在于 DesignEcho-Agent 或 DesignEcho-UXP 的 package.json。
 * 3. 文档反引号中的仓库文件路径必须真实存在（文档明文声明"已缺失/已删除"的路径进白名单）。
 *
 * 用法：node scripts/audit-entry-doc-sync.cjs [--root <仓库根目录>]（--root 仅用于自测）。
 */

const fs = require("fs");
const path = require("path");

const rootArgIndex = process.argv.indexOf("--root");
const repoRoot = rootArgIndex >= 0 && process.argv[rootArgIndex + 1]
  ? path.resolve(process.argv[rootArgIndex + 1])
  : path.resolve(__dirname, "..", "..");
const agentRoot = path.join(repoRoot, "DesignEcho-Agent");
const uxpRoot = path.join(repoRoot, "DesignEcho-UXP");

/** 文档正文允许差异的行数（首行标题 + 身份说明句 + 互指同步说明所在的前 5 行）。 */
const IDENTITY_LINE_COUNT = 5;

/** 文档明文声明"已缺失/已删除/已内联"的路径：出现在文档里是历史警示，不算断链。 */
const KNOWN_MISSING_PATHS = new Set([
  "docs/debug-bridge.md",
  "src/main/REFACTOR-PLAN.md",
  ".cursor/rules/code-simplifier.md",
  "docs/project-status.md"
]);

/** 路径 token 的解析基底（按顺序尝试）；renderer/services 是代码地图开篇声明的裸模块名简写基底。 */
const PATH_BASES = [
  () => repoRoot,
  () => agentRoot,
  () => path.join(agentRoot, "src"),
  () => path.join(agentRoot, "src", "renderer", "services"),
  () => uxpRoot,
  () => path.join(uxpRoot, "src")
];

const errors = [];

function readDoc(name) {
  const filePath = path.join(repoRoot, name);
  if (!fs.existsSync(filePath)) {
    errors.push(`读取入口文档失败：${name} 不存在于仓库根目录 ${repoRoot}，请确认根级入口文档未被移动或删除。`);
    return null;
  }
  const buffer = fs.readFileSync(filePath);
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    errors.push(`编码检查失败：${name} 带有 UTF-8 BOM，项目要求所有文件 UTF-8 无 BOM，请去除 BOM 后重新保存。`);
  }
  return buffer.toString("utf8");
}

function checkBodySync(claudeText, agentsText) {
  const claudeBody = claudeText.split("\n").slice(IDENTITY_LINE_COUNT).join("\n");
  const agentsBody = agentsText.split("\n").slice(IDENTITY_LINE_COUNT).join("\n");
  if (claudeBody === agentsBody) return;

  const claudeLines = claudeBody.split("\n");
  const agentsLines = agentsBody.split("\n");
  const maxLines = Math.max(claudeLines.length, agentsLines.length);
  for (let i = 0; i < maxLines; i += 1) {
    if (claudeLines[i] !== agentsLines[i]) {
      const lineNumber = IDENTITY_LINE_COUNT + i + 1;
      errors.push(
        `正文同步失败：CLAUDE.md 与 AGENTS.md 自第 ${lineNumber} 行起出现差异。` +
        `\n  CLAUDE.md: ${JSON.stringify(claudeLines[i] ?? "<该行不存在>")}` +
        `\n  AGENTS.md: ${JSON.stringify(agentsLines[i] ?? "<该行不存在>")}` +
        `\n  两文件除前 ${IDENTITY_LINE_COUNT} 行身份说明外必须逐字节一致；请把新改动同步到另一份。`
      );
      return;
    }
  }
}

function loadScriptNames() {
  const names = new Set();
  for (const pkgRoot of [agentRoot, uxpRoot]) {
    const pkgPath = path.join(pkgRoot, "package.json");
    if (!fs.existsSync(pkgPath)) {
      errors.push(`命令检查失败：找不到 ${pkgPath}，无法校验文档中的 npm run 引用是否真实存在。`);
      continue;
    }
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    for (const name of Object.keys(pkg.scripts || {})) names.add(name);
  }
  return names;
}

function expandScriptRef(raw) {
  const optional = raw.match(/^(.*)\[(:[A-Za-z0-9:._-]+)\]$/);
  if (optional) return [optional[1], optional[1] + optional[2]];
  return [raw];
}

function checkScriptRefs(docName, text, scriptNames) {
  const pattern = /npm run ([A-Za-z0-9:._\[\]*-]+)/g;
  const seen = new Set();
  let match;
  while ((match = pattern.exec(text)) !== null) {
    for (const ref of expandScriptRef(match[1])) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      if (ref.endsWith("*")) {
        const prefix = ref.slice(0, -1);
        const hit = Array.from(scriptNames).some((name) => name.startsWith(prefix));
        if (!hit) {
          errors.push(`命令引用断链：${docName} 引用了 \`npm run ${ref}\`，但两个 package.json 中没有以 "${prefix}" 开头的 script。请修正文档或补回命令。`);
        }
        continue;
      }
      if (!scriptNames.has(ref)) {
        errors.push(`命令引用断链：${docName} 引用了 \`npm run ${ref}\`，但 DesignEcho-Agent 与 DesignEcho-UXP 的 package.json 中都不存在该 script。请修正文档或补回命令。`);
      }
    }
  }
}

function looksLikeFilePath(token) {
  if (!token.includes("/")) return false;
  if (/[*{}<>\s→（]/.test(token)) return false;
  return /\.(ts|tsx|cjs|mjs|js|json|md)$/.test(token);
}

function pathExistsAnywhere(token) {
  return PATH_BASES.some((base) => fs.existsSync(path.join(base(), token)));
}

function checkPathRefs(docName, text) {
  const pattern = /`([^`\n]+)`/g;
  const seen = new Set();
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const token = match[1];
    if (seen.has(token) || !looksLikeFilePath(token)) continue;
    seen.add(token);
    if (KNOWN_MISSING_PATHS.has(token)) continue;
    if (!pathExistsAnywhere(token)) {
      errors.push(
        `路径引用断链：${docName} 引用了 \`${token}\`，但在仓库根、DesignEcho-Agent(/src)、DesignEcho-UXP(/src) 下都找不到该文件。` +
        `请修正文档；若该路径是文档明文声明的历史缺失项，把它加入本脚本 KNOWN_MISSING_PATHS 并注明原因。`
      );
    }
  }
}

function run() {
  const claudeText = readDoc("CLAUDE.md");
  const agentsText = readDoc("AGENTS.md");

  if (claudeText !== null && agentsText !== null) {
    checkBodySync(claudeText, agentsText);
    const scriptNames = loadScriptNames();
    for (const [docName, text] of [["CLAUDE.md", claudeText], ["AGENTS.md", agentsText]]) {
      checkScriptRefs(docName, text, scriptNames);
      checkPathRefs(docName, text);
    }
  }

  if (errors.length > 0) {
    console.error(`[entry-doc-sync] 发现 ${errors.length} 个问题：`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log("[entry-doc-sync] 入口文档同步审计通过：正文逐字节一致，命令与路径引用均真实存在。");
  process.exit(0);
}

run();
