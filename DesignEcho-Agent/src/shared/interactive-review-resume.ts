/**
 * 已落盘的确定性人工复核卡承接策略。
 *
 * 只允许来源消息明确处于 awaiting_confirmation 时恢复原任务；
 * 普通独立复核卡仍然只记录，不会凭卡片点击擅自启动 Agent。
 */

export interface InteractiveReviewResumeMessageLike {
    id?: string;
    role?: 'user' | 'assistant';
    content?: string;
    executionSummary?: {
        status?: string;
    };
    pendingInteractiveContinuation?: {
        sourceTask?: string;
    };
    agentTaskPlanPresentation?: {
        identity?: {
            sessionId?: string;
            runId?: string;
            generation?: number;
        };
    };
}

export interface InteractiveReviewResumeContext {
    sourceMessageId: string;
    sourceTask: string;
    sourceRuntimeIdentity?: AgentInternalResumeRuntimeIdentity;
}

export const AGENT_INTERNAL_RESUME_VERSION = 'agent-internal-resume/v0' as const;

export type AgentInternalResumeKind =
    | 'review_recorded'
    | 'destructive_action_executed'
    | 'destructive_action_cancelled'
    | 'destructive_action_failed';

export interface AgentInternalResumeRuntimeIdentity {
    sessionId: string;
    runId: string;
    generation: number;
}

export interface AgentInternalResumeRequest {
    version: typeof AGENT_INTERNAL_RESUME_VERSION;
    kind: AgentInternalResumeKind;
    sourceMessageId: string;
    sourceTask: string;
    resolutionSummary: string;
    scope: {
        conversationId: string;
        projectId?: string;
        projectPath?: string;
    };
    sourceRuntimeIdentity?: AgentInternalResumeRuntimeIdentity;
}

export type AgentInternalResumeResolution =
    | {
        status: 'ready';
        request: AgentInternalResumeRequest;
    }
    | {
        status: 'rejected';
        code:
            | 'invalid_request'
            | 'conversation_scope_mismatch'
            | 'project_scope_mismatch'
            | 'source_message_missing';
        message: string;
    };

const MAX_RESUME_TASK_LENGTH = 2000;
const MAX_RESOLUTION_SUMMARY_LENGTH = 600;

function cleanResumeTask(value: unknown): string {
    return String(value || '').trim().slice(0, MAX_RESUME_TASK_LENGTH);
}

function cleanScopeValue(value: unknown): string {
    return String(value || '').trim();
}

function normalizeRuntimeIdentity(
    value: InteractiveReviewResumeMessageLike['agentTaskPlanPresentation']
): AgentInternalResumeRuntimeIdentity | undefined {
    const identity = value?.identity;
    const sessionId = cleanScopeValue(identity?.sessionId);
    const runId = cleanScopeValue(identity?.runId);
    const generation = Number(identity?.generation);
    if (!sessionId || !runId || !Number.isInteger(generation) || generation < 0) return undefined;
    return { sessionId, runId, generation };
}

export function resolveInteractiveReviewResumeContext(input: {
    messages: readonly InteractiveReviewResumeMessageLike[];
    sourceMessageId: string;
}): InteractiveReviewResumeContext | undefined {
    const sourceMessageId = String(input.sourceMessageId || '').trim();
    if (!sourceMessageId) return undefined;
    const sourceIndex = input.messages.findIndex((message) => message.id === sourceMessageId);
    if (sourceIndex < 0) return undefined;
    const sourceMessage = input.messages[sourceIndex];
    if (
        sourceMessage.role !== 'assistant'
        || sourceMessage.executionSummary?.status !== 'awaiting_confirmation'
    ) {
        return undefined;
    }
    const ownedSourceTask = cleanResumeTask(sourceMessage.pendingInteractiveContinuation?.sourceTask);
    const sourceRuntimeIdentity = normalizeRuntimeIdentity(sourceMessage.agentTaskPlanPresentation);
    if (ownedSourceTask) {
        return {
            sourceMessageId,
            sourceTask: ownedSourceTask,
            ...(sourceRuntimeIdentity ? { sourceRuntimeIdentity } : {})
        };
    }
    for (let index = sourceIndex - 1; index >= 0; index -= 1) {
        const message = input.messages[index];
        if (message.role !== 'user') continue;
        const sourceTask = cleanResumeTask(message.content);
        if (sourceTask) {
            return {
                sourceMessageId,
                sourceTask,
                ...(sourceRuntimeIdentity ? { sourceRuntimeIdentity } : {})
            };
        }
    }
    return undefined;
}

