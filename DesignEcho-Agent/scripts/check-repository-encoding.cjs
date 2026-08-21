#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const textExtensions = new Set([".cjs", ".css", ".html", ".js", ".json", ".md", ".ts", ".tsx"]);
// Keep this list limited to characters that are not valid in ordinary Simplified Chinese prose.
// U+6D93 (涓) was removed because terms such as "涓流" are legitimate and caused false positives.
const mojibakePatterns = [
  0x9359, 0x923F, 0x7487, 0x93C1, 0x9429, 0x7EF1, 0x6FB6,
  0x59AF, 0x7EAD, 0x701B, 0x6D94, 0x93AC, 0x51AD, 0x5EA2, 0x9983,
  0x20AC, 0x00C3, 0x00C2, 0xFFFD
].map((codePoint) => String.fromCodePoint(codePoint));

const scanRoots = [
  "AGENTS.md",
  "CLAUDE.md",
  "DesignEcho-Agent/src",
  "DesignEcho-Agent/scripts",
  "DesignEcho-Agent/docs",
  "DesignEcho-Agent/project-memory",
  "DesignEcho-Agent/benchmarks",
  "DesignEcho-UXP/src",
  "DesignEcho-UXP/scripts"
];

function collectFiles(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) return [];
  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) return [absolutePath];

  const files = [];
  const pending = [absolutePath];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(child);
      else if (entry.isFile()) files.push(child);
    }
  }
  return files;
}

function main() {
  const files = [...new Set(scanRoots.flatMap(collectFiles))]
    .filter((file) => textExtensions.has(path.extname(file)));
  const matches = [];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    for (const [lineIndex, line] of content.split(/\r?\n/).entries()) {
      for (const pattern of mojibakePatterns) {
        if (line.includes(pattern)) {
          matches.push(`${path.relative(repoRoot, file).replace(/\\/g, "/")}:${lineIndex + 1}`);
        }
      }
    }
  }

  if (matches.length > 0) {
    throw new Error(`发现疑似乱码：\n${matches.join("\n")}`);
  }

  console.log(JSON.stringify({ success: true, scannedFiles: files.length }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
