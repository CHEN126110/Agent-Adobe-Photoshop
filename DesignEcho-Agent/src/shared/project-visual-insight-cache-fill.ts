import type { EvidenceRef } from './design-agent-os-contracts';
import type {
    ProjectVisualInsight,
    ProjectVisualSamplingCacheEntry,
    ProjectVisualSamplingCandidate,
    ProjectVisualSamplingPlan
} from './project-visual-sampling';

export type ProjectVisualInsightCacheFillStatus =
    | 'disabled'
    | 'skipped_no_project'
    | 'skipped_no_candidates'
    | 'blocked_no_analyzer'
    | 'blocked_no_writer'
    | 'ready'
    | 'completed'
    | 'partial'
    | 'failed';

export interface AssetAnalysisPayload {
    success?: boolean;
    analysis?: {
        description?: string;
        category?: string;
        mainSubject?: string;
        colors?: string[];
        style?: string;
        suggestedPlacement?: string;
        suggestedEffects?: string[];
        scene?: string;
        material?: string;
    };
    error?: string;
}

export interface ProjectVisualInsightCacheFillPlan {
    planVersion: 'project-visual-insight-cache-fill/v0';
    status: ProjectVisualInsightCacheFillStatus;
    enabled: boolean;
    shouldCallAnalyzer: boolean;
    projectPath?: string;
    maxCandidates: number;
    candidates: ProjectVisualSamplingCandidate[];
    skippedCandidateCount: number;
    reason: string;
    warnings: string[];
    limitations: string[];
    evidence: EvidenceRef[];
}

export interface ProjectVisualInsightCacheFillEntryResult {
    candidate: ProjectVisualSamplingCandidate;
    status: 'completed' | 'failed';
    entry?: ProjectVisualSamplingCacheEntry;
    error?: string;
    evidence: EvidenceRef[];
}

export interface ProjectVisualInsightCacheFillResult {
    status: ProjectVisualInsightCacheFillStatus;
    plan: ProjectVisualInsightCacheFillPlan;
    analyzedCount: number;
    successCount: number;
    failedCount: number;
    entries: ProjectVisualSamplingCacheEntry[];
    entryResults: ProjectVisualInsightCacheFillEntryResult[];
    warnings: string[];
    limitations: string[];
    evidence: EvidenceRef[];
}

export interface BuildProjectVisualInsightCacheFillPlanInput {
    projectPath?: string | null;
    visualSamplingPlan?: ProjectVisualSamplingPlan | null;
    enabled?: unknown;
    hasAnalyzer?: boolean;
    hasWriter?: boolean;
    maxCandidates?: number;
}

export interface MapAssetAnalysisToProjectVisualInsightInput {
    candidate: ProjectVisualSamplingCandidate;
    payload?: AssetAnalysisPayload | null;
    modelId?: string;
    capturedAt?: string;
}

const HARD_MAX_FILL_CANDIDATES = 8;

function cleanString(value: unknown): string {
    return String(value || '').trim();
}

function cleanPath(value: unknown): string {
    return cleanString(value).replace(/\\/g, '/');
}

function cleanList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map(cleanString).filter(Boolean);
}

function uniq(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean)));
}

function parseEnabled(value: unknown): boolean {
    if (value === true) return true;
    const text = cleanString(value).toLowerCase();
    return ['true', '1', 'yes', 'on', 'enabled', 'auto', 'required'].includes(text);
}

function normalizeMaxCandidates(requested: unknown, planMaxCandidates: number): number {
    const parsed = Number.parseInt(String(requested ?? ''), 10);
    const requestedMax = Number.isFinite(parsed) && parsed > 0 ? parsed : planMaxCandidates;
    return Math.max(0, Math.min(requestedMax, planMaxCandidates, HARD_MAX_FILL_CANDIDATES));
}

function buildCommonLimitations(): string[] {
    return [
        '该流程必须显式启用；默认不会批量调用视觉模型分析全项目图片。',
        '该流程只写入结构化视觉摘要，不允许保存 raw image、原始图像编码、pixel data 或 data URL。',
        '视觉缓存命中只代表存在可复用的素材理解证据，不代表设计质量、审美质量或 Photoshop 输出通过。'
    ];
}

function buildPlanEvidence(
    status: ProjectVisualInsightCacheFillStatus,
    summary: string
): EvidenceRef[] {
    return [{
        source: 'project-visual-insight-cache-fill',
        summary,
        status: status === 'completed' ? 'passed' : status === 'failed' ? 'failed' : 'needs_review'
    }];
}

export function isProjectVisualInsightCacheFillEnabled(value: unknown): boolean {
    return parseEnabled(value);
}

