import React, { useMemo, useState } from 'react';
import type { InteractiveCardBlock as InteractiveCardBlockType } from '../types';
import type { EditableConfirmationCard } from '../../../../shared/editable-confirmation-interactive-card';
import {
    type VisualObservationBlockedCard
} from '../../../../shared/agent-runtime-v5/visual-observation-card';
import {
    type PendingDestructiveActionCard
} from '../../../../shared/pending-destructive-action-card';
import {
    validateDesignProjectFactReviewCardValue,
    type DesignProjectFactReviewCard,
    type DesignProjectFactReviewCardValue
} from '../../../../shared/design-project-fact-review-card';
import {
    validateDesignProjectRuleReviewCardValue,
    type DesignProjectRuleReviewCard,
    type DesignProjectRuleReviewCardValue
} from '../../../../shared/design-project-rule-review-card';
import { TaskContextCardView } from './TaskContextCardView';
import { UserChoiceCardView } from './UserChoiceCardView';
import type { UserChoiceRequest } from '../../../../shared/user-choice-request';
import type { TaskContextCardPayload } from '../../../../shared/design-intelligence/task-context-card';
import type { InteractiveCardDefinition } from '../../../../shared/interactive-card-contract';
import { renderSkillInteractiveCard } from '../../../services/skill-executors/interaction-cards/renderer';
import { EditableConfirmationCardView } from './EditableConfirmationCardView';

interface InteractiveCardBlockProps {
    block: InteractiveCardBlockType;
    onAction?: (actionId: string, params?: Record<string, any>) => void;
}

const DesignProjectFactReviewCardView: React.FC<InteractiveCardBlockProps & { card: DesignProjectFactReviewCard }> = ({
    block,
    card,
    onAction
}) => {
    const [decisions, setDecisions] = useState<Record<string, DesignProjectFactReviewCardValue['decisions'][number]['decision']>>(
        () => Object.fromEntries(card.payload.facts.map((fact) => [fact.factId, 'needs_review']))
    );
    const value = useMemo<DesignProjectFactReviewCardValue>(() => ({
        decisions: card.payload.facts.map((fact) => ({
            factId: fact.factId,
            decision: decisions[fact.factId] || 'needs_review'
        }))
    }), [card.payload.facts, decisions]);
    const validation = useMemo(
        () => validateDesignProjectFactReviewCardValue(card.payload, value),
        [card.payload, value]
    );

    const handleSubmit = () => {
        const latestValidation = validateDesignProjectFactReviewCardValue(card.payload, value);
        if (!latestValidation.canSubmit) return;
        onAction?.(card.submitAction || 'submitDesignProjectFactReviewCard', {
            cardId: card.id,
            cardKind: card.kind,
            card,
            value: latestValidation.normalizedValue,
            validation: latestValidation,
            sourceBlockId: block.id
        });
    };

    return (
        <div className="message-block interactive-card-block editable-confirmation-card design-project-fact-review-card">
            <div className="interactive-card-header">
                <div>
                    <div className="interactive-card-title">{card.title}</div>
                    {card.description && <div className="interactive-card-description">{card.description}</div>}
                </div>
                <span className="interactive-card-status">待事实确认</span>
            </div>

            <div className="editable-card-fields">
                {card.payload.facts.map((fact) => (
                    <label className="editable-card-field" key={fact.factId}>
                        <span className="editable-card-label">
                            {fact.claimType === 'product_fact' ? '产品事实' : '卖点'}：{fact.statement}
                        </span>
                        <span className="editable-card-help">来源：{fact.sourceKinds.map(formatFactSourceKind).join('、')}</span>
                        <select
                            value={decisions[fact.factId] || 'needs_review'}
                            onChange={(event) => setDecisions((current) => ({
                                ...current,
                                [fact.factId]: event.target.value as DesignProjectFactReviewCardValue['decisions'][number]['decision']
                            }))}
                        >
                            <option value="needs_review">暂不确认</option>
                            <option value="confirm">确认属实</option>
                            <option value="reject">驳回</option>
                        </select>
                    </label>
                ))}
            </div>

            {validation.issues.length > 0 && (
                <div className="interactive-card-issues">
                    {validation.issues.slice(0, 5).map((issue, index) => (
                        <div key={`${issue.code}-${index}`} className={`interactive-card-issue ${issue.severity}`}>
                            {issue.message}
                        </div>
                    ))}
                </div>
            )}

            <div className="interactive-card-actions">
                <button type="button" className="interactive-card-submit" disabled={!validation.canSubmit} onClick={handleSubmit}>
                    写入事实复核结论
                </button>
            </div>
        </div>
    );
};

