import {
    cleanInteractiveCardText,
    type InteractiveCardSubmission
} from '../interactive-card-contract';
import type { AgentReActObservation } from '../agent-react-observation-contract';
import type { AgentWorkflowContinuationBinding } from '../agent-workflow-continuation-scope';
import type { RuntimeActionPlanExecutionJournal } from './runtime-action-plan-observation';
import type { RuntimePlanningDeclarations } from './runtime-planning-context-seed';
import {
    validateRuntimeTaskRunInteractionBinding,
    type RuntimeSession,
    type RuntimeTaskRunInteractionBinding
} from './runtime-session';
import type { RuntimeStagePlan } from './runtime-stage-plan';

export const RUNTIME_INTERACTIVE_CHECKPOINT_VERSION =
    'runtime-interactive-checkpoint/v0' as const;
export const RUNTIME_INTERACTIVE_REENTRY_VERSION =
    'runtime-interactive-reentry/v0' as const;
export const RUNTIME_INTERACTIVE_HANDOFF_IDENTITY_VERSION =
    'runtime-interactive-handoff-identity/v0' as const;

export interface RuntimeInteractiveHandoffIdentity {
    version: typeof RUNTIME_INTERACTIVE_HANDOFF_IDENTITY_VERSION;
    workflowToolName: string;
    workflowCallId: string;
    binding: AgentWorkflowContinuationBinding;
}

export interface RuntimeInteractiveActionPlanJournalCheckpoint {
    planRevision: number;
    journal: RuntimeActionPlanExecutionJournal;
}

export interface RuntimeInteractiveBoundaries {
    activeSessionOnly: true;
    resumesExistingTaskRunOnly: true;
    userSubmissionFrozen: true;
    executesTools: false;
    grantsPermission: false;
    createsTaskRun: false;
    categoryNeutral: true;
}

export interface RuntimeInteractiveCheckpoint {
    version: typeof RUNTIME_INTERACTIVE_CHECKPOINT_VERSION;
    continuationId: string;
    workflowToolName: string;
    sourceTask: string;
    taskRunBinding: RuntimeTaskRunInteractionBinding;
    session: RuntimeSession;
    plan: RuntimeStagePlan;
    declarations: RuntimePlanningDeclarations;
    workflowHandoff: RuntimeInteractiveHandoffIdentity;
    actionPlanExecutionJournal?: RuntimeInteractiveActionPlanJournalCheckpoint;
    artifactAuthorizationToken?: string;
    registeredAt: string;
    boundaries: RuntimeInteractiveBoundaries;
}

export interface RuntimeInteractiveReentry {
    version: typeof RUNTIME_INTERACTIVE_REENTRY_VERSION;
    continuationId: string;
    workflowToolName: string;
    sourceTask: string;
    taskRunBinding: RuntimeTaskRunInteractionBinding;
    session: RuntimeSession;
    plan: RuntimeStagePlan;
    declarations: RuntimePlanningDeclarations;
    workflowHandoff: RuntimeInteractiveHandoffIdentity;
    actionPlanExecutionJournal?: RuntimeInteractiveActionPlanJournalCheckpoint;
    observation: AgentReActObservation;
    confirmedSubmission: Pick<
        InteractiveCardSubmission,
        'version' | 'cardId' | 'kind' | 'submittedAt' | 'value' | 'validation'
    >;
    artifactAuthorizationToken?: string;
    boundaries: RuntimeInteractiveBoundaries;
}

export interface RuntimeInteractiveValidation {
    ok: boolean;
    issues: string[];
}

function cleanToken(value: unknown, limit = 160): string {
    return String(value || '').trim().slice(0, limit);
}

function hasValidBoundaries(value: RuntimeInteractiveBoundaries | undefined): boolean {
    return value?.activeSessionOnly === true
        && value.resumesExistingTaskRunOnly === true
        && value.userSubmissionFrozen === true
        && value.executesTools === false
        && value.grantsPermission === false
        && value.createsTaskRun === false
        && value.categoryNeutral === true;
}

