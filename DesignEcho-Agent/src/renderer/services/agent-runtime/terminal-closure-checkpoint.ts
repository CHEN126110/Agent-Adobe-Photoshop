/**
 * 自然终稿的可恢复闭合投影。
 *
 * 本模块只消费已经形成的 Completion / Evaluation / ReviewSet / Delivery 事实，
 * 生成稳定 gap 与有界继续决策；不读取 Host、不执行 Tool、不推进 Session，也不选择修法。
 */

import type {
    DesignAssertionResult,
    FinalQualityModelProtocolDigest
} from '../../../shared/design-quality-assertion';
import type { PhotoshopHistoryStateRef } from '../../../shared/photoshop-history-state-ref';
import { computeFastFingerprint } from '../../../shared/agent-runtime-v5/content-hash';
import type { DesignEvaluationProfile } from '../../../shared/agent-runtime-v5/design-evaluation-profiles';
import type { ReflexionHandoff } from '../../../shared/agent-runtime-v5/reflexion-contract';
import type { RuntimeDeliveryVerification } from '../../../shared/agent-runtime-v5/runtime-delivery-receipt';
import type { RuntimeSession } from '../../../shared/agent-runtime-v5/runtime-session';
import type { RuntimeStageTraceEventInput } from '../../../shared/agent-runtime-v5/runtime-stage-trace';
import type {
    AgentExecutionSummary,
    AgentStepEvent,
    AgentStopReason,
    AgentTerminalClosureOutcome
} from './types';

export const MAX_TERMINAL_CLOSURE_RECOVERY_ATTEMPTS = 2;

export interface AgentRunResultInput {
    success: boolean;
    message: string;
    iterations: number;
    stopReason: AgentStopReason;
    cancelled?: boolean;
    error?: string;
    data?: Record<string, unknown>;
    reflexionHandoff?: ReflexionHandoff;
}

export interface AgentDeliveryStageEvidence {
    verification?: RuntimeDeliveryVerification;
    deliveryEvidencePassed: boolean;
    finalDeliveryResultRefs?: string[];
    stageTraceEvent?: RuntimeStageTraceEventInput;
}

export interface PreparedAgentTerminalClosure {
    executionSummary: AgentExecutionSummary;
    deliveryStageEvidence: AgentDeliveryStageEvidence;
    runtimeDeliveryVerification?: RuntimeDeliveryVerification;
    reflexionHandoff?: ReflexionHandoff;
    vlmAssertions: DesignAssertionResult[] | null;
}

export interface AgentTerminalClosureQualityCache {
    historyStateRef: PhotoshopHistoryStateRef;
    latestMutationIndex: number;
    vlmAssertions: DesignAssertionResult[] | null;
    protocolDigest?: FinalQualityModelProtocolDigest;
}

export type AgentTerminalClosureQualityReuse =
    | { status: 'not_available' }
    | {
        status: 'reused';
        vlmAssertions: DesignAssertionResult[] | null;
        protocolDigest?: FinalQualityModelProtocolDigest;
    }
    | { status: 'stale'; vlmAssertions: null }
    | { status: 'unavailable'; vlmAssertions: null };

export interface AgentTerminalClosureGap {
    kind: 'post_write_evidence' | 'delivery_evidence';
    reason: 'required_post_write_evidence_missing' | 'delivery_outputs_missing';
    fingerprint: string;
    message: string;
    missingCheckKeys: string[];
    missingEvidenceKinds: Array<'fresh_structure' | 'fresh_visual'>;
    missingOutputs: string[];
    currentHistoryStateRef?: PhotoshopHistoryStateRef;
    reviewHistoryStateRef?: PhotoshopHistoryStateRef;
}

export type AgentTerminalClosureStopReason = AgentTerminalClosureOutcome['reason'];

export interface AgentTerminalClosureRuntimeBoundary {
    allowed: boolean;
    reason?: Exclude<
        AgentTerminalClosureStopReason,
        'same_gap' | 'attempt_limit' | 'budget_exhausted'
    >;
}

export interface AgentTerminalClosureContinuationDecision {
    gap?: AgentTerminalClosureGap;
    shouldContinue: boolean;
    suppressReflexionHandoff: boolean;
    reason?: AgentTerminalClosureStopReason;
}

export interface AgentTerminalClosureCheckpoint {
    continueLoop: boolean;
    preparedClosure?: PreparedAgentTerminalClosure;
    gap?: AgentTerminalClosureGap;
    stopReason?: AgentTerminalClosureStopReason;
}

