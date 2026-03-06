import { ipcMain } from 'electron';
import { userKnowledgeService } from '../services/user-knowledge-service';

export function registerKnowledgeManagementHandlers() {
    ipcMain.handle('knowledge:clearAll', async () => {
        try {
            console.log('[KnowledgeManagement] Clearing structured knowledge data...');
            userKnowledgeService.clearAll();
            console.log('[KnowledgeManagement] Structured knowledge data cleared');
            return { success: true };
        } catch (error: any) {
            console.error('[KnowledgeManagement] Clear failed:', error);
            return { success: false, error: error.message };
        }
    });
}
