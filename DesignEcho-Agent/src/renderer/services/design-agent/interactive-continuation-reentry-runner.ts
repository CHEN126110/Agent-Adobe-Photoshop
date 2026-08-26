import type { AgentReActObservation } from '../../../shared/agent-react-observation-contract';
import {
    resolveInteractiveContinuationMutationState,
    type InteractiveContinuationMutationState,
    type InteractiveContinuationOperationIdentity
} from '../../../shared/interactive-continuation-operation';
import type { InteractiveContinuationResolution } from '../../../shared/pending-interactive-continuation';
import type { SkillExecutionRuntimeLineage } from '../../../shared/skill-execution-effect';
import {
    canReleaseRuntimeSessionDocumentWriter,
    claimRuntimeTaskRunWriterBinding,
    releaseRuntimeTaskRunWriterBinding
} from '../../../shared/agent-runtime-v5/runtime-session';
import {
    beginInteractiveContinuationOperation,
    markInteractiveContinuationOperationUnknown,
    settleInteractiveContinuationOperation
} from '../interactive-continuation-operation-client';
import type { AgentResult } from '../agent-orchestration/types';
import {
    abortRuntimeInteractiveResumeToPersistentRecovery,
    adoptRuntimeInteractiveResume,
    cancelRuntimeInteractiveResume,
    commitRuntimeInteractiveResume,
    buildRuntimeInteractiveSkillExecutionLineage,
    buildRuntimeInteractivePostSkillRecovery,
    registerRuntimeInteractiveChainedConfirmation,
    resolveRuntimeInteractiveHandoff,
    stageRuntimeInteractiveReentry,
    type RuntimeInteractivePhotoshopObservation,
    type RuntimeInteractiveResumePreparation
} from './interactive-continuation-reentry-controller';

type AcceptedContinuation = Extract<InteractiveContinuationResolution, { status: 'accepted' }>;
type ReadyResume = Extract<RuntimeInteractiveResumePreparation, { status: 'ready' }>;

function attachAgentReActObservation(
    result: AgentResult,
    observation: AgentReActObservation
): AgentResult {
    const data = result.data && typeof result.data === 'object'
        ? result.data as Record<string, unknown>
        : {};
    return { ...result, data: { ...data, agentReActObservation: observation } };
}

export type RuntimeInteractiveContinuationRunResult =
    | {
        kind: 'blocked';
        phase: 'writer' | 'ledger_begin' | 'ledger_settlement';
        code: string;
        message: string;
        mutationState?: InteractiveContinuationMutationState;
        operationSucceeded?: boolean;
        recoveryStatus?:
            | 'pending_reentry'
            | 'persistence_pending'
            | 'operation_unknown_persisted'
            | 'operation_unknown_persistence_failed';
    }
    | {
        kind: 'direct_result';
        result: AgentResult;
        settlementStatus?: string;
    }
    | {
        kind: 'agent_result';
        result: AgentResult;
        adopted: boolean;
        continuationStatus: 'awaiting_confirmation' | 'executed' | 'failed' | 'unknown';
    };

function buildExecutionRunId(requestId: string | undefined, continuationId: string): string {
    const normalizedRequestId = String(requestId || '').trim();
    if (normalizedRequestId) return normalizedRequestId;
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return `interactive-continuation-${globalThis.crypto.randomUUID()}`;
    }
    return `interactive-continuation-${Date.now().toString(36)}-${continuationId}`;
}

function releaseWriter(resolution: AcceptedContinuation): void {
    const binding = resolution.taskRunBinding;
    if (!binding) return;
    releaseRuntimeTaskRunWriterBinding({
        taskRunId: binding.taskRunId,
        runId: binding.runId,
        generation: binding.generation
    });
}

async function readPostSkillObservation(
    readPhotoshopObservation: () => Promise<RuntimeInteractivePhotoshopObservation>
): Promise<RuntimeInteractivePhotoshopObservation> {
    try {
        return await readPhotoshopObservation();
    } catch (error) {
        console.warn('[InteractiveContinuation] Skill 后 Photoshop 版本读取失败，按未知现场结算：', error);
        return { status: 'unavailable' };
    }
}

