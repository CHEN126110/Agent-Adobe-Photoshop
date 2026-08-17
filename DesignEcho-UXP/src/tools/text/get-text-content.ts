/**
 * 获取文本内容工具
 */

import { Tool, ToolSchema } from '../types';

const app = require('photoshop').app;
const { LayerKind } = require('photoshop').constants;

export class GetTextContentTool implements Tool {
    name = 'getTextContent';

    schema: ToolSchema = {
        name: 'getTextContent',
        description: '获取指定文本图层或当前选中文本图层的内容',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '图层ID，如果不提供则获取当前选中的文本图层'
                },
                layerIds: {
                    type: 'array',
                    description: '批量获取多个文本图层内容（优先于 layerId）',
                    items: { type: 'number' }
                }
            }
        }
    };

    async execute(params: { layerId?: number; layerIds?: number[] }): Promise<{
        success: boolean;
        layerId?: number;
        content?: string;
        contents?: Array<{ layerId: number; content: string }>;
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            if (params.layerIds && params.layerIds.length > 0) {
                const contents = params.layerIds.map(id => {
                    const layer = this.resolveLayerByIdFast(doc, id);
                    if (!layer) {
                        throw new Error(`未找到图层 ID: ${id}`);
                    }
                    if (layer.kind !== LayerKind.TEXT) {
                        throw new Error(`图层 ID ${id} 不是文本图层`);
                    }
                    return { layerId: layer.id, content: layer.textItem.contents };
                });

                return {
                    success: true,
                    contents
                };
            }

            let layer;
            
            if (params.layerId) {
                // 通过 ID 查找图层（先看当前选中项，命中就跳过全树递归）
                layer = this.resolveLayerByIdFast(doc, params.layerId);
                if (!layer) {
                    return { success: false, error: `未找到图层 ID: ${params.layerId}` };
                }
            } else {
                // 获取当前选中的图层
                const activeLayers = doc.activeLayers;
                if (!activeLayers || activeLayers.length === 0) {
                    return { success: false, error: '请先选中一个文本图层' };
                }
                layer = activeLayers[0];
            }

            // 检查是否为文本图层
            if (layer.kind !== LayerKind.TEXT) {
                return { success: false, error: '选中的不是文本图层' };
            }

            return {
                success: true,
                layerId: layer.id,
                content: layer.textItem.contents
            };

        } catch (error) {
            console.error('[GetTextContent] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '获取文本失败'
            };
        }
    }

    /**
     * 按 ID 取图层：命中当前选中项就免掉整棵图层树的递归。
     *
     * 递归每访问一次 layer/layers 都要跨 UXP↔Photoshop 边界。真机实测
     * （详情页.psb，115 图层，2026-08-06）：按 ID 递归定位约 165-216ms，
     * 直接用当前选中图层约 29ms。撰写文案每次生成都要先读一次当前文本，
     * 而那个图层正是用户刚选中的。
     */
    private resolveLayerByIdFast(doc: any, id: number): any {
        try {
            const activeLayers = doc.activeLayers;
            if (activeLayers && activeLayers.length > 0) {
                for (const layer of activeLayers) {
                    if (layer?.id === id) return layer;
                }
            }
        } catch {
            // 选中态读取失败不影响正确性，继续走全树查找
        }
        return this.findLayerById(doc, id);
    }

    /**
     * 递归查找图层
     */
    private findLayerById(container: any, id: number): any {
        for (const layer of container.layers) {
            if (layer.id === id) {
                return layer;
            }
            if (layer.layers) {
                const found = this.findLayerById(layer, id);
                if (found) return found;
            }
        }
        return null;
    }
}
