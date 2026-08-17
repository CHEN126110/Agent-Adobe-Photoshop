/**
 * 将详情页 Skill 的嵌套屏级截图投影为通用视觉观察记录 Bundle。
 *
 * 每个预期屏都必须占一个 item；没有像素的屏保留 captured=false，不能因数组中
 * 不存在而从验收分母消失。
 */

import {
    VISUAL_OBSERVATION_BUNDLE_VERSION,
    type VisualObservationBundle
} from './visual-observation-bundle';

interface DetailScreenSnapshotLike {
    screenId?: unknown;
    screenName?: unknown;
    base64?: unknown;
    imageData?: unknown;
    format?: unknown;
    mediaType?: unknown;
    documentId?: unknown;
    historyStateId?: unknown;
    historyStateRef?: {
        documentId?: unknown;
        historyStateId?: unknown;
    };
}

function readNestedValue(result: any, key: string): unknown {
    return result?.[key]
        ?? result?.data?.[key]
        ?? result?.result?.[key]
        ?? result?.output?.[key];
}

export function buildDetailPageVisualObservationBundle(input: {
    expectedScreenIds: readonly number[];
    snapshots: readonly DetailScreenSnapshotLike[];
    snapshotResult?: any;
}): VisualObservationBundle {
    const resultHistoryStateRef = readNestedValue(input.snapshotResult, 'historyStateRef') as any;
    const resultDocumentId = readNestedValue(input.snapshotResult, 'documentId')
        ?? resultHistoryStateRef?.documentId;
    const resultHistoryStateId = readNestedValue(input.snapshotResult, 'historyStateId')
        ?? resultHistoryStateRef?.historyStateId;
    const snapshotsByScreenId = new Map<number, Array<{
        snapshot: DetailScreenSnapshotLike;
        index: number;
    }>>();
    input.snapshots.forEach((snapshot, index) => {
        const screenId = Math.round(Number(snapshot?.screenId) || 0);
        if (screenId <= 0) return;
        const bucket = snapshotsByScreenId.get(screenId) || [];
        bucket.push({ snapshot, index });
        snapshotsByScreenId.set(screenId, bucket);
    });
    const expectedScreenIds = Array.from(new Set(input.expectedScreenIds
        .map((screenId) => Math.round(Number(screenId) || 0))
        .filter((screenId) => screenId > 0)));
    const items = expectedScreenIds.map((screenId) => {
        const bucket = snapshotsByScreenId.get(screenId) || [];
        const duplicated = bucket.length > 1;
        const matched = bucket.length === 1 ? bucket[0] : undefined;
        const snapshot = matched?.snapshot;
        const base64 = String(snapshot?.base64 || snapshot?.imageData || '');
        const documentId = snapshot?.documentId
            ?? snapshot?.historyStateRef?.documentId
            ?? resultDocumentId;
        const historyStateId = snapshot?.historyStateId
            ?? snapshot?.historyStateRef?.historyStateId
            ?? resultHistoryStateId;
        let resultPath = `data.screenSnapshots[missing:screen:${screenId}]`;
        if (matched) {
            resultPath = `data.screenSnapshots[${matched.index}]`;
        } else if (duplicated) {
            resultPath = `data.screenSnapshots[duplicate:screen:${screenId}]`;
        }
        return {
            identity: {
                outer: 'detail-page-design',
                resultPath,
                document: String(documentId || 'unknown'),
                history: String(historyStateId || 'unknown'),
                sourceKind: 'detail-screen',
                sourceId: `screen:${screenId}`
            },
            label: duplicated
                ? `第 ${screenId} 屏（重复截图，未采用）`
                : String(snapshot?.screenName || `第 ${screenId} 屏`),
            captured: base64.length > 0,
            ...(base64 ? {
                image: {
                    base64,
                    format: String(snapshot?.format || 'png'),
                    mediaType: String(snapshot?.mediaType || 'image/png')
                }
            } : {})
        };
    });
    return {
        version: VISUAL_OBSERVATION_BUNDLE_VERSION,
        expectedObservationCount: expectedScreenIds.length,
        expectedTargets: expectedScreenIds.map((screenId) => ({
            sourceKind: 'detail-screen',
            sourceId: `screen:${screenId}`
        })),
        items
    };
}
