/**
 * 创建文字图层工具
 */

import { app, core, action } from 'photoshop';
import type { Tool } from '../types';

/**
 * 尝试退出 Photoshop 模态状态（如正在编辑文字、有对话框打开等）
 */
async function tryExitModalState(): Promise<boolean> {
    try {
        await core.executeAsModal(async () => {
            await action.batchPlay([
                { _obj: 'select', _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }], makeVisible: false, _options: { dialogOptions: 'dontDisplay' } }
            ], { synchronousExecution: true });
        }, { commandName: 'DesignEcho: 退出模态状态' });
        return true;
    } catch {
        return false;
    }
}

/**
 * 将十六进制颜色转换为 RGB
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
}

export class CreateTextLayerTool implements Tool {
    name = 'createTextLayer';
    schema = {
        name: 'createTextLayer',
        description: '在 Photoshop 中创建新的文字图层。可以指定内容、位置、字号、颜色等。',
        parameters: {
            type: 'object' as const,
            properties: {
                content: {
                    type: 'string',
                    description: '文字内容（别名: text）'
                },
                text: {
                    type: 'string',
                    description: '文字内容（别名: content）'
                },
                x: {
                    type: 'number',
                    description: '文字左上角 X 坐标（像素）'
                },
                y: {
                    type: 'number',
                    description: '文字左上角 Y 坐标（像素）'
                },
                fontSize: {
                    type: 'number',
                    description: '字号（像素，可选，默认24）'
                },
                fontName: {
                    type: 'string',
                    description: '字体名称（可选）'
                },
                colorHex: {
                    type: 'string',
                    description: '文字颜色（十六进制，如 "#000000" 为黑色，可选）'
                },
                color: {
                    type: 'object',
                    description: '文字颜色（RGB对象 { r, g, b }，可选，优先级高于 colorHex）'
                },
                alignment: {
                    type: 'string',
                    enum: ['left', 'center', 'right'],
                    description: '对齐方式（可选）'
                }
            },
            required: ['content', 'x', 'y']
        }
    };

    private _retrying = false;

    async execute(params: {
        content?: string;
        text?: string;
        name?: string;
        x: number;
        y: number;
        fontSize?: number;
        fontName?: string;
        fontWeight?: 'normal' | 'bold';
        colorHex?: string;
        color?: { r: number; g: number; b: number };
        alignment?: 'left' | 'center' | 'right';
    }): Promise<any> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            // 支持 text 作为 content 的别名
            const content = params.content || params.text || '文字';
            const {
                x,
                y,
                fontSize = 24,
                fontName = 'Arial',
                fontWeight = 'normal',
                colorHex = '#000000'
            } = params;
            const alignment = params.alignment || 'left';

            // 优先使用 color 对象，其次使用 colorHex
            const color = params.color || hexToRgb(colorHex);

            console.log(`[CreateTextLayer] 创建文字: "${content}" at (${x}, ${y})`);

            let createdLayerId: number | undefined;
            let createdLayerName: string | undefined;

            // 使用 executeAsModal 包裹 batchPlay 操作
            await core.executeAsModal(async () => {
                await require('photoshop').action.batchPlay([
                    {
                        _obj: 'make',
                        _target: [{ _ref: 'textLayer' }],
                        using: {
                            _obj: 'textLayer',
                            textKey: content,
                            textStyleRange: [{
                                _obj: 'textStyleRange',
                                from: 0,
                                to: content.length,
                                textStyle: {
                                    _obj: 'textStyle',
                                    fontPostScriptName: fontName,
                                    size: { _unit: 'pointsUnit', _value: fontSize },
                                    color: {
                                        _obj: 'RGBColor',
                                        red: color.r,
                                        green: color.g,
                                        blue: color.b
                                    }
                                }
                            }],
                            paragraphStyleRange: [{
                                _obj: 'paragraphStyleRange',
                                from: 0,
                                to: content.length,
                                paragraphStyle: {
                                    _obj: 'paragraphStyle',
                                    align: {
                                        _enum: 'alignmentType',
                                        _value: ['center', 'right'].includes(alignment) ? alignment : 'left'
                                    }
                                }
                            }]
                        },
                        layerID: { _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }
                    },
                    // 移动到指定位置
                    {
                        _obj: 'move',
                        _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                        to: {
                            _obj: 'offset',
                            horizontal: { _unit: 'pixelsUnit', _value: x },
                            vertical: { _unit: 'pixelsUnit', _value: y }
                        }
                    }
                ], { commandName: 'DesignEcho: 创建文字图层' });

                const createdLayer = doc.activeLayers[0];
                createdLayerId = createdLayer?.id;
                createdLayerName = createdLayer?.name;
            }, { commandName: 'DesignEcho: 创建文字图层' });

            return {
                success: true,
                layerId: createdLayerId,
                layerName: createdLayerName,
                content: content,
                message: `文字图层 "${content}" 已创建`
            };

        } catch (error: any) {
            const msg = error?.message || String(error);

            // 如果是模态状态冲突且非重试，尝试退出模态后重试一次
            if ((msg.includes('modal') || msg.includes('Modal')) && !this._retrying) {
                console.warn('[CreateTextLayer] 检测到模态状态冲突，尝试退出后重试...');
                const exited = await tryExitModalState();
                if (exited) {
                    await new Promise(r => setTimeout(r, 200));
                    try {
                        this._retrying = true;
                        return await this.execute(params);
                    } catch (retryError: any) {
                        console.error('[CreateTextLayer] 重试仍然失败:', retryError);
                        return {
                            success: false,
                            error: `创建文字图层失败（已尝试退出模态状态）: ${retryError?.message || '未知错误'}`
                        };
                    } finally {
                        this._retrying = false;
                    }
                }
            }

            console.error('[CreateTextLayer] Error:', error);
            return {
                success: false,
                error: msg || '创建文字图层失败'
            };
        }
    }
}
