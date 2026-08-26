import {
    buildAgentToolExecutionPreflight,
    DESIGN_ECHO_TARGET_GUARD_ARGUMENT,
    isAgentToolExecutionGuarded,
    type AgentToolExecutionPreflight,
    type AgentToolExecutionPreflightLogEntry
} from './agent-tool-execution-preflight';

export type GuardedAtomicToolExecutor = (
    toolName: string,
    params: Record<string, any>
) => Promise<any>;

export const RUNTIME_OWNED_SKILL_TOOL_LEDGER_VERSION =
    'runtime-owned-skill-tool-ledger/v0' as const;

export interface RuntimeOwnedSkillToolLedgerEntry {
    toolName: string;
    params: Readonly<Record<string, any>>;
    dispatchState: 'not_dispatched' | 'returned' | 'threw';
    result?: unknown;
}

/** 由 guarded executor 自己记录并在 Skill 返回后封口；executor 返回值不能伪造。 */
export interface RuntimeOwnedSkillToolLedger {
    version: typeof RUNTIME_OWNED_SKILL_TOOL_LEDGER_VERSION;
    complete: true;
    entries: readonly RuntimeOwnedSkillToolLedgerEntry[];
    boundaries: {
        runtimeOwned: true;
        exhaustiveForScope: true;
        executorReportedResultsIgnored: true;
    };
}

export interface RuntimeOwnedSkillToolLedgerScope {
    version: 'runtime-owned-skill-tool-ledger-scope/v0';
    scopeId: string;
}

interface RuntimeOwnedSkillToolLedgerInternalEntry extends RuntimeOwnedSkillToolLedgerEntry {
    scopeIds: readonly string[];
}

interface GuardedAtomicToolLedgerState {
    activeScopeIds: Set<string>;
    entries: RuntimeOwnedSkillToolLedgerInternalEntry[];
    drain: () => Promise<void>;
}

interface RuntimeOwnedSkillToolLedgerScopeState {
    owner: GuardedAtomicToolLedgerState;
    scopeId: string;
    completed?: RuntimeOwnedSkillToolLedger;
}

const GUARDED_ATOMIC_TOOL_LEDGER_STATES =
    new WeakMap<GuardedAtomicToolExecutor, GuardedAtomicToolLedgerState>();
const RUNTIME_OWNED_SKILL_TOOL_LEDGER_SCOPES =
    new WeakMap<object, RuntimeOwnedSkillToolLedgerScopeState>();
const RUNTIME_OWNED_SKILL_TOOL_LEDGERS = new WeakSet<object>();
let runtimeOwnedSkillToolLedgerScopeSequence = 0;

export function beginRuntimeOwnedSkillToolLedgerScope(
    executor: GuardedAtomicToolExecutor | undefined
): RuntimeOwnedSkillToolLedgerScope | undefined {
    if (!executor) return undefined;
    const owner = GUARDED_ATOMIC_TOOL_LEDGER_STATES.get(executor);
    if (!owner) return undefined;
    runtimeOwnedSkillToolLedgerScopeSequence += 1;
    const scope: RuntimeOwnedSkillToolLedgerScope = Object.freeze({
        version: 'runtime-owned-skill-tool-ledger-scope/v0',
        scopeId: `skill-tool-ledger-${runtimeOwnedSkillToolLedgerScopeSequence}`
    });
    owner.activeScopeIds.add(scope.scopeId);
    RUNTIME_OWNED_SKILL_TOOL_LEDGER_SCOPES.set(scope, {
        owner,
        scopeId: scope.scopeId
    });
    return scope;
}

export async function completeRuntimeOwnedSkillToolLedgerScope(
    scope: RuntimeOwnedSkillToolLedgerScope | undefined
): Promise<RuntimeOwnedSkillToolLedger | undefined> {
    if (!scope) return undefined;
    const state = RUNTIME_OWNED_SKILL_TOOL_LEDGER_SCOPES.get(scope);
    if (!state) return undefined;
    if (state.completed) return state.completed;
    await state.owner.drain();
    state.owner.activeScopeIds.delete(state.scopeId);
    const entries = state.owner.entries
        .filter((entry) => entry.scopeIds.includes(state.scopeId))
        .map((entry): RuntimeOwnedSkillToolLedgerEntry => Object.freeze({
            toolName: entry.toolName,
            params: Object.freeze({ ...entry.params }),
            dispatchState: entry.dispatchState,
            ...(Object.prototype.hasOwnProperty.call(entry, 'result')
                ? { result: entry.result }
                : {})
        }));
    const ledger: RuntimeOwnedSkillToolLedger = Object.freeze({
        version: RUNTIME_OWNED_SKILL_TOOL_LEDGER_VERSION,
        complete: true,
        entries: Object.freeze(entries),
        boundaries: Object.freeze({
            runtimeOwned: true,
            exhaustiveForScope: true,
            executorReportedResultsIgnored: true
        })
    });
    RUNTIME_OWNED_SKILL_TOOL_LEDGERS.add(ledger);
    state.completed = ledger;
    return ledger;
}

