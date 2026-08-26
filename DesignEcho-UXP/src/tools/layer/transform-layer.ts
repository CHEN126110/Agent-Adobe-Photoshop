/**
 * 图层变换工具
 * 
 * 支持缩放、旋转、翻转等变换操作
 */

import {
    buildPhotoshopTransactionMutationOutcome,
    photoshopTransactionRunner,
    type PhotoshopTransactionPreparation
} from '../../core/photoshop-transaction-runner';
import { createToolFailureResult } from '../../core/tool-error-normalizer';
import {
    measureImageTargetFitOutcome,
    normalizeImageTargetBounds,
    resolveImageTargetAlignmentBounds,
    resolveImageTargetFitPlan,
    type ImageTargetAnchor,
    type ImageTargetFitOutcome,
    type ImageTargetFocalPoint,
    type ImageTargetRect
} from '../../core/image-target-fit';
import { Tool, ToolExecutionContext, ToolSchema } from '../types';

const { app, core, action } = require('photoshop');

/** 目标区域入参：支持 {x,y,width,height} 或 {left,top,right,bottom}；模型常把没用的字段填 null，允许 null 并按缺失处理 */
export interface TransformTargetBoundsParam {
    x?: number | null;
    y?: number | null;
    left?: number | null;
    top?: number | null;
    right?: number | null;
    bottom?: number | null;
    width?: number | null;
    height?: number | null;
}

interface TransformLayerParams {
    layerId?: number;
    scale?: { x: number; y: number };
    scaleUniform?: number;
    rotate?: number;
    flipHorizontal?: boolean;
    flipVertical?: boolean;
    fitToCanvas?: boolean;
    fitPercentage?: number;
    targetBounds?: TransformTargetBoundsParam;
    targetFit?: 'contain' | 'cover' | 'fill';
    targetAnchor?: ImageTargetAnchor;
    focalPoint?: ImageTargetFocalPoint;
}

interface TransformLayerState {
    documentId: number;
    layerId: number;
    parentId: number | null;
    layerName: string;
    bounds: ImageTargetRect;
}

interface TransformTargetReceipt {
    placement: ImageTargetFitOutcome;
}

interface TransformLayerResult extends Record<string, unknown> {
    success: boolean;
    code?: string;
    message?: string;
    layerId?: number;
    layerName?: string;
    originalSize?: { width: number; height: number };
    newSize?: { width: number; height: number };
    newBounds?: { left: number; top: number; width: number; height: number };
    placement?: ImageTargetFitOutcome;
    error?: string;
    errorDetails?: unknown;
}

interface TransformLayerLocation {
    layer: any;
    parentId: number | null;
}

function getLayerPixelSize(layer: any): ImageTargetRect {
    const bounds = layer?.boundsNoEffects || layer?.bounds;
    const left = Number(bounds?.left);
    const top = Number(bounds?.top);
    const right = Number(bounds?.right);
    const bottom = Number(bounds?.bottom);
    if (![left, top, right, bottom].every(Number.isFinite)
        || right <= left || bottom <= top) {
        throw new Error('变换图层适配失败：无法读取有效的图层 bounds。');
    }
    return {
        left,
        top,
        width: right - left,
        height: bottom - top
    };
}

function findTransformLayerLocation(
    container: any,
    layerId: number,
    parentId: number | null = null
): TransformLayerLocation | undefined {
    for (const layer of Array.from(container?.layers || []) as any[]) {
        if (Number(layer?.id) === layerId) return { layer, parentId };
        if (layer?.layers) {
            const nested = findTransformLayerLocation(layer, layerId, Number(layer.id));
            if (nested) return nested;
        }
    }
    return undefined;
}

function readTransformLayerState(document: any, layerId: number): TransformLayerState {
    const location = findTransformLayerLocation(document, layerId);
    if (!location) {
        throw new Error(`变换图层读回失败：未找到图层 ID ${layerId}。`);
    }
    return {
        documentId: Number(document.id),
        layerId,
        parentId: location.parentId,
        layerName: String(location.layer?.name || ''),
        bounds: getLayerPixelSize(location.layer)
    };
}

function closeTransformValue(left: number, right: number, tolerance = 0.05): boolean {
    return Math.abs(left - right) <= tolerance;
}

function sameTransformLayerTarget(
    left: TransformLayerState,
    right: TransformLayerState
): boolean {
    return left.documentId === right.documentId
        && left.layerId === right.layerId
        && left.parentId === right.parentId
        && left.layerName === right.layerName;
}

function sameTransformLayerBounds(left: ImageTargetRect, right: ImageTargetRect): boolean {
    return closeTransformValue(left.left, right.left)
        && closeTransformValue(left.top, right.top)
        && closeTransformValue(left.width, right.width)
        && closeTransformValue(left.height, right.height);
}

function buildTransformLayerFailure(
    params: TransformLayerParams,
    code: string,
    error: string
): TransformLayerResult {
    const failure = createToolFailureResult({ toolName: 'transformLayer', error, params });
    return {
        ...failure,
        success: false,
        code,
        error
    };
}

