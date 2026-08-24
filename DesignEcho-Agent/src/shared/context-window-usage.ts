/**
 * 上下文占用估算（纯逻辑，无 IO）。
 *
 * 口径必须与运行时同源，否则面板会和真实行为打架：
 * - token 估算沿用 ContextManager 的 `字符数 / 1.5`（见 agent-runtime/context-manager.ts）。
 *   这是粗略估算，不等于 provider 的真实计费 token，对外必须标明"估算"。
 * - 分母优先用模型自己声明的 contextWindow；模型没声明就退回 Agent 的消息压缩预算
 *   （buildAgentContextWindowBudget，默认 100k），并把依据一起告诉用户——
 *   不要为了画出一个百分比就编一个窗口大小。
 *
 * 只统计"能确定的部分"：工具定义与消息历史。系统提示词与运行时上下文项是在
 * 执行器里现场编译的，发起运行前拿不到，宁可如实标为未计入，也不塞一个猜测值。
 */

/** 每张图片按固定字符数折算，与 ContextManager.estimateTokens 保持一致。 */
const IMAGE_CHARS = 1200;

/** 字符换算 token 的粗略系数，与 ContextManager 同源。 */
const CHARS_PER_TOKEN = 1.5;

import { assessContextFit, type ContextFitAssessment } from './agent-context-allocation';

export type ContextUsageSegmentKey = 'tools' | 'messages' | 'free';

export interface ContextUsageSegment {
    key: ContextUsageSegmentKey;
    label: string;
    tokens: number;
    /** 占整个窗口的比例，0~1 */
    ratio: number;
}

export type ContextWindowBasis = 'model_declared' | 'provider_default' | 'agent_budget';

export interface ContextWindowUsage {
    /** 分母：窗口大小 */
    windowTokens: number;
    /** 窗口大小的依据，决定界面上怎么解释这个数 */
    basis: ContextWindowBasis;
    usedTokens: number;
    /** 已用比例 0~1；已用超过窗口时可能 > 1，由展示端裁剪 */
    ratio: number;
    segments: ContextUsageSegment[];
    /** 未纳入统计的部分，如实告知，避免用户以为这就是全部 */
    uncountedNotes: string[];
    /**
     * 固定开销（工具定义）相对窗口是否装得下。
     * 这不是"用得多不多"，是"这个模型选了能不能用"——超窗时连第一次请求都发不出去。
     */
    fit: ContextFitAssessment;
}

export function estimateTextTokens(text: unknown): number {
    const value = typeof text === 'string' ? text : '';
    if (!value) return 0;
    return Math.ceil(value.length / CHARS_PER_TOKEN);
}

/** 工具定义按实际序列化后的 JSON 计算——那才是真正发给模型的东西。 */
export function estimateToolSchemaTokens(tools: readonly unknown[]): number {
    if (!Array.isArray(tools) || tools.length === 0) return 0;
    return estimateTextTokens(JSON.stringify(tools));
}

export interface ContextUsageMessageInput {
    content?: unknown;
    /** 附带的图片数量；每张按固定字符折算 */
    imageCount?: number;
}

export function estimateMessageTokens(messages: readonly ContextUsageMessageInput[]): number {
    if (!Array.isArray(messages) || messages.length === 0) return 0;
    let chars = 0;
    for (const message of messages) {
        const content = typeof message?.content === 'string'
            ? message.content
            : JSON.stringify(message?.content ?? '');
        chars += content.length;
        const images = Number(message?.imageCount) || 0;
        if (images > 0) chars += images * IMAGE_CHARS;
    }
    return Math.ceil(chars / CHARS_PER_TOKEN);
}

export function buildContextWindowUsage(input: {
    /**
     * 已解析出的模型上下文窗口（来自 resolveModelContextWindow）。
     * 解析不出就传 null，不要传 0 或猜测值——让退路逻辑走明路。
     */
    modelContextWindow?: { tokens: number; basis: 'model_declared' | 'provider_default' } | null;
    /** Agent 的消息压缩预算，作为窗口完全未知时的最后退路 */
    agentBudgetTokens: number;
    toolTokens: number;
    messageTokens: number;
}): ContextWindowUsage {
    const resolved = input.modelContextWindow;
    const windowTokens = resolved && resolved.tokens > 0 ? resolved.tokens : input.agentBudgetTokens;
    const basis: ContextWindowBasis = resolved && resolved.tokens > 0 ? resolved.basis : 'agent_budget';

    const toolTokens = Math.max(0, Math.round(input.toolTokens));
    const messageTokens = Math.max(0, Math.round(input.messageTokens));
    const usedTokens = toolTokens + messageTokens;
    const freeTokens = Math.max(0, windowTokens - usedTokens);

    const ratioOf = (tokens: number): number => (windowTokens > 0 ? tokens / windowTokens : 0);

    return {
        windowTokens,
        basis,
        usedTokens,
        ratio: ratioOf(usedTokens),
        segments: [
            { key: 'tools', label: '工具定义', tokens: toolTokens, ratio: ratioOf(toolTokens) },
            { key: 'messages', label: '对话历史', tokens: messageTokens, ratio: ratioOf(messageTokens) },
            { key: 'free', label: '剩余空间', tokens: freeTokens, ratio: ratioOf(freeTokens) }
        ],
        uncountedNotes: [
            '系统提示词与运行时上下文在执行时现场编译，未计入',
            // 这条很重要：一次运行内部的工具调用与工具结果远大于对话本身，
            // 但它们只活在那次运行里、不进对话存档，面板看不到也量不到。
            // 不写清楚，用户会以为「6% 已用」代表运行时也很空。
            '任务执行期间的工具调用与结果只存在于该次运行内，不计入此处'
        ],
        // 只用模型自己/渠道公布的窗口判断；退回 Agent 预算时窗口其实未知，不能据此说装不下
        fit: assessContextFit({
            windowTokens: resolved && resolved.tokens > 0 ? resolved.tokens : null,
            fixedOverheadTokens: toolTokens
        })
    };
}

/**
 * 展示用的紧凑数字：1234 → 1.2k，1000000 → 1M。
 *
 * M 档不是装饰：Claude 订阅、DeepSeek、部分 OpenRouter 模型的真实窗口就是 1M，
 * 只有 k 档时面板会写成 "1000k"——读起来像四位数的 k，反而比 100k 更难一眼判断余量。
 */
export function formatTokenCount(tokens: number): string {
    const value = Math.max(0, Math.round(tokens));
    if (value < 1000) return String(value);
    if (value < 1_000_000) return `${(value / 1000).toFixed(value >= 100_000 ? 0 : 1)}k`;
    const millions = value / 1_000_000;
    // 1M / 2M 这类整数窗口不写成 "1.0M"，省掉一个没有信息量的小数位。
    return Number.isInteger(millions) ? `${millions}M` : `${millions.toFixed(1)}M`;
}
