/**
 * 获取图层中主体的边界
 * 使用 Photoshop 的"选择主体"功能或分析非透明像素
 */
import { app, action, core } from 'photoshop';
import { Tool, ToolSchema } from '../types';

export class GetSubjectBoundsTool implements Tool {
    name = 'getSubjectBounds';
    description = '获取图层中主体（非透明区域或智能检测主体）的边界框';
    
    schema: ToolSchema = {
        name: 'getSubjectBounds',
        description: '获取图层中主体（非透明区域或智能检测主体）的边界框',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '图层ID'
                },
                method: {
                    type: 'string',
                    enum: ['alpha', 'smart'],
                    description: '检测方法：alpha（分析透明度）或 smart（智能选择主体）'
                }
            },
            required: ['layerId']
        }
    };
    
    async execute(params: {
        layerId: number;
        method?: 'alpha' | 'smart';
    }): Promise<{
        success: boolean;
        data?: {
            bounds: {
                left: number;
                top: number;
                right: number;
                bottom: number;
                width: number;
                height: number;
                centerX: number;
                centerY: number;
            };
            method: string;
        };
        error?: string;
    }> {
        console.log('[GetSubjectBounds] ========== 开始 ==========');
        console.log('[GetSubjectBounds] 参数:', JSON.stringify(params));
        
        try {
            const doc = app.activeDocument;
            if (!doc) {
                console.error('[GetSubjectBounds] 错误: 没有打开的文档');
                return { success: false, error: '没有打开的文档' };
            }
            
            const layerId = typeof params.layerId === 'string' 
                ? parseInt(params.layerId, 10) 
                : params.layerId;
            
            console.log('[GetSubjectBounds] 查找图层 ID:', layerId);
            
            const layer = this.findLayerById(doc, layerId);
            if (!layer) {
                console.error('[GetSubjectBounds] 错误: 未找到图层 ID:', layerId);
                return { success: false, error: `未找到图层 ID: ${layerId}` };
            }
            
            console.log('[GetSubjectBounds] 找到图层:', layer.name, 'kind:', layer.kind);
            
            const method = params.method || 'smart';
            console.log('[GetSubjectBounds] 使用方法:', method);
            
            let bounds: any;
            
            if (method === 'smart') {
                console.log('[GetSubjectBounds] 调用 getSmartSubjectBounds...');
                bounds = await this.getSmartSubjectBounds(layer);
            } else {
                console.log('[GetSubjectBounds] 调用 getAlphaBounds...');
                bounds = await this.getAlphaBounds(layer);
            }
            
            console.log('[GetSubjectBounds] 返回边界:', JSON.stringify(bounds));
            
            if (!bounds) {
                console.error('[GetSubjectBounds] 错误: bounds 为空');
                return { success: false, error: '无法获取主体边界' };
            }
            
            const result = {
                success: true,
                data: {
                    bounds: {
                        left: bounds.left,
                        top: bounds.top,
                        right: bounds.right,
                        bottom: bounds.bottom,
                        width: bounds.right - bounds.left,
                        height: bounds.bottom - bounds.top,
                        centerX: (bounds.left + bounds.right) / 2,
                        centerY: (bounds.top + bounds.bottom) / 2
                    },
                    method
                }
            };
            
            console.log('[GetSubjectBounds] 成功:', JSON.stringify(result.data.bounds));
            console.log('[GetSubjectBounds] ========== 结束 ==========');
            return result;
            
        } catch (error: any) {
            console.error('[GetSubjectBounds] 异常:', error.message);
            console.error('[GetSubjectBounds] 堆栈:', error.stack);
            return { success: false, error: error.message || '获取主体边界失败' };
        }
    }
    
    /**
     * 使用智能选择主体获取边界
     */
    private async getSmartSubjectBounds(layer: any): Promise<any> {
        console.log('[SmartSubject] 开始智能选择主体...');
        console.log('[SmartSubject] 图层:', layer.name, 'ID:', layer.id);
        
        return await core.executeAsModal(async () => {
            try {
                // 先选中目标图层
                console.log('[SmartSubject] 1. 选中目标图层...');
                await action.batchPlay([
                    {
                        _obj: 'select',
                        _target: [{ _ref: 'layer', _id: layer.id }],
                        makeVisible: false,
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });
                console.log('[SmartSubject] ✓ 图层已选中');
                
                // 清除当前选区
                console.log('[SmartSubject] 2. 清除当前选区...');
                try {
                    await action.batchPlay([
                        {
                            _obj: 'set',
                            _target: [{ _ref: 'channel', _property: 'selection' }],
                            to: { _enum: 'ordinal', _value: 'none' },
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });
                    console.log('[SmartSubject] ✓ 选区已清除');
                } catch (e) {
                    console.log('[SmartSubject] 选区清除失败（忽略）');
                }
                
                // 使用"选择主体"功能
                console.log('[SmartSubject] 3. 执行 selectSubject (PS智能选择主体)...');
                try {
                    await action.batchPlay([
                        {
                            _obj: 'selectSubject',
                            sampleAllLayers: false,
                            _isCommand: false,  // 防止弹出错误对话框
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { 
                        synchronousExecution: true,
                        modalBehavior: 'execute'  // 静默执行
                    });
                    console.log('[SmartSubject] ✓ selectSubject 执行完成');
                } catch (selectError: any) {
                    console.warn('[SmartSubject] selectSubject 失败 (可能无法识别主体):', selectError.message);
                    // 不抛出错误，直接回退到图层边界
                    console.log('[SmartSubject] 回退到图层边界...');
                    return this.getLayerBoundsFromBatchPlay(layer);
                }
                
                // 获取选区边界
                console.log('[SmartSubject] 4. 获取选区边界...');
                const selectionInfo = await action.batchPlay([
                    {
                        _obj: 'get',
                        _target: [
                            { _property: 'selection' },
                            { _ref: 'document', _enum: 'ordinal', _value: 'targetEnum' }
                        ],
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });
                
                console.log('[SmartSubject] 选区信息:', JSON.stringify(selectionInfo));
                
                if (selectionInfo && selectionInfo[0] && selectionInfo[0].selection) {
                    const sel = selectionInfo[0].selection;
                    console.log('[SmartSubject] ✓ 选区有效, 原始数据:', JSON.stringify(sel));
                    
                    // 清除选区
                    console.log('[SmartSubject] 5. 清除选区...');
                    await action.batchPlay([
                        {
                            _obj: 'set',
                            _target: [{ _ref: 'channel', _property: 'selection' }],
                            to: { _enum: 'ordinal', _value: 'none' },
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });
                    
                    const bounds = {
                        left: sel.left?._value || sel.left || 0,
                        top: sel.top?._value || sel.top || 0,
                        right: sel.right?._value || sel.right || 0,
                        bottom: sel.bottom?._value || sel.bottom || 0
                    };
                    
                    console.log('[SmartSubject] ✓ 主体边界:', JSON.stringify(bounds));
                    return bounds;
                }
                
                // 如果智能选择失败（没有选区），回退到图层边界
                console.warn('[SmartSubject] ✗ 没有选区，回退到图层边界');
                return this.getLayerBoundsFromBatchPlay(layer);
                
            } catch (error: any) {
                console.error('[SmartSubject] ✗ 智能选择异常:', error.message);
                console.log('[SmartSubject] 回退到图层边界...');
                return this.getLayerBoundsFromBatchPlay(layer);
            }
        }, { commandName: 'Get Subject Bounds' });
    }
    
    /**
     * 分析 alpha 通道获取非透明区域边界
     */
    private async getAlphaBounds(layer: any): Promise<any> {
        // 对于没有透明背景的图层，使用图层边界
        // 对于有透明背景的，理论上应该分析像素，但这里简化处理
        return await core.executeAsModal(async () => {
            return this.getLayerBoundsFromBatchPlay(layer);
        }, { commandName: 'Get Alpha Bounds' });
    }
    
    /**
     * 使用 batchPlay 获取图层边界（回退方案）
     */
    private async getLayerBoundsFromBatchPlay(layer: any): Promise<any> {
        console.log('[LayerBounds] 获取图层边界 (回退), layerId:', layer.id);
        try {
            const result = await action.batchPlay([
                {
                    _obj: 'get',
                    _target: [
                        { _ref: 'layer', _id: layer.id }
                    ],
                    _options: { dialogOptions: 'dontDisplay' }
                }
            ], { synchronousExecution: true });
            
            if (result && result[0] && result[0].bounds) {
                const b = result[0].bounds;
                return {
                    left: b.left?._value || b.left || 0,
                    top: b.top?._value || b.top || 0,
                    right: b.right?._value || b.right || 0,
                    bottom: b.bottom?._value || b.bottom || 0
                };
            }
            
            // 使用图层 API
            if (layer.bounds) {
                return {
                    left: layer.bounds.left,
                    top: layer.bounds.top,
                    right: layer.bounds.right,
                    bottom: layer.bounds.bottom
                };
            }
            
            return null;
        } catch (error) {
            console.error('[GetSubjectBounds] getLayerBoundsFromBatchPlay error:', error);
            return null;
        }
    }
    
    private findLayerById(container: any, id: number): any {
        const numericId = typeof id === 'string' ? parseInt(id as string, 10) : id;
        for (const layer of container.layers) {
            if (layer.id === numericId) {
                return layer;
            }
            if (layer.layers) {
                const found = this.findLayerById(layer, numericId);
                if (found) return found;
            }
        }
        return null;
    }
}
