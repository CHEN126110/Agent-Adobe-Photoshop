/**
 * 切片导出工具
 * @description 按屏导出详情页切片为 JPEG/PNG 文件
 */

import { app, action, core, imaging } from 'photoshop';
import { saveAsJPEGViaJSX, ensureDirectoryViaJSX } from './export-folder-service';
import { DetailPageParserTool } from './detail-page-parser';
import { getEntryFromPath } from '../../core/file-url';
import {
    readActiveHistoryStateRef,
    sameHistoryStateRef,
    type PhotoshopHistoryStateRef
} from '../../core/photoshop-history-state-ref';

const uxpStorage = require('uxp').storage;

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
    screenId: string;
    index: number;
    name: string;
    type: ScreenType;
    path: string;
    size: { width: number; height: number };
    fileSize?: number;
}

const SCREEN_SET_ARTIFACT_VERSION = 'runtime-screen-set-artifact/v1' as const;

interface ScreenSetArtifactProof {
    version: typeof SCREEN_SET_ARTIFACT_VERSION;
    basis: 'uxp_full_document_screen_parse';
    documentId: number;
    expectedScreenIds: string[];
    exportedScreenIds: string[];
}

interface SliceExportResult {
    success: boolean;
    screens: ScreenExportResult[];
    outputDir: string;
    totalScreens: number;
    successCount: number;
    failedCount: number;
    totalTime: number;
    sourceHistoryStateRef?: PhotoshopHistoryStateRef;
    sourceStateRestored?: boolean;
    screenSetArtifact?: ScreenSetArtifactProof;
    errors?: string[];
}

function normalizeSliceExportConfig(
    input: Partial<SliceExportConfig> | undefined
): SliceExportConfig {
    const quality = Number(input?.quality);
    const namingPattern = String(input?.namingPattern || '').trim();
    const subfolder = String(input?.subfolder || '').trim();
    return {
        outputDir: String(input?.outputDir || '').trim(),
        format: input?.format === 'png' ? 'png' : 'jpeg',
        quality: Number.isFinite(quality)
            ? Math.max(1, Math.min(12, Math.round(quality)))
            : 10,
        namingPattern: namingPattern || '{index}_{name}',
        createSubfolder: input?.createSubfolder === true,
        subfolder: subfolder || 'detail-page-slices'
    };
}

// ==================== 导出器类 ====================

export class SliceExporter {
    
