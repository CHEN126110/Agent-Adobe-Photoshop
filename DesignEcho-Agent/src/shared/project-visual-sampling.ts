import type { EvidenceRef } from './design-agent-os-contracts';
import { buildAgentVisualSamplingBudget } from './agent-performance-policy';
import type {
    ProjectAssetIndex,
    ProjectAssetIndexAsset,
    ProjectAssetIndexVisionCandidate,
    ProjectAssetRole
} from './project-asset-index';

export type ProjectVisualSamplingVersion = 'project-visual-sampling/v0';
export type ProjectVisualSamplingMode = 'bounded-metadata-plan';
export type ProjectVisualSamplingScenario =
    | 'main-image'
    | 'detail-page'
    | 'sku'
    | 'reference-replication'
    | 'general-design'
    | 'unknown';
export type ProjectVisualSamplingCacheStatus = 'hit' | 'miss' | 'stale';

export interface ProjectVisualInsight {
    assetId: string;
    path: string;
    summary?: string;
    productType?: string;
    scene?: string;
    material?: string;
    styleTags?: string[];
    capturedAt?: string;
    modelId?: string;
    expiresAt?: string;
    evidence?: EvidenceRef[];
}

export interface ProjectVisualSamplingCacheEntry {
    cacheKey: string;
    assetId?: string;
    path?: string;
    updatedAt?: string;
    expiresAt?: string;
    insight?: ProjectVisualInsight;
    evidence?: EvidenceRef[];
}

export interface ProjectVisualSamplingCandidate {
    assetId: string;
    path: string;
    role: ProjectAssetRole;
    priority: number;
    score: number;
    reason: string;
    cacheKey: string;
    cacheStatus: ProjectVisualSamplingCacheStatus;
    shouldAnalyze: boolean;
    requiredEvidence: string[];
    cachedInsight?: ProjectVisualInsight;
    evidence: EvidenceRef[];
}

export interface ProjectVisualSamplingPlan {
    planVersion: ProjectVisualSamplingVersion;
    mode: ProjectVisualSamplingMode;
    scenario: ProjectVisualSamplingScenario;
    maxCandidates: number;
    selectedCandidates: ProjectVisualSamplingCandidate[];
    skippedCandidateCount: number;
    cacheSummary: {
        hit: number;
        miss: number;
        stale: number;
        shouldAnalyze: number;
    };
    warnings: string[];
    limitations: string[];
    evidence: EvidenceRef[];
}

export interface BuildProjectVisualSamplingPlanInput {
    assetIndex?: ProjectAssetIndex | null;
    scenario?: ProjectVisualSamplingScenario;
    maxCandidates?: number;
    cachedInsights?: ProjectVisualSamplingCacheEntry[];
    nowIso?: string;
}

const ROLE_PREFERENCE_BY_SCENARIO: Record<ProjectVisualSamplingScenario, ProjectAssetRole[]> = {
    'main-image': ['raw-model-wear', 'raw-product-still', 'color-single', 'raw-detail-closeup', 'unknown'],
    'detail-page': ['raw-detail-closeup', 'raw-model-wear', 'raw-product-still', 'color-single', 'unknown'],
    sku: ['color-single', 'raw-product-still', 'raw-detail-closeup', 'raw-model-wear', 'unknown'],
    'reference-replication': ['raw-model-wear', 'raw-product-still', 'color-single', 'raw-detail-closeup', 'unknown'],
    'general-design': ['raw-model-wear', 'raw-product-still', 'raw-detail-closeup', 'color-single', 'unknown'],
    unknown: ['raw-model-wear', 'raw-product-still', 'raw-detail-closeup', 'color-single', 'unknown']
};

function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

function normalizePath(value: unknown): string {
    return normalizeText(value).replace(/\\/g, '/');
}

