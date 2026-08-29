/**
 * 模型服务
 * 
 * 统一管理多个 AI 模型的调用
 * 
 * v2.0 更新：
 * - 统一思维过程提取（ThinkingExtractor）
 * - 支持不同模型的思维过程格式
 */

import {
    resolveToolUseVerdict,
    capabilityBlocksExecution,
    describeCapabilityBlock
} from '../../shared/model-capability-verdict';
import {
    classifyModelProviderFailure,
    type ModelProviderFailure,
    type ModelProviderFailureKind
} from '../../shared/model-provider-failure';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import http from 'http';
import { EventEmitter } from 'events';
import { StringDecoder } from 'string_decoder';
import {
    ALL_MODELS,
    ModelConfig,
    getModelById,
    ThinkingConfig,
    type ModelReasoningEffort
} from '../../shared/config/models.config';
import { buildAgentProviderTokenBudget } from '../../shared/agent-performance-policy';
import type {
    AgentToolStreamChunk,
    AgentToolStreamResponse,
    AgentToolStreamToolCall
} from '../../shared/agent-tool-stream';
import { extractThinkingFromModel, getThinkingRequestParams } from './thinking-extractor';
import { getProviderAdapter } from './provider-adapters';
import type { ToolSchema, AdapterMessage, ProviderResponse } from './provider-adapters';
import { configureProcessProxyFromSystem, getOpenAIHttpAgent } from './network-proxy';
import type { ProviderNativeToolRequest, ProviderNativeToolCitation } from '../../shared/provider-native-tools';
import {
    buildProviderNativeToolPlan,
    normalizeProviderNativeToolCitations
} from '../../shared/provider-native-tools';
import { normalizeStreamTextChunk } from '../../shared/stream-text-normalizer';
import {
    canExecuteProviderStreamToolCalls,
    mergeProviderFinishReason,
    resolveProviderStreamStopReason
} from '../../shared/provider-stream-completion';
import { ClaudeSubscriptionService } from './claude-subscription-service';
import { CodexSubscriptionService } from './codex-subscription-service';
import {
    commitDebugProjectReferenceProviderReceipt,
    prepareDebugProjectReferenceProviderCandidate,
    readDebugProjectReferenceProviderCandidateKeys
} from './debug-project-reference-provider-receipt';
import { ProviderSseDecoder } from './provider-sse-decoder';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
/**
 * Smile AI Studio（New API 聚合网关）OpenAI 兼容基址。
 * 与 provider-model-listing-service.ts 的同名常量保持一致；改一侧请同步另一侧，
 * 避免"列模型用的地址 ≠ 实际调用地址"造成误判。
 */
const SMILE_AI_BASE_URL = 'https://api.smile-ai-studio.com/v1';
const DEEPSEEK_TEST_MODEL = 'deepseek-v4-pro';
const OPENAI_COMPATIBLE_DEFAULT_TIMEOUT_MS = 45_000;
const OPENAI_COMPATIBLE_MIN_TIMEOUT_MS = 5_000;
const OPENAI_COMPATIBLE_MAX_TIMEOUT_MS = 300_000;
const XIAOMI_MIMO_DEFAULT_TEMPERATURE = 1.0;
const XIAOMI_MIMO_DEFAULT_TOP_P = 0.95;
const OLLAMA_CLOUD_BASE_URL = 'https://ollama.com';
const OLLAMA_CLOUD_TEST_TIMEOUT_MS = 20_000;

type ModelProviderHttpError = Error & {
    status: number;
    code: string;
};

/** 模型返回了响应但正文为空时抛出的错误（区别于 HTTP 失败），供上层识别并采取针对性恢复。 */
export type ModelEmptyContentError = Error & {
    code: 'model_empty_content';
    /** 输出预算被思考内容吃光：有 reasoning 但没有正文 */
    thinkingOnly: boolean;
    finishReason: string;
    maxTokens: number;
};

type ModelOutputIncompleteError = Error & {
    code: 'model_output_incomplete';
    stopReason: string;
};

/**
 * 空正文必须报错，不能静默返回 ''。
 *
 * 真机实测（deepseek-v4-flash，2026-08-06）：撰写文案任务开启思考时，4096 与 8192 两档
 * 输出预算都被 reasoning 全部吃光（finish_reason=length，reasoning_tokens 打满，正文 0 字），
 * 而调用方只能看到一个空字符串，最终报成"模型未返回可解析的候选文案"这种猜测式错误。
 * 把真实环节（谁失败、为什么失败、怎么修）在这里就说清楚。
 */
function createModelEmptyContentError(input: {
    providerName: string;
    modelLabel: string;
    finishReason: string;
    maxTokens: number;
    thinkingLength: number;
    outputTokens: number;
}): ModelEmptyContentError {
    const thinkingOnly = input.thinkingLength > 0;
    const reason = thinkingOnly
        ? `模型只产出了思考内容（${input.thinkingLength} 字），正文为空`
        : '模型没有产出任何正文';
    const advice = thinkingOnly
        ? '通常是输出 token 预算被思考过程占满：请提高该任务的 maxTokens，或对这类只要固定格式结果的任务关闭思考模式。'
        : '请检查该模型是否可用、账号是否有额度，或更换主模型后重试。';
    const error = new Error(
        `${input.providerName} 模型 ${input.modelLabel} 调用成功但${reason}`
        + `（finish_reason=${input.finishReason || '未知'}，max_tokens=${input.maxTokens}，`
        + `本次输出 ${input.outputTokens} token）。${advice}`
    ) as ModelEmptyContentError;
    error.name = 'ModelEmptyContentError';
    error.code = 'model_empty_content';
    error.thinkingOnly = thinkingOnly;
    error.finishReason = input.finishReason;
    error.maxTokens = input.maxTokens;
    return error;
}

function createModelProviderHttpError(
    providerLabel: string,
    status: number,
    diagnostic: string
): ModelProviderHttpError {
    const detail = String(diagnostic || '').replace(/\s+/g, ' ').trim().slice(0, 600);
    const error = new Error(
        `${providerLabel} HTTP ${status}${detail ? `: ${detail}` : ''}`
    ) as ModelProviderHttpError;
    error.name = 'ModelProviderHttpError';
    error.status = status;
    error.code = `${providerLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_http_${status}`;
    return error;
}

function assertPlainModelOutputComplete(input: {
    providerName: string;
    finishReason: unknown;
    transportComplete?: boolean;
}): void {
    const stopReason = resolveProviderStreamStopReason({
        finishReason: input.finishReason,
        hasToolCalls: false,
        transportComplete: input.transportComplete
    });
    if (stopReason === 'end_turn') return;

    const message = stopReason === 'content_blocked'
        ? `${input.providerName} 模型服务拦截了本次输出，未返回可交付的完整内容。`
        : `${input.providerName} 模型输出没有完整结束，已丢弃未确认的部分内容。`;
    const error = new Error(message) as ModelOutputIncompleteError;
    error.name = 'ModelOutputIncompleteError';
    error.code = 'model_output_incomplete';
    error.stopReason = stopReason;
    throw error;
}

function isModelOutputIncompleteError(error: unknown): error is ModelOutputIncompleteError {
    return Boolean(
        error
        && typeof error === 'object'
        && (error as { code?: unknown }).code === 'model_output_incomplete'
    );
}

function buildAgentToolStreamErrorChunk(
    error: unknown
): Extract<AgentToolStreamChunk, { type: 'error' }> {
    const failure = classifyModelProviderFailure(error);
    const rawName = error instanceof Error ? error.name : '';
    const errorName = String(rawName || '')
        .replace(/[^A-Za-z0-9_.-]/g, '')
        .slice(0, 80);
    return {
        type: 'error',
        error: failure.diagnostic || '模型流式请求失败',
        ...(failure.providerCode ? { errorCode: failure.providerCode } : {}),
        ...(failure.status ? { errorStatus: failure.status } : {}),
        ...(errorName ? { errorName } : {})
    };
}

interface ModelChatOptions {
    maxTokens?: number;
    temperature?: number;
    timeoutMs?: number;
    thinkingEnabled?: boolean;
    reasoningEffort?: ModelReasoningEffort;
    visualPresentationCandidateKeys?: string[];
}

function resolveOpenAICompatibleTimeoutMs(options?: ModelChatOptions): number {
    const requested = Number(options?.timeoutMs);
    if (Number.isFinite(requested) && requested > 0) {
        return Math.min(
            OPENAI_COMPATIBLE_MAX_TIMEOUT_MS,
            Math.max(OPENAI_COMPATIBLE_MIN_TIMEOUT_MS, Math.floor(requested))
        );
    }
    return OPENAI_COMPATIBLE_DEFAULT_TIMEOUT_MS;
}

function createModelStreamAbortError(): Error & { code: string } {
    const error = new Error('模型流式请求已取消') as Error & { code: string };
    error.name = 'AbortError';
    error.code = 'stream_aborted';
    return error;
}

function requireDebugProjectReferenceProviderReceipt(
    candidate: Parameters<typeof commitDebugProjectReferenceProviderReceipt>[0],
    options: Parameters<typeof commitDebugProjectReferenceProviderReceipt>[1]
): void {
    if (!candidate) return;
    const receipt = commitDebugProjectReferenceProviderReceipt(candidate, options);
    if (receipt) return;
    const error = new Error(
        '受控调试无法证明目标参考进入真实 Provider 请求，已在 Photoshop 写入前中止本轮。'
    ) as Error & { code?: string };
    error.code = 'debug_project_reference_provider_receipt_unverified';
    throw error;
}

function awaitModelCallWithCancellation<T>(
    createPending: () => Promise<T>,
    signal: AbortSignal,
    timeoutMs?: number
): Promise<T> {
    if (signal.aborted) return Promise.reject(createModelStreamAbortError());

    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const requestedTimeout = Number(timeoutMs);
        const hasTimeout = Number.isFinite(requestedTimeout) && requestedTimeout > 0;
        let timer: ReturnType<typeof setTimeout> | undefined;

        function cleanup(): void {
            signal.removeEventListener('abort', handleAbort);
            if (timer) clearTimeout(timer);
        }

        function settleResolve(value: T): void {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(value);
        }

        function settleReject(error: unknown): void {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
        }

        function handleAbort(): void {
            settleReject(createModelStreamAbortError());
        }

        signal.addEventListener('abort', handleAbort, { once: true });
        if (hasTimeout) {
            timer = setTimeout(() => {
                const error = new Error(
                    `模型请求在 ${Math.round(requestedTimeout)}ms 内没有完成`
                ) as Error & { code?: string };
                error.code = 'model_request_timeout';
                settleReject(error);
            }, requestedTimeout);
        }
        Promise.resolve()
            .then(() => {
                if (signal.aborted) throw createModelStreamAbortError();
                return createPending();
            })
            .then(settleResolve, settleReject);
    });
}

function resolveChatMaxTokens(
    options?: { maxTokens?: number },
    legacyDefaultMaxTokens?: number
): number {
    return buildAgentProviderTokenBudget({
        requestedMaxTokens: options?.maxTokens,
        legacyDefaultMaxTokens
    }).maxTokens;
}

export interface ModelMessage {
    role: 'user' | 'assistant';
    content: string | MessageContent[];
}

export interface MessageContent {
    type: 'text' | 'image';
    text?: string;
    image?: {
        data: string;      // base64
        mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
    };
}

export interface ModelResponse {
    text: string;
    thinking?: string;  // 模型的思维过程（如果有）
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
    visualPresentationReceipt?: unknown;
}

export interface AgentToolStreamHandle extends EventEmitter {
    abort: () => void;
}

interface AccumulatedToolCall {
    id?: string;
    name?: string;
    argumentsText: string;
}

function safeParseToolArguments(value: string): Record<string, any> {
    const trimmed = String(value || '').trim();
    if (!trimmed) return {};
    try {
        const parsed = JSON.parse(trimmed);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function parseExecutableToolArguments(value: string): {
    valid: boolean;
    arguments: Record<string, any>;
} {
    const trimmed = String(value || '').trim();
    if (!trimmed) return { valid: false, arguments: {} };
    try {
        const parsed = JSON.parse(trimmed);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? { valid: true, arguments: parsed }
            : { valid: false, arguments: {} };
    } catch {
        return { valid: false, arguments: {} };
    }
}

function buildToolCallsFromDeltas(calls: Map<number, AccumulatedToolCall>): {
    toolCalls: AgentToolStreamToolCall[];
    valid: boolean;
} {
    const candidates = [...calls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, call]) => {
            const id = String(call.id || '').trim();
            const name = String(call.name || '').trim();
            const parsedArguments = parseExecutableToolArguments(call.argumentsText);
            return {
                valid: Boolean(id && name && parsedArguments.valid),
                toolCall: {
                    id,
                    name,
                    arguments: parsedArguments.arguments
                }
            };
        });
    return {
        toolCalls: candidates.map((candidate) => candidate.toolCall),
        valid: candidates.every((candidate) => candidate.valid)
    };
}

function collectIncompleteToolCallNames(
    calls: Map<number, AccumulatedToolCall>,
    stopReason: unknown
): string[] {
    if (stopReason !== 'max_tokens' && stopReason !== 'stream_incomplete') return [];
    return Array.from(new Set(
        [...calls.values()]
            .map((call) => String(call.name || '').trim())
            .filter(Boolean)
    ));
}

export interface DeepSeekTestResult {
    success: boolean;
    message?: string;
    error?: string;
    status?: number;
    baseUrl?: string;
    model?: string;
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
}

export interface OllamaCloudTestResult {
    success: boolean;
    kind: 'ok' | ModelProviderFailureKind;
    message?: string;
    error?: string;
    status?: number;
    model?: string;
    keyAuthenticated?: boolean;
    modelAccess?: boolean;
    diagnostic?: string;
}

