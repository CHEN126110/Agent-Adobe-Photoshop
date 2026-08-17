/**
 * 性能预算账本（agent.ts 拆分批次 1）：运行级模型/工具/视觉/时间计数与执行供给预留。
 *
 * 这里只保存状态与纯记账函数，不读 Photoshop、不读模型能力、不写消息历史；
 * Agent 侧以薄包装提供依赖注入（授权期望、交付动作尝试、终局 Judge 预留等）。
 */

import { classifyAgentToolExecution } from '../../../shared/agent-tool-execution-preflight';
import type { AgentConfig } from './types';

/** 终局审美 Judge 只允许一次（硬上限）。GATE-SIMPLIFY-003 起不再从普通预算事前扣减。 */
export const MAX_FINAL_QUALITY_JUDGE_CALLS = 1;
/** Host 质量版本复核（harness_quality_verification）每轮上限。 */
export const MAX_HARNESS_QUALITY_VERIFICATION_CALLS = 3;
// 执行供给预留（切片 2，治理切片 1 合并为单一 owner）：已授权写入的自主制作任务，
// 尾部工具预算为「至少一次写入 + 同目标读回 + 评价」保留的调用数；探索观察不得耗尽它。
export const EXECUTION_VERIFICATION_TOOL_RESERVE = 6;
// 预留区内放行的写入前最小观察数（读后写纪律的预检读取），超过后转为执行指令。
// GATE-SIMPLIFY-001 从 2 放宽到 4：一次真实读后写准备序列通常需要 3-4 次写入前读取
// （文档身份 + 层级/边界 + 一处快照），allowance=2 会把模型拦在准备序列中途，
// 是收敛指标回退（4.6% < 基线 9.2%）的机制原因之一。写后读回始终放行不变。
export const EXECUTION_RESERVE_OBSERVATION_ALLOWANCE = 4;
// 写前观察总次数上限（GATE-SIMPLIFY-001 合并原 agent.ts 轮级守卫 PRE_DELIVERY_OBSERVATION_ROUND_LIMIT
// 后的单一 owner 触发：同一指令码 agent_observation_budget_reserved）。已授权写入、尚未尝试任何
// 交付动作时，全运行累计放行 6 次写入前观察（约 2-3 轮读取），超过即转执行指令并触发交付工具收窄。
export const PRE_DELIVERY_OBSERVATION_CALL_LIMIT = 6;

export type PerformanceBudget = NonNullable<AgentConfig['performanceBudget']>;

export interface PerformanceLedgerState {
    runStartedAtMs: number;
    activeElapsedBeforeRunMs: number;
    modelCallCount: number;
    toolCallCount: number;
    visionCandidateCount: number;
    visionCandidateKeys: Set<string>;
    visualAnalysisCount: number;
    finalQualityJudgeCallCount: number;
    budgetDisciplineDirectiveIssued: boolean;
    harnessQualityVerificationCallCount: number;
    reserveZoneObservationCalls: number;
    /** GATE-SIMPLIFY-001：已授权写入且尚无交付动作时，全运行累计的写前观察调用数。 */
    preDeliveryObservationCallCount: number;
}

export function createPerformanceLedgerState(): PerformanceLedgerState {
    return {
        runStartedAtMs: 0,
        activeElapsedBeforeRunMs: 0,
        modelCallCount: 0,
        toolCallCount: 0,
        visionCandidateCount: 0,
        visionCandidateKeys: new Set(),
        visualAnalysisCount: 0,
        finalQualityJudgeCallCount: 0,
        budgetDisciplineDirectiveIssued: false,
        harnessQualityVerificationCallCount: 0,
        reserveZoneObservationCalls: 0,
        preDeliveryObservationCallCount: 0
    };
}

export interface PerformanceBudgetExhaustion {
    dimension: 'model_calls' | 'tool_calls' | 'soft_time';
    code: string;
    message: string;
    limit: number;
    used: number;
}

export function buildPerformanceBudgetExhaustionMessage(
    hasObservedTaskMutation: boolean,
    _dimension: 'model_calls' | 'tool_calls' | 'soft_time',
    _limit: number,
    _used: number
): string {
    const outcome = hasObservedTaskMutation
        ? '当前制作暂时停下，已经做出的画面改动会保留，但这还不是完整成品。'
        : '当前处理停在查看和判断阶段，还没有做出可以看的设计版本。';
    return `${outcome}尚未完成的内容需要从当前状态继续。`;
}

