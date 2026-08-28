import type {
    DesignAgentOsAction,
    DesignAgentOsScenario,
    DesignIntentContext
} from './design-agent-os-contracts';
import {
    normalizeRuntimeDesignWorkMode,
    resolveSkillRuntimeManifestSelection,
    type SkillRuntimeManifestSelection
} from './agent-runtime-v5/skill-runtime';
import type {
    SkillRuntimePerformanceProfile
} from './agent-runtime-v5/contracts';
import type { RuntimePerformanceUsage } from './agent-runtime-v5/runtime-accounting';
import type {
    DesignTeamChildExecutionAllowance,
    DesignTeammateRole
} from './types/design-team.types';

export type AgentTaskClass =
    | 'chat'
    | 'simple-operation'
    | 'document-management'
    | 'layer-management'
    | 'text-editing'
    | 'copywriting'
    | 'project-inventory'
    | 'project-analysis'
    | 'skill-workflow'
    | 'unknown';

export type AgentVerificationTier =
    | 'none'
    | 'metadata'
    | 'bounds'
    | 'screenshot'
    | 'manual';

export type AgentLatencyClass = 'instant' | 'short' | 'medium' | 'long' | 'unknown';
export type AgentResourceRisk = 'low' | 'medium' | 'high';
export interface AgentPerformanceBudget {
    maxModelCalls: number;
    maxToolCalls: number;
    maxIterations: number;
    maxVisionCandidates: number;
    maxInitialVisionCandidates?: number;
    maxVisualAnalyses: number;
    maxFullResolutionImageReads: number;
    softTimeBudgetMs: number;
    /** 单次主循环模型输出硬上限；由 cost_profile 派生，不由业务文本猜测。 */
    maxPrimaryOutputTokens?: number;
    /** false 时即使用户全局开启思考，也不为本次轻量任务购买 provider thinking。 */
    allowProviderThinking?: boolean;
}

/** 单次主 Agent 模型请求的 inactivity window；请求级运行预算仍是总边界。 */
export const AGENT_MODEL_REQUEST_TIMEOUT_MS = 180_000;
/** 收尾提醒与可选完成态返工共同使用的最小模型回合数。 */
export const PERFORMANCE_CLOSURE_MODEL_TURN_RESERVE = 3;

export interface AgentExecutionCapacityMinimum {
    modelCalls: number;
    toolCalls: number;
    iterations: number;
    visionCandidates: number;
    visualAnalyses: number;
    timeMs: number;
}

/**
 * 已完成产物的可选改进不是“再试一次”，而是一段必须能够独立闭合的下一代执行：
 * 一轮定向修订、一轮同版本读回与交付、一轮终态结算；工具侧至少容纳 mutation、
 * 结构/画面读回、保存和导出。该下限只治理是否启动新 generation，不选择设计动作。
 */
export const AGENT_COMPLETED_ARTIFACT_REENTRY_MINIMUM: Readonly<AgentExecutionCapacityMinimum>
    = Object.freeze({
        modelCalls: PERFORMANCE_CLOSURE_MODEL_TURN_RESERVE,
        toolCalls: 4,
        iterations: PERFORMANCE_CLOSURE_MODEL_TURN_RESERVE,
        visionCandidates: 1,
        visualAnalyses: 1,
        timeMs: AGENT_MODEL_REQUEST_TIMEOUT_MS * PERFORMANCE_CLOSURE_MODEL_TURN_RESERVE
    });

export type AgentExecutionCapacityDimension =
    | 'model_calls'
    | 'tool_calls'
    | 'iterations'
    | 'vision_candidates'
    | 'visual_analyses'
    | 'active_time_ms';

export interface AgentExecutionCapacityRemaining {
    modelCalls: number;
    toolCalls: number;
    iterations: number;
    visionCandidates: number;
    visualAnalyses: number;
    timeMs: number;
}

export interface AgentExecutionCapacityAssessment {
    sufficient: boolean;
    remaining: AgentExecutionCapacityRemaining;
    deficits: AgentExecutionCapacityDimension[];
}

function readRemainingExecutionCapacity(limit: number, consumed: number): number {
    if (!Number.isFinite(limit) || !Number.isFinite(consumed) || consumed < 0) return 0;
    if (limit < 0) return Number.POSITIVE_INFINITY;
    const normalizedLimit = Math.max(0, Math.floor(limit));
    const normalizedConsumed = Math.floor(consumed);
    return Math.max(0, normalizedLimit - normalizedConsumed);
}

/**
 * 对同一请求账本做只读剩余容量证明。它不消费额度、不延长 deadline、不授予 Tool，
 * 也不根据任务品类或审美内容改变 minimum。
 */
export function evaluateAgentExecutionCapacity(input: {
    usage: Readonly<RuntimePerformanceUsage>;
    budget: Readonly<AgentPerformanceBudget>;
    minimum: Readonly<AgentExecutionCapacityMinimum>;
}): AgentExecutionCapacityAssessment {
    const remaining: AgentExecutionCapacityRemaining = {
        modelCalls: readRemainingExecutionCapacity(input.budget.maxModelCalls, input.usage.modelCalls),
        toolCalls: readRemainingExecutionCapacity(input.budget.maxToolCalls, input.usage.toolCalls),
        iterations: readRemainingExecutionCapacity(input.budget.maxIterations, input.usage.iterations),
        visionCandidates: readRemainingExecutionCapacity(
            input.budget.maxVisionCandidates,
            input.usage.visionCandidates
        ),
        visualAnalyses: readRemainingExecutionCapacity(
            input.budget.maxVisualAnalyses,
            input.usage.visualAnalyses
        ),
        timeMs: readRemainingExecutionCapacity(
            input.budget.softTimeBudgetMs,
            input.usage.activeElapsedMs
        )
    };
    const deficits: AgentExecutionCapacityDimension[] = [];
    if (remaining.modelCalls < input.minimum.modelCalls) deficits.push('model_calls');
    if (remaining.toolCalls < input.minimum.toolCalls) deficits.push('tool_calls');
    if (remaining.iterations < input.minimum.iterations) deficits.push('iterations');
    if (remaining.visionCandidates < input.minimum.visionCandidates) deficits.push('vision_candidates');
    if (remaining.visualAnalyses < input.minimum.visualAnalyses) deficits.push('visual_analyses');
    if (remaining.timeMs < input.minimum.timeMs) deficits.push('active_time_ms');
    return {
        sufficient: deficits.length === 0,
        remaining,
        deficits
    };
}

/** Agent 核心只拥有跨 Skill 的资源安全上限，不拥有任何业务品类预算。 */
export const AGENT_GLOBAL_SKILL_BUDGET_LIMITS: Readonly<AgentPerformanceBudget> = Object.freeze({
    // 模型调用是 ReAct 循环里每一轮的驱动（每轮≈1 次模型调用）。此前上限 12 远低于
    // max_iterations(100) 与各技能 soft_time_budget(≥240s)，导致 model_calls 永远先触顶，
    // 完整 v5 纪律流程（R0→E2 八阶段 + 声明 + 执行 + 复核）还没到执行就被这个人为低顶饿死。
    // 抬到 30，让「时间预算」或「真实完成」成为约束，而不是一个过低的模型调用数。
    // 2026-08-17 再抬到 40 / 15 分钟：预算是防失控的安全网，不是正常终止器——一次真实的详情页
    // 设计（十余屏、几十个图层动作、写后回看）本就需要几十轮，被预算掐断的运行占全部真机运行
    // 的 17%（performance_budget 58 + tool_budget 21 / 469）。真正的停机条件应是「做完了」或
    // 「无进展」，其余交给续跑与上下文压缩。
    // 2026-08-23 详情页死亡样本定罪：真凶是时间硬终止而非迭代失控（远未及 max_iterations），
    // manifest 已提到 56 次 / 30 分钟；安全网同步抬到 64 / 30 分钟，保持「全局管安全、manifest 管收紧」。
    maxModelCalls: 64,
    maxToolCalls: 200,
    maxIterations: 100,
    // 全局上限只负责资源安全，具体 Skill 仍由 manifest 收紧。长详情页需要允许
    // “首轮逐屏复核 + 一次有界修订复核”，否则首轮刚好耗尽预算后无法验证修复。
    maxVisionCandidates: 40,
    maxVisualAnalyses: 10,
    maxFullResolutionImageReads: 0,
    softTimeBudgetMs: 1_800_000,
    maxPrimaryOutputTokens: 8192,
    allowProviderThinking: true
});

