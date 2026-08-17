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

function isCompletionQuestionClause(clause: string): boolean {
    return /^(?:是否|是不是|有没有|能否|能不能|为什么|为何|怎么|如何)/u.test(clause)
        || /(?:完成|做完|做好|制作完成|处理完成|执行完成|交付完成|搞定|处理完毕)[^。！!]{0,8}(?:吗|嘛|么|呢|[?？])$/u.test(clause);
}

function isResultFreeReviewWrapperClause(clause: string): boolean {
    const normalized = clause.trim().toLowerCase();
    if (!normalized || normalized.length > 40) return false;
    if (/^(?:ok|好的|谢谢)$/iu.test(normalized)) return true;
    if (/^效果(?:很好|不错|可以)$/u.test(normalized)) return true;
    if (/^(?:效果|结果)?(?:如下|见上方|见下方)$/u.test(normalized)) return true;
    if (!/(?:查看|看|查收|确认|验收|审阅|检查|过目|详见|可见)/u.test(normalized)) return false;
    // 路径、编号、数值、冒号后的清单和引号内内容都可能是可核对结果，不能当成
    // 纯礼貌包装删除。其余部分按“称呼/礼貌 + 验收动作 + 语气”组合消去，避免
    // 为“您可以查看 / 看看吧 / 请审阅”等开放表达逐句维护白名单。
    if (/(?:https?:\/\/|[a-z]:[\\/]|[:：]|\d|["“”'‘’「」『』《》])/iu.test(normalized)) {
        return false;
    }
    const residue = normalized
        .replace(/(?:麻烦|请|供|给|您|你|已经|已|可以|可|等待|等|待|详见|见|上方|下方|如下)/gu, '')
        .replace(/(?:查看|看一下|看下|看看|看|查收|确认|验收|审阅|检查|过目)/gu, '')
        .replace(/(?:一下|下|结果|效果|成品|这版|它|没问题|很好|不错|可以|好不好|好吗|行吗|吧|了|呢|嘛|么)/gu, '')
        .replace(/[?？\s]/gu, '');
    return residue.length === 0;
}

/**
 * 只识别“没有正文、只有完成宣称”的终局回复。
 *
 * 这是结果真实性判据，不从用户文本猜任务品类，也不要求未知任务必须调用 Tool。
 * 完整的文字交付可以正常收尾；只有一句“已完成”不能在零交付动作时冒充结果。
 */
export function isBareAgentCompletionClaim(value: unknown): boolean {
    const text = String(value ?? '')
        .trim()
        .replace(/[。.!！\s]+$/gu, '')
        .trim();
    if (!text || text.length > 96) return false;
    if (/^(?:好了|可以了)$/u.test(text)) return false;
    if (/(?:未|并未|尚未|还没|没(?:有)?|无法|不能|不算)\s*(?:全部\s*)?(?:完成|做完|做好|制作完成|处理完成|执行完成|交付完成|搞定|处理完毕)/u.test(text)) {
        return false;
    }
    const clauses = text
        .split(/[，,。；;：:！!\n]+/u)
        .map((clause) => clause.trim())
        .filter(Boolean);
    const completionClausePattern = /^(?:[\p{L}\p{N}_·\-—“”"'《》]{0,24}\s*)?(?:(?:已|已经)\s*)?(?:(?:全部|都)\s*)?(?:完成(?:了|啦)?|做完(?:了|啦)?|做好(?:了|啦)?|弄好(?:了|啦)?|处理完成|制作完成|执行完成|交付完成|检查完成|检查完(?:了|啦)?|检查(?:好|结束|搞定|完工)(?:了|啦|咯)?|完成检查|完成并验证|完成并(?:已)?交付|处理好了|搞定(?:了|啦)?|处理完(?:了|啦|毕)?|大功告成)$/u;
    const actorFirstCompletionPattern = /^(?:我\s*)?(?:已|已经)\s*(?:完成|做完|做好|处理完)(?:了|啦)?\s*[\p{L}\p{N}_·\-—“”"'《》]{1,24}$/u;
    const completionIndexes = clauses
        .map((clause, index) => (
            !isCompletionQuestionClause(clause)
            && !/(?:只是|示例|假设|如果|据说|转述|引用|别人说|他说|她说)[^。！？!?；;]{0,24}(?:完成|做完|做好|搞定)/u.test(clause)
            && (
                completionClausePattern.test(clause)
                || actorFirstCompletionPattern.test(clause)
                || /^(?:done|completed)$/iu.test(clause)
            )
                ? index
                : -1
        ))
        .filter((index) => index >= 0);
    if (completionIndexes.length === 0) return false;
    const completionIndexSet = new Set(completionIndexes);
    return clauses.every((clause, index) => (
        completionIndexSet.has(index) || isResultFreeReviewWrapperClause(clause)
    ));
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
