import type { ModelPreferences } from './config/models.config';
import {
    getModelById,
    isAgentMultimodalModelConfig
} from './config/models.config';
import {
    getModelPriorityForConversationTask,
    type ConversationTaskType
} from './model-selection';
import type { DesignTeammateRole } from './types/design-team.types';

export type ModelCapabilitySlot = 'logic' | 'copywriting' | 'visual';
export type ModelDispatchConsumer = 'primary-agent' | 'teammate' | 'skill';
export type ModelDispatchContextMode = 'structured_task_context';

export interface BuildMultimodalModelDispatchInput {
    consumer: ModelDispatchConsumer;
    role?: DesignTeammateRole;
    taskType?: ConversationTaskType;
    userTask?: string;
    hasImage?: boolean;
    prefs?: Partial<ModelPreferences> | null;
    mode?: ModelPreferences['mode'];
    includeFallback?: boolean;
    includeCrossTaskBackups?: boolean;
    requireToolUse?: boolean;
    requireVision?: boolean;
    explicitModelId?: string;
    availableModels?: string[];
}

export interface ModelDispatchContextPolicy {
    mode: ModelDispatchContextMode;
    includeFullConversation: false;
    requiredContext: string[];
    maxDigestChars: number;
}

export interface ModelDispatchHandoffBoundary {
    primaryAgentRetainsFinalJudgment: true;
    expertReturnsConclusionOnly: true;
    expertMayDirectlyExecuteTools: false;
    notes: string[];
}

export interface MultimodalModelDispatchPlan {
    version: 'multimodal-model-dispatch/v0';
    architecture: 'unified-multimodal-agent-model';
    consumer: ModelDispatchConsumer;
    role?: DesignTeammateRole;
    taskType: ConversationTaskType;
    capabilitySlot: ModelCapabilitySlot;
    selectedModelId: string;
    candidateModelIds: string[];
    publicReason: string;
    contextPolicy: ModelDispatchContextPolicy;
    handoffBoundary: ModelDispatchHandoffBoundary;
}

const ROLE_TASK_TYPE: Record<DesignTeammateRole, ConversationTaskType> = {
    'scene-analyst': 'visual',
    'market-researcher': 'logic',
    copywriter: 'copywriting',
    'design-strategist': 'logic',
    executor: 'logic',
    critic: 'visual'
};

const SLOT_LABEL: Record<ModelCapabilitySlot, string> = {
    logic: '逻辑',
    copywriting: '文案',
    visual: '视觉'
};

function uniqNonEmpty(values: Array<string | undefined | null>): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const modelId = String(value || '').trim();
        if (!modelId || seen.has(modelId)) continue;
        seen.add(modelId);
        result.push(modelId);
    }
    return result;
}

function isKnownOrAvailableModel(modelId: string, availableModels?: string[]): boolean {
    if (!modelId) return false;
    if (availableModels?.includes(modelId)) return true;
    return Boolean(getModelById(modelId));
}

function modelMeetsDispatchRequirements(
    modelId: string,
    input: BuildMultimodalModelDispatchInput,
    _taskType: ConversationTaskType
): boolean {
    if (!isKnownOrAvailableModel(modelId, input.availableModels)) return false;
    const model = getModelById(modelId);
    // 所有 Agent 消费方都走同一个能力真相源，不能让文本-only 模型在
    // logic/copywriting 角色或 fallback 队列里重新进入运行时。
    if (!isAgentMultimodalModelConfig(model)) return false;
    if ((input.requireToolUse ?? true) && model?.supportsToolUse === false) return false;
    return true;
}

export function resolveTaskTypeForDesignRole(role: DesignTeammateRole): ConversationTaskType {
    return ROLE_TASK_TYPE[role] || 'logic';
}

export function resolveCapabilitySlotForTaskType(taskType: ConversationTaskType): ModelCapabilitySlot {
    switch (taskType) {
        case 'visual':
            return 'visual';
        case 'copywriting':
            return 'copywriting';
        case 'general':
        case 'logic':
        default:
            return 'logic';
    }
}

export function formatCapabilitySlotLabel(slot: ModelCapabilitySlot): string {
    return SLOT_LABEL[slot] || slot;
}

function resolveDispatchTaskType(input: BuildMultimodalModelDispatchInput): ConversationTaskType {
    if (input.taskType) return input.taskType;
    if (input.role) return resolveTaskTypeForDesignRole(input.role);
    if (input.hasImage) return 'visual';
    return 'logic';
}

function buildRequiredContext(input: BuildMultimodalModelDispatchInput, taskType: ConversationTaskType): string[] {
    const required = ['用户当前任务', '当前项目状态摘要', '本轮已完成的关键判断'];
    if (input.consumer === 'teammate') required.push('团队共享工作区摘要');
    if (taskType === 'visual') required.push('当前画面快照或素材视觉摘要');
    if (taskType === 'copywriting') required.push('产品卖点、用户痛点和已确认文案约束');
    if (taskType === 'logic') required.push('可执行工具边界和待验证结果');
    return required;
}

