import {
    normalizeExternalDesignKnowledgeResults,
    type DesignKnowledgeQuery,
    type DesignKnowledgeResult
} from './design-knowledge-search';

export type EagleReadonlyKnowledgeVersion = 'eagle-readonly-knowledge/v0';
export type EagleReadonlyStatus = 'disabled' | 'ok' | 'unavailable';
export type EagleReadonlyToolName =
    | 'get_app_info'
    | 'item_query'
    | 'item_get'
    | 'item_get_selected'
    | 'item_count'
    | 'folder_get'
    | 'tag_get'
    | 'tag_count'
    | 'tag_group_get'
    | 'ai_search_status'
    | 'ai_search_by_text'
    | 'ai_search_by_item';

export const EAGLE_READONLY_KNOWLEDGE_VERSION: EagleReadonlyKnowledgeVersion = 'eagle-readonly-knowledge/v0';
export const EAGLE_MCP_DEFAULT_ENDPOINT = 'http://127.0.0.1:41596';

export const EAGLE_READONLY_TOOL_NAMES: readonly EagleReadonlyToolName[] = [
    'get_app_info',
    'item_query',
    'item_get',
    'item_get_selected',
    'item_count',
    'folder_get',
    'tag_get',
    'tag_count',
    'tag_group_get',
    'ai_search_status',
    'ai_search_by_text',
    'ai_search_by_item'
];

const RAW_IMAGE_KEYS = new Set([
    'base64',
    'imageBase64',
    'imageData',
    'rawImage',
    'rawImages',
    'buffer',
    'bytes',
    'data'
]);

export interface EagleReadonlySettings {
    enabled?: boolean;
    endpoint?: string;
    timeoutMs?: number;
}

export interface EagleReadonlyKnowledgeQuery extends Pick<DesignKnowledgeQuery, 'query' | 'limit'> {
    preferAiSearch?: boolean;
    tags?: string[];
    folders?: string[];
    ext?: string;
    selectedOnly?: boolean;
}

export interface EagleRawItemLike {
    id?: unknown;
    name?: unknown;
    title?: unknown;
    ext?: unknown;
    tags?: unknown;
    folders?: unknown;
    width?: unknown;
    height?: unknown;
    annotation?: unknown;
    filePath?: unknown;
    thumbnailPath?: unknown;
    url?: unknown;
    star?: unknown;
    rating?: unknown;
    score?: unknown;
    palettes?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
    modificationTime?: unknown;
    [key: string]: unknown;
}

export interface EagleReadonlyBoundary {
    readonly: true;
    doesNotWriteEagle: true;
    doesNotRunPhotoshop: true;
    doesNotReturnRawImages: true;
    allowedTools: readonly EagleReadonlyToolName[];
}

export interface EagleReadonlyKnowledgeResponse {
    version: EagleReadonlyKnowledgeVersion;
    status: EagleReadonlyStatus;
    query: string;
    results: DesignKnowledgeResult[];
    providerSummary: {
        eagleLibrary: number;
    };
    warnings: string[];
    boundaries: EagleReadonlyBoundary;
}

export interface EagleMcpToolCallBody {
    tool: EagleReadonlyToolName;
    params: Record<string, unknown>;
}

export function normalizeEagleReadonlySettings(settings: Partial<EagleReadonlySettings> | undefined): Required<EagleReadonlySettings> {
    return {
        enabled: settings?.enabled !== false,
        endpoint: normalizeEndpoint(settings?.endpoint),
        timeoutMs: clampNumber(settings?.timeoutMs, 1000, 30000, 8000)
    };
}

export function buildEagleReadonlyBoundary(): EagleReadonlyBoundary {
    return {
        readonly: true,
        doesNotWriteEagle: true,
        doesNotRunPhotoshop: true,
        doesNotReturnRawImages: true,
        allowedTools: EAGLE_READONLY_TOOL_NAMES
    };
}

export function buildEagleMcpToolCallBody(tool: string, params: Record<string, unknown> = {}): EagleMcpToolCallBody {
    if (!EAGLE_READONLY_TOOL_NAMES.includes(tool as EagleReadonlyToolName)) {
        throw new Error(`Eagle readonly connector rejected non-readonly tool: ${tool || 'unknown_tool'}`);
    }
    return {
        tool: tool as EagleReadonlyToolName,
        params: sanitizeParams(params)
    };
}

