import type { BusinessDesignSkillId } from './business-skill-implementation-checkpoint';
import type { EvidenceRef } from './design-agent-os-contracts';
import {
    buildProjectVisualInsightCacheFillPlan,
    type ProjectVisualInsightCacheFillPlan,
    type ProjectVisualInsightCacheFillStatus
} from './project-visual-insight-cache-fill';
import type { ProjectVisualSamplingPlan } from './project-visual-sampling';
import type { BusinessSkillPreflightPlannerEvidence } from './business-skill-preflight-planner-evidence';

export type BusinessSkillVisualEvidenceRefreshStatus =
    | 'not_needed'
    | ProjectVisualInsightCacheFillStatus;

export interface BuildBusinessSkillVisualEvidenceRefreshPlanInput {
    skillId: BusinessDesignSkillId;
    plannerEvidence?: BusinessSkillPreflightPlannerEvidence;
    projectPath?: string | null;
    visualSamplingPlan?: ProjectVisualSamplingPlan | null;
    enabled?: unknown;
    runtimeCanAnalyze?: boolean;
    runtimeCanWriteCache?: boolean;
    maxCandidates?: number;
}

export interface BusinessSkillVisualEvidenceRefreshPlan {
    version: 'business-skill-visual-evidence-refresh-plan/v0';
    skillId: BusinessDesignSkillId;
    status: BusinessSkillVisualEvidenceRefreshStatus;
    enabled: boolean;
    missingVisualUnderstanding: boolean;
    shouldRunRefresh: boolean;
    projectPath?: string;
    requiredNextEvidence: string[];
    fillPlan?: ProjectVisualInsightCacheFillPlan;
    warnings: string[];
    limitations: string[];
    evidence: EvidenceRef[];
}

function cleanString(value: unknown): string {
    return String(value || '').trim();
}

function isEnabled(value: unknown): boolean {
    if (value === true) return true;
    const text = cleanString(value).toLowerCase();
    return ['true', '1', 'yes', 'on', 'enabled', 'auto', 'required'].includes(text);
}

function buildEvidence(
    status: BusinessSkillVisualEvidenceRefreshStatus,
    summary: string
): EvidenceRef[] {
    return [{
        source: 'business-skill-visual-evidence-refresh-plan',
        summary,
        status: status === 'failed' ? 'failed' : 'needs_review'
    }];
}

function getMissingVisualUnderstanding(plannerEvidence: BusinessSkillPreflightPlannerEvidence | undefined): boolean {
    return Boolean(plannerEvidence?.requiredNextEvidence.includes('visual_understanding_required'));
}

export function buildBusinessSkillVisualEvidenceRefreshPlan(
    input: BuildBusinessSkillVisualEvidenceRefreshPlanInput
): BusinessSkillVisualEvidenceRefreshPlan {
    const enabled = isEnabled(input.enabled);
    const projectPath = cleanString(input.projectPath);
    const requiredNextEvidence = input.plannerEvidence?.requiredNextEvidence || [];
    const missingVisualUnderstanding = getMissingVisualUnderstanding(input.plannerEvidence);
    const commonLimitations = [
        'This is a read-only control-plane plan; it does not call a model or write cache by itself.',
        'Visual evidence refresh must be explicitly enabled and executed by a separate runner.',
        'A refresh plan cannot claim main-image, detail-page or SKU design quality.'
    ];

    if (!missingVisualUnderstanding) {
        const summary = 'Current planner evidence does not require visual understanding refresh.';
        return {
            version: 'business-skill-visual-evidence-refresh-plan/v0',
            skillId: input.skillId,
            status: 'not_needed',
            enabled,
            missingVisualUnderstanding,
            shouldRunRefresh: false,
            projectPath: projectPath || undefined,
            requiredNextEvidence,
            warnings: [],
            limitations: commonLimitations,
            evidence: buildEvidence('not_needed', summary)
        };
    }

    const fillPlan = buildProjectVisualInsightCacheFillPlan({
        projectPath,
        visualSamplingPlan: input.visualSamplingPlan,
        enabled,
        hasAnalyzer: input.runtimeCanAnalyze === true,
        hasWriter: input.runtimeCanWriteCache === true,
        maxCandidates: input.maxCandidates
    });

    const summary = `Visual understanding evidence is required; refresh status=${fillPlan.status}.`;
    return {
        version: 'business-skill-visual-evidence-refresh-plan/v0',
        skillId: input.skillId,
        status: fillPlan.status,
        enabled,
        missingVisualUnderstanding,
        shouldRunRefresh: fillPlan.shouldCallAnalyzer === true,
        projectPath: projectPath || undefined,
        requiredNextEvidence,
        fillPlan,
        warnings: fillPlan.warnings,
        limitations: [
            ...commonLimitations,
            ...fillPlan.limitations
        ],
        evidence: [
            ...buildEvidence(fillPlan.status, summary),
            ...fillPlan.evidence
        ]
    };
}