/**
 * 复合子执行启动后，父 Agent 必须保留的最小收尾资源。
 *
 * - 3 次模型调用：消费复合结果、必要的最终读回回合，以及最终总结/视觉判断；
 * - 2 次工具调用：最终结构与画面读回；
 * - 1 次视觉分析 + 1 个视觉候选：保留父级最终画面判断；
 * - 2 个后续迭代：复合 Tool 所在回合结束后仍能“读回 → 总结”；
 * - 90 秒：与当前单次 Agent 模型请求 timeout 对齐。
 *
 * 这是事前分区，不是事后从父 Agent 倒扣子 Agent 的实际消耗。
 */
export const AGENT_FINALIZATION_TIME_RESERVE_MS = 90_000;

export const AGENT_COMPOUND_FINALIZATION_RESERVE = Object.freeze({
    modelCalls: 3,
    toolCalls: 2,
    visualAnalyses: 1,
    visionCandidates: 1,
    iterations: 2,
    timeMs: AGENT_FINALIZATION_TIME_RESERVE_MS
});

export interface DesignTeamRoleExecutionMinimum {
    modelCalls: number;
    toolCalls: number;
}

/**
 * Design Team 单个角色能够完成一次有意义调用的最小模型/工具切片。
 *
 * executor 的四个模型回合对应 read → write → post-write readback → finalize，
 * 三次工具额度对应读取、写入与写后读回。其余角色至少保留一次取证/检索与一次
 * 消费结果并收尾的模型回合。helper 与 coordinator 必须共用此处，禁止各自猜权重。
 */
export const DESIGN_TEAM_ROLE_EXECUTION_MINIMUMS: Readonly<Record<
    DesignTeammateRole,
    Readonly<DesignTeamRoleExecutionMinimum>
>> = Object.freeze({
    'scene-analyst': Object.freeze({ modelCalls: 2, toolCalls: 1 }),
    'market-researcher': Object.freeze({ modelCalls: 2, toolCalls: 1 }),
    copywriter: Object.freeze({ modelCalls: 2, toolCalls: 1 }),
    'design-strategist': Object.freeze({ modelCalls: 2, toolCalls: 1 }),
    executor: Object.freeze({ modelCalls: 4, toolCalls: 3 }),
    critic: Object.freeze({ modelCalls: 2, toolCalls: 1 })
});

export interface DesignTeamRoleExecutionRequirement {
    agentCalls: number;
    modelCalls: number;
    toolCalls: number;
}

export function getDesignTeamRoleExecutionMinimum(
    role: DesignTeammateRole
): Readonly<DesignTeamRoleExecutionMinimum> {
    return DESIGN_TEAM_ROLE_EXECUTION_MINIMUMS[role];
}

export function sumDesignTeamRoleExecutionRequirements(
    roles: readonly DesignTeammateRole[]
): DesignTeamRoleExecutionRequirement {
    return roles.reduce<DesignTeamRoleExecutionRequirement>((requirement, role) => {
        const minimum = getDesignTeamRoleExecutionMinimum(role);
        return {
            agentCalls: requirement.agentCalls + 1,
            modelCalls: requirement.modelCalls + minimum.modelCalls,
            toolCalls: requirement.toolCalls + minimum.toolCalls
        };
    }, {
        agentCalls: 0,
        modelCalls: 0,
        toolCalls: 0
    });
}

/** 基础阶段顺序的共享真相源；可选市场/文案只在现有 role plan 选中时加入。 */
export function resolveDesignTeamRequiredBaseRoles(
    plannedRoles: readonly DesignTeammateRole[] | undefined
): DesignTeammateRole[] {
    const plannedRoleSet = new Set(plannedRoles || []);
    return [
        'scene-analyst',
        ...(plannedRoleSet.has('market-researcher')
            ? ['market-researcher' as const]
            : []),
        ...(plannedRoleSet.has('copywriter') ? ['copywriter' as const] : []),
        'design-strategist',
        'executor',
        'critic'
    ];
}

export interface AgentCompoundExecutionUsageSnapshot {
    /** 已包含发起复合 Tool 的本轮父模型调用。 */
    modelCalls: number;
    /** 已包含复合 Tool 自身在父账本中的一次 Tool 调用。 */
    toolCalls: number;
    visualAnalyses: number;
    visionCandidates: number;
    /** 已包含当前正在派发复合 Tool 的父循环迭代。 */
    iterations: number;
}

export interface BuildDesignTeamChildExecutionReservationInput {
    /** AgentConfig 中的实时性能预算；迭代 ceiling 由 parentMaxIterations 单独传入。 */
    parentBudget: Omit<AgentPerformanceBudget, 'maxIterations'>;
    /** Agent 当前真实 maxIterations；可能比 PerformancePolicy 的原始值更紧。 */
    parentMaxIterations: number;
    parentUsage: AgentCompoundExecutionUsageSnapshot;
    /** 当前请求跨 generation 累计的活跃执行时长，不含代间等待。 */
    parentActiveElapsedMs: number;
    plannedRoles?: readonly DesignTeammateRole[];
    maxRevisions?: number;
    /** 测试可注入；生产默认 Date.now()。 */
    nowMs?: number;
}

export interface BuildDesignTeamSingleRoleExecutionReservationInput {
    parentBudget: Omit<AgentPerformanceBudget, 'maxIterations'>;
    parentMaxIterations: number;
    parentUsage: AgentCompoundExecutionUsageSnapshot;
    parentActiveElapsedMs: number;
    role: DesignTeammateRole;
    nowMs?: number;
}

export interface AgentCompoundParentFinalizationLimits {
    /** 用于证明原总 ceiling 仍容纳父级收尾 reserve；不得据此二次收紧父 ceiling。 */
    maxModelCalls: number;
    maxToolCalls: number;
    maxVisualAnalyses: number;
    maxVisionCandidates: number;
    maxIterations: number;
}

interface DesignTeamChildExecutionReservationBase {
    requiredBaseAgentCalls: number;
    plannedAgentCallCeiling: number;
}

export interface ReadyDesignTeamChildExecutionReservation
    extends DesignTeamChildExecutionReservationBase {
    status: 'ready';
    allowance: DesignTeamChildExecutionAllowance;
    parentFinalizationLimits: AgentCompoundParentFinalizationLimits;
}

export interface BlockedDesignTeamChildExecutionReservation
    extends DesignTeamChildExecutionReservationBase {
    status: 'blocked';
    code:
        | 'parent_finalization_reserve_unavailable'
        | 'design_team_child_deadline_unavailable'
        | 'design_team_child_allowance_insufficient';
    reason: string;
}

export type DesignTeamChildExecutionReservation =
    | ReadyDesignTeamChildExecutionReservation
    | BlockedDesignTeamChildExecutionReservation;

export interface AgentCostProfile {
    modelCallClass: 'none' | 'text-light' | 'text-heavy' | 'vision-light' | 'vision-heavy';
    photoshopToolClass: 'none' | 'read-only' | 'write-light' | 'write-heavy';
    imageProcessingClass: 'none' | 'metadata-only' | 'bounded-vision' | 'pixel-probe' | 'heavy-local';
    expectedLatency: AgentLatencyClass;
    resourceRisk: AgentResourceRisk;
}

export interface AgentModelCallCostControls {
    maxPrimaryOutputTokens: number;
    allowProviderThinking: boolean;
}

/**
 * 将 Manifest 的 cost_profile 变成真实 provider 调用约束。
 * 轻量任务关闭额外思考并限制输出；完整创意任务保留既有截断恢复窗口。
 */
export function resolveAgentModelCallCostControls(
    modelCallClass: AgentCostProfile['modelCallClass']
): AgentModelCallCostControls {
    switch (modelCallClass) {
        case 'none':
            return { maxPrimaryOutputTokens: 800, allowProviderThinking: false };
        case 'text-light':
            return { maxPrimaryOutputTokens: 1200, allowProviderThinking: false };
        case 'text-heavy':
            return { maxPrimaryOutputTokens: 4096, allowProviderThinking: true };
        case 'vision-heavy':
        case 'vision-light':
        default:
            return { maxPrimaryOutputTokens: 8192, allowProviderThinking: true };
    }
}

export interface AgentRuntimeBudget {
    budgetVersion: 'agent-runtime-budget/v0';
    maxIterations: number;
    source: 'explicit-user-parameter' | 'legacy-autonomous-agent-default' | 'stage-autonomous-agent-default';
    limitations: string[];
}

export interface AgentDesignTeamRuntimeBudget {
    budgetVersion: 'agent-design-team-runtime-budget/v0';
    role: DesignTeammateRole;
    maxIterations: number;
    source: 'explicit-user-parameter' | 'teammate-role-default';
    limitations: string[];
}

