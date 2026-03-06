/**
 * 图层层级关系工具
 * 
 * 获取完整的图层树结构，包括父子关系、剪切蒙版组等
 */

import { Tool, ToolSchema } from '../types';

const app = require('photoshop').app;

/**
 * 图层节点信息
 */
interface LayerNode {
    id: number;
    name: string;
    kind: string;
    visible: boolean;
    locked: boolean;
    opacity: number;
    blendMode: string;
    isClippingMask: boolean;      // 是否是剪切蒙版的基底层
    isClipped: boolean;           // 是否被剪切到下方图层
    parentId: number | null;      // 父图层 ID（如果在组内）
    parentName: string | null;    // 父图层名称
    index: number;                // 在同级中的索引（0 = 最上层）
    depth: number;                // 层级深度（0 = 顶级）
    path: string;                 // 从顶层到当前节点的路径（按名称）
    pathIds: number[];            // 从顶层到当前节点的路径（按 ID）
    children?: LayerNode[];       // 子图层（如果是组）
    bounds?: {
        left: number;
        top: number;
        right: number;
        bottom: number;
        width: number;
        height: number;
    };
}

export class GetLayerHierarchyTool implements Tool {
    name = 'getLayerHierarchy';

    schema: ToolSchema = {
        name: 'getLayerHierarchy',
        description: '获取文档的完整图层层级结构，包括父子关系、剪切蒙版组、图层顺序等信息。返回树形结构，便于理解图层的组织方式。',
        parameters: {
            type: 'object',
            properties: {
                includeHidden: {
                    type: 'boolean',
                    description: '是否包含隐藏图层，默认 true'
                },
                includeBounds: {
                    type: 'boolean',
                    description: '是否包含图层边界信息，默认 false（获取边界会稍慢）'
                },
                flatList: {
                    type: 'boolean',
                    description: '是否返回扁平列表而非树形结构，默认 false'
                }
            }
        }
    };

