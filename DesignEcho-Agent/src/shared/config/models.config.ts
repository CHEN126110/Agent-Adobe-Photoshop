/**
 * 统一模型配置 v2.0
 * 
 * 这是整个项目模型配置的唯一来源 (Single Source of Truth)
 * 
 * ## 架构说明
 * 
 * 模型分为两大类：
 * 1. **本地模型** (source: 'local') - 需要本地服务运行
 *    - Ollama 本地 LLM
 * 
 * 2. **云端模型** (source: 'cloud') - 使用 API Key 或受管账号会话
 *    - Google AI Studio (provider: 'google') → apiKeys.google
 *    - Xiaomi MiMo (provider: 'xiaomi') → apiKeys.xiaomi
 *    - OpenRouter (provider: 'openrouter') → apiKeys.openrouter
 *    - Anthropic (provider: 'anthropic') → apiKeys.anthropic
 *    - OpenAI (provider: 'openai') → apiKeys.openai
 *    - Ollama Cloud (provider: 'ollama-cloud') → apiKeys.ollamaApiKey
 *    - DeepSeek 官方 (provider: 'deepseek') → apiKeys.deepseek
 *    - ChatGPT 订阅 (provider: 'openai-codex') → Codex App Server 受管登录
 */

// 动态模型注册表（进程内覆盖层）：getModelById 未命中硬编码时回退到此。
// 单向值依赖：models.config → dynamic-model-registry；后者只 `import type` ModelConfig，
// 不形成运行时循环依赖。
import { getDynamicModelById } from './dynamic-model-registry';
import type { ModelUsageConfidence, ModelUsageKind } from './model-usage-classification';

// ========== 类型定义 ==========

/** 模型来源：本地服务 或 云端API */
export type ModelSource = 'local' | 'cloud';

/** 模型提供商 */
export type ModelProvider = 
    | 'ollama'        // 本地 Ollama
    | 'ollama-cloud'  // Ollama 云服务
    | 'google'        // Google AI Studio 官方
    | 'xiaomi'        // Xiaomi MiMo 官方
    | 'openrouter'    // OpenRouter 中转
    | 'anthropic'     // Anthropic 直连
    | 'openai'        // OpenAI 直连
    | 'openai-codex'  // ChatGPT 订阅（Codex App Server）
    | 'claude-subscription'  // Claude 订阅（Claude Agent SDK 内嵌运行时）
    | 'deepseek';     // DeepSeek 官方

/** API Key 类型映射 */
export type ApiKeyType = 
    | 'ollamaUrl'      // 本地 Ollama URL（非 Key）
    | 'ollamaApiKey'   // Ollama Cloud API Key
    | 'google'         // Google AI Studio Key
    | 'xiaomi'         // Xiaomi MiMo Key
    | 'openrouter'     // OpenRouter Key
    | 'anthropic'      // Anthropic Key
    | 'openai'         // OpenAI Key
    | 'deepseek';      // DeepSeek 官方 API Key

export type ModelRole = 
    | 'general'           // 通用
    | 'layout-analysis'   // 排版分析
    | 'copywriting'       // 文案撰写
    | 'vision'            // 视觉理解
    | 'code'              // 代码生成
    | 'image-generation'  // 图像生成
    | 'image-editing';    // 图像编辑

export type TaskCategory = 'layoutAnalysis' | 'textOptimize' | 'visualAnalyze';

export type ModelAuthRequirement =
    | { kind: 'none' }
    | { kind: 'api_key'; keyType: ApiKeyType }
    | { kind: 'account_session'; provider: 'openai-codex' | 'claude-subscription' };

/**
 * 思维过程格式类型
 * 
 * - 'extended_thinking': Claude Extended Thinking API (返回 thinking block)
 * - 'reasoning_content': DeepSeek 风格 (reasoning_content 字段)
 * - 'think_tag': Qwen3 风格 (/think 标签或 enable_thinking 参数)
 * - 'xml_tag': 通用 XML 标签 (<thinking>...</thinking>)
 * - 'none': 不支持思维过程
 */
export type ThinkingFormat = 
    | 'extended_thinking'  // Claude
    | 'reasoning_content'  // DeepSeek
    | 'think_tag'          // Qwen3
    | 'xml_tag'            // 通用 XML
    | 'none';              // 不支持

/**
 * 思维过程能力配置
 */
export interface ThinkingConfig {
    /** 是否原生支持思维过程 */
    supported: boolean;
    /** 思维过程格式类型 */
    format: ThinkingFormat;
    /** 请求时需要的额外参数（如 Qwen3 的 enable_thinking） */
    requestParams?: Record<string, any>;
}

export interface ModelConfig {
    id: string;                    // 唯一标识
    name: string;                  // 显示名称
    source: ModelSource;           // 模型来源：local/cloud
    provider: ModelProvider;       // 提供商
    requiredApiKey?: ApiKeyType;   // 需要的 API Key 类型
    /** 认证方式；账号会话模型不能借用 requiredApiKey 或 renderer 的 apiKeys。 */
    authRequirement?: ModelAuthRequirement;
    apiModelId: string;            // 实际 API 调用时使用的模型 ID
    roles: ModelRole[];            // 适用的角色
    capabilities: string[];        // 能力标签
    /** 模型真实用途；动态模型必须显式分类，避免图片生成模型混入对话候选。 */
    usageKind?: ModelUsageKind;
    /** 用途判断的可靠程度；assumed 表示 provider 未返回足够能力元数据。 */
    usageConfidence?: ModelUsageConfidence;
    supportsVision: boolean;       // 是否支持视觉
    supportsToolUse?: boolean;     // 是否支持工具调用（chatWithTools）
    supportsStreaming: boolean;    // 是否支持流式
    maxTokens: number;             // 最大输出 token
    contextWindow?: number;        // 上下文窗口大小
    /** Provider 目录真实返回的推理档位；仅用于该 provider 自己的请求映射。 */
    reasoningEfforts?: string[];
    defaultReasoningEffort?: string;
    
    // 🆕 思维过程能力配置
    thinking?: ThinkingConfig;
    
    pricing?: {                    // 定价（每百万 token）
        inputPerMillion: number;
        outputPerMillion: number;
    };
    size?: string;                 // 模型大小（本地模型）
    vram?: string;                 // 显存需求（本地模型）
    recommended?: boolean;         // 是否推荐
    description?: string;          // 描述
}

// ========== 本地模型：Ollama ==========

