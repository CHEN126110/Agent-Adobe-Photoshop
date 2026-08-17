/**
 * 任务调度器
 * 
 * 根据任务类型和用户偏好选择最合适的 AI 模型
 */

import { ModelService, ModelMessage, ModelResponse } from './model-service';
import { TASK_ROUTING, TaskType } from '../../shared/types/tasks';
import { PROMPTS } from '../../shared/prompts';
import {
    ALL_MODELS,
    getModelById,
    hasRequiredApiKey,
    isConversationModelId,
    type ModelConfig
} from '../../shared/config/models.config';
import { getDynamicModels } from '../../shared/config/dynamic-model-registry';
import {
    getAgentWorkerModels,
    getModelPriorityForPreferenceBucket,
    getPrimaryModelForPreferenceBucket,
    type ModelPreferenceBucket
} from '../../shared/model-selection';
import {
    DEFAULT_MODEL_PREFERENCES,
    normalizeModelPreferences,
    type ModelPreferences as SharedModelPreferences,
    type ModelPreferencesPatch
} from '../../shared/config/models.config';

// 模型模式
export type ModelMode = 'local' | 'cloud';

// 任务模型配置
export interface TaskModelConfig {
    layoutAnalysis: string;
    textOptimize: string;
    visualAnalyze: string;
}

// 模型偏好设置从统一模型配置导入；本文件只负责调度，不重新定义偏好结构。
export type ModelPreferences = SharedModelPreferences;

/** 面板里可选的模型条目（只描述能力事实，不做推荐排序以外的判断） */
export interface TaskModelOption {
    id: string;
    name: string;
    provider: string;
    source: string;
    supportsVision: boolean;
    /** 来自 provider 接口动态拉取：能力字段是"假定值"，不代表真实能力 */
    dynamic: boolean;
}

export interface TaskModelCatalog {
    /** "跟随主模型"实际会用到的模型 */
    primary: TaskModelOption | null;
    /** 精选：注册表内、当前 key 可用的对话模型，能力标注可信 */
    curated: TaskModelOption[];
    /** 搜索结果（仅在传入 query 时有值） */
    matches: TaskModelOption[];
    /** 可搜索的模型总数（含 provider 动态拉取的） */
    searchableCount: number;
    query: string;
}

export interface TaskExecutionOptions {
    /**
     * 本次执行强制使用的模型（如撰写文案面板单独选的文案模型）。
     * 覆盖后不再拼接任何回退候选：用户点名了模型，失败就要如实报错，
     * 不能悄悄换一个模型把结果做出来。
     */
    modelOverride?: string;
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
const DEFAULT_PREFERENCES: ModelPreferences = normalizeModelPreferences(DEFAULT_MODEL_PREFERENCES);

// 任务级思考策略：只要"固定格式结果"、不需要模型展开推理链的任务，默认关闭思考模式。
//
// 真机实测（deepseek-v4-flash，2026-08-06，scripts/probe-text-optimize-live.cjs）：
// 撰写文案带思考时，4096 与 8192 两档输出预算都被 reasoning 全部吃光
// （finish_reason=length、reasoning_tokens 打满、正文 0 字，耗时 33s / 72s 全废），
// 因为提示词要求逐字数字数，模型会在思考里反复数字数停不下来；
// 显式关闭思考后 3.2 秒正常产出全部候选。这不是模型降级（模型没变），是请求参数纠正。
const TASK_THINKING_DISABLED = new Set<TaskType>(['text-optimize']);

function isModelEmptyContentError(error: any): boolean {
    return error?.code === 'model_empty_content';
}

export class TaskOrchestrator {
    private modelService: ModelService;
    private preferences: ModelPreferences = DEFAULT_PREFERENCES;

    constructor(modelService: ModelService) {
        this.modelService = modelService;
    }

    /**
     * 更新模型偏好设置
     */
    updatePreferences(prefs: ModelPreferencesPatch): void {
        this.preferences = normalizeModelPreferences({
            ...this.preferences,
            ...prefs,
            thinking: {
                ...this.preferences.thinking,
                ...prefs.thinking
            }
        });
        console.log('[TaskOrchestrator] Preferences updated:', this.preferences.mode);
    }

