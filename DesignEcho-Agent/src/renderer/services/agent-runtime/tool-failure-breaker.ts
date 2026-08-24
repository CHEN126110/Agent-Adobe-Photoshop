export const CONSECUTIVE_SAME_TOOL_FAILURE_LIMIT = 3;

function normalizeToolFailureReason(value: unknown): string {
    return String(value || '')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .trim()
        .toLowerCase();
}

/** 只有失败原因保持不变才算同一堵墙；工具名相同但校验问题变化代表 Agent 正在修正。 */
/** 从一批失败工具结果中取第一条具体失败原因（给用户看的步骤反馈不许只说「没有全部成功」）。 */
export function firstToolFailureReason(results: Array<{ output?: unknown }>): string {
    return results
        .map((item) => {
            const raw = item.output as any;
            return String(raw?.error || raw?.data?.error || raw?.message || '').trim();
        })
        .find((text) => text.length > 0) || '';
}

export function areEquivalentToolFailureReasons(previous: unknown, current: unknown): boolean {
    const previousReason = normalizeToolFailureReason(previous);
    const currentReason = normalizeToolFailureReason(current);
    return Boolean(previousReason && currentReason && previousReason === currentReason);
}

export function hasRepeatedToolFailureExhausted(
    toolCalls: ReadonlyArray<{ id: string; name: string }>,
    toolResults: ReadonlyArray<{ callId: string; success: boolean }>,
    failureCounts: ReadonlyMap<string, number>
): boolean {
    const failedCallIds = new Set(
        toolResults.filter((result) => !result.success).map((result) => result.callId)
    );
    return toolCalls.some((call) => (
        failedCallIds.has(call.id)
        && (failureCounts.get(call.name) || 0) >= CONSECUTIVE_SAME_TOOL_FAILURE_LIMIT
    ));
}

export function buildRepeatedToolFailureBlocker(input: {
    toolName: string;
    failureCount: number;
    lastFailureReason?: string;
}): Record<string, unknown> | undefined {
    if (input.failureCount < CONSECUTIVE_SAME_TOOL_FAILURE_LIMIT) return undefined;
    return {
        success: false,
        code: 'agent_tool_failure_breaker_exhausted',
        blockedByFailureBreaker: true,
        error: [
            `工具 ${input.toolName} 已连续失败 ${input.failureCount} 次，本次调用未再执行。`,
            input.lastFailureReason ? `上次失败原因：${input.lastFailureReason}` : '',
            '同一原因连续失败通常是环境或前置条件问题：优先解决失败原因里点名的前置条件（缺素材、缺模板、需要用户操作等），换参数重试同一工具大概率还会撞同一堵墙。',
            '如果这是一个技能工具：它的确定性流程当前不可用，你仍然可以用原子工具按自己的设计判断手工完成交付物，或把上次失败原因如实告诉用户并请求指示。',
            '请根据现有事实自行选择其他可用方式，或诚实说明当前无法继续。'
        ].filter(Boolean).join('\n'),
        executesPhotoshop: false,
        grantsPermission: false,
        countsAsTaskProgress: false
    };
}
