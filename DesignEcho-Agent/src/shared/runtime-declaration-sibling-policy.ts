/**
 * Runtime 声明同轮 sibling call 的承接策略。
 *
 * 声明是能力边界屏障，不是让模型重复决定同一批只读动作的理由。Harness 只能承接模型
 * 已经请求、声明成功后仍可见、且分类仍为只读观察或知识检索的原调用；它不能新增调用、
 * 改参数或把写入/有状态/外部生成动作顺带放行。
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

export interface RuntimeDeclarationSiblingPolicyInput {
    declarationPresent: boolean;
    isDeclarationCall: boolean;
    declarationSucceeded: boolean;
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
            declarationSucceeded = true;
        }
    };
}
