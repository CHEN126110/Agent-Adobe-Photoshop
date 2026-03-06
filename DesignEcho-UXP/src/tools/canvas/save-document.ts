/**
 * 文档保存工具
 * 
 * 保存 PSD、导出图片等功能
 */

import { Tool, ToolSchema } from '../types';

const app = require('photoshop').app;
const { core, action } = require('photoshop');
const uxpFs = require('uxp').storage.localFileSystem;

export class SaveDocumentTool implements Tool {
    name = 'saveDocument';

    schema: ToolSchema = {
        name: 'saveDocument',
        description: '保存当前文档。可以保存为 PSD 格式或导出为其他格式（PNG、JPEG等）。',
        parameters: {
            type: 'object',
            properties: {
                format: {
                    type: 'string',
                    enum: ['psd', 'png', 'jpeg', 'jpg', 'tiff', 'pdf'],
                    description: '保存格式，默认为 psd'
                },
                path: {
                    type: 'string',
                    description: '保存路径（可选，如果不提供则使用原路径或弹出保存对话框）'
                },
                quality: {
                    type: 'number',
                    description: 'JPEG 质量 (1-100)，仅 JPEG 格式有效'
                },
                saveAs: {
                    type: 'boolean',
                    description: '是否另存为（即使有原路径也弹出对话框）'
                }
            }
        }
    };

    async execute(params: {
        format?: string;
        path?: string;
        quality?: number;
        saveAs?: boolean;
    }): Promise<{
        success: boolean;
        savedPath?: string;
        format?: string;
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            const format = params.format?.toLowerCase() || 'psd';
            
            await core.executeAsModal(async () => {
                if (format === 'psd') {
                    // 保存 PSD
                    const hasPath = (doc as any).saved;  // 使用 saved 属性判断是否有保存过
                    if (params.saveAs || !hasPath) {
                        // 另存为或新文档，需要选择保存位置
                        await action.batchPlay([
                            {
                                _obj: 'save',
                                as: {
                                    _obj: 'photoshop35Format',
                                    maximizeCompatibility: true
                                },
                                _options: { dialogOptions: 'display' }
                            }
                        ], {});
                    } else {
                        // 直接保存
                        await action.batchPlay([
                            {
                                _obj: 'save',
                                _options: { dialogOptions: 'dontDisplay' }
                            }
                        ], {});
                    }
                } else {
                    // 导出为其他格式
                    await this.exportAs(doc, format, params.quality);
                }
            }, { commandName: `DesignEcho: 保存文档 (${format.toUpperCase()})` });

            console.log(`[SaveDocument] 已保存文档: ${doc.name}, 格式: ${format}`);

            return {
                success: true,
                savedPath: doc.name,
                format
            };

        } catch (error) {
            console.error('[SaveDocument] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '保存失败'
            };
        }
    }

    /**
     * 导出为其他格式
     */
    private async exportAs(doc: any, format: string, quality?: number): Promise<void> {
        const formatMap: Record<string, any> = {
            png: {
                _obj: 'PNGFormat',
                PNGInterlaceType: { _enum: 'PNGInterlaceType', _value: 'PNGInterlaceNone' },
                compression: 6
            },
            jpeg: {
                _obj: 'JPEG',
                quality: quality || 80
            },
            jpg: {
                _obj: 'JPEG',
                quality: quality || 80
            },
            tiff: {
                _obj: 'TIFF',
                byteOrder: { _enum: 'platform', _value: 'IBMPC' },
                LZWCompression: true
            },
            pdf: {
                _obj: 'photoshopPDFFormat',
                pDFPresetFilename: 'High Quality Print',
                preserveEditing: true
            }
        };

        const formatOptions = formatMap[format];
        if (!formatOptions) {
            throw new Error(`不支持的格式: ${format}`);
        }

        await action.batchPlay([
            {
                _obj: 'save',
                as: formatOptions,
                _options: { dialogOptions: 'display' }
            }
        ], {});
    }
}

