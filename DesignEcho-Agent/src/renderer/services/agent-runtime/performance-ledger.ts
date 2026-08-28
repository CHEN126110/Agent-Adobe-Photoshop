/**
 * 性能预算账本（agent.ts 拆分批次 1）：运行级模型/工具/视觉/时间计数与执行供给预留。
 *
 * 这里只保存状态与纯记账函数，不读 Photoshop、不读模型能力、不写消息历史；
 * Agent 侧以薄包装提供依赖注入（授权期望、交付动作尝试、终局 Judge 预留等）。
 */

import { classifyAgentToolExecution } from '../../../shared/agent-tool-execution-preflight';
import type { RuntimePerformanceUsage } from '../../../shared/agent-runtime-v5/runtime-accounting';
import type { AgentConfig } from './types';

/**
 * 终局审美 Judge 每个 Agent generation 只允许一次（硬上限）。它不从普通任务预算事前
 * 扣减；若普通调用恰好用满，由 Agent 在调用点给予这一槽独立的一次验收机会。
 */
export const MAX_FINAL_QUALITY_JUDGE_CALLS = 1;
/** 终局 Judge 已给出可靠非通过分数但漏掉诊断时，只允许补一次诊断协议。 */
export const MAX_FINAL_QUALITY_DIAGNOSIS_REPAIR_CALLS = 1;
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

export type PerformanceModelBudgetClass =
    | 'task'
    | 'final_quality_judge'
    | 'final_quality_diagnosis_repair';

export interface PerformanceModelBudgetClassViolation {
    code: string;
    message: string;
}

export interface PerformanceLedgerState {
    runStartedAtMs: number;
    activeElapsedBeforeRunMs: number;
    /** 普通 Agent 执行模型池调用；独立 Final Judge 成本由 RuntimeAccounting 记录。 */
    modelCallCount: number;
    toolCallCount: number;
    /** 普通 Agent 执行视觉池的候选 presentation；不含独立 Final Judge / diagnosis repair。 */
    visionCandidateCount: number;
    /** 普通视觉池已经发送过的证据键；终审精确重放由独立字段保存。 */
    visionCandidateKeys: Set<string>;
    /** 普通 Agent 执行视觉池的图像模型请求；不含独立终审事件。 */
    visualAnalysisCount: number;
    finalQualityJudgeCallCount: number;
    finalQualityDiagnosisRepairCallCount: number;
    /** 首次 Final Judge 实际发送的图片 presentation，用于限定唯一 repair 只能重放同一证据。 */
    finalQualityJudgeVisionCandidateCount: number;
    finalQualityJudgeVisionCandidateKeys: string[];
    budgetDisciplineDirectiveIssued: boolean;
    harnessQualityVerificationCallCount: number;
    reserveZoneObservationCalls: number;
    /** GATE-SIMPLIFY-001：已授权写入且尚无交付动作时，全运行累计的写前观察调用数。 */
    preDeliveryObservationCallCount: number;
    /**
     * 写前观察超限后的「该动手了」提醒是否已经发过（每次运行只提醒一次，不拦截）。
     * 设计路径宪法：拦「说错 / 看多了」必须降级为提示，只有「做错 / 不可逆」才允许拦截。
     */
    /** 已发出的「该动手了」提醒次数：每累计 PRE_DELIVERY_OBSERVATION_CALL_LIMIT 次写前观察再提醒一次（真机：模型无视一次提醒后又连看 14 次）。 */
    observationReserveAdviceIssuedCount: number;
    /** 提醒已生成、尚未交给模型（由 Agent 在本轮工具结果回填后取走并清零）。 */
    observationReserveAdviceDue: boolean;
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
        finalQualityDiagnosisRepairCallCount: 0,
        finalQualityJudgeVisionCandidateCount: 0,
        finalQualityJudgeVisionCandidateKeys: [],
        budgetDisciplineDirectiveIssued: false,
        harnessQualityVerificationCallCount: 0,
        reserveZoneObservationCalls: 0,
        preDeliveryObservationCallCount: 0,
        observationReserveAdviceIssuedCount: 0,
        observationReserveAdviceDue: false
    };
}

/**
 * A queued primary-model image consumes one candidate slot and the next image-bearing
 * model request consumes one analysis slot. When a batch already has a pending image,
 * that analysis slot is shared; otherwise it must be reserved atomically with the image.
 */
