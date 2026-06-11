import {
    REFERENCE_STYLE_RECIPES,
    type ReferenceStyleRecipe
} from './reference-replication-style-recipes';
import {
    DESIGN_DOMAIN_CONCEPTS,
    type DesignDomainConcept
} from './design-domain-knowledge';
import {
    COPYWRITING_CORE_FORMULA,
    COPYWRITING_SCORE_CRITERIA,
    COPYWRITING_TEMPLATES,
    formatCopywritingFrameworkForKnowledge
} from './design-copywriting-framework';
import {
    searchDesignMemoryKnowledge,
    type DesignMemoryItem
} from './design-memory-knowledge';

export type DesignKnowledgeIntent =
    | 'trend'
    | 'reference'
    | 'rule'
    | 'recipe'
    | 'brand'
    | 'platform_spec'
    | 'copywriting';

export type DesignKnowledgeSourceType =
    | 'local_recipe'
    | 'manual_rule'
    | 'design_crawler'
    | 'web_page'
    | 'mimo_web_search'
    | 'local_case'
    | 'eagle_library';

export type DesignKnowledgeAllowedUse =
    | 'prompt_context'
    | 'user_reference'
    | 'recipe_hint'
    | 'benchmark_seed';

export type DesignKnowledgeEvidenceLevel =
    | 'curated_rule'
    | 'curated_recipe'
    | 'external_snippet'
    | 'local_case'
    | 'benchmark_case'
    | 'unknown';

export interface DesignKnowledgeQuery {
    query: string;
    intents?: DesignKnowledgeIntent[];
    sourceTypes?: DesignKnowledgeSourceType[];
    limit?: number;
    memoryItems?: DesignMemoryItem[];
}

export interface DesignKnowledgeResult {
    id: string;
    title: string;
    intent: DesignKnowledgeIntent;
    sourceType: DesignKnowledgeSourceType;
    summary: string;
    evidence: string[];
    tags: string[];
    allowedUses: DesignKnowledgeAllowedUse[];
    evidenceLevel: DesignKnowledgeEvidenceLevel;
    sourceRank: number;
    sourceUrl?: string;
    updatedAt?: string;
}

export interface ExternalDesignKnowledgeInput {
    id?: string;
    title: string;
    intent?: DesignKnowledgeIntent;
    sourceType: Exclude<DesignKnowledgeSourceType, 'local_recipe' | 'manual_rule'>;
    summary: string;
    evidence?: string[];
    tags?: string[];
    allowedUses?: unknown[];
    evidenceLevel?: DesignKnowledgeEvidenceLevel;
    sourceRank?: number;
    sourceUrl?: string;
    updatedAt?: string;
}

export interface DesignKnowledgeSearchResponse {
    query: string;
    results: DesignKnowledgeResult[];
    providerSummary: {
        localRecipe: number;
        manualRule: number;
        externalSearch: number;
        webPage: number;
        localCase: number;
    };
    warnings: string[];
}

const ALLOWED_KNOWLEDGE_USES: readonly DesignKnowledgeAllowedUse[] = [
    'prompt_context',
    'user_reference',
    'recipe_hint',
    'benchmark_seed'
];