const DesignProjectRuleReviewCardView: React.FC<InteractiveCardBlockProps & { card: DesignProjectRuleReviewCard }> = ({
    block,
    card,
    onAction
}) => {
    const [decisions, setDecisions] = useState<Record<string, DesignProjectRuleReviewCardValue['decisions'][number]['decision']>>(
        () => Object.fromEntries(card.payload.rules.map((rule) => [rule.ruleId, 'needs_review']))
    );
    const value = useMemo<DesignProjectRuleReviewCardValue>(() => ({
        decisions: card.payload.rules.map((rule) => ({
            ruleId: rule.ruleId,
            decision: decisions[rule.ruleId] || 'needs_review'
        }))
    }), [card.payload.rules, decisions]);
    const validation = useMemo(
        () => validateDesignProjectRuleReviewCardValue(card.payload, value),
        [card.payload, value]
    );

    const handleSubmit = () => {
        const latestValidation = validateDesignProjectRuleReviewCardValue(card.payload, value);
        if (!latestValidation.canSubmit) return;
        onAction?.(card.submitAction || 'submitDesignProjectRuleReviewCard', {
            cardId: card.id,
            cardKind: card.kind,
            card,
            value: latestValidation.normalizedValue,
            validation: latestValidation,
            sourceBlockId: block.id
        });
    };

    return (
        <div className="message-block interactive-card-block editable-confirmation-card design-project-rule-review-card">
            <div className="interactive-card-header">
                <div>
                    <div className="interactive-card-title">{card.title}</div>
                    {card.description && <div className="interactive-card-description">{card.description}</div>}
                </div>
                <span className="interactive-card-status">待规则确认</span>
            </div>
            <div className="editable-card-fields">
                {card.payload.rules.map((rule) => (
                    <label className="editable-card-field" key={rule.ruleId}>
                        <span className="editable-card-label">{formatRuleKind(rule.ruleKind)}：{rule.statement}</span>
                        <span className="editable-card-help">
                            强制等级：{formatRuleEnforcement(rule.enforcement)}；来源：{rule.sourceKinds.map(formatRuleSourceKind).join('、')}
                        </span>
                        <select
                            value={decisions[rule.ruleId] || 'needs_review'}
                            onChange={(event) => setDecisions((current) => ({
                                ...current,
                                [rule.ruleId]: event.target.value as DesignProjectRuleReviewCardValue['decisions'][number]['decision']
                            }))}
                        >
                            <option value="needs_review">暂不确认</option>
                            <option value="confirm">确认规则</option>
                            <option value="reject">驳回规则</option>
                        </select>
                    </label>
                ))}
            </div>
            {validation.issues.length > 0 && (
                <div className="interactive-card-issues">
                    {validation.issues.slice(0, 5).map((issue, index) => (
                        <div key={`${issue.code}-${index}`} className={`interactive-card-issue ${issue.severity}`}>{issue.message}</div>
                    ))}
                </div>
            )}
            <div className="interactive-card-actions">
                <button type="button" className="interactive-card-submit" disabled={!validation.canSubmit} onClick={handleSubmit}>
                    写入规则复核结论
                </button>
            </div>
        </div>
    );
};

function formatFactSourceKind(value: string): string {
    if (value === 'user_statement') return '用户陈述';
    if (value === 'project_asset_observation') return '项目素材观察';
    if (value === 'product_document') return '产品文档';
    if (value === 'brand_guideline') return '品牌规范';
    if (value === 'market_research') return '市场研究';
    if (value === 'agent_inference') return 'Agent 推断';
    return '旧状态（来源不明）';
}

function formatRuleKind(value: string): string {
    const labels: Record<string, string> = {
        visual_style: '视觉风格', color: '色彩', typography: '排版', copy_tone: '文案语气',
        asset_integrity: '素材真实性', forbidden_expression: '禁用表达', delivery: '交付', workflow: '工作方式'
    };
    return labels[value] || value;
}

function formatRuleEnforcement(value: string): string {
    if (value === 'quality_gate') return '质量门禁';
    if (value === 'approval_required') return '交付前审批';
    return '设计参考';
}

function formatRuleSourceKind(value: string): string {
    const labels: Record<string, string> = {
        user_statement: '用户陈述', brand_guideline: '品牌规范', project_brief: '项目简报',
        design_memory: '设计记忆', agent_inference: 'Agent 推断', legacy_brand_style: '旧品牌风格'
    };
    return labels[value] || value;
}

