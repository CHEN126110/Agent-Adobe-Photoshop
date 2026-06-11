import type { AgentTaskPlanningContract } from './agent-task-planning-contract';
import type {
    AgentTaskPublicPlanExecutionPlanLike,
    AgentTaskPublicPlanExecutionRequest
} from './agent-task-public-plan-execution-request';

export type AgentTaskPublicPlanApprovalRecordVersion = 'agent-task-public-plan-approval-record/v0';

export type AgentTaskPublicPlanApprovalRecordStatus =
    | 'not_requested'
    | 'blocked_no_pending_public_plan'
    | 'blocked_pending_request_not_confirmable'
    | 'approved_controlled_execution_request';

export interface AgentTaskPublicPlanApprovalRecord {
    version: AgentTaskPublicPlanApprovalRecordVersion;
    status: AgentTaskPublicPlanApprovalRecordStatus;
    requested: boolean;
    sourceMessageId?: string;
    requestId?: string;
    evidenceOnly: true;
    rawPayloadRedacted: true;
    mustNotRunProvider: true;
    mustNotRunPhotoshop: true;
    mustNotRunWriteTools: true;
    mustNotClaimTaskCompletion: true;
    userConfirmed: boolean;
    enableControlledExecutionRequest: boolean;
    allowedWriteTools: string[];
    readbackTargets: string[];
    blockers: string[];
    warnings: string[];
    agentTaskPlan?: AgentTaskPlanningContract;
    agentTaskPublicPlan?: AgentTaskPublicPlanExecutionPlanLike;
}

export interface BuildAgentTaskPublicPlanApprovalRecordInput {
    userInput: unknown;
    conversationHistory?: Array<Record<string, unknown>>;
    sourceMessageId?: unknown;
}

function normalizeText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function sanitizeText(value: unknown, maxLength = 240): string {
    const text = normalizeText(value)
        .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/ig, '[binary-redacted]')
        .replace(/\b[A-Za-z]:[\\/][^\s;；,，]+/g, '[local-path-redacted]');
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeStringList(value: unknown, limit = 12): string[] {
    if (!Array.isArray(value)) return [];
    const output: string[] = [];
    for (const item of value) {
        const text = sanitizeText(item, 80);
        if (!text || output.includes(text)) continue;
        output.push(text);
        if (output.length >= limit) break;
    }
    return output;
}

function isPublicPlanConfirmationInput(value: unknown): boolean {
    const text = normalizeText(value);
    if (!text) return false;
    return [
        /^(确认|同意|批准|允许|开始|继续)\s*(执行|运行)?\s*(这个|该)?\s*(公开计划|设计计划|受控执行请求)[。.!！?？\s]*$/i,
        /^(按|按照)\s*(这个|该)?\s*(公开计划|设计计划)\s*(执行|继续|开始)[。.!！?？\s]*$/i,
        /^确认执行公开计划[。.!！?？\s]*$/i
    ].some((pattern) => pattern.test(text));
}

function extractObject(source: Record<string, unknown>, field: string): Record<string, unknown> | undefined {
    const direct = source[field];
    if (isPlainObject(direct)) return direct;
    const metadata = source.metadata;
    if (isPlainObject(metadata) && isPlainObject(metadata[field])) return metadata[field] as Record<string, unknown>;
    const metadataData = isPlainObject(metadata) ? metadata.data : undefined;
    if (isPlainObject(metadataData) && isPlainObject(metadataData[field])) return metadataData[field] as Record<string, unknown>;
    const data = source.data;
    if (isPlainObject(data) && isPlainObject(data[field])) return data[field] as Record<string, unknown>;
    return undefined;
}

function findLatestPendingPublicPlanMessage(history: Array<Record<string, unknown>>, sourceMessageId?: string): {
    message: Record<string, unknown>;
    request: AgentTaskPublicPlanExecutionRequest;
    agentTaskPlan?: AgentTaskPlanningContract;
} | null {
    const sourceId = normalizeText(sourceMessageId);
    if (sourceId) {
        const sourceMessage = history.find((message) => normalizeText(message?.id) === sourceId);
        if (!sourceMessage || sourceMessage.role !== 'assistant') return null;
        const sourceRequest = extractObject(sourceMessage, 'agentTaskPublicPlanExecutionRequest');
        if (sourceRequest?.version !== 'agent-task-public-plan-execution-request/v0') return null;
        if (sourceRequest.status !== 'blocked_pending_user_confirmation') return null;
        return {
            message: sourceMessage,
            request: sourceRequest as unknown as AgentTaskPublicPlanExecutionRequest,
            agentTaskPlan: extractObject(sourceMessage, 'agentTaskPlan') as unknown as AgentTaskPlanningContract | undefined
        };
    }

    for (let index = history.length - 1; index >= 0; index -= 1) {
        const message = history[index];
        if (message?.role !== 'assistant') continue;
        const request = extractObject(message, 'agentTaskPublicPlanExecutionRequest');
        if (request?.version !== 'agent-task-public-plan-execution-request/v0') continue;
        if (request.status !== 'blocked_pending_user_confirmation') continue;
        return {
            message,
            request: request as unknown as AgentTaskPublicPlanExecutionRequest,
            agentTaskPlan: extractObject(message, 'agentTaskPlan') as unknown as AgentTaskPlanningContract | undefined
        };
    }
    return null;
}

