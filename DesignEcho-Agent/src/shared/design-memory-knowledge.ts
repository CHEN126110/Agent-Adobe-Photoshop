import type {
    DesignKnowledgeAllowedUse,
    DesignKnowledgeIntent,
    DesignKnowledgeQuery,
    DesignKnowledgeResult
} from './design-knowledge-search';

export type DesignMemoryKind =
    | 'user_preference'
    | 'brand_preference'
    | 'project_rule'
    | 'approved_recipe'
    | 'rejected_pattern'
    | 'visual_case'
    | 'benchmark_case'
    | 'failure_pattern';

export type DesignMemoryScopeType = 'user' | 'project' | 'brand' | 'session';
export type DesignMemoryStatus = 'active' | 'disabled' | 'superseded' | 'expired';
export type DesignMemorySource =
    | 'explicit_user_feedback'
    | 'manual_setting'
    | 'accepted_output'
    | 'rejected_output'
    | 'imported_case'
    | 'benchmark'
    | 'inferred_from_operations'
    | 'legacy_local_preference';

export interface DesignMemoryScope {
    type: DesignMemoryScopeType;
    id?: string;
}

export interface DesignMemoryEvidence {
    source: string;
    summary: string;
    status?: 'active' | 'needs_review' | 'disabled';
}

export interface DesignMemoryItem {
    id: string;
    kind: DesignMemoryKind;
    scope: DesignMemoryScope;
    status?: DesignMemoryStatus;
    source: DesignMemorySource;
    title: string;
    summary: string;
    evidence: DesignMemoryEvidence[];
    tags?: string[];
    appliesTo?: DesignKnowledgeIntent[];
    allowedUses?: unknown[];
    sourceRank?: number;
    createdAt?: string | number;
    updatedAt?: string | number;
    expiresAt?: string | number;
}

export interface DesignMemoryPreferenceSnapshot {
    design?: {
        preferredFonts?: string[];
        preferredColors?: string[];
        preferredStyles?: string[];
        defaultAlignment?: string;
        defaultSpacing?: number;
    };
    interaction?: {
        verbosity?: string;
        confirmBeforeExecute?: boolean;
        autoSave?: boolean;
        showThinking?: boolean;
    };
    workflow?: {
        defaultExportFormat?: string;
        defaultExportQuality?: number;
        autoBeautify?: boolean;
    };
}

export interface BuildDesignMemoryItemsFromPreferencesOptions {
    scope?: DesignMemoryScope;
    now?: string | number;
}

const FORBIDDEN_PAYLOAD_PATTERNS = [
    /raw-image-payload/gi,
    /base64-image-payload/gi,
    /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi,
    /data:image\//gi
];

function cleanString(value: unknown): string {
    let text = String(value || '').trim();
    for (const pattern of FORBIDDEN_PAYLOAD_PATTERNS) {
        text = text.replace(pattern, '[redacted-image-payload]');
    }
    return text.replace(/\s+/g, ' ').trim();
}

function cleanStrings(values: unknown): string[] {
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(values.map(cleanString).filter(Boolean)));
}

function normalizeDateTime(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'number' && Number.isFinite(value)) {
        return new Date(value).toISOString();
    }
    const text = cleanString(value);
    if (!text) return undefined;
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : text;
}

function hasExpired(item: DesignMemoryItem, nowMs = Date.now()): boolean {
    const expiresAt = normalizeDateTime(item.expiresAt);
    if (!expiresAt) return false;
    const parsed = Date.parse(expiresAt);
    return Number.isFinite(parsed) && parsed <= nowMs;
}

function clampSourceRank(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(100, Math.round(parsed)));
}

function defaultSourceRank(item: DesignMemoryItem): number {
    if (item.status && item.status !== 'active') return 0;
    switch (item.source) {
        case 'explicit_user_feedback':
            return 88;
        case 'manual_setting':
            return 78;
        case 'accepted_output':
            return 74;
        case 'benchmark':
            return 72;
        case 'imported_case':
            return 64;
        case 'rejected_output':
            return 62;
        case 'legacy_local_preference':
        case 'inferred_from_operations':
            return 52;
        default:
            return 40;
    }
}

function intentForMemoryKind(kind: DesignMemoryKind): DesignKnowledgeIntent {
    if (kind === 'approved_recipe') return 'recipe';
    if (kind === 'visual_case' || kind === 'benchmark_case') return 'reference';
    return 'rule';
}

function defaultAllowedUses(kind: DesignMemoryKind): DesignKnowledgeAllowedUse[] {
    if (kind === 'benchmark_case') return ['prompt_context', 'benchmark_seed'];
    if (kind === 'approved_recipe') return ['prompt_context', 'user_reference', 'recipe_hint'];
    return ['prompt_context', 'user_reference'];
}