function validateWorkflowHandoffIdentity(input: {
    handoff: RuntimeInteractiveHandoffIdentity | undefined;
    workflowToolName: string;
    session: RuntimeSession;
    plan: RuntimeStagePlan;
}): string[] {
    const issues: string[] = [];
    const handoff = input.handoff;
    if (!handoff || handoff.version !== RUNTIME_INTERACTIVE_HANDOFF_IDENTITY_VERSION) {
        return ['runtime_interactive_handoff_identity_missing_or_invalid'];
    }
    if (!cleanToken(handoff.workflowCallId) || !cleanToken(handoff.workflowToolName, 80)) {
        issues.push('runtime_interactive_handoff_call_identity_missing');
    }
    if (handoff.workflowToolName !== input.workflowToolName) {
        issues.push('runtime_interactive_handoff_workflow_mismatch');
    }
    const binding = handoff.binding;
    if (binding.sessionId !== input.session.identity.sessionId
        || binding.runId !== input.session.identity.runId
        || binding.generation !== input.session.identity.generation) {
        issues.push('runtime_interactive_handoff_runtime_binding_mismatch');
    }
    if (!binding.stage
        || !input.plan.steps.some((step) => step.stage === binding.stage)) {
        issues.push('runtime_interactive_handoff_source_stage_invalid');
    }
    return issues;
}

function validateActionPlanJournalCheckpoint(input: {
    declarations: RuntimePlanningDeclarations;
    taskRunPlanRevision: number;
    checkpoint?: RuntimeInteractiveActionPlanJournalCheckpoint;
}): string[] {
    const issues: string[] = [];
    const hasActionPlan = Boolean(input.declarations.actionPlan);
    const checkpoint = input.checkpoint;
    if (!hasActionPlan && checkpoint) {
        issues.push('runtime_interactive_action_plan_journal_without_plan');
        return issues;
    }
    if (hasActionPlan && !checkpoint) {
        issues.push('runtime_interactive_action_plan_journal_missing');
        return issues;
    }
    if (!checkpoint) return issues;
    if (!Number.isSafeInteger(checkpoint.planRevision)
        || checkpoint.planRevision !== input.taskRunPlanRevision) {
        issues.push('runtime_interactive_action_plan_journal_revision_mismatch');
    }
    const journal = checkpoint.journal;
    if (journal?.version !== 'runtime-action-plan-execution-journal/v0'
        || !Array.isArray(journal.observations)
        || !Array.isArray(journal.issues)
        || journal.boundaries?.observationOnly !== true
        || journal.boundaries.postDeclarationOnly !== true
        || journal.boundaries.executesTools !== false
        || journal.boundaries.blocksTools !== false) {
        issues.push('runtime_interactive_action_plan_journal_invalid');
    }
    return issues;
}

function validateCommonIdentity(input: {
    continuationId: string;
    workflowToolName: string;
    sourceTask: string;
    taskRunBinding: RuntimeTaskRunInteractionBinding;
    session: RuntimeSession;
    plan: RuntimeStagePlan;
    declarations: RuntimePlanningDeclarations;
    workflowHandoff: RuntimeInteractiveHandoffIdentity;
    actionPlanExecutionJournal?: RuntimeInteractiveActionPlanJournalCheckpoint;
    boundaries: RuntimeInteractiveBoundaries;
}): string[] {
    const issues: string[] = [];
    const continuationId = cleanToken(input.continuationId);
    const workflowToolName = cleanToken(input.workflowToolName, 80);
    if (!continuationId) issues.push('runtime_interactive_continuation_id_missing');
    if (!workflowToolName) issues.push('runtime_interactive_workflow_tool_missing');
    if (!String(input.sourceTask || '').trim()) issues.push('runtime_interactive_source_task_missing');
    if (!validateRuntimeTaskRunInteractionBinding(input.taskRunBinding)) {
        issues.push('runtime_interactive_task_run_binding_invalid');
    }
    if (!hasValidBoundaries(input.boundaries)) {
        issues.push('runtime_interactive_boundaries_invalid');
    }
    if (input.session.version !== 'runtime-session/v0') {
        issues.push('runtime_interactive_session_version_invalid');
    }
    if (input.session.identity.runId !== input.taskRunBinding.runId) {
        issues.push('runtime_interactive_run_id_mismatch');
    }
    if (input.session.identity.generation !== input.taskRunBinding.generation) {
        issues.push('runtime_interactive_generation_mismatch');
    }
    if (input.session.taskRun.taskRunId !== input.taskRunBinding.taskRunId) {
        issues.push('runtime_interactive_task_run_id_mismatch');
    }
    if (input.session.taskRun.planRevision !== input.taskRunBinding.planRevision) {
        issues.push('runtime_interactive_plan_revision_mismatch');
    }
    if (input.taskRunBinding.interactionId !== continuationId) {
        issues.push('runtime_interactive_interaction_id_mismatch');
    }
    if (input.session.skillId !== input.plan.skillId
        || input.session.taskType !== input.plan.taskType) {
        issues.push('runtime_interactive_plan_identity_mismatch');
    }
    issues.push(...validateWorkflowHandoffIdentity({
        handoff: input.workflowHandoff,
        workflowToolName: input.workflowToolName,
        session: input.session,
        plan: input.plan
    }));
    issues.push(...validateActionPlanJournalCheckpoint({
        declarations: input.declarations,
        taskRunPlanRevision: input.session.taskRun.planRevision,
        checkpoint: input.actionPlanExecutionJournal
    }));
    return issues;
}

