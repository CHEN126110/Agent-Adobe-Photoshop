/**
 * 局部重绘工具 (Inpainting Tools)
 * 
 * 包含：
 * 1. GetSelectionMaskTool - 获取当前选区作为蒙版
 * 2. ApplyRasterImageResultTool - 应用通用图像结果到图层
 */

import { Tool, ToolSchema } from '../types';
import {
    arrayBufferFromBytes,
    assertImageBytesSafeForPhotoshop,
    bytesFromBase64ImagePayload,
    readFileEntryBytes
} from '../../core/image-safety';
const uxp = require('uxp');

const { app, imaging, action, core } = require('photoshop');
const { batchPlay } = action;
const fs = uxp.storage.localFileSystem;

const READ_ONLY_SELECTION_BATCH_PLAY_OPTIONS = { synchronousExecution: true };

function buildSelectionReadDescriptor(property: 'selection' | 'selectionBounds'): any {
    return {
        _obj: 'get',
        _target: [
            { _property: property },
            { _ref: 'document', _enum: 'ordinal', _value: 'targetEnum' }
        ],
        _options: { dialogOptions: 'dontDisplay' }
    };
}

function getLayerBoundsNoEffects(layer: any): any {
    return layer?.boundsNoEffects || layer?.bounds;
}

/** 生成图与目标位置的宽高比差异在此比例内，视为"同一个比例"，可以直接等比缩放。 */
const PLACEMENT_RATIO_MATCH_TOLERANCE = 0.01;

export interface PlacementScaleDecision {
    /** 传给 PS transform 的宽度百分比 */
    scaleWidthPercent: number;
    /** 传给 PS transform 的高度百分比 */
    scaleHeightPercent: number;
    /** 需要让用户知道的取舍说明；无取舍时为 undefined */
    notice?: string;
}

/**
 * 决定生成结果置入画布时怎么缩放。
 *
 * 抽成纯函数是因为原实现把这个决策藏在了 batchPlay 调用里，而它其实是整条链路上
 * 唯一会**改变画面几何**的地方：
 *
 *     const scaleW = (placementWidth / layerWidth) * 100;
 *     const scaleH = (placementHeight / layerHeight) * 100;
 *     ... width: scaleW, height: scaleH, linked: false
 *
 * 宽高两个方向各算各的、且 linked:false 明确关掉了等比链接——只要生成图的宽高比
 * 与目标位置不一致，画面就会被拉伸。真实病历里源图层 3072×4096(0.750)、生成图
 * 896×1200(0.747)，差 0.45% 尚不明显；用户一旦在面板选了与源图不同的比例（如 1:1），
 * 变形立刻是灾难级的。这就是"置入时缩放会有变形"的机制。
 *
 * 同一段代码还藏着第二个问题：placementWidth/Height 取的是**源图层的原始尺寸**，
 * 于是不管上游出了多大的图，都会被缩回源图层那么大。4K 档真生效时，
 * 3456×4736 会被缩到 2044×2724——分辨率白花钱买。
 */
export function resolveResultPlacementScale(input: {
    /** 置入后图层的实际像素宽（即生成图的宽） */
    imageWidth: number;
    /** 置入后图层的实际像素高 */
    imageHeight: number;
    /** 期望占据的宽度（通常是被替换的源图层宽） */
    placementWidth: number;
    /** 期望占据的高度 */
    placementHeight: number;
}): PlacementScaleDecision {
    const { imageWidth, imageHeight, placementWidth, placementHeight } = input;

    const hasUsableInput =
        imageWidth > 0 && imageHeight > 0 && placementWidth > 0 && placementHeight > 0;
    if (!hasUsableInput) {
        return { scaleWidthPercent: 100, scaleHeightPercent: 100 };
    }

    const imageRatio = imageWidth / imageHeight;
    const targetRatio = placementWidth / placementHeight;
    const ratioDelta = Math.abs(imageRatio - targetRatio) / targetRatio;

    // 比例基本一致：等比**铺满**目标位置（cover 语义，取 max）。
    //
    // 这里取 max 而不是 min，是被真机打脸后改的：曾经取 min 保证"不溢出"，
    // 结果 896×1200 落到 5572×7430（比例差 0.435%，在容差内）时宽度只到 5548，
    // 右边露出 24px 白边——设计师一眼就看见了。而 max 造成的溢出是同一个量级
    // （高度多 0.44%，约 32px 落到画布外），肉眼根本看不出来。
    //
    // 判据是**哪种代价用户看得见**：容差内的比例差本就不可见，此时铺满优先；
    // 白边可见、且会露出下方图层，是更糟的结果。真正显著的比例差另走下面的策略。
    if (ratioDelta <= PLACEMENT_RATIO_MATCH_TOLERANCE) {
        const uniformScale = Math.max(
            placementWidth / imageWidth,
            placementHeight / imageHeight
        ) * 100;
        return {
            scaleWidthPercent: uniformScale,
            scaleHeightPercent: uniformScale
        };
    }

    // 比例不一致：这里才是真正的设计取舍，交给下面的落位策略。
    return resolveMismatchedRatioPlacement(input, imageRatio, targetRatio);
}

/**
 * 生成图比例与目标位置比例对不上时的落位策略：**等比 contain，完整保留画面**。
 *
 * 出现的场景很常见：用户在面板选了与源图层不同的输出比例，或上游把比例吸附到了最近的
 * 档位（Gemini 只按 1:1 / 3:4 / 16:9 这类固定档位出图，很少与源图层严格相等）。
 *
 * 三种做法各有代价，选 contain 的理由：
 * - **contain（选它）**：等比缩到完整放进原位置，可能盖不满、露出下方内容。
 *   代价是可见的——设计师一眼就看到留白，能自己决定怎么处理。
 * - cover：填满原位置，但生成图边缘被裁掉。代价是**不可见的**：用户不知道被裁掉了什么，
 *   而那是他花钱生成的内容。宁可让人看见留白，也不要静默丢内容。
 * - 不缩放保持原尺寸：曾以为能保住 4K 清晰度，但 placeEvent 置入的是**智能对象**，
 *   缩放是非破坏性的、原始像素仍在，所以这条理由不成立，只剩下"尺寸对不上版面"的坏处。
 *
 * 两个方向必须用同一个系数，否则又变回原来那个把画面拉变形的实现。
 */
