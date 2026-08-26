import { isAgentReadResultCacheHit } from '../../../shared/agent-read-result-cache';
import type { RuntimeDesignBriefDeclaration } from '../../../shared/agent-runtime-v5/runtime-design-brief-declaration';
import {
    buildRuntimeReferenceVisualContextRef,
    getReferenceRequirement,
    isRuntimeReferenceSearchTool,
    isRuntimeReferenceVisualTool,
    normalizeRuntimeReferenceContextObservation,
    resolveRuntimeReferenceFailureDisposition,
    type RuntimeReferenceBriefDeclaration,
    type RuntimeReferenceContextState,
    type RuntimeReferencePolicyProjection
} from '../../../shared/agent-runtime-v5/runtime-reference-context';
import {
    runtimeDesignTaskRequiresOpenDocument,
    type RuntimeStagePlan
} from '../../../shared/agent-runtime-v5/runtime-stage-plan';
import type { RuntimeDesignWorkMode } from '../../../shared/agent-runtime-v5/contracts';
import type {
    AgentConfig,
    AgentToolCallLogEntry,
    ToolCall
} from './types';

export function resolveActiveReferencePolicy(
    config: AgentConfig
): RuntimeReferencePolicyProjection | undefined {
    return config.runtimeStagePlan?.referencePolicy || config.agenticReferencePolicy;
}

export function resolveActiveReferenceWorkMode(input: {
    config: AgentConfig;
    designBrief?: RuntimeDesignBriefDeclaration;
}): RuntimeDesignWorkMode | undefined {
    return input.designBrief?.payload.workMode
        || input.config.runtimeStagePlan?.expectedWorkMode
        || input.config.agenticArtifactContract?.workMode;
}

export function resolveAgentReferenceFailureDisposition(input: {
    config: AgentConfig;
    designBrief?: RuntimeDesignBriefDeclaration;
    referenceBrief?: RuntimeReferenceBriefDeclaration;
    toolName: string;
    result: unknown;
}): AgentToolCallLogEntry['failureDisposition'] {
    return resolveRuntimeReferenceFailureDisposition({
        policy: resolveActiveReferencePolicy(input.config),
        workMode: resolveActiveReferenceWorkMode(input),
        toolName: input.toolName,
        result: input.result,
        referenceReadiness: input.referenceBrief?.readiness
    });
}

export function reconcileAgentReferenceFailureDispositions(input: {
    config: AgentConfig;
    designBrief?: RuntimeDesignBriefDeclaration;
    referenceBrief?: RuntimeReferenceBriefDeclaration;
    toolCallLog: AgentToolCallLogEntry[];
}): void {
    for (const entry of input.toolCallLog) {
        if (entry.result?.success !== false || entry.failureDisposition) continue;
        const disposition = resolveAgentReferenceFailureDisposition({
            ...input,
            toolName: entry.name,
            result: entry.result
        });
        if (disposition) entry.failureDisposition = disposition;
    }
}

export function requiresRuntimeReferenceContextResolution(input: {
    plan?: RuntimeStagePlan;
    designBrief?: RuntimeDesignBriefDeclaration;
}): boolean {
    const policy = input.plan?.referencePolicy;
    if (!policy) return false;
    const workMode = input.designBrief?.payload.workMode;
    return workMode ? getReferenceRequirement(policy, workMode) !== 'not_required' : true;
}

export function buildAgentRuntimeReferenceContextState(
    toolCallLog: readonly AgentToolCallLogEntry[]
): RuntimeReferenceContextState {
    const allowedContextRefs = new Set<string>();
    const visualObservations: RuntimeReferenceContextState['visualObservations'] = [];
    let searchAttemptCount = 0;
    let searchFailureCount = 0;
    let visualAnalysisFailureCount = 0;
    toolCallLog.forEach((entry, index) => {
        if (isRuntimeReferenceSearchTool(entry.name)) {
            searchAttemptCount += 1;
            const resultCount = Number(entry.result?.resultCount || 0);
            if (entry.result?.success !== true || resultCount <= 0) searchFailureCount += 1;
            else allowedContextRefs.add(`context:reference_candidates:${index + 1}`);
            return;
        }
        if (!isRuntimeReferenceVisualTool(entry.name)) return;
        if (entry.result?.success !== true) {
            visualAnalysisFailureCount += 1;
            return;
        }
        const itemId = String(
            entry.result?.item?.id
            || entry.arguments?.itemId
            || entry.arguments?.id
            || index + 1
        ).trim();
        const observationRef = buildRuntimeReferenceVisualContextRef(itemId, index + 1);
        const observation = normalizeRuntimeReferenceContextObservation(
            observationRef,
            entry.result?.observation
        );
        if (!observation) {
            visualAnalysisFailureCount += 1;
            return;
        }
        allowedContextRefs.add(observationRef);
        visualObservations.push(observation);
    });
    return {
        allowedContextRefs: Array.from(allowedContextRefs),
        visualObservations,
        searchAttemptCount,
        searchFailureCount,
        visualAnalysisFailureCount
    };
}

