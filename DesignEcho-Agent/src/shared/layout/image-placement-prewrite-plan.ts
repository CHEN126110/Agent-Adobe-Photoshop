/**
 * 图片写入前的纯计划层。
 *
 * 调用方负责取得明确的源图事实并声明落位意图；本模块只做输入校验、几何预演、
 * 主体占比的一次最终图框求解，以及 protect-subject 的事实冲突检查。
 * 它不访问 IPC / Photoshop，不选择素材、构图或审美阈值，也不按品类补默认值。
 */

import type {
    SmartScalingAnchor,
    SmartScalingCropPolicy
} from '../design-smart-scaling-policy';
import type {
    SubjectBoxConfidence,
    SubjectBoxMethod
} from '../subject-box-from-pixels';
import {
    computeSubjectFitToRegion,
    verifySubjectFitResult,
    type SubjectFitPlan,
    type SubjectFitRect,
    type SubjectFitVerification
} from '../subject-fit';
import {
    previewImagePlacement,
    type ImagePlacementPreview,
    type ImagePlacementPreviewBounds,
    type ImagePlacementPreviewFit,
    type ImagePlacementPreviewFocalPoint,
    type ImagePlacementPreviewSubjectBox
} from './image-placement-preview';

export interface ImagePlacementPrewriteSubjectFacts {
    box: ImagePlacementPreviewSubjectBox;
    method: SubjectBoxMethod;
    confidence: SubjectBoxConfidence;
}

export interface ImagePlacementPrewriteSourceFacts {
    width: number;
    height: number;
    /** 缺失表示当前没有主体框事实；不得用整张图框静默冒充主体。 */
    subject?: ImagePlacementPrewriteSubjectFacts;
}

export interface ImagePlacementPrewritePlacement {
    fit: ImagePlacementPreviewFit;
    anchor: SmartScalingAnchor;
    cropPolicy: SmartScalingCropPolicy;
    focalPoint?: ImagePlacementPreviewFocalPoint;
    /** Agent 显式声明的主体 contain 占比；缺失时走普通图框落位。 */
    subjectFillRatio?: number;
}

export interface ImagePlacementPrewriteInput {
    source: ImagePlacementPrewriteSourceFacts;
    target: ImagePlacementPreviewBounds;
    placement: ImagePlacementPrewritePlacement;
    canvas: { width: number; height: number };
}

export type ImagePlacementPrewriteIssueStage =
    | 'input'
    | 'normal-preview'
    | 'subject-fill'
    | 'subject-protection';

export interface ImagePlacementPrewriteIssue {
    path: string;
    code: string;
    stage: ImagePlacementPrewriteIssueStage;
    message: string;
    facts?: Record<string, unknown>;
}

export interface ImagePlacementPrewriteFinalWrite {
    /** normal 沿用 Agent 的目标区域；subject-fill-once 使用求解出的最终图框。 */
    targetBounds: ImagePlacementPreviewBounds;
    fit: ImagePlacementPreviewFit;
    anchor: SmartScalingAnchor;
    focalPoint?: ImagePlacementPreviewFocalPoint;
    preview: ImagePlacementPreview;
}

export interface ImagePlacementPrewriteSubjectFill {
    /** 未施加任意放大上限时，兑现声明占比所需的纯几何缩放倍数。 */
    requiredScaleRatio: number;
    geometryPlan: SubjectFitPlan;
    /** 以最终一次 placeImage 的预计主体框作为 actual 做的写前验证。 */
    preverification: SubjectFitVerification;
}

export interface ImagePlacementPrewriteSubjectProtection {
    visibleRatio: number;
    clippedEdges: Array<'left' | 'top' | 'right' | 'bottom'>;
    satisfied: true;
}

