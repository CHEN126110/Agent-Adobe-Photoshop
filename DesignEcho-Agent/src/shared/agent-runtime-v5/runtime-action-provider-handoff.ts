/**
 * Compound provider can explicitly decline the current R4 production step and hand the same
 * goal back for decomposition. This is not task success and it carries no Photoshop credit.
 */

export interface RuntimeActionProviderHandoff {
    version: 'runtime-action-provider-handoff/v0';
    disposition: 'decompose_to_atomic_actions';
    reason: string;
    boundaries: {
        sameGoal: true;
        noMutationCredit: true;
        noTaskCompletionCredit: true;
        requiresR4Replan: true;
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function readRuntimeActionProviderHandoff(
    value: unknown
): RuntimeActionProviderHandoff | undefined {
    if (!isRecord(value) || !isRecord(value.data)) return undefined;
    const candidate = value.data.runtimeActionProviderHandoff;
    if (!isRecord(candidate)
        || candidate.version !== 'runtime-action-provider-handoff/v0'
        || candidate.disposition !== 'decompose_to_atomic_actions') {
        return undefined;
    }
    const reason = String(candidate.reason || '').trim();
    if (!reason) return undefined;
    return {
        version: 'runtime-action-provider-handoff/v0',
        disposition: 'decompose_to_atomic_actions',
        reason: reason.slice(0, 800),
        boundaries: {
            sameGoal: true,
            noMutationCredit: true,
            noTaskCompletionCredit: true,
            requiresR4Replan: true
        }
    };
}
