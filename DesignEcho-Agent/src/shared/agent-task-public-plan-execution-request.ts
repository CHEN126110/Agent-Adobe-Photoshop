import type { AgentTaskPlanningContract } from './agent-task-planning-contract';
import { sanitizeAgentResumePlanningValue } from './agent-resume-planning';

export type AgentTaskPublicPlanExecutionRequestVersion = 'agent-task-public-plan-execution-request/v0';

export type AgentTaskPublicPlanExecutionRequestStatus =
    | 'not_applicable'
    | 'blocked_public_plan_not_ready'
    | 'blocked_missing_write_tool_allowlist'
    | 'blocked_write_tool_not_allowed'
    | 'blocked_missing_readback_targets'
    | 'blocked_pending_user_confirmation'
    | 'blocked_execution_request_disabled'
    | 'ready_for_controlled_execution_request';

export const DEFAULT_AGENT_TASK_PUBLIC_PLAN_WRITE_TOOL_ALLOWLIST = [
    'createTextLayer',
    'setTextStyle',
    'moveLayer',
    'reorderLayer',
    'moveLayerToGroup',
    'transformLayer',
    'placeImage'
] as const;

export interface AgentTaskPublicPlanExecutionPlanLike {
    status?: string;
    canExecuteTools?: boolean;
    message?: string;
    proposedWriteTools?: string[];
    writeToolAllowlist?: string[];
    readbackTargets?: string[];
    executionPlanSummary?: string;
}

export interface AgentTaskPublicPlanControlledOperationRequest {
    operationId: string;
    toolName: string;
    params?: unknown;
    paramsSummary?: string;
    readbackTargets: string[];
}

export interface AgentTaskPublicPlanExecutionRequest {
    version: AgentTaskPublicPlanExecutionRequestVersion;
    status: AgentTaskPublicPlanExecutionRequestStatus;
    requestId?: string;
    taskPlanStatus?: AgentTaskPlanningContract['status'];
    publicPlanStatus?: string;
    evidenceOnly: true;
    rawPayloadRedacted: true;
    shouldRunPhotoshop: false;
    mustNotRunWriteTools: true;
    mustNotClaimTaskCompletion: true;
    requiresExplicitUserConfirmation: true;
    requiresWriteToolAllowlist: true;
    requiresReadbackTargets: true;
    requiresControlledRunner: true;
    requiresReadbackAfterEachWrite: true;
    userConfirmed: boolean;
    canStartControlledRunner: boolean;
    proposedWriteTools: string[];
    allowedWriteTools: string[];
    approvedWriteTools: string[];
    blockedWriteTools: string[];
    readbackTargets: string[];
    operationRequests: AgentTaskPublicPlanControlledOperationRequest[];
    publicPlanSummary?: string;
    blockers: string[];
    warnings: string[];
}

export interface BuildAgentTaskPublicPlanExecutionRequestInput {
    agentTaskPlan?: AgentTaskPlanningContract;
    publicPlan?: AgentTaskPublicPlanExecutionPlanLike;
    runtimeAllowedWriteTools?: string[];
    runtimeOperationRequests?: AgentTaskPublicPlanControlledOperationRequest[];
    userConfirmed?: boolean;
    enableControlledExecutionRequest?: boolean;
    requestId?: string;
}

function sanitizeText(value: unknown, maxLength = 240): string {
    const text = String(value || '')
        .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/ig, '[binary-redacted]')
        .replace(/\b[A-Za-z]:[\\/][^\s;；,，]+/g, '[local-path-redacted]')
        .replace(/\s+/g, ' ')
        .trim();
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
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

function resolveProposedWriteTools(publicPlan?: AgentTaskPublicPlanExecutionPlanLike): string[] {
    return normalizeStringList(
        publicPlan?.proposedWriteTools && publicPlan.proposedWriteTools.length > 0
            ? publicPlan.proposedWriteTools
            : publicPlan?.writeToolAllowlist
    );
}

function buildOperationRequests(input: {
    proposedWriteTools: string[];
    readbackTargets: string[];
    executionPlanSummary?: string;
    runtimeOperationRequests?: AgentTaskPublicPlanControlledOperationRequest[];
}): AgentTaskPublicPlanControlledOperationRequest[] {
    const runtimeOperations = normalizeRuntimeOperationRequests({
        proposedWriteTools: input.proposedWriteTools,
        readbackTargets: input.readbackTargets,
        runtimeOperationRequests: input.runtimeOperationRequests
    });
    if (runtimeOperations.length > 0) return runtimeOperations;

    return input.proposedWriteTools.map((toolName, index) => ({
        operationId: `public-plan-op-${index + 1}`,
        toolName,
        paramsSummary: input.executionPlanSummary
            ? sanitizeText(input.executionPlanSummary)
            : undefined,
        readbackTargets: [...input.readbackTargets]
    }));
}

