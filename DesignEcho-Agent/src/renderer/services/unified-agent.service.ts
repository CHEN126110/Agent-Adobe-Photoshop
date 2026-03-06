import { AVAILABLE_TOOLS, executeToolCall } from './tool-executor.service';
import { SKILL_REGISTRY, getSkillById } from '../../shared/skills/skill-declarations';
import { getSkillExecutor, executeSkillWithExecutor } from './skill-executors';
import { useAppStore } from '../stores/app.store';

export interface AgentContext {
    userInput: string;
    conversationHistory: Array<{ role: string; content: string }>;
    isPluginConnected: boolean;
    photoshopContext?: PhotoshopContext;
    projectContext?: ProjectContext;
    hasAttachedImage?: boolean;
    attachedImageData?: string;
    visualEmbedding?: number[];
    layoutEmbedding?: number[];
}

export interface PhotoshopContext {
    hasDocument: boolean;
    documentName?: string;
    canvasSize?: { width: number; height: number };
    activeLayerName?: string;
    layerCount?: number;
}

export interface ProjectContext {
    projectPath?: string;
    hasSkuFiles?: boolean;
    hasTemplates?: boolean;
    availableColors?: string[];
}

export interface AgentDecision {
    type: 'tool_call' | 'skill_execution' | 'direct_response' | 'clarification_needed';
    toolCalls?: Array<{ toolName: string; params: any; reason?: string }>;
    skillId?: string;
    skillParams?: Record<string, any>;
    directResponse?: string;
    clarificationQuestion?: string;
    reasoning?: string;
    followUpAction?: {
        type: 'skill_execution' | 'tool_call';
        skillId?: string;
        skillParams?: Record<string, any>;
        toolCalls?: Array<{ toolName: string; params: any; reason?: string }>;
    };
}

export interface AgentResult {
    success: boolean;
    message: string;
    toolResults?: any[];
    error?: string;
    cancelled?: boolean;
    data?: any;
}

export interface ExecutionCallbacks {
    onProgress?: (message: string, percent: number) => void;
    onToolStart?: (toolName: string) => void;
    onToolComplete?: (toolName: string, result: any) => void;
    onMessage?: (message: string) => void;
    onThinking?: (thinking: string) => void;
}

interface ProcessOptions {
    callModel?: (messages: Array<{ role: string; content: any }>, options?: any) => Promise<{ text?: string }>;
    callbacks?: ExecutionCallbacks;
    signal?: AbortSignal;
}

type ExecutionStep =
    | { type: 'tool_call'; toolCalls: Array<{ toolName: string; params: any; reason?: string }> }
    | { type: 'skill_execution'; skillId?: string; skillParams?: Record<string, any> }
    | { type: 'direct_response'; directResponse?: string }
    | { type: 'clarification_needed'; clarificationQuestion?: string };

type DecisionSource = 'model' | 'model_repair' | 'model_reask' | 'rules';

interface DecisionResolutionMeta {
    source: DecisionSource;
    modelAttemptCount: number;
    repairAttempted: boolean;
    reaskAttempted: boolean;
    usedRuleFallback: boolean;
    parseFailures: number;
    modelErrors: string[];
    rawDecisionPreview?: string;
}

const SKILL_ID_ALIASES: Record<string, string> = {
    'main-image': 'main-image-design',
    'detail-page': 'detail-page-design',
    'sku-setup': 'sku-config',
    'agent-panel': 'agent-panel-bridge'
};

function normalizeSkillId(skillId?: string): string | undefined {
    if (!skillId) return undefined;
    const trimmed = String(skillId).trim();
    return SKILL_ID_ALIASES[trimmed] || trimmed;
}

function parseJsonBlock(text: string): any | null {
    const trimmed = String(text || '').trim();
    if (!trimmed) return null;

    const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : trimmed;

    try {
        return JSON.parse(candidate);
    } catch {
        // Try extracting first JSON object.
        const start = candidate.indexOf('{');
        const end = candidate.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(candidate.slice(start, end + 1));
            } catch {
                return null;
            }
        }
        return null;
    }
}

function containsAny(input: string, patterns: RegExp[]): boolean {
    return patterns.some((pattern) => pattern.test(input));
}

function scorePatternHits(input: string, patterns: RegExp[]): number {
    let score = 0;
    for (const pattern of patterns) {
        if (pattern.test(input)) score++;
    }
    return score;
}

function isActionableRequest(input: string): boolean {
    const normalized = String(input || '').toLowerCase();
    return /(帮我|请|优化|修改|调整|生成|设计|做|执行|开始|继续|替换|改|完善|处理|重写|润色|分析)/.test(normalized)
        || /(抠图|主图|详情|文案|图层|选图|排版|sku|双装|自选备注)/.test(normalized);
}

type LightweightIntent = 'greeting' | 'thanks' | 'ack' | 'identity' | 'capability' | 'chat' | 'none';

