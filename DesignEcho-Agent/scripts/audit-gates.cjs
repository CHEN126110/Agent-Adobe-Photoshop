#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * 门禁定义手册防漂移审计（audit:gates）。
 *
 * 目的：docs/agent-gates-definitions.md 是每个门禁的「定义 + 意义」真相源（B 层治理文档），
 * 防止代码改动后手册失效（门禁改没了 / 文件改名 / 函数改名，手册还指着旧位置）。
 *
 * 检查项：
 *   1. 总览表「位置」列引用的每个文件在 DesignEcho-Agent 下真实存在
 *   2. 明细节「位置」行括号内的函数/常量标识符在对应文件中真实存在
 *   3. 门禁 ID 唯一（总览表内无重复）
 *   4. 总览表每个 ID 在明细节有对应小节（格式完整性）
 *
 * 单向漂移检查：代码可以「暂时没有手册条目」（新门禁未登记），
 * 但手册引用的代码必须存在——手册是治理承诺，不能指向空气。
 * 新增门禁请先过手册第 5 节 Checklist，再登记条目。
 */

const fs = require('fs');
const path = require('path');

const AGENT_ROOT = path.resolve(__dirname, '..');
const MANUAL_PATH = path.join(AGENT_ROOT, 'docs', 'agent-gates-definitions.md');
const IDENTIFIER_PATTERN = /\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g;

function readManual() {
    if (!fs.existsSync(MANUAL_PATH)) {
        throw new Error(`门禁定义手册不存在：${MANUAL_PATH}`);
    }
    return fs.readFileSync(MANUAL_PATH, 'utf8');
}

/**
 * 从总览表提取引用：| ID | 名称 | `path` | ... |
 * 位置列以反引号包路径，允许 `path`（函数名）与 `path` + `path2` 并列。
 */
function extractOverviewRefs(lines) {
    const refs = [];
    for (const line of lines) {
        const cells = line.trim().split('|').map((cell) => cell.trim()).filter(Boolean);
        if (cells.length < 6) continue;
        if (!/^[A-Z]-\d+$/.test(cells[0])) continue;
        const locationCell = cells[2];
        const paths = locationCell.match(/`([^`]+)`/g) || [];
        const filePaths = paths.map((token) => token.replace(/`/g, '')).filter((token) => /\.tsx?$/.test(token));
        refs.push({ id: cells[0], filePaths });
    }
    return refs;
}

/**
 * 从明细节提取：- 位置：`path`（标识符1 / 标识符2）...
 * 括号内只认形如代码标识符的 token（排除中文、数字开头、行号~3632）。
 * 支持「同 X-Y」引用（从被引用 ID 继承路径，不重复校验）；类总述（### 分类）后的
 * 位置行归属当前分类，不归属任何具体 ID（由总览表覆盖校验）。
 */
function extractDetailRefs(lines) {
    const refs = [];
    const seenIds = [];
    let currentId = '';
    for (const line of lines) {
        if (/^###\s*分类\s*[A-Z]\s*：/.test(line.trim())) {
            currentId = '';
            continue;
        }
        const idMatch = line.match(/^\*\*(S|A|C|D|B|F|E|V|N|X)-\d+\s/);
        if (idMatch) {
            currentId = idMatch[0].replace(/^\*\*/, '').replace(/\s+$/, '');
            if (!seenIds.includes(currentId)) seenIds.push(currentId);
            continue;
        }
        const locationMatch = line.match(/^\s*-\s*位置：\s*(.+)$/);
        if (!locationMatch || !currentId) continue;
        const rest = locationMatch[1];
        const inheritMatch = rest.match(/同\s*((?:S|A|C|D|B|F|E|V|N|X)-\d+)/);
        if (inheritMatch) {
            refs.push({ id: currentId, filePaths: [], identifiers: [], inheritsFrom: inheritMatch[1] });
            continue;
        }
        const paths = [];
        for (const token of rest.match(/`([^`]+)`/g) || []) {
            const clean = token.replace(/`/g, '').trim();
            if (/\.tsx?$/.test(clean)) paths.push(clean);
        }
        if (paths.length === 0) continue;
        const parenthesized = rest.match(/（([^（）]*)）/);
        const identifiers = [];
        if (parenthesized) {
            for (const match of parenthesized[1].match(IDENTIFIER_PATTERN) || []) {
                if (identifiers.includes(match)) continue;
                identifiers.push(match);
            }
        }
        refs.push({ id: currentId, filePaths: paths, identifiers });
    }
    return { refs, seenIds };
}

function readCodeFile(agentRoot, relativePath) {
    const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
    const full = path.join(agentRoot, normalized);
    if (!fs.existsSync(full)) return { full, missing: true, content: '' };
    return { full, missing: false, content: fs.readFileSync(full, 'utf8') };
}

function main() {
    const lines = readManual().split(/\r?\n/);
    const overviewRefs = extractOverviewRefs(lines);
    const { refs: detailRefs, seenIds: detailIds } = extractDetailRefs(lines);
    const issues = [];
    const checkedFiles = new Set();

    if (overviewRefs.length === 0) {
        issues.push('总览表为空或格式无法解析（需要 `| ID | 名称 | 位置 | ...` 行）。');
    }

    for (const ref of overviewRefs) {
        for (const filePath of ref.filePaths) {
            const code = readCodeFile(AGENT_ROOT, filePath);
            checkedFiles.add(filePath);
            if (code.missing) {
                issues.push(`${ref.id} 引用不存在的文件：${filePath}`);
            }
        }
    }

    for (const ref of detailRefs) {
        if (ref.inheritsFrom) {
            if (!detailIds.includes(ref.inheritsFrom)) {
                issues.push(`${ref.id} 引用了不存在的明细节 ID：${ref.inheritsFrom}`);
            }
            continue;
        }
        for (const filePath of ref.filePaths) {
            const code = readCodeFile(AGENT_ROOT, filePath);
            checkedFiles.add(filePath);
            if (code.missing) {
                issues.push(`${ref.id} 位置引用不存在的文件：${filePath}`);
                continue;
            }
            for (const identifier of ref.identifiers) {
                if (!new RegExp(`\\b${identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(code.content)) {
                    issues.push(`${ref.id} 标识符不存在：${filePath} 中找不到 ${identifier}`);
                }
            }
        }
    }

    const overviewIds = overviewRefs.map((ref) => ref.id);
    const duplicateIds = overviewIds.filter((id, index) => overviewIds.indexOf(id) !== index);
    if (duplicateIds.length > 0) {
        issues.push(`总览表 ID 重复：${Array.from(new Set(duplicateIds)).join('、')}`);
    }

    const missingDetailIds = overviewIds.filter((id) => !detailIds.includes(id));
    if (missingDetailIds.length > 0) {
        issues.push(`总览表 ID 缺少明细节：${missingDetailIds.join('、')}`);
    }

    const report = {
        success: issues.length === 0,
        overviewEntries: overviewRefs.length,
        detailEntries: detailRefs.length,
        checkedFiles: Array.from(checkedFiles).sort(),
        rule: 'docs/agent-gates-definitions.md 引用的文件与标识符必须在代码中真实存在；ID 唯一且明细完整',
        ...(issues.length > 0 ? { violations: issues } : {})
    };

    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.success ? 0 : 1;
}

main();
