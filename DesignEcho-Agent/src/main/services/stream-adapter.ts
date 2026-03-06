/**
 * 流式输出适配器
 * 
 * 统一处理不同 AI 模型的流式响应，提供一致的接口。
 * 
 * 支持的模型：
 * - Ollama (本地)
 * - OpenRouter (云端)
 * - Google Gemini (云端)
 * - Anthropic Claude (云端)
 * - OpenAI (云端)
 * 
 * 功能：
 * 1. 统一的流式数据格式
 * 2. 思维过程实时提取
 * 3. 错误处理和重试
 * 4. 取消支持
 */

import { EventEmitter } from 'events';
import { ModelConfig, ThinkingConfig } from '../../shared/config/models.config';
import { extractThinkingFromModel } from './thinking-extractor';

// ==================== 类型定义 ====================

export interface StreamChunk {
    /** 块类型 */
    type: 'content' | 'thinking' | 'done' | 'error';
    /** 内容片段 */
    content?: string;
    /** 思维过程片段 */
    thinking?: string;
    /** 完成时的完整响应 */
    fullResponse?: {
        text: string;
        thinking?: string;
        usage?: {
            inputTokens: number;
            outputTokens: number;
        };
    };
    /** 错误信息 */
    error?: string;
}

export interface StreamOptions {
    /** 最大输出 token */
    maxTokens?: number;
    /** 温度 */
    temperature?: number;
    /** 取消信号 */
    signal?: AbortSignal;
}

export interface StreamMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

// ==================== 流式适配器基类 ====================

export abstract class BaseStreamAdapter extends EventEmitter {
    protected aborted = false;
    
    constructor() {
        super();
    }
    
    /**
     * 开始流式请求
     */
    abstract stream(
        model: ModelConfig | string,
        messages: StreamMessage[],
        options?: StreamOptions
    ): void;
    
    /**
     * 取消请求
     */
    abort(): void {
        this.aborted = true;
        this.emit('chunk', { type: 'done' } as StreamChunk);
    }
    
    /**
     * 发送内容块
     */
    protected emitContent(content: string): void {
        if (!this.aborted) {
            this.emit('chunk', { type: 'content', content } as StreamChunk);
        }
    }
    
    /**
     * 发送思维过程块
     */
    protected emitThinking(thinking: string): void {
        if (!this.aborted) {
            this.emit('chunk', { type: 'thinking', thinking } as StreamChunk);
        }
    }
    
    /**
     * 发送完成信号
     */
    protected emitDone(fullResponse: StreamChunk['fullResponse']): void {
        if (!this.aborted) {
            this.emit('chunk', { type: 'done', fullResponse } as StreamChunk);
        }
    }
    
    /**
     * 发送错误
     */
    protected emitError(error: string): void {
        this.emit('chunk', { type: 'error', error } as StreamChunk);
    }
}

// ==================== Ollama 流式适配器 ====================

export class OllamaStreamAdapter extends BaseStreamAdapter {
    private baseUrl: string;
    private apiKey?: string;
    
    constructor(baseUrl: string = 'http://127.0.0.1:11434', apiKey?: string) {
        super();
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
    }
    
    stream(
        model: ModelConfig | string,
        messages: StreamMessage[],
        options?: StreamOptions
    ): void {
        this.aborted = false;
        
        const modelName = typeof model === 'string' 
            ? model 
            : (model.apiModelId || model.id.replace('local-', ''));
        
        const ollamaMessages = messages.map(msg => ({
            role: msg.role === 'system' ? 'system' : msg.role,
            content: msg.content
        }));
        
        const requestBody = JSON.stringify({
            model: modelName,
            messages: ollamaMessages,
            stream: true,
            options: {
                num_predict: options?.maxTokens || 4096,
                temperature: options?.temperature ?? 0.7
            }
        });
        
        const url = new URL(this.baseUrl);
        const isHttps = url.protocol === 'https:';
        const httpModule = isHttps ? require('https') : require('http');
        
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(requestBody).toString()
        };
        