async function abortPostSkillToPersistentUnknown(input: {
    reservation: ReadyResume['reservation'];
    preparation: ReadyResume;
    resolution: AcceptedContinuation;
    message: string;
    photoshopObservationAfterSkill: RuntimeInteractivePhotoshopObservation;
}): Promise<Extract<RuntimeInteractiveContinuationRunResult, { kind: 'blocked' }>> {
    const recovery = buildRuntimeInteractivePostSkillRecovery({
        preparation: input.preparation,
        resolution: input.resolution,
        message: input.message,
        photoshopObservationAfterSkill: input.photoshopObservationAfterSkill
    });
    let checkpointPreserved = false;
    if (recovery.reentry && recovery.reentryTask) {
        checkpointPreserved = abortRuntimeInteractiveResumeToPersistentRecovery({
            reservation: input.reservation,
            reentry: recovery.reentry,
            reentryTask: recovery.reentryTask
        });
    }
    const markedUnknown = await markInteractiveContinuationOperationUnknown(
        input.resolution.continuation.id,
        input.message
    );
    if (checkpointPreserved && markedUnknown.success) {
        return {
            kind: 'blocked',
            phase: 'ledger_settlement',
            code: 'runtime_interactive_recovery_pending',
            message: '执行状态已经转入原 TaskRun 的恢复队列；下次只会继续 Agent 对账，不会重放 Skill。',
            mutationState: 'unknown',
            operationSucceeded: false,
            recoveryStatus: 'pending_reentry'
        };
    }
    if (checkpointPreserved) {
        return {
            kind: 'blocked',
            phase: 'ledger_settlement',
            code: markedUnknown.code || 'runtime_interactive_unknown_persistence_pending',
            message: '原 TaskRun 的恢复进度已保留，但持久化操作状态仍未闭合；下次会先重试对账，不会重放 Skill。',
            mutationState: 'unknown',
            operationSucceeded: false,
            recoveryStatus: 'persistence_pending'
        };
    }
    if (markedUnknown.success) {
        return {
            kind: 'blocked',
            phase: 'ledger_settlement',
            code: 'runtime_interactive_operation_unknown_persisted',
            message: '原 Runtime checkpoint 已不可恢复；操作账本已标记为 unknown，系统不会自动重放 Skill。',
            mutationState: 'unknown',
            operationSucceeded: false,
            recoveryStatus: 'operation_unknown_persisted'
        };
    }
    return {
        kind: 'blocked',
        phase: 'ledger_settlement',
        code: markedUnknown.code || 'runtime_interactive_operation_unknown_persistence_failed',
        message: '原 Runtime checkpoint 与持久化 unknown 标记都未能闭合；writer 保持占用，禁止自动重放或继续写入。',
        mutationState: 'unknown',
        operationSucceeded: false,
        recoveryStatus: 'operation_unknown_persistence_failed'
    };
}

export function resolveRuntimeInteractiveAgentContinuationStatus(input: {
    result: AgentResult;
    adopted: boolean;
}): RuntimeInteractiveContinuationRunResult & { kind: 'agent_result' } {
    const data = input.result.data && typeof input.result.data === 'object'
        ? input.result.data as Record<string, unknown>
        : {};
    let continuationStatus: 'awaiting_confirmation' | 'executed' | 'failed' | 'unknown' = 'failed';
    if (!input.adopted) {
        continuationStatus = 'failed';
    } else if (data.awaitingUserConfirmation === true
        || data.stopReason === 'awaiting_user_confirmation') {
        continuationStatus = 'awaiting_confirmation';
    } else if (input.result.success === true
        && data.executionSummary
        && (data.executionSummary as { status?: string }).status === 'completed') {
        continuationStatus = 'executed';
    } else if (input.adopted
        && resolveInteractiveContinuationMutationState(input.result) === 'unknown') {
        continuationStatus = 'unknown';
    }
    return {
        kind: 'agent_result',
        result: input.result,
        adopted: input.adopted,
        continuationStatus
    };
}