function resolveMismatchedRatioPlacement(
    input: { imageWidth: number; imageHeight: number; placementWidth: number; placementHeight: number },
    imageRatio: number,
    targetRatio: number
): PlacementScaleDecision {
    const containScale = Math.min(
        input.placementWidth / input.imageWidth,
        input.placementHeight / input.imageHeight
    );
    const scalePercent = containScale * 100;

    const fittedWidth = Math.round(input.imageWidth * containScale);
    const fittedHeight = Math.round(input.imageHeight * containScale);
    // 哪个方向没盖满，决定了留白出现在左右还是上下——直接说出来，省得用户自己找
    const gapDirection = imageRatio > targetRatio ? '上下' : '左右';

    return {
        scaleWidthPercent: scalePercent,
        scaleHeightPercent: scalePercent,
        notice:
            `生成图 ${input.imageWidth}×${input.imageHeight} 与原位置 ` +
            `${input.placementWidth}×${input.placementHeight} 比例不同，` +
            `已等比缩放为 ${fittedWidth}×${fittedHeight} 完整置入（未裁切画面），` +
            `${gapDirection}会留出空隙、可能露出下方图层。` +
            `图层是智能对象，可直接拖拽调整而不损失画质。`
    };
}

async function translateLayer(layer: any, offsetX: number, offsetY: number): Promise<void> {
    if (typeof layer?.translate !== 'function') {
        throw new Error('ApplyRasterImageResult failed: placed raster result layer does not support DOM translate; native move is blocked to avoid Photoshop popups.');
    }
    await Promise.resolve(layer.translate(offsetX, offsetY));
}

function toErrorMessage(error: any): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'string' && error.trim()) return error;
    if (error && typeof error === 'object') {
        const message = (error as any).message || (error as any).reason;
        if (message) return String(message);
    }
    try {
        const serialized = JSON.stringify(error);
        if (serialized && serialized !== '{}' && serialized !== 'null') return serialized;
    } catch {}
    return '获取选区蒙版失败（Photoshop 返回空错误）';
}

/**
 * 将 Uint8Array 转换为 Base64（分块处理避免栈溢出）
 * 使用显式 & 0xFF 确保每个字节在 Latin1 范围内，避免 btoa InvalidCharacterError
 */
function uint8ArrayToBase64(data: Uint8Array): string {
    const CHUNK_SIZE = 32768;
    let binary = '';
    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
        const chunk = data.subarray(i, Math.min(i + CHUNK_SIZE, data.length));
        for (let j = 0; j < chunk.length; j++) {
            binary += String.fromCharCode(chunk[j] & 0xFF);
        }
    }
    return btoa(binary);
}

/** 清洗 base64 字符串，移除非法字符，避免 atob InvalidCharacterError */
function sanitizeBase64(str: string): string {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/[^A-Za-z0-9+/=]/g, '');
}

function decodeBase64Bytes(input: string): Uint8Array {
    const base64Data = sanitizeBase64(input);
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

function extensionFromPath(filePath: string): string {
    const match = String(filePath || '').match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : '';
}

const PHOTOSHOP_16BIT_MAX = 32768;

function coerceTypedPixelData(
    data: Uint8Array | Uint16Array | Float32Array,
    componentSize: number
): Uint8Array | Uint16Array | Float32Array {
    if (componentSize === 16) {
        return data instanceof Uint16Array
            ? data
            : new Uint16Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 2));
    }
    if (componentSize === 32) {
        return data instanceof Float32Array
            ? data
            : new Float32Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 4));
    }
    return data instanceof Uint8Array
        ? data
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function sampleTo8Bit(
    data: Uint8Array | Uint16Array | Float32Array,
    index: number,
    componentSize: number
): number {
    if (componentSize === 16) {
        const source = data as Uint16Array;
        return Math.max(0, Math.min(255, Math.round((source[index] / PHOTOSHOP_16BIT_MAX) * 255)));
    }
    if (componentSize === 32) {
        const source = data as Float32Array;
        return Math.max(0, Math.min(255, Math.round(source[index] * 255)));
    }
    const source = data as Uint8Array;
    return source[index] || 0;
}

function normalizePixelsTo8Bit(
    data: Uint8Array | Uint16Array | Float32Array,
    pixelCount: number,
    components: number,
    componentSize: number,
    outputComponents: 1 | 3
): Uint8Array {
    const output = new Uint8Array(pixelCount * outputComponents);
    for (let i = 0; i < pixelCount; i++) {
        const src = i * components;
        const dst = i * outputComponents;
        if (outputComponents === 1) {
            output[dst] = sampleTo8Bit(data, src, componentSize);
        } else {
            output[dst] = sampleTo8Bit(data, src, componentSize);
            output[dst + 1] = sampleTo8Bit(data, src + 1, componentSize);
            output[dst + 2] = sampleTo8Bit(data, src + 2, componentSize);
        }
    }
    return output;
}

