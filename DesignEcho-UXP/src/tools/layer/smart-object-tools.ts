/**
 * 智能对象工具
 * 
 * 提供智能对象的创建、编辑、信息获取等操作
 * 
 * 工具列表：
 * - getSmartObjectInfo: 获取智能对象信息
 * - convertToSmartObject: 将图层转换为智能对象
 * - editSmartObjectContents: 打开智能对象进行编辑
 * - replaceSmartObjectContents: 替换智能对象内容
 * - updateSmartObject: 更新链接的智能对象
 */

import { Tool, ToolSchema } from '../types';

const photoshop = require('photoshop');
const { app, action } = photoshop;
const { executeAsModal } = photoshop.core;
const { storage } = require('uxp');

// ==================== 获取智能对象信息 ====================

export class GetSmartObjectInfoTool implements Tool {
    name = 'getSmartObjectInfo';
    
    schema: ToolSchema = {
        name: 'getSmartObjectInfo',
        description: '获取智能对象的详细信息，包括类型（嵌入/链接）、原始尺寸、链接路径等',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '智能对象图层 ID（可选，默认当前选中图层）'
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
                ? this.findLayerById(doc, params.layerId)
                : doc.activeLayers[0];
                
            if (!layer) {
                return JSON.stringify({ success: false, error: '未找到指定图层' });
            }
            
            // 检查是否是智能对象
            const kind = layer.kind?.toString() || '';
            const isSmartObject = kind === 'smartObject' || kind === 'SMARTOBJECT';
            
            if (!isSmartObject) {
                return JSON.stringify({ 
                    success: false, 
                    error: `图层 "${layer.name}" 不是智能对象，当前类型: ${kind}` 
                });
            }
            
            // 使用 batchPlay 获取详细信息
            const result = await action.batchPlay([
                {
                    _obj: 'get',
                    _target: [
                        { _ref: 'layer', _id: layer.id },
                        { _ref: 'document', _id: doc.id }
                    ],
                    _options: { dialogOptions: 'dontDisplay' }
                }
            ], { synchronousExecution: false });
            
            const layerInfo = result[0];
            
            // 提取智能对象信息
            const smartObjectInfo: any = {
                layerId: layer.id,
                layerName: layer.name,
                isSmartObject: true,
                bounds: {
                    left: layer.bounds?.left || 0,
                    top: layer.bounds?.top || 0,
                    right: layer.bounds?.right || 0,
                    bottom: layer.bounds?.bottom || 0,
                    width: (layer.bounds?.right || 0) - (layer.bounds?.left || 0),
                    height: (layer.bounds?.bottom || 0) - (layer.bounds?.top || 0)
                }
            };
            
            // 检查是否是链接的智能对象
            if (layerInfo.smartObject) {
                const so = layerInfo.smartObject;
                smartObjectInfo.linked = so.linked || false;
                smartObjectInfo.fileReference = so.fileReference || null;
                
                // 原始尺寸（如果可用）
                if (so.resolution) {
                    smartObjectInfo.originalResolution = so.resolution._value || so.resolution;
                }
                
                // 嵌入数据信息
                if (so.documentID) {
                    smartObjectInfo.documentID = so.documentID;
                }
            }
            
            // 变换信息
            if (layerInfo.smartObjectMore) {
                const som = layerInfo.smartObjectMore;
                smartObjectInfo.transform = {
                    width: som.size?.width?._value || som.size?.width,
                    height: som.size?.height?._value || som.size?.height,
                    resolution: som.resolution?._value || som.resolution
                };
            }
            
            return JSON.stringify({
                success: true,
                data: smartObjectInfo
            });
            
        } catch (error: any) {
            console.error('[GetSmartObjectInfo] 错误:', error);
            return JSON.stringify({ success: false, error: error.message });
        }
    }
    
    private findLayerById(doc: any, layerId: number): any {
        const searchLayers = (layers: any[]): any => {
            for (const layer of layers) {
                if (layer.id === layerId) return layer;
                if (layer.layers) {
                    const found = searchLayers(layer.layers);
                    if (found) return found;
                }
            }
            return null;
        };
        return searchLayers(doc.layers);
    }
}

