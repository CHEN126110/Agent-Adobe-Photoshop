/**
 * Final Judge 与一次 diagnosis-only 协议修复的模型调用编排。
 *
 * 本模块不读写 Photoshop、不选择设计动作、不映射 Tool；Host 版本读取和模型调用都由
 * Agent 以窄回调注入。首次评分一旦可靠形成，repair 只能补 diagnosis，不能重新评分。
 */

import {
    buildVlmJudgeDiagnosisRepairPrompt,
    evaluateVlmJudgeDiagnosisCoverage,
    isReliableVlmJudgeBatchComplete,
    mergeVlmJudgeDiagnosisRepairs,
    parseVlmJudgeDiagnosisRepairResponse,
    parseVlmJudgeResponse,
    readVlmJudgeScoreBatchFromToolCalls,
    type DesignAssertion,
    type DesignAssertionResult,
    type FinalQualityDiagnosisRepairDigestStatus,
    type FinalQualityJudgeFailureKind,
    type FinalQualityModelProtocolDigest
} from '../../../shared/design-quality-assertion';
import {
    samePhotoshopHistoryStateRef,
    type PhotoshopHistoryStateRef
} from '../../../shared/photoshop-history-state-ref';
import {
    projectSerializedVisualImageDataUrl,
    readModelVisualPresentationReceipt,
    type ModelVisualPresentationReceipt,
    type ModelVisualPresentationReceiptRef
} from '../../../shared/model-visual-presentation-receipt';
import type { AgentMessage, ModelTransportAttemptAccounting } from './types';
import { readCompleteProviderTextContent } from './provider-output-recovery';

/**
 * 普通执行软时限之后的终局质量结算窗口。它小于正式采集为终态保留的 5 分钟，
 * 让一次最慢 Judge 仍可完成，同时为 Host 读回、收据发布与外层终态留出余量。
 */
export const FINAL_QUALITY_TERMINAL_RESERVE_MS = 240_000;
const FINAL_QUALITY_MIN_REQUEST_TIMEOUT_MS = 5_000;

export type FinalQualityDiagnosisRepairStatus =
    | 'not_run'
    | 'not_required'
    | 'satisfied'
    | 'repaired'
    | 'time_exhausted'
    | 'call_failed'
    | 'invalid';

export interface FinalQualityDiagnosisRepairStepProjection {
    title: string;
    detail: string;
    status: 'success' | 'error';
    issue?: string;
}

export interface FinalQualityModelRequest {
    messages: AgentMessage[];
    maxTokens: number;
    temperature: number;
    timeoutMs: number;
    /**
     * 终局 Judge 只返回有界 JSON，不需要把 Provider 隐藏推理与结构化答案放进同一输出预算。
     * 使用 literal false 防止调用方遗漏后退回模型默认高思考。
     */
    thinkingEnabled: false;
    /** 只给首次 Judge；与该请求实际图片顺序一一对应，用于 Provider outgoing receipt。 */
    visualPresentationCandidateKeys?: string[];
    /**
     * 结构化评分提交工具（如 submitScoreBatch）。带工具时模型以一次工具调用提交
     * 评分批次，避免长文评审吞掉正文内联 JSON；批次校验仍由 parseVlmJudgeResponse
     * 单点负责，工具不授予任何执行权。
     */
    tools?: Array<{
        name: string;
        description: string;
        inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
    }>;
}

export interface FinalQualityModelResponse {
    content?: string;
    /** Provider 返回的工具调用（结构化评分提交通道）；形状由 Provider 决定，读取端自行校验。 */
    toolCalls?: unknown;
    transportAttempts?: ModelTransportAttemptAccounting[];
    visualPresentationReceipt?: ModelVisualPresentationReceipt;
}

interface FinalQualityJudgeVisualTransportFacts {
    judgeVisualPresentationReceipt?: ModelVisualPresentationReceipt;
    judgeVisualPresentationTransportReceiptRef?: ModelVisualPresentationReceiptRef;
}

