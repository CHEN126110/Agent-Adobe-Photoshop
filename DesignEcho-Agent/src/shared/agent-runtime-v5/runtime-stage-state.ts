/**
 * Runtime Stage State（evaluation-only）。
 *
 * Stage plan 只声明阶段、预期结果和失败去向；本 reducer 只根据结构化 Evaluation
 * 事件记录状态转换，不调度 Tool、不读取用户文本、不改变任务成败。它是未来
 * 动态 Workflow / DAG 的状态基座，不是 DAG executor。
 */

import type { DesignVerdict } from '../design-quality-verdict-bundle';
import type { RuntimeStage } from './contracts';
import {
    isCompletedAestheticImprovementReflexionHandoff,
    type ReflexionHandoff
} from './reflexion-contract';
import type { RuntimeStagePlan } from './runtime-stage-plan';

export type RuntimeStageObservedStatus =
    | 'unobserved'
    | 'passed'
    | 'needs_review'
    | 'failed'
    | 'awaiting_confirmation'
    | 'cancelled';

export type RuntimeStageStateStatus =
    | 'active'
    | 'awaiting_outcomes'
    | 'awaiting_confirmation'
    | 'reflexion_required'
    | 'completed'
    | 'cancelled';

export type RuntimeStageEvaluationOutcome =
    | 'passed'
    | 'needs_review'
    | 'missing_required_outcomes'
    | 'failed'
    | 'awaiting_confirmation'
    | 'confirmation_received'
    | 'cancelled';

export type RuntimeStageTransitionDecision =
    | 'advance'
    | 'complete'
    | 'continue_react'
    | 'await_outcome_or_review'
    | 'enter_reflexion'
    | 'await_user_confirmation'
    | 'resume_after_user_confirmation'
    | 'stop_cancelled';

export interface RuntimeStageEvaluationEvent {
    stage: RuntimeStage;
    outcome: RuntimeStageEvaluationOutcome;
    observedOutcomes: string[];
    reason?: string;
    verdict?: DesignVerdict;
    reflexionHandoff?: ReflexionHandoff;
}

export interface RuntimeStageSnapshot {
    stage: RuntimeStage;
    status: RuntimeStageObservedStatus;
    attempts: number;
    requiredOutcomes: string[];
    observedOutcomes: string[];
    missingOutcomes: string[];
    lastEvaluation?: {
        outcome: RuntimeStageEvaluationOutcome;
        reason?: string;
        verdict?: {
            version: 'design-quality-verdict/v0';
            status: DesignVerdict['status'];
            source: DesignVerdict['source'];
            overallScore?: number;
        };
    };
}

export interface RuntimeStageTransitionRecord {
    sequence: number;
    evaluatedStage: RuntimeStage;
    decision: RuntimeStageTransitionDecision;
    targetStage?: RuntimeStage;
    outcome: RuntimeStageEvaluationOutcome;
    observedOutcomes: string[];
    missingOutcomes: string[];
    reason?: string;
}

export interface RuntimeStageState {
    version: 'runtime-stage-state/v0';
    planVersion: RuntimeStagePlan['version'];
    skillId: string;
    taskType: string;
    status: RuntimeStageStateStatus;
    currentStage?: RuntimeStage;
    stages: RuntimeStageSnapshot[];
    transitions: RuntimeStageTransitionRecord[];
    issues: string[];
    boundaries: {
        evaluationOnly: true;
        executesTools: false;
        changesTaskResult: false;
        categoryNeutral: true;
    };
}

export interface BuildRuntimeStageStateFromEvaluationInput {
    plan: RuntimeStagePlan;
    /** 真实运行点产生的结构化阶段事件；不允许由任务文本或 assistant content 推断。 */
    observedEvents?: RuntimeStageEvaluationEvent[];
    executionSummary: {
        status: 'completed' | 'needs_review' | 'failed' | 'cancelled' | 'awaiting_confirmation';
        stopReason?: string;
        blockers?: string[];
        warnings?: string[];
        designVerdict?: DesignVerdict;
    };
    reflexionHandoff?: ReflexionHandoff;
}

