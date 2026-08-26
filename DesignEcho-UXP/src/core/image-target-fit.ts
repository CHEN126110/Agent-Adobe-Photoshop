/**
 * 图片图框适配的纯几何内核。
 *
 * 本模块不访问 Photoshop，也不替设计者选择裁切方式、锚点或关注点。调用方提供
 * 明确的构图意图，本模块只负责校验参数、计算缩放/落位并描述可验证的区域关系事实。
 */

export type ImageTargetFit = 'contain' | 'cover' | 'fill';

export type ImageTargetAnchor =
    | 'center'
    | 'top-center'
    | 'bottom-center'
    | 'left-center'
    | 'right-center';

export interface ImageTargetBoundsParam {
    x?: number | string | null;
    y?: number | string | null;
    left?: number | string | null;
    top?: number | string | null;
    right?: number | string | null;
    bottom?: number | string | null;
    width?: number | string | null;
    height?: number | string | null;
}

export interface ImageTargetRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

export interface ImageTargetFocalPoint {
    x: number;
    y: number;
}

export interface ImageTargetFitRequest {
    sourceBounds: ImageTargetRect;
    targetBounds: ImageTargetRect;
    fit?: ImageTargetFit;
    targetAnchor?: ImageTargetAnchor;
    focalPoint?: ImageTargetFocalPoint;
}

export interface ImageTargetFitPlan {
    fit: ImageTargetFit;
    requestedAnchor: ImageTargetAnchor;
    effectiveAlignment: 'anchor' | 'focal-point' | 'fill-exact';
    /** true 只表示关注点参与了求解，不保证它最终能与目标中心重合。 */
    focalPointApplied: boolean;
    /** true 表示关注点参与了求解，但为满足 contain/cover 边界约束而未能对准目标中心。 */
    focalPointClamped: boolean;
    focalPoint?: ImageTargetFocalPoint;
    sourceBounds: ImageTargetRect;
    targetBounds: ImageTargetRect;
    widthPercent: number;
    heightPercent: number;
    expectedBounds: ImageTargetRect;
}

export interface ImageTargetFitOutcome extends ImageTargetFitPlan {
    actualBounds: ImageTargetRect;
    targetCoverageRatio: number;
    /** 图框面积中位于 targetBounds 内的比例；不代表 Photoshop 已应用裁切。 */
    insideTargetRatio: number;
    /** 图框面积中位于 targetBounds 外的比例；只有上层确认裁切已应用后才能解释成裁切比例。 */
    outsideTargetFraction: number;
    /** 图框越过 targetBounds 的边；不代表这些像素已被裁掉。 */
    outsideTargetEdges: Array<'left' | 'top' | 'right' | 'bottom'>;
    /** 写后真实图框中的关注点像素坐标；仅 focalPoint 存在时返回。 */
    actualFocalPosition?: { x: number; y: number };
    /** 关注点希望对准的目标框中心像素坐标；仅 focalPoint 存在时返回。 */
    targetFocalPosition?: { x: number; y: number };
    /** 写后真实关注点到目标中心的欧氏距离；0 表示完全兑现，仅 focalPoint 存在时返回。 */
    focalDeviationPx?: number;
    /** 只验证缩放、落位和边界算法；不代表关注点意图完全兑现或画面审美合格。 */
    geometryVerification: {
        verified: boolean;
        issues: string[];
    };
}

const SUPPORTED_FITS: readonly ImageTargetFit[] = ['contain', 'cover', 'fill'];
const SUPPORTED_ANCHORS: readonly ImageTargetAnchor[] = [
    'center',
    'top-center',
    'bottom-center',
    'left-center',
    'right-center'
];
const GEOMETRY_EPSILON = 0.01;
const FOCAL_ALIGNMENT_EPSILON = 0.01;

function toFiniteNumber(value: unknown): number | undefined {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed === '') return undefined;
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

function assertPositiveRect(value: ImageTargetRect, label: string): void {
    const values = [value.left, value.top, value.width, value.height];
    if (!values.every(Number.isFinite) || value.width <= 0 || value.height <= 0) {
        throw new Error(`${label} 必须包含有限的 left/top 和大于 0 的 width/height。`);
    }
}

function resolveFit(value: ImageTargetFit | undefined): ImageTargetFit {
    if (value === undefined) return 'contain';
    if (!SUPPORTED_FITS.includes(value)) {
        throw new Error(`targetFit 不支持“${String(value)}”；只允许 contain、cover 或 fill。`);
    }
    return value;
}

