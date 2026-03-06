/**
 * 模型服务
 * 
 * 统一管理多个 AI 模型的调用
 * 
 * v2.0 更新：
 * - 统一思维过程提取（ThinkingExtractor）
 * - 支持不同模型的思维过程格式
 */

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import http from 'http';
import { ALL_MODELS, ModelConfig, getModelById, ThinkingConfig } from '../../shared/config/models.config';
import { extractThinkingFromModel, getThinkingRequestParams } from './thinking-extractor';

export interface ModelMessage {
    role: 'user' | 'assistant';
    content: string | MessageContent[];
}

export interface MessageContent {
    type: 'text' | 'image';
    text?: string;
    image?: {
        data: string;      // base64
        mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
    };
}

export interface ModelResponse {
    text: string;
    thinking?: string;  // 模型的思维过程（如果有）
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
}

interface ModelServiceConfig {
    anthropicApiKey?: string;
    googleApiKey?: string;
    openaiApiKey?: string;
    openrouterApiKey?: string;
    ollamaUrl?: string;
    ollamaApiKey?: string;  // Ollama Cloud API Key
    bflApiKey?: string;     // Black Forest Labs (FLUX) API Key
}

export class ModelService {
    private anthropic: Anthropic | null = null;
    private gemini: GoogleGenerativeAI | null = null;
    private openai: OpenAI | null = null;
    private ollamaBaseUrl = 'http://127.0.0.1:11434';
    private config: ModelServiceConfig;

    constructor(config: ModelServiceConfig) {
        this.config = config;
        this.initializeClients();
    }

    /**
     * 更新配置
     */
    updateConfig(config: Partial<ModelServiceConfig>): void {
        this.config = { ...this.config, ...config };
        this.initializeClients();
    }

    /**
     * 初始化客户端
     */
    private initializeClients(): void {
        if (this.config.anthropicApiKey) {
            this.anthropic = new Anthropic({ apiKey: this.config.anthropicApiKey });
            console.log('[ModelService] Anthropic client initialized');
        }
        if (this.config.googleApiKey) {
            this.gemini = new GoogleGenerativeAI(this.config.googleApiKey);
            console.log('[ModelService] Gemini client initialized');
        }
        if (this.config.openaiApiKey) {
            this.openai = new OpenAI({ apiKey: this.config.openaiApiKey });
            console.log('[ModelService] OpenAI client initialized');
        }
        if (this.config.ollamaUrl) {
            this.ollamaBaseUrl = this.config.ollamaUrl;
        }
    }

    /**
     * 统一聊天接口
     * 
     * 模型 ID 格式：
     * - 本地模型: local-xxx (如 local-qwen2.5-14b)
     * - 云端模型: provider-xxx (如 google-gemini-3-pro)
     */
    async chat(
        modelId: string,
        messages: ModelMessage[],
        options?: { maxTokens?: number; temperature?: number }
    ): Promise<ModelResponse> {
        console.log(`[ModelService] ========== chat() 被调用 ==========`);
        console.log(`[ModelService] modelId: ${modelId}`);
        console.log(`[ModelService] 消息数量: ${messages.length}`);
        
        // 从统一配置获取模型信息
        const model = getModelById(modelId);
        
        // 如果找不到，尝试动态解析模型 ID
        if (!model) {
            // 本地 Ollama 模型（新格式）
            if (modelId.startsWith('local-')) {
                const ollamaModel = this.localIdToOllamaModel(modelId);
                console.log(`[ModelService] Dynamic local Ollama model: ${ollamaModel}`);
                return this.chatOllamaDynamic(ollamaModel, messages, options);
            }
            // 兼容旧的 ollama- 前缀
            if (modelId.startsWith('ollama-') && !modelId.startsWith('ollama-cloud-')) {
                const ollamaModel = modelId.replace('ollama-', '');
                console.log(`[ModelService] Legacy Ollama model: ${ollamaModel}`);
                return this.chatOllamaDynamic(ollamaModel, messages, options);
            }
            // 动态 OpenRouter 模型
            if (modelId.startsWith('openrouter-')) {
                const orModel = modelId.replace('openrouter-', '');
                console.log(`[ModelService] Dynamic OpenRouter model: ${orModel}`);
                return this.chatOpenRouterDynamic(orModel, messages, options);
            }
            throw new Error(`未知模型: ${modelId}。请在设置中选择有效的模型。`);
        }

        console.log(`[ModelService] 调用模型: ${model.name} (${model.source}/${model.provider})`);

        switch (model.provider) {
            case 'ollama':
                // 本地 Ollama
                return this.chatOllama(model as any, messages, options);
            case 'ollama-cloud':
                // Ollama Cloud 云服务
                return this.chatOllamaCloud(model as any, messages, options);
            case 'google':
                return this.chatGemini(model as any, messages, options);
            case 'openrouter':
                return this.chatOpenRouter(model as any, messages, options);
            case 'anthropic':
                return this.chatAnthropic(model as any, messages, options);
            case 'openai':
                return this.chatOpenAI(model as any, messages, options);
            default:
                throw new Error(`不支持的提供商: ${model.provider}`);
        }
    }
    
