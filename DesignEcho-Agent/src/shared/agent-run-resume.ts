/**
 * Run Record 续跑摘要（Harness v1 · H2）
 *
 * 把上一轮「未完成运行」的持久档案（H1 的 agent-run-record）变成新一轮可用的运行摘要，
 * 替代"从聊天历史反推"的消息考古，治真机病例：触上限/中断后下一轮从零重做全部读取动作。
 *
 * 设计原则（给模型机制、不替模型决策）：
 *  - 只挑「未完成形态」且「时间较近」的最新档案——完成了的运行不注入（无续做必要），
 *    过期档案不注入（画面早变了，旧状态会污染当前判断）。
 *  - 摘要明确声明：这是档案不是指令；若与本次任务相关，先低成本验证（listDocuments 等）
 *    再续做、只复用经核实仍有效的产物；若无关，忽略本节。相关性判断交给模型。
 *  - 纯逻辑无时钟：调用方传 nowMs；无档案/不适用时返回 applicable=false + 具体原因。
 */

import type { AgentRunConversationScope, AgentRunRecord } from './agent-run-record';
import { MAX_RUNTIME_ACTION_PLAN_STEPS } from './agent-runtime-v5/runtime-action-plan-declaration';
import type {
    RuntimeActionPlanResumeFreshness,
    RuntimeResumeCompletedStepDescriptor,
    RuntimeResumeContextAnchor
} from './agent-runtime-v5/runtime-action-plan-resume-freshness';

/** 视为「未完成、值得续做」的停机形态。final_response+success 的完整收尾不在此列。 */
const UNFINISHED_STOP_REASONS = new Set([
    'max_iterations',
    // 预算耗尽（判断次数/工具/时间）同属「未完成、值得续做」——与 max_iterations 拆分后必须一并纳入，
    // 否则预算停机的运行不再被视为可续跑（回归）。
    'performance_budget',
    'tool_budget',
    'no_progress',
    'awaiting_user_confirmation',
    // 已把问题说清楚在等用户回答——同属「未完成、值得续做」。
    'awaiting_user_input',
    'tool_preflight_blocked'
]);

export interface BuildRunResumeBriefInput {
    records: AgentRunRecord[] | null | undefined;
    /** 当前毫秒时间戳（调用方传入，本模块不取时钟） */
    nowMs: number;
    /** 档案最大可用年龄；默认 6 小时——更旧的画面/文档状态大概率已变 */
    maxAgeMs?: number;
    maxBriefChars?: number;
    /**
     * 确认卡/结构化续跑携带的精确来源 run。提供后不得回退到“最新一条”其他档案，
     * 防止相邻任务串线。
     */
    preferredSourceRunId?: string;
    /**
     * 当前活动消息树分支。普通自动恢复必须与档案完全一致；编辑重发产生新 branchId，
     * 因而不会把被撤回分支的未完成运行带回来。
     */
    conversationScope?: AgentRunConversationScope;
    /** 两阶段调用：第一次选候选，完成只读 probe 后第二次带入裁决生成最终摘要。 */
    freshness?: RuntimeActionPlanResumeFreshness;
}

export interface RunResumeFreshnessCandidate {
    sourceRunId: string;
    sourceSessionId?: string;
    sourceGeneration?: number;
    sourceSkillId?: string;
    sourceTaskType?: string;
    contextAnchor?: RuntimeResumeContextAnchor;
    completedStepIds: string[];
    completedStepDescriptors: RuntimeResumeCompletedStepDescriptor[];
    resumeStepIds: string[];
}

export interface RunResumeBrief {
    applicable: boolean;
    reason: string;
    sourceRunId?: string;
    sourceSessionId?: string;
    sourceGeneration?: number;
    freshnessCandidate?: RunResumeFreshnessCandidate;
    /** 注入系统提示的完整摘要节（含边界声明与验证优先指令） */
    brief?: string;
}

const DEFAULT_MAX_AGE_MS = 6 * 60 * 60 * 1000;
// 1200→1800：摘要新增「上次做到」（≤600 字的画面事实），不能把尾部的续接指引挤掉。
const DEFAULT_MAX_BRIEF_CHARS = 1800;

function isUnfinishedRun(record: AgentRunRecord): boolean {
    if (record.cancelled === true) return true;
    if (record.success !== true) return true;
    return UNFINISHED_STOP_REASONS.has(String(record.stopReason || ''));
}