interface ModelServiceConfig {
    anthropicApiKey?: string;
    googleApiKey?: string;
    xiaomiApiKey?: string;
    openaiApiKey?: string;
    openrouterApiKey?: string;
    deepseekApiKey?: string;
    smileAiApiKey?: string;
    ollamaUrl?: string;
    ollamaApiKey?: string;  // Ollama Cloud API Key
}

interface ModelToolCallOptions {
    maxTokens?: number;
    temperature?: number;
    nativeTools?: ProviderNativeToolRequest[];
    /** per-request 超时(毫秒)，覆盖 client 默认 45 秒。web_search 等联网慢调用需要更长。 */
    timeoutMs?: number;
    /** 工具循环是否开启原生思考(reasoning_content)；透传给 adapter.formatMessages 决定思考开关与 reasoning 回写。 */
    thinkingEnabled?: boolean;
    /** 只在 Provider 目录真实声明支持时采用；其它 Provider 保持现有请求语义。 */
    reasoningEffort?: ModelReasoningEffort;
    /** 与本次 outgoing 图片顺序一一对应；只有实现回执的 Provider 才消费。 */
    visualPresentationCandidateKeys?: string[];
}

export class ModelService {
    private anthropic: Anthropic | null = null;
    private gemini: GoogleGenerativeAI | null = null;
    private xiaomi: OpenAI | null = null;
    private openai: OpenAI | null = null;
    private deepseek: OpenAI | null = null;
    private smileAi: OpenAI | null = null;
    private ollamaBaseUrl = 'http://127.0.0.1:11434';
    private config: ModelServiceConfig;
    private readonly codexSubscriptionService: CodexSubscriptionService | null;
    private readonly claudeSubscriptionService: ClaudeSubscriptionService | null;

    constructor(
        config: ModelServiceConfig,
        codexSubscriptionService?: CodexSubscriptionService | null,
        claudeSubscriptionService?: ClaudeSubscriptionService | null
    ) {
        this.config = config;
        this.codexSubscriptionService = codexSubscriptionService || null;
        this.claudeSubscriptionService = claudeSubscriptionService || null;
        this.initializeClients();
    }

    /**
     * 更新配置
     */
    updateConfig(config: Partial<ModelServiceConfig>): void {
        this.config = { ...this.config, ...config };
        this.initializeClients();
    }

    getModelSelectionApiKeys(): Record<string, string | undefined> {
        return {
            anthropic: this.config.anthropicApiKey,
            google: this.config.googleApiKey,
            xiaomi: this.config.xiaomiApiKey,
            openai: this.config.openaiApiKey,
            openrouter: this.config.openrouterApiKey,
            deepseek: this.config.deepseekApiKey,
            smileAi: this.config.smileAiApiKey,
            ollamaApiKey: this.config.ollamaApiKey,
        };
    }

    /**
     * 初始化客户端
     */
    private initializeClients(): void {
        configureProcessProxyFromSystem();
        const httpAgent = getOpenAIHttpAgent();

        this.anthropic = null;
        this.gemini = null;
        this.xiaomi = null;
        this.openai = null;
        this.deepseek = null;
        this.smileAi = null;

        if (this.config.anthropicApiKey) {
            this.anthropic = new Anthropic({ apiKey: this.config.anthropicApiKey });
            console.log('[ModelService] Anthropic client initialized');
        }
        if (this.config.googleApiKey) {
            this.gemini = new GoogleGenerativeAI(this.config.googleApiKey);
            console.log('[ModelService] Gemini client initialized');
        }
        if (this.config.xiaomiApiKey) {
            this.xiaomi = new OpenAI({
                apiKey: this.config.xiaomiApiKey,
                baseURL: 'https://api.xiaomimimo.com/v1',
                httpAgent,
                timeout: OPENAI_COMPATIBLE_DEFAULT_TIMEOUT_MS,
                maxRetries: 0
            });
            console.log('[ModelService] Xiaomi MiMo client initialized');
        }
        if (this.config.openaiApiKey) {
            this.openai = new OpenAI({
                apiKey: this.config.openaiApiKey,
                httpAgent,
                timeout: OPENAI_COMPATIBLE_DEFAULT_TIMEOUT_MS,
                maxRetries: 0
            });
            console.log('[ModelService] OpenAI client initialized');
        }
        if (this.config.deepseekApiKey) {
            this.deepseek = new OpenAI({
                apiKey: this.config.deepseekApiKey,
                baseURL: DEEPSEEK_BASE_URL,
                httpAgent,
                timeout: OPENAI_COMPATIBLE_DEFAULT_TIMEOUT_MS,
                maxRetries: 0
            });
            console.log('[ModelService] DeepSeek official client initialized');
        }
        if (this.config.smileAiApiKey) {
            this.smileAi = new OpenAI({
                apiKey: this.config.smileAiApiKey,
                baseURL: SMILE_AI_BASE_URL,
                httpAgent,
                timeout: OPENAI_COMPATIBLE_DEFAULT_TIMEOUT_MS,
                maxRetries: 0
            });
            console.log('[ModelService] Smile AI Studio client initialized');
        }
        if (this.config.ollamaUrl) {
            this.ollamaBaseUrl = this.config.ollamaUrl;
        }
    }

    /**
     * 统一聊天接口
     * 
     * 模型 ID 格式：
     * - 本地模型: local-xxx (如 local-qwen2.5-14b)
     * - 云端模型: provider-xxx (如 google-gemini-3-pro)
     */
    async chat(
        modelId: string,
        messages: ModelMessage[],
        options?: ModelChatOptions,
        debugTransportMetadata?: unknown
    ): Promise<ModelResponse> {
        console.log(`[ModelService] ========== chat() 被调用 ==========`);
        console.log(`[ModelService] modelId: ${modelId}`);
        console.log(`[ModelService] 消息数量: ${messages.length}`);
        
        // 从统一配置获取模型信息
        const model = getModelById(modelId);
        
        // 如果找不到，尝试动态解析模型 ID
        if (!model) {
            // 本地 Ollama 模型（新格式）
            if (modelId.startsWith('local-')) {
                const ollamaModel = this.localIdToOllamaModel(modelId);
                console.log(`[ModelService] Dynamic local Ollama model: ${ollamaModel}`);
                return this.chatOllamaDynamic(ollamaModel, messages, options);
            }
            // 兼容旧的 ollama- 前缀
            if (modelId.startsWith('ollama-') && !modelId.startsWith('ollama-cloud-')) {
                const ollamaModel = modelId.replace('ollama-', '');
                console.log(`[ModelService] Legacy Ollama model: ${ollamaModel}`);
                return this.chatOllamaDynamic(ollamaModel, messages, options);
            }
            // 动态 OpenRouter 模型
            if (modelId.startsWith('openrouter-')) {
                const orModel = modelId.replace('openrouter-', '');
                console.log(`[ModelService] Dynamic OpenRouter model: ${orModel}`);
                return this.chatOpenRouterDynamic(orModel, messages, options);
            }
            // 注册表也查不到（动态模型未注入主进程）：内部 id 经 slug 化不可逆，
            // 不能从字符串反推真实 apiModelId。如实提示用户重新刷新该 provider 的模型列表。
            throw new Error(
                `动态模型未注册（${modelId}），无法解析真实 API 模型名。请在设置中重新刷新该 provider 的模型列表后重试。`
            );
        }

        console.log(`[ModelService] 调用模型: ${model.name} (${model.source}/${model.provider})`);

        // 失败必须留痕：此前这里直接 return 各 provider 分支，调用抛错时主日志只剩一句
        // 「chat() 被调用」，真实原因（HTTP 状态、provider 报文、apiModelId 对不对）全部丢失。
        // 真机 2026-08-01 因此无法定位：用户看到「当前模型没有通过认证」，而日志里没有任何错误行，
        // 只能靠猜。诊断信息按用户可诊断性要求给全：内部 id、真实 API 模型名、provider、原始错误。
        const debugProjectReferenceCandidate = prepareDebugProjectReferenceProviderCandidate(
            messages,
            'chat',
            debugTransportMetadata
        );
        try {
            const response = await this.dispatchChatByProvider(model, messages, {
                ...options,
                ...(debugProjectReferenceCandidate ? {
                    visualPresentationCandidateKeys:
                        readDebugProjectReferenceProviderCandidateKeys(
                            debugProjectReferenceCandidate
                        )
                } : {})
            });
            requireDebugProjectReferenceProviderReceipt(debugProjectReferenceCandidate, {
                provider: model.provider,
                modelId: model.apiModelId || model.id,
                visualPresentationReceipt: response.visualPresentationReceipt
            });
            return response;
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            const status = (error as any)?.status ?? (error as any)?.statusCode ?? '';
            console.error(
                `[ModelService] 模型调用失败 modelId=${modelId} apiModelId=${model.apiModelId || '(未配置)'} `
                + `provider=${model.provider}${status ? ` httpStatus=${status}` : ''}：${reason}`
            );
            throw error;
        }
    }

    private async dispatchChatByProvider(
        model: ModelConfig,
        messages: ModelMessage[],
        options?: ModelChatOptions
    ): Promise<ModelResponse> {
        switch (model.provider) {
            case 'ollama':
                // 本地 Ollama
                return this.chatOllama(model as any, messages, options);
            case 'ollama-cloud':
                // Ollama Cloud 云服务
                return this.chatOllamaCloud(model as any, messages, options);
            case 'google':
                return this.chatGemini(model as any, messages, options);
            case 'xiaomi':
                return this.chatXiaomi(model as any, messages, options);
            case 'openrouter':
                return this.chatOpenRouter(model as any, messages, options);
            case 'anthropic':
                return this.chatAnthropic(model as any, messages, options);
            case 'openai':
                return this.chatOpenAI(model as any, messages, options);
            case 'openai-codex': {
                if (!this.codexSubscriptionService) {
                    throw new Error('ChatGPT 订阅服务尚未初始化。');
                }
                const response = await this.codexSubscriptionService.chatWithTools(
                    model.apiModelId,
                    this.toAdapterMessages(messages),
                    [],
                    {
                    timeoutMs: options?.timeoutMs,
                    reasoningEffort: options?.reasoningEffort,
                    visualPresentationCandidateKeys: options?.visualPresentationCandidateKeys
                }
            );
            return {
                text: response.content || '',
                usage: response.usage,
                ...(response.visualPresentationReceipt ? {
                    visualPresentationReceipt: response.visualPresentationReceipt
                } : {})
            };
            }
            case 'claude-subscription': {
                if (!this.claudeSubscriptionService) {
                    throw new Error('Claude 订阅服务尚未初始化。');
                }
                const claudeResponse = await this.claudeSubscriptionService.chatWithTools(
                    model.apiModelId,
                    this.toAdapterMessages(messages),
                    [],
                    { maxTokens: options?.maxTokens }
                );
                return { text: claudeResponse.content || '' };
            }
            case 'deepseek':
                return this.chatDeepSeek(model as any, messages, options);
            case 'smile-ai':
                return this.chatSmileAi(model as any, messages, options);
            default:
                throw new Error(`不支持的提供商: ${model.provider}`);
        }
    }

    private toAdapterMessages(messages: ModelMessage[]): AdapterMessage[] {
        return messages.map((message) => {
            if (typeof message.content === 'string') {
                return { role: message.role, content: message.content };
            }
            return {
                role: message.role,
                contentBlocks: message.content.map((block) => {
                    if (block.type === 'image' && block.image) {
                        return {
                            type: 'image' as const,
                            data: block.image.data,
                            mediaType: block.image.mediaType
                        };
                    }
                    return {
                        type: 'text' as const,
                        text: String(block.text || '')
                    };
                })
            };
        });
    }
    
    /**
     * 将 local-xxx 格式的 ID 转换为 Ollama 模型名
     */
    private localIdToOllamaModel(localId: string): string {
        // local-qwen2.5-14b -> qwen2.5:14b
        const name = localId.replace('local-', '');
        // 查找最后一个 - 后面的数字部分作为标签
        const match = name.match(/^(.+)-(\d+b)$/);
        if (match) {
            return `${match[1]}:${match[2]}`;
        }
        return name;
    }

