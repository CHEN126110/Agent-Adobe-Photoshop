/**
 * 文案优化相关 UXP Handlers
 */

import type { UXPContext } from './types';

/**
 * 注册文案优化相关 handlers
 */
export function registerTextHandlers(context: UXPContext): void {
    const { wsServer, taskOrchestrator, logService } = context;

    // 文案优化请求
    wsServer.registerHandler('optimize-text', async (params: { text?: string }) => {
        logService?.logAgent('info', '[UXP Handler] 收到文案优化请求');
        
        try {
            let textContent = params.text;
            
            if (!textContent && wsServer.isPluginConnected()) {
                const textResult = await wsServer.sendRequest('getTextContent', {});
                textContent = textResult?.text || textResult?.content;
            }
            
            if (!textContent) {
                return {
                    success: false,
                    error: '未找到文本内容。请在 Photoshop 中选中一个文本图层。'
                };
            }

            const result = await taskOrchestrator!.execute('text-optimize', {
                text: textContent,
                context: '设计文案'
            });

            return {
                success: true,
                data: result
            };
        } catch (error: any) {
            logService?.logAgent('error', `[UXP Handler] 文案优化失败: ${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
    });
}