export const LOCAL_MODELS: ModelConfig[] = [
    // ===== 强烈推荐（中文能力强，适合设计场景）=====
    {
        id: 'local-qwen2.5-14b',
        name: '⭐ Qwen2.5 14B',
        source: 'local',
        provider: 'ollama',
        requiredApiKey: 'ollamaUrl',
        apiModelId: 'qwen2.5:14b',
        roles: ['copywriting', 'general', 'layout-analysis'],
        capabilities: ['text-generation', 'reasoning', 'chinese'],
        supportsVision: false,
        supportsStreaming: true,
        maxTokens: 16384,
        size: '8.9GB',
        vram: '10GB',
        recommended: true,
        description: '通义千问中杯，中文写作最稳'
    },
    {
        id: 'local-qwen2.5-7b',
        name: 'Qwen2.5 7B',
        source: 'local',
        provider: 'ollama',
        requiredApiKey: 'ollamaUrl',
        apiModelId: 'qwen2.5:7b',
        roles: ['copywriting', 'general'],
        capabilities: ['text-generation', 'reasoning', 'chinese', 'fast'],
        supportsVision: false,
        supportsStreaming: true,
        maxTokens: 8192,
        size: '4.7GB',
        vram: '6GB',
        recommended: true,
        description: '通义千问小杯，速度快、占用小'
    },
    {
        id: 'local-qwen2.5-32b',
        name: 'Qwen2.5 32B',
        source: 'local',
        provider: 'ollama',
        requiredApiKey: 'ollamaUrl',
        apiModelId: 'qwen2.5:32b',
        roles: ['copywriting', 'general', 'layout-analysis'],
        capabilities: ['text-generation', 'reasoning', 'chinese'],
        supportsVision: false,
        supportsStreaming: true,
        maxTokens: 32768,
        size: '19GB',
        vram: '24GB',
        description: '通义千问大杯，中文最好，吃显存'
    },
    {
        id: 'local-deepseek-coder-v2-16b',
        name: '⭐ DeepSeek Coder V2',
        source: 'local',
        provider: 'ollama',
        requiredApiKey: 'ollamaUrl',
        apiModelId: 'deepseek-coder-v2:16b',
        roles: ['layout-analysis', 'general', 'code'],
        capabilities: ['text-generation', 'reasoning', 'code', 'instruction-following'],
        supportsVision: false,
        supportsStreaming: true,
        maxTokens: 16384,
        size: '8.9GB',
        vram: '10GB',
        recommended: true,
        description: 'DeepSeek 代码模型，指令跟随稳'
    },
    // ===== 视觉模型 =====
    {
        id: 'local-llava-13b',
        name: '⭐ LLaVA 1.6 13B',
        source: 'local',
        provider: 'ollama',
        requiredApiKey: 'ollamaUrl',
        apiModelId: 'llava:13b',
        roles: ['vision'],
        capabilities: ['text-generation', 'vision', 'image-understanding'],
        supportsVision: true,
        supportsStreaming: true,
        maxTokens: 4096,
        size: '8GB',
        vram: '10GB',
        recommended: true,
        description: '开源看图模型，画面理解较细'
    },
    {
        id: 'local-llava-7b',
        name: 'LLaVA 7B',
        source: 'local',
        provider: 'ollama',
        requiredApiKey: 'ollamaUrl',
        apiModelId: 'llava:7b',
        roles: ['vision'],
        capabilities: ['text-generation', 'vision', 'image-understanding', 'fast'],
        supportsVision: true,
        supportsStreaming: true,
        maxTokens: 4096,
        size: '4.7GB',
        vram: '6GB',
        description: '开源看图模型，轻量快速'
    },
    {
        id: 'local-llava-llama3-8b',
        name: 'LLaVA-Llama3 8B',
        source: 'local',
        provider: 'ollama',
        requiredApiKey: 'ollamaUrl',
        apiModelId: 'llava-llama3:8b',
        roles: ['vision'],
        capabilities: ['text-generation', 'vision', 'image-understanding'],
        supportsVision: true,
        supportsStreaming: true,
        maxTokens: 4096,
        size: '5GB',
        vram: '8GB',
        description: '开源看图模型，基于 Llama 3'
    },
    {
        id: 'local-minicpm-v-8b',
        name: 'MiniCPM-V 8B',
        source: 'local',
        provider: 'ollama',
        requiredApiKey: 'ollamaUrl',
        apiModelId: 'minicpm-v:8b',
        roles: ['vision'],
        capabilities: ['text-generation', 'vision', 'image-understanding', 'chinese'],
        supportsVision: true,
        supportsStreaming: true,
        maxTokens: 4096,
        size: '5GB',
        vram: '8GB',
        description: '面壁看图模型，中文表现好'
    },
    // ===== 其他本地模型 =====
    {
        id: 'local-gemma2-9b',
        name: 'Gemma 2 9B',
        source: 'local',
        provider: 'ollama',
        requiredApiKey: 'ollamaUrl',
        apiModelId: 'gemma2:9b',
        roles: ['general'],
        capabilities: ['text-generation', 'reasoning'],
        supportsVision: false,
        supportsStreaming: true,
        maxTokens: 8192,
        size: '5.5GB',
        vram: '8GB',
        description: 'Google 开源模型，通用均衡'
    },
    {
        id: 'local-yi-9b',
        name: 'Yi 9B',
        source: 'local',
        provider: 'ollama',
        requiredApiKey: 'ollamaUrl',
        apiModelId: 'yi:9b',
        roles: ['general', 'copywriting'],
        capabilities: ['text-generation', 'reasoning', 'chinese'],
        supportsVision: false,
        supportsStreaming: true,
        maxTokens: 4096,
        size: '5GB',
        vram: '8GB',
        description: '零一万物模型，中文通用'
    },
    {
        id: 'local-glm4-9b',
        name: 'GLM-4 9B',
        source: 'local',
        provider: 'ollama',
        requiredApiKey: 'ollamaUrl',
        apiModelId: 'glm4:9b',
        roles: ['general', 'copywriting'],
        capabilities: ['text-generation', 'reasoning', 'chinese'],
        supportsVision: false,
        supportsStreaming: true,
        maxTokens: 8192,
        size: '5.5GB',
        vram: '8GB',
        description: '智谱开源模型，中文通用'
    },
    {
        id: 'local-mistral-7b',
        name: 'Mistral 7B',
        source: 'local',
        provider: 'ollama',
        requiredApiKey: 'ollamaUrl',
        apiModelId: 'mistral:7b',
        roles: ['general'],
        capabilities: ['text-generation', 'reasoning', 'fast'],
        supportsVision: false,
        supportsStreaming: true,
        maxTokens: 8192,
        size: '4.1GB',
        vram: '6GB',
        description: 'Mistral 开源模型，轻快通用'
    },
    {
        id: 'local-llama3.2-3b',
        name: 'Llama 3.2 3B',
        source: 'local',
        provider: 'ollama',
        requiredApiKey: 'ollamaUrl',
        apiModelId: 'llama3.2:3b',
        roles: ['general'],
        capabilities: ['text-generation', 'fast'],
        supportsVision: false,
        supportsStreaming: true,
        maxTokens: 4096,
        size: '2GB',
        vram: '4GB',
        description: 'Meta 超小模型，响应最快'
    },
];

