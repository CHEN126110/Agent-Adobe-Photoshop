/**
 * SKU 配置工具
 * 
 * 1. ExportColorConfigTool - 导出当前素材文档的颜色配置（图层组名称）
 * 2. CreateSkuPlaceholdersTool - 在模板中创建定位占位符
 * 3. GetSkuOutputDirTool - 获取/创建项目的 SKU 输出目录
 */

import { Tool, ToolResult, ToolSchema } from '../types';

const { app, core, action } = require('photoshop');

// ======================================================================
// 工具 1: 导出颜色配置
// ======================================================================

/**
 * 导出颜色配置工具
 * 读取当前 SKU 素材文档的图层组名称，生成可用于配置的颜色列表
 */
export class ExportColorConfigTool implements Tool {
    name = 'exportColorConfig';

    schema: ToolSchema = {
        name: 'exportColorConfig',
        description: '导出当前素材文档的颜色配置。读取文档中所有图层组名称作为颜色名，返回 CSV 格式数据供用户保存或配置',
        parameters: {
            type: 'object',
            properties: {
                documentName: {
                    type: 'string',
                    description: '可选：指定文档名称。如不指定则使用当前活动文档'
                },
                includeIndex: {
                    type: 'boolean',
                    description: '是否包含索引编号（默认 true）'
                },
                format: {
                    type: 'string',
                    enum: ['csv', 'json', 'array'],
                    description: '输出格式：csv（CSV文本）、json（JSON对象）、array（数组）'
                }
            },
            required: []
        }
    };

    async execute(params: {
        documentName?: string;
        includeIndex?: boolean;
        format?: 'csv' | 'json' | 'array';
    }): Promise<ToolResult<any>> {
        try {
            const format = params.format || 'csv';
            const includeIndex = params.includeIndex !== false;

            // 找到目标文档
            let targetDoc: any = null;
            
            if (params.documentName) {
                for (let i = 0; i < app.documents.length; i++) {
                    if (app.documents[i].name === params.documentName) {
                        targetDoc = app.documents[i];
                        break;
                    }
                }
                if (!targetDoc) {
                    return { 
                        success: false, 
                        error: `未找到文档: ${params.documentName}`, 
                        data: null 
                    };
                }
            } else {
                targetDoc = app.activeDocument;
                if (!targetDoc) {
                    return { 
                        success: false, 
                        error: '没有打开的文档', 
                        data: null 
                    };
                }
            }

            // 提取图层组名称
            const layerGroups: Array<{
                index: number;
                name: string;
                layerCount: number;
                bounds?: { left: number; top: number; width: number; height: number };
            }> = [];

            const layers = targetDoc.layers;
            let groupIndex = 1;

            for (let i = 0; i < layers.length; i++) {
                const layer = layers[i] as any;
                // 判断是否是图层组（有子图层）
                const isGroup = layer.layers && layer.layers.length > 0;
                
                if (isGroup) {
                    const name = (layer.name || `图层组${groupIndex}`).trim();
                    
                    // 获取边界（可选）
                    let bounds: { left: number; top: number; width: number; height: number } | undefined = undefined;
                    try {
                        const b = layer.bounds;
                        bounds = {
                            left: b[0].value ?? b[0],
                            top: b[1].value ?? b[1],
                            width: (b[2].value ?? b[2]) - (b[0].value ?? b[0]),
                            height: (b[3].value ?? b[3]) - (b[1].value ?? b[1])
                        };
                    } catch (e) {
                        // 忽略边界获取失败
                    }
                    
                    layerGroups.push({
                        index: groupIndex,
                        name: name,
                        layerCount: layer.layers.length,
                        bounds
                    });
                    groupIndex++;
                }
            }

            if (layerGroups.length === 0) {
                return {
                    success: false,
                    error: '文档中没有图层组。请确保素材 PSD 包含以颜色命名的图层组（如"白色"、"黑色"等）',
                    data: null
                };
            }

            // 根据格式生成输出
            let result: any;

            if (format === 'csv') {
                // CSV 格式：颜色名,扩展值,编号
                const header = '颜色,exValue,编号';
                const rows = layerGroups.map(g => 
                    `${g.name},,${includeIndex ? g.index : ''}`
                );
                result = {
                    csv: [header, ...rows].join('\n'),
                    rowCount: layerGroups.length,
                    suggestion: '将以上 CSV 内容保存到 "配置文件/颜色配置.csv"'
                };
            } else if (format === 'json') {
                result = {
                    colors: layerGroups.map(g => ({
                        id: g.index,
                        name: g.name,
                        exValue: '',
                        layerCount: g.layerCount
                    }))
                };
            } else {
                // array
                result = {
                    colorNames: layerGroups.map(g => g.name),
                    count: layerGroups.length
                };
            }

            return {
                success: true,
                data: {
                    documentName: targetDoc.name,
                    format,
                    ...result,
                    layerGroups
                }
            };

        } catch (error: any) {
            console.error('[ExportColorConfig] 错误:', error);
            return { success: false, error: error.message, data: null };
        }
    }
}


