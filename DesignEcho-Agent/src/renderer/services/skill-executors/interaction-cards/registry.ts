import type { InteractiveCardDefinition } from '../../../../shared/interactive-card-contract';
import { getSkillById } from '../../../../shared/skills/skill-declarations';
import { skuComboInteractiveCardProvider } from './sku-combo-card.provider';
import { skuHumanReviewInteractiveCardProvider } from './sku-human-review-card.provider';
import type {
    SkillInteractiveCardProvider,
    SkillInteractiveCardSubmissionPreparation,
    SkillInteractiveReviewPreparation
} from './types';

const providers: readonly SkillInteractiveCardProvider[] = [
    skuComboInteractiveCardProvider,
    skuHumanReviewInteractiveCardProvider
];

export interface SkillInteractiveCardProviderDescriptor {
    ownerSkillId: string;
    kind: string;
    payloadVersion: string;
    submitActions: string[];
    supportsBlockingSubmission: boolean;
    supportsRecordedReview: boolean;
}

function providerKey(provider: SkillInteractiveCardProvider): string {
    return `${provider.kind}@${provider.payloadVersion}`;
}

function assertProviderRegistryIsValid(): void {
    const keys = new Set<string>();
    providers.forEach((provider) => {
        const key = providerKey(provider);
        if (!provider.ownerSkillId.trim()) {
            throw new Error(`业务卡片 Provider ${key} 缺少 ownerSkillId。`);
        }
        if (!getSkillById(provider.ownerSkillId)) {
            throw new Error(`业务卡片 Provider ${key} 引用了未注册的 Skill：${provider.ownerSkillId}。`);
        }
        if (getSkillById(provider.ownerSkillId)?.interactionOwner !== 'skill-provider') {
            throw new Error(
                `业务卡片 Provider ${key} 的 Skill ${provider.ownerSkillId} 未声明 interactionOwner=skill-provider。`
            );
        }
        if (keys.has(key)) {
            throw new Error(`业务卡片 Provider 重复注册：${key}。`);
        }
        keys.add(key);
    });
}

assertProviderRegistryIsValid();

/**
 * 只读注册投影供设置页、审计和诊断使用。它不授予 Skill 或 Tool 权限，
 * 也不允许通用 UI 根据 ownerSkillId 自行选择业务工作流。
 */
export function listSkillInteractiveCardProviders(): SkillInteractiveCardProviderDescriptor[] {
    return providers.map((provider) => ({
        ownerSkillId: provider.ownerSkillId,
        kind: provider.kind,
        payloadVersion: provider.payloadVersion,
        submitActions: [
            provider.submitAction,
            ...(provider.legacySubmitActions || [])
        ].filter((value): value is string => Boolean(value)),
        supportsBlockingSubmission: Boolean(provider.prepareSubmission),
        supportsRecordedReview: Boolean(provider.prepareRecordedReview)
    }));
}

function readPayloadVersion(card: InteractiveCardDefinition): string {
    const payload = card.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '';
    return String((payload as Record<string, unknown>).version || '').trim();
}

export function prepareSkillInteractiveCardSubmission(
    card: InteractiveCardDefinition,
    value: unknown
): SkillInteractiveCardSubmissionPreparation {
    const provider = providers.find((candidate) => (
        candidate.kind === card.kind
        && candidate.payloadVersion === readPayloadVersion(card)
    ));
    if (!provider?.prepareSubmission) return { status: 'unsupported' };
    return provider.prepareSubmission(card, value);
}

export function prepareSkillInteractiveReview(
    card: InteractiveCardDefinition,
    value: unknown
): SkillInteractiveReviewPreparation {
    const provider = providers.find((candidate) => (
        candidate.kind === card.kind
        && candidate.payloadVersion === readPayloadVersion(card)
    ));
    if (!provider?.prepareRecordedReview) return { status: 'unsupported' };
    return provider.prepareRecordedReview(card, value);
}

export function normalizeSkillInteractiveCardAction(actionId: string): string | undefined {
    const provider = providers.find((candidate) => (
        candidate.submitAction === actionId
        || candidate.legacySubmitActions?.includes(actionId)
    ));
    return provider?.submitAction;
}
