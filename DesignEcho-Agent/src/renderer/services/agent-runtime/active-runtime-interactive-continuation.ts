import type { RuntimeTaskRunInteractionBinding } from '../../../shared/agent-runtime-v5/runtime-session';
import {
    validateRuntimeInteractiveCheckpoint,
    validateRuntimeInteractiveReentry,
    type RuntimeInteractiveCheckpoint,
    type RuntimeInteractiveReentry
} from '../../../shared/agent-runtime-v5/runtime-interactive-reentry';

export const RUNTIME_INTERACTIVE_CHECKPOINT_RESERVATION_VERSION =
    'runtime-interactive-checkpoint-reservation/v0' as const;

export interface RuntimeInteractiveCheckpointReservation {
    version: typeof RUNTIME_INTERACTIVE_CHECKPOINT_RESERVATION_VERSION;
    reservationId: string;
    continuationId: string;
    taskRunBinding: RuntimeTaskRunInteractionBinding;
    mode: 'execute_skill' | 'resume_agent';
}

export interface RuntimeInteractivePendingReentry {
    reentry: RuntimeInteractiveReentry;
    reentryTask: string;
}

interface ActiveRuntimeInteractiveCheckpointEntry {
    checkpoint: RuntimeInteractiveCheckpoint;
    pendingReentry?: RuntimeInteractivePendingReentry;
    reservation?: RuntimeInteractiveCheckpointReservation;
}

export type RuntimeInteractiveCheckpointReservationResult =
    | {
        status: 'reserved';
        checkpoint: RuntimeInteractiveCheckpoint;
        reservation: RuntimeInteractiveCheckpointReservation;
        pendingReentry?: RuntimeInteractivePendingReentry;
    }
    | { status: 'missing' }
    | { status: 'busy' };

const checkpoints = new Map<string, ActiveRuntimeInteractiveCheckpointEntry>();

function cleanId(value: unknown): string {
    return String(value || '').trim().slice(0, 160);
}

function sameBinding(
    left: RuntimeTaskRunInteractionBinding,
    right: RuntimeTaskRunInteractionBinding
): boolean {
    return left.taskRunId === right.taskRunId
        && left.runId === right.runId
        && left.generation === right.generation
        && left.interactionId === right.interactionId
        && left.planRevision === right.planRevision;
}

function sameTaskRunLineage(
    left: RuntimeTaskRunInteractionBinding,
    right: RuntimeTaskRunInteractionBinding
): boolean {
    return left.taskRunId === right.taskRunId
        && left.runId === right.runId
        && left.generation === right.generation
        && left.planRevision === right.planRevision;
}

function createReservationId(continuationId: string): string {
    const nonce = typeof globalThis.crypto?.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : Math.random().toString(36).slice(2, 14);
    return `${cleanId(continuationId)}:${Date.now().toString(36)}:${nonce || 'reservation'}`;
}

function reservationMatches(
    current: RuntimeInteractiveCheckpointReservation | undefined,
    expected: RuntimeInteractiveCheckpointReservation
): boolean {
    return Boolean(
        current
        && current.version === expected.version
        && current.reservationId === expected.reservationId
        && current.continuationId === expected.continuationId
        && current.mode === expected.mode
        && sameBinding(current.taskRunBinding, expected.taskRunBinding)
    );
}

export function registerActiveRuntimeInteractiveCheckpoint(
    checkpoint: RuntimeInteractiveCheckpoint
): void {
    const validation = validateRuntimeInteractiveCheckpoint(checkpoint);
    if (!validation.ok) throw new Error(validation.issues.join(','));
    const continuationId = cleanId(checkpoint.continuationId);
    const existing = checkpoints.get(continuationId);
    if (existing && !sameBinding(existing.checkpoint.taskRunBinding, checkpoint.taskRunBinding)) {
        throw new Error('runtime_interactive_checkpoint_owner_conflict');
    }
    if (existing?.reservation) {
        throw new Error('runtime_interactive_checkpoint_reservation_active');
    }
    if (existing?.pendingReentry) {
        throw new Error('runtime_interactive_checkpoint_pending_reentry_active');
    }
    checkpoints.set(continuationId, { checkpoint });
}