export interface ImagePlacementPrewritePlan {
    version: 'image-placement-prewrite-plan/v1';
    mode: 'normal' | 'subject-fill-once';
    source: ImagePlacementPrewriteSourceFacts;
    target: ImagePlacementPreviewBounds;
    placement: ImagePlacementPrewritePlacement;
    canvas: { width: number; height: number };
    normalPreview: ImagePlacementPreview;
    finalWrite: ImagePlacementPrewriteFinalWrite;
    subjectFill?: ImagePlacementPrewriteSubjectFill;
    subjectProtection?: ImagePlacementPrewriteSubjectProtection;
    boundaries: {
        pureGeometry: true;
        noPhotoshopAccess: true;
        noAestheticVerdict: true;
        noCategoryDefaults: true;
        exactSubjectProtection: true;
    };
}

export type ImagePlacementPrewriteResult =
    | { ok: true; plan: ImagePlacementPrewritePlan }
    | { ok: false; issues: ImagePlacementPrewriteIssue[] };

const SUPPORTED_CROP_POLICIES: readonly SmartScalingCropPolicy[] = [
    'avoid-crop',
    'protect-subject',
    'allow-crop'
];
const SUPPORTED_SUBJECT_METHODS: readonly SubjectBoxMethod[] = [
    'alpha',
    'trim',
    'matting',
    'frame'
];
const SUPPORTED_SUBJECT_CONFIDENCE: readonly SubjectBoxConfidence[] = [
    'certain',
    'high',
    'medium',
    'low'
];

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveNumber(value: unknown): value is number {
    return isFiniteNumber(value) && value > 0;
}

function isPositiveBounds(value: ImagePlacementPreviewBounds | undefined): boolean {
    return Boolean(value)
        && isFiniteNumber(value?.x)
        && isFiniteNumber(value?.y)
        && isPositiveNumber(value?.width)
        && isPositiveNumber(value?.height);
}

function isNormalizedSubjectBox(value: ImagePlacementPreviewSubjectBox | undefined): boolean {
    return Boolean(value)
        && isFiniteNumber(value?.x)
        && isFiniteNumber(value?.y)
        && isPositiveNumber(value?.width)
        && isPositiveNumber(value?.height)
        && value!.x >= 0
        && value!.y >= 0
        && value!.x + value!.width <= 1
        && value!.y + value!.height <= 1;
}

function appendIssue(
    issues: ImagePlacementPrewriteIssue[],
    issue: ImagePlacementPrewriteIssue
): void {
    issues.push(issue);
}

