export interface CodexTurnIdleProgressVerdict {
    elapsedMs: number;
    remainingMs: number;
    expired: boolean;
}

export interface CodexTurnSlotIdentity {
    threadId: string;
}

function toNonNegativeInteger(value: unknown): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

/**
 * 只比较单调的“最后进展时间”和当前时间；不解释模型内容，也不决定任务结果。
 * 调用方必须在接受一个新进展事件之前先评价旧空窗，避免迟到事件抹去既成超时。
 */
export function evaluateCodexTurnIdleProgress(input: {
    lastProgressAtMs: number;
    nowMs: number;
    idleTimeoutMs: number;
}): CodexTurnIdleProgressVerdict {
    const lastProgressAtMs = toNonNegativeInteger(input.lastProgressAtMs);
    const nowMs = Math.max(lastProgressAtMs, toNonNegativeInteger(input.nowMs));
    const idleTimeoutMs = Math.max(1, toNonNegativeInteger(input.idleTimeoutMs));
    const elapsedMs = nowMs - lastProgressAtMs;
    return {
        elapsedMs,
        remainingMs: Math.max(0, idleTimeoutMs - elapsedMs),
        expired: elapsedMs >= idleTimeoutMs
    };
}

/**
 * threadId 只能定位槽位，不能证明回调仍属于当前 Turn。
 *
 * 超时、Abort 与 turn/start RPC 都可能在旧 Turn 结束后才回调；调用方必须同时比较
 * 对象身份，避免旧回调删除、取消或完成后来复用同一 threadId 的新 Turn。
 */
export function ownsCodexTurnSlot<T extends CodexTurnSlotIdentity>(
    slots: Pick<ReadonlyMap<string, T>, 'get'>,
    expected: T
): boolean {
    return slots.get(expected.threadId) === expected;
}

/**
 * App Server 并非每种通知都带 turnId；有双方 ID 时必须严格相等，无 ID 时只允许调用方
 * 继续使用对象身份与状态守卫，不能用 threadId 伪造已经完成的关联校验。
 */
export function codexNotificationMatchesActiveTurn(input: {
    activeTurnId?: string;
    notificationTurnId?: string;
}): boolean {
    const activeTurnId = String(input.activeTurnId || '').trim();
    const notificationTurnId = String(input.notificationTurnId || '').trim();
    if (!activeTurnId || !notificationTurnId) return true;
    return activeTurnId === notificationTurnId;
}
