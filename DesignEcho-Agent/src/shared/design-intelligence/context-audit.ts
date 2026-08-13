/**
 * Design Intelligence · Context 使用审计（Phase 1 · DI-010）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md §34/§35
 * 职责：把 TaskContextSnapshot 转成可审计事件（用了哪些知识 / 哪些 Eagle 参考 / 为什么 /
 *       哪些由用户固定），支撑未来「哪类知识真的帮了设计 / 哪些从未被用到」分析。
 *
 * 审计事件（§34）：
 *   knowledge_retrieved / knowledge_pinned / visual_reference_selected / project_state_ref
 *
 * 重要语义（P0-5）：Builder 阶段只能证明「被选入本次上下文」，**不能证明「被模型读过 /
 * 进入策略 / 影响结果」**。因此这里**不发** used_in_plan / used_in_execution / cited_in_output
 * 这类「已使用」事件——那必须有下游真实消费者证据（content_loaded / 引用计数）才可签发。
 *
 * 边界：
 * - 纯函数，无 IO。只负责「从快照派生审计事件」，不负责存储。
 * - 存储/分析（SQLite / 指标）属后续 Phase；本阶段先让事件可派生、可输出。
 * - 品类（main_image/detail_page/sku）只出现在 knowledge_kind/taskType 字段，不产生分支。
 */

import type { TaskContextSnapshot, ContextItem } from './task-context.types';

/** 审计事件类型（§34 子集，聚焦「本次任务选入/使用了什么」）。 */
export type ContextAuditEventType =
    | 'knowledge_retrieved'
    | 'knowledge_pinned'
    | 'visual_reference_selected'
    | 'project_state_ref';

/** 一条上下文审计事件。 */
export interface ContextAuditEvent {
    type: ContextAuditEventType;
    taskId: string;
    resourceId: string;
    resourceType: string;
    /** 为什么被选入（来自 ContextItem.reason） */
    reason: string;
    /** 是否用户固定（来自 ContextItem.pinned） */
    pinned: boolean;
    /** 事件产生时间（ISO） */
    timestamp: string;
}

/** 从快照的检索知识条目派生审计事件。 */
function auditKnowledgeItems(taskId: string, items: ContextItem[], now: string): ContextAuditEvent[] {
    return items.map((item) => ({
        type: item.pinned ? 'knowledge_pinned' : 'knowledge_retrieved' as ContextAuditEventType,
        taskId,
        resourceId: item.resourceId,
        resourceType: item.resourceType,
        reason: item.reason,
        pinned: item.pinned,
        timestamp: now
    }));
}

/** 从快照的视觉参考条目派生审计事件（仅「选入上下文」，不是「已使用」）。 */
function auditVisualItems(taskId: string, items: ContextItem[], now: string): ContextAuditEvent[] {
    return items.map((item) => ({
        type: 'visual_reference_selected' as ContextAuditEventType,
        taskId,
        resourceId: item.resourceId,
        resourceType: item.resourceType,
        reason: item.reason,
        pinned: item.pinned,
        timestamp: now
    }));
}

/** 从快照的项目状态引用派生审计事件。 */
function auditProjectStateItems(taskId: string, items: ContextItem[], now: string): ContextAuditEvent[] {
    return items.map((item) => ({
        type: 'project_state_ref' as ContextAuditEventType,
        taskId,
        resourceId: item.resourceId,
        resourceType: item.resourceType,
        reason: item.reason,
        pinned: item.pinned,
        timestamp: now
    }));
}

/**
 * 把 TaskContextSnapshot 展开为扁平审计事件列表（纯函数）。
 * 覆盖「检索知识 + 视觉参考 + 项目状态引用 + 用户固定」，供审计日志 / 后续分析消费。
 */
export function deriveContextAuditEvents(snapshot: TaskContextSnapshot): ContextAuditEvent[] {
    const now = new Date().toISOString();
    return [
        ...auditKnowledgeItems(snapshot.taskId, snapshot.pinnedItems, now),
        ...auditKnowledgeItems(snapshot.taskId, snapshot.retrievedKnowledge, now),
        ...auditVisualItems(snapshot.taskId, snapshot.visualReferences, now),
        ...auditProjectStateItems(snapshot.taskId, snapshot.projectStateRefs, now)
    ];
}

/** 审计事件计数（用于快速质检：本次任务用到几类资源）。 */
export interface ContextAuditSummary {
    total: number;
    knowledgeRetrieved: number;
    pinned: number;
    visualReferences: number;
    projectStateRefs: number;
}

/** 汇总审计事件（纯函数，供指标展示）。 */
export function summarizeContextAudit(events: ContextAuditEvent[]): ContextAuditSummary {
    let knowledgeRetrieved = 0;
    let pinned = 0;
    let visualReferences = 0;
    let projectStateRefs = 0;
    for (const event of events) {
        if (event.pinned) pinned += 1;
        switch (event.type) {
            case 'knowledge_retrieved':
            case 'knowledge_pinned':
                knowledgeRetrieved += 1;
                break;
            case 'visual_reference_selected':
                visualReferences += 1;
                break;
            case 'project_state_ref':
                projectStateRefs += 1;
                break;
        }
    }
    return {
        total: events.length,
        knowledgeRetrieved,
        pinned,
        visualReferences,
        projectStateRefs
    };
}
