import type {
    AgentAcceptanceIssueLayer,
    AgentAcceptanceReport
} from './agent-acceptance-contracts';
import type { AgentAcceptanceDiagnostics } from './agent-acceptance-export';

export type AgentAcceptanceTriageVersion = 'agent-acceptance-triage/v0';

export type AgentAcceptanceTriageStatus = 'ok' | 'needs_review' | 'blocked';

export type AgentAcceptanceTriageOwner =
    | 'none'
    | 'agent_control_plane'
    | 'model_or_provider'
    | 'photoshop_tooling'
    | 'verification'
    | 'user_experience'
    | 'unknown';

export type AgentAcceptanceEvidenceBoundary =
    | 'none'
    | 'diagnostic_evidence_ok'
    | 'diagnostic_evidence_invalid'
    | 'insufficient_runtime_evidence';

export interface AgentAcceptanceTriage {
    version: AgentAcceptanceTriageVersion;
    status: AgentAcceptanceTriageStatus;
    primaryIssueLayer: AgentAcceptanceIssueLayer | 'none';
    owner: AgentAcceptanceTriageOwner;
    evidenceBoundary: AgentAcceptanceEvidenceBoundary;
    designQualityClaimAllowed: false;
    blockerCount: number;
    warningCount: number;
    nextActions: string[];
}

export interface BuildAgentAcceptanceTriageInput {
    report: AgentAcceptanceReport;
    diagnostics: AgentAcceptanceDiagnostics;
}

const ISSUE_LAYER_PRIORITY: Array<AgentAcceptanceIssueLayer> = [
    'intent',
    'routing',
    'context',
    'model',
    'tool',
    'photoshop',
    'verification',
    'performance',
    'ux',
    'unknown'
];

export function buildAgentAcceptanceTriage(input: BuildAgentAcceptanceTriageInput): AgentAcceptanceTriage {
    const status = deriveTriageStatus(input.report.status);
    const evidenceBoundary = deriveEvidenceBoundary(input.diagnostics);
    const primaryIssueLayer = status === 'ok'
        ? 'none'
        : derivePrimaryIssueLayer(input.report.issueLayers, evidenceBoundary);

    return {
        version: 'agent-acceptance-triage/v0',
        status,
        primaryIssueLayer,
        owner: deriveOwner(primaryIssueLayer),
        evidenceBoundary,
        designQualityClaimAllowed: false,
        blockerCount: input.report.blockers.length,
        warningCount: input.report.warnings.length,
        nextActions: status === 'ok'
            ? []
            : deriveNextActions(primaryIssueLayer, evidenceBoundary)
    };
}

function deriveTriageStatus(reportStatus: AgentAcceptanceReport['status']): AgentAcceptanceTriageStatus {
    if (reportStatus === 'passed') return 'ok';
    if (reportStatus === 'needs_review') return 'needs_review';
    return 'blocked';
}

function derivePrimaryIssueLayer(
    issueLayers: AgentAcceptanceIssueLayer[],
    evidenceBoundary: AgentAcceptanceEvidenceBoundary
): AgentAcceptanceIssueLayer {
    if (evidenceBoundary === 'diagnostic_evidence_invalid') {
        return 'verification';
    }

    for (const layer of ISSUE_LAYER_PRIORITY) {
        if (issueLayers.includes(layer)) return layer;
    }
    return 'unknown';
}

function deriveOwner(primaryIssueLayer: AgentAcceptanceIssueLayer | 'none'): AgentAcceptanceTriageOwner {
    switch (primaryIssueLayer) {
        case 'none':
            return 'none';
        case 'intent':
        case 'routing':
        case 'context':
            return 'agent_control_plane';
        case 'model':
            return 'model_or_provider';
        case 'tool':
        case 'photoshop':
            return 'photoshop_tooling';
        case 'verification':
        case 'performance':
            return 'verification';
        case 'ux':
            return 'user_experience';
        case 'unknown':
        default:
            return 'unknown';
    }
}

function deriveEvidenceBoundary(diagnostics: AgentAcceptanceDiagnostics): AgentAcceptanceEvidenceBoundary {
    const hasControlDecision = Boolean(diagnostics.businessSkillVisualEvidenceControlDecision);
    if (!hasControlDecision) {
        return diagnostics.hasLifecycle || diagnostics.hasExecutionSummary
            ? 'insufficient_runtime_evidence'
            : 'none';
    }

    if (diagnostics.qualityClaimBoundaryOk === false || diagnostics.resultOnlyBoundaryOk === false) {
        return 'diagnostic_evidence_invalid';
    }

    return 'diagnostic_evidence_ok';
}

function deriveNextActions(
    primaryIssueLayer: AgentAcceptanceIssueLayer | 'none',
    evidenceBoundary: AgentAcceptanceEvidenceBoundary
): string[] {
    if (evidenceBoundary === 'diagnostic_evidence_invalid') {
        return [
            'fix diagnostic evidence boundary: require canClaimDesignQuality=false and resultEvidenceOnly=true'
        ];
    }

    switch (primaryIssueLayer) {
        case 'intent':
        case 'routing':
            return ['inspect routing lifecycle and deterministic skill selection before tool execution'];
        case 'context':
            return ['inspect project/document context snapshot and required context blockers'];
        case 'model':
            return ['inspect provider response, model configuration and tool-call compatibility'];
        case 'tool':
        case 'photoshop':
            return ['inspect Photoshop tool events, tool parameters and acceptance snapshots'];
        case 'verification':
            return ['inspect acceptance report blockers, warnings and verification evidence'];
        case 'performance':
            return ['inspect runtime budget, iteration count and tool-call latency'];
        case 'ux':
            return ['inspect visible feedback boundary and user-facing report rendering'];
        case 'unknown':
        case 'none':
        default:
            return ['inspect acceptance report checks and debug bundle evidence'];
    }
}
