import type { AcceptanceSnapshot } from '../../../shared/acceptance/photoshop-acceptance';
import type { RuntimeDesignBriefDeclaration } from '../../../shared/agent-runtime-v5/runtime-design-brief-declaration';
import {
    buildRuntimeReferenceEvaluationContext,
    type RuntimeReferenceBriefDeclaration
} from '../../../shared/agent-runtime-v5/runtime-reference-context';
import {
    buildRuntimeDesignStrategyDigest,
    type RuntimeDesignStrategyDeclaration
} from '../../../shared/agent-runtime-v5/runtime-design-strategy-declaration';
import type {
    DesignEvaluationProfile,
    DesignEvaluationVerificationRecord
} from '../../../shared/agent-runtime-v5/design-evaluation-profiles';
import {
    detectDesignArtifactStructureConcerns,
    type DesignArtifactStructureConcernReport
} from '../../../shared/design-artifact-structure-concerns';
import {
    extractDesignRunToolLogFacts,
    normalizeAssetPathKey,
    type DesignRunSupportingSourcePlacement
} from '../../../shared/design-run-tool-log-facts';
import {
    buildVlmJudgeContextMessage,
    type DesignQualityMeasurements
} from '../../../shared/design-quality-assertion';
import {
    readPhotoshopHistoryStateRef,
    samePhotoshopHistoryStateRef,
    type PhotoshopHistoryStateRef
} from '../../../shared/photoshop-history-state-ref';
import type { AgentToolCallLogEntry, ContentBlock } from './types';

export interface DesignFinalReviewSupportingImage {
    sourceId: string;
    sourceSlot: DesignRunSupportingSourcePlacement['sourceSlot'];
    declaredRole?: string;
    data: string;
    mediaType: 'image/jpeg';
}

export type DesignFinalReviewSupportingSourceCoverageReason =
    | 'acceptance_snapshot_missing'
    | 'acceptance_snapshot_incomplete'
    | 'source_binding_missing'
    | 'layer_visibility_unknown'
    | 'visual_capacity_insufficient'
    | 'preview_provider_unavailable'
    | 'preview_failed';

export interface DesignFinalReviewSupportingSourceCoverage {
    status: 'complete' | 'incomplete';
    reasonCodes: DesignFinalReviewSupportingSourceCoverageReason[];
    finalVisibleSourceCount: number;
    projectedSourceCount: number;
    maxImages: number;
    ignoredUnboundPlacementCount: number;
}

export interface DesignFinalReviewSupportingSourceSelection {
    placements: DesignRunSupportingSourcePlacement[];
    coverage: DesignFinalReviewSupportingSourceCoverage;
}

export interface DesignFinalReviewSupportingImageResult {
    images: DesignFinalReviewSupportingImage[];
    coverage: DesignFinalReviewSupportingSourceCoverage;
}

export function projectDesignFinalReviewSupportingSources(
    images: readonly DesignFinalReviewSupportingImage[]
): Array<{
    sourceId: string;
    sourceSlot: string;
    declaredRole?: string;
    hasVisualPreview: boolean;
}> {
    return images.map((item) => ({
        sourceId: item.sourceId,
        sourceSlot: item.sourceSlot,
        ...(item.declaredRole ? { declaredRole: item.declaredRole } : {}),
        hasVisualPreview: true
    }));
}

export function buildDesignFinalReviewSupportingImagePayload(
    images: readonly DesignFinalReviewSupportingImage[]
): {
    contentBlocks: ContentBlock[];
    candidateKeys: string[];
    candidateCount: number;
} {
    const contentBlocks: ContentBlock[] = [];
    images.forEach((item) => {
        contentBlocks.push({
            type: 'text',
            text: `支持图｜sourceId=${item.sourceId}｜type=final_bound_supporting_source｜仅用于比较源图到成品，不计入交付画面覆盖率，也不代表 Harness 选定素材赢家`
        });
        contentBlocks.push({ type: 'image', data: item.data, mediaType: item.mediaType });
    });
    return {
        contentBlocks,
        candidateKeys: images.map((item) => item.sourceId),
        candidateCount: images.length
    };
}

export interface DesignFinalReviewDerivedViewPayload {
    status: 'ready' | 'not_required' | 'unavailable';
    contentBlocks: ContentBlock[];
    candidateKeys: string[];
    candidateCount: number;
}