export async function evaluateNaturalFinalTerminalClosureCheckpoint(input: {
    finalMessage: string;
    unsupportedBareCompletionClaim: boolean;
    iteration: number;
    lastGapFingerprint: string;
    recoveryAttempts: number;
    prepareClosure: (input: AgentRunResultInput) => Promise<PreparedAgentTerminalClosure>;
    projectGap: (prepared: PreparedAgentTerminalClosure) => AgentTerminalClosureGap | undefined;
    projectRuntimeBoundary: (gap: AgentTerminalClosureGap) => AgentTerminalClosureRuntimeBoundary;
    budgetBoundaryAllows: () => boolean;
}): Promise<AgentTerminalClosureCheckpoint> {
    if (input.unsupportedBareCompletionClaim) return { continueLoop: false };
    const preparedClosure = await input.prepareClosure({
        success: true,
        message: input.finalMessage,
        iterations: input.iteration + 1,
        stopReason: 'final_response'
    });
    const gap = input.projectGap(preparedClosure);
    const runtimeBoundary = gap
        ? input.projectRuntimeBoundary(gap)
        : { allowed: false };
    const decision = decideTerminalClosureContinuation({
        gap,
        lastGapFingerprint: input.lastGapFingerprint,
        recoveryAttempts: input.recoveryAttempts,
        runtimeBoundary,
        budgetBoundaryAllows: input.budgetBoundaryAllows()
    });
    if (!decision.gap) return { continueLoop: false, preparedClosure };
    if (!decision.shouldContinue) {
        const closure = decision.suppressReflexionHandoff && decision.reason
            ? stopPreparedTerminalClosure(preparedClosure, decision.gap, decision.reason)
            : preparedClosure;
        return {
            continueLoop: false,
            preparedClosure: closure,
            gap: decision.gap,
            ...(decision.reason ? { stopReason: decision.reason } : {})
        };
    }
    return { continueLoop: true, preparedClosure, gap: decision.gap };
}

export function stopPreparedTerminalClosure(
    preparedClosure: PreparedAgentTerminalClosure,
    gap: AgentTerminalClosureGap,
    reason: AgentTerminalClosureStopReason
): PreparedAgentTerminalClosure {
    return {
        ...preparedClosure,
        executionSummary: {
            ...preparedClosure.executionSummary,
            terminalClosureOutcome: buildTerminalClosureOutcome(gap, reason)
        },
        reflexionHandoff: undefined
    };
}

export function mapTerminalRecoveryStopReason(
    stopReason: AgentStopReason
): AgentTerminalClosureStopReason | undefined {
    if (stopReason === 'awaiting_user_confirmation' || stopReason === 'awaiting_user_input') {
        return undefined;
    }
    if (stopReason === 'cancelled') return 'cancelled';
    if (stopReason === 'performance_budget'
        || stopReason === 'tool_budget_final_response'
        || stopReason === 'max_iterations') return 'budget_exhausted';
    if (stopReason === 'no_progress') return 'recovery_no_progress';
    if (stopReason === 'tool_preflight_blocked') return 'recovery_preflight_blocked';
    if (stopReason !== 'final_response') return 'recovery_failed';
    return undefined;
}

export function guardTerminalRecoveryEarlyExit(input: {
    preparedClosure: PreparedAgentTerminalClosure;
    gap?: AgentTerminalClosureGap;
    recoveryAttempts: number;
    stopReason: AgentStopReason;
    preparedByNaturalCheckpoint: boolean;
}): PreparedAgentTerminalClosure {
    const closure = input.preparedClosure;
    if (input.recoveryAttempts <= 0 || !input.gap
        || closure.executionSummary.status === 'completed') return closure;
    if (input.stopReason === 'awaiting_user_confirmation'
        || input.stopReason === 'awaiting_user_input') {
        return { ...closure, reflexionHandoff: undefined };
    }
    if (input.stopReason === 'final_response' && input.preparedByNaturalCheckpoint) return closure;
    const reason = mapTerminalRecoveryStopReason(input.stopReason);
    return reason ? stopPreparedTerminalClosure(closure, input.gap, reason) : closure;
}