// ======================================================================
// 工具 2: 创建 SKU 占位符
// ======================================================================

/**
 * 创建 SKU 占位符工具
 * 在模板文档中创建定位占位符，用于精确放置产品图
 */
export class CreateSkuPlaceholdersTool implements Tool {
    name = 'createSkuPlaceholders';

    schema: ToolSchema = {
        name: 'createSkuPlaceholders',
        description: '在模板文档中创建 SKU 定位占位符矩形。用于标记产品放置位置，确保批量生成时位置一致',
        parameters: {
            type: 'object',
            properties: {
                count: {
                    type: 'number',
                    description: '占位符数量（2双、3双、4双等）'
                },
                layout: {
                    type: 'string',
                    enum: ['horizontal', 'vertical', 'grid'],
                    description: '排列方式：horizontal（水平）、vertical（垂直）、grid（网格）'
                },
                margin: {
                    type: 'number',
                    description: '占位符之间的间距（像素）'
                },
                padding: {
                    type: 'number',
                    description: '画布边缘到占位符的边距（像素）'
                },
                placeholderSize: {
                    type: 'object',
                    properties: {
                        width: { type: 'number', description: '宽度（像素）' },
                        height: { type: 'number', description: '高度（像素）' }
                    },
                    description: '指定占位符尺寸（可选，默认自动计算）'
                },
                naming: {
                    type: 'string',
                    description: '命名模式，如 "[SKU:占位{n}]"，其中 {n} 会被替换为序号'
                },
                strokeColor: {
                    type: 'string',
                    description: '占位符边框颜色（HEX，默认 #FF0000）'
                },
                fillOpacity: {
                    type: 'number',
                    description: '填充不透明度（0-100，默认 0 即透明）'
                }
            },
            required: ['count']
        }
    };

