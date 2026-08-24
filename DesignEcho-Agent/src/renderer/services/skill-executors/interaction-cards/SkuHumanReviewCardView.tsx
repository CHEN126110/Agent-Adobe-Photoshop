import React, { useMemo, useState } from 'react';
import type { InteractiveCardBlock as InteractiveCardBlockType } from '../../../components/message/types';
import {
    validateSkuHumanReviewCardValue,
    type SkuHumanReviewCard,
    type SkuHumanReviewCardValue
} from '../../../../shared/sku-human-review';

interface InteractiveCardBlockProps {
    block: InteractiveCardBlockType;
    onAction?: (actionId: string, params?: Record<string, any>) => void;
}

export const SkuHumanReviewCardView: React.FC<InteractiveCardBlockProps & { card: SkuHumanReviewCard }> = ({
    block,
    card,
    onAction
}) => {
    const [decision, setDecision] = useState<SkuHumanReviewCardValue['decision']>(card.payload.initialValue.decision);
    const [reviewer, setReviewer] = useState(card.payload.initialValue.reviewer);
    const [scoreText, setScoreText] = useState(card.payload.initialValue.score === undefined
        ? ''
        : String(card.payload.initialValue.score));
    const [notesText, setNotesText] = useState(card.payload.initialValue.notes.join('\n'));
    const value = useMemo(() => ({
        decision,
        reviewer,
        score: scoreText,
        notes: notesText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
    }), [decision, reviewer, scoreText, notesText]);
    const validation = useMemo(
        () => validateSkuHumanReviewCardValue(card.payload, value),
        [card.payload, value]
    );

    const handleSubmit = () => {
        const latestValidation = validateSkuHumanReviewCardValue(card.payload, value);
        if (!latestValidation.canSubmit) return;
        onAction?.(card.submitAction || 'submitSkillInteractiveReview', {
            cardId: card.id,
            cardKind: card.kind,
            card,
            value: latestValidation.normalizedValue,
            validation: latestValidation,
            sourceBlockId: block.id
        });
    };

    return (
        <div className="message-block interactive-card-block editable-confirmation-card sku-human-review-card">
            <div className="interactive-card-header">
                <div>
                    <div className="interactive-card-title">{card.title}</div>
                    {card.description && <div className="interactive-card-description">{card.description}</div>}
                </div>
                <span className="interactive-card-status">待人工复核</span>
            </div>

            {card.payload.requirements.length > 0 && (
                <ul className="interactive-card-review-requirements">
                    {card.payload.requirements.slice(0, 6).map((requirement) => (
                        <li key={requirement}>{requirement}</li>
                    ))}
                </ul>
            )}

            <div className="editable-card-fields">
                <label className="editable-card-field">
                    <span className="editable-card-label">复核结论 *</span>
                    <select value={decision} onChange={(event) => setDecision(event.target.value as SkuHumanReviewCardValue['decision'])}>
                        <option value="needs_review">需要调整</option>
                        <option value="approved">通过</option>
                        <option value="rejected">驳回</option>
                    </select>
                </label>
                <label className="editable-card-field">
                    <span className="editable-card-label">复核人</span>
                    <input type="text" value={reviewer} onChange={(event) => setReviewer(event.target.value)} />
                </label>
                <label className="editable-card-field">
                    <span className="editable-card-label">人工评分（0 到 1）</span>
                    <input type="number" min="0" max="1" step="0.01" value={scoreText} onChange={(event) => setScoreText(event.target.value)} />
                </label>
                <label className="editable-card-field">
                    <span className="editable-card-label">复核备注</span>
                    <textarea value={notesText} onChange={(event) => setNotesText(event.target.value)} rows={3} />
                </label>
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
                    写入本批次复核记录
                </button>
            </div>
        </div>
    );
};

export function isSkuHumanReviewInteractionCard(value: unknown): value is SkuHumanReviewCard {
    const card = value && typeof value === 'object'
        ? value as Partial<SkuHumanReviewCard>
        : {};
    return card.version === 'interactive-card/v0'
        && card.kind === 'sku_human_review'
        && card.payload?.version === 'sku-human-review-card/v0';
}