export type FinalQualityModelProtocolResult =
    | {
        status: 'completed';
        results: DesignAssertionResult[];
        diagnosisRepairStatus: FinalQualityDiagnosisRepairStatus;
        diagnosisRepairTargetCount: number;
        error?: unknown;
        judgeVisualPresentationReceipt?: ModelVisualPresentationReceipt;
        judgeVisualPresentationTransportReceiptRef?: ModelVisualPresentationReceiptRef;
    }
    | {
        status: 'judge_stale';
        results: null;
        diagnosisRepairStatus: 'not_run' | 'stale';
        diagnosisRepairTargetCount: number;
        judgeVisualPresentationReceipt?: ModelVisualPresentationReceipt;
        judgeVisualPresentationTransportReceiptRef?: ModelVisualPresentationReceiptRef;
    }
    | {
        status: 'judge_unavailable';
        results: null;
        error: unknown;
        failureKind: FinalQualityJudgeFailureKind;
        diagnosisRepairStatus: 'not_run';
        diagnosisRepairTargetCount: 0;
    }
    | {
        status: 'judge_time_exhausted';
        results: null;
        diagnosisRepairStatus: 'not_run';
        diagnosisRepairTargetCount: 0;
    };

/**
 * Final-quality acquisition/runtime 在模型协议形成前异常时，仍投影到同一个有界协议摘要。
 * 该摘要只说明 Evaluation owner 未能运行，不包含异常正文，也不授予主 Agent 重试、
 * Photoshop 写入、完成或质量通过权限。
 */
export function projectFinalQualityEvaluationRuntimeFailure(): FinalQualityModelProtocolDigest {
    return {
        judgeStatus: 'unavailable',
        judgeFailureKind: 'evaluation_runtime_failed',
        diagnosisRepairStatus: 'not_run',
        diagnosisRepairTargetCount: 0,
        actionableDiagnosisCount: 0,
        evidenceScope: {
            finalArtifactObserved: false,
            selectedSourceCompared: false,
            declaredReferenceCompared: false,
            candidateSetCompared: false
        }
    };
}

/** 已知当前 Photoshop revision 不再等于已评分 revision 时，旧评分只保留 stale 事实。 */
export function projectFinalQualityRevisionStale(): FinalQualityModelProtocolDigest {
    return {
        judgeStatus: 'stale',
        diagnosisRepairStatus: 'stale',
        diagnosisRepairTargetCount: 0,
        actionableDiagnosisCount: 0,
        evidenceScope: {
            finalArtifactObserved: false,
            selectedSourceCompared: false,
            declaredReferenceCompared: false,
            candidateSetCompared: false
        }
    };
}

export function projectFinalQualityModelProtocolDigest(
    result: FinalQualityModelProtocolResult,
    actionableDiagnosisCount: number,
    finalArtifactObserved: boolean,
    selectedSourceCompared: boolean,
    comparisonEvidenceScope: {
        declaredReferenceCompared: boolean;
        candidateSetCompared: boolean;
    },
    visualPresentation: {
        candidateKeys: readonly string[];
        contentBlocks: NonNullable<AgentMessage['contentBlocks']>;
    }
): FinalQualityModelProtocolDigest {
    let judgeStatus: FinalQualityModelProtocolDigest['judgeStatus'];
    switch (result.status) {
        case 'completed':
            judgeStatus = 'completed';
            break;
        case 'judge_stale':
            judgeStatus = 'stale';
            break;
        case 'judge_unavailable':
            judgeStatus = 'unavailable';
            break;
        default:
            judgeStatus = 'time_exhausted';
            break;
    }
    const judgeReceivedVisualInput = (
        result.status === 'completed' || result.status === 'judge_stale'
    ) && finalQualityJudgeVisualPresentationMatches({
        receipt: result.judgeVisualPresentationReceipt,
        successfulTransportReceiptRef: result.judgeVisualPresentationTransportReceiptRef,
        candidateKeys: visualPresentation.candidateKeys,
        contentBlocks: visualPresentation.contentBlocks
    });
    return {
        judgeStatus,
        ...(result.status === 'judge_unavailable' && result.failureKind
            ? { judgeFailureKind: result.failureKind }
            : {}),
        diagnosisRepairStatus: result.diagnosisRepairStatus as FinalQualityDiagnosisRepairDigestStatus,
        diagnosisRepairTargetCount: Math.max(0, Math.min(
            3,
            Math.floor(Number(result.diagnosisRepairTargetCount) || 0)
        )),
        actionableDiagnosisCount: Math.max(0, Math.min(
            3,
            Math.floor(Number(actionableDiagnosisCount) || 0)
        )),
        evidenceScope: {
            finalArtifactObserved: judgeReceivedVisualInput && finalArtifactObserved,
            selectedSourceCompared: judgeReceivedVisualInput && selectedSourceCompared,
            declaredReferenceCompared: judgeReceivedVisualInput
                && comparisonEvidenceScope.declaredReferenceCompared,
            candidateSetCompared: judgeReceivedVisualInput
                && comparisonEvidenceScope.candidateSetCompared
        }
    };
}

