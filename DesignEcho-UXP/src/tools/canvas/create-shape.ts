/**
 * 创建形状工具
 * 
 * 支持创建矩形、圆形等基础形状图层
 */

import { app, core } from 'photoshop';
import type { Tool } from '../types';

/**
 * 将十六进制颜色转换为 RGB
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 128, g: 128, b: 128 };
}

/**
 * 创建矩形形状
 */
export class CreateRectangleTool implements Tool {
    name = 'createRectangle';
    schema = {
        name: 'createRectangle',
        description: '在 Photoshop 中创建矩形形状图层。可以指定位置、尺寸、填充颜色等。',
        parameters: {
            type: 'object' as const,
            properties: {
                name: {
                    type: 'string',
                    description: '矩形图层的名称（可选）'
                },
                x: {
                    type: 'number',
                    description: '矩形左上角 X 坐标（像素）'
                },
                y: {
                    type: 'number',
                    description: '矩形左上角 Y 坐标（像素）'
                },
                width: {
                    type: 'number',
                    description: '矩形宽度（像素）'
                },
                height: {
                    type: 'number',
                    description: '矩形高度（像素）'
                },
                fillColorHex: {
                    type: 'string',
                    description: '填充颜色（十六进制，如 "#FF0000" 为红色，可选，默认灰色）'
                },
                color: {
                    type: 'object',
                    description: '填充颜色（RGB对象 { r, g, b }，可选，优先级高于 fillColorHex）'
                },
                strokeWidth: {
                    type: 'number',
                    description: '描边宽度（像素，可选）'
                },
                cornerRadius: {
                    type: 'number',
                    description: '圆角半径（像素，可选，默认0）'
                }
            },
            required: ['x', 'y', 'width', 'height']
        }
    };

    async execute(params: {
        name?: string;
        x: number;
        y: number;
        width: number;
        height: number;
        fillColorHex?: string;
        color?: { r: number; g: number; b: number };
        strokeWidth?: number;
        cornerRadius?: number;
    }): Promise<any> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            const {
                name = '矩形',
                x,
                y,
                width,
                height,
                fillColorHex = '#808080',
                color,
                strokeWidth = 0,
                cornerRadius = 0
            } = params;

            // 优先使用 color 对象，其次使用 fillColorHex
            const fillColor = color || hexToRgb(fillColorHex);

            console.log(`[CreateRectangle] 创建矩形: ${width}x${height} at (${x}, ${y})`);

            // 构建矩形路径
            const left = x;
            const top = y;
            const right = x + width;
            const bottom = y + height;

            let createdLayerId: number | undefined;

            if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(right) || !Number.isFinite(bottom)) {
                return { success: false, error: '矩形参数无效（坐标或尺寸不是有效数字）' };
            }
            if (width <= 0 || height <= 0) {
                return { success: false, error: '矩形参数无效（width/height 必须大于 0）' };
            }
            if (!Number.isFinite(cornerRadius) || cornerRadius < 0) {
                return { success: false, error: '矩形参数无效（cornerRadius 必须为非负数）' };
            }

            const rectangleShape: any = {
                _obj: 'rectangle',
                unitValueQuadVersion: 1,
                top: { _unit: 'pixelsUnit', _value: top },
                left: { _unit: 'pixelsUnit', _value: left },
                bottom: { _unit: 'pixelsUnit', _value: bottom },
                right: { _unit: 'pixelsUnit', _value: right }
            };
            if (cornerRadius > 0) {
                const radius = { _unit: 'pixelsUnit', _value: cornerRadius };
                rectangleShape.topRight = radius;
                rectangleShape.topLeft = radius;
                rectangleShape.bottomRight = radius;
                rectangleShape.bottomLeft = radius;
            }

            // 使用 executeAsModal 包裹 batchPlay 操作
            await core.executeAsModal(async () => {
                await require('photoshop').action.batchPlay([
                    {
                        _obj: 'make',
                        _target: [{ _ref: 'contentLayer' }],
                        using: {
                            _obj: 'contentLayer',
                            type: {
                                _obj: 'solidColorLayer',
                                color: {
                                    _obj: 'RGBColor',
                                    red: fillColor.r,
                                    green: fillColor.g,
                                    blue: fillColor.b
                                }
                            },
                            shape: {
                                ...rectangleShape
                            }
                        }
                    },
                    // 重命名图层
                    {
                        _obj: 'set',
                        _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                        to: {
                            _obj: 'layer',
                            name: name
                        }
                    }
                ], { commandName: 'DesignEcho: 创建矩形' });

                createdLayerId = doc.activeLayers[0]?.id;
            }, { commandName: 'DesignEcho: 创建矩形' });

            return {
                success: true,
                layerId: createdLayerId,
                layerName: name,
                message: `矩形 "${name}" 已创建，位置: (${x}, ${y})，尺寸: ${width}x${height}`
            };

        } catch (error) {
            console.error('[CreateRectangle] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '创建矩形失败'
            };
        }
    }
}

