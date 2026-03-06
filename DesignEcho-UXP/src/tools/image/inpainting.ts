/**
 * 局部重绘工具 (Inpainting Tools)
 * 
 * 包含：
 * 1. GetSelectionMaskTool - 获取当前选区作为蒙版
 * 2. ApplyInpaintingResultTool - 应用重绘结果到图层
 */

import { Tool, ToolSchema } from '../types';

const { app, imaging, action, core } = require('photoshop');
const { batchPlay } = action;

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
                maxSize: {
                    type: 'number',
                    description: '最大尺寸（默认 1024）'
                }
            }
        }
    };

    async execute(params: { includeImage?: boolean; maxSize?: number }): Promise<any> {
        const includeImage = params.includeImage !== false;
        const maxSize = params.maxSize || 1024;

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

            // 计算缩放比例
            const scale = Math.min(1, maxSize / Math.max(width, height));
            const targetWidth = Math.round(width * scale);
            const targetHeight = Math.round(height * scale);

            console.log(`[GetSelectionMask] 文档尺寸: ${width}x${height}, 目标尺寸: ${targetWidth}x${targetHeight}`);

            const selectionBounds = await this.getSelectionBounds();
            if (!selectionBounds) {
                return { success: false, error: '无法获取选区边界' };
            }

            const scaledSelectionBounds = {
                left: Math.round(selectionBounds.left * scale),
                top: Math.round(selectionBounds.top * scale),
                right: Math.round(selectionBounds.right * scale),
                bottom: Math.round(selectionBounds.bottom * scale)
            };

            let maskRawBase64 = '';
            let imageRawBase64 = '';

            // 使用 PS 原生 API 获取选区蒙版和文档图像（零历史副作用）
            await core.executeAsModal(async () => {
                // 1. 用 imaging.getSelection() 直接获取选区蒙版（灰度单通道）
                const selResult = await imaging.getSelection({
                    documentID: doc.id,
                    targetSize: { width: targetWidth, height: targetHeight }
                });
                const maskData = await selResult.imageData.getData();
                // 单通道灰度 raw base64
                maskRawBase64 = uint8ArrayToBase64(maskData);
                console.log(`[GetSelectionMask] 蒙版: ${selResult.imageData.width}x${selResult.imageData.height}, channels=${selResult.imageData.components}, bytes=${maskData.length}`);
                selResult.imageData.dispose();

                // 2. 获取文档复合图像（RGB/RGBA raw）
                if (includeImage) {
                    const imgResult = await imaging.getPixels({
                        documentID: doc.id,
                        targetSize: { width: targetWidth, height: targetHeight },
                        applyAlpha: true  // 返回 RGB（无 alpha），白底合成
                    });
                    const imgData = await imgResult.imageData.getData();
                    const components = imgResult.imageData.components;
                    console.log(`[GetSelectionMask] 图像: ${imgResult.imageData.width}x${imgResult.imageData.height}, channels=${components}, bytes=${imgData.length}`);

                    if (components === 4) {
                        // RGBA -> RGB（去 alpha）
                        const pixelCount = targetWidth * targetHeight;
                        const rgb = new Uint8Array(pixelCount * 3);
                        for (let i = 0; i < pixelCount; i++) {
                            rgb[i * 3] = imgData[i * 4];
                            rgb[i * 3 + 1] = imgData[i * 4 + 1];
                            rgb[i * 3 + 2] = imgData[i * 4 + 2];
                        }
                        imageRawBase64 = uint8ArrayToBase64(rgb);
                    } else {
                        // 已经是 RGB
                        imageRawBase64 = uint8ArrayToBase64(imgData);
                    }
                    imgResult.imageData.dispose();
                }
            }, { commandName: 'DesignEcho: 获取选区蒙版' });

            if (!maskRawBase64) {
                throw new Error('选区蒙版为空，请重新创建选区后重试');
            }

            const result: any = {
                success: true,
                mask: maskRawBase64,
                maskFormat: 'raw',
                maskChannels: 1,
                width: targetWidth,
                height: targetHeight,
                originalWidth: width,
                originalHeight: height,
                selectionBounds: scaledSelectionBounds,
                documentMeta: {
                    width,
                    height,
                    scale
                }
            };

            if (includeImage) {
                result.image = imageRawBase64;
                result.imageFormat = 'raw';
                result.imageChannels = 3;
            }

            console.log('[GetSelectionMask] 获取成功 (raw format)');
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
                {
                    _obj: 'get',
                    _target: [
                        { _property: 'selection' },
                        { _ref: 'document', _enum: 'ordinal', _value: 'targetEnum' }
                    ]
                }
            ], {});

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
            colorSpace: 'RGB'
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
 * 应用重绘结果
 */