    /**
     * 导出所有屏为切片
     */
    async exportAll(
        screens: ParsedScreen[],
        rawConfig: Partial<SliceExportConfig> | undefined
    ): Promise<SliceExportResult> {
        const config = normalizeSliceExportConfig(rawConfig);
        const startTime = Date.now();
        const results: ScreenExportResult[] = [];
        const errors: string[] = [];
        const fallbackReasons: string[] = [];

        if (!config.outputDir) {
            return {
                success: false,
                screens: [],
                outputDir: '',
                totalScreens: Array.isArray(screens) ? screens.length : 0,
                successCount: 0,
                failedCount: Array.isArray(screens) ? screens.length : 0,
                totalTime: 0,
                errors: ['缺少切片输出目录']
            };
        }
        
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
        const sourceHistoryStateRef = readActiveHistoryStateRef(doc);
        const screenSetArtifact = await this.verifyFullDocumentScreenSet(
            doc,
            screens,
            sourceHistoryStateRef
        );
        if (!screenSetArtifact) {
            return {
                success: false,
                screens: [],
                outputDir: config.outputDir,
                totalScreens: Array.isArray(screens) ? screens.length : 0,
                successCount: 0,
                failedCount: Array.isArray(screens) ? screens.length : 0,
                totalTime: Date.now() - startTime,
                ...(sourceHistoryStateRef ? { sourceHistoryStateRef } : {}),
                sourceStateRestored: true,
                errors: [
                    '切片屏集合未覆盖当前详情页文档独立解析出的全部屏，或详情页不足 2 屏；已拒绝把局部单屏当成整页交付。'
                ]
            };
        }
        const sourceHistoryState = (doc as any).activeHistoryState;
        const sourceCanvasSize = {
            width: Number(doc.width),
            height: Number(doc.height)
        };
        
        // 保存原始可见性状态
        const originalState = await this.captureVisibilityState(doc);
        
        // 确保输出目录存在（统一正斜杠拼接，防反斜杠在 JSX 层被吞）
        const outputDir = config.createSubfolder
            ? `${config.outputDir}/${config.subfolder}`
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
        
        let sourceStateRestored = false;
        try {
            for (let i = 0; i < screens.length; i++) {
                const screen = screens[i];
                
                try {
                    console.log(`[SliceExporter] 导出屏 ${i + 1}/${screens.length}: ${screen.name}`);
                    // 快路径：imaging.getPixels 区域取像素直接落盘，不裁切文档、不动历史
                    // （旧 crop→saveAs→历史回退 路径在 1.6GB PSB 上每屏 ~11s，且中断会留下半裁切状态）。
                    // 失败时回退旧路径，保持导出能力不丢失。
                    let result: ScreenExportResult;
                    try {
                        result = await this.exportScreenViaImaging(screen, i, outputDir, config, doc);
                    } catch (imagingError: any) {
                        if (imagingError?.sourceRestoreFailure === true) {
                            throw imagingError;
                        }
                        const reason = `imaging 快路径失败（屏 ${screen.name}）：${imagingError?.message || imagingError}`;
                        console.warn(`[SliceExporter] ${reason}，回退裁切导出`);
                        fallbackReasons.push(reason);
                        result = await this.exportScreen(screen, i, outputDir, config, doc);
                    }
                    results.push(result);
                    console.log(`[SliceExporter] ✅ 导出成功: ${result.path}`);
                } catch (e: any) {
                    const errorMsg = `屏 ${i + 1} 导出失败: ${e.message}`;
                    errors.push(errorMsg);
                    console.error(`[SliceExporter] ❌ ${errorMsg}`);
                    if (e?.sourceRestoreFailure === true) {
                        errors.push('源文档恢复失败，已停止后续切片导出');
                        break;
                    }
                }
            }
        } finally {
            try {
                await this.restoreHistoryState(
                    doc,
                    sourceHistoryState,
                    '恢复切片导出前文档版本'
                );
            } catch (restoreError: any) {
                errors.push(`恢复切片导出前文档版本失败：${restoreError?.message || restoreError}`);
            }
            try {
                await this.restoreVisibilityState(
                    doc,
                    originalState,
                    '恢复切片导出前图层可见性'
                );
            } catch (restoreError: any) {
                errors.push(`恢复切片导出前图层可见性失败：${restoreError?.message || restoreError}`);
            }
            sourceStateRestored = sameHistoryStateRef(
                sourceHistoryStateRef,
                readActiveHistoryStateRef(doc)
            )
                && Number(app.activeDocument?.id) === Number(doc.id)
                && Number(doc.width) === sourceCanvasSize.width
                && Number(doc.height) === sourceCanvasSize.height
                && this.isVisibilityStateRestored(doc, originalState);
        }
        if (!sourceStateRestored) {
            errors.push('导出后未能证明源文档与原始可见性状态已恢复');
        }
        
        const allMessages = [...errors, ...fallbackReasons];
        const result: SliceExportResult = {
            success: errors.length === 0 && sourceStateRestored,
            screens: results,
            outputDir,
            totalScreens: screens.length,
            successCount: results.length,
            failedCount: errors.length,
            totalTime: Date.now() - startTime,
            ...(sourceHistoryStateRef ? { sourceHistoryStateRef } : {}),
            sourceStateRestored,
            screenSetArtifact: {
                ...screenSetArtifact,
                exportedScreenIds: results.map((screen) => screen.screenId)
            },
            errors: allMessages.length > 0 ? allMessages : undefined
        };
        
        console.log(`[SliceExporter] 导出完成: ${results.length}/${screens.length} 成功, 耗时 ${result.totalTime}ms`);
        
        return result;
    }

