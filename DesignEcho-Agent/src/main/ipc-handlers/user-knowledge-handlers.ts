/**
 * 用户知识 IPC 处理器
 */

import { ipcMain, dialog } from 'electron';
import { userKnowledgeService } from '../services/user-knowledge-service';
import type { IPCContext } from './types';
import type { UserSellingPoint, UserCopyTemplate, UserColorScheme } from '../../shared/knowledge/user-knowledge';

export function registerUserKnowledgeHandlers(_context: IPCContext): void {
    console.log('[IPC] 注册用户知识处理器');

    // ===== 获取知识库 =====

    // 获取全局知识
    ipcMain.handle('userKnowledge:getGlobal', async () => {
        return userKnowledgeService.getGlobalKnowledge();
    });

    // 获取项目知识
    ipcMain.handle('userKnowledge:getProject', async (_, projectPath: string) => {
        return userKnowledgeService.getProjectKnowledge(projectPath);
    });

    // 获取统计
    ipcMain.handle('userKnowledge:getStats', async (_, projectPath?: string) => {
        return userKnowledgeService.getStats(projectPath);
    });

    // ===== 卖点管理 =====

    // 添加卖点
    ipcMain.handle('userKnowledge:addSellingPoint', async (_, point: Omit<UserSellingPoint, 'id' | 'createdAt' | 'updatedAt'>, scope?: 'global' | { project: string }) => {
        return userKnowledgeService.addSellingPoint(point, scope || 'global');
    });

    // 更新卖点
    ipcMain.handle('userKnowledge:updateSellingPoint', async (_, id: string, updates: Partial<UserSellingPoint>, scope?: 'global' | { project: string }) => {
        return userKnowledgeService.updateSellingPoint(id, updates, scope || 'global');
    });

    // 删除卖点
    ipcMain.handle('userKnowledge:deleteSellingPoint', async (_, id: string, scope?: 'global' | { project: string }) => {
        return userKnowledgeService.deleteSellingPoint(id, scope || 'global');
    });

    // 搜索卖点
    ipcMain.handle('userKnowledge:searchSellingPoints', async (_, keyword: string, projectPath?: string) => {
        return userKnowledgeService.searchSellingPoints(keyword, projectPath);
    });

    // ===== 文案模板管理 =====

    // 添加文案模板
    ipcMain.handle('userKnowledge:addCopyTemplate', async (_, template: Omit<UserCopyTemplate, 'id' | 'createdAt' | 'updatedAt'>, scope?: 'global' | { project: string }) => {
        return userKnowledgeService.addCopyTemplate(template, scope || 'global');
    });

    // 按类型获取文案模板
    ipcMain.handle('userKnowledge:getCopyTemplatesByType', async (_, type: UserCopyTemplate['type'], projectPath?: string) => {
        return userKnowledgeService.getCopyTemplatesByType(type, projectPath);
    });

    // 应用文案模板
    ipcMain.handle('userKnowledge:applyCopyTemplate', async (_, templateId: string, variables: Record<string, string>, projectPath?: string) => {
        return userKnowledgeService.applyCopyTemplate(templateId, variables, projectPath);
    });

    // ===== 配色方案管理 =====

    // 添加配色方案
    ipcMain.handle('userKnowledge:addColorScheme', async (_, scheme: Omit<UserColorScheme, 'id' | 'createdAt' | 'updatedAt'>, scope?: 'global' | { project: string }) => {
        return userKnowledgeService.addColorScheme(scheme, scope || 'global');
    });

    // 获取所有配色方案
    ipcMain.handle('userKnowledge:getAllColorSchemes', async (_, projectPath?: string) => {
        return userKnowledgeService.getAllColorSchemes(projectPath);
    });

    // ===== 导入导出 =====

    // 从 JSON 导入
    ipcMain.handle('userKnowledge:importJSON', async (_, filePath: string, scope?: 'global' | { project: string }) => {
        return userKnowledgeService.importFromJSONFile(filePath, scope || 'global');
    });

    // 从 CSV 导入卖点
    ipcMain.handle('userKnowledge:importCSV', async (_, filePath: string, scope?: 'global' | { project: string }) => {
        return userKnowledgeService.importSellingPointsFromCSVFile(filePath, scope || 'global');
    });

    // 导出到文件
    ipcMain.handle('userKnowledge:export', async (_, filePath: string, scope?: 'global' | { project: string }) => {
        return userKnowledgeService.exportToFile(filePath, scope || 'global');
    });

    // 选择导入文件
    ipcMain.handle('userKnowledge:selectImportFile', async (_, type: 'json' | 'csv') => {
        const filters = type === 'json' 
            ? [{ name: 'JSON 文件', extensions: ['json'] }]
            : [{ name: 'CSV 文件', extensions: ['csv'] }];
        
        const result = await dialog.showOpenDialog({
            title: '选择导入文件',
            filters,
            properties: ['openFile']
        });
        
        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }
        
        return result.filePaths[0];
    });

    // 选择导出路径
    ipcMain.handle('userKnowledge:selectExportPath', async () => {
        const result = await dialog.showSaveDialog({
            title: '选择导出位置',
            defaultPath: 'user-knowledge.json',
            filters: [{ name: 'JSON 文件', extensions: ['json'] }]
        });
        
        if (result.canceled || !result.filePath) {
            return null;
        }
        
        return result.filePath;
    });

    // ===== 模板获取 =====

    // 获取 CSV 模板
    ipcMain.handle('userKnowledge:getCSVTemplates', async () => {
        return userKnowledgeService.getCSVTemplates();
    });

    // 获取 JSON 示例
    ipcMain.handle('userKnowledge:getJSONExample', async () => {
        return userKnowledgeService.getJSONExample();
    });

    console.log('[IPC] 用户知识处理器注册完成');
}
