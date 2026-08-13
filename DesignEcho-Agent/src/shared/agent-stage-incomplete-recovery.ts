/**
 * 「阶段未完成」的恢复决策（纯逻辑、可 smoke 测）。
 *
 * 背景（真机）：模型想给最终回答时，Harness 会检查 Runtime Stage 是否还停在
 * 非 R5 阶段——是则判定「该做的实际处理没发生」。这个判断本身是对的，
 * 但处理方式是**直接终止运行**：C-1234 的详情页那次停在 `E1 / awaiting_outcomes`，
 * `iterations: 26` 而预算是 60，也就是说**预算没烧完，是判定把任务杀了**。
 *
 * 更能说明问题的是：终止前的代码已经把提示 push 进 messages，紧接着就 return，
 * 消息推了却根本没机会被模型消费——原意像是「推回让它继续」，实现成了终止。
 *
 * 本模块只做一件事：把这个判定从「终止」改成「有界推回，耗尽后升级给人」，
 * 并且把缺口说具体——原来的提示是「这次没有执行任务所要求的实际处理」，
 * 模型读完并不知道该干什么。
 *
 * 边界（与 runtime-action-provider-recovery 的 provider 失败恢复是不同场景）：
 * - 只产出决策与文案，不执行 Tool、不推进 Stage、不授予权限、不改变完成判定；
 * - 不臆造缺口：拿不到 missingOutcomes 时如实说「阶段未标记完成」，不编造步骤名；
 * - 重试有界且不因中途有动作而重置——否则模型可以在「做一点事 → 想收尾」之间反复横跳。
 */

export type StageIncompleteObligation =
    | 'task_progress_missing'
    | 'delivery_action_missing'
    | 'runtime_stage_incomplete';

/** 一次运行内最多把缺口推回几次；耗尽后升级给用户。 */
export const MAX_STAGE_INCOMPLETE_RECOVERY_ATTEMPTS = 2;

export interface StageIncompleteStageSnapshot {
    stage: string;
    status: string;
    missingOutcomes?: readonly string[];
    lastEvaluation?: { reason?: string };
}

export interface StageIncompleteStageStateInput {
    currentStage?: string;
    stages?: readonly StageIncompleteStageSnapshot[];
}

export interface StageIncompleteGap {
    stage?: string;
    missingOutcomes: string[];
    reason?: string;
}

export interface StageIncompleteRecoveryDecision {
    /** true = 把缺口推回模型继续做；false = 已耗尽，交回用户。 */
    shouldRetry: boolean;
    attempt: number;
    maxAttempts: number;
    /** 推回给模型的指令；shouldRetry 为 false 时为空字符串。 */
    modelDirective: string;
    /** 交回用户时的说明；shouldRetry 为 true 时为空字符串。 */
    escalationMessage: string;
    /** 结构化缺口，用于 run record 审计（不含模型原文与工具载荷）。 */
    gap: StageIncompleteGap;
    boundaries: {
        decisionOnly: true;
        doesNotAdvanceStage: true;
        doesNotGrantPermission: true;
    };
}

const OBLIGATION_LABELS: Record<StageIncompleteObligation, string> = {
    task_progress_missing: '本轮没有产生任何实际的任务进展',
    delivery_action_missing: '交付动作还没有发生',
    runtime_stage_incomplete: '当前阶段还没有达成它要求的结果'
};

function normalizeList(values: readonly string[] | undefined): string[] {
    return (values || [])
        .map((value) => String(value || '').trim())
        .filter(Boolean);
}

/**
 * 从阶段状态里取出当前阶段的真实缺口。
 *
 * 只读当前阶段那一条；不汇总全部阶段——把历史阶段的缺口混进来会让模型
 * 去补早已跳过的东西。
 */
export function readStageIncompleteGap(
    stageState: StageIncompleteStageStateInput | undefined
): StageIncompleteGap {
    const currentStage = String(stageState?.currentStage || '').trim() || undefined;
    if (!currentStage) return { missingOutcomes: [] };

    const snapshot = (stageState?.stages || []).find((item) => item.stage === currentStage);
    return {
        stage: currentStage,
        missingOutcomes: normalizeList(snapshot?.missingOutcomes),
        reason: String(snapshot?.lastEvaluation?.reason || '').trim() || undefined
    };
}

function describeGap(gap: StageIncompleteGap): string {
    const parts: string[] = [];
    if (gap.stage) parts.push(`当前阶段：${gap.stage}`);
    if (gap.missingOutcomes.length > 0) {
        parts.push(`还缺：${gap.missingOutcomes.join('、')}`);
    }
    if (gap.reason) parts.push(`判定原因：${gap.reason}`);
    return parts.join('；');
}

/**
 * 决定「阶段未完成」这次该推回还是升级。
 *
 * attempt 从 1 开始计数，表示这是第几次遇到该判定（含本次）。
 */
export function decideStageIncompleteRecovery(input: {
    obligation: StageIncompleteObligation;
    stageState?: StageIncompleteStageStateInput;
    attempt: number;
    maxAttempts?: number;
}): StageIncompleteRecoveryDecision {
    const maxAttempts = Number.isFinite(input.maxAttempts) && (input.maxAttempts as number) > 0
        ? Math.floor(input.maxAttempts as number)
        : MAX_STAGE_INCOMPLETE_RECOVERY_ATTEMPTS;
    const attempt = Math.max(1, Math.floor(input.attempt || 1));
    const gap = readStageIncompleteGap(input.stageState);
    const gapText = describeGap(gap);
    const obligationText = OBLIGATION_LABELS[input.obligation] || OBLIGATION_LABELS.runtime_stage_incomplete;
    const shouldRetry = attempt <= maxAttempts;
    const boundaries = {
        decisionOnly: true,
        doesNotAdvanceStage: true,
        doesNotGrantPermission: true
    } as const;

    if (shouldRetry) {
        return {
            shouldRetry: true,
            attempt,
            maxAttempts,
            modelDirective: [
                `还不能收尾：${obligationText}。`,
                gapText ? `${gapText}。` : '',
                '请继续把它做完：要么执行还缺的那一步，要么说明为什么它已经被此前的结果满足；',
                '如果确实缺少只有用户能提供的信息，就把问题一次问清楚，不要重复同样的动作。'
            ].filter(Boolean).join(''),
            escalationMessage: '',
            gap,
            boundaries
        };
    }

    return {
        shouldRetry: false,
        attempt,
        maxAttempts,
        modelDirective: '',
        escalationMessage: [
            '这稿我没能做完，先交回给你。',
            gapText ? `卡在这里：${gapText}。` : '卡在阶段结果没有达成。',
            `我已经尝试补做 ${maxAttempts} 次仍未通过，继续重试只会空转。`,
            '你可以补充缺少的信息、调整要求，或让我从这里接着做。'
        ].join(''),
        gap,
        boundaries
    };
}
