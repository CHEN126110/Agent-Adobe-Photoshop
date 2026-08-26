import { classifyAgentToolExecution } from '../../../shared/agent-tool-execution-preflight';
import {
    findObservedPhotoshopMutationProof,
    type PhotoshopHistoryStateRef
} from '../../../shared/photoshop-history-state-ref';
import type { ToolCall, ToolResult } from './types';

const MAX_MUTATION_BOUND_DESIGN_INTENTS = 3;
const MAX_MUTATION_BOUND_DESIGN_INTENT_CHARS = 1600;

/**
 * 模型在真实 Photoshop 写入所在回合公开表达的设计意图。
 * 仅存于当前 Agent 实例，不进入 Project State，也不读取 provider 私有 thinking。
 */
export interface MutationBoundDesignIntent {
    modelTurn: number;
    text: string;
    committedCalls: Array<{
        callId: string;
        target: PhotoshopHistoryStateRef;
    }>;
}

function normalizePublicIntentText(value: unknown): string {
    const text = String(value || '').replace(/\s+/gu, ' ').trim();
    if (!text) return '';
    return text.slice(0, MAX_MUTATION_BOUND_DESIGN_INTENT_CHARS);
}

export function appendMutationBoundDesignIntent(input: {
    current: readonly MutationBoundDesignIntent[];
    modelTurn: number;
    publicText: unknown;
    toolCalls: readonly ToolCall[];
    toolResults: readonly ToolResult[];
}): MutationBoundDesignIntent[] {
    const text = normalizePublicIntentText(input.publicText);
    if (!text) return [...input.current];

    const resultByCallId = new Map(input.toolResults.map((result) => [result.callId, result]));
    const committedCalls = input.toolCalls
        .map((call) => {
            if (classifyAgentToolExecution(call.name, call.arguments) !== 'photoshop_write') return undefined;
            const result = resultByCallId.get(call.id);
            if (result?.success !== true) return undefined;
            const proof = findObservedPhotoshopMutationProof(result.output);
            if (proof?.toolActionCompleted !== true) return undefined;
            return {
                callId: call.id,
                target: proof.after
            };
        })
        .filter((call): call is MutationBoundDesignIntent['committedCalls'][number] => call !== undefined);
    if (committedCalls.length === 0) return [...input.current];

    return [
        ...input.current,
        {
            modelTurn: Math.max(0, Math.floor(input.modelTurn)),
            text,
            committedCalls: Array.from(
                new Map(committedCalls.map((call) => [call.callId, call])).values()
            ).slice(0, 12)
        }
    ].slice(-MAX_MUTATION_BOUND_DESIGN_INTENTS);
}

export function formatMutationBoundDesignIntentForReview(
    intents: readonly MutationBoundDesignIntent[],
    targetDocumentId: number
): string {
    if (!Number.isSafeInteger(targetDocumentId) || targetDocumentId <= 0) return '';
    return intents
        .slice(-MAX_MUTATION_BOUND_DESIGN_INTENTS)
        .filter((intent) => {
            const documentIds = new Set(intent.committedCalls.map((call) => call.target.documentId));
            return documentIds.size === 1 && documentIds.has(targetDocumentId);
        })
        .map((intent) => `第 ${intent.modelTurn + 1} 轮对当前成品文档真实写入前的公开设计判断：${intent.text}`)
        .join('\n');
}
