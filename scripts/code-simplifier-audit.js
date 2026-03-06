/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const ROOT_DIR = process.cwd();
const TARGET_DIRS = [
    'DesignEcho-Agent/src',
    'DesignEcho-UXP/src',
    'scripts',
    'playwright-skill'
];
const TARGET_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.jsx']);
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.git', 'release']);
const LONG_LINE_THRESHOLD = 140;
const LARGE_FILE_THRESHOLD = 800;
const HOTSPOT_LIMIT = 30;
const ISSUE_LIMIT = 120;

function toPosixPath(inputPath) {
    return inputPath.split(path.sep).join('/');
}

function collectSourceFiles(dirPath, sink) {
    if (!fs.existsSync(dirPath)) {
        return;
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        if (EXCLUDED_DIRS.has(entry.name)) {
            continue;
        }

        const absolutePath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            collectSourceFiles(absolutePath, sink);
            continue;
        }

        const extension = path.extname(entry.name);
        if (TARGET_EXTENSIONS.has(extension)) {
            sink.push(absolutePath);
        }
    }
}

function countMatches(content, pattern) {
    const matches = content.match(pattern);
    return matches ? matches.length : 0;
}

function analyzeFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);

    let longLineCount = 0;
    const nestedTernaryLines = [];
    const longLines = [];

    for (let index = 0; index < lines.length; index += 1) {
        const lineNumber = index + 1;
        const line = lines[index];

        if (line.length > LONG_LINE_THRESHOLD) {
            longLineCount += 1;
            longLines.push({
                line: lineNumber,
                length: line.length
            });
        }

        if (!line.includes('?') || !line.includes(':')) {
            continue;
        }

        // Heuristic: runtime ternary usually appears as " ? " and " : "
        const ternaryTokenCount = countMatches(line, /\s\?\s/g);
        const hasTernarySeparator = /\s:\s/.test(line);
        if (ternaryTokenCount >= 2 && hasTernarySeparator) {
            nestedTernaryLines.push(lineNumber);
        }
    }

    const lineCount = lines.length;
    const arrowCount = countMatches(content, /=>/g);
    const tryCatchCount = countMatches(content, /\btry\s*{/g);
    const anyCount = countMatches(content, /\bany\b/g);
    const functionKeywordCount = countMatches(content, /\bfunction\b/g);

    const hotspotScore =
        Math.floor(lineCount / 300) * 8 +
        nestedTernaryLines.length * 10 +
        Math.floor(arrowCount / 30) * 3 +
        Math.floor(tryCatchCount / 15) * 2 +
        Math.floor(longLineCount / 8);

    return {
        absolutePath: filePath,
        relativePath: toPosixPath(path.relative(ROOT_DIR, filePath)),
        lineCount,
        arrowCount,
        tryCatchCount,
        anyCount,
        functionKeywordCount,
        longLineCount,
        nestedTernaryLines,
        longLines,
        hotspotScore
    };
}

function renderTopTable(items, columns) {
    const header = `| ${columns.map((column) => column.title).join(' | ')} |`;
    const divider = `| ${columns.map(() => '---').join(' | ')} |`;
    const rows = items.map((item) => `| ${columns.map((column) => column.render(item)).join(' | ')} |`);
    return [header, divider, ...rows].join('\n');
}

