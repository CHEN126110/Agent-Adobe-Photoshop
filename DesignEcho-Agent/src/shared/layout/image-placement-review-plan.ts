import type {
    VisualObservationOverflow,
    VisualObservationTarget
} from '../visual-observation-bundle';
import type { ImagePlacementQualityReceipt } from './image-placement-quality';

export const IMAGE_PLACEMENT_REVIEW_CAPTURE_LIMIT = 8;

const IMAGE_PLACEMENT_REVIEW_MIN_PADDING = 12;
const IMAGE_PLACEMENT_REVIEW_PADDING_RATIO = 0.035;

export type ImagePlacementReviewReceipt = Pick<
    ImagePlacementQualityReceipt,
    'blockId' | 'qualityState' | 'targetBounds' | 'cropFacts'
>;

export interface ImagePlacementReviewCaptureRegion {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ImagePlacementReviewTarget<TReceipt extends ImagePlacementReviewReceipt> {
    receipt: TReceipt;
    sourceKind: 'layout-region';
    sourceId: string;
    riskScore: number;
    captureRegion: ImagePlacementReviewCaptureRegion;
}

export interface ImagePlacementReviewPlan<TReceipt extends ImagePlacementReviewReceipt> {
    allTargets: Array<ImagePlacementReviewTarget<TReceipt>>;
    selectedTargets: Array<ImagePlacementReviewTarget<TReceipt>>;
    expectedTargets: VisualObservationTarget[];
    overflow?: VisualObservationOverflow;
}

export interface BuildImagePlacementReviewPlanInput<TReceipt extends ImagePlacementReviewReceipt> {
    receipts: readonly TReceipt[];
    canvas: {
        width: number;
        height: number;
    };
}

function clampRatio(value: number | undefined): number {
    const numeric = Number(value ?? 1);
    if (!Number.isFinite(numeric)) return 1;
    return Math.max(0, Math.min(1, numeric));
}

function calculateRiskScore(receipt: ImagePlacementReviewReceipt): number {
    const frameVisibleRatio = clampRatio(receipt.cropFacts?.frameVisibleRatio);
    return (receipt.qualityState === 'needs_repair' ? 2 : 0)
        + (receipt.cropFacts?.cropPolicySatisfied === 'unknown' ? 1 : 0)
        + (1 - frameVisibleRatio);
}

function buildCaptureRegion(
    receipt: ImagePlacementReviewReceipt,
    canvas: BuildImagePlacementReviewPlanInput<ImagePlacementReviewReceipt>['canvas']
): ImagePlacementReviewCaptureRegion {
    const target = receipt.targetBounds;
    const padding = Math.max(
        IMAGE_PLACEMENT_REVIEW_MIN_PADDING,
        Math.round(Math.min(target.width, target.height) * IMAGE_PLACEMENT_REVIEW_PADDING_RATIO)
    );
    const x = Math.max(0, Math.floor(target.x - padding));
    const y = Math.max(0, Math.floor(target.y - padding));
    const right = Math.min(canvas.width, Math.ceil(target.x + target.width + padding));
    const bottom = Math.min(canvas.height, Math.ceil(target.y + target.height + padding));
    return {
        x,
        y,
        width: Math.max(1, right - x),
        height: Math.max(1, bottom - y)
    };
}

/**
 * 只根据图片落位收据规划视觉复核采样：统一风险排序、局部截图范围与生产者上限。
 * 该计划不评价设计好坏、不决定是否接受裁切，也不替 Agent 选择或调整素材。
 */
export function buildImagePlacementReviewPlan<TReceipt extends ImagePlacementReviewReceipt>(
    input: BuildImagePlacementReviewPlanInput<TReceipt>
): ImagePlacementReviewPlan<TReceipt> {
    const allTargets = input.receipts
        .map((receipt, sourceIndex) => ({ receipt, sourceIndex }))
        .filter(({ receipt }) => receipt.cropFacts?.requiresVisualReview === true)
        .map(({ receipt, sourceIndex }) => ({
            receipt,
            sourceIndex,
            sourceKind: 'layout-region' as const,
            sourceId: String(receipt.blockId),
            riskScore: calculateRiskScore(receipt),
            captureRegion: buildCaptureRegion(receipt, input.canvas)
        }))
        .sort((left, right) => right.riskScore - left.riskScore || left.sourceIndex - right.sourceIndex)
        .map(({ sourceIndex: _sourceIndex, ...target }) => target);
    const selectedTargets = allTargets.slice(0, IMAGE_PLACEMENT_REVIEW_CAPTURE_LIMIT);
    const expectedTargets = allTargets.map(({ sourceKind, sourceId }) => ({ sourceKind, sourceId }));
    const omittedTargets = allTargets.slice(selectedTargets.length);

    return {
        allTargets,
        selectedTargets,
        expectedTargets,
        ...(omittedTargets.length > 0
            ? {
                overflow: {
                    omittedCount: omittedTargets.length,
                    reason: 'producer_limit' as const,
                    sourceIds: omittedTargets.map(({ sourceId }) => sourceId)
                }
            }
            : {})
    };
}
