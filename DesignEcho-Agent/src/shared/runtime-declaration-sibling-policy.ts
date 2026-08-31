/**
 * Runtime 声明同轮 sibling call 的承接策略。
 *
 * 声明是运行语义绑定点，不是权限票据。Harness 不能新增调用、改参数或绕过权限检查。
 * staged 会形成真实能力边界；agentic 虽不收紧能力面，却会改变模型可见的方法与评价上下文。
 * 两者都只承接兼容的只读观察与知识检索；副作用调用须由绑定后的模型轮重新生成。
 */

import {
    buildAgentToolDecisionContract,
    type BuildAgentToolDecisionContractInput
} from './agent-tool-decision-contract';
import {
    classifyAgentToolExecution,
    isAgentHarnessControlTool,
    type AgentToolExecutionKind
} from './agent-tool-execution-preflight';

export type RuntimeDeclarationSiblingDisposition = 'execute_after_binding' | 'defer';
export type RuntimeDeclarationExecutionModel = 'agentic' | 'staged';

export interface RuntimeDeclarationSiblingPolicyInput {
    declarationPresent: boolean;
    isDeclarationCall: boolean;
    declarationSucceeded: boolean;
    declarationExecutionModel?: RuntimeDeclarationExecutionModel;
    visibleAfterBinding: boolean;
    executionKind: AgentToolExecutionKind;
    isHarnessControlTool: boolean;
    isCapabilityControlTool: boolean;
}

export interface RuntimeDeclarationSiblingPolicyResult {
    disposition: RuntimeDeclarationSiblingDisposition;
    reason:
        | 'no_runtime_declaration'
        | 'runtime_declaration_call'
        | 'runtime_declaration_not_committed'
        | 'control_call_requires_replan'
        | 'tool_not_visible_after_binding'
        | 'agentic_compatible_read_only_call'
        | 'agentic_side_effect_requires_bound_context'
        | 'compatible_read_only_call'
        | 'side_effect_requires_replan';
}

export interface RuntimeDeclarationToolCallLike {
    id: string;
    name: string;
    arguments?: unknown;
}

export interface RuntimeDeclarationSiblingTurn<T extends RuntimeDeclarationToolCallLike> {
    declarationCall?: T;
    ambiguousDeclaration: boolean;
    invalidCallIdentity: boolean;
    orderedCalls: T[];
    shouldDefer: (call: T) => boolean;
    recordResult: (call: T, output: unknown) => Promise<void>;
}

export function resolveRuntimeDeclarationSiblingPolicy(
    input: RuntimeDeclarationSiblingPolicyInput
): RuntimeDeclarationSiblingPolicyResult {
    if (!input.declarationPresent) {
        return { disposition: 'execute_after_binding', reason: 'no_runtime_declaration' };
    }
    if (input.isDeclarationCall) {
        return { disposition: 'execute_after_binding', reason: 'runtime_declaration_call' };
    }
    if (!input.declarationSucceeded) {
        return { disposition: 'defer', reason: 'runtime_declaration_not_committed' };
    }
    if (input.isHarnessControlTool || input.isCapabilityControlTool) {
        return { disposition: 'defer', reason: 'control_call_requires_replan' };
    }
    if (!input.visibleAfterBinding) {
        return { disposition: 'defer', reason: 'tool_not_visible_after_binding' };
    }
    // Agentic 声明不授予写权限，也不建立 Stage 门票，但会把 Skill 方法、评价标准和
    // 任务语义加入下一轮模型上下文。同一响应里的写调用是在这些专业上下文尚不可见时
    // 生成的，不能因为声明先执行就追认成“已消费绑定后知识”的设计决定。只读观察与
    // 知识检索仍可同轮继续；其结果会与绑定后上下文一起交给 Agent 重新决定写入。
    if (input.declarationExecutionModel === 'agentic') {
        if (input.executionKind === 'read_only_observation'
            || input.executionKind === 'knowledge_search') {
            return {
                disposition: 'execute_after_binding',
                reason: 'agentic_compatible_read_only_call'
            };
        }
        return {
            disposition: 'defer',
            reason: 'agentic_side_effect_requires_bound_context'
        };
    }
    if (input.executionKind === 'read_only_observation'
        || input.executionKind === 'knowledge_search') {
        return { disposition: 'execute_after_binding', reason: 'compatible_read_only_call' };
    }
    return { disposition: 'defer', reason: 'side_effect_requires_replan' };
}

