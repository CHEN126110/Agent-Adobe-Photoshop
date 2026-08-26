/**
 * 置入图片工具
 * 
 * 将外部图片置入到当前 Photoshop 文档中
 * 支持从 Base64 数据或文件路径置入
 */

import { getEntryFromPath } from '../../core/file-url';
import {
    measureImageTargetFitOutcome,
    normalizeImageTargetBounds,
    resolveImageTargetAlignmentBounds,
    resolveImageTargetFitPlan,
    type ImageTargetAnchor,
    type ImageTargetFitOutcome,
    type ImageTargetFocalPoint
} from '../../core/image-target-fit';
import {
    buildPhotoshopTransactionMutationOutcome,
    photoshopTransactionRunner,
    type PhotoshopTransactionPreparation
} from '../../core/photoshop-transaction-runner';
import { createToolFailureResult } from '../../core/tool-error-normalizer';
import {
    arrayBufferFromBytes,
    assertImageBytesSafeForPhotoshop,
    bytesFromBase64ImagePayload,
    readFileEntryBytes
} from '../../core/image-safety';
import { getPhotoshopElementPlacement } from '../layout/photoshop-runtime-adapters';
import { Tool, ToolExecutionContext, ToolSchema } from '../types';

const { app, action, constants } = require('photoshop');
const uxp = require('uxp');
const fs = uxp.storage.localFileSystem;
const REQUEST_CANCELLED_ERROR = 'REQUEST_CANCELLED';

function isRequestCancelled(context?: ToolExecutionContext): boolean {
    return Boolean(context?.isCancelled?.());
}

function throwIfRequestCancelled(context?: ToolExecutionContext): void {
    if (isRequestCancelled(context)) {
        const error = new Error('请求已取消');
        (error as Error & { code?: string }).code = REQUEST_CANCELLED_ERROR;
        throw error;
    }
}

function buildCancelledToolResult(): PlaceImageResult {
    return {
        success: false,
        code: 'request_cancelled',
        error: '请求已取消',
        data: {
            cancelled: true
        }
    };
}

export interface PlaceImageParams {
    /** 图片 Base64 数据 */
    imageData?: string;
    /** imageData 时的格式：png|jpeg|gif（默认 png） */
    imageFormat?: string;
    /** 图片文件路径（本地路径） */
    filePath?: string;
    /** UXP 会话文件 token（优先于 filePath） */
    fileToken?: string;
    /** 图片名称（用于图层命名） */
    name?: string;
    /** 置入位置 X */
    x?: number;
    /** 置入位置 Y */
    y?: number;
    /** 缩放百分比，默认 100；可大于 100 表示放大 */
    scale?: number;
    /** 是否居中置入 */
    center?: boolean;
    /** 是否自动调整大小以适应画布 */
    fitToCanvas?: boolean;
    /** 配合 fitToCanvas：true 时允许放大超过原始尺寸铺满画布；默认 false 只缩不放（封顶 100%） */
    allowUpscale?: boolean;
    /** 目标区域：支持 {x,y,width,height} 或 {left,top,right,bottom}；模型常把没用的字段填 null，允许 null 并按缺失处理 */
    targetBounds?: {
        x?: number | null;
        y?: number | null;
        left?: number | null;
        top?: number | null;
        right?: number | null;
        bottom?: number | null;
        width?: number | null;
        height?: number | null;
    };
    /** 目标区域适配方式 */
    targetFit?: 'contain' | 'cover' | 'fill';
    /** 图框在目标区域中的对齐方式；focalPoint 存在时优先由 focalPoint 控制落位 */
    targetAnchor?: ImageTargetAnchor;
    /** 源图中的归一化关注点；存在时优先将该点对准目标区域中心 */
    focalPoint?: ImageTargetFocalPoint;
    /** 图层层级：belowText 用于让置入图位于可编辑文字下方 */
    layerOrder?: 'front' | 'belowText' | 'back';
    /** 来源资产ID（Agent 侧传入，用于追踪） */
    sourceAssetId?: string;
    /** 来源校验和（Agent 侧传入，用于一致性校验） */
    sourceChecksum?: string;
    /** 来源字节长度（Agent 侧传入，用于一致性校验） */
    sourceByteLength?: number;
    /** 来源路径（仅日志） */
    sourcePath?: string;
}

