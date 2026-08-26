/**
 * Final Judge 的证据装配、Provider 协议和跨代 comparison 写入意图。
 *
 * 本模块只编排已经存在的事实与视觉 presentation：不选择素材赢家、不生成设计方向，
 * 也不拥有 Photoshop 写入、任务完成或质量 Verdict。Agent 仍负责何时进入终审；
 * Provider 调用、Host 版本读回和性能会计通过窄回调注入。
 */

import type { DesignEvaluationProfile } from '../../../shared/agent-runtime-v5/design-evaluation-profiles';
import type { RuntimeDesignBriefDeclaration } from '../../../shared/agent-runtime-v5/runtime-design-brief-declaration';
import {
    buildRuntimeReferenceEvaluationContext,
    type RuntimeReferenceBriefDeclaration
} from '../../../shared/agent-runtime-v5/runtime-reference-context';
import type { RuntimeDesignStrategyDeclaration } from '../../../shared/agent-runtime-v5/runtime-design-strategy-declaration';
import type { ReflexionHandoff } from '../../../shared/agent-runtime-v5/reflexion-contract';
import { getModelById, isAgentMultimodalModelId } from '../../../shared/config/models.config';
import { isCodexSubscriptionModel } from '../../../shared/codex-subscription-contract';
import { sanitizeUserVisibleDiagnosticText } from '../../../shared/chat-response-cleaner';
import {
    extractDesignQualityMeasurements,
    type DesignSurfaceSnapshot
} from '../../../shared/design-quality-measurement';
import {
    buildVlmJudgeSystemPrompt,
    type DesignAssertion,
    type DesignAssertionResult,
    type FinalQualityModelProtocolDigest
} from '../../../shared/design-quality-assertion';
import type { PhotoshopHistoryStateRef } from '../../../shared/photoshop-history-state-ref';
import {
    planDesignReviewImages,
    selectDesignReviewSetForFinalJudge
} from '../../../shared/design-visual-judge-observation';
import type { DesignReviewSet } from '../../../shared/visual-observation-bundle';
import {
    collectDesignFinalCandidateSetReplays,
    collectDesignFinalDeclaredReferenceReplays,
    planDesignFinalComparisonEvidence
} from './design-final-comparison-evidence';
import {
    buildDesignFinalReviewDerivedViewPayload,
    buildDesignFinalReviewModelContext,
    buildDesignFinalReviewStructureEvidence,
    buildDesignFinalReviewSupportingImagePayload,
    loadDesignFinalReviewSupportingImages,
    projectDesignFinalReviewSupportingSources,
    selectFinalSupportingSourcePlacements
} from './design-final-review-evidence';
import {
    projectFinalQualityDiagnosisRepairStep,
    projectFinalQualityModelProtocolDigest,
    runFinalQualityModelProtocol,
    type FinalQualityModelProtocolResult,
    type FinalQualityModelRequest,
    type FinalQualityModelResponse
} from './final-quality-model-protocol';
import {
    formatMutationBoundDesignIntentForReview,
    type MutationBoundDesignIntent
} from './mutation-bound-design-intent';
import type { ToolResultImage } from './tool-result-sanitizer';
import {
    projectTrustedFinalComparisonEvidenceForReflexion,
    readTrustedVisualReviewArtifact
} from './trusted-visual-review-artifact';
import type {
    TrustedFinalComparisonEvidenceInput,
    TrustedFinalComparisonEvidenceOrigin,
    TrustedFinalComparisonReplayInput
} from './trusted-final-comparison-evidence';
import type { AgentStopReason, AgentToolCallLogEntry, ContentBlock } from './types';
import { downscaleImageDataForVision } from './vision-thumbnail';

const FINAL_QUALITY_JUDGEABLE_STOP_REASONS = new Set<AgentStopReason>([
    'final_response',
    'tool_budget_final_response',
    'max_iterations',
    'performance_budget',
    'no_progress'
]);

