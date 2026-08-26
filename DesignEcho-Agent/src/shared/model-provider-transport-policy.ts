import type { ModelProviderFailure } from './model-provider-failure';

const CODEX_SUBSCRIPTION_IDLE_TIMEOUT = 'codex_subscription_turn_idle_timeout';
const CODEX_SUBSCRIPTION_WALL_CLOCK_TIMEOUT = 'codex_subscription_turn_wall_clock_timeout';

function normalizeProviderCode(failure: ModelProviderFailure): string {
    return String(failure.providerCode || '').trim().toLowerCase();
}

export function isHarnessManagedSubscriptionTimeout(
    failure: ModelProviderFailure
): boolean {
    if (failure.kind !== 'timeout') return false;
    const code = normalizeProviderCode(failure);
    return code === CODEX_SUBSCRIPTION_IDLE_TIMEOUT
        || code === CODEX_SUBSCRIPTION_WALL_CLOCK_TIMEOUT;
}

export function isRetryableSubscriptionIdleTimeout(
    failure: ModelProviderFailure
): boolean {
    return failure.kind === 'timeout'
        && normalizeProviderCode(failure) === CODEX_SUBSCRIPTION_IDLE_TIMEOUT;
}

export function shouldRetryAutonomousModelTransport(input: {
    failure: ModelProviderFailure;
    attempt: number;
    maxAttempts: number;
    hasEmittedStreamPayload: boolean;
}): boolean {
    if (input.attempt >= input.maxAttempts || input.hasEmittedStreamPayload) return false;
    const code = normalizeProviderCode(input.failure);
    if (code === CODEX_SUBSCRIPTION_WALL_CLOCK_TIMEOUT) return false;
    if (input.failure.kind === 'service_unavailable' || input.failure.kind === 'network') {
        return true;
    }
    if (input.failure.kind !== 'timeout') return false;
    return code === CODEX_SUBSCRIPTION_IDLE_TIMEOUT
        || !isHarnessManagedSubscriptionTimeout(input.failure);
}
