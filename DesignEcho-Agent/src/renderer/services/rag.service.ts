/**
 * RAG 服务客户端
 * 
 * 渲染进程通过 IPC 调用主进程 RAG 服务
 */

import type {
    KnowledgeEntry,
    RAGSearchResult,
    ScoredKnowledgeEntry,
    SearchFilters,
    DesignerProfile,
    StylePreferences,
    WorkflowPreferences,
    UIPreferences,
    RetrievalPreferences
} from '../../main/services/rag/types';

interface IPCResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
}

const ipc = {
    invoke: (channel: string, ...args: any[]): Promise<IPCResponse> => {
        const api = (window as { designEcho?: { invoke: (ch: string, ...a: any[]) => Promise<IPCResponse> } }).designEcho;
        return api?.invoke(channel, ...args) ?? Promise.resolve({ success: false, error: 'designEcho not available' });
    }
};

// ==================== RAG 服务 ====================

/**
 * 初始化 RAG 服务
 */
export async function initializeRAG(): Promise<boolean> {
    const result: IPCResponse = await ipc.invoke('rag:initialize');
    if (!result.success) {
        console.error('[RAGService] 初始化失败:', result.error);
    }
    return result.success;
}

/**
 * 列出样本记录（用于检索验证）
 */
export async function listRAGSample(limit?: number): Promise<Array<{ id: string; title: string; textSnippet: string; type: string }> | null> {
    const result: IPCResponse = await ipc.invoke('rag:listSample', { limit });
    return result.success ? result.data : null;
}

/**
 * 获取 RAG 服务状态
 */
export async function getRAGStatus(): Promise<{
    initialized: boolean;
    embeddingReady: boolean;
    vectorStoreReady: boolean;
    indexedCount: number;
    lastIndexTime: string | null;
} | null> {
    const result: IPCResponse = await ipc.invoke('rag:getStatus');
    return result.success ? result.data : null;
}

/**
 * 索引知识库数据
 */
export async function indexKnowledge(data: {
    sellingPoints: any[];
    painPoints: any[];
    colorSchemes: any[];
    copyTemplates: any[];
}): Promise<{
    success: boolean;
    totalIndexed: number;
    byType: Record<string, number>;
    errors: Array<{ id: string; error: string }>;
    durationMs: number;
} | null> {
    const result: IPCResponse = await ipc.invoke('rag:indexKnowledge', { data });
    return result.success ? result.data : null;
}

/**
 * 重建知识库索引
 */
export async function rebuildIndex(data: {
    sellingPoints: any[];
    painPoints: any[];
    colorSchemes: any[];
    copyTemplates: any[];
}): Promise<{
    success: boolean;
    totalIndexed: number;
    byType: Record<string, number>;
    errors: Array<{ id: string; error: string }>;
    durationMs: number;
} | null> {
    const result: IPCResponse = await ipc.invoke('rag:rebuildIndex', { data });
    return result.success ? result.data : null;
}

/**
 * 批量摄入项目 PSD/PSB 设计知识
 */
export async function ingestProjectDesigns(params: {
    projectPath: string;
    projectId?: string;
    options?: {
        author?: string;
        categories?: string[];
        source?: 'system' | 'user' | 'learned' | 'import' | 'uxp';
        includeComponents?: boolean;
        maxComponents?: number;
    };
}): Promise<{
    projectId: string;
    totalFiles: number;
    indexed: number;
    failed: number;
    errors: Array<{ filePath: string; error: string }>;
} | null> {
    const result: IPCResponse = await ipc.invoke('rag:ingestProjectDesigns', params);
    return result.success ? result.data : null;
}

/**
 * 搜索知识库
 */
export async function searchKnowledge(
    query: string,
    options?: {
        limit?: number;
        filters?: SearchFilters;
        designerId?: string;
        usePersonalization?: boolean;
    }
): Promise<RAGSearchResult | null> {
    const result: IPCResponse = await ipc.invoke('rag:search', { query, ...options });
    const payload = result.data ?? (result as any).results;
    return result.success ? payload : null;
}

/**
 * 多模态高级搜索（文本 + 可选视觉/布局向量）
 */
export async function searchKnowledgeAdvanced(
    query: string,
    options?: {
        limit?: number;
        filters?: SearchFilters;
        designerId?: string;
        usePersonalization?: boolean;
        visualEmbedding?: number[];
        layoutEmbedding?: number[];
    }
): Promise<RAGSearchResult | null> {
    const result: IPCResponse = await ipc.invoke('rag:searchAdvanced', { query, ...options });
    const payload = result.data ?? (result as any).results;
    return result.success ? payload : null;
}

/**
 * 快速搜索知识库
 */
export async function quickSearch(
    query: string,
    limit?: number
): Promise<ScoredKnowledgeEntry[] | null> {
    const result: IPCResponse = await ipc.invoke('rag:quickSearch', { query, limit });
    return result.success ? result.data : null;
}

/**
 * 记录知识点击
 */
export async function recordKnowledgeClick(
    designerId: string,
    knowledgeId: string
): Promise<boolean> {
    const result: IPCResponse = await ipc.invoke('rag:recordClick', { designerId, knowledgeId });
    return result.success;
}