    async execute(params: {
        count: number;
        layout?: 'horizontal' | 'vertical' | 'grid';
        margin?: number;
        padding?: number;
        placeholderSize?: { width: number; height: number };
        naming?: string;
        strokeColor?: string;
        fillOpacity?: number;
    }): Promise<ToolResult<any>> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档', data: null };
            }

            const count = params.count;
            const layout = params.layout || 'horizontal';
            const margin = params.margin ?? 20;
            const padding = params.padding ?? 50;
            const naming = params.naming || '[SKU:占位{n}]';
            const strokeColor = params.strokeColor || '#FF0000';
            const fillOpacity = params.fillOpacity ?? 0;

            const docWidth = doc.width;
            const docHeight = doc.height;

            // 计算占位符尺寸和位置
            const placeholders: Array<{
                name: string;
                x: number;
                y: number;
                width: number;
                height: number;
            }> = [];

            if (layout === 'horizontal') {
                // 水平排列
                const availableWidth = docWidth - padding * 2 - margin * (count - 1);
                const placeholderWidth = params.placeholderSize?.width || Math.floor(availableWidth / count);
                const placeholderHeight = params.placeholderSize?.height || Math.floor(docHeight - padding * 2);

                for (let i = 0; i < count; i++) {
                    const x = padding + i * (placeholderWidth + margin);
                    const y = padding;
                    const name = naming.replace('{n}', String(i + 1));
                    
                    placeholders.push({
                        name,
                        x,
                        y,
                        width: placeholderWidth,
                        height: placeholderHeight
                    });
                }
            } else if (layout === 'vertical') {
                // 垂直排列
                const availableHeight = docHeight - padding * 2 - margin * (count - 1);
                const placeholderWidth = params.placeholderSize?.width || Math.floor(docWidth - padding * 2);
                const placeholderHeight = params.placeholderSize?.height || Math.floor(availableHeight / count);

                for (let i = 0; i < count; i++) {
                    const x = padding;
                    const y = padding + i * (placeholderHeight + margin);
                    const name = naming.replace('{n}', String(i + 1));
                    
                    placeholders.push({
                        name,
                        x,
                        y,
                        width: placeholderWidth,
                        height: placeholderHeight
                    });
                }
            } else {
                // 网格排列
                const cols = Math.ceil(Math.sqrt(count));
                const rows = Math.ceil(count / cols);
                
                const availableWidth = docWidth - padding * 2 - margin * (cols - 1);
                const availableHeight = docHeight - padding * 2 - margin * (rows - 1);
                
                const placeholderWidth = params.placeholderSize?.width || Math.floor(availableWidth / cols);
                const placeholderHeight = params.placeholderSize?.height || Math.floor(availableHeight / rows);

                for (let i = 0; i < count; i++) {
                    const col = i % cols;
                    const row = Math.floor(i / cols);
                    const x = padding + col * (placeholderWidth + margin);
                    const y = padding + row * (placeholderHeight + margin);
                    const name = naming.replace('{n}', String(i + 1));
                    
                    placeholders.push({
                        name,
                        x,
                        y,
                        width: placeholderWidth,
                        height: placeholderHeight
                    });
                }
            }

            // 创建占位符图层组和矩形
            const createdLayers: string[] = [];

            await core.executeAsModal(async () => {
                // 创建图层组
                const groupName = `SKU占位符 (${count}个)`;
                
                // 使用 batchPlay 创建图层组
                await action.batchPlay([{
                    _obj: 'make',
                    _target: [{ _ref: 'layerSection' }],
                    layerSectionStart: 0,
                    layerSectionEnd: 1,
                    name: groupName,
                    _options: { dialogOptions: 'dontDisplay' }
                }], { synchronousExecution: true });

                // 解析颜色
                const hexToRGB = (hex: string) => {
                    const h = hex.replace('#', '');
                    return {
                        r: parseInt(h.substring(0, 2), 16),
                        g: parseInt(h.substring(2, 4), 16),
                        b: parseInt(h.substring(4, 6), 16)
                    };
                };
                const rgb = hexToRGB(strokeColor);

                // 创建每个占位符矩形
                for (const placeholder of placeholders) {
                    // 创建矩形路径
                    await action.batchPlay([{
                        _obj: 'make',
                        _target: [{ _ref: 'contentLayer' }],
                        using: {
                            _obj: 'contentLayer',
                            type: {
                                _obj: 'solidColorLayer',
                                color: {
                                    _obj: 'RGBColor',
                                    red: rgb.r,
                                    green: rgb.g,
                                    blue: rgb.b
                                }
                            },
                            shape: {
                                _obj: 'rectangle',
                                unitValueQuadVersion: 1,
                                top: { _unit: 'pixelsUnit', _value: placeholder.y },
                                left: { _unit: 'pixelsUnit', _value: placeholder.x },
                                bottom: { _unit: 'pixelsUnit', _value: placeholder.y + placeholder.height },
                                right: { _unit: 'pixelsUnit', _value: placeholder.x + placeholder.width }
                            }
                        },
                        _options: { dialogOptions: 'dontDisplay' }
                    }], { synchronousExecution: true });

                    // 重命名图层
                    const activeLayer = doc.activeLayers[0] as any;
                    if (activeLayer) {
                        activeLayer.name = placeholder.name;
                        
                        // 设置填充不透明度（使用 batchPlay）
                        if (fillOpacity < 100) {
                            await action.batchPlay([{
                                _obj: 'set',
                                _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                                to: {
                                    _obj: 'layer',
                                    fillOpacity: { _unit: 'percentUnit', _value: fillOpacity }
                                },
                                _options: { dialogOptions: 'dontDisplay' }
                            }], { synchronousExecution: true });
                        }

                        // 添加描边效果
                        await action.batchPlay([{
                            _obj: 'set',
                            _target: [{ _ref: 'property', _property: 'layerEffects' }, { _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                            to: {
                                _obj: 'layerEffects',
                                frameFX: {
                                    _obj: 'frameFX',
                                    enabled: true,
                                    style: { _enum: 'frameStyle', _value: 'insetFrame' },
                                    paintType: { _enum: 'frameFill', _value: 'solidColor' },
                                    color: {
                                        _obj: 'RGBColor',
                                        red: rgb.r,
                                        green: rgb.g,
                                        blue: rgb.b
                                    },
                                    opacity: { _unit: 'percentUnit', _value: 100 },
                                    size: { _unit: 'pixelsUnit', _value: 2 }
                                }
                            },
                            _options: { dialogOptions: 'dontDisplay' }
                        }], { synchronousExecution: true });

                        createdLayers.push(placeholder.name);
                    }
                }

            }, { commandName: '创建 SKU 占位符' });

            return {
                success: true,
                data: {
                    message: `已创建 ${count} 个占位符`,
                    layout,
                    createdLayers,
                    placeholders,
                    usage: '占位符已创建。素材将按占位符位置自动缩放和对齐。',
                    tips: [
                        '占位符图层仅用于定位，批量生成时会被隐藏',
                        '可以手动调整占位符位置和大小',
                        '确保占位符名称遵循 [SKU:占位{n}] 格式以便识别'
                    ]
                }
            };

        } catch (error: any) {
            console.error('[CreateSkuPlaceholders] 错误:', error);
            return { success: false, error: error.message, data: null };
        }
    }
}