async function translateLayerWithoutNativeMove(layer: any, offsetX: number, offsetY: number): Promise<void> {
    if (offsetX === 0 && offsetY === 0) {
        return;
    }
    if (typeof layer?.translate !== 'function') {
        throw new Error('变换图层定位失败：图层对象不支持 translate，已拒绝调用 Photoshop 原生 move 命令以避免弹窗。');
    }
    await Promise.resolve(layer.translate(offsetX, offsetY));
}

async function transformLayerPercent(widthPercent: number, heightPercent: number): Promise<void> {
    await action.batchPlay([
        {
            _obj: 'transform',
            freeTransformCenterState: {
                _enum: 'quadCenterState',
                _value: 'QCSAverage'
            },
            width: {
                _unit: 'percentUnit',
                _value: widthPercent
            },
            height: {
                _unit: 'percentUnit',
                _value: heightPercent
            },
            _options: {
                dialogOptions: 'dontDisplay'
            }
        }
    ], { synchronousExecution: true });
}

/**
 * 把图层缩放并移动到目标区域（必须在 executeAsModal 内调用，且目标图层已被选中）。
 * 几何由 core/image-target-fit 统一求解；本函数只负责执行 Photoshop 变换并读回事实。
 */
async function fitLayerToTargetBounds(
    layer: any,
    target: { left: number; top: number; width: number; height: number },
    fit: 'contain' | 'cover' | 'fill' | undefined,
    targetAnchor: ImageTargetAnchor | undefined,
    focalPoint: ImageTargetFocalPoint | undefined
): Promise<ImageTargetFitOutcome> {
    const before = getLayerPixelSize(layer);
    const scalePlan = resolveImageTargetFitPlan({
        sourceBounds: before,
        targetBounds: target,
        fit,
        targetAnchor,
        focalPoint
    });

    if (Math.abs(scalePlan.widthPercent - 100) > 0.05
        || Math.abs(scalePlan.heightPercent - 100) > 0.05) {
        await transformLayerPercent(scalePlan.widthPercent, scalePlan.heightPercent);
    }

    const scaledBounds = getLayerPixelSize(layer);
    const alignedBounds = resolveImageTargetAlignmentBounds({
        sourceBounds: scaledBounds,
        targetBounds: target,
        fit,
        targetAnchor,
        focalPoint
    });
    await translateLayerWithoutNativeMove(
        layer,
        alignedBounds.left - scaledBounds.left,
        alignedBounds.top - scaledBounds.top
    );
    const actualBounds = getLayerPixelSize(layer);
    return measureImageTargetFitOutcome(
        {
            ...scalePlan,
            expectedBounds: alignedBounds
        },
        actualBounds
    );
}

async function selectTransformTargetLayer(layerId: number): Promise<void> {
    await action.batchPlay([{
        _obj: 'select',
        _target: [{ _ref: 'layer', _id: layerId }],
        makeVisible: false,
        _options: { dialogOptions: 'dontDisplay' }
    }], { synchronousExecution: true });
}

async function applyTargetBoundsPrelude(
    params: TransformLayerParams
): Promise<void> {
    const rotateAngle = Number(params.rotate || 0);
    if (rotateAngle !== 0) {
        await action.batchPlay([{
            _obj: 'transform',
            freeTransformCenterState: {
                _enum: 'quadCenterState',
                _value: 'QCSAverage'
            },
            width: { _unit: 'percentUnit', _value: 100 },
            height: { _unit: 'percentUnit', _value: 100 },
            angle: { _unit: 'angleUnit', _value: rotateAngle },
            _options: { dialogOptions: 'dontDisplay' }
        }], { synchronousExecution: true });
    }

    if (params.flipHorizontal === true) {
        await action.batchPlay([{
            _obj: 'flip',
            axis: { _enum: 'orientation', _value: 'horizontal' },
            _options: { dialogOptions: 'dontDisplay' }
        }], { synchronousExecution: true });
    }

    if (params.flipVertical === true) {
        await action.batchPlay([{
            _obj: 'flip',
            axis: { _enum: 'orientation', _value: 'vertical' },
            _options: { dialogOptions: 'dontDisplay' }
        }], { synchronousExecution: true });
    }
}

/**
 * 变换图层工具
 */
export class TransformLayerTool implements Tool {
    name = 'transformLayer';