function hasOwnParameter(params: PlaceImageParams, key: keyof PlaceImageParams): boolean {
    return Object.prototype.hasOwnProperty.call(params, key);
}

/**
 * targetBounds 已完整表达缩放与落位。其它定位/缩放字段若同时出现会被执行点拒绝，
 * 避免调用方误以为这些参数已经生效。
 */
function collectTargetBoundsConflictingParameters(params: PlaceImageParams): string[] {
    const keys: Array<keyof PlaceImageParams> = [
        'scale',
        'fitToCanvas',
        'x',
        'y',
        'center',
        'allowUpscale'
    ];
    return keys.filter((key) => hasOwnParameter(params, key));
}

interface PlaceImageBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

interface PlaceImageLayerState {
    layerId: number;
    parentId: number | null;
    layerName: string;
    bounds?: PlaceImageBounds;
}

interface PlaceImageBefore {
    documentId: number;
    beforeLayerIds: number[];
    expectedName: string;
}

interface PlaceImageReceipt {
    placedLayerId: number;
    placement?: ImageTargetFitOutcome;
}

interface PlaceImageReadback {
    documentId: number;
    currentLayerIds: number[];
    placedLayer?: PlaceImageLayerState;
}

interface PlaceImageResult extends Record<string, unknown> {
    success: boolean;
    code?: string;
    error?: string;
    errorDetails?: unknown;
    data: any;
}

function getLayerBoundsNoEffects(layer: any): any {
    return layer?.boundsNoEffects || layer?.bounds;
}

function getLayerPixelSize(layer: any): { left: number; top: number; width: number; height: number } {
    const bounds = getLayerBoundsNoEffects(layer);
    const left = Number(bounds?.left);
    const top = Number(bounds?.top);
    const right = Number(bounds?.right);
    const bottom = Number(bounds?.bottom);
    if (![left, top, right, bottom].every(Number.isFinite)
        || right <= left || bottom <= top) {
        throw new Error('置入图片适配失败：无法读取有效的图层 bounds。');
    }
    return {
        left,
        top,
        width: right - left,
        height: bottom - top
    };
}