function normalizePixelsToRgba8(
    data: Uint8Array | Uint16Array | Float32Array,
    pixelCount: number,
    components: number,
    componentSize: number
): Uint8ClampedArray {
    const output = new Uint8ClampedArray(pixelCount * 4);
    for (let i = 0; i < pixelCount; i++) {
        const src = i * components;
        const dst = i * 4;
        const red = sampleTo8Bit(data, src, componentSize);
        output[dst] = red;
        output[dst + 1] = components > 1 ? sampleTo8Bit(data, src + 1, componentSize) : red;
        output[dst + 2] = components > 2 ? sampleTo8Bit(data, src + 2, componentSize) : red;
        output[dst + 3] = components > 3 ? sampleTo8Bit(data, src + 3, componentSize) : 255;
    }
    return output;
}

async function getDocumentPixelSpec(docId: number): Promise<{
    componentSize: number;
    colorProfile: string;
}> {
    const probe = await imaging.getPixels({
        documentID: docId,
        targetSize: { width: 1, height: 1 },
        applyAlpha: true
    });
    try {
        return {
            componentSize: probe.imageData.componentSize || 8,
            colorProfile: probe.imageData.colorProfile || 'sRGB IEC61966-2.1'
        };
    } finally {
        probe.imageData.dispose();
    }
}

function convertRgba8ToTargetDepth(
    bytes: Uint8Array,
    componentSize: number
): Uint8Array | Uint16Array | Float32Array {
    if (componentSize === 16) {
        const converted = new Uint16Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) {
            converted[i] = Math.max(0, Math.min(PHOTOSHOP_16BIT_MAX, Math.round((bytes[i] / 255) * PHOTOSHOP_16BIT_MAX)));
        }
        return converted;
    }
    if (componentSize === 32) {
        const converted = new Float32Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) {
            converted[i] = bytes[i] / 255;
        }
        return converted;
    }
    return bytes;
}

/**
 * 捕获窗相对选区的放大倍数。
 *
 * 必须 ≥ Agent 侧 CONTEXT_WINDOW_SCALE 的最大档（add=2.9）：这里只负责"捞够"，
 * 精确的上下文窗由 Agent 在捕获图内部再裁一次。两边不需要同一份规则，
 * 只需要这里不比那边小，否则 Agent 想要的环境会被上游先切掉。
 */
const CAPTURE_CONTEXT_FACTOR = 3;

/** 捕获窗最小边长，与 Agent 侧 MIN_CONTEXT_WINDOW_EDGE 对齐 */
const MIN_CAPTURE_WINDOW_EDGE = 768;

/**
 * 捕获窗长边上限。
 *
 * 取值依据是模型的出图上限而不是画质偏好：重绘结果最终由模型按固定档位出图，
 * 捕获得比模型能返回的更精细，多出来的像素在往返途中一定会被丢掉，
 * 只换来更大的传输量和更慢的响应。
 */
const DEFAULT_MAX_CAPTURE_EDGE = 2048;

/**
 * Photoshop Imaging API 在超大画布上的区域截取上限（真机实测，见 export-layer.ts）。
 *
 * 文档任一维度超过此值时，带 sourceBounds 的 getPixels 会因"按全画布坐标系分配缓冲"
 * 而失败，只有整画布 targetSize 降采样能幸存。这类文档拿不到原图分辨率的重绘，
 * 只能整图降采样并如实告知用户。
 */
const IMAGING_SAFE_MAX_DOC_DIMENSION = 8000;

/**
 * 获取当前选区作为蒙版
 */
export class GetSelectionMaskTool implements Tool {
    name = 'getSelectionMask';

    schema: ToolSchema = {
        name: 'getSelectionMask',
        description: '获取当前 Photoshop 选区作为蒙版（用于局部重绘）',
        parameters: {
            type: 'object',
            properties: {
                includeImage: {
                    type: 'boolean',
                    description: '是否同时返回原图像（默认 true）'
                },
                maxCaptureEdge: {
                    type: 'number',
                    description: `捕获窗长边上限（默认 ${DEFAULT_MAX_CAPTURE_EDGE}），不是文档降采样尺寸`
                }
            }
        }
    };

    /**
     * 以选区为中心圈出要捕获的那块画面（文档原始坐标）。
     *
     * 关键差别：窗口尺寸只跟**选区**有关，与文档多大无关。
     * 旧实现按文档长边降采样，同一个"高清"档在 1440 见方的主图上无损，
     * 在 750×28640 的详情页上却把选区压到 21px——用户感知不到自己在哪一档。
     */
    private resolveCaptureWindow(
        selectionBounds: { left: number; top: number; right: number; bottom: number },
        docWidth: number,
        docHeight: number
    ): { left: number; top: number; right: number; bottom: number } {
        const selectionWidth = Math.max(1, selectionBounds.right - selectionBounds.left);
        const selectionHeight = Math.max(1, selectionBounds.bottom - selectionBounds.top);

        const windowWidth = Math.min(
            docWidth,
            Math.max(Math.round(selectionWidth * CAPTURE_CONTEXT_FACTOR), MIN_CAPTURE_WINDOW_EDGE, selectionWidth)
        );
        const windowHeight = Math.min(
            docHeight,
            Math.max(Math.round(selectionHeight * CAPTURE_CONTEXT_FACTOR), MIN_CAPTURE_WINDOW_EDGE, selectionHeight)
        );

        const centerX = (selectionBounds.left + selectionBounds.right) / 2;
        const centerY = (selectionBounds.top + selectionBounds.bottom) / 2;
        const left = Math.round(Math.max(0, Math.min(centerX - windowWidth / 2, docWidth - windowWidth)));
        const top = Math.round(Math.max(0, Math.min(centerY - windowHeight / 2, docHeight - windowHeight)));

        return { left, top, right: left + windowWidth, bottom: top + windowHeight };
    }