    schema: ToolSchema = {
        name: 'transformLayer',
        description: '变换图层：缩放、旋转、翻转。可以调整图层大小、旋转角度或翻转方向。',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '图层 ID（可选，默认使用当前选中图层）'
                },
                scale: {
                    type: 'object',
                    description: '缩放比例',
                    properties: {
                        x: { type: 'number', description: '水平缩放百分比 (如 50 表示缩小到 50%)' },
                        y: { type: 'number', description: '垂直缩放百分比 (如 50 表示缩小到 50%)' }
                    }
                },
                scaleUniform: {
                    type: 'number',
                    description: '统一缩放百分比（如 80 表示缩小到 80%）'
                },
                rotate: {
                    type: 'number',
                    description: '旋转角度（度数，正值顺时针，负值逆时针）'
                },
                flipHorizontal: {
                    type: 'boolean',
                    description: '是否水平翻转'
                },
                flipVertical: {
                    type: 'boolean',
                    description: '是否垂直翻转'
                },
                fitToCanvas: {
                    type: 'boolean',
                    description: '是否自动适应画布大小'
                },
                fitPercentage: {
                    type: 'number',
                    description: '适应画布时由 Agent 明确选择的目标百分比'
                },
                targetBounds: {
                    type: 'object',
                    description: '目标区域（画布像素），支持 {x,y,width,height} 或 {left,top,right,bottom}。提供后按 targetFit 一次完成缩放+落位；与 scaleUniform/scale/fitToCanvas/fitPercentage 互斥'
                },
                targetFit: {
                    type: 'string',
                    enum: ['contain', 'cover', 'fill'],
                    description: 'targetBounds 适配方式：contain 完整放入（默认）、cover 铺满区域、fill 拉伸填充'
                },
                targetAnchor: {
                    type: 'string',
                    enum: ['center', 'top-center', 'bottom-center', 'left-center', 'right-center'],
                    description: '目标区域内的图框对齐方式，默认 center；focalPoint 存在时由 focalPoint 优先控制落位。fill 只接受 center'
                },
                focalPoint: {
                    type: 'object',
                    properties: {
                        x: { type: 'number', description: '0 到 1 的归一化横向位置' },
                        y: { type: 'number', description: '0 到 1 的归一化纵向位置' }
                    },
                    required: ['x', 'y'],
                    description: '源图中的归一化关注点；存在时优先将该点对准目标区域中心，并在无空洞范围内夹紧。不能与 fill 或同一次 rotate/flip 混用'
                }
            }
        }
    };

    async execute(
        params: TransformLayerParams,
        context?: ToolExecutionContext
    ): Promise<TransformLayerResult> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return createToolFailureResult({ toolName: this.name, error: '没有打开的文档', params });
            }
            if (params.rotate !== undefined && !Number.isFinite(Number(params.rotate))) {
                return buildTransformLayerFailure(
                    params,
                    'transform_layer_rotate_invalid',
                    `rotate 必须是有限数值，收到 ${String(params.rotate)}。`
                );
            }

            // targetBounds：目标区域表达。先校验，再检查与相对缩放参数的互斥。
            let normalizedTargetBounds: { left: number; top: number; width: number; height: number } | null = null;
            if (params.targetBounds !== undefined) {
                normalizedTargetBounds = normalizeImageTargetBounds(params.targetBounds);
                if (!normalizedTargetBounds) {
                    return createToolFailureResult({
                        toolName: this.name,
                        error: 'targetBounds 无效：需要 {x,y,width,height} 或 {left,top,right,bottom}，且 width/height 必须为正数',
                        params
                    });
                }
                resolveImageTargetFitPlan({
                    sourceBounds: { left: 0, top: 0, width: 1, height: 1 },
                    targetBounds: normalizedTargetBounds,
                    fit: params.targetFit,
                    targetAnchor: params.targetAnchor,
                    focalPoint: params.focalPoint
                });
                if (params.focalPoint
                    && (Number(params.rotate || 0) !== 0
                        || params.flipHorizontal === true
                        || params.flipVertical === true)) {
                    return createToolFailureResult({
                        toolName: this.name,
                        error: 'focalPoint 不能与同一次 rotate/flip 混用：旋转或翻转会改变源图关注点坐标。请先完成旋转/翻转并读回，再按最终画面声明 focalPoint。',
                        params
                    });
                }
                const conflictingScaleParams = [
                    params.scaleUniform !== undefined ? 'scaleUniform' : '',
                    params.scale !== undefined ? 'scale' : '',
                    params.fitToCanvas ? 'fitToCanvas' : '',
                    params.fitPercentage !== undefined ? 'fitPercentage' : ''
                ].filter(Boolean);
                if (conflictingScaleParams.length > 0) {
                    return createToolFailureResult({
                        toolName: this.name,
                        error: `targetBounds 与 ${conflictingScaleParams.join('/')} 互斥：targetBounds 本身就是缩放+落位的完整表达，请只保留其中一种缩放方式`,
                        params
                    });
                }
            } else if (params.targetFit !== undefined
                || params.targetAnchor !== undefined
                || params.focalPoint !== undefined) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: 'targetFit、targetAnchor 与 focalPoint 只在提供有效 targetBounds 时生效；已拒绝忽略这些参数。',
                    params
                });
            }

            // 获取目标图层
            let layer;
            if (params.layerId) {
                // 确保 layerId 是数字类型
                const numericId = typeof params.layerId === 'string' 
                    ? parseInt(params.layerId as unknown as string, 10) 
                    : params.layerId;
                layer = this.findLayerById(doc, numericId);
                if (!layer) {
                    return createToolFailureResult({ toolName: this.name, error: `未找到 ID 为 ${numericId} 的图层`, params });
                }
            } else {
                layer = doc.activeLayers[0];
                if (!layer) {
                    return createToolFailureResult({ toolName: this.name, error: '没有选中的图层', params });
                }
            }

            console.log(`[TransformLayer] 变换图层: ${layer.name} (ID: ${layer.id})`);

            if (normalizedTargetBounds) {
                return await this.executeTargetBoundsTransaction(
                    params,
                    context,
                    Number(layer.id),
                    normalizedTargetBounds
                );
            }

            // 获取原始尺寸：走与结果 newBounds/newSize、targetBounds 适配算法相同的
            // boundsNoEffects 优先读取（getLayerPixelSize）。直接读 layer.bounds 会把投影等
            // 图层效果外扩算进来，对带效果的图层报出虚假的尺寸变化。
            const originalPixelSize = getLayerPixelSize(layer);
            const originalWidth = originalPixelSize.width;
            const originalHeight = originalPixelSize.height;

            console.log(`[TransformLayer] 原始尺寸: ${originalWidth}x${originalHeight}`);

            let scaleX = 100;
            let scaleY = 100;
            let rotateAngle = 0;

            // 处理适应画布
            if (params.fitToCanvas) {
                if (!Number.isFinite(Number(params.fitPercentage)) || Number(params.fitPercentage) <= 0) {
                    return createToolFailureResult({
                        toolName: this.name,
                        error: 'fitToCanvas 需要显式 fitPercentage；工具不再替设计者套用默认视觉占比',
                        params
                    });
                }
                const targetPercent = Number(params.fitPercentage);
                const canvasWidth = doc.width;
                const canvasHeight = doc.height;
                
                // 计算缩放比例以适应画布
                const scaleToFitWidth = (canvasWidth * targetPercent / 100) / originalWidth * 100;
                const scaleToFitHeight = (canvasHeight * targetPercent / 100) / originalHeight * 100;
                const uniformScale = Math.min(scaleToFitWidth, scaleToFitHeight);
                
                scaleX = uniformScale;
                scaleY = uniformScale;
                console.log(`[TransformLayer] 适应画布: ${targetPercent}% → 缩放 ${uniformScale.toFixed(1)}%`);
            }
            // 处理统一缩放
            else if (params.scaleUniform !== undefined) {
                scaleX = params.scaleUniform;
                scaleY = params.scaleUniform;
            }
            // 处理独立缩放
            else if (params.scale) {
                scaleX = params.scale.x ?? 100;
                scaleY = params.scale.y ?? 100;
            }

            // 处理旋转
            if (params.rotate !== undefined) {
                rotateAngle = params.rotate;
            }

            // 执行变换
            await core.executeAsModal(async () => {
                // 选中目标图层。选择失败必须停止，否则可能变换当前活动图层而不是目标图层。
                await action.batchPlay([{
                    _obj: 'select',
                    _target: [{ _ref: 'layer', _id: layer.id }],
                    makeVisible: false,
                    _options: { dialogOptions: 'dontDisplay' }
                }], { synchronousExecution: true });

                const needsScale = scaleX !== 100 || scaleY !== 100;
                const needsRotate = rotateAngle !== 0;

                // ★ 优先使用 UXP DOM API 的 resize 方法（更可靠，不会触发"变换不可用"错误）；
                // 有旋转或翻转时需要 batchPlay。
                let useResizeMethod = !(needsRotate || params.flipHorizontal || params.flipVertical);

                if (needsScale && useResizeMethod) {
                    // 方法1: 使用 layer.resize()（更可靠）
                    try {
                        // resize 接受百分比参数
                        await layer.resize(scaleX, scaleY);
                        console.log(`[TransformLayer] ✓ 使用 resize() 缩放: ${scaleX}% x ${scaleY}%`);
                    } catch (resizeErr: any) {
                        console.warn('[TransformLayer] resize() 失败，尝试 batchPlay:', resizeErr.message);
                        useResizeMethod = false;
                    }
                }

                // 方法2: batchPlay（缩放 resize 失败时的备选；有旋转时也走这里——
                // 旧实现把旋转塞在缩放分支里，导致"只旋转不缩放"时什么都不执行。
                // 注意：进入此块时 useResizeMethod 必为 false（有旋转/翻转在前面已置 false，
                // 或 resize 失败被置 false），scaleX/scaleY 未缩放时为 100，直接放进描述符即可。
                if ((needsScale && !useResizeMethod) || needsRotate) {
                    const transformDescriptor: any = {
                        _obj: 'transform',
                        freeTransformCenterState: {
                            _enum: 'quadCenterState',
                            _value: 'QCSAverage'
                        },
                        width: { _unit: 'percentUnit', _value: scaleX },
                        height: { _unit: 'percentUnit', _value: scaleY },
                        _options: { dialogOptions: 'dontDisplay' }
                    };

                    // 添加旋转
                    if (needsRotate) {
                        transformDescriptor.angle = { _unit: 'angleUnit', _value: rotateAngle };
                    }

                    await action.batchPlay([transformDescriptor], { synchronousExecution: true });
                    console.log(`[TransformLayer] ✓ 使用 batchPlay 变换: ${scaleX}% x ${scaleY}%, 旋转 ${rotateAngle}°`);
                }

                // 处理翻转（需要使用 batchPlay）
                if (params.flipHorizontal) {
                    await action.batchPlay([
                        {
                            _obj: 'flip',
                            axis: { _enum: 'orientation', _value: 'horizontal' },
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });
                }

                if (params.flipVertical) {
                    await action.batchPlay([
                        {
                            _obj: 'flip',
                            axis: { _enum: 'orientation', _value: 'vertical' },
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });
                }

            }, { commandName: '变换图层' });

            // 获取新尺寸（boundsNoEffects 优先，与 targetBounds 适配算法的读数一致）
            const newBounds = layer.boundsNoEffects || layer.bounds;
            const newWidth = newBounds.right - newBounds.left;
            const newHeight = newBounds.bottom - newBounds.top;

            const message = this.buildMessage(params, scaleX, scaleY, rotateAngle, originalWidth, originalHeight, newWidth, newHeight);

            return {
                success: true,
                message,
                layerId: layer.id,
                layerName: layer.name,
                originalSize: { width: originalWidth, height: originalHeight },
                newSize: { width: Math.round(newWidth), height: Math.round(newHeight) },
                newBounds: {
                    left: Math.round(Number(newBounds.left)),
                    top: Math.round(Number(newBounds.top)),
                    width: Math.round(newWidth),
                    height: Math.round(newHeight)
                }
            };

        } catch (error: any) {
            console.error('[TransformLayer] 错误:', error);
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }

    private async executeTargetBoundsTransaction(
        params: TransformLayerParams,
        context: ToolExecutionContext | undefined,
        layerId: number,
        targetBounds: ImageTargetRect
    ): Promise<TransformLayerResult> {
        const rotateAngle = Number(params.rotate || 0);
        const operationId = `transformLayer:targetBounds:${String(context?.requestId || Date.now())}`;

        return await photoshopTransactionRunner.run<
            TransformLayerState,
            TransformLayerState,
            TransformLayerResult,
            TransformTargetReceipt
        >({
            operationId,
            toolName: this.name,
            commandName: 'DesignEcho: 变换图层到目标区域',
            params,
            context,
            historyMode: 'suspend',
            expectedEffect: 'mutation_required',
            rollbackTargetPolicy: 'document_revision',
            prepare: (scope): PhotoshopTransactionPreparation<
                TransformLayerState,
                TransformLayerResult
            > => {
                const location = findTransformLayerLocation(scope.document, layerId);
                if (!location) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildTransformLayerFailure(
                            params,
                            'transform_layer_target_not_found',
                            `变换图层失败：未找到图层 ID ${layerId}。请重新读取图层结构后重试。`
                        )
                    };
                }
                if (location.layer.locked || location.layer.isBackgroundLayer) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildTransformLayerFailure(
                            params,
                            'transform_layer_target_not_transformable',
                            `变换图层失败：图层“${String(location.layer.name || layerId)}”已锁定或是背景层。请先解锁或转换为普通图层。`
                        )
                    };
                }

                const before = readTransformLayerState(scope.document, layerId);
                const currentPlan = resolveImageTargetFitPlan({
                    sourceBounds: before.bounds,
                    targetBounds,
                    fit: params.targetFit,
                    targetAnchor: params.targetAnchor,
                    focalPoint: params.focalPoint
                });
                const currentPlacement = measureImageTargetFitOutcome(
                    currentPlan,
                    before.bounds
                );
                const hasPreludeMutation = rotateAngle !== 0
                    || params.flipHorizontal === true
                    || params.flipVertical === true;
                if (!hasPreludeMutation
                    && currentPlacement.geometryVerification.verified) {
                    return {
                        kind: 'complete',
                        effect: 'already_satisfied',
                        result: this.buildTargetBoundsSuccessResult(
                            params,
                            before,
                            before,
                            currentPlacement
                        )
                    };
                }
                return { kind: 'ready', before };
            },
            mutate: async (scope, before) => {
                const current = readTransformLayerState(scope.document, before.layerId);
                if (!sameTransformLayerTarget(before, current)
                    || !sameTransformLayerBounds(before.bounds, current.bounds)) {
                    return buildTransformLayerFailure(
                        params,
                        'transform_layer_target_changed',
                        '变换图层失败：写入前目标图层、父级或 bounds 已变化。请重新读取图层结构后重试。'
                    );
                }
                const location = findTransformLayerLocation(
                    scope.document,
                    before.layerId
                );
                if (!location) {
                    return buildTransformLayerFailure(
                        params,
                        'transform_layer_target_not_found',
                        `变换图层失败：写入前未找到图层 ID ${before.layerId}。请重新读取图层结构后重试。`
                    );
                }

                await selectTransformTargetLayer(before.layerId);
                await applyTargetBoundsPrelude(params);
                const placement = await fitLayerToTargetBounds(
                    location.layer,
                    targetBounds,
                    params.targetFit,
                    params.targetAnchor,
                    params.focalPoint
                );
                const afterMutation = readTransformLayerState(
                    scope.document,
                    before.layerId
                );
                return buildPhotoshopTransactionMutationOutcome(
                    this.buildTargetBoundsSuccessResult(
                        params,
                        before,
                        afterMutation,
                        placement
                    ),
                    { placement }
                );
            },
            readState({ scope, before }): TransformLayerState {
                return readTransformLayerState(scope.document, before.layerId);
            },
            verifyApplied({ before, after, receipt }) {
                const placement = receipt?.placement
                    ? measureImageTargetFitOutcome(receipt.placement, after.bounds)
                    : undefined;
                return {
                    verified: sameTransformLayerTarget(before, after)
                        && placement?.geometryVerification.verified === true,
                    message: `变换图层写后读回与目标框不一致：图层 ID=${after.layerId}，bounds=${after.bounds.left.toFixed(2)},${after.bounds.top.toFixed(2)},${after.bounds.width.toFixed(2)}×${after.bounds.height.toFixed(2)}，几何问题=[${placement?.geometryVerification.issues.join(', ') || 'missing_placement_receipt'}]。本次写入将回滚。`
                };
            },
            verifyRolledBack({ before, after }) {
                return {
                    verified: sameTransformLayerTarget(before, after)
                        && sameTransformLayerBounds(before.bounds, after.bounds),
                    message: `变换图层失败后的 bounds 未恢复：写前=${before.bounds.left.toFixed(2)},${before.bounds.top.toFixed(2)},${before.bounds.width.toFixed(2)}×${before.bounds.height.toFixed(2)}，回滚后=${after.bounds.left.toFixed(2)},${after.bounds.top.toFixed(2)},${after.bounds.width.toFixed(2)}×${after.bounds.height.toFixed(2)}。`
                };
            },
            buildVerifiedResult: ({ before, after, receipt }): TransformLayerResult => {
                const placement = measureImageTargetFitOutcome(
                    receipt?.placement as ImageTargetFitOutcome,
                    after.bounds
                );
                return this.buildTargetBoundsSuccessResult(
                    params,
                    before,
                    after,
                    placement
                );
            }
        });
    }

    private buildTargetBoundsSuccessResult(
        params: TransformLayerParams,
        before: TransformLayerState,
        after: TransformLayerState,
        placement: ImageTargetFitOutcome
    ): TransformLayerResult {
        return {
            success: true,
            message: this.buildMessage(
                params,
                100,
                100,
                Number(params.rotate || 0),
                before.bounds.width,
                before.bounds.height,
                after.bounds.width,
                after.bounds.height
            ),
            layerId: after.layerId,
            layerName: after.layerName,
            originalSize: {
                width: before.bounds.width,
                height: before.bounds.height
            },
            newSize: {
                width: Math.round(after.bounds.width),
                height: Math.round(after.bounds.height)
            },
            newBounds: {
                left: Math.round(after.bounds.left),
                top: Math.round(after.bounds.top),
                width: Math.round(after.bounds.width),
                height: Math.round(after.bounds.height)
            },
            placement
        };
    }

    /**
     * 构建结果消息
     */
    private buildMessage(
        params: any,
        scaleX: number,
        scaleY: number,
        rotateAngle: number,
        origW: number,
        origH: number,
        newW: number,
        newH: number
    ): string {
        const parts: string[] = [];

        if (params.targetBounds) {
            parts.push(`适配目标区域(${params.targetFit || 'contain'})`);
        } else if (params.fitToCanvas) {
            parts.push(`适应画布 (${params.fitPercentage}%)`);
        } else if (scaleX !== 100 || scaleY !== 100) {
            if (scaleX === scaleY) {
                parts.push(`缩放 ${scaleX}%`);
            } else {
                parts.push(`缩放 ${scaleX}% × ${scaleY}%`);
            }
        }

        if (rotateAngle !== 0) {
            parts.push(`旋转 ${rotateAngle}°`);
        }

        if (params.flipHorizontal) {
            parts.push('水平翻转');
        }

        if (params.flipVertical) {
            parts.push('垂直翻转');
        }

        const action = parts.length > 0 ? parts.join('，') : '无变换';
        return `${action}。尺寸: ${Math.round(origW)}×${Math.round(origH)} → ${Math.round(newW)}×${Math.round(newH)}`;
    }

    /**
     * 递归查找图层
     */
    private findLayerById(container: any, id: number): any {
        for (const layer of container.layers) {
            if (layer.id === id) return layer;
            if (layer.layers) {
                const found = this.findLayerById(layer, id);
                if (found) return found;
            }
        }
        return null;
    }
}