// ========== 云端模型：Google AI Studio 官方 ==========
// 参考文档: https://ai.google.dev/gemini-api/docs?hl=zh-cn

export const GOOGLE_MODELS: ModelConfig[] = [
    // ========== Gemini 3 系列（最新）==========
    {
        // 内部 id 停留在 'google-gemini-3-pro' 是有意的：它只是本地标识，用户已保存的
        // 模型偏好与 test-model-usage-classification 的 24 处断言都按它对齐。改 id 只会
        // 让这些引用悬空，换不来任何真实收益——真正对外的身份是 apiModelId。
        id: 'google-gemini-3-pro',
        name: '⭐ Gemini 3.1 Pro',
        source: 'cloud',
        provider: 'google',
        requiredApiKey: 'google',
        // gemini-3-pro-preview 已从 Google 目录下架（2026-08-23 实测：50 个线上模型中不存在），
        // 线上接任的是 3.1。窗口与输出上限取自 models.list 的 inputTokenLimit / outputTokenLimit。
        apiModelId: 'gemini-3.1-pro-preview',
        roles: ['layout-analysis', 'vision', 'general', 'code'],
        capabilities: ['text-generation', 'vision', 'reasoning', 'code', 'thinking'],
        supportsVision: true,
        supportsStreaming: true,
        maxTokens: 65536,
        contextWindow: 1_048_576,
        thinking: { supported: true, format: 'think_tag' },
        // 不写 pricing：Google 的 models.list 不返回价格，旧的 2.0/15.0 是 3 Pro 的价，
        // 照搬给 3.1 就是编数字。该字段在配置文件外无人读取，留空不影响功能。
        recommended: true,
        description: 'Google 最强模型，看图与推理都出色'
    },
    {
        id: 'google-gemini-3-flash',
        name: '⭐ Gemini 3 Flash',
        source: 'cloud',
        provider: 'google',
        requiredApiKey: 'google',
        apiModelId: 'gemini-3-flash-preview',  // Gemini 3 Flash 预览版
        roles: ['vision', 'general', 'copywriting', 'layout-analysis'],
        capabilities: ['text-generation', 'vision', 'reasoning', 'fast', 'thinking'],
        supportsVision: true,
        supportsStreaming: true,
        maxTokens: 65536,
        thinking: { supported: true, format: 'think_tag' },
        pricing: { inputPerMillion: 0.20, outputPerMillion: 0.80 },
        recommended: true,
        description: 'Google 轻量款，速度快，适合日常任务'
    },
];

// ========== 云端模型：Xiaomi MiMo 官方 ==========
// 官方文档: https://platform.xiaomimimo.com/docs/zh-CN/api/chat/openai-api
// 模型命名参考: https://platform.xiaomimimo.com/llms.txt
export const XIAOMI_MODELS: ModelConfig[] = [
    {
        id: 'xiaomi-mimo-v2.5-pro',
        name: '⭐ MiMo V2.5 Pro (官方)',
        source: 'cloud',
        provider: 'xiaomi',
        requiredApiKey: 'xiaomi',
        apiModelId: 'mimo-v2.5-pro',
        roles: ['layout-analysis', 'copywriting', 'general', 'code'],
        capabilities: ['text-generation', 'reasoning', 'code', 'chinese', 'long-context', 'tool-calling', 'web-search-ready'],
        supportsVision: false,
        supportsToolUse: true,
        supportsStreaming: true,
        maxTokens: 32768,
        thinking: { supported: true, format: 'reasoning_content' },
        recommended: true,
        description: '小米旗舰模型，中文推理与规划见长'
    },
    {
        id: 'xiaomi-mimo-v2.5',
        name: '⭐ MiMo V2.5 (官方)',
        source: 'cloud',
        provider: 'xiaomi',
        requiredApiKey: 'xiaomi',
        apiModelId: 'mimo-v2.5',
        roles: ['layout-analysis', 'copywriting', 'general', 'code', 'vision'],
        capabilities: ['text-generation', 'vision', 'image-understanding', 'audio-understanding', 'video-understanding', 'reasoning', 'chinese', 'long-context', 'tool-calling', 'web-search-ready'],
        supportsVision: true,
        supportsToolUse: true,
        supportsStreaming: true,
        maxTokens: 32768,
        thinking: { supported: true, format: 'reasoning_content' },
        recommended: true,
        description: '小米全模态模型，能看图，也能听音看视频'
    },
    {
        // 能力经真机实测确定（2026-07-26，直连 api.xiaomimimo.com）：
        //   文本 ✓ / 工具调用 ✓（正确返回 tool_calls）/ 流式 ✓（约 400-540 tok/s，首字节约 0.4s）
        //   视觉 ✗ —— **危险的静默失明**：传图返回 HTTP 200 不报错，模型却答「您似乎没有附上图片」。
        //   （对照：mimo-v2.5-pro 会明确报 No endpoints found that support image input；mimo-v2.5 能正确答出图片颜色。）
        // 因此 supportsVision 必须为 false，让视觉调度（requireVision）永不选中它，
        // 避免 Agent 拿着「什么都没看见」的结论继续做设计。
        // id 必须与「从 provider 接口动态拉取后 slug 化」的内部 id 完全一致：
        // provider-model-merge 把 apiModelId 的点抹成横线（mimo-v2.5-pro-ultraspeed →
        // xiaomi-mimo-v2-5-pro-ultraspeed）。若这里写成带点的 id，用户在设置里选中的是动态那条，
        // getModelById 查不到硬编码条目 → 自主执行路径拿不到完整模型配置 → 本地直接失败
        // （真机：40ms 就报「当前模型没有通过认证」，而普通对话因另有兜底反而正常）。
        id: 'xiaomi-mimo-v2-5-pro-ultraspeed',
        name: '⚡ MiMo V2.5 Pro UltraSpeed (官方)',
        source: 'cloud',
        provider: 'xiaomi',
        requiredApiKey: 'xiaomi',
        apiModelId: 'mimo-v2.5-pro-ultraspeed',
        roles: ['layout-analysis', 'copywriting', 'general', 'code'],
        capabilities: ['text-generation', 'reasoning', 'code', 'chinese', 'long-context', 'tool-calling'],
        supportsVision: false,
        supportsToolUse: true,
        supportsStreaming: true,
        maxTokens: 32768,
        thinking: { supported: true, format: 'reasoning_content' },
        recommended: true,
        description: '小米极速版，回复很快，但不能看图'
    }
];

