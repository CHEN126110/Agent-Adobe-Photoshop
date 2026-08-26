import {
    buildAgentReActObservationFromSkillResult,
    type AgentReActObservation
} from '../../../shared/agent-react-observation-contract';
import type { AgentResult } from '../agent-orchestration/types';
import type { InteractiveContinuationResolution } from '../../../shared/pending-interactive-continuation';
import type { PhotoshopHistoryStateRef } from '../../../shared/photoshop-history-state-ref';
import {
    RUNTIME_INTERACTIVE_CHECKPOINT_VERSION,
    RUNTIME_INTERACTIVE_REENTRY_VERSION,
    buildRuntimeInteractiveReentryTask,
    createRuntimeInteractiveBoundaries,
    isRuntimeInteractiveAgentHandoff,
    validateRuntimeInteractiveReentry,
    type RuntimeInteractiveCheckpoint,
    type RuntimeInteractiveReentry
} from '../../../shared/agent-runtime-v5/runtime-interactive-reentry';
import {
    markRuntimeSessionSkillEffectUnknown,
    reconcileRuntimeSessionDocumentRevision,
    recordRuntimeSessionSkillRevisionTransition,
    resumeRuntimeSessionInteraction,
    suspendRuntimeSessionForInteraction,
    type RuntimeSession,
    type RuntimeTaskRunInteractionBinding
} from '../../../shared/agent-runtime-v5/runtime-session';
import {
    isSkillExecutionReceiptBoundToLineage,
    readSkillExecutionEffectReceipt,
    type SkillExecutionEffectReceipt,
    type SkillExecutionRuntimeLineage
} from '../../../shared/skill-execution-effect';
import {
    attachRuntimeTaskRunBindingToPendingContinuationResult,
    resolvePendingInteractiveContinuationLeaf,
    resolvePendingInteractiveContinuationPauseRevision,
    type PendingInteractiveContinuation
} from '../../../shared/pending-interactive-continuation';
import {
    abortActiveRuntimeInteractiveCheckpointToPersistentRecovery,
    adoptActiveRuntimeInteractiveCheckpointReservation,
    cancelActiveRuntimeInteractiveCheckpointReservation,
    commitActiveRuntimeInteractiveCheckpointReservation,
    refreshActiveRuntimeInteractivePendingReentry,
    reserveActiveRuntimeInteractiveCheckpoint,
    stageActiveRuntimeInteractivePendingReentry,
    swapActiveRuntimeInteractiveCheckpointForChainedConfirmation,
    type RuntimeInteractiveCheckpointReservation
} from '../agent-runtime/active-runtime-interactive-continuation';

type AcceptedContinuation = Extract<InteractiveContinuationResolution, { status: 'accepted' }>;

export type RuntimeInteractivePhotoshopObservation =
    | { status: 'revision'; revision: PhotoshopHistoryStateRef }
    | { status: 'no_document' }
    | { status: 'unavailable' };

export function buildRuntimeInteractivePhotoshopObservation(input: {
    hasDocument?: boolean;
    historyStateRef?: PhotoshopHistoryStateRef;
} | undefined): RuntimeInteractivePhotoshopObservation {
    switch (input?.hasDocument) {
        case true:
            return input.historyStateRef
                ? { status: 'revision', revision: input.historyStateRef }
                : { status: 'unavailable' };
        case false:
            return { status: 'no_document' };
        default:
            return { status: 'unavailable' };
    }
}

export type RuntimeInteractiveResumePreparation =
    | { status: 'not_applicable' }
    | { status: 'checkpoint_missing'; code: 'runtime_interactive_checkpoint_missing' }
    | { status: 'resume_rejected'; code: string }
    | {
        status: 'ready';
        mode: 'execute_skill';
        checkpoint: RuntimeInteractiveCheckpoint;
        session: RuntimeSession;
        reservation: RuntimeInteractiveCheckpointReservation;
    }
    | {
        status: 'ready';
        mode: 'resume_agent';
        checkpoint: RuntimeInteractiveCheckpoint;
        reentry: RuntimeInteractiveReentry;
        reentryTask: string;
        reservation: RuntimeInteractiveCheckpointReservation;
    };