/**
 * 快速缩放工具 - 简化版
 */
interface QuickScaleBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

interface QuickScaleState {
    documentId: number;
    layerId: number;
    parentId: number | null;
    layerName: string;
    bounds: QuickScaleBounds;
}

interface QuickScaleBefore extends QuickScaleState {
    percent: number;
}

interface QuickScaleResult extends Record<string, unknown> {
    success: boolean;
    code?: string;
    message?: string;
    layerId?: number;
    layerName?: string;
    originalSize?: { width: number; height: number };
    newSize?: { width: number; height: number };
    newBounds?: { left: number; top: number; width: number; height: number };
    error?: string;
    errorDetails?: unknown;
    data?: null;
}

interface QuickScaleLayerLocation {
    layer: any;
    parentId: number | null;
}

function findQuickScaleLayerLocation(
    container: any,
    layerId: number,
    parentId: number | null = null
): QuickScaleLayerLocation | undefined {
    for (const layer of Array.from(container?.layers || []) as any[]) {
        if (Number(layer?.id) === layerId) {
            return { layer, parentId };
        }
        if (layer?.layers) {
            const nested = findQuickScaleLayerLocation(
                layer,
                layerId,
                Number(layer.id)
            );
            if (nested) return nested;
        }
    }
    return undefined;
}

