/**
 * Claude 订阅窄 IPC。
 *
 * 凭据全程由 Claude Code 运行时自管（终端 /login）；renderer 只拿脱敏 DTO。
 * 登录终端由主进程 spawn 官方内嵌运行时，不打开任何网页 URL、不经手令牌。
 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron';

import { CLAUDE_SUBSCRIPTION_PROVIDER } from '../../shared/claude-subscription-contract';
import {
    getDynamicModels,
    setDynamicModels
} from '../../shared/config/dynamic-model-registry';
import type { IPCContext } from './types';

function isMainWindowCaller(event: IpcMainInvokeEvent, context: IPCContext): boolean {
    const mainWindow = context.mainWindow;
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    if (event.sender.id !== mainWindow.webContents.id) return false;
    if (event.senderFrame !== mainWindow.webContents.mainFrame) return false;
    try {
        return new URL(event.senderFrame.url).protocol === 'file:';
    } catch {
        return false;
    }
}

function rejectUntrustedCaller(): never {
    throw new Error('已拒绝非主窗口发起的 Claude 订阅操作。');
}

export function registerClaudeSubscriptionHandlers(context: IPCContext): void {
    const service = context.claudeSubscriptionService;

    ipcMain.handle('claudeSubscription:getStatus', async (event: IpcMainInvokeEvent) => {
        if (!isMainWindowCaller(event, context)) rejectUntrustedCaller();
        if (!service) throw new Error('Claude 订阅服务尚未初始化。');
        return service.getStatus();
    });

    ipcMain.handle('claudeSubscription:openLoginTerminal', async (event: IpcMainInvokeEvent) => {
        if (!isMainWindowCaller(event, context)) rejectUntrustedCaller();
        if (!service) throw new Error('Claude 订阅服务尚未初始化。');
        return service.openLoginTerminal();
    });

    ipcMain.handle('claudeSubscription:probeAuth', async (event: IpcMainInvokeEvent) => {
        if (!isMainWindowCaller(event, context)) rejectUntrustedCaller();
        if (!service) throw new Error('Claude 订阅服务尚未初始化。');
        const result = await service.probeAuth();
        if (result.success) {
            const otherProviders = getDynamicModels().filter(
                (model) => model.provider !== CLAUDE_SUBSCRIPTION_PROVIDER
            );
            setDynamicModels([...otherProviders, ...service.listModels()]);
        }
        return result;
    });

    ipcMain.handle('claudeSubscription:logout', async (event: IpcMainInvokeEvent) => {
        if (!isMainWindowCaller(event, context)) rejectUntrustedCaller();
        if (!service) throw new Error('Claude 订阅服务尚未初始化。');
        const result = await service.logout();
        if (result.success) {
            setDynamicModels(getDynamicModels().filter(
                (model) => model.provider !== CLAUDE_SUBSCRIPTION_PROVIDER
            ));
        }
        return result;
    });

    ipcMain.handle('claudeSubscription:listModels', async (event: IpcMainInvokeEvent) => {
        if (!isMainWindowCaller(event, context)) rejectUntrustedCaller();
        if (!service) throw new Error('Claude 订阅服务尚未初始化。');
        const models = service.listModels();
        const otherProviders = getDynamicModels().filter(
            (model) => model.provider !== CLAUDE_SUBSCRIPTION_PROVIDER
        );
        setDynamicModels([...otherProviders, ...models]);
        return { success: true, models };
    });
}