const CONVERSATIONAL_MODEL_INTENTS = new Set<LightweightIntent>([
    'greeting',
    'thanks',
    'ack',
    'identity',
    'capability',
    'chat'
]);
const DETAIL_PATTERNS: RegExp[] = [
    /详情页|detail page/,
    /详情(?!清单|说明)/,
    /长图|首屏|kv|卖点|痛点|参数|面料|材质/
];
const DETAIL_REFERENCE_PATTERNS: RegExp[] = [/参考|参考图|样例|模板|骨架|举一反三|复刻|拆解/];
const DETAIL_COPY_PATTERNS: RegExp[] = [
    /文案|标题|副标题|slogan|话术|copy/,
    /图文结合|图文一致|连贯|可读性|阅读/,
    /润色|改写|重写|优化|精修/,
    /换行|排版|超长|溢出|断行/
];
const DETAIL_IMAGE_MUTATION_PATTERNS: RegExp[] = [/换图|替换图|置入|选图|素材|填图|改图|重做图片|补图/];
const MAIN_IMAGE_PATTERNS: RegExp[] = [/主图|main image|click图|转化图|白底图|点击图/];
const ELEMENT_EDIT_PATTERNS: RegExp[] = [/定位|选中|改文案|替换图片|opacity|blend|layer|图层|元素|局部修改/];
const AGENT_PANEL_PATTERNS: RegExp[] = [/agent面板|面板沟通|桥接|调试桥|联调|mcp调试|对齐调试|反馈回传/];
const DEBUG_INTENT_PATTERNS: RegExp[] = [/调试|排查|诊断|定位问题|复现|联调|debug|测试|验证/];
const AGENT_RUNTIME_PATTERNS: RegExp[] = [/智能体|桌面端|应用程序|agent|mcp|工具链|ws|websocket|连接/];
const DECISION_DEBUG_PATTERNS: RegExp[] = [/决策|分流|路由|判定|策略/];
const SKU_PATTERNS: RegExp[] = [
    /sku|批量配色|批量出图|sku批量|批量生成sku/,
    /双装|自选备注|配色组合|组合图|批量排版|批量导出/
];
const ACTION_PATTERNS: RegExp[] = [/帮我|请|执行|开始|继续|优化|修改|调整|生成|设计|完善|处理/];

function isSkuIntent(input: string): boolean {
    const normalized = String(input || '').toLowerCase();
    return containsAny(normalized, SKU_PATTERNS) || /(\d+)\s*双/.test(normalized);
}

function isAgentPanelDebugIntent(input: string): boolean {
    const normalized = String(input || '').toLowerCase();
    if (containsAny(normalized, AGENT_PANEL_PATTERNS)) return true;
    if (containsAny(normalized, DEBUG_INTENT_PATTERNS) && containsAny(normalized, DECISION_DEBUG_PATTERNS)) return true;
    return containsAny(normalized, DEBUG_INTENT_PATTERNS) && containsAny(normalized, AGENT_RUNTIME_PATTERNS);
}

function detectLightweightIntent(input: string): LightweightIntent {
    const t = String(input || '').trim().toLowerCase();
    if (!t) return 'none';

    if (/^(你好|您好|哈喽|嗨|hello|hi|hey|在吗|在不在|有人吗)[啊呀啦吗嘛!！?？\s]*$/.test(t)) return 'greeting';
    if (/^(谢谢|感谢|thanks|thank you|thx)[啊呀啦!！\s]*$/.test(t)) return 'thanks';
    if (/^(好的|好|ok|行|可以|收到|继续|开始)[啊呀啦!！\s]*$/.test(t)) return 'ack';

    if (/(你是谁|你是什么|你是干什么|你是做什么|介绍一下你|介绍你自己)/.test(t)) return 'identity';
    if (/(你可以做什么|你能做什么|你会什么|你都会什么|能帮我做什么|支持什么|有哪些能力)/.test(t)) return 'capability';

    if (!isActionableRequest(t) && /(\?|？|为什么|怎么|如何|聊聊|在干嘛|在做什么)/.test(t)) return 'chat';

    return 'none';
}

function isModelFirstConversationalIntent(intent: LightweightIntent): boolean {
    return CONVERSATIONAL_MODEL_INTENTS.has(intent);
}

function buildCapabilitySummary(): string {
    const preferredSkillOrder = [
        'matte-product',
        'main-image-design',
        'detail-page-design',
        'sku-batch',
        'layout-replication',
        'find-and-edit-element'
    ];
    const friendlyLabels: Record<string, string> = {
        'matte-product': '抠图去背景',
        'main-image-design': '主图设计',
        'detail-page-design': '详情页设计/文案优化',
        'sku-batch': 'SKU 批量生成',
        'layout-replication': '参考图拆解/复刻',
        'find-and-edit-element': '定位并修改图层元素'
    };

    const availableSkillIds = new Set(SKILL_REGISTRY.map(skill => skill.id));
    const labels = preferredSkillOrder
        .filter(id => availableSkillIds.has(id))
        .map(id => friendlyLabels[id] || id);

    if (labels.length > 0) return labels.join('、');
    return '抠图去背景、主图设计、详情页设计/文案优化、SKU 批量生成、定位并修改图层元素';
}