export interface RuntimeStageFailureReplanEvent {
    stage: RuntimeStage;
    outcome: 'failed';
    observedOutcomes: string[];
    reason?: string;
}

export interface RuntimeStageHandoffReplanEvent {
    stage: RuntimeStage;
    outcome: 'needs_review';
    observedOutcomes: string[];
    reason?: string;
}

type RuntimeStageVerdictSnapshot = NonNullable<
    NonNullable<RuntimeStageSnapshot['lastEvaluation']>['verdict']
>;

function cleanText(value: unknown, limit = 240): string {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function unique(values: readonly unknown[]): string[] {
    return Array.from(new Set(values.map((value) => cleanText(value, 120)).filter(Boolean)));
}

function findStageIndex(plan: RuntimeStagePlan, stage: RuntimeStage): number {
    return plan.steps.findIndex((step) => step.stage === stage);
}

function buildVerdictSnapshot(verdict: DesignVerdict | undefined): RuntimeStageVerdictSnapshot | undefined {
    if (!verdict) return undefined;
    return {
        version: verdict.version,
        status: verdict.status,
        source: verdict.source,
        ...(typeof verdict.overallScore === 'number' ? { overallScore: verdict.overallScore } : {})
    };
}

function appendIssue(issues: string[], issue: string): string[] {
    return unique([...issues, issue]).slice(0, 30);
}

export function createRuntimeStageState(plan: RuntimeStagePlan): RuntimeStageState {
    return {
        version: 'runtime-stage-state/v0',
        planVersion: plan.version,
        skillId: plan.skillId,
        taskType: plan.taskType,
        status: 'active',
        currentStage: plan.steps[0]?.stage,
        stages: plan.steps.map((step) => ({
            stage: step.stage,
            status: 'unobserved',
            attempts: 0,
            requiredOutcomes: unique(step.requiredOutcomes),
            observedOutcomes: [],
            missingOutcomes: unique(step.requiredOutcomes)
        })),
        transitions: [],
        issues: [],
        boundaries: {
            evaluationOnly: true,
            executesTools: false,
            changesTaskResult: false,
            categoryNeutral: true
        }
    };
}

/**
 * 把一次已确认失败的执行阶段退回到更早的规划阶段。
 *
 * 本函数只维护 Stage State：调用方仍须在 Action Plan 的 failurePolicy 明确为
 * replan 时才调用。目标必须同时存在于 plan / snapshot 且严格早于当前阶段；
 * 有效恢复会清空目标及下游观察快照，并用 transition 保留失败事实。
 */
export function replanRuntimeStageAfterFailure(input: {
    plan: RuntimeStagePlan;
    state: RuntimeStageState;
    targetStage: RuntimeStage;
    failedEvent: RuntimeStageFailureReplanEvent;
}): RuntimeStageState {
    return replanRuntimeStage({
        plan: input.plan,
        state: input.state,
        targetStage: input.targetStage,
        event: input.failedEvent,
        expectedOutcome: 'failed',
        eventKind: 'failure'
    });
}

/**
 * 复合 provider 明确把同一目标交回原子能力时，以中性 handoff 事实退回规划阶段。
 * handoff 不等于 provider 失败，也不产生执行、进展或完成 credit。
 */
export function replanRuntimeStageAfterHandoff(input: {
    plan: RuntimeStagePlan;
    state: RuntimeStageState;
    targetStage: RuntimeStage;
    handoffEvent: RuntimeStageHandoffReplanEvent;
}): RuntimeStageState {
    return replanRuntimeStage({
        plan: input.plan,
        state: input.state,
        targetStage: input.targetStage,
        event: input.handoffEvent,
        expectedOutcome: 'needs_review',
        eventKind: 'handoff'
    });
}

/**
 * Photoshop 目标 document/revision 已由真实只读结果证明发生变化时，废弃旧版本上的
 * 观察、策略与 Action Plan，回到指定观察/规划 owner。这里只改 Stage State，不接受
 * 旧写入、不调度 Tool；新的 R4 计划绑定后才能重新进入 E1。
 */
export function reobserveRuntimeStageAfterDocumentChange(input: {
    plan: RuntimeStagePlan;
    state: RuntimeStageState;
    targetStage: RuntimeStage;
    reason: string;
}): RuntimeStageState {
    const currentStage = input.state.currentStage;
    if (!currentStage) {
        return {
            ...input.state,
            issues: appendIssue(input.state.issues, 'stage_reobserve_current_stage_missing')
        };
    }
    return replanRuntimeStage({
        plan: input.plan,
        state: input.state,
        targetStage: input.targetStage,
        event: {
            stage: currentStage,
            outcome: 'needs_review',
            observedOutcomes: [],
            reason: input.reason
        },
        expectedOutcome: 'needs_review',
        eventKind: 'document_change'
    });
}

function replanRuntimeStage(input: {
    plan: RuntimeStagePlan;
    state: RuntimeStageState;
    targetStage: RuntimeStage;
    event: RuntimeStageFailureReplanEvent | RuntimeStageHandoffReplanEvent;
    expectedOutcome: 'failed' | 'needs_review';
    eventKind: 'failure' | 'handoff' | 'document_change';
}): RuntimeStageState {
    const state: RuntimeStageState = {
        ...input.state,
        stages: input.state.stages.map((stage) => ({
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
        transitions: input.state.transitions.map((transition) => ({
            ...transition,
            observedOutcomes: [...transition.observedOutcomes],
            missingOutcomes: [...transition.missingOutcomes]
        })),
        issues: [...input.state.issues]
    };
    const currentStage = state.currentStage;
    if (!currentStage) {
        return {
            ...state,
            issues: appendIssue(state.issues, 'stage_replan_current_stage_missing')
        };
    }
    const currentIndex = findStageIndex(input.plan, currentStage);
    if (currentIndex < 0) {
        return {
            ...state,
            issues: appendIssue(state.issues, `stage_replan_current_stage_not_in_plan:${currentStage}`)
        };
    }
    if (input.event.stage !== currentStage) {
        return {
            ...state,
            issues: appendIssue(
                state.issues,
                `stage_replan_${input.eventKind}_stage_mismatch:expected=${currentStage},observed=${input.event.stage}`
            )
        };
    }
    if (input.event.outcome !== input.expectedOutcome) {
        return {
            ...state,
            issues: appendIssue(
                state.issues,
                `stage_replan_event_not_${input.eventKind}:${input.event.outcome}`
            )
        };
    }
    const targetIndex = findStageIndex(input.plan, input.targetStage);
    if (targetIndex < 0) {
        return {
            ...state,
            issues: appendIssue(state.issues, `stage_replan_target_not_in_plan:${input.targetStage}`)
        };
    }
    if (targetIndex >= currentIndex) {
        return {
            ...state,
            issues: appendIssue(
                state.issues,
                `stage_replan_target_not_before_current:current=${currentStage},target=${input.targetStage}`
            )
        };
    }
    const currentSnapshot = state.stages.find((snapshot) => snapshot.stage === currentStage);
    if (!currentSnapshot) {
        return {
            ...state,
            issues: appendIssue(state.issues, `stage_replan_current_snapshot_missing:${currentStage}`)
        };
    }
    if (!state.stages.some((snapshot) => snapshot.stage === input.targetStage)) {
        return {
            ...state,
            issues: appendIssue(state.issues, `stage_replan_target_snapshot_missing:${input.targetStage}`)
        };
    }

    const observedOutcomes = unique([
        ...currentSnapshot.observedOutcomes,
        ...input.event.observedOutcomes
    ]);
    const observedSet = new Set(observedOutcomes);
    const missingOutcomes = currentSnapshot.requiredOutcomes.filter(
        (outcome) => !observedSet.has(outcome)
    );
    const invalidatedStages = new Set(
        input.plan.steps.slice(targetIndex).map((step) => step.stage)
    );
    state.stages = state.stages.map((snapshot) => {
        if (!invalidatedStages.has(snapshot.stage)) return snapshot;
        return {
            ...snapshot,
            status: 'unobserved',
            attempts: snapshot.stage === currentStage
                ? snapshot.attempts + 1
                : snapshot.attempts,
            observedOutcomes: [],
            missingOutcomes: [...snapshot.requiredOutcomes],
            lastEvaluation: undefined
        };
    });
    state.status = 'active';
    state.currentStage = input.targetStage;
    state.transitions.push({
        sequence: state.transitions.length + 1,
        evaluatedStage: input.event.stage,
        decision: 'continue_react',
        targetStage: input.targetStage,
        outcome: input.event.outcome,
        observedOutcomes,
        missingOutcomes,
        ...(cleanText(input.event.reason) ? {
            reason: cleanText(input.event.reason)
        } : {})
    });
    return state;
}

/**
 * 把一次有明确承接 owner 的 generation 边界记录为可续跑状态。
 *
 * 这与 provider failure replan 不同：当前阶段未被判失败，也不要求目标严格早于当前阶段。
 * 典型场景是 E2 缺少保存/导出结果，或有界运行预算到点但 R4/E1 尚有未闭合节点。
 * 下一 generation 才会由 Runtime Session 按 targetStage 清空目标及下游快照；本函数
 * 只记录“需要承接”的状态事实，不执行 Tool、不调度模型。
 */
export function requestRuntimeStageReentry(input: {
    plan: RuntimeStagePlan;
    state: RuntimeStageState;
    targetStage: RuntimeStage;
    reason: string;
}): RuntimeStageState {
    const state: RuntimeStageState = {
        ...input.state,
        stages: input.state.stages.map((stage) => ({
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
        transitions: input.state.transitions.map((transition) => ({
            ...transition,
            observedOutcomes: [...transition.observedOutcomes],
            missingOutcomes: [...transition.missingOutcomes]
        })),
        issues: [...input.state.issues]
    };
    const currentStage = state.currentStage;
    if (!currentStage) {
        return {
            ...state,
            issues: appendIssue(state.issues, 'stage_reentry_current_stage_missing')
        };
    }
    if (findStageIndex(input.plan, input.targetStage) < 0) {
        return {
            ...state,
            issues: appendIssue(
                state.issues,
                `stage_reentry_target_not_in_plan:${input.targetStage}`
            )
        };
    }
    const currentSnapshotIndex = state.stages.findIndex((snapshot) => (
        snapshot.stage === currentStage
    ));
    if (currentSnapshotIndex < 0) {
        return {
            ...state,
            issues: appendIssue(
                state.issues,
                `stage_reentry_current_snapshot_missing:${currentStage}`
            )
        };
    }
    const currentSnapshot = state.stages[currentSnapshotIndex];
    const reason = cleanText(input.reason);
    state.stages[currentSnapshotIndex] = {
        ...currentSnapshot,
        status: 'needs_review',
        attempts: currentSnapshot.attempts + 1,
        lastEvaluation: {
            outcome: 'missing_required_outcomes',
            ...(reason ? { reason } : {})
        }
    };
    state.status = 'reflexion_required';
    state.currentStage = input.targetStage;
    state.transitions.push({
        sequence: state.transitions.length + 1,
        evaluatedStage: currentStage,
        decision: 'enter_reflexion',
        targetStage: input.targetStage,
        outcome: 'missing_required_outcomes',
        observedOutcomes: [...currentSnapshot.observedOutcomes],
        missingOutcomes: [...currentSnapshot.missingOutcomes],
        ...(reason ? { reason } : {})
    });
    return state;
}

/**
 * 恢复同一 TaskRun 的结构化用户交互。
 *
 * 这里只撤销“当前阶段正在等用户”的暂停标记，不把确认本身计成阶段通过、
 * Tool 进展或质量结果。调用方必须先校验 taskRunId、interactionId 与文档 revision；
 * 本 reducer 不读取自然语言，也不授予写权限。
 */
export function resumeRuntimeStageAfterUserConfirmation(input: {
    plan: RuntimeStagePlan;
    state: RuntimeStageState;
    reason?: string;
}): RuntimeStageState {
    const currentStage = input.state.currentStage;
    if (input.state.status !== 'awaiting_confirmation' || !currentStage) {
        return {
            ...input.state,
            issues: appendIssue(
                input.state.issues,
                'stage_resume_without_awaiting_confirmation'
            )
        };
    }
    if (findStageIndex(input.plan, currentStage) < 0) {
        return {
            ...input.state,
            issues: appendIssue(
                input.state.issues,
                `stage_resume_target_not_in_plan:${currentStage}`
            )
        };
    }
    const snapshotIndex = input.state.stages.findIndex((snapshot) => (
        snapshot.stage === currentStage
    ));
    if (snapshotIndex < 0) {
        return {
            ...input.state,
            issues: appendIssue(
                input.state.issues,
                `stage_resume_snapshot_missing:${currentStage}`
            )
        };
    }

    const reason = cleanText(input.reason)
        || '已收到与当前 TaskRun 交互身份及文档版本匹配的结构化确认。';
    const previous = input.state.stages[snapshotIndex];
    const stages = input.state.stages.map((snapshot, index) => {
        if (index !== snapshotIndex) return snapshot;
        return {
            ...snapshot,
            status: 'unobserved' as const,
            lastEvaluation: undefined
        };
    });
    return {
        ...input.state,
        status: 'active',
        stages,
        transitions: [
            ...input.state.transitions,
            {
                sequence: input.state.transitions.length + 1,
                evaluatedStage: currentStage,
                decision: 'resume_after_user_confirmation',
                targetStage: currentStage,
                outcome: 'confirmation_received',
                observedOutcomes: [...previous.observedOutcomes],
                missingOutcomes: [...previous.missingOutcomes],
                reason
            }
        ]
    };
}

export function applyRuntimeStageEvaluation(input: {
    plan: RuntimeStagePlan;
    state: RuntimeStageState;
    event: RuntimeStageEvaluationEvent;
}): RuntimeStageState {
    const { plan, event } = input;
    const state: RuntimeStageState = {
        ...input.state,
        stages: input.state.stages.map((stage) => ({
            ...stage,
            requiredOutcomes: [...stage.requiredOutcomes],
            observedOutcomes: [...stage.observedOutcomes],
            missingOutcomes: [...stage.missingOutcomes],
            ...(stage.lastEvaluation ? {
                lastEvaluation: {
                    ...stage.lastEvaluation,
                    ...(stage.lastEvaluation.verdict ? { verdict: { ...stage.lastEvaluation.verdict } } : {})
                }
            } : {})
        })),
        transitions: input.state.transitions.map((transition) => ({
            ...transition,
            observedOutcomes: [...transition.observedOutcomes],
            missingOutcomes: [...transition.missingOutcomes]
        })),
        issues: [...input.state.issues]
    };
    const stageIndex = findStageIndex(plan, event.stage);
    if (stageIndex < 0) {
        return {
            ...state,
            issues: appendIssue(state.issues, `evaluation_stage_not_in_plan:${event.stage}`)
        };
    }

    const step = plan.steps[stageIndex];
    const snapshotIndex = state.stages.findIndex((snapshot) => snapshot.stage === event.stage);
    if (snapshotIndex < 0) {
        return {
            ...state,
            issues: appendIssue(state.issues, `stage_snapshot_missing:${event.stage}`)
        };
    }
    if (state.currentStage && state.currentStage !== event.stage) {
        state.issues = appendIssue(
            state.issues,
            `out_of_order_stage_observation:expected=${state.currentStage},observed=${event.stage}`
        );
    }

    const previous = state.stages[snapshotIndex];
    const observedOutcomes = unique([
        ...previous.observedOutcomes,
        ...event.observedOutcomes
    ]);
    const requiredOutcomes = unique(step.requiredOutcomes);
    const observedSet = new Set(observedOutcomes);
    const missingOutcomes = requiredOutcomes.filter((outcome) => !observedSet.has(outcome));
    let effectiveOutcome = event.outcome;
    if (event.outcome === 'passed' && missingOutcomes.length > 0) {
        effectiveOutcome = 'missing_required_outcomes';
        state.issues = appendIssue(
            state.issues,
            `stage_pass_downgraded_missing_outcomes:${event.stage}:${missingOutcomes.join(',')}`
        );
    }

    let decision: RuntimeStageTransitionDecision;
    let status: RuntimeStageStateStatus;
    let observedStatus: RuntimeStageObservedStatus;
    let targetStage: RuntimeStage | undefined;

    switch (effectiveOutcome) {
        case 'passed': {
            const nextStage = plan.steps[stageIndex + 1]?.stage;
            observedStatus = 'passed';
            if (nextStage) {
                decision = 'advance';
                status = 'active';
                targetStage = nextStage;
            } else {
                decision = 'complete';
                status = 'completed';
            }
            break;
        }
        case 'failed': {
            observedStatus = 'failed';
            if (step.failureTarget === 'reflexion') {
                decision = 'enter_reflexion';
                status = 'reflexion_required';
                const requestedTarget = event.reflexionHandoff?.status === 'reflexion_required'
                    ? event.reflexionHandoff.targetStage as RuntimeStage
                    : event.stage;
                if (findStageIndex(plan, requestedTarget) >= 0) {
                    targetStage = requestedTarget;
                } else {
                    targetStage = event.stage;
                    state.issues = appendIssue(
                        state.issues,
                        `reflexion_target_not_in_plan:${requestedTarget}`
                    );
                }
            } else {
                decision = 'continue_react';
                status = 'active';
                targetStage = event.stage;
            }
            break;
        }
        case 'awaiting_confirmation':
            observedStatus = 'awaiting_confirmation';
            decision = 'await_user_confirmation';
            status = 'awaiting_confirmation';
            targetStage = event.stage;
            break;
        case 'cancelled':
            observedStatus = 'cancelled';
            decision = 'stop_cancelled';
            status = 'cancelled';
            targetStage = event.stage;
            break;
        case 'needs_review':
            if (isCompletedAestheticImprovementReflexionHandoff(event.reflexionHandoff)) {
                observedStatus = 'needs_review';
                decision = 'enter_reflexion';
                status = 'reflexion_required';
                const requestedTarget = event.reflexionHandoff?.targetStage as RuntimeStage;
                if (findStageIndex(plan, requestedTarget) >= 0) {
                    targetStage = requestedTarget;
                } else {
                    targetStage = event.stage;
                    state.issues = appendIssue(
                        state.issues,
                        `reflexion_target_not_in_plan:${requestedTarget}`
                    );
                }
                break;
            }
            observedStatus = 'needs_review';
            decision = 'await_outcome_or_review';
            status = 'awaiting_outcomes';
            targetStage = event.stage;
            break;
        case 'missing_required_outcomes':
        default:
            observedStatus = 'needs_review';
            decision = 'await_outcome_or_review';
            status = 'awaiting_outcomes';
            targetStage = event.stage;
            break;
    }

    const verdict = buildVerdictSnapshot(event.verdict);
    state.stages[snapshotIndex] = {
        ...previous,
        status: observedStatus,
        attempts: previous.attempts + 1,
        requiredOutcomes,
        observedOutcomes,
        missingOutcomes,
        lastEvaluation: {
            outcome: effectiveOutcome,
            ...(cleanText(event.reason) ? { reason: cleanText(event.reason) } : {}),
            ...(verdict ? { verdict } : {})
        }
    };
    state.status = status;
    state.currentStage = targetStage;
    state.transitions.push({
        sequence: state.transitions.length + 1,
        evaluatedStage: event.stage,
        decision,
        ...(targetStage ? { targetStage } : {}),
        outcome: effectiveOutcome,
        observedOutcomes,
        missingOutcomes,
        ...(cleanText(event.reason) ? { reason: cleanText(event.reason) } : {})
    });
    return state;
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

export function buildRuntimeStageStateFromEvaluation(
    input: BuildRuntimeStageStateFromEvaluationInput
): RuntimeStageState {
    let state = createRuntimeStageState(input.plan);
    if (findStageIndex(input.plan, 'R0') >= 0) {
        state = applyRuntimeStageEvaluation({
            plan: input.plan,
            state,
            event: {
                stage: 'R0',
                outcome: 'passed',
                observedOutcomes: ['skill_manifest_selected', 'stage_plan_created'],
                reason: '运行时已由结构化 Skill manifest 生成 stage plan。'
            }
        });
    }

    const observedEvents = Array.isArray(input.observedEvents) ? input.observedEvents : [];
    for (const event of observedEvents) {
        if (event.stage === 'R0' || event.stage === 'R5' || event.stage === 'E2') continue;
        state = applyRuntimeStageEvaluation({
            plan: input.plan,
            state,
            event
        });
    }

    if (input.executionSummary.status === 'cancelled') {
        const target = state.currentStage || input.plan.steps[0]?.stage;
        if (!target) return state;
        return applyRuntimeStageEvaluation({
            plan: input.plan,
            state,
            event: {
                stage: target,
                outcome: 'cancelled',
                observedOutcomes: [],
                reason: '运行被取消；未观察阶段不补造完成。'
            }
        });
    }

    if (input.executionSummary.status === 'awaiting_confirmation') {
        const target = findStageIndex(input.plan, 'E2') >= 0
            ? 'E2'
            : (state.currentStage || input.plan.steps[input.plan.steps.length - 1]?.stage);
        if (!target) return state;
        return applyRuntimeStageEvaluation({
            plan: input.plan,
            state,
            event: {
                stage: target,
                outcome: 'awaiting_confirmation',
                observedOutcomes: [],
                reason: '任务停在用户确认点，不能推进交付阶段。'
            }
        });
    }

    if (findStageIndex(input.plan, 'R5') < 0) return state;
    const verdict = input.executionSummary.designVerdict;
    const reflexionRequired = input.reflexionHandoff?.status === 'reflexion_required';
    const completedAestheticImprovement = isCompletedAestheticImprovementReflexionHandoff(
        input.reflexionHandoff
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
    state = applyRuntimeStageEvaluation({
        plan: input.plan,
        state,
        event: {
            stage: 'R5',
            outcome,
            observedOutcomes: verdict
                ? ['quality_gate_report', 'stage_evaluation']
                : ['stage_evaluation'],
            reason,
            ...(verdict ? { verdict } : {}),
            ...(input.reflexionHandoff ? { reflexionHandoff: input.reflexionHandoff } : {})
        }
    });
    const r5Passed = state.stages.find((stage) => stage.stage === 'R5')?.status === 'passed';
    if (!r5Passed) return state;
    for (const event of observedEvents) {
        if (event.stage !== 'E2') continue;
        state = applyRuntimeStageEvaluation({
            plan: input.plan,
            state,
            event
        });
    }
    return state;
}
