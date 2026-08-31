export interface CodexTurnIdleProgressVerdict {
    elapsedMs: number;
    remainingMs: number;
    expired: boolean;
}

/** 唯一能证明"最终结构化结果正在流式输出"的进展事件；推理/心跳/用量事件都不算。 */
const CODEX_TURN_FINAL_DRAIN_PROGRESS_METHOD = 'item/agentMessage/delta';
/** 最近一次 agentMessage delta 距基础 deadline 超过该毫秒数即视为陈旧，不授予排空宽限。 */
export const CODEX_TURN_FINAL_DRAIN_RECENCY_MS = 15_000;
/** 基础 wall-clock deadline 后最多追加的一次性排空宽限。 */
export const CODEX_TURN_FINAL_DRAIN_GRACE_MS = 180_000;

export type CodexTurnWallClockAction = 'wait' | 'grant_drain_grace' | 'timeout';

export interface CodexTurnWallClockVerdict {
    action: CodexTurnWallClockAction;
    /** 距 turn 开始的毫秒数（按单调归一后的输入计算）。 */
    elapsedMs: number;
    /** 基础 wall-clock 截止时刻（turnStartedAtMs + base，base 先被 max 封顶）。 */
    baseDeadlineMs: number;
    /** 排空宽限的绝对截止时刻 = min(base + grace, turnStartedAtMs + max)；永不随 now 滚动。 */
    absoluteDeadlineMs: number;
    /** action=wait / grant_drain_grace 时距下一次必须评估的毫秒数；timeout 时为 0。 */
    recheckInMs: number;
    /** 评估后的宽限消费状态；grant 即置 true，调用方必须持久化，不能重置。 */
    drainGraceConsumed: boolean;
}

export interface CodexTurnSlotIdentity {
    threadId: string;
}

export function isCodexFinalOutputDrainProgressMethod(progressMethod: unknown): boolean {
    return String(progressMethod || '') === CODEX_TURN_FINAL_DRAIN_PROGRESS_METHOD;
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
 * 有界的最终输出排空宽限：
 * 模型在基础 wall-clock deadline 到点时若正在流式输出最终 agentMessage
 * （最近一次已确认的 agentMessage delta 距当前不超过 recency 窗口），授予
 * 一次、且仅一次有界排空宽限，避免把即将完成的结构化结果在最后几秒
 * interrupt 掉。调用方必须单独记录该时间，普通进度不能覆盖它。
 *
 * 边界（全部由本纯函数决定，调用方不得另行放宽）：
 * - 所有 deadline 从 turnStartedAtMs 推导，绝不使用"now + grace"滚动续期；
 * - 宽限只授予一次：drainGraceConsumed=true 后到达绝对截止一律 timeout，
 *   即使 delta 仍在继续；
 * - 绝对截止封顶 turnStartedAtMs + maxWallClockTimeoutMs；基础值已达上限时
 *   没有可授予的余量，直接 timeout；
 * - reasoning delta、tokenUsage、heartbeat、item started/completed、静默推理
 *   等一律不得更新 lastFinalOutputDeltaAtMs；
 * - 本函数只管 wall-clock；idle timeout 是独立守卫，宽限期内仍必须照常生效。
 */
export function evaluateCodexTurnWallClockDeadline(input: {
    turnStartedAtMs: number;
    nowMs: number;
    baseWallClockTimeoutMs: number;
    maxWallClockTimeoutMs: number;
    drainGraceMs: number;
    drainGraceRecencyMs: number;
    drainGraceConsumed: boolean;
    lastFinalOutputDeltaAtMs?: number;
}): CodexTurnWallClockVerdict {
    const turnStartedAtMs = toNonNegativeInteger(input.turnStartedAtMs);
    const nowMs = Math.max(turnStartedAtMs, toNonNegativeInteger(input.nowMs));
    const maxWallClockTimeoutMs = Math.max(1, toNonNegativeInteger(input.maxWallClockTimeoutMs));
    const baseWallClockTimeoutMs = Math.min(
        maxWallClockTimeoutMs,
        Math.max(1, toNonNegativeInteger(input.baseWallClockTimeoutMs))
    );
    const drainGraceMs = toNonNegativeInteger(input.drainGraceMs);
    const drainGraceRecencyMs = toNonNegativeInteger(input.drainGraceRecencyMs);
    const baseDeadlineMs = turnStartedAtMs + baseWallClockTimeoutMs;
    const absoluteDeadlineMs = Math.min(
        baseDeadlineMs + drainGraceMs,
        turnStartedAtMs + maxWallClockTimeoutMs
    );
    const elapsedMs = nowMs - turnStartedAtMs;

    if (nowMs < baseDeadlineMs) {
        return {
            action: 'wait',
            elapsedMs,
            baseDeadlineMs,
            absoluteDeadlineMs,
            recheckInMs: baseDeadlineMs - nowMs,
            drainGraceConsumed: input.drainGraceConsumed === true
        };
    }

    if (input.drainGraceConsumed === true) {
        if (nowMs < absoluteDeadlineMs) {
            return {
                action: 'wait',
                elapsedMs,
                baseDeadlineMs,
                absoluteDeadlineMs,
                recheckInMs: absoluteDeadlineMs - nowMs,
                drainGraceConsumed: true
            };
        }
        return {
            action: 'timeout',
            elapsedMs,
            baseDeadlineMs,
            absoluteDeadlineMs,
            recheckInMs: 0,
            drainGraceConsumed: true
        };
    }

    const rawFinalOutputDeltaAtMs = typeof input.lastFinalOutputDeltaAtMs === 'number'
        ? input.lastFinalOutputDeltaAtMs
        : Number.NaN;
    const finalOutputDeltaAtMs = Math.floor(rawFinalOutputDeltaAtMs);
    const hasValidFinalOutputDelta = Number.isFinite(rawFinalOutputDeltaAtMs)
        && finalOutputDeltaAtMs >= turnStartedAtMs
        && finalOutputDeltaAtMs <= nowMs;
    const deltaAgeMs = hasValidFinalOutputDelta
        ? nowMs - finalOutputDeltaAtMs
        : Number.POSITIVE_INFINITY;
    if (deltaAgeMs <= drainGraceRecencyMs && absoluteDeadlineMs > nowMs) {
        return {
            action: 'grant_drain_grace',
            elapsedMs,
            baseDeadlineMs,
            absoluteDeadlineMs,
            recheckInMs: absoluteDeadlineMs - nowMs,
            drainGraceConsumed: true
        };
    }

    return {
        action: 'timeout',
        elapsedMs,
        baseDeadlineMs,
        absoluteDeadlineMs,
        recheckInMs: 0,
        drainGraceConsumed: false
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
