/**
 * 带标注的画布截图工具
 * 
 * 核心功能：
 * 1. 获取画布截图
 * 2. 获取所有可见图层的边界信息
 * 3. 返回截图 + 图层边界映射，供 Agent 端进行标注
 * 
 * 这样 AI 就能将图层信息与画面中的视觉元素对应起来
 */

import { Tool, ToolSchema } from '../types';

const app = require('photoshop').app;
const { core, imaging } = require('photoshop');

/**
 * 图层边界信息（用于标注）
 */
interface LayerBounds {
    id: number;
    index: number;           // 标注编号（从 1 开始）
    name: string;
    kind: string;            // 'text' | 'pixel' | 'smartObject' | 'group' | 'adjustment' | 'shape'
    visible: boolean;
    bounds: {
        left: number;
        top: number;
        right: number;
        bottom: number;
        width: number;
        height: number;
    };
    // 文本图层特有
    textContent?: string;
    // 用于标注的颜色（由 Agent 端分配）
    color?: string;
}

export class GetAnnotatedSnapshotTool implements Tool {
    name = 'getAnnotatedSnapshot';

    schema: ToolSchema = {
        name: 'getAnnotatedSnapshot',
        description: `获取带有图层边界映射的画布截图。
返回截图和所有可见图层的边界信息，Agent 端会在截图上绘制边界框标注。
这使 AI 能够将图层列表中的元素与画面中的视觉位置对应起来。

返回数据结构：
- imageData: 画布截图（base64）
- layers: 图层边界映射数组，每个包含 id、name、kind、bounds
- documentSize: 文档原始尺寸
- snapshotSize: 截图尺寸（用于计算缩放比例）`,
        parameters: {
            type: 'object',
            properties: {
                maxWidth: {
                    type: 'number',
                    description: '截图最大宽度 (px)，默认 1200'
                },
                maxHeight: {
                    type: 'number',
                    description: '截图最大高度 (px)，默认 900'
                },
                includeHidden: {
                    type: 'boolean',
                    description: '是否包含隐藏图层，默认 false'
                },
                layerFilter: {
                    type: 'string',
                    description: '图层类型过滤：all（全部）| visual（排除调整图层）| text（仅文本）',
                    enum: ['all', 'visual', 'text']
                }
            }
        }
    };

