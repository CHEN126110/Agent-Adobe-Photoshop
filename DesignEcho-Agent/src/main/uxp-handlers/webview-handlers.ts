/**
 * WebView 消息转发相关 UXP Handlers
 */

import type { UXPContext } from './types';

/**
 * 注册 WebView 相关 handlers
 */
export function registerWebViewHandlers(context: UXPContext): void {
    const { wsServer, mainWindow, logService } = context;

    // WebView 消息转发
    // UXP sendNotification('webview.message', messageObj) 中 messageObj 直接作为 params
    wsServer.registerHandler('webview.message', async (params: any) => {
        if (mainWindow && params && typeof params === 'object') {
            mainWindow.webContents.send('uxp:webview-message', params);
            console.log('[Agent] 转发 WebView 消息:', params?.type || 'unknown');
        }
        return { success: true };
    });
}