// ========== 云端模型：OpenRouter 渠道 ==========

export const OPENROUTER_MODELS: ModelConfig[] = [
    {
        // anthropic/claude-3.5-sonnet 已从 OpenRouter 目录下架（2026-08-23 实测：422 个线上模型中不存在）。
        // 下列规格全部取自 OpenRouter /models 的真实返回：context_length、
        // top_provider.max_completion_tokens、pricing（每 token 美元 × 1e6）、input_modalities。
        id: 'openrouter-claude-sonnet-5',
        name: '⭐ Claude Sonnet 5',
        source: 'cloud',
        provider: 'openrouter',
        requiredApiKey: 'openrouter',
        apiModelId: 'anthropic/claude-sonnet-5',
        roles: ['layout-analysis', 'copywriting', 'general', 'code', 'vision'],
        capabilities: ['text-generation', 'vision', 'reasoning', 'code'],
        supportsVision: true,
        supportsToolUse: true,
        supportsStreaming: true,
        maxTokens: 128_000,
        contextWindow: 1_000_000,
        thinking: { supported: true, format: 'extended_thinking' },
        pricing: { inputPerMillion: 2, outputPerMillion: 10 },
        recommended: true,
        description: 'Anthropic 主力款，能看图，综合稳定'
    },
    {
        id: 'openrouter-gpt-4o',
        name: '⭐ GPT-4o',
        source: 'cloud',
        provider: 'openrouter',
        requiredApiKey: 'openrouter',
        apiModelId: 'openai/gpt-4o',
        roles: ['copywriting', 'general', 'vision'],
        capabilities: ['text-generation', 'vision', 'reasoning', 'marketing-copy'],
        supportsVision: true,
        supportsStreaming: true,
        maxTokens: 4096,
        pricing: { inputPerMillion: 2.5, outputPerMillion: 10 },
        recommended: true,
        description: 'OpenAI 全能模型，能看图，文案语感好'
    },
    {
        id: 'openrouter-deepseek-chat',
        name: '⭐ DeepSeek V3',
        source: 'cloud',
        provider: 'openrouter',
        requiredApiKey: 'openrouter',
        apiModelId: 'deepseek/deepseek-chat',
        roles: ['layout-analysis', 'general', 'code'],
        capabilities: ['text-generation', 'reasoning', 'code'],
        supportsVision: false,
        supportsStreaming: true,
        maxTokens: 8192,
        thinking: { supported: true, format: 'reasoning_content' },
        pricing: { inputPerMillion: 0.14, outputPerMillion: 0.28 },
        recommended: true,
        description: 'DeepSeek 上一代通用模型，推理稳定'
    },
    {
        id: 'openrouter-gemini-3-flash',
        name: 'Gemini 3 Flash',
        source: 'cloud',
        provider: 'openrouter',
        requiredApiKey: 'openrouter',
        apiModelId: 'google/gemini-3-flash-preview',
        roles: ['vision', 'general'],
        capabilities: ['text-generation', 'vision', 'reasoning'],
        supportsVision: true,
        supportsStreaming: true,
        maxTokens: 8192,
        pricing: { inputPerMillion: 0.10, outputPerMillion: 0.40 },
        description: 'Google 轻量款，能看图，速度快'
    },
    {
        id: 'openrouter-qwen-2.5-72b',
        name: 'Qwen 2.5 72B',
        source: 'cloud',
        provider: 'openrouter',
        requiredApiKey: 'openrouter',
        apiModelId: 'qwen/qwen-2.5-72b-instruct',
        roles: ['copywriting', 'general'],
        capabilities: ['text-generation', 'reasoning', 'chinese'],
        supportsVision: false,
        supportsStreaming: true,
        maxTokens: 32768,
        pricing: { inputPerMillion: 0.35, outputPerMillion: 0.40 },
        description: '阿里通义千问，中文写作稳定'
    },
    {
        id: 'openrouter-llama-3.1-70b',
        name: 'Llama 3.1 70B',
        source: 'cloud',
        provider: 'openrouter',
        requiredApiKey: 'openrouter',
        apiModelId: 'meta-llama/llama-3.1-70b-instruct',
        roles: ['general'],
        capabilities: ['text-generation', 'reasoning'],
        supportsVision: false,
        supportsStreaming: true,
        maxTokens: 8192,
        pricing: { inputPerMillion: 0.35, outputPerMillion: 0.40 },
        description: 'Meta 开源模型，通用对话'
    },
    {
        id: 'openrouter-mimo-v2.5-pro',
        name: 'MiMo V2.5 Pro',
        source: 'cloud',
        provider: 'openrouter',
        requiredApiKey: 'openrouter',
        apiModelId: 'xiaomi/mimo-v2.5-pro',
        roles: ['layout-analysis', 'copywriting', 'general', 'code'],
        capabilities: ['text-generation', 'reasoning', 'code', 'chinese', 'long-context'],
        supportsVision: false,
        supportsStreaming: true,
        maxTokens: 32768,
        thinking: { supported: true, format: 'reasoning_content' },
        pricing: { inputPerMillion: 1, outputPerMillion: 3 },
        recommended: true,
        description: '小米旗舰模型，中文推理见长'
    },
    {
        id: 'openrouter-mimo-v2.5',
        name: 'MiMo V2.5',
        source: 'cloud',
        provider: 'openrouter',
        requiredApiKey: 'openrouter',
        apiModelId: 'xiaomi/mimo-v2.5',
        roles: ['layout-analysis', 'copywriting', 'general', 'code', 'vision'],
        capabilities: ['text-generation', 'vision', 'image-understanding', 'reasoning', 'code', 'chinese', 'long-context', 'tool-calling'],
        supportsVision: true,
        supportsStreaming: true,
        maxTokens: 32768,
        thinking: { supported: true, format: 'reasoning_content' },
        pricing: { inputPerMillion: 0.40, outputPerMillion: 2 },
        recommended: true,
        description: '小米全模态模型，能看图'
    },
    // OpenRouter 的图像编辑/生成模型单独维护在 OPENROUTER_IMAGE_MODELS，
    // 这里只保留文本 / 多模态聊天模型。
];

