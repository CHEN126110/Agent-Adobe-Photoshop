/**
 * 单次模型请求的 observation-only 会计适配。
 *
 * 调用方仍拥有用途、预算、请求模式和 Provider 选择；本模块只测量真实请求形状与耗时，
 * 并把有界计数交回现有 Runtime Accounting owner。它不保存消息正文、模型输出、Tool
 * 参数或图像，也不改变请求、错误和结果。
 */

import {
    measureRuntimePromptShape,
    type RuntimeContextPreparationShape,
    type RuntimeModelCallKind,
    type RuntimeModelRequestMode,
    type RuntimeModelVisualInput,
    type RuntimeRequestedThinking
} from '../../../shared/agent-runtime-v5/runtime-accounting';
import type { ModelReasoningEffort } from '../../../shared/config/models.config';
import type { ProviderReportedTokenUsage } from '../../../shared/provider-reported-token-usage';
import type { ContextPreparationDiagnostics } from './context-manager';
import type {
    AgentMessage,
    CallModelFn,
    CallModelStreamFn,
    ContentBlock,
    ToolSchema
} from './types';
import type { PerformanceModelBudgetClass } from './performance-ledger';

const RUNTIME_VISUAL_PRESENTATION_KEYS = new WeakMap<object, string>();

export interface ModelCallAccountingDescriptor {
    callKind: RuntimeModelCallKind;
    requestMode: RuntimeModelRequestMode;
    agentIteration: number;
    contextPreparation?: RuntimeContextPreparationShape;
    visualInput?: RuntimeModelVisualInput;
}

export interface PerformanceAwareModelCallAccountingDescriptor
    extends ModelCallAccountingDescriptor {
    visualAnalysis?: boolean;
    budgetClass?: PerformanceModelBudgetClass;
    directVisionCandidateCount?: number;
    directVisionCandidateKeys?: string[];
    billDirectVisionCandidatesByPresentation?: boolean;
}

interface ModelCallRequestedOptions {
    maxTokens?: number;
    thinkingEnabled?: boolean;
    reasoningEffort?: ModelReasoningEffort;
}

export interface ModelCallAccountingRecord {
    callKind: RuntimeModelCallKind;
    requestMode: RuntimeModelRequestMode;
    agentIteration: number;
    runtimeGeneration?: number;
    requestStartedActiveMs?: number;
    durationMs: number;
    succeeded: boolean;
    requestedThinking: RuntimeRequestedThinking;
    requestedReasoningEffort?: ModelReasoningEffort;
    requestedMaxTokens?: number;
    contextPreparation?: RuntimeContextPreparationShape;
    visualInput?: RuntimeModelVisualInput;
    usage?: ProviderReportedTokenUsage;
    promptShape: ReturnType<typeof measureRuntimePromptShape>;
    outcome: unknown;
}

export interface ModelCallAccountingRuntimeDependencies {
    readRuntimeGeneration: () => number | undefined;
    readRequestStartedActiveMs: (startedAtMs: number) => number | undefined;
    readDefaultReasoningEffort: () => ModelReasoningEffort | undefined;
    readThinkingEnabled: () => boolean | undefined;
    callModel: CallModelFn;
    readCallModelStream: () => CallModelStreamFn | undefined;
    settleResponse: (
        response: Awaited<ReturnType<CallModelFn>>
    ) => Awaited<ReturnType<CallModelFn>>;
    beginPerformanceModelCall: (
        visualAnalysis: boolean,
        budgetClass: PerformanceModelBudgetClass,
        directVisionCandidateCount: number,
        directVisionCandidateKeys: string[],
        billDirectVisionCandidatesByPresentation: boolean
    ) => void;
    record: (record: ModelCallAccountingRecord) => void;
    onRecordError: (error: unknown) => void;
}

function projectRequestedThinking(value: boolean | undefined): RuntimeRequestedThinking {
    if (value === true) return 'enabled';
    if (value === false) return 'disabled';
    return 'unspecified';
}

function notifyRecordError(callback: (error: unknown) => void, error: unknown): void {
    try {
        callback(error);
    } catch {
        // Accounting diagnostics must never replace the Provider result or error.
    }
}

export function projectContextPreparationForAccounting(
    value: ContextPreparationDiagnostics
): RuntimeContextPreparationShape {
    return {
        beforeEstimatedTokens: value.beforeEstimatedTokens,
        afterEstimatedTokens: value.afterEstimatedTokens,
        beforeMessageCount: value.beforeMessageCount,
        afterMessageCount: value.afterMessageCount,
        reservedTokens: value.reservedTokens,
        removedMessageCount: value.removedMessageCount,
        compacted: value.compacted
    };
}

