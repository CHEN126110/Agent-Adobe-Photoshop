/**
 * 已求解图片区域的统一写前预演。
 *
 * 布局调用方负责先把声明式区域换算成像素块，并通过依赖注入取得源图事实；本模块只校验
 * 当前执行层是否能兑现图片语义，再调用纯几何 prewrite plan。它不访问 Photoshop、不选择
 * 素材、不修改构图，也不补任何品类或审美默认值。
 */

import {
    buildImagePlacementPrewritePlan,
    type ImagePlacementPrewritePlan,
    type ImagePlacementPrewriteSubjectFacts
} from './image-placement-prewrite-plan';
import {
    rendersLayoutBlockAsImage,
    type ImagePlacementSpec,
    type ResolvedBlock
} from './layout-engine';

export interface ResolvedImagePlacementFinding {
    code: string;
    severity: 'repair';
    closureKind: 'replan' | 'observation';
    blockId: string;
    role: string;
    message: string;
    facts?: Record<string, unknown>;
    recommendedStrategies: string[];
}

export interface ResolvedImagePlacementPreflightInput {
    blocks: ResolvedBlock[];
    canvas: { width: number; height: number };
    readAssetSubjectBox: (sourcePath: string) => Promise<unknown>;
    executorLabel: string;
}

export interface ResolvedImagePlacementPreflightResult {
    ok: boolean;
    findings: ResolvedImagePlacementFinding[];
    plansByBlockId: Map<string, ImagePlacementPrewritePlan>;
}

interface AssetSubjectBoxResult {
    imageWidth?: unknown;
    imageHeight?: unknown;
    resolution?: {
        box?: {
            x?: unknown;
            y?: unknown;
            width?: unknown;
            height?: unknown;
        };
        method?: unknown;
        confidence?: unknown;
    };
}

function readSubjectFacts(value: unknown): ImagePlacementPrewriteSubjectFacts | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const result = value as AssetSubjectBoxResult;
    const rawBox = result.resolution?.box;
    const method = String(result.resolution?.method || '').trim();
    const confidence = String(result.resolution?.confidence || '').trim();
    const validMethods = ['alpha', 'trim', 'matting', 'frame'];
    const validConfidence = ['certain', 'high', 'medium', 'low'];
    if (!rawBox
        || ![rawBox.x, rawBox.y, rawBox.width, rawBox.height]
            .every((entry) => Number.isFinite(Number(entry)))
        || Number(rawBox.width) <= 0
        || Number(rawBox.height) <= 0
        || !validMethods.includes(method)
        || !validConfidence.includes(confidence)) {
        return undefined;
    }
    return {
        box: {
            x: Number(rawBox.x),
            y: Number(rawBox.y),
            width: Number(rawBox.width),
            height: Number(rawBox.height)
        },
        method: method as ImagePlacementPrewriteSubjectFacts['method'],
        confidence: confidence as ImagePlacementPrewriteSubjectFacts['confidence']
    };
}

function collectUnsupportedSemantics(
    block: ResolvedBlock,
    placement: Partial<ImagePlacementSpec>,
    canvas: { width: number; height: number }
): string[] {
    const unsupported: string[] = [];
    const scale = placement.scale === undefined ? 1 : Number(placement.scale);
    if (!Number.isFinite(scale) || Math.abs(scale - 1) > 0.001) {
        unsupported.push(`scale=${String(placement.scale)}`);
    }
    const rotation = placement.rotation === undefined ? 0 : Number(placement.rotation);
    if (!Number.isFinite(rotation) || Math.abs(rotation) > 0.001) {
        unsupported.push(`rotation=${String(placement.rotation)}`);
    }
    if (placement.mask === 'shape') unsupported.push('shape mask');

    const fit = placement.fit === 'cover' ? 'cover' : 'contain';
    const hasRectangularClip = placement.mask === 'clipping' || placement.overflow === 'clip';
    const isWholeDocument = Math.abs(block.x) <= 1
        && Math.abs(block.y) <= 1
        && Math.abs(block.width - Number(canvas.width)) <= 1
        && Math.abs(block.height - Number(canvas.height)) <= 1;
    if (fit === 'cover' && !hasRectangularClip && !isWholeDocument) {
        unsupported.push('cover without clipping/clip on a non-document region');
    }
    return unsupported;
}

