/**
 * 图片写入前的纯几何预览。
 *
 * 本模块不访问 Photoshop、不选择 fit/anchor/focalPoint，也不输出审美结论。
 * 调用方必须显式给出设计语义；这里仅按 UXP image-target-fit 的坐标规则计算
 * 计划图框、目标框内外关系、关注点夹取偏差，以及可选主体框的目标内可见比例。
 */

export type ImagePlacementPreviewFit = 'contain' | 'cover' | 'fill';

export type ImagePlacementPreviewAnchor =
    | 'center'
    | 'top-center'
    | 'bottom-center'
    | 'left-center'
    | 'right-center';

export type ImagePlacementPreviewEdge = 'left' | 'top' | 'right' | 'bottom';

export interface ImagePlacementPreviewSize {
    width: number;
    height: number;
}

export interface ImagePlacementPreviewBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** 源图内的归一化坐标，x/y/width/height 均以源图宽高为 1。 */
export interface ImagePlacementPreviewSubjectBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** 源图中的归一化关注点。 */
export interface ImagePlacementPreviewFocalPoint {
    x: number;
    y: number;
}

export interface ImagePlacementPreviewInput {
    source: ImagePlacementPreviewSize;
    targetBounds: ImagePlacementPreviewBounds;
    /** 必须由 Agent 显式声明；预览层不提供默认适配方式。 */
    fit: ImagePlacementPreviewFit;
    /** 必须由 Agent 显式声明；focalPoint 存在时关注点优先于 anchor。 */
    anchor: ImagePlacementPreviewAnchor;
    focalPoint?: ImagePlacementPreviewFocalPoint;
    /** 可选的源图归一化主体框；缺失时不推断主体。 */
    subjectBox?: ImagePlacementPreviewSubjectBox;
}

export interface ImagePlacementPreviewIssue {
    path: string;
    code: string;
    message: string;
}

export interface ImagePlacementPreviewAreaFacts {
    bounds?: ImagePlacementPreviewBounds;
    area: number;
    /** 相交面积占计划图框面积的比例。 */
    frameRatio: number;
    /** 相交面积占目标区域面积的比例。 */
    targetRatio: number;
}

export interface ImagePlacementPreviewOverflowFacts {
    area: number;
    /** 计划图框面积中位于目标区域外的比例。 */
    frameRatio: number;
    edges: ImagePlacementPreviewEdge[];
    distance: Record<ImagePlacementPreviewEdge, number>;
}

export interface ImagePlacementPreviewFocalFacts {
    requested: ImagePlacementPreviewFocalPoint;
    desiredBounds: ImagePlacementPreviewBounds;
    plannedPosition: { x: number; y: number };
    targetPosition: { x: number; y: number };
    /** true 只表示为遵守 contain/cover 的无溢出/无露空边界而夹取了计划位置。 */
    clamped: boolean;
    deviation: {
        x: number;
        y: number;
        distance: number;
    };
}

export interface ImagePlacementPreviewSubjectFacts {
    sourceNormalizedBounds: ImagePlacementPreviewSubjectBox;
    plannedBounds: ImagePlacementPreviewBounds;
    insideTargetBounds?: ImagePlacementPreviewBounds;
    /** 主体投影面积中位于 targetBounds 内的比例；不证明 Photoshop 已实际应用裁切。 */
    visibleRatio: number;
    clippedEdges: ImagePlacementPreviewEdge[];
    outsideDistance: Record<ImagePlacementPreviewEdge, number>;
}

export interface ImagePlacementPreview {
    version: 'image-placement-preview/v1';
    fit: ImagePlacementPreviewFit;
    requestedAnchor: ImagePlacementPreviewAnchor;
    effectiveAlignment: 'anchor' | 'focal-point' | 'fill-exact';
    source: ImagePlacementPreviewSize;
    targetBounds: ImagePlacementPreviewBounds;
    plannedBounds: ImagePlacementPreviewBounds;
    scale: {
        x: number;
        y: number;
        xPercent: number;
        yPercent: number;
    };
    insideTarget: ImagePlacementPreviewAreaFacts;
    outsideTarget: ImagePlacementPreviewOverflowFacts;
    focalPoint?: ImagePlacementPreviewFocalFacts;
    subject?: ImagePlacementPreviewSubjectFacts;
    boundaries: {
        factsOnly: true;
        clippingNotProven: true;
        noAestheticVerdict: true;
        noHiddenThresholds: true;
    };
}

