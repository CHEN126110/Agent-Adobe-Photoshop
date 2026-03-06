import { ipcMain } from 'electron';
import { userKnowledgeService } from '../services/user-knowledge-service';
import { getVectorStore } from '../services/rag/vector-store';

export function registerKnowledgeManagementHandlers() {
    // 清空所有知识库数据
    ipcMain.handle('knowledge:clearAll', async () => {
        try {
            console.log('[KnowledgeManagement] 开始清空所有知识库数据...');
            
            // 1. 清空向量数据库
            const vectorStore = getVectorStore();
            await vectorStore.clear();
            
            // 2. 清空用户自定义知识
            userKnowledgeService.clearAll();
            
            console.log('[KnowledgeManagement] ✅ 清空完成');
            return { success: true };
        } catch (error: any) {
            console.error('[KnowledgeManagement] 清空失败:', error);
            return { success: false, error: error.message };
        }
    });
}
