/**
 * Photoshop 写操作的目标事务执行边界。
 *
 * Tool 只提供编译期确定的 prepare / mutate / readState / verify 回调；
 * 外部请求不能注入脚本或 batchPlay 描述符。Runner 统一拥有串行化、
 * modal 内目标复核、历史挂起、取消、读回、提交、回滚和未知结果分类。
 * 当前按垂直切片迁移 Tool；未迁移的 legacy 写入口仍由 ownership audit 显式列出。
 */

import type { ToolExecutionContext } from '../tools/types';
import {
    checkPhotoshopTargetGuard,
    normalizePhotoshopTargetGuard,
    readActualPhotoshopTarget,
    type PhotoshopTargetIdentity
} from './photoshop-target-guard';
import { createToolFailureResult } from './tool-error-normalizer';

const { app, core } = require('photoshop');

export const PHOTOSHOP_MUTATION_COMMIT_VERSION = 'photoshop-mutation-commit/v1' as const;
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

export type PhotoshopHistoryTransactionState =
    | 'not_started'
    | 'suspended'
    | 'rolled_back'
    | 'committed'
    | 'commit_unknown'
    | 'rollback_unknown';

export type PhotoshopOperationEffect =
    | 'none'
    | 'already_satisfied'
    | 'applied'
    | 'rolled_back'
    | 'unknown';

export interface PhotoshopMutationState {
    documentId: number;
    historyStateId: number;
    activeLayerId: number | null;
}

export interface PhotoshopMutationCommit {
    version: typeof PHOTOSHOP_MUTATION_COMMIT_VERSION;
    basis: 'same_execute_as_modal';
    bindingStrength: 'document_revision' | 'document_only' | 'unguarded';
    /** 新建文档没有同文档 before revision；用 modal 内的文档集合差集证明。 */
    changeKind?: 'document_creation';
    beforeOpenDocumentIds?: number[];
    createdDocumentId?: number;
    before?: PhotoshopMutationState;
    after?: PhotoshopMutationState;
    toolActionCompleted: boolean;
    mutationObserved: boolean | null;
    documentChanged: boolean | null;
}

export interface PhotoshopOperationResult {
    version: typeof PHOTOSHOP_OPERATION_RESULT_VERSION;
    operationId: string;
    toolName: string;
    status: PhotoshopOperationStatus;
    applicationStatus: PhotoshopOperationApplicationStatus;
    transactionState: PhotoshopHistoryTransactionState;
    effect: PhotoshopOperationEffect;
    rollback: {
        attempted: boolean;
        verified: boolean;
    };
    before?: PhotoshopMutationState;
    after?: PhotoshopMutationState;
    code?: string;
    message?: string;
}

export interface PhotoshopMutationScope {
    document: any;
    before?: PhotoshopMutationState;
}

export interface PhotoshopTransactionScope {
    document: any;
    executionContext: import('photoshop').ExecutionContext;
    beforeTarget: PhotoshopTargetIdentity;
}

export type PhotoshopTransactionPreparation<TBefore, TResult> =
    | {
        kind: 'ready';
        before: TBefore;
    }
    | {
        kind: 'complete';
        result: TResult;
        effect: 'already_satisfied' | 'none';
    };

export interface PhotoshopTransactionVerification {
    verified: boolean;
    message?: string;
}

export type PhotoshopTransactionReadPhase =
    | 'before_commit'
    | 'after_commit'
    | 'after_rollback';

export type PhotoshopTransactionRequiredBinding =
    | 'document_only'
    | 'document_revision';

export type PhotoshopRollbackTargetPolicy =
    | 'document_revision'
    | 'document_revision_and_active_layer';

export interface PhotoshopTransactionMutationOutcome<TResult, TReceipt> {
    kind: 'photoshop_transaction_mutation_outcome';
    result: TResult;
    receipt?: TReceipt;
}

export interface PhotoshopTransactionReadInput<TBefore, TResult, TReceipt> {
    phase: PhotoshopTransactionReadPhase;
    scope: PhotoshopTransactionScope;
    before: TBefore;
    result?: TResult;
    receipt?: TReceipt;
}

export interface PhotoshopTransactionVerificationInput<
    TBefore,
    TAfter,
    TResult,
    TReceipt = undefined
> {
    scope: PhotoshopTransactionScope;
    before: TBefore;
    after: TAfter;
    result: TResult;
    receipt?: TReceipt;
}

export interface PhotoshopRollbackVerificationInput<
    TBefore,
    TAfter,
    TResult,
    TReceipt = undefined
> {
    scope: PhotoshopTransactionScope;
    before: TBefore;
    after: TAfter;
    result?: TResult;
    receipt?: TReceipt;
}

export interface PhotoshopTransactionRequest<
    TBefore,
    TAfter,
    TResult extends Record<string, unknown> & { success: boolean },
    TReceipt = undefined
> {
    operationId: string;
    toolName: string;
    commandName: string;
    params?: unknown;
    context?: ToolExecutionContext;
    historyMode?: 'none' | 'suspend';
    expectedEffect?: 'allow_noop' | 'mutation_required';
    requiredBinding?: PhotoshopTransactionRequiredBinding;
    rollbackTargetPolicy?: PhotoshopRollbackTargetPolicy;
    prepare(scope: PhotoshopTransactionScope): Promise<PhotoshopTransactionPreparation<TBefore, TResult>>
        | PhotoshopTransactionPreparation<TBefore, TResult>;
    mutate(
        scope: PhotoshopTransactionScope,
        before: TBefore
    ): Promise<TResult | PhotoshopTransactionMutationOutcome<TResult, TReceipt>>;
    readState(
        input: PhotoshopTransactionReadInput<TBefore, TResult, TReceipt>
    ): Promise<TAfter> | TAfter;
    verifyApplied(
        input: PhotoshopTransactionVerificationInput<TBefore, TAfter, TResult, TReceipt>
    ): PhotoshopTransactionVerification | boolean;
    verifyRolledBack?(
        input: PhotoshopRollbackVerificationInput<TBefore, TAfter, TResult, TReceipt>
    ): PhotoshopTransactionVerification | boolean;
    buildVerifiedResult?(
        input: PhotoshopTransactionVerificationInput<TBefore, TAfter, TResult, TReceipt>
    ): TResult;
}