export type ImagePlacementPreviewResult =
    | { ok: true; preview: ImagePlacementPreview }
    | { ok: false; issues: ImagePlacementPreviewIssue[] };

interface AxisPlacement {
    position: number;
    desiredPosition: number;
    clamped: boolean;
}

interface BoundsIntersection {
    bounds?: ImagePlacementPreviewBounds;
    area: number;
}

const SUPPORTED_FITS: readonly ImagePlacementPreviewFit[] = ['contain', 'cover', 'fill'];
const SUPPORTED_ANCHORS: readonly ImagePlacementPreviewAnchor[] = [
    'center',
    'top-center',
    'bottom-center',
    'left-center',
    'right-center'
];

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveNumber(value: unknown): value is number {
    return isFiniteNumber(value) && value > 0;
}

function boundsArea(bounds: ImagePlacementPreviewBounds): number {
    return bounds.width * bounds.height;
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(Math.max(value, minimum), maximum);
}

function appendInputIssues(
    input: ImagePlacementPreviewInput,
    issues: ImagePlacementPreviewIssue[]
): void {
    if (!isPositiveNumber(input.source?.width) || !isPositiveNumber(input.source?.height)) {
        issues.push({
            path: 'source',
            code: 'positive_source_size_required',
            message: 'source.width/height 必须是大于 0 的有限数值。'
        });
    }

    const target = input.targetBounds;
    if (!target
        || !isFiniteNumber(target.x)
        || !isFiniteNumber(target.y)
        || !isPositiveNumber(target.width)
        || !isPositiveNumber(target.height)) {
        issues.push({
            path: 'targetBounds',
            code: 'positive_target_bounds_required',
            message: 'targetBounds 需要有限的 x/y 和大于 0 的 width/height。'
        });
    }

    if (!SUPPORTED_FITS.includes(input.fit)) {
        issues.push({
            path: 'fit',
            code: 'explicit_supported_fit_required',
            message: 'fit 必须显式为 contain、cover 或 fill。'
        });
    }
    if (!SUPPORTED_ANCHORS.includes(input.anchor)) {
        issues.push({
            path: 'anchor',
            code: 'explicit_supported_anchor_required',
            message: `anchor 必须显式为 ${SUPPORTED_ANCHORS.join('、')}。`
        });
    }

    const focalPoint = input.focalPoint;
    if (focalPoint !== undefined
        && (!isFiniteNumber(focalPoint?.x)
            || !isFiniteNumber(focalPoint?.y)
            || focalPoint.x < 0
            || focalPoint.x > 1
            || focalPoint.y < 0
            || focalPoint.y > 1)) {
        issues.push({
            path: 'focalPoint',
            code: 'normalized_focal_point_required',
            message: 'focalPoint.x/y 必须是 0 到 1 之间的有限数值。'
        });
    }

    if (input.fit === 'fill' && input.anchor !== 'center') {
        issues.push({
            path: 'anchor',
            code: 'fill_requires_center_anchor',
            message: 'fill 会把图框精确拉伸到目标区域，只接受 center anchor。'
        });
    }
    if (input.fit === 'fill' && focalPoint !== undefined) {
        issues.push({
            path: 'focalPoint',
            code: 'fill_rejects_focal_point',
            message: 'fill 会把图框精确拉伸到目标区域，不能同时声明 focalPoint。'
        });
    }

    const subject = input.subjectBox;
    if (subject !== undefined
        && (!isFiniteNumber(subject?.x)
            || !isFiniteNumber(subject?.y)
            || !isPositiveNumber(subject?.width)
            || !isPositiveNumber(subject?.height)
            || subject.x < 0
            || subject.y < 0
            || subject.x + subject.width > 1
            || subject.y + subject.height > 1)) {
        issues.push({
            path: 'subjectBox',
            code: 'normalized_subject_box_required',
            message: 'subjectBox 必须是完整位于源图 0..1 范围内的归一化正矩形。'
        });
    }
}

