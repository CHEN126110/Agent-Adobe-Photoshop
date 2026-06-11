import {
    BUSINESS_DESIGN_SKILL_IDS,
    type BusinessDesignSkillId,
    type BusinessSkillImplementationEvidence,
    buildBusinessSkillImplementationCheckpoint
} from './business-skill-implementation-checkpoint';
import {
    type AgentAcceptanceControlPlaneModeId,
    type AgentAcceptanceControlPlaneReport,
    type AgentAcceptanceControlPlaneRuntime,
    buildAgentAcceptanceControlPlane
} from './agent-acceptance-control-plane';

const BUSINESS_SKILL_EXECUTION_PREFLIGHT_REQUIRED_SKILL_IDS: BusinessDesignSkillId[] = [
    'main-image-design',
    'detail-page-design',
    'sku-batch'
];

export const BUSINESS_SKILL_EXECUTION_PREFLIGHT_SKILL_IDS = BUSINESS_DESIGN_SKILL_IDS
    .filter((skillId) => BUSINESS_SKILL_EXECUTION_PREFLIGHT_REQUIRED_SKILL_IDS.includes(skillId));

export type BusinessSkillExecutionRequestKind =
    | 'inspect'
    | 'infra_evidence'
    | 'business_strategy'
    | 'execute_existing';

export type BusinessSkillExecutionPreflightStatus =
    | 'blocked'
    | 'needs_context'
    | 'ready_for_infra_only'
    | 'ready_for_strategy_design'
    | 'ready_for_existing_execution';

export type BusinessSkillExecutionPreflightAction =
    | 'inspect_current_state'
    | 'attach_readonly_evidence'
    | 'draft_business_strategy'
    | 'run_existing_skill_executor';

export type BusinessSkillExecutionPreflightClaimBoundary =
    | 'does_not_prove_business_skill_design_quality'
    | 'does_not_change_photoshop_write_order'
    | 'does_not_change_business_skill_executor_behavior'
    | 'offline_acceptance_does_not_prove_photoshop_write'
    | 'fake_photoshop_does_not_prove_real_write'
    | 'live_disposable_write_does_not_prove_open_ended_design_quality';

export interface BusinessSkillExecutionContextEvidence {
    hasProjectContext?: boolean;
    hasAssetIndex?: boolean;
    hasVisualSamplingPlan?: boolean;
    hasVisualUnderstanding?: boolean;
    hasTemplateEvidence?: boolean;
    [key: string]: unknown;
}

export interface BusinessSkillExecutionAcceptanceInput {
    mode?: AgentAcceptanceControlPlaneModeId;
    optInFlags?: Record<string, boolean | string | undefined>;
    runtime?: AgentAcceptanceControlPlaneRuntime;
}

export interface BuildBusinessSkillExecutionPreflightGateInput {
    skillId: BusinessDesignSkillId;
    requestKind?: BusinessSkillExecutionRequestKind;
    userCheckpointConfirmed?: boolean;
    implementationEvidence?: BusinessSkillImplementationEvidence;
    contextEvidence?: BusinessSkillExecutionContextEvidence;
    acceptance?: BusinessSkillExecutionAcceptanceInput;
}

export interface BusinessSkillExecutionPreflightGate {
    version: 'business-skill-execution-preflight-gate/v0';
    skillId: BusinessDesignSkillId;
    requestKind: BusinessSkillExecutionRequestKind;
    status: BusinessSkillExecutionPreflightStatus;
    canChangeBusinessStrategy: boolean;
    allowedActions: BusinessSkillExecutionPreflightAction[];
    blockers: string[];
    warnings: string[];
    requiredNextEvidence: string[];
    claimBoundary: BusinessSkillExecutionPreflightClaimBoundary[];
    implementationCheckpoint: ReturnType<typeof buildBusinessSkillImplementationCheckpoint>;
    acceptanceControlPlane?: AgentAcceptanceControlPlaneReport;
}