async function translateLayerWithoutNativeMove(layer: any, offsetX: number, offsetY: number): Promise<void> {
    if (offsetX === 0 && offsetY === 0) {
        return;
    }
    if (typeof layer?.translate !== 'function') {
        throw new Error('置入图片定位失败：图层对象不支持 translate，已拒绝调用 Photoshop 原生 move 命令以避免弹窗。');
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
    fit: PlaceImageParams['targetFit'],
    targetAnchor: PlaceImageParams['targetAnchor'],
    focalPoint: PlaceImageParams['focalPoint']
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

function findLayerLocation(container: any, id: number): { layer: any; parent: any; index: number } | null {
    const layers = container?.layers || [];
    for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        if (layer?.id === id) {
            return { layer, parent: container, index: i };
        }
        if (layer?.layers) {
            const nested = findLayerLocation(layer, id);
            if (nested) return nested;
        }
    }
    return null;
}

function isTextLayer(layer: any): boolean {
    const kind = String(layer?.kind || layer?.typename || layer?._class || '').toLowerCase();
    return kind.includes('text') || Boolean(layer?.textItem) || Boolean(layer?.text);
}

function getElementPlacement(name: 'PLACEAFTER'): unknown {
    return getPhotoshopElementPlacement(constants, name, 'PlaceImageTool');
}

async function selectLayerById(layerId: number): Promise<void> {
    await action.batchPlay([
        {
            _obj: 'select',
            _target: [{ _ref: 'layer', _id: layerId }],
            makeVisible: false,
            _options: { dialogOptions: 'dontDisplay' }
        }
    ], { synchronousExecution: true });
}

function moveLayerAfter(layer: any, relativeLayer: any): void {
    if (typeof layer?.move !== 'function') {
        throw new Error('置入图片层级调整失败：当前 Photoshop UXP 环境不支持 layer.move');
    }
    layer.move(relativeLayer, getElementPlacement('PLACEAFTER'));
}

async function movePlacedLayerBelowText(doc: any, layer: any): Promise<void> {
    const location = findLayerLocation(doc, layer.id);
    if (!location) {
        throw new Error('置入图片层级调整失败：无法读取新图层位置');
    }
    const siblings = (location.parent?.layers || []).filter((item: any) => !item?.isBackgroundLayer && item?.id !== layer.id);
    const textSiblings = siblings.filter(isTextLayer);
    if (textSiblings.length === 0) {
        return;
    }
    const lowestTextSibling = textSiblings[textSiblings.length - 1];
    moveLayerAfter(layer, lowestTextSibling);
    await selectLayerById(layer.id);
}

async function applyPlacedLayerOrder(doc: any, layer: any, layerOrder: PlaceImageParams['layerOrder']): Promise<void> {
    if (layerOrder === 'belowText') {
        await movePlacedLayerBelowText(doc, layer);
        return;
    }
    if (layerOrder === 'back') {
        if (typeof layer?.sendToBack !== 'function') {
            throw new Error('置入图片层级调整失败：当前 Photoshop UXP 环境不支持 layer.sendToBack');
        }
        layer.sendToBack();
        await selectLayerById(layer.id);
    }
}

function calcChecksum(bytes: Uint8Array): string {
    // FNV-1a 32-bit, same as Agent side.
    let hash = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
        hash ^= bytes[i];
        hash = Math.imul(hash, 0x01000193);
    }
    const hex = (hash >>> 0).toString(16).padStart(8, '0');
    return `fnv1a32:${hex}`;
}

function extensionFromPath(filePath: string): string {
    const match = String(filePath || '').match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : '';
}

function collectPlaceImageLayerIds(container: any): number[] {
    const layerIds: number[] = [];
    for (const layer of Array.from(container?.layers || []) as any[]) {
        const layerId = Number(layer?.id);
        if (Number.isSafeInteger(layerId) && layerId > 0) {
            layerIds.push(layerId);
        }
        if (layer?.layers) {
            layerIds.push(...collectPlaceImageLayerIds(layer));
        }
    }
    return layerIds;
}

function readStrictPlaceImageBounds(layer: any): PlaceImageBounds | undefined {
    const bounds = getLayerBoundsNoEffects(layer);
    const left = Number(bounds?.left);
    const top = Number(bounds?.top);
    const right = Number(bounds?.right);
    const bottom = Number(bounds?.bottom);
    if (![left, top, right, bottom].every(Number.isFinite)) return undefined;
    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0) return undefined;
    return { left, top, right, bottom, width, height };
}

function readPlacedLayerState(
    document: any,
    layerId: number
): PlaceImageLayerState | undefined {
    const location = findLayerLocation(document, layerId);
    if (!location) return undefined;
    const parentId = location.parent === document
        ? null
        : Number(location.parent?.id);
    return {
        layerId,
        parentId: parentId !== null && Number.isSafeInteger(parentId) && parentId > 0 ? parentId : null,
        layerName: String(location.layer?.name || ''),
        bounds: readStrictPlaceImageBounds(location.layer)
    };
}

function samePlaceImageLayerIdSet(
    left: readonly number[],
    right: readonly number[]
): boolean {
    if (left.length !== right.length) return false;
    const rightSet = new Set(right);
    return left.every(layerId => rightSet.has(layerId));
}

