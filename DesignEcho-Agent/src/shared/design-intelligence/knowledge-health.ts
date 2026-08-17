/**
 * Design Intelligence · Knowledge Health + Stale Review（Phase 4）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md
 *   §12 Knowledge Steward Agent / §14 Freshness / Knowledge Health / Phase 4
 *
 * 职责：纯逻辑计算知识库的「健康度」——按状态统计、找出过期/待验证知识，
 *       供 Steward Agent 提出「这条知识 90 天未验证」这类行动建议。
 *
 * 边界：
 * - 只产出「诊断建议」，不写回、不删除；任何高影响写回继续过 Knowledge Write Gate。
 * - 纯契约 + 纯函数，无 IO。
 */

import type { KnowledgeNode, KnowledgeStatus, KnowledgeFreshnessMode } from './knowledge.types';

/** 一条待复审/过期的知识及原因。 */
export interface StaleKnowledge {
    node: KnowledgeNode;
    reason: 'overdue_review' | 'volatile_unverified';
}

/** 知识健康度指标。 */
export interface KnowledgeHealthMetrics {
    total: number;
    byStatus: Record<KnowledgeStatus, number>;
    usable: number;
    stale: StaleKnowledge[];
    /** 是否满足 Phase 4 退出准则「知识库开始具备自我维护能力」的信号：存在需维护项。 */
    hasMaintenanceActions: boolean;
}

function emptyStatusCounts(): Record<KnowledgeStatus, number> {
    return {
        observation: 0,
        candidate: 0,
        validated: 0,
        core: 0,
        deprecated: 0
    };
}

/** 判定一条知识是否已过期/待验证。 */
export function isStale(node: KnowledgeNode, now: string): StaleKnowledge | null {
    const nowMs = Date.parse(now);
    if (Number.isNaN(nowMs)) return null;

    const reviewAfter = node.freshness.reviewAfter;
    if (reviewAfter && Date.parse(reviewAfter) <= nowMs) {
        return { node, reason: 'overdue_review' };
    }

    // volatile 且从未验证 → 待验证
    if (
        node.freshness.mode === 'volatile' &&
        !node.freshness.lastVerifiedAt &&
        (node.status === 'validated' || node.status === 'core')
    ) {
        return { node, reason: 'volatile_unverified' };
    }

    return null;
}

/** 计算一批知识的健康度指标（纯逻辑）。 */
export function computeKnowledgeHealth(nodes: readonly KnowledgeNode[], now: string): KnowledgeHealthMetrics {
    const byStatus = emptyStatusCounts();
    const stale: StaleKnowledge[] = [];

    for (const node of nodes) {
        byStatus[node.status] = (byStatus[node.status] ?? 0) + 1;
        const s = isStale(node, now);
        if (s) stale.push(s);
    }

    const usable = nodes.filter((n) => n.status === 'validated' || n.status === 'core').length;

    return {
        total: nodes.length,
        byStatus,
        usable,
        stale,
        hasMaintenanceActions: stale.length > 0
    };
}

/** 按新鲜度模式计算默认复审间隔（天）。稳定知识不自动排期；易变知识需更勤复审。 */
export function defaultReviewAfterDays(mode: KnowledgeFreshnessMode): number | null {
    switch (mode) {
        case 'stable':
            return null;
        case 'medium':
            return 90;
        case 'volatile':
            return 30;
        default:
            return null;
    }
}
