import type {
    DesignKnowledgeQuery,
    DesignKnowledgeResult,
    DesignKnowledgeSourceType
} from '../../shared/design-knowledge-search';
import type { DesignKnowledgeRuntimeSettings } from '../../shared/design-knowledge-settings';
import { getMemoryService } from './memory.service';

export type KnowledgeLibrarySearchScope = 'all' | 'managed' | 'built_in' | 'eagle' | 'web';

export interface KnowledgeLibrarySearchInput {
    query: string;
    scope: KnowledgeLibrarySearchScope;
    limit?: number;
    settings?: DesignKnowledgeRuntimeSettings;
}

export interface KnowledgeLibrarySearchResponse {
    query: string;
    results: DesignKnowledgeResult[];
    disabledResults: DesignKnowledgeResult[];
    warnings: string[];
    sourceCounts: {
        managed: number;
        builtIn: number;
        eagle: number;
        web: number;
    };
}

export interface EagleKnowledgeAnalysisObservation {
    analysisSource: string;
    productCategory?: string;
    designType?: string;
    summary: string;
    strengths: Array<{
        aspect: string;
        observation: string;
        reason: string;
        suitableFor?: string[];
    }>;
    suitableScenarios: string[];
    avoidWhen: string[];
    reusableHeuristics: string[];
    sourceNotes: string[];
    limitations: string[];
}

export interface EagleKnowledgeAnalysisResponse {
    success: boolean;
    observation?: EagleKnowledgeAnalysisObservation;
    warnings: string[];
    error?: string;
}

export interface EagleKnowledgePreviewResponse {
    success: boolean;
    preview?: {
        dataUrl: string;
        width: number;
        height: number;
    };
    warnings: string[];
    error?: string;
}

export type EagleKnowledgeConnectionState = 'connected' | 'disabled' | 'unavailable';

export interface EagleKnowledgeConnectionStatus {
    state: EagleKnowledgeConnectionState;
    title: string;
    detail: string;
    warnings: string[];
}

interface KnowledgeLibraryRuntimeApi {
    invoke?: (channel: string, ...args: unknown[]) => Promise<unknown>;
    getEagleReferencePreview?: (request: {
        itemId: string;
        maxSize?: number;
        purpose: 'knowledge_library_ui';
        settings?: { enabled?: boolean };
    }) => Promise<unknown>;
    probeDesignKnowledgeEagleReadonly?: (settings?: { enabled?: boolean }) => Promise<{
        success: boolean;
        status: 'disabled' | 'ok' | 'unavailable';
        warnings?: string[];
        error?: string;
    }>;
    searchDesignKnowledge?: (
        query: Pick<DesignKnowledgeQuery, 'query' | 'intents' | 'sourceTypes' | 'limit'>,
        settings?: DesignKnowledgeRuntimeSettings
    ) => Promise<{
        success: boolean;
        results?: DesignKnowledgeResult[];
        warnings?: string[];
        error?: string;
    }>;
    searchEagleReadonlyKnowledge?: (
        query: { query: string; limit?: number; preferAiSearch?: boolean },
        settings?: { enabled?: boolean }
    ) => Promise<{
        status: 'disabled' | 'ok' | 'unavailable';
        results: DesignKnowledgeResult[];
        warnings: string[];
    }>;
}

export class KnowledgeLibraryService {
    private readonly api: KnowledgeLibraryRuntimeApi;

    constructor(api: KnowledgeLibraryRuntimeApi = createKnowledgeLibraryRuntimeApi()) {
        this.api = api;
    }

