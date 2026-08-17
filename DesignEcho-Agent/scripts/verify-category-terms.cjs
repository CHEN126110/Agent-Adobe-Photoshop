#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * 品类词条库一致性验证（audit:category-terms）。
 *
 * 治理（2026-08-04）：主图/详情页/SKU/海报/banner 的品类词收敛到
 * src/shared/design-category-terms.ts 唯一数据源。本脚本守护「行为零变化」：
 *
 *   1. 当前代码每个 buildCategoryTermPattern / buildCrossCategoryTermPattern
 *      子集声明中的词条，必须能在 git HEAD 的旧消费文件（同一文件）中找到
 *      ——防止抄错/漏抄/新造词（词条转义归一化后对比）。
 *   2. 共享词条库每个词条，必须能在 git HEAD 的至少一个消费文件中出现
 *      ——防止词条库引入旧代码不存在的词（行为扩张）。
 *   3. 消费方子集声明的词条必须存在于词条库
 *      ——防止引用未登记词条（行为漂移）。
 *
 * 依赖 git（读取 HEAD 版本做基线对比）。新增消费方时请把它加入 CONSUMER_FILES。
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const AGENT_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(AGENT_ROOT, '..');
const TERMS_FILE = path.join(AGENT_ROOT, 'src', 'shared', 'design-category-terms.ts');

const CONSUMER_FILES = [
    'src/shared/design-document-role.ts',
    'src/shared/agent-task-planning-contract.ts',
    'src/shared/sku-intent-params.ts',
    'src/renderer/services/agent-runtime/task-completion-contract.ts',
    'src/shared/agent-intent-control-plane.ts'
];

/** JS 字符串字面量里的转义归一化：`\\s` → `\s`（与正则源文本一致）。 */
function normalizeTerm(term) {
    return String(term || '')
        .replace(/\\\\/g, '\\')
        .trim();
}

