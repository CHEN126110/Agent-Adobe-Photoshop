/**
 * 任务调度器
 * 
 * 根据任务类型和用户偏好选择最合适的 AI 模型
 */

import { ModelService, ModelMessage } from './model-service';
import { TASK_ROUTING, TaskType } from '../../shared/types/tasks';
import { PROMPTS } from '../../shared/prompts';

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
     * 根据任务类型和偏好获取模型
     */
    private getModelForTask(taskType: TaskType): { primary: string; fallback?: string } {
        const configKey = TASK_CONFIG_MAP[taskType];
        
        // 如果没有映射，使用默认路由
        if (!configKey) {
            const routing = TASK_ROUTING.find(r => r.taskType === taskType);
            return {
                primary: routing?.primaryModel || 'local-qwen2.5-7b',
                fallback: routing?.fallbackModel
            };
        }

        const { mode, autoFallback, preferredLocalModels, preferredCloudModels } = this.preferences;

        switch (mode) {
            case 'local':
                return {
                    primary: preferredLocalModels[configKey],
                    fallback: autoFallback ? preferredCloudModels[configKey] : undefined
                };
            case 'cloud':
                return {
                    primary: preferredCloudModels[configKey],
                    fallback: undefined
                };
            case 'auto':
                return {
                    primary: preferredLocalModels[configKey],
                    fallback: preferredCloudModels[configKey]
                };
            default:
                return { primary: preferredLocalModels[configKey] };
        }
    }

    /**
     * 执行任务
     */
    async execute(taskType: TaskType, input: any, options?: TaskExecutionOptions): Promise<any> {
        const { primary, fallback } = this.getModelForTask(taskType);

        console.log(`[TaskOrchestrator] Executing ${taskType} with ${primary} (mode: ${this.preferences.mode})`);

        // 构建消息
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
                    fallbackModel: fallback || null
                }
            );

        } catch (error: any) {
            console.error(`[TaskOrchestrator] Primary model error:`, error.message);

            // 如果有备选模型，尝试使用备选模型
            if (fallback) {
                console.log(`[TaskOrchestrator] Fallback to ${fallback}`);
                
                try {
                    const response = await this.modelService.chat(
                        fallback,
                        messages,
                        { maxTokens: 4096, temperature: 0.7 }
                    );
                    return this.attachExecutionState(
                        this.parseResponse(taskType, response.text),
                        {
                            stage: 'fallback_used',
                            reasonCode: 'PRIMARY_MODEL_FAILED',
                            primaryModel: primary,
                            fallbackModel: fallback,
                            primaryError: error?.message || String(error)
                        }
                    );
                } catch (fallbackError) {
                    const err = fallbackError as any;
                    err.fallbackState = {
                        stage: 'fallback_failed',
                        reasonCode: 'FALLBACK_FAILED',
                        primaryModel: primary,
                        fallbackModel: fallback,
                        primaryError: error?.message || String(error),
                        fallbackError: err?.message || String(err)
                    };
                    throw fallbackError;
                }
            }
            (error as any).fallbackState = {
                stage: 'primary_failed',
                reasonCode: 'PRIMARY_MODEL_FAILED_NO_FALLBACK',
                primaryModel: primary,
                fallbackModel: null,
                primaryError: error?.message || String(error)
            };
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
