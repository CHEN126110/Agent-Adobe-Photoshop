/**
 * Design Intelligence · Knowledge Writeback Contract（Phase 0）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md §13/§25/§33
 * 职责：约束所有「把知识写回 Provider（Obsidian / builtin / runtime）」的操作必须经过
 *       安全 Gate，并执行「读 → 校验 contentHash → 写 → 原子提交 → 冲突检测」的一致性流程。
 *
 * 安全层级（§33）：
 * - Read：搜索 / 查看 / 分析，默认允许。
 * - Safe Write：新增 Candidate / 新增 AI Relation / 新增 Runtime Tag，低风险。
 * - Knowledge Write：修改正式知识 / 升级 Validated / 合并 / Deprecated，必须 Gate。
 * - Destructive：删除 / 覆盖 / 批量结构调整，必须用户确认。
 *
 * 边界：
 * - Agent 不直接使用裸 fs API 修改知识源，一律经过本契约对应的 Service + Gate。
 * - 纯契约，无 IO。
 */

import type { KnowledgeNode } from './knowledge.types';
import type { KnowledgeStatus } from './knowledge.types';

/** 写回动作的类别，决定所需 Gate 级别。 */
export type KnowledgeWriteAction =
    | 'propose_candidate'
    | 'add_ai_relation'
    | 'add_runtime_tag'
    | 'update_knowledge'
    | 'upgrade_status'
    | 'merge'
    | 'deprecate'
    | 'delete'
    | 'overwrite';

/** 写回目标 Provider 类型（与 KnowledgeNode.provider.type 对齐）。 */
export type KnowledgeWriteTargetType = 'obsidian' | 'builtin' | 'runtime';

/** 写回请求。 */
export interface KnowledgeWriteRequest {
    action: KnowledgeWriteAction;
    targetType: KnowledgeWriteTargetType;
    /** provider 内定位符（Obsidian 文件路径等） */
    locator: string;
    /** 写入前的期望内容哈希；不匹配则视为外部已变更，触发冲突 */
    expectedContentHash?: string;
    next?: Partial<KnowledgeNode>;
}

/** 写回结果。 */
export interface KnowledgeWriteResult {
    success: boolean;
    /** 若因外部变更冲突而失败，返回该信息 */
    conflict?: boolean;
    message?: string;
    /** 写入后的内容哈希 */
    contentHash?: string;
}

/** 该写回动作是否需要用户显式确认（Destructive 级）。 */
export function requiresUserConfirmation(action: KnowledgeWriteAction): boolean {
    return action === 'delete' || action === 'overwrite';
}

/** 该写回动作属于「Knowledge Write」级（需 Gate），而非 Safe Write。 */
export function requiresKnowledgeGate(action: KnowledgeWriteAction): boolean {
    switch (action) {
        case 'propose_candidate':
        case 'add_ai_relation':
        case 'add_runtime_tag':
            return false;
        default:
            return true;
    }
}
