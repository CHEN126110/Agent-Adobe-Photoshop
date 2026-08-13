/**
 * Design Intelligence · 主进程运行时持久化统一出口（Phase 0+）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md §31
 * 职责：收敛主进程 Design Intelligence 的持久化服务（IntelligenceDb 及其集合 Store），
 *       供 IPC handler / 上层服务统一引用。
 */

export * from './intelligence-db';
export * from './relation-store';
export * from './knowledge-index-store';
export * from './learning-event-store';
export * from './knowledge-sync-store';
export * from './obsidian-file-watcher';
export * from './obsidian-vault-service';