export function createRuntimeInteractiveBoundaries(): RuntimeInteractiveBoundaries {
    return {
        activeSessionOnly: true,
        resumesExistingTaskRunOnly: true,
        userSubmissionFrozen: true,
        executesTools: false,
        grantsPermission: false,
        createsTaskRun: false,
        categoryNeutral: true
    };
}

export function validateRuntimeInteractiveCheckpoint(
    checkpoint: RuntimeInteractiveCheckpoint
): RuntimeInteractiveValidation {
    const issues = validateCommonIdentity(checkpoint);
    const pending = checkpoint.session.taskRun.pendingInteraction;
    if (checkpoint.version !== RUNTIME_INTERACTIVE_CHECKPOINT_VERSION) {
        issues.push('runtime_interactive_checkpoint_version_invalid');
    }
    if (checkpoint.session.finalized) issues.push('runtime_interactive_checkpoint_finalized');
    if (checkpoint.session.taskRun.status !== 'waiting_user') {
        issues.push('runtime_interactive_checkpoint_not_waiting');
    }
    if (checkpoint.workflowHandoff?.binding.stage
        !== checkpoint.session.stageState.currentStage) {
        issues.push('runtime_interactive_checkpoint_handoff_stage_mismatch');
    }
    if (!pending) {
        issues.push('runtime_interactive_pending_interaction_missing');
    } else {
        if (pending.interactionId !== checkpoint.taskRunBinding.interactionId) {
            issues.push('runtime_interactive_pending_interaction_mismatch');
        }
        if (pending.taskRunId !== checkpoint.taskRunBinding.taskRunId) {
            issues.push('runtime_interactive_pending_task_run_mismatch');
        }
    }
    if (!Number.isFinite(Date.parse(checkpoint.registeredAt))) {
        issues.push('runtime_interactive_registered_at_invalid');
    }
    return { ok: issues.length === 0, issues: Array.from(new Set(issues)) };
}

export function isRuntimeInteractiveAgentHandoff(
    observation: AgentReActObservation | undefined
): boolean {
    if (!observation || observation.version !== 'agent-react-observation/v0') return false;
    if (observation.kind !== 'skill') return false;
    const nonTerminalStatus = observation.status === 'needs_decision'
        || observation.status === 'needs_repair';
    const autonomousNextAction = observation.nextAction === 'decide_next'
        || observation.nextAction === 'repair';
    return nonTerminalStatus && autonomousNextAction;
}

