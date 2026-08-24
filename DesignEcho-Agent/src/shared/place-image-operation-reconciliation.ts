import {
    diffAcceptanceSnapshots,
    type AcceptanceLayer,
    type AcceptanceSnapshot
} from './acceptance/photoshop-acceptance';
import {
    readPhotoshopHistoryStateRef,
    samePhotoshopHistoryStateRef,
    type PhotoshopHistoryStateRef
} from './photoshop-history-state-ref';

export const PLACE_IMAGE_OPERATION_RECONCILIATION_VERSION =
    'place-image-operation-reconciliation/v1' as const;

export type PlaceImageOperationReconciliationClassification =
    | 'applied'
    | 'not_applied'
    | 'ambiguous';

export interface PlaceImageOperationReconciliationResult {
    version: typeof PLACE_IMAGE_OPERATION_RECONCILIATION_VERSION;
    classification: PlaceImageOperationReconciliationClassification;
    reasonCode: string;
    expectedHistoryStateRef?: PhotoshopHistoryStateRef;
    observedHistoryStateRef?: PhotoshopHistoryStateRef;
    layer?: AcceptanceLayer;
    addedLayerIds: number[];
}

function isCompleteSnapshot(snapshot: AcceptanceSnapshot | undefined): snapshot is AcceptanceSnapshot {
    if (!snapshot
        || snapshot.success !== true
        || snapshot.hasDocument !== true
        || !Array.isArray(snapshot.layers)
        || snapshot.summary?.truncated === true
        || !readPhotoshopHistoryStateRef(snapshot)) {
        return false;
    }
    const warnings = Array.isArray(snapshot.warnings) ? snapshot.warnings : [];
    return !warnings.some((warning) => /截断|跳过失效图层/.test(String(warning)));
}

function isImageLayer(layer: AcceptanceLayer): boolean {
    const kind = String(layer.kind || '').replace(/[^a-z]/gi, '').toLowerCase();
    return kind.includes('smartobject')
        || kind.includes('pixel')
        || kind.includes('raster')
        || kind.includes('image');
}

function result(
    classification: PlaceImageOperationReconciliationClassification,
    reasonCode: string,
    addedLayerIds: number[],
    expectedHistoryStateRef?: PhotoshopHistoryStateRef,
    observedHistoryStateRef?: PhotoshopHistoryStateRef,
    layer?: AcceptanceLayer
): PlaceImageOperationReconciliationResult {
    return {
        version: PLACE_IMAGE_OPERATION_RECONCILIATION_VERSION,
        classification,
        reasonCode,
        addedLayerIds,
        ...(expectedHistoryStateRef ? { expectedHistoryStateRef } : {}),
        ...(observedHistoryStateRef ? { observedHistoryStateRef } : {}),
        ...(layer ? { layer } : {})
    };
}

/**
 * 对已经派发但传输结果未知的 placeImage 做纯读回结算。
 *
 * 只有同一文档、完整 before/after 图层快照、明确 revision 变化且恰好新增一个
 * 图片图层时才判定已应用。该函数不重放写入，避免断线后重复置入同一素材。
 */
export function classifyPlaceImageOperationReconciliation(input: {
    before: AcceptanceSnapshot | undefined;
    after: AcceptanceSnapshot | undefined;
}): PlaceImageOperationReconciliationResult {
    const beforeHistoryStateRef = readPhotoshopHistoryStateRef(input.before);
    const afterHistoryStateRef = readPhotoshopHistoryStateRef(input.after);
    if (!isCompleteSnapshot(input.before) || !isCompleteSnapshot(input.after)) {
        return result(
            'ambiguous',
            'complete_acceptance_snapshot_unavailable',
            [],
            beforeHistoryStateRef,
            afterHistoryStateRef
        );
    }
    if (!beforeHistoryStateRef
        || !afterHistoryStateRef
        || beforeHistoryStateRef.documentId !== afterHistoryStateRef.documentId) {
        return result(
            'ambiguous',
            'document_mismatch',
            [],
            beforeHistoryStateRef,
            afterHistoryStateRef
        );
    }

    const diff = diffAcceptanceSnapshots(input.before, input.after);
    if (!diff.comparable) {
        return result(
            'ambiguous',
            'acceptance_snapshots_not_comparable',
            diff.addedLayerIds,
            beforeHistoryStateRef,
            afterHistoryStateRef
        );
    }

    const revisionUnchanged = samePhotoshopHistoryStateRef(
        beforeHistoryStateRef,
        afterHistoryStateRef
    );
    if (revisionUnchanged
        && diff.addedLayerIds.length === 0
        && diff.removedLayerIds.length === 0
        && diff.changedLayers.length === 0) {
        return result(
            'not_applied',
            'revision_and_layer_structure_unchanged',
            [],
            beforeHistoryStateRef,
            afterHistoryStateRef
        );
    }

    if (revisionUnchanged
        || diff.addedLayerIds.length !== 1
        || diff.removedLayerIds.length !== 0) {
        return result(
            'ambiguous',
            'revision_or_added_layer_count_ambiguous',
            diff.addedLayerIds,
            beforeHistoryStateRef,
            afterHistoryStateRef
        );
    }

    const addedLayerId = diff.addedLayerIds[0];
    const layer = input.after.layers?.find((candidate) => candidate.id === addedLayerId);
    if (!layer || !isImageLayer(layer)) {
        return result(
            'ambiguous',
            'single_added_layer_is_not_an_image',
            diff.addedLayerIds,
            beforeHistoryStateRef,
            afterHistoryStateRef
        );
    }

    return result(
        'applied',
        'single_image_layer_added_after_revision_change',
        diff.addedLayerIds,
        beforeHistoryStateRef,
        afterHistoryStateRef,
        layer
    );
}
