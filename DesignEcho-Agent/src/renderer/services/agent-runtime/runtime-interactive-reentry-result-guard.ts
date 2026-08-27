import { evaluateRepeatedInteractionDecision } from '../../../shared/agent-interaction-owner-policy';
import {
    hasRuntimeInteractiveReentryProgress,
    type RuntimeInteractiveReentry
} from '../../../shared/agent-runtime-v5/runtime-interactive-reentry';
import type { RuntimeSession } from '../../../shared/agent-runtime-v5/runtime-session';
import { resolvePendingInteractiveContinuationLeaf } from '../../../shared/pending-interactive-continuation';
import { readSkillExecutionEffectReceipt } from '../../../shared/skill-execution-effect';
import { getSkillById } from '../../../shared/skills/skill-declarations';

export interface GuardRuntimeInteractiveReentryResultInput {
    workflowToolName: string;
    result: any;
    reentry?: RuntimeInteractiveReentry;
    session?: RuntimeSession;
}

/**
 * 同一 TaskRun 的交互复入守卫。这里只比较 Skill 签发的决定身份与 Runtime 的真实
 * 进展，不解释任何领域字段，也不替 Agent 选择下一步。
 */
export function guardRuntimeInteractiveReentryResult(
    input: GuardRuntimeInteractiveReentryResultInput
): any {
    const previousDecision = input.reentry?.confirmedSubmission.decisionContext;
    if (!input.reentry
        || input.workflowToolName !== input.reentry.workflowToolName
        || !getSkillById(input.workflowToolName)
        || !previousDecision?.decisionFingerprint) {
        return input.result;
    }

    let continuation;
    try {
        continuation = resolvePendingInteractiveContinuationLeaf(input.result);
    } catch (error) {
        return {
            success: false,
            policyGate: true,
            code: 'interactive_reentry_continuation_invalid',
            error: error instanceof Error
                ? error.message
                : '工作流返回的下一张确认卡无法绑定原任务。',
            countsAsTaskProgress: false
        };
    }
    if (!continuation) return input.result;

    const receipt = readSkillExecutionEffectReceipt(input.result);
    if (!receipt || receipt.effect === 'unknown') {
        const message = '工作流在再次请求确认前没有提供可核实的执行结果；请先核对当前环境并重新规划，不要继续向用户提问。';
        return {
            success: false,
            policyGate: true,
            code: 'interactive_reentry_effect_unverified',
            message,
            error: message,
            countsAsTaskProgress: false
        };
    }

    const runtimeHasProgress = hasRuntimeInteractiveReentryProgress({
        reentry: input.reentry,
        session: input.session
    });
    const repeatedDecision = evaluateRepeatedInteractionDecision({
        previousDecisionFingerprint: previousDecision.decisionFingerprint,
        previousAnswerFingerprint: previousDecision.answerFingerprint,
        nextDecisionFingerprint: continuation.card.decisionFingerprint,
        nextCandidateFingerprint: continuation.card.candidateFingerprint,
        skillEffect: runtimeHasProgress ? 'applied' : receipt.effect,
        mutationCount: runtimeHasProgress ? 1 : receipt.mutationCount,
        revisionCount: runtimeHasProgress ? 1 : receipt.revisions.length
    });
    if (repeatedDecision.status === 'allowed') return input.result;

    const message = '用户刚确认的决定还没有被工作流消费，工作流又提出了同一个问题；请使用已确认答案继续，或重新规划其它可执行路线。';
    return {
        success: false,
        policyGate: true,
        code: repeatedDecision.code,
        message,
        error: message,
        countsAsTaskProgress: false
    };
}