    async execute(params: { includeImage?: boolean; maxCaptureEdge?: number }): Promise<any> {
        const includeImage = params.includeImage !== false;
        const maxCaptureEdge = Math.max(512, Math.min(4096, Number(params.maxCaptureEdge) || DEFAULT_MAX_CAPTURE_EDGE));

        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            // 检查是否有选区
            const hasSelection = await this.checkSelection();
            if (!hasSelection) {
                return { success: false, error: '请先创建选区（使用套索工具、矩形选框等）' };
            }

            const width = doc.width as number;
            const height = doc.height as number;

            const selectionBounds = await this.getSelectionBounds();
            if (!selectionBounds) {
                return { success: false, error: '无法获取选区边界' };
            }

            // 只截选区周围那块画面，而不是整张文档降采样。
            // 超大文档上 sourceBounds 会失败，这类只能退回整图捕获。
            const canCropCapture = Math.max(width, height) <= IMAGING_SAFE_MAX_DOC_DIMENSION;
            const fullDocWindow = { left: 0, top: 0, right: width, bottom: height };
            let captureWindow = canCropCapture
                ? this.resolveCaptureWindow(selectionBounds, width, height)
                : fullDocWindow;
            let captureNotice = canCropCapture
                ? ''
                : `文档 ${width}×${height} 超过 Photoshop 区域截取上限（${IMAGING_SAFE_MAX_DOC_DIMENSION}px），`
                    + '本次只能整图降采样捕获，重绘区分辨率会明显低于原图。';

            const computeTargetSize = (window: { left: number; top: number; right: number; bottom: number }) => {
                const windowWidth = Math.max(1, window.right - window.left);
                const windowHeight = Math.max(1, window.bottom - window.top);
                const captureScale = Math.min(1, maxCaptureEdge / Math.max(windowWidth, windowHeight));
                return {
                    windowWidth,
                    windowHeight,
                    targetWidth: Math.max(1, Math.round(windowWidth * captureScale)),
                    targetHeight: Math.max(1, Math.round(windowHeight * captureScale))
                };
            };

            let plan = computeTargetSize(captureWindow);
            // 窗口已经等于整张文档时不必再传 sourceBounds，省一次注定等价的调用
            let useSourceBounds = canCropCapture
                && (plan.windowWidth < width || plan.windowHeight < height);

            console.log(
                `[GetSelectionMask] 文档 ${width}x${height}，捕获窗 `
                + `${captureWindow.left},${captureWindow.top} ${plan.windowWidth}x${plan.windowHeight}`
                + ` → 目标 ${plan.targetWidth}x${plan.targetHeight}，sourceBounds=${useSourceBounds}`
            );

            let maskBase64 = '';
            let imageBase64 = '';
            let actualMaskWidth = plan.targetWidth;
            let actualMaskHeight = plan.targetHeight;
            let actualImageWidth = 0;
            let actualImageHeight = 0;

            // 使用 PS 原生 API 获取选区蒙版和文档图像（零历史副作用）。
            // 带 sourceBounds 的区域截取在部分文档/版本上会失败，失败即整图回退，
            // 并把降级如实带回给用户，而不是悄悄给一张糊图。
            const runCapture = async (
                window: { left: number; top: number; right: number; bottom: number },
                targetWidth: number,
                targetHeight: number,
                withSourceBounds: boolean
            ) => {
                const boundsOption = withSourceBounds
                    ? {
                        sourceBounds: {
                            left: window.left,
                            top: window.top,
                            right: window.right,
                            bottom: window.bottom
                        }
                    }
                    : {};

                await core.executeAsModal(async () => {
                    // 1. 用 imaging.getSelection() 直接获取选区蒙版（灰度单通道）
                    const selResult = await imaging.getSelection({
                        documentID: doc.id,
                        ...boundsOption,
                        targetSize: { width: targetWidth, height: targetHeight }
                    });
                const maskDataRaw = await selResult.imageData.getData() as Uint8Array | Uint16Array | Float32Array;
                const maskData = coerceTypedPixelData(maskDataRaw, selResult.imageData.componentSize);
                const maskBytes = normalizePixelsTo8Bit(
                    maskData,
                    selResult.imageData.width * selResult.imageData.height,
                    selResult.imageData.components,
                    selResult.imageData.componentSize,
                    1
                );
                actualMaskWidth = selResult.imageData.width;
                actualMaskHeight = selResult.imageData.height;
                maskBase64 = uint8ArrayToBase64(maskBytes);
                console.log(`[GetSelectionMask] 蒙版: ${selResult.imageData.width}x${selResult.imageData.height}, channels=${selResult.imageData.components}, componentSize=${selResult.imageData.componentSize}, encoded=raw-gray-base64`);
                selResult.imageData.dispose();

                // 2. 获取文档复合图像并标准化为 RGBA raw，交给 Agent 用 sharp 转 PNG，
                // 避免依赖 UXP Canvas / ImageData 兼容性，同时保留无损像素。
                if (includeImage) {
                    // colorProfile 必须显式指定 sRGB：不传时 PS 返回的是**文档工作空间**的数值，
                    // 而这批字节会被当作 sRGB 编成 PNG 送给模型。文档若是 Adobe RGB / Display P3，
                    // 同一组数值按 sRGB 解释就会系统性偏色，模型照着这份偏色的画面重绘，
                    // 贴回文档时再转换一次，偏差被固定放大——真机症状是"每次结果都偏红"。
                    //
                    // 图生图那条抓图路径（export-layer.ts）早就修过同一个问题，
                    // 但局部重绘走的是这里，当时漏掉了。两条路径必须保持一致。
                    const imgResult = await imaging.getPixels({
                        documentID: doc.id,
                        ...boundsOption,
                        targetSize: { width: targetWidth, height: targetHeight },
                        applyAlpha: true,  // 返回 RGB（无 alpha），白底合成
                        colorProfile: 'sRGB IEC61966-2.1'
                    } as any);
                    const imgDataRaw = await imgResult.imageData.getData() as Uint8Array | Uint16Array | Float32Array;
                    const imgData = coerceTypedPixelData(imgDataRaw, imgResult.imageData.componentSize);
                    const rgbaBytes = normalizePixelsToRgba8(
                        imgData,
                        imgResult.imageData.width * imgResult.imageData.height,
                        imgResult.imageData.components,
                        imgResult.imageData.componentSize
                    );
                    actualImageWidth = imgResult.imageData.width;
                    actualImageHeight = imgResult.imageData.height;
                    imageBase64 = uint8ArrayToBase64(new Uint8Array(rgbaBytes.buffer));
                    // 如实记录 PS 实际给了哪个色彩空间：请求 sRGB 不等于一定拿到 sRGB，
                    // 排查偏色时这一行是"偏差发生在抓图前还是抓图后"的分界证据。
                    console.log(`[GetSelectionMask] 图像: ${imgResult.imageData.width}x${imgResult.imageData.height}, channels=${imgResult.imageData.components}, componentSize=${imgResult.imageData.componentSize}, colorProfile=${imgResult.imageData.colorProfile || '(未回报)'}, encoded=raw-rgba-base64`);
                    imgResult.imageData.dispose();
                }
                }, { commandName: 'DesignEcho: 获取选区蒙版' });
            };

            if (useSourceBounds) {
                try {
                    await runCapture(captureWindow, plan.targetWidth, plan.targetHeight, true);
                } catch (cropError: any) {
                    const reason = toErrorMessage(cropError);
                    console.warn('[GetSelectionMask] 区域截取失败，回退整图捕获:', reason);
                    captureNotice = `按选区截取画面失败（${reason}），已回退整图降采样，重绘区分辨率会低于原图。`;
                    useSourceBounds = false;
                    maskBase64 = '';
                    imageBase64 = '';
                    actualImageWidth = 0;
                    actualImageHeight = 0;
                }
            }

            if (!useSourceBounds) {
                captureWindow = fullDocWindow;
                plan = computeTargetSize(captureWindow);
                await runCapture(captureWindow, plan.targetWidth, plan.targetHeight, false);
            }

            if (!maskBase64) {
                throw new Error('选区蒙版为空，请重新创建选区后重试');
            }

            if (includeImage && actualImageWidth > 0 && actualImageHeight > 0) {
                if (actualImageWidth !== actualMaskWidth || actualImageHeight !== actualMaskHeight) {
                    throw new Error(`图像与蒙版尺寸不一致: image=${actualImageWidth}x${actualImageHeight}, mask=${actualMaskWidth}x${actualMaskHeight}`);
                }
            }

            const effectiveWidth = actualMaskWidth;
            const effectiveHeight = actualMaskHeight;
            // 缩放基准是**捕获窗**而不是整张文档——这是这次改造的核心。
            // 窗口没被降采样时 effectiveScale 就是 1，重绘区拿到的是原图分辨率。
            const capturedWindowWidth = Math.max(1, captureWindow.right - captureWindow.left);
            const capturedWindowHeight = Math.max(1, captureWindow.bottom - captureWindow.top);
            const effectiveScaleX = effectiveWidth / capturedWindowWidth;
            const effectiveScaleY = effectiveHeight / capturedWindowHeight;

            // 选区坐标要相对捕获窗，Agent 拿到的图就是这个窗口
            const scaledSelectionBounds = {
                left: Math.round((selectionBounds.left - captureWindow.left) * effectiveScaleX),
                top: Math.round((selectionBounds.top - captureWindow.top) * effectiveScaleY),
                right: Math.round((selectionBounds.right - captureWindow.left) * effectiveScaleX),
                bottom: Math.round((selectionBounds.bottom - captureWindow.top) * effectiveScaleY)
            };

            // 置入时重绘区要放大多少倍——直接决定它比周围原图糊多少，如实报出去
            const selectionNativeEdge = Math.max(
                1,
                Math.max(selectionBounds.right - selectionBounds.left, selectionBounds.bottom - selectionBounds.top)
            );
            const selectionCapturedEdge = Math.max(
                1,
                Math.max(scaledSelectionBounds.right - scaledSelectionBounds.left, scaledSelectionBounds.bottom - scaledSelectionBounds.top)
            );
            const placementUpscale = Number((selectionNativeEdge / selectionCapturedEdge).toFixed(2));

            const result: any = {
                success: true,
                mask: maskBase64,
                maskFormat: 'raw',
                maskChannels: 1,
                width: effectiveWidth,
                height: effectiveHeight,
                originalWidth: width,
                originalHeight: height,
                selectionBounds: scaledSelectionBounds,
                documentMeta: {
                    width,
                    height,
                    scale: Math.min(effectiveScaleX, effectiveScaleY),
                    // 捕获窗在文档中的原点。Agent 的落位走 selectionBoundsOriginal
                    // 这条原生坐标路径，用不到它；留着是为了诊断和将来可能的坐标换算。
                    captureOrigin: { left: captureWindow.left, top: captureWindow.top },
                    selectionBoundsOriginal: selectionBounds
                },
                capture: {
                    croppedToSelection: useSourceBounds,
                    windowWidth: capturedWindowWidth,
                    windowHeight: capturedWindowHeight,
                    capturedWidth: effectiveWidth,
                    capturedHeight: effectiveHeight,
                    selectionNativeEdge,
                    selectionCapturedEdge,
                    placementUpscale,
                    notice: captureNotice
                }
            };

            if (includeImage) {
                result.image = imageBase64;
                result.imageFormat = 'raw';
                result.imageChannels = 4;
            }

            console.log(`[GetSelectionMask] 获取成功 (mask=${result.maskFormat}, image=${result.imageFormat || 'none'})`);
            return result;

        } catch (error: any) {
            const errorMessage = toErrorMessage(error);
            console.error('[GetSelectionMask] 错误:', errorMessage);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * 检查是否有活动选区（同时返回边界，避免重复查询）
     */
    private async checkSelection(): Promise<boolean> {
        // 使用 getSelectionBounds 做统一判断：有边界 = 有选区
        const bounds = await this.getSelectionBounds();
        return bounds !== null;
    }

    private async getSelectionBounds(): Promise<{ left: number; top: number; right: number; bottom: number } | null> {
        try {
            const result = await batchPlay([
                buildSelectionReadDescriptor('selection')
            ], READ_ONLY_SELECTION_BATCH_PLAY_OPTIONS);

            const selection = result?.[0]?.selection;
            if (!selection) {
                return null;
            }

            // 必须同时有四个边界值才算有效选区
            const left = selection.left?._value ?? selection.left;
            const top = selection.top?._value ?? selection.top;
            const right = selection.right?._value ?? selection.right;
            const bottom = selection.bottom?._value ?? selection.bottom;

            if (left === undefined || top === undefined || right === undefined || bottom === undefined) {
                return null;
            }

            const l = Math.round(Number(left));
            const t = Math.round(Number(top));
            const r = Math.round(Number(right));
            const b = Math.round(Number(bottom));

            // 选区宽高必须 > 0
            if (r <= l || b <= t) {
                return null;
            }

            // 排除"全画布选区"（无选区时 PS 返回全文档边界，不是用户创建的真实选区）
            const doc = app.activeDocument;
            if (doc) {
                const docW = doc.width as number;
                const docH = doc.height as number;
                if (l <= 0 && t <= 0 && r >= docW && b >= docH) {
                    console.log('[GetSelectionMask] 检测到全画布选区，视为无选区');
                    return null;
                }
            }

            return { left: l, top: t, right: r, bottom: b };
        } catch {
            return null;
        }
    }

    /**
     * 将像素数据转换为 Base64
     */
    private async pixelDataToBase64(data: Uint8Array, width: number, height: number, isGrayscale: boolean): Promise<string> {
        const pixelCount = width * height;
        const rgb = new Uint8Array(pixelCount * 3);

        if (isGrayscale) {
            // 灰度图 -> RGB
            for (let i = 0; i < pixelCount; i++) {
                const gray = data[i * 4] || 0; // 取第一个通道
                const offset = i * 3;
                rgb[offset] = gray;
                rgb[offset + 1] = gray;
                rgb[offset + 2] = gray;
            }
        } else {
            // RGBA -> RGB（UXP encodeImageData 仅支持 JPEG，不能含 alpha）
            for (let i = 0; i < pixelCount; i++) {
                const src = i * 4;
                const dst = i * 3;
                rgb[dst] = data[src] || 0;
                rgb[dst + 1] = data[src + 1] || 0;
                rgb[dst + 2] = data[src + 2] || 0;
            }
        }

        // UXP 环境没有 OffscreenCanvas，使用 Photoshop Imaging API 编码
        const imageDataObj = await imaging.createImageDataFromBuffer(rgb, {
            width,
            height,
            components: 3,
            colorSpace: 'RGB',
            colorProfile: 'sRGB IEC61966-2.1'
        });

        try {
            const encoded = await imaging.encodeImageData({
                imageData: imageDataObj,
                base64: true
            });

            if (typeof encoded === 'string') {
                return encoded;
            }

            // 兼容返回 number[] 的情况
            const bytes = new Uint8Array(encoded as number[]);
            return uint8ArrayToBase64(bytes);
        } finally {
            imageDataObj.dispose();
        }
    }

}

/**
 * Apply a raster image result.
 */
export class ApplyRasterImageResultTool implements Tool {
    name = 'applyRasterImageResult';

