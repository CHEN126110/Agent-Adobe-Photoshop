/**
 * Provider 列模型服务（HTTP 拉取层）。
 *
 * 职责：调用各 provider 官方「列模型」接口，把响应**标准化**成
 * `FetchedProviderModel[]`，交给纯逻辑合并层 `mergeFetchedProviderModels` 处理。
 * 本模块只做：选 endpoint、发请求（带系统代理 + 超时）、解析响应、按 provider 归一。
 *
 * 不做合并、不补默认能力、不碰 renderer——合并与能力覆盖在 provider-model-merge.ts。
 *
 * 设计取舍：
 * - baseURL 与 model-service.ts 的客户端配置保持一致（见下方常量注释），避免诊断时
 *   "测试用的地址" 与 "实际调用的地址" 不一致造成误判。
 * - HTTP 用 Node 原生 https/http 模块而非全局 fetch：Electron 主进程的全局 fetch 是
 *   undici 实现，其 agent 选项不生效（要 dispatcher），代理会被静默忽略。项目其余出网
 *   代码（model-service / stream-adapter）也统一走 https.request + agent，这里保持一致，
 *   确保系统代理真正生效，而不是用一个失效的 agent 选项掩盖问题。
 * - 失败一律返回 { success:false, error, baseUrlUsed }，error 必须说明用的哪个 baseURL，
 *   便于用户判断是 key 错、网络/代理问题还是 endpoint 不通。
 * - apiKey 由 IPC handler 从主进程 modelService 取，渲染侧绝不回传明文 key。
 */

import { request as httpsRequest } from 'https';
import { request as httpRequest } from 'http';
import type { IncomingMessage } from 'http';
import type { ModelProvider } from '../../shared/config/models.config';
import type { FetchedProviderModel } from '../../shared/config/provider-model-merge';
import { getHttpRequestAgent } from './network-proxy';

/**
 * 各 provider 列模型 endpoint 的 baseURL。
 * 这些值与 model-service.ts 中初始化各 provider 客户端时用的 baseURL 一致；
 * 改动任意一侧时请同步另一侧，避免"测试地址 ≠ 调用地址"。
 */
const XIAOMI_BASE_URL = 'https://api.xiaomimimo.com/v1';
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const GOOGLE_MODELS_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const OLLAMA_CLOUD_BASE_URL = 'https://ollama.com';
const OLLAMA_LOCAL_DEFAULT_URL = 'http://localhost:11434';

/** 列模型请求默认超时（毫秒）。列模型是只读轻请求，给较短超时避免卡 UI。 */
const LIST_MODELS_TIMEOUT_MS = 15_000;

/** 响应体读取上限（字节），防止异常巨型响应撑爆内存。列模型响应远小于此。 */
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export interface ListModelsOptions {
    /** 本地 Ollama 地址（仅 provider==='ollama' 时使用），默认 http://localhost:11434。 */
    ollamaUrl?: string;
    /** 超时（毫秒），默认 15000。 */
    timeoutMs?: number;
}

export interface ListModelsResult {
    success: boolean;
    models: FetchedProviderModel[];
    error?: string;
    /** 实际请求用的地址，便于诊断（成功/失败都带上）。 */
    baseUrlUsed?: string;
}

/** provider 是否需要 apiKey 才能列模型（本地 ollama 不需要）。 */
export function providerRequiresApiKeyForListing(provider: ModelProvider): boolean {
    return provider !== 'ollama';
}

/**
 * 列出某 provider 的可用模型（已标准化）。
 *
 * @param provider 目标 provider
 * @param apiKey   该 provider 的 apiKey（本地 ollama 可为空）
 * @param opts     可选：本地 ollama 地址、超时
 */