function readQuickScaleBounds(layer: any): QuickScaleBounds {
    const bounds = layer?.boundsNoEffects || layer?.bounds;
    const left = Number(bounds?.left);
    const top = Number(bounds?.top);
    const right = Number(bounds?.right);
    const bottom = Number(bounds?.bottom);
    if (![left, top, right, bottom].every(Number.isFinite)) {
        throw new Error(`无法读取图层 ID ${String(layer?.id || '')} 的有效 bounds。`);
    }
    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0) {
        throw new Error(`图层 ID ${String(layer?.id || '')} 的 bounds 为空，无法验证缩放结果。`);
    }
    return { left, top, right, bottom, width, height };
}

function readQuickScaleState(document: any, layerId: number): QuickScaleState {
    const location = findQuickScaleLayerLocation(document, layerId);
    if (!location) {
        throw new Error(`缩放写后读回未找到图层 ID ${layerId}。`);
    }
    return {
        documentId: Number(document.id),
        layerId,
        parentId: location.parentId,
        layerName: String(location.layer.name || ''),
        bounds: readQuickScaleBounds(location.layer)
    };
}

function sameQuickScaleTarget(left: QuickScaleState, right: QuickScaleState): boolean {
    return left.documentId === right.documentId
        && left.layerId === right.layerId
        && left.parentId === right.parentId
        && left.layerName === right.layerName;
}

