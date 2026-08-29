/**
 * 性能预算边界的终局结算。
 *
 * 预算只停止购买新的执行回合；任务是否完成仍由同一个 Terminal Closure 的结构化事实决定。
 * 本模块不执行模型或 Tool，只编排已经存在的 closure/build 回调。
 */

import type { PerformanceBudgetExhaustion } from './performance-ledger';
import type {
    AgentRunResultInput,
    PreparedAgentTerminalClosure
} from './terminal-closure-checkpoint';
import type { AgentRunResult, AgentStepEvent } from './types';

interface PerformanceBudgetTerminalSettlementInput {
    exhaustion: PerformanceBudgetExhaustion;
    iterations: number;
    maxIterations: number;
    modelCalls: number;
    toolCalls: number;
    elapsedMs: number;
    prepareClosure: (input: AgentRunResultInput) => Promise<PreparedAgentTerminalClosure>;
    buildRunResult: (
        input: AgentRunResultInput,
        prepared: PreparedAgentTerminalClosure
    ) => Promise<AgentRunResult>;
    emitStep: (step: AgentStepEvent) => void;
    onProgress?: (message: string, progress: number) => void;
}

export async function settlePerformanceBudgetTerminal(
    input: PerformanceBudgetTerminalSettlementInput
): Promise<AgentRunResult> {
    const resultInput: AgentRunResultInput = {
        success: false,
        message: input.exhaustion.message,
        iterations: input.iterations,
        error: input.exhaustion.code,
        stopReason: 'performance_budget',
        data: {
            performanceBudget: {
                ...input.exhaustion,
                modelCalls: input.modelCalls,
                toolCalls: input.toolCalls,
                elapsedMs: input.elapsedMs
            }
        }
    };
    const preparedClosure = await input.prepareClosure(resultInput);
    const completed = preparedClosure.executionSummary.status === 'completed';
    if (!completed) {
        input.emitStep({
            kind: 'stopped',
            title: '任务尚未完成',
            detail: input.exhaustion.message,
            status: 'error',
            iteration: input.iterations,
            maxIterations: input.maxIterations,
            issue: input.exhaustion.code,
            audience: 'user',
            visibility: 'user_process'
        });
        input.onProgress?.('当前制作暂时停下，已保留现有进度', 100);
    }
    return input.buildRunResult({
        ...resultInput,
        success: completed,
        message: completed
            ? preparedClosure.executionSummary.summaryText
            : input.exhaustion.message
    }, preparedClosure);
}

export function describeIncompletePerformanceBudgetStop(
    hasViewableDesignChange: boolean
): string {
    return hasViewableDesignChange
        ? '这稿先做到这里、还没做完，你可以先看看现在的效果，或让我接着做。'
        : '这次我还没真正开始动手做设计就停下了，你可以让我继续。';
}
