/**
 * 切片导出工具
 * @description 按屏导出详情页切片为 JPEG/PNG 文件
 */

import { app, action, core } from 'photoshop';
import { saveAsJPEGViaJSX, ensureDirectoryViaJSX } from './export-folder-service';

// ==================== 类型定义 ====================

interface BoundingBox {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

type ScreenType = string;

interface ParsedScreen {
    id: number;
    name: string;
    type: ScreenType;
    index: number;
    bounds: BoundingBox;
    visible: boolean;
}

interface SliceExportConfig {
    outputDir: string;
    format: 'jpeg' | 'png';
    quality: number;
    namingPattern: string;
    createSubfolder: boolean;
    subfolder: string;
}

interface ScreenExportResult {
    index: number;
    name: string;
    type: ScreenType;
    path: string;
    size: { width: number; height: number };
    fileSize?: number;
}

interface SliceExportResult {
    success: boolean;
    screens: ScreenExportResult[];
    outputDir: string;
    totalScreens: number;
    successCount: number;
    failedCount: number;
    totalTime: number;
    errors?: string[];
}

// ==================== 导出器类 ====================

export class SliceExporter {
    
    /**
     * 导出所有屏为切片
     */
    async exportAll(
        screens: ParsedScreen[],
        config: SliceExportConfig
    ): Promise<SliceExportResult> {
        const startTime = Date.now();
        const results: ScreenExportResult[] = [];
        const errors: string[] = [];
        
        const doc = app.activeDocument;
        if (!doc) {
            return {
                success: false,
                screens: [],
                outputDir: config.outputDir,
                totalScreens: 0,
                successCount: 0,
                failedCount: 0,
                totalTime: 0,
                errors: ['没有打开的文档']
            };
        }
        
        // 保存原始可见性状态
        const originalState = await this.captureVisibilityState(doc);
        
        // 确保输出目录存在
        const outputDir = config.createSubfolder 
            ? `${config.outputDir}\\${config.subfolder}`
            : config.outputDir;
        
        console.log(`[SliceExporter] 输出目录: ${outputDir}`);
        
        const dirReady = await ensureDirectoryViaJSX(outputDir);
        if (!dirReady) {
            return {
                success: false,
                screens: [],
                outputDir,
                totalScreens: screens.length,
                successCount: 0,
                failedCount: screens.length,
                totalTime: Date.now() - startTime,
                errors: [`无法创建输出目录: ${outputDir}`]
            };
        }
        
        console.log(`[SliceExporter] 开始导出 ${screens.length} 屏`);
        
        try {
            for (let i = 0; i < screens.length; i++) {
                const screen = screens[i];
                
                try {
                    console.log(`[SliceExporter] 导出屏 ${i + 1}/${screens.length}: ${screen.name}`);
                    const result = await this.exportScreen(screen, i, outputDir, config, doc);
                    results.push(result);
                    console.log(`[SliceExporter] ✅ 导出成功: ${result.path}`);
                } catch (e: any) {
                    const errorMsg = `屏 ${i + 1} 导出失败: ${e.message}`;
                    errors.push(errorMsg);
                    console.error(`[SliceExporter] ❌ ${errorMsg}`);
                }
            }
        } finally {
            // 恢复原始可见性状态
            await this.restoreVisibilityState(doc, originalState);
        }
        
        const result: SliceExportResult = {
            success: errors.length === 0,
            screens: results,
            outputDir,
            totalScreens: screens.length,
            successCount: results.length,
            failedCount: errors.length,
            totalTime: Date.now() - startTime,
            errors: errors.length > 0 ? errors : undefined
        };
        
        console.log(`[SliceExporter] 导出完成: ${results.length}/${screens.length} 成功, 耗时 ${result.totalTime}ms`);
        
        return result;
    }
    
    /**
     * 导出单个屏
     */
    private async exportScreen(
        screen: ParsedScreen,
        index: number,
        outputDir: string,
        config: SliceExportConfig,
        doc: any
    ): Promise<ScreenExportResult> {
        
        // 1. 隐藏其他屏，只显示当前屏
        await core.executeAsModal(async () => {
            for (const layer of doc.layers) {
                if (layer.kind === 'group') {
                    layer.visible = (layer.id === screen.id);
                }
            }
        }, { commandName: `显示屏 ${index + 1}` });
        
        // 2. 裁切到当前屏边界
        const originalWidth = doc.width;
        const originalHeight = doc.height;
        
        await core.executeAsModal(async () => {
            const bounds = screen.bounds;
            await action.batchPlay([{
                _obj: 'crop',
                to: {
                    _obj: 'rectangle',
                    top: { _unit: 'pixelsUnit', _value: bounds.top },
                    left: { _unit: 'pixelsUnit', _value: bounds.left },
                    bottom: { _unit: 'pixelsUnit', _value: bounds.bottom },
                    right: { _unit: 'pixelsUnit', _value: bounds.right }
                },
                delete: true
            }], { synchronousExecution: true });
        }, { commandName: `裁切屏 ${index + 1}` });
        
        // 3. 生成文件名和路径
        const fileName = this.generateFileName(screen, index, config.namingPattern);
        const extension = config.format === 'jpeg' ? 'jpg' : 'png';
        const filePath = `${outputDir}\\${fileName}.${extension}`;
        
        // 4. 导出
        let saved = false;
        if (config.format === 'jpeg') {
            saved = await saveAsJPEGViaJSX(filePath, config.quality);
        } else {
            // PNG 导出
            saved = await this.saveAsPNG(filePath);
        }
        
        // 5. 撤销裁切 (恢复原始尺寸)
        await core.executeAsModal(async () => {
            // 使用历史记录回退
            await action.batchPlay([{
                _obj: 'select',
                _target: [{ _ref: 'historyState', _offset: -1 }]
            }], { synchronousExecution: true });
        }, { commandName: `撤销裁切` });
        
        if (!saved) {
            throw new Error('导出失败');
        }
        
        return {
            index,
            name: screen.name,
            type: screen.type,
            path: filePath,
            size: {
                width: screen.bounds.width,
                height: screen.bounds.height
            }
        };
    }
    
