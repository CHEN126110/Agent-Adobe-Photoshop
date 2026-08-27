import { projectAgentActionDisposition } from '../../../shared/agent-action-disposition';
import { getSkillById } from '../../../shared/skills/skill-declarations';
import type { AgentToolCallLogEntry } from './types';

export interface AgentActionEventProjection {
    titlePrefix: string;
    status: 'success' | 'running' | 'error';
    issue?: string;
    userVisible: boolean;
    countsAsUnresolvedFailure: boolean;
    failureDisposition?: AgentToolCallLogEntry['failureDisposition'];
}

/**
 * 把动作语义投影成过程事件；不判断整个任务是否完成。
 * 失败尝试、Workflow 交接和等待确认都保留在 Debug，避免过程 UI 抢先宣判终态。
 */
export function buildAgentActionEventProjection(input: {
    toolName: string;
    result: unknown;
    isInternalControl: boolean;
    isRuntimeDeclarationDeferred: boolean;
    hasPendingInteractiveConfirmation: boolean;
}): AgentActionEventProjection {
    const action = projectAgentActionDisposition({
        result: input.result,
        isSkill: Boolean(getSkillById(input.toolName)),
        isInternalControl: input.isInternalControl,
        hasPendingInteractiveConfirmation: input.hasPendingInteractiveConfirmation
    });

    if (action.disposition === 'completed') {
        return {
            titlePrefix: '完成',
            status: 'success',
            userVisible: !input.isInternalControl,
            countsAsUnresolvedFailure: false,
            ...(input.isRuntimeDeclarationDeferred
                ? { failureDisposition: 'control_turn_deferred' as const }
                : {})
        };
    }
    if (action.disposition === 'handoff') {
        return {
            titlePrefix: '继续处理',
            status: 'running',
            issue: 'workflow_handoff',
            userVisible: false,
            countsAsUnresolvedFailure: false,
            failureDisposition: input.isRuntimeDeclarationDeferred
                ? 'control_turn_deferred'
                : 'workflow_handoff'
        };
    }
    if (action.disposition === 'awaiting_user') {
        return {
            titlePrefix: '等待确认',
            status: 'running',
            issue: 'awaiting_user_confirmation',
            userVisible: false,
            countsAsUnresolvedFailure: false,
            failureDisposition: 'awaiting_user'
        };
    }
    if (action.disposition === 'cancelled') {
        return {
            titlePrefix: '已取消',
            status: 'error',
            issue: 'cancelled',
            userVisible: false,
            countsAsUnresolvedFailure: false
        };
    }
    return {
        titlePrefix: '失败',
        status: 'error',
        issue: 'tool_attempt_failed',
        userVisible: false,
        countsAsUnresolvedFailure: action.countsAsUnresolvedFailure
    };
}
