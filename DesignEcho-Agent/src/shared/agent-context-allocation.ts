/**
 * 上下文预算分配（纯逻辑，无 IO）。
 *
 * 在拿到模型真实上下文窗口之前，这些预算只能写死：历史固定 8 条 / 6400 字符，
 * 不管接的是 8k 窗口的本地小模型还是 1M 窗口的旗舰。两头都不对——
 * 小窗口模型会被工具定义直接撑爆，大窗口模型则白白浪费，Agent"记不住上一轮"。
 *
 * 现在窗口是从 provider 接口真实取到的（见 resolveModelContextWindow），
 * 于是可以按窗口分档给预算。分档而不是按比例连续计算，是因为：
 * 比例算出来的数字每换一个模型就变一次，行为不可预期也不好排查；
 * 分档只有四种结果，出问题时容易定位到是哪一档。
 */

/** 历史对话的注入预算，对应 selectAgentConversationContext 的三个入参。 */
export interface ConversationHistoryBudget {
    maxEntries: number;
    maxCharactersPerEntry: number;
    maxTotalCharacters: number;
    /** 档位名，用于日志与诊断 */
    tier: 'tiny' | 'small' | 'large' | 'huge';
}

export interface AgentContextCapacityPlan {
    version: 'agent-context-capacity/v1';
    /** 已知模型窗口；未知时为 null，绝不伪造模型规格。 */
    windowTokens: number | null;
    basis: 'model_window' | 'unknown_window_fallback';
    /** system、消息、Tool schema 与预留输出共用的总 ceiling；已扣除协议安全余量。 */
    contextTokenCeiling: number;
    outputReserveTokens: number;
    safetyReserveTokens: number;
    runtimeContextCharacterCeiling: number;
    history: ConversationHistoryBudget;
}

/**
 * 历史预算不能无限放大：它只是运行时上下文的一项，
 * 还要和系统提示、项目状态、知识检索结果共用编译器的总预算（64k 字符）。
 * 所以最大档也只取到 20k 字符，留出三分之二给其它项。
 */
const HISTORY_BUDGET_TIERS: readonly ConversationHistoryBudget[] = [
    // 窗口太小的模型（如本地 llava 的 8k）：历史让位给工具定义与当前任务，先保证能跑起来
    { tier: 'tiny', maxEntries: 4, maxCharactersPerEntry: 600, maxTotalCharacters: 2400 },
    // 保持既有默认值，避免中等窗口模型的行为在这次改动里发生变化
    { tier: 'small', maxEntries: 8, maxCharactersPerEntry: 1200, maxTotalCharacters: 6400 },
    { tier: 'large', maxEntries: 12, maxCharactersPerEntry: 1600, maxTotalCharacters: 12000 },
    { tier: 'huge', maxEntries: 16, maxCharactersPerEntry: 2400, maxTotalCharacters: 20000 }
];

export function buildConversationHistoryBudget(
    windowTokens?: number | null
): ConversationHistoryBudget {
    const window = Number(windowTokens) || 0;
    // 窗口未知时走 small 档：它就是本次改动前的既有默认值，
    // 不知道窗口就不该比原来更激进，也不该比原来更保守。
    if (window <= 0) return HISTORY_BUDGET_TIERS[1];
    if (window < 16_000) return HISTORY_BUDGET_TIERS[0];
    if (window < 64_000) return HISTORY_BUDGET_TIERS[1];
    if (window < 256_000) return HISTORY_BUDGET_TIERS[2];
    return HISTORY_BUDGET_TIERS[3];
}

/**
 * 单一上下文容量规划：模型窗口是总盘子，Harness 统一给输出、协议误差、Tool schema、
 * system/runtime context 与历史分账。调用方不得再各自按 64k 字符或 100k token 猜预算。
 */
export function buildAgentContextCapacityPlan(input: {
    windowTokens?: number | null;
    requestedOutputTokens?: number | null;
}): AgentContextCapacityPlan {
    const rawWindow = Number(input.windowTokens) || 0;
    const knownWindow = rawWindow > 0 ? Math.floor(rawWindow) : null;
    const requestedOutput = Math.max(512, Math.floor(Number(input.requestedOutputTokens) || 8192));
    if (!knownWindow) {
        return {
            version: 'agent-context-capacity/v1',
            windowTokens: null,
            basis: 'unknown_window_fallback',
            contextTokenCeiling: 100_000,
            outputReserveTokens: Math.min(8192, requestedOutput),
            safetyReserveTokens: 0,
            runtimeContextCharacterCeiling: 64_000,
            history: buildConversationHistoryBudget(null)
        };
    }

    const safetyReserveTokens = Math.max(512, Math.floor(knownWindow * 0.05));
    const outputReserveTokens = Math.min(
        requestedOutput,
        Math.max(512, Math.floor(knownWindow * 0.20))
    );
    const contextTokenCeiling = Math.max(
        1_000,
        knownWindow - safetyReserveTokens
    );
    let runtimeContextCharacterCeiling = 64_000;
    if (knownWindow < 16_000) runtimeContextCharacterCeiling = 9_000;
    else if (knownWindow < 64_000) runtimeContextCharacterCeiling = 18_000;
    else if (knownWindow < 256_000) runtimeContextCharacterCeiling = 36_000;

    return {
        version: 'agent-context-capacity/v1',
        windowTokens: knownWindow,
        basis: 'model_window',
        contextTokenCeiling,
        outputReserveTokens,
        safetyReserveTokens,
        runtimeContextCharacterCeiling,
        history: buildConversationHistoryBudget(knownWindow)
    };
}

export type ContextFitVerdict = 'fits' | 'tight' | 'exceeds' | 'unknown';

export interface ContextFitAssessment {
    verdict: ContextFitVerdict;
    /** 固定开销（工具定义等）占窗口的比例；窗口未知时为 null */
    fixedRatio: number | null;
    /** 面向用户的中文说明；verdict 为 fits 时为空 */
    reason: string;
}

/**
 * 判断"还没开始对话，光固定开销就装不下"这种情况。
 *
 * 这不是优化提示，是可用性判断：工具定义超过窗口时，这个模型选了也发不出请求，
 * 而 provider 只会回一句上下文超限，用户根本不知道是模型选错了。
 *
 * 窗口未知一律返回 unknown 并放行——不知道不等于装不下，
 * 拦一个其实能用的模型，代价比让它到真实调用时失败更高（见 CLAUDE.md 三态原则）。
 */
export function assessContextFit(input: {
    windowTokens?: number | null;
    fixedOverheadTokens: number;
}): ContextFitAssessment {
    const window = Number(input.windowTokens) || 0;
    const fixed = Math.max(0, Math.round(input.fixedOverheadTokens));
    if (window <= 0) {
        return { verdict: 'unknown', fixedRatio: null, reason: '' };
    }

    const ratio = fixed / window;
    if (ratio >= 1) {
        return {
            verdict: 'exceeds',
            fixedRatio: ratio,
            reason: '仅工具定义就超过了该模型的上下文窗口，选它无法发起设计任务，请换一个窗口更大的主模型。'
        };
    }
    if (ratio >= 0.7) {
        return {
            verdict: 'tight',
            fixedRatio: ratio,
            reason: '工具定义已占去该模型大部分上下文，留给对话与工具结果的空间很小，长任务容易中途被截断。'
        };
    }
    return { verdict: 'fits', fixedRatio: ratio, reason: '' };
}
