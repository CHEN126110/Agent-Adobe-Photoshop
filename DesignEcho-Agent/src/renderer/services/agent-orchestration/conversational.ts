import { getUserFacingSkills } from '../../../shared/skills/skill-declarations';
import {
    buildAgentResponseKnowledgeBundle,
    renderAgentResponseKnowledgePromptSection
} from '../../../shared/agent-response-knowledge';
import {
    buildAgentPreferenceFeedbackMessages,
    normalizeAgentPreferenceFeedbackDecision,
    shouldAttemptPreferenceFeedbackCapture
} from '../../../shared/agent-preference-feedback';
import { isAgentSkillCapabilityQuestion } from '../../../shared/agent-intent-control-plane';
import { useAppStore } from '../../stores/app.store';
import { getMemoryService } from '../memory.service';
import type { AgentContext, ProcessOptions, LightweightIntent } from './types';
import { isAgentMattingPaused } from './routing';
import type { ClarificationFollowupContext } from './clarification-followup';

function parseJsonBlock(text: string): any | null {
    const trimmed = String(text || '').trim();
    if (!trimmed) return null;

    const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : trimmed;

    try {
        return JSON.parse(candidate);
    } catch {
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

function buildCapabilitySummary(): string {
    const integrationSettings = useAppStore.getState().integrationSettings;
    const enabledSkills = getUserFacingSkills()
        .filter((skill) => !(isAgentMattingPaused() && skill.id === 'matte-product'))
        .filter((skill) => integrationSettings?.skills?.[skill.id]?.enabled !== false)
        .map((skill) => String(skill.name || skill.id).trim())
        .filter(Boolean);

    if (enabledSkills.length === 0) {
        return '当前没有启用的用户可见技能';
    }

    return enabledSkills.join('、');
}

function getEnabledUserFacingSkillIds(): Set<string> {
    const integrationSettings = useAppStore.getState().integrationSettings;
    return new Set(getUserFacingSkills()
        .filter((skill) => !(isAgentMattingPaused() && skill.id === 'matte-product'))
        .filter((skill) => integrationSettings?.skills?.[skill.id]?.enabled !== false)
        .map((skill) => skill.id));
}

function buildCapabilityFallbackSummary(): string {
    const enabledSkillIds = getEnabledUserFacingSkillIds();
    const capabilityGroups = [
        {
            label: '主图、点击图、转化图和白底图规划',
            skillIds: ['main-image-design', 'main-image-template-authoring']
        },
        {
            label: 'SKU 组合图和自选备注',
            skillIds: ['sku-batch']
        },
        {
            label: '详情页设计、模板检查和模板创建',
            skillIds: ['detail-page-design', 'detail-page-template-authoring']
        },
        {
            label: '项目图片理解、素材概览和设计参考检索',
            skillIds: ['project-image-analysis', 'visual-analysis', 'design-reference-search']
        },
        {
            label: '参考图复刻、图层、文档、文字和字体处理',
            skillIds: ['layout-replication', 'layer-management', 'document-management', 'find-and-edit-element', 'text-font-replace', 'save-current-template']
        },
        {
            label: '电商袜子整套设计编排',
            skillIds: ['ecommerce-socks-design']
        }
    ];
    const labels = capabilityGroups
        .filter((group) => group.skillIds.some((skillId) => enabledSkillIds.has(skillId)))
        .map((group) => group.label);

    if (labels.length) return labels.join('、');
    return '当前没有启用的用户可见设计能力';
}

function getConversationModelHint(): string {
    const prefs = useAppStore.getState().modelPreferences;
    if (!prefs) return '当前已配置的通用对话模型';

    const localModel = String(prefs.preferredLocalModels?.layoutAnalysis || '').trim();
    const cloudModel = String(prefs.preferredCloudModels?.layoutAnalysis || '').trim();

    if (prefs.mode === 'local') {
        return localModel || '本地通用模型';
    }
    if (prefs.mode === 'cloud') {
        return cloudModel || '云端通用模型';
    }

    if (localModel && cloudModel) {
        return `${localModel}（本地优先） / ${cloudModel}（云端备选）`;
    }
    return localModel || cloudModel || '当前已配置的通用对话模型';
}

function buildResponseKnowledgePromptSection(context: AgentContext): string {
    const integrationSettings = useAppStore.getState().integrationSettings;
    const skillFacts = getUserFacingSkills().map((skill) => ({
        id: skill.id,
        name: String(skill.name || skill.id).trim(),
        visibility: skill.visibility,
        enabled: !(isAgentMattingPaused() && skill.id === 'matte-product')
            && integrationSettings?.skills?.[skill.id]?.enabled !== false
    }));

    let preferenceItems: ReturnType<ReturnType<typeof getMemoryService>['listPreferenceItems']> = [];
    let knowledgeResults: ReturnType<ReturnType<typeof getMemoryService>['getDesignKnowledgeResults']> = [];

    try {
        if (typeof localStorage === 'undefined') {
            return renderAgentResponseKnowledgePromptSection(buildAgentResponseKnowledgeBundle({
                userText: context.userInput,
                skillFacts,
                projectContext: context.projectContext
            }));
        }

        const memory = getMemoryService();
        preferenceItems = memory.listPreferenceItems();
        knowledgeResults = memory.getDesignKnowledgeResults({
            query: [
                context.userInput,
                '用户偏好',
                '设计风格',
                '字体',
                '排版',
                '颜色',
                '文案',
                '工作流',
                '主图',
                '详情页',
                'SKU'
            ].join(' '),
            intents: ['rule', 'copywriting'],
            sourceTypes: ['local_case'],
            limit: 8
        });
    } catch (error) {
        console.warn('[conversational] failed to build memory-backed response knowledge bundle:', error);
    }

    return renderAgentResponseKnowledgePromptSection(buildAgentResponseKnowledgeBundle({
        userText: context.userInput,
        skillFacts,
        preferenceItems,
        knowledgeResults,
        projectContext: context.projectContext
    }));
}

export async function captureExplicitPreferenceFeedback(
    context: AgentContext,
    assistantReply: string,
    callModel: NonNullable<ProcessOptions['callModel']>
): Promise<void> {
    if (!shouldAttemptPreferenceFeedbackCapture(context.userInput)) return;
    if (typeof localStorage === 'undefined') return;

    try {
        const result = await callModel(
            buildAgentPreferenceFeedbackMessages({
                userText: context.userInput,
                assistantReply
            }),
            {
                temperature: 0,
                maxTokens: 500,
                stream: false,
                silent: true,
                purpose: 'preference_feedback'
            }
        );
        const decision = normalizeAgentPreferenceFeedbackDecision(String(result?.text || ''));
        if (!decision.shouldSave) return;

        const memory = getMemoryService();
        for (const preference of decision.preferences) {
            memory.upsertExplicitPreference({
                category: preference.category,
                value: preference.value,
                label: preference.label,
                evidenceSummary: preference.evidenceSummary
            });
        }
    } catch (error) {
        console.warn('[conversational] explicit preference feedback capture skipped:', error);
    }
}

function buildLocalTaskSummaryReply(context: AgentContext): string {
    const recentMessages = context.conversationHistory
        .slice(-6)
        .map((item) => {
            const role = item.role === 'assistant' ? 'Agent' : '用户';
            const content = String(item.content || '').trim().replace(/\s+/g, ' ');
            return content ? `${role}：${content.slice(0, 120)}` : '';
        })
        .filter(Boolean);

    if (recentMessages.length === 0) {
        return '我没有拿到可用于总结的最近对话记录，因此不会为了总结而调用 Photoshop 工具。你可以让我重新查看当前项目状态，或补充要总结的范围。';
    }

    return [
        '这是对话历史总结请求，不应触发 Photoshop 工具链。',
        '当前只能基于最近对话做简要回顾：',
        ...recentMessages.map((message) => `- ${message}`)
    ].join('\n');
}

function buildLocalContinuationReply(context: AgentContext): string {
    const lastUserTask = [...context.conversationHistory]
        .reverse()
        .find((item) => item.role === 'user' && String(item.content || '').trim());
    const lastTaskText = String(lastUserTask?.content || '').trim();

    if (!lastTaskText) {
        return '我没有拿到可继续的上一轮任务上下文，因此不会只凭“继续”就调用 Photoshop 工具。请补充要继续哪一项任务。';
    }

    return `我理解你想继续上一轮上下文，但当前没有模型可用来判断下一步是否应执行工具。上一轮用户请求是：“${lastTaskText.slice(0, 80)}”。请明确要继续执行哪一步，我再进入对应能力。`;
}

function isUnhelpfulClarificationFollowupReply(text: string, options?: { clarificationFollowup?: ClarificationFollowupContext }): boolean {
    if (!options?.clarificationFollowup) return false;
    const value = String(text || '').trim();
    if (!value) return true;
    return /这是对话问题|不会默认触发 Photoshop|不会触发 Photoshop 执行/.test(value);
}

function containsToolCallLikeText(text: string): boolean {
    const value = String(text || '');
    return /<\s*tool_call\b/i.test(value)
        || /<\/\s*tool_call\s*>/i.test(value)
        || /<\s*function\s*=/i.test(value)
        || /<\/\s*function\s*>/i.test(value)
        || /\btool_use\b/i.test(value);
}

function extractConversationalReplyFromModelText(
    text: string,
    options?: { clarificationFollowup?: ClarificationFollowupContext }
): string | null {
    const raw = String(text || '').trim();
    if (!raw) return null;
    if (containsToolCallLikeText(raw)) return null;

    const parsed = parseJsonBlock(raw);
    if (parsed && typeof parsed === 'object') {
        const direct = typeof parsed.directResponse === 'string' ? parsed.directResponse.trim() : '';
        if (direct) {
            if (containsToolCallLikeText(direct)) return null;
            return isUnhelpfulClarificationFollowupReply(direct, options) ? null : direct;
        }

        const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() : '';
        if (reasoning) {
            if (containsToolCallLikeText(reasoning)) return null;
            return isUnhelpfulClarificationFollowupReply(reasoning, options) ? null : reasoning;
        }

        return null;
    }

    const reply = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    if (containsToolCallLikeText(reply)) return null;
    if (isUnhelpfulClarificationFollowupReply(reply, options)) return null;
    return reply;
}

export function buildLocalConversationalReply(intent: LightweightIntent, context: AgentContext): string | null {
    switch (intent) {
        case 'identity':
        case 'model_compare':
        case 'capability':
        case 'greeting':
        case 'thanks':
        case 'ack':
            return null;
        case 'task_summary':
            return buildLocalTaskSummaryReply(context);
        case 'continuation':
            return buildLocalContinuationReply(context);
        case 'chat':
            return null;
        default:
            return null;
    }
}

export function buildContextualConversationalFallbackReply(
    intent: LightweightIntent,
    context: AgentContext
): string | null {
    const userText = String(context.userInput || '');
    const isCapabilityLike = intent === 'capability' || isAgentSkillCapabilityQuestion(userText);
    if (!isCapabilityLike) return null;

    const projectFacts = [
        context.projectContext?.projectPath ? '已有当前项目上下文' : '',
        context.projectContext?.projectImageCount ? `已索引 ${context.projectContext.projectImageCount} 张项目图片` : '',
        context.photoshopContext?.hasDocument
            ? `当前 Photoshop 文档：${context.photoshopContext.documentName || '未命名文档'}`
            : ''
    ].filter(Boolean);

    return [
        `我可以协助这些设计工作：${buildCapabilityFallbackSummary()}。`,
        `当前状态：Photoshop ${context.isPluginConnected ? '已连接' : '未连接'}${projectFacts.length ? `；${projectFacts.join('；')}` : ''}。`,
        '你可以直接提出主图、SKU、详情页、项目图片理解、文档保存或图层调整需求；我会先判断它属于对话、只读检查还是需要受控执行。'
    ].join('\n');
}

export async function tryConversationalModelReply(
    context: AgentContext,
    callModel: NonNullable<ProcessOptions['callModel']>,
    options?: {
        clarificationFollowup?: ClarificationFollowupContext;
    }
): Promise<string | null> {
    try {
        const systemPrompt = [
            '你是 DesignEcho 桌面端智能体。',
            '当前用户在进行对话咨询，而不是立刻要求你执行 Photoshop 操作。',
            '请直接用自然、简洁的中文回答。',
            '不要输出 JSON，不要输出工具名，不要模拟工具调用。',
            '如果用户是在追问上一轮澄清，例如问“比如呢”“具体怎么说”“要补什么”，必须承接最近对话和上一轮澄清，给出可直接发送的表达方式；不要用固定的工具禁用话术代替解释。',
            buildResponseKnowledgePromptSection(context),
            `你的能力包括：${buildCapabilitySummary()}。`,
            `当前 Photoshop 连接状态：${context.isPluginConnected ? '已连接' : '未连接'}。`,
            context.projectContext?.projectImageCount
                ? `当前项目中已扫描到 ${context.projectContext.projectImageCount} 张图片，可直接基于项目图片做理解与分析，不需要要求用户重新上传。`
                : '如果项目上下文里已有图片信息，可以直接基于项目图片继续分析。',
            options?.clarificationFollowup
                ? [
                    '当前命中“上一轮澄清追问”上下文。',
                    `上一轮用户请求：${options.clarificationFollowup.recentUserRequest || '未记录'}`,
                    `上一轮澄清内容：${options.clarificationFollowup.previousClarification}`,
                    '回答时只解释用户需要补哪些信息，并基于历史语义生成表达示例；不得调用或暗示已经调用 Photoshop。'
                ].join('\n')
                : ''
        ].join('\n');

        const messages = [
            { role: 'system' as const, content: systemPrompt },
            ...context.conversationHistory.slice(-6).map((item) => ({
                role: item.role as 'user' | 'assistant',
                content: item.content
            })),
            { role: 'user' as const, content: context.userInput }
        ];

        const result = await callModel(messages, { temperature: 0.4, maxTokens: 220, stream: true, purpose: 'direct_response' });
        const primaryReply = extractConversationalReplyFromModelText(String(result?.text || ''), options);
        if (primaryReply) {
            await captureExplicitPreferenceFeedback(context, primaryReply, callModel);
            return primaryReply;
        }

        const repairResult = await callModel(
            [
                {
                    role: 'system' as const,
                    content: [
                        '你是 DesignEcho 桌面端智能体。',
                        '上一轮对话回复为空、不是自然语言，或误返回了路由/JSON。',
                        '上一轮也可能输出了 <tool_call> 或 <function=...> 这类工具调用格式；这不是可展示回复，必须改成自然语言。',
                        '请基于同一用户问题重新生成一段可直接展示给用户的简体中文自然回复。',
                        '不要输出 JSON，不要输出工具名，不要模拟工具调用，不要说已经执行 Photoshop。',
                        '如果用户只是询问能力、身份、进度或设计知识，只回答问题本身，并说明需要明确授权才会执行工具。',
                        buildResponseKnowledgePromptSection(context),
                        `你的能力包括：${buildCapabilitySummary()}。`,
                        `当前 Photoshop 连接状态：${context.isPluginConnected ? '已连接' : '未连接'}。`
                    ].join('\n')
                },
                ...context.conversationHistory.slice(-6).map((item) => ({
                    role: item.role as 'user' | 'assistant',
                    content: item.content
                })),
                { role: 'user' as const, content: context.userInput }
            ],
            {
                temperature: 0.3,
                maxTokens: 260,
                stream: false,
                purpose: 'direct_response_repair'
            }
        );
        const repairedReply = extractConversationalReplyFromModelText(String(repairResult?.text || ''), options);
        if (!repairedReply) return null;

        await captureExplicitPreferenceFeedback(context, repairedReply, callModel);
        return repairedReply;
    } catch {
        return null;
    }
}