    /**
     * 获取当前偏好设置
     */
    getPreferences(): ModelPreferences {
        return this.preferences;
    }

    /** 获取主 Agent / 视觉专家模型；copy 与 logic 都指向主模型，vision 指向独立视觉模型。 */
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
        const candidates = this.getModelCandidatesForTask(taskType);
        return { primary: candidates[0] || 'local-qwen2.5-7b' };
    }

    private getApiKeys(): Record<string, string> {
        const keys = typeof (this.modelService as any).getModelSelectionApiKeys === 'function'
            ? (this.modelService as any).getModelSelectionApiKeys()
            : {};
        return (keys || {}) as Record<string, string>;
    }

    /** 云端模型要有对应 provider 的 key 才算"现在能用"；本地模型不需要 key。 */
    private isModelUsableNow(model: ModelConfig, apiKeys: Record<string, string>): boolean {
        if (!isConversationModelId(model.id)) return false;
        if (model.source !== 'cloud') return true;
        if (!model.requiredApiKey) return true;
        return hasRequiredApiKey(model.id, apiKeys);
    }

    private toModelOption(model: ModelConfig, dynamic: boolean): TaskModelOption {
        return {
            id: model.id,
            name: model.name || model.id,
            provider: model.provider,
            source: model.source,
            supportsVision: model.supportsVision === true,
            dynamic
        };
    }

    /**
     * 面板可选的文案模型清单。
     *
     * 精选只收注册表内的模型：provider 的 /models 接口不报能力，动态模型的
     * supportsVision 一律是假定值 false，摆在推荐位会误导"这个模型能看参考图"。
     * 动态模型仍可通过搜索选到，但会标明能力未经核实。
     */
    listTaskModelCatalog(input: { query?: string; limit?: number } = {}): TaskModelCatalog {
        const apiKeys = this.getApiKeys();
        const query = String(input.query || '').trim().toLowerCase();
        const limit = Math.max(1, Math.min(50, Number(input.limit) || 30));

        // 排序按"现在能直接用上"的程度：云端可读图 → 云端其它 → 本地（要自己开着 Ollama）。
        // 本地模型不需要 key，不排序的话会整片压在最前面，而用户多数时候在 cloud 模式。
        const curatedRank = (option: TaskModelOption) => {
            if (option.source !== 'cloud') return 3;
            return option.supportsVision ? 1 : 2;
        };
        const curated = ALL_MODELS
            .filter(model => this.isModelUsableNow(model, apiKeys))
            .map(model => this.toModelOption(model, false))
            .sort((a, b) => curatedRank(a) - curatedRank(b) || a.name.localeCompare(b.name, 'zh'));

        const dynamic = getDynamicModels()
            .filter(model => this.isModelUsableNow(model, apiKeys))
            .filter(model => !curated.some(item => item.id === model.id))
            .map(model => this.toModelOption(model, true));

        const primaryId = this.getPrimaryModelForLog('text-optimize');
        const primaryModel = primaryId ? getModelById(primaryId) : undefined;
        const primary = primaryModel
            ? this.toModelOption(primaryModel, !ALL_MODELS.some(item => item.id === primaryModel.id))
            : null;

        const matches = query
            ? [...curated, ...dynamic]
                .filter(option => option.id.toLowerCase().includes(query)
                    || option.name.toLowerCase().includes(query)
                    || option.provider.toLowerCase().includes(query))
                .slice(0, limit)
            : [];

        return {
            primary,
            curated,
            matches,
            searchableCount: curated.length + dynamic.length,
            query: input.query ? String(input.query) : ''
        };
    }