/**
 * 记录知识应用
 */
export async function recordKnowledgeApply(
    designerId: string,
    knowledgeId: string
): Promise<boolean> {
    const result: IPCResponse = await ipc.invoke('rag:recordApply', { designerId, knowledgeId });
    return result.success;
}

// ==================== 设计师档案 ====================

/**
 * 获取设计师档案
 */
export async function getDesignerProfile(
    designerId: string
): Promise<DesignerProfile | null> {
    const result: IPCResponse = await ipc.invoke('designer:getProfile', { designerId });
    return result.success ? result.data : null;
}

/**
 * 获取或创建设计师档案
 */
export async function getOrCreateDesignerProfile(
    designerId: string,
    name?: string
): Promise<DesignerProfile | null> {
    const result: IPCResponse = await ipc.invoke('designer:getOrCreateProfile', { designerId, name });
    return result.success ? result.data : null;
}

/**
 * 获取所有设计师档案
 */
export async function getAllDesignerProfiles(): Promise<DesignerProfile[]> {
    const result: IPCResponse = await ipc.invoke('designer:getAllProfiles');
    return result.success ? result.data : [];
}

/**
 * 更新设计师档案
 */
export async function updateDesignerProfile(
    designerId: string,
    updates: Partial<DesignerProfile>
): Promise<DesignerProfile | null> {
    const result: IPCResponse = await ipc.invoke('designer:updateProfile', { designerId, updates });
    return result.success ? result.data : null;
}

/**
 * 更新风格偏好
 */
export async function updateStylePreferences(
    designerId: string,
    updates: Partial<StylePreferences>
): Promise<boolean> {
    const result: IPCResponse = await ipc.invoke('designer:updateStylePreferences', { designerId, updates });
    return result.success;
}

/**
 * 更新工作流偏好
 */
export async function updateWorkflowPreferences(
    designerId: string,
    updates: Partial<WorkflowPreferences>
): Promise<boolean> {
    const result: IPCResponse = await ipc.invoke('designer:updateWorkflowPreferences', { designerId, updates });
    return result.success;
}

/**
 * 更新 UI 偏好
 */
export async function updateUIPreferences(
    designerId: string,
    updates: Partial<UIPreferences>
): Promise<boolean> {
    const result: IPCResponse = await ipc.invoke('designer:updateUIPreferences', { designerId, updates });
    return result.success;
}

/**
 * 更新检索偏好
 */
export async function updateRetrievalPreferences(
    designerId: string,
    updates: Partial<RetrievalPreferences>
): Promise<boolean> {
    const result: IPCResponse = await ipc.invoke('designer:updateRetrievalPreferences', { designerId, updates });
    return result.success;
}

/**
 * 添加收藏配色
 */
export async function addFavoriteColorScheme(
    designerId: string,
    schemeId: string
): Promise<boolean> {
    const result: IPCResponse = await ipc.invoke('designer:addFavoriteColorScheme', { designerId, schemeId });
    return result.success;
}

/**
 * 移除收藏配色
 */
export async function removeFavoriteColorScheme(
    designerId: string,
    schemeId: string
): Promise<boolean> {
    const result: IPCResponse = await ipc.invoke('designer:removeFavoriteColorScheme', { designerId, schemeId });
    return result.success;
}

/**
 * 设置当前设计师
 */
export async function setCurrentDesigner(
    designerId: string
): Promise<boolean> {
    const result: IPCResponse = await ipc.invoke('designer:setCurrentDesigner', { designerId });
    return result.success;
}

/**
 * 获取当前设计师
 */
export async function getCurrentDesigner(): Promise<DesignerProfile | null> {
    const result: IPCResponse = await ipc.invoke('designer:getCurrentDesigner');
    return result.success ? result.data : null;
}

/**
 * 删除设计师档案
 */
export async function deleteDesignerProfile(
    designerId: string
): Promise<boolean> {
    const result: IPCResponse = await ipc.invoke('designer:deleteProfile', { designerId });
    return result.success;
}

/**
 * 导出设计师档案
 */
export async function exportDesignerProfile(
    designerId: string
): Promise<string | null> {
    const result: IPCResponse = await ipc.invoke('designer:exportProfile', { designerId });
    return result.success ? result.data : null;
}

/**
 * 导入设计师档案
 */
export async function importDesignerProfile(
    jsonData: string
): Promise<DesignerProfile | null> {
    const result: IPCResponse = await ipc.invoke('designer:importProfile', { jsonData });
    return result.success ? result.data : null;
}

/**
 * 获取设计师统计
 */
export async function getDesignerStats(): Promise<{
    totalProfiles: number;
    activeProfiles: number;
    avgSessionDuration: number;
} | null> {
    const result: IPCResponse = await ipc.invoke('designer:getStats');
    return result.success ? result.data : null;
}

// 导出类型
export type {
    KnowledgeEntry,
    RAGSearchResult,
    ScoredKnowledgeEntry,
    SearchFilters,
    DesignerProfile,
    StylePreferences,
    WorkflowPreferences,
    UIPreferences,
    RetrievalPreferences
};