// ========== 云端模型：Ollama Cloud ==========
// 模型列表来源：https://ollama.com/api/tags
// 文档：https://docs.ollama.com/cloud

export const OLLAMA_CLOUD_MODELS: ModelConfig[] = [
    {
        id: 'ollama-cloud-gpt-oss-120b',
        name: 'GPT-OSS 120B',
        source: 'cloud',
        provider: 'ollama-cloud',
        requiredApiKey: 'ollamaApiKey',
        apiModelId: 'gpt-oss:120b',
        roles: ['general', 'code'],
        capabilities: ['text-generation', 'reasoning'],
        supportsVision: false,
        supportsStreaming: true,
        maxTokens: 8192,
        description: '开源 GPT 模型，通用对话与代码'
    },
];

// ========== 云端模型：DeepSeek 官方 ==========
// 官方文档：https://api-docs.deepseek.com/zh-cn/
// OpenAI 兼容 Base URL：https://api.deepseek.com
// 官方能力：思考模式、JSON Output、Tool Calls、对话前缀续写、FIM 补全。
// 项目边界：普通 chat 与 chatWithTools 都按用户「模型思考」偏好请求思考；工具轮次需回传 reasoning_content。
// 视觉能力按模型逐条声明：v4-pro / v4-flash 真机验证会返回
// "This model does not support image"（400），只有 -vision-exp 接受图片输入。
// DeepSeek 的 /models 是 OpenAI 兼容最小格式（只回 id/object/owned_by），零能力字段，
// 合并层刻意不按模型名猜 vision，所以视觉模型必须在这里作为能力覆盖层登记，
// 否则会被主模型候选的 isAgentMultimodalModelConfig 过滤掉——拉得到 id，界面上却选不到。
export const DEEPSEEK_MODELS: ModelConfig[] = [
    {
        id: 'deepseek-v4-pro',
        name: '⭐ DeepSeek V4 Pro (官方)',
        source: 'cloud',
        provider: 'deepseek',
        requiredApiKey: 'deepseek',
        apiModelId: 'deepseek-v4-pro',
        roles: ['layout-analysis', 'copywriting', 'general', 'code'],
        capabilities: ['text-generation', 'reasoning', 'code', 'chinese', 'long-context', 'json-output', 'tool-calling', 'chat-prefix-completion', 'fim-completion'],
        supportsVision: false,
        supportsToolUse: true,
        supportsStreaming: true,
        maxTokens: 384000,
        contextWindow: 1000000,
        thinking: {
            supported: true,
            format: 'reasoning_content',
            requestParams: {
                thinking: { type: 'enabled' },
                reasoning_effort: 'high'
            }
        },
        recommended: true,
        description: 'DeepSeek 旗舰模型，中文推理强、上下文很长'
    },
    {
        // 能力字段全部来自真机探针（2026-08-23，api.deepseek.com）：
        // - 图像输入：左红右蓝测试图回答正确，非视觉型号同请求返回 400 does not support image
        // - 工具调用：图片 + tools 同一请求返回了 tool_calls
        // - 思考：返回 reasoning_content，接受 thinking/reasoning_effort 请求参数
        // - 流式：stream:true 正常分片并以 usage + [DONE] 收尾
        // - max_tokens：官方报错给出有效区间 [1, 393216]
        id: 'deepseek-v4-flash-vision-exp',
        name: 'DeepSeek V4 Flash Vision (实验版·官方)',
        source: 'cloud',
        provider: 'deepseek',
        requiredApiKey: 'deepseek',
        apiModelId: 'deepseek-v4-flash-vision-exp',
        roles: ['general', 'vision', 'layout-analysis', 'copywriting'],
        capabilities: ['text-generation', 'vision', 'reasoning', 'chinese', 'json-output', 'tool-calling'],
        supportsVision: true,
        supportsToolUse: true,
        supportsStreaming: true,
        maxTokens: 393216,
        // 刻意不声明 contextWindow：官方接口零能力字段、也没在报错里披露上下文上限，
        // 在这里钉一个数字就是"定死"。交给 PROVIDER_DEFAULT_CONTEXT_WINDOW.deepseek
        // （官方定价页 CONTEXT LENGTH = 1M，flash 与 pro 同档）统一供给，官方改了只需改一处。
        thinking: {
            supported: true,
            format: 'reasoning_content',
            requestParams: {
                thinking: { type: 'enabled' },
                reasoning_effort: 'high'
            }
        },
        // 实验型号（-exp），官方随时可能变更或下线，不挂推荐星标。
        description: 'DeepSeek 视觉实验模型，可读图并调用工具'
    }
];

// 图像生成模型不在这里登记：可用的重绘模型由 inpainting-service.ts 的
// SUPPORTED_MODELS 单独持有，那是调用方唯一读取的来源。这里再维护一份
// 只会变成对不上的第二份真相。

// ========== 合并所有模型 ==========

export const ALL_MODELS: ModelConfig[] = [
    ...LOCAL_MODELS,
    ...GOOGLE_MODELS,
    ...XIAOMI_MODELS,
    ...OPENROUTER_MODELS,
    ...OLLAMA_CLOUD_MODELS,
    ...DEEPSEEK_MODELS,
];

// ========== 辅助函数 ==========

/**
 * 根据 ID 获取模型配置。
 *
 * 先查硬编码 ALL_MODELS（能力覆盖层）；未命中再回退到进程内动态模型注册表
 * （从 provider 官方接口拉取并注入的完整 ModelConfig，含正确 apiModelId）。
 * 这样动态模型在 chat() / chatStream() / resolveProvider() 都能拿到带点的真实
 * apiModelId，无需从 slug 化的内部 id 反推（slug 不可逆）。
 */
export function getModelById(id: string): ModelConfig | undefined {
    const known = ALL_MODELS.find(m => m.id === id);
    if (known) return known;
    return getDynamicModelById(id);
}

/**
 * 只有对话模型才能承担 Agent 主模型或视觉理解模型。
 * 旧硬编码模型没有 usageKind，但都来自人工维护的 ALL_MODELS 对话清单，保持兼容。
 */
