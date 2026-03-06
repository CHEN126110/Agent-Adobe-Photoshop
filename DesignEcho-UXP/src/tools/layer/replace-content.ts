/**
 * 替换图层内容工具
 * 
 * 将 base64 图像数据应用到指定图层
 */

import { app, action, core } from 'photoshop';
import { Tool, ToolResult } from '../types';

interface ReplaceLayerContentParams {
    layerId: number;
    imageBase64: string;
    bounds?: {
        left: number;
        top: number;
        width: number;
        height: number;
    };
}

/**
 * 替换图层内容
 * 将 base64 图像数据替换指定图层的内容
 */
export async function replaceLayerContent(params: ReplaceLayerContentParams): Promise<ToolResult> {
    const { layerId, imageBase64, bounds } = params;
    
    console.log('[replaceLayerContent] 开始替换图层内容');
    console.log(`  图层 ID: ${layerId}`);
    console.log(`  bounds: ${bounds ? `(${bounds.left}, ${bounds.top}) ${bounds.width}x${bounds.height}` : '无'}`);
    
    // 用于存储 executeAsModal 内部的结果
    let modalResult: ToolResult = { success: false, error: '未执行', data: null };
    
    try {
        // 使用 executeAsModal 包装所有会修改 Photoshop 状态的操作
        await core.executeAsModal(async () => {
            const doc = app.activeDocument;
            if (!doc) {
                modalResult = { success: false, error: '没有打开的文档', data: null };
                return;
            }
            
            // 查找目标图层
            const targetLayer = findLayerById(doc.layers, layerId);
            if (!targetLayer) {
                modalResult = { success: false, error: `未找到图层 ID: ${layerId}`, data: null };
                return;
            }
            
            console.log(`  目标图层: "${targetLayer.name}"`);
            
            // 解码 base64 图像
            let base64Data = imageBase64;
            if (base64Data.includes(',')) {
                base64Data = base64Data.split(',')[1];
            }
            
            // 将 base64 转为 ArrayBuffer
            const binaryString = atob(base64Data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            
            // 使用 batchPlay 放置图像
            await action.batchPlay([
                {
                    _obj: 'select',
                    _target: [{ _ref: 'layer', _id: layerId }],
                    makeVisible: true
                }
            ], { synchronousExecution: true });
        
        // 创建临时文件来存储图像数据
        // 由于 UXP 限制，我们使用剪贴板或直接操作像素
        
        // 方法：使用 imaging API 替换像素
        // 1. 创建新图层
        // 2. 将图像像素写入
        // 3. 合并到原图层
        
        // 首先获取图像尺寸（从 PNG 头部解析）
        const pngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        const isPNG = pngSignature.every((b, i) => bytes[i] === b);
        
        if (!isPNG) {
            modalResult = { success: false, error: '图像格式不是 PNG', data: null };
            return;
        }
        
        // 解析 PNG IHDR 获取尺寸
        const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
        const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
        
        console.log(`  图像尺寸: ${width}x${height}`);
        
        // 使用 imaging API 解码 PNG 并获取像素数据
        // 注意：UXP 的 imaging API 可能不直接支持 PNG 解码
        // 我们需要使用其他方法
        
        // 方法 2：通过临时文件和 placeEmbedded
        const uxpStorage = require('uxp').storage;
        const fs = uxpStorage.localFileSystem;
        const tempFolder = await fs.getTemporaryFolder();
        const tempFile = await tempFolder.createFile('temp_warp_result.png', { overwrite: true });
        
        await tempFile.write(bytes.buffer);
        
        console.log(`  临时文件已创建: ${tempFile.nativePath}`);
        
        // 创建 session token（UXP 要求通过 token 访问文件）
        const fileToken = await uxpStorage.localFileSystem.createSessionToken(tempFile);
        console.log(`  Session token 已创建`);
        
        // 获取原图层位置
        const targetBounds = bounds || {
            left: targetLayer.bounds?.left || 0,
            top: targetLayer.bounds?.top || 0,
            width: targetLayer.bounds?.right - targetLayer.bounds?.left || width,
            height: targetLayer.bounds?.bottom - targetLayer.bounds?.top || height
        };
        
        // 在原图层上方放置新图像
        // 使用 session token 而不是 nativePath
        await action.batchPlay([
            {
                _obj: 'placeEvent',
                null: {
                    _path: fileToken,
                    _kind: 'local'
                },
                linked: false  // 不链接，嵌入
            }
        ], { synchronousExecution: true });
        
        console.log('  图像已放置');
        
        // 获取新创建的图层
        const newLayer = doc.activeLayers[0];
        
        if (!newLayer) {
            console.warn('  ⚠ 未能获取新图层');
            modalResult = { success: false, error: '放置图像后未能获取新图层', data: null };
            return;
        }
        
        // 栅格化智能对象（如果是）
        try {
            await action.batchPlay([
                {
                    _obj: 'rasterizeLayer',
                    _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }]
                }
            ], { synchronousExecution: true });
            console.log('  图层已栅格化');
        } catch (e) {
            console.log('  图层无需栅格化');
        }
        
        // 获取新图层的当前边界
        const newLayerBounds = newLayer.bounds;
        const currentLeft = newLayerBounds?.left || 0;
        const currentTop = newLayerBounds?.top || 0;
        const currentWidth = (newLayerBounds?.right || 0) - currentLeft;
        const currentHeight = (newLayerBounds?.bottom || 0) - currentTop;
        
        console.log(`  新图层当前位置: (${currentLeft}, ${currentTop}) ${currentWidth}x${currentHeight}`);
        console.log(`  目标位置: (${targetBounds.left}, ${targetBounds.top}) ${targetBounds.width}x${targetBounds.height}`);
        
        // 计算需要移动的偏移量和缩放比例
        const scaleX = targetBounds.width / currentWidth;
        const scaleY = targetBounds.height / currentHeight;
        const offsetX = targetBounds.left - currentLeft;
        const offsetY = targetBounds.top - currentTop;
        
        // 使用 transform 命令定位和缩放
        if (Math.abs(scaleX - 1) > 0.01 || Math.abs(scaleY - 1) > 0.01 || Math.abs(offsetX) > 1 || Math.abs(offsetY) > 1) {
            await action.batchPlay([
                {
                    _obj: 'transform',
                    _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                    freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSCorner0' },  // 左上角锚点
                    offset: {
                        _obj: 'offset',
                        horizontal: { _unit: 'pixelsUnit', _value: offsetX },
                        vertical: { _unit: 'pixelsUnit', _value: offsetY }
                    },
                    width: { _unit: 'percentUnit', _value: scaleX * 100 },
                    height: { _unit: 'percentUnit', _value: scaleY * 100 },
                    interfaceIconFrameDimmed: { _enum: 'interpolationType', _value: 'bicubic' }
                }
            ], { synchronousExecution: true });
            console.log('  图层已变换到目标位置');
        }
        
        // 将新图层移动到原图层上方
        await action.batchPlay([
            {
                _obj: 'move',
                _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                to: { _ref: 'layer', _id: layerId },
                adjustment: false
            }
        ], { synchronousExecution: true });
        
        // 重命名新图层（添加后缀表示已变形）
        if (newLayer && newLayer.name) {
            const newName = targetLayer.name.includes('_warped') 
                ? targetLayer.name 
                : `${targetLayer.name}_warped`;
            newLayer.name = newName;
        }
        
        const newLayerId = (newLayer as any)?._id || (newLayer as any)?.id;
        
        // 隐藏原图层（不删除，方便对比）
        await action.batchPlay([
            {
                _obj: 'hide',
                null: [{ _ref: 'layer', _id: layerId }]
            }
        ], { synchronousExecution: true });
        
            // 清理临时文件
            try {
                await tempFile.delete();
            } catch (e) {
                console.warn('  临时文件删除失败（可忽略）');
            }
            
            console.log('  ✓ 图层内容替换完成');
            
            modalResult = {
                success: true,
                data: {
                    originalLayerId: layerId,
                    newLayerId: newLayerId,
                    width,
                    height
                }
            };
        }, { commandName: '替换图层内容' });
        
        return modalResult;
        
    } catch (error: any) {
        console.error('[replaceLayerContent] 错误:', error);
        return {
            success: false,
            error: error.message || String(error),
            data: null
        };
    }
}

