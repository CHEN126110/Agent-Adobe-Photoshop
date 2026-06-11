/**
 * 创建新文档工具
 */

import { Tool, ToolSchema } from '../types';

const { app, core } = require('photoshop');

const DOCUMENT_PRESETS: Record<string, { width: number; height: number; resolution: number; name: string }> = {
    'detail-page': { width: 790, height: 2000, resolution: 72, name: '详情页' },
    'detail-page-large': { width: 790, height: 5000, resolution: 72, name: '长详情页' },
    'main-image': { width: 800, height: 800, resolution: 72, name: '主图' },
    'main-image-hd': { width: 1500, height: 1500, resolution: 72, name: '主图（高清）' },
    'poster-a4': { width: 2480, height: 3508, resolution: 300, name: 'A4 海报' },
    'poster-square': { width: 1080, height: 1080, resolution: 72, name: '方形海报' },
    'wechat-article': { width: 900, height: 500, resolution: 72, name: '公众号封面' },
    'xiaohongshu': { width: 1242, height: 1660, resolution: 72, name: '小红书图片' },
    'douyin': { width: 1080, height: 1920, resolution: 72, name: '抖音竖版' },
    'banner-wide': { width: 1920, height: 600, resolution: 72, name: '宽幅 Banner' },
    'banner-standard': { width: 750, height: 350, resolution: 72, name: '标准 Banner' }
};

interface CreateDocumentParams {
    preset?: string;
    width?: number;
    height?: number;
    resolution?: number;
    name?: string;
    backgroundColor?: 'white' | 'black' | 'transparent';
    colorMode?: 'RGB' | 'CMYK' | 'Grayscale';
}

function isPositiveNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export class CreateDocumentTool implements Tool {
    name = 'createDocument';

    schema: ToolSchema = {
        name: 'createDocument',
        description: '在 Photoshop 中创建新文档。支持使用预设尺寸，或传入 width/height/resolution 自定义创建。',
        parameters: {
            type: 'object',
            properties: {
                preset: {
                    type: 'string',
                    description: '预设名称，例如 detail-page、main-image、poster-a4。'
                },
                width: {
                    type: 'number',
                    description: '文档宽度（像素）。如果提供 preset，可用来覆盖预设宽度。'
                },
                height: {
                    type: 'number',
                    description: '文档高度（像素）。如果提供 preset，可用来覆盖预设高度。'
                },
                resolution: {
                    type: 'number',
                    description: '文档分辨率（DPI）。默认 72。'
                },
                name: {
                    type: 'string',
                    description: '文档名称。'
                },
                backgroundColor: {
                    type: 'string',
                    enum: ['white', 'black', 'transparent'],
                    description: '背景填充类型。默认 white。'
                },
                colorMode: {
                    type: 'string',
                    enum: ['RGB', 'CMYK', 'Grayscale'],
                    description: '颜色模式。默认 RGB。'
                }
            }
        }
    };

    async execute(params: CreateDocumentParams): Promise<{
        success: boolean;
        entityType?: 'document';
        documentId?: number;
        name?: string;
        width?: number;
        height?: number;
        resolution?: number;
        document?: {
            id: number;
            name: string;
            width: number;
            height: number;
            resolution: number;
        };
        message?: string;
        error?: string;
    }> {
        try {
            let width: number;
            let height: number;
            let resolution: number;
            let docName: string;

            if (params.preset && DOCUMENT_PRESETS[params.preset]) {
                const preset = DOCUMENT_PRESETS[params.preset];
                width = params.width ?? preset.width;
                height = params.height ?? preset.height;
                resolution = params.resolution ?? preset.resolution;
                docName = params.name?.trim() || preset.name;
            } else {
                width = params.width ?? 800;
                height = params.height ?? 800;
                resolution = params.resolution ?? 72;
                docName = params.name?.trim() || '新建文档';
            }

            if (!isPositiveNumber(width) || !isPositiveNumber(height)) {
                return {
                    success: false,
                    error: 'createDocument failed: width and height must be greater than 0.'
                };
            }

            if (!isPositiveNumber(resolution)) {
                return {
                    success: false,
                    error: 'createDocument failed: resolution must be greater than 0.'
                };
            }

            const fillType = params.backgroundColor === 'transparent'
                ? 'transparent'
                : params.backgroundColor === 'black'
                    ? 'black'
                    : 'white';

            const mode = params.colorMode === 'CMYK'
                ? 'CMYKColorMode'
                : params.colorMode === 'Grayscale'
                    ? 'grayscaleMode'
                    : 'RGBColorMode';

            let newDoc: any = null;

            await core.executeAsModal(async () => {
                await require('photoshop').action.batchPlay([
                    {
                        _obj: 'make',
                        new: {
                            _obj: 'document',
                            name: docName,
                            artboard: false,
                            autoPromoteBackgroundLayer: false,
                            mode: {
                                _class: mode
                            },
                            width: {
                                _unit: 'pixelsUnit',
                                _value: width
                            },
                            height: {
                                _unit: 'pixelsUnit',
                                _value: height
                            },
                            resolution: {
                                _unit: 'densityUnit',
                                _value: resolution
                            },
                            fill: {
                                _enum: 'fill',
                                _value: fillType
                            },
                            depth: 8,
                            profile: 'sRGB IEC61966-2.1'
                        }
                    }
                ], {});

                newDoc = app.activeDocument;
            }, { commandName: 'DesignEcho: 创建文档' });

            if (!newDoc || typeof newDoc.id !== 'number') {
                return {
                    success: false,
                    error: 'createDocument failed: unable to read the created document.'
                };
            }

            const resultDocument = {
                id: newDoc.id,
                name: newDoc.name || docName,
                width,
                height,
                resolution
            };

            return {
                success: true,
                entityType: 'document',
                documentId: resultDocument.id,
                name: resultDocument.name,
                width: resultDocument.width,
                height: resultDocument.height,
                resolution: resultDocument.resolution,
                document: resultDocument,
                message: `Created document "${resultDocument.name}" (${width}x${height}px @ ${resolution}dpi).`
            };
        } catch (error) {
            console.error('[CreateDocument] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'createDocument failed'
            };
        }
    }

    static getPresets(): Record<string, { width: number; height: number; resolution: number; name: string }> {
        return DOCUMENT_PRESETS;
    }
}