export function projectTerminalClosureContinuationStep(input: {
    gap: AgentTerminalClosureGap;
    iteration: number;
    maxIterations: number;
}): AgentStepEvent {
    return {
        kind: 'observation',
        title: input.gap.kind === 'delivery_evidence'
            ? '正在核对交付文件'
            : '正在完成终稿检查',
        detail: input.gap.kind === 'delivery_evidence'
            ? '正在确认可编辑文件和导出成品是否属于同一个最终版本。'
            : '正在确认最终画面与当前 Photoshop 版本是否一致。',
        status: 'running',
        iteration: input.iteration,
        maxIterations: input.maxIterations,
        issue: 'terminal_closure_recovery',
        source: 'agent_runtime',
        audience: 'user',
        visibility: 'user_process'
    };
}

export function projectTerminalClosureStopStep(input: {
    reason: AgentTerminalClosureStopReason;
    iteration: number;
    maxIterations: number;
}): AgentStepEvent {
    return {
        kind: 'observation',
        title: '最终闭合没有取得新进展',
        detail: describeTerminalClosureStop(input.reason),
        status: 'error',
        iteration: input.iteration,
        maxIterations: input.maxIterations,
        issue: `terminal_closure_${input.reason}`,
        source: 'agent_runtime',
        audience: 'debug'
    };
}

export function projectRecoverableTerminalClosureGap(input: {
    summary: AgentExecutionSummary;
    evaluationProfile?: DesignEvaluationProfile;
    currentHistoryStateRef?: PhotoshopHistoryStateRef;
    reviewHistoryStateRef?: PhotoshopHistoryStateRef;
    finalQualityJudgeAvailable: boolean;
    reflexionHandoff?: ReflexionHandoff;
    deliveryVerification?: RuntimeDeliveryVerification;
}): AgentTerminalClosureGap | undefined {
    const summary = input.summary;
    if (summary.stopReason !== 'final_response') return undefined;
    const digest = summary.designEvaluationProfileDigest;
    const unresolvedRequiredCheckKeys = new Set([
        ...(digest?.missingRequiredCheckKeys || []),
        ...(digest?.requiredNeedsReviewCheckKeys || [])
    ]);
    // Final Judge 已经形成协议摘要时，fresh_visual 的缺口属于 Evaluation Owner 的结果，
    // 不是主 Agent 尚未观察画面。协议无效、Provider 不可用、回执不可信或 revision 过期
    // 都不能被改写成一条通用“继续设计”消息，否则会诱发重复看图甚至误改成品。
    const finalQualityJudgeCanStillRun = input.finalQualityJudgeAvailable
        && !summary.finalQualityModelProtocolDigest;
    const recoverableChecks = input.evaluationProfile?.checks
        .filter((check) => {
            const runtime = check.runtime;
            return Boolean(
                check.required
                && unresolvedRequiredCheckKeys.has(check.key)
                && runtime?.repair?.trigger === 'post_write_observation_missing'
                && runtime.repair.targetStage === 'R5'
                && (runtime.evidence === 'fresh_structure'
                    || (runtime.evidence === 'fresh_visual'
                        && finalQualityJudgeCanStillRun))
            );
        })
        .map((check) => ({ key: check.key, evidence: check.runtime?.evidence })) || [];
    const missingCheckKeys = recoverableChecks.map((check) => check.key).sort();
    const missingEvidenceKinds = Array.from(new Set(recoverableChecks
        .map((check) => check.evidence)
        .filter((evidence): evidence is 'fresh_structure' | 'fresh_visual' => (
            evidence === 'fresh_structure' || evidence === 'fresh_visual'
        )))).sort();
    if (missingCheckKeys.length > 0 && Number(summary.successfulMutationCalls || 0) > 0) {
        const currentVersion = formatHistory(input.currentHistoryStateRef, 'unknown');
        const reviewVersion = formatHistory(input.reviewHistoryStateRef, 'missing_or_incomplete');
        const evidenceLabels = missingEvidenceKinds.map((kind) => (
            kind === 'fresh_structure' ? '写后结构' : '写后视觉'
        ));
        return {
            kind: 'post_write_evidence',
            reason: 'required_post_write_evidence_missing',
            fingerprint: computeFastFingerprint({
                kind: 'post_write_evidence',
                currentVersion,
                reviewVersion,
                missingCheckKeys,
                missingEvidenceKinds
            }),
            message: [
                '终态闭合检查发现：当前版本仍缺少必需且同版本的写后证据。',
                `当前版本锚点：${currentVersion}；终审画面证据：${reviewVersion}。`,
                `仍缺少的事实类型：${evidenceLabels.join('、')}；未闭合检查数量：${missingCheckKeys.length}。`,
                '继续基于当前用户目标和现有完整上下文，自主决定最小的下一步；不要重复已经闭合的动作。取得新的可验证事实后，再给出最终答复。'
            ].join('\n'),
            missingCheckKeys,
            missingEvidenceKinds,
            missingOutputs: [],
            currentHistoryStateRef: input.currentHistoryStateRef,
            reviewHistoryStateRef: input.reviewHistoryStateRef
        };
    }

    const deliveryVerification = input.deliveryVerification;
    if (input.reflexionHandoff?.sourceOwner === 'E2'
        && deliveryVerification?.status === 'incomplete'
        && summary.designVerdict?.status === 'passed') {
        const missingOutputs = deliveryVerification.missingOutputs
            .map((output) => String(output || '').trim())
            .filter(Boolean)
            .sort();
        const currentVersion = formatHistory(input.currentHistoryStateRef, 'unknown');
        return {
            kind: 'delivery_evidence',
            reason: 'delivery_outputs_missing',
            fingerprint: computeFastFingerprint({
                kind: 'delivery_evidence',
                currentVersion,
                missingOutputs
            }),
            message: [
                '终态闭合检查发现：设计质量已经闭合，但当前版本的声明交付事实尚未完整。',
                `当前已审版本锚点：${currentVersion}。`,
                `仍缺少的声明交付项：${missingOutputs.length > 0 ? missingOutputs.join('、') : '未取得完整收据的交付项'}。`,
                '继续基于当前用户目标和现有完整上下文，自主决定最小的下一步；只补齐未闭合的交付事实，不要重复已经闭合的设计动作。完成后再给出最终答复。'
            ].join('\n'),
            missingCheckKeys: [],
            missingEvidenceKinds: [],
            missingOutputs,
            currentHistoryStateRef: input.currentHistoryStateRef,
            reviewHistoryStateRef: input.reviewHistoryStateRef
        };
    }
    return undefined;
}