function closeEnough(left: number, right: number, tolerance: number): boolean {
    return Math.abs(left - right) <= tolerance;
}

function sameQuickScaleBounds(left: QuickScaleBounds, right: QuickScaleBounds): boolean {
    return closeEnough(left.left, right.left, 0.05)
        && closeEnough(left.top, right.top, 0.05)
        && closeEnough(left.right, right.right, 0.05)
        && closeEnough(left.bottom, right.bottom, 0.05);
}

function verifyQuickScaleRatio(before: QuickScaleBefore, after: QuickScaleState): boolean {
    const expectedRatio = before.percent / 100;
    const actualWidthRatio = after.bounds.width / before.bounds.width;
    const actualHeightRatio = after.bounds.height / before.bounds.height;
    const tolerance = Math.max(0.02, expectedRatio * 0.02);
    return closeEnough(actualWidthRatio, expectedRatio, tolerance)
        && closeEnough(actualHeightRatio, expectedRatio, tolerance);
}

async function selectQuickScaleLayer(layerId: number): Promise<void> {
    await action.batchPlay([{
        _obj: 'select',
        _target: [{ _ref: 'layer', _id: layerId }],
        makeVisible: false,
        _options: { dialogOptions: 'dontDisplay' }
    }], {});
}

async function resizeQuickScaleLayer(layer: any, percent: number): Promise<void> {
    if (typeof layer?.resize === 'function') {
        try {
            await layer.resize(percent, percent);
            return;
        } catch (error) {
            console.warn('[QuickScale] DOM resize 失败，改用 batchPlay transform:', error);
        }
    }
    await transformLayerPercent(percent, percent);
}

