import {
    buildAgentExecutionLifecycleSnapshot,
    isAgentExecutionLifecycleBoundaryOk,
    type AgentExecutionLifecycleSnapshot,
    type AgentExecutionLifecycleStatus
} from './agent-execution-lifecycle';
import type { AgentRequestLifecycleEvidence } from './agent-request-lifecycle';

export type AgentProcessInspectorVersion = 'agent-process-inspector/v0';

export type AgentProcessInspectorStatus =
    | 'no_evidence'
    | 'running'
    | 'completed'
    | 'needs_review'
    | 'failed'
    | 'cancelled';

export interface AgentProcessExecutionSummaryLike {
    status?: string;
    stopReason?: string;
    toolCallCount?: number;
    successfulToolCalls?: number;
    failedToolCalls?: number;
    acceptanceVerified?: number;
    acceptanceFailed?: number;
    acceptanceNeedsReview?: number;
    lastToolName?: string;
    lastError?: string;
    blockers?: unknown;
    warnings?: unknown;
    summaryText?: string;
}

export interface AgentProcessInspectorMessageLike {
    id?: string;
    role?: string;
    executionSummary?: AgentProcessExecutionSummaryLike;
    agentRequestLifecycle?: AgentRequestLifecycleEvidence;
}

export interface BuildAgentProcessInspectorInput {
    messages?: AgentProcessInspectorMessageLike[];
    isLoading?: boolean;
    generatedAt?: string;
}

export interface AgentProcessInspectorEvidenceItem {
    id: string;
    label: string;
    state: 'present' | 'missing' | 'not_needed' | 'warning' | 'blocked';
    detail?: string;
}

export interface AgentProcessInspectorViewModel {
    version: AgentProcessInspectorVersion;
    status: AgentProcessInspectorStatus;
    label: string;
    summary: string;
    generatedAt: string;
    sourceMessageId?: string;
    source: 'message_evidence' | 'loading_state' | 'empty_conversation';
    lifecycleSnapshot: AgentExecutionLifecycleSnapshot;
    lifecycleBoundaryOk: boolean;
    actorLabel: string;
    routeLabel: string;
    toolLabel: string;
    qa: {
        verified: number;
        failed: number;
        needsReview: number;
    };
    blockers: string[];
    warnings: string[];
    evidenceItems: AgentProcessInspectorEvidenceItem[];
    canClaimDesignQuality: false;
    canClaimProviderThinking: false;
    canRunProvider: false;
    canRunPhotoshop: false;
}

export function buildAgentProcessInspector(
    input: BuildAgentProcessInspectorInput
): AgentProcessInspectorViewModel {
    const messages = Array.isArray(input.messages) ? input.messages : [];
    const sourceMessage = findLatestAssistantEvidenceMessage(messages);
    const summary = sourceMessage?.executionSummary;
    const lifecycle = sourceMessage?.agentRequestLifecycle;
    const blockers = uniqueStrings([
        ...normalizeStringArray(summary?.blockers),
        ...normalizeStringArray(lifecycle?.blockers)
    ]);
    const warnings = uniqueStrings([
        ...normalizeStringArray(summary?.warnings),
        ...normalizeStringArray(lifecycle?.warnings)
    ]);
    const status = deriveInspectorStatus({
        isLoading: input.isLoading === true,
        hasMessages: messages.length > 0,
        summary
    });
    const lifecycleSnapshot = buildAgentExecutionLifecycleSnapshot({
        lifecycle,
        status: mapInspectorStatusToLifecycleStatus(status),
        toolCallCount: summary?.toolCallCount,
        activeToolName: summary?.lastToolName,
        blockers,
        warnings,
        generatedAt: input.generatedAt
    });
    const qa = {
        verified: normalizeCount(summary?.acceptanceVerified),
        failed: normalizeCount(summary?.acceptanceFailed),
        needsReview: normalizeCount(summary?.acceptanceNeedsReview)
    };

    return {
        version: 'agent-process-inspector/v0',
        status,
        label: getInspectorStatusLabel(status, lifecycleSnapshot),
        summary: buildSummary({ status, summary, lifecycleSnapshot }),
        generatedAt: lifecycleSnapshot.generatedAt,
        sourceMessageId: sourceMessage?.id,
        source: sourceMessage ? 'message_evidence' : input.isLoading ? 'loading_state' : 'empty_conversation',
        lifecycleSnapshot,
        lifecycleBoundaryOk: isAgentExecutionLifecycleBoundaryOk(lifecycleSnapshot) === true,
        actorLabel: lifecycleSnapshot.actor.label,
        routeLabel: buildRouteLabel(lifecycleSnapshot),
        toolLabel: buildToolLabel(summary),
        qa,
        blockers,
        warnings,
        evidenceItems: buildEvidenceItems({ lifecycle, summary, lifecycleSnapshot, qa, blockers, warnings }),
        canClaimDesignQuality: false,
        canClaimProviderThinking: false,
        canRunProvider: false,
        canRunPhotoshop: false
    };
}

function findLatestAssistantEvidenceMessage(
    messages: AgentProcessInspectorMessageLike[]
): AgentProcessInspectorMessageLike | undefined {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message?.role !== 'assistant') continue;
        if (message.executionSummary || message.agentRequestLifecycle) {
            return message;
        }
    }
    return undefined;
}

