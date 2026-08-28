import {
    SKU_POSE_ALIGNMENT_APPLY_VERSION,
    SKU_POSE_ALIGNMENT_QUALITY_PROFILE,
    SKU_POSE_ALIGNMENT_REPORT_VERSION,
    type ApplySkuPoseAlignmentParams,
    type SkuPoseAlignmentBounds,
    type SkuPoseAlignmentWorkingPadding
} from './pose-alignment-contract';

export interface PoseAlignmentLayerState {
    layerId: number;
    parentId: number | null;
    layerName: string;
    visible: boolean;
    bounds: SkuPoseAlignmentBounds;
}

export interface PoseAlignmentStateVerification {
    verified: boolean;
    message: string;
}

function asPositiveInteger(value: unknown, fieldName: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error(`applySkuPoseAlignment ${fieldName} 必须是正整数。`);
    }
    return parsed;
}

function normalizeBounds(value: unknown, fieldName: string): SkuPoseAlignmentBounds {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`applySkuPoseAlignment ${fieldName} 无效。`);
    }
    const record = value as Record<string, unknown>;
    const left = Number(record.left);
    const top = Number(record.top);
    const right = Number(record.right);
    const bottom = Number(record.bottom);
    const width = Number(record.width);
    const height = Number(record.height);
    if (![left, top, right, bottom, width, height].every(Number.isFinite)
        || width <= 0 || height <= 0
        || Math.abs(right - left - width) > 1.1
        || Math.abs(bottom - top - height) > 1.1) {
        throw new Error(`applySkuPoseAlignment ${fieldName} 缺少一致的 left/top/right/bottom/width/height。`);
    }
    return { left, top, right, bottom, width, height };
}

function normalizePadding(value: unknown): SkuPoseAlignmentWorkingPadding {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('applySkuPoseAlignment workingPadding 无效。');
    }
    const record = value as Record<string, unknown>;
    const padding = {
        left: Number(record.left),
        top: Number(record.top),
        right: Number(record.right),
        bottom: Number(record.bottom)
    };
    if (!Object.values(padding).every(
        (entry) => Number.isSafeInteger(entry) && entry >= 0
    )) {
        throw new Error('applySkuPoseAlignment workingPadding 必须是非负整数像素。');
    }
    return padding;
}

export function normalizeApplySkuPoseAlignmentParams(
    params: ApplySkuPoseAlignmentParams
): ApplySkuPoseAlignmentParams {
    if (params?.version !== SKU_POSE_ALIGNMENT_APPLY_VERSION) {
        throw new Error(`applySkuPoseAlignment 只接受 ${SKU_POSE_ALIGNMENT_APPLY_VERSION}。`);
    }
    if (params.qualityReportVersion !== SKU_POSE_ALIGNMENT_REPORT_VERSION
        || params.qualityProfile !== SKU_POSE_ALIGNMENT_QUALITY_PROFILE) {
        throw new Error('applySkuPoseAlignment 的离线质量契约版本不匹配。');
    }
    const resultLayerName = String(params.resultLayerName || '').trim();
    if (!resultLayerName || resultLayerName.length > 160 || /[\x00-\x1f]/.test(resultLayerName)) {
        throw new Error('applySkuPoseAlignment resultLayerName 必须是 1~160 字符的可读图层名称。');
    }
    const qualityFingerprint = String(params.qualityFingerprint || '').trim();
    if (!/^fnv1a32:[a-f0-9]{8}$/i.test(qualityFingerprint)) {
        throw new Error('applySkuPoseAlignment qualityFingerprint 无效。');
    }
    const sourceImageSize = {
        width: asPositiveInteger(params.sourceImageSize?.width, 'sourceImageSize.width'),
        height: asPositiveInteger(params.sourceImageSize?.height, 'sourceImageSize.height')
    };
    const outputImageSize = {
        width: asPositiveInteger(params.outputImageSize?.width, 'outputImageSize.width'),
        height: asPositiveInteger(params.outputImageSize?.height, 'outputImageSize.height')
    };
    const workingPadding = normalizePadding(params.workingPadding);
    const sourceBounds = normalizeBounds(params.sourceBounds, 'sourceBounds');
    const outputBounds = normalizeBounds(params.outputBounds, 'outputBounds');
    if (outputImageSize.width !== sourceImageSize.width
            + workingPadding.left + workingPadding.right
        || outputImageSize.height !== sourceImageSize.height
            + workingPadding.top + workingPadding.bottom) {
        throw new Error('applySkuPoseAlignment 输出像素尺寸与工作画布留白不一致。');
    }
    const scaleX = sourceBounds.width / sourceImageSize.width;
    const scaleY = sourceBounds.height / sourceImageSize.height;
    const expectedOutputBounds = {
        left: sourceBounds.left - workingPadding.left * scaleX,
        top: sourceBounds.top - workingPadding.top * scaleY,
        right: sourceBounds.right + workingPadding.right * scaleX,
        bottom: sourceBounds.bottom + workingPadding.bottom * scaleY,
        width: outputImageSize.width * scaleX,
        height: outputImageSize.height * scaleY
    };
    if (!poseAlignmentBoundsMatch(outputBounds, expectedOutputBounds, 1.1)) {
        throw new Error('applySkuPoseAlignment outputBounds 与源图比例及安全留白不一致。');
    }
    return {
        ...params,
        layerId: asPositiveInteger(params.layerId, 'layerId'),
        resultLayerName,
        sourceBounds,
        outputBounds,
        sourceImageSize,
        outputImageSize,
        workingPadding,
        imageByteLength: asPositiveInteger(params.imageByteLength, 'imageByteLength'),
        imageChecksum: String(params.imageChecksum || '').trim(),
        qualityFingerprint
    };
}

