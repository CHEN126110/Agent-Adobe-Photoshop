/**
 * 逐屏截图工具（Phase 3）
 *
 * 对详情页每个屏组按 bounds 截图。读取全程绑定 document.id +
 * activeHistoryState.id，不切换图层显隐，避免“只读”观察自身制造新历史版本。
 *
 * 返回每屏独立的 base64 截图，供 Agent/Vision 模型理解屏内容。
 */

import { Tool, ToolSchema } from '../types';
import { observeActiveDocumentAtHistoryState } from '../../core/photoshop-document-observation';
import type { PhotoshopHistoryStateRef } from '../../core/photoshop-history-state-ref';

const { imaging } = require('photoshop');

const OVERLAY_SNAPSHOT_TOOL_VERSION = 'screen-overlay-v2-diagnostic';

/** 深度按 id 找图层（含组内嵌套）；找不到返回 null。 */
function findLayerByIdDeep(container: any, id: number): any | null {
    const layers = container?.layers;
    if (!layers) return null;
    for (const layer of layers) {
        if (Number(layer?.id) === id) return layer;
        const found = findLayerByIdDeep(layer, id);
        if (found) return found;
    }
    return null;
}

interface ScreenInfo {
    id: number;
    name: string;
    index: number;
    bounds: { left: number; top: number; right: number; bottom: number; width: number; height: number };
}

interface ScreenSnapshot {
    screenId: number;
    screenName: string;
    screenIndex: number;
    documentId: number;
    historyStateId: number;
    base64: string;
    width: number;
    height: number;
}

interface ScreenSnapshotError {
    screenId?: number;
    screenName?: string;
    screenIndex?: number;
    stage?: string;
    error: string;
}

interface OverlaySnapshotDebug {
    version: string;
    documentId?: number;
    screenCount: number;
    targetScreenCount: number;
    placementCount: number;
    topLayerCount: number;
    hasDocumentCanvas: boolean;
    hasOffscreenCanvas: boolean;
    hasImageData: boolean;
    snapshotCount?: number;
    errorCount?: number;
    screenStages: Array<{
        screenId?: number;
        screenName?: string;
        screenIndex?: number;
        stage: string;
        width?: number;
        height?: number;
        placementCount?: number;
        renderMode?: 'pixel-rgb-imaging-encoder';
        error?: string;
    }>;
}

interface RectLike {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

interface PlacementOverlay {
    screenId?: number;
    placeholderLayerId?: number;
    placeholderLayerName?: string;
    actualLayerId?: number;
    actualLayerName?: string;
    targetBounds?: RectLike;
    actualBounds?: RectLike;
}

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    try {
        return JSON.stringify(error);
    } catch {
        return 'Unknown error';
    }
}

function normalizeTypedPixelData(
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
        return Math.max(0, Math.min(255, Math.round((source[index] / 32768) * 255)));
    }
    if (componentSize === 32) {
        const source = data as Float32Array;
        return Math.max(0, Math.min(255, Math.round(source[index] * 255)));
    }
    return (data as Uint8Array)[index] || 0;
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
        output[dst] = sampleTo8Bit(data, src, componentSize);
        output[dst + 1] = components > 1 ? sampleTo8Bit(data, src + 1, componentSize) : output[dst];
        output[dst + 2] = components > 2 ? sampleTo8Bit(data, src + 2, componentSize) : output[dst];
        output[dst + 3] = components > 3 ? sampleTo8Bit(data, src + 3, componentSize) : 255;
    }
    return output;
}

function rgbaToRgb8(rgba: Uint8ClampedArray): Uint8Array {
    const rgb = new Uint8Array((rgba.length / 4) * 3);
    for (let i = 0; i < rgba.length / 4; i++) {
        const src = i * 4;
        const dst = i * 3;
        const alpha = (rgba[src + 3] || 255) / 255;
        rgb[dst] = Math.round((rgba[src] || 0) * alpha + 255 * (1 - alpha));
        rgb[dst + 1] = Math.round((rgba[src + 1] || 0) * alpha + 255 * (1 - alpha));
        rgb[dst + 2] = Math.round((rgba[src + 2] || 0) * alpha + 255 * (1 - alpha));
    }
    return rgb;
}

function setRgbPixel(rgb: Uint8Array, width: number, height: number, x: number, y: number, color: [number, number, number]): void {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = (y * width + x) * 3;
    rgb[index] = color[0];
    rgb[index + 1] = color[1];
    rgb[index + 2] = color[2];
}

