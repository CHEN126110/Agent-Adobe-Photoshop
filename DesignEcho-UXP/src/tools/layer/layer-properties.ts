/**
 * 图层属性工具
 * 
 * P0 优先级 - 基础能力
 * - setLayerOpacity: 设置图层不透明度
 * - setBlendMode: 设置混合模式
 * - setLayerFill: 设置图层填充
 * - duplicateLayer: 复制图层
 * - deleteLayer: 删除图层
 * - lockLayer: 锁定/解锁图层
 */

import { Tool, ToolSchema } from '../types';

const photoshop = require('photoshop');
const { app, action } = photoshop;
const { executeAsModal } = photoshop.core;

// ==================== 设置图层不透明度 ====================

export class SetLayerOpacityTool implements Tool {
    name = 'setLayerOpacity';
    
    schema: ToolSchema = {
        name: 'setLayerOpacity',
        description: '设置图层不透明度（0-100%）',
        parameters: {
            type: 'object',
            properties: {
                opacity: {
                    type: 'number',
                    description: '不透明度百分比（0-100）'
                },
                layerId: {
                    type: 'number',
                    description: '目标图层 ID（可选，默认当前选中）'
                }
            },
            required: ['opacity']
        }
    };
    
    async execute(params: { opacity: number; layerId?: number }): Promise<string> {
        const doc = app.activeDocument;
        if (!doc) {
            return JSON.stringify({ success: false, error: '没有打开的文档' });
        }
        
        try {
            const layer = params.layerId 
                ? doc.layers.find((l: any) => l.id === params.layerId)
                : doc.activeLayers[0];
                
            if (!layer) {
                return JSON.stringify({ success: false, error: '未找到指定图层' });
            }
            
            const opacity = Math.max(0, Math.min(100, params.opacity));
            
            await executeAsModal(async () => {
                layer.opacity = opacity;
            }, { commandName: '设置图层不透明度' });
            
            return JSON.stringify({
                success: true,
                layerName: layer.name,
                opacity: opacity
            });
        } catch (error: any) {
            return JSON.stringify({ success: false, error: error.message });
        }
    }
}

// ==================== 设置混合模式 ====================

/**
 * Photoshop 支持的混合模式
 */
const BLEND_MODES = [
    'normal', 'dissolve',
    'darken', 'multiply', 'colorBurn', 'linearBurn', 'darkerColor',
    'lighten', 'screen', 'colorDodge', 'linearDodge', 'lighterColor',
    'overlay', 'softLight', 'hardLight', 'vividLight', 'linearLight', 'pinLight', 'hardMix',
    'difference', 'exclusion', 'subtract', 'divide',
    'hue', 'saturation', 'color', 'luminosity'
];

export class SetBlendModeTool implements Tool {
    name = 'setBlendMode';
    
    schema: ToolSchema = {
        name: 'setBlendMode',
        description: '设置图层混合模式（normal, multiply, screen, overlay, softLight, hardLight, colorDodge, colorBurn, difference, exclusion 等）',
        parameters: {
            type: 'object',
            properties: {
                blendMode: {
                    type: 'string',
                    description: '混合模式名称'
                },
                layerId: {
                    type: 'number',
                    description: '目标图层 ID（可选）'
                }
            },
            required: ['blendMode']
        }
    };
    
    async execute(params: { blendMode: string; layerId?: number }): Promise<string> {
        const doc = app.activeDocument;
        if (!doc) {
            return JSON.stringify({ success: false, error: '没有打开的文档' });
        }
        
        try {
            const layer = params.layerId 
                ? doc.layers.find((l: any) => l.id === params.layerId)
                : doc.activeLayers[0];
                
            if (!layer) {
                return JSON.stringify({ success: false, error: '未找到指定图层' });
            }
            
            // 验证混合模式
            const mode = params.blendMode.toLowerCase();
            if (!BLEND_MODES.includes(mode)) {
                return JSON.stringify({ 
                    success: false, 
                    error: `不支持的混合模式: ${params.blendMode}`,
                    availableModes: BLEND_MODES
                });
            }
            
            await executeAsModal(async () => {
                layer.blendMode = mode;
            }, { commandName: '设置混合模式' });
            
            return JSON.stringify({
                success: true,
                layerName: layer.name,
                blendMode: mode
            });
        } catch (error: any) {
            return JSON.stringify({ success: false, error: error.message });
        }
    }
}

