import {
    buildImagePlacementPlan,
    type ImagePlacementBox,
    type ImagePlacementExecutionTool,
    type ImagePlacementPlan
} from './design-image-placement-core';
import type { EagleVisualCaseIndex, EagleVisualCaseIndexItem } from './eagle-visual-case-index';
import type {
    ProjectAssetIndex,
    ProjectAssetIndexAsset,
    ProjectAssetRole
} from './project-asset-index';
import type {
    ProjectVisualInsight,
    ProjectVisualSamplingCandidate,
    ProjectVisualSamplingPlan,
    ProjectVisualSamplingScenario
} from './project-visual-sampling';
import type { ProjectVisualInsightCacheReadResult } from './project-visual-insight-cache';

export type DesignPlacementIntelligenceVersion = 'design-placement-intelligence/v0';
export type DesignPlacementIntelligenceStatus =
    | 'blocked'
    | 'needs_visual_evidence'
    | 'needs_user_or_model_selection'
    | 'ready_for_placement_plan';
export type DesignPlacementReviewRequirementType =
    | 'visual_insight_required'
    | 'user_or_model_selection_required'
    | 'subject_bounds_required'
    | 'actual_bounds_readback_required'
    | 'screenshot_or_manual_review_required';

export const DESIGN_PLACEMENT_INTELLIGENCE_VERSION: DesignPlacementIntelligenceVersion = 'design-placement-intelligence/v0';

export interface DesignPlacementTargetInput {
    canvas: { width: number; height: number };
    box: ImagePlacementBox;
    safeBox?: ImagePlacementBox;
    slotRole?: string;
    executionTool?: ImagePlacementExecutionTool;
}

export interface DesignPlacementIntelligenceInput {
    scenario: ProjectVisualSamplingScenario;
    assetIndex?: ProjectAssetIndex | null;
    visualSamplingPlan?: ProjectVisualSamplingPlan | null;
    visualInsightCache?: ProjectVisualInsightCacheReadResult | null;
    visualCaseIndex?: EagleVisualCaseIndex | null;
    target?: DesignPlacementTargetInput | null;
}

export interface DesignPlacementBoundary {
    readonly: true;
    noPhotoshopWrites: true;
    doesNotCallVisionModel: true;
    doesNotReturnRawImages: true;
    doesNotClaimDesignQuality: true;
}

export interface DesignPlacementScorecardItem {
    id: string;
    label: string;
    points: number;
    maxPoints: number;
    reason: string;
}

export interface DesignPlacementScorecard {
    version: 'design-placement-scorecard/v0';
    totalScore: number;
    maxScore: number;
    items: DesignPlacementScorecardItem[];
    limitations: string[];
}

export interface DesignPlacementReviewRequirement {
    type: DesignPlacementReviewRequirementType;
    severity: 'required' | 'recommended';
    reason: string;
}

export interface DesignPlacementVisualEvidence {
    status: 'cached_insight' | 'needs_visual_analysis';
    summary?: string;
    productType?: string;
    scene?: string;
    material?: string;
    styleTags: string[];
    evidenceSources: string[];
}

export interface DesignPlacementCaseEvidence {
    status: 'metadata_case_reference' | 'none';
    matchedCaseIds: string[];
    matchedTags: string[];
    limitations: string[];
}

export type DesignPlacementPlanWithoutConfidence = Omit<ImagePlacementPlan, 'decision'> & {
    decision: Omit<ImagePlacementPlan['decision'], 'confidence'>;
};

export interface DesignPlacementCandidate {
    candidateId: string;
    scenario: ProjectVisualSamplingScenario;
    asset: {
        assetId: string;
        path: string;
        name: string;
        role: ProjectAssetRole;
        width?: number;
        height?: number;
    };
    visualEvidence: DesignPlacementVisualEvidence;
    caseEvidence: DesignPlacementCaseEvidence;
    scorecard: DesignPlacementScorecard;
    placementPlan: DesignPlacementPlanWithoutConfidence;
    reviewRequirements: DesignPlacementReviewRequirement[];
    warnings: string[];
    limitations: string[];
}