export interface RunFinalQualityModelProtocolInput {
    judgeSystemPrompt: string;
    targetBindingInstruction?: string;
    contextMessage: string;
    contentBlocks: NonNullable<AgentMessage['contentBlocks']>;
    visualPresentationCandidateKeys: readonly string[];
    /** Codex transport 能签发逐图出站回执；该路径缺失或不匹配时不得采信文字评分。 */
    visualPresentationReceiptPolicy?: 'optional' | 'required';
    /** 多画面 ReviewSet 的合法 sourceId / observationKey；单画面留空即可使用语义区域名。 */
    allowedDiagnosisTargets?: readonly string[];
    pending: DesignAssertion[];
    requiredEvidenceRefsByAssertion?: Record<string, readonly string[]>;
    /** 结构化评分提交工具；由评审调用方按协议构建（buildVlmJudgeScoreBatchToolSchema）。 */
    judgeTools?: FinalQualityModelRequest['tools'];
    expectedHistoryStateRef: PhotoshopHistoryStateRef;
    configuredSoftTimeBudgetMs?: number;
    /** 普通执行软时限之外，仅供一次终局 Judge/必要诊断共享的物理时间窗口。 */
    terminalQualityReserveMs?: number;
    maxRequestTimeoutMs: number;
    readActiveElapsedMs: () => number;
    callJudge: (request: FinalQualityModelRequest) => Promise<FinalQualityModelResponse>;
    callDiagnosisRepair: (request: FinalQualityModelRequest) => Promise<FinalQualityModelResponse>;
    readPostModelHistoryStateRef: () => Promise<PhotoshopHistoryStateRef | undefined>;
}

/**
 * 判定评审 Provider 响应的合法完整终态并归一：带工具调用的响应是结构化评分提交
 * 终态（stopReason=tool_use 不满足纯文本完整性判据，批次有效性由本协议 fail closed
 * 校验）；纯文本响应必须通过完整性判据，不完整即抛错，调用方按 provider_call_failed 处理。
 */
export function settleFinalQualityJudgeTerminalResponse<
    T extends Parameters<typeof readCompleteProviderTextContent>[0] & { toolCalls?: unknown }
>(response: T): T {
    if (Array.isArray(response.toolCalls) && response.toolCalls.length > 0) {
        return response;
    }
    const terminalContent = readCompleteProviderTextContent(response);
    if (!terminalContent.complete) {
        throw new Error('视觉评审模型没有返回可消费的完整终态');
    }
    return { ...response, content: terminalContent.content };
}

export function finalQualityJudgeVisualPresentationMatches(input: {
    receipt: unknown;
    successfulTransportReceiptRef: unknown;
    candidateKeys: readonly string[];
    contentBlocks: NonNullable<AgentMessage['contentBlocks']>;
}): boolean {
    const receipt = readModelVisualPresentationReceipt(input.receipt);
    const successfulTransportReceiptRef = input.successfulTransportReceiptRef
        && typeof input.successfulTransportReceiptRef === 'object'
        && !Array.isArray(input.successfulTransportReceiptRef)
        ? input.successfulTransportReceiptRef as Partial<ModelVisualPresentationReceiptRef>
        : undefined;
    const candidateKeys = input.candidateKeys.map((key) => String(key || '').trim());
    const imageBlocks = input.contentBlocks.filter((block) => block.type === 'image');
    if (!receipt
        || successfulTransportReceiptRef?.attemptId !== receipt.attemptId
        || successfulTransportReceiptRef?.manifestSha256 !== receipt.manifestSha256
        || candidateKeys.length === 0
        || candidateKeys.length !== imageBlocks.length
        || receipt.images.length !== imageBlocks.length
        || new Set(candidateKeys).size !== candidateKeys.length) return false;
    return imageBlocks.every((block, index) => {
        const rawData = String(block.data || '').trim();
        const mediaType = String(block.mediaType || '').trim().toLowerCase();
        const dataUrl = /^data:image\//iu.test(rawData)
            ? rawData
            : `data:${mediaType};base64,${rawData}`;
        const expected = projectSerializedVisualImageDataUrl(dataUrl);
        const actual = receipt.images[index];
        return Boolean(expected)
            && actual.ordinal === index
            && actual.candidateKey === candidateKeys[index]
            && actual.mediaType === expected?.mediaType
            && actual.decodedByteSha256 === expected?.decodedByteSha256
            && actual.decodedByteLength === expected?.decodedByteLength;
    });
}