export async function listModelsForProvider(
    provider: ModelProvider,
    apiKey: string | undefined,
    opts?: ListModelsOptions
): Promise<ListModelsResult> {
    const timeoutMs = opts?.timeoutMs ?? LIST_MODELS_TIMEOUT_MS;

    if (providerRequiresApiKeyForListing(provider) && !apiKey?.trim()) {
        return {
            success: false,
            models: [],
            error: `缺少 ${provider} 的 API Key，无法拉取模型列表。请先在「API 密钥」页面配置。`
        };
    }

    try {
        switch (provider) {
            case 'deepseek':
                return await listOpenAICompatible(DEEPSEEK_BASE_URL, apiKey!, timeoutMs);
            case 'xiaomi':
                return await listOpenAICompatible(XIAOMI_BASE_URL, apiKey!, timeoutMs);
            case 'openrouter':
                return await listOpenRouter(apiKey!, timeoutMs);
            case 'google':
                return await listGoogle(apiKey!, timeoutMs);
            case 'ollama-cloud':
                return await listOllamaTags(OLLAMA_CLOUD_BASE_URL, apiKey, timeoutMs);
            case 'ollama':
                return await listOllamaTags(
                    (opts?.ollamaUrl?.trim() || OLLAMA_LOCAL_DEFAULT_URL).replace(/\/+$/, ''),
                    undefined,
                    timeoutMs
                );
            default:
                return {
                    success: false,
                    models: [],
                    error: `provider「${provider}」暂不支持自动列模型。`
                };
        }
    } catch (error: any) {
        // 兜底：理论上各 list* 已自捕获并带 baseUrlUsed，这里只兜未预期异常。
        return {
            success: false,
            models: [],
            error: `拉取 ${provider} 模型列表失败：${error?.message || String(error)}`
        };
    }
}

interface RawHttpResponse {
    statusCode: number;
    body: string;
}

/**
 * 用 Node 原生 https/http 发请求，带系统代理 agent 与超时。
 * agent 经 http(s).request 的 agent 选项透传，代理必然生效（不像 undici fetch 会忽略 agent）。
 */
function httpRequestJson(
    method: 'GET' | 'POST',
    targetUrl: string,
    headers: Record<string, string>,
    timeoutMs: number,
    requestBody?: string
): Promise<RawHttpResponse> {
    return new Promise((resolve, reject) => {
        let url: URL;
        try {
            url = new URL(targetUrl);
        } catch {
            reject(new Error(`无效的请求地址：${targetUrl}`));
            return;
        }

        const isHttps = url.protocol === 'https:';
        const requestFn = isHttps ? httpsRequest : httpRequest;
        const agent = getHttpRequestAgent(url);

        const req = requestFn(
            {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: `${url.pathname}${url.search}`,
                method,
                headers: {
                    Accept: 'application/json',
                    ...(requestBody === undefined
                        ? {}
                        : {
                            'Content-Type': 'application/json',
                            'Content-Length': String(Buffer.byteLength(requestBody))
                        }),
                    ...headers
                },
                ...(agent ? { agent } : {}),
                timeout: timeoutMs
            },
            (res: IncomingMessage) => {
                const chunks: Buffer[] = [];
                let received = 0;
                let aborted = false;
                res.on('data', (chunk: Buffer) => {
                    received += chunk.length;
                    if (received > MAX_RESPONSE_BYTES) {
                        aborted = true;
                        res.destroy();
                        reject(new Error('响应体过大，已中止读取'));
                        return;
                    }
                    chunks.push(chunk);
                });
                res.on('end', () => {
                    if (aborted) return;
                    resolve({
                        statusCode: res.statusCode || 0,
                        body: Buffer.concat(chunks).toString('utf8')
                    });
                });
                res.on('error', (err: Error) => reject(err));
            }
        );

        req.on('timeout', () => {
            req.destroy(new Error(`请求超时（${timeoutMs}ms）`));
        });
        req.on('error', (err: Error) => reject(err));
        if (requestBody !== undefined) req.write(requestBody);
        req.end();
    });
}

function httpGet(
    targetUrl: string,
    headers: Record<string, string>,
    timeoutMs: number
): Promise<RawHttpResponse> {
    return httpRequestJson('GET', targetUrl, headers, timeoutMs);
}

function httpPostJson(
    targetUrl: string,
    headers: Record<string, string>,
    timeoutMs: number,
    payload: unknown
): Promise<RawHttpResponse> {
    return httpRequestJson('POST', targetUrl, headers, timeoutMs, JSON.stringify(payload));
}