export function readActiveRuntimeInteractiveCheckpoint(input: {
    continuationId: string;
    taskRunBinding: RuntimeTaskRunInteractionBinding;
}): RuntimeInteractiveCheckpoint | undefined {
    const entry = checkpoints.get(cleanId(input.continuationId));
    if (!entry || !sameBinding(entry.checkpoint.taskRunBinding, input.taskRunBinding)) {
        return undefined;
    }
    return entry.checkpoint;
}

export function reserveActiveRuntimeInteractiveCheckpoint(input: {
    continuationId: string;
    taskRunBinding: RuntimeTaskRunInteractionBinding;
}): RuntimeInteractiveCheckpointReservationResult {
    const continuationId = cleanId(input.continuationId);
    const entry = checkpoints.get(continuationId);
    if (!entry || !sameBinding(entry.checkpoint.taskRunBinding, input.taskRunBinding)) {
        return { status: 'missing' };
    }
    if (entry.reservation) return { status: 'busy' };
    const reservation: RuntimeInteractiveCheckpointReservation = {
        version: RUNTIME_INTERACTIVE_CHECKPOINT_RESERVATION_VERSION,
        reservationId: createReservationId(continuationId),
        continuationId,
        taskRunBinding: input.taskRunBinding,
        mode: entry.pendingReentry ? 'resume_agent' : 'execute_skill'
    };
    checkpoints.set(continuationId, { ...entry, reservation });
    return {
        status: 'reserved',
        checkpoint: entry.checkpoint,
        reservation,
        ...(entry.pendingReentry ? { pendingReentry: entry.pendingReentry } : {})
    };
}

export function stageActiveRuntimeInteractivePendingReentry(input: {
    reservation: RuntimeInteractiveCheckpointReservation;
    pendingReentry: RuntimeInteractivePendingReentry;
}): RuntimeInteractiveCheckpointReservation | undefined {
    const continuationId = cleanId(input.reservation.continuationId);
    const entry = checkpoints.get(continuationId);
    if (!entry
        || input.reservation.mode !== 'execute_skill'
        || !reservationMatches(entry.reservation, input.reservation)) {
        return undefined;
    }
    const validation = validateRuntimeInteractiveReentry(input.pendingReentry.reentry);
    if (!validation.ok || !String(input.pendingReentry.reentryTask || '').trim()) {
        throw new Error(validation.issues.join(',') || 'runtime_interactive_reentry_task_missing');
    }
    if (input.pendingReentry.reentry.continuationId !== continuationId
        || !sameBinding(
            input.pendingReentry.reentry.taskRunBinding,
            entry.checkpoint.taskRunBinding
        )) {
        throw new Error('runtime_interactive_pending_reentry_binding_mismatch');
    }
    const reservation: RuntimeInteractiveCheckpointReservation = {
        ...input.reservation,
        mode: 'resume_agent'
    };
    checkpoints.set(continuationId, {
        ...entry,
        pendingReentry: input.pendingReentry,
        reservation
    });
    return reservation;
}

export function refreshActiveRuntimeInteractivePendingReentry(input: {
    reservation: RuntimeInteractiveCheckpointReservation;
    pendingReentry: RuntimeInteractivePendingReentry;
}): boolean {
    const continuationId = cleanId(input.reservation.continuationId);
    const entry = checkpoints.get(continuationId);
    if (!entry
        || input.reservation.mode !== 'resume_agent'
        || !entry.pendingReentry
        || !reservationMatches(entry.reservation, input.reservation)) {
        return false;
    }
    const validation = validateRuntimeInteractiveReentry(input.pendingReentry.reentry);
    if (!validation.ok || !String(input.pendingReentry.reentryTask || '').trim()) {
        throw new Error(validation.issues.join(',') || 'runtime_interactive_reentry_task_missing');
    }
    if (input.pendingReentry.reentry.continuationId !== continuationId
        || !sameBinding(
            input.pendingReentry.reentry.taskRunBinding,
            entry.checkpoint.taskRunBinding
        )) {
        throw new Error('runtime_interactive_pending_reentry_binding_mismatch');
    }
    checkpoints.set(continuationId, {
        ...entry,
        pendingReentry: input.pendingReentry
    });
    return true;
}

