/**
 * 导出图层为 Base64 / Raw 像素工具
 *
 * 三种模式：
 *  - imaging (默认)：使用 Photoshop UXP Imaging API 抓取像素并编码为 JPEG（仅 UXP 支持 JPEG 编码）。
 *                   适合快速抓取、缩略图、shape-morphing 等对画质要求不极致的场景。
 *  - native-png   ：通过 JSX 桥调用 Photoshop 原生 `doc.duplicate()` + `trim` + `saveAs PNG`，
 *                   然后把文件读回为 Base64。无损 PNG，画质上限 = Photoshop 渲染的上限。
 *                   适合需要 PS 端文件编码的场景；对原文档无破坏，但会短暂出现一个临时文档标签。
 *  - pixels-rgba  ：直接 `imaging.getPixels({ layerID })` 抓取目标图层的 raw RGBA 像素并返回
 *                   `Uint8Array`，**完全不创建任何临时文档、不动 visibility、PS 端零文档操作**，
 *                   实现真正的"零闪烁、无感"体验。调用方负责把 raw RGBA 通过二进制 ws 帧或
 *                   其它通道送给下游编码（推荐 Agent 端 sharp 编 PNG）。
 *
 * 说明：老版本会把 alpha 通道用 `|||` 拼到 base64 字符串后面，这会使 `data:image/...;base64,...`
 *       成为非法 Base64，导致下游（如火山方舟 Seedream）报 `Invalid base64 image_url`。
 *       新版本已移除该拼接，改用独立字段 `alphaChannel` 返回 alpha 数据。
 */

import { action, app, core, imaging } from 'photoshop';
import { storage } from 'uxp';
import { runJsxCode } from '../../core/jsx-bridge';
import { ToolResult } from '../types';

const fs = storage.localFileSystem;

/**
 * 将 Uint8Array 转换为 Base64（分块处理避免栈溢出）
 */
function uint8ArrayToBase64(data: Uint8Array): string {
    const CHUNK_SIZE = 32768;
    let binary = '';
    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
        const chunk = data.subarray(i, Math.min(i + CHUNK_SIZE, data.length));
        binary += String.fromCharCode.apply(null, chunk as any);
    }
    return btoa(binary);
}

export type ExportLayerMode = 'imaging' | 'native-png' | 'pixels-rgba';

export interface ExportLayerParams {
    layerId: number;
    /**
     * imaging: JPEG（快、适合 shape-morphing 等场景）
     * native-png: 通过 Photoshop 原生 saveAs 导出 PNG（无损，画质满血但临时文档会闪一下标签）
     * pixels-rgba: 直接抓 RGBA 像素，零文档操作（最优用户体验，需调用方自己处理传输/编码）
     */
    mode?: ExportLayerMode;
    /**
     * 仅在 imaging 模式下使用。native-png 模式下 format 固定为 'png'。pixels-rgba 模式忽略。
     */
    format?: 'png' | 'jpeg';
    /** 保留参数，当前 imaging 路径仅用 JPEG 编码，未显式设置 quality */
    quality?: number;
    /** 最大边长（像素），超过会按比例缩放 */
    maxSize?: number;
}

export interface ExportLayerAlphaChannel {
    base64: string;
    width: number;
    height: number;
}

