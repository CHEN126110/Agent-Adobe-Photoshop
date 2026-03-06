/**
 * SKU 排版工具
 * 
 * 基于 6.0袜子排版.jsx 脚本的功能，实现智能化 SKU 图片批量生成
 * 
 * 功能：
 * 1. 分析项目结构 - 自动识别素材/模板/配置文件
 * 2. 解析配置文件 - 读取 CSV 配置
 * 3. 执行单个 SKU 排版 - 替换素材、缩放对齐
 * 4. 批量导出 - 按配置批量生成
 */

import { Tool, ToolResult, ToolSchema } from '../types';
import { 
    calculateSmartScale, 
    getContentBounds, 
    SKU_COMBO_CONFIG,
    BoundingBox,
    smartArrangeLayerGroups,
    SmartArrangeConfig,
    DEFAULT_ARRANGE_CONFIG
} from './smart-layout-engine';
import { getDirectExportTarget, saveAsJPEGViaJSX } from './export-folder-service';

const { app, core, action } = require('photoshop');
const storage = require('uxp').storage;
const fs = storage.localFileSystem;

/**
 * 使用 batchPlay 缩放图层（兼容图层组）
 * @param layerId 图层 ID
 * @param scalePercent 缩放百分比（如 80 表示 80%）
 */
async function batchPlayResize(layerId: number, scalePercent: number): Promise<void> {
    // 先选中目标图层
    await action.batchPlay([{
        _obj: 'select',
        _target: [{ _ref: 'layer', _id: layerId }],
        makeVisible: false,
        _options: { dialogOptions: 'dontDisplay' }
    }], { synchronousExecution: true });
    
    // 使用 transform 命令进行缩放（从中心）
    await action.batchPlay([{
        _obj: 'transform',
        freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },   
        width: { _unit: 'percentUnit', _value: scalePercent },
        height: { _unit: 'percentUnit', _value: scalePercent },
        interfaceIconFrameDimmed: { _enum: 'interpolationType', _value: 'bicubicAutomatic' },
        _options: { dialogOptions: 'dontDisplay' }
    }], { synchronousExecution: true });
}

/**
 * 使用 batchPlay 移动图层（兼容图层组）
 * @param layerId 图层 ID
 * @param offsetX 水平偏移（像素）
 * @param offsetY 垂直偏移（像素）
 */
async function batchPlayTranslate(layerId: number, offsetX: number, offsetY: number): Promise<void> {
    // 先选中目标图层
    await action.batchPlay([{
        _obj: 'select',
        _target: [{ _ref: 'layer', _id: layerId }],
        makeVisible: false,
        _options: { dialogOptions: 'dontDisplay' }
    }], { synchronousExecution: true });
    
    // 使用 move 命令移动图层
    await action.batchPlay([{
        _obj: 'move',
        _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
        to: {
            _obj: 'offset',
            horizontal: { _unit: 'pixelsUnit', _value: offsetX },
            vertical: { _unit: 'pixelsUnit', _value: offsetY }
        },
        _options: { dialogOptions: 'dontDisplay' }
    }], { synchronousExecution: true });
}

/**
 * 使用 batchPlay 导出 JPEG（绕过 UXP 安全限制）
 * @param outputPath 完整输出路径
 * @param quality JPEG 质量 (1-12)
 */
async function batchPlayExportJPEG(outputPath: string, quality: number = 10): Promise<boolean> {
    try {
        // 使用 Quick Export as JPEG
        await action.batchPlay([{
            _obj: 'exportDocumentAsFileTypePressed',
            _target: [{ _ref: 'document', _enum: 'ordinal', _value: 'first' }],
            fileType: 'jpg',
            quality: quality,
            _options: { dialogOptions: 'dontDisplay' }
        } as any], { synchronousExecution: true });
        return true;
    } catch (e: any) {
        console.warn(`[batchPlayExportJPEG] 快速导出失败: ${e.message}`);
        return false;
    }
}

/**
 * SKU 配置项
 */
interface SKUConfig {
    templateName: string;      // 模板文件名
    colorCombination: string;  // 颜色组合，如 "红色+黑色|蓝色+白色"
}

/**
 * 颜色配置项
 */
interface ColorConfig {
    name: string;
    hexColor: string;
}

/**
 * 项目结构分析结果
 */
interface ProjectStructure {
    psdFolder?: string;        // PSD 素材文件夹
    templateFolder?: string;   // 模板文件夹
    configFolder?: string;     // 配置文件夹
    outputFolder?: string;     // 输出文件夹
    skuFile?: string;          // SKU 素材文件
    configFile?: string;       // 配置 CSV 文件
    colorFile?: string;        // 颜色配置文件
    note?: string;             // 备注信息
}

/**
 * SKU 排版工具
 */
export class SKULayoutTool implements Tool {
    name = 'skuLayout';

