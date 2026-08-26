/**
 * 流式聊天服务（渲染进程端）
 * 
 * 提供便捷的流式聊天接口，处理 IPC 通信。
 * 
 * @example
 * const stream = streamChat(modelId, messages, {
 *     onContent: (content) => console.log('内容:', content),
 *     onThinking: (thinking) => console.log('思考:', thinking),
 *     onDone: (response) => console.log('完成:', response),
 *     onError: (error) => console.error('错误:', error)
 * });
 * 
 * // 取消
 * stream.abort();
 */

import { normalizeStreamTextChunk } from '../../shared/stream-text-normalizer';
import {
    isProviderStreamOutputBlocked,
    isProviderStreamOutputIncomplete
} from '../../shared/provider-stream-completion';

// ==================== 类型定义 ====================

export interface StreamChunk {
    type: 'content' | 'thinking' | 'done' | 'error';
    content?: string;
    thinking?: string;
    fullResponse?: {
        text: string;
        thinking?: string;
        usage?: {
            inputTokens: number;
            outputTokens: number;
        };
        stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stream_incomplete' | 'content_blocked';
    };
    error?: string;
}

export interface StreamCallbacks {
    /** 收到内容片段 */
    onContent?: (content: string) => void;
    /** 收到思维过程片段 */
    onThinking?: (thinking: string) => void;
    /** 流式完成 */
    onDone?: (response: StreamChunk['fullResponse']) => void;
    /** 发生错误 */
    onError?: (error: string) => void;
}

export interface StreamOptions {
    maxTokens?: number;
    temperature?: number;
    thinkingEnabled?: boolean;
    timeoutMs?: number;
}

export interface StreamHandle {
    /** 请求 ID */
    requestId: string;
    /** 取消请求 */
    abort: () => Promise<void>;
    /** Promise 形式等待完成 */
    promise: Promise<StreamChunk['fullResponse'] | null>;
}

// ==================== 全局状态 ====================

// 存储活跃的流式请求回调
const activeCallbacks = new Map<string, StreamCallbacks>();

// 监听器注册状态
let listenerRegistered = false;

/**
 * 注册全局监听器
 */
function ensureListenerRegistered(): void {
    if (listenerRegistered) return;
    
    const designEcho = (window as any).designEcho;
    if (!designEcho?.onStreamChunk) {
        console.error('[StreamChat] designEcho.onStreamChunk 不可用');
        return;
    }
    
    designEcho.onStreamChunk((data: { requestId: string; chunk: StreamChunk }) => {
        const { requestId, chunk } = data;
        const callbacks = activeCallbacks.get(requestId);

        if (!callbacks) return;
        
        switch (chunk.type) {
            case 'content':
                callbacks.onContent?.(chunk.content || '');
                break;
            case 'thinking':
                callbacks.onThinking?.(chunk.thinking || '');
                break;
            case 'done':
                callbacks.onDone?.(chunk.fullResponse);
                activeCallbacks.delete(requestId);
                break;
            case 'error':
                callbacks.onError?.(chunk.error || '未知错误');
                activeCallbacks.delete(requestId);
                break;
        }
    });
    
    listenerRegistered = true;
    console.log('[StreamChat] 全局监听器已注册');
}

// ==================== 主函数 ====================

/**
 * 生成唯一请求 ID
 */