export interface ExportLayerResult {
    success: boolean;
    /** 图像主数据的 Base64（不含 data URL 前缀），保证为合法 Base64 字符串。pixels-rgba 模式下为空。 */
    base64: string;
    /**
     * 实际 Base64 的 MIME 类型：
     *   - native-png：image/png
     *   - imaging：image/jpeg
     *   - pixels-rgba：image/x-raw-rgba（约定值，标识返回的是 raw 像素，不是已编码图像）
     */
    mimeType: 'image/png' | 'image/jpeg' | 'image/x-raw-rgba';
    /** 实际数据的输出尺寸（可能已按 maxSize 缩放） */
    width: number;
    height: number;
    /** 兼容字段（与 mimeType 同步） */
    format: string;
    /** 原图层在文档坐标系下的 bounds */
    contentBounds?: {
        left: number;
        top: number;
        right: number;
        bottom: number;
        width: number;
        height: number;
    };
    /** 仅 imaging 模式可能返回（原先用 `|||ALPHA:` 拼在 base64 后面，现独立成字段） */
    alphaChannel?: ExportLayerAlphaChannel;
    /**
     * 仅 pixels-rgba 模式：raw RGBA 像素 buffer（每像素 4 字节，行优先，从左上到右下）。
     * 不在此处做 base64 编码以避免 v8 处理超大字符串的内存峰值；调用方应通过二进制 ws 帧传输。
     */
    rawPixels?: Uint8Array;
    /** 仅 pixels-rgba 模式：通道数（通常 = 4 = RGBA） */
    components?: number;
    /** 仅 pixels-rgba 模式：每通道位深（通常 = 8） */
    componentSize?: number;
}

/**
 * 对外暴露的统一入口
 */
export async function exportLayerAsBase64(params: ExportLayerParams): Promise<ToolResult<ExportLayerResult>> {
    const requestedMode = params.mode;
    const mode: ExportLayerMode = requestedMode === 'native-png' || requestedMode === 'pixels-rgba'
        ? requestedMode
        : 'imaging';
    console.log(`[ExportLayer] 开始导出图层，mode=${mode}...`);
    const startTime = performance.now();

    try {
        const { layerId, format = 'png', quality = 80, maxSize = 2048 } = params;

        const doc = app.activeDocument;
        if (!doc) {
            return {
                success: false,
                error: '没有打开的文档',
                data: null
            };
        }

        const layer = findLayerById(doc, layerId);
        if (!layer) {
            return {
                success: false,
                error: `未找到图层 ID: ${layerId}`,
                data: null
            };
        }

        console.log(`[ExportLayer] 图层: ${layer.name} (ID: ${layerId})`);

        const bounds = layer.boundsNoEffects || layer.bounds;
        const layerWidth = bounds.right - bounds.left;
        const layerHeight = bounds.bottom - bounds.top;

        console.log(`[ExportLayer] 图层尺寸: ${layerWidth}x${layerHeight}`);

        if (mode === 'native-png') {
            const nativeResult = await exportUsingNativePNG(layerId, maxSize);
            const processingTime = performance.now() - startTime;
            console.log(
                `[ExportLayer] ✅ native-png 完成, ${Math.round(nativeResult.base64.length / 1024)}KB, ` +
                `${nativeResult.width}x${nativeResult.height}, 耗时 ${processingTime.toFixed(0)}ms`
            );

            return {
                success: true,
                data: {
                    success: true,
                    base64: nativeResult.base64,
                    mimeType: 'image/png',
                    width: nativeResult.width,
                    height: nativeResult.height,
                    format: 'png',
                    contentBounds: nativeResult.contentBounds || {
                        left: bounds.left,
                        top: bounds.top,
                        right: bounds.right,
                        bottom: bounds.bottom,
                        width: layerWidth,
                        height: layerHeight
                    }
                }
            };
        }

        if (mode === 'pixels-rgba') {
            const rawResult = await exportUsingPixelsRGBA(doc.id, layerId, layer, maxSize);
            const processingTime = performance.now() - startTime;
            console.log(
                `[ExportLayer] ✅ pixels-rgba 完成（零文档操作）, ` +
                `${Math.round(rawResult.rawPixels.length / 1024)}KB raw, ` +
                `${rawResult.width}x${rawResult.height}, 耗时 ${processingTime.toFixed(0)}ms`
            );

            return {
                success: true,
                data: {
                    success: true,
                    base64: '',
                    mimeType: 'image/x-raw-rgba',
                    width: rawResult.width,
                    height: rawResult.height,
                    format: 'raw-rgba',
                    rawPixels: rawResult.rawPixels,
                    components: rawResult.components,
                    componentSize: rawResult.componentSize,
                    contentBounds: {
                        left: bounds.left,
                        top: bounds.top,
                        right: bounds.right,
                        bottom: bounds.bottom,
                        width: layerWidth,
                        height: layerHeight
                    }
                }
            };
        }

        let imagingOutput: ImagingExportOutput;
        try {
            imagingOutput = await exportUsingImagingAPI(doc.id, layer, format, quality, maxSize);
        } catch (imagingError: any) {
            console.warn('[ExportLayer] Imaging API 失败，尝试 batchPlay 方式:', imagingError.message);
            imagingOutput = await exportUsingBatchPlay(doc, layer, format);
        }

        let outputWidth = layerWidth;
        let outputHeight = layerHeight;
        if (layerWidth > maxSize || layerHeight > maxSize) {
            const scale = Math.min(maxSize / layerWidth, maxSize / layerHeight);
            outputWidth = Math.round(layerWidth * scale);
            outputHeight = Math.round(layerHeight * scale);
        }

        const processingTime = performance.now() - startTime;
        console.log(
            `[ExportLayer] ✅ imaging 完成, ${Math.round(imagingOutput.base64.length / 1024)}KB, 耗时 ${processingTime.toFixed(0)}ms`
        );

        return {
            success: true,
            data: {
                success: true,
                base64: imagingOutput.base64,
                mimeType: 'image/jpeg',
                width: outputWidth,
                height: outputHeight,
                format: 'jpeg',
                contentBounds: {
                    left: bounds.left,
                    top: bounds.top,
                    right: bounds.right,
                    bottom: bounds.bottom,
                    width: layerWidth,
                    height: layerHeight
                },
                ...(imagingOutput.alphaChannel ? { alphaChannel: imagingOutput.alphaChannel } : {})
            }
        };
    } catch (error: any) {
        console.error('[ExportLayer] 失败:', error);
        return {
            success: false,
            error: error.message,
            data: null
        };
    }
}