    schema: ToolSchema = {
        name: 'skuLayout',
        description: 'SKU 图片批量排版工具，支持自动识别项目结构、解析配置、执行排版',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    description: '操作类型: analyzeProject, parseConfig, executeOne, executeBatch, getProgress, listLayerSets, execute'
                },
                projectPath: {
                    type: 'string',
                    description: '项目根目录路径'
                },
                config: {
                    type: 'object',
                    description: 'SKU 配置对象'
                },
                templateIndex: {
                    type: 'number',
                    description: '模板索引（用于 executeOne）'
                },
                outputFormat: {
                    type: 'string',
                    description: '输出格式: jpg, png'
                },
                quality: {
                    type: 'number',
                    description: 'JPEG 质量 (1-12)'
                },
                combos: {
                    type: 'array',
                    description: '颜色组合列表，每个元素是一个颜色名称数组'
                },
                outputDir: {
                    type: 'string',
                    description: '输出目录路径'
                },
                useSmartArrange: {
                    type: 'boolean',
                    description: '是否使用智能排列模式（不需要精确占位矩形，在目标区域内自动计算排列）'
                },
                arrangeConfig: {
                    type: 'object',
                    description: '智能排列配置 {spacingRatio: 间距比例, verticalOffsetPercent: 垂直偏移百分比}'
                }
            },
            required: ['action']
        }
    };

    // 缓存
    private projectStructure: ProjectStructure | null = null;
    private skuConfigs: SKUConfig[] = [];
    private colorConfigs: Map<number, ColorConfig> = new Map();
    private progress = { current: 0, total: 0, message: '' };

    async execute(params: {
        action: string;
        projectPath?: string;
        config?: any;
        templateIndex?: number;
        outputFormat?: string;
        quality?: number;
        combos?: string[][];
        outputDir?: string;
        useSmartArrange?: boolean;
        arrangeConfig?: Partial<SmartArrangeConfig>;
        noteFilePrefix?: string;   // 自选备注文件名前缀
        isNoteTemplate?: boolean;  // 是否为自选备注模式
    }): Promise<ToolResult<any>> {
        try {
            switch (params.action) {
                case 'analyzeProject':
                    return await this.analyzeProject(params.projectPath);
                
                case 'parseConfig':
                    return await this.parseConfigFiles();
                
                case 'executeOne':
                    return await this.executeOneSKU(params.templateIndex || 0, params.config);
                
                case 'executeBatch':
                    return await this.executeBatch(params.config);
                
                case 'getProgress':
                    return { success: true, data: this.progress };
                
                case 'listLayerSets':
                    return await this.listLayerSets();
                
                case 'copyLayerSetToTemplate':
                    return await this.copyLayerSetToTemplate(params.config);
                
                case 'execute':
                    return await this.executeComboLayout({
                        combos: params.combos || [],
                        outputDir: params.outputDir,
                        format: params.outputFormat || 'jpg',
                        quality: params.quality || 12,
                        useSmartArrange: params.useSmartArrange,
                        arrangeConfig: params.arrangeConfig,
                        noteFilePrefix: params.noteFilePrefix,  // 自选备注文件名前缀
                        isNoteTemplate: params.isNoteTemplate   // 是否为自选备注模式
                    });
                
                case 'exportNote':
                    // ★ 自选备注专用：直接导出当前文档，不复制图层
                    return await this.exportNoteTemplate({
                        outputDir: params.outputDir,
                        format: params.outputFormat || 'jpg',
                        quality: params.quality || 12,
                        noteFileName: params.noteFilePrefix || '自选备注'
                    });
                
                case 'arrangeDynamic':
                    // ★ 动态排列模式（类似 6.1颜色排列-动态调整.jsx）
                    // 用于自选备注：从 SKU 素材复制颜色，动态排列，导出
                    return await this.executeNoteWithDynamicArrange({
                        colors: params.combos?.[0] || [],
                        outputDir: params.outputDir,
                        format: params.outputFormat || 'jpg',
                        quality: params.quality || 12,
                        noteFileName: params.noteFilePrefix || '自选备注'
                    });
                
                default:
                    return { success: false, error: `未知操作: ${params.action}`, data: null };
            }
        } catch (error: any) {
            console.error('[SKULayout] 错误:', error);
            return { success: false, error: error.message, data: null };
        }
    }

    /**
     * 分析项目结构
     */
    private async analyzeProject(projectPath?: string): Promise<ToolResult<ProjectStructure>> {
        try {
            if (!projectPath) {
                // 尝试从当前文档路径推断
                const doc = app.activeDocument;
                if (!doc) {
                    return { success: false, error: '请指定项目路径或打开一个文档', data: null };
                }
                // UXP 无法直接获取文档路径，返回提示
                return { 
                    success: false, 
                    error: '请提供项目根目录路径',
                    data: null 
                };
            }

            const structure: ProjectStructure = {};
            
            // 预期的文件夹结构：
            // 项目根目录/
            //   PSD/          - 素材 PSD 文件
            //   模板文件/     - 模板 PSD 文件
            //   配置文件/     - CSV 配置文件
            //   SKU/          - 输出目录

            // 检查各个文件夹
            const expectedFolders = [
                { key: 'psdFolder', name: 'PSD' },
                { key: 'templateFolder', name: '模板文件' },
                { key: 'configFolder', name: '配置文件' },
                { key: 'outputFolder', name: 'SKU' }
            ];

            console.log(`[SKULayout] 分析项目结构: ${projectPath}`);

            // 这里需要使用 UXP 文件系统 API
            // 由于 UXP 限制，实际文件系统访问需要用户授权
            // 返回预期结构供参考
            
            this.projectStructure = {
                psdFolder: `${projectPath}/PSD`,
                templateFolder: `${projectPath}/模板文件`,
                configFolder: `${projectPath}/配置文件`,
                outputFolder: `${projectPath}/SKU`
            };

            return {
                success: true,
                data: {
                    ...this.projectStructure,
                    note: '请确认以上路径存在。SKU 文件应位于 PSD 文件夹中，配置文件应位于配置文件文件夹中。'
                }
            };

        } catch (error: any) {
            return { success: false, error: error.message, data: null };
        }
    }

    /**
     * 解析配置文件
     * 由于 UXP 文件系统限制，这里返回配置文件格式说明
     */
    private async parseConfigFiles(): Promise<ToolResult<any>> {
        return {
            success: true,
            data: {
                configFormat: {
                    description: 'CSV 配置文件格式说明',
                    columns: ['模板名称', '颜色组合'],
                    example: [
                        '模板1.psd,1|2+3',
                        '模板2.psd,4+5|6'
                    ],
                    colorFormat: {
                        description: '颜色配置文件格式',
                        columns: ['颜色名称', 'HEX颜色值'],
                        example: [
                            '红色,FF0000',
                            '黑色,000000'
                        ]
                    }
                },
                note: '请在 Agent 端读取 CSV 文件并通过 executeOne 或 executeBatch 传入配置'
            }
        };
    }

    /**
     * 列出当前文档的所有图层组（用于识别可用素材）
     */
    /**
     * 列出当前文档中的所有图层组（LayerSets）
     * 
     * 注意：SKU 素材文件的结构是图层组，每个颜色是一个图层组
     * 图层组结构示例：
     *   白色（图层组）
     *     ├─ 白色（文字图层）
     *     ├─ 主体（图片图层）
     *     └─ 阴影（图层）
     * 
     * UXP API 注意：Document 没有 layerSets 属性，需要从 layers 过滤
     */
    private async listLayerSets(): Promise<ToolResult<any>> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档', data: null };
            }

            const layerSets: Array<{ name: string; index: number; layerCount: number; visible: boolean }> = [];
            
            // UXP API: 从 doc.layers 中过滤出图层组（有 layers 子属性的就是图层组）
            const layers = doc.layers;
            console.log(`[listLayerSets] 文档: ${doc.name}, 顶层图层数: ${layers.length}`);

            for (let i = 0; i < layers.length; i++) {
                const layer = layers[i] as any;
                
                // 判断是否为图层组：有 layers 子属性且长度 > 0
                const isGroup = layer.layers && layer.layers.length > 0;
                
                if (isGroup) {
                    const name = (layer.name || '').trim();
                    
                    // 排除非颜色的图层组（如"参考组"、"背景"等）
                    const excludeKeywords = ['参考组', '参考', '背景', 'background', 'ref'];
                    const isColorGroup = !excludeKeywords.some(
                        keyword => name.toLowerCase().includes(keyword.toLowerCase())
                    );
                    
                    layerSets.push({
                        name,
                        index: i,
                        layerCount: layer.layers.length,
                        visible: layer.visible !== false
                    });
                    
                    console.log(`[listLayerSets]   [${i}] "${name}" (${layer.layers.length} 子图层) ${isColorGroup ? '✓ 颜色' : '○ 非颜色'}`);
                }
            }

            return {
                success: true,
                data: {
                    documentName: doc.name,
                    layerSetCount: layerSets.length,
                    layerSets
                }
            };

        } catch (error: any) {
            console.error('[listLayerSets] 错误:', error);
            return { success: false, error: error.message, data: null };
        }
    }

    /**
     * 复制图层组到模板
     */
    private async copyLayerSetToTemplate(config: {
        sourceDocName: string;
        layerSetName: string;
        targetDocName: string;
        targetBounds?: { left: number; top: number; width: number; height: number };
        alignment?: 'center' | 'left' | 'right' | 'top' | 'bottom';
    }): Promise<ToolResult<any>> {
        if (!config) {
            return { success: false, error: '缺少配置参数', data: null };
        }

        try {
            // 找到源文档
            let sourceDoc: any = null;
            let targetDoc: any = null;

            for (let i = 0; i < app.documents.length; i++) {
                const doc = app.documents[i];
                if (doc.name === config.sourceDocName) {
                    sourceDoc = doc;
                }
                if (doc.name === config.targetDocName) {
                    targetDoc = doc;
                }
            }

            if (!sourceDoc) {
                return { success: false, error: `未找到源文档: ${config.sourceDocName}`, data: null };
            }
            if (!targetDoc) {
                return { success: false, error: `未找到目标文档: ${config.targetDocName}`, data: null };
            }

            // 在源文档中找到图层组
            app.activeDocument = sourceDoc;
            const layers = sourceDoc.layers;
            let targetSet: any = null;

            for (let i = 0; i < layers.length; i++) {
                const layer = layers[i] as any;
                // 检查是否是图层组（有子图层）且名称匹配
                const isGroup = layer.layers && layer.layers.length > 0;
                if (isGroup && (layer.name || '').trim() === config.layerSetName.trim()) {
                    targetSet = layer;
                    break;
                }
            }

            if (!targetSet) {
                return { success: false, error: `未找到图层组: ${config.layerSetName}`, data: null };
            }

            // 复制图层组到目标文档
            await core.executeAsModal(async () => {
                // 选中图层组
                sourceDoc.activeLayer = targetSet;

                // 复制到目标文档
                await action.batchPlay([{
                    _obj: 'duplicate',
                    _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                    to: { _ref: 'document', _name: config.targetDocName },
                    _options: { dialogOptions: 'dontDisplay' }
                }], { synchronousExecution: true });

                // 切换到目标文档进行调整
                app.activeDocument = targetDoc;
                const copiedLayer = targetDoc.activeLayer;

                // 如果提供了目标边界，进行缩放和对齐
                if (config.targetBounds && copiedLayer) {
                    const bounds = copiedLayer.bounds;
                    const layerWidth = bounds[2] - bounds[0];
                    const layerHeight = bounds[3] - bounds[1];

                    // 计算缩放比例（等比缩放，取较小值以适应目标区域）
                    const scaleX = config.targetBounds.width / layerWidth;
                    const scaleY = config.targetBounds.height / layerHeight;
                    const scale = Math.min(scaleX, scaleY);

                    if (Math.abs(scale - 1) > 0.01) {
                        copiedLayer.resize(scale * 100, scale * 100);
                    }

                    // 移动到目标位置（居中对齐）
                    const newBounds = copiedLayer.bounds;
                    const newWidth = newBounds[2] - newBounds[0];
                    const newHeight = newBounds[3] - newBounds[1];

                    const targetCenterX = config.targetBounds.left + config.targetBounds.width / 2;
                    const targetCenterY = config.targetBounds.top + config.targetBounds.height / 2;
                    const layerCenterX = newBounds[0] + newWidth / 2;
                    const layerCenterY = newBounds[1] + newHeight / 2;

                    copiedLayer.translate(targetCenterX - layerCenterX, targetCenterY - layerCenterY);
                }

            }, { commandName: 'Copy Layer Set to Template' });

            return {
                success: true,
                data: {
                    message: `已复制图层组 "${config.layerSetName}" 到 "${config.targetDocName}"`,
                    layerSetName: config.layerSetName
                }
            };

        } catch (error: any) {
            console.error('[SKULayout] copyLayerSetToTemplate 错误:', error);
            return { success: false, error: error.message, data: null };
        }
    }

    /**
     * 执行单个 SKU 排版
     */
    private async executeOneSKU(index: number, config?: {
        skuDocName: string;           // SKU 素材文档名
        templateDocName: string;      // 模板文档名
        colorMappings: Array<{
            layerIndex: number;        // 模板中的图层索引
            colorNames: string[];      // 要填充的颜色名称（从素材文档的图层组）
        }>;
        outputPath?: string;
        outputName?: string;
        quality?: number;
    }): Promise<ToolResult<any>> {
        if (!config) {
            return { success: false, error: '缺少配置参数', data: null };
        }

        try {
            this.progress = { current: index, total: 1, message: '开始处理...' };

            // 找到文档
            let skuDoc: any = null;
            let templateDoc: any = null;

            for (let i = 0; i < app.documents.length; i++) {
                const doc = app.documents[i];
                if (doc.name === config.skuDocName) {
                    skuDoc = doc;
                }
                if (doc.name === config.templateDocName) {
                    templateDoc = doc;
                }
            }

            if (!skuDoc) {
                return { success: false, error: `未找到 SKU 文档: ${config.skuDocName}`, data: null };
            }
            if (!templateDoc) {
                return { success: false, error: `未找到模板文档: ${config.templateDocName}`, data: null };
            }

            const processedLayers: string[] = [];

            await core.executeAsModal(async () => {
                // 处理每个颜色映射
                for (const mapping of config.colorMappings) {
                    const templateLayers = templateDoc.layers;
                    
                    if (mapping.layerIndex >= templateLayers.length) {
                        console.warn(`[SKULayout] 图层索引 ${mapping.layerIndex} 超出范围`);
                        continue;
                    }

                    const templateLayer = templateLayers[mapping.layerIndex];
                    const templateBounds = templateLayer.bounds;
                    const targetBounds = {
                        left: templateBounds[0].value || templateBounds[0],
                        top: templateBounds[1].value || templateBounds[1],
                        width: (templateBounds[2].value || templateBounds[2]) - (templateBounds[0].value || templateBounds[0]),
                        height: (templateBounds[3].value || templateBounds[3]) - (templateBounds[1].value || templateBounds[1])
                    };

                    // 复制每个颜色的图层组
                    for (const colorName of mapping.colorNames) {
                        // 在 SKU 文档中找到对应的图层组
                        app.activeDocument = skuDoc;
                        const layers = skuDoc.layers;
                        let colorSet: any = null;

                        for (let s = 0; s < layers.length; s++) {
                            const layer = layers[s] as any;
                            // 检查是否是图层组（有子图层）且名称匹配
                            const isGroup = layer.layers && layer.layers.length > 0;
                            if (isGroup && (layer.name || '').trim() === colorName.trim()) {
                                colorSet = layer;
                                break;
                            }
                        }

                        if (!colorSet) {
                            console.warn(`[SKULayout] 未找到素材图层组: ${colorName}`);
                            continue;
                        }

                        // 复制到模板
                        skuDoc.activeLayer = colorSet;
                        await action.batchPlay([{
                            _obj: 'duplicate',
                            _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                            to: { _ref: 'document', _name: config.templateDocName },
                            _options: { dialogOptions: 'dontDisplay' }
                        }], { synchronousExecution: true });

                        // 切换到模板文档调整
                        app.activeDocument = templateDoc;
                        const copiedLayer = templateDoc.activeLayer;

                        if (copiedLayer) {
                            // 缩放以适应目标区域
                            const bounds = copiedLayer.bounds;
                            const layerWidth = (bounds[2].value || bounds[2]) - (bounds[0].value || bounds[0]);
                            const layerHeight = (bounds[3].value || bounds[3]) - (bounds[1].value || bounds[1]);

                            const scaleX = targetBounds.width / layerWidth;
                            const scaleY = targetBounds.height / layerHeight;
                            const scale = Math.min(scaleX, scaleY);

                            if (Math.abs(scale - 1) > 0.01) {
                                copiedLayer.resize(scale * 100, scale * 100);
                            }

                            // 居中对齐
                            const newBounds = copiedLayer.bounds;
                            const newWidth = (newBounds[2].value || newBounds[2]) - (newBounds[0].value || newBounds[0]);
                            const newHeight = (newBounds[3].value || newBounds[3]) - (newBounds[1].value || newBounds[1]);

                            const targetCenterX = targetBounds.left + targetBounds.width / 2;
                            const targetCenterY = targetBounds.top + targetBounds.height / 2;
                            const layerCenterX = (newBounds[0].value || newBounds[0]) + newWidth / 2;
                            const layerCenterY = (newBounds[1].value || newBounds[1]) + newHeight / 2;

                            copiedLayer.translate(targetCenterX - layerCenterX, targetCenterY - layerCenterY);
                        }

                        processedLayers.push(colorName);
                    }
                }

            }, { commandName: 'Execute SKU Layout' });

            this.progress = { current: 1, total: 1, message: '完成' };

            return {
                success: true,
                data: {
                    message: 'SKU 排版完成',
                    processedLayers,
                    templateDoc: config.templateDocName
                }
            };

        } catch (error: any) {
            console.error('[SKULayout] executeOneSKU 错误:', error);
            return { success: false, error: error.message, data: null };
        }
    }

    /**
     * 执行颜色组合排版
     * 这是智能排版的核心方法，接收颜色组合并自动处理
     */
    /**
     * ★ 自选备注专用导出
     * 
     * 自选备注是一张**提示图**，告诉买家可以自选颜色
     * 不需要复制颜色图层，只需要直接导出当前模板即可
     * 
     * @param config 导出配置
     * @returns 导出结果
     */
    /**
     * 自选备注动态排列导出
     * 
     * ★★★ 核心逻辑（参考 6.1颜色排列-动态调整.jsx）★★★
     * 1. 从 SKU 素材复制指定颜色图层组到当前文档
     * 2. 动态排列：根据第一个图层组的宽度计算间距，水平排列
     * 3. 编组、缩放到画布宽度、居中、下移
     * 4. 取消编组
     * 5. 导出到临时目录（由 Agent 复制到正确位置）
     */
    private async executeNoteWithDynamicArrange(config: {
        colors: string[];           // 简单模式：所有颜色放第一个占位区域
        colorsByRegion?: string[][]; // 高级模式：按区域分组 [['白','粉'], ['蓝','灰']]
        colorString?: string;        // 字符串模式："白+粉|蓝+灰"（参考 6.0袜子排版.jsx CSV 格式）
        outputDir?: string;
        format: string;
        quality: number;
        noteFileName: string;
    }): Promise<ToolResult<any>> {
        const { noteFileName } = config;
        
        // ★★★ 6.0袜子排版.jsx 的颜色分区逻辑 ★★★
        // CSV 格式：4装自选备注.tif, 1+2+3+4+5|6+7+8+9+10
        //   - "|" 分隔不同占位区域
        //   - "+" 分隔同一区域内的颜色
        // 每个区域对应一个占位矩形（doc.artLayers）
        
        // 解析颜色分区
        let colorRegions: string[][];
        
        if (config.colorsByRegion && config.colorsByRegion.length > 0) {
            // 高级模式：直接使用按区域分组的颜色
            colorRegions = config.colorsByRegion;
            console.log(`[SKULayout] 使用按区域分组的颜色 (${colorRegions.length} 个区域)`);
        } else if (config.colorString && config.colorString.includes('|')) {
            // 字符串模式：解析 "白+粉|蓝+灰" 格式
            colorRegions = config.colorString.split('|').map(region => 
                region.split('+').map(c => c.trim()).filter(c => c)
            );
            console.log(`[SKULayout] 解析颜色字符串: "${config.colorString}" → ${colorRegions.length} 个区域`);
        } else if (config.colors && config.colors.length > 0) {
            // 简单模式：所有颜色放第一个区域
            colorRegions = [config.colors];
            console.log(`[SKULayout] 简单模式: ${config.colors.length} 个颜色放入单一区域`);
        } else {
            return { success: false, error: '没有提供颜色列表', data: null };
        }
        
        const totalColors = colorRegions.reduce((sum, r) => sum + r.length, 0);
        if (totalColors === 0) {
            return { success: false, error: '颜色列表为空', data: null };
        }
        
        try {
            console.log(`[SKULayout] ★★★ 自选备注动态排列模式（多区域）★★★`);
            console.log(`[SKULayout]   区域数: ${colorRegions.length}`);
            colorRegions.forEach((region, i) => {
                console.log(`[SKULayout]   区域 ${i + 1}: ${region.join(' + ')}`);
            });
            console.log(`[SKULayout]   总颜色数: ${totalColors}`);
            console.log(`[SKULayout]   输出文件名: ${noteFileName}`);
            
            // 1. 识别 SKU 素材文档和自选备注模板
            let skuDoc: any = null;
            let templateDoc: any = app.activeDocument;  // 当前活动文档应该是自选备注模板
            
            for (let i = 0; i < app.documents.length; i++) {
                const doc = app.documents[i];
                const name = (doc.name || '').toLowerCase();
                if (name.includes('sku') || name.includes('素材')) {
                    skuDoc = doc;
                    break;
                }
            }
            
            if (!skuDoc) {
                return { success: false, error: '未找到 SKU 素材文档（名称应包含 "SKU"）', data: null };
            }
            
            if (!templateDoc) {
                return { success: false, error: '没有打开的文档', data: null };
            }
            
            console.log(`[SKULayout]   SKU 素材: ${skuDoc.name}`);
            console.log(`[SKULayout]   模板: ${templateDoc.name}`);
            
            // 2. 获取画布尺寸
            const canvasWidth = templateDoc.width;
            const canvasHeight = templateDoc.height;
            console.log(`[SKULayout]   画布: ${canvasWidth}x${canvasHeight}`);
            
            // ★★★ 6.0袜子排版.jsx 核心逻辑：按区域处理颜色 ★★★
            // CSV: 4装自选备注.tif, 1+2+3+4+5|6+7+8+9+10
            //   - "|" 分隔不同占位区域
            //   - "+" 分隔同一区域内的颜色
            // 每个区域对应一个占位矩形（doc.artLayers）
            
            await core.executeAsModal(async () => {
                // 4. 切换到模板，获取占位矩形
                app.activeDocument = templateDoc;
                
                const templateLayers = templateDoc.layers || [];
                console.log(`[SKULayout] 查找占位矩形（顶层普通图层），顶层图层数: ${templateLayers.length}`);
                
                // 遍历顶层图层，找出普通图层（非图层组）作为占位矩形
                const placeholderLayers: any[] = [];
                for (let i = 0; i < templateLayers.length; i++) {
                    const layer = templateLayers[i];
                    const layerKind = layer.kind || 'unknown';
                    const isGroup = layerKind === 'group';
                    
                    console.log(`[SKULayout]   [${i}] "${layer.name}" (kind: ${layerKind})`);
                    
                    if (!isGroup) {
                        placeholderLayers.push(layer);
                        console.log(`[SKULayout]   ✓ 占位矩形: ${layer.name}`);
                    } else {
                        console.log(`[SKULayout]   → 跳过图层组: ${layer.name}`);
                    }
                }
                
                // 按位置排序（从左到右，从上到下）
                const sortedPlaceholders = placeholderLayers
                    .map(layer => {
                        const b = layer.bounds;
                        const left = b?._left ?? b?.[0]?.value ?? b?.[0] ?? 0;
                        const top = b?._top ?? b?.[1]?.value ?? b?.[1] ?? 0;
                        const right = b?._right ?? b?.[2]?.value ?? b?.[2] ?? 0;
                        const bottom = b?._bottom ?? b?.[3]?.value ?? b?.[3] ?? 0;
                        return { layer, left, top, right, bottom, width: right - left, height: bottom - top };
                    })
                    .filter(item => item.width > 0 && item.height > 0)
                    .sort((a, b) => {
                        // 先按 top 排序（上到下），再按 left 排序（左到右）
                        if (Math.abs(a.top - b.top) > 50) return a.top - b.top;
                        return a.left - b.left;
                    });
                
                console.log(`[SKULayout] 找到 ${sortedPlaceholders.length} 个占位矩形`);
                sortedPlaceholders.forEach((p, i) => {
                    console.log(`[SKULayout]   ${i + 1}. ${p.layer.name} (${p.width.toFixed(0)}x${p.height.toFixed(0)}) @ (${p.left.toFixed(0)}, ${p.top.toFixed(0)})`);
                });
                
                // ★★★ 6.0袜子排版.jsx 验证逻辑 ★★★
                // if (num != xlsstr.length) { writelog("模板图层与配制不匹配"); return; }
                const numPlaceholders = sortedPlaceholders.length;
                let numRegions = colorRegions.length;
                
                console.log(`[SKULayout] 占位矩形数: ${numPlaceholders}, 颜色区域数: ${numRegions}`);
                
                // ★★★ 智能分配：简单模式下自动分配颜色到多个占位区域 ★★★
                // 当只传入一个颜色区域但模板有多个占位矩形时，自动平均分配
                if (numRegions === 1 && numPlaceholders > 1 && colorRegions[0].length >= numPlaceholders) {
                    const allColors = colorRegions[0];
                    const colorsPerRegion = Math.ceil(allColors.length / numPlaceholders);
                    
                    console.log(`[SKULayout] ★ 智能分配: ${allColors.length} 个颜色 → ${numPlaceholders} 个区域 (每区域约 ${colorsPerRegion} 个)`);
                    
                    colorRegions = [];
                    for (let i = 0; i < numPlaceholders; i++) {
                        const start = i * colorsPerRegion;
                        const end = Math.min(start + colorsPerRegion, allColors.length);
                        const regionColors = allColors.slice(start, end);
                        colorRegions.push(regionColors);
                        console.log(`[SKULayout]   区域 ${i + 1}: ${regionColors.join(' + ')}`);
                    }
                    numRegions = colorRegions.length;
                }
                
                // 如果区域数 > 占位矩形数，警告但继续（多余的区域放入最后一个占位矩形）
                // 如果区域数 < 占位矩形数，警告但继续（多余的占位矩形留空）
                if (numRegions !== numPlaceholders && numPlaceholders > 0) {
                    console.warn(`[SKULayout] ⚠️ 占位矩形数(${numPlaceholders})与颜色区域数(${numRegions})不匹配`);
                    if (numRegions > numPlaceholders) {
                        console.warn(`[SKULayout]   多余的 ${numRegions - numPlaceholders} 个区域将合并到最后一个占位矩形`);
                    }
                }
                
                // 如果没有占位矩形，使用画布作为单一区域
                if (numPlaceholders === 0) {
                    sortedPlaceholders.push({
                        layer: null,
                        left: canvasWidth * 0.05,
                        top: canvasHeight * 0.35,
                        right: canvasWidth * 0.95,
                        bottom: canvasHeight * 0.95,
                        width: canvasWidth * 0.9,
                        height: canvasHeight * 0.6
                    });
                    console.log(`[SKULayout] 无占位矩形，使用画布下半部分`);
                }
                
                // ★★★ 6.0袜子排版.jsx 双层循环 ★★★
                // for (var j = 0; j < lays.length; j++) {      // 遍历每个占位矩形
                //     var lay = lays[j];
                //     var rect = lay.bounds;
                //     var imgs = xlsstr[j].split("+");         // 该区域的颜色
                //     for (var k = 0; k < imgs.length; k++) {  // 遍历每个颜色
                //         copylay(); suofang(); duqi();
                //     }
                //     FBfun();  // 水平分布
                // }
                
                const effectivePlaceholders = sortedPlaceholders.length;
                
                // 遍历每个占位区域
                for (let regionIdx = 0; regionIdx < Math.max(numRegions, effectivePlaceholders); regionIdx++) {
                    // 确定当前使用的占位矩形（如果区域数 > 占位矩形数，最后的区域共用最后一个占位矩形）
                    const placeholderIdx = Math.min(regionIdx, effectivePlaceholders - 1);
                    const placeholder = sortedPlaceholders[placeholderIdx];
                    
                    // 确定当前区域的颜色（如果占位矩形数 > 区域数，多余的占位矩形跳过）
                    if (regionIdx >= numRegions) {
                        console.log(`[SKULayout] 跳过空区域 ${regionIdx + 1}（无对应颜色）`);
                        continue;
                    }
                    
                    const regionColors = colorRegions[regionIdx];
                    const regionColorCount = regionColors.length;
                    
                    if (regionColorCount === 0) {
                        console.log(`[SKULayout] 跳过空区域 ${regionIdx + 1}`);
                        continue;
                    }
                    
                    console.log(`[SKULayout] ===== 处理区域 ${regionIdx + 1}/${numRegions} =====`);
                    console.log(`[SKULayout]   占位矩形: ${placeholder.layer?.name || '画布回退'}`);
                    console.log(`[SKULayout]   颜色: ${regionColors.join(' + ')}`);
                    
                    const placeholderRect = {
                        left: placeholder.left,
                        top: placeholder.top,
                        right: placeholder.right,
                        bottom: placeholder.bottom,
                        width: placeholder.width,
                        height: placeholder.height
                    };
                    
                    const placeholderCenterX = (placeholderRect.left + placeholderRect.right) / 2;
                    const placeholderCenterY = (placeholderRect.top + placeholderRect.bottom) / 2;
                    
                    // ★★★ 6.0袜子排版.jsx 核心：每个颜色缩放到【整个占位矩形】★★★
                    // 不是 perColorWidth = width / count，而是 targetSize = 整个占位矩形
                    // 然后通过 FBfun() 水平分布来调整间距
                    const targetWidth = placeholderRect.width;
                    const targetHeight = placeholderRect.height;
                    
                    console.log(`[SKULayout]   占位区域: ${targetWidth.toFixed(0)}x${targetHeight.toFixed(0)}`);
                    console.log(`[SKULayout]   颜色数: ${regionColorCount}，每个颜色缩放到整个占位区域后再分布`);
                    
                    // 存储当前区域复制的图层 ID（用于分布）
                    const regionLayerIds: number[] = [];
                    
                    // 遍历该区域的每个颜色
                    for (let colorIdx = 0; colorIdx < regionColorCount; colorIdx++) {
                        const colorName = regionColors[colorIdx];
                        if (!colorName) continue;
                        
                        console.log(`[SKULayout]   颜色 ${colorIdx + 1}/${regionColorCount}: ${colorName}`);
                        
                        // 切换到 SKU 素材查找颜色图层
                        app.activeDocument = skuDoc;
                        let foundLayer: any = null;
                        
                        const skuLayers = skuDoc.layers || [];
                        for (let i = 0; i < skuLayers.length; i++) {
                            const layer = skuLayers[i];
                            const layerName = (layer.name || '').replace(/\s+/g, '').trim();
                            const searchName = colorName.replace(/\s+/g, '').trim();
                            
                            if (layerName === searchName || layer.name.trim() === colorName.trim()) {
                                foundLayer = layer;
                                break;
                            }
                        }
                        
                        if (!foundLayer) {
                            console.warn(`[SKULayout]   ⚠️ 未找到颜色图层: ${colorName}`);
                            continue;
                        }
                        
                        // 复制颜色图层到模板
                        try {
                            // ★★★ 关键修复：参考 6.0袜子排版.jsx 第 843 行 ★★★
                            // doc.activeLayer = lay;  ← 在复制前激活模板的顶层图层
                            // 这确保 duplicate 命令将新图层放在顶层，而非当前激活的组内
                            
                            // 步骤 1：切换到模板文档，选中占位矩形（顶层图层）
                            app.activeDocument = templateDoc;
                            const placeholder = sortedPlaceholders[Math.min(regionIdx, sortedPlaceholders.length - 1)];
                            if (placeholder?.layer?.id) {
                                await action.batchPlay([{
                                    _obj: 'select',
                                    _target: [{ _ref: 'layer', _id: placeholder.layer.id }],
                                    makeVisible: false,
                                    _options: { dialogOptions: 'dontDisplay' }
                                }], { synchronousExecution: true });
                                console.log(`[SKULayout]   准备: 选中模板占位矩形 "${placeholder.layer.name}"`);
                            }
                            
                            // 步骤 2：切回素材文档，选中颜色图层
                            app.activeDocument = skuDoc;
                            await action.batchPlay([{
                                _obj: 'select',
                                _target: [{ _ref: 'layer', _id: foundLayer.id }],
                                makeVisible: false,
                                _options: { dialogOptions: 'dontDisplay' }
                            }], { synchronousExecution: true });
                            
                            // 步骤 3：复制到模板文档
                            await action.batchPlay([{
                                _obj: 'duplicate',
                                _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                                to: { _ref: 'document', _name: templateDoc.name },
                                _options: { dialogOptions: 'dontDisplay' }
                            }], { synchronousExecution: true });
                            
                            // ★★★ 关键：切换到模板文档后使用 activeLayers ★★★
                            // 参考 6.0袜子排版.jsx 第 872 行：doc.activeLayer
                            app.activeDocument = templateDoc;
                            const copiedLayer = templateDoc.activeLayers?.[0];
                            const newLayerId = copiedLayer?.id;
                            
                            if (!newLayerId) {
                                console.warn(`[SKULayout]   ⚠️ 复制失败: ${colorName}`);
                                continue;
                            }
                            
                            // ★★★ 诊断：验证图层位置是否在顶层 ★★★
                            const layerParent = copiedLayer?.parent;
                            if (layerParent && layerParent !== templateDoc) {
                                console.error(`[SKULayout]   ⚠️ 警告: 图层 "${colorName}" 不在顶层，父级是 "${layerParent.name || 'unknown'}"`);
                            } else {
                                console.log(`[SKULayout]   ✓ 确认: 图层 "${colorName}" 在文档顶层`);
                            }
                            
                            regionLayerIds.push(newLayerId);
                            console.log(`[SKULayout]   ✓ 复制: ${colorName} -> ID: ${newLayerId}`);
                            
                            // 获取图层 bounds 并执行缩放
                            const layer = templateDoc.activeLayers?.[0];
                            if (!layer?.bounds) continue;
                            
                            const b = layer.bounds;
                            const layerLeft = b._left ?? b[0]?.value ?? b[0] ?? 0;
                            const layerTop = b._top ?? b[1]?.value ?? b[1] ?? 0;
                            const layerRight = b._right ?? b[2]?.value ?? b[2] ?? 0;
                            const layerBottom = b._bottom ?? b[3]?.value ?? b[3] ?? 0;
                            const layerWidth = layerRight - layerLeft;
                            const layerHeight = layerBottom - layerTop;
                            
                            // ★★★ suofang(lay, rect, 3) - 等比缩放到【整个占位区域】★★★
                            // 6.0袜子排版.jsx 第 876 行：
                            // suofang(layarr[k], [rect[2].value - rect[0].value, rect[3].value - rect[1].value], 3);
                            // type=3: 等比缩放，确保完全在矩形内（取较小的缩放比）
                            let scaleFactor: number;
                            const scaleX = targetWidth / layerWidth;
                            const scaleY = targetHeight / layerHeight;
                            
                            // type 3: 等比缩放，完全在矩形内
                            if (layerWidth > layerHeight) {
                                // 宽图：检查高度是否超出
                                if (scaleX * layerHeight > targetHeight) {
                                    scaleFactor = scaleY;  // 以高度为准
                                } else {
                                    scaleFactor = scaleX;  // 以宽度为准
                                }
                            } else {
                                // 高图：检查宽度是否超出
                                if (scaleY * layerWidth > targetWidth) {
                                    scaleFactor = scaleX;  // 以宽度为准
                                } else {
                                    scaleFactor = scaleY;  // 以高度为准
                                }
                            }
                            
                            const scalePercent = scaleFactor * 100;
                            
                            if (scalePercent < 99 || scalePercent > 101) {
                                await action.batchPlay([{
                                    _obj: 'transform',
                                    _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                                    freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
                                    width: { _unit: 'percentUnit', _value: scalePercent },
                                    height: { _unit: 'percentUnit', _value: scalePercent },
                                    interfaceIconFrameDimmed: { _enum: 'interpolationType', _value: 'bicubic' },
                                    _options: { dialogOptions: 'dontDisplay' }
                                }], { synchronousExecution: true });
                                console.log(`[SKULayout]     缩放: ${scalePercent.toFixed(1)}%`);
                            }
                            
                            // ★★★ duqi(lay, layarr[k], 2, type2) - 对齐到占位区域 ★★★
                            // 6.0袜子排版.jsx 第 877-889 行
                            // type2: 4=左对齐, 5=居中, 6=右对齐
                            const newBounds = templateDoc.activeLayers?.[0]?.bounds;
                            if (newBounds) {
                                const nb = newBounds;
                                const newLeft = nb._left ?? nb[0]?.value ?? nb[0] ?? 0;
                                const newTop = nb._top ?? nb[1]?.value ?? nb[1] ?? 0;
                                const newRight = nb._right ?? nb[2]?.value ?? nb[2] ?? 0;
                                const newBottom = nb._bottom ?? nb[3]?.value ?? nb[3] ?? 0;
                                const newWidth = newRight - newLeft;
                                const newHeight = newBottom - newTop;
                                
                                let targetX: number;
                                const targetY = placeholderCenterY - newHeight / 2;  // 垂直居中
                                
                                if (regionColorCount === 1) {
                                    // 单颜色：水平居中 (type2=5)
                                    targetX = placeholderCenterX - newWidth / 2;
                                } else if (colorIdx === 0) {
                                    // 第一个：左对齐 (type2=4)
                                    targetX = placeholderRect.left;
                                } else if (colorIdx === regionColorCount - 1) {
                                    // 最后一个：右对齐 (type2=6)
                                    targetX = placeholderRect.right - newWidth;
                                } else {
                                    // ★ 中间颜色：先居中到占位区域
                                    // 后续由 FBfun (ADSCentersH) 进行水平均匀分布
                                    targetX = placeholderCenterX - newWidth / 2;
                                }
                                
                                const deltaX = targetX - newLeft;
                                const deltaY = targetY - newTop;
                                
                                await action.batchPlay([{
                                    _obj: 'move',
                                    _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                                    to: { _obj: 'offset', horizontal: { _unit: 'pixelsUnit', _value: deltaX }, vertical: { _unit: 'pixelsUnit', _value: deltaY } },
                                    _options: { dialogOptions: 'dontDisplay' }
                                }], { synchronousExecution: true });
                                
                                console.log(`[SKULayout]     移动: (${(newLeft + deltaX).toFixed(0)}, ${(newTop + deltaY).toFixed(0)})`);
                            }
                        } catch (err: any) {
                            console.warn(`[SKULayout]   处理 ${colorName} 失败: ${err.message}`);
                        }
                    }
                    
                    // ★★★ FBfun() - 水平均匀分布 ★★★
                    // 6.0袜子排版.jsx: 选中所有图层后执行分布（ADSCentersH）
                    // ★★★ 重要：Photoshop 分布命令需要 >= 3 个图层 ★★★
                    // 2 个图层时会报错"分布当前不可用"，此时使用左右对齐替代（上面已处理）
                    if (regionLayerIds.length >= 3) {
                        console.log(`[SKULayout]   执行水平分布 (${regionLayerIds.length} 个图层)...`);
                        
                        try {
                            // 选中第一个
                            await action.batchPlay([{
                                _obj: 'select',
                                _target: [{ _ref: 'layer', _id: regionLayerIds[0] }],
                                makeVisible: false,
                                _options: { dialogOptions: 'dontDisplay' }
                            }], { synchronousExecution: true });
                            
                            // 添加其他到选区
                            for (let i = 1; i < regionLayerIds.length; i++) {
                                await action.batchPlay([{
                                    _obj: 'select',
                                    _target: [{ _ref: 'layer', _id: regionLayerIds[i] }],
                                    selectionModifier: { _enum: 'selectionModifierType', _value: 'addToSelection' },
                                    makeVisible: false,
                                    _options: { dialogOptions: 'dontDisplay' }
                                }], { synchronousExecution: true });
                            }
                            
                            // 执行水平居中分布 (ADSCentersH)
                            await action.batchPlay([{
                                _obj: 'distort',
                                _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                                using: { _enum: 'ADSt', _value: 'ADSCentersH' },
                                _options: { dialogOptions: 'dontDisplay' }
                            }], { synchronousExecution: true });
                            
                            console.log(`[SKULayout]   ✓ 水平分布完成`);
                        } catch (err: any) {
                            // 分布命令失败时静默忽略（与 JSX 行为一致）
                            console.warn(`[SKULayout]   水平分布跳过: ${err.message}`);
                        }
                    } else if (regionLayerIds.length === 2) {
                        // ★ 2 个图层：不执行分布，使用左右对齐（上面已通过 duqi 逻辑处理）
                        console.log(`[SKULayout]   2 个图层：使用左右对齐替代分布（第一个左对齐，最后一个右对齐）`);
                    } else if (regionLayerIds.length === 1) {
                        console.log(`[SKULayout]   1 个图层：居中对齐（已处理）`);
                    }
                    
                    console.log(`[SKULayout] ===== 区域 ${regionIdx + 1} 处理完成 =====`);
                }
                
                // 保持向后兼容：收集所有复制的图层 ID
                // （这部分主要用于后续的水平分布，但现在每个区域已经独立处理了）
                const copiedLayerIds: number[] = [];  // 仅用于兼容
                
                // 4.4 如果只有一个区域，且有多个颜色，已经在上面处理了分布
                // 以下代码保留用于导出逻辑
                if (copiedLayerIds.length >= 3) {
                    console.log(`[SKULayout] 4.4 执行水平均匀分布...`);
                    
                    // 先选中第一个
                    await action.batchPlay([{
                        _obj: 'select',
                        _target: [{ _ref: 'layer', _id: copiedLayerIds[0] }],
                        makeVisible: false,
                        _options: { dialogOptions: 'dontDisplay' }
                    }], { synchronousExecution: true });
                    
                    // 添加其他到选区
                    for (let i = 1; i < copiedLayerIds.length; i++) {
                        await action.batchPlay([{
                            _obj: 'select',
                            _target: [{ _ref: 'layer', _id: copiedLayerIds[i] }],
                            selectionModifier: { _enum: 'selectionModifierType', _value: 'addToSelection' },
                            makeVisible: false,
                            _options: { dialogOptions: 'dontDisplay' }
                        }], { synchronousExecution: true });
                    }
                    
                    // ★ 参考 FBfun() - 水平居中分布
                    try {
                        await action.batchPlay([{
                            _obj: 'align',
                            _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                            using: { _enum: 'alignDistributeSelector', _value: 'ADSCentersH' },
                            _options: { dialogOptions: 'dontDisplay' }
                        }], { synchronousExecution: true });
                        console.log(`[SKULayout] ✓ 水平分布完成`);
                    } catch (e) {
                        console.warn(`[SKULayout] 水平分布失败，已跳过`);
                    }
                }
                
                // ★ 使用占位符逻辑已完成缩放和对齐，无需再编组缩放
                console.log(`[SKULayout] ✅ 排列完成 (占位符模式，无需编组缩放)`)
                
            }, { commandName: '自选备注动态排列' });
            
            // 5. 导出到临时目录
            return await this.exportNoteTemplate({
                outputDir: config.outputDir,
                format: config.format,
                quality: config.quality,
                noteFileName: config.noteFileName
            });
            
        } catch (error: any) {
            console.error(`[SKULayout] 自选备注动态排列失败:`, error);
            return { success: false, error: error.message, data: null };
        }
    }

    /**
     * 导出自选备注模板
     * 
     * ★★★ 最优方案：强制使用临时目录 + Electron 复制 ★★★
     * 完全绕过 UXP 授权机制的复杂性
     * Agent 端（Node.js）有完整的文件系统权限，可以复制到任意目录
     */
    private async exportNoteTemplate(config: {
        outputDir?: string;
        format: string;
        quality: number;
        noteFileName: string;
    }): Promise<ToolResult<any>> {
        // 前置校验
        const templateDoc = app.activeDocument;
        if (!templateDoc) {
            return { success: false, error: '没有打开的文档', data: null };
        }
        
        if (!config.outputDir) {
            return { success: false, error: '必须指定输出目录 (outputDir)', data: null };
        }
        
        console.log(`[SKULayout] ★ 自选备注导出`);
        console.log(`[SKULayout]   文档: ${templateDoc.name}`);
        console.log(`[SKULayout]   输出文件名: ${config.noteFileName}`);
        console.log(`[SKULayout]   目标目录: ${config.outputDir}`);
        
        const templateName = templateDoc.name.replace(/\.[^.]+$/, '');
        const outputFileName = config.noteFileName;
        const targetDir = `${config.outputDir}\\${templateName}`;
        const fullPath = `${targetDir}\\${outputFileName}.jpg`;
        
        // 使用 JSX 脚本保存（绕过 UXP 安全限制）
        const saveSuccess = await saveAsJPEGViaJSX(fullPath, config.quality);
        
        if (!saveSuccess) {
            return { 
                success: false, 
                error: `JSX 保存失败: ${fullPath}`, 
                data: null 
            };
        }
        
        console.log(`[SKULayout] ✅ 导出成功: ${fullPath}`);
        
        // 关闭自选备注模板文档（不保存修改，与组合模板一致）
        const templateNameForClose = templateDoc.name;
        await core.executeAsModal(async () => {
            await (templateDoc as any).closeWithoutSaving();
        }, { commandName: '关闭自选备注模板文档' });
        console.log(`[SKULayout] ✅ 已关闭自选备注模板文档: ${templateNameForClose}`);
        
        return {
            success: true,
            data: {
                exportedCount: 1,
                exportedFiles: [JSON.stringify({
                    path: fullPath,
                    targetName: `${outputFileName}.jpg`,
                    status: 'exported_jsx'
                })],
                outputDir: config.outputDir
            }
        };
    }

    /**
     * 执行 SKU 组合排版
     * 
     * 核心流程（参考 6.0袜子排版.jsx）：
     * 1. 识别 SKU 素材文档（包含颜色图层组）和模板文档（包含占位图层）
     * 2. 遍历每个颜色组合
     * 3. 对于每个组合：
     *    a. 获取模板中的占位图层（作为目标区域）
     *    b. 从 SKU 素材复制对应颜色图层组到模板
     *    c. 缩放图层以适应目标区域
     *    d. 对齐图层（左对齐/居中/右对齐）
     *    e. 水平分布所有图层
     * 4. 导出为 JPEG
     * 5. 恢复模板（删除复制的图层）
     */
    /**
     * 执行 SKU 组合排版
     * 
     * 正确的工作流程：
     * 1. 打开 SKU 素材文件 → 获取颜色列表
     * 2. 规划颜色组合 → AI/用户决定
     * 3. 打开对应的模板 → 根据组合数量选择模板（2双、3双、4双...）
     * 4. 执行排版 → 复制颜色图层到模板占位区域
     * 5. 导出图片 → 保存 JPEG
     */
    private async executeComboLayout(config: {
        combos: string[][];      // 颜色组合列表
        outputDir?: string;      // 输出目录
        format: string;          // 输出格式
        quality: number;         // JPEG 质量
        skuDocName?: string;     // 明确指定 SKU 素材文档名称
        templateDocName?: string; // 明确指定模板文档名称
        useSmartArrange?: boolean;  // 是否使用智能排列模式
        arrangeConfig?: Partial<SmartArrangeConfig>;  // 智能排列配置
        noteFilePrefix?: string;   // 自选备注文件名前缀（如"2双自选备注"）
        isNoteTemplate?: boolean;  // ★ 是否为自选备注模式（影响文件命名和目录结构）
    }): Promise<ToolResult<any>> {
        if (!config.combos || config.combos.length === 0) {
            return { success: false, error: '没有提供颜色组合', data: null };
        }

        try {
            // 列出所有打开的文档
            const allDocs: Array<{ name: string; width: number; height: number }> = [];
            for (let i = 0; i < app.documents.length; i++) {
                const doc = app.documents[i];
                allDocs.push({ 
                    name: doc.name, 
                    width: doc.width, 
                    height: doc.height 
                });
            }
            console.log(`[SKULayout] ==================== 开始执行 ====================`);
            console.log(`[SKULayout] 打开的文档 (${allDocs.length} 个):`);
            allDocs.forEach((d, i) => console.log(`[SKULayout]   ${i + 1}. ${d.name} (${d.width}x${d.height})`));
            console.log(`[SKULayout] 待处理组合: ${config.combos.length} 个`);
            config.combos.forEach((c, i) => console.log(`[SKULayout]   ${i + 1}. ${c.join(' + ')}`));

            // 1. 识别 SKU 素材文档
            let skuDoc: any = null;
            
            // 如果明确指定了名称，直接查找
            if (config.skuDocName) {
                for (let i = 0; i < app.documents.length; i++) {
                    if (app.documents[i].name === config.skuDocName) {
                        skuDoc = app.documents[i];
                        break;
                    }
                }
            }
            
            // 否则按关键词查找
            if (!skuDoc) {
            for (let i = 0; i < app.documents.length; i++) {
                const doc = app.documents[i];
                const name = (doc.name || '').toLowerCase();
                if (name.includes('sku') || name.includes('素材')) {
                    skuDoc = doc;
                        break;
                    }
                }
            }

            if (!skuDoc) {
                return { 
                    success: false, 
                    error: `未找到 SKU 素材文档。\n\n当前打开的文档: ${allDocs.map(d => d.name).join(', ')}\n\n请先打开 SKU 素材文件（名称通常包含 "SKU"）。`, 
                    data: null 
                };
            }
            
            console.log(`[SKULayout] ✓ SKU 素材: ${skuDoc.name}`);

            // 2. 识别模板文档
            // ★ 修复：优先使用 app.activeDocument（Agent 已切换到正确的模板）
            // 只有当 activeDocument 是 SKU 素材时，才自动查找其他模板
            let templateDoc: any = null;
            const firstComboSize = config.combos[0]?.length || 2;
            
            // ★ 优先使用当前活动文档作为模板
            // Agent 端已经通过 switchDocument 切换到了正确的模板
            const activeDoc = app.activeDocument;
            const activeDocName = (activeDoc?.name || '').toLowerCase();
            
            // 如果当前活动文档不是 SKU 素材，就用它作为模板
            if (activeDoc && !activeDocName.includes('sku') && !activeDocName.includes('素材')) {
                templateDoc = activeDoc;
                console.log(`[SKULayout] ★ 使用当前活动文档作为模板: ${templateDoc.name}`);
            }
            
            // 如果明确指定了名称，覆盖查找
            if (config.templateDocName) {
                for (let i = 0; i < app.documents.length; i++) {
                    if (app.documents[i].name === config.templateDocName) {
                        templateDoc = app.documents[i];
                        console.log(`[SKULayout] ✓ 使用指定模板: ${templateDoc.name}`);
                        break;
                    }
                }
            }
            
            // 只有在没有找到模板时，才按组合数量自动查找
            if (!templateDoc) {
                console.log(`[SKULayout] 根据组合数量 ${firstComboSize} 查找对应模板...`);
                
                const sizeStr = String(firstComboSize);
                
                for (let i = 0; i < app.documents.length; i++) {
                    const doc = app.documents[i];
                    const name = (doc.name || '').toLowerCase();
                    
                    // 跳过 SKU 素材
                    if (name.includes('sku') || name.includes('素材')) {
                        continue;
                    }
                    
                    // 查找包含对应数量的模板（精确匹配）
                    if (name.includes(sizeStr + '双装') || 
                        name.includes(sizeStr + '双模板') || 
                        name.includes(sizeStr + '双') ||
                        name.includes(sizeStr + '个')) {
                        templateDoc = doc;
                        console.log(`[SKULayout] ✓ 找到模板: ${doc.name}`);
                        break;
                    }
                }
            }
            
            // 如果还没找到，提示用户需要打开模板
            if (!templateDoc) {
                const templateSuggestion = `${firstComboSize}双模板` ;
                return { 
                    success: false, 
                    error: `未找到 ${firstComboSize} 双的模板文档。\n\n当前打开的文档: ${allDocs.map(d => d.name).join(', ')}\n\n请打开对应的模板文件（如 "${templateSuggestion}.psd" 或 "${firstComboSize}双自选备注.tif"）。`, 
                    data: null 
                };
            }

            console.log(`[SKULayout] ✓ 模板: ${templateDoc.name} (${templateDoc.width}x${templateDoc.height})`);
            console.log(`[SKULayout] ====================================================`);
            console.log(`[SKULayout] 待处理组合: ${config.combos.length} 个`);

            const exportedFiles: string[] = [];
            const errors: string[] = [];

            this.progress = { 
                current: 0, 
                total: config.combos.length, 
                message: '开始处理...' 
            };

            // 获取图层边界（参考 6.0袜子排版.jsx：直接使用 layer.bounds）
            const getBounds = (layer: any): { left: number; top: number; width: number; height: number } => {
                const b = layer.bounds;
                
                // Photoshop bounds 格式：[left, top, right, bottom] 或 { left, top, right, bottom }
                let left: number, top: number, right: number, bottom: number;
                
                if (Array.isArray(b) && b.length >= 4) {
                    left = b[0]?.value ?? b[0];
                    top = b[1]?.value ?? b[1];
                    right = b[2]?.value ?? b[2];
                    bottom = b[3]?.value ?? b[3];
                } else {
                    left = b._left ?? b.left;
                    top = b._top ?? b.top;
                    right = b._right ?? b.right;
                    bottom = b._bottom ?? b.bottom;
                }
                
                return { left, top, width: right - left, height: bottom - top };
            };

            // 2. 遍历每个组合
            for (let comboIndex = 0; comboIndex < config.combos.length; comboIndex++) {
                const combo = config.combos[comboIndex];
                const comboSize = combo.length;
                
                this.progress = { 
                    current: comboIndex + 1, 
                    total: config.combos.length, 
                    message: `处理第 ${comboIndex + 1}/${config.combos.length} 个: ${combo.join('+')}` 
                };

                try {
                    console.log(`[SKULayout] === 开始处理组合 ${comboIndex + 1} ===`);
                    console.log(`[SKULayout]   组合内容: ${combo.join(' + ')}`);
                    console.log(`[SKULayout]   模板文档: ${templateDoc?.name || 'undefined'}`);
                    console.log(`[SKULayout]   SKU文档: ${skuDoc?.name || 'undefined'}`);
                    
                    await core.executeAsModal(async () => {
                        app.activeDocument = templateDoc;
                        
                        // 获取模板中的占位图层（矩形图层）
                        // ★★★ 参考 6.0袜子排版.jsx 第 827 行：var lays = doc.artLayers ★★★
                        // artLayers 返回的是文档【顶层】的【普通图层】（不含图层组）
                        // 在 UXP 中，使用 layer.kind 判断图层类型：
                        //   - kind === 'group' → 图层组 (LayerSet)
                        //   - kind === 'pixel'/'shape'/'smartObject'/'text' 等 → 普通图层 (ArtLayer)
                        const allLayers = templateDoc.layers || [];
                        let placeholderLayers: any[] = [];
                        
                        console.log(`[SKULayout] 模板顶层图层数: ${allLayers.length}`);
                        
                        for (let i = 0; i < allLayers.length; i++) {
                            const layer = allLayers[i];
                            const layerKind = layer.kind || 'unknown';
                            
                            // ★ 使用 kind 属性判断：group = 图层组，其他 = 普通图层
                            // 6.0袜子排版.jsx 中 doc.artLayers 只返回普通图层
                            const isGroup = layerKind === 'group';
                            
                            console.log(`[SKULayout]   图层 ${i}: "${layer.name}" (kind: ${layerKind}, ID: ${layer.id})`);
                            
                            if (!isGroup) {
                                // 普通图层（非图层组），作为占位符
                                // 这正是 6.0 脚本的 lays[j] - 占位矩形
                                placeholderLayers.push(layer);
                                console.log(`[SKULayout]   ✓ 发现占位图层: ${layer.name}`);
                            } else {
                                console.log(`[SKULayout]   → 跳过图层组: ${layer.name}`);
                            }
                        }
                        
                        // 关键：按物理位置（从左到右）排序占位矩形
                        // 6.0袜子排版.jsx 的模板设计：占位矩形从左到右排列
                        // Photoshop 图层面板顺序可能与物理位置不一致，需要按 left 坐标排序
                        placeholderLayers = placeholderLayers
                            .map(layer => {
                                const bounds = getBounds(layer);
                                return { layer, bounds };
                            })
                            .filter(item => item.bounds && item.bounds.width > 0)
                            .sort((a, b) => (a.bounds?.left || 0) - (b.bounds?.left || 0))
                            .map(item => item.layer);
                        
                        console.log(`[SKULayout] 占位矩形排序后（从左到右）:`);
                        placeholderLayers.forEach((layer, idx) => {
                            const b = getBounds(layer);
                            console.log(`[SKULayout]   ${idx + 1}. ${layer.name} (left: ${b?.left?.toFixed(0) || '?'})`);
                        });
                        
                        const numPlaceholders = placeholderLayers.length;
                        console.log(`[SKULayout] 模板占位图层数: ${numPlaceholders}, 组合颜色数: ${comboSize}`);
                        
                        // ★★★ 6.0袜子排版.jsx 核心逻辑 ★★★
                        // 参考第 840-900 行的双层循环：
                        // for (var j = 0; j < lays.length; j++) {  // 遍历每个占位矩形
                        //     var lay = lays[j];
                        //     var rect = lay.bounds;
                        //     var imgs = xlsstr[j].split("+");     // 该区域的颜色
                        //     for (var k = 0; k < imgs.length; k++) { copylay(); suofang(); duqi(); }
                        //     FBfun();
                        // }
                        
                        // ★★★ 智能分配策略 ★★★
                        // 参考 6.0袜子排版.jsx：区域分配由 CSV 配置决定
                        // 我们没有 CSV，需要智能判断：
                        // - 如果颜色数量较少，应该集中在一个区域，避免太稀疏
                        // - 只有颜色数量足够多时，才分配到多个区域
                        
                        // 策略：每个区域至少 2 个颜色，否则不分配
                        // 例如：2 颜色 + 2 占位矩形 → 每个 1 个 → 太稀疏 → 只用 1 个占位矩形
                        // 例如：4 颜色 + 2 占位矩形 → 每个 2 个 → OK → 使用 2 个占位矩形
                        const MIN_COLORS_PER_REGION = 2;
                        
                        let effectivePlaceholders: number;
                        if (numPlaceholders <= 1) {
                            // 只有 1 个或没有占位矩形，使用 1 个
                            effectivePlaceholders = 1;
                        } else {
                            // 计算需要多少个占位矩形才能让每个区域至少有 MIN_COLORS_PER_REGION 个颜色
                            const maxPlaceholders = Math.floor(comboSize / MIN_COLORS_PER_REGION);
                            effectivePlaceholders = Math.max(1, Math.min(numPlaceholders, maxPlaceholders));
                            
                            console.log(`[SKULayout] 智能分配计算: ${comboSize} 颜色, 最多使用 ${maxPlaceholders} 个区域 (确保每区域 >= ${MIN_COLORS_PER_REGION} 个)`);
                        }
                        
                        const colorsPerPlaceholder = Math.ceil(comboSize / effectivePlaceholders);
                        
                        console.log(`[SKULayout] ★ 智能分配结果: ${comboSize} 个颜色 → ${effectivePlaceholders} 个占位矩形 (每个约 ${colorsPerPlaceholder} 个)`);
                        
                        // 构建每个占位矩形的信息
                        const sortedPlaceholderInfo = placeholderLayers.map(layer => {
                            const bounds = getBounds(layer);
                            return {
                                layer,
                                left: bounds?.left || 0,
                                top: bounds?.top || 0,
                                right: (bounds?.left || 0) + (bounds?.width || 0),
                                bottom: (bounds?.top || 0) + (bounds?.height || 0),
                                width: bounds?.width || 0,
                                height: bounds?.height || 0
                            };
                        }).sort((a, b) => {
                            // 先按 top 排序（上到下），再按 left 排序（左到右）
                            if (Math.abs(a.top - b.top) > 50) return a.top - b.top;
                            return a.left - b.left;
                        });
                        
                        // 如果没有占位矩形，使用画布作为单一区域
                        if (sortedPlaceholderInfo.length === 0) {
                            sortedPlaceholderInfo.push({
                                layer: null as any,
                                left: 0,
                                top: templateDoc.height * 0.05,
                                right: templateDoc.width,
                                bottom: templateDoc.height * 0.95,
                                width: templateDoc.width,
                                height: templateDoc.height * 0.9
                            });
                            console.log(`[SKULayout] 无占位矩形，使用画布区域`);
                        }
                        
                        console.log(`[SKULayout] 占位矩形分配:`);
                        sortedPlaceholderInfo.forEach((p, i) => {
                            const startIdx = i * colorsPerPlaceholder;
                            const endIdx = Math.min(startIdx + colorsPerPlaceholder, comboSize);
                            const regionColors = combo.slice(startIdx, endIdx);
                            console.log(`[SKULayout]   区域 ${i + 1}: ${p.layer?.name || '画布'} → ${regionColors.join(' + ')}`);
                        });
                        
                        // 收集所有复制的图层 ID（用于最后清理）
                        const allCopiedLayerIds: number[] = [];
                        const allCopiedLayers: any[] = [];
                        
                        // ★★★ 双层循环：遍历每个占位矩形 ★★★
                        for (let placeholderIdx = 0; placeholderIdx < sortedPlaceholderInfo.length; placeholderIdx++) {
                            const placeholderInfo = sortedPlaceholderInfo[placeholderIdx];
                            
                            // 计算该占位矩形对应的颜色范围
                            const startColorIdx = placeholderIdx * colorsPerPlaceholder;
                            const endColorIdx = Math.min(startColorIdx + colorsPerPlaceholder, comboSize);
                            const regionColors = combo.slice(startColorIdx, endColorIdx);
                            
                            if (regionColors.length === 0) {
                                console.log(`[SKULayout] 跳过空区域 ${placeholderIdx + 1}`);
                                continue;
                            }
                            
                            console.log(`[SKULayout] ===== 处理区域 ${placeholderIdx + 1}/${sortedPlaceholderInfo.length} =====`);
                            console.log(`[SKULayout]   占位矩形: ${placeholderInfo.layer?.name || '画布'}`);
                            console.log(`[SKULayout]   颜色: ${regionColors.join(' + ')}`);
                            
                            const placeholderRect = {
                                left: placeholderInfo.left,
                                top: placeholderInfo.top,
                                width: placeholderInfo.width,
                                height: placeholderInfo.height
                            };
                            
                            // 当前区域的复制图层 ID（用于水平分布）
                            const regionLayerIds: number[] = [];
                            
                            // 遍历该区域的每个颜色
                            for (let colorIdx = 0; colorIdx < regionColors.length; colorIdx++) {
                                const colorName = regionColors[colorIdx];
                                if (!colorName) continue;
                                
                                const targetRect = {
                                    left: placeholderRect.left,
                                    top: placeholderRect.top,
                                    width: placeholderRect.width,
                                    height: placeholderRect.height
                                };
                                
                                console.log(`[SKULayout]   颜色 ${colorIdx + 1}/${regionColors.length}: ${colorName}`);
                                const targetPlaceholder = placeholderInfo.layer;
                            
                            // 在 SKU 文档中找到对应的颜色【图层组】（不是普通图层！）
                            // SKU 素材的结构是：每个颜色是一个图层组，包含主体、阴影、文字等子图层
                            app.activeDocument = skuDoc;
                            let colorSet: any = null;
                            
                            // UXP API: 从 layers 中过滤出图层组（有 layers 子属性的就是图层组）
                            // 安全检查：确保 skuDoc.layers 存在
                            const skuLayers = skuDoc.layers || [];
                            if (!skuLayers || skuLayers.length === 0) {
                                console.error(`[SKULayout] SKU 文档没有图层！`);
                                continue;
                            }
                            const availableGroups: string[] = [];
                            
                            console.log(`[SKULayout] 在 SKU 文档中查找颜色图层组: "${colorName}"`);
                            
                            for (let s = 0; s < skuLayers.length; s++) {
                                const layer = skuLayers[s] as any;
                                const isGroup = layer.layers && layer.layers.length > 0;
                                
                                if (isGroup) {
                                    const layerName = (layer.name || '').trim();
                                    availableGroups.push(layerName);
                                    
                                    if (layerName === colorName.trim()) {
                                    colorSet = layer;
                                        console.log(`[SKULayout] ✓ 找到颜色图层组: "${colorName}" (子图层: ${layer.layers.length})`);
                                    break;
                                    }
                                }
                            }
                            
                            if (!colorSet) {
                                console.warn(`[SKULayout] ✗ 未找到颜色图层组: "${colorName}"`);
                                console.warn(`[SKULayout]   可用的图层组: ${availableGroups.join(', ')}`);
                                continue;
                            }
                            
                            // 复制颜色图层组到模板（使用参考脚本的方式）
                            try {
                                console.log(`[SKULayout] 准备复制图层组 "${colorName}" (ID: ${colorSet.id}) 到模板 "${templateDoc.name}"`);
                                
                                // ★★★ 关键修复：参考 6.0袜子排版.jsx 第 843 行 ★★★
                                // doc.activeLayer = lay;  ← 在复制前激活模板的顶层图层
                                // 这确保 duplicate 命令将新图层放在顶层，而非当前激活的组内
                                
                                // 步骤 1：切换到模板文档，选中当前占位矩形（顶层图层）
                                app.activeDocument = templateDoc;
                                if (placeholderInfo.layer?.id) {
                                    await action.batchPlay([{
                                        _obj: 'select',
                                        _target: [{ _ref: 'layer', _id: placeholderInfo.layer.id }],
                                        makeVisible: false,
                                        _options: { dialogOptions: 'dontDisplay' }
                                    }], { synchronousExecution: true });
                                    console.log(`[SKULayout] 准备: 选中模板占位矩形 "${placeholderInfo.layer.name}"`);
                                }
                                
                                // 步骤 2：切换到 SKU 文档并选中图层组
                                app.activeDocument = skuDoc;
                                
                                // 记录复制前模板的图层数
                                const layerCountBefore = templateDoc.layers.length;
                                
                                // 使用 batchPlay select 选中图层组
                                await action.batchPlay([{
                                    _obj: 'select',
                                    _target: [{ _ref: 'layer', _id: colorSet.id }],
                                    makeVisible: false,
                                    _options: { dialogOptions: 'dontDisplay' }
                                }], { synchronousExecution: true });
                                
                                // 步骤 3：使用参考脚本的 copylay 方法复制
                            await action.batchPlay([{
                                _obj: 'duplicate',
                                _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                                to: { _ref: 'document', _name: templateDoc.name },
                                    version: 5,
                                _options: { dialogOptions: 'dontDisplay' }
                            }], { synchronousExecution: true });
                            
                                // ★★★ 关键：切换到模板文档后使用 activeLayers ★★★
                                // 参考 6.0袜子排版.jsx 第 872 行：
                                // app.activeDocument = doc;
                                // layarr[k] = doc.activeLayer;  ← 复制后自动变成 activeLayer
                            app.activeDocument = templateDoc;
                                
                                // 检查图层数是否增加
                                const layerCountAfter = templateDoc.layers.length;
                                console.log(`[SKULayout] 复制后图层数: ${layerCountBefore} → ${layerCountAfter}`);
                                
                                // ★★★ 修复：使用 activeLayers[0] 获取刚复制的图层 ★★★
                                // 与 JSX 的 doc.activeLayer 行为一致
                                let copiedLayer: any = templateDoc.activeLayers?.[0];
                                
                                // 验证是否真的是刚复制的图层
                                if (copiedLayer) {
                                    console.log(`[SKULayout] 通过 activeLayers 获取: ${copiedLayer.name} (ID: ${copiedLayer.id})`);
                                    
                                    // 安全检查：确认是新增的图层，而非原有图层
                                    // 如果名称匹配则确认
                                    const nameMatch = copiedLayer.name === colorName || copiedLayer.name === colorSet.name;
                                    if (!nameMatch && layerCountAfter <= layerCountBefore) {
                                        console.warn(`[SKULayout] 警告: activeLayers 返回的图层名不匹配，尝试按名称查找`);
                                        copiedLayer = null;
                                    }
                                }
                                
                                // 回退：如果 activeLayers 不可靠，按名称查找
                                if (!copiedLayer) {
                                    for (let li = 0; li < templateDoc.layers.length; li++) {
                                        const layer = templateDoc.layers[li];
                                        if (layer.name === colorName || layer.name === colorSet.name) {
                                            copiedLayer = layer;
                                            console.log(`[SKULayout] 通过名称查找: ${copiedLayer.name}`);
                                            break;
                                        }
                                    }
                                }
                                
                                // 最后回退：取最顶部的新图层
                                if (!copiedLayer && layerCountAfter > layerCountBefore) {
                                    copiedLayer = templateDoc.layers[0];
                                    console.log(`[SKULayout] 使用顶部图层: ${copiedLayer.name}`);
                                }
                                
                                if (!copiedLayer) {
                                    console.warn(`[SKULayout] 复制图层组失败: ${colorName} - 无法在模板中找到`);
                                    continue;
                                }
                                
                                // ★★★ 诊断：验证图层位置是否在顶层 ★★★
                                // 检查 parent 属性，如果是 null 或 document，说明在顶层
                                const layerParent = copiedLayer.parent;
                                if (layerParent && layerParent !== templateDoc) {
                                    console.error(`[SKULayout] ⚠️ 警告: 图层 "${copiedLayer.name}" 不在顶层，父级是 "${layerParent.name || 'unknown'}"`);
                                } else {
                                    console.log(`[SKULayout] ✓ 确认: 图层 "${copiedLayer.name}" 在文档顶层`);
                                }
                                
                                // 验证是否是图层组
                                const isGroup = copiedLayer.layers && copiedLayer.layers.length > 0;
                                console.log(`[SKULayout] ✓ 复制成功: ${colorName} (ID: ${copiedLayer.id}, 是图层组: ${isGroup}, 子图层: ${isGroup ? copiedLayer.layers.length : 0})`);
                                
                                // ★ 添加到区域图层列表和全局列表
                                regionLayerIds.push(copiedLayer.id);
                                allCopiedLayerIds.push(copiedLayer.id);
                                allCopiedLayers.push(copiedLayer);
                                
                                // 获取复制图层的边界
                                const layerBounds = getBounds(copiedLayer);
                                if (!layerBounds || layerBounds.width <= 0 || layerBounds.height <= 0) {
                                    console.warn(`[SKULayout] 无法获取图层边界: ${colorName}`);
                                    continue;
                                }
                                
                                // 缩放图层以适应目标区域
                                // 参考 6.0袜子排版.jsx 的 suofang 函数（type=3 等比缩放包含模式）
                                // type=3 的逻辑：确保图层完全包含在目标区域内，取较小的缩放比
                                const scaleX = targetRect.width / layerBounds.width;
                                const scaleY = targetRect.height / layerBounds.height;
                                
                                // 6.0袜子排版.jsx 的 type=3 逻辑（contain 模式）：
                                // 如果图层宽>高，使用高度缩放比（除非会超出宽度）
                                // 如果图层高>宽，使用宽度缩放比（除非会超出高度）
                                let scale: number;
                                if (layerBounds.width > layerBounds.height) {
                                    // 宽图层：优先按宽度缩放，但不能超出高度
                                    if (scaleX * layerBounds.height > targetRect.height) {
                                        scale = scaleY;  // 按高度缩放
                                    } else {
                                        scale = scaleX;  // 按宽度缩放
                                    }
                                } else {
                                    // 高图层：优先按高度缩放，但不能超出宽度
                                    if (scaleY * layerBounds.width > targetRect.width) {
                                        scale = scaleX;  // 按宽度缩放
                                    } else {
                                        scale = scaleY;  // 按高度缩放
                                    }
                                }
                                
                                // 6.0袜子排版.jsx 不留边距，直接适应占位矩形
                                console.log(`[SKULayout] 缩放计算: 图层 ${layerBounds.width.toFixed(0)}x${layerBounds.height.toFixed(0)} → 目标 ${targetRect.width.toFixed(0)}x${targetRect.height.toFixed(0)}, 比例 ${(scale * 100).toFixed(1)}%`);
                                
                                if (Math.abs(scale - 1) > 0.01) {
                                    // 使用 batchPlay 缩放（兼容图层组）
                                    await batchPlayResize(copiedLayer.id, scale * 100);
                                    console.log(`[SKULayout] ✓ 缩放 ${colorName}: ${(scale * 100).toFixed(1)}%`);
                                }
                                
                                // 刷新图层引用以获取最新边界
                                const refreshedLayer = templateDoc.layers.find((l: any) => l.id === copiedLayer.id);
                                const afterBounds = refreshedLayer ? getBounds(refreshedLayer) : getBounds(copiedLayer);
                                
                                if (afterBounds) {
                                    // ===== 参考 6.0袜子排版.jsx 的 duqi 函数 =====
                                    // 第 877-889 行的对齐逻辑：
                                    // - 只有 1 个颜色：居中对齐 (type2=5)
                                    // - 多个颜色：第一个左对齐(type2=4)，最后一个右对齐(type2=6)，中间居中(type2=5)
                                    
                                    // 占位矩形的关键点
                                    const placeholderLeft = targetRect.left;
                                    const placeholderRight = targetRect.left + targetRect.width;
                                    const placeholderCenterX = targetRect.left + targetRect.width / 2;
                                    const placeholderCenterY = targetRect.top + targetRect.height / 2;
                                    
                                    // 颜色图层的尺寸
                                    const layerCenterX = afterBounds.left + afterBounds.width / 2;
                                    const layerCenterY = afterBounds.top + afterBounds.height / 2;
                                    
                                    let offsetX: number;
                                    let offsetY: number;
                                    let alignType: string;
                                    
                                    // ★ 使用当前区域的颜色数量，而非整个 combo 的数量
                                    const regionColorCount = regionColors.length;
                                    
                                    if (regionColorCount === 1) {
                                        // 只有 1 个颜色：完全居中 (type2=5)
                                        offsetX = placeholderCenterX - layerCenterX;
                                        offsetY = placeholderCenterY - layerCenterY;
                                        alignType = '居中';
                                    } else if (colorIdx === 0) {
                                        // 第一个颜色：左对齐，垂直居中 (type2=4)
                                        offsetX = placeholderLeft - afterBounds.left;
                                        offsetY = placeholderCenterY - layerCenterY;
                                        alignType = '左对齐';
                                    } else if (colorIdx === regionColorCount - 1) {
                                        // 最后一个颜色：右对齐，垂直居中 (type2=6)
                                        offsetX = placeholderRight - (afterBounds.left + afterBounds.width);
                                        offsetY = placeholderCenterY - layerCenterY;
                                        alignType = '右对齐';
                                    } else {
                                        // 中间颜色：水平居中，垂直居中 (type2=5)
                                        // 6.0脚本的特殊逻辑：中间颜色紧跟前一个颜色
                                        // 这里简化为居中，最后由 FBfun 分布
                                        offsetX = placeholderCenterX - layerCenterX;
                                        offsetY = placeholderCenterY - layerCenterY;
                                        alignType = '居中(待分布)';
                                    }
                                    
                                    console.log(`[SKULayout] 对齐 [${alignType}]: (${offsetX.toFixed(0)}, ${offsetY.toFixed(0)})`);
                                    
                                    if (Math.abs(offsetX) > 0.5 || Math.abs(offsetY) > 0.5) {
                                        await batchPlayTranslate(copiedLayer.id, offsetX, offsetY);
                                        console.log(`[SKULayout] ✓ 移动 ${colorName}: (${offsetX.toFixed(1)}, ${offsetY.toFixed(1)})`);
                                    }
                                    
                                    console.log(`[SKULayout] ✅ 颜色 ${colorName} 处理完成`);
                                }
                            } catch (copyErr: any) {
                                console.error(`[SKULayout] 复制图层异常: ${colorName} - ${copyErr.message}`);
                                continue;
                            }
                        }
                        
                        // ★★★ 当前区域颜色循环结束，执行水平分布（参考 6.0 脚本的 FBfun） ★★★
                        console.log(`[SKULayout] ===== 区域 ${placeholderIdx + 1} 水平分布 =====`);
                        
                        // 水平分布/对齐（参考脚本的 FBfun 函数）
                        // ⚠️ 重要：Photoshop "分布"命令需要至少 3 个图层
                        // 对于 2 个图层，位置已在前面单独计算并设置，无需额外操作
                        const validLayerIds = regionLayerIds.filter(id => id !== undefined && id !== null && !isNaN(id));
                        
                        // ===== 智能排列模式 =====
                        // 如果启用智能排列，使用 smartArrangeLayerGroups 来排列
                        // 这种模式不需要精确的占位矩形，只需一个目标区域
                        if (config.useSmartArrange && validLayerIds.length >= 1) {
                            console.log(`[SKULayout] 🎯 使用智能排列模式...`);
                            
                            // 获取目标区域（使用占位矩形或画布）
                            const targetBounds: BoundingBox = {
                                left: placeholderRect.left,
                                top: placeholderRect.top,
                                right: placeholderRect.left + placeholderRect.width,
                                bottom: placeholderRect.top + placeholderRect.height,
                                width: placeholderRect.width,
                                height: placeholderRect.height
                            };
                            
                            // 合并配置
                            const arrangeConfig: SmartArrangeConfig = {
                                ...DEFAULT_ARRANGE_CONFIG,
                                ...(config.arrangeConfig || {})
                            };
                            
                            // 执行智能排列
                            const arrangeResult = await smartArrangeLayerGroups(
                                validLayerIds,
                                targetBounds,
                                arrangeConfig
                            );
                            
                            if (arrangeResult.success) {
                                console.log(`[SKULayout] ✅ 智能排列完成: ${arrangeResult.message}`);
                                } else {
                                console.warn(`[SKULayout] ⚠️ 智能排列失败: ${arrangeResult.message}，回退到默认分布`);
                            }
                        }
                        // ===== 传统分布模式 =====
                        // 只有 3 个或更多图层才执行"分布"命令
                        else if (validLayerIds.length >= 3) {
                            try {
                                console.log(`[SKULayout] 开始水平分布，有效图层数: ${validLayerIds.length}, IDs: ${validLayerIds.join(',')}`);
                                
                                // 先选中第一个
                                await action.batchPlay([{
                                    _obj: 'select',
                                    _target: [{ _ref: 'layer', _id: validLayerIds[0] }],
                                    makeVisible: false,
                                    _options: { dialogOptions: 'dontDisplay' }
                                }], { synchronousExecution: true });
                                
                                // 依次添加其他图层到选区
                                for (let i = 1; i < validLayerIds.length; i++) {
                                    await action.batchPlay([{
                                        _obj: 'select',
                                        _target: [{ _ref: 'layer', _id: validLayerIds[i] }],
                                        selectionModifier: { _enum: 'selectionModifierType', _value: 'addToSelection' },
                                        makeVisible: false,
                                        _options: { dialogOptions: 'dontDisplay' }
                                    }], { synchronousExecution: true });
                                }
                                
                                console.log(`[SKULayout] 图层已选中，准备执行分布...`);
                                
                                // 执行水平居中分布（使用 'distort' 与 6.0袜子排版.jsx FBfun 一致）
                                try {
                                    await action.batchPlay([{
                                        _obj: 'distort',  // JSX 脚本中用 'distort' 而非 'distribute'
                                        _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                                        using: { _enum: 'ADSt', _value: 'ADSCentersH' },
                                        _options: { dialogOptions: 'dontDisplay' }
                                    }], { 
                                        synchronousExecution: true,
                                        modalBehavior: 'execute'
                                    });
                                    console.log(`[SKULayout] ✅ 水平分布完成`);
                                } catch (distErr: any) {
                                    // 静默处理，与 JSX 脚本的 catch(e){} 行为一致
                                }
                            } catch (alignErr: any) {
                                console.warn(`[SKULayout] 水平分布处理失败:`, alignErr.message);
                            }
                        } else if (validLayerIds.length === 2) {
                            // 2 个图层：位置已在前面单独计算并设置，无需分布
                            console.log(`[SKULayout] ✅ 2 个图层已定位，跳过分布命令`);
                        } else {
                            console.log(`[SKULayout] 跳过分布（有效图层数不足: ${validLayerIds.length}）`);
                        }
                        
                        console.log(`[SKULayout] ===== 区域 ${placeholderIdx + 1} 处理完成 =====`);
                        
                        } // ★★★ 结束占位矩形循环 ★★★
                        
                        console.log(`[SKULayout] ★ 所有 ${sortedPlaceholderInfo.length} 个区域处理完成，准备导出`);
                        
                        // 导出为 JPEG（参考 6.0袜子排版.jsx 的 saveAs 方式）
                        // 原脚本命名格式：%模板%/%文件序号%%素材%.jpg
                        // 例如：4双装/1白色+浅粉+浅蓝+浅灰.jpg
                        
                        // 获取模板名称（去掉扩展名）
                        const templateName = templateDoc.name.replace(/\.[^.]+$/, '');
                        
                        // 构建输出文件名
                        // 如果是自选备注模式（isNoteTemplate），使用简化格式
                        let outputSubPath: string;
                        let outputFileName: string;
                        
                        if (config.isNoteTemplate && config.noteFilePrefix) {
                            // ★ 自选备注模式：只导出 1 张图，不带序号
                            // 例如："4双自选备注" (直接使用前缀，颜色已经排列在模板上)
                            outputFileName = config.noteFilePrefix;
                            outputSubPath = `${templateName}/${outputFileName}`;
                            console.log(`[SKULayout] 自选备注文件名: ${outputFileName} (展示颜色: ${combo.join('+')})`);
                        } else if (config.noteFilePrefix) {
                            // 非自选备注但有前缀：使用前缀 + 序号
                            outputFileName = `${config.noteFilePrefix}-${comboIndex + 1}`;
                            outputSubPath = `${templateName}/${outputFileName}`;
                        } else {
                            // 普通组合模式：序号 + 颜色名
                            outputFileName = `${comboIndex + 1}${combo.join('+')}`;
                            outputSubPath = `${templateName}/${outputFileName}`;
                        }
                        
                        // 导出（使用 getEntryWithUrl 直接导出，绕过安全限制）
                        const quality = config.quality || 10;
                        app.activeDocument = templateDoc;
                        
                        if (!config.outputDir) {
                            errors.push(`组合 ${comboIndex + 1}: 必须指定输出目录`);
                        } else {
                            const targetDir = `${config.outputDir}\\${templateName}`;
                            const fullPath = `${targetDir}\\${outputFileName}.jpg`;
                            
                            // 使用 JSX 脚本保存（绕过 UXP 安全限制）
                            const saveSuccess = await saveAsJPEGViaJSX(fullPath, quality);
                            
                            if (!saveSuccess) {
                                errors.push(`组合 ${comboIndex + 1}: JSX 保存失败 ${fullPath}`);
                            } else {
                                exportedFiles.push(JSON.stringify({
                                    path: fullPath,
                                    targetName: `${outputFileName}.jpg`,
                                    status: 'exported_jsx'
                                }));
                                console.log(`[SKULayout] ✅ 导出成功: ${fullPath}`);
                            }
                        }
                        
                        // 清理复制的图层（恢复模板原状）
                        for (const layerId of allCopiedLayerIds) {
                            await action.batchPlay([{
                                _obj: 'delete',
                                _target: [{ _ref: 'layer', _id: layerId }],
                                _options: { dialogOptions: 'dontDisplay' }
                            }], { synchronousExecution: true });
                        }
                        
                    }, { commandName: `执行组合排版 ${comboIndex + 1}` });
                    
                } catch (err: any) {
                    console.error(`[SKULayout] 处理组合 ${comboIndex + 1} 失败:`, err);
                    errors.push(`组合 ${comboIndex + 1}: ${err.message}`);
                }
            }

            this.progress = { 
                current: config.combos.length, 
                total: config.combos.length, 
                message: '完成' 
            };

            // 关闭模板文档（不保存修改）
            const templateNameForClose = templateDoc.name;
            await core.executeAsModal(async () => {
                await templateDoc.closeWithoutSaving();
            }, { commandName: '关闭模板文档' });
            console.log(`[SKULayout] ✅ 已关闭模板文档: ${templateNameForClose}`);

            return {
                success: exportedFiles.length > 0,
                error: exportedFiles.length === 0 ? '未导出任何文件' : undefined,
                data: {
                    exportedCount: exportedFiles.length,
                    exportedFiles,
                    errors: errors.length > 0 ? errors : undefined,
                    outputDir: config.outputDir,
                    format: config.format,
                    quality: config.quality
                }
            };

        } catch (error: any) {
            console.error('[SKULayout] executeComboLayout 错误:', error);
            return { success: false, error: error.message, data: null };
        }
    }

    /**
     * 批量执行 SKU 排版
     */
    private async executeBatch(config?: {
        items: Array<{
            skuDocName: string;
            templateDocName: string;
            colorMappings: Array<{
                layerIndex: number;
                colorNames: string[];
            }>;
            outputName?: string;
        }>;
        outputPath?: string;
        quality?: number;
    }): Promise<ToolResult<any>> {
        if (!config || !config.items || config.items.length === 0) {
            return { success: false, error: '缺少批量配置', data: null };
        }

        const results: Array<{ index: number; success: boolean; message: string }> = [];
        this.progress = { current: 0, total: config.items.length, message: '开始批量处理...' };

        for (let i = 0; i < config.items.length; i++) {
            this.progress = { 
                current: i + 1, 
                total: config.items.length, 
                message: `处理第 ${i + 1}/${config.items.length} 个...` 
            };

            const result = await this.executeOneSKU(i, {
                ...config.items[i],
                quality: config.quality
            });

            results.push({
                index: i,
                success: result.success,
                message: result.success ? '成功' : (result.error || '未知错误')
            });
        }

        const successCount = results.filter(r => r.success).length;
        this.progress = { 
            current: config.items.length, 
            total: config.items.length, 
            message: `完成: ${successCount}/${config.items.length} 成功` 
        };

        return {
            success: true,
            data: {
                total: config.items.length,
                successCount,
                failCount: config.items.length - successCount,
                results
            }
        };
    }
}

export default SKULayoutTool;