async function tryConversationalModelReply(
    context: AgentContext,
    callModel: NonNullable<ProcessOptions['callModel']>
): Promise<string | null> {
    try {
        const systemPrompt = [
            '你是 DesignEcho 的设计智能体。',
            '当前用户在进行对话咨询（不是立即执行工具）。',
            '请用自然、口语化中文回答。',
            '不要输出 JSON，不要输出代码块，不要输出工具调用。',
            `你的核心能力包括：${buildCapabilitySummary()}。`,
            `当前 Photoshop 连接状态：${context.isPluginConnected ? '已连接' : '未连接'}。`,
            '请避免模板化回复，同一问题不要重复固定句式。'
        ].join('\n');

        const messages = [
            { role: 'system' as const, content: systemPrompt },
            ...context.conversationHistory.slice(-6).map((m) => ({ role: m.role as any, content: m.content })),
            { role: 'user' as const, content: context.userInput }
        ];

        const result = await callModel(messages, { temperature: 0.5, maxTokens: 280 });
        const raw = String(result?.text || '').trim();
        if (!raw) return null;

        const parsed = parseJsonBlock(raw);
        if (parsed && typeof parsed === 'object') {
            const direct = typeof parsed.directResponse === 'string' ? parsed.directResponse.trim() : '';
            if (direct) return direct;
            const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() : '';
            if (reasoning) return reasoning;
        }

        return raw
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();
    } catch {
        return null;
    }
}

function inferDecisionFromText(userInput: string): AgentDecision {
    const rawInput = String(userInput || '');
    const input = rawInput.toLowerCase();
    const explicitDetailIntent = /详情页|detail page|详情(?!清单|说明)/.test(input);

    const detailScore = scorePatternHits(input, DETAIL_PATTERNS);
    const detailCopyScore = scorePatternHits(input, DETAIL_COPY_PATTERNS);
    const detailImageMutationScore = scorePatternHits(input, DETAIL_IMAGE_MUTATION_PATTERNS);

    if (/抠图|去背景|去背|remove background|matte/.test(input)) {
        return {
            type: 'skill_execution',
            skillId: 'matte-product',
            skillParams: { sourceType: 'current_layer', outputMode: 'new_layer' },
            reasoning: 'Detected background removal intent.'
        };
    }

    if (isAgentPanelDebugIntent(input)) {
        return {
            type: 'skill_execution',
            skillId: 'agent-panel-bridge',
            skillParams: {
                goal: userInput,
                needMcpTools: true
            },
            reasoning: 'Detected agent panel debugging bridge intent.'
        };
    }

    if (containsAny(input, MAIN_IMAGE_PATTERNS) && !explicitDetailIntent) {
        return {
            type: 'skill_execution',
            skillId: 'main-image-design',
            skillParams: { imageType: 'click' },
            reasoning: 'Detected main image design intent.'
        };
    }

    if (detailScore > 0) {
        if (explicitDetailIntent && containsAny(input, DETAIL_REFERENCE_PATTERNS)) {
            const shouldApplyTemplate = /生成|创建|落地|搭建|apply|套用/.test(input);
            return {
                type: 'skill_execution',
                skillId: 'layout-replication',
                skillParams: { outputMode: shouldApplyTemplate ? 'template_apply' : 'template_blueprint' },
                reasoning: shouldApplyTemplate
                    ? 'Detected reference-image template apply intent.'
                    : 'Detected reference-image template blueprint intent.'
            };
        }

        const copyFocused =
            detailCopyScore >= 2
            || (detailCopyScore >= 1 && /所有|全部|当前/.test(input))
            || (/文案/.test(input) && /优化|改写|重写|润色|换行|排版|连贯|图文结合/.test(input));
        const imageMutationRequested = detailImageMutationScore > 0;
        const copyOnly = copyFocused && !imageMutationRequested;

        return {
            type: 'skill_execution',
            skillId: 'detail-page-design',
            skillParams: {
                structureMode: 'guided',
                copyReview: true,
                copyLayoutFit: true,
                copyOnly,
                userIntent: userInput
            },
            reasoning: copyOnly
                ? 'Detected detail-page copy optimization intent (copy-only mode).'
                : 'Detected detail page workflow intent.'
        };
    }

    if (containsAny(input, MAIN_IMAGE_PATTERNS)) {
        return {
            type: 'skill_execution',
            skillId: 'main-image-design',
            skillParams: { imageType: 'click' },
            reasoning: 'Detected main image design intent.'
        };
    }

    if (containsAny(input, ELEMENT_EDIT_PATTERNS)) {
        return {
            type: 'skill_execution',
            skillId: 'find-and-edit-element',
            skillParams: {
                targetDescription: userInput,
                action: 'locate'
            },
            reasoning: 'Detected locate-and-edit layer intent.'
        };
    }

    if (containsAny(input, SKU_PATTERNS)) {
        return {
            type: 'skill_execution',
            skillId: 'sku-batch',
            skillParams: {
                countPerSize: 5,
                generateNotes: true
            },
            reasoning: 'Detected SKU batch intent.'
        };
    }

    if (detailCopyScore >= 2 && !containsAny(input, MAIN_IMAGE_PATTERNS)) {
        return {
            type: 'skill_execution',
            skillId: 'detail-page-design',
            skillParams: {
                structureMode: 'guided',
                copyReview: true,
                copyLayoutFit: true,
                copyOnly: true,
                userIntent: userInput
            },
            reasoning: 'Detected copy-optimization intent, defaulting to detail-page copy-only workflow.'
        };
    }

    if (containsAny(input, ACTION_PATTERNS)) {
        if (isSkuIntent(input)) {
            return {
                type: 'skill_execution',
                skillId: 'sku-batch',
                skillParams: {
                    countPerSize: 5,
                    generateNotes: true
                },
                reasoning: 'Detected SKU batch intent from action request.'
            };
        }
        return {
            type: 'clarification_needed',
            clarificationQuestion: '可以，我来执行。你这一步是要做抠图、主图、详情页、SKU，还是修改某个元素？'
        };
    }

    return {
        type: 'clarification_needed',
        clarificationQuestion: '请告诉我你想让我直接执行什么，例如“优化当前详情页文案并自动适配换行”。'
    };
}