/** 提取 JS 字符串字面量内容（处理 \' \" \\ 转义，足够本场景使用）。 */
function extractStringLiterals(source) {
    const literals = [];
    const pattern = /(['"])((?:\\.|(?!\1)[^\\])*)\1/g;
    let match;
    while ((match = pattern.exec(source)) !== null) {
        const value = match[2].replace(/\\(['"\\])/g, '$1');
        literals.push(value);
    }
    return literals;
}

/** 提取当前文件里子集声明的词条（subset: [...] 数组内的字符串字面量）。 */
function extractCurrentSubsetTerms(source) {
    const terms = [];
    const subsetPattern = /subset:\s*\[([^\]]*)\]/g;
    let match;
    while ((match = subsetPattern.exec(source)) !== null) {
        const arraySource = match[1];
        for (const literal of extractStringLiterals(`[${arraySource}]`)) {
            const normalized = normalizeTerm(literal);
            if (normalized && !terms.includes(normalized)) terms.push(normalized);
        }
    }
    return terms;
}

/**
 * 归一化旧文件全文，作为词条存在性基线。
 *
 * 旧消费方同时包含正则字面量（`\s`）和 TypeScript 字符串字面量
 * （源码中写作 `\\s`）。比较前必须统一转义层级，否则同一个词条会被
 * 误判为“旧代码不存在”。使用全文而不是关键词预筛选，不会放宽验证：
 * 每个共享词条仍必须逐字存在于至少一个旧消费文件中。
 */
function extractLegacyEvidenceLines(source) {
    return normalizeTerm(source).split(/\r?\n/);
}

/** 提取共享词条库的全部词条（归一化）。 */
function extractTermLibrary(source) {
    const terms = [];
    const poolPattern = /(\w+):\s*\[([^\]]*)\]/g;
    let match;
    while ((match = poolPattern.exec(source)) !== null) {
        for (const literal of extractStringLiterals(`[${match[2]}]`)) {
            const normalized = normalizeTerm(literal);
            if (normalized && !terms.includes(normalized)) terms.push(normalized);
        }
    }
    return terms;
}

function gitShow(cwd, rev, relativePath) {
    const result = spawnSync('git', ['show', `${rev}:DesignEcho-Agent/${relativePath}`], {
        cwd,
        encoding: 'utf8',
        windowsHide: true
    });
    if (result.status !== 0) {
        throw new Error(`git show ${rev}:${relativePath} 失败：${result.stderr || '文件可能未跟踪'}`);
    }
    return result.stdout;
}

/**
 * 解析品类词条库集中治理前的统一基线。
 *
 * 不能按每个消费文件是否脏来选 HEAD/HEAD~1：迁移提交之后的无关修改也会让
 * 文件变脏，从而错误地把迁移后的 HEAD 当成旧代码。词条库尚未提交时用 HEAD；
 * 已提交后固定使用首次引入词条库提交的父提交。
 */
function resolveMigrationBaselineRevision() {
    const headLibraryResult = spawnSync(
        'git',
        ['show', 'HEAD:DesignEcho-Agent/src/shared/design-category-terms.ts'],
        { cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true }
    );
    // HEAD 尚无词条库才表示“首次引入仍未提交”，此时 HEAD 就是迁移前基线。
    // HEAD 已有词条库时，即使工作区正在修改该文件，也必须回到首次引入提交的父提交；
    // 否则会拿迁移后的消费者冒充 legacy evidence，产生确定性的假红。
    if (headLibraryResult.status !== 0) {
        return 'HEAD';
    }

    const introductionResult = spawnSync(
        'git',
        [
            'log',
            '--diff-filter=A',
            '--format=%H',
            '--',
            'DesignEcho-Agent/src/shared/design-category-terms.ts'
        ],
        { cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true }
    );
    const introductionCommit = String(introductionResult.stdout || '')
        .split(/\r?\n/)
        .map((value) => value.trim())
        .find(Boolean);
    if (introductionResult.status !== 0 || !introductionCommit) {
        throw new Error('无法定位 design-category-terms.ts 的首次引入提交。');
    }

    const parentResult = spawnSync('git', ['rev-parse', `${introductionCommit}^`], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        windowsHide: true
    });
    if (parentResult.status !== 0) {
        throw new Error('词条库首次引入提交没有可用父提交，无法确定迁移前基线。');
    }
    return parentResult.stdout.trim();
}

function main() {
    const issues = [];
    const librarySource = fs.readFileSync(TERMS_FILE, 'utf8');
    const libraryTerms = extractTermLibrary(librarySource);
    if (libraryTerms.length === 0) {
        issues.push('词条库解析为空，无法验证。');
    }

    let baselineRevision = '';
    try {
        baselineRevision = resolveMigrationBaselineRevision();
    } catch (error) {
        issues.push(error.message);
    }

    let legacyEvidenceText = '';
    const legacyEvidenceByFile = {};
    for (const relativePath of CONSUMER_FILES) {
        const full = path.join(AGENT_ROOT, relativePath);
        if (!fs.existsSync(full)) {
            issues.push(`消费文件不存在：${relativePath}`);
            continue;
        }
        let legacy;
        try {
            legacy = gitShow(REPO_ROOT, baselineRevision, relativePath);
        } catch (error) {
            issues.push(`${relativePath}: ${error.message}`);
            continue;
        }
        legacyEvidenceByFile[relativePath] = extractLegacyEvidenceLines(legacy).join('\n');
        legacyEvidenceText += legacyEvidenceByFile[relativePath];
    }

    // 1) 词条库每个词条必须在旧代码中出现（防新造词导致行为扩张）
    for (const term of libraryTerms) {
        if (!legacyEvidenceText.includes(term)) {
            issues.push(`词条库词条在旧代码中不存在（行为扩张风险）：${JSON.stringify(term)}`);
        }
    }

    // 2) 当前每个子集声明词条必须在该文件旧版中出现（防抄错/漏抄）
    for (const relativePath of CONSUMER_FILES) {
        const full = path.join(AGENT_ROOT, relativePath);
        if (!fs.existsSync(full)) continue;
        const currentSource = fs.readFileSync(full, 'utf8');
        const subsetTerms = extractCurrentSubsetTerms(currentSource);
        const evidence = legacyEvidenceByFile[relativePath] || '';
        for (const term of subsetTerms) {
            if (!evidence.includes(term)) {
                issues.push(`${relativePath} 子集词条在旧版对应文件中不存在：${JSON.stringify(term)}`);
            }
        }
        // 3) 子集词条必须登记在词条库（防引用未登记词）
        for (const term of subsetTerms) {
            if (!libraryTerms.includes(term)) {
                issues.push(`${relativePath} 子集引用未登记词条：${JSON.stringify(term)}`);
            }
        }
    }

    const report = {
        success: issues.length === 0,
        libraryTerms: libraryTerms.length,
        consumers: CONSUMER_FILES.length,
        rule: '品类词收敛为 design-category-terms 唯一数据源；子集声明与旧版逐词一致，词条库不得引入旧代码不存在的词',
        ...(issues.length > 0 ? { violations: issues } : {})
    };

    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.success ? 0 : 1;
}

main();