export function isRuntimeOwnedCompleteSkillToolLedger(
    value: unknown
): value is RuntimeOwnedSkillToolLedger {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const ledger = value as RuntimeOwnedSkillToolLedger;
    return RUNTIME_OWNED_SKILL_TOOL_LEDGERS.has(value as object)
        && ledger.version === RUNTIME_OWNED_SKILL_TOOL_LEDGER_VERSION
        && ledger.complete === true
        && Array.isArray(ledger.entries)
        && ledger.boundaries?.runtimeOwned === true
        && ledger.boundaries.exhaustiveForScope === true
        && ledger.boundaries.executorReportedResultsIgnored === true;
}

/** 技能启动时，模型上下文里的期望执行目标。 */
export interface SkillWorkflowTargetIdentity {
    documentId?: number;
    activeLayerId?: number;
    historyStateId?: number;
}

export interface SkillWorkflowTargetRebindingInput {
    /** 被调用的技能 id，例如 sku-batch。 */
    skillId: string;
    /** 主循环上下文签发的期望目标（可能已经陈旧）。 */
    expected: SkillWorkflowTargetIdentity;
    /** 技能启动那一刻真实读到的活动文档。documentId 缺失表示当前没有打开的文档。 */
    observed: SkillWorkflowTargetIdentity & { documentName?: string };
}

export type SkillWorkflowTargetRebindingDecision =
    /** 期望与现实一致，按原目标继续。 */
    | { action: 'proceed'; reason: string }
    /**
     * 现实与期望不一致，但技能可以在真实的当前文档上继续；
     * 内部 guard owner 以 observed 为新锚点重新绑定。
     */
    | { action: 'rebind'; reason: string }
    /**
     * 差异性质不允许自动接管，必须回到模型让它先明确目标。
     * error 必须指名可以刷新执行目标的具体工具，否则模型无法脱困。
     */
    | { action: 'block'; code: string; error: string };

/**
 * 可以刷新技能执行目标的观察工具——写进拦截文案，模型才知道该调什么。
 *
 * 真机 [491] 的死循环正是因为拦截文案只说「请重新观察当前文档后再试」：
 * 模型照做了 20 次（searchProjectResources / listProjectResources / getDesignProjectState），
 * 但这些都不读 Photoshop 文档，一次都刷不新期望目标，于是原样重试、撞满 14 次。
 */
export const SKILL_WORKFLOW_TARGET_REFRESH_TOOLS = [
    'getDocumentInfo',
    'switchDocument',
    'getLayerHierarchy'
] as const;

/**
 * 技能启动前的目标对账：期望目标与真实活动文档不一致时怎么办。
 *
 * 这是「技能」与「原子写工具」的分界点。原子写工具一次调用只改一处，
 * 「执行前文档没变过」是合理前提；而技能是多步工作流——sku-batch 第一件事
 * 就是打开模板文件、切换文档——对它套同一把锁属于范畴错误。
 * 技能内部每个原子写仍各自过 preflight + guard（createGuardedAtomicToolExecutor），
 * 所以这里放行不等于放弃保护，只是把锚点从「技能调用前的模型上下文快照」
 * 换成「技能启动那一刻的真实文档」。
 */
export function resolveSkillWorkflowTargetRebinding(
    input: SkillWorkflowTargetRebindingInput
): SkillWorkflowTargetRebindingDecision {
    const expectedDocumentId = input.expected.documentId;
    const observedDocumentId = input.observed.documentId;

    if (observedDocumentId === undefined) {
        return {
            action: 'block',
            code: 'skill_workflow_target_no_open_document',
            error: `当前 Photoshop 没有打开的文档，${input.skillId} 无法开始。`
                + '请先打开或新建目标文档，再重新调用。'
        };
    }
    if (expectedDocumentId === undefined) {
        return { action: 'rebind', reason: '此前没有稳定的期望目标，以当前活动文档为锚点开始。' };
    }

    // TODO(human): 期望文档与当前活动文档不一致时的处置策略
    return { action: 'proceed', reason: '期望目标与当前活动文档一致。' };
}

export interface GuardedAtomicToolExecutionDecision {
    ready: boolean;
    businessArguments: Record<string, any>;
    executionArguments?: Record<string, any>;
    preflight: AgentToolExecutionPreflight;
    blockedResult?: Record<string, any>;
}

export interface CreateGuardedAtomicToolExecutorInput {
    executeTool: GuardedAtomicToolExecutor;
    userRequest?: string;
    initialCompletedToolCalls?: AgentToolExecutionPreflightLogEntry[];
}

function stripUntrustedTargetGuard(params: Record<string, any>): Record<string, any> {
    const {
        [DESIGN_ECHO_TARGET_GUARD_ARGUMENT]: _untrustedTargetGuard,
        ...businessArguments
    } = params || {};
    return businessArguments;
}

/**
 * 为 Skill 内部的一次原子调用构造执行参数。
 *
 * Skill 只能提交业务参数；文档、历史版本与活动图层绑定完全由 Harness 根据此前
 * 真实 Tool 结果签发。这里复用主 Agent 的同一 preflight，不建立 SKU 或其他品类分支。
 */