export interface PendingTrustedFinalComparisonWrite {
    taskRunId: string;
    currentHistoryStateRef: PhotoshopHistoryStateRef;
    judgeStatus: 'completed' | 'stale';
    evidenceScope: {
        declaredReferenceCompared: boolean;
        candidateSetCompared: boolean;
    };
    origins: {
        candidateSet?: TrustedFinalComparisonEvidenceOrigin;
        declaredReference?: TrustedFinalComparisonEvidenceOrigin;
    };
    currentInput?: TrustedFinalComparisonEvidenceInput;
    trustedParentOwner?: unknown;
    trustedParentReplay?: TrustedFinalComparisonReplayInput;
}

interface FinalQualityReviewCandidate {
    reviewSet: DesignReviewSet;
    images: ToolResultImage[];
    historyStateRef: PhotoshopHistoryStateRef;
}

interface FinalQualityVisualPresentationAccounting {
    candidateCount: number;
    candidateKeys: string[];
}

export interface RunFinalQualityReviewRuntimeInput {
    task: string;
    toolCallLog: readonly AgentToolCallLogEntry[];
    reviewCandidate: FinalQualityReviewCandidate;
    preJudgeHistoryStateRef: PhotoshopHistoryStateRef;
    /**
     * 同版本结构测量是 Judge 的增强证据，不是读取最终像素的许可证。缺失时保持空测量，
     * 由 fresh_structure 单独记 needs_review；不得把全部 VLM 视觉断言一起抹成 unevaluated。
     */
    surfaceSnapshot?: DesignSurfaceSnapshot;
    pendingAssertions: DesignAssertion[];
    evaluationProfile?: DesignEvaluationProfile;
    finalReviewRequirements: {
        requireMultiSurface: boolean;
        requiredSourceKind?: string;
        requiredViews: Array<'native_surface' | 'list_thumbnail'>;
    };
    designBrief?: RuntimeDesignBriefDeclaration;
    designStrategy?: RuntimeDesignStrategyDeclaration;
    referenceBrief?: RuntimeReferenceBriefDeclaration;
    mutationBoundDesignIntents: readonly MutationBoundDesignIntent[];
    remainingVisionCandidates: number;
    taskRunId: string;
    reflexionHandoff?: ReflexionHandoff;
    configuredSoftTimeBudgetMs?: number;
    maxRequestTimeoutMs: number;
    readActiveElapsedMs: () => number;
    callModel: (
        budgetClass: 'final_quality_judge' | 'final_quality_diagnosis_repair',
        request: FinalQualityModelRequest,
        presentation: FinalQualityVisualPresentationAccounting
    ) => Promise<FinalQualityModelResponse>;
    readPostModelHistoryStateRef: () => Promise<PhotoshopHistoryStateRef | undefined>;
    isActionableDiagnosis: (result: DesignAssertionResult) => boolean;
    getResourcePreview?: (
        imagePath: string,
        maxSize?: number
    ) => Promise<{
        success: boolean;
        base64?: string;
        imageData?: string;
    } | null>;
}

export type FinalQualityReviewRuntimeResult =
    | {
        status: 'not_ready';
        staleDetail?: string;
    }
    | {
        status: 'executed';
        protocolResult: FinalQualityModelProtocolResult;
        protocolDigest: FinalQualityModelProtocolDigest;
        pendingTrustedComparisonWrite?: PendingTrustedFinalComparisonWrite;
        reviewImageCount: number;
        supportingImageCount: number;
    };

export interface FinalQualityReviewStepProjection {
    kind: 'observation' | 'warning';
    title: string;
    detail: string;
    status: 'success' | 'error';
    issue?: string;
}

export interface FinalQualityReviewOutcomeProjection {
    results: DesignAssertionResult[] | null;
    protocolDigest?: FinalQualityModelProtocolDigest;
    pendingTrustedComparisonWrite?: PendingTrustedFinalComparisonWrite;
    staleDetail?: string;
    steps: FinalQualityReviewStepProjection[];
}

export function resolveFinalQualityJudgeModelId(modelId: string): string {
    return isAgentMultimodalModelId(modelId) ? modelId : '';
}