function parseEndedAtMs(record: AgentRunRecord): number | undefined {
    const ms = Date.parse(String(record.endedAt || ''));
    return Number.isFinite(ms) ? ms : undefined;
}

function formatAge(ageMs: number): string {
    const minutes = Math.round(ageMs / 60000);
    if (minutes < 60) return `${Math.max(1, minutes)} 分钟前`;
    const hours = Math.floor(minutes / 60);
    return `${hours} 小时 ${minutes % 60} 分钟前`;
}

function describeStop(record: AgentRunRecord): string {
    if (record.cancelled === true) return '用户取消';
    switch (record.stopReason) {
        case 'max_iterations': return '达到本轮处理上限';
        case 'performance_budget': return '达到本轮预算上限（判断次数/时间）';
        case 'tool_budget': return '达到工具调用预算';
        case 'no_progress': return '检测到无进展';
        case 'awaiting_user_confirmation': return '停在用户确认点';
        case 'awaiting_user_input': return '等用户回答缺失信息';
        case 'tool_preflight_blocked': return '工具预检拦截';
        default: return record.success === true ? '正常收尾' : `未完成（${record.stopReason || '原因未记录'}）`;
    }
}

function matchesConversationScope(
    record: AgentRunRecord,
    currentScope: AgentRunConversationScope | undefined
): boolean {
    if (!currentScope || !record.conversationScope) return false;
    return record.conversationScope.conversationId === currentScope.conversationId
        && record.conversationScope.branchId === currentScope.branchId;
}

