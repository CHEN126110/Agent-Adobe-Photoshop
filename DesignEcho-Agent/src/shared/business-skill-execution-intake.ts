import type { BusinessDesignSkillId } from './business-skill-implementation-checkpoint';
import type { BusinessSkillExecutionPreflightGate } from './business-skill-execution-preflight-gate';
import type { BusinessSkillPreflightPlannerEvidence } from './business-skill-preflight-planner-evidence';
import type { BusinessSkillVisualEvidenceControlDecision, BusinessSkillVisualEvidenceRefreshRunEvidence } from './business-skill-visual-evidence-control-decision';
import type { BusinessSkillVisualEvidenceRefreshPlan } from './business-skill-visual-evidence-refresh-plan';
import type { BusinessSkillVisualEvidencePreExecutionGate } from './business-skill-visual-evidence-pre-execution-gate';
import type { EvidenceRef } from './design-agent-os-contracts';

export type BusinessSkillExecutionIntakeStage =
    | 'before_executor'
    | 'after_executor'
    | 'blocked_before_executor';

export type BusinessSkillExecutionIntakeDecision =
    | 'run_existing_executor_with_evidence_warning'
    | 'run_pre_execution_refresh_then_executor'
    | 'blocked_by_strict_visual_evidence'
    | 'can_continue_existing_execution'
    | 'needs_context_evidence_only'
    | 'blocked_by_strategy_gate'
    | 'infra_only';

export interface BusinessSkillPreExecutionRunEvidence {
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
    evidence?: Array<{ source: string; summary: string; status?: string; confidence?: number }>;
    error?: string;
}

export interface BuildBusinessSkillExecutionIntakeInput {
    skillId: BusinessDesignSkillId;
    stage: BusinessSkillExecutionIntakeStage;
    preExecutionGate?: BusinessSkillVisualEvidencePreExecutionGate;
    preExecutionRun?: BusinessSkillPreExecutionRunEvidence;
    executionPreflightGate?: BusinessSkillExecutionPreflightGate;
    plannerEvidence?: BusinessSkillPreflightPlannerEvidence;
    refreshPlan?: BusinessSkillVisualEvidenceRefreshPlan;
    refreshRun?: BusinessSkillVisualEvidenceRefreshRunEvidence;
    controlDecision?: BusinessSkillVisualEvidenceControlDecision;
}

export interface BusinessSkillExecutionIntake {
    version: 'business-skill-execution-intake/v0';
    skillId: BusinessDesignSkillId;
    stage: BusinessSkillExecutionIntakeStage;
    decision: BusinessSkillExecutionIntakeDecision;
    canRunBusinessExecutor: boolean;
    shouldRunPreExecutionRefresh: boolean;
    shouldBlockBeforeExecutor: boolean;
    shouldAskForVisualEvidence: boolean;
    canClaimDesignQuality: false;
    mustNotChangeBusinessStrategy: true;
    mustNotChangeExecutor: true;
    evidenceOnly: true;
    userVisible: false;
    requiredNextEvidence: string[];
    blockers: string[];
    warnings: string[];
    limitations: string[];
    sourceEvidence: string[];
    evidence: EvidenceRef[];
}

export function buildBusinessSkillExecutionIntake(
    input: BuildBusinessSkillExecutionIntakeInput
): BusinessSkillExecutionIntake {
    const decision = inferDecision(input);
    const blockers = collectBlockers(input);
    const requiredNextEvidence = collectRequiredNextEvidence(input, decision);
    const warnings = collectWarnings(input, decision);
    const shouldBlockBeforeExecutor = decision === 'blocked_by_strict_visual_evidence'
        || (decision === 'blocked_by_strategy_gate' && input.stage !== 'after_executor');

    return {
        version: 'business-skill-execution-intake/v0',
        skillId: input.skillId,
        stage: input.stage,
        decision,
        canRunBusinessExecutor: !shouldBlockBeforeExecutor,
        shouldRunPreExecutionRefresh: decision === 'run_pre_execution_refresh_then_executor',
        shouldBlockBeforeExecutor,
        shouldAskForVisualEvidence: requiredNextEvidence.includes('visual_understanding_required')
            || requiredNextEvidence.includes('visual_understanding_required_before_execution'),
        canClaimDesignQuality: false,
        mustNotChangeBusinessStrategy: true,
        mustNotChangeExecutor: true,
        evidenceOnly: true,
        userVisible: false,
        requiredNextEvidence,
        blockers,
        warnings,
        limitations: collectLimitations(input),
        sourceEvidence: collectSourceEvidence(input),
        evidence: collectEvidence(input, decision)
    };
}

function inferDecision(
    input: BuildBusinessSkillExecutionIntakeInput
): BusinessSkillExecutionIntakeDecision {
    if (
        input.stage !== 'after_executor'
        && input.preExecutionGate?.status === 'blocked_strict_missing_visual_evidence'
    ) {
        return 'blocked_by_strict_visual_evidence';
    }

    if (
        input.stage === 'before_executor'
        && input.preExecutionGate?.shouldRunRefreshBeforeExecution === true
    ) {
        return 'run_pre_execution_refresh_then_executor';
    }

    if (
        input.plannerEvidence?.canContinueExistingExecution === true
        || input.executionPreflightGate?.status === 'ready_for_existing_execution'
    ) {
        return 'can_continue_existing_execution';
    }

    if (
        input.plannerEvidence?.plannerDisposition === 'blocked_before_strategy_change'
        || input.executionPreflightGate?.status === 'blocked'
        || input.controlDecision?.decision === 'blocked_before_strategy_change'
    ) {
        return 'blocked_by_strategy_gate';
    }

    if (input.preExecutionGate?.status === 'needs_visual_evidence') {
        return input.stage === 'before_executor'
            ? 'run_existing_executor_with_evidence_warning'
            : 'needs_context_evidence_only';
    }

    if (hasRequiredContextEvidence(input)) {
        return 'needs_context_evidence_only';
    }

    return 'infra_only';
}

