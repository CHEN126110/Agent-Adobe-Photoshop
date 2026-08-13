/**
 * Design Intelligence · Proposition Ledger（Phase 6）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md
 *   §18 Brainstorm / Knowledge Gap / §19 外部世界更新 / Phase 6
 *
 * 职责：把「外部信号 / 知识缺口」沉淀为可演进的命题（Proposition），
 *       通过明确状态机推进，仅当命题达到 user_confirmed 才允许生成 Candidate Knowledge。
 *       External Signal 不直接成为知识——必须经过
 *       Signal → Evidence → Candidate → Review → Knowledge。
 *
 * 边界：
 * - 纯逻辑状态机 + 契约，无 IO。
 * - 命题本身不是知识；只有 user_confirmed 之后才生成 candidate（decision=pending，仍需 Review Gate）。
 * - Agent 不能把命题直接升级为 Validated——最终写入仍需用户确认。
 */

import type { ExternalSignal } from './external-signal.types';
import type { CandidateKnowledge, CandidateOrigin } from './candidate.types';
import type { EvidenceRef } from './evidence.types';

/** 命题状态（§18 推荐状态）。 */
export type PropositionState =
    | 'unsupported'
    | 'supported'
    | 'supported_with_gaps'
    | 'conflicting'
    | 'revised'
    | 'user_confirmed';

/** 一条命题。 */
export interface Proposition {
    id: string;
    /** 命题断言（主张） */
    claim: string;
    /** 支撑的外部信号 id */
    signalRefs: string[];
    /** 支撑证据（可追溯） */
    evidenceRefs: EvidenceRef[];
    state: PropositionState;
    /** 命题被提出/最近修订时间 */
    updatedAt: string;
}

/** 允许推进命题的用户决策。 */
export type PropositionDecision =
    | 'found_evidence'
    | 'found_gaps'
    | 'found_conflict'
    | 'revise'
    | 'confirm'
    | 'reject';

/**
 * 用户确认收据（P0-4：不让「confirm」被任意调用者伪造）。
 *
 * 纯函数只能校验收据的**存在与形状**，无法自证真实性；真实用户动作必须由
 * 主进程 Owner 校验（sourceMessageId 对应的 UI 动作、一次性 token、未过期、未重复消费），
 * 校验通过后才把这份收据传给 advanceProposition。没有有效收据的 confirm 一律拒绝。
 */
export interface UserConfirmationReceipt {
    actor: 'user';
    /** 触发确认的 UI 消息/动作 id（主进程据此核对真实用户点击） */
    sourceMessageId: string;
    /** 主进程签发时间（ISO） */
    issuedAt: string;
    /** 被确认命题的版本（防止确认的是旧版本） */
    propositionRevision: number;
    /** 一次性 token（主进程签发，消费一次即失效） */
    token: string;
}

/** 校验收据形状是否完整（真实性由主进程 Owner 验证）。 */
export function isWellFormedUserConfirmationReceipt(receipt: unknown): receipt is UserConfirmationReceipt {
    if (!receipt || typeof receipt !== 'object') return false;
    const r = receipt as Record<string, unknown>;
    return r.actor === 'user'
        && typeof r.sourceMessageId === 'string' && r.sourceMessageId.length > 0
        && typeof r.issuedAt === 'string' && r.issuedAt.length > 0
        && typeof r.propositionRevision === 'number' && Number.isFinite(r.propositionRevision)
        && typeof r.token === 'string' && r.token.length > 0;
}

/** 状态机迁移（确定性）。confirm 必须携带用户确认收据，否则拒绝推进到 user_confirmed。 */
export function advanceProposition(
    prop: Proposition,
    decision: PropositionDecision,
    updatedAt: string,
    confirmationReceipt?: UserConfirmationReceipt
): Proposition {
    let state = prop.state;
    switch (decision) {
        case 'found_evidence':
            state = 'supported';
            break;
        case 'found_gaps':
            state = 'supported_with_gaps';
            break;
        case 'found_conflict':
            state = 'conflicting';
            break;
        case 'revise':
            state = 'revised';
            break;
        case 'confirm':
            // 仅 supported / supported_with_gaps / revised 可被确认；且必须持有效用户确认收据。
            if (!isWellFormedUserConfirmationReceipt(confirmationReceipt)) {
                throw new Error('proposition_confirm_requires_user_receipt:缺少或无效的用户确认收据');
            }
            state = state === 'conflicting' || state === 'unsupported' ? state : 'user_confirmed';
            break;
        case 'reject':
            state = 'unsupported';
            break;
        default:
            break;
    }
    return { ...prop, state, updatedAt };
}

/** 一条命题当前是否可被用户确认（conflicting/unsupported 需先解决矛盾）。 */
export function isConfirmable(state: PropositionState): boolean {
    return state === 'supported' || state === 'supported_with_gaps' || state === 'revised';
}

/** 只有 user_confirmed 的命题才允许生成候选知识。 */
export function canBuildCandidateFromProposition(prop: Pick<Proposition, 'state'>): boolean {
    return prop.state === 'user_confirmed';
}

/** 从已确认的命题生成候选知识（decision=pending，仍需 Review Gate；Agent 无权自升级）。 */
export function buildCandidateFromConfirmedProposition(prop: Proposition): CandidateKnowledge | null {
    if (!canBuildCandidateFromProposition(prop)) return null;

    const origin: CandidateOrigin = 'external_source';
    const evidenceRefs = prop.evidenceRefs.length > 0
        ? prop.evidenceRefs
        : prop.signalRefs.map((locator, i): EvidenceRef => ({
              id: `sig-${locator}-${i}`,
              provider: 'web',
              locator,
              role: 'source'
          }));

    return {
        id: `cand-prop-${prop.id}`,
        proposedKind: 'research',
        proposedTitle: `命题：${prop.claim}`,
        proposedContent: prop.claim,
        evidenceRefs,
        generatedFrom: origin,
        confidence: 0.7,
        decision: 'pending'
    };
}

/** 便捷：由一组外部信号建一条初始「无支撑」命题（尚未确认，不可作为知识）。
 * 注意（P0-4）：信号只登记为 signalRefs，**不在此处包装成 EvidenceRef**——
 * 只有经独立证据验证阶段确认后，信号才可提升为证据，守住
 * Signal → Evidence → Candidate → Review → Knowledge 的层级。 */
export function createPropositionFromSignals(
    id: string,
    claim: string,
    signals: readonly ExternalSignal[],
    updatedAt: string
): Proposition {
    return {
        id,
        claim,
        signalRefs: signals.map((s) => s.id),
        evidenceRefs: [],
        state: 'unsupported',
        updatedAt
    };
}
