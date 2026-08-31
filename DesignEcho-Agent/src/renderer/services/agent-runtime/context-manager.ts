/**
 * Context Manager
 *
 * 以消息来源和完整 Tool exchange 为单位管理 Agent 运行上下文。
 * Token 预算只是最后一道容量约束；当前用户目标、消息权限与 Tool 协议完整性优先。
 */

import { buildAgentContextWindowBudget } from '../../../shared/agent-performance-policy';
import { buildRuntimeContextEnvelope } from '../../../shared/agent-runtime-v5/runtime-context-compiler';
import type { AgentMessage, ToolResult } from './types';

interface ContextManagerConfig {
    maxTokens: number;
    /** 保留最近 N 个完整模型轮次 / 消息单元。 */
    keepRecentRounds: number;
    /** 当前 Provider 会把 assistant reasoningContent 作为请求历史重新发送。 */
    includeReasoningContent: boolean;
}

export interface ContextBudgetAssessment {
    estimatedMessageTokens: number;
    reservedTokens: number;
    contextTokenCeiling: number;
    totalEstimatedInputTokens: number;
    fits: boolean;
    overByTokens: number;
}

interface MessageUnit {
    messages: AgentMessage[];
    protected: boolean;
    recent: boolean;
    /** 仅在本次 trim/prepare 内有效；消息一旦被压缩就立即重算。 */
    estimatedTokens: number;
}

interface ContextTrimResult {
    messages: AgentMessage[];
    assessment: ContextBudgetAssessment;
    beforeEstimatedTokens: number;
    compacted: boolean;
}

/**
 * Provider 调用前的有界上下文诊断。
 *
 * 这里只保存可复算的计数，不保存消息正文、Tool 参数、Tool 结果或图像内容。
 * `messages` 是现有 prepare() 一直返回的同一份 Provider 前消息投影。
 */
export interface ContextPreparationDiagnostics {
    messages: AgentMessage[];
    beforeEstimatedTokens: number;
    afterEstimatedTokens: number;
    beforeMessageCount: number;
    afterMessageCount: number;
    reservedTokens: number;
    removedMessageCount: number;
    compacted: boolean;
}

const DEFAULT_CONTEXT_BUDGET = buildAgentContextWindowBudget();

const DEFAULT_CONFIG: ContextManagerConfig = {
    maxTokens: DEFAULT_CONTEXT_BUDGET.maxTokens,
    keepRecentRounds: DEFAULT_CONTEXT_BUDGET.keepRecentRounds,
    includeReasoningContent: false
};

const SAFE_TOOL_RESULT_KEYS = [
    'success',
    'status',
    'code',
    'error',
    'message',
    'summary',
    'reason',
    'documentId',
    'layerId',
    'documentName',
    'layerName',
    'count',
    'total',
    'changed',
    'cancelled',
    'notExecuted',
    'countsAsObservation',
    'countsAsTaskProgress'
] as const;

const TOOL_EVIDENCE_PRIMITIVE_KEYS = new Set([
    'projectId',
    'projectRoot',
    'projectPath',
    'runId',
    'taskRunId',
    'documentId',
    'documentName',
    'historyStateId',
    'layerId',
    'layerName',
    'screenId',
    'placeholderLayerId',
    'path',
    'filePath',
    'imagePath',
    'selectedAssetPath',
    'outputPath',
    'artifactId',
    'artifactPath',
    'artifactRevision',
    'revision',
    'revisionHash',
    'schemaVersion',
    'version',
    'contentHash',
    'previewHash',
    'reviewHash',
    'candidateSetId',
    'candidateId',
    'decisionId',
    'selectedBy',
    'x',
    'y',
    'width',
    'height',
    'left',
    'top',
    'right',
    'bottom'
]);