    schema: ToolSchema = {
        name: 'applyRasterImageResult',
        description: 'Apply a raster image result onto a new Photoshop layer.',
        parameters: {
            type: 'object',
            properties: {
                imageData: {
                    type: 'string',
                    description: 'Base64-encoded image payload.'
                },
                filePath: {
                    type: 'string',
                    description: 'Optional local file path to a raster image result.'
                },
                layerName: {
                    type: 'string',
                    description: 'Optional destination layer name.'
                },
                width: {
                    type: 'number',
                    description: 'Result width in pixels.'
                },
                height: {
                    type: 'number',
                    description: 'Result height in pixels.'
                },
                placementWidth: {
                    type: 'number',
                    description: 'Target width for placement on canvas.'
                },
                placementHeight: {
                    type: 'number',
                    description: 'Target height for placement on canvas.'
                },
                originalWidth: {
                    type: 'number',
                    description: 'Original document width.'
                },
                originalHeight: {
                    type: 'number',
                    description: 'Original document height.'
                },
                targetBounds: {
                    type: 'object',
                    description: 'Destination top-left position.',
                    properties: {
                        left: { type: 'number', description: 'Target left coordinate.' },
                        top: { type: 'number', description: 'Target top coordinate.' }
                    }
                }
            },
            required: ['imageData']
        }
    };