export function buildDeliveryStageReflexionHandoff(input: {
    summary: AgentExecutionSummary;
    verification?: RuntimeDeliveryVerification;
    runtimeDeliveryStageRequired: boolean;
}): ReflexionHandoff | undefined {
    if (input.summary.designVerdict?.status !== 'passed'
        || input.verification?.status !== 'incomplete'
        || !input.runtimeDeliveryStageRequired) {
        return undefined;
    }
    const missingOutputs = input.verification.missingOutputs
        .map((output) => String(output || '').trim())
        .filter(Boolean);
    const missingLabel = missingOutputs.length > 0 ? missingOutputs.join('、') : '最终文件';
    return {
        version: 'quality-gate-reflexion-handoff/v0',
        status: 'reflexion_required',
        sourceOwner: 'E2',
        targetStage: 'E2',
        reenterLoop: 'react',
        failureAnalysis: [`设计质量已经通过，但交付仍缺少：${missingLabel}。`],
        strategyAdjustments: ['保留已经完成的画面，只补齐需要保存或导出的最终文件。'],
        nextRoundConstraints: [
            `只补齐 ${missingLabel}，不要重新改动画面。`,
            '使用当前已经确认的版本保存或导出，并确认文件确实生成。'
        ]
    };
}

export function projectReflexionHandoffStep(input: {
    handoff: ReflexionHandoff;
    iteration: number;
    maxIterations: number;
}): AgentStepEvent | undefined {
    if (input.handoff.status !== 'reflexion_required') return undefined;
    return {
        kind: 'observation',
        title: '返工约束已生成',
        detail: [
            `回退阶段：${input.handoff.targetStage}`,
            ...input.handoff.failureAnalysis.slice(0, 2),
            ...input.handoff.nextRoundConstraints.slice(0, 2)
        ].filter(Boolean).join('\n'),
        status: 'running',
        iteration: input.iteration,
        maxIterations: input.maxIterations,
        audience: 'agent',
        issue: 'reflexion_handoff_generated'
    };
}

export type TerminalClosureStagePreparation = 'ready' | 'advance_r5' | 'blocked';

export function resolveTerminalClosureStagePreparation(input: {
    gap: AgentTerminalClosureGap;
    currentStage?: string;
    designVerdictStatus?: unknown;
}): TerminalClosureStagePreparation {
    if (input.gap.kind !== 'delivery_evidence' || input.currentStage === 'E2') return 'ready';
    if (input.currentStage === 'R5' && input.designVerdictStatus === 'passed') return 'advance_r5';
    return 'blocked';
}