export function createRuntimeDeclarationSiblingTurn<T extends RuntimeDeclarationToolCallLike>(
    calls: T[],
    options: {
        readVisibleToolsAfterBinding: () => Promise<Array<{ name: string }>>;
        readExecutionModelAfterBinding?: () => RuntimeDeclarationExecutionModel | undefined;
        isCapabilityControlTool: (toolName: string) => boolean;
        decisionContext: Omit<BuildAgentToolDecisionContractInput, 'toolCalls' | 'runtime'> & {
            runtime: Omit<NonNullable<BuildAgentToolDecisionContractInput['runtime']>, 'availableTools'>;
        };
    }
): RuntimeDeclarationSiblingTurn<T> {
    const declarationCalls = calls.filter((call) => call.name === 'declareDesignIntent');
    const ambiguousDeclaration = declarationCalls.length > 1;
    const invalidCallIdentity = new Set(calls.map((call) => call.id)).size !== calls.length;
    const declarationCall = declarationCalls.length === 1 ? declarationCalls[0] : undefined;
    const orderedCalls = declarationCall && !invalidCallIdentity
        ? [declarationCall, ...calls.filter((call) => call.id !== declarationCall.id)]
        : calls;
    let declarationSucceeded = false;
    let declarationExecutionModel: RuntimeDeclarationExecutionModel | undefined;
    let visibleToolNamesAfterBinding = new Set<string>();
    return {
        declarationCall,
        ambiguousDeclaration,
        invalidCallIdentity,
        orderedCalls,
        shouldDefer: (call: T): boolean => {
            if (ambiguousDeclaration || invalidCallIdentity) return true;
            if (!declarationCall) return false;
            const policy = resolveRuntimeDeclarationSiblingPolicy({
                declarationPresent: Boolean(declarationCall),
                isDeclarationCall: call.id === declarationCall?.id,
                declarationSucceeded,
                declarationExecutionModel,
                visibleAfterBinding: visibleToolNamesAfterBinding.has(call.name),
                executionKind: classifyAgentToolExecution(call.name, call.arguments),
                isHarnessControlTool: isAgentHarnessControlTool(call.name),
                isCapabilityControlTool: options.isCapabilityControlTool(call.name)
            });
            if (policy.disposition === 'defer' || call.id === declarationCall?.id) {
                return policy.disposition === 'defer';
            }
            return buildAgentToolDecisionContract({
                ...options.decisionContext,
                toolCalls: [call],
                runtime: {
                    ...options.decisionContext.runtime,
                    availableTools: Array.from(visibleToolNamesAfterBinding)
                }
            }).status === 'blocked';
        },
        recordResult: async (call: T, output: unknown): Promise<void> => {
            if (call.id !== declarationCall?.id) return;
            const result = output && typeof output === 'object' && !Array.isArray(output)
                ? output as { success?: unknown }
                : undefined;
            if (result?.success !== true) return;
            let visibleTools: Array<{ name: string }>;
            try {
                visibleTools = await options.readVisibleToolsAfterBinding();
            } catch {
                // 绑定后真实能力面读取失败时保持 fail-closed；声明本身的结果仍原样回填模型。
                return;
            }
            visibleToolNamesAfterBinding = new Set(visibleTools.map((tool) => tool.name));
            declarationExecutionModel = options.readExecutionModelAfterBinding?.();
            declarationSucceeded = true;
        }
    };
}