    /**
     * 保存为 PNG (使用 JSX)
     */
    private async saveAsPNG(outputPath: string): Promise<boolean> {
        const uxp = require('uxp');
        const fs = uxp.storage.localFileSystem;
        
        const escapedPath = outputPath.replace(/\\/g, '\\\\');
        const jsxScript = `
try {
    var doc = app.activeDocument;
    var saveFile = new File("${escapedPath}");
    var parentFolder = saveFile.parent;
    if (!parentFolder.exists) {
        parentFolder.create();
    }
    var pngOptions = new PNGSaveOptions();
    pngOptions.compression = 6;
    pngOptions.interlaced = false;
    doc.saveAs(saveFile, pngOptions, true, Extension.LOWERCASE);
    "SUCCESS";
} catch(e) {
    "ERROR:" + e.message;
}
`;
        
        try {
            const tempFolder = await fs.getTemporaryFolder();
            const jsxFileName = `save_png_${Date.now()}.jsx`;
            const jsxFile = await tempFolder.createFile(jsxFileName, { overwrite: true });
            await jsxFile.write(jsxScript);
            const jsxToken = await fs.createSessionToken(jsxFile);
            
            let resultMessage = '';
            await core.executeAsModal(async () => {
                const result = await action.batchPlay([{
                    _obj: "AdobeScriptAutomation Scripts",
                    javaScript: {
                        _path: jsxToken,
                        _kind: "local"
                    },
                    javaScriptMessage: "savePNG"
                }], { synchronousExecution: true });
                resultMessage = result?.[0]?.javaScriptMessage || '';
            }, { commandName: "保存 PNG (JSX)" });
            
            // 清理临时文件
            try {
                await jsxFile.delete();
            } catch {
                // 忽略
            }
            
            return resultMessage === 'SUCCESS' || resultMessage === '' || !resultMessage.startsWith('ERROR:');
        } catch (e: any) {
            console.error(`[SliceExporter] PNG 导出异常: ${e.message}`);
            return false;
        }
    }
    
    /**
     * 生成文件名
     */
    private generateFileName(
        screen: ParsedScreen, 
        index: number, 
        pattern: string
    ): string {
        const paddedIndex = String(index + 1).padStart(2, '0');
        const safeName = screen.name.replace(/[\\/:*?"<>|]/g, '_');
        const typeShort = screen.type.split('_')[1] || screen.type;
        
        return pattern
            .replace('{index}', paddedIndex)
            .replace('{name}', safeName)
            .replace('{type}', typeShort);
    }
    
    /**
     * 捕获所有图层的可见性状态
     */
    private async captureVisibilityState(doc: any): Promise<Map<number, boolean>> {
        const state = new Map<number, boolean>();
        
        const capture = (layers: any[]) => {
            for (const layer of layers) {
                state.set(layer.id, layer.visible);
                if (layer.layers) {
                    capture(layer.layers);
                }
            }
        };
        
        if (doc.layers) {
            capture(Array.isArray(doc.layers) ? doc.layers : [doc.layers]);
        }
        
        return state;
    }
    
    /**
     * 恢复所有图层的可见性状态
     */
    private async restoreVisibilityState(
        doc: any, 
        state: Map<number, boolean>
    ): Promise<void> {
        await core.executeAsModal(async () => {
            const restore = (layers: any[]) => {
                for (const layer of layers) {
                    const originalVisible = state.get(layer.id);
                    if (originalVisible !== undefined) {
                        try {
                            layer.visible = originalVisible;
                        } catch {
                            // 忽略恢复失败
                        }
                    }
                    if (layer.layers) {
                        restore(layer.layers);
                    }
                }
            };
            
            if (doc.layers) {
                restore(Array.isArray(doc.layers) ? doc.layers : [doc.layers]);
            }
        }, { commandName: '恢复可见性' });
    }
}

// ==================== 工具类 ====================

export class SliceExporterTool {
    name = 'exportDetailPageSlices';
    
    schema = {
        name: 'exportDetailPageSlices',
        description: '按屏导出详情页切片为 JPEG/PNG 文件',
        parameters: {
            type: 'object' as const,
            properties: {
                screens: {
                    type: 'array',
                    description: '要导出的屏列表'
                },
                config: {
                    type: 'object',
                    description: '导出配置',
                    properties: {
                        outputDir: { type: 'string', description: '输出目录' },
                        format: { type: 'string', description: 'jpeg 或 png' },
                        quality: { type: 'number', description: 'JPEG 质量 1-12' },
                        namingPattern: { type: 'string', description: '命名模式' },
                        createSubfolder: { type: 'boolean', description: '是否创建子目录' },
                        subfolder: { type: 'string', description: '子目录名称' }
                    }
                }
            },
            required: ['screens', 'config'] as string[]
        }
    };
    
    async execute(params: { screens: ParsedScreen[]; config: SliceExportConfig }): Promise<SliceExportResult> {
        const exporter = new SliceExporter();
        return await exporter.exportAll(params.screens, params.config);
    }
}
