/**
 * Design Intelligence · LearningEvent 契约（Phase 0）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md §17
 * 职责：记录一次设计任务结束后的学习事件——用户指出了什么、Agent 修改了什么、
 *       差异是什么、是否接受、是否重复发生。LearningEvent 不直接写知识，
 *       而是作为「候选知识」的证据来源（经 §22 收口到 Knowledge Service）。
 *
 * 边界：
 * - 本项目只有一套 Learning Runtime；本契约是对现有 design-learning 的收口基座，
 *   不新建第二套。
 * - 纯契约，无 IO。
 */

import type { EvidenceRef } from './evidence.types';

/** 学习事件的触发来源。 */
export type LearningEventSource =
    | 'user_feedback'
    | 'critic'
    | 'execution_failure'
    | 'repeated_pattern'
    | 'project_review';

/** 学习事件的状态。 */
export type LearningEventStatus =
    | 'captured'
    | 'analyzed'
    | 'proposed_candidate'
    | 'dismissed';

export interface LearningEvent {
    id: string;
    /** 关联的任务 id（可空，若来源不来自单任务） */
    taskId?: string;

    source: LearningEventSource;

    /** 用户指出的问题 / Agent 修改了什么（自由文本摘要） */
    description: string;

    /** 修改前后差异摘要（可选） */
    beforeAfterDiff?: string;

    /** 用户是否接受本次修订（可选，三态避免误判） */
    accepted?: boolean | undefined;

    /** 该模式是否重复发生 */
    repeatedCount?: number;

    /** 关联证据（可追踪到任务 / 反馈 / 视觉版本） */
    evidenceRefs: EvidenceRef[];

    createdAt: string;
    status: LearningEventStatus;
}
