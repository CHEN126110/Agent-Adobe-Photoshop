import type { ReactElement } from 'react';
import type { InteractiveCardBlock as InteractiveCardBlockType } from '../../../components/message/types';
import { skillInteractiveCardPackages } from './packages';

export function renderSkillInteractiveCard(input: {
    block: InteractiveCardBlockType;
    onAction?: (actionId: string, params?: Record<string, any>) => void;
}): ReactElement | undefined {
    for (const cardPackage of skillInteractiveCardPackages) {
        const rendered = cardPackage.render(input);
        if (rendered) return rendered;
    }
    return undefined;
}
