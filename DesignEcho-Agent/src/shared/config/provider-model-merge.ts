/**
 * Provider 模型自动获取——合并层（纯逻辑，可 smoke）。
 *
 * 背景：模型列表此前硬编码在 models.config.ts。provider 出新模型要手动加。
 * 本模块把「从 provider 官方列模型接口拉到的最新 id」与「硬编码已知模型」合并：
 *   - 硬编码已知模型 = 能力覆盖层：提供可靠的 vision / tool / pricing / roles。
 *   - 官方拉取 = 最新 id 全集：让新模型自动出现。
 *   - 二者按 apiModelId 对齐：已知模型保留硬编码能力；新发现模型用拉取能力 +
 *     保守默认补全为完整 ModelConfig。
 *
 * vision / tool 不按模型名猜测：Provider 没有明确返回时，动态模型不能自动获得视觉理解
 * 或 Agent Tool Calling 身份。新模型仍可作为待确认普通对话候选，专项能力需可靠元数据、
 * 人工维护覆盖或后续可审计能力探针。
 *
 * thinking 不做命名提示：只有 provider 标准化层明确给出 supportsThinking=true，才写入
 * thinking 配置，避免把模型名里的 r1/o1/reasoning/qwq 当成官方能力声明。
 *
 * 纯逻辑、无 HTTP / 无 Photoshop / 无 renderer 依赖，可被 smoke 直接验证。
 * HTTP 拉取（per-provider 适配）与 IPC / UI 在别处实现，本模块只做确定性合并。
 */

import {
    classifyModelUsage,
    MODEL_USAGE_KIND_LABELS,
    type ModelUsageKind
} from './model-usage-classification';
import type { ModelConfig, ModelProvider, ModelRole, ApiKeyType, ThinkingFormat } from './models.config';

/**
 * 从某 provider 官方列模型接口拉到、已标准化的单个模型。
 * 能力字段缺失时留 undefined，交给 merge 用「已知覆盖 / 默认 / 命名提示」补全。
 */
export interface FetchedProviderModel {
    apiModelId: string;
    name?: string;
    /** Provider 原始用途声明，例如 model_type / task / type；由集中分类层解释。 */
    declaredKind?: string;
    inputModalities?: string[];
    outputModalities?: string[];
    capabilityNames?: string[];
    supportedMethods?: string[];
    supportsVision?: boolean;
    supportsToolUse?: boolean;
    contextWindow?: number;
    /** 拉取接口明确给出的 thinking 能力（如 OpenRouter supported_parameters 含 reasoning）；缺失时不猜测 */
    supportsThinking?: boolean;
    /** 拉取接口给出 thinking 时的格式（缺省 reasoning_content） */
    thinkingFormat?: ThinkingFormat;
}

export interface MergeFetchedModelsResult {
    /** 合并后的完整模型列表（已知全保留 + 新发现追加），可直接喂设置下拉。 */
    models: ModelConfig[];
    knownCount: number;
    /** 本次新发现（硬编码里没有）的模型数。 */
    newCount: number;
    /** 新发现模型的内部 id 列表（${provider}-${slug}）。 */
    newModelIds: string[];
    /** 新发现且可进入 Agent 主模型/视觉模型候选的对话模型。 */
    newConversationModelIds: string[];
    /** 新发现但属于图片生成、Embedding、重排、音视频或审核用途的模型。 */
    newNonConversationModelIds: string[];
}

/** provider → 所需 apiKey 类型（给新发现模型补 requiredApiKey；不映射的 provider 留 undefined） */
const PROVIDER_REQUIRED_KEY: Partial<Record<ModelProvider, ApiKeyType>> = {
    google: 'google',
    xiaomi: 'xiaomi',
    openrouter: 'openrouter',
    deepseek: 'deepseek',
    'ollama-cloud': 'ollamaApiKey',
    ollama: 'ollamaUrl',
    openai: 'openai',
    anthropic: 'anthropic'
};

/**
 * provider 未在列模型接口里声明工具调用能力时的默认值。
 *
 * 这些 provider 的 /v1/models 是 OpenAI 兼容格式，**只返回 id/object/created/owned_by，
 * 根本没有能力字段**——但它们的对话模型全系支持 OpenAI 风格 function calling。
 * 用 `item.supportsToolUse === true` 收敛会把 undefined（"接口没说"）折成 false（"确定不支持"），
 * 于是主 Agent 判定该模型不可用并报 no_usable_model：用户在模型选择器里选得到，选了却用不了
 *（真机 2026-08-01：deepseek-v4-flash 即如此）。
 *
 * 只列「对话模型全系支持 function calling 的单一厂商」；聚合网关与未知 provider 一律不列，
 * 保持 false——宁可少给能力也不虚报。
 * provider 自己明确声明时（如 OpenRouter 的 supported_parameters）永远以声明为准。
 */
