/**
 * 对齐图层工具
 * 
 * 将多个图层按指定方式对齐
 */

import { Tool, ToolSchema } from '../types';

const app = require('photoshop').app;
const { core } = require('photoshop');
const { action } = require('photoshop');

type AlignType = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export class AlignLayersTool implements Tool {
    name = 'alignLayers';

    schema: ToolSchema = {
        name: 'alignLayers',
        description: '将多个图层按指定方式对齐',
        parameters: {
            type: 'object',
            properties: {
                layerIds: {
                    type: 'array',
                    items: { type: 'number' },
                    description: '要对齐的图层ID数组，如果不提供则使用当前选中的图层'
                },
                alignType: {
                    type: 'string',
                    enum: ['left', 'center', 'right', 'top', 'middle', 'bottom'],
                    description: '对齐方式：left/center/right（水平）或 top/middle/bottom（垂直）'
                },
                alignTo: {
                    type: 'string',
                    enum: ['selection', 'canvas', 'firstLayer'],
                    description: '对齐参考：selection（选区）、canvas（画布）、firstLayer（第一个图层）'
                }
            },
            required: ['alignType']
        }
    };

    async execute(params: {
        layerIds?: number[];
        alignType: AlignType;
        alignTo?: 'selection' | 'canvas' | 'firstLayer';
    }): Promise<{
        success: boolean;
        alignedLayers?: number[];
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            // 获取要对齐的图层
            let layers: any[] = [];
            
            if (params.layerIds && params.layerIds.length > 0) {
                for (const id of params.layerIds) {
                    const layer = this.findLayerById(doc, id);
                    if (layer) {
                        layers.push(layer);
                    }
                }
            } else {
                layers = doc.activeLayers || [];
            }

            if (layers.length === 0) {
                return { success: false, error: '没有选中图层' };
            }

            const alignTo = params.alignTo || 'firstLayer';
            
            await core.executeAsModal(async () => {
                // 先选中这些图层
                if (params.layerIds && params.layerIds.length > 0) {
                    // 使用 batchPlay 选中图层
                    await action.batchPlay([
                        {
                            _obj: 'select',
                            _target: params.layerIds.map(id => ({ _ref: 'layer', _id: id })),
                            makeVisible: false,
                            layerID: params.layerIds,
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], {});
                }

                // 构建对齐命令
                const alignDescriptor = this.getAlignDescriptor(params.alignType, alignTo);
                
                await action.batchPlay([alignDescriptor], {});

            }, { commandName: 'DesignEcho: 对齐图层' });

            return {
                success: true,
                alignedLayers: layers.map(l => l.id)
            };

        } catch (error) {
            console.error('[AlignLayers] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '对齐失败'
            };
        }
    }

    private getAlignDescriptor(alignType: AlignType, alignTo: string): any {
        // 映射对齐类型到 Photoshop 的 alignDistributeSelector
        const alignMap: Record<AlignType, string> = {
            'left': 'ADSLefts',
            'center': 'ADSCentersH',
            'right': 'ADSRights',
            'top': 'ADSTops',
            'middle': 'ADSCentersV',
            'bottom': 'ADSBottoms'
        };

        // 映射对齐参考
        const alignToMap: Record<string, string> = {
            'selection': 'selection',
            'canvas': 'canvas',
            'firstLayer': 'selected'
        };

        return {
            _obj: 'align',
            _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
            using: { _enum: 'alignDistributeSelector', _value: alignMap[alignType] },
            alignToCanvas: alignTo === 'canvas',
            _options: { dialogOptions: 'dontDisplay' }
        };
    }

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