export class ApplyInpaintingResultTool implements Tool {
    name = 'applyInpaintingResult';
    
    schema: ToolSchema = {
        name: 'applyInpaintingResult',
        description: '将局部重绘结果应用到新图层',
        parameters: {
            type: 'object',
            properties: {
                imageData: {
                    type: 'string',
                    description: 'Base64 编码的重绘结果图像'
                },
                layerName: {
                    type: 'string',
                    description: '新图层名称（默认"重绘结果"）'
                },
                width: {
                    type: 'number',
                    description: '图像实际宽度'
                },
                height: {
                    type: 'number',
                    description: '图像实际高度'
                },
                originalWidth: {
                    type: 'number',
                    description: '原始文档宽度（用于缩放）'
                },
                originalHeight: {
                    type: 'number',
                    description: '原始文档高度（用于缩放）'
                },
                targetBounds: {
                    type: 'object',
                    description: '写入目标位置（left/top）',
                    properties: {
                        left: { type: 'number', description: '目标左侧坐标' },
                        top: { type: 'number', description: '目标顶部坐标' }
                    }
                }
            },
            required: ['imageData']
        }
    };

    async execute(params: { imageData: string; isRawRgba?: boolean; layerName?: string; width?: number; height?: number; originalWidth?: number; originalHeight?: number; targetBounds?: { left?: number; top?: number } }): Promise<any> {
        const layerName = params.layerName || '重绘结果';
        let createdLayerId: number | null = null;

        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            // 解码 Base64 数据（清洗非法字符避免 atob InvalidCharacterError）
            const base64Data = sanitizeBase64(params.imageData.replace(/^data:image\/\w+;base64,/, ''));
            const binaryString = atob(base64Data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            const docWidth = doc.width as number;
            const docHeight = doc.height as number;
            
            // 使用提供的图像尺寸，如果没有则默认为文档尺寸
            const imgWidth = params.width || docWidth;
            const imgHeight = params.height || docHeight;
            
            const expectedSize = imgWidth * imgHeight * 4;
            const isRaw = params.isRawRgba === true;
            console.log(`[ApplyInpaintingResult] 图像尺寸: ${imgWidth}x${imgHeight}, 文档尺寸: ${docWidth}x${docHeight}, isRawRgba: ${isRaw}, bytes: ${bytes.length}, expected: ${expectedSize}`);

            // 硬校验：raw RGBA 数据长度必须精确匹配
            if (isRaw && bytes.length !== expectedSize) {
                return {
                    success: false,
                    error: `像素数据长度不匹配: 收到 ${bytes.length} 字节, 期望 ${expectedSize} 字节 (${imgWidth}x${imgHeight}x4)`
                };
            }

            await core.executeAsModal(async () => {
                // 创建新图层
                await batchPlay([
                    {
                        _obj: 'make',
                        _target: [{ _ref: 'layer' }],
                        using: { _obj: 'layer', name: layerName }
                    }
                ], {});

                // 获取新创建的图层
                const newLayer = doc.layers.find((l: any) => l.name === layerName);
                if (!newLayer) {
                    throw new Error('创建图层失败');
                }
                createdLayerId = newLayer.id;

                // 创建 ImageData 对象（RGBA，4通道）
                const imageDataObj = await imaging.createImageDataFromBuffer(bytes, {
                    width: imgWidth,
                    height: imgHeight,
                    components: 4,
                    colorSpace: 'RGB'
                });

                await imaging.putPixels({
                    documentID: doc.id,
                    layerID: newLayer.id,
                    imageData: imageDataObj,
                    targetBounds: {
                        left: Math.round(params.targetBounds?.left || 0),
                        top: Math.round(params.targetBounds?.top || 0)
                    }
                });
                
                const hasExplicitTargetBounds = params.targetBounds
                    && (typeof params.targetBounds.left === 'number' || typeof params.targetBounds.top === 'number');

                // 仅在“整图回写”场景执行缩放回原尺寸；ROI 精确回贴不应触发缩放
                if (!hasExplicitTargetBounds
                    && params.originalWidth
                    && params.originalHeight
                    && (Math.abs(imgWidth - params.originalWidth) > 1 || Math.abs(imgHeight - params.originalHeight) > 1)) {
                    
                    const scaleW = (params.originalWidth / imgWidth) * 100;
                    const scaleH = (params.originalHeight / imgHeight) * 100;
                    
                    console.log(`[ApplyInpaintingResult] 需要缩放: ${scaleW.toFixed(2)}%, ${scaleH.toFixed(2)}%`);
                    
                    await batchPlay([
                        {
                            _obj: "transform",
                            _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
                            freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
                            width: { _unit: "percent", _value: scaleW },
                            height: { _unit: "percent", _value: scaleH },
                            linked: false,
                            interfaceIconFrameDimmed: { _enum: "interpolationType", _value: "bicubic" }
                        }
                    ], {});
                }

            }, { commandName: 'DesignEcho: 应用重绘结果' });

            console.log(`[ApplyInpaintingResult] 成功创建图层: ${layerName}`);
            
            return {
                success: true,
                layerName: layerName,
                layerId: createdLayerId
            };

        } catch (error: any) {
            console.error('[ApplyInpaintingResult] 错误:', error.message);
            return { success: false, error: error.message };
        }
    }
}