export interface ExecutePhotoshopMutationInput<T extends Record<string, unknown> & { success: boolean }> {
    toolName: string;
    commandName: string;
    params?: unknown;
    context?: ToolExecutionContext;
    expectedEffect?: 'allow_noop' | 'mutation_required';
    mutate(scope: PhotoshopMutationScope): Promise<T>;
}

interface RollbackOutcome<TAfter> {
    transactionState: 'rolled_back' | 'rollback_unknown';
    verified: boolean;
    after?: TAfter;
    afterTarget?: PhotoshopTargetIdentity;
    message?: string;
}

interface OperationBuildInput {
    operationId: string;
    toolName: string;
    status: PhotoshopOperationStatus;
    applicationStatus: PhotoshopOperationApplicationStatus;
    transactionState: PhotoshopHistoryTransactionState;
    effect: PhotoshopOperationEffect;
    rollbackAttempted?: boolean;
    rollbackVerified?: boolean;
    before?: PhotoshopMutationState;
    after?: PhotoshopMutationState;
    code?: string;
    message?: string;
}

function isStructuredToolResult(
    value: unknown
): value is Record<string, unknown> & { success: boolean } {
    return Boolean(value)
        && typeof value === 'object'
        && !Array.isArray(value)
        && typeof (value as Record<string, unknown>).success === 'boolean';
}

function isPhotoshopTransactionMutationOutcome<TResult, TReceipt>(
    value: unknown
): value is PhotoshopTransactionMutationOutcome<TResult, TReceipt> {
    return Boolean(value)
        && typeof value === 'object'
        && !Array.isArray(value)
        && (value as Record<string, unknown>).kind
            === 'photoshop_transaction_mutation_outcome'
        && Object.prototype.hasOwnProperty.call(value, 'result');
}

function readErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    const message = String(error || '').trim();
    return message || 'Photoshop 写操作失败。';
}

function isPhotoshopTransactionCancellationRequested(
    requestContext: ToolExecutionContext | undefined,
    executionContext: import('photoshop').ExecutionContext
): boolean {
    return executionContext.isCancelled === true
        || Boolean(requestContext?.isCancelled?.());
}

function normalizeVerification(
    value: PhotoshopTransactionVerification | boolean
): PhotoshopTransactionVerification {
    if (typeof value === 'boolean') return { verified: value };
    return {
        verified: value?.verified === true,
        ...(value?.message ? { message: value.message } : {})
    };
}

function toMutationState(identity: PhotoshopTargetIdentity): PhotoshopMutationState | undefined {
    if (identity.documentId === null || identity.historyStateId === null) return undefined;
    return {
        documentId: identity.documentId,
        historyStateId: identity.historyStateId,
        activeLayerId: identity.activeLayerId
    };
}

function sameMutationState(
    left: PhotoshopMutationState | undefined,
    right: PhotoshopMutationState | undefined
): boolean {
    return Boolean(
        left
        && right
        && left.documentId === right.documentId
        && left.historyStateId === right.historyStateId
        && left.activeLayerId === right.activeLayerId
    );
}

function sameRollbackTargetState(
    left: PhotoshopMutationState | undefined,
    right: PhotoshopMutationState | undefined,
    policy: PhotoshopRollbackTargetPolicy
): boolean {
    if (!left || !right) return false;
    if (left.documentId !== right.documentId
        || left.historyStateId !== right.historyStateId) {
        return false;
    }
    if (policy === 'document_revision_and_active_layer') {
        return left.activeLayerId === right.activeLayerId;
    }
    return true;
}

function buildPhotoshopMutationCommit(input: {
    before?: PhotoshopMutationState;
    after?: PhotoshopMutationState;
    bindingStrength: PhotoshopMutationCommit['bindingStrength'];
    toolActionCompleted: boolean;
}): PhotoshopMutationCommit {
    if (!input.before || !input.after) {
        return {
            version: PHOTOSHOP_MUTATION_COMMIT_VERSION,
            basis: 'same_execute_as_modal',
            bindingStrength: input.bindingStrength,
            ...(input.before ? { before: input.before } : {}),
            ...(input.after ? { after: input.after } : {}),
            toolActionCompleted: input.toolActionCompleted,
            mutationObserved: null,
            documentChanged: null
        };
    }

    const documentChanged = input.before.documentId !== input.after.documentId;
    return {
        version: PHOTOSHOP_MUTATION_COMMIT_VERSION,
        basis: 'same_execute_as_modal',
        bindingStrength: input.bindingStrength,
        before: input.before,
        after: input.after,
        toolActionCompleted: input.toolActionCompleted,
        mutationObserved: documentChanged
            || input.before.historyStateId !== input.after.historyStateId,
        documentChanged
    };
}

function resolveBindingStrength(
    context: ToolExecutionContext | undefined
): PhotoshopMutationCommit['bindingStrength'] {
    const guard = normalizePhotoshopTargetGuard(context?.photoshopTargetGuard);
    if (guard?.expectedHistoryStateRef) return 'document_revision';
    if (guard) return 'document_only';
    return 'unguarded';
}

function buildOperationResult(input: OperationBuildInput): PhotoshopOperationResult {
    return {
        version: PHOTOSHOP_OPERATION_RESULT_VERSION,
        operationId: input.operationId,
        toolName: input.toolName,
        status: input.status,
        applicationStatus: input.applicationStatus,
        transactionState: input.transactionState,
        effect: input.effect,
        rollback: {
            attempted: input.rollbackAttempted === true,
            verified: input.rollbackVerified === true
        },
        ...(input.before ? { before: input.before } : {}),
        ...(input.after ? { after: input.after } : {}),
        ...(input.code ? { code: input.code } : {}),
        ...(input.message ? { message: input.message } : {})
    };
}

