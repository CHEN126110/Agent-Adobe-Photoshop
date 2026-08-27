export type GenericBlockingCardOwnerDecision =
    | { status: 'allowed' }
    | { status: 'blocked'; code: 'interactive_owner_unresolved' }
    | {
        status: 'blocked';
        code: 'skill_provider_interaction_owner_required';
        ownerSkillIds: string[];
    };

export type RepeatedInteractionDecision =
    | { status: 'allowed' }
    | { status: 'blocked'; code: 'interaction_no_progress' };

function uniqueSkillIds(values: readonly string[]): string[] {
    return Array.from(new Set(
        values.map((value) => String(value || '').trim()).filter(Boolean)
    ));
}

/**
 * 阻塞式通用卡只在交互 owner 已解析后可用。
 * 该策略不理解 SKU/主图/详情页，也不选择 Profile；它只校验模型已经完成的 owner 选择。
 */
export function evaluateGenericBlockingCardOwner(input: {
    skillBridgesForbidden: boolean;
    requiresResolvedOwner: boolean;
    resolvedTaskType?: string;
    providerOwnerSkillIds?: readonly string[];
}): GenericBlockingCardOwnerDecision {
    if (input.skillBridgesForbidden) return { status: 'allowed' };
    const resolvedTaskType = String(input.resolvedTaskType || '').trim();
    if (input.requiresResolvedOwner && !resolvedTaskType) {
        return { status: 'blocked', code: 'interactive_owner_unresolved' };
    }
    const ownerSkillIds = uniqueSkillIds(input.providerOwnerSkillIds || []);
    if (ownerSkillIds.length > 0) {
        return {
            status: 'blocked',
            code: 'skill_provider_interaction_owner_required',
            ownerSkillIds
        };
    }
    return { status: 'allowed' };
}

/**
 * 同一 TaskRun 内，Provider 已收到答案却在零副作用下再次提出同一决定时，
 * Runtime 必须把事实交回 Agent 重规划。领域含义由 Provider 指纹定义，Harness 不解析。
 */
export function evaluateRepeatedInteractionDecision(input: {
    previousDecisionFingerprint?: string;
    previousAnswerFingerprint?: string;
    nextDecisionFingerprint?: string;
    nextCandidateFingerprint?: string;
    skillEffect: 'none' | 'applied' | 'partial' | 'unknown' | 'missing';
    mutationCount?: number | null;
    revisionCount?: number;
}): RepeatedInteractionDecision {
    const previous = String(input.previousDecisionFingerprint || '').trim();
    const next = String(input.nextDecisionFingerprint || '').trim();
    if (!previous || !next || previous !== next) return { status: 'allowed' };
    const noMutation = input.skillEffect === 'none'
        && Number(input.mutationCount || 0) === 0
        && Number(input.revisionCount || 0) === 0;
    if (!noMutation) return { status: 'allowed' };
    const previousAnswer = String(input.previousAnswerFingerprint || '').trim();
    const nextCandidate = String(input.nextCandidateFingerprint || '').trim();
    if (previousAnswer && nextCandidate && previousAnswer !== nextCandidate) {
        return { status: 'allowed' };
    }
    return { status: 'blocked', code: 'interaction_no_progress' };
}