export function buildGuardedAtomicToolExecutionDecision(input: {
    toolName: string;
    params?: Record<string, any>;
    userRequest?: string;
    completedToolCalls?: AgentToolExecutionPreflightLogEntry[];
}): GuardedAtomicToolExecutionDecision {
    const toolName = String(input.toolName || '').trim();
    const businessArguments = stripUntrustedTargetGuard(input.params || {});
    const preflight = buildAgentToolExecutionPreflight({
        userRequest: input.userRequest,
        toolCalls: [{ name: toolName, arguments: businessArguments }],
        completedToolCalls: input.completedToolCalls || [],
        requiresUserVisiblePreActionRationale: false
    });
    if (!preflight.ready || preflight.status === 'blocked') {
        const error = preflight.message
            || `Skill 内部原子工具 ${toolName} 缺少可校验的 Photoshop 执行目标。`;
        return {
            ready: false,
            businessArguments,
            preflight,
            blockedResult: {
                success: false,
                code: 'skill_atomic_tool_execution_preflight_blocked',
                policyGate: true,
                blockedTool: toolName,
                error,
                blockers: [...preflight.blockers],
                executesPhotoshop: false,
                grantsPermission: false,
                countsAsObservation: false,
                countsAsTaskProgress: false
            }
        };
    }

    if (!isAgentToolExecutionGuarded(toolName, businessArguments)) {
        return {
            ready: true,
            businessArguments,
            executionArguments: businessArguments,
            preflight
        };
    }
    const targetGuard = preflight.preconditions.targetGuard;
    if (!targetGuard) {
        return {
            ready: true,
            businessArguments,
            executionArguments: businessArguments,
            preflight
        };
    }

    const hasExplicitLayerId = Number.isSafeInteger(businessArguments.layerId)
        && Number(businessArguments.layerId) > 0;
    return {
        ready: true,
        businessArguments,
        executionArguments: {
            ...businessArguments,
            [DESIGN_ECHO_TARGET_GUARD_ARGUMENT]: {
                expectedDocumentId: targetGuard.expectedDocumentId,
                ...(!hasExplicitLayerId && targetGuard.expectedActiveLayerId !== undefined
                    ? { expectedActiveLayerId: targetGuard.expectedActiveLayerId }
                    : {}),
                ...(targetGuard.expectedHistoryStateRef
                    ? { expectedHistoryStateRef: targetGuard.expectedHistoryStateRef }
                    : {}),
                observationTool: targetGuard.observationTool
            }
        },
        preflight
    };
}

/**
 * 创建单个 Skill 运行作用域内的 target-binding owner。
 *
 * 所有调用强制串行，因此后一个写入的 preflight 一定能看到前一个读写结果；记录中只
 * 保存业务参数，Harness 私有 target guard 不会进入 Skill 报告或后续模型上下文。
 */
export function createGuardedAtomicToolExecutor(
    input: CreateGuardedAtomicToolExecutorInput
): GuardedAtomicToolExecutor {
    const completedToolCalls = [...(input.initialCompletedToolCalls || [])];
    let executionQueue: Promise<void> = Promise.resolve();
    const ledgerState: GuardedAtomicToolLedgerState = {
        activeScopeIds: new Set<string>(),
        entries: [],
        drain: async (): Promise<void> => await executionQueue
    };

    const executor: GuardedAtomicToolExecutor = function executeGuardedAtomicTool(
        toolName: string,
        params: Record<string, any>
    ): Promise<any> {
        const scopeIds = Array.from(ledgerState.activeScopeIds);
        const execution = executionQueue.then(async (): Promise<any> => {
            const decision = buildGuardedAtomicToolExecutionDecision({
                toolName,
                params,
                userRequest: input.userRequest,
                completedToolCalls
            });
            if (!decision.ready || !decision.executionArguments) {
                const blockedResult = decision.blockedResult || {
                    success: false,
                    code: 'skill_atomic_tool_execution_preflight_blocked',
                    error: `Skill 内部原子工具 ${toolName} 未通过执行目标预检。`
                };
                completedToolCalls.push({
                    name: toolName,
                    arguments: decision.businessArguments,
                    result: blockedResult
                });
                ledgerState.entries.push({
                    scopeIds,
                    toolName,
                    params: decision.businessArguments,
                    dispatchState: 'not_dispatched',
                    result: blockedResult
                });
                return blockedResult;
            }

            try {
                const result = await input.executeTool(toolName, decision.executionArguments);
                completedToolCalls.push({
                    name: toolName,
                    arguments: decision.businessArguments,
                    result
                });
                ledgerState.entries.push({
                    scopeIds,
                    toolName,
                    params: decision.businessArguments,
                    dispatchState: 'returned',
                    result
                });
                return result;
            } catch (error) {
                ledgerState.entries.push({
                    scopeIds,
                    toolName,
                    params: decision.businessArguments,
                    dispatchState: 'threw'
                });
                throw error;
            }
        });
        executionQueue = execution.then(
            () => undefined,
            () => undefined
        );
        return execution;
    };
    GUARDED_ATOMIC_TOOL_LEDGER_STATES.set(executor, ledgerState);
    return executor;
}
