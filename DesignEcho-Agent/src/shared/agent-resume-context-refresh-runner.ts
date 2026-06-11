import type { AgentResumeContextGate } from './agent-resume-context-gate';

export type AgentResumeContextRefreshRunVersion = 'agent-resume-context-refresh-runner/v0';

export type AgentResumeContextRefreshRunStatus =
    | 'not_applicable'
    | 'blocked_gate_not_refreshable'
    | 'waiting_for_readonly_evidence'
    | 'partial_readonly_evidence'
    | 'fresh_context_ready';

export type AgentResumeReadonlyEvidenceKey =
    | 'document_info'
    | 'document_snapshot'
    | 'layer_hierarchy'
    | 'acceptance_snapshot'
    | 'project_context_snapshot';

export interface AgentResumeReadonlyEvidence {
    documentInfo?: unknown;
    documentSnapshot?: unknown;
    layerHierarchy?: unknown;
    acceptanceSnapshot?: unknown;
    projectContextSnapshot?: unknown;
}

export interface AgentResumeContextRefreshRunInput {
    gate: AgentResumeContextGate;
    evidence?: AgentResumeReadonlyEvidence;
}

export interface AgentResumeContextRefreshRun {
    version: AgentResumeContextRefreshRunVersion;
    status: AgentResumeContextRefreshRunStatus;
    gateStatus: AgentResumeContextGate['status'];
    canEnterResumePlanning: boolean;
    canRequestReadOnlyRefresh: boolean;
    mustNotRunWriteTools: true;
    mustNotClaimTaskCompletion: true;
    requiredReadOnlyEvidence: AgentResumeReadonlyEvidenceKey[];
    receivedEvidence: AgentResumeReadonlyEvidenceKey[];
    missingEvidence: AgentResumeReadonlyEvidenceKey[];
    allowedReadOnlyTools: string[];
    blockers: string[];
    warnings: string[];
    evidenceOnly: true;
    rawPayloadRedacted: true;
}

const READONLY_TOOL_BY_EVIDENCE: Record<AgentResumeReadonlyEvidenceKey, string> = {
    document_info: 'getDocumentInfo',
    document_snapshot: 'getDocumentSnapshot',
    layer_hierarchy: 'getLayerHierarchy',
    acceptance_snapshot: 'getAcceptanceSnapshot',
    project_context_snapshot: 'getProjectContextSnapshot'
};

const EVIDENCE_PROPERTY_BY_KEY: Record<AgentResumeReadonlyEvidenceKey, keyof AgentResumeReadonlyEvidence> = {
    document_info: 'documentInfo',
    document_snapshot: 'documentSnapshot',
    layer_hierarchy: 'layerHierarchy',
    acceptance_snapshot: 'acceptanceSnapshot',
    project_context_snapshot: 'projectContextSnapshot'
};

function isReadonlyEvidenceKey(value: string): value is AgentResumeReadonlyEvidenceKey {
    return Object.prototype.hasOwnProperty.call(READONLY_TOOL_BY_EVIDENCE, value);
}

function normalizeRequiredEvidence(values: string[]): AgentResumeReadonlyEvidenceKey[] {
    const output: AgentResumeReadonlyEvidenceKey[] = [];
    for (const value of values) {
        if (!isReadonlyEvidenceKey(value)) continue;
        if (output.includes(value)) continue;
        output.push(value);
    }
    return output;
}

function hasEvidenceValue(evidence: AgentResumeReadonlyEvidence | undefined, key: AgentResumeReadonlyEvidenceKey): boolean {
    if (!evidence) return false;
    const property = EVIDENCE_PROPERTY_BY_KEY[key];
    return Object.prototype.hasOwnProperty.call(evidence, property) && evidence[property] != null;
}

