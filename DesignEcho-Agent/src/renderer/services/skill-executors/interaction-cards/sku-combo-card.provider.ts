import {
    buildInteractiveCardSubmission,
    type InteractiveCardDefinition
} from '../../../../shared/interactive-card-contract';
import {
    buildSkuComboApprovedRecipeMemory,
    stringifySkuCombo,
    validateSkuComboEditorValue,
    type SkuComboEditorCard,
    type SkuComboEditorValue
} from '../../../../shared/sku-combo-interactive-card';
import type {
    SkillInteractiveCardProvider,
    SkillInteractiveCardSubmissionPreparation
} from './types';

function isSkuComboEditorCard(value: unknown): value is SkuComboEditorCard {
    const card = value && typeof value === 'object'
        ? value as Partial<SkuComboEditorCard>
        : {};
    return card.version === 'interactive-card/v0'
        && card.kind === 'sku_combo_editor'
        && card.payload?.version === 'sku-combo-editor/v0';
}

function formatSkuComboConfirmationText(value: SkuComboEditorValue): string {
    return value.groups
        .map((group) => `${group.size}双：${group.combos.map(stringifySkuCombo).join('，')}`)
        .join('；');
}

function prepareSkuComboSubmission(
    card: InteractiveCardDefinition,
    value: unknown
): SkillInteractiveCardSubmissionPreparation {
    if (!isSkuComboEditorCard(card)) return { status: 'unsupported' };
    const validation = validateSkuComboEditorValue(card.payload, value);
    if (!validation.canSubmit) {
        return {
            status: 'invalid',
            message: validation.blockers.slice(0, 4).join('\n') || '组合还没有通过检查，请先修改。'
        };
    }
    const memoryCandidate = card.memoryPolicy?.enabled
        ? buildSkuComboApprovedRecipeMemory({
            card,
            value: validation.normalizedValue,
            scope: card.memoryPolicy.scope,
            confirmedBy: 'user'
        })
        : undefined;
    return {
        status: 'ready',
        submission: buildInteractiveCardSubmission({
            card,
            value: validation.normalizedValue,
            validation,
            memoryCandidate
        }),
        confirmationText: `已确认 SKU 组合：${formatSkuComboConfirmationText(validation.normalizedValue)}`,
        memorySavedText: '已保存为可复用配方。',
        memoryFailurePrefix: '组合已确认，但配方记忆没有保存',
        resumePolicy: 'required'
    };
}

export const skuComboInteractiveCardProvider: SkillInteractiveCardProvider = {
    ownerSkillId: 'sku-batch',
    kind: 'sku_combo_editor',
    payloadVersion: 'sku-combo-editor/v0',
    prepareSubmission: prepareSkuComboSubmission
};
