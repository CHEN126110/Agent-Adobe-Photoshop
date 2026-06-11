import {
    searchLocalDesignKnowledge,
    type DesignKnowledgeQuery,
    type DesignKnowledgeResult,
    type DesignKnowledgeSearchResponse
} from '../../shared/design-knowledge-search';
import {
    buildKnowledgeSearchDesignAgentOsEvidence,
    type DesignAgentOsEvidence
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
    designAgentOs: DesignAgentOsEvidence;
};

export type DesignKnowledgeFetchImpl = (
    url: string,
    init?: { signal?: AbortSignal }
) => Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
}>;

export interface DesignKnowledgeSearchServiceOptions {
    searxng?: SearxngConnectorConfig;
    fetchImpl?: DesignKnowledgeFetchImpl;
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
        const externalResults = await searchSearxng(query, searxngConfig, options.fetchImpl, warnings);
        const results = limitResults([...localResponse.results, ...externalResults], query.limit);
        const response: DesignKnowledgeSearchResponse = {
            query: localResponse.query,
            results,
            providerSummary: {
                localRecipe: results.filter((item) => item.sourceType === 'local_recipe').length,
                manualRule: results.filter((item) => item.sourceType === 'manual_rule').length,
                externalSearch: externalResults.length,
                webPage: results.filter((item) => item.sourceType === 'web_page').length,
                localCase: results.filter((item) => item.sourceType === 'local_case').length
            },
            warnings
        };

        return {
            ...response,
            designAgentOs: buildKnowledgeSearchDesignAgentOsEvidence({
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