export function debugInferDecisionFromText(userInput: string): AgentDecision {
    return inferDecisionFromText(userInput);
}

function tryNormalizeDecision(raw: any): AgentDecision | null {
    if (!raw || typeof raw !== 'object') {
        return null;
    }

    const normalizeFollowUpAction = (followUp: any): AgentDecision['followUpAction'] | undefined => {
        if (!followUp || typeof followUp !== 'object') return undefined;
        const followUpType = String(followUp.type || '').trim();
        if (followUpType === 'tool_call') {
            const toolCalls = Array.isArray(followUp.toolCalls)
                ? followUp.toolCalls
                    .filter((t: any) => t && typeof t.toolName === 'string')
                    .map((t: any) => ({ toolName: String(t.toolName), params: t.params || {}, reason: t.reason }))
                : [];
            return { type: 'tool_call', toolCalls };
        }
        if (followUpType === 'skill_execution') {
            return {
                type: 'skill_execution',
                skillId: normalizeSkillId(followUp.skillId),
                skillParams: followUp.skillParams && typeof followUp.skillParams === 'object' ? followUp.skillParams : {}
            };
        }
        return undefined;
    };

    const type = String(raw.type || '').trim();

    if (type === 'tool_call') {
        const toolCalls = Array.isArray(raw.toolCalls)
            ? raw.toolCalls
                .filter((t: any) => t && typeof t.toolName === 'string')
                .map((t: any) => ({ toolName: String(t.toolName), params: t.params || {}, reason: t.reason }))
            : [];
        if (toolCalls.length === 0) return null;
        return {
            type: 'tool_call',
            toolCalls,
            reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : undefined,
            followUpAction: normalizeFollowUpAction(raw.followUpAction)
        };
    }

    if (type === 'skill_execution') {
        const normalized = normalizeSkillId(raw.skillId);
        if (!normalized) return null;
        return {
            type: 'skill_execution',
            skillId: normalized,
            skillParams: raw.skillParams && typeof raw.skillParams === 'object' ? raw.skillParams : {},
            reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : undefined,
            followUpAction: normalizeFollowUpAction(raw.followUpAction)
        };
    }

    if (type === 'clarification_needed') {
        return {
            type: 'clarification_needed',
            clarificationQuestion: String(raw.clarificationQuestion || '请补充一下你希望我执行的具体动作。')
        };
    }

    if (type === 'direct_response') {
        return {
            type: 'direct_response',
            directResponse: String(raw.directResponse || '')
        };
    }

    return null;
}

export function generateToolDescriptionsForAI(): string {
    const tools = AVAILABLE_TOOLS.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n');
    const skills = SKILL_REGISTRY.map((skill) => `- ${skill.id}: ${skill.name}`).join('\n');

    return [
        'Available tools:',
        tools,
        '',
        'Available skills:',
        skills
    ].join('\n');
}

