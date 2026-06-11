import type { DesignKnowledgeResult } from './design-knowledge-search';

export type BusinessSkillMemoryScenario = 'main-image' | 'detail-page' | 'sku';
export type BusinessSkillMemoryEvidenceStatus = 'not_available' | 'available';

export interface BusinessSkillMemoryPreferenceSummary {
    sourceResultCount: number;
    sourceIds: string[];
    stylePreferences: string[];
    typographyPreferences: string[];
    colorPreferences: string[];
    workflowPreferences: string[];
    copywritingPreferences: string[];
    reviewRequiredReasons: string[];
}

export interface BusinessSkillMemoryEvidence {
    version: 'business-skill-memory-evidence/v0';
    scenario: BusinessSkillMemoryScenario;
    status: BusinessSkillMemoryEvidenceStatus;
    preferenceSummary: BusinessSkillMemoryPreferenceSummary;
    strategyInputPatch: {
        designMemory?: BusinessSkillMemoryPreferenceSummary & {
            boundary: string;
        };
    };
    canClaimOutputQuality: false;
    canClaimDesignComplete: false;
    noPhotoshopWrites: true;
    mustNotExecutePhotoshop: true;
    warnings: string[];
    limitations: string[];
    evidence: Array<{
        source: string;
        summary: string;
        status: 'ready' | 'needs_review' | 'unknown' | 'failed';
    }>;
}

export interface BuildBusinessSkillMemoryEvidenceInput {
    scenario: BusinessSkillMemoryScenario;
    userText?: string;
    knowledgeResults?: DesignKnowledgeResult[];
}

const FORBIDDEN_PAYLOAD_PATTERNS = [
    /raw-image-payload/gi,
    /base64-image-payload/gi,
    /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi,
    /data:image\//gi
];

const MEMORY_ALLOWED_USES = new Set(['prompt_context', 'user_reference', 'recipe_hint']);

function cleanString(value: unknown): string {
    let text = String(value || '').trim();
    for (const pattern of FORBIDDEN_PAYLOAD_PATTERNS) {
        text = text.replace(pattern, '[redacted-image-payload]');
    }
    return text.replace(/\s+/g, ' ').trim();
}

function uniqueClean(values: unknown[]): string[] {
    return Array.from(new Set(values.map(cleanString).filter(Boolean)));
}

function getTags(result: DesignKnowledgeResult): string[] {
    return Array.isArray(result.tags) ? result.tags.map(cleanString).filter(Boolean) : [];
}

function hasUsableMemoryUse(result: DesignKnowledgeResult): boolean {
    const allowedUses = Array.isArray(result.allowedUses) ? result.allowedUses : [];
    return allowedUses.some((use) => MEMORY_ALLOWED_USES.has(String(use)));
}

function isUsableLocalMemory(result: DesignKnowledgeResult): boolean {
    return result?.sourceType === 'local_case'
        && result.evidenceLevel === 'local_case'
        && hasUsableMemoryUse(result);
}

function stripKnownPrefix(text: string, prefixes: string[]): string {
    let output = text;
    for (const prefix of prefixes) {
        if (output.startsWith(prefix)) {
            output = output.slice(prefix.length);
            break;
        }
    }
    return output.trim();
}

function extractTitleValue(result: DesignKnowledgeResult, prefixes: string[]): string {
    const title = cleanString(result.title);
    return stripKnownPrefix(title, prefixes);
}

function extractStylePreference(result: DesignKnowledgeResult): string | undefined {
    const tags = getTags(result);
    if (!tags.includes('style')) return undefined;
    const titleValue = extractTitleValue(result, ['偏好风格：', '偏好风格:', '风格：', '风格:']);
    if (titleValue && titleValue !== result.title) return titleValue;
    return tags.find((tag) => !['design-memory', 'user_preference', 'manual_setting', 'inferred_from_operations', 'style'].includes(tag));
}

function extractTypographyPreference(result: DesignKnowledgeResult): string | undefined {
    const tags = getTags(result);
    if (!tags.includes('font') && !tags.includes('typography')) return undefined;
    const titleValue = extractTitleValue(result, ['常用字体：', '常用字体:', '字体：', '字体:']);
    if (titleValue && titleValue !== result.title) return titleValue;
    return tags.find((tag) => !['design-memory', 'user_preference', 'manual_setting', 'inferred_from_operations', 'font', 'typography'].includes(tag));
}

function extractColorPreference(result: DesignKnowledgeResult): string | undefined {
    const tags = getTags(result);
    if (!tags.includes('color')) return undefined;
    const titleValue = extractTitleValue(result, ['常用颜色：', '常用颜色:', '颜色：', '颜色:']);
    if (titleValue && titleValue !== result.title) return titleValue;
    return tags.find((tag) => !['design-memory', 'user_preference', 'manual_setting', 'inferred_from_operations', 'color'].includes(tag));
}

function extractWorkflowPreference(result: DesignKnowledgeResult): string | undefined {
    const tags = getTags(result);
    if (!tags.includes('workflow') && !tags.includes('export')) return undefined;
    return uniqueClean([result.title, result.summary]).join('；');
}