    private async verifyFullDocumentScreenSet(
        doc: any,
        screens: ParsedScreen[],
        sourceHistoryStateRef: PhotoshopHistoryStateRef | undefined
    ): Promise<ScreenSetArtifactProof | undefined> {
        if (!sourceHistoryStateRef
            || !Array.isArray(screens)
            || screens.length < 2
            || screens.length > 64) {
            return undefined;
        }
        const parsed = await new DetailPageParserTool().execute({
            includeStructure: false
        });
        const afterParseHistoryStateRef = readActiveHistoryStateRef(doc);
        if (!parsed.success
            || parsed.screenCount < 2
            || parsed.screenCount > 64
            || parsed.screenCount !== parsed.screens.length
            || !sameHistoryStateRef(sourceHistoryStateRef, parsed.historyStateRef)
            || !sameHistoryStateRef(sourceHistoryStateRef, afterParseHistoryStateRef)) {
            return undefined;
        }
        const expectedScreenIds = parsed.screens.map((screen) => String(screen.id));
        const suppliedScreenIds = screens.map((screen) => String(screen.id));
        if (new Set(expectedScreenIds).size !== expectedScreenIds.length
            || new Set(suppliedScreenIds).size !== suppliedScreenIds.length
            || expectedScreenIds.length !== suppliedScreenIds.length
            || expectedScreenIds.some((screenId, index) => screenId !== suppliedScreenIds[index])) {
            return undefined;
        }
        const parsedById = new Map(parsed.screens.map((screen) => [Number(screen.id), screen]));
        const suppliedScreensMatch = screens.every((screen) => {
            const expected = parsedById.get(Number(screen.id));
            if (!expected
                || String(expected.name || '').trim() !== String(screen.name || '').trim()
                || Number(expected.index) !== Number(screen.index)) {
                return false;
            }
            const expectedBounds = expected.bounds;
            const suppliedBounds = screen.bounds;
            return ['left', 'top', 'right', 'bottom', 'width', 'height'].every((key) => {
                const expectedValue = Number(expectedBounds[key as keyof BoundingBox]);
                const suppliedValue = Number(suppliedBounds?.[key as keyof BoundingBox]);
                return Number.isFinite(expectedValue)
                    && Number.isFinite(suppliedValue)
                    && Math.abs(expectedValue - suppliedValue) <= 1;
            });
        });
        if (!suppliedScreensMatch) return undefined;
        return {
            version: SCREEN_SET_ARTIFACT_VERSION,
            basis: 'uxp_full_document_screen_parse',
            documentId: sourceHistoryStateRef.documentId,
            expectedScreenIds,
            exportedScreenIds: []
        };
    }
    
    /** clamp 屏边界到画布内（出血部分画布外不可见，导出按画布内区域） */
    private clampScreenBoundsToCanvas(
        screen: ParsedScreen,
        doc: any
    ): { left: number; top: number; right: number; bottom: number; width: number; height: number } {
        const docWidth = Number(doc.width);
        const docHeight = Number(doc.height);
        const left = Math.max(0, Math.round(screen.bounds.left));
        const top = Math.max(0, Math.round(screen.bounds.top));
        const right = Math.min(docWidth, Math.round(screen.bounds.right));
        const bottom = Math.min(docHeight, Math.round(screen.bounds.bottom));
        if (right - left < 4 || bottom - top < 4) {
            throw new Error(`屏 ${screen.name} 的边界与画布几乎无交集（${JSON.stringify(screen.bounds)}），无法导出。`);
        }
        return { left, top, right, bottom, width: right - left, height: bottom - top };
    }

