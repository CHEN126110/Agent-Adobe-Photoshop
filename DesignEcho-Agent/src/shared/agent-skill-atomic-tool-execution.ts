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

    return function executeGuardedAtomicTool(
        toolName: string,
        params: Record<string, any>
    ): Promise<any> {
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
                return blockedResult;
            }

            const result = await input.executeTool(toolName, decision.executionArguments);
            completedToolCalls.push({
                name: toolName,
                arguments: decision.businessArguments,
                result
            });
            return result;
        });
        executionQueue = execution.then(
            () => undefined,
            () => undefined
        );
        return execution;
    };
}