/**
 * 递归查找图层
 */
function findLayerById(layers: any, id: number): any {
    for (const layer of layers) {
        if (layer._id === id || layer.id === id) {
            return layer;
        }
        if (layer.layers && layer.layers.length > 0) {
            const found = findLayerById(layer.layers, id);
            if (found) return found;
        }
    }
    return null;
}

/**
 * 替换图层内容工具类
 */
export class ReplaceLayerContentTool implements Tool {
    name = 'replaceLayerContent';
    description = '替换图层内容（将 base64 图像数据应用到指定图层）';
    
    schema = {
        name: this.name,
        description: this.description,
        parameters: {
            type: 'object' as const,
            properties: {
                layerId: {
                    type: 'number',
                    description: '要替换内容的图层 ID'
                },
                imageBase64: {
                    type: 'string',
                    description: '图像的 base64 数据'
                },
                bounds: {
                    type: 'object',
                    description: '可选的目标边界',
                    properties: {
                        left: { type: 'number', description: '左边界' },
                        top: { type: 'number', description: '上边界' },
                        width: { type: 'number', description: '宽度' },
                        height: { type: 'number', description: '高度' }
                    }
                }
            },
            required: ['layerId', 'imageBase64'] as string[]
        }
    };
    
    async execute(params: ReplaceLayerContentParams): Promise<ToolResult> {
        return replaceLayerContent(params);
    }
}
