import {
    getModelById,
    isAgentMultimodalModelId,
    normalizeModelPreferences,
    type ApiKeyType,
    type ModelPreferences,
    type ModelPreferencesPatch
} from './config/models.config';

export type ConversationTaskType = 'general' | 'logic' | 'copywriting' | 'visual';
export type ModelPreferenceBucket = 'layoutAnalysis' | 'textOptimize' | 'visualAnalyze';
export type ConversationModelPurpose = string | undefined;

type PreferenceMode = ModelPreferences['mode'];

interface ModelPriorityOptions {
    mode?: PreferenceMode;
    includeCrossTaskBackups?: boolean;
    includeFallback?: boolean;
    requireVision?: boolean;
    requireToolUse?: boolean;
    apiKeys?: Partial<Record<ApiKeyType, string>> | Record<string, string | undefined>;
    includeConfiguredProviderBackups?: boolean;
}

function mergeModelPreferences(
    prefs?: Partial<ModelPreferences> | null
): ModelPreferences {
    return normalizeModelPreferences(prefs as ModelPreferencesPatch | null | undefined);
}

const TASK_TYPE_KEYWORDS: Record<Exclude<ConversationTaskType, 'general'>, string[]> = {
    visual: [
        '\u5206\u6790',
        '\u98ce\u683c',
        '\u914d\u8272',
        '\u6784\u56fe',
        '\u53c2\u8003\u56fe',
        '\u89c6\u89c9',
        '\u770b\u56fe',
        '\u8bc6\u56fe',
        '\u56fe\u7247\u7406\u89e3',
        '\u590d\u523b',
        '\u4eff\u7167',
        '\u7167\u7740\u505a'
    ],
    copywriting: [
        '\u6587\u6848',
        '\u6807\u9898',
        '\u526f\u6807\u9898',
        '\u6da6\u8272',
        '\u6539\u5199',
        '\u91cd\u5199',
        'slogan',
        'copy',
        '\u5356\u70b9',
        '\u8bdd\u672f',
        '\u63cf\u8ff0'
    ],
    logic: [
        '\u62a0\u56fe',
        '\u53bb\u80cc\u666f',
        '\u56fe\u5c42',
        '\u79fb\u52a8',
        '\u5bf9\u9f50',
        '\u7f29\u653e',
        '\u65cb\u8f6c',
        '\u66ff\u6362',
        '\u5bfc\u51fa',
        '\u4fdd\u5b58',
        '\u5173\u95ed',
        '\u65b0\u5efa',
        '\u5b57\u4f53',
        '\u5b57\u53f7',
        'sku',
        '\u4e3b\u56fe',
        '\u8be6\u60c5\u9875',
        '\u6a21\u677f',
        'psd',
        'photoshop'
    ]
};

function containsAnyKeyword(input: string, keywords: string[]): boolean {
    return keywords.some((keyword) => input.includes(keyword));
}

export function detectConversationTaskType(
    userInput: string,
    hasImage: boolean = false
): ConversationTaskType {
    if (hasImage) return 'visual';

    const input = String(userInput || '').toLowerCase();
    if (!input.trim()) return 'general';
    if (containsAnyKeyword(input, TASK_TYPE_KEYWORDS.visual)) return 'visual';
    if (containsAnyKeyword(input, TASK_TYPE_KEYWORDS.copywriting)) return 'copywriting';
    if (containsAnyKeyword(input, TASK_TYPE_KEYWORDS.logic)) return 'logic';
    return 'general';
}

export function resolveConversationTaskTypeForModelPurpose(input: {
    userInput: string;
    hasImage?: boolean;
    purpose?: ConversationModelPurpose;
    silent?: boolean;
}): ConversationTaskType {
    const purpose = String(input.purpose || '').trim();
    if (
        input.silent === true
        || purpose === 'router'
        || purpose === 'visible_reasoning'
        || purpose === 'agent_task_public_plan'
        || purpose === 'resume_planning'
        || purpose === 'design_execution_preflight'
    ) {
        return 'logic';
    }
    return detectConversationTaskType(input.userInput, input.hasImage === true);
}

export function mapConversationTaskToPreferenceBucket(
    taskType: ConversationTaskType
): ModelPreferenceBucket {
    switch (taskType) {
        case 'visual':
            return 'visualAnalyze';
        case 'copywriting':
            return 'textOptimize';
        case 'logic':
        case 'general':
        default:
            return 'layoutAnalysis';
    }
}

export function isVisionCapableModelId(modelId: string): boolean {
    return isAgentMultimodalModelId(modelId);
}

export function isToolCapableModelId(modelId: string): boolean {
    const model = getModelById(modelId);
    return model ? model.supportsToolUse !== false : true;
}

export function getModelPriorityForPreferenceBucket(
    prefs: Partial<ModelPreferences> | null | undefined,
    bucket: ModelPreferenceBucket,
    options: ModelPriorityOptions = {}
): string[] {
    const merged = mergeModelPreferences(prefs);
    const requireToolUse = options.requireToolUse === true;
    // Agent 只有一个模型选择。任务类型不再切换模型；视觉、文案、逻辑和工具调用
    // 都复用同一个已验证全模态 primaryModel。
    const configuredModelId = String(merged.primaryModel).trim();
    if (!configuredModelId) return [];
    if (!isAgentMultimodalModelId(configuredModelId)) return [];
    if (requireToolUse && !isToolCapableModelId(configuredModelId)) return [];
    return [configuredModelId];
}

export function getPrimaryModelForPreferenceBucket(
    prefs: Partial<ModelPreferences> | null | undefined,
    bucket: ModelPreferenceBucket,
    options: ModelPriorityOptions = {}
): string {
    const candidates = getModelPriorityForPreferenceBucket(prefs, bucket, options);
    return candidates[0] || '';
}

export function getModelPriorityForConversationTask(
    prefs: Partial<ModelPreferences> | null | undefined,
    taskType: ConversationTaskType,
    options: ModelPriorityOptions = {}
): string[] {
    return getModelPriorityForPreferenceBucket(
        prefs,
        mapConversationTaskToPreferenceBucket(taskType),
        {
            ...options,
            requireVision: options.requireVision ?? taskType === 'visual'
        }
    );
}

export function getModelRecoveryPriorityForConversationTask(
    prefs: Partial<ModelPreferences> | null | undefined,
    taskType: ConversationTaskType,
    options: ModelPriorityOptions = {}
): string[] {
    // 单模型架构禁止运行中静默换到另一模型。调用失败必须把真实错误交还上层，
    // 不能从历史能力槽或跨 provider 列表挑选“备用 Agent”。
    return getModelPriorityForConversationTask(prefs, taskType, options);
}

export function getPrimaryModelForConversationTask(
    prefs: Partial<ModelPreferences> | null | undefined,
    taskType: ConversationTaskType,
    options: ModelPriorityOptions = {}
): string {
    const candidates = getModelPriorityForConversationTask(prefs, taskType, options);
    return candidates[0] || '';
}

export function getAgentWorkerModels(
    prefs: Partial<ModelPreferences> | null | undefined,
    options: Pick<ModelPriorityOptions, 'mode' | 'includeFallback'> = {}
): { vision: string; copy: string; logic: string } {
    const modelId = getPrimaryModelForPreferenceBucket(prefs, 'layoutAnalysis', {
        ...options,
        requireVision: true,
        requireToolUse: true,
        includeCrossTaskBackups: false
    });
    return {
        vision: modelId,
        copy: modelId,
        logic: modelId
    };
}