export interface RuntimeInteractiveHandoffDecision {
    observation: AgentReActObservation;
    operationSucceeded: boolean;
    reentry?: RuntimeInteractiveReentry;
    reentryTask?: string;
    effect: SkillExecutionEffectReceipt['effect'] | 'missing';
}

export function buildRuntimeInteractiveSkillExecutionLineage(input: {
    preparation: Extract<RuntimeInteractiveResumePreparation, { status: 'ready'; mode: 'execute_skill' }>;
    resolution: AcceptedContinuation;
}): SkillExecutionRuntimeLineage {
    const checkpoint = input.preparation.checkpoint;
    return {
        version: 'skill-execution-runtime-lineage/v0',
        sessionId: checkpoint.session.identity.sessionId,
        runId: checkpoint.session.identity.runId,
        generation: checkpoint.session.identity.generation,
        taskRunId: checkpoint.session.taskRun.taskRunId,
        planRevision: checkpoint.session.taskRun.planRevision,
        continuationId: input.resolution.continuation.id,
        workflowCallId: checkpoint.workflowHandoff.workflowCallId,
        skillId: input.resolution.skillId
    };
}

function reconcileSkillEffect(input: {
    session: RuntimeSession;
    plan: RuntimeInteractiveCheckpoint['plan'];
    continuationId: string;
    skillId: string;
    receipt?: SkillExecutionEffectReceipt;
    expectedLineage: SkillExecutionRuntimeLineage;
    photoshopObservation: RuntimeInteractivePhotoshopObservation;
}): RuntimeSession {
    const receipt = isSkillExecutionReceiptBoundToLineage(
        input.receipt,
        input.expectedLineage
    ) ? input.receipt : undefined;
    const observedRevision = input.photoshopObservation.status === 'revision'
        ? input.photoshopObservation.revision
        : undefined;
    const revisions = receipt?.revisions || [];
    const hasIncompleteRevision = revisions.some((transition) => !transition.toolActionCompleted);
    let projectedSession = input.session;
    let operationStateUnknown = false;
    if ((receipt?.effect === 'applied' || receipt?.effect === 'partial')
        && revisions.length > 0) {
        projectedSession = revisions.reduce((session, transition, index) => (
            recordRuntimeSessionSkillRevisionTransition({
                session,
                projectionId: `${input.continuationId}:skill-effect:${index}`,
                workflowToolName: input.skillId,
                transition
            })
        ), input.session);
        operationStateUnknown = projectedSession.taskRun.documentBinding?.conflict?.kind
            === 'operation_state_unknown';
    } else if (receipt?.effect !== 'none') {
        projectedSession = markRuntimeSessionSkillEffectUnknown({
            session: input.session,
            workflowToolName: input.skillId,
            observedRevision,
            runtimeLineage: input.expectedLineage
        });
        operationStateUnknown = true;
    }
    if (hasIncompleteRevision) {
        const conflictKind = projectedSession.taskRun.documentBinding?.conflict?.kind;
        if (conflictKind !== 'writer_conflict') {
            projectedSession = markRuntimeSessionSkillEffectUnknown({
                session: projectedSession,
                workflowToolName: input.skillId,
                observedRevision: observedRevision || revisions[revisions.length - 1]?.after,
                runtimeLineage: input.expectedLineage
            });
        }
        operationStateUnknown = true;
    }
    if (operationStateUnknown) return projectedSession;
    if (input.photoshopObservation.status === 'no_document'
        && !projectedSession.taskRun.documentBinding) {
        return projectedSession;
    }
    if (!observedRevision) {
        return markRuntimeSessionSkillEffectUnknown({
            session: projectedSession,
            workflowToolName: input.skillId,
            runtimeLineage: input.expectedLineage
        });
    }
    return reconcileRuntimeSessionDocumentRevision({
        session: projectedSession,
        plan: input.plan,
        revision: observedRevision
    });
}

