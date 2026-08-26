import type { DesignRunSupportingSourcePlacement } from '../../../shared/design-run-tool-log-facts';
import type { PhotoshopHistoryStateRef } from '../../../shared/photoshop-history-state-ref';
import {
    buildDesignReviewSetFromBundle,
    buildDesignReviewSetFromSingleSurface,
    VISUAL_OBSERVATION_BUNDLE_VERSION,
    type DesignReviewSet,
    type VisualObservationReceipt
} from '../../../shared/visual-observation-bundle';
import {
    buildTrustedFinalComparisonEvidence,
    cloneTrustedFinalComparisonEvidence,
    mergeTrustedFinalComparisonEvidenceAfterJudge,
    projectTrustedFinalComparisonEvidenceForReflexion as projectComparisonEvidenceForReflexion,
    rebindTrustedFinalComparisonEvidenceForReflexion,
    type TrustedFinalComparisonEvidence,
    type TrustedFinalComparisonEvidenceInput,
    type TrustedFinalComparisonEvidenceOrigin,
    type TrustedFinalComparisonReplayInput,
    type TrustedFinalComparisonReplayProjection
} from './trusted-final-comparison-evidence';

/**
 * 运行内可信视觉证据投影。
 *
 * 像素在 Agent.run 返回前会从 Tool log 原位压缩；这里保存的是压缩前复制出的
 * ReviewSet，并通过 WeakMap 的 owner 对象身份签发。它不是质量 Verdict，也不进入
 * RuntimeSession / Project State / 模型上下文。
 */
export interface TrustedVisualReviewArtifact {
    receipt: VisualObservationReceipt;
    reviewSet: DesignReviewSet;
    historyStateRef: PhotoshopHistoryStateRef;
    observationKeys: readonly string[];
    /** 子 Agent 已真实读取并提交结构化 reviewDecision 的子集。 */
    reviewedObservationKeys: readonly string[];
    /** 只由 reviewedObservationKeys 精确覆盖 ReviewSet 时派生，调用方不能自行声明。 */
    fullyReviewed: boolean;
    /**
     * 本 ReviewSet 实际比较过的最终可见图层来源。仅保存有界的事实投影，不保存 Tool log；
     * Reflexion 子代仍须在自己的同文档 AcceptanceSnapshot 上重新验证图层存在与可见性。
     */
    supportingSourcePlacements?: readonly DesignRunSupportingSourcePlacement[];
    /**
     * 父代 Final Judge 实际收到的有界候选 / 参考 presentation。仍由同一个 WeakMap owner
     * 持有，不进入 RuntimeSession、Run Record 或 Project State。
     */
    finalComparisonEvidence?: TrustedFinalComparisonEvidence;
}

const TRUSTED_VISUAL_REVIEW_ARTIFACTS = new WeakMap<object, TrustedVisualReviewArtifact>();
const MAX_TRUSTED_SUPPORTING_SOURCE_PLACEMENTS = 3;
const TRUSTED_SUPPORTING_SOURCE_TOOLS = new Set<DesignRunSupportingSourcePlacement['sourceTool']>([
    'placeImage',
    'composeDesign',
    'replaceLayerContent',
    'replaceImagePlaceholder',
    'replaceSmartObjectContents'
]);
const TRUSTED_SUPPORTING_SOURCE_SLOTS = new Set<DesignRunSupportingSourcePlacement['sourceSlot']>([
    'direct_placement',
    'subject',
    'background',
    'layout_region'
]);

