import type {
    AgentTaskPublicPlanControlledOperationRequest,
    AgentTaskPublicPlanExecutionRequest
} from './agent-task-public-plan-execution-request';
import {
    runAgentResumeControlledExecutionRunner,
    type AgentResumeControlledExecutionAdapter,
    type AgentResumeControlledExecutionRun,
    type AgentResumeControlledExecutionRunnerTarget,
    type AgentResumeControlledOperationRequest
} from './agent-resume-controlled-execution';
import { sanitizeAgentResumePlanningValue } from './agent-resume-planning';

export type AgentTaskPublicPlanControlledRunnerVersion = 'agent-task-public-plan-controlled-runner/v0';

export type AgentTaskPublicPlanControlledRunnerStatus =
    | 'not_applicable'
    | 'blocked_request_not_ready'
    | 'blocked_adapter_required'
    | 'blocked_live_write_permission_missing'
    | 'blocked_live_adapter_required'
    | 'blocked_live_operation_params_required'
    | 'blocked_readback_adapter_required'
    | 'completed_dry_run'
    | 'completed_fake_adapter_verified'
    | 'completed_live_adapter_verified'
    | 'failed_write_operation'
    | 'failed_readback';

export type AgentTaskPublicPlanControlledRunnerTarget =
    | 'dry-run'
    | 'fake-adapter'
    | 'live-photoshop';

export interface AgentTaskPublicPlanControlledAdapterResult {
    success?: boolean;
    error?: string;
    data?: unknown;
}

export interface AgentTaskPublicPlanControlledAdapter {
    runWriteOperation(
        operation: AgentTaskPublicPlanControlledOperationRequest
    ): AgentTaskPublicPlanControlledAdapterResult;
    readbackAfterOperation?(
        operation: AgentTaskPublicPlanControlledOperationRequest,
        target: string
    ): AgentTaskPublicPlanControlledAdapterResult;
}

export interface AgentTaskPublicPlanControlledOperationResult {
    operationId: string;
    toolName: string;
    success: boolean;
    error?: string;
    data?: unknown;
}

export interface AgentTaskPublicPlanControlledReadbackResult {
    operationId: string;
    toolName: string;
    target: string;
    success: boolean;
    error?: string;
    data?: unknown;
}

export interface AgentTaskPublicPlanControlledRunnerInput {
    request?: AgentTaskPublicPlanExecutionRequest;
    executionTarget?: AgentTaskPublicPlanControlledRunnerTarget;
    allowPhotoshopWrites?: boolean;
    adapter?: AgentTaskPublicPlanControlledAdapter;
}

export interface AgentTaskPublicPlanControlledRun {
    version: AgentTaskPublicPlanControlledRunnerVersion;
    status: AgentTaskPublicPlanControlledRunnerStatus;
    requestId?: string;
    requestStatus?: AgentTaskPublicPlanExecutionRequest['status'];
    executionTarget: AgentTaskPublicPlanControlledRunnerTarget;
    fakeAdapterOnly: boolean;
    evidenceOnly: boolean;
    rawPayloadRedacted: true;
    shouldRunPhotoshop: boolean;
    mustNotRunWriteTools: boolean;
    mustNotClaimTaskCompletion: true;
    plannedWriteTools: string[];
    executedWriteTools: string[];
    readbackTargets: string[];
    operationRequests: AgentTaskPublicPlanControlledOperationRequest[];
    operationResults: AgentTaskPublicPlanControlledOperationResult[];
    readbackResults: AgentTaskPublicPlanControlledReadbackResult[];
    dryRun: boolean;
    blockers: string[];
    warnings: string[];
}

function normalizeStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const output: string[] = [];
    for (const item of value) {
        const text = String(item || '').trim();
        if (!text || output.includes(text)) continue;
        output.push(text);
    }
    return output;
}

function resolveExecutionTarget(
    input: AgentTaskPublicPlanControlledRunnerInput
): AgentTaskPublicPlanControlledRunnerTarget {
    if (input.executionTarget === 'fake-adapter') return 'fake-adapter';
    if (input.executionTarget === 'live-photoshop') return 'live-photoshop';
    return 'dry-run';
}

function toResumeOperation(
    operation: AgentTaskPublicPlanControlledOperationRequest
): AgentResumeControlledOperationRequest {
    return {
        operationId: operation.operationId,
        toolName: operation.toolName,
        params: operation.params,
        paramsSummary: operation.paramsSummary,
        readbackTargets: [...operation.readbackTargets]
    };
}

function toPublicOperation(
    operation: AgentResumeControlledOperationRequest
): AgentTaskPublicPlanControlledOperationRequest {
    return {
        operationId: operation.operationId,
        toolName: operation.toolName,
        params: operation.params,
        paramsSummary: operation.paramsSummary,
        readbackTargets: [...operation.readbackTargets]
    };
}

function toResumeAdapter(
    adapter?: AgentTaskPublicPlanControlledAdapter
): AgentResumeControlledExecutionAdapter | undefined {
    if (!adapter) return undefined;
    const readbackAfterOperation = adapter.readbackAfterOperation;
    return {
        runWriteOperation: (operation) => adapter.runWriteOperation(toPublicOperation(operation)),
        readbackAfterOperation: readbackAfterOperation
            ? (operation, target) => readbackAfterOperation(toPublicOperation(operation), target)
            : undefined
    };
}

