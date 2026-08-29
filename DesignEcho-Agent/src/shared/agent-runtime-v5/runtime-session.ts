/**
 * Production Runtime Session（G1 增量 owner）。
 *
 * 它把一次用户任务中的 Skill / Stage Plan、实时 Stage State、Stage Trace 与
 * Reflexion 代次绑定到同一身份。它不是第三套 Workflow Runtime，不调度 Tool、
 * 不改变任务成败，也不从任务文本推断品类。
 */

import type { AgentToolExecutionKind } from '../agent-tool-execution-preflight';
import type { DesignVerdict } from '../design-quality-verdict-bundle';
import type { PhotoshopHistoryStateRef } from '../photoshop-history-state-ref';
import type {
    SkillExecutionRevisionTransition,
    SkillExecutionRuntimeLineage
} from '../skill-execution-effect';
import {
    readPhotoshopOperationResult,
    type PhotoshopOperationApplicationStatus,
    type PhotoshopOperationStatus,
    type PhotoshopOperationTransactionState
} from '../photoshop-operation-result';
import type { RuntimeStage } from './contracts';
import {
    isCompletedAestheticImprovementReflexionHandoff,
    type ReflexionHandoff
} from './reflexion-contract';
import type {
    RuntimeActionPlanDeclaration,
    RuntimeActionPlanFailurePolicy,
    RuntimeActionPlanStepKind
} from './runtime-action-plan-declaration';
import { buildRuntimeActionPlanDeclarationFingerprint } from './runtime-action-plan-reconciliation';
import {
    applyRuntimeStageEvaluation,
    createRuntimeStageState,
    replanRuntimeStageAfterFailure,
    replanRuntimeStageAfterHandoff,
    reobserveRuntimeStageAfterDocumentChange,
    requestRuntimeStageReentry,
    resumeRuntimeStageAfterUserConfirmation,
    type RuntimeStageEvaluationEvent,
    type RuntimeStageEvaluationOutcome,
    type RuntimeStageFailureReplanEvent,
    type RuntimeStageHandoffReplanEvent,
    type RuntimeStageState
} from './runtime-stage-state';
import type { RuntimeStagePlan } from './runtime-stage-plan';
import { isCanvasBootstrapAction } from './runtime-stage-plan';
import {
    appendRuntimeStageTraceEvent,
    buildRuntimeStageTraceDigest,
    createRuntimeStageTrace,
    type RuntimeStageTrace,
    type RuntimeStageTraceDigest,
    type RuntimeStageTraceEventInput
} from './runtime-stage-trace';
import {
    buildRuntimeAccountingDigest,
    cloneRuntimeAccountingLedger,
    createRuntimeAccountingLedger,
    readRuntimePerformanceUsage,
    recordRuntimeModelCall,
    recordRuntimePerformanceUsage,
    recordRuntimeProviderOutputRecoveryAttempt,
    recordRuntimeProviderOutputRecoveryOutcome,
    recordRuntimeRecoveryAttempt,
    recordRuntimeReflexion,
    recordRuntimeToolCall,
    type RuntimeAccountingDigest,
    type RuntimeAccountingLedger,
    type RuntimePerformanceUsage,
    type RuntimeProviderOutputRecoveryFailureReason
} from './runtime-accounting';

export const RUNTIME_SESSION_IDENTITY_VERSION = 'runtime-session-identity/v0' as const;
export const RUNTIME_SESSION_VERSION = 'runtime-session/v0' as const;
export const RUNTIME_SESSION_DIGEST_VERSION = 'runtime-session-digest/v0' as const;
export const RUNTIME_TASK_RUN_STATE_VERSION = 'runtime-task-run-state/v0' as const;
export const RUNTIME_TASK_RUN_INTERACTION_BINDING_VERSION =
    'runtime-task-run-interaction-binding/v0' as const;
export const RUNTIME_SKILL_EFFECT_RECONCILIATION_VERSION =
    'runtime-skill-effect-reconciliation/v1' as const;

export interface RuntimeSessionIdentity {
    version: typeof RUNTIME_SESSION_IDENTITY_VERSION;
    sessionId: string;
    runId: string;
    generation: number;
    parentRunId?: string;
    issuedAt: string;
    skillId?: string;
    taskType?: string;
    boundaries: {
        identityOnly: true;
        grantsPermission: false;
        executesTools: false;
        changesTaskResult: false;
        categoryNeutral: true;
    };
}

export type RuntimeTaskRunStatus =
    | 'active'
    | 'waiting_user'
    | 'writer_conflict'
    | 'needs_reobserve'
    | 'needs_review'
    | 'completed'
    | 'failed'
    | 'cancelled';

export type RuntimeTaskRunNodeStatus =
    | 'pending'
    | 'ready'
    | 'in_progress'
    | 'waiting_user'
    | 'applied'
    | 'verified'
    | 'verification_failed'
    | 'failed'
    | 'unknown'
    | 'completed';

export interface RuntimeTaskRunOperationResultRef {
    operationId: string;
    toolName: string;
    planRevision: number;
    nodeId?: string;
    recordedAt: string;
    status: PhotoshopOperationStatus;
    applicationStatus: PhotoshopOperationApplicationStatus;
    transactionState: PhotoshopOperationTransactionState;
    before?: PhotoshopHistoryStateRef;
    after?: PhotoshopHistoryStateRef;
}

export interface RuntimeTaskRunSkillRevisionProjectionRef {
    projectionId: string;
    workflowToolName: string;
    planRevision: number;
    source: SkillExecutionRevisionTransition['source'];
    toolActionCompleted: boolean;
    before?: PhotoshopHistoryStateRef;
    after: PhotoshopHistoryStateRef;
    recordedAt: string;
}

export interface RuntimeTaskRunNodeExecutionRef {
    envelopeId: string;
    packVersion: string;
    packId: string;
    capabilityRef: string;
    providerName: string;
    providerCallId: string;
    argumentFingerprint: string;
    planRevision: number;
    target: PhotoshopHistoryStateRef;
    compiledAt: string;
}

export interface RuntimeTaskRunNodeState {
    nodeId: string;
    kind: RuntimeActionPlanStepKind;
    status: RuntimeTaskRunNodeStatus;
    executionRefs: RuntimeTaskRunNodeExecutionRef[];
    operationResultIds: string[];
}

export interface RuntimeTaskRunWriterClaim {
    taskRunId: string;
    runId: string;
    generation: number;
    documentId: number;
    expectedRevision: PhotoshopHistoryStateRef;
    acquiredAt: string;
}

export type RuntimeTaskRunDocumentConflictKind =
    | 'writer_conflict'
    | 'document_changed'
    | 'external_revision_changed'
    | 'operation_state_unknown';

export interface RuntimeTaskRunDocumentBinding {
    documentId: number;
    expectedRevision: PhotoshopHistoryStateRef;
    status: 'observed' | 'owned' | 'needs_reobserve' | 'conflict';
    writer?: RuntimeTaskRunWriterClaim;
    conflict?: {
        kind: RuntimeTaskRunDocumentConflictKind;
        observedTaskRunId?: string;
        expectedRevision?: PhotoshopHistoryStateRef;
        observedRevision?: PhotoshopHistoryStateRef;
        recordedAt: string;
    };
}

export interface RuntimeTaskRunInteractionBinding {
    version: typeof RUNTIME_TASK_RUN_INTERACTION_BINDING_VERSION;
    taskRunId: string;
    runId: string;
    generation: number;
    interactionId: string;
    planRevision: number;
    nodeId?: string;
    expectedRevision?: PhotoshopHistoryStateRef;
    issuedAt: string;
    boundaries: {
        identityOnly: true;
        resumesExistingTaskRunOnly: true;
        grantsPermission: false;
        executesTools: false;
    };
}

export interface RuntimeTaskRunPendingInteraction extends RuntimeTaskRunInteractionBinding {
    continuationId?: string;
    cardId?: string;
    previousNodeStatus?: RuntimeTaskRunNodeStatus;
}

/**
 * 与文档绑定解耦的副作用事实。
 *
 * Skill 已经开始执行、但 Runtime 无法证明它是否修改过外部状态时，即使当前没有
 * Photoshop 文档可绑定，也必须保留 fail-closed 状态。它不会伪造文档或 history，
 * 但会阻止新的副作用和 Artifact 发布，直到由专用 reconciliation 取得确定事实。
 */
export interface RuntimeTaskRunSideEffectState {
    status: 'unknown';
    workflowToolName: string;
    recordedAt: string;
    observedRevision?: PhotoshopHistoryStateRef;
    runtimeLineage?: SkillExecutionRuntimeLineage;
}

/**
 * Agent 真看过 unknown 后现场、并主动选择下一项原子动作时，由 Renderer adapter 构造。
 * 这不是模型参数，也不执行 Tool；Runtime 只用它解除同一 TaskRun 的未知副作用锁。
 */
export interface RuntimeSkillEffectReconciliationReceipt {
    version: typeof RUNTIME_SKILL_EFFECT_RECONCILIATION_VERSION;
    runtimeLineage: SkillExecutionRuntimeLineage;
    workflowToolName: string;
    conclusion: 'adopt_observed_revision' | 'confirm_no_document';
    observedRevision?: PhotoshopHistoryStateRef;
    observationToolNames: string[];
    visualObservationBinding?: {
        observationKey: string;
        sourceTool: string;
        documentId: number;
        historyStateId: number;
        presentedModelTurn: number;
        consumedModelTurn: number;
        observer: 'primary_model';
    };
    nextToolName: string;
    boundaries: {
        agentSelectedNextAtomicAction: true;
        visualObservationVerified: boolean;
        noDocumentConsensusVerified: boolean;
        operationIdentityBound: true;
        executesTools: false;
        grantsPermission: false;
    };
}

export interface RuntimeSkillEffectReconciliationDecision {
    status: 'reconciled' | 'rejected';
    code:
        | 'runtime_skill_effect_reconciled'
        | 'runtime_skill_effect_not_unknown'
        | 'runtime_skill_effect_reconciliation_identity_mismatch'
        | 'runtime_skill_effect_reconciliation_evidence_invalid'
        | 'runtime_skill_effect_reconciliation_writer_mismatch';
    session: RuntimeSession;
}

export interface RuntimeTaskRunState {
    version: typeof RUNTIME_TASK_RUN_STATE_VERSION;
    taskRunId: string;
    status: RuntimeTaskRunStatus;
    planRevision: number;
    planFingerprint?: string;
    nodes: RuntimeTaskRunNodeState[];
    cursor: number;
    currentNodeId?: string;
    pendingInteraction?: RuntimeTaskRunPendingInteraction;
    documentBinding?: RuntimeTaskRunDocumentBinding;
    sideEffectState?: RuntimeTaskRunSideEffectState;
    operationResults: RuntimeTaskRunOperationResultRef[];
    skillRevisionProjections?: RuntimeTaskRunSkillRevisionProjectionRef[];
    boundaries: {
        ownedByRuntimeSession: true;
        schedulerAuthority: false;
        executesTools: false;
        grantsPermission: false;
        operationResultsFromHostOnly: true;
        categoryNeutral: true;
    };
}

export interface RuntimeSession {
    version: typeof RUNTIME_SESSION_VERSION;
    identity: RuntimeSessionIdentity;
    planVersion: RuntimeStagePlan['version'];
    skillId: string;
    taskType: string;
    stageState: RuntimeStageState;
    stageTrace: RuntimeStageTrace;
    accounting: RuntimeAccountingLedger;
    /** 同一 Owner 内的最小可挂起 TaskRun；不是第二 Runtime 或第二 Store。 */
    taskRun: RuntimeTaskRunState;
    /** 本 generation 开始前已有的 transition 数；Trace digest 只对账之后的增量。 */
    generationStartTransitionCount: number;
    finalized: boolean;
    issues: string[];
    boundaries: {
        singleStageOwner: true;
        stageOutcomeDriven: true;
        executesTools: false;
        grantsPermission: false;
        changesTaskResult: false;
        categoryNeutral: true;
    };
}

export interface RuntimeSessionDigest {
    version: typeof RUNTIME_SESSION_DIGEST_VERSION;
    sessionId: string;
    runId: string;
    generation: number;
    parentRunId?: string;
    issuedAt: string;
    planVersion: RuntimeStagePlan['version'];
    skillId: string;
    taskType: string;
    status: RuntimeStageState['status'];
    currentStage?: RuntimeStage;
    transitionCount: number;
    traceStatus: RuntimeStageTraceDigest['status'];
    traceEventCount: number;
    accounting: RuntimeAccountingDigest;
    taskRun: {
        taskRunId: string;
        status: RuntimeTaskRunStatus;
        planRevision: number;
        nodeCount: number;
        currentNodeId?: string;
        pendingInteractionId?: string;
        documentId?: number;
        expectedHistoryStateId?: number;
        writerTaskRunId?: string;
        sideEffectState?: RuntimeTaskRunSideEffectState['status'];
        operationResultCount: number;
    };
    finalized: boolean;
    issueCount: number;
    boundaries: {
        digestOnly: true;
        oneSessionIdentity: true;
        executesTools: false;
        grantsPermission: false;
        changesTaskResult: false;
    };
}

export interface RuntimeSessionIdentityValidation {
    ok: boolean;
    issues: string[];
}

export interface RuntimeSessionExecutionSummaryInput {
    status: 'completed' | 'needs_review' | 'failed' | 'cancelled' | 'awaiting_confirmation';
    stopReason?: string;
    blockers?: string[];
    warnings?: string[];
    designVerdict?: DesignVerdict;
}

export interface RuntimeSessionCompletionProjection {
    version: 'runtime-session-completion-projection/v0';
    status: RuntimeSessionExecutionSummaryInput['status'];
    changed: boolean;
    reasonCode?:
        | 'runtime_outcomes_incomplete'
        | 'quality_review_incomplete'
        | 'delivery_result_incomplete';
    /** 面向普通用户的简短状态，不包含阶段代号或内部枚举。 */
    summaryText?: string;
    /** 面向普通用户的具体原因，不包含 Runtime / R5 / E2 / unobserved。 */
    blocker?: string;
    boundaries: {
        projectsExistingRuntimeState: true;
        doesNotAdvanceStage: true;
        doesNotExecuteTools: true;
        categoryNeutral: true;
    };
}

export interface RuntimeSessionToolExecutionGate {
    status: 'allowed' | 'blocked' | 'not_applicable';
    allowed: boolean;
    code?:
        | 'runtime_session_r4_not_ready'
        | 'runtime_task_run_waiting_user'
        | 'runtime_task_run_writer_conflict'
        | 'runtime_task_run_side_effect_unknown'
        | 'runtime_task_run_revision_reobserve_required'
        | 'runtime_workflow_owner_first';
    currentStage?: RuntimeStage;
    blockedTool?: string;
    /** owner 先行被拦时的出口：先调用这个工作流入口 */
    nextRequiredTool?: string;
    boundaries: {
        executionPointOnly: true;
        executesTools: false;
        grantsPermission: false;
        categoryNeutral: true;
    };
}