    async execute(params: {
        includeHidden?: boolean;
        includeBounds?: boolean;
        flatList?: boolean;
    }): Promise<{
        success: boolean;
        documentName?: string;
        totalLayers?: number;
        hierarchy?: LayerNode[];
        flatList?: LayerNode[];
        summary?: {
            groups: number;
            normalLayers: number;
            textLayers: number;
            adjustmentLayers: number;
            smartObjects: number;
            clippingGroups: number;
        };
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            const includeHidden = params.includeHidden !== false;
            const includeBounds = params.includeBounds === true;
            const returnFlatList = params.flatList === true;

            // 构建图层树
            const hierarchy = this.buildLayerTree(doc, null, 0, 0, includeHidden, includeBounds, [], []);
            
            // 统计信息
            const flatLayers: LayerNode[] = [];
            this.flattenTree(hierarchy, flatLayers);
            
            const summary = {
                groups: flatLayers.filter(l => l.kind === 'group').length,
                normalLayers: flatLayers.filter(l => l.kind === 'pixel').length,
                textLayers: flatLayers.filter(l => l.kind === 'text').length,
                adjustmentLayers: flatLayers.filter(l => 
                    l.kind.includes('adjustment') || 
                    ['brightnessContrast', 'levels', 'curves', 'exposure', 'vibrance', 
                     'hue', 'colorBalance', 'blackAndWhite', 'photoFilter', 'channelMixer',
                     'colorLookup', 'invert', 'posterize', 'threshold', 'gradientMap',
                     'selectiveColor'].includes(l.kind)
                ).length,
                smartObjects: flatLayers.filter(l => l.kind === 'smartObject').length,
                clippingGroups: flatLayers.filter(l => l.isClippingMask).length
            };

            console.log(`[GetLayerHierarchy] 获取到 ${flatLayers.length} 个图层`);

            if (returnFlatList) {
                return {
                    success: true,
                    documentName: doc.name,
                    totalLayers: flatLayers.length,
                    flatList: flatLayers,
                    summary
                };
            }

            return {
                success: true,
                documentName: doc.name,
                totalLayers: flatLayers.length,
                hierarchy,
                summary
            };

        } catch (error) {
            console.error('[GetLayerHierarchy] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '获取图层层级失败'
            };
        }
    }

    /**
     * 递归构建图层树
     */
    private buildLayerTree(
        container: any,
        parentId: number | null,
        parentDepth: number,
        startIndex: number,
        includeHidden: boolean,
        includeBounds: boolean,
        parentPath: string[],
        parentPathIds: number[]
    ): LayerNode[] {
        const nodes: LayerNode[] = [];
        const layers = container.layers;

        for (let i = 0; i < layers.length; i++) {
            const layer = layers[i];
            
            // 跳过隐藏图层（如果不包含）
            if (!includeHidden && !layer.visible) {
                continue;
            }

            const node: LayerNode = {
                id: layer.id,
                name: layer.name,
                kind: this.getLayerKind(layer),
                visible: layer.visible,
                locked: layer.locked || false,
                opacity: layer.opacity,
                blendMode: layer.blendMode?.toString() || 'normal',
                isClippingMask: this.isClippingMaskBase(layer, i, layers),
                isClipped: layer.isClippingMask || false,
                parentId: parentId,
                parentName: parentId ? container.name : null,
                index: i,
                depth: parentDepth,
                path: [...parentPath, layer.name].join('/'),
                pathIds: [...parentPathIds, layer.id]
            };

            // 获取边界信息
            if (includeBounds) {
                try {
                    const bounds = layer.bounds;
                    if (bounds) {
                        node.bounds = {
                            left: bounds.left,
                            top: bounds.top,
                            right: bounds.right,
                            bottom: bounds.bottom,
                            width: bounds.right - bounds.left,
                            height: bounds.bottom - bounds.top
                        };
                    }
                } catch (e) {
                    // 某些图层可能没有边界
                }
            }

            // 如果是组，递归获取子图层
            if (layer.layers && layer.layers.length > 0) {
                node.children = this.buildLayerTree(
                    layer,
                    layer.id,
                    parentDepth + 1,
                    0,
                    includeHidden,
                    includeBounds,
                    [...parentPath, layer.name],
                    [...parentPathIds, layer.id]
                );
            }

            nodes.push(node);
        }

        return nodes;
    }

    /**
     * 检查图层是否是剪切蒙版的基底层
     */
    private isClippingMaskBase(layer: any, index: number, layers: any[]): boolean {
        // 如果下一个图层（在上方）是被剪切的，则当前图层是基底层
        if (index > 0) {
            const aboveLayer = layers[index - 1];
            if (aboveLayer && aboveLayer.isClippingMask) {
                return true;
            }
        }
        return false;
    }

    /**
     * 获取图层类型名称
     */
    private getLayerKind(layer: any): string {
        const kind = layer.kind;
        if (!kind) return 'unknown';
        
        // Photoshop LayerKind 枚举映射（数值 -> 名称）
        const kindMap: Record<number, string> = {
            1: 'pixel',
            2: 'adjustment',
            3: 'text',
            4: 'shape',
            5: 'smartObject',
            6: 'video',
            7: 'group',
            8: '3d',
            9: 'gradient',
            10: 'pattern',
            11: 'solidColor',
            12: 'background'
        };

        // Photoshop LayerKind 枚举名称映射（用于处理字符串格式）
        const kindNameMap: Record<string, string> = {
            'PIXEL': 'pixel',
            'ADJUSTMENT': 'adjustment',
            'TEXT': 'text',
            'SOLIDCOLOR': 'solidColor',
            'GRADIENTFILL': 'gradient',
            'PATTERNFILL': 'pattern',
            'SMARTOBJECT': 'smartObject',
            'VIDEO': 'video',
            'LAYER3D': '3d',
            'GROUP': 'group',
            'BACKGROUNDSHEET': 'background',
            // 形状图层的可能名称
            'VECTOR': 'shape',
            'NORMAL': 'pixel'
        };

        // 处理数字类型
        if (typeof kind === 'number') {
            return kindMap[kind] || `type_${kind}`;
        }
        
        // 处理对象类型（例如 { value: 'SMARTOBJECT' } 或 { _value: 4 }）
        if (typeof kind === 'object') {
            // 尝试获取对象的值
            const value = kind.value ?? kind._value ?? kind;
            
            if (typeof value === 'number') {
                return kindMap[value] || `type_${value}`;
            }
            
            if (typeof value === 'string') {
                const upperValue = value.toUpperCase();
                return kindNameMap[upperValue] || value.toLowerCase();
            }
        }
        
        // 处理字符串类型
        if (typeof kind === 'string') {
            // 移除可能的前缀如 "LayerKind."
            const cleanKind = kind.replace(/^LayerKind\./i, '').toUpperCase();
            return kindNameMap[cleanKind] || kind.toLowerCase();
        }
        
        // 最后尝试 toString
        const str = kind.toString();
        const cleanStr = str.replace(/^LayerKind\./i, '').toUpperCase();
        return kindNameMap[cleanStr] || str.toLowerCase();
    }

    /**
     * 将树形结构扁平化
     */
    private flattenTree(nodes: LayerNode[], result: LayerNode[]): void {
        for (const node of nodes) {
            result.push(node);
            if (node.children) {
                this.flattenTree(node.children, result);
            }
        }
    }
}