interface ImagingExportOutput {
    base64: string;
    alphaChannel?: ExportLayerAlphaChannel;
}

/**
 * 使用 Imaging API 导出（JPEG）
 *
 * 策略：临时隐藏其他图层，使用 documentID 获取合成像素，然后恢复图层可见性。
 */
async function exportUsingImagingAPI(
    docId: number,
    layer: any,
    _format: string,
    _quality: number,
    maxSize: number
): Promise<ImagingExportOutput> {
    let output: ImagingExportOutput = { base64: '' };

    await core.executeAsModal(async () => {
        const doc = app.activeDocument!;

        const bounds = layer.boundsNoEffects || layer.bounds;
        const layerWidth = bounds.right - bounds.left;
        const layerHeight = bounds.bottom - bounds.top;

        let targetWidth = layerWidth;
        let targetHeight = layerHeight;

        if (layerWidth > maxSize || layerHeight > maxSize) {
            const scale = Math.min(maxSize / layerWidth, maxSize / layerHeight);
            targetWidth = Math.round(layerWidth * scale);
            targetHeight = Math.round(layerHeight * scale);
        }

        const layerVisibility: Map<number, boolean> = new Map();

        function collectAllLayers(container: any): any[] {
            const result: any[] = [];
            for (const l of container.layers) {
                result.push(l);
                if (l.layers) {
                    result.push(...collectAllLayers(l));
                }
            }
            return result;
        }

        const allLayers = collectAllLayers(doc);

        const hiddenLayers: string[] = [];
        for (const l of allLayers) {
            layerVisibility.set(l.id, l.visible);
            if (l.id !== layer.id) {
                if (l.visible) {
                    hiddenLayers.push(l.name);
                }
                l.visible = false;
            } else {
                l.visible = true;
            }
        }
        console.log(`[ExportLayer] 单图层导出: 只保留 "${layer.name}" 可见，临时隐藏 ${hiddenLayers.length} 层`);

        try {
            const pixelData = await imaging.getPixels({
                documentID: docId,
                sourceBounds: {
                    left: bounds.left,
                    top: bounds.top,
                    right: bounds.right,
                    bottom: bounds.bottom
                },
                targetSize: {
                    width: targetWidth,
                    height: targetHeight
                },
                applyAlpha: false
            });

            const rawData = pixelData.imageData;
            const components = rawData.components;

            let alpha: ExportLayerAlphaChannel | undefined;
            if (components >= 4) {
                const totalPixels = targetWidth * targetHeight;
                const alphaData = new Uint8Array(totalPixels);
                const pixelBuffer = await rawData.getData();
                for (let i = 0; i < totalPixels; i++) {
                    alphaData[i] = pixelBuffer[i * components + 3];
                }
                alpha = {
                    base64: uint8ArrayToBase64(alphaData),
                    width: targetWidth,
                    height: targetHeight
                };
            }

            const rgbPixelData = await imaging.getPixels({
                documentID: docId,
                sourceBounds: {
                    left: bounds.left,
                    top: bounds.top,
                    right: bounds.right,
                    bottom: bounds.bottom
                },
                targetSize: {
                    width: targetWidth,
                    height: targetHeight
                },
                applyAlpha: true
            });

            const encodedData = await imaging.encodeImageData({
                imageData: rgbPixelData.imageData,
                base64: true
            });

            pixelData.imageData.dispose();
            rgbPixelData.imageData.dispose();

            const imageBase64 = typeof encodedData === 'string' ? encodedData : (encodedData as any).base64 || '';
            output = alpha ? { base64: imageBase64, alphaChannel: alpha } : { base64: imageBase64 };
        } finally {
            for (const l of allLayers) {
                const originalVisible = layerVisibility.get(l.id);
                if (originalVisible !== undefined) {
                    l.visible = originalVisible;
                }
            }
        }
    }, { commandName: '导出图层为Base64' });

    return output;
}

