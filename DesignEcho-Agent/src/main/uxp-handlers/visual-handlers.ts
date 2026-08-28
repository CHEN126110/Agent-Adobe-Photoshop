import { getVisualAnnotationService } from '../services/visual-annotation-service';
import { BinaryMessageType, createBinaryImageData, type BinaryImageData } from '../../shared/binary-protocol';
import {
    assertRawMaskGeometry,
    resolveMattingEdgeRefineMode,
    resolveMattingOutputGeometry
} from '../../shared/matting-application-contract';
import {
    buildUnresolvedTargetHint,
    resolveTargetPhrases
} from '../../shared/semantic-target-vocabulary';
import {
    bindSemanticMattingGuidanceToDetectionBoxes,
    normalizeSemanticMattingGuidance,
    selectSemanticMattingDetectionInstances,
    type SemanticMattingGuidance,
    type SemanticMattingLifecycleSelectionMode,
    type SemanticMattingProviderPoint
} from '../../shared/semantic-matting-guidance';
import type { UXPContext } from './types';

export interface SemanticSourceBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export interface MattingTargetIdentityReceipt {
    schema: 'matting-target-identity/v1';
    documentId: number;
    historyStateId: number;
    layerId: number;
    layerName: string;
    layerKind: string;
    layerBounds: SemanticSourceBounds;
    isBackgroundLayer: boolean;
}

export interface MattingMutationReceipt {
    schema: 'matting-mutation-receipt/v1';
    documentId: number;
    requestedLayerId: number;
    actualLayerId: number | null;
    beforeHistoryStateId: number;
    afterHistoryStateId: number | null;
    historyChanged: boolean | null;
    historyChangeRequired: boolean;
    outputFormat: MattingOutputFormat;
    maskWidth: number;
    maskHeight: number;
    outputReadback: 'verified' | 'missing' | 'unknown';
    outputReadbackKind: string;
    outputExists: boolean | null;
    complete: boolean;
}

export interface SemanticTargetLifecycleReceipt {
    schema: 'semantic-matting-target-lifecycle/v2';
    requestedTargetCount: number;
    unresolvedTargetCount: number;
    omittedTargetCount: number;
    detectedTargetCount: number;
    candidateRegionCount?: number;
    detectedRegionCount: number;
    unselectedCandidateCount?: number;
    instanceSelectionMode?: SemanticMattingLifecycleSelectionMode;
    segmentationRequestedRegionCount: number;
    segmentationCompletedRegionCount: number;
    segmentationRequestedTargetCount: number;
    segmentationCompletedTargetCount: number;
    segmentationComplete: boolean;
    appliedRegionCount: number;
}

export type SemanticTargetLifecycleStage =
    | 'pre-detection'
    | 'post-detection'
    | 'pre-apply'
    | 'post-apply';

export type MattingOutputFormat = 'mask' | 'selection' | 'channel' | 'layer';

interface MattingWorkflowExecutionControl {
    requestKey?: string;
    abortSignal?: AbortSignal;
}

function buildMattingCancelledResult(stage: string): {
    success: false;
    error: string;
    errorCode: 'MATTING_WORKFLOW_CANCELLED';
    diagnostic: { stage: string; reason: 'workflow_cancelled' };
} {
    return {
        success: false,
        error: '抠图请求已取消，本轮没有启动新的 Photoshop 写入。',
        errorCode: 'MATTING_WORKFLOW_CANCELLED',
        diagnostic: { stage, reason: 'workflow_cancelled' }
    };
}

function isMattingWorkflowCancelled(control?: MattingWorkflowExecutionControl): boolean {
    return control?.abortSignal?.aborted === true;
}

export function normalizeMattingOutputFormat(value: unknown): MattingOutputFormat | null {
    const normalized = String(value === undefined ? 'mask' : value).trim().toLowerCase();
    if (normalized === 'mask'
        || normalized === 'selection'
        || normalized === 'channel'
        || normalized === 'layer') {
        return normalized;
    }
    return null;
}

export function validateSemanticDetectionCompleteness(value: {
    complete?: boolean;
    candidateCountBeforeLimit?: number;
    returnedRegionCount?: number;
    truncatedRegionCount?: number;
    boxes?: unknown[];
}): SemanticContractValidation {
    const issues: string[] = [];
    const truncatedRegionCount = Number(value?.truncatedRegionCount);
    const returnedRegionCount = Number(value?.returnedRegionCount);
    const candidateCountBeforeLimit = Number(value?.candidateCountBeforeLimit);
    const boxCount = Array.isArray(value?.boxes) ? value.boxes.length : -1;
    if (value?.complete !== true) issues.push('detection_not_complete');
    if (!Number.isInteger(truncatedRegionCount) || truncatedRegionCount !== 0) {
        issues.push('detection_regions_truncated');
    }
    if (!Number.isInteger(returnedRegionCount) || returnedRegionCount !== boxCount) {
        issues.push('detection_returned_count_mismatch');
    }
    if (!Number.isInteger(candidateCountBeforeLimit)
        || candidateCountBeforeLimit < returnedRegionCount) {
        issues.push('detection_candidate_count_invalid');
    }
    return { valid: issues.length === 0, issues };
}

export interface SemanticContractValidation {
    valid: boolean;
    issues: string[];
}

export interface SemanticRegionGeometryValidation extends SemanticContractValidation {
    code?: string;
    actualSourceBounds?: SemanticSourceBounds;
    regionInOutput?: { x1: number; y1: number; x2: number; y2: number };
    imageWidth?: number;
    imageHeight?: number;
}

function normalizeSemanticBounds(value: any): SemanticSourceBounds | null {
    if (!value || typeof value !== 'object') return null;
    const left = Number(value.left);
    const top = Number(value.top);
    const right = Number(value.right);
    const bottom = Number(value.bottom);
    if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) {
        return null;
    }
    return { left, top, right, bottom };
}

function boundsApproximatelyEqual(a: SemanticSourceBounds, b: SemanticSourceBounds, tolerance: number): boolean {
    return Math.abs(a.left - b.left) <= tolerance
        && Math.abs(a.top - b.top) <= tolerance
        && Math.abs(a.right - b.right) <= tolerance
        && Math.abs(a.bottom - b.bottom) <= tolerance;
}

export function validateMattingTargetIdentityReceipt(
    value: unknown,
    expected?: MattingTargetIdentityReceipt
): { valid: boolean; code?: string; identity?: MattingTargetIdentityReceipt } {
    if (!value || typeof value !== 'object') {
        return { valid: false, code: 'target_identity_missing' };
    }
    const record = value as Partial<MattingTargetIdentityReceipt>;
    const layerBounds = normalizeSemanticBounds(record.layerBounds);
    const ids = [record.documentId, record.historyStateId, record.layerId];
    if (record.schema !== 'matting-target-identity/v1'
        || !ids.every(id => Number.isSafeInteger(Number(id)) && Number(id) > 0)
        || typeof record.layerName !== 'string' || !record.layerName
        || typeof record.layerKind !== 'string' || !record.layerKind
        || !layerBounds
        || typeof record.isBackgroundLayer !== 'boolean') {
        return { valid: false, code: 'target_identity_invalid' };
    }
    const identity: MattingTargetIdentityReceipt = {
        schema: 'matting-target-identity/v1',
        documentId: Number(record.documentId),
        historyStateId: Number(record.historyStateId),
        layerId: Number(record.layerId),
        layerName: record.layerName,
        layerKind: record.layerKind,
        layerBounds,
        isBackgroundLayer: record.isBackgroundLayer
    };
    if (expected) {
        const matches = identity.documentId === expected.documentId
            && identity.historyStateId === expected.historyStateId
            && identity.layerId === expected.layerId
            && identity.layerName === expected.layerName
            && identity.layerKind === expected.layerKind
            && identity.isBackgroundLayer === expected.isBackgroundLayer
            && boundsApproximatelyEqual(identity.layerBounds, expected.layerBounds, 0.5);
        if (!matches) return { valid: false, code: 'target_identity_changed', identity };
    }
    return { valid: true, identity };
}

export function validateExpectedMattingTargetIdentity(args: {
    identity: MattingTargetIdentityReceipt;
    expectedDocumentId?: unknown;
    expectedHistoryStateId?: unknown;
}): { valid: boolean; code?: string } {
    if (args.expectedDocumentId !== undefined) {
        const expectedDocumentId = Number(args.expectedDocumentId);
        if (!Number.isSafeInteger(expectedDocumentId) || expectedDocumentId <= 0) {
            return { valid: false, code: 'expected_document_id_invalid' };
        }
        if (args.identity.documentId !== expectedDocumentId) {
            return { valid: false, code: 'expected_document_changed' };
        }
    }
    if (args.expectedHistoryStateId !== undefined) {
        const expectedHistoryStateId = Number(args.expectedHistoryStateId);
        if (!Number.isSafeInteger(expectedHistoryStateId) || expectedHistoryStateId <= 0) {
            return { valid: false, code: 'expected_history_state_id_invalid' };
        }
        if (args.identity.historyStateId !== expectedHistoryStateId) {
            return { valid: false, code: 'expected_history_state_changed' };
        }
    }
    return { valid: true };
}

export function validateMattingMutationReceipt(args: {
    value: unknown;
    expectedTargetIdentity: MattingTargetIdentityReceipt;
    expectedOutputFormat: MattingOutputFormat;
    expectedMaskWidth: number;
    expectedMaskHeight: number;
}): { valid: boolean; issues: string[]; receipt?: MattingMutationReceipt } {
    const issues: string[] = [];
    if (!args.value || typeof args.value !== 'object') {
        return { valid: false, issues: ['mutation_receipt_missing'] };
    }
    const record = args.value as Partial<MattingMutationReceipt>;
    const receipt = record as MattingMutationReceipt;
    if (record.schema !== 'matting-mutation-receipt/v1') issues.push('mutation_receipt_schema_invalid');
    if (Number(record.documentId) !== args.expectedTargetIdentity.documentId) issues.push('mutation_document_mismatch');
    if (Number(record.requestedLayerId) !== args.expectedTargetIdentity.layerId) issues.push('mutation_layer_mismatch');
    if (Number(record.beforeHistoryStateId) !== args.expectedTargetIdentity.historyStateId) {
        issues.push('mutation_before_history_mismatch');
    }
    if (record.outputFormat !== args.expectedOutputFormat) issues.push('mutation_output_format_mismatch');
    if (Number(record.maskWidth) !== Math.round(args.expectedMaskWidth)
        || Number(record.maskHeight) !== Math.round(args.expectedMaskHeight)) {
        issues.push('mutation_mask_geometry_mismatch');
    }
    if (!Number.isSafeInteger(Number(record.afterHistoryStateId))
        || Number(record.afterHistoryStateId) <= 0) {
        issues.push('mutation_after_history_missing');
    }
    if (record.historyChangeRequired === true) {
        if (record.historyChanged !== true
            || Number(record.afterHistoryStateId) === Number(record.beforeHistoryStateId)) {
            issues.push('mutation_history_not_changed');
        }
    }
    if (record.outputReadback !== 'verified' || record.outputExists !== true) {
        issues.push('mutation_output_not_verified');
    }
    if (record.complete !== true) issues.push('mutation_receipt_incomplete');
    if (record.actualLayerId === null || !Number.isSafeInteger(Number(record.actualLayerId))) {
        issues.push('mutation_actual_layer_missing');
    } else if ((args.expectedOutputFormat === 'selection' || args.expectedOutputFormat === 'channel')
        && Number(record.actualLayerId) !== args.expectedTargetIdentity.layerId) {
        issues.push('mutation_actual_layer_mismatch');
    } else if (args.expectedOutputFormat === 'mask'
        && !args.expectedTargetIdentity.isBackgroundLayer
        && Number(record.actualLayerId) !== args.expectedTargetIdentity.layerId) {
        issues.push('mutation_actual_layer_mismatch');
    }
    return { valid: issues.length === 0, issues, receipt };
}