function projectFinalQualityJudgeVisualTransportFacts(
    response: FinalQualityModelResponse
): FinalQualityJudgeVisualTransportFacts {
    const receipt = readModelVisualPresentationReceipt(response.visualPresentationReceipt);
    if (!receipt) return {};
    const matchingAttempt = Array.isArray(response.transportAttempts)
        ? response.transportAttempts.find((attempt) => (
            attempt?.succeeded === true
            && attempt.visualPresentationReceiptRef?.attemptId === receipt.attemptId
            && attempt.visualPresentationReceiptRef?.manifestSha256 === receipt.manifestSha256
        ))
        : undefined;
    return {
        judgeVisualPresentationReceipt: receipt,
        ...(matchingAttempt?.visualPresentationReceiptRef ? {
            judgeVisualPresentationTransportReceiptRef: {
                attemptId: receipt.attemptId,
                manifestSha256: receipt.manifestSha256
            }
        } : {})
    };
}

export function projectFinalQualityDiagnosisRepairStep(
    status: FinalQualityDiagnosisRepairStatus,
    targetCount: number
): FinalQualityDiagnosisRepairStepProjection | undefined {
    if (status === 'not_required' || status === 'satisfied') return undefined;
    if (status === 'repaired') {
        return {
            title: '评审已补全具体问题',
            detail: `首轮评分缺少具体修改依据，已在同一画面版本上补齐 ${targetCount} 项诊断；原评分没有重算。`,
            status: 'success'
        };
    }
    return {
        title: '具体修改依据未补全',
        detail: '首轮画面评分仍然保留，但本次没有取得可安全交给 Agent 的具体诊断，因此不会自动猜测修改动作。',
        status: 'error',
        issue: `design_quality_diagnosis_repair_${status}`
    };
}

function resolveRequestTimeoutMs(input: RunFinalQualityModelProtocolInput): number | undefined {
    const terminalQualityReserveMs = Math.max(
        0,
        Math.floor(Number(input.terminalQualityReserveMs) || 0)
    );
    const remainingMs = typeof input.configuredSoftTimeBudgetMs === 'number'
        && Number.isFinite(input.configuredSoftTimeBudgetMs)
        ? input.configuredSoftTimeBudgetMs
            + terminalQualityReserveMs
            - input.readActiveElapsedMs()
        : input.maxRequestTimeoutMs;
    const boundedTimeoutMs = Math.min(input.maxRequestTimeoutMs, Math.floor(remainingMs));
    // Main 的 OpenAI-compatible transport 对有效请求使用 5s 最小超时。剩余窗口不足时
    // 在协议 Owner 内直接结算 time_exhausted，不能把 1ms 请求暗中抬到 5s 越过总预算。
    if (boundedTimeoutMs < FINAL_QUALITY_MIN_REQUEST_TIMEOUT_MS) return undefined;
    return boundedTimeoutMs;
}

function buildQualityMessages(
    systemPrompt: string,
    contextMessage: string,
    contentBlocks: NonNullable<AgentMessage['contentBlocks']>
): AgentMessage[] {
    return [
        { role: 'system', content: systemPrompt },
        {
            role: 'user',
            content: contextMessage,
            contentBlocks: [{ type: 'text', text: contextMessage }, ...contentBlocks]
        }
    ];
}

async function readUnchangedHistory(
    input: RunFinalQualityModelProtocolInput
): Promise<boolean> {
    const observed = await input.readPostModelHistoryStateRef();
    return samePhotoshopHistoryStateRef(input.expectedHistoryStateRef, observed);
}

function filterUnboundDiagnoses(
    results: readonly DesignAssertionResult[],
    allowedTargets: readonly string[] | undefined
): DesignAssertionResult[] {
    const targetSet = new Set((allowedTargets || []).map((target) => String(target || '').trim()).filter(Boolean));
    if (targetSet.size === 0) return Array.from(results);
    return results.map((result) => (
        result.diagnosis && !targetSet.has(String(result.diagnosis.visualFinding.target || '').trim())
            ? { ...result, diagnosis: undefined }
            : result
    ));
}