    /**
     * 将 local-xxx 格式的 ID 转换为 Ollama 模型名
     */
    private localIdToOllamaModel(localId: string): string {
        // local-qwen2.5-14b -> qwen2.5:14b
        const name = localId.replace('local-', '');
        // 查找最后一个 - 后面的数字部分作为标签
        const match = name.match(/^(.+)-(\d+b)$/);
        if (match) {
            return `${match[1]}:${match[2]}`;
        }
        return name;
    }

    /**
     * 动态 Ollama 模型调用（支持用户自定义模型）
     * 
     * 使用统一的 ThinkingExtractor（默认尝试 xml_tag）
     */
    private async chatOllamaDynamic(
        ollamaModel: string,
        messages: ModelMessage[],
        options?: { maxTokens?: number; temperature?: number }
    ): Promise<ModelResponse> {
        console.log(`[ModelService] Calling dynamic Ollama model: ${ollamaModel}`);

        const ollamaMessages = messages.map(msg => ({
            role: msg.role,
            content: typeof msg.content === 'string' 
                ? msg.content 
                : msg.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
        }));

        const requestBody = JSON.stringify({
            model: ollamaModel,
            messages: ollamaMessages,
            stream: false,
            options: {
                num_predict: options?.maxTokens || 4096,
                temperature: options?.temperature ?? 0.7
            }
        });

        return new Promise((resolve, reject) => {
            const http = require('http');
            const req = http.request({
                hostname: '127.0.0.1',
                port: 11434,
                path: '/api/chat',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(requestBody)
                },
                timeout: 180000  // 3 分钟，大模型冷启动需更长时间
            }, (res: any) => {
                let data = '';
                res.on('data', (chunk: any) => { data += chunk; });
                res.on('end', () => {
                    try {
                        if (res.statusCode !== 200) {
                            reject(new Error(`Ollama error (${res.statusCode}): ${data}`));
                            return;
                        }
                        const parsed = JSON.parse(data);
                        
                        // 动态模型默认尝试 xml_tag 格式
                        const { thinking, content } = extractThinkingFromModel(parsed, undefined);
                        
                        resolve({
                            text: content,
                            thinking: thinking || undefined,
                            usage: {
                                inputTokens: parsed.prompt_eval_count || 0,
                                outputTokens: parsed.eval_count || 0
                            }
                        });
                    } catch (e) {
                        reject(new Error(`Failed to parse Ollama response: ${e}`));
                    }
                });
            });
            req.on('error', (error: any) => {
                reject(new Error(`🖥️ 无法连接到本地 Ollama 服务\n\n请检查:\n• 运行 ollama serve 启动服务\n• 或在设置中切换到云端模式`));
            });
            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`⏱️ Ollama 响应超时 (3 分钟)\n\n可能原因:\n• 大模型首次加载需 1–2 分钟，请稍后重试\n• 可先运行 ollama run <模型名> 预热\n• 或切换到更小的模型`));
            });
            req.write(requestBody);
            req.end();
        });
    }

    /**
     * 动态 OpenRouter 模型调用
     * 
     * 使用统一的 ThinkingExtractor（默认尝试 reasoning_content + xml_tag）
     */
    private async chatOpenRouterDynamic(
        openrouterModel: string,
        messages: ModelMessage[],
        options?: { maxTokens?: number; temperature?: number }
    ): Promise<ModelResponse> {
        if (!this.config.openrouterApiKey) {
            throw new Error('OpenRouter API key not configured');
        }

        console.log(`[ModelService] Calling dynamic OpenRouter model: ${openrouterModel}`);

        const openrouterMessages = messages.map(msg => ({
            role: msg.role,
            content: this.convertToOpenAIContent(msg.content)
        }));

        const requestBody = JSON.stringify({
            model: openrouterModel,
            messages: openrouterMessages,
            max_tokens: options?.maxTokens || 4096,
            temperature: options?.temperature ?? 0.7
        });

        return new Promise((resolve, reject) => {
            const https = require('https');
            const req = https.request({
                hostname: 'openrouter.ai',
                port: 443,
                path: '/api/v1/chat/completions',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.openrouterApiKey}`,
                    'HTTP-Referer': 'https://designecho.app',
                    'X-Title': 'DesignEcho Agent',
                    'Content-Length': Buffer.byteLength(requestBody)
                },
                timeout: 60000
            }, (res: any) => {
                let data = '';
                res.on('data', (chunk: any) => { data += chunk; });
                res.on('end', () => {
                    try {
                        if (res.statusCode !== 200) {
                            let errorData: any = {};
                            try { errorData = JSON.parse(data); } catch {}
                            reject(new Error(this.formatOpenRouterError(res.statusCode, errorData, openrouterModel)));
                            return;
                        }
                        const parsed = JSON.parse(data);
                        
                        // 动态模型默认尝试 reasoning_content 格式
                        const dynamicThinkingConfig: ThinkingConfig = {
                            supported: true,
                            format: 'reasoning_content'
                        };
                        const { thinking, content } = extractThinkingFromModel(parsed, dynamicThinkingConfig);
                        
                        resolve({
                            text: content,
                            thinking: thinking || undefined,
                            usage: {
                                inputTokens: parsed.usage?.prompt_tokens || 0,
                                outputTokens: parsed.usage?.completion_tokens || 0
                            }
                        });
                    } catch (e) {
                        reject(new Error(`❌ OpenRouter 响应解析失败\n\n请稍后重试`));
                    }
                });
            });
            req.on('error', (error: any) => {
                reject(new Error(`🌐 无法连接到 OpenRouter\n\n请检查网络连接`));
            });
            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`⏱️ OpenRouter 请求超时\n\n请稍后重试`));
            });
            req.write(requestBody);
            req.end();
        });
    }

    /**
     * Claude API
     * 
     * 使用统一的 ThinkingExtractor 处理 Extended Thinking
     */
    private async chatAnthropic(
        model: ModelConfig,
        messages: ModelMessage[],
        options?: { maxTokens?: number; temperature?: number }
    ): Promise<ModelResponse> {
        if (!this.anthropic) {
            throw new Error('Anthropic API key not configured');
        }

        const anthropicMessages = messages.map(msg => ({
            role: msg.role as 'user' | 'assistant',
            content: this.convertToAnthropicContent(msg.content)
        }));

        const modelName = model.id === 'claude-3-5-sonnet' 
            ? 'claude-3-5-sonnet-20241022' 
            : model.id === 'claude-3-opus' 
                ? 'claude-3-opus-20240229'
                : model.id;

        const response = await this.anthropic.messages.create({
            model: modelName,
            max_tokens: options?.maxTokens || 4096,
            temperature: options?.temperature,
            messages: anthropicMessages
        });

        // 使用统一的 ThinkingExtractor 提取思维过程
        const { thinking, content } = extractThinkingFromModel(response, model.thinking);
        
        return {
            text: content,
            thinking: thinking || undefined,
            usage: {
                inputTokens: response.usage.input_tokens,
                outputTokens: response.usage.output_tokens
            }
        };
    }

    /**
     * Gemini API (Google AI Studio 官方渠道)
     */
    private async chatGemini(
        model: ModelConfig,
        messages: ModelMessage[],
        options?: { maxTokens?: number; temperature?: number }
    ): Promise<ModelResponse> {
        console.log(`[ModelService] ========== Google AI 调用开始 ==========`);
        console.log(`[ModelService] Gemini 客户端状态: ${this.gemini ? '✅ 已初始化' : '❌ 未初始化'}`);
        console.log(`[ModelService] Google API Key 配置: ${this.config.googleApiKey ? '✅ 已配置 (' + this.config.googleApiKey.substring(0, 8) + '...)' : '❌ 未配置'}`);
        
        if (!this.gemini) {
            console.error('[ModelService] ❌ Gemini 客户端未初始化，API Key 可能未同步');
            throw new Error('Google API key not configured. 请在设置中配置 Google AI Studio API Key');
        }

        // 使用 apiModelId 获取正确的模型名称
        // Google AI SDK 接受两种格式: "gemini-1.5-pro" 或 "models/gemini-1.5-pro"
        let modelName = model.apiModelId || model.id.replace('google-', '');
        
        // 去除 models/ 前缀（SDK 会自动处理）
        if (modelName.startsWith('models/')) {
            modelName = modelName.replace('models/', '');
        }
        
        console.log(`[ModelService] 🎯 调用模型: ${modelName}`);
        console.log(`[ModelService] 📝 消息数量: ${messages.length}`);

        const genModel = this.gemini.getGenerativeModel({
            model: modelName,
            generationConfig: {
                maxOutputTokens: options?.maxTokens || model.maxTokens || 8192,
                temperature: options?.temperature
            }
        });

        // 转换消息为 Gemini 格式
        const parts = this.convertToGeminiContent(messages);

        try {
        const result = await genModel.generateContent({
            contents: [{ role: 'user', parts }]
        });

        const response = await result.response;
            const rawText = response.text();
            
            // 使用统一的 ThinkingExtractor 提取思维过程
            // Google Gemini 不原生支持思维过程，但尝试解析 XML 标签
            const { thinking, content } = extractThinkingFromModel({ text: rawText }, model.thinking);
            
            console.log(`[ModelService] Google AI Studio response received (${content.length} chars)`);
            
        return {
                text: content,
                thinking: thinking || undefined,
            usage: {
                inputTokens: response.usageMetadata?.promptTokenCount || 0,
                outputTokens: response.usageMetadata?.candidatesTokenCount || 0
            }
        };
        } catch (error: any) {
            // 详细错误日志
            console.error(`[ModelService] ❌ Google AI 调用失败`);
            console.error(`[ModelService] 原始错误:`, error);
            console.error(`[ModelService] 错误类型: ${error.constructor?.name}`);
            console.error(`[ModelService] 错误消息: ${error.message}`);
            console.error(`[ModelService] 错误状态: ${error.status || error.statusCode || 'N/A'}`);
            
            // 提供更友好的错误信息
            const friendlyError = this.formatGoogleError(error, modelName);
            throw new Error(friendlyError);
        }
    }

    /**
     * 格式化 Google API 错误为友好提示
     */
    private formatGoogleError(error: any, modelName: string): string {
        const status = error.status || error.statusCode;
        const message = error.message || '';
        
        // 429 配额超限
        if (status === 429 || message.includes('429') || message.includes('RESOURCE_EXHAUSTED') || message.includes('quota')) {
            // 尝试提取重试时间
            const retryMatch = message.match(/retry in (\d+)/i) || message.match(/retryDelay.*?(\d+)s/);
            const retryTime = retryMatch ? retryMatch[1] : null;
            
            let tip = `⚠️ Google AI 配额已用尽\n\n`;
            tip += `模型: ${modelName}\n`;
            if (retryTime) {
                tip += `建议等待: ${retryTime} 秒后重试\n\n`;
            }
            tip += `💡 解决方案:\n`;
            tip += `• 等待配额恢复（通常每分钟/每天重置）\n`;
            tip += `• 切换到其他模型（如 Gemini 2.5 Flash）\n`;
            tip += `• 升级 Google AI Studio 付费计划`;
            return tip;
        }
        
        // 401/403 认证错误
        if (status === 401 || status === 403 || message.includes('API_KEY_INVALID') || message.includes('PERMISSION_DENIED')) {
            return `🔑 Google AI API Key 无效或权限不足\n\n请检查:\n• API Key 是否正确\n• 是否已启用 Generative Language API\n• API Key 是否有使用限制`;
        }
        
        // 404 模型不存在
        if (status === 404 || message.includes('not found') || message.includes('NOT_FOUND')) {
            return `❌ 模型 ${modelName} 不存在\n\n可能原因:\n• 模型名称错误\n• 该模型在你的地区不可用\n• 模型已下线或更名`;
        }
        
        // 500 服务器错误
        if (status >= 500 || message.includes('INTERNAL')) {
            return `⚠️ Google AI 服务暂时不可用\n\n请稍后重试，或切换到其他模型`;
        }
        
        // 网络错误
        if (message.includes('fetch') || message.includes('network') || message.includes('ECONNREFUSED')) {
            return `🌐 网络连接失败\n\n请检查:\n• 网络连接是否正常\n• 是否需要代理访问 Google 服务`;
        }
        
        // 默认错误
        return `❌ Google AI 调用失败\n\n${message.substring(0, 200)}`;
    }

    /**
     * 格式化 OpenRouter API 错误为友好提示
     */
    private formatOpenRouterError(statusCode: number, errorData: any, modelName: string): string {
        const errorMessage = errorData?.error?.message || errorData?.message || '';
        
        // 401 认证错误
        if (statusCode === 401) {
            return `🔑 OpenRouter API Key 无效\n\n请在设置中检查 API Key 是否正确`;
        }
        
        // 402 余额不足
        if (statusCode === 402) {
            return `💳 OpenRouter 账户余额不足\n\n请前往 openrouter.ai 充值后重试`;
        }
        
        // 403 地区限制或权限问题
        if (statusCode === 403) {
            if (errorMessage.includes('region') || errorMessage.includes('not available')) {
                return `🌍 模型 ${modelName} 在你的地区不可用\n\n💡 建议:\n• 切换到 DeepSeek V3\n• 切换到 Qwen 2.5 系列\n• 使用 Google Gemini（需 Google API Key）`;
            }
            return `🚫 无权访问模型 ${modelName}\n\n请检查 API Key 权限或切换其他模型`;
        }
        
        // 429 配额超限
        if (statusCode === 429) {
            return `⚠️ OpenRouter 请求频率过高\n\n请稍等片刻后重试`;
        }
        
        // 500+ 服务器错误
        if (statusCode >= 500) {
            return `⚠️ OpenRouter 服务暂时不可用\n\n请稍后重试`;
        }
        
        // 模型不存在
        if (statusCode === 404 || errorMessage.includes('not found')) {
            return `❌ 模型 ${modelName} 不存在\n\n请在设置中选择其他模型`;
        }
        
        // 默认错误
        return `❌ OpenRouter 调用失败 (${statusCode})\n\n${errorMessage.substring(0, 150)}`;
    }

    /**
     * OpenAI API
     * 
     * 使用统一的 ThinkingExtractor 处理思维过程
     */
    private async chatOpenAI(
        model: ModelConfig,
        messages: ModelMessage[],
        options?: { maxTokens?: number; temperature?: number }
    ): Promise<ModelResponse> {
        if (!this.openai) {
            throw new Error('OpenAI API key not configured');
        }

        const openaiMessages = messages.map(msg => ({
            role: msg.role as 'user' | 'assistant',
            content: this.convertToOpenAIContent(msg.content)
        }));

        const response = await this.openai.chat.completions.create({
            model: model.id,
            messages: openaiMessages,
            max_tokens: options?.maxTokens || 4096,
            temperature: options?.temperature
        });

        // 使用统一的 ThinkingExtractor 提取思维过程
        const { thinking, content } = extractThinkingFromModel(response, model.thinking);

        return {
            text: content,
            thinking: thinking || undefined,
            usage: {
                inputTokens: response.usage?.prompt_tokens || 0,
                outputTokens: response.usage?.completion_tokens || 0
            }
        };
    }

    /**
     * Ollama API (本地模型) - 使用原生 http 模块
     * 
     * 使用统一的 ThinkingExtractor 处理思维过程
     */
    private async chatOllama(
        model: ModelConfig,
        messages: ModelMessage[],
        options?: { maxTokens?: number; temperature?: number }
    ): Promise<ModelResponse> {
        const ollamaModel = (model as any).apiModelId || model.id.replace('ollama-', '');
        console.log(`[ModelService] Calling Ollama model: ${ollamaModel}`);

        const ollamaMessages = messages.map(msg => {
            const baseMessage: any = {
                role: msg.role,
                content: typeof msg.content === 'string' 
                    ? msg.content 
                    : msg.content
                        .filter(c => c.type === 'text')
                        .map(c => c.text)
                        .join('\n')
            };

            if (model.supportsVision && typeof msg.content !== 'string') {
                const images = msg.content
                    .filter(c => c.type === 'image' && c.image)
                    .map(c => c.image!.data);
                if (images.length > 0) {
                    baseMessage.images = images;
                }
            }

            return baseMessage;
        });

        // 获取思维过程请求参数
        const thinkingParams = getThinkingRequestParams(model.thinking);

        const requestBody = JSON.stringify({
            model: ollamaModel,
            messages: ollamaMessages,
            stream: false,
            options: {
                num_predict: options?.maxTokens || 4096,
                temperature: options?.temperature ?? 0.7,
                ...thinkingParams
            }
        });

        return new Promise((resolve, reject) => {
            const req = http.request({
                hostname: '127.0.0.1',
                port: 11434,
                path: '/api/chat',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(requestBody)
                },
                timeout: 180000  // 3 分钟，大模型（如 32B）冷启动需 1–2 分钟
            }, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    try {
                        if (res.statusCode !== 200) {
                            reject(new Error(`Ollama error (${res.statusCode}): ${data}`));
                            return;
                        }

                        const parsed = JSON.parse(data);
                        
                        // 使用统一的 ThinkingExtractor 提取思维过程
                        const { thinking, content } = extractThinkingFromModel(parsed, model.thinking);
                        
                        resolve({
                            text: content,
                            thinking: thinking || undefined,
                            usage: {
                                inputTokens: parsed.prompt_eval_count || 0,
                                outputTokens: parsed.eval_count || 0
                            }
                        });
                    } catch (e) {
                        reject(new Error(`Failed to parse Ollama response: ${e}`));
                    }
                });
            });

            req.on('error', (error) => {
                console.error('[ModelService] Ollama connection error:', error.message);
                const hint = error.message?.includes('ECONNREFUSED') 
                    ? 'Ollama 可能未启动，请运行 ollama serve'
                    : '请检查 Ollama 是否正常运行';
                reject(new Error(`🖥️ 无法连接到本地 Ollama 服务\n\n${hint}\n• 或在设置中切换到云端模式`));
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`⏱️ Ollama 响应超时 (3 分钟)\n\n可能原因:\n• 大模型（如 32B）首次加载需 1–2 分钟，请稍后重试\n• 可先运行 ollama run qwen2.5:32b 预热模型\n• 或切换到更小的模型（如 qwen2.5:7b）`));
            });

            req.write(requestBody);
            req.end();
        });
    }

    /**
     * Ollama Cloud API (云端 Ollama 服务)
     * 需要 ollamaApiKey 认证
     * 
     * 使用统一的 ThinkingExtractor 处理思维过程
     * 支持 Qwen3 的 enable_thinking 参数
     */
    private async chatOllamaCloud(
        model: ModelConfig,
        messages: ModelMessage[],
        options?: { maxTokens?: number; temperature?: number }
    ): Promise<ModelResponse> {
        if (!this.config.ollamaApiKey) {
            throw new Error('Ollama Cloud API key not configured. 请在设置中配置 Ollama 云服务 API 密钥。');
        }

        const ollamaModel = (model as any).apiModelId || model.id.replace('ollama-cloud-', '');
        console.log(`[ModelService] Calling Ollama Cloud model: ${ollamaModel}`);

        const ollamaMessages = messages.map(msg => {
            const baseMessage: any = {
                role: msg.role,
                content: typeof msg.content === 'string' 
                    ? msg.content 
                    : msg.content
                        .filter(c => c.type === 'text')
                        .map(c => c.text)
                        .join('\n')
            };

            if (model.supportsVision && typeof msg.content !== 'string') {
                const images = msg.content
                    .filter(c => c.type === 'image' && c.image)
                    .map(c => c.image!.data);
                if (images.length > 0) {
                    baseMessage.images = images;
                }
            }

            return baseMessage;
        });

        // 获取思维过程请求参数（如 Qwen3 的 enable_thinking）
        const thinkingParams = getThinkingRequestParams(model.thinking);
        
        const response = await fetch('https://ollama.com/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.config.ollamaApiKey}`
            },
            body: JSON.stringify({
                model: ollamaModel,
                messages: ollamaMessages,
                stream: false,
                options: {
                    num_predict: options?.maxTokens || 4096,
                    temperature: options?.temperature ?? 0.7,
                    ...thinkingParams  // 添加思维过程参数
                }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Ollama Cloud error (${response.status}): ${errorText}`);
        }

        const data = await response.json();
        
        // 使用统一的 ThinkingExtractor 提取思维过程
        const { thinking, content } = extractThinkingFromModel(data, model.thinking);
        
        return {
            text: content,
            thinking: thinking || undefined,
            usage: {
                inputTokens: data.prompt_eval_count || 0,
                outputTokens: data.eval_count || 0
            }
        };
    }

    /**
     * OpenRouter API (中转模型) - 支持中国地区访问
     * API 格式与 OpenAI 兼容
     * 
     * 使用统一的 ThinkingExtractor 处理思维过程
     */
    private async chatOpenRouter(
        model: ModelConfig,
        messages: ModelMessage[],
        options?: { maxTokens?: number; temperature?: number }
    ): Promise<ModelResponse> {
        if (!this.config.openrouterApiKey) {
            throw new Error('OpenRouter API key not configured. 请在设置中配置 OpenRouter API 密钥。');
        }

        const openrouterModel = (model as any).apiModelId || model.id.replace('openrouter-', '');
        console.log(`[ModelService] Calling OpenRouter model: ${openrouterModel}`);

        const openrouterMessages = messages.map(msg => ({
            role: msg.role as 'user' | 'assistant',
            content: this.convertToOpenAIContent(msg.content)
        }));

        const requestBody = JSON.stringify({
            model: openrouterModel,
            messages: openrouterMessages,
            max_tokens: options?.maxTokens || 4096,
            temperature: options?.temperature ?? 0.7
        });

        return new Promise((resolve, reject) => {
            const https = require('https');

            const req = https.request({
                hostname: 'openrouter.ai',
                port: 443,
                path: '/api/v1/chat/completions',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.openrouterApiKey}`,
                    'HTTP-Referer': 'https://designecho.app',
                    'X-Title': 'DesignEcho Agent',
                    'Content-Length': Buffer.byteLength(requestBody)
                },
                timeout: 60000
            }, (res: any) => {
                let data = '';
                res.on('data', (chunk: any) => { data += chunk; });
                res.on('end', () => {
                    try {
                        if (res.statusCode !== 200) {
                            let errorData: any = {};
                            try { errorData = JSON.parse(data); } catch {}
                            reject(new Error(this.formatOpenRouterError(res.statusCode, errorData, openrouterModel)));
                            return;
                        }

                        const parsed = JSON.parse(data);
                        
                        // 使用统一的 ThinkingExtractor 提取思维过程
                        const { thinking, content } = extractThinkingFromModel(parsed, model.thinking);
                        
                        resolve({
                            text: content,
                            thinking: thinking || undefined,
                            usage: {
                                inputTokens: parsed.usage?.prompt_tokens || 0,
                                outputTokens: parsed.usage?.completion_tokens || 0
                            }
                        });
                    } catch (e) {
                        reject(new Error(`❌ OpenRouter 响应解析失败\n\n请稍后重试`));
                    }
                });
            });

            req.on('error', (error: any) => {
                console.error('[ModelService] OpenRouter connection error:', error.message);
                reject(new Error(`🌐 无法连接到 OpenRouter\n\n请检查:\n• 网络连接是否正常\n• 是否需要代理`));
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error(`⏱️ OpenRouter 请求超时\n\n请稍后重试，或切换到响应更快的模型`));
            });

            req.write(requestBody);
            req.end();
        });
    }

    // ===== 格式转换辅助方法 =====

    private convertToAnthropicContent(content: string | MessageContent[]): any {
        if (typeof content === 'string') {
            return content;
        }
        return content.map(c => {
            if (c.type === 'text') {
                return { type: 'text', text: c.text };
            } else if (c.type === 'image' && c.image) {
                return {
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: c.image.mediaType,
                        data: c.image.data
                    }
                };
            }
            return null;
        }).filter(Boolean);
    }

    private convertToGeminiContent(messages: ModelMessage[]): any[] {
        const parts: any[] = [];
        for (const msg of messages) {
            if (typeof msg.content === 'string') {
                parts.push({ text: msg.content });
            } else {
                for (const c of msg.content) {
                    if (c.type === 'text' && c.text) {
                        parts.push({ text: c.text });
                    } else if (c.type === 'image' && c.image) {
                        parts.push({
                            inlineData: {
                                mimeType: c.image.mediaType,
                                data: c.image.data
                            }
                        });
                    }
                }
            }
        }
        return parts;
    }

    private convertToOpenAIContent(content: string | MessageContent[]): any {
        if (typeof content === 'string') {
            return content;
        }
        return content.map(c => {
            if (c.type === 'text') {
                return { type: 'text', text: c.text };
            } else if (c.type === 'image' && c.image) {
                return {
                    type: 'image_url',
                    image_url: {
                        url: `data:${c.image.mediaType};base64,${c.image.data}`
                    }
                };
            }
            return null;
        }).filter(Boolean);
    }

    // ==================== 流式输出支持 ====================
    
    /**
     * 流式聊天接口
     * 
     * 返回一个事件发射器，可以监听 'chunk' 事件获取流式数据
     * 
     * @example
     * const stream = modelService.chatStream(modelId, messages);
     * stream.on('chunk', (chunk) => {
     *     if (chunk.type === 'content') {
     *         console.log('内容:', chunk.content);
     *     } else if (chunk.type === 'thinking') {
     *         console.log('思考:', chunk.thinking);
     *     } else if (chunk.type === 'done') {
     *         console.log('完成:', chunk.fullResponse);
     *     }
     * });
     */
    chatStream(
        modelId: string,
        messages: ModelMessage[],
        options?: { maxTokens?: number; temperature?: number; signal?: AbortSignal }
    ): import('./stream-adapter').BaseStreamAdapter {
        const { createStreamAdapter } = require('./stream-adapter');
        
        // 从统一配置获取模型信息
        const model = getModelById(modelId);
        
        // 转换消息格式
        const streamMessages = messages.map(msg => ({
            role: msg.role as 'user' | 'assistant' | 'system',
            content: typeof msg.content === 'string' 
                ? msg.content 
                : msg.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
        }));
        
        // 确定提供商
        let provider = 'ollama';
        let modelToUse: any = modelId;
        
        if (model) {
            provider = model.provider;
            modelToUse = model;
        } else if (modelId.startsWith('local-') || modelId.startsWith('ollama-')) {
            provider = 'ollama';
            modelToUse = modelId.replace('local-', '').replace('ollama-', '');
        } else if (modelId.startsWith('openrouter-')) {
            provider = 'openrouter';
            modelToUse = modelId.replace('openrouter-', '');
        }
        
        // 创建适配器
        const adapter = createStreamAdapter(provider, {
            ollamaUrl: this.ollamaBaseUrl,
            ollamaApiKey: this.config.ollamaApiKey,
            openrouterApiKey: this.config.openrouterApiKey,
            googleApiKey: this.config.googleApiKey,
            anthropicApiKey: this.config.anthropicApiKey,
            openaiApiKey: this.config.openaiApiKey
        });
        
        // 开始流式请求
        adapter.stream(modelToUse, streamMessages, options);
        
        return adapter;
    }
}