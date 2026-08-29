export type AgentResponseInterruptionVersion = 'agent-response-interruption/v0';

export type AgentResponseInterruptionKind = 'user_stopped' | 'request_cancelled';

export interface AgentResponseInterruption {
    version: AgentResponseInterruptionVersion;
    kind: AgentResponseInterruptionKind;
}

export const USER_STOPPED_RESPONSE_LABEL = '你已停止此响应';
export const REQUEST_CANCELLED_RESPONSE_LABEL = '本次响应已中断';

const LEGACY_USER_STOP_SOURCES = new Set([
    'agent-run:stop',
    'agent-run:user-stopped'
]);

const LEGACY_REQUEST_CANCEL_SOURCES = new Set([
    'agent-run:debug-bridge-cancelled'
]);

export function buildAgentResponseInterruption(
    kind: AgentResponseInterruptionKind
): AgentResponseInterruption {
    return {
        version: 'agent-response-interruption/v0',
        kind
    };
}

export function buildUserStoppedResponseInterruption(): AgentResponseInterruption {
    return buildAgentResponseInterruption('user_stopped');
}

export function buildRequestCancelledResponseInterruption(): AgentResponseInterruption {
    return buildAgentResponseInterruption('request_cancelled');
}

export function normalizeAgentResponseInterruption(
    value: unknown
): AgentResponseInterruption | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const candidate = value as Partial<AgentResponseInterruption>;
    if (candidate.version !== 'agent-response-interruption/v0') return undefined;
    if (candidate.kind !== 'user_stopped' && candidate.kind !== 'request_cancelled') return undefined;
    return buildAgentResponseInterruption(candidate.kind);
}

export function resolveAgentResponseInterruption(input: {
    interruption?: unknown;
    assistantReplyOrigin?: unknown;
    content?: unknown;
}): AgentResponseInterruption | undefined {
    const explicit = normalizeAgentResponseInterruption(input.interruption);
    if (explicit) return explicit;
    if (!input.assistantReplyOrigin || typeof input.assistantReplyOrigin !== 'object') return undefined;

    const origin = input.assistantReplyOrigin as {
        origin?: unknown;
        source?: unknown;
    };
    if (origin.origin !== 'ui_status') return undefined;
    const source = typeof origin.source === 'string' ? origin.source.trim() : '';
    if (LEGACY_USER_STOP_SOURCES.has(source)) return buildUserStoppedResponseInterruption();
    if (LEGACY_REQUEST_CANCEL_SOURCES.has(source)) return buildRequestCancelledResponseInterruption();
    return undefined;
}

export function isAgentResponseInterruptionSentinelContent(value: unknown): boolean {
    const content = String(value || '')
        .replace(/\uFE0F/g, '')
        .trim();
    return /^(?:⏹\s*)?(?:已停止|任务已停止|你已停止此响应|本次响应已中断)$/u.test(content);
}

export function formatAgentResponseInterruption(
    value: unknown
): string | undefined {
    const interruption = normalizeAgentResponseInterruption(value);
    if (!interruption) return undefined;
    return interruption.kind === 'user_stopped'
        ? USER_STOPPED_RESPONSE_LABEL
        : REQUEST_CANCELLED_RESPONSE_LABEL;
}
