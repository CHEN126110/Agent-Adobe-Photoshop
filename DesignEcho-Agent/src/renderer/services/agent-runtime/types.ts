import type { AgentThinkingEventMeta } from '../../../shared/agent-observation-channels';
import type { AgentIntentControlPlaneDecision } from '../../../shared/agent-intent-control-plane';
import type { ProviderNativeToolRequest } from '../../../shared/provider-native-tools';

export type { AgentThinkingEventMeta };

export interface ToolSchema {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, any>;
        required?: string[];
    };
}

export interface ToolCall {
    id: string;
    name: string;
    arguments: Record<string, any>;
}

export interface ToolResult {
    callId: string;
    success: boolean;
    output: any;
}

export interface ContentBlock {
    type: 'text' | 'image';
    text?: string;
    data?: string;
    mediaType?: string;
}

export interface AgentMessage {
    role: 'system' | 'user' | 'assistant' | 'tool_result';
    content?: string;
    contentBlocks?: ContentBlock[];
    toolCalls?: ToolCall[];
    toolResults?: ToolResult[];
}

export interface ImageAttachment {
    data: string;
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
}

export type AgentStepKind =
    | 'task_started'
    | 'iteration_started'
    | 'model_request'
    | 'model_response'
    | 'tool_planned'
    | 'tool_started'
    | 'tool_completed'
    | 'observation'
    | 'verification'
    | 'warning'
    | 'finalizing'
    | 'stopped';

export interface AgentStepEvent {
    kind: AgentStepKind;
    title: string;
    detail?: string;
    status: 'pending' | 'running' | 'success' | 'error';
    iteration?: number;
    maxIterations?: number;
    toolName?: string;
    toolCallId?: string;
    percent?: number;
    issue?: string;
}

export interface AgentConfig {
    systemPrompt: string;
    tools: ToolSchema[];
    modelId: string;
    maxIterations: number;
    requireInitialToolCall?: boolean;
    signal?: AbortSignal;
    taskCompletionContext?: TaskCompletionContext;
    toolDecisionContext?: AgentToolDecisionContext;
    callbacks: AgentCallbacks;
    callModelStream?: CallModelStreamFn;
}

export interface AgentToolDecisionContext {
    intentControlPlane?: AgentIntentControlPlaneDecision;
    photoshopConnected?: boolean;
    hasDocument?: boolean;
    hasImageInput?: boolean;
}

export interface AgentCallbacks {
    /** Provider/native thinking or model-authored public reasoning summary. Do not fabricate chain-of-thought. */
    onThinking?: (thinking: string, meta?: AgentThinkingEventMeta) => void;
    /** Structured observable step. Preferred for Pondering/diagnostics UI. */
    onStep?: (step: AgentStepEvent) => void;
    onStatus?: (message: string) => void;
    onToolStart?: (toolName: string) => void;
    onToolComplete?: (toolName: string, result: any) => void;
    onProgress?: (message: string, percent: number) => void;
    onMessage?: (message: string) => void;
    onIterationComplete?: (iteration: number, maxIterations: number) => void;
}

export type AgentStopReason =
    | 'final_response'
    | 'tool_budget_final_response'
    | 'tool_preflight_blocked'
    | 'max_iterations'
    | 'no_progress'
    | 'empty_final_response'
    | 'cancelled'
    | 'error';

export type AgentExecutionStatus =
    | 'completed'
    | 'needs_review'
    | 'failed'
    | 'cancelled';

export interface AgentToolCallLogEntry {
    name: string;
    arguments: any;
    result: any;
}

export type TaskCompletionKind =
    | 'reference_replication'
    | 'text_content_edit'
    | 'text_typography_edit'
    | 'layer_order_edit'
    | 'layer_management'
    | 'document_save'
    | 'document_close';

export interface TaskCompletionRequirement {
    id: string;
    label: string;
    status: 'passed' | 'failed' | 'needs_review' | 'not_applicable';
    reason?: string;
    expected?: unknown;
    actual?: unknown;
}

export interface TaskCompletionEvidence {
    toolAcceptance: {
        verified: number;
        failed: number;
        needsReview: number;
        noDocumentChangeRisk: number;
    };
    visual?: {
        mode: 'none' | 'bounds_only' | 'screenshot' | 'overlay' | 'model_review';
        snapshotCount?: number;
        overlayCount?: number;
        blockers?: string[];
        warnings?: string[];
    };
    coverage?: {
        expected: number;
        applied: number;
        failed: number;
        skipped: number;
        missingIds?: string[];
    };
}

export interface TaskCompletionContract {
    kind: TaskCompletionKind;
    status: AgentExecutionStatus;
    required: TaskCompletionRequirement[];
    evidence: TaskCompletionEvidence;
    blockers: string[];
    warnings: string[];
    summary: string;
}

export interface TaskCompletionContext {
    skillId?: string;
    intentMode?: string;
    imageCount?: number;
}

export interface AgentExecutionSummary {
    status: AgentExecutionStatus;
    stopReason: AgentStopReason;
    iterations: number;
    toolCallCount: number;
    successfulToolCalls: number;
    failedToolCalls: number;
    acceptanceVerified: number;
    acceptanceFailed: number;
    acceptanceNeedsReview: number;
    noDocumentChangeRisks: number;
    lastToolName?: string;
    lastError?: string;
    blockers: string[];
    warnings: string[];
    taskCompletion?: TaskCompletionContract;
    summaryText: string;
}

export interface AgentRunResult {
    success: boolean;
    message: string;
    messages: AgentMessage[];
    iterations: number;
    toolCallLog: AgentToolCallLogEntry[];
    cancelled?: boolean;
    error?: string;
    stopReason?: AgentStopReason;
    executionSummary?: AgentExecutionSummary;
}

export type CallModelFn = (
    modelId: string,
    messages: AgentMessage[],
    tools: ToolSchema[],
    options?: { maxTokens?: number; temperature?: number; nativeTools?: ProviderNativeToolRequest[] }
) => Promise<{
    content?: string;
    toolCalls?: ToolCall[];
    thinking?: string;
    usage?: { inputTokens: number; outputTokens: number };
    stopReason?: string;
}>;

export type CallModelStreamFn = (
    modelId: string,
    messages: AgentMessage[],
    tools: ToolSchema[],
    options?: {
        maxTokens?: number;
        temperature?: number;
        nativeTools?: ProviderNativeToolRequest[];
        onContentDelta?: (fullContent: string, delta: string) => void;
        onThinkingDelta?: (fullThinking: string, delta: string) => void;
        onToolCallDelta?: (chunk: {
            index: number;
            toolCallId?: string;
            name?: string;
            argumentsDelta?: string;
        }) => void;
        onToolCallReady?: (toolCall: ToolCall) => void;
    }
) => Promise<{
    content?: string;
    toolCalls?: ToolCall[];
    thinking?: string;
    usage?: { inputTokens: number; outputTokens: number };
    stopReason?: string;
    streamMode?: 'stream' | 'fallback';
}>;

export type ExecuteToolFn = (toolName: string, params: any) => Promise<any>;