function buildReentry(input: {
    checkpoint: RuntimeInteractiveCheckpoint;
    session: RuntimeSession;
    resolution: AcceptedContinuation;
    observation: AgentReActObservation;
}): RuntimeInteractiveReentry {
    if (input.checkpoint.workflowToolName !== input.resolution.skillId) {
        throw new Error('runtime_interactive_reentry_workflow_owner_mismatch');
    }
    const submission = input.resolution.submission;
    if (input.checkpoint.session.taskRun.pendingInteraction?.cardId !== submission.cardId) {
        throw new Error('runtime_interactive_reentry_card_binding_mismatch');
    }
    const reentry: RuntimeInteractiveReentry = {
        version: RUNTIME_INTERACTIVE_REENTRY_VERSION,
        continuationId: input.checkpoint.continuationId,
        workflowToolName: input.checkpoint.workflowToolName,
        sourceTask: input.checkpoint.sourceTask,
        taskRunBinding: input.checkpoint.taskRunBinding,
        session: input.session,
        plan: input.checkpoint.plan,
        declarations: input.checkpoint.declarations,
        workflowHandoff: input.checkpoint.workflowHandoff,
        ...(input.checkpoint.actionPlanExecutionJournal
            ? { actionPlanExecutionJournal: input.checkpoint.actionPlanExecutionJournal }
            : {}),
        observation: input.observation,
        confirmedSubmission: {
            version: submission.version,
            cardId: submission.cardId,
            kind: submission.kind,
            submittedAt: submission.submittedAt,
            value: submission.value,
            validation: submission.validation
        },
        ...(input.checkpoint.artifactAuthorizationToken
            ? { artifactAuthorizationToken: input.checkpoint.artifactAuthorizationToken }
            : {}),
        boundaries: createRuntimeInteractiveBoundaries()
    };
    const validation = validateRuntimeInteractiveReentry(reentry);
    if (!validation.ok) throw new Error(validation.issues.join(','));
    return reentry;
}

/**
 * Skill 已经取得执行权后抛异常时，不能再把原卡片恢复成可重放 Skill。
 * 这里把异常投影为 operation unknown，并构造同一 TaskRun 的 Agent reconciliation handoff；
 * 它不授予 Tool，也不声明 Skill 成功。
 */
export function buildRuntimeInteractivePostSkillRecovery(input: {
    preparation: RuntimeInteractiveResumePreparation;
    resolution: AcceptedContinuation;
    message: string;
    photoshopObservationAfterSkill: RuntimeInteractivePhotoshopObservation;
}): RuntimeInteractiveHandoffDecision {
    if (input.preparation.status !== 'ready'
        || input.preparation.mode !== 'execute_skill') {
        throw new Error('runtime_interactive_post_skill_recovery_without_execution_owner');
    }
    const observedRevision = input.photoshopObservationAfterSkill.status === 'revision'
        ? input.photoshopObservationAfterSkill.revision
        : undefined;
    const runtimeLineage = buildRuntimeInteractiveSkillExecutionLineage({
        preparation: input.preparation,
        resolution: input.resolution
    });
    const session = markRuntimeSessionSkillEffectUnknown({
        session: input.preparation.session,
        workflowToolName: input.resolution.skillId,
        observedRevision,
        runtimeLineage
    });
    const detail = String(input.message || '工作流执行中断').replace(/\s+/g, ' ').trim().slice(0, 320);
    const observation: AgentReActObservation = {
        version: 'agent-react-observation/v0',
        actionId: `skill:${input.resolution.skillId}`,
        kind: 'skill',
        label: `Skill 行动观察：${input.resolution.skillId}`,
        status: 'needs_repair',
        summary: '工作流执行中断，写入结果尚未确认；必须先对账当前 Photoshop 现场。',
        details: detail ? [detail] : [],
        blockers: ['原 Skill 已经开始执行，不能自动重放。'],
        warnings: ['当前修改状态按 unknown 保留。'],
        nextAction: 'repair',
        sourceStatus: 'runtime_interactive_post_skill_exception'
    };
    const reentry = buildReentry({
        checkpoint: input.preparation.checkpoint,
        session,
        resolution: input.resolution,
        observation
    });
    return {
        observation,
        operationSucceeded: false,
        reentry,
        reentryTask: buildRuntimeInteractiveReentryTask(reentry),
        effect: 'unknown'
    };
}

export interface RuntimeInteractiveChainedConfirmation {
    result: AgentResult;
    continuation: PendingInteractiveContinuation;
    session: RuntimeSession;
}