export function registerRuntimeVisualPresentationBlock(
    block: ContentBlock,
    observationKey: unknown
): ContentBlock {
    const key = String(observationKey || '').trim();
    if (block.type === 'image' && key) RUNTIME_VISUAL_PRESENTATION_KEYS.set(block, key);
    return block;
}

export function projectCurrentVisualInputForAccounting(
    messages: readonly AgentMessage[],
    observations: ReadonlyArray<{
        observationKey?: string;
        observationIdentity?: { document?: string; history?: string };
    }>
): RuntimeModelVisualInput | undefined {
    const presentedKeys = new Set(messages.flatMap((message) => (
        (message.contentBlocks || [])
            .filter((block) => block.type === 'image')
            .map((block) => RUNTIME_VISUAL_PRESENTATION_KEYS.get(block as object))
            .filter((key): key is string => Boolean(key))
    )));
    const presentedObservations = observations.filter((item) => (
        presentedKeys.has(String(item.observationKey || '').trim())
    ));
    if (presentedObservations.length === 0) return undefined;
    const observationKeys = presentedObservations
        .map((item) => String(item.observationKey || '').trim())
        .filter(Boolean);
    const photoshopRevisions = presentedObservations.flatMap((item) => {
        const documentId = Number(item.observationIdentity?.document);
        const historyStateId = Number(item.observationIdentity?.history);
        return Number.isSafeInteger(documentId) && documentId > 0
            && Number.isSafeInteger(historyStateId) && historyStateId > 0
            ? [{ documentId, historyStateId }]
            : [];
    });
    if (observationKeys.length === 0 && photoshopRevisions.length === 0) return undefined;
    return {
        ...(observationKeys.length > 0 ? { observationKeys } : {}),
        ...(photoshopRevisions.length > 0 ? { photoshopRevisions } : {})
    };
}

export async function executeModelCallWithAccounting<TResponse extends {
    usage?: ProviderReportedTokenUsage;
}>(input: {
    messages: AgentMessage[];
    tools: ToolSchema[];
    requestedOptions: ModelCallRequestedOptions | undefined;
    accounting: ModelCallAccountingDescriptor;
    runtimeGeneration?: number;
    readRequestStartedActiveMs: (startedAtMs: number) => number | undefined;
    beforeRequest?: () => void;
    request: () => Promise<TResponse>;
    record: (record: ModelCallAccountingRecord) => void;
    onRecordError: (error: unknown) => void;
}): Promise<TResponse> {
    input.beforeRequest?.();
    const startedAtMs = Date.now();
    const promptShape = measureRuntimePromptShape({
        messages: input.messages,
        tools: input.tools
    });
    const requestedThinking = projectRequestedThinking(
        input.requestedOptions?.thinkingEnabled
    );
    const baseRecord = {
        ...input.accounting,
        runtimeGeneration: input.runtimeGeneration,
        requestStartedActiveMs: input.readRequestStartedActiveMs(startedAtMs),
        requestedThinking,
        requestedReasoningEffort: input.requestedOptions?.reasoningEffort,
        requestedMaxTokens: input.requestedOptions?.maxTokens,
        promptShape
    };
    let response: TResponse;
    try {
        response = await input.request();
    } catch (error) {
        try {
            input.record({ ...baseRecord, durationMs: Date.now() - startedAtMs, succeeded: false, outcome: error });
        } catch (recordError) {
            notifyRecordError(input.onRecordError, recordError);
        }
        throw error;
    }
    try {
        input.record({
            ...baseRecord,
            durationMs: Date.now() - startedAtMs,
            succeeded: true,
            usage: response.usage,
            outcome: response
        });
    } catch (recordError) {
        notifyRecordError(input.onRecordError, recordError);
    }
    return response;
}

export class ModelCallAccountingRuntime {
    constructor(private readonly dependencies: ModelCallAccountingRuntimeDependencies) {}

    call<TResponse extends { usage?: ProviderReportedTokenUsage }>(input: {
        messages: AgentMessage[];
        tools: ToolSchema[];
        requestedOptions: ModelCallRequestedOptions | undefined;
        accounting: ModelCallAccountingDescriptor;
        beforeRequest?: () => void;
        request: () => Promise<TResponse>;
    }): Promise<TResponse> {
        return executeModelCallWithAccounting({
            ...input,
            runtimeGeneration: this.dependencies.readRuntimeGeneration(),
            readRequestStartedActiveMs: this.dependencies.readRequestStartedActiveMs,
            record: this.dependencies.record,
            onRecordError: this.dependencies.onRecordError
        });
    }