    /**
     * 快路径导出单屏：可见性切换 → imaging.getPixels(区域合成像素) → encodeImageData(JPEG)
     * → UXP fullAccess 文件系统直接落盘。全程不修改文档（无裁切、无历史回退）。
     * 注意：encodeImageData 的 JPEG 质量不可配置，config.quality 仅对回退路径生效。
     */
    private async exportScreenViaImaging(
        screen: ParsedScreen,
        index: number,
        outputDir: string,
        config: SliceExportConfig,
        doc: any
    ): Promise<ScreenExportResult> {
        if (config.format !== 'jpeg') {
            throw new Error('imaging 快路径目前只输出 JPEG，PNG 走回退路径。');
        }
        const crop = this.clampScreenBoundsToCanvas(screen, doc);
        const screenHistoryState = (doc as any).activeHistoryState;
        const screenVisibilityState = await this.captureVisibilityState(doc);

        let base64 = '';
        try {
            await core.executeAsModal(async () => {
                await this.selectDocument(doc);
                for (const layer of doc.layers) {
                    if (layer.kind === 'group') {
                        layer.visible = (layer.id === screen.id);
                    }
                }
                const pixelResult = await imaging.getPixels({
                    documentID: doc.id,
                    sourceBounds: { left: crop.left, top: crop.top, right: crop.right, bottom: crop.bottom },
                    // JPEG 编码不接受 alpha 通道：把 alpha 合成进 RGB（实测报错
                    // "Image data with alpha cannot be encoded as jpeg"）
                    applyAlpha: true
                });
                if (!pixelResult?.imageData) {
                    throw new Error('imaging.getPixels 未返回像素数据');
                }
                try {
                    const encoded = await imaging.encodeImageData({
                        imageData: pixelResult.imageData,
                        base64: true
                    });
                    if (!encoded || typeof encoded !== 'string') {
                        throw new Error('imaging.encodeImageData 未返回 base64');
                    }
                    base64 = encoded;
                } finally {
                    pixelResult.imageData.dispose();
                }
            }, { commandName: `导出屏 ${index + 1}（imaging）` });

            const fileName = this.generateFileName(screen, index, config.namingPattern);
            const filePath = `${outputDir}/${fileName}.jpg`;
            const fileSize = await this.writeBase64File(filePath, base64);

            return {
                screenId: String(screen.id),
                index,
                name: screen.name,
                type: screen.type,
                path: filePath,
                size: { width: crop.width, height: crop.height },
                fileSize
            };
        } finally {
            const restoreErrors: string[] = [];
            try {
                await this.restoreHistoryState(
                    doc,
                    screenHistoryState,
                    `恢复屏 ${index + 1} imaging 导出前状态`
                );
            } catch (error: any) {
                restoreErrors.push(error?.message || String(error));
            }
            try {
                await this.restoreVisibilityState(
                    doc,
                    screenVisibilityState,
                    `恢复屏 ${index + 1} imaging 导出前可见性`
                );
            } catch (error: any) {
                restoreErrors.push(error?.message || String(error));
            }
            if (!this.isVisibilityStateRestored(doc, screenVisibilityState)) {
                restoreErrors.push('图层可见性未恢复');
            }
            if (restoreErrors.length > 0) {
                const error: any = new Error(
                    `屏 ${screen.name} imaging 导出后未能恢复源文档：${restoreErrors.join('；')}`
                );
                error.sourceRestoreFailure = true;
                throw error;
            }
        }
    }

