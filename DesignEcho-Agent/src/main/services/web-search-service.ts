/**
 * DeepSeek 原生联网搜索服务（主进程）。
 *
 * 后端机制与 DeepSeek Harness 的 web_search 一致：调用 DeepSeek 官方 Anthropic 兼容
 * Messages API（POST {baseURL}/messages），在请求中携带原生 `web_search_20250305` 服务器工具；
 * DeepSeek 在服务端执行搜索并返回结构化 `web_search_tool_result` 块。本服务只解析结构化
 * 来源（url / title / page_age + citation snippet），绝不从模型文本里抓 URL，也不信任
 * provider 生成的总结文字。
 *
 * 边界：只读外部公开信息；结果只是数据，不授予任何权限；未配置 key / 网络失败 /
 * 超时时返回结构化不可用状态，由调用方如实反馈给 Agent，不阻断设计任务。
 */

export interface WebSearchSource {
    url: string;
    title?: string;
    snippet?: string;
    publishedAt?: string;
}

export type WebSearchOutcomeStatus = 'ok' | 'no_results' | 'unavailable';

export interface WebSearchOutcome {
    status: WebSearchOutcomeStatus;
    query: string;
    sources: WebSearchSource[];
    warnings: string[];
    error?: string;
    /** 提供方返回的来源超过 maxResults 时被截断并标记。 */
    truncated?: boolean;
}

export interface DeepSeekWebSearchOptions {
    /** Anthropic 兼容端点的模型名，默认 deepseek-v4-flash（与 Harness 默认一致）。 */
    model?: string;
    /** 端点 base；`/messages` 由服务追加。默认 https://api.deepseek.com/anthropic/v1。 */
    baseURL?: string;
    /** 每次请求允许的最大搜索次数（max_uses）。默认 3。 */
    maxUses?: number;
    /** 单次搜索的协作超时预算（ms）。默认 45000。 */
    timeoutMs?: number;
    /** 最多返回的来源数（按 URL 去重后截断）。默认 8，上限 10。 */
    maxResults?: number;
}

interface DeepSeekAnthropicTextBlock {
    type: 'text';
    text: string;
    citations?: Array<{ url?: string; cited_text?: string }>;
}

interface DeepSeekWebSearchResultItem {
    type: 'web_search_result';
    url: string;
    title?: string;
    page_age?: string;
}

interface DeepSeekWebSearchToolResultBlock {
    type: 'web_search_tool_result';
    content?: DeepSeekWebSearchResultItem[];
}

type DeepSeekAnthropicContentBlock =
    | DeepSeekAnthropicTextBlock
    | DeepSeekWebSearchToolResultBlock
    | { type: string };

interface DeepSeekAnthropicResponse {
    content?: DeepSeekAnthropicContentBlock[];
    error?: { message?: string } | string;
}

export const DEEPSEEK_WEB_SEARCH_DEFAULT_BASE_URL = 'https://api.deepseek.com/anthropic/v1';
export const DEEPSEEK_WEB_SEARCH_DEFAULT_MODEL = 'deepseek-v4-flash';
export const DEEPSEEK_WEB_SEARCH_DEFAULT_MAX_USES = 3;
export const DEEPSEEK_WEB_SEARCH_DEFAULT_TIMEOUT_MS = 45_000;
export const DEEPSEEK_WEB_SEARCH_DEFAULT_MAX_RESULTS = 8;
export const DEEPSEEK_WEB_SEARCH_MAX_RESULTS_CEILING = 10;

const DEEPSEEK_WEB_SEARCH_API_VERSION = '2023-06-01';
const DEEPSEEK_WEB_SEARCH_MAX_TOKENS = 4096;
const USER_AGENT = 'designecho-agent/2.0';
const SOURCE_SNIPPET_MAX_CHARS = 600;
const SOURCE_TITLE_MAX_CHARS = 200;

interface NormalizedWebSearchOptions {
    model: string;
    baseURL: string;
    maxUses: number;
    timeoutMs: number;
    maxResults: number;
}