/**
 * 使用备用 batchPlay 方式导出（Imaging API 失败时的退路）
 */
async function exportUsingBatchPlay(_doc: any, layer: any, _format: string): Promise<ImagingExportOutput> {
    let output: ImagingExportOutput = { base64: '' };

    await core.executeAsModal(async () => {
        const doc = app.activeDocument!;
        const bounds = layer.bounds;
        const layerWidth = bounds.right - bounds.left;
        const layerHeight = bounds.bottom - bounds.top;

        const layerVisibility: Map<number, boolean> = new Map();

        function collectAllLayers(container: any): any[] {
            const result: any[] = [];
            for (const l of container.layers) {
                result.push(l);
                if (l.layers) {
                    result.push(...collectAllLayers(l));
                }
            }
            return result;
        }

        const allLayers = collectAllLayers(doc);

        for (const l of allLayers) {
            layerVisibility.set(l.id, l.visible);
            l.visible = l.id === layer.id;
        }

        try {
            const targetWidth = Math.min(layerWidth, 2048);
            const targetHeight = Math.min(layerHeight, 2048);

            const pixelDataRaw = await imaging.getPixels({
                documentID: doc.id,
                sourceBounds: {
                    left: bounds.left,
                    top: bounds.top,
                    right: bounds.right,
                    bottom: bounds.bottom
                },
                targetSize: {
                    width: targetWidth,
                    height: targetHeight
                },
                applyAlpha: false
            });

            const rawData = pixelDataRaw.imageData;
            const components = rawData.components;

            let alpha: ExportLayerAlphaChannel | undefined;
            if (components >= 4) {
                const totalPixels = targetWidth * targetHeight;
                const alphaData = new Uint8Array(totalPixels);
                const pixelBuffer = await rawData.getData();
                for (let i = 0; i < totalPixels; i++) {
                    alphaData[i] = pixelBuffer[i * components + 3];
                }
                alpha = {
                    base64: uint8ArrayToBase64(alphaData),
                    width: targetWidth,
                    height: targetHeight
                };
            }

            pixelDataRaw.imageData.dispose();

            const pixelData = await imaging.getPixels({
                documentID: doc.id,
                sourceBounds: {
                    left: bounds.left,
                    top: bounds.top,
                    right: bounds.right,
                    bottom: bounds.bottom
                },
                targetSize: {
                    width: targetWidth,
                    height: targetHeight
                },
                applyAlpha: true
            });

            const encodedData = await imaging.encodeImageData({
                imageData: pixelData.imageData,
                base64: true
            });

            pixelData.imageData.dispose();

            const imageBase64 = typeof encodedData === 'string' ? encodedData : (encodedData as any).base64 || '';
            output = alpha ? { base64: imageBase64, alphaChannel: alpha } : { base64: imageBase64 };
        } finally {
            for (const l of allLayers) {
                const originalVisible = layerVisibility.get(l.id);
                if (originalVisible !== undefined) {
                    l.visible = originalVisible;
                }
            }
        }
    }, { commandName: '导出图层为Base64' });

    return output;
}