function buildRecord(
    status: AgentTaskPublicPlanApprovalRecordStatus,
    input: {
        requested: boolean;
        sourceMessageId?: string;
        requestId?: string;
        userConfirmed?: boolean;
        enableControlledExecutionRequest?: boolean;
        allowedWriteTools?: string[];
        readbackTargets?: string[];
        blockers?: string[];
        warnings?: string[];
        agentTaskPlan?: AgentTaskPlanningContract;
        agentTaskPublicPlan?: AgentTaskPublicPlanExecutionPlanLike;
    }
): AgentTaskPublicPlanApprovalRecord {
    return {
        version: 'agent-task-public-plan-approval-record/v0',
        status,
        requested: input.requested,
        sourceMessageId: input.sourceMessageId,
        requestId: input.requestId,
        evidenceOnly: true,
        rawPayloadRedacted: true,
        mustNotRunProvider: true,
        mustNotRunPhotoshop: true,
        mustNotRunWriteTools: true,
        mustNotClaimTaskCompletion: true,
        userConfirmed: input.userConfirmed === true,
        enableControlledExecutionRequest: input.enableControlledExecutionRequest === true,
        allowedWriteTools: input.allowedWriteTools || [],
        readbackTargets: input.readbackTargets || [],
        blockers: input.blockers || [],
        warnings: input.warnings || [],
        agentTaskPlan: input.agentTaskPlan,
        agentTaskPublicPlan: input.agentTaskPublicPlan
    };
}

export function buildAgentTaskPublicPlanApprovalRecord(
    input: BuildAgentTaskPublicPlanApprovalRecordInput
): AgentTaskPublicPlanApprovalRecord {
    const requested = isPublicPlanConfirmationInput(input.userInput);
    if (!requested) {
        return buildRecord('not_requested', {
            requested: false
        });
    }

    const history = Array.isArray(input.conversationHistory) ? input.conversationHistory : [];
    const pending = findLatestPendingPublicPlanMessage(history, normalizeText(input.sourceMessageId));
    if (!pending) {
        return buildRecord('blocked_no_pending_public_plan', {
            requested: true,
            blockers: ['没有找到等待确认的公开计划请求，不能只凭确认语进入执行。']
        });
    }

    const proposedWriteTools = normalizeStringList(pending.request.proposedWriteTools);
    const allowedWriteTools = normalizeStringList(pending.request.allowedWriteTools);
    const approvedWriteTools = proposedWriteTools.filter((toolName) => allowedWriteTools.includes(toolName));
    const readbackTargets = normalizeStringList(pending.request.readbackTargets);
    const blockedWriteTools = proposedWriteTools.filter((toolName) => !approvedWriteTools.includes(toolName));

    if (approvedWriteTools.length === 0 || readbackTargets.length === 0 || blockedWriteTools.length > 0) {
        return buildRecord('blocked_pending_request_not_confirmable', {
            requested: true,
            sourceMessageId: normalizeText(pending.message.id),
            requestId: pending.request.requestId,
            allowedWriteTools: approvedWriteTools,
            readbackTargets,
            blockers: [
                approvedWriteTools.length === 0 ? '公开计划没有可确认的写工具白名单。' : '',
                readbackTargets.length === 0 ? '公开计划没有执行后的读回目标。' : '',
                blockedWriteTools.length > 0 ? `公开计划包含未获批准的写工具：${blockedWriteTools.join(', ')}` : ''
            ].filter(Boolean)
        });
    }

    const firstOperationSummary = pending.request.operationRequests
        .map((item) => sanitizeText(item.paramsSummary))
        .find(Boolean);
    const approvedPublicPlan: AgentTaskPublicPlanExecutionPlanLike = {
        status: 'ready',
        canExecuteTools: false,
        message: sanitizeText(pending.request.publicPlanSummary || pending.message.content),
        proposedWriteTools: approvedWriteTools,
        writeToolAllowlist: approvedWriteTools,
        readbackTargets,
        executionPlanSummary: firstOperationSummary || '用户已确认公开计划，准备创建受控执行请求。'
    };

    return buildRecord('approved_controlled_execution_request', {
        requested: true,
        sourceMessageId: normalizeText(pending.message.id),
        requestId: pending.request.requestId || normalizeText(pending.message.id) || 'agent-task-public-plan-execution-request',
        userConfirmed: true,
        enableControlledExecutionRequest: true,
        allowedWriteTools: approvedWriteTools,
        readbackTargets,
        agentTaskPlan: pending.agentTaskPlan,
        agentTaskPublicPlan: approvedPublicPlan,
        warnings: ['确认记录只创建受控执行请求；真实 Photoshop 写入仍必须由后续受控 runner 执行。']
    });
}
