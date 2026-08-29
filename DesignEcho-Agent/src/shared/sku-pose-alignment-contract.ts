/**
 * SKU 纯底素材姿态统一的离线结果契约。
 *
 * 该契约只描述 SKU Skill 内部 Provider 的确定性几何处理和机械质量检查；
 * 不授予 Photoshop 写入权限，不代表审美通过，也不构成 SKU 或设计任务完成。
 */

export const SKU_POSE_ALIGNMENT_REPORT_VERSION = 'sku-pose-alignment-report/v1' as const;
export const SKU_POSE_ALIGNMENT_QUALITY_PROFILE = 'studio-upright-sock-geometry/v1' as const;

export type SkuPoseAlignmentStatus = 'applied' | 'not_needed' | 'rejected';
export type SkuPoseQualityCheck = 'passed' | 'failed' | 'not_applicable';

export type SkuPoseAlignmentReasonCode =
    | 'strength_zero'
    | 'pose_already_aligned'
    | 'invalid_options'
    | 'insufficient_subject'
    | 'unsupported_subject_geometry'
    | 'unstable_skeleton_fit'
    | 'excessive_skeleton_residual'
    | 'excessive_local_rotation'
    | 'insufficient_canvas_margin'
    | 'warp_foldover_risk'
    | 'foreground_retention_failed'
    | 'bend_reduction_failed'
    | 'cuff_stability_failed'
    | 'output_analysis_failed';

/**
 * strength 与 cuffLockRatio 是调用者显式作出的工艺选择；算法不从文件名、
 * 袜型或 UI 默认值推断它们。maxIterations 只是有界求解预算。
 */
export interface SkuPoseAlignmentOptions {
    strength: number;
    cuffLockRatio: number;
    maxIterations?: number;
}

export interface SkuPoseEdgeInsets {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

export interface SkuPoseAlignmentMetrics {
    sourceForegroundPixels: number;
    outputForegroundPixels: number;
    foregroundRetentionRatio: number;
    sourceBendRatio: number;
    outputBendRatio: number;
    bendReductionRatio: number;
    skeletonFitResidualRatio: number;
    skeletonCoverageRatio: number;
    maxLocalRotationDeg: number;
    minJacobianDeterminant: number;
    maxLocalScaleDeviation: number;
    cuffDriftRatio: number | null;
    outputEdgeInsets: SkuPoseEdgeInsets;
}

export interface SkuPoseAlignmentChecks {
    input: SkuPoseQualityCheck;
    applicability: SkuPoseQualityCheck;
    canvasSafety: SkuPoseQualityCheck;
    noFoldover: SkuPoseQualityCheck;
    foregroundRetention: SkuPoseQualityCheck;
    bendReduction: SkuPoseQualityCheck;
    cuffStability: SkuPoseQualityCheck;
}

export interface SkuPoseAlignmentReport {
    version: typeof SKU_POSE_ALIGNMENT_REPORT_VERSION;
    qualityProfile: typeof SKU_POSE_ALIGNMENT_QUALITY_PROFILE;
    sourceSize: {
        width: number;
        height: number;
    };
    /** 参数通过校验后记录规范化值；invalid_options 时不提供。 */
    options?: Required<SkuPoseAlignmentOptions>;
    status: SkuPoseAlignmentStatus;
    applied: boolean;
    iterations: number;
    reasonCode?: SkuPoseAlignmentReasonCode;
    reason?: string;
    metrics: SkuPoseAlignmentMetrics;
    checks: SkuPoseAlignmentChecks;
}
