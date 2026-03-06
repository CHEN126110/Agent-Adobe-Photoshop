/**
 * 图层变换工具
 * 
 * 支持缩放、旋转、翻转等变换操作
 */

import { Tool, ToolSchema } from '../types';

const { app, core, action } = require('photoshop');

/**
 * 变换图层工具
 */
export class TransformLayerTool implements Tool {
    name = 'transformLayer';

    schema: ToolSchema = {
        name: 'transformLayer',
        description: '变换图层：缩放、旋转、翻转。可以调整图层大小、旋转角度或翻转方向。',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '图层 ID（可选，默认使用当前选中图层）'
                },
                scale: {
                    type: 'object',
                    description: '缩放比例',
                    properties: {
                        x: { type: 'number', description: '水平缩放百分比 (如 50 表示缩小到 50%)' },
                        y: { type: 'number', description: '垂直缩放百分比 (如 50 表示缩小到 50%)' }
                    }
                },
                scaleUniform: {
                    type: 'number',
                    description: '统一缩放百分比（如 80 表示缩小到 80%）'
                },
                rotate: {
                    type: 'number',
                    description: '旋转角度（度数，正值顺时针，负值逆时针）'
                },
                flipHorizontal: {
                    type: 'boolean',
                    description: '是否水平翻转'
                },
                flipVertical: {
                    type: 'boolean',
                    description: '是否垂直翻转'
                },
                fitToCanvas: {
                    type: 'boolean',
                    description: '是否自动适应画布大小'
                },
                fitPercentage: {
                    type: 'number',
                    description: '适应画布时的目标百分比（如 80 表示占画布的 80%）'
                }
            }
        }
    };

    async execute(params: {
        layerId?: number;
        scale?: { x: number; y: number };
        scaleUniform?: number;
        rotate?: number;
        flipHorizontal?: boolean;
        flipVertical?: boolean;
        fitToCanvas?: boolean;
        fitPercentage?: number;
    }): Promise<{
        success: boolean;
        message?: string;
        layerName?: string;
        originalSize?: { width: number; height: number };
        newSize?: { width: number; height: number };
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            // 获取目标图层
            let layer;
            if (params.layerId) {
                // 确保 layerId 是数字类型
                const numericId = typeof params.layerId === 'string' 
                    ? parseInt(params.layerId as unknown as string, 10) 
                    : params.layerId;
                layer = this.findLayerById(doc, numericId);
                if (!layer) {
                    return { success: false, error: `未找到 ID 为 ${numericId} 的图层` };
                }
            } else {
                layer = doc.activeLayers[0];
                if (!layer) {
                    return { success: false, error: '没有选中的图层' };
                }
            }

            console.log(`[TransformLayer] 变换图层: ${layer.name} (ID: ${layer.id})`);

            // 获取原始尺寸
            const bounds = layer.bounds;
            const originalWidth = bounds.right - bounds.left;
            const originalHeight = bounds.bottom - bounds.top;

            console.log(`[TransformLayer] 原始尺寸: ${originalWidth}x${originalHeight}`);

            // 选中目标图层（UXP API）
            try {
                // 方法1: 使用 batchPlay 选择图层
                await action.batchPlay([{
                    _obj: 'select',
                    _target: [{ _ref: 'layer', _id: layer.id }],
                    makeVisible: false,
                    _options: { dialogOptions: 'dontDisplay' }
                }], { synchronousExecution: true });
            } catch (selectErr) {
                console.warn('[TransformLayer] 图层选择警告:', selectErr);
                // 忽略选择错误，继续尝试变换
            }

            let scaleX = 100;
            let scaleY = 100;
            let rotateAngle = 0;

            // 处理适应画布
            if (params.fitToCanvas) {
                const targetPercent = params.fitPercentage || 80;
                const canvasWidth = doc.width;
                const canvasHeight = doc.height;
                
                // 计算缩放比例以适应画布
                const scaleToFitWidth = (canvasWidth * targetPercent / 100) / originalWidth * 100;
                const scaleToFitHeight = (canvasHeight * targetPercent / 100) / originalHeight * 100;
                const uniformScale = Math.min(scaleToFitWidth, scaleToFitHeight);
                
                scaleX = uniformScale;
                scaleY = uniformScale;
                console.log(`[TransformLayer] 适应画布: ${targetPercent}% → 缩放 ${uniformScale.toFixed(1)}%`);
            }
            // 处理统一缩放
            else if (params.scaleUniform !== undefined) {
                scaleX = params.scaleUniform;
                scaleY = params.scaleUniform;
            }
            // 处理独立缩放
            else if (params.scale) {
                scaleX = params.scale.x ?? 100;
                scaleY = params.scale.y ?? 100;
            }

            // 处理旋转
            if (params.rotate !== undefined) {
                rotateAngle = params.rotate;
            }

            // 执行变换
            await core.executeAsModal(async () => {
                // ★ 优先使用 UXP DOM API 的 resize 方法（更可靠，不会触发"变换不可用"错误）
                let useResizeMethod = true;
                
                // 如果有旋转或翻转，需要使用 batchPlay
                if (rotateAngle !== 0 || params.flipHorizontal || params.flipVertical) {
                    useResizeMethod = false;
                }
                
                // 执行缩放
                if (scaleX !== 100 || scaleY !== 100) {
                    if (useResizeMethod) {
                        // 方法1: 使用 layer.resize()（更可靠）
                        try {
                            // resize 接受百分比参数
                            await layer.resize(scaleX, scaleY);
                            console.log(`[TransformLayer] ✓ 使用 resize() 缩放: ${scaleX}% x ${scaleY}%`);
                        } catch (resizeErr: any) {
                            console.warn('[TransformLayer] resize() 失败，尝试 batchPlay:', resizeErr.message);
                            useResizeMethod = false;
                        }
                    }
                    
                    if (!useResizeMethod) {
                        // 方法2: 使用 batchPlay（备选）
                        const transformDescriptor: any = {
                            _obj: 'transform',
                            freeTransformCenterState: {
                                _enum: 'quadCenterState',
                                _value: 'QCSAverage'
                            },
                            width: { _unit: 'percentUnit', _value: scaleX },
                            height: { _unit: 'percentUnit', _value: scaleY },
                            _options: { dialogOptions: 'dontDisplay' }
                        };
                        
                        // 添加旋转
                        if (rotateAngle !== 0) {
                            transformDescriptor.angle = { _unit: 'angleUnit', _value: rotateAngle };
                        }
                        
                        await action.batchPlay([transformDescriptor], { synchronousExecution: true });
                        console.log(`[TransformLayer] ✓ 使用 batchPlay 变换: ${scaleX}% x ${scaleY}%, 旋转 ${rotateAngle}°`);
                    }
                }

                // 处理翻转（需要使用 batchPlay）
                if (params.flipHorizontal) {
                    await action.batchPlay([
                        {
                            _obj: 'flip',
                            axis: { _enum: 'orientation', _value: 'horizontal' },
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });
                }

                if (params.flipVertical) {
                    await action.batchPlay([
                        {
                            _obj: 'flip',
                            axis: { _enum: 'orientation', _value: 'vertical' },
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });
                }

            }, { commandName: '变换图层' });

            // 获取新尺寸
            const newBounds = layer.bounds;
            const newWidth = newBounds.right - newBounds.left;
            const newHeight = newBounds.bottom - newBounds.top;

            const message = this.buildMessage(params, scaleX, scaleY, rotateAngle, originalWidth, originalHeight, newWidth, newHeight);

            return {
                success: true,
                message,
                layerName: layer.name,
                originalSize: { width: originalWidth, height: originalHeight },
                newSize: { width: Math.round(newWidth), height: Math.round(newHeight) }
            };

        } catch (error: any) {
            console.error('[TransformLayer] 错误:', error);
            return { success: false, error: error.message || '变换失败' };
        }
    }

    /**
     * 构建结果消息
     */
    private buildMessage(
        params: any,
        scaleX: number,
        scaleY: number,
        rotateAngle: number,
        origW: number,
        origH: number,
        newW: number,
        newH: number
    ): string {
        const parts: string[] = [];

        if (params.fitToCanvas) {
            parts.push(`适应画布 (${params.fitPercentage || 80}%)`);
        } else if (scaleX !== 100 || scaleY !== 100) {
            if (scaleX === scaleY) {
                parts.push(`缩放 ${scaleX}%`);
            } else {
                parts.push(`缩放 ${scaleX}% × ${scaleY}%`);
            }
        }

        if (rotateAngle !== 0) {
            parts.push(`旋转 ${rotateAngle}°`);
        }

        if (params.flipHorizontal) {
            parts.push('水平翻转');
        }

        if (params.flipVertical) {
            parts.push('垂直翻转');
        }

        const action = parts.length > 0 ? parts.join('，') : '无变换';
        return `${action}。尺寸: ${Math.round(origW)}×${Math.round(origH)} → ${Math.round(newW)}×${Math.round(newH)}`;
    }

    /**
     * 递归查找图层
     */
    private findLayerById(container: any, id: number): any {
        for (const layer of container.layers) {
            if (layer.id === id) return layer;
            if (layer.layers) {
                const found = this.findLayerById(layer, id);
                if (found) return found;
            }
        }
        return null;
    }
}

/**
 * 快速缩放工具 - 简化版
 */
export class QuickScaleTool implements Tool {
    name = 'quickScale';

    schema: ToolSchema = {
        name: 'quickScale',
        description: '快速缩放当前图层。输入百分比即可，如 50 表示缩小到一半，200 表示放大一倍。',
        parameters: {
            type: 'object',
            properties: {
                percent: {
                    type: 'number',
                    description: '缩放百分比（如 50 表示缩小到 50%，200 表示放大到 200%）'
                },
                fitCanvas: {
                    type: 'boolean',
                    description: '是否自动适应画布（忽略 percent 参数）'
                }
            },
            required: ['percent']
        }
    };

    async execute(params: {
        percent?: number;
        fitCanvas?: boolean;
    }): Promise<any> {
        const transformTool = new TransformLayerTool();
        
        if (params.fitCanvas) {
            return transformTool.execute({
                fitToCanvas: true,
                fitPercentage: 80
            });
        }
        
        return transformTool.execute({
            scaleUniform: params.percent || 100
        });
    }
}

export default TransformLayerTool;