/** 把网络/超时类异常转成可读文案，并标注所用地址。 */
function describeRequestError(error: any, baseUrlUsed: string): string {
    const reason = error?.message || String(error);
    return `请求失败（地址：${baseUrlUsed}）：${reason}`;
}

/** 截断错误响应体片段，让 HTTP 错误信息更可诊断。 */
function errorBodySnippet(body: string): string {
    const text = (body || '').trim();
    if (!text) return '';
    const snippet = text.length > 200 ? `${text.slice(0, 200)}…` : text;
    return `：${snippet}`;
}

function safeParseJson(body: string): any {
    try {
        return JSON.parse(body);
    } catch {
        return null;
    }
}

function normalizeStringList(value: any): string[] {
    const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
    return values
        .map((item) => String(item || '').trim().toLowerCase())
        .filter((item) => item.length > 0);
}

function includesAny(values: string[], candidates: string[]): boolean {
    return candidates.some((candidate) => values.includes(candidate));
}

function readBooleanFlag(item: any, names: string[]): boolean | undefined {
    for (const name of names) {
        const value = item?.[name];
        if (typeof value === 'boolean') return value;
    }
    return undefined;
}

function extractSupportedParameters(item: any): string[] {
    return normalizeStringList(item?.supported_parameters || item?.supportedParameters);
}

function extractInputModalities(item: any): string[] {
    return normalizeStringList(item?.architecture?.input_modalities || item?.input_modalities || item?.inputModalities);
}

function extractOutputModalities(item: any): string[] {
    return normalizeStringList(item?.architecture?.output_modalities || item?.output_modalities || item?.outputModalities);
}

function extractCapabilityNames(item: any): string[] {
    const objectCapabilityNames = item?.capabilities && !Array.isArray(item.capabilities)
        && typeof item.capabilities === 'object'
        ? Object.entries(item.capabilities)
            .filter(([, enabled]) => enabled === true)
            .map(([name]) => name.toLowerCase())
        : [];
    return Array.from(new Set([
        ...normalizeStringList(item?.capabilities),
        ...normalizeStringList(item?.features),
        ...objectCapabilityNames
    ]));
}

function extractSupportedMethods(item: any): string[] {
    return normalizeStringList(
        item?.supportedGenerationMethods
        || item?.supported_generation_methods
        || item?.supportedMethods
        || item?.supported_methods
    );
}

function extractDeclaredKind(item: any): string | undefined {
    const candidates = [item?.model_type, item?.modelType, item?.task, item?.type];
    for (const candidate of candidates) {
        const value = typeof candidate === 'string' ? candidate.trim() : '';
        if (value && value.toLowerCase() !== 'model') return value;
    }
    return undefined;
}

/**
 * 上下文窗口：各家字段名不同，但都是接口真实返回的值，能取就别退回猜测。
 * - OpenRouter: context_length
 * - Google (models.list): inputTokenLimit
 * - Ollama /api/tags: details.context_length
 * - OpenAI 兼容接口多数不返回，取不到就留 undefined，由上层三态处理。
 */
