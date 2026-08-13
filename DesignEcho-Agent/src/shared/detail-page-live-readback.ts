/**
 * 详情页写入后的 PSD 文案回读契约。
 *
 * 这里不评价文案质量，只负责把“计划写什么”与 Photoshop 当前真正保存的
 * 文字图层对齐。任何缺屏、缺层或计划外文字层都会显式留痕，调用方不得用
 * 写入前的计划内容替代真实回读结果。
 */

export interface DetailPageReadbackCopyLike {
    layerId?: number;
    layerName?: string;
    content?: unknown;
    generationStatus?: unknown;
    candidateScore?: unknown;
    candidateReason?: unknown;
    requiresFactSupport?: unknown;
    supportRefs?: unknown;
    source?: unknown;
    originalText?: unknown;
    generationReason?: unknown;
}

export interface DetailPageReadbackPlanLike {
    screenId?: number;
    screenName?: string;
    screenType?: string;
    copies?: DetailPageReadbackCopyLike[];
    supportRefs?: unknown;
    copyExpected?: boolean;
    executionDeferred?: boolean;
}

export interface DetailPageReadbackPlaceholderLike {
    layerId?: number;
    layerName?: string;
    currentText?: unknown;
}

export interface DetailPageReadbackScreenLike {
    id?: number;
    name?: string;
    type?: string;
    copyPlaceholders?: DetailPageReadbackPlaceholderLike[];
}

export interface DetailPageLiveReadbackCopy extends DetailPageReadbackCopyLike {
    layerId: number;
    content: string;
    readbackStatus: 'observed' | 'missing' | 'unexpected' | 'mismatch';
    readbackMissing?: boolean;
    readbackUnexpected?: boolean;
}

export interface DetailPageLiveReadbackPlan extends DetailPageReadbackPlanLike {
    screenId: number;
    copies: DetailPageLiveReadbackCopy[];
    liveScreenMissing: boolean;
    readbackMissing: boolean;
    readbackUnexpected: boolean;
}

export interface DetailPageLiveReadbackResult {
    version: 'detail-page-live-readback/v1';
    fillPlans: DetailPageLiveReadbackPlan[];
    expectedScreenIds: number[];
    observedScreenIds: number[];
    missingScreenIds: number[];
    foreignScreenIds: number[];
    duplicateScreenIds: number[];
    missingLayerIds: number[];
    unexpectedLayerIds: number[];
    mismatchedLayerIds: number[];
    complete: boolean;
}

export interface DetailPageHistoryStateRef {
    documentId: number;
    historyStateId: number;
}

export interface DetailPageSnapshotVersionLike {
    screenId?: unknown;
    documentId?: unknown;
    historyStateId?: unknown;
    historyStateRef?: {
        documentId?: unknown;
        historyStateId?: unknown;
    };
}

export interface DetailPageLiveObservationVersionVerification {
    version: 'detail-page-live-observation-version/v1';
    status: 'passed' | 'failed';
    liveReadbackHistoryStateRef?: DetailPageHistoryStateRef;
    screenSnapshotHistoryStateRef?: DetailPageHistoryStateRef;
    missingSnapshotIdentityIndexes: number[];
    mismatchedSnapshotIdentityIndexes: number[];
    mismatchedSnapshotScreenIds: number[];
    message: string;
}

function normalizeId(value: unknown): number {
    const id = Math.round(Number(value) || 0);
    return id > 0 ? id : 0;
}

function cleanText(value: unknown): string {
    return String(value ?? '').replace(/\r\n?/g, '\n').trim();
}

function normalizeComparableText(value: unknown): string {
    return cleanText(value)
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .trim();
}

function uniqueNumbers(values: number[]): number[] {
    return Array.from(new Set(values.filter((value) => value > 0)));
}

function readPositiveSafeInteger(value: unknown): number | undefined {
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) return undefined;
    return numeric;
}