function extractCopywritingPreference(result: DesignKnowledgeResult): string | undefined {
    const tags = getTags(result);
    if (!tags.includes('copywriting') && result.intent !== 'copywriting') return undefined;
    return uniqueClean([result.title, result.summary]).join('；');
}

function needsReview(result: DesignKnowledgeResult): boolean {
    const text = [
        result.id,
        result.title,
        result.summary,
        ...(Array.isArray(result.evidence) ? result.evidence : []),
        ...getTags(result)
    ].map(cleanString).join(' ');
    return /inferred_from_operations|历史操作|未等同于当前任务要求|needs_review/.test(text);
}

function buildPreferenceSummary(results: DesignKnowledgeResult[]): BusinessSkillMemoryPreferenceSummary {
    return {
        sourceResultCount: results.length,
        sourceIds: results.map((result) => cleanString(result.id)).filter(Boolean),
        stylePreferences: uniqueClean(results.map(extractStylePreference)),
        typographyPreferences: uniqueClean(results.map(extractTypographyPreference)),
        colorPreferences: uniqueClean(results.map(extractColorPreference)),
        workflowPreferences: uniqueClean(results.map(extractWorkflowPreference)),
        copywritingPreferences: uniqueClean(results.map(extractCopywritingPreference)),
        reviewRequiredReasons: uniqueClean(results
            .filter(needsReview)
            .map((result) => `${cleanString(result.title) || cleanString(result.id)} 来自历史操作或推断记忆，当前任务使用前需要复核。`))
    };
}

function scenarioBoundary(scenario: BusinessSkillMemoryScenario): string {
    if (scenario === 'sku') {
        return '本地偏好记忆只能影响 SKU 策略说明和候选排序，不能改变 SKU 自选备注意图、组合规格、项目素材、模板选择或 Photoshop 执行参数。';
    }
    if (scenario === 'detail-page') {
        return '本地偏好记忆只能影响详情页风格、文案和素材匹配候选，不能替代模板结构、项目素材、视觉证据或 Photoshop 执行结果。';
    }
    return '本地偏好记忆只能影响主图风格、文案和排版候选排序，不能替代视觉证据、平台规范或 Photoshop 执行结果。';
}

function buildWarnings(summary: BusinessSkillMemoryPreferenceSummary): string[] {
    const warnings: string[] = [];
    if (summary.sourceResultCount === 0) {
        warnings.push('没有可用于当前业务 skill 的本地偏好记忆；策略只能依赖当前任务、项目素材、视觉证据和平台规范。');
    }
    if (summary.reviewRequiredReasons.length > 0) {
        warnings.push('部分偏好来自历史操作或推断记忆，只能作为候选偏好，不能覆盖当前用户指令、项目事实或平台规范。');
    }
    return warnings;
}

function buildLimitations(scenario: BusinessSkillMemoryScenario): string[] {
    const limitations = [
        '本地记忆不是视觉识别结果，不能证明商品款式、材质、主体 bounds 或设计质量。',
        '本地记忆不是 Photoshop/UXP 工具调用参数，不能触发抠图、置入、移动、导出等写入动作。',
        '本地记忆不得覆盖用户当前显式指令、项目文件结构、平台规范、人工确认或真实 QA 证据。'
    ];
    if (scenario === 'sku') {
        limitations.push('SKU 记忆 evidence 不能改变 SKU 自选备注、规格数量、颜色组合或项目 SKU 源文件选择。');
    }
    if (scenario === 'detail-page') {
        limitations.push('详情页记忆 evidence 不能绕过模板结构检查、跨屏风险、素材匹配和执行后回读验收。');
    }
    return limitations;
}

export function buildBusinessSkillMemoryEvidence(
    input: BuildBusinessSkillMemoryEvidenceInput
): BusinessSkillMemoryEvidence {
    const localMemoryResults = (Array.isArray(input.knowledgeResults) ? input.knowledgeResults : [])
        .filter(isUsableLocalMemory)
        .sort((a, b) => (Number(b.sourceRank) || 0) - (Number(a.sourceRank) || 0));
    const preferenceSummary = buildPreferenceSummary(localMemoryResults);
    const status: BusinessSkillMemoryEvidenceStatus = preferenceSummary.sourceResultCount > 0
        ? 'available'
        : 'not_available';
    const strategyInputPatch = status === 'available'
        ? {
            designMemory: {
                ...preferenceSummary,
                boundary: scenarioBoundary(input.scenario)
            }
        }
        : {};
    return {
        version: 'business-skill-memory-evidence/v0',
        scenario: input.scenario,
        status,
        preferenceSummary,
        strategyInputPatch,
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        warnings: buildWarnings(preferenceSummary),
        limitations: buildLimitations(input.scenario),
        evidence: [{
            source: 'business-skill-memory-evidence',
            summary: `scenario=${input.scenario}; status=${status}; localMemory=${preferenceSummary.sourceResultCount}; style=${preferenceSummary.stylePreferences.length}; font=${preferenceSummary.typographyPreferences.length}; color=${preferenceSummary.colorPreferences.length}; workflow=${preferenceSummary.workflowPreferences.length}`,
            status: status === 'available'
                ? (preferenceSummary.reviewRequiredReasons.length > 0 ? 'needs_review' : 'ready')
                : 'unknown'
        }]
    };
}
