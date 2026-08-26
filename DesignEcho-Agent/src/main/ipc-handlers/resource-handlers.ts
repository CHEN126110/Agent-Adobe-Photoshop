/**
 * 资源管理相关 IPC Handlers
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import type { IPCContext } from './types';
import type { ModelService } from '../services/model-service';
import type { TaskOrchestrator } from '../services/task-orchestrator';

/** 把 dataURL 或裸 base64 拆成 ModelService 多模态消息需要的 {mediaType, data} */
function splitImageBase64(imageBase64: string): { mediaType: string; data: string } {
    const dataUrlMatch = /^data:([^;]+);base64,(.*)$/s.exec(imageBase64);
    if (dataUrlMatch) {
        return { mediaType: dataUrlMatch[1], data: dataUrlMatch[2] };
    }
    return { mediaType: 'image/jpeg', data: imageBase64 };
}

/**
 * 构造图像观察调用：复用用户配置的唯一 Agent 模型（兼容读取 getAgentModels().vision）。
 * 图像必须用 ModelService 的 {type:'image', image:{mediaType,data}} 内容块——
 * OpenAI 风格 {type:'image_url'} 会被各 provider 转换器静默丢弃，模型只看到文本（实测教训）。
 */
export function buildVisionModelCall(
    modelService: ModelService,
    taskOrchestrator: TaskOrchestrator | null
): (imageBase64: string, prompt: string) => Promise<string> {
    return async (imageBase64: string, prompt: string): Promise<string> => {
        // 只使用用户配置的 Agent 模型，不硬编码回退到其他供应商模型。
        const configuredVisionModel = taskOrchestrator?.getAgentModels?.()?.vision;
        if (!configuredVisionModel) {
            throw new Error('当前没有可用的视觉多模态 Agent 模型。请在设置中选择已标记视觉能力的模型。');
        }

        const { mediaType, data } = splitImageBase64(imageBase64);
        try {
            // 看图描述 / 返回 JSON 不需要长思考：mimo 系默认开思考时一张素材 20 秒起步，
            // 还常把预算全花在思考上正文为空（评审器、视觉专家已同一口径关思考）。
            const response = await modelService.chat(
                configuredVisionModel,
                [{ role: 'user', content: [
                    { type: 'text', text: prompt },
                    { type: 'image', image: { mediaType, data } }
                ] as any }],
                { thinkingEnabled: false, maxTokens: 2500 }
            );
            const text = response.text || '';
            if (text.trim()) return text;
            throw new Error(`${configuredVisionModel}: 返回了空文本`);
        } catch (e) {
            throw new Error(`Agent 模型 ${configuredVisionModel} 读取画面失败：${e instanceof Error ? e.message : e}`);
        }
    };
}

/**
 * 注册资源管理相关 IPC handlers
 */
