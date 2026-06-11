/**
 * 任务调度器
 * 
 * 根据任务类型和用户偏好选择最合适的 AI 模型
 */

import { ModelService, ModelMessage } from './model-service';
import { TASK_ROUTING, TaskType } from '../../shared/types/tasks';
import { PROMPTS } from '../../shared/prompts';
import {
    getAgentWorkerModels,
    getPrimaryModelForPreferenceBucket,
    type ModelPreferenceBucket
} from '../../shared/model-selection';

// 模型模式
export type ModelMode = 'local' | 'cloud' | 'auto';

// 任务模型配置
export interface TaskModelConfig {
    layoutAnalysis: string;
    textOptimize: string;
    visualAnalyze: string;
}

// 模型偏好设置
export interface ModelPreferences {
    mode: ModelMode;
    autoFallback: boolean;
    preferredLocalModels: TaskModelConfig;
    preferredCloudModels: TaskModelConfig;
}

export interface TaskExecutionOptions {
    constraintProfile?: {
        platform?: string;
        brandTone?: string;
        styleKeywords?: string[];
        hardConstraints?: Record<string, unknown>;
        softConstraints?: Record<string, unknown>;
    };
    decisionContext?: {
        stage?: 'diagnosis' | 'decision' | 'execution' | string;
        goal?: string;
    };
    expectedOutputSchema?: Record<string, unknown>;
}

export interface TaskStreamCallbacks {
    onStart?: (meta: { taskType: TaskType; modelId: string }) => void;
    onContent?: (content: string) => void;
    onThinking?: (thinking: string) => void;
    onDone?: (response: { text: string; thinking?: string }) => void;
    onError?: (error: string) => void;
}

// 任务类型到配置键的映射
const TASK_CONFIG_MAP: Record<string, keyof TaskModelConfig> = {
    'layout-analysis': 'layoutAnalysis',
    'layout-fix': 'layoutAnalysis',
    'text-optimize': 'textOptimize',
    'reference-analyze': 'visualAnalyze',
    'visual-compare': 'visualAnalyze',
};

// 默认偏好
const DEFAULT_PREFERENCES: ModelPreferences = {
    mode: 'local',
    autoFallback: true,
    preferredLocalModels: {
        layoutAnalysis: 'local-deepseek-coder-v2-16b',
        textOptimize: 'local-qwen2.5-7b',
        visualAnalyze: 'local-llava-7b'
    },
    preferredCloudModels: {
        layoutAnalysis: 'claude-3-5-sonnet',
        textOptimize: 'gpt-4o',
        visualAnalyze: 'gemini-3-flash'
    }
};

export class TaskOrchestrator {
    private modelService: ModelService;
    private preferences: ModelPreferences = DEFAULT_PREFERENCES;

    constructor(modelService: ModelService) {
        this.modelService = modelService;
    }

    /**
     * 更新模型偏好设置
     */
    updatePreferences(prefs: Partial<ModelPreferences>): void {
        this.preferences = { ...this.preferences, ...prefs };
        console.log('[TaskOrchestrator] Preferences updated:', this.preferences.mode);
    }

    /**
     * 获取当前偏好设置
     */
    getPreferences(): ModelPreferences {
        return this.preferences;
    }

    /**
     * 获取三智能体系统使用的模型 ID
     * 基于用户当前 mode（local/cloud/auto）自动解析
     */
    getAgentModels(): { vision: string; copy: string; logic: string } {
        return getAgentWorkerModels(this.preferences, {
            mode: this.preferences.mode,
            includeFallback: this.preferences.autoFallback
        });
    }

    /**
     * 根据任务类型和偏好获取模型
     */
    private getModelForTask(taskType: TaskType): { primary: string } {
        const configKey = TASK_CONFIG_MAP[taskType] as ModelPreferenceBucket | undefined;

        // Unknown task type falls back to static routing config.
        if (!configKey) {
            const routing = TASK_ROUTING.find(r => r.taskType === taskType);
            return {
                primary: routing?.primaryModel || 'local-qwen2.5-7b'
            };
        }

        return {
            primary: getPrimaryModelForPreferenceBucket(this.preferences, configKey, {
                mode: this.preferences.mode,
                includeFallback: this.preferences.autoFallback,
                includeCrossTaskBackups: false,
                requireVision: configKey === 'visualAnalyze'
            })
        };
    }

    /**
     * 执行任务
     */
    async execute(taskType: TaskType, input: any, options?: TaskExecutionOptions): Promise<any> {
        const { primary } = this.getModelForTask(taskType);

        console.log(`[TaskOrchestrator] Executing ${taskType} with ${primary} (mode: ${this.preferences.mode})`);

        // Build a single request payload and execute with the primary model only.
        const messages = this.buildMessages(taskType, input, options);

        try {
            const response = await this.modelService.chat(
                primary,
                messages,
                { maxTokens: 4096, temperature: 0.7 }
            );
            return this.attachExecutionState(
                this.parseResponse(taskType, response.text),
                {
                    stage: 'primary_success',
                    reasonCode: 'PRIMARY_OK',
                    primaryModel: primary,
                    fallbackModel: null
                }
            );

        } catch (error: any) {
            console.error(`[TaskOrchestrator] Primary model error:`, error.message);
            (error as any).fallbackState = {
                stage: 'primary_failed',
                reasonCode: 'PRIMARY_MODEL_FAILED',
                primaryModel: primary,
                fallbackModel: null,
                primaryError: error?.message || String(error)
            };
            throw error;
        }
    }