function cloneSupportingSourcePlacements(
    value: readonly DesignRunSupportingSourcePlacement[] | undefined,
    documentId: number
): DesignRunSupportingSourcePlacement[] {
    if (!Array.isArray(value) || value.length > MAX_TRUSTED_SUPPORTING_SOURCE_PLACEMENTS) return [];
    const cloned: DesignRunSupportingSourcePlacement[] = [];
    const seenLayerIds = new Set<number>();
    const seenPaths = new Set<string>();
    for (const candidate of value) {
        const path = String(candidate?.path || '').trim();
        const layerId = Number(candidate?.layerId);
        const candidateDocumentId = Number(candidate?.documentId);
        const pathKey = path.replace(/\\/gu, '/').toLowerCase();
        if (candidate?.version !== 'design-run-supporting-source-placement/v0'
            || candidate?.usage !== 'supporting_source'
            || !TRUSTED_SUPPORTING_SOURCE_TOOLS.has(candidate.sourceTool)
            || !TRUSTED_SUPPORTING_SOURCE_SLOTS.has(candidate.sourceSlot)
            || !path
            || path.length > 4096
            || /^data:|^[a-z][a-z0-9+.-]*:\/\//iu.test(path)
            || !Number.isSafeInteger(layerId)
            || layerId <= 0
            || candidateDocumentId !== documentId
            || seenLayerIds.has(layerId)
            || seenPaths.has(pathKey)
            || candidate.boundaries?.extractedFromSuccessfulToolCall !== true
            || candidate.boundaries?.ranksCandidates !== false
            || candidate.boundaries?.selectsWinner !== false
            || candidate.boundaries?.countsAsFinalSurface !== false
            || candidate.boundaries?.countsAsDeliveryEvidence !== false) continue;
        seenLayerIds.add(layerId);
        seenPaths.add(pathKey);
        cloned.push({
            version: 'design-run-supporting-source-placement/v0',
            path,
            sourceTool: candidate.sourceTool,
            sourceSlot: candidate.sourceSlot,
            ...(candidate.declaredRole
                ? { declaredRole: String(candidate.declaredRole).trim().slice(0, 80) }
                : {}),
            ...(candidate.declaredRegionId
                ? { declaredRegionId: String(candidate.declaredRegionId).trim().slice(0, 160) }
                : {}),
            layerId,
            documentId: candidateDocumentId,
            usage: 'supporting_source',
            boundaries: {
                extractedFromSuccessfulToolCall: true,
                ranksCandidates: false,
                selectsWinner: false,
                countsAsFinalSurface: false,
                countsAsDeliveryEvidence: false
            }
        });
    }
    return cloned;
}

function cloneReceipt(receipt: VisualObservationReceipt): VisualObservationReceipt {
    return {
        version: receipt.version,
        document: receipt.document,
        history: receipt.history,
        sourceTool: receipt.sourceTool
    };
}

function rebuildReviewSet(reviewSet: DesignReviewSet): DesignReviewSet | undefined {
    if (reviewSet.source === 'single_surface') {
        const item = reviewSet.items[0];
        if (!item || reviewSet.items.length !== 1) return undefined;
        const rebuilt = buildDesignReviewSetFromSingleSurface({
            identity: { ...item.identity },
            image: { ...item.image }
        });
        return rebuilt.status === 'ready' ? rebuilt.reviewSet : undefined;
    }
    const rebuilt = buildDesignReviewSetFromBundle({
        version: VISUAL_OBSERVATION_BUNDLE_VERSION,
        expectedObservationCount: reviewSet.expectedObservationCount,
        ...(reviewSet.coverageBasis === 'declared_targets'
            ? { expectedTargets: reviewSet.expectedTargets.map((target) => ({ ...target })) }
            : {}),
        items: reviewSet.items.map((item) => ({
            identity: { ...item.identity },
            captured: true,
            image: { ...item.image }
        }))
    });
    return rebuilt.status === 'ready' ? rebuilt.reviewSet : undefined;
}