export function readPerformanceActiveElapsedMs(
    ledger: PerformanceLedgerState,
    nowMs = Date.now()
): number {
    const currentGenerationElapsedMs = ledger.runStartedAtMs > 0
        ? Math.max(0, Math.floor(nowMs - ledger.runStartedAtMs))
        : 0;
    return Math.max(
        0,
        Math.floor(ledger.activeElapsedBeforeRunMs + currentGenerationElapsedMs)
    );
}

export function readPerformanceBudgetExhaustion(input: {
    ledger: PerformanceLedgerState;
    budget: PerformanceBudget | undefined;
    elapsedMs: number;
    scope?: 'all' | 'model' | 'tool';
    hasObservedTaskMutation?: boolean;
}): PerformanceBudgetExhaustion | undefined {
    const { ledger, budget } = input;
    if (!budget) return undefined;
    const hasObservedTaskMutation = input.hasObservedTaskMutation === true;
    const scope = input.scope ?? 'all';
    // GATE-SIMPLIFY-003：不再为终局质量 Judge 事前扣减普通预算（无事故证据的预防性税，
    // 曾饿死身份声明与普通运行）；Judge 的硬上限由 MAX_FINAL_QUALITY_JUDGE_CALLS 在调用点保留。
    const effectiveSoftTimeBudgetMs = budget.softTimeBudgetMs;
    if (effectiveSoftTimeBudgetMs >= 0
        && ledger.runStartedAtMs > 0
        && input.elapsedMs >= effectiveSoftTimeBudgetMs) {
        return {
            dimension: 'soft_time',
            code: 'agent_soft_time_budget_exhausted',
            message: buildPerformanceBudgetExhaustionMessage(
                hasObservedTaskMutation,
                'soft_time',
                effectiveSoftTimeBudgetMs,
                input.elapsedMs
            ),
            limit: effectiveSoftTimeBudgetMs,
            used: input.elapsedMs
        };
    }
    const effectiveModelCallLimit = budget.maxModelCalls;
    if (scope !== 'tool'
        && effectiveModelCallLimit >= 0
        && ledger.modelCallCount >= effectiveModelCallLimit) {
        return {
            dimension: 'model_calls',
            code: 'agent_model_call_budget_exhausted',
            message: buildPerformanceBudgetExhaustionMessage(
                hasObservedTaskMutation,
                'model_calls',
                effectiveModelCallLimit,
                ledger.modelCallCount
            ),
            limit: effectiveModelCallLimit,
            used: ledger.modelCallCount
        };
    }
    if (scope !== 'model'
        && budget.maxToolCalls >= 0
        && ledger.toolCallCount >= budget.maxToolCalls) {
        return {
            dimension: 'tool_calls',
            code: 'agent_tool_call_budget_exhausted',
            message: buildPerformanceBudgetExhaustionMessage(
                hasObservedTaskMutation,
                'tool_calls',
                budget.maxToolCalls,
                ledger.toolCallCount
            ),
            limit: budget.maxToolCalls,
            used: ledger.toolCallCount
        };
    }
    return undefined;
}

/**
 * 执行供给预留（切片 2）：为「至少一次写入 + 同目标读回 + 评价」保留的尾部工具调用数。
 * 取固定上限与预算 20% 的较小值，预算未配置时为零（不设闸）。
 */
export function resolveExecutionSupplyReserve(budget: PerformanceBudget | undefined): number {
    if (!budget || budget.maxToolCalls < 0) return 0;
    const proportional = Math.floor(budget.maxToolCalls * 0.2);
    return Math.min(EXECUTION_VERIFICATION_TOOL_RESERVE, Math.max(1, proportional));
}

export function isInMutationExecutionReserveZone(input: {
    ledger: PerformanceLedgerState;
    budget: PerformanceBudget | undefined;
    authorizedMutationExpectation: boolean;
}): boolean {
    const { ledger, budget } = input;
    if (!budget || budget.maxToolCalls < 0) return false;
    if (!input.authorizedMutationExpectation) return false;
    const reserve = resolveExecutionSupplyReserve(budget);
    if (reserve <= 0) return false;
    return ledger.toolCallCount >= Math.max(0, budget.maxToolCalls - reserve);
}

export interface PerformanceToolConsumeContext {
    /** 本轮是否已授权期待真实 Photoshop 交付（write_photoshop 意图或结构化交付义务）。 */
    authorizedMutationExpectation: boolean;
    /** 本轮是否已真实尝试过交付类工具（写/保存/导出/外部生成）。 */
    attemptedDeliveryAction: boolean;
    /** 与 Agent.buildPerformanceBudgetExhaustionMessage 同口径的画面改动事实。 */
    hasObservedTaskMutation: boolean;
}

