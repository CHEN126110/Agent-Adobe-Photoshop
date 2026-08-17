/**
 * Design Intelligence · Candidate Merge（Phase 4）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md
 *   §13.2 Candidate Review / Phase 4（Candidate Merge）
 *
 * 职责：纯逻辑规划「把候选知识合并进现有知识」的草稿——产出合并后的内容与版本号，
 *       供用户/授权控制器审查。合并属于 Knowledge Write 级动作，必须先过 Gate，
 *       且写入走「读 → contentHash 校验 → 原子写 → 冲突检测」一致流程。
 *
 * 边界：
 * - 本文件只产出合并计划（草稿），不直接写任何 provider。
 * - 合并不会自动升级候选状态；最终落盘仍受 Candidate Review Gate 约束。
 */

import type { KnowledgeNode } from './knowledge.types';
import type { CandidateKnowledge } from './candidate.types';

/** 一次合并的规划结果。 */
export interface CandidateMergePlan {
    /** 目标正式知识 id */
    targetKnowledgeId: string;
    /** 候选知识 id */
    candidateId: string;
    /** 合并后的正文内容（草稿，待审查） */
    mergedContent: string;
    /** 合并后的版本号 = 目标版本 + 1 */
    nextVersion: number;
    /** 依据摘要 */
    basis: string;
}

/** 判断候选是否可与目标知识合并（需与目标同 kind、同任务领域）。 */
export function isMergeable(
    node: Pick<KnowledgeNode, 'id' | 'kind' | 'applicableTaskTypes' | 'domains'>,
    candidate: Pick<CandidateKnowledge, 'id' | 'proposedKind' | 'proposedTitle' | 'proposedContent' | 'evidenceRefs' | 'confidence' | 'decision'>
): boolean {
    // 候选不能已被拒绝
    if (candidate.decision === 'rejected') return false;
    // 品类属于参数：候选需覆盖目标的任务领域（否则不该合并，而应新建）
    const taskOverlap = node.applicableTaskTypes.some((t) => candidate.proposedTitle.includes(t) || candidate.proposedContent.includes(t));
    const sameKind = node.kind === candidate.proposedKind;
    return sameKind || taskOverlap;
}

/**
 * 规划一次合并：把候选内容并入目标知识正文，追加候选证据与来源说明。
 * 仅产出草稿，不落盘。
 */
export function planCandidateMerge(
    node: KnowledgeNode,
    candidate: CandidateKnowledge
): CandidateMergePlan {
    const candidateRefs = candidate.evidenceRefs
        .map((e) => `- 证据[${e.role}]: ${e.title ?? e.locator}`)
        .join('\n');

    const mergedContent = [
        node.title,
        '',
        ...(node.scope ? [node.scope, ''] : []),
        candidate.proposedContent,
        '',
        `> 由候选 ${candidate.id} 合并而来（置信度 ${candidate.confidence}）。`,
        ...(candidateRefs ? [candidateRefs] : [])
    ].filter((s) => s !== '').join('\n');

    return {
        targetKnowledgeId: node.id,
        candidateId: candidate.id,
        mergedContent,
        nextVersion: node.version + 1,
        basis: `合并候选「${candidate.proposedTitle}」到「${node.title}」`
    };
}