/**
 * 同一 Workflow 在消费一张卡后又返回下一张确认卡时，沿用当前 RuntimeSession 暂停新
 * interaction，并先注册新 checkpoint 再让旧 checkpoint commit。它不创建新 Runtime，
 * 也不允许跨 Skill owner 链接。
 */
export function registerRuntimeInteractiveChainedConfirmation(input: {
    preparation: RuntimeInteractiveResumePreparation;
    reservation: RuntimeInteractiveCheckpointReservation;
    resolution: AcceptedContinuation;
    result: AgentResult;
    photoshopObservationAfterSkill: RuntimeInteractivePhotoshopObservation;
}): RuntimeInteractiveChainedConfirmation | undefined {
    if (input.preparation.status !== 'ready'
        || input.preparation.mode !== 'execute_skill') {
        return undefined;
    }
    const continuation = resolvePendingInteractiveContinuationLeaf(input.result);
    if (!continuation) return undefined;
    const checkpoint = input.preparation.checkpoint;
    if (continuation.id === checkpoint.continuationId) {
        throw new Error('runtime_interactive_chained_continuation_reused_id');
    }
    if (continuation.operation.skillId !== checkpoint.workflowToolName
        || continuation.operation.skillId !== input.resolution.skillId) {
        throw new Error('runtime_interactive_chained_continuation_owner_mismatch');
    }
    const expectedLineage = buildRuntimeInteractiveSkillExecutionLineage({
        preparation: input.preparation,
        resolution: input.resolution
    });
    const receiptCandidate = readSkillExecutionEffectReceipt(input.result);
    const receipt = isSkillExecutionReceiptBoundToLineage(receiptCandidate, expectedLineage)
        ? receiptCandidate
        : undefined;
    const reconciledSession = reconcileSkillEffect({
        session: input.preparation.session,
        plan: checkpoint.plan,
        continuationId: input.resolution.continuation.id,
        skillId: input.resolution.skillId,
        receipt,
        expectedLineage,
        photoshopObservation: input.photoshopObservationAfterSkill
    });
    const pauseRevision = resolvePendingInteractiveContinuationPauseRevision(continuation);
    const continuationDocumentId = Number(continuation.scope.photoshopDocumentId || 0);
    const runtimeRevision = reconciledSession.taskRun.documentBinding?.expectedRevision;
    const compatibleRuntimeRevision = runtimeRevision
        && (continuationDocumentId <= 0 || runtimeRevision.documentId === continuationDocumentId)
        ? runtimeRevision
        : undefined;
    const suspension = suspendRuntimeSessionForInteraction({
        session: reconciledSession,
        interactionId: continuation.id,
        continuationId: continuation.id,
        cardId: continuation.card.id,
        nodeId: reconciledSession.taskRun.currentNodeId,
        expectedRevision: pauseRevision || compatibleRuntimeRevision,
        inheritSessionExpectedRevision: false
    });
    const projectedResult = attachRuntimeTaskRunBindingToPendingContinuationResult({
        result: input.result,
        binding: suspension.binding
    }) as AgentResult;
    const boundContinuation = resolvePendingInteractiveContinuationLeaf(projectedResult);
    if (!boundContinuation?.taskRunBinding) {
        throw new Error('runtime_interactive_chained_continuation_binding_missing');
    }
    const projectedData = projectedResult.data && typeof projectedResult.data === 'object'
        ? projectedResult.data as Record<string, unknown>
        : {};
    const result: AgentResult = {
        ...projectedResult,
        data: {
            ...projectedData,
            awaitingUserConfirmation: true,
            pendingInteractiveContinuation: boundContinuation,
            runtimeSession: suspension.session
        }
    };
    const nextCheckpoint: RuntimeInteractiveCheckpoint = {
        version: RUNTIME_INTERACTIVE_CHECKPOINT_VERSION,
        continuationId: boundContinuation.id,
        workflowToolName: boundContinuation.operation.skillId,
        sourceTask: checkpoint.sourceTask,
        taskRunBinding: boundContinuation.taskRunBinding,
        session: suspension.session,
        plan: checkpoint.plan,
        declarations: checkpoint.declarations,
        workflowHandoff: {
            ...checkpoint.workflowHandoff,
            workflowToolName: boundContinuation.operation.skillId,
            binding: {
                sessionId: suspension.session.identity.sessionId,
                runId: suspension.session.identity.runId,
                generation: suspension.session.identity.generation,
                stage: suspension.session.stageState.currentStage
            }
        },
        ...(checkpoint.actionPlanExecutionJournal
            ? { actionPlanExecutionJournal: checkpoint.actionPlanExecutionJournal }
            : {}),
        ...(checkpoint.artifactAuthorizationToken
            ? { artifactAuthorizationToken: checkpoint.artifactAuthorizationToken }
            : {}),
        registeredAt: new Date().toISOString(),
        boundaries: createRuntimeInteractiveBoundaries()
    };
    if (!swapActiveRuntimeInteractiveCheckpointForChainedConfirmation({
        reservation: input.reservation,
        nextCheckpoint
    })) {
        throw new Error('runtime_interactive_chained_checkpoint_swap_failed');
    }
    return {
        result,
        continuation: boundContinuation,
        session: suspension.session
    };
}