export function buildProjectVisualInsightCacheFillPlan(
    input: BuildProjectVisualInsightCacheFillPlanInput
): ProjectVisualInsightCacheFillPlan {
    const enabled = parseEnabled(input.enabled);
    const projectPath = cleanString(input.projectPath);
    const visualSamplingPlan = input.visualSamplingPlan || null;
    const hasAnalyzer = input.hasAnalyzer !== false;
    const hasWriter = input.hasWriter !== false;
    const maxCandidates = normalizeMaxCandidates(input.maxCandidates, visualSamplingPlan?.maxCandidates || 0);
    const candidates = (visualSamplingPlan?.selectedCandidates || [])
        .filter((candidate) => candidate.shouldAnalyze)
        .slice(0, maxCandidates);
    const limitations = buildCommonLimitations();

    if (!enabled) {
        const reason = '未显式启用项目视觉洞察缓存填充，保持 metadata-only 上下文边界。';
        return {
            planVersion: 'project-visual-insight-cache-fill/v0',
            status: 'disabled',
            enabled,
            shouldCallAnalyzer: false,
            projectPath: projectPath || undefined,
            maxCandidates,
            candidates: [],
            skippedCandidateCount: Math.max(0, visualSamplingPlan?.cacheSummary.shouldAnalyze || 0),
            reason,
            warnings: ['项目图片仍需要视觉模型或人工证据，不能从文件名推断款式、材质或场景。'],
            limitations,
            evidence: buildPlanEvidence('disabled', reason)
        };
    }

    if (!projectPath) {
        const reason = '已请求视觉洞察缓存填充，但缺少项目路径。';
        return {
            planVersion: 'project-visual-insight-cache-fill/v0',
            status: 'skipped_no_project',
            enabled,
            shouldCallAnalyzer: false,
            maxCandidates,
            candidates: [],
            skippedCandidateCount: 0,
            reason,
            warnings: ['缺少 projectPath，无法写入 .designecho/visual-insights-cache.json。'],
            limitations,
            evidence: buildPlanEvidence('skipped_no_project', reason)
        };
    }

    if (!visualSamplingPlan || candidates.length === 0) {
        const reason = '已请求视觉洞察缓存填充，但没有需要分析的视觉候选。';
        return {
            planVersion: 'project-visual-insight-cache-fill/v0',
            status: 'skipped_no_candidates',
            enabled,
            shouldCallAnalyzer: false,
            projectPath,
            maxCandidates,
            candidates: [],
            skippedCandidateCount: 0,
            reason,
            warnings: visualSamplingPlan
                ? ['当前 VisualSamplingPlan 没有 cache miss/stale 的候选。']
                : ['缺少 VisualSamplingPlan，无法安全选择有限视觉候选。'],
            limitations,
            evidence: buildPlanEvidence('skipped_no_candidates', reason)
        };
    }

    if (!hasAnalyzer) {
        const reason = '已请求视觉洞察缓存填充，但当前环境没有 analyzeAssetContent 能力。';
        return {
            planVersion: 'project-visual-insight-cache-fill/v0',
            status: 'blocked_no_analyzer',
            enabled,
            shouldCallAnalyzer: false,
            projectPath,
            maxCandidates,
            candidates,
            skippedCandidateCount: Math.max(0, (visualSamplingPlan?.cacheSummary.shouldAnalyze || 0) - candidates.length),
            reason,
            warnings: ['缺少 renderer preload 暴露的 analyzeAssetContent。'],
            limitations,
            evidence: buildPlanEvidence('blocked_no_analyzer', reason)
        };
    }

    if (!hasWriter) {
        const reason = '已请求视觉洞察缓存填充，但当前环境没有 writeProjectVisualInsightCache 能力。';
        return {
            planVersion: 'project-visual-insight-cache-fill/v0',
            status: 'blocked_no_writer',
            enabled,
            shouldCallAnalyzer: false,
            projectPath,
            maxCandidates,
            candidates,
            skippedCandidateCount: Math.max(0, (visualSamplingPlan?.cacheSummary.shouldAnalyze || 0) - candidates.length),
            reason,
            warnings: ['缺少 renderer preload 暴露的 writeProjectVisualInsightCache。'],
            limitations,
            evidence: buildPlanEvidence('blocked_no_writer', reason)
        };
    }

    const reason = `已显式启用项目视觉洞察缓存填充，将分析 ${candidates.length} 个有界候选。`;
    return {
        planVersion: 'project-visual-insight-cache-fill/v0',
        status: 'ready',
        enabled,
        shouldCallAnalyzer: true,
        projectPath,
        maxCandidates,
        candidates,
        skippedCandidateCount: Math.max(0, (visualSamplingPlan?.cacheSummary.shouldAnalyze || 0) - candidates.length),
        reason,
        warnings: [],
        limitations,
        evidence: buildPlanEvidence('ready', reason)
    };
}