export async function preflightResolvedImagePlacements(
    input: ResolvedImagePlacementPreflightInput
): Promise<ResolvedImagePlacementPreflightResult> {
    const findings: ResolvedImagePlacementFinding[] = [];
    const plansByBlockId = new Map<string, ImagePlacementPrewritePlan>();

    for (const block of input.blocks) {
        if (!rendersLayoutBlockAsImage(block)) continue;
        const placement: Partial<ImagePlacementSpec> = block.imagePlacement
            && typeof block.imagePlacement === 'object'
            ? block.imagePlacement
            : {};
        const unsupportedSemantics = collectUnsupportedSemantics(block, placement, input.canvas);
        if (unsupportedSemantics.length > 0) {
            findings.push({
                code: 'placement_semantics_unsupported_prewrite',
                severity: 'repair',
                closureKind: 'replan',
                blockId: block.id,
                role: block.role,
                message: `图片块「${block.id}」包含当前 ${input.executorLabel} 尚不能可靠执行的语义：`
                    + `${unsupportedSemantics.join('、')}。图片写入尚未开始，请先重规划为已支持语义。`,
                recommendedStrategies: [
                    '保持 scale=1、rotation=0；图框对齐使用已支持的锚点或归一化 focalPoint',
                    '非整画布 cover 必须声明 mask=clipping 或 overflow=clip',
                    '需要形状蒙版或旋转构图时改用具备对应读回收据的专用执行路径'
                ]
            });
            continue;
        }

        const sourcePath = String(block.content || '').trim();
        let assetSubject: unknown;
        try {
            assetSubject = await input.readAssetSubjectBox(sourcePath);
        } catch (error: any) {
            assetSubject = {
                success: false,
                error: error?.message || String(error)
            };
        }
        const sourceResult = assetSubject && typeof assetSubject === 'object' && !Array.isArray(assetSubject)
            ? assetSubject as AssetSubjectBoxResult
            : {};
        const sourceSubject = readSubjectFacts(assetSubject);
        const prewriteResult = buildImagePlacementPrewritePlan({
            source: {
                width: Number(sourceResult.imageWidth),
                height: Number(sourceResult.imageHeight),
                ...(sourceSubject ? { subject: sourceSubject } : {})
            },
            target: {
                x: Number(block.x),
                y: Number(block.y),
                width: Number(block.width),
                height: Number(block.height)
            },
            placement: {
                fit: placement.fit === 'cover' ? 'cover' : 'contain',
                anchor: placement.anchor as ImagePlacementSpec['anchor'],
                cropPolicy: placement.cropPolicy as ImagePlacementSpec['cropPolicy'],
                ...(placement.focalPoint ? { focalPoint: placement.focalPoint } : {}),
                ...(placement.subjectFillRatio !== undefined
                    ? { subjectFillRatio: Number(placement.subjectFillRatio) }
                    : {})
            },
            canvas: input.canvas
        });
        if (!prewriteResult.ok) {
            findings.push(...prewriteResult.issues.map((issue): ResolvedImagePlacementFinding => ({
                code: issue.code,
                severity: 'repair',
                closureKind: issue.stage === 'subject-protection'
                    && issue.code !== 'protected_subject_crop_detected_prewrite'
                    ? 'observation'
                    : 'replan',
                blockId: block.id,
                role: block.role,
                message: `图片块「${block.id}」写入前没有通过落位预演：${issue.message}`,
                ...(issue.facts ? { facts: issue.facts } : {}),
                recommendedStrategies: [
                    '保持 Agent 的设计目标，补齐或修正源图、区域、锚点、关注点与裁切意图后重新预演',
                    '若裁切是有意设计，由 Agent 看过素材后明确选择 allow-crop；Harness 不会替它放行'
                ]
            })));
            continue;
        }
        plansByBlockId.set(block.id, prewriteResult.plan);
    }

    return {
        ok: findings.length === 0,
        findings,
        plansByBlockId
    };
}
