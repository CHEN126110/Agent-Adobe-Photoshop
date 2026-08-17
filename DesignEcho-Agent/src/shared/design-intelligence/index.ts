/**
 * Design Intelligence · 共享契约统一出口（Phase 0）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md §31
 * 职责：收敛 Design Intelligence 的全部纯契约，供 renderer / main / smoke 统一引用。
 * 纯类型 + 纯函数，无 IO、无环境依赖。
 */

export * from './knowledge.types';
export * from './evidence.types';
export * from './relation.types';
export * from './task-context.types';
export * from './candidate.types';
export * from './learning-event.types';
export * from './retrieval-contract';
export * from './knowledge-writeback-contract';
export * from './context-audit';
export * from './task-context-card';
export * from './candidate-review';
export * from './visual-linking';
export * from './knowledge-health';
export * from './duplicate-detection';
export * from './conflict-detection';
export * from './candidate-merge';
export * from './repeated-pattern';
export * from './external-signal.types';
export * from './proposition-ledger';
export * from './obsidian/obsidian-vault-adapter';
