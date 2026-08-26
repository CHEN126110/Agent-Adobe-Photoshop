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
    | 'frame_crop_violates_policy'
    | 'crop_intent_unverified'
    | 'protected_subject_cropped'
    | 'intentional_crop_requires_visual_review'
    | 'subject_fit_verification_failed'
    | 'focal_point_clamped'
    | 'focal_point_unverified'
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
    cropPolicy?: ImagePlacementSpec['cropPolicy'];
    targetBounds: ImagePlacementBounds;
    actualBounds?: ImagePlacementBounds;
    metrics?: {
        widthCoverage: number;
        heightCoverage: number;
        areaCoverage: number;
        centerOffsetRatio: number;
        alignmentDeviationRatio: number;
        frameVisibleRatio: number;
    };
    cropFacts?: {
        frameVisibleRatio: number;
        clippedFrameEdges: Array<'top' | 'right' | 'bottom' | 'left'>;
        subjectBounds?: ImagePlacementBounds;
        subjectVisibleRatio?: number;
        clippedSubjectEdges?: Array<'top' | 'right' | 'bottom' | 'left'>;
        sourceTouchesEdges?: Array<'top' | 'right' | 'bottom' | 'left'>;
        subjectDetection?: {
            method: string;
            confidence: 'certain' | 'high' | 'medium' | 'low';
            note?: string;
        };
        cropPolicySatisfied: boolean | 'unknown';
        requiresVisualReview: boolean;
    };
    subjectFitVerification?: {
        status: 'passed' | 'needs_review' | 'failed';
        warnings?: string[];
    };
    executionPlacement?: Record<string, unknown>;
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
    actualSubjectBounds?: unknown;
    subjectDetection?: {
        method?: unknown;
        confidence?: unknown;
        note?: unknown;
        relativeBox?: unknown;
    };
    subjectFitVerification?: {
        status?: unknown;
        warnings?: unknown;
    };
    executionPlacement?: unknown;
}

const MAIN_IMAGE_MIN_AXIS_COVERAGE = 0.45;
const CENTER_OFFSET_TOLERANCE_RATIO = 0.04;
const CROP_EDGE_TOLERANCE_PX = 1;
const SUBJECT_VISIBLE_TOLERANCE = 0.985;

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

function clippedEdges(
    bounds: ImagePlacementBounds,
    clipBounds: ImagePlacementBounds
): Array<'top' | 'right' | 'bottom' | 'left'> {
    const edges: Array<'top' | 'right' | 'bottom' | 'left'> = [];
    if (bounds.y < clipBounds.y - CROP_EDGE_TOLERANCE_PX) edges.push('top');
    if (bounds.x + bounds.width > clipBounds.x + clipBounds.width + CROP_EDGE_TOLERANCE_PX) {
        edges.push('right');
    }
    if (bounds.y + bounds.height > clipBounds.y + clipBounds.height + CROP_EDGE_TOLERANCE_PX) {
        edges.push('bottom');
    }
    if (bounds.x < clipBounds.x - CROP_EDGE_TOLERANCE_PX) edges.push('left');
    return edges;
}

function normalizeSubjectDetection(
    value: EvaluateImagePlacementQualityInput['subjectDetection']
): ImagePlacementQualityReceipt['cropFacts'] extends infer TCropFacts
    ? TCropFacts extends { subjectDetection?: infer TDetection }
        ? TDetection | undefined
        : never
    : never {
    if (!value) return undefined;
    const confidence = String(value.confidence || '') as 'certain' | 'high' | 'medium' | 'low';
    if (!['certain', 'high', 'medium', 'low'].includes(confidence)) return undefined;
    const method = String(value.method || '').trim();
    if (!method) return undefined;
    const note = String(value.note || '').trim();
    return { method, confidence, ...(note ? { note } : {}) };
}