function normalizeRuntimeOperationRequests(input: {
    proposedWriteTools: string[];
    readbackTargets: string[];
    runtimeOperationRequests?: AgentTaskPublicPlanControlledOperationRequest[];
}): AgentTaskPublicPlanControlledOperationRequest[] {
    if (!Array.isArray(input.runtimeOperationRequests)) return [];

    const allowedToolSet = new Set(input.proposedWriteTools);
    const output: AgentTaskPublicPlanControlledOperationRequest[] = [];
    for (const [index, operation] of input.runtimeOperationRequests.entries()) {
        if (!operation || typeof operation !== 'object') continue;
        const toolName = sanitizeText(operation.toolName, 80);
        if (!toolName || !allowedToolSet.has(toolName)) continue;

        const readbackTargets = normalizeStringList(operation.readbackTargets);
        output.push({
            operationId: sanitizeText(operation.operationId, 80) || `public-plan-op-${index + 1}`,
            toolName,
            params: sanitizeAgentResumePlanningValue(operation.params),
            paramsSummary: sanitizeText(operation.paramsSummary),
            readbackTargets: readbackTargets.length > 0 ? readbackTargets : [...input.readbackTargets]
        });
    }
    return output;
}

function buildRequest(input: {
    agentTaskPlan?: AgentTaskPlanningContract;
    publicPlan?: AgentTaskPublicPlanExecutionPlanLike;
    status: AgentTaskPublicPlanExecutionRequestStatus;
    requestId?: string;
    userConfirmed?: boolean;
    canStartControlledRunner?: boolean;
    proposedWriteTools?: string[];
    allowedWriteTools?: string[];
    approvedWriteTools?: string[];
    blockedWriteTools?: string[];
    readbackTargets?: string[];
    blockers?: string[];
    warnings?: string[];
    runtimeOperationRequests?: AgentTaskPublicPlanControlledOperationRequest[];
}): AgentTaskPublicPlanExecutionRequest {
    const proposedWriteTools = input.proposedWriteTools || [];
    const readbackTargets = input.readbackTargets || [];
    const canDescribeOperations =
        proposedWriteTools.length > 0
        && readbackTargets.length > 0
        && (input.blockedWriteTools || []).length === 0
        && ![
            'not_applicable',
            'blocked_public_plan_not_ready',
            'blocked_missing_write_tool_allowlist',
            'blocked_write_tool_not_allowed',
            'blocked_missing_readback_targets'
        ].includes(input.status);
    return {
        version: 'agent-task-public-plan-execution-request/v0',
        status: input.status,
        requestId: input.requestId,
        taskPlanStatus: input.agentTaskPlan?.status,
        publicPlanStatus: input.publicPlan?.status,
        evidenceOnly: true,
        rawPayloadRedacted: true,
        shouldRunPhotoshop: false,
        mustNotRunWriteTools: true,
        mustNotClaimTaskCompletion: true,
        requiresExplicitUserConfirmation: true,
        requiresWriteToolAllowlist: true,
        requiresReadbackTargets: true,
        requiresControlledRunner: true,
        requiresReadbackAfterEachWrite: true,
        userConfirmed: input.userConfirmed === true,
        canStartControlledRunner: input.canStartControlledRunner === true,
        proposedWriteTools,
        allowedWriteTools: input.allowedWriteTools || [],
        approvedWriteTools: input.approvedWriteTools || [],
        blockedWriteTools: input.blockedWriteTools || [],
        readbackTargets,
        operationRequests: canDescribeOperations
            ? buildOperationRequests({
                proposedWriteTools,
                readbackTargets,
                executionPlanSummary: input.publicPlan?.executionPlanSummary,
                runtimeOperationRequests: input.runtimeOperationRequests
            })
            : [],
        publicPlanSummary: sanitizeText(input.publicPlan?.message),
        blockers: input.blockers || [],
        warnings: input.warnings || []
    };
}