function buildFailureResult(
    toolName: string,
    params: unknown,
    code: string,
    message: string
): Record<string, unknown> & { success: false } {
    return {
        ...createToolFailureResult({
            toolName,
            error: message,
            params
        }),
        success: false,
        code
    };
}

function attachOperationResult<T extends Record<string, unknown>>(
    result: T,
    operation: PhotoshopOperationResult,
    commit?: PhotoshopMutationCommit
): T & {
    photoshopOperationResult: PhotoshopOperationResult;
    photoshopMutationCommit?: PhotoshopMutationCommit;
} {
    return {
        ...result,
        photoshopOperationResult: operation,
        ...(commit ? { photoshopMutationCommit: commit } : {})
    };
}

export function buildPhotoshopTransactionMutationOutcome<TResult, TReceipt>(
    result: TResult,
    receipt?: TReceipt
): PhotoshopTransactionMutationOutcome<TResult, TReceipt> {
    return {
        kind: 'photoshop_transaction_mutation_outcome',
        result,
        ...(receipt === undefined ? {} : { receipt })
    };
}

/**
 * 唯一 Runner 实例内部串行化所有事务，避免多个 WebSocket 请求同时拥有
 * Photoshop history suspension。executeAsModal 仍是 Host 的最终互斥边界。
 */
export class PhotoshopTransactionRunner {
    private queue: Promise<void> = Promise.resolve();

    run<
        TBefore,
        TAfter,
        TResult extends Record<string, unknown> & { success: boolean },
        TReceipt = undefined
    >(
        request: PhotoshopTransactionRequest<TBefore, TAfter, TResult, TReceipt>
    ): Promise<TResult & {
        photoshopOperationResult: PhotoshopOperationResult;
        photoshopMutationCommit?: PhotoshopMutationCommit;
    }> {
        const execution = this.queue.then(
            () => this.executeExclusive(request),
            () => this.executeExclusive(request)
        );
        this.queue = execution.then(
            () => undefined,
            () => undefined
        );
        return execution;
    }