function normalizeText(value: unknown): string {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

function clampLimit(value: unknown): number {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return 8;
    return Math.max(1, Math.min(30, Math.floor(num)));
}

function normalizeEvidenceLevel(value: unknown, fallback: DesignKnowledgeEvidenceLevel): DesignKnowledgeEvidenceLevel {
    const allowed: readonly DesignKnowledgeEvidenceLevel[] = [
        'curated_rule',
        'curated_recipe',
        'external_snippet',
        'local_case',
        'benchmark_case',
        'unknown'
    ];
    return allowed.includes(value as DesignKnowledgeEvidenceLevel)
        ? value as DesignKnowledgeEvidenceLevel
        : fallback;
}

function clampSourceRank(value: unknown, fallback = 40): number {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(0, Math.min(100, Math.round(num)));
}

function normalizeAllowedUses(value: unknown[] | undefined): DesignKnowledgeAllowedUse[] {
    if (!Array.isArray(value)) return ['prompt_context', 'user_reference'];
    const filtered = value
        .filter((item): item is DesignKnowledgeAllowedUse => ALLOWED_KNOWLEDGE_USES.includes(item as DesignKnowledgeAllowedUse));
    return filtered.length ? Array.from(new Set(filtered)) : ['prompt_context', 'user_reference'];
}

function includesSourceType(query: DesignKnowledgeQuery, sourceType: DesignKnowledgeSourceType): boolean {
    return !Array.isArray(query.sourceTypes)
        || query.sourceTypes.length === 0
        || query.sourceTypes.includes(sourceType);
}

function includesIntent(query: DesignKnowledgeQuery, intent: DesignKnowledgeIntent): boolean {
    return !Array.isArray(query.intents)
        || query.intents.length === 0
        || query.intents.includes(intent);
}

export function normalizeExternalDesignKnowledgeResults(
    query: DesignKnowledgeQuery,
    inputs: ExternalDesignKnowledgeInput[]
): DesignKnowledgeResult[] {
    const queryText = normalizeText(query.query);
    const limit = clampLimit(query.limit);
    return inputs
        .filter((item) => includesSourceType(query, item.sourceType))
        .filter((item) => includesIntent(query, item.intent || 'reference'))
        .map((item, index): DesignKnowledgeResult => {
            const sourceKey = item.sourceType.replace(/_/g, '-');
            return {
                id: item.id || `${sourceKey}:${queryText || 'query'}:${index + 1}`,
                title: item.title,
                intent: item.intent || 'reference',
                sourceType: item.sourceType,
                summary: item.summary,
                evidence: Array.isArray(item.evidence) ? item.evidence : [],
                tags: Array.from(new Set([...(item.tags || []), item.sourceType])),
                allowedUses: normalizeAllowedUses(item.allowedUses),
                evidenceLevel: normalizeEvidenceLevel(item.evidenceLevel, 'external_snippet'),
                sourceRank: clampSourceRank(item.sourceRank, 42),
                sourceUrl: item.sourceUrl,
                updatedAt: item.updatedAt
            };
        })
        .sort((a, b) => b.sourceRank - a.sourceRank || a.title.localeCompare(b.title, 'zh-Hans-CN'))
        .slice(0, limit);
}

function recipeSearchText(recipe: ReferenceStyleRecipe): string {
    return normalizeText([
        recipe.id,
        recipe.label,
        recipe.maturity,
        recipe.sourceFields.join(' '),
        recipe.currentExecution,
        recipe.limitation
    ].join(' '));
}

function recipeMatches(recipe: ReferenceStyleRecipe, queryText: string): boolean {
    if (!queryText) return true;
    const haystack = recipeSearchText(recipe);
    return queryText
        .split(/\s+/)
        .filter(Boolean)
        .some((token) => haystack.includes(token));
}

function rankRecipe(recipe: ReferenceStyleRecipe, queryText: string): number {
    if (!queryText) return 62;
    const idOrLabel = normalizeText(`${recipe.id} ${recipe.label}`);
    if (queryText.split(/\s+/).some((token) => idOrLabel.includes(token))) {
        return 84;
    }
    return 70;
}

function recipeToKnowledgeResult(recipe: ReferenceStyleRecipe, queryText: string): DesignKnowledgeResult {
    return {
        id: `local-recipe:${recipe.id}`,
        title: recipe.label,
        intent: 'recipe',
        sourceType: 'local_recipe',
        summary: recipe.currentExecution,
        evidence: [
            `成熟度：${recipe.maturity}`,
            `来源字段：${recipe.sourceFields.join(', ')}`,
            `边界：${recipe.limitation}`
        ],
        tags: ['reference-replication', 'photoshop-style', recipe.id, recipe.maturity],
        allowedUses: ['prompt_context', 'recipe_hint'],
        evidenceLevel: 'curated_recipe',
        sourceRank: rankRecipe(recipe, queryText)
    };
}

function conceptIntent(concept: DesignDomainConcept): DesignKnowledgeIntent {
    if (concept.layer === 'recipe') return 'recipe';
    if (concept.layer === 'visual-case') return 'reference';
    return 'rule';
}

function conceptSearchText(concept: DesignDomainConcept): string {
    return normalizeText([
        concept.id,
        concept.zhName,
        concept.enName || '',
        concept.layer,
        concept.definition,
        concept.primaryGoal,
        concept.aliases.join(' '),
        concept.userIntentSignals.join(' '),
        concept.typicalInputs.join(' '),
        concept.typicalOutputs.join(' '),
        concept.commonModules.join(' '),
        concept.constraints.join(' '),
        concept.notThis.join(' ')
    ].join(' '));
}

function conceptMatches(concept: DesignDomainConcept, queryText: string): boolean {
    if (!queryText) return true;
    const haystack = conceptSearchText(concept);
    return queryText
        .split(/\s+/)
        .filter(Boolean)
        .some((token) => haystack.includes(token));
}

function rankConcept(concept: DesignDomainConcept, queryText: string): number {
    if (!queryText) return 58;
    const nameText = normalizeText([concept.id, concept.zhName, concept.enName || '', concept.aliases.join(' ')].join(' '));
    if (queryText.split(/\s+/).some((token) => nameText.includes(token))) {
        return 82;
    }
    return 66;
}

function conceptToKnowledgeResult(concept: DesignDomainConcept, queryText: string): DesignKnowledgeResult {
    const intent = conceptIntent(concept);
    return {
        id: `manual-rule:${concept.id}`,
        title: `${concept.zhName} / ${concept.id}`,
        intent,
        sourceType: 'manual_rule',
        summary: `${concept.definition} 目标：${concept.primaryGoal}`,
        evidence: [
            `层级：${concept.layer}`,
            `成熟度：${concept.maturity}`,
            `典型输入：${concept.typicalInputs.slice(0, 4).join(' / ')}`,
            `典型输出：${concept.typicalOutputs.slice(0, 4).join(' / ')}`,
            `边界：${concept.notThis.slice(0, 4).join(' / ')}`
        ],
        tags: ['design-domain', concept.layer, concept.id, concept.maturity],
        allowedUses: intent === 'recipe'
            ? ['prompt_context', 'recipe_hint']
            : ['prompt_context', 'user_reference'],
        evidenceLevel: 'curated_rule',
        sourceRank: rankConcept(concept, queryText)
    };
}

function copywritingFrameworkMatches(queryText: string): boolean {
    if (!queryText) return true;
    const triggerTokens = [
        'copywriting',
        'copy',
        '文案',
        '配文',
        '图文',
        '广告感',
        '卖点',
        '视觉锚点',
        '用户场景',
        '产品价值',
        '低广告感'
    ];
    if (triggerTokens.some((token) => queryText.includes(token))) return true;

    const haystack = normalizeText([
        ...triggerTokens,
        COPYWRITING_CORE_FORMULA,
        COPYWRITING_TEMPLATES.map((item) => item.name).join(' ')
    ].join(' '));
    return queryText
        .split(/\s+/)
        .filter(Boolean)
        .some((token) => haystack.includes(token));
}

function copywritingFrameworkToKnowledgeResult(): DesignKnowledgeResult {
    return {
        id: 'manual-rule:copywriting-framework',
        title: '图文文案撰写框架',
        intent: 'copywriting',
        sourceType: 'manual_rule',
        summary: formatCopywritingFrameworkForKnowledge(),
        evidence: [
            '结构：人群设定 -> 兴趣方向 -> 场景代入 -> 痛点转译 -> 情绪表达 -> 产品卖点 -> 可信证据 -> 图文匹配 -> 轻行动引导 -> 风险检查',
            'P-I-S-B-E-C：People -> Interest -> Scene -> Benefit -> Evidence -> Conversion',
            `可选模板：${COPYWRITING_TEMPLATES.map((item) => item.name).join(' / ')}`,
            `评分项：${COPYWRITING_SCORE_CRITERIA.map((item) => `${item.label}${item.points}分`).join(' / ')}`,
            '边界：没有目标人群、图片证据、产品事实或用户场景时，不能编造文案依据。'
        ],
        tags: ['copywriting', 'audience-interest', 'visual-anchor', 'user-scene', 'product-value', 'safety-check'],
        allowedUses: ['prompt_context', 'user_reference'],
        evidenceLevel: 'curated_rule',
        sourceRank: 86
    };
}

export function searchLocalDesignKnowledge(query: DesignKnowledgeQuery): DesignKnowledgeSearchResponse {
    const queryText = normalizeText(query.query);
    const limit = clampLimit(query.limit);
    const warnings: string[] = [];
    const results: DesignKnowledgeResult[] = [];

    if (includesIntent(query, 'recipe') && includesSourceType(query, 'local_recipe')) {
        results.push(
            ...REFERENCE_STYLE_RECIPES
                .filter((recipe) => recipeMatches(recipe, queryText))
                .map((recipe) => recipeToKnowledgeResult(recipe, queryText))
        );
    }

    if (includesSourceType(query, 'manual_rule')) {
        results.push(
            ...DESIGN_DOMAIN_CONCEPTS
                .filter((concept) => includesIntent(query, conceptIntent(concept)))
                .filter((concept) => conceptMatches(concept, queryText))
                .map((concept) => conceptToKnowledgeResult(concept, queryText))
        );
    }

    if (
        includesSourceType(query, 'manual_rule')
        && includesIntent(query, 'copywriting')
        && copywritingFrameworkMatches(queryText)
    ) {
        results.push(copywritingFrameworkToKnowledgeResult());
    }

    if (includesSourceType(query, 'local_case')) {
        results.push(...searchDesignMemoryKnowledge(query, query.memoryItems));
    }

    results.sort((a, b) => b.sourceRank - a.sourceRank || a.title.localeCompare(b.title, 'zh-Hans-CN'));

    if (!results.length) {
        warnings.push('当前本地知识 MVP 只覆盖 Photoshop style recipe 和设计领域手工规则；外部网页搜索和案例库尚未接入统一结果。');
    }

    return {
        query: query.query,
        results: results.slice(0, limit),
        providerSummary: {
            localRecipe: results.filter((item) => item.sourceType === 'local_recipe').length,
            manualRule: results.filter((item) => item.sourceType === 'manual_rule').length,
            externalSearch: 0,
            webPage: 0,
            localCase: results.filter((item) => item.sourceType === 'local_case').length
        },
        warnings
    };
}