function buildSystemPrompt(context: AgentContext): string {
    return [
        'You are DesignEcho decision engine.',
        'Always answer with JSON only. No markdown.',
        'JSON schema:',
        '{',
        '  "type": "tool_call|skill_execution|direct_response|clarification_needed",',
        '  "toolCalls": [{"toolName":"...","params":{},"reason":"..."}],',
        '  "skillId": "...",',
        '  "skillParams": {},',
        '  "directResponse": "...",',
        '  "clarificationQuestion": "...",',
        '  "reasoning": "..."',
        '}',
        '',
        'reasoning is required. Use concise natural Chinese and explain your thought process in 2-4 short lines.',
        'Prefer skill_execution for high-level tasks.',
        'Use skill ids exactly from the registry.',
        'For SKU generation tasks (2/3/4双装, 自选备注, 批量组合), prefer skill_execution with skillId="sku-batch".',
        'Use skillId="sku-config" only for prep actions: exportColors/createPlaceholders/getPlaceholders.',
        'If user asks to edit a visible element but no layer id, use find-and-edit-element.',
        'If user mentions detail page copy optimization (e.g. 文案优化/图文结合/换行), use detail-page-design with {"copyOnly": true, "copyReview": true, "copyLayoutFit": true}.',
        '',
        `Photoshop connected: ${context.isPluginConnected ? 'yes' : 'no'}`,
        `Has document: ${context.photoshopContext?.hasDocument ? 'yes' : 'no'}`,
        `Project path: ${context.projectContext?.projectPath || 'unknown'}`,
        '',
        generateToolDescriptionsForAI()
    ].join('\n');
}

async function resolveDecisionWithModel(
    context: AgentContext,
    callModel: NonNullable<ProcessOptions['callModel']>,
    callbacks?: ExecutionCallbacks
): Promise<{ decision: AgentDecision | null; meta: DecisionResolutionMeta }> {
    const meta: DecisionResolutionMeta = {
        source: 'rules',
        modelAttemptCount: 0,
        repairAttempted: false,
        reaskAttempted: false,
        usedRuleFallback: false,
        parseFailures: 0,
        modelErrors: []
    };

    const runOneRound = async (
        messages: Array<{ role: 'system' | 'user' | 'assistant'; content: any }>,
        options: { temperature: number; maxTokens: number }
    ): Promise<{ text: string; decision: AgentDecision | null }> => {
        meta.modelAttemptCount++;
        const result = await callModel(messages, options);
        const text = String(result?.text || '').trim();
        if (text && !meta.rawDecisionPreview) {
            meta.rawDecisionPreview = text.slice(0, 240);
        }
        const parsed = parseJsonBlock(text);
        if (!parsed) {
            meta.parseFailures++;
            return { text, decision: null };
        }
        const normalized = tryNormalizeDecision(parsed);
        if (!normalized) {
            meta.parseFailures++;
            return { text, decision: null };
        }
        return { text, decision: normalized };
    };

    try {
        const primaryMessages = [
            { role: 'system' as const, content: buildSystemPrompt(context) },
            ...context.conversationHistory.slice(-10).map((m) => ({ role: m.role as any, content: m.content })),
            { role: 'user' as const, content: context.userInput }
        ];

        const primary = await runOneRound(primaryMessages, { temperature: 0.2, maxTokens: 1200 });
        if (primary.decision) {
            meta.source = 'model';
            let decision = primary.decision;

            if (decision.type === 'direct_response' && isActionableRequest(context.userInput)) {
                meta.reaskAttempted = true;
                const reaskMessages = [
                    {
                        role: 'system' as const,
                        content: [
                            'You are DesignEcho decision engine.',
                            'Return JSON only.',
                            'The user request is actionable. Avoid direct_response unless user explicitly asks to chat only.',
                            'Prefer skill_execution or tool_call for executable tasks.',
                            'Use valid schema keys: type/toolCalls/skillId/skillParams/directResponse/clarificationQuestion/reasoning.'
                        ].join('\n')
                    },
                    {
                        role: 'user' as const,
                        content: [
                            `Original user input: ${context.userInput}`,
                            `Previous decision output: ${primary.text || '(empty)'}`,
                            'Re-decide and return executable JSON decision.'
                        ].join('\n')
                    }
                ];
                try {
                    const reask = await runOneRound(reaskMessages, { temperature: 0.1, maxTokens: 800 });
                    if (reask.decision && reask.decision.type !== 'direct_response') {
                        decision = reask.decision;
                        meta.source = 'model_reask';
                    }
                } catch (reaskError: any) {
                    meta.modelErrors.push(`reask: ${reaskError?.message || String(reaskError)}`);
                }
            }

            return { decision, meta };
        }

        meta.repairAttempted = true;
        callbacks?.onMessage?.('我在补全你的任务理解，马上进入执行。');
        const repairMessages = [
            {
                role: 'system' as const,
                content: [
                    'You are a JSON repair engine for DesignEcho decisions.',
                    'Convert the given output into a valid JSON object only.',
                    'Schema keys: type/toolCalls/skillId/skillParams/directResponse/clarificationQuestion/reasoning/followUpAction.',
                    'Valid type: tool_call|skill_execution|direct_response|clarification_needed.',
                    'Do not output markdown.'
                ].join('\n')
            },
            {
                role: 'user' as const,
                content: [
                    `User input: ${context.userInput}`,
                    `Broken decision text: ${primary.text || '(empty)'}`,
                    'Return a corrected JSON decision.'
                ].join('\n')
            }
        ];

        try {
            const repaired = await runOneRound(repairMessages, { temperature: 0, maxTokens: 700 });
            if (repaired.decision) {
                meta.source = 'model_repair';
                return { decision: repaired.decision, meta };
            }
        } catch (repairError: any) {
            meta.modelErrors.push(`repair: ${repairError?.message || String(repairError)}`);
        }

        meta.usedRuleFallback = true;
        return { decision: null, meta };
    } catch (error: any) {
        meta.modelErrors.push(`primary: ${error?.message || String(error)}`);
        meta.usedRuleFallback = true;
        return { decision: null, meta };
    }
}

