/**
 * Context Manager
 *
 * 管理 Agent 消息历史，在上下文过长时截断/压缩
 */

import { buildAgentContextWindowBudget } from '../../../shared/agent-performance-policy';
import type { AgentMessage } from './types';

interface ContextManagerConfig {
    /** 估算的最大 token 数 */
    maxTokens: number;
    /** 保留最近 N 轮完整内容 */
    keepRecentRounds: number;
}

const DEFAULT_CONTEXT_BUDGET = buildAgentContextWindowBudget();

const DEFAULT_CONFIG: ContextManagerConfig = {
    maxTokens: DEFAULT_CONTEXT_BUDGET.maxTokens,
    keepRecentRounds: DEFAULT_CONTEXT_BUDGET.keepRecentRounds
};

/**
 * 粗略估算消息 token 数
 * 中英混合场景：平均 1 token ≈ 1.5 字符
 */
function estimateTokens(message: AgentMessage): number {
    let chars = 0;

    if (message.content) {
        chars += message.content.length;
    }

    if (message.toolCalls) {
        for (const call of message.toolCalls) {
            chars += call.name.length;
            chars += JSON.stringify(call.arguments).length;
        }
    }

    if (message.toolResults) {
        for (const result of message.toolResults) {
            const output = typeof result.output === 'string'
                ? result.output
                : JSON.stringify(result.output);
            chars += output.length;
        }
    }

    return Math.ceil(chars / 1.5);
}

/**
 * 压缩工具结果（只保留关键摘要）
 */
function compressToolResult(message: AgentMessage): AgentMessage {
    if (message.role !== 'tool_result' || !message.toolResults) return message;

    const compressedResults = message.toolResults.map(r => {
        const output = typeof r.output === 'string' ? r.output : JSON.stringify(r.output);

        // 如果输出较短，保留原样
        if (output.length < 500) return r;

        // 压缩：只保留 success/error 和前 200 字符摘要
        let summary: string;
        if (r.success) {
            summary = `[Compressed] Success. Preview: ${output.substring(0, 200)}...`;
        } else {
            summary = `[Compressed] Error: ${output.substring(0, 300)}`;
        }

        return {
            callId: r.callId,
            success: r.success,
            output: summary
        };
    });

    return {
        ...message,
        toolResults: compressedResults
    };
}

export class ContextManager {
    private config: ContextManagerConfig;

    constructor(config?: Partial<ContextManagerConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * 截断消息历史以控制上下文长度
     *
     * 策略：
     * 1. System prompt + 最新用户指令 永不截断
     * 2. 最近 N 轮保持完整
     * 3. 较旧的轮次：压缩 tool_result 内容
     * 4. 如果仍超限：移除最旧的中间轮次
     */
    trim(messages: AgentMessage[]): AgentMessage[] {
        const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m), 0);

        // 未超限，无需处理
        if (totalTokens <= this.config.maxTokens) return messages;

        // 分离系统消息和对话消息
        const systemMessages = messages.filter(m => m.role === 'system');
        const conversationMessages = messages.filter(m => m.role !== 'system');

        // 计算保护区域（最近 N 轮 * 每轮约 3 条消息：user/assistant/tool_result）
        const protectedCount = this.config.keepRecentRounds * 3;
        const protectedMessages = conversationMessages.slice(-protectedCount);
        const olderMessages = conversationMessages.slice(0, -protectedCount);

        // Phase 1: 压缩较旧消息的 tool_result
        let compressed = olderMessages.map(m => compressToolResult(m));

        // 检查压缩后是否满足
        let result = [...systemMessages, ...compressed, ...protectedMessages];
        let currentTokens = result.reduce((sum, m) => sum + estimateTokens(m), 0);

        if (currentTokens <= this.config.maxTokens) return result;

        // Phase 2: 逐步删除最旧的轮次（每次删 3 条消息 = 1 轮）
        while (compressed.length >= 3 && currentTokens > this.config.maxTokens) {
            // 删除最旧的一轮（assistant + tool_result + 可能的 user）
            compressed = compressed.slice(3);
            result = [...systemMessages, ...compressed, ...protectedMessages];
            currentTokens = result.reduce((sum, m) => sum + estimateTokens(m), 0);
        }

        // Phase 3: 如果还是太长，只保留 system + protected
        if (currentTokens > this.config.maxTokens) {
            return [...systemMessages, ...protectedMessages];
        }

        return result;
    }

    /**
     * 获取当前 token 估算
     */
    estimateTotal(messages: AgentMessage[]): number {
        return messages.reduce((sum, m) => sum + estimateTokens(m), 0);
    }
}