export interface AgentProviderTokenBudget {
    budgetVersion: 'agent-provider-token-budget/v0';
    maxTokens: number;
    source: 'explicit-user-parameter' | 'legacy-provider-default';
    limitations: string[];
}

export interface AgentContextWindowBudget {
    budgetVersion: 'agent-context-window-budget/v0';
    maxTokens: number;
    keepRecentRounds: number;
    source: 'explicit-user-parameter' | 'legacy-context-manager-default';
    limitations: string[];
}

export interface AgentResourceCacheBudget {
    budgetVersion: 'agent-resource-cache-budget/v0';
    resourceScanCacheTtlMs: number;
    psdPreviewCacheTtlMs: number;
    source: 'agent-performance-policy';
    limitations: string[];
}

export interface AgentAcceptanceCaptureBudget {
    budgetVersion: 'agent-acceptance-capture-budget/v0';
    mode: 'light' | 'standard' | 'bulk' | 'deep';
    maxLayers: number;
    timeoutMs: number;
    maxChangedLayers: number;
    source: 'agent-performance-policy';
    limitations: string[];
}

export interface AgentPerformancePolicy {
    policyVersion: 'agent-performance-policy/v0';
    taskClass: AgentTaskClass;
    scenario: DesignAgentOsScenario;
    action: DesignAgentOsAction;
    budget: AgentPerformanceBudget;
    verificationTier: AgentVerificationTier;
    costProfile: AgentCostProfile;
    profileSource: {
        owner: 'agent-core' | 'skill-manifest';
        ref: string;
    };
    controls: {
        allowProviderStreaming: boolean;
        allowVisionModel: boolean;
        allowBulkProjectScan: boolean;
        allowFullResolutionImageRead: boolean;
        preferMetadataOnly: boolean;
        preferToolBatching: boolean;
        requireContextSnapshotBeforeExecution: boolean;
    };
    warnings: string[];
    limitations: string[];
}

export interface BuildAutonomousAgentRuntimeBudgetInput {
    requestedMaxIterations?: unknown;
    defaultMaxIterations?: unknown;
    defaultSource?: 'legacy-autonomous-agent-default' | 'stage-autonomous-agent-default';
}

export interface BuildDesignTeamRuntimeBudgetInput {
    role: DesignTeammateRole;
    requestedMaxIterations?: unknown;
}

export interface BuildAgentProviderTokenBudgetInput {
    requestedMaxTokens?: unknown;
    legacyDefaultMaxTokens?: unknown;
}

export interface BuildAgentContextWindowBudgetInput {
    requestedMaxTokens?: unknown;
    requestedKeepRecentRounds?: unknown;
}

export interface BuildAgentResourceCacheBudgetInput {
    requestedResourceScanCacheTtlMs?: unknown;
    requestedPsdPreviewCacheTtlMs?: unknown;
}

export interface BuildAgentAcceptanceCaptureBudgetInput {
    deep?: boolean;
    bulk?: boolean;
    /** 轻量结构写（排序/改名/编组/剪切关系）：层级+bounds 足以验证，砍层数与超时（deep/bulk 优先于它） */
    light?: boolean;
    maxChangedLayers?: unknown;
}

export interface BuildAgentPerformancePolicyInput {
    userText?: string;
    scenario?: DesignAgentOsScenario;
    action?: DesignAgentOsAction;
    skillId?: string;
    taskType?: string;
    workMode?: string;
    mode?: string;
    skillParams?: Record<string, unknown>;
    hasAttachedImage?: boolean;
    requiresPhotoshop?: boolean;
    projectImageCount?: number;
    visualSamplingCandidateCount?: number;
}

function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

function normalizeSkillParam(input: BuildAgentPerformancePolicyInput, key: string): string {
    return normalizeText(input.skillParams?.[key]);
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.round(parsed)));
}

function normalizeCompoundBudgetCount(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.floor(parsed);
}

/**
 * 在完整 Design Team 真正启动前，把父 Agent 剩余预算一次性分成：
 *
 * 1. 父级 finalization reserve 的可用性证明（保留原总 ceiling，不二次收紧）；
 * 2. 子流水线 allowance（唯一允许下发给 coordinator 的预算投影）。
 *
 * 分区一经提交不按子 Agent 的事后实际消耗退款；这能保证流水线失败或取消后，
 * 父 Agent 仍有稳定的读回与总结额度，也避免嵌套账本返回后再倒扣造成瞬时耗尽。
 */
export function buildDesignTeamChildExecutionReservation(
    input: BuildDesignTeamChildExecutionReservationInput
): DesignTeamChildExecutionReservation {
    const budget = input.parentBudget;
    const usage = {
        modelCalls: normalizeCompoundBudgetCount(input.parentUsage.modelCalls),
        toolCalls: normalizeCompoundBudgetCount(input.parentUsage.toolCalls),
        visualAnalyses: normalizeCompoundBudgetCount(input.parentUsage.visualAnalyses),
        visionCandidates: normalizeCompoundBudgetCount(input.parentUsage.visionCandidates),
        iterations: normalizeCompoundBudgetCount(input.parentUsage.iterations)
    };
    const maxIterations = normalizeCompoundBudgetCount(input.parentMaxIterations);
    const requiredBaseRoles = resolveDesignTeamRequiredBaseRoles(input.plannedRoles);
    const requiredBaseExecution = sumDesignTeamRoleExecutionRequirements(requiredBaseRoles);
    const requiredBaseAgentCalls = requiredBaseExecution.agentCalls;
    const requiredBaseModelCalls = requiredBaseExecution.modelCalls;
    const requiredBaseToolCalls = requiredBaseExecution.toolCalls;
    const maxRevisions = clampInt(input.maxRevisions, 1, 0, 2);
    // 当前 coordinator 的单轮最宽修订路线为 3 个 owner 角色 + 1 次 critic 复审。
    const plannedAgentCallCeiling = requiredBaseAgentCalls + maxRevisions * 4;
    const parentFinalizationLimits: AgentCompoundParentFinalizationLimits = {
        maxModelCalls: usage.modelCalls + AGENT_COMPOUND_FINALIZATION_RESERVE.modelCalls,
        maxToolCalls: usage.toolCalls + AGENT_COMPOUND_FINALIZATION_RESERVE.toolCalls,
        maxVisualAnalyses:
            usage.visualAnalyses + AGENT_COMPOUND_FINALIZATION_RESERVE.visualAnalyses,
        maxVisionCandidates:
            usage.visionCandidates + AGENT_COMPOUND_FINALIZATION_RESERVE.visionCandidates,
        maxIterations: usage.iterations + AGENT_COMPOUND_FINALIZATION_RESERVE.iterations
    };
    const finalizationReserveAvailable = (
        parentFinalizationLimits.maxModelCalls <= normalizeCompoundBudgetCount(budget.maxModelCalls)
        && parentFinalizationLimits.maxToolCalls <= normalizeCompoundBudgetCount(budget.maxToolCalls)
        && parentFinalizationLimits.maxVisualAnalyses
            <= normalizeCompoundBudgetCount(budget.maxVisualAnalyses)
        && parentFinalizationLimits.maxVisionCandidates
            <= normalizeCompoundBudgetCount(budget.maxVisionCandidates)
        && parentFinalizationLimits.maxIterations <= maxIterations
    );
    if (!finalizationReserveAvailable) {
        return {
            status: 'blocked',
            code: 'parent_finalization_reserve_unavailable',
            reason: '父 Agent 剩余预算不足以保留结果消费、最终读回和总结额度；完整团队流水线未启动。',
            requiredBaseAgentCalls,
            plannedAgentCallCeiling
        };
    }

    const parentActiveElapsedMs = Number(input.parentActiveElapsedMs);
    const nowMs = input.nowMs === undefined ? Date.now() : Number(input.nowMs);
    const softTimeBudgetMs = normalizeCompoundBudgetCount(budget.softTimeBudgetMs);
    const deadlineAtMs = Math.floor(
        nowMs
        + softTimeBudgetMs
        - parentActiveElapsedMs
        - AGENT_COMPOUND_FINALIZATION_RESERVE.timeMs
    );
    if (!Number.isFinite(parentActiveElapsedMs)
        || parentActiveElapsedMs < 0
        || !Number.isFinite(nowMs)
        || deadlineAtMs <= nowMs) {
        return {
            status: 'blocked',
            code: 'design_team_child_deadline_unavailable',
            reason: '父 Agent 的剩余时间只够保留最终读回与总结；完整团队流水线未启动。',
            requiredBaseAgentCalls,
            plannedAgentCallCeiling
        };
    }

    const maxModelCalls = Math.min(
        normalizeCompoundBudgetCount(budget.maxModelCalls)
            - parentFinalizationLimits.maxModelCalls,
        maxIterations - parentFinalizationLimits.maxIterations
    );
    const maxToolCalls = normalizeCompoundBudgetCount(budget.maxToolCalls)
        - parentFinalizationLimits.maxToolCalls;
    const plannedVisualStageCeiling = requiredBaseRoles.includes('critic') ? 1 : 0;
    // Team 只拥有一次低成本视觉咨询槽，reserveStageGroupBudgets 会确定性把它留给
    // 最后的 Critic；scene 与修订复审不再重复传图。完整像素集合仍以可信 ReviewSet
    // 交给父 R5，由 Evaluation Profile 唯一完整看图、唯一拥有终局 Verdict。
    const maxVisualAnalyses = Math.min(
        normalizeCompoundBudgetCount(budget.maxVisualAnalyses)
            - parentFinalizationLimits.maxVisualAnalyses,
        plannedVisualStageCeiling
    );
    const maxVisionCandidates = Math.min(
        normalizeCompoundBudgetCount(budget.maxVisionCandidates)
            - parentFinalizationLimits.maxVisionCandidates,
        plannedVisualStageCeiling
    );
    const minimumRoleModelCalls = Math.min(
        ...Object.values(DESIGN_TEAM_ROLE_EXECUTION_MINIMUMS)
            .map((minimum) => minimum.modelCalls)
    );
    const minimumRoleToolCalls = Math.min(
        ...Object.values(DESIGN_TEAM_ROLE_EXECUTION_MINIMUMS)
            .map((minimum) => minimum.toolCalls)
    );
    const maxAgentCalls = Math.min(
        plannedAgentCallCeiling,
        Math.floor(maxModelCalls / minimumRoleModelCalls),
        Math.floor(maxToolCalls / minimumRoleToolCalls)
    );
    if (maxAgentCalls < requiredBaseAgentCalls
        || maxModelCalls < requiredBaseModelCalls
        || maxToolCalls < requiredBaseToolCalls) {
        return {
            status: 'blocked',
            code: 'design_team_child_allowance_insufficient',
            reason: `子执行额度不足以完整启动 ${requiredBaseAgentCalls} 个必需团队阶段（至少 ${requiredBaseModelCalls} 次模型调用、${requiredBaseToolCalls} 次工具调用）；完整团队流水线未启动。`,
            requiredBaseAgentCalls,
            plannedAgentCallCeiling
        };
    }

    return {
        status: 'ready',
        allowance: {
            maxAgentCalls,
            maxModelCalls,
            maxToolCalls,
            maxVisualAnalyses,
            maxVisionCandidates,
            ...(Number.isFinite(Number(budget.maxPrimaryOutputTokens))
                && Number(budget.maxPrimaryOutputTokens) > 0
                ? { maxPrimaryOutputTokens: Math.floor(Number(budget.maxPrimaryOutputTokens)) }
                : {}),
            ...(typeof budget.allowProviderThinking === 'boolean'
                ? { allowProviderThinking: budget.allowProviderThinking }
                : {}),
            deadlineAtMs
        },
        parentFinalizationLimits,
        requiredBaseAgentCalls,
        plannedAgentCallCeiling
    };
}

