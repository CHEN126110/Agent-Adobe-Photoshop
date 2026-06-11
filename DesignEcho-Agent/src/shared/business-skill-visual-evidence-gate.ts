import type { EvidenceRef } from './design-agent-os-contracts';
import type { ProjectAssetIndex } from './project-asset-index';
import type { ProjectVisualInsightCacheReadResult } from './project-visual-insight-cache';
import type {
    ProjectVisualSamplingPlan,
    ProjectVisualSamplingScenario
} from './project-visual-sampling';

export type BusinessSkillVisualEvidenceGateVersion = 'business-skill-visual-evidence-gate/v0';
export type BusinessSkillVisualEvidenceGateEnforcement = 'evidence-only' | 'strict';
export type BusinessSkillVisualEvidenceGateStatus =
    | 'not_required'
    | 'ready'
    | 'partial'
    | 'needs_context_snapshot'
    | 'needs_visual_insight'
    | 'no_visual_candidates';

export interface BusinessSkillVisualEvidenceGateCandidateSummary {
    assetIndexImageCount: number;
    assetIndexVisionCandidateCount: number;
    selectedCandidateCount: number;
    shouldAnalyzeCount: number;
    skippedCandidateCount: number;
}

export interface BusinessSkillVisualEvidenceGateCacheSummary {
    source?: ProjectVisualInsightCacheReadResult['source'];
    exists: boolean;
    totalEntries: number;
    entriesWithInsight: number;
    hit: number;
    miss: number;
    stale: number;
}

export interface BusinessSkillVisualEvidenceGate {
    gateVersion: BusinessSkillVisualEvidenceGateVersion;
    scenario: ProjectVisualSamplingScenario;
    enforcement: BusinessSkillVisualEvidenceGateEnforcement;
    status: BusinessSkillVisualEvidenceGateStatus;
    shouldExecute: boolean;
    reason: string;
    candidateSummary: BusinessSkillVisualEvidenceGateCandidateSummary;
    cacheSummary: BusinessSkillVisualEvidenceGateCacheSummary;
    requiredEvidence: string[];
    blockers: string[];
    warnings: string[];
    limitations: string[];
    evidence: EvidenceRef[];
}

export interface BuildBusinessSkillVisualEvidenceGateInput {
    scenario?: ProjectVisualSamplingScenario;
    projectPath?: string | null;
    assetIndex?: ProjectAssetIndex | null;
    visualSamplingPlan?: ProjectVisualSamplingPlan | null;
    visualInsightCache?: ProjectVisualInsightCacheReadResult | null;
    enforcement?: BusinessSkillVisualEvidenceGateEnforcement;
    requiresVisualEvidence?: boolean;
}

function cleanString(value: unknown): string {
    return String(value || '').trim();
}

function normalizeScenario(value: unknown): ProjectVisualSamplingScenario {
    const scenario = cleanString(value);
    const allowed: ProjectVisualSamplingScenario[] = [
        'main-image',
        'detail-page',
        'sku',
        'reference-replication',
        'general-design',
        'unknown'
    ];
    return allowed.includes(scenario as ProjectVisualSamplingScenario)
        ? scenario as ProjectVisualSamplingScenario
        : 'unknown';
}

function normalizeEnforcement(value: unknown): BusinessSkillVisualEvidenceGateEnforcement {
    return value === 'strict' ? 'strict' : 'evidence-only';
}

function buildCandidateSummary(input: BuildBusinessSkillVisualEvidenceGateInput): BusinessSkillVisualEvidenceGateCandidateSummary {
    const assetIndex = input.assetIndex || null;
    const visualSamplingPlan = input.visualSamplingPlan || null;
    return {
        assetIndexImageCount: assetIndex?.summary.totalImages || 0,
        assetIndexVisionCandidateCount: assetIndex?.visionCandidates.length || 0,
        selectedCandidateCount: visualSamplingPlan?.selectedCandidates.length || 0,
        shouldAnalyzeCount: visualSamplingPlan?.cacheSummary.shouldAnalyze || 0,
        skippedCandidateCount: visualSamplingPlan?.skippedCandidateCount || 0
    };
}

function buildCacheSummary(input: BuildBusinessSkillVisualEvidenceGateInput): BusinessSkillVisualEvidenceGateCacheSummary {
    const cache = input.visualInsightCache || null;
    const visualSamplingPlan = input.visualSamplingPlan || null;
    return {
        source: cache?.source,
        exists: Boolean(cache?.exists),
        totalEntries: cache?.summary.totalEntries || 0,
        entriesWithInsight: cache?.summary.entriesWithInsight || 0,
        hit: visualSamplingPlan?.cacheSummary.hit || 0,
        miss: visualSamplingPlan?.cacheSummary.miss || 0,
        stale: visualSamplingPlan?.cacheSummary.stale || 0
    };
}

function determineStatus(input: {
    requiresVisualEvidence: boolean;
    hasProjectEvidence: boolean;
    candidateSummary: BusinessSkillVisualEvidenceGateCandidateSummary;
    cacheSummary: BusinessSkillVisualEvidenceGateCacheSummary;
}): BusinessSkillVisualEvidenceGateStatus {
    if (!input.requiresVisualEvidence) return 'not_required';
    if (!input.hasProjectEvidence) return 'needs_context_snapshot';
    if (input.candidateSummary.selectedCandidateCount <= 0) {
        return input.cacheSummary.entriesWithInsight > 0 ? 'ready' : 'no_visual_candidates';
    }
    if (input.candidateSummary.shouldAnalyzeCount > 0) {
        return input.cacheSummary.hit > 0 || input.cacheSummary.entriesWithInsight > 0
            ? 'partial'
            : 'needs_visual_insight';
    }
    return 'ready';
}