export function isFinalQualityReviewStopReason(stopReason: AgentStopReason): boolean {
    return FINAL_QUALITY_JUDGEABLE_STOP_REASONS.has(stopReason);
}

export function projectFinalQualityReviewOutcome(input: {
    runtimeResult: FinalQualityReviewRuntimeResult;
    judgeModelId: string;
    pendingAssertionCount: number;
}): FinalQualityReviewOutcomeProjection {
    const runtimeResult = input.runtimeResult;
    if (runtimeResult.status === 'not_ready') {
        return {
            results: null,
            ...(runtimeResult.staleDetail ? { staleDetail: runtimeResult.staleDetail } : {}),
            steps: []
        };
    }
    const base = {
        protocolDigest: runtimeResult.protocolDigest,
        ...(runtimeResult.pendingTrustedComparisonWrite
            ? { pendingTrustedComparisonWrite: runtimeResult.pendingTrustedComparisonWrite }
            : {})
    };
    const protocolResult = runtimeResult.protocolResult;
    if (protocolResult.status === 'judge_time_exhausted') {
        return {
            ...base,
            results: null,
            staleDetail: '终局视觉评审的物理时间预算已耗尽，本次没有越过截止时间继续调用模型。',
            steps: []
        };
    }
    if (protocolResult.status === 'judge_stale') {
        return {
            ...base,
            results: null,
            staleDetail: '视觉评审期间 Photoshop 画面版本发生变化或无法确认，旧版本评分不会并入当前结果。',
            steps: []
        };
    }
    if (protocolResult.status === 'judge_unavailable') {
        return {
            ...base,
            results: null,
            steps: [{
                kind: 'warning',
                title: '视觉质量判定未完成',
                detail: `本次只保留确定性检查：${sanitizeUserVisibleDiagnosticText(
                    protocolResult.error instanceof Error
                        ? protocolResult.error.message
                        : String(protocolResult.error || '')
                )}`,
                status: 'error',
                issue: 'design_quality_vlm_unavailable'
            }]
        };
    }
    const steps: FinalQualityReviewStepProjection[] = [];
    const repairStep = projectFinalQualityDiagnosisRepairStep(
        protocolResult.diagnosisRepairStatus,
        protocolResult.diagnosisRepairTargetCount
    );
    if (repairStep) {
        steps.push({
            kind: repairStep.status === 'success' ? 'observation' : 'warning',
            ...repairStep
        });
    }
    steps.push({
        kind: 'observation',
        title: '设计质量已视觉判定',
        detail: `视觉判官（${input.judgeModelId}）已查看 ${runtimeResult.reviewImageCount} 个同版本成品画面${runtimeResult.supportingImageCount > 0 ? `和 ${runtimeResult.supportingImageCount} 张实际源图` : ''}，并逐条评了 ${input.pendingAssertionCount} 项主观设计标准。`,
        status: 'success'
    });
    return {
        ...base,
        results: protocolResult.results,
        steps
    };
}

function resolveComparisonEvidenceOrigin(
    compared: boolean,
    hasCurrentEvidence: boolean,
    trustedParentCompared: boolean
): TrustedFinalComparisonEvidenceOrigin | undefined {
    if (!compared) return undefined;
    if (hasCurrentEvidence) return 'current_run';
    if (trustedParentCompared) return 'trusted_parent';
    return undefined;
}

