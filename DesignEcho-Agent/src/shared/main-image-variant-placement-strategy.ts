import {
    buildImagePlacementPlan,
    type ImagePlacementBox,
    type ImagePlacementPlan,
    type ImagePlacementRequiredReadback
} from './design-image-placement-core';
import type {
    MainImageProjectStyleStrategy,
    MainImageVariantType
} from './main-image-project-style-strategy';
import {
    buildMainImageSlotAssignmentKey,
    getMainImageProductionDocumentSpec,
    resolveMainImageProductionSizeKey,
    type MainImageSlotAssignment
} from './main-image-production-spec';

export type MainImageVariantPlacementStrategyStatus =
    | 'blocked_missing_slot_assignments'
    | 'ready_variant_placement_plan';

export interface MainImageVariantPlacementStrategyInput {
    userText?: string;
    projectStyleStrategy?: MainImageProjectStyleStrategy | null;
    slotAssignments?: MainImageSlotAssignment[];
    createEmptySkeleton?: boolean;
}

export interface MainImageVariantPlacementPlan {
    id: string;
    assignmentKey: string;
    slotName: string;
    variantId: string;
    variantImageType: MainImageVariantType;
    sizeKey: string;
    objective: string;
    targetSlot: {
        box: ImagePlacementBox;
        safeBox: ImagePlacementBox;
        slotRole: 'click-hero' | 'conversion-hero';
        layoutReason: string;
    };
    placementPlan: ImagePlacementPlan;
    asset: {
        id?: string;
        name?: string;
        path: string;
        width: number;
        height: number;
    };
}

export interface MainImageVariantPlacementStrategy {
    version: 'main-image-variant-placement-strategy/v0';
    skillId: 'main-image-design';
    scene: 'ecommerce-socks';
    status: MainImageVariantPlacementStrategyStatus;
    projectStyle: {
        status: string;
        productType: string;
        styleKeywords: string[];
        clickVariantCount: number;
        conversionVariantCount: number;
    };
    variantPlacementPlans: MainImageVariantPlacementPlan[];
    verificationPolicy: {
        requiredReadback: ImagePlacementRequiredReadback[];
        qualityClaimBoundary: string;
    };
    canClaimOutputQuality: false;
    canClaimDesignComplete: false;
    noPhotoshopWrites: true;
    mustNotExecutePhotoshop: true;
    blockers: string[];
    warnings: string[];
    limitations: string[];
}

interface NormalizedSubjectBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

const FORBIDDEN_PAYLOAD_PATTERNS = [
    /raw-image-payload/gi,
    /base64-image-payload/gi,
    /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi,
    /data:image\//gi
];

function cleanString(value: unknown): string {
    let text = String(value || '').trim();
    for (const pattern of FORBIDDEN_PAYLOAD_PATTERNS) {
        text = text.replace(pattern, '[redacted-image-payload]');
    }
    return text.replace(/\s+/g, ' ').trim();
}

function normalizeSubjectBounds(
    bounds: MainImageSlotAssignment['subjectBounds']
): NormalizedSubjectBounds | undefined {
    const left = Number(bounds.left ?? 0);
    const top = Number(bounds.top ?? 0);
    const right = Number(bounds.right ?? (left + Number(bounds.width || 0)));
    const bottom = Number(bounds.bottom ?? (top + Number(bounds.height || 0)));
    const width = Number(bounds.width ?? (right - left));
    const height = Number(bounds.height ?? (bottom - top));
    if (![left, top, right, bottom, width, height].every(Number.isFinite)) return undefined;
    if (width <= 0 || height <= 0) return undefined;
    return {
        left: Math.round(left),
        top: Math.round(top),
        right: Math.round(right),
        bottom: Math.round(bottom),
        width: Math.round(width),
        height: Math.round(height)
    };
}

function buildSafeBox(targetSize: { width: number; height: number }): ImagePlacementBox {
    return {
        x: 0,
        y: 0,
        width: targetSize.width,
        height: targetSize.height
    };
}

function buildTargetSlot(
    assignment: MainImageSlotAssignment,
    canvasSize: { width: number; height: number }
): MainImageVariantPlacementPlan['targetSlot'] {
    const safeBox = assignment.placement.safeBox || buildSafeBox(canvasSize);
    const box: ImagePlacementBox = { ...assignment.placement.targetBox };
    return {
        box,
        safeBox,
        slotRole: assignment.imageType === 'click' ? 'click-hero' : 'conversion-hero',
        layoutReason: `使用 Agent 对当前槽位显式声明的主体区域：${assignment.placement.decisionReason}`
    };
}