export interface RuntimeTaskRunWriterDecision {
    status: 'acquired' | 'retained' | 'conflict' | 'stale_revision' | 'invalid';
    allowed: boolean;
    code?:
        | 'runtime_task_run_writer_conflict'
        | 'runtime_task_run_revision_conflict'
        | 'runtime_task_run_writer_binding_invalid';
    claim?: RuntimeTaskRunWriterClaim;
    conflictingTaskRunId?: string;
}

export interface RuntimeTaskRunNodeExecutionDecision {
    status: 'started' | 'blocked';
    allowed: boolean;
    code?:
        | 'runtime_task_run_node_execution_binding_invalid'
        | 'runtime_task_run_node_not_current'
        | 'runtime_task_run_node_not_ready'
        | 'runtime_task_run_node_revision_mismatch'
        | 'runtime_task_run_writer_conflict'
        | 'runtime_task_run_revision_conflict'
        | 'runtime_task_run_writer_binding_invalid';
    nodeId?: string;
    writerDecision?: RuntimeTaskRunWriterDecision;
    boundaries: {
        recordsExistingDispatchOnly: true;
        executesTools: false;
        grantsPermission: false;
        schedulerAuthority: false;
    };
}

export interface RuntimeTaskRunResumeDecision {
    status: 'resumed' | 'rejected';
    code?:
        | 'runtime_task_run_not_waiting'
        | 'runtime_task_run_id_mismatch'
        | 'runtime_task_run_interaction_mismatch'
        | 'runtime_task_run_revision_mismatch';
    session: RuntimeSession;
}

const ID_PATTERN = /^(?:runtime|run)-[a-z0-9-]+$/i;
const MAX_SESSION_ISSUES = 30;
const MAX_TASK_RUN_OPERATION_RESULTS = 120;
const MAX_TASK_RUN_SKILL_REVISION_PROJECTIONS = 120;

/**
 * RuntimeSession Owner 内唯一的进程级文档写者表。
 *
 * 它只防止同一 Renderer 进程内两个活动 TaskRun 同时认领同一文档；真正写入仍由
 * PhotoshopTransactionRunner 串行化并在 modal 内复核 revision。等待用户和 unknown
 * 结果会保留 claim，明确终态才释放，避免把不确定写状态误当成可重放。
 */
const activeDocumentWriterClaims = new Map<number, RuntimeTaskRunWriterClaim>();

type RuntimeTaskRunWriterIdentity = Pick<
    RuntimeTaskRunWriterClaim,
    'taskRunId' | 'runId' | 'generation'
>;

function sameRuntimeTaskRunWriterIdentity(
    left: RuntimeTaskRunWriterIdentity,
    right: RuntimeTaskRunWriterIdentity
): boolean {
    return left.taskRunId === right.taskRunId
        && left.runId === right.runId
        && left.generation === right.generation;
}

function cloneRuntimeTaskRunWriterClaim(
    claim: RuntimeTaskRunWriterClaim
): RuntimeTaskRunWriterClaim {
    return {
        ...claim,
        expectedRevision: { ...claim.expectedRevision }
    };
}

function hasLiveConflictingRuntimeTaskRunWriter(session: RuntimeSession): boolean {
    const binding = session.taskRun.documentBinding;
    const projectsWriterConflict = session.taskRun.status === 'writer_conflict'
        || binding?.conflict?.kind === 'writer_conflict';
    if (!projectsWriterConflict || !binding) return false;
    const activeClaim = activeDocumentWriterClaims.get(binding.documentId);
    return Boolean(activeClaim && !sameRuntimeTaskRunWriterIdentity(activeClaim, {
        taskRunId: session.taskRun.taskRunId,
        runId: session.identity.runId,
        generation: session.identity.generation
    }));
}

function buildStructuralRuntimeToolBlock(input: {
    session: RuntimeSession;
    toolName: string;
    code: Extract<
        NonNullable<RuntimeSessionToolExecutionGate['code']>,
        | 'runtime_task_run_waiting_user'
        | 'runtime_task_run_writer_conflict'
        | 'runtime_task_run_side_effect_unknown'
        | 'runtime_task_run_revision_reobserve_required'
    >;
    boundaries: RuntimeSessionToolExecutionGate['boundaries'];
}): RuntimeSessionToolExecutionGate {
    return {
        status: 'blocked',
        allowed: false,
        code: input.code,
        currentStage: input.session.stageState.currentStage,
        blockedTool: cleanText(input.toolName, 80),
        boundaries: input.boundaries
    };
}