async function executeToolDecision(
    decision: AgentDecision,
    callbacks?: ExecutionCallbacks,
    signal?: AbortSignal
): Promise<AgentResult> {
    const toolCalls = decision.toolCalls || [];
    if (toolCalls.length === 0) {
        return {
            success: false,
            message: '未提供可执行的工具调用。',
            error: 'No tool calls'
        };
    }

    const toolResults: any[] = [];
    let successCount = 0;

    for (const call of toolCalls) {
        if (signal?.aborted) {
            return {
                success: false,
                cancelled: true,
                message: '任务已取消。',
                toolResults
            };
        }

        callbacks?.onToolStart?.(call.toolName);
        const result = await executeToolCall(call.toolName, call.params || {});
        callbacks?.onToolComplete?.(call.toolName, result);

        toolResults.push({ toolName: call.toolName, result, reason: call.reason });
        if (result?.success !== false) successCount++;
    }

    return {
        success: successCount > 0,
        message: `工具调用完成：成功 ${successCount}/${toolCalls.length}`,
        toolResults,
        error: successCount > 0 ? undefined : 'All tools failed'
    };
}

async function executeSkillDecision(
    decision: AgentDecision,
    callbacks?: ExecutionCallbacks,
    signal?: AbortSignal,
    context?: AgentContext
): Promise<AgentResult> {
    const skillId = normalizeSkillId(decision.skillId);
    if (!skillId) {
        return {
            success: false,
            message: '技能 ID 缺失。',
            error: 'Missing skill id'
        };
    }

    if (!getSkillById(skillId)) {
        return {
            success: false,
            message: `未找到技能：${skillId}`,
            error: 'Skill not found'
        };
    }

    if (!getSkillExecutor(skillId)) {
        return {
            success: false,
            message: `技能执行器未实现：${skillId}`,
            error: 'Skill executor not found'
        };
    }

    return executeSkillWithExecutor(skillId, {
        params: decision.skillParams || {},
        callbacks,
        signal,
        context
    });
}

function buildExecutionSteps(decision: AgentDecision): ExecutionStep[] {
    const steps: ExecutionStep[] = [];

    if (decision.type === 'tool_call') {
        steps.push({
            type: 'tool_call',
            toolCalls: Array.isArray(decision.toolCalls) ? decision.toolCalls : []
        });
    } else if (decision.type === 'skill_execution') {
        steps.push({
            type: 'skill_execution',
            skillId: decision.skillId,
            skillParams: decision.skillParams || {}
        });
    } else if (decision.type === 'clarification_needed') {
        steps.push({
            type: 'clarification_needed',
            clarificationQuestion: decision.clarificationQuestion
        });
    } else {
        steps.push({
            type: 'direct_response',
            directResponse: decision.directResponse
        });
    }

    if (decision.followUpAction?.type === 'tool_call') {
        steps.push({
            type: 'tool_call',
            toolCalls: Array.isArray(decision.followUpAction.toolCalls) ? decision.followUpAction.toolCalls : []
        });
    } else if (decision.followUpAction?.type === 'skill_execution') {
        steps.push({
            type: 'skill_execution',
            skillId: decision.followUpAction.skillId,
            skillParams: decision.followUpAction.skillParams || {}
        });
    }

    return steps;
}

