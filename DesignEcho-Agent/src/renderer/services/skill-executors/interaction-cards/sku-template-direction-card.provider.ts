import {
    buildEditableConfirmationApprovedMemory,
    validateEditableConfirmationValue,
    type EditableConfirmationCard,
    type EditableConfirmationValue
} from '../../../../shared/editable-confirmation-interactive-card';
import {
    buildInteractiveCardSubmission,
    cleanInteractiveCardText,
    type InteractiveCardDefinition
} from '../../../../shared/interactive-card-contract';
import {
    deriveSkuTemplateDirectionDecisionContext,
    isSkuTemplateDirectionCard
} from '../../../../shared/sku-template-direction-interactive-card';
import type {
    SkillInteractiveCardProvider,
    SkillInteractiveCardSubmissionPreparation
} from './types';

function formatSkuTemplateDirectionConfirmation(
    card: EditableConfirmationCard,
    value: EditableConfirmationValue
): string {
    return card.payload.fields
        .map((field) => {
            const rawValue = value.values[field.id];
            const rendered = typeof rawValue === 'boolean'
                ? (rawValue ? '是' : '否')
                : cleanInteractiveCardText(rawValue);
            return rendered ? `${field.label}：${rendered}` : '';
        })
        .filter(Boolean)
        .join('；');
}

function prepareSkuTemplateDirectionSubmission(
    card: InteractiveCardDefinition,
    value: unknown
): SkillInteractiveCardSubmissionPreparation {
    if (!isSkuTemplateDirectionCard(card)) return { status: 'unsupported' };
    const validation = validateEditableConfirmationValue(card.payload, value);
    if (!validation.canSubmit) {
        return {
            status: 'invalid',
            message: validation.blockers.slice(0, 4).join('\n') || '模板方向还没有通过检查，请先修改。'
        };
    }
    const memoryCandidate = card.memoryPolicy?.enabled
        ? buildEditableConfirmationApprovedMemory({
            card,
            value: validation.normalizedValue,
            scope: card.memoryPolicy.scope,
            confirmedBy: 'user'
        })
        : undefined;
    const decisionContext = deriveSkuTemplateDirectionDecisionContext(
        card,
        validation.normalizedValue
    );
    return {
        status: 'ready',
        submission: buildInteractiveCardSubmission({
            card,
            value: validation.normalizedValue,
            validation,
            memoryCandidate,
            answerFingerprint: decisionContext.answerFingerprint
        }),
        confirmationText: `已确认 SKU 模板方向：${formatSkuTemplateDirectionConfirmation(card, validation.normalizedValue)}`,
        memorySavedText: '已保存本项目的模板方向。',
        memoryFailurePrefix: '模板方向已确认，但项目记忆没有保存',
        resumePolicy: 'required'
    };
}

export const skuTemplateDirectionInteractiveCardProvider: SkillInteractiveCardProvider = {
    ownerSkillId: 'sku-batch',
    kind: 'sku_template_direction',
    payloadVersion: 'editable-confirmation/v0',
    deriveDecisionContext(card, value) {
        if (!isSkuTemplateDirectionCard(card)) return undefined;
        return deriveSkuTemplateDirectionDecisionContext(card, value);
    },
    prepareSubmission: prepareSkuTemplateDirectionSubmission
};