function cleanText(value: unknown, limit = 240): string {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function cleanIdentityToken(value: unknown, limit = 120): string {
    const normalized = cleanText(value, limit);
    return /^[A-Za-z0-9_.:-]+$/.test(normalized) ? normalized : '';
}

function cleanExecutionToken(value: unknown, limit = 160): string {
    const normalized = cleanText(value, limit);
    return /^[A-Za-z0-9_.:/-]+$/.test(normalized) ? normalized : '';
}

function compactTimestamp(value: string): string {
    return value.replace(/[-:TZ.]/g, '').slice(0, 17) || 'unknown';
}

function stableHash(input: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

function uniqueIssues(values: readonly unknown[]): string[] {
    return Array.from(new Set(values.map((value) => cleanText(value, 160)).filter(Boolean)))
        .slice(0, MAX_SESSION_ISSUES);
}

function cloneHistoryStateRef(
    value: PhotoshopHistoryStateRef | undefined
): PhotoshopHistoryStateRef | undefined {
    return value ? { documentId: value.documentId, historyStateId: value.historyStateId } : undefined;
}

function sameHistoryStateRef(
    left: PhotoshopHistoryStateRef | undefined,
    right: PhotoshopHistoryStateRef | undefined
): boolean {
    return Boolean(left && right)
        && left!.documentId === right!.documentId
        && left!.historyStateId === right!.historyStateId;
}

function createRuntimeTaskRunState(identity: RuntimeSessionIdentity): RuntimeTaskRunState {
    return {
        version: RUNTIME_TASK_RUN_STATE_VERSION,
        taskRunId: identity.sessionId,
        status: 'active',
        planRevision: 0,
        nodes: [],
        cursor: 0,
        operationResults: [],
        skillRevisionProjections: [],
        boundaries: {
            ownedByRuntimeSession: true,
            schedulerAuthority: false,
            executesTools: false,
            grantsPermission: false,
            operationResultsFromHostOnly: true,
            categoryNeutral: true
        }
    };
}

function cloneRuntimeTaskRunState(state: RuntimeTaskRunState): RuntimeTaskRunState {
    return {
        ...state,
        nodes: state.nodes.map((node) => ({
            ...node,
            executionRefs: (node.executionRefs || []).map((execution) => ({
                ...execution,
                target: { ...execution.target }
            })),
            operationResultIds: [...node.operationResultIds]
        })),
        ...(state.pendingInteraction ? {
            pendingInteraction: {
                ...state.pendingInteraction,
                expectedRevision: cloneHistoryStateRef(state.pendingInteraction.expectedRevision),
                boundaries: { ...state.pendingInteraction.boundaries }
            }
        } : {}),
        ...(state.documentBinding ? {
            documentBinding: {
                ...state.documentBinding,
                expectedRevision: { ...state.documentBinding.expectedRevision },
                ...(state.documentBinding.writer ? {
                    writer: {
                        ...state.documentBinding.writer,
                        expectedRevision: { ...state.documentBinding.writer.expectedRevision }
                    }
                } : {}),
                ...(state.documentBinding.conflict ? {
                    conflict: {
                        ...state.documentBinding.conflict,
                        expectedRevision: cloneHistoryStateRef(
                            state.documentBinding.conflict.expectedRevision
                        ),
                        observedRevision: cloneHistoryStateRef(
                            state.documentBinding.conflict.observedRevision
                        )
                    }
                } : {})
            }
        } : {}),
        ...(state.sideEffectState ? {
            sideEffectState: {
                ...state.sideEffectState,
                observedRevision: cloneHistoryStateRef(state.sideEffectState.observedRevision),
                ...(state.sideEffectState.runtimeLineage ? {
                    runtimeLineage: { ...state.sideEffectState.runtimeLineage }
                } : {})
            }
        } : {}),
        operationResults: state.operationResults.map((result) => ({
            ...result,
            before: cloneHistoryStateRef(result.before),
            after: cloneHistoryStateRef(result.after)
        })),
        skillRevisionProjections: (state.skillRevisionProjections || []).map((projection) => ({
            ...projection,
            before: cloneHistoryStateRef(projection.before),
            after: { ...projection.after }
        })),
        boundaries: { ...state.boundaries }
    };
}

function buildTaskRunDocumentConflict(input: {
    binding: RuntimeTaskRunDocumentBinding;
    kind: RuntimeTaskRunDocumentConflictKind;
    now: string;
    observedTaskRunId?: string;
    observedRevision?: PhotoshopHistoryStateRef;
}): RuntimeTaskRunDocumentBinding {
    return {
        ...input.binding,
        status: input.kind === 'writer_conflict' ? 'conflict' : 'needs_reobserve',
        conflict: {
            kind: input.kind,
            ...(input.observedTaskRunId ? { observedTaskRunId: input.observedTaskRunId } : {}),
            expectedRevision: { ...input.binding.expectedRevision },
            observedRevision: cloneHistoryStateRef(input.observedRevision),
            recordedAt: input.now
        }
    };
}

function withRuntimeTaskRunStatus(
    session: RuntimeSession,
    status: RuntimeTaskRunStatus
): RuntimeSession {
    return {
        ...session,
        taskRun: {
            ...session.taskRun,
            status
        }
    };
}

/**
 * 返回必须由其专属 owner 处理的非终态 TaskRun 状态。
 *
 * 顺序是协议优先级，不是错误严重度：交互等待先由 continuation owner 承接；
 * writer 冲突只能由当前 writer 的终态释放；真实 revision 变化才交给重观察。
 * 这些状态不得被通用 Stage 补做、Reflexion generation 或普通完成收尾改写成 active/failed。
 */
function resolveRuntimeTaskRunStructuralStatus(
    session: RuntimeSession
): Extract<RuntimeTaskRunStatus, 'waiting_user' | 'writer_conflict' | 'needs_reobserve'> | undefined {
    const taskRun = session.taskRun;
    const binding = taskRun.documentBinding;
    if (taskRun.status === 'waiting_user' || taskRun.pendingInteraction) {
        return 'waiting_user';
    }
    if (taskRun.status === 'writer_conflict'
        || binding?.conflict?.kind === 'writer_conflict') {
        return 'writer_conflict';
    }
    if (taskRun.status === 'needs_reobserve'
        || binding?.status === 'needs_reobserve'
        || binding?.conflict?.kind === 'document_changed'
        || binding?.conflict?.kind === 'external_revision_changed'
        || binding?.conflict?.kind === 'operation_state_unknown') {
        return 'needs_reobserve';
    }
    return undefined;
}

export type RuntimeSessionWriterReleaseOutcome =
    | 'executed'
    | 'failed'
    | 'awaiting_confirmation'
    | 'unknown';

/**
 * Runtime writer 的唯一安全释放判据。
 *
 * 调用方只负责声明自己是否已经取得当前执行阶段的 owner 身份，以及终态和 mutation
 * 证据；等待交互、writer/revision 冲突与 operation unknown 始终由 RuntimeSession 状态
 * 优先保留。该函数不修改 claim，也不把任务失败解释成零写入。
 */
export function canReleaseRuntimeSessionDocumentWriter(input: {
    session: RuntimeSession;
    ownerHasExecutionControl: boolean;
    outcome: RuntimeSessionWriterReleaseOutcome;
    mutationState: 'none' | 'observed' | 'unknown';
    awaitingUserResponse?: boolean;
}): boolean {
    if (!input.ownerHasExecutionControl || input.awaitingUserResponse) return false;
    if (resolveRuntimeTaskRunStructuralStatus(input.session)) return false;
    if (input.session.taskRun.sideEffectState?.status === 'unknown') return false;
    if (input.outcome === 'executed') return input.mutationState !== 'unknown';
    return input.outcome === 'failed' && input.mutationState === 'none';
}

function hasStage(plan: RuntimeStagePlan, stage: RuntimeStage): boolean {
    return plan.steps.some((step) => step.stage === stage);
}

function resetReflexionTargetAndDownstream(input: {
    state: RuntimeStageState;
    plan: RuntimeStagePlan;
}): RuntimeStageState {
    if (input.state.status !== 'reflexion_required' || !input.state.currentStage) {
        return input.state;
    }
    const targetIndex = input.plan.steps.findIndex((step) => step.stage === input.state.currentStage);
    if (targetIndex < 0) {
        return {
            ...input.state,
            issues: uniqueIssues([
                ...input.state.issues,
                `runtime_session_reflexion_target_not_in_plan:${input.state.currentStage}`
            ])
        };
    }
    const invalidatedStages = new Set(
        input.plan.steps.slice(targetIndex).map((step) => step.stage)
    );
    return {
        ...input.state,
        status: 'active',
        stages: input.state.stages.map((stage) => {
            if (!invalidatedStages.has(stage.stage)) return stage;
            return {
                ...stage,
                status: 'unobserved',
                observedOutcomes: [],
                missingOutcomes: [...stage.requiredOutcomes],
                lastEvaluation: undefined
            };
        }),
        issues: uniqueIssues([
            ...input.state.issues,
            `runtime_session_reflexion_generation_started:${input.state.currentStage}`
        ])
    };
}

function firstMessage(values: readonly string[] | undefined): string {
    return cleanText(Array.isArray(values) ? values[0] : '');
}

function verdictOutcome(verdict: DesignVerdict): RuntimeStageEvaluationOutcome {
    switch (verdict.status) {
        case 'passed':
            return 'passed';
        case 'failed':
            return 'failed';
        case 'needs_review':
            return 'needs_review';
        case 'passed_unverified':
        case 'not_applicable':
        default:
            return 'missing_required_outcomes';
    }
}

export function validateRuntimeSessionIdentity(
    identity: unknown
): RuntimeSessionIdentityValidation {
    if (!identity || typeof identity !== 'object') {
        return { ok: false, issues: ['runtime_session_identity_not_object'] };
    }
    const value = identity as Partial<RuntimeSessionIdentity>;
    const issues: string[] = [];
    if (value.version !== RUNTIME_SESSION_IDENTITY_VERSION) {
        issues.push('runtime_session_identity_version_invalid');
    }
    if (!value.sessionId || !ID_PATTERN.test(value.sessionId) || !value.sessionId.startsWith('runtime-')) {
        issues.push('runtime_session_id_invalid');
    }
    if (!value.runId || !ID_PATTERN.test(value.runId) || !value.runId.startsWith('run-')) {
        issues.push('runtime_session_run_id_invalid');
    }
    if (!Number.isInteger(value.generation) || Number(value.generation) < 1) {
        issues.push('runtime_session_generation_invalid');
    }
    if (!cleanText(value.issuedAt, 40) || !Number.isFinite(Date.parse(String(value.issuedAt)))) {
        issues.push('runtime_session_issued_at_invalid');
    }
    if (Number(value.generation) === 1 && value.parentRunId) {
        issues.push('runtime_session_first_generation_has_parent');
    }
    if (Number(value.generation) > 1 && (!value.parentRunId || !ID_PATTERN.test(value.parentRunId))) {
        issues.push('runtime_session_parent_run_id_missing');
    }
    if (value.parentRunId && value.parentRunId === value.runId) {
        issues.push('runtime_session_parent_equals_run');
    }
    if (value.skillId && !cleanIdentityToken(value.skillId)) {
        issues.push('runtime_session_skill_id_invalid');
    }
    if (value.taskType && !cleanIdentityToken(value.taskType)) {
        issues.push('runtime_session_task_type_invalid');
    }
    const boundaries = value.boundaries;
    if (!boundaries
        || boundaries.identityOnly !== true
        || boundaries.grantsPermission !== false
        || boundaries.executesTools !== false
        || boundaries.changesTaskResult !== false
        || boundaries.categoryNeutral !== true) {
        issues.push('runtime_session_identity_boundaries_invalid');
    }
    return { ok: issues.length === 0, issues };
}

export function createRuntimeSessionIdentity(input: {
    now: string;
    nonce: string;
    generation?: number;
    sessionId?: string;
    parentRunId?: string;
    skillId?: string;
    taskType?: string;
}): RuntimeSessionIdentity {
    const issuedAt = cleanText(input.now, 40);
    if (!issuedAt || !Number.isFinite(Date.parse(issuedAt))) {
        throw new Error('runtime_session_issued_at_invalid');
    }
    const nonce = cleanIdentityToken(input.nonce, 120);
    if (!nonce) throw new Error('runtime_session_nonce_invalid');
    const generation = Number.isInteger(input.generation) && Number(input.generation) > 0
        ? Number(input.generation)
        : 1;
    const skillId = cleanIdentityToken(input.skillId);
    const taskType = cleanIdentityToken(input.taskType);
    const timestamp = compactTimestamp(issuedAt);
    const generatedSessionId = `runtime-${timestamp}-${stableHash(`${nonce}|${skillId}|${taskType}`)}`;
    const sessionId = input.sessionId || generatedSessionId;
    const runId = `run-${timestamp}-${stableHash(`${sessionId}|${generation}|${nonce}`)}`;
    const identity: RuntimeSessionIdentity = {
        version: RUNTIME_SESSION_IDENTITY_VERSION,
        sessionId,
        runId,
        generation,
        ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
        issuedAt,
        ...(skillId ? { skillId } : {}),
        ...(taskType ? { taskType } : {}),
        boundaries: {
            identityOnly: true,
            grantsPermission: false,
            executesTools: false,
            changesTaskResult: false,
            categoryNeutral: true
        }
    };
    const validation = validateRuntimeSessionIdentity(identity);
    if (!validation.ok) throw new Error(validation.issues.join(','));
    return identity;
}

/**
 * Bind a main-process-issued plan-neutral identity to one validated Runtime Manifest.
 *
 * The TaskRun identity itself stays stable: sessionId, runId and generation are preserved.
 * Binding only records the selected Skill/task type; it does not grant Tool permission,
 * execute actions, change the user goal, or create a second TaskRun.
 */
export function bindRuntimeSessionIdentity(input: {
    identity: RuntimeSessionIdentity;
    skillId: string;
    taskType: string;
}): RuntimeSessionIdentity {
    const validation = validateRuntimeSessionIdentity(input.identity);
    if (!validation.ok) throw new Error(validation.issues.join(','));
    const skillId = cleanIdentityToken(input.skillId);
    const taskType = cleanIdentityToken(input.taskType);
    if (!skillId || !taskType) throw new Error('runtime_session_manifest_binding_invalid');
    if (input.identity.skillId && input.identity.skillId !== skillId) {
        throw new Error('runtime_session_skill_binding_conflict');
    }
    if (input.identity.taskType && input.identity.taskType !== taskType) {
        throw new Error('runtime_session_task_binding_conflict');
    }
    const identity: RuntimeSessionIdentity = {
        ...input.identity,
        skillId,
        taskType,
        boundaries: { ...input.identity.boundaries }
    };
    const boundValidation = validateRuntimeSessionIdentity(identity);
    if (!boundValidation.ok) throw new Error(boundValidation.issues.join(','));
    return identity;
}

export function advanceRuntimeSessionIdentity(input: {
    previous: RuntimeSessionIdentity;
    now: string;
    nonce: string;
}): RuntimeSessionIdentity {
    const validation = validateRuntimeSessionIdentity(input.previous);
    if (!validation.ok) throw new Error(validation.issues.join(','));
    return createRuntimeSessionIdentity({
        now: input.now,
        nonce: input.nonce,
        generation: input.previous.generation + 1,
        sessionId: input.previous.sessionId,
        parentRunId: input.previous.runId,
        skillId: input.previous.skillId,
        taskType: input.previous.taskType
    });
}

export function bindRuntimeSessionActionPlan(input: {
    session: RuntimeSession;
    declaration: RuntimeActionPlanDeclaration;
}): RuntimeSession {
    if (input.session.finalized) {
        return {
            ...input.session,
            issues: uniqueIssues([
                ...input.session.issues,
                'runtime_task_run_plan_bound_after_finalize'
            ])
        };
    }
    const revision = input.session.taskRun.planRevision + 1;
    const nodes: RuntimeTaskRunNodeState[] = input.declaration.payload.steps.map((step) => ({
        nodeId: step.stepId,
        kind: step.kind,
        status: 'pending',
        executionRefs: [],
        operationResultIds: []
    }));
    const previousBinding = input.session.taskRun.documentBinding;
    const structuralStatus = resolveRuntimeTaskRunStructuralStatus(input.session);
    const replannedRevision = input.session.stageState.currentStage === 'R4'
        && previousBinding?.status === 'needs_reobserve'
        && (previousBinding.conflict?.kind === 'document_changed'
            || previousBinding.conflict?.kind === 'external_revision_changed')
        ? previousBinding.conflict.observedRevision
        : undefined;
    if (replannedRevision) {
        releaseRuntimeTaskRunWriterBinding({
            taskRunId: input.session.taskRun.taskRunId,
            runId: input.session.identity.runId,
            generation: input.session.identity.generation,
            documentId: previousBinding?.documentId
        });
    }
    return {
        ...input.session,
        issues: replannedRevision
            ? uniqueIssues([
                ...input.session.issues,
                'runtime_task_run_document_revision_replanned'
            ])
            : input.session.issues,
        taskRun: {
            ...input.session.taskRun,
            status: replannedRevision
                ? 'active'
                : structuralStatus || 'active',
            planRevision: revision,
            planFingerprint: buildRuntimeActionPlanDeclarationFingerprint(input.declaration),
            nodes,
            cursor: 0,
            ...(nodes[0] ? { currentNodeId: nodes[0].nodeId } : { currentNodeId: undefined }),
            pendingInteraction: undefined,
            ...(replannedRevision ? {
                documentBinding: {
                    documentId: replannedRevision.documentId,
                    expectedRevision: { ...replannedRevision },
                    status: 'observed' as const
                }
            } : {})
        }
    };
}

export function synchronizeRuntimeSessionActionPlanNodes(input: {
    session: RuntimeSession;
    steps: Array<{
        stepId: string;
        status: 'blocked_by_dependency' | 'ready' | 'in_progress' | 'failed' | 'completed';
    }>;
}): RuntimeSession {
    if (input.session.finalized || input.session.taskRun.nodes.length === 0) return input.session;
    const statusById = new Map(input.steps.map((step) => [step.stepId, step.status]));
    const nodes = input.session.taskRun.nodes.map((node) => {
        const observed = statusById.get(node.nodeId);
        if (!observed) return node;
        if (node.status === 'applied'
            || node.status === 'verified'
            || node.status === 'verification_failed'
            || node.status === 'unknown'
            || node.status === 'waiting_user') {
            return node;
        }
        let status: RuntimeTaskRunNodeStatus = 'pending';
        if (observed === 'ready') status = 'ready';
        if (observed === 'in_progress') status = 'in_progress';
        if (observed === 'failed') status = 'failed';
        if (observed === 'completed') status = 'completed';
        return { ...node, status };
    });
    const completedIds = new Set(input.steps
        .filter((step) => step.status === 'completed')
        .map((step) => step.stepId));
    const cursor = Math.max(0, nodes.findIndex((node) => !completedIds.has(node.nodeId)));
    const allCompleted = nodes.length > 0 && completedIds.size === nodes.length;
    return {
        ...input.session,
        taskRun: {
            ...input.session.taskRun,
            nodes,
            cursor: allCompleted ? nodes.length : cursor,
            ...(allCompleted ? { currentNodeId: undefined } : { currentNodeId: nodes[cursor]?.nodeId })
        }
    };
}

export function observeRuntimeSessionDocumentRevision(input: {
    session: RuntimeSession;
    revision: PhotoshopHistoryStateRef;
    now?: string;
}): RuntimeSession {
    if (input.session.finalized) return input.session;
    const now = cleanText(input.now, 40) || new Date().toISOString();
    const current = input.session.taskRun.documentBinding;
    if (!current) {
        return {
            ...input.session,
            taskRun: {
                ...input.session.taskRun,
                documentBinding: {
                    documentId: input.revision.documentId,
                    expectedRevision: { ...input.revision },
                    status: 'observed'
                }
            }
        };
    }
    // writer 冲突是“另一个 TaskRun 正持有写身份”，不是 Photoshop history 变化。
    // 任何只读观察都不能把它改写成 revision conflict，更不能为通用重观察制造清除出口。
    if (current.conflict?.kind === 'writer_conflict'
        || input.session.taskRun.status === 'writer_conflict') {
        return input.session;
    }
    const hasDocumentRevisionConflict = (current.status === 'needs_reobserve'
        || current.status === 'conflict')
        && (current.conflict?.kind === 'document_changed'
            || current.conflict?.kind === 'external_revision_changed');
    if (hasDocumentRevisionConflict
        && sameHistoryStateRef(current.conflict?.observedRevision, input.revision)) {
        return input.session;
    }
    // 冲突态只对“当前最新 observed revision”幂等。即使真实文档 Undo/回退到原 expected，
    // 它仍是相对 conflict observedRevision 的新现场，必须更新冲突并重新形成该 revision 的证据；
    // 不能借“回到 expected”自动复活旧计划。
    if (!hasDocumentRevisionConflict
        && sameHistoryStateRef(current.expectedRevision, input.revision)) {
        return input.session;
    }
    const kind: RuntimeTaskRunDocumentConflictKind = current.documentId === input.revision.documentId
        ? 'external_revision_changed'
        : 'document_changed';
    return {
        ...input.session,
        taskRun: {
            ...input.session.taskRun,
            status: 'needs_reobserve',
            documentBinding: buildTaskRunDocumentConflict({
                binding: current,
                kind,
                now,
                observedRevision: input.revision
            })
        }
    };
}

/**
 * 真实文档观察已经证明目标或 history revision 改变后，将 Stage 退回观察/规划 owner。
 * TaskRun 仍保持 needs_reobserve，旧 Action Plan 也仍不可执行；只有新的 R4 声明绑定时，
 * bindRuntimeSessionActionPlan 才接受 observedRevision 并生成更高 planRevision。
 */
export function reenterRuntimeSessionAfterDocumentChange(input: {
    session: RuntimeSession;
    plan: RuntimeStagePlan;
    targetStage: RuntimeStage;
    reason?: string;
}): RuntimeSession {
    if (input.session.finalized) return input.session;
    const binding = input.session.taskRun.documentBinding;
    const conflictKind = binding?.conflict?.kind;
    const observedRevision = binding?.conflict?.observedRevision;
    if (binding?.status !== 'needs_reobserve'
        || (conflictKind !== 'document_changed' && conflictKind !== 'external_revision_changed')
        || !observedRevision) {
        return {
            ...input.session,
            issues: uniqueIssues([
                ...input.session.issues,
                'runtime_task_run_document_reentry_without_observed_revision'
            ])
        };
    }
    return {
        ...input.session,
        stageState: reobserveRuntimeStageAfterDocumentChange({
            plan: input.plan,
            state: input.session.stageState,
            targetStage: input.targetStage,
            reason: cleanText(input.reason, 240)
                || `Photoshop 目标已变化到 ${observedRevision.documentId}@${observedRevision.historyStateId}，旧计划必须重新观察并重建。`
        })
    };
}

function resolveRuntimeDocumentReobservationStage(
    plan: RuntimeStagePlan,
    currentStage: RuntimeStage | undefined
): RuntimeStage | undefined {
    if (!currentStage) return undefined;
    const currentIndex = plan.steps.findIndex((step) => step.stage === currentStage);
    if (currentIndex < 0) return undefined;
    const r2Index = plan.steps.findIndex((step) => step.stage === 'R2');
    // 当前真实读取如果正发生在 R2，本次结果本身就是新 revision 的候选证据；
    // 不应为了版本变化再退到 R1，制造一次没有信息增益的重复观察。
    if (r2Index >= 0) return r2Index < currentIndex ? 'R2' : undefined;
    const fallbackStages: RuntimeStage[] = ['R3', 'R4', 'R1'];
    return fallbackStages.find((stage) => {
        const targetIndex = plan.steps.findIndex((step) => step.stage === stage);
        return targetIndex >= 0 && targetIndex < currentIndex;
    });
}

/**
 * 把一次真实 document revision 观察与既有 Stage re-entry 合成同一个纯状态转换。
 * 不仅识别 active → needs_reobserve，也识别 needs_reobserve 期间 observedRevision 再次变化；
 * 同一 revision 的重复观察保持幂等。
 */
export function reconcileRuntimeSessionDocumentRevision(input: {
    session: RuntimeSession;
    plan: RuntimeStagePlan;
    revision: PhotoshopHistoryStateRef;
    now?: string;
}): RuntimeSession {
    const previousObservedRevision = input.session.taskRun.documentBinding?.conflict?.observedRevision;
    const observedSession = observeRuntimeSessionDocumentRevision({
        session: input.session,
        revision: input.revision,
        now: input.now
    });
    const binding = observedSession.taskRun.documentBinding;
    const observedRevision = binding?.conflict?.observedRevision;
    const conflictKind = binding?.conflict?.kind;
    const observedRevisionChanged = (binding?.status === 'needs_reobserve'
        || binding?.status === 'conflict')
        && (conflictKind === 'document_changed' || conflictKind === 'external_revision_changed')
        && Boolean(observedRevision)
        && !sameHistoryStateRef(previousObservedRevision, observedRevision);
    if (!observedRevisionChanged) return observedSession;
    const targetStage = resolveRuntimeDocumentReobservationStage(
        input.plan,
        observedSession.stageState.currentStage
    );
    if (!targetStage) return observedSession;
    return reenterRuntimeSessionAfterDocumentChange({
        session: observedSession,
        plan: input.plan,
        targetStage
    });
}

/**
 * 无 R4 的确定性 Workflow 由 R2 真实重观察直接承接 E1；它没有 Action Plan owner
 * 可以接受 observedRevision。仅在这类 Manifest 的 R2、且结果 revision 与冲突记录一致时，
 * 重新绑定 TaskRun。该 reducer 不执行 Tool、不授予能力，也不重放旧写入。
 */
export function acknowledgeRuntimeSessionWorkflowDocumentReobservation(input: {
    session: RuntimeSession;
    plan: RuntimeStagePlan;
    observedRevision: PhotoshopHistoryStateRef;
}): RuntimeSession {
    if (input.session.finalized) return input.session;
    const hasWorkflowOwnedExecution = input.plan.steps.some((step) => step.stage === 'E1')
        && !input.plan.steps.some((step) => step.stage === 'R4');
    const binding = input.session.taskRun.documentBinding;
    const conflictKind = binding?.conflict?.kind;
    const conflictRevision = binding?.conflict?.observedRevision;
    if (!hasWorkflowOwnedExecution
        || input.session.stageState.currentStage !== 'R2'
        || binding?.status !== 'needs_reobserve'
        || (conflictKind !== 'document_changed' && conflictKind !== 'external_revision_changed')
        || !sameHistoryStateRef(conflictRevision, input.observedRevision)) {
        return {
            ...input.session,
            issues: uniqueIssues([
                ...input.session.issues,
                'runtime_task_run_workflow_reobservation_not_acknowledgeable'
            ])
        };
    }
    releaseRuntimeTaskRunWriterBinding({
        taskRunId: input.session.taskRun.taskRunId,
        runId: input.session.identity.runId,
        generation: input.session.identity.generation,
        documentId: binding.documentId
    });
    return {
        ...input.session,
        issues: uniqueIssues([
            ...input.session.issues,
            'runtime_task_run_document_revision_reobserved'
        ]),
        taskRun: {
            ...input.session.taskRun,
            status: 'active',
            planRevision: input.session.taskRun.planRevision + 1,
            documentBinding: {
                documentId: input.observedRevision.documentId,
                expectedRevision: { ...input.observedRevision },
                status: 'observed'
            }
        }
    };
}

export function claimRuntimeTaskRunWriterBinding(input: {
    taskRunId: string;
    runId: string;
    generation: number;
    expectedRevision: PhotoshopHistoryStateRef;
    now?: string;
}): RuntimeTaskRunWriterDecision {
    const taskRunId = cleanIdentityToken(input.taskRunId, 160);
    const runId = cleanIdentityToken(input.runId, 160);
    const generation = Number(input.generation);
    const revision = input.expectedRevision;
    if (!taskRunId
        || !runId
        || !Number.isInteger(generation)
        || generation < 1
        || !Number.isSafeInteger(revision?.documentId)
        || revision.documentId < 1
        || !Number.isSafeInteger(revision?.historyStateId)
        || revision.historyStateId < 1) {
        return {
            status: 'invalid',
            allowed: false,
            code: 'runtime_task_run_writer_binding_invalid'
        };
    }
    const existing = activeDocumentWriterClaims.get(revision.documentId);
    const requestedIdentity: RuntimeTaskRunWriterIdentity = {
        taskRunId,
        runId,
        generation
    };
    if (existing && !sameRuntimeTaskRunWriterIdentity(existing, requestedIdentity)) {
        return {
            status: 'conflict',
            allowed: false,
            code: 'runtime_task_run_writer_conflict',
            claim: cloneRuntimeTaskRunWriterClaim(existing),
            conflictingTaskRunId: existing.taskRunId
        };
    }
    if (existing && !sameHistoryStateRef(existing.expectedRevision, revision)) {
        return {
            status: 'stale_revision',
            allowed: false,
            code: 'runtime_task_run_revision_conflict',
            claim: cloneRuntimeTaskRunWriterClaim(existing)
        };
    }
    if (existing) {
        return {
            status: 'retained',
            allowed: true,
            claim: cloneRuntimeTaskRunWriterClaim(existing)
        };
    }
    const claim: RuntimeTaskRunWriterClaim = {
        taskRunId,
        runId,
        generation,
        documentId: revision.documentId,
        expectedRevision: { ...revision },
        acquiredAt: cleanText(input.now, 40) || new Date().toISOString()
    };
    activeDocumentWriterClaims.set(revision.documentId, claim);
    return {
        status: 'acquired',
        allowed: true,
        claim: cloneRuntimeTaskRunWriterClaim(claim)
    };
}

export function claimRuntimeSessionDocumentWriter(input: {
    session: RuntimeSession;
    expectedRevision: PhotoshopHistoryStateRef;
    now?: string;
}): { session: RuntimeSession; decision: RuntimeTaskRunWriterDecision } {
    const decision = claimRuntimeTaskRunWriterBinding({
        taskRunId: input.session.taskRun.taskRunId,
        runId: input.session.identity.runId,
        generation: input.session.identity.generation,
        expectedRevision: input.expectedRevision,
        now: input.now
    });
    const current = input.session.taskRun.documentBinding || {
        documentId: input.expectedRevision.documentId,
        expectedRevision: { ...input.expectedRevision },
        status: 'observed' as const
    };
    if (!decision.allowed || !decision.claim) {
        if (decision.status === 'invalid') {
            return {
                decision,
                session: {
                    ...input.session,
                    issues: uniqueIssues([
                        ...input.session.issues,
                        'runtime_task_run_writer_binding_invalid'
                    ])
                }
            };
        }
        const writerConflict = decision.status === 'conflict';
        const kind: RuntimeTaskRunDocumentConflictKind = writerConflict
            ? 'writer_conflict'
            : 'external_revision_changed';
        return {
            decision,
            session: {
                ...input.session,
                taskRun: {
                    ...input.session.taskRun,
                    status: writerConflict ? 'writer_conflict' : 'needs_reobserve',
                    documentBinding: buildTaskRunDocumentConflict({
                        binding: current,
                        kind,
                        now: cleanText(input.now, 40) || new Date().toISOString(),
                        ...(writerConflict
                            ? { observedTaskRunId: decision.conflictingTaskRunId }
                            : { observedRevision: input.expectedRevision })
                    })
                }
            }
        };
    }
    return {
        decision,
        session: {
            ...input.session,
            taskRun: {
                ...input.session.taskRun,
                status: input.session.taskRun.status === 'writer_conflict'
                    ? 'active'
                    : input.session.taskRun.status,
                documentBinding: {
                    documentId: input.expectedRevision.documentId,
                    expectedRevision: { ...input.expectedRevision },
                    status: 'owned',
                    writer: decision.claim
                }
            }
        }
    };
}

/**
 * 在现有 E1 派发点原子记录“当前节点开始执行”并认领同一文档 writer。
 *
 * 调用方必须先完成 R4/Capability/参数/preflight 编译。本 reducer 不选择节点、
 * 不调用 Tool，也不把 execution ref 当成成功或质量证据。
 */
export function beginRuntimeSessionNodeExecution(input: {
    session: RuntimeSession;
    nodeId: string;
    planRevision: number;
    planFingerprint: string;
    expectedRevision: PhotoshopHistoryStateRef;
    executionRef: RuntimeTaskRunNodeExecutionRef;
    now?: string;
}): { session: RuntimeSession; decision: RuntimeTaskRunNodeExecutionDecision } {
    const boundaries = {
        recordsExistingDispatchOnly: true as const,
        executesTools: false as const,
        grantsPermission: false as const,
        schedulerAuthority: false as const
    };
    const nodeId = cleanIdentityToken(input.nodeId, 160);
    const planFingerprint = cleanIdentityToken(input.planFingerprint, 160);
    const taskRun = input.session.taskRun;
    const binding = taskRun.documentBinding;
    if (input.session.finalized
        || taskRun.status !== 'active'
        || !nodeId
        || !planFingerprint
        || input.planRevision !== taskRun.planRevision
        || planFingerprint !== taskRun.planFingerprint
        || input.executionRef.planRevision !== taskRun.planRevision
        || input.executionRef.target.documentId !== input.expectedRevision.documentId
        || input.executionRef.target.historyStateId !== input.expectedRevision.historyStateId) {
        return {
            session: input.session,
            decision: {
                status: 'blocked',
                allowed: false,
                code: 'runtime_task_run_node_execution_binding_invalid',
                boundaries
            }
        };
    }
    const node = taskRun.nodes.find((candidate) => candidate.nodeId === nodeId);
    if (taskRun.currentNodeId !== nodeId) {
        return {
            session: input.session,
            decision: {
                status: 'blocked',
                allowed: false,
                code: 'runtime_task_run_node_not_current',
                nodeId,
                boundaries
            }
        };
    }
    if (!node || node.status !== 'ready') {
        return {
            session: input.session,
            decision: {
                status: 'blocked',
                allowed: false,
                code: 'runtime_task_run_node_not_ready',
                nodeId,
                boundaries
            }
        };
    }
    if (!binding
        || binding.status === 'conflict'
        || binding.status === 'needs_reobserve'
        || !sameHistoryStateRef(binding.expectedRevision, input.expectedRevision)) {
        return {
            session: input.session,
            decision: {
                status: 'blocked',
                allowed: false,
                code: 'runtime_task_run_node_revision_mismatch',
                nodeId,
                boundaries
            }
        };
    }
    const executionRef: RuntimeTaskRunNodeExecutionRef = {
        envelopeId: cleanExecutionToken(input.executionRef.envelopeId, 160),
        packVersion: cleanExecutionToken(input.executionRef.packVersion, 160),
        packId: cleanExecutionToken(input.executionRef.packId, 160),
        capabilityRef: cleanExecutionToken(input.executionRef.capabilityRef, 160),
        providerName: cleanExecutionToken(input.executionRef.providerName, 160),
        providerCallId: cleanExecutionToken(input.executionRef.providerCallId, 160),
        argumentFingerprint: cleanExecutionToken(input.executionRef.argumentFingerprint, 160),
        planRevision: input.executionRef.planRevision,
        target: { ...input.executionRef.target },
        compiledAt: cleanText(input.executionRef.compiledAt, 40) || new Date().toISOString()
    };
    if (!executionRef.envelopeId
        || !executionRef.packVersion
        || !executionRef.packId
        || !executionRef.capabilityRef
        || !executionRef.providerName
        || !executionRef.providerCallId
        || !executionRef.argumentFingerprint) {
        return {
            session: input.session,
            decision: {
                status: 'blocked',
                allowed: false,
                code: 'runtime_task_run_node_execution_binding_invalid',
                nodeId,
                boundaries
            }
        };
    }
    const claimed = claimRuntimeSessionDocumentWriter({
        session: input.session,
        expectedRevision: input.expectedRevision,
        now: input.now
    });
    if (!claimed.decision.allowed) {
        return {
            session: claimed.session,
            decision: {
                status: 'blocked',
                allowed: false,
                code: claimed.decision.code,
                nodeId,
                writerDecision: claimed.decision,
                boundaries
            }
        };
    }
    const nodes = claimed.session.taskRun.nodes.map((candidate) => {
        if (candidate.nodeId !== nodeId) return candidate;
        return {
            ...candidate,
            status: 'in_progress' as const,
            executionRefs: [
                ...(candidate.executionRefs || []),
                executionRef
            ].slice(-12)
        };
    });
    return {
        session: {
            ...claimed.session,
            taskRun: {
                ...claimed.session.taskRun,
                nodes
            }
        },
        decision: {
            status: 'started',
            allowed: true,
            nodeId,
            writerDecision: claimed.decision,
            boundaries
        }
    };
}

export function releaseRuntimeTaskRunWriterBinding(input: {
    taskRunId: string;
    runId: string;
    generation: number;
    documentId?: number;
}): boolean {
    const identity: RuntimeTaskRunWriterIdentity = {
        taskRunId: cleanIdentityToken(input.taskRunId, 160),
        runId: cleanIdentityToken(input.runId, 160),
        generation: Number(input.generation)
    };
    if (!identity.taskRunId
        || !identity.runId
        || !Number.isInteger(identity.generation)
        || identity.generation < 1) {
        return false;
    }
    const documentIds = input.documentId
        ? [input.documentId]
        : [...activeDocumentWriterClaims.keys()];
    let released = false;
    for (const documentId of documentIds) {
        const claim = activeDocumentWriterClaims.get(documentId);
        if (!claim || !sameRuntimeTaskRunWriterIdentity(claim, identity)) continue;
        activeDocumentWriterClaims.delete(documentId);
        released = true;
    }
    return released;
}

/**
 * 把统一 Skill 收据中的原始 revision proof 投影回同一 TaskRun。
 * proof source 保持 mutation_commit / history_transition / operation_result 原值；
 * 不把 acceptance/readback 证明重新包装成 same-modal committed OperationResult。
 */
export function recordRuntimeSessionSkillRevisionTransition(input: {
    session: RuntimeSession;
    projectionId: string;
    workflowToolName: string;
    transition: SkillExecutionRevisionTransition;
    now?: string;
}): RuntimeSession {
    const projectionId = cleanExecutionToken(input.projectionId, 180);
    const workflowToolName = cleanIdentityToken(input.workflowToolName, 100);
    const transition = input.transition;
    const sourceValid = transition.source === 'mutation_commit'
        || transition.source === 'history_transition'
        || transition.source === 'operation_result';
    if (!projectionId || !workflowToolName || !sourceValid
        || !Number.isSafeInteger(transition.after?.documentId)
        || transition.after.documentId <= 0
        || !Number.isSafeInteger(transition.after?.historyStateId)
        || transition.after.historyStateId <= 0) {
        return {
            ...input.session,
            issues: uniqueIssues([
                ...input.session.issues,
                'runtime_task_run_skill_revision_projection_invalid'
            ])
        };
    }
    if ((input.session.taskRun.skillRevisionProjections || []).some((entry) => (
        entry.projectionId === projectionId
    ))) {
        return input.session;
    }
    const now = cleanText(input.now, 40) || new Date().toISOString();
    const before = transition.before;
    const after = transition.after;
    let binding = input.session.taskRun.documentBinding;
    if (!binding) {
        const initialRevision = before || after;
        binding = {
            documentId: initialRevision.documentId,
            expectedRevision: { ...initialRevision },
            status: 'observed'
        };
    }
    const beforeMismatch = Boolean(before
        && !sameHistoryStateRef(binding.expectedRevision, before));
    let nextBinding = binding;
    let taskRunStatus = input.session.taskRun.status;
    if (beforeMismatch) {
        nextBinding = buildTaskRunDocumentConflict({
            binding,
            kind: binding.documentId === before!.documentId
                ? 'external_revision_changed'
                : 'document_changed',
            now,
            observedRevision: before
        });
        taskRunStatus = 'needs_reobserve';
    } else if (!transition.toolActionCompleted) {
        nextBinding = buildTaskRunDocumentConflict({
            binding,
            kind: 'operation_state_unknown',
            now,
            observedRevision: after
        });
        taskRunStatus = 'needs_reobserve';
    } else {
        const writer = binding.writer
            ? {
                ...binding.writer,
                documentId: after.documentId,
                expectedRevision: { ...after }
            }
            : undefined;
        const sourceWriter = binding.writer
            ? activeDocumentWriterClaims.get(binding.documentId)
            : undefined;
        const sourceWriterValid = !binding.writer || Boolean(
            sourceWriter
            && sameRuntimeTaskRunWriterIdentity(binding.writer, sourceWriter)
            && sameHistoryStateRef(binding.writer.expectedRevision, sourceWriter.expectedRevision)
            && sameHistoryStateRef(binding.expectedRevision, sourceWriter.expectedRevision)
        );
        const competingWriter = writer
            ? activeDocumentWriterClaims.get(after.documentId)
            : undefined;
        if (!sourceWriterValid) {
            const competingOwner = sourceWriter
                && !sameRuntimeTaskRunWriterIdentity(binding.writer!, sourceWriter);
            nextBinding = buildTaskRunDocumentConflict({
                binding,
                kind: competingOwner ? 'writer_conflict' : 'operation_state_unknown',
                now,
                ...(competingOwner ? { observedTaskRunId: sourceWriter.taskRunId } : {}),
                observedRevision: after
            });
            taskRunStatus = competingOwner ? 'writer_conflict' : 'needs_reobserve';
        } else if (writer && competingWriter
            && !sameRuntimeTaskRunWriterIdentity(writer, competingWriter)) {
            nextBinding = buildTaskRunDocumentConflict({
                binding,
                kind: 'writer_conflict',
                now,
                observedTaskRunId: competingWriter.taskRunId,
                observedRevision: after
            });
            taskRunStatus = 'writer_conflict';
        } else {
            if (writer) {
                const priorClaim = activeDocumentWriterClaims.get(binding.documentId);
                if (priorClaim && sameRuntimeTaskRunWriterIdentity(priorClaim, writer)) {
                    activeDocumentWriterClaims.delete(binding.documentId);
                }
                activeDocumentWriterClaims.set(after.documentId, writer);
            }
            nextBinding = {
                ...binding,
                documentId: after.documentId,
                expectedRevision: { ...after },
                status: writer ? 'owned' : 'observed',
                ...(writer ? { writer } : {}),
                conflict: undefined
            };
        }
    }
    const projection: RuntimeTaskRunSkillRevisionProjectionRef = {
        projectionId,
        workflowToolName,
        planRevision: input.session.taskRun.planRevision,
        source: transition.source,
        toolActionCompleted: transition.toolActionCompleted,
        ...(before ? { before: { ...before } } : {}),
        after: { ...after },
        recordedAt: now
    };
    return {
        ...input.session,
        taskRun: {
            ...input.session.taskRun,
            status: taskRunStatus,
            documentBinding: nextBinding,
            skillRevisionProjections: [
                ...(input.session.taskRun.skillRevisionProjections || []),
                projection
            ].slice(-MAX_TASK_RUN_SKILL_REVISION_PROJECTIONS)
        }
    };
}

export function markRuntimeSessionSkillEffectUnknown(input: {
    session: RuntimeSession;
    workflowToolName: string;
    observedRevision?: PhotoshopHistoryStateRef;
    runtimeLineage?: SkillExecutionRuntimeLineage;
    now?: string;
}): RuntimeSession {
    const now = cleanText(input.now, 40) || new Date().toISOString();
    const observedRevisionValid = !input.observedRevision || (
        Number.isSafeInteger(input.observedRevision.documentId)
        && input.observedRevision.documentId > 0
        && Number.isSafeInteger(input.observedRevision.historyStateId)
        && input.observedRevision.historyStateId > 0
    );
    const observedRevision = observedRevisionValid ? input.observedRevision : undefined;
    let binding = input.session.taskRun.documentBinding;
    if (!binding && observedRevision) {
        binding = {
            documentId: observedRevision.documentId,
            expectedRevision: { ...observedRevision },
            status: 'observed'
        };
    }
    const nextBinding = binding
        ? buildTaskRunDocumentConflict({
            binding,
            kind: 'operation_state_unknown',
            now,
            observedRevision: observedRevision || binding.expectedRevision
        })
        : undefined;
    const existingSideEffectState = input.session.taskRun.sideEffectState;
    const runtimeLineage = input.runtimeLineage
        || (existingSideEffectState?.workflowToolName === input.workflowToolName
            ? existingSideEffectState.runtimeLineage
            : undefined);
    return {
        ...input.session,
        taskRun: {
            ...input.session.taskRun,
            status: nextBinding ? 'needs_reobserve' : input.session.taskRun.status,
            ...(nextBinding ? { documentBinding: nextBinding } : {}),
            sideEffectState: {
                status: 'unknown',
                workflowToolName: cleanIdentityToken(input.workflowToolName, 100)
                    || 'unknown_workflow',
                recordedAt: now,
                ...(observedRevision ? { observedRevision: { ...observedRevision } } : {}),
                ...(runtimeLineage ? { runtimeLineage: { ...runtimeLineage } } : {})
            }
        },
        issues: uniqueIssues([
            ...input.session.issues,
            ...(!observedRevisionValid
                ? ['runtime_skill_effect_unknown_observation_invalid']
                : []),
            `runtime_skill_effect_state_unknown:${cleanIdentityToken(input.workflowToolName, 100)
                || 'unknown_workflow'}`
        ])
    };
}

function sameRuntimeSkillEffectLineage(
    left: SkillExecutionRuntimeLineage,
    right: SkillExecutionRuntimeLineage
): boolean {
    return left.version === 'skill-execution-runtime-lineage/v0'
        && right.version === left.version
        && left.sessionId === right.sessionId
        && left.runId === right.runId
        && left.generation === right.generation
        && left.taskRunId === right.taskRunId
        && left.planRevision === right.planRevision
        && left.continuationId === right.continuationId
        && left.workflowCallId === right.workflowCallId
        && left.skillId === right.skillId;
}

function runtimeSkillEffectLineageMatchesSession(input: {
    lineage: SkillExecutionRuntimeLineage;
    session: RuntimeSession;
    workflowToolName: string;
}): boolean {
    return input.lineage.version === 'skill-execution-runtime-lineage/v0'
        && input.lineage.sessionId === input.session.identity.sessionId
        && input.lineage.runId === input.session.identity.runId
        && input.lineage.generation === input.session.identity.generation
        && input.lineage.taskRunId === input.session.taskRun.taskRunId
        && input.lineage.planRevision === input.session.taskRun.planRevision
        && input.lineage.skillId === input.workflowToolName
        && Boolean(cleanIdentityToken(input.lineage.continuationId, 160))
        && Boolean(cleanIdentityToken(input.lineage.workflowCallId, 160));
}

/**
 * 解除 Skill effect unknown 的唯一 Runtime reducer。
 *
 * Renderer 只有在同一 reentry Agent 已取得真实视觉/无文档共识，且模型随后主动选择
 * 下一项原子动作时才构造 receipt。本 reducer 复核完整 lineage、当前 plan、目标 revision
 * 与 writer；普通 getDocumentInfo、助手文字或旧 generation 不能单独解除。
 */
export function reconcileRuntimeSessionSkillEffectUnknown(input: {
    session: RuntimeSession;
    receipt: RuntimeSkillEffectReconciliationReceipt;
    now?: string;
}): RuntimeSkillEffectReconciliationDecision {
    const sideEffectState = input.session.taskRun.sideEffectState;
    if (sideEffectState?.status !== 'unknown') {
        return {
            status: 'rejected',
            code: 'runtime_skill_effect_not_unknown',
            session: input.session
        };
    }
    const receipt = input.receipt;
    const workflowToolName = cleanIdentityToken(receipt?.workflowToolName, 100);
    const observationToolNames = Array.from(new Set(
        (receipt?.observationToolNames || [])
            .map((name) => cleanIdentityToken(name, 100))
            .filter(Boolean)
    ));
    const nextToolName = cleanIdentityToken(receipt?.nextToolName, 100);
    const lineage = receipt?.runtimeLineage;
    const storedLineage = sideEffectState.runtimeLineage;
    const identityValid = receipt?.version === RUNTIME_SKILL_EFFECT_RECONCILIATION_VERSION
        && Boolean(storedLineage)
        && workflowToolName === sideEffectState.workflowToolName
        && Boolean(lineage)
        && sameRuntimeSkillEffectLineage(storedLineage!, lineage)
        && runtimeSkillEffectLineageMatchesSession({
            lineage,
            session: input.session,
            workflowToolName
        })
        && receipt.boundaries?.agentSelectedNextAtomicAction === true
        && receipt.boundaries.operationIdentityBound === true
        && receipt.boundaries.executesTools === false
        && receipt.boundaries.grantsPermission === false
        && Boolean(nextToolName)
        && nextToolName !== workflowToolName
        && !input.session.taskRun.pendingInteraction;
    if (!identityValid) {
        return {
            status: 'rejected',
            code: 'runtime_skill_effect_reconciliation_identity_mismatch',
            session: input.session
        };
    }

    const binding = input.session.taskRun.documentBinding;
    const observedRevision = receipt.observedRevision;
    const revisionValid = Boolean(observedRevision
        && Number.isSafeInteger(observedRevision.documentId)
        && observedRevision.documentId > 0
        && Number.isSafeInteger(observedRevision.historyStateId)
        && observedRevision.historyStateId > 0);
    const expectedUnknownRevision = sideEffectState.observedRevision
        || binding?.conflict?.observedRevision
        || binding?.expectedRevision;
    const observedRevisionMatchesUnknown = sameHistoryStateRef(
        expectedUnknownRevision,
        observedRevision
    );
    const compactWorkflowCanAdoptFreshRevision = input.session.taskRun.nodes.length === 0
        && !input.session.taskRun.planFingerprint;
    const visualBinding = receipt.visualObservationBinding;
    const visualBindingValid = Boolean(
        visualBinding
        && cleanText(visualBinding.observationKey, 320)
        && cleanIdentityToken(visualBinding.sourceTool, 100)
        && observationToolNames.includes(visualBinding.sourceTool)
        && visualBinding.observer === 'primary_model'
        && Number.isSafeInteger(visualBinding.documentId)
        && visualBinding.documentId > 0
        && Number.isSafeInteger(visualBinding.historyStateId)
        && visualBinding.historyStateId > 0
        && Number.isSafeInteger(visualBinding.presentedModelTurn)
        && visualBinding.presentedModelTurn >= 0
        && Number.isSafeInteger(visualBinding.consumedModelTurn)
        && visualBinding.consumedModelTurn >= visualBinding.presentedModelTurn
        && visualBinding.documentId === observedRevision?.documentId
        && visualBinding.historyStateId === observedRevision?.historyStateId
    );
    const adoptsRevision = receipt.conclusion === 'adopt_observed_revision'
        && receipt.boundaries.visualObservationVerified === true
        && visualBindingValid
        && observationToolNames.length > 0
        && revisionValid
        && Boolean(binding)
        && binding?.conflict?.kind === 'operation_state_unknown'
        && (observedRevisionMatchesUnknown || compactWorkflowCanAdoptFreshRevision);
    const confirmsNoDocument = receipt.conclusion === 'confirm_no_document'
        && receipt.boundaries.noDocumentConsensusVerified === true
        && observationToolNames.length >= 2
        && !binding
        && !sideEffectState.observedRevision
        && observedRevision === undefined;
    if (!adoptsRevision && !confirmsNoDocument) {
        return {
            status: 'rejected',
            code: 'runtime_skill_effect_reconciliation_evidence_invalid',
            session: input.session
        };
    }

    let nextBinding = binding;
    if (adoptsRevision && binding && observedRevision) {
        const expectedOwner: RuntimeTaskRunWriterIdentity = {
            taskRunId: input.session.taskRun.taskRunId,
            runId: input.session.identity.runId,
            generation: input.session.identity.generation
        };
        const sourceDocumentId = binding.writer?.documentId || binding.documentId;
        const sourceClaim = activeDocumentWriterClaims.get(sourceDocumentId);
        const targetClaim = activeDocumentWriterClaims.get(observedRevision.documentId);
        const sourceWriterValid = !binding.writer || Boolean(
            sourceClaim
            && sameRuntimeTaskRunWriterIdentity(binding.writer, expectedOwner)
            && sameRuntimeTaskRunWriterIdentity(sourceClaim, expectedOwner)
        );
        const targetWriterCompatible = !targetClaim
            || sameRuntimeTaskRunWriterIdentity(targetClaim, expectedOwner);
        if (!sourceWriterValid || !targetWriterCompatible) {
            return {
                status: 'rejected',
                code: 'runtime_skill_effect_reconciliation_writer_mismatch',
                session: input.session
            };
        }
        const retainedClaim = sourceClaim || targetClaim;
        const writer = retainedClaim
            ? {
                ...retainedClaim,
                documentId: observedRevision.documentId,
                expectedRevision: { ...observedRevision }
            }
            : undefined;
        if (writer) {
            if (sourceDocumentId !== observedRevision.documentId) {
                activeDocumentWriterClaims.delete(sourceDocumentId);
            }
            activeDocumentWriterClaims.set(observedRevision.documentId, writer);
        }
        nextBinding = {
            documentId: observedRevision.documentId,
            expectedRevision: { ...observedRevision },
            status: writer ? 'owned' : 'observed',
            ...(writer ? { writer } : {})
        };
    }
    const taskRun: RuntimeTaskRunState = {
        ...input.session.taskRun,
        status: 'active',
        planRevision: adoptsRevision && !observedRevisionMatchesUnknown
            ? input.session.taskRun.planRevision + 1
            : input.session.taskRun.planRevision,
        ...(nextBinding ? { documentBinding: nextBinding } : {})
    };
    delete taskRun.sideEffectState;
    const now = cleanText(input.now, 40) || new Date().toISOString();
    return {
        status: 'reconciled',
        code: 'runtime_skill_effect_reconciled',
        session: {
            ...input.session,
            taskRun,
            issues: uniqueIssues([
                ...input.session.issues,
                `runtime_skill_effect_reconciled:${workflowToolName}:${receipt.conclusion}:${now}`
            ])
        }
    };
}

export function recordRuntimeSessionOperationResult(input: {
    session: RuntimeSession;
    result: unknown;
    nodeId?: string;
    now?: string;
}): RuntimeSession {
    const operation = readPhotoshopOperationResult(input.result);
    if (!operation) {
        return {
            ...input.session,
            issues: uniqueIssues([
                ...input.session.issues,
                'runtime_task_run_operation_result_invalid_or_missing'
            ])
        };
    }
    if (input.session.taskRun.operationResults.some((entry) => (
        entry.operationId === operation.operationId
    ))) {
        return input.session;
    }
    const now = cleanText(input.now, 40) || new Date().toISOString();
    let session = input.session;
    const before = operation.before;
    const after = operation.after;
    if (!session.taskRun.documentBinding && (before || after)) {
        const revision = before || after!;
        session = {
            ...session,
            taskRun: {
                ...session.taskRun,
                documentBinding: {
                    documentId: revision.documentId,
                    expectedRevision: { ...revision },
                    status: 'observed'
                }
            }
        };
    }
    const binding = session.taskRun.documentBinding;
    const observedBeforeMismatch = Boolean(binding && before
        && !sameHistoryStateRef(binding.expectedRevision, before));
    if (binding && observedBeforeMismatch) {
        session = {
            ...session,
            taskRun: {
                ...session.taskRun,
                status: 'needs_reobserve',
                documentBinding: buildTaskRunDocumentConflict({
                    binding,
                    kind: binding.documentId === before!.documentId
                        ? 'external_revision_changed'
                        : 'document_changed',
                    now,
                    observedRevision: before
                })
            }
        };
    }
    let operationWriterClaimAllowed = true;
    if (operation.applicationStatus !== 'not_applied' && (before || after)) {
        const revision = before || after!;
        const claimed = claimRuntimeSessionDocumentWriter({
            session,
            expectedRevision: revision,
            now
        });
        session = claimed.session;
        operationWriterClaimAllowed = claimed.decision.allowed;
    }
    let nextBinding = session.taskRun.documentBinding;
    if (nextBinding && operation.status === 'unknown') {
        nextBinding = buildTaskRunDocumentConflict({
            binding: nextBinding,
            kind: 'operation_state_unknown',
            now,
            observedRevision: after || before
        });
    } else if (nextBinding && after && !observedBeforeMismatch && operationWriterClaimAllowed) {
        let writer = nextBinding.writer
            ? { ...nextBinding.writer, expectedRevision: { ...after } }
            : undefined;
        if (writer) {
            const activeClaim = activeDocumentWriterClaims.get(writer.documentId);
            if (!activeClaim
                || after.documentId !== writer.documentId
                || !sameRuntimeTaskRunWriterIdentity(activeClaim, writer)) {
                throw new Error('runtime_task_run_writer_revision_owner_mismatch');
            }
            writer = {
                ...activeClaim,
                expectedRevision: { ...after }
            };
            activeDocumentWriterClaims.set(after.documentId, writer);
        }
        nextBinding = {
            ...nextBinding,
            documentId: after.documentId,
            expectedRevision: { ...after },
            status: writer ? 'owned' : 'observed',
            ...(writer ? { writer } : {}),
            conflict: undefined
        };
    }
    const operationRef: RuntimeTaskRunOperationResultRef = {
        operationId: operation.operationId,
        toolName: operation.toolName,
        planRevision: session.taskRun.planRevision,
        ...(input.nodeId ? { nodeId: input.nodeId } : {}),
        recordedAt: now,
        status: operation.status,
        applicationStatus: operation.applicationStatus,
        transactionState: operation.transactionState,
        before: cloneHistoryStateRef(before),
        after: cloneHistoryStateRef(after)
    };
    const nodes = session.taskRun.nodes.map((node) => {
        if (!input.nodeId || node.nodeId !== input.nodeId) return node;
        return {
            ...node,
            status: operation.status,
            operationResultIds: [...node.operationResultIds, operation.operationId]
        };
    });
    const nodeKnown = !input.nodeId || nodes.some((node) => node.nodeId === input.nodeId);
    return {
        ...session,
        taskRun: {
            ...session.taskRun,
            ...(operation.status === 'unknown' ? { status: 'needs_reobserve' as const } : {}),
            nodes,
            ...(nextBinding ? { documentBinding: nextBinding } : {}),
            operationResults: [
                ...session.taskRun.operationResults,
                operationRef
            ].slice(-MAX_TASK_RUN_OPERATION_RESULTS)
        },
        issues: uniqueIssues([
            ...session.issues,
            ...(!input.nodeId ? ['runtime_task_run_operation_result_unattributed'] : []),
            ...(!nodeKnown ? [`runtime_task_run_operation_node_missing:${input.nodeId}`] : [])
        ])
    };
}

/**
 * 已编译节点没有返回可绑定 PhotoshopOperationResult 时的保真降级。
 * 明确 `knownNotExecuted` 才能记 failed；其余一律记 unknown + needs_reobserve，
 * 禁止把可能已派发的 mutation 当成未发生并自动重放。
 */
export function recordRuntimeSessionNodeResultUnbound(input: {
    session: RuntimeSession;
    nodeId: string;
    knownNotExecuted: boolean;
    reason: 'missing' | 'provider_mismatch';
    now?: string;
}): RuntimeSession {
    const nodeId = cleanIdentityToken(input.nodeId, 160);
    const nodeKnown = input.session.taskRun.nodes.some((node) => node.nodeId === nodeId);
    if (!nodeId || !nodeKnown) {
        return {
            ...input.session,
            issues: uniqueIssues([
                ...input.session.issues,
                `runtime_task_run_compiled_node_missing:${nodeId || 'invalid'}`
            ])
        };
    }
    const now = cleanText(input.now, 40) || new Date().toISOString();
    const nodes = input.session.taskRun.nodes.map((node) => (
        node.nodeId === nodeId
            ? { ...node, status: input.knownNotExecuted ? 'failed' as const : 'unknown' as const }
            : node
    ));
    const binding = input.session.taskRun.documentBinding;
    const nextBinding = !input.knownNotExecuted && binding
        ? buildTaskRunDocumentConflict({
            binding,
            kind: 'operation_state_unknown',
            now,
            observedRevision: binding.expectedRevision
        })
        : binding;
    return {
        ...input.session,
        taskRun: {
            ...input.session.taskRun,
            status: input.knownNotExecuted ? input.session.taskRun.status : 'needs_reobserve',
            nodes,
            ...(nextBinding ? { documentBinding: nextBinding } : {})
        },
        issues: uniqueIssues([
            ...input.session.issues,
            `runtime_task_run_compiled_node_operation_result_${input.reason}:${nodeId}`
        ])
    };
}

export function suspendRuntimeSessionForInteraction(input: {
    session: RuntimeSession;
    interactionId: string;
    continuationId?: string;
    cardId?: string;
    nodeId?: string;
    expectedRevision?: PhotoshopHistoryStateRef;
    inheritSessionExpectedRevision?: boolean;
    now?: string;
}): { session: RuntimeSession; binding: RuntimeTaskRunInteractionBinding } {
    const interactionId = cleanIdentityToken(input.interactionId, 160);
    if (!interactionId) throw new Error('runtime_task_run_interaction_id_invalid');
    const now = cleanText(input.now, 40) || new Date().toISOString();
    const expectedRevision = input.expectedRevision
        || (input.inheritSessionExpectedRevision === false
            ? undefined
            : input.session.taskRun.documentBinding?.expectedRevision);
    const currentDocumentBinding = input.session.taskRun.documentBinding;
    const pauseRevisionRebindRequired = Boolean(expectedRevision
        && (!currentDocumentBinding
            || !sameHistoryStateRef(currentDocumentBinding.expectedRevision, expectedRevision)));
    if (pauseRevisionRebindRequired && currentDocumentBinding) {
        releaseRuntimeTaskRunWriterBinding({
            taskRunId: input.session.taskRun.taskRunId,
            runId: input.session.identity.runId,
            generation: input.session.identity.generation,
            documentId: currentDocumentBinding.documentId
        });
    }
    const pausedDocumentBinding = pauseRevisionRebindRequired && expectedRevision
        ? {
            documentId: expectedRevision.documentId,
            expectedRevision: { ...expectedRevision },
            status: 'observed' as const
        }
        : currentDocumentBinding;
    const nodeId = cleanIdentityToken(input.nodeId || input.session.taskRun.currentNodeId, 120);
    const binding: RuntimeTaskRunInteractionBinding = {
        version: RUNTIME_TASK_RUN_INTERACTION_BINDING_VERSION,
        taskRunId: input.session.taskRun.taskRunId,
        runId: input.session.identity.runId,
        generation: input.session.identity.generation,
        interactionId,
        planRevision: input.session.taskRun.planRevision,
        ...(nodeId ? { nodeId } : {}),
        ...(expectedRevision ? { expectedRevision: { ...expectedRevision } } : {}),
        issuedAt: now,
        boundaries: {
            identityOnly: true,
            resumesExistingTaskRunOnly: true,
            grantsPermission: false,
            executesTools: false
        }
    };
    const nodes = input.session.taskRun.nodes.map((node) => (
        node.nodeId === nodeId
            ? { ...node, status: 'waiting_user' as const }
            : node
    ));
    const previousNodeStatus = input.session.taskRun.nodes.find((node) => node.nodeId === nodeId)?.status;
    return {
        binding,
        session: {
            ...input.session,
            finalized: false,
            taskRun: {
                ...input.session.taskRun,
                status: 'waiting_user',
                nodes,
                ...(pausedDocumentBinding ? { documentBinding: pausedDocumentBinding } : {}),
                pendingInteraction: {
                    ...binding,
                    ...(cleanIdentityToken(input.continuationId, 160)
                        ? { continuationId: cleanIdentityToken(input.continuationId, 160) }
                        : {}),
                    ...(cleanIdentityToken(input.cardId, 160)
                        ? { cardId: cleanIdentityToken(input.cardId, 160) }
                        : {}),
                    ...(previousNodeStatus ? { previousNodeStatus } : {})
                }
            }
        }
    };
}

export function resumeRuntimeSessionInteraction(input: {
    session: RuntimeSession;
    plan: RuntimeStagePlan;
    taskRunId: string;
    interactionId: string;
    observedRevision?: PhotoshopHistoryStateRef;
}): RuntimeTaskRunResumeDecision {
    const pending = input.session.taskRun.pendingInteraction;
    if (!pending || input.session.taskRun.status !== 'waiting_user') {
        return { status: 'rejected', code: 'runtime_task_run_not_waiting', session: input.session };
    }
    if (pending.taskRunId !== input.taskRunId) {
        return { status: 'rejected', code: 'runtime_task_run_id_mismatch', session: input.session };
    }
    if (pending.interactionId !== input.interactionId) {
        return {
            status: 'rejected',
            code: 'runtime_task_run_interaction_mismatch',
            session: input.session
        };
    }
    if (pending.expectedRevision
        && !sameHistoryStateRef(pending.expectedRevision, input.observedRevision)) {
        return {
            status: 'rejected',
            code: 'runtime_task_run_revision_mismatch',
            session: observeRuntimeSessionDocumentRevision({
                session: input.session,
                revision: input.observedRevision || pending.expectedRevision
            })
        };
    }
    const nodes = input.session.taskRun.nodes.map((node) => {
        if (node.nodeId !== pending.nodeId || node.status !== 'waiting_user') return node;
        return { ...node, status: pending.previousNodeStatus || 'pending' };
    });
    return {
        status: 'resumed',
        session: {
            ...input.session,
            finalized: false,
            stageState: resumeRuntimeStageAfterUserConfirmation({
                plan: input.plan,
                state: input.session.stageState
            }),
            taskRun: {
                ...input.session.taskRun,
                status: 'active',
                nodes,
                pendingInteraction: undefined
            }
        }
    };
}

export function validateRuntimeTaskRunInteractionBinding(
    value: unknown
): value is RuntimeTaskRunInteractionBinding {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const binding = value as Partial<RuntimeTaskRunInteractionBinding>;
    if (binding.version !== RUNTIME_TASK_RUN_INTERACTION_BINDING_VERSION
        || !cleanIdentityToken(binding.taskRunId, 160)
        || !cleanIdentityToken(binding.runId, 160)
        || !Number.isInteger(binding.generation)
        || Number(binding.generation) < 1
        || !cleanIdentityToken(binding.interactionId, 160)
        || !Number.isInteger(binding.planRevision)
        || Number(binding.planRevision) < 0
        || !cleanText(binding.issuedAt, 40)
        || !Number.isFinite(Date.parse(String(binding.issuedAt)))) {
        return false;
    }
    if (binding.nodeId && !cleanIdentityToken(binding.nodeId, 120)) return false;
    if (binding.expectedRevision && (
        !Number.isSafeInteger(binding.expectedRevision.documentId)
        || binding.expectedRevision.documentId < 1
        || !Number.isSafeInteger(binding.expectedRevision.historyStateId)
        || binding.expectedRevision.historyStateId < 1
    )) {
        return false;
    }
    return Boolean(binding.boundaries
        && binding.boundaries.identityOnly === true
        && binding.boundaries.resumesExistingTaskRunOnly === true
        && binding.boundaries.grantsPermission === false
        && binding.boundaries.executesTools === false);
}

export function advanceRuntimeSessionGeneration(input: {
    previous: RuntimeSession;
    identity: RuntimeSessionIdentity;
    plan: RuntimeStagePlan;
}): RuntimeSession {
    const validation = validateRuntimeSessionIdentity(input.identity);
    if (!validation.ok) throw new Error(validation.issues.join(','));
    if (!input.previous.finalized) throw new Error('runtime_session_previous_generation_not_finalized');
    if (input.identity.sessionId !== input.previous.identity.sessionId) {
        throw new Error('runtime_session_generation_session_mismatch');
    }
    if (input.identity.generation !== input.previous.identity.generation + 1) {
        throw new Error('runtime_session_generation_not_monotonic');
    }
    if (input.identity.parentRunId !== input.previous.identity.runId) {
        throw new Error('runtime_session_generation_parent_mismatch');
    }
    if (input.plan.skillId !== input.previous.skillId || input.plan.taskType !== input.previous.taskType) {
        throw new Error('runtime_session_generation_plan_mismatch');
    }
    const copiedStageState: RuntimeStageState = {
        ...input.previous.stageState,
        stages: input.previous.stageState.stages.map((stage) => ({
            ...stage,
            requiredOutcomes: [...stage.requiredOutcomes],
            observedOutcomes: [...stage.observedOutcomes],
            missingOutcomes: [...stage.missingOutcomes],
            ...(stage.lastEvaluation ? {
                lastEvaluation: {
                    ...stage.lastEvaluation,
                    ...(stage.lastEvaluation.verdict
                        ? { verdict: { ...stage.lastEvaluation.verdict } }
                        : {})
                }
            } : {})
        })),
        transitions: input.previous.stageState.transitions.map((transition) => ({
            ...transition,
            observedOutcomes: [...transition.observedOutcomes],
            missingOutcomes: [...transition.missingOutcomes]
        })),
        issues: [...input.previous.stageState.issues]
    };
    const taskRun = cloneRuntimeTaskRunState(input.previous.taskRun);
    const structuralStatus = resolveRuntimeTaskRunStructuralStatus(input.previous);
    if (taskRun.documentBinding?.writer) {
        const previousBinding = taskRun.documentBinding;
        const projectedWriter = previousBinding.writer!;
        const previousWriterIdentity: RuntimeTaskRunWriterIdentity = {
            taskRunId: taskRun.taskRunId,
            runId: input.previous.identity.runId,
            generation: input.previous.identity.generation
        };
        const nextWriterIdentity: RuntimeTaskRunWriterIdentity = {
            taskRunId: taskRun.taskRunId,
            runId: input.identity.runId,
            generation: input.identity.generation
        };
        if (!sameRuntimeTaskRunWriterIdentity(projectedWriter, previousWriterIdentity)) {
            throw new Error('runtime_session_generation_writer_projection_mismatch');
        }
        const activeClaim = activeDocumentWriterClaims.get(projectedWriter.documentId);
        if (!activeClaim) {
            // 已释放的 owner 不能借 generation 迁移复活。下一代要写入时必须重新走原子 claim。
            const observedBinding = { ...previousBinding };
            delete observedBinding.writer;
            observedBinding.status = previousBinding.status === 'owned'
                ? 'observed'
                : previousBinding.status;
            taskRun.documentBinding = observedBinding;
        } else {
            const isPreviousOwner = sameRuntimeTaskRunWriterIdentity(
                activeClaim,
                previousWriterIdentity
            );
            const isAlreadyTransferred = sameRuntimeTaskRunWriterIdentity(
                activeClaim,
                nextWriterIdentity
            );
            if ((!isPreviousOwner && !isAlreadyTransferred)
                || !sameHistoryStateRef(activeClaim.expectedRevision, projectedWriter.expectedRevision)) {
                throw new Error('runtime_session_generation_writer_owner_mismatch');
            }
            const writer: RuntimeTaskRunWriterClaim = isAlreadyTransferred
                ? cloneRuntimeTaskRunWriterClaim(activeClaim)
                : {
                    ...activeClaim,
                    runId: input.identity.runId,
                    generation: input.identity.generation,
                    expectedRevision: { ...activeClaim.expectedRevision }
                };
            taskRun.documentBinding = {
                ...previousBinding,
                writer
            };
            activeDocumentWriterClaims.set(writer.documentId, writer);
        }
    }
    taskRun.status = structuralStatus || 'active';
    return {
        ...input.previous,
        identity: input.identity,
        stageState: resetReflexionTargetAndDownstream({
            state: copiedStageState,
            plan: input.plan
        }),
        stageTrace: createRuntimeStageTrace(input.plan),
        accounting: recordRuntimeReflexion(input.previous.accounting, input.identity.issuedAt),
        taskRun,
        generationStartTransitionCount: input.previous.stageState.transitions.length,
        finalized: false,
        issues: [...input.previous.issues]
    };
}

export function createRuntimeSession(input: {
    identity: RuntimeSessionIdentity;
    plan: RuntimeStagePlan;
    /**
     * plan-neutral 运行在声明 Runtime Profile 前已经真实发生的 observation-only 会计。
     * 只转移同类型 ledger，不授予 Stage、Capability、权限或预算；调用方转移后必须释放旧 owner。
     */
    accountingSeed?: RuntimeAccountingLedger;
}): RuntimeSession {
    const validation = validateRuntimeSessionIdentity(input.identity);
    if (!validation.ok) throw new Error(validation.issues.join(','));
    if (input.identity.generation !== 1 || input.identity.parentRunId) {
        throw new Error('runtime_session_generation_requires_advance');
    }
    if (input.identity.skillId && input.identity.skillId !== input.plan.skillId) {
        throw new Error('runtime_session_skill_plan_mismatch');
    }
    if (input.identity.taskType && input.identity.taskType !== input.plan.taskType) {
        throw new Error('runtime_session_task_plan_mismatch');
    }
    let stageState = createRuntimeStageState(input.plan);
    if (hasStage(input.plan, 'R0')) {
        stageState = applyRuntimeStageEvaluation({
            plan: input.plan,
            state: stageState,
            event: {
                stage: 'R0',
                outcome: 'passed',
                observedOutcomes: ['skill_manifest_selected', 'stage_plan_created'],
                reason: 'Runtime Session 已绑定结构化 Skill manifest 与 stage plan。'
            }
        });
    }
    return {
        version: RUNTIME_SESSION_VERSION,
        identity: input.identity,
        planVersion: input.plan.version,
        skillId: input.plan.skillId,
        taskType: input.plan.taskType,
        stageState,
        stageTrace: createRuntimeStageTrace(input.plan),
        accounting: input.accountingSeed
            ? cloneRuntimeAccountingLedger(input.accountingSeed)
            : createRuntimeAccountingLedger(input.identity.issuedAt),
        taskRun: createRuntimeTaskRunState(input.identity),
        generationStartTransitionCount: 0,
        finalized: false,
        issues: [],
        boundaries: {
            singleStageOwner: true,
            stageOutcomeDriven: true,
            executesTools: false,
            grantsPermission: false,
            changesTaskResult: false,
            categoryNeutral: true
        }
    };
}

export function appendRuntimeSessionObservation(input: {
    session: RuntimeSession;
    plan: RuntimeStagePlan;
    event: RuntimeStageTraceEventInput;
}): RuntimeSession {
    if (input.session.finalized) {
        return {
            ...input.session,
            issues: uniqueIssues([...input.session.issues, 'runtime_session_event_after_finalize'])
        };
    }
    const stageTrace = appendRuntimeStageTraceEvent({
        plan: input.plan,
        trace: input.session.stageTrace,
        event: input.event
    });
    return {
        ...input.session,
        stageTrace
    };
}

export function recordRuntimeSessionModelCall(input: {
    session: RuntimeSession;
    durationMs: number;
    succeeded: boolean;
    usage?: Parameters<typeof recordRuntimeModelCall>[0]['usage'];
    failureKind?: Parameters<typeof recordRuntimeModelCall>[0]['failureKind'];
    providerCode?: string;
    status?: number;
    promptShape?: Parameters<typeof recordRuntimeModelCall>[0]['promptShape'];
    now?: string;
}): RuntimeSession {
    return {
        ...input.session,
        accounting: recordRuntimeModelCall({
            ledger: input.session.accounting,
            stage: input.session.stageState.currentStage,
            durationMs: input.durationMs,
            succeeded: input.succeeded,
            usage: input.usage,
            failureKind: input.failureKind,
            providerCode: input.providerCode,
            status: input.status,
            promptShape: input.promptShape,
            now: input.now
        })
    };
}

export function recordRuntimeSessionToolCall(input: {
    session: RuntimeSession;
    durationMs: number;
    succeeded: boolean;
    now?: string;
}): RuntimeSession {
    return {
        ...input.session,
        accounting: recordRuntimeToolCall({
            ledger: input.session.accounting,
            stage: input.session.stageState.currentStage,
            durationMs: input.durationMs,
            succeeded: input.succeeded,
            now: input.now
        })
    };
}

export function recordRuntimeSessionPerformanceUsage(input: {
    session: RuntimeSession;
    usage: Partial<RuntimePerformanceUsage>;
    now?: string;
}): RuntimeSession {
    return {
        ...input.session,
        accounting: recordRuntimePerformanceUsage({
            ledger: input.session.accounting,
            usage: input.usage,
            now: input.now
        })
    };
}

export function readRuntimeSessionPerformanceUsage(
    session: RuntimeSession
): RuntimePerformanceUsage {
    return readRuntimePerformanceUsage(session.accounting);
}

export function recordRuntimeSessionRecoveryAttempt(input: {
    session: RuntimeSession;
    now?: string;
}): RuntimeSession {
    return {
        ...input.session,
        accounting: recordRuntimeRecoveryAttempt(input.session.accounting, input.now)
    };
}

export function recordRuntimeSessionProviderOutputRecoveryAttempt(input: {
    session: RuntimeSession;
    now?: string;
}): RuntimeSession {
    return {
        ...input.session,
        accounting: recordRuntimeProviderOutputRecoveryAttempt(
            input.session.accounting,
            input.now
        )
    };
}

export function recordRuntimeSessionProviderOutputRecoveryOutcome(input: {
    session: RuntimeSession;
    outcome: 'succeeded' | RuntimeProviderOutputRecoveryFailureReason;
    now?: string;
}): RuntimeSession {
    return {
        ...input.session,
        accounting: recordRuntimeProviderOutputRecoveryOutcome(
            input.session.accounting,
            input.outcome,
            input.now
        )
    };
}

export function applyRuntimeSessionStageEvaluation(input: {
    session: RuntimeSession;
    plan: RuntimeStagePlan;
    event: RuntimeStageEvaluationEvent;
}): RuntimeSession {
    if (input.session.finalized) {
        return {
            ...input.session,
            issues: uniqueIssues([...input.session.issues, 'runtime_session_evaluation_after_finalize'])
        };
    }
    if (input.session.stageState.currentStage !== input.event.stage) {
        return {
            ...input.session,
            issues: uniqueIssues([
                ...input.session.issues,
                `runtime_session_evaluation_stage_mismatch:expected=${input.session.stageState.currentStage || 'none'},observed=${input.event.stage}`
            ])
        };
    }
    return {
        ...input.session,
        stageState: applyRuntimeStageEvaluation({
            plan: input.plan,
            state: input.session.stageState,
            event: input.event
        })
    };
}

/**
 * 在 Action Plan provider 失败且该步骤明确声明 failurePolicy=replan 时，
 * 将生产 Session 从当前执行阶段退回更早的规划阶段。
 *
 * 这里只更新 Session / Stage State；不调度、不重试也不执行任何 Tool。
 */
export function replanRuntimeSessionAfterProviderFailure(input: {
    session: RuntimeSession;
    plan: RuntimeStagePlan;
    failurePolicy: RuntimeActionPlanFailurePolicy;
    targetStage: RuntimeStage;
    failedEvent: RuntimeStageFailureReplanEvent;
}): RuntimeSession {
    if (input.session.finalized) {
        return {
            ...input.session,
            issues: uniqueIssues([
                ...input.session.issues,
                'runtime_session_replan_after_finalize'
            ])
        };
    }
    if (input.failurePolicy !== 'replan') {
        return {
            ...input.session,
            issues: uniqueIssues([
                ...input.session.issues,
                `runtime_session_failure_policy_not_replan:${input.failurePolicy}`
            ])
        };
    }
    return {
        ...input.session,
        stageState: replanRuntimeStageAfterFailure({
            plan: input.plan,
            state: input.session.stageState,
            targetStage: input.targetStage,
            failedEvent: input.failedEvent
        })
    };
}

/**
 * 复合 provider 主动交回同一目标时，把 Session 中性退回 R4。
 * 该转换保留 handoff 事实，但不会把 provider 或 E1 记为失败。
 */
export function replanRuntimeSessionAfterProviderHandoff(input: {
    session: RuntimeSession;
    plan: RuntimeStagePlan;
    replanPolicy: RuntimeActionPlanFailurePolicy;
    targetStage: RuntimeStage;
    handoffEvent: RuntimeStageHandoffReplanEvent;
}): RuntimeSession {
    if (input.session.finalized) {
        return {
            ...input.session,
            issues: uniqueIssues([
                ...input.session.issues,
                'runtime_session_handoff_after_finalize'
            ])
        };
    }
    if (input.replanPolicy !== 'replan') {
        return {
            ...input.session,
            issues: uniqueIssues([
                ...input.session.issues,
                `runtime_session_handoff_policy_not_replan:${input.replanPolicy}`
            ])
        };
    }
    return {
        ...input.session,
        stageState: replanRuntimeStageAfterHandoff({
            plan: input.plan,
            state: input.session.stageState,
            targetStage: input.targetStage,
            handoffEvent: input.handoffEvent
        })
    };
}

export function finalizeRuntimeSession(input: {
    session: RuntimeSession;
    plan: RuntimeStagePlan;
    executionSummary: RuntimeSessionExecutionSummaryInput;
    reflexionHandoff?: ReflexionHandoff;
}): RuntimeSession {
    if (input.session.finalized) return input.session;
    let session = input.session;
    if (input.executionSummary.status === 'cancelled') {
        const target = session.stageState.currentStage || input.plan.steps[0]?.stage;
        if (target) {
            session = applyRuntimeSessionStageEvaluation({
                session,
                plan: input.plan,
                event: {
                    stage: target,
                    outcome: 'cancelled',
                    observedOutcomes: [],
                    reason: '运行被取消；未观察阶段不补造完成。'
                }
            });
        }
        releaseRuntimeTaskRunWriterBinding({
            taskRunId: session.taskRun.taskRunId,
            runId: session.identity.runId,
            generation: session.identity.generation
        });
        return {
            ...withRuntimeTaskRunStatus(session, 'cancelled'),
            finalized: true
        };
    }
    if (input.executionSummary.status === 'awaiting_confirmation') {
        if (!session.taskRun.pendingInteraction) {
            session = suspendRuntimeSessionForInteraction({
                session,
                interactionId: `interaction:${session.identity.runId}:${session.stageState.transitions.length + 1}`,
                expectedRevision: session.taskRun.documentBinding?.expectedRevision
            }).session;
        }
        const target = session.stageState.currentStage || input.plan.steps[0]?.stage;
        if (target && session.stageState.status !== 'awaiting_confirmation') {
            session = applyRuntimeSessionStageEvaluation({
                session,
                plan: input.plan,
                event: {
                    stage: target,
                    outcome: 'awaiting_confirmation',
                    observedOutcomes: [],
                    reason: '任务停在当前阶段的用户确认点；普通交互卡片不能推进到 E2。'
                }
            });
        }
        // waiting_user 是同一 TaskRun 的非终态挂起；不能 finalization、Release 或新建 generation。
        return {
            ...withRuntimeTaskRunStatus(session, 'waiting_user'),
            finalized: false
        };
    }
    const structuralTaskRunStatus = resolveRuntimeTaskRunStructuralStatus(session);
    if (structuralTaskRunStatus) {
        // 非终态结构性状态有自己的恢复 owner：等待卡片、等待现有 writer 释放，或重新观察。
        // 通用完成/失败收尾不得覆盖状态、释放 claim 或伪造新的可重试 generation。
        return {
            ...withRuntimeTaskRunStatus(session, structuralTaskRunStatus),
            finalized: false
        };
    }
    if (session.taskRun.sideEffectState?.status === 'unknown') {
        // 无文档可绑定时不能伪造 needs_reobserve，但未知副作用仍是非终态。
        // 这里保留同一 TaskRun 与 writer，等待专用 reconciliation；普通收尾不得发布、
        // 释放或把它改写为 completed/failed 后允许重放。
        return {
            ...session,
            finalized: false
        };
    }
    const reentryHandoff = input.reflexionHandoff?.status === 'reflexion_required'
        ? input.reflexionHandoff
        : undefined;
    // Runtime 预算边界不是质量失败。保留当前阶段和既有结果，只把下一 generation
    // 的承接位置登记为当前未闭合阶段；不得先伪造一次 R5/E2 评价。
    if (reentryHandoff?.sourceOwner === 'Runtime') {
        session = {
            ...session,
            stageState: requestRuntimeStageReentry({
                plan: input.plan,
                state: session.stageState,
                targetStage: reentryHandoff.targetStage as RuntimeStage,
                reason: firstMessage(reentryHandoff.failureAnalysis)
                    || '本 generation 的有界运行预算已到，当前阶段仍需承接。'
            })
        };
        return {
            ...withRuntimeTaskRunStatus(session, 'active'),
            finalized: true
        };
    }
    if (hasStage(input.plan, 'R5') && session.stageState.currentStage === 'R5') {
        const verdict = input.executionSummary.designVerdict;
        const reflexionRequired = reentryHandoff?.sourceOwner === 'R5';
        const completedAestheticImprovement = isCompletedAestheticImprovementReflexionHandoff(
            reentryHandoff
        );
        let outcome: RuntimeStageEvaluationOutcome;
        if (completedAestheticImprovement) {
            outcome = 'needs_review';
        } else if (reflexionRequired) {
            outcome = 'failed';
        } else {
            outcome = verdict ? verdictOutcome(verdict) : 'missing_required_outcomes';
        }
        const reason = (reflexionRequired
            ? firstMessage(input.reflexionHandoff?.failureAnalysis)
            : '')
            || verdict?.summary
            || firstMessage(input.executionSummary.blockers)
            || firstMessage(input.executionSummary.warnings)
            || `执行状态 ${input.executionSummary.status} 没有机读 DesignVerdict。`;
        const reflexionHandoff = input.reflexionHandoff;
        const event: RuntimeStageEvaluationEvent = {
            stage: 'R5',
            outcome,
            observedOutcomes: verdict
                ? ['quality_gate_report', 'stage_evaluation']
                : ['stage_evaluation'],
            reason,
            ...(verdict ? { verdict } : {}),
            ...(reflexionHandoff ? { reflexionHandoff } : {})
        };
        session = applyRuntimeSessionStageEvaluation({
            session,
            plan: input.plan,
            event
        });
    }
    const r5Passed = session.stageState.stages.find((stage) => stage.stage === 'R5')?.status === 'passed';
    if (r5Passed) {
        for (const event of session.stageTrace.events) {
            if (event.stage !== 'E2') continue;
            session = applyRuntimeSessionStageEvaluation({
                session,
                plan: input.plan,
                event: {
                    stage: event.stage,
                    outcome: event.outcome,
                    observedOutcomes: event.observedOutcomes
                }
            });
        }
    }
    // 质量已通过但交付收据未闭合时，只续跑 E2；保留 R1-R5 的已通过事实，
    // 不把“缺少保存/导出”反向改写成设计质量失败。
    if (reentryHandoff?.sourceOwner === 'E2') {
        session = {
            ...session,
            stageState: requestRuntimeStageReentry({
                plan: input.plan,
                state: session.stageState,
                targetStage: reentryHandoff.targetStage as RuntimeStage,
                reason: firstMessage(reentryHandoff.failureAnalysis)
                    || '交付结果尚未闭合，需要继续保存或导出。'
            })
        };
    }
    if (reentryHandoff) {
        return {
            ...withRuntimeTaskRunStatus(session, 'active'),
            finalized: true
        };
    }
    let taskRunStatus: RuntimeTaskRunStatus = 'needs_review';
    if (session.stageState.status === 'completed') taskRunStatus = 'completed';
    if (input.executionSummary.status === 'failed') taskRunStatus = 'failed';
    releaseRuntimeTaskRunWriterBinding({
        taskRunId: session.taskRun.taskRunId,
        runId: session.identity.runId,
        generation: session.identity.generation
    });
    return {
        ...withRuntimeTaskRunStatus(session, taskRunStatus),
        finalized: true
    };
}

/**
 * 把 Runtime Session 的唯一阶段事实投影到 Agent 最终状态。
 *
 * 本函数不推进阶段、不执行 Tool，也不重新评价质量；它只处理一种冲突：旧执行摘要
 * 已准备声明 completed，但同一生产 Session 尚未形成完整 R5 复核和 E2 交付结果。用户文案在
 * 这里一次生成，避免 Agent 核心和 UI 分别解释内部阶段枚举。
 */
export function projectRuntimeSessionCompletion(input: {
    executionStatus: RuntimeSessionExecutionSummaryInput['status'];
    stageState: RuntimeStageState;
    sideEffectState?: RuntimeTaskRunSideEffectState['status'];
    reflexionHandoff?: ReflexionHandoff;
}): RuntimeSessionCompletionProjection {
    const boundaries = {
        projectsExistingRuntimeState: true as const,
        doesNotAdvanceStage: true as const,
        doesNotExecuteTools: true as const,
        categoryNeutral: true as const
    };
    if (input.sideEffectState === 'unknown') {
        return {
            version: 'runtime-session-completion-projection/v0',
            status: 'needs_review',
            changed: input.executionStatus !== 'needs_review',
            reasonCode: 'runtime_outcomes_incomplete',
            summaryText: '这次操作的最终状态还没确认。',
            blocker: '上一次操作是否已生效无法证明；为避免重复修改，我没有继续叠加操作或宣称交付完成。',
            boundaries
        };
    }
    const completedAestheticImprovement = input.executionStatus === 'completed'
        && isCompletedAestheticImprovementReflexionHandoff(input.reflexionHandoff);
    if (completedAestheticImprovement
        || input.executionStatus !== 'completed'
        || input.stageState.status === 'completed') {
        return {
            version: 'runtime-session-completion-projection/v0',
            status: input.executionStatus,
            changed: false,
            boundaries
        };
    }

    const r5Status = input.stageState.stages.find((stage) => stage.stage === 'R5')?.status;
    const e2Status = input.stageState.stages.find((stage) => stage.stage === 'E2')?.status;
    if (r5Status !== 'passed') {
        const qualityWasEvaluated = Boolean(r5Status && r5Status !== 'unobserved');
        return {
            version: 'runtime-session-completion-projection/v0',
            status: 'needs_review',
            changed: true,
            reasonCode: qualityWasEvaluated ? 'quality_review_incomplete' : 'runtime_outcomes_incomplete',
            summaryText: '这稿先做到这里。',
            blocker: qualityWasEvaluated
                ? '这版我自己看着还没到位，想再调一下再给你。'
                : '这稿还没真正做完，你可以让我接着做。',
            boundaries
        };
    }

    return {
        version: 'runtime-session-completion-projection/v0',
        status: 'needs_review',
        changed: true,
        reasonCode: 'delivery_result_incomplete',
        summaryText: '这稿先做到这里。',
        blocker: e2Status === 'passed'
            ? '内容做好了，但还没最终确认交付，你先看看。'
            : '这版看着可以了，但还没导出/存好，稍等我收尾。',
        boundaries
    };
}

export function buildRuntimeSessionDigest(input: {
    session: RuntimeSession;
    plan: RuntimeStagePlan;
}): RuntimeSessionDigest {
    const traceDigest = buildRuntimeStageTraceDigest({
        plan: input.plan,
        trace: input.session.stageTrace,
        state: input.session.stageState,
        transitionSequenceFloor: input.session.generationStartTransitionCount
    });
    return {
        version: RUNTIME_SESSION_DIGEST_VERSION,
        sessionId: input.session.identity.sessionId,
        runId: input.session.identity.runId,
        generation: input.session.identity.generation,
        ...(input.session.identity.parentRunId ? { parentRunId: input.session.identity.parentRunId } : {}),
        issuedAt: input.session.identity.issuedAt,
        planVersion: input.session.planVersion,
        skillId: input.session.skillId,
        taskType: input.session.taskType,
        status: input.session.stageState.status,
        ...(input.session.stageState.currentStage ? { currentStage: input.session.stageState.currentStage } : {}),
        transitionCount: input.session.stageState.transitions.length,
        traceStatus: traceDigest.status,
        traceEventCount: traceDigest.eventCount,
        accounting: buildRuntimeAccountingDigest({ ledger: input.session.accounting }),
        taskRun: {
            taskRunId: input.session.taskRun.taskRunId,
            status: input.session.taskRun.status,
            planRevision: input.session.taskRun.planRevision,
            nodeCount: input.session.taskRun.nodes.length,
            ...(input.session.taskRun.currentNodeId
                ? { currentNodeId: input.session.taskRun.currentNodeId }
                : {}),
            ...(input.session.taskRun.pendingInteraction
                ? { pendingInteractionId: input.session.taskRun.pendingInteraction.interactionId }
                : {}),
            ...(input.session.taskRun.documentBinding
                ? {
                    documentId: input.session.taskRun.documentBinding.documentId,
                    expectedHistoryStateId:
                        input.session.taskRun.documentBinding.expectedRevision.historyStateId,
                    ...(input.session.taskRun.documentBinding.writer
                        ? {
                            writerTaskRunId:
                                input.session.taskRun.documentBinding.writer.taskRunId
                        }
                        : {})
                }
                : {}),
            ...(input.session.taskRun.sideEffectState
                ? { sideEffectState: input.session.taskRun.sideEffectState.status }
                : {}),
            operationResultCount: input.session.taskRun.operationResults.length
        },
        finalized: input.session.finalized,
        issueCount: input.session.issues.length
            + input.session.stageState.issues.length
            + input.session.stageTrace.issues.length,
        boundaries: {
            digestOnly: true,
            oneSessionIdentity: true,
            executesTools: false,
            grantsPermission: false,
            changesTaskResult: false
        }
    };
}

export function evaluateRuntimeSessionToolExecutionGate(input: {
    session: RuntimeSession;
    toolName: string;
    toolKind: AgentToolExecutionKind;
    /** 当前是否有打开的文档；仅在明确为 false 且任务从零时，允许建画布这一启动动作先于 E1。 */
    hasOpenDocument?: boolean;
    /** 该任务是否必须已有打开文档（edit_existing 等为 true，从零为 false）。 */
    taskRequiresOpenDocument?: boolean;
    /**
     * 紧凑工作流（有唯一 workflow owner、无 R4）的「owner 先行」：owner 还没跑过、也没有它交出的 handoff 续跑时，
     * E1 的直接写入不放行——业务写入归 owner；模型直写只在 owner 交接后的范围内。
     * 真机 2026-08-18：同一批量任务连续三次都跳过 owner 直接往只读来源文档上画。
     */
    workflowOwnerFirst?: { ownerToolName: string; pending: boolean };
}): RuntimeSessionToolExecutionGate {
    const changesExternalState = input.toolKind === 'photoshop_write'
        || input.toolKind === 'save_export'
        || input.toolKind === 'external_generation';
    const observationOnly = input.toolKind === 'read_only_observation'
        || input.toolKind === 'knowledge_search';
    const boundaries = {
        executionPointOnly: true as const,
        executesTools: false as const,
        grantsPermission: false as const,
        categoryNeutral: true as const
    };
    if (input.session.taskRun.sideEffectState?.status === 'unknown' && !observationOnly) {
        return buildStructuralRuntimeToolBlock({
            session: input.session,
            toolName: input.toolName,
            code: 'runtime_task_run_side_effect_unknown',
            boundaries
        });
    }
    if (!changesExternalState) {
        return {
            status: 'not_applicable',
            allowed: true,
            currentStage: input.session.stageState.currentStage,
            boundaries
        };
    }
    if (input.session.taskRun.status === 'waiting_user'
        || input.session.taskRun.pendingInteraction) {
        return buildStructuralRuntimeToolBlock({
            session: input.session,
            toolName: input.toolName,
            code: 'runtime_task_run_waiting_user',
            boundaries
        });
    }
    // Gate 只阻断仍真实存活的竞争 writer。Owner 已释放或当前 claim 已属于同一 TaskRun 时，
    // 回到正常 Stage 检查；随后仍由 claimRuntimeSessionDocumentWriter 原子恢复 owned 状态。
    // 这里不直接清除 session 冲突投影，避免 Gate 成为第二个 writer 状态 reducer。
    if (hasLiveConflictingRuntimeTaskRunWriter(input.session)) {
        return buildStructuralRuntimeToolBlock({
            session: input.session,
            toolName: input.toolName,
            code: 'runtime_task_run_writer_conflict',
            boundaries
        });
    }
    if (input.session.taskRun.status === 'needs_reobserve'
        || input.session.taskRun.documentBinding?.status === 'needs_reobserve') {
        return buildStructuralRuntimeToolBlock({
            session: input.session,
            toolName: input.toolName,
            code: 'runtime_task_run_revision_reobserve_required',
            boundaries
        });
    }
    const currentStage = input.session.stageState.currentStage;
    // 建画布启动动作：从零任务在确无文档时可先于 E1 建出画布（判据与可见性门共用，避免两处漂移）。
    // 其余写入仍严格只在 E1（E2 仅放行保存导出）。
    const allowedInExecutionStage = currentStage === 'E1'
        || (currentStage === 'E2' && input.toolKind === 'save_export')
        || isCanvasBootstrapAction({
            toolName: input.toolName,
            hasOpenDocument: input.hasOpenDocument,
            taskRequiresOpenDocument: input.taskRequiresOpenDocument
        });
    const ownerFirst = input.workflowOwnerFirst;
    const ownerFirstPending = Boolean(ownerFirst?.pending)
        && Boolean(ownerFirst?.ownerToolName)
        && cleanText(input.toolName, 80) !== cleanText(ownerFirst?.ownerToolName, 80);
    if (allowedInExecutionStage && !ownerFirstPending) {
        return {
            status: 'allowed',
            allowed: true,
            currentStage,
            boundaries
        };
    }
    return {
        status: 'blocked',
        allowed: false,
        code: allowedInExecutionStage && ownerFirstPending
            ? 'runtime_workflow_owner_first'
            : 'runtime_session_r4_not_ready',
        currentStage: input.session.stageState.currentStage,
        blockedTool: cleanText(input.toolName, 80),
        ...(allowedInExecutionStage && ownerFirstPending && ownerFirst
            ? { nextRequiredTool: cleanText(ownerFirst.ownerToolName, 80) }
            : {}),
        boundaries
    };
}
