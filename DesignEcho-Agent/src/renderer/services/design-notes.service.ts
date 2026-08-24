/**
 * 设计知识笔记渲染层服务
 *
 * 知识库「设计笔记」页与 Agent 工具执行器共用的 IPC 封装。
 * 存储与校验都在主进程 design-notes-service；这里只做通道调用与结果规整。
 */

import type {
    DesignNote,
    DesignNoteMeta,
    DesignNoteSearchMatch
} from '../../shared/design-notes';

export interface DesignNotesVaultInfo {
    vaultPath: string;
    isDefault: boolean;
    noteCount: number;
}

type InvokeFn = (channel: string, ...args: unknown[]) => Promise<unknown>;

export class DesignNotesClient {
    private readonly invoke: InvokeFn;

    constructor(invoke?: InvokeFn) {
        this.invoke = invoke
            || ((channel: string, ...args: unknown[]) => {
                const api = window.designEcho?.invoke;
                if (!api) return Promise.reject(new Error('设计笔记不可用：当前桌面运行时没有暴露 IPC invoke。'));
                return api(channel, ...args);
            });
    }

    async getVaultInfo(): Promise<DesignNotesVaultInfo> {
        return await this.invoke('designNotes:getVaultInfo') as DesignNotesVaultInfo;
    }

    async chooseVault(): Promise<DesignNotesVaultInfo | null> {
        return await this.invoke('designNotes:chooseVault') as DesignNotesVaultInfo | null;
    }

    async resetVault(): Promise<DesignNotesVaultInfo> {
        return await this.invoke('designNotes:resetVault') as DesignNotesVaultInfo;
    }

    async openVaultInExplorer(): Promise<void> {
        await this.invoke('designNotes:openVaultInExplorer');
    }

    async listNotes(): Promise<DesignNoteMeta[]> {
        const result = await this.invoke('designNotes:list');
        return Array.isArray(result) ? result as DesignNoteMeta[] : [];
    }

    async readNote(id: string): Promise<{ note: DesignNote; backlinks: DesignNoteMeta[] }> {
        const result = await this.invoke('designNotes:read', id) as { note: DesignNote; backlinks?: DesignNoteMeta[] };
        return { note: result.note, backlinks: Array.isArray(result.backlinks) ? result.backlinks : [] };
    }

    async writeNote(input: {
        id?: string;
        title?: string;
        content: string;
        tags?: string[];
        mode?: 'replace' | 'append';
    }): Promise<DesignNote> {
        return await this.invoke('designNotes:write', { ...input, author: 'user' }) as DesignNote;
    }

    async deleteNote(id: string): Promise<{ trashedTo: string }> {
        return await this.invoke('designNotes:delete', id) as { trashedTo: string };
    }

    async searchNotes(input: { query?: string; tags?: string[]; limit?: number }): Promise<DesignNoteSearchMatch[]> {
        const result = await this.invoke('designNotes:search', input);
        return Array.isArray(result) ? result as DesignNoteSearchMatch[] : [];
    }

    async listTags(): Promise<Array<{ tag: string; count: number }>> {
        const result = await this.invoke('designNotes:listTags');
        return Array.isArray(result) ? result as Array<{ tag: string; count: number }> : [];
    }
}

let singleton: DesignNotesClient | null = null;

export function getDesignNotesClient(): DesignNotesClient {
    if (!singleton) singleton = new DesignNotesClient();
    return singleton;
}