export function shouldDeferRuntimeArtifactFinalizationForInteraction(
    session: RuntimeSession
): boolean {
    const conflictKind = session.taskRun.documentBinding?.conflict?.kind;
    return session.taskRun.status === 'waiting_user'
        || session.taskRun.status === 'writer_conflict'
        || session.taskRun.status === 'needs_reobserve'
        || session.taskRun.sideEffectState?.status === 'unknown'
        || conflictKind === 'writer_conflict'
        || conflictKind === 'operation_state_unknown'
        || Boolean(session.taskRun.pendingInteraction);
}

export function validateRuntimeInteractiveReentry(
    reentry: RuntimeInteractiveReentry
): RuntimeInteractiveValidation {
    const issues = validateCommonIdentity(reentry);
    if (reentry.version !== RUNTIME_INTERACTIVE_REENTRY_VERSION) {
        issues.push('runtime_interactive_reentry_version_invalid');
    }
    if (reentry.session.finalized) issues.push('runtime_interactive_reentry_finalized');
    if (reentry.session.taskRun.status !== 'active'
        && reentry.session.taskRun.status !== 'needs_reobserve') {
        issues.push('runtime_interactive_reentry_not_active');
    }
    if (reentry.session.taskRun.pendingInteraction) {
        issues.push('runtime_interactive_reentry_still_pending');
    }
    if (!isRuntimeInteractiveAgentHandoff(reentry.observation)) {
        issues.push('runtime_interactive_observation_not_handoff');
    }
    if (reentry.observation.actionId !== `skill:${reentry.workflowToolName}`) {
        issues.push('runtime_interactive_observation_owner_mismatch');
    }
    const submission = reentry.confirmedSubmission;
    if (submission.version !== 'interactive-card-submission/v0') {
        issues.push('runtime_interactive_submission_version_invalid');
    }
    if (!cleanToken(submission.cardId) || !cleanToken(submission.kind, 120)) {
        issues.push('runtime_interactive_submission_identity_missing');
    }
    if (!Number.isFinite(Date.parse(submission.submittedAt))) {
        issues.push('runtime_interactive_submission_time_invalid');
    }
    if (!submission.validation?.valid || !submission.validation.canSubmit) {
        issues.push('runtime_interactive_submission_not_validated');
    }
    return { ok: issues.length === 0, issues: Array.from(new Set(issues)) };
}

function summarizeConfirmedValue(value: unknown): string {
    let serialized = '';
    try {
        serialized = JSON.stringify(value);
    } catch {
        serialized = String(value || '');
    }
    return cleanInteractiveCardText(serialized).slice(0, 2400);
}

export function buildRuntimeInteractiveReentryTask(
    reentry: RuntimeInteractiveReentry
): string {
    const validation = validateRuntimeInteractiveReentry(reentry);
    if (!validation.ok) {
        throw new Error(validation.issues.join(','));
    }
    const observation = reentry.observation;
    const confirmedValue = summarizeConfirmedValue(
        reentry.confirmedSubmission.validation.normalizedValue
    );
    const recovery = observation.recovery;
    return [
        '继续同一个任务。这不是新的用户请求，也不要重新询问刚才已经确认的内容。',
        `原始目标：${cleanInteractiveCardText(reentry.sourceTask).slice(0, 1200)}`,
        confirmedValue ? `用户刚确认的内容（冻结事实）：${confirmedValue}` : '',
        `工作流结果：${cleanInteractiveCardText(observation.summary).slice(0, 400)}`,
        ...observation.details.slice(0, 8).map((detail) => (
            `- ${cleanInteractiveCardText(detail).slice(0, 320)}`
        )),
        ...observation.blockers.slice(0, 5).map((blocker) => (
            `待解决：${cleanInteractiveCardText(blocker).slice(0, 320)}`
        )),
        recovery?.reason
            ? `继续范围：${cleanInteractiveCardText(recovery.reason).slice(0, 500)}`
            : '',
        '直接从这个工作流交接点继续；不要重复提交旧卡片，也不要把内部状态或交接说明原样回复给用户。'
    ].filter(Boolean).join('\n');
}

export function projectRuntimeInteractiveWorkflowResult(
    reentry: RuntimeInteractiveReentry
): Record<string, unknown> {
    return {
        success: false,
        nonFatal: true,
        data: {
            agentReActObservation: reentry.observation
        }
    };
}
