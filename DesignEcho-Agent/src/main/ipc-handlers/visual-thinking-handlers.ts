
/**
 * 视觉思维服务 IPC Handlers
 * 
 * 暴露 VisualThinkingService 的能力给渲染进程
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { IPCContext } from './types';
import { VisualThinkingService } from '../services/visual-thinking-service';
import fs from 'fs';
import path from 'path';

let visualThinkingService: VisualThinkingService | null = null;

function resolveMediaTypeFromExtension(extension: string): 'image/jpeg' | 'image/png' | 'image/webp' {
    if (extension === '.png') return 'image/png';
    if (extension === '.webp') return 'image/webp';
    return 'image/jpeg';
}

export function registerVisualThinkingHandlers(context: IPCContext): void {
    const { modelService, taskOrchestrator } = context;

    if (modelService) {
        visualThinkingService = new VisualThinkingService(modelService);
        // 复用用户配置的唯一 Agent 模型（vision 键仅为主进程兼容形状）。
        visualThinkingService.setVisionModelId(taskOrchestrator?.getAgentModels?.()?.vision || '');
    }

    /**
     * 每次调用前同步最新 Agent 模型配置。
     * 修复：原来只在注册时读取一次，用户后续修改设置不会生效。
     */
    function syncVisionModelConfig(): void {
        const currentVisionModel = taskOrchestrator?.getAgentModels?.()?.vision || '';
        visualThinkingService?.setVisionModelId(currentVisionModel);
    }

    /**
     * 分析本地图片文件
     * 读取文件 -> 转Base64 -> 调用唯一 Agent 模型
     */
    ipcMain.handle('visual:analyzeLocalImage', async (_event: IpcMainInvokeEvent, filePath: string, hint?: string) => {
        if (!visualThinkingService) {
            return { success: false, error: 'VisualThinkingService not initialized (ModelService missing)' };
        }
        syncVisionModelConfig();

        try {
            // 1. 读取文件
            if (!fs.existsSync(filePath)) {
                return { success: false, error: `File not found: ${filePath}` };
            }

            const ext = path.extname(filePath).toLowerCase();
            const validExts = ['.jpg', '.jpeg', '.png', '.webp'];
            let base64: string;
            let mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
            if (validExts.includes(ext)) {
                base64 = (await fs.promises.readFile(filePath)).toString('base64');
                mediaType = resolveMediaTypeFromExtension(ext);
            } else {
                // 项目里的素材常是 tif / psd / bmp（真机 12 次里 6 次因此失败）：设计师说「看这张图」不该被格式拦住。
                // 走资源服务的预览缩图（它已经会读 psd / tif / 大图并缩到合适尺寸），再交给 Agent 模型。
                const preview = await context.resourceManagerService?.getImagePreview?.(filePath, 1024);
                if (!preview?.success || !preview.imageData) {
                    return { success: false, error: `这个格式（${ext || '未知'}）读不出预览：${preview?.error || '资源服务未返回图像'}；请另存为 JPG/PNG 或先在 Photoshop 里打开后用文档快照观察。` };
                }
                base64 = String(preview.imageData).replace(/^data:image\/[a-z]+;base64,/i, '');
                mediaType = 'image/jpeg';
            }

            // 2. 调用分析
            const analysis = await visualThinkingService.analyzeGenericImage(base64, hint, mediaType);

            return { success: true, data: analysis };
        } catch (error: any) {
            console.error('[VisualHandlers] Analysis failed:', error);
            return { success: false, error: error.message };
        }
    });

    /**
     * 分析 Base64 图片
     */
    ipcMain.handle('visual:analyzeBase64Image', async (
        _event: IpcMainInvokeEvent,
        base64: string,
        hint?: string,
        mediaType?: string
    ) => {
        if (!visualThinkingService) {
            return { success: false, error: 'VisualThinkingService not initialized' };
        }

        syncVisionModelConfig();

        try {
            const analysis = await visualThinkingService.analyzeGenericImage(base64, hint, mediaType);
            return { success: true, data: analysis };
        } catch (error: any) {
            const errorMessage = error?.message || String(error);
            console.error('[VisualHandlers] Base64 analysis failed:', errorMessage);
            return { success: false, error: errorMessage };
        }
    });

    // 设计评审器：用完整评审提示看一张图，返回模型原文（渲染进程 design-evaluator 解析为分数与批评）
    ipcMain.handle('visual:askAboutImage', async (
        _event: IpcMainInvokeEvent,
        params: {
            base64: string;
            prompt: string;
            mediaType?: string;
            maxTokens?: number;
            referenceBase64?: string;
            referenceMediaType?: string;
            thumbnailBase64?: string;
            thumbnailMediaType?: string;
        }
    ) => {
        if (!visualThinkingService) {
            return { success: false, error: 'VisualThinkingService not initialized' };
        }
        syncVisionModelConfig();
        try {
            const result = await visualThinkingService.askAboutImage(
                String(params?.base64 || ''),
                String(params?.prompt || ''),
                params?.mediaType,
                {
                    maxTokens: params?.maxTokens,
                    ...(params?.referenceBase64
                        ? { referenceImage: { base64: String(params.referenceBase64), mediaType: params.referenceMediaType } }
                        : {}),
                    ...(params?.thumbnailBase64
                        ? { thumbnailImage: { base64: String(params.thumbnailBase64), mediaType: params.thumbnailMediaType } }
                        : {})
                }
            );
            return { success: true, text: result.text, modelId: result.modelId };
        } catch (error: any) {
            const errorMessage = error?.message || String(error);
            console.error('[VisualHandlers] askAboutImage failed:', errorMessage);
            return { success: false, error: errorMessage };
        }
    });
}
