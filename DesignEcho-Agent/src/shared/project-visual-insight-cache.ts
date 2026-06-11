import type { EvidenceRef } from './design-agent-os-contracts';
import type { ProjectVisualSamplingCacheEntry, ProjectVisualInsight } from './project-visual-sampling';

export type ProjectVisualInsightCacheVersion = 'project-visual-insight-cache/v0';
export type ProjectVisualInsightCacheSource = 'persisted-project-cache' | 'provided-options' | 'missing' | 'invalid';

export interface ProjectVisualInsightCacheManifest {
    cacheVersion: ProjectVisualInsightCacheVersion;
    projectPath?: string;
    updatedAt: string;
    entries: ProjectVisualSamplingCacheEntry[];
    warnings: string[];
    limitations: string[];
    evidence: EvidenceRef[];
}

export interface ProjectVisualInsightCacheSummary {
    totalEntries: number;
    entriesWithInsight: number;
    entriesWithRawPayloadRemoved: number;
}

export interface ProjectVisualInsightCacheReadResult {
    cacheVersion: ProjectVisualInsightCacheVersion;
    source: ProjectVisualInsightCacheSource;
    cachePath?: string;
    exists: boolean;
    entries: ProjectVisualSamplingCacheEntry[];
    summary: ProjectVisualInsightCacheSummary;
    warnings: string[];
    limitations: string[];
    evidence: EvidenceRef[];
}

export interface BuildProjectVisualInsightCacheManifestInput {
    projectPath?: string;
    entries?: ProjectVisualSamplingCacheEntry[];
    nowIso?: string;
}

export interface BuildProjectVisualInsightCacheReadResultInput {
    source: ProjectVisualInsightCacheSource;
    cachePath?: string;
    exists?: boolean;
    entries?: ProjectVisualSamplingCacheEntry[];
    warning?: string;
    nowIso?: string;
}

function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

function normalizePath(value: unknown): string {
    return normalizeText(value).replace(/\\/g, '/');
}

function removeRawPayloadFields(value: unknown): { value: unknown; removed: number } {
    if (!value || typeof value !== 'object') {
        return { value, removed: 0 };
    }
    if (Array.isArray(value)) {
        let removed = 0;
        const next = value.map((item) => {
            const result = removeRawPayloadFields(item);
            removed += result.removed;
            return result.value;
        });
        return { value: next, removed };
    }

    const rawPayloadKeys = new Set([
        'base64',
        'imageBase64',
        'rawImage',
        'rawImageBase64',
        'pixels',
        'buffer',
        'dataUrl'
    ]);
    let removed = 0;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (rawPayloadKeys.has(key)) {
            removed += 1;
            continue;
        }
        const result = removeRawPayloadFields(item);
        removed += result.removed;
        next[key] = result.value;
    }
    return { value: next, removed };
}

function sanitizeInsight(insight: ProjectVisualInsight | undefined): { insight?: ProjectVisualInsight; rawRemoved: number } {
    if (!insight || typeof insight !== 'object') {
        return { rawRemoved: 0 };
    }

    const stripped = removeRawPayloadFields(insight);
    const source = stripped.value as ProjectVisualInsight;
    const sanitized: ProjectVisualInsight = {
        assetId: normalizeText(source.assetId),
        path: normalizePath(source.path),
        summary: normalizeText(source.summary) || undefined,
        productType: normalizeText(source.productType) || undefined,
        scene: normalizeText(source.scene) || undefined,
        material: normalizeText(source.material) || undefined,
        styleTags: Array.isArray(source.styleTags)
            ? source.styleTags.map(normalizeText).filter(Boolean).slice(0, 12)
            : undefined,
        capturedAt: normalizeText(source.capturedAt) || undefined,
        modelId: normalizeText(source.modelId) || undefined,
        expiresAt: normalizeText(source.expiresAt) || undefined,
        evidence: Array.isArray(source.evidence) ? source.evidence : undefined
    };

    if (!sanitized.assetId && !sanitized.path) {
        return { rawRemoved: stripped.removed };
    }

    return { insight: sanitized, rawRemoved: stripped.removed };
}

