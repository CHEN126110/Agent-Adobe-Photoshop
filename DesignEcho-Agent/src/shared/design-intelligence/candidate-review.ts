/**
 * Design Intelligence · Candidate Review 控制器（Phase 2 · DI-02x）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md
 *   §13.2 Candidate Review / §33 安全与权限
 *
 * 职责：强制「Candidate 无法绕过 Gate 变成 Validated」：
 * - Candidate 只有被明确「接受」（accepted）后，才允许进入正式知识的 Knowledge Write Gate。
 * - 「接受」必须来自有权决策方（用户 / 已授权的确定性控制器），Agent 不能自行升级。
 * - 拒绝 / 继续观察 / 合并到现有知识，都不会产生 Validated 写入。
 *
 * 边界：
 * - 纯逻辑，无 IO。只判定「能否升级」，不负责实际写入（写入仍走 knowledge-writeback-contract）。
 * - 升级后的正式写回仍必须过 requiresKnowledgeGate + requiresUserConfirmation（Destructive 级）。
 */

import type { CandidateKnowledge, CandidateDecision } from './candidate.types';
import { requiresKnowledgeGate, type KnowledgeWriteAction } from './knowledge-writeback-contract';
import {
    isWellFormedUserConfirmationReceipt,
    type UserConfirmationReceipt
} from './proposition-ledger';

/** 升级决策的提出方（谁有权决定把候选升为正式知识）。 */
export type CandidateReviewer = 'user' | 'authorized_controller' | 'agent';

/** 对单个候选的审查请求。 */
export interface CandidateReviewRequest {
    candidate: CandidateKnowledge;
    decision: CandidateDecision;
    reviewer: CandidateReviewer;
    /**
     * 用户「接受」必须携带主进程签发的确认收据（P0-4）。
     * 纯函数只校验收据形状；真实性由主进程 Owner 校验（sourceMessageId 对应 UI 动作、
     * 一次性 token、未重复消费）。reviewer='user' 但无有效收据 → 拒绝。
     */
    confirmationReceipt?: UserConfirmationReceipt;
    /** accepted 时目标正式知识的写回动作（须为 Knowledge Write 级） */
    writeAction?: KnowledgeWriteAction;
    /** 合并到现有知识时的目标 id */
    mergeTargetId?: string;
}

/** 审查结果。 */
export type CandidateReviewResult =
    | { ok: true; decision: 'accepted'; writeAction: KnowledgeWriteAction }
    | { ok: true; decision: 'continue_observing' | 'rejected' }
    | { ok: false; code: 'agent_cannot_self_accept' | 'accepted_requires_gated_write' | 'user_accept_requires_receipt' | 'invalid_decision'; message: string };

/**
 * 裁决一次候选审查（核心 Gate）：
 * - Agent 不能自行把候选升级为 Validated（必须先经用户/授权控制器「接受」）。
 * - reviewer='user' 的「接受」必须携带主进程签发的有效确认收据，否则拒绝。
 * - 只有 decision=accepted 才允许产生正式写回，且写回动作必须是 Knowledge Write 级。
 * - continue_observing / rejected 不产生任何升级。
 */
export function reviewCandidate(request: CandidateReviewRequest): CandidateReviewResult {
    const { candidate, decision, reviewer, writeAction, confirmationReceipt } = request;

    if (decision === 'accepted') {
        if (reviewer === 'agent') {
            return {
                ok: false,
                code: 'agent_cannot_self_accept',
                message: 'Agent 不能自行把候选升级为已验证知识，须先经用户或授权控制器接受。'
            };
        }
        if (reviewer === 'user' && !isWellFormedUserConfirmationReceipt(confirmationReceipt)) {
            return {
                ok: false,
                code: 'user_accept_requires_receipt',
                message: '用户「接受」必须携带主进程签发的有效确认收据，不能由调用者自报 reviewer=user。'
            };
        }
        if (!writeAction || !requiresKnowledgeGate(writeAction)) {
            return {
                ok: false,
                code: 'accepted_requires_gated_write',
                message: '接受候选必须通过 Knowledge Write 级 Gate（如 upgrade_status / merge），不能直接写入。'
            };
        }
        if (candidate.decision === 'rejected') {
            return {
                ok: false,
                code: 'invalid_decision',
                message: '不能接受一个已被拒绝的候选。'
            };
        }
        return { ok: true, decision: 'accepted', writeAction };
    }

    if (decision === 'continue_observing' || decision === 'rejected') {
        return { ok: true, decision };
    }

    return {
        ok: false,
        code: 'invalid_decision',
        message: `未知决策：${String(decision)}`
    };
}

/** 便捷：判断候选当前是否「可进入正式写回」。（Candidate 无法绕过 Gate） */
export function candidateCanReachValidated(candidate: Pick<CandidateKnowledge, 'decision'>): boolean {
    // 只有曾「接受」且未被推翻的候选才可能进一步写回；单纯 pending/rejected 均不可。
    return isAcceptedOrPreviouslyAccepted(candidate);
}

function isAcceptedOrPreviouslyAccepted(candidate: Pick<CandidateKnowledge, 'decision'>): boolean {
    // 控制器层面：候选当前决策为 accepted 才视为可进入正式 Gate。
    return candidate.decision === 'accepted';
}