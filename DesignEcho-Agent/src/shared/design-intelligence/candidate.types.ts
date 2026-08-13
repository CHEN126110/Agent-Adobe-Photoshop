/**
 * Design Intelligence · CandidateKnowledge 契约（Phase 0）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md §5.3
 * 职责：把「Agent / 用户 / 学习」提出的候选知识与正式知识分开。Agent 默认无权直接把
 *       候选知识升级为已验证核心知识——必须经过明确 Review Gate。
 *
 * 边界：
 * - Candidate 产生后可接受 / 继续观察 / 合并到现有知识 / 拒绝。
 * - 只有「接受」后才允许 write → Obsidian Vault（或对应 provider）。
 * - 纯契约，无 IO。
 */

import type { KnowledgeKind } from './knowledge.types';
import type { EvidenceRef } from './evidence.types';

/** 候选知识的产生来源。 */
export type CandidateOrigin =
    | 'user_note'
    | 'task_feedback'
    | 'critic'
    | 'external_source'
    | 'knowledge_conflict'
    | 'brainstorm';

/** 候选知识的审查决策状态。 */
export type CandidateDecision =
    | 'pending'
    | 'accepted'
    | 'continue_observing'
    | 'rejected';

export interface CandidateKnowledge {
    id: string;

    proposedKind: KnowledgeKind;
    proposedTitle: string;
    proposedContent: string;

    evidenceRefs: EvidenceRef[];

    generatedFrom: CandidateOrigin;

    /** 0~1 置信度 */
    confidence: number;

    decision: CandidateDecision;

    /** 若「合并到现有知识」，指向目标 KnowledgeNode id */
    targetKnowledgeId?: string;
}

/** 判断候选是否可写回（只有 accepted 才允许进入正式知识 Gate）。 */
export function isCandidateAccepted(candidate: Pick<CandidateKnowledge, 'decision'>): boolean {
    return candidate.decision === 'accepted';
}