    private async executeExclusive<
        TBefore,
        TAfter,
        TResult extends Record<string, unknown> & { success: boolean },
        TReceipt
    >(
        request: PhotoshopTransactionRequest<TBefore, TAfter, TResult, TReceipt>
    ): Promise<TResult & {
        photoshopOperationResult: PhotoshopOperationResult;
        photoshopMutationCommit?: PhotoshopMutationCommit;
    }> {
        let observedTransactionState: PhotoshopHistoryTransactionState = 'not_started';
        let observedBefore: PhotoshopMutationState | undefined;
        let observedAfter: PhotoshopMutationState | undefined;

        try {
            return await core.executeAsModal(async (
                executionContext: import('photoshop').ExecutionContext
            ): Promise<any> => {
                if (isPhotoshopTransactionCancellationRequested(
                    request.context,
                    executionContext
                )) {
                    return attachOperationResult(
                        buildFailureResult(
                            request.toolName,
                            request.params,
                            'photoshop_operation_cancelled_before_write',
                            '请求已在 Photoshop 写入开始前取消。'
                        ),
                        buildOperationResult({
                            operationId: request.operationId,
                            toolName: request.toolName,
                            status: 'failed',
                            applicationStatus: 'not_applied',
                            transactionState: 'not_started',
                            effect: 'none',
                            code: 'photoshop_operation_cancelled_before_write',
                            message: '请求已在 Photoshop 写入开始前取消。'
                        })
                    );
                }

                const actualBefore = readActualPhotoshopTarget();
                observedBefore = toMutationState(actualBefore);
                const normalizedGuard = normalizePhotoshopTargetGuard(
                    request.context?.photoshopTargetGuard
                );
                const hasRequiredDocumentBinding = Boolean(normalizedGuard);
                const hasRequiredRevisionBinding = Boolean(
                    normalizedGuard?.expectedHistoryStateRef
                    && normalizedGuard.expectedHistoryStateRef.documentId
                        === normalizedGuard.expectedDocumentId
                );
                const requiredBindingMissing = (
                    request.requiredBinding === 'document_only'
                    && !hasRequiredDocumentBinding
                ) || (
                    request.requiredBinding === 'document_revision'
                    && !hasRequiredRevisionBinding
                );
                if (requiredBindingMissing) {
                    const revisionRequired =
                        request.requiredBinding === 'document_revision';
                    const code = revisionRequired
                        ? 'photoshop_document_revision_guard_required'
                        : 'photoshop_document_guard_required';
                    // 错误信息必须给出可执行的下一步：这条最常见的触发场景是「刚切换过文档」——
                    // 切换、开关文档或写入失败后，旧文档的已读资格会按设计作废（防止改错文件），
                    // 而模型看到「必须绑定」并不知道症结在此，只会反复重试或重复观察别的文档。
                    const message = revisionRequired
                        ? '本次 Photoshop 结构写入必须绑定已观察的文档历史版本。'
                        + '最常见的原因是刚切换过目标文档（或期间发生过写入失败、文档开关），'
                        + '旧文档的读取记录已经失效。'
                        + '请对下方「当前文档」重新调用 getDocumentInfo 或 getLayerHierarchy 读取一次，再重试本次写入。'
                        : '本次 Photoshop 写入必须绑定已观察的目标文档。'
                        + '请先调用 getDocumentInfo 读取当前文档身份，再重试本次写入。';
                    return attachOperationResult(
                        buildFailureResult(
                            request.toolName,
                            request.params,
                            code,
                            message
                        ) as TResult,
                        buildOperationResult({
                            operationId: request.operationId,
                            toolName: request.toolName,
                            status: 'failed',
                            applicationStatus: 'not_applied',
                            transactionState: 'not_started',
                            effect: 'none',
                            before: observedBefore,
                            code,
                            message
                        })
                    );
                }
                const hasGuard = Boolean(request.context)
                    && Object.prototype.hasOwnProperty.call(
                        request.context,
                        'photoshopTargetGuard'
                    );
                if (hasGuard) {
                    const mismatch = checkPhotoshopTargetGuard(
                        request.context?.photoshopTargetGuard,
                        actualBefore
                    );
                    if (mismatch) {
                        const result = {
                            ...mismatch,
                            phase: 'transaction_modal'
                        } as unknown as TResult;
                        return attachOperationResult(
                            result,
                            buildOperationResult({
                                operationId: request.operationId,
                                toolName: request.toolName,
                                status: 'failed',
                                applicationStatus: 'not_applied',
                                transactionState: 'not_started',
                                effect: 'none',
                                before: observedBefore,
                                code: 'photoshop_target_changed_before_execution',
                                message: 'Photoshop 目标在事务开始前发生变化。'
                            })
                        );
                    }
                }

                const document = app.activeDocument;
                if (!document || actualBefore.documentId === null) {
                    return attachOperationResult(
                        buildFailureResult(
                            request.toolName,
                            request.params,
                            'photoshop_document_unavailable',
                            'Photoshop 当前没有可写入的活动文档。'
                        ) as TResult,
                        buildOperationResult({
                            operationId: request.operationId,
                            toolName: request.toolName,
                            status: 'failed',
                            applicationStatus: 'not_applied',
                            transactionState: 'not_started',
                            effect: 'none',
                            before: observedBefore,
                            code: 'photoshop_document_unavailable',
                            message: 'Photoshop 当前没有可写入的活动文档。'
                        })
                    );
                }

                const scope: PhotoshopTransactionScope = {
                    document,
                    executionContext,
                    beforeTarget: actualBefore
                };
                let preparation: PhotoshopTransactionPreparation<TBefore, TResult>;
                try {
                    preparation = await request.prepare(scope);
                } catch (error) {
                    const message = readErrorMessage(error);
                    return attachOperationResult(
                        buildFailureResult(
                            request.toolName,
                            request.params,
                            'photoshop_operation_preparation_failed',
                            message
                        ) as TResult,
                        buildOperationResult({
                            operationId: request.operationId,
                            toolName: request.toolName,
                            status: 'failed',
                            applicationStatus: 'not_applied',
                            transactionState: 'not_started',
                            effect: 'none',
                            before: observedBefore,
                            code: 'photoshop_operation_preparation_failed',
                            message
                        })
                    );
                }

                if (preparation.kind === 'complete') {
                    const completedStatus = preparation.result.success === false
                        ? 'failed'
                        : 'verified';
                    return attachOperationResult(
                        preparation.result,
                        buildOperationResult({
                            operationId: request.operationId,
                            toolName: request.toolName,
                            status: completedStatus,
                            applicationStatus: 'not_applied',
                            transactionState: 'not_started',
                            effect: preparation.effect,
                            before: observedBefore,
                            ...(
                                preparation.result.success === false
                                    ? {
                                        code: String(preparation.result.code || 'photoshop_operation_not_started'),
                                        message: String(preparation.result.error || 'Photoshop 写操作未开始。')
                                    }
                                    : {}
                            )
                        })
                    );
                }

                const historyMode = request.historyMode || 'suspend';
                let historySuspension: import('photoshop').HistorySuspensionId | undefined;
                if (historyMode === 'suspend') {
                    try {
                        historySuspension = await executionContext.hostControl.suspendHistory({
                            documentID: document.id,
                            name: request.commandName
                        });
                        observedTransactionState = 'suspended';
                    } catch (error) {
                        const message = readErrorMessage(error);
                        return attachOperationResult(
                            buildFailureResult(
                                request.toolName,
                                request.params,
                                'photoshop_history_suspension_failed',
                                message
                            ) as TResult,
                            buildOperationResult({
                                operationId: request.operationId,
                                toolName: request.toolName,
                                status: 'failed',
                                applicationStatus: 'not_applied',
                                transactionState: 'not_started',
                                effect: 'none',
                                before: observedBefore,
                                code: 'photoshop_history_suspension_failed',
                                message
                            })
                        );
                    }
                }

                if (isPhotoshopTransactionCancellationRequested(
                    request.context,
                    executionContext
                )) {
                    if (historySuspension) {
                        return await this.rollbackFailure({
                            request,
                            scope,
                            before: preparation.before,
                            historySuspension,
                            failure: buildFailureResult(
                                request.toolName,
                                request.params,
                                'photoshop_operation_cancelled_before_write',
                                '请求已在 Photoshop 写入前取消。'
                            ) as TResult,
                            failureStatus: 'failed',
                            beforeTarget: actualBefore,
                            observedState: (state) => {
                                observedTransactionState = state;
                            }
                        });
                    }
                    return attachOperationResult(
                        buildFailureResult(
                            request.toolName,
                            request.params,
                            'photoshop_operation_cancelled_before_write',
                            '请求已在 Photoshop 写入前取消。'
                        ) as TResult,
                        buildOperationResult({
                            operationId: request.operationId,
                            toolName: request.toolName,
                            status: 'failed',
                            applicationStatus: 'not_applied',
                            transactionState: 'not_started',
                            effect: 'none',
                            before: observedBefore,
                            code: 'photoshop_operation_cancelled_before_write',
                            message: '请求已在 Photoshop 写入前取消。'
                        })
                    );
                }

                let mutationResult: TResult | undefined;
                let mutationReceipt: TReceipt | undefined;
                let mutationError: unknown;
                if (!historySuspension) {
                    // 兼容期 direct-write 没有可回滚的 HistorySuspension。mutation 一旦开始，
                    // modal 异常就不能再被归类成“未执行”。
                    observedTransactionState = 'commit_unknown';
                }
                try {
                    const mutationOutcome = await request.mutate(
                        scope,
                        preparation.before
                    );
                    if (isPhotoshopTransactionMutationOutcome<TResult, TReceipt>(
                        mutationOutcome
                    )) {
                        mutationResult = mutationOutcome.result;
                        mutationReceipt = mutationOutcome.receipt;
                    } else {
                        mutationResult = mutationOutcome;
                    }
                    if (!isStructuredToolResult(mutationResult)) {
                        throw new Error(
                            `${request.toolName} mutation callback 未返回结构化 Tool 结果。`
                        );
                    }
                } catch (error) {
                    mutationError = error;
                }

                if (mutationError || mutationResult?.success === false) {
                    const failure = mutationResult?.success === false
                        ? mutationResult
                        : buildFailureResult(
                            request.toolName,
                            request.params,
                            'photoshop_operation_mutation_failed',
                            readErrorMessage(mutationError)
                        ) as TResult;
                    if (historySuspension) {
                        return await this.rollbackFailure({
                            request,
                            scope,
                            before: preparation.before,
                            historySuspension,
                            failure,
                            mutationResult,
                            mutationReceipt,
                            failureStatus: 'failed',
                            beforeTarget: actualBefore,
                            observedState: (state) => {
                                observedTransactionState = state;
                            }
                        });
                    }
                    const afterTarget = readActualPhotoshopTarget();
                    observedAfter = toMutationState(afterTarget);
                    const commit = buildPhotoshopMutationCommit({
                        before: observedBefore,
                        after: observedAfter,
                        bindingStrength: resolveBindingStrength(request.context),
                        toolActionCompleted: false
                    });
                    let failureStatus: PhotoshopOperationStatus = 'unknown';
                    let failureApplicationStatus: PhotoshopOperationApplicationStatus = 'unknown';
                    let failureTransactionState: PhotoshopHistoryTransactionState = 'commit_unknown';
                    let failureEffect: PhotoshopOperationEffect = 'unknown';
                    let failureCode = 'photoshop_operation_outcome_unknown';
                    if (commit.mutationObserved === true) {
                        failureTransactionState = 'committed';
                    } else if (commit.mutationObserved === false) {
                        failureStatus = 'failed';
                        failureApplicationStatus = 'not_applied';
                        failureTransactionState = 'not_started';
                        failureEffect = 'none';
                        failureCode = String(
                            failure.code || 'photoshop_operation_mutation_failed'
                        );
                    }
                    observedTransactionState = failureTransactionState;
                    return attachOperationResult(
                        failure,
                        buildOperationResult({
                            operationId: request.operationId,
                            toolName: request.toolName,
                            status: failureStatus,
                            applicationStatus: failureApplicationStatus,
                            transactionState: failureTransactionState,
                            effect: failureEffect,
                            before: observedBefore,
                            after: observedAfter,
                            code: failureCode,
                            message: String(failure.error || readErrorMessage(mutationError))
                        }),
                        commit
                    );
                }

                // 769 行失败分支已早退；走到这里说明 mutation 返回了通过 760 行结构化校验的结果。
                // try/catch 内的赋值不参与控制流收窄，在此显式断言一次，下游按 TResult 使用。
                const settledMutationResult = mutationResult as TResult;

                let readback: TAfter | undefined;
                let verification: PhotoshopTransactionVerification = { verified: false };
                let verificationError: unknown;
                try {
                    readback = await request.readState({
                        phase: 'before_commit',
                        scope,
                        before: preparation.before,
                        result: settledMutationResult,
                        receipt: mutationReceipt
                    });
                    verification = normalizeVerification(request.verifyApplied({
                        scope,
                        before: preparation.before,
                        after: readback,
                        result: settledMutationResult,
                        receipt: mutationReceipt
                    }));
                } catch (error) {
                    verificationError = error;
                }

                if (verificationError || !verification.verified) {
                    const message = verification.message
                        || readErrorMessage(verificationError)
                        || 'Photoshop 写后读回与目标状态不一致。';
                    const failure = buildFailureResult(
                        request.toolName,
                        request.params,
                        'photoshop_operation_verification_failed',
                        message
                    ) as TResult;
                    if (historySuspension) {
                        return await this.rollbackFailure({
                            request,
                            scope,
                            before: preparation.before,
                            historySuspension,
                            failure,
                            mutationResult,
                            mutationReceipt,
                            failureStatus: 'verification_failed',
                            beforeTarget: actualBefore,
                            observedState: (state) => {
                                observedTransactionState = state;
                            }
                        });
                    }
                    const afterTarget = readActualPhotoshopTarget();
                    observedAfter = toMutationState(afterTarget);
                    const commit = buildPhotoshopMutationCommit({
                        before: observedBefore,
                        after: observedAfter,
                        bindingStrength: resolveBindingStrength(request.context),
                        toolActionCompleted: true
                    });
                    let verificationStatus: PhotoshopOperationStatus = 'unknown';
                    let verificationApplicationStatus: PhotoshopOperationApplicationStatus = 'unknown';
                    let verificationTransactionState: PhotoshopHistoryTransactionState = 'commit_unknown';
                    let verificationEffect: PhotoshopOperationEffect = 'unknown';
                    let verificationCode = 'photoshop_operation_outcome_unknown';
                    if (commit.mutationObserved === true) {
                        verificationStatus = 'verification_failed';
                        verificationApplicationStatus = 'applied';
                        verificationTransactionState = 'committed';
                        verificationEffect = 'applied';
                        verificationCode = 'photoshop_operation_verification_failed';
                    } else if (commit.mutationObserved === false) {
                        verificationStatus = 'failed';
                        verificationApplicationStatus = 'not_applied';
                        verificationTransactionState = 'committed';
                        verificationEffect = 'none';
                        verificationCode = 'photoshop_operation_verification_failed';
                    }
                    observedTransactionState = verificationTransactionState;
                    return attachOperationResult(
                        failure,
                        buildOperationResult({
                            operationId: request.operationId,
                            toolName: request.toolName,
                            status: verificationStatus,
                            applicationStatus: verificationApplicationStatus,
                            transactionState: verificationTransactionState,
                            effect: verificationEffect,
                            before: observedBefore,
                            after: observedAfter,
                            code: verificationCode,
                            message
                        }),
                        commit
                    );
                }

                if (isPhotoshopTransactionCancellationRequested(
                    request.context,
                    executionContext
                )) {
                    if (historySuspension) {
                        return await this.rollbackFailure({
                            request,
                            scope,
                            before: preparation.before,
                            historySuspension,
                            failure: buildFailureResult(
                                request.toolName,
                                request.params,
                                'photoshop_operation_cancelled_before_commit',
                                '请求在写入后、提交前取消；本次修改已回滚。'
                            ) as TResult,
                            mutationResult,
                            mutationReceipt,
                            failureStatus: 'failed',
                            beforeTarget: actualBefore,
                            observedState: (state) => {
                                observedTransactionState = state;
                            }
                        });
                    }
                    const afterTarget = readActualPhotoshopTarget();
                    observedAfter = toMutationState(afterTarget);
                    const commit = buildPhotoshopMutationCommit({
                        before: observedBefore,
                        after: observedAfter,
                        bindingStrength: resolveBindingStrength(request.context),
                        toolActionCompleted: true
                    });
                    observedTransactionState = 'committed';
                    return attachOperationResult(
                        buildFailureResult(
                            request.toolName,
                            request.params,
                            'photoshop_operation_outcome_unknown',
                            '请求在无法回滚的写入完成后取消；必须重新读取 Photoshop 状态。'
                        ) as TResult,
                        buildOperationResult({
                            operationId: request.operationId,
                            toolName: request.toolName,
                            status: 'unknown',
                            applicationStatus: 'unknown',
                            transactionState: 'committed',
                            effect: 'unknown',
                            before: observedBefore,
                            after: observedAfter,
                            code: 'photoshop_operation_outcome_unknown',
                            message: '请求在无法回滚的写入完成后取消。'
                        }),
                        commit
                    );
                }

                if (historySuspension) {
                    try {
                        await executionContext.hostControl.resumeHistory(historySuspension, true);
                        observedTransactionState = 'committed';
                    } catch (error) {
                        observedTransactionState = 'commit_unknown';
                        const message = readErrorMessage(error);
                        return attachOperationResult(
                            buildFailureResult(
                                request.toolName,
                                request.params,
                                'photoshop_operation_outcome_unknown',
                                `Photoshop 提交返回异常，结果未知；不会再次回滚。${message}`
                            ) as TResult,
                            buildOperationResult({
                                operationId: request.operationId,
                                toolName: request.toolName,
                                status: 'unknown',
                                applicationStatus: 'unknown',
                                transactionState: 'commit_unknown',
                                effect: 'unknown',
                                before: observedBefore,
                                code: 'photoshop_operation_outcome_unknown',
                                message
                            })
                        );
                    }
                }

                const actualAfter = readActualPhotoshopTarget();
                observedAfter = toMutationState(actualAfter);
                observedTransactionState = 'committed';
                const commit = buildPhotoshopMutationCommit({
                    before: observedBefore,
                    after: observedAfter,
                    bindingStrength: resolveBindingStrength(request.context),
                    toolActionCompleted: true
                });

                let postCommitVerification: PhotoshopTransactionVerification = {
                    verified: false
                };
                let postCommitError: unknown;
                let postCommitReadback: TAfter | undefined;
                try {
                    postCommitReadback = await request.readState({
                        phase: 'after_commit',
                        scope,
                        before: preparation.before,
                        result: settledMutationResult,
                        receipt: mutationReceipt
                    });
                    postCommitVerification = normalizeVerification(request.verifyApplied({
                        scope,
                        before: preparation.before,
                        after: postCommitReadback,
                        result: settledMutationResult,
                        receipt: mutationReceipt
                    }));
                } catch (error) {
                    postCommitError = error;
                }
                if (postCommitError) {
                    const message = `Photoshop 已提交写入，但提交后读回不可用：${readErrorMessage(postCommitError)}`;
                    return attachOperationResult(
                        buildFailureResult(
                            request.toolName,
                            request.params,
                            'photoshop_operation_applied_readback_unavailable',
                            message
                        ) as TResult,
                        buildOperationResult({
                            operationId: request.operationId,
                            toolName: request.toolName,
                            status: 'applied',
                            applicationStatus: 'applied',
                            transactionState: 'committed',
                            effect: 'applied',
                            before: observedBefore,
                            after: observedAfter,
                            code: 'photoshop_operation_applied_readback_unavailable',
                            message
                        }),
                        commit
                    );
                }
                if (!postCommitVerification.verified) {
                    const message = postCommitVerification.message
                        || 'Photoshop 已提交写入，但提交后读回与目标状态不一致。';
                    let verificationStatus: PhotoshopOperationStatus = 'unknown';
                    let verificationApplicationStatus: PhotoshopOperationApplicationStatus = 'unknown';
                    let verificationEffect: PhotoshopOperationEffect = 'unknown';
                    if (commit.mutationObserved === true) {
                        verificationStatus = 'verification_failed';
                        verificationApplicationStatus = 'applied';
                        verificationEffect = 'applied';
                    } else if (commit.mutationObserved === false) {
                        verificationStatus = 'failed';
                        verificationApplicationStatus = 'not_applied';
                        verificationEffect = 'none';
                    }
                    return attachOperationResult(
                        buildFailureResult(
                            request.toolName,
                            request.params,
                            'photoshop_operation_committed_but_unverified',
                            message
                        ) as TResult,
                        buildOperationResult({
                            operationId: request.operationId,
                            toolName: request.toolName,
                            status: verificationStatus,
                            applicationStatus: verificationApplicationStatus,
                            transactionState: 'committed',
                            effect: verificationEffect,
                            before: observedBefore,
                            after: observedAfter,
                            code: 'photoshop_operation_committed_but_unverified',
                            message
                        }),
                        commit
                    );
                }

                if (request.expectedEffect === 'mutation_required'
                    && commit.mutationObserved !== true) {
                    const message = 'Photoshop 写入回调已返回，但未观察到文档历史版本变化。';
                    const expectedMutationStatus: PhotoshopOperationStatus =
                        commit.mutationObserved === false ? 'failed' : 'unknown';
                    const expectedMutationApplicationStatus: PhotoshopOperationApplicationStatus =
                        commit.mutationObserved === false ? 'not_applied' : 'unknown';
                    const expectedMutationEffect: PhotoshopOperationEffect =
                        commit.mutationObserved === false ? 'none' : 'unknown';
                    return attachOperationResult(
                        buildFailureResult(
                            request.toolName,
                            request.params,
                            'photoshop_operation_expected_mutation_missing',
                            message
                        ) as TResult,
                        buildOperationResult({
                            operationId: request.operationId,
                            toolName: request.toolName,
                            status: expectedMutationStatus,
                            applicationStatus: expectedMutationApplicationStatus,
                            transactionState: 'committed',
                            effect: expectedMutationEffect,
                            before: observedBefore,
                            after: observedAfter,
                            code: 'photoshop_operation_expected_mutation_missing',
                            message
                        }),
                        commit
                    );
                }

                let verifiedResult: TResult = settledMutationResult;
                if (request.buildVerifiedResult && postCommitReadback !== undefined) {
                    try {
                        verifiedResult = request.buildVerifiedResult({
                            scope,
                            before: preparation.before,
                            after: postCommitReadback,
                            result: settledMutationResult,
                            receipt: mutationReceipt
                        });
                        if (!isStructuredToolResult(verifiedResult)
                            || verifiedResult.success !== true) {
                            throw new Error(
                                'buildVerifiedResult 必须返回 success=true 的结构化 Tool 结果。'
                            );
                        }
                    } catch (error) {
                        const message = `Photoshop 已提交写入，但无法从真实读回构造结果：${readErrorMessage(error)}`;
                        return attachOperationResult(
                            buildFailureResult(
                                request.toolName,
                                request.params,
                                'photoshop_operation_applied_result_projection_failed',
                                message
                            ) as TResult,
                            buildOperationResult({
                                operationId: request.operationId,
                                toolName: request.toolName,
                                status: commit.mutationObserved === true
                                    ? 'applied'
                                    : 'unknown',
                                applicationStatus: commit.mutationObserved === true
                                    ? 'applied'
                                    : 'unknown',
                                transactionState: 'committed',
                                effect: commit.mutationObserved === true
                                    ? 'applied'
                                    : 'unknown',
                                before: observedBefore,
                                after: observedAfter,
                                code: 'photoshop_operation_applied_result_projection_failed',
                                message
                            }),
                            commit
                        );
                    }
                }

                let successApplicationStatus: PhotoshopOperationApplicationStatus = 'unknown';
                let successEffect: PhotoshopOperationEffect = 'unknown';
                if (commit.mutationObserved === true) {
                    successApplicationStatus = 'applied';
                    successEffect = 'applied';
                } else if (commit.mutationObserved === false) {
                    successApplicationStatus = 'not_applied';
                    successEffect = 'already_satisfied';
                }
                return attachOperationResult(
                    verifiedResult,
                    buildOperationResult({
                        operationId: request.operationId,
                        toolName: request.toolName,
                        status: 'verified',
                        applicationStatus: successApplicationStatus,
                        transactionState: 'committed',
                        effect: successEffect,
                        before: observedBefore,
                        after: observedAfter
                    }),
                    commit
                );
            }, { commandName: request.commandName });
        } catch (error) {
            const message = readErrorMessage(error);
            const operation = buildOperationResult({
                operationId: request.operationId,
                toolName: request.toolName,
                status: observedTransactionState === 'not_started' ? 'failed' : 'unknown',
                applicationStatus: observedTransactionState === 'not_started'
                    ? 'not_applied'
                    : 'unknown',
                transactionState: observedTransactionState,
                effect: observedTransactionState === 'not_started' ? 'none' : 'unknown',
                before: observedBefore,
                after: observedAfter,
                code: observedTransactionState === 'not_started'
                    ? 'photoshop_transaction_modal_failed'
                    : 'photoshop_operation_outcome_unknown',
                message
            });
            return attachOperationResult(
                buildFailureResult(
                    request.toolName,
                    request.params,
                    operation.code || 'photoshop_transaction_modal_failed',
                    message
                ) as TResult,
                operation
            );
        }
    }