// ======================================================================
// 工具 3: 获取/验证 SKU 占位符
// ======================================================================

/**
 * 获取模板中已存在的 SKU 占位符
 */
export class GetSkuPlaceholdersTool implements Tool {
    name = 'getSkuPlaceholders';

    schema: ToolSchema = {
        name: 'getSkuPlaceholders',
        description: '获取模板文档中已存在的 SKU 占位符信息，用于验证模板配置是否正确',
        parameters: {
            type: 'object',
            properties: {
                documentName: {
                    type: 'string',
                    description: '可选：指定文档名称'
                },
                pattern: {
                    type: 'string',
                    description: '占位符匹配模式（正则表达式），默认 "\\[SKU:.*\\]"'
                }
            },
            required: []
        }
    };

    async execute(params: {
        documentName?: string;
        pattern?: string;
    }): Promise<ToolResult<any>> {
        try {
            // 找到目标文档
            let targetDoc: any = null;
            
            if (params.documentName) {
                for (let i = 0; i < app.documents.length; i++) {
                    if (app.documents[i].name === params.documentName) {
                        targetDoc = app.documents[i];
                        break;
                    }
                }
                if (!targetDoc) {
                    return { success: false, error: `未找到文档: ${params.documentName}`, data: null };
                }
            } else {
                targetDoc = app.activeDocument;
                if (!targetDoc) {
                    return { success: false, error: '没有打开的文档', data: null };
                }
            }

            const pattern = params.pattern || '\\[SKU:.*\\]';
            const regex = new RegExp(pattern);

            const placeholders: Array<{
                name: string;
                layerId: number;
                bounds: { left: number; top: number; width: number; height: number };
                visible: boolean;
            }> = [];

            // 递归查找占位符
            const findPlaceholders = (layers: any[]) => {
                for (const layer of layers) {
                    const name = layer.name || '';
                    
                    if (regex.test(name)) {
                        try {
                            const b = layer.bounds;
                            placeholders.push({
                                name: name,
                                layerId: layer.id,
                                bounds: {
                                    left: b[0].value ?? b[0],
                                    top: b[1].value ?? b[1],
                                    width: (b[2].value ?? b[2]) - (b[0].value ?? b[0]),
                                    height: (b[3].value ?? b[3]) - (b[1].value ?? b[1])
                                },
                                visible: layer.visible
                            });
                        } catch (e) {
                            console.warn(`[GetSkuPlaceholders] 无法获取图层边界: ${name}`);
                        }
                    }
                    
                    // 递归检查子图层
                    if (layer.layers && layer.layers.length > 0) {
                        findPlaceholders(layer.layers);
                    }
                }
            };

            findPlaceholders(Array.from(targetDoc.layers));

            if (placeholders.length === 0) {
                return {
                    success: true,
                    data: {
                        documentName: targetDoc.name,
                        placeholderCount: 0,
                        placeholders: [],
                        message: '未找到 SKU 占位符。请使用 createSkuPlaceholders 创建占位符，或手动创建名称符合 [SKU:xxx] 格式的图层。'
                    }
                };
            }

            return {
                success: true,
                data: {
                    documentName: targetDoc.name,
                    placeholderCount: placeholders.length,
                    placeholders,
                    ready: true
                }
            };

        } catch (error: any) {
            console.error('[GetSkuPlaceholders] 错误:', error);
            return { success: false, error: error.message, data: null };
        }
    }
}


