import type {
    AgentAcceptanceBusinessSkillVisualEvidenceControlDecision,
    AgentAcceptanceBusinessSkillEvidenceIntake,
    AgentAcceptanceIssueLayer,
    AgentAcceptanceReport,
    AgentAcceptanceStatus,
    AgentRunDebugBundle
} from './agent-acceptance-contracts';
import {
    buildAgentAcceptanceTriage,
    type AgentAcceptanceTriage
} from './agent-acceptance-triage';
import type { AgentExecutionLifecycleSnapshot } from './agent-execution-lifecycle';
import { isAgentExecutionLifecycleBoundaryOk } from './agent-execution-lifecycle';
import type { AgentIntentDecisionIntake } from './agent-intent-decision-intake';
import { isAgentIntentDecisionBoundaryOk } from './agent-intent-decision-intake';

export type AgentAcceptanceDiagnosticsVersion = 'agent-acceptance-diagnostics/v0';

export interface AgentAcceptanceDiagnostics {
    version: AgentAcceptanceDiagnosticsVersion;
    caseId: string;
    reportStatus: AgentAcceptanceStatus;
    issueLayers: AgentAcceptanceIssueLayer[];
    blockerCount: number;
    warningCount: number;
    diagnosticEvidenceKeys: string[];
    hasDiagnosticEvidence: boolean;
    hasLifecycle: boolean;
    agentExecutionLifecycleSnapshot?: AgentExecutionLifecycleSnapshot;
    agentIntentDecisionIntake?: AgentIntentDecisionIntake;
    hasExecutionSummary: boolean;
    toolCount: number;
    businessSkillVisualEvidenceControlDecision?: AgentAcceptanceBusinessSkillVisualEvidenceControlDecision;
    businessSkillImagePlacementVerificationIntake?: AgentAcceptanceBusinessSkillEvidenceIntake;
    businessSkillExecutionPlanIntake?: AgentAcceptanceBusinessSkillEvidenceIntake;
    executionLifecycleBoundaryOk?: boolean;
    intentDecisionIntakeBoundaryOk?: boolean;
    qualityClaimBoundaryOk?: boolean;
    resultOnlyBoundaryOk?: boolean;
    imagePlacementIntakeBoundaryOk?: boolean;
    executionPlanIntakeBoundaryOk?: boolean;
}

export interface AgentAcceptanceDebugExport {
    bundle: AgentRunDebugBundle;
    report: AgentAcceptanceReport;
    acceptanceDiagnostics: AgentAcceptanceDiagnostics;
    acceptanceTriage: AgentAcceptanceTriage;
}

export interface BuildAgentAcceptanceDebugExportInput {
    bundle: AgentRunDebugBundle;
    report: AgentAcceptanceReport;
}

export function buildAgentAcceptanceDebugExport(
    input: BuildAgentAcceptanceDebugExportInput
): AgentAcceptanceDebugExport {
    const controlDecision = input.report.evidence.businessSkillVisualEvidenceControlDecision;
    const acceptanceDiagnostics = buildAgentAcceptanceDiagnostics(input.report, controlDecision);

    return {
        bundle: input.bundle,
        report: input.report,
        acceptanceDiagnostics,
        acceptanceTriage: buildAgentAcceptanceTriage({
            report: input.report,
            diagnostics: acceptanceDiagnostics
        })
    };
}

function buildAgentAcceptanceDiagnostics(
    report: AgentAcceptanceReport,
    controlDecision: AgentAcceptanceBusinessSkillVisualEvidenceControlDecision | undefined
): AgentAcceptanceDiagnostics {
    return {
        version: 'agent-acceptance-diagnostics/v0',
        caseId: report.caseId,
        reportStatus: report.status,
        issueLayers: report.issueLayers,
        blockerCount: report.blockers.length,
        warningCount: report.warnings.length,
        diagnosticEvidenceKeys: report.evidence.diagnosticEvidenceKeys,
        hasDiagnosticEvidence: report.evidence.hasDiagnosticEvidence,
        hasLifecycle: report.evidence.hasLifecycle,
        agentExecutionLifecycleSnapshot: report.evidence.agentExecutionLifecycleSnapshot,
        agentIntentDecisionIntake: report.evidence.agentIntentDecisionIntake,
        hasExecutionSummary: report.evidence.hasExecutionSummary,
        toolCount: report.evidence.toolCount,
        businessSkillVisualEvidenceControlDecision: controlDecision,
        businessSkillImagePlacementVerificationIntake: report.evidence.businessSkillImagePlacementVerificationIntake,
        businessSkillExecutionPlanIntake: report.evidence.businessSkillExecutionPlanIntake,
        executionLifecycleBoundaryOk: isAgentExecutionLifecycleBoundaryOk(
            report.evidence.agentExecutionLifecycleSnapshot
        ),
        intentDecisionIntakeBoundaryOk: isAgentIntentDecisionBoundaryOk(report.evidence.agentIntentDecisionIntake),
        qualityClaimBoundaryOk: deriveQualityClaimBoundary(controlDecision),
        resultOnlyBoundaryOk: deriveResultOnlyBoundary(controlDecision),
        imagePlacementIntakeBoundaryOk: deriveBusinessSkillIntakeBoundary(
            report.evidence.businessSkillImagePlacementVerificationIntake
        ),
        executionPlanIntakeBoundaryOk: deriveBusinessSkillIntakeBoundary(
            report.evidence.businessSkillExecutionPlanIntake
        )
    };
}

function deriveQualityClaimBoundary(
    controlDecision: AgentAcceptanceBusinessSkillVisualEvidenceControlDecision | undefined
): boolean | undefined {
    if (!controlDecision) return undefined;
    return controlDecision.canClaimDesignQuality === false;
}

function deriveResultOnlyBoundary(
    controlDecision: AgentAcceptanceBusinessSkillVisualEvidenceControlDecision | undefined
): boolean | undefined {
    if (!controlDecision) return undefined;
    return controlDecision.resultEvidenceOnly === true;
}

function deriveBusinessSkillIntakeBoundary(
    intake: AgentAcceptanceBusinessSkillEvidenceIntake | undefined
): boolean | undefined {
    if (!intake) return undefined;
    return intake.canClaimDesignQuality === false
        && intake.userVisible === false
        && intake.evidenceOnly === true;
}