export function sanitizeProjectVisualInsightCacheEntries(
    entries: ProjectVisualSamplingCacheEntry[] | undefined
): { entries: ProjectVisualSamplingCacheEntry[]; rawPayloadRemoved: number } {
    const sanitizedEntries: ProjectVisualSamplingCacheEntry[] = [];
    let rawPayloadRemoved = 0;
    const seen = new Set<string>();

    for (const entry of entries || []) {
        if (!entry || typeof entry !== 'object') continue;
        const cacheKey = normalizeText(entry.cacheKey);
        const assetId = normalizeText(entry.assetId);
        const path = normalizePath(entry.path);
        const dedupeKey = cacheKey || assetId || path;
        if (!dedupeKey || seen.has(dedupeKey)) continue;

        const insightResult = sanitizeInsight(entry.insight);
        rawPayloadRemoved += insightResult.rawRemoved;
        const sanitized: ProjectVisualSamplingCacheEntry = {
            cacheKey: cacheKey || dedupeKey,
            assetId: assetId || undefined,
            path: path || undefined,
            updatedAt: normalizeText(entry.updatedAt) || undefined,
            expiresAt: normalizeText(entry.expiresAt) || insightResult.insight?.expiresAt,
            insight: insightResult.insight,
            evidence: Array.isArray(entry.evidence) ? entry.evidence : undefined
        };

        sanitizedEntries.push(sanitized);
        seen.add(dedupeKey);
    }

    return { entries: sanitizedEntries, rawPayloadRemoved };
}

function buildSummary(entries: ProjectVisualSamplingCacheEntry[], rawPayloadRemoved: number): ProjectVisualInsightCacheSummary {
    return {
        totalEntries: entries.length,
        entriesWithInsight: entries.filter((entry) => Boolean(entry.insight)).length,
        entriesWithRawPayloadRemoved: rawPayloadRemoved
    };
}

export function buildProjectVisualInsightCacheManifest(
    input: BuildProjectVisualInsightCacheManifestInput
): ProjectVisualInsightCacheManifest {
    const nowIso = input.nowIso || new Date().toISOString();
    const sanitized = sanitizeProjectVisualInsightCacheEntries(input.entries);
    return {
        cacheVersion: 'project-visual-insight-cache/v0',
        projectPath: input.projectPath ? normalizePath(input.projectPath) : undefined,
        updatedAt: nowIso,
        entries: sanitized.entries,
        warnings: sanitized.rawPayloadRemoved > 0
            ? ['视觉缓存写入时已移除 raw image/base64/pixel payload 字段。']
            : [],
        limitations: [
            'VisualInsightCache 只保存已有视觉证据，不主动读取图片像素或调用视觉模型。',
            '缓存命中只能减少重复分析，不能证明图片已经适合某个设计方案。',
            '缓存内容必须来自真实视觉模型或人工观察，不能从文件名编造款式、材质、场景或卖点。'
        ],
        evidence: [{
            source: 'project-visual-insight-cache',
            summary: `Prepared ${sanitized.entries.length} visual insight cache entries.`,
            status: sanitized.entries.length > 0 ? 'needs_review' : 'unknown'
        }]
    };
}

export function buildProjectVisualInsightCacheReadResult(
    input: BuildProjectVisualInsightCacheReadResultInput
): ProjectVisualInsightCacheReadResult {
    const sanitized = sanitizeProjectVisualInsightCacheEntries(input.entries);
    const warnings = [
        input.warning || '',
        sanitized.rawPayloadRemoved > 0 ? '视觉缓存读取时发现并移除了 raw image/base64/pixel payload 字段。' : ''
    ].filter(Boolean);

    return {
        cacheVersion: 'project-visual-insight-cache/v0',
        source: input.source,
        cachePath: input.cachePath ? normalizePath(input.cachePath) : undefined,
        exists: Boolean(input.exists),
        entries: sanitized.entries,
        summary: buildSummary(sanitized.entries, sanitized.rawPayloadRemoved),
        warnings,
        limitations: [
            'VisualInsightCache 是 ContextSnapshot 的只读证据来源，不是 Photoshop 执行结果。',
            '缓存缺失或过期时只能标记 needs vision，不能编造视觉结论。',
            '缓存命中不代表审美质量、主图质量、详情页质量或 SKU 质量通过。'
        ],
        evidence: [{
            source: 'project-visual-insight-cache',
            summary: `${input.source} returned ${sanitized.entries.length} visual insight entries.`,
            status: sanitized.entries.length > 0 ? 'needs_review' : 'unknown'
        }]
    };
}
