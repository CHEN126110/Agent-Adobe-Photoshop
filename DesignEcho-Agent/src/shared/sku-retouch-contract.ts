/**
 * SKU 纯底素材统一尺度资产契约。
 *
 * 该契约只描述确定性文件处理的输入、产物与量化结果；不授予 Photoshop
 * 写入权限，也不把离线处理成功等同于色卡设计完成。
 *
 * 阶段边界（2026-08-25 用户拍板）：当前阶段只做「主体等比缩放到统一尺度」
 * ——不做形态变形（保留每只袜子的真实版型），也不生成阴影或光影修正资产。
 */

export const SKU_RETOUCH_ASSETS_VERSION = 'sku-retouch-assets/v2' as const;
export const SKU_RETOUCH_REPORT_VERSION = 'sku-retouch-report/v2' as const;

export type SkuRetouchSourceMode = 'auto' | 'studio' | 'scene';
export type SkuRetouchSourceClassification = 'studio' | 'scene' | 'uncertain';

export interface SkuRetouchSourceInput {
    sourceId?: string;
    filePath: string;
    colorName?: string;
}

export interface PrepareSkuRetouchAssetsInput {
    sources: SkuRetouchSourceInput[];
    projectPath?: string;
    outputDir?: string;
    referenceSourcePath?: string;
    sourceMode?: SkuRetouchSourceMode;
    /** @deprecated v2 不再消费；仅为旧调用形状保留读取兼容。 */
    shapeStrength?: number;
    /** @deprecated v2 不再消费；仅为旧调用形状保留读取兼容。 */
    lightingStrength?: number;
    /** 离线工作图长边；默认 2048，范围 1024~3072。 */
    maxLongEdge?: number;
    force?: boolean;
}

export interface SkuRetouchUniformScaleMetrics {
    originalSubjectWidth: number;
    originalSubjectHeight: number;
    outputSubjectWidth: number;
    outputSubjectHeight: number;
    targetSubjectHeight: number;
    scaleFactor: number;
    aspectRatioBefore: number;
    aspectRatioAfter: number;
    aspectRatioDelta: number;
    subjectHeightUniform: boolean;
    aspectRatioPreserved: boolean;
}

export interface SkuRetouchAlphaBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

/**
 * 低 alpha 柔边的确定性保全读回。
 *
 * sourceAlphaPixelCount / retainedAlphaPixelCount 比较的是缩放前清理蒙版中的非零 alpha，
 * 不把 Lanczos 重采样后的像素数量伪装成逐像素恒等；输出侧改用真实 alpha bounds 与四边
 * 安全距离证明没有贴边裁切。
 */
export interface SkuRetouchAlphaSafetyMetrics {
    sourceAlphaPixelCount: number;
    retainedAlphaPixelCount: number;
    outputAlphaPixelCount: number;
    outputAlphaBounds: SkuRetouchAlphaBounds;
    safeInsets: {
        top: number;
        right: number;
        bottom: number;
        left: number;
    };
    sourcePixelsPreserved: boolean;
    outputEdgesClear: boolean;
}

export interface SkuRetouchSourceCacheIdentity {
    sourceId: string;
    colorName?: string;
    sourcePath: string;
    sourceByteLength: number;
    sourceSha256: string;
}

export interface SkuRetouchCacheIdentity {
    batchId: string;
    sourceMode: SkuRetouchSourceMode;
    maxLongEdge: number;
    referenceSourcePath?: string;
    sources: SkuRetouchSourceCacheIdentity[];
}

