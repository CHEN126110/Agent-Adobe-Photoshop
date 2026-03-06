/**
 * 模板系统 IPC 处理器
 */

import { ipcMain, dialog } from 'electron';
import { templateService } from '../services/template-service';
import { templateParserService } from '../services/template-parser-service';
import type { IPCContext } from './types';
import type { TemplateType, TemplateBindings, RenderContext } from '../../shared/types/template';

export function registerTemplateHandlers(_context: IPCContext): void {
    console.log('[IPC] 注册模板系统处理器');

    // ===== 模板包管理 =====

    // 获取模板目录
    ipcMain.handle('template:getDirectory', async () => {
        return templateService.getTemplatesDirectory();
    });

    // 获取已安装的模板包
    ipcMain.handle('template:getInstalledPacks', async () => {
        return templateService.getInstalledPacks();
    });

    // 选择模板包文件夹
    ipcMain.handle('template:selectPackFolder', async () => {
        const result = await dialog.showOpenDialog({
            title: '选择模板包文件夹',
            properties: ['openDirectory'],
            buttonLabel: '选择此文件夹'
        });

        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }

        return result.filePaths[0];
    });

    // 安装模板包
    ipcMain.handle('template:installPack', async (_event, sourcePath: string) => {
        return await templateService.installPack(sourcePath);
    });

    // 卸载模板包
    ipcMain.handle('template:uninstallPack', async (_event, packId: string) => {
        return await templateService.uninstallPack(packId);
    });

    // 创建示例模板包
    ipcMain.handle('template:createSamplePack', async () => {
        return await templateService.createSampleTemplatePack();
    });

    // ===== 模板查询 =====

    // 获取模板列表
    ipcMain.handle('template:getList', async (_event, type?: TemplateType) => {
        return templateService.getTemplateList(type);
    });

    // 加载模板详情
    ipcMain.handle('template:load', async (_event, templateId: string) => {
        return await templateService.loadTemplate(templateId);
    });

    // 获取模板占位符
    ipcMain.handle('template:getPlaceholders', async (_event, templateId: string) => {
        return await templateService.getTemplatePlaceholders(templateId);
    });

    // ===== 占位符解析 =====

    // 解析图层名称
    ipcMain.handle('template:parseLayerName', async (_event, layerName: string) => {
        return templateParserService.parseLayerName(layerName);
    });

    // 批量解析图层名称
    ipcMain.handle('template:parseLayerNames', async (_event, layerNames: string[]) => {
        const result = templateParserService.parseLayerNames(layerNames);
        // Map 转换为普通对象
        return Object.fromEntries(result);
    });

    // 验证占位符名称
    ipcMain.handle('template:isValidPlaceholder', async (_event, name: string) => {
        return templateParserService.isValidPlaceholderName(name);
    });

    // 生成占位符图层名称
    ipcMain.handle('template:generateLayerName', async (_event, params: {
        type: string;
        name: string;
        options?: string[];
        flags?: { lock?: boolean; hidden?: boolean; condition?: string };
    }) => {
        return templateParserService.generateLayerName(
            params.type as any,
            params.name,
            params.options,
            params.flags
        );
    });

    // ===== 渲染相关 =====

    // 验证绑定数据
    ipcMain.handle('template:validateBindings', async (_event, templateId: string, bindings: TemplateBindings) => {
        const template = await templateService.loadTemplate(templateId);
        if (!template) {
            return { valid: false, errors: ['模板未找到'] };
        }
        return templateService.validateBindings(template, bindings);
    });

    // 生成渲染指令
    ipcMain.handle('template:generateRenderInstructions', async (_event, context: RenderContext) => {
        return templateService.generateRenderInstructions(context);
    });

    console.log('[IPC] 模板系统处理器注册完成');
}
