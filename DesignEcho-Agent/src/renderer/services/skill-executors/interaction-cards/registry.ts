import type { InteractiveCardDefinition } from '../../../../shared/interactive-card-contract';
import { getSkillById } from '../../../../shared/skills/skill-declarations';
import { skillInteractiveCardPackages } from './packages';
import type {
    SkillInteractiveCardProvider,
    SkillInteractiveCardSubmissionPreparation,
    SkillInteractiveReviewPreparation
} from './types';

const providers: readonly SkillInteractiveCardProvider[] = [
    ...skillInteractiveCardPackages.map((item) => item.provider)
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

function findProviderForCard(card: InteractiveCardDefinition): SkillInteractiveCardProvider | undefined {
    return providers.find((candidate) => (
        candidate.kind === card.kind
        && candidate.payloadVersion === readPayloadVersion(card)
    ));
}

function validateCardProviderOwner(
    card: InteractiveCardDefinition,
    provider: SkillInteractiveCardProvider,
    expectedOwnerSkillId?: string,
    requireExpectedOwner = false
): { status: 'valid' } | { status: 'invalid'; message: string } {
    const cardOwnerSkillId = card.interactionOwner?.type === 'skill-provider'
        ? String(card.interactionOwner.skillId || '').trim()
        : '';
    if (!cardOwnerSkillId || cardOwnerSkillId !== provider.ownerSkillId) {
        return {
            status: 'invalid',
            message: '这张业务确认卡的来源身份不完整或不匹配，尚未执行；请重新生成确认卡。'
        };
    }
    const derivedDecisionContext = provider.deriveDecisionContext(card);
    if (!derivedDecisionContext
        || card.decisionFingerprint !== derivedDecisionContext.decisionFingerprint
        || card.candidateFingerprint !== derivedDecisionContext.candidateFingerprint) {
        return {
            status: 'invalid',
            message: '这张业务确认卡的决定身份不是由当前能力包签发，尚未执行；请重新生成确认卡。'
        };
    }
    if (
        !String(card.decisionFingerprint || '').trim()
        || !String(card.candidateFingerprint || '').trim()
    ) {
        return {
            status: 'invalid',
            message: '这张业务确认卡缺少稳定的决定或候选身份，尚未执行；请重新生成确认卡。'
        };
    }
    const expectedOwner = String(expectedOwnerSkillId || '').trim();
    if (requireExpectedOwner && !expectedOwner) {
        return {
            status: 'invalid',
            message: '这张业务确认卡缺少原任务身份，尚未执行；请重新发起原任务。'
        };
    }
    if (expectedOwner && provider.ownerSkillId !== expectedOwner) {
        return {
            status: 'invalid',
            message: '这张业务确认卡与原任务不属于同一能力，尚未执行；请重新生成确认卡。'
        };
    }
    return { status: 'valid' };
}

export function prepareSkillInteractiveCardSubmission(
    card: InteractiveCardDefinition,
    value: unknown,
    options: {
        expectedOwnerSkillId?: string;
        requireExpectedOwner?: boolean;
    } = {}
): SkillInteractiveCardSubmissionPreparation {
    const provider = findProviderForCard(card);
    if (!provider?.prepareSubmission) return { status: 'unsupported' };
    const ownerValidation = validateCardProviderOwner(
        card,
        provider,
        options.expectedOwnerSkillId,
        options.requireExpectedOwner === true
    );
    if (ownerValidation.status === 'invalid') return ownerValidation;
    const preparation = provider.prepareSubmission(card, value);
    if (preparation.status !== 'ready') return preparation;
    const derivedSubmissionContext = provider.deriveDecisionContext(
        card,
        preparation.submission.validation.normalizedValue
    );
    const submissionContext = preparation.submission.decisionContext;
    if (!derivedSubmissionContext
        || submissionContext?.decisionFingerprint !== derivedSubmissionContext.decisionFingerprint
        || submissionContext?.candidateFingerprint !== derivedSubmissionContext.candidateFingerprint
        || submissionContext?.answerFingerprint !== derivedSubmissionContext.answerFingerprint) {
        return {
            status: 'invalid',
            message: '这张业务确认卡的答案身份无法由当前能力包验证，尚未执行；请重新提交。'
        };
    }
    return preparation;
}

export function prepareSkillInteractiveReview(
    card: InteractiveCardDefinition,
    value: unknown
): SkillInteractiveReviewPreparation {
    const provider = findProviderForCard(card);
    if (!provider?.prepareRecordedReview) return { status: 'unsupported' };
    const ownerValidation = validateCardProviderOwner(card, provider);
    if (ownerValidation.status === 'invalid') return ownerValidation;
    const preparation = provider.prepareRecordedReview(card, value);
    if (preparation.status !== 'ready') return preparation;
    const derivedSubmissionContext = provider.deriveDecisionContext(
        card,
        preparation.submission.validation.normalizedValue
    );
    const submissionContext = preparation.submission.decisionContext;
    if (!derivedSubmissionContext
        || submissionContext?.decisionFingerprint !== derivedSubmissionContext.decisionFingerprint
        || submissionContext?.candidateFingerprint !== derivedSubmissionContext.candidateFingerprint) {
        return {
            status: 'invalid',
            message: '这张业务复核卡的对象身份无法由当前能力包验证，尚未写入；请重新生成。'
        };
    }
    return preparation;
}

export function normalizeSkillInteractiveCardAction(actionId: string): string | undefined {
    const provider = providers.find((candidate) => (
        candidate.submitAction === actionId
        || candidate.legacySubmitActions?.includes(actionId)
    ));
    return provider?.submitAction;
}