/**
 * 创建椭圆形状
 */
export class CreateEllipseTool implements Tool {
    name = 'createEllipse';
    schema = {
        name: 'createEllipse',
        description: '在 Photoshop 中创建椭圆/圆形形状图层。',
        parameters: {
            type: 'object' as const,
            properties: {
                name: {
                    type: 'string',
                    description: '椭圆图层的名称（可选）'
                },
                x: {
                    type: 'number',
                    description: '椭圆中心 X 坐标（像素）'
                },
                y: {
                    type: 'number',
                    description: '椭圆中心 Y 坐标（像素）'
                },
                width: {
                    type: 'number',
                    description: '椭圆宽度（像素）'
                },
                height: {
                    type: 'number',
                    description: '椭圆高度（像素）'
                },
                fillColorHex: {
                    type: 'string',
                    description: '填充颜色（十六进制，如 "#FF0000"，可选）'
                }
            },
            required: ['x', 'y', 'width', 'height']
        }
    };

    async execute(params: {
        name?: string;
        x: number;
        y: number;
        width: number;
        height: number;
        fillColorHex?: string;
    }): Promise<any> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            const {
                name = '椭圆',
                x,
                y,
                width,
                height,
                fillColorHex = '#808080'
            } = params;

            const fillColor = hexToRgb(fillColorHex);

            // 计算椭圆的边界框
            const left = x - width / 2;
            const top = y - height / 2;
            const right = x + width / 2;
            const bottom = y + height / 2;

            let createdLayerId: number | undefined;

            // 使用 executeAsModal 包裹 batchPlay 操作
            await core.executeAsModal(async () => {
                await require('photoshop').action.batchPlay([
                    {
                        _obj: 'make',
                        _target: [{ _ref: 'contentLayer' }],
                        using: {
                            _obj: 'contentLayer',
                            type: {
                                _obj: 'solidColorLayer',
                                color: {
                                    _obj: 'RGBColor',
                                    red: fillColor.r,
                                    green: fillColor.g,
                                    blue: fillColor.b
                                }
                            },
                            shape: {
                                _obj: 'ellipse',
                                unitValueQuadVersion: 1,
                                top: { _unit: 'pixelsUnit', _value: top },
                                left: { _unit: 'pixelsUnit', _value: left },
                                bottom: { _unit: 'pixelsUnit', _value: bottom },
                                right: { _unit: 'pixelsUnit', _value: right }
                            }
                        }
                    },
                    {
                        _obj: 'set',
                        _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                        to: {
                            _obj: 'layer',
                            name: name
                        }
                    }
                ], { commandName: 'DesignEcho: 创建椭圆' });

                createdLayerId = doc.activeLayers[0]?.id;
            }, { commandName: 'DesignEcho: 创建椭圆' });

            return {
                success: true,
                layerId: createdLayerId,
                layerName: name,
                message: `椭圆 "${name}" 已创建`
            };

        } catch (error) {
            console.error('[CreateEllipse] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '创建椭圆失败'
            };
        }
    }
}
