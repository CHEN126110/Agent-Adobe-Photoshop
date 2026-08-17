/**
 * 获取图层边界工具
 */

import { Tool, ToolSchema, LayerBounds } from '../types';
import { observeActiveDocumentAtHistoryState } from '../../core/photoshop-document-observation';
import type { PhotoshopHistoryStateRef } from '../../core/photoshop-history-state-ref';

export class GetLayerBoundsTool implements Tool {
    name = 'getLayerBounds';

    schema: ToolSchema = {
        name: 'getLayerBounds',
        description: '获取指定图层的边界信息（位置和尺寸）',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '图层ID，如果不提供则获取当前选中的图层'
                },
                includeEffects: {
                    type: 'boolean',
                    description: '是否包含图层效果的边界，默认 true'
                }
            }
        }
    };

    async execute(params: { 
        layerId?: number | string; 
        includeEffects?: boolean 
    }): Promise<{
        success: boolean;
        layerId?: number;
        layerName?: string;
        layerKind?: string;
        bounds?: LayerBounds;
        boundsNoEffects?: LayerBounds;
        /** 本次读取绑定的文档历史版本；后续结构写入据此校验观察是否仍然新鲜。 */
        historyStateRef?: PhotoshopHistoryStateRef;
        error?: string;
    }> {
        try {
            // 与 getLayerHierarchy 同样绑定文档历史版本后再读。
            // 缺了 historyStateRef，本工具的读取结果就无法作为后续结构写入的观察凭据：
            // 上游 preflight 只会签发不含 expectedHistoryStateRef 的 guard，而 moveLayer 一类
            // 要求 document_revision 级绑定的写入会被直接拒绝。
            // 真机病例：SKU 色卡「缩放字号(setTextStyle 成功) → 重读边界(本工具) → 移动文字(moveLayer)」，
            // 第二步让旧观察失效、第三步又拿不到新版本，色名文字适配必然失败，重试多少次都一样。
            const observation = await observeActiveDocumentAtHistoryState({
                commandName: 'DesignEcho: 读取图层边界',
                unavailableMessage: '无法读取 Photoshop 文档历史版本，请重新读取当前图层边界。',
                changedMessage: '读取图层边界期间 Photoshop 文档发生变化，请重新读取。'
            }, (doc) => {
                let layer;

                if (params.layerId) {
                    const numericId = typeof params.layerId === 'string'
                        ? parseInt(params.layerId, 10)
                        : params.layerId;
                    layer = this.findLayerById(doc, numericId);
                    if (!layer) {
                        throw new Error(`未找到图层 ID: ${params.layerId}`);
                    }
                } else {
                    const activeLayers = doc.activeLayers;
                    if (!activeLayers || activeLayers.length === 0) {
                        throw new Error('请先选中一个图层');
                    }
                    layer = activeLayers[0];
                }

                const boundsWithEffects = layer.bounds;
                const boundsNoEffects = layer.boundsNoEffects || boundsWithEffects;

                const value: any = {
                    layerId: layer.id,
                    layerName: layer.name,
                    layerKind: layer.kind  // 图层类型：pixel, smartObject, vector, text 等
                };

                // 主边界（可能包含效果）
                value.bounds = {
                    left: boundsWithEffects.left,
                    top: boundsWithEffects.top,
                    right: boundsWithEffects.right,
                    bottom: boundsWithEffects.bottom,
                    width: boundsWithEffects.width,
                    height: boundsWithEffects.height
                };

                // 不含效果的边界
                if (params.includeEffects !== false) {
                    value.boundsNoEffects = {
                        left: boundsNoEffects.left,
                        top: boundsNoEffects.top,
                        right: boundsNoEffects.right,
                        bottom: boundsNoEffects.bottom,
                        width: boundsNoEffects.width,
                        height: boundsNoEffects.height
                    };
                }

                return value;
            });

            return {
                success: true,
                ...observation.value,
                historyStateRef: observation.historyStateRef
            };

        } catch (error) {
            console.error('[GetLayerBounds] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '获取边界失败'
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