export function describeRuntimeReferenceStage(
    declaration: RuntimeReferenceBriefDeclaration | undefined
): string {
    switch (declaration?.readiness) {
        case 'ready':
            return 'R2 Reference Brief 已引用真实视觉工具返回的结构化观察。';
        case 'degraded':
            return 'R2 参考检索已达到预算并记录限制，后续策略必须保持待复核。';
        case 'waived':
            return '当前工作模式按 Skill 策略无需新增参考。';
        default:
            return 'R2 Reference Brief 未形成可用参考上下文。';
    }
}

export function isSuccessfulRuntimeToolObservation(call: ToolCall, result: any): boolean {
    if (result?.success === false || isAgentReadResultCacheHit(result)) return false;
    if (!isRuntimeReferenceVisualTool(call.name)) return true;
    return Boolean(normalizeRuntimeReferenceContextObservation(
        'runtime-reference-observation',
        result?.observation
    ));
}

export function isFromScratchRuntimeDesignTask(input: {
    plan?: RuntimeStagePlan;
    designBrief?: RuntimeDesignBriefDeclaration;
}): boolean {
    if (!input.plan) return false;
    if (!input.designBrief) return true;
    return !runtimeDesignTaskRequiresOpenDocument(
        input.plan,
        input.designBrief.payload.workMode
    );
}

export function buildAgentReferenceContextBlocker(input: {
    toolName: string;
    plan?: RuntimeStagePlan;
    designBrief?: RuntimeDesignBriefDeclaration;
    referenceBrief?: RuntimeReferenceBriefDeclaration;
}): Record<string, unknown> {
    const policy = input.plan?.referencePolicy;
    const workMode = input.designBrief?.payload.workMode;
    return {
        success: false,
        blockedByRuntimeReferenceContext: true,
        code: 'runtime_reference_context_required',
        blockedTool: input.toolName,
        workMode: workMode || 'not_declared',
        requirement: policy && workMode ? getReferenceRequirement(policy, workMode) : 'unknown',
        readiness: input.referenceBrief?.readiness || 'not_declared',
        error: '当前 Skill 要求先形成参考决策。请根据 workMode 检索并真实分析参考、复用已有参考，或明确声明无需参考；候选列表不能替代视觉理解。',
        executesPhotoshop: false,
        grantsPermission: false,
        countsAsObservation: false,
        countsAsTaskProgress: false
    };
}

export function buildAgentReferenceSearchBudgetBlocker(input: {
    toolName: string;
    policy?: RuntimeReferencePolicyProjection;
    workMode?: RuntimeDesignWorkMode;
    context: RuntimeReferenceContextState;
}): Record<string, unknown> | undefined {
    if (!input.policy || !input.workMode || !isRuntimeReferenceSearchTool(input.toolName)) return undefined;
    if (input.context.searchAttemptCount < input.policy.max_search_rounds) return undefined;
    return {
        success: false,
        blockedByRuntimeReferenceSearchBudget: true,
        code: 'runtime_reference_search_budget_exhausted',
        blockedTool: input.toolName,
        searchAttemptCount: input.context.searchAttemptCount,
        maxSearchRounds: input.policy.max_search_rounds,
        error: `参考检索已达到 Skill 规定的 ${input.policy.max_search_rounds} 轮上限。请分析已有候选，或按 reference_policy 如实声明受限降级，不要继续无界检索。`,
        executesPhotoshop: false,
        grantsPermission: false,
        countsAsObservation: false,
        countsAsTaskProgress: false
    };
}

export function buildAgentDesignBriefRequiredBlocker(input: {
    toolName: string;
    brief?: RuntimeDesignBriefDeclaration;
    requiredInputKeys: readonly string[];
}): Record<string, unknown> {
    const missingRequiredInputs = input.brief
        ? input.requiredInputKeys.filter((key) => (
            input.brief?.payload.inputCoverage.find((item) => item.inputKey === key)?.status !== 'provided'
        ))
        : [...input.requiredInputKeys];
    return {
        success: false,
        blockedByRuntimeDesignBrief: true,
        code: 'runtime_design_brief_required',
        blockedTool: input.toolName,
        readiness: input.brief?.readiness || 'not_declared',
        missingRequiredInputs,
        error: input.brief
            ? 'R1 Design Brief 仍缺少必需输入。先用当前开放的只读工具检查文档或项目；仅在读取不可用、失败、已穷尽或仍有歧义时询问用户，补齐后重新声明 Brief。'
            : '执行设计动作前必须先基于当前上下文声明 R1 Design Brief。',
        executesPhotoshop: false,
        grantsPermission: false,
        countsAsObservation: false,
        countsAsTaskProgress: false
    };
}