/**
 * 单角色委派与完整流水线共用父预算 owner，但只提交该角色的最小有意义切片。
 * 分区提交后不退款；父 ceiling 扣除这份 allowance，防止子 Agent 成本在父账本外增长。
 */
export function buildDesignTeamSingleRoleExecutionReservation(
    input: BuildDesignTeamSingleRoleExecutionReservationInput
): DesignTeamChildExecutionReservation {
    const budget = input.parentBudget;
    const usage = {
        modelCalls: normalizeCompoundBudgetCount(input.parentUsage.modelCalls),
        toolCalls: normalizeCompoundBudgetCount(input.parentUsage.toolCalls),
        visualAnalyses: normalizeCompoundBudgetCount(input.parentUsage.visualAnalyses),
        visionCandidates: normalizeCompoundBudgetCount(input.parentUsage.visionCandidates),
        iterations: normalizeCompoundBudgetCount(input.parentUsage.iterations)
    };
    const maxIterations = normalizeCompoundBudgetCount(input.parentMaxIterations);
    const minimum = getDesignTeamRoleExecutionMinimum(input.role);
    const visualEligible = input.role === 'scene-analyst' || input.role === 'critic';
    const canAllocateVisual = visualEligible
        && usage.visualAnalyses + AGENT_COMPOUND_FINALIZATION_RESERVE.visualAnalyses + 1
            <= normalizeCompoundBudgetCount(budget.maxVisualAnalyses)
        && usage.visionCandidates + AGENT_COMPOUND_FINALIZATION_RESERVE.visionCandidates + 1
            <= normalizeCompoundBudgetCount(budget.maxVisionCandidates);
    const childVisualAnalyses = canAllocateVisual ? 1 : 0;
    const childVisionCandidates = canAllocateVisual ? 1 : 0;
    const parentFinalizationLimits: AgentCompoundParentFinalizationLimits = {
        maxModelCalls: normalizeCompoundBudgetCount(budget.maxModelCalls) - minimum.modelCalls,
        maxToolCalls: normalizeCompoundBudgetCount(budget.maxToolCalls) - minimum.toolCalls,
        maxVisualAnalyses:
            normalizeCompoundBudgetCount(budget.maxVisualAnalyses) - childVisualAnalyses,
        maxVisionCandidates:
            normalizeCompoundBudgetCount(budget.maxVisionCandidates) - childVisionCandidates,
        maxIterations: maxIterations - minimum.modelCalls
    };
    const finalizationReserveAvailable = (
        parentFinalizationLimits.maxModelCalls
            >= usage.modelCalls + AGENT_COMPOUND_FINALIZATION_RESERVE.modelCalls
        && parentFinalizationLimits.maxToolCalls
            >= usage.toolCalls + AGENT_COMPOUND_FINALIZATION_RESERVE.toolCalls
        && parentFinalizationLimits.maxVisualAnalyses
            >= usage.visualAnalyses + AGENT_COMPOUND_FINALIZATION_RESERVE.visualAnalyses
        && parentFinalizationLimits.maxVisionCandidates
            >= usage.visionCandidates + AGENT_COMPOUND_FINALIZATION_RESERVE.visionCandidates
        && parentFinalizationLimits.maxIterations
            >= usage.iterations + AGENT_COMPOUND_FINALIZATION_RESERVE.iterations
    );
    if (!finalizationReserveAvailable) {
        return {
            status: 'blocked',
            code: 'parent_finalization_reserve_unavailable',
            reason: `父 Agent 剩余预算不足以委派 ${input.role} 并保留最终读回与总结；本次委派未启动。`,
            requiredBaseAgentCalls: 1,
            plannedAgentCallCeiling: 1
        };
    }

    const parentActiveElapsedMs = Number(input.parentActiveElapsedMs);
    const nowMs = input.nowMs === undefined ? Date.now() : Number(input.nowMs);
    const deadlineAtMs = Math.floor(
        nowMs
        + normalizeCompoundBudgetCount(budget.softTimeBudgetMs)
        - parentActiveElapsedMs
        - AGENT_COMPOUND_FINALIZATION_RESERVE.timeMs
    );
    if (!Number.isFinite(parentActiveElapsedMs)
        || parentActiveElapsedMs < 0
        || !Number.isFinite(nowMs)
        || deadlineAtMs <= nowMs) {
        return {
            status: 'blocked',
            code: 'design_team_child_deadline_unavailable',
            reason: '父 Agent 的剩余时间只够最终读回与总结；本次单角色委派未启动。',
            requiredBaseAgentCalls: 1,
            plannedAgentCallCeiling: 1
        };
    }

    return {
        status: 'ready',
        allowance: {
            maxAgentCalls: 1,
            maxModelCalls: minimum.modelCalls,
            maxToolCalls: minimum.toolCalls,
            maxVisualAnalyses: childVisualAnalyses,
            maxVisionCandidates: childVisionCandidates,
            ...(Number.isFinite(Number(budget.maxPrimaryOutputTokens))
                && Number(budget.maxPrimaryOutputTokens) > 0
                ? { maxPrimaryOutputTokens: Math.floor(Number(budget.maxPrimaryOutputTokens)) }
                : {}),
            ...(typeof budget.allowProviderThinking === 'boolean'
                ? { allowProviderThinking: budget.allowProviderThinking }
                : {}),
            deadlineAtMs
        },
        parentFinalizationLimits,
        requiredBaseAgentCalls: 1,
        plannedAgentCallCeiling: 1
    };
}

