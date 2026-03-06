/**
 * 获取所有文本图层工具
 */

import { Tool, ToolSchema, TextLayerInfo } from '../types';

const app = require('photoshop').app;
const { LayerKind } = require('photoshop').constants;

export class GetAllTextLayersTool implements Tool {
    name = 'getAllTextLayers';

    schema: ToolSchema = {
        name: 'getAllTextLayers',
        description: '获取当前文档中所有文本图层的信息，包括内容、位置、样式',
        parameters: {
            type: 'object',
            properties: {
                includeHidden: {
                    type: 'boolean',
                    description: '是否包含隐藏的图层，默认 false'
                }
            }
        }
    };

    async execute(params: { includeHidden?: boolean }): Promise<{
        success: boolean;
        layers?: TextLayerInfo[];
        count?: number;
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            const textLayers: TextLayerInfo[] = [];
            this.collectTextLayers(doc, textLayers, params.includeHidden ?? false);

            return {
                success: true,
                layers: textLayers,
                count: textLayers.length
            };

        } catch (error) {
            console.error('[GetAllTextLayers] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '获取图层失败'
            };
        }
    }

    /**
     * 递归收集文本图层
     */
    private collectTextLayers(
        container: any, 
        result: TextLayerInfo[], 
        includeHidden: boolean
    ): void {
        for (const layer of container.layers) {
            // 跳过隐藏图层（如果不需要）
            if (!includeHidden && !layer.visible) {
                continue;
            }

            // 如果是组，递归处理
            if (layer.kind === LayerKind.GROUP) {
                this.collectTextLayers(layer, result, includeHidden);
                continue;
            }

            // 如果是文本图层
            if (layer.kind === LayerKind.TEXT) {
                try {
                    const textItem = layer.textItem;
                    const charStyle = textItem.characterStyle;
                    const bounds = layer.bounds;

                    result.push({
                        id: layer.id,
                        name: layer.name,
                        contents: textItem.contents,
                        bounds: {
                            left: bounds.left,
                            top: bounds.top,
                            right: bounds.right,
                            bottom: bounds.bottom,
                            width: bounds.width,
                            height: bounds.height
                        },
                        style: {
                            fontSize: charStyle.size,
                            fontName: charStyle.font,
                            fontStyle: charStyle.fontStyle,
                            tracking: charStyle.tracking,
                            leading: charStyle.leading
                        }
                    });
                } catch (e) {
                    console.warn(`[GetAllTextLayers] Failed to read layer ${layer.name}:`, e);
                }
            }
        }
    }
}