function buildPlaceImageFailure(
    params: PlaceImageParams,
    code: string,
    error: string,
    data?: Record<string, unknown>
): PlaceImageResult {
    const failure = createToolFailureResult({ toolName: 'placeImage', error, params });
    return {
        ...failure,
        success: false,
        code,
        error,
        data: data || null
    };
}

export class PlaceImageTool implements Tool {
    name = 'placeImage';
    
    get schema(): ToolSchema {
        return {
            name: this.name,
            description: '将图片置入到当前文档中，支持从项目目录选择图片置入',
            parameters: {
                type: 'object',
                properties: {
                    imageData: {
                        type: 'string',
                        description: '图片的 Base64 数据（与 filePath 二选一，用于适配 UXP 文件访问限制）'
                    },
                    imageFormat: {
                        type: 'string',
                        description: 'imageData 时的格式：png|jpeg|gif（默认 png）'
                    },
                    filePath: {
                        type: 'string',
                        description: '图片文件的本地路径（与 imageData 二选一）'
                    },
                    fileToken: {
                        type: 'string',
                        description: 'UXP 会话文件 token（优先于 filePath）'
                    },
                    name: {
                        type: 'string',
                        description: '置入后的图层名称'
                    },
                    x: {
                        type: 'number',
                        description: '置入位置 X 坐标（像素）'
                    },
                    y: {
                        type: 'number',
                        description: '置入位置 Y 坐标（像素）'
                    },
                    scale: {
                        type: 'number',
                        description: '缩放百分比，默认 100；可大于 100 表示放大（如 150 表示放大到 150%）'
                    },
                    center: {
                        type: 'boolean',
                        description: '是否居中置入，默认 true'
                    },
                    fitToCanvas: {
                        type: 'boolean',
                        description: '是否自动缩放以适应画布。默认只缩小不放大（封顶 100%）；小图铺满画布需同时传 allowUpscale:true'
                    },
                    allowUpscale: {
                        type: 'boolean',
                        description: '配合 fitToCanvas：true 时允许放大超过原始尺寸铺满画布，默认 false 保持只缩不放'
                    },
                    targetBounds: {
                        type: 'object',
                        description: '目标区域，支持 {x,y,width,height} 或 {left,top,right,bottom}；多图详情页排版时用于避免默认居中重叠'
                    },
                    targetFit: {
                        type: 'string',
                        enum: ['contain', 'cover', 'fill'],
                        description: '提供 targetBounds 时必填：contain 完整放入、cover 铺满区域、fill 拉伸填充'
                    },
                    targetAnchor: {
                        type: 'string',
                        enum: ['center', 'top-center', 'bottom-center', 'left-center', 'right-center'],
                        description: '提供 targetBounds 时必填：目标区域内的图框对齐方式；focalPoint 存在时由 focalPoint 优先控制落位。fill 只接受 center'
                    },
                    focalPoint: {
                        type: 'object',
                        properties: {
                            x: { type: 'number', description: '0 到 1 的归一化横向位置' },
                            y: { type: 'number', description: '0 到 1 的归一化纵向位置' }
                        },
                        required: ['x', 'y'],
                        description: '源图中的归一化关注点；存在时优先将该点对准目标区域中心，并在无空洞范围内夹紧。不能与 fill 同用'
                    },
                    layerOrder: {
                        type: 'string',
                        enum: ['front', 'belowText', 'back'],
                        description: '置入后的图层层级。和 renderLayout 可编辑文字同用时使用 belowText，避免图片遮挡标题和卖点。'
                    }
                }
            }
        };
    }