    async executeStream(
        taskType: TaskType,
        input: any,
        callbacks: TaskStreamCallbacks = {},
        options?: TaskExecutionOptions
    ): Promise<any> {
        const { primary } = this.getModelForTask(taskType);

        console.log(`[TaskOrchestrator] Streaming ${taskType} with ${primary} (mode: ${this.preferences.mode})`);

        const messages = this.buildMessages(taskType, input, options);
        callbacks.onStart?.({ taskType, modelId: primary });

        try {
            const adapter = this.modelService.chatStream(
                primary,
                messages,
                { maxTokens: 4096, temperature: 0.7 }
            );

            return await new Promise((resolve, reject) => {
                let fullContent = '';
                let fullThinking = '';
                let settled = false;

                adapter.on('chunk', (chunk: any) => {
                    if (!chunk || settled) return;

                    if (chunk.type === 'content') {
                        const content = String(chunk.content || '');
                        fullContent += content;
                        callbacks.onContent?.(content);
                        return;
                    }

                    if (chunk.type === 'thinking') {
                        const thinking = String(chunk.thinking || '');
                        fullThinking += thinking;
                        callbacks.onThinking?.(thinking);
                        return;
                    }

                    if (chunk.type === 'done') {
                        settled = true;
                        const text = String(chunk.fullResponse?.text ?? fullContent);
                        const thinking = String(chunk.fullResponse?.thinking || fullThinking || '');
                        callbacks.onDone?.({ text, thinking: thinking || undefined });
                        resolve(this.attachExecutionState(
                            this.parseResponse(taskType, text),
                            {
                                stage: 'primary_success',
                                reasonCode: 'PRIMARY_OK',
                                primaryModel: primary,
                                fallbackModel: null,
                                streamed: true
                            }
                        ));
                        return;
                    }

                    if (chunk.type === 'error') {
                        settled = true;
                        const message = String(chunk.error || '模型流式请求失败');
                        callbacks.onError?.(message);
                        const error = new Error(message);
                        (error as any).fallbackState = {
                            stage: 'primary_failed',
                            reasonCode: 'PRIMARY_MODEL_FAILED',
                            primaryModel: primary,
                            fallbackModel: null,
                            primaryError: message
                        };
                        reject(error);
                    }
                });
            });
        } catch (error: any) {
            console.error(`[TaskOrchestrator] Primary stream error:`, error.message);
            if (!(error as any).fallbackState) {
                (error as any).fallbackState = {
                    stage: 'primary_failed',
                    reasonCode: 'PRIMARY_MODEL_FAILED',
                    primaryModel: primary,
                    fallbackModel: null,
                    primaryError: error?.message || String(error)
                };
            }
            throw error;
        }
    }

    private attachExecutionState(result: any, state: Record<string, unknown>): any {
        if (result && typeof result === 'object' && !Array.isArray(result)) {
            return {
                ...result,
                executionState: state
            };
        }
        return {
            data: result,
            executionState: state
        };
    }

    /**
     * 构建消息
     */
    private buildMessages(taskType: TaskType, input: any, options?: TaskExecutionOptions): ModelMessage[] {
        const systemPrompt = PROMPTS[taskType];
        
        // 构建用户消息
        const userContent: any[] = [];

        // 添加系统提示
        userContent.push({
            type: 'text',
            text: systemPrompt
        });

        // 添加输入数据
        if (input.image) {
            userContent.push({
                type: 'text',
                text: '\n\n[参考设计图]'
            });
            userContent.push({
                type: 'image',
                image: {
                    data: input.image.data,
                    mediaType: input.image.mediaType || 'image/png'
                }
            });
        }

        if (input.documentImage) {
            userContent.push({
                type: 'text',
                text: '\n\n[当前画布截图]'
            });
            userContent.push({
                type: 'image',
                image: {
                    data: input.documentImage.data,
                    mediaType: input.documentImage.mediaType || 'image/png'
                }
            });
        }

        if (input.text) {
            userContent.push({
                type: 'text',
                text: `\n\n用户输入：\n${input.text}`
            });
        }

        if (input.layers) {
            userContent.push({
                type: 'text',
                text: `\n\n图层信息：\n${JSON.stringify(input.layers, null, 2)}`
            });
        }

        if (input.documentInfo) {
            userContent.push({
                type: 'text',
                text: `\n\n文档信息：\n${JSON.stringify(input.documentInfo, null, 2)}`
            });
        }

        if (options?.constraintProfile) {
            userContent.push({
                type: 'text',
                text: `\n\n设计约束（必须遵守）：\n${JSON.stringify(options.constraintProfile, null, 2)}`
            });
        }

        if (options?.decisionContext) {
            userContent.push({
                type: 'text',
                text: `\n\n当前阶段：${JSON.stringify(options.decisionContext, null, 2)}`
            });
        }

        if (options?.expectedOutputSchema) {
            userContent.push({
                type: 'text',
                text: `\n\n输出必须为 JSON，遵守以下 schema：\n${JSON.stringify(options.expectedOutputSchema, null, 2)}`
            });
        }

        return [{
            role: 'user',
            content: userContent
        }];
    }

    /**
     * 解析响应
     */
    private parseResponse(taskType: TaskType, responseText: string): any {
        // 尝试提取 JSON
        const jsonMatch = responseText.match(/```json\n?([\s\S]*?)\n?```/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[1]);
            } catch (e) {
                console.warn('[TaskOrchestrator] Failed to parse JSON from response');
            }
        }

        // 尝试直接解析
        try {
            return JSON.parse(responseText);
        } catch (e) {
            // 返回原始文本
            return { text: responseText };
        }
    }
}
