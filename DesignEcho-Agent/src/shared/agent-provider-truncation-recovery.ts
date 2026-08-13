export interface ProviderTruncationTokenWindowInput {
    baseMaxTokens: number;
    configuredMaxTokens?: number;
    performanceMaxTokens?: number;
    recoveryAttempt: number;
}

function readPositiveInteger(value: number | undefined): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
    return Math.max(1, Math.floor(value));
}

/**
 * Provider 截断后的补偿窗口可以放大普通轮的成本档，但绝不能越过模型/provider 的真实硬上限。
 * recoveryAttempt=0 表示普通请求；1、2 分别使用 2 倍、4 倍的普通输出窗口。
 */
export function resolveProviderTruncationMaxTokens(
    input: ProviderTruncationTokenWindowInput
): number {
    const attempt = Math.max(0, Math.floor(input.recoveryAttempt));
    const multiplier = 2 ** attempt;
    const baseMaxTokens = readPositiveInteger(input.baseMaxTokens) || 1;
    const limits = [baseMaxTokens * multiplier];
    const configuredMaxTokens = readPositiveInteger(input.configuredMaxTokens);
    const performanceMaxTokens = readPositiveInteger(input.performanceMaxTokens);
    if (configuredMaxTokens !== undefined) limits.push(configuredMaxTokens);
    if (performanceMaxTokens !== undefined) {
        limits.push(performanceMaxTokens * multiplier);
    }
    return Math.max(1, Math.min(...limits));
}
