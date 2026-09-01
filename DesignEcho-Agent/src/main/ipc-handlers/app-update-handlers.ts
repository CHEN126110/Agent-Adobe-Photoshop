/**
 * 应用自更新 IPC（appUpdate:*）。
 *
 * 服务实例在注册时创建并启动（单窗口应用，随主进程生命周期常驻）；Renderer 只能
 * 读状态、发起检查与显式安装，不能改更新源——更新源是主进程配置常量，防止任何
 * 渲染层内容把客户端指向陌生更新服务器。
 */

import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent, IPCContext } from './types';
import { AppUpdateService } from '../services/app-update-service';

function isMainWindowCaller(event: IpcMainInvokeEvent, context: IPCContext): boolean {
    const mainWebContentsId = context.mainWindow?.webContents.id;
    return typeof mainWebContentsId === 'number' && event.sender.id === mainWebContentsId;
}

function rejectUntrustedCaller(): never {
    throw new Error('已拒绝非主窗口发起的应用更新操作。');
}

export function registerAppUpdateHandlers(context: IPCContext): void {
    const service = new AppUpdateService(() => context.mainWindow);
    service.start();

    ipcMain.handle('appUpdate:getState', async (event: IpcMainInvokeEvent) => {
        if (!isMainWindowCaller(event, context)) rejectUntrustedCaller();
        return service.getState();
    });

    ipcMain.handle('appUpdate:check', async (event: IpcMainInvokeEvent) => {
        if (!isMainWindowCaller(event, context)) rejectUntrustedCaller();
        return service.checkNow();
    });

    ipcMain.handle('appUpdate:install', async (event: IpcMainInvokeEvent) => {
        if (!isMainWindowCaller(event, context)) rejectUntrustedCaller();
        return service.installNow();
    });
}
