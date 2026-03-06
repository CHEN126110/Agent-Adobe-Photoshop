/**
 * 对话持久化 IPC Handlers
 *
 * 将对话数据独立存储为文件（每个项目一个文件），
 * 避免通过 Zustand persist + sendSync 传输大量数据。
 *
 * 存储位置: {userData}/conversations/{projectId}.json
 */

import { app, ipcMain, IpcMainInvokeEvent } from 'electron';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import type { IPCContext } from './types';

const CONVERSATIONS_DIR = 'conversations';

function getConversationsDir(): string {
    return path.join(app.getPath('userData'), CONVERSATIONS_DIR);
}

function getProjectConversationPath(projectId: string): string {
    // 安全处理 projectId，防止路径注入
    const safeId = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(getConversationsDir(), `${safeId}.json`);
}

export function registerConversationHandlers(context: IPCContext): void {
    const { logService } = context;

    // 确保对话目录存在
    const ensureDir = async () => {
        const dir = getConversationsDir();
        await fs.mkdir(dir, { recursive: true });
        return dir;
    };

    /**
     * 保存项目对话
     * conversations: Conversation[] 数组
     */
    ipcMain.handle('conversation:save', async (
        _event: IpcMainInvokeEvent,
        projectId: string,
        conversations: any[]
    ) => {
        try {
            await ensureDir();
            const filePath = getProjectConversationPath(projectId);
            const payload = JSON.stringify({
                projectId,
                updatedAt: Date.now(),
                conversations
            }, null, 2);

            // 原子写入：先写临时文件，再重命名
            const tempPath = `${filePath}.tmp`;
            try {
                await fs.writeFile(tempPath, payload, 'utf8');
                await fs.rename(tempPath, filePath);
            } catch {
                // rename 失败则直接写入
                await fs.writeFile(filePath, payload, 'utf8');
                try { await fs.unlink(tempPath); } catch {}
            }

            const sizeKB = Math.round(payload.length / 1024);
            console.log(`[Conversation] 保存成功: project="${projectId}", ${conversations.length} 条对话, ${sizeKB}KB`);
            return { success: true };
        } catch (error: any) {
            console.error(`[Conversation] 保存失败: project="${projectId}":`, error?.message);
            logService?.logAgent('error', `[Conversation] 保存失败: ${error?.message}`);
            return { success: false, error: error?.message || String(error) };
        }
    });

    /**
     * 加载项目对话
     */
    ipcMain.handle('conversation:load', async (
        _event: IpcMainInvokeEvent,
        projectId: string
    ) => {
        try {
            const filePath = getProjectConversationPath(projectId);

            try {
                const raw = await fs.readFile(filePath, 'utf8');
                const data = JSON.parse(raw);
                const conversations = Array.isArray(data.conversations) ? data.conversations : [];
                console.log(`[Conversation] 加载成功: project="${projectId}", ${conversations.length} 条对话`);
                return { success: true, conversations };
            } catch (e: any) {
                if (e.code === 'ENOENT') {
                    // 文件不存在 = 该项目没有保存过对话
                    return { success: true, conversations: [] };
                }
                throw e;
            }
        } catch (error: any) {
            console.error(`[Conversation] 加载失败: project="${projectId}":`, error?.message);
            return { success: false, error: error?.message, conversations: [] };
        }
    });

    /**
     * 删除项目对话
     */
    ipcMain.handle('conversation:delete', async (
        _event: IpcMainInvokeEvent,
        projectId: string
    ) => {
        try {
            const filePath = getProjectConversationPath(projectId);
            try {
                await fs.unlink(filePath);
            } catch (e: any) {
                if (e.code !== 'ENOENT') throw e;
            }
            return { success: true };
        } catch (error: any) {
            return { success: false, error: error?.message };
        }
    });

    /**
     * 批量迁移：从旧的 projectConversations 对象迁移到独立文件
     * 用于从 Zustand persist 数据迁移
     */
    ipcMain.handle('conversation:migrateFromStore', async (
        _event: IpcMainInvokeEvent,
        projectConversations: Record<string, any[]>
    ) => {
        try {
            await ensureDir();
            let migrated = 0;

            for (const [projectId, conversations] of Object.entries(projectConversations)) {
                if (!Array.isArray(conversations) || conversations.length === 0) continue;

                const filePath = getProjectConversationPath(projectId);
                // 只在文件不存在时迁移（不覆盖已有的新格式数据）
                try {
                    await fs.access(filePath);
                    // 文件已存在，跳过
                    continue;
                } catch {
                    // 文件不存在，执行迁移
                }

                const payload = JSON.stringify({
                    projectId,
                    updatedAt: Date.now(),
                    conversations,
                    migratedFrom: 'zustand-persist'
                }, null, 2);

                await fs.writeFile(filePath, payload, 'utf8');
                migrated++;
                console.log(`[Conversation] 迁移: project="${projectId}", ${conversations.length} 条对话`);
            }

            console.log(`[Conversation] 迁移完成: ${migrated} 个项目`);
            return { success: true, migrated };
        } catch (error: any) {
            console.error(`[Conversation] 迁移失败:`, error?.message);
            return { success: false, error: error?.message };
        }
    });

    /**
     * 列出所有有对话数据的项目 ID
     */
    ipcMain.handle('conversation:listProjects', async () => {
        try {
            await ensureDir();
            const dir = getConversationsDir();
            const files = await fs.readdir(dir);
            const projectIds = files
                .filter(f => f.endsWith('.json'))
                .map(f => f.replace('.json', ''));
            return { success: true, projectIds };
        } catch (error: any) {
            return { success: false, projectIds: [], error: error?.message };
        }
    });
}