export function projectDesignFinalReviewDerivedViewPayload(input: {
    requiredViews: readonly ('native_surface' | 'list_thumbnail')[];
    thumbnail: { data: string; mediaType: string } | null;
    sourceObservationKey: string;
}): DesignFinalReviewDerivedViewPayload {
    if (!input.requiredViews.includes('list_thumbnail')) {
        return {
            status: 'not_required',
            contentBlocks: [],
            candidateKeys: [],
            candidateCount: 0
        };
    }
    if (!input.thumbnail?.data || input.thumbnail.mediaType !== 'image/jpeg') {
        return {
            status: 'unavailable',
            contentBlocks: [],
            candidateKeys: [],
            candidateCount: 0
        };
    }
    const sourceObservationKey = String(input.sourceObservationKey || '').trim();
    if (!sourceObservationKey) {
        return {
            status: 'unavailable',
            contentBlocks: [],
            candidateKeys: [],
            candidateCount: 0
        };
    }
    const candidateKey = `${sourceObservationKey}:review_view:list_thumbnail:240`;
    return {
        status: 'ready',
        contentBlocks: [
            {
                type: 'text',
                text: '真实使用视图｜type=profile_required_review_view｜view=list_thumbnail｜maxEdge=240｜由同一版本成品派生，只用于检查列表尺寸下的识别、焦点与层级'
            },
            { type: 'image', data: input.thumbnail.data, mediaType: 'image/jpeg' }
        ],
        candidateKeys: [candidateKey],
        candidateCount: 1
    };
}

/**
 * 根据 Evaluation Profile 把同一版本成品投影到真实观看情境。这里只派生像素与身份，
 * 不根据缩略图选设计方向、不设置字号或主体比例。缩略算法由 Renderer 现有
 * 图像管线注入，便于纯逻辑回归用精确假图验证 presentation 组装。
 */
export async function buildDesignFinalReviewDerivedViewPayload(input: {
    requiredViews: readonly ('native_surface' | 'list_thumbnail')[];
    sourceImage: { data: string; mediaType: string };
    sourceObservationKey: string;
    buildThumbnail: (
        image: { data: string; mediaType: string },
        maxEdge: number
    ) => Promise<{ data: string; mediaType: string } | null>;
}): Promise<DesignFinalReviewDerivedViewPayload> {
    if (!input.requiredViews.includes('list_thumbnail')) {
        return projectDesignFinalReviewDerivedViewPayload({
            requiredViews: input.requiredViews,
            thumbnail: null,
            sourceObservationKey: input.sourceObservationKey
        });
    }
    const thumbnail = await input.buildThumbnail(input.sourceImage, 240);
    return projectDesignFinalReviewDerivedViewPayload({
        requiredViews: input.requiredViews,
        thumbnail,
        sourceObservationKey: input.sourceObservationKey
    });
}

function appendContextPart(
    parts: string[],
    label: string,
    value: string | readonly string[] | undefined,
    maxLength = 160,
    maxItems = 4,
    maxItemLength = 120
): void {
    const raw = Array.isArray(value)
        ? value
            .slice(0, maxItems)
            .map((item) => String(item || '').replace(/\s+/gu, ' ').trim().slice(0, maxItemLength))
            .filter(Boolean)
            .join('、')
        : String(value || '').trim();
    const text = raw.replace(/\s+/gu, ' ').slice(0, maxLength);
    if (text) parts.push(`${label}：${text}`);
}

