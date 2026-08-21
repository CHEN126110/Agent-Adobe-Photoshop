/**
 * ChatGPT 订阅（Codex App Server）窄 IPC。
 *
 * 认证链接、loginId、令牌与 App Server 原始协议都只留在主进程；renderer 只拿脱敏 DTO。
 */

import { ipcMain, shell, type IpcMainInvokeEvent } from 'electron';

import {
    CODEX_SUBSCRIPTION_PROVIDER,
    type CodexSubscriptionImageGenerationRequest
} from '../../shared/codex-subscription-contract';
import {
    getDynamicModels,
    setDynamicModels
} from '../../shared/config/dynamic-model-registry';
import type { IPCContext } from './types';

const OFFICIAL_LOGIN_HOSTS = new Set([
    'auth.openai.com',
    'chatgpt.com',
    'www.chatgpt.com'
]);

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
    throw new Error('已拒绝非主窗口发起的 ChatGPT 订阅操作。');
}

function validateOfficialLoginUrl(rawUrl: string): string {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error('Codex Runtime 返回了无效登录地址，已拒绝打开。');
    }
    if (
        parsed.protocol !== 'https:'
        || parsed.port
        || parsed.username
        || parsed.password
        || !OFFICIAL_LOGIN_HOSTS.has(parsed.hostname.toLowerCase())
    ) {
        throw new Error(`Codex Runtime 返回了未获准的登录域名「${parsed.hostname || '未知'}」，已拒绝打开。`);
    }
    return parsed.toString();
}

function clearCodexDynamicModels(): void {
    setDynamicModels(getDynamicModels().filter((model) => model.provider !== CODEX_SUBSCRIPTION_PROVIDER));
}

export function registerCodexSubscriptionHandlers(context: IPCContext): void {
    const service = context.codexSubscriptionService;

    ipcMain.handle('codexSubscription:getStatus', async (event: IpcMainInvokeEvent) => {
        if (!isMainWindowCaller(event, context)) rejectUntrustedCaller();
        if (!service) throw new Error('ChatGPT 订阅服务尚未初始化。');
        return service.getStatus();
    });

    ipcMain.handle('codexSubscription:startLogin', async (event: IpcMainInvokeEvent) => {
        if (!isMainWindowCaller(event, context)) rejectUntrustedCaller();
        if (!service) throw new Error('ChatGPT 订阅服务尚未初始化。');
        const result = await service.startLogin();
        if (!result.success || !result.authUrl) {
            return { success: result.success, pending: result.pending, error: result.error };
        }
        try {
            await shell.openExternal(validateOfficialLoginUrl(result.authUrl));
            return { success: true, pending: true };
        } catch {
            await service.cancelLogin();
            return {
                success: false,
                pending: false,
                error: '无法在系统浏览器中打开 ChatGPT 登录，已取消本次登录。'
            };
        }
    });

    ipcMain.handle('codexSubscription:cancelLogin', async (event: IpcMainInvokeEvent) => {
        if (!isMainWindowCaller(event, context)) rejectUntrustedCaller();
        if (!service) throw new Error('ChatGPT 订阅服务尚未初始化。');
        return service.cancelLogin();
    });

    ipcMain.handle('codexSubscription:logout', async (event: IpcMainInvokeEvent) => {
        if (!isMainWindowCaller(event, context)) rejectUntrustedCaller();
        if (!service) throw new Error('ChatGPT 订阅服务尚未初始化。');
        const result = await service.logout();
        if (result.success) clearCodexDynamicModels();
        return result;
    });

    ipcMain.handle(
        'codexSubscription:listModels',
        async (event: IpcMainInvokeEvent, forceRefresh?: boolean) => {
            if (!isMainWindowCaller(event, context)) rejectUntrustedCaller();
            if (!service) throw new Error('ChatGPT 订阅服务尚未初始化。');
            const result = await service.listModels(forceRefresh === true);
            if (result.success) {
                const otherProviders = getDynamicModels().filter(
                    (model) => model.provider !== CODEX_SUBSCRIPTION_PROVIDER
                );
                setDynamicModels([...otherProviders, ...result.models]);
            }
            return result;
        }
    );

    ipcMain.handle('codexSubscription:getRateLimits', async (event: IpcMainInvokeEvent) => {
        if (!isMainWindowCaller(event, context)) rejectUntrustedCaller();
        if (!service) throw new Error('ChatGPT 订阅服务尚未初始化。');
        return service.getRateLimits();
    });

    ipcMain.handle('codexSubscription:getImageGenerationCapability', async (event: IpcMainInvokeEvent) => {
        if (!isMainWindowCaller(event, context)) rejectUntrustedCaller();
        if (!service) throw new Error('ChatGPT 订阅服务尚未初始化。');
        return service.getImageGenerationCapability();
    });

    ipcMain.handle(
        'codexSubscription:generateImage',
        async (
            event: IpcMainInvokeEvent,
            request: CodexSubscriptionImageGenerationRequest
        ) => {
            if (!isMainWindowCaller(event, context)) rejectUntrustedCaller();
            if (!service) throw new Error('ChatGPT 订阅服务尚未初始化。');
            return service.generateImage(request);
        }
    );
}