function resolveRuntimeIterationLimit(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

function defaultDesignTeamIterationLimit(role: DesignTeammateRole): number {
    switch (role) {
        case 'executor':
            return 12;
        case 'scene-analyst':
        case 'design-strategist':
        case 'critic':
            return 8;
        default:
            return 8;
    }
}

function resolveProviderMaxTokens(value: unknown, fallback: unknown = 4096): number {
    const fallbackNumeric = Number(fallback);
    const defaultValue = Number.isFinite(fallbackNumeric) && fallbackNumeric > 0
        ? fallbackNumeric
        : 4096;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric === 0) return defaultValue;
    return numeric;
}

function resolvePositiveInt(value: unknown, fallback: number, min: number, max: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
    return Math.max(min, Math.min(max, Math.round(numeric)));
}

function resolveAcceptanceChangedLayerLimit(value: unknown): number {
    return Math.max(1, Number(value ?? 50));
}

interface ResolvedSkillPerformanceProfile {
    manifests: SkillRuntimeManifestSelection['manifests'];
    profile: SkillRuntimePerformanceProfile;
    sourceRef: string;
}

function highestRankedValue<T extends string>(
    values: readonly T[],
    ranking: readonly T[]
): T {
    return values.reduce((highest, current) => (
        ranking.indexOf(current) > ranking.indexOf(highest) ? current : highest
    ));
}

function combineSkillPerformanceProfiles(
    profiles: readonly SkillRuntimePerformanceProfile[]
): SkillRuntimePerformanceProfile {
    const maxBudget = (
        key: Exclude<
            keyof SkillRuntimePerformanceProfile['budget'],
            'max_initial_vision_candidates'
        >
    ): number => (
        Math.max(...profiles.map((profile) => profile.budget[key]))
    );
    return {
        version: 'skill-runtime-performance-profile/v0',
        budget: {
            max_model_calls: maxBudget('max_model_calls'),
            max_tool_calls: maxBudget('max_tool_calls'),
            max_iterations: maxBudget('max_iterations'),
            max_vision_candidates: maxBudget('max_vision_candidates'),
            max_initial_vision_candidates: Math.min(
                ...profiles.map((profile) => (
                    profile.budget.max_initial_vision_candidates
                        ?? Math.min(5, profile.budget.max_vision_candidates)
                ))
            ),
            max_visual_analyses: maxBudget('max_visual_analyses'),
            max_full_resolution_image_reads: maxBudget('max_full_resolution_image_reads'),
            soft_time_budget_ms: maxBudget('soft_time_budget_ms')
        },
        verification_tier: highestRankedValue(
            profiles.map((profile) => profile.verification_tier),
            ['none', 'metadata', 'bounds', 'screenshot', 'manual']
        ),
        cost_profile: {
            model_call_class: highestRankedValue(
                profiles.map((profile) => profile.cost_profile.model_call_class),
                ['none', 'text-light', 'text-heavy', 'vision-light', 'vision-heavy']
            ),
            photoshop_tool_class: highestRankedValue(
                profiles.map((profile) => profile.cost_profile.photoshop_tool_class),
                ['none', 'read-only', 'write-light', 'write-heavy']
            ),
            image_processing_class: highestRankedValue(
                profiles.map((profile) => profile.cost_profile.image_processing_class),
                ['none', 'metadata-only', 'bounded-vision', 'pixel-probe', 'heavy-local']
            ),
            expected_latency: highestRankedValue(
                profiles.map((profile) => profile.cost_profile.expected_latency),
                ['instant', 'short', 'medium', 'long', 'unknown']
            ),
            resource_risk: highestRankedValue(
                profiles.map((profile) => profile.cost_profile.resource_risk),
                ['low', 'medium', 'high']
            )
        },
        vision_policy: profiles.some((profile) => profile.vision_policy === 'bounded')
            ? 'bounded'
            : 'disabled'
    };
}

function resolveSkillPerformanceProfile(
    input: BuildAgentPerformancePolicyInput
): {
    selection: SkillRuntimeManifestSelection;
    resolved?: ResolvedSkillPerformanceProfile;
} {
    const selection = resolveSkillRuntimeManifestSelection({
        skillId: normalizeText(input.skillId),
        taskType: normalizeText(input.taskType)
    });
    if (selection.status !== 'resolved') return { selection };
    const workMode = normalizeRuntimeDesignWorkMode(
        input.workMode || input.skillParams?.workMode || input.skillParams?.declaredWorkMode
    );
    const modeOwnedProfile = workMode
        ? selection.artifactManifest?.work_mode_contracts?.[workMode]?.performance_profile
        : undefined;
    if (modeOwnedProfile && selection.artifactManifest) {
        return {
            selection,
            resolved: {
                manifests: selection.manifests,
                profile: modeOwnedProfile,
                // workMode profile 是本 TaskRun 的硬 ceiling；方法 Manifest 只能在它内部工作，
                // 不得用 MAX 合并把局部编辑重新放大成完整创意预算。
                sourceRef: `${selection.artifactManifest.skill_id}@${selection.artifactManifest.version}#${workMode}`
            }
        };
    }
    const profiles = selection.manifests
        .map((manifest) => {
            const modeProfile = manifest === selection.artifactManifest && workMode
                ? manifest.work_mode_contracts?.[workMode]?.performance_profile
                : undefined;
            return modeProfile || manifest.performance_profile;
        })
        .filter((profile): profile is SkillRuntimePerformanceProfile => Boolean(profile));
    if (profiles.length === 0) return { selection };
    return {
        selection,
        resolved: {
            manifests: selection.manifests,
            profile: combineSkillPerformanceProfiles(profiles),
            sourceRef: selection.manifests
                .map((manifest) => {
                    const modeRef = manifest === selection.artifactManifest && workMode
                        ? `#${workMode}`
                        : '';
                    return `${manifest.skill_id}@${manifest.version}${modeRef}`;
                })
                .join('+')
        }
    };
}

function inferTaskClass(
    input: BuildAgentPerformancePolicyInput,
    resolvedProfile?: ResolvedSkillPerformanceProfile
): AgentTaskClass {
    const text = normalizeText(input.userText);
    const skillId = normalizeText(input.skillId);
    const scenario = input.scenario || 'unknown';
    const action = input.action || 'unknown';
    const mode = normalizeText(input.mode);
    const analysisMode = normalizeSkillParam(input, 'analysisMode') || mode;
    const focus = normalizeSkillParam(input, 'focus');
    const sampleSize = Number(input.skillParams?.sampleSize);

    if (skillId === 'project-image-analysis') {
        if (analysisMode === 'inventory' || focus === 'inventory' || sampleSize === 0) {
            return 'project-inventory';
        }
        return 'project-analysis';
    }
    // 一旦 R0 已选中带性能画像的业务 Manifest，预算与验收就必须由该 Skill 所有。
    // 用户文本中的“改文案 / 保存”等局部动作不能把整个业务工作流降级成 Agent 核心轻量档。
    if (resolvedProfile) {
        return 'skill-workflow';
    }
    if (action === 'chat' || (!input.requiresPhotoshop && scenario === 'unknown')) {
        return 'chat';
    }
    if (action === 'save' || action === 'export' || skillId === 'document-management') {
        return 'document-management';
    }
    const layerAction = normalizeSkillParam(input, 'action') || mode;
    if (skillId === 'layer-management' && layerAction === 'organize') {
        // 语义整理不是普通机械层操作：模型必须看清长画布、形成成员计划，
        // 写后还要再次读图。这里只消费上游已选中的 Skill + action 能力身份，
        // 不在性能核心用业务措辞再次猜意图。
        return 'skill-workflow';
    }
    if (skillId === 'layer-management' || /图层.*(顺序|置顶|置底|上移|下移|颜色|隐藏|数量)|从浅到深|从深到浅/.test(text)) {
        return 'layer-management';
    }
    if (skillId === 'text-font-replace' || /字体|字号|文字图层|改文案|替换文案/.test(text)) {
        return 'text-editing';
    }
    if (scenario === 'copywriting' || skillId === 'copywriting') {
        return 'copywriting';
    }
    if (normalizeText(input.taskType) || input.requiresPhotoshop) {
        return 'skill-workflow';
    }
    return 'unknown';
}