    private async rollbackFailure<
        TBefore,
        TAfter,
        TResult extends Record<string, unknown> & { success: boolean },
        TReceipt
    >(input: {
        request: PhotoshopTransactionRequest<TBefore, TAfter, TResult, TReceipt>;
        scope: PhotoshopTransactionScope;
        before: TBefore;
        historySuspension: import('photoshop').HistorySuspensionId;
        failure: TResult;
        mutationResult?: TResult;
        mutationReceipt?: TReceipt;
        failureStatus: 'failed' | 'verification_failed';
        beforeTarget: PhotoshopTargetIdentity;
        observedState(state: PhotoshopHistoryTransactionState): void;
    }): Promise<TResult & {
        photoshopOperationResult: PhotoshopOperationResult;
        photoshopMutationCommit?: PhotoshopMutationCommit;
    }> {
        const rollback = await this.rollbackSuspendedHistory({
            request: input.request,
            scope: input.scope,
            before: input.before,
            historySuspension: input.historySuspension,
            beforeTarget: input.beforeTarget,
            mutationResult: input.mutationResult,
            mutationReceipt: input.mutationReceipt
        });
        input.observedState(rollback.transactionState);
        const beforeState = toMutationState(input.beforeTarget);
        const afterState = rollback.afterTarget
            ? toMutationState(rollback.afterTarget)
            : undefined;

        if (!rollback.verified) {
            const message = rollback.message
                || 'Photoshop 回滚结果无法验证；必须重新读取当前文档，禁止重放写入。';
            return attachOperationResult(
                buildFailureResult(
                    input.request.toolName,
                    input.request.params,
                    'photoshop_operation_outcome_unknown',
                    message
                ) as TResult,
                buildOperationResult({
                    operationId: input.request.operationId,
                    toolName: input.request.toolName,
                    status: 'unknown',
                    applicationStatus: 'unknown',
                    transactionState: rollback.transactionState,
                    effect: 'unknown',
                    rollbackAttempted: true,
                    rollbackVerified: false,
                    before: beforeState,
                    after: afterState,
                    code: 'photoshop_operation_outcome_unknown',
                    message
                })
            );
        }

        const code = String(
            input.failure.code
            || (input.failureStatus === 'verification_failed'
                ? 'photoshop_operation_verification_failed'
                : 'photoshop_operation_failed')
        );
        return attachOperationResult(
            input.failure,
            buildOperationResult({
                operationId: input.request.operationId,
                toolName: input.request.toolName,
                status: 'failed',
                applicationStatus: 'not_applied',
                transactionState: 'rolled_back',
                effect: 'rolled_back',
                rollbackAttempted: true,
                rollbackVerified: true,
                before: beforeState,
                after: afterState,
                code,
                message: String(input.failure.error || 'Photoshop 写操作失败并已回滚。')
            })
        );
    }

