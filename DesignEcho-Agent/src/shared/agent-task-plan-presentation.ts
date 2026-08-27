import type { AgentTaskPlanningContract } from './agent-task-planning-contract';
import type {
    RuntimeActionPlanDeclaration,
    RuntimeActionPlanStepKind
} from './agent-runtime-v5/runtime-action-plan-declaration';
import type {
    RuntimeActionPlanReconciliation,
    RuntimeActionPlanStepReconciliation
} from './agent-runtime-v5/runtime-action-plan-reconciliation';
import type { RuntimeSessionDigest } from './agent-runtime-v5/runtime-session';
import type { RuntimeStageTrace } from './agent-runtime-v5/runtime-stage-trace';
import {
    RUNTIME_TASK_SNAPSHOT_V1_VERSION,
    RUNTIME_TASK_SNAPSHOT_VERSION,
    type ReadableRuntimeTaskSnapshot,
    type RuntimeTaskSnapshotActionStepStatus
} from './agent-runtime-v5/runtime-task-snapshot';

export type AgentTaskPlanPresentationStepStatus =
    | 'pending'
    | 'running'
    | 'completed'
    | 'failed'
    | 'blocked';

export interface AgentTaskPlanPresentationIdentity {
    sessionId: string;
    runId: string;
    generation: number;
    revision: number;
    revisionHash: string;
    conversationId: string;
    projectId: string;
}

export interface AgentTaskPlanPresentationStep {
    id: string;
    kind: RuntimeActionPlanStepKind;
    label: string;
    status: AgentTaskPlanPresentationStepStatus;
}

/** 对话中的任务计划只保留用户可见的目标与步骤状态。 */
export interface AgentTaskPlanPresentation {
    version: 'agent-task-plan-presentation/v0';
    identity: AgentTaskPlanPresentationIdentity;
    goal: string;
    steps: AgentTaskPlanPresentationStep[];
}

export interface BuildAgentTaskPlanPresentationInput {
    runtimeTaskSnapshot?: ReadableRuntimeTaskSnapshot | null;
    taskPlan?: AgentTaskPlanningContract;
    declaration?: RuntimeActionPlanDeclaration;
    reconciliation?: RuntimeActionPlanReconciliation;
    runtimeSessionDigest?: RuntimeSessionDigest;
    runtimeStageTrace?: RuntimeStageTrace;
    conversationId?: string;
    projectId?: string;
}

export type AgentTaskPlanPresentationUpdateDecision =
    | 'accept_initial'
    | 'accept_new_generation'
    | 'accept_new_revision'
    | 'accept_status_update'
    | 'accept_idempotent'
    | 'reject_invalid_next'
    | 'reject_scope_mismatch'
    | 'reject_session_mismatch'
    | 'reject_late_generation'
    | 'reject_run_mismatch'
    | 'reject_late_revision'
    | 'reject_revision_conflict';