/**
 * 获取当前选区的边界框
 * 用于选区模式抠图
 */
export class GetSelectionBoundsTool implements Tool {
    name = 'getSelectionBounds';
    
    schema: ToolSchema = {
        name: 'getSelectionBounds',
        description: '获取当前 Photoshop 选区的边界框坐标（用于选区模式抠图）',
        parameters: {
            type: 'object',
            properties: {}
        }
    };

    async execute(): Promise<any> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档', hasSelection: false };
            }

            // 获取选区边界
            const result = await batchPlay([
                {
                    _obj: 'get',
                    _target: [
                        { _property: 'selection' },
                        { _ref: 'document', _enum: 'ordinal', _value: 'targetEnum' }
                    ]
                }
            ], { synchronousExecution: true });
            
            if (!result[0] || !result[0].selection) {
                return { 
                    success: false, 
                    error: '请先创建选区（使用套索工具、矩形选框等）',
                    hasSelection: false 
                };
            }

            const selection = result[0].selection;
            
            // 解析选区边界
            // selection 可能是 rectangle 或其他形状
            let bounds: { left: number; top: number; right: number; bottom: number } | null = null;
            
            if (selection.left !== undefined && selection.top !== undefined) {
                // 直接的边界信息
                bounds = {
                    left: Math.round(selection.left._value || selection.left),
                    top: Math.round(selection.top._value || selection.top),
                    right: Math.round(selection.right._value || selection.right),
                    bottom: Math.round(selection.bottom._value || selection.bottom)
                };
            } else {
                // 尝试获取选区的边界框
                const boundsResult = await batchPlay([
                    {
                        _obj: 'get',
                        _target: [
                            { _property: 'selectionBounds' },
                            { _ref: 'document', _enum: 'ordinal', _value: 'targetEnum' }
                        ]
                    }
                ], { synchronousExecution: true });
                
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
                    error: '无法获取选区边界',
                    hasSelection: true 
                };
            }

            const width = bounds.right - bounds.left;
            const height = bounds.bottom - bounds.top;

            console.log(`[GetSelectionBounds] 选区边界: (${bounds.left}, ${bounds.top}) - (${bounds.right}, ${bounds.bottom}), 尺寸: ${width}x${height}`);

            return {
                success: true,
                hasSelection: true,
                bounds: bounds,
                box: [bounds.left, bounds.top, bounds.right, bounds.bottom],
                width: width,
                height: height,
                documentWidth: doc.width as number,
                documentHeight: doc.height as number
            };

        } catch (error: any) {
            console.error('[GetSelectionBounds] 错误:', error.message);
            return { success: false, error: error.message, hasSelection: false };
        }
    }
}