function budgetFromSkillProfile(profile: SkillRuntimePerformanceProfile): AgentPerformanceBudget {
    const maxVisionCandidates = clampInt(
        profile.budget.max_vision_candidates,
        0,
        0,
        AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxVisionCandidates
    );
    return {
        maxModelCalls: clampInt(
            profile.budget.max_model_calls,
            0,
            0,
            AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxModelCalls
        ),
        maxToolCalls: clampInt(
            profile.budget.max_tool_calls,
            0,
            0,
            AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxToolCalls
        ),
        maxIterations: clampInt(
            profile.budget.max_iterations,
            0,
            0,
            AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxIterations
        ),
        maxVisionCandidates,
        maxInitialVisionCandidates: clampInt(
            profile.budget.max_initial_vision_candidates,
            Math.min(
                5,
                Math.max(0, maxVisionCandidates - Math.max(2, Math.ceil(maxVisionCandidates / 2)))
            ),
            0,
            maxVisionCandidates
        ),
        maxVisualAnalyses: clampInt(
            profile.budget.max_visual_analyses,
            0,
            0,
            AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxVisualAnalyses
        ),
        maxFullResolutionImageReads: 0,
        softTimeBudgetMs: clampInt(
            profile.budget.soft_time_budget_ms,
            0,
            0,
            AGENT_GLOBAL_SKILL_BUDGET_LIMITS.softTimeBudgetMs
        )
    };
}

function defaultSkillWorkflowBudget(): AgentPerformanceBudget {
    return {
        // broad discovery 的设计工作流（未命中 manifest profile）：读上下文 + 技能入口 +
        // 可能的预检重试。16 次模型调用在慢/弱模型下会在技能入口前烧光（实测"帮我做SKU"：
        // 预检拦截重试，16 次耗尽仍 0 写入）。24 给足恢复余量。
        maxModelCalls: 24,
        maxToolCalls: 120,
        maxIterations: 60,
        maxVisionCandidates: 6,
        maxVisualAnalyses: 2,
        maxFullResolutionImageReads: 0,
        softTimeBudgetMs: 360_000
    };
}

function semanticLayerOrganizationBudget(): AgentPerformanceBudget {
    return {
        ...defaultSkillWorkflowBudget(),
        // 开工画布 1 + 写前长画布分屏 3 + 写后同版本分屏 3；
        // 另外保留 3 张和一次视觉分析给有界恢复。
        maxVisionCandidates: 10,
        maxInitialVisionCandidates: 2,
        maxVisualAnalyses: 4
    };
}

function budgetForTaskClass(
    taskClass: AgentTaskClass,
    skillProfile?: SkillRuntimePerformanceProfile
): AgentPerformanceBudget {
    if (taskClass === 'skill-workflow') {
        return skillProfile ? budgetFromSkillProfile(skillProfile) : defaultSkillWorkflowBudget();
    }
    switch (taskClass) {
        case 'chat':
            return {
                maxModelCalls: 1,
                maxToolCalls: 0,
                maxIterations: 2,
                maxVisionCandidates: 0,
                maxVisualAnalyses: 0,
                maxFullResolutionImageReads: 0,
                softTimeBudgetMs: 30_000
            };
        case 'document-management':
        case 'layer-management':
        case 'text-editing':
        case 'simple-operation':
            return {
                // 读文档→写入→读回确认至少 3 轮模型调用；maxModelCalls:1 / 45s 会让
                // ReAct 循环在第一次写入前就被掐停（"修改文案"类任务实测因此必败）。
                maxModelCalls: 6,
                maxToolCalls: 10,
                maxIterations: 8,
                maxVisionCandidates: 0,
                maxVisualAnalyses: 0,
                maxFullResolutionImageReads: 0,
                softTimeBudgetMs: 240_000
            };
        case 'copywriting':
            return {
                maxModelCalls: 2,
                maxToolCalls: 8,
                maxIterations: 8,
                maxVisionCandidates: 1,
                maxVisualAnalyses: 1,
                maxFullResolutionImageReads: 0,
                softTimeBudgetMs: 60_000
            };
        case 'project-inventory':
            return {
                maxModelCalls: 0,
                maxToolCalls: 2,
                maxIterations: 4,
                maxVisionCandidates: 0,
                maxVisualAnalyses: 0,
                maxFullResolutionImageReads: 0,
                softTimeBudgetMs: 15_000
            };
        case 'project-analysis':
            return {
                maxModelCalls: 1,
                maxToolCalls: 8,
                maxIterations: 8,
                maxVisionCandidates: 4,
                maxVisualAnalyses: 4,
                maxFullResolutionImageReads: 0,
                softTimeBudgetMs: 90_000
            };
        default:
            return {
                // 同上：未知类任务也可能是写操作，保底 6 轮模型调用与 240s，
                // 避免还没完成「读→写→读回」就被预算掐停。
                maxModelCalls: 6,
                maxToolCalls: 12,
                maxIterations: 10,
                maxVisionCandidates: 0,
                maxVisualAnalyses: 0,
                maxFullResolutionImageReads: 0,
                softTimeBudgetMs: 240_000
            };
    }
}

function verificationTierForTaskClass(
    taskClass: AgentTaskClass,
    skillProfile?: SkillRuntimePerformanceProfile
): AgentVerificationTier {
    if (taskClass === 'skill-workflow') {
        return skillProfile?.verification_tier || 'manual';
    }
    switch (taskClass) {
        case 'chat':
            return 'none';
        case 'document-management':
            return 'metadata';
        case 'layer-management':
        case 'text-editing':
        case 'simple-operation':
            return 'bounds';
        case 'project-inventory':
            return 'metadata';
        case 'project-analysis':
            return 'manual';
        case 'copywriting':
            return 'manual';
        default:
            return 'metadata';
    }
}

function costProfileFromSkillProfile(profile: SkillRuntimePerformanceProfile): AgentCostProfile {
    return {
        modelCallClass: profile.cost_profile.model_call_class,
        photoshopToolClass: profile.cost_profile.photoshop_tool_class,
        imageProcessingClass: profile.cost_profile.image_processing_class,
        expectedLatency: profile.cost_profile.expected_latency,
        resourceRisk: profile.cost_profile.resource_risk
    };
}

function defaultSkillWorkflowCostProfile(): AgentCostProfile {
    return {
        modelCallClass: 'vision-light',
        photoshopToolClass: 'write-heavy',
        imageProcessingClass: 'bounded-vision',
        expectedLatency: 'long',
        resourceRisk: 'high'
    };
}

function costProfileForTaskClass(
    taskClass: AgentTaskClass,
    skillProfile?: SkillRuntimePerformanceProfile
): AgentCostProfile {
    if (taskClass === 'skill-workflow') {
        return skillProfile
            ? costProfileFromSkillProfile(skillProfile)
            : defaultSkillWorkflowCostProfile();
    }
    switch (taskClass) {
        case 'chat':
            return {
                modelCallClass: 'text-light',
                photoshopToolClass: 'none',
                imageProcessingClass: 'none',
                expectedLatency: 'short',
                resourceRisk: 'low'
            };
        case 'document-management':
        case 'layer-management':
        case 'text-editing':
        case 'simple-operation':
            return {
                modelCallClass: 'text-light',
                photoshopToolClass: 'write-light',
                imageProcessingClass: 'metadata-only',
                expectedLatency: 'short',
                resourceRisk: 'low'
            };
        case 'project-inventory':
            return {
                modelCallClass: 'none',
                photoshopToolClass: 'read-only',
                imageProcessingClass: 'metadata-only',
                expectedLatency: 'instant',
                resourceRisk: 'low'
            };
        case 'project-analysis':
            return {
                modelCallClass: 'vision-light',
                photoshopToolClass: 'read-only',
                imageProcessingClass: 'bounded-vision',
                expectedLatency: 'medium',
                resourceRisk: 'medium'
            };
        case 'copywriting':
            return {
                modelCallClass: 'text-heavy',
                photoshopToolClass: 'read-only',
                imageProcessingClass: 'bounded-vision',
                expectedLatency: 'medium',
                resourceRisk: 'medium'
            };
        default:
            return {
                modelCallClass: 'text-light',
                photoshopToolClass: 'read-only',
                imageProcessingClass: 'metadata-only',
                expectedLatency: 'unknown',
                resourceRisk: 'medium'
            };
    }
}

function requiresContextSnapshotForTask(taskClass: AgentTaskClass): boolean {
    return taskClass === 'skill-workflow';
}

function shouldAllowVisionModel(
    taskClass: AgentTaskClass,
    hasAttachedImage: boolean,
    skillProfile?: SkillRuntimePerformanceProfile
): boolean {
    if (taskClass === 'project-inventory') return false;
    if (taskClass === 'project-analysis') return true;
    if (taskClass === 'copywriting') return hasAttachedImage;
    if (taskClass !== 'skill-workflow') return false;
    return skillProfile ? skillProfile.vision_policy === 'bounded' : true;
}

