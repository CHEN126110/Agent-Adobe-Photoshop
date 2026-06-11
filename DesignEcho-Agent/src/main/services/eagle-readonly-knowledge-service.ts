import {
    buildEagleMcpToolCallBody,
    buildEagleReadonlyUnavailableResponse,
    normalizeEagleReadonlyKnowledgeResults,
    normalizeEagleReadonlySettings,
    type EagleMcpToolCallBody,
    type EagleReadonlyKnowledgeQuery,
    type EagleReadonlyKnowledgeResponse,
    type EagleReadonlySettings,
    type EagleReadonlyToolName
} from '../../shared/eagle-readonly-knowledge';

export type EagleReadonlyFetchImpl = (
    url: string,
    init: {
        method: 'POST';
        headers: Record<string, string>;
        body: string;
        signal?: AbortSignal;
    }
) => Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
}>;

export interface EagleReadonlyKnowledgeServiceOptions {
    settings?: Partial<EagleReadonlySettings>;
    fetchImpl?: EagleReadonlyFetchImpl;
}

interface EagleToolCallResult {
    ok: boolean;
    status: number;
    body: unknown;
}

export class EagleReadonlyKnowledgeService {
    static async search(
        query: EagleReadonlyKnowledgeQuery,
        options: EagleReadonlyKnowledgeServiceOptions = {}
    ): Promise<EagleReadonlyKnowledgeResponse> {
        const settings = normalizeEagleReadonlySettings(options.settings);
        if (!settings.enabled) {
            return buildEagleReadonlyUnavailableResponse(
                query,
                'Eagle 只读知识连接器已禁用。',
                'disabled'
            );
        }

        const fetchImpl = resolveFetchImpl(options.fetchImpl);
        if (!fetchImpl) {
            return buildEagleReadonlyUnavailableResponse(
                query,
                'Eagle 只读知识连接器不可用：当前运行时没有 fetch。'
            );
        }

        const warnings: string[] = [];
        try {
            const searchCall = await chooseSearchCall(query, settings, fetchImpl, warnings);
            const result = await callEagleTool(settings, fetchImpl, searchCall.tool, searchCall.params);
            if (!result.ok) {
                return buildEagleReadonlyUnavailableResponse(
                    query,
                    `Eagle 只读知识搜索失败：HTTP ${result.status}。`
                );
            }
            return normalizeEagleReadonlyKnowledgeResults(
                query,
                unwrapEagleResult(result.body),
                {
                    sourceTool: searchCall.tool,
                    warnings
                }
            );
        } catch (error) {
            return buildEagleReadonlyUnavailableResponse(
                query,
                `Eagle 只读知识连接器不可用：${formatError(error)}。`
            );
        }
    }

    static async probe(
        options: EagleReadonlyKnowledgeServiceOptions = {}
    ): Promise<{
        success: boolean;
        status: 'disabled' | 'ok' | 'unavailable';
        endpoint: string;
        app?: unknown;
        aiSearch?: unknown;
        warnings: string[];
        error?: string;
    }> {
        const settings = normalizeEagleReadonlySettings(options.settings);
        const warnings: string[] = [];
        if (!settings.enabled) {
            return {
                success: true,
                status: 'disabled',
                endpoint: settings.endpoint,
                warnings: ['Eagle 只读知识连接器已禁用。']
            };
        }

        const fetchImpl = resolveFetchImpl(options.fetchImpl);
        if (!fetchImpl) {
            return {
                success: false,
                status: 'unavailable',
                endpoint: settings.endpoint,
                warnings: ['Eagle 只读知识连接器不可用：当前运行时没有 fetch。']
            };
        }

        try {
            const app = await callEagleTool(settings, fetchImpl, 'get_app_info', {});
            if (!app.ok) {
                return {
                    success: false,
                    status: 'unavailable',
                    endpoint: settings.endpoint,
                    warnings: [`Eagle 应用探针失败：HTTP ${app.status}。`]
                };
            }
            let aiSearch: unknown;
            try {
                const aiSearchResult = await callEagleTool(settings, fetchImpl, 'ai_search_status', {});
                aiSearch = aiSearchResult.ok ? unwrapEagleResult(aiSearchResult.body) : undefined;
            } catch (error) {
                warnings.push(`Eagle AI Search 状态不可用：${formatError(error)}。`);
            }
            return {
                success: true,
                status: 'ok',
                endpoint: settings.endpoint,
                app: unwrapEagleResult(app.body),
                aiSearch,
                warnings
            };
        } catch (error) {
            return {
                success: false,
                status: 'unavailable',
                endpoint: settings.endpoint,
                warnings: [`Eagle 只读知识连接器不可用：${formatError(error)}。`],
                error: formatError(error)
            };
        }
    }
}