export function mapAssetAnalysisToProjectVisualInsight(
    input: MapAssetAnalysisToProjectVisualInsightInput
): ProjectVisualInsight | null {
    if (!input.payload?.success || !input.payload.analysis) return null;
    const analysis = input.payload.analysis;
    const description = cleanString(analysis.description);
    const category = cleanString(analysis.category);
    const mainSubject = cleanString(analysis.mainSubject);
    const style = cleanString(analysis.style);
    const scene = cleanString(analysis.scene) || cleanString(analysis.suggestedPlacement);
    const material = cleanString(analysis.material);
    const colors = cleanList(analysis.colors);
    const suggestedEffects = cleanList(analysis.suggestedEffects);
    const summaryParts = [
        description,
        mainSubject ? `主体：${mainSubject}` : '',
        category ? `类别：${category}` : ''
    ].filter(Boolean);

    if (summaryParts.length === 0) return null;

    return {
        assetId: input.candidate.assetId,
        path: cleanPath(input.candidate.path),
        summary: summaryParts.join('；'),
        productType: mainSubject || category || undefined,
        scene: scene || undefined,
        material: material || undefined,
        styleTags: uniq([
            category,
            style,
            ...colors.slice(0, 6),
            ...suggestedEffects.slice(0, 6)
        ]),
        capturedAt: input.capturedAt,
        modelId: cleanString(input.modelId) || undefined,
        evidence: [{
            source: 'project-visual-insight-cache-fill',
            summary: `视觉模型返回 ${cleanPath(input.candidate.path)} 的结构化素材摘要。`,
            status: 'needs_review',
            confidence: mainSubject || description ? 0.62 : 0.45
        }]
    };
}

export function buildProjectVisualInsightCacheEntry(input: {
    candidate: ProjectVisualSamplingCandidate;
    insight: ProjectVisualInsight;
    updatedAt?: string;
}): ProjectVisualSamplingCacheEntry {
    const updatedAt = cleanString(input.updatedAt) || new Date().toISOString();
    return {
        cacheKey: input.candidate.cacheKey,
        assetId: input.candidate.assetId,
        path: cleanPath(input.candidate.path),
        updatedAt,
        insight: {
            ...input.insight,
            capturedAt: input.insight.capturedAt || updatedAt
        },
        evidence: [{
            source: 'project-visual-insight-cache-fill',
            summary: `缓存条目来自显式 opt-in 视觉分析：${cleanPath(input.candidate.path)}。`,
            status: 'needs_review'
        }]
    };
}

export function buildProjectVisualInsightCacheFillResult(input: {
    plan: ProjectVisualInsightCacheFillPlan;
    entryResults?: ProjectVisualInsightCacheFillEntryResult[];
    writeSucceeded?: boolean;
    writeError?: unknown;
}): ProjectVisualInsightCacheFillResult {
    const entryResults = input.entryResults || [];
    const entries = entryResults.map((result) => result.entry).filter(Boolean) as ProjectVisualSamplingCacheEntry[];
    const analyzedCount = entryResults.length;
    const successCount = entryResults.filter((result) => result.status === 'completed').length;
    const failedCount = entryResults.filter((result) => result.status === 'failed').length;
    const writeError = cleanString(input.writeError);
    let status: ProjectVisualInsightCacheFillStatus = input.plan.status;

    if (input.plan.shouldCallAnalyzer) {
        if (successCount === 0) {
            status = 'failed';
        } else if (failedCount > 0 || input.writeSucceeded === false) {
            status = 'partial';
        } else {
            status = 'completed';
        }
    }

    const warnings = [
        ...input.plan.warnings,
        ...entryResults.map((result) => result.error || '').filter(Boolean),
        writeError ? `视觉洞察缓存写入失败：${writeError}` : ''
    ].filter(Boolean);

    return {
        status,
        plan: input.plan,
        analyzedCount,
        successCount,
        failedCount,
        entries,
        entryResults,
        warnings,
        limitations: input.plan.limitations,
        evidence: [
            ...input.plan.evidence,
            {
                source: 'project-visual-insight-cache-fill',
                summary: `分析 ${analyzedCount} 个候选，成功 ${successCount} 个，失败 ${failedCount} 个。`,
                status: status === 'completed' ? 'passed' : status === 'failed' ? 'failed' : 'needs_review'
            }
        ]
    };
}
