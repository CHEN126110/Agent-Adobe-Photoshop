/**
 * 设置文本内容工具
 */

import { Tool, ToolSchema } from '../types';

const app = require('photoshop').app;
const { core } = require('photoshop');
const { LayerKind } = require('photoshop').constants;

export class SetTextContentTool implements Tool {
    name = 'setTextContent';

    schema: ToolSchema = {
        name: 'setTextContent',
        description: '设置文本内容（带智能检查）。会自动检测文本是否超出画布，并给出修复建议。返回的 checks 对象包含 isOutOfBounds（是否超出）、suggestedFix（修复建议）等信息。',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '图层ID，如果不提供则修改当前选中的文本图层'
                },
                content: {
                    type: 'string',
                    description: '新的文本内容'
                },
                updates: {
                    type: 'array',
                    description: '批量更新多个文本图层（优先于单个 content/layerId）',
                    items: {
                        type: 'object'
                    }
                }
            },
            required: []
        }
    };

    async execute(params: { layerId?: number; content?: string; updates?: Array<{ layerId: number; content: string }> }): Promise<{
        success: boolean;
        layerId?: number;
        previousContent?: string;
        newContent?: string;
        results?: Array<{
            layerId: number;
            previousContent: string;
            newContent: string;
            checks: {
                isOutOfBounds: boolean;
                isClipped: boolean;
                overflowDirection?: string;
                suggestedFix?: string;
            };
            layerBounds?: { left: number; top: number; right: number; bottom: number };
        }>;
        error?: string;
        // 新增：智能检查结果
        checks?: {
            isOutOfBounds: boolean;      // 是否超出画布
            isClipped: boolean;          // 是否被裁剪
            overflowDirection?: string;  // 超出方向
            suggestedFix?: string;       // 建议修复方式
        };
        layerBounds?: { left: number; top: number; right: number; bottom: number };
        canvasBounds?: { width: number; height: number };
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            const canvasWidth = doc.width;
            const canvasHeight = doc.height;
            const canvasBounds = { width: canvasWidth, height: canvasHeight };

            const buildChecks = (bounds: any) => {
                const overflows: string[] = [];
                if (bounds.left < 0) overflows.push('左侧');
                if (bounds.top < 0) overflows.push('上方');
                if (bounds.right > canvasWidth) overflows.push('右侧');
                if (bounds.bottom > canvasHeight) overflows.push('下方');

                const isOutOfBounds = overflows.length > 0;
                const isClipped = isOutOfBounds;

                let suggestedFix = '';
                if (isOutOfBounds) {
                    if (overflows.includes('右侧') || overflows.includes('左侧')) {
                        suggestedFix = '建议：减小字号、缩短文案、或调整文本框宽度';
                    }
                    if (overflows.includes('下方') || overflows.includes('上方')) {
                        suggestedFix = '建议：向' + (overflows.includes('下方') ? '上' : '下') + '移动文本';
                    }
                    if (overflows.length > 1) {
                        suggestedFix = '建议：减小字号并重新定位文本';
                    }
                }

                return {
                    isOutOfBounds,
                    isClipped,
                    overflowDirection: overflows.length > 0 ? overflows.join('、') : undefined,
                    suggestedFix: suggestedFix || undefined
                };
            };

            if (params.updates && params.updates.length > 0) {
                const targetLayers = params.updates.map(u => {
                    const layer = this.findLayerById(doc, u.layerId);
                    if (!layer) {
                        throw new Error(`未找到图层 ID: ${u.layerId}`);
                    }
                    if (layer.kind !== LayerKind.TEXT) {
                        throw new Error(`图层 ID ${u.layerId} 不是文本图层`);
                    }
                    return { layer, update: u, previousContent: layer.textItem.contents };
                });

                await core.executeAsModal(async () => {
                    for (const item of targetLayers) {
                        item.layer.textItem.contents = item.update.content;
                    }
                }, { commandName: 'DesignEcho: 批量修改文本' });

                const results = targetLayers.map(item => {
                    const bounds = item.layer.bounds;
                    const layerBounds = {
                        left: bounds.left,
                        top: bounds.top,
                        right: bounds.right,
                        bottom: bounds.bottom
                    };
                    return {
                        layerId: item.layer.id,
                        previousContent: item.previousContent,
                        newContent: item.update.content,
                        checks: buildChecks(bounds),
                        layerBounds
                    };
                });

                return {
                    success: true,
                    results,
                    canvasBounds
                };
            }

            if (typeof params.content !== 'string') {
                return { success: false, error: '必须提供 content 或 updates' };
            }

            let layer;
            if (params.layerId) {
                layer = this.findLayerById(doc, params.layerId);
                if (!layer) {
                    return { success: false, error: `未找到图层 ID: ${params.layerId}` };
                }
            } else {
                const activeLayers = doc.activeLayers;
                if (!activeLayers || activeLayers.length === 0) {
                    return { success: false, error: '请先选中一个文本图层' };
                }
                layer = activeLayers[0];
            }

            if (layer.kind !== LayerKind.TEXT) {
                return { success: false, error: '选中的不是文本图层' };
            }

            const previousContent = layer.textItem.contents;
            await core.executeAsModal(async () => {
                layer.textItem.contents = params.content as string;
            }, { commandName: 'DesignEcho: 修改文本' });

            const bounds = layer.bounds;
            const layerBounds = {
                left: bounds.left,
                top: bounds.top,
                right: bounds.right,
                bottom: bounds.bottom
            };
            const checks = buildChecks(bounds);

            return {
                success: true,
                layerId: layer.id,
                previousContent,
                newContent: params.content,
                checks,
                layerBounds,
                canvasBounds
            };

        } catch (error) {
            console.error('[SetTextContent] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '设置文本失败'
            };
        }
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