/**
 * 快速导出工具
 */
export class QuickExportTool implements Tool {
    name = 'quickExport';

    schema: ToolSchema = {
        name: 'quickExport',
        description: '快速导出当前文档或选中的图层为 PNG/JPEG 格式，适合电商场景导出主图、详情图等。',
        parameters: {
            type: 'object',
            properties: {
                format: {
                    type: 'string',
                    enum: ['png', 'jpeg', 'jpg'],
                    description: '导出格式，默认 png'
                },
                scale: {
                    type: 'number',
                    description: '缩放比例 (0.1-4)，例如 2 表示 200%，默认 1'
                },
                quality: {
                    type: 'number',
                    description: 'JPEG 质量 (1-100)，默认 80'
                },
                exportLayers: {
                    type: 'boolean',
                    description: '是否导出选中的图层（而非整个文档）'
                },
                suffix: {
                    type: 'string',
                    description: '文件名后缀，例如 "_主图" 或 "_800x800"'
                }
            }
        }
    };

    async execute(params: {
        format?: string;
        scale?: number;
        quality?: number;
        exportLayers?: boolean;
        suffix?: string;
        outputPath?: string;
    }): Promise<{
        success: boolean;
        exportedFiles?: string[];
        outputPath?: string;
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            const format = params.format?.toLowerCase() || 'png';
            const scale = Math.max(0.1, Math.min(4, params.scale || 1));
            const quality = params.quality || 80;
            const suffix = params.suffix || '';
            const outputPath = params.outputPath;

            await core.executeAsModal(async () => {
                if (outputPath) {
                    // 静默导出到指定路径
                    await this.exportToPath(doc, outputPath, format, quality, suffix);
                } else if (params.exportLayers && doc.activeLayers.length > 0) {
                    for (const layer of doc.activeLayers) {
                        await this.exportLayer(layer, format, scale, quality, suffix);
                    }
                } else {
                    await this.exportDocument(doc, format, scale, quality, suffix);
                }
            }, { commandName: 'DesignEcho: 快速导出' });

            return {
                success: true,
                exportedFiles: ['已导出'],
                outputPath: outputPath || undefined
            };

        } catch (error) {
            console.error('[QuickExport] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '导出失败'
            };
        }
    }

    /**
     * 静默导出到指定路径（跳过对话框）
     */
    private async exportToPath(doc: any, outputPath: string, format: string, quality: number, suffix: string): Promise<void> {
        const normalizeToFileUrl = (p: string) => {
            const normalized = p.replace(/\\/g, '/');
            if (/^file:\/\//i.test(normalized)) return normalized;
            if (/^[a-zA-Z]:\//.test(normalized)) return `file:///${normalized}`;
            return `file://${normalized.startsWith('/') ? '' : '/'}${normalized}`;
        };

        // 构建输出文件名
        const docName = doc.name?.replace(/\.[^.]+$/, '') || 'export';
        const ext = format === 'png' ? '.png' : '.jpg';
        const fileName = `${docName}${suffix}${ext}`;

        try {
            const dirUrl = normalizeToFileUrl(outputPath);
            const dirEntry = await uxpFs.getEntryWithUrl(dirUrl) as any;
            const fileEntry = await dirEntry.createFile(fileName, { overwrite: true });
            const token = await uxpFs.createSessionToken(fileEntry as any);

            await action.batchPlay([{
                _obj: 'save',
                as: format === 'png'
                    ? { _obj: 'PNGFormat', method: { _enum: 'PNGMethod', _value: 'quick' } }
                    : { _obj: 'JPEG', extendedQuality: quality, matteColor: { _enum: 'matteColor', _value: 'white' } },
                in: { _kind: 'local', _path: token },
                lowerCase: true,
                _options: { dialogOptions: 'dontDisplay' }
            }], {});

            console.log(`[QuickExport] 静默导出成功: ${outputPath}/${fileName}`);
        } catch (e: any) {
            console.warn(`[QuickExport] 静默导出失败，降级到对话框: ${e.message}`);
            await this.exportDocument(doc, format, 1, quality, suffix);
        }
    }

    /**
     * 导出整个文档（弹出对话框）
     */
    private async exportDocument(doc: any, format: string, scale: number, quality: number, suffix: string): Promise<void> {
        await action.batchPlay([
            {
                _obj: 'exportSelectionAsFileTypePressed',
                _target: [{ _ref: 'document', _enum: 'ordinal', _value: 'targetEnum' }],
                fileType: format === 'png' ? 'png' : 'jpg',
                quality: quality,
                metadata: 0,
                sRGB: true,
                openWindow: false,
                _options: { dialogOptions: 'display' }
            }
        ], {});
    }

    /**
     * 导出单个图层（弹出对话框）
     */
    private async exportLayer(layer: any, format: string, scale: number, quality: number, suffix: string): Promise<void> {
        await action.batchPlay([
            {
                _obj: 'exportSelectionAsFileTypePressed',
                _target: [{ _ref: 'layer', _id: layer.id }],
                fileType: format === 'png' ? 'png' : 'jpg',
                quality: quality,
                metadata: 0,
                sRGB: true,
                openWindow: false,
                _options: { dialogOptions: 'display' }
            }
        ], {});
    }
}

/**
 * 批量导出工具
 */
export class BatchExportTool implements Tool {
    name = 'batchExport';

    schema: ToolSchema = {
        name: 'batchExport',
        description: '批量导出多个尺寸的图片，适合电商场景同时导出主图、SKU图、详情图等多种规格。',
        parameters: {
            type: 'object',
            properties: {
                presets: {
                    type: 'array',
                    description: '导出预设列表，每个预设包含 width、height、suffix',
                    items: {
                        type: 'object'
                    }
                },
                format: {
                    type: 'string',
                    enum: ['png', 'jpeg'],
                    description: '导出格式，默认 jpeg'
                },
                quality: {
                    type: 'number',
                    description: 'JPEG 质量 (1-100)，默认 85'
                }
            }
        }
    };

    async execute(params: {
        presets?: Array<{ width: number; height: number; suffix: string }>;
        format?: string;
        quality?: number;
    }): Promise<{
        success: boolean;
        exported?: number;
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            // 默认电商导出预设
            const presets = params.presets || [
                { width: 800, height: 800, suffix: '_主图' },
                { width: 400, height: 400, suffix: '_SKU' },
                { width: 750, height: 0, suffix: '_详情' }  // height 0 表示按比例
            ];

            const format = params.format || 'jpeg';
            const quality = params.quality || 85;

            let exported = 0;

            await core.executeAsModal(async () => {
                for (const preset of presets) {
                    try {
                        await this.exportWithSize(doc, preset, format, quality);
                        exported++;
                    } catch (e) {
                        console.error(`[BatchExport] 导出 ${preset.suffix} 失败:`, e);
                    }
                }
            }, { commandName: 'DesignEcho: 批量导出' });

            return {
                success: true,
                exported
            };

        } catch (error) {
            console.error('[BatchExport] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '批量导出失败'
            };
        }
    }

    /**
     * 导出指定尺寸
     */
    private async exportWithSize(
        doc: any, 
        preset: { width: number; height: number; suffix: string },
        format: string,
        quality: number
    ): Promise<void> {
        // 计算目标尺寸
        let targetWidth = preset.width;
        let targetHeight = preset.height;

        if (targetHeight === 0) {
            // 按比例计算高度
            targetHeight = Math.round((targetWidth / doc.width) * doc.height);
        } else if (targetWidth === 0) {
            // 按比例计算宽度
            targetWidth = Math.round((targetHeight / doc.height) * doc.width);
        }

        // 使用 Export As 功能
        await action.batchPlay([
            {
                _obj: 'exportSelectionAsFileTypePressed',
                _target: [{ _ref: 'document', _enum: 'ordinal', _value: 'targetEnum' }],
                fileType: format === 'png' ? 'png' : 'jpg',
                quality: quality,
                metadata: 0,
                width: { _unit: 'pixelsUnit', _value: targetWidth },
                height: { _unit: 'pixelsUnit', _value: targetHeight },
                sRGB: true,
                openWindow: false,
                _options: { dialogOptions: 'display' }
            }
        ], {});
    }
}

