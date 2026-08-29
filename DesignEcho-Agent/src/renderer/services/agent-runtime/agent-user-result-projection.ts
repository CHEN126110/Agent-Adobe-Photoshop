import { buildAgentOperationLedger } from '../../../shared/agent-operation-ledger';
import {
    classifyAgentToolExecution,
    isAgentHarnessControlTool
} from '../../../shared/agent-tool-execution-preflight';
import { isDesignDisciplineMutationTool } from '../../../shared/design-discipline-runtime';
import { findObservedPhotoshopMutationProof } from '../../../shared/photoshop-history-state-ref';
import type { AgentExecutionSummary, AgentToolCallLogEntry } from './types';

export interface UserResultProjection {
    title: string;
    summary: string;
    nextStep: string;
    detail: string;
    message: string;
}

export interface AgentUserResultFacts {
    hasViewableDesignChange: boolean;
    hasWorkspacePreparation: boolean;
    hasSavedOrExportedFile: boolean;
    hasGeneratedAsset: boolean;
}

/** 从同一原子 operation ledger 投影用户结果事实；不读取助手措辞，也不决定完成状态。 */
export function deriveAgentUserResultFacts(
    toolCallLog: readonly AgentToolCallLogEntry[]
): AgentUserResultFacts {
    const operations = buildAgentOperationLedger(toolCallLog).filter((entry) => (
        entry.operationLedgerProvenance.role !== 'workflow_envelope'
        && !isAgentHarnessControlTool(entry.name)
    ));
    const observedMutations = operations.filter((entry) => (
        Boolean(findObservedPhotoshopMutationProof(entry.result))
    ));
    const hasViewableDesignChange = observedMutations.some((entry) => (
        isDesignDisciplineMutationTool(entry.name)
    ));
    const hasSuccessfulActivity = (kind: 'save_export' | 'external_generation'): boolean => (
        operations.some((entry) => (
            entry.succeeded !== false
            && classifyAgentToolExecution(entry.name, entry.arguments) === kind
        ))
    );
    return {
        hasViewableDesignChange,
        hasWorkspacePreparation: !hasViewableDesignChange
            && observedMutations.some((entry) => entry.name === 'createDocument'),
        hasSavedOrExportedFile: hasSuccessfulActivity('save_export'),
        hasGeneratedAsset: hasSuccessfulActivity('external_generation')
    };
}

export function buildAgentUserResultProjectionFromToolLog(input: {
    summary: AgentExecutionSummary;
    toolCallLog: readonly AgentToolCallLogEntry[];
}): UserResultProjection {
    const facts = deriveAgentUserResultFacts(input.toolCallLog);
    return buildAgentUserResultProjection({
        summary: input.summary,
        ...facts,
        hasViewedLatestVersion: Number(input.summary.successfulObservationCalls || 0) > 0,
        hasObservedContext: Number(input.summary.observedToolCallCount || 0) > 0
    });
}

/**
 * 将结构化终态投影成设计师口吻。只消费已由 Runtime 验真的事实，既不决定
 * 完成状态，也不把尝试级失败、工具计数或内部恢复指令暴露给用户。
 */
