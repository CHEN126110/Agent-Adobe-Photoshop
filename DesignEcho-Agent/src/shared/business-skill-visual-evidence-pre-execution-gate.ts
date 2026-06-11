import type { BusinessDesignSkillId } from './business-skill-implementation-checkpoint';
import type { EvidenceRef } from './design-agent-os-contracts';
import {
    buildProjectVisualInsightCacheFillPlan,
    type ProjectVisualInsightCacheFillPlan
} from './project-visual-insight-cache-fill';
import type { ProjectVisualSamplingPlan, ProjectVisualSamplingScenario } from './project-visual-sampling';

export type BusinessSkillVisualEvidencePreExecutionStatus =
    | 'ready_existing_visual_evidence'
    | 'needs_visual_evidence'
    | 'refresh_ready_before_execution'
    | 'blocked_strict_missing_visual_evidence'
    | 'not_applicable';

export interface BuildBusinessSkillVisualEvidencePreExecutionGateInput {
    skillId: BusinessDesignSkillId;
    projectPath?: string | null;
    visualSamplingPlan?: ProjectVisualSamplingPlan | null;
    expectedVisualSamplingScenario?: ProjectVisualSamplingScenario | null;
    hasProjectContext?: boolean;
    hasAssetIndex?: boolean;
    hasVisualSamplingPlan?: boolean;
    hasVisualUnderstanding?: boolean;
    enabled?: unknown;
    runBeforeExecution?: unknown;
    requireBeforeExecution?: unknown;
    runtimeCanAnalyze?: boolean;
    runtimeCanWriteCache?: boolean;
    maxCandidates?: number;
}

export interface BusinessSkillVisualEvidencePreExecutionGate {
    version: 'business-skill-visual-evidence-pre-execution-gate/v0';
    skillId: BusinessDesignSkillId;
    status: BusinessSkillVisualEvidencePreExecutionStatus;
    canRunBusinessExecutor: boolean;
    shouldRunRefreshBeforeExecution: boolean;
    canClaimDesignQuality: false;
    mustNotChangeBusinessStrategy: true;
    evidenceOnlyByDefault: true;
    projectPath?: string;
    requiredNextEvidence: string[];
    blockers: string[];
    warnings: string[];
    limitations: string[];
    refreshPlan?: ProjectVisualInsightCacheFillPlan;
    evidence: EvidenceRef[];
}

function cleanString(value: unknown): string {
    return String(value || '').trim();
}

function parseBooleanFlag(value: unknown): boolean {
    if (value === true) return true;
    const text = cleanString(value).toLowerCase();
    return ['true', '1', 'yes', 'on', 'enabled', 'auto', 'required'].includes(text);
}

function hasMatchingVisualSamplingScenario(input: BuildBusinessSkillVisualEvidencePreExecutionGateInput): boolean {
    if (!input.expectedVisualSamplingScenario) return true;
    return input.visualSamplingPlan?.scenario === input.expectedVisualSamplingScenario;
}

function buildScenarioWarnings(
    input: BuildBusinessSkillVisualEvidencePreExecutionGateInput,
    visualSamplingScenarioMatches: boolean
): string[] {
    if (visualSamplingScenarioMatches || !input.expectedVisualSamplingScenario) return [];
    return [
        `VisualSamplingPlan scenario mismatch: expected ${input.expectedVisualSamplingScenario}, got ${input.visualSamplingPlan?.scenario || 'missing'}.`
    ];
}

function buildRequiredNextEvidence(
    input: BuildBusinessSkillVisualEvidencePreExecutionGateInput,
    visualSamplingScenarioMatches: boolean
): string[] {
    const required: string[] = [];

    if (input.hasProjectContext !== true) required.push('project_context_required');
    if (input.hasAssetIndex !== true) required.push('asset_index_required');
    if (input.hasVisualSamplingPlan !== true) required.push('visual_sampling_plan_required');
    if (input.expectedVisualSamplingScenario && !visualSamplingScenarioMatches) {
        required.push('visual_sampling_scenario_match_required');
    }
    if (input.hasVisualUnderstanding !== true || !visualSamplingScenarioMatches) {
        required.push('visual_understanding_required');
    }

    return Array.from(new Set(required));
}

function buildCommonLimitations(): string[] {
    return [
        'This gate is control-plane evidence; it does not prove business skill design quality.',
        'Default behavior is non-blocking to avoid changing existing Photoshop write behavior.',
        'Running visual refresh before execution requires explicit opt-in and bounded visual candidates.',
        'Strict blocking requires explicit require-before-execution opt-in.'
    ];
}

function buildEvidence(
    status: BusinessSkillVisualEvidencePreExecutionStatus,
    summary: string
): EvidenceRef[] {
    return [{
        source: 'business-skill-visual-evidence-pre-execution-gate',
        summary,
        status: status === 'blocked_strict_missing_visual_evidence' ? 'failed' : 'needs_review'
    }];
}