function buildThinkingTrace(decision: AgentDecision): string {
    const lines: string[] = [];
    lines.push('我先理解你的目标，再给出可执行路径。');

    if (decision.type === 'skill_execution') {
        const skillId = normalizeSkillId(decision.skillId);
        const p = decision.skillParams || {};

        if (skillId === 'detail-page-design') {
            if (p.copyOnly === true || p.forceCopyOnly === true) {
                lines.push('判断为「详情页文案优化」任务，先保持图片不变。');
                lines.push('执行顺序：解析结构 -> 文案优化与图文一致性检查 -> 自动换行和长度适配 -> 写回图层。');
            } else {
                lines.push('判断为「详情页设计/填充」任务。');
                lines.push('执行顺序：解析结构 -> 匹配文案与素材 -> 批量填充并输出结果。');
            }
        } else if (skillId === 'main-image-design') {
            lines.push('判断为「主图设计」任务。');
            lines.push('执行顺序：识别主体 -> 自动构图 -> 导出结果。');
        } else if (skillId === 'matte-product') {
            lines.push('判断为「抠图」任务。');
            lines.push('执行顺序：识别主体边缘 -> 扣除背景 -> 回写图层。');
        } else if (skillId === 'find-and-edit-element') {
            lines.push('判断为「定位并编辑元素」任务。');
            lines.push('执行顺序：先定位目标图层，再按你的指令修改。');
        } else if (skillId === 'layout-replication') {
            lines.push('判断为「参考图拆解/复刻」任务。');
            lines.push('执行顺序：分析参考布局 -> 生成可编辑模板 -> 按需套用。');
        } else if (skillId === 'agent-panel-bridge') {
            lines.push('判断为「Agent 面板桥接调试」任务。');
            lines.push('执行顺序：整理目标与现象 -> 拉取MCP能力上下文 -> 生成结构化联调消息。');
        } else if (skillId === 'sku-batch') {
            lines.push('判断为「SKU 批量处理」任务。');
            lines.push('执行顺序：读取配置 -> 批量生成 -> 汇总输出。');
        } else {
            lines.push(`判断为「${skillId || '技能'}」任务，按预设流程执行。`);
        }
    } else if (decision.type === 'tool_call') {
        const tools = (decision.toolCalls || []).map(t => t.toolName).filter(Boolean);
        lines.push('判断为「精确工具操作」任务。');
        if (tools.length > 0) {
            lines.push(`将依次执行：${tools.join(' -> ')}。`);
        }
    } else if (decision.type === 'clarification_needed') {
        lines.push('当前关键信息不足，我会先问一个最小问题再执行。');
    } else {
        lines.push('这次先给你直接回复，不改动画布。');
    }

    return lines.join('\n');
}

function summarizeDecisionFailure(meta: DecisionResolutionMeta): string {
    const mergedError = String((meta.modelErrors || []).join(' | ') || '');

    if (/api key not configured|未配置|no api key/i.test(mergedError)) {
        return '未检测到可用 API 密钥';
    }
    if (/401|unauthorized|invalid api key|forbidden|权限不足|无权访问/i.test(mergedError)) {
        return 'API 密钥无效或权限不足';
    }
    if (/quota|insufficient|余额不足|billing|429|rate limit/i.test(mergedError)) {
        return '模型账户额度不足或触发限流';
    }
    if (/network|timeout|timed out|econn|fetch failed|enotfound/i.test(mergedError)) {
        return '网络或服务连接异常';
    }
    if (meta.parseFailures > 0 && meta.modelErrors.length === 0) {
        return '模型返回结果格式异常';
    }
    if (meta.modelErrors.length > 0) {
        const first = String(meta.modelErrors[0] || '').replace(/^(primary|repair|reask):\s*/i, '').trim();
        return first || '模型调用失败';
    }
    return '模型暂时不可用';
}

async function executePlannedSteps(
    decision: AgentDecision,
    context: AgentContext,
    callbacks?: ExecutionCallbacks,
    signal?: AbortSignal
): Promise<AgentResult> {
    const steps = buildExecutionSteps(decision);

    const allToolResults: any[] = [];
    let latestMessage = '已完成。';
    let latestData: any = undefined;

    for (let i = 0; i < steps.length; i++) {
        if (signal?.aborted) {
            return {
                success: false,
                cancelled: true,
                message: '任务已取消。',
                toolResults: allToolResults
            };
        }

        const step = steps[i];
        callbacks?.onProgress?.(`执行步骤 ${i + 1}/${steps.length}`, 35 + Math.round(((i + 1) / Math.max(1, steps.length)) * 55));

        if (step.type === 'direct_response') {
            return {
                success: true,
                message: step.directResponse || '已完成。',
                toolResults: allToolResults.length > 0 ? allToolResults : undefined
            };
        }

        if (step.type === 'clarification_needed') {
            return {
                success: true,
                message: step.clarificationQuestion || '请补充更具体的需求。',
                toolResults: allToolResults.length > 0 ? allToolResults : undefined
            };
        }

        const stepResult = step.type === 'tool_call'
            ? await executeToolDecision({
                type: 'tool_call',
                toolCalls: step.toolCalls || []
            }, callbacks, signal)
            : await executeSkillDecision({
                type: 'skill_execution',
                skillId: step.skillId,
                skillParams: step.skillParams || {}
            }, callbacks, signal, context);

        if (Array.isArray(stepResult.toolResults)) {
            allToolResults.push(...stepResult.toolResults);
        }
        if (stepResult.data !== undefined) {
            latestData = stepResult.data;
        }
        latestMessage = stepResult.message || latestMessage;

        if (!stepResult.success) {
            return {
                ...stepResult,
                toolResults: allToolResults.length > 0 ? allToolResults : stepResult.toolResults
            };
        }
    }

    return {
        success: true,
        message: latestMessage,
        toolResults: allToolResults.length > 0 ? allToolResults : undefined,
        data: latestData
    };
}