const VisualObservationBlockedCardView: React.FC<InteractiveCardBlockProps & { card: VisualObservationBlockedCard }> = ({
    card,
    onAction
}) => {
    return (
        <div className="message-block interactive-card-block visual-observation-blocked-card">
            <div className="interactive-card-header">
                <div>
                    <div className="interactive-card-title">{card.title}</div>
                    {card.description && (
                        <div className="interactive-card-description">{card.description}</div>
                    )}
                </div>
            </div>
            <div className="interactive-card-actions visual-observation-card-actions">
                {card.actions.map((action) => {
                    const disabled = action.state === 'disabled';
                    return (
                        <button
                            key={action.actionId}
                            type="button"
                            className="interactive-card-action-button"
                            disabled={disabled}
                            title={disabled ? action.disabledReason?.message : undefined}
                            onClick={() => {
                                if (disabled) return;
                                onAction?.(card.submitAction || 'submitInteractiveCard', {
                                    cardId: card.id,
                                    cardKind: card.kind,
                                    card,
                                    value: { actionId: action.actionId }
                                });
                            }}
                        >
                            {action.label}{disabled ? '（即将可用）' : ''}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

const PendingDestructiveActionCardView: React.FC<InteractiveCardBlockProps & { card: PendingDestructiveActionCard }> = ({
    card,
    onAction
}) => {
    return (
        <div className="message-block interactive-card-block destructive-action-card">
            <div className="interactive-card-header">
                <div>
                    <div className="interactive-card-title">{card.title}</div>
                    {card.description && (
                        <div className="interactive-card-description">{card.description}</div>
                    )}
                </div>
                <span className="interactive-card-status">待确认</span>
            </div>
            <div className="interactive-card-actions destructive-action-card-actions">
                {card.actions.map((action) => (
                    <button
                        key={action.actionId}
                        type="button"
                        className={`interactive-card-action-button ${action.intent === 'confirm' ? 'is-destructive-confirm' : 'is-cancel'}`}
                        onClick={() => onAction?.(card.submitAction || 'submitDestructiveActionCard', {
                            cardId: card.id,
                            cardKind: card.kind,
                            card,
                            value: { actionId: action.actionId }
                        })}
                    >
                        {action.label}
                    </button>
                ))}
            </div>
        </div>
    );
};

export const InteractiveCardBlock: React.FC<InteractiveCardBlockProps> = ({ block, onAction }) => {
    const card = block.card;
    if (block.submission) {
        const execution = block.submission.execution;
        let description = '确认内容已提交。';
        let statusLabel = '已提交';
        if (execution?.status === 'succeeded') {
            description = execution.message || '确认内容已执行完成。';
            statusLabel = '已完成';
        } else if (execution?.status === 'failed') {
            description = execution.message || '操作在 Photoshop 写入前校验失败，未开始写入；可以重新发起任务。';
            statusLabel = '执行失败';
        } else if (execution?.status === 'unknown') {
            description = execution.message || '执行状态不确定，请先检查 Photoshop；系统不会自动重放。';
            statusLabel = '待复核';
        }
        return (
            <div className="message-block interactive-card-block is-submitted">
                <div className="interactive-card-header">
                    <div>
                        <div className="interactive-card-title">{card.title}</div>
                        <div className="interactive-card-description">{description}</div>
                    </div>
                    <span className="interactive-card-status">{statusLabel}</span>
                </div>
            </div>
        );
    }
    const handleAction = (actionId: string, params?: Record<string, any>): void => {
        onAction?.(actionId, {
            ...(params || {}),
            sourceMessageId: block.sourceMessageId
        });
    };
    if (card.kind === 'user_choice' && (card.payload as any)?.version === 'user-choice-request/v2') {
        return <UserChoiceCardView block={block} card={card as InteractiveCardDefinition<UserChoiceRequest>} onAction={handleAction} />;
    }
    const skillCard = renderSkillInteractiveCard({ block, onAction: handleAction });
    if (skillCard) return skillCard;
    if (card.kind === 'editable_confirmation' && (card.payload as any)?.version === 'editable-confirmation/v0') {
        return <EditableConfirmationCardView block={block} card={card as EditableConfirmationCard} onAction={handleAction} />;
    }
    if (card.kind === 'design_project_fact_review' && (card.payload as any)?.version === 'design-project-fact-review-card/v0') {
        return <DesignProjectFactReviewCardView block={block} card={card as DesignProjectFactReviewCard} onAction={handleAction} />;
    }
    if (card.kind === 'design_project_rule_review' && (card.payload as any)?.version === 'design-project-rule-review-card/v0') {
        return <DesignProjectRuleReviewCardView block={block} card={card as DesignProjectRuleReviewCard} onAction={handleAction} />;
    }
    if (card.kind === 'visual-observation.blocked') {
        return <VisualObservationBlockedCardView block={block} card={card as unknown as VisualObservationBlockedCard} onAction={handleAction} />;
    }
    if (card.kind === 'design-intelligence.task-context') {
        return <TaskContextCardView block={block} card={card as unknown as InteractiveCardDefinition<TaskContextCardPayload>} onAction={handleAction} />;
    }
    if (card.kind === 'destructive-action.confirmation') {
        return <PendingDestructiveActionCardView block={block} card={card as unknown as PendingDestructiveActionCard} onAction={handleAction} />;
    }

    return (
        <div className="message-block interactive-card-block">
            <div className="interactive-card-header">
                <div>
                    <div className="interactive-card-title">{card.title}</div>
                    {card.description && (
                        <div className="interactive-card-description">{card.description}</div>
                    )}
                </div>
            </div>
            <div className="interactive-card-description">
                当前版本无法识别这张确认卡，未执行任何操作；请重新生成。
            </div>
        </div>
    );
};

export default InteractiveCardBlock;
