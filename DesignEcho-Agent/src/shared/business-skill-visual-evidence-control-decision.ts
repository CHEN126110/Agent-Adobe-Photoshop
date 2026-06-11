import type { BusinessDesignSkillId } from './business-skill-implementation-checkpoint';
import type { BusinessSkillPreflightPlannerEvidence } from './business-skill-preflight-planner-evidence';
import type { BusinessSkillVisualEvidenceRefreshPlan } from './business-skill-visual-evidence-refresh-plan';
import type { EvidenceRef } from './design-agent-os-contracts';

export type BusinessSkillVisualEvidenceControlDecisionKind =
    | 'can_continue_existing_execution'
    | 'needs_visual_evidence_before_quality_claim'
    | 'refresh_ready_after_explicit_opt_in'
    | 'refresh_completed_after_execution'
    | 'refresh_failed_evidence_only'
    | 'blocked_before_strategy_change'
    | 'infra_only';

export interface BusinessSkillVisualEvidenceRefreshRunEvidence {
    status?: string;
    attempted?: boolean;
    planStatus?: string;
    reason?: string;
    analyzedCount?: number;
    successCount?: number;
    failedCount?: number;
    writtenEntryCount?: number;
    warnings?: string[];
    limitations?: string[];
    evidence?: EvidenceRef[];
    error?: string;
}

export interface BuildBusinessSkillVisualEvidenceControlDecisionInput {
    plannerEvidence?: BusinessSkillPreflightPlannerEvidence;
    refreshPlan?: BusinessSkillVisualEvidenceRefreshPlan;
    refreshRun?: BusinessSkillVisualEvidenceRefreshRunEvidence;
}

export interface BusinessSkillVisualEvidenceControlDecision {
    version: 'business-skill-visual-evidence-control-decision/v0';
    skillId?: BusinessDesignSkillId;
    decision: BusinessSkillVisualEvidenceControlDecisionKind;
    canContinueExistingExecution: boolean;
    canChangeBusinessStrategy: boolean;
    canClaimDesignQuality: false;
    shouldAskForVisualEvidence: boolean;
    shouldRunRefreshForFutureExecution: boolean;
    visualEvidenceRefreshed: boolean;
    mustNotChangeExecutor: true;
    resultEvidenceOnly: true;
    gateStatus?: string;
    plannerDisposition?: string;
    refreshPlanStatus?: string;
    refreshRunStatus?: string;
    blockers: string[];
    warnings: string[];
    requiredNextEvidence: string[];
    limitations: string[];
    evidence: EvidenceRef[];
}

export function buildBusinessSkillVisualEvidenceControlDecision(
    input: BuildBusinessSkillVisualEvidenceControlDecisionInput
): BusinessSkillVisualEvidenceControlDecision {
    const decision = inferDecision(input);
    const visualEvidenceRefreshed = isRefreshRunSuccessful(input.refreshRun);
    const requiredNextEvidence = input.plannerEvidence?.requiredNextEvidence || [];
    const warnings = [
        ...(input.plannerEvidence?.warnings || []),
        ...(input.refreshPlan?.warnings || []),
        ...(input.refreshRun?.warnings || [])
    ];
    const blockers = input.plannerEvidence?.blockers || [];

    return {
        version: 'business-skill-visual-evidence-control-decision/v0',
        skillId: input.plannerEvidence?.skillId || input.refreshPlan?.skillId,
        decision,
        canContinueExistingExecution: decision === 'can_continue_existing_execution',
        canChangeBusinessStrategy: input.plannerEvidence?.canChangeBusinessStrategy === true,
        canClaimDesignQuality: false,
        shouldAskForVisualEvidence: decision === 'needs_visual_evidence_before_quality_claim',
        shouldRunRefreshForFutureExecution: decision === 'refresh_ready_after_explicit_opt_in',
        visualEvidenceRefreshed,
        mustNotChangeExecutor: true,
        resultEvidenceOnly: true,
        gateStatus: input.plannerEvidence?.gateStatus,
        plannerDisposition: input.plannerEvidence?.plannerDisposition,
        refreshPlanStatus: input.refreshPlan?.status,
        refreshRunStatus: input.refreshRun?.status,
        blockers,
        warnings,
        requiredNextEvidence,
        limitations: buildLimitations(input),
        evidence: buildEvidence(input, decision)
    };
}

function inferDecision(
    input: BuildBusinessSkillVisualEvidenceControlDecisionInput
): BusinessSkillVisualEvidenceControlDecisionKind {
    if (!input.plannerEvidence) {
        return 'infra_only';
    }

    if (input.plannerEvidence.plannerDisposition === 'blocked_before_strategy_change') {
        return 'blocked_before_strategy_change';
    }

    if (input.refreshRun?.attempted === true) {
        return isRefreshRunSuccessful(input.refreshRun)
            ? 'refresh_completed_after_execution'
            : 'refresh_failed_evidence_only';
    }

    if (input.refreshPlan?.shouldRunRefresh === true) {
        return 'refresh_ready_after_explicit_opt_in';
    }

    if (input.refreshPlan?.missingVisualUnderstanding === true) {
        return 'needs_visual_evidence_before_quality_claim';
    }

    if (input.plannerEvidence.canContinueExistingExecution === true) {
        return 'can_continue_existing_execution';
    }

    if (input.plannerEvidence.requiredNextEvidence.includes('visual_understanding_required')) {
        return 'needs_visual_evidence_before_quality_claim';
    }

    return 'infra_only';
}

function isRefreshRunSuccessful(run: BusinessSkillVisualEvidenceRefreshRunEvidence | undefined): boolean {
    if (!run || run.attempted !== true) return false;
    if (Number(run.successCount || 0) > 0) return true;
    return ['completed', 'partial'].includes(String(run.status || ''));
}

function buildLimitations(
    input: BuildBusinessSkillVisualEvidenceControlDecisionInput
): string[] {
    return [
        'This decision is control-plane evidence only and must not be shown as model thinking.',
        'It does not change business skill executor behavior or Photoshop write order.',
        'It cannot claim main-image, detail-page or SKU design quality.',
        'A completed refresh means visual evidence was collected for future decisions; it does not validate the current Photoshop output.',
        ...(input.plannerEvidence?.limitations || []),
        ...(input.refreshPlan?.limitations || []),
        ...(input.refreshRun?.limitations || [])
    ];
}

function buildEvidence(
    input: BuildBusinessSkillVisualEvidenceControlDecisionInput,
    decision: BusinessSkillVisualEvidenceControlDecisionKind
): EvidenceRef[] {
    return [
        {
            source: 'business-skill-visual-evidence-control-decision',
            summary: `decision=${decision}; planner=${input.plannerEvidence?.plannerDisposition || 'missing'}; refreshPlan=${input.refreshPlan?.status || 'missing'}; refreshRun=${input.refreshRun?.status || 'missing'}`,
            status: decision === 'refresh_failed_evidence_only' || decision === 'blocked_before_strategy_change'
                ? 'failed'
                : 'needs_review'
        },
        ...(input.plannerEvidence?.evidence || []),
        ...(input.refreshPlan?.evidence || []),
        ...(input.refreshRun?.evidence || [])
    ];
}
