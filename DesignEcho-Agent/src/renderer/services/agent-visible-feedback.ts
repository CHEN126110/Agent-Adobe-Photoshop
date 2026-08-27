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
import {
    sanitizeUserVisibleDiagnosticText,
    sanitizeUserVisibleThinkingText
} from '../../shared/chat-response-cleaner';

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

export type VisibleAgentRunPhase =
    | 'context_loading'
    | 'agent_processing';

export interface VisibleAgentActivity {
    kind: VisibleAgentActivityKind;
    agentId: string;
    agentLabel: string;
    detail?: string;
    source: 'initial' | 'run_phase' | 'skill_event' | 'teammate_event' | 'progress_event' | 'model_turn';
    userVisible: true;
    showAsThinking: false;
    isProviderThinking: false;
    canClaimModelReasoning: false;
    /**
     * 活动开始时间（ms）。模型回合真机常跑 40–110 秒（带图更久），界面只有一句静态话时用户会以为
     * 卡死；有了起点，界面可以显示「已 23 秒」让等待可感知。只对模型回合设置。
     */
    startedAt?: number;
}

const VISIBLE_TOOL_EVENT_KINDS = new Set<AgentStepEvent['kind']>([
    'tool_started',
    'tool_completed'
]);

const VISIBLE_PROCESS_EVENT_KINDS = new Set<AgentStepEvent['kind']>([
    'observation',
    'verification',
    'warning',
    'finalizing'
]);

// 模型请求/响应、任务开始、工具计划（model_request/model_response/task_started/
// tool_planned）属于 Agent 内部流程播报，不作为用户可见步骤——它们会和「工具执行行」
// 以及模型自己的思考正文重复，把真正有价值的内容淹没成满屏「观察」噪音。
// 用户侧的进度由：实时活动摘要 + 模型公开思考正文 + 工具执行行共同表达。
// 该收敛同时是 smoke-chat-ui-execution-chain 的可见性契约（不得暴露 model_request/response）。

const DESIGNER_VISIBLE_ACTIVITY_ID = 'design-assistant';
const DESIGNER_VISIBLE_ACTIVITY_LABEL = '设计助手';
const VISIBLE_AGENT_RUN_PHASE_DETAIL: Record<VisibleAgentRunPhase, string> = {
    context_loading: '正在理解你的需求和当前可用内容。',
    agent_processing: '设计助手正在根据需求决定下一步。'
};

function looksLikeEngineeringRuntimeProcessText(value: string): boolean {
    return /(?:\b(?:Provider|Harness|Runtime|system prompt|tool call|debug|route|gate|token)\b|后台续接|输出截断|第\s*\d+\s*轮|成功\s*\d+\s*项|失败\s*\d+\s*项|\b(?:request|declare|update|get)[A-Z][A-Za-z0-9]+\b)/iu.test(value);
}

function canRenderStepAsUserFacing(event: AgentStepEvent): boolean {
    // 事件来源不等于展示授权。模型提出 Tool、执行器记录 Tool 或运行时记录失败，
    // 都先进入真实运行记录；只有事件生产者显式声明用户过程投影时才进入普通界面。
    if (event.audience !== 'user' || event.visibility !== 'user_process') return false;
    return VISIBLE_PROCESS_EVENT_KINDS.has(event.kind)
        || VISIBLE_TOOL_EVENT_KINDS.has(event.kind);
}

export const isSkillWrapperToolEvent = (event: AgentStepEvent): boolean => {
    const title = String(event.title || '');
    return /^开始能力：|^能力完成：|^能力已执行：|^能力部分完成：|^能力待复核：|^能力待确认：|^能力受阻：|^能力失败：|^能力已停止：|^能力未完成：|^能力不可用：|^能力异常：/.test(title);
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
    detail?: string
): VisibleAgentActivity {
    const safeDetail = detail
        ? sanitizeUserVisibleDiagnosticText(String(detail).trim())
        : undefined;
    return {
        kind,
        agentId,
        agentLabel,
        detail: safeDetail || undefined,
        source,
        userVisible: true,
        showAsThinking: false,
        isProviderThinking: false,
        canClaimModelReasoning: false
    };
}

