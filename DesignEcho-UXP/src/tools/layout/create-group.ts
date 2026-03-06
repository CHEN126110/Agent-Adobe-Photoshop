/**
 * 创建图层组工具
 */

import { app, core } from 'photoshop';
import type { Tool } from '../types';

export class CreateGroupTool implements Tool {
    name = 'createGroup';
    schema = {
        name: 'createGroup',
        description: '创建图层组。可以将当前选中的图层编组，或创建一个空的图层组。',
        parameters: {
            type: 'object' as const,
            properties: {
                groupName: {
                    type: 'string',
                    description: '图层组的名称'
                },
                fromSelected: {
                    type: 'boolean',
                    description: '是否从当前选中的图层创建组（默认 false，默认创建空组）'
                }
            },
            required: ['groupName']
        }
    };

    async execute(params: {
        groupName: string;
        fromSelected?: boolean;
    }): Promise<any> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            const { groupName, fromSelected = false } = params;

            console.log(`[CreateGroup] 创建图层组: "${groupName}", fromSelected: ${fromSelected}`);

            let layerCount = 0;
            
            // 使用 executeAsModal 包裹 batchPlay 操作
            await core.executeAsModal(async () => {
                if (fromSelected) {
                    // 从选中的图层创建组
                    const selectedLayers = doc.activeLayers;
                    if (!selectedLayers || selectedLayers.length === 0) {
                        throw new Error('请先选中要编组的图层');
                    }

                    layerCount = selectedLayers.length;

                    await require('photoshop').action.batchPlay([
                        {
                            _obj: 'make',
                            _target: [{ _ref: 'layerSection' }],
                            from: {
                                _ref: 'layer',
                                _enum: 'ordinal',
                                _value: 'targetEnum'
                            }
                        },
                        {
                            _obj: 'set',
                            _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                            to: {
                                _obj: 'layer',
                                name: groupName
                            }
                        }
                    ], { commandName: 'DesignEcho: 创建图层组' });

                } else {
                    // 创建空图层组
                    await require('photoshop').action.batchPlay([
                        {
                            _obj: 'make',
                            _target: [{ _ref: 'layerSection' }]
                        },
                        {
                            _obj: 'set',
                            _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                            to: {
                                _obj: 'layer',
                                name: groupName
                            }
                        }
                    ], { commandName: 'DesignEcho: 创建空图层组' });
                }
            }, { commandName: 'DesignEcho: 创建图层组' });

            // 返回结果
            if (fromSelected && layerCount > 0) {
                return {
                    success: true,
                    groupName: groupName,
                    layerCount: layerCount,
                    message: `图层组 "${groupName}" 已创建，包含 ${layerCount} 个图层`
                };
            } else {
                return {
                    success: true,
                    groupName: groupName,
                    message: `空图层组 "${groupName}" 已创建`
                };
            }

        } catch (error) {
            console.error('[CreateGroup] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '创建图层组失败'
            };
        }
    }
}
