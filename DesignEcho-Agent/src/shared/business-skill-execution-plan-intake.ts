import type { BusinessDesignSkillId } from './business-skill-implementation-checkpoint';
import type {
    DesignAgentOsEvidence,
    DesignAgentOsStatus,
    EvidenceRef,
    ExecutionPlan,
    ExecutionTrace,
    VerificationReport
} from './design-agent-os-contracts';

export type BusinessSkillExecutionPlanIntakeVersion =
    'business-skill-execution-plan-intake/v0';

export type BusinessSkillExecutionPlanIntakeStatus =
    | 'no_execution_plan_evidence'
    | 'plan_only_needs_execution_trace'
    | 'executed_with_trace_needs_verification'
    | 'verified_execution_evidence'
    | 'failed_execution_evidence';

export interface BusinessSkillExecutionPlanEvidenceSummary {
    hasDesignAgentOs: boolean;
    hasExecutionPlan: boolean;
    planStatus?: string;
    stepCount: number;
    operations: string[];
    hasExecutionTrace: boolean;
    toolCallCount: number;
    successfulToolCalls: number;
    failedToolCalls: number;
    hasVerificationReport: boolean;
    verificationStatus?: DesignAgentOsStatus;
    plannerAlignmentStatus?: string;
    placementVerificationStatus?: string;
    hasPlacementVerificationIntake: boolean;
    hasBusinessSkillExecutionIntake: boolean;
}

export interface BusinessSkillExecutionPlanIntake {
    version: BusinessSkillExecutionPlanIntakeVersion;
    skillId: BusinessDesignSkillId;
    status: BusinessSkillExecutionPlanIntakeStatus;
    evidenceOnly: true;
    userVisible: false;
    canClaimDesignQuality: false;
    mustNotChangeBusinessStrategy: true;
    mustNotChangeExecutor: true;
    executionPlanEvidence: BusinessSkillExecutionPlanEvidenceSummary;
    sourceEvidence: string[];
    requiredNextEvidence: string[];
    blockers: string[];
    warnings: string[];
    limitations: string[];
    evidence: EvidenceRef[];
}

export interface BuildBusinessSkillExecutionPlanIntakeInput {
    skillId: BusinessDesignSkillId;
    resultData?: Record<string, unknown> | null;
}

interface NormalizedExecutionPlanEvidence {
    designAgentOs?: DesignAgentOsEvidence;
    executionPlan?: ExecutionPlan;
    executionTrace?: ExecutionTrace;
    verificationReport?: VerificationReport;
    plannerAlignmentStatus?: string;
    placementVerificationStatus?: string;
    placementBlockers: string[];
    businessExecutionIntakePresent: boolean;
    sourceEvidence: string[];
}

function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readObject(value: unknown): Record<string, unknown> | undefined {
    return isObject(value) ? value : undefined;
}

function normalizeText(value: unknown): string {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values: unknown[]): string[] {
    const result: string[] = [];
    for (const value of values) {
        const normalized = normalizeText(value);
        if (normalized && !result.includes(normalized)) result.push(normalized);
    }
    return result;
}

function normalizeDesignAgentOs(value: unknown): DesignAgentOsEvidence | undefined {
    const candidate = readObject(value);
    if (!candidate) return undefined;
    if (!readObject(candidate.intent) || !readObject(candidate.brief)) return undefined;
    return candidate as unknown as DesignAgentOsEvidence;
}

function normalizeExecutionPlan(value: unknown): ExecutionPlan | undefined {
    const candidate = readObject(value);
    if (!candidate) return undefined;
    if (!Array.isArray(candidate.steps)) return undefined;
    if (!normalizeText(candidate.planId)) return undefined;
    return candidate as unknown as ExecutionPlan;
}

function normalizeExecutionTrace(value: unknown): ExecutionTrace | undefined {
    const candidate = readObject(value);
    if (!candidate) return undefined;
    if (!Array.isArray(candidate.toolCalls)) return undefined;
    if (!Number.isFinite(Number(candidate.toolCallCount))) return undefined;
    return candidate as unknown as ExecutionTrace;
}

function normalizeVerificationReport(value: unknown): VerificationReport | undefined {
    const candidate = readObject(value);
    if (!candidate) return undefined;
    if (!normalizeText(candidate.reportId)) return undefined;
    if (!normalizeText(candidate.status)) return undefined;
    return candidate as unknown as VerificationReport;
}

function normalizeEvidenceStatus(value: unknown): DesignAgentOsStatus | undefined {
    switch (normalizeText(value)) {
        case 'passed':
        case 'needs_review':
        case 'failed':
        case 'not_run':
        case 'unknown':
            return normalizeText(value) as DesignAgentOsStatus;
        default:
            return undefined;
    }
}

