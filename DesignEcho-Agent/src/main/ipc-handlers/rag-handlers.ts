/**
 * RAG 知识库 IPC 处理程序
 * 
 * 连接渲染进程与 RAG 服务
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { getRAGService, RAGService, RawKnowledgeData, SearchFilters, PsdIngestOptions } from '../services/rag';
import { getDesignerProfileService, DesignerProfileService } from '../services/designer';
import { DesignerProfile, StylePreferences, WorkflowPreferences, UIPreferences, RetrievalPreferences } from '../services/rag/types';
import { getProjectIndexer } from '../services/project-indexer';

let ragService: RAGService | null = null;
let designerService: DesignerProfileService | null = null;

/**
 * 获取 RAG 服务实例
 */
function getRAG(): RAGService {
    if (!ragService) {
        ragService = getRAGService();
    }
    return ragService;
}

/**
 * 获取设计师服务实例
 */
function getDesigner(): DesignerProfileService {
    if (!designerService) {
        designerService = getDesignerProfileService();
    }
    return designerService;
}

/**
 * 注册所有 RAG IPC 处理程序
 */
export function registerRAGHandlers(): void {
    console.log('[RAGHandlers] 注册 RAG IPC 处理程序...');
    
    // ==================== RAG 服务 ====================
    
    /**
     * 初始化 RAG 服务
     */
    ipcMain.handle('rag:initialize', async () => {
        try {
            await getRAG().initialize();
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
    
    /**
     * 列出样本记录（用于检索验证）
     */
    ipcMain.handle('rag:listSample', async (
        _event: IpcMainInvokeEvent,
        params?: { limit?: number }
    ) => {
        try {
            const limit = params?.limit ?? 10;
            const samples = await getRAG().getVectorStore().listSample(limit);
            return { success: true, data: samples };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    }),

    /**
     * 获取 RAG 服务状态
     */
    ipcMain.handle('rag:getStatus', async () => {
        try {
            const status = await getRAG().getStatus();
            return { success: true, data: status };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
    
    /**
     * 索引知识库（支持进度推送至 rag:indexProgress）
     */
    ipcMain.handle('rag:indexKnowledge', async (
        event: IpcMainInvokeEvent,
        params: { data: RawKnowledgeData }
    ) => {
        try {
            const onProgress = (p: { phase: string; current: number; total: number; message: string }) => {
                event.sender.send('rag:indexProgress', p);
            };
            const result = await getRAG().indexKnowledge(params.data, onProgress);
            return { success: true, data: result };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
    
    /**
     * 重建知识库索引
     */
    ipcMain.handle('rag:rebuildIndex', async (
        _event: IpcMainInvokeEvent,
        params: { data: RawKnowledgeData }
    ) => {
        try {
            const result = await getRAG().rebuildIndex(params.data);
            return { success: true, data: result };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('rag:ingestPsdFile', async (
        _event: IpcMainInvokeEvent,
        params: { filePath: string; options?: PsdIngestOptions }
    ) => {
        try {
            const result = await getRAG().ingestPsdFile(params.filePath, params.options);
            return { success: true, data: result };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('rag:ingestProjectDesigns', async (
        event: IpcMainInvokeEvent,
        params: {
            projectPath: string;
            projectId?: string;
            options?: Omit<PsdIngestOptions, 'projectId'>;
        }
    ) => {
        try {
            const indexer = getProjectIndexer();
            const projectItems = await indexer.scanProject(params.projectPath);
            const psdItems = projectItems.filter(item => item.type === 'psd');
            const rag = getRAG();

            const projectId = params.projectId || (projectItems[0]?.projectId || 'default-project');
            let success = 0;
            let failed = 0;
            const errors: Array<{ filePath: string; error: string }> = [];

            for (let i = 0; i < psdItems.length; i++) {
                const item = psdItems[i];
                try {
                    const result = await rag.ingestPsdFile(item.filePath, {
                        ...params.options,
                        projectId,
                        source: params.options?.source || 'import',
                        categories: params.options?.categories || ['design', projectId, 'psd'],
                        includeComponents: params.options?.includeComponents ?? true,
                        maxComponents: params.options?.maxComponents ?? 150
                    });

                    if (result.ingested > 0) {
                        success += result.ingested;
                    } else {
                        failed++;
                        if (result.errors?.length) {
                            errors.push({ filePath: item.filePath, error: result.errors[0] });
                        }
                    }
                } catch (error) {
                    failed++;
                    errors.push({ filePath: item.filePath, error: error instanceof Error ? error.message : String(error) });
                }

                event.sender.send('rag:projectIngestProgress', {
                    projectId,
                    current: i + 1,
                    total: psdItems.length,
                    filePath: item.filePath
                });
            }

            return {
                success: true,
                data: {
                    projectId,
                    totalFiles: psdItems.length,
                    indexed: success,
                    failed,
                    errors
                }
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('rag:getGraph', async (
        _event: IpcMainInvokeEvent,
        params: { graphId: string }
    ) => {
        try {
            const graph = await getRAG().getGraph(params.graphId);
            return { success: true, data: graph };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
    
    /**
     * 搜索知识库
     */
    ipcMain.handle('rag:search', async (
        _event: IpcMainInvokeEvent,
        params: {
            query: string;
            limit?: number;
            filters?: SearchFilters;
            designerId?: string;
            usePersonalization?: boolean;
        }
    ) => {
        try {
            const result = await getRAG().search(params.query, {
                limit: params.limit,
                filters: params.filters,
                designerId: params.designerId,
                usePersonalization: params.usePersonalization
            });
            return { success: true, data: result };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('rag:searchAdvanced', async (
        _event: IpcMainInvokeEvent,
        params: {
            query: string;
            limit?: number;
            filters?: SearchFilters;
            designerId?: string;
            usePersonalization?: boolean;
            visualEmbedding?: number[];
            layoutEmbedding?: number[];
        }
    ) => {
        try {
            const visualEmbedding = params.visualEmbedding ? new Float32Array(params.visualEmbedding) : undefined;
            const layoutEmbedding = params.layoutEmbedding ? new Float32Array(params.layoutEmbedding) : undefined;
            const result = await getRAG().searchAdvanced(params.query, {
                limit: params.limit,
                filters: params.filters,
                designerId: params.designerId,
                usePersonalization: params.usePersonalization,
                visualEmbedding,
                layoutEmbedding
            });
            return { success: true, data: result };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
    
    /**
     * 快速搜索
     */
    ipcMain.handle('rag:quickSearch', async (
        _event: IpcMainInvokeEvent,
        params: { query: string; limit?: number }
    ) => {
        try {
            const results = await getRAG().quickSearch(params.query, params.limit);
            return { success: true, data: results };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
    
    /**
     * 记录知识点击
     */
    ipcMain.handle('rag:recordClick', async (
        _event: IpcMainInvokeEvent,
        params: { designerId: string; knowledgeId: string }
    ) => {
        try {
            getRAG().recordClick(params.designerId, params.knowledgeId);
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
    
    /**
     * 记录知识应用
     */
    ipcMain.handle('rag:recordApply', async (
        _event: IpcMainInvokeEvent,
        params: { designerId: string; knowledgeId: string }
    ) => {
        try {
            getRAG().recordApply(params.designerId, params.knowledgeId);
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
    
    // ==================== 设计师档案 ====================
    
    /**
     * 获取设计师档案
     */
    ipcMain.handle('designer:getProfile', async (
        _event: IpcMainInvokeEvent,
        params: { designerId: string }
    ) => {
        try {
            const profile = getDesigner().getProfile(params.designerId);
            return { success: true, data: profile };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
    
    /**
     * 获取或创建设计师档案
     */
    ipcMain.handle('designer:getOrCreateProfile', async (
        _event: IpcMainInvokeEvent,
        params: { designerId: string; name?: string }
    ) => {
        try {
            const profile = getDesigner().getOrCreateProfile(params.designerId, params.name);
            return { success: true, data: profile };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
    
    /**
     * 获取所有设计师档案
     */
    ipcMain.handle('designer:getAllProfiles', async () => {
        try {
            const profiles = getDesigner().getAllProfiles();
            return { success: true, data: profiles };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
    
    /**
     * 更新设计师档案
     */
    ipcMain.handle('designer:updateProfile', async (
        _event: IpcMainInvokeEvent,
        params: { designerId: string; updates: Partial<DesignerProfile> }
    ) => {
        try {
            const profile = getDesigner().updateProfile(params.designerId, params.updates);
            return { success: true, data: profile };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
    
    /**
     * 更新风格偏好
     */
    ipcMain.handle('designer:updateStylePreferences', async (
        _event: IpcMainInvokeEvent,
        params: { designerId: string; updates: Partial<StylePreferences> }
    ) => {
        try {
            const success = getDesigner().updateStylePreferences(params.designerId, params.updates);
            return { success };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
    
    /**
     * 更新工作流偏好
     */
    ipcMain.handle('designer:updateWorkflowPreferences', async (
        _event: IpcMainInvokeEvent,
        params: { designerId: string; updates: Partial<WorkflowPreferences> }
    ) => {
        try {
            const success = getDesigner().updateWorkflowPreferences(params.designerId, params.updates);
            return { success };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
    
    /**
     * 更新 UI 偏好
     */
    ipcMain.handle('designer:updateUIPreferences', async (
        _event: IpcMainInvokeEvent,
        params: { designerId: string; updates: Partial<UIPreferences> }
    ) => {
        try {
            const success = getDesigner().updateUIPreferences(params.designerId, params.updates);
            return { success };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
    
    /**
     * 更新检索偏好
     */
    ipcMain.handle('designer:updateRetrievalPreferences', async (
        _event: IpcMainInvokeEvent,
        params: { designerId: string; updates: Partial<RetrievalPreferences> }
    ) => {
        try {
            const success = getDesigner().updateRetrievalPreferences(params.designerId, params.updates);
            return { success };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
    
    /**
     * 添加收藏配色
     */
    ipcMain.handle('designer:addFavoriteColorScheme', async (
        _event: IpcMainInvokeEvent,
        params: { designerId: string; schemeId: string }
    ) => {
        try {
            const success = getDesigner().addFavoriteColorScheme(params.designerId, params.schemeId);
            return { success };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
    
    /**
     * 移除收藏配色
     */
    ipcMain.handle('designer:removeFavoriteColorScheme', async (
        _event: IpcMainInvokeEvent,
        params: { designerId: string; schemeId: string }
    ) => {
        try {
            const success = getDesigner().removeFavoriteColorScheme(params.designerId, params.schemeId);
            return { success };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
    
    /**
     * 设置当前设计师
     */
    ipcMain.handle('designer:setCurrentDesigner', async (
        _event: IpcMainInvokeEvent,
        params: { designerId: string }
    ) => {
        try {
            getDesigner().setCurrentDesigner(params.designerId);
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
    
    /**
     * 获取当前设计师
     */
    ipcMain.handle('designer:getCurrentDesigner', async () => {
        try {
            const profile = getDesigner().getCurrentDesigner();
            return { success: true, data: profile };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
    
    /**
     * 删除设计师档案
     */
    ipcMain.handle('designer:deleteProfile', async (
        _event: IpcMainInvokeEvent,
        params: { designerId: string }
    ) => {
        try {
            const success = getDesigner().deleteProfile(params.designerId);
            return { success };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
    
    /**
     * 导出设计师档案
     */
    ipcMain.handle('designer:exportProfile', async (
        _event: IpcMainInvokeEvent,
        params: { designerId: string }
    ) => {
        try {
            const data = getDesigner().exportProfile(params.designerId);
            return { success: true, data };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
    
    /**
     * 导入设计师档案
     */
    ipcMain.handle('designer:importProfile', async (
        _event: IpcMainInvokeEvent,
        params: { jsonData: string }
    ) => {
        try {
            const profile = getDesigner().importProfile(params.jsonData);
            return { success: !!profile, data: profile };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
    
    /**
     * 获取设计师统计
     */
    ipcMain.handle('designer:getStats', async () => {
        try {
            const stats = getDesigner().getStats();
            return { success: true, data: stats };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });
    
    console.log('[RAGHandlers] ✅ RAG IPC 处理程序注册完成');
}

export default registerRAGHandlers;