export function resolveAgentExecutionStatus(input: {
    stopReason: AgentStopReason;
    toolCallCount: number;
    successfulToolCalls: number;
    failedToolCalls: number;
    acceptanceFailed: number;
    acceptanceNeedsReview: number;
    noDocumentChangeRisks: number;
    taskCompletionStatus?: AgentExecutionSummary['status'];
    designQualityHardBlocked?: boolean;
    taskProgressMissing?: boolean;
    terminalSkillOutcomeFailed?: boolean;
    terminalSkillOutcomeUnverified?: boolean;
}): AgentExecutionSummary['status'] {
    if (input.stopReason === 'awaiting_user_confirmation'
        || input.stopReason === 'awaiting_user_input') return 'awaiting_confirmation';
    if (input.stopReason === 'cancelled') return 'cancelled';
    if (input.taskProgressMissing
        || input.terminalSkillOutcomeFailed
        || input.taskCompletionStatus === 'failed') return 'failed';
    if (input.stopReason === 'tool_budget_final_response'
        || input.stopReason === 'performance_budget'
        || input.stopReason === 'empty_final_response') {
        if (input.toolCallCount > 0 && input.successfulToolCalls === 0) return 'failed';
        if (input.acceptanceFailed > 0) return 'failed';
        if (input.failedToolCalls === 0
            && input.acceptanceNeedsReview === 0
            && input.noDocumentChangeRisks === 0
            && input.taskCompletionStatus === 'completed'
            && input.designQualityHardBlocked !== true
            && input.terminalSkillOutcomeUnverified !== true) return 'completed';
        return 'needs_review';
    }
    if (input.stopReason !== 'final_response') return 'failed';
    if (input.toolCallCount > 0 && input.successfulToolCalls === 0) return 'failed';
    if (input.acceptanceFailed > 0) return 'failed';
    if (input.failedToolCalls > 0
        || input.acceptanceNeedsReview > 0
        || input.noDocumentChangeRisks > 0
        || input.designQualityHardBlocked
        || input.terminalSkillOutcomeUnverified
        || input.taskCompletionStatus === 'needs_review') return 'needs_review';
    return 'completed';
}

export function formatAgentExecutionSummaryText(
    status: AgentExecutionSummary['status'],
    input: { blockers: string[]; warnings: string[] }
): string {
    const statusText: Record<AgentExecutionSummary['status'], string> = {
        completed: '这稿做好了',
        needs_review: '这稿先做到这里',
        failed: '这稿还没做完',
        cancelled: '已停下',
        awaiting_confirmation: '有地方想先跟你确认'
    };
    const reason = input.blockers[0] || input.warnings[0] || '';
    return reason ? `${statusText[status]}：${reason}` : `${statusText[status]}。`;
}

export function readActionableRequiredEvaluationCheckKeys(input: {
    summary: AgentExecutionSummary;
    profile?: DesignEvaluationProfile;
    reconciliationStatus?: string;
    resumeStepIds: string[];
}): string[] {
    const digest = input.summary.designEvaluationProfileDigest;
    if (!digest || digest.status === 'passed' || !input.profile) return [];
    const reportedKeys = new Set([
        ...digest.missingRequiredCheckKeys,
        ...digest.requiredNeedsReviewCheckKeys,
        ...digest.failedCheckKeys
    ].map((key) => String(key || '').trim()).filter(Boolean));
    const hasUnfinishedDeclaredPlan = Boolean(
        input.reconciliationStatus
        && input.reconciliationStatus !== 'completed'
        && input.resumeStepIds.length > 0
    );
    const canRecoverMissingPostWriteObservation = Boolean(
        input.summary.downgradedByObservationGate
        && Number(input.summary.successfulMutationCalls || 0) > 0
    );
    return input.profile.checks.filter((check) => {
        if (!reportedKeys.has(check.key)) return false;
        switch (check.runtime?.repair?.trigger) {
            case 'declared_plan_incomplete':
                return hasUnfinishedDeclaredPlan;
            case 'post_write_observation_missing':
                return canRecoverMissingPostWriteObservation;
            default:
                return false;
        }
    }).map((check) => check.key);
}

export function describeActionableRequiredEvaluationCheck(
    key: string,
    profile?: DesignEvaluationProfile
): string {
    const check = profile?.checks.find((candidate) => candidate.key === key);
    return check
        ? `必需检查“${check.label}”仍未闭合：${check.expectedFix}`
        : `必需检查 ${key} 仍有明确的运行时补证动作。`;
}