    private async rollbackSuspendedHistory<
        TBefore,
        TAfter,
        TResult extends Record<string, unknown> & { success: boolean },
        TReceipt
    >(input: {
        request: PhotoshopTransactionRequest<TBefore, TAfter, TResult, TReceipt>;
        scope: PhotoshopTransactionScope;
        before: TBefore;
        historySuspension: import('photoshop').HistorySuspensionId;
        beforeTarget: PhotoshopTargetIdentity;
        mutationResult?: TResult;
        mutationReceipt?: TReceipt;
    }): Promise<RollbackOutcome<TAfter>> {
        try {
            await input.scope.executionContext.hostControl.resumeHistory(
                input.historySuspension,
                false
            );
        } catch (error) {
            return {
                transactionState: 'rollback_unknown',
                verified: false,
                message: `Photoshop 回滚返回异常：${readErrorMessage(error)}`
            };
        }

        let after: TAfter;
        let verification: PhotoshopTransactionVerification;
        let afterTarget: PhotoshopTargetIdentity;
        try {
            afterTarget = readActualPhotoshopTarget();
            after = await input.request.readState({
                phase: 'after_rollback',
                scope: input.scope,
                before: input.before,
                result: input.mutationResult,
                receipt: input.mutationReceipt
            });
            const customVerification = input.request.verifyRolledBack
                ? normalizeVerification(input.request.verifyRolledBack({
                    scope: input.scope,
                    before: input.before,
                    after,
                    result: input.mutationResult,
                    receipt: input.mutationReceipt
                }))
                : { verified: true };
            verification = {
                verified: sameRollbackTargetState(
                    toMutationState(input.beforeTarget),
                    toMutationState(afterTarget),
                    input.request.rollbackTargetPolicy
                        || 'document_revision_and_active_layer'
                ) && customVerification.verified,
                ...(customVerification.message
                    ? { message: customVerification.message }
                    : {})
            };
        } catch (error) {
            return {
                transactionState: 'rolled_back',
                verified: false,
                message: `Photoshop 已执行回滚，但回滚读回失败：${readErrorMessage(error)}`
            };
        }

        return {
            transactionState: 'rolled_back',
            verified: verification.verified,
            after,
            afterTarget,
            ...(verification.message ? { message: verification.message } : {})
        };
    }
}