export async function runRuntimeInteractiveContinuation(input: {
    requestId?: string;
    operationIdentity: InteractiveContinuationOperationIdentity;
    resolution: AcceptedContinuation;
    preparation: ReadyResume;
    executeSkill: (lineage: SkillExecutionRuntimeLineage) => Promise<AgentResult>;
    readPhotoshopObservation: () => Promise<RuntimeInteractivePhotoshopObservation>;
    executeAgentReentry: (input: {
        reentry: NonNullable<ReturnType<typeof resolveRuntimeInteractiveHandoff>['reentry']>;
        reentryTask: string;
        adopt: () => boolean;
    }) => Promise<AgentResult>;
}): Promise<RuntimeInteractiveContinuationRunResult> {
    let reservation = input.preparation.reservation;
    let writerAcquiredByThisRun = false;
    const writerExpectedRevision = input.preparation.mode === 'resume_agent'
        ? input.preparation.reentry.session.taskRun.documentBinding?.expectedRevision
        : input.resolution.taskRunBinding?.expectedRevision;
    if (input.resolution.taskRunBinding && writerExpectedRevision) {
        const writerDecision = claimRuntimeTaskRunWriterBinding({
            taskRunId: input.resolution.taskRunBinding.taskRunId,
            runId: input.resolution.taskRunBinding.runId,
            generation: input.resolution.taskRunBinding.generation,
            expectedRevision: writerExpectedRevision
        });
        if (!writerDecision.allowed) {
            cancelRuntimeInteractiveResume(reservation);
            return {
                kind: 'blocked',
                phase: 'writer',
                code: writerDecision.code || 'runtime_task_run_writer_rejected',
                message: writerDecision.status === 'conflict'
                    ? '另一个 TaskRun 已持有当前 Photoshop 文档的写入身份；这张确认卡本轮不会执行。'
                    : '这张确认卡绑定的 Photoshop 历史版本已经失效；重新观察前不会自动重放旧写入。'
            };
        }
        writerAcquiredByThisRun = writerDecision.status === 'acquired';
    }

    if (input.preparation.mode === 'resume_agent'
        && input.preparation.reentry.session.taskRun.sideEffectState?.status === 'unknown') {
        const markedUnknown = await markInteractiveContinuationOperationUnknown(
            input.resolution.continuation.id,
            '恢复 Agent 前重试持久化 post-Skill unknown 状态。'
        );
        if (!markedUnknown.success) {
            cancelRuntimeInteractiveResume(reservation);
            return {
                kind: 'blocked',
                phase: 'ledger_settlement',
                code: markedUnknown.code || 'runtime_interactive_unknown_persistence_pending',
                message: '原 TaskRun 恢复进度仍在，但持久化操作状态尚未闭合；本轮不会进入 Agent，也不会重放 Skill。',
                mutationState: 'unknown',
                operationSucceeded: false,
                recoveryStatus: 'persistence_pending'
            };
        }
    }

    let reentry = input.preparation.mode === 'resume_agent'
        ? input.preparation.reentry
        : undefined;
    let reentryTask = input.preparation.mode === 'resume_agent'
        ? input.preparation.reentryTask
        : undefined;
    if (input.preparation.mode === 'execute_skill') {
        const executionRunId = buildExecutionRunId(
            input.requestId,
            input.resolution.continuation.id
        );
        const begin = await beginInteractiveContinuationOperation({
            ...input.operationIdentity,
            executionRunId
        });
        if (!begin.success) {
            cancelRuntimeInteractiveResume(reservation);
            if (writerAcquiredByThisRun) releaseWriter(input.resolution);
            return {
                kind: 'blocked',
                phase: 'ledger_begin',
                code: begin.code || 'interactive_continuation_operation_begin_failed',
                message: begin.message || '确认操作没有取得唯一执行权，本轮不会写入 Photoshop。'
            };
        }

        let skillResult: AgentResult | undefined;
        let handoff: ReturnType<typeof resolveRuntimeInteractiveHandoff>;
        let mutationState: InteractiveContinuationMutationState = 'unknown';
        let postSkillFailureMessage = '';
        const skillExecutionLineage = buildRuntimeInteractiveSkillExecutionLineage({
            preparation: input.preparation,
            resolution: input.resolution
        });
        try {
            skillResult = await input.executeSkill(skillExecutionLineage);
        } catch (error) {
            postSkillFailureMessage = error instanceof Error
                ? error.message
                : String(error || '执行异常');
        }
        const photoshopObservationAfterSkill = await readPostSkillObservation(
            input.readPhotoshopObservation
        );
        if (skillResult) {
            mutationState = resolveInteractiveContinuationMutationState(
                skillResult,
                skillExecutionLineage
            );
            try {
                handoff = resolveRuntimeInteractiveHandoff({
                    preparation: input.preparation,
                    resolution: input.resolution,
                    result: skillResult,
                    photoshopObservationAfterSkill
                });
            } catch (error) {
                postSkillFailureMessage = error instanceof Error
                    ? error.message
                    : String(error || '交接状态无效');
                mutationState = 'unknown';
                handoff = buildRuntimeInteractivePostSkillRecovery({
                    preparation: input.preparation,
                    resolution: input.resolution,
                    message: postSkillFailureMessage,
                    photoshopObservationAfterSkill
                });
            }
        } else {
            handoff = buildRuntimeInteractivePostSkillRecovery({
                preparation: input.preparation,
                resolution: input.resolution,
                message: postSkillFailureMessage,
                photoshopObservationAfterSkill
            });
        }
        const result = skillResult
            ? attachAgentReActObservation(skillResult, handoff.observation)
            : {
                success: false,
                nonFatal: true,
                message: handoff.observation.summary,
                error: postSkillFailureMessage,
                data: { agentReActObservation: handoff.observation }
            };
        let summary = String(skillResult?.error || skillResult?.message || postSkillFailureMessage || '执行失败');
        if (handoff.reentry) {
            summary = String(handoff.observation.summary || '确认结果已交还原 Agent 继续处理');
        } else if (skillResult?.success === true) {
            summary = String(skillResult.message || skillResult.skillOutcome?.status || '执行完成');
        }
        const settlement = await settleInteractiveContinuationOperation({
            ...input.operationIdentity,
            status: handoff.operationSucceeded ? 'succeeded' : 'failed',
            mutationState,
            executionRunId,
            summary
        });
        if (!settlement.success) {
            return await abortPostSkillToPersistentUnknown({
                reservation,
                preparation: input.preparation,
                resolution: input.resolution,
                message: settlement.message,
                photoshopObservationAfterSkill
            });
        }
        if (mutationState === 'unknown'
            && (!handoff.reentry || !handoff.reentryTask)) {
            handoff = buildRuntimeInteractivePostSkillRecovery({
                preparation: input.preparation,
                resolution: input.resolution,
                message: settlement.message,
                photoshopObservationAfterSkill
            });
            mutationState = 'unknown';
        }
        if (!handoff.reentry || !handoff.reentryTask) {
            let outcomeStatus: 'executed' | 'failed' | 'awaiting_confirmation' | 'unknown' = 'failed';
            if (settlement.record?.status === 'unknown') {
                outcomeStatus = 'unknown';
            } else if (skillResult?.skillOutcome?.status === 'awaiting_confirmation') {
                outcomeStatus = 'awaiting_confirmation';
            } else if (skillResult?.success === true) {
                outcomeStatus = 'executed';
            }
            let chainedConfirmation: ReturnType<
                typeof registerRuntimeInteractiveChainedConfirmation
            >;
            if (outcomeStatus === 'awaiting_confirmation' && skillResult) {
                try {
                    chainedConfirmation = registerRuntimeInteractiveChainedConfirmation({
                        preparation: input.preparation,
                        reservation,
                        resolution: input.resolution,
                        result: skillResult,
                        photoshopObservationAfterSkill
                    });
                } catch (error) {
                    handoff = buildRuntimeInteractivePostSkillRecovery({
                        preparation: input.preparation,
                        resolution: input.resolution,
                        message: error instanceof Error
                            ? error.message
                            : String(error || '下一确认点无法绑定'),
                        photoshopObservationAfterSkill
                    });
                    mutationState = 'unknown';
                }
            }
            if (!handoff.reentry || !handoff.reentryTask) {
                if (!chainedConfirmation && !commitRuntimeInteractiveResume(reservation)) {
                    return await abortPostSkillToPersistentUnknown({
                        reservation,
                        preparation: input.preparation,
                        resolution: input.resolution,
                        message: 'runtime_interactive_checkpoint_commit_failed',
                        photoshopObservationAfterSkill
                    });
                }
                if (canReleaseRuntimeSessionDocumentWriter({
                    session: input.preparation.session,
                    ownerHasExecutionControl: true,
                    outcome: outcomeStatus,
                    mutationState
                })) {
                    releaseWriter(input.resolution);
                }
                return {
                    kind: 'direct_result',
                    result: chainedConfirmation?.result || result,
                    settlementStatus: outcomeStatus
                };
            }
        }
        let stagedReservation: ReturnType<typeof stageRuntimeInteractiveReentry>;
        let stageFailureMessage = '';
        try {
            stagedReservation = stageRuntimeInteractiveReentry({
                reservation,
                reentry: handoff.reentry,
                reentryTask: handoff.reentryTask
            });
        } catch (error) {
            stageFailureMessage = error instanceof Error
                ? error.message
                : String(error || '交接状态无效');
        }
        if (!stagedReservation) {
            return await abortPostSkillToPersistentUnknown({
                reservation,
                preparation: input.preparation,
                resolution: input.resolution,
                message: stageFailureMessage || 'runtime_interactive_reconciliation_stage_failed',
                photoshopObservationAfterSkill
            });
        }
        reservation = stagedReservation;
        reentry = handoff.reentry;
        reentryTask = handoff.reentryTask;
    }

    if (!reentry || !reentryTask) {
        throw new Error('runtime_interactive_reentry_missing_after_settlement');
    }
    let adopted = false;
    let agentResult: AgentResult;
    try {
        agentResult = await input.executeAgentReentry({
            reentry,
            reentryTask,
            adopt: () => {
                adopted = adoptRuntimeInteractiveResume(reservation);
                return adopted;
            }
        });
    } catch (error) {
        if (!adopted) cancelRuntimeInteractiveResume(reservation);
        throw error;
    }
    if (!adopted) cancelRuntimeInteractiveResume(reservation);
    const result = resolveRuntimeInteractiveAgentContinuationStatus({
        result: agentResult,
        adopted
    });
    // adopt 之后 writer 生命周期由 Agent 的 RuntimeSession 收尾唯一负责；runner 不再二次释放。
    return result;
}