const PROVIDER_DEFAULT_TOOL_USE: Partial<Record<ModelProvider, boolean>> = {
    deepseek: true,
    openai: true,
    anthropic: true,
    xiaomi: true
    // 刻意不含聚合网关（openrouter）：它底下挂着各家几百个模型，
    // 其中确有不支持工具调用的，按 provider 一刀切默认就是虚报能力
    //（smoke-provider-model-merge「不伪造 Tool 能力」正是为此设的护栏）。
    // 只有「对话模型全系支持 function calling 的单一厂商」才配默认值。
};

/**
 * 给硬编码里没填 contextWindow 的已知模型补上 provider 返回的真实窗口。
 *
 * 必须替换成新对象而不是就地赋值：known 数组来自 getModelsByProvider()，元素是
 * ALL_MODELS 里的同一批对象引用，就地改会把全局硬编码配置一起改掉。
 */
function backfillKnownContextWindow(
    merged: ModelConfig[],
    apiModelId: string,
    fetchedContextWindow: number | undefined
): void {
    if (!(typeof fetchedContextWindow === 'number' && fetchedContextWindow > 0)) return;
    const index = merged.findIndex((model) => model.apiModelId === apiModelId);
    if (index < 0) return;
    if (Number(merged[index].contextWindow) > 0) return;
    merged[index] = { ...merged[index], contextWindow: fetchedContextWindow };
}

