/**
 * 项目索引 IPC 处理器
 */

import { ipcMain } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getProjectIndexer } from '../services/project-indexer';
import type { IPCContext } from './types';

function getMediaType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.webp') return 'image/webp';
    return 'image/jpeg';
}

function createVisionModelFn(modelService: NonNullable<IPCContext['modelService']>) {
    return async (imagePath: string, prompt: string): Promise<string> => {
        const imageBuffer = await fs.readFile(imagePath);
        const imageBase64 = imageBuffer.toString('base64');
        const imageDataUrl = `data:${getMediaType(imagePath)};base64,${imageBase64}`;

        const visionModels = ['gemini-3-flash', 'ollama-llava:13b', 'ollama-llava:7b'];
        for (const modelId of visionModels) {
            try {
                const response = await modelService.chat(
                    modelId,
                    [{
                        role: 'user',
                        content: [
                            { type: 'text', text: prompt },
                            { type: 'image_url', image_url: { url: imageDataUrl } }
                        ] as any
                    }]
                );
                if (response?.text?.trim()) return response.text.trim();
            } catch {
                // 非阻断，尝试下一个视觉模型
            }
        }

        throw new Error('没有可用的视觉模型');
    };
}

export function registerProjectIndexHandlers(context?: IPCContext) {
    const indexer = getProjectIndexer();
    
    /**
     * 扫描单个项目
     */
    ipcMain.handle('project:scan', async (_, projectPath: string) => {
        try {
            const items = await indexer.scanProject(projectPath);
            return { success: true, items };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
    
    /**
     * 扫描多个项目
     */
    ipcMain.handle('project:scanAll', async (_, basePath: string) => {
        try {
            const projectMap = await indexer.scanProjects(basePath);
            const projects = Object.fromEntries(projectMap);
            return { success: true, projects };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
    
    /**
     * 索引单个项目
     */
    ipcMain.handle('project:index', async (event, projectId: string, items: any[], _useVision: boolean = false) => {
        try {
            const visionModelFn = _useVision && context?.modelService
                ? createVisionModelFn(context.modelService)
                : undefined;
            const onProgress = (current: number, total: number, item: { relativePath?: string }) => {
                event.sender.send('project:indexProgress', {
                    projectId,
                    current,
                    total,
                    phase: 'file' as const,
                    fileName: item?.relativePath
                });
            };
            const result = await indexer.indexProject(projectId, items, visionModelFn, onProgress);
            return { success: true, stats: result };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
    
    /**
     * 批量索引多个项目
     */
    ipcMain.handle('project:indexAll', async (event, projectMap: Record<string, any[]>, _useVision: boolean = false) => {
        try {
            const map = new Map(Object.entries(projectMap));
            const visionModelFn = _useVision && context?.modelService
                ? createVisionModelFn(context.modelService)
                : undefined;
            const onProgress = (projectId: string, current: number, total: number) => {
                event.sender.send('project:indexProgress', {
                    projectId,
                    current,
                    total,
                    phase: 'project' as const
                });
            };
            const stats = await indexer.indexProjects(map, visionModelFn, onProgress);
            return { success: true, stats };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
    
    /**
     * 清空项目索引
     */
    ipcMain.handle('project:clearIndex', async (_, projectId: string) => {
        try {
            const deleted = await indexer.clearProjectIndex(projectId);
            return { success: true, deleted };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
}