    async search(input: KnowledgeLibrarySearchInput): Promise<KnowledgeLibrarySearchResponse> {
        const query = normalizeQuery(input.query);
        const limit = normalizeLimit(input.limit);
        const warnings: string[] = [];
        const candidates: DesignKnowledgeResult[] = [];

        if (input.scope === 'all' || input.scope === 'managed') {
            candidates.push(...getMemoryService().getDesignKnowledgeResults({ query, limit }));
        }

        // 统一知识与 Eagle MCP 是两个独立只读来源。全部来源检索时必须并行，
        // 否则某个外部来源的超时会叠加到另一个来源之后，让本地知识页面看似卡死。
        const shouldSearchStandard = input.scope === 'all' || input.scope === 'built_in' || input.scope === 'web';
        const shouldSearchEagle = input.scope === 'all' || input.scope === 'eagle';
        const [standardResults, eagleResults] = await Promise.all([
            shouldSearchStandard ? this.searchStandardKnowledge({
                query,
                limit,
                scope: input.scope,
                settings: input.settings
            }) : Promise.resolve({ results: [], warnings: [] }),
            shouldSearchEagle
                ? this.searchEagleKnowledge(query, limit)
                : Promise.resolve({ results: [], warnings: [] })
        ]);

        if (shouldSearchStandard) {
            candidates.push(...standardResults.results);
            warnings.push(...standardResults.warnings);
        }
        if (shouldSearchEagle) {
            candidates.push(...eagleResults.results);
            warnings.push(...eagleResults.warnings);
        }

        const uniqueResults = deduplicateResults(candidates).slice(0, limit);
        const dispositionSelection = getMemoryService().applyDesignKnowledgeDispositions(uniqueResults);
        return {
            query,
            results: dispositionSelection.visibleResults,
            disabledResults: dispositionSelection.disabledResults,
            warnings: Array.from(new Set(warnings.filter(Boolean))),
            sourceCounts: countSources(dispositionSelection.visibleResults)
        };
    }

    /**
     * 探测 Agent 的 Eagle 全库检索通道。注意它只代表 Eagle MCP 实时通道，
     * 不代表用户是否能在 Eagle 页面离线浏览已选择的 .library。
     */
    async probeEagleConnection(): Promise<EagleKnowledgeConnectionStatus> {
        if (!this.api.probeDesignKnowledgeEagleReadonly) {
            return {
                state: 'unavailable',
                title: 'Agent 全库检索不可用',
                detail: '当前桌面运行时没有暴露 Eagle 实时检索能力。',
                warnings: []
            };
        }
        try {
            const response = await this.api.probeDesignKnowledgeEagleReadonly({ enabled: true });
            const warnings = Array.isArray(response.warnings) ? response.warnings.filter(Boolean) : [];
            if (response.status === 'ok' && response.success) {
                return {
                    state: 'connected',
                    title: 'Agent 全库检索已连接',
                    detail: '需要找同类参考时，Agent 可以按需搜索 Eagle；搜索结果仍需看图后才能形成判断。',
                    warnings
                };
            }
            if (response.status === 'disabled') {
                return {
                    state: 'disabled',
                    title: 'Agent 全库检索已关闭',
                    detail: 'Eagle 页面仍可浏览本地素材库；只有 Agent 的实时全库搜索被关闭。',
                    warnings
                };
            }
            return {
                state: 'unavailable',
                title: 'Agent 全库检索未连接',
                detail: cleanText(response.error, 300)
                    || warnings[0]
                    || '请运行 Eagle 4.0+ 并启用 MCP Server。已打开的本地素材库仍可在 Eagle 页面浏览。',
                warnings
            };
        } catch (error) {
            return {
                state: 'unavailable',
                title: 'Agent 全库检索未连接',
                detail: `实时连接探测失败：${formatError(error)}`,
                warnings: []
            };
        }
    }

    async analyzeEagleReference(result: DesignKnowledgeResult): Promise<EagleKnowledgeAnalysisResponse> {
        if (result.sourceType !== 'eagle_library') {
            return { success: false, warnings: [], error: '只有 Eagle 参考候选可以执行视觉理解。' };
        }
        if (!this.api.invoke) {
            return { success: false, warnings: [], error: '当前桌面运行时未提供 Eagle 视觉分析。' };
        }
        const itemId = normalizeEagleItemId(result.id);
        if (!itemId) {
            return { success: false, warnings: [], error: 'Eagle 参考缺少稳定条目 ID。' };
        }
        try {
            const rawResponse = await this.api.invoke('designKnowledge:analyzeEagleReference', {
                itemId,
                topics: result.tags.slice(0, 8),
                settings: { enabled: true }
            });
            return normalizeEagleAnalysisResponse(rawResponse);
        } catch (error) {
            return {
                success: false,
                warnings: [],
                error: `Eagle 视觉理解失败：${formatError(error)}`
            };
        }
    }

    async getEagleReferencePreview(result: DesignKnowledgeResult): Promise<EagleKnowledgePreviewResponse> {
        if (result.sourceType !== 'eagle_library') {
            return { success: false, warnings: [], error: '只有 Eagle 参考候选可以加载预览。' };
        }
        if (!this.api.getEagleReferencePreview) {
            return { success: false, warnings: [], error: '当前桌面运行时未提供 Eagle 安全预览。' };
        }
        const itemId = normalizeEagleItemId(result.id);
        if (!itemId) {
            return { success: false, warnings: [], error: 'Eagle 参考缺少稳定条目 ID。' };
        }
        try {
            const rawResponse = await this.api.getEagleReferencePreview({
                itemId,
                maxSize: 512,
                purpose: 'knowledge_library_ui',
                settings: { enabled: true }
            });
            return normalizeEaglePreviewResponse(rawResponse);
        } catch (error) {
            return {
                success: false,
                warnings: [],
                error: `Eagle 预览失败：${formatError(error)}`
            };
        }
    }

