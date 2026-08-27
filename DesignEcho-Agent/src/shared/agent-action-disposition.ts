/**
 * 单次 Tool / Skill 结果的控制语义投影。
 *
 * 原始 `success` 只描述这一次调用是否返回成功，不能同时承担“等待用户”、
 * “交回 Agent 继续处理”和“整个任务终止失败”三种语义。这里仅判断当前动作如何
 * 进入 Agent 循环；任务终态仍由 TaskCompletion / DesignVerdict / Delivery 收据决定。
 */

import { resolveSkillExecutionOutcome } from './agent-react-observation-contract';

export type AgentActionDisposition =
    | 'completed'
    | 'handoff'
    | 'awaiting_user'
    | 'recoverable_failure'
    | 'cancelled';

export interface AgentActionDispositionProjection {
    disposition: AgentActionDisposition;
    /** 过程区只展示已经完成的真实动作；控制交接和尝试失败保留在 Debug / Run Record。 */
    userVisible: boolean;
    countsAsUnresolvedFailure: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return value as Record<string, unknown>;
}

function hasStructuredAgentHandoff(result: Record<string, unknown>): boolean {
    const data = asRecord(result.data);
    const continuation = asRecord(data?.agentReActContinuation);
    const observation = asRecord(data?.agentReActObservation);
    const nextAction = String(observation?.nextAction || continuation?.nextAction || '').trim();
    const continuationStatus = String(continuation?.status || '').trim();
    return result.nonFatal === true
        || Boolean(continuation && (
            continuationStatus === 'needs_decision'
            || continuationStatus === 'needs_repair'
            || continuationStatus === 'blocked'
        ))
        || nextAction === 'decide_next'
        || nextAction === 'repair';
}

export function projectAgentActionDisposition(input: {
    result: unknown;
    isSkill: boolean;
    isInternalControl?: boolean;
    hasPendingInteractiveConfirmation?: boolean;
}): AgentActionDispositionProjection {
    const result = asRecord(input.result) || {};
    if (result.cancelled === true) {
        return {
            disposition: 'cancelled',
            userVisible: false,
            countsAsUnresolvedFailure: false
        };
    }

    if (input.hasPendingInteractiveConfirmation === true) {
        return {
            disposition: 'awaiting_user',
            userVisible: false,
            countsAsUnresolvedFailure: false
        };
    }

    if (input.isInternalControl === true || result.nonFatal === true) {
        return {
            disposition: 'handoff',
            userVisible: false,
            countsAsUnresolvedFailure: false
        };
    }

    if (input.isSkill) {
        const outcome = resolveSkillExecutionOutcome(result);
        if (outcome.status === 'awaiting_confirmation') {
            return {
                disposition: 'awaiting_user',
                userVisible: false,
                countsAsUnresolvedFailure: false
            };
        }
        if ((outcome.status === 'executed'
            || outcome.status === 'partial'
            || outcome.status === 'needs_review')
            && hasStructuredAgentHandoff(result)) {
            return {
                disposition: 'handoff',
                userVisible: false,
                countsAsUnresolvedFailure: false
            };
        }
        if (outcome.status === 'partial'
            || outcome.status === 'needs_review'
            || outcome.status === 'blocked'
            || outcome.status === 'failed') {
            return {
                disposition: 'recoverable_failure',
                userVisible: false,
                countsAsUnresolvedFailure: true
            };
        }
    }

    if (result.success !== false) {
        return {
            disposition: 'completed',
            userVisible: true,
            countsAsUnresolvedFailure: false
        };
    }

    return {
        disposition: 'recoverable_failure',
        userVisible: false,
        countsAsUnresolvedFailure: true
    };
}
