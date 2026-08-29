/**
 * OpenAI / OpenRouter Provider Adapter
 *
 * 使用原生 function calling (tool_choice)
 * 兼容 OpenRouter 的 OpenAI 兼容 API
 */

import type {
    ProviderAdapter, ProviderResponse, ToolSchema,
    ToolCall, AdapterMessage, AdapterOptions
} from './types';
import { buildAgentProviderTokenBudget } from '../../../shared/agent-performance-policy';
import { normalizeProviderNativeToolCitations } from '../../../shared/provider-native-tools';
import {
    canExecuteProviderStreamToolCalls,
    resolveProviderStreamStopReason
} from '../../../shared/provider-stream-completion';
import { shouldReplayProviderReasoningContent } from '../../../shared/agent-model-transport-policy';
import type { ProviderReportedTokenUsage } from '../../../shared/provider-reported-token-usage';

function readNonNegativeTokenCount(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        ? value
        : undefined;
}

/**
 * OpenAI-compatible usage 的唯一投影。DeepSeek 缓存明细只有成对上报且与 inputTokens
 * 守恒时才进入 Runtime；缺失、部分或矛盾数据保持 unknown，不能补 0 或修正 Provider。
 */
export function readOpenAICompatibleTokenUsage(
    provider: string,
    rawUsage: unknown
): ProviderReportedTokenUsage {
    const usage = rawUsage && typeof rawUsage === 'object'
        ? rawUsage as Record<string, unknown>
        : {};
    const inputTokens = readNonNegativeTokenCount(usage.prompt_tokens) ?? 0;
    const outputTokens = readNonNegativeTokenCount(usage.completion_tokens) ?? 0;
    const cacheHitInputTokens = readNonNegativeTokenCount(usage.prompt_cache_hit_tokens);
    const cacheMissInputTokens = readNonNegativeTokenCount(usage.prompt_cache_miss_tokens);
    const hasCompleteDeepSeekCacheUsage = provider.trim().toLowerCase() === 'deepseek'
        && cacheHitInputTokens !== undefined
        && cacheMissInputTokens !== undefined
        && cacheHitInputTokens + cacheMissInputTokens === inputTokens;
    return {
        inputTokens,
        outputTokens,
        ...(hasCompleteDeepSeekCacheUsage ? { cacheHitInputTokens, cacheMissInputTokens } : {})
    };
}

export class OpenAIAdapter implements ProviderAdapter {
    constructor(private readonly provider = 'openai') {}

    supportsNativeTools(): boolean {
        return true;
    }

