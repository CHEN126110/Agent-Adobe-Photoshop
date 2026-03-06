/**
 * 导出图层为 Base64 工具
 */

import { action, app, core, imaging } from 'photoshop';
import { ToolResult } from '../types';
const uxp = require('uxp');
const fs = uxp.storage.localFileSystem;

/**
 * 将 Uint8Array 转换为 Base64（分块处理避免栈溢出）
 */
function uint8ArrayToBase64(data: Uint8Array): string {
    const CHUNK_SIZE = 32768; // 32KB 分块
    let binary = '';
    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
        const chunk = data.subarray(i, Math.min(i + CHUNK_SIZE, data.length));
        binary += String.fromCharCode.apply(null, chunk as any);
    }
    return btoa(binary);
}

export interface ExportLayerParams {
    layerId: number;
    format?: 'png' | 'jpeg';
    quality?: number;  // JPEG 质量 0-100
    maxSize?: number;  // 最大尺寸（像素）
}

export interface ExportLayerResult {
    success: boolean;
    base64: string;
    width: number;
    height: number;
    format: string;
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
 * 导出图层为 Base64
 */
export async function exportLayerAsBase64(params: ExportLayerParams): Promise<ToolResult<ExportLayerResult>> {
    console.log('[ExportLayer] 开始导出图层...');
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
        
        // 查找图层
        const layer = findLayerById(doc, layerId);
        if (!layer) {
            return {
                success: false,
                error: `未找到图层 ID: ${layerId}`,
                data: null
            };
        }
        
        console.log(`[ExportLayer] 图层: ${layer.name} (ID: ${layerId})`);
        
        // 获取图层边界（优先使用不含效果的边界，避免阴影等干扰）
        const bounds = layer.boundsNoEffects || layer.bounds;
        const layerWidth = bounds.right - bounds.left;
        const layerHeight = bounds.bottom - bounds.top;
        
        console.log(`[ExportLayer] 图层尺寸: ${layerWidth}x${layerHeight} (boundsNoEffects: ${!!layer.boundsNoEffects})`);
        
        // 尝试使用 Imaging API（更可靠）
        let base64Data = '';
        let outputWidth = layerWidth;
        let outputHeight = layerHeight;
        
        try {
            base64Data = await exportUsingImagingAPI(doc.id, layer, format, quality, maxSize);
            
            // 计算实际输出尺寸
            if (layerWidth > maxSize || layerHeight > maxSize) {
                const scale = Math.min(maxSize / layerWidth, maxSize / layerHeight);
                outputWidth = Math.round(layerWidth * scale);
                outputHeight = Math.round(layerHeight * scale);
            }
        } catch (imagingError: any) {
            console.warn('[ExportLayer] Imaging API 失败，尝试 batchPlay 方式:', imagingError.message);
            
            // 回退到 batchPlay 导出
            base64Data = await exportUsingBatchPlay(doc, layer, format);
        }
        
        const processingTime = performance.now() - startTime;
        console.log(`[ExportLayer] ✅ 完成, ${Math.round(base64Data.length / 1024)}KB, 耗时 ${processingTime.toFixed(0)}ms`);
        
        return {
            success: true,
            data: {
                success: true,
                base64: base64Data,
                width: outputWidth,
                height: outputHeight,
                format,
                // ★ 返回图层边界信息，用于坐标转换
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
        
    } catch (error: any) {
        console.error('[ExportLayer] 失败:', error);
        return {
            success: false,
            error: error.message,
            data: null
        };
    }
}

/**
 * 使用 Imaging API 导出
 * 
 * 策略：临时隐藏其他图层，使用 documentID 获取合成像素（RGB，无 alpha），
 * 然后恢复图层可见性。这样既能只获取目标图层内容，又能避免 alpha 通道问题。
 */
async function exportUsingImagingAPI(
    docId: number, 
    layer: any, 
    format: string, 
    quality: number,
    maxSize: number
): Promise<string> {
    let result = '';
    
    await core.executeAsModal(async () => {
        const doc = app.activeDocument!;
        
        // 获取图层边界（优先使用不含效果的边界，避免阴影等干扰）
        const bounds = layer.boundsNoEffects || layer.bounds;
        const layerWidth = bounds.right - bounds.left;
        const layerHeight = bounds.bottom - bounds.top;
        
        console.log(`[ExportLayer] 目标图层 ID: ${layer.id}, 边界: (${bounds.left}, ${bounds.top}) - (${bounds.right}, ${bounds.bottom}) [boundsNoEffects: ${!!layer.boundsNoEffects}]`);
        
        // 计算缩放
        let targetWidth = layerWidth;
        let targetHeight = layerHeight;
        
        if (layerWidth > maxSize || layerHeight > maxSize) {
            const scale = Math.min(maxSize / layerWidth, maxSize / layerHeight);
            targetWidth = Math.round(layerWidth * scale);
            targetHeight = Math.round(layerHeight * scale);
        }
        
        // 记录其他图层的原始可见性状态
        const layerVisibility: Map<number, boolean> = new Map();
        
        // 递归收集所有图层
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
        
        // 隐藏所有其他图层，只保留目标图层可见
        // ★ 重要：这确保抠图模型只分析目标图层，不会受到形状参考图层的干扰
        const hiddenLayers: string[] = [];
        for (const l of allLayers) {
            layerVisibility.set(l.id, l.visible);
            if (l.id !== layer.id) {
                if (l.visible) {
                    hiddenLayers.push(l.name);
                }
                l.visible = false;
            } else {
                l.visible = true;  // 确保目标图层可见
            }
        }
        console.log(`[ExportLayer] ★ 单图层导出模式: 只导出 "${layer.name}"`);
        console.log(`[ExportLayer]   临时隐藏 ${hiddenLayers.length} 个图层: [${hiddenLayers.slice(0, 5).join(', ')}${hiddenLayers.length > 5 ? '...' : ''}]`);
        
        try {
            // ★★★ 关键改进：获取带 alpha 通道的像素数据 ★★★
            // applyAlpha: false 保留原始 RGBA 数据，便于后续分析透明区域
            console.log(`[ExportLayer] 使用 documentID: ${doc.id} 获取像素 (applyAlpha: false, 保留 alpha)`);
            
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
                applyAlpha: false  // ★ 保留 alpha 通道
            });
            
            // 获取原始像素数据（RGBA）用于分析
            const rawData = pixelData.imageData;
            const components = rawData.components;  // 通常是 4 (RGBA)
            console.log(`[ExportLayer] 像素组件数: ${components}, 尺寸: ${targetWidth}x${targetHeight}`);
            
            // ★★★ 提取 alpha 通道用于主体检测 ★★★
            let alphaChannelBase64 = '';
            if (components >= 4) {
                const totalPixels = targetWidth * targetHeight;
                const alphaData = new Uint8Array(totalPixels);
                const pixelBuffer = await rawData.getData();
                
                for (let i = 0; i < totalPixels; i++) {
                    alphaData[i] = pixelBuffer[i * components + 3];  // Alpha 是第 4 个分量
                }
                
                // 分块编码避免栈溢出
                const alphaBase64 = uint8ArrayToBase64(alphaData);
                alphaChannelBase64 = `ALPHA:${targetWidth}:${targetHeight}:${alphaBase64}`;
                console.log(`[ExportLayer] ★ 提取 alpha 通道: ${totalPixels} 像素`);
            }
            
            // 为了兼容性，仍然输出 JPEG 图像（用于可视化）
            // 先应用 alpha 到白色背景
            const rgbPixelData = await imaging.getPixels({
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
            
            console.log(`[ExportLayer] 编码为 JPEG (兼容)`);
            
            const encodedData = await imaging.encodeImageData({
                imageData: rgbPixelData.imageData,
                base64: true
            });
            
            // 清理像素数据
            pixelData.imageData.dispose();
            rgbPixelData.imageData.dispose();
            
            // ★ 在 base64 数据后附加 alpha 通道信息
            const imageBase64 = typeof encodedData === 'string' ? encodedData : (encodedData as any).base64 || '';
            result = alphaChannelBase64 ? `${imageBase64}|||${alphaChannelBase64}` : imageBase64;
            
            console.log(`[ExportLayer] 导出完成，数据长度: ${result.length}`);
            
        } finally {
            // 恢复所有图层的原始可见性
            console.log(`[ExportLayer] 恢复图层可见性...`);
            for (const l of allLayers) {
                const originalVisible = layerVisibility.get(l.id);
                if (originalVisible !== undefined) {
                    l.visible = originalVisible;
                }
            }
        }
    }, { commandName: '导出图层为Base64' });
    
    return result;
}

/**
 * 使用备用方法导出
 * 同样使用临时隐藏其他图层的策略
 */
async function exportUsingBatchPlay(_doc: any, layer: any, _format: string): Promise<string> {
    let result = '';
    
    await core.executeAsModal(async () => {
        const doc = app.activeDocument!;
        const bounds = layer.bounds;
        const layerWidth = bounds.right - bounds.left;
        const layerHeight = bounds.bottom - bounds.top;
        
        // 记录其他图层的原始可见性状态
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
        
        // 隐藏所有其他图层
        console.log(`[ExportLayer Fallback] 临时隐藏其他图层...`);
        for (const l of allLayers) {
            layerVisibility.set(l.id, l.visible);
            if (l.id !== layer.id) {
                l.visible = false;
            } else {
                l.visible = true;
            }
        }
        
        try {
            const targetWidth = Math.min(layerWidth, 2048);
            const targetHeight = Math.min(layerHeight, 2048);
            
            console.log(`[ExportLayer Fallback] 使用 documentID: ${doc.id} 获取像素 (applyAlpha: false)`);
            
            // 先获取带 alpha 的原始数据
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
                applyAlpha: false  // 保留 alpha 通道
            });
            
            // 提取 alpha 通道
            const rawData = pixelDataRaw.imageData;
            const components = rawData.components;
            console.log(`[ExportLayer Fallback] 像素组件数: ${components}`);
            
            let alphaChannelBase64 = '';
            if (components >= 4) {
                const totalPixels = targetWidth * targetHeight;
                const alphaData = new Uint8Array(totalPixels);
                const pixelBuffer = await rawData.getData();
                
                for (let i = 0; i < totalPixels; i++) {
                    alphaData[i] = pixelBuffer[i * components + 3];
                }
                
                const alphaBase64 = uint8ArrayToBase64(alphaData);
                alphaChannelBase64 = `ALPHA:${targetWidth}:${targetHeight}:${alphaBase64}`;
                console.log(`[ExportLayer Fallback] ★ 提取 alpha 通道: ${totalPixels} 像素`);
            }
            
            pixelDataRaw.imageData.dispose();
            
            // 再获取应用 alpha 后的数据用于 JPEG 编码
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
            result = alphaChannelBase64 ? `${imageBase64}|||${alphaChannelBase64}` : imageBase64;
            
        } finally {
            // 恢复所有图层的原始可见性
            console.log(`[ExportLayer Fallback] 恢复图层可见性...`);
            for (const l of allLayers) {
                const originalVisible = layerVisibility.get(l.id);
                if (originalVisible !== undefined) {
                    l.visible = originalVisible;
                }
            }
        }
    }, { commandName: '导出图层为Base64' });
    
    return result;
}

/**
 * 递归查找图层
 */
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

// 工具类
export class ExportLayerAsBase64Tool {
    name = 'exportLayerAsBase64';
    
    schema = {
        name: 'exportLayerAsBase64',
        description: '导出图层为 Base64 编码的图像',
        parameters: {
            type: 'object' as const,
            properties: {
                layerId: { type: 'number', description: '图层 ID' },
                format: { type: 'string', description: '图像格式', enum: ['png', 'jpeg'] },
                quality: { type: 'number', description: 'JPEG 质量 (0-100)' },
                maxSize: { type: 'number', description: '最大尺寸（像素）' }
            },
            required: ['layerId']
        }
    };
    
    async execute(params: ExportLayerParams): Promise<ToolResult<ExportLayerResult>> {
        return exportLayerAsBase64(params);
    }
}
