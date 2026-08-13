import {
    searchLocalDesignKnowledge,
    buildXiaomiWebSearchKnowledgeInputs,
    normalizeExternalDesignKnowledgeResults,
    type DesignKnowledgeQuery,
    type DesignKnowledgeResult,
    type DesignKnowledgeSearchResponse,
    type XiaomiWebSearchCitation
} from '../../shared/design-knowledge-search';
import { selectDesignKnowledgeResultsForUse } from '../../shared/design-knowledge-governance';
import {
    buildKnowledgeSearchDesignAgentOsRecord,
    type DesignAgentOsRecord
} from '../../shared/design-agent-os-contracts';
import {
    buildSearxngConnectorStatus,
    buildSearxngSearchUrl,
    clampSearxngLimit,
    normalizeSearxngResults,
    shouldUseSearxngForQuery,
    type SearxngConnectorConfig,
    type SearxngConnectorState,
    type SearxngRawResponse
} from '../../shared/searxng-design-knowledge';

export type DesignKnowledgeSearchServiceResponse = DesignKnowledgeSearchResponse & {
    designAgentOs: DesignAgentOsRecord;
};

export type DesignKnowledgeFetchImpl = (
    url: string,
    init?: { signal?: AbortSignal }
) => Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
}>;

export interface XiaomiWebSearchResult {
    available: boolean;
    content: string;
    citations: XiaomiWebSearchCitation[];
    error?: string;
}

export interface DesignKnowledgeSearchServiceOptions {
    searxng?: SearxngConnectorConfig;
    fetchImpl?: DesignKnowledgeFetchImpl;
    /** 注入小米 MiMo web_search 作为联网搜索主力(慢但准)。不注入则只走本地知识 + SearXNG。 */
    xiaomiWebSearch?: (query: DesignKnowledgeQuery) => Promise<XiaomiWebSearchResult>;
}

export type SearxngHealthProbeStatus =
    | 'disabled'
    | 'missing_endpoint'
    | 'ok'
    | 'unavailable';

export type SearxngHealthProbeResult = Omit<SearxngConnectorState, 'status'> & {
    status: SearxngHealthProbeStatus;
    httpStatus?: number;
};

export class DesignKnowledgeSearchService {
    static async search(
        query: DesignKnowledgeQuery,
        options: DesignKnowledgeSearchServiceOptions = {}
    ): Promise<DesignKnowledgeSearchServiceResponse> {
        const localResponse = searchLocalDesignKnowledge(query);
        const searxngConfig = options.searxng || readSearxngConfigFromEnv();
        const warnings = [...localResponse.warnings];

        // 小米 MiMo web_search 作联网搜索主力(实测稳定出活，慢但准)，结果按 sourceRank 排在最前。
        // 小米与 SearXNG 并行：本地知识已同步就绪，联网两通道互不依赖，串行只会让一次
        // 挂起（小米上限 60s）再叠加 SearXNG 等待，白白吃掉设计循环的时间预算。
        const [xiaomiResults, externalResults] = await Promise.all([
            searchXiaomiWeb(query, options.xiaomiWebSearch, warnings),
            searchSearxng(query, searxngConfig, options.fetchImpl, warnings)
        ]);

        const candidateResults = limitResults(
            [...xiaomiResults, ...localResponse.results, ...externalResults],
            query.limit
        );
        const knowledgeSelection = selectDesignKnowledgeResultsForUse(candidateResults, {
            query: query.query,
            purpose: 'planning'
        });
        const results = knowledgeSelection.usableResults;
        const response: DesignKnowledgeSearchResponse = {
            query: localResponse.query,
            results,
            providerSummary: {
                localRecipe: results.filter((item) => item.sourceType === 'local_recipe').length,
                manualRule: results.filter((item) => item.sourceType === 'manual_rule').length,
                externalSearch: results.filter((item) => (
                    item.sourceType === 'mimo_web_search'
                    || item.sourceType === 'web_page'
                    || item.sourceType === 'design_crawler'
                )).length,
                webPage: results.filter((item) => item.sourceType === 'web_page').length,
                localCase: results.filter((item) => item.sourceType === 'local_case').length
            },
            warnings,
            knowledgeUsageSnapshot: knowledgeSelection.snapshot
        };

        return {
            ...response,
            designAgentOs: buildKnowledgeSearchDesignAgentOsRecord({
                userInput: query.query,
                query,
                response,
                success: true
            })
        };
    }

