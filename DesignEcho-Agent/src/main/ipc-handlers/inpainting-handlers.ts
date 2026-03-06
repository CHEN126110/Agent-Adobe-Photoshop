import { ipcMain } from 'electron';
import { InpaintingService } from '../services/inpainting-service';
import type { IPCContext } from './types';

let inpaintingService: InpaintingService | null = null;

export function registerInpaintingHandlers(context: IPCContext) {
    // 确保服务单例
    if (!inpaintingService) {
        inpaintingService = new InpaintingService();
    }

    // 更新配置（当 API Keys 变化时）
    ipcMain.handle('inpainting:updateConfig', async (_, config) => {
        inpaintingService?.updateConfig({
            openaiApiKey: config.openai,
            stabilityApiKey: config.stability
        });
        return { success: true };
    });

    // 执行局部重绘
    ipcMain.handle('inpainting:generate', async (_, params) => {
        try {
            console.log('[InpaintingHandler] 收到重绘请求:', { prompt: params.prompt, mode: params.mode });
            
            const result = await inpaintingService!.inpaint({
                image: params.image,       // 如果没有传 image，说明只传了 mask，需要前端处理
                mask: params.mask,
                prompt: params.prompt,
                mode: params.mode || 'cloud',
                provider: params.provider || 'openai'
            });

            return result;
        } catch (error: any) {
            console.error('[InpaintingHandler] 处理失败:', error);
            return { success: false, error: error.message };
        }
    });

    // 应用重绘结果（发送回 Photoshop）
    ipcMain.handle('inpainting:apply', async (_, params) => {
        // 这个 Handler 目前由前端直接通过 sendToPlugin 调用，这里仅保留作为兼容性占位
        return { success: true };
    });
}