export function resolveRunLevelVisualPresentationCapacity(input: {
    limit: number;
    consumed: number;
    visualAnalysisAlreadyPending: boolean;
}): number {
    const limit = Math.max(0, Math.floor(Number(input.limit) || 0));
    const consumed = Math.max(0, Math.floor(Number(input.consumed) || 0));
    // A pending image-bearing request has not reached beginPerformanceModelCall yet,
    // so its analysis slot is not part of `consumed`. Keep that virtual reservation
    // in the same pool; otherwise a second image in the same batch can oversell it.
    const pendingAnalysisReservation = input.visualAnalysisAlreadyPending ? 1 : 0;
    const newAnalysisReservation = input.visualAnalysisAlreadyPending ? 0 : 1;
    return Math.max(
        0,
        limit - consumed - pendingAnalysisReservation - newAnalysisReservation
    );
}

export function canQueueRunLevelVisualPresentation(input: {
    limit: number;
    consumed: number;
    visualAnalysisAlreadyPending: boolean;
    presentationCount?: number;
}): boolean {
    const presentationCount = Math.max(1, Math.floor(Number(input.presentationCount) || 1));
    return resolveRunLevelVisualPresentationCapacity(input) >= presentationCount;
}

/**
 * Decide before the next primary-model request whether the remaining run budget has
 * entered its closure zone. The imminent request is included so the directive is part
 * of that request instead of arriving one turn late. Time and call-count limits are
 * alternative signals; neither changes the hard budget or grants an execution right.
 */
export function shouldIssuePerformanceBudgetDisciplineDirective(input: {
    budget: PerformanceBudget | undefined;
    ledger: Pick<PerformanceLedgerState,
        'modelCallCount' | 'budgetDisciplineDirectiveIssued'>;
    activeElapsedMs: number;
    imminentModelCalls?: number;
    requestTimeoutMs: number;
}): boolean {
    const { budget, ledger } = input;
    if (!budget || ledger.budgetDisciplineDirectiveIssued) return false;

    const imminentModelCalls = Math.max(
        0,
        Math.floor(Number(input.imminentModelCalls) || 0)
    );
    const callThreshold = Math.max(2, Math.floor(budget.maxModelCalls / 4));
    const remainingModelCalls = budget.maxModelCalls
        - ledger.modelCallCount
        - imminentModelCalls;
    const callBudgetDue = budget.maxModelCalls >= 0
        && remainingModelCalls > 0
        && remainingModelCalls <= callThreshold;

    const activeElapsedMs = Math.max(0, Math.floor(Number(input.activeElapsedMs) || 0));
    const requestTimeoutMs = Math.max(1, Math.floor(Number(input.requestTimeoutMs) || 1));
    const remainingTimeMs = budget.softTimeBudgetMs - activeElapsedMs;
    const timeBudgetDue = budget.softTimeBudgetMs >= 0
        && remainingTimeMs > 0
        && remainingTimeMs <= requestTimeoutMs;
    return callBudgetDue || timeBudgetDue;
}

export function resetPerformanceLedgerStateForRun(
    ledger: PerformanceLedgerState,
    runStartedAtMs: number
): void {
    Object.assign(ledger, createPerformanceLedgerState(), { runStartedAtMs });
}

export function isFinalQualityModelBudgetClass(
    budgetClass: PerformanceModelBudgetClass
): boolean {
    return budgetClass === 'final_quality_judge'
        || budgetClass === 'final_quality_diagnosis_repair';
}

/** Final Judge 是独立的固定验收事件，不占用普通执行视觉池。 */
export function readRunLevelVisualBudgetConsumed(
    ledger: Pick<PerformanceLedgerState, 'visionCandidateCount' | 'visualAnalysisCount'>
): number {
    return Math.max(0, Math.floor(ledger.visionCandidateCount))
        + Math.max(0, Math.floor(ledger.visualAnalysisCount));
}

export function readPerformanceModelBudgetClassViolation(
    ledger: PerformanceLedgerState,
    budgetClass: PerformanceModelBudgetClass,
    visionPresentation?: { candidateCount: number; candidateKeys: readonly string[] }
): PerformanceModelBudgetClassViolation | undefined {
    if (budgetClass === 'final_quality_judge'
        && ledger.finalQualityJudgeCallCount >= MAX_FINAL_QUALITY_JUDGE_CALLS) {
        return {
            code: 'agent_final_quality_judge_budget_exhausted',
            message: '本轮终局视觉质量 Judge 已经调用过一次，不再重复评价。'
        };
    }
    if (budgetClass !== 'final_quality_diagnosis_repair') return undefined;
    if (ledger.finalQualityJudgeCallCount < 1) {
        return {
            code: 'agent_final_quality_diagnosis_repair_without_judge',
            message: '终局视觉质量 Judge 尚未形成首轮结果，不能单独发起诊断补全。'
        };
    }
    if (ledger.finalQualityDiagnosisRepairCallCount >= MAX_FINAL_QUALITY_DIAGNOSIS_REPAIR_CALLS) {
        return {
            code: 'agent_final_quality_diagnosis_repair_budget_exhausted',
            message: '本轮终局视觉质量诊断已经补全过一次，不再重复调用。'
        };
    }
    return visionPresentation
        ? readFinalQualityDiagnosisRepairVisionViolation({ ledger, ...visionPresentation })
        : undefined;
}

