import { ipcMain } from 'electron';
import type { IPCContext } from './types';
import { knowledgeAgentBridge } from '../services/knowledge-agent-bridge';

export function registerKnowledgeBridgeHandlers(_context: IPCContext): void {
    ipcMain.handle('knowledge:getAgentContext', async (_event, designContext?: {
        category?: string;
        season?: string;
        targetAudience?: string;
        style?: string;
    }) => {
        return await knowledgeAgentBridge.getKnowledgeContext(designContext);
    });

    ipcMain.handle('knowledge:getTaskKnowledge', async (_event, task: 'mainImage' | 'detailPage' | 'sku', category?: string) => {
        return await knowledgeAgentBridge.getTaskKnowledge(task, category);
    });

    ipcMain.handle('knowledgeBridge:searchSellingPoints', async (_event, params: {
        keyword?: string;
        category?: string;
        limit?: number;
    }) => {
        const tools = knowledgeAgentBridge.getKnowledgeTools();
        const tool = tools.find(t => t.name === 'searchSellingPoints');
        return tool?.handler(params);
    });

    ipcMain.handle('knowledgeBridge:getPainPoints', async (_event, params: {
        category?: string;
        type?: string;
    }) => {
        const tools = knowledgeAgentBridge.getKnowledgeTools();
        const tool = tools.find(t => t.name === 'getPainPoints');
        return tool?.handler(params);
    });

    ipcMain.handle('knowledgeBridge:recommendColorScheme', async (_event, params: {
        emotion?: string;
        category?: string;
        season?: string;
    }) => {
        const tools = knowledgeAgentBridge.getKnowledgeTools();
        const tool = tools.find(t => t.name === 'recommendColorScheme');
        return tool?.handler(params);
    });

    ipcMain.handle('knowledgeBridge:generateCopywriting', async (_event, params: {
        type: string;
        category?: string;
        keywords?: string;
    }) => {
        const tools = knowledgeAgentBridge.getKnowledgeTools();
        const tool = tools.find(t => t.name === 'generateCopywriting');
        return tool?.handler(params);
    });
}