function extractContextWindow(item: any): number | undefined {
    const candidates = [
        item?.context_length,
        item?.contextLength,
        item?.context_window,
        item?.contextWindow,
        item?.inputTokenLimit,
        item?.input_token_limit,
        item?.max_input_tokens,
        item?.details?.context_length,
        item?.model_info?.context_length
    ];
    for (const candidate of candidates) {
        const parsed = Number(candidate);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    // Ollama 的 model_info 用 "{架构}.context_length" 作键（如 llama.context_length）
    const modelInfo = item?.model_info;
    if (modelInfo && typeof modelInfo === 'object') {
        for (const [key, value] of Object.entries(modelInfo)) {
            if (!key.endsWith('.context_length')) continue;
            const parsed = Number(value);
            if (Number.isFinite(parsed) && parsed > 0) return parsed;
        }
    }
    return undefined;
}

function extractThinkingSupport(item: any, supportedParams: string[]): boolean | undefined {
    const explicit = readBooleanFlag(item, [
        'supportsThinking',
        'supports_thinking',
        'thinking_supported',
        'supportsReasoning',
        'supports_reasoning',
        'reasoning_supported'
    ]);
    if (explicit !== undefined) return explicit;

    const capabilityNames = [
        ...normalizeStringList(item?.capabilities),
        ...normalizeStringList(item?.features)
    ];
    if (includesAny(supportedParams, ['reasoning', 'include_reasoning', 'reasoning_effort', 'thinking'])) {
        return true;
    }
    if (includesAny(capabilityNames, ['reasoning', 'thinking'])) {
        return true;
    }
    return undefined;
}

function extractToolUseSupport(item: any, supportedParams: string[]): boolean | undefined {
    const explicit = readBooleanFlag(item, [
        'supportsToolUse',
        'supports_tool_use',
        'tool_use_supported',
        'supportsTools',
        'supports_tools'
    ]);
    if (explicit !== undefined) return explicit;
    return supportedParams.includes('tools') || supportedParams.includes('tool_use') ? true : undefined;
}

function extractVisionSupport(item: any, inputModalities: string[]): boolean | undefined {
    const explicit = readBooleanFlag(item, [
        'supportsVision',
        'supports_vision',
        'vision_supported'
    ]);
    if (explicit !== undefined) return explicit;
    return inputModalities.includes('image') ? true : undefined;
}

/**
 * OpenAI 兼容（deepseek / xiaomi）：GET {baseURL}/models，Bearer。
 * 多数渠道只返回 data[].id；如果接口额外返回 supported_parameters / capabilities 等官方能力字段，
 * 这里会标准化后交给合并层。未返回的能力不猜测。
 */
async function listOpenAICompatible(
    baseURL: string,
    apiKey: string,
    timeoutMs: number
): Promise<ListModelsResult> {
    const url = `${baseURL}/models`;
    try {
        const res = await httpGet(url, { Authorization: `Bearer ${apiKey}` }, timeoutMs);
        if (res.statusCode < 200 || res.statusCode >= 300) {
            return {
                success: false,
                models: [],
                baseUrlUsed: url,
                error: `列模型失败（地址：${url}，HTTP ${res.statusCode}）${errorBodySnippet(res.body)}`
            };
        }
        const data = safeParseJson(res.body);
        const list: any[] = Array.isArray(data?.data) ? data.data : [];
        const models: FetchedProviderModel[] = [];
        for (const item of list) {
            const apiModelId = String(item?.id || '').trim();
            if (!apiModelId) continue;
            const supportedParams = extractSupportedParameters(item);
            const inputModalities = extractInputModalities(item);
            const outputModalities = extractOutputModalities(item);
            const supportsThinking = extractThinkingSupport(item, supportedParams);
            models.push({
                apiModelId,
                name: typeof item?.name === 'string' && item.name.trim() ? item.name.trim() : undefined,
                declaredKind: extractDeclaredKind(item),
                inputModalities,
                outputModalities,
                capabilityNames: extractCapabilityNames(item),
                supportedMethods: extractSupportedMethods(item),
                supportsVision: extractVisionSupport(item, inputModalities),
                supportsToolUse: extractToolUseSupport(item, supportedParams),
                contextWindow: extractContextWindow(item),
                supportsThinking: supportsThinking === true ? true : undefined,
                thinkingFormat: supportsThinking === true ? 'reasoning_content' : undefined
            });
        }
        return { success: true, models, baseUrlUsed: url };
    } catch (error: any) {
        return { success: false, models: [], baseUrlUsed: url, error: describeRequestError(error, url) };
    }
}

/**
 * OpenRouter：GET /models，Bearer。响应带丰富能力元数据：
 * - architecture.input_modalities 含 'image' → supportsVision
 * - supported_parameters 含 'tools' → supportsToolUse
 * - context_length → contextWindow
 * - name → 显示名
 */
async function listOpenRouter(apiKey: string, timeoutMs: number): Promise<ListModelsResult> {
    const url = OPENROUTER_MODELS_URL;
    try {
        const res = await httpGet(url, { Authorization: `Bearer ${apiKey}` }, timeoutMs);
        if (res.statusCode < 200 || res.statusCode >= 300) {
            return {
                success: false,
                models: [],
                baseUrlUsed: url,
                error: `列模型失败（地址：${url}，HTTP ${res.statusCode}）${errorBodySnippet(res.body)}`
            };
        }
        const data = safeParseJson(res.body);
        const list: any[] = Array.isArray(data?.data) ? data.data : [];
        const models: FetchedProviderModel[] = [];
        for (const item of list) {
            const apiModelId = String(item?.id || '').trim();
            if (!apiModelId) continue;
            const inputModalities = extractInputModalities(item);
            const outputModalities = extractOutputModalities(item);
            const supportedParams = extractSupportedParameters(item);
            const contextLength = Number(item?.context_length);
            const supportsThinking = extractThinkingSupport(item, supportedParams) === true;
            models.push({
                apiModelId,
                name: typeof item?.name === 'string' && item.name.trim() ? item.name.trim() : undefined,
                declaredKind: extractDeclaredKind(item),
                inputModalities,
                outputModalities,
                capabilityNames: extractCapabilityNames(item),
                supportedMethods: extractSupportedMethods(item),
                supportsVision: inputModalities.includes('image') ? true : undefined,
                supportsToolUse: extractToolUseSupport(item, supportedParams),
                contextWindow: Number.isFinite(contextLength) && contextLength > 0 ? contextLength : undefined,
                supportsThinking: supportsThinking ? true : undefined,
                thinkingFormat: supportsThinking ? 'reasoning_content' : undefined
            });
        }
        return { success: true, models, baseUrlUsed: url };
    } catch (error: any) {
        return { success: false, models: [], baseUrlUsed: url, error: describeRequestError(error, url) };
    }
}

/**
 * Google AI Studio：GET /models?key={apiKey}。
 * models[].name 去 'models/' 前缀 → apiModelId；displayName → name。
 */
async function listGoogle(apiKey: string, timeoutMs: number): Promise<ListModelsResult> {
    // key 放 query，诊断地址里隐藏 key，避免泄露。
    const requestUrl = `${GOOGLE_MODELS_BASE_URL}/models?key=${encodeURIComponent(apiKey)}`;
    const diagUrl = `${GOOGLE_MODELS_BASE_URL}/models`;
    try {
        const res = await httpGet(requestUrl, {}, timeoutMs);
        if (res.statusCode < 200 || res.statusCode >= 300) {
            return {
                success: false,
                models: [],
                baseUrlUsed: diagUrl,
                error: `列模型失败（地址：${diagUrl}，HTTP ${res.statusCode}）${errorBodySnippet(res.body)}`
            };
        }
        const data = safeParseJson(res.body);
        const list: any[] = Array.isArray(data?.models) ? data.models : [];
        const models: FetchedProviderModel[] = [];
        for (const item of list) {
            const rawName = String(item?.name || '').trim();
            if (!rawName) continue;
            const apiModelId = rawName.replace(/^models\//, '');
            if (!apiModelId) continue;
            const displayName =
                typeof item?.displayName === 'string' && item.displayName.trim()
                    ? item.displayName.trim()
                    : undefined;
            models.push({
                apiModelId,
                name: displayName,
                declaredKind: extractDeclaredKind(item),
                inputModalities: extractInputModalities(item),
                outputModalities: extractOutputModalities(item),
                capabilityNames: extractCapabilityNames(item),
                supportedMethods: extractSupportedMethods(item),
                // Google 每个模型都带 inputTokenLimit，此前一直没取，白白丢掉了真实窗口
                contextWindow: extractContextWindow(item)
            });
        }
        return { success: true, models, baseUrlUsed: diagUrl };
    } catch (error: any) {
        return { success: false, models: [], baseUrlUsed: diagUrl, error: describeRequestError(error, diagUrl) };
    }
}

/**
 * /api/show 补齐的并发上限：19 个模型串行要十几秒，一次全发又会给同一台 Ollama 压力。
 */
const OLLAMA_SHOW_CONCURRENCY = 4;

/**
 * 用 /api/show 补齐 tags 没给出的上下文窗口与能力声明。
 *
 * 云端 ollama.com 的 /api/tags 只回 name/size/digest，details 里的字段全是空串
 *（真机 2026-08-23：19 个模型无一带 context_length），真实窗口只在 /api/show 的
 * model_info["{架构}.context_length"] 里，例如 deepseek4.context_length = 1048576。
 * 本地 Ollama 的 tags 自带 details.context_length，命中的模型不会进这里，零额外请求。
 *
 * 逐个模型独立失败：补不到就保持 undefined，由上层如实显示"未知"，不猜、不拿别的模型顶替。
 */
async function fillOllamaModelDetails(
    baseURL: string,
    apiKey: string | undefined,
    models: FetchedProviderModel[],
    timeoutMs: number
): Promise<void> {
    const pending = models.filter(
        (model) => !(typeof model.contextWindow === 'number' && model.contextWindow > 0)
    );
    if (pending.length === 0) return;

    const headers: Record<string, string> = {};
    if (apiKey?.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;

    let cursor = 0;
    async function worker(): Promise<void> {
        while (cursor < pending.length) {
            const model = pending[cursor];
            cursor += 1;
            const res = await httpPostJson(
                `${baseURL}/api/show`,
                headers,
                timeoutMs,
                { name: model.apiModelId }
            ).catch(() => null);
            if (!res || res.statusCode < 200 || res.statusCode >= 300) continue;
            const detail = safeParseJson(res.body);
            if (!detail) continue;
            const contextWindow = extractContextWindow(detail);
            if (contextWindow) model.contextWindow = contextWindow;
            // capabilities（如 ["completion","tools","thinking","vision"]）是 provider 的真实声明，
            // 交给用途分类层解释，好过让这些模型停在 assumed。
            const capabilityNames = extractCapabilityNames(detail);
            if (capabilityNames.length > 0) {
                model.capabilityNames = capabilityNames;
                // 这里是 provider 明确声明，不是按模型名猜测——合并层的护栏针对的是后者。
                // 不声明就不改动（保持 undefined 的"未知"），绝不把"没说"写成 false。
                if (capabilityNames.includes('vision')) model.supportsVision = true;
                if (capabilityNames.includes('tools')) model.supportsToolUse = true;
            }
        }
    }

    await Promise.all(
        Array.from({ length: Math.min(OLLAMA_SHOW_CONCURRENCY, pending.length) }, () => worker())
    );
}

/**
 * Ollama 风格 tags 接口（ollama-cloud 用 https://ollama.com，本地用 {ollamaUrl}）：
 * GET {base}/api/tags，models[].name → apiModelId。cloud 带 Bearer，本地不带。
 */
async function listOllamaTags(
    baseURL: string,
    apiKey: string | undefined,
    timeoutMs: number
): Promise<ListModelsResult> {
    const url = `${baseURL}/api/tags`;
    const headers: Record<string, string> = {};
    if (apiKey?.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
    try {
        const res = await httpGet(url, headers, timeoutMs);
        if (res.statusCode < 200 || res.statusCode >= 300) {
            return {
                success: false,
                models: [],
                baseUrlUsed: url,
                error: `列模型失败（地址：${url}，HTTP ${res.statusCode}）${errorBodySnippet(res.body)}`
            };
        }
        const data = safeParseJson(res.body);
        const list: any[] = Array.isArray(data?.models) ? data.models : [];
        const models: FetchedProviderModel[] = [];
        for (const item of list) {
            const apiModelId = String(item?.name || '').trim();
            if (!apiModelId) continue;
            models.push({
                apiModelId,
                declaredKind: extractDeclaredKind(item),
                inputModalities: extractInputModalities(item),
                outputModalities: extractOutputModalities(item),
                capabilityNames: extractCapabilityNames(item),
                supportedMethods: extractSupportedMethods(item),
                // 本地 Ollama 的 /api/tags 在 details.context_length 里直接给了真实窗口；
                // 云端 ollama.com 不给，缺的部分下面用 /api/show 补。
                contextWindow: extractContextWindow(item)
            });
        }
        await fillOllamaModelDetails(baseURL, apiKey, models, timeoutMs);
        return { success: true, models, baseUrlUsed: url };
    } catch (error: any) {
        return { success: false, models: [], baseUrlUsed: url, error: describeRequestError(error, url) };
    }
}