function blendRgbPixel(rgb: Uint8Array, width: number, height: number, x: number, y: number, color: [number, number, number], alpha: number): void {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = (y * width + x) * 3;
    rgb[index] = Math.round(rgb[index] * (1 - alpha) + color[0] * alpha);
    rgb[index + 1] = Math.round(rgb[index + 1] * (1 - alpha) + color[1] * alpha);
    rgb[index + 2] = Math.round(rgb[index + 2] * (1 - alpha) + color[2] * alpha);
}

function drawOverlayRectOnRgb(
    rgb: Uint8Array,
    rect: RectLike | undefined,
    screenBounds: RectLike,
    targetWidth: number,
    targetHeight: number,
    strokeColor: [number, number, number],
    fillColor: [number, number, number],
    fillAlpha = 0.12
): void {
    if (!rect) return;
    const screenWidth = Math.max(1, screenBounds.right - screenBounds.left);
    const screenHeight = Math.max(1, screenBounds.bottom - screenBounds.top);
    const scaleX = targetWidth / screenWidth;
    const scaleY = targetHeight / screenHeight;
    const left = Math.max(0, Math.min(targetWidth - 1, Math.round((rect.left - screenBounds.left) * scaleX)));
    const top = Math.max(0, Math.min(targetHeight - 1, Math.round((rect.top - screenBounds.top) * scaleY)));
    const right = Math.max(left, Math.min(targetWidth - 1, Math.round((rect.right - screenBounds.left) * scaleX)));
    const bottom = Math.max(top, Math.min(targetHeight - 1, Math.round((rect.bottom - screenBounds.top) * scaleY)));
    const strokeWidth = 2;

    for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) {
            blendRgbPixel(rgb, targetWidth, targetHeight, x, y, fillColor, fillAlpha);
        }
    }

    for (let offset = 0; offset < strokeWidth; offset++) {
        for (let x = left; x <= right; x++) {
            setRgbPixel(rgb, targetWidth, targetHeight, x, top + offset, strokeColor);
            setRgbPixel(rgb, targetWidth, targetHeight, x, bottom - offset, strokeColor);
        }
        for (let y = top; y <= bottom; y++) {
            setRgbPixel(rgb, targetWidth, targetHeight, left + offset, y, strokeColor);
            setRgbPixel(rgb, targetWidth, targetHeight, right - offset, y, strokeColor);
        }
    }
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

async function encodeRgbToBase64(rgb: Uint8Array, width: number, height: number): Promise<string> {
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
        if (typeof encoded === 'string') return encoded;
        if (Array.isArray(encoded)) return uint8ArrayToBase64(new Uint8Array(encoded));
        if (encoded && typeof encoded === 'object' && typeof (encoded as any).base64 === 'string') {
            return (encoded as any).base64;
        }
        throw new Error('imaging.encodeImageData returned no base64 payload');
    } finally {
        imageDataObj.dispose();
    }
}

export class GetScreenSnapshotsTool implements Tool {
    name = 'getScreenSnapshots';

    schema: ToolSchema = {
        name: 'getScreenSnapshots',
        description: '按详情页每个屏的实际 bounds 截取当前合成画面，返回绑定 Photoshop 文档历史版本的独立 base64 图片；读取过程不会改动图层显隐。需要先调用 parseDetailPageTemplate 获取 screens 列表。',
        parameters: {
            type: 'object',
            properties: {
                screens: {
                    type: 'array',
                    description: '来自 parseDetailPageTemplate 返回的 screens 数组',
                    items: { type: 'object' }
                },
                maxWidth: {
                    type: 'number',
                    description: '每屏截图最大宽度（px），默认 800'
                },
                screenIndices: {
                    type: 'array',
                    description: '可选，仅截取指定索引的屏（数组），不传则截取所有屏',
                    items: { type: 'number' }
                }
            },
            required: ['screens']
        }
    };

