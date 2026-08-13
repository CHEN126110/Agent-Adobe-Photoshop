/**
 * Design Intelligence · Obsidian 文件监听（Phase 2）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md §25.1
 *
 * 职责：监听 Obsidian Vault 下 .md 文件变化（新增/修改/删除），上报事件供同步。
 *       基于 fs.watch 递归监听，去抖后回调。
 *
 * 边界：
 * - 只上报事件，不写文件；写由 ObsidianVaultAdapter + SyncStore 处理。
 * - 递归监听需 Node >=20 watch recursive 支持；不支持时退化为根目录监听。
 */

import * as fs from 'fs';
import * as path from 'path';

export type ObsidianFileEventType = 'create' | 'change' | 'delete' | 'rename';

export interface ObsidianFileEvent {
    type: ObsidianFileEventType;
    /** 相对 vault 根的路径（正斜杠） */
    relativePath: string;
}

type Listener = (event: ObsidianFileEvent) => void;

/** 去抖后的文件监听器。 */
export class ObsidianFileWatcher {
    private readonly root: string;
    private watcher: fs.FSWatcher | null = null;
    private readonly listeners = new Set<Listener>();
    private readonly debounce = new Map<string, { timer: NodeJS.Timeout; event: ObsidianFileEvent }>();
    private readonly debounceMs: number;

    constructor(vaultRoot: string, debounceMs = 300) {
        this.root = vaultRoot;
        this.debounceMs = debounceMs;
    }

    on(callback: Listener): () => void {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    private emit(event: ObsidianFileEvent): void {
        const existing = this.debounce.get(event.relativePath);
        if (existing) clearTimeout(existing.timer);
        const timer = setTimeout(() => {
            this.debounce.delete(event.relativePath);
            for (const listener of this.listeners) listener(event);
        }, this.debounceMs);
        this.debounce.set(event.relativePath, { timer, event });
    }

    private handleFsEvent(eventType: string, filename: string | Buffer | null): void {
        if (!filename) return;
        const name = typeof filename === 'string' ? filename : filename.toString('utf8');
        if (!name.endsWith('.md')) return;
        const relativePath = name.replace(/\\/g, '/');
        const mapped: ObsidianFileEventType =
            eventType === 'rename' ? 'rename' : 'change';
        this.emit({ type: mapped, relativePath });
    }

    start(): void {
        if (this.watcher) return;
        try {
            this.watcher = fs.watch(this.root, { recursive: true }, (eventType, filename) => {
                this.handleFsEvent(eventType, filename);
            });
        } catch {
            // 递归监听不支持时退化为根目录非递归监听（仅一层）。
            this.watcher = fs.watch(this.root, (eventType, filename) => {
                this.handleFsEvent(eventType, filename);
            });
        }
    }

    stop(): void {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = null;
        }
        for (const { timer } of this.debounce.values()) clearTimeout(timer);
        this.debounce.clear();
    }
}

/** 便捷：把磁盘路径转相对根路径。 */
export function toRelative(root: string, absolute: string): string {
    return path.relative(root, absolute).replace(/\\/g, '/');
}