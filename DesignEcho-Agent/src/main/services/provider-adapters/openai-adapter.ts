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

export class OpenAIAdapter implements ProviderAdapter {
    constructor(private readonly provider = 'openai') {}

    supportsNativeTools(): boolean {
        return true;
    }

    formatMessages(
        messages: AdapterMessage[],
        tools: ToolSchema[],
        options?: AdapterOptions
    ): { messages: any[]; tools: any[]; tool_choice: string; max_tokens: number; temperature?: number } {
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
                const assistantMsg: any = { role: 'assistant' };
                if (msg.content) {
                    assistantMsg.content = msg.content;
                }
                if (msg.toolCalls?.length) {
                    assistantMsg.tool_calls = msg.toolCalls.map(call => ({
                        id: call.id,
                        type: 'function',
                        function: {
                            name: call.name,
                            arguments: JSON.stringify(call.arguments)
                        }
                    }));
                }
                openaiMessages.push(assistantMsg);
            } else if (msg.role === 'tool_result') {
                for (const r of msg.toolResults || []) {
                    openaiMessages.push({
                        role: 'tool',
                        tool_call_id: r.callId,
                        content: typeof r.output === 'string' ? r.output : JSON.stringify(r.output)
                    });
                }
            }
        }

        // Inject system prompt if not already present
        if (options?.systemPrompt && !openaiMessages.some(m => m.role === 'system')) {
            openaiMessages.unshift({ role: 'system', content: options.systemPrompt });
        }

        return {
            messages: openaiMessages,
            tools: requestTools,
            tool_choice: 'auto' as const,
            max_tokens: buildAgentProviderTokenBudget({ requestedMaxTokens: options?.maxTokens }).maxTokens,
            ...(options?.temperature !== undefined ? { temperature: options.temperature } : {})
        };
    }

    parseResponse(raw: any): ProviderResponse {
        const result: ProviderResponse = {};

        // Handle OpenAI chat completion format
        const choice = raw.choices?.[0];
        if (!choice) {
            result.content = '';
            return result;
        }

        const message = choice.message;
        result.content = message?.content || '';

        // Parse tool calls — always set toolCalls (empty array if none)
        if (message?.tool_calls?.length) {
            result.toolCalls = message.tool_calls.map((tc: any) => ({
                id: tc.id,
                name: tc.function?.name || '',
                arguments: safeParse(tc.function?.arguments)
            }));
            result.stopReason = 'tool_use';
        } else {
            result.toolCalls = [];
            if (choice.finish_reason === 'stop') {
                result.stopReason = 'end_turn';
            } else if (choice.finish_reason === 'length') {
                result.stopReason = 'max_tokens';
            }
        }

        // Extract reasoning_content if present (DeepSeek via OpenRouter)
        if (message?.reasoning_content) {
            result.thinking = message.reasoning_content;
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
        result.usage = {
            inputTokens: raw.usage?.prompt_tokens || 0,
            outputTokens: raw.usage?.completion_tokens || 0
        };

        return result;
    }
}

function safeParse(jsonStr: any): Record<string, any> {
    if (typeof jsonStr === 'object' && jsonStr !== null) return jsonStr;
    if (typeof jsonStr !== 'string') return {};
    try {
        return JSON.parse(jsonStr);
    } catch {
        return {};
    }
}