export const photoshopTransactionRunner = new PhotoshopTransactionRunner();

/**
 * 兼容已有矩形/椭圆工具的薄适配器。实际 modal 与结果分类仍由唯一 Runner 持有；
 * 后续迁移这些 Tool 时只需补充各自的结构读回与可回滚 history 模式。
 */
export async function executePhotoshopMutation<
    T extends Record<string, unknown> & { success: boolean }
>(input: ExecutePhotoshopMutationInput<T>): Promise<any> {
    return await photoshopTransactionRunner.run<
        PhotoshopMutationState | undefined,
        PhotoshopMutationState | undefined,
        T
    >({
        operationId: `${input.toolName}:${String(input.context?.requestId || Date.now())}`,
        toolName: input.toolName,
        commandName: input.commandName,
        params: input.params,
        context: input.context,
        historyMode: 'none',
        expectedEffect: input.expectedEffect,
        prepare(scope) {
            return {
                kind: 'ready',
                before: toMutationState(scope.beforeTarget)
            };
        },
        mutate: async (scope, before) => {
            return await input.mutate({
                document: scope.document,
                before
            });
        },
        readState() {
            return toMutationState(readActualPhotoshopTarget());
        },
        verifyApplied({ before, after }) {
            if (!before || !after) return false;
            if (input.expectedEffect === 'mutation_required') {
                return !sameMutationState(before, after);
            }
            return true;
        }
    });
}

