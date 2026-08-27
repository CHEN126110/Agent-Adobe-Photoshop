/**
 * 尝试级失败必须保留在 Tool / Run Record 中，但不能永远污染任务终态。
 *
 * 只有同一运行已经取得完整任务契约、质量裁决和 Skill 终态时，才允许最终证据
 * 取代更早的失败尝试。这里不理解主图、详情页、SKU 或具体 Tool，也不根据文案
 * 猜“做完了”；它只消费现有 Completion / Verdict 的结构化结论。
 */

export interface AgentAttemptSignalCounts {
    failedToolCalls: number;
    acceptanceFailed: number;
    acceptanceNeedsReview: number;
    noDocumentChangeRisks: number;
}

export interface AgentFinalOutcomeSignalProjection {
    attempt: AgentAttemptSignalCounts;
    completionBlocking: AgentAttemptSignalCounts;
    supersededByVerifiedTerminalEvidence: boolean;
}

export function projectAgentFinalOutcomeSignals(input: {
    stopReason: string;
    taskCompletionStatus?: string;
    designVerdictDeliverable?: boolean;
    designQualityHardBlocked?: boolean;
    terminalSkillOutcomeFailed?: boolean;
    terminalSkillOutcomeUnverified?: boolean;
    attempt: AgentAttemptSignalCounts;
}): AgentFinalOutcomeSignalProjection {
    const attempt = normalizeCounts(input.attempt);
    const terminalResponse = input.stopReason === 'final_response'
        || input.stopReason === 'tool_budget_final_response'
        || input.stopReason === 'empty_final_response';
    const designVerdictAllowsCompletion = input.designVerdictDeliverable !== false;
    const verifiedTerminalEvidence = terminalResponse
        && input.taskCompletionStatus === 'completed'
        && designVerdictAllowsCompletion
        && input.designQualityHardBlocked !== true
        && input.terminalSkillOutcomeFailed !== true
        && input.terminalSkillOutcomeUnverified !== true;

    return {
        attempt,
        completionBlocking: verifiedTerminalEvidence ? emptyCounts() : attempt,
        supersededByVerifiedTerminalEvidence: verifiedTerminalEvidence
            && Object.values(attempt).some((value) => value > 0)
    };
}

function normalizeCounts(input: AgentAttemptSignalCounts): AgentAttemptSignalCounts {
    return {
        failedToolCalls: normalizeCount(input.failedToolCalls),
        acceptanceFailed: normalizeCount(input.acceptanceFailed),
        acceptanceNeedsReview: normalizeCount(input.acceptanceNeedsReview),
        noDocumentChangeRisks: normalizeCount(input.noDocumentChangeRisks)
    };
}

function normalizeCount(value: number): number {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function emptyCounts(): AgentAttemptSignalCounts {
    return {
        failedToolCalls: 0,
        acceptanceFailed: 0,
        acceptanceNeedsReview: 0,
        noDocumentChangeRisks: 0
    };
}