export function buildDesignFinalReviewModelContext(input: {
    task: string;
    designBrief?: RuntimeDesignBriefDeclaration;
    designStrategy?: RuntimeDesignStrategyDeclaration;
    referenceBrief?: RuntimeReferenceBriefDeclaration;
    evaluationGoal?: string;
    measurements: DesignQualityMeasurements;
    mutationBoundDesignIntent: string;
    structureConcernReport: DesignArtifactStructureConcernReport;
    supportingSources: Array<{
        sourceId: string;
        sourceSlot: string;
        declaredRole?: string;
        hasVisualPreview: boolean;
    }>;
    supportingSourceCoverage: DesignFinalReviewSupportingSourceCoverage;
    reviewSetIdentity: {
        document: string;
        history: string;
        expectedObservationCount: number;
        targets: Array<{
            imageIndex: number;
            sourceId: string;
            observationKey: string;
        }>;
    };
}): string {
    const briefParts: string[] = [];
    const brief = input.designBrief?.readiness === 'ready'
        ? input.designBrief.payload
        : undefined;
    appendContextPart(briefParts, '目标', brief?.taskGoal, 180);
    appendContextPart(briefParts, '受众', brief?.targetAudience, 180);
    appendContextPart(briefParts, '媒介', brief?.channel, 80);
    appendContextPart(briefParts, '交付', brief?.deliverables, 1600, 16, 100);
    appendContextPart(briefParts, '输出要求', brief?.outputRequirements, 1600, 16, 100);
    appendContextPart(briefParts, '约束', brief?.constraints, 1600, 16, 100);

    const strategyParts: string[] = [];
    const strategyDeclaration = input.designStrategy?.readiness === 'ready'
        ? input.designStrategy
        : undefined;
    const strategy = strategyDeclaration?.payload;
    const digest = strategyDeclaration
        ? buildRuntimeDesignStrategyDigest(strategyDeclaration)
        : undefined;
    appendContextPart(strategyParts, '首要目标', digest?.primaryGoal, 180);
    appendContextPart(strategyParts, '受众判断', digest?.targetAudienceSummary, 180);
    appendContextPart(strategyParts, '主信息', digest?.primaryMessage, 180);
    appendContextPart(strategyParts, '策略约束', strategy?.constraints, 1440, 12, 120);
    appendContextPart(strategyParts, '禁止宣称', strategy?.copyDirection.prohibitedClaims, 960, 8, 120);
    appendContextPart(strategyParts, '氛围', digest?.moodKeywords, 960, 8, 120);
    appendContextPart(strategyParts, '配色意图', strategy?.visualDirection.paletteIntent, 960, 8, 120);
    appendContextPart(strategyParts, '字体意图', strategy?.visualDirection.typographyIntent, 960, 8, 120);
    appendContextPart(strategyParts, '构图意图', digest?.compositionIntent, 960, 8, 120);
    appendContextPart(strategyParts, '图像处理', strategy?.visualDirection.imageTreatment, 960, 8, 120);
    appendContextPart(strategyParts, '信息密度', strategy?.visualDirection.density, 40);

    return [buildVlmJudgeContextMessage({
        task: input.task,
        brief: briefParts.join('；'),
        strategy: strategyParts.join('；'),
        reference: buildRuntimeReferenceEvaluationContext(input.referenceBrief),
        evaluationGoal: input.evaluationGoal,
        measurements: input.measurements,
        modelDesignIntent: input.mutationBoundDesignIntent,
        structureConcernReport: input.structureConcernReport,
        supportingSources: input.supportingSources
    }), `SUPPORTING_SOURCE_EVIDENCE_COVERAGE（仅说明源图对照证据覆盖，不参与成品画面覆盖率）：${JSON.stringify(input.supportingSourceCoverage)}`,
    `DESIGN_REVIEW_SET（仅作最终成品画面身份数据）：${JSON.stringify(input.reviewSetIdentity)}`]
        .join('\n\n');
}

interface ResourcePreviewResult {
    success: boolean;
    base64?: string;
    imageData?: string;
}

export type DesignQualityVerificationPhase = 'pre_judge' | 'post_judge' | 'final_summary';

