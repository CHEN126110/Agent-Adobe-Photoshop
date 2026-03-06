/**
 * 应用变形后的图像到 Photoshop 图层
 */

import { action, app, core } from 'photoshop';
import { ToolResult } from '../types';
const fs = require('uxp').storage.localFileSystem;

export interface ApplyMorphedImageParams {
    layerId: number;           // 目标图层 ID
    imageBase64: string;       // 变形后的图像 (Base64 PNG)
    mode?: 'replace' | 'newLayer';  // 替换模式
}

export interface ApplyMorphedImageResult {
    success: boolean;
    layerId: number;
    mode: string;
}

/**
 * 将变形后的图像应用到 Photoshop 图层
 */
export async function applyMorphedImage(params: ApplyMorphedImageParams): Promise<ToolResult<ApplyMorphedImageResult>> {
    console.log('[ApplyMorphedImage] 开始应用变形图像...');
    const startTime = performance.now();
    
    try {
        const { layerId, imageBase64, mode = 'replace' } = params;
        
        const doc = app.activeDocument;
        if (!doc) {
            return {
                success: false,
                error: '没有打开的文档',
                data: null
            };
        }
        
        // 查找目标图层
        const targetLayer = findLayerById(doc, layerId);
        if (!targetLayer) {
            return {
                success: false,
                error: `未找到图层 ID: ${layerId}`,
                data: null
            };
        }
        
        console.log(`[ApplyMorphedImage] 目标图层: ${targetLayer.name} (ID: ${layerId})`);
        
        // 获取原图层的位置和边界
        const originalBounds = targetLayer.bounds;
        const originalX = originalBounds.left;
        const originalY = originalBounds.top;
        
        console.log(`[ApplyMorphedImage] 原图层位置: (${originalX}, ${originalY})`);
        
        // 解码 Base64 图像并保存到临时文件
        const binaryString = atob(imageBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const imageData = bytes.buffer as ArrayBuffer;
        
        // 获取临时文件夹
        const tempFolder = await fs.getTemporaryFolder();
        const tempFileName = `morphed_${layerId}_${Date.now()}.png`;
        const tempFile = await tempFolder.createFile(tempFileName, { overwrite: true });
        
        // 写入图像数据
        await tempFile.write(imageData);
        const tempFilePath = tempFile.nativePath;
        
        console.log(`[ApplyMorphedImage] 临时文件: ${tempFilePath}`);
        
        await core.executeAsModal(async () => {
            // 选择目标图层
            await action.batchPlay([{
                _obj: 'select',
                _target: [{ _ref: 'layer', _id: layerId }],
                makeVisible: false,
                _options: { dialogOptions: 'dontDisplay' }
            }], { synchronousExecution: true });
            
            if (mode === 'replace') {
                // 方式1: 在原图层上方放置新图像，然后删除原图层
                
                // 创建文件 token
                const fileToken = await fs.createSessionToken(tempFile);
                
                // 放置图像作为新图层
                await action.batchPlay([{
                    _obj: 'placeEvent',
                    null: {
                        _path: fileToken,
                        _kind: 'local'
                    },
                    freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
                    offset: {
                        _obj: 'offset',
                        horizontal: { _unit: 'pixelsUnit', _value: 0 },
                        vertical: { _unit: 'pixelsUnit', _value: 0 }
                    },
                    _options: { dialogOptions: 'dontDisplay' }
                }], { synchronousExecution: true });
                
                // 获取新放置的图层（应该是当前选中的图层）
                const newLayer = doc.activeLayers[0];
                
                if (newLayer) {
                    // 将新图层移动到原图层位置
                    const newBounds = newLayer.bounds;
                    const offsetX = originalX - newBounds.left;
                    const offsetY = originalY - newBounds.top;
                    
                    if (Math.abs(offsetX) > 1 || Math.abs(offsetY) > 1) {
                        await action.batchPlay([{
                            _obj: 'move',
                            _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                            to: {
                                _obj: 'offset',
                                horizontal: { _unit: 'pixelsUnit', _value: offsetX },
                                vertical: { _unit: 'pixelsUnit', _value: offsetY }
                            },
                            _options: { dialogOptions: 'dontDisplay' }
                        }], { synchronousExecution: true });
                    }
                    
                    // 重命名新图层
                    newLayer.name = targetLayer.name;
                    
                    // 删除原图层
                    await action.batchPlay([{
                        _obj: 'delete',
                        _target: [{ _ref: 'layer', _id: layerId }],
                        _options: { dialogOptions: 'dontDisplay' }
                    }], { synchronousExecution: true });
                }
                
            } else {
                // 方式2: 创建新图层
                const fileToken = await fs.createSessionToken(tempFile);
                
                await action.batchPlay([{
                    _obj: 'placeEvent',
                    null: {
                        _path: fileToken,
                        _kind: 'local'
                    },
                    freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
                    _options: { dialogOptions: 'dontDisplay' }
                }], { synchronousExecution: true });
                
                const newLayer = doc.activeLayers[0];
                if (newLayer) {
                    newLayer.name = `${targetLayer.name}_变形`;
                }
            }
        }, { commandName: '应用变形图像' });
        
        // 清理临时文件
        try {
            await tempFile.delete();
        } catch (e) {
            console.warn('[ApplyMorphedImage] 清理临时文件失败:', e);
        }
        
        const processingTime = performance.now() - startTime;
        console.log(`[ApplyMorphedImage] ✅ 完成, 耗时 ${processingTime.toFixed(0)}ms`);
        
        return {
            success: true,
            data: {
                success: true,
                layerId,
                mode
            }
        };
        
    } catch (error: any) {
        console.error('[ApplyMorphedImage] 失败:', error);
        return {
            success: false,
            error: error.message,
            data: null
        };
    }
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

// 工具类定义
export class ApplyMorphedImageTool {
    name = 'applyMorphedImage';
    
    schema = {
        name: 'applyMorphedImage',
        description: '将变形后的图像应用到 Photoshop 图层',
        parameters: {
            type: 'object' as const,
            properties: {
                layerId: { type: 'number', description: '目标图层 ID' },
                imageBase64: { type: 'string', description: '变形后的图像 (Base64)' },
                mode: { type: 'string', description: '替换模式', enum: ['replace', 'newLayer'] }
            },
            required: ['layerId', 'imageBase64']
        }
    };
    
    async execute(params: ApplyMorphedImageParams): Promise<ToolResult<ApplyMorphedImageResult>> {
        return applyMorphedImage(params);
    }
}