function appendInputIssues(
    input: ImagePlacementPrewriteInput,
    issues: ImagePlacementPrewriteIssue[]
): void {
    const source = input?.source;
    if (!source
        || !isPositiveNumber(source.width)
        || !isPositiveNumber(source.height)) {
        appendIssue(issues, {
            path: 'source',
            code: 'explicit_positive_source_size_required',
            stage: 'input',
            message: 'source.width/height 必须是写入前已经读取到的大于 0 的有限像素尺寸。'
        });
    }

    if (!isPositiveBounds(input?.target)) {
        appendIssue(issues, {
            path: 'target',
            code: 'positive_target_bounds_required',
            stage: 'input',
            message: 'target 需要有限的 x/y 和大于 0 的 width/height。'
        });
    }

    const canvas = input?.canvas;
    if (!canvas
        || !isPositiveNumber(canvas.width)
        || !isPositiveNumber(canvas.height)) {
        appendIssue(issues, {
            path: 'canvas',
            code: 'explicit_positive_canvas_size_required',
            stage: 'input',
            message: 'canvas.width/height 必须是明确的大于 0 的有限像素尺寸。'
        });
    }

    const placement = input?.placement;
    if (!placement) {
        appendIssue(issues, {
            path: 'placement',
            code: 'explicit_placement_required',
            stage: 'input',
            message: 'placement 必须显式声明 fit、anchor 与 cropPolicy。'
        });
        return;
    }
    if (!SUPPORTED_CROP_POLICIES.includes(placement.cropPolicy)) {
        appendIssue(issues, {
            path: 'placement.cropPolicy',
            code: 'explicit_supported_crop_policy_required',
            stage: 'input',
            message: 'cropPolicy 必须显式为 avoid-crop、protect-subject 或 allow-crop。'
        });
    }

    const subjectFillRatio = placement.subjectFillRatio;
    if (subjectFillRatio !== undefined
        && (!isFiniteNumber(subjectFillRatio)
            || subjectFillRatio <= 0
            || subjectFillRatio > 1)) {
        appendIssue(issues, {
            path: 'placement.subjectFillRatio',
            code: 'explicit_subject_fill_ratio_required',
            stage: 'input',
            message: 'subjectFillRatio 必须是 Agent 显式声明的 (0,1] 有限数值。'
        });
    }

    const subject = source?.subject;
    if (!subject) return;
    if (!isNormalizedSubjectBox(subject.box)) {
        appendIssue(issues, {
            path: 'source.subject.box',
            code: 'normalized_source_subject_box_required',
            stage: 'input',
            message: 'source.subject.box 必须是完整位于源图 0..1 范围内的归一化正矩形。'
        });
    }
    if (!SUPPORTED_SUBJECT_METHODS.includes(subject.method)) {
        appendIssue(issues, {
            path: 'source.subject.method',
            code: 'explicit_subject_method_required',
            stage: 'input',
            message: 'source.subject.method 必须显式说明 alpha、trim、matting 或 frame。'
        });
    }
    if (!SUPPORTED_SUBJECT_CONFIDENCE.includes(subject.confidence)) {
        appendIssue(issues, {
            path: 'source.subject.confidence',
            code: 'explicit_subject_confidence_required',
            stage: 'input',
            message: 'source.subject.confidence 必须显式说明 certain、high、medium 或 low。'
        });
    }
}

function cloneSubjectFacts(
    subject: ImagePlacementPrewriteSubjectFacts | undefined
): ImagePlacementPrewriteSubjectFacts | undefined {
    if (!subject) return undefined;
    return {
        box: { ...subject.box },
        method: subject.method,
        confidence: subject.confidence
    };
}

function cloneSourceFacts(
    source: ImagePlacementPrewriteSourceFacts
): ImagePlacementPrewriteSourceFacts {
    const subject = cloneSubjectFacts(source.subject);
    return {
        width: source.width,
        height: source.height,
        ...(subject ? { subject } : {})
    };
}

function clonePlacement(
    placement: ImagePlacementPrewritePlacement
): ImagePlacementPrewritePlacement {
    return {
        fit: placement.fit,
        anchor: placement.anchor,
        cropPolicy: placement.cropPolicy,
        ...(placement.focalPoint ? { focalPoint: { ...placement.focalPoint } } : {}),
        ...(placement.subjectFillRatio !== undefined
            ? { subjectFillRatio: placement.subjectFillRatio }
            : {})
    };
}

function sourceSubjectIsUsable(
    subject: ImagePlacementPrewriteSubjectFacts | undefined
): boolean {
    return Boolean(subject)
        && subject?.method !== 'frame'
        && subject?.confidence !== 'low';
}

function toSubjectFitRect(
    bounds: ImagePlacementPreviewBounds
): SubjectFitRect {
    return {
        left: bounds.x,
        top: bounds.y,
        right: bounds.x + bounds.width,
        bottom: bounds.y + bounds.height
    };
}

function normalizedSubjectToSourceRect(
    source: ImagePlacementPrewriteSourceFacts,
    subject: ImagePlacementPrewriteSubjectFacts
): SubjectFitRect {
    return {
        left: subject.box.x * source.width,
        top: subject.box.y * source.height,
        right: (subject.box.x + subject.box.width) * source.width,
        bottom: (subject.box.y + subject.box.height) * source.height
    };
}

function projectedFrameToBounds(plan: SubjectFitPlan): ImagePlacementPreviewBounds {
    return {
        x: plan.projectedFrame.left,
        y: plan.projectedFrame.top,
        width: plan.projectedFrame.right - plan.projectedFrame.left,
        height: plan.projectedFrame.bottom - plan.projectedFrame.top
    };
}