function normalizeStringArray(value: unknown): string[] {
    if (Array.isArray(value)) return uniqueStrings(value);
    return normalizeText(value)
        .split(/[，,；;\n|]/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function normalizeExecutionPlanEvidence(
    resultData: Record<string, unknown>
): NormalizedExecutionPlanEvidence {
    const designAgentOs = normalizeDesignAgentOs(resultData.designAgentOs);
    const executionPlan = normalizeExecutionPlan(designAgentOs?.executionPlan);
    const executionTrace = normalizeExecutionTrace(designAgentOs?.executionTrace);
    const verificationReport = normalizeVerificationReport(designAgentOs?.verificationReport);
    const plannerAlignment = readObject(resultData.designPlannerExecutionAlignment);
    const placementIntake = readObject(resultData.businessSkillImagePlacementVerificationIntake);

    const sourceEvidence: string[] = [];
    if (designAgentOs) sourceEvidence.push('design_agent_os');
    if (executionPlan) sourceEvidence.push('design_agent_os_execution_plan');
    if (executionTrace) sourceEvidence.push('design_agent_os_execution_trace');
    if (verificationReport) sourceEvidence.push('design_agent_os_verification_report');
    if (plannerAlignment) sourceEvidence.push('design_planner_execution_alignment');
    if (placementIntake) sourceEvidence.push('business_skill_image_placement_verification_intake');
    if (readObject(resultData.businessSkillExecutionIntake)) sourceEvidence.push('business_skill_execution_intake');

    return {
        designAgentOs,
        executionPlan,
        executionTrace,
        verificationReport,
        plannerAlignmentStatus: normalizeText(plannerAlignment?.status) || undefined,
        placementVerificationStatus: normalizeText(placementIntake?.status) || undefined,
        placementBlockers: normalizeStringArray(placementIntake?.blockers),
        businessExecutionIntakePresent: Boolean(readObject(resultData.businessSkillExecutionIntake)),
        sourceEvidence
    };
}

function traceHasFailure(trace?: ExecutionTrace): boolean {
    if (!trace) return false;
    if (trace.status === 'failed') return true;
    if (Number(trace.failedToolCalls || 0) > 0) return true;
    return trace.toolCalls.some((call) => call.success === false);
}

function verificationHasFailure(report?: VerificationReport): boolean {
    if (!report) return false;
    return report.status === 'failed' || (report.blockers || []).length > 0;
}

function placementHasFailure(evidence: NormalizedExecutionPlanEvidence): boolean {
    return evidence.placementVerificationStatus === 'failed_bounds_or_screenshot'
        || evidence.placementBlockers.length > 0;
}

function resolveStatus(
    evidence: NormalizedExecutionPlanEvidence
): BusinessSkillExecutionPlanIntakeStatus {
    if (!evidence.executionPlan) return 'no_execution_plan_evidence';
    if (traceHasFailure(evidence.executionTrace) || verificationHasFailure(evidence.verificationReport) || placementHasFailure(evidence)) {
        return 'failed_execution_evidence';
    }
    if (!evidence.executionTrace) return 'plan_only_needs_execution_trace';
    if (evidence.verificationReport?.status === 'passed') return 'verified_execution_evidence';
    return 'executed_with_trace_needs_verification';
}

function buildRequiredNextEvidence(
    evidence: NormalizedExecutionPlanEvidence,
    status: BusinessSkillExecutionPlanIntakeStatus
): string[] {
    const required: string[] = [];
    if (!evidence.executionPlan) required.push('design_agent_os_execution_plan_required');
    if (evidence.executionPlan && !evidence.executionTrace) required.push('execution_trace_required');
    if (evidence.executionTrace && !evidence.verificationReport) required.push('verification_report_required');
    if (status === 'executed_with_trace_needs_verification') required.push('screenshot_or_manual_review_required');
    return uniqueStrings(required);
}

function buildBlockers(evidence: NormalizedExecutionPlanEvidence): string[] {
    const blockers: string[] = [];
    if (traceHasFailure(evidence.executionTrace)) blockers.push('execution_trace_failed');
    if (verificationHasFailure(evidence.verificationReport)) {
        blockers.push(...(evidence.verificationReport?.blockers || []));
    }
    if (placementHasFailure(evidence)) {
        blockers.push('image_placement_verification_failed');
        blockers.push(...evidence.placementBlockers);
    }
    return uniqueStrings(blockers);
}

function buildWarnings(
    evidence: NormalizedExecutionPlanEvidence,
    status: BusinessSkillExecutionPlanIntakeStatus
): string[] {
    const warnings: string[] = [];
    if (!evidence.executionPlan) warnings.push('缺少 Design Agent OS executionPlan，不能说明本次 Photoshop 执行依据。');
    if (status === 'plan_only_needs_execution_trace') warnings.push('当前只有执行计划，没有工具调用追踪证据。');
    if (status === 'executed_with_trace_needs_verification') warnings.push('已有工具调用追踪，但仍需要截图、bounds 或人工验收。');
    warnings.push(...(evidence.verificationReport?.warnings || []));
    return uniqueStrings(warnings);
}

function buildLimitations(): string[] {
    return [
        '该 intake 是隐藏执行计划证据，不是模型思考，不进入 Pondering。',
        '它只总结 Design Agent OS executionPlan、executionTrace 和 verificationReport，不改变业务 skill 策略。',
        '工具调用追踪存在不等于设计质量通过；截图、bounds、人工验收仍需独立证据。',
        '该入口不得改变 main-image、detail-page、SKU 的 prompt、DSL、executor 或 Photoshop 写入顺序。'
    ];
}

function buildExecutionPlanEvidenceSummary(
    evidence: NormalizedExecutionPlanEvidence
): BusinessSkillExecutionPlanEvidenceSummary {
    const steps = evidence.executionPlan?.steps || [];
    return {
        hasDesignAgentOs: Boolean(evidence.designAgentOs),
        hasExecutionPlan: Boolean(evidence.executionPlan),
        planStatus: evidence.executionPlan?.status,
        stepCount: steps.length,
        operations: uniqueStrings(steps.map((step) => step.operation)),
        hasExecutionTrace: Boolean(evidence.executionTrace),
        toolCallCount: Number(evidence.executionTrace?.toolCallCount || 0),
        successfulToolCalls: Number(evidence.executionTrace?.successfulToolCalls || 0),
        failedToolCalls: Number(evidence.executionTrace?.failedToolCalls || 0),
        hasVerificationReport: Boolean(evidence.verificationReport),
        verificationStatus: normalizeEvidenceStatus(evidence.verificationReport?.status),
        plannerAlignmentStatus: evidence.plannerAlignmentStatus,
        placementVerificationStatus: evidence.placementVerificationStatus,
        hasPlacementVerificationIntake: Boolean(evidence.placementVerificationStatus),
        hasBusinessSkillExecutionIntake: evidence.businessExecutionIntakePresent
    };
}

function evidenceStatusFromIntakeStatus(
    status: BusinessSkillExecutionPlanIntakeStatus
): DesignAgentOsStatus {
    if (status === 'failed_execution_evidence') return 'failed';
    if (status === 'verified_execution_evidence') return 'passed';
    return 'needs_review';
}

function buildEvidenceRefs(
    skillId: BusinessDesignSkillId,
    evidence: NormalizedExecutionPlanEvidence,
    status: BusinessSkillExecutionPlanIntakeStatus
): EvidenceRef[] {
    return [
        {
            source: 'business-skill-execution-plan-intake',
            summary: `skill=${skillId}; status=${status}; steps=${evidence.executionPlan?.steps?.length || 0}; toolCalls=${evidence.executionTrace?.toolCallCount || 0}`,
            status: evidenceStatusFromIntakeStatus(status)
        },
        ...(evidence.executionPlan?.evidence || []),
        ...(evidence.executionTrace?.evidence || []),
        ...(evidence.verificationReport?.evidence || [])
    ];
}

export function buildBusinessSkillExecutionPlanIntake(
    input: BuildBusinessSkillExecutionPlanIntakeInput
): BusinessSkillExecutionPlanIntake {
    const resultData = input.resultData || {};
    const normalized = normalizeExecutionPlanEvidence(resultData);
    const status = resolveStatus(normalized);

    return {
        version: 'business-skill-execution-plan-intake/v0',
        skillId: input.skillId,
        status,
        evidenceOnly: true,
        userVisible: false,
        canClaimDesignQuality: false,
        mustNotChangeBusinessStrategy: true,
        mustNotChangeExecutor: true,
        executionPlanEvidence: buildExecutionPlanEvidenceSummary(normalized),
        sourceEvidence: normalized.sourceEvidence,
        requiredNextEvidence: buildRequiredNextEvidence(normalized, status),
        blockers: buildBlockers(normalized),
        warnings: buildWarnings(normalized, status),
        limitations: buildLimitations(),
        evidence: buildEvidenceRefs(input.skillId, normalized, status)
    };
}
