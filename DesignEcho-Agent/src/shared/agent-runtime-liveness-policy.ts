export type AgentRuntimeLivenessIncident =
    | 'loop_guard'
    | 'unfinished_obligation'
    | 'tool_preflight'
    | 'runtime_error'
    | 'budget_exhausted';

export type AgentRuntimeLivenessDecision =
    | {
        kind: 'continue';
        reason: 'mutation_readback' | 'pending_recovery' | 'alternative_capability';
    }
    | {
        kind: 'suspend';
        reason: 'user_owned_input';
    }
    | {
        kind: 'finish';
        reason: 'completion_satisfied';
    }
    | {
        kind: 'checkpoint';
        reason: 'budget_exhausted';
    }
    | {
        kind: 'abort';
        reason: 'cancelled' | 'safety_boundary' | 'no_recovery_path';
    };

export interface AgentRuntimeLivenessInput {
    incident: AgentRuntimeLivenessIncident;
    cancelled?: boolean;
    safetyBoundaryBlocked?: boolean;
    userOwnedInputRequired?: boolean;
    completionSatisfied?: boolean;
    unfinishedObligation?: boolean;
    budgetExhausted?: boolean;
    unknownMutationRequiresReadback?: boolean;
    pendingRecoveryActionCount?: number;
    alternativeCapabilityCount?: number;
    recoveryAttempts?: number;
    maxRecoveryAttempts?: number;
}

export interface AgentRuntimeProgressKeyInput {
    currentStage?: string;
    taskRunStatus?: string;
    planRevision?: number;
    currentNodeId?: string;
    documentBinding?: {
        documentId: number;
        expectedHistoryStateId: number;
        status: string;
        observedDocumentId?: number;
        observedHistoryStateId?: number;
    };
    operationResultCount?: number;
    novelFactCount?: number;
    maxNovelFactProgressCredits: number;
    inputProgressProjection?: readonly string[];
    observedOutcomes?: readonly string[];
}

/**
 * TaskRun 活性进展的稳定指纹。
 *
 * 只记录阶段、计划节点、目标 revision、真实操作、已解决输入和有界新事实；
 * 工具调用次数、缓存命中和同一事实的不同读取方式都不能刷新活性预算。
 */
export function buildAgentRuntimeProgressKey(input: AgentRuntimeProgressKeyInput): string {
    const maxFactCredits = Math.max(0, Math.floor(input.maxNovelFactProgressCredits || 0));
    const factCredits = Math.min(
        Math.max(0, Math.floor(input.novelFactCount || 0)),
        maxFactCredits
    );
    const observedTarget = input.documentBinding?.observedDocumentId
        && input.documentBinding?.observedHistoryStateId
        ? `~observed=${input.documentBinding.observedDocumentId}@${input.documentBinding.observedHistoryStateId}`
        : '';
    const documentTarget = input.documentBinding
        ? `${input.documentBinding.documentId}@${input.documentBinding.expectedHistoryStateId}:${input.documentBinding.status}${observedTarget}`
        : 'unbound';
    const inputProgress = Array.from(new Set(
        (input.inputProgressProjection || []).map((value) => String(value || '').trim()).filter(Boolean)
    )).sort();
    const observedOutcomes = Array.from(new Set(
        (input.observedOutcomes || []).map((value) => String(value || '').trim()).filter(Boolean)
    )).sort();
    return [
        String(input.currentStage || 'none'),
        `task=${String(input.taskRunStatus || 'unknown')}:${Math.max(0, Math.floor(input.planRevision || 0))}:${String(input.currentNodeId || 'none')}`,
        `target=${documentTarget}`,
        `operations=${Math.max(0, Math.floor(input.operationResultCount || 0))}`,
        `facts=${factCredits}`,
        ...inputProgress,
        ...observedOutcomes
    ].join(':');
}

export function buildUnfinishedContinuationKey(input: {
    obligation: string;
    runtimeProgressKey: string;
}): string {
    return `${String(input.obligation || '').trim()}|${String(input.runtimeProgressKey || '').trim()}`;
}

/**
 * Agent 运行期唯一的“继续 / 等待 / 收尾 / 终止”优先级。
 *
 * 该纯逻辑函数不执行 Tool、不授予权限、不推进 Runtime Stage，也不声明任务完成；
 * 调用方仍必须通过 Manifest、Tool Decision、Preflight 与 Photoshop 写入边界。
 */
export function decideAgentRuntimeLiveness(
    input: AgentRuntimeLivenessInput
): AgentRuntimeLivenessDecision {
    if (input.cancelled) {
        return { kind: 'abort', reason: 'cancelled' };
    }
    if (input.safetyBoundaryBlocked) {
        return { kind: 'abort', reason: 'safety_boundary' };
    }
    if (input.userOwnedInputRequired) {
        return { kind: 'suspend', reason: 'user_owned_input' };
    }
    if (input.budgetExhausted) {
        return { kind: 'checkpoint', reason: 'budget_exhausted' };
    }
    if (input.completionSatisfied && !input.unfinishedObligation) {
        return { kind: 'finish', reason: 'completion_satisfied' };
    }

    const recoveryAttempts = Math.max(0, Math.floor(input.recoveryAttempts || 0));
    const maxRecoveryAttempts = Math.max(0, Math.floor(input.maxRecoveryAttempts || 0));
    const hasRecoveryCapacity = recoveryAttempts < maxRecoveryAttempts;
    if (input.unknownMutationRequiresReadback
        && (input.pendingRecoveryActionCount || 0) > 0
        && hasRecoveryCapacity) {
        return { kind: 'continue', reason: 'mutation_readback' };
    }
    if ((input.pendingRecoveryActionCount || 0) > 0 && hasRecoveryCapacity) {
        return { kind: 'continue', reason: 'pending_recovery' };
    }
    if ((input.alternativeCapabilityCount || 0) > 0 && hasRecoveryCapacity) {
        return { kind: 'continue', reason: 'alternative_capability' };
    }
    return { kind: 'abort', reason: 'no_recovery_path' };
}
