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
import {
    projectContextSnapshotService,
    type ProjectContextSnapshotBuildOptions,
    type ProjectContextSnapshotBuildResult
} from '../services/project-context-snapshot-service';
import { resolveProjectSelection } from '../services/project-selection-resolver';
import type { ProjectSelectionResolution } from '../../shared/project-selection-resolution';
import type { IPCContext } from './types';

/**
 * 注册电商项目相关 IPC handlers
 */
export function registerEcommerceProjectHandlers(context: IPCContext): void {
    const { logService } = context;

    ipcMain.handle('ecommerce:resolveProjectSelection', async (
        _event: IpcMainInvokeEvent,
        selectedPath: string
    ): Promise<ProjectSelectionResolution> => {
        const resolution = await resolveProjectSelection(selectedPath);
        for (const warning of resolution.warnings) {
            logService?.logAgent('warn', `[EcommerceProject] ${warning}`);
        }
        return resolution;
    });

    // 扫描项目结构
    ipcMain.handle('ecommerce:scanProject', async (
        _event: IpcMainInvokeEvent, 
        projectPath: string
    ): Promise<EcommerceProjectStructure> => {
        const resolution = await resolveProjectSelection(projectPath);
        const canonicalProjectPath = resolution.canonicalProjectPath;
        logService?.logAgent('info', `[EcommerceProject] 扫描项目: ${canonicalProjectPath}`);

        try {
            const structure = await ecommerceProjectService.scanProject(canonicalProjectPath);

            // 自动初始化配置（写配置失败不应阻断素材扫描）
            try {
                structure.config = await ecommerceProjectService.initProjectConfig(canonicalProjectPath, structure);
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
        const resolution = await resolveProjectSelection(projectPath);
        await ecommerceProjectService.updateFolderType(resolution.canonicalProjectPath, folderName, type);
    });

    // 更新图片类型
    ipcMain.handle('ecommerce:updateImageType', async (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        imageRelativePath: string,
        type: ImageType
    ): Promise<void> => {
        logService?.logAgent('info', `[EcommerceProject] 更新图片类型: ${imageRelativePath} -> ${type}`);
        const resolution = await resolveProjectSelection(projectPath);
        await ecommerceProjectService.updateImageType(resolution.canonicalProjectPath, imageRelativePath, type);
    });

    // 加载项目配置
    ipcMain.handle('ecommerce:loadConfig', async (
        _event: IpcMainInvokeEvent,
        projectPath: string
    ) => {
        const resolution = await resolveProjectSelection(projectPath);
        return await ecommerceProjectService.loadProjectConfig(resolution.canonicalProjectPath);
    });

    // 保存项目配置
    ipcMain.handle('ecommerce:saveConfig', async (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        config: any
    ) => {
        const resolution = await resolveProjectSelection(projectPath);
        await ecommerceProjectService.saveProjectConfig(resolution.canonicalProjectPath, {
            ...config,
            projectPath: resolution.canonicalProjectPath,
            projectName: resolution.projectName
        });
    });

    // 构建运行时 ContextSnapshot（只读，不初始化或写入项目配置）
    ipcMain.handle('ecommerce:buildContextSnapshot', async (
        _event: IpcMainInvokeEvent,
        options: ProjectContextSnapshotBuildOptions | string
    ): Promise<ProjectContextSnapshotBuildResult> => {
        const buildOptions: ProjectContextSnapshotBuildOptions = typeof options === 'string'
            ? { projectPath: options }
            : options;
        const resolution = await resolveProjectSelection(buildOptions.projectPath);
        const canonicalBuildOptions: ProjectContextSnapshotBuildOptions = {
            ...buildOptions,
            projectPath: resolution.canonicalProjectPath,
            projectName: buildOptions.projectName || resolution.projectName
        };

        logService?.logAgent('info', `[EcommerceProject] 构建运行时 ContextSnapshot: ${canonicalBuildOptions.projectPath}`);
        try {
            return await projectContextSnapshotService.build(canonicalBuildOptions);
        } catch (error: any) {
            logService?.logAgent('error', `[EcommerceProject] ContextSnapshot 构建失败: ${error.message}`);
            throw error;
        }
    });

    // 只读项目视觉理解缓存（.designecho/visual-insights-cache.json；不扫描项目、不初始化或写入项目配置）
    ipcMain.handle('ecommerce:readVisualInsightCache', async (
        _event: IpcMainInvokeEvent,
        options: { projectPath: string } | string
    ) => {
        const projectPath = typeof options === 'string' ? options : options?.projectPath;
        const resolution = await resolveProjectSelection(projectPath);
        logService?.logAgent('info', `[EcommerceProject] 读取视觉理解缓存: ${resolution.canonicalProjectPath}`);
        try {
            return await projectContextSnapshotService.readPersistedVisualInsightCache(resolution.canonicalProjectPath);
        } catch (error: any) {
            logService?.logAgent('error', `[EcommerceProject] 视觉理解缓存读取失败: ${error.message}`);
            throw error;
        }
    });

    ipcMain.handle('ecommerce:writeVisualInsightCache', async (
        _event: IpcMainInvokeEvent,
        options: {
            projectPath: string;
            entries: any[];
            replace?: boolean;
            nowIso?: string;
        }
    ) => {
        const resolution = await resolveProjectSelection(options?.projectPath);
        const canonicalOptions = {
            ...options,
            projectPath: resolution.canonicalProjectPath
        };
        logService?.logAgent('info', `[EcommerceProject] 写入视觉理解缓存: ${canonicalOptions.projectPath}`);
        try {
            return await projectContextSnapshotService.writeVisualInsightCache(canonicalOptions);
        } catch (error: any) {
            logService?.logAgent('error', `[EcommerceProject] 视觉理解缓存写入失败: ${error.message}`);
            throw error;
        }
    });

    console.log('[IPC] 电商项目 handlers 已注册');
}
