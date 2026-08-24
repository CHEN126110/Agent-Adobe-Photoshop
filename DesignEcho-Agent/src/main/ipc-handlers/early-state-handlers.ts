/**
 * 提前注册的持久化状态同步读取 handler。
 *
 * 主进程启动顺序是 createWindow() → initializeServices() → setupIPC()：
 * 渲染进程一加载就会用 sendSync 水合 zustand persist（app.store 的 persistedStorage），
 * 若等 setupIPC 才注册本通道，渲染进程每次启动都会读失败并回退 localStorage，
 * 造成「读走 localStorage 旧快照、写进 IPC store」的双轨漂移
 * （errors.log 中每次启动固定出现的
 * 「[Store] 持久化读取失败，回退到 localStorage: reply was never sent」）。
 *
 * 本 handler 只依赖 userData 下的文件读取，无任何服务依赖，
 * 因此单独抽出，在 createWindow() 之前注册。
 * 注意：state:getPersistedValueSync 只在这里注册；config-handlers 保留
 * 异步的 get/set/remove 通道，不得重复注册本通道。
 */

import { app, ipcMain } from 'electron';
import fsSync from 'fs';
import path from 'path';

export function registerEarlyStateStoreHandlers(): void {
    const stateStorePath = path.join(app.getPath('userData'), 'app-state-store.json');

    ipcMain.on('state:getPersistedValueSync', (event, key: string) => {
        // 与原 config-handlers 版本语义一致：文件缺失/损坏一律按空 store 处理，
        // 返回 success + null，让渲染进程走「从 localStorage 迁移」路径而不是报错回退。
        let entries: Record<string, string> = {};
        try {
            const raw = fsSync.readFileSync(stateStorePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && typeof parsed.entries === 'object') {
                entries = parsed.entries as Record<string, string>;
            }
        } catch {
            entries = {};
        }
        const value = Object.prototype.hasOwnProperty.call(entries, key) ? entries[key] : null;
        event.returnValue = { success: true, value };
    });
}