export function inferTerminalReflexionTargetStage(input: {
    hasTaskProgress: boolean;
    summary: AgentExecutionSummary;
    actionableRequiredCheckKeys: string[];
    profile?: DesignEvaluationProfile;
}): 'R0' | 'R4' | 'R5' | 'E1' {
    if (!input.hasTaskProgress) return 'R0';
    if (input.summary.stopReason === 'tool_preflight_blocked') return 'E1';
    if (input.actionableRequiredCheckKeys.some((key) => (
        input.profile?.checks.find((check) => check.key === key)?.runtime?.repair?.targetStage === 'R4'
    ))) return 'R4';
    const acceptanceFailed = input.summary.completionBlockingAcceptanceFailed
        ?? input.summary.acceptanceFailed;
    const acceptanceNeedsReview = input.summary.completionBlockingAcceptanceNeedsReview
        ?? input.summary.acceptanceNeedsReview;
    const noDocumentChangeRisks = input.summary.completionBlockingNoDocumentChangeRisks
        ?? input.summary.noDocumentChangeRisks;
    const failedToolCalls = input.summary.completionBlockingFailedToolCalls
        ?? input.summary.failedToolCalls;
    if (acceptanceFailed > 0 || acceptanceNeedsReview > 0 || noDocumentChangeRisks > 0) return 'E1';
    if (input.summary.taskCompletion?.status === 'failed'
        || input.summary.taskCompletion?.status === 'needs_review') return 'R4';
    if (failedToolCalls > 0) return 'E1';
    return 'R5';
}

export function decideTerminalClosureContinuation(input: {
    gap?: AgentTerminalClosureGap;
    lastGapFingerprint: string;
    recoveryAttempts: number;
    runtimeBoundary: AgentTerminalClosureRuntimeBoundary;
    budgetBoundaryAllows: boolean;
}): AgentTerminalClosureContinuationDecision {
    const gap = input.gap;
    if (!gap) return { shouldContinue: false, suppressReflexionHandoff: false };
    if (!input.runtimeBoundary.allowed) {
        return {
            gap,
            shouldContinue: false,
            suppressReflexionHandoff: true,
            reason: input.runtimeBoundary.reason || 'stage_mismatch'
        };
    }
    if (!input.budgetBoundaryAllows) {
        return {
            gap,
            shouldContinue: false,
            suppressReflexionHandoff: true,
            reason: 'budget_exhausted'
        };
    }
    if (gap.fingerprint === input.lastGapFingerprint) {
        return {
            gap,
            shouldContinue: false,
            suppressReflexionHandoff: true,
            reason: 'same_gap'
        };
    }
    if (input.recoveryAttempts >= MAX_TERMINAL_CLOSURE_RECOVERY_ATTEMPTS) {
        return {
            gap,
            shouldContinue: false,
            suppressReflexionHandoff: true,
            reason: 'attempt_limit'
        };
    }
    return {
        gap,
        shouldContinue: true,
        suppressReflexionHandoff: false
    };
}

export function projectTerminalClosureRuntimeBoundary(input: {
    gap: AgentTerminalClosureGap;
    signalAborted: boolean;
    hasUnsettledWriteState?: boolean;
    session?: RuntimeSession;
}): AgentTerminalClosureRuntimeBoundary {
    if (input.signalAborted) return { allowed: false, reason: 'cancelled' };
    if (input.hasUnsettledWriteState) return { allowed: false, reason: 'unknown_write' };
    const session = input.session;
    if (!session) return input.gap.kind === 'post_write_evidence'
        ? { allowed: true }
        : { allowed: false, reason: 'stage_mismatch' };
    const taskRun = session.taskRun;
    const binding = taskRun.documentBinding;
    if (taskRun.pendingInteraction || taskRun.status === 'waiting_user') {
        return { allowed: false, reason: 'waiting_user' };
    }
    if (taskRun.status === 'writer_conflict'
        || binding?.status === 'conflict'
        || binding?.conflict?.kind === 'writer_conflict') {
        return { allowed: false, reason: 'writer_conflict' };
    }
    if (taskRun.sideEffectState?.status === 'unknown'
        || binding?.conflict?.kind === 'operation_state_unknown') {
        return { allowed: false, reason: 'unknown_write' };
    }
    if (taskRun.status === 'needs_reobserve' || binding?.status === 'needs_reobserve') {
        return { allowed: false, reason: 'needs_reobserve' };
    }
    const currentStage = session.stageState.currentStage;
    const allowed = input.gap.kind === 'post_write_evidence'
        ? currentStage === 'R5'
        : currentStage === 'R5' || currentStage === 'E2';
    return allowed ? { allowed: true } : { allowed: false, reason: 'stage_mismatch' };
}