function applyProjectScaleWarnings(input: {
    budget: AgentPerformanceBudget;
    projectImageCount: number;
    visualSamplingCandidateCount: number;
}): string[] {
    const warnings: string[] = [];
    if (input.projectImageCount > 80) {
        warnings.push(`项目图片数量 ${input.projectImageCount} 较多，必须使用 ProjectAssetIndex 和 VisualSamplingPlan，不能全量视觉分析。`);
    }
    if (input.budget.maxVisionCandidates > 0 && input.visualSamplingCandidateCount > input.budget.maxVisionCandidates) {
        warnings.push(`视觉候选 ${input.visualSamplingCandidateCount} 超过预算 ${input.budget.maxVisionCandidates}，执行前必须截断候选。`);
    }
    return warnings;
}

export function buildAgentPerformancePolicy(input: BuildAgentPerformancePolicyInput): AgentPerformancePolicy {
    const scenario = input.scenario || 'unknown';
    const action = input.action || 'unknown';
    const performanceResolution = resolveSkillPerformanceProfile(input);
    const resolvedProfile = performanceResolution.resolved;
    const skillProfile = resolvedProfile?.profile;
    const taskClass = inferTaskClass(input, resolvedProfile);
    const isSemanticLayerOrganization = normalizeText(input.skillId) === 'layer-management'
        && (normalizeSkillParam(input, 'action') || normalizeText(input.mode)) === 'organize';
    const rawBudget = isSemanticLayerOrganization
        ? semanticLayerOrganizationBudget()
        : budgetForTaskClass(taskClass, skillProfile);
    const visualSamplingCandidateCount = clampInt(input.visualSamplingCandidateCount, 0, 0, 999);
    const projectImageCount = clampInt(input.projectImageCount, 0, 0, 999_999);
    const requestedSampleSize = Number(input.skillParams?.sampleSize);
    const requestedVisionCandidates = Number.isFinite(requestedSampleSize) && requestedSampleSize >= 0
        ? requestedSampleSize
        : visualSamplingCandidateCount;
    // VisualSamplingPlan 的 sampleSize 描述“从项目素材中抽样多少张”，不是整个
    // Agent 运行期间的视觉观察记录总额。若用它收紧 Skill runtime，会让开场观察或首轮
    // 截图吃光预算，修改后的画面无法再验证。只有独立项目分析任务才共享这两个口径；
    // 设计 Skill 的执行/修订/验收预算始终由 manifest 决定。
    const shouldTightenBySamplingPlan = taskClass === 'project-analysis';
    const maxVisionCandidates = shouldTightenBySamplingPlan
        && rawBudget.maxVisionCandidates > 0
        && requestedVisionCandidates > 0
        ? Math.min(rawBudget.maxVisionCandidates, requestedVisionCandidates)
        : rawBudget.maxVisionCandidates;
    const costProfile = costProfileForTaskClass(taskClass, skillProfile);
    const modelCallCostControls = resolveAgentModelCallCostControls(costProfile.modelCallClass);
    const budget: AgentPerformanceBudget = {
        ...rawBudget,
        maxVisionCandidates,
        ...modelCallCostControls
    };
    const hasAttachedImage = input.hasAttachedImage === true;
    const allowVisionModel = shouldAllowVisionModel(
        taskClass,
        hasAttachedImage || maxVisionCandidates > 0,
        skillProfile
    );
    const warnings = applyProjectScaleWarnings({
        budget,
        projectImageCount,
        visualSamplingCandidateCount
    });
    if (performanceResolution.selection.status === 'conflict') {
        warnings.unshift('Skill Manifest 身份冲突，性能策略已回退到 Agent 核心安全档；执行规划必须先阻断并修复身份。');
    } else if (performanceResolution.selection.status === 'unresolved_task_type') {
        warnings.unshift(`结构化 taskType「${performanceResolution.selection.unresolvedTaskType}」未注册，不能按 skillId 猜测业务性能画像。`);
    }
    if (skillProfile && (
        skillProfile.budget.max_model_calls > AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxModelCalls
        || skillProfile.budget.max_tool_calls > AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxToolCalls
        || skillProfile.budget.max_iterations > AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxIterations
        || skillProfile.budget.max_vision_candidates > AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxVisionCandidates
        || skillProfile.budget.max_visual_analyses > AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxVisualAnalyses
        || skillProfile.budget.max_full_resolution_image_reads > 0
        || skillProfile.budget.soft_time_budget_ms > AGENT_GLOBAL_SKILL_BUDGET_LIMITS.softTimeBudgetMs
    )) {
        warnings.push('Skill Manifest 的资源请求超过 Agent 全局安全上限，实际预算已被截断。');
    }

    return {
        policyVersion: 'agent-performance-policy/v0',
        taskClass,
        scenario,
        action,
        budget,
        verificationTier: verificationTierForTaskClass(taskClass, skillProfile),
        costProfile,
        profileSource: resolvedProfile
            ? {
                owner: 'skill-manifest',
                ref: resolvedProfile.sourceRef
            }
            : {
                owner: 'agent-core',
                ref: performanceResolution.selection.status === 'conflict'
                    || performanceResolution.selection.status === 'unresolved_task_type'
                    ? `manifest-identity:${performanceResolution.selection.status}`
                    : `agent-task-class:${taskClass}`
            },
        controls: {
            allowProviderStreaming: taskClass === 'chat' || taskClass === 'copywriting',
            allowVisionModel,
            allowBulkProjectScan: false,
            allowFullResolutionImageRead: false,
            preferMetadataOnly: !allowVisionModel,
            preferToolBatching: taskClass !== 'chat',
            requireContextSnapshotBeforeExecution: requiresContextSnapshotForTask(taskClass)
        },
        warnings,
        limitations: [
            '性能策略是执行前预算和资源边界，不代表任务已经执行。',
            '默认禁止全项目视觉分析和全分辨率图片读取。',
            '需要视觉模型时必须通过 ProjectAssetIndex 的有界候选和缓存策略进入。',
            '验收等级只定义最低检查要求，不等于设计质量通过。'
        ]
    };
}

/**
 * 尚未绑定设计 Manifest 时的自主执行预算。
 *
 * Skill 可以被直接调用；没有匹配 Skill 的设计则由主 Agent 自主规划并用原子工具完成。
 * Manifest 绑定可在运行中进一步细化预算，但不是开工或完成任务的前置条件。
 */
export function buildAgentUnboundAutonomousPerformancePolicy(): AgentPerformancePolicy {
    const costProfile: AgentCostProfile = {
        modelCallClass: 'vision-light',
        photoshopToolClass: 'write-heavy',
        imageProcessingClass: 'bounded-vision',
        expectedLatency: 'long',
        resourceRisk: 'high'
    };
    return {
        policyVersion: 'agent-performance-policy/v0',
        taskClass: 'simple-operation',
        scenario: 'unknown',
        action: 'unknown',
        budget: {
            // 2026-08-17：16/50/7min 是聊天助理量级，不是设计师干活量级。真机 run 469 未绑定
            // 清单的详情页续跑，14 轮里成功置入 6 层、零失败，却在第 14 轮被预算掐断。
            // 预算是安全网；抬到接近全局上限的一档，让「做完 / 无进展」成为常态停机条件。
            // 同日 run [471]：32 次模型调用在第 28 轮（含视觉回合）耗尽，任务仍未完成——再抬到全局上限。
            maxModelCalls: 40,
            maxToolCalls: 120,
            maxIterations: 60,
            // 眼睛不能中途失明：一次主图 / 详情页任务开工看产品图 + 每次改完回看，8 张远远不够
            // （真机：模型宣布「画面读取额度已用尽，无法核验」）。超出后还会以缩略图降级读入。
            maxVisionCandidates: 16,
            maxInitialVisionCandidates: 3,
            maxVisualAnalyses: 6,
            maxFullResolutionImageReads: 0,
            softTimeBudgetMs: 900_000,
            ...resolveAgentModelCallCostControls(costProfile.modelCallClass)
        },
        verificationTier: 'bounds',
        costProfile,
        profileSource: {
            owner: 'agent-core',
            ref: 'agent-unbound-autonomous/v0'
        },
        controls: {
            allowProviderStreaming: false,
            allowVisionModel: true,
            allowBulkProjectScan: false,
            allowFullResolutionImageRead: false,
            preferMetadataOnly: true,
            preferToolBatching: true,
            requireContextSnapshotBeforeExecution: false
        },
        warnings: [],
        limitations: [
            '这是未绑定 Manifest 时的总上限，不要求 Agent 用完；匹配 Skill 时应直接调用，避免无意义的前置读取。',
            '视觉候选用于必要的素材判断、首稿和写后复核，不自动启动全项目扫描。',
            '性能预算不代表任务已完成或设计质量已通过。'
        ]
    };
}

