/**
 * 剪切蒙版工具
 * 
 * 创建和释放剪切蒙版
 */

import { Tool, ToolSchema } from '../types';

const app = require('photoshop').app;
const { core, action } = require('photoshop');

export class CreateClippingMaskTool implements Tool {
    name = 'createClippingMask';

    schema: ToolSchema = {
        name: 'createClippingMask',
        description: '将当前选中的图层创建为剪切蒙版，剪切到下方图层。剪切蒙版会使上方图层只显示在下方图层的不透明区域内。',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '要创建剪切蒙版的图层 ID（可选，默认使用当前选中的图层）'
                }
            }
        }
    };

    async execute(params: {
        layerId?: number;
    }): Promise<{
        success: boolean;
        clippedLayer?: {
            id: number;
            name: string;
        };
        baseLayer?: {
            id: number;
            name: string;
        };
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            let targetLayer: any;

            // 如果提供了 layerId，先选中该图层
            if (params.layerId) {
                targetLayer = this.findLayerById(doc, params.layerId);
                if (!targetLayer) {
                    return { success: false, error: `未找到 ID 为 ${params.layerId} 的图层` };
                }
            } else {
                // 使用当前选中的图层
                if (doc.activeLayers.length === 0) {
                    return { success: false, error: '没有选中的图层' };
                }
                targetLayer = doc.activeLayers[0];
            }

            // 检查是否已经是剪切蒙版
            if (targetLayer.isClippingMask) {
                return { success: false, error: `图层 "${targetLayer.name}" 已经是剪切蒙版` };
            }

            // 获取下方图层（基底层）信息
            const baseLayer = this.getLayerBelow(doc, targetLayer);
            if (!baseLayer) {
                return { success: false, error: '没有可用的下方图层作为剪切蒙版基底' };
            }

            // 创建剪切蒙版
            await core.executeAsModal(async () => {
                await action.batchPlay([
                    {
                        _obj: 'select',
                        _target: [{ _ref: 'layer', _id: targetLayer.id }],
                        makeVisible: false,
                        _options: { dialogOptions: 'dontDisplay' }
                    },
                    {
                        _obj: 'groupEvent',
                        _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], {});
            }, { commandName: 'DesignEcho: 创建剪切蒙版' });

            console.log(`[CreateClippingMask] 已将图层 "${targetLayer.name}" 剪切到 "${baseLayer.name}"`);

            return {
                success: true,
                clippedLayer: {
                    id: targetLayer.id,
                    name: targetLayer.name
                },
                baseLayer: {
                    id: baseLayer.id,
                    name: baseLayer.name
                }
            };

        } catch (error) {
            console.error('[CreateClippingMask] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '创建剪切蒙版失败'
            };
        }
    }

    /**
     * 递归查找图层
     */
    private findLayerById(container: any, id: number): any {
        for (const layer of container.layers) {
            if (layer.id === id) return layer;
            if (layer.layers) {
                const found = this.findLayerById(layer, id);
                if (found) return found;
            }
        }
        return null;
    }

    /**
     * 获取图层下方的图层
     */
    private getLayerBelow(doc: any, targetLayer: any): any {
        const allLayers = this.getAllLayersFlat(doc);
        const targetIndex = allLayers.findIndex((l: any) => l.id === targetLayer.id);
        
        if (targetIndex >= 0 && targetIndex < allLayers.length - 1) {
            return allLayers[targetIndex + 1];
        }
        return null;
    }

    /**
     * 获取所有图层的扁平列表（按视觉顺序）
     */
    private getAllLayersFlat(container: any): any[] {
        const layers: any[] = [];
        for (const layer of container.layers) {
            layers.push(layer);
            if (layer.layers) {
                layers.push(...this.getAllLayersFlat(layer));
            }
        }
        return layers;
    }
}

export class ReleaseClippingMaskTool implements Tool {
    name = 'releaseClippingMask';

    schema: ToolSchema = {
        name: 'releaseClippingMask',
        description: '释放当前选中图层的剪切蒙版关系，使其成为独立图层。',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '要释放剪切蒙版的图层 ID（可选，默认使用当前选中的图层）'
                }
            }
        }
    };

    async execute(params: {
        layerId?: number;
    }): Promise<{
        success: boolean;
        releasedLayer?: {
            id: number;
            name: string;
        };
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            let targetLayer: any;

            if (params.layerId) {
                targetLayer = this.findLayerById(doc, params.layerId);
                if (!targetLayer) {
                    return { success: false, error: `未找到 ID 为 ${params.layerId} 的图层` };
                }
            } else {
                if (doc.activeLayers.length === 0) {
                    return { success: false, error: '没有选中的图层' };
                }
                targetLayer = doc.activeLayers[0];
            }

            // 检查是否是剪切蒙版
            if (!targetLayer.isClippingMask) {
                return { success: false, error: `图层 "${targetLayer.name}" 不是剪切蒙版` };
            }

            // 释放剪切蒙版
            await core.executeAsModal(async () => {
                await action.batchPlay([
                    {
                        _obj: 'select',
                        _target: [{ _ref: 'layer', _id: targetLayer.id }],
                        makeVisible: false,
                        _options: { dialogOptions: 'dontDisplay' }
                    },
                    {
                        _obj: 'ungroup',
                        _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], {});
            }, { commandName: 'DesignEcho: 释放剪切蒙版' });

            console.log(`[ReleaseClippingMask] 已释放图层 "${targetLayer.name}" 的剪切蒙版`);

            return {
                success: true,
                releasedLayer: {
                    id: targetLayer.id,
                    name: targetLayer.name
                }
            };

        } catch (error) {
            console.error('[ReleaseClippingMask] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '释放剪切蒙版失败'
            };
        }
    }

    private findLayerById(container: any, id: number): any {
        for (const layer of container.layers) {
            if (layer.id === id) return layer;
            if (layer.layers) {
                const found = this.findLayerById(layer, id);
                if (found) return found;
            }
        }
        return null;
    }
}
