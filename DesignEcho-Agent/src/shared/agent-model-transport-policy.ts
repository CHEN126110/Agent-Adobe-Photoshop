export interface AgentProtocolMessageLike {
    role?: string;
    toolCalls?: unknown[];
    toolResults?: unknown[];
    reasoningContent?: unknown;
    contentBlocks?: Array<{ type?: string }>;
}

export type AgentModelTransport = 'plain_chat' | 'provider_adapter';

export interface AgentModelTransportInput {
    messages: readonly AgentProtocolMessageLike[];
    toolCount: number;
    hasProviderNativeTools: boolean;
}

export interface ProviderReasoningReplayInput {
    provider?: unknown;
    thinkingEnabled?: boolean;
}

/**
 * 只有这些 OpenAI-compatible 通道会在开启思考时把字符串 reasoning 历史原样回放。
 * Anthropic 需要签名、Codex/Gemini/Ollama 不发送该字段，不能把它们误算进请求容量。
 */
export function shouldReplayProviderReasoningContent(
    input: ProviderReasoningReplayInput
): boolean {
    if (input.thinkingEnabled !== true) return false;
    return input.provider === 'deepseek'
        || input.provider === 'xiaomi'
        || input.provider === 'openrouter';
}

/**
 * 工具协议属于整段消息历史，而不是本轮工具 schema 的附属状态。
 * 一旦历史进入过工具 / reasoning 协议，就必须继续经 provider adapter 序列化；
 * 否则内部 tool_result 会被普通聊天接口当成非法 provider role 原样发送。
 */
export function requiresAgentProtocolTransport(
    messages: readonly AgentProtocolMessageLike[]
): boolean {
    return messages.some((message) => {
        // plain chat 是白名单通道：只允许明确的 system/user/assistant 文本角色。
        // 未来新增任何内部角色时默认走 provider adapter，避免再次把内部协议原样泄漏给 provider。
        if (message.role !== 'system' && message.role !== 'user' && message.role !== 'assistant') {
            return true;
        }
        if (Array.isArray(message.toolCalls) && message.toolCalls.length > 0) return true;
        if (Array.isArray(message.toolResults) && message.toolResults.length > 0) return true;
        if (message.reasoningContent === undefined || message.reasoningContent === null) return false;
        return String(message.reasoningContent).trim().length > 0;
    });
}

export function resolveAgentModelTransport(input: AgentModelTransportInput): AgentModelTransport {
    const hasVisualContent = input.messages.some((message) => (
        Array.isArray(message.contentBlocks)
        && message.contentBlocks.some((block) => block?.type === 'image')
    ));
    // 多模态必须经过 provider adapter：plain chat 的 provider 私有实现对 system role 与
    // image parts 处理并不一致，曾出现 DeepSeek 静默删图、Anthropic 把 system 塞进
    // messages 后拒绝。tools=[] 只表示本轮不需要函数调用，不表示可以降级成文本通道。
    if (hasVisualContent || input.toolCount > 0 || input.hasProviderNativeTools) {
        return 'provider_adapter';
    }
    return requiresAgentProtocolTransport(input.messages)
        ? 'provider_adapter'
        : 'plain_chat';
}