export interface DesignPlacementIntelligencePlan {
    version: DesignPlacementIntelligenceVersion;
    status: DesignPlacementIntelligenceStatus;
    scenario: ProjectVisualSamplingScenario;
    summary: {
        candidateCount: number;
        visualCaseCount: number;
        cachedInsightCount: number;
        needsVisualAnalysisCount: number;
    };
    candidates: DesignPlacementCandidate[];
    selectedCandidateId?: string;
    reviewRequirements: DesignPlacementReviewRequirement[];
    canClaimDesignQuality: false;
    blockers: string[];
    warnings: string[];
    limitations: string[];
    boundaries: DesignPlacementBoundary;
}

const FORBIDDEN_PAYLOAD_TOKENS = [
    'data:image',
    'raw-image-payload',
    'base64-image-payload',
    '"base64"',
    '"imageBase64"',
    '"rawImage"',
    '"rawImages"',
    '"buffer"',
    '"bytes"',
    '"pixels"',
    '"confidence"'
];

export function buildDesignPlacementIntelligencePlan(
    input: DesignPlacementIntelligenceInput
): DesignPlacementIntelligencePlan {
    const blockers = buildBlockers(input);
    const candidates = blockers.length > 0
        ? []
        : buildCandidates(input);
    const reviewRequirements = mergeReviewRequirements([
        ...candidates.flatMap((candidate) => candidate.reviewRequirements),
        ...(candidates.length === 0 && blockers.length === 0 ? [buildReviewRequirement('visual_insight_required', 'required', '缺少可用于落位判断的视觉候选。')] : [])
    ]);
    const status = resolveStatus({ blockers, candidates });
    return {
        version: DESIGN_PLACEMENT_INTELLIGENCE_VERSION,
        status,
        scenario: input.scenario || 'unknown',
        summary: {
            candidateCount: candidates.length,
            visualCaseCount: input.visualCaseIndex?.summary.caseCount || 0,
            cachedInsightCount: candidates.filter((candidate) => candidate.visualEvidence.status === 'cached_insight').length,
            needsVisualAnalysisCount: candidates.filter((candidate) => candidate.visualEvidence.status === 'needs_visual_analysis').length
        },
        candidates,
        selectedCandidateId: candidates[0]?.candidateId,
        reviewRequirements,
        canClaimDesignQuality: false,
        blockers,
        warnings: buildPlanWarnings(input, candidates),
        limitations: [
            'DesignPlacementIntelligence 只编排素材、视觉缓存、视觉案例和几何置入计划，不读取图片像素。',
            '该计划不调用视觉模型、不写 Photoshop、不写 Eagle，也不声明最终设计质量。',
            'scorecard 是可解释排序，不是审美真值；缺少 subject bounds 或截图 QA 时必须继续复核。',
            'ImagePlacementPlan 中的 destinationBox 仍是计划值，不能当成 Photoshop actualBounds。'
        ],
        boundaries: buildDesignPlacementBoundary()
    };
}

export function buildDesignPlacementBoundary(): DesignPlacementBoundary {
    return {
        readonly: true,
        noPhotoshopWrites: true,
        doesNotCallVisionModel: true,
        doesNotReturnRawImages: true,
        doesNotClaimDesignQuality: true
    };
}

export function isDesignPlacementIntelligencePayloadSafe(value: unknown): boolean {
    const text = JSON.stringify(value || '');
    return !FORBIDDEN_PAYLOAD_TOKENS.some((token) => text.includes(token));
}

function buildBlockers(input: DesignPlacementIntelligenceInput): string[] {
    const blockers: string[] = [];
    if (!input.assetIndex) blockers.push('project_asset_index_required');
    if (!input.target) blockers.push('placement_target_required');
    return blockers;
}

