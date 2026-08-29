/**
 * Final-quality Host evidence acquisition.
 *
 * This module only performs read-only, revision-bound Photoshop observations for the
 * existing quality verifier. It never evaluates aesthetics, selects a design action,
 * mutates a document, or grants Tool permission.
 */

import type { PhotoshopHistoryStateRef } from '../../../shared/photoshop-history-state-ref';
import {
    readPhotoshopHistoryStateRef,
    samePhotoshopHistoryStateRef
} from '../../../shared/photoshop-history-state-ref';
import { buildDesignQualityVerificationToolRequests } from './design-final-review-evidence';
import type { AgentToolCallLogEntry } from './types';
import {
    deriveAgentVisualObservationReceipt,
    writeAgentVisualObservationReceipt
} from './visual-observation-strategy';

export type FinalQualityVerificationPhase = 'pre_judge' | 'post_judge' | 'final_summary';
export type FinalQualityFullSurfaceToolName = 'getCanvasSnapshot' | 'getDocumentSnapshot';

export interface FinalQualityReviewedVisualBinding {
    historyStateRef: PhotoshopHistoryStateRef;
    sourceOutput: Record<string, unknown>;
}

export interface FinalQualityHostEvidenceContext {
    executeTool: (name: string, args: Record<string, unknown>) => Promise<any>;
    recordToolCall: (durationMs: number, succeeded: boolean) => void;
    appendToolCall: (entry: AgentToolCallLogEntry) => void;
    readElapsedMs: () => number | undefined;
}

export function selectFinalQualityFullSurfaceToolName(input: {
    availableToolNames: readonly string[];
    isVisible: (name: FinalQualityFullSurfaceToolName) => boolean;
}): FinalQualityFullSurfaceToolName | undefined {
    return (['getCanvasSnapshot', 'getDocumentSnapshot'] as const).find((name) => (
        input.availableToolNames.includes(name) && input.isVisible(name)
    ));
}

export function isFinalQualityReviewedVisualSource(input: {
    binding?: FinalQualityReviewedVisualBinding;
    sourceOutput: unknown;
    historyStateRef?: PhotoshopHistoryStateRef;
}): boolean {
    const binding = input.binding;
    const historyStateRef = input.historyStateRef;
    if (!binding || !historyStateRef || binding.sourceOutput !== input.sourceOutput) return false;
    return samePhotoshopHistoryStateRef(binding.historyStateRef, historyStateRef);
}

export function selectFinalQualityReviewSet<T extends {
    images: { length: number };
    reviewSet: {
        source: 'visual_observation_bundle' | 'single_surface';
        expectedObservationCount: number;
        items: { length: number };
    };
}>(input: {
    bundle?: T;
    single?: T;
    requireMultiSurface: boolean;
}): T | null {
    // ReviewSet 类型是终局证据身份，不是可降级的偏好顺序。同版本 Bundle 可能承载
    // 素材候选、局部画面或多屏目标，不能证明单画布成品已被完整观察。两种终局契约
    // 必须保持互斥，否则 Judge 会看辅助素材，而 E2 又会正确拒绝它作为全画布预览。
    const candidate = input.requireMultiSurface ? input.bundle : input.single;
    const requiredSource = input.requireMultiSurface
        ? 'visual_observation_bundle'
        : 'single_surface';
    return candidate
        && candidate.reviewSet.source === requiredSource
        && candidate.images.length === candidate.reviewSet.expectedObservationCount
        && candidate.reviewSet.items.length === candidate.reviewSet.expectedObservationCount
        ? candidate
        : null;
}

function appendHostObservation(input: {
    context: FinalQualityHostEvidenceContext;
    name: string;
    arguments: Record<string, unknown>;
    result: any;
    phase: FinalQualityVerificationPhase;
    startedAtMs: number;
}): void {
    const durationMs = Date.now() - input.startedAtMs;
    input.context.recordToolCall(durationMs, input.result?.success !== false);
    const elapsedMs = input.context.readElapsedMs();
    input.context.appendToolCall({
        name: input.name,
        arguments: input.arguments,
        result: input.result,
        origin: 'harness_quality_verification',
        qualityVerificationPhase: input.phase,
        ...(elapsedMs !== undefined ? { elapsedMs } : {})
    });
}

