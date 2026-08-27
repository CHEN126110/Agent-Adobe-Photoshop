import {
    buildInteractiveCardSubmission,
    type InteractiveCardDefinition
} from '../../../../shared/interactive-card-contract';
import {
    buildSkuHumanReviewIntakeFromCard,
    deriveSkuHumanReviewDecisionContext,
    isSkuHumanReviewCard,
    validateSkuHumanReviewCardValue
} from '../../../../shared/sku-human-review';
import { getMemoryService } from '../../memory.service';
import type {
    SkillInteractiveCardProvider,
    SkillInteractiveReviewPreparation
} from './types';

function prepareSkuHumanReview(
    card: InteractiveCardDefinition,
    value: unknown
): SkillInteractiveReviewPreparation {
    if (!isSkuHumanReviewCard(card)) return { status: 'unsupported' };
    const validation = validateSkuHumanReviewCardValue(card.payload, value);
    if (!validation.canSubmit) {
        return {
            status: 'invalid',
            message: validation.blockers.slice(0, 4).join('\n') || '人工复核信息还不完整。'
        };
    }
    const intake = buildSkuHumanReviewIntakeFromCard({
        card,
        value: validation.normalizedValue
    });
    const submission = buildInteractiveCardSubmission({
        card,
        value: validation.normalizedValue,
        validation
    });
    return {
        status: 'ready',
        submission,
        reviewLabel: 'SKU 人工复核',
        persist: () => {
            const record = getMemoryService().recordHumanReview({
                projectId: card.payload.target.projectFingerprint,
                intake
            });
            return {
                summary: [
                    `已写入当前 SKU 批次的人工复核：${record.statusLabel}。`,
                    `复核人：${record.review.reviewer || '未填写'}。`,
                    '该结论只对当前导出文件内容哈希有效；文件发生变化后会自动失效。'
                ].join('\n')
            };
        }
    };
}

export const skuHumanReviewInteractiveCardProvider: SkillInteractiveCardProvider = {
    ownerSkillId: 'sku-batch',
    kind: 'sku_human_review',
    payloadVersion: 'sku-human-review-card/v0',
    deriveDecisionContext(card) {
        if (!isSkuHumanReviewCard(card)) return undefined;
        return deriveSkuHumanReviewDecisionContext(card);
    },
    submitAction: 'submitSkillInteractiveReview',
    legacySubmitActions: ['submitSkuHumanReviewCard'],
    prepareRecordedReview: prepareSkuHumanReview
};