export function isConversationModelConfig(model: ModelConfig | null | undefined): boolean {
    if (!model) return false;
    if (model.usageKind) return model.usageKind === 'conversation';
    return model.capabilities.includes('text-generation')
        || model.roles.includes('general')
        || model.roles.includes('copywriting')
        || model.roles.includes('layout-analysis')
        || model.roles.includes('vision');
}

export function isConversationModelId(modelId: string): boolean {
    return isConversationModelConfig(getModelById(modelId));
}

/**
 * 获取所有本地模型
 */
export function getLocalModels(): ModelConfig[] {
    return ALL_MODELS.filter(m => m.source === 'local');
}

/**
 * 获取所有云端模型
 */
export function getCloudModels(): ModelConfig[] {
    return ALL_MODELS.filter(m => m.source === 'cloud');
}

/**
 * 根据 provider 获取模型列表
 */
export function getModelsByProvider(provider: ModelProvider): ModelConfig[] {
    return ALL_MODELS.filter(m => m.provider === provider);
}

/**
 * 获取支持视觉的模型
 */
export function getVisionModels(): ModelConfig[] {
    return ALL_MODELS.filter(m => isAgentMultimodalModelConfig(m));
}

/**
 * Agent 运行模型的统一能力边界。
 *
 * DesignEcho 的 Agent 需要在同一轮里理解文字、接收真实画面并调用工具，因此只有
 * provider/受管目录明确声明 supportsVision=true、且没有明确声明不支持工具调用的
 * 对话模型可以进入 Agent 候选。工具能力 unknown 仍允许真实尝试，但视觉能力 unknown
 * 必须 fail closed；图片生成模型即使能接收图片也不是 Agent 对话模型。
 */
export function isAgentMultimodalModelConfig(
    model: ModelConfig | null | undefined
): boolean {
    return Boolean(
        model
        && isConversationModelConfig(model)
        && model.supportsVision === true
        && model.supportsToolUse !== false
    );
}

export function isAgentMultimodalModelId(modelId: string): boolean {
    return isAgentMultimodalModelConfig(getModelById(String(modelId || '').trim()));
}

/**
 * 获取适合特定任务的模型
 */
export function getModelsForTask(taskCategory: TaskCategory): ModelConfig[] {
    const roleMap: Record<TaskCategory, ModelRole> = {
        layoutAnalysis: 'layout-analysis',
        textOptimize: 'copywriting',
        visualAnalyze: 'vision'
    };
    const targetRole = roleMap[taskCategory];
    return ALL_MODELS.filter(m => m.roles.includes(targetRole));
}

/**
 * 获取推荐模型
 */
export function getRecommendedModels(): ModelConfig[] {
    return ALL_MODELS.filter(m => m.recommended);
}

/**
 * 判断模型是否为本地模型
 */
export function isLocalModel(modelId: string): boolean {
    const model = getModelById(modelId);
    return model?.source === 'local';
}

/**
 * 判断模型是否为云端模型
 */
export function isCloudModel(modelId: string): boolean {
    const model = getModelById(modelId);
    return model?.source === 'cloud';
}

/**
 * 获取模型所需的 API Key 类型
 */
export function getRequiredApiKey(modelId: string): ApiKeyType | undefined {
    const model = getModelById(modelId);
    return model?.requiredApiKey;
}

/**
 * 检查是否有对应的 API Key
 */
export function hasRequiredApiKey(modelId: string, apiKeys: Record<string, string>): boolean {
    const requiredKey = getRequiredApiKey(modelId);
    if (!requiredKey) return false;
    
    const keyValue = apiKeys[requiredKey];
    return !!keyValue && keyValue.length > 5;
}

/**
 * 根据任务和用户偏好获取最佳模型
 */
export function getBestModelForTask(
    taskCategory: TaskCategory,
    preferLocal: boolean = true,
    preferredModelId?: string
): ModelConfig | undefined {
    if (preferredModelId) {
        const preferred = getModelById(preferredModelId);
        if (preferred) return preferred;
    }

    const candidates = getModelsForTask(taskCategory);
    
    const sorted = candidates.sort((a, b) => {
        if (a.recommended && !b.recommended) return -1;
        if (!a.recommended && b.recommended) return 1;
        
        if (preferLocal) {
            if (a.source === 'local' && b.source !== 'local') return -1;
            if (a.source !== 'local' && b.source === 'local') return 1;
        } else {
            if (a.source === 'cloud' && b.source !== 'cloud') return -1;
            if (a.source !== 'cloud' && b.source === 'cloud') return 1;
        }
        
        return 0;
    });

    return sorted[0];
}

/**
 * 检查 Ollama 模型名是否匹配
 */
export function matchOllamaModel(configModelId: string, installedModelName: string): boolean {
    // 从配置 ID 中提取 Ollama 模型名
    const model = getModelById(configModelId);
    if (!model || model.provider !== 'ollama') return false;
    
    const configName = model.apiModelId;
    
    if (configName === installedModelName) return true;
    
    const configBase = configName.split(':')[0];
    const installedBase = installedModelName.split(':')[0];
    
    if (configBase === installedBase) {
        const configTag = configName.split(':')[1] || 'latest';
        const installedTag = installedModelName.split(':')[1] || 'latest';
        
        if (configTag === 'latest' || installedTag === 'latest') {
            return true;
        }
    }
    
    if (installedModelName.startsWith(configName)) {
        return true;
    }
    
    return false;
}

// ========== 默认偏好配置 ==========

/*
 * 已移除：OrchestratorModelConfig / WorkerModelConfig / DEFAULT_ORCHESTRATOR_CONFIG。
 *
 * 那是一套「主规划模型 + vision/design/executor 三个 worker」的编排设想，从未接线到执行路径：
 * 唯一的运行时消费者是 model-selection 的恢复候选，而那条链的终点
 * （useChatActions.getModelRecoveryPriorityForTask）在 ChatPanel 里没有任何调用者。
 * 它唯一真实的作用是给知识来源页提供了一个错误的模型（默认 openrouter-claude-3.5-sonnet），
 * 导致「当前模型支不支持原生联网搜索」的判定用的不是实际执行的主模型。
 *
 * Agent 现在只有一个运行模型：primaryModel。visualModel 仅作为旧配置兼容镜像保留，
 * normalizeModelPreferences 会始终把它同步为 primaryModel，运行时不得把它当成第二选择源。
 */