    async execute(params: {
        screens: ScreenInfo[];
        maxWidth?: number;
        screenIndices?: number[];
    }): Promise<{
        success: boolean;
        snapshots?: ScreenSnapshot[];
        errors?: ScreenSnapshotError[];
        documentId?: number;
        historyStateId?: number;
        historyStateRef?: PhotoshopHistoryStateRef;
        error?: string;
    }> {
        const screens = params.screens || [];
        if (screens.length === 0) {
            return { success: false, error: '未提供屏信息，请先调用 parseDetailPageTemplate' };
        }

        const maxWidth = params.maxWidth || 800;
        const targetScreens = params.screenIndices
            ? screens.filter(s => params.screenIndices!.includes(s.index))
            : screens;
        if (targetScreens.length === 0) {
            return { success: false, error: '没有匹配到需要截图的屏' };
        }

        try {
            const observation = await observeActiveDocumentAtHistoryState({
                commandName: 'DesignEcho: 逐屏截图',
                timeOut: 12,
                unavailableMessage: '无法读取 Photoshop 文档历史版本，未返回可能过期的屏级截图。',
                changedMessage: '逐屏截图期间 Photoshop 文档发生变化，已丢弃这组版本不一致的截图。'
            }, async (doc, historyStateRef) => {
                const snapshots: ScreenSnapshot[] = [];
                const errors: ScreenSnapshotError[] = [];
                for (const screen of targetScreens) {
                    try {
                        // 计算截图尺寸。模型常只传 {id,name,index}（真机 4/4 次因 bounds 缺失崩在 .width）：
                        // 没有 bounds 就按图层 id 现读；读不到再报清楚缺什么，不能整批崩掉。
                        let b = screen?.bounds;
                        if (!b || !Number.isFinite(Number(b.left)) || !Number.isFinite(Number(b.top))) {
                            const layer = Number.isFinite(Number(screen?.id)) ? findLayerByIdDeep(doc, Number(screen.id)) : null;
                            const lb = layer?.bounds;
                            if (lb && Number.isFinite(Number(lb.left))) {
                                b = { left: lb.left, top: lb.top, right: lb.right, bottom: lb.bottom, width: lb.right - lb.left, height: lb.bottom - lb.top };
                            } else {
                                throw new Error(`屏「${screen?.name || screen?.index}」缺少 bounds，且按 id=${screen?.id} 也找不到对应图层组；请传 parseDetailPageTemplate 返回的完整 screens，或先 getLayerHierarchy(includeBounds:true) 取到 bounds`);
                            }
                        }
                        const srcWidth = Math.max(1, b.width || (b.right - b.left));
                        const srcHeight = Math.max(1, b.height || (b.bottom - b.top));
                        const scale = Math.min(maxWidth / srcWidth, 1);
                        const targetWidth = Math.round(srcWidth * scale);
                        const targetHeight = Math.round(srcHeight * scale);

                        // 截取该屏区域
                        const pixelData = await imaging.getPixels({
                            documentID: doc.id,
                            sourceBounds: {
                                left: b.left,
                                top: b.top,
                                right: b.right,
                                bottom: b.bottom
                            },
                            targetSize: { width: targetWidth, height: targetHeight },
                            applyAlpha: true
                        });

                        let base64 = '';
                        try {
                            const encodedData = await imaging.encodeImageData({
                                imageData: pixelData.imageData,
                                base64: true
                            });
                            if (typeof encodedData === 'string') {
                                base64 = encodedData;
                            } else if (encodedData && typeof encodedData === 'object') {
                                base64 = (encodedData as any).base64 || '';
                            }
                        } finally {
                            pixelData.imageData.dispose();
                        }
                        if (!base64) {
                            throw new Error('imaging.encodeImageData returned no base64 payload');
                        }

                        snapshots.push({
                            screenId: screen.id,
                            screenName: screen.name,
                            screenIndex: screen.index,
                            documentId: historyStateRef.documentId,
                            historyStateId: historyStateRef.historyStateId,
                            base64,
                            width: targetWidth,
                            height: targetHeight
                        });
                    } catch (err: any) {
                        errors.push({
                            screenId: screen.id,
                            screenName: screen.name,
                            screenIndex: screen.index,
                            error: errorMessage(err)
                        });
                        console.error(`[ScreenSnapshot] 屏 ${screen.name} 截图失败:`, err);
                        // Continue to next screen
                    }
                }
                return { snapshots, errors };
            });
            return {
                success: observation.value.snapshots.length > 0,
                snapshots: observation.value.snapshots,
                errors: observation.value.errors.length > 0 ? observation.value.errors : undefined,
                documentId: observation.historyStateRef.documentId,
                historyStateId: observation.historyStateRef.historyStateId,
                historyStateRef: observation.historyStateRef,
                error: observation.value.snapshots.length === 0
                    ? `逐屏截图失败：${observation.value.errors.map(item => item.error).join('; ') || '未生成截图'}`
                    : undefined
            };
        } catch (error) {
            return {
                success: false,
                error: errorMessage(error)
            };
        }
    }
}