export function consumePerformanceToolCallBudget(input: {
    ledger: PerformanceLedgerState;
    budget: PerformanceBudget | undefined;
    reserveContext: PerformanceToolConsumeContext;
    toolName: string;
    toolArguments?: Record<string, unknown>;
}): Record<string, unknown> | undefined {
    const { ledger, budget } = input;
    const exhaustion = readPerformanceBudgetExhaustion({
        ledger,
        budget,
        elapsedMs: readPerformanceActiveElapsedMs(ledger),
        scope: 'tool',
        hasObservedTaskMutation: input.reserveContext.hasObservedTaskMutation
    });
    if (exhaustion) {
        return {
            success: false,
            code: exhaustion.code,
            error: exhaustion.message,
            blockedTool: input.toolName,
            blockedByPerformanceBudget: true,
            policyGate: true,
            performanceBudget: exhaustion,
            executesPhotoshop: false,
            grantsPermission: false,
            countsAsObservation: false,
            countsAsTaskProgress: false
        };
    }
    // 执行供给预留（切片 2，治理切片 1 合并后单一 owner）：已授权写入、尚未有任何交付动作
    // 尝试时的写前观察限量，两层触发返回同一指令码 agent_observation_budget_reserved——
    // ①全运行总次数上限 PRE_DELIVERY_OBSERVATION_CALL_LIMIT（合并原 agent.ts 轮级守卫，
    //   从 2 轮放宽为 6 次调用，给真实读后写准备序列留足空间）；
    // ②预留区 allowance（尾部工具预算只放行 ≤4 次写入前观察，保证探索不耗尽写入供给）。
    // 已有交付动作尝试后不再设闸：写后读回与 unknown 现场确认必须始终放行。
    const reserveActive = input.reserveContext.authorizedMutationExpectation
        && !input.reserveContext.attemptedDeliveryAction;
    if (reserveActive) {
        const kind = classifyAgentToolExecution(input.toolName, input.toolArguments ?? {});
        const isObservationKind = kind === 'read_only_observation' || kind === 'knowledge_search';
        if (isObservationKind) {
            const directive = (): Record<string, unknown> => ({
                success: false,
                code: 'agent_observation_budget_reserved',
                error: [
                    '这一轮还没做出可以看的结果，剩下的处理空间只保留给真正动手。',
                    '请立即在正确目标文档上完成需要的最小设计写入，写完后查看效果确认。',
                    '不要再扩展观察或检索；如果还缺关键素材，先用已有素材完成能做的部分。'
                ].join(''),
                blockedTool: input.toolName,
                blockedByPerformanceBudget: true,
                policyGate: true,
                executesPhotoshop: false,
                grantsPermission: false,
                countsAsObservation: false,
                countsAsTaskProgress: false
            });
            if (ledger.preDeliveryObservationCallCount >= PRE_DELIVERY_OBSERVATION_CALL_LIMIT) {
                return directive();
            }
            if (
                isInMutationExecutionReserveZone({
                    ledger,
                    budget,
                    authorizedMutationExpectation: input.reserveContext.authorizedMutationExpectation
                })
                && ledger.reserveZoneObservationCalls >= EXECUTION_RESERVE_OBSERVATION_ALLOWANCE
            ) {
                return directive();
            }
            ledger.preDeliveryObservationCallCount += 1;
            if (isInMutationExecutionReserveZone({
                ledger,
                budget,
                authorizedMutationExpectation: input.reserveContext.authorizedMutationExpectation
            })) {
                ledger.reserveZoneObservationCalls += 1;
            }
        }
    }
    ledger.toolCallCount += 1;
    return undefined;
}

export function consumeHarnessQualityVerificationCallBudget(input: {
    ledger: PerformanceLedgerState;
    toolName: string;
}): Record<string, unknown> | undefined {
    if (input.ledger.harnessQualityVerificationCallCount >= MAX_HARNESS_QUALITY_VERIFICATION_CALLS) {
        return {
            success: false,
            code: 'agent_quality_verification_budget_exhausted',
            error: '已达到本轮 Host 质量版本复核上限，当前质量结论保持未验证。',
            blockedTool: input.toolName,
            blockedByPerformanceBudget: true,
            policyGate: true,
            executesPhotoshop: false,
            grantsPermission: false,
            countsAsObservation: false,
            countsAsTaskProgress: false
        };
    }
    input.ledger.harnessQualityVerificationCallCount += 1;
    return undefined;
}