function buildPendingTrustedComparisonWrite(input: {
    taskRunId: string;
    currentHistoryStateRef: PhotoshopHistoryStateRef;
    judgeStatus: FinalQualityModelProtocolDigest['judgeStatus'];
    actualScope: {
        declaredReferenceCompared: boolean;
        candidateSetCompared: boolean;
    };
    selectedSourcePaths: string[];
    referenceBrief?: RuntimeReferenceBriefDeclaration;
    currentCandidate?: ReturnType<typeof planDesignFinalComparisonEvidence>['carryover']['candidateSet'];
    currentReferences?: ReturnType<typeof planDesignFinalComparisonEvidence>['carryover']['declaredReferences'];
    trustedParentComparisonEvidence?: ReturnType<typeof projectTrustedFinalComparisonEvidenceForReflexion>;
    reflexionHandoff?: ReflexionHandoff;
    trustedParentReplay?: TrustedFinalComparisonReplayInput;
}): PendingTrustedFinalComparisonWrite | undefined {
    if (!input.taskRunId
        || (input.judgeStatus !== 'completed' && input.judgeStatus !== 'stale')
        || (!input.actualScope.declaredReferenceCompared
            && !input.actualScope.candidateSetCompared)) {
        return undefined;
    }
    const candidateOrigin = resolveComparisonEvidenceOrigin(
        input.actualScope.candidateSetCompared,
        Boolean(input.currentCandidate),
        input.trustedParentComparisonEvidence?.evidenceScope.candidateSetCompared === true
    );
    const referenceOrigin = resolveComparisonEvidenceOrigin(
        input.actualScope.declaredReferenceCompared,
        Boolean(input.currentReferences?.length),
        input.trustedParentComparisonEvidence?.evidenceScope.declaredReferenceCompared === true
    );
    const originsComplete = (
        !input.actualScope.candidateSetCompared || Boolean(candidateOrigin)
    ) && (
        !input.actualScope.declaredReferenceCompared || Boolean(referenceOrigin)
    );
    if (!originsComplete) return undefined;

    const currentScope = {
        candidateSetCompared: candidateOrigin === 'current_run',
        declaredReferenceCompared: referenceOrigin === 'current_run'
    };
    const referenceContextProjection = currentScope.declaredReferenceCompared
        ? buildRuntimeReferenceEvaluationContext(input.referenceBrief)
        : '';
    const currentReferenceContext = referenceContextProjection || undefined;
    if (currentScope.declaredReferenceCompared && !currentReferenceContext) return undefined;

    let currentInput: TrustedFinalComparisonEvidenceInput | undefined;
    if (currentScope.candidateSetCompared || currentScope.declaredReferenceCompared) {
        currentInput = {
            taskRunId: input.taskRunId,
            parentHistoryStateRef: input.currentHistoryStateRef,
            judgeStatus: input.judgeStatus,
            evidenceScope: currentScope
        };
        if (currentScope.candidateSetCompared && input.currentCandidate) {
            currentInput.candidateSet = {
                selectedSourcePaths: input.selectedSourcePaths,
                sourceManifest: input.currentCandidate.sourceManifest,
                image: {
                    evidenceId: input.currentCandidate.evidenceId,
                    sourceKind: 'candidate_set',
                    sourceId: input.currentCandidate.evidenceId,
                    image: input.currentCandidate.image
                }
            };
        }
        if (currentScope.declaredReferenceCompared
            && input.currentReferences?.length
            && currentReferenceContext) {
            currentInput.declaredReferences = input.currentReferences.map((reference) => ({
                evidenceId: reference.evidenceId,
                sourceKind: reference.sourceKind,
                sourceId: reference.sourceId,
                observationSourceId: reference.observationSourceId,
                image: reference.image
            }));
            currentInput.referenceContext = currentReferenceContext;
        }
    }

    const usesTrustedParent = candidateOrigin === 'trusted_parent'
        || referenceOrigin === 'trusted_parent';
    return {
        taskRunId: input.taskRunId,
        currentHistoryStateRef: input.currentHistoryStateRef,
        judgeStatus: input.judgeStatus,
        evidenceScope: input.actualScope,
        origins: {
            ...(candidateOrigin ? { candidateSet: candidateOrigin } : {}),
            ...(referenceOrigin ? { declaredReference: referenceOrigin } : {})
        },
        ...(currentInput ? { currentInput } : {}),
        ...(usesTrustedParent ? {
            trustedParentOwner: input.reflexionHandoff,
            trustedParentReplay: input.trustedParentReplay
        } : {})
    };
}

