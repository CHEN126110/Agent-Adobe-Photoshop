/**
 * 获取文档信息工具
 */

import { Tool, ToolSchema, DocumentInfo } from '../types';

const app = require('photoshop').app;

export class GetDocumentInfoTool implements Tool {
    name = 'getDocumentInfo';

    schema: ToolSchema = {
        name: 'getDocumentInfo',
        description: '获取当前文档的基本信息（尺寸、分辨率、颜色模式等）',
        parameters: {
            type: 'object',
            properties: {}
        }
    };

    async execute(_params: {}): Promise<{
        success: boolean;
        document?: DocumentInfo;
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            // 统计图层数量
            let layerCount = 0;
            this.countLayers(doc, (count) => { layerCount = count; });

            const documentInfo: DocumentInfo = {
                id: doc.id,
                name: doc.name,
                width: doc.width,
                height: doc.height,
                resolution: doc.resolution,
                colorMode: this.getColorModeName(doc.mode),
                layerCount
            };

            return {
                success: true,
                document: documentInfo
            };

        } catch (error) {
            console.error('[GetDocumentInfo] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '获取文档信息失败'
            };
        }
    }

    /**
     * 递归统计图层数量
     */
    private countLayers(container: any, callback: (count: number) => void): number {
        let count = 0;
        for (const layer of container.layers) {
            count++;
            if (layer.layers) {
                count += this.countLayers(layer, () => {});
            }
        }
        callback(count);
        return count;
    }

    /**
     * 获取颜色模式名称
     */
    private getColorModeName(mode: any): string {
        const modeMap: Record<string, string> = {
            'RGBColorMode': 'RGB',
            'CMYKColorMode': 'CMYK',
            'grayscaleMode': '灰度',
            'bitmapMode': '位图',
            'labColorMode': 'Lab',
            'indexedColorMode': '索引颜色',
            'duotoneMode': '双色调'
        };
        return modeMap[mode] || mode?.toString() || '未知';
    }
}