// ==================== 设置图层填充颜色 ====================

export class SetLayerFillTool implements Tool {
    name = 'setLayerFill';
    
    schema: ToolSchema = {
        name: 'setLayerFill',
        description: '设置形状图层的填充颜色',
        parameters: {
            type: 'object',
            properties: {
                color: {
                    type: 'object',
                    description: 'RGB 颜色值 { r: 0-255, g: 0-255, b: 0-255 }'
                },
                layerId: {
                    type: 'number',
                    description: '目标图层 ID（可选）'
                }
            },
            required: ['color']
        }
    };
    
    async execute(params: { color: { r: number; g: number; b: number }; layerId?: number }): Promise<string> {
        const doc = app.activeDocument;
        if (!doc) {
            return JSON.stringify({ success: false, error: '没有打开的文档' });
        }
        
        try {
            const layer = params.layerId 
                ? doc.layers.find((l: any) => l.id === params.layerId)
                : doc.activeLayers[0];
                
            if (!layer) {
                return JSON.stringify({ success: false, error: '未找到指定图层' });
            }
            
            const { r, g, b } = params.color;
            
            await executeAsModal(async () => {
                // 使用 batchPlay 设置填充颜色
                await action.batchPlay([
                    {
                        _obj: 'set',
                        _target: [{ _ref: 'layer', _id: layer.id }],
                        to: {
                            _obj: 'layer',
                            adjustment: {
                                _obj: 'solidColorLayer',
                                color: {
                                    _obj: 'RGBColor',
                                    red: r,
                                    green: g,  // 标准 RGB green 通道
                                    blue: b
                                }
                            }
                        }
                    }
                ], { synchronousExecution: true });
            }, { commandName: '设置填充颜色' });
            
            return JSON.stringify({
                success: true,
                layerName: layer.name,
                color: { r, g, b }
            });
        } catch (error: any) {
            return JSON.stringify({ success: false, error: error.message });
        }
    }
}

// ==================== 复制图层 ====================

export class DuplicateLayerTool implements Tool {
    name = 'duplicateLayer';
    
    schema: ToolSchema = {
        name: 'duplicateLayer',
        description: '复制当前选中的图层',
        parameters: {
            type: 'object',
            properties: {
                newName: {
                    type: 'string',
                    description: '新图层名称（可选，默认在原名后加"副本"）'
                },
                layerId: {
                    type: 'number',
                    description: '要复制的图层 ID（可选）'
                }
            },
            required: []
        }
    };
    
    async execute(params: { newName?: string; layerId?: number }): Promise<string> {
        const doc = app.activeDocument;
        if (!doc) {
            return JSON.stringify({ success: false, error: '没有打开的文档' });
        }
        
        try {
            const layer = params.layerId 
                ? doc.layers.find((l: any) => l.id === params.layerId)
                : doc.activeLayers[0];
                
            if (!layer) {
                return JSON.stringify({ success: false, error: '未找到指定图层' });
            }
            
            let newLayer: any;
            
            await executeAsModal(async () => {
                newLayer = await layer.duplicate();
                if (params.newName) {
                    newLayer.name = params.newName;
                }
            }, { commandName: '复制图层' });
            
            return JSON.stringify({
                success: true,
                originalLayer: layer.name,
                newLayerId: newLayer?.id,
                newLayerName: newLayer?.name
            });
        } catch (error: any) {
            return JSON.stringify({ success: false, error: error.message });
        }
    }
}

// ==================== 删除图层 ====================

export class DeleteLayerTool implements Tool {
    name = 'deleteLayer';
    