export function normalizeEagleReadonlyKnowledgeResults(
    query: EagleReadonlyKnowledgeQuery,
    items: unknown,
    options: {
        nowIso?: string;
        sourceTool?: EagleReadonlyToolName;
        warnings?: string[];
        status?: EagleReadonlyStatus;
    } = {}
): EagleReadonlyKnowledgeResponse {
    const normalizedQuery = normalizeText(query.query);
    const rawItems = extractItemArray(items);
    const knowledgeInputs = rawItems.map((item, index) => eagleItemToKnowledgeInput(item, index, options));
    const results = normalizeExternalDesignKnowledgeResults(
        {
            query: normalizedQuery,
            intents: ['reference'],
            sourceTypes: ['eagle_library'],
            limit: clampLimit(query.limit)
        },
        knowledgeInputs
    );

    const response: EagleReadonlyKnowledgeResponse = {
        version: EAGLE_READONLY_KNOWLEDGE_VERSION,
        status: options.status || 'ok',
        query: normalizedQuery,
        results,
        providerSummary: {
            eagleLibrary: results.length
        },
        warnings: [...(options.warnings || [])],
        boundaries: buildEagleReadonlyBoundary()
    };

    if (!isEagleReadonlyKnowledgePayloadSafe(response)) {
        response.warnings.push('Eagle 只读知识结果已拦截 raw image/base64 字段，请检查连接器字段清洗。');
        return {
            ...response,
            results: response.results.map((result) => ({
                ...result,
                evidence: result.evidence.filter((line) => !containsRawImageSignal(line)),
                summary: containsRawImageSignal(result.summary) ? 'Eagle 只读素材结果已移除原始图片内容。' : result.summary
            }))
        };
    }

    return response;
}

export function buildEagleReadonlyUnavailableResponse(
    query: EagleReadonlyKnowledgeQuery,
    message: string,
    status: EagleReadonlyStatus = 'unavailable'
): EagleReadonlyKnowledgeResponse {
    return {
        version: EAGLE_READONLY_KNOWLEDGE_VERSION,
        status,
        query: normalizeText(query.query),
        results: [],
        providerSummary: {
            eagleLibrary: 0
        },
        warnings: [message],
        boundaries: buildEagleReadonlyBoundary()
    };
}

export function isEagleReadonlyKnowledgePayloadSafe(value: unknown): boolean {
    return !containsRawImageSignal(JSON.stringify(value || ''));
}

function eagleItemToKnowledgeInput(
    raw: EagleRawItemLike,
    index: number,
    options: {
        nowIso?: string;
        sourceTool?: EagleReadonlyToolName;
    }
) {
    const item = sanitizeRawItem(raw);
    const id = normalizeText(item.id) || `item-${index + 1}`;
    const title = normalizeText(item.name) || normalizeText(item.title) || `Eagle item ${index + 1}`;
    const tags = normalizeStringArray(item.tags);
    const folders = normalizeStringArray(item.folders);
    const extension = normalizeText(item.ext).replace(/^\./, '').toLowerCase();
    const width = positiveInteger(item.width);
    const height = positiveInteger(item.height);
    const annotation = normalizeText(item.annotation);
    const sourceUrl = normalizeUrl(item.url);
    const sourceTool = options.sourceTool || 'item_query';
    const dimensions = width && height ? `${width}x${height}` : '';
    const fileRef = normalizeText(item.filePath);
    const thumbnailRef = normalizeText(item.thumbnailPath);
    const evidence = [
        `Eagle item id: ${id}`,
        sourceTool ? `Eagle readonly tool: ${sourceTool}` : '',
        dimensions ? `Image dimensions: ${dimensions}` : '',
        extension ? `Extension: ${extension}` : '',
        tags.length ? `Tags: ${tags.slice(0, 12).join(', ')}` : '',
        folders.length ? `Folders: ${folders.slice(0, 8).join(', ')}` : '',
        fileRef ? `Local file reference: ${fileRef}` : '',
        thumbnailRef ? `Thumbnail reference: ${thumbnailRef}` : '',
        'Boundary: Eagle item is readonly reference evidence; it is not a Photoshop action and raw image bytes are not loaded.'
    ].filter(Boolean);

    return {
        id: `eagle:${id}`,
        title,
        intent: 'reference' as const,
        sourceType: 'eagle_library' as const,
        summary: buildSummary({ title, annotation, tags, extension, dimensions }),
        evidence,
        tags: uniqueStrings(['eagle', 'readonly', 'local-case', extension, ...tags].filter(Boolean)),
        allowedUses: ['prompt_context', 'user_reference'],
        evidenceLevel: 'local_case' as const,
        sourceRank: rankEagleItem(item, tags, annotation, width, height),
        sourceUrl: sourceUrl || (id ? `eagle://item/${encodeURIComponent(id)}` : undefined),
        updatedAt: normalizeText(item.updatedAt) || normalizeText(item.modificationTime) || options.nowIso
    };
}