export function consumePerformanceModelBudgetClass(
    ledger: PerformanceLedgerState,
    budgetClass: PerformanceModelBudgetClass,
    visionPresentation?: { candidateCount: number; candidateKeys: readonly string[] }
): void {
    if (budgetClass === 'final_quality_judge') {
        ledger.finalQualityJudgeCallCount += 1;
        ledger.finalQualityJudgeVisionCandidateCount = Math.max(
            0,
            Math.floor(Number(visionPresentation?.candidateCount) || 0)
        );
        ledger.finalQualityJudgeVisionCandidateKeys = Array.from(new Set(
            (visionPresentation?.candidateKeys || [])
                .map((key) => String(key || '').trim())
                .filter(Boolean)
        )).sort();
    }
    if (budgetClass === 'final_quality_diagnosis_repair') {
        ledger.finalQualityDiagnosisRepairCallCount += 1;
    }
}

/**
 * 统一记录一次受 PerformancePolicy 管理的模型调用。普通任务视觉进入运行级视觉池；
 * Final Judge / diagnosis repair 只进入各自固定事件账本，避免跨 generation 恢复时
 * 把独立验收成本误判为普通执行额度已经耗尽。
 */
export function consumePerformanceModelCallUsage(
    ledger: PerformanceLedgerState,
    budgetClass: PerformanceModelBudgetClass,
    input: {
        visualAnalysis: boolean;
        billedVisionCandidateCount: number;
        visionCandidateKeys: readonly string[];
    }
): void {
    const billedVisionCandidateCount = Math.max(
        0,
        Math.floor(Number(input.billedVisionCandidateCount) || 0)
    );
    const normalizedObservationKeys = Array.from(new Set(
        input.visionCandidateKeys
            .map((key) => String(key || '').trim())
            .filter(Boolean)
    ));
    if (!isFinalQualityModelBudgetClass(budgetClass)) {
        ledger.modelCallCount += 1;
        if (input.visualAnalysis) ledger.visualAnalysisCount += 1;
        ledger.visionCandidateCount += billedVisionCandidateCount;
        for (const key of normalizedObservationKeys) {
            ledger.visionCandidateKeys.add(key);
        }
    }
    consumePerformanceModelBudgetClass(ledger, budgetClass, {
        candidateCount: billedVisionCandidateCount,
        candidateKeys: normalizedObservationKeys
    });
}

export function resolveFinalQualityDiagnosisRepairVisionAllowance(
    ledger: PerformanceLedgerState
): { hasFixedEventCapacity: boolean; remainingCandidateCount: number } {
    return {
        hasFixedEventCapacity: ledger.finalQualityJudgeVisionCandidateCount > 0,
        remainingCandidateCount: ledger.finalQualityJudgeVisionCandidateCount
    };
}

/**
 * 普通观察不能耗尽终局验收本身。Final Judge 每个 generation 只有一次，并继续受
 * Skill 声明的单次候选上限约束；这里不返还普通观察额度，也不授予第二次 Judge。
 */
export function resolveFinalQualityJudgeVisionAllowance(
    ledger: PerformanceLedgerState,
    maxVisionCandidates: number
): { hasFixedEventCapacity: boolean; remainingCandidateCount: number } {
    const normalizedLimit = Number.isFinite(maxVisionCandidates)
        ? Math.max(0, Math.floor(maxVisionCandidates))
        : 0;
    return {
        hasFixedEventCapacity: ledger.finalQualityJudgeCallCount < MAX_FINAL_QUALITY_JUDGE_CALLS
            && normalizedLimit > 0,
        remainingCandidateCount: normalizedLimit
    };
}

export function readFinalQualityDiagnosisRepairVisionViolation(input: {
    ledger: PerformanceLedgerState;
    candidateCount: number;
    candidateKeys: readonly string[];
}): PerformanceModelBudgetClassViolation | undefined {
    const expectedKeys = input.ledger.finalQualityJudgeVisionCandidateKeys;
    const actualKeys = Array.from(new Set(
        input.candidateKeys.map((key) => String(key || '').trim()).filter(Boolean)
    )).sort();
    const sameKeys = actualKeys.length === expectedKeys.length
        && actualKeys.every((key, index) => key === expectedKeys[index]);
    if (input.candidateCount === input.ledger.finalQualityJudgeVisionCandidateCount
        && input.candidateCount > 0
        && sameKeys) {
        return undefined;
    }
    return {
        code: 'agent_final_quality_diagnosis_repair_evidence_mismatch',
        message: '终局诊断补全只能重新查看首次 Judge 使用的同一组画面证据。'
    };
}