export function normalizeDeepSeekWebSearchOptions(
    options: DeepSeekWebSearchOptions = {}
): NormalizedWebSearchOptions {
    const maxResults = Math.floor(Number(options.maxResults) || DEEPSEEK_WEB_SEARCH_DEFAULT_MAX_RESULTS);
    const maxUses = Math.floor(Number(options.maxUses) || DEEPSEEK_WEB_SEARCH_DEFAULT_MAX_USES);
    const timeoutMs = Math.floor(Number(options.timeoutMs) || DEEPSEEK_WEB_SEARCH_DEFAULT_TIMEOUT_MS);
    return {
        model: String(options.model || '').trim() || DEEPSEEK_WEB_SEARCH_DEFAULT_MODEL,
        baseURL: String(options.baseURL || '').trim().replace(/\/+$/, '')
            || DEEPSEEK_WEB_SEARCH_DEFAULT_BASE_URL,
        maxUses: Math.max(1, Math.min(5, maxUses)),
        timeoutMs: Math.max(10_000, Math.min(120_000, timeoutMs)),
        maxResults: Math.max(1, Math.min(DEEPSEEK_WEB_SEARCH_MAX_RESULTS_CEILING, maxResults))
    };
}

/**
 * 从 text 块的 citations[] 建立 `url → cited_text` 映射。
 * Anthropic 系 `web_search_result` 条目通常不带内联摘要，摘录位于独立 text 块的
 * citation 中并按 url 关联（首个出现优先）。
 */
export function collectWebSearchCitationSnippets(
    blocks: DeepSeekAnthropicContentBlock[]
): Map<string, string> {
    const map = new Map<string, string>();
    for (const block of blocks) {
        if (block.type !== 'text') continue;
        const citations = (block as DeepSeekAnthropicTextBlock).citations ?? [];
        for (const cite of citations) {
            if (!cite.url || !cite.cited_text || map.has(cite.url)) continue;
            map.set(cite.url, cite.cited_text);
        }
    }
    return map;
}

