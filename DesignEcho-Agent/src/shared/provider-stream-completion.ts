export type ProviderStreamStopReason =
    | 'end_turn'
    | 'tool_use'
    | 'max_tokens'
    | 'stream_incomplete'
    | 'content_blocked';

function normalizeFinishReason(value: unknown): string {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_');
}

export function mergeProviderFinishReason(
    current: unknown,
    incoming: unknown
): { finishReason?: string; conflict: boolean } {
    const currentReason = normalizeFinishReason(current);
    const incomingReason = normalizeFinishReason(incoming);
    if (!incomingReason) {
        return { ...(currentReason ? { finishReason: currentReason } : {}), conflict: false };
    }
    if (!currentReason) return { finishReason: incomingReason, conflict: false };
    if (currentReason === incomingReason) return { finishReason: currentReason, conflict: false };
    return { finishReason: currentReason, conflict: true };
}

/**
 * Provider 流只有明确给出终止原因时才可以晋升为完整结果。
 *
 * `[DONE]`、socket end 或 AsyncIterable 结束只能证明传输停止，不能证明模型是自然收尾；
 * 缺少终止原因时保持 stream_incomplete，防止把断网或残缺 Tool 参数当成成功。
 */
export function resolveProviderStreamStopReason(input: {
    finishReason?: unknown;
    hasToolCalls?: boolean;
    transportComplete?: boolean;
}): ProviderStreamStopReason {
    if (input.transportComplete === false) return 'stream_incomplete';
    const finishReason = normalizeFinishReason(input.finishReason);
    const hasToolCalls = input.hasToolCalls === true;

    if ([
        'length',
        'max_tokens',
        'max_token',
        'max_output_tokens',
        'token_limit'
    ].includes(finishReason)) {
        return 'max_tokens';
    }

    if ([
        'tool_calls',
        'tool_use',
        'function_call'
    ].includes(finishReason)) {
        return hasToolCalls ? 'tool_use' : 'stream_incomplete';
    }

    if ([
        'stop',
        'end_turn',
        'stop_sequence',
        'completed',
        'complete',
        'eos',
        'eos_token'
    ].includes(finishReason)) {
        return hasToolCalls ? 'stream_incomplete' : 'end_turn';
    }

    if ([
        'content_filter',
        'safety',
        'recitation',
        'blocklist',
        'prohibited_content',
        'spii',
        'refusal',
        'image_safety',
        'no_image'
    ].includes(finishReason)) {
        return 'content_blocked';
    }

    return 'stream_incomplete';
}

export function resolveCanonicalProviderStopReason(value: unknown): ProviderStreamStopReason {
    const normalized = normalizeFinishReason(value);
    switch (normalized) {
        case 'end_turn':
        case 'tool_use':
        case 'max_tokens':
        case 'stream_incomplete':
        case 'content_blocked':
            return normalized;
        case 'tool_calls':
        case 'function_call':
            return 'tool_use';
        default:
            return resolveProviderStreamStopReason({ finishReason: normalized, hasToolCalls: false });
    }
}

export function isProviderStreamOutputIncomplete(stopReason: unknown): boolean {
    const normalized = normalizeFinishReason(stopReason);
    return normalized === 'max_tokens' || normalized === 'stream_incomplete';
}

export function canExecuteProviderStreamToolCalls(stopReason: unknown): boolean {
    return normalizeFinishReason(stopReason) === 'tool_use';
}

export function isProviderStreamOutputBlocked(stopReason: unknown): boolean {
    return normalizeFinishReason(stopReason) === 'content_blocked';
}
