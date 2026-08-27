import React, { useMemo, useState } from 'react';

import {
    validateEditableConfirmationValue,
    type EditableConfirmationCard,
    type EditableConfirmationValue
} from '../../../../shared/editable-confirmation-interactive-card';
import type { InteractiveCardBlock as InteractiveCardBlockType } from '../types';

export interface EditableConfirmationCardViewProps {
    block: InteractiveCardBlockType;
    card: EditableConfirmationCard;
    onAction?: (actionId: string, params?: Record<string, any>) => void;
}

function buildEditableInitialValue(card: EditableConfirmationCard): EditableConfirmationValue {
    return card.payload.initialValue || {
        values: Object.fromEntries(card.payload.fields.map((field) => [
            field.id,
            field.type === 'boolean' ? Boolean(field.value) : String(field.value || '')
        ]))
    };
}

export const EditableConfirmationCardView: React.FC<EditableConfirmationCardViewProps> = ({
    block,
    card,
    onAction
}) => {
    const [values, setValues] = useState<Record<string, string | boolean>>(
        () => buildEditableInitialValue(card).values || {}
    );
    const value = useMemo<EditableConfirmationValue>(() => ({ values }), [values]);
    const validation = useMemo(
        () => validateEditableConfirmationValue(card.payload, value),
        [card.payload, value]
    );

    function updateValue(fieldId: string, nextValue: string | boolean): void {
        setValues((current) => ({
            ...current,
            [fieldId]: nextValue
        }));
    }

    function handleSubmit(): void {
        const latestValue = { values };
        const latestValidation = validateEditableConfirmationValue(card.payload, latestValue);
        if (!latestValidation.canSubmit) return;
        onAction?.(card.submitAction || 'submitInteractiveCard', {
            cardId: card.id,
            cardKind: card.kind,
            card,
            value: latestValidation.normalizedValue,
            validation: latestValidation,
            sourceBlockId: block.id
        });
    }

    return (
        <div className="message-block interactive-card-block editable-confirmation-card">
            <div className="interactive-card-header">
                <div>
                    <div className="interactive-card-title">{card.title}</div>
                    {card.description && (
                        <div className="interactive-card-description">{card.description}</div>
                    )}
                </div>
                <span className="interactive-card-status">待确认</span>
            </div>

            <div className="editable-card-fields">
                {card.payload.fields.map((field) => {
                    const current = values[field.id];
                    const fieldLabel = `${field.label}${field.required ? ' *' : ''}`;
                    if (field.type === 'boolean') {
                        return (
                            <label className="editable-card-toggle" key={field.id}>
                                <input
                                    type="checkbox"
                                    checked={Boolean(current)}
                                    onChange={(event) => updateValue(field.id, event.target.checked)}
                                />
                                <span>{fieldLabel}</span>
                            </label>
                        );
                    }
                    if (field.type === 'choice') {
                        return (
                            <label className="editable-card-field" key={field.id}>
                                <span className="editable-card-label">{fieldLabel}</span>
                                <select
                                    value={String(current || '')}
                                    onChange={(event) => updateValue(field.id, event.target.value)}
                                >
                                    {(field.options || []).map((option) => (
                                        <option value={option.value} key={option.value}>{option.label}</option>
                                    ))}
                                </select>
                                {field.description && <span className="editable-card-help">{field.description}</span>}
                            </label>
                        );
                    }
                    if (field.type === 'long_text') {
                        return (
                            <label className="editable-card-field" key={field.id}>
                                <span className="editable-card-label">{fieldLabel}</span>
                                <textarea
                                    value={String(current || '')}
                                    onChange={(event) => updateValue(field.id, event.target.value)}
                                    rows={Math.max(3, String(current || '').split(/\n/).length)}
                                    spellCheck={false}
                                />
                                {field.description && <span className="editable-card-help">{field.description}</span>}
                            </label>
                        );
                    }
                    return (
                        <label className="editable-card-field" key={field.id}>
                            <span className="editable-card-label">{fieldLabel}</span>
                            <input
                                type="text"
                                value={String(current || '')}
                                onChange={(event) => updateValue(field.id, event.target.value)}
                            />
                            {field.description && <span className="editable-card-help">{field.description}</span>}
                        </label>
                    );
                })}
            </div>

            {validation.issues.length > 0 && (
                <div className="interactive-card-issues">
                    {validation.issues.slice(0, 5).map((issue, index) => (
                        <div
                            key={`${issue.code}-${index}`}
                            className={`interactive-card-issue ${issue.severity}`}
                        >
                            {issue.message}
                        </div>
                    ))}
                </div>
            )}

            <div className="interactive-card-actions">
                <button
                    type="button"
                    className="interactive-card-submit"
                    disabled={!validation.canSubmit}
                    onClick={handleSubmit}
                >
                    确认
                </button>
            </div>
        </div>
    );
};