export function registerResourceHandlers(context: IPCContext): void {
    const { resourceManagerService, modelService, taskOrchestrator } = context;

    // 设置项目根目录
    ipcMain.handle('resource:setProjectRoot', async (_event: IpcMainInvokeEvent, rootPath: string) => {
        if (!resourceManagerService) {
            throw new Error('资源管理服务未初始化');
        }
        resourceManagerService.setProjectRoot(rootPath);
        return { success: true, path: rootPath };
    });

    // 获取项目根目录
    ipcMain.handle('resource:getProjectRoot', async () => {
        if (!resourceManagerService) {
            return null;
        }
        return resourceManagerService.getProjectRoot();
    });

    // 扫描目录
    ipcMain.handle('resource:scanDirectory', async (_event: IpcMainInvokeEvent, dirPath?: string, options?: {
        recursive?: boolean;
        includeDesignFiles?: boolean;
        maxDepth?: number;
        generateThumbnails?: boolean;
    }) => {
        if (!resourceManagerService) {
            throw new Error('资源管理服务未初始化');
        }
        return await resourceManagerService.scanDirectory(dirPath, options);
    });

    // 搜索资源
    ipcMain.handle('resource:search', async (_event: IpcMainInvokeEvent, query: string, options?: {
        directory?: string;
        type?: 'image' | 'design' | 'all';
        limit?: number;
    }) => {
        if (!resourceManagerService) {
            throw new Error('资源管理服务未初始化');
        }
        return await resourceManagerService.searchResources(query, options);
    });

    // 获取目录结构
    ipcMain.handle('resource:getStructure', async (_event: IpcMainInvokeEvent, directory?: string, maxDepth?: number) => {
        if (!resourceManagerService) {
            throw new Error('资源管理服务未初始化');
        }
        return await resourceManagerService.getDirectoryStructure(directory, maxDepth);
    });

    // 获取资源摘要
    ipcMain.handle('resource:getSummary', async (_event: IpcMainInvokeEvent, directory?: string) => {
        if (!resourceManagerService) {
            throw new Error('资源管理服务未初始化');
        }
        return await resourceManagerService.generateResourceSummary(directory);
    });

    // 按类别获取资源
    ipcMain.handle('resource:getByCategory', async (_event: IpcMainInvokeEvent, directory?: string) => {
        if (!resourceManagerService) {
            throw new Error('资源管理服务未初始化');
        }
        return await resourceManagerService.getResourcesByCategory(directory);
    });

    // 获取图片预览
    ipcMain.handle('resource:getPreview', async (_event: IpcMainInvokeEvent, imagePath: string, maxSize?: number) => {
        if (!resourceManagerService) {
            throw new Error('资源管理服务未初始化');
        }
        return await resourceManagerService.getImagePreview(imagePath, maxSize);
    });

    // 生成项目素材总览图：给 Agent 观察项目图片集合，不直接替 Agent 做业务判断
    ipcMain.handle('resource:createContactSheetOverview', async (_event: IpcMainInvokeEvent, options?: {
        projectPath?: string;
        images?: Array<{
            path: string;
            relativePath?: string;
            labelHint?: string;
            role?: string;
        }>;
        columns?: number;
        tileWidth?: number;
        tileHeight?: number;
        maxImages?: number;
    }) => {
        if (!resourceManagerService) {
            throw new Error('资源管理服务未初始化');
        }
        return await resourceManagerService.createProjectContactSheetOverview(options || {});
    });

    // 生成并理解项目素材总览图：给 Agent 做项目第一眼观察，再由 Agent 决定后续单图复核
    ipcMain.handle('resource:analyzeContactSheetOverview', async (_event: IpcMainInvokeEvent, options?: {
        projectPath?: string;
        images?: Array<{
            path: string;
            relativePath?: string;
            labelHint?: string;
            role?: string;
        }>;
        columns?: number;
        tileWidth?: number;
        tileHeight?: number;
        maxImages?: number;
        focus?: string;
        userIntent?: string;
    }) => {
        if (!resourceManagerService || !modelService) {
            throw new Error('服务未初始化');
        }

        const visionModelCall = buildVisionModelCall(modelService!, taskOrchestrator);
        return await resourceManagerService.analyzeProjectContactSheetOverview(options || {}, visionModelCall);
    });

    // 读取图片为 Base64
    ipcMain.handle('resource:readImageBase64', async (_event: IpcMainInvokeEvent, imagePath: string) => {
        if (!resourceManagerService) {
            throw new Error('资源管理服务未初始化');
        }
        return await resourceManagerService.readImageAsBase64(imagePath);
    });

    // 只读图片文件探针：返回尺寸/大小/hash，不返回 base64 或原始图片内容
    ipcMain.handle('resource:probeImageFile', async (_event: IpcMainInvokeEvent, imagePath: string) => {
        if (!resourceManagerService) {
            throw new Error('资源管理服务未初始化');
        }
        return await resourceManagerService.probeImageFile(imagePath);
    });

    // 只读图片像素探针：比较参考图与结果图，不返回 base64 或原始图片内容
    ipcMain.handle('resource:compareImageFiles', async (_event: IpcMainInvokeEvent, referencePath: string, resultPath: string, options?: any) => {
        if (!resourceManagerService) {
            throw new Error('资源管理服务未初始化');
        }
        return await resourceManagerService.compareImageFiles(referencePath, resultPath, options);
    });

    // 分析素材内容（复用唯一 Agent 模型）
    ipcMain.handle('resource:analyzeAsset', async (_event: IpcMainInvokeEvent, imagePath: string) => {
        if (!resourceManagerService || !modelService) {
            throw new Error('服务未初始化');
        }
        
        const visionModelCall = buildVisionModelCall(modelService!, taskOrchestrator);
        
        return await resourceManagerService.analyzeAssetContent(imagePath, visionModelCall);
    });

    // 测量参考图构图（本地主体检测+纯逻辑换算，0 token，只读不落盘）
    ipcMain.handle('resource:measureComposition', async (_event: IpcMainInvokeEvent, imagePath: string) => {
        if (!resourceManagerService) {
            throw new Error('资源管理服务未初始化');
        }
        return await resourceManagerService.measureReferenceComposition(imagePath);
    });

    // 素材主体框（素材属性，一张图只算一次）：alpha → 纯色底裁边 → 本地分割模型 → 整图外框；不依赖 Photoshop 选择主体
    ipcMain.handle('resource:getAssetSubjectBox', async (_event: IpcMainInvokeEvent, filePath: string) => {
        const { getAssetSubjectBoxService } = await import('../services/asset-subject-box-service');
        return await getAssetSubjectBoxService().resolveForFile(String(filePath || ''));
    });

    // 对 Photoshop 图层像素跑同一条主体框链（插件导出图层像素 → 主进程本地计算 → 相对框 + 文档坐标）
    ipcMain.handle('resource:detectLayerSubjectBox', async (_event: IpcMainInvokeEvent, request: { layerId?: number; maxSize?: number }) => {
        const wsServer = context.wsServer;
        if (!wsServer || !wsServer.isPluginConnected()) {
            return { success: false, error: '图层主体框检测失败：Photoshop 插件未连接。' };
        }
        const layerId = Number(request?.layerId);
        if (!Number.isFinite(layerId) || layerId <= 0) {
            return { success: false, error: '图层主体框检测失败：缺少有效 layerId。' };
        }
        const { getAssetSubjectBoxService } = await import('../services/asset-subject-box-service');
        const { createBinaryImageData } = await import('../../shared/binary-protocol');
        const exportResult = await wsServer.sendRequest('removeBackground', {
            mode: 'ai',
            layerId,
            maxSize: Math.max(256, Math.min(1280, Number(request?.maxSize) || 1024)),
            sampleAllLayers: false
        }, 60000);
        if (!exportResult?.success) {
            return { success: false, error: `图层主体框检测失败：导出图层像素失败（${exportResult?.error || exportResult?.message || '未知原因'}）。` };
        }
        const frame = {
            left: Number(exportResult.originalLeft),
            top: Number(exportResult.originalTop),
            width: Number(exportResult.originalWidth),
            height: Number(exportResult.originalHeight)
        };
        const service = getAssetSubjectBoxService();
        let outcome;
        if (typeof exportResult.imageData === 'string' && exportResult.imageData.length >= 100) {
            outcome = await service.resolveFromEncodedImage(exportResult.imageData);
        } else if (exportResult.useBinaryTransfer && exportResult.binaryRequestId) {
            const binary = await wsServer.waitForBinaryData(Number(exportResult.binaryRequestId), 10000);
            if (!binary) {
                return { success: false, error: '图层主体框检测失败：等待图层像素二进制数据超时。' };
            }
            const image = createBinaryImageData(binary.header.type, binary.imageData, binary.header.width, binary.header.height);
            if (image.format === 'raw_rgba' || image.format === 'raw_rgb') {
                outcome = await service.resolveFromRawPixels({
                    data: new Uint8Array(image.buffer.buffer, image.buffer.byteOffset, image.buffer.byteLength),
                    width: image.width,
                    height: image.height,
                    channels: image.format === 'raw_rgba' ? 4 : 3
                });
            } else {
                outcome = await service.resolveFromEncodedImage(image.buffer);
            }
        } else {
            return { success: false, error: '图层主体框检测失败：插件没有返回图层像素。' };
        }
        if (!outcome.success || !outcome.resolution) {
            return { success: false, error: outcome.error || '图层主体框检测失败：未得到主体框。', attempts: outcome.attempts };
        }
        const box = outcome.resolution.box;
        const hasFrame = Number.isFinite(frame.left) && Number.isFinite(frame.top) && frame.width > 0 && frame.height > 0;
        return {
            success: true,
            layerId,
            resolution: outcome.resolution,
            attempts: outcome.attempts,
            ...(hasFrame ? {
                frame: { left: frame.left, top: frame.top, right: frame.left + frame.width, bottom: frame.top + frame.height },
                bounds: {
                    left: Math.round(frame.left + box.x * frame.width),
                    top: Math.round(frame.top + box.y * frame.height),
                    right: Math.round(frame.left + (box.x + box.width) * frame.width),
                    bottom: Math.round(frame.top + (box.y + box.height) * frame.height)
                }
            } : {})
        };
    });

    // 分析设计参考图为什么有效（复用唯一 Agent 模型，只生成待复核经验观察）
    ipcMain.handle('resource:analyzeDesignReference', async (_event: IpcMainInvokeEvent, request: {
        imagePath?: string;
        referenceTitle?: string;
        referenceTags?: string[];
        referenceSource?: string;
        topics?: string[];
        cadence?: string;
    }) => {
        if (!resourceManagerService || !modelService) {
            throw new Error('服务未初始化');
        }

        const visionModelCall = buildVisionModelCall(modelService!, taskOrchestrator);

        return await resourceManagerService.analyzeDesignReference({
            imagePath: request?.imagePath || '',
            referenceTitle: request?.referenceTitle,
            referenceTags: request?.referenceTags,
            referenceSource: request?.referenceSource,
            topics: request?.topics,
            cadence: request?.cadence
        }, visionModelCall);
    });

    // 智能推荐素材
    ipcMain.handle('resource:recommendAssets', async (_event: IpcMainInvokeEvent, params: {
        requirement: string;
        maxResults?: number;
        category?: string;
        deterministic?: boolean;
        designRole?: string;
        placementIntent?: string;
        candidateFiles?: Array<Record<string, unknown>>;
        visualConsumptionOwner?: 'calling_agent';
    }) => {
        if (!resourceManagerService || !modelService) {
            throw new Error('服务未初始化');
        }
        
        const visionModelCall = buildVisionModelCall(modelService!, taskOrchestrator);
        
        return await resourceManagerService.recommendAssets(
            params.requirement,
            visionModelCall,
            {
                maxResults: params.maxResults,
                category: params.category,
                deterministic: params.deterministic,
                designRole: params.designRole,
                placementIntent: params.placementIntent,
                candidateFiles: params.candidateFiles as any,
                ...(params.visualConsumptionOwner === 'calling_agent'
                    ? { visualConsumptionOwner: 'calling_agent' as const }
                    : {})
            }
        );
    });

    // 获取素材详情
    ipcMain.handle('resource:getAssetDetails', async (_event: IpcMainInvokeEvent, imagePath: string) => {
        if (!resourceManagerService) {
            throw new Error('资源管理服务未初始化');
        }
        return await resourceManagerService.getAssetDetails(imagePath);
    });
}
