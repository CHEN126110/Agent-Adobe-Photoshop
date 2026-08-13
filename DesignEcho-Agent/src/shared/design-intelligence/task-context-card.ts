/**
 * Design Intelligence · Task Context 展示卡片契约（Phase 1 · DI-009）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md
 *   §27 UI 信息架构 / §28 Agent 右侧交互（上下文页面）
 *
 * 职责：把 TaskContextSnapshot 单向映射为只读展示视图，供 UI 呈现"本次任务用了哪些
 *       知识 / 哪些视觉参考 / 哪些由用户固定 / 关联项目状态"，并给出"为什么加入"。
 *
 * 硬约束（对齐 GPT 混合方案）：
 * - 复用 InteractiveCardDefinition 外壳，但建独立强类型、可判别契约（kind 命名空间化）。
 * - **卡片只展示，不回写权威数据**：TaskContextSnapshot 仍是唯一权威数据源，卡片不可反向
 *   成为 Context / Project State / Artifact 的数据源。
 * - 纯逻辑：只做契约定义与领域→展示映射，不触发 UI、不写状态。
 */

import type { InteractiveCardDefinition } from '../interactive-card-contract';
import type { TaskContextSnapshot, ContextItem } from './task-context.types';

/** 卡片提交统一窄入口（本卡片只读，无提交动作）。 */
export const TASK_CONTEXT_CARD_SUBMIT_ACTION = 'viewTaskContext';

/** 命名空间化的卡片 kind。 */
export type TaskContextCardKind = 'design-intelligence.task-context';

/** 一个展示条目的视图（从 ContextItem 单向映射，不含产品事实文案）。 */
export interface TaskContextCardItemView {
    resourceId: string;
    resourceType: string;
    title?: string;
    excerpt?: string;
    sourceLabel?: string;
    lifecycle?: string;
    reason: string;
    pinned: boolean;
    priority: string;
}

/** 卡片 payload：从 TaskContextSnapshot 派生的只读展示视图。 */
export interface TaskContextCardPayload {
    taskId: string;
    hardConstraints: TaskContextCardItemView[];
    pinned: TaskContextCardItemView[];
    retrievedKnowledge: TaskContextCardItemView[];
    visualReferences: TaskContextCardItemView[];
    projectStateRefs: TaskContextCardItemView[];
    knowledgeIndexVersion: string;
}

/** 从 TaskContextSnapshot 派生只读展示视图（纯函数）。 */
export function buildTaskContextCardView(snapshot: TaskContextSnapshot): TaskContextCardPayload {
    const toView = (item: ContextItem): TaskContextCardItemView => ({
        resourceId: item.resourceId,
        resourceType: item.resourceType,
        ...(item.title ? { title: item.title } : {}),
        ...(item.excerpt ? { excerpt: item.excerpt } : {}),
        ...(item.sourceLabel ? { sourceLabel: item.sourceLabel } : {}),
        ...(item.lifecycle ? { lifecycle: item.lifecycle } : {}),
        reason: item.reason,
        pinned: item.pinned,
        priority: item.priority
    });

    return {
        taskId: snapshot.taskId,
        hardConstraints: snapshot.hardConstraints.map(toView),
        pinned: snapshot.pinnedItems.map(toView),
        retrievedKnowledge: snapshot.retrievedKnowledge.map(toView),
        visualReferences: snapshot.visualReferences.map(toView),
        projectStateRefs: snapshot.projectStateRefs.map(toView),
        knowledgeIndexVersion: snapshot.knowledgeIndexVersion
    };
}

/** 构造 task-context 展示卡片（复用 InteractiveCardDefinition 外壳）。 */
export function buildTaskContextCard(snapshot: TaskContextSnapshot): InteractiveCardDefinition<TaskContextCardPayload> {
    return {
        version: 'interactive-card/v0',
        id: `task-context-${snapshot.id}`,
        kind: 'design-intelligence.task-context',
        title: '本次任务使用的知识上下文',
        description: '列出本次设计任务检索到的知识、视觉参考、用户固定内容与关联项目状态；只读展示。',
        payload: buildTaskContextCardView(snapshot),
        submitAction: TASK_CONTEXT_CARD_SUBMIT_ACTION,
        memoryPolicy: { enabled: false, mode: 'none' }
    };
}