function buildCandidates(input: DesignPlacementIntelligenceInput): DesignPlacementCandidate[] {
    const assetIndex = input.assetIndex;
    const visualSamplingPlan = input.visualSamplingPlan;
    const target = input.target;
    if (!assetIndex || !visualSamplingPlan || !target) return [];
    const assets = new Map((assetIndex.assets || []).map((asset) => [asset.id, asset]));
    const candidates: DesignPlacementCandidate[] = [];
    for (const samplingCandidate of visualSamplingPlan.selectedCandidates || []) {
        const asset = assets.get(samplingCandidate.assetId);
        if (!asset || !asset.width || !asset.height) continue;
        const visualInsight = findVisualInsight(samplingCandidate, input.visualInsightCache);
        const visualEvidence = buildVisualEvidence(visualInsight);
        const caseEvidence = buildCaseEvidence({ visualInsight, visualCaseIndex: input.visualCaseIndex });
        const placementPlan = stripConfidenceFromPlacementPlan(buildImagePlacementPlan({
            source: {
                width: asset.width,
                height: asset.height,
                path: asset.path,
                assetId: asset.id,
                role: 'product'
            },
            target: {
                box: target.box,
                safeBox: target.safeBox,
                slotRole: target.slotRole
            },
            canvas: target.canvas,
            designType: input.scenario === 'main-image' ? 'main-image' : input.scenario === 'detail-page' ? 'detail-page' : 'generic',
            assetRole: 'product',
            intent: input.scenario === 'main-image' ? 'hero' : 'fit-slot',
            executionTool: target.executionTool || 'custom-adapter'
        }));
        const reviewRequirements = buildCandidateReviewRequirements({ visualEvidence, placementPlan });
        candidates.push({
            candidateId: `dpi:${samplingCandidate.assetId}`,
            scenario: input.scenario || 'unknown',
            asset: {
                assetId: asset.id,
                path: asset.path,
                name: asset.name,
                role: asset.role,
                width: asset.width,
                height: asset.height
            },
            visualEvidence,
            caseEvidence,
            scorecard: buildScorecard({ asset, visualEvidence, caseEvidence, placementPlan, reviewRequirements }),
            placementPlan,
            reviewRequirements,
            warnings: buildCandidateWarnings({ visualEvidence, placementPlan }),
            limitations: [
                '候选基于项目索引、视觉缓存和案例元数据排序，不代表最终审美判断。',
                '当前不从视觉摘要或 Eagle 标签反推出 subjectBox。',
                '执行后必须读取 actualBounds，并结合截图或人工复核才能进入质量声明。'
            ]
        });
    }
    return candidates.sort((left, right) => right.scorecard.totalScore - left.scorecard.totalScore || left.asset.path.localeCompare(right.asset.path));
}

function findVisualInsight(
    candidate: ProjectVisualSamplingCandidate,
    cache?: ProjectVisualInsightCacheReadResult | null
): ProjectVisualInsight | undefined {
    if (candidate.cachedInsight) return candidate.cachedInsight;
    return (cache?.entries || []).find((entry) => {
        if (entry.cacheKey === candidate.cacheKey) return true;
        if (entry.assetId && entry.assetId === candidate.assetId) return true;
        return Boolean(entry.path && normalizePath(entry.path) === normalizePath(candidate.path));
    })?.insight;
}

function buildVisualEvidence(insight?: ProjectVisualInsight): DesignPlacementVisualEvidence {
    if (!insight) {
        return {
            status: 'needs_visual_analysis',
            styleTags: [],
            evidenceSources: []
        };
    }
    return {
        status: 'cached_insight',
        summary: sanitizeText(insight.summary),
        productType: sanitizeText(insight.productType),
        scene: sanitizeText(insight.scene),
        material: sanitizeText(insight.material),
        styleTags: uniqueStrings(insight.styleTags || []),
        evidenceSources: ['project-visual-insight-cache', ...(insight.modelId ? [`model:${sanitizeText(insight.modelId)}`] : [])]
    };
}

