/**
 * 模型能力的三态判定（supported / unsupported / **unknown**）。
 *
 * 为什么需要它：能力字段是 `boolean | undefined`，而它要表达三件事——
 * 「声明支持」「声明不支持」「provider 压根没说」。用 `=== true` 或 `=== false` 收敛时，
 * 第三种会被静默折进某一边，且总是折向否定；下游据此阻断，用户就得到一个
 * 「选得到却用不了」的模型，还配着一句指错方向的错误提示。
 *
 * 2026-08-01 真机连撞四次同型问题（模型能力、Photoshop 连接、文档写保护、回复文本误判），
 * 根因都是这个。本模块把判定与「什么才配阻断」的规则收成单一出口。
 *
 * 形状沿用仓库既有样板 agent-provider-observation-capabilities.ts：
 * 除了结论本身，还必须带上**判断依据**（basis）与**人话理由**（reason）——
 * 今天几轮排查卡住，正是因为错误信息说不出「我凭什么这么判」。
 */

/** 能力结论。unknown 表示「没有依据下结论」，与「有依据认为不支持」严格区分。 */
export type ModelCapabilityStatus = 'supported' | 'unsupported' | 'unknown';

/**
 * 结论的依据来源，优先级由高到低：
 * - `declared`：模型配置/provider 接口明确声明，最可信
 * - `runtime`：我们的运行时实现决定（例如某 provider 的工具流已实现）
 * - `provider_default`：provider 级已知能力兜底（该厂商对话模型全系具备该能力）
 * - `none`：没有任何依据，结论只能是 unknown
 */
export type ModelCapabilityBasis = 'declared' | 'runtime' | 'provider_default' | 'none';

export interface ModelCapabilityVerdict {
    status: ModelCapabilityStatus;
    basis: ModelCapabilityBasis;
    /** 人话理由，可直接进用户可见的错误说明，不含内部标识符。 */
    reason: string;
}

/**
 * 对话模型全系支持 OpenAI 风格 function calling 的单一厂商。
 *
 * 这些 provider 的 /v1/models 多为 OpenAI 兼容格式，只返回 id/object/created/owned_by，
 * **不返回能力字段**——但厂商本身全系支持工具调用。
 *
 * 刻意不含聚合网关（openrouter）：它底下挂着各家几百个模型，其中确有不支持的，
 * 按 provider 一刀切就是虚报能力（smoke-provider-model-merge「不伪造 Tool 能力」为此设的护栏）。
 */
const PROVIDER_ALWAYS_SUPPORTS_TOOL_USE = new Set([
    'deepseek',
    'openai',
    'openai-codex',
    'anthropic',
    'xiaomi'
]);

/** 对话模型全系具备视觉能力的 provider。目前没有可以一刀切的厂商——视觉是按模型区分的。 */
const PROVIDER_ALWAYS_SUPPORTS_VISION = new Set<string>();

export interface ModelCapabilityInput {
    /** 模型配置里的能力字段；undefined 表示未声明，不等于不支持。 */
    declared?: boolean;
    provider?: string;
    /** 模型展示名，仅用于拼 reason。 */
    modelLabel?: string;
    /** 非模型运行时信号可提供中性主体名，复用同一三态阻断规则。 */
    subjectLabel?: string;
}

function buildVerdict(
    status: ModelCapabilityStatus,
    basis: ModelCapabilityBasis,
    reason: string
): ModelCapabilityVerdict {
    return { status, basis, reason };
}

function resolveCapability(
    input: ModelCapabilityInput,
    providerDefaults: Set<string>,
    capabilityLabel: string
): ModelCapabilityVerdict {
    const label = String(input.modelLabel || '').trim();
    const subjectLabel = String(input.subjectLabel || '').trim();
    const named = subjectLabel || (label ? `模型「${label}」` : '该模型');
    if (input.declared === true) {
        return buildVerdict('supported', 'declared', `${named}已声明支持${capabilityLabel}。`);
    }
    if (input.declared === false) {
        return buildVerdict('unsupported', 'declared', `${named}已声明不支持${capabilityLabel}。`);
    }
    const provider = String(input.provider || '').trim();
    if (provider && providerDefaults.has(provider)) {
        return buildVerdict(
            'supported',
            'provider_default',
            `${named}未声明${capabilityLabel}能力，但该服务商的对话模型全系具备，按支持处理。`
        );
    }
    return buildVerdict(
        'unknown',
        'none',
        `${named}没有提供${capabilityLabel}能力信息，实际是否可用要到调用时才知道。`
    );
}

/** 工具调用（function calling）能力判定。 */
export function resolveToolUseVerdict(input: ModelCapabilityInput): ModelCapabilityVerdict {
    return resolveCapability(input, PROVIDER_ALWAYS_SUPPORTS_TOOL_USE, '工具调用');
}

/** 视觉（读图）能力判定。 */
export function resolveVisionVerdict(input: ModelCapabilityInput): ModelCapabilityVerdict {
    return resolveCapability(input, PROVIDER_ALWAYS_SUPPORTS_VISION, '读图');
}

/**
 * 对 Photoshop 连接、文档存在等声明型运行时能力做同样的三态解释。
 * 没有 provider 默认值：只有显式 false 是 unsupported，undefined 永远保持 unknown。
 */
export function resolveDeclaredCapabilityVerdict(
    input: Pick<ModelCapabilityInput, 'declared' | 'subjectLabel'>,
    capabilityLabel: string
): ModelCapabilityVerdict {
    return resolveCapability(input, new Set<string>(), capabilityLabel);
}

/**
 * **核心铁律**：只有「有依据的否定」才允许阻断执行。
 *
 * unknown 一律放行——预检并不比真实执行知道得更多，它只是提前下结论；
 * 猜错的代价严重不对称：判否是彻底阻断且无从诊断，放行失败只是一次带 provider
 * 准确报文的错误。把这条写成函数而不是散在各调用点，是为了不再长出第五个现场。
 *
 * 唯一该保守的是不可逆动作（删除、覆盖源文件），那类判断不走本模块。
 */
export function capabilityBlocksExecution(verdict: ModelCapabilityVerdict): boolean {
    return verdict.status === 'unsupported';
}

/**
 * 能力不足时给用户的说明。带上 basis 对应的依据，避免出现
 * 「当前模型没有通过认证」这种把人引向错误排查方向的提示。
 */
export function describeCapabilityBlock(verdict: ModelCapabilityVerdict, action: string): string {
    return `${verdict.reason}${action ? `本次${action}需要这项能力，请在模型设置里换一个具备该能力的模型。` : ''}`;
}