function anchorRatios(anchor: ImagePlacementPreviewAnchor): { x: number; y: number } {
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

function resolveAxisPlacement(input: {
    targetStart: number;
    targetSize: number;
    frameSize: number;
    anchorRatio: number;
    focalRatio?: number;
}): AxisPlacement {
    if (input.focalRatio === undefined) {
        const position = input.targetStart
            + (input.targetSize - input.frameSize) * input.anchorRatio;
        return { position, desiredPosition: position, clamped: false };
    }

    const desiredPosition = input.targetStart + input.targetSize / 2
        - input.frameSize * input.focalRatio;
    const firstBoundary = input.targetStart;
    const secondBoundary = input.targetStart + input.targetSize - input.frameSize;
    const minimum = Math.min(firstBoundary, secondBoundary);
    const maximum = Math.max(firstBoundary, secondBoundary);
    const position = clamp(desiredPosition, minimum, maximum);
    return {
        position,
        desiredPosition,
        clamped: position !== desiredPosition
    };
}

function intersectBounds(
    left: ImagePlacementPreviewBounds,
    right: ImagePlacementPreviewBounds
): BoundsIntersection {
    const x = Math.max(left.x, right.x);
    const y = Math.max(left.y, right.y);
    const intersectionRight = Math.min(left.x + left.width, right.x + right.width);
    const intersectionBottom = Math.min(left.y + left.height, right.y + right.height);
    const width = Math.max(0, intersectionRight - x);
    const height = Math.max(0, intersectionBottom - y);
    if (width === 0 || height === 0) return { area: 0 };
    const bounds = { x, y, width, height };
    return { bounds, area: boundsArea(bounds) };
}

function overflowDistances(
    bounds: ImagePlacementPreviewBounds,
    target: ImagePlacementPreviewBounds
): Record<ImagePlacementPreviewEdge, number> {
    return {
        left: Math.max(0, target.x - bounds.x),
        top: Math.max(0, target.y - bounds.y),
        right: Math.max(0, bounds.x + bounds.width - (target.x + target.width)),
        bottom: Math.max(0, bounds.y + bounds.height - (target.y + target.height))
    };
}

function overflowEdges(
    distance: Record<ImagePlacementPreviewEdge, number>
): ImagePlacementPreviewEdge[] {
    const edges: ImagePlacementPreviewEdge[] = [];
    if (distance.left > 0) edges.push('left');
    if (distance.top > 0) edges.push('top');
    if (distance.right > 0) edges.push('right');
    if (distance.bottom > 0) edges.push('bottom');
    return edges;
}

function projectNormalizedSubjectBox(
    subject: ImagePlacementPreviewSubjectBox,
    planned: ImagePlacementPreviewBounds
): ImagePlacementPreviewBounds {
    return {
        x: planned.x + planned.width * subject.x,
        y: planned.y + planned.height * subject.y,
        width: planned.width * subject.width,
        height: planned.height * subject.height
    };
}

function buildFocalFacts(input: {
    focalPoint?: ImagePlacementPreviewFocalPoint;
    xPlacement: AxisPlacement;
    yPlacement: AxisPlacement;
    plannedBounds: ImagePlacementPreviewBounds;
    targetBounds: ImagePlacementPreviewBounds;
}): ImagePlacementPreviewFocalFacts | undefined {
    const focalPoint = input.focalPoint;
    if (!focalPoint) return undefined;
    const plannedPosition = {
        x: input.plannedBounds.x + input.plannedBounds.width * focalPoint.x,
        y: input.plannedBounds.y + input.plannedBounds.height * focalPoint.y
    };
    const targetPosition = {
        x: input.targetBounds.x + input.targetBounds.width / 2,
        y: input.targetBounds.y + input.targetBounds.height / 2
    };
    const deviationX = plannedPosition.x - targetPosition.x;
    const deviationY = plannedPosition.y - targetPosition.y;
    return {
        requested: { ...focalPoint },
        desiredBounds: {
            x: input.xPlacement.desiredPosition,
            y: input.yPlacement.desiredPosition,
            width: input.plannedBounds.width,
            height: input.plannedBounds.height
        },
        plannedPosition,
        targetPosition,
        clamped: input.xPlacement.clamped || input.yPlacement.clamped,
        deviation: {
            x: deviationX,
            y: deviationY,
            distance: Math.hypot(deviationX, deviationY)
        }
    };
}

function buildSubjectFacts(
    subject: ImagePlacementPreviewSubjectBox | undefined,
    plannedBounds: ImagePlacementPreviewBounds,
    targetBounds: ImagePlacementPreviewBounds
): ImagePlacementPreviewSubjectFacts | undefined {
    if (!subject) return undefined;
    const subjectBounds = projectNormalizedSubjectBox(subject, plannedBounds);
    const inside = intersectBounds(subjectBounds, targetBounds);
    const distance = overflowDistances(subjectBounds, targetBounds);
    return {
        sourceNormalizedBounds: { ...subject },
        plannedBounds: subjectBounds,
        ...(inside.bounds ? { insideTargetBounds: inside.bounds } : {}),
        visibleRatio: clamp(inside.area / boundsArea(subjectBounds), 0, 1),
        clippedEdges: overflowEdges(distance),
        outsideDistance: distance
    };
}

function resolveEffectiveAlignment(
    input: ImagePlacementPreviewInput
): ImagePlacementPreview['effectiveAlignment'] {
    if (input.fit === 'fill') return 'fill-exact';
    if (input.focalPoint) return 'focal-point';
    return 'anchor';
}

export function previewImagePlacement(
    input: ImagePlacementPreviewInput
): ImagePlacementPreviewResult {
    const issues: ImagePlacementPreviewIssue[] = [];
    appendInputIssues(input, issues);
    if (issues.length > 0) return { ok: false, issues };

    const widthRatio = input.targetBounds.width / input.source.width;
    const heightRatio = input.targetBounds.height / input.source.height;
    const uniformRatio = input.fit === 'cover'
        ? Math.max(widthRatio, heightRatio)
        : Math.min(widthRatio, heightRatio);
    const scaleX = input.fit === 'fill' ? widthRatio : uniformRatio;
    const scaleY = input.fit === 'fill' ? heightRatio : uniformRatio;
    const plannedWidth = input.source.width * scaleX;
    const plannedHeight = input.source.height * scaleY;
    const ratios = anchorRatios(input.anchor);
    const xPlacement = resolveAxisPlacement({
        targetStart: input.targetBounds.x,
        targetSize: input.targetBounds.width,
        frameSize: plannedWidth,
        anchorRatio: ratios.x,
        ...(input.focalPoint ? { focalRatio: input.focalPoint.x } : {})
    });
    const yPlacement = resolveAxisPlacement({
        targetStart: input.targetBounds.y,
        targetSize: input.targetBounds.height,
        frameSize: plannedHeight,
        anchorRatio: ratios.y,
        ...(input.focalPoint ? { focalRatio: input.focalPoint.y } : {})
    });
    const plannedBounds: ImagePlacementPreviewBounds = {
        x: xPlacement.position,
        y: yPlacement.position,
        width: plannedWidth,
        height: plannedHeight
    };
    const inside = intersectBounds(plannedBounds, input.targetBounds);
    const frameArea = boundsArea(plannedBounds);
    const targetArea = boundsArea(input.targetBounds);
    const insideArea = clamp(inside.area, 0, frameArea);
    const outsideArea = clamp(frameArea - insideArea, 0, frameArea);
    const distance = overflowDistances(plannedBounds, input.targetBounds);
    const focalPoint = buildFocalFacts({
        focalPoint: input.focalPoint,
        xPlacement,
        yPlacement,
        plannedBounds,
        targetBounds: input.targetBounds
    });
    const subject = buildSubjectFacts(
        input.subjectBox,
        plannedBounds,
        input.targetBounds
    );

    return {
        ok: true,
        preview: {
            version: 'image-placement-preview/v1',
            fit: input.fit,
            requestedAnchor: input.anchor,
            effectiveAlignment: resolveEffectiveAlignment(input),
            source: { ...input.source },
            targetBounds: { ...input.targetBounds },
            plannedBounds,
            scale: {
                x: scaleX,
                y: scaleY,
                xPercent: scaleX * 100,
                yPercent: scaleY * 100
            },
            insideTarget: {
                ...(inside.bounds ? { bounds: inside.bounds } : {}),
                area: insideArea,
                frameRatio: insideArea / frameArea,
                targetRatio: clamp(insideArea / targetArea, 0, 1)
            },
            outsideTarget: {
                area: outsideArea,
                frameRatio: outsideArea / frameArea,
                edges: overflowEdges(distance),
                distance
            },
            ...(focalPoint ? { focalPoint } : {}),
            ...(subject ? { subject } : {}),
            boundaries: {
                factsOnly: true,
                clippingNotProven: true,
                noAestheticVerdict: true,
                noHiddenThresholds: true
            }
        }
    };
}