function readHistoryStateRefCandidate(value: any): DetailPageHistoryStateRef | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const historyStateRef = value.historyStateRef;
    const documentId = readPositiveSafeInteger(
        historyStateRef?.documentId ?? value.documentId
    );
    const historyStateId = readPositiveSafeInteger(
        historyStateRef?.historyStateId ?? value.historyStateId
    );
    if (documentId === undefined || historyStateId === undefined) return undefined;
    return { documentId, historyStateId };
}

export function readDetailPageHistoryStateRef(value: any): DetailPageHistoryStateRef | undefined {
    const candidates = [
        value,
        value?.data,
        value?.result,
        value?.output
    ];
    for (const candidate of candidates) {
        const historyStateRef = readHistoryStateRefCandidate(candidate);
        if (historyStateRef) return historyStateRef;
    }
    return undefined;
}

function sameDetailPageHistoryStateRef(
    left: DetailPageHistoryStateRef | undefined,
    right: DetailPageHistoryStateRef | undefined
): boolean {
    return Boolean(left
        && right
        && left.documentId === right.documentId
        && left.historyStateId === right.historyStateId);
}

/**
 * 将写后结构回读与紧随其后的屏级像素绑定到同一 Photoshop Host 版本。
 * 版本缺失、批次版本不一致，或任一截图携带不同/缺失身份时都 fail closed。
 */
export function verifyDetailPageLiveObservationVersion(input: {
    liveParseResult: any;
    snapshotResult: any;
    snapshots: readonly DetailPageSnapshotVersionLike[];
}): DetailPageLiveObservationVersionVerification {
    const liveReadbackHistoryStateRef = readDetailPageHistoryStateRef(input.liveParseResult);
    const screenSnapshotHistoryStateRef = readDetailPageHistoryStateRef(input.snapshotResult);
    const missingSnapshotIdentityIndexes: number[] = [];
    const mismatchedSnapshotIdentityIndexes: number[] = [];
    const mismatchedSnapshotScreenIds: number[] = [];

    input.snapshots.forEach((snapshot, index) => {
        const snapshotHistoryStateRef = readHistoryStateRefCandidate(snapshot);
        if (!snapshotHistoryStateRef) {
            missingSnapshotIdentityIndexes.push(index);
            return;
        }
        if (!sameDetailPageHistoryStateRef(snapshotHistoryStateRef, screenSnapshotHistoryStateRef)) {
            mismatchedSnapshotIdentityIndexes.push(index);
            const screenId = normalizeId(snapshot.screenId);
            if (screenId) mismatchedSnapshotScreenIds.push(screenId);
        }
    });

    const batchVersionMatches = sameDetailPageHistoryStateRef(
        liveReadbackHistoryStateRef,
        screenSnapshotHistoryStateRef
    );
    const status = batchVersionMatches
        && missingSnapshotIdentityIndexes.length === 0
        && mismatchedSnapshotIdentityIndexes.length === 0
        ? 'passed'
        : 'failed';
    let message = '写后结构回读与屏级截图已绑定到同一 Photoshop 文档历史版本。';
    if (!liveReadbackHistoryStateRef) {
        message = '写后详情页结构回读缺少 Photoshop 文档历史收据，不能作为当前画面的内容观察记录。';
    } else if (!screenSnapshotHistoryStateRef) {
        message = '屏级截图缺少 Photoshop 文档历史收据，不能证明像素对应写后回读版本。';
    } else if (!batchVersionMatches) {
        message = '写后详情页结构回读与屏级截图来自不同的 Photoshop 文档或历史版本。';
    } else if (missingSnapshotIdentityIndexes.length > 0) {
        message = `有 ${missingSnapshotIdentityIndexes.length} 张屏级截图缺少独立 Photoshop 历史身份。`;
    } else if (mismatchedSnapshotIdentityIndexes.length > 0) {
        const mismatchedIds = uniqueNumbers(mismatchedSnapshotScreenIds);
        message = mismatchedIds.length > 0
            ? `屏 ${mismatchedIds.join('、')} 的截图历史身份与截图批次不一致。`
            : `有 ${mismatchedSnapshotIdentityIndexes.length} 张屏级截图的历史身份与截图批次不一致。`;
    }

    return {
        version: 'detail-page-live-observation-version/v1',
        status,
        ...(liveReadbackHistoryStateRef ? { liveReadbackHistoryStateRef } : {}),
        ...(screenSnapshotHistoryStateRef ? { screenSnapshotHistoryStateRef } : {}),
        missingSnapshotIdentityIndexes,
        mismatchedSnapshotIdentityIndexes,
        mismatchedSnapshotScreenIds: uniqueNumbers(mismatchedSnapshotScreenIds),
        message
    };
}