    callProvider(input: {
        modelId: string;
        messages: AgentMessage[];
        tools: ToolSchema[];
        requestedOptions: Parameters<CallModelFn>[3] | undefined;
        defaultReasoningEffort?: ModelReasoningEffort;
        accounting: ModelCallAccountingDescriptor;
        beforeRequest?: () => void;
        callModel: CallModelFn;
        callModelStream?: CallModelStreamFn;
        settleResponse?: (
            response: Awaited<ReturnType<CallModelFn>>
        ) => Awaited<ReturnType<CallModelFn>>;
    }): ReturnType<CallModelFn> {
        const requestedOptions = input.defaultReasoningEffort
            && !input.requestedOptions?.reasoningEffort
            ? { ...input.requestedOptions, reasoningEffort: input.defaultReasoningEffort }
            : input.requestedOptions;
        return this.call({
            messages: input.messages,
            tools: input.tools,
            requestedOptions,
            accounting: input.accounting,
            beforeRequest: input.beforeRequest,
            request: async () => {
                const response = input.callModelStream
                    ? await input.callModelStream(
                        input.modelId,
                        input.messages,
                        input.tools,
                        {
                            ...requestedOptions,
                            onThinkingDelta: () => {},
                            onContentDelta: () => {},
                            onToolCallDelta: () => {}
                        }
                    )
                    : await input.callModel(
                        input.modelId,
                        input.messages,
                        input.tools,
                        requestedOptions
                    );
                return input.settleResponse
                    ? input.settleResponse(response)
                    : response;
            }
        });
    }

    callConfiguredProvider(input: {
        modelId: string;
        messages: AgentMessage[];
        tools: ToolSchema[];
        requestedOptions: Parameters<CallModelFn>[3] | undefined;
        accounting: ModelCallAccountingDescriptor;
        beforeRequest?: () => void;
        settleResponse?: boolean;
    }): ReturnType<CallModelFn> {
        return this.callProvider({
            ...input,
            defaultReasoningEffort: this.dependencies.readDefaultReasoningEffort(),
            callModel: this.dependencies.callModel,
            settleResponse: input.settleResponse
                ? this.dependencies.settleResponse
                : undefined
        });
    }

    callAgentProvider(
        modelId: string,
        messages: AgentMessage[],
        tools: ToolSchema[],
        requestedOptions: Parameters<CallModelFn>[3] | undefined,
        accounting: PerformanceAwareModelCallAccountingDescriptor
    ): ReturnType<CallModelFn> {
        return this.callConfiguredProvider({
            modelId,
            messages,
            tools,
            requestedOptions,
            accounting,
            beforeRequest: accounting.callKind === 'provider_output_recovery'
                ? undefined
                : () => {
                    this.dependencies.beginPerformanceModelCall(
                        accounting.visualAnalysis === true,
                        accounting.budgetClass || 'task',
                        accounting.directVisionCandidateCount || 0,
                        accounting.directVisionCandidateKeys || [],
                        accounting.billDirectVisionCandidatesByPresentation === true
                    );
                },
            settleResponse: accounting.callKind === 'agent_turn'
                || accounting.callKind === 'provider_output_recovery'
        });
    }

    callPrimaryProvider(input: {
        modelId: string;
        messages: AgentMessage[];
        tools: ToolSchema[];
        requestedOptions: Parameters<CallModelFn>[3] | undefined;
        callKind: 'agent_turn' | 'provider_output_recovery';
        agentIteration: number;
        contextPreparation: RuntimeContextPreparationShape;
        visualInput?: RuntimeModelVisualInput;
        beforeRequest?: () => void;
    }): ReturnType<CallModelFn> {
        const callModelStream = this.dependencies.readCallModelStream();
        return this.callProvider({
            modelId: input.modelId,
            messages: input.messages,
            tools: input.tools,
            requestedOptions: {
                ...input.requestedOptions,
                thinkingEnabled: this.dependencies.readThinkingEnabled(),
                reasoningEffort: input.requestedOptions?.reasoningEffort
                    || this.dependencies.readDefaultReasoningEffort()
            },
            accounting: {
                callKind: input.callKind,
                requestMode: callModelStream ? 'stream' : 'non_stream',
                agentIteration: input.agentIteration,
                contextPreparation: input.contextPreparation,
                visualInput: input.visualInput
            },
            beforeRequest: input.beforeRequest,
            callModel: this.dependencies.callModel,
            callModelStream,
            settleResponse: this.dependencies.settleResponse
        });
    }
}