/**
 * Post-Skill staging 的最后恢复出口：把当前 reservation 原子降级为无 reservation 的
 * recovery pendingReentry。旧 checkpoint、TaskRun identity 与 writer owner 都保留，
 * 下一次只允许 resume_agent，不会重新执行 Skill。
 */
export function abortActiveRuntimeInteractiveCheckpointToPersistentRecovery(input: {
    reservation: RuntimeInteractiveCheckpointReservation;
    pendingReentry: RuntimeInteractivePendingReentry;
}): boolean {
    const continuationId = cleanId(input.reservation.continuationId);
    const entry = checkpoints.get(continuationId);
    if (!entry || !reservationMatches(entry.reservation, input.reservation)) return false;
    const validation = validateRuntimeInteractiveReentry(input.pendingReentry.reentry);
    if (!validation.ok || !String(input.pendingReentry.reentryTask || '').trim()) {
        throw new Error(validation.issues.join(',') || 'runtime_interactive_recovery_task_missing');
    }
    if (input.pendingReentry.reentry.continuationId !== continuationId
        || !sameBinding(
            input.pendingReentry.reentry.taskRunBinding,
            entry.checkpoint.taskRunBinding
        )) {
        throw new Error('runtime_interactive_recovery_binding_mismatch');
    }
    checkpoints.set(continuationId, {
        checkpoint: entry.checkpoint,
        pendingReentry: input.pendingReentry
    });
    return true;
}

/**
 * 同一 TaskRun 连续确认时，在 checkpoint owner 内同步完成“新 interaction 注册 + 旧
 * reservation 消费”。任何校验失败都不改变旧 entry，调用方随后可把旧 reservation
 * 原子升级为 reconciliation pendingReentry。
 */
export function swapActiveRuntimeInteractiveCheckpointForChainedConfirmation(input: {
    reservation: RuntimeInteractiveCheckpointReservation;
    nextCheckpoint: RuntimeInteractiveCheckpoint;
}): boolean {
    const validation = validateRuntimeInteractiveCheckpoint(input.nextCheckpoint);
    if (!validation.ok) throw new Error(validation.issues.join(','));
    const currentContinuationId = cleanId(input.reservation.continuationId);
    const nextContinuationId = cleanId(input.nextCheckpoint.continuationId);
    const entry = checkpoints.get(currentContinuationId);
    if (!entry
        || input.reservation.mode !== 'execute_skill'
        || !reservationMatches(entry.reservation, input.reservation)
        || nextContinuationId === currentContinuationId
        || input.nextCheckpoint.taskRunBinding.interactionId === entry.checkpoint.taskRunBinding.interactionId
        || !sameTaskRunLineage(
            entry.checkpoint.taskRunBinding,
            input.nextCheckpoint.taskRunBinding
        )
        || checkpoints.has(nextContinuationId)) {
        return false;
    }
    checkpoints.delete(currentContinuationId);
    checkpoints.set(nextContinuationId, { checkpoint: input.nextCheckpoint });
    return true;
}

export function cancelActiveRuntimeInteractiveCheckpointReservation(
    reservation: RuntimeInteractiveCheckpointReservation
): boolean {
    const continuationId = cleanId(reservation.continuationId);
    const entry = checkpoints.get(continuationId);
    if (!entry || !reservationMatches(entry.reservation, reservation)) return false;
    checkpoints.set(continuationId, {
        checkpoint: entry.checkpoint,
        ...(entry.pendingReentry ? { pendingReentry: entry.pendingReentry } : {})
    });
    return true;
}

export function adoptActiveRuntimeInteractiveCheckpointReservation(
    reservation: RuntimeInteractiveCheckpointReservation
): boolean {
    const continuationId = cleanId(reservation.continuationId);
    const entry = checkpoints.get(continuationId);
    if (!entry
        || reservation.mode !== 'resume_agent'
        || !entry.pendingReentry
        || !reservationMatches(entry.reservation, reservation)) {
        return false;
    }
    checkpoints.delete(continuationId);
    return true;
}

export function commitActiveRuntimeInteractiveCheckpointReservation(
    reservation: RuntimeInteractiveCheckpointReservation
): boolean {
    const continuationId = cleanId(reservation.continuationId);
    const entry = checkpoints.get(continuationId);
    if (!entry || !reservationMatches(entry.reservation, reservation)) return false;
    checkpoints.delete(continuationId);
    return true;
}