export function readPoseAlignmentPngSize(bytes: Uint8Array): {
    width: number;
    height: number;
} {
    if (bytes.length < 24) throw new Error('姿态统一 PNG 文件头不完整。');
    const width = (
        bytes[16] * 0x1000000
        + bytes[17] * 0x10000
        + bytes[18] * 0x100
        + bytes[19]
    ) >>> 0;
    const height = (
        bytes[20] * 0x1000000
        + bytes[21] * 0x10000
        + bytes[22] * 0x100
        + bytes[23]
    ) >>> 0;
    if (width <= 0 || height <= 0) throw new Error('姿态统一 PNG 尺寸无效。');
    return { width, height };
}

export function poseAlignmentBoundsMatch(
    first: SkuPoseAlignmentBounds,
    second: SkuPoseAlignmentBounds,
    tolerance = 1.1
): boolean {
    return Math.abs(first.left - second.left) <= tolerance
        && Math.abs(first.top - second.top) <= tolerance
        && Math.abs(first.right - second.right) <= tolerance
        && Math.abs(first.bottom - second.bottom) <= tolerance
        && Math.abs(first.width - second.width) <= tolerance
        && Math.abs(first.height - second.height) <= tolerance;
}

function sameLayerIds(first: number[], second: number[]): boolean {
    if (first.length !== second.length) return false;
    const secondSet = new Set(second);
    return first.every((layerId) => secondSet.has(layerId));
}

export function verifyPoseAlignmentAppliedState(input: {
    beforeDocumentId: number;
    afterDocumentId: number;
    beforeLayerIds: number[];
    afterLayerIds: number[];
    sourceBefore: PoseAlignmentLayerState;
    sourceAfter?: PoseAlignmentLayerState;
    outputAfter?: PoseAlignmentLayerState;
    outputLayerId?: number;
    resultLayerName: string;
    outputBounds: SkuPoseAlignmentBounds;
}): PoseAlignmentStateVerification {
    const addedLayerIds = input.afterLayerIds.filter(
        (layerId) => !input.beforeLayerIds.includes(layerId)
    );
    const verified = input.afterDocumentId === input.beforeDocumentId
        && addedLayerIds.length === 1
        && addedLayerIds[0] === input.outputLayerId
        && input.sourceAfter?.layerId === input.sourceBefore.layerId
        && input.sourceAfter.visible === false
        && input.outputAfter?.layerId === input.outputLayerId
        && input.outputAfter.visible === true
        && input.outputAfter.layerName === input.resultLayerName
        && input.outputAfter.parentId === input.sourceBefore.parentId
        && poseAlignmentBoundsMatch(input.outputAfter.bounds, input.outputBounds);
    return {
        verified,
        message: `姿态统一写后读回不一致：新增=[${addedLayerIds.join(',')}], `
            + `sourceVisible=${String(input.sourceAfter?.visible)}, `
            + `output=${String(input.outputAfter?.layerId)}, `
            + `parent=${String(input.outputAfter?.parentId)}, `
            + `name=${input.outputAfter?.layerName || ''}。`
    };
}

export function verifyPoseAlignmentRolledBackState(input: {
    beforeDocumentId: number;
    afterDocumentId: number;
    beforeLayerIds: number[];
    afterLayerIds: number[];
    sourceBefore: PoseAlignmentLayerState;
    sourceAfter?: PoseAlignmentLayerState;
    outputAfter?: PoseAlignmentLayerState;
}): PoseAlignmentStateVerification {
    return {
        verified: input.afterDocumentId === input.beforeDocumentId
            && sameLayerIds(input.beforeLayerIds, input.afterLayerIds)
            && input.sourceAfter?.visible === input.sourceBefore.visible
            && !input.outputAfter,
        message: '姿态统一回滚后图层集合或源图层可见性未恢复。'
    };
}