function cleanText(value: unknown, maxLength: number): string {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function stableHash(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `r4-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function buildDeclarationRevisionHash(declaration: RuntimeActionPlanDeclaration): string {
    return stableHash(JSON.stringify({
        readiness: declaration.readiness,
        planGoal: declaration.payload.planGoal,
        steps: declaration.payload.steps.map((step) => ({
            stepId: step.stepId,
            kind: step.kind,
            goal: step.goal,
            dependsOn: step.dependsOn
        }))
    }));
}

function resolveDeclarationRevision(trace: RuntimeStageTrace | undefined): number {
    const sequences = (trace?.events || [])
        .filter((event) => event.stage === 'R4' && event.source === 'action_plan_declaration')
        .map((event) => event.sequence)
        .filter((sequence) => Number.isInteger(sequence) && sequence > 0);
    return sequences.length > 0 ? Math.max(...sequences) : 1;
}

function buildReconciliationByStepId(
    reconciliation: RuntimeActionPlanReconciliation | undefined
): Map<string, RuntimeActionPlanStepReconciliation> {
    if (!reconciliation || reconciliation.version !== 'runtime-action-plan-reconciliation/v0') {
        return new Map();
    }
    const byStepId = new Map<string, RuntimeActionPlanStepReconciliation>();
    const duplicateStepIds = new Set<string>();
    for (const step of reconciliation.steps) {
        if (byStepId.has(step.stepId)) {
            duplicateStepIds.add(step.stepId);
            continue;
        }
        byStepId.set(step.stepId, step);
    }
    for (const stepId of duplicateStepIds) {
        byStepId.delete(stepId);
    }
    return byStepId;
}

/**
 * 将 Runtime 对账结果压缩为用户可见的通用步骤状态。
 */
function projectRuntimeStepStatus(
    declarationKind: RuntimeActionPlanStepKind,
    reconciliation: RuntimeActionPlanStepReconciliation | undefined
): AgentTaskPlanPresentationStepStatus {
    if (!reconciliation || reconciliation.kind !== declarationKind) return 'pending';
    switch (reconciliation.status) {
        case 'completed':
            return 'completed';
        case 'in_progress':
            return 'running';
        case 'failed':
            return 'failed';
        case 'blocked_by_dependency':
            return 'blocked';
        case 'ready':
        default:
            return 'pending';
    }
}

function projectSnapshotStepStatus(
    status: RuntimeTaskSnapshotActionStepStatus
): AgentTaskPlanPresentationStepStatus {
    switch (status) {
        case 'completed':
            return 'completed';
        case 'in_progress':
            return 'running';
        case 'failed':
            return 'failed';
        case 'blocked_by_dependency':
            return 'blocked';
        case 'not_observed':
        case 'ready':
        default:
            return 'pending';
    }
}

/**
 * 行动计划里的 step.goal 是模型写给 Runtime 的结构化声明，可能包含 Tool、阶段或
 * 完成条件。用户只需要知道正在进行哪类设计动作，不应看到这份内部声明原文。
 */
function projectActionStepLabel(kind: RuntimeActionPlanStepKind): string {
    switch (kind) {
        case 'observe':
            return '查看当前内容与画面';
        case 'research':
            return '整理相关素材与参考';
        case 'compose_dsl':
            return '确定版式与内容结构';
        case 'preview':
            return '预览设计方向';
        case 'mutate':
            return '制作和调整画面';
        case 'verify':
            return '查看效果并修正细节';
        case 'deliver':
            return '保存并整理交付内容';
        case 'request_input':
            return '确认会影响设计方向的选择';
        default:
            return '继续完成当前设计';
    }
}

function buildPresentationFromRuntimeTaskSnapshot(
    input: BuildAgentTaskPlanPresentationInput
): AgentTaskPlanPresentation | undefined {
    const snapshot = input.runtimeTaskSnapshot;
    const actionPlan = snapshot?.actionPlan;
    const conversationId = cleanText(input.conversationId, 160);
    const projectId = cleanText(input.projectId, 240);
    if (!snapshot
        || (
            snapshot.version !== RUNTIME_TASK_SNAPSHOT_VERSION
            && snapshot.version !== RUNTIME_TASK_SNAPSHOT_V1_VERSION
        )
        || !actionPlan
        || actionPlan.steps.length === 0
        || !conversationId
        || !projectId) {
        return undefined;
    }
    const steps = actionPlan.steps.map((step) => ({
        id: step.stepId,
        kind: step.kind,
        label: projectActionStepLabel(step.kind),
        status: projectSnapshotStepStatus(step.status)
    }));
    // RuntimeTaskSnapshot outcome 是同一 Runtime 的 canonical 结果。任务已经 completed 时，
    // 旧 reconciliation 留下的 pending / failed step 只是未同步工作笔记；不把它们假打勾，
    // 也不生成一张与最终结果冲突的“设计进度”卡。
    if (snapshot.outcome?.status === 'completed'
        && steps.some((step) => step.status !== 'completed')) {
        return undefined;
    }
    return {
        version: 'agent-task-plan-presentation/v0',
        identity: {
            sessionId: snapshot.identity.sessionId,
            runId: snapshot.identity.runId,
            generation: snapshot.identity.generation,
            revision: actionPlan.presentationRevision,
            revisionHash: actionPlan.presentationRevisionHash,
            conversationId,
            projectId
        },
        goal: snapshot.goal.source === 'request_task_plan'
            ? (cleanText(snapshot.goal.text, 360) || '完成当前设计')
            : '完成当前设计',
        steps
    };
}

function hasValidIdentity(presentation: AgentTaskPlanPresentation | undefined): boolean {
    if (!presentation || presentation.version !== 'agent-task-plan-presentation/v0') return false;
    const identity = presentation.identity;
    return Boolean(
        cleanText(identity.sessionId, 160)
        && cleanText(identity.runId, 160)
        && Number.isInteger(identity.generation)
        && identity.generation > 0
        && Number.isInteger(identity.revision)
        && identity.revision > 0
        && cleanText(identity.revisionHash, 80)
        && cleanText(identity.conversationId, 160)
        && cleanText(identity.projectId, 240)
    );
}

export function buildAgentTaskPlanPresentation(
    input: BuildAgentTaskPlanPresentationInput
): AgentTaskPlanPresentation | undefined {
    if (Object.prototype.hasOwnProperty.call(input, 'runtimeTaskSnapshot')) {
        return buildPresentationFromRuntimeTaskSnapshot(input);
    }
    const taskPlan = input.taskPlan;
    const declaration = input.declaration;
    const runtimeSessionDigest = input.runtimeSessionDigest;
    const conversationId = cleanText(input.conversationId, 160);
    const projectId = cleanText(input.projectId, 240);
    if (!taskPlan || !declaration || !runtimeSessionDigest || !conversationId || !projectId) {
        return undefined;
    }
    if (declaration.version !== 'runtime-action-plan-declaration/v0') return undefined;
    if (runtimeSessionDigest.version !== 'runtime-session-digest/v0') return undefined;
    if (declaration.payload.steps.length === 0) return undefined;

    const reconciliationByStepId = buildReconciliationByStepId(input.reconciliation);
    const steps = declaration.payload.steps.map((step) => ({
        id: step.stepId,
        kind: step.kind,
        label: projectActionStepLabel(step.kind),
        status: projectRuntimeStepStatus(step.kind, reconciliationByStepId.get(step.stepId))
    }));

    return {
        version: 'agent-task-plan-presentation/v0',
        identity: {
            sessionId: runtimeSessionDigest.sessionId,
            runId: runtimeSessionDigest.runId,
            generation: runtimeSessionDigest.generation,
            revision: resolveDeclarationRevision(input.runtimeStageTrace),
            revisionHash: buildDeclarationRevisionHash(declaration),
            conversationId,
            projectId
        },
        goal: cleanText(taskPlan.designBrief.goal, 360)
            || '完成当前设计',
        steps
    };
}

function hasSameStepStatuses(
    current: AgentTaskPlanPresentation,
    next: AgentTaskPlanPresentation
): boolean {
    if (current.steps.length !== next.steps.length) return false;
    return current.steps.every((step, index) => {
        const nextStep = next.steps[index];
        return Boolean(nextStep && step.id === nextStep.id && step.status === nextStep.status);
    });
}

export function decideAgentTaskPlanPresentationUpdate(input: {
    current?: AgentTaskPlanPresentation;
    next?: AgentTaskPlanPresentation;
}): AgentTaskPlanPresentationUpdateDecision {
    if (!hasValidIdentity(input.next)) return 'reject_invalid_next';
    if (!input.current) return 'accept_initial';
    if (!hasValidIdentity(input.current)) return 'accept_initial';

    const current = input.current.identity;
    const next = input.next!.identity;
    if (current.conversationId !== next.conversationId || current.projectId !== next.projectId) {
        return 'reject_scope_mismatch';
    }
    if (current.sessionId !== next.sessionId) return 'reject_session_mismatch';
    if (next.generation < current.generation) return 'reject_late_generation';
    if (next.generation > current.generation) return 'accept_new_generation';
    if (current.runId !== next.runId) return 'reject_run_mismatch';
    if (next.revision < current.revision) return 'reject_late_revision';
    if (next.revision > current.revision) return 'accept_new_revision';
    if (next.revisionHash !== current.revisionHash) return 'reject_revision_conflict';
    if (!hasSameStepStatuses(input.current, input.next!)) return 'accept_status_update';
    return 'accept_idempotent';
}

export function shouldAcceptAgentTaskPlanPresentationUpdate(input: {
    current?: AgentTaskPlanPresentation;
    next?: AgentTaskPlanPresentation;
}): boolean {
    return decideAgentTaskPlanPresentationUpdate(input).startsWith('accept_');
}

// ── 阶段计划降级投影 ──
// 正式来源是 R4 行动计划声明（buildPresentationFromRuntimeTaskSnapshot 的 actionPlan）。
// 实测 105 次真实运行里 R4 声明 0 次、计划面板仅 3 次出现——用户因此几乎永远看不到
// 「Agent 打算做什么」，只能看到「已经做了什么」，无法在跑偏时提前叫停。
// 本降级用 Manifest 复制来的 runtimeStagePlan：任务类型一确定它就存在，不依赖模型声明成功。
// 它只补「计划可见性」，不参与任何执行判定，也不覆盖已有的 R4 投影。

/** 运行时阶段的固定推进顺序，用于把当前阶段换算成逐条完成状态。 */
const RUNTIME_STAGE_SEQUENCE: readonly string[] = ['R0', 'R1', 'R2', 'R3', 'R4', 'E1', 'R5', 'E2'];

/**
 * Runtime 阶段只属于后台；用户看到的是稳定的设计进度，不是 R0/E1 或 Manifest objective。
 * 这里只做展示投影，不反向要求 Agent 必须机械经过每个设计阶段。
 */
const USER_DESIGN_PHASES: ReadonlyArray<{
    id: string;
    stages: readonly string[];
    kind: RuntimeActionPlanStepKind;
    label: string;
}> = Object.freeze([
    { id: 'understand', stages: ['R0', 'R1'], kind: 'observe', label: '理解需求与约束' },
    { id: 'observe', stages: ['R2'], kind: 'research', label: '查看项目、素材和当前画面' },
    { id: 'direction', stages: ['R3', 'R4'], kind: 'compose_dsl', label: '确定设计方向与版式' },
    { id: 'make', stages: ['E1'], kind: 'mutate', label: '制作可编辑设计' },
    { id: 'review', stages: ['R5'], kind: 'verify', label: '查看效果并调整细节' },
    { id: 'deliver', stages: ['E2'], kind: 'deliver', label: '保存与交付' }
]);

export interface StagePlanFallbackPresentationInput {
    stagePlan?: {
        displayName?: string;
        steps?: Array<{ stage?: string; objective?: string }>;
    } | null;
    /** 当前所处阶段；缺失时全部按未开始呈现。 */
    currentStage?: string | null;
    identity: {
        sessionId?: string;
        runId?: string;
        generation?: number;
    };
    /** 用户目标原文，用于面板标题。 */
    goal?: string;
    conversationId?: string;
    projectId?: string;
}

/**
 * 把阶段计划投影成用户可见的待办清单：当前阶段之前为已完成、当前阶段进行中、其余待办。
 * 任一必需身份字段缺失即返回 undefined——宁可不显示，也不显示一个无法对应到具体运行的计划。
 */
export function buildAgentTaskPlanPresentationFromStagePlan(
    input: StagePlanFallbackPresentationInput
): AgentTaskPlanPresentation | undefined {
    const rawSteps = Array.isArray(input.stagePlan?.steps) ? input.stagePlan!.steps! : [];
    const conversationId = cleanText(input.conversationId, 160);
    const projectId = cleanText(input.projectId, 240);
    const sessionId = cleanText(input.identity?.sessionId, 160);
    const runId = cleanText(input.identity?.runId, 160);
    if (!rawSteps.length || !conversationId || !projectId || !sessionId || !runId) {
        return undefined;
    }
    if (!Number.isInteger(input.identity?.generation)) return undefined;

    const currentStage = cleanText(input.currentStage, 8);
    const currentIndex = currentStage ? RUNTIME_STAGE_SEQUENCE.indexOf(currentStage) : -1;

    const availableStages = new Set(rawSteps
        .map((step) => cleanText(step?.stage, 8))
        .filter(Boolean));
    const steps: AgentTaskPlanPresentationStep[] = USER_DESIGN_PHASES.flatMap((phase) => {
        const includedStages = phase.stages.filter((stage) => availableStages.has(stage));
        if (includedStages.length === 0) return [];
        const phaseIndexes = includedStages
            .map((stage) => RUNTIME_STAGE_SEQUENCE.indexOf(stage))
            .filter((index) => index >= 0);
        let status: AgentTaskPlanPresentationStepStatus = 'pending';
        if (currentIndex >= 0 && phaseIndexes.length > 0) {
            if (phaseIndexes.every((index) => index < currentIndex)) status = 'completed';
            else if (phaseIndexes.some((index) => index === currentIndex)) status = 'running';
        }
        return [{
            id: `design-phase-${phase.id}`,
            kind: phase.kind,
            label: phase.label,
            status
        }];
    });
    if (!steps.length) return undefined;

    return {
        version: 'agent-task-plan-presentation/v0',
        identity: {
            sessionId,
            runId,
            generation: input.identity.generation as number,
            // 降级投影没有声明修订号；用已完成步数当版本，保证推进时能被 UI 识别为新版本。
            revision: steps.filter((step) => step.status === 'completed').length,
            revisionHash: `stage-plan:${currentStage || 'none'}:${steps.length}`,
            conversationId,
            projectId
        },
        goal: cleanText(input.goal, 360)
            || cleanText(input.stagePlan?.displayName, 360)
            || '完成当前任务',
        steps
    };
}
