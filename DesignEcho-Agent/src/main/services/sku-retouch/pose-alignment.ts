import {
    SKU_POSE_ALIGNMENT_QUALITY_PROFILE,
    SKU_POSE_ALIGNMENT_REPORT_VERSION,
    type SkuPoseAlignmentChecks,
    type SkuPoseAlignmentMetrics,
    type SkuPoseAlignmentOptions,
    type SkuPoseAlignmentReasonCode,
    type SkuPoseAlignmentReport,
    type SkuPoseAlignmentStatus
} from '../../../shared/sku-pose-alignment-contract';
import {
    analyzeSkuRetouchShape,
    type SkuRetouchRaster,
    type SkuRetouchShapeAnalysis
} from './geometry';
import {
    fitSkuPoseSkeleton,
    measureSkuPoseCuffDrift,
    measureSkuPoseMask,
    skuPoseInsetsMeetMinimum,
    type SkuPoseMaskMeasurement,
    type SkuPoseSkeletonFit
} from './pose-skeleton';
import {
    createSkuPoseWarpMap,
    measureSkuPoseWarpSafety,
    transformSkuPoseMask,
    transformSkuPoseRaster,
    type SkuPoseWarpMap
} from './pose-warp';

export interface SkuPoseAlignmentInput {
    raster: SkuRetouchRaster;
    mask: Buffer;
    options: SkuPoseAlignmentOptions;
}

export interface SkuPoseAlignmentOutcome {
    raster: SkuRetouchRaster;
    mask: Buffer;
    report: SkuPoseAlignmentReport;
}

interface QualityLimits {
    minimumSubjectAspectRatio: number;
    minimumSkeletonCoverageRatio: number;
    maximumSkeletonResidualRatio: number;
    maximumLocalRotationDeg: number;
    minimumActionableBendRatio: number;
    minimumSourceEdgeInsetPx: number;
    minimumOutputEdgeInsetPx: number;
    minimumJacobianDeterminant: number;
    maximumLocalScaleDeviation: number;
    minimumForegroundRetentionRatio: number;
    maximumForegroundRetentionRatio: number;
    minimumBendReductionAtFullStrength: number;
    maximumCuffDriftRatio: number;
}

interface StopDecision {
    status: Exclude<SkuPoseAlignmentStatus, 'applied'>;
    iterations: number;
    metrics: SkuPoseAlignmentMetrics;
    checks: SkuPoseAlignmentChecks;
    reasonCode: SkuPoseAlignmentReasonCode;
    reason: string;
    options?: Required<SkuPoseAlignmentOptions>;
}

const QUALITY_LIMITS: QualityLimits = {
    minimumSubjectAspectRatio: 1.2,
    minimumSkeletonCoverageRatio: 0.5,
    maximumSkeletonResidualRatio: 0.055,
    maximumLocalRotationDeg: 28,
    minimumActionableBendRatio: 0.025,
    minimumSourceEdgeInsetPx: 2,
    minimumOutputEdgeInsetPx: 1,
    minimumJacobianDeterminant: 0.18,
    maximumLocalScaleDeviation: 0.85,
    minimumForegroundRetentionRatio: 0.92,
    maximumForegroundRetentionRatio: 1.08,
    minimumBendReductionAtFullStrength: 0.55,
    maximumCuffDriftRatio: 0.06
};

const DEFAULT_MAX_ITERATIONS = 3;
const MASK_MEASUREMENT_THRESHOLD = 104;

function baseChecks(): SkuPoseAlignmentChecks {
    return {
        input: 'passed',
        applicability: 'not_applicable',
        canvasSafety: 'not_applicable',
        noFoldover: 'not_applicable',
        foregroundRetention: 'not_applicable',
        bendReduction: 'not_applicable',
        cuffStability: 'not_applicable'
    };
}

function emptyMetrics(mask: SkuPoseMaskMeasurement): SkuPoseAlignmentMetrics {
    return {
        sourceForegroundPixels: mask.pixels,
        outputForegroundPixels: mask.pixels,
        foregroundRetentionRatio: mask.pixels > 0 ? 1 : 0,
        sourceBendRatio: 0,
        outputBendRatio: 0,
        bendReductionRatio: 0,
        skeletonFitResidualRatio: 0,
        skeletonCoverageRatio: 0,
        maxLocalRotationDeg: 0,
        minJacobianDeterminant: 1,
        maxLocalScaleDeviation: 0,
        cuffDriftRatio: null,
        outputEdgeInsets: mask.insets
    };
}