    /**
     * 动态 Ollama 模型调用（支持用户自定义模型）
     * 
     * 使用统一的 ThinkingExtractor（默认尝试 xml_tag）
     */
    private async chatOllamaDynamic(
        ollamaModel: string,
        messages: ModelMessage[],
        options?: { maxTokens?: number; temperature?: number }
    ): Promise<ModelResponse> {
        console.log(`[ModelService] Calling dynamic Ollama model: ${ollamaModel}`);

        const ollamaMessages = messages.map(msg => {
            const baseMessage: any = {
                role: msg.role,
                content: typeof msg.content === 'string'
                    ? msg.content
                    : msg.content
                        .filter(c => c.type === 'text')
                        .map(c => c.text)
                        .join('\n')
            };

            if (typeof msg.content !== 'string') {
                const images = msg.content
                    .filter(c => c.type === 'image' && c.image)
                    .map(c => c.image!.data);
                if (images.length > 0) {
                    baseMessage.images = images;
                }
            }

            return baseMessage;
        });

        const requestBody = JSON.stringify({
            model: ollamaModel,
            messages: ollamaMessages,
            stream: false,
            options: {
                num_predict: resolveChatMaxTokens(options),
                temperature: options?.temperature ?? 0.7
            }
        });

        return new Promise((resolve, reject) => {
            const http = require('http');
            const req = http.request({
                hostname: '127.0.0.1',
                port: 11434,
                path: '/api/chat',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(requestBody)
                },
                timeout: 180000  // 3 分钟，大模型冷启动需更长时间
            }, (res: any) => {
                let data = '';
                res.on('data', (chunk: any) => { data += chunk; });
                res.on('end', () => {
                    try {
                        if (res.statusCode !== 200) {
                            reject(new Error(`Ollama error (${res.statusCode}): ${data}`));
                            return;
                        }
                        const parsed = JSON.parse(data);
                        assertPlainModelOutputComplete({
                            providerName: 'Ollama',
                            finishReason: parsed.done_reason,
                            transportComplete: parsed.done === true
                        });
                        
                        // 动态模型默认尝试 xml_tag 格式
                        const { thinking, content } = extractThinkingFromModel(parsed, undefined);
                        
                        resolve({
                            text: content,
                            thinking: thinking || undefined,
                            usage: {
                                inputTokens: parsed.prompt_eval_count || 0,
                                outputTokens: parsed.eval_count || 0
                            }
                        });
                    } catch (e) {
                        if (isModelOutputIncompleteError(e)) {
                            reject(e);
                            return;
                        }
                        reject(new Error(`Failed to parse Ollama response: ${e}`));
                    }
                });
            });
            req.on('error', (error: any) => {
                reject(new Error(`🖥️ 无法连接到本地 Ollama 服务\n\n请检查:\n• 运行 ollama serve 启动服务\n• 或在设置中切换到云端模式`));
            });
            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`⏱️ Ollama 响应超时 (3 分钟)\n\n可能原因:\n• 大模型首次加载需 1–2 分钟，请稍后重试\n• 可先运行 ollama run <模型名> 预热\n• 或切换到更小的模型`));
            });
            req.write(requestBody);
            req.end();
        });
    }

    /**
     * 动态 OpenRouter 模型调用
     * 
     * 使用统一的 ThinkingExtractor（默认尝试 reasoning_content + xml_tag）
     */
    private async chatOpenRouterDynamic(
        openrouterModel: string,
        messages: ModelMessage[],
        options?: { maxTokens?: number; temperature?: number }
    ): Promise<ModelResponse> {
        if (!this.config.openrouterApiKey) {
            throw new Error('OpenRouter API key not configured');
        }

        console.log(`[ModelService] Calling dynamic OpenRouter model: ${openrouterModel}`);

        const openrouterMessages = messages.map(msg => ({
            role: msg.role,
            content: this.convertToOpenAIContent(msg.content)
        }));

        const requestBody = JSON.stringify({
            model: openrouterModel,
            messages: openrouterMessages,
            max_tokens: resolveChatMaxTokens(options),
            temperature: options?.temperature ?? 0.7
        });

        return new Promise((resolve, reject) => {
            const https = require('https');
            const req = https.request({
                hostname: 'openrouter.ai',
                port: 443,
                path: '/api/v1/chat/completions',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.openrouterApiKey}`,
                    'HTTP-Referer': 'https://designecho.app',
                    'X-Title': 'DesignEcho Agent',
                    'Content-Length': Buffer.byteLength(requestBody)
                },
                timeout: 60000
            }, (res: any) => {
                let data = '';
                res.on('data', (chunk: any) => { data += chunk; });
                res.on('end', () => {
                    try {
                        if (res.statusCode !== 200) {
                            let errorData: any = {};
                            try { errorData = JSON.parse(data); } catch {}
                            reject(new Error(this.formatOpenRouterError(res.statusCode, errorData, openrouterModel)));
                            return;
                        }
                        const parsed = JSON.parse(data);
                        assertPlainModelOutputComplete({
                            providerName: 'OpenRouter',
                            finishReason: parsed.choices?.[0]?.finish_reason
                        });
                        
                        // 动态模型默认尝试 reasoning_content 格式
                        const dynamicThinkingConfig: ThinkingConfig = {
                            supported: true,
                            format: 'reasoning_content'
                        };
                        const { thinking, content } = extractThinkingFromModel(parsed, dynamicThinkingConfig);
                        
                        resolve({
                            text: content,
                            thinking: thinking || undefined,
                            usage: {
                                inputTokens: parsed.usage?.prompt_tokens || 0,
                                outputTokens: parsed.usage?.completion_tokens || 0
                            }
                        });
                    } catch (e) {
                        if (isModelOutputIncompleteError(e)) {
                            reject(e);
                            return;
                        }
                        reject(new Error(`❌ OpenRouter 响应解析失败\n\n请稍后重试`));
                    }
                });
            });
            req.on('error', (error: any) => {
                reject(new Error(`🌐 无法连接到 OpenRouter\n\n请检查网络连接`));
            });
            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`⏱️ OpenRouter 请求超时\n\n请稍后重试`));
            });
            req.write(requestBody);
            req.end();
        });
    }

    /**
     * Claude API
     * 
     * 使用统一的 ThinkingExtractor 处理 Extended Thinking
     */
    private async chatAnthropic(
        model: ModelConfig,
        messages: ModelMessage[],
        options?: { maxTokens?: number; temperature?: number }
    ): Promise<ModelResponse> {
        if (!this.anthropic) {
            throw new Error('Anthropic API key not configured');
        }

        const anthropicMessages = messages.map(msg => ({
            role: msg.role as 'user' | 'assistant',
            content: this.convertToAnthropicContent(msg.content)
        }));

        const modelName = model.id === 'claude-3-5-sonnet' 
            ? 'claude-3-5-sonnet-20241022' 
            : model.id === 'claude-3-opus' 
                ? 'claude-3-opus-20240229'
                : model.id;

        const response = await this.anthropic.messages.create({
            model: modelName,
            max_tokens: resolveChatMaxTokens(options),
            temperature: options?.temperature,
            messages: anthropicMessages
        });
        assertPlainModelOutputComplete({
            providerName: 'Anthropic',
            finishReason: response.stop_reason
        });

        // 使用统一的 ThinkingExtractor 提取思维过程
        const { thinking, content } = this.extractThinkingForResponse(response, model, options);
        
        return {
            text: content,
            thinking: thinking || undefined,
            usage: {
                inputTokens: response.usage.input_tokens,
                outputTokens: response.usage.output_tokens
            }
        };
    }

    /**
     * Gemini API (Google AI Studio 官方渠道)
     */
    private async chatGemini(
        model: ModelConfig,
        messages: ModelMessage[],
        options?: { maxTokens?: number; temperature?: number }
    ): Promise<ModelResponse> {
        console.log(`[ModelService] ========== Google AI 调用开始 ==========`);
        console.log(`[ModelService] Gemini 客户端状态: ${this.gemini ? '✅ 已初始化' : '❌ 未初始化'}`);
        console.log(`[ModelService] Google API Key 配置: ${this.config.googleApiKey ? '✅ 已配置 (' + this.config.googleApiKey.substring(0, 8) + '...)' : '❌ 未配置'}`);
        
        if (!this.gemini) {
            console.error('[ModelService] ❌ Gemini 客户端未初始化，API Key 可能未同步');
            throw new Error('Google API key not configured. 请在设置中配置 Google AI Studio API Key');
        }

        // 使用 apiModelId 获取正确的模型名称
        // Google AI SDK 接受两种格式: "gemini-1.5-pro" 或 "models/gemini-1.5-pro"
        let modelName = model.apiModelId || model.id.replace('google-', '');
        
        // 去除 models/ 前缀（SDK 会自动处理）
        if (modelName.startsWith('models/')) {
            modelName = modelName.replace('models/', '');
        }
        
        console.log(`[ModelService] 🎯 调用模型: ${modelName}`);
        console.log(`[ModelService] 📝 消息数量: ${messages.length}`);

        const genModel = this.gemini.getGenerativeModel({
            model: modelName,
            generationConfig: {
                maxOutputTokens: resolveChatMaxTokens(options, model.maxTokens || 8192),
                temperature: options?.temperature
            }
        });

        // 转换消息为 Gemini 格式
        const parts = this.convertToGeminiContent(messages);

        try {
        const result = await genModel.generateContent({
            contents: [{ role: 'user', parts }]
        });

        const response = await result.response;
            assertPlainModelOutputComplete({
                providerName: 'Google AI',
                finishReason: response.candidates?.[0]?.finishReason
            });
            const rawText = response.text();
            
            // 使用统一的 ThinkingExtractor 提取思维过程
            // Google Gemini 不原生支持思维过程，但尝试解析 XML 标签
            const { thinking, content } = this.extractThinkingForResponse({ text: rawText }, model, options);
            
            console.log(`[ModelService] Google AI Studio response received (${content.length} chars)`);
            
        return {
                text: content,
                thinking: thinking || undefined,
            usage: {
                inputTokens: response.usageMetadata?.promptTokenCount || 0,
                outputTokens: response.usageMetadata?.candidatesTokenCount || 0
            }
        };
        } catch (error: any) {
            if (isModelOutputIncompleteError(error)) throw error;
            // 详细错误日志
            console.error(`[ModelService] ❌ Google AI 调用失败`);
            console.error(`[ModelService] 原始错误:`, error);
            console.error(`[ModelService] 错误类型: ${error.constructor?.name}`);
            console.error(`[ModelService] 错误消息: ${error.message}`);
            console.error(`[ModelService] 错误状态: ${error.status || error.statusCode || 'N/A'}`);
            
            // 提供更友好的错误信息
            const friendlyError = this.formatGoogleError(error, modelName);
            throw new Error(friendlyError);
        }
    }

    /**
     * 格式化 Google API 错误为友好提示
     */
    private formatGoogleError(error: any, modelName: string): string {
        const status = error.status || error.statusCode;
        const message = error.message || '';
        
        // 429 配额超限
        if (status === 429 || message.includes('429') || message.includes('RESOURCE_EXHAUSTED') || message.includes('quota')) {
            // 尝试提取重试时间
            const retryMatch = message.match(/retry in (\d+)/i) || message.match(/retryDelay.*?(\d+)s/);
            const retryTime = retryMatch ? retryMatch[1] : null;
            
            let tip = `⚠️ Google AI 配额已用尽\n\n`;
            tip += `模型: ${modelName}\n`;
            if (retryTime) {
                tip += `建议等待: ${retryTime} 秒后重试\n\n`;
            }
            tip += `💡 解决方案:\n`;
            tip += `• 等待配额恢复（通常每分钟/每天重置）\n`;
            tip += `• 切换到其他模型（如 Gemini 2.5 Flash）\n`;
            tip += `• 升级 Google AI Studio 付费计划`;
            return tip;
        }
        
        // 401/403 认证错误
        if (status === 401 || status === 403 || message.includes('API_KEY_INVALID') || message.includes('PERMISSION_DENIED')) {
            return `🔑 Google AI API Key 无效或权限不足\n\n请检查:\n• API Key 是否正确\n• 是否已启用 Generative Language API\n• API Key 是否有使用限制`;
        }
        
        // 404 模型不存在
        if (status === 404 || message.includes('not found') || message.includes('NOT_FOUND')) {
            return `❌ 模型 ${modelName} 不存在\n\n可能原因:\n• 模型名称错误\n• 该模型在你的地区不可用\n• 模型已下线或更名`;
        }
        
        // 500 服务器错误
        if (status >= 500 || message.includes('INTERNAL')) {
            return `⚠️ Google AI 服务暂时不可用\n\n请稍后重试，或切换到其他模型`;
        }
        
        // 网络错误
        if (message.includes('fetch') || message.includes('network') || message.includes('ECONNREFUSED')) {
            return `🌐 网络连接失败\n\n请检查:\n• 网络连接是否正常\n• 是否需要代理访问 Google 服务`;
        }
        
        // 默认错误
        return `❌ Google AI 调用失败\n\n${message.substring(0, 200)}`;
    }

    /**
     * 格式化 OpenRouter API 错误为友好提示
     */
    private formatOpenRouterError(statusCode: number, errorData: any, modelName: string): string {
        const errorMessage = errorData?.error?.message || errorData?.message || '';
        
        // 401 认证错误
        if (statusCode === 401) {
            return `🔑 OpenRouter API Key 无效\n\n请在设置中检查 API Key 是否正确`;
        }
        
        // 402 余额不足
        if (statusCode === 402) {
            return `💳 OpenRouter 账户余额不足\n\n请前往 openrouter.ai 充值后重试`;
        }
        
        // 403 地区限制或权限问题
        if (statusCode === 403) {
            if (errorMessage.includes('region') || errorMessage.includes('not available')) {
                return `🌍 模型 ${modelName} 在你的地区不可用\n\n💡 建议:\n• 切换到 DeepSeek V3\n• 切换到 Qwen 2.5 系列\n• 使用 Google Gemini（需 Google API Key）`;
            }
            return `🚫 无权访问模型 ${modelName}\n\n请检查 API Key 权限或切换其他模型`;
        }
        
        // 429 配额超限
        if (statusCode === 429) {
            return `⚠️ OpenRouter 请求频率过高\n\n请稍等片刻后重试`;
        }
        
        // 500+ 服务器错误
        if (statusCode >= 500) {
            return `⚠️ OpenRouter 服务暂时不可用\n\n请稍后重试`;
        }
        
        // 模型不存在
        if (statusCode === 404 || errorMessage.includes('not found')) {
            return `❌ 模型 ${modelName} 不存在\n\n请在设置中选择其他模型`;
        }
        
        // 默认错误
        return `❌ OpenRouter 调用失败 (${statusCode})\n\n${errorMessage.substring(0, 150)}`;
    }

    /**
     * OpenAI API
     * 
     * 使用统一的 ThinkingExtractor 处理思维过程
     */
    private async chatOpenAI(
        model: ModelConfig,
        messages: ModelMessage[],
        options?: ModelChatOptions
    ): Promise<ModelResponse> {
        return this.chatOpenAICompatible(this.openai, 'OpenAI', model, messages, options);
    }

    private async chatXiaomi(
        model: ModelConfig,
        messages: ModelMessage[],
        options?: ModelChatOptions
    ): Promise<ModelResponse> {
        return this.chatOpenAICompatible(this.xiaomi, 'Xiaomi MiMo', model, messages, options);
    }

    private async chatDeepSeek(
        model: ModelConfig,
        messages: ModelMessage[],
        options?: ModelChatOptions
    ): Promise<ModelResponse> {
        const textOnlyMessages = this.toTextOnlyMessages(messages);
        return this.chatOpenAICompatible(this.deepseek, 'DeepSeek', model, textOnlyMessages, options);
    }

    /**
     * Smile AI Studio 网关对话。
     *
     * 刻意不套 toTextOnlyMessages：网关主力模型（claude / gemini / gpt 系）支持图像输入，
     * 剥成纯文本会让 Agent 的视觉观察静默失效——那正是"用兜底掩盖能力"的反面教材。
     * 若某型号实际不支持图像，网关会明确报错，按真实报错处理。
     */
    private async chatSmileAi(
        model: ModelConfig,
        messages: ModelMessage[],
        options?: ModelChatOptions
    ): Promise<ModelResponse> {
        return this.chatOpenAICompatible(this.smileAi, 'Smile AI Studio', model, messages, options);
    }

    async testDeepSeek(apiKey?: string): Promise<DeepSeekTestResult> {
        const key = (apiKey ?? this.config.deepseekApiKey ?? '').trim();

        if (!key) {
            return {
                success: false,
                error: '请先输入 DeepSeek 官方 API Key。',
                baseUrl: DEEPSEEK_BASE_URL,
                model: DEEPSEEK_TEST_MODEL
            };
        }

        const client = new OpenAI({
            apiKey: key,
            baseURL: DEEPSEEK_BASE_URL,
            timeout: 30000,
            httpAgent: getOpenAIHttpAgent()
        });

        try {
            const response = await client.chat.completions.create({
                model: DEEPSEEK_TEST_MODEL,
                messages: [
                    {
                        role: 'user',
                        content: '连接测试：请只回复 OK。'
                    }
                ],
                max_tokens: 64,
                temperature: 0,
                // 连通性测试只验证 API Key、模型权限和文本输出，不测试思考模式。
                // DeepSeek 默认开启 thinking，低 token 预算下可能只返回 reasoning_content，导致误判。
                thinking: { type: 'disabled' }
            } as any);

            const message = response.choices?.[0]?.message as any;
            const content = message?.content?.trim() || '';
            const reasoningContent = message?.reasoning_content?.trim() || '';
            if (!content) {
                if (reasoningContent) {
                    return {
                        success: true,
                        message: `DeepSeek 官方 API 连接成功，模型 ${DEEPSEEK_TEST_MODEL} 返回了 reasoning_content，但未返回最终文本。通常是思考模式或输出 token 预算导致；当前测试已按非思考模式重试逻辑收口。`,
                        baseUrl: DEEPSEEK_BASE_URL,
                        model: DEEPSEEK_TEST_MODEL,
                        usage: {
                            inputTokens: response.usage?.prompt_tokens || 0,
                            outputTokens: response.usage?.completion_tokens || 0
                        }
                    };
                }
                return {
                    success: false,
                    error: `DeepSeek 已响应，但模型 ${DEEPSEEK_TEST_MODEL} 没有返回最终文本。请稍后重试，或检查该模型在当前账号下是否可用。`,
                    baseUrl: DEEPSEEK_BASE_URL,
                    model: DEEPSEEK_TEST_MODEL,
                    usage: {
                        inputTokens: response.usage?.prompt_tokens || 0,
                        outputTokens: response.usage?.completion_tokens || 0
                    }
                };
            }

            return {
                success: true,
                message: `DeepSeek 官方 API 连接成功，模型 ${DEEPSEEK_TEST_MODEL} 已返回文本。`,
                baseUrl: DEEPSEEK_BASE_URL,
                model: DEEPSEEK_TEST_MODEL,
                usage: {
                    inputTokens: response.usage?.prompt_tokens || 0,
                    outputTokens: response.usage?.completion_tokens || 0
                }
            };
        } catch (error: any) {
            return {
                success: false,
                error: this.formatDeepSeekTestError(error),
                status: error?.status || error?.statusCode,
                baseUrl: DEEPSEEK_BASE_URL,
                model: DEEPSEEK_TEST_MODEL
            };
        }
    }

    async testOllamaCloud(apiKey?: string, modelId?: string): Promise<OllamaCloudTestResult> {
        const key = (apiKey ?? this.config.ollamaApiKey ?? '').trim();
        const requestedModelId = String(modelId || '').trim();
        const configuredModel = requestedModelId ? getModelById(requestedModelId) : undefined;
        let apiModelId = '';
        if (configuredModel?.provider === 'ollama-cloud') {
            apiModelId = String(configuredModel.apiModelId || '').trim();
        } else if (requestedModelId.startsWith('ollama-cloud-')) {
            apiModelId = requestedModelId.replace(/^ollama-cloud-/, '');
        }

        if (!key) {
            return {
                success: false,
                kind: 'auth',
                error: '请先输入 Ollama Cloud API Key。',
                keyAuthenticated: false,
                ...(apiModelId ? { model: apiModelId } : {})
            };
        }

        if (!apiModelId) {
            return {
                success: false,
                kind: 'unknown',
                error: '请先在主模型或视觉模型中选择一个 Ollama Cloud 模型。只有对具体模型发起真实请求，才能验证 API Key 和模型访问权。'
            };
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), OLLAMA_CLOUD_TEST_TIMEOUT_MS);
        try {
            const modelResponse = await fetch(`${OLLAMA_CLOUD_BASE_URL}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${key}`
                },
                body: JSON.stringify({
                    model: apiModelId,
                    messages: [{ role: 'user', content: '连接测试：请只回复 OK。' }],
                    stream: false,
                    options: { num_predict: 8, temperature: 0 }
                }),
                signal: controller.signal
            });
            if (!modelResponse.ok) {
                const errorText = await modelResponse.text();
                return this.buildOllamaCloudTestFailure(
                    createModelProviderHttpError('Ollama Cloud', modelResponse.status, errorText),
                    apiModelId,
                    undefined
                );
            }

            const payload = await modelResponse.json() as Record<string, any>;
            const text = String(payload?.message?.content || payload?.response || '').trim();
            if (!text) {
                return this.buildOllamaCloudTestFailure(
                    new Error('Ollama Cloud invalid response: model test returned no text'),
                    apiModelId,
                    true
                );
            }
            return {
                success: true,
                kind: 'ok',
                message: `Ollama Cloud API Key 与模型「${apiModelId}」访问资格均已通过真实调用验证。`,
                model: apiModelId,
                keyAuthenticated: true,
                modelAccess: true
            };
        } catch (error) {
            const normalizedError = error instanceof Error && error.name === 'AbortError'
                ? new Error('Ollama Cloud request timeout')
                : error;
            return this.buildOllamaCloudTestFailure(
                normalizedError,
                apiModelId,
                undefined
            );
        } finally {
            clearTimeout(timeoutId);
        }
    }

    private buildOllamaCloudTestFailure(
        error: unknown,
        apiModelId: string,
        keyAuthenticated: boolean | undefined
    ): OllamaCloudTestResult {
        const failure: ModelProviderFailure = classifyModelProviderFailure(error);
        const modelLabel = apiModelId || '当前模型';
        let message: string;
        switch (failure.kind) {
            case 'auth':
                message = 'Ollama Cloud 没有接受当前 API Key。请检查 Key 是否填写完整、已撤销或已过期。';
                break;
            case 'model_access':
                message = `API Key 已被 Ollama Cloud 接受，但账号没有模型「${modelLabel}」的访问资格，或该模型当前不可用。请升级对应订阅，或切换到账号可用的模型。`;
                break;
            case 'billing':
                message = `API Key 已被 Ollama Cloud 接受，但账号余额、额度或配额不足，暂时不能调用模型「${modelLabel}」。`;
                break;
            case 'rate_limit':
                message = `Ollama Cloud 当前限流，模型「${modelLabel}」的访问资格尚未被否定。请稍后重试。`;
                break;
            case 'timeout':
                message = 'Ollama Cloud 连接测试超时。Key 与模型权限均未得到确定结论，请稍后重试。';
                break;
            case 'network':
                message = '无法连接 Ollama Cloud。Key 与模型权限均未得到确定结论，请检查网络或代理。';
                break;
            case 'service_unavailable':
                message = 'Ollama Cloud 服务暂时不可用。Key 与模型权限均未得到确定结论，请稍后重试。';
                break;
            case 'protocol':
                message = 'Ollama Cloud 已响应，但返回内容无法解析。请稍后重试或切换模型。';
                break;
            default:
                message = `Ollama Cloud 测试失败：${failure.diagnostic || '未知 Provider 错误'}`;
        }
        let effectiveKeyAuthenticated = keyAuthenticated;
        if (failure.kind === 'auth') {
            effectiveKeyAuthenticated = false;
        } else if (failure.kind === 'model_access' || failure.kind === 'billing') {
            effectiveKeyAuthenticated = true;
        }
        return {
            success: false,
            kind: failure.kind,
            error: message,
            ...(failure.status ? { status: failure.status } : {}),
            ...(apiModelId ? { model: apiModelId } : {}),
            ...(effectiveKeyAuthenticated !== undefined
                ? { keyAuthenticated: effectiveKeyAuthenticated }
                : {}),
            ...(failure.kind === 'model_access' ? { modelAccess: false } : {}),
            diagnostic: failure.diagnostic
        };
    }

    private formatDeepSeekTestError(error: any): string {
        const status = error?.status || error?.statusCode || error?.response?.status;
        const message = String(error?.message || error || '');

        if (status === 401) {
            return 'DeepSeek API Key 无效或已过期。请在 DeepSeek 平台检查官方 API Key。';
        }

        if (status === 403) {
            return 'DeepSeek 已理解请求但拒绝当前模型访问。API Key 不一定有问题，请检查账号的模型权限、额度或地区限制。';
        }

        if (status === 404) {
            return `DeepSeek 官方接口已响应，但模型 ${DEEPSEEK_TEST_MODEL} 不存在或当前账号不可用。`;
        }

        if (status === 429) {
            return 'DeepSeek 官方 API 返回频率限制或余额限制。请稍后重试或检查平台额度。';
        }

        if (status && status >= 500) {
            return `DeepSeek 官方服务暂时不可用 (${status})。请稍后重试。`;
        }

        if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|fetch failed|connection|connect|timeout/i.test(message)) {
            return `无法连接 DeepSeek 官方 API：${DEEPSEEK_BASE_URL}。请检查网络或代理设置。`;
        }

        if (/invalid api key|unauthorized|forbidden/i.test(message)) {
            return 'DeepSeek API Key 验证失败。请确认填入的是官方平台创建的 API Key。';
        }

        return `DeepSeek 测试失败：${message.slice(0, 240)}`;
    }

    formatXiaomiError(error: any, modelName: string): string {
        const status = error?.status || error?.statusCode || error?.response?.status;
        const rawMessage = String(
            error?.response?.data?.error?.message ||
            error?.error?.message ||
            error?.message ||
            error ||
            ''
        );
        const message = rawMessage.trim();
        const modelLabel = modelName || 'mimo-v2.5';

        if (status === 400) {
            if (/reasoning_content/i.test(message)) {
                return [
                    `小米 MiMo 请求上下文不完整：${modelLabel} 要求工具调用历史完整回传 reasoning_content。`,
                    '当前 Agent 的 Xiaomi 工具模式会主动关闭思考模式；如果仍出现该错误，通常说明历史消息或上游适配层漏回传了 reasoning_content。',
                    '请重新发起本轮任务，或切换到非思考模式/其它已验证模型后继续。'
                ].join('\n');
            }
            return [
                `小米 MiMo 请求格式错误：${modelLabel} 没有接受当前请求。`,
                '请检查消息格式、模型名称、参数范围、多模态图片格式，以及是否混入了不完整的工具调用历史。',
                message ? `接口返回：${message.slice(0, 240)}` : ''
            ].filter(Boolean).join('\n');
        }

        if (status === 401) {
            return '小米 MiMo API Key 无效或请求头格式不正确。请检查设置中的 Xiaomi API Key。';
        }

        if (status === 402) {
            return '小米 MiMo 账户余额不足。请检查账户余额或 Token Plan 套餐额度。';
        }

        if (status === 403) {
            return '小米 MiMo 当前拒绝访问，可能是地区限制、API Key 风控或内容安全策略触发。请检查 API Key 状态和输入内容。';
        }

        if (status === 404) {
            return `小米 MiMo 模型或接口不可用：${modelLabel}。请确认已切换到 V2.5 系列，并且当前模型支持所需能力。`;
        }

        if (status === 421) {
            return '小米 MiMo 内容安全审核拦截了本次请求。请调整输入内容后重试。';
        }

        if (status === 429) {
            return '小米 MiMo 请求过于频繁或额度已耗尽。请稍后重试；高并发任务应降低请求频率并使用指数退避。';
        }

        if (status === 500 || status === 503) {
            return `小米 MiMo 服务暂时不可用 (${status})。请稍后重试；如果连续出现，可临时切换到备用模型。`;
        }

        if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|fetch failed|connection|connect|timeout/i.test(message)) {
            return '无法连接小米 MiMo API。请检查网络、代理设置，以及 https://api.xiaomimimo.com/v1 是否可访问。';
        }

        if (/invalid api key|unauthorized|forbidden/i.test(message)) {
            return '小米 MiMo API Key 验证失败。请确认使用的是小米开放平台创建的 API Key，且没有混用 Token Plan Key。';
        }

        return `小米 MiMo 调用失败：${message.slice(0, 240) || '未知错误'}`;
    }

    private toTextOnlyMessages(messages: ModelMessage[]): ModelMessage[] {
        return messages.map((msg) => {
            if (typeof msg.content === 'string') {
                return msg;
            }

            const text = msg.content
                .filter((part) => part.type === 'text' && part.text)
                .map((part) => part.text)
                .join('\n');

            return {
                ...msg,
                content: text
            };
        });
    }

    /**
     * 组装本次请求的思考参数。
     *
     * 两个正交的旋钮，别混在一起：
     * - thinkingEnabled：开/关。只有 deepseek / xiaomi 认 `thinking:{type:'disabled'}` 这种显式关闭，
     *   其余 provider 关闭就是不下发思考参数。
     * - reasoningEffort：**强度档位**。仅当模型目录明确声明 reasoningEfforts 时才下发；
     *   provider 没声明就下发，等于赌上游能认这个参数，赌输了是 400 或被静默忽略——
     *   后者更糟，用户以为调高了强度，实际什么都没变。
     *
     * 此前这里完全没消费 reasoningEffort，只有 Codex 订阅通道在用它，
     * 于是 OpenAI 兼容通道（OpenRouter / Smile AI / DeepSeek…）的档位设置全部落空。
     *
     * 实测依据（2026-08-28，OpenRouter x-ai/grok-4.3，需真实推理的排版题，每档 2 次中位）：
     *   none → 思考 0 tok / 1.9s；low 1626 / 21.2s；medium 3496 / 34.5s；high 5594 / 46.2s。
     * 档位真实单调生效；不下发时是 1450 tok，**与任何一档都不等价**，所以"用户没选"必须
     * 表现为不下发，而不是替他填一个 medium。
     */
    private resolveThinkingRequestParams(model: ModelConfig, options?: ModelChatOptions): Record<string, any> {
        if (options?.thinkingEnabled === false) {
            if (model.provider === 'deepseek' || model.provider === 'xiaomi') {
                return { thinking: { type: 'disabled' } };
            }
            return {};
        }

        const baseParams = getThinkingRequestParams(model.thinking);
        const requestedEffort = String(options?.reasoningEffort || '').trim();
        if (!requestedEffort) return baseParams;

        // 只认模型目录声明过的档位：清单来自 provider 的 supported_parameters，
        // 不在清单里就当用户没选，保持原有请求语义。
        const declared = Array.isArray(model.reasoningEfforts) ? model.reasoningEfforts : [];
        if (!declared.includes(requestedEffort)) return baseParams;

        return { ...baseParams, reasoning_effort: requestedEffort };
    }

    private extractThinkingForResponse(
        rawResponse: any,
        model: ModelConfig,
        _options?: ModelChatOptions
    ): { thinking: string; content: string } {
        // 「请求端关闭思考」和「响应里还有没有思考标记」是两件事：
        // 请求关闭只对 deepseek/xiaomi 是真参数，其它模型（如本地 qwen 的 <think>）
        // 仍可能照样输出思考段。此前一旦 thinkingEnabled=false 就按 'none' 解析，
        // 会把 <think>…</think> 原样留在正文里，直接污染候选文案。
        // 按模型声明的格式解析永远是安全的：模型真的没思考时，提取就是空操作。
        return extractThinkingFromModel(rawResponse, model.thinking);
    }

    private async chatOpenAICompatible(
        client: OpenAI | null,
        providerName: string,
        model: ModelConfig,
        messages: ModelMessage[],
        options?: ModelChatOptions
    ): Promise<ModelResponse> {
        if (!client) {
            throw new Error(`${providerName} API key not configured`);
        }

        const openaiMessages = messages.map(msg => ({
            role: msg.role as 'user' | 'assistant',
            content: this.convertToOpenAIContent(msg.content)
        }));

        const thinkingParams = this.resolveThinkingRequestParams(model, options);
        const isXiaomiMimo = providerName === 'Xiaomi MiMo';
        const resolvedMaxTokens = resolveChatMaxTokens(options);

        let response: any;
        try {
            const tokenBudgetParams = isXiaomiMimo
                ? { max_completion_tokens: resolvedMaxTokens }
                : { max_tokens: resolvedMaxTokens };
            response = await client.chat.completions.create(
                {
                    model: model.apiModelId || model.id,
                    messages: openaiMessages,
                    ...tokenBudgetParams,
                    temperature: options?.temperature ?? (isXiaomiMimo ? XIAOMI_MIMO_DEFAULT_TEMPERATURE : undefined),
                    ...(isXiaomiMimo
                        ? { top_p: XIAOMI_MIMO_DEFAULT_TOP_P, ...thinkingParams }
                        : thinkingParams)
                } as any,
                { timeout: resolveOpenAICompatibleTimeoutMs(options) } as any
            );
        } catch (error: any) {
            if (isXiaomiMimo) {
                // Param Incorrect 只说"参数不对"、不说哪个参数。附上本次请求的**形状**
                // （角色序列、各消息内容类型、参数值；不含图片字节与正文）让下次出现即可定位。
                const shape = openaiMessages.map((m: any, i: number) => {
                    const c: any = m.content;
                    const kinds = typeof c === 'string'
                        ? (c.length > 0 ? 'text' : 'EMPTY_STRING')
                        : (Array.isArray(c)
                            ? (c.length > 0 ? c.map((p: any) => p?.type).join('+') : 'EMPTY_ARRAY')
                            : typeof c);
                    return `#${i} ${m.role}:${kinds}`;
                }).join(' | ');
                const params = `max_completion_tokens=${resolvedMaxTokens}, temperature=${options?.temperature ?? XIAOMI_MIMO_DEFAULT_TEMPERATURE}, top_p=${XIAOMI_MIMO_DEFAULT_TOP_P}, thinkingParams=${JSON.stringify(thinkingParams)}`;
                throw new Error([
                    this.formatXiaomiError(error, model.apiModelId || model.id),
                    `本次请求形状：${shape}`,
                    `本次参数：${params}`
                ].join('\n'));
            }
            throw error;
        }

        assertPlainModelOutputComplete({
            providerName,
            finishReason: response?.choices?.[0]?.finish_reason
        });
        // 使用统一的 ThinkingExtractor 提取思维过程
        const { thinking, content } = this.extractThinkingForResponse(response, model, options);

        if (!String(content || '').trim()) {
            throw createModelEmptyContentError({
                providerName,
                modelLabel: model.apiModelId || model.id,
                finishReason: String(response?.choices?.[0]?.finish_reason || ''),
                maxTokens: resolvedMaxTokens,
                thinkingLength: String(thinking || '').length,
                outputTokens: response.usage?.completion_tokens || 0
            });
        }

        return {
            text: content,
            thinking: thinking || undefined,
            usage: {
                inputTokens: response.usage?.prompt_tokens || 0,
                outputTokens: response.usage?.completion_tokens || 0
            }
        };
    }

    /**
     * Ollama API (本地模型) - 使用原生 http 模块
     * 
     * 使用统一的 ThinkingExtractor 处理思维过程
     */
    private async chatOllama(
        model: ModelConfig,
        messages: ModelMessage[],
        options?: { maxTokens?: number; temperature?: number }
    ): Promise<ModelResponse> {
        const ollamaModel = (model as any).apiModelId || model.id.replace('ollama-', '');
        console.log(`[ModelService] Calling Ollama model: ${ollamaModel}`);

        const ollamaMessages = messages.map(msg => {
            const baseMessage: any = {
                role: msg.role,
                content: typeof msg.content === 'string' 
                    ? msg.content 
                    : msg.content
                        .filter(c => c.type === 'text')
                        .map(c => c.text)
                        .join('\n')
            };

            if (model.supportsVision && typeof msg.content !== 'string') {
                const images = msg.content
                    .filter(c => c.type === 'image' && c.image)
                    .map(c => c.image!.data);
                if (images.length > 0) {
                    baseMessage.images = images;
                }
            }

            return baseMessage;
        });

        // 获取思维过程请求参数
        const thinkingParams = this.resolveThinkingRequestParams(model, options);

        const requestBody = JSON.stringify({
            model: ollamaModel,
            messages: ollamaMessages,
            stream: false,
            options: {
                num_predict: resolveChatMaxTokens(options),
                temperature: options?.temperature ?? 0.7,
                ...thinkingParams
            }
        });

        return new Promise((resolve, reject) => {
            const req = http.request({
                hostname: '127.0.0.1',
                port: 11434,
                path: '/api/chat',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(requestBody)
                },
                timeout: 180000  // 3 分钟，大模型（如 32B）冷启动需 1–2 分钟
            }, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    try {
                        if (res.statusCode !== 200) {
                            reject(new Error(`Ollama error (${res.statusCode}): ${data}`));
                            return;
                        }

                        const parsed = JSON.parse(data);
                        assertPlainModelOutputComplete({
                            providerName: 'Ollama',
                            finishReason: parsed.done_reason,
                            transportComplete: parsed.done === true
                        });
                        
                        // 使用统一的 ThinkingExtractor 提取思维过程
                        const { thinking, content } = this.extractThinkingForResponse(parsed, model, options);
                        
                        resolve({
                            text: content,
                            thinking: thinking || undefined,
                            usage: {
                                inputTokens: parsed.prompt_eval_count || 0,
                                outputTokens: parsed.eval_count || 0
                            }
                        });
                    } catch (e) {
                        if (isModelOutputIncompleteError(e)) {
                            reject(e);
                            return;
                        }
                        reject(new Error(`Failed to parse Ollama response: ${e}`));
                    }
                });
            });

            req.on('error', (error) => {
                console.error('[ModelService] Ollama connection error:', error.message);
                const hint = error.message?.includes('ECONNREFUSED') 
                    ? 'Ollama 可能未启动，请运行 ollama serve'
                    : '请检查 Ollama 是否正常运行';
                reject(new Error(`🖥️ 无法连接到本地 Ollama 服务\n\n${hint}\n• 或在设置中切换到云端模式`));
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`⏱️ Ollama 响应超时 (3 分钟)\n\n可能原因:\n• 大模型（如 32B）首次加载需 1–2 分钟，请稍后重试\n• 可先运行 ollama run qwen2.5:32b 预热模型\n• 或切换到更小的模型（如 qwen2.5:7b）`));
            });

            req.write(requestBody);
            req.end();
        });
    }

    /**
     * Ollama Cloud API (云端 Ollama 服务)
     * 需要 ollamaApiKey 认证
     * 
     * 使用统一的 ThinkingExtractor 处理思维过程
     * 支持 Qwen3 的 enable_thinking 参数
     */
    private async chatOllamaCloud(
        model: ModelConfig,
        messages: ModelMessage[],
        options?: { maxTokens?: number; temperature?: number }
    ): Promise<ModelResponse> {
        if (!this.config.ollamaApiKey) {
            throw new Error('Ollama Cloud API key not configured. 请在设置中配置 Ollama 云服务 API 密钥。');
        }

        const ollamaModel = (model as any).apiModelId || model.id.replace('ollama-cloud-', '');
        console.log(`[ModelService] Calling Ollama Cloud model: ${ollamaModel}`);

        const ollamaMessages = messages.map(msg => {
            const baseMessage: any = {
                role: msg.role,
                content: typeof msg.content === 'string' 
                    ? msg.content 
                    : msg.content
                        .filter(c => c.type === 'text')
                        .map(c => c.text)
                        .join('\n')
            };

            if (model.supportsVision && typeof msg.content !== 'string') {
                const images = msg.content
                    .filter(c => c.type === 'image' && c.image)
                    .map(c => c.image!.data);
                if (images.length > 0) {
                    baseMessage.images = images;
                }
            }

            return baseMessage;
        });

        // 获取思维过程请求参数（如 Qwen3 的 enable_thinking）
        const thinkingParams = this.resolveThinkingRequestParams(model, options);
        
        const response = await fetch('https://ollama.com/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.config.ollamaApiKey}`
            },
            body: JSON.stringify({
                model: ollamaModel,
                messages: ollamaMessages,
                stream: false,
                options: {
                    num_predict: resolveChatMaxTokens(options),
                    temperature: options?.temperature ?? 0.7,
                    ...thinkingParams  // 添加思维过程参数
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw createModelProviderHttpError('Ollama Cloud', response.status, errorText);
        }

        const data = await response.json();
        assertPlainModelOutputComplete({
            providerName: 'Ollama Cloud',
            finishReason: data.done_reason,
            transportComplete: data.done === true
        });
        
        // 使用统一的 ThinkingExtractor 提取思维过程
        const { thinking, content } = this.extractThinkingForResponse(data, model, options);
        
        return {
            text: content,
            thinking: thinking || undefined,
            usage: {
                inputTokens: data.prompt_eval_count || 0,
                outputTokens: data.eval_count || 0
            }
        };
    }

    /**
     * OpenRouter API (中转模型) - 支持中国地区访问
     * API 格式与 OpenAI 兼容
     * 
     * 使用统一的 ThinkingExtractor 处理思维过程
     */
    private async chatOpenRouter(
        model: ModelConfig,
        messages: ModelMessage[],
        options?: { maxTokens?: number; temperature?: number }
    ): Promise<ModelResponse> {
        if (!this.config.openrouterApiKey) {
            throw new Error('OpenRouter API key not configured. 请在设置中配置 OpenRouter API 密钥。');
        }

        const openrouterModel = (model as any).apiModelId || model.id.replace('openrouter-', '');
        console.log(`[ModelService] Calling OpenRouter model: ${openrouterModel}`);

        const openrouterMessages = messages.map(msg => ({
            role: msg.role as 'user' | 'assistant',
            content: this.convertToOpenAIContent(msg.content)
        }));
        const thinkingParams = this.resolveThinkingRequestParams(model, options);

        const requestBody = JSON.stringify({
            model: openrouterModel,
            messages: openrouterMessages,
            max_tokens: resolveChatMaxTokens(options),
            temperature: options?.temperature ?? 0.7,
            ...thinkingParams
        });

        return new Promise((resolve, reject) => {
            const https = require('https');

            const req = https.request({
                hostname: 'openrouter.ai',
                port: 443,
                path: '/api/v1/chat/completions',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.openrouterApiKey}`,
                    'HTTP-Referer': 'https://designecho.app',
                    'X-Title': 'DesignEcho Agent',
                    'Content-Length': Buffer.byteLength(requestBody)
                },
                timeout: 60000
            }, (res: any) => {
                let data = '';
                res.on('data', (chunk: any) => { data += chunk; });
                res.on('end', () => {
                    try {
                        if (res.statusCode !== 200) {
                            let errorData: any = {};
                            try { errorData = JSON.parse(data); } catch {}
                            reject(new Error(this.formatOpenRouterError(res.statusCode, errorData, openrouterModel)));
                            return;
                        }

                        const parsed = JSON.parse(data);
                        assertPlainModelOutputComplete({
                            providerName: 'OpenRouter',
                            finishReason: parsed.choices?.[0]?.finish_reason
                        });
                        
                        // 使用统一的 ThinkingExtractor 提取思维过程
                        const { thinking, content } = this.extractThinkingForResponse(parsed, model, options);
                        
                        resolve({
                            text: content,
                            thinking: thinking || undefined,
                            usage: {
                                inputTokens: parsed.usage?.prompt_tokens || 0,
                                outputTokens: parsed.usage?.completion_tokens || 0
                            }
                        });
                    } catch (e) {
                        if (isModelOutputIncompleteError(e)) {
                            reject(e);
                            return;
                        }
                        reject(new Error(`❌ OpenRouter 响应解析失败\n\n请稍后重试`));
                    }
                });
            });

            req.on('error', (error: any) => {
                console.error('[ModelService] OpenRouter connection error:', error.message);
                reject(new Error(`🌐 无法连接到 OpenRouter\n\n请检查:\n• 网络连接是否正常\n• 是否需要代理`));
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`⏱️ OpenRouter 请求超时\n\n请稍后重试，或切换到响应更快的模型`));
            });

            req.write(requestBody);
            req.end();
        });
    }

    // ===== 格式转换辅助方法 =====

    private convertToAnthropicContent(content: string | MessageContent[]): any {
        if (typeof content === 'string') {
            return content;
        }
        return content.map(c => {
            if (c.type === 'text') {
                return { type: 'text', text: c.text };
            } else if (c.type === 'image' && c.image) {
                return {
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: c.image.mediaType,
                        data: c.image.data
                    }
                };
            }
            return null;
        }).filter(Boolean);
    }

    private convertToGeminiContent(messages: ModelMessage[]): any[] {
        const parts: any[] = [];
        for (const msg of messages) {
            if (typeof msg.content === 'string') {
                parts.push({ text: msg.content });
            } else {
                for (const c of msg.content) {
                    if (c.type === 'text' && c.text) {
                        parts.push({ text: c.text });
                    } else if (c.type === 'image' && c.image) {
                        parts.push({
                            inlineData: {
                                mimeType: c.image.mediaType,
                                data: c.image.data
                            }
                        });
                    }
                }
            }
        }
        return parts;
    }

    private convertToOpenAIContent(content: string | MessageContent[]): any {
        if (typeof content === 'string') {
            return content;
        }
        const parts = content.map(c => {
            if (c.type === 'text') {
                // 空字符串在部分 OpenAI 兼容服务端（小米 MiMo）会被判非法参数。
                const text = String(c.text ?? '');
                return text.length > 0 ? { type: 'text', text } : null;
            } else if (c.type === 'image' && c.image) {
                // mediaType 缺失会拼出 `data:undefined;base64,...` 这种非法 data URL → 服务端回
                // 400 Param Incorrect。工具路径的 adapter 早有 `|| 'image/jpeg'` 兜底，这里过去没有，
                // 两条路径口径不一致；base64 为空同样不能发出去。
                const data = String(c.image.data ?? '');
                if (!data) return null;
                const mediaType = c.image.mediaType || 'image/jpeg';
                return {
                    type: 'image_url',
                    image_url: { url: `data:${mediaType};base64,${data}` }
                };
            }
            return null;
        }).filter(Boolean);
        // 全部被过滤掉时返回空字符串而不是空数组：`content: []` 同样是非法请求体。
        return parts.length > 0 ? parts : '';
    }

    // ==================== Tool Use 支持 ====================

    /**
     * 带工具调用的聊天接口
     *
     * 跨所有 Provider 统一 tool use：
     * - Anthropic: 原生 tool_use content blocks
     * - OpenAI / OpenRouter: 原生 function calling
     * - Gemini: 原生 functionDeclarations
     * - Ollama: 原生（llama3.1+）或 prompt-based XML 兼容模式
     */
    async chatWithTools(
        modelId: string,
        messages: AdapterMessage[],
        tools: ToolSchema[],
        options?: ModelToolCallOptions,
        debugTransportMetadata?: unknown
    ): Promise<ProviderResponse> {
        console.log(`[ModelService] chatWithTools() modelId=${modelId}, tools=${tools.length}, messages=${messages.length}`);

        const configuredModel = getModelById(modelId);
        if (configuredModel) {
            // 只拒绝「有依据的否定」：provider 没声明能力时按未知放行，让真实调用去检验。
            // 详见 model-capability-verdict（真机 2026-08-01：未声明被当成不支持，模型选得到用不了）。
            const verdict = resolveToolUseVerdict({
                declared: configuredModel.supportsToolUse,
                provider: configuredModel.provider,
                modelLabel: configuredModel.name
            });
            if (capabilityBlocksExecution(verdict)) {
                throw new Error(describeCapabilityBlock(verdict, '执行链调用'));
            }
        }

        const debugProjectReferenceCandidate = prepareDebugProjectReferenceProviderCandidate(
            messages,
            'chat_with_tools',
            debugTransportMetadata
        );

        // Resolve provider
        const { provider, apiModelName } = this.resolveProvider(modelId);
        if (provider === 'openai-codex') {
            if (!this.codexSubscriptionService) {
                throw new Error('ChatGPT 订阅服务尚未初始化。');
            }
            const response = await this.codexSubscriptionService.chatWithTools(
                apiModelName,
                messages,
                tools,
                {
                    timeoutMs: options?.timeoutMs,
                    nativeTools: options?.nativeTools,
                    reasoningEffort: options?.reasoningEffort,
                    visualPresentationCandidateKeys:
                        readDebugProjectReferenceProviderCandidateKeys(
                            debugProjectReferenceCandidate
                        ) || options?.visualPresentationCandidateKeys
                }
            );
            requireDebugProjectReferenceProviderReceipt(debugProjectReferenceCandidate, {
                provider,
                modelId: apiModelName,
                visualPresentationReceipt: response.visualPresentationReceipt
            });
            return response;
        }
        if (provider === 'claude-subscription') {
            if (!this.claudeSubscriptionService) {
                throw new Error('Claude 订阅服务尚未初始化。');
            }
            const response = await this.claudeSubscriptionService.chatWithTools(
                apiModelName,
                messages,
                tools,
                { maxTokens: options?.maxTokens, temperature: options?.temperature }
            );
            requireDebugProjectReferenceProviderReceipt(debugProjectReferenceCandidate, {
                provider,
                modelId: apiModelName
            });
            return response;
        }
        const adapter = getProviderAdapter(provider, apiModelName);
        const thinkingRequestParams = configuredModel
            ? this.resolveThinkingRequestParams(configuredModel, options)
            : {};

        // Format request using adapter
        const formatted = adapter.formatMessages(messages, tools, {
            maxTokens: options?.maxTokens,
            temperature: options?.temperature,
            nativeTools: options?.nativeTools,
            thinkingEnabled: options?.thinkingEnabled,
            thinkingRequestParams
        });

        // Call the appropriate provider API
        let rawResponse: any;

        switch (provider) {
            case 'anthropic': {
                if (!this.anthropic) throw new Error('Anthropic API key not configured');
                rawResponse = await this.anthropic.messages.create({
                    model: apiModelName,
                    ...formatted
                });
                break;
            }
            case 'openai': {
                if (!this.openai) throw new Error('OpenAI API key not configured');
                rawResponse = await this.openai.chat.completions.create({
                    model: apiModelName,
                    ...formatted
                });
                break;
            }
            case 'xiaomi': {
                if (!this.xiaomi) throw new Error('Xiaomi MiMo API key not configured');
                try {
                    rawResponse = await this.xiaomi.chat.completions.create(
                        {
                            model: apiModelName,
                            ...formatted
                        },
                        options?.timeoutMs ? { timeout: options.timeoutMs } : undefined
                    );
                } catch (error: any) {
                    throw new Error(this.formatXiaomiError(error, apiModelName));
                }
                break;
            }
            case 'deepseek': {
                if (!this.deepseek) throw new Error('DeepSeek API key not configured');
                // thinking 请求参数已由 adapter.formatMessages 按 thinkingEnabled + thinkingRequestParams 写入 formatted。
                // 此处不再按 provider 名覆盖，避免把模型能力判断散落到调用点。
                rawResponse = await this.deepseek.chat.completions.create({
                    model: apiModelName,
                    ...formatted
                } as any);
                break;
            }
            case 'smile-ai': {
                if (!this.smileAi) throw new Error('Smile AI Studio API key not configured');
                rawResponse = await this.smileAi.chat.completions.create(
                    {
                        model: apiModelName,
                        ...formatted
                    } as any,
                    options?.timeoutMs ? { timeout: options.timeoutMs } : undefined
                );
                break;
            }
            case 'google': {
                if (!this.gemini) throw new Error('Google API key not configured');
                const genModel = this.gemini.getGenerativeModel({
                    model: apiModelName,
                    ...formatted.generationConfig ? { generationConfig: formatted.generationConfig } : {}
                });
                const genResult = await genModel.generateContent({
                    contents: formatted.contents,
                    tools: formatted.tools,
                    ...(formatted.toolConfig ? { toolConfig: formatted.toolConfig } : {}),
                    ...(formatted.systemInstruction ? { systemInstruction: formatted.systemInstruction } : {})
                });
                rawResponse = genResult.response;
                break;
            }
            case 'openrouter': {
                if (!this.config.openrouterApiKey) throw new Error('OpenRouter API key not configured');
                rawResponse = await this.callOpenRouterWithTools(apiModelName, formatted);
                break;
            }
            case 'ollama':
            case 'ollama-cloud': {
                rawResponse = await this.callOllamaWithTools(apiModelName, formatted, provider === 'ollama-cloud');
                break;
            }
            default:
                throw new Error(`chatWithTools: unsupported provider ${provider}`);
        }

        // Parse response using adapter
        const parsed = adapter.parseResponse(rawResponse);
        requireDebugProjectReferenceProviderReceipt(debugProjectReferenceCandidate, {
            provider,
            modelId: apiModelName,
            formattedRequest: formatted
        });
        console.log(`[ModelService] chatWithTools result: provider=${provider}, model=${apiModelName}, content=${(parsed.content || '').length}chars, toolCalls=${parsed.toolCalls?.length || 0}, stop=${parsed.stopReason}`);
        if (!parsed.toolCalls?.length && parsed.content) {
            console.log(`[ModelService] chatWithTools: model returned text only (no tool calls). First 200 chars: ${parsed.content.substring(0, 200)}`);
        }
        return parsed;
    }

    /**
     * 用小米 MiMo 原生 web_search 联网检索设计资料。
     *
     * 这是「找参考 / 查趋势」的主搜索通道——MiMo 会真正联网搜索并返回带来源(citations)的综合结论。
     * 与失败的 design-crawler 爬虫、冷启动慢的 Eagle 不同，这条路实测稳定出活。
     * 注意：联网搜索 + 生成通常需要 30-50 秒，调用方必须保证足够长的超时。
     */
    async searchDesignWebViaXiaomi(
        query: string,
        options?: {
            limit?: number;
            maxKeyword?: number;
            forceSearch?: boolean;
            userLocation?: string;
        }
    ): Promise<{
        available: boolean;
        content: string;
        citations: ProviderNativeToolCitation[];
        error?: string;
    }> {
        if (!this.xiaomi) {
            return {
                available: false,
                content: '',
                citations: [],
                error: '未配置小米 MiMo API Key，无法联网搜索设计资料。'
            };
        }
        const trimmed = String(query || '').trim();
        if (!trimmed) {
            return { available: false, content: '', citations: [], error: '搜索关键词为空。' };
        }
        const limit = Math.max(1, Math.min(10, Math.floor(options?.limit ?? 6)));
        const maxKeyword = Math.max(1, Math.min(5, Math.floor(options?.maxKeyword ?? 3)));
        const nativeToolPlan = buildProviderNativeToolPlan({
            provider: 'xiaomi',
            modelId: 'mimo-v2.5-pro',
            requestedTools: [{
                type: 'web_search',
                enabled: true,
                limit,
                maxKeyword,
                forceSearch: options?.forceSearch === true,
                userLocation: options?.userLocation
            }]
        });
        const prompt = `请联网搜索与「${trimmed}」相关的设计资料。`
            + `严格聚焦查询中的产品属性（季节、品类、材质、风格、受众）——只返回与这些属性一致的参考，`
            + `明确排除季节或品类不符的内容（例如查询是春夏薄款，就不要纳入秋冬加厚款的参考）。`
            + `重点给出可直接用于设计决策的内容：主流趋势方向、配色与版式要点、文案与卖点表达方式，`
            + `并为每条参考标注它与查询的契合点（季节/品类/风格是否一致）。`
            + `只总结可借鉴的风格方向与方法，不要照抄任何单一成品。`;
        try {
            const resp = await this.chatWithTools(
                'xiaomi-mimo-v2.5-pro',
                [{ role: 'user', content: prompt }],
                [],
                {
                    nativeTools: nativeToolPlan.nativeTools,
                    maxTokens: 4000,
                    // 联网搜索 + 生成约 45-55 秒，client 默认 45 秒超时不够，放宽到 60 秒——
                    // 覆盖正常产出区间，又不让挂起通道一次吃掉设计循环近三分之一的时间预算。
                    timeoutMs: 60_000
                }
            );
            return {
                available: true,
                content: resp.content || '',
                citations: Array.isArray(resp.citations) ? resp.citations : []
            };
        } catch (error: any) {
            return {
                available: false,
                content: '',
                citations: [],
                error: this.formatXiaomiError(error, 'mimo-v2.5-pro')
            };
        }
    }

    /**
     * 带工具调用的流式聊天接口。
     *
     * 只把 provider 真实返回的增量作为事件发出；不支持工具流的 provider 会降级为
     * chatWithTools 的一次性结果，并在 done.response.streamMode 中标记为 fallback。
     */
    chatWithToolsStream(
        modelId: string,
        messages: AdapterMessage[],
        tools: ToolSchema[],
        options?: ModelToolCallOptions,
        debugTransportMetadata?: unknown
    ): AgentToolStreamHandle {
        const emitter = new EventEmitter() as AgentToolStreamHandle;
        const abortController = new AbortController();
        let aborted = false;
        let terminalEmitted = false;

        const emitChunk = (chunk: AgentToolStreamChunk): void => {
            if (terminalEmitted) return;
            if (aborted && chunk.type !== 'error') return;
            if (chunk.type === 'done' || chunk.type === 'error') terminalEmitted = true;
            emitter.emit('chunk', chunk);
        };

        emitter.abort = () => {
            if (aborted || terminalEmitted) return;
            aborted = true;
            abortController.abort();
            const error = new Error('Agent 工具流式请求已取消') as Error & { code?: string };
            error.name = 'AbortError';
            error.code = 'stream_aborted';
            emitChunk(buildAgentToolStreamErrorChunk(error));
        };

        setImmediate(() => {
            this.runChatWithToolsStream(
                modelId,
                messages,
                tools,
                options,
                debugTransportMetadata,
                abortController.signal,
                emitChunk
            ).catch((error: any) => {
                if (!aborted) {
                    emitChunk(buildAgentToolStreamErrorChunk(error));
                }
            });
        });

        return emitter;
    }

    private async runChatWithToolsStream(
        modelId: string,
        messages: AdapterMessage[],
        tools: ToolSchema[],
        options: ModelToolCallOptions | undefined,
        debugTransportMetadata: unknown,
        signal: AbortSignal,
        emitChunk: (chunk: AgentToolStreamChunk) => void
    ): Promise<void> {
        const debugProjectReferenceCandidate = prepareDebugProjectReferenceProviderCandidate(
            messages,
            'chat_with_tools_stream',
            debugTransportMetadata
        );
        // 受控参考图评测优先保证“Provider 收据先于任何可执行 Tool call”。
        // 直流 Provider helper 会边收边发布 tool_call_ready / done，若随后发现图片在
        // adapter 序列化时丢失，Renderer 已经可能开始 Photoshop 写入。Debug 范围内
        // 因此统一退回同一 chatWithTools 完成链：先验证并提交 Main 收据，再发唯一 done。
        if (debugProjectReferenceCandidate) {
            const parsed = await awaitModelCallWithCancellation(
                () => this.chatWithTools(
                    modelId,
                    messages,
                    tools,
                    options,
                    debugTransportMetadata
                ),
                signal,
                options?.timeoutMs
            );
            if (signal.aborted) throw createModelStreamAbortError();
            emitChunk({
                type: 'done',
                response: this.toAgentToolStreamResponse(parsed, 'fallback')
            });
            return;
        }
        const configuredModel = getModelById(modelId);
        if (configuredModel) {
            // 只拒绝「有依据的否定」：provider 没声明能力时按未知放行，让真实调用去检验。
            // 详见 model-capability-verdict（真机 2026-08-01：未声明被当成不支持，模型选得到用不了）。
            const verdict = resolveToolUseVerdict({
                declared: configuredModel.supportsToolUse,
                provider: configuredModel.provider,
                modelLabel: configuredModel.name
            });
            if (capabilityBlocksExecution(verdict)) {
                throw new Error(describeCapabilityBlock(verdict, '执行链调用'));
            }
        }

        const { provider, apiModelName } = this.resolveProvider(modelId);
        if (provider === 'openai-codex') {
            if (!this.codexSubscriptionService) {
                throw new Error('ChatGPT 订阅服务尚未初始化。');
            }
            const parsed = await this.codexSubscriptionService.chatWithTools(
                apiModelName,
                messages,
                tools,
                {
                    timeoutMs: options?.timeoutMs,
                    nativeTools: options?.nativeTools,
                    reasoningEffort: options?.reasoningEffort,
                    visualPresentationCandidateKeys:
                        readDebugProjectReferenceProviderCandidateKeys(
                            debugProjectReferenceCandidate
                        ) || options?.visualPresentationCandidateKeys
                },
                signal
            );
            if (signal.aborted) throw createModelStreamAbortError();
            requireDebugProjectReferenceProviderReceipt(debugProjectReferenceCandidate, {
                provider,
                modelId: apiModelName,
                visualPresentationReceipt: parsed.visualPresentationReceipt
            });
            emitChunk({
                type: 'done',
                response: this.toAgentToolStreamResponse(parsed, 'fallback')
            });
            return;
        }
        const adapter = getProviderAdapter(provider, apiModelName);
        const thinkingRequestParams = configuredModel
            ? this.resolveThinkingRequestParams(configuredModel, options)
            : {};
        const formatted = adapter.formatMessages(messages, tools, {
            maxTokens: options?.maxTokens,
            temperature: options?.temperature,
            nativeTools: options?.nativeTools,
            thinkingEnabled: options?.thinkingEnabled,
            thinkingRequestParams
        });

        if (provider === 'openrouter') {
            await this.streamOpenRouterWithTools(
                apiModelName,
                formatted,
                options?.timeoutMs,
                signal,
                emitChunk
            );
            return;
        }

        const client = this.getOpenAICompatibleClient(provider);
        if (client) {
            await this.streamOpenAICompatibleWithTools(
                provider,
                client,
                apiModelName,
                formatted,
                options?.timeoutMs,
                signal,
                emitChunk
            );
            return;
        }

        const parsed = await awaitModelCallWithCancellation(
            () => this.chatWithTools(
                modelId,
                messages,
                tools,
                options,
                debugTransportMetadata
            ),
            signal,
            options?.timeoutMs
        );
        emitChunk({
            type: 'done',
            response: this.toAgentToolStreamResponse(parsed, 'fallback')
        });
    }

    private getOpenAICompatibleClient(provider: string): OpenAI | null {
        switch (provider) {
            case 'openai':
                return this.openai;
            case 'xiaomi':
                return this.xiaomi;
            case 'deepseek':
                return this.deepseek;
            case 'smile-ai':
                return this.smileAi;
            default:
                return null;
        }
    }

    private async streamOpenAICompatibleWithTools(
        provider: string,
        client: OpenAI,
        model: string,
        formatted: any,
        timeoutMs: number | undefined,
        signal: AbortSignal,
        emitChunk: (chunk: AgentToolStreamChunk) => void
    ): Promise<void> {
        const accumulatedToolCalls = new Map<number, AccumulatedToolCall>();
        let content = '';
        let thinking = '';
        let usage = { inputTokens: 0, outputTokens: 0 };
        const annotations: unknown[] = [];
        let webSearchUsage: unknown;
        let providerFinishReason: string | undefined;
        let protocolInvalid = false;
        let providerRefusalSeen = false;

        let stream: any;
        try {
            stream = await client.chat.completions.create({
                model,
                ...formatted,
                stream: true
                // thinking 请求参数已由 adapter.formatMessages 写入 formatted；这里不按 provider 名覆盖。
            } as any, {
                signal,
                timeout: resolveOpenAICompatibleTimeoutMs({ timeoutMs })
            } as any);
        } catch (error: any) {
            if (provider === 'xiaomi') {
                throw new Error(this.formatXiaomiError(error, model));
            }
            throw error;
        }

        try {
            for await (const chunk of stream as any) {
                if (signal.aborted) return;
                const choice = chunk?.choices?.[0];
                if (choice?.finish_reason) {
                    const merged = mergeProviderFinishReason(
                        providerFinishReason,
                        choice.finish_reason
                    );
                    providerFinishReason = merged.finishReason;
                    protocolInvalid = protocolInvalid || merged.conflict;
                }
                const delta = choice?.delta;
                if (!delta) continue;
                if (String(delta.refusal || '').trim()) {
                    providerRefusalSeen = true;
                }

                if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
                    const norm = normalizeStreamTextChunk(thinking, delta.reasoning_content);
                    thinking = norm.fullText;
                    if (norm.deltaText) emitChunk({ type: 'thinking_delta', thinking: norm.deltaText });
                }

                if (typeof delta.content === 'string' && delta.content) {
                    content += delta.content;
                    emitChunk({ type: 'content_delta', content: delta.content });
                }

                if (Array.isArray(delta.annotations)) {
                    annotations.push(...delta.annotations);
                }

                this.consumeToolCallDeltas(delta.tool_calls, accumulatedToolCalls, emitChunk);

                if (chunk.usage) {
                    usage = {
                        inputTokens: chunk.usage.prompt_tokens || 0,
                        outputTokens: chunk.usage.completion_tokens || 0
                    };
                    if (chunk.usage.web_search_usage) {
                        webSearchUsage = chunk.usage.web_search_usage;
                    }
                }
            }
        } catch (error: any) {
            if (provider === 'xiaomi') {
                throw new Error(this.formatXiaomiError(error, model));
            }
            throw error;
        }

        const candidateToolCallResult = buildToolCallsFromDeltas(accumulatedToolCalls);
        const parsedStopReason = resolveProviderStreamStopReason({
            finishReason: providerRefusalSeen
                ? 'refusal'
                : (protocolInvalid ? undefined : providerFinishReason),
            hasToolCalls: candidateToolCallResult.toolCalls.length > 0
        });
        const stopReason = candidateToolCallResult.valid
            ? parsedStopReason
            : 'stream_incomplete';
        const toolCalls = canExecuteProviderStreamToolCalls(stopReason)
            ? candidateToolCallResult.toolCalls
            : [];
        const incompleteToolCallNames = collectIncompleteToolCallNames(
            accumulatedToolCalls,
            stopReason
        );
        const citations = provider === 'xiaomi'
            ? normalizeProviderNativeToolCitations(annotations, { provider: 'xiaomi' })
            : [];
        for (const toolCall of toolCalls) {
            emitChunk({ type: 'tool_call_ready', toolCall });
        }
        emitChunk({
            type: 'done',
            response: {
                content,
                thinking: thinking || undefined,
                toolCalls,
                ...(incompleteToolCallNames.length > 0 ? { incompleteToolCallNames } : {}),
                usage,
                citations,
                nativeToolUsage: provider === 'xiaomi' && webSearchUsage
                    ? [{ provider: 'xiaomi', toolType: 'web_search', rawUsage: webSearchUsage }]
                    : undefined,
                stopReason,
                streamMode: 'stream'
            }
        });
    }

    private streamOpenRouterWithTools(
        model: string,
        formatted: any,
        timeoutMs: number | undefined,
        signal: AbortSignal,
        emitChunk: (chunk: AgentToolStreamChunk) => void
    ): Promise<void> {
        if (!this.config.openrouterApiKey) {
            throw new Error('OpenRouter API key not configured');
        }

        return new Promise((resolve, reject) => {
            const https = require('https');
            const accumulatedToolCalls = new Map<number, AccumulatedToolCall>();
            let content = '';
            let thinking = '';
            const decoder = new ProviderSseDecoder();
            const utf8Decoder = new StringDecoder('utf8');
            let usage = { inputTokens: 0, outputTokens: 0 };
            let settled = false;
            let providerFinishReason: string | undefined;
            let protocolInvalid = false;
            let providerRefusalSeen = false;

            const fail = (error: Error): void => {
                if (settled || signal.aborted) return;
                settled = true;
                reject(error);
            };

            const finish = (): void => {
                if (settled || signal.aborted) return;
                settled = true;
                const candidateToolCallResult = buildToolCallsFromDeltas(accumulatedToolCalls);
                const parsedStopReason = resolveProviderStreamStopReason({
                    finishReason: providerRefusalSeen
                        ? 'refusal'
                        : (protocolInvalid ? undefined : providerFinishReason),
                    hasToolCalls: candidateToolCallResult.toolCalls.length > 0
                });
                const stopReason = candidateToolCallResult.valid
                    ? parsedStopReason
                    : 'stream_incomplete';
                const toolCalls = canExecuteProviderStreamToolCalls(stopReason)
                    ? candidateToolCallResult.toolCalls
                    : [];
                const incompleteToolCallNames = collectIncompleteToolCallNames(
                    accumulatedToolCalls,
                    stopReason
                );
                for (const toolCall of toolCalls) {
                    emitChunk({ type: 'tool_call_ready', toolCall });
                }
                emitChunk({
                    type: 'done',
                    response: {
                        content,
                        thinking: thinking || undefined,
                        toolCalls,
                        ...(incompleteToolCallNames.length > 0 ? { incompleteToolCallNames } : {}),
                        usage,
                        stopReason,
                        streamMode: 'stream'
                    }
                });
                resolve();
            };

            const requestBody = JSON.stringify({
                model,
                ...formatted,
                stream: true
            });

            const req = https.request({
                hostname: 'openrouter.ai',
                port: 443,
                path: '/api/v1/chat/completions',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.openrouterApiKey}`,
                    'HTTP-Referer': 'https://designecho.app',
                    'X-Title': 'DesignEcho Agent',
                    'Content-Length': Buffer.byteLength(requestBody)
                },
                timeout: resolveOpenAICompatibleTimeoutMs({ timeoutMs })
            }, (res: any) => {
                if (res.statusCode !== 200) {
                    let errorBody = '';
                    res.on('data', (chunk: Buffer) => { errorBody += chunk.toString(); });
                    res.on('end', () => fail(new Error(this.formatOpenRouterError(
                        res.statusCode,
                        safeParseToolArguments(errorBody),
                        model
                    ))));
                    return;
                }

                const consumeEvent = (eventData: string): void => {
                    if (settled || signal.aborted) return;
                    const data = eventData.trim();
                    if (!data) return;
                    if (data === '[DONE]') {
                        finish();
                        return;
                    }

                    try {
                            const parsed = JSON.parse(data);
                            if (parsed?.error) {
                                const providerError = parsed.error;
                                const status = Number(
                                    providerError.status
                                    || providerError.status_code
                                    || 0
                                );
                                const message = String(
                                    providerError.message
                                    || providerError.code
                                    || 'OpenRouter 流返回错误'
                                );
                                if (Number.isInteger(status) && status > 0) {
                                    fail(createModelProviderHttpError('OpenRouter', status, message));
                                } else {
                                    const error = new Error(message) as Error & { code?: string };
                                    error.code = String(providerError.code || 'openrouter_stream_error');
                                    fail(error);
                                }
                                return;
                            }
                            const choice = parsed.choices?.[0];
                            if (choice?.finish_reason) {
                                const merged = mergeProviderFinishReason(
                                    providerFinishReason,
                                    choice.finish_reason
                                );
                                providerFinishReason = merged.finishReason;
                                protocolInvalid = protocolInvalid || merged.conflict;
                            }
                            const delta = choice?.delta;
                            if (String(delta?.refusal || '').trim()) {
                                providerRefusalSeen = true;
                            }
                            if (typeof delta?.reasoning_content === 'string' && delta.reasoning_content) {
                                const norm = normalizeStreamTextChunk(thinking, delta.reasoning_content);
                                thinking = norm.fullText;
                                if (norm.deltaText) emitChunk({ type: 'thinking_delta', thinking: norm.deltaText });
                            }
                            if (typeof delta?.content === 'string' && delta.content) {
                                content += delta.content;
                                emitChunk({ type: 'content_delta', content: delta.content });
                            }
                            this.consumeToolCallDeltas(delta?.tool_calls, accumulatedToolCalls, emitChunk);
                            if (parsed.usage) {
                                usage = {
                                    inputTokens: parsed.usage.prompt_tokens || 0,
                                    outputTokens: parsed.usage.completion_tokens || 0
                                };
                            }
                    } catch {
                        protocolInvalid = true;
                    }
                };

                res.on('data', (chunk: Buffer) => {
                    if (signal.aborted) return;
                    try {
                        for (const eventData of decoder.push(utf8Decoder.write(chunk))) {
                            consumeEvent(eventData);
                        }
                    } catch (error: any) {
                        fail(error instanceof Error ? error : new Error('OpenRouter SSE 响应无效'));
                        res.destroy?.();
                    }
                });

                res.on('end', () => {
                    try {
                        const utf8Tail = utf8Decoder.end();
                        if (utf8Tail) {
                            for (const eventData of decoder.push(utf8Tail)) consumeEvent(eventData);
                        }
                        for (const eventData of decoder.finish()) {
                            consumeEvent(eventData);
                        }
                        finish();
                    } catch (error: any) {
                        fail(error instanceof Error ? error : new Error('OpenRouter SSE 响应无效'));
                        res.destroy?.();
                    }
                });
                res.on('error', fail);
            });

            req.on('error', (error: Error) => {
                fail(error);
            });
            req.on('timeout', () => {
                req.destroy();
                fail(new Error('OpenRouter timeout'));
            });
            signal.addEventListener('abort', () => req.destroy());
            req.write(requestBody);
            req.end();
        });
    }

    private consumeToolCallDeltas(
        deltas: any,
        accumulatedToolCalls: Map<number, AccumulatedToolCall>,
        emitChunk: (chunk: AgentToolStreamChunk) => void
    ): void {
        if (!Array.isArray(deltas)) return;

        for (const delta of deltas) {
            const index = typeof delta.index === 'number' ? delta.index : accumulatedToolCalls.size;
            const current = accumulatedToolCalls.get(index) || { argumentsText: '' };
            if (delta.id) current.id = delta.id;
            if (delta.function?.name) current.name = `${current.name || ''}${delta.function.name}`;
            if (delta.function?.arguments) current.argumentsText += delta.function.arguments;
            accumulatedToolCalls.set(index, current);

            emitChunk({
                type: 'tool_call_delta',
                index,
                toolCallId: current.id,
                name: current.name,
                argumentsDelta: delta.function?.arguments
            });
        }
    }

    private toAgentToolStreamResponse(
        response: ProviderResponse,
        streamMode: 'stream' | 'fallback'
    ): AgentToolStreamResponse {
        return {
            content: response.content,
            thinking: response.thinking,
            toolCalls: response.toolCalls,
            incompleteToolCallNames: response.incompleteToolCallNames,
            usage: response.usage,
            citations: response.citations,
            nativeToolUsage: response.nativeToolUsage,
            stopReason: response.stopReason,
            visualPresentationReceipt: response.visualPresentationReceipt,
            streamMode
        };
    }

    /**
     * 从 modelId 解析 provider 和 API 模型名
     */
    private resolveProvider(modelId: string): { provider: string; apiModelName: string } {
        const model = getModelById(modelId);
        if (model) {
            let apiModelName = (model as any).apiModelId || model.id;
            // Anthropic model name mapping
            if (model.provider === 'anthropic') {
                if (model.id === 'claude-3-5-sonnet') apiModelName = 'claude-3-5-sonnet-20241022';
                else if (model.id === 'claude-3-opus') apiModelName = 'claude-3-opus-20240229';
            }
            // Google: strip models/ prefix
            if (model.provider === 'google' && apiModelName.startsWith('models/')) {
                apiModelName = apiModelName.replace('models/', '');
            }
            return { provider: model.provider, apiModelName };
        }

        // Dynamic resolution
        if (modelId.startsWith('local-')) {
            return { provider: 'ollama', apiModelName: this.localIdToOllamaModel(modelId) };
        }
        if (modelId.startsWith('ollama-') && !modelId.startsWith('ollama-cloud-')) {
            return { provider: 'ollama', apiModelName: modelId.replace('ollama-', '') };
        }
        if (modelId.startsWith('ollama-cloud-')) {
            return { provider: 'ollama-cloud', apiModelName: modelId.replace('ollama-cloud-', '') };
        }
        if (modelId.startsWith('openrouter-')) {
            return { provider: 'openrouter', apiModelName: modelId.replace('openrouter-', '') };
        }
        if (modelId.startsWith('deepseek-')) {
            return { provider: 'deepseek', apiModelName: modelId };
        }
        if (modelId.startsWith('xiaomi-')) {
            return { provider: 'xiaomi', apiModelName: modelId.replace('xiaomi-', '') };
        }
        // 动态发现的网关模型：内部 id 是 slug 化的（点被抹成横线），无法反推真实
        // apiModelId。命中这里说明动态注册表没查到该模型，按 slug 直发网关，
        // 型号名不存在时由网关报错，不在此处猜测还原。
        if (modelId.startsWith('smile-ai-')) {
            return { provider: 'smile-ai', apiModelName: modelId.replace('smile-ai-', '') };
        }

        throw new Error(`Unknown model: ${modelId}`);
    }

    /**
     * OpenRouter HTTP 调用（带 tools）
     */
    private callOpenRouterWithTools(model: string, formatted: any): Promise<any> {
        return new Promise((resolve, reject) => {
            const requestBody = JSON.stringify({
                model,
                ...formatted
            });
            const https = require('https');
            const req = https.request({
                hostname: 'openrouter.ai',
                port: 443,
                path: '/api/v1/chat/completions',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.openrouterApiKey}`,
                    'HTTP-Referer': 'https://designecho.app',
                    'X-Title': 'DesignEcho Agent',
                    'Content-Length': Buffer.byteLength(requestBody)
                },
                timeout: 120000
            }, (res: any) => {
                let data = '';
                res.on('data', (chunk: any) => { data += chunk; });
                res.on('end', () => {
                    try {
                        if (res.statusCode !== 200) {
                            let errorData: any = {};
                            try { errorData = JSON.parse(data); } catch {}
                            reject(new Error(this.formatOpenRouterError(res.statusCode, errorData, model)));
                            return;
                        }
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error(`OpenRouter response parse error: ${e}`));
                    }
                });
            });
            req.on('error', (e: any) => reject(new Error(`OpenRouter connection error: ${e.message}`)));
            req.on('timeout', () => { req.destroy(); reject(new Error('OpenRouter timeout')); });
            req.write(requestBody);
            req.end();
        });
    }

    /**
     * Ollama HTTP 调用（带 tools）
     */
    private callOllamaWithTools(model: string, formatted: any, isCloud: boolean): Promise<any> {
        if (isCloud) {
            return this.callOllamaCloudWithTools(model, formatted);
        }
        return new Promise((resolve, reject) => {
            const requestBody = JSON.stringify({ model, ...formatted });
            const req = http.request({
                hostname: '127.0.0.1',
                port: 11434,
                path: '/api/chat',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(requestBody)
                },
                timeout: 180000
            }, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    try {
                        if (res.statusCode !== 200) {
                            reject(new Error(`Ollama error (${res.statusCode}): ${data}`));
                            return;
                        }
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error(`Ollama response parse error: ${e}`));
                    }
                });
            });
            req.on('error', () => reject(new Error('无法连接到本地 Ollama 服务')));
            req.on('timeout', () => { req.destroy(); reject(new Error('Ollama 响应超时')); });
            req.write(requestBody);
            req.end();
        });
    }

    private async callOllamaCloudWithTools(model: string, formatted: any): Promise<any> {
        if (!this.config.ollamaApiKey) throw new Error('Ollama Cloud API key not configured');
        const response = await fetch('https://ollama.com/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.config.ollamaApiKey}`
            },
            body: JSON.stringify({ model, ...formatted })
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw createModelProviderHttpError('Ollama Cloud', response.status, errorText);
        }
        return response.json();
    }

    // ==================== 流式输出支持 ====================
    
    /**
     * 流式聊天接口
     * 
     * 返回一个事件发射器，可以监听 'chunk' 事件获取流式数据
     * 
     * @example
     * const stream = modelService.chatStream(modelId, messages);
     * stream.on('chunk', (chunk) => {
     *     if (chunk.type === 'content') {
     *         console.log('内容:', chunk.content);
     *     } else if (chunk.type === 'thinking') {
     *         console.log('思考:', chunk.thinking);
     *     } else if (chunk.type === 'done') {
     *         console.log('完成:', chunk.fullResponse);
     *     }
     * });
     */
    chatStream(
        modelId: string,
        messages: ModelMessage[],
        options?: { maxTokens?: number; temperature?: number; thinkingEnabled?: boolean; timeoutMs?: number; signal?: AbortSignal }
    ): import('./stream-adapter').BaseStreamAdapter {
        const { createStreamAdapter } = require('./stream-adapter');
        
        // 从统一配置获取模型信息
        const model = getModelById(modelId);
        
        // 保留多模态 content，由各 provider 的 stream adapter 负责格式转换。
        const streamMessages = messages.map(msg => ({
            role: msg.role as 'user' | 'assistant' | 'system',
            content: msg.content
        }));
        
        // 确定提供商
        let provider = 'ollama';
        let modelToUse: any = modelId;
        
        if (model) {
            provider = model.provider;
            modelToUse = model;
        } else if (modelId.startsWith('local-') || modelId.startsWith('ollama-')) {
            provider = 'ollama';
            modelToUse = modelId.replace('local-', '').replace('ollama-', '');
        } else if (modelId.startsWith('openrouter-')) {
            provider = 'openrouter';
            modelToUse = modelId.replace('openrouter-', '');
        } else if (modelId.startsWith('xiaomi-')) {
            provider = 'xiaomi';
            modelToUse = modelId.replace('xiaomi-', '');
        } else if (modelId.startsWith('deepseek-')) {
            provider = 'deepseek';
            modelToUse = modelId;
        } else if (modelId.startsWith('smile-ai-')) {
            provider = 'smile-ai';
            modelToUse = modelId.replace('smile-ai-', '');
        }
        
        // 创建适配器
        const adapter = createStreamAdapter(provider, {
            ollamaUrl: this.ollamaBaseUrl,
            ollamaApiKey: this.config.ollamaApiKey,
            openrouterApiKey: this.config.openrouterApiKey,
            googleApiKey: this.config.googleApiKey,
            xiaomiApiKey: this.config.xiaomiApiKey,
            anthropicApiKey: this.config.anthropicApiKey,
            openaiApiKey: this.config.openaiApiKey,
            deepseekApiKey: this.config.deepseekApiKey,
            smileAiApiKey: this.config.smileAiApiKey
        });
        
        // 开始流式请求
        adapter.stream(modelToUse, streamMessages, options);
        
        return adapter;
    }
}