function buildCaseEvidence(input: {
    visualInsight?: ProjectVisualInsight;
    visualCaseIndex?: EagleVisualCaseIndex | null;
}): DesignPlacementCaseEvidence {
    const queryTags = uniqueStrings([
        ...(input.visualInsight?.styleTags || []),
        input.visualInsight?.productType || '',
        input.visualInsight?.scene || '',
        input.visualInsight?.material || ''
    ]);
    const matchedCases = (input.visualCaseIndex?.cases || [])
        .map((item) => ({
            item,
            matchedTags: intersectStrings(queryTags, item.asset.tags)
        }))
        .filter((match) => match.matchedTags.length > 0);
    return {
        status: matchedCases.length > 0 ? 'metadata_case_reference' : 'none',
        matchedCaseIds: matchedCases.map((match) => match.item.caseId),
        matchedTags: uniqueStrings(matchedCases.flatMap((match) => match.matchedTags)),
        limitations: [
            '案例匹配只基于标签和视觉摘要关键词，不代表版式已经复刻或审美质量通过。',
            'Eagle visual case 当前仍是元数据级案例，不能替代真实 OCR、主体框、主色或构图分析。'
        ]
    };
}

function buildCandidateReviewRequirements(input: {
    visualEvidence: DesignPlacementVisualEvidence;
    placementPlan: DesignPlacementPlanWithoutConfidence;
}): DesignPlacementReviewRequirement[] {
    const requirements: DesignPlacementReviewRequirement[] = [];
    if (input.visualEvidence.status !== 'cached_insight') {
        requirements.push(buildReviewRequirement('visual_insight_required', 'required', '候选缺少真实视觉理解证据。'));
    }
    if (input.placementPlan.evidenceTier === 'metadata') {
        requirements.push(buildReviewRequirement('subject_bounds_required', 'required', '当前只按整图元数据规划，缺少主体边界，不能声明审美裁切通过。'));
    }
    requirements.push(buildReviewRequirement('actual_bounds_readback_required', 'required', 'Photoshop 执行后必须读取 actualBounds，不能把计划框当结果。'));
    requirements.push(buildReviewRequirement('screenshot_or_manual_review_required', 'recommended', '高风险主图或最终交付需要截图 QA、pixel probe 或人工复核。'));
    return mergeReviewRequirements(requirements);
}

function buildReviewRequirement(
    type: DesignPlacementReviewRequirementType,
    severity: DesignPlacementReviewRequirement['severity'],
    reason: string
): DesignPlacementReviewRequirement {
    return { type, severity, reason };
}

function buildScorecard(input: {
    asset: ProjectAssetIndexAsset;
    visualEvidence: DesignPlacementVisualEvidence;
    caseEvidence: DesignPlacementCaseEvidence;
    placementPlan: DesignPlacementPlanWithoutConfidence;
    reviewRequirements: DesignPlacementReviewRequirement[];
}): DesignPlacementScorecard {
    const items: DesignPlacementScorecardItem[] = [
        {
            id: 'source-trace',
            label: '素材来源可追溯',
            points: input.asset.path && input.asset.width && input.asset.height ? 20 : 8,
            maxPoints: 20,
            reason: input.asset.path && input.asset.width && input.asset.height
                ? '项目索引包含路径和尺寸。'
                : '素材来源或尺寸证据不足。'
        },
        {
            id: 'visual-evidence',
            label: '视觉证据',
            points: input.visualEvidence.status === 'cached_insight' ? 30 : 0,
            maxPoints: 30,
            reason: input.visualEvidence.status === 'cached_insight'
                ? '已有视觉缓存摘要可作为候选判断依据。'
                : '缺少视觉缓存，需要视觉模型或人工观察。'
        },
        {
            id: 'case-reference',
            label: '案例参考匹配',
            points: input.caseEvidence.matchedCaseIds.length > 0 ? 15 : 0,
            maxPoints: 15,
            reason: input.caseEvidence.matchedCaseIds.length > 0
                ? `匹配 ${input.caseEvidence.matchedCaseIds.length} 个 Eagle 元数据案例。`
                : '没有匹配到可用案例元数据。'
        },
        {
            id: 'placement-readiness',
            label: '置入计划可生成',
            points: input.placementPlan.status === 'ready' ? 20 : input.placementPlan.status === 'needs_review' ? 12 : 0,
            maxPoints: 20,
            reason: `ImagePlacementCore status=${input.placementPlan.status}; evidence=${input.placementPlan.evidenceTier}。`
        },
        {
            id: 'reviewability',
            label: '可复核性',
            points: input.reviewRequirements.some((item) => item.type === 'actual_bounds_readback_required') ? 15 : 5,
            maxPoints: 15,
            reason: '候选明确要求执行后 actualBounds 与截图/人工复核。'
        }
    ];
    return {
        version: 'design-placement-scorecard/v0',
        totalScore: items.reduce((sum, item) => sum + item.points, 0),
        maxScore: items.reduce((sum, item) => sum + item.maxPoints, 0),
        items,
        limitations: [
            '分数只用于候选排序和解释，不是审美结论或自动决策依据。',
            '没有 subject bounds、actualBounds 和截图/人工复核时，不能用分数声明设计质量通过。'
        ]
    };
}

