export const SKU_POSE_ALIGNMENT_WORKFLOW_VERSION = 'sku-pose-alignment-workflow/v1' as const;
export const SKU_POSE_ALIGNMENT_APPLY_VERSION = 'sku-pose-alignment-apply/v1' as const;
export const SKU_POSE_ALIGNMENT_REPORT_VERSION = 'sku-pose-alignment-report/v1' as const;
export const SKU_POSE_ALIGNMENT_QUALITY_PROFILE = 'studio-upright-sock-geometry/v1' as const;
export const SKU_POSE_ALIGNMENT_PROVIDER_RECEIPT_VERSION = 'sku-pose-alignment-provider-receipt/v1' as const;

export interface SkuPoseAlignmentBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

export interface SkuPoseAlignmentWorkingPadding {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export interface ApplySkuPoseAlignmentParams {
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
    qualityReportVersion: typeof SKU_POSE_ALIGNMENT_REPORT_VERSION;
    qualityProfile: typeof SKU_POSE_ALIGNMENT_QUALITY_PROFILE;
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
    qualityReportVersion: typeof SKU_POSE_ALIGNMENT_REPORT_VERSION;
    qualityProfile: typeof SKU_POSE_ALIGNMENT_QUALITY_PROFILE;
    qualityFingerprint: string;
}