    schema: ToolSchema = {
        name: 'deleteLayer',
        description: '删除指定图层（谨慎使用！）',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '要删除的图层 ID（可选，默认当前选中）'
                },
                layerName: {
                    type: 'string',
                    description: '要删除的图层名称（可选，支持模糊匹配）'
                }
            },
            required: []
        }
    };
    
    async execute(params: { layerId?: number; layerName?: string }): Promise<string> {
        const doc = app.activeDocument;
        if (!doc) {
            return JSON.stringify({ success: false, error: '没有打开的文档' });
        }
        
        try {
            let layer: any;
            
            if (params.layerId) {
                layer = doc.layers.find((l: any) => l.id === params.layerId);
            } else if (params.layerName) {
                // 模糊匹配
                layer = doc.layers.find((l: any) => 
                    l.name.toLowerCase().includes(params.layerName!.toLowerCase())
                );
            } else {
                layer = doc.activeLayers[0];
            }
            
            if (!layer) {
                return JSON.stringify({ success: false, error: '未找到指定图层' });
            }
            
            const deletedName = layer.name;
            const deletedId = layer.id;
            
            await executeAsModal(async () => {
                await layer.delete();
            }, { commandName: '删除图层' });
            
            return JSON.stringify({
                success: true,
                deletedLayerId: deletedId,
                deletedLayerName: deletedName
            });
        } catch (error: any) {
            return JSON.stringify({ success: false, error: error.message });
        }
    }
}

// ==================== 锁定/解锁图层 ====================

export class LockLayerTool implements Tool {
    name = 'lockLayer';
    
    schema: ToolSchema = {
        name: 'lockLayer',
        description: '锁定或解锁图层（可分别控制位置锁定、透明度锁定、完全锁定）',
        parameters: {
            type: 'object',
            properties: {
                lock: {
                    type: 'boolean',
                    description: '是否锁定（true=锁定，false=解锁）'
                },
                lockType: {
                    type: 'string',
                    description: '锁定类型：all（完全锁定）、position（位置）、transparent（透明度）'
                },
                layerId: {
                    type: 'number',
                    description: '目标图层 ID（可选）'
                }
            },
            required: ['lock']
        }
    };
    
    async execute(params: { lock: boolean; lockType?: string; layerId?: number }): Promise<string> {
        const doc = app.activeDocument;
        if (!doc) {
            return JSON.stringify({ success: false, error: '没有打开的文档' });
        }
        
        try {
            const layer = params.layerId 
                ? doc.layers.find((l: any) => l.id === params.layerId)
                : doc.activeLayers[0];
                
            if (!layer) {
                return JSON.stringify({ success: false, error: '未找到指定图层' });
            }
            
            const lockType = params.lockType || 'all';
            
            await executeAsModal(async () => {
                if (lockType === 'all') {
                    layer.allLocked = params.lock;
                } else if (lockType === 'position') {
                    layer.positionLocked = params.lock;
                } else if (lockType === 'transparent') {
                    layer.transparentPixelsLocked = params.lock;
                }
            }, { commandName: params.lock ? '锁定图层' : '解锁图层' });
            
            return JSON.stringify({
                success: true,
                layerName: layer.name,
                locked: params.lock,
                lockType: lockType
            });
        } catch (error: any) {
            return JSON.stringify({ success: false, error: error.message });
        }
    }
}

// ==================== 获取图层属性 ====================

export class GetLayerPropertiesTool implements Tool {
    name = 'getLayerProperties';
    
    schema: ToolSchema = {
        name: 'getLayerProperties',
        description: '获取图层的详细属性（不透明度、混合模式、锁定状态等）',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '目标图层 ID（可选）'
                }
            },
            required: []
        }
    };
    
    async execute(params: { layerId?: number }): Promise<string> {
        const doc = app.activeDocument;
        if (!doc) {
            return JSON.stringify({ success: false, error: '没有打开的文档' });
        }
        
        try {
            const layer = params.layerId 
                ? doc.layers.find((l: any) => l.id === params.layerId)
                : doc.activeLayers[0];
                
            if (!layer) {
                return JSON.stringify({ success: false, error: '未找到指定图层' });
            }
            
            return JSON.stringify({
                success: true,
                properties: {
                    id: layer.id,
                    name: layer.name,
                    kind: layer.kind,
                    opacity: layer.opacity,
                    blendMode: layer.blendMode,
                    visible: layer.visible,
                    locked: {
                        all: layer.allLocked,
                        position: layer.positionLocked,
                        transparent: layer.transparentPixelsLocked
                    },
                    bounds: layer.bounds ? {
                        left: layer.bounds.left,
                        top: layer.bounds.top,
                        right: layer.bounds.right,
                        bottom: layer.bounds.bottom,
                        width: layer.bounds.right - layer.bounds.left,
                        height: layer.bounds.bottom - layer.bounds.top
                    } : null
                }
            });
        } catch (error: any) {
            return JSON.stringify({ success: false, error: error.message });
        }
    }
}
