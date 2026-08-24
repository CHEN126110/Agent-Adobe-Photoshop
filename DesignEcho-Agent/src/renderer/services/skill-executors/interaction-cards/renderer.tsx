import type { ReactElement } from 'react';
import type { InteractiveCardBlock as InteractiveCardBlockType } from '../../../components/message/types';
import {
    isSkuComboEditorInteractionCard,
    SkuComboEditorCardView
} from './SkuComboEditorCardView';
import {
    isSkuHumanReviewInteractionCard,
    SkuHumanReviewCardView
} from './SkuHumanReviewCardView';

export function renderSkillInteractiveCard(input: {
    block: InteractiveCardBlockType;
    onAction?: (actionId: string, params?: Record<string, any>) => void;
}): ReactElement | undefined {
    if (isSkuComboEditorInteractionCard(input.block.card)) {
        return (
            <SkuComboEditorCardView
                block={input.block}
                card={input.block.card}
                onAction={input.onAction}
            />
        );
    }
    if (isSkuHumanReviewInteractionCard(input.block.card)) {
        return (
            <SkuHumanReviewCardView
                block={input.block}
                card={input.block.card}
                onAction={input.onAction}
            />
        );
    }
    return undefined;
}