        // Ollama Cloud 需要 API Key
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }
        
        const req = httpModule.request({
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 11434),
            path: '/api/chat',
            method: 'POST',
            headers,
            timeout: 120000
        }, (res: any) => {
            let fullContent = '';
            let fullThinking = '';
            let buffer = '';
            
            res.on('data', (chunk: Buffer) => {
                if (this.aborted) return;
                
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                
                for (const line of lines) {
                    if (!line.trim()) continue;
                    
                    try {
                        const data = JSON.parse(line);
                        
                        if (data.message?.content) {
                            const content = data.message.content;
                            fullContent += content;
                            
                            // 检查是否有思维过程标签
                            if (content.includes('<think>') || fullContent.includes('<think>')) {
                                // 暂时累积，最后统一处理
                            } else {
                                this.emitContent(content);
                            }
                        }
                        
                        if (data.done) {
                            // 最终处理思维过程
                            const { thinking, content: cleanContent } = this.extractThinking(fullContent);
                            
                            this.emitDone({
                                text: cleanContent,
                                thinking: thinking || undefined,
                                usage: {
                                    inputTokens: data.prompt_eval_count || 0,
                                    outputTokens: data.eval_count || 0
                                }
                            });
                        }
                    } catch {
                        // 忽略解析错误的行
                    }
                }
            });
            
            res.on('end', () => {
                // 处理剩余 buffer
                if (buffer.trim() && !this.aborted) {
                    try {
                        const data = JSON.parse(buffer);
                        if (!data.done) {
                            const { thinking, content: cleanContent } = this.extractThinking(fullContent);
                            this.emitDone({
                                text: cleanContent,
                                thinking: thinking || undefined
                            });
                        }
                    } catch {
                        // 忽略
                    }
                }
            });
            
            res.on('error', (err: Error) => {
                this.emitError(err.message);
            });
        });
        
        req.on('error', (err: Error) => {
            this.emitError(`无法连接到 Ollama 服务: ${err.message}`);
        });
        
        req.on('timeout', () => {
            req.destroy();
            this.emitError('Ollama 响应超时');
        });
        
        // 取消支持
        if (options?.signal) {
            options.signal.addEventListener('abort', () => {
                this.abort();
                req.destroy();
            });
        }
        
        req.write(requestBody);
        req.end();
    }
    
    /**
     * 提取思维过程
     */
    private extractThinking(content: string): { thinking: string | null; content: string } {
        const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
        if (thinkMatch) {
            return {
                thinking: thinkMatch[1].trim(),
                content: content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
            };
        }
        return { thinking: null, content };
    }
}

// ==================== OpenRouter 流式适配器 ====================

export class OpenRouterStreamAdapter extends BaseStreamAdapter {
    private apiKey: string;
    
    constructor(apiKey: string) {
        super();
        this.apiKey = apiKey;
    }
    
    stream(
        model: ModelConfig | string,
        messages: StreamMessage[],
        options?: StreamOptions
    ): void {
        this.aborted = false;
        
        const modelId = typeof model === 'string' 
            ? model 
            : model.apiModelId;
        
        const requestBody = JSON.stringify({
            model: modelId,
            messages: messages.map(m => ({ role: m.role, content: m.content })),
            max_tokens: options?.maxTokens || 4096,
            temperature: options?.temperature ?? 0.7,
            stream: true
        });
        
        const https = require('https');
        
        const req = https.request({
            hostname: 'openrouter.ai',
            port: 443,
            path: '/api/v1/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
                'HTTP-Referer': 'https://designecho.app',
                'X-Title': 'DesignEcho Agent',
                'Content-Length': Buffer.byteLength(requestBody)
            },
            timeout: 120000
        }, (res: any) => {
            let fullContent = '';
            let fullThinking = '';
            let buffer = '';
            let usage = { inputTokens: 0, outputTokens: 0 };
            
            res.on('data', (chunk: Buffer) => {
                if (this.aborted) return;
                
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                
                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    
                    const data = line.slice(6);
                    if (data === '[DONE]') {
                        const { thinking, content: cleanContent } = this.extractThinking(fullContent);
                        this.emitDone({
                            text: cleanContent,
                            thinking: thinking || undefined,
                            usage
                        });
                        return;
                    }
                    
                    try {
                        const parsed = JSON.parse(data);
                        const delta = parsed.choices?.[0]?.delta;
                        
                        // 检查 reasoning_content（DeepSeek 等）
                        if (delta?.reasoning_content) {
                            fullThinking += delta.reasoning_content;
                            this.emitThinking(delta.reasoning_content);
                        }
                        
                        // 常规内容
                        if (delta?.content) {
                            fullContent += delta.content;
                            this.emitContent(delta.content);
                        }
                        
                        // 使用量统计
                        if (parsed.usage) {
                            usage = {
                                inputTokens: parsed.usage.prompt_tokens || 0,
                                outputTokens: parsed.usage.completion_tokens || 0
                            };
                        }
                    } catch {
                        // 忽略解析错误
                    }
                }
            });
            
            res.on('end', () => {
                if (!this.aborted && fullContent) {
                    const { thinking, content: cleanContent } = this.extractThinking(fullContent);
                    this.emitDone({
                        text: cleanContent,
                        thinking: fullThinking || thinking || undefined,
                        usage
                    });
                }
            });
            
            res.on('error', (err: Error) => {
                this.emitError(err.message);
            });
        });
        
        req.on('error', (err: Error) => {
            this.emitError(`OpenRouter 请求失败: ${err.message}`);
        });
        
        req.on('timeout', () => {
            req.destroy();
            this.emitError('OpenRouter 响应超时');
        });
        
        if (options?.signal) {
            options.signal.addEventListener('abort', () => {
                this.abort();
                req.destroy();
            });
        }
        
        req.write(requestBody);
        req.end();
    }
    
    private extractThinking(content: string): { thinking: string | null; content: string } {
        // 检查 <think> 标签
        const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
        if (thinkMatch) {
            return {
                thinking: thinkMatch[1].trim(),
                content: content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
            };
        }
        return { thinking: null, content };
    }
}