function sanitizeRawItem(raw: EagleRawItemLike): EagleRawItemLike {
    const result: EagleRawItemLike = {};
    for (const [key, value] of Object.entries(raw || {})) {
        if (RAW_IMAGE_KEYS.has(key)) continue;
        if (containsRawImageSignal(value)) continue;
        result[key] = value;
    }
    return result;
}

function sanitizeParams(params: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params || {})) {
        if (RAW_IMAGE_KEYS.has(key)) continue;
        if (containsRawImageSignal(value)) continue;
        result[key] = value;
    }
    return result;
}

function extractItemArray(value: unknown): EagleRawItemLike[] {
    if (Array.isArray(value)) return value as EagleRawItemLike[];
    if (value && typeof value === 'object') {
        const objectValue = value as Record<string, unknown>;
        for (const key of ['items', 'data', 'result', 'results']) {
            const nested = objectValue[key];
            if (Array.isArray(nested)) return nested as EagleRawItemLike[];
        }
        if (objectValue.result && typeof objectValue.result === 'object') {
            return extractItemArray(objectValue.result);
        }
    }
    return [];
}

function rankEagleItem(
    item: EagleRawItemLike,
    tags: string[],
    annotation: string,
    width?: number,
    height?: number
): number {
    const score = Number(item.score);
    if (Number.isFinite(score)) return Math.max(45, Math.min(95, Math.round(score * 100)));
    const star = Number(item.star ?? item.rating);
    const starBonus = Number.isFinite(star) ? Math.max(0, Math.min(10, Math.round(star * 2))) : 0;
    const metadataBonus = (tags.length ? 8 : 0) + (annotation ? 8 : 0) + (width && height ? 6 : 0);
    return Math.max(45, Math.min(88, 52 + starBonus + metadataBonus));
}

function buildSummary(input: {
    title: string;
    annotation: string;
    tags: string[];
    extension: string;
    dimensions: string;
}): string {
    const parts = [
        input.annotation,
        input.tags.length ? `Tags: ${input.tags.slice(0, 8).join(', ')}` : '',
        input.dimensions ? `Size: ${input.dimensions}` : '',
        input.extension ? `Format: ${input.extension}` : ''
    ].filter(Boolean);
    return parts.length ? parts.join(' | ') : `Eagle readonly library item: ${input.title}`;
}

function normalizeEndpoint(value: unknown): string {
    const text = normalizeText(value) || EAGLE_MCP_DEFAULT_ENDPOINT;
    return text.replace(/\/+$/, '');
}

function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

function clampLimit(value: unknown): number {
    return clampNumber(value, 1, 30, 8);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return uniqueStrings(value.map(normalizeText).filter(Boolean));
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.map(normalizeText).filter(Boolean)));
}

function positiveInteger(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;
}

function normalizeUrl(value: unknown): string | undefined {
    const text = normalizeText(value);
    if (!/^https?:\/\//i.test(text)) return undefined;
    return text;
}

function containsRawImageSignal(value: unknown): boolean {
    const text = typeof value === 'string' ? value : JSON.stringify(value || '');
    return /data:image|;base64,|"imageBase64"|"rawImage"|"rawImages"|"buffer"|"bytes"/i.test(text);
}