export interface ModelPreferences {
    /**
     * 运行渠道：本地 Ollama 或云端 API。
     * 只有这两个值——旧配置里的 'auto' 已取消，由 normalizeModelPreferences 按主模型所属渠道折算。
     * 用户不需要手动维护它：在任何地方选中一个模型，模式都会自动跟到该模型的渠道。
     */
    mode: 'local' | 'cloud';
    /**
     * Agent 模型：负责理解目标、规划、文案、真实看图、工具调用和最终裁决。
     * 只有已验证 supportsVision=true 的对话模型能进入运行时。
     */
    primaryModel: string;
    /**
     * @deprecated 旧双模型配置的兼容镜像。归一化后永远等于 primaryModel；
     * 新代码只能读取 primaryModel，不能重新建立独立视觉模型路由。
     */
    visualModel: string;
    autoFallback: boolean;
    preferredLocalModels: {
        layoutAnalysis: string;
        textOptimize: string;
        visualAnalyze: string;
    };
    preferredCloudModels: {
        layoutAnalysis: string;
        textOptimize: string;
        visualAnalyze: string;
    };
    /** 模型原生 Thinking 开关；仅对声明支持 thinking 的模型生效 */
    thinking: ModelThinkingPreference;
}

export interface ModelThinkingPreference {
    /** 是否向支持的模型请求原生 Thinking / reasoning 输出 */
    enabled: boolean;
}

export type ModelPreferencesPatch =
    Partial<Omit<ModelPreferences, 'preferredLocalModels' | 'preferredCloudModels' | 'thinking'>> & {
        preferredLocalModels?: Partial<ModelPreferences['preferredLocalModels']>;
        preferredCloudModels?: Partial<ModelPreferences['preferredCloudModels']>;
        thinking?: Partial<ModelThinkingPreference>;
    };

/**
 * 把兼容 patch 合并到单一 Agent 模型配置。
 *
 * 旧 renderer/IPC 可能只发送 visualModel；新调用方只发送 primaryModel。两者都表示
 * “用户刚选择的 Agent 模型”，因此 patch 中显式出现的字段必须优先于 base，随后同步
 * 到两个持久化键。这样不会出现 base.primaryModel 在对象展开时抢占 legacy visual patch。
 */
export function applyModelPreferencesPatch(
    base: ModelPreferences,
    patch: ModelPreferencesPatch
): ModelPreferences {
    const patchedPrimary = String(patch.primaryModel || '').trim();
    const patchedLegacyVisual = String(patch.visualModel || '').trim();
    const patchedAgentModel = patchedPrimary || patchedLegacyVisual;
    return normalizeModelPreferences({
        ...base,
        ...patch,
        ...(patchedAgentModel
            ? { primaryModel: patchedAgentModel, visualModel: patchedAgentModel }
            : {}),
        thinking: {
            ...base.thinking,
            ...patch.thinking
        }
    });
}

export function normalizeModelThinkingPreference(
    preference?: Partial<ModelThinkingPreference> | null
): ModelThinkingPreference {
    return {
        enabled: preference?.enabled !== false
    };
}

export function isModelThinkingSupported(modelId?: string | null): boolean {
    const model = modelId ? getModelById(modelId) : undefined;
    return model?.thinking?.supported === true && model.thinking.format !== 'none';
}

export function isModelThinkingUserControllable(modelId?: string | null): boolean {
    return isModelThinkingSupported(modelId);
}

export function getModelThinkingDisplayName(modelId?: string | null): string {
    const model = modelId ? getModelById(modelId) : undefined;
    const format = model?.thinking?.format;
    if (format === 'reasoning_content') return '原生推理内容';
    if (format === 'think_tag') return 'Thinking 标签';
    if (format === 'extended_thinking') return '扩展 Thinking';
    if (format === 'xml_tag') return 'XML Thinking';
    return '不支持 Thinking';
}

/**
 * 解析某次调用是否应开启原生思考：模型必须声明支持 thinking，再叠加用户「模型思考」开关。
 * 对话通道与 Agent 工具循环通道共用，避免两套逻辑漂移。
 */
export function resolveModelThinkingEnabledForCall(
    modelId: string,
    preferences?: Partial<ModelPreferences> | null
): boolean {
    if (!isModelThinkingUserControllable(modelId)) return false;
    return normalizeModelThinkingPreference(preferences?.thinking).enabled;
}

/**
 * 主 Agent 模型解析（向后兼容迁移）。
 *
 * 迁移优先使用已经证实支持视觉的显式选择；动态订阅模型在冷启动目录恢复前保持
 * 原始 ID，由运行时 fail closed，而不是暗换成另一个模型。若用户显式选择的是已知
 * 文本模型，也保留其身份并在 UI/运行时明确阻断。只有完全没有显式选择时才使用
 * 历史视觉分析槽或出厂默认。
 */
export function resolvePrimaryModelForPreferences(input: {
    primaryModel?: unknown;
    /** 旧双模型配置的迁移来源；新配置不再单独读取它。 */
    visualModel?: unknown;
    mode?: ModelPreferences['mode'] | null;
    preferredLocalModels: ModelPreferences['preferredLocalModels'];
    preferredCloudModels: ModelPreferences['preferredCloudModels'];
}): string {
    const explicit = String(input.primaryModel || '').trim();
    const explicitConfig = explicit ? getModelById(explicit) : undefined;
    const legacyVisual = String(input.visualModel || '').trim();
    const legacyVisualConfig = legacyVisual ? getModelById(legacyVisual) : undefined;

    // primaryModel 是新配置的唯一身份。它在冷启动时可能只是尚未恢复目录的订阅模型，
    // unknown 不能被旧 visualModel 或默认模型覆盖；只有 primary 已被明确证明不合格时，
    // 才迁移到旧视觉槽。这样既不把已知文本模型带进运行时，也不暗换用户的新选择。
    if (explicitConfig && isAgentMultimodalModelConfig(explicitConfig)) return explicit;
    if (explicit && !explicitConfig) return explicit;
    if (legacyVisualConfig && isAgentMultimodalModelConfig(legacyVisualConfig)) return legacyVisual;
    if (legacyVisual && !legacyVisualConfig) return legacyVisual;
    // 显式但不合格也必须保留，避免迁移过程替用户暗中改成另一个模型。
    if (explicit) return explicit;
    if (legacyVisual) return legacyVisual;

    const mode = input.mode || DEFAULT_MODEL_PREFERENCES.mode;
    const cloudVisual = String(input.preferredCloudModels.visualAnalyze || '').trim();
    const localVisual = String(input.preferredLocalModels.visualAnalyze || '').trim();
    const candidates = mode === 'local'
        ? [legacyVisual, localVisual, DEFAULT_MODEL_PREFERENCES.primaryModel]
        : [legacyVisual, cloudVisual, DEFAULT_MODEL_PREFERENCES.primaryModel];
    return candidates.find(isAgentMultimodalModelId) || DEFAULT_MODEL_PREFERENCES.primaryModel;
}