function normalizeAllowedUses(kind: DesignMemoryKind, value: unknown): DesignKnowledgeAllowedUse[] {
    const allowed: readonly DesignKnowledgeAllowedUse[] = [
        'prompt_context',
        'user_reference',
        'recipe_hint',
        'benchmark_seed'
    ];
    const input = Array.isArray(value) ? value : defaultAllowedUses(kind);
    const filtered = input
        .filter((item): item is DesignKnowledgeAllowedUse => allowed.includes(item as DesignKnowledgeAllowedUse));
    return Array.from(new Set(filtered.length ? filtered : defaultAllowedUses(kind)));
}

function memorySearchText(item: DesignMemoryItem): string {
    return [
        item.id,
        item.kind,
        item.scope?.type,
        item.scope?.id,
        item.source,
        item.title,
        item.summary,
        ...(item.tags || []),
        ...(item.evidence || []).flatMap((entry) => [entry.source, entry.summary])
    ].map(cleanString).join(' ').toLowerCase();
}

function knowledgeSearchText(item: DesignKnowledgeResult): string {
    return [
        item.id,
        item.intent,
        item.sourceType,
        item.title,
        item.summary,
        ...item.evidence,
        ...item.tags
    ].map(cleanString).join(' ').toLowerCase();
}

function matchesQueryText(text: string, queryText: string): boolean {
    if (!queryText) return true;
    return queryText
        .split(/\s+/)
        .filter(Boolean)
        .some((token) => text.includes(token));
}

function includesIntent(query: Pick<DesignKnowledgeQuery, 'intents'>, intent: DesignKnowledgeIntent): boolean {
    return !Array.isArray(query.intents)
        || query.intents.length === 0
        || query.intents.includes(intent);
}

function includesLocalCase(query: Pick<DesignKnowledgeQuery, 'sourceTypes'>): boolean {
    return !Array.isArray(query.sourceTypes)
        || query.sourceTypes.length === 0
        || query.sourceTypes.includes('local_case');
}

function normalizeMemoryItem(item: DesignMemoryItem): DesignMemoryItem | undefined {
    const id = cleanString(item.id);
    const title = cleanString(item.title);
    const summary = cleanString(item.summary);
    if (!id || !title || !summary) return undefined;
    return {
        ...item,
        id,
        title,
        summary,
        status: item.status || 'active',
        scope: {
            type: item.scope?.type || 'user',
            id: cleanString(item.scope?.id) || undefined
        },
        evidence: (Array.isArray(item.evidence) ? item.evidence : [])
            .map((entry) => ({
                source: cleanString(entry.source),
                summary: cleanString(entry.summary),
                status: entry.status
            }))
            .filter((entry) => entry.source && entry.summary),
        tags: cleanStrings(item.tags),
        appliesTo: Array.isArray(item.appliesTo) ? item.appliesTo : undefined,
        createdAt: normalizeDateTime(item.createdAt),
        updatedAt: normalizeDateTime(item.updatedAt),
        expiresAt: normalizeDateTime(item.expiresAt)
    };
}

export function designMemoryItemToKnowledgeResult(item: DesignMemoryItem): DesignKnowledgeResult | undefined {
    const normalized = normalizeMemoryItem(item);
    if (!normalized) return undefined;
    if (normalized.status !== 'active') return undefined;
    if (hasExpired(normalized)) return undefined;

    const intent = normalized.appliesTo?.[0] || intentForMemoryKind(normalized.kind);
    return {
        id: `local-memory:${normalized.id}`,
        title: normalized.title,
        intent,
        sourceType: 'local_case',
        summary: normalized.summary,
        evidence: [
            `记忆类型：${normalized.kind}`,
            `记忆范围：${normalized.scope.type}${normalized.scope.id ? `/${normalized.scope.id}` : ''}`,
            `来源：${normalized.source}`,
            ...normalized.evidence.map((entry) => `${entry.source}：${entry.summary}`)
        ],
        tags: Array.from(new Set(['design-memory', normalized.kind, normalized.source, ...(normalized.tags || [])])),
        allowedUses: normalizeAllowedUses(normalized.kind, normalized.allowedUses),
        evidenceLevel: 'local_case',
        sourceRank: clampSourceRank(normalized.sourceRank, defaultSourceRank(normalized)),
        updatedAt: normalizeDateTime(normalized.updatedAt || normalized.createdAt)
    };
}