export async function processWithUnifiedAgent(
    context: AgentContext,
    options: ProcessOptions
): Promise<AgentResult> {
    const { callModel, callbacks, signal } = options;

    if (signal?.aborted) {
        return { success: false, cancelled: true, message: '任务已取消。' };
    }

    const lightweightIntent = detectLightweightIntent(context.userInput);

    if (callModel && isModelFirstConversationalIntent(lightweightIntent)) {
        callbacks?.onProgress?.('理解你的问题中', 8);
        const conversationalReply = await tryConversationalModelReply(context, callModel);
        if (conversationalReply) {
            return { success: true, message: conversationalReply };
        }
    }

    callbacks?.onProgress?.('分析需求中', 10);

    let decision: AgentDecision | null = null;
    let decisionSource: DecisionSource = 'rules';
    let decisionMeta: DecisionResolutionMeta = {
        source: 'rules',
        modelAttemptCount: 0,
        repairAttempted: false,
        reaskAttempted: false,
        usedRuleFallback: false,
        parseFailures: 0,
        modelErrors: []
    };

    if (callModel) {
        const resolved = await resolveDecisionWithModel(context, callModel, callbacks);
        decision = resolved.decision;
        decisionSource = resolved.meta.source;
        decisionMeta = resolved.meta;

        // 模型不可用时，静默回退到规则推断，避免额外技术化提示打断体验。
    }

    if (!decision) {
        const ruleDecision = inferDecisionFromText(context.userInput);
        const ruleLooksExecutable = ruleDecision.type === 'skill_execution' || ruleDecision.type === 'tool_call';
        const allowRuleExecution = /(按规则|直接执行|先按默认执行|不走模型|强制执行|重试执行|继续执行)/.test(String(context.userInput || ''));
        const failureReason = summarizeDecisionFailure(decisionMeta);

        if (callModel && isActionableRequest(context.userInput) && ruleLooksExecutable && !allowRuleExecution) {
            decision = {
                type: 'clarification_needed',
                clarificationQuestion: `我已识别到你要执行任务，但这次模型决策失败（${failureReason}）。为避免关键词误判，我先不直接执行。你可以回复“重试执行”按规则继续，或补充更具体目标。`,
                reasoning: `这次模型决策未成功，原因：${failureReason}。\n为避免误判，我先暂停自动执行。\n你可以让我“重试执行”按规则继续，或补充约束后再试。`
            };
            decisionSource = 'model_reask';
        } else {
            decision = ruleDecision;
            decisionSource = 'rules';
        }
    }

    if (isSkuIntent(context.userInput)) {
        const shouldForceSkuExecution =
            decision.type === 'clarification_needed'
            || decision.type === 'direct_response'
            || (decision.type === 'skill_execution' && normalizeSkillId(decision.skillId) === 'sku-config');
        if (shouldForceSkuExecution) {
            decision = {
                type: 'skill_execution',
                skillId: 'sku-batch',
                skillParams: {
                    ...(decision.skillParams || {}),
                    countPerSize: Number((decision.skillParams as any)?.countPerSize || 5),
                    generateNotes: (decision.skillParams as any)?.generateNotes ?? true
                },
                reasoning: String(decision.reasoning || '识别为 SKU 编排任务，按模板规格自动执行，并默认每个规格生成 5 个组合与自选备注。')
            };
            decisionSource = decisionSource === 'rules' ? 'rules' : 'model_reask';
        }
    }

    const shouldPreferModelReasoning = decisionSource !== 'rules';
    const thinking = shouldPreferModelReasoning
        ? (String(decision.reasoning || '').trim() || buildThinkingTrace(decision))
        : buildThinkingTrace(decision);
    callbacks?.onThinking?.(thinking);

    callbacks?.onProgress?.('准备执行', 28);
    const executionResult = await executePlannedSteps(decision, context, callbacks, signal);

    return executionResult;
}

export async function getPhotoshopContext(): Promise<PhotoshopContext | undefined> {
    try {
        const docInfo = await executeToolCall('getDocumentInfo', {});
        if (!docInfo || docInfo.success === false) {
            return { hasDocument: false };
        }

        const data = docInfo.document || docInfo.data || docInfo;
        const hasDocument = !!(data?.name || data?.documentName || docInfo?.success);

        return {
            hasDocument,
            documentName: data?.name || data?.documentName,
            canvasSize: data?.size || (data?.width && data?.height ? { width: data.width, height: data.height } : undefined),
            activeLayerName: data?.activeLayerName,
            layerCount: data?.layerCount
        };
    } catch {
        return undefined;
    }
}

export async function getProjectContext(): Promise<ProjectContext | undefined> {
    try {
        const state = useAppStore.getState() as any;
        const project = state?.currentProject;
        if (!project) return undefined;

        const structure = state?.ecommerceStructure;
        return {
            projectPath: project.path,
            hasSkuFiles: Array.isArray(structure?.skuFolder?.files) ? structure.skuFolder.files.length > 0 : undefined,
            hasTemplates: Array.isArray(structure?.templateFolder?.files) ? structure.templateFolder.files.length > 0 : undefined,
            availableColors: Array.isArray(structure?.colors) ? structure.colors : undefined
        };
    } catch {
        return undefined;
    }
}