interface NativePNGExportResult {
    base64: string;
    width: number;
    height: number;
    contentBounds?: {
        left: number;
        top: number;
        right: number;
        bottom: number;
        width: number;
        height: number;
    };
}

/**
 * native-png 模式：通过 JSX 桥调用 Photoshop 原生 saveAs 导出无损 PNG
 *
 * 「零闪烁」流程（v2）：
 *   1. **完全不修改原文档的图层可见性**（这是 v1 黑屏闪烁的根因）
 *   2. `sourceDoc.duplicate(tempName, false)` 全量复制图层结构 → 临时文档与原文档画面一致
 *      PS 会自动把临时文档设为 activeDocument，此时用户看到的"切换"是无缝的
 *   3. 在临时文档上递归删除所有非目标图层（含空组），破坏只发生在临时文档
 *   4. 在临时文档上 `trim(TrimType.TRANSPARENT)` → 紧贴目标图层
 *   5. 如尺寸超 maxSize 用 `resizeImage` 等比缩放
 *   6. `saveAs` 为 PNG（PNGSaveOptions, compression=6, interlaced=false）到临时文件
 *   7. 关闭临时文档（DONOTSAVECHANGES，原文档自动重新激活）
 *   8. UXP 侧把 PNG 文件读回 Base64，删除临时文件
 *
 * 用户观感：原文档画面全程不变；标签栏短暂出现一个临时标签做事；不再有黑屏。
 */
