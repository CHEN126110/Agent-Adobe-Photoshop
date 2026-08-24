/**
 * 通用多图视觉观察记录契约。
 *
 * Skill 可以在复合结果中返回该 Bundle，把每张画面的稳定身份、像素载荷与预期覆盖率
 * 一起交给 Agent Runtime。它只描述“哪些画面需要被看、实际看到了什么”，不拥有
 * DesignVerdict、任务完成或交付通过权。
 */

export const VISUAL_OBSERVATION_BUNDLE_VERSION = 'visual-observation-bundle/v1' as const;
export const VISUAL_OBSERVATION_REVIEW_DECISION_VERSION = 'visual-observation-review-decision/v1' as const;
export const VISUAL_OBSERVATION_REVIEW_BATCH_VERSION = 'visual-observation-review-batch/v1' as const;
export const VISUAL_OBSERVATION_RECEIPT_VERSION = 'visual-observation-receipt/v1' as const;
export const DESIGN_REVIEW_SET_VERSION = 'design-review-set/v1' as const;

const MAX_BUNDLE_SCAN_DEPTH = 10;
const MAX_BUNDLE_SCAN_NODES = 512;
/** Runtime evidence scan ceiling. Model-facing candidate limits remain separately budgeted. */
export const MAX_VISUAL_OBSERVATION_BUNDLE_ITEMS = 128;

const BUNDLE_CONTAINER_KEYS = new Set([
    'data',
    'result',
    'output',
    'toolresults',
    'observations',
    'visualobservations',
    'artifacts',
    'visualobservationbundle',
    'visualobservationbundles'
]);

export interface VisualObservationIdentity {
    /** 外层 Tool / Skill 名称。 */
    outer: string;
    /** 相对于外层结果的稳定 JSON 路径或业务结果路径。 */
    resultPath: string;
    /** Photoshop 文档身份；未知时使用 unknown，不得借空值跨文档合并。 */
    document: string;
    /** Photoshop history/version 身份；未知时使用 unknown，不得借空值跨版本合并。 */
    history: string;
    /** screen / canvas / annotated_canvas / export / reference 等通用品类。 */
    sourceKind: string;
    /** 屏幕、画布、导出图或参考图的稳定业务 id。 */
    sourceId: string;
}

export interface VisualObservationImagePayload {
    base64?: string;
    imageData?: string;
    dataUrl?: string;
    format?: string;
    mediaType?: string;
    contentFingerprint?: string;
    encodedLength?: number;
    omittedFromRuntimeLog?: boolean;
}

export type VisualObservationReviewStatus = 'passed' | 'needs_fix' | 'unreadable';

/**
 * 逐观察记录观察决定，不是第二个质量 Verdict。
 * `passed` 只表示该画面已被真实查看且未在本次观察中发现需修问题；
 * 最终任务质量仍由现有 Evaluation Profile + DesignVerdict 决定。
 */
export interface VisualObservationReviewDecision {
    version: typeof VISUAL_OBSERVATION_REVIEW_DECISION_VERSION;
    observationKey: string;
    status: VisualObservationReviewStatus;
    reviewer: 'primary_model' | 'visual_expert';
    summary: string;
    /**
     * 只有模型实际比较了当前候选与前一候选时才填写。
     * 这是模型的选择理由，Harness 不根据元素增减自行生成。
     */
    comparisonReason?: string;
    issues?: string[];
}

export interface VisualObservationReviewBatch {
    version: typeof VISUAL_OBSERVATION_REVIEW_BATCH_VERSION;
    decisions: VisualObservationReviewDecision[];
}

export interface VisualObservationItem {
    identity: VisualObservationIdentity;
    label?: string;
    captured: boolean;
    image?: VisualObservationImagePayload;
    reviewDecision?: VisualObservationReviewDecision;
}

export interface VisualObservationTarget {
    sourceKind: string;
    sourceId: string;
}