    async execute(params: { imageData: string; filePath?: string; imageBytes?: Uint8Array; imageFormat?: string; isRawRgba?: boolean; layerName?: string; width?: number; height?: number; placementWidth?: number; placementHeight?: number; originalWidth?: number; originalHeight?: number; targetBounds?: { left?: number; top?: number } }): Promise<any> {
        const layerName = params.layerName || '图像结果';
        let createdLayerId: number | null = null;
        // 落位时做了取舍（比例对不上）就在这里留话，随结果返回给面板；无取舍时保持 undefined
        let placementNotice: string | undefined;

        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            let bytes: Uint8Array | undefined;
            let encodedFormatHint = params.imageFormat;
            const hasFilePath = typeof params.filePath === 'string' && params.filePath.length > 0;
            const isRaw = params.isRawRgba === true;
            if (params.imageBytes instanceof Uint8Array) {
                bytes = params.imageBytes;
            } else if (!hasFilePath) {
                if (isRaw) {
                    const rawPayload = (params.imageData || '').replace(/^data:[^;]+;base64,/, '');
                    bytes = decodeBase64Bytes(rawPayload);
                } else {
                    const decoded = bytesFromBase64ImagePayload(params.imageData || '');
                    bytes = decoded.bytes;
                    encodedFormatHint = encodedFormatHint || decoded.mimeType;
                }
            }

            if (!isRaw && bytes) {
                assertImageBytesSafeForPhotoshop(bytes, {
                    formatHint: encodedFormatHint,
                    sourceLabel: `局部重绘结果「${layerName}」`
                });
            }

            const docWidth = doc.width as number;
            const docHeight = doc.height as number;
            const imgWidth = params.width || docWidth;
            const imgHeight = params.height || docHeight;
            const placementWidth = params.placementWidth || imgWidth;
            const placementHeight = params.placementHeight || imgHeight;
            const expectedSize = imgWidth * imgHeight * 4;

            console.log(`[ApplyRasterImageResult] image=${imgWidth}x${imgHeight}, placement=${placementWidth}x${placementHeight}, doc=${docWidth}x${docHeight}, isRaw=${isRaw}, hasFilePath=${hasFilePath}, bytes=${bytes?.length || 0}, expected=${expectedSize}`);

            if (isRaw && (!bytes || bytes.length !== expectedSize)) {
                return {
                    success: false,
                    error: `Pixel payload size mismatch: got ${bytes?.length || 0}, expected ${expectedSize} (${imgWidth}x${imgHeight}x4)`
                };
            }

            await core.executeAsModal(async () => {
                if (!isRaw) {
                    const storage = uxp.storage;
                    let fileEntry: any = null;
                    let createdTempFile: any = null;

                    try {
                        if (hasFilePath) {
                            try {
                                fileEntry = await fs.getEntryWithUrl('file://' + params.filePath!.replace(/\\/g, '/'));
                            } catch (pathError) {
                                fileEntry = await fs.getEntryWithUrl(params.filePath!);
                            }
                            const fileBytes = await readFileEntryBytes(fileEntry, storage);
                            assertImageBytesSafeForPhotoshop(fileBytes, {
                                formatHint: params.imageFormat || extensionFromPath(params.filePath!),
                                sourceLabel: `图像结果文件「${params.filePath!.split(/[\\/]/).pop() || params.filePath}」`
                            });
                        } else {
                            const tempFolder = await fs.getTemporaryFolder();
                            const ext = (params.imageFormat || 'png').replace(/^\./, '') || 'png';
                            const tempFile = await tempFolder.createFile(`inpaint_${Date.now()}.${ext}`, { overwrite: true });
                            await tempFile.write(arrayBufferFromBytes(bytes!), { format: storage.formats.binary });
                            fileEntry = tempFile;
                            createdTempFile = tempFile;
                        }

                        const sessionToken = await fs.createSessionToken(fileEntry);

                        await batchPlay([
                            {
                                _obj: 'placeEvent',
                                null: { _path: sessionToken, _kind: 'local' },
                                freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
                                offset: {
                                    _obj: 'offset',
                                    horizontal: { _unit: 'pixelsUnit', _value: 0 },
                                    vertical: { _unit: 'pixelsUnit', _value: 0 }
                                },
                                _options: { dialogOptions: 'dontDisplay' }
                            }
                        ], { synchronousExecution: true });

                        const newLayer = doc.activeLayers?.[0];
                        if (!newLayer) {
                            throw new Error('Failed to place raster image result');
                        }

                        createdLayerId = newLayer.id;
                        newLayer.name = layerName;

                        const initialBounds = getLayerBoundsNoEffects(newLayer);
                        const layerWidth = initialBounds.right - initialBounds.left;
                        const layerHeight = initialBounds.bottom - initialBounds.top;

                        if (layerWidth > 0 && layerHeight > 0) {
                            const scaleDecision = resolveResultPlacementScale({
                                imageWidth: layerWidth,
                                imageHeight: layerHeight,
                                placementWidth,
                                placementHeight
                            });
                            placementNotice = scaleDecision.notice;

                            const { scaleWidthPercent, scaleHeightPercent } = scaleDecision;
                            const needsResize =
                                Math.abs(scaleWidthPercent - 100) > 0.1 || Math.abs(scaleHeightPercent - 100) > 0.1;

                            console.log(
                                `[ApplyRasterImageResult] 落位缩放：${layerWidth}x${layerHeight} → ` +
                                `${scaleWidthPercent.toFixed(2)}% x ${scaleHeightPercent.toFixed(2)}%` +
                                (scaleDecision.notice ? ` | ${scaleDecision.notice}` : '')
                            );

                            if (needsResize) {
                                // linked:true —— 等比链接。原实现是 linked:false 且宽高各算各的，
                                // 只要生成图比例与目标位置不一致就会把画面拉变形。
                                // 现在两个方向的系数由 resolveResultPlacementScale 统一决定，
                                // 比例一致时必然相等；不一致时由落位策略显式取舍并给出说明。
                                await batchPlay([
                                    {
                                        _obj: 'transform',
                                        _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                                        freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
                                        width: { _unit: 'percentUnit', _value: scaleWidthPercent },
                                        height: { _unit: 'percentUnit', _value: scaleHeightPercent },
                                        linked: true,
                                        interfaceIconFrameDimmed: { _enum: 'interpolationType', _value: 'bicubic' },
                                        _options: { dialogOptions: 'dontDisplay' }
                                    }
                                ], {});
                            }
                        }

                        if (params.targetBounds && (typeof params.targetBounds.left === 'number' || typeof params.targetBounds.top === 'number')) {
                            const currentBounds = getLayerBoundsNoEffects(newLayer);
                            const currentX = currentBounds.left;
                            const currentY = currentBounds.top;
                            const targetX = Math.round(params.targetBounds.left || 0);
                            const targetY = Math.round(params.targetBounds.top || 0);
                            const moveX = targetX - currentX;
                            const moveY = targetY - currentY;

                            if (moveX !== 0 || moveY !== 0) {
                                await translateLayer(newLayer, moveX, moveY);
                            }
                        }
                    } finally {
                        if (createdTempFile) {
                            try { await createdTempFile.delete(); } catch {}
                        }
                    }

                    return;
                }

                const targetPixelSpec = await getDocumentPixelSpec(doc.id);
                const sourcePixelData = convertRgba8ToTargetDepth(bytes!, targetPixelSpec.componentSize);
                console.log(`[ApplyRasterImageResult] targetPixelSpec=${targetPixelSpec.componentSize}/${targetPixelSpec.colorProfile}`);

                await batchPlay([
                    {
                        _obj: 'make',
                        _target: [{ _ref: 'layer' }],
                        using: { _obj: 'layer', name: layerName },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], {});

                const newLayer = doc.activeLayers?.[0];
                if (!newLayer) {
                    throw new Error('创建图层失败');
                }
                createdLayerId = newLayer.id;

                const imageDataObj = await imaging.createImageDataFromBuffer(sourcePixelData, {
                    width: imgWidth,
                    height: imgHeight,
                    components: 4,
                    colorSpace: 'RGB',
                    colorProfile: 'sRGB IEC61966-2.1'
                });

                try {
                    await imaging.putPixels({
                        documentID: doc.id,
                        layerID: newLayer.id,
                        imageData: imageDataObj,
                        targetBounds: {
                            left: Math.round(params.targetBounds?.left || 0),
                            top: Math.round(params.targetBounds?.top || 0)
                        }
                    });
                } finally {
                    imageDataObj.dispose();
                }

                const hasExplicitTargetBounds = params.targetBounds
                    && (typeof params.targetBounds.left === 'number' || typeof params.targetBounds.top === 'number');

                if (!hasExplicitTargetBounds
                    && params.originalWidth
                    && params.originalHeight
                    && (Math.abs(imgWidth - params.originalWidth) > 1 || Math.abs(imgHeight - params.originalHeight) > 1)) {
                    const scaleW = (params.originalWidth / imgWidth) * 100;
                    const scaleH = (params.originalHeight / imgHeight) * 100;

                    await batchPlay([
                        {
                            _obj: 'transform',
                            _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                            freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
                            width: { _unit: 'percent', _value: scaleW },
                            height: { _unit: 'percent', _value: scaleH },
                            linked: false,
                            interfaceIconFrameDimmed: { _enum: 'interpolationType', _value: 'bicubic' }
                        }
                    ], {});
                }
            }, { commandName: 'DesignEcho: 应用图像结果' });

            return {
                success: true,
                layerName,
                layerId: createdLayerId,
                writeMode: 'new-layer',
                sourceDocumentPreserved: true,
                placementNotice
            };

        } catch (error: any) {
            const errorMessage =
                error?.message
                || (typeof error === 'string' ? error : '')
                || (() => {
                    try {
                        return JSON.stringify(error);
                    } catch {
                        return '';
                    }
                })()
                || 'Unknown error';
            console.error('[ApplyRasterImageResult] Error:', errorMessage, error);
            return { success: false, error: errorMessage };
        }
    }
}

/**
 * Get current selection bounds.
 */
export class GetSelectionBoundsTool implements Tool {
    name = 'getSelectionBounds';