    formatMessages(
        messages: AdapterMessage[],
        tools: ToolSchema[],
        options?: AdapterOptions
    ): { messages: any[]; tools?: any[]; tool_choice?: string; max_tokens?: number; max_completion_tokens?: number; temperature?: number; top_p?: number; thinking?: Record<string, any> } & Record<string, any> {
        // Convert tools to OpenAI function calling format
        const openaiTools = tools.map(t => ({
            type: 'function' as const,
            function: {
                name: t.name,
                description: t.description,
                parameters: t.inputSchema
            }
        }));
        const nativeTools = Array.isArray(options?.nativeTools) ? options.nativeTools : [];
        const requestTools = [...openaiTools, ...nativeTools];

        // Convert messages
        const openaiMessages: any[] = [];

        for (const msg of messages) {
            if (msg.role === 'system') {
                openaiMessages.push({ role: 'system', content: msg.content || '' });
            } else if (msg.role === 'user') {
                if (msg.contentBlocks?.length) {
                    const content = msg.contentBlocks.map(b =>
                        b.type === 'image'
                            ? { type: 'image_url', image_url: { url: `data:${b.mediaType || 'image/jpeg'};base64,${b.data || ''}` } }
                            : { type: 'text', text: b.text || '' }
                    );
                    openaiMessages.push({ role: 'user', content });
                } else {
                    openaiMessages.push({ role: 'user', content: msg.content || '' });
                }
            } else if (msg.role === 'assistant') {
                const hasContent = typeof msg.content === 'string' && msg.content.length > 0;
                const hasToolCalls = Boolean(msg.toolCalls?.length);
                const hasReasoning = Boolean(msg.reasoningContent);
                // A role-only assistant message is invalid for strict OpenAI-compatible
                // providers. Reasoning-only and tool-call turns keep an explicit empty
                // content field so their native protocol payload remains well-formed.
                if (!hasContent && !hasToolCalls && !hasReasoning) continue;
                const assistantMsg: any = {
                    role: 'assistant',
                    content: hasContent ? msg.content : ''
                };
                if (msg.toolCalls?.length) {
                    assistantMsg.tool_calls = msg.toolCalls.map((call, idx) => ({
                        id: call.id || `call_${idx}_${Date.now()}`,
                        type: 'function',
                        function: {
                            name: call.name,
                            arguments: JSON.stringify(call.arguments)
                        }
                    }));
                }
                // 思考模式 + 工具调用：DeepSeek/小米要求后续轮次原样回传 reasoning_content，OpenRouter 用 reasoning。
                // 仅在本次开启思考且历史确有 reasoning 时回写（首轮无历史 reasoning 不写，避免塞空字段触发校验）；
                // openai 原生不吃这两个字段，不回写以免被拒。
                if (msg.reasoningContent && shouldReplayProviderReasoningContent({
                    provider: this.provider,
                    thinkingEnabled: options?.thinkingEnabled
                })) {
                    if (this.provider === 'deepseek' || this.provider === 'xiaomi') {
                        assistantMsg.reasoning_content = msg.reasoningContent;
                    } else if (this.provider === 'openrouter') {
                        assistantMsg.reasoning = msg.reasoningContent;
                    }
                }
                openaiMessages.push(assistantMsg);
            } else if (msg.role === 'tool_result') {
                for (const r of msg.toolResults || []) {
                    openaiMessages.push({
                        role: 'tool',
                        tool_call_id: r.callId || `call_missing_${Date.now()}`,
                        content: typeof r.output === 'string' ? r.output : JSON.stringify(r.output)
                    });
                }
            }
        }

        // Inject system prompt if not already present
        if (options?.systemPrompt && !openaiMessages.some(m => m.role === 'system')) {
            openaiMessages.unshift({ role: 'system', content: options.systemPrompt });
        }

        const maxCompletionTokens = buildAgentProviderTokenBudget({ requestedMaxTokens: options?.maxTokens }).maxTokens;
        const formatted: { messages: any[]; tools?: any[]; tool_choice?: string; max_tokens?: number; max_completion_tokens?: number; temperature?: number; top_p?: number; thinking?: Record<string, any> } & Record<string, any> = {
            messages: openaiMessages,
            ...(requestTools.length > 0 ? {
                tools: requestTools,
                tool_choice: 'auto' as const
            } : {}),
            max_tokens: maxCompletionTokens,
            ...(options?.thinkingEnabled === true ? (options.thinkingRequestParams || {}) : {}),
            ...(options?.temperature !== undefined ? { temperature: options.temperature } : {})
        };

        if (this.provider === 'xiaomi') {
            delete formatted.max_tokens;
            formatted.max_completion_tokens = maxCompletionTokens;
            formatted.temperature = formatted.temperature ?? 1.0;
            formatted.top_p = 0.95;
        }

        // xiaomi / deepseek：只有调用方明确关闭思考时才下发 disabled。
        // undefined 表示使用上层默认偏好；不要在 adapter 里按 provider 名把思考静默关掉。
        if ((this.provider === 'xiaomi' || this.provider === 'deepseek') && options?.thinkingEnabled === false) {
            formatted.thinking = { type: 'disabled' };
        }

        return formatted;
    }