function resolveAnchor(value: ImageTargetAnchor | undefined): ImageTargetAnchor {
    if (value === undefined) return 'center';
    if (!SUPPORTED_ANCHORS.includes(value)) {
        throw new Error(
            `targetAnchor 不支持“${String(value)}”；只允许 ${SUPPORTED_ANCHORS.join('、')}。`
        );
    }
    return value;
}

function resolveFocalPoint(
    value: ImageTargetFocalPoint | undefined
): ImageTargetFocalPoint | undefined {
    if (value === undefined) return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('focalPoint 必须是包含归一化 x/y 的对象。');
    }
    const x = value.x;
    const y = value.y;
    if (typeof x !== 'number' || typeof y !== 'number'
        || !Number.isFinite(x) || !Number.isFinite(y)
        || x < 0 || x > 1 || y < 0 || y > 1) {
        throw new Error('focalPoint.x/y 必须是 0 到 1 之间的有限数值。');
    }
    return { x, y };
}

function assertAlignmentApplicable(
    fit: ImageTargetFit,
    anchor: ImageTargetAnchor,
    focalPoint: ImageTargetFocalPoint | undefined
): void {
    if (fit !== 'fill') return;
    if (focalPoint) {
        throw new Error('targetFit=fill 会把图层精确拉伸到目标框，不能同时使用 focalPoint。');
    }
    if (anchor !== 'center') {
        throw new Error('targetFit=fill 会把图层精确拉伸到目标框，不能同时使用非 center 的 targetAnchor。');
    }
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(Math.max(value, minimum), maximum);
}

function resolveAxisPosition(input: {
    targetStart: number;
    targetSize: number;
    sourceSize: number;
    anchorRatio: number;
    focalRatio?: number;
}): number {
    const minimum = input.targetStart;
    const maximum = input.targetStart + input.targetSize - input.sourceSize;
    const lowerBound = Math.min(minimum, maximum);
    const upperBound = Math.max(minimum, maximum);

    if (input.focalRatio !== undefined) {
        const centeredFocalPosition = input.targetStart + input.targetSize / 2
            - input.sourceSize * input.focalRatio;
        return clamp(centeredFocalPosition, lowerBound, upperBound);
    }

    return input.targetStart + (input.targetSize - input.sourceSize) * input.anchorRatio;
}

function getAnchorRatios(anchor: ImageTargetAnchor): { x: number; y: number } {
    switch (anchor) {
        case 'top-center':
            return { x: 0.5, y: 0 };
        case 'bottom-center':
            return { x: 0.5, y: 1 };
        case 'left-center':
            return { x: 0, y: 0.5 };
        case 'right-center':
            return { x: 1, y: 0.5 };
        case 'center':
            return { x: 0.5, y: 0.5 };
    }
}

function resolveEffectiveAlignment(
    fit: ImageTargetFit,
    focalPoint: ImageTargetFocalPoint | undefined
): ImageTargetFitPlan['effectiveAlignment'] {
    if (fit === 'fill') return 'fill-exact';
    if (focalPoint) return 'focal-point';
    return 'anchor';
}

function intersectArea(left: ImageTargetRect, right: ImageTargetRect): number {
    const intersectionWidth = Math.max(
        0,
        Math.min(left.left + left.width, right.left + right.width)
            - Math.max(left.left, right.left)
    );
    const intersectionHeight = Math.max(
        0,
        Math.min(left.top + left.height, right.top + right.height)
            - Math.max(left.top, right.top)
    );
    return intersectionWidth * intersectionHeight;
}

function resolveRectCenter(rect: ImageTargetRect): { x: number; y: number } {
    return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
    };
}

function resolveFocalPosition(
    bounds: ImageTargetRect,
    focalPoint: ImageTargetFocalPoint
): { x: number; y: number } {
    return {
        x: bounds.left + bounds.width * focalPoint.x,
        y: bounds.top + bounds.height * focalPoint.y
    };
}

function pointDistance(
    left: { x: number; y: number },
    right: { x: number; y: number }
): number {
    return Math.hypot(left.x - right.x, left.y - right.y);
}

function wasFocalPointClamped(
    focalPoint: ImageTargetFocalPoint | undefined,
    expectedBounds: ImageTargetRect,
    targetBounds: ImageTargetRect
): boolean {
    if (!focalPoint) return false;
    const expectedFocalPosition = resolveFocalPosition(expectedBounds, focalPoint);
    const targetFocalPosition = resolveRectCenter(targetBounds);
    return pointDistance(expectedFocalPosition, targetFocalPosition)
        > FOCAL_ALIGNMENT_EPSILON;
}

function closeEnough(actual: number, expected: number, tolerance: number): boolean {
    return Math.abs(actual - expected) <= tolerance;
}