function deriveInspectorStatus(input: {
    isLoading: boolean;
    hasMessages: boolean;
    summary?: AgentProcessExecutionSummaryLike;
}): AgentProcessInspectorStatus {
    const summaryStatus = normalizeText(input.summary?.status).toLowerCase();
    if (summaryStatus === 'completed') return 'completed';
    if (summaryStatus === 'needs_review') return 'needs_review';
    if (summaryStatus === 'failed') return 'failed';
    if (summaryStatus === 'cancelled') return 'cancelled';
    if (input.isLoading) return 'running';
    return input.hasMessages ? 'needs_review' : 'no_evidence';
}

function mapInspectorStatusToLifecycleStatus(
    status: AgentProcessInspectorStatus
): AgentExecutionLifecycleStatus {
    if (status === 'completed') return 'completed';
    if (status === 'failed') return 'failed';
    if (status === 'cancelled') return 'cancelled';
    return 'running';
}

function getInspectorStatusLabel(
    status: AgentProcessInspectorStatus,
    snapshot: AgentExecutionLifecycleSnapshot
): string {
    if (status === 'no_evidence') return '暂无执行证据';
    if (status === 'needs_review') return '需要复核';
    return snapshot.statusLabel;
}

function buildSummary(input: {
    status: AgentProcessInspectorStatus;
    summary?: AgentProcessExecutionSummaryLike;
    lifecycleSnapshot: AgentExecutionLifecycleSnapshot;
}): string {
    const summaryText = normalizeText(input.summary?.summaryText);
    if (summaryText) return summaryText;
    if (input.status === 'no_evidence') return '当前对话还没有可用于判断 Agent 过程的执行证据。';
    if (input.status === 'running') return `${input.lifecycleSnapshot.statusLabel}，等待新的 lifecycle 或工具事件证据。`;
    return input.lifecycleSnapshot.statusLabel;
}

function buildRouteLabel(snapshot: AgentExecutionLifecycleSnapshot): string {
    const parts = [
        normalizeText(snapshot.route.route),
        normalizeText(snapshot.route.skillId),
        normalizeText(snapshot.route.executionKind)
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' / ') : '未记录路由';
}

function buildToolLabel(summary: AgentProcessExecutionSummaryLike | undefined): string {
    const toolCallCount = normalizeCount(summary?.toolCallCount);
    const successfulToolCalls = normalizeCount(summary?.successfulToolCalls);
    const failedToolCalls = normalizeCount(summary?.failedToolCalls);
    const lastToolName = normalizeText(summary?.lastToolName);
    if (toolCallCount <= 0) return '无工具调用证据';
    const suffix = lastToolName ? `，最近：${lastToolName}` : '';
    return `${toolCallCount} 次工具调用，成功 ${successfulToolCalls}，失败 ${failedToolCalls}${suffix}`;
}

function buildEvidenceItems(input: {
    lifecycle?: AgentRequestLifecycleEvidence;
    summary?: AgentProcessExecutionSummaryLike;
    lifecycleSnapshot: AgentExecutionLifecycleSnapshot;
    qa: AgentProcessInspectorViewModel['qa'];
    blockers: string[];
    warnings: string[];
}): AgentProcessInspectorEvidenceItem[] {
    const hasLifecycle = Boolean(input.lifecycle);
    const hasSummary = Boolean(input.summary);
    const qaTotal = input.qa.verified + input.qa.failed + input.qa.needsReview;
    return [
        {
            id: 'request-lifecycle',
            label: '请求生命周期',
            state: hasLifecycle ? 'present' : 'missing',
            detail: hasLifecycle ? buildRouteLabel(input.lifecycleSnapshot) : '缺少 agentRequestLifecycle'
        },
        {
            id: 'execution-summary',
            label: '执行摘要',
            state: hasSummary ? 'present' : 'missing',
            detail: hasSummary ? input.lifecycleSnapshot.statusLabel : '缺少 executionSummary'
        },
        {
            id: 'tool-evidence',
            label: '工具证据',
            state: input.lifecycleSnapshot.toolEvidence.toolCallCount > 0 ? 'present' : 'not_needed',
            detail: input.lifecycleSnapshot.toolEvidence.activeToolName || `${input.lifecycleSnapshot.toolEvidence.toolCallCount} 次`
        },
        {
            id: 'qa-evidence',
            label: '验收证据',
            state: qaTotal > 0 ? (input.qa.failed > 0 ? 'blocked' : 'present') : 'missing',
            detail: `通过 ${input.qa.verified}，失败 ${input.qa.failed}，待复核 ${input.qa.needsReview}`
        },
        {
            id: 'blockers',
            label: '阻断项',
            state: input.blockers.length > 0 ? 'blocked' : 'not_needed',
            detail: input.blockers[0] || '无阻断项'
        },
        {
            id: 'warnings',
            label: '风险提示',
            state: input.warnings.length > 0 ? 'warning' : 'not_needed',
            detail: input.warnings[0] || '无风险提示'
        }
    ];
}

function normalizeText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeCount(value: unknown): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return 0;
    return Math.floor(numeric);
}

function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => normalizeText(item))
        .filter(Boolean);
}

function uniqueStrings(value: string[]): string[] {
    return Array.from(new Set(value.map((item) => item.trim()).filter(Boolean)));
}
