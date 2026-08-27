import { createElement, type ReactElement } from 'react';
import type { InteractiveCardBlock as InteractiveCardBlockType } from '../../../components/message/types';
import { EditableConfirmationCardView } from '../../../components/message/blocks/EditableConfirmationCardView.tsx';
import type { InteractiveCardDefinition } from '../../../../shared/interactive-card-contract';
import { isSkuComboEditorCard } from '../../../../shared/sku-combo-interactive-card';
import { isSkuHumanReviewCard } from '../../../../shared/sku-human-review';
import { isSkuTemplateDirectionCard } from '../../../../shared/sku-template-direction-interactive-card';
import { SkuComboEditorCardView } from './SkuComboEditorCardView.tsx';
import { SkuHumanReviewCardView } from './SkuHumanReviewCardView.tsx';
import { skuComboInteractiveCardProvider } from './sku-combo-card.provider';
import { skuHumanReviewInteractiveCardProvider } from './sku-human-review-card.provider';
import { skuTemplateDirectionInteractiveCardProvider } from './sku-template-direction-card.provider';
import type { SkillInteractiveCardProvider } from './types';

export interface SkillInteractiveCardPackage {
    provider: SkillInteractiveCardProvider;
    render(input: {
        block: InteractiveCardBlockType;
        onAction?: (actionId: string, params?: Record<string, any>) => void;
    }): ReactElement | undefined;
}

export function canRenderSkillInteractiveCardPackage(
    card: InteractiveCardDefinition,
    provider: SkillInteractiveCardProvider
): boolean {
    const ownerSkillId = card.interactionOwner?.type === 'skill-provider'
        ? String(card.interactionOwner.skillId || '').trim()
        : '';
    if (!ownerSkillId || ownerSkillId !== provider.ownerSkillId) return false;
    const decisionContext = provider.deriveDecisionContext(card);
    return Boolean(
        decisionContext
        && card.decisionFingerprint === decisionContext.decisionFingerprint
        && card.candidateFingerprint === decisionContext.candidateFingerprint
    );
}

export const skillInteractiveCardPackages: readonly SkillInteractiveCardPackage[] = [
    {
        provider: skuComboInteractiveCardProvider,
        render(input): ReactElement | undefined {
            if (!canRenderSkillInteractiveCardPackage(input.block.card, skuComboInteractiveCardProvider)
                || !isSkuComboEditorCard(input.block.card)) return undefined;
            return createElement(SkuComboEditorCardView, {
                block: input.block,
                card: input.block.card,
                onAction: input.onAction
            });
        }
    },
    {
        provider: skuHumanReviewInteractiveCardProvider,
        render(input): ReactElement | undefined {
            if (!canRenderSkillInteractiveCardPackage(input.block.card, skuHumanReviewInteractiveCardProvider)
                || !isSkuHumanReviewCard(input.block.card)) return undefined;
            return createElement(SkuHumanReviewCardView, {
                block: input.block,
                card: input.block.card,
                onAction: input.onAction
            });
        }
    },
    {
        provider: skuTemplateDirectionInteractiveCardProvider,
        render(input): ReactElement | undefined {
            if (!canRenderSkillInteractiveCardPackage(input.block.card, skuTemplateDirectionInteractiveCardProvider)
                || !isSkuTemplateDirectionCard(input.block.card)) return undefined;
            return createElement(EditableConfirmationCardView, {
                block: input.block,
                card: input.block.card,
                onAction: input.onAction
            });
        }
    }
];