    private async searchStandardKnowledge(input: {
        query: string;
        limit: number;
        scope: KnowledgeLibrarySearchScope;
        settings?: DesignKnowledgeRuntimeSettings;
    }): Promise<{ results: DesignKnowledgeResult[]; warnings: string[] }> {
        if (!this.api.searchDesignKnowledge) {
            return { results: [], warnings: ['当前桌面运行时未提供统一知识检索。'] };
        }
        let sourceTypes: DesignKnowledgeSourceType[] | undefined;
        if (input.scope === 'built_in') {
            sourceTypes = ['local_recipe', 'manual_rule'];
        } else if (input.scope === 'web') {
            sourceTypes = ['design_crawler', 'web_page', 'mimo_web_search'];
        }
        try {
            const response = await this.api.searchDesignKnowledge({
                query: input.query,
                limit: input.limit,
                ...(sourceTypes ? { sourceTypes } : {})
            }, input.settings);
            if (!response.success) {
                return {
                    results: [],
                    warnings: [response.error || '统一知识检索没有返回可用结果。']
                };
            }
            return {
                results: Array.isArray(response.results) ? response.results : [],
                warnings: Array.isArray(response.warnings) ? response.warnings : []
            };
        } catch (error) {
            return {
                results: [],
                warnings: [`统一知识检索失败：${formatError(error)}`]
            };
        }
    }

    private async searchEagleKnowledge(
        query: string,
        limit: number
    ): Promise<{ results: DesignKnowledgeResult[]; warnings: string[] }> {
        if (!this.api.searchEagleReadonlyKnowledge) {
            return { results: [], warnings: ['Eagle 只读检索当前不可用。'] };
        }
        try {
            const response = await this.api.searchEagleReadonlyKnowledge({
                query,
                limit,
                preferAiSearch: true
            }, { enabled: true });
            return {
                results: response.status === 'ok' ? response.results : [],
                warnings: response.status === 'ok'
                    ? response.warnings
                    : [response.warnings.join('；') || 'Eagle 只读连接不可用。']
            };
        } catch (error) {
            return {
                results: [],
                warnings: [`Eagle 只读检索失败：${formatError(error)}`]
            };
        }
    }
}

let singleton: KnowledgeLibraryService | null = null;

export function getKnowledgeLibraryService(): KnowledgeLibraryService {
    if (!singleton) singleton = new KnowledgeLibraryService();
    return singleton;
}

function createKnowledgeLibraryRuntimeApi(): KnowledgeLibraryRuntimeApi {
    if (typeof window === 'undefined') return {};
    return {
        invoke: window.designEcho?.invoke as KnowledgeLibraryRuntimeApi['invoke'],
        probeDesignKnowledgeEagleReadonly: window.designEcho?.probeDesignKnowledgeEagleReadonly as KnowledgeLibraryRuntimeApi['probeDesignKnowledgeEagleReadonly'],
        getEagleReferencePreview: window.designEcho?.getEagleReferencePreview as KnowledgeLibraryRuntimeApi['getEagleReferencePreview'],
        searchDesignKnowledge: window.designEcho?.searchDesignKnowledge as KnowledgeLibraryRuntimeApi['searchDesignKnowledge'],
        searchEagleReadonlyKnowledge: window.designEcho?.searchEagleReadonlyKnowledge as KnowledgeLibraryRuntimeApi['searchEagleReadonlyKnowledge']
    };
}

function normalizeEaglePreviewResponse(value: unknown): EagleKnowledgePreviewResponse {
    const record = value && typeof value === 'object'
        ? value as Record<string, unknown>
        : {};
    const warnings = normalizeTextList(record.warnings, 8);
    const previewRecord = record.preview && typeof record.preview === 'object'
        ? record.preview as Record<string, unknown>
        : {};
    const dataUrl = String(previewRecord.dataUrl || '').trim();
    if (record.success !== true || !/^data:image\/jpeg;base64,/i.test(dataUrl) || dataUrl.length > 3_000_000) {
        return {
            success: false,
            warnings,
            error: cleanText(record.error, 600) || 'Eagle 没有返回可安全展示的缩略图。'
        };
    }
    return {
        success: true,
        preview: {
            dataUrl,
            width: normalizeDimension(previewRecord.width),
            height: normalizeDimension(previewRecord.height)
        },
        warnings
    };
}

