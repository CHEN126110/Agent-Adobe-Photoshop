import type {
    BlockRole,
    ImagePlacementSpec,
    ResolvedBlock
} from './layout-engine';

export type ImagePlacementQualityState = 'passed' | 'needs_review' | 'needs_repair';
export type ImagePlacementQualitySeverity = 'review' | 'repair';
export type ImagePlacementQualityFindingCode =
    | 'actual_bounds_missing'
    | 'main_image_underfilled'
    | 'main_image_aspect_mismatch'
    | 'placement_off_target'
    | 'cover_not_clipped'
    | 'placement_semantics_unapplied';
export type ImagePlacementQualityClosureKind = 'observation' | 'mutation' | 'replan' | 'visual';

export interface ImagePlacementBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ImagePlacementQualityFinding {
    code: ImagePlacementQualityFindingCode;
    severity: ImagePlacementQualitySeverity;
    blockId: string;
    role: BlockRole;
    layerId?: number;
    message: string;
    closureKind: ImagePlacementQualityClosureKind;
    recommendedAction?: {
        toolName: string;
        params: Record<string, unknown>;
        reason: string;
    };
    recommendedStrategies?: string[];
}

export interface ImagePlacementQualityReceipt {
    version: 'render-layout-image-placement-quality/v1';
    blockId: string;
    role: BlockRole;
    layerId?: number;
    fit: ImagePlacementSpec['fit'];
    targetBounds: ImagePlacementBounds;
    actualBounds?: ImagePlacementBounds;
    metrics?: {
        widthCoverage: number;
        heightCoverage: number;
        areaCoverage: number;
        centerOffsetRatio: number;
    };
    clippingApplied: boolean;
    qualityState: ImagePlacementQualityState;
    findings: ImagePlacementQualityFinding[];
}

export interface EvaluateImagePlacementQualityInput {
    block: Pick<ResolvedBlock, 'id' | 'role' | 'x' | 'y' | 'width' | 'height' | 'imagePlacement'>;
    layerId?: number;
    actualBounds?: unknown;
    clippingApplied?: boolean;
    clippingBaseLayerId?: number;
    canvas?: { width: number; height: number };
    unsupportedSemantics?: string[];
}

const MAIN_IMAGE_MIN_AXIS_COVERAGE = 0.45;
const CENTER_OFFSET_TOLERANCE_RATIO = 0.04;

function finiteNumber(value: unknown): number | undefined {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
}

function round3(value: number): number {
    return Math.round(value * 1000) / 1000;
}

export function normalizeImagePlacementBounds(value: unknown): ImagePlacementBounds | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    const x = finiteNumber(record.x) ?? finiteNumber(record.left);
    const y = finiteNumber(record.y) ?? finiteNumber(record.top);
    const width = finiteNumber(record.width);
    const height = finiteNumber(record.height);
    const right = finiteNumber(record.right);
    const bottom = finiteNumber(record.bottom);
    const resolvedWidth = width ?? (x !== undefined && right !== undefined ? right - x : undefined);
    const resolvedHeight = height ?? (y !== undefined && bottom !== undefined ? bottom - y : undefined);
    if (x === undefined || y === undefined || resolvedWidth === undefined || resolvedHeight === undefined) {
        return undefined;
    }
    if (!(resolvedWidth > 0 && resolvedHeight > 0)) return undefined;
    return { x, y, width: resolvedWidth, height: resolvedHeight };
}