    async execute(params: {
        maxWidth?: number;
        maxHeight?: number;
        includeHidden?: boolean;
        layerFilter?: 'all' | 'visual' | 'text';
    }): Promise<{
        success: boolean;
        imageData?: string;
        layers?: LayerBounds[];
        documentSize?: { width: number; height: number };
        snapshotSize?: { width: number; height: number };
        scale?: number;
        summary?: {
            total: number;
            text: number;
            pixel: number;
            smartObject: number;
            group: number;
            shape: number;
            adjustment: number;
        };
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            const maxWidth = params.maxWidth || 1200;
            const maxHeight = params.maxHeight || 900;
            const includeHidden = params.includeHidden || false;
            const layerFilter = params.layerFilter || 'visual';

            // 1. 获取文档尺寸和计算缩放
            const docWidth = doc.width;
            const docHeight = doc.height;
            const scale = Math.min(maxWidth / docWidth, maxHeight / docHeight, 1);
            const targetWidth = Math.round(docWidth * scale);
            const targetHeight = Math.round(docHeight * scale);

            // 2. 获取画布截图（必须在 executeAsModal 内执行）
            let base64 = '';
            await core.executeAsModal(async () => {
                const pixelData = await imaging.getPixels({
                    documentID: doc.id,
                    targetSize: {
                        width: targetWidth,
                        height: targetHeight
                    },
                    componentCount: 4
                });

                const imageData = await pixelData.imageData.getData();
                base64 = await this.rgbaToBase64(imageData, targetWidth, targetHeight, 'jpeg');
                pixelData.imageData.dispose();
            }, { commandName: 'DesignEcho: 获取标注截图' });

            // 3. 收集图层边界信息
            const layers: LayerBounds[] = [];
            let index = 1;
            
            const summary = {
                total: 0,
                text: 0,
                pixel: 0,
                smartObject: 0,
                group: 0,
                shape: 0,
                adjustment: 0
            };

            // 递归遍历图层
            const processLayers = (layerList: any[], depth: number = 0) => {
                for (const layer of layerList) {
                    // 跳过隐藏图层
                    if (!includeHidden && !layer.visible) continue;

                    // 获取图层类型
                    const kind = this.getLayerKind(layer);
                    
                    // 根据过滤器筛选
                    if (layerFilter === 'text' && kind !== 'text') {
                        // 如果是组，继续递归
                        if (kind === 'group' && layer.layers) {
                            processLayers(layer.layers, depth + 1);
                        }
                        continue;
                    }
                    if (layerFilter === 'visual' && kind === 'adjustment') {
                        continue;
                    }

                    // 获取边界
                    try {
                        const bounds = layer.bounds;
                        if (bounds && bounds.width > 0 && bounds.height > 0) {
                            const layerInfo: LayerBounds = {
                                id: layer.id,
                                index: index++,
                                name: layer.name || `Layer ${layer.id}`,
                                kind: kind,
                                visible: layer.visible,
                                bounds: {
                                    // 转换为截图坐标系
                                    left: Math.round(bounds.left * scale),
                                    top: Math.round(bounds.top * scale),
                                    right: Math.round(bounds.right * scale),
                                    bottom: Math.round(bounds.bottom * scale),
                                    width: Math.round(bounds.width * scale),
                                    height: Math.round(bounds.height * scale)
                                }
                            };

                            // 文本图层额外信息
                            if (kind === 'text') {
                                try {
                                    const textItem = layer.textItem;
                                    if (textItem) {
                                        layerInfo.textContent = textItem.contents?.substring(0, 50) || '';
                                    }
                                } catch (e) {
                                    // 忽略文本获取错误
                                }
                            }

                            layers.push(layerInfo);
                            summary.total++;
                            summary[kind as keyof typeof summary]++;
                        }
                    } catch (e) {
                        // 某些图层可能无法获取边界，跳过
                        console.warn(`[GetAnnotatedSnapshot] 无法获取图层边界: ${layer.name}`, e);
                    }

                    // 递归处理组内图层
                    if (kind === 'group' && layer.layers) {
                        processLayers(layer.layers, depth + 1);
                    }
                }
            };

            processLayers(doc.layers);

            return {
                success: true,
                imageData: base64,
                layers: layers,
                documentSize: { width: docWidth, height: docHeight },
                snapshotSize: { width: targetWidth, height: targetHeight },
                scale: scale,
                summary: summary
            };

        } catch (error) {
            console.error('[GetAnnotatedSnapshot] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '获取标注截图失败'
            };
        }
    }

    /**
     * 获取图层类型
     */
    private getLayerKind(layer: any): string {
        const kind = layer.kind?.toString().toLowerCase() || '';
        
        if (kind.includes('text')) return 'text';
        if (kind.includes('smartobject')) return 'smartObject';
        if (kind.includes('group') || kind.includes('layerset')) return 'group';
        if (kind.includes('solidfill') || kind.includes('shape')) return 'shape';
        if (kind.includes('adjustment') || kind.includes('curves') || 
            kind.includes('levels') || kind.includes('hue')) return 'adjustment';
        if (kind.includes('pixel') || kind.includes('normal')) return 'pixel';
        
        return 'pixel';
    }

    /**
     * RGBA 转 Base64 JPEG
     */
    private async rgbaToBase64(
        rgbaData: Uint8Array,
        width: number,
        height: number,
        format: 'jpeg' | 'png'
    ): Promise<string> {
        // 创建 ImageData
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('无法创建 Canvas 上下文');

        const imageData = new ImageData(
            new Uint8ClampedArray(rgbaData),
            width,
            height
        );
        ctx.putImageData(imageData, 0, 0);

        // 转换为 Blob
        const blob = await canvas.convertToBlob({
            type: format === 'png' ? 'image/png' : 'image/jpeg',
            quality: 0.92
        });

        // 转换为 Base64
        const arrayBuffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }
}