function buildGeometryVerification(input: {
    fit: ImageTargetFit;
    expectedBounds: ImageTargetRect;
    actualBounds: ImageTargetRect;
    targetBounds: ImageTargetRect;
    targetCoverageRatio: number;
    insideTargetRatio: number;
}): ImageTargetFitOutcome['geometryVerification'] {
    const issues: string[] = [];
    const positionTolerance = Math.max(
        1,
        Math.max(input.targetBounds.width, input.targetBounds.height) * 0.002
    );
    const sizeTolerance = positionTolerance;
    if (!closeEnough(input.actualBounds.left, input.expectedBounds.left, positionTolerance)
        || !closeEnough(input.actualBounds.top, input.expectedBounds.top, positionTolerance)) {
        issues.push('position_mismatch');
    }

    if (input.fit === 'fill') {
        if (!closeEnough(input.actualBounds.width, input.targetBounds.width, sizeTolerance)
            || !closeEnough(input.actualBounds.height, input.targetBounds.height, sizeTolerance)) {
            issues.push('fill_size_mismatch');
        }
    } else {
        const reachesOneTargetAxis = closeEnough(
            input.actualBounds.width,
            input.targetBounds.width,
            sizeTolerance
        ) || closeEnough(
            input.actualBounds.height,
            input.targetBounds.height,
            sizeTolerance
        );
        if (!reachesOneTargetAxis) issues.push('fit_scale_mismatch');
    }

    if (input.fit === 'cover' && input.targetCoverageRatio < 0.995) {
        issues.push('cover_has_gap');
    }
    if (input.fit === 'contain' && input.insideTargetRatio < 0.995) {
        issues.push('contain_overflows_target');
    }

    return {
        verified: issues.length === 0,
        issues
    };
}

export function normalizeImageTargetBounds(
    value: ImageTargetBoundsParam | undefined
): ImageTargetRect | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const left = toFiniteNumber(value.left) ?? toFiniteNumber(value.x);
    const top = toFiniteNumber(value.top) ?? toFiniteNumber(value.y);
    const width = toFiniteNumber(value.width);
    const height = toFiniteNumber(value.height);
    const right = toFiniteNumber(value.right);
    const bottom = toFiniteNumber(value.bottom);
    const resolvedWidth = width
        ?? (right !== undefined && left !== undefined ? right - left : undefined);
    const resolvedHeight = height
        ?? (bottom !== undefined && top !== undefined ? bottom - top : undefined);
    if (left === undefined || top === undefined
        || resolvedWidth === undefined || resolvedHeight === undefined
        || resolvedWidth <= 0 || resolvedHeight <= 0) {
        return null;
    }
    return { left, top, width: resolvedWidth, height: resolvedHeight };
}

export function resolveImageTargetFitPlan(
    input: ImageTargetFitRequest
): ImageTargetFitPlan {
    assertPositiveRect(input.sourceBounds, 'sourceBounds');
    assertPositiveRect(input.targetBounds, 'targetBounds');
    const fit = resolveFit(input.fit);
    const requestedAnchor = resolveAnchor(input.targetAnchor);
    const focalPoint = resolveFocalPoint(input.focalPoint);
    assertAlignmentApplicable(fit, requestedAnchor, focalPoint);
    const widthRatio = input.targetBounds.width / input.sourceBounds.width;
    const heightRatio = input.targetBounds.height / input.sourceBounds.height;
    const uniformRatio = fit === 'cover'
        ? Math.max(widthRatio, heightRatio)
        : Math.min(widthRatio, heightRatio);
    const widthScaleRatio = fit === 'fill' ? widthRatio : uniformRatio;
    const heightScaleRatio = fit === 'fill' ? heightRatio : uniformRatio;
    const scaledWidth = input.sourceBounds.width * widthScaleRatio;
    const scaledHeight = input.sourceBounds.height * heightScaleRatio;
    const expectedBounds = resolveImageTargetAlignmentBounds({
        sourceBounds: {
            left: input.sourceBounds.left,
            top: input.sourceBounds.top,
            width: scaledWidth,
            height: scaledHeight
        },
        targetBounds: input.targetBounds,
        fit,
        targetAnchor: requestedAnchor,
        focalPoint
    });

    return {
        fit,
        requestedAnchor,
        effectiveAlignment: resolveEffectiveAlignment(fit, focalPoint),
        focalPointApplied: fit !== 'fill' && Boolean(focalPoint),
        focalPointClamped: wasFocalPointClamped(
            focalPoint,
            expectedBounds,
            input.targetBounds
        ),
        ...(focalPoint ? { focalPoint } : {}),
        sourceBounds: { ...input.sourceBounds },
        targetBounds: { ...input.targetBounds },
        widthPercent: widthScaleRatio * 100,
        heightPercent: heightScaleRatio * 100,
        expectedBounds
    };
}