function stripConfidenceFromPlacementPlan(plan: ImagePlacementPlan): DesignPlacementPlanWithoutConfidence {
    const next = JSON.parse(JSON.stringify(plan)) as DesignPlacementPlanWithoutConfidence & {
        decision?: Record<string, unknown>;
    };
    if (next.decision) {
        delete next.decision.confidence;
    }
    return next as DesignPlacementPlanWithoutConfidence;
}

function buildCandidateWarnings(input: {
    visualEvidence: DesignPlacementVisualEvidence;
    placementPlan: DesignPlacementPlanWithoutConfidence;
}): string[] {
    return uniqueStrings([
        input.visualEvidence.status === 'needs_visual_analysis' ? '缺少视觉理解证据，不能做自动审美选择。' : '',
        ...input.placementPlan.warnings
    ]);
}

function buildPlanWarnings(
    input: DesignPlacementIntelligenceInput,
    candidates: DesignPlacementCandidate[]
): string[] {
    return uniqueStrings([
        ...(input.assetIndex?.warnings || []),
        ...(input.visualSamplingPlan?.warnings || []),
        ...(input.visualInsightCache?.warnings || []),
        ...(input.visualCaseIndex?.warnings || []),
        ...candidates.flatMap((candidate) => candidate.warnings)
    ]);
}

function resolveStatus(input: {
    blockers: string[];
    candidates: DesignPlacementCandidate[];
}): DesignPlacementIntelligenceStatus {
    if (input.blockers.length > 0) return 'blocked';
    if (input.candidates.length === 0) return 'needs_visual_evidence';
    if (input.candidates.every((candidate) => candidate.visualEvidence.status !== 'cached_insight')) {
        return 'needs_visual_evidence';
    }
    if (input.candidates.length > 1) return 'needs_user_or_model_selection';
    return 'ready_for_placement_plan';
}

function mergeReviewRequirements(items: DesignPlacementReviewRequirement[]): DesignPlacementReviewRequirement[] {
    const byType = new Map<DesignPlacementReviewRequirementType, DesignPlacementReviewRequirement>();
    for (const item of items) {
        const current = byType.get(item.type);
        if (!current || current.severity !== 'required') {
            byType.set(item.type, item);
        }
    }
    return Array.from(byType.values());
}

function intersectStrings(left: string[], right: string[]): string[] {
    const rightSet = new Set(right.map((item) => item.toLowerCase()));
    return uniqueStrings(left.filter((item) => rightSet.has(item.toLowerCase())));
}

function normalizePath(value: unknown): string {
    return String(value || '').trim().replace(/\\/g, '/');
}

function sanitizeText(value: unknown): string | undefined {
    let text = String(value || '').trim();
    if (!text) return undefined;
    for (const token of FORBIDDEN_PAYLOAD_TOKENS) {
        text = text.split(token).join('[redacted]');
    }
    return text;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
    return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}