/**
 * 新建文档的 Host 提交事实。
 *
 * 文档创建前可能没有活动文档，因此不能伪造 before history state。调用方必须在同一
 * executeAsModal 内读取创建前文档集合、执行 make，并读取创建后的活动文档状态。
 */
export function buildPhotoshopDocumentCreationCommit(input: {
    beforeOpenDocumentIds: readonly number[];
    actualAfter: PhotoshopTargetIdentity;
    createdDocumentId?: number | null;
    toolActionCompleted: boolean;
}): PhotoshopMutationCommit | undefined {
    const beforeOpenDocumentIds = Array.from(new Set(input.beforeOpenDocumentIds
        .filter((documentId) => Number.isSafeInteger(documentId) && documentId > 0)))
        .sort((left, right) => left - right);
    const after = toMutationState(input.actualAfter);
    if (!after
        || beforeOpenDocumentIds.includes(after.documentId)
        || (Number.isSafeInteger(input.createdDocumentId)
            && input.createdDocumentId !== after.documentId)) {
        return undefined;
    }
    return {
        version: PHOTOSHOP_MUTATION_COMMIT_VERSION,
        basis: 'same_execute_as_modal',
        bindingStrength: 'unguarded',
        changeKind: 'document_creation',
        beforeOpenDocumentIds,
        createdDocumentId: after.documentId,
        after,
        toolActionCompleted: input.toolActionCompleted,
        mutationObserved: true,
        documentChanged: true
    };
}

export function attachPhotoshopMutationCommit<T extends Record<string, unknown>>(
    result: T,
    commit: PhotoshopMutationCommit
): T & { photoshopMutationCommit: PhotoshopMutationCommit } {
    return {
        ...result,
        photoshopMutationCommit: commit
    };
}
