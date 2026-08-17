import type {
    AgentCapabilityConstraint,
    AgentIntentControlPlaneDecision
} from './agent-intent-control-plane';

/**
 * 显式用户边界是权限上限，不是意图分类器。
 *
 * 这里只处理两种全局 deny：明确禁止任何工具时上限为 none；明确要求全局只读时上限为
 * read_only。它不改变 requestKind，不选择 Skill，也不根据计划、品类或动作关键词授予权限。
 */
export function applyExplicitAgentCapabilityCeiling(
    runtimeDecision: AgentIntentControlPlaneDecision,
    constraint: AgentCapabilityConstraint
): AgentIntentControlPlaneDecision {
    const mergedSignals = Array.from(new Set([
        ...runtimeDecision.matchedSignals,
        ...constraint.matchedSignals
    ]));

    if (constraint.toolScopeCeiling === 'none') {
        return {
            ...runtimeDecision,
            toolScope: 'none',
            executionAuthorization: 'none',
            reason: '用户明确禁止本轮调用任何工具；通用 Agent 仍可回答，但 Runtime 不得升级为执行。',
            userVisibleSummary: '本轮只用自然语言回复，不调用工具。',
            matchedSignals: [...mergedSignals, 'explicit_tool_scope_ceiling:none']
        };
    }

    if (constraint.toolScopeCeiling !== 'read_only'
        || runtimeDecision.toolScope !== 'write_photoshop') {
        if (constraint.matchedSignals.length === 0) return runtimeDecision;
        return {
            ...runtimeDecision,
            matchedSignals: mergedSignals
        };
    }

    return {
        ...runtimeDecision,
        toolScope: 'read_only',
        reason: '用户已明确把本轮能力限制为全局只读；通用 Agent 可以观察和判断，但不得写入 Photoshop。',
        userVisibleSummary: '本轮只读取必要上下文，不修改画面。',
        matchedSignals: [...mergedSignals, 'explicit_tool_scope_ceiling:read_only']
    };
}
