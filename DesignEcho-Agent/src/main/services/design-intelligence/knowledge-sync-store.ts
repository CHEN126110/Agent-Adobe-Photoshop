/**
 * Design Intelligence · 冲突检测与同步（Phase 2 · DI-02x）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md
 *   §25.1 Obsidian 同步（双向）/ §24 存储建议
 *
 * 职责：
 * - 维护「上次同步的 contentHash」映射，用于检测 Obsidian 外部改动。
 * - 判定一条笔记处于哪种状态：无变化 / 新增 / 外部改动 / 本端待写。
 * - 提供冲突合流判断：Obsidian 版本 vs Agent/DesignEcho 版本，冲突不覆盖。
 *
 * 边界：
 * - 只做状态判定与 hash 簿记（纯逻辑 + 内存映射），不直接持有 fs。
 * - 双向同步的「实际写入」由上层（ObsidianVaultAdapter.atomicWrite）负责。
 */

import { contentHash, type ObsidianNote } from '../../../shared/design-intelligence/obsidian/obsidian-vault-adapter';

/** 一次同步簿记的状态。 */
export type SyncState =
    | { status: 'unchanged' }
    | { status: 'new' }
    | { status: 'changed_externally'; diskHash: string; lastSeenHash?: string }
    | { status: 'pending_write'; lastSeenHash?: string };

export interface SyncStateEntry {
    lastSeenHash?: string;
    /** DesignEcho 侧尚未落盘的待写内容（可选）。 */
    pendingContent?: string;
}

/** 双向同步簿记。 */
export class KnowledgeSyncStore {
    private readonly entries = new Map<string, SyncStateEntry>();

    /** 记录某路径最近一次同步的 hash。 */
    recordSeen(path: string, hash: string): void {
        this.entries.set(path, { lastSeenHash: hash });
    }

    /** 记录某路径的待写内容（DesignEcho 侧改动未落盘）。 */
    recordPending(path: string, content: string, baseHash?: string): void {
        const prev = this.entries.get(path) || {};
        this.entries.set(path, { lastSeenHash: prev.lastSeenHash ?? baseHash, pendingContent: content });
    }

    /** 清除待写（已落盘）。 */
    clearPending(path: string): void {
        const prev = this.entries.get(path);
        if (prev) this.entries.set(path, { lastSeenHash: prev.lastSeenHash });
    }

    getLastSeen(path: string): string | undefined {
        return this.entries.get(path)?.lastSeenHash;
    }

    getPending(path: string): string | undefined {
        return this.entries.get(path)?.pendingContent;
    }

    /** 判定路径当前同步状态（纯逻辑）。 */
    resolveState(path: string, diskNote?: ObsidianNote | null): SyncState {
        const lastSeen = this.getLastSeen(path);
        const pending = this.getPending(path);

        if (!diskNote) {
            // 磁盘不存在：若之前见过 → 外部删除；否则视为未见。
            return lastSeen ? { status: 'changed_externally', diskHash: '' } : { status: 'unchanged' };
        }

        const diskHash = contentHash(diskNote);
        if (pending) {
            // 本端有待写内容 → 待写状态（是否冲突由上层用 expectedHash=lastSeen 校验）
            return { status: 'pending_write', lastSeenHash: lastSeen };
        }
        if (!lastSeen) {
            return { status: 'new' };
        }
        if (diskHash === lastSeen) {
            return { status: 'unchanged' };
        }
        return { status: 'changed_externally', diskHash, lastSeenHash: lastSeen };
    }
}