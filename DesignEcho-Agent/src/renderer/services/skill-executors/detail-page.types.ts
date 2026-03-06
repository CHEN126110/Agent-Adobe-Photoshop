/**
 * 详情页 & 填充计划的共享类型
 */

export interface ParsedScreen {
    id: number;
    name: string;
    type: string;
    bounds: { top: number; left: number; bottom: number; right: number; width: number; height: number };
    copyPlaceholders: CopyPlaceholder[];
    imagePlaceholders: ImagePlaceholder[];
    order: number;
    structure?: {
        hasCopyGroup: boolean;
        hasIconGroup: boolean;
        hasImageGroup: boolean;
        missingGroups: Array<'文案' | 'icon' | '图片'>;
        recognizedGroups: string[];
    };
}

export interface CopyPlaceholder {
    layerId: number;
    layerName: string;
    currentText: string;
    role: string;
    fontSize?: number;
    bounds: any;
    zone?: 'copy' | 'icon' | 'image' | 'unknown';
}

export interface ImagePlaceholder {
    layerId: number;
    layerName: string;
    bounds: any;
    baseLayerId?: number;
    baseLayerName?: string;
    isClippingMask: boolean;
    clippingInfo?: {
        isClipped: boolean;
        baseLayerId: number;
        baseBounds?: any;
    };
    recommendedAssetType: string;
    aspectRatio: number;
    zone?: 'copy' | 'icon' | 'image' | 'unknown';
}

export interface LayerIssue {
    type: string;
    severity: string;
    layerId: number;
    layerName: string;
    description: string;
    autoFixable: boolean;
}

export interface FillPlan {
    screenId: number;
    screenName: string;
    screenType: string;
    confidence?: number;
    needsReview?: boolean;
    copies: { layerId: number; content: string }[];
    images: {
        layerId: number;
        imagePath: string;
        fillMode: string;
        isClippingMask?: boolean;
        baseLayerId?: number;
        referenceLayerId?: number;
        zone?: 'copy' | 'icon' | 'image' | 'unknown';
    }[];
}

export interface PlanQuality {
    confidence: number;
    score: number;
    imageTotal: number;
    imageMatched: number;
    imageCoverage: number;
    copyTotal: number;
    copyNonEmpty: number;
    copyCoverage: number;
}

export interface PlanExecutionTrace {
    tool: string;
    status: 'planned' | 'success' | 'failed' | 'skipped' | 'partial' | 'fallback';
    reason?: string;
    details?: string;
}