function populateSourceMetrics(
    metrics: SkuPoseAlignmentMetrics,
    fit: SkuPoseSkeletonFit
): void {
    metrics.sourceBendRatio = fit.bendRatio;
    metrics.outputBendRatio = fit.bendRatio;
    metrics.skeletonFitResidualRatio = fit.residualRatio;
    metrics.skeletonCoverageRatio = fit.coverageRatio;
    metrics.maxLocalRotationDeg = fit.maxRotationDeg;
}

function buildReport(input: {
    width: number;
    height: number;
    status: SkuPoseAlignmentStatus;
    iterations: number;
    metrics: SkuPoseAlignmentMetrics;
    checks: SkuPoseAlignmentChecks;
    options?: Required<SkuPoseAlignmentOptions>;
    reasonCode?: SkuPoseAlignmentReasonCode;
    reason?: string;
}): SkuPoseAlignmentReport {
    return {
        version: SKU_POSE_ALIGNMENT_REPORT_VERSION,
        qualityProfile: SKU_POSE_ALIGNMENT_QUALITY_PROFILE,
        sourceSize: { width: input.width, height: input.height },
        options: input.options,
        status: input.status,
        applied: input.status === 'applied',
        iterations: input.iterations,
        reasonCode: input.reasonCode,
        reason: input.reason,
        metrics: input.metrics,
        checks: input.checks
    };
}

function stopWithoutCandidate(
    input: SkuPoseAlignmentInput,
    decision: StopDecision
): SkuPoseAlignmentOutcome {
    return {
        raster: input.raster,
        mask: input.mask,
        report: buildReport({
            width: input.raster.width,
            height: input.raster.height,
            ...decision
        })
    };
}

function validateRasterAndMask(input: SkuPoseAlignmentInput): void {
    const { raster, mask } = input;
    if (!Number.isSafeInteger(raster.width) || !Number.isSafeInteger(raster.height)
        || raster.width < 1 || raster.height < 1 || raster.channels !== 3) {
        throw new Error('姿态统一输入必须是具有正整数尺寸的 RGB 栅格。');
    }
    if (raster.data.length !== raster.width * raster.height * 3) {
        throw new Error(`姿态统一 RGB 像素尺寸不一致：期望 ${raster.width * raster.height * 3}，实际 ${raster.data.length}。`);
    }
    if (mask.length !== raster.width * raster.height) {
        throw new Error(`姿态统一蒙版尺寸不一致：期望 ${raster.width * raster.height}，实际 ${mask.length}。`);
    }
}

function resolveOptions(options: SkuPoseAlignmentOptions): Required<SkuPoseAlignmentOptions> | null {
    const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    if (!Number.isFinite(options.strength) || options.strength < 0 || options.strength > 1
        || !Number.isFinite(options.cuffLockRatio) || options.cuffLockRatio < 0 || options.cuffLockRatio > 0.4
        || !Number.isSafeInteger(maxIterations) || maxIterations < 1 || maxIterations > 4) {
        return null;
    }
    return {
        strength: options.strength,
        cuffLockRatio: options.cuffLockRatio,
        maxIterations
    };
}

function analyzeShape(mask: Buffer, width: number, height: number): {
    shape?: SkuRetouchShapeAnalysis;
    error?: string;
} {
    try {
        return { shape: analyzeSkuRetouchShape(mask, width, height, MASK_MEASUREMENT_THRESHOLD) };
    } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
    }
}

function rejectForApplicability(input: {
    operation: SkuPoseAlignmentInput;
    options: Required<SkuPoseAlignmentOptions>;
    metrics: SkuPoseAlignmentMetrics;
    checks: SkuPoseAlignmentChecks;
    reasonCode: SkuPoseAlignmentReasonCode;
    reason: string;
}): SkuPoseAlignmentOutcome {
    input.checks.applicability = 'failed';
    return stopWithoutCandidate(input.operation, {
        status: 'rejected',
        iterations: 0,
        metrics: input.metrics,
        checks: input.checks,
        options: input.options,
        reasonCode: input.reasonCode,
        reason: input.reason
    });
}