    static async probeSearxngHealth(
        config: SearxngConnectorConfig,
        options: Pick<DesignKnowledgeSearchServiceOptions, 'fetchImpl'> = {}
    ): Promise<SearxngHealthProbeResult> {
        const state = buildSearxngConnectorStatus(config);
        if (state.status !== 'ready') {
            return {
                ...state,
                status: state.status
            };
        }

        const fetchImpl = resolveFetchImpl(options.fetchImpl);
        if (!fetchImpl) {
            return {
                ...state,
                status: 'unavailable',
                warnings: [...state.warnings, 'SearXNG health probe requires fetch support.']
            };
        }

        try {
            const response = await fetchImpl(buildSearxngSearchUrl(stateToConfig(state, config), {
                query: 'designecho health',
                limit: 1
            }));
            if (!response.ok) {
                return {
                    ...state,
                    status: 'unavailable',
                    httpStatus: response.status,
                    warnings: [...state.warnings, `SearXNG health probe failed with HTTP ${response.status}.`]
                };
            }
            await response.json();
            return {
                ...state,
                status: 'ok',
                httpStatus: response.status
            };
        } catch (error) {
            return {
                ...state,
                status: 'unavailable',
                warnings: [...state.warnings, `SearXNG health probe failed: ${formatError(error)}`]
            };
        }
    }
}

export default DesignKnowledgeSearchService;

/**
 * 小米 MiMo 联网搜索的软时间预算。
 *
 * MiMo 与 SearXNG 由 Promise.all 并行发起——整体耗时等于最慢的那个。MiMo 是「慢但准」的
 * 主力，自身没有超时，真机实测出现过 4 次 Request timed out，把「检索设计参考」整体拖到
 * 70 秒以上，而同批 SearXNG 与本地知识早已返回。这里给它一个软上限：超时即放弃本次
 * MiMo 结果，用已到手的其他来源继续，不阻塞整轮检索。
 *
 * 取 25 秒而非更短：正常返回的 MiMo 调用需要这个量级，砍太狠会把主力来源常态性丢掉。
 */
const XIAOMI_WEB_SEARCH_SOFT_TIMEOUT_MS = 25_000;

/**
 * 超时返回 null，不抛错——调用方据此降级。
 * 被放弃的 promise 必须挂一个 catch：它稍后仍可能 reject，没有 handler 会变成
 * unhandledRejection，在 Electron 主进程里是会打日志甚至影响进程的噪音。
 */