function buildGate(input: {
    skillId: BusinessDesignSkillId;
    status: BusinessSkillVisualEvidencePreExecutionStatus;
    canRunBusinessExecutor: boolean;
    shouldRunRefreshBeforeExecution: boolean;
    projectPath?: string;
    requiredNextEvidence: string[];
    blockers?: string[];
    warnings?: string[];
    limitations?: string[];
    refreshPlan?: ProjectVisualInsightCacheFillPlan;
    evidence: EvidenceRef[];
}): BusinessSkillVisualEvidencePreExecutionGate {
    return {
        version: 'business-skill-visual-evidence-pre-execution-gate/v0',
        skillId: input.skillId,
        status: input.status,
        canRunBusinessExecutor: input.canRunBusinessExecutor,
        shouldRunRefreshBeforeExecution: input.shouldRunRefreshBeforeExecution,
        canClaimDesignQuality: false,
        mustNotChangeBusinessStrategy: true,
        evidenceOnlyByDefault: true,
        projectPath: input.projectPath,
        requiredNextEvidence: input.requiredNextEvidence,
        blockers: input.blockers || [],
        warnings: input.warnings || [],
        limitations: input.limitations || buildCommonLimitations(),
        refreshPlan: input.refreshPlan,
        evidence: input.evidence
    };
}

export function buildBusinessSkillVisualEvidencePreExecutionGate(
    input: BuildBusinessSkillVisualEvidencePreExecutionGateInput
): BusinessSkillVisualEvidencePreExecutionGate {
    const projectPath = cleanString(input.projectPath);
    const visualSamplingScenarioMatches = hasMatchingVisualSamplingScenario(input);
    const requiredNextEvidence = buildRequiredNextEvidence(input, visualSamplingScenarioMatches);
    const scenarioWarnings = buildScenarioWarnings(input, visualSamplingScenarioMatches);
    const runBeforeExecution = parseBooleanFlag(input.runBeforeExecution);
    const requireBeforeExecution = parseBooleanFlag(input.requireBeforeExecution);
    const enabled = parseBooleanFlag(input.enabled) || runBeforeExecution;
    const limitations = buildCommonLimitations();

    if (input.hasVisualUnderstanding === true && visualSamplingScenarioMatches) {
        return buildGate({
            skillId: input.skillId,
            status: 'ready_existing_visual_evidence',
            canRunBusinessExecutor: true,
            shouldRunRefreshBeforeExecution: false,
            projectPath: projectPath || undefined,
            requiredNextEvidence: [],
            limitations,
            evidence: buildEvidence(
                'ready_existing_visual_evidence',
                'Existing project context already contains visual understanding evidence.'
            )
        });
    }

    const refreshPlan = buildProjectVisualInsightCacheFillPlan({
        projectPath,
        visualSamplingPlan: input.visualSamplingPlan,
        enabled,
        hasAnalyzer: input.runtimeCanAnalyze === true,
        hasWriter: input.runtimeCanWriteCache === true,
        maxCandidates: input.maxCandidates
    });

    if (runBeforeExecution && visualSamplingScenarioMatches && refreshPlan.shouldCallAnalyzer) {
        return buildGate({
            skillId: input.skillId,
            status: 'refresh_ready_before_execution',
            canRunBusinessExecutor: true,
            shouldRunRefreshBeforeExecution: true,
            projectPath: projectPath || undefined,
            requiredNextEvidence,
            warnings: scenarioWarnings,
            limitations: [
                ...limitations,
                ...refreshPlan.limitations
            ],
            refreshPlan,
            evidence: [
                ...buildEvidence(
                    'refresh_ready_before_execution',
                    'Visual understanding is missing; explicit run-before-execution refresh is ready.'
                ),
                ...refreshPlan.evidence
            ]
        });
    }

    if (requireBeforeExecution) {
        return buildGate({
            skillId: input.skillId,
            status: 'blocked_strict_missing_visual_evidence',
            canRunBusinessExecutor: false,
            shouldRunRefreshBeforeExecution: false,
            projectPath: projectPath || undefined,
            requiredNextEvidence,
            blockers: [
                'visual_understanding_required_before_execution',
                ...(visualSamplingScenarioMatches ? [] : ['visual_sampling_scenario_mismatch'])
            ],
            warnings: [
                ...scenarioWarnings,
                ...refreshPlan.warnings
            ],
            limitations: [
                ...limitations,
                ...refreshPlan.limitations
            ],
            refreshPlan,
            evidence: [
                ...buildEvidence(
                    'blocked_strict_missing_visual_evidence',
                    'Strict pre-execution policy requires visual understanding evidence before running the business skill.'
                ),
                ...refreshPlan.evidence
            ]
        });
    }

    return buildGate({
        skillId: input.skillId,
        status: 'needs_visual_evidence',
        canRunBusinessExecutor: true,
        shouldRunRefreshBeforeExecution: false,
        projectPath: projectPath || undefined,
        requiredNextEvidence,
        warnings: [
            ...scenarioWarnings,
            'Business skill can continue, but visual understanding evidence is missing.'
        ],
        limitations: [
            ...limitations,
            ...refreshPlan.limitations
        ],
        refreshPlan,
        evidence: [
            ...buildEvidence(
                'needs_visual_evidence',
                'Visual understanding evidence is missing; default policy records evidence without blocking execution.'
            ),
            ...refreshPlan.evidence
        ]
    });
}
