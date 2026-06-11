import type {
    AgentResumeContextRefreshRun,
    AgentResumeReadonlyEvidence,
    AgentResumeReadonlyEvidenceKey
} from './agent-resume-context-refresh-runner';

export type AgentResumeReadonlyContextExecutorVersion = 'agent-resume-readonly-context-executor/v0';

export type AgentResumeReadonlyContextExecutorStatus =
    | 'not_applicable'
    | 'blocked_refresh_run_not_ready'
    | 'blocked_missing_readonly_tools'
    | 'completed_readonly_refresh'
    | 'failed_readonly_refresh';

export type AgentResumeReadonlyToolName =
    | 'getDocumentInfo'
    | 'getDocumentSnapshot'
    | 'getLayerHierarchy'
    | 'getAcceptanceSnapshot'
    | 'getProjectContextSnapshot';

export interface AgentResumeReadonlyToolResult {
    ok: boolean;
    evidenceKey: AgentResumeReadonlyEvidenceKey;
    toolName: AgentResumeReadonlyToolName;
    error?: string;
}

export type AgentResumeReadonlyToolHandlers = Partial<Record<
    AgentResumeReadonlyToolName,
    () => unknown | Promise<unknown>
>>;

export interface AgentResumeReadonlyContextExecutorInput {
    refreshRun: AgentResumeContextRefreshRun;
    tools?: AgentResumeReadonlyToolHandlers;
}

export interface AgentResumeReadonlyContextExecutorResult {
    version: AgentResumeReadonlyContextExecutorVersion;
    status: AgentResumeReadonlyContextExecutorStatus;
    evidenceOnly: true;
    rawPayloadRedacted: true;
    mustNotRunWriteTools: true;
    mustNotClaimTaskCompletion: true;
    requestedTools: AgentResumeReadonlyToolName[];
    completedTools: AgentResumeReadonlyToolName[];
    missingTools: AgentResumeReadonlyToolName[];
    failedTools: AgentResumeReadonlyToolResult[];
    readonlyToolResults: AgentResumeReadonlyToolResult[];
    evidence?: AgentResumeReadonlyEvidence;
    blockers: string[];
    warnings: string[];
}

const EVIDENCE_KEY_BY_TOOL: Record<AgentResumeReadonlyToolName, AgentResumeReadonlyEvidenceKey> = {
    getDocumentInfo: 'document_info',
    getDocumentSnapshot: 'document_snapshot',
    getLayerHierarchy: 'layer_hierarchy',
    getAcceptanceSnapshot: 'acceptance_snapshot',
    getProjectContextSnapshot: 'project_context_snapshot'
};

const EVIDENCE_PROPERTY_BY_TOOL: Record<AgentResumeReadonlyToolName, keyof AgentResumeReadonlyEvidence> = {
    getDocumentInfo: 'documentInfo',
    getDocumentSnapshot: 'documentSnapshot',
    getLayerHierarchy: 'layerHierarchy',
    getAcceptanceSnapshot: 'acceptanceSnapshot',
    getProjectContextSnapshot: 'projectContextSnapshot'
};

function isReadonlyToolName(value: string): value is AgentResumeReadonlyToolName {
    return Object.prototype.hasOwnProperty.call(EVIDENCE_KEY_BY_TOOL, value);
}

function normalizeRequestedTools(refreshRun: AgentResumeContextRefreshRun): AgentResumeReadonlyToolName[] {
    const output: AgentResumeReadonlyToolName[] = [];
    for (const toolName of refreshRun.allowedReadOnlyTools) {
        if (!isReadonlyToolName(toolName)) continue;
        if (output.includes(toolName)) continue;
        output.push(toolName);
    }
    return output;
}