export function buildAgentTaskPublicPlanExecutionRequest(
    input: BuildAgentTaskPublicPlanExecutionRequestInput
): AgentTaskPublicPlanExecutionRequest {
    const agentTaskPlan = input.agentTaskPlan;
    const publicPlan = input.publicPlan;
    const requestId = input.requestId || 'agent-task-public-plan-execution-request';
    const allowedWriteTools = normalizeStringList(
        input.runtimeAllowedWriteTools && input.runtimeAllowedWriteTools.length > 0
            ? input.runtimeAllowedWriteTools
            : [...DEFAULT_AGENT_TASK_PUBLIC_PLAN_WRITE_TOOL_ALLOWLIST]
    );
    const userConfirmed = input.userConfirmed === true;

    if (!agentTaskPlan || !publicPlan) {
        return buildRequest({
            agentTaskPlan,
            publicPlan,
            status: 'not_applicable',
            requestId,
            userConfirmed,
            allowedWriteTools,
            blockers: ['缺少公开计划或任务计划，不能创建受控执行请求。']
        });
    }

    if (
        agentTaskPlan.status !== 'ready_for_model_planning'
        || publicPlan.status !== 'ready'
        || publicPlan.canExecuteTools !== false
    ) {
        return buildRequest({
            agentTaskPlan,
            publicPlan,
            status: 'blocked_public_plan_not_ready',
            requestId,
            userConfirmed,
            allowedWriteTools,
            blockers: ['公开计划尚未处于可审查状态，不能创建受控执行请求。']
        });
    }

    const proposedWriteTools = resolveProposedWriteTools(publicPlan);
    if (proposedWriteTools.length === 0) {
        return buildRequest({
            agentTaskPlan,
            publicPlan,
            status: 'blocked_missing_write_tool_allowlist',
            requestId,
            userConfirmed,
            allowedWriteTools,
            blockers: ['公开计划缺少写工具白名单，不能进入用户确认或受控执行。']
        });
    }

    const blockedWriteTools = proposedWriteTools.filter((toolName) => !allowedWriteTools.includes(toolName));
    if (blockedWriteTools.length > 0) {
        return buildRequest({
            agentTaskPlan,
            publicPlan,
            status: 'blocked_write_tool_not_allowed',
            requestId,
            userConfirmed,
            proposedWriteTools,
            allowedWriteTools,
            blockedWriteTools,
            blockers: blockedWriteTools.map((toolName) => `公开计划包含未被运行时白名单允许的写工具：${toolName}`)
        });
    }

    const readbackTargets = normalizeStringList(publicPlan.readbackTargets);
    if (readbackTargets.length === 0) {
        return buildRequest({
            agentTaskPlan,
            publicPlan,
            status: 'blocked_missing_readback_targets',
            requestId,
            userConfirmed,
            proposedWriteTools,
            allowedWriteTools,
            blockers: ['公开计划缺少执行后的读回验收目标，不能创建受控执行请求。']
        });
    }

    if (!userConfirmed) {
        return buildRequest({
            agentTaskPlan,
            publicPlan,
            status: 'blocked_pending_user_confirmation',
            requestId,
            userConfirmed,
            proposedWriteTools,
            allowedWriteTools,
            readbackTargets,
            blockers: ['公开计划已具备工具白名单和读回目标，但仍缺少用户明确确认。'],
            warnings: ['默认不允许写入 Photoshop；用户确认后才允许创建受控执行请求。']
        });
    }

    if (input.enableControlledExecutionRequest !== true) {
        return buildRequest({
            agentTaskPlan,
            publicPlan,
            status: 'blocked_execution_request_disabled',
            requestId,
            userConfirmed,
            proposedWriteTools,
            allowedWriteTools,
            approvedWriteTools: proposedWriteTools,
            readbackTargets,
            blockers: ['受控执行请求默认关闭，需要显式启用后才可交给受控 runner。'],
            warnings: ['用户已确认公开计划，但本契约本身仍不写 Photoshop。']
        });
    }

    return buildRequest({
        agentTaskPlan,
        publicPlan,
        status: 'ready_for_controlled_execution_request',
        requestId,
        userConfirmed,
        canStartControlledRunner: true,
        proposedWriteTools,
        allowedWriteTools,
        approvedWriteTools: proposedWriteTools,
        readbackTargets,
        warnings: ['受控执行请求已准备好；后续仍必须由受控 runner 按白名单和读回目标执行。'],
        runtimeOperationRequests: input.runtimeOperationRequests
    });
}