export async function runFinalQualityModelProtocol(
    input: RunFinalQualityModelProtocolInput
): Promise<FinalQualityModelProtocolResult> {
    const judgeTimeoutMs = resolveRequestTimeoutMs(input);
    if (!judgeTimeoutMs) {
        return {
            status: 'judge_time_exhausted',
            results: null,
            diagnosisRepairStatus: 'not_run',
            diagnosisRepairTargetCount: 0
        };
    }
    const judgeMaxTokens = Math.min(6144, Math.max(1536, input.pending.length * 360));
    let judgeResponse: FinalQualityModelResponse;
    try {
        judgeResponse = await input.callJudge({
            messages: buildQualityMessages(
                input.judgeSystemPrompt,
                input.contextMessage,
                input.contentBlocks
            ),
            maxTokens: judgeMaxTokens,
            temperature: 0.2,
            timeoutMs: judgeTimeoutMs,
            thinkingEnabled: false,
            visualPresentationCandidateKeys: [...input.visualPresentationCandidateKeys],
            ...(input.judgeTools?.length ? { tools: input.judgeTools } : {})
        });
    } catch (error) {
        return {
            status: 'judge_unavailable',
            results: null,
            error,
            failureKind: 'provider_call_failed',
            diagnosisRepairStatus: 'not_run',
            diagnosisRepairTargetCount: 0
        };
    }
    const judgeVisualTransportFacts = projectFinalQualityJudgeVisualTransportFacts(judgeResponse);
    try {
        if (!await readUnchangedHistory(input)) {
            return {
                status: 'judge_stale',
                results: null,
                diagnosisRepairStatus: 'not_run',
                diagnosisRepairTargetCount: 0,
                ...judgeVisualTransportFacts
            };
        }
    } catch {
        return {
            status: 'judge_stale',
            results: null,
            diagnosisRepairStatus: 'not_run',
            diagnosisRepairTargetCount: 0,
            ...judgeVisualTransportFacts
        };
    }
    if (input.visualPresentationReceiptPolicy === 'required'
        && !finalQualityJudgeVisualPresentationMatches({
            receipt: judgeVisualTransportFacts.judgeVisualPresentationReceipt,
            successfulTransportReceiptRef:
                judgeVisualTransportFacts.judgeVisualPresentationTransportReceiptRef,
            candidateKeys: input.visualPresentationCandidateKeys,
            contentBlocks: input.contentBlocks
        })) {
        return {
            status: 'judge_unavailable',
            results: null,
            error: new Error('模型返回了文字评分，但无法确认它实际收到本次画面；本次评分未被采信。'),
            failureKind: 'visual_presentation_unverified',
            diagnosisRepairStatus: 'not_run',
            diagnosisRepairTargetCount: 0
        };
    }

    // 结构化提交优先：submitScoreBatch 工具参数序列化为与正文内联 JSON 同构的文本，
    // 交同一 parseVlmJudgeResponse 校验；无工具调用时回落正文文本（旧协议不变）。
    const structuredScoreBatch = readVlmJudgeScoreBatchFromToolCalls(judgeResponse.toolCalls);
    const firstResults = filterUnboundDiagnoses(
        parseVlmJudgeResponse(structuredScoreBatch ?? String(judgeResponse.content || ''), input.pending, {
            requiredEvidenceRefsByAssertion: input.requiredEvidenceRefsByAssertion
        }),
        input.allowedDiagnosisTargets
    );
    if (!isReliableVlmJudgeBatchComplete(firstResults, input.pending)) {
        return {
            status: 'judge_unavailable',
            results: null,
            error: new Error(
                '视觉评审返回了不完整或不可可靠消费的评分批次；本次不会标记为已完成，也不会用默认分数补齐。'
            ),
            failureKind: 'score_batch_invalid',
            diagnosisRepairStatus: 'not_run',
            diagnosisRepairTargetCount: 0
        };
    }
    const coverage = evaluateVlmJudgeDiagnosisCoverage(firstResults, input.pending);
    if (coverage.status !== 'missing') {
        return {
            status: 'completed',
            results: firstResults,
            diagnosisRepairStatus: coverage.status,
            diagnosisRepairTargetCount: 0,
            ...judgeVisualTransportFacts
        };
    }

    const repairTimeoutMs = resolveRequestTimeoutMs(input);
    if (!repairTimeoutMs) {
        return {
            status: 'completed',
            results: firstResults,
            diagnosisRepairStatus: 'time_exhausted',
            diagnosisRepairTargetCount: coverage.missingTargets.length,
            ...judgeVisualTransportFacts
        };
    }
    const repairPrompt = [
        buildVlmJudgeDiagnosisRepairPrompt(coverage.missingTargets),
        input.targetBindingInstruction
    ].filter(Boolean).join('\n\n');
    const repairMaxTokens = Math.min(4096, Math.max(1200, coverage.missingTargets.length * 900));
    let repairResponse: FinalQualityModelResponse;
    try {
        repairResponse = await input.callDiagnosisRepair({
            messages: buildQualityMessages(repairPrompt, input.contextMessage, input.contentBlocks),
            maxTokens: repairMaxTokens,
            temperature: 0.1,
            timeoutMs: repairTimeoutMs,
            thinkingEnabled: false,
            ...(input.visualPresentationReceiptPolicy === 'required' ? {
                visualPresentationCandidateKeys: [...input.visualPresentationCandidateKeys]
            } : {})
        });
    } catch (error) {
        try {
            if (!await readUnchangedHistory(input)) {
                return {
                    status: 'judge_stale',
                    results: null,
                    diagnosisRepairStatus: 'stale',
                    diagnosisRepairTargetCount: coverage.missingTargets.length,
                    ...judgeVisualTransportFacts
                };
            }
        } catch {
            return {
                status: 'judge_stale',
                results: null,
                diagnosisRepairStatus: 'stale',
                diagnosisRepairTargetCount: coverage.missingTargets.length,
                ...judgeVisualTransportFacts
            };
        }
        return {
            status: 'completed',
            results: firstResults,
            diagnosisRepairStatus: 'call_failed',
            diagnosisRepairTargetCount: coverage.missingTargets.length,
            ...judgeVisualTransportFacts,
            error
        };
    }
    try {
        if (!await readUnchangedHistory(input)) {
            return {
                status: 'judge_stale',
                results: null,
                diagnosisRepairStatus: 'stale',
                diagnosisRepairTargetCount: coverage.missingTargets.length,
                ...judgeVisualTransportFacts
            };
        }
    } catch {
        return {
            status: 'judge_stale',
            results: null,
            diagnosisRepairStatus: 'stale',
            diagnosisRepairTargetCount: coverage.missingTargets.length,
            ...judgeVisualTransportFacts
        };
    }
    if (input.visualPresentationReceiptPolicy === 'required') {
        const repairVisualTransportFacts = projectFinalQualityJudgeVisualTransportFacts(repairResponse);
        const repairVisualPresentationVerified = finalQualityJudgeVisualPresentationMatches({
            receipt: repairVisualTransportFacts.judgeVisualPresentationReceipt,
            successfulTransportReceiptRef:
                repairVisualTransportFacts.judgeVisualPresentationTransportReceiptRef,
            candidateKeys: input.visualPresentationCandidateKeys,
            contentBlocks: input.contentBlocks
        });
        if (!repairVisualPresentationVerified) {
            return {
                status: 'completed',
                results: firstResults,
                diagnosisRepairStatus: 'invalid',
                diagnosisRepairTargetCount: coverage.missingTargets.length,
                ...judgeVisualTransportFacts
            };
        }
    }
    const parsedRepair = parseVlmJudgeDiagnosisRepairResponse(
        String(repairResponse.content || ''),
        coverage.missingTargets
    );
    const mergedResults = filterUnboundDiagnoses(
        mergeVlmJudgeDiagnosisRepairs(firstResults, parsedRepair),
        input.allowedDiagnosisTargets
    );
    if (parsedRepair.status !== 'valid'
        || evaluateVlmJudgeDiagnosisCoverage(mergedResults, input.pending).status !== 'satisfied') {
        return {
            status: 'completed',
            results: firstResults,
            diagnosisRepairStatus: 'invalid',
            diagnosisRepairTargetCount: coverage.missingTargets.length,
            ...judgeVisualTransportFacts
        };
    }
    return {
        status: 'completed',
        results: mergedResults,
        diagnosisRepairStatus: 'repaired',
        diagnosisRepairTargetCount: coverage.missingTargets.length,
        ...judgeVisualTransportFacts
    };
}