    /** base64 → 二进制写入任意路径（manifest localFileSystem=fullAccess） */
    private async writeBase64File(filePath: string, base64: string): Promise<number> {
        const fs = uxpStorage.localFileSystem;
        const normalizedPath = String(filePath || '').trim();
        const slashIndex = Math.max(normalizedPath.lastIndexOf('\\'), normalizedPath.lastIndexOf('/'));
        const directoryPath = slashIndex >= 0 ? normalizedPath.slice(0, slashIndex) : '';
        const fileName = slashIndex >= 0 ? normalizedPath.slice(slashIndex + 1) : normalizedPath;
        if (!directoryPath || !fileName) {
            throw new Error(`Invalid export file path: ${normalizedPath}`);
        }

        const directoryEntry = await getEntryFromPath(fs, directoryPath) as any;
        const entry = await directoryEntry.createFile(fileName, { overwrite: true }) as any;
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        await entry.write(bytes.buffer, { format: uxpStorage.formats.binary });
        return await this.assertExportFile(filePath);
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
        const screenHistoryState = (doc as any).activeHistoryState;
        const screenVisibilityState = await this.captureVisibilityState(doc);
        try {
            await core.executeAsModal(async () => {
                await this.selectDocument(doc);
                for (const layer of doc.layers) {
                    if (layer.kind === 'group') {
                        layer.visible = (layer.id === screen.id);
                    }
                }
            }, { commandName: `显示屏 ${index + 1}` });

            // 屏 bounds 常含画布外出血（left 为负），crop 矩形必须 clamp 到画布内。
            const originalWidth = Number(doc.width);
            const originalHeight = Number(doc.height);
            const cropLeft = Math.max(0, Math.round(screen.bounds.left));
            const cropTop = Math.max(0, Math.round(screen.bounds.top));
            const cropRight = Math.min(originalWidth, Math.round(screen.bounds.right));
            const cropBottom = Math.min(originalHeight, Math.round(screen.bounds.bottom));
            if (cropRight - cropLeft < 4 || cropBottom - cropTop < 4) {
                throw new Error(`屏 ${screen.name} 的边界与画布几乎无交集（${JSON.stringify(screen.bounds)}），无法裁切导出。`);
            }

            await core.executeAsModal(async () => {
                await this.selectDocument(doc);
                await action.batchPlay([{
                    _obj: 'crop',
                    to: {
                        _obj: 'rectangle',
                        top: { _unit: 'pixelsUnit', _value: cropTop },
                        left: { _unit: 'pixelsUnit', _value: cropLeft },
                        bottom: { _unit: 'pixelsUnit', _value: cropBottom },
                        right: { _unit: 'pixelsUnit', _value: cropRight }
                    },
                    angle: { _unit: 'angleUnit', _value: 0 },
                    delete: true
                }], { synchronousExecution: true });
            }, { commandName: `裁切屏 ${index + 1}` });

            const croppedWidth = Number(doc.width);
            const croppedHeight = Number(doc.height);
            const expectedWidth = cropRight - cropLeft;
            const expectedHeight = cropBottom - cropTop;
            if (Math.abs(croppedWidth - expectedWidth) > 2
                || Math.abs(croppedHeight - expectedHeight) > 2) {
                throw new Error(`屏 ${screen.name} 裁切未生效：期望 ${expectedWidth}x${expectedHeight}，实际 ${croppedWidth}x${croppedHeight}。`);
            }

            const fileName = this.generateFileName(screen, index, config.namingPattern);
            const extension = config.format === 'jpeg' ? 'jpg' : 'png';
            const filePath = `${outputDir}/${fileName}.${extension}`;
            const saveStartedAt = Date.now();
            await this.removeExistingExportFile(filePath);
            const saved = config.format === 'jpeg'
                ? await saveAsJPEGViaJSX(filePath, config.quality, Number(doc.id))
                : await this.saveAsPNG(filePath, doc);
            if (!saved) throw new Error('导出失败');
            const fileSize = await this.assertExportFile(filePath, saveStartedAt);

            return {
                screenId: String(screen.id),
                index,
                name: screen.name,
                type: screen.type,
                path: filePath,
                size: {
                    width: expectedWidth,
                    height: expectedHeight
                },
                fileSize
            };
        } finally {
            const restoreErrors: string[] = [];
            try {
                await this.restoreHistoryState(
                    doc,
                    screenHistoryState,
                    `恢复屏 ${index + 1} 导出前状态`
                );
            } catch (error: any) {
                restoreErrors.push(error?.message || String(error));
            }
            try {
                await this.restoreVisibilityState(
                    doc,
                    screenVisibilityState,
                    `恢复屏 ${index + 1} 导出前可见性`
                );
            } catch (error: any) {
                restoreErrors.push(error?.message || String(error));
            }
            if (!this.isVisibilityStateRestored(doc, screenVisibilityState)) {
                restoreErrors.push('图层可见性未恢复');
            }
            if (restoreErrors.length > 0) {
                const error: any = new Error(
                    `屏 ${screen.name} 导出后未能恢复源文档：${restoreErrors.join('；')}`
                );
                error.sourceRestoreFailure = true;
                throw error;
            }
        }
    }
    