export function buildAgentUserResultProjection(input: {
    summary: AgentExecutionSummary;
    hasViewableDesignChange: boolean;
    hasWorkspacePreparation: boolean;
    hasSavedOrExportedFile: boolean;
    hasGeneratedAsset: boolean;
    hasViewedLatestVersion: boolean;
    hasObservedContext: boolean;
}): UserResultProjection {
    const { summary } = input;
    const hasViewableVersion = input.hasViewableDesignChange || input.hasSavedOrExportedFile;
    const awaitingInteractiveConfirmation = summary.stopReason === 'awaiting_user_confirmation';
    const awaitingUserInput = summary.stopReason === 'awaiting_user_input';

    let outcome: string;
    if (input.hasViewableDesignChange && input.hasSavedOrExportedFile) {
        outcome = '本轮已经完成实际画面或结构调整，并保存或导出了文件。';
    } else if (input.hasViewableDesignChange) {
        outcome = '本轮已经在 Photoshop 中做出实际画面或结构调整。';
    } else if (input.hasSavedOrExportedFile) {
        outcome = '本轮已经保存或导出当前文件。';
    } else if (input.hasGeneratedAsset) {
        outcome = '本轮已经生成可用于后续制作的设计素材。';
    } else if (input.hasWorkspacePreparation) {
        outcome = '本轮已经建立目标画布，但还没有形成设计内容。';
    } else if (input.hasObservedContext) {
        outcome = '本轮已经查看项目素材和当前画面，还没有开始实际制作。';
    } else {
        outcome = '本轮还没有生成设计结果。';
    }

    let versionState: string;
    if (input.hasViewableDesignChange && input.hasViewedLatestVersion) {
        versionState = '当前版本：已经看过修改后的画面，可以直接查看。';
    } else if (input.hasViewableDesignChange) {
        versionState = '当前版本：已经有实际改动，可以先看；我还需要查看修改后的画面。';
    } else if (input.hasSavedOrExportedFile) {
        versionState = '当前文件：已经保存或导出，可以直接查看。';
    } else if (input.hasGeneratedAsset) {
        versionState = '当前状态：已有设计素材，但还没有形成 Photoshop 版本。';
    } else {
        versionState = '当前状态：还没有可看的设计版本。';
    }

    let nextAction = '';
    if (awaitingInteractiveConfirmation) {
        nextAction = '需要你选择：请在上方卡片中确认；确认后会从当前状态继续。';
    } else if (awaitingUserInput) {
        nextAction = '需要你回答上面的问题；收到后会从当前状态继续。';
    } else if (summary.status === 'cancelled') {
        nextAction = '下一步：需要继续时，从当前状态接着制作。';
    } else if (summary.status !== 'completed') {
        const unresolvedNoChange = summary.completionBlockingNoDocumentChangeRisks
            ?? summary.noDocumentChangeRisks;
        if (summary.downgradedByObservationGate
            || (input.hasViewableDesignChange && !input.hasViewedLatestVersion)) {
            nextAction = '下一步：我会先读取修改后的画面，再决定如何继续调整。';
        } else if (unresolvedNoChange > 0) {
            nextAction = '下一步：我会重新读取目标位置，确认改动是否落在正确位置。';
        } else if (!hasViewableVersion && input.hasGeneratedAsset) {
            nextAction = '下一步：把已有素材编排到 Photoshop 中，完成画面和排版。';
        } else if (!hasViewableVersion && input.hasWorkspacePreparation) {
            nextAction = '下一步：在现有目标画布中完成图片、文字或排版，形成第一版。';
        } else if (!hasViewableVersion && input.hasObservedContext) {
            nextAction = '下一步：根据已经看过的素材和画面开始实际制作。';
        } else if (!hasViewableVersion && summary.stopReason === 'tool_preflight_blocked') {
            nextAction = '下一步：目标 Photoshop 文档可用后，我会确认目标并开始实际制作。';
        } else if (!hasViewableVersion) {
            nextAction = '下一步：先形成第一版可以看的设计。';
        } else if (summary.status === 'failed') {
            nextAction = '下一步：从当前版本继续完成尚未落下的设计内容。';
        } else {
            nextAction = '下一步：继续调整当前版本中最影响效果的图片、文字或排版问题。';
        }
    }

    let title = '当前结果';
    if (awaitingUserInput) {
        title = '等待你补充信息';
    } else if (summary.status === 'completed') {
        title = hasViewableVersion
            ? '当前版本已完成'
            : input.hasGeneratedAsset ? '设计素材已生成' : '当前结果已整理';
    } else if (summary.status === 'needs_review') {
        title = hasViewableVersion
            ? '当前版本可以先看'
            : input.hasGeneratedAsset ? '设计素材已经生成' : '还没有可看的版本';
    } else if (summary.status === 'failed') {
        title = hasViewableVersion ? '当前改动已保留' : '这次还没做出版本';
    } else if (summary.status === 'cancelled') {
        title = hasViewableVersion ? '已停止，当前改动已保留' : '已停止';
    } else if (summary.status === 'awaiting_confirmation') {
        title = '等待你选择';
    }

    const lines = [outcome, versionState, nextAction].filter(Boolean);
    return {
        title,
        summary: [outcome, versionState].join(' '),
        nextStep: nextAction,
        detail: lines.join('\n'),
        message: lines.join(' ')
    };
}
