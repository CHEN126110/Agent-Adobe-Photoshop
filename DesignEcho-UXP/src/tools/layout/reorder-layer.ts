/**
 * 图层排序工具
 * 
 * 控制图层的上下层级关系
 */

import { Tool, ToolSchema } from '../types';

const app = require('photoshop').app;
const { core, action } = require('photoshop');

export class ReorderLayerTool implements Tool {
    name = 'reorderLayer';

    schema: ToolSchema = {
        name: 'reorderLayer',
        description: '调整图层的堆叠顺序。可以将图层上移、下移、置顶、置底，或移动到指定图层的上方/下方。',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '要移动的图层 ID（可选，默认使用当前选中的图层）'
                },
                action: {
                    type: 'string',
                    enum: ['up', 'down', 'top', 'bottom', 'above', 'below'],
                    description: '移动方式: up(上移一层), down(下移一层), top(置顶), bottom(置底), above(移到指定图层上方), below(移到指定图层下方)'
                },
                targetLayerId: {
                    type: 'number',
                    description: '目标图层 ID（仅当 action 为 above 或 below 时需要）'
                },
                steps: {
                    type: 'number',
                    description: '移动的层数（仅当 action 为 up 或 down 时有效），默认 1'
                }
            },
            required: ['action']
        }
    };

    async execute(params: {
        layerId?: number;
        action: 'up' | 'down' | 'top' | 'bottom' | 'above' | 'below';
        targetLayerId?: number;
        steps?: number;
    }): Promise<{
        success: boolean;
        layer?: {
            id: number;
            name: string;
            newPosition: string;
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

            // 检查是否是背景图层
            if (targetLayer.isBackgroundLayer) {
                return { success: false, error: '背景图层不能移动' };
            }

            const steps = params.steps || 1;
            let newPosition = '';

            await core.executeAsModal(async () => {
                // 先选中要移动的图层
                await action.batchPlay([
                    {
                        _obj: 'select',
                        _target: [{ _ref: 'layer', _id: targetLayer.id }],
                        makeVisible: false,
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], {});

                switch (params.action) {
                    case 'up':
                        // 上移图层
                        for (let i = 0; i < steps; i++) {
                            await action.batchPlay([
                                {
                                    _obj: 'move',
                                    _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                                    to: { _ref: 'layer', _enum: 'ordinal', _value: 'previous' },
                                    _options: { dialogOptions: 'dontDisplay' }
                                }
                            ], {});
                        }
                        newPosition = `上移 ${steps} 层`;
                        break;

                    case 'down':
                        // 下移图层
                        for (let i = 0; i < steps; i++) {
                            await action.batchPlay([
                                {
                                    _obj: 'move',
                                    _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                                    to: { _ref: 'layer', _enum: 'ordinal', _value: 'next' },
                                    _options: { dialogOptions: 'dontDisplay' }
                                }
                            ], {});
                        }
                        newPosition = `下移 ${steps} 层`;
                        break;

                    case 'top':
                        // 置顶
                        await action.batchPlay([
                            {
                                _obj: 'move',
                                _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                                to: { _ref: 'layer', _enum: 'ordinal', _value: 'front' },
                                _options: { dialogOptions: 'dontDisplay' }
                            }
                        ], {});
                        newPosition = '已置顶';
                        break;

                    case 'bottom':
                        // 置底（但在背景图层之上）
                        await action.batchPlay([
                            {
                                _obj: 'move',
                                _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                                to: { _ref: 'layer', _enum: 'ordinal', _value: 'back' },
                                _options: { dialogOptions: 'dontDisplay' }
                            }
                        ], {});
                        newPosition = '已置底';
                        break;

                    case 'above':
                    case 'below':
                        if (!params.targetLayerId) {
                            throw new Error('需要指定目标图层 ID');
                        }
                        const destLayer = this.findLayerById(doc, params.targetLayerId);
                        if (!destLayer) {
                            throw new Error(`未找到目标图层 ID: ${params.targetLayerId}`);
                        }

                        await action.batchPlay([
                            {
                                _obj: 'move',
                                _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                                to: { 
                                    _ref: 'layer', 
                                    _id: destLayer.id 
                                },
                                adjustment: params.action === 'above',  // true = 上方, false = 下方
                                _options: { dialogOptions: 'dontDisplay' }
                            }
                        ], {});
                        newPosition = params.action === 'above' 
                            ? `移到 "${destLayer.name}" 上方` 
                            : `移到 "${destLayer.name}" 下方`;
                        break;
                }
            }, { commandName: 'DesignEcho: 调整图层顺序' });

            console.log(`[ReorderLayer] 图层 "${targetLayer.name}" ${newPosition}`);

            return {
                success: true,
                layer: {
                    id: targetLayer.id,
                    name: targetLayer.name,
                    newPosition
                }
            };

        } catch (error) {
            console.error('[ReorderLayer] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '调整图层顺序失败'
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

/**
 * 图层编组工具
 */
export class GroupLayersTool implements Tool {
    name = 'groupLayers';

    schema: ToolSchema = {
        name: 'groupLayers',
        description: '将选中的图层编组（创建图层组）。',
        parameters: {
            type: 'object',
            properties: {
                layerIds: {
                    type: 'array',
                    description: '要编组的图层 ID 列表（可选，默认使用当前选中的所有图层）',
                    items: { type: 'number' }
                },
                groupName: {
                    type: 'string',
                    description: '新建组的名称，默认为 "组 1"'
                }
            }
        }
    };

    async execute(params: {
        layerIds?: number[];
        groupName?: string;
    }): Promise<{
        success: boolean;
        group?: {
            id: number;
            name: string;
            layerCount: number;
        };
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            // 选中要编组的图层
            if (params.layerIds && params.layerIds.length > 0) {
                await core.executeAsModal(async () => {
                    await action.batchPlay([
                        {
                            _obj: 'select',
                            _target: params.layerIds!.map(id => ({ _ref: 'layer', _id: id })),
                            makeVisible: false,
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], {});
                }, { commandName: 'DesignEcho: 选择图层' });
            }

            if (doc.activeLayers.length < 1) {
                return { success: false, error: '至少需要选中一个图层才能编组' };
            }

            const layerCount = doc.activeLayers.length;

            // 创建编组
            await core.executeAsModal(async () => {
                await action.batchPlay([
                    {
                        _obj: 'make',
                        _target: [{ _ref: 'layerSection' }],
                        from: { _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' },
                        using: {
                            _obj: 'layerSection',
                            name: params.groupName || '组 1'
                        },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], {});
            }, { commandName: 'DesignEcho: 图层编组' });

            // 获取新建的组信息
            const newGroup = doc.activeLayers[0];

            console.log(`[GroupLayers] 已创建组 "${newGroup.name}"，包含 ${layerCount} 个图层`);

            return {
                success: true,
                group: {
                    id: newGroup.id,
                    name: newGroup.name,
                    layerCount
                }
            };

        } catch (error) {
            console.error('[GroupLayers] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '编组失败'
            };
        }
    }
}

/**
 * 取消编组工具
 */
export class UngroupLayersTool implements Tool {
    name = 'ungroupLayers';

    schema: ToolSchema = {
        name: 'ungroupLayers',
        description: '取消图层组，将组内的图层释放出来。',
        parameters: {
            type: 'object',
            properties: {
                groupId: {
                    type: 'number',
                    description: '要取消编组的图层组 ID（可选，默认使用当前选中的组）'
                }
            }
        }
    };

    async execute(params: {
        groupId?: number;
    }): Promise<{
        success: boolean;
        ungroupedLayers?: Array<{
            id: number;
            name: string;
        }>;
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            let targetGroup: any;

            if (params.groupId) {
                targetGroup = this.findLayerById(doc, params.groupId);
                if (!targetGroup) {
                    return { success: false, error: `未找到 ID 为 ${params.groupId} 的图层组` };
                }
            } else {
                if (doc.activeLayers.length === 0) {
                    return { success: false, error: '没有选中的图层' };
                }
                targetGroup = doc.activeLayers[0];
            }

            // 检查是否是图层组
            const kind = targetGroup.kind?.toString() || '';
            if (!kind.includes('group') && !targetGroup.layers) {
                return { success: false, error: `图层 "${targetGroup.name}" 不是图层组` };
            }

            // 取消编组
            await core.executeAsModal(async () => {
                await action.batchPlay([
                    {
                        _obj: 'select',
                        _target: [{ _ref: 'layer', _id: targetGroup.id }],
                        makeVisible: false,
                        _options: { dialogOptions: 'dontDisplay' }
                    },
                    {
                        _obj: 'ungroupLayersEvent',
                        _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], {});
            }, { commandName: 'DesignEcho: 取消编组' });

            // 获取释放出来的图层
            const ungroupedLayers = doc.activeLayers.map((l: any) => ({
                id: l.id,
                name: l.name
            }));

            console.log(`[UngroupLayers] 已取消编组，释放 ${ungroupedLayers.length} 个图层`);

            return {
                success: true,
                ungroupedLayers
            };

        } catch (error) {
            console.error('[UngroupLayers] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '取消编组失败'
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