function stableHash(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function rolePreferenceScore(role: ProjectAssetRole, scenario: ProjectVisualSamplingScenario): number {
    const roles = ROLE_PREFERENCE_BY_SCENARIO[scenario] || ROLE_PREFERENCE_BY_SCENARIO.unknown;
    const index = roles.indexOf(role);
    if (index < 0) return 0;
    return (roles.length - index) * 25;
}

function isExpired(expiresAt: string | undefined, nowMs: number): boolean {
    if (!expiresAt) return false;
    const expiresMs = Date.parse(expiresAt);
    return Number.isFinite(expiresMs) && expiresMs <= nowMs;
}

function findCacheEntry(
    candidate: ProjectAssetIndexVisionCandidate,
    cacheKey: string,
    cachedInsights: ProjectVisualSamplingCacheEntry[]
): ProjectVisualSamplingCacheEntry | undefined {
    return cachedInsights.find((entry) => {
        if (entry.cacheKey === cacheKey) return true;
        if (entry.assetId && entry.assetId === candidate.assetId) return true;
        return Boolean(entry.path && normalizePath(entry.path) === normalizePath(candidate.path));
    });
}

function cacheStatusForEntry(
    entry: ProjectVisualSamplingCacheEntry | undefined,
    nowMs: number
): ProjectVisualSamplingCacheStatus {
    if (!entry?.insight) return 'miss';
    if (isExpired(entry.expiresAt || entry.insight.expiresAt, nowMs)) return 'stale';
    return 'hit';
}

function buildCacheSummary(candidates: ProjectVisualSamplingCandidate[]): ProjectVisualSamplingPlan['cacheSummary'] {
    return candidates.reduce((summary, candidate) => {
        summary[candidate.cacheStatus] += 1;
        if (candidate.shouldAnalyze) summary.shouldAnalyze += 1;
        return summary;
    }, { hit: 0, miss: 0, stale: 0, shouldAnalyze: 0 });
}

function assetById(assetIndex: ProjectAssetIndex): Map<string, ProjectAssetIndexAsset> {
    const map = new Map<string, ProjectAssetIndexAsset>();
    for (const asset of assetIndex.assets || []) {
        map.set(asset.id, asset);
    }
    return map;
}

function scoreCandidate(
    candidate: ProjectAssetIndexVisionCandidate,
    asset: ProjectAssetIndexAsset | undefined,
    scenario: ProjectVisualSamplingScenario
): number {
    return rolePreferenceScore(candidate.role, scenario)
        + candidate.priority
        + Math.round((asset?.confidence || 0) * 10);
}

export function buildProjectVisualSamplingCacheKey(asset: Pick<ProjectAssetIndexAsset, 'id' | 'path' | 'role' | 'sizeBytes' | 'width' | 'height'>): string {
    const source = [
        normalizeText(asset.id),
        normalizePath(asset.path),
        normalizeText(asset.role),
        normalizeText(asset.sizeBytes),
        normalizeText(asset.width),
        normalizeText(asset.height)
    ].join('|');
    return `project-visual:${stableHash(source)}`;
}

export function buildProjectVisualSamplingPlan(input: BuildProjectVisualSamplingPlanInput): ProjectVisualSamplingPlan {
    const scenario = input.scenario || 'general-design';
    const visualBudget = buildAgentVisualSamplingBudget({
        scenario,
        requestedMaxCandidates: input.maxCandidates
    });
    const maxCandidates = visualBudget.maxCandidates;
    const nowIso = input.nowIso || new Date().toISOString();
    const nowMs = Date.parse(nowIso);
    const assetIndex = input.assetIndex || null;
    const cachedInsights = input.cachedInsights || [];
    const warnings: string[] = [];

    if (!assetIndex) {
        warnings.push('缺少 ProjectAssetIndex，无法生成可靠视觉抽样候选。');
    }
    if (maxCandidates === 0) {
        warnings.push('视觉抽样候选上限为 0，本轮不会建议调用视觉模型。');
    }

    const assetLookup = assetIndex ? assetById(assetIndex) : new Map<string, ProjectAssetIndexAsset>();
    const sortedCandidates = [...(assetIndex?.visionCandidates || [])]
        .map((candidate) => ({
            candidate,
            asset: assetLookup.get(candidate.assetId),
            score: scoreCandidate(candidate, assetLookup.get(candidate.assetId), scenario)
        }))
        .sort((left, right) => {
            if (right.score !== left.score) return right.score - left.score;
            return normalizePath(left.candidate.path).localeCompare(normalizePath(right.candidate.path));
        });

    const selectedCandidates: ProjectVisualSamplingCandidate[] = sortedCandidates.slice(0, maxCandidates).map(({ candidate, asset, score }): ProjectVisualSamplingCandidate => {
        const cacheKey = asset
            ? buildProjectVisualSamplingCacheKey(asset)
            : `project-visual:${stableHash(`${candidate.assetId}|${candidate.path}|${candidate.role}`)}`;
        const cacheEntry = findCacheEntry(candidate, cacheKey, cachedInsights);
        const cacheStatus = cacheStatusForEntry(cacheEntry, Number.isFinite(nowMs) ? nowMs : Date.now());
        return {
            assetId: candidate.assetId,
            path: normalizePath(candidate.path),
            role: candidate.role,
            priority: candidate.priority,
            score,
            reason: candidate.reason,
            cacheKey,
            cacheStatus,
            shouldAnalyze: cacheStatus !== 'hit',
            requiredEvidence: [
                'image pixels or thumbnail must be inspected by a visual model or human',
                'product type, scene, material, and usable design role must come from real visual evidence'
            ],
            cachedInsight: cacheStatus === 'hit' ? cacheEntry?.insight : undefined,
            evidence: [{
                source: 'project-visual-sampling',
                summary: `${normalizePath(candidate.path)} selected for ${scenario}; cache=${cacheStatus}; score=${score}.`,
                status: cacheStatus === 'hit' ? 'needs_review' as const : 'unknown' as const
            }]
        };
    });

    if (assetIndex && assetIndex.visionCandidates.length > 0 && selectedCandidates.length === 0) {
        warnings.push('项目存在视觉候选图，但本轮上限或过滤规则导致没有选中图片。');
    }

    const cacheSummary = buildCacheSummary(selectedCandidates);

    return {
        planVersion: 'project-visual-sampling/v0',
        mode: 'bounded-metadata-plan',
        scenario,
        maxCandidates,
        selectedCandidates,
        skippedCandidateCount: Math.max(0, (assetIndex?.visionCandidates.length || 0) - selectedCandidates.length),
        cacheSummary,
        warnings,
        limitations: [
            'VisualSamplingPlan 只决定最多分析哪些候选图，不读取图片像素，不调用视觉模型。',
            'cache hit 只代表已有视觉证据可复用，不代表审美质量通过。',
            'miss/stale 只是后续视觉模型候选，不得编造产品款式、场景或卖点。',
            '该计划不改变 Photoshop 执行参数，也不替代真实验收。'
        ],
        evidence: [...visualBudget.evidence, {
            source: 'project-visual-sampling',
            summary: `Selected ${selectedCandidates.length}/${assetIndex?.visionCandidates.length || 0} visual candidates for ${scenario}; cache hits=${cacheSummary.hit}.`,
            status: selectedCandidates.length > 0 ? 'needs_review' : 'unknown'
        }]
    };
}
