import type { BusinessDesignSkillId } from './business-skill-implementation-checkpoint';
import type {
    BusinessSkillExecutionPreflightAction,
    BusinessSkillExecutionPreflightClaimBoundary,
    BusinessSkillExecutionPreflightGate,
    BusinessSkillExecutionPreflightStatus,
    BusinessSkillExecutionRequestKind
} from './business-skill-execution-preflight-gate';
import type { EvidenceRef } from './design-agent-os-contracts';

export type BusinessSkillPreflightPlannerDisposition =
    | 'can_continue_existing_execution'
    | 'needs_context_before_quality_claim'
    | 'blocked_before_strategy_change'
    | 'ready_for_strategy_design'
    | 'infra_only';

export interface BusinessSkillPreflightPlannerDecisionInputs {
    gateStatus: BusinessSkillExecutionPreflightStatus;
    requestKind: BusinessSkillExecutionRequestKind;
    allowedActions: BusinessSkillExecutionPreflightAction[];
    blockers: string[];
    requiredNextEvidence: string[];
    claimBoundary: BusinessSkillExecutionPreflightClaimBoundary[];
}

export interface BusinessSkillPreflightPlannerEvidence {
    version: 'business-skill-preflight-planner-evidence/v0';
    skillId: BusinessDesignSkillId;
    requestKind: BusinessSkillExecutionRequestKind;
    gateStatus: BusinessSkillExecutionPreflightStatus;
    plannerDisposition: BusinessSkillPreflightPlannerDisposition;
    canContinueExistingExecution: boolean;
    canChangeBusinessStrategy: boolean;
    canClaimDesignQuality: false;
    mustNotChangeExecutor: true;
    resultEvidenceOnly: true;
    allowedActions: BusinessSkillExecutionPreflightAction[];
    blockers: string[];
    warnings: string[];
    requiredNextEvidence: string[];
    claimBoundary: BusinessSkillExecutionPreflightClaimBoundary[];
    decisionInputs: BusinessSkillPreflightPlannerDecisionInputs;
    limitations: string[];
    evidence: EvidenceRef[];
}

export function buildBusinessSkillPreflightPlannerEvidence(
    gate: BusinessSkillExecutionPreflightGate
): BusinessSkillPreflightPlannerEvidence {
    const plannerDisposition = mapPlannerDisposition(gate);

    return {
        version: 'business-skill-preflight-planner-evidence/v0',
        skillId: gate.skillId,
        requestKind: gate.requestKind,
        gateStatus: gate.status,
        plannerDisposition,
        canContinueExistingExecution: gate.status === 'ready_for_existing_execution',
        canChangeBusinessStrategy: gate.canChangeBusinessStrategy === true,
        canClaimDesignQuality: false,
        mustNotChangeExecutor: true,
        resultEvidenceOnly: true,
        allowedActions: gate.allowedActions,
        blockers: gate.blockers,
        warnings: gate.warnings,
        requiredNextEvidence: gate.requiredNextEvidence,
        claimBoundary: gate.claimBoundary,
        decisionInputs: {
            gateStatus: gate.status,
            requestKind: gate.requestKind,
            allowedActions: gate.allowedActions,
            blockers: gate.blockers,
            requiredNextEvidence: gate.requiredNextEvidence,
            claimBoundary: gate.claimBoundary
        },
        limitations: [
            'Planner evidence is derived from businessSkillExecutionPreflightGate after executor result construction.',
            'It is read-only result evidence and must not block or rewrite existing business skill execution.',
            'It cannot claim main-image, detail-page or SKU design quality.',
            'It cannot replace visual understanding, Photoshop bounds, screenshot QA or manual acceptance.'
        ],
        evidence: [{
            source: 'business-skill-execution-preflight-gate',
            summary: `skill=${gate.skillId}; status=${gate.status}; disposition=${plannerDisposition}`,
            status: gate.status === 'blocked' ? 'failed' : 'needs_review'
        }]
    };
}

function mapPlannerDisposition(
    gate: BusinessSkillExecutionPreflightGate
): BusinessSkillPreflightPlannerDisposition {
    if (gate.status === 'blocked') {
        return 'blocked_before_strategy_change';
    }

    if (gate.status === 'needs_context') {
        return 'needs_context_before_quality_claim';
    }

    if (gate.status === 'ready_for_existing_execution') {
        return 'can_continue_existing_execution';
    }

    if (gate.status === 'ready_for_strategy_design') {
        return 'ready_for_strategy_design';
    }

    return 'infra_only';
}