export interface VisualObservationOverflow {
    omittedCount: number;
    reason:
        | 'producer_limit'
        | 'harness_candidate_limit'
        | 'harness_analysis_limit'
        | 'payload_scan_limit'
        | 'unknown';
    sourceIds?: string[];
}

export interface VisualObservationBundle {
    version: typeof VISUAL_OBSERVATION_BUNDLE_VERSION;
    expectedObservationCount: number;
    /**
     * Producer 的预期目标集合。它把“预期 12 张”收紧为“预期哪 12 个画面”，
     * 防止重复或错误屏幕借相同数量冒充完整覆盖。旧 producer 可暂不提供。
     */
    expectedTargets?: VisualObservationTarget[];
    items: VisualObservationItem[];
    overflow?: VisualObservationOverflow;
}

export type DesignReviewSetSource = 'visual_observation_bundle' | 'single_surface';

export interface DesignReviewSetItem {
    observationKey: string;
    identity: VisualObservationIdentity;
    image: VisualObservationImagePayload;
}

/**
 * R5 对现有视觉观察记录的运行时投影。它只证明“终审实际拿到了哪些同版本像素”，
 * 不拥有质量结论、任务完成或交付权限。
 */
export interface DesignReviewSet {
    version: typeof DESIGN_REVIEW_SET_VERSION;
    source: DesignReviewSetSource;
    document: string;
    history: string;
    expectedObservationCount: number;
    coverageBasis: 'declared_targets' | 'self_derived';
    expectedTargets: readonly VisualObservationTarget[];
    items: readonly DesignReviewSetItem[];
}

export type DesignReviewSetRejectReason =
    | 'missing_image'
    | 'expected_count_mismatch'
    | 'duplicate_observation'
    | 'duplicate_source'
    | 'undeclared_targets'
    | 'unexpected_source'
    | 'mixed_document'
    | 'mixed_history'
    | 'overflow';

export type BuildDesignReviewSetResult =
    | { status: 'ready'; reviewSet: DesignReviewSet }
    | { status: 'incomplete_evidence'; reasons: readonly DesignReviewSetRejectReason[] };

export interface VisualObservationReceipt {
    version: typeof VISUAL_OBSERVATION_RECEIPT_VERSION;
    document: string;
    history: string;
    sourceTool: string;
}

export interface VisualObservationBundleScanResult {
    bundles: VisualObservationBundle[];
    truncated: boolean;
    invalidBundleCount: number;
}

export interface VisualObservationBundleSummary {
    bundleCount: number;
    expectedCount: number;
    capturedCount: number;
    reviewedCount: number;
    passedCount: number;
    needsFixCount: number;
    unreadableCount: number;
    unreviewedCount: number;
    overflowCount: number;
    fullyReviewed: boolean;
    allPassed: boolean;
    observationKeys: string[];
}