async function chooseSearchCall(
    query: EagleReadonlyKnowledgeQuery,
    settings: Required<EagleReadonlySettings>,
    fetchImpl: EagleReadonlyFetchImpl,
    warnings: string[]
): Promise<EagleMcpToolCallBody> {
    if (query.preferAiSearch) {
        try {
            const status = await callEagleTool(settings, fetchImpl, 'ai_search_status', {});
            const aiStatus = unwrapEagleResult(status.body);
            if (status.ok && isAiSearchReady(aiStatus)) {
                return buildEagleMcpToolCallBody('ai_search_by_text', {
                    query: query.query,
                    limit: clampSearchLimit(query.limit),
                    fullDetails: false
                });
            }
            warnings.push('Eagle AI Search 未就绪，已降级为只读 item_query。');
        } catch (error) {
            warnings.push(`Eagle AI Search 状态检查失败，已降级为只读 item_query：${formatError(error)}。`);
        }
    }

    if (query.selectedOnly) {
        return buildEagleMcpToolCallBody('item_get_selected', {
            fullDetails: false
        });
    }

    if (query.tags?.length || query.folders?.length || query.ext) {
        return buildEagleMcpToolCallBody('item_get', {
            tags: query.tags,
            folders: query.folders,
            ext: query.ext,
            limit: clampSearchLimit(query.limit),
            fullDetails: false
        });
    }

    return buildEagleMcpToolCallBody('item_query', {
        query: query.query,
        fullDetails: false
    });
}

async function callEagleTool(
    settings: Required<EagleReadonlySettings>,
    fetchImpl: EagleReadonlyFetchImpl,
    tool: EagleReadonlyToolName,
    params: Record<string, unknown>
): Promise<EagleToolCallResult> {
    const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
    const timeout = controller
        ? setTimeout(() => controller.abort(), settings.timeoutMs)
        : undefined;
    const body = JSON.stringify(buildEagleMcpToolCallBody(tool, params));
    try {
        const response = await fetchImpl(`${settings.endpoint}/api/tools/call`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body,
            signal: controller?.signal
        });
        const json = await response.json();
        return {
            ok: response.ok,
            status: response.status,
            body: json
        };
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

function unwrapEagleResult(body: unknown): unknown {
    if (!body || typeof body !== 'object') return body;
    const value = body as Record<string, unknown>;
    if ('result' in value) return value.result;
    if ('data' in value) return value.data;
    return body;
}

function isAiSearchReady(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const status = String((value as Record<string, unknown>).status || '').toLowerCase();
    const ready = (value as Record<string, unknown>).ready;
    return ready === true || status === 'ready' || status === 'ok';
}

function resolveFetchImpl(fetchImpl: EagleReadonlyFetchImpl | undefined): EagleReadonlyFetchImpl | undefined {
    if (fetchImpl) return fetchImpl;
    const runtimeFetch = (globalThis as any).fetch;
    if (typeof runtimeFetch !== 'function') return undefined;
    return runtimeFetch.bind(globalThis);
}

function clampSearchLimit(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 8;
    return Math.max(1, Math.min(100, Math.floor(parsed)));
}

function formatError(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error || 'unknown_error');
}

export default EagleReadonlyKnowledgeService;
