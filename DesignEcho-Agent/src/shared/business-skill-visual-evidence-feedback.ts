import type {
    BusinessSkillVisualEvidenceGate,
    BusinessSkillVisualEvidenceGateStatus
} from './business-skill-visual-evidence-gate';

export type BusinessSkillVisualEvidenceFeedbackVersion = 'business-skill-visual-evidence-feedback/v0';
export type BusinessSkillVisualEvidenceFeedbackSeverity = 'none' | 'info' | 'warning' | 'blocked';
export type BusinessSkillVisualEvidenceAction =
    | 'continue_with_evidence_boundary'
    | 'refresh_project_context'
    | 'ask_user_to_select_images'
    | 'offer_visual_analysis'
    | 'avoid_semantic_claims';

export interface BusinessSkillVisualEvidencePreflightStrategy {
    mode: 'evidence-only' | 'strict';
    canProceed: boolean;
    shouldRefreshProjectContext: boolean;
    shouldAskUserToSelectImages: boolean;
    shouldOfferVisualAnalysis: boolean;
    shouldAvoidSemanticClaims: boolean;
}

export interface BusinessSkillVisualEvidenceFeedback {
    feedbackVersion: BusinessSkillVisualEvidenceFeedbackVersion;
    userVisible: boolean;
    severity: BusinessSkillVisualEvidenceFeedbackSeverity;
    title: string;
    summary: string;
    actionHint: string;
    recommendedActions: BusinessSkillVisualEvidenceAction[];
    preflightStrategy: BusinessSkillVisualEvidencePreflightStrategy;
    warningItems: string[];
    blockerItems: string[];
    limitations: string[];
}

function isBlocked(gate: BusinessSkillVisualEvidenceGate): boolean {
    return !gate.shouldExecute || gate.blockers.length > 0;
}

function resolveSeverity(gate: BusinessSkillVisualEvidenceGate): BusinessSkillVisualEvidenceFeedbackSeverity {
    if (isBlocked(gate)) return 'blocked';
    if (gate.status === 'ready') return 'info';
    if (gate.status === 'not_required') return 'none';
    return 'warning';
}

function resolveTitle(status: BusinessSkillVisualEvidenceGateStatus): string {
    switch (status) {
        case 'ready':
            return '素材理解已就绪';
        case 'partial':
            return '部分素材还需要确认';
        case 'needs_context_snapshot':
            return '缺少项目上下文';
        case 'needs_visual_insight':
            return '候选图片缺少视觉理解';
        case 'no_visual_candidates':
            return '没有可用图片候选';
        case 'not_required':
            return '当前任务可直接处理';
        default:
            return '素材理解需要复核';
    }
}

function resolveActionHint(status: BusinessSkillVisualEvidenceGateStatus): string {
    switch (status) {
        case 'ready':
            return '可以继续执行，但最终设计质量仍需要 Photoshop 输出和验收。';
        case 'partial':
            return '可以继续执行，但不要把未分析图片的款式、材质、场景或卖点当作事实。';
        case 'needs_context_snapshot':
            return '先刷新项目上下文，或让用户明确选择要使用的图片。';
        case 'needs_visual_insight':
            return '先显式进行视觉分析，或让用户确认图片内容后再生成设计判断。';
        case 'no_visual_candidates':
            return '需要用户选择图片，或刷新项目素材索引后再继续。';
        case 'not_required':
            return '按普通工具任务继续处理。';
        default:
            return '先补齐素材理解，再继续设计判断。';
    }
}

function resolveRecommendedActions(status: BusinessSkillVisualEvidenceGateStatus): BusinessSkillVisualEvidenceAction[] {
    switch (status) {
        case 'ready':
            return ['continue_with_evidence_boundary'];
        case 'partial':
            return ['continue_with_evidence_boundary', 'offer_visual_analysis', 'avoid_semantic_claims'];
        case 'needs_context_snapshot':
            return ['refresh_project_context', 'ask_user_to_select_images', 'avoid_semantic_claims'];
        case 'needs_visual_insight':
            return ['offer_visual_analysis', 'avoid_semantic_claims'];
        case 'no_visual_candidates':
            return ['ask_user_to_select_images', 'refresh_project_context', 'avoid_semantic_claims'];
        case 'not_required':
            return ['continue_with_evidence_boundary'];
        default:
            return ['avoid_semantic_claims'];
    }
}

function buildSummary(gate: BusinessSkillVisualEvidenceGate): string {
    const candidate = gate.candidateSummary;
    const cache = gate.cacheSummary;
    const parts = [
        gate.reason,
        `候选 ${candidate.selectedCandidateCount}/${candidate.assetIndexVisionCandidateCount}`,
        `待分析 ${candidate.shouldAnalyzeCount}`,
        `缓存命中 ${cache.hit}`,
        `有效洞察 ${cache.entriesWithInsight}`
    ];
    return parts.join('；');
}

function buildPreflightStrategy(gate: BusinessSkillVisualEvidenceGate): BusinessSkillVisualEvidencePreflightStrategy {
    return {
        mode: gate.enforcement,
        canProceed: gate.shouldExecute,
        shouldRefreshProjectContext: gate.status === 'needs_context_snapshot',
        shouldAskUserToSelectImages: gate.status === 'needs_context_snapshot' || gate.status === 'no_visual_candidates',
        shouldOfferVisualAnalysis: gate.status === 'partial' || gate.status === 'needs_visual_insight',
        shouldAvoidSemanticClaims: gate.status !== 'ready' && gate.status !== 'not_required'
    };
}

function shouldShowToUser(gate: BusinessSkillVisualEvidenceGate): boolean {
    return gate.status !== 'ready' && gate.status !== 'not_required';
}

export function buildBusinessSkillVisualEvidenceFeedback(
    gate: BusinessSkillVisualEvidenceGate
): BusinessSkillVisualEvidenceFeedback {
    return {
        feedbackVersion: 'business-skill-visual-evidence-feedback/v0',
        userVisible: shouldShowToUser(gate),
        severity: resolveSeverity(gate),
        title: resolveTitle(gate.status),
        summary: buildSummary(gate),
        actionHint: resolveActionHint(gate.status),
        recommendedActions: resolveRecommendedActions(gate.status),
        preflightStrategy: buildPreflightStrategy(gate),
        warningItems: gate.warnings,
        blockerItems: gate.blockers,
        limitations: [
            '这是业务预检反馈，不是模型思考内容，也不是 Photoshop 执行结果。',
            '该反馈只依据已有项目上下文、视觉抽样计划和视觉洞察缓存，不会自动调用视觉模型。',
            '设计质量仍必须依赖真实 Photoshop 输出、截图或人工/模型验收。'
        ]
    };
}