export function buildTerminalClosureQualityCache(input: {
    historyStateRef?: PhotoshopHistoryStateRef;
    latestMutationIndex: number;
    preparedClosure: PreparedAgentTerminalClosure;
}): AgentTerminalClosureQualityCache | undefined {
    if (!input.historyStateRef
        || input.preparedClosure.executionSummary.designVerdict?.status !== 'passed') {
        return undefined;
    }
    return {
        historyStateRef: { ...input.historyStateRef },
        latestMutationIndex: input.latestMutationIndex,
        vlmAssertions: cloneAssertions(input.preparedClosure.vlmAssertions),
        ...(input.preparedClosure.executionSummary.finalQualityModelProtocolDigest
            ? {
                protocolDigest: cloneFinalQualityModelProtocolDigest(
                    input.preparedClosure.executionSummary.finalQualityModelProtocolDigest
                )
            }
            : {})
    };
}

export async function reuseTerminalClosureQualityIfCurrent(input: {
    cache?: AgentTerminalClosureQualityCache;
    stopReason: AgentStopReason;
    latestMutationIndex: number;
    readCurrentHistoryStateRef: () => Promise<PhotoshopHistoryStateRef | undefined>;
    readReviewHistoryStateRef: () => PhotoshopHistoryStateRef | undefined;
}): Promise<{
    reuse: AgentTerminalClosureQualityReuse;
    cache?: AgentTerminalClosureQualityCache;
}> {
    const cache = input.cache;
    if (!cache || input.stopReason !== 'final_response') {
        return { reuse: { status: 'not_available' }, ...(cache ? { cache } : {}) };
    }
    if (input.latestMutationIndex !== cache.latestMutationIndex) {
        return { reuse: { status: 'stale', vlmAssertions: null } };
    }
    let currentHistoryStateRef: PhotoshopHistoryStateRef | undefined;
    try {
        currentHistoryStateRef = await input.readCurrentHistoryStateRef();
    } catch {
        return { reuse: { status: 'unavailable', vlmAssertions: null } };
    }
    if (!currentHistoryStateRef) {
        return { reuse: { status: 'unavailable', vlmAssertions: null } };
    }
    if (!sameHistory(currentHistoryStateRef, cache.historyStateRef)) {
        return { reuse: { status: 'stale', vlmAssertions: null } };
    }
    const reviewHistoryStateRef = input.readReviewHistoryStateRef();
    if (cache.vlmAssertions
        && (!reviewHistoryStateRef || !sameHistory(reviewHistoryStateRef, currentHistoryStateRef))) {
        return { reuse: { status: 'stale', vlmAssertions: null } };
    }
    return {
        reuse: {
            status: 'reused',
            vlmAssertions: cloneAssertions(cache.vlmAssertions),
            ...(cache.protocolDigest
                ? { protocolDigest: cloneFinalQualityModelProtocolDigest(cache.protocolDigest) }
                : {})
        },
        cache
    };
}

function sameHistory(
    left: PhotoshopHistoryStateRef,
    right: PhotoshopHistoryStateRef
): boolean {
    return left.documentId === right.documentId
        && left.historyStateId === right.historyStateId;
}

function formatHistory(
    historyStateRef: PhotoshopHistoryStateRef | undefined,
    fallback: string
): string {
    return historyStateRef
        ? `${historyStateRef.documentId}:${historyStateRef.historyStateId}`
        : fallback;
}

function cloneAssertions(
    assertions: DesignAssertionResult[] | null
): DesignAssertionResult[] | null {
    return assertions ? assertions.map((assertion) => ({ ...assertion })) : null;
}

function cloneFinalQualityModelProtocolDigest(
    digest: FinalQualityModelProtocolDigest
): FinalQualityModelProtocolDigest {
    return {
        ...digest,
        evidenceScope: { ...digest.evidenceScope }
    };
}

function buildTerminalClosureOutcome(
    gap: AgentTerminalClosureGap,
    reason: AgentTerminalClosureStopReason
): AgentTerminalClosureOutcome {
    const missingFacts = gap.kind === 'delivery_evidence'
        ? `当前版本还缺少${formatPublicDeliveryOutputs(gap.missingOutputs)}。`
        : `当前最新版本还没有取得完整的${formatPublicEvidenceKinds(gap.missingEvidenceKinds)}。`;
    return {
        version: 'agent-terminal-closure-outcome/v0',
        status: 'stopped',
        gapKind: gap.kind,
        reason,
        fingerprint: gap.fingerprint,
        missingCheckKeys: [...gap.missingCheckKeys],
        missingEvidenceKinds: [...gap.missingEvidenceKinds],
        missingOutputs: [...gap.missingOutputs],
        ...(gap.currentHistoryStateRef
            ? { currentHistory: { ...gap.currentHistoryStateRef } }
            : {}),
        ...(gap.reviewHistoryStateRef
            ? { reviewHistory: { ...gap.reviewHistoryStateRef } }
            : {}),
        publicSummary: `${missingFacts}${describeTerminalClosurePublicStop(reason)}`,
        boundaries: {
            selectsTool: false,
            grantsPermission: false,
            preservesCanonicalResult: true
        }
    };
}