export function buildRunRecordResumeBrief(input: BuildRunResumeBriefInput): RunResumeBrief {
    const records = Array.isArray(input.records) ? input.records : [];
    if (records.length === 0) {
        return { applicable: false, reason: '没有可用的运行档案' };
    }
    const maxAgeMs = input.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    const maxBriefChars = input.maxBriefChars ?? DEFAULT_MAX_BRIEF_CHARS;
    const preferredSourceRunId = String(input.preferredSourceRunId || '').trim();
    const currentConversationScope = input.conversationScope;

    if (!preferredSourceRunId && !currentConversationScope) {
        return {
            applicable: false,
            reason: '当前请求缺少会话分支身份，不自动采用项目里的旧运行档案'
        };
    }

    // 只看未完成形态；按 endedAt 取最新；时间不可解析的档案不采用（诚实跳过）
    const candidates = records
        .filter((record) => record && record.version === 'agent-run-record/v0' && isUnfinishedRun(record))
        .filter((record) => {
            if (preferredSourceRunId) {
                if (record.runId !== preferredSourceRunId) return false;
                // 历史精确续跑记录没有分支字段时仍由既有结构化 sourceRunId/消息归属闸门承接；
                // 新记录一旦有分支身份，就不能跨分支恢复。
                return !record.conversationScope
                    || !currentConversationScope
                    || matchesConversationScope(record, currentConversationScope);
            }
            return matchesConversationScope(record, currentConversationScope);
        })
        .map((record) => ({ record, endedMs: parseEndedAtMs(record) }))
        .filter((item): item is { record: AgentRunRecord; endedMs: number } => item.endedMs !== undefined)
        .sort((a, b) => b.endedMs - a.endedMs);

    if (candidates.length === 0) {
        if (preferredSourceRunId) {
            return {
                applicable: false,
                reason: `指定的来源运行 ${preferredSourceRunId} 没有当前分支可续接的未完成档案；不会改用其他任务档案`
            };
        }
        return { applicable: false, reason: '当前会话分支没有未完成运行；不会采用其他对话或旧编辑分支的档案' };
    }
    const { record, endedMs } = candidates[0];
    const ageMs = input.nowMs - endedMs;
    if (!Number.isFinite(ageMs) || ageMs < 0) {
        return { applicable: false, reason: '档案时间异常（晚于当前时间），不采用' };
    }
    if (ageMs > maxAgeMs) {
        return { applicable: false, reason: `最近的未完成运行已过期（${formatAge(ageMs)}），画面状态大概率已变化，不注入旧上下文` };
    }

    // 运行档案继续保留完整计数、阶段、对账与身份；给设计模型的续接摘要只描述
    // 可继续使用的画面内容和下一步，不把后台记录系统搬进设计思考。
    const reusableWork: string[] = [];
    if (record.checkpoint.documentCreated) reusableWork.push('已经建立了目标文档');
    if (record.checkpoint.layoutRendered) reusableWork.push('已经有一版可编辑排版');
    const placedLayers = record.checkpoint.placedLayers || [];
    if (placedLayers.length > 0) {
        const namedLayers = placedLayers
            .slice(0, 4)
            .map((layer) => String(layer.name || '').trim())
            .filter(Boolean);
        reusableWork.push(namedLayers.length > 0
            ? `已经置入这些素材：${namedLayers.join('、')}`
            : '已经置入了项目素材');
    }

    const freshness = input.freshness?.sourceRunId === record.runId
        ? input.freshness
        : undefined;
    const priorDirection = String(record.designStrategy?.primaryGoal || '').trim();
    const priorMissingInputs = record.designBrief?.readiness === 'needs_input'
        ? Array.from(new Set([
            ...record.designBrief.missingRequiredInputKeys,
            ...record.designBrief.assumedRequiredInputKeys
        ].map((item) => String(item || '').trim()).filter(Boolean))).slice(0, 6)
        : [];
    const priorFindings = (record.checkpoint.readFindings || [])
        .slice(0, 4)
        .map((item) => String(item || '')
            .replace(/^[A-Za-z][A-Za-z0-9]*\s*[:：]\s*/u, '')
            .trim())
        .filter(Boolean);
    const waitingForUser = record.stopReason === 'awaiting_user_confirmation'
        || record.stopReason === 'awaiting_user_input';
    const priorDesignSummary = String(record.checkpoint.designSummary || '').trim();
    const lines = [
        '这是同一项设计的续接信息，不是新的用户要求。',
        `原目标：${record.goal || '继续完成当前设计'}`,
        ...(priorDirection ? [`沿用的设计方向：${priorDirection}`] : []),
        ...(priorDesignSummary ? [`上次做到：${priorDesignSummary}`] : []),
        ...(reusableWork.length > 0
            ? [`已经可以继续使用：${reusableWork.join('；')}。不要重新创建或重复置入。`]
            : []),
        ...(priorFindings.length > 0
            ? [`上次已经看到：${priorFindings.join('；')}。只在相关内容可能已变化时复查。`]
            : []),
        ...(priorMissingInputs.length > 0
            ? [`上次还缺少这些会影响设计的信息：${priorMissingInputs.join('、')}。先从当前项目和画面中确认；确实无法判断时再问用户。`]
            : []),
        '',
        freshness?.status === 'verified'
            ? '当前内容与上次保留的位置一致，直接从尚未完成的部分继续。'
            : '先只查看会影响下一步的目标文档和当前画面，确认已有内容仍在后继续；上次标记为完成的内容没有确认仍然有效，不能据此跳过当前需要的制作，也不要重新扫描整个项目。',
        waitingForUser
            ? '上次停在等待用户选择的位置；如果用户这次没有补充该选择，不要替用户决定不可逆事项。'
            : '保留已有设计，只调整当前最重要的未完成部分。',
        '如果本次任务与档案无关：忽略本节，正常开始。'
    ];
    const brief = lines.join('\n').slice(0, maxBriefChars);

    return {
        applicable: true,
        reason: `采用 ${formatAge(ageMs)} 的未完成运行档案（${describeStop(record)}）`,
        sourceRunId: record.runId,
        ...(record.runtimeSession ? {
            sourceSessionId: record.runtimeSession.sessionId,
            sourceGeneration: record.runtimeSession.generation
        } : {}),
        ...(record.actionPlanReconciliation ? {
            freshnessCandidate: {
                sourceRunId: record.runId,
                ...(record.runtimeSession ? {
                    sourceSessionId: record.runtimeSession.sessionId,
                    sourceGeneration: record.runtimeSession.generation,
                    sourceSkillId: record.runtimeSession.skillId,
                    sourceTaskType: record.runtimeSession.taskType
                } : {}),
                ...(record.contextAnchor ? { contextAnchor: record.contextAnchor } : {}),
                completedStepIds: record.actionPlanReconciliation.completedStepIds.slice(
                    0,
                    MAX_RUNTIME_ACTION_PLAN_STEPS
                ),
                completedStepDescriptors: (
                    record.actionPlanReconciliation.completedStepDescriptors || []
                ).slice(0, MAX_RUNTIME_ACTION_PLAN_STEPS),
                resumeStepIds: record.actionPlanReconciliation.resumeStepIds.slice(
                    0,
                    MAX_RUNTIME_ACTION_PLAN_STEPS
                )
            }
        } : {}),
        brief
    };
}