/**
 * 为已经完成缩放的图层计算最终落位。focalPoint 存在时优先于 targetAnchor：
 * 尝试把源图关注点放到目标中心，并夹紧到 contain 不越界 / cover 不露空的范围。
 */
export function resolveImageTargetAlignmentBounds(
    input: ImageTargetFitRequest
): ImageTargetRect {
    assertPositiveRect(input.sourceBounds, 'sourceBounds');
    assertPositiveRect(input.targetBounds, 'targetBounds');
    const fit = resolveFit(input.fit);
    const targetAnchor = resolveAnchor(input.targetAnchor);
    const focalPoint = resolveFocalPoint(input.focalPoint);
    assertAlignmentApplicable(fit, targetAnchor, focalPoint);
    const anchorRatios = getAnchorRatios(targetAnchor);
    const left = fit === 'fill'
        ? input.targetBounds.left
        : resolveAxisPosition({
            targetStart: input.targetBounds.left,
            targetSize: input.targetBounds.width,
            sourceSize: input.sourceBounds.width,
            anchorRatio: anchorRatios.x,
            ...(focalPoint ? { focalRatio: focalPoint.x } : {})
        });
    const top = fit === 'fill'
        ? input.targetBounds.top
        : resolveAxisPosition({
            targetStart: input.targetBounds.top,
            targetSize: input.targetBounds.height,
            sourceSize: input.sourceBounds.height,
            anchorRatio: anchorRatios.y,
            ...(focalPoint ? { focalRatio: focalPoint.y } : {})
        });
    return {
        left,
        top,
        width: input.sourceBounds.width,
        height: input.sourceBounds.height
    };
}

export function measureImageTargetFitOutcome(
    plan: ImageTargetFitPlan,
    actualBounds: ImageTargetRect
): ImageTargetFitOutcome {
    assertPositiveRect(actualBounds, 'actualBounds');
    const intersection = intersectArea(actualBounds, plan.targetBounds);
    const targetArea = plan.targetBounds.width * plan.targetBounds.height;
    const frameArea = actualBounds.width * actualBounds.height;
    const targetRight = plan.targetBounds.left + plan.targetBounds.width;
    const targetBottom = plan.targetBounds.top + plan.targetBounds.height;
    const actualRight = actualBounds.left + actualBounds.width;
    const actualBottom = actualBounds.top + actualBounds.height;
    const outsideTargetEdges: ImageTargetFitOutcome['outsideTargetEdges'] = [];
    if (actualBounds.left < plan.targetBounds.left - GEOMETRY_EPSILON) {
        outsideTargetEdges.push('left');
    }
    if (actualBounds.top < plan.targetBounds.top - GEOMETRY_EPSILON) {
        outsideTargetEdges.push('top');
    }
    if (actualRight > targetRight + GEOMETRY_EPSILON) outsideTargetEdges.push('right');
    if (actualBottom > targetBottom + GEOMETRY_EPSILON) outsideTargetEdges.push('bottom');
    const insideTargetRatio = clamp(intersection / frameArea, 0, 1);
    const targetCoverageRatio = clamp(intersection / targetArea, 0, 1);
    const actualFocalPosition = plan.focalPoint
        ? resolveFocalPosition(actualBounds, plan.focalPoint)
        : undefined;
    const targetFocalPosition = plan.focalPoint
        ? resolveRectCenter(plan.targetBounds)
        : undefined;
    const focalDeviationPx = actualFocalPosition && targetFocalPosition
        ? pointDistance(actualFocalPosition, targetFocalPosition)
        : undefined;

    return {
        ...plan,
        actualBounds: { ...actualBounds },
        targetCoverageRatio,
        insideTargetRatio,
        outsideTargetFraction: clamp(1 - insideTargetRatio, 0, 1),
        outsideTargetEdges,
        ...(actualFocalPosition ? { actualFocalPosition } : {}),
        ...(targetFocalPosition ? { targetFocalPosition } : {}),
        ...(focalDeviationPx !== undefined ? { focalDeviationPx } : {}),
        geometryVerification: buildGeometryVerification({
            fit: plan.fit,
            expectedBounds: plan.expectedBounds,
            actualBounds,
            targetBounds: plan.targetBounds,
            targetCoverageRatio,
            insideTargetRatio
        })
    };
}