function requiredSubjectScaleRatio(input: {
    subjectBounds: SubjectFitRect;
    target: ImagePlacementPreviewBounds;
    fillRatio: number;
}): number {
    const subjectWidth = input.subjectBounds.right - input.subjectBounds.left;
    const subjectHeight = input.subjectBounds.bottom - input.subjectBounds.top;
    return Math.min(
        (input.target.width * input.fillRatio) / subjectWidth,
        (input.target.height * input.fillRatio) / subjectHeight
    );
}

function appendSubjectIntentIssues(
    input: ImagePlacementPrewriteInput,
    issues: ImagePlacementPrewriteIssue[]
): void {
    const placement = input.placement;
    const subjectFillRequested = placement.subjectFillRatio !== undefined;
    const protectCoverRequested = placement.fit === 'cover'
        && placement.cropPolicy === 'protect-subject';
    if (!subjectFillRequested && !protectCoverRequested) return;

    if (!input.source.subject) {
        appendIssue(issues, {
            path: 'source.subject',
            code: subjectFillRequested
                ? 'subject_facts_required_for_subject_fill'
                : 'subject_facts_required_for_protection',
            stage: subjectFillRequested ? 'subject-fill' : 'subject-protection',
            message: subjectFillRequested
                ? 'subjectFillRatio 需要明确的源图主体框事实，不能用整张图框代替。'
                : 'cover + protect-subject 需要明确的源图主体框事实。'
        });
    } else if (!sourceSubjectIsUsable(input.source.subject)) {
        appendIssue(issues, {
            path: 'source.subject',
            code: subjectFillRequested
                ? 'subject_evidence_unusable_for_subject_fill'
                : 'subject_evidence_unusable_for_protection',
            stage: subjectFillRequested ? 'subject-fill' : 'subject-protection',
            message: '主体框是 frame 兜底或 low 置信事实，不能证明主体占比或主体保护。',
            facts: {
                method: input.source.subject.method,
                confidence: input.source.subject.confidence
            }
        });
    }

    if (!subjectFillRequested) return;
    if (placement.fit !== 'contain') {
        appendIssue(issues, {
            path: 'placement.fit',
            code: 'subject_fill_requires_contain_semantics',
            stage: 'subject-fill',
            message: 'subjectFillRatio 已完整定义主体 contain 落位，不能同时声明 cover 或 fill。'
        });
    }
    if (placement.focalPoint) {
        appendIssue(issues, {
            path: 'placement.focalPoint',
            code: 'focal_point_conflicts_with_subject_fill',
            stage: 'subject-fill',
            message: 'subjectFillRatio 使用主体锚点求解最终图框，不能同时声明图框 focalPoint。'
        });
    }
}

function buildNormalPreview(
    input: ImagePlacementPrewriteInput
): ReturnType<typeof previewImagePlacement> {
    return previewImagePlacement({
        source: {
            width: input.source.width,
            height: input.source.height
        },
        targetBounds: input.target,
        fit: input.placement.fit,
        anchor: input.placement.anchor,
        ...(input.placement.focalPoint
            ? { focalPoint: input.placement.focalPoint }
            : {}),
        ...(input.source.subject
            ? { subjectBox: input.source.subject.box }
            : {})
    });
}