function buildRun(input: {
    gate: AgentResumeContextGate;
    status: AgentResumeContextRefreshRunStatus;
    canEnterResumePlanning?: boolean;
    canRequestReadOnlyRefresh?: boolean;
    requiredReadOnlyEvidence?: AgentResumeReadonlyEvidenceKey[];
    receivedEvidence?: AgentResumeReadonlyEvidenceKey[];
    missingEvidence?: AgentResumeReadonlyEvidenceKey[];
    blockers?: string[];
    warnings?: string[];
}): AgentResumeContextRefreshRun {
    const requiredReadOnlyEvidence = input.requiredReadOnlyEvidence || [];
    return {
        version: 'agent-resume-context-refresh-runner/v0',
        status: input.status,
        gateStatus: input.gate.status,
        canEnterResumePlanning: input.canEnterResumePlanning === true,
        canRequestReadOnlyRefresh: input.canRequestReadOnlyRefresh === true,
        mustNotRunWriteTools: true,
        mustNotClaimTaskCompletion: true,
        requiredReadOnlyEvidence,
        receivedEvidence: input.receivedEvidence || [],
        missingEvidence: input.missingEvidence || [],
        allowedReadOnlyTools: requiredReadOnlyEvidence.map((key) => READONLY_TOOL_BY_EVIDENCE[key]),
        blockers: input.blockers || [],
        warnings: input.warnings || [],
        evidenceOnly: true,
        rawPayloadRedacted: true
    };
}

export function buildAgentResumeContextRefreshRun(
    input: AgentResumeContextRefreshRunInput
): AgentResumeContextRefreshRun {
    const requiredReadOnlyEvidence = normalizeRequiredEvidence(input.gate.requiredReadOnlyEvidence);

    if (input.gate.status === 'not_applicable') {
        return buildRun({
            gate: input.gate,
            status: 'not_applicable',
            blockers: input.gate.blockers,
            warnings: input.gate.warnings
        });
    }

    if (input.gate.status === 'ready_for_resume_planning') {
        return buildRun({
            gate: input.gate,
            status: 'fresh_context_ready',
            canEnterResumePlanning: true,
            requiredReadOnlyEvidence,
            receivedEvidence: requiredReadOnlyEvidence,
            warnings: [
                ...input.gate.warnings,
                '只读上下文已由 gate 判定为新鲜；仍必须由模型生成明确恢复计划后才能写入。'
            ]
        });
    }

    if (input.gate.status !== 'ready_for_readonly_context_refresh') {
        return buildRun({
            gate: input.gate,
            status: 'blocked_gate_not_refreshable',
            requiredReadOnlyEvidence,
            blockers: input.gate.blockers.length > 0
                ? input.gate.blockers
                : ['当前 gate 不允许请求只读上下文刷新。'],
            warnings: input.gate.warnings
        });
    }

    const receivedEvidence = requiredReadOnlyEvidence.filter((key) => hasEvidenceValue(input.evidence, key));
    const missingEvidence = requiredReadOnlyEvidence.filter((key) => !receivedEvidence.includes(key));

    if (receivedEvidence.length === 0) {
        return buildRun({
            gate: input.gate,
            status: 'waiting_for_readonly_evidence',
            canRequestReadOnlyRefresh: true,
            requiredReadOnlyEvidence,
            missingEvidence,
            warnings: [
                ...input.gate.warnings,
                '尚未收到只读上下文证据；不能进入恢复执行规划。'
            ]
        });
    }

    if (missingEvidence.length > 0) {
        return buildRun({
            gate: input.gate,
            status: 'partial_readonly_evidence',
            canRequestReadOnlyRefresh: true,
            requiredReadOnlyEvidence,
            receivedEvidence,
            missingEvidence,
            warnings: [
                ...input.gate.warnings,
                '只读上下文证据不完整；不能把部分证据当作可恢复执行依据。'
            ]
        });
    }

    return buildRun({
        gate: input.gate,
        status: 'fresh_context_ready',
        canEnterResumePlanning: true,
        requiredReadOnlyEvidence,
        receivedEvidence,
        warnings: [
            ...input.gate.warnings,
            '只读上下文证据已齐备；下一步仍只允许进入模型恢复规划，不能直接写入 Photoshop。'
        ]
    });
}