function buildQuickScaleFailure(
    params: { percent?: number; fitCanvas?: boolean },
    code: string,
    error: string
): QuickScaleResult {
    const failure = createToolFailureResult({ toolName: 'quickScale', error, params });
    return {
        ...failure,
        success: false,
        code,
        error
    };
}

function buildQuickScaleSuccess(
    before: QuickScaleBefore,
    after: QuickScaleState
): QuickScaleResult {
    return {
        success: true,
        message: `缩放 ${before.percent.toFixed(2)}%。尺寸: ${Math.round(before.bounds.width)}×${Math.round(before.bounds.height)} → ${Math.round(after.bounds.width)}×${Math.round(after.bounds.height)}`,
        layerId: after.layerId,
        layerName: after.layerName,
        originalSize: {
            width: before.bounds.width,
            height: before.bounds.height
        },
        newSize: {
            width: Math.round(after.bounds.width),
            height: Math.round(after.bounds.height)
        },
        newBounds: {
            left: Math.round(after.bounds.left),
            top: Math.round(after.bounds.top),
            width: Math.round(after.bounds.width),
            height: Math.round(after.bounds.height)
        }
    };
}

export class QuickScaleTool implements Tool {
    name = 'quickScale';

    schema: ToolSchema = {
        name: 'quickScale',
        description: '快速缩放当前图层。输入百分比即可，如 50 表示缩小到一半，200 表示放大一倍；成功前会读回实际 bounds 比例。',
        parameters: {
            type: 'object',
            properties: {
                percent: {
                    type: 'number',
                    description: '缩放百分比（如 50 表示缩小到 50%，200 表示放大到 200%）'
                },
                fitCanvas: {
                    type: 'boolean',
                    description: '是否自动适应画布（忽略 percent 参数）'
                }
            },
            required: ['percent']
        }
    };