    /**
     * 保存为 PNG (使用 JSX)
     */
    private async saveAsPNG(outputPath: string, doc: any): Promise<boolean> {
        const uxp = require('uxp');
        const fs = uxp.storage.localFileSystem;

        // 统一正斜杠进 JSX（防反斜杠被转义吞掉，详见 export-folder-service）
        const escapedPath = outputPath.replace(/\\+/g, '/');
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
                await this.selectDocument(doc);
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
    
    private async restoreHistoryState(
        doc: any,
        historyState: any,
        commandName: string
    ): Promise<void> {
        if (!historyState) {
            throw new Error('无法读取待恢复的 Photoshop 历史状态');
        }
        await core.executeAsModal(async () => {
            await this.selectDocument(doc);
            (doc as any).activeHistoryState = historyState;
        }, { commandName });
    }

    private async selectDocument(doc: any): Promise<void> {
        if (Number(app.activeDocument?.id) === Number(doc.id)) return;
        await action.batchPlay([{
            _obj: 'select',
            _target: [{ _ref: 'document', _id: Number(doc.id) }]
        }], { synchronousExecution: true });
        if (Number(app.activeDocument?.id) !== Number(doc.id)) {
            throw new Error('无法切回切片导出的源 Photoshop 文档');
        }
    }

    private async assertExportFile(filePath: string, minModifiedAt?: number): Promise<number> {
        const entry = await getEntryFromPath(uxpStorage.localFileSystem, filePath) as any;
        if (entry?.isFile === false) {
            throw new Error(`导出目标不是文件：${filePath}`);
        }
        const metadata = typeof entry?.getMetadata === 'function'
            ? await entry.getMetadata()
            : undefined;
        const size = Number(metadata?.size);
        if (!Number.isFinite(size) || size <= 0) {
            throw new Error(`导出文件不存在或为空：${filePath}`);
        }
        if (Number.isFinite(Number(minModifiedAt))) {
            const modifiedAt = metadata?.dateModified instanceof Date
                ? metadata.dateModified.getTime()
                : Date.parse(String(metadata?.dateModified || ''));
            if (!Number.isFinite(modifiedAt) || modifiedAt < Number(minModifiedAt) - 2_000) {
                throw new Error(`导出文件不是本轮新生成的结果：${filePath}`);
            }
        }
        return size;
    }

    private async removeExistingExportFile(filePath: string): Promise<void> {
        let entry: any;
        try {
            entry = await getEntryFromPath(uxpStorage.localFileSystem, filePath) as any;
        } catch {
            return;
        }
        if (entry?.isFile === false || typeof entry?.delete !== 'function') {
            throw new Error(`无法清理已有导出目标：${filePath}`);
        }
        await entry.delete();
    }

    private async restoreVisibilityState(
        doc: any,
        state: Map<number, boolean>,
        commandName: string
    ): Promise<void> {
        await core.executeAsModal(async () => {
            await this.selectDocument(doc);
            const restore = (layers: any[]): void => {
                for (const layer of layers) {
                    const expected = state.get(layer.id);
                    if (expected !== undefined && layer.visible !== expected) {
                        layer.visible = expected;
                    }
                    if (layer.layers) {
                        restore(Array.isArray(layer.layers) ? layer.layers : [layer.layers]);
                    }
                }
            };
            if (doc.layers) {
                restore(Array.isArray(doc.layers) ? doc.layers : [doc.layers]);
            }
        }, { commandName });
    }

    private isVisibilityStateRestored(
        doc: any,
        state: Map<number, boolean>
    ): boolean {
        let visited = 0;
        let restored = true;
        const inspect = (layers: any[]): void => {
            for (const layer of layers) {
                const originalVisible = state.get(layer.id);
                if (originalVisible === undefined || layer.visible !== originalVisible) {
                    restored = false;
                } else {
                    visited += 1;
                }
                if (layer.layers) {
                    inspect(Array.isArray(layer.layers) ? layer.layers : [layer.layers]);
                }
            }
        };
        if (doc.layers) {
            inspect(Array.isArray(doc.layers) ? doc.layers : [doc.layers]);
        }
        return restored && visited === state.size;
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