function generateRequestId(): string {
    return `stream-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 流式聊天
 * 
 * @param modelId 模型 ID
 * @param messages 消息列表
 * @param callbacks 回调函数
 * @param options 选项
 * @returns 流式句柄，可用于取消
 */
export function streamChat(
    modelId: string,
    messages: Array<{ role: string; content: string }>,
    callbacks: StreamCallbacks,
    options?: StreamOptions
): StreamHandle {
    ensureListenerRegistered();
    
    const requestId = generateRequestId();
    const designEcho = (window as any).designEcho;
    
    if (!designEcho?.chatStream) {
        const error = 'designEcho.chatStream 不可用';
        callbacks.onError?.(error);
        return {
            requestId,
            abort: async () => {},
            promise: Promise.resolve(null)
        };
    }
    
    // 创建 Promise 用于等待完成
    let streamSettled = false;
    let rejectAborted: (() => void) | null = null;
    const wrappedCallbacks: StreamCallbacks = { ...callbacks };
    const promise = new Promise<StreamChunk['fullResponse'] | null>((resolve, reject) => {
        wrappedCallbacks.onDone = (response) => {
            if (streamSettled) return;
            streamSettled = true;
            callbacks.onDone?.(response);
            resolve(response || null);
        };
        wrappedCallbacks.onError = (error) => {
            if (streamSettled) return;
            streamSettled = true;
            callbacks.onError?.(error);
            reject(new Error(error));
        };
        rejectAborted = () => {
            if (streamSettled) return;
            streamSettled = true;
            const error = new Error('模型流式请求已取消') as Error & { code?: string };
            error.name = 'AbortError';
            error.code = 'stream_aborted';
            reject(error);
        };
    });

    activeCallbacks.set(requestId, wrappedCallbacks);
    
    // 发起请求
    designEcho.chatStream({
        requestId,
        modelId,
        messages,
        options
    }).then((result: { success: boolean; error?: string }) => {
        if (!result.success) {
            wrappedCallbacks.onError?.(result.error || '请求失败');
            activeCallbacks.delete(requestId);
        }
    }).catch((error: Error) => {
        wrappedCallbacks.onError?.(error.message);
        activeCallbacks.delete(requestId);
    });
    
    return {
        requestId,
        abort: async () => {
            rejectAborted?.();
            activeCallbacks.delete(requestId);
            if (designEcho.abortStream) {
                await designEcho.abortStream(requestId);
            }
        },
        promise
    };
}

/**
 * 简化的流式聊天（返回 Promise）
 * 
 * 适用于不需要实时显示的场景，但仍使用流式传输
 */
export async function streamChatAsync(
    modelId: string,
    messages: Array<{ role: string; content: string }>,
    options?: StreamOptions & {
        onProgress?: (content: string, chunk: string) => void;
        onThinkingProgress?: (thinking: string, chunk: string) => void;
    }
): Promise<{ text: string; thinking?: string }> {
    let fullThinking = '';
    const { onProgress, onThinkingProgress, ...streamOptions } = options || {};
    const timeoutMs = Number(options?.timeoutMs || 0);
    const hasInactivityTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let timeoutReject: ((reason?: any) => void) | null = null;
    let streamSettled = false;
    let handle: StreamHandle | null = null;

    function clearStreamInactivityTimeout(): void {
        if (!timeoutId) return;
        clearTimeout(timeoutId);
        timeoutId = null;
    }

    function refreshStreamInactivityTimeout(): void {
        if (!hasInactivityTimeout || !timeoutReject || streamSettled) return;
        clearStreamInactivityTimeout();
        timeoutId = setTimeout(() => {
            if (streamSettled) return;
            void handle?.abort().catch(() => undefined);
            timeoutReject?.(new Error(`Stream chat timeout after ${Math.round(timeoutMs)}ms`));
        }, timeoutMs);
    }

    const timeoutPromise = hasInactivityTimeout
        ? new Promise<StreamChunk['fullResponse'] | null>((_resolve, reject) => {
            timeoutReject = reject;
        })
        : null;

    handle = streamChat(
        modelId,
        messages,
        {
            onContent: (content) => {
                if (!content) return;
                refreshStreamInactivityTimeout();
            },
            onThinking: (thinking) => {
                const normalized = normalizeStreamTextChunk(fullThinking, thinking);
                fullThinking = normalized.fullText;
                if (normalized.deltaText) {
                    refreshStreamInactivityTimeout();
                }
            }
        },
        streamOptions
    );

    refreshStreamInactivityTimeout();

    try {
        const response = await (
            timeoutPromise
                ? Promise.race([handle.promise, timeoutPromise])
                : handle.promise
        );
        if (!response) {
            throw new Error('模型流没有返回明确完成状态，已丢弃未确认的部分内容。');
        }
        if (response && isProviderStreamOutputIncomplete(response.stopReason)) {
            throw new Error('模型流没有完整结束，已丢弃未确认的部分内容。');
        }
        if (response && isProviderStreamOutputBlocked(response.stopReason)) {
            throw new Error('模型服务没有返回可交付的完整内容。');
        }
        const committedText = response.text;
        const committedThinking = response.thinking || fullThinking || undefined;
        // Provider 原始内容增量不进入 Message Store；只提交完整终态返回的权威清洗文本。
        if (committedText) onProgress?.(committedText, committedText);
        if (committedThinking) {
            onThinkingProgress?.(committedThinking, committedThinking);
        }
        return {
            text: committedText,
            thinking: committedThinking
        };
    } finally {
        streamSettled = true;
        clearStreamInactivityTimeout();
    }
}

// 类型已在定义处导出，无需重复导出