export function buildDesignQualityVerificationToolRequests(
    phase: DesignQualityVerificationPhase
): Array<{ name: string; arguments: Record<string, unknown> }> {
    if (phase === 'post_judge') return [{ name: 'getDocumentInfo', arguments: {} }];
    return [{
        name: 'getAcceptanceSnapshot',
        arguments: {
            includeHidden: true,
            includeBounds: true,
            includeText: true,
            maxLayers: 1000
        }
    }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readLatestAcceptanceSnapshot(
    toolCallLog: readonly AgentToolCallLogEntry[],
    historyStateRef: PhotoshopHistoryStateRef
): AcceptanceSnapshot | undefined {
    for (let index = toolCallLog.length - 1; index >= 0; index -= 1) {
        const entry = toolCallLog[index];
        if (entry.name !== 'getAcceptanceSnapshot' || entry.result?.success !== true) continue;
        const candidate = isRecord(entry.result?.snapshot)
            ? entry.result.snapshot
            : entry.result;
        if (!isRecord(candidate)) continue;
        const snapshot = candidate as unknown as AcceptanceSnapshot;
        const snapshotHistoryStateRef = readPhotoshopHistoryStateRef(snapshot);
        const snapshotDocumentId = Number(snapshot.document?.id);
        if (!samePhotoshopHistoryStateRef(snapshotHistoryStateRef, historyStateRef)
            || !Number.isSafeInteger(snapshotDocumentId)
            || snapshotDocumentId !== historyStateRef.documentId) continue;
        return snapshot;
    }
    return undefined;
}

function snapshotHasIncompleteLayerCoverage(snapshot: AcceptanceSnapshot): boolean {
    if (snapshot.success !== true
        || snapshot.hasDocument !== true
        || !Array.isArray(snapshot.layers)
        || snapshot.summary?.truncated === true) {
        return true;
    }
    return (snapshot.warnings || []).some((warning) => /截断|跳过失效图层/u.test(String(warning)));
}

function readEffectiveLayerVisibility(input: {
    layerId: number;
    layersById: ReadonlyMap<number, NonNullable<AcceptanceSnapshot['layers']>[number]>;
    memo: Map<number, 'visible' | 'hidden' | 'unknown'>;
    visiting?: Set<number>;
}): 'visible' | 'hidden' | 'unknown' {
    const cached = input.memo.get(input.layerId);
    if (cached) return cached;
    const layer = input.layersById.get(input.layerId);
    if (!layer) return 'unknown';
    const opacity = Number(layer.opacity);
    if (layer.visible === false || (Number.isFinite(opacity) && opacity <= 0)) {
        input.memo.set(input.layerId, 'hidden');
        return 'hidden';
    }
    if (layer.parentId === null) {
        input.memo.set(input.layerId, 'visible');
        return 'visible';
    }
    const visiting = input.visiting || new Set<number>();
    if (visiting.has(input.layerId)) {
        input.memo.set(input.layerId, 'unknown');
        return 'unknown';
    }
    visiting.add(input.layerId);
    const parentVisibility = readEffectiveLayerVisibility({
        layerId: layer.parentId,
        layersById: input.layersById,
        memo: input.memo,
        visiting
    });
    visiting.delete(input.layerId);
    input.memo.set(input.layerId, parentVisibility);
    return parentVisibility;
}

function buildSupportingSourceCoverage(input: {
    status: 'complete' | 'incomplete';
    reasonCodes?: DesignFinalReviewSupportingSourceCoverageReason[];
    finalVisibleSourceCount: number;
    projectedSourceCount: number;
    maxImages: number;
    ignoredUnboundPlacementCount: number;
}): DesignFinalReviewSupportingSourceCoverage {
    return {
        status: input.status,
        reasonCodes: Array.from(new Set(input.reasonCodes || [])),
        finalVisibleSourceCount: input.finalVisibleSourceCount,
        projectedSourceCount: input.projectedSourceCount,
        maxImages: input.maxImages,
        ignoredUnboundPlacementCount: input.ignoredUnboundPlacementCount
    };
}

export function selectFinalSupportingSourcePlacements(input: {
    toolCallLog: readonly AgentToolCallLogEntry[];
    historyStateRef: PhotoshopHistoryStateRef;
    maxImages: number;
    /**
     * 同一 TaskRun 上一 Reflexion generation 已由 Final Judge 比较过的有界来源投影。
     * 它不表达候选排名或选择；本函数仍以本代同版本 AcceptanceSnapshot 重新验证。
     */
    priorVerifiedPlacements?: readonly DesignRunSupportingSourcePlacement[];
}): DesignFinalReviewSupportingSourceSelection {
    const requestedMaxImages = Number(input.maxImages);
    const maxImages = Number.isFinite(requestedMaxImages)
        ? Math.max(0, Math.floor(requestedMaxImages))
        : 0;
    const snapshot = readLatestAcceptanceSnapshot(input.toolCallLog, input.historyStateRef);
    if (!snapshot) {
        return {
            placements: [],
            coverage: buildSupportingSourceCoverage({
                status: 'incomplete',
                reasonCodes: ['acceptance_snapshot_missing'],
                finalVisibleSourceCount: 0,
                projectedSourceCount: 0,
                maxImages,
                ignoredUnboundPlacementCount: 0
            })
        };
    }
    if (snapshotHasIncompleteLayerCoverage(snapshot)) {
        return {
            placements: [],
            coverage: buildSupportingSourceCoverage({
                status: 'incomplete',
                reasonCodes: ['acceptance_snapshot_incomplete'],
                finalVisibleSourceCount: 0,
                projectedSourceCount: 0,
                maxImages,
                ignoredUnboundPlacementCount: 0
            })
        };
    }

    // 旧代事实在前、本代事实在后：同一 layer 本代发生替换时由 Map 的最后一次 set 覆盖；
    // 旧 layer 已删除、隐藏、换文档或结构覆盖不完整时仍会被当前快照拒绝。
    const placements = [
        ...(input.priorVerifiedPlacements || []),
        ...extractDesignRunToolLogFacts(input.toolCallLog).supportingSourcePlacements
    ];
    const ignoredUnboundPlacementCount = placements.filter((placement) => (
        placement.documentId === undefined || placement.layerId === undefined
    )).length;
    const reasons: DesignFinalReviewSupportingSourceCoverageReason[] = [];
    if (ignoredUnboundPlacementCount > 0) reasons.push('source_binding_missing');

    const layersById = new Map((snapshot.layers || []).map((layer) => [layer.id, layer]));
    const visibilityMemo = new Map<number, 'visible' | 'hidden' | 'unknown'>();
    const latestVisiblePlacementByLayer = new Map<number, DesignRunSupportingSourcePlacement>();
    for (const placement of placements) {
        if (placement.documentId !== input.historyStateRef.documentId
            || placement.layerId === undefined) continue;
        const layer = layersById.get(placement.layerId);
        if (!layer) continue;
        const visibility = readEffectiveLayerVisibility({
            layerId: placement.layerId,
            layersById,
            memo: visibilityMemo
        });
        if (visibility === 'unknown') {
            reasons.push('layer_visibility_unknown');
            continue;
        }
        if (visibility === 'hidden') continue;
        latestVisiblePlacementByLayer.set(placement.layerId, placement);
    }

    const selected: DesignRunSupportingSourcePlacement[] = [];
    const seenPaths = new Set<string>();
    for (const placement of latestVisiblePlacementByLayer.values()) {
        const pathKey = normalizeAssetPathKey(placement.path);
        if (!pathKey || seenPaths.has(pathKey)) continue;
        seenPaths.add(pathKey);
        selected.push(placement);
    }

    if (selected.length > maxImages) reasons.push('visual_capacity_insufficient');
    if (reasons.length > 0) {
        return {
            // 证据覆盖不完整时不倒序截一张冒充“最终选定源图”；终审只收到覆盖状态。
            placements: [],
            coverage: buildSupportingSourceCoverage({
                status: 'incomplete',
                reasonCodes: reasons,
                finalVisibleSourceCount: selected.length,
                projectedSourceCount: 0,
                maxImages,
                ignoredUnboundPlacementCount
            })
        };
    }
    return {
        placements: selected,
        coverage: buildSupportingSourceCoverage({
            status: 'complete',
            finalVisibleSourceCount: selected.length,
            projectedSourceCount: selected.length,
            maxImages,
            ignoredUnboundPlacementCount
        })
    };
}

/**
 * 只把已经进入 Final Judge 输入范围的来源投影给同一 TaskRun 的下一 generation。
 * 未比较、覆盖不完整或当前图层验证失败时返回空集，不从路径推断素材选择。
 */
export function projectFinalSupportingSourceCarryover(
    toolCallLog: readonly AgentToolCallLogEntry[],
    historyStateRef: PhotoshopHistoryStateRef,
    priorVerifiedPlacements: readonly DesignRunSupportingSourcePlacement[] | undefined,
    sourceCompared: boolean
): DesignRunSupportingSourcePlacement[] {
    if (!sourceCompared) return [];
    return selectFinalSupportingSourcePlacements({
        toolCallLog,
        historyStateRef,
        maxImages: 3,
        priorVerifiedPlacements
    }).placements;
}

export function buildDesignFinalReviewStructureEvidence(
    toolCallLog: readonly AgentToolCallLogEntry[]
): DesignArtifactStructureConcernReport {
    return detectDesignArtifactStructureConcerns({ toolCallLog });
}

/**
 * fresh_structure 只证明最终结构观察是否完整，不参与审美评分。覆盖不完整或不可用时
 * 保留为 needs_review；Judge 对已观察 concern 的高分不能把缺失证据升级成完整事实。
 */
export function projectDesignFinalReviewStructureVerification(
    report: DesignArtifactStructureConcernReport
): {
    status: 'passed' | 'needs_review';
    verificationRef: string;
} {
    if (report.coverage.status === 'complete') {
        return {
            status: 'passed',
            verificationRef: 'runtime:fresh-structure-snapshot:coverage-complete'
        };
    }
    return {
        status: 'needs_review',
        verificationRef: `runtime:fresh-structure-snapshot:coverage-${report.coverage.status}`
    };
}

/**
 * 把最终结构 coverage 投影到现有 Evaluation Profile verification 记录。普通设计在取得
 * surfaceSnapshot 后由这里生成 fresh_structure；scoped edit 已有精确读回记录时，只在
 * coverage 不完整时单向降级，绝不把其它失败/缺失记录抬高。
 */
export function reconcileDesignFinalReviewStructureVerificationRecords(
    toolCallLog: readonly AgentToolCallLogEntry[],
    profile: Pick<DesignEvaluationProfile, 'checks'>,
    appendFreshStructureRecords: boolean,
    inputRecords: readonly DesignEvaluationVerificationRecord[]
): DesignEvaluationVerificationRecord[] {
    const verification = projectDesignFinalReviewStructureVerification(
        buildDesignFinalReviewStructureEvidence(toolCallLog)
    );
    const freshStructureCheckKeys = new Set(profile.checks
        .filter((check) => check.runtime?.evidence === 'fresh_structure')
        .map((check) => check.key));
    const records = appendFreshStructureRecords
        ? [
            ...Array.from(freshStructureCheckKeys).map((key): DesignEvaluationVerificationRecord => ({
                key,
                status: verification.status,
                source: 'runtime_observation',
                verificationRef: verification.verificationRef
            })),
            ...inputRecords
        ]
        : [...inputRecords];
    return records.map((record) => (
        freshStructureCheckKeys.has(record.key)
        && record.status === 'passed'
        && verification.status === 'needs_review'
            ? {
                ...record,
                status: 'needs_review',
                verificationRef: verification.verificationRef
            }
            : record
    ));
}

export async function loadDesignFinalReviewSupportingImages(input: {
    toolCallLog: readonly AgentToolCallLogEntry[];
    historyStateRef: PhotoshopHistoryStateRef;
    maxImages: number;
    priorVerifiedPlacements?: readonly DesignRunSupportingSourcePlacement[];
    getResourcePreview?: (
        imagePath: string,
        maxSize?: number
    ) => Promise<ResourcePreviewResult | null>;
}): Promise<DesignFinalReviewSupportingImageResult> {
    const requestedMaxImages = Number(input.maxImages);
    const cappedMaxImages = Number.isFinite(requestedMaxImages)
        ? Math.min(3, Math.max(0, Math.floor(requestedMaxImages)))
        : 0;
    const selection = selectFinalSupportingSourcePlacements({
        toolCallLog: input.toolCallLog,
        historyStateRef: input.historyStateRef,
        maxImages: cappedMaxImages,
        priorVerifiedPlacements: input.priorVerifiedPlacements
    });
    if (selection.coverage.status !== 'complete' || selection.placements.length === 0) {
        return { images: [], coverage: selection.coverage };
    }
    if (!input.getResourcePreview) {
        return {
            images: [],
            coverage: buildSupportingSourceCoverage({
                ...selection.coverage,
                status: 'incomplete',
                reasonCodes: ['preview_provider_unavailable'],
                projectedSourceCount: 0
            })
        };
    }
    const previewResults = await Promise.allSettled(
        selection.placements.map((placement) => input.getResourcePreview?.(placement.path, 800))
    );
    const images: DesignFinalReviewSupportingImage[] = [];
    previewResults.forEach((settled, index) => {
        if (settled.status !== 'fulfilled') return;
        const placement = selection.placements[index];
        const preview = settled.value;
        const data = String(preview?.imageData || preview?.base64 || '').trim();
        if (preview?.success !== true || !data) return;
        images.push({
            sourceId: `supporting_source:${images.length + 1}`,
            sourceSlot: placement.sourceSlot,
            ...(placement.declaredRole ? { declaredRole: placement.declaredRole } : {}),
            data,
            mediaType: 'image/jpeg'
        });
    });
    if (images.length !== selection.placements.length) {
        return {
            images: [],
            coverage: buildSupportingSourceCoverage({
                ...selection.coverage,
                status: 'incomplete',
                reasonCodes: ['preview_failed'],
                projectedSourceCount: 0
            })
        };
    }
    return { images, coverage: selection.coverage };
}