export function prepareRuntimeInteractiveResume(input: {
    continuationId: string;
    taskRunBinding?: RuntimeTaskRunInteractionBinding;
    photoshopObservation: RuntimeInteractivePhotoshopObservation;
}): RuntimeInteractiveResumePreparation {
    const binding = input.taskRunBinding;
    if (!binding) return { status: 'not_applicable' };
    const reservationResult = reserveActiveRuntimeInteractiveCheckpoint({
        continuationId: input.continuationId,
        taskRunBinding: binding
    });
    if (reservationResult.status === 'missing') {
        return { status: 'checkpoint_missing', code: 'runtime_interactive_checkpoint_missing' };
    }
    if (reservationResult.status === 'busy') {
        return { status: 'resume_rejected', code: 'runtime_interactive_checkpoint_busy' };
    }
    const { checkpoint, reservation, pendingReentry } = reservationResult;
    if (pendingReentry) {
        let refreshedSession = pendingReentry.reentry.session;
        const operationStateUnknown = refreshedSession.taskRun.documentBinding?.conflict?.kind
            === 'operation_state_unknown';
        if (input.photoshopObservation.status === 'revision' && !operationStateUnknown) {
            refreshedSession = reconcileRuntimeSessionDocumentRevision({
                session: refreshedSession,
                plan: checkpoint.plan,
                revision: input.photoshopObservation.revision
            });
        } else if (input.photoshopObservation.status === 'unavailable'
            || refreshedSession.taskRun.documentBinding) {
            refreshedSession = markRuntimeSessionSkillEffectUnknown({
                session: refreshedSession,
                workflowToolName: checkpoint.workflowToolName
            });
        }
        const reentry: RuntimeInteractiveReentry = {
            ...pendingReentry.reentry,
            session: refreshedSession
        };
        const validation = validateRuntimeInteractiveReentry(reentry);
        if (!validation.ok) {
            cancelActiveRuntimeInteractiveCheckpointReservation(reservation);
            return {
                status: 'resume_rejected',
                code: validation.issues.join(',') || 'runtime_interactive_pending_reentry_invalid'
            };
        }
        const reentryTask = buildRuntimeInteractiveReentryTask(reentry);
        if (!refreshActiveRuntimeInteractivePendingReentry({
            reservation,
            pendingReentry: { reentry, reentryTask }
        })) {
            cancelActiveRuntimeInteractiveCheckpointReservation(reservation);
            return {
                status: 'resume_rejected',
                code: 'runtime_interactive_pending_reentry_refresh_failed'
            };
        }
        return {
            status: 'ready',
            mode: 'resume_agent',
            checkpoint,
            reservation,
            reentry,
            reentryTask
        };
    }
    if ((input.photoshopObservation.status === 'unavailable'
            && checkpoint.session.taskRun.documentBinding)
        || (input.photoshopObservation.status === 'no_document'
            && checkpoint.session.taskRun.documentBinding)) {
        cancelActiveRuntimeInteractiveCheckpointReservation(reservation);
        return {
            status: 'resume_rejected',
            code: input.photoshopObservation.status === 'no_document'
                ? 'runtime_interactive_target_document_missing'
                : 'runtime_interactive_photoshop_observation_unavailable'
        };
    }
    const resume = resumeRuntimeSessionInteraction({
        session: checkpoint.session,
        plan: checkpoint.plan,
        taskRunId: binding.taskRunId,
        interactionId: binding.interactionId,
        observedRevision: input.photoshopObservation.status === 'revision'
            ? input.photoshopObservation.revision
            : undefined
    });
    if (resume.status !== 'resumed') {
        cancelActiveRuntimeInteractiveCheckpointReservation(reservation);
        return { status: 'resume_rejected', code: resume.code || 'runtime_task_run_resume_rejected' };
    }
    return {
        status: 'ready',
        mode: 'execute_skill',
        checkpoint,
        session: resume.session,
        reservation
    };
}

