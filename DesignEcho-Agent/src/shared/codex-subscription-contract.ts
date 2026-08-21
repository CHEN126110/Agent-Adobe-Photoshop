import type { ModelConfig } from './config/models.config';

export const CODEX_SUBSCRIPTION_PROVIDER = 'openai-codex' as const;
export const CODEX_SUBSCRIPTION_RUNTIME_VERSION = '0.149.0';

export type CodexSubscriptionAuthMode = 'none' | 'chatgpt' | 'api_key' | 'unsupported';

export interface CodexSubscriptionStatus {
    runtimeAvailable: boolean;
    runtimeVersion: string;
    signedIn: boolean;
    authMode: CodexSubscriptionAuthMode;
    planType?: string;
    accountLabel?: string;
    loginPending: boolean;
    error?: string;
}

export interface CodexSubscriptionOperationResult {
    success: boolean;
    pending?: boolean;
    error?: string;
}

export interface CodexSubscriptionStatusResult {
    success: boolean;
    status: CodexSubscriptionStatus;
    error?: string;
}

export interface CodexSubscriptionModelListResult {
    success: boolean;
    models: ModelConfig[];
    error?: string;
}

export interface CodexSubscriptionRateLimitWindow {
    usedPercent: number;
    windowDurationMins?: number;
    resetsAt?: number;
}

export interface CodexSubscriptionRateLimits {
    planType?: string;
    primary?: CodexSubscriptionRateLimitWindow;
    secondary?: CodexSubscriptionRateLimitWindow;
}

export interface CodexSubscriptionRateLimitsResult {
    success: boolean;
    rateLimits?: CodexSubscriptionRateLimits;
    error?: string;
}

export interface CodexSubscriptionImageGenerationCapabilityResult {
    success: boolean;
    available: boolean;
    model: 'gpt-image-2';
    usageKind: 'codex_subscription';
    error?: string;
}

export interface CodexSubscriptionImageGenerationRequest {
    prompt: string;
    width?: number;
    height?: number;
    transparentBackground?: boolean;
}

export interface CodexSubscriptionImageGenerationResult {
    success: boolean;
    imageData?: string;
    mediaType?: 'image/png' | 'image/jpeg' | 'image/webp';
    width?: number;
    height?: number;
    model?: 'gpt-image-2';
    provider?: 'codex-subscription';
    revisedPrompt?: string;
    transparentBackground?: boolean;
    code?: string;
    resetsAt?: number;
    error?: string;
}

export interface CodexSubscriptionStateChangedEvent {
    reason: 'account' | 'runtime_exit' | 'ready';
}

export function isCodexSubscriptionModel(model: Pick<ModelConfig, 'provider'> | null | undefined): boolean {
    return model?.provider === CODEX_SUBSCRIPTION_PROVIDER;
}

export function buildCodexSubscriptionModelId(apiModelId: string): string {
    const slug = String(apiModelId || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return `codex-subscription-${slug}`;
}

export function isGpt56CodexModelId(apiModelId: string): boolean {
    return /^gpt-5\.6(?:-|$)/i.test(String(apiModelId || '').trim());
}