const REQUIRED_EXECUTION_CONTEXT = [
    'hasProjectContext',
    'hasAssetIndex',
    'hasVisualSamplingPlan',
    'hasVisualUnderstanding',
    'hasTemplateEvidence'
] as const;

const CONTEXT_REQUIREMENT_BY_KEY: Record<typeof REQUIRED_EXECUTION_CONTEXT[number], string> = {
    hasProjectContext: 'project_context_required',
    hasAssetIndex: 'asset_index_required',
    hasVisualSamplingPlan: 'visual_sampling_plan_required',
    hasVisualUnderstanding: 'visual_understanding_required',
    hasTemplateEvidence: 'template_evidence_required'
};

const BASE_CLAIM_BOUNDARY: BusinessSkillExecutionPreflightClaimBoundary[] = [
    'does_not_prove_business_skill_design_quality',
    'does_not_change_photoshop_write_order',
    'does_not_change_business_skill_executor_behavior'
];

export function buildBusinessSkillExecutionPreflightGate(
    input: BuildBusinessSkillExecutionPreflightGateInput
): BusinessSkillExecutionPreflightGate {
    const requestKind = input.requestKind || 'inspect';
    const implementationCheckpoint = buildBusinessSkillImplementationCheckpoint({
        skillId: input.skillId,
        intendedChange: requestKind === 'business_strategy' ? 'business-strategy' : 'infra-only',
        userCheckpointConfirmed: input.userCheckpointConfirmed === true,
        evidence: input.implementationEvidence || {}
    });
    const acceptanceControlPlane = buildAcceptanceControlPlane(input.acceptance);
    const blockers = buildBlockers(requestKind, implementationCheckpoint, acceptanceControlPlane);
    const contextEvidence = buildRequiredContextEvidence(requestKind, input.contextEvidence);
    const warnings = buildWarnings(implementationCheckpoint.warnings, acceptanceControlPlane);
    const requiredNextEvidence = buildRequiredNextEvidence(
        requestKind,
        implementationCheckpoint.missingEvidence,
        contextEvidence
    );
    const claimBoundary = buildClaimBoundary(acceptanceControlPlane);
    const status = buildStatus({
        requestKind,
        implementationReady: implementationCheckpoint.canChangeBusinessStrategy,
        blockers,
        requiredNextEvidence
    });

    return {
        version: 'business-skill-execution-preflight-gate/v0',
        skillId: input.skillId,
        requestKind,
        status,
        canChangeBusinessStrategy: status === 'ready_for_strategy_design',
        allowedActions: buildAllowedActions(status),
        blockers,
        warnings,
        requiredNextEvidence,
        claimBoundary,
        implementationCheckpoint,
        acceptanceControlPlane
    };
}

function buildAcceptanceControlPlane(
    acceptance: BusinessSkillExecutionAcceptanceInput | undefined
): AgentAcceptanceControlPlaneReport | undefined {
    if (!acceptance?.mode) return undefined;

    return buildAgentAcceptanceControlPlane({
        mode: acceptance.mode,
        optInFlags: acceptance.optInFlags,
        runtime: acceptance.runtime
    });
}

function buildRequiredContextEvidence(
    requestKind: BusinessSkillExecutionRequestKind,
    contextEvidence: BusinessSkillExecutionContextEvidence | undefined
): string[] {
    if (requestKind !== 'execute_existing' && requestKind !== 'business_strategy') {
        return [];
    }

    return REQUIRED_EXECUTION_CONTEXT
        .filter((key) => contextEvidence?.[key] !== true)
        .map((key) => CONTEXT_REQUIREMENT_BY_KEY[key]);
}