export function resolveRuntimeInteractiveHandoff(input: {
    preparation: RuntimeInteractiveResumePreparation;
    resolution: AcceptedContinuation;
    result: AgentResult;
    photoshopObservationAfterSkill: RuntimeInteractivePhotoshopObservation;
}): RuntimeInteractiveHandoffDecision {
    const observation = buildAgentReActObservationFromSkillResult({
        skillId: input.resolution.skillId,
        result: input.result
    });
    const receipt = readSkillExecutionEffectReceipt(input.result);
    const expectedLineage = input.preparation.status === 'ready'
        && input.preparation.mode === 'execute_skill'
        ? buildRuntimeInteractiveSkillExecutionLineage({
            preparation: input.preparation,
            resolution: input.resolution
        })
        : undefined;
    const trustedReceipt = expectedLineage
        && isSkillExecutionReceiptBoundToLineage(receipt, expectedLineage)
        ? receipt
        : undefined;
    const handoff = input.preparation.status === 'ready'
        && input.preparation.mode === 'execute_skill'
        && isRuntimeInteractiveAgentHandoff(observation);
    if (!handoff
        || input.preparation.status !== 'ready'
        || input.preparation.mode !== 'execute_skill') {
        return {
            observation,
            operationSucceeded: input.result.success === true,
            effect: trustedReceipt?.effect || 'missing'
        };
    }
    const session = reconcileSkillEffect({
        session: input.preparation.session,
        plan: input.preparation.checkpoint.plan,
        continuationId: input.resolution.continuation.id,
        skillId: input.resolution.skillId,
        receipt: trustedReceipt,
        expectedLineage: expectedLineage!,
        photoshopObservation: input.photoshopObservationAfterSkill
    });
    const reentry = buildReentry({
        checkpoint: input.preparation.checkpoint,
        session,
        resolution: input.resolution,
        observation
    });
    return {
        observation,
        operationSucceeded: true,
        reentry,
        reentryTask: buildRuntimeInteractiveReentryTask(reentry),
        effect: trustedReceipt?.effect || 'missing'
    };
}

export function stageRuntimeInteractiveReentry(input: {
    reservation: RuntimeInteractiveCheckpointReservation;
    reentry: RuntimeInteractiveReentry;
    reentryTask: string;
}): RuntimeInteractiveCheckpointReservation | undefined {
    return stageActiveRuntimeInteractivePendingReentry({
        reservation: input.reservation,
        pendingReentry: {
            reentry: input.reentry,
            reentryTask: input.reentryTask
        }
    });
}

export function abortRuntimeInteractiveResumeToPersistentRecovery(input: {
    reservation: RuntimeInteractiveCheckpointReservation;
    reentry: RuntimeInteractiveReentry;
    reentryTask: string;
}): boolean {
    return abortActiveRuntimeInteractiveCheckpointToPersistentRecovery({
        reservation: input.reservation,
        pendingReentry: {
            reentry: input.reentry,
            reentryTask: input.reentryTask
        }
    });
}

export function cancelRuntimeInteractiveResume(
    reservation: RuntimeInteractiveCheckpointReservation
): boolean {
    return cancelActiveRuntimeInteractiveCheckpointReservation(reservation);
}

export function adoptRuntimeInteractiveResume(
    reservation: RuntimeInteractiveCheckpointReservation
): boolean {
    return adoptActiveRuntimeInteractiveCheckpointReservation(reservation);
}

export function commitRuntimeInteractiveResume(
    reservation: RuntimeInteractiveCheckpointReservation
): boolean {
    return commitActiveRuntimeInteractiveCheckpointReservation(reservation);
}