    async execute(params: PlaceImageParams, context?: ToolExecutionContext): Promise<PlaceImageResult> {
        if (isRequestCancelled(context)) {
            return buildCancelledToolResult();
        }
        const doc = app.activeDocument;
        if (!doc) {
            return createToolFailureResult({ toolName: this.name, error: '没有打开的文档', params });
        }

        const {
            imageData: rawImageData,
            filePath,
            name = '置入的图片',
            x,
            y,
            scale = 100,
            center = true,
            fitToCanvas = false,
            allowUpscale = false,
            sourceAssetId,
            sourceChecksum,
            sourceByteLength,
            sourcePath,
            targetBounds,
            targetFit,
            targetAnchor,
            focalPoint,
            layerOrder = 'front'
        } = params;
        const imageData = rawImageData || (params as any).base64;
        const normalizedTargetBounds = normalizeImageTargetBounds(targetBounds);

        // 调用方显式给了 targetBounds 就必须按该区域执行；字段缺失/非数/宽高无效时
        // fail closed。静默退回“整画布居中”会把多图叠在一起，也会把布局错误伪装成成功。
        if (targetBounds != null && normalizedTargetBounds === null) {
            return createToolFailureResult({
                toolName: this.name,
                error: 'targetBounds 无效：需要 {x,y,width,height} 或 {left,top,right,bottom}，且宽高必须大于 0；已拒绝默认居中回退。',
                params
            });
        }

        if (normalizedTargetBounds) {
            const conflictingParameters = collectTargetBoundsConflictingParameters(params);
            if (conflictingParameters.length > 0) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: `targetBounds 与 ${conflictingParameters.join('/')} 互斥：targetBounds 已完整表达缩放与落位；已拒绝静默忽略冲突参数。`,
                    params
                });
            }
            const missingTargetParameters = [
                targetFit === undefined ? 'targetFit' : '',
                targetAnchor === undefined ? 'targetAnchor' : ''
            ].filter(Boolean);
            if (missingTargetParameters.length > 0) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: `targetBounds 需要同时显式提供 targetFit 与 targetAnchor；缺少 ${missingTargetParameters.join('/')}，已拒绝由执行器默认决定适配或锚点。`,
                    params
                });
            }
        }

        if (!normalizedTargetBounds
            && (params.targetFit !== undefined
                || params.targetAnchor !== undefined
                || params.focalPoint !== undefined)) {
            return createToolFailureResult({
                toolName: this.name,
                error: 'targetFit、targetAnchor 与 focalPoint 只在提供有效 targetBounds 时生效；已拒绝忽略这些参数。',
                params
            });
        }

        if (normalizedTargetBounds) {
            try {
                resolveImageTargetFitPlan({
                    sourceBounds: { left: 0, top: 0, width: 1, height: 1 },
                    targetBounds: normalizedTargetBounds,
                    fit: targetFit,
                    targetAnchor,
                    focalPoint
                });
            } catch (error) {
                return createToolFailureResult({
                    toolName: this.name,
                    error: error instanceof Error ? error.message : String(error),
                    params
                });
            }
        }

        if (!imageData && !filePath && !params.fileToken) {
            return createToolFailureResult({ toolName: this.name, error: '必须提供 imageData 或 filePath 或 fileToken', params });
        }

        const operationId = `placeImage:${String(context?.requestId || Date.now())}`;
        return await photoshopTransactionRunner.run<
            PlaceImageBefore,
            PlaceImageReadback,
            PlaceImageResult,
            PlaceImageReceipt
        >({
            operationId,
            toolName: this.name,
            commandName: 'DesignEcho: 置入图片',
            params,
            context,
            historyMode: 'suspend',
            expectedEffect: 'mutation_required',
            rollbackTargetPolicy: 'document_revision',
            prepare(scope): PhotoshopTransactionPreparation<PlaceImageBefore, PlaceImageResult> {
                return {
                    kind: 'ready',
                    before: {
                        documentId: Number(scope.document.id),
                        beforeLayerIds: collectPlaceImageLayerIds(scope.document),
                        expectedName: name
                    }
                };
            },
            async mutate(scope, before) {
                const doc = scope.document;
                let placedLayerId: number | null = null;
                let tokenPath: string | undefined;
                let placement: ImageTargetFitOutcome | undefined;

                throwIfRequestCancelled(context);
                // 使用 batchPlay 置入图片
                if (params.fileToken || filePath) {
                    tokenPath = params.fileToken;
                    if (!tokenPath && filePath) {
                        const fileEntry = await getEntryFromPath(fs, filePath);
                        if (!fileEntry) {
                            throw new Error(`无法访问文件: ${filePath}`);
                        }
                        const bytes = await readFileEntryBytes(fileEntry, uxp.storage);
                        throwIfRequestCancelled(context);
                        assertImageBytesSafeForPhotoshop(bytes, {
                            formatHint: extensionFromPath(filePath),
                            sourceLabel: `图片文件「${filePath.split(/[\\/]/).pop() || filePath}」`
                        });
                        tokenPath = await fs.createSessionToken(fileEntry);
                    }

                    // 从文件路径置入
                    throwIfRequestCancelled(context);
                    const result = await action.batchPlay([
                        {
                            _obj: 'placeEvent',
                            null: {
                                _kind: 'local',
                                _path: tokenPath
                            },
                            freeTransformCenterState: {
                                _enum: 'quadCenterState',
                                _value: 'QCSAverage'
                            },
                            offset: {
                                _obj: 'offset',
                                horizontal: {
                                    _unit: 'pixelsUnit',
                                    _value: 0
                                },
                                vertical: {
                                    _unit: 'pixelsUnit',
                                    _value: 0
                                }
                            },
                            _options: {
                                dialogOptions: 'dontDisplay'
                            }
                        }
                    ], { synchronousExecution: true });

                    if (result && result[0]) {
                        placedLayerId = doc.activeLayers[0]?.id;
                    }
                } else if (imageData) {
                    // 从 Base64 数据置入：写入 UXP 可访问的临时文件 → placeEvent
                    throwIfRequestCancelled(context);
                    const storage = uxp.storage;
                    const tempFolder = await fs.getTemporaryFolder();
                    const ext = (params.imageFormat || 'png').replace(/^\./, '') || 'png';
                    const tempFileName = `place_${Date.now()}.${ext}`;
                    const tempFile = await tempFolder.createFile(tempFileName, { overwrite: true });
                    const decoded = bytesFromBase64ImagePayload(imageData);
                    const bytes = decoded.bytes;
                    assertImageBytesSafeForPhotoshop(bytes, {
                        formatHint: ext || decoded.mimeType,
                        sourceLabel: name ? `图片「${name}」` : 'Base64 图片'
                    });
                    if (typeof sourceByteLength === 'number' && sourceByteLength > 0 && sourceByteLength !== bytes.length) {
                        throw new Error(`源图字节长度不一致: expected=${sourceByteLength}, actual=${bytes.length}`);
                    }
                    if (sourceChecksum) {
                        const actualChecksum = calcChecksum(bytes);
                        if (actualChecksum !== sourceChecksum) {
                            throw new Error(`源图校验失败: expected=${sourceChecksum}, actual=${actualChecksum}`);
                        }
                    }
                    if (sourceAssetId) {
                        console.log(`[placeImage] 置入来源 assetId=${sourceAssetId}, sourcePath=${sourcePath || filePath || 'n/a'}`);
                    }
                    await tempFile.write(arrayBufferFromBytes(bytes), { format: storage.formats.binary });
                    const sessionToken = await fs.createSessionToken(tempFile);
                    throwIfRequestCancelled(context);
                    const placeResult = await action.batchPlay([
                        {
                            _obj: 'placeEvent',
                            null: { _path: sessionToken, _kind: 'local' },
                            freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
                            offset: { _obj: 'offset', horizontal: { _unit: 'pixelsUnit', _value: 0 }, vertical: { _unit: 'pixelsUnit', _value: 0 } },
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });
                    if (placeResult?.[0]) placedLayerId = doc.activeLayers[0]?.id;
                    try { await tempFile.delete(); } catch { /* ignore */ }
                }
                throwIfRequestCancelled(context);

                // 获取置入后的图层
                const newLayer = doc.activeLayers[0];
                if (!newLayer) {
                    throw new Error('置入失败，未找到新图层');
                }

                const newLayerId = Number(newLayer.id);
                if (!Number.isSafeInteger(newLayerId)
                    || newLayerId <= 0
                    || before.beforeLayerIds.includes(newLayerId)) {
                    return buildPlaceImageFailure(
                        params,
                        'place_image_new_layer_missing',
                        '置入图片命令已返回，但活动图层不是一个新图层。已停止并回滚；请重新读取文档后重试。',
                        {
                            activeLayerId: Number.isFinite(newLayerId) ? newLayerId : null,
                            beforeLayerIds: before.beforeLayerIds
                        }
                    );
                }

                placedLayerId = newLayerId;

                // 重命名图层
                if (name) {
                    newLayer.name = name;
                }

                // 处理目标区域；它优先于普通居中/缩放，用于详情页多图排版。
                if (normalizedTargetBounds) {
                    throwIfRequestCancelled(context);
                    placement = await fitLayerToTargetBounds(
                        newLayer,
                        normalizedTargetBounds,
                        targetFit,
                        targetAnchor,
                        focalPoint
                    );
                } else if (fitToCanvas || scale !== 100) {
                    const layerBounds = getLayerBoundsNoEffects(newLayer);
                    const layerWidth = layerBounds.right - layerBounds.left;
                    const layerHeight = layerBounds.bottom - layerBounds.top;
                    
                    let targetScale = scale;
                    
                    if (fitToCanvas) {
                        // 计算适应画布的缩放比例；默认只缩不放（封顶 100%），
                        // allowUpscale=true 时解除封顶，允许小图放大铺满画布。
                        const docWidth = doc.width;
                        const docHeight = doc.height;
                        const scaleX = (docWidth / layerWidth) * 100;
                        const scaleY = (docHeight / layerHeight) * 100;
                        const fitScale = Math.min(scaleX, scaleY);
                        targetScale = allowUpscale ? fitScale : Math.min(fitScale, 100);
                    }

                    if (targetScale !== 100) {
                        throwIfRequestCancelled(context);
                        await transformLayerPercent(targetScale, targetScale);
                    }
                }

                // 处理位置
                if (normalizedTargetBounds) {
                    // 目标区域已经完成定位。
                } else if (x !== undefined || y !== undefined) {
                    // 移动到指定位置
                    const layerBounds = getLayerBoundsNoEffects(newLayer);
                    const currentX = layerBounds.left;
                    const currentY = layerBounds.top;

                    const moveX = (x ?? currentX) - currentX;
                    const moveY = (y ?? currentY) - currentY;

                    throwIfRequestCancelled(context);
                    await translateLayerWithoutNativeMove(newLayer, moveX, moveY);
                } else if (center) {
                    // 居中置入
                    const layerBounds = getLayerBoundsNoEffects(newLayer);
                    const layerWidth = layerBounds.right - layerBounds.left;
                    const layerHeight = layerBounds.bottom - layerBounds.top;
                    const docWidth = doc.width;
                    const docHeight = doc.height;

                    const targetX = (docWidth - layerWidth) / 2;
                    const targetY = (docHeight - layerHeight) / 2;
                    const currentX = layerBounds.left;
                    const currentY = layerBounds.top;

                    const moveX = targetX - currentX;
                    const moveY = targetY - currentY;

                    throwIfRequestCancelled(context);
                    await translateLayerWithoutNativeMove(newLayer, moveX, moveY);
                }

                throwIfRequestCancelled(context);
                await applyPlacedLayerOrder(doc, newLayer, layerOrder);
                return buildPhotoshopTransactionMutationOutcome(
                    {
                        success: true,
                        data: {
                            layerId: placedLayerId,
                            layerName: name,
                            bounds: null,
                            source: {
                                assetId: sourceAssetId,
                                checksum: sourceChecksum,
                                byteLength: sourceByteLength
                            },
                            ...(placement ? { placement } : {}),
                            message: `已执行图片置入“${name}”，等待 Photoshop 状态读回。`
                        }
                    },
                    {
                        placedLayerId,
                        ...(placement ? { placement } : {})
                    }
                );
            },
            readState({ phase, scope, before, receipt }): PlaceImageReadback {
                const currentLayerIds = collectPlaceImageLayerIds(scope.document);
                const addedLayerIds = currentLayerIds.filter(
                    layerId => !before.beforeLayerIds.includes(layerId)
                );
                let placedLayerId = Number(receipt?.placedLayerId);
                if ((!Number.isSafeInteger(placedLayerId) || placedLayerId <= 0)
                    && addedLayerIds.length === 1) {
                    placedLayerId = addedLayerIds[0];
                }
                if (phase !== 'after_rollback'
                    && (!Number.isSafeInteger(placedLayerId) || placedLayerId <= 0)) {
                    throw new Error('置入图片写后读回缺少新图层 ID。');
                }
                return {
                    documentId: Number(scope.document.id),
                    currentLayerIds,
                    placedLayer: Number.isSafeInteger(placedLayerId) && placedLayerId > 0
                        ? readPlacedLayerState(scope.document, placedLayerId)
                        : undefined
                };
            },
            verifyApplied({ before, after, receipt }) {
                const addedLayerIds = after.currentLayerIds.filter(
                    layerId => !before.beforeLayerIds.includes(layerId)
                );
                const placedLayer = after.placedLayer;
                const placement = receipt?.placement && placedLayer?.bounds
                    ? measureImageTargetFitOutcome(receipt.placement, placedLayer.bounds)
                    : undefined;
                return {
                    verified: after.documentId === before.documentId
                        && addedLayerIds.length === 1
                        && placedLayer !== undefined
                        && placedLayer.layerId === receipt?.placedLayerId
                        && placedLayer.layerName === before.expectedName
                        && Boolean(placedLayer.bounds)
                        && (!normalizedTargetBounds
                            || placement?.geometryVerification.verified === true),
                    message: `置入图片写后读回不一致：新增图层 ID=[${addedLayerIds.join(', ')}]，预期名称=“${before.expectedName}”，实际名称=“${placedLayer?.layerName || ''}”，bounds=${placedLayer?.bounds ? `${placedLayer.bounds.width}×${placedLayer.bounds.height}` : '空'}，目标框几何问题=[${placement?.geometryVerification.issues.join(', ') || ''}]。`
                };
            },
            verifyRolledBack({ before, after }) {
                return {
                    verified: after.documentId === before.documentId
                        && samePlaceImageLayerIdSet(
                            before.beforeLayerIds,
                            after.currentLayerIds
                        )
                        && !after.placedLayer,
                    message: `置入图片回滚后图层集合不一致：原 ID=[${before.beforeLayerIds.join(', ')}]，当前 ID=[${after.currentLayerIds.join(', ')}]。`
                };
            },
            buildVerifiedResult({ after, receipt }): PlaceImageResult {
                const placedLayer = after.placedLayer as PlaceImageLayerState;
                const bounds = placedLayer.bounds as PlaceImageBounds;
                const placement = receipt?.placement
                    ? measureImageTargetFitOutcome(receipt.placement, bounds)
                    : undefined;
                return {
                    success: true,
                    data: {
                        layerId: placedLayer.layerId,
                        layerName: placedLayer.layerName,
                        bounds,
                        source: {
                            assetId: sourceAssetId,
                            checksum: sourceChecksum,
                            byteLength: sourceByteLength
                        },
                        ...(placement ? { placement } : {}),
                        message: `成功置入图片“${placedLayer.layerName}”，并读回确认非空 bounds。`
                    }
                };
            }
        });
    }
}

export default PlaceImageTool;