    /**
     * 校验面板指定的模型能不能用。不可用时如实报错，不做静默回退。
     */
    resolveTaskModelOverride(modelId: unknown): { ok: true; modelId: string } | { ok: false; error: string } {
        const id = String(modelId || '').trim();
        if (!id) return { ok: false, error: '未指定模型' };

        const model = getModelById(id);
        if (!model) {
            return {
                ok: false,
                error: `未找到模型 ${id}。它可能已从 provider 列表中移除，请在设置里重新刷新模型列表，或改回"跟随主模型"。`
            };
        }
        if (!isConversationModelId(id)) {
            return { ok: false, error: `模型 ${model.name || id} 不是对话模型，不能用来撰写文案。` };
        }
        if (!this.isModelUsableNow(model, this.getApiKeys())) {
            return {
                ok: false,
                error: `模型 ${model.name || id} 需要 ${model.requiredApiKey || model.provider} 的 API Key，当前未配置。请在设置中补齐后再选它。`
            };
        }
        return { ok: true, modelId: id };
    }

    private getModelCandidatesForTask(taskType: TaskType): string[] {
        const configKey = TASK_CONFIG_MAP[taskType] as ModelPreferenceBucket | undefined;
        const apiKeys = typeof (this.modelService as any).getModelSelectionApiKeys === 'function'
            ? (this.modelService as any).getModelSelectionApiKeys()
            : undefined;

        // Unknown task type falls back to static routing config.
        if (!configKey) {
            const routing = TASK_ROUTING.find(r => r.taskType === taskType);
            return [routing?.primaryModel || 'local-qwen2.5-7b'];
        }

        const primary = getPrimaryModelForPreferenceBucket(this.preferences, configKey, {
            mode: this.preferences.mode,
            includeFallback: this.preferences.autoFallback,
            includeCrossTaskBackups: false,
            requireVision: configKey === 'visualAnalyze'
        });
        const recovery = getModelPriorityForPreferenceBucket(this.preferences, configKey, {
            mode: this.preferences.mode,
            includeFallback: true,
            includeCrossTaskBackups: true,
            includeConfiguredProviderBackups: true,
            apiKeys,
            requireVision: configKey === 'visualAnalyze'
        });

        return Array.from(new Set([primary, ...recovery].filter(Boolean)));
    }

    private buildFallbackState(input: {
        stage: string;
        reasonCode: string;
        primaryModel: string;
        fallbackModel?: string | null;
        attempts: Array<{ modelId: string; error?: string }>;
        streamed?: boolean;
    }): Record<string, unknown> {
        return {
            stage: input.stage,
            reasonCode: input.reasonCode,
            primaryModel: input.primaryModel,
            fallbackModel: input.fallbackModel || null,
            attempts: input.attempts,
            streamed: input.streamed === true
        };
    }

    private async executeWithModelCandidate(
        taskType: TaskType,
        input: any,
        options: TaskExecutionOptions | undefined,
        modelId: string,
        attempts: Array<{ modelId: string; error?: string }>,
        primary: string
    ): Promise<any> {
        console.log(`[TaskOrchestrator] Executing ${taskType} with ${modelId} (mode: ${this.preferences.mode})`);
        const messages = this.buildMessages(taskType, input, options, modelId);
        const thinkingDisabledByPolicy = TASK_THINKING_DISABLED.has(taskType);
        const chatOptions: { maxTokens: number; temperature: number; thinkingEnabled?: boolean } = {
            maxTokens: 4096,
            temperature: 0.7,
            ...(thinkingDisabledByPolicy ? { thinkingEnabled: false } : {})
        };

        let response: ModelResponse;
        let recoveredWithoutThinking = false;
        try {
            response = await this.modelService.chat(modelId, messages, chatOptions);
        } catch (error: any) {
            // "调用成功但正文为空"几乎只有一个成因：输出预算被思考内容占满。
            // 这里用同一个模型、只关闭思考重试一次——不换模型，守住"只用用户设置的模型"。
            if (!thinkingDisabledByPolicy && isModelEmptyContentError(error) && error?.thinkingOnly) {
                console.warn(
                    `[TaskOrchestrator] ${taskType} on ${modelId}: 思考内容占满输出预算，正文为空，`
                    + '按关闭思考模式重试一次'
                );
                response = await this.modelService.chat(modelId, messages, {
                    ...chatOptions,
                    thinkingEnabled: false
                });
                recoveredWithoutThinking = true;
            } else {
                throw error;
            }
        }

        const successStage = modelId === primary ? 'primary_success' : 'fallback_success';
        const successReason = modelId === primary ? 'PRIMARY_OK' : 'FALLBACK_OK';
        return this.attachExecutionState(
            this.parseResponse(taskType, response.text),
            this.buildFallbackState({
                stage: recoveredWithoutThinking ? 'recovered_without_thinking' : successStage,
                reasonCode: recoveredWithoutThinking ? 'RETRIED_WITHOUT_THINKING' : successReason,
                primaryModel: primary,
                fallbackModel: modelId === primary ? null : modelId,
                attempts
            })
        );
    }

