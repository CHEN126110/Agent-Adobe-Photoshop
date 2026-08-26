import { ipcMain } from 'electron';

import type { IPCContext } from './types';

const LOOPBACK_MCP_ENDPOINT = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\/mcp$/i;

/**
 * 只向 Renderer 投影当前 Main 实例已经启动的本地 Runtime endpoint。
 * 不接受 Renderer 参数，也不回退默认端口，避免并行调试实例互相串线。
 */
export function registerRuntimeHandlers(context: IPCContext): void {
    ipcMain.handle('runtime:getMcpHostEndpoint', async (): Promise<string> => {
        const endpoint = String(context.mcpHostEndpoint || '').trim();
        if (!LOOPBACK_MCP_ENDPOINT.test(endpoint)) {
            throw new Error('当前 DesignEcho Runtime 没有可用的 MCP Host endpoint。');
        }
        return endpoint;
    });
}
