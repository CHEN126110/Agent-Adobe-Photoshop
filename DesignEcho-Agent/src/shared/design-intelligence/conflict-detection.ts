/**
 * Design Intelligence · Conflict Detection（Phase 4）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md
 *   §12 Knowledge Steward Agent / Phase 4（Conflict Detection）
 *
 * 职责：纯逻辑检测「可能冲突」的知识——通过显式 contradicts 关系，
 *       或通过同领域/同任务下高度矛盾的范围描述，供 Steward Agent 提出
 *       「这两条规则可能冲突」这类警示。
 *
 * 边界：
 * - 只产出「疑似冲突」候选，不裁决谁对谁错；裁决留给用户 / Conflict UI。
 * - 冲突候选不得自动删除或覆盖任何一条——Destructive 写必须用户确认。
 */

import type { KnowledgeNode } from './knowledge.types';
import type { ResourceRelation } from './relation.types';

/** 一条疑似冲突的候选。 */
export interface ConflictCandidate {
    aId: string;
    bId: string;
    /** 冲突来源：显式关系 / 推断 */
    basis: 'explicit_relation' | 'inferred';
}

/** 通过显式 contradicts 关系检测冲突。 */
export function detectExplicitContradictions(
    nodes: readonly KnowledgeNode[],
    relations: readonly ResourceRelation[]
): ConflictCandidate[] {
    const idSet = new Set(nodes.map((n) => n.id));
    const result: ConflictCandidate[] = [];
    for (const rel of relations) {
        if (rel.type !== 'contradicts') continue;
        if (idSet.has(rel.fromId) && idSet.has(rel.toId)) {
            result.push({ aId: rel.fromId, bId: rel.toId, basis: 'explicit_relation' });
        }
    }
    return result;
}

/** 判定两条知识是否「同域同任务」（用于推断冲突）。 */
function sharesScope(a: KnowledgeNode, b: KnowledgeNode): boolean {
    const aTasks = new Set(a.applicableTaskTypes);
    const bTasks = new Set(b.applicableTaskTypes);
    const taskOverlap = [...aTasks].some((t) => bTasks.has(t));
    const domainOverlap = a.domains.some((d) => b.domains.includes(d));
    return taskOverlap && domainOverlap;
}

/**
 * 推断式冲突检测：同域同任务、状态均有效、且范围描述方向相反（一个含 must 一个含 must not）。
 * 仅作提示，不构成硬结论。
 */
export function detectInferredConflicts(
    nodes: readonly KnowledgeNode[],
    thresholdRatio = 0.5
): ConflictCandidate[] {
    const result: ConflictCandidate[] = [];
    const usable = nodes.filter((n) => n.status === 'validated' || n.status === 'core');
    for (let i = 0; i < usable.length; i++) {
        for (let j = i + 1; j < usable.length; j++) {
            const a = usable[i];
            const b = usable[j];
            if (!sharesScope(a, b)) continue;
            const aMustNot = /禁止|不得|不应|避免|must not|never/i.test(`${a.title} ${a.scope ?? ''}`);
            const bMustNot = /禁止|不得|不应|避免|must not|never/i.test(`${b.title} ${b.scope ?? ''}`);
            if (aMustNot !== bMustNot) {
                result.push({ aId: a.id, bId: b.id, basis: 'inferred' });
            }
        }
    }
    return result;
}

/** 汇总显式 + 推断冲突（去重）。 */
export function detectAllConflicts(
    nodes: readonly KnowledgeNode[],
    relations: readonly ResourceRelation[]
): ConflictCandidate[] {
    const seen = new Set<string>();
    const result: ConflictCandidate[] = [];
    const push = (c: ConflictCandidate): void => {
        const key = [c.aId, c.bId].sort().join('|');
        if (seen.has(key)) return;
        seen.add(key);
        result.push(c);
    };
    for (const c of detectExplicitContradictions(nodes, relations)) push(c);
    for (const c of detectInferredConflicts(nodes)) push(c);
    return result;
}
