/**
 * Claude 订阅通道契约（provider: 'claude-subscription'）。
 *
 * 通过 @anthropic-ai/claude-agent-sdk 内嵌的 Claude Code 运行时使用用户本人的 Claude 订阅，
 * 与 Anthropic API Key（provider-adapters/anthropic-adapter）彼此独立。
 * 登录凭据由 Claude Code 运行时自管（OAuth /login），DesignEcho 不读取、不存储、不转发凭据。
 * 子进程显式绕开 ~/.claude/settings.json 的第三方中转 env 覆盖（settingSources 空 + env 清理），
 * 确保走真实 Claude 模型；额度耗尽或未登录时如实报错，不静默降级到其他模型。
 */

import type { ModelConfig } from './config/models.config';

export const CLAUDE_SUBSCRIPTION_PROVIDER = 'claude-subscription' as const;

export interface ClaudeSubscriptionStatus {
    runtimeAvailable: boolean;
    runtimeVersion: string;
    /** 凭据探测结论：credential_found 只代表本机存在登录凭据，真实可用性以 probeAuth / 首次对话为准。 */
    signedIn: boolean;
    credentialSource: 'credential_file' | 'unknown' | 'none';
    accountLabel?: string;
    lastProbe?: {
        at: number;
        ok: boolean;
        model?: string;
        error?: string;
    };
    /** 本次应用启动以来经此通道的真实用量（运行时不提供订阅额度窗口的程序化读取，用它做在场反馈）。 */
    sessionUsage?: {
        calls: number;
        inputTokens: number;
        outputTokens: number;
    };
    error?: string;
}

export interface ClaudeSubscriptionStatusResult {
    success: boolean;
    status: ClaudeSubscriptionStatus;
    error?: string;
}

export interface ClaudeSubscriptionOperationResult {
    success: boolean;
    error?: string;
}

export interface ClaudeSubscriptionModelListResult {
    success: boolean;
    models: ModelConfig[];
    error?: string;
}

export interface ClaudeSubscriptionProbeResult {
    success: boolean;
    model?: string;
    replyPreview?: string;
    error?: string;
}