function statusReason(status: BusinessSkillVisualEvidenceGateStatus): string {
    switch (status) {
        case 'not_required':
            return '当前任务不需要额外素材理解。';
        case 'ready':
            return '业务 skill 已具备可复用的素材理解或无需新增分析。';
        case 'partial':
            return '业务 skill 只有部分素材理解结果，仍有候选图需要视觉模型或人工确认。';
        case 'needs_context_snapshot':
            return '业务 skill 缺少 ContextSnapshot / ProjectAssetIndex，不能可靠理解项目素材。';
        case 'needs_visual_insight':
            return '业务 skill 找到了视觉候选，但缺少真实视觉洞察缓存。';
        case 'no_visual_candidates':
            return '业务 skill 没有可用于当前场景的视觉候选。';
        default:
            return '业务素材理解状态未知。';
    }
}

function buildRequiredEvidence(status: BusinessSkillVisualEvidenceGateStatus): string[] {
    const required = ['ContextSnapshot', 'ProjectAssetIndex', 'VisualSamplingPlan'];
    if (status === 'needs_visual_insight' || status === 'partial') {
        required.push('VisualInsightCache or explicit visual model analysis');
    }
    if (status === 'no_visual_candidates') {
        required.push('project image candidates for the requested business scenario');
    }
    return Array.from(new Set(required));
}

function buildWarnings(status: BusinessSkillVisualEvidenceGateStatus): string[] {
    switch (status) {
        case 'ready':
        case 'not_required':
            return [];
        case 'partial':
            return ['视觉洞察缓存只覆盖部分候选；执行器不能把未分析候选的款式、材质、场景或卖点编造成事实。'];
        case 'needs_context_snapshot':
            return ['缺少项目上下文快照时，Agent 只能请求上下文或使用用户明确提供的素材，不能扫描全项目后直接猜。'];
        case 'needs_visual_insight':
            return ['已有候选图但缺少视觉洞察；应显式 opt-in 调用视觉模型或等待人工确认。'];
        case 'no_visual_candidates':
            return ['项目索引未提供当前业务场景的视觉候选；需要用户选择图片或刷新项目素材索引。'];
        default:
            return [];
    }
}

function buildBlockers(
    status: BusinessSkillVisualEvidenceGateStatus,
    enforcement: BusinessSkillVisualEvidenceGateEnforcement
): string[] {
    if (enforcement !== 'strict') return [];
    if (status === 'ready' || status === 'partial' || status === 'not_required') return [];
    return [statusReason(status)];
}

function buildShouldExecute(
    status: BusinessSkillVisualEvidenceGateStatus,
    enforcement: BusinessSkillVisualEvidenceGateEnforcement
): boolean {
    if (enforcement !== 'strict') return true;
    return status === 'ready' || status === 'partial' || status === 'not_required';
}

function buildEvidence(
    status: BusinessSkillVisualEvidenceGateStatus,
    scenario: ProjectVisualSamplingScenario
): EvidenceRef[] {
    return [{
        source: 'business-skill-visual-evidence-gate',
        summary: `scenario=${scenario}; visualEvidenceStatus=${status}.`,
        status: status === 'ready' ? 'needs_review' : status === 'not_required' ? 'unknown' : 'needs_review'
    }];
}

export function buildBusinessSkillVisualEvidenceGate(
    input: BuildBusinessSkillVisualEvidenceGateInput
): BusinessSkillVisualEvidenceGate {
    const scenario = normalizeScenario(input.scenario);
    const enforcement = normalizeEnforcement(input.enforcement);
    const requiresVisualEvidence = input.requiresVisualEvidence !== false;
    const candidateSummary = buildCandidateSummary(input);
    const cacheSummary = buildCacheSummary(input);
    const hasProjectEvidence = Boolean(
        input.assetIndex
        || input.visualSamplingPlan
        || input.visualInsightCache?.exists
        || cleanString(input.projectPath)
    );
    const status = determineStatus({
        requiresVisualEvidence,
        hasProjectEvidence,
        candidateSummary,
        cacheSummary
    });
    return {
        gateVersion: 'business-skill-visual-evidence-gate/v0',
        scenario,
        enforcement,
        status,
        shouldExecute: buildShouldExecute(status, enforcement),
        reason: statusReason(status),
        candidateSummary,
        cacheSummary,
        requiredEvidence: buildRequiredEvidence(status),
        blockers: buildBlockers(status, enforcement),
        warnings: buildWarnings(status),
        limitations: [
            '该门禁默认是 evidence-only，不会自动调用视觉模型，也不会改变 Photoshop 写入参数。',
            'VisualInsightCache 命中只能说明有可复用素材理解结果，不代表主图、详情页、SKU 或复刻结果质量通过。',
            '严格阻断必须由调用方显式设置 enforcement=strict，避免隐藏改变现有业务 skill 行为。'
        ],
        evidence: buildEvidence(status, scenario)
    };
}