function rejectWarpCandidate(input: {
    operation: SkuPoseAlignmentInput;
    options: Required<SkuPoseAlignmentOptions>;
    iterations: number;
    metrics: SkuPoseAlignmentMetrics;
    checks: SkuPoseAlignmentChecks;
    reasonCode: SkuPoseAlignmentReasonCode;
    reason: string;
}): SkuPoseAlignmentOutcome {
    return stopWithoutCandidate(input.operation, {
        status: 'rejected',
        iterations: input.iterations,
        metrics: input.metrics,
        checks: input.checks,
        options: input.options,
        reasonCode: input.reasonCode,
        reason: input.reason
    });
}

/**
 * 对纯底、近似竖直的单只袜子做确定性姿态拉直。
 *
 * 函数没有文件、网络、Photoshop 或全局状态副作用。任何机械质量检查失败时，
 * 返回原始像素与 rejected 收据，调用方不得把候选结果继续写入 Photoshop。
 */
export function alignSkuRetouchPose(input: SkuPoseAlignmentInput): SkuPoseAlignmentOutcome {
    validateRasterAndMask(input);
    const { width, height } = input.raster;
    const sourceMeasurement = measureSkuPoseMask(input.mask, width, height);
    const checks = baseChecks();
    const metrics = emptyMetrics(sourceMeasurement);
    const options = resolveOptions(input.options);
    if (!options) {
        checks.input = 'failed';
        return stopWithoutCandidate(input, {
            status: 'rejected',
            iterations: 0,
            metrics,
            checks,
            reasonCode: 'invalid_options',
            reason: '姿态统一参数无效：strength 必须为 0~1，cuffLockRatio 必须为 0~0.4，maxIterations 必须为 1~4 的整数。'
        });
    }
    if (options.strength === 0) {
        return stopWithoutCandidate(input, {
            status: 'not_needed',
            iterations: 0,
            metrics,
            checks,
            options,
            reasonCode: 'strength_zero',
            reason: '调用者显式选择了 0 强度，未执行姿态统一。'
        });
    }

    const sourceAnalysis = analyzeShape(input.mask, width, height);
    if (!sourceAnalysis.shape) {
        return rejectForApplicability({
            operation: input,
            options,
            metrics,
            checks,
            reasonCode: 'insufficient_subject',
            reason: `主体蒙版不能建立稳定轮廓：${sourceAnalysis.error || '未知原因'}`
        });
    }
    const sourceShape = sourceAnalysis.shape;
    const sourceFit = fitSkuPoseSkeleton(sourceShape, width);
    if (!sourceFit) {
        return rejectForApplicability({
            operation: input,
            options,
            metrics,
            checks,
            reasonCode: 'unstable_skeleton_fit',
            reason: '有效中心线样本不足或拟合退化，未生成姿态候选。'
        });
    }
    populateSourceMetrics(metrics, sourceFit);

    const subjectAspectRatio = sourceShape.bounds.height / Math.max(1, sourceShape.bounds.width);
    if (subjectAspectRatio < QUALITY_LIMITS.minimumSubjectAspectRatio) {
        return rejectForApplicability({
            operation: input,
            options,
            metrics,
            checks,
            reasonCode: 'unsupported_subject_geometry',
            reason: `主体高宽比 ${subjectAspectRatio.toFixed(2)} 低于当前竖直纯底袜适用下限 ${QUALITY_LIMITS.minimumSubjectAspectRatio.toFixed(2)}。`
        });
    }
    if (sourceFit.coverageRatio < QUALITY_LIMITS.minimumSkeletonCoverageRatio) {
        return rejectForApplicability({
            operation: input,
            options,
            metrics,
            checks,
            reasonCode: 'unstable_skeleton_fit',
            reason: `中心线有效覆盖率 ${(sourceFit.coverageRatio * 100).toFixed(1)}% 低于适用下限 ${(QUALITY_LIMITS.minimumSkeletonCoverageRatio * 100).toFixed(0)}%。`
        });
    }
    if (sourceFit.residualRatio > QUALITY_LIMITS.maximumSkeletonResidualRatio) {
        return rejectForApplicability({
            operation: input,
            options,
            metrics,
            checks,
            reasonCode: 'excessive_skeleton_residual',
            reason: `中心线拟合残差 ${(sourceFit.residualRatio * 100).toFixed(1)}% 超出适用上限 ${(QUALITY_LIMITS.maximumSkeletonResidualRatio * 100).toFixed(1)}%。`
        });
    }
    if (sourceFit.maxRotationDeg > QUALITY_LIMITS.maximumLocalRotationDeg) {
        return rejectForApplicability({
            operation: input,
            options,
            metrics,
            checks,
            reasonCode: 'excessive_local_rotation',
            reason: `局部旋转 ${sourceFit.maxRotationDeg.toFixed(1)}° 超出安全上限 ${QUALITY_LIMITS.maximumLocalRotationDeg}°。`
        });
    }
    checks.applicability = 'passed';
    if (!skuPoseInsetsMeetMinimum(sourceMeasurement.insets, QUALITY_LIMITS.minimumSourceEdgeInsetPx)) {
        checks.canvasSafety = 'failed';
        return stopWithoutCandidate(input, {
            status: 'rejected',
            iterations: 0,
            metrics,
            checks,
            options,
            reasonCode: 'insufficient_canvas_margin',
            reason: '主体已接触或过度靠近输入画布边缘，当前同画布变形不能保证不裁切。'
        });
    }
    checks.canvasSafety = 'passed';
    if (sourceFit.bendRatio < QUALITY_LIMITS.minimumActionableBendRatio) {
        return stopWithoutCandidate(input, {
            status: 'not_needed',
            iterations: 0,
            metrics,
            checks,
            options,
            reasonCode: 'pose_already_aligned',
            reason: `当前中心线弯曲率 ${(sourceFit.bendRatio * 100).toFixed(1)}% 低于动作阈值 ${(QUALITY_LIMITS.minimumActionableBendRatio * 100).toFixed(1)}%。`
        });
    }

    const maps: SkuPoseWarpMap[] = [];
    let analysisShape = sourceShape;
    let analysisFit = sourceFit;
    for (let iteration = 0; iteration < options.maxIterations; iteration += 1) {
        if (analysisFit.bendRatio < QUALITY_LIMITS.minimumActionableBendRatio) break;
        maps.push(createSkuPoseWarpMap({
            fit: analysisFit,
            shape: analysisShape,
            width,
            height
        }));
        const safety = measureSkuPoseWarpSafety({
            shape: sourceShape,
            width,
            height,
            maps,
            options,
            maximumRotationDeg: QUALITY_LIMITS.maximumLocalRotationDeg
        });
        metrics.minJacobianDeterminant = safety.minJacobianDeterminant;
        metrics.maxLocalScaleDeviation = safety.maxLocalScaleDeviation;
        if (safety.minJacobianDeterminant < QUALITY_LIMITS.minimumJacobianDeterminant
            || safety.maxLocalScaleDeviation > QUALITY_LIMITS.maximumLocalScaleDeviation) {
            checks.noFoldover = 'failed';
            return rejectWarpCandidate({
                operation: input,
                options,
                iterations: maps.length,
                metrics,
                checks,
                reasonCode: 'warp_foldover_risk',
                reason: `候选变形的最小 Jacobian 为 ${safety.minJacobianDeterminant.toFixed(3)}，最大局部尺度偏差为 ${(safety.maxLocalScaleDeviation * 100).toFixed(1)}%，已拒绝写出。`
            });
        }
        const analysisMask = transformSkuPoseMask({
            source: input.mask,
            width,
            height,
            maps,
            options,
            maximumRotationDeg: QUALITY_LIMITS.maximumLocalRotationDeg
        });
        const nextAnalysis = analyzeShape(analysisMask, width, height);
        if (!nextAnalysis.shape) {
            checks.noFoldover = 'failed';
            return rejectWarpCandidate({
                operation: input,
                options,
                iterations: maps.length,
                metrics,
                checks,
                reasonCode: 'output_analysis_failed',
                reason: `候选蒙版无法重建主体轮廓：${nextAnalysis.error || '未知原因'}`
            });
        }
        analysisShape = nextAnalysis.shape;
        const nextFit = fitSkuPoseSkeleton(analysisShape, width);
        if (!nextFit) {
            checks.noFoldover = 'failed';
            return rejectWarpCandidate({
                operation: input,
                options,
                iterations: maps.length,
                metrics,
                checks,
                reasonCode: 'output_analysis_failed',
                reason: '候选蒙版的中心线拟合不稳定，已拒绝写出。'
            });
        }
        analysisFit = nextFit;
    }
    checks.noFoldover = 'passed';

    const candidate = transformSkuPoseRaster({
        raster: input.raster,
        mask: input.mask,
        maps,
        options,
        maximumRotationDeg: QUALITY_LIMITS.maximumLocalRotationDeg
    });
    const outputAnalysis = analyzeShape(candidate.mask, width, height);
    const outputFit = outputAnalysis.shape
        ? fitSkuPoseSkeleton(outputAnalysis.shape, width)
        : null;
    if (!outputAnalysis.shape || !outputFit) {
        checks.foregroundRetention = 'failed';
        return rejectWarpCandidate({
            operation: input,
            options,
            iterations: maps.length,
            metrics,
            checks,
            reasonCode: 'output_analysis_failed',
            reason: `最终候选不能稳定重建主体与中心线：${outputAnalysis.error || '拟合失败'}`
        });
    }

    const outputMeasurement = measureSkuPoseMask(candidate.mask, width, height);
    metrics.outputForegroundPixels = outputMeasurement.pixels;
    metrics.foregroundRetentionRatio = outputMeasurement.pixels / Math.max(1, sourceMeasurement.pixels);
    metrics.outputBendRatio = outputFit.bendRatio;
    metrics.bendReductionRatio = 1 - outputFit.bendRatio / Math.max(1e-6, sourceFit.bendRatio);
    metrics.cuffDriftRatio = measureSkuPoseCuffDrift(
        sourceShape,
        outputAnalysis.shape,
        options.cuffLockRatio
    );
    metrics.outputEdgeInsets = outputMeasurement.insets;

    if (!skuPoseInsetsMeetMinimum(outputMeasurement.insets, QUALITY_LIMITS.minimumOutputEdgeInsetPx)) {
        checks.canvasSafety = 'failed';
        return rejectWarpCandidate({
            operation: input,
            options,
            iterations: maps.length,
            metrics,
            checks,
            reasonCode: 'insufficient_canvas_margin',
            reason: '候选主体触及输出画布边缘，已拒绝可能发生裁切的结果。'
        });
    }
    const retentionPassed = metrics.foregroundRetentionRatio >= QUALITY_LIMITS.minimumForegroundRetentionRatio
        && metrics.foregroundRetentionRatio <= QUALITY_LIMITS.maximumForegroundRetentionRatio;
    checks.foregroundRetention = retentionPassed ? 'passed' : 'failed';
    if (!retentionPassed) {
        return rejectWarpCandidate({
            operation: input,
            options,
            iterations: maps.length,
            metrics,
            checks,
            reasonCode: 'foreground_retention_failed',
            reason: `候选主体面积保留率 ${(metrics.foregroundRetentionRatio * 100).toFixed(1)}% 超出 ${(QUALITY_LIMITS.minimumForegroundRetentionRatio * 100).toFixed(0)}%~${(QUALITY_LIMITS.maximumForegroundRetentionRatio * 100).toFixed(0)}% 安全范围。`
        });
    }
    const minimumBendReduction = QUALITY_LIMITS.minimumBendReductionAtFullStrength * options.strength;
    const bendReductionPassed = metrics.bendReductionRatio >= minimumBendReduction;
    checks.bendReduction = bendReductionPassed ? 'passed' : 'failed';
    if (!bendReductionPassed) {
        return rejectWarpCandidate({
            operation: input,
            options,
            iterations: maps.length,
            metrics,
            checks,
            reasonCode: 'bend_reduction_failed',
            reason: `中心线弯曲只降低 ${(metrics.bendReductionRatio * 100).toFixed(1)}%，低于当前强度要求的 ${(minimumBendReduction * 100).toFixed(1)}%。`
        });
    }
    if (metrics.cuffDriftRatio === null) {
        checks.cuffStability = 'not_applicable';
    } else {
        checks.cuffStability = metrics.cuffDriftRatio <= QUALITY_LIMITS.maximumCuffDriftRatio
            ? 'passed'
            : 'failed';
    }
    if (checks.cuffStability === 'failed') {
        return rejectWarpCandidate({
            operation: input,
            options,
            iterations: maps.length,
            metrics,
            checks,
            reasonCode: 'cuff_stability_failed',
            reason: `锁定袜口区漂移 ${(metrics.cuffDriftRatio! * 100).toFixed(1)}% 超出 ${(QUALITY_LIMITS.maximumCuffDriftRatio * 100).toFixed(0)}% 上限。`
        });
    }

    return {
        ...candidate,
        report: buildReport({
            width,
            height,
            status: 'applied',
            iterations: maps.length,
            metrics,
            checks,
            options
        })
    };
}
