import type { PhotoshopHistoryStateRef } from '../../../shared/photoshop-history-state-ref';
import {
    buildDesignReviewSetFromBundle,
    buildDesignReviewSetFromSingleSurface,
    VISUAL_OBSERVATION_BUNDLE_VERSION,
    type DesignReviewSet,
    type VisualObservationReceipt
} from '../../../shared/visual-observation-bundle';

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
}

const TRUSTED_VISUAL_REVIEW_ARTIFACTS = new WeakMap<object, TrustedVisualReviewArtifact>();

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
    return {
        receipt: cloneReceipt(artifact.receipt),
        reviewSet,
        historyStateRef: {
            documentId: artifact.historyStateRef.documentId,
            historyStateId: artifact.historyStateRef.historyStateId
        },
        observationKeys,
        reviewedObservationKeys,
        fullyReviewed: reviewedObservationKeys.length === observationKeys.length
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

export function transferTrustedVisualReviewArtifact(
    sourceOwner: unknown,
    targetOwner: unknown
): boolean {
    if (!targetOwner || typeof targetOwner !== 'object') return false;
    const artifact = readTrustedVisualReviewArtifact(sourceOwner);
    return artifact ? writeTrustedVisualReviewArtifact(targetOwner, artifact) : false;
}