function toResumeRequest(request: AgentTaskPublicPlanExecutionRequest) {
    return {
        version: 'agent-resume-controlled-execution-request/v0' as const,
        status: request.status === 'ready_for_controlled_execution_request'
            && request.canStartControlledRunner === true
            ? 'ready_for_controlled_runner' as const
            : 'blocked_execution_gate_not_ready' as const,
        requestId: request.requestId,
        evidenceOnly: true as const,
        rawPayloadRedacted: true as const,
        shouldRunPhotoshop: false as const,
        mustNotRunWriteTools: true as const,
        mustNotClaimTaskCompletion: true as const,
        requiresControlledRunner: true as const,
        requiresReadbackAfterEachWrite: true as const,
        canStartControlledRunner: request.status === 'ready_for_controlled_execution_request'
            && request.canStartControlledRunner === true,
        approvedWriteTools: normalizeStringList(request.approvedWriteTools),
        readbackTargets: normalizeStringList(request.readbackTargets),
        operationRequests: request.operationRequests.map(toResumeOperation),
        executionPlan: {
            publicPlanSummary: request.publicPlanSummary,
            taskPlanStatus: request.taskPlanStatus,
            publicPlanStatus: request.publicPlanStatus
        },
        blockers: [...request.blockers],
        warnings: [...request.warnings]
    };
}

function mapStatus(status: AgentResumeControlledExecutionRun['status']): AgentTaskPublicPlanControlledRunnerStatus {
    if (status === 'not_applicable') return 'not_applicable';
    if (status === 'blocked_request_not_ready') return 'blocked_request_not_ready';
    if (status === 'blocked_adapter_required') return 'blocked_adapter_required';
    if (status === 'blocked_readback_adapter_required') return 'blocked_readback_adapter_required';
    if (status === 'completed_dry_run') return 'completed_dry_run';
    if (status === 'completed_fake_adapter_verified') return 'completed_fake_adapter_verified';
    if (status === 'completed_live_adapter_verified') return 'completed_live_adapter_verified';
    if (status === 'failed_write_operation') return 'failed_write_operation';
    if (status === 'failed_readback') return 'failed_readback';
    if (status === 'blocked_live_write_permission_missing') return 'blocked_live_write_permission_missing';
    if (status === 'blocked_live_adapter_required') return 'blocked_live_adapter_required';
    if (status === 'blocked_live_operation_params_required') return 'blocked_live_operation_params_required';
    return 'blocked_request_not_ready';
}

function mapTarget(
    target: AgentResumeControlledExecutionRunnerTarget
): AgentTaskPublicPlanControlledRunnerTarget {
    if (target === 'fake-adapter') return 'fake-adapter';
    if (target === 'live-photoshop') return 'live-photoshop';
    return 'dry-run';
}

function buildPublicPlanRun(
    input: {
        request?: AgentTaskPublicPlanExecutionRequest;
        target: AgentTaskPublicPlanControlledRunnerTarget;
        resumeRun: AgentResumeControlledExecutionRun;
    }
): AgentTaskPublicPlanControlledRun {
    const request = input.request;
    return {
        version: 'agent-task-public-plan-controlled-runner/v0',
        status: mapStatus(input.resumeRun.status),
        requestId: request?.requestId,
        requestStatus: request?.status,
        executionTarget: mapTarget(input.resumeRun.executionTarget),
        fakeAdapterOnly: input.resumeRun.fakeAdapterOnly,
        evidenceOnly: input.resumeRun.evidenceOnly,
        rawPayloadRedacted: true,
        shouldRunPhotoshop: input.resumeRun.shouldRunPhotoshop,
        mustNotRunWriteTools: input.resumeRun.mustNotRunWriteTools !== false,
        mustNotClaimTaskCompletion: true,
        plannedWriteTools: normalizeStringList(input.resumeRun.plannedWriteTools),
        executedWriteTools: normalizeStringList(input.resumeRun.executedWriteTools),
        readbackTargets: request?.readbackTargets || normalizeStringList(input.resumeRun.readbackTargets),
        operationRequests: request?.operationRequests || input.resumeRun.operationRequests.map(toPublicOperation),
        operationResults: input.resumeRun.operationResults.map((result) => ({
            operationId: result.operationId,
            toolName: result.toolName,
            success: result.success,
            error: result.error,
            data: sanitizeAgentResumePlanningValue(result.data)
        })),
        readbackResults: input.resumeRun.readbackResults.map((result) => ({
            operationId: result.operationId,
            toolName: result.toolName,
            target: result.target,
            success: result.success,
            error: result.error,
            data: sanitizeAgentResumePlanningValue(result.data)
        })),
        dryRun: input.resumeRun.dryRun,
        blockers: [...input.resumeRun.blockers],
        warnings: input.resumeRun.warnings.map((warning) =>
            warning.replace(/恢复/g, '公开计划')
        )
    };
}

export function runAgentTaskPublicPlanControlledRunner(
    input: AgentTaskPublicPlanControlledRunnerInput
): AgentTaskPublicPlanControlledRun {
    const target = resolveExecutionTarget(input);
    const resumeRun = runAgentResumeControlledExecutionRunner({
        request: input.request ? toResumeRequest(input.request) : undefined,
        executionTarget: target,
        allowPhotoshopWrites: input.allowPhotoshopWrites,
        adapter: toResumeAdapter(input.adapter)
    });

    return buildPublicPlanRun({
        request: input.request,
        target,
        resumeRun
    });
}
