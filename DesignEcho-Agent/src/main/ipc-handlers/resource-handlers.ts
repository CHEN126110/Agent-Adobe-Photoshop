/**
 * 资源管理相关 IPC Handlers
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import type { IPCContext } from './types';

/**
 * 注册资源管理相关 IPC handlers
 */
export function registerResourceHandlers(context: IPCContext): void {
    const { resourceManagerService, modelService } = context;

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

    // 读取图片为 Base64
    ipcMain.handle('resource:readImageBase64', async (_event: IpcMainInvokeEvent, imagePath: string) => {
        if (!resourceManagerService) {
            throw new Error('资源管理服务未初始化');
        }
        return await resourceManagerService.readImageAsBase64(imagePath);
    });

    // 分析素材内容（使用视觉模型）
    ipcMain.handle('resource:analyzeAsset', async (_event: IpcMainInvokeEvent, imagePath: string) => {
        if (!resourceManagerService || !modelService) {
            throw new Error('服务未初始化');
        }
        
        const visionModels = ['gemini-3-flash', 'ollama-llava:13b', 'ollama-llava:7b'];
        
        const visionModelCall = async (imageBase64: string, prompt: string): Promise<string> => {
            for (const modelId of visionModels) {
                try {
                    const response = await modelService!.chat(
                        modelId,
                        [{ role: 'user', content: [
                            { type: 'text', text: prompt },
                            { type: 'image_url', image_url: { url: imageBase64 } }
                        ] as any }]
                    );
                    return response.text || '';
                } catch (e) {
                    console.warn(`[ResourceManager] 模型 ${modelId} 调用失败，尝试下一个`);
                }
            }
            throw new Error('没有可用的视觉模型');
        };
        
        return await resourceManagerService.analyzeAssetContent(imagePath, visionModelCall);
    });

    // 智能推荐素材
    ipcMain.handle('resource:recommendAssets', async (_event: IpcMainInvokeEvent, params: {
        requirement: string;
        maxResults?: number;
        category?: string;
    }) => {
        if (!resourceManagerService || !modelService) {
            throw new Error('服务未初始化');
        }
        
        const visionModels = ['gemini-3-flash', 'ollama-llava:13b', 'ollama-llava:7b'];
        
        const visionModelCall = async (imageBase64: string, prompt: string): Promise<string> => {
            for (const modelId of visionModels) {
                try {
                    const response = await modelService!.chat(
                        modelId,
                        [{ role: 'user', content: [
                            { type: 'text', text: prompt },
                            { type: 'image_url', image_url: { url: imageBase64 } }
                        ] as any }]
                    );
                    return response.text || '';
                } catch (e) {
                    console.warn(`[ResourceManager] 模型 ${modelId} 调用失败，尝试下一个`);
                }
            }
            throw new Error('没有可用的视觉模型');
        };
        
        return await resourceManagerService.recommendAssets(
            params.requirement,
            visionModelCall,
            { maxResults: params.maxResults, category: params.category }
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