export function buildAgentInternalResumeRequest(input: {
    kind: AgentInternalResumeKind;
    sourceMessageId: string;
    sourceTask: string;
    resolutionSummary: string;
    conversationId: string;
    projectId?: string;
    projectPath?: string;
    sourceRuntimeIdentity?: AgentInternalResumeRuntimeIdentity;
}): AgentInternalResumeRequest | undefined {
    const sourceMessageId = cleanScopeValue(input.sourceMessageId);
    const sourceTask = cleanResumeTask(input.sourceTask);
    const resolutionSummary = String(input.resolutionSummary || '')
        .trim()
        .slice(0, MAX_RESOLUTION_SUMMARY_LENGTH);
    const conversationId = cleanScopeValue(input.conversationId);
    if (!sourceMessageId || !sourceTask || !resolutionSummary || !conversationId) return undefined;
    return {
        version: AGENT_INTERNAL_RESUME_VERSION,
        kind: input.kind,
        sourceMessageId,
        sourceTask,
        resolutionSummary,
        scope: {
            conversationId,
            ...(cleanScopeValue(input.projectId) ? { projectId: cleanScopeValue(input.projectId) } : {}),
            ...(cleanScopeValue(input.projectPath) ? { projectPath: cleanScopeValue(input.projectPath) } : {})
        },
        ...(input.sourceRuntimeIdentity ? { sourceRuntimeIdentity: input.sourceRuntimeIdentity } : {})
    };
}

export function resolveAgentInternalResumeRequest(input: {
    request: AgentInternalResumeRequest;
    conversationId?: string;
    projectId?: string;
    projectPath?: string;
    conversationHistory?: ReadonlyArray<{ id?: unknown }>;
}): AgentInternalResumeResolution {
    const request = input.request;
    if (
        request?.version !== AGENT_INTERNAL_RESUME_VERSION
        || !cleanScopeValue(request.sourceMessageId)
        || !cleanResumeTask(request.sourceTask)
        || !cleanScopeValue(request.resolutionSummary)
        || !cleanScopeValue(request.scope?.conversationId)
    ) {
        return {
            status: 'rejected',
            code: 'invalid_request',
            message: '确认后的续跑请求不完整，本轮不会启动。请回到原任务重新确认。'
        };
    }
    if (cleanScopeValue(input.conversationId) !== cleanScopeValue(request.scope.conversationId)) {
        return {
            status: 'rejected',
            code: 'conversation_scope_mismatch',
            message: '确认卡所属对话已经切换，本轮不会启动。请返回原对话后再次确认。'
        };
    }
    const expectedProjectId = cleanScopeValue(request.scope.projectId);
    if (expectedProjectId && expectedProjectId !== cleanScopeValue(input.projectId)) {
        return {
            status: 'rejected',
            code: 'project_scope_mismatch',
            message: '确认卡所属项目已经切换，本轮不会启动。请返回原项目后再次确认。'
        };
    }
    const expectedProjectPath = cleanScopeValue(request.scope.projectPath).toLowerCase();
    if (expectedProjectPath && expectedProjectPath !== cleanScopeValue(input.projectPath).toLowerCase()) {
        return {
            status: 'rejected',
            code: 'project_scope_mismatch',
            message: '确认卡所属项目目录已经变化，本轮不会启动。请返回原项目后再次确认。'
        };
    }
    if (
        Array.isArray(input.conversationHistory)
        && !input.conversationHistory.some((message) => cleanScopeValue(message.id) === request.sourceMessageId)
    ) {
        return {
            status: 'rejected',
            code: 'source_message_missing',
            message: '原等待消息已不在当前对话中，本轮不会启动。请重新发送原任务。'
        };
    }
    return { status: 'ready', request };
}

export function buildInteractiveReviewResumeTask(sourceTask: string, reviewLabel: string): string {
    const task = cleanResumeTask(sourceTask);
    const label = String(reviewLabel || '').trim() || '人工复核';
    if (!task) return '';
    return [
        task,
        `（用户已完成${label}，结论已写入对应状态。请读取最新状态，从确认点继续执行；不要重复创建同一张确认卡。）`
    ].join('\n\n');
}
