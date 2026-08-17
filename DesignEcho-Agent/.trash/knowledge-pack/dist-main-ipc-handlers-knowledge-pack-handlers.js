"use strict";
/**
 * 知识库包 IPC 处理器
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerKnowledgePackHandlers = registerKnowledgePackHandlers;
const electron_1 = require("electron");
const knowledge_pack_service_1 = require("../services/knowledge-pack-service");
const knowledge_agent_bridge_1 = require("../services/knowledge-agent-bridge");
function registerKnowledgePackHandlers(_context) {
    // 选择知识库文件夹
    electron_1.ipcMain.handle('knowledgePack:selectFolder', async () => {
        const result = await electron_1.dialog.showOpenDialog({
            title: '选择知识库文件夹',
            properties: ['openDirectory'],
            buttonLabel: '选择此文件夹'
        });
        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }
        const folderPath = result.filePaths[0];
        // 验证文件夹
        const validation = knowledge_pack_service_1.knowledgePackService.validatePackFolder(folderPath);
        return {
            path: folderPath,
            valid: validation.valid,
            meta: validation.meta,
            error: validation.error
        };
    });
    // 验证知识库文件夹
    electron_1.ipcMain.handle('knowledgePack:validate', async (_event, folderPath) => {
        return knowledge_pack_service_1.knowledgePackService.validatePackFolder(folderPath);
    });
    // 安装知识库包
    electron_1.ipcMain.handle('knowledgePack:install', async (_event, folderPath) => {
        return await knowledge_pack_service_1.knowledgePackService.installPack(folderPath);
    });
    // 获取已安装的知识库包列表
    electron_1.ipcMain.handle('knowledgePack:getInstalled', async () => {
        return knowledge_pack_service_1.knowledgePackService.getInstalledPacks();
    });
    // 启用/禁用知识库包
    electron_1.ipcMain.handle('knowledgePack:toggle', async (_event, packId, enabled) => {
        return knowledge_pack_service_1.knowledgePackService.togglePack(packId, enabled);
    });
    // 卸载知识库包
    electron_1.ipcMain.handle('knowledgePack:uninstall', async (_event, packId) => {
        return knowledge_pack_service_1.knowledgePackService.uninstallPack(packId);
    });
    // 获取合并后的知识库
    electron_1.ipcMain.handle('knowledgePack:getMerged', async () => {
        return knowledge_pack_service_1.knowledgePackService.getMergedKnowledge();
    });
    // 读取知识库包内容（预览）
    electron_1.ipcMain.handle('knowledgePack:preview', async (_event, folderPath) => {
        return knowledge_pack_service_1.knowledgePackService.readPack(folderPath);
    });
    // 获取知识库包存储目录
    electron_1.ipcMain.handle('knowledgePack:getDirectory', async () => {
        return knowledge_pack_service_1.knowledgePackService.getPacksDirectory();
    });
    // ===== Agent 桥接接口 =====
    // 获取知识上下文（供 AI 使用）
    electron_1.ipcMain.handle('knowledge:getAgentContext', async (_event, designContext) => {
        return await knowledge_agent_bridge_1.knowledgeAgentBridge.getKnowledgeContext(designContext);
    });
    // 获取任务专用知识
    electron_1.ipcMain.handle('knowledge:getTaskKnowledge', async (_event, task, category) => {
        return await knowledge_agent_bridge_1.knowledgeAgentBridge.getTaskKnowledge(task, category);
    });
    // 搜索卖点（Agent 工具 - 使用 bridge 前缀避免冲突）
    electron_1.ipcMain.handle('knowledgeBridge:searchSellingPoints', async (_event, params) => {
        const tools = knowledge_agent_bridge_1.knowledgeAgentBridge.getKnowledgeTools();
        const searchTool = tools.find(t => t.name === 'searchSellingPoints');
        return searchTool?.handler(params);
    });
    // 获取痛点（Agent 工具）
    electron_1.ipcMain.handle('knowledgeBridge:getPainPoints', async (_event, params) => {
        const tools = knowledge_agent_bridge_1.knowledgeAgentBridge.getKnowledgeTools();
        const painTool = tools.find(t => t.name === 'getPainPoints');
        return painTool?.handler(params);
    });
    // 推荐配色（Agent 工具）
    electron_1.ipcMain.handle('knowledgeBridge:recommendColorScheme', async (_event, params) => {
        const tools = knowledge_agent_bridge_1.knowledgeAgentBridge.getKnowledgeTools();
        const colorTool = tools.find(t => t.name === 'recommendColorScheme');
        return colorTool?.handler(params);
    });
    // 生成文案建议（Agent 工具）
    electron_1.ipcMain.handle('knowledgeBridge:generateCopywriting', async (_event, params) => {
        const tools = knowledge_agent_bridge_1.knowledgeAgentBridge.getKnowledgeTools();
        const copyTool = tools.find(t => t.name === 'generateCopywriting');
        return copyTool?.handler(params);
    });
    console.log('[IPC] 知识库包处理器已注册');
}
//# sourceMappingURL=knowledge-pack-handlers.js.map
