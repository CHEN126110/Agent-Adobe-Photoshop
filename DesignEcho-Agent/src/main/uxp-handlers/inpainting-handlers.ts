/**
 * Inpainting UXP handlers.
 */

import type { UXPContext, SendProgressFn } from './types';

/**
 * Register inpainting handlers.
 */
export function registerInpaintingHandlers(context: UXPContext): void {
    const { wsServer, logService, inpaintingService } = context;

    const inpaintingGenerateHandler = async (params: {
        image: string;
        mask: string;
        prompt: string;
        negativePrompt?: string;
        mode?: 'cloud' | 'local';
        provider?: 'openai' | 'stability' | 'lama';
        strength?: number;
    }) => {
        logService?.logAgent(
            'info',
            `[Inpainting] Start request, mode=${params.mode || 'cloud'}, provider=${params.provider || 'openai'}`
        );

        const sendProgress: SendProgressFn = (progress, message) => {
            wsServer.sendProgress('inpaint', progress, message);
            logService?.logAgent('info', `[Inpainting] ${progress}% - ${message}`);
        };

        try {
            if (!inpaintingService) {
                throw new Error('Inpainting service is not initialized');
            }

            sendProgress(10, 'Preprocessing image and mask');

            const store = require('electron-store');
            const configStore = new store();
            const savedConfig = configStore.get('designecho-config', {});

            inpaintingService.updateConfig({
                openaiApiKey: savedConfig.openaiApiKey,
                stabilityApiKey: savedConfig.stabilityApiKey
            });

            sendProgress(20, 'Calling inpainting model');

            const result = await inpaintingService.inpaint({
                image: params.image,
                mask: params.mask,
                prompt: params.prompt,
                negativePrompt: params.negativePrompt,
                mode: params.mode || 'cloud',
                provider: params.provider || 'openai',
                strength: params.strength
            });

            if (!result.success) {
                throw new Error(result.error || 'Inpainting failed');
            }

            sendProgress(100, 'Inpainting complete');
            logService?.logAgent('info', `[Inpainting] Success in ${result.processingTime}ms`);

            return {
                success: true,
                image: result.image,
                processingTime: result.processingTime,
                provider: result.provider
            };
        } catch (error: any) {
            logService?.logAgent('error', `[Inpainting] Failed: ${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
    };

    wsServer.registerHandler('inpainting.generate', inpaintingGenerateHandler);
}