function buildSubjectFillPlan(input: {
    source: ImagePlacementPrewriteSourceFacts;
    target: ImagePlacementPreviewBounds;
    canvas: { width: number; height: number };
    placement: ImagePlacementPrewritePlacement;
    subject: ImagePlacementPrewriteSubjectFacts;
}):
    | {
        ok: true;
        subjectFill: ImagePlacementPrewriteSubjectFill;
        finalWrite: ImagePlacementPrewriteFinalWrite;
    }
    | { ok: false; issues: ImagePlacementPrewriteIssue[] } {
    const fillRatio = input.placement.subjectFillRatio as number;
    const subjectBounds = normalizedSubjectToSourceRect(input.source, input.subject);
    const requiredScaleRatio = requiredSubjectScaleRatio({
        subjectBounds,
        target: input.target,
        fillRatio
    });
    const geometryPlan = computeSubjectFitToRegion({
        subjectBounds,
        layerBounds: {
            left: 0,
            top: 0,
            right: input.source.width,
            bottom: input.source.height
        },
        targetRegion: input.target,
        subjectFillRatio: fillRatio,
        anchor: input.placement.anchor,
        /** 精确传入所需倍数，避免 subject-fit 的兼容默认放大上限改变设计意图。 */
        maxUpscaleRatio: requiredScaleRatio,
        visualBiasY: 0,
        canvas: input.canvas
    });
    if (geometryPlan.ok === false) {
        return {
            ok: false,
            issues: [{
                path: 'placement.subjectFillRatio',
                code: 'subject_fit_unsolved_prewrite',
                stage: 'subject-fill',
                message: geometryPlan.reason,
                facts: { requiredScaleRatio }
            }]
        };
    }

    const finalTargetBounds = projectedFrameToBounds(geometryPlan);
    const finalPreviewResult = previewImagePlacement({
        source: {
            width: input.source.width,
            height: input.source.height
        },
        targetBounds: finalTargetBounds,
        fit: 'contain',
        anchor: 'center',
        subjectBox: input.subject.box
    });
    if (finalPreviewResult.ok === false) {
        return {
            ok: false,
            issues: finalPreviewResult.issues.map((issue) => ({
                path: `finalWrite.${issue.path}`,
                code: 'subject_fit_final_preview_invalid',
                stage: 'subject-fill' as const,
                message: issue.message
            }))
        };
    }

    const finalSubjectBounds = finalPreviewResult.preview.subject?.plannedBounds;
    if (!finalSubjectBounds) {
        return {
            ok: false,
            issues: [{
                path: 'source.subject',
                code: 'subject_fit_final_subject_projection_missing',
                stage: 'subject-fill',
                message: '最终一次落位预演没有返回主体投影，不能预验证主体占比。'
            }]
        };
    }
    const preverification = verifySubjectFitResult({
        actualSubjectBounds: toSubjectFitRect(finalSubjectBounds),
        targetRegion: input.target,
        requestedFillRatio: fillRatio,
        anchor: input.placement.anchor,
        visualBiasY: 0,
        projectedSubject: geometryPlan.projectedSubject
    });
    if (preverification.status !== 'passed') {
        return {
            ok: false,
            issues: [{
                path: 'placement.subjectFillRatio',
                code: 'subject_fit_cannot_meet_request_prewrite',
                stage: 'subject-fill',
                message: preverification.warnings.join('；') || preverification.status,
                facts: {
                    requiredScaleRatio,
                    actualFillRatio: preverification.actualFillRatio,
                    requestedFillRatio: fillRatio,
                    fillDeviation: preverification.fillDeviation,
                    anchorDeviationPx: preverification.anchorDeviationPx,
                    projectedBoundsDeviationPx: preverification.projectedBoundsDeviationPx,
                    tolerances: preverification.tolerances
                }
            }]
        };
    }

    return {
        ok: true,
        subjectFill: {
            requiredScaleRatio,
            geometryPlan,
            preverification
        },
        finalWrite: {
            targetBounds: finalTargetBounds,
            fit: 'contain',
            anchor: 'center',
            preview: finalPreviewResult.preview
        }
    };
}

