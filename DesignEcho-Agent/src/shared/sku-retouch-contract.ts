/**
 * SKU 纯底素材精修资产契约。
 *
 * 该契约只描述确定性文件处理的输入、产物与量化结果；不授予 Photoshop
 * 写入权限，也不把离线处理成功等同于色卡设计完成。
 */

export const SKU_RETOUCH_ASSETS_VERSION = 'sku-retouch-assets/v1' as const;
export const SKU_RETOUCH_REPORT_VERSION = 'sku-retouch-report/v1' as const;

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
    /** 0~1；默认 0.72。保留款式差异，避免把织物硬拉成完全同形。 */
    shapeStrength?: number;
    /** 0~1；默认 0.68。只统一低频受光，不统一商品固有明度。 */
    lightingStrength?: number;
    /** 离线工作图长边；默认 2048，范围 1024~3072。 */
    maxLongEdge?: number;
    force?: boolean;
}

export interface SkuRetouchShapeMetrics {
    distanceToReferenceBefore: number;
    distanceToReferenceAfter: number;
    maxDisplacementPx: number;
    subjectWidthRatio: number;
    subjectHeightRatio: number;
}

export interface SkuRetouchLightingMetrics {
    residualBefore: number;
    residualAfter: number;
    correctionMin: number;
    correctionMax: number;
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
    shadowPath?: string;
    neutralGrayPath?: string;
    previewPath?: string;
    shape?: SkuRetouchShapeMetrics;
    lighting?: SkuRetouchLightingMetrics;
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
    referenceSourceId?: string;
    referenceSourcePath?: string;
    sourceMode: SkuRetouchSourceMode;
    shapeStrength: number;
    lightingStrength: number;
    maxLongEdge: number;
    sources: SkuRetouchPreparedSource[];
    checks: {
        sourceCoverage: 'passed' | 'failed' | 'not_applicable';
        commonGeometry: 'passed' | 'failed' | 'not_applicable';
        shapeResidualReduced: 'passed' | 'needs_review' | 'failed' | 'not_applicable';
        lightingResidualReduced: 'passed' | 'needs_review' | 'failed' | 'not_applicable';
        editableAssetLayersReady: 'passed' | 'failed' | 'not_applicable';
    };
    warnings: string[];
    error?: string;
}

export function isPreparedSkuRetouchSource(
    value: SkuRetouchPreparedSource | undefined
): value is SkuRetouchPreparedSource & Required<Pick<
    SkuRetouchPreparedSource,
    'productPath' | 'shadowPath' | 'neutralGrayPath' | 'previewPath'
>> {
    return value?.status === 'prepared'
        && Boolean(value.productPath)
        && Boolean(value.shadowPath)
        && Boolean(value.neutralGrayPath)
        && Boolean(value.previewPath);
}