function sourceTouchesEdges(
    relativeBox: unknown
): Array<'top' | 'right' | 'bottom' | 'left'> | undefined {
    if (!relativeBox || typeof relativeBox !== 'object') return undefined;
    const record = relativeBox as Record<string, unknown>;
    const x = Number(record.x);
    const y = Number(record.y);
    const width = Number(record.width);
    const height = Number(record.height);
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return undefined;
    const tolerance = 0.02;
    const edges: Array<'top' | 'right' | 'bottom' | 'left'> = [];
    if (y <= tolerance) edges.push('top');
    if (x + width >= 1 - tolerance) edges.push('right');
    if (y + height >= 1 - tolerance) edges.push('bottom');
    if (x <= tolerance) edges.push('left');
    return edges;
}

function alignmentDeviationRatio(
    actual: ImagePlacementBounds,
    target: ImagePlacementBounds,
    anchor: ImagePlacementSpec['anchor']
): number {
    const actualCenterX = actual.x + actual.width / 2;
    const actualCenterY = actual.y + actual.height / 2;
    const targetCenterX = target.x + target.width / 2;
    const targetCenterY = target.y + target.height / 2;
    let dx = actualCenterX - targetCenterX;
    let dy = actualCenterY - targetCenterY;
    switch (anchor) {
        case 'top-center':
            dy = actual.y - target.y;
            break;
        case 'bottom-center':
            dy = actual.y + actual.height - (target.y + target.height);
            break;
        case 'left-center':
            dx = actual.x - target.x;
            break;
        case 'right-center':
            dx = actual.x + actual.width - (target.x + target.width);
            break;
        case 'center':
        default:
            break;
    }
    return Math.hypot(
        dx / Math.max(1, target.width),
        dy / Math.max(1, target.height)
    );
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
    const anchor = input.block.imagePlacement?.anchor;
    if (!Number.isFinite(subjectFillRatio)
        || subjectFillRatio <= 0
        || subjectFillRatio > 1
        || !anchor) {
        return undefined;
    }
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
            subjectFillRatio,
            anchor,
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

function resolveEffectiveClipBounds(
    input: EvaluateImagePlacementQualityInput,
    targetBounds: ImagePlacementBounds
): ImagePlacementBounds | undefined {
    if (input.clippingApplied === true) return targetBounds;
    if (input.canvas && input.canvas.width > 0 && input.canvas.height > 0) {
        return { x: 0, y: 0, width: input.canvas.width, height: input.canvas.height };
    }
    return undefined;
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
    const actualSubjectBounds = normalizeImagePlacementBounds(input.actualSubjectBounds);
    const subjectDetection = normalizeSubjectDetection(input.subjectDetection);
    const cropPolicy = placement?.cropPolicy;

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
        const resolvedAlignmentDeviationRatio = alignmentDeviationRatio(
            actualBounds,
            targetBounds,
            placement?.anchor || 'center'
        );
        const frameArea = Math.max(1, actualBounds.width * actualBounds.height);
        const metricsClipBounds = resolveEffectiveClipBounds(input, targetBounds);
        const frameVisibleRatio = metricsClipBounds
            ? intersectArea(actualBounds, metricsClipBounds) / frameArea
            : 1;
        metrics = {
            widthCoverage: round3(widthCoverage),
            heightCoverage: round3(heightCoverage),
            areaCoverage: round3(areaCoverage),
            centerOffsetRatio: round3(centerOffsetRatio),
            alignmentDeviationRatio: round3(resolvedAlignmentDeviationRatio),
            frameVisibleRatio: round3(frameVisibleRatio)
        };

        const allowUnderfill = placement?.allowUnderfill === true;
        const minAxisCoverage = Math.min(widthCoverage, heightCoverage);
        if (block.role === 'main-image'
            && fit === 'contain'
            && !allowUnderfill
            && placement?.subjectFillRatio === undefined
            && minAxisCoverage < MAIN_IMAGE_MIN_AXIS_COVERAGE) {
            const widthConstrained = widthCoverage >= 0.9 && heightCoverage < MAIN_IMAGE_MIN_AXIS_COVERAGE;
            const heightConstrained = heightCoverage >= 0.9 && widthCoverage < MAIN_IMAGE_MIN_AXIS_COVERAGE;
            if (widthConstrained || heightConstrained) {
                findings.push({
                    code: 'main_image_aspect_mismatch',
                    severity: 'review',
                    blockId: block.id,
                    role: block.role,
                    layerId: input.layerId,
                    message: `主视觉「${block.id}」只覆盖目标区域约 ${Math.round(areaCoverage * 100)}%，`
                        + '且一条边已经贴满、另一条边仍严重欠填；这是素材与区域的纵横比冲突，'
                        + '继续做 contain 主体缩放不会解决构图问题。',
                    closureKind: 'visual',
                    recommendedStrategies: [
                        '根据素材/主体比例重新规划主视觉区域',
                        '有可靠裁切依据时改为 cover + clipping',
                        '选择更适合该区域比例的素材'
                    ]
                });
            } else {
                findings.push({
                    code: 'main_image_underfilled',
                    severity: 'review',
                    blockId: block.id,
                    role: block.role,
                    layerId: input.layerId,
                    message: `主视觉「${block.id}」只覆盖目标区域约 ${Math.round(areaCoverage * 100)}%，`
                        + '实际图框在宽高两个方向都明显小于目标区域，需要按真实主体边界重新求解。',
                    closureKind: 'visual',
                    recommendedAction: buildSubjectFitAction({ block, layerId: input.layerId })
                });
            }
        }

        const anchor = placement?.anchor || 'center';
        if (!placement?.focalPoint
            && placement?.subjectFillRatio === undefined
            && resolvedAlignmentDeviationRatio > CENTER_OFFSET_TOLERANCE_RATIO) {
            findings.push({
                code: 'placement_off_target',
                severity: 'repair',
                blockId: block.id,
                role: block.role,
                layerId: input.layerId,
                message: `图片块「${block.id}」没有按声明的 ${anchor} 锚点落位，`
                    + `归一化偏差约 ${Math.round(resolvedAlignmentDeviationRatio * 100)}%。`,
                // 这里只证明位置偏了，并没有证明主体尺寸不对。复用 subject-fit 会把
                // “平移问题”错误升级成二次缩放，破坏已经正确的主体比例。
                closureKind: 'replan',
                recommendedStrategies: [
                    `保持当前图片尺寸，只重新求解 ${anchor} 锚点的位置`,
                    '重新调用 renderLayout，由布局引擎按声明区域完成落位'
                ]
            });
        }
    }

    let cropFacts: ImagePlacementQualityReceipt['cropFacts'];
    if (actualBounds) {
        const effectiveClipBounds = resolveEffectiveClipBounds(input, targetBounds);
        const frameArea = Math.max(1, actualBounds.width * actualBounds.height);
        const frameVisibleRatio = effectiveClipBounds
            ? intersectArea(actualBounds, effectiveClipBounds) / frameArea
            : 1;
        const clippedFrame = effectiveClipBounds
            ? clippedEdges(actualBounds, effectiveClipBounds)
            : [];
        const subjectArea = actualSubjectBounds
            ? Math.max(1, actualSubjectBounds.width * actualSubjectBounds.height)
            : undefined;
        let subjectVisibleRatio: number | undefined;
        let clippedSubject: Array<'top' | 'right' | 'bottom' | 'left'> | undefined;
        if (actualSubjectBounds && subjectArea && effectiveClipBounds) {
            subjectVisibleRatio = intersectArea(actualSubjectBounds, effectiveClipBounds) / subjectArea;
            clippedSubject = clippedEdges(actualSubjectBounds, effectiveClipBounds);
        } else if (actualSubjectBounds) {
            subjectVisibleRatio = 1;
            clippedSubject = [];
        }
        const sourceEdges = sourceTouchesEdges(input.subjectDetection?.relativeBox);
        const reliableSubjectEvidence = Boolean(
            subjectDetection
            && (subjectDetection.confidence === 'certain' || subjectDetection.confidence === 'high')
            && actualSubjectBounds
        );
        let cropPolicySatisfied: boolean | 'unknown' = 'unknown';
        if (cropPolicy === 'avoid-crop') {
            cropPolicySatisfied = frameVisibleRatio >= SUBJECT_VISIBLE_TOLERANCE;
        } else if (cropPolicy === 'protect-subject') {
            cropPolicySatisfied = reliableSubjectEvidence && subjectVisibleRatio !== undefined
                ? subjectVisibleRatio >= SUBJECT_VISIBLE_TOLERANCE
                : 'unknown';
        } else if (cropPolicy === 'allow-crop') {
            cropPolicySatisfied = true;
        }
        const frameIsCropped = frameVisibleRatio < SUBJECT_VISIBLE_TOLERANCE;
        const requiresVisualReview = frameIsCropped
            || cropPolicySatisfied === 'unknown'
            || (subjectVisibleRatio !== undefined && subjectVisibleRatio < SUBJECT_VISIBLE_TOLERANCE);
        cropFacts = {
            frameVisibleRatio: round3(frameVisibleRatio),
            clippedFrameEdges: clippedFrame,
            ...(actualSubjectBounds ? { subjectBounds: actualSubjectBounds } : {}),
            ...(subjectVisibleRatio !== undefined
                ? { subjectVisibleRatio: round3(subjectVisibleRatio) }
                : {}),
            ...(clippedSubject ? { clippedSubjectEdges: clippedSubject } : {}),
            ...(sourceEdges ? { sourceTouchesEdges: sourceEdges } : {}),
            ...(subjectDetection ? { subjectDetection } : {}),
            cropPolicySatisfied,
            requiresVisualReview
        };

        if (cropPolicy === 'protect-subject' && cropPolicySatisfied === false) {
            findings.push({
                code: 'protected_subject_cropped',
                severity: 'repair',
                blockId: block.id,
                role: block.role,
                layerId: input.layerId,
                message: `图片块「${block.id}」声明保护主体，但写后主体仅有约 `
                    + `${Math.round((subjectVisibleRatio || 0) * 100)}% 位于目标区域内，`
                    + `被裁边：${(clippedSubject || []).join('、') || '未知'}。`,
                closureKind: 'replan',
                recommendedStrategies: [
                    '保持素材但重新规划区域比例或改用 contain',
                    '由 Agent 显式选择更合适的锚点或关注点',
                    '选择与目标区域比例更匹配的素材'
                ]
            });
        } else if (cropPolicy === 'avoid-crop' && cropPolicySatisfied === false) {
            findings.push({
                code: 'frame_crop_violates_policy',
                severity: 'repair',
                blockId: block.id,
                role: block.role,
                layerId: input.layerId,
                message: `图片块「${block.id}」声明 avoid-crop，但实际图框仅有约 `
                    + `${Math.round(frameVisibleRatio * 100)}% 可见，被裁边：${clippedFrame.join('、') || '未知'}。`,
                closureKind: 'replan',
                recommendedStrategies: [
                    '改用不会裁图框的 contain 区域关系',
                    '重新规划目标区域比例',
                    '若确实需要裁切，由 Agent 明确改写裁切意图后再看真实画面'
                ]
            });
        } else if (cropPolicy === 'protect-subject'
            && cropPolicySatisfied === 'unknown'
            && frameIsCropped) {
            findings.push({
                code: 'crop_intent_unverified',
                severity: 'review',
                blockId: block.id,
                role: block.role,
                layerId: input.layerId,
                message: `图片块「${block.id}」声明保护主体，图框仅有约 `
                    + `${Math.round(frameVisibleRatio * 100)}% 可见，但主体检测证据不足，不能确认主体是否被误裁。`,
                closureKind: 'visual',
                recommendedStrategies: [
                    '查看该图片区域的同版本局部快照并判断主体完整性',
                    '需要精确调整时，由 Agent 明确主体占比与锚点后调用 fitLayerSubjectToRegion'
                ]
            });
        } else if (cropPolicy === 'allow-crop' && frameIsCropped) {
            findings.push({
                code: 'intentional_crop_requires_visual_review',
                severity: 'review',
                blockId: block.id,
                role: block.role,
                layerId: input.layerId,
                message: `图片块「${block.id}」允许有意裁切，当前图框约有 `
                    + `${Math.round((1 - frameVisibleRatio) * 100)}% 位于裁切区域外；几何执行有效，但构图好坏必须看真实画面。`,
                closureKind: 'visual'
            });
        } else if (!cropPolicy && frameIsCropped) {
            findings.push({
                code: 'crop_intent_unverified',
                severity: 'review',
                blockId: block.id,
                role: block.role,
                layerId: input.layerId,
                message: `图片块「${block.id}」发生了约 `
                    + `${Math.round((1 - frameVisibleRatio) * 100)}% 的图框裁切，但没有可核验的裁切意图。`,
                closureKind: 'replan',
                recommendedStrategies: ['由 Agent 明确保护主体、避免裁切或允许有意裁切的设计意图']
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
    const subjectFitStatus = String(input.subjectFitVerification?.status || '');
    if (subjectFitStatus === 'failed' || subjectFitStatus === 'needs_review') {
        const subjectFitWarnings = Array.isArray(input.subjectFitVerification?.warnings)
            ? input.subjectFitVerification.warnings.map((item) => String(item)).filter(Boolean)
            : [];
        findings.push({
            code: 'subject_fit_verification_failed',
            severity: subjectFitStatus === 'failed' ? 'repair' : 'review',
            blockId: block.id,
            role: block.role,
            layerId: input.layerId,
            message: `图片块「${block.id}」主体感知落位的写后几何状态为 ${subjectFitStatus}`
                + `${subjectFitWarnings.length ? `：${subjectFitWarnings.join('；')}` : '，尚不能确认达到 Agent 声明的主体占比与锚点'}。`,
            closureKind: subjectFitStatus === 'failed' ? 'mutation' : 'visual',
            recommendedStrategies: [
                '基于同一 layerId 的写后主体与图框收据修正一次',
                '若主体检测证据不足，查看局部真实画面后重新声明占比或锚点'
            ]
        });
    }
    const executionPlacement = input.executionPlacement
        && typeof input.executionPlacement === 'object'
        && !Array.isArray(input.executionPlacement)
        ? input.executionPlacement as Record<string, unknown>
        : undefined;
    if (placement?.focalPoint && executionPlacement?.focalPointClamped === true) {
        const deviation = Number(executionPlacement.focalDeviationPx);
        findings.push({
            code: 'focal_point_clamped',
            severity: 'review',
            blockId: block.id,
            role: block.role,
            layerId: input.layerId,
            message: `图片块「${block.id}」的关注点参与了落位，但受 contain/cover 边界约束未能完全对准目标中心`
                + `${Number.isFinite(deviation) ? `，偏差约 ${Math.round(deviation)}px` : ''}；几何执行正确不等于焦点构图意图已兑现。`,
            closureKind: 'visual',
            recommendedStrategies: [
                '查看该区域真实画面，判断当前偏差是否仍服务构图',
                '若焦点必须精确到位，调整区域比例、换素材或重新声明关注点'
            ]
        });
    } else if (placement?.focalPoint && !executionPlacement) {
        findings.push({
            code: 'focal_point_unverified',
            severity: 'review',
            blockId: block.id,
            role: block.role,
            layerId: input.layerId,
            message: `图片块「${block.id}」声明了 focalPoint，但执行结果缺少 UXP placement 收据，不能证明关注点语义已经兑现。`,
            closureKind: 'observation'
        });
    }
    let normalizedSubjectFitVerification: ImagePlacementQualityReceipt['subjectFitVerification'];
    if (subjectFitStatus === 'passed'
        || subjectFitStatus === 'needs_review'
        || subjectFitStatus === 'failed') {
        const warnings = Array.isArray(input.subjectFitVerification?.warnings)
            ? input.subjectFitVerification.warnings.map((item) => String(item)).filter(Boolean)
            : [];
        normalizedSubjectFitVerification = {
            status: subjectFitStatus,
            ...(warnings.length > 0 ? { warnings } : {})
        };
    }
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
        cropPolicy,
        targetBounds,
        actualBounds,
        metrics,
        cropFacts,
        subjectFitVerification: normalizedSubjectFitVerification,
        executionPlacement,
        clippingApplied: input.clippingApplied === true,
        qualityState: resolveQualityState(findings),
        findings
    };
}