export async function runFinalQualityReviewRuntime(
    input: RunFinalQualityReviewRuntimeInput,
    judgeModelId: string
): Promise<FinalQualityReviewRuntimeResult> {
    const structureConcernReport = buildDesignFinalReviewStructureEvidence(input.toolCallLog);
    const requiredStructureEvidenceRefs = Array.from(new Set(
        structureConcernReport.concerns.map((concern) => concern.evidenceId)
    ));
    const mutationBoundDesignIntent = formatMutationBoundDesignIntentForReview(
        input.mutationBoundDesignIntents,
        input.preJudgeHistoryStateRef.documentId
    );
    const reviewTargetInventory = input.reviewCandidate.reviewSet.items.map((item, index) => ({
        imageIndex: index + 1,
        sourceId: item.identity.sourceId,
        observationKey: item.observationKey
    }));
    const targetBindingInstruction = reviewTargetInventory.length > 1
        ? [
            '本次输入是一个完整多画面 ReviewSet。非通过项 diagnosis.visualFinding.target 必须原样填写下列某个 sourceId 或 observationKey；无法定位时不要输出 diagnosis。',
            JSON.stringify(reviewTargetInventory)
        ].join('\n')
        : '';
    const judgeSystemPrompt = [
        buildVlmJudgeSystemPrompt(input.pendingAssertions),
        targetBindingInstruction
    ].filter(Boolean).join('\n\n');
    const selectedReviewSet = selectDesignReviewSetForFinalJudge(
        input.reviewCandidate.reviewSet,
        {
            currentVersion: {
                document: String(input.preJudgeHistoryStateRef.documentId || ''),
                history: String(input.preJudgeHistoryStateRef.historyStateId || '')
            },
            ...input.finalReviewRequirements
        }
    );
    if (selectedReviewSet.status !== 'ready') {
        return {
            status: 'not_ready',
            staleDetail: `终审视觉证据不完整（${selectedReviewSet.reasons.join('、')}），不会用部分画面替整份设计打分。`
        };
    }
    const reviewVisionCandidateKeys = selectedReviewSet.reviewSet.items.map((item) => (
        item.observationKey
    ));
    const derivedViewReserve = input.finalReviewRequirements.requiredViews
        .includes('list_thumbnail') ? 1 : 0;
    const reviewImagePlan = planDesignReviewImages(selectedReviewSet.reviewSet, {
        maxTotalImages: Math.max(0, input.remainingVisionCandidates - derivedViewReserve)
    });
    if (reviewImagePlan.status !== 'ready') {
        return {
            status: 'not_ready',
            staleDetail: `终审需要 ${reviewImagePlan.requiredImages + derivedViewReserve} 张画面（含 Evaluation Profile 声明的真实使用视图），但本轮只剩 ${input.remainingVisionCandidates} 个视觉候选额度；本次不丢图、不伪造通过。`
        };
    }
    const primaryReviewImage = input.reviewCandidate.images[0];
    const primaryReviewItem = reviewImagePlan.items[0];
    if (!primaryReviewImage?.data || !primaryReviewItem?.observationKey) {
        return { status: 'not_ready' };
    }
    const derivedReviewViewPayload = await buildDesignFinalReviewDerivedViewPayload({
        requiredViews: input.finalReviewRequirements.requiredViews,
        sourceImage: primaryReviewImage,
        sourceObservationKey: primaryReviewItem.observationKey,
        buildThumbnail: downscaleImageDataForVision
    });
    if (derivedReviewViewPayload.status === 'unavailable') {
        return {
            status: 'not_ready',
            staleDetail: 'Evaluation Profile 要求检查真实使用尺寸，但同版本缩略视图生成失败；本次不用原图推测缩略效果。'
        };
    }

    const priorTrustedVisualArtifact = readTrustedVisualReviewArtifact(input.reflexionHandoff);
    const supportingSourceSelection = selectFinalSupportingSourcePlacements({
        toolCallLog: input.toolCallLog,
        historyStateRef: input.preJudgeHistoryStateRef,
        maxImages: 3,
        priorVerifiedPlacements: priorTrustedVisualArtifact?.supportingSourcePlacements
    });
    const selectedSourcePaths = supportingSourceSelection.coverage.status === 'complete'
        ? supportingSourceSelection.placements.map((placement) => placement.path)
        : [];
    const reflexionReviewBinding = input.reflexionHandoff?.reviewBinding;
    const trustedParentReplay: TrustedFinalComparisonReplayInput | undefined =
        priorTrustedVisualArtifact?.finalComparisonEvidence
        && input.taskRunId
        && reflexionReviewBinding
        ? {
            taskRunId: input.taskRunId,
            expectedParentHistoryStateRef: {
                documentId: reflexionReviewBinding.documentId,
                historyStateId: reflexionReviewBinding.historyStateId
            },
            currentHistoryStateRef: input.preJudgeHistoryStateRef,
            currentSelectedSourcePaths: selectedSourcePaths
        }
        : undefined;
    const trustedParentComparisonEvidence = trustedParentReplay
        ? projectTrustedFinalComparisonEvidenceForReflexion(
            input.reflexionHandoff,
            trustedParentReplay
        )
        : undefined;
    const candidateSetReplays = collectDesignFinalCandidateSetReplays(input.toolCallLog);
    const declaredReferenceReplays = collectDesignFinalDeclaredReferenceReplays({
        declaration: input.referenceBrief,
        toolCallLog: input.toolCallLog
    });
    const comparisonCapacityBeforeSources = Math.max(
        0,
        input.remainingVisionCandidates
            - reviewImagePlan.totalImages
            - derivedReviewViewPayload.candidateCount
    );
    const supportingImageResult = await loadDesignFinalReviewSupportingImages({
        toolCallLog: input.toolCallLog,
        historyStateRef: input.preJudgeHistoryStateRef,
        maxImages: comparisonCapacityBeforeSources,
        priorVerifiedPlacements: priorTrustedVisualArtifact?.supportingSourcePlacements,
        getResourcePreview: input.getResourcePreview
    });
    const supportingImages = supportingImageResult.images;
    const comparisonEvidencePlan = planDesignFinalComparisonEvidence({
        referenceBrief: input.referenceBrief,
        declaredReferences: declaredReferenceReplays,
        candidateSets: candidateSetReplays,
        selectedSourcePaths,
        trustedParentEvidence: trustedParentComparisonEvidence,
        availableImageSlots: Math.max(
            0,
            comparisonCapacityBeforeSources - supportingImages.length
        )
    });
    const supportingSources = projectDesignFinalReviewSupportingSources(supportingImages);
    const baseJudgeContextMessage = buildDesignFinalReviewModelContext({
        task: input.task,
        designBrief: input.designBrief,
        designStrategy: input.designStrategy,
        referenceBrief: input.referenceBrief,
        evaluationGoal: input.evaluationProfile?.capabilityGoal,
        measurements: extractDesignQualityMeasurements(input.surfaceSnapshot),
        mutationBoundDesignIntent,
        structureConcernReport,
        supportingSources,
        supportingSourceCoverage: supportingImageResult.coverage,
        reviewSetIdentity: {
            document: input.reviewCandidate.reviewSet.document,
            history: input.reviewCandidate.reviewSet.history,
            expectedObservationCount: input.reviewCandidate.reviewSet.expectedObservationCount,
            targets: reviewTargetInventory
        }
    });
    const judgeContextMessage = [
        baseJudgeContextMessage,
        comparisonEvidencePlan.contextMessage
    ].filter(Boolean).join('\n\n');
    const reviewImageBlocks: ContentBlock[] = [];
    for (let index = 0; index < reviewImagePlan.items.length; index += 1) {
        const reviewItem = reviewImagePlan.items[index];
        const image = input.reviewCandidate.images[index];
        if (!image?.data) return { status: 'not_ready' };
        reviewImageBlocks.push({
            type: 'text',
            text: `画面 ${index + 1}｜sourceId=${reviewItem.identity.sourceId}｜observationKey=${reviewItem.observationKey}`
        });
        reviewImageBlocks.push({
            type: 'image',
            data: image.data,
            mediaType: image.mediaType
        });
    }
    const supportingImagePayload = buildDesignFinalReviewSupportingImagePayload(supportingImages);
    const judgeVisionCandidateKeys = [
        ...reviewVisionCandidateKeys,
        ...derivedReviewViewPayload.candidateKeys,
        ...supportingImagePayload.candidateKeys,
        ...comparisonEvidencePlan.candidateKeys
    ];
    const judgeVisionCandidateCount = reviewImagePlan.totalImages
        + derivedReviewViewPayload.candidateCount
        + supportingImagePayload.candidateCount
        + comparisonEvidencePlan.candidateCount;
    const judgeContentBlocks: ContentBlock[] = [
        ...reviewImageBlocks,
        ...derivedReviewViewPayload.contentBlocks,
        ...supportingImagePayload.contentBlocks,
        ...comparisonEvidencePlan.contentBlocks
    ];
    const presentation = {
        candidateCount: judgeVisionCandidateCount,
        candidateKeys: judgeVisionCandidateKeys
    };
    const protocolResult = await runFinalQualityModelProtocol({
        judgeSystemPrompt,
        targetBindingInstruction,
        contextMessage: judgeContextMessage,
        contentBlocks: judgeContentBlocks,
        visualPresentationCandidateKeys: judgeVisionCandidateKeys,
        visualPresentationReceiptPolicy: isCodexSubscriptionModel(getModelById(judgeModelId))
            ? 'required'
            : 'optional',
        allowedDiagnosisTargets: reviewTargetInventory.length > 1
            ? reviewTargetInventory.flatMap((target) => [target.sourceId, target.observationKey])
            : undefined,
        pending: input.pendingAssertions,
        requiredEvidenceRefsByAssertion: requiredStructureEvidenceRefs.length > 0
            ? { 'craft.structure-intent-coherence': requiredStructureEvidenceRefs }
            : undefined,
        expectedHistoryStateRef: input.reviewCandidate.historyStateRef,
        configuredSoftTimeBudgetMs: input.configuredSoftTimeBudgetMs,
        maxRequestTimeoutMs: input.maxRequestTimeoutMs,
        readActiveElapsedMs: input.readActiveElapsedMs,
        callJudge: (request) => input.callModel('final_quality_judge', request, presentation),
        callDiagnosisRepair: (request) => input.callModel(
            'final_quality_diagnosis_repair',
            request,
            presentation
        ),
        readPostModelHistoryStateRef: input.readPostModelHistoryStateRef
    });
    const protocolDigest = projectFinalQualityModelProtocolDigest(
        protocolResult,
        (protocolResult.results || []).filter(input.isActionableDiagnosis).length,
        reviewImagePlan.totalImages > 0,
        supportingImagePayload.candidateCount > 0,
        comparisonEvidencePlan.evidenceScope,
        {
            candidateKeys: judgeVisionCandidateKeys,
            contentBlocks: judgeContentBlocks
        }
    );
    const actualComparisonScope = {
        declaredReferenceCompared: protocolDigest.evidenceScope.declaredReferenceCompared,
        candidateSetCompared: protocolDigest.evidenceScope.candidateSetCompared
    };
    const pendingTrustedComparisonWrite = buildPendingTrustedComparisonWrite({
        taskRunId: input.taskRunId,
        currentHistoryStateRef: input.preJudgeHistoryStateRef,
        judgeStatus: protocolDigest.judgeStatus,
        actualScope: actualComparisonScope,
        selectedSourcePaths,
        referenceBrief: input.referenceBrief,
        currentCandidate: comparisonEvidencePlan.carryover.candidateSet,
        currentReferences: comparisonEvidencePlan.carryover.declaredReferences,
        trustedParentComparisonEvidence,
        reflexionHandoff: input.reflexionHandoff,
        trustedParentReplay
    });
    return {
        status: 'executed',
        protocolResult,
        protocolDigest,
        ...(pendingTrustedComparisonWrite ? { pendingTrustedComparisonWrite } : {}),
        reviewImageCount: reviewImagePlan.totalImages + derivedReviewViewPayload.candidateCount,
        supportingImageCount: supportingImages.length
    };
}