export function buildSkuRetouchUniformScaleMetrics(input: {
    originalSubjectWidth: number;
    originalSubjectHeight: number;
    outputSubjectWidth: number;
    outputSubjectHeight: number;
    targetSubjectHeight: number;
}): SkuRetouchUniformScaleMetrics {
    const originalSubjectWidth = Math.max(1, Number(input.originalSubjectWidth));
    const originalSubjectHeight = Math.max(1, Number(input.originalSubjectHeight));
    const outputSubjectWidth = Math.max(1, Number(input.outputSubjectWidth));
    const outputSubjectHeight = Math.max(1, Number(input.outputSubjectHeight));
    const targetSubjectHeight = Math.max(1, Number(input.targetSubjectHeight));
    const aspectRatioBefore = originalSubjectWidth / originalSubjectHeight;
    const aspectRatioAfter = outputSubjectWidth / outputSubjectHeight;
    const aspectRatioDelta = Math.abs(aspectRatioAfter - aspectRatioBefore);
    const aspectRatioRelativeDelta = Math.abs(aspectRatioAfter / aspectRatioBefore - 1);
    const expectedOutputWidth = outputSubjectHeight * aspectRatioBefore;
    return {
        originalSubjectWidth,
        originalSubjectHeight,
        outputSubjectWidth,
        outputSubjectHeight,
        targetSubjectHeight,
        scaleFactor: outputSubjectHeight / originalSubjectHeight,
        aspectRatioBefore,
        aspectRatioAfter,
        aspectRatioDelta,
        subjectHeightUniform: Math.abs(outputSubjectHeight - targetSubjectHeight) <= 1,
        aspectRatioPreserved: aspectRatioRelativeDelta <= 0.01
            || Math.abs(outputSubjectWidth - expectedOutputWidth) <= 1
    };
}

export interface SkuRetouchPreparedSource {
    sourceId: string;
    colorName?: string;
    sourcePath: string;
    classification: SkuRetouchSourceClassification;
    studioConfidence: number;
    status: 'prepared' | 'skipped_scene' | 'failed';
    width?: number;
    height?: number;
    productPath?: string;
    previewPath?: string;
    /** 置入端用于把 Photoshop 写收据精确绑定到本次准备资产。 */
    productSha256?: string;
    /** UXP 对实际置入字节同步复算的快速校验和；SHA-256 仍是缓存完整性的权威摘要。 */
    productChecksum?: string;
    productByteLength?: number;
    previewSha256?: string;
    previewByteLength?: number;
    uniformScale?: SkuRetouchUniformScaleMetrics;
    alphaSafety?: SkuRetouchAlphaSafetyMetrics;
    warnings: string[];
    error?: string;
}

export interface SkuRetouchReport {
    version: typeof SKU_RETOUCH_REPORT_VERSION;
    assetVersion: typeof SKU_RETOUCH_ASSETS_VERSION;
    success: boolean;
    workflowStatus: 'prepared' | 'not_applicable' | 'failed';
    cacheHit: boolean;
    outputDir: string;
    reportPath: string;
    cacheIdentity: SkuRetouchCacheIdentity;
    referenceSourceId?: string;
    referenceSourcePath?: string;
    sourceMode: SkuRetouchSourceMode;
    maxLongEdge: number;
    sources: SkuRetouchPreparedSource[];
    checks: {
        sourceCoverage: 'passed' | 'failed' | 'not_applicable';
        commonCanvas: 'passed' | 'failed' | 'not_applicable';
        subjectHeightUniform: 'passed' | 'failed' | 'not_applicable';
        aspectRatioPreserved: 'passed' | 'failed' | 'not_applicable';
        alphaPixelsPreserved: 'passed' | 'failed' | 'not_applicable';
        alphaEdgesSafe: 'passed' | 'failed' | 'not_applicable';
        transparentAssetsReady: 'passed' | 'failed' | 'not_applicable';
    };
    warnings: string[];
    error?: string;
}

export function isPreparedSkuRetouchSource(
    value: SkuRetouchPreparedSource | undefined
): value is SkuRetouchPreparedSource & Required<Pick<
    SkuRetouchPreparedSource,
    'productPath' | 'previewPath' | 'productSha256' | 'productChecksum' | 'productByteLength' | 'previewSha256' | 'previewByteLength'
>> {
    return value?.status === 'prepared'
        && Boolean(value.productPath)
        && Boolean(value.previewPath)
        && /^[a-f0-9]{64}$/i.test(String(value.productSha256 || ''))
        && /^fnv1a32:[a-f0-9]{8}$/i.test(String(value.productChecksum || ''))
        && Number.isSafeInteger(value.productByteLength)
        && Number(value.productByteLength) > 0
        && /^[a-f0-9]{64}$/i.test(String(value.previewSha256 || ''))
        && Number.isSafeInteger(value.previewByteLength)
        && Number(value.previewByteLength) > 0;
}