function validateArtifact(
    artifact: TrustedVisualReviewArtifact
): TrustedVisualReviewArtifact | undefined {
    const reviewSet = rebuildReviewSet(artifact.reviewSet);
    if (!reviewSet) return undefined;
    const documentId = String(artifact.historyStateRef?.documentId || '').trim();
    const historyStateId = String(artifact.historyStateRef?.historyStateId || '').trim();
    const observationKeys = reviewSet.items.map((item) => item.observationKey);
    const reviewedObservationKeys = Array.from(new Set(artifact.reviewedObservationKeys
        .map((key) => String(key || '').trim())
        .filter(Boolean)));
    if (!documentId
        || !historyStateId
        || reviewSet.document !== documentId
        || reviewSet.history !== historyStateId
        || artifact.receipt.document !== documentId
        || artifact.receipt.history !== historyStateId
        || !String(artifact.receipt.sourceTool || '').trim()
        || observationKeys.length !== reviewSet.expectedObservationCount
        || observationKeys.length !== artifact.observationKeys.length
        || new Set(observationKeys).size !== observationKeys.length
        || observationKeys.some((key) => !artifact.observationKeys.includes(key))
        || reviewedObservationKeys.some((key) => !observationKeys.includes(key))) {
        return undefined;
    }
    const supportingSourcePlacements = cloneSupportingSourcePlacements(
        artifact.supportingSourcePlacements,
        artifact.historyStateRef.documentId
    );
    const finalComparisonEvidence = artifact.finalComparisonEvidence
        ? cloneTrustedFinalComparisonEvidence({
            value: artifact.finalComparisonEvidence,
            artifactHistoryStateRef: artifact.historyStateRef
        })
        : undefined;
    if (artifact.finalComparisonEvidence && !finalComparisonEvidence) return undefined;
    return {
        receipt: cloneReceipt(artifact.receipt),
        reviewSet,
        historyStateRef: {
            documentId: artifact.historyStateRef.documentId,
            historyStateId: artifact.historyStateRef.historyStateId
        },
        observationKeys,
        reviewedObservationKeys,
        fullyReviewed: reviewedObservationKeys.length === observationKeys.length,
        ...(supportingSourcePlacements.length > 0 ? { supportingSourcePlacements } : {}),
        ...(finalComparisonEvidence ? { finalComparisonEvidence } : {})
    };
}

export function writeTrustedVisualReviewArtifact(
    owner: object,
    artifact: TrustedVisualReviewArtifact
): boolean {
    const validated = validateArtifact(artifact);
    if (!validated) return false;
    TRUSTED_VISUAL_REVIEW_ARTIFACTS.set(owner, validated);
    return true;
}

export function readTrustedVisualReviewArtifact(
    owner: unknown
): TrustedVisualReviewArtifact | undefined {
    if (!owner || typeof owner !== 'object') return undefined;
    const artifact = TRUSTED_VISUAL_REVIEW_ARTIFACTS.get(owner);
    return artifact ? validateArtifact(artifact) : undefined;
}

/**
 * 在父代 Judge 已实际返回后，把本次确实比较过的像素签进现有 Artifact owner。
 * 非法或不完整输入不会覆盖已有 Artifact，也不会只保存 scope 布尔。
 */
export function writeTrustedFinalComparisonEvidence(
    owner: unknown,
    input: TrustedFinalComparisonEvidenceInput
): boolean {
    const artifact = readTrustedVisualReviewArtifact(owner);
    if (!artifact || !owner || typeof owner !== 'object') return false;
    const evidence = buildTrustedFinalComparisonEvidence({
        value: input,
        artifactHistoryStateRef: artifact.historyStateRef
    });
    if (!evidence) return false;
    if (artifact.finalComparisonEvidence) {
        return artifact.finalComparisonEvidence.parentJudgeInputDigest
            === evidence.parentJudgeInputDigest;
    }
    return writeTrustedVisualReviewArtifact(owner, {
        ...artifact,
        finalComparisonEvidence: evidence
    });
}

/**
 * 子代必须提供父 history、当前文档 history 与当前真实 selected-source 集合。
 * 父代 exact presentation 已由同一 WeakMap owner 保存并逐次校验，子代不重跑参考或候选
 * Tool；候选与参考独立失败关闭，本函数也不承担调用方视觉预算分配。
 */
export function projectTrustedFinalComparisonEvidenceForReflexion(
    owner: unknown,
    replay: TrustedFinalComparisonReplayInput
): TrustedFinalComparisonReplayProjection {
    const artifact = readTrustedVisualReviewArtifact(owner);
    if (!artifact) {
        return {
            evidenceScope: {
                declaredReferenceCompared: false,
                candidateSetCompared: false
            },
            reasonCodes: ['artifact_missing'],
            requiredImageCount: 0
        };
    }
    return projectComparisonEvidenceForReflexion({
        evidence: artifact.finalComparisonEvidence,
        replay
    });
}