function buildPublicReason(input: BuildMultimodalModelDispatchInput, slot: ModelCapabilitySlot, selectedModelId: string): string {
    const rolePart = input.role ? `${input.role} ` : '';
    const modelRole = 'Agent 模型';
    if (!selectedModelId) {
        return `${rolePart}这一步暂时没有可用的${modelRole}，请检查模型设置。`;
    }
    if (input.consumer === 'primary-agent') {
        return `Agent 模型 ${selectedModelId} 负责理解需求、读取画面、设计判断、工具调用和最终回复。`;
    }
    return slot === 'visual'
        ? `${rolePart}这一步由同一个 Agent 模型 ${selectedModelId} 读取画面并完成判断。`
        : `${rolePart}这一步由同一个 Agent 模型 ${selectedModelId} 完成专业判断。`;
}

export function buildMultimodalModelDispatchPlan(
    input: BuildMultimodalModelDispatchInput
): MultimodalModelDispatchPlan {
    const taskType = resolveDispatchTaskType(input);
    const capabilitySlot = resolveCapabilitySlotForTaskType(taskType);
    const explicitModelId = String(input.explicitModelId || '').trim();
    const configuredIdentity = String(
        input.prefs?.primaryModel || input.prefs?.visualModel || ''
    ).trim();
    const configuredCandidates = getModelPriorityForConversationTask(input.prefs, taskType, {
            mode: input.mode,
            includeFallback: input.includeFallback,
            includeCrossTaskBackups: input.includeCrossTaskBackups ?? true,
            requireVision: true,
            requireToolUse: input.requireToolUse ?? true
        });
    // 一旦存在用户配置身份，显式 override 也不能把某个角色切到第二个模型。
    // explicitModelId 只服务于“配置读取失败且没有任何用户模型身份”的恢复入口。
    const candidates = uniqNonEmpty(
        configuredIdentity
            ? configuredCandidates
            : [explicitModelId, ...configuredCandidates]
    ).filter((modelId) => modelMeetsDispatchRequirements(modelId, input, taskType));
    const selectedModelId = candidates[0] || '';

    return {
        version: 'multimodal-model-dispatch/v0',
        architecture: 'unified-multimodal-agent-model',
        consumer: input.consumer,
        ...(input.role ? { role: input.role } : {}),
        taskType,
        capabilitySlot,
        selectedModelId,
        candidateModelIds: candidates,
        publicReason: buildPublicReason(input, capabilitySlot, selectedModelId),
        contextPolicy: {
            mode: 'structured_task_context',
            includeFullConversation: false,
            requiredContext: buildRequiredContext(input, taskType),
            maxDigestChars: input.consumer === 'primary-agent' ? 8000 : 6000
        },
        handoffBoundary: {
            primaryAgentRetainsFinalJudgment: true,
            expertReturnsConclusionOnly: true,
            expertMayDirectlyExecuteTools: false,
            notes: [
                '同一个 Agent 模型负责理解、视觉观察、最终决策和工具执行顺序。',
                '团队角色只隔离职责与上下文，不切换基础模型。',
                '不要把完整历史对话无差别交给角色任务，避免上下文漂移。'
            ]
        }
    };
}

export function formatModelDispatchTrace(plan: MultimodalModelDispatchPlan): string {
    const roleText = plan.role ? `（${plan.role}）` : '';
    const slotLabel = formatCapabilitySlotLabel(plan.capabilitySlot);
    const modelText = plan.selectedModelId || '未解析';
    return [
        `模型调度${roleText}：Agent 模型 ${modelText}；本步侧重${slotLabel}。`,
        plan.publicReason,
        '边界：角色可分工，但基础模型保持一致；主 Agent 保留最终判断。',
        `上下文：使用结构化任务摘要，不直接传递完整对话；需要：${plan.contextPolicy.requiredContext.join('、')}。`
    ].join('\n');
}

export function formatPrimaryAgentDispatchPromptSection(plan: MultimodalModelDispatchPlan): string {
    return [
        '## Agent 模型',
        `- 本轮统一使用视觉多模态模型：${plan.selectedModelId || '当前配置的 Agent 模型'}。`,
        '- 你负责理解用户、读取画面、做设计判断、安排必要动作并给出最终回复。',
        '- 不存在独立视觉模型转述；你必须直接依据本轮真实图像观察形成判断。',
        '- 面向用户只谈设计目标、画面判断、处理结果和必要选择，不谈模型分工或内部处理机制。',
        `- 继续任务所需信息：${plan.contextPolicy.requiredContext.join('、')}。`
    ].join('\n');
}