export async function readFinalQualityCurrentHistoryStateRef(input: {
    context: FinalQualityHostEvidenceContext;
    phase: FinalQualityVerificationPhase;
}): Promise<PhotoshopHistoryStateRef | undefined> {
    let verifiedHistoryStateRef: PhotoshopHistoryStateRef | undefined;
    for (const request of buildDesignQualityVerificationToolRequests(input.phase)) {
        const startedAtMs = Date.now();
        const result = await input.context.executeTool(request.name, request.arguments);
        appendHostObservation({
            context: input.context,
            name: request.name,
            arguments: request.arguments,
            result,
            phase: input.phase,
            startedAtMs
        });
        if (!result || result.success === false) return undefined;
        const historyStateRef = readPhotoshopHistoryStateRef(result);
        if (!historyStateRef
            || (verifiedHistoryStateRef
                && !samePhotoshopHistoryStateRef(verifiedHistoryStateRef, historyStateRef))) {
            return undefined;
        }
        verifiedHistoryStateRef = historyStateRef;
    }
    return verifiedHistoryStateRef;
}

export async function captureFinalQualityFullSurfaceEvidence(input: {
    context: FinalQualityHostEvidenceContext;
    toolName: FinalQualityFullSurfaceToolName;
    expectedHistoryStateRef: PhotoshopHistoryStateRef;
    captureReviewSet: (results: Array<{
        callId: string;
        success: boolean;
        output: any;
    }>) => void;
}): Promise<boolean> {
    const toolArguments = input.toolName === 'getCanvasSnapshot'
        ? {
            maxSize: 1280,
            expectedDocumentId: input.expectedHistoryStateRef.documentId
        }
        : { maxSize: 1280 };
    const startedAtMs = Date.now();
    const result = await input.context.executeTool(input.toolName, toolArguments);
    appendHostObservation({
        context: input.context,
        name: input.toolName,
        arguments: toolArguments,
        result,
        phase: 'pre_judge',
        startedAtMs
    });
    const observedHistoryStateRef = readPhotoshopHistoryStateRef(result);
    if (!result || result.success === false
        || !samePhotoshopHistoryStateRef(
            observedHistoryStateRef,
            input.expectedHistoryStateRef
        )) {
        return false;
    }
    const receipt = deriveAgentVisualObservationReceipt({
        toolResult: result,
        outerToolName: input.toolName,
        isTrustedObservationTool: (toolName) => toolName === input.toolName
    });
    if (!receipt) return false;
    writeAgentVisualObservationReceipt(result, receipt);
    input.captureReviewSet([{
        callId: 'harness-final-quality-full-surface',
        success: true,
        output: result
    }]);
    return true;
}

export async function ensureFinalQualityCurrentReviewSet<T extends {
    historyStateRef: PhotoshopHistoryStateRef;
}>(input: {
    context: FinalQualityHostEvidenceContext;
    currentReviewSet?: T | null;
    currentHistoryStateRef: PhotoshopHistoryStateRef;
    requireMultiSurface: boolean;
    fullSurfaceToolName?: FinalQualityFullSurfaceToolName;
    captureReviewSet: (results: Array<{
        callId: string;
        success: boolean;
        output: any;
    }>) => void;
    readReviewSet: () => T | null;
}): Promise<T | undefined> {
    if (input.currentReviewSet
        && samePhotoshopHistoryStateRef(
            input.currentReviewSet.historyStateRef,
            input.currentHistoryStateRef
        )) {
        return input.currentReviewSet;
    }
    if (input.requireMultiSurface || !input.fullSurfaceToolName) return undefined;
    await captureFinalQualityFullSurfaceEvidence({
        context: input.context,
        toolName: input.fullSurfaceToolName,
        expectedHistoryStateRef: input.currentHistoryStateRef,
        captureReviewSet: input.captureReviewSet
    });
    const captured = input.readReviewSet();
    return captured && samePhotoshopHistoryStateRef(
        captured.historyStateRef,
        input.currentHistoryStateRef
    ) ? captured : undefined;
}
