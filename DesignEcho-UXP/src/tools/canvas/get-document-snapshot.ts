/**
 * 获取文档截图工具
 */

import { Tool, ToolSchema } from '../types';

const app = require('photoshop').app;
const { core, imaging } = require('photoshop');

export class GetDocumentSnapshotTool implements Tool {
    name = 'getDocumentSnapshot';

    schema: ToolSchema = {
        name: 'getDocumentSnapshot',
        description: '获取当前文档的截图（缩略图），返回 base64 编码的图像数据',
        parameters: {
            type: 'object',
            properties: {
                maxWidth: {
                    type: 'number',
                    description: '最大宽度 (px)，默认 800'
                },
                maxHeight: {
                    type: 'number',
                    description: '最大高度 (px)，默认 600'
                },
                format: {
                    type: 'string',
                    description: '图像格式: "jpeg" 或 "png"，默认 "jpeg"',
                    enum: ['jpeg', 'png']
                }
            }
        }
    };

    async execute(params: {
        maxWidth?: number;
        maxHeight?: number;
        format?: 'jpeg' | 'png';
    }): Promise<{
        success: boolean;
        imageData?: string;
        width?: number;
        height?: number;
        format?: string;
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            const maxWidth = params.maxWidth || 800;
            const maxHeight = params.maxHeight || 600;
            const format = params.format || 'jpeg';

            // 计算缩放后的尺寸
            const docWidth = doc.width;
            const docHeight = doc.height;
            const scale = Math.min(maxWidth / docWidth, maxHeight / docHeight, 1);
            const targetWidth = Math.round(docWidth * scale);
            const targetHeight = Math.round(docHeight * scale);

            // 使用 executeAsModal 获取像素数据（imaging API 必须在 modal scope 内执行）
            let base64 = '';
            await core.executeAsModal(async () => {
                // 获取像素数据
                const pixelData = await imaging.getPixels({
                    documentID: doc.id,
                    targetSize: {
                        width: targetWidth,
                        height: targetHeight
                    },
                    componentCount: 4  // RGBA
                });

                // 获取图像数据
                const imageData = await pixelData.imageData.getData();
                
                // 转换为 base64
                base64 = await this.rgbaToBase64(imageData, targetWidth, targetHeight, format);

                // 释放资源
                pixelData.imageData.dispose();
            }, { commandName: 'DesignEcho: 获取文档截图' });

            return {
                success: true,
                imageData: base64,
                width: targetWidth,
                height: targetHeight,
                format: format
            };

        } catch (error) {
            console.error('[GetDocumentSnapshot] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '获取截图失败'
            };
        }
    }

    /**
     * RGBA 转 Base64 (JPEG/PNG)
     */
    private async rgbaToBase64(
        rgbaData: ArrayBuffer | Uint8Array, 
        width: number, 
        height: number, 
        format: 'jpeg' | 'png' = 'jpeg'
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            try {
                // 创建 Canvas
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                
                if (!ctx) {
                    throw new Error('无法创建 Canvas Context');
                }

                // 创建 ImageData
                // 注意：UXP 的 ArrayBuffer 可能需要转换
                const data = new Uint8ClampedArray(rgbaData);
                const imageData = new ImageData(data, width, height);
                
                // 绘制到 Canvas
                ctx.putImageData(imageData, 0, 0);
                
                // 导出为 Base64
                const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
                const quality = 0.8;
                
                // UXP 的 toDataURL 返回完整的 data URI: data:image/jpeg;base64,...
                const dataUrl = canvas.toDataURL(mimeType, quality);
                
                // 去除前缀，只返回 base64 内容
                const base64 = dataUrl.split(',')[1];
                resolve(base64);
            } catch (e) {
                reject(e);
            }
        });
    }
}