export function validateSemanticBaseExportReceipt(args: {
    exportResult: any;
    expectedMode: 'layer-full' | 'composite-layer-bounds';
    outputGeometry: { left: number; top: number; width: number; height: number };
}): SemanticRegionGeometryValidation {
    const fail = (code: string, ...issues: string[]): SemanticRegionGeometryValidation => ({
        valid: false,
        code,
        issues
    });
    const result = args.exportResult;
    if (result?.sourceExportReceiptSchema !== 'matting-source-export/v1') {
        return fail('semantic_base_receipt_missing', 'missing_receipt_schema');
    }
    if (result?.sourceRegionApplied !== false) {
        return fail('semantic_base_export_mode_invalid', 'unexpected_source_region');
    }
    if (result?.sourceExportMode !== args.expectedMode) {
        return fail(
            'semantic_base_export_mode_mismatch',
            `expected_mode=${args.expectedMode}`,
            `actual_mode=${String(result?.sourceExportMode || '')}`
        );
    }
    const actual = normalizeSemanticBounds(result?.actualSourceBounds);
    if (!actual) return fail('semantic_base_actual_bounds_missing', 'actual_source_bounds_invalid');

    const outputLeft = Number(args.outputGeometry.left);
    const outputTop = Number(args.outputGeometry.top);
    const outputWidth = Number(args.outputGeometry.width);
    const outputHeight = Number(args.outputGeometry.height);
    if (![outputLeft, outputTop, outputWidth, outputHeight].every(Number.isFinite)
        || !(outputWidth > 0) || !(outputHeight > 0)) {
        return fail('semantic_base_output_geometry_invalid', 'output_geometry_invalid');
    }
    const documentWidth = Number(result?.docWidth);
    const documentHeight = Number(result?.docHeight);
    if (!Number.isFinite(documentWidth) || !(documentWidth > 0)
        || !Number.isFinite(documentHeight) || !(documentHeight > 0)) {
        return fail('semantic_base_document_geometry_missing', 'document_geometry_invalid');
    }
    const expectedDocumentBounds = normalizeSemanticBounds({
        left: Math.max(0, outputLeft),
        top: Math.max(0, outputTop),
        right: Math.min(documentWidth, outputLeft + outputWidth),
        bottom: Math.min(documentHeight, outputTop + outputHeight)
    });
    if (!expectedDocumentBounds) {
        return fail('semantic_base_layer_outside_document', 'layer_has_no_document_intersection');
    }
    if (!boundsApproximatelyEqual(actual, expectedDocumentBounds, 1)) {
        return fail(
            'semantic_base_coordinate_space_mismatch',
            'actual_bounds_do_not_match_layer_document_intersection'
        );
    }
    const tolerance = 1;
    const x1 = actual.left - outputLeft;
    const y1 = actual.top - outputTop;
    const x2 = actual.right - outputLeft;
    const y2 = actual.bottom - outputTop;
    if (x1 < -tolerance || y1 < -tolerance
        || x2 > outputWidth + tolerance || y2 > outputHeight + tolerance
        || x2 <= x1 || y2 <= y1) {
        return fail('semantic_base_actual_outside_output', 'actual_bounds_outside_output_geometry');
    }
    return {
        valid: true,
        issues: [],
        actualSourceBounds: actual,
        regionInOutput: {
            x1: Math.max(0, x1),
            y1: Math.max(0, y1),
            x2: Math.min(outputWidth, x2),
            y2: Math.min(outputHeight, y2)
        }
    };
}

/**
 * 核验 Photoshop 区域导出的几何收据，并只依据实际 bounds 计算回贴坐标。
 * 请求 bounds 只能说明意图；off-canvas 夹取、Photoshop 内部裁剪都必须以实际收据为准。
 */
export function validateSemanticRegionExportReceipt(args: {
    exportResult: any;
    requestedSourceBounds: SemanticSourceBounds;
    expectedMode: 'layer-region' | 'composite-region';
    outputGeometry: { left: number; top: number; width: number; height: number };
    expectedTargetIdentity: MattingTargetIdentityReceipt;
}): SemanticRegionGeometryValidation {
    const fail = (code: string, ...issues: string[]): SemanticRegionGeometryValidation => ({
        valid: false,
        code,
        issues
    });
    const result = args.exportResult;
    const targetIdentity = validateMattingTargetIdentityReceipt(
        result?.targetIdentity,
        args.expectedTargetIdentity
    );
    const sourceHistoryStateRef = result?.sourceHistoryStateRef;
    if (!targetIdentity.valid
        || Number(sourceHistoryStateRef?.documentId) !== args.expectedTargetIdentity.documentId
        || Number(sourceHistoryStateRef?.historyStateId) !== args.expectedTargetIdentity.historyStateId) {
        return fail(
            'semantic_region_target_revision_changed',
            targetIdentity.code || 'source_history_state_changed'
        );
    }
    if (result?.sourceExportReceiptSchema !== 'matting-source-export/v1') {
        return fail('semantic_region_receipt_missing', 'missing_receipt_schema');
    }
    if (result?.sourceRegionApplied !== true) {
        return fail('semantic_region_not_applied', 'source_region_not_applied');
    }
    if (result?.sourceExportMode !== args.expectedMode) {
        return fail(
            'semantic_region_mode_mismatch',
            `expected_mode=${args.expectedMode}`,
            `actual_mode=${String(result?.sourceExportMode || '')}`
        );
    }
    if (result?.useBinaryTransfer !== true || !Number.isFinite(Number(result?.binaryRequestId))) {
        return fail('semantic_region_transport_invalid', 'verified_region_requires_binary_transport');
    }

    const requested = normalizeSemanticBounds(args.requestedSourceBounds);
    const echoedRequest = normalizeSemanticBounds(result?.requestedSourceBounds);
    const actual = normalizeSemanticBounds(result?.actualSourceBounds);
    if (!requested || !echoedRequest || !actual) {
        return fail('semantic_region_bounds_invalid', 'requested_or_actual_bounds_invalid');
    }
    if (!boundsApproximatelyEqual(requested, echoedRequest, 0.5)) {
        return fail('semantic_region_request_mismatch', 'echoed_request_does_not_match');
    }

    const tolerance = 1;
    if (actual.left < requested.left - tolerance
        || actual.top < requested.top - tolerance
        || actual.right > requested.right + tolerance
        || actual.bottom > requested.bottom + tolerance) {
        return fail('semantic_region_actual_outside_request', 'actual_bounds_outside_requested_bounds');
    }

    const imageWidth = Number(result?.binaryImageWidth);
    const imageHeight = Number(result?.binaryImageHeight);
    if (!(imageWidth > 0) || !(imageHeight > 0)) {
        return fail('semantic_region_image_geometry_invalid', 'binary_image_dimensions_invalid');
    }

    const outputLeft = Number(args.outputGeometry.left);
    const outputTop = Number(args.outputGeometry.top);
    const outputWidth = Number(args.outputGeometry.width);
    const outputHeight = Number(args.outputGeometry.height);
    if (![outputLeft, outputTop, outputWidth, outputHeight].every(Number.isFinite)
        || !(outputWidth > 0) || !(outputHeight > 0)) {
        return fail('semantic_region_output_geometry_invalid', 'output_geometry_invalid');
    }

    const x1 = actual.left - outputLeft;
    const y1 = actual.top - outputTop;
    const x2 = actual.right - outputLeft;
    const y2 = actual.bottom - outputTop;
    if (x1 < -tolerance || y1 < -tolerance
        || x2 > outputWidth + tolerance || y2 > outputHeight + tolerance
        || x2 <= x1 || y2 <= y1) {
        return fail('semantic_region_actual_outside_output', 'actual_bounds_outside_output_geometry');
    }

    return {
        valid: true,
        issues: [],
        actualSourceBounds: actual,
        regionInOutput: {
            x1: Math.max(0, x1),
            y1: Math.max(0, y1),
            x2: Math.min(outputWidth, x2),
            y2: Math.min(outputHeight, y2)
        },
        imageWidth,
        imageHeight
    };
}

/** 目标词、检测框、分割收据和 Photoshop 应用收据必须逐级守恒。 */
export function validateSemanticTargetLifecycle(
    receipt: SemanticTargetLifecycleReceipt,
    stage: SemanticTargetLifecycleStage
): SemanticContractValidation {
    const issues: string[] = [];
    if (receipt?.schema !== 'semantic-matting-target-lifecycle/v2') {
        return { valid: false, issues: ['invalid_schema'] };
    }

    const candidateRegionCount = receipt.candidateRegionCount ?? receipt.detectedRegionCount;
    const unselectedCandidateCount = receipt.unselectedCandidateCount ?? 0;
    const instanceSelectionMode = receipt.instanceSelectionMode ?? 'all_detected';

    const counts = [
        receipt.requestedTargetCount,
        receipt.unresolvedTargetCount,
        receipt.omittedTargetCount,
        receipt.detectedTargetCount,
        candidateRegionCount,
        receipt.detectedRegionCount,
        unselectedCandidateCount,
        receipt.segmentationRequestedRegionCount,
        receipt.segmentationCompletedRegionCount,
        receipt.segmentationRequestedTargetCount,
        receipt.segmentationCompletedTargetCount,
        receipt.appliedRegionCount
    ];
    if (!counts.every(count => Number.isInteger(count) && count >= 0)) {
        issues.push('invalid_count');
    }
    if (!(receipt.requestedTargetCount > 0)) issues.push('empty_request');
    if (receipt.unresolvedTargetCount > 0) issues.push('unresolved_targets');
    if (receipt.omittedTargetCount > 0) issues.push('omitted_targets');
    if (instanceSelectionMode !== 'all_detected'
        && instanceSelectionMode !== 'exact_guided_instances') {
        issues.push('invalid_instance_selection_mode');
    }
    if (candidateRegionCount < receipt.detectedRegionCount) {
        issues.push('selected_regions_exceed_candidates');
    }
    if (unselectedCandidateCount !== candidateRegionCount - receipt.detectedRegionCount) {
        issues.push('candidate_selection_count_mismatch');
    }
    if (instanceSelectionMode === 'all_detected' && unselectedCandidateCount !== 0) {
        issues.push('unexpected_unselected_candidates');
    }

    if (stage !== 'pre-detection') {
        if (receipt.detectedTargetCount !== receipt.requestedTargetCount) {
            issues.push('detected_targets_incomplete');
        }
        if (!(receipt.detectedRegionCount > 0)) issues.push('no_detected_regions');
    }

    if (stage === 'pre-apply' || stage === 'post-apply') {
        if (receipt.segmentationRequestedRegionCount !== receipt.detectedRegionCount) {
            issues.push('segmentation_region_request_mismatch');
        }
        if (receipt.segmentationCompletedRegionCount !== receipt.segmentationRequestedRegionCount) {
            issues.push('segmented_regions_incomplete');
        }
        if (receipt.segmentationRequestedTargetCount !== receipt.detectedRegionCount) {
            issues.push('segmentation_target_request_mismatch');
        }
        if (receipt.segmentationCompletedTargetCount !== receipt.segmentationRequestedTargetCount) {
            issues.push('segmented_targets_incomplete');
        }
        if (receipt.segmentationComplete !== true) issues.push('segmentation_not_complete');
    }

    if (stage === 'pre-apply' && receipt.appliedRegionCount !== 0) {
        issues.push('unexpected_preexisting_apply');
    }
    if (stage === 'post-apply'
        && receipt.appliedRegionCount !== receipt.segmentationCompletedRegionCount) {
        issues.push('applied_regions_incomplete');
    }

    return { valid: issues.length === 0, issues };
}

function generateSimpleMapping(layers: any[]): string {
    const lines = ['Layer Mapping:', ''];

    for (const layer of layers) {
        let line = `[${layer.index}] ${layer.name} (${layer.kind})`;
        if (layer.textContent) {
            const preview = layer.textContent.length > 20
                ? `${layer.textContent.substring(0, 20)}...`
                : layer.textContent;
            line += ` "${preview}"`;
        }
        lines.push(line);
    }

    return lines.join('\n');
}