function buildExecutorResult(input: {
    status: AgentResumeReadonlyContextExecutorStatus;
    requestedTools?: AgentResumeReadonlyToolName[];
    completedTools?: AgentResumeReadonlyToolName[];
    missingTools?: AgentResumeReadonlyToolName[];
    failedTools?: AgentResumeReadonlyToolResult[];
    readonlyToolResults?: AgentResumeReadonlyToolResult[];
    evidence?: AgentResumeReadonlyEvidence;
    blockers?: string[];
    warnings?: string[];
}): AgentResumeReadonlyContextExecutorResult {
    return {
        version: 'agent-resume-readonly-context-executor/v0',
        status: input.status,
        evidenceOnly: true,
        rawPayloadRedacted: true,
        mustNotRunWriteTools: true,
        mustNotClaimTaskCompletion: true,
        requestedTools: input.requestedTools || [],
        completedTools: input.completedTools || [],
        missingTools: input.missingTools || [],
        failedTools: input.failedTools || [],
        readonlyToolResults: input.readonlyToolResults || [],
        evidence: input.evidence,
        blockers: input.blockers || [],
        warnings: input.warnings || []
    };
}

function normalizeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return '只读上下文工具执行失败。';
}

export async function runAgentResumeReadonlyContextExecutor(
    input: AgentResumeReadonlyContextExecutorInput
): Promise<AgentResumeReadonlyContextExecutorResult> {
    if (input.refreshRun.status === 'not_applicable') {
        return buildExecutorResult({
            status: 'not_applicable',
            blockers: input.refreshRun.blockers,
            warnings: input.refreshRun.warnings
        });
    }

    if (!input.refreshRun.canRequestReadOnlyRefresh) {
        return buildExecutorResult({
            status: 'blocked_refresh_run_not_ready',
            blockers: input.refreshRun.blockers.length > 0
                ? input.refreshRun.blockers
                : ['当前 refresh runner 不允许执行只读上下文刷新。'],
            warnings: input.refreshRun.warnings
        });
    }

    const requestedTools = normalizeRequestedTools(input.refreshRun);
    const toolHandlers = input.tools || {};
    const missingTools = requestedTools.filter((toolName) => typeof toolHandlers[toolName] !== 'function');

    if (missingTools.length > 0) {
        return buildExecutorResult({
            status: 'blocked_missing_readonly_tools',
            requestedTools,
            missingTools,
            blockers: missingTools.map((toolName) => `缺少只读工具处理器：${toolName}`),
            warnings: input.refreshRun.warnings
        });
    }

    const evidence: AgentResumeReadonlyEvidence = {};
    const completedTools: AgentResumeReadonlyToolName[] = [];
    const failedTools: AgentResumeReadonlyToolResult[] = [];
    const readonlyToolResults: AgentResumeReadonlyToolResult[] = [];

    for (const toolName of requestedTools) {
        const handler = toolHandlers[toolName];
        if (!handler) continue;

        const evidenceKey = EVIDENCE_KEY_BY_TOOL[toolName];
        try {
            const value = await handler();
            evidence[EVIDENCE_PROPERTY_BY_TOOL[toolName]] = value;
            completedTools.push(toolName);
            readonlyToolResults.push({
                ok: true,
                evidenceKey,
                toolName
            });
        } catch (error) {
            const failedTool = {
                ok: false,
                evidenceKey,
                toolName,
                error: normalizeError(error)
            };
            failedTools.push(failedTool);
            readonlyToolResults.push(failedTool);
            return buildExecutorResult({
                status: 'failed_readonly_refresh',
                requestedTools,
                completedTools,
                failedTools,
                readonlyToolResults,
                evidence,
                blockers: [`只读上下文刷新失败：${toolName}。${failedTool.error}`],
                warnings: input.refreshRun.warnings
            });
        }
    }

    return buildExecutorResult({
        status: 'completed_readonly_refresh',
        requestedTools,
        completedTools,
        readonlyToolResults,
        evidence,
        warnings: [
            ...input.refreshRun.warnings,
            '只读上下文刷新已完成；该结果仍不能直接触发 Photoshop 写入或任务完成声明。'
        ]
    });
}