function buildUnexpectedCopy(
    placeholder: DetailPageReadbackPlaceholderLike,
    layerId: number
): DetailPageLiveReadbackCopy {
    return {
        layerId,
        layerName: String(placeholder.layerName || '').trim(),
        content: cleanText(placeholder.currentText),
        generationStatus: 'template',
        readbackStatus: 'unexpected'
    };
}

export function buildDetailPageLiveReadback(input: {
    targetScreens: readonly DetailPageReadbackScreenLike[];
    plannedFillPlans: readonly DetailPageReadbackPlanLike[];
    liveScreens: readonly DetailPageReadbackScreenLike[];
}): DetailPageLiveReadbackResult {
    const expectedScreenIds = uniqueNumbers(input.targetScreens.map((screen) => normalizeId(screen.id)));
    const expectedScreenIdSet = new Set(expectedScreenIds);
    const liveScreenBuckets = new Map<number, DetailPageReadbackScreenLike[]>();
    const foreignScreenIds: number[] = [];

    for (const screen of input.liveScreens) {
        const screenId = normalizeId(screen.id);
        if (!screenId) continue;
        const bucket = liveScreenBuckets.get(screenId) || [];
        bucket.push(screen);
        liveScreenBuckets.set(screenId, bucket);
        if (!expectedScreenIdSet.has(screenId)) foreignScreenIds.push(screenId);
    }

    const duplicateScreenIds = Array.from(liveScreenBuckets.entries())
        .filter(([, screens]) => screens.length > 1)
        .map(([screenId]) => screenId);
    const plannedByScreenId = new Map(
        input.plannedFillPlans.map((plan) => [normalizeId(plan.screenId), plan])
    );
    const missingScreenIds: number[] = [];
    const missingLayerIds: number[] = [];
    const unexpectedLayerIds: number[] = [];
    const mismatchedLayerIds: number[] = [];
    const fillPlans: DetailPageLiveReadbackPlan[] = [];

    for (const targetScreen of input.targetScreens) {
        const screenId = normalizeId(targetScreen.id);
        if (!screenId) continue;
        const planned = plannedByScreenId.get(screenId);
        const liveBucket = liveScreenBuckets.get(screenId) || [];
        const liveScreen = liveBucket[0];
        const liveScreenMissing = !liveScreen;
        if (liveScreenMissing) missingScreenIds.push(screenId);

        const plannedCopies = Array.isArray(planned?.copies) ? planned.copies : [];
        const executionDeferred = planned?.executionDeferred === true;
        const plannedByLayerId = new Map(
            plannedCopies.map((copy) => [normalizeId(copy.layerId), copy])
        );
        const livePlaceholders = Array.isArray(liveScreen?.copyPlaceholders)
            ? liveScreen.copyPlaceholders
            : [];
        const liveByLayerId = new Map<number, DetailPageReadbackPlaceholderLike>();
        let readbackUnexpected = !planned || liveBucket.length > 1;

        for (const placeholder of livePlaceholders) {
            const layerId = normalizeId(placeholder.layerId);
            if (!layerId) {
                readbackUnexpected = true;
                continue;
            }
            if (liveByLayerId.has(layerId)) {
                readbackUnexpected = true;
                unexpectedLayerIds.push(layerId);
                continue;
            }
            liveByLayerId.set(layerId, placeholder);
        }

        const copies: DetailPageLiveReadbackCopy[] = plannedCopies.map((plannedCopy) => {
            const layerId = normalizeId(plannedCopy.layerId);
            const liveCopy = liveByLayerId.get(layerId);
            if (!liveCopy) {
                if (layerId) missingLayerIds.push(layerId);
                return {
                    ...plannedCopy,
                    layerId,
                    content: '',
                    readbackStatus: 'missing',
                    readbackMissing: true
                };
            }
            liveByLayerId.delete(layerId);
            const observedContent = cleanText(liveCopy.currentText);
            const plannedContent = cleanText(plannedCopy.content);
            const textMatches = normalizeComparableText(observedContent)
                === normalizeComparableText(plannedContent);
            if (!textMatches) {
                mismatchedLayerIds.push(layerId);
                readbackUnexpected = true;
            }
            return {
                ...plannedCopy,
                layerId,
                layerName: String(liveCopy.layerName || plannedCopy.layerName || '').trim(),
                content: observedContent,
                readbackStatus: textMatches ? 'observed' : 'mismatch',
                ...(!textMatches ? { readbackUnexpected: true } : {})
            };
        });

        if (!executionDeferred) {
            for (const [layerId, placeholder] of liveByLayerId.entries()) {
                unexpectedLayerIds.push(layerId);
                readbackUnexpected = true;
                copies.push(buildUnexpectedCopy(placeholder, layerId));
            }
        }

        const readbackMissing = !executionDeferred && (liveScreenMissing
            || plannedCopies.some((copy) => !livePlaceholders.some(
                (placeholder) => normalizeId(placeholder.layerId) === normalizeId(copy.layerId)
            )));
        fillPlans.push({
            ...(planned || {
                screenId,
                screenName: String(targetScreen.name || '').trim(),
                screenType: String(targetScreen.type || '').trim()
            }),
            screenId,
            copies,
            copyExpected: executionDeferred
                ? false
                : (targetScreen.copyPlaceholders?.length || 0) > 0,
            liveScreenMissing,
            readbackMissing,
            readbackUnexpected
        });
    }

    const observedScreenIds = expectedScreenIds.filter((screenId) => liveScreenBuckets.has(screenId));
    const normalizedForeignScreenIds = uniqueNumbers(foreignScreenIds);
    const normalizedDuplicateScreenIds = uniqueNumbers(duplicateScreenIds);
    const normalizedMissingLayerIds = uniqueNumbers(missingLayerIds);
    const normalizedUnexpectedLayerIds = uniqueNumbers(unexpectedLayerIds);
    const normalizedMismatchedLayerIds = uniqueNumbers(mismatchedLayerIds);
    const complete = missingScreenIds.length === 0
        && normalizedForeignScreenIds.length === 0
        && normalizedDuplicateScreenIds.length === 0
        && normalizedMissingLayerIds.length === 0
        && normalizedUnexpectedLayerIds.length === 0
        && normalizedMismatchedLayerIds.length === 0
        && fillPlans.every((plan) => !plan.readbackMissing && !plan.readbackUnexpected);

    return {
        version: 'detail-page-live-readback/v1',
        fillPlans,
        expectedScreenIds,
        observedScreenIds,
        missingScreenIds: uniqueNumbers(missingScreenIds),
        foreignScreenIds: normalizedForeignScreenIds,
        duplicateScreenIds: normalizedDuplicateScreenIds,
        missingLayerIds: normalizedMissingLayerIds,
        unexpectedLayerIds: normalizedUnexpectedLayerIds,
        mismatchedLayerIds: normalizedMismatchedLayerIds,
        complete
    };
}
