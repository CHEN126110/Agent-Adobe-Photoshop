export type AgentPreferenceFeedbackCategory =
    | 'font'
    | 'color'
    | 'style'
    | 'workflow'
    | 'interaction'
    | 'copywriting'
    | 'layout';

export interface AgentPreferenceFeedbackMessageInput {
    userText: string;
    assistantReply?: string;
}

export interface AgentPreferenceFeedbackItem {
    category: AgentPreferenceFeedbackCategory;
    value: string;
    label: string;
    evidenceSummary: string;
}

export interface AgentPreferenceFeedbackDecision {
    version: 'agent-preference-feedback/v0';
    shouldSave: boolean;
    preferences: AgentPreferenceFeedbackItem[];
    warnings: string[];
    limitations: string[];
}

const ALLOWED_CATEGORIES: readonly AgentPreferenceFeedbackCategory[] = [
    'font',
    'color',
    'style',
    'workflow',
    'interaction',
    'copywriting',
    'layout'
];

const FORBIDDEN_PAYLOAD_PATTERNS = [
    /raw-image-payload/gi,
    /base64-image-payload/gi,
    /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi,
    /data:image\//gi
];

const EXPLICIT_PREFERENCE_SIGNALS = [
    /帮我记住/,
    /请记住/,
    /记住这个/,
    /以后.+(我喜欢|我偏好|优先|默认|尽量|不要)/,
    /(我喜欢|我偏好|我更喜欢|我不喜欢).+(字体|颜色|风格|文案|排版|主图|详情页|SKU|回复)/,
    /(默认|优先).+(字体|颜色|风格|文案|排版|导出|回复)/
];

function cleanString(value: unknown): string {
    let text = String(value || '').trim();
    for (const pattern of FORBIDDEN_PAYLOAD_PATTERNS) {
        text = text.replace(pattern, '[redacted-image-payload]');
    }
    return text.replace(/\s+/g, ' ').trim();
}

function parseJsonObject(text: string): Record<string, unknown> | null {
    const trimmed = cleanString(text);
    if (!trimmed) return null;
    const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : trimmed;
    try {
        const parsed = JSON.parse(candidate);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : null;
    } catch {
        const start = candidate.indexOf('{');
        const end = candidate.lastIndexOf('}');
        if (start < 0 || end <= start) return null;
        try {
            const parsed = JSON.parse(candidate.slice(start, end + 1));
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? parsed as Record<string, unknown>
                : null;
        } catch {
            return null;
        }
    }
}

function isAllowedCategory(value: unknown): value is AgentPreferenceFeedbackCategory {
    return ALLOWED_CATEGORIES.includes(cleanString(value) as AgentPreferenceFeedbackCategory);
}

function normalizePreferenceItem(value: unknown): AgentPreferenceFeedbackItem | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const category = cleanString(record.category);
    const preferenceValue = cleanString(record.value);
    if (!isAllowedCategory(category) || !preferenceValue) return null;
    return {
        category,
        value: preferenceValue,
        label: cleanString(record.label) || preferenceValue,
        evidenceSummary: cleanString(record.evidenceSummary) || '用户在当前对话中明确要求记住该偏好。'
    };
}

export function shouldAttemptPreferenceFeedbackCapture(userText: string): boolean {
    const text = cleanString(userText);
    if (!text) return false;
    return EXPLICIT_PREFERENCE_SIGNALS.some((pattern) => pattern.test(text));
}

export function buildAgentPreferenceFeedbackMessages(input: AgentPreferenceFeedbackMessageInput) {
    return [
        {
            role: 'system' as const,
            content: [
                '你是 DesignEcho 的用户偏好抽取器。',
                '只返回严格 JSON，不要 Markdown，不要解释。',
                '不要输出置信度，不要输出 confidence 字段。',
                '只有用户明确要求记住、以后默认、优先采用、喜欢或不喜欢某类设计/回复方式时，才允许保存。',
                '不能从工具参数或猜测中推断长期偏好；不能把一次执行结果、项目事实或平台规范写成用户偏好。',
                '只能输出这些类别：font, color, style, workflow, interaction, copywriting, layout。',
                'JSON 结构：',
                '{ "shouldSave": boolean, "preferences": [{ "category": string, "value": string, "label": string, "evidenceSummary": string }], "warnings": string[] }'
            ].join('\n')
        },
        {
            role: 'user' as const,
            content: [
                `用户输入：${cleanString(input.userText)}`,
                `助手回复：${cleanString(input.assistantReply) || '无'}`
            ].join('\n')
        }
    ];
}

export function normalizeAgentPreferenceFeedbackDecision(rawText: string): AgentPreferenceFeedbackDecision {
    const parsed = parseJsonObject(rawText);
    const preferences = Array.isArray(parsed?.preferences)
        ? parsed.preferences
            .map(normalizePreferenceItem)
            .filter((item): item is AgentPreferenceFeedbackItem => Boolean(item))
            .slice(0, 6)
        : [];
    const shouldSave = parsed?.shouldSave === true && preferences.length > 0;
    const warnings = Array.isArray(parsed?.warnings)
        ? Array.from(new Set(parsed.warnings.map(cleanString).filter(Boolean))).slice(0, 6)
        : [];

    return {
        version: 'agent-preference-feedback/v0',
        shouldSave,
        preferences,
        warnings,
        limitations: [
            '只保存用户明确表达的长期偏好。',
            '不保存模型猜测、工具参数、项目事实、平台规范或未复核推断。',
            '偏好只进入后续上下文和策略候选，不能直接变成 Photoshop 执行参数。'
        ]
    };
}
