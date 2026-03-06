/**
 * SKU 知识库 IPC 处理程序
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { getSKUKnowledgeService } from '../services/sku-knowledge-service';
import type { ComboSize, SockType } from '../../shared/types/sku-combo.types';

export function registerSKUKnowledgeHandlers(): void {
    const service = getSKUKnowledgeService();
    
    // 初始化服务
    service.initialize().catch(err => {
        console.error('[SKUKnowledge] 初始化失败:', err);
    });
    
    // 获取所有知识库
    ipcMain.handle('sku-knowledge:getAll', async () => {
        return service.getAll();
    });
    
    // 根据 ID 获取
    ipcMain.handle('sku-knowledge:getById', async (_event: IpcMainInvokeEvent, id: string) => {
        return service.getById(id);
    });
    
    // 根据项目路径获取
    ipcMain.handle('sku-knowledge:getByProject', async (_event: IpcMainInvokeEvent, projectPath: string) => {
        return service.getByProjectPath(projectPath);
    });
    
    // 创建知识库
    ipcMain.handle('sku-knowledge:create', async (_event: IpcMainInvokeEvent, name: string, projectPath?: string) => {
        return service.create(name, projectPath);
    });
    
    // 删除知识库
    ipcMain.handle('sku-knowledge:delete', async (_event: IpcMainInvokeEvent, id: string) => {
        return service.delete(id);
    });
    
    // 添加可用颜色
    ipcMain.handle('sku-knowledge:addColors', async (_event: IpcMainInvokeEvent, kbId: string, colors: string[]) => {
        return service.addAvailableColors(kbId, colors);
    });
    
    // 添加模板
    ipcMain.handle('sku-knowledge:addTemplate', async (
        _event: IpcMainInvokeEvent, 
        kbId: string, 
        config: {
            name: string;
            templateFile: string;
            comboSize: ComboSize;
            sockType: SockType;
            description?: string;
        }
    ) => {
        return service.addTemplate(kbId, config);
    });
    
    // 删除模板
    ipcMain.handle('sku-knowledge:deleteTemplate', async (
        _event: IpcMainInvokeEvent, 
        kbId: string, 
        templateId: string
    ) => {
        return service.deleteTemplate(kbId, templateId);
    });
    
    // 添加颜色组合
    ipcMain.handle('sku-knowledge:addCombo', async (
        _event: IpcMainInvokeEvent, 
        kbId: string, 
        templateId: string, 
        colors: string[], 
        remark?: string
    ) => {
        return service.addCombo(kbId, templateId, colors, remark);
    });
    
    // 删除颜色组合
    ipcMain.handle('sku-knowledge:deleteCombo', async (
        _event: IpcMainInvokeEvent, 
        kbId: string, 
        templateId: string, 
        comboId: string
    ) => {
        return service.deleteCombo(kbId, templateId, comboId);
    });
    
    // CSV 导入
    ipcMain.handle('sku-knowledge:importCSV', async (
        _event: IpcMainInvokeEvent, 
        kbId: string, 
        csvContent: string
    ) => {
        return service.importFromCSV(kbId, csvContent);
    });
    
    // CSV 导出
    ipcMain.handle('sku-knowledge:exportCSV', async (_event: IpcMainInvokeEvent, kbId: string) => {
        return service.exportToCSV(kbId);
    });
    
    // 获取指定规格的组合
    ipcMain.handle('sku-knowledge:getCombosBySize', async (
        _event: IpcMainInvokeEvent, 
        kbId: string, 
        comboSize: ComboSize
    ) => {
        return service.getCombosBySize(kbId, comboSize);
    });
    
    // 根据筛选条件获取模板
    ipcMain.handle('sku-knowledge:getTemplatesByFilter', async (
        _event: IpcMainInvokeEvent, 
        kbId: string, 
        filter: { sockType?: SockType; comboSize?: ComboSize }
    ) => {
        return service.getTemplatesByFilter(kbId, filter);
    });
    
    console.log('[IPC] SKU 知识库处理程序已注册');
}