function buildPlacementPlan(input: {
    assignment: MainImageSlotAssignment;
}): MainImageVariantPlacementPlan {
    const sizeKey = resolveMainImageProductionSizeKey(input.assignment.sizeKey);
    if (!sizeKey) throw new Error(`Unsupported main-image assignment size: ${input.assignment.sizeKey}`);
    const document = getMainImageProductionDocumentSpec(sizeKey);
    const subjectBounds = normalizeSubjectBounds(input.assignment.subjectBounds);
    if (!subjectBounds) throw new Error(`Invalid subject bounds for ${buildMainImageSlotAssignmentKey(input.assignment)}`);
    const targetSlot = buildTargetSlot(input.assignment, document.canvasSize);
    const placementPlan = buildImagePlacementPlan({
        source: {
            width: input.assignment.asset.width,
            height: input.assignment.asset.height,
            path: input.assignment.asset.path,
            assetId: input.assignment.asset.id || input.assignment.asset.name,
            role: 'product',
            subjectBox: {
                x: subjectBounds.left,
                y: subjectBounds.top,
                width: subjectBounds.width,
                height: subjectBounds.height
            }
        },
        target: {
            box: targetSlot.box,
            safeBox: targetSlot.safeBox,
            slotId: buildMainImageSlotAssignmentKey(input.assignment),
            slotRole: targetSlot.slotRole
        },
        canvas: document.canvasSize,
        designType: 'main-image',
        assetRole: 'product',
        intent: input.assignment.imageType === 'click' ? 'hero' : 'fit-slot',
        presetOverride: input.assignment.placement.preset,
        cropPolicy: input.assignment.placement.preset.cropPolicy,
        requireSubjectBounds: true,
        executionTool: 'transformLayer'
    });

    const assignmentKey = buildMainImageSlotAssignmentKey(input.assignment);

    return {
        id: assignmentKey,
        assignmentKey,
        slotName: input.assignment.slotName,
        variantId: input.assignment.variantId,
        variantImageType: input.assignment.imageType,
        sizeKey,
        objective: input.assignment.objective,
        targetSlot,
        placementPlan,
        asset: { ...input.assignment.asset }
    };
}

function resolveStatus(input: {
    assignments: MainImageSlotAssignment[];
    createEmptySkeleton: boolean;
}): MainImageVariantPlacementStrategyStatus {
    if (input.assignments.length === 0 && input.createEmptySkeleton) return 'ready_variant_placement_plan';
    if (input.assignments.length === 0) return 'blocked_missing_slot_assignments';
    // 每个 assignment 都已经携带自己素材的像素尺寸、主体范围和放置决定。
    // 全局 styleStrategy 可以继续用于解释与评审，但不再决定生产提交是否可编译。
    return 'ready_variant_placement_plan';
}

function buildBlockers(status: MainImageVariantPlacementStrategyStatus): string[] {
    switch (status) {
        case 'blocked_missing_slot_assignments':
            return ['main_image_slot_assignments_required_for_production'];
        case 'ready_variant_placement_plan':
        default:
            return [];
    }
}

function buildWarnings(input: {
    status: MainImageVariantPlacementStrategyStatus;
    plans: MainImageVariantPlacementPlan[];
    createEmptySkeleton: boolean;
}): string[] {
    const warnings: string[] = [];
    if (input.createEmptySkeleton && input.plans.length === 0) {
        warnings.push('当前任务只创建标准空骨架，不包含素材置入或缩放计划。');
    } else if (input.status === 'ready_variant_placement_plan') {
        warnings.push('当前只是主图变体置入/缩放计划，执行后必须读取 Photoshop actualBounds 和截图验收。');
    }
    for (const plan of input.plans) {
        for (const warning of plan.placementPlan.warnings) {
            warnings.push(warning);
        }
    }
    return Array.from(new Set(warnings.map(cleanString).filter(Boolean)));
}

function buildVerificationPolicy(plans: MainImageVariantPlacementPlan[]): MainImageVariantPlacementStrategy['verificationPolicy'] {
    const readback = new Set<ImagePlacementRequiredReadback>(['actualBounds', 'clippingState', 'screenshot']);
    for (const plan of plans) {
        for (const item of plan.placementPlan.execution.requiredReadback) {
            readback.add(item);
        }
    }
    return {
        requiredReadback: Array.from(readback),
        qualityClaimBoundary: '只有完成 transform 后读回 actualBounds、检查 clipping，并对导出图或截图做 QA，才能声明主图置入质量。'
    };
}

export function buildMainImageVariantPlacementStrategy(
    input: MainImageVariantPlacementStrategyInput
): MainImageVariantPlacementStrategy {
    const assignments = input.slotAssignments || [];
    const status = resolveStatus({
        assignments,
        createEmptySkeleton: input.createEmptySkeleton === true
    });
    const variantPlacementPlans = status === 'ready_variant_placement_plan'
        ? assignments.map((assignment) => buildPlacementPlan({ assignment }))
        : [];
    const projectStyle = input.projectStyleStrategy;
    const warnings = buildWarnings({
        status,
        plans: variantPlacementPlans,
        createEmptySkeleton: input.createEmptySkeleton === true
    });

    return {
        version: 'main-image-variant-placement-strategy/v0',
        skillId: 'main-image-design',
        scene: 'ecommerce-socks',
        status,
        projectStyle: {
            status: projectStyle?.status || 'missing',
            productType: projectStyle?.projectStyleUnderstanding.productType || 'unknown',
            styleKeywords: projectStyle?.designDirection.styleKeywords || [],
            clickVariantCount: projectStyle?.variantPlan.clickImages.length || 0,
            conversionVariantCount: projectStyle?.variantPlan.conversionImages.length || 0
        },
        variantPlacementPlans,
        verificationPolicy: buildVerificationPolicy(variantPlacementPlans),
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        blockers: buildBlockers(status),
        warnings,
        limitations: [
            '主图变体置入策略只输出几何计划，不调用模型、不搜索网页、不读图片像素、不执行 Photoshop。',
            '款式理解和构图决定必须由 Agent 在提交 slotAssignments 前完成；生产层不从文件名、全局 selectedAsset 或旧 projectStyleStrategy 重新猜测。',
            'destinationBox 和 subjectDestinationBox 是计划值，不是 Photoshop actualBounds。',
            '每个置入计划只消费其槽位 assignment 自己的素材尺寸、主体 bounds、目标区域和缩放预设；跨槽复用必须再次显式声明。'
        ]
    };
}