/**
 * 当前唯一 PerformanceLedger 的可序列化只读投影；不包含权限、质量或完成状态。
 * 字段均是可跨 generation 恢复的普通执行池用量；独立终审成本仍由 RuntimeAccounting
 * 的模型调用、Token、耗时和 prompt-shape imageBlocks 如实记录，不回灌成普通执行额度。
 */
export function projectPerformanceLedgerUsage(
    ledger: PerformanceLedgerState,
    iterations: number,
    nowMs = Date.now()
): RuntimePerformanceUsage {
    return {
        modelCalls: ledger.modelCallCount,
        toolCalls: ledger.toolCallCount,
        iterations: Math.max(0, Math.floor(iterations)),
        visionCandidates: ledger.visionCandidateCount,
        visualAnalyses: ledger.visualAnalysisCount,
        activeElapsedMs: readPerformanceActiveElapsedMs(ledger, nowMs),
        observationKeys: Array.from(ledger.visionCandidateKeys)
    };
}

export interface RestoredPerformanceLedgerUsage {
    ledger: PerformanceLedgerState;
    iterations: number;
}

/**
 * 把同一请求上一 Agent 的累计用量按 max/union 恢复到新账本。纯函数：不修改输入 ledger/usage；
 * seed 只能收紧剩余额度，不能授予 Tool、执行或完成权限。
 */
export function restorePerformanceLedgerUsage(
    ledger: PerformanceLedgerState,
    iterations: number,
    usage: RuntimePerformanceUsage | undefined
): RestoredPerformanceLedgerUsage {
    if (!usage) {
        return {
            ledger: {
                ...ledger,
                visionCandidateKeys: new Set(ledger.visionCandidateKeys),
                finalQualityJudgeVisionCandidateKeys: [
                    ...ledger.finalQualityJudgeVisionCandidateKeys
                ]
            },
            iterations
        };
    }
    const nonNegativeInteger = (value: unknown): number => (
        Math.max(0, Math.floor(Number(value) || 0))
    );
    const observationKeys = Array.from(new Set(
        (Array.isArray(usage.observationKeys) ? usage.observationKeys : [])
            .map((key) => String(key || '').trim())
            .filter(Boolean)
    ));
    return {
        ledger: {
            ...ledger,
            modelCallCount: Math.max(ledger.modelCallCount, nonNegativeInteger(usage.modelCalls)),
            toolCallCount: Math.max(ledger.toolCallCount, nonNegativeInteger(usage.toolCalls)),
            visionCandidateCount: Math.max(
                ledger.visionCandidateCount,
                nonNegativeInteger(usage.visionCandidates),
                observationKeys.length
            ),
            visualAnalysisCount: Math.max(
                ledger.visualAnalysisCount,
                nonNegativeInteger(usage.visualAnalyses)
            ),
            activeElapsedBeforeRunMs: Math.max(
                ledger.activeElapsedBeforeRunMs,
                nonNegativeInteger(usage.activeElapsedMs)
            ),
            finalQualityJudgeVisionCandidateKeys: [
                ...ledger.finalQualityJudgeVisionCandidateKeys
            ],
            visionCandidateKeys: new Set([
                ...ledger.visionCandidateKeys,
                ...observationKeys
            ])
        },
        iterations: Math.max(iterations, nonNegativeInteger(usage.iterations))
    };
}

/** 取走一次性「该动手了」提醒；没有待发提醒时返回 null。 */
export function takeObservationReserveAdvice(ledger: PerformanceLedgerState): string | null {
    if (!ledger.observationReserveAdviceDue) return null;
    ledger.observationReserveAdviceDue = false;
    return [
        '提醒：这一轮已经查看了不少画面和项目信息，还没有做出可以看的设计版本。',
        '如果手上的信息已经够做决定，就直接在正确目标文档上开始最小的设计写入，写完再看效果；',
        '如果确实还缺关键信息，可以继续查看，但请只看会改变下一步的内容。'
    ].join('');
}

export interface PerformanceBudgetExhaustion {
    dimension: 'model_calls' | 'tool_calls' | 'soft_time';
    code: string;
    message: string;
    limit: number;
    used: number;
}