    /**
     * 本次执行的候选模型列表。
     *
     * 指定了 modelOverride 就只用它一个：这是用户在面板上点名的模型，
     * 后面再挂回退候选等于"你选的失败了我换一个"，正是明令禁止的静默降级。
     * 无效的 override 在这里就抛出，不会退回主模型把结果糊出来。
     */
    private resolveExecutionCandidates(taskType: TaskType, options?: TaskExecutionOptions): string[] {
        const override = String(options?.modelOverride || '').trim();
        if (!override) return this.getModelCandidatesForTask(taskType);

        const resolved = this.resolveTaskModelOverride(override);
        if (!resolved.ok) throw new Error(resolved.error);
        return [resolved.modelId];
    }

    /**
     * 该任务实际执行模型能不能读图。
     *
     * 调用方（如撰写文案）据此决定：提示词要不要说"已附带参考图片"，以及要不要如实告诉用户
     * "这张参考图当前模型看不到"。此前提示词无条件声称已附带图片，而 buildMessages 又按
     * supportsVision 把图丢掉并注入"视觉输入不可用"，同一条消息里前后矛盾。
     */
    getTaskVisionSupport(taskType: TaskType, modelOverride?: string): {
        modelId: string;
        modelName: string;
        supportsVision: boolean;
    } {
        const override = String(modelOverride || '').trim();
        const modelId = override
            || this.getModelCandidatesForTask(taskType)[0]
            || this.getPrimaryModelForLog(taskType);
        const model = getModelById(modelId);
        return {
            modelId,
            modelName: model?.name || modelId,
            supportsVision: model?.supportsVision === true
        };
    }

    private streamWithModelCandidate(
        taskType: TaskType,
        input: any,
        callbacks: TaskStreamCallbacks,
        options: TaskExecutionOptions | undefined,
        modelId: string,
        attempts: Array<{ modelId: string; error?: string }>,
        primary: string
    ): Promise<any> {
        console.log(`[TaskOrchestrator] Streaming ${taskType} with ${modelId} (mode: ${this.preferences.mode})`);
        const messages = this.buildMessages(taskType, input, options, modelId);
        callbacks.onStart?.({ taskType, modelId });

        const adapter = this.modelService.chatStream(
            modelId,
            messages,
            { maxTokens: 4096, temperature: 0.7 }
        );

        return new Promise((resolve, reject) => {
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
                        this.buildFallbackState({
                            stage: modelId === primary ? 'primary_success' : 'fallback_success',
                            reasonCode: modelId === primary ? 'PRIMARY_OK' : 'FALLBACK_OK',
                            primaryModel: primary,
                            fallbackModel: modelId === primary ? null : modelId,
                            attempts,
                            streamed: true
                        })
                    ));
                    return;
                }

