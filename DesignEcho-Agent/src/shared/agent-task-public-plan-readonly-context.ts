import type { AgentResumeContextRefreshRun } from './agent-resume-context-refresh-runner';
import {
    runAgentResumeReadonlyContextExecutor,
    type AgentResumeReadonlyContextExecutorResult,
    type AgentResumeReadonlyToolHandlers,
    type AgentResumeReadonlyToolName
} from './agent-resume-readonly-context-executor';

export type AgentTaskPublicPlanReadonlyContextStatus =
    | 'not_available'
    | AgentResumeReadonlyContextExecutorResult['status'];

export interface AgentTaskPublicPlanReadonlyContext {
    version: 'agent-task-public-plan-readonly-context/v0';
    status: AgentTaskPublicPlanReadonlyContextStatus;
    evidenceOnly: true;
    rawPayloadRedacted: true;
    canExecuteTools: false;
    mustNotRunWriteTools: true;
    requestedTools: AgentResumeReadonlyToolName[];
    completedTools: AgentResumeReadonlyToolName[];
    missingTools: AgentResumeReadonlyToolName[];
    failedTools: AgentResumeReadonlyContextExecutorResult['failedTools'];
    summaries: string[];
    blockers: string[];
    warnings: string[];
}

const PUBLIC_PLAN_READONLY_TOOLS: AgentResumeReadonlyToolName[] = [
    'getDocumentInfo',
    'getLayerHierarchy',
    'getProjectContextSnapshot',
    'getAcceptanceSnapshot'
];

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizePublicPlanSummaryValue(value: unknown, maxLength = 80): string {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const withoutBinary = raw
        .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/ig, '[binary-redacted]')
        .replace(/\b[A-Za-z]:[\\/][^\s;；,，]+/g, '[local-path-redacted]')
        .replace(/[\\\/]+/g, '/')
        .replace(/\s+/g, ' ');
    return withoutBinary.length > maxLength
        ? `${withoutBinary.slice(0, maxLength - 1)}…`
        : withoutBinary;
}

function pickFirstString(record: Record<string, unknown>, keys: string[]): string {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) {
            return sanitizePublicPlanSummaryValue(value);
        }
    }
    return '';
}

function pickFirstNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
    }
    return undefined;
}

function pickNameList(value: unknown, keys: string[]): string[] {
    if (!isPlainRecord(value)) return [];
    for (const key of keys) {
        const candidate = value[key];
        if (!Array.isArray(candidate)) continue;
        return candidate
            .map((item) => {
                if (typeof item === 'string') return sanitizePublicPlanSummaryValue(item, 32);
                if (isPlainRecord(item)) return pickFirstString(item, ['name', 'title', 'label']);
                return '';
            })
            .filter(Boolean)
            .slice(0, 8);
    }
    return [];
}

function summarizeDocumentInfo(value: unknown): string {
    if (!isPlainRecord(value)) return '';
    const name = pickFirstString(value, ['name', 'documentName', 'title']);
    const width = pickFirstNumber(value, ['width', 'canvasWidth']);
    const height = pickFirstNumber(value, ['height', 'canvasHeight']);
    const layerCount = pickFirstNumber(value, ['layerCount', 'layers']);
    const parts = [
        name ? `document=${name}` : '',
        width && height ? `size=${width}x${height}` : '',
        layerCount != null ? `layers=${layerCount}` : ''
    ].filter(Boolean);
    return parts.length > 0 ? `document_info: ${parts.join('; ')}` : '';
}

function summarizeLayerHierarchy(value: unknown): string {
    if (!isPlainRecord(value)) return '';
    const layerCount = pickFirstNumber(value, ['layerCount', 'totalLayers', 'layers']);
    const groups = pickNameList(value, ['groups', 'topLevelGroups', 'groupNames', 'layers']);
    const parts = [
        layerCount != null ? `layers=${layerCount}` : '',
        groups.length > 0 ? `top=${groups.join(', ')}` : ''
    ].filter(Boolean);
    return parts.length > 0 ? `layer_hierarchy: ${parts.join('; ')}` : '';
}

function summarizeProjectContextSnapshot(value: unknown): string {
    if (!isPlainRecord(value)) return '';
    const project = pickFirstString(value, ['projectName', 'projectId', 'name', 'title']);
    const imageCount = pickFirstNumber(value, ['imageCount', 'projectImageCount', 'totalImages']);
    const parts = [
        project ? `project=${project}` : '',
        imageCount != null ? `images=${imageCount}` : ''
    ].filter(Boolean);
    return parts.length > 0 ? `project_context_snapshot: ${parts.join('; ')}` : '';
}

function summarizeAcceptanceSnapshot(value: unknown): string {
    if (!isPlainRecord(value)) return '';
    const documentName = pickFirstString(value, ['documentName', 'name', 'title']);
    const width = pickFirstNumber(value, ['width', 'canvasWidth']);
    const height = pickFirstNumber(value, ['height', 'canvasHeight']);
    const layerCount = pickFirstNumber(value, ['layerCount', 'layers']);
    const parts = [
        documentName ? `document=${documentName}` : '',
        width && height ? `size=${width}x${height}` : '',
        layerCount != null ? `layers=${layerCount}` : ''
    ].filter(Boolean);
    return parts.length > 0 ? `acceptance_snapshot: ${parts.join('; ')}` : '';
}

