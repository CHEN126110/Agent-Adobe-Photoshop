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

import { observeActiveDocumentAtHistoryState } from '../../core/photoshop-document-observation';
import type { PhotoshopHistoryStateRef } from '../../core/photoshop-history-state-ref';
import { Tool, ToolSchema } from '../types';
import {
    encodePhotoshopImageDataAsJpeg,
    toSnapshotErrorMessage
} from './snapshot-encoding';

const { imaging } = require('photoshop');

/**
 * 图层边界信息（用于标注）
 */
interface LayerBounds {
    id: number;
    index: number;           // 标注编号（从 1 开始）
    name: string;
    parentId: number | null;
    ancestorNames: string[];
    path: string;
    depth: number;
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
- snapshotSize: 截图尺寸（用于计算缩放比例）
- region: 实际截取区域（文档像素坐标 {x,y,width,height}）
- historyStateRef: 截图与图层映射共同绑定的 Photoshop 文档历史版本`,
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
                },
                region: {
                    type: 'object',
                    description: '只截取并标注文档中的一个区域（文档像素坐标 {x,y,width,height}）。长文档（如详情页）必用：全图缩放会小到不可读，且超大文档全图取像素可能直接失败',
                    properties: {
                        x: { type: 'number', description: '区域左上角 X 坐标（文档像素）' },
                        y: { type: 'number', description: '区域左上角 Y 坐标（文档像素）' },
                        width: { type: 'number', description: '区域宽度（文档像素）' },
                        height: { type: 'number', description: '区域高度（文档像素）' }
                    }
                }
            }
        }
    };

    async execute(params: {
        maxWidth?: number;
        maxHeight?: number;
        includeHidden?: boolean;
        layerFilter?: 'all' | 'visual' | 'text';
        region?: { x?: number; y?: number; width?: number; height?: number };
    }): Promise<{
        success: boolean;
        imageData?: string;
        layers?: LayerBounds[];
        documentSize?: { width: number; height: number };
        snapshotSize?: { width: number; height: number };
        region?: { x: number; y: number; width: number; height: number };
        historyStateRef?: PhotoshopHistoryStateRef;
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
        let observedDocumentSize: { width: number; height: number } | undefined;
        try {
            const maxWidth = params.maxWidth || 1200;
            const maxHeight = params.maxHeight || 900;
            const includeHidden = params.includeHidden || false;
            const layerFilter = params.layerFilter || 'visual';
            const observation = await observeActiveDocumentAtHistoryState({
                commandName: 'DesignEcho: 获取标注截图',
                timeOut: 5,
                unavailableMessage: '无法读取 Photoshop 文档历史版本，未返回可能过期的标注截图。',
                changedMessage: '标注截图读取期间 Photoshop 文档发生变化，已丢弃图像与图层映射不一致的结果。'
            }, async (doc) => {

            // 1. 获取文档尺寸和计算缩放
            const docWidth = Number(doc.width);
            const docHeight = Number(doc.height);
            observedDocumentSize = { width: docWidth, height: docHeight };

            // 区域观察（2026-07-07）：长文档全图缩放小到不可读且大像素读取易失败——
            // region 只截取并标注文档中的一个区间，坐标/缩放均相对该区间
            let regionRect: { x: number; y: number; width: number; height: number } | null = null;
            if (params.region && Number(params.region.width) > 0 && Number(params.region.height) > 0) {
                const rx = Math.max(0, Math.min(docWidth - 1, Math.round(Number(params.region.x) || 0)));
                const ry = Math.max(0, Math.min(docHeight - 1, Math.round(Number(params.region.y) || 0)));
                const rw = Math.min(docWidth - rx, Math.round(Number(params.region.width)));
                const rh = Math.min(docHeight - ry, Math.round(Number(params.region.height)));
                if (rw > 0 && rh > 0) {
                    regionRect = { x: rx, y: ry, width: rw, height: rh };
                }
            }
            const viewWidth = regionRect ? regionRect.width : docWidth;
            const viewHeight = regionRect ? regionRect.height : docHeight;
            const viewX = regionRect ? regionRect.x : 0;
            const viewY = regionRect ? regionRect.y : 0;
            const scale = Math.min(maxWidth / viewWidth, maxHeight / viewHeight, 1);
            const targetWidth = Math.round(viewWidth * scale);
            const targetHeight = Math.round(viewHeight * scale);

            // 2. 获取画布截图。外层稳定观察区间已在 executeAsModal 内，
            // 图像读取、图层映射和前后历史校验共享同一个 Host 版本。
            // 统一把 Photoshop 8/16/32 位像素规范化为 RGB8 后编码，避免原始
            // imageData 因位深或 alpha 差异导致 encodeImageData 偶发失败。
            let base64 = '';
            const pixelData = await imaging.getPixels({
                documentID: doc.id,
                ...(regionRect ? {
                    sourceBounds: {
                        left: regionRect.x,
                        top: regionRect.y,
                        right: regionRect.x + regionRect.width,
                        bottom: regionRect.y + regionRect.height
                    }
                } : {}),
                targetSize: {
                    width: targetWidth,
                    height: targetHeight
                },
                colorSpace: 'RGB',
                componentSize: 8,
                applyAlpha: true,
            });
            try {
                const encoded = await encodePhotoshopImageDataAsJpeg(
                    pixelData.imageData,
                    targetWidth,
                    targetHeight
                );
                base64 = encoded.base64;
            } finally {
                pixelData.imageData.dispose();
            }

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
            const processLayers = (
                layerList: any[],
                depth: number = 0,
                ancestorNames: string[] = [],
                parentId: number | null = null
            ) => {
                for (const layer of layerList) {
                    // 跳过隐藏图层
                    if (!includeHidden && !layer.visible) continue;

                    // 获取图层类型
                    const kind = this.getLayerKind(layer);
                    const layerName = layer.name || `Layer ${layer.id}`;
                    const childAncestorNames = [...ancestorNames, layerName];
                    
                    // 根据过滤器筛选
                    if (layerFilter === 'text' && kind !== 'text') {
                        // 如果是组，继续递归
                        if (kind === 'group' && layer.layers) {
                            processLayers(layer.layers, depth + 1, childAncestorNames, Number(layer.id));
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
                            // region 模式：只标注与区域相交的图层（区域外的层与本次观察无关）
                            if (regionRect && (bounds.right <= viewX || bounds.left >= viewX + viewWidth
                                || bounds.bottom <= viewY || bounds.top >= viewY + viewHeight)) {
                                if (kind === 'group' && layer.layers) {
                                    processLayers(layer.layers, depth + 1, childAncestorNames, Number(layer.id));
                                }
                                continue;
                            }
                            const layerInfo: LayerBounds = {
                                id: layer.id,
                                index: index++,
                                name: layerName,
                                parentId,
                                ancestorNames,
                                path: [...ancestorNames, layerName].join('/'),
                                depth,
                                kind: kind,
                                visible: layer.visible,
                                bounds: {
                                    // 转换为截图坐标系（region 模式下相对区域原点）
                                    left: Math.round((bounds.left - viewX) * scale),
                                    top: Math.round((bounds.top - viewY) * scale),
                                    right: Math.round((bounds.right - viewX) * scale),
                                    bottom: Math.round((bounds.bottom - viewY) * scale),
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
                        processLayers(layer.layers, depth + 1, childAncestorNames, Number(layer.id));
                    }
                }
            };

            processLayers(doc.layers);

            return {
                imageData: base64,
                layers: layers,
                documentSize: { width: docWidth, height: docHeight },
                snapshotSize: { width: targetWidth, height: targetHeight },
                ...(regionRect ? { region: regionRect } : {}),
                scale: scale,
                summary: summary
            };
            });

            return {
                success: true,
                ...observation.value,
                historyStateRef: observation.historyStateRef
            };

        } catch (error) {
            console.error('[GetAnnotatedSnapshot] Error:', error);
            // 失败信息必须指路（真机病例：只回「获取标注截图失败」，模型只能反复裸调）：
            // 大文档全图取像素是最常见失败因，region 是出口
            let message = toSnapshotErrorMessage(error, '获取标注截图失败');
            if (observedDocumentSize
                && !params.region
                && (observedDocumentSize.height > 8000 || observedDocumentSize.width > 8000)) {
                message = `获取标注截图失败：文档 ${observedDocumentSize.width}x${observedDocumentSize.height}px 过大，全图取像素超出能力。请带 region 参数只标注目标区域（如 {x:0, y:目标屏起点, width:${observedDocumentSize.width}, height:屏高}）；目标区域可先用 getLayerBounds/findLayers 读到。原始错误：${message}`;
            }
            return {
                success: false,
                error: message
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

}