export function searchDesignMemoryKnowledge(
    query: Pick<DesignKnowledgeQuery, 'query' | 'intents' | 'sourceTypes' | 'limit'>,
    memoryItems: DesignMemoryItem[] | undefined
): DesignKnowledgeResult[] {
    if (!includesLocalCase(query)) return [];
    const queryText = cleanString(query.query).toLowerCase();
    const limit = Math.max(1, Math.min(30, Math.floor(Number(query.limit) || 8)));
    return (memoryItems || [])
        .filter((item) => matchesQueryText(memorySearchText(item), queryText))
        .map(designMemoryItemToKnowledgeResult)
        .filter((item): item is DesignKnowledgeResult => Boolean(item))
        .filter((item) => includesIntent(query, item.intent))
        .filter((item) => matchesQueryText(knowledgeSearchText(item), queryText))
        .sort((a, b) => b.sourceRank - a.sourceRank || a.title.localeCompare(b.title, 'zh-Hans-CN'))
        .slice(0, limit);
}

function memoryItem(input: Omit<DesignMemoryItem, 'status' | 'scope' | 'evidence'> & {
    scope?: DesignMemoryScope;
    evidenceSummary: string;
    now?: string | number;
}): DesignMemoryItem {
    const timestamp = normalizeDateTime(input.now) || new Date().toISOString();
    return {
        ...input,
        scope: input.scope || { type: 'user' },
        status: 'active',
        evidence: [{
            source: input.source,
            summary: input.evidenceSummary,
            status: input.source === 'inferred_from_operations' ? 'needs_review' : 'active'
        }],
        createdAt: timestamp,
        updatedAt: timestamp
    };
}

export function buildDesignMemoryItemsFromUserPreferences(
    preferences: DesignMemoryPreferenceSnapshot,
    options: BuildDesignMemoryItemsFromPreferencesOptions = {}
): DesignMemoryItem[] {
    const scope = options.scope || { type: 'user' as const };
    const now = options.now || new Date().toISOString();
    const items: DesignMemoryItem[] = [];

    for (const font of cleanStrings(preferences.design?.preferredFonts).slice(0, 10)) {
        items.push(memoryItem({
            id: `user-preference-font-${font.toLowerCase()}`,
            kind: 'user_preference',
            source: 'inferred_from_operations',
            title: `常用字体：${font}`,
            summary: `用户历史操作中多次使用或记录了字体 ${font}，只能作为排版候选偏好。`,
            tags: ['font', 'typography', font],
            allowedUses: ['prompt_context', 'user_reference'],
            sourceRank: 52,
            scope,
            now,
            evidenceSummary: '来自本地记忆的字体偏好，未等同于当前任务要求。'
        }));
    }

    for (const color of cleanStrings(preferences.design?.preferredColors).slice(0, 12)) {
        items.push(memoryItem({
            id: `user-preference-color-${color.toLowerCase()}`,
            kind: 'user_preference',
            source: 'inferred_from_operations',
            title: `常用颜色：${color}`,
            summary: `用户历史操作中记录了颜色 ${color}，只能作为配色候选偏好。`,
            tags: ['color', color],
            allowedUses: ['prompt_context', 'user_reference'],
            sourceRank: 52,
            scope,
            now,
            evidenceSummary: '来自本地记忆的颜色偏好，不能覆盖商品、品牌或平台规范。'
        }));
    }

    for (const style of cleanStrings(preferences.design?.preferredStyles).slice(0, 8)) {
        items.push(memoryItem({
            id: `user-preference-style-${style.toLowerCase()}`,
            kind: 'user_preference',
            source: 'manual_setting',
            title: `偏好风格：${style}`,
            summary: `用户偏好风格为 ${style}，可影响策略排序，但不能替代视觉证据。`,
            tags: ['style', style],
            allowedUses: ['prompt_context', 'user_reference'],
            sourceRank: 78,
            scope,
            now,
            evidenceSummary: '来自用户偏好设置。'
        }));
    }

    const exportFormat = cleanString(preferences.workflow?.defaultExportFormat);
    if (exportFormat && exportFormat.toLowerCase() !== 'png') {
        items.push(memoryItem({
            id: `user-preference-export-format-${exportFormat.toLowerCase()}`,
            kind: 'user_preference',
            source: 'manual_setting',
            title: `默认导出格式：${exportFormat}`,
            summary: `用户工作流默认导出格式为 ${exportFormat}。`,
            tags: ['workflow', 'export', exportFormat],
            allowedUses: ['prompt_context', 'user_reference'],
            sourceRank: 76,
            scope,
            now,
            evidenceSummary: '来自用户工作流偏好设置。'
        }));
    }

    return items;
}