export function buildVisibleAgentActivityFromRunPhase(
    phase: VisibleAgentRunPhase,
    current?: VisibleAgentActivity | null
): VisibleAgentActivity {
    return buildActivityBase(
        current?.kind || 'request',
        current?.agentId || DESIGNER_VISIBLE_ACTIVITY_ID,
        current?.agentLabel || DESIGNER_VISIBLE_ACTIVITY_LABEL,
        'run_phase',
        VISIBLE_AGENT_RUN_PHASE_DETAIL[phase]
    );
}

export function buildVisibleAgentActivityFromProgress(
    message: string,
    current?: VisibleAgentActivity | null
): VisibleAgentActivity | null {
    const rawDetail = sanitizeUserVisibleDiagnosticText(String(message || '').trim());
    if (!rawDetail) return null;

    // onProgress 同时承担运行日志与普通界面的活动摘要。循环计数、代际、成本账本等
    // 仍按原值进入日志，但不能因为经过这个兼容回调就旁路成为用户进度。
    if (/^处理进度\s*\d+\s*\/\s*\d+$/u.test(rawDetail)) return null;
    if (looksLikeEngineeringRuntimeProcessText(rawDetail)) return null;

    const skillProgress = rawDetail.match(/^执行能力：(.+)$/u)
        || rawDetail.match(/^正在执行「(.+)」[。.]?$/u);
    if (skillProgress?.[1]) {
        return buildActivityBase(
            current?.kind || 'request',
            current?.agentId || DESIGNER_VISIBLE_ACTIVITY_ID,
            current?.agentLabel || DESIGNER_VISIBLE_ACTIVITY_LABEL,
            'progress_event',
            `正在按「${skillProgress[1].trim()}」的方法处理`
        );
    }

    let detail = rawDetail;
    if (/达到最大迭代次数|已达最大轮数/u.test(rawDetail)) {
        detail = '这轮先停在这里，当前进度已经保留。';
    } else if (/检测到重复或失败循环/u.test(rawDetail)) {
        detail = '没有找到可靠的继续方式，当前进度已经保留。';
    } else if (/\b(?:Runtime|TaskRun|Artifact|Reflexion|generation)\b|成本账本|代际重读|运行档案|新鲜度：/iu.test(rawDetail)) {
        return null;
    } else if (/^开始处理[.。…]*$/u.test(rawDetail)) {
        detail = '正在理解需求和当前素材';
    }

    if (!detail) return null;

    return buildActivityBase(
        current?.kind || 'request',
        current?.agentId || DESIGNER_VISIBLE_ACTIVITY_ID,
        current?.agentLabel || DESIGNER_VISIBLE_ACTIVITY_LABEL,
        'progress_event',
        detail
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

function getVisibleSkillIdentity(skillId: string, fallbackLabel: string): { agentId: string; label: string } {
    const skill = getSkillById(skillId);
    if (!skill || skill.visibility !== 'user-facing') {
        return {
            agentId: DESIGNER_VISIBLE_ACTIVITY_ID,
            label: DESIGNER_VISIBLE_ACTIVITY_LABEL
        };
    }
    return {
        agentId: skill.id || skillId || DESIGNER_VISIBLE_ACTIVITY_ID,
        // displayName 才是给人看的中文名；name 是英文内部标识（'E-commerce Socks Design'…）。
        // 真机：用户发出需求后，对话里第一行活动标签直接显示英文技能名。
        // 下方 getVisibleTeammateLabel 早已用 displayName，此处口径本就该一致。
        label: String(skill.displayName || '').trim()
            || fallbackLabel
            || DESIGNER_VISIBLE_ACTIVITY_LABEL
    };
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

/**
 * 模型回合的实时活动（用户要求 2026-08-17：「看图那一下别让人以为卡住了，我想看到它在想什么做什么」）。
 * model_request 事件不进入持久步骤流（那是噪音），但它是唯一能表达「现在轮到模型在想」的信号，
 * 因此只投影成**实时活动摘要**（带起始时间，界面可显示已等待秒数），模型一回话就被后续事件替换。
 */
export function buildVisibleAgentActivityFromModelTurnEvent(
    event: AgentStepEvent
): VisibleAgentActivity | null {
    if (!event || event.kind !== 'model_request' || event.audience !== 'user') return null;
    const detail = String(event.detail || event.title || '').trim();
    if (!detail) return null;
    return {
        ...buildActivityBase(
            'autonomous_agent',
            DESIGNER_VISIBLE_ACTIVITY_ID,
            DESIGNER_VISIBLE_ACTIVITY_LABEL,
            'model_turn',
            detail
        ),
        startedAt: Date.now()
    };
}

export function isModelTurnFinishedEvent(event: AgentStepEvent): boolean {
    return Boolean(event) && event.kind === 'model_response';
}

export function buildVisibleAgentActivityFromStepEvent(
    event: AgentStepEvent
): VisibleAgentActivity | null {
    // 包装事件也必须和普通过程事件经过同一份显式展示授权。过去 Skill registry
    // 未声明 audience / visibility 的内部事件仍会走到这里，导致能力 ID 和原始摘要
    // 直接覆盖用户活动提示。
    if (!event || !canRenderStepAsUserFacing(event)) return null;

    if (isTeammateWrapperToolEvent(event)) {
        return buildVisibleTeammateActivityFromStepEvent(event);
    }

    if (!isSkillWrapperToolEvent(event)) return null;
    const skillId = extractSkillId(event);
    if (!skillId) return null;

    const titleLabel = String(event.title || '')
        .replace(/^开始能力：|^能力完成：|^能力已执行：|^能力部分完成：|^能力待复核：|^能力待确认：|^能力受阻：|^能力失败：|^能力已停止：|^能力未完成：|^能力不可用：|^能力异常：/, '')
        .trim();
    const kind: VisibleAgentActivityKind = skillId === 'autonomous-agent'
        ? 'autonomous_agent'
        : 'skill';
    const identity = getVisibleSkillIdentity(skillId, titleLabel);

    const activityDetail = String(event.detail || '')
        .replace(/(?:^|\n)\s*能力 ID:\s*[^\s\n]+\s*(?=\n|$)/giu, '')
        .trim()
        || titleLabel
        || undefined;

    return buildActivityBase(kind, identity.agentId, identity.label, 'skill_event', activityDetail);
}

export const isVisibleAgentStepEvent = (event: AgentStepEvent): boolean => {
    return canRenderStepAsUserFacing(event)
        && VISIBLE_TOOL_EVENT_KINDS.has(event.kind)
        && !isSkillWrapperToolEvent(event)
        && typeof event.toolName === 'string'
        && event.toolName.trim().length > 0;
};

export type AgentToolCompletionStepDisposition =
    | 'visible'
    | 'settle_started_step'
    | 'ignore';

/**
 * Tool 开始事件可以在普通过程区显示，但一次动作随后可能进入 Workflow 交接、等待用户
 * 或可恢复失败。后者已经由动作 disposition 投影为 Debug completion，不是任务终态。
 * UI 应收束对应的进行中行，不能把它遗留到整轮结束后再按 result.success 猜成红/绿。
 */
export function resolveAgentToolCompletionStepDisposition(
    event: AgentStepEvent
): AgentToolCompletionStepDisposition {
    if (event.kind !== 'tool_completed') return 'ignore';
    if (isVisibleAgentStepEvent(event)) return 'visible';
    if (event.audience !== 'debug'
        || typeof event.toolName !== 'string'
        || !event.toolName.trim()
        // 取消是整轮真实终态；保留进行中步骤，交给 stopped 结算显示用户停在哪里。
        || String(event.issue || '').trim() === 'cancelled') {
        return 'ignore';
    }
    return 'settle_started_step';
}

export const isVisibleAgentProcessEvent = (event: AgentStepEvent): boolean => {
    return canRenderStepAsUserFacing(event)
        && VISIBLE_PROCESS_EVENT_KINDS.has(event.kind)
        && !isSkillWrapperToolEvent(event)
        && !isTeammateWrapperToolEvent(event)
        && typeof event.title === 'string'
        && event.title.trim().length > 0;
};

export const getVisibleAgentProcessStepType = (
    event: AgentStepEvent
): 'status' | 'decision' | 'analyzing' => {
    if (event.kind === 'verification') return 'decision';
    if (event.kind === 'warning' || event.kind === 'finalizing') return 'status';
    // observation 等观察类作为 'analyzing'（观察角色）展示。
    return 'analyzing';
};

function buildDesignerFacingProcessFallback(event: AgentStepEvent): string {
    if (event.status === 'error') {
        return '当前处理条件还不完整，暂时不能确认画面结果。';
    }
    if (event.kind === 'verification') {
        return '正在复核画面是否符合设计目标。';
    }
    return '正在结合现有素材和画面结果调整设计判断。';
}

export const formatAgentProcessEventContent = (event: AgentStepEvent): string => {
    const title = sanitizeUserVisibleDiagnosticText(String(event.title || '').trim());
    const detail = sanitizeUserVisibleDiagnosticText(String(event.detail || '').trim());
    const content = [title, detail]
        .filter(Boolean)
        .filter((item, index, list) => list.indexOf(item) === index)
        .join('：');

    if (looksLikeEngineeringRuntimeProcessText(content)) {
        return buildDesignerFacingProcessFallback(event);
    }

    return content
        .replace(/并行执行/g, '同时检查')
        .replace(/只读操作/g, '检查步骤')
        .replace(/工具调用/g, '画面处理')
        .replace(/工具/g, '处理')
        .replace(/模型/g, '设计助手');
};

/**
 * 过程流里一条动作显示成什么字。
 *
 * 规则：文字只说「做了什么」，不说「做到哪一步了」——状态由左侧时间线节点表达
 * （空心点 = 完成、旋转环 = 进行中、红点 = 失败），文字再说一遍就是重复。
 *
 * 这条规则不是排版偏好，是在修一类必然出现的 bug：旧版拼 `已${工具名}` / `${工具名}中`，
 * 而工具名表里动宾短语（「变换图层」）和名词短语（「任务卡打勾」「学到了什么」）混着，
 * 前缀能不能加取决于名字的词性——于是真机截出了「已任务卡打勾」「已学到了什么」。
 * 名字有 200 多个，逐条改名只是把问题推后；让文字不再承担状态，这类错就一次消失。
 *
 * 显式公开的动作错误是唯一例外：它要说明本次动作遇到的具体问题，但不能越级宣判
 * 整个任务“未完成”。可恢复失败、Workflow 交接和等待用户已在上游 disposition 中转为
 * Debug completion，不会经过这个格式化分支。
 */
export const formatAgentToolEventContent = (event: AgentStepEvent): string => {
    const toolName = String(event.toolName || '').trim();
    const info = getToolDisplayInfo(toolName);
    if (toolName === 'providerNativeWebSearch') {
        const detail = sanitizeUserVisibleDiagnosticText(String(event.detail || '').trim());
        if (detail) return detail;
    }

    if (event.status === 'error') {
        const detail = sanitizeUserVisibleDiagnosticText(String(event.detail || '').trim());
        if (detail && !looksLikeEngineeringRuntimeProcessText(detail)) {
            return `${info.name}：${detail}`;
        }
        return `${info.name}遇到问题`;
    }

    if (event.status === 'running' || event.status === 'pending') {
        return `${info.name}…`;
    }
    return info.name;
};

export const isVisiblePonderingStep = (step: VisibleStepLike): boolean => {
    const content = String(step.content || '').trim();
    if (step.type === 'thinking') {
        const visibleThinking = sanitizeUserVisibleThinkingText(content);
        if (!visibleThinking) return false;
        return canObservationEnterThinkingSteps(classifyAgentObservationChannel({
            source: 'model_visible_reasoning',
            content: visibleThinking
        }));
    }
    if (step.type === 'tool_call' || step.type === 'tool_result') {
        return canObservationRenderAsToolCall(classifyAgentObservationChannel({
            source: step.type === 'tool_call' ? 'tool_call_started' : 'tool_call_completed',
            content,
            toolName: step.toolName
        }));
    }
    if (step.type === 'status'
        || step.type === 'decision'
        || step.type === 'reading'
        || step.type === 'exploring'
        || step.type === 'analyzing') {
        return sanitizeUserVisibleDiagnosticText(content).length > 0;
    }
    return false;
};
