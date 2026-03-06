/**
 * 电商项目 IPC Handlers
 * 
 * 提供项目扫描、结构识别、分类更新等功能
 */

import { ipcMain, IpcMainInvokeEvent } from 'electron';
import { 
    ecommerceProjectService, 
    FolderType, 
    ImageType,
    EcommerceProjectStructure 
} from '../services/ecommerce-project-service';
import type { IPCContext } from './types';

/**
 * 注册电商项目相关 IPC handlers
 */
export function registerEcommerceProjectHandlers(context: IPCContext): void {
    const { logService } = context;

    // 扫描项目结构
    ipcMain.handle('ecommerce:scanProject', async (
        _event: IpcMainInvokeEvent, 
        projectPath: string
    ): Promise<EcommerceProjectStructure> => {
        logService?.logAgent('info', `[EcommerceProject] 扫描项目: ${projectPath}`);
        
        try {
            const structure = await ecommerceProjectService.scanProject(projectPath);

            // 自动初始化配置（写配置失败不应阻断素材扫描）
            try {
                await ecommerceProjectService.initProjectConfig(projectPath, structure);
            } catch (configError: any) {
                const msg = configError?.message || String(configError);
                logService?.logAgent('warn', `[EcommerceProject] 配置初始化失败（已降级继续）: ${msg}`);
            }
            
            logService?.logAgent('info', `[EcommerceProject] 扫描完成: ${structure.summary.totalImages} 张图片`);
            return structure;
        } catch (error: any) {
            logService?.logAgent('error', `[EcommerceProject] 扫描失败: ${error.message}`);
            throw error;
        }
    });

    // 更新文件夹类型
    ipcMain.handle('ecommerce:updateFolderType', async (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        folderName: string,
        type: FolderType
    ): Promise<void> => {
        logService?.logAgent('info', `[EcommerceProject] 更新文件夹类型: ${folderName} -> ${type}`);
        await ecommerceProjectService.updateFolderType(projectPath, folderName, type);
    });

    // 更新图片类型
    ipcMain.handle('ecommerce:updateImageType', async (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        imageRelativePath: string,
        type: ImageType
    ): Promise<void> => {
        logService?.logAgent('info', `[EcommerceProject] 更新图片类型: ${imageRelativePath} -> ${type}`);
        await ecommerceProjectService.updateImageType(projectPath, imageRelativePath, type);
    });

    // 加载项目配置
    ipcMain.handle('ecommerce:loadConfig', async (
        _event: IpcMainInvokeEvent,
        projectPath: string
    ) => {
        return await ecommerceProjectService.loadProjectConfig(projectPath);
    });

    // 保存项目配置
    ipcMain.handle('ecommerce:saveConfig', async (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        config: any
    ) => {
        await ecommerceProjectService.saveProjectConfig(projectPath, config);
    });

    console.log('[IPC] 电商项目 handlers 已注册');
}