const TOOL_EVIDENCE_CONTAINER_KEYS = new Set([
    'data',
    'document',
    'target',
    'before',
    'after',
    'historyStateRef',
    'expectedHistoryStateRef',
    'mutationCommit',
    'historyTransition',
    'receipt',
    'selectionReceipt',
    'assetCandidates',
    'candidate',
    'images',
    'plans',
    'bounds',
    'targetBounds',
    'actualBounds',
    'sourceBounds'
]);

const MAX_TOOL_EVIDENCE_DEPTH = 4;
const MAX_TOOL_EVIDENCE_ARRAY_ITEMS = 4;
const MAX_DETAIL_ASSET_DECISION_REQUESTS = 24;
const MAX_DETAIL_ASSET_DECISION_CANDIDATES = 3;

function estimateTokens(message: AgentMessage, includeReasoningContent: boolean = false): number {
    let chars = 0;
    if (message.content) chars += message.content.length;
    if (includeReasoningContent && message.reasoningContent) {
        chars += message.reasoningContent.length;
    }
    for (const block of message.contentBlocks || []) {
        if (block.type === 'text') chars += String(block.text || '').length;
        if (block.type === 'image') chars += 1200;
    }
    for (const call of message.toolCalls || []) {
        chars += call.name.length;
        chars += JSON.stringify(call.arguments).length;
    }
    for (const result of message.toolResults || []) {
        const output = typeof result.output === 'string'
            ? result.output
            : JSON.stringify(result.output);
        chars += output.length;
    }
    return Math.ceil(chars / 1.5);
}

function estimateMessages(
    messages: readonly AgentMessage[],
    includeReasoningContent: boolean = false
): number {
    return messages.reduce(
        (sum, message) => sum + estimateTokens(message, includeReasoningContent),
        0
    );
}