function evaluateSubjectProtection(input: {
    placement: ImagePlacementPrewritePlacement;
    preview: ImagePlacementPreview;
}):
    | { ok: true; protection?: ImagePlacementPrewriteSubjectProtection }
    | { ok: false; issue: ImagePlacementPrewriteIssue } {
    if (input.placement.fit !== 'cover'
        || input.placement.cropPolicy !== 'protect-subject') {
        return { ok: true };
    }
    const subject = input.preview.subject;
    if (!subject) {
        return {
            ok: false,
            issue: {
                path: 'source.subject',
                code: 'protected_subject_projection_missing_prewrite',
                stage: 'subject-protection',
                message: 'cover + protect-subject 的普通预演没有主体投影事实。'
            }
        };
    }
    if (subject.clippedEdges.length > 0 || subject.visibleRatio < 1) {
        return {
            ok: false,
            issue: {
                path: 'placement.cropPolicy',
                code: 'protected_subject_crop_detected_prewrite',
                stage: 'subject-protection',
                message: '普通预演显示主体没有完整位于目标区域内，与 protect-subject 冲突。',
                facts: {
                    visibleRatio: subject.visibleRatio,
                    clippedEdges: [...subject.clippedEdges],
                    outsideDistance: { ...subject.outsideDistance }
                }
            }
        };
    }
    return {
        ok: true,
        protection: {
            visibleRatio: subject.visibleRatio,
            clippedEdges: [...subject.clippedEdges],
            satisfied: true
        }
    };
}

export function buildImagePlacementPrewritePlan(
    input: ImagePlacementPrewriteInput
): ImagePlacementPrewriteResult {
    const issues: ImagePlacementPrewriteIssue[] = [];
    appendInputIssues(input, issues);
    if (issues.length > 0) return { ok: false, issues };

    appendSubjectIntentIssues(input, issues);
    if (issues.length > 0) return { ok: false, issues };

    const normalPreviewResult = buildNormalPreview(input);
    if (normalPreviewResult.ok === false) {
        return {
            ok: false,
            issues: normalPreviewResult.issues.map((issue) => ({
                path: `placement.${issue.path}`,
                code: 'normal_placement_preview_invalid',
                stage: 'normal-preview' as const,
                message: issue.message
            }))
        };
    }

    let mode: ImagePlacementPrewritePlan['mode'] = 'normal';
    let finalWrite: ImagePlacementPrewriteFinalWrite = {
        targetBounds: { ...input.target },
        fit: input.placement.fit,
        anchor: input.placement.anchor,
        ...(input.placement.focalPoint
            ? { focalPoint: { ...input.placement.focalPoint } }
            : {}),
        preview: normalPreviewResult.preview
    };
    let subjectFill: ImagePlacementPrewriteSubjectFill | undefined;
    if (input.placement.subjectFillRatio !== undefined) {
        const subjectFillResult = buildSubjectFillPlan({
            source: input.source,
            target: input.target,
            canvas: input.canvas,
            placement: input.placement,
            subject: input.source.subject as ImagePlacementPrewriteSubjectFacts
        });
        if (subjectFillResult.ok === false) return subjectFillResult;
        mode = 'subject-fill-once';
        finalWrite = subjectFillResult.finalWrite;
        subjectFill = subjectFillResult.subjectFill;
    }

    const protectionResult = evaluateSubjectProtection({
        placement: input.placement,
        preview: normalPreviewResult.preview
    });
    if (protectionResult.ok === false) {
        return { ok: false, issues: [protectionResult.issue] };
    }

    const source = cloneSourceFacts(input.source);
    const placement = clonePlacement(input.placement);
    return {
        ok: true,
        plan: {
            version: 'image-placement-prewrite-plan/v1',
            mode,
            source,
            target: { ...input.target },
            placement,
            canvas: { ...input.canvas },
            normalPreview: normalPreviewResult.preview,
            finalWrite,
            ...(subjectFill ? { subjectFill } : {}),
            ...(protectionResult.protection
                ? { subjectProtection: protectionResult.protection }
                : {}),
            boundaries: {
                pureGeometry: true,
                noPhotoshopAccess: true,
                noAestheticVerdict: true,
                noCategoryDefaults: true,
                exactSubjectProtection: true
            }
        }
    };
}
