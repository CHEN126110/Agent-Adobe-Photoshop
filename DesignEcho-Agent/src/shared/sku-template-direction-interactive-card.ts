import type { DesignMemoryScope } from './design-memory-knowledge';
import {
    buildEditableConfirmationInteractiveCard,
    buildEditableConfirmationValueFingerprint,
    validateEditableConfirmationValue,
    type EditableConfirmationCard,
    type EditableConfirmationValue
} from './editable-confirmation-interactive-card';
import type {
    InteractiveCardDecisionContext,
    InteractiveCardSubmission
} from './interactive-card-contract';

export type SkuTemplateDirectionCard = EditableConfirmationCard;

export interface BuildSkuTemplateDirectionCardInput {
    memoryScope: DesignMemoryScope;
    comboSizes: number[];
    colorCount: number;
    productLabel?: string;
    styleText?: string;
}

export function isSkuTemplateDirectionCard(value: unknown): value is SkuTemplateDirectionCard {
    const card = value && typeof value === 'object'
        ? value as Partial<SkuTemplateDirectionCard>
        : {};
    return card.version === 'interactive-card/v0'
        && card.kind === 'sku_template_direction'
        && card.payload?.version === 'editable-confirmation/v0'
        && card.interactionOwner?.type === 'skill-provider'
        && card.interactionOwner.skillId === 'sku-batch';
}

export function deriveSkuTemplateDirectionDecisionContext(
    card: SkuTemplateDirectionCard,
    value: unknown = card.payload.initialValue
): InteractiveCardDecisionContext {
    const answerFingerprint = buildEditableConfirmationValueFingerprint(card.payload, value);
    return {
        decisionFingerprint: 'sku-template-direction/v0',
        candidateFingerprint: buildEditableConfirmationValueFingerprint(
            card.payload,
            card.payload.initialValue
        ),
        answerFingerprint
    };
}

export function buildSkuTemplateDirectionCard(
    input: BuildSkuTemplateDirectionCardInput
): SkuTemplateDirectionCard {
    const comboSizesText = input.comboSizes.length > 0
        ? input.comboSizes.map((size) => `${size}双`).join(' / ')
        : '2双 / 3双 / 4双';
    const colorCountText = input.colorCount > 0 ? `${input.colorCount} 个颜色` : '当前颜色';
    const productLabel = String(input.productLabel || '').trim();
    const styleText = String(input.styleText || '').trim();
    const card = buildEditableConfirmationInteractiveCard({
        id: 'sku-card-template-design-confirmation',
        title: '确认 SKU 色卡模板方向',
        description: '先确认模板版式和复核重点，确认后由我参考项目素材与设计参考自主设计可编辑模板，并自动添加与规格数一致的占位符；只有你明确要求时才使用通用占位模板（非设计稿）兜底。',
        memoryScope: input.memoryScope,
        ...(productLabel ? { productType: productLabel } : {}),
        ...(styleText ? { style: styleText } : {}),
        memoryEnabled: true,
        memoryKind: 'project_rule',
        tags: ['sku', '色卡模板'],
        fields: [
            {
                id: 'template_confirmation',
                label: '模板方向确认',
                type: 'choice',
                value: '确认',
                options: [
                    { value: '确认', label: '确认这个方向' },
                    { value: '需要调整', label: '需要先调整' }
                ],
                required: true
            },
            {
                id: 'style_direction',
                label: '视觉方向',
                type: 'long_text',
                value: styleText
                    ? `延续项目素材已识别的风格（${styleText}），背景干净、商品卡片清晰留白。`
                    : '按项目产品与素材风格自定，背景干净、商品卡片清晰留白；如需特定风格请在此补充。',
                required: true,
                maxLength: 160
            },
            {
                id: 'combo_layout',
                label: '组合版式',
                type: 'long_text',
                value: `${comboSizesText}；每组从 ${colorCountText} 中选择，卡片间距统一，主体不溢出。`,
                required: true,
                maxLength: 180
            },
            {
                id: 'note_layout',
                label: '自选备注',
                type: 'long_text',
                value: '保留自选备注标题和留言提示，色卡区整齐排列，后续可直接填写颜色组合。',
                required: true,
                maxLength: 180
            },
            {
                id: 'acceptance_focus',
                label: '复核重点',
                type: 'long_text',
                value: `${productLabel || '产品'}图不溢出；卡片圆角和边距统一；标题、颜色名和备注清晰；交付前再看真实画面。`,
                required: true,
                maxLength: 220
            },
            {
                id: 'allow_basic_template',
                label: '允许先生成可编辑基础模板',
                type: 'boolean',
                value: true,
                required: true
            }
        ]
    });
    const decisionContext = deriveSkuTemplateDirectionDecisionContext(card);
    return {
        ...card,
        kind: 'sku_template_direction',
        interactionOwner: {
            type: 'skill-provider',
            skillId: 'sku-batch'
        },
        decisionFingerprint: decisionContext.decisionFingerprint,
        candidateFingerprint: decisionContext.candidateFingerprint
    };
}

export function isApprovedSkuTemplateDirectionValue(value: EditableConfirmationValue): boolean {
    return String(value.values.template_confirmation || '').trim() === '确认';
}

export function isApprovedSkuTemplateDirectionSubmission(input: {
    card?: unknown;
    submission?: InteractiveCardSubmission;
}): boolean {
    if (!isSkuTemplateDirectionCard(input.card)) return false;
    const card = input.card;
    const submission = input.submission;
    if (!submission
        || submission.kind !== card.kind
        || submission.cardId !== card.id
        || submission.decisionContext?.decisionFingerprint !== card.decisionFingerprint
        || submission.decisionContext?.candidateFingerprint !== card.candidateFingerprint
        || !submission.decisionContext?.answerFingerprint) {
        return false;
    }
    const expectedContext = deriveSkuTemplateDirectionDecisionContext(card, submission.value);
    if (submission.decisionContext.answerFingerprint !== expectedContext.answerFingerprint) {
        return false;
    }
    const validation = validateEditableConfirmationValue(card.payload, submission.value);
    return validation.canSubmit && isApprovedSkuTemplateDirectionValue(validation.normalizedValue);
}