function collectRequiredNextEvidence(
    input: BuildBusinessSkillExecutionIntakeInput,
    decision: BusinessSkillExecutionIntakeDecision
): string[] {
    const values = [
        ...(input.preExecutionGate?.requiredNextEvidence || []),
        ...(input.executionPreflightGate?.requiredNextEvidence || []),
        ...(input.plannerEvidence?.requiredNextEvidence || []),
        ...(input.refreshPlan?.requiredNextEvidence || []),
        ...(input.controlDecision?.requiredNextEvidence || [])
    ];

    if (decision === 'blocked_by_strict_visual_evidence') {
        values.push('visual_understanding_required_before_execution');
    }

    if (decision === 'can_continue_existing_execution') {
        return [];
    }

    return uniqueStrings(values);
}

function collectBlockers(input: BuildBusinessSkillExecutionIntakeInput): string[] {
    return uniqueStrings([
        ...(input.preExecutionGate?.blockers || []),
        ...(input.executionPreflightGate?.blockers || []),
        ...(input.plannerEvidence?.blockers || []),
        ...(input.controlDecision?.blockers || [])
    ]);
}

function collectWarnings(
    input: BuildBusinessSkillExecutionIntakeInput,
    decision: BusinessSkillExecutionIntakeDecision
): string[] {
    const warnings = [
        ...(input.preExecutionGate?.warnings || []),
        ...(input.preExecutionRun?.warnings || []),
        ...(input.executionPreflightGate?.warnings || []),
        ...(input.plannerEvidence?.warnings || []),
        ...(input.refreshPlan?.warnings || []),
        ...(input.refreshRun?.warnings || []),
        ...(input.controlDecision?.warnings || [])
    ];

    if (decision === 'run_existing_executor_with_evidence_warning') {
        warnings.push('visual_evidence_missing_but_default_policy_allows_existing_executor');
    }

    return uniqueStrings(warnings);
}

function collectLimitations(input: BuildBusinessSkillExecutionIntakeInput): string[] {
    return uniqueStrings([
        'This intake is hidden control-plane evidence and must not be shown as model thinking.',
        'It does not change business skill strategy, executor behavior, or Photoshop write order.',
        'It cannot claim main-image, detail-page, or SKU design quality.',
        'Default missing visual evidence is a warning, not a quality claim.',
        ...(input.preExecutionGate?.limitations || []),
        ...(input.preExecutionRun?.limitations || []),
        ...(input.plannerEvidence?.limitations || []),
        ...(input.refreshPlan?.limitations || []),
        ...(input.refreshRun?.limitations || []),
        ...(input.controlDecision?.limitations || [])
    ]);
}

function collectSourceEvidence(input: BuildBusinessSkillExecutionIntakeInput): string[] {
    const sources: string[] = [];
    if (input.preExecutionGate) sources.push('pre_execution_gate');
    if (input.preExecutionRun) sources.push('pre_execution_run');
    if (input.executionPreflightGate) sources.push('execution_preflight_gate');
    if (input.plannerEvidence) sources.push('planner_evidence');
    if (input.refreshPlan) sources.push('refresh_plan');
    if (input.refreshRun) sources.push('refresh_run');
    if (input.controlDecision) sources.push('control_decision');
    return uniqueStrings(sources);
}

function collectEvidence(
    input: BuildBusinessSkillExecutionIntakeInput,
    decision: BusinessSkillExecutionIntakeDecision
): EvidenceRef[] {
    return [
        {
            source: 'business-skill-execution-intake',
            summary: `skill=${input.skillId}; stage=${input.stage}; decision=${decision}`,
            status: decision === 'blocked_by_strict_visual_evidence' || decision === 'blocked_by_strategy_gate'
                ? 'failed'
                : 'needs_review'
        },
        ...normalizeEvidence(input.preExecutionGate?.evidence),
        ...normalizeEvidence(input.preExecutionRun?.evidence),
        ...normalizeEvidence(input.plannerEvidence?.evidence),
        ...normalizeEvidence(input.refreshPlan?.evidence),
        ...normalizeEvidence(input.refreshRun?.evidence),
        ...normalizeEvidence(input.controlDecision?.evidence)
    ];
}

function normalizeEvidence(
    evidence: Array<{ source: string; summary: string; status?: string; confidence?: number }> | undefined
): EvidenceRef[] {
    return (evidence || []).map((item) => ({
        source: item.source,
        summary: item.summary,
        status: normalizeEvidenceStatus(item.status),
        confidence: item.confidence
    }));
}

function normalizeEvidenceStatus(status: string | undefined): EvidenceRef['status'] {
    if (status === 'passed' || status === 'failed' || status === 'needs_review') {
        return status;
    }
    return undefined;
}

function hasRequiredContextEvidence(input: BuildBusinessSkillExecutionIntakeInput): boolean {
    return [
        ...(input.preExecutionGate?.requiredNextEvidence || []),
        ...(input.executionPreflightGate?.requiredNextEvidence || []),
        ...(input.plannerEvidence?.requiredNextEvidence || []),
        ...(input.refreshPlan?.requiredNextEvidence || [])
    ].length > 0;
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.filter((value) => String(value || '').trim())));
}
