import type { PhotoshopHistoryStateRef } from './photoshop-history-state-ref';

export const PHOTOSHOP_OPERATION_RESULT_VERSION = 'photoshop-operation-result/v1' as const;

export type PhotoshopOperationStatus =
    | 'applied'
    | 'verified'
    | 'verification_failed'
    | 'failed'
    | 'unknown';

export type PhotoshopOperationApplicationStatus =
    | 'not_applied'
    | 'applied'
    | 'unknown';

export type PhotoshopOperationTransactionState =
    | 'not_started'
    | 'suspended'
    | 'rolled_back'
    | 'committed'
    | 'commit_unknown'
    | 'rollback_unknown'
    | 'transport_unknown'
    | 'transport_reconciled'
    | 'readback_reconciled';

export interface PhotoshopOperationResult {
    version: typeof PHOTOSHOP_OPERATION_RESULT_VERSION;
    operationId: string;
    toolName: string;
    status: PhotoshopOperationStatus;
    applicationStatus: PhotoshopOperationApplicationStatus;
    transactionState: PhotoshopOperationTransactionState;
    effect: 'none' | 'already_satisfied' | 'applied' | 'rolled_back' | 'unknown';
    rollback: {
        attempted: boolean;
        verified: boolean;
    };
    before?: PhotoshopHistoryStateRef;
    after?: PhotoshopHistoryStateRef;
    code?: string;
    message?: string;
}

const STATUS_VALUES = new Set<PhotoshopOperationStatus>([
    'applied',
    'verified',
    'verification_failed',
    'failed',
    'unknown'
]);

const APPLICATION_STATUS_VALUES = new Set<PhotoshopOperationApplicationStatus>([
    'not_applied',
    'applied',
    'unknown'
]);

const TRANSACTION_STATE_VALUES = new Set<PhotoshopOperationTransactionState>([
    'not_started',
    'suspended',
    'rolled_back',
    'committed',
    'commit_unknown',
    'rollback_unknown',
    'transport_unknown',
    'transport_reconciled',
    'readback_reconciled'
]);