// ==================== 转换为智能对象 ====================

export class ConvertToSmartObjectTool implements Tool {
    name = 'convertToSmartObject';
    
    schema: ToolSchema = {
        name: 'convertToSmartObject',
        description: '将当前选中的图层（或多个图层）转换为智能对象',
        parameters: {
            type: 'object',
            properties: {
                layerIds: {
                    type: 'array',
                    description: '要转换的图层 ID 数组（可选，默认当前选中图层）',
                    items: { type: 'number' }
                },
                name: {
                    type: 'string',
                    description: '新智能对象的名称（可选）'
                }
            },
            required: []
        }
    };
    
    async execute(params: { layerIds?: number[]; name?: string }): Promise<string> {
        const doc = app.activeDocument;
        if (!doc) {
            return JSON.stringify({ success: false, error: '没有打开的文档' });
        }
        
        try {
            // 如果指定了图层 ID，先选中这些图层
            if (params.layerIds && params.layerIds.length > 0) {
                await executeAsModal(async () => {
                    const targets = params.layerIds!.map(id => ({ _ref: 'layer', _id: id }));
                    await action.batchPlay([
                        {
                            _obj: 'select',
                            _target: targets,
                            makeVisible: false,
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: false });
                }, { commandName: '选择图层' });
            }
            
            if (doc.activeLayers.length === 0) {
                return JSON.stringify({ success: false, error: '没有选中的图层' });
            }
            
            const originalNames = doc.activeLayers.map((l: any) => l.name);
            
            // 执行转换
            await executeAsModal(async () => {
                await action.batchPlay([
                    {
                        _obj: 'newPlacedLayer',
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: false });
                
                // 如果指定了名称，重命名
                if (params.name) {
                    const newLayer = doc.activeLayers[0];
                    if (newLayer) {
                        newLayer.name = params.name;
                    }
                }
            }, { commandName: '转换为智能对象' });
            
            const newLayer = doc.activeLayers[0];
            
            return JSON.stringify({
                success: true,
                data: {
                    smartObjectId: newLayer?.id,
                    smartObjectName: newLayer?.name,
                    originalLayers: originalNames,
                    message: `已将 ${originalNames.length} 个图层转换为智能对象`
                }
            });
            
        } catch (error: any) {
            console.error('[ConvertToSmartObject] 错误:', error);
            return JSON.stringify({ success: false, error: error.message });
        }
    }
}

// ==================== 编辑智能对象内容 ====================

export class EditSmartObjectContentsTool implements Tool {
    name = 'editSmartObjectContents';
    
    schema: ToolSchema = {
        name: 'editSmartObjectContents',
        description: '打开智能对象进行编辑（会打开一个新的 .psb 文档窗口）',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '智能对象图层 ID（可选，默认当前选中图层）'
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
                ? this.findLayerById(doc, params.layerId)
                : doc.activeLayers[0];
                
            if (!layer) {
                return JSON.stringify({ success: false, error: '未找到指定图层' });
            }
            
            // 先选中图层
            await executeAsModal(async () => {
                await action.batchPlay([
                    {
                        _obj: 'select',
                        _target: [{ _ref: 'layer', _id: layer.id }],
                        makeVisible: false,
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: false });
            }, { commandName: '选择智能对象' });
            
            // 检查是否是智能对象
            const kind = layer.kind?.toString() || '';
            const isSmartObject = kind === 'smartObject' || kind === 'SMARTOBJECT';
            
            if (!isSmartObject) {
                return JSON.stringify({ 
                    success: false, 
                    error: `图层 "${layer.name}" 不是智能对象` 
                });
            }
            
            const parentDocName = doc.name;
            
            // 打开智能对象进行编辑
            await executeAsModal(async () => {
                await action.batchPlay([
                    {
                        _obj: 'placedLayerEditContents',
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: false });
            }, { commandName: '编辑智能对象内容' });
            
            // 等待新文档打开
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // 获取新打开的文档信息
            const newDoc = app.activeDocument;
            
            return JSON.stringify({
                success: true,
                data: {
                    parentDocument: parentDocName,
                    smartObjectDocument: newDoc?.name || '智能对象编辑窗口',
                    smartObjectLayerId: layer.id,
                    smartObjectLayerName: layer.name,
                    message: `已打开智能对象 "${layer.name}" 进行编辑。编辑完成后保存并关闭此文档即可更新原智能对象。`
                }
            });
            
        } catch (error: any) {
            console.error('[EditSmartObjectContents] 错误:', error);
            return JSON.stringify({ success: false, error: error.message });
        }
    }
    
    private findLayerById(doc: any, layerId: number): any {
        const searchLayers = (layers: any[]): any => {
            for (const layer of layers) {
                if (layer.id === layerId) return layer;
                if (layer.layers) {
                    const found = searchLayers(layer.layers);
                    if (found) return found;
                }
            }
            return null;
        };
        return searchLayers(doc.layers);
    }
}

// ==================== 替换智能对象内容 ====================

export class ReplaceSmartObjectContentsTool implements Tool {
    name = 'replaceSmartObjectContents';
    
    schema: ToolSchema = {
        name: 'replaceSmartObjectContents',
        description: '替换智能对象的内容为新的图片文件',
        parameters: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: '新图片的文件路径'
                },
                layerId: {
                    type: 'number',
                    description: '智能对象图层 ID（可选，默认当前选中图层）'
                }
            },
            required: ['filePath']
        }
    };
    
