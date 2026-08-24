import { DESIGN_ECHO_TARGET_GUARD_ARGUMENT } from '../../../shared/agent-tool-execution-preflight';
import { readPhotoshopHistoryStateRef, type PhotoshopHistoryStateRef } from '../../../shared/photoshop-history-state-ref';
import {
    evaluateCompletedReflexionWriteFreshness,
    type ReflexionHandoffLike
} from '../../../shared/reflexion-reentry-policy';
import { readAgentVisualObservations } from './visual-observation-strategy';

interface CurrentVisualReviewLike {
    reviewSet: {
        expectedObservationCount: number;
        items: ReadonlyArray<{ observationKey: string }>;
    };
    historyStateRef: PhotoshopHistoryStateRef;
    sourceOutput: unknown;
}

function projectCurrentVisualReview(candidate?: CurrentVisualReviewLike | null): {
    historyStateRef: PhotoshopHistoryStateRef;
    observationKeys: string[];
    fullyReviewed: boolean;
} | undefined {
    if (!candidate) return undefined;
    const observationKeys = candidate.reviewSet.items.map((item) => item.observationKey);
    const reviewedKeys = new Set(readAgentVisualObservations(candidate.sourceOutput)
        .filter((observation) => observation.reviewed === true)
        .map((observation) => String(observation.observationKey || '').trim())
        .filter(Boolean));
    return {
        historyStateRef: { ...candidate.historyStateRef },
        observationKeys,
        fullyReviewed: observationKeys.length === candidate.reviewSet.expectedObservationCount
            && observationKeys.every((key) => reviewedKeys.has(key))
    };
}

/**
 * Convert the pure version decision into a Tool-result control signal. This runs after the normal
 * target guard has been signed and before the real Tool executor is called. It never chooses which
 * visual observation Tool the Agent should use to recover.
 */
export function buildCompletedReflexionWriteFreshnessBlock(input: {
    handoff?: ReflexionHandoffLike | null;
    executionKind: string;
    executionArguments: Record<string, unknown>;
    hasGenerationMutation: boolean;
    currentVisualReview?: CurrentVisualReviewLike | null;
    toolName: string;
}): Record<string, unknown> | undefined {
    const privateTargetGuard = input.executionArguments[DESIGN_ECHO_TARGET_GUARD_ARGUMENT] as {
        expectedHistoryStateRef?: unknown;
    } | undefined;
    const targetRevision = readPhotoshopHistoryStateRef({
        historyStateRef: privateTargetGuard?.expectedHistoryStateRef
    });
    const decision = evaluateCompletedReflexionWriteFreshness({
        handoff: input.handoff,
        executionKind: input.executionKind,
        hasGenerationMutation: input.hasGenerationMutation,
        targetRevision,
        currentVisualReview: projectCurrentVisualReview(input.currentVisualReview)
    });
    if (decision.allowed) return undefined;
    const missingTargetRevision = decision.status === 'missing_target_revision';
    const error = missingTargetRevision
        ? '这次写入所依据的 Photoshop 版本还没有确认。请先读取当前完整画面，再独立判断是否需要修改。'
        : '当前 Photoshop 画面已不是上一版评价时的版本。请先选择适合当前任务的视觉观察能力读取完整当前画面，再独立判断是否仍需修改；不要直接套用上一版建议。';
    return {
        success: false,
        code: missingTargetRevision
            ? 'reflexion_review_target_revision_missing'
            : 'reflexion_review_revision_changed',
        policyGate: true,
        blockedTool: input.toolName,
        error,
        executesPhotoshop: false,
        grantsPermission: false,
        countsAsObservation: false,
        countsAsTaskProgress: false,
        countsAsRuntimeToolCall: false,
        recoveryRequirement: 'observe_current_complete_visual_before_reconsidering_write'
    };
}
