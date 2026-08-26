/**
 * Renderer 复合写在非结构化异常后的 Host 版本结算。
 *
 * 这不是事务或回滚器：它只把写前/异常后真实 revision 转成 Runtime 已认识的
 * PhotoshopOperationResult。起止事实不足时必须是 unknown，不能用错误文案猜 not_applied。
 */

import {
    buildPhotoshopHistoryTransition,
    type PhotoshopHistoryStateRef,
    type PhotoshopHistoryTransition
} from './photoshop-history-state-ref';
import {
    PHOTOSHOP_OPERATION_RESULT_VERSION,
    type PhotoshopOperationResult
} from './photoshop-operation-result';

export interface CompoundPhotoshopWriteExceptionSettlement {
    mutationObserved: boolean;
    photoshopOperationResult: PhotoshopOperationResult;
    photoshopHistoryTransition?: PhotoshopHistoryTransition;
}

export function buildCompoundPhotoshopWriteExceptionSettlement(input: {
    operationId: string;
    toolName: string;
    before?: PhotoshopHistoryStateRef;
    after?: PhotoshopHistoryStateRef;
    message: string;
}): CompoundPhotoshopWriteExceptionSettlement {
    const sameDocument = Boolean(input.before && input.after)
        && input.before?.documentId === input.after?.documentId;
    const transition = sameDocument
        ? buildPhotoshopHistoryTransition(
            { historyStateRef: input.before },
            { historyStateRef: input.after }
        )
        : undefined;
    const mutationObserved = transition?.mutationObserved === true;
    const photoshopOperationResult: PhotoshopOperationResult = mutationObserved
        ? {
            version: PHOTOSHOP_OPERATION_RESULT_VERSION,
            operationId: input.operationId,
            toolName: input.toolName,
            status: 'applied',
            applicationStatus: 'applied',
            transactionState: 'committed',
            effect: 'applied',
            rollback: { attempted: false, verified: false },
            before: input.before!,
            after: input.after!,
            code: 'compound_write_exception_applied',
            message: input.message
        }
        : {
            version: PHOTOSHOP_OPERATION_RESULT_VERSION,
            operationId: input.operationId,
            toolName: input.toolName,
            status: 'unknown',
            applicationStatus: 'unknown',
            transactionState: 'commit_unknown',
            effect: 'unknown',
            rollback: { attempted: false, verified: false },
            ...(input.before ? { before: input.before } : {}),
            ...(input.after ? { after: input.after } : {}),
            code: 'compound_write_exception_unknown',
            message: input.message
        };
    return {
        mutationObserved,
        photoshopOperationResult,
        ...(mutationObserved && transition
            ? { photoshopHistoryTransition: transition }
            : {})
    };
}