    async execute(params: { filePath: string; layerId?: number }): Promise<string> {
        const doc = app.activeDocument;
        if (!doc) {
            return JSON.stringify({ success: false, error: '没有打开的文档' });
        }
        
        try {
            const layer = params.layerId 
                ? this.findLayerById(doc, params.layerId)
                : doc.activeLayers[0];
                
            if (!layer) {
                return JSON.stringify({ success: false, error: '未找到指定图层' });
            }
            
            // 先选中图层
            await executeAsModal(async () => {
                await action.batchPlay([
                    {
                        _obj: 'select',
                        _target: [{ _ref: 'layer', _id: layer.id }],
                        makeVisible: false,
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: false });
            }, { commandName: '选择智能对象' });
            
            // 获取文件
            const fs = storage.localFileSystem;
            let file;
            
            try {
                file = await fs.getEntryWithUrl('file://' + params.filePath.replace(/\\/g, '/'));
            } catch (e) {
                // 尝试使用原路径
                try {
                    file = await fs.getEntryWithUrl(params.filePath);
                } catch (e2) {
                    return JSON.stringify({ 
                        success: false, 
                        error: `无法访问文件: ${params.filePath}` 
                    });
                }
            }
            
            if (!file) {
                return JSON.stringify({ success: false, error: '文件不存在' });
            }
            
            // 替换智能对象内容
            await executeAsModal(async () => {
                await action.batchPlay([
                    {
                        _obj: 'placedLayerReplaceContents',
                        null: {
                            _path: await fs.createSessionToken(file),
                            _kind: 'local'
                        },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: false });
            }, { commandName: '替换智能对象内容' });
            
            return JSON.stringify({
                success: true,
                data: {
                    layerId: layer.id,
                    layerName: layer.name,
                    newContentFile: params.filePath,
                    message: `已替换智能对象 "${layer.name}" 的内容`
                }
            });
            
        } catch (error: any) {
            console.error('[ReplaceSmartObjectContents] 错误:', error);
            return JSON.stringify({ success: false, error: error.message });
        }
    }
    
    private findLayerById(doc: any, layerId: number): any {
        const searchLayers = (layers: any[]): any => {
            for (const layer of layers) {
                if (layer.id === layerId) return layer;
                if (layer.layers) {
                    const found = searchLayers(layer.layers);
                    if (found) return found;
                }
            }
            return null;
        };
        return searchLayers(doc.layers);
    }
}

// ==================== 更新智能对象 ====================

export class UpdateSmartObjectTool implements Tool {
    name = 'updateSmartObject';
    
    schema: ToolSchema = {
        name: 'updateSmartObject',
        description: '更新链接的智能对象（当源文件修改后使用）或重新嵌入智能对象',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '智能对象图层 ID（可选，默认当前选中图层）'
                },
                action: {
                    type: 'string',
                    description: '操作类型：update（更新链接）、relink（重新链接到新文件）',
                    enum: ['update', 'relink']
                }
            },
            required: []
        }
    };
    
    async execute(params: { layerId?: number; action?: string }): Promise<string> {
        const doc = app.activeDocument;
        if (!doc) {
            return JSON.stringify({ success: false, error: '没有打开的文档' });
        }
        
        try {
            const layer = params.layerId 
                ? this.findLayerById(doc, params.layerId)
                : doc.activeLayers[0];
                
            if (!layer) {
                return JSON.stringify({ success: false, error: '未找到指定图层' });
            }
            
            // 先选中图层
            await executeAsModal(async () => {
                await action.batchPlay([
                    {
                        _obj: 'select',
                        _target: [{ _ref: 'layer', _id: layer.id }],
                        makeVisible: false,
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: false });
            }, { commandName: '选择智能对象' });
            
            const updateAction = params.action || 'update';
            
            // 根据操作类型执行
            await executeAsModal(async () => {
                if (updateAction === 'relink') {
                    // 重新链接（会弹出文件选择对话框）
                    await action.batchPlay([
                        {
                            _obj: 'placedLayerRelinkToFile',
                            _options: { dialogOptions: 'display' }  // 显示对话框
                        }
                    ], { synchronousExecution: false });
                } else {
                    // 更新修改的内容
                    await action.batchPlay([
                        {
                            _obj: 'placedLayerUpdateModified',
                            _target: [{ _ref: 'layer', _id: layer.id }],
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: false });
                }
            }, { commandName: '更新智能对象' });
            
            return JSON.stringify({
                success: true,
                data: {
                    layerId: layer.id,
                    layerName: layer.name,
                    action: updateAction,
                    message: updateAction === 'relink' 
                        ? `请在弹出的对话框中选择新的链接文件`
                        : `已更新智能对象 "${layer.name}"`
                }
            });
            
        } catch (error: any) {
            console.error('[UpdateSmartObject] 错误:', error);
            return JSON.stringify({ success: false, error: error.message });
        }
    }
    
    private findLayerById(doc: any, layerId: number): any {
        const searchLayers = (layers: any[]): any => {
            for (const layer of layers) {
                if (layer.id === layerId) return layer;
                if (layer.layers) {
                    const found = searchLayers(layer.layers);
                    if (found) return found;
                }
            }
            return null;
        };
        return searchLayers(doc.layers);
    }
}

// ==================== 获取智能对象内部图层结构 ====================

export class GetSmartObjectLayersTool implements Tool {
    name = 'getSmartObjectLayers';
    
    schema: ToolSchema = {
        name: 'getSmartObjectLayers',
        description: '获取智能对象内部的图层结构（需要先打开智能对象进行编辑）',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '智能对象图层 ID（可选，默认当前选中图层）'
                },
                autoOpen: {
                    type: 'boolean',
                    description: '是否自动打开智能对象获取结构（默认 false，需要用户确认）'
                }
            },
            required: []
        }
    };
    
    async execute(params: { layerId?: number; autoOpen?: boolean }): Promise<string> {
        const doc = app.activeDocument;
        if (!doc) {
            return JSON.stringify({ success: false, error: '没有打开的文档' });
        }
        
        try {
            const layer = params.layerId 
                ? this.findLayerById(doc, params.layerId)
                : doc.activeLayers[0];
                
            if (!layer) {
                return JSON.stringify({ success: false, error: '未找到指定图层' });
            }
            
            const kind = layer.kind?.toString() || '';
            const isSmartObject = kind === 'smartObject' || kind === 'SMARTOBJECT';
            
            if (!isSmartObject) {
                return JSON.stringify({ 
                    success: false, 
                    error: `图层 "${layer.name}" 不是智能对象` 
                });
            }
            
            // 智能对象内部结构需要打开后才能获取
            if (!params.autoOpen) {
                return JSON.stringify({
                    success: true,
                    data: {
                        layerId: layer.id,
                        layerName: layer.name,
                        isSmartObject: true,
                        hint: '智能对象内部图层结构需要打开后才能获取。请使用 editSmartObjectContents 工具打开智能对象，或设置 autoOpen: true 自动打开。',
                        availableActions: ['editSmartObjectContents', 'getSmartObjectInfo', 'replaceSmartObjectContents']
                    }
                });
            }
            
            // 自动打开智能对象
            const parentDocName = doc.name;
            const parentDocId = doc.id;
            
            await executeAsModal(async () => {
                await action.batchPlay([
                    {
                        _obj: 'select',
                        _target: [{ _ref: 'layer', _id: layer.id }],
                        makeVisible: false,
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: false });
                
                await action.batchPlay([
                    {
                        _obj: 'placedLayerEditContents',
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: false });
            }, { commandName: '打开智能对象' });
            
            // 等待新文档打开
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const soDoc = app.activeDocument;
            
            if (!soDoc) {
                return JSON.stringify({ 
                    success: false, 
                    error: '无法打开智能对象文档' 
                });
            }
            
            // 获取内部图层结构
            const layers = this.extractLayerHierarchy(soDoc.layers);
            
            // 关闭智能对象文档（不保存）并返回原文档
            // 注意：这里不自动关闭，让用户决定
            
            return JSON.stringify({
                success: true,
                data: {
                    smartObjectName: layer.name,
                    smartObjectLayerId: layer.id,
                    parentDocument: parentDocName,
                    internalDocument: soDoc.name,
                    internalLayers: layers,
                    layerCount: this.countLayers(layers),
                    note: '智能对象已打开。请在编辑完成后保存并关闭此文档以更新原智能对象，或直接关闭放弃更改。'
                }
            });
            
        } catch (error: any) {
            console.error('[GetSmartObjectLayers] 错误:', error);
            return JSON.stringify({ success: false, error: error.message });
        }
    }
    
    private findLayerById(doc: any, layerId: number): any {
        const searchLayers = (layers: any[]): any => {
            for (const layer of layers) {
                if (layer.id === layerId) return layer;
                if (layer.layers) {
                    const found = searchLayers(layer.layers);
                    if (found) return found;
                }
            }
            return null;
        };
        return searchLayers(doc.layers);
    }
    
    private extractLayerHierarchy(layers: any[]): any[] {
        return layers.map((layer: any) => {
            const info: any = {
                id: layer.id,
                name: layer.name,
                type: layer.kind?.toString() || 'unknown',
                visible: layer.visible,
                opacity: layer.opacity
            };
            
            if (layer.layers && layer.layers.length > 0) {
                info.children = this.extractLayerHierarchy(layer.layers);
            }
            
            return info;
        });
    }
    
    private countLayers(layers: any[]): number {
        let count = layers.length;
        for (const layer of layers) {
            if (layer.children) {
                count += this.countLayers(layer.children);
            }
        }
        return count;
    }
}

// ==================== 复制智能对象（链接副本 vs 独立副本）====================

export class DuplicateSmartObjectTool implements Tool {
    name = 'duplicateSmartObject';
    
    schema: ToolSchema = {
        name: 'duplicateSmartObject',
        description: '复制智能对象，可选择创建链接副本（共享内容）或独立副本（独立内容）',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '智能对象图层 ID（可选，默认当前选中图层）'
                },
                linked: {
                    type: 'boolean',
                    description: '是否创建链接副本（true=共享内容，false=独立副本）。默认 true。'
                },
                newName: {
                    type: 'string',
                    description: '新图层的名称（可选）'
                }
            },
            required: []
        }
    };
    
    async execute(params: { layerId?: number; linked?: boolean; newName?: string }): Promise<string> {
        const doc = app.activeDocument;
        if (!doc) {
            return JSON.stringify({ success: false, error: '没有打开的文档' });
        }
        
        try {
            const layer = params.layerId 
                ? this.findLayerById(doc, params.layerId)
                : doc.activeLayers[0];
                
            if (!layer) {
                return JSON.stringify({ success: false, error: '未找到指定图层' });
            }
            
            const linked = params.linked !== false; // 默认 true
            
            await executeAsModal(async () => {
                // 选中图层
                await action.batchPlay([
                    {
                        _obj: 'select',
                        _target: [{ _ref: 'layer', _id: layer.id }],
                        makeVisible: false,
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: false });
                
                if (linked) {
                    // 链接副本：标准复制
                    await action.batchPlay([
                        {
                            _obj: 'copyToLayer',
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: false });
                } else {
                    // 独立副本：通过新建智能对象
                    await action.batchPlay([
                        {
                            _obj: 'placedLayerMakeCopy',
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: false });
                }
                
                // 重命名
                if (params.newName) {
                    const newLayer = doc.activeLayers[0];
                    if (newLayer) {
                        newLayer.name = params.newName;
                    }
                }
            }, { commandName: '复制智能对象' });
            
            const newLayer = doc.activeLayers[0];
            
            return JSON.stringify({
                success: true,
                data: {
                    originalLayerId: layer.id,
                    originalLayerName: layer.name,
                    newLayerId: newLayer?.id,
                    newLayerName: newLayer?.name,
                    isLinkedCopy: linked,
                    message: linked 
                        ? `已创建链接副本 "${newLayer?.name}"（与原智能对象共享内容）`
                        : `已创建独立副本 "${newLayer?.name}"（独立内容）`
                }
            });
            
        } catch (error: any) {
            console.error('[DuplicateSmartObject] 错误:', error);
            return JSON.stringify({ success: false, error: error.message });
        }
    }
    
    private findLayerById(doc: any, layerId: number): any {
        const searchLayers = (layers: any[]): any => {
            for (const layer of layers) {
                if (layer.id === layerId) return layer;
                if (layer.layers) {
                    const found = searchLayers(layer.layers);
                    if (found) return found;
                }
            }
            return null;
        };
        return searchLayers(doc.layers);
    }
}

// ==================== 栅格化智能对象 ====================

export class RasterizeSmartObjectTool implements Tool {
    name = 'rasterizeSmartObject';
    
    schema: ToolSchema = {
        name: 'rasterizeSmartObject',
        description: '将智能对象栅格化为普通像素图层（不可逆操作）',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '智能对象图层 ID（可选，默认当前选中图层）'
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
                ? this.findLayerById(doc, params.layerId)
                : doc.activeLayers[0];
                
            if (!layer) {
                return JSON.stringify({ success: false, error: '未找到指定图层' });
            }
            
            const originalName = layer.name;
            
            await executeAsModal(async () => {
                await action.batchPlay([
                    {
                        _obj: 'select',
                        _target: [{ _ref: 'layer', _id: layer.id }],
                        makeVisible: false,
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: false });
                
                await action.batchPlay([
                    {
                        _obj: 'rasterizeLayer',
                        _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: false });
            }, { commandName: '栅格化智能对象' });
            
            return JSON.stringify({
                success: true,
                data: {
                    layerId: layer.id,
                    layerName: originalName,
                    message: `已将智能对象 "${originalName}" 栅格化为普通图层`
                }
            });
            
        } catch (error: any) {
            console.error('[RasterizeSmartObject] 错误:', error);
            return JSON.stringify({ success: false, error: error.message });
        }
    }
    
    private findLayerById(doc: any, layerId: number): any {
        const searchLayers = (layers: any[]): any => {
            for (const layer of layers) {
                if (layer.id === layerId) return layer;
                if (layer.layers) {
                    const found = searchLayers(layer.layers);
                    if (found) return found;
                }
            }
            return null;
        };
        return searchLayers(doc.layers);
    }
}