async function raceWithSoftTimeout<T>(pending: Promise<T>, timeoutMs: number): Promise<T | null> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
    });
    pending.catch(() => undefined);
    try {
        return await Promise.race([pending, timeout]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function searchXiaomiWeb(
    query: DesignKnowledgeQuery,
    impl: DesignKnowledgeSearchServiceOptions['xiaomiWebSearch'],
    warnings: string[]
): Promise<DesignKnowledgeResult[]> {
    if (!impl || !shouldUseXiaomiWebForQuery(query)) return [];
    try {
        const result = await raceWithSoftTimeout(
            impl(query),
            XIAOMI_WEB_SEARCH_SOFT_TIMEOUT_MS
        );
        if (!result) {
            warnings.push(
                `小米联网搜索超过 ${Math.round(XIAOMI_WEB_SEARCH_SOFT_TIMEOUT_MS / 1000)} 秒未返回，`
                + '本次已跳过并改用其他来源；结果可能少了联网检索部分。'
            );
            return [];
        }
        if (!result.available) {
            if (result.error) warnings.push(`小米联网搜索不可用：${result.error}`);
            return [];
        }
        const inputs = buildXiaomiWebSearchKnowledgeInputs({
            query: query.query,
            content: result.content,
            citations: Array.isArray(result.citations) ? result.citations : [],
            intent: query.intents?.[0]
        });
        if (inputs.length === 0) {
            warnings.push('小米联网搜索返回为空。');
            return [];
        }
        return normalizeExternalDesignKnowledgeResults(query, inputs);
    } catch (error) {
        warnings.push(`小米联网搜索异常：${formatError(error)}。`);
        return [];
    }
}

function shouldUseXiaomiWebForQuery(query: DesignKnowledgeQuery): boolean {
    return !Array.isArray(query.sourceTypes)
        || query.sourceTypes.length === 0
        || query.sourceTypes.includes('mimo_web_search');
}

async function searchSearxng(
    query: DesignKnowledgeQuery,
    config: SearxngConnectorConfig,
    fetchImpl: DesignKnowledgeFetchImpl | undefined,
    warnings: string[]
): Promise<DesignKnowledgeResult[]> {
    const state = buildSearxngConnectorStatus(config);
    if (!shouldUseSearxngForQuery(query, config)) {
        if (state.status === 'missing_endpoint') {
            warnings.push('SearXNG 已启用但缺少 endpoint，外部网页知识搜索已跳过。');
        }
        return [];
    }

    const resolvedFetch = resolveFetchImpl(fetchImpl);
    if (!resolvedFetch) {
        warnings.push('SearXNG 已启用但当前运行时没有 fetch，外部网页知识搜索已跳过。');
        return [];
    }

    try {
        const response = await resolvedFetch(buildSearxngSearchUrl(config, query));
        if (!response.ok) {
            warnings.push(`SearXNG 搜索失败：HTTP ${response.status}。`);
            return [];
        }
        const body = await response.json();
        return normalizeSearxngResults(
            {
                ...query,
                limit: clampSearxngLimit(query.limit)
            },
            body as SearxngRawResponse,
            { fetchedAt: config.fetchedAt }
        );
    } catch (error) {
        warnings.push(`SearXNG 搜索失败：${formatError(error)}。`);
        return [];
    }
}

function readSearxngConfigFromEnv(): SearxngConnectorConfig {
    return {
        enabled: process.env.DESIGNECHO_SEARXNG_ENABLED === '1',
        endpoint: process.env.DESIGNECHO_SEARXNG_ENDPOINT,
        language: process.env.DESIGNECHO_SEARXNG_LANGUAGE,
        safeSearch: parseSafeSearch(process.env.DESIGNECHO_SEARXNG_SAFESEARCH),
        timeoutMs: parseOptionalNumber(process.env.DESIGNECHO_SEARXNG_TIMEOUT_MS)
    };
}

function resolveFetchImpl(fetchImpl: DesignKnowledgeFetchImpl | undefined): DesignKnowledgeFetchImpl | undefined {
    if (fetchImpl) return fetchImpl;
    const runtimeFetch = (globalThis as any).fetch;
    if (typeof runtimeFetch !== 'function') return undefined;
    return runtimeFetch.bind(globalThis);
}

function limitResults(results: DesignKnowledgeResult[], limit: unknown): DesignKnowledgeResult[] {
    const max = clampSearxngLimit(limit);
    return [...results]
        .sort((a, b) => b.sourceRank - a.sourceRank || a.title.localeCompare(b.title, 'zh-Hans-CN'))
        .slice(0, max);
}

function stateToConfig(state: SearxngConnectorState, original: SearxngConnectorConfig): SearxngConnectorConfig {
    return {
        ...original,
        enabled: true,
        endpoint: state.endpoint
    };
}

function parseSafeSearch(value: unknown): 0 | 1 | 2 | undefined {
    const parsed = Number(value);
    if (parsed === 0 || parsed === 1 || parsed === 2) return parsed;
    return undefined;
}

function parseOptionalNumber(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function formatError(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error || 'unknown_error');
}