    parseResponse(raw: any): ProviderResponse {
        const result: ProviderResponse = {};

        // Handle OpenAI chat completion format
        const choice = raw.choices?.[0];
        if (!choice) {
            const providerError = raw?.error;
            if (providerError) {
                const message = String(providerError.message || providerError.code || 'Provider 返回错误响应');
                const error = new Error(message) as Error & { code?: string; status?: number };
                error.code = String(providerError.code || 'provider_response_error');
                const status = Number(providerError.status || providerError.status_code || 0);
                if (Number.isInteger(status) && status > 0) error.status = status;
                throw error;
            }
            result.content = '';
            result.toolCalls = [];
            result.stopReason = 'stream_incomplete';
            return result;
        }

        const message = choice.message;
        const refusalSeen = Boolean(String(message?.refusal || '').trim());
        result.content = message?.content || '';
        const toolCallCandidates = message?.tool_calls?.length
            ? message.tool_calls.map((tc: any) => {
                const parsedArguments = parseToolArguments(tc.function?.arguments);
                const id = String(tc.id || '').trim();
                const name = String(tc.function?.name || '').trim();
                return {
                    valid: Boolean(id && name && parsedArguments.valid),
                    toolCall: { id, name, arguments: parsedArguments.value }
                };
            })
            : [];
        const candidateToolCalls = toolCallCandidates.map((candidate: any) => candidate.toolCall);
        const parsedStopReason = resolveProviderStreamStopReason({
            finishReason: refusalSeen ? 'refusal' : choice.finish_reason,
            hasToolCalls: candidateToolCalls.length > 0
        });
        let stopReason = parsedStopReason;
        if (refusalSeen) {
            stopReason = 'content_blocked';
        } else if (!toolCallCandidates.every((candidate: any) => candidate.valid)) {
            stopReason = 'stream_incomplete';
        }

        // 只有明确完整的 provider 终态才能执行 Tool；length、未知 finish reason、
        // content_filter 或残缺 function payload 一律隔离并交给 Agent 有界恢复。
        result.toolCalls = canExecuteProviderStreamToolCalls(stopReason)
            ? candidateToolCalls
            : [];
        result.stopReason = stopReason;
        if ((stopReason === 'max_tokens' || stopReason === 'stream_incomplete')
            && candidateToolCalls.length > 0) {
            result.incompleteToolCallNames = Array.from(new Set(
                candidateToolCalls.map((call: any) => String(call.name || '').trim()).filter(Boolean)
            ));
        }

        // Extract reasoning：deepseek/小米用 reasoning_content，openrouter 用 reasoning（格式可能非字符串）。
        // 统一收进 result.thinking（既供 UI 展示，也供 agent 写回历史，下一轮回传满足 DeepSeek/小米要求）。
        const rawReasoning = message?.reasoning_content ?? message?.reasoning;
        if (rawReasoning != null) {
            const reasoningText = typeof rawReasoning === 'string' ? rawReasoning : JSON.stringify(rawReasoning);
            if (reasoningText) {
                result.thinking = reasoningText;
            }
        }

        if (this.provider === 'xiaomi') {
            result.citations = normalizeProviderNativeToolCitations(message?.annotations, {
                provider: 'xiaomi'
            });
            if (raw.usage?.web_search_usage) {
                result.nativeToolUsage = [
                    {
                        provider: 'xiaomi',
                        toolType: 'web_search',
                        rawUsage: raw.usage.web_search_usage
                    }
                ];
            }
        }

        // Usage
        result.usage = readOpenAICompatibleTokenUsage(this.provider, raw.usage);

        return result;
    }
}

function parseToolArguments(value: unknown): {
    valid: boolean;
    value: Record<string, any>;
} {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return { valid: true, value: value as Record<string, any> };
    }
    if (typeof value !== 'string' || !value.trim()) return { valid: false, value: {} };
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? { valid: true, value: parsed }
            : { valid: false, value: {} };
    } catch {
        return { valid: false, value: {} };
    }
}
