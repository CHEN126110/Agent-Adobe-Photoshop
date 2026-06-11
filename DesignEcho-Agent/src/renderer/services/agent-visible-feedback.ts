import type { AgentStepEvent } from './agent-runtime/types';
import { getToolDisplayInfo } from './tool-display-info';
import { getDesignTeammateDefinition } from './design-teams';
import { getSkillById } from '../../shared/skills/skill-declarations';
import type { DesignTeammateRole } from '../../shared/types/design-team.types';
import {
    canObservationEnterThinkingSteps,
    canObservationRenderAsToolCall,
    classifyAgentObservationChannel
} from '../../shared/agent-observation-channels';

type VisibleStepLike = {
    type: string;
    content?: string;
    toolName?: string;
};

export type VisibleAgentActivityKind =
    | 'request'
    | 'router'
    | 'skill'
    | 'autonomous_agent'
    | 'teammate';

export interface VisibleAgentActivity {
    title: '当前响应' | '当前执行';
    kind: VisibleAgentActivityKind;
    agentId: string;
    agentLabel: string;
    detail?: string;
    source: 'initial' | 'skill_event' | 'teammate_event';
    userVisible: true;
    showAsThinking: false;
    isProviderThinking: false;
    canClaimModelReasoning: false;
}

const VISIBLE_TOOL_EVENT_KINDS = new Set<AgentStepEvent['kind']>([
    'tool_started',
    'tool_completed'
]);

export const isSkillWrapperToolEvent = (event: AgentStepEvent): boolean => {
    const title = String(event.title || '');
    return /^开始能力：|^能力完成：|^能力未完成：|^能力不可用：|^能力异常：/.test(title);
};

export const isTeammateWrapperToolEvent = (event: AgentStepEvent): boolean => {
    const title = String(event.title || '');
    return /^开始子 Agent：|^子 Agent 完成：|^子 Agent 失败：/.test(title);
};

function buildActivityBase(
    kind: VisibleAgentActivityKind,
    agentId: string,
    agentLabel: string,
    source: VisibleAgentActivity['source'],
    detail?: string,
    title: VisibleAgentActivity['title'] = '当前执行'
): VisibleAgentActivity {
    return {
        title,
        kind,
        agentId,
        agentLabel,
        detail,
        source,
        userVisible: true,
        showAsThinking: false,
        isProviderThinking: false,
        canClaimModelReasoning: false
    };
}

export function buildInitialVisibleAgentActivity(): VisibleAgentActivity {
    return buildActivityBase(
        'request',
        'current-request',
        'DesignEcho Agent',
        'initial',
        '已接收输入，正在确认对话或工具路径。',
        '当前响应'
    );
}

function extractSkillId(event: AgentStepEvent): string {
    const detail = String(event.detail || '').trim();
    const match = detail.match(/能力 ID:\s*([^\s]+)/);
    if (match?.[1]) return match[1];
    return String(event.toolName || '').trim();
}

function extractTeammateRole(event: AgentStepEvent): DesignTeammateRole | '' {
    const detail = String(event.detail || '').trim();
    const detailMatch = detail.match(/子 Agent role:\s*([^\s]+)/);
    if (detailMatch?.[1]) return detailMatch[1] as DesignTeammateRole;

    const toolName = String(event.toolName || '').trim();
    const toolMatch = toolName.match(/^delegateToAgent:([^\s]+)/);
    if (toolMatch?.[1]) return toolMatch[1] as DesignTeammateRole;

    return '';
}

function getVisibleSkillLabel(skillId: string, fallbackLabel: string): string {
    const skill = getSkillById(skillId);
    if (!skill) return fallbackLabel || skillId || 'Agent';
    if (skill.id === 'autonomous-agent') return 'Autonomous Agent';
    if (skill.visibility === 'user-facing') return skill.name;
    return fallbackLabel || skill.name || skill.id;
}

function getVisibleTeammateLabel(role: DesignTeammateRole, fallbackLabel: string): string {
    const definition = getDesignTeammateDefinition(role);
    return definition?.displayName || fallbackLabel || role || 'Design Teammate';
}

function buildVisibleTeammateActivityFromStepEvent(
    event: AgentStepEvent
): VisibleAgentActivity | null {
    const role = extractTeammateRole(event);
    if (!role) return null;

    const titleLabel = String(event.title || '')
        .replace(/^开始子 Agent：|^子 Agent 完成：|^子 Agent 失败：/, '')
        .trim();
    const label = getVisibleTeammateLabel(role, titleLabel);

    return buildActivityBase(
        'teammate',
        role,
        label,
        'teammate_event',
        event.detail
    );
}

export function buildVisibleAgentActivityFromStepEvent(
    event: AgentStepEvent
): VisibleAgentActivity | null {
    if (event && isTeammateWrapperToolEvent(event)) {
        return buildVisibleTeammateActivityFromStepEvent(event);
    }

    if (!event || !isSkillWrapperToolEvent(event)) return null;
    const skillId = extractSkillId(event);
    if (!skillId) return null;

    const titleLabel = String(event.title || '')
        .replace(/^开始能力：|^能力完成：|^能力未完成：|^能力不可用：|^能力异常：/, '')
        .trim();
    const kind: VisibleAgentActivityKind = skillId === 'autonomous-agent'
        ? 'autonomous_agent'
        : 'skill';
    const label = getVisibleSkillLabel(skillId, titleLabel);

    return buildActivityBase(kind, skillId, label, 'skill_event');
}

export const isVisibleAgentStepEvent = (event: AgentStepEvent): boolean => {
    return VISIBLE_TOOL_EVENT_KINDS.has(event.kind)
        && !isSkillWrapperToolEvent(event)
        && typeof event.toolName === 'string'
        && event.toolName.trim().length > 0;
};

export const formatAgentToolEventContent = (event: AgentStepEvent): string => {
    const toolName = String(event.toolName || '').trim();
    const info = getToolDisplayInfo(toolName);
    const detail = String(event.detail || '').trim();

    if (event.status === 'error') {
        return detail ? `执行 ${info.name}失败：${detail}` : `执行 ${info.name}失败`;
    }

    return `执行 ${info.name}`;
};

export const isVisiblePonderingStep = (step: VisibleStepLike): boolean => {
    const content = String(step.content || '').trim();
    if (step.type === 'thinking') {
        return canObservationEnterThinkingSteps(classifyAgentObservationChannel({
            source: 'model_visible_reasoning',
            content
        }));
    }
    if (step.type === 'tool_call' || step.type === 'tool_result') {
        return canObservationRenderAsToolCall(classifyAgentObservationChannel({
            source: step.type === 'tool_call' ? 'tool_call_started' : 'tool_call_completed',
            content,
            toolName: step.toolName
        }));
    }
    return false;
};