function summarizePublicPlanReadonlyEvidence(
    executorResult: AgentResumeReadonlyContextExecutorResult
): string[] {
    if (!executorResult.evidence) return [];
    return [
        summarizeDocumentInfo(executorResult.evidence.documentInfo),
        summarizeLayerHierarchy(executorResult.evidence.layerHierarchy),
        summarizeProjectContextSnapshot(executorResult.evidence.projectContextSnapshot),
        summarizeAcceptanceSnapshot(executorResult.evidence.acceptanceSnapshot)
    ].filter(Boolean);
}

function buildNoReadonlyContextResult(warnings: string[] = []): AgentTaskPublicPlanReadonlyContext {
    return {
        version: 'agent-task-public-plan-readonly-context/v0',
        status: 'not_available',
        evidenceOnly: true,
        rawPayloadRedacted: true,
        canExecuteTools: false,
        mustNotRunWriteTools: true,
        requestedTools: [],
        completedTools: [],
        missingTools: [],
        failedTools: [],
        summaries: [],
        blockers: [],
        warnings
    };
}

function buildPublicPlanReadonlyRefreshRun(
    requestedTools: AgentResumeReadonlyToolName[]
): AgentResumeContextRefreshRun {
    const requiredReadOnlyEvidence = requestedTools.map((toolName) => {
        if (toolName === 'getDocumentInfo') return 'document_info';
        if (toolName === 'getLayerHierarchy') return 'layer_hierarchy';
        if (toolName === 'getProjectContextSnapshot') return 'project_context_snapshot';
        return 'acceptance_snapshot';
    });
    return {
        version: 'agent-resume-context-refresh-runner/v0',
        status: 'waiting_for_readonly_evidence',
        gateStatus: 'ready_for_readonly_context_refresh',
        canEnterResumePlanning: false,
        canRequestReadOnlyRefresh: true,
        mustNotRunWriteTools: true,
        mustNotClaimTaskCompletion: true,
        requiredReadOnlyEvidence,
        receivedEvidence: [],
        missingEvidence: requiredReadOnlyEvidence,
        allowedReadOnlyTools: requestedTools,
        blockers: [],
        warnings: [
            '公开设计计划只允许读取上下文摘要，不能触发 Photoshop 写入。'
        ],
        evidenceOnly: true,
        rawPayloadRedacted: true
    };
}

export async function buildAgentTaskPublicPlanReadonlyContext(input: {
    readonlyToolHandlers?: AgentResumeReadonlyToolHandlers;
}): Promise<AgentTaskPublicPlanReadonlyContext> {
    const toolHandlers = input.readonlyToolHandlers || {};
    const requestedTools = PUBLIC_PLAN_READONLY_TOOLS.filter(
        (toolName) => typeof toolHandlers[toolName] === 'function'
    );
    if (requestedTools.length === 0) {
        return buildNoReadonlyContextResult([
            '未注入可用的只读上下文工具；公开计划只能使用生命周期摘要。'
        ]);
    }

    const executorResult = await runAgentResumeReadonlyContextExecutor({
        refreshRun: buildPublicPlanReadonlyRefreshRun(requestedTools),
        tools: toolHandlers
    });
    return {
        version: 'agent-task-public-plan-readonly-context/v0',
        status: executorResult.status,
        evidenceOnly: true,
        rawPayloadRedacted: true,
        canExecuteTools: false,
        mustNotRunWriteTools: true,
        requestedTools: executorResult.requestedTools,
        completedTools: executorResult.completedTools,
        missingTools: executorResult.missingTools,
        failedTools: executorResult.failedTools,
        summaries: summarizePublicPlanReadonlyEvidence(executorResult),
        blockers: executorResult.blockers,
        warnings: executorResult.warnings
    };
}

export function resolveProjectLabelForPublicPlan(projectContext?: Record<string, unknown>): string {
    const fromExplicitName = projectContext
        ? pickFirstString(projectContext, ['projectName', 'projectId', 'name'])
        : '';
    if (fromExplicitName) return fromExplicitName;
    const projectPath = typeof projectContext?.projectPath === 'string'
        ? projectContext.projectPath
        : '';
    const tail = projectPath.split(/[\\/]+/).filter(Boolean).pop();
    return sanitizePublicPlanSummaryValue(tail || 'unknown');
}

export function formatAgentTaskPublicPlanReadonlyContext(
    readonlyContext: AgentTaskPublicPlanReadonlyContext
): string[] {
    if (readonlyContext.status === 'not_available') {
        return ['readonly_context=not_available'];
    }
    const lines = [
        `readonly_context_status=${readonlyContext.status}`,
        `readonly_context_tools=${readonlyContext.completedTools.join(', ') || 'none'}`
    ];
    for (const summary of readonlyContext.summaries) {
        lines.push(summary);
    }
    if (readonlyContext.blockers.length > 0) {
        lines.push(`readonly_context_blockers=${readonlyContext.blockers.join('；')}`);
    }
    return lines;
}