function clampText(value: unknown, maxChars: number): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.replace(/\s+/g, ' ').trim();
    if (!trimmed) return undefined;
    return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}…` : trimmed;
}

/**
 * 把 DeepSeek Anthropic Messages 响应映射为结构化来源。
 * 只消费 `web_search_tool_result` 块内的 `web_search_result` 条目并按 URL 去重；
 * 没有结果块时不降级为从文本抓 URL，而是如实返回空列表。
 */
export function mapDeepSeekAnthropicSearchResponse(
    response: DeepSeekAnthropicResponse
): WebSearchSource[] {
    const blocks = Array.isArray(response?.content) ? response.content : [];
    const resultBlocks = blocks.filter(
        (block): block is DeepSeekWebSearchToolResultBlock => block.type === 'web_search_tool_result'
    );
    if (resultBlocks.length === 0) return [];

    const snippets = collectWebSearchCitationSnippets(blocks);
    const seen = new Set<string>();
    const sources: WebSearchSource[] = [];
    for (const block of resultBlocks) {
        for (const item of block.content ?? []) {
            if (item.type !== 'web_search_result' || !item.url || seen.has(item.url)) continue;
            seen.add(item.url);
            const title = clampText(item.title, SOURCE_TITLE_MAX_CHARS);
            const snippet = clampText(snippets.get(item.url), SOURCE_SNIPPET_MAX_CHARS);
            const publishedAt = clampText(item.page_age, 64);
            sources.push({
                url: item.url,
                ...(title ? { title } : {}),
                ...(snippet ? { snippet } : {}),
                ...(publishedAt ? { publishedAt } : {})
            });
        }
    }
    return sources;
}

function readProviderErrorDetail(response: DeepSeekAnthropicResponse): string {
    const errorValue = response?.error;
    if (typeof errorValue === 'string' && errorValue.trim()) return errorValue.trim();
    if (errorValue && typeof errorValue === 'object' && errorValue.message?.trim()) {
        return errorValue.message.trim();
    }
    return '';
}

function buildUnavailableOutcome(query: string, error: string, warnings: string[] = []): WebSearchOutcome {
    return { status: 'unavailable', query, sources: [], warnings, error };
}

/**
 * 执行一次 DeepSeek 原生联网搜索。API key 由调用方（IPC handler 经 ModelService）传入，
 * 本服务不接触设置存储；所有失败都翻译为结构化 outcome，绝不向上抛未包装错误。
 */
export async function searchWebViaDeepSeek(
    apiKey: string,
    query: string,
    options: DeepSeekWebSearchOptions = {}
): Promise<WebSearchOutcome> {
    const trimmedQuery = String(query || '').trim();
    if (!trimmedQuery) {
        return buildUnavailableOutcome('', '联网搜索失败：搜索关键词为空，请提供 query。');
    }
    if (!apiKey || !apiKey.trim()) {
        return buildUnavailableOutcome(
            trimmedQuery,
            '联网搜索不可用：未配置 DeepSeek API Key。请在设置中配置 DeepSeek 提供方的 API Key 后重试；'
            + '未配置时不影响其他设计能力。'
        );
    }

    const normalized = normalizeDeepSeekWebSearchOptions(options);
    const endpoint = `${normalized.baseURL}/messages`;
    const body = {
        model: normalized.model,
        max_tokens: DEEPSEEK_WEB_SEARCH_MAX_TOKENS,
        messages: [{
            role: 'user',
            content: [{ type: 'text', text: `Perform a web search for the query: ${trimmedQuery}` }]
        }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: normalized.maxUses }]
    };

    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), normalized.timeoutMs);
    let response: Response;
    try {
        response = await fetch(endpoint, {
            method: 'POST',
            redirect: 'error',
            headers: {
                // 官方 DeepSeek 期望 x-api-key；Anthropic 兼容代理可能期望 Bearer——两个都发，任一可解析。
                'x-api-key': apiKey,
                'authorization': `Bearer ${apiKey}`,
                'anthropic-version': DEEPSEEK_WEB_SEARCH_API_VERSION,
                'content-type': 'application/json',
                'accept': 'application/json',
                'user-agent': USER_AGENT
            },
            body: JSON.stringify(body),
            signal: controller.signal
        });
    } catch (error: unknown) {
        clearTimeout(timeoutTimer);
        const aborted = controller.signal.aborted;
        return buildUnavailableOutcome(
            trimmedQuery,
            aborted
                ? `联网搜索超时（${normalized.timeoutMs / 1000} 秒）：DeepSeek 原生搜索需要一次完整模型轮次。`
                  + '可稍后重试一次，或改用本地知识库 / Eagle 参考继续设计。'
                : `联网搜索请求失败（${endpoint}）：${error instanceof Error ? error.message : String(error || 'unknown')}。`
        );
    }

    if (!response.ok) {
        clearTimeout(timeoutTimer);
        let providerDetail = '';
        try {
            const errorPayload = (await response.json()) as DeepSeekAnthropicResponse;
            providerDetail = readProviderErrorDetail(errorPayload);
        } catch {
            // 非 JSON 错误体（网关 5xx/429 常见）：HTTP 状态已足够定位，不吞真实失败。
            providerDetail = '';
        }
        const statusText = response.statusText ? `（${response.statusText}）` : '';
        return buildUnavailableOutcome(
            trimmedQuery,
            providerDetail
                ? `DeepSeek 搜索失败：HTTP ${response.status}${statusText}，${providerDetail}`
                : `DeepSeek 搜索失败：HTTP ${response.status}${statusText}。请检查 API Key 是否有效或稍后重试。`
        );
    }

    let payload: DeepSeekAnthropicResponse;
    try {
        payload = (await response.json()) as DeepSeekAnthropicResponse;
    } catch (error: unknown) {
        clearTimeout(timeoutTimer);
        if (controller.signal.aborted) {
            return buildUnavailableOutcome(
                trimmedQuery,
                `联网搜索超时（${normalized.timeoutMs / 1000} 秒）：响应体尚未读完。可稍后重试一次，或改用本地知识库 / Eagle 参考继续设计。`
            );
        }
        return buildUnavailableOutcome(
            trimmedQuery,
            `DeepSeek 搜索返回了无法解析的响应体：${error instanceof Error ? error.message : String(error || 'unknown')}。`
        );
    }
    clearTimeout(timeoutTimer);

    const sources = mapDeepSeekAnthropicSearchResponse(payload);
    if (sources.length === 0) {
        return {
            status: 'no_results',
            query: trimmedQuery,
            sources: [],
            warnings: ['DeepSeek 本次响应未触发原生联网搜索，没有可引用的结构化来源。'],
            error: 'DeepSeek returned no web_search_tool_result blocks; the request may not have triggered native web search'
        };
    }

    const truncated = sources.length > normalized.maxResults;
    const boundedSources = sources.slice(0, normalized.maxResults);
    return {
        status: 'ok',
        query: trimmedQuery,
        sources: boundedSources,
        warnings: truncated ? [`搜索结果超过上限，已截断为 ${normalized.maxResults} 条来源。`] : [],
        truncated
    };
}