                if (chunk.type === 'error') {
                    settled = true;
                    const message = String(chunk.error || '模型流式请求失败');
                    callbacks.onError?.(message);
                    reject(new Error(message));
                }
            });
        });
    }

    private buildAllModelsFailedError(input: {
        taskType: TaskType;
        primary: string;
        attempts: Array<{ modelId: string; error?: string }>;
        streamed?: boolean;
    }): Error {
        const summary = input.attempts
            .map((attempt) => `${attempt.modelId}: ${attempt.error || 'failed'}`)
            .slice(0, 4)
            .join(' | ');
        const error = new Error(summary || `${input.taskType} model execution failed`);
        (error as any).fallbackState = this.buildFallbackState({
            stage: 'all_candidates_failed',
            reasonCode: 'ALL_MODEL_CANDIDATES_FAILED',
            primaryModel: input.primary,
            fallbackModel: null,
            attempts: input.attempts,
            streamed: input.streamed
        });
        return error;
    }

    private getPrimaryModelOrFallback(taskType: TaskType): string {
        const candidates = this.getModelCandidatesForTask(taskType);
        return candidates[0] || 'local-qwen2.5-7b';
    }

    /**
     * 保留给外部兼容：返回当前首选模型，不代表执行时只会尝试这一个模型。
     */
    private getPrimaryModelForLog(taskType: TaskType): string {
        const configKey = TASK_CONFIG_MAP[taskType] as ModelPreferenceBucket | undefined;
        if (!configKey) return this.getPrimaryModelOrFallback(taskType);
        return getPrimaryModelForPreferenceBucket(this.preferences, configKey, {
            mode: this.preferences.mode,
            includeFallback: this.preferences.autoFallback,
            includeCrossTaskBackups: false,
            requireVision: configKey === 'visualAnalyze'
        }) || this.getPrimaryModelOrFallback(taskType);
    }

    /**
     * 执行任务
     */
    async execute(taskType: TaskType, input: any, options?: TaskExecutionOptions): Promise<any> {
        const candidates = this.resolveExecutionCandidates(taskType, options);
        const primary = candidates[0] || this.getPrimaryModelForLog(taskType);
        const attempts: Array<{ modelId: string; error?: string }> = [];

        for (const modelId of candidates) {
            try {
                return await this.executeWithModelCandidate(taskType, input, options, modelId, attempts, primary);
            } catch (error: any) {
                const message = error?.message || String(error);
                attempts.push({ modelId, error: message });
                console.error(`[TaskOrchestrator] Model ${modelId} error:`, message);
            }
        }

        throw this.buildAllModelsFailedError({ taskType, primary, attempts });
    }

    async executeStream(
        taskType: TaskType,
        input: any,
        callbacks: TaskStreamCallbacks = {},
        options?: TaskExecutionOptions
    ): Promise<any> {
        const candidates = this.getModelCandidatesForTask(taskType);
        const primary = candidates[0] || this.getPrimaryModelForLog(taskType);
        const attempts: Array<{ modelId: string; error?: string }> = [];

        for (const modelId of candidates) {
            try {
                return await this.streamWithModelCandidate(taskType, input, callbacks, options, modelId, attempts, primary);
            } catch (error: any) {
                const message = error?.message || String(error);
                attempts.push({ modelId, error: message });
                console.error(`[TaskOrchestrator] Stream model ${modelId} error:`, message);
            }
        }

        throw this.buildAllModelsFailedError({ taskType, primary, attempts, streamed: true });
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
     *
     * systemPromptOverride：调用方自带完整指令时替换默认任务提示词，
     * 避免两套指令叠加互相矛盾（默认提示词与调用方提示词的输出格式约定不同）。
     */
    private buildMessages(taskType: TaskType, input: any, options?: TaskExecutionOptions, modelId?: string): ModelMessage[] {
        const override = typeof input.systemPromptOverride === 'string' ? input.systemPromptOverride.trim() : '';
        const systemPrompt = override || PROMPTS[taskType];

        // 视觉能力以模型注册表为准：不支持视觉的模型不发图，并显式声明图片不可见，
        // 防止提示词声称"已附带图片"而模型实际看不到时臆造画面内容。
        const model = modelId ? getModelById(modelId) : undefined;
        const modelCanSeeImages = model?.supportsVision === true;
        const hasImageInput = Boolean(input.image || input.documentImage);

        // 构建用户消息
        const userContent: any[] = [];

        // 添加系统提示
        userContent.push({
            type: 'text',
            text: systemPrompt
        });

        // 添加输入数据
        if (hasImageInput && !modelCanSeeImages) {
            userContent.push({
                type: 'text',
                text: '\n\n[视觉输入不可用] 当前执行模型无法读取图片，上文提到的参考图片或画布截图实际不可见。禁止臆造画面内容；只依据文字提供的事实作答，与画面强绑定的表达必须省略或改为克制的中性表达。'
            });
        }

        if (input.image && modelCanSeeImages) {
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

        if (input.documentImage && modelCanSeeImages) {
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
