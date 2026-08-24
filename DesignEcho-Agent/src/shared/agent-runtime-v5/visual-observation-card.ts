/**
 * 视觉观察不足时的展示卡片契约。
 *
 * 契约分层：
 * - 领域契约：VisualObservationBlocker（gate）——权威数据。
 * - 展示契约（本文件）：由领域契约**单向映射**得到的只读展示视图。
 * - 通用外壳：InteractiveCardDefinition（interactive-card-contract）——通用 UI 运输与提交机制。
 *
 * 硬约束（按 GPT 决策）：
 * - 复用 InteractiveCardDefinition 外壳与 submitAction 提交机制，但为两类卡片建独立强类型、可判别契约；
 *   kind 命名空间化（visual-observation.blocked），不复用泛化的 confirm/edit/blocked。
 * - **禁止卡片反向成为 ContextSnapshot / Project State / Artifact 的数据源**：卡片只展示，不回写权威数据。
 *
 * 纯逻辑：只做契约定义与领域→展示的映射，不触发 UI、不写状态。
 */

import type { InteractiveCardDefinition } from '../interactive-card-contract';
import type { VisualObservationBlocker } from './visual-observation-gate';

/** 卡片提交统一窄入口（复用现有 submitInteractiveCard 分发）。 */
export const VISUAL_OBSERVATION_CARD_SUBMIT_ACTION = 'submitVisualObservationCard';

/** 命名空间化的卡片 kind（避免与现有 confirm/edit 卡片冲突）。 */
export type VisualObservationCardKind = 'visual-observation.blocked';

/** 当前 UI 暴露的两种真实恢复动作。 */
export type VisualObservationCardActionId =
    | 'RUN_PROJECT_VISUAL_ANALYSIS'
    | 'SELECT_PRODUCT_IMAGES';

/** 一个卡片动作（按钮）。state=disabled 时必须给 disabledReason。 */
export interface VisualObservationCardAction {
    actionId: VisualObservationCardActionId;
    label: string;
    state: 'enabled' | 'disabled';
    disabledReason?: { code: string; message: string };
}

/** 卡片上下文（机器标识，便于回链；不承载产品事实）。 */
export interface VisualObservationCardContext {
    projectId: string;
    conversationId: string;
    taskType: string;
    sourceRevision: number;
}

/** blocked 卡片 payload：只放阻断器（领域契约的只读副本）。 */
export interface VisualObservationBlockedCardPayload {
    blocker: VisualObservationBlocker;
}

/** 视觉观察卡片：复用 InteractiveCardDefinition 外壳 + 强类型 kind/context/actions。 */
export interface VisualObservationCard<TKind extends VisualObservationCardKind, TPayload>
    extends InteractiveCardDefinition<TPayload> {
    kind: TKind;
    context: VisualObservationCardContext;
    actions: VisualObservationCardAction[];
}

export type VisualObservationBlockedCard = VisualObservationCard<'visual-observation.blocked', VisualObservationBlockedCardPayload>;

/**
 * 构造"视觉观察不足"阻断卡片（两种真实恢复动作）。
 * "分析项目图片"按钮的可用性由 visualBootstrapReady 决定——P0 Main 视觉服务未就绪时禁用并给理由。
 */
export function buildVisualObservationBlockedCard(input: {
    blocker: VisualObservationBlocker;
    context: VisualObservationCardContext;
    visualBootstrapReady: boolean;
}): VisualObservationBlockedCard {
    const analyzeDisabled = !input.visualBootstrapReady;
    return {
        version: 'interactive-card/v0',
        id: `visual-observation-blocked:${input.context.projectId}:${input.context.sourceRevision}`,
        kind: 'visual-observation.blocked',
        title: '需要先看过产品图片',
        description: input.blocker.message,
        context: input.context,
        payload: { blocker: input.blocker },
        actions: [
            {
                actionId: 'RUN_PROJECT_VISUAL_ANALYSIS',
                label: '分析项目图片',
                state: analyzeDisabled ? 'disabled' : 'enabled',
                disabledReason: analyzeDisabled
                    ? { code: 'VISUAL_BOOTSTRAP_NOT_READY', message: '图片分析服务正在接入。当前可以选择代表图片，由 Agent 基于真实素材继续判断。' }
                    : undefined
            },
            { actionId: 'SELECT_PRODUCT_IMAGES', label: '选择代表图片', state: 'enabled' }
        ],
        submitAction: VISUAL_OBSERVATION_CARD_SUBMIT_ACTION
    };
}