export class GetScreenSnapshotsWithOverlayTool implements Tool {
    name = 'getScreenSnapshotsWithOverlay';

    schema: ToolSchema = {
        name: 'getScreenSnapshotsWithOverlay',
        description: 'Capture detail-page screens with target and actual image placement bounds overlaid for debugging.',
        parameters: {
            type: 'object',
            properties: {
                screens: {
                    type: 'array',
                    description: 'Screens returned from parseDetailPageTemplate.',
                    items: { type: 'object' }
                },
                placements: {
                    type: 'array',
                    description: 'Placement records returned from fillDetailPage.',
                    items: { type: 'object' }
                },
                maxWidth: {
                    type: 'number',
                    description: 'Maximum width per snapshot.'
                },
                screenIndices: {
                    type: 'array',
                    description: 'Optional screen indices to capture.',
                    items: { type: 'number' }
                }
            },
            required: ['screens']
        }
    };

    async execute(params: {
        screens: ScreenInfo[];
        placements?: PlacementOverlay[];
        maxWidth?: number;
        screenIndices?: number[];
    }): Promise<{
        success: boolean;
        snapshots?: ScreenSnapshot[];
        errors?: ScreenSnapshotError[];
        debug?: OverlaySnapshotDebug;
        documentId?: number;
        historyStateId?: number;
        historyStateRef?: PhotoshopHistoryStateRef;
        error?: string;
    }> {
        const screens = params.screens || [];
        if (screens.length === 0) {
            return { success: false, error: 'Missing screens from parseDetailPageTemplate' };
        }

        const placements = Array.isArray(params.placements) ? params.placements : [];
        const maxWidth = params.maxWidth || 1200;
        const targetScreens = params.screenIndices
            ? screens.filter((screen) => params.screenIndices!.includes(screen.index))
            : screens;
        if (targetScreens.length === 0) {
            return { success: false, error: 'No matching screens to capture' };
        }

        try {
            const observation = await observeActiveDocumentAtHistoryState({
                commandName: 'DesignEcho: Screen snapshots with overlay',
                timeOut: 15,
                unavailableMessage: 'Unable to read the Photoshop history state for screen snapshots.',
                changedMessage: 'The Photoshop document changed while capturing screen snapshots; discarded stale images.'
            }, async (doc, historyStateRef) => {
                const snapshots: ScreenSnapshot[] = [];
                const errors: ScreenSnapshotError[] = [];
                const debug: OverlaySnapshotDebug = {
                    version: OVERLAY_SNAPSHOT_TOOL_VERSION,
                    documentId: doc.id,
                    screenCount: screens.length,
                    targetScreenCount: targetScreens.length,
                    placementCount: placements.length,
                    topLayerCount: Array.from(doc.layers || []).length,
                    hasDocumentCanvas: typeof document !== 'undefined' && typeof document.createElement === 'function',
                    hasOffscreenCanvas: typeof (globalThis as any).OffscreenCanvas === 'function',
                    hasImageData: typeof ImageData !== 'undefined',
                    screenStages: []
                };
                for (const screen of targetScreens) {
                    let stage = 'start';
                    const stageRecord: OverlaySnapshotDebug['screenStages'][number] & {
                        canvasMode?: 'dom-canvas' | 'offscreen-canvas';
                    } = {
                        screenId: screen.id,
                        screenName: screen.name,
                        screenIndex: screen.index,
                        stage,
                        width: undefined as number | undefined,
                        height: undefined as number | undefined,
                        placementCount: undefined as number | undefined,
                        canvasMode: undefined as 'dom-canvas' | 'offscreen-canvas' | undefined,
                        renderMode: undefined,
                        error: undefined as string | undefined
                    };
                    debug.screenStages.push(stageRecord);
                    try {
                        stage = 'compute-bounds';
                        stageRecord.stage = stage;
                        const b = screen.bounds;
                        const srcWidth = Math.max(1, b.width || (b.right - b.left));
                        const srcHeight = Math.max(1, b.height || (b.bottom - b.top));
                        const scale = Math.min(maxWidth / srcWidth, 1);
                        const targetWidth = Math.round(srcWidth * scale);
                        const targetHeight = Math.round(srcHeight * scale);
                        stageRecord.width = targetWidth;
                        stageRecord.height = targetHeight;

                        stage = 'get-pixels';
                        stageRecord.stage = stage;
                        const pixelData = await imaging.getPixels({
                            documentID: doc.id,
                            sourceBounds: {
                                left: b.left,
                                top: b.top,
                                right: b.right,
                                bottom: b.bottom
                            },
                            targetSize: { width: targetWidth, height: targetHeight },
                            applyAlpha: true,
                            componentCount: 4
                        });

                        try {
                            stage = 'read-pixels';
                            stageRecord.stage = stage;
                            const outputWidth = pixelData.imageData.width || targetWidth;
                            const outputHeight = pixelData.imageData.height || targetHeight;
                            stageRecord.width = outputWidth;
                            stageRecord.height = outputHeight;
                            const rawData = await pixelData.imageData.getData() as Uint8Array | Uint16Array | Float32Array;
                            const typedData = normalizeTypedPixelData(rawData, pixelData.imageData.componentSize || 8);
                            const rgbaBytes = normalizePixelsToRgba8(
                                typedData,
                                outputWidth * outputHeight,
                                pixelData.imageData.components || 4,
                                pixelData.imageData.componentSize || 8
                            );

                            stage = 'compose-rgb';
                            stageRecord.stage = stage;
                            stageRecord.renderMode = 'pixel-rgb-imaging-encoder';
                            const rgbBytes = rgbaToRgb8(rgbaBytes);

                            stage = 'draw-overlays';
                            stageRecord.stage = stage;
                            const screenPlacements = placements.filter((item) => Number(item.screenId) === Number(screen.id));
                            stageRecord.placementCount = screenPlacements.length;
                            screenPlacements.forEach((placement) => {
                                drawOverlayRectOnRgb(
                                    rgbBytes,
                                    placement.targetBounds,
                                    b,
                                    outputWidth,
                                    outputHeight,
                                    [47, 123, 255],
                                    [47, 123, 255],
                                    0.12
                                );
                                drawOverlayRectOnRgb(
                                    rgbBytes,
                                    placement.actualBounds,
                                    b,
                                    outputWidth,
                                    outputHeight,
                                    [255, 138, 0],
                                    [255, 138, 0],
                                    0.12
                                );
                            });

                            stage = 'encode-overlay';
                            stageRecord.stage = stage;
                            const base64 = await encodeRgbToBase64(rgbBytes, outputWidth, outputHeight);

                            snapshots.push({
                                screenId: screen.id,
                                screenName: screen.name,
                                screenIndex: screen.index,
                                documentId: historyStateRef.documentId,
                                historyStateId: historyStateRef.historyStateId,
                                base64,
                                width: outputWidth,
                                height: outputHeight
                            });
                            stage = 'done';
                            stageRecord.stage = stage;
                        } finally {
                            try {
                                pixelData.imageData.dispose();
                            } catch (disposeError) {
                                console.warn('[ScreenSnapshotOverlay] Failed to dispose image data:', disposeError);
                            }
                        }
                    } catch (error: any) {
                        const message = errorMessage(error);
                        stageRecord.stage = stage;
                        stageRecord.error = message;
                        errors.push({
                            screenId: screen.id,
                            screenName: screen.name,
                            screenIndex: screen.index,
                            stage,
                            error: `[${stage}] ${message}`
                        });
                        console.error(`[ScreenSnapshotOverlay] Failed on ${screen.name}:`, error);
                    }
                }
                debug.snapshotCount = snapshots.length;
                debug.errorCount = errors.length;
                return { snapshots, errors, debug };
            });
            return {
                success: observation.value.snapshots.length > 0,
                snapshots: observation.value.snapshots,
                errors: observation.value.errors.length > 0 ? observation.value.errors : undefined,
                debug: observation.value.debug,
                documentId: observation.historyStateRef.documentId,
                historyStateId: observation.historyStateRef.historyStateId,
                historyStateRef: observation.historyStateRef,
                error: observation.value.snapshots.length === 0
                    ? `Screen snapshots with overlay failed: ${observation.value.errors.map(item => item.error).join('; ') || 'no snapshots were generated'}`
                    : undefined
            };
        } catch (error) {
            return {
                success: false,
                error: errorMessage(error)
            };
        }
    }
}