function compactText(value: unknown, maxCharacters: number): string {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= maxCharacters) return text;
    return `${text.slice(0, Math.max(0, maxCharacters - 13)).trimEnd()}…[已截断]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function compactToolEvidencePrimitive(value: unknown): string | number | boolean | null | undefined {
    if (typeof value === 'string') return compactText(value, 320);
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
    return undefined;
}

function collectToolResultEvidence(value: unknown, depth: number = 0): unknown {
    if (depth > MAX_TOOL_EVIDENCE_DEPTH) return undefined;
    if (Array.isArray(value)) {
        const items = value
            .slice(0, MAX_TOOL_EVIDENCE_ARRAY_ITEMS)
            .map((item) => collectToolResultEvidence(item, depth + 1))
            .filter((item) => item !== undefined);
        return items.length > 0 ? items : undefined;
    }
    if (!isRecord(value)) return undefined;

    const evidence: Record<string, unknown> = {};
    for (const [key, candidate] of Object.entries(value)) {
        if (TOOL_EVIDENCE_PRIMITIVE_KEYS.has(key)) {
            const primitive = compactToolEvidencePrimitive(candidate);
            if (primitive !== undefined) evidence[key] = primitive;
            continue;
        }
        if (!TOOL_EVIDENCE_CONTAINER_KEYS.has(key)) continue;
        const nested = collectToolResultEvidence(candidate, depth + 1);
        if (nested !== undefined) evidence[key] = nested;
    }
    return Object.keys(evidence).length > 0 ? evidence : undefined;
}

function compactDetailAssetDecisionSafety(candidate: Record<string, unknown>): Record<string, unknown> {
    const usageDecision = isRecord(candidate.assetUsageDecision)
        ? candidate.assetUsageDecision
        : undefined;
    const safety: Record<string, unknown> = {};
    for (const [key, value] of Object.entries({
        placementSafetyEligible: candidate.placementSafetyEligible,
        needsMatting: candidate.needsMatting,
        visualObserved: usageDecision?.visualObserved,
        visualRole: usageDecision?.visualRole,
        backgroundType: usageDecision?.backgroundType,
        directUseSuitability: usageDecision?.directUseSuitability,
        sourceTreatment: usageDecision?.sourceTreatment,
        automaticPlacementEligible: usageDecision?.automaticPlacementEligible,
        reason: usageDecision?.reason
    })) {
        const compactValue = compactToolEvidencePrimitive(value);
        if (compactValue !== undefined) safety[key] = compactValue;
    }
    return safety;
}

function collectDetailAssetSelectionEvidence(record: Record<string, unknown>): Record<string, unknown> | undefined {
    const data = isRecord(record.data) ? record.data : undefined;
    if (data?.status !== 'detail_asset_selection_required'
        || !Array.isArray(data.assetDecisionRequests)) {
        return undefined;
    }

    const sourceRequests = data.assetDecisionRequests;
    const requests = sourceRequests
        .slice(0, MAX_DETAIL_ASSET_DECISION_REQUESTS)
        .flatMap((requestValue) => {
            if (!isRecord(requestValue) || !Array.isArray(requestValue.candidates)) return [];
            const screenId = Number(requestValue.screenId);
            const placeholderLayerId = Number(requestValue.placeholderLayerId);
            if (!Number.isSafeInteger(screenId) || screenId <= 0
                || !Number.isSafeInteger(placeholderLayerId) || placeholderLayerId <= 0) {
                return [];
            }
            const sourceCandidates = requestValue.candidates;
            const candidates = sourceCandidates
                .slice(0, MAX_DETAIL_ASSET_DECISION_CANDIDATES)
                .flatMap((candidateValue) => {
                    if (!isRecord(candidateValue)) return [];
                    const candidateId = compactText(candidateValue.candidateId, 512);
                    const imagePath = compactText(candidateValue.imagePath, 1024);
                    if (!candidateId || !imagePath) return [];
                    return [{
                        candidateId,
                        imagePath,
                        safety: compactDetailAssetDecisionSafety(candidateValue)
                    }];
                });
            const candidateSetId = compactText(
                requestValue.candidateSetId
                    || (isRecord(sourceCandidates[0]) ? sourceCandidates[0].candidateSetId : ''),
                512
            );
            if (!candidateSetId || candidates.length === 0) return [];
            return [{
                screenId,
                placeholderLayerId,
                candidateSetId,
                candidateCount: sourceCandidates.length,
                omittedCandidateCount: Math.max(0, sourceCandidates.length - candidates.length),
                candidates
            }];
        });
    if (requests.length === 0) return undefined;
    return {
        status: 'detail_asset_selection_required',
        assetDecisionRequestCount: sourceRequests.length,
        omittedAssetDecisionRequestCount: Math.max(0, sourceRequests.length - requests.length),
        assetDecisionRequests: requests
    };
}

function mergeToolResultEvidence(
    genericEvidence: unknown,
    detailAssetSelectionEvidence: Record<string, unknown> | undefined
): unknown {
    if (!detailAssetSelectionEvidence) return genericEvidence;
    const evidence = isRecord(genericEvidence) ? genericEvidence : {};
    const genericData = isRecord(evidence.data) ? evidence.data : {};
    return {
        ...evidence,
        data: {
            ...genericData,
            ...detailAssetSelectionEvidence
        }
    };
}

function buildCompressedToolOutput(result: ToolResult): Record<string, unknown> {
    const raw = result.output;
    const record = isRecord(raw) ? raw : undefined;
    const compact: Record<string, unknown> = {
        compressedHistoricalToolResult: true,
        success: result.success
    };
    if (record) {
        for (const key of SAFE_TOOL_RESULT_KEYS) {
            const value = record[key];
            if (value === undefined) continue;
            if (typeof value === 'string') {
                compact[key] = compactText(value, key === 'error' ? 360 : 240);
            } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
                compact[key] = value;
            }
        }
        const contextEvidence = mergeToolResultEvidence(
            collectToolResultEvidence(record),
            collectDetailAssetSelectionEvidence(record)
        );
        if (contextEvidence !== undefined) compact.contextEvidence = contextEvidence;
    } else if (raw !== undefined) {
        compact.summary = compactText(raw, result.success ? 240 : 360);
    }
    compact.contextEnvelope = buildRuntimeContextEnvelope({
        source: 'historical-tool-result',
        trust: 'tool_observation',
        slot: 'tool_observation'
    });
    return compact;
}

function compressToolResultMessage(message: AgentMessage): AgentMessage {
    if (message.role !== 'tool_result' || !message.toolResults) return message;
    return {
        ...message,
        toolResults: message.toolResults.map((result) => ({
            ...result,
            output: buildCompressedToolOutput(result)
        }))
    };
}

function toolResultCoversToolCalls(assistantMessage: AgentMessage, toolResultMessage: AgentMessage): boolean {
    const expected = new Set(
        (assistantMessage.toolCalls || [])
            .map((call) => String(call?.id || '').trim())
            .filter(Boolean)
    );
    if (expected.size === 0) return true;
    if (toolResultMessage.role !== 'tool_result' || !Array.isArray(toolResultMessage.toolResults)) return false;
    const actual = new Set(
        toolResultMessage.toolResults
            .map((result) => String(result?.callId || '').trim())
            .filter(Boolean)
    );
    for (const id of expected) {
        if (!actual.has(id)) return false;
    }
    return true;
}

function preserveToolCallProtocol(messages: AgentMessage[]): AgentMessage[] {
    const result: AgentMessage[] = [];
    for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index];
        if (message.role === 'assistant' && Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
            const next = messages[index + 1];
            if (next && toolResultCoversToolCalls(message, next)) {
                result.push(message, next);
                index += 1;
            }
            continue;
        }
        if (message.role === 'tool_result') continue;
        result.push(message);
    }
    return result;
}

function isCurrentUserMessage(message: AgentMessage, currentUserFound: boolean): boolean {
    if (message.role !== 'user') return false;
    if (message.contextMetadata?.origin === 'current_user_instruction') return true;
    if (message.contextMetadata?.authority === 'policy' || message.contextMetadata?.authority === 'data_only') {
        return false;
    }
    return !currentUserFound;
}

function buildMessageUnits(
    messages: AgentMessage[],
    includeReasoningContent: boolean
): MessageUnit[] {
    const units: MessageUnit[] = [];
    let currentUserFound = false;
    for (let index = 0; index < messages.length; index += 1) {
        const message = messages[index];
        if (message.role === 'tool_result') continue;
        const currentUser = isCurrentUserMessage(message, currentUserFound);
        if (currentUser) currentUserFound = true;

        if (message.role === 'assistant' && Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
            const next = messages[index + 1];
            if (!next || !toolResultCoversToolCalls(message, next)) continue;
            const unitMessages = [message, next];
            index += 1;
            while (index + 1 < messages.length) {
                const candidate = messages[index + 1];
                if (candidate.role !== 'user'
                    || candidate.contextMetadata?.origin === 'current_user_instruction') {
                    break;
                }
                unitMessages.push(candidate);
                index += 1;
            }
            units.push({
                messages: unitMessages,
                protected: false,
                recent: false,
                estimatedTokens: estimateMessages(unitMessages, includeReasoningContent)
            });
            continue;
        }

        const unitMessages = [message];
        units.push({
            messages: unitMessages,
            protected: message.role === 'system'
                || currentUser
                || message.contextMetadata?.retention === 'pinned',
            recent: false,
            estimatedTokens: estimateMessages(unitMessages, includeReasoningContent)
        });
    }
    return units;
}

function removeSupersededEphemeralMessages(
    units: MessageUnit[],
    includeReasoningContent: boolean
): MessageUnit[] {
    const seenScopes = new Set<string>();
    const reversed = [...units].reverse().map((unit) => {
        const messages = [...unit.messages].reverse().filter((message) => {
            const metadata = message.contextMetadata;
            if (metadata?.retention !== 'ephemeral' || !metadata.scope) return true;
            if (seenScopes.has(metadata.scope)) return false;
            seenScopes.add(metadata.scope);
            return true;
        }).reverse();
        return {
            ...unit,
            messages,
            estimatedTokens: estimateMessages(messages, includeReasoningContent)
        };
    }).reverse();
    return reversed.filter((unit) => unit.messages.length > 0);
}

function flattenUnits(units: readonly MessageUnit[]): AgentMessage[] {
    return units.flatMap((unit) => unit.messages);
}

function estimateUnits(units: readonly MessageUnit[]): number {
    return units.reduce((sum, unit) => sum + unit.estimatedTokens, 0);
}

function compressUnitToolResults(
    unit: MessageUnit,
    includeReasoningContent: boolean
): MessageUnit {
    const messages = unit.messages.map(compressToolResultMessage);
    return {
        ...unit,
        messages,
        estimatedTokens: estimateMessages(messages, includeReasoningContent)
    };
}

function buildContextBudgetAssessment(
    estimatedMessageTokens: number,
    reservedTokens: number,
    contextTokenCeiling: number
): ContextBudgetAssessment {
    const reserved = Math.max(0, Math.ceil(Number(reservedTokens) || 0));
    const totalEstimatedInputTokens = estimatedMessageTokens + reserved;
    const overByTokens = Math.max(0, totalEstimatedInputTokens - contextTokenCeiling);
    return {
        estimatedMessageTokens,
        reservedTokens: reserved,
        contextTokenCeiling,
        totalEstimatedInputTokens,
        fits: overByTokens === 0,
        overByTokens
    };
}

export class ContextManager {
    private config: ContextManagerConfig;

    constructor(config?: Partial<ContextManagerConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * 容量治理顺序：
     * 1. System 与当前用户目标固定保留；同 scope 的旧临时观察先失效。
     * 2. assistant(tool_calls) + tool_result 作为不可拆分单元。
     * 3. 先结构化压缩旧 Tool result，再按完整单元删除最旧历史。
     * 4. 最近单元最后压缩；绝不以固定“三条消息”等价一轮。
     */
    private trimWithAssessment(
        messages: AgentMessage[],
        reservedTokens: number = 0
    ): ContextTrimResult {
        const reserved = Math.max(0, Math.ceil(Number(reservedTokens) || 0));
        const messageTokenBudget = Math.max(0, this.config.maxTokens - reserved);
        const protocolSafe = preserveToolCallProtocol(messages);
        const protocolUnits = buildMessageUnits(
            protocolSafe,
            this.config.includeReasoningContent
        );
        const beforeEstimatedTokens = estimateUnits(protocolUnits);
        let units = removeSupersededEphemeralMessages(
            protocolUnits,
            this.config.includeReasoningContent
        );
        let estimatedMessageTokens = estimateUnits(units);
        if (estimatedMessageTokens <= messageTokenBudget) {
            const preparedMessages = flattenUnits(units);
            return {
                messages: preparedMessages,
                beforeEstimatedTokens,
                compacted: false,
                assessment: buildContextBudgetAssessment(
                    estimatedMessageTokens,
                    reserved,
                    this.config.maxTokens
                )
            };
        }

        let recentRemaining = this.config.keepRecentRounds;
        for (let index = units.length - 1; index >= 0 && recentRemaining > 0; index -= 1) {
            if (units[index].protected) continue;
            units[index].recent = true;
            recentRemaining -= 1;
        }

        let compacted = false;
        units = units.map((unit) => {
            if (unit.recent || unit.protected) return unit;
            if (unit.messages.some((message) => message.role === 'tool_result')) {
                compacted = true;
            }
            return compressUnitToolResults(unit, this.config.includeReasoningContent);
        });
        estimatedMessageTokens = estimateUnits(units);
        if (estimatedMessageTokens <= messageTokenBudget) {
            const preparedMessages = flattenUnits(units);
            return {
                messages: preparedMessages,
                beforeEstimatedTokens,
                compacted,
                assessment: buildContextBudgetAssessment(
                    estimatedMessageTokens,
                    reserved,
                    this.config.maxTokens
                )
            };
        }

        for (let index = 0; index < units.length; index += 1) {
            if (estimatedMessageTokens <= messageTokenBudget) break;
            const unit = units[index];
            if (unit.protected || unit.recent) continue;
            estimatedMessageTokens -= unit.estimatedTokens;
            units.splice(index, 1);
            index -= 1;
        }

        if (estimatedMessageTokens > messageTokenBudget) {
            units = units.map((unit) => {
                if (unit.protected) return unit;
                if (unit.messages.some((message) => message.role === 'tool_result')) {
                    compacted = true;
                }
                return compressUnitToolResults(unit, this.config.includeReasoningContent);
            });
            estimatedMessageTokens = estimateUnits(units);
        }

        for (let index = 0; index < units.length; index += 1) {
            if (estimatedMessageTokens <= messageTokenBudget) break;
            if (units[index].protected) continue;
            estimatedMessageTokens -= units[index].estimatedTokens;
            units.splice(index, 1);
            index -= 1;
        }

        const preparedMessages = preserveToolCallProtocol(flattenUnits(units));
        return {
            messages: preparedMessages,
            beforeEstimatedTokens,
            compacted,
            assessment: buildContextBudgetAssessment(
                estimatedMessageTokens,
                reserved,
                this.config.maxTokens
            )
        };
    }

    trim(messages: AgentMessage[], reservedTokens: number = 0): AgentMessage[] {
        return this.trimWithAssessment(messages, reservedTokens).messages;
    }

    estimateTotal(messages: AgentMessage[]): number {
        return estimateMessages(messages, this.config.includeReasoningContent);
    }

    assess(messages: AgentMessage[], reservedTokens: number = 0): ContextBudgetAssessment {
        return buildContextBudgetAssessment(
            estimateMessages(messages, this.config.includeReasoningContent),
            reservedTokens,
            this.config.maxTokens
        );
    }

    /**
     * Provider 调用前的唯一容量闸：先按完整消息单元压缩，再验证受保护内容与预留是否仍可容纳。
     */
    prepareWithDiagnostics(
        messages: AgentMessage[],
        reservedTokens: number = 0
    ): ContextPreparationDiagnostics {
        const beforeMessageCount = messages.length;
        const normalizedReservedTokens = Math.max(0, Math.ceil(Number(reservedTokens) || 0));
        const prepared = this.trimWithAssessment(messages, reservedTokens);
        if (prepared.assessment.fits) {
            const afterMessageCount = prepared.messages.length;
            return {
                messages: prepared.messages,
                beforeEstimatedTokens: prepared.beforeEstimatedTokens,
                // trimWithAssessment 已经在同一份最终消息投影上完成估算；
                // 诊断只复用该事实，避免每次 Provider 调用前再扫描一次完整历史。
                afterEstimatedTokens: prepared.assessment.estimatedMessageTokens,
                beforeMessageCount,
                afterMessageCount,
                reservedTokens: normalizedReservedTokens,
                removedMessageCount: Math.max(0, beforeMessageCount - afterMessageCount),
                compacted: prepared.compacted
            };
        }
        const error: Error & { code?: string; contextAssessment?: unknown } = new Error(
            `当前模型上下文无法容纳本轮必要的系统规则、用户目标和工具定义：估算超出 ${prepared.assessment.overByTokens} tokens。`
        );
        error.code = 'context_window_budget_exceeded';
        error.contextAssessment = prepared.assessment;
        throw error;
    }

    prepare(messages: AgentMessage[], reservedTokens: number = 0): AgentMessage[] {
        return this.prepareWithDiagnostics(messages, reservedTokens).messages;
    }
}