function createBaselineMarkdown(analyses) {
    const now = new Date();
    const totalLines = analyses.reduce((sum, item) => sum + item.lineCount, 0);
    const totalFiles = analyses.length;
    const totalNestedTernaries = analyses.reduce((sum, item) => sum + item.nestedTernaryLines.length, 0);
    const totalLongLines = analyses.reduce((sum, item) => sum + item.longLineCount, 0);
    const totalTryCatch = analyses.reduce((sum, item) => sum + item.tryCatchCount, 0);

    const largestFiles = [...analyses]
        .sort((left, right) => right.lineCount - left.lineCount)
        .slice(0, HOTSPOT_LIMIT);

    const hotspotFiles = [...analyses]
        .sort((left, right) => right.hotspotScore - left.hotspotScore)
        .slice(0, HOTSPOT_LIMIT);

    const nestedTernaryIssues = [];
    const longLineIssues = [];

    for (const item of analyses) {
        for (const line of item.nestedTernaryLines) {
            nestedTernaryIssues.push({
                path: item.relativePath,
                line
            });
        }

        for (const longLine of item.longLines.slice(0, 6)) {
            longLineIssues.push({
                path: item.relativePath,
                line: longLine.line,
                length: longLine.length
            });
        }
    }

    const topNestedTernaryIssues = nestedTernaryIssues.slice(0, ISSUE_LIMIT);
    const topLongLineIssues = longLineIssues
        .sort((left, right) => right.length - left.length)
        .slice(0, ISSUE_LIMIT);

    const markdownLines = [
        '# Code Simplifier Baseline',
        '',
        `- Generated at: ${now.toISOString()}`,
        `- Scope: ${TARGET_DIRS.map((dir) => `\`${dir}\``).join(' + ')}`,
        '- Rule source: `.cursor/rules/code-simplifier.md`',
        '- Run command: `node scripts/code-simplifier-audit.js`',
        '',
        '## Snapshot',
        '',
        `- Source files: **${totalFiles}**`,
        `- Total lines: **${totalLines}**`,
        `- Nested ternary hits (line-level): **${totalNestedTernaries}**`,
        `- Long lines (>${LONG_LINE_THRESHOLD} chars): **${totalLongLines}**`,
        `- try/catch count: **${totalTryCatch}**`,
        '',
        `- Large files (>${LARGE_FILE_THRESHOLD} lines): **${largestFiles.filter((item) => item.lineCount > LARGE_FILE_THRESHOLD).length}**`,
        '',
        '## Largest Files',
        '',
        renderTopTable(largestFiles, [
            { title: 'File', render: (item) => `\`${item.relativePath}\`` },
            { title: 'Lines', render: (item) => String(item.lineCount) },
            { title: 'Arrow Fn', render: (item) => String(item.arrowCount) },
            { title: 'try/catch', render: (item) => String(item.tryCatchCount) },
            { title: 'Nested Ternary', render: (item) => String(item.nestedTernaryLines.length) },
            { title: 'Hotspot Score', render: (item) => String(item.hotspotScore) }
        ]),
        '',
        '## Refactor Hotspots',
        '',
        renderTopTable(hotspotFiles, [
            { title: 'File', render: (item) => `\`${item.relativePath}\`` },
            { title: 'Score', render: (item) => String(item.hotspotScore) },
            { title: 'Lines', render: (item) => String(item.lineCount) },
            { title: 'Nested Ternary', render: (item) => String(item.nestedTernaryLines.length) },
            { title: 'Long Lines', render: (item) => String(item.longLineCount) },
            { title: 'any', render: (item) => String(item.anyCount) }
        ]),
        '',
        '## Nested Ternary Locations (Top)',
        '',
        topNestedTernaryIssues.length === 0
            ? '- No nested ternary lines detected.'
            : topNestedTernaryIssues.map((issue) => `- \`${issue.path}:${issue.line}\``).join('\n'),
        '',
        '## Long Line Locations (Top)',
        '',
        topLongLineIssues.length === 0
            ? '- No long lines detected.'
            : topLongLineIssues.map((issue) => `- \`${issue.path}:${issue.line}\` (${issue.length} chars)`).join('\n'),
        '',
        '## Suggested Execution Order',
        '',
        '1. Split oversized orchestrators/entry files first (`main/index.ts`, `uxp/index.ts`, large React containers).',
        '2. Replace nested ternary chains with explicit `if/else` or `switch`.',
        '3. Extract repeated status/message update blocks into named functions.',
        '4. Reduce `any` usage in high-churn modules by adding stable local interfaces.',
        '5. Keep each simplification batch behavior-neutral and verifiable via existing build/test commands.'
    ];

    return `${markdownLines.join('\n')}\n`;
}

function ensureParentDir(filePath) {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
}

function main() {
    const files = [];
    for (const targetDir of TARGET_DIRS) {
        collectSourceFiles(path.join(ROOT_DIR, targetDir), files);
    }

    if (files.length === 0) {
        console.error('[code-simplifier-audit] No source files found in configured target directories.');
        process.exitCode = 1;
        return;
    }

    const analyses = files.map((filePath) => analyzeFile(filePath));
    const markdown = createBaselineMarkdown(analyses);
    const outputPath = path.join(ROOT_DIR, 'docs', 'code-simplifier-baseline.md');

    ensureParentDir(outputPath);
    fs.writeFileSync(outputPath, markdown, 'utf8');

    console.log(`[code-simplifier-audit] Baseline written: ${toPosixPath(path.relative(ROOT_DIR, outputPath))}`);
    console.log(`[code-simplifier-audit] Files analyzed: ${analyses.length}`);
}

main();