function buildBlockers(
    requestKind: BusinessSkillExecutionRequestKind,
    implementationCheckpoint: ReturnType<typeof buildBusinessSkillImplementationCheckpoint>,
    acceptanceControlPlane: AgentAcceptanceControlPlaneReport | undefined
): string[] {
    const blockers: string[] = [];

    if (requestKind === 'business_strategy') {
        blockers.push(...implementationCheckpoint.blockers);
    }

    if (acceptanceControlPlane && !acceptanceControlPlane.canRun) {
        blockers.push('acceptance_mode_not_available');
    }

    return uniqueStrings(blockers);
}

function buildWarnings(
    implementationWarnings: string[],
    acceptanceControlPlane: AgentAcceptanceControlPlaneReport | undefined
): string[] {
    const warnings = [...implementationWarnings];

    if (acceptanceControlPlane?.usesFakePhotoshop === true) {
        warnings.push('fake_photoshop_boundary');
    }

    if (acceptanceControlPlane?.usesRealProvider === true) {
        warnings.push('real_provider_boundary');
    }

    return uniqueStrings(warnings);
}

function buildRequiredNextEvidence(
    requestKind: BusinessSkillExecutionRequestKind,
    missingImplementationEvidence: string[],
    missingContextEvidence: string[]
): string[] {
    const requiredEvidence: string[] = [];

    if (requestKind === 'business_strategy') {
        requiredEvidence.push(...missingImplementationEvidence.map((key) => `implementation_${key}_required`));
    }

    requiredEvidence.push(...missingContextEvidence);

    return uniqueStrings(requiredEvidence);
}

function buildClaimBoundary(
    acceptanceControlPlane: AgentAcceptanceControlPlaneReport | undefined
): BusinessSkillExecutionPreflightClaimBoundary[] {
    const boundaries = [...BASE_CLAIM_BOUNDARY];

    if (!acceptanceControlPlane) {
        return boundaries;
    }

    if (acceptanceControlPlane.mode === 'offline-static') {
        boundaries.push('offline_acceptance_does_not_prove_photoshop_write');
    }

    if (acceptanceControlPlane.usesFakePhotoshop) {
        boundaries.push('fake_photoshop_does_not_prove_real_write');
    }

    if (acceptanceControlPlane.mode === 'live-photoshop-disposable') {
        boundaries.push('live_disposable_write_does_not_prove_open_ended_design_quality');
    }

    return uniqueClaimBoundaries(boundaries);
}

function buildStatus(input: {
    requestKind: BusinessSkillExecutionRequestKind;
    implementationReady: boolean;
    blockers: string[];
    requiredNextEvidence: string[];
}): BusinessSkillExecutionPreflightStatus {
    if (input.blockers.length > 0) {
        return 'blocked';
    }

    switch (input.requestKind) {
        case 'business_strategy':
            if (input.requiredNextEvidence.length > 0 || !input.implementationReady) {
                return 'needs_context';
            }
            return 'ready_for_strategy_design';
        case 'execute_existing':
            if (input.requiredNextEvidence.length > 0) {
                return 'needs_context';
            }
            return 'ready_for_existing_execution';
        case 'infra_evidence':
        case 'inspect':
            return 'ready_for_infra_only';
        default:
            return 'blocked';
    }
}

function buildAllowedActions(
    status: BusinessSkillExecutionPreflightStatus
): BusinessSkillExecutionPreflightAction[] {
    switch (status) {
        case 'ready_for_strategy_design':
            return ['inspect_current_state', 'attach_readonly_evidence', 'draft_business_strategy'];
        case 'ready_for_existing_execution':
            return ['inspect_current_state', 'run_existing_skill_executor'];
        case 'ready_for_infra_only':
            return ['inspect_current_state', 'attach_readonly_evidence'];
        case 'needs_context':
            return ['inspect_current_state', 'attach_readonly_evidence'];
        case 'blocked':
        default:
            return ['inspect_current_state'];
    }
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values));
}

function uniqueClaimBoundaries(
    values: BusinessSkillExecutionPreflightClaimBoundary[]
): BusinessSkillExecutionPreflightClaimBoundary[] {
    return Array.from(new Set(values));
}