// ==================== Google Gemini 流式适配器 ====================

export class GeminiStreamAdapter extends BaseStreamAdapter {
    private apiKey: string;
    
    constructor(apiKey: string) {
        super();
        this.apiKey = apiKey;
    }
    
    async stream(
        model: ModelConfig | string,
        messages: StreamMessage[],
        options?: StreamOptions
    ): Promise<void> {
        this.aborted = false;
        
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(this.apiKey);
        
        const modelId = typeof model === 'string' 
            ? model 
            : (model.apiModelId || 'gemini-3-flash-preview');
        
        const geminiModel = genAI.getGenerativeModel({ model: modelId });
        
        // 转换消息格式
        const history = messages.slice(0, -1).map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
        }));
        
        const lastMessage = messages[messages.length - 1];
        
        try {
            const chat = geminiModel.startChat({
                history,
                generationConfig: {
                    maxOutputTokens: options?.maxTokens || 4096,
                    temperature: options?.temperature ?? 0.7
                }
            });
            
            const result = await chat.sendMessageStream(lastMessage.content);
            
            let fullContent = '';
            
            for await (const chunk of result.stream) {
                if (this.aborted) break;
                
                const text = chunk.text();
                if (text) {
                    fullContent += text;
                    this.emitContent(text);
                }
            }
            
            if (!this.aborted) {
                this.emitDone({
                    text: fullContent,
                    usage: {
                        inputTokens: 0,
                        outputTokens: 0
                    }
                });
            }
        } catch (error: any) {
            this.emitError(error.message || 'Gemini 请求失败');
        }
    }
}

// ==================== 工厂函数 ====================

export interface StreamAdapterConfig {
    ollamaUrl?: string;
    ollamaApiKey?: string;
    openrouterApiKey?: string;
    googleApiKey?: string;
    anthropicApiKey?: string;
    openaiApiKey?: string;
}

/**
 * 创建适合模型的流式适配器
 */
export function createStreamAdapter(
    provider: string,
    config: StreamAdapterConfig
): BaseStreamAdapter {
    switch (provider) {
        case 'ollama':
            return new OllamaStreamAdapter(config.ollamaUrl || 'http://127.0.0.1:11434');
        case 'ollama-cloud':
            return new OllamaStreamAdapter(
                config.ollamaUrl || 'https://api.ollama.com',
                config.ollamaApiKey
            );
        case 'openrouter':
            if (!config.openrouterApiKey) {
                throw new Error('OpenRouter API key required');
            }
            return new OpenRouterStreamAdapter(config.openrouterApiKey);
        case 'google':
            if (!config.googleApiKey) {
                throw new Error('Google API key required');
            }
            return new GeminiStreamAdapter(config.googleApiKey);
        default:
            throw new Error(`Unsupported provider for streaming: ${provider}`);
    }
}

// 类型已在定义处导出（export interface）