export function promoteTrustedFinalComparisonEvidenceAfterReflexionJudge(input: {
    sourceOwner: unknown;
    targetOwner: unknown;
    replay: TrustedFinalComparisonReplayInput;
    judgeStatus: 'completed' | 'stale';
    evidenceScope: {
        declaredReferenceCompared: boolean;
        candidateSetCompared: boolean;
    };
}): boolean {
    if (!input.targetOwner || typeof input.targetOwner !== 'object') return false;
    const sourceArtifact = readTrustedVisualReviewArtifact(input.sourceOwner);
    const targetArtifact = readTrustedVisualReviewArtifact(input.targetOwner);
    if (!sourceArtifact?.finalComparisonEvidence || !targetArtifact) return false;
    const evidence = rebindTrustedFinalComparisonEvidenceForReflexion({
        evidence: sourceArtifact.finalComparisonEvidence,
        replay: input.replay,
        currentArtifactHistoryStateRef: targetArtifact.historyStateRef,
        judgeStatus: input.judgeStatus,
        evidenceScope: input.evidenceScope
    });
    if (!evidence) return false;
    if (targetArtifact.finalComparisonEvidence) {
        return targetArtifact.finalComparisonEvidence.parentJudgeInputDigest
            === evidence.parentJudgeInputDigest;
    }
    return writeTrustedVisualReviewArtifact(input.targetOwner, {
        ...targetArtifact,
        finalComparisonEvidence: evidence
    });
}

export function writeTrustedFinalComparisonEvidenceAfterJudge(input: {
    targetOwner: unknown;
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
}): boolean {
    if (!input.targetOwner || typeof input.targetOwner !== 'object') return false;
    const targetArtifact = readTrustedVisualReviewArtifact(input.targetOwner);
    if (!targetArtifact
        || targetArtifact.historyStateRef.documentId !== input.currentHistoryStateRef.documentId
        || targetArtifact.historyStateRef.historyStateId !== input.currentHistoryStateRef.historyStateId) {
        return false;
    }
    const currentEvidence = input.currentInput
        ? buildTrustedFinalComparisonEvidence({
            value: input.currentInput,
            artifactHistoryStateRef: targetArtifact.historyStateRef
        })
        : undefined;
    if (input.currentInput && !currentEvidence) return false;
    const trustedParentEvidence = readTrustedVisualReviewArtifact(
        input.trustedParentOwner
    )?.finalComparisonEvidence;
    const evidence = mergeTrustedFinalComparisonEvidenceAfterJudge({
        taskRunId: input.taskRunId,
        currentHistoryStateRef: targetArtifact.historyStateRef,
        judgeStatus: input.judgeStatus,
        evidenceScope: input.evidenceScope,
        origins: input.origins,
        currentEvidence,
        trustedParentEvidence,
        trustedParentReplay: input.trustedParentReplay
    });
    if (!evidence) return false;
    if (targetArtifact.finalComparisonEvidence) {
        return targetArtifact.finalComparisonEvidence.parentJudgeInputDigest
            === evidence.parentJudgeInputDigest;
    }
    return writeTrustedVisualReviewArtifact(input.targetOwner, {
        ...targetArtifact,
        finalComparisonEvidence: evidence
    });
}

export function transferTrustedVisualReviewArtifact(
    sourceOwner: unknown,
    targetOwner: unknown
): boolean {
    if (!targetOwner || typeof targetOwner !== 'object') return false;
    const artifact = readTrustedVisualReviewArtifact(sourceOwner);
    if (!artifact) return false;
    const existing = readTrustedVisualReviewArtifact(targetOwner);
    if (existing) {
        return existing.historyStateRef.documentId === artifact.historyStateRef.documentId
            && existing.historyStateRef.historyStateId === artifact.historyStateRef.historyStateId
            && existing.observationKeys.length === artifact.observationKeys.length
            && existing.observationKeys.every((key) => artifact.observationKeys.includes(key))
            && existing.finalComparisonEvidence?.parentJudgeInputDigest
                === artifact.finalComparisonEvidence?.parentJudgeInputDigest;
    }
    return writeTrustedVisualReviewArtifact(targetOwner, artifact);
}