/**
 * 旧 visualModel 的兼容镜像解析。新运行时不再建立视觉专家路由。
 */
export function resolveVisualModelForPreferences(input: {
    visualModel?: unknown;
    primaryModel?: unknown;
    mode?: ModelPreferences['mode'] | null;
    preferredLocalModels: ModelPreferences['preferredLocalModels'];
    preferredCloudModels: ModelPreferences['preferredCloudModels'];
}): string {
    const primaryModel = String(input.primaryModel || '').trim();
    return primaryModel || DEFAULT_MODEL_PREFERENCES.primaryModel;
}

/**
 * 渠道级默认上下文窗口。
 *
 * 只填有官方依据的渠道——没依据就别填。上下文窗口写错的代价是单向的：
 * 填大了会让面板显示"还很空"，实际请求已经超限被 provider 拒绝；
 * 填空了最多是显示"未知"，不会误导用户继续堆内容。
 *
 * deepseek: 官方定价页（api-docs.deepseek.com/quick_start/pricing）明确
 *           CONTEXT LENGTH = 1M，flash 与 pro 同档。
 */
export const PROVIDER_DEFAULT_CONTEXT_WINDOW: Partial<Record<ModelProvider, number>> = {
    deepseek: 1_000_000
};

export type ModelContextWindowBasis = 'model_declared' | 'provider_default';

export interface ModelContextWindowResolution {
    tokens: number;
    basis: ModelContextWindowBasis;
}

/**
 * 解析某个模型的上下文窗口。
 *
 * 优先级：模型自己声明 > 该渠道的已知默认值 > 解析不出（返回 null）。
 * 返回 null 表示"不知道"，调用方必须如实展示，不要折成某个具体数字——
 * 内置配置只为有明确依据的模型声明 contextWindow；动态目录则优先采用 provider 返回值。
 * 未返回窗口的渠道保持 unknown，不按模型名猜测。
 */
export function resolveModelContextWindow(modelId: string): ModelContextWindowResolution | null {
    const model = getModelById(String(modelId || '').trim());
    if (!model) return null;

    const declared = Number(model.contextWindow) || 0;
    if (declared > 0) return { tokens: declared, basis: 'model_declared' };

    const providerDefault = PROVIDER_DEFAULT_CONTEXT_WINDOW[model.provider];
    if (providerDefault && providerDefault > 0) {
        return { tokens: providerDefault, basis: 'provider_default' };
    }
    return null;
}

/**
 * 把任意来源的运行模式折算成 'local' | 'cloud'。
 *
 * 历史配置里存过 'auto'（已取消的第三种模式），磁盘上的旧偏好、旧版本写入的 IPC 载荷
 * 都可能带着它。折算依据是「用户当前主模型属于哪个渠道」——这是最贴近用户真实意图的信号，
 * 比一律落回默认值更不容易改掉用户已有的选择。识别不出就用默认渠道。
 */
export function normalizeModelRunMode(
    rawMode: unknown,
    primaryModelId?: unknown
): ModelPreferences['mode'] {
    if (rawMode === 'local' || rawMode === 'cloud') return rawMode;
    const source = getModelById(String(primaryModelId || '').trim())?.source;
    if (source === 'local' || source === 'cloud') return source;
    return DEFAULT_MODEL_PREFERENCES.mode;
}

export function normalizeModelPreferences(
    preferences?: ModelPreferencesPatch | ModelPreferences | null
): ModelPreferences {
    const defaults = DEFAULT_MODEL_PREFERENCES;
    const mode = normalizeModelRunMode(
        preferences?.mode,
        (preferences as Partial<ModelPreferences> | null | undefined)?.primaryModel
    );
    const preferredLocalModels = {
        ...defaults.preferredLocalModels,
        ...(preferences?.preferredLocalModels || {})
    };
    const preferredCloudModels = {
        ...defaults.preferredCloudModels,
        ...(preferences?.preferredCloudModels || {})
    };
    const primaryModel = resolvePrimaryModelForPreferences({
        primaryModel: (preferences as Partial<ModelPreferences> | null | undefined)?.primaryModel,
        visualModel: (preferences as Partial<ModelPreferences> | null | undefined)?.visualModel,
        mode,
        preferredLocalModels,
        preferredCloudModels
    });
    // 只构造公开契约字段，不传播磁盘旧键、IPC 附带的动态目录或未来未知字段。
    // 单模型运行时也不再接受历史 autoFallback=true：字段仅用于读取旧配置，
    // 归一化后必须反映真实行为——失败时停在当前 Agent 模型，不暗换第二个模型。
    return {
        mode,
        primaryModel,
        visualModel: resolveVisualModelForPreferences({
            primaryModel,
            mode,
            preferredLocalModels,
            preferredCloudModels
        }),
        autoFallback: false,
        preferredLocalModels,
        preferredCloudModels,
        thinking: normalizeModelThinkingPreference(preferences?.thinking)
    };
}

export const DEFAULT_MODEL_PREFERENCES: ModelPreferences = {
    mode: 'cloud',
    // Agent 始终使用一个已验证全模态模型；visualModel 只保留为旧配置镜像。
    primaryModel: 'xiaomi-mimo-v2.5',
    visualModel: 'xiaomi-mimo-v2.5',
    autoFallback: false,
    preferredLocalModels: {
        layoutAnalysis: 'local-deepseek-coder-v2-16b',
        textOptimize: 'local-qwen2.5-14b',
        visualAnalyze: 'local-llava-7b'
    },
    preferredCloudModels: {
        // 原值 ollama-cloud-qwen3-next-80b 随该模型下架一并失效；改指仍在线的 mimo，
        // 与同组另外两项同渠道，避免默认配置一出厂就指向不存在的模型。
        layoutAnalysis: 'xiaomi-mimo-v2.5-pro',
        textOptimize: 'xiaomi-mimo-v2.5',
        visualAnalyze: 'xiaomi-mimo-v2.5'
    },
    thinking: {
        enabled: true
    }
};
