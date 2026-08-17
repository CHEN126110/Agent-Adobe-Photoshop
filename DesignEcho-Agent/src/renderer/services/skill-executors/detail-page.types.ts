/**
 * 详情页模板解析与填充计划的共享类型。
 */

import type { DetailPageEditContentMode } from '../../../shared/detail-page-agent-intake';
import type { DetailScreenPlan, DetailScreenRole } from '../../../shared/detail-page-screen-plan';
import type {
    DesignAssetDirectUseSuitability,
    DesignAssetSourceTreatment,
    DesignAssetVisualRole
} from '../../../shared/design-placement-intelligence';
import type {
    ImagePlacementContainer,
    ImagePlacementExpectedRelation,
    ImagePlacementSourceTreatment
} from '../../../shared/design-image-placement-core';
import type { ProjectVisualBackgroundType } from '../../../shared/project-visual-sampling';
import type { PlacementPlan, PlacementTransform } from '../../../shared/reference-replication-placement';
import type { SmartScalingDecision } from '../../../shared/design-smart-scaling-policy';
export type { DetailScreenPlan, DetailScreenRole } from '../../../shared/detail-page-screen-plan';
export type { DetailPageEditContentMode } from '../../../shared/detail-page-agent-intake';

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
    placementPlan?: PlacementPlan;
}

export interface LayerIssue {
    type: string;
    severity: string;
    layerId: number;
    layerName: string;
    description: string;
    autoFixable: boolean;
}

export interface DetailAssetUsageDecision {
    visualObserved: boolean;
    visualEvidenceId?: string;
    visualRole: DesignAssetVisualRole;
    backgroundType: ProjectVisualBackgroundType;
    directUseSuitability: DesignAssetDirectUseSuitability;
    sourceTreatment: DesignAssetSourceTreatment;
    automaticPlacementEligible: boolean;
    reason: string;
}

export interface FillPlan {
    screenId: number;
    screenName: string;
    screenType: string;
    workMode?: string;
    targetScope?: unknown;
    requestedChange?: string;
    editContentMode?: DetailPageEditContentMode;
    /** 纯图片区显式为 false；有文字占位或缺省时仍要求实际文案。 */
    copyExpected?: boolean;
    /** 本屏保留在任务分母，但本轮因人工辅助/输入不足未执行写入。 */
    executionDeferred?: boolean;
    /** Photoshop 写后找不到该屏或无法取得有效回读。 */
    liveScreenMissing?: boolean;
    readbackMissing?: boolean;
    /** Photoshop 中仍存在计划外文字层或旧模板字。 */
    readbackUnexpected?: boolean;
    screenRole?: DetailScreenRole;
    imageStrategy?: DetailScreenPlan['imageStrategy'];
    copyStrategy?: DetailScreenPlan['copyStrategy'];
    mainMessage?: string;
    supportingPoints?: string[];
    /** 从 screen plan 传递的稳定事实引用；不能包含事实原文或路径。 */
    supportRefs?: string[];
    confidence?: number;
    needsReview?: boolean;
    decisionBoundary?: {
        screenDecisionSource: string;
        requiresModelDecision: boolean;
        assetSelectionSource: string;
        note: string;
    };
    copyAudit?: {
        status: 'ok' | 'watch' | 'risky';
        warningCount: number;
        riskyPlaceholderCount: number;
        watchPlaceholderCount: number;
        warnings: string[];
        placeholderAudits?: Array<{
            placeholderLayerId: number;
            status: 'ok' | 'watch' | 'risky';
            warnings: string[];
        }>;
    };
    copies: {
        layerId: number;
        layerName?: string;
        content: string;
        source?: 'template' | 'ai_generated' | 'knowledge' | 'user_input' | 'hybrid';
        originalText?: string;
        copyStrategy?: DetailScreenPlan['copyStrategy'];
        mainMessage?: string;
        supportingPoints?: string[];
        generationStatus?: 'template' | 'generated' | 'failed';
        generationReason?: string;
        /** 候选文案的事实引用与 Harness 选择记录。 */
        supportRefs?: string[];
        candidateScore?: number;
        candidateReason?: string;
        candidateBelowThreshold?: boolean;
        /** false 仅用于 label 等非事实性装饰文案。 */
        requiresFactSupport?: boolean;
        /** Photoshop 实际文字层回读状态，由执行器写后核验填充。 */
        readbackStatus?: 'observed' | 'verified' | 'missing' | 'unexpected' | 'mismatch';
        readbackMissing?: boolean;
        readbackUnexpected?: boolean;
    }[];
    images: {
        layerId: number;
        layerName?: string;
        imagePath?: string;
        /** 聊天附件等受控内存素材可直接传给 UXP，不要求先暴露本地临时路径。 */
        imageData?: string;
        imageFormat?: 'png' | 'jpeg' | 'webp';
        fillMode: string;
        assetType?: string;
        needsMatting?: boolean;
        subjectAlign?: 'center' | 'left' | 'right' | 'top' | 'bottom';
        fitReason?: string;
        selectionReason?: string;
        isClippingMask?: boolean;
        baseLayerId?: number;
        referenceLayerId?: number;
        targetBounds?: {
            left: number;
            top: number;
            right: number;
            bottom: number;
            width?: number;
            height?: number;
        };
        zone?: 'copy' | 'icon' | 'image' | 'unknown';
        placementPlan?: PlacementPlan;
        placementTransform?: PlacementTransform;
        smartScalingDecision?: SmartScalingDecision;
        /** 视觉观察到槽位用途的可审计判定；不等同于 Photoshop 已完成处理。 */
        assetUsageDecision?: DetailAssetUsageDecision;
        /** 素材可作为候选，但所需去底/复核尚未完成，本图片项不得写入。 */
        executionDeferred?: boolean;
        sourceTreatment?: ImagePlacementSourceTreatment;
        container?: ImagePlacementContainer;
        expectedRelation?: ImagePlacementExpectedRelation;
    }[];
}

export interface PlanQuality {
    confidence: number;
    score: number;
    imageTotal: number;
    imageMatched: number;
    /** 需要先处理/确认的图片，不进入本轮可执行覆盖率分母。 */
    imageDeferred: number;
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