interface VisualObservationIdentityFallback {
    outer?: unknown;
    resultPath?: unknown;
    document?: unknown;
    history?: unknown;
    sourceKind?: unknown;
    sourceId?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanIdentityPart(value: unknown, fallback = 'unknown'): string {
    const cleaned = String(value ?? '').trim();
    return cleaned || fallback;
}

function normalizeKey(value: unknown): string {
    return String(value || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function readDocumentIdentity(value: Record<string, unknown>, fallback?: unknown): unknown {
    if (value.document !== undefined) {
        if (isRecord(value.document)) {
            return value.document.documentId ?? value.document.id ?? value.document.name ?? fallback;
        }
        return value.document;
    }
    const historyStateRef = isRecord(value.historyStateRef) ? value.historyStateRef : undefined;
    return value.documentId
        ?? value.docId
        ?? historyStateRef?.documentId
        ?? fallback;
}

function readHistoryIdentity(value: Record<string, unknown>, fallback?: unknown): unknown {
    if (value.history !== undefined) {
        if (isRecord(value.history)) {
            return value.history.historyStateId ?? value.history.id ?? fallback;
        }
        return value.history;
    }
    const historyStateRef = isRecord(value.historyStateRef) ? value.historyStateRef : undefined;
    return value.historyStateId
        ?? historyStateRef?.historyStateId
        ?? fallback;
}

export function normalizeVisualObservationIdentity(
    value: unknown,
    fallback: VisualObservationIdentityFallback = {}
): VisualObservationIdentity {
    const record = isRecord(value) ? value : {};
    return {
        outer: cleanIdentityPart(record.outer ?? record.outerToolName ?? fallback.outer),
        resultPath: cleanIdentityPart(record.resultPath ?? fallback.resultPath, '$'),
        document: cleanIdentityPart(readDocumentIdentity(record, fallback.document)),
        history: cleanIdentityPart(readHistoryIdentity(record, fallback.history)),
        sourceKind: cleanIdentityPart(record.sourceKind ?? fallback.sourceKind),
        sourceId: cleanIdentityPart(
            record.sourceId
            ?? record.screenId
            ?? record.id
            ?? fallback.sourceId
        )
    };
}

function encodeObservationKeyPart(value: string): string {
    return encodeURIComponent(value);
}

export function buildVisualObservationKey(identity: VisualObservationIdentity): string {
    return [
        identity.outer,
        identity.resultPath,
        identity.document,
        identity.history,
        identity.sourceKind,
        identity.sourceId
    ].map(encodeObservationKeyPart).join('|');
}

export function sameVisualObservationIdentity(
    left: VisualObservationIdentity | undefined,
    right: VisualObservationIdentity | undefined
): boolean {
    return Boolean(left && right && buildVisualObservationKey(left) === buildVisualObservationKey(right));
}

export function readVisualObservationReviewDecision(
    value: unknown,
    expectedObservationKey?: string
): VisualObservationReviewDecision | undefined {
    if (!isRecord(value)
        || value.version !== VISUAL_OBSERVATION_REVIEW_DECISION_VERSION
        || (value.status !== 'passed' && value.status !== 'needs_fix' && value.status !== 'unreadable')
        || (value.reviewer !== 'primary_model' && value.reviewer !== 'visual_expert')) {
        return undefined;
    }
    const observationKey = cleanIdentityPart(value.observationKey, '');
    const summary = cleanIdentityPart(value.summary, '');
    const comparisonReason = cleanIdentityPart(value.comparisonReason, '');
    if (!observationKey || !summary || (expectedObservationKey && observationKey !== expectedObservationKey)) {
        return undefined;
    }
    const issues = Array.isArray(value.issues)
        ? value.issues.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 24)
        : [];
    if (value.status === 'passed' && issues.length > 0) return undefined;
    return {
        version: VISUAL_OBSERVATION_REVIEW_DECISION_VERSION,
        observationKey,
        status: value.status,
        reviewer: value.reviewer,
        summary,
        ...(comparisonReason ? { comparisonReason } : {}),
        ...(issues.length > 0 ? { issues } : {})
    };
}

function normalizeObservationItem(
    value: unknown,
    fallback: VisualObservationIdentityFallback
): VisualObservationItem | undefined {
    if (!isRecord(value)) return undefined;
    const identity = normalizeVisualObservationIdentity(value.identity, {
        ...fallback,
        resultPath: isRecord(value.identity)
            ? value.identity.resultPath ?? fallback.resultPath
            : fallback.resultPath,
        sourceKind: isRecord(value.identity)
            ? value.identity.sourceKind ?? fallback.sourceKind
            : fallback.sourceKind,
        sourceId: isRecord(value.identity)
            ? value.identity.sourceId ?? fallback.sourceId
            : fallback.sourceId
    });
    const observationKey = buildVisualObservationKey(identity);
    const image = isRecord(value.image)
        ? {
            ...(typeof value.image.base64 === 'string' ? { base64: value.image.base64 } : {}),
            ...(typeof value.image.imageData === 'string' ? { imageData: value.image.imageData } : {}),
            ...(typeof value.image.dataUrl === 'string' ? { dataUrl: value.image.dataUrl } : {}),
            ...(typeof value.image.format === 'string' ? { format: value.image.format } : {}),
            ...(typeof value.image.mediaType === 'string' ? { mediaType: value.image.mediaType } : {}),
            ...(typeof value.image.contentFingerprint === 'string'
                ? { contentFingerprint: value.image.contentFingerprint }
                : {}),
            ...(Number.isFinite(Number(value.image.encodedLength))
                ? { encodedLength: Math.max(0, Math.round(Number(value.image.encodedLength))) }
                : {}),
            ...(value.image.omittedFromRuntimeLog === true ? { omittedFromRuntimeLog: true } : {})
        }
        : undefined;
    // v1 的 captured 是验收事实，不从“看起来像图片的字段”反推。显式 false 与
    // 图片字段同时出现属于矛盾观察记录，必须保持未捕获；否则生产端可借残留 payload
    // 绕过缺图分母。运行日志压缩后仍保留原始 captured=true。
    const captured = value.captured === true;
    const decision = readVisualObservationReviewDecision(value.reviewDecision, observationKey);
    return {
        identity,
        ...(String(value.label || '').trim() ? { label: String(value.label).trim() } : {}),
        captured,
        ...(image && Object.keys(image).length > 0 ? { image } : {}),
        ...(decision ? { reviewDecision: decision } : {})
    };
}

export function readVisualObservationBundle(
    value: unknown,
    fallback: VisualObservationIdentityFallback = {}
): VisualObservationBundle | undefined {
    if (!isRecord(value)
        || value.version !== VISUAL_OBSERVATION_BUNDLE_VERSION
        || !Array.isArray(value.items)
        || value.items.length > MAX_VISUAL_OBSERVATION_BUNDLE_ITEMS) return undefined;
    const declaredExpected = Number(value.expectedObservationCount);
    if (!Number.isSafeInteger(declaredExpected) || declaredExpected <= 0) return undefined;
    const rawItems = value.items;
    const items = rawItems
        .map((item, index) => normalizeObservationItem(item, {
            ...fallback,
            resultPath: `${cleanIdentityPart(fallback.resultPath, '$')}.items[${index}]`,
            sourceId: `item-${index + 1}`
        }))
        .filter((item): item is VisualObservationItem => Boolean(item));
    if (items.length !== rawItems.length) return undefined;
    const rawExpectedTargets = Array.isArray(value.expectedTargets)
        ? value.expectedTargets
        : undefined;
    const expectedTargets = rawExpectedTargets?.map((target) => {
        if (!isRecord(target)) return undefined;
        const sourceKind = cleanIdentityPart(target.sourceKind, '');
        const sourceId = cleanIdentityPart(target.sourceId, '');
        if (!sourceKind || !sourceId) return undefined;
        return { sourceKind, sourceId };
    });
    if (rawExpectedTargets && (
        expectedTargets?.some((target) => !target)
        || expectedTargets?.length !== declaredExpected
        || new Set(expectedTargets.map((target) => `${target?.sourceKind}|${target?.sourceId}`)).size
            !== expectedTargets.length
    )) return undefined;
    const rawOverflow = isRecord(value.overflow) ? value.overflow : undefined;
    const omittedCount = Math.max(0, Math.round(Number(rawOverflow?.omittedCount || 0)));
    const reason = rawOverflow?.reason === 'producer_limit'
        || rawOverflow?.reason === 'harness_candidate_limit'
        || rawOverflow?.reason === 'harness_analysis_limit'
        || rawOverflow?.reason === 'payload_scan_limit'
        ? rawOverflow.reason
        : 'unknown';
    const sourceIds = Array.isArray(rawOverflow?.sourceIds)
        ? rawOverflow.sourceIds.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 64)
        : [];
    if (declaredExpected !== items.length + omittedCount) return undefined;
    return {
        version: VISUAL_OBSERVATION_BUNDLE_VERSION,
        expectedObservationCount: declaredExpected,
        ...(expectedTargets ? {
            expectedTargets: expectedTargets as VisualObservationTarget[]
        } : {}),
        items,
        ...(omittedCount > 0 ? {
            overflow: {
                omittedCount,
                reason,
                ...(sourceIds.length > 0 ? { sourceIds } : {})
            }
        } : {})
    };
}

function buildVisualObservationTargetKey(target: VisualObservationTarget): string {
    return `${encodeObservationKeyPart(target.sourceKind)}|${encodeObservationKeyPart(target.sourceId)}`;
}

function cloneVisualObservationImage(
    image: VisualObservationImagePayload
): VisualObservationImagePayload {
    return {
        ...(typeof image.base64 === 'string' ? { base64: image.base64 } : {}),
        ...(typeof image.imageData === 'string' ? { imageData: image.imageData } : {}),
        ...(typeof image.dataUrl === 'string' ? { dataUrl: image.dataUrl } : {}),
        ...(typeof image.format === 'string' ? { format: image.format } : {}),
        ...(typeof image.mediaType === 'string' ? { mediaType: image.mediaType } : {}),
        ...(typeof image.contentFingerprint === 'string'
            ? { contentFingerprint: image.contentFingerprint }
            : {}),
        ...(typeof image.encodedLength === 'number' ? { encodedLength: image.encodedLength } : {}),
        ...(image.omittedFromRuntimeLog === true ? { omittedFromRuntimeLog: true } : {})
    };
}

function hasReviewableVisualObservationImage(image: VisualObservationImagePayload | undefined): boolean {
    if (!image || image.omittedFromRuntimeLog === true) return false;
    return Boolean(
        String(image.dataUrl || '').trim()
        || String(image.base64 || '').trim()
        || String(image.imageData || '').trim()
    );
}

/**
 * 把一个 producer Bundle 收紧为同文档、同历史版本、目标集合精确完整的终审证据。
 * 返回值复制像素字段，避免随后运行日志压缩原位删除 ToolResult 时破坏终审证据。
 */
export function buildDesignReviewSetFromBundle(
    bundle: VisualObservationBundle,
    options: { expectedTargets?: readonly VisualObservationTarget[] } = {}
): BuildDesignReviewSetResult {
    const reasons = new Set<DesignReviewSetRejectReason>();
    const declaredExpectedTargets = options.expectedTargets || bundle.expectedTargets;
    const coverageBasis: DesignReviewSet['coverageBasis'] = declaredExpectedTargets
        ? 'declared_targets'
        : 'self_derived';
    const expectedTargets = (declaredExpectedTargets
        || bundle.items.map((item) => ({
            sourceKind: item.identity.sourceKind,
            sourceId: item.identity.sourceId
        }))).map((target) => ({
            sourceKind: cleanIdentityPart(target.sourceKind, ''),
            sourceId: cleanIdentityPart(target.sourceId, '')
        }));
    const expectedTargetKeys = expectedTargets.map(buildVisualObservationTargetKey);
    const uniqueExpectedTargetKeys = new Set(expectedTargetKeys);
    if (bundle.overflow && bundle.overflow.omittedCount > 0) reasons.add('overflow');
    if (bundle.expectedObservationCount <= 0
        || bundle.items.length !== bundle.expectedObservationCount
        || expectedTargets.length !== bundle.expectedObservationCount) {
        reasons.add('expected_count_mismatch');
    }
    if (uniqueExpectedTargetKeys.size !== expectedTargetKeys.length) {
        reasons.add('duplicate_source');
    }

    const reviewItems: DesignReviewSetItem[] = [];
    const observationKeys = new Set<string>();
    const actualTargetKeys = new Set<string>();
    let document = '';
    let history = '';
    for (const item of bundle.items) {
        const observationKey = buildVisualObservationKey(item.identity);
        const targetKey = buildVisualObservationTargetKey(item.identity);
        if (observationKeys.has(observationKey)) reasons.add('duplicate_observation');
        if (actualTargetKeys.has(targetKey)) reasons.add('duplicate_source');
        observationKeys.add(observationKey);
        actualTargetKeys.add(targetKey);
        if (!uniqueExpectedTargetKeys.has(targetKey)) reasons.add('unexpected_source');
        if (!item.captured || !hasReviewableVisualObservationImage(item.image)) {
            reasons.add('missing_image');
            continue;
        }
        const reviewImage = item.image as VisualObservationImagePayload;
        if (!document) document = item.identity.document;
        if (!history) history = item.identity.history;
        if (!item.identity.document
            || item.identity.document === 'unknown'
            || item.identity.document !== document) {
            reasons.add('mixed_document');
        }
        if (!item.identity.history
            || item.identity.history === 'unknown'
            || item.identity.history !== history) {
            reasons.add('mixed_history');
        }
        reviewItems.push({
            observationKey,
            identity: { ...item.identity },
            image: cloneVisualObservationImage(reviewImage)
        });
    }
    if (actualTargetKeys.size !== uniqueExpectedTargetKeys.size
        || Array.from(uniqueExpectedTargetKeys).some((key) => !actualTargetKeys.has(key))) {
        reasons.add('unexpected_source');
    }
    if (reviewItems.length !== bundle.expectedObservationCount) {
        reasons.add('expected_count_mismatch');
    }
    if (reasons.size > 0) {
        return {
            status: 'incomplete_evidence',
            reasons: Array.from(reasons).sort()
        };
    }
    return {
        status: 'ready',
        reviewSet: {
            version: DESIGN_REVIEW_SET_VERSION,
            source: 'visual_observation_bundle',
            document,
            history,
            expectedObservationCount: bundle.expectedObservationCount,
            coverageBasis,
            expectedTargets: expectedTargets.map((target) => ({ ...target })),
            items: reviewItems
        }
    };
}

export function buildDesignReviewSetFromSingleSurface(input: {
    identity: VisualObservationIdentity;
    image: VisualObservationImagePayload;
}): BuildDesignReviewSetResult {
    const item: VisualObservationItem = {
        identity: { ...input.identity },
        captured: hasReviewableVisualObservationImage(input.image),
        image: cloneVisualObservationImage(input.image)
    };
    const result = buildDesignReviewSetFromBundle({
        version: VISUAL_OBSERVATION_BUNDLE_VERSION,
        expectedObservationCount: 1,
        expectedTargets: [{
            sourceKind: input.identity.sourceKind,
            sourceId: input.identity.sourceId
        }],
        items: [item]
    });
    if (result.status !== 'ready') return result;
    return {
        status: 'ready',
        reviewSet: {
            ...result.reviewSet,
            source: 'single_surface'
        }
    };
}

export function isDesignReviewSetForVersion(
    reviewSet: DesignReviewSet,
    version: Pick<VisualObservationIdentity, 'document' | 'history'>
): boolean {
    return Boolean(
        reviewSet.document
        && reviewSet.history
        && reviewSet.document === version.document
        && reviewSet.history === version.history
        && reviewSet.items.every((item) => (
            item.identity.document === version.document
            && item.identity.history === version.history
        ))
    );
}

function collectBundles(
    value: unknown,
    outer: string,
    resultPath: string,
    depth: number,
    visited: WeakSet<object>,
    budget: { nodes: number },
    result: VisualObservationBundleScanResult
): void {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    if (depth > MAX_BUNDLE_SCAN_DEPTH || budget.nodes >= MAX_BUNDLE_SCAN_NODES) {
        result.truncated = true;
        return;
    }
    visited.add(value);
    budget.nodes += 1;
    const direct = readVisualObservationBundle(value, { outer, resultPath });
    if (isRecord(value) && value.version === VISUAL_OBSERVATION_BUNDLE_VERSION) {
        if (direct) result.bundles.push(direct);
        else result.invalidBundleCount += 1;
        return;
    }
    if (Array.isArray(value)) {
        if (value.length > MAX_VISUAL_OBSERVATION_BUNDLE_ITEMS) result.truncated = true;
        for (let index = 0; index < Math.min(value.length, MAX_VISUAL_OBSERVATION_BUNDLE_ITEMS); index += 1) {
            collectBundles(
                value[index],
                outer,
                `${resultPath}[${index}]`,
                depth + 1,
                visited,
                budget,
                result
            );
        }
        return;
    }
    for (const [key, child] of Object.entries(value)) {
        if (!BUNDLE_CONTAINER_KEYS.has(normalizeKey(key))) continue;
        collectBundles(
            child,
            outer,
            `${resultPath}.${key}`,
            depth + 1,
            visited,
            budget,
            result
        );
    }
}

export function inspectVisualObservationBundles(
    value: unknown,
    outer = 'unknown'
): VisualObservationBundleScanResult {
    const result: VisualObservationBundleScanResult = {
        bundles: [],
        truncated: false,
        invalidBundleCount: 0
    };
    collectBundles(
        value,
        cleanIdentityPart(outer),
        '$',
        0,
        new WeakSet<object>(),
        { nodes: 0 },
        result
    );
    return result;
}

export function readVisualObservationBundles(
    value: unknown,
    outer = 'unknown'
): VisualObservationBundle[] {
    return inspectVisualObservationBundles(value, outer).bundles;
}

export function readVisualObservationReceipt(value: unknown): VisualObservationReceipt | undefined {
    if (!isRecord(value) || value.version !== VISUAL_OBSERVATION_RECEIPT_VERSION) return undefined;
    const document = cleanIdentityPart(value.document, '');
    const history = cleanIdentityPart(value.history, '');
    const sourceTool = cleanIdentityPart(value.sourceTool, '');
    if (!document || document === 'unknown'
        || !history || history === 'unknown'
        || !sourceTool) return undefined;
    return {
        version: VISUAL_OBSERVATION_RECEIPT_VERSION,
        document,
        history,
        sourceTool
    };
}

export function readVisualObservationReviewBatch(value: unknown): VisualObservationReviewBatch | undefined {
    if (!isRecord(value)
        || value.version !== VISUAL_OBSERVATION_REVIEW_BATCH_VERSION
        || !Array.isArray(value.decisions)) {
        return undefined;
    }
    const decisions = value.decisions
        .map((item) => readVisualObservationReviewDecision(item))
        .filter((item): item is VisualObservationReviewDecision => Boolean(item))
        .slice(0, MAX_VISUAL_OBSERVATION_BUNDLE_ITEMS);
    if (decisions.length === 0) return undefined;
    return {
        version: VISUAL_OBSERVATION_REVIEW_BATCH_VERSION,
        decisions
    };
}

export function summarizeVisualObservationBundles(
    bundles: VisualObservationBundle[],
    externalDecisions: VisualObservationReviewDecision[] = []
): VisualObservationBundleSummary {
    const decisionsByKey = new Map<string, VisualObservationReviewDecision>();
    const conflictedDecisionKeys = new Set<string>();
    for (const decision of externalDecisions) {
        const normalized = readVisualObservationReviewDecision(decision);
        if (!normalized || conflictedDecisionKeys.has(normalized.observationKey)) continue;
        const previous = decisionsByKey.get(normalized.observationKey);
        if (!previous) {
            decisionsByKey.set(normalized.observationKey, normalized);
            continue;
        }
        const same = previous.status === normalized.status
            && previous.summary === normalized.summary
            && JSON.stringify(previous.issues || []) === JSON.stringify(normalized.issues || []);
        if (!same) {
            decisionsByKey.delete(normalized.observationKey);
            conflictedDecisionKeys.add(normalized.observationKey);
        }
    }
    const uniqueItems = new Map<string, VisualObservationItem>();
    const payloadSignatures = new Map<string, string>();
    const conflictedItemKeys = new Set<string>();
    const countedBundleSignatures = new Set<string>();
    let declaredMissingCount = 0;
    let overflowCount = 0;
    for (const bundle of bundles) {
        const bundleObservationKeys = bundle.items
            .map((item) => {
                const payload = item.image?.dataUrl || item.image?.base64 || item.image?.imageData || '';
                return [
                    buildVisualObservationKey(item.identity),
                    item.captured,
                    item.image?.contentFingerprint || '',
                    item.image?.encodedLength || payload.length,
                    payload.slice(0, 32),
                    payload.slice(-32)
                ].join(':');
            })
            .sort();
        const bundleSignature = [
            bundle.expectedObservationCount,
            bundle.overflow?.omittedCount || 0,
            ...bundleObservationKeys
        ].join('|');
        if (!countedBundleSignatures.has(bundleSignature)) {
            countedBundleSignatures.add(bundleSignature);
            declaredMissingCount += Math.max(0, bundle.expectedObservationCount - bundle.items.length);
            overflowCount += Math.max(0, bundle.overflow?.omittedCount || 0);
        }
        for (const item of bundle.items) {
            const observationKey = buildVisualObservationKey(item.identity);
            const payload = item.image?.dataUrl || item.image?.base64 || item.image?.imageData || '';
            const payloadSignature = [
                item.captured,
                item.image?.contentFingerprint || '',
                item.image?.encodedLength || payload.length,
                payload.slice(0, 48),
                payload.slice(-48)
            ].join(':');
            const previousSignature = payloadSignatures.get(observationKey);
            if (previousSignature && previousSignature !== payloadSignature) {
                conflictedItemKeys.add(observationKey);
                continue;
            }
            payloadSignatures.set(observationKey, payloadSignature);
            uniqueItems.set(observationKey, item);
        }
    }

    let reviewedCount = 0;
    let passedCount = 0;
    let needsFixCount = 0;
    let unreadableCount = conflictedItemKeys.size + conflictedDecisionKeys.size;
    for (const [observationKey, item] of uniqueItems) {
        if (!item.captured
            || conflictedItemKeys.has(observationKey)
            || conflictedDecisionKeys.has(observationKey)) continue;
        const decision = decisionsByKey.get(observationKey);
        if (!decision) continue;
        reviewedCount += 1;
        if (decision.status === 'passed') passedCount += 1;
        else if (decision.status === 'needs_fix') needsFixCount += 1;
        else unreadableCount += 1;
    }

    const capturedCount = Array.from(uniqueItems.values()).filter((item) => item.captured).length;
    const expectedCount = uniqueItems.size + declaredMissingCount;
    const unreviewedCount = Math.max(0, expectedCount - reviewedCount);
    return {
        bundleCount: bundles.length,
        expectedCount,
        capturedCount,
        reviewedCount,
        passedCount,
        needsFixCount,
        unreadableCount,
        unreviewedCount,
        overflowCount,
        fullyReviewed: expectedCount > 0
            && reviewedCount >= expectedCount
            && capturedCount >= expectedCount
            && unreadableCount === 0
            && overflowCount === 0,
        allPassed: expectedCount > 0
            && passedCount >= expectedCount
            && capturedCount >= expectedCount
            && needsFixCount === 0
            && unreadableCount === 0
            && overflowCount === 0,
        observationKeys: Array.from(uniqueItems.keys())
    };
}
