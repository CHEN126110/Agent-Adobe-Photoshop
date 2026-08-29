import type {
    ProviderNativeToolCitation,
    ProviderNativeToolRequest,
    ProviderNativeToolUsage
} from './provider-native-tools';
import type { ModelReasoningEffort } from './config/models.config';
import type { DebugBridgeModelTransportMetadata } from './debug-bridge-chat';
import type { ModelVisualPresentationReceipt } from './model-visual-presentation-receipt';
import type { ProviderReportedTokenUsage } from './provider-reported-token-usage';
import type { ProviderTransportMetrics } from './provider-transport-metrics';

export interface AgentToolStreamToolCall {
    id: string;
    name: string;
    arguments: Record<string, any>;
}

export interface AgentToolStreamResponse {
    content?: string;
    thinking?: string;
    toolCalls?: AgentToolStreamToolCall[];
    /** 未完整 Tool delta 中提取的名称诊断；不含参数且不可执行。 */
    incompleteToolCallNames?: string[];
    usage?: ProviderReportedTokenUsage;
    citations?: ProviderNativeToolCitation[];
    nativeToolUsage?: ProviderNativeToolUsage[];
    stopReason?: string;
    streamMode?: 'stream' | 'fallback';
    /** Main-process Provider timing/size facts; absent for uninstrumented fallback transports. */
    providerTransportMetrics?: ProviderTransportMetrics;
    visualPresentationReceipt?: ModelVisualPresentationReceipt;
}

/**
 * 跨 Main → Renderer 的有界模型错误身份。
 *
 * `error` 继续承载可读诊断；这些可选字段只保留 Provider 边界已经产生的结构化
 * 身份，避免 IPC 把 timeout / rate-limit / protocol 等错误压扁成一段无法归因的文字。
 * 不传 stack、response body、请求头或完整 Provider payload。
 */
export interface AgentToolStreamErrorIdentity {
    errorCode?: string;
    errorStatus?: number;
    errorName?: string;
}

export type AgentToolStreamChunk =
    | {
        type: 'content_delta';
        content: string;
    }
    | {
        type: 'thinking_delta';
        thinking: string;
    }
    | {
        type: 'tool_call_delta';
        index: number;
        toolCallId?: string;
        name?: string;
        argumentsDelta?: string;
    }
    | {
        type: 'tool_call_ready';
        toolCall: AgentToolStreamToolCall;
    }
    | {
        type: 'done';
        response: AgentToolStreamResponse;
    }
    | {
        type: 'error';
        error: string;
    } & AgentToolStreamErrorIdentity;

export interface AgentToolStreamRequest {
    requestId: string;
    modelId: string;
    messages: any[];
    tools: any[];
    /** 仅 Debug Bridge IPC 消费；与 Provider options 分离。 */
    debugTransportMetadata?: DebugBridgeModelTransportMetadata;
    options?: {
        maxTokens?: number;
        temperature?: number;
        nativeTools?: ProviderNativeToolRequest[];
        timeoutMs?: number;
        /** 工具循环是否开启原生思考（reasoning_content）；贯通 renderer→main IPC 的思考开关。 */
        thinkingEnabled?: boolean;
        /** 质量 / 速度偏好；仅 Provider 真实声明支持的档位才会被采用。 */
        reasoningEffort?: ModelReasoningEffort;
        visualPresentationCandidateKeys?: string[];
    };
}