    async execute(
        params: { percent?: number; fitCanvas?: boolean },
        context?: ToolExecutionContext
    ): Promise<QuickScaleResult> {
        const safeParams = params || {};
        const operationId = `quickScale:${String(context?.requestId || Date.now())}`;

        return await photoshopTransactionRunner.run<
            QuickScaleBefore,
            QuickScaleState,
            QuickScaleResult
        >({
            operationId,
            toolName: this.name,
            commandName: 'DesignEcho: 快速缩放图层',
            params: safeParams,
            context,
            historyMode: 'suspend',
            expectedEffect: 'mutation_required',
            rollbackTargetPolicy: 'document_revision',
            prepare(scope): PhotoshopTransactionPreparation<QuickScaleBefore, QuickScaleResult> {
                const layerId = Number(scope.document.activeLayers?.[0]?.id);
                if (!Number.isSafeInteger(layerId) || layerId <= 0) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildQuickScaleFailure(
                            safeParams,
                            'quick_scale_target_required',
                            '快速缩放失败：没有选中的图层。请先选择目标图层后重试。'
                        )
                    };
                }
                const location = findQuickScaleLayerLocation(scope.document, layerId);
                if (!location) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildQuickScaleFailure(
                            safeParams,
                            'quick_scale_target_not_found',
                            `快速缩放失败：未找到图层 ID ${layerId}。请重新读取图层结构后重试。`
                        )
                    };
                }
                if (location.layer.locked || location.layer.isBackgroundLayer) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildQuickScaleFailure(
                            safeParams,
                            'quick_scale_target_not_resizable',
                            `快速缩放失败：图层“${String(location.layer.name || layerId)}”已锁定或是背景层。请先解锁或转换为普通图层。`
                        )
                    };
                }
                const state = readQuickScaleState(scope.document, layerId);
                let percent = Number(safeParams.percent);
                if (safeParams.fitCanvas === true) {
                    const canvasWidth = Number(scope.document.width);
                    const canvasHeight = Number(scope.document.height);
                    if (!Number.isFinite(canvasWidth)
                        || !Number.isFinite(canvasHeight)
                        || canvasWidth <= 0
                        || canvasHeight <= 0) {
                        return {
                            kind: 'complete',
                            effect: 'none',
                            result: buildQuickScaleFailure(
                                safeParams,
                                'quick_scale_canvas_bounds_invalid',
                                '快速缩放失败：无法读取有效画布尺寸。请重新读取文档信息后重试。'
                            )
                        };
                    }
                    const widthPercent = (canvasWidth * 0.8 / state.bounds.width) * 100;
                    const heightPercent = (canvasHeight * 0.8 / state.bounds.height) * 100;
                    percent = Math.min(widthPercent, heightPercent);
                }
                if (!Number.isFinite(percent) || percent <= 0) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildQuickScaleFailure(
                            safeParams,
                            'quick_scale_percent_invalid',
                            `快速缩放失败：percent 必须是大于 0 的有限数值，收到 ${String(safeParams.percent)}。请修正缩放比例后重试。`
                        )
                    };
                }
                const before: QuickScaleBefore = { ...state, percent };
                if (closeEnough(percent, 100, 0.001)) {
                    return {
                        kind: 'complete',
                        effect: 'already_satisfied',
                        result: buildQuickScaleSuccess(before, state)
                    };
                }
                return { kind: 'ready', before };
            },
            async mutate(scope, before): Promise<QuickScaleResult> {
                const location = findQuickScaleLayerLocation(scope.document, before.layerId);
                if (!location || location.parentId !== before.parentId) {
                    return buildQuickScaleFailure(
                        safeParams,
                        'quick_scale_target_changed',
                        '快速缩放失败：写入前目标图层或其父级已变化。请重新读取图层结构后重试。'
                    );
                }
                await selectQuickScaleLayer(before.layerId);
                await resizeQuickScaleLayer(location.layer, before.percent);
                return {
                    success: true,
                    layerId: before.layerId,
                    layerName: before.layerName,
                    originalSize: {
                        width: before.bounds.width,
                        height: before.bounds.height
                    }
                };
            },
            readState({ scope, before }): QuickScaleState {
                return readQuickScaleState(scope.document, before.layerId);
            },
            verifyApplied({ before, after }) {
                return {
                    verified: sameQuickScaleTarget(before, after)
                        && verifyQuickScaleRatio(before, after),
                    message: `快速缩放写后读回比例不一致：请求 ${before.percent.toFixed(4)}%，实际宽度 ${(after.bounds.width / before.bounds.width * 100).toFixed(4)}%、高度 ${(after.bounds.height / before.bounds.height * 100).toFixed(4)}%。`
                };
            },
            verifyRolledBack({ before, after }) {
                return {
                    verified: sameQuickScaleTarget(before, after)
                        && sameQuickScaleBounds(before.bounds, after.bounds),
                    message: '快速缩放失败后的图层 bounds 未恢复到事务开始前。'
                };
            },
            buildVerifiedResult({ before, after }): QuickScaleResult {
                return buildQuickScaleSuccess(before, after);
            }
        });
    }
}

export default TransformLayerTool;