export function registerVisualHandlers(context: UXPContext): void {
    const { wsServer, logService, mattingService, groundingDinoService, samService } = context;
    const MATTING_EXPORT_MAX_SIZE = 1024;
    /** 高分辨率取像时目标框的外扩比例：模型要看到目标之外一圈才判断得准边界 */
    const HIGH_RES_REGION_PADDING = 0.25;
    /** 目标被取像范围切断时改用的外扩比例：足以容纳只框住目标三分之一的检测框 */
    const HIGH_RES_EXPANDED_PADDING = 1.0;
    /** 两个目标框相距多少（相对目标尺度）以内算相邻，需并入同一张局部图 */
    const ADJACENT_GROUP_TOLERANCE = 0.35;
    let nextMattingBinaryResponseId = 1000000000;

    const normalizeMattingQuality = (quality?: string): 'fast' | 'balanced' | 'quality' => {
        const normalized = String(quality || '').trim().toLowerCase();
        if (normalized === 'fast' || normalized === 'quality') {
            return normalized;
        }
        return 'balanced';
    };

    const resolveMattingExportMaxSize = (quality?: string): number => {
        const normalizedQuality = normalizeMattingQuality(quality);
        if (normalizedQuality === 'fast') {
            return 896;
        }
        if (normalizedQuality === 'quality') {
            return 1280;
        }
        return MATTING_EXPORT_MAX_SIZE;
    };

    const resolveMattingImageInput = async (exportResult: any): Promise<string | BinaryImageData | null> => {
        if (typeof exportResult?.imageData === 'string' && exportResult.imageData.length >= 100) {
            return exportResult.imageData;
        }

        if (exportResult?.useBinaryTransfer && exportResult?.binaryRequestId) {
            const binaryResult = await wsServer.waitForBinaryData(exportResult.binaryRequestId, 10000);
            const binaryImage = createBinaryImageData(
                binaryResult.header.type,
                binaryResult.imageData,
                binaryResult.header.width,
                binaryResult.header.height
            );
            logService?.logAgent(
                'info',
                `[UXP Handler] Loaded binary image from cache: ${binaryImage.format} ${binaryImage.width}x${binaryImage.height}, ${(binaryResult.imageData.length / 1024).toFixed(0)}KB`
            );
            return binaryImage;
        }

        return null;
    };

    const describeMattingInput = (imageInput: string | BinaryImageData): string => {
        if (typeof imageInput === 'string') {
            return `base64 ${(imageInput.length / 1024).toFixed(0)}KB`;
        }

        return `${imageInput.format} ${imageInput.width}x${imageInput.height}, ${(imageInput.buffer.length / 1024).toFixed(0)}KB`;
    };

    const sendMattingProgress = (progress: number, message: string, stage?: string) => {
        wsServer.sendProgress('remove-background', progress, message, stage);
        logService?.logAgent(
            'info',
            `[UXP Handler] Matting progress ${progress}%${stage ? ` (${stage})` : ''}: ${message}`
        );
    };

    const mapInferenceProgress = (progress: number): number => {
        const clamped = Math.max(0, Math.min(100, progress));
        const start = 18;
        const end = 92;
        return Math.round(start + (clamped / 100) * (end - start));
    };

    const resolveMattingTargetDimensions = (exportResult: any): {
        originalWidth?: number;
        originalHeight?: number;
        originalLeft?: number;
        originalTop?: number;
        docWidth?: number;
        docHeight?: number;
    } => {
        const outputGeometry = resolveMattingOutputGeometry(
            exportResult?.originalWidth,
            exportResult?.originalHeight
        );
        const originalLeft = Number(exportResult?.originalLeft);
        const originalTop = Number(exportResult?.originalTop);
        const docWidth = Number(exportResult?.docWidth) || 0;
        const docHeight = Number(exportResult?.docHeight) || 0;

        const targetDimensions: {
            originalWidth?: number;
            originalHeight?: number;
            originalLeft?: number;
            originalTop?: number;
            docWidth?: number;
            docHeight?: number;
        } = {};

        if (outputGeometry) {
            targetDimensions.originalWidth = outputGeometry.width;
            targetDimensions.originalHeight = outputGeometry.height;
            logService?.logAgent(
                'info',
                `[UXP Handler] Full-size mask target: ${outputGeometry.width}x${outputGeometry.height} (${(outputGeometry.pixelCount / 1000000).toFixed(2)}MP)`
            );
        }

        if (Number.isFinite(originalLeft)) {
            targetDimensions.originalLeft = originalLeft;
        }

        if (Number.isFinite(originalTop)) {
            targetDimensions.originalTop = originalTop;
        }

        if (docWidth > 0 && docHeight > 0) {
            targetDimensions.docWidth = docWidth;
            targetDimensions.docHeight = docHeight;
        }

        return targetDimensions;
    };

    /**
     * 把相邻或重叠的目标框合并成组。
     *
     * 同组目标共用一张局部源图，避免重复取像并保证坐标上下文一致；进入分割服务时
     * 仍拆为单 box region，确保每个检测框都有独立、不可被邻近 union 冒充的完成收据。
     */
    const groupAdjacentBoxes = (
        boxes: Array<{ x1: number; y1: number; x2: number; y2: number }>,
        gapTolerance: number
    ): Array<Array<{ x1: number; y1: number; x2: number; y2: number }>> => {
        const groups: Array<Array<{ x1: number; y1: number; x2: number; y2: number }>> = [];

        const touches = (
            a: { x1: number; y1: number; x2: number; y2: number },
            b: { x1: number; y1: number; x2: number; y2: number }
        ): boolean => {
            // 两框在两个方向上都"接近或重叠"才算相邻
            const gapX = Math.max(a.x1 - b.x2, b.x1 - a.x2);
            const gapY = Math.max(a.y1 - b.y2, b.y1 - a.y2);
            return gapX <= gapTolerance && gapY <= gapTolerance;
        };

        for (const box of boxes) {
            const hit = groups.find(group => group.some(member => touches(member, box)));
            if (hit) hit.push(box);
            else groups.push([box]);
        }

        // 分组后可能出现「A 与 B 相邻、B 与 C 相邻」却分在两组，合并到不再变化为止
        let merged = true;
        while (merged) {
            merged = false;
            outer: for (let i = 0; i < groups.length; i++) {
                for (let j = i + 1; j < groups.length; j++) {
                    if (groups[i].some(a => groups[j].some(b => touches(a, b)))) {
                        groups[i].push(...groups[j]);
                        groups.splice(j, 1);
                        merged = true;
                        break outer;
                    }
                }
            }
        }

        return groups;
    };

    /**
     * 按检测框向 Photoshop 二次取像，拿到目标区域的高分辨率局部图。
     *
     * 坐标要走三层：检测框在「低分辨率导出图」→ 图层原始像素 → 文档坐标。
     * 任何一层用错都会取到画面里别的地方，所以每层的换算依据都取自 exportResult 本身。
     *
     * 区域请求必须带可验证的实际 bounds/mode 收据；取不到或收据不等价时整体失败，
     * 禁止退回整层图后继续沿用局部坐标，也禁止只处理已成功取像的部分目标。
     */
    const buildHighResRegions = async (
        boxes: Array<{ x1: number; y1: number; x2: number; y2: number }>,
        guidancePointsByBox: SemanticMattingProviderPoint[][] | undefined,
        exportWidth: number,
        exportHeight: number,
        exportResult: any,
        quality: 'fast' | 'balanced' | 'quality',
        sampleAllLayers: boolean,
        paddingRatio: number = HIGH_RES_REGION_PADDING,
        control: MattingWorkflowExecutionControl = {}
    ): Promise<{
        success: boolean;
        regions: Array<{
            imageInput: string | BinaryImageData;
            regionInOutput: { x1: number; y1: number; x2: number; y2: number };
            boxesInRegion: Array<{ x1: number; y1: number; x2: number; y2: number }>;
            guidancePointsByBox?: SemanticMattingProviderPoint[][];
        }>;
        notRequired?: boolean;
        baseRegionInOutput?: { x1: number; y1: number; x2: number; y2: number };
        error?: string;
        errorCode?: string;
        diagnostic?: Record<string, unknown>;
    }> => {
        if (isMattingWorkflowCancelled(control)) {
            return { ...buildMattingCancelledResult('region-export'), regions: [] };
        }
        const layerId = exportResult?.layerId;
        const originalWidth = Number(exportResult?.originalWidth);
        const originalHeight = Number(exportResult?.originalHeight);
        const originalLeft = Number(exportResult?.originalLeft);
        const originalTop = Number(exportResult?.originalTop);
        const targetIdentityValidation = validateMattingTargetIdentityReceipt(exportResult?.targetIdentity);

        if (!Number.isFinite(layerId)
            || !(originalWidth > 0) || !(originalHeight > 0)
            || !Number.isFinite(originalLeft) || !Number.isFinite(originalTop)
            || !(exportWidth > 0) || !(exportHeight > 0)) {
            return {
                success: false,
                regions: [],
                error: '缺少可验证的图层几何信息，本轮没有修改图层。',
                errorCode: 'SEMANTIC_OUTPUT_GEOMETRY_MISSING',
                diagnostic: { stage: 'region-export', reason: 'base_geometry_missing' }
            };
        }
        if (!targetIdentityValidation.valid || !targetIdentityValidation.identity
            || Number(layerId) !== targetIdentityValidation.identity.layerId
            || Number(exportResult?.sourceHistoryStateRef?.documentId) !== targetIdentityValidation.identity.documentId
            || Number(exportResult?.sourceHistoryStateRef?.historyStateId) !== targetIdentityValidation.identity.historyStateId) {
            return {
                success: false,
                regions: [],
                error: '首次图像导出缺少可验证的文档、版本或图层身份，本轮没有修改图层。',
                errorCode: 'SEMANTIC_BASE_TARGET_IDENTITY_INVALID',
                diagnostic: {
                    stage: 'region-export',
                    reason: targetIdentityValidation.code || 'history_state_ref_mismatch'
                }
            };
        }
        const targetIdentity = targetIdentityValidation.identity;
        const baseGeometry = validateSemanticBaseExportReceipt({
            exportResult,
            expectedMode: sampleAllLayers ? 'composite-layer-bounds' : 'layer-full',
            outputGeometry: {
                left: originalLeft,
                top: originalTop,
                width: originalWidth,
                height: originalHeight
            }
        });
        if (!baseGeometry.valid || !baseGeometry.actualSourceBounds || !baseGeometry.regionInOutput) {
            return {
                success: false,
                regions: [],
                error: '首次图像导出的实际范围无法验证，本轮没有修改图层。请重启 Photoshop 插件后重试。',
                errorCode: 'SEMANTIC_BASE_EXPORT_RECEIPT_INVALID',
                diagnostic: {
                    stage: 'region-export',
                    reason: baseGeometry.code || 'base_receipt_invalid',
                    issues: baseGeometry.issues
                }
            };
        }
        const sourceBounds = baseGeometry.actualSourceBounds;
        const sourceWidth = sourceBounds.right - sourceBounds.left;
        const sourceHeight = sourceBounds.bottom - sourceBounds.top;

        // 导出图被压缩了多少倍
        const scaleX = sourceWidth / exportWidth;
        const scaleY = sourceHeight / exportHeight;
        // 没压缩就没必要二次取像
        if (scaleX <= 1.05 && scaleY <= 1.05) {
            logService?.logAgent('info', '[UXP Handler] 导出图已是原始分辨率，无需二次取像');
            return {
                success: true,
                regions: [],
                notRequired: true,
                baseRegionInOutput: baseGeometry.regionInOutput
            };
        }

        // quality 档取到 3072：分割固定在 1024 上完成，这个尺寸决定的是**引导精修**
        // 能拿到多细的原图信息。真机图层可达 4672x7008，取 2048 等于把引导图先缩掉
        // 一半，边缘细节还没进精修就没了。3072 是在传输量与恢复精度之间的取舍。
        const regionMaxSize = quality === 'quality' ? 3072 : quality === 'fast' ? 1024 : 1536;
        const built: Array<{
            imageInput: string | BinaryImageData;
            regionInOutput: { x1: number; y1: number; x2: number; y2: number };
            boxesInRegion: Array<{ x1: number; y1: number; x2: number; y2: number }>;
            guidancePointsByBox?: SemanticMattingProviderPoint[][];
        }> = [];

        // 相邻目标并成一组共用局部图；容差按目标尺度走，太小会漏掉刚好挨着的两个目标
        const avgSize = boxes.reduce((sum, b) => sum + Math.max(b.x2 - b.x1, b.y2 - b.y1), 0)
            / Math.max(1, boxes.length);
        const groups = groupAdjacentBoxes(boxes, avgSize * ADJACENT_GROUP_TOLERANCE);

        for (const group of groups) {
            if (isMattingWorkflowCancelled(control)) {
                return { ...buildMattingCancelledResult('region-export'), regions: [] };
            }
            // 组的外接框决定取像范围
            const groupBox = {
                x1: Math.min(...group.map(b => b.x1)),
                y1: Math.min(...group.map(b => b.y1)),
                x2: Math.max(...group.map(b => b.x2)),
                y2: Math.max(...group.map(b => b.y2))
            };
            const boxDocX1 = sourceBounds.left + groupBox.x1 * scaleX;
            const boxDocY1 = sourceBounds.top + groupBox.y1 * scaleY;
            const boxDocX2 = sourceBounds.left + groupBox.x2 * scaleX;
            const boxDocY2 = sourceBounds.top + groupBox.y2 * scaleY;

            // 外扩一点：分割模型需要看到目标之外的一圈才判断得准边界
            const padX = (boxDocX2 - boxDocX1) * paddingRatio;
            const padY = (boxDocY2 - boxDocY1) * paddingRatio;
            const regionLeft = Math.max(originalLeft, Math.floor(boxDocX1 - padX));
            const regionTop = Math.max(originalTop, Math.floor(boxDocY1 - padY));
            const regionRight = Math.min(originalLeft + originalWidth, Math.ceil(boxDocX2 + padX));
            const regionBottom = Math.min(originalTop + originalHeight, Math.ceil(boxDocY2 + padY));
            if (regionRight - regionLeft < 8 || regionBottom - regionTop < 8) {
                return {
                    success: false,
                    regions: [],
                    error: '目标区域太小，无法可靠取得用于精细分割的图像，本轮没有修改图层。',
                    errorCode: 'SEMANTIC_REGION_TOO_SMALL',
                    diagnostic: { stage: 'region-export', reason: 'requested_region_too_small' }
                };
            }

            // 换算成文档坐标请求取像
            const requestedSourceBounds = {
                left: Math.round(regionLeft),
                top: Math.round(regionTop),
                right: Math.round(regionRight),
                bottom: Math.round(regionBottom)
            };
            const exported = await wsServer.sendRequest('removeBackground', {
                mode: 'ai',
                layerId,
                maxSize: regionMaxSize,
                // 必须与第一次导出保持一致：第一次在复合图上检测、第二次只取图层像素的话，
                // 两张图内容不同，框的位置就对不上了
                sampleAllLayers,
                sourceRegion: requestedSourceBounds,
                expectedTargetIdentity: targetIdentity
            }, 60000, control.requestKey ? { requestKey: control.requestKey } : {}).catch((e: any) => {
                logService?.logAgent('warn', `[UXP Handler] 区域取像请求失败: ${e?.message}`);
                return null;
            });

            if (isMattingWorkflowCancelled(control)) {
                return { ...buildMattingCancelledResult('region-export'), regions: [] };
            }

            if (!exported?.success) {
                logService?.logAgent(
                    'warn',
                    `[UXP Handler] 区域取像失败: ${exported?.error || exported?.message || '未知原因'}`
                );
                return {
                    success: false,
                    regions: [],
                    error: '目标区域取像失败，无法确认局部图与原图坐标一致，本轮没有修改图层。',
                    errorCode: 'SEMANTIC_REGION_EXPORT_FAILED',
                    diagnostic: {
                        stage: 'region-export',
                        reason: 'uxp_region_export_failed',
                        uxpError: exported?.error || exported?.message || 'unknown'
                    }
                };
            }
            if (Number(exported?.layerId) !== Number(layerId)) {
                return {
                    success: false,
                    regions: [],
                    error: '目标区域取像返回了不同的图层身份，本轮没有修改图层。',
                    errorCode: 'SEMANTIC_REGION_LAYER_MISMATCH',
                    diagnostic: {
                        stage: 'region-export',
                        reason: 'layer_identity_mismatch',
                        expectedLayerId: layerId,
                        actualLayerId: exported?.layerId
                    }
                };
            }

            const geometry = validateSemanticRegionExportReceipt({
                exportResult: exported,
                requestedSourceBounds,
                expectedMode: sampleAllLayers ? 'composite-region' : 'layer-region',
                outputGeometry: {
                    left: originalLeft,
                    top: originalTop,
                    width: originalWidth,
                    height: originalHeight
                },
                expectedTargetIdentity: targetIdentity
            });
            if (!geometry.valid || !geometry.actualSourceBounds || !geometry.regionInOutput) {
                logService?.logAgent(
                    'warn',
                    `[UXP Handler] 区域取像收据无效: ${geometry.code || 'unknown'} ${geometry.issues.join(',')}`
                );
                return {
                    success: false,
                    regions: [],
                    error: '目标区域的实际取像范围无法验证，本轮没有修改图层。请重启 Photoshop 插件后重试。',
                    errorCode: 'SEMANTIC_REGION_RECEIPT_INVALID',
                    diagnostic: {
                        stage: 'region-export',
                        reason: geometry.code || 'receipt_invalid',
                        issues: geometry.issues,
                        requestedSourceBounds,
                        actualSourceBounds: exported?.actualSourceBounds,
                        sourceExportMode: exported?.sourceExportMode
                    }
                };
            }

            const regionImage = await resolveMattingImageInput(exported);
            if (!regionImage) {
                logService?.logAgent('warn', '[UXP Handler] 区域取像返回了空图像');
                return {
                    success: false,
                    regions: [],
                    error: '目标区域没有返回有效图像，本轮没有修改图层。',
                    errorCode: 'SEMANTIC_REGION_IMAGE_MISSING',
                    diagnostic: { stage: 'region-export', reason: 'image_payload_missing' }
                };
            }

            const regionPixelW = geometry.imageWidth || 0;
            const regionPixelH = geometry.imageHeight || 0;
            const actualSourceBounds = geometry.actualSourceBounds;
            const actualWidth = actualSourceBounds.right - actualSourceBounds.left;
            const actualHeight = actualSourceBounds.bottom - actualSourceBounds.top;

            // 目标框在这张局部图内的位置：局部图是整块区域按比例缩放而来
            const regionScaleX = regionPixelW / actualWidth;
            const regionScaleY = regionPixelH / actualHeight;

            const mappedBoxes = group.map(member => ({
                    x1: (sourceBounds.left + member.x1 * scaleX - actualSourceBounds.left) * regionScaleX,
                    y1: (sourceBounds.top + member.y1 * scaleY - actualSourceBounds.top) * regionScaleY,
                    x2: (sourceBounds.left + member.x2 * scaleX - actualSourceBounds.left) * regionScaleX,
                    y2: (sourceBounds.top + member.y2 * scaleY - actualSourceBounds.top) * regionScaleY
                }));
            // 相邻目标共用同一张局部源图，避免重复传输；但每个检测框必须形成独立的
            // 分割 region。否则一个 box 的 scope 失败后，邻近 box 的 union mask 可能跨进来，
            // 让“框内有前景”误报为该目标已完成，破坏逐目标完整性收据。
            for (let mappedIndex = 0; mappedIndex < mappedBoxes.length; mappedIndex++) {
                const mappedBox = mappedBoxes[mappedIndex];
                const sourceBoxIndex = boxes.indexOf(group[mappedIndex]);
                const sourceGuidance = sourceBoxIndex >= 0
                    ? guidancePointsByBox?.[sourceBoxIndex] || []
                    : [];
                const mappedGuidance = sourceGuidance.map(point => ({
                    x: (sourceBounds.left + point.x * scaleX - actualSourceBounds.left) * regionScaleX,
                    y: (sourceBounds.top + point.y * scaleY - actualSourceBounds.top) * regionScaleY,
                    label: point.label
                }));
                built.push({
                    imageInput: regionImage,
                    regionInOutput: geometry.regionInOutput,
                    boxesInRegion: [mappedBox],
                    ...(mappedGuidance.length > 0
                        ? { guidancePointsByBox: [mappedGuidance] }
                        : {})
                });
            }

            logService?.logAgent(
                'info',
                `[UXP Handler] 区域取像 ${Math.round(actualWidth)}x${Math.round(actualHeight)} `
                + `→ ${regionPixelW}x${regionPixelH}（${group.length} 个目标共用取像、独立分割，`
                + `原低分辨率下仅 ${Math.round(groupBox.x2 - groupBox.x1)}x${Math.round(groupBox.y2 - groupBox.y1)}）`
            );
        }

        return { success: true, regions: built };
    };

    /**
     * 高分辨率精分，并在目标被取像范围切断时自动扩大重试。
     *
     * 检测框常常只覆盖目标的一部分（真机：抠"袜子"时框只圈住靠近鞋的下半截），
     * 固定外扩比例救不了——框差多少不可预知。所以让分割结果自己报告"我贴边了"，
     * 再按更大的外扩重取一次像。
     *
     * 加大外扩几乎不损失分辨率：取像区域本来就大于 maxSize，扩大只改变缩放比。
     * 实测目标从 740x1239 降到 540x904，仍是不做区域取像时（141x236）的四倍。
     */
    const segmentWithAutoExpand = async (args: {
        boxes: Array<{ x1: number; y1: number; x2: number; y2: number }>;
        guidancePointsByBox?: SemanticMattingProviderPoint[][];
        detectWidth: number;
        detectHeight: number;
        exportResult: any;
        normalizedQuality: 'fast' | 'balanced' | 'quality';
        edgeRefine: string;
        sampleAllLayers: boolean;
        targetDimensions: { originalWidth?: number; originalHeight?: number };
        fallbackImageInput: string | BinaryImageData;
        control?: MattingWorkflowExecutionControl;
    }): Promise<{ result: any }> => {
        const outputWidth = args.targetDimensions.originalWidth || args.detectWidth;
        const outputHeight = args.targetDimensions.originalHeight || args.detectHeight;

        const runPass = async (
            paddingRatio: number,
            boxes: typeof args.boxes
        ): Promise<{ built: any; result: any }> => {
            if (isMattingWorkflowCancelled(args.control)) {
                const cancelled = buildMattingCancelledResult('segmentation');
                return { built: { success: false, regions: [] }, result: cancelled };
            }
            const built = await buildHighResRegions(
                boxes,
                args.guidancePointsByBox,
                args.detectWidth,
                args.detectHeight,
                args.exportResult,
                args.normalizedQuality,
                args.sampleAllLayers,
                paddingRatio,
                args.control
            );
            if (!built.success) {
                return {
                    built,
                    result: {
                        success: false,
                        error: built.error,
                        errorCode: built.errorCode,
                        diagnostic: built.diagnostic
                    }
                };
            }

            // 没有缩放时不需要再次向 Photoshop 取像，但仍走同一个严格分割实现，
            // 这样每个检测框都有 requested/segmented 收据，不落回会部分成功的旧分支。
            let regions = built.regions;
            if (built.notRequired) {
                const baseRegionInOutput = built.baseRegionInOutput;
                if (!baseRegionInOutput) {
                    return {
                        built,
                        result: {
                            success: false,
                            error: '首次导出缺少可验证的实际范围，本轮没有修改图层。',
                            errorCode: 'SEMANTIC_BASE_REGION_MISSING',
                            diagnostic: { stage: 'segmentation', reason: 'base_region_in_output_missing' }
                        }
                    };
                }
                regions = boxes.map((box, boxIndex) => {
                    const guidancePoints = args.guidancePointsByBox?.[boxIndex] || [];
                    return {
                        imageInput: args.fallbackImageInput,
                        regionInOutput: baseRegionInOutput,
                        boxesInRegion: [box],
                        ...(guidancePoints.length > 0
                            ? { guidancePointsByBox: [guidancePoints] }
                            : {})
                    };
                });
            }
            if (regions.length === 0) {
                return {
                    built,
                    result: {
                        success: false,
                        error: '没有取得可验证的目标区域，本轮没有修改图层。',
                        errorCode: 'SEMANTIC_REGION_SET_EMPTY',
                        diagnostic: { stage: 'region-export', reason: 'empty_region_set' }
                    }
                };
            }

            if (isMattingWorkflowCancelled(args.control)) {
                return { built, result: buildMattingCancelledResult('segmentation') };
            }

            const result = await mattingService!.segmentHighResRegions(regions, {
                outputWidth,
                outputHeight,
                quality: args.normalizedQuality,
                edgeRefine: args.edgeRefine,
                binaryMaskOutput: true,
                requireVerifiedSemanticScope: true,
                onProgress: (progress, stage, message) => {
                    sendMattingProgress(Math.max(60, Math.min(95, progress)), message, stage);
                }
            });
            if (isMattingWorkflowCancelled(args.control)) {
                return { built, result: buildMattingCancelledResult('segmentation') };
            }
            return { built, result };
        };

        const first = await runPass(HIGH_RES_REGION_PADDING, args.boxes);

        const clipped = first.result.clippedRegionIndexes || [];
        if (clipped.length === 0 || !first.result.success) {
            return { result: first.result };
        }

        if (isMattingWorkflowCancelled(args.control)) {
            return { result: buildMattingCancelledResult('segmentation') };
        }

        logService?.logAgent(
            'info',
            `[UXP Handler] ${clipped.length} 个目标伸出取像范围，按 ${HIGH_RES_EXPANDED_PADDING} 外扩重取`
        );
        sendMattingProgress(70, '目标超出取像范围，正在扩大重取...', 'segmentation');

        const second = await runPass(HIGH_RES_EXPANDED_PADDING, args.boxes);
        if (!second.result?.success) {
            return {
                result: {
                    success: false,
                    error: '目标超出初次取像范围，扩大区域后仍未能完整分割，本轮没有修改图层。',
                    errorCode: 'SEMANTIC_EXPANDED_REGION_FAILED',
                    diagnostic: {
                        stage: 'segmentation',
                        reason: second.result?.errorCode || 'expanded_pass_failed',
                        detail: second.result?.diagnostic
                    }
                }
            };
        }

        // 重取后仍贴边意味着 union mask 仍有直线切口，不能把不完整结果写入 Photoshop。
        const stillClipped = (second.result.clippedRegionIndexes || []).length;
        logService?.logAgent(
            'info',
            `[UXP Handler] 扩大重取完成，仍贴边 ${stillClipped} 个`
        );
        if (stillClipped > 0) {
            return {
                result: {
                    success: false,
                    error: '目标仍超出可验证的取像范围，本轮没有修改图层。可以先扩大画布可见范围或改用选区模式。',
                    errorCode: 'SEMANTIC_REGION_STILL_CLIPPED',
                    diagnostic: {
                        stage: 'segmentation',
                        reason: 'expanded_region_still_clipped',
                        clippedRegionIndexes: second.result.clippedRegionIndexes
                    }
                }
            };
        }
        return { result: second.result };
    };

    /**
     * 整体抠图：显著性定位 → 框内精确分割。
     *
     * 与语义抠图共用同一个高分辨率精分段，只有定位方式不同（一个靠文字，
     * 一个靠显著性），因此两者的边缘质量一致——这是"没填目标词"时不该
     * 掉到另一套实现上的原因。
     *
     * 全程本地模型，不调用 Photoshop 自带的选择主体。
     */
    const runSalientMatting = async (args: {
        imageInput: string | BinaryImageData;
        normalizedQuality: 'fast' | 'balanced' | 'quality';
        edgeRefine: string;
        targetDimensions: { originalWidth?: number; originalHeight?: number };
        exportResult: any;
        sampleAllLayers: boolean;
    }): Promise<any> => {
        const startTime = Date.now();

        sendMattingProgress(20, '正在识别画面主体...', 'detection');

        const located = await mattingService!.detectSubjectRegions(args.imageInput, {
            quality: args.normalizedQuality,
            edgeRefine: args.edgeRefine,
            onProgress: (progress, stage, message) => {
                sendMattingProgress(Math.max(20, Math.min(50, progress)), message, stage);
            }
        });

        if (!located.success) {
            return { success: false, error: located.error };
        }

        if (located.regions.length === 0) {
            return {
                success: false,
                error: '没有在当前图层中识别到主体。\n\n'
                    + '可以改用"使用选区"模式手动框选，或在"抠取目标"里指定要抠的物体。'
            };
        }

        logService?.logAgent(
            'info',
            `[UXP Handler] Salient matting: ${located.regions.length} subject(s) — `
            + located.regions.map(r => `${r.area}px@(${r.x1},${r.y1})-(${r.x2},${r.y2})`).join(' ')
        );

        sendMattingProgress(
            55,
            `已识别 ${located.regions.length} 个主体，正在生成选区...`,
            'segmentation'
        );

        // 与语义抠图完全相同的精分段（含自动扩展重试）
        const { result } = await segmentWithAutoExpand({
            boxes: located.regions.map(r => ({ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 })),
            detectWidth: located.width || 0,
            detectHeight: located.height || 0,
            exportResult: args.exportResult,
            normalizedQuality: args.normalizedQuality,
            edgeRefine: args.edgeRefine,
            sampleAllLayers: args.sampleAllLayers,
            targetDimensions: args.targetDimensions,
            fallbackImageInput: args.imageInput
        });

        if (result.success) {
            const parts = [`整体抠图：识别到 ${located.regions.length} 个主体`];
            parts.push(result.analysis || '');
            result.analysis = parts.filter(Boolean).join(' | ');
            result.processingTime = Date.now() - startTime;
        }

        return result;
    };

    /**
     * 语义抠图：文字 → 目标框 → 框内精确分割。
     *
     * 第一段用 GroundingDINO 开放词汇检测（本地推理，不依赖云端模型的看图能力）；
     * 第二段复用 segmentWithinBoxes（SAM box prompt 为主，BiRefNet 裁剪为降级）。
     *
     * 中文目标词先经内置词表转英文；未解析、歧义或超限时在检测前整体失败，并提示
     * 用户改用具体英文或通用品类词。检测器的文本骨干是英文 BERT，中文会被切成 [UNK]，
     * 这里禁止恢复云端翻译 fallback。
     */
    const runSemanticMatting = async (args: {
        imageInput: string | BinaryImageData;
        targetPrompt: string;
        normalizedQuality: 'fast' | 'balanced' | 'quality';
        edgeRefine: string;
        targetDimensions: { originalWidth?: number; originalHeight?: number };
        /** 第一次导出的结果，用于把检测框换算成文档坐标做二次取像 */
        exportResult: any;
        /** 与第一次导出保持一致，否则两次取像的图像内容不同 */
        sampleAllLayers: boolean;
        /** 只承载 Agent 已明确给出的视觉判断；Harness 仅验证和换算坐标。 */
        semanticGuidance?: SemanticMattingGuidance;
        control?: MattingWorkflowExecutionControl;
    }): Promise<any> => {
        const startTime = Date.now();
        if (isMattingWorkflowCancelled(args.control)) {
            return buildMattingCancelledResult('pre-detection');
        }

        // 1. 目标词规范化：全程本地词表，不调用任何语言模型。
        //    抠图是本地能力，挂到云端模型上会平白多出网络、额度、答非所问三类失败
        //    （真机：翻译"袜子、鞋子"时模型调用失败，整条抠图链路随之中断）。
        const resolved = resolveTargetPhrases(args.targetPrompt);
        const phrases = resolved.phrases;
        const lifecycle: SemanticTargetLifecycleReceipt = {
            schema: 'semantic-matting-target-lifecycle/v2',
            requestedTargetCount: phrases.length,
            unresolvedTargetCount: resolved.unresolved.length,
            omittedTargetCount: resolved.omitted.length,
            detectedTargetCount: 0,
            candidateRegionCount: 0,
            detectedRegionCount: 0,
            unselectedCandidateCount: 0,
            instanceSelectionMode: 'all_detected',
            segmentationRequestedRegionCount: 0,
            segmentationCompletedRegionCount: 0,
            segmentationRequestedTargetCount: 0,
            segmentationCompletedTargetCount: 0,
            segmentationComplete: false,
            appliedRegionCount: 0
        };
        const preDetection = validateSemanticTargetLifecycle(lifecycle, 'pre-detection');
        if (!preDetection.valid) {
            logService?.logAgent(
                'warn',
                `[UXP Handler] 语义目标清单不完整: ${JSON.stringify({
                    issues: preDetection.issues,
                    requested: resolved.requested,
                    unresolved: resolved.unresolved,
                    omitted: resolved.omitted
                })}`
            );
            return {
                success: false,
                error: buildUnresolvedTargetHint(resolved),
                errorCode: 'SEMANTIC_TARGET_LIST_INCOMPLETE',
                diagnostic: {
                    stage: 'pre-detection',
                    issues: preDetection.issues,
                    requested: resolved.requested,
                    unresolved: resolved.unresolved,
                    omitted: resolved.omitted
                },
                semanticTargetLifecycle: lifecycle
            };
        }

        if (!groundingDinoService) {
            return {
                success: false,
                error: '开放词汇检测服务未初始化，无法按目标抠图。\n\n'
                    + '请清空"抠取目标"改用整体抠图，或重启应用后重试。',
                errorCode: 'SEMANTIC_DETECTOR_UNAVAILABLE',
                diagnostic: { stage: 'detection', reason: 'service_unavailable' },
                semanticTargetLifecycle: lifecycle
            };
        }

        // 2. 开放词汇检测
        sendMattingProgress(30, `正在图中定位「${args.targetPrompt}」...`, 'detection');

        const decoded = await mattingService!.decodeImageInput(args.imageInput);
        if (isMattingWorkflowCancelled(args.control)) {
            return buildMattingCancelledResult('detection');
        }
        if (!decoded) {
            return { success: false, error: '无法解码图层图像：图层可能为空或数据损坏。' };
        }

        const detection = await groundingDinoService.detect(decoded.buffer, phrases);
        if (isMattingWorkflowCancelled(args.control)) {
            return buildMattingCancelledResult('detection');
        }
        if (!detection.success) {
            return {
                success: false,
                error: detection.error,
                errorCode: 'SEMANTIC_DETECTION_FAILED',
                diagnostic: { stage: 'detection', reason: 'detector_failed' },
                semanticTargetLifecycle: lifecycle
            };
        }
        const detectionCompleteness = validateSemanticDetectionCompleteness(detection);
        if (!detectionCompleteness.valid) {
            logService?.logAgent(
                'warn',
                `[UXP Handler] 语义检测实例被安全上限截断: ${JSON.stringify({
                    candidateCountBeforeLimit: detection.candidateCountBeforeLimit,
                    returnedRegionCount: detection.returnedRegionCount,
                    truncatedRegionCount: detection.truncatedRegionCount,
                    truncationReason: detection.truncationReason,
                    complete: detection.complete,
                    issues: detectionCompleteness.issues
                })}`
            );
            return {
                success: false,
                error: '检测到的目标实例超过单次安全处理上限，本轮没有修改图层。请缩小范围或分批处理。',
                errorCode: 'SEMANTIC_DETECTION_TRUNCATED',
                diagnostic: {
                    stage: 'post-detection',
                    reason: 'detection_result_truncated',
                    candidateCountBeforeLimit: detection.candidateCountBeforeLimit,
                    returnedRegionCount: detection.returnedRegionCount,
                    truncatedRegionCount: detection.truncatedRegionCount,
                    truncationReason: detection.truncationReason,
                    complete: detection.complete,
                    issues: detectionCompleteness.issues
                },
                semanticTargetLifecycle: lifecycle
            };
        }

        const detectedPhrases = new Set(
            detection.boxes.map(box => String(box.phrase || '').trim().toLowerCase()).filter(Boolean)
        );
        const missingPhrases = phrases.filter(phrase => !detectedPhrases.has(phrase.trim().toLowerCase()));
        lifecycle.detectedTargetCount = phrases.length - missingPhrases.length;
        lifecycle.candidateRegionCount = detection.boxes.length;
        lifecycle.detectedRegionCount = detection.boxes.length;
        lifecycle.unselectedCandidateCount = 0;
        lifecycle.instanceSelectionMode = 'all_detected';
        const postDetection = validateSemanticTargetLifecycle(lifecycle, 'post-detection');

        if (!postDetection.valid) {
            const scoreHint = typeof detection.maxScore === 'number'
                ? `（画面中与之最接近的区域置信度只有 ${detection.maxScore.toFixed(2)}）`
                : '';
            logService?.logAgent(
                'warn',
                `[UXP Handler] 语义检测未覆盖全部目标: ${JSON.stringify({
                    issues: postDetection.issues,
                    phrases,
                    detectedPhrases: [...detectedPhrases],
                    missingPhrases,
                    boxCount: detection.boxes.length
                })}`
            );
            return {
                success: false,
                error: `没有在当前图层中找到全部点名目标${scoreHint}。

`
                    + '可以换一个更具体或更常见的说法，确认选中的是正确图层，'
                    + '或改用"使用选区"模式手动框选。本轮没有修改图层。',
                errorCode: 'SEMANTIC_DETECTION_INCOMPLETE',
                diagnostic: {
                    stage: 'post-detection',
                    issues: postDetection.issues,
                    requestedPhrases: phrases,
                    detectedPhrases: [...detectedPhrases],
                    missingPhrases,
                    detectedRegionCount: detection.boxes.length
                },
                semanticTargetLifecycle: lifecycle
            };
        }

        const boxSummary = detection.boxes
            .map(b => `${b.phrase}:${b.confidence.toFixed(2)}@(${b.x1},${b.y1})-(${b.x2},${b.y2})`)
            .join(' ');
        logService?.logAgent(
            'info',
            `[UXP Handler] Detected ${detection.boxes.length} target(s) in ${detection.processingTime}ms — ${boxSummary}`
        );

        const semanticBoxes = detection.boxes.map(box => ({
            x1: box.x1,
            y1: box.y1,
            x2: box.x2,
            y2: box.y2,
            phrase: box.phrase
        }));
        let selectedSemanticBoxes = semanticBoxes;
        let guidancePointsByBox: SemanticMattingProviderPoint[][] | undefined;
        if (args.semanticGuidance) {
            const baseExportGeometry = validateSemanticBaseExportReceipt({
                exportResult: args.exportResult,
                expectedMode: args.sampleAllLayers ? 'composite-layer-bounds' : 'layer-full',
                outputGeometry: {
                    left: Number(args.exportResult?.originalLeft),
                    top: Number(args.exportResult?.originalTop),
                    width: Number(args.exportResult?.originalWidth),
                    height: Number(args.exportResult?.originalHeight)
                }
            });
            if (!baseExportGeometry.valid || !baseExportGeometry.regionInOutput) {
                return {
                    success: false,
                    error: '首次图像导出的坐标收据无效，无法绑定语义引导，本轮没有修改图层。',
                    errorCode: 'SEMANTIC_GUIDANCE_GEOMETRY_INVALID',
                    diagnostic: {
                        stage: 'post-detection',
                        reason: baseExportGeometry.code || 'base_region_missing',
                        issues: baseExportGeometry.issues
                    },
                    semanticTargetLifecycle: lifecycle
                };
            }
            const binding = bindSemanticMattingGuidanceToDetectionBoxes({
                guidance: args.semanticGuidance,
                boxes: semanticBoxes,
                outputWidth: Number(args.exportResult?.originalWidth),
                outputHeight: Number(args.exportResult?.originalHeight),
                baseRegionInOutput: baseExportGeometry.regionInOutput,
                detectWidth: decoded.width,
                detectHeight: decoded.height
            });
            if (!binding.valid) {
                return {
                    success: false,
                    error: binding.error,
                    errorCode: binding.code,
                    diagnostic: {
                        stage: 'post-detection',
                        reason: 'semantic_guidance_binding_failed',
                        issues: binding.issues
                    },
                    semanticTargetLifecycle: lifecycle
                };
            }
            const selection = selectSemanticMattingDetectionInstances({
                guidance: args.semanticGuidance,
                boxes: semanticBoxes,
                pointsByBox: binding.pointsByBox,
                guidedBoxIndexes: binding.guidedBoxIndexes,
                requestedPhrases: phrases
            });
            if (!selection.valid) {
                return {
                    success: false,
                    error: selection.error,
                    errorCode: selection.code,
                    diagnostic: {
                        stage: 'post-detection',
                        reason: 'semantic_instance_selection_incomplete',
                        issues: selection.issues,
                        candidateRegionCount: semanticBoxes.length
                    },
                    semanticTargetLifecycle: lifecycle
                };
            }
            selectedSemanticBoxes = selection.boxes;
            guidancePointsByBox = selection.pointsByBox;
            lifecycle.candidateRegionCount = selection.candidateRegionCount;
            lifecycle.detectedRegionCount = selection.selectedRegionCount;
            lifecycle.unselectedCandidateCount = selection.unselectedCandidateCount;
            lifecycle.instanceSelectionMode = selection.mode;
            if (selection.mode === 'exact_guided_instances') {
                lifecycle.detectedTargetCount = phrases.length;
                const postSelection = validateSemanticTargetLifecycle(lifecycle, 'post-detection');
                if (!postSelection.valid) {
                    return {
                        success: false,
                        error: 'Agent 选择的目标实例收据不完整，本轮没有修改图层。',
                        errorCode: 'SEMANTIC_INSTANCE_SELECTION_RECEIPT_INVALID',
                        diagnostic: {
                            stage: 'post-detection',
                            reason: 'instance_selection_receipt_invalid',
                            issues: postSelection.issues,
                            lifecycle
                        },
                        semanticTargetLifecycle: lifecycle
                    };
                }
                logService?.logAgent(
                    'info',
                    `[UXP Handler] Agent exact instance selection: `
                    + `${selection.selectedRegionCount}/${selection.candidateRegionCount}, `
                    + `unselected=${selection.unselectedCandidateCount}`
                );
            }
        }

        sendMattingProgress(
            60,
            `已选定 ${selectedSemanticBoxes.length} 处「${args.targetPrompt}」，正在生成选区...`,
            'segmentation'
        );

        // 3. 按目标框二次高分辨率取像，再在局部图上精细分割。
        //    第一次导出为了让检测器看全画面，被压到 1024 长边；直接在那张图上分割，
        //    目标只有一百多像素，边缘精度从源头就丢了。
        const { result } = await segmentWithAutoExpand({
            boxes: selectedSemanticBoxes,
            guidancePointsByBox,
            detectWidth: decoded.width,
            detectHeight: decoded.height,
            exportResult: args.exportResult,
            normalizedQuality: args.normalizedQuality,
            edgeRefine: args.edgeRefine,
            sampleAllLayers: args.sampleAllLayers,
            targetDimensions: args.targetDimensions,
            fallbackImageInput: args.imageInput,
            control: args.control
        });

        if (isMattingWorkflowCancelled(args.control)) {
            return buildMattingCancelledResult('segmentation');
        }

        if (!result?.success) {
            return {
                ...result,
                success: false,
                error: result?.error || '目标分割失败，本轮没有修改图层。',
                errorCode: result?.errorCode || 'SEMANTIC_SEGMENTATION_FAILED',
                diagnostic: {
                    stage: 'segmentation',
                    ...(result?.diagnostic || {}),
                    lifecycle
                },
                semanticTargetLifecycle: lifecycle
            };
        }

        const segmentationReceipt = result.targetCompleteness;
        lifecycle.segmentationRequestedRegionCount = Number(segmentationReceipt?.requestedRegionCount) || 0;
        lifecycle.segmentationCompletedRegionCount = Number(segmentationReceipt?.segmentedRegionCount) || 0;
        lifecycle.segmentationRequestedTargetCount = Number(segmentationReceipt?.requestedTargetCount) || 0;
        lifecycle.segmentationCompletedTargetCount = Number(segmentationReceipt?.segmentedTargetCount) || 0;
        lifecycle.segmentationComplete = segmentationReceipt?.schema === 'semantic-matting-target-completeness/v1'
            && segmentationReceipt?.complete === true
            && Array.isArray(segmentationReceipt?.failedRegionIndexes)
            && segmentationReceipt.failedRegionIndexes.length === 0;
        const preApply = validateSemanticTargetLifecycle(lifecycle, 'pre-apply');
        if (!preApply.valid) {
            logService?.logAgent(
                'warn',
                `[UXP Handler] 语义分割收据不完整: ${JSON.stringify({
                    issues: preApply.issues,
                    lifecycle,
                    targetCompleteness: segmentationReceipt
                })}`
            );
            return {
                success: false,
                error: '已找到目标，但分割结果没有完整覆盖全部目标，本轮没有修改图层。请调整目标描述或改用选区模式。',
                errorCode: 'SEMANTIC_SEGMENTATION_INCOMPLETE',
                diagnostic: {
                    stage: 'pre-apply',
                    issues: preApply.issues,
                    targetCompleteness: segmentationReceipt
                },
                semanticTargetLifecycle: lifecycle
            };
        }

        const confidences = detection.boxes.map(b => b.confidence.toFixed(2)).join('、');
        const parts = [
            `语义抠图：「${args.targetPrompt}」→ [${phrases.join(', ')}] → ${detection.boxes.length} 处目标（置信度 ${confidences}）`,
            result.analysis || ''
        ];
        result.analysis = parts.filter(Boolean).join(' | ');
        result.processingTime = Date.now() - startTime;
        result.semanticTargetLifecycle = lifecycle;

        return result;
    };

    const buildMattingApplyPayload = (mattingResult: any, exportResult?: any) => {
        if (
            Buffer.isBuffer(mattingResult?.maskBuffer) &&
            typeof mattingResult?.maskWidth === 'number' &&
            typeof mattingResult?.maskHeight === 'number'
        ) {
            assertRawMaskGeometry(
                mattingResult.maskBuffer.length,
                mattingResult.maskWidth,
                mattingResult.maskHeight
            );
            const binaryRequestId = nextMattingBinaryResponseId++;
            if (nextMattingBinaryResponseId >= 0xffffffff) {
                nextMattingBinaryResponseId = 1000000000;
            }

            wsServer.sendBinaryData(
                BinaryMessageType.RAW_MASK,
                binaryRequestId,
                mattingResult.maskWidth,
                mattingResult.maskHeight,
                mattingResult.maskBuffer
            );

            logService?.logAgent(
                'info',
                `[UXP Handler] Sent binary RAW_MASK: requestId=${binaryRequestId}, ${mattingResult.maskWidth}x${mattingResult.maskHeight}, ${(mattingResult.maskBuffer.length / 1024).toFixed(0)}KB`
            );

            return {
                useBinaryMask: true,
                binaryRequestId,
                maskWidth: mattingResult.maskWidth,
                maskHeight: mattingResult.maskHeight,
                originalLeft: exportResult?.originalLeft,
                originalTop: exportResult?.originalTop,
                docWidth: exportResult?.docWidth,
                docHeight: exportResult?.docHeight
            };
        }

        return {
            originalLeft: exportResult?.originalLeft,
            originalTop: exportResult?.originalTop,
            docWidth: exportResult?.docWidth,
            docHeight: exportResult?.docHeight,
            maskImageBase64: mattingResult?.maskImage
        };
    };

    wsServer.registerHandler('get-visual-context', async (params: {
        maxSize?: number;
        includeHidden?: boolean;
        layerFilter?: 'all' | 'visual' | 'text';
    }) => {
        logService?.logAgent('info', '[UXP Handler] Received visual context request');

        try {
            if (!wsServer.isPluginConnected()) {
                return { success: false, error: 'Photoshop plugin is not connected' };
            }

            const snapshotResult = await wsServer.sendRequest('getCanvasSnapshot', {
                maxSize: params.maxSize || 1200,
                format: 'jpeg',
                quality: 90
            });

            if (!snapshotResult?.success || !snapshotResult?.snapshot?.base64) {
                return {
                    success: false,
                    error: snapshotResult?.error
                        || snapshotResult?.message
                        || 'Photoshop 没有返回可用的画布快照。'
                };
            }

            const mappingResult = await wsServer.sendRequest('getElementMapping', {
                includeHidden: params.includeHidden || false,
                includeGroups: true,
                sortBy: 'position'
            });

            if (!mappingResult?.success || !mappingResult?.elements) {
                return { success: false, error: 'Failed to get element mapping' };
            }

            const snapshotWidth = snapshotResult.snapshot.width || 1;
            const snapshotHeight = snapshotResult.snapshot.height || 1;
            const documentWidth = snapshotResult.documentInfo?.width || 1;
            const documentHeight = snapshotResult.documentInfo?.height || 1;
            const widthScale = snapshotWidth / documentWidth;
            const heightScale = snapshotHeight / documentHeight;

            const layers = mappingResult.elements.map((el: any, idx: number) => ({
                id: el.id,
                index: idx + 1,
                name: el.name,
                kind: el.type,
                visible: el.visible,
                bounds: {
                    left: Math.round(el.bounds.left * widthScale),
                    top: Math.round(el.bounds.top * heightScale),
                    right: Math.round(el.bounds.right * widthScale),
                    bottom: Math.round(el.bounds.bottom * heightScale),
                    width: Math.round(el.bounds.width * widthScale),
                    height: Math.round(el.bounds.height * heightScale)
                },
                textContent: el.textContent
            }));

            const annotationService = getVisualAnnotationService();
            const annotationResult = await annotationService.annotateSnapshot(
                snapshotResult.snapshot.base64,
                layers
            );

            if (!annotationResult.success) {
                logService?.logAgent('warn', `[UXP Handler] Visual annotation failed: ${annotationResult.error}`);
                return {
                    success: true,
                    snapshot: snapshotResult.snapshot.base64,
                    layers,
                    layerMapping: generateSimpleMapping(layers),
                    documentInfo: snapshotResult.documentInfo,
                    summary: mappingResult.summary,
                    annotated: false
                };
            }

            logService?.logAgent('info', `[UXP Handler] Visual context ready with ${layers.length} layers`);

            return {
                success: true,
                snapshot: annotationResult.annotatedImage,
                layers,
                layerMapping: annotationResult.layerMapping,
                documentInfo: snapshotResult.documentInfo,
                summary: mappingResult.summary,
                annotated: true
            };
        } catch (error: any) {
            logService?.logAgent('error', `[UXP Handler] Visual context failed: ${error.message}`);
            return { success: false, error: error.message };
        }
    });

    wsServer.registerHandler('get-matting-config', async () => {
        try {
            const serviceStatus = await mattingService?.getPythonBackendStatus();
            const groundingStatus = groundingDinoService?.checkModelsExist();
            const samStatus = samService?.checkModelsExist();
            const semanticDetectorInstalled = groundingStatus?.model === true
                && groundingStatus.tokenizer === true;
            const semanticSegmenterInstalled = samStatus?.encoder === true
                && samStatus.decoder === true;
            const availableModels = new Set(serviceStatus?.models || []);
            if (semanticDetectorInstalled) availableModels.add('grounding-dino');
            if (semanticSegmenterInstalled) availableModels.add('mobile-sam');

            return {
                success: true,
                modelNameMap: {
                    birefnet: 'BiRefNet',
                    'grounding-dino': 'GroundingDINO',
                    'mobile-sam': 'MobileSAM',
                    'yolo-world': 'YOLO-World（旧链）'
                },
                availableModels: [...availableModels],
                stages: [
                    { id: 'detection', name: '文字目标定位', icon: '[DET]' },
                    { id: 'segmentation', name: '逐目标范围分割', icon: '[SEG]' },
                    { id: 'edge-refine', name: '可选边缘增强', icon: '[EDGE]' }
                ],
                localOnnx: serviceStatus?.available === true || semanticDetectorInstalled || semanticSegmenterInstalled,
                semanticOnnxReady: semanticDetectorInstalled && semanticSegmenterInstalled
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    wsServer.registerHandler('remove-background', async (params: {
        mode?: string;
        useMask?: boolean;
        outputFormat?: string;
        quality?: string;
        targetPrompt?: string;
        enableHairRefine?: boolean;
        enableFabricRefine?: boolean;
        usePythonBackend?: boolean;
        sampleAllLayers?: boolean;
        layerId?: number;
        expectedDocumentId?: number;
        expectedHistoryStateId?: number;
        semanticGuidance?: unknown;
        requestKey?: string;
        abortSignal?: AbortSignal;
    }) => {
        logService?.logAgent('info', '[UXP Handler] Received panel matting request');

        if (!mattingService) {
            return { success: false, error: '抠图服务未初始化。请在设置 → 图像处理中检查本地模型状态后重试。' };
        }

        if (!wsServer.isPluginConnected()) {
            return { success: false, error: 'Photoshop 插件未连接，请先在面板完成连接。' };
        }

        const targetPrompt = String(params.targetPrompt || '').trim();
        const outputFormat = normalizeMattingOutputFormat(params.outputFormat);
        if (!outputFormat) {
            return {
                success: false,
                error: '输出格式无效，只能使用蒙版、选区、Alpha 通道或新图层。',
                errorCode: 'MATTING_OUTPUT_FORMAT_INVALID'
            };
        }
        const guidanceValidation = normalizeSemanticMattingGuidance(params.semanticGuidance);
        if (!guidanceValidation.valid) {
            return {
                success: false,
                error: `${guidanceValidation.error} ${guidanceValidation.issues.join(' ')}`.trim(),
                errorCode: guidanceValidation.code,
                noMutation: true,
                executesPhotoshop: false
            };
        }
        const semanticGuidance = guidanceValidation.guidance;
        if (semanticGuidance && !targetPrompt) {
            return {
                success: false,
                error: '正负点引导必须绑定 Agent 明确选择的语义目标，抠图工作流没有启动。',
                errorCode: 'SEMANTIC_GUIDANCE_REQUIRES_TARGET',
                noMutation: true,
                executesPhotoshop: false
            };
        }
        const sampleAllLayers = params.sampleAllLayers === true;
        const normalizedQuality = normalizeMattingQuality(params.quality);
        const exportMaxSize = resolveMattingExportMaxSize(params.quality);
        const control: MattingWorkflowExecutionControl = {
            requestKey: String(params.requestKey || '').trim() || undefined,
            abortSignal: params.abortSignal
        };
        if (isMattingWorkflowCancelled(control)) {
            return buildMattingCancelledResult('prepare-export');
        }
        let photoshopApplyStarted = false;

        try {
            sendMattingProgress(3, '正在导出图层图像', 'prepare-export');

            logService?.logAgent('info', `[UXP Handler] Step 1: exporting layer image (sampleAllLayers=${sampleAllLayers})`);
            const exportResult = await wsServer.sendRequest('removeBackground', {
                mode: 'ai',
                layerId: params.layerId,
                targetPrompt,
                maxSize: exportMaxSize,
                // 对所有图层取样：导出图层边界内的复合图像，让模型看到完整上下文
                sampleAllLayers
            }, 60000, control.requestKey ? { requestKey: control.requestKey } : {});

            if (isMattingWorkflowCancelled(control)) {
                return buildMattingCancelledResult('prepare-export');
            }

            if (!exportResult?.success) {
                return {
                    success: false,
                    error: exportResult?.message || exportResult?.error || '导出图层图像失败：请确认已在 Photoshop 中选中目标图层。',
                    errorCode: exportResult?.error
                };
            }
            const initialTargetIdentity = validateMattingTargetIdentityReceipt(exportResult?.targetIdentity);
            if (!initialTargetIdentity.valid || !initialTargetIdentity.identity
                || Number(exportResult?.sourceHistoryStateRef?.documentId) !== initialTargetIdentity.identity.documentId
                || Number(exportResult?.sourceHistoryStateRef?.historyStateId) !== initialTargetIdentity.identity.historyStateId
                || Number(exportResult?.layerId) !== initialTargetIdentity.identity.layerId) {
                return {
                    success: false,
                    error: 'Photoshop 插件没有返回可验证的文档、版本与图层身份，本轮没有修改图层。请重启并更新插件后重试。',
                    errorCode: 'MATTING_INITIAL_TARGET_IDENTITY_INVALID',
                    diagnostic: {
                        stage: 'prepare-export',
                        reason: initialTargetIdentity.code || 'history_state_ref_mismatch'
                    }
                };
            }
            const expectedTargetValidation = validateExpectedMattingTargetIdentity({
                identity: initialTargetIdentity.identity,
                expectedDocumentId: params.expectedDocumentId,
                expectedHistoryStateId: params.expectedHistoryStateId
            });
            if (!expectedTargetValidation.valid) {
                return {
                    success: false,
                    error: '当前 Photoshop 文档或版本已不同于调用方确认的目标，本轮没有执行模型推理，也没有修改图层。请重新读取文档与历史版本后再决定是否重试。',
                    errorCode: 'MATTING_EXPECTED_TARGET_MISMATCH',
                    diagnostic: {
                        stage: 'prepare-export',
                        reason: expectedTargetValidation.code,
                        expectedDocumentId: params.expectedDocumentId,
                        expectedHistoryStateId: params.expectedHistoryStateId,
                        actualDocumentId: initialTargetIdentity.identity.documentId,
                        actualHistoryStateId: initialTargetIdentity.identity.historyStateId,
                        actualLayerId: initialTargetIdentity.identity.layerId
                    }
                };
            }

            const layerId = exportResult.layerId;
            const baseExportReceipt = validateSemanticBaseExportReceipt({
                exportResult,
                expectedMode: sampleAllLayers ? 'composite-layer-bounds' : 'layer-full',
                outputGeometry: {
                    left: Number(exportResult?.originalLeft),
                    top: Number(exportResult?.originalTop),
                    width: Number(exportResult?.originalWidth),
                    height: Number(exportResult?.originalHeight)
                }
            });
            if (!baseExportReceipt.valid) {
                return {
                    success: false,
                    error: '首次图像导出的实际范围或取样模式无法验证，本轮没有修改图层。请检查图层状态后重试。',
                    errorCode: 'MATTING_INITIAL_EXPORT_RECEIPT_INVALID',
                    diagnostic: {
                        stage: 'prepare-export',
                        reason: baseExportReceipt.code,
                        issues: baseExportReceipt.issues,
                        sourceExportMode: exportResult?.sourceExportMode
                    }
                };
            }

            const imageInput = await resolveMattingImageInput(exportResult);
            const targetDimensions = resolveMattingTargetDimensions(exportResult);

            if (isMattingWorkflowCancelled(control)) {
                return buildMattingCancelledResult('export-ready');
            }

            if (!imageInput) {
                return { success: false, error: '未能获取图层图像数据：图层可能为空、被隐藏或边界无效。' };
            }

            logService?.logAgent('info', `[UXP Handler] Step 1 complete: ${describeMattingInput(imageInput)}, layerId=${layerId}`);
            sendMattingProgress(15, '图层图像就绪', 'export-ready');

            // Step 2：填了"抠取目标"就走语义抠图——先按描述定位目标框，再在框内分割。
            // 不能退回全图分割：BiRefNet 是显著性分割，画面里有鞋有袜时它给的是最显著的那个，
            // 用户看到的却是"语义抠图已完成"，这正是旧实现掩盖了三年的假象。
            const mattingResult = targetPrompt
                ? await runSemanticMatting({
                    imageInput,
                    targetPrompt,
                    normalizedQuality,
                    edgeRefine: resolveMattingEdgeRefineMode(params, 'product-hard'),
                    targetDimensions,
                    exportResult,
                    sampleAllLayers,
                    semanticGuidance,
                    control
                })
                : await runSalientMatting({
                    imageInput,
                    normalizedQuality,
                    edgeRefine: resolveMattingEdgeRefineMode(params, 'product-hard'),
                    targetDimensions,
                    exportResult,
                    sampleAllLayers
                });

            if (isMattingWorkflowCancelled(control)) {
                return buildMattingCancelledResult('pre-apply');
            }

            if (!mattingResult?.success || (!mattingResult?.maskImage && !mattingResult?.maskBuffer)) {
                return {
                    success: false,
                    error: mattingResult?.error || '分割模型推理失败：未生成有效蒙版，请重试或更换抠取目标描述。',
                    errorCode: mattingResult?.errorCode,
                    diagnostic: mattingResult?.diagnostic,
                    semanticTargetLifecycle: mattingResult?.semanticTargetLifecycle
                };
            }

            const semanticTargetContract = targetPrompt
                ? mattingResult.semanticTargetLifecycle as SemanticTargetLifecycleReceipt | undefined
                : undefined;
            if (targetPrompt) {
                const preApply = semanticTargetContract
                    ? validateSemanticTargetLifecycle(semanticTargetContract, 'pre-apply')
                    : { valid: false, issues: ['missing_lifecycle_receipt'] };
                if (exportResult?.sourceExportReceiptSchema !== 'matting-source-export/v1') {
                    preApply.valid = false;
                    preApply.issues.push('uxp_apply_contract_capability_unverified');
                }
                if (!preApply.valid) {
                    return {
                        success: false,
                        error: '目标检测或分割收据不完整，无法安全应用蒙版，本轮没有修改图层。',
                        errorCode: 'SEMANTIC_PRE_APPLY_CONTRACT_INVALID',
                        diagnostic: {
                            stage: 'pre-apply',
                            issues: preApply.issues,
                            semanticTargetContract,
                            exportReceiptSchema: exportResult?.sourceExportReceiptSchema
                        }
                    };
                }
            }

            logService?.logAgent('info', `[UXP Handler] Step 2 complete: model=${mattingResult.usedModel}, duration=${mattingResult.processingTime}ms`);
            sendMattingProgress(96, '正在应用抠图结果', 'apply-mask');

            if (isMattingWorkflowCancelled(control)) {
                return buildMattingCancelledResult('apply-mask');
            }

            const applyPayload = buildMattingApplyPayload(mattingResult, exportResult);
            photoshopApplyStarted = true;
            const applyResult = await wsServer.sendRequest('applyMattingResult', {
                originalLayerId: layerId,
                outputFormat,
                createNewLayer: false,
                semanticTargetContract,
                expectedTargetIdentity: initialTargetIdentity.identity,
                ...applyPayload
            }, 60000, control.requestKey ? { requestKey: control.requestKey } : {});

            if (!applyResult?.success) {
                return {
                    success: false,
                    error: applyResult?.message || applyResult?.error || `应用抠图结果失败：无法在图层上创建${outputFormat === 'selection' ? '选区' : '蒙版'}。`,
                    errorCode: applyResult?.errorCode || applyResult?.error
                };
            }

            const mutationReceiptValidation = validateMattingMutationReceipt({
                value: applyResult?.mutationReceipt,
                expectedTargetIdentity: initialTargetIdentity.identity,
                expectedOutputFormat: outputFormat,
                expectedMaskWidth: Number(mattingResult.maskWidth),
                expectedMaskHeight: Number(mattingResult.maskHeight)
            });
            if (!mutationReceiptValidation.valid) {
                return {
                    success: false,
                    error: 'Photoshop 已返回操作结果，但写入后的文档版本或输出内容无法完整核对。当前状态未知，请先检查图层，不要重复执行。',
                    errorCode: 'MATTING_MUTATION_RECEIPT_INVALID',
                    diagnostic: {
                        stage: 'post-apply',
                        issues: mutationReceiptValidation.issues,
                        mutationReceipt: applyResult?.mutationReceipt
                    }
                };
            }

            let semanticTargetReceipt: SemanticTargetLifecycleReceipt | undefined;
            if (semanticTargetContract) {
                semanticTargetReceipt = applyResult?.semanticTargetReceipt;
                const immutableFields: Array<keyof SemanticTargetLifecycleReceipt> = [
                    'schema',
                    'requestedTargetCount',
                    'unresolvedTargetCount',
                    'omittedTargetCount',
                    'detectedTargetCount',
                    'candidateRegionCount',
                    'detectedRegionCount',
                    'unselectedCandidateCount',
                    'instanceSelectionMode',
                    'segmentationRequestedRegionCount',
                    'segmentationCompletedRegionCount',
                    'segmentationRequestedTargetCount',
                    'segmentationCompletedTargetCount',
                    'segmentationComplete'
                ];
                const receiptMatches = Boolean(semanticTargetReceipt)
                    && immutableFields.every(field => semanticTargetReceipt![field] === semanticTargetContract[field]);
                const postApply = semanticTargetReceipt
                    ? validateSemanticTargetLifecycle(semanticTargetReceipt, 'post-apply')
                    : { valid: false, issues: ['missing_apply_receipt'] };
                if (!receiptMatches) postApply.issues.push('apply_receipt_mismatch');
                if (!receiptMatches || !postApply.valid) {
                    logService?.logAgent(
                        'error',
                        `[UXP Handler] 语义抠图应用收据无效: ${JSON.stringify({
                            issues: postApply.issues,
                            expected: semanticTargetContract,
                            actual: semanticTargetReceipt
                        })}`
                    );
                    return {
                        success: false,
                        error: 'Photoshop 已返回操作结果，但无法核对全部目标是否完整应用。当前写入状态未知，请先检查图层，不要重复执行。',
                        errorCode: 'SEMANTIC_APPLY_RECEIPT_INVALID',
                        diagnostic: {
                            stage: 'post-apply',
                            issues: postApply.issues,
                            expected: semanticTargetContract,
                            actual: semanticTargetReceipt
                        }
                    };
                }
            }

            sendMattingProgress(100, '抠图完成', 'complete');
            logService?.logAgent('info', `[UXP Handler] Matting complete: layerId=${layerId}, outputFormat=${outputFormat}`);

            return {
                success: true,
                message: '抠图完成',
                layerId,
                processingTime: mattingResult.processingTime,
                usedModel: mattingResult.usedModel,
                semanticTargetReceipt,
                mutationReceipt: mutationReceiptValidation.receipt
            };
        } catch (error: any) {
            if (isMattingWorkflowCancelled(control)) {
                if (photoshopApplyStarted) {
                    return {
                        success: false,
                        error: '取消发生在 Photoshop 写入请求发出之后，但没有取得可验证的最终收据。当前写入状态未知，请先检查目标图层，不要重复执行。',
                        errorCode: 'MATTING_CANCELLED_WRITE_STATE_UNKNOWN',
                        diagnostic: {
                            stage: 'apply-mask',
                            reason: 'cancelled_after_write_dispatch',
                            underlyingError: error?.message || String(error)
                        }
                    };
                }
                return buildMattingCancelledResult('workflow');
            }
            logService?.logAgent('error', `[UXP Handler] Matting failed: ${error.message}`);
            return { success: false, error: error.message || '抠图失败：发生未知错误，请查看日志。' };
        }
    });

    wsServer.registerHandler('remove-background-by-selection', async (params: {
        outputFormat?: string;
        targetPrompt?: string;
        bbox?: [number, number, number, number];
        box?: [number, number, number, number];
        layerId?: number;
        quality?: string;
        refineEdges?: boolean;
        enableHairRefine?: boolean;
        enableFabricRefine?: boolean;
    }) => {
        logService?.logAgent('info', '[UXP Handler] Received selection matting request');

        if (!mattingService) {
            return { success: false, error: 'Matting service is not initialized' };
        }

        if (!wsServer.isPluginConnected()) {
            return { success: false, error: 'Photoshop plugin is not connected' };
        }

        try {
            sendMattingProgress(3, 'Preparing layer export', 'prepare-export');
            const normalizedQuality = normalizeMattingQuality(params.quality);
            const exportMaxSize = resolveMattingExportMaxSize(params.quality);
            const outputFormat = normalizeMattingOutputFormat(params.outputFormat);
            if (!outputFormat) {
                return {
                    success: false,
                    error: '输出格式无效，只能使用蒙版、选区、Alpha 通道或新图层。',
                    errorCode: 'MATTING_OUTPUT_FORMAT_INVALID'
                };
            }

            const exportResult = await wsServer.sendRequest('removeBackground', {
                mode: 'ai',
                layerId: params.layerId,
                targetPrompt: params.targetPrompt || '',
                maxSize: exportMaxSize
            }, 60000);

            if (!exportResult?.success) {
                return {
                    success: false,
                    error: exportResult?.message || exportResult?.error || '导出图层图像失败。',
                    errorCode: exportResult?.error
                };
            }

            const selectionTargetIdentity = validateMattingTargetIdentityReceipt(exportResult?.targetIdentity);
            if (!selectionTargetIdentity.valid || !selectionTargetIdentity.identity
                || Number(exportResult?.sourceHistoryStateRef?.documentId) !== selectionTargetIdentity.identity.documentId
                || Number(exportResult?.sourceHistoryStateRef?.historyStateId) !== selectionTargetIdentity.identity.historyStateId
                || Number(exportResult?.layerId) !== selectionTargetIdentity.identity.layerId) {
                return {
                    success: false,
                    error: 'Photoshop 插件没有返回可验证的文档、版本与图层身份，本轮没有修改图层。',
                    errorCode: 'MATTING_SELECTION_TARGET_IDENTITY_INVALID'
                };
            }
            const selectionBaseReceipt = validateSemanticBaseExportReceipt({
                exportResult,
                expectedMode: 'layer-full',
                outputGeometry: {
                    left: Number(exportResult?.originalLeft),
                    top: Number(exportResult?.originalTop),
                    width: Number(exportResult?.originalWidth),
                    height: Number(exportResult?.originalHeight)
                }
            });
            if (!selectionBaseReceipt.valid) {
                return {
                    success: false,
                    error: '图层导出的实际范围无法验证，本轮没有修改图层。',
                    errorCode: 'MATTING_SELECTION_EXPORT_RECEIPT_INVALID',
                    diagnostic: { reason: selectionBaseReceipt.code, issues: selectionBaseReceipt.issues }
                };
            }

            const imageInput = await resolveMattingImageInput(exportResult);
            const targetDimensions = resolveMattingTargetDimensions(exportResult);
            if (!imageInput) {
                return { success: false, error: 'Failed to get layer image data' };
            }

            sendMattingProgress(15, 'Layer image is ready', 'export-ready');

            const rawSelectionBox = params.bbox || params.box;
            let selectionBox: { x1: number; y1: number; x2: number; y2: number } | undefined;
            if (
                Array.isArray(rawSelectionBox) &&
                rawSelectionBox.length === 4 &&
                Number.isFinite(exportResult?.originalLeft) &&
                Number.isFinite(exportResult?.originalTop)
            ) {
                const [left, top, right, bottom] = rawSelectionBox.map(value => Number(value));
                selectionBox = {
                    x1: left - Number(exportResult.originalLeft),
                    y1: top - Number(exportResult.originalTop),
                    x2: right - Number(exportResult.originalLeft),
                    y2: bottom - Number(exportResult.originalTop)
                };
            }

            const mattingResult = await mattingService.removeBackground(imageInput, {
                targetPrompt: params.targetPrompt || '',
                quality: normalizedQuality,
                returnMask: true,
                binaryMaskOutput: true,
                edgeRefine: resolveMattingEdgeRefineMode(params, 'standard'),
                selectionBox,
                selectionBoxSpaceWidth: Number(exportResult?.originalWidth) || undefined,
                selectionBoxSpaceHeight: Number(exportResult?.originalHeight) || undefined,
                ...targetDimensions,
                onProgress: (progress, stage, message) => {
                    sendMattingProgress(
                        mapInferenceProgress(progress),
                        message || 'Running matting model',
                        stage
                    );
                }
            });

            if (!mattingResult?.success || (!mattingResult?.maskImage && !mattingResult?.maskBuffer)) {
                return { success: false, error: mattingResult?.error || 'Segmentation inference failed' };
            }

            sendMattingProgress(96, 'Applying matting result', 'apply-mask');
            const applyPayload = buildMattingApplyPayload(mattingResult, exportResult);
            const applyResult = await wsServer.sendRequest('applyMattingResult', {
                originalLayerId: exportResult.layerId,
                outputFormat,
                createNewLayer: false,
                expectedTargetIdentity: selectionTargetIdentity.identity,
                ...applyPayload
            }, 60000);

            if (!applyResult?.success) {
                return {
                    success: false,
                    error: applyResult?.message || applyResult?.error || '应用抠图结果失败。',
                    errorCode: applyResult?.errorCode || applyResult?.error
                };
            }

            const selectionMutationReceipt = validateMattingMutationReceipt({
                value: applyResult?.mutationReceipt,
                expectedTargetIdentity: selectionTargetIdentity.identity,
                expectedOutputFormat: outputFormat,
                expectedMaskWidth: Number(mattingResult.maskWidth),
                expectedMaskHeight: Number(mattingResult.maskHeight)
            });
            if (!selectionMutationReceipt.valid) {
                return {
                    success: false,
                    error: 'Photoshop 已返回操作结果，但写入后的文档版本或输出内容无法完整核对。当前状态未知，请先检查图层，不要重复执行。',
                    errorCode: 'MATTING_MUTATION_RECEIPT_INVALID',
                    diagnostic: {
                        issues: selectionMutationReceipt.issues,
                        mutationReceipt: applyResult?.mutationReceipt
                    }
                };
            }

            sendMattingProgress(100, 'Matting completed', 'complete');

            return {
                success: true,
                message: 'Selection matting completed',
                layerId: exportResult.layerId,
                processingTime: mattingResult.processingTime,
                mutationReceipt: selectionMutationReceipt.receipt
            };
        } catch (error: any) {
            logService?.logAgent('error', `[UXP Handler] Selection matting failed: ${error.message}`);
            return { success: false, error: error.message || 'Selection matting failed' };
        }
    });
}