    schema: ToolSchema = {
        name: 'getSelectionBounds',
        description: 'Get the current Photoshop selection bounds.',
        parameters: {
            type: 'object',
            properties: {}
        }
    };

    async execute(): Promise<any> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: 'No active document', hasSelection: false };
            }

            const result = await batchPlay([
                buildSelectionReadDescriptor('selection')
            ], READ_ONLY_SELECTION_BATCH_PLAY_OPTIONS);

            if (!result[0] || !result[0].selection) {
                return {
                    success: false,
                    error: 'Please create a selection first',
                    hasSelection: false
                };
            }

            const selection = result[0].selection;
            let bounds: { left: number; top: number; right: number; bottom: number } | null = null;

            if (selection.left !== undefined && selection.top !== undefined) {
                bounds = {
                    left: Math.round(selection.left._value || selection.left),
                    top: Math.round(selection.top._value || selection.top),
                    right: Math.round(selection.right._value || selection.right),
                    bottom: Math.round(selection.bottom._value || selection.bottom)
                };
            } else {
                const boundsResult = await batchPlay([
                    buildSelectionReadDescriptor('selectionBounds')
                ], READ_ONLY_SELECTION_BATCH_PLAY_OPTIONS);

                if (boundsResult[0] && boundsResult[0].selectionBounds) {
                    const sb = boundsResult[0].selectionBounds;
                    bounds = {
                        left: Math.round(sb.left._value || sb.left || 0),
                        top: Math.round(sb.top._value || sb.top || 0),
                        right: Math.round(sb.right._value || sb.right || 0),
                        bottom: Math.round(sb.bottom._value || sb.bottom || 0)
                    };
                }
            }

            if (!bounds) {
                return {
                    success: false,
                    error: 'Unable to resolve selection bounds',
                    hasSelection: true
                };
            }

            const width = bounds.right - bounds.left;
            const height = bounds.bottom - bounds.top;

            return {
                success: true,
                hasSelection: true,
                bounds,
                box: [bounds.left, bounds.top, bounds.right, bounds.bottom],
                width,
                height,
                documentWidth: doc.width as number,
                documentHeight: doc.height as number
            };
        } catch (error: any) {
            console.error('[GetSelectionBounds] Error:', error?.message || error);
            return { success: false, error: error?.message || String(error), hasSelection: false };
        }
    }
}
