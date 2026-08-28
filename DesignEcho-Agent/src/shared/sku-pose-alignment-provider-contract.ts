import type {
    SkuPoseAlignmentOptions,
    SkuPoseAlignmentReport
} from './sku-pose-alignment-contract';
import type { LayerPixelCaptureBounds } from './layer-pixel-capture-contract';

export const SKU_POSE_ALIGNMENT_WORKFLOW_VERSION = 'sku-pose-alignment-workflow/v1' as const;
export const SKU_POSE_ALIGNMENT_APPLY_VERSION = 'sku-pose-alignment-apply/v1' as const;
export const SKU_POSE_ALIGNMENT_PROVIDER_RECEIPT_VERSION = 'sku-pose-alignment-provider-receipt/v1' as const;

export type SkuPoseAlignmentBounds = LayerPixelCaptureBounds;

export interface SkuPoseAlignmentWorkingPadding {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export interface SkuPoseAlignmentWorkflowRequest {
    version: typeof SKU_POSE_ALIGNMENT_WORKFLOW_VERSION;
    expectedDocumentId: number;
    expectedHistoryStateId: number;
    layerId: number;
    resultLayerName: string;
    options: SkuPoseAlignmentOptions;
    requestKey?: string;
    abortSignal?: AbortSignal;
}

export interface SkuPoseAlignmentApplyRequest {
    version: typeof SKU_POSE_ALIGNMENT_APPLY_VERSION;
    layerId: number;
    resultLayerName: string;
    sourceBounds: SkuPoseAlignmentBounds;
    outputBounds: SkuPoseAlignmentBounds;
    sourceImageSize: {
        width: number;
        height: number;
    };
    outputImageSize: {
        width: number;
        height: number;
    };
    workingPadding: SkuPoseAlignmentWorkingPadding;
    imageBase64: string;
    imageByteLength: number;
    imageChecksum: string;
    qualityReportVersion: SkuPoseAlignmentReport['version'];
    qualityProfile: SkuPoseAlignmentReport['qualityProfile'];
    qualityFingerprint: string;
}

export interface SkuPoseAlignmentProviderReceipt {
    version: typeof SKU_POSE_ALIGNMENT_PROVIDER_RECEIPT_VERSION;
    documentId: number;
    sourceLayerId: number;
    outputLayerId: number;
    sourcePreserved: true;
    sourceVisibleAfter: false;
    outputVisible: true;
    sourceBounds: SkuPoseAlignmentBounds;
    outputBounds: SkuPoseAlignmentBounds;
    geometryVerified: true;
    sourceImageIdentityVerified: true;
    qualityReportVersion: SkuPoseAlignmentReport['version'];
    qualityProfile: SkuPoseAlignmentReport['qualityProfile'];
    qualityFingerprint: string;
}