/**
 * 智能保存工具
 * 
 * 自动判断保存方式：
 * 1. 如果文档已保存过 → 直接保存到原路径
 * 2. 如果是新文档 → 弹出保存对话框
 */
export class SmartSaveTool implements Tool {
    name = 'smartSave';

    schema: ToolSchema = {
        name: 'smartSave',
        description: '智能保存当前文档。如果文档已有保存路径则直接保存，否则弹出保存对话框。',
        parameters: {
            type: 'object',
            properties: {
                exportFormat: {
                    type: 'string',
                    enum: ['psd', 'psb', 'jpg', 'png'],
                    description: '额外导出格式（可选），除了保存 PSD 外还导出一份指定格式的图片'
                },
                exportQuality: {
                    type: 'number',
                    description: 'JPG 导出质量 (1-100)，默认 85'
                }
            }
        }
    };

    async execute(params: {
        exportFormat?: string;
        exportQuality?: number;
    }): Promise<{
        success: boolean;
        message?: string;
        savedPath?: string;
        exportedPath?: string;
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            const docName = doc.name;
            const isSaved = (doc as any).saved !== false;  // 检查文档是否有原路径
            let savedPath = '';
            
            console.log(`[SmartSave] 文档: ${docName}, 已保存过: ${isSaved}`);

            await core.executeAsModal(async () => {
                if (isSaved) {
                    // 文档有原路径，直接保存
                    console.log('[SmartSave] 直接保存到原路径');
                    await action.batchPlay([
                        {
                            _obj: 'save',
                            _options: { dialogOptions: 'dontDisplay' }
                        }
                    ], { synchronousExecution: true });
                    savedPath = docName;
                } else {
                    // 新文档，弹出保存对话框
                    console.log('[SmartSave] 弹出保存对话框');
                    await action.batchPlay([
                        {
                            _obj: 'save',
                            as: {
                                _obj: 'photoshop35Format',
                                maximizeCompatibility: true
                            },
                            _options: { dialogOptions: 'display' }
                        }
                    ], { synchronousExecution: true });
                    savedPath = doc.name;  // 保存后获取新路径
                }
            }, { commandName: 'DesignEcho: 智能保存' });

            let exportedPath = '';
            
            // 如果需要额外导出
            if (params.exportFormat && params.exportFormat !== 'psd' && params.exportFormat !== 'psb') {
                console.log(`[SmartSave] 额外导出为 ${params.exportFormat}`);
                
                await core.executeAsModal(async () => {
                    const quality = params.exportQuality || 85;
                    const format = params.exportFormat === 'png' ? 'png' : 'jpg';
                    
                    await action.batchPlay([
                        {
                            _obj: 'exportSelectionAsFileTypePressed',
                            _target: [{ _ref: 'document', _enum: 'ordinal', _value: 'targetEnum' }],
                            fileType: format,
                            quality: quality,
                            metadata: 0,
                            sRGB: true,
                            openWindow: false,
                            _options: { dialogOptions: 'display' }
                        }
                    ], { synchronousExecution: true });
                    
                    exportedPath = `${docName.replace(/\.(psd|psb)$/i, '')}.${format}`;
                }, { commandName: `DesignEcho: 导出 ${params.exportFormat.toUpperCase()}` });
            }

            const message = exportedPath 
                ? `✅ 已保存: ${savedPath}\n✅ 已导出: ${exportedPath}`
                : `✅ 已保存: ${savedPath}`;

            return {
                success: true,
                message,
                savedPath,
                exportedPath: exportedPath || undefined
            };

        } catch (error) {
            console.error('[SmartSave] Error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '保存失败'
            };
        }
    }
}