const EFFECT_VALUES = new Set<PhotoshopOperationResult['effect']>([
    'none',
    'already_satisfied',
    'applied',
    'rolled_back',
    'unknown'
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return value as Record<string, unknown>;
}

function readPositiveInteger(value: unknown): number | undefined {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : undefined;
}

function readHistoryStateRef(value: unknown): PhotoshopHistoryStateRef | undefined {
    const record = asRecord(value);
    const documentId = readPositiveInteger(record?.documentId);
    const historyStateId = readPositiveInteger(record?.historyStateId);
    if (!documentId || !historyStateId) return undefined;
    return { documentId, historyStateId };
}

function isContractInvariantValid(input: {
    status: PhotoshopOperationStatus;
    applicationStatus: PhotoshopOperationApplicationStatus;
    transactionState: PhotoshopOperationTransactionState;
    effect: PhotoshopOperationResult['effect'];
    rollbackAttempted: boolean;
    rollbackVerified: boolean;
}): boolean {
    if (input.rollbackVerified && !input.rollbackAttempted) return false;
    if (input.status === 'unknown'
        && (input.applicationStatus !== 'unknown' || input.effect !== 'unknown')) {
        return false;
    }
    if (input.status === 'applied'
        && (input.applicationStatus !== 'applied' || input.effect !== 'applied')) {
        return false;
    }
    if (input.status === 'verification_failed'
        && (input.applicationStatus !== 'applied' || input.effect !== 'applied')) {
        return false;
    }
    if (input.status === 'failed'
        && (input.applicationStatus !== 'not_applied'
            || (input.effect !== 'none' && input.effect !== 'rolled_back'))) {
        return false;
    }
    if (input.transactionState === 'not_started'
        && input.applicationStatus !== 'not_applied') {
        return false;
    }
    if (input.transactionState === 'rollback_unknown' && input.status !== 'unknown') {
        return false;
    }
    if (input.transactionState === 'commit_unknown' && input.status !== 'unknown') {
        return false;
    }
    if (input.transactionState === 'transport_unknown' && input.status !== 'unknown') {
        return false;
    }
    if (input.transactionState === 'transport_reconciled' && input.status !== 'verified') {
        return false;
    }
    if (input.transactionState === 'readback_reconciled' && input.status !== 'verified') {
        return false;
    }
    if (input.rollbackVerified
        && (input.transactionState !== 'rolled_back'
            || input.status !== 'failed'
            || input.applicationStatus !== 'not_applied'
            || input.effect !== 'rolled_back')) {
        return false;
    }
    return true;
}

function hasVersionedPhotoshopOperationEnvelope(value: unknown): boolean {
    const root = asRecord(value);
    const raw = asRecord(root?.photoshopOperationResult);
    return raw?.version === PHOTOSHOP_OPERATION_RESULT_VERSION;
}

/**
 * 只接受版本化且满足不变量的 Host 执行事实。调用方不得信任同一结果中
 * 额外携带的 retryable / mutationApplied 等派生布尔字段。
 */
export function readPhotoshopOperationResult(value: unknown): PhotoshopOperationResult | undefined {
    const root = asRecord(value);
    const raw = asRecord(root?.photoshopOperationResult);
    if (!raw || raw.version !== PHOTOSHOP_OPERATION_RESULT_VERSION) return undefined;

    const status = raw.status as PhotoshopOperationStatus;
    const applicationStatus = raw.applicationStatus as PhotoshopOperationApplicationStatus;
    const transactionState = raw.transactionState as PhotoshopOperationTransactionState;
    const effect = raw.effect as PhotoshopOperationResult['effect'];
    const rollback = asRecord(raw.rollback);
    if (!STATUS_VALUES.has(status)
        || !APPLICATION_STATUS_VALUES.has(applicationStatus)
        || !TRANSACTION_STATE_VALUES.has(transactionState)
        || !EFFECT_VALUES.has(effect)
        || typeof rollback?.attempted !== 'boolean'
        || typeof rollback?.verified !== 'boolean') {
        return undefined;
    }

    const operationId = String(raw.operationId || '').trim();
    const toolName = String(raw.toolName || '').trim();
    const before = readHistoryStateRef(raw.before);
    const after = readHistoryStateRef(raw.after);
    if (!operationId || !toolName) return undefined;
    if ((raw.before !== undefined && !before)
        || (raw.after !== undefined && !after)) {
        return undefined;
    }
    if (!isContractInvariantValid({
        status,
        applicationStatus,
        transactionState,
        effect,
        rollbackAttempted: rollback.attempted,
        rollbackVerified: rollback.verified
    })) {
        return undefined;
    }

    return {
        version: PHOTOSHOP_OPERATION_RESULT_VERSION,
        operationId,
        toolName,
        status,
        applicationStatus,
        transactionState,
        effect,
        rollback: {
            attempted: rollback.attempted,
            verified: rollback.verified
        },
        ...(before ? { before } : {}),
        ...(after ? { after } : {}),
        ...(typeof raw.code === 'string' && raw.code.trim()
            ? { code: raw.code.trim() }
            : {}),
        ...(typeof raw.message === 'string' && raw.message.trim()
            ? { message: raw.message.trim() }
            : {})
    };
}

export function requiresPhotoshopOperationReadback(value: unknown): boolean {
    const result = readPhotoshopOperationResult(value);
    if (!result) {
        // 识别到 v1 信封却无法通过不变量校验时，含义只能是执行结果未知。
        // 这只建立保护性读回/写锁，绝不授予完成或 mutation 信用。
        return hasVersionedPhotoshopOperationEnvelope(value);
    }
    return result?.status === 'unknown'
        || result?.status === 'applied'
        || result?.status === 'verification_failed';
}

export function hasPossiblePhotoshopOperationMutation(value: unknown): boolean {
    const result = readPhotoshopOperationResult(value);
    if (!result) {
        return hasVersionedPhotoshopOperationEnvelope(value);
    }
    return result?.applicationStatus === 'applied'
        || result?.applicationStatus === 'unknown';
}

function isReconciledTransactionState(
    value: PhotoshopOperationTransactionState
): boolean {
    return value === 'transport_reconciled' || value === 'readback_reconciled';
}

/**
 * 只把 operation-specific 读回证明的“已应用 + revision 确实前进”暴露给复合执行器。
 * 这不是 same_execute_as_modal commit，也不能被调用方包装成该类 commit。
 */
export function readReconciledAppliedPhotoshopOperationAfter(
    value: unknown
): PhotoshopHistoryStateRef | undefined {
    const result = readPhotoshopOperationResult(value);
    const root = asRecord(value);
    const readback = asRecord(root?.readback);
    const readbackBefore = readHistoryStateRef(readback?.expectedHistoryStateRef);
    const readbackAfter = readHistoryStateRef(readback?.observedHistoryStateRef);
    if (!result
        || result.status !== 'verified'
        || result.applicationStatus !== 'applied'
        || result.effect !== 'applied'
        || !isReconciledTransactionState(result.transactionState)
        || !result.before
        || !result.after
        || result.before.documentId !== result.after.documentId
        || result.before.historyStateId === result.after.historyStateId
        || readback?.verified !== true
        || readback?.classification !== 'applied'
        || readbackBefore?.documentId !== result.before.documentId
        || readbackBefore?.historyStateId !== result.before.historyStateId
        || readbackAfter?.documentId !== result.after.documentId
        || readbackAfter?.historyStateId !== result.after.historyStateId) {
        return undefined;
    }
    return result.after;
}

/**
 * 精确未应用要求 operation-specific 读回把同一文档 revision 结算为未变化。
 */
export function isReconciledNotAppliedPhotoshopOperation(value: unknown): boolean {
    const result = readPhotoshopOperationResult(value);
    const root = asRecord(value);
    const readback = asRecord(root?.readback);
    const readbackBefore = readHistoryStateRef(readback?.expectedHistoryStateRef);
    const readbackAfter = readHistoryStateRef(readback?.observedHistoryStateRef);
    return Boolean(
        result
        && result.status === 'failed'
        && result.applicationStatus === 'not_applied'
        && result.effect === 'none'
        && result.transactionState === 'not_started'
        && result.before
        && result.after
        && result.before.documentId === result.after.documentId
        && result.before.historyStateId === result.after.historyStateId
        && readback?.verified === true
        && readback?.classification === 'not_applied'
        && readbackBefore?.documentId === result.before.documentId
        && readbackBefore?.historyStateId === result.before.historyStateId
        && readbackAfter?.documentId === result.after.documentId
        && readbackAfter?.historyStateId === result.after.historyStateId
    );
}