async function exportUsingNativePNG(layerId: number, maxSize: number): Promise<NativePNGExportResult> {
    const tempFolder = await fs.getTemporaryFolder();
    const tempFileName = `designecho_i2i_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
    const tempFile = await tempFolder.createFile(tempFileName, { overwrite: true });
    const tempFilePath: string = (tempFile as any).nativePath;
    if (!tempFilePath) {
        throw new Error('无法获取临时文件 nativePath');
    }

    const escapedPath = tempFilePath.replace(/\\/g, '/').replace(/'/g, "\\'");
    const normalizedMaxSize = Math.max(0, Math.floor(Number(maxSize) || 0));

    const jsx = `
var __dePrevDialogs = app.displayDialogs;
app.displayDialogs = DialogModes.NO;
var __deOutput = '';
function __deEncode(value) {
    return encodeURIComponent(String(value === undefined || value === null ? '' : value));
}
function __deResult(fields) {
    var parts = [];
    for (var key in fields) {
        if (!fields.hasOwnProperty(key)) continue;
        if (fields[key] === undefined || fields[key] === null) continue;
        parts.push(__deEncode(key) + '=' + __deEncode(fields[key]));
    }
    __deOutput = '__DESIGNECHO_RESULT__' + parts.join('&');
    return __deOutput;
}

var sourceDoc = null;
var tempDoc = null;
try {
    if (!app.documents.length) throw new Error('No active document');
    sourceDoc = app.activeDocument;

    var LAYER_ID = ${Number(layerId) || 0};
    var MAX_SIZE = ${normalizedMaxSize};

    function findLayerById(container, id) {
        if (!container || !container.layers) return null;
        for (var i = 0; i < container.layers.length; i++) {
            var l = container.layers[i];
            if (l.id === id) return l;
            if (l.layers && l.layers.length > 0) {
                var found = findLayerById(l, id);
                if (found) return found;
            }
        }
        return null;
    }

    function asPixels(unitValue) {
        try { return Number(unitValue.as('px')); }
        catch (e) { return Number(unitValue); }
    }

    var srcTargetLayer = findLayerById(sourceDoc, LAYER_ID);
    if (!srcTargetLayer) throw new Error('Target layer not found: ' + LAYER_ID);

    // 在删除前用源文档读取 bounds（保证使用原始坐标，不被 tempDoc 后续 trim/resize 影响）
    var contentLeft = 0, contentTop = 0, contentRight = 0, contentBottom = 0;
    try {
        contentLeft = Math.round(asPixels(srcTargetLayer.bounds[0]));
        contentTop = Math.round(asPixels(srcTargetLayer.bounds[1]));
        contentRight = Math.round(asPixels(srcTargetLayer.bounds[2]));
        contentBottom = Math.round(asPixels(srcTargetLayer.bounds[3]));
    } catch (boundsError) {}

    // 1. 全量 duplicate（保留所有图层结构 + 当前可见性）
    //    PS 会把 tempDoc 自动设为 activeDocument；视觉上和原文档一致，无闪烁
    var tempName = 'designecho_i2i_' + (new Date().getTime());
    tempDoc = sourceDoc.duplicate(tempName, false);
    app.activeDocument = tempDoc;

    // 2. 在 tempDoc 上递归删除所有非目标图层（自底向上 + 同步删空组）
    //    所有破坏操作只影响 tempDoc，原文档 sourceDoc 完全不动
    function pruneNonTarget(container, keepId) {
        if (!container || !container.layers) return false;
        var hasTargetInside = false;
        for (var i = container.layers.length - 1; i >= 0; i--) {
            var l = container.layers[i];
            if (l.id === keepId) {
                hasTargetInside = true;
                continue;
            }
            if (l.layers && l.layers.length > 0) {
                var subHasTarget = pruneNonTarget(l, keepId);
                if (subHasTarget) {
                    hasTargetInside = true;
                } else {
                    try { l.remove(); } catch (rmGroupError) {}
                }
            } else {
                try { l.remove(); } catch (rmLeafError) {}
            }
        }
        return hasTargetInside;
    }
    var foundInTemp = pruneNonTarget(tempDoc, LAYER_ID);
    if (!foundInTemp) {
        throw new Error('Target layer disappeared after duplication: ' + LAYER_ID);
    }

    // 3. trim 透明边界
    try {
        tempDoc.trim(TrimType.TRANSPARENT, true, true, true, true);
    } catch (trimError) {}

    var w = Math.max(1, Math.round(asPixels(tempDoc.width) || 1));
    var h = Math.max(1, Math.round(asPixels(tempDoc.height) || 1));
    if (MAX_SIZE > 0) {
        var longest = Math.max(w, h);
        if (longest > MAX_SIZE) {
            var scale = MAX_SIZE / longest;
            var tw = Math.max(1, Math.round(w * scale));
            var th = Math.max(1, Math.round(h * scale));
            tempDoc.resizeImage(
                UnitValue(tw, 'px'),
                UnitValue(th, 'px'),
                undefined,
                ResampleMethod.BICUBICSHARPER
            );
            w = tw;
            h = th;
        }
    }

    var target = new File('${escapedPath}');
    if (!target.parent.exists) target.parent.create();
    var pngOptions = new PNGSaveOptions();
    pngOptions.compression = 6;
    pngOptions.interlaced = false;
    tempDoc.saveAs(target, pngOptions, true, Extension.LOWERCASE);

    __deResult({
        success: 1,
        path: target.fsName,
        width: w,
        height: h,
        contentLeft: contentLeft,
        contentTop: contentTop,
        contentRight: contentRight,
        contentBottom: contentBottom
    });
} catch (error) {
    __deResult({
        success: 0,
        error: String(error && error.message ? error.message : error)
    });
} finally {
    try {
        if (tempDoc && sourceDoc && tempDoc !== sourceDoc) {
            tempDoc.close(SaveOptions.DONOTSAVECHANGES);
        }
    } catch (cleanupError) {}
    try {
        if (sourceDoc) app.activeDocument = sourceDoc;
    } catch (activeRestoreError) {}
    try {
        app.displayDialogs = __dePrevDialogs;
    } catch (dialogsError) {}
}
__deOutput;
`;

    let jsxData: any;
    try {
        const result = await runJsxCode(jsx, 'Export Layer as Native PNG');
        jsxData = result.data;
        if (!jsxData?.success) {
            const message = jsxData?.error || result.message || 'Native PNG export failed (JSX)';
            throw new Error(message);
        }
    } catch (jsxError) {
        try { await tempFile.delete(); } catch { /* noop */ }
        throw jsxError;
    }

    let base64 = '';
    try {
        const arrayBuffer = await tempFile.read({ format: storage.formats.binary });
        const bytes = new Uint8Array(arrayBuffer as ArrayBuffer);
        base64 = uint8ArrayToBase64(bytes);
    } finally {
        try { await tempFile.delete(); } catch { /* noop */ }
    }

    if (!base64) {
        throw new Error('Native PNG export produced empty file');
    }

    const width = Number(jsxData.width) || 0;
    const height = Number(jsxData.height) || 0;
    const contentLeft = Number(jsxData.contentLeft) || 0;
    const contentTop = Number(jsxData.contentTop) || 0;
    const contentRight = Number(jsxData.contentRight) || 0;
    const contentBottom = Number(jsxData.contentBottom) || 0;

    return {
        base64,
        width,
        height,
        contentBounds: {
            left: contentLeft,
            top: contentTop,
            right: contentRight,
            bottom: contentBottom,
            width: Math.max(0, contentRight - contentLeft),
            height: Math.max(0, contentBottom - contentTop)
        }
    };
}

function findLayerById(container: any, id: number): any {
    const numericId = typeof id === 'string' ? parseInt(id, 10) : id;

    for (const layer of container.layers) {
        if (layer.id === numericId) {
            return layer;
        }
        if (layer.layers) {
            const found = findLayerById(layer, numericId);
            if (found) return found;
        }
    }
    return null;
}

interface PixelsRGBAExportResult {
    rawPixels: Uint8Array;
    width: number;
    height: number;
    components: number;
    componentSize: number;
}

/**
 * pixels-rgba 模式：用 imaging.getPixels({ documentID, layerID }) 直接抓单图层 RGBA。
 *
 * 关键：传入 `layerID` 让 PS 内部只 composite 这一个图层，**完全不需要修改 visibility，
 * 不需要 duplicate 文档，不创建临时文档**。整个调用对原文档零破坏、零视觉影响，
 * 实现真正的"零闪烁、无感"体验。
 *
 * 同模式生产实战参考：remove-background.ts / apply-displacement.ts / get-subject-bounds.ts
 *
 * 输出 RGBA 通道（components=4），由调用方负责把 raw 字节通过二进制 ws 帧发给 Agent，
 * Agent 端用 sharp.raw({ width, height, channels: 4 }).png() 编码无损 PNG。
 */
async function exportUsingPixelsRGBA(
    docId: number,
    layerId: number,
    layer: any,
    maxSize: number
): Promise<PixelsRGBAExportResult> {
    let outResult: PixelsRGBAExportResult | null = null;

    const kind = String(layer?.kind || '').toLowerCase();
    const isBackground = !!layer?.isBackgroundLayer || kind === 'background';
    const layerName = String(layer?.name || '');
    console.log(
        `[pixels-rgba] Begin capture: id=${layerId}, name=${layerName}, kind=${kind}, ` +
        `isBackground=${isBackground}, maxSize=${maxSize}`
    );

    await core.executeAsModal(async () => {
        const bounds = layer.boundsNoEffects || layer.bounds;
        const layerW = Math.max(1, Math.round(bounds.right - bounds.left));
        const layerH = Math.max(1, Math.round(bounds.bottom - bounds.top));
        console.log(`[pixels-rgba] Layer bounds: ${layerW}x${layerH}`);

        // 只传一个维度，让 PS 自动按比例缩放保持纵横比（同 remove-background 的策略）
        let targetSize: Record<string, number>;
        if (maxSize > 0 && Math.max(layerW, layerH) > maxSize) {
            targetSize = layerW >= layerH
                ? { width: maxSize }
                : { height: maxSize };
        } else {
            targetSize = layerW >= layerH
                ? { width: layerW }
                : { height: layerH };
        }

        // 关键调用：传入 layerID 让 PS 只渲染目标图层的 composite，自带 alpha
        let pixelResult: any;
        try {
            pixelResult = await imaging.getPixels({
                documentID: docId,
                layerID: layerId,
                targetSize: targetSize as any
            });
        } catch (getPixelsError: any) {
            throw new Error(
                `imaging.getPixels({ layerID=${layerId} }) failed: ${getPixelsError?.message || getPixelsError}`
            );
        }

        if (!pixelResult?.imageData) {
            throw new Error('imaging.getPixels returned empty imageData');
        }

        const imgData = pixelResult.imageData;
        const width = imgData.width;
        const height = imgData.height;
        const components = imgData.components;
        const componentSize = imgData.componentSize || 8;

        if (componentSize !== 8) {
            imgData.dispose();
            throw new Error(`Unsupported componentSize=${componentSize}, only 8-bit per channel is supported in pixels-rgba mode`);
        }

        const sourceData = await imgData.getData();
        const sourceBytes = sourceData instanceof Uint8Array
            ? sourceData
            : new Uint8Array(sourceData as ArrayBuffer);

        const totalPixels = width * height;

        // 统一输出 RGBA（4 通道）：如果 PS 返回 RGB（3 通道），补全 alpha=255
        let rawPixels: Uint8Array;
        if (components === 4) {
            rawPixels = new Uint8Array(totalPixels * 4);
            rawPixels.set(sourceBytes.subarray(0, totalPixels * 4));
        } else if (components === 3) {
            rawPixels = new Uint8Array(totalPixels * 4);
            for (let i = 0; i < totalPixels; i++) {
                rawPixels[i * 4]     = sourceBytes[i * 3];
                rawPixels[i * 4 + 1] = sourceBytes[i * 3 + 1];
                rawPixels[i * 4 + 2] = sourceBytes[i * 3 + 2];
                rawPixels[i * 4 + 3] = 255;
            }
        } else {
            imgData.dispose();
            throw new Error(`Unsupported components=${components}, expect 3 (RGB) or 4 (RGBA)`);
        }

        imgData.dispose();

        outResult = {
            rawPixels,
            width,
            height,
            components: 4,
            componentSize
        };
    }, { commandName: 'DesignEcho: 抓取图层 RGBA 像素（零文档操作）' });

    if (!outResult) {
        throw new Error('exportUsingPixelsRGBA produced no result');
    }
    return outResult;
}

export class ExportLayerAsBase64Tool {
    name = 'exportLayerAsBase64';

    schema = {
        name: 'exportLayerAsBase64',
        description: '导出图层为 Base64 / Raw 像素（支持 imaging / native-png / pixels-rgba 三种模式）',
        parameters: {
            type: 'object' as const,
            properties: {
                layerId: { type: 'number', description: '图层 ID' },
                mode: {
                    type: 'string',
                    description: '导出模式：imaging=UXP JPEG（快）；native-png=PS 原生 saveAs PNG（无损）；pixels-rgba=零文档操作抓 raw RGBA（无感最优）',
                    enum: ['imaging', 'native-png', 'pixels-rgba']
                },
                format: {
                    type: 'string',
                    description: '图像格式（仅 imaging 模式下生效；当前实际统一编码为 JPEG）',
                    enum: ['png', 'jpeg']
                },
                quality: { type: 'number', description: 'JPEG 质量 (0-100)，保留参数' },
                maxSize: { type: 'number', description: '最大尺寸（像素），超出会等比缩放' }
            },
            required: ['layerId']
        }
    };

    async execute(params: ExportLayerParams): Promise<ToolResult<ExportLayerResult>> {
        return exportLayerAsBase64(params);
    }
}

// Preserve unused import warning suppression — `action` is retained for potential future JSX-less paths.
void action;