function normalizeDimension(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function normalizeEagleItemId(value: unknown): string {
    return String(value || '').trim().replace(/^eagle:/i, '').slice(0, 240);
}

function normalizeEagleAnalysisResponse(value: unknown): EagleKnowledgeAnalysisResponse {
    const record = value && typeof value === 'object'
        ? value as Record<string, unknown>
        : {};
    const warnings = normalizeTextList(record.warnings, 8);
    const observation = normalizeEagleObservation(record.observation);
    if (record.success !== true || !observation) {
        return {
            success: false,
            warnings,
            error: cleanText(record.error, 600) || '视觉模型没有形成可复核的设计洞察。'
        };
    }
    return { success: true, observation, warnings };
}

function normalizeEagleObservation(value: unknown): EagleKnowledgeAnalysisObservation | undefined {
    const record = value && typeof value === 'object'
        ? value as Record<string, unknown>
        : {};
    const summary = cleanText(record.summary, 1200);
    if (!summary) return undefined;
    const strengths = Array.isArray(record.strengths)
        ? record.strengths.map((entry) => {
            const item = entry && typeof entry === 'object'
                ? entry as Record<string, unknown>
                : {};
            return {
                aspect: cleanText(item.aspect, 180),
                observation: cleanText(item.observation, 500),
                reason: cleanText(item.reason, 500),
                suitableFor: normalizeTextList(item.suitableFor, 6)
            };
        }).filter((item) => item.aspect && item.observation && item.reason)
        : [];
    return {
        analysisSource: cleanText(record.analysisSource, 180) || 'eagle-visual-analysis',
        ...(cleanText(record.productCategory, 180) ? { productCategory: cleanText(record.productCategory, 180) } : {}),
        ...(cleanText(record.designType, 180) ? { designType: cleanText(record.designType, 180) } : {}),
        summary,
        strengths,
        suitableScenarios: normalizeTextList(record.suitableScenarios, 10),
        avoidWhen: normalizeTextList(record.avoidWhen, 10),
        reusableHeuristics: normalizeTextList(record.reusableHeuristics, 12),
        sourceNotes: normalizeTextList(record.sourceNotes, 12),
        limitations: normalizeTextList(record.limitations, 12)
    };
}

function normalizeTextList(value: unknown, limit: number): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map((item) => cleanText(item, 500)).filter(Boolean))).slice(0, limit);
}

function cleanText(value: unknown, limit: number): string {
    return String(value || '')
        .replace(/\b[A-Za-z]:[\\/].*$/g, '[redacted-local-path]')
        .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, '[redacted-image-payload]')
        .replace(/base64/gi, '[redacted]')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, limit);
}

function normalizeQuery(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 400);
}

function normalizeLimit(value: unknown): number {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return 30;
    return Math.max(1, Math.min(60, Math.floor(numberValue)));
}

function deduplicateResults(results: DesignKnowledgeResult[]): DesignKnowledgeResult[] {
    const byIdentity = new Map<string, DesignKnowledgeResult>();
    for (const result of results) {
        if (!result?.id || !result.title) continue;
        const key = `${result.sourceType}:${result.id}:${result.governance?.sourceRevision || 'legacy'}`;
        const previous = byIdentity.get(key);
        if (!previous || result.sourceRank > previous.sourceRank) byIdentity.set(key, result);
    }
    return Array.from(byIdentity.values())
        .sort((left, right) => right.sourceRank - left.sourceRank || left.title.localeCompare(right.title, 'zh-Hans-CN'));
}

function countSources(results: DesignKnowledgeResult[]): KnowledgeLibrarySearchResponse['sourceCounts'] {
    return {
        managed: results.filter((item) => item.sourceType === 'local_case').length,
        builtIn: results.filter((item) => item.sourceType === 'local_recipe' || item.sourceType === 'manual_rule').length,
        eagle: results.filter((item) => item.sourceType === 'eagle_library').length,
        web: results.filter((item) => (
            item.sourceType === 'design_crawler'
            || item.sourceType === 'web_page'
            || item.sourceType === 'mimo_web_search'
        )).length
    };
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error || '未知错误');
}
