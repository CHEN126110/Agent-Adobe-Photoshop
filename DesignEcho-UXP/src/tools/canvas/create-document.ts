/**
 * 创建新文档工具
 * 用于在 Photoshop 中创建新的空白文档
 */

import { Tool, ToolSchema } from '../types';

const { app, core } = require('photoshop');

// 常用文档预设
const DOCUMENT_PRESETS: Record<string, { width: number; height: number; resolution: number; name: string }> = {
    // 电商详情页
    'detail-page': { width: 790, height: 2000, resolution: 72, name: '详情页' },
    'detail-page-large': { width: 790, height: 5000, resolution: 72, name: '详情页(长)' },
    
    // 电商主图
    'main-image': { width: 800, height: 800, resolution: 72, name: '主图' },
    'main-image-hd': { width: 1500, height: 1500, resolution: 72, name: '主图(高清)' },
    
    // 海报
    'poster-a4': { width: 2480, height: 3508, resolution: 300, name: 'A4海报' },
    'poster-square': { width: 1080, height: 1080, resolution: 72, name: '方形海报' },
    
    // 社交媒体
    'wechat-article': { width: 900, height: 500, resolution: 72, name: '公众号封面' },
    'xiaohongshu': { width: 1242, height: 1660, resolution: 72, name: '小红书图片' },
    'douyin': { width: 1080, height: 1920, resolution: 72, name: '抖音竖版' },
    
    // Banner
    'banner-wide': { width: 1920, height: 600, resolution: 72, name: '宽幅Banner' },
    'banner-standard': { width: 750, height: 350, resolution: 72, name: '标准Banner' },
};

interface CreateDocumentParams {
    preset?: string;          // 使用预设
    width?: number;           // 自定义宽度 (像素)
    height?: number;          // 自定义高度 (像素)
    resolution?: number;      // 分辨率 (默认72)
    name?: string;            // 文档名称
    backgroundColor?: 'white' | 'black' | 'transparent';  // 背景色
    colorMode?: 'RGB' | 'CMYK' | 'Grayscale';  // 颜色模式
}

export class CreateDocumentTool implements Tool {
    name = 'createDocument';

    schema: ToolSchema = {
        name: 'createDocument',
        description: `创建新的 Photoshop 文档。可以使用预设或自定义尺寸。

可用预设:
- detail-page: 电商详情页 (790×2000)
- detail-page-large: 长详情页 (790×5000)
- main-image: 电商主图 (800×800)
- main-image-hd: 高清主图 (1500×1500)
- poster-a4: A4海报 (2480×3508, 300dpi)
- poster-square: 方形海报 (1080×1080)
- wechat-article: 公众号封面 (900×500)
- xiaohongshu: 小红书 (1242×1660)
- douyin: 抖音竖版 (1080×1920)
- banner-wide: 宽幅Banner (1920×600)
- banner-standard: 标准Banner (750×350)

使用示例:
- 创建详情页: createDocument({preset: "detail-page"})
- 自定义尺寸: createDocument({width: 1200, height: 800, name: "我的设计"})`,
        parameters: {
            type: 'object',
            properties: {
                preset: {
                    type: 'string',
                    description: '使用预设模板名称'
                },
                width: {
                    type: 'number',
                    description: '宽度(像素)，使用预设时可忽略'
                },
                height: {
                    type: 'number',
                    description: '高度(像素)，使用预设时可忽略'
                },
                resolution: {
                    type: 'number',
                    description: '分辨率(DPI)，默认72'
                },
                name: {
                    type: 'string',
                    description: '文档名称'
                },
                backgroundColor: {
                    type: 'string',
                    enum: ['white', 'black', 'transparent'],
                    description: '背景颜色，默认white'
                },
                colorMode: {
                    type: 'string',
                    enum: ['RGB', 'CMYK', 'Grayscale'],
                    description: '颜色模式，默认RGB'
                }
            }
        }
    };

    async execute(params: CreateDocumentParams): Promise<{
        success: boolean;
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

            // 使用预设或自定义参数
            if (params.preset && DOCUMENT_PRESETS[params.preset]) {
                const preset = DOCUMENT_PRESETS[params.preset];
                width = params.width || preset.width;
                height = params.height || preset.height;
                resolution = params.resolution || preset.resolution;
                docName = params.name || preset.name;
            } else {
                width = params.width || 800;
                height = params.height || 800;
                resolution = params.resolution || 72;
                docName = params.name || '新建文档';
            }

            // 确定背景填充类型
            let fillType = 'white';
            if (params.backgroundColor === 'transparent') {
                fillType = 'transparent';
            } else if (params.backgroundColor === 'black') {
                fillType = 'black';
            }

            // 确定颜色模式
            let mode = 'RGBColorMode';
            if (params.colorMode === 'CMYK') {
                mode = 'CMYKColorMode';
            } else if (params.colorMode === 'Grayscale') {
                mode = 'grayscaleMode';
            }

            // 使用 batchPlay 创建文档
            let newDoc: any = null;
            
            await core.executeAsModal(async () => {
                const result = await require('photoshop').action.batchPlay([
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

                // 获取新创建的文档
                newDoc = app.activeDocument;
            }, { commandName: 'DesignEcho: 创建新文档' });

            if (!newDoc) {
                return {
                    success: false,
                    error: '文档创建失败'
                };
            }

            return {
                success: true,
                document: {
                    id: newDoc.id,
                    name: newDoc.name,
                    width: newDoc.width,
                    height: newDoc.height,
                    resolution: newDoc.resolution
                },
                message: `✅ 已创建文档「${docName}」(${width}×${height}px, ${resolution}dpi)`
            };

        } catch (error) {
            console.error('[CreateDocument] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '创建文档失败'
            };
        }
    }

    /**
     * 获取所有可用预设
     */
    static getPresets(): Record<string, { width: number; height: number; resolution: number; name: string }> {
        return DOCUMENT_PRESETS;
    }
}