function formatPublicDeliveryOutputs(outputs: string[]): string {
    const labels = Array.from(new Set(outputs.map((output) => {
        const token = String(output || '').toLowerCase();
        if (/(?:psd|editable|document)/u.test(token)) return '可编辑设计文件';
        if (/(?:preview|jpg|jpeg|png|webp|image)/u.test(token)) return '预览图';
        if (/(?:slice)/u.test(token)) return '详情页切图';
        if (/(?:report)/u.test(token)) return '结果说明';
        if (/(?:manifest|receipt|record)/u.test(token)) return '交付记录';
        if (/(?:export|output|file)/u.test(token)) return '导出文件';
        return '一个交付文件';
    })));
    return labels.length > 0 ? labels.join('、') : '完整的交付文件';
}

function formatPublicEvidenceKinds(kinds: AgentTerminalClosureGap['missingEvidenceKinds']): string {
    const labels = kinds.map((kind) => (
        kind === 'fresh_structure' ? '图层结构检查结果' : '画面检查结果'
    ));
    return labels.length > 0 ? labels.join('和') : '最终检查结果';
}

function describeTerminalClosurePublicStop(reason: AgentTerminalClosureStopReason): string {
    switch (reason) {
        case 'same_gap':
        case 'recovery_no_progress':
            return '再次检查后仍没有新的可核对结果，已停在当前版本。';
        case 'attempt_limit':
            return '自动检查次数已用完，已停在当前版本。';
        case 'cancelled':
            return '当前请求已取消，没有继续自动处理。';
        case 'waiting_user':
            return '当前任务正在等你补充信息，没有越过等待点继续处理。';
        case 'writer_conflict':
            return '当前文件正由另一项任务处理，没有继续改动。';
        case 'unknown_write':
            return '上一步是否生效还无法确认，因此没有重复改动。';
        case 'needs_reobserve':
            return '当前文件版本需要重新确认，因此没有沿用旧结果继续处理。';
        case 'stage_mismatch':
            return '当前任务状态不适合继续自动处理，已停在当前版本。';
        case 'budget_exhausted':
            return '本轮可用处理额度已经用完，已停在当前版本。';
        case 'recovery_preflight_blocked':
            return '当前安全条件不允许继续处理，已保留现有结果。';
        case 'recovery_failed':
            return '补充检查未能继续，已保留现有结果。';
    }
}

function describeTerminalClosureStop(reason: AgentTerminalClosureStopReason): string {
    switch (reason) {
        case 'same_gap':
            return '同一缺口再次出现且没有新进展，已停止自动续接并保留当前版本。';
        case 'attempt_limit':
            return '本次终态闭合已达到有界次数，已保留当前版本。';
        case 'cancelled':
            return '当前请求已取消，没有继续自动处理。';
        case 'waiting_user':
            return '当前任务正在等待用户输入，没有越过等待点继续处理。';
        case 'writer_conflict':
            return '当前文档存在其他写入 owner，没有继续自动处理。';
        case 'unknown_write':
            return '上一次写入状态仍未知，没有重复修改或启动新一轮任务。';
        case 'needs_reobserve':
            return '当前文档版本需要重新对账，没有使用旧版本事实继续处理。';
        case 'stage_mismatch':
            return '当前运行阶段不能安全承接该缺口，没有启动新的 Agent。';
        case 'budget_exhausted':
            return '本次运行预算已经用完，没有另起新一轮继续消耗。';
        case 'recovery_no_progress':
            return '补齐终态证据时没有取得新进展，已停止且没有另起新的 Agent。';
        case 'recovery_preflight_blocked':
            return '补齐终态证据时被当前安全条件阻止，已保留真实错误且没有另起新的 Agent。';
        case 'recovery_failed':
            return '补齐终态证据时本轮未能继续，已保留真实结果且没有另起新的 Agent。';
    }
}
