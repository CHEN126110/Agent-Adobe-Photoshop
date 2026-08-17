/**
 * 最终摘要纯逻辑（agent.ts 拆分批次 2）：静默收尾时从结构化状态 / 工具结果重建
 * 用户可读成果，以及「结束语太薄需要补写」的判定。只做纯计算，不调模型、不写消息历史。
 */

import { sanitizeUserVisibleAgentText } from '../../../shared/chat-response-cleaner';
import { isBareAgentCompletionClaim } from '../../../shared/agent-runtime-liveness-policy';
import { buildObservedDesignDraftSummary } from '../agent-policies/design-task-policy';
import type { AgentToolCallLogEntry } from './types';

/**
 * 模型把结构化成果写进 updateDesignProjectState 后沉默时，从其调用参数重建用户可读成果。
 * 不依赖模型再次发声，确保已产生的成果能展示。
 */
export function buildSummaryFromStatefulWrites(toolCallLog: AgentToolCallLogEntry[]): string {
    const STATE_FIELD_LABELS: Record<string, string> = {
        targetUser: '目标人群',
        painPoints: '用户痛点',
        sellingPoints: '核心卖点',
        copywriting: '文案方向',
        visualDirection: '视觉方向',
        layoutPlan: '版式与分屏规划',
        reviewResult: '方案小结'
    };
    const lastWrite = [...toolCallLog].reverse().find((entry) =>
        entry.name === 'updateDesignProjectState'
        && entry.result?.success !== false
        && entry.arguments?.set
        && typeof entry.arguments.set === 'object');
    if (!lastWrite) return '';
    const set = lastWrite.arguments.set as Record<string, unknown>;
    const parts: string[] = [];
    for (const [key, label] of Object.entries(STATE_FIELD_LABELS)) {
        const value = set[key];
        if (value === undefined || value === null || value === '') continue;
        const rendered = Array.isArray(value)
            ? value.map((item, index) => `${index + 1}. ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n')
            : String(value);
        parts.push(`### ${label}\n${rendered}`);
    }
    if (parts.length === 0) return '';
    return ['已完成设计方向，要点如下：', '', ...parts].join('\n\n');
}

export function readOutputPathFromToolResult(result: any): string {
    if (!result || typeof result !== 'object') return '';
    const data = result.data && typeof result.data === 'object' ? result.data : {};
    const output = result.output && typeof result.output === 'object' ? result.output : {};
    const candidates = [
        result.filePath,
        result.savedPath,
        result.outputPath,
        result.path,
        data.filePath,
        data.savedPath,
        data.outputPath,
        data.path,
        output.filePath,
        output.savedPath,
        output.outputPath,
        output.path
    ];
    const found = candidates.find((item) => typeof item === 'string' && item.trim());
    return found ? String(found).trim() : '';
}

export function buildToolResultFallbackMessage(input: {
    toolCallLog: AgentToolCallLogEntry[];
    hasObservedTaskMutation: boolean;
    hasSuccessfulSaveExport: boolean;
}): string {
    const stateSummary = buildSummaryFromStatefulWrites(input.toolCallLog)
        || buildObservedDesignDraftSummary(input.toolCallLog);
    const outputPaths = Array.from(new Set(input.toolCallLog
        .map((entry) => readOutputPathFromToolResult(entry.result))
        .filter(Boolean)))
        .slice(0, 3);
    const hasViewableResult = input.hasObservedTaskMutation || input.hasSuccessfulSaveExport;
    const resultSummary = hasViewableResult
        ? '当前画面已经有修改，但这次没有形成完整的设计说明。请先看当前版本，后续可以从这里继续调整。'
        : '这次还没有做出可以看的设计版本，停在了制作开始前。';

    return [
        stateSummary,
        resultSummary,
        outputPaths.length > 0 ? `已保存的内容：${outputPaths.join('；')}` : ''
    ].filter(Boolean).join('\n\n');
}

export function shouldRequestRicherFinalSummary(input: {
    message: string;
    hasTaskProgressToolCalls: boolean;
    allowProviderThinking: boolean | undefined;
    toolScope: string | undefined;
}): boolean {
    if (!input.hasTaskProgressToolCalls) return false;
    const text = sanitizeUserVisibleAgentText(String(input.message || '')).trim();
    if (!text) return true;
    if (input.allowProviderThinking === false) return false;
    if (input.toolScope === 'read_only') {
        return isBareAgentCompletionClaim(text);
    }
    if (text.length < 36) return true;
    const mentionsResult = /(观察|看到|复核|检查|变化|画面|图层|快照|导出|文件|结果|需要|建议)/.test(text);
    const mentionsAction = /(已|已经|完成|创建|调整|修改|生成|读取|整理|保存|导出|处理)/.test(text);
    return !(mentionsResult && mentionsAction);
}