export function buildAutonomousAgentRuntimeBudget(input: BuildAutonomousAgentRuntimeBudgetInput = {}): AgentRuntimeBudget {
    const hasExplicitBudget = input.requestedMaxIterations !== undefined
        && input.requestedMaxIterations !== null
        && input.requestedMaxIterations !== '';
    const fallbackMaxIterations = resolveRuntimeIterationLimit(input.defaultMaxIterations, 25);
    const maxIterations = hasExplicitBudget
        ? resolveRuntimeIterationLimit(input.requestedMaxIterations, fallbackMaxIterations)
        : fallbackMaxIterations;
    const source = hasExplicitBudget
        ? 'explicit-user-parameter'
        : (input.defaultSource || 'legacy-autonomous-agent-default');

    return {
        budgetVersion: 'agent-runtime-budget/v0',
        maxIterations,
        source,
        limitations: [
            source === 'stage-autonomous-agent-default'
                ? '该预算用于阶段式自主设计，要求先完成一个可观察阶段，再由 Agent 根据真实画面决定下一步。'
                : '该预算迁移保留 autonomous-agent 既有默认 25 轮行为，不代表硬预算策略已经完成。',
            '后续需要按 taskClass 将运行时预算收敛到 AgentPerformancePolicy，而不是所有任务共用 legacy 默认。'
        ]
    };
}

/**
 * Plan-neutral 启动预算只负责约束 R0 身份声明，不能永久压住声明后的完整设计。
 * 只有调用方明确传入的迭代上限继续作为 deny-wins ceiling；其余启动默认在
 * Manifest 绑定后由对应 work mode 的预算完整接管。
 */
export function resolveDeclaredRuntimeMaxIterations(input: {
    runtimeBudget: AgentRuntimeBudget;
    manifestMaxIterations: number;
}): number {
    const manifestMaxIterations = resolveRuntimeIterationLimit(input.manifestMaxIterations, 1);
    if (input.runtimeBudget.source !== 'explicit-user-parameter') {
        return manifestMaxIterations;
    }
    return Math.min(input.runtimeBudget.maxIterations, manifestMaxIterations);
}

export function buildDesignTeamRuntimeBudget(input: BuildDesignTeamRuntimeBudgetInput): AgentDesignTeamRuntimeBudget {
    const fallbackMaxIterations = defaultDesignTeamIterationLimit(input.role);
    const hasExplicitBudget = input.requestedMaxIterations !== undefined
        && input.requestedMaxIterations !== null
        && input.requestedMaxIterations !== '';
    const maxIterations = hasExplicitBudget
        ? resolveRuntimeIterationLimit(input.requestedMaxIterations, fallbackMaxIterations)
        : fallbackMaxIterations;
    const source = hasExplicitBudget
        ? 'explicit-user-parameter'
        : 'teammate-role-default';

    return {
        budgetVersion: 'agent-design-team-runtime-budget/v0',
        role: input.role,
        maxIterations,
        source,
        limitations: [
            '该预算迁移保留 design-team teammate 既有默认迭代数，不代表多 Agent 工作流已完整成熟。',
            '显式请求的 maxIterations 仍可覆盖默认值；无效或小于等于 0 的值会回退到角色默认值。'
        ]
    };
}

export function buildAgentProviderTokenBudget(input: BuildAgentProviderTokenBudgetInput = {}): AgentProviderTokenBudget {
    const hasExplicitBudget = input.requestedMaxTokens !== undefined
        && input.requestedMaxTokens !== null
        && input.requestedMaxTokens !== '';
    const maxTokens = resolveProviderMaxTokens(input.requestedMaxTokens, input.legacyDefaultMaxTokens);
    const legacyDefaultMaxTokens = resolveProviderMaxTokens(undefined, input.legacyDefaultMaxTokens);
    const source = hasExplicitBudget && maxTokens !== legacyDefaultMaxTokens
        ? 'explicit-user-parameter'
        : 'legacy-provider-default';

    return {
        budgetVersion: 'agent-provider-token-budget/v0',
        maxTokens,
        source,
        limitations: [
            `该预算迁移保留 provider/model 既有默认 maxTokens=${legacyDefaultMaxTokens}，不代表所有模型调用已完成动态预算。`,
            '本 helper 只集中默认输出 token 上限，不改变温度、工具调用、流式协议或 provider timeout。'
        ]
    };
}

export function buildAgentContextWindowBudget(
    input: BuildAgentContextWindowBudgetInput = {}
): AgentContextWindowBudget {
    const defaultMaxTokens = 100_000;
    const defaultKeepRecentRounds = 6;
    const hasExplicitBudget = input.requestedMaxTokens !== undefined
        || input.requestedKeepRecentRounds !== undefined;
    const maxTokens = resolvePositiveInt(input.requestedMaxTokens, defaultMaxTokens, 1_000, 1_000_000);
    const keepRecentRounds = resolvePositiveInt(input.requestedKeepRecentRounds, defaultKeepRecentRounds, 1, 50);

    return {
        budgetVersion: 'agent-context-window-budget/v0',
        maxTokens,
        keepRecentRounds,
        source: hasExplicitBudget ? 'explicit-user-parameter' : 'legacy-context-manager-default',
        limitations: [
            '该预算迁移保留 ContextManager 既有 maxTokens=100000 与 keepRecentRounds=6 默认值，不代表上下文压缩策略已经成熟。',
            '当前 token 估算仍是字符级粗略估算，不能等同 provider 真实 token 计费。'
        ]
    };
}

export function buildAgentResourceCacheBudget(
    input: BuildAgentResourceCacheBudgetInput = {}
): AgentResourceCacheBudget {
    const resourceScanCacheTtlMs = resolvePositiveInt(
        input.requestedResourceScanCacheTtlMs,
        30_000,
        1_000,
        10 * 60 * 1_000
    );
    const psdPreviewCacheTtlMs = resolvePositiveInt(
        input.requestedPsdPreviewCacheTtlMs,
        300_000,
        1_000,
        60 * 60 * 1_000
    );

    return {
        budgetVersion: 'agent-resource-cache-budget/v0',
        resourceScanCacheTtlMs,
        psdPreviewCacheTtlMs,
        source: 'agent-performance-policy',
        limitations: [
            '该预算迁移保留 ResourceManager 既有目录扫描 30 秒缓存和 PSD 预览 5 分钟缓存，不改变资源读取行为。',
            '缓存预算只是性能边界，不代表图片内容理解、最佳素材选择或视觉分析已经完成。'
        ]
    };
}

export function buildAgentAcceptanceCaptureBudget(
    input: BuildAgentAcceptanceCaptureBudgetInput = {}
): AgentAcceptanceCaptureBudget {
    let mode: AgentAcceptanceCaptureBudget['mode'] = 'standard';
    let maxLayers = 350;
    let timeoutMs = 12_000;

    if (input.deep === true) {
        mode = 'deep';
        maxLayers = 1_000;
        timeoutMs = 30_000;
    } else if (input.bulk === true) {
        mode = 'bulk';
        maxLayers = 700;
        timeoutMs = 22_000;
    } else if (input.light === true) {
        // 轻量结构写：验证只需层级关系+bounds（顺序/父子/剪切），不需要全文档深采——
        // 真机 110 步病例里单步 reorderLayer 也扛 16s 全套验收，时间大头在此。
        mode = 'light';
        maxLayers = 120;
        timeoutMs = 5_000;
    }

    return {
        budgetVersion: 'agent-acceptance-capture-budget/v0',
        mode,
        maxLayers,
        timeoutMs,
        maxChangedLayers: resolveAcceptanceChangedLayerLimit(input.maxChangedLayers),
        source: 'agent-performance-policy',
        limitations: [
            '该预算迁移保留 tool acceptance 既有 maxLayers、timeoutMs 和 changed layer 默认值，不代表截图级 QA 已完成。',
            '后续需要按 taskClass 和文档规模把验收预算推进到硬限制和 UI 资源提示。'
        ]
    };
}

export function buildAgentPerformancePolicyFromIntent(input: {
    intent: DesignIntentContext;
    skillId?: string;
    taskType?: string;
    hasAttachedImage?: boolean;
    projectImageCount?: number;
    visualSamplingCandidateCount?: number;
}): AgentPerformancePolicy {
    return buildAgentPerformancePolicy({
        userText: input.intent.normalizedText || input.intent.rawText,
        scenario: input.intent.targetScenario,
        action: input.intent.action,
        skillId: input.skillId,
        taskType: input.taskType,
        hasAttachedImage: input.hasAttachedImage,
        requiresPhotoshop: input.intent.requiresPhotoshop,
        projectImageCount: input.projectImageCount,
        visualSamplingCandidateCount: input.visualSamplingCandidateCount
    });
}