function intersectArea(a: ImagePlacementBounds, b: ImagePlacementBounds): number {
    const left = Math.max(a.x, b.x);
    const top = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function resolveQualityState(findings: ImagePlacementQualityFinding[]): ImagePlacementQualityState {
    if (findings.some((finding) => finding.severity === 'repair')) return 'needs_repair';
    if (findings.length > 0) return 'needs_review';
    return 'passed';
}

function buildSubjectFitAction(input: {
    block: EvaluateImagePlacementQualityInput['block'];
    layerId?: number;
}): ImagePlacementQualityFinding['recommendedAction'] | undefined {
    if (!input.layerId) return undefined;
    const subjectFillRatio = Number(input.block.imagePlacement?.subjectFillRatio);
    return {
        toolName: 'fitLayerSubjectToRegion',
        params: {
            layerId: input.layerId,
            targetRegion: {
                x: input.block.x,
                y: input.block.y,
                width: input.block.width,
                height: input.block.height
            },
            subjectFillRatio: Number.isFinite(subjectFillRatio) && subjectFillRatio > 0 && subjectFillRatio <= 1
                ? subjectFillRatio
                : 0.82,
            maxUpscaleRatio: 3
        },
        reason: '按真实主体边界而不是整张图片图框重新求解视觉占比，并在写后读取当前区域画面复核。'
    };
}

function buildBoundsReadAction(
    layerId: number | undefined
): ImagePlacementQualityFinding['recommendedAction'] | undefined {
    if (!layerId) return undefined;
    return {
        toolName: 'getLayerBounds',
        params: { layerId, includeEffects: false },
        reason: '读取同一真实图层的 Photoshop bounds，确认置入结果而不是依赖计划值。'
    };
}

function buildClippingRepairAction(input: {
    layerId?: number;
    baseLayerId?: number;
}): ImagePlacementQualityFinding['recommendedAction'] | undefined {
    if (!input.layerId || !input.baseLayerId) return undefined;
    return {
        toolName: 'createClippingMask',
        params: {
            layerId: input.layerId,
            baseLayerId: input.baseLayerId
        },
        reason: '在最终图层组内重新建立图片与指定矩形基底的剪切关系，并再次读回验证。'
    };
}

function targetIsWholeCanvas(
    target: ImagePlacementBounds,
    canvas: EvaluateImagePlacementQualityInput['canvas']
): boolean {
    if (!canvas || !(canvas.width > 0 && canvas.height > 0)) return false;
    return Math.abs(target.x) <= 1
        && Math.abs(target.y) <= 1
        && Math.abs(target.width - canvas.width) <= 1
        && Math.abs(target.height - canvas.height) <= 1;
}

/**
 * 对账 renderLayout 的目标区域与 Photoshop 真实置入 bounds。
 *
 * 这里只判确定性的执行/构图风险，不冒充完整审美评价。严重欠填会要求 R4 修订；
 * “允许留白”必须由规划显式声明，不能由默认 contain 静默产生。
 */
export function evaluateImagePlacementQuality(
    input: EvaluateImagePlacementQualityInput
): ImagePlacementQualityReceipt {
    const block = input.block;
    const placement = block.imagePlacement;
    const fit = placement?.fit === 'cover' ? 'cover' : 'contain';
    const targetBounds: ImagePlacementBounds = {
        x: block.x,
        y: block.y,
        width: block.width,
        height: block.height
    };
    const findings: ImagePlacementQualityFinding[] = [];
    const actualBounds = normalizeImagePlacementBounds(input.actualBounds);

    if (!actualBounds) {
        findings.push({
            code: 'actual_bounds_missing',
            severity: 'review',
            blockId: block.id,
            role: block.role,
            layerId: input.layerId,
            message: `图片块「${block.id}」缺少 Photoshop actualBounds，不能确认真实落位大小。`,
            closureKind: 'observation',
            recommendedAction: buildBoundsReadAction(input.layerId)
        });
    }

    let metrics: ImagePlacementQualityReceipt['metrics'];
    if (actualBounds) {
        const widthCoverage = actualBounds.width / targetBounds.width;
        const heightCoverage = actualBounds.height / targetBounds.height;
        const areaCoverage = intersectArea(actualBounds, targetBounds)
            / Math.max(1, targetBounds.width * targetBounds.height);
        const targetCenterX = targetBounds.x + targetBounds.width / 2;
        const targetCenterY = targetBounds.y + targetBounds.height / 2;
        const actualCenterX = actualBounds.x + actualBounds.width / 2;
        const actualCenterY = actualBounds.y + actualBounds.height / 2;
        const centerOffsetRatio = Math.hypot(
            (actualCenterX - targetCenterX) / Math.max(1, targetBounds.width),
            (actualCenterY - targetCenterY) / Math.max(1, targetBounds.height)
        );
        metrics = {
            widthCoverage: round3(widthCoverage),
            heightCoverage: round3(heightCoverage),
            areaCoverage: round3(areaCoverage),
            centerOffsetRatio: round3(centerOffsetRatio)
        };

        const allowUnderfill = placement?.allowUnderfill === true;
        const minAxisCoverage = Math.min(widthCoverage, heightCoverage);
        if (block.role === 'main-image'
            && fit === 'contain'
            && !allowUnderfill
            && minAxisCoverage < MAIN_IMAGE_MIN_AXIS_COVERAGE) {
            const widthConstrained = widthCoverage >= 0.9 && heightCoverage < MAIN_IMAGE_MIN_AXIS_COVERAGE;
            const heightConstrained = heightCoverage >= 0.9 && widthCoverage < MAIN_IMAGE_MIN_AXIS_COVERAGE;
            if (widthConstrained || heightConstrained) {
                findings.push({
                    code: 'main_image_aspect_mismatch',
                    severity: 'repair',
                    blockId: block.id,
                    role: block.role,
                    layerId: input.layerId,
                    message: `主视觉「${block.id}」只覆盖目标区域约 ${Math.round(areaCoverage * 100)}%，`
                        + '且一条边已经贴满、另一条边仍严重欠填；这是素材与区域的纵横比冲突，'
                        + '继续做 contain 主体缩放不会解决构图问题。',
                    closureKind: 'replan',
                    recommendedStrategies: [
                        '根据素材/主体比例重新规划主视觉区域',
                        '有可靠裁切依据时改为 cover + clipping',
                        '选择更适合该区域比例的素材'
                    ]
                });
            } else {
                findings.push({
                    code: 'main_image_underfilled',
                    severity: 'repair',
                    blockId: block.id,
                    role: block.role,
                    layerId: input.layerId,
                    message: `主视觉「${block.id}」只覆盖目标区域约 ${Math.round(areaCoverage * 100)}%，`
                        + '实际图框在宽高两个方向都明显小于目标区域，需要按真实主体边界重新求解。',
                    closureKind: 'mutation',
                    recommendedAction: buildSubjectFitAction({ block, layerId: input.layerId })
                });
            }
        }

        const anchor = String(placement?.anchor || 'center').toLowerCase();
        if (anchor === 'center'
            && !placement?.focalPoint
            && centerOffsetRatio > CENTER_OFFSET_TOLERANCE_RATIO) {
            findings.push({
                code: 'placement_off_target',
                severity: 'repair',
                blockId: block.id,
                role: block.role,
                layerId: input.layerId,
                message: `图片块「${block.id}」没有按声明的 center 锚点落在目标区域中心，`
                    + `中心偏差约 ${Math.round(centerOffsetRatio * 100)}%。`,
                // 这里只证明位置偏了，并没有证明主体尺寸不对。复用 subject-fit 会把
                // “平移问题”错误升级成二次缩放，破坏已经正确的主体比例。
                closureKind: 'replan',
                recommendedStrategies: [
                    '保持当前图片尺寸，只重新求解 center 锚点的位置',
                    '重新调用 renderLayout，由布局引擎按声明区域完成落位'
                ]
            });
        }
    }

    const shouldClipCover = fit === 'cover'
        && (placement?.mask === 'clipping' || placement?.overflow === 'clip');
    if (shouldClipCover && input.clippingApplied !== true) {
        findings.push({
            code: 'cover_not_clipped',
            severity: 'repair',
            blockId: block.id,
            role: block.role,
            layerId: input.layerId,
            message: `图片块「${block.id}」要求 cover + clip，但执行后没有可靠的剪切收据；`
                + '图片可能溢出并遮挡相邻内容。',
            closureKind: 'mutation',
            recommendedAction: buildClippingRepairAction({
                layerId: input.layerId,
                baseLayerId: input.clippingBaseLayerId
            })
        });
    } else if (fit === 'cover'
        && !shouldClipCover
        && !targetIsWholeCanvas(targetBounds, input.canvas)) {
        findings.push({
            code: 'cover_not_clipped',
            severity: 'repair',
            blockId: block.id,
            role: block.role,
            layerId: input.layerId,
            message: `图片块「${block.id}」在非整画布区域使用 cover，却没有声明 clipping/clip；`
                + '执行层不能安全猜测裁切边界。',
            closureKind: 'replan',
            recommendedStrategies: [
                '为该区域声明 mask=clipping 或 overflow=clip',
                '改用 contain 并重新规划区域比例'
            ]
        });
    }

    const unsupportedSemantics = Array.from(new Set(
        (input.unsupportedSemantics || []).map((item) => String(item).trim()).filter(Boolean)
    ));
    if (unsupportedSemantics.length > 0) {
        findings.push({
            code: 'placement_semantics_unapplied',
            severity: 'repair',
            blockId: block.id,
            role: block.role,
            layerId: input.layerId,
            message: `图片块「${block.id}」仍有未执行的落位语义：${unsupportedSemantics.join('、')}。`,
            closureKind: 'replan',
            recommendedStrategies: [
                '移除当前执行层尚不支持的语义',
                '改用已提供这些语义的专用布局能力'
            ]
        });
    }

    return {
        version: 'render-layout-image-placement-quality/v1',
        blockId: block.id,
        role: block.role,
        layerId: input.layerId,
        fit,
        targetBounds,
        actualBounds,
        metrics,
        clippingApplied: input.clippingApplied === true,
        qualityState: resolveQualityState(findings),
        findings
    };
}