export function applyPerformanceModelBudgetClassAllowance(
    ledger: PerformanceLedgerState,
    budgetClass: PerformanceModelBudgetClass,
    exhaustion: PerformanceBudgetExhaustion | undefined
): PerformanceBudgetExhaustion | undefined {
    if (exhaustion?.dimension !== 'model_calls') return exhaustion;
    if (budgetClass === 'final_quality_judge'
        && ledger.finalQualityJudgeCallCount < MAX_FINAL_QUALITY_JUDGE_CALLS) {
        return undefined;
    }
    if (budgetClass === 'final_quality_diagnosis_repair'
        && ledger.finalQualityDiagnosisRepairCallCount < MAX_FINAL_QUALITY_DIAGNOSIS_REPAIR_CALLS) {
        return undefined;
    }
    return exhaustion;
}

export function buildPerformanceBudgetExhaustionMessage(
    hasViewableDesignChange: boolean,
    _dimension: 'model_calls' | 'tool_calls' | 'soft_time',
    _limit: number,
    _used: number
): string {
    const outcome = hasViewableDesignChange
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
    hasViewableDesignChange?: boolean;
}): PerformanceBudgetExhaustion | undefined {
    const { ledger, budget } = input;
    if (!budget) return undefined;
    const hasViewableDesignChange = input.hasViewableDesignChange === true;
    const scope = input.scope ?? 'all';
    // 普通任务预算不为终局质量 Judge 事前扣减；Judge 的独立单次验收 allowance 与硬上限
    // 由 Agent 调用点按 budgetClass 处理，本纯账本函数仍只报告普通预算的真实耗尽状态。
    const effectiveSoftTimeBudgetMs = budget.softTimeBudgetMs;
    if (effectiveSoftTimeBudgetMs >= 0
        && ledger.runStartedAtMs > 0
        && input.elapsedMs >= effectiveSoftTimeBudgetMs) {
        return {
            dimension: 'soft_time',
            code: 'agent_soft_time_budget_exhausted',
            message: buildPerformanceBudgetExhaustionMessage(
                hasViewableDesignChange,
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
                hasViewableDesignChange,
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
                hasViewableDesignChange,
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
    /** 任意已观测 Photoshop mutation；供执行供给预留判断真实进展。 */
    hasObservedTaskMutation: boolean;
    /** 排除仅建空白文档后的用户可见设计改动；只用于诚实终态文案。 */
    hasViewableDesignChange: boolean;
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
        hasViewableDesignChange: input.reserveContext.hasViewableDesignChange
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
    // 尝试时的写前观察计数——
    // ①全运行总次数 PRE_DELIVERY_OBSERVATION_CALL_LIMIT；
    // ②预留区 allowance（尾部工具预算里的写入前观察数）。
    // 设计路径宪法（2026-08-17）：两条阈值到点后**不再拦截观察调用**，只向模型发一次
    // 「该动手了」的提醒。理由：观察多了是「说错 / 慢」，不是「做错」；真机里这条拦截与
    // 简报门禁、单工具 allowlist 恢复指令三面夹击造成数学必然死锁（run 466：19 轮零写入）。
    // 已有交付动作尝试后不再计数：写后读回与 unknown 现场确认必须始终放行。
    const reserveActive = input.reserveContext.authorizedMutationExpectation
        && !input.reserveContext.attemptedDeliveryAction;
    if (reserveActive) {
        const kind = classifyAgentToolExecution(input.toolName, input.toolArguments ?? {});
        const isObservationKind = kind === 'read_only_observation' || kind === 'knowledge_search';
        if (isObservationKind) {
            const overTotalLimit = ledger.preDeliveryObservationCallCount >= PRE_DELIVERY_OBSERVATION_CALL_LIMIT;
            const overReserveAllowance = isInMutationExecutionReserveZone({
                ledger,
                budget,
                authorizedMutationExpectation: input.reserveContext.authorizedMutationExpectation
            })
                && ledger.reserveZoneObservationCalls >= EXECUTION_RESERVE_OBSERVATION_ALLOWANCE;
            const issued = ledger.observationReserveAdviceIssuedCount;
            // 周期性提醒：每多看 PRE_DELIVERY_OBSERVATION_CALL_LIMIT 次再提醒一次，仍不拦截。
            const periodicDue = overTotalLimit
                && ledger.preDeliveryObservationCallCount >= PRE_DELIVERY_OBSERVATION_CALL_LIMIT * (issued + 1);
            const firstReserveDue = overReserveAllowance && issued === 0;
            if (periodicDue || firstReserveDue) {
                ledger.observationReserveAdviceIssuedCount = issued + 1;
                ledger.observationReserveAdviceDue = true;
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
