/**
 * 设计知识笔记 IPC Handlers
 *
 * 通道前缀 designNotes:*。渲染层（知识库笔记 UI 与 Agent 工具执行器）
 * 通过 window.designEcho.invoke 调用；存储与安全校验在 design-notes-service。
 */

import { ipcMain, dialog, shell } from 'electron';
import { getDesignNotesService, type WriteDesignNoteInput } from '../services/design-notes-service';

export function registerDesignNotesHandlers(): void {
    ipcMain.handle('designNotes:getVaultInfo', async () => {
        return getDesignNotesService().getVaultInfo();
    });

    ipcMain.handle('designNotes:chooseVault', async () => {
        const result = await dialog.showOpenDialog({
            title: '选择设计笔记库文件夹（可选已有 Obsidian 库）',
            properties: ['openDirectory', 'createDirectory']
        });
        if (result.canceled || result.filePaths.length === 0) return null;
        return getDesignNotesService().setVaultPath(result.filePaths[0]);
    });

    ipcMain.handle('designNotes:resetVault', async () => {
        return getDesignNotesService().resetVaultPath();
    });

    ipcMain.handle('designNotes:openVaultInExplorer', async () => {
        const info = getDesignNotesService().getVaultInfo();
        await shell.openPath(info.vaultPath);
        return { success: true };
    });

    ipcMain.handle('designNotes:list', async () => {
        return getDesignNotesService().listNotes();
    });

    ipcMain.handle('designNotes:read', async (_event, id: string) => {
        const service = getDesignNotesService();
        const note = service.readNote(String(id || ''));
        return { note, backlinks: service.getBacklinks(note.id) };
    });

    ipcMain.handle('designNotes:write', async (_event, input: WriteDesignNoteInput) => {
        if (!input || typeof input !== 'object') {
            throw new Error('写入笔记失败：参数为空。');
        }
        const author = input.author === 'agent' ? 'agent' : 'user';
        return getDesignNotesService().writeNote({ ...input, author });
    });

    ipcMain.handle('designNotes:delete', async (_event, id: string) => {
        return getDesignNotesService().deleteNote(String(id || ''));
    });

    ipcMain.handle('designNotes:search', async (_event, input: { query?: string; tags?: string[]; limit?: number }) => {
        return getDesignNotesService().searchNotes(input || {});
    });

    ipcMain.handle('designNotes:listTags', async () => {
        return getDesignNotesService().listAllTags();
    });

    console.log('[IPC] 设计知识笔记 handlers 已注册');
}
