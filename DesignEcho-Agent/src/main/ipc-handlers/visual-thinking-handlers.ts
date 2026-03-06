
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

export function registerVisualThinkingHandlers(context: IPCContext): void {
    const { modelService } = context;

    if (modelService) {
        visualThinkingService = new VisualThinkingService(modelService);
    }

    /**
     * 分析本地图片文件
     * 读取文件 -> 转Base64 -> 调用视觉模型
     */
    ipcMain.handle('visual:analyzeLocalImage', async (_event: IpcMainInvokeEvent, filePath: string, hint?: string) => {
        if (!visualThinkingService) {
            return { success: false, error: 'VisualThinkingService not initialized (ModelService missing)' };
        }

        try {
            // 1. 读取文件
            if (!fs.existsSync(filePath)) {
                return { success: false, error: `File not found: ${filePath}` };
            }

            const buffer = await fs.promises.readFile(filePath);
            // 简单的类型检测，实际应更严谨
            const ext = path.extname(filePath).toLowerCase();
            const validExts = ['.jpg', '.jpeg', '.png', '.webp'];
            
            if (!validExts.includes(ext)) {
                return { success: false, error: 'Unsupported image format. Use JPG, PNG or WEBP.' };
            }

            const base64 = buffer.toString('base64');

            // 2. 调用分析
            const analysis = await visualThinkingService.analyzeGenericImage(base64, hint);

            return { success: true, data: analysis };
        } catch (error: any) {
            console.error('[VisualHandlers] Analysis failed:', error);
            return { success: false, error: error.message };
        }
    });

    /**
     * 分析 Base64 图片
     */
    ipcMain.handle('visual:analyzeBase64Image', async (_event: IpcMainInvokeEvent, base64: string, hint?: string) => {
        if (!visualThinkingService) {
            return { success: false, error: 'VisualThinkingService not initialized' };
        }

        try {
            const analysis = await visualThinkingService.analyzeGenericImage(base64, hint);
            return { success: true, data: analysis };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
}
