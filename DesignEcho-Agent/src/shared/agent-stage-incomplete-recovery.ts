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
 * - 交互等待、单写者冲突、revision 重观察和 Agent handoff 有各自 owner，通用补做必须让路；
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

export type StageIncompleteStructuralBlockerCode =
    | 'waiting_user'
    | 'pending_interaction'
    | 'writer_conflict'
    | 'needs_reobserve'
    | 'agent_handoff';

/**
 * Runtime 已经确认的结构性状态。这里只消费投影，不读取 Skill、品类或用户文本。
 */
export interface StageIncompleteRuntimeStateInput {
    taskRunStatus?: string;
    documentBindingStatus?: string;
    documentConflictKind?: string;
    hasPendingInteraction?: boolean;
    hasAgentHandoff?: boolean;
}

export interface StageIncompleteGap {
    stage?: string;
    missingOutcomes: string[];
    reason?: string;
}

export interface StageIncompleteRecoveryDecision {
    disposition: 'retry_model' | 'defer_to_structural_owner' | 'escalate';
    /** true = 把缺口推回模型继续做；false = 交给结构 owner 或普通补做已耗尽。 */
    shouldRetry: boolean;
    /** 仅普通补做耗尽时为 true；结构性等待不是失败升级。 */
    shouldEscalate: boolean;
    /** 结构性状态不占用通用补做次数，调用方不得递增恢复账本。 */
    countsAsRecoveryAttempt: boolean;
    attempt: number;
    maxAttempts: number;
    /** 推回给模型的指令；shouldRetry 为 false 时为空字符串。 */
    modelDirective: string;
    /** 交回用户时的说明；shouldRetry 为 true 时为空字符串。 */
    escalationMessage: string;
    /** 结构状态已有专属 owner 时的人类可读说明；不包含 Runtime/TaskRun/Provider 等术语。 */
    deferredMessage: string;
    /** 结构化缺口，用于 run record 审计（不含模型原文与工具载荷）。 */
    gap: StageIncompleteGap;
    structuralBlockerCode?: StageIncompleteStructuralBlockerCode;
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

function resolveStructuralBlocker(
    state: StageIncompleteRuntimeStateInput | undefined
): StageIncompleteStructuralBlockerCode | undefined {
    if (!state) return undefined;
    if (state.hasPendingInteraction === true) return 'pending_interaction';
    if (state.taskRunStatus === 'waiting_user') return 'waiting_user';
    if (state.taskRunStatus === 'writer_conflict'
        || state.documentConflictKind === 'writer_conflict') {
        return 'writer_conflict';
    }
    if (state.taskRunStatus === 'needs_reobserve'
        || state.documentBindingStatus === 'needs_reobserve'
        || state.documentConflictKind === 'document_changed'
        || state.documentConflictKind === 'external_revision_changed'
        || state.documentConflictKind === 'operation_state_unknown') {
        return 'needs_reobserve';
    }
    if (state.hasAgentHandoff === true) return 'agent_handoff';
    return undefined;
}

function buildStructuralDeferMessage(code: StageIncompleteStructuralBlockerCode): string {
    switch (code) {
        case 'waiting_user':
        case 'pending_interaction':
            return '我正在等待你的确认；收到后会从原来的位置继续，不会重新做一遍。';
        case 'writer_conflict':
            return '当前画面仍由另一项正在进行的任务处理；我没有启动第二次写入，避免重复修改。';
        case 'needs_reobserve':
            return '当前画面已经变化；继续前会先以最新画面为准，不会沿用旧版本修改。';
        case 'agent_handoff':
            return '前一步已经把后续处理交回当前任务；这轮没有重复执行旧动作，当前进度已保留。';
    }
}

/**
 * 决定「阶段未完成」这次该推回还是升级。
 *
 * attempt 从 1 开始计数，表示这是第几次遇到该判定（含本次）。
 */
export function decideStageIncompleteRecovery(input: {
    obligation: StageIncompleteObligation;
    stageState?: StageIncompleteStageStateInput;
    runtimeState?: StageIncompleteRuntimeStateInput;
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
    const structuralBlockerCode = resolveStructuralBlocker(input.runtimeState);
    const shouldRetry = attempt <= maxAttempts;
    const boundaries = {
        decisionOnly: true,
        doesNotAdvanceStage: true,
        doesNotGrantPermission: true
    } as const;

    if (structuralBlockerCode) {
        return {
            disposition: 'defer_to_structural_owner',
            shouldRetry: false,
            shouldEscalate: false,
            countsAsRecoveryAttempt: false,
            attempt,
            maxAttempts,
            modelDirective: '',
            escalationMessage: '',
            deferredMessage: buildStructuralDeferMessage(structuralBlockerCode),
            gap,
            structuralBlockerCode,
            boundaries
        };
    }

    if (shouldRetry) {
        return {
            disposition: 'retry_model',
            shouldRetry: true,
            shouldEscalate: false,
            countsAsRecoveryAttempt: true,
            attempt,
            maxAttempts,
            modelDirective: [
                `还不能收尾：${obligationText}。`,
                gapText ? `${gapText}。` : '',
                '请继续把它做完：要么执行还缺的那一步，要么说明为什么它已经被此前的结果满足；',
                '如果确实缺少只有用户能提供的信息，就把问题一次问清楚，不要重复同样的动作。'
            ].filter(Boolean).join(''),
            escalationMessage: '',
            deferredMessage: '',
            gap,
            boundaries
        };
    }

    return {
        disposition: 'escalate',
        shouldRetry: false,
        shouldEscalate: true,
        countsAsRecoveryAttempt: false,
        attempt,
        maxAttempts,
        modelDirective: '',
        escalationMessage: [
            '这稿我没能做完，先交回给你。',
            gapText ? `卡在这里：${gapText}。` : '卡在阶段结果没有达成。',
            `我已经尝试补做 ${maxAttempts} 次仍未通过，继续重试只会空转。`,
            '你可以补充缺少的信息、调整要求，或让我从这里接着做。'
        ].join(''),
        deferredMessage: '',
        gap,
        boundaries
    };
}