// ======================================================================
// 工具 4: 快速导出到 SKU 目录
// ======================================================================

/**
 * 导出当前文档到项目的 SKU 目录
 */
export class ExportToSkuDirTool implements Tool {
    name = 'exportToSkuDir';

    schema: ToolSchema = {
        name: 'exportToSkuDir',
        description: '将当前文档导出到项目目录下的 SKU 文件夹。自动创建目录结构，按命名规则保存文件',
        parameters: {
            type: 'object',
            properties: {
                fileName: {
                    type: 'string',
                    description: '输出文件名（不含扩展名）'
                },
                format: {
                    type: 'string',
                    enum: ['jpg', 'png', 'psd'],
                    description: '输出格式'
                },
                quality: {
                    type: 'number',
                    description: 'JPEG 质量 (1-12)，默认 12'
                },
                subFolder: {
                    type: 'string',
                    description: '可选子文件夹名（如 "3双"、"4双"）'
                },
                hideGuides: {
                    type: 'boolean',
                    description: '导出前是否隐藏辅助线/占位符图层'
                }
            },
            required: ['fileName']
        }
    };

    async execute(params: {
        fileName: string;
        format?: 'jpg' | 'png' | 'psd';
        quality?: number;
        subFolder?: string;
        hideGuides?: boolean;
    }): Promise<ToolResult<any>> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档', data: null };
            }

            const format = params.format || 'jpg';
            const quality = params.quality ?? 12;
            const fileName = params.fileName;

            // 注意：UXP 的文件系统访问需要用户授权
            // 这里我们返回导出指令，由 Agent 端处理实际的文件保存
            
            // 如果需要隐藏辅助线
            const hiddenLayers: string[] = [];
            if (params.hideGuides) {
                await core.executeAsModal(async () => {
                    const hidePattern = /\[SKU:|占位|辅助|参考/;
                    
                    const processLayers = (layers: any[]) => {
                        for (const layer of layers) {
                            if (hidePattern.test(layer.name) && layer.visible) {
                                layer.visible = false;
                                hiddenLayers.push(layer.name);
                            }
                            if (layer.layers) {
                                processLayers(layer.layers);
                            }
                        }
                    };
                    
                    processLayers(Array.from(doc.layers));
                }, { commandName: '隐藏辅助图层' });
            }

            // 构建输出路径信息
            const outputInfo = {
                fileName: `${fileName}.${format}`,
                format,
                quality,
                subFolder: params.subFolder || '',
                relativeDir: params.subFolder ? `SKU/${params.subFolder}` : 'SKU',
                hiddenLayers
            };

            // 实际导出需要使用 Agent 端的文件系统能力
            // 这里返回导出配置供 Agent 处理
            
            return {
                success: true,
                data: {
                    message: '导出配置已准备',
                    exportConfig: outputInfo,
                    documentSize: {
                        width: doc.width,
                        height: doc.height
                    },
                    note: '请使用 Agent 端的文件系统能力完成实际导出',
                    nextStep: '调用 quickExport 工具并指定输出路径'
                }
            };

        } catch (error: any) {
            console.error('[ExportToSkuDir] 错误:', error);
            return { success: false, error: error.message, data: null };
        }
    }
}