function slugifyModelId(apiModelId: string): string {
    return apiModelId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * 动态拉取模型的一句话说明。
 *
 * 这段文字会逐行出现在模型选择器里，所以有两条硬要求：
 * 1. 短 —— 一屏可能有十几条动态模型，长句会淹掉真正有区分度的模型名与能力徽标。
 * 2. 平静 —— 早先这里写的是「用途判断：metadata，可能需人工校准」，
 *    把内部判定依据直接摊给用户，读起来像程序自己都没把握、随时会出错。
 *
 * 只有 assumed（provider 什么能力信息都没给、我们纯靠猜）才值得多一句提醒；
 * declared / metadata / inferred 都是有依据的判定，不该拿来吓用户。
 */
function buildDynamicModelDescription(
    usage: { kind: ModelUsageKind; confidence: string },
    isConversation: boolean
): string {
    if (!isConversation) {
        return `渠道接口提供的${MODEL_USAGE_KIND_LABELS[usage.kind]}模型，不用于 Agent 对话`;
    }
    return usage.confidence === 'assumed'
        ? '渠道接口提供的新模型，具体能力以实际调用为准'
        : '渠道接口提供的新模型';
}

function rolesForUsage(usageKind: ModelUsageKind, supportsVision: boolean): ModelRole[] {
    if (usageKind === 'image-generation') return ['image-generation'];
    if (usageKind !== 'conversation') return [];
    return supportsVision ? ['general', 'vision'] : ['general'];
}

function capabilitiesForUsage(usageKind: ModelUsageKind): string[] {
    switch (usageKind) {
        case 'image-generation':
            return ['image-generation'];
        case 'embedding':
            return ['embedding'];
        case 'reranking':
            return ['reranking'];
        case 'audio-processing':
            return ['audio-processing'];
        case 'video-generation':
            return ['video-generation'];
        case 'moderation':
            return ['moderation'];
        case 'conversation':
        default:
            return ['text-generation'];
    }
}

/**
 * v37/v38 持久化的动态模型没有 usageKind，且可能保存了旧合并层猜出的 vision/tool 能力。
 * 旧记录无法区分“Provider 明确声明”与“代码默认猜测”，因此迁移时只保留身份和展示信息，
 * 重新按 apiModelId 做用途分类，并把专项能力收紧到未确认状态。
 */
export function normalizeDynamicModelUsageConfig(model: ModelConfig): ModelConfig {
    if (model.usageKind) return model;
    const usage = classifyModelUsage({ apiModelId: model.apiModelId });
    const isConversation = usage.kind === 'conversation';
    return {
        ...model,
        roles: rolesForUsage(usage.kind, false),
        capabilities: capabilitiesForUsage(usage.kind),
        usageKind: usage.kind,
        usageConfidence: usage.confidence,
        supportsVision: false,
        supportsToolUse: false,
        supportsStreaming: isConversation,
        // 文案同样面向用户：迁移是内部动作，不该让用户读到「待确认」「需重新验证」
        // 这类像是出了问题的措辞。能力收紧的事实由徽标与调用时的真实报错承担。
        description: buildDynamicModelDescription(usage, isConversation)
    };
}

/**
 * 合并官方拉取的最新模型与硬编码已知模型。确定性、可重复。
 *
 * @param provider 目标 provider
 * @param fetched  官方接口拉到的标准化模型（能力可缺失）
 * @param known    该 provider 的硬编码已知模型（如 getModelsByProvider(provider)），作能力覆盖层
 */
export function mergeFetchedProviderModels(
    provider: ModelProvider,
    fetched: FetchedProviderModel[],
    known: ModelConfig[]
): MergeFetchedModelsResult {
    // 已知模型全部保留（即使本次接口没返回也不丢），它们是可靠的能力覆盖层。
    const merged: ModelConfig[] = [...known];
    const seenApiModelIds = new Set<string>(known.map((m) => m.apiModelId));
    const newModelIds: string[] = [];
    const newConversationModelIds: string[] = [];
    const newNonConversationModelIds: string[] = [];

    for (const item of Array.isArray(fetched) ? fetched : []) {
        const apiModelId = String(item?.apiModelId || '').trim();
        if (!apiModelId) continue;
        // 已知模型的能力以硬编码为准，不被拉取的保守默认覆盖。
        // 但"硬编码没填"不等于"不许 provider 说"：contextWindow 是可选字段，
        // undefined 就是没填（supportsVision 这类必填布尔的 false 才是明确声明不支持）。
        // 不补的话，硬编码模型会一直显示未知窗口，反而挡住 provider 返回的真实值
        //（真机 2026-08-23：ollama-cloud 的 qwen3-vl 即如此）。
        if (seenApiModelIds.has(apiModelId)) {
            backfillKnownContextWindow(merged, apiModelId, item.contextWindow);
            continue;
        }
        seenApiModelIds.add(apiModelId);

        const usage = classifyModelUsage({
            apiModelId,
            declaredKind: item.declaredKind,
            inputModalities: item.inputModalities,
            outputModalities: item.outputModalities,
            capabilityNames: item.capabilityNames,
            supportedMethods: item.supportedMethods
        });
        const isConversation = usage.kind === 'conversation';
        // “可以输入图片”只有在对话模型上才代表视觉理解；图片编辑模型不能冒充 VLM。
        const supportsVision = isConversation && item.supportsVision === true;
        // 三态必须从这里就保住：接口声明 > provider 已知能力 > **undefined（未知）**。
        // 绝不能再 `?? false` —— 那会把「没说」压成「确定不支持」，下游任何判定都救不回来，
        // 界面上就会出现一整屏「不支持工具调用」的 Gemini / GPT（它们其实全都支持）。
        // 非对话模型（TTS/图像/embedding）才是确定不支持，直接 false。
        const supportsToolUse: boolean | undefined = isConversation
            ? (item.supportsToolUse ?? PROVIDER_DEFAULT_TOOL_USE[provider])
            : false;
        const roles = rolesForUsage(usage.kind, supportsVision);

        // thinking：只接受 provider 标准化层给出的官方/接口能力；都没有则不设（视为不支持）。
        const thinkingFormat: ThinkingFormat | undefined = item.supportsThinking
            ? item.thinkingFormat || 'reasoning_content'
            : undefined;

        const modelId = `${provider}-${slugifyModelId(apiModelId)}`;
        merged.push({
            id: modelId,
            name: item.name || apiModelId,
            source: provider === 'ollama' ? 'local' : 'cloud',
            provider,
            requiredApiKey: PROVIDER_REQUIRED_KEY[provider],
            apiModelId,
            roles,
            capabilities: capabilitiesForUsage(usage.kind),
            usageKind: usage.kind,
            usageConfidence: usage.confidence,
            supportsVision,
            supportsToolUse,
            supportsStreaming: isConversation,
            maxTokens: 8192,
            ...(typeof item.contextWindow === 'number' ? { contextWindow: item.contextWindow } : {}),
            ...(thinkingFormat ? { thinking: { supported: true, format: thinkingFormat } } : {}),
            description: buildDynamicModelDescription(usage, isConversation)
        });
        newModelIds.push(modelId);
        if (isConversation) newConversationModelIds.push(modelId);
        else newNonConversationModelIds.push(modelId);
    }

    return {
        models: merged,
        knownCount: known.length,
        newCount: newModelIds.length,
        newModelIds,
        newConversationModelIds,
        newNonConversationModelIds
    };
}
