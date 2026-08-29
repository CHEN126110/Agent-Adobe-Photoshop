import sharp from 'sharp';

import {
    LAYER_PIXEL_CAPTURE_VERSION
} from '../../shared/layer-pixel-capture-contract';
import {
    SKU_POSE_ALIGNMENT_APPLY_VERSION,
    SKU_POSE_ALIGNMENT_PROVIDER_RECEIPT_VERSION,
    SKU_POSE_ALIGNMENT_WORKFLOW_VERSION,
    type SkuPoseAlignmentApplyRequest,
    type SkuPoseAlignmentBounds,
    type SkuPoseAlignmentWorkingPadding,
    type SkuPoseAlignmentWorkflowRequest
} from '../../shared/sku-pose-alignment-provider-contract';
import type { SkuPoseAlignmentOptions } from '../../shared/sku-pose-alignment-contract';
import { readPhotoshopOperationResult } from '../../shared/photoshop-operation-result';
import { alignSkuRetouchPose } from './sku-retouch/pose-alignment';

export interface SkuPoseAlignmentExportRequest {
    expectedDocumentId: number;
    expectedHistoryStateId: number;
    layerId: number;
    requestKey?: string;
}

export interface SkuPoseAlignmentApplyBinding {
    expectedDocumentId: number;
    expectedHistoryStateId: number;
    requestKey?: string;
}

export interface SkuPoseAlignmentMattingInput {
    rgbaBuffer: Buffer;
    width: number;
    height: number;
}

export interface SkuPoseAlignmentProviderDependencies {
    captureLayer(request: SkuPoseAlignmentExportRequest): Promise<unknown>;
    createForegroundMask(input: SkuPoseAlignmentMattingInput): Promise<{
        success: boolean;
        maskBuffer?: Buffer;
        maskWidth?: number;
        maskHeight?: number;
        error?: string;
    }>;
    applyResult(
        request: SkuPoseAlignmentApplyRequest,
        binding: SkuPoseAlignmentApplyBinding
    ): Promise<unknown>;
}

export interface SkuPoseAlignmentProviderResult extends Record<string, unknown> {
    success: boolean;
    status: 'applied' | 'not_needed' | 'rejected' | 'failed';
    noMutation: boolean;
    code?: string;
    error?: string;
    report?: ReturnType<typeof alignSkuRetouchPose>['report'];
    providerResult?: unknown;
}

interface NormalizedCapture {
    rgba: Buffer;
    width: number;
    height: number;
    contentBounds: SkuPoseAlignmentBounds;
}

interface PreparedPoseCanvas {
    rgb: Buffer;
    mask: Buffer;
    width: number;
    height: number;
    padding: SkuPoseAlignmentWorkingPadding;
    outputBounds: SkuPoseAlignmentBounds;
}

const MAX_PROVIDER_IMAGE_EDGE = 8192;
const MAX_PROVIDER_IMAGE_PIXELS = 48_000_000;
const MAX_RESULT_PNG_BYTES = 48 * 1024 * 1024;

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function requirePositiveInteger(value: unknown, fieldName: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error(`SKU 姿态统一缺少有效的 ${fieldName}。`);
    }
    return parsed;
}

function normalizeResultLayerName(value: unknown): string {
    const name = String(value || '').trim();
    if (!name || name.length > 160 || /[\x00-\x1f]/.test(name)) {
        throw new Error('SKU 姿态统一 resultLayerName 必须是 1~160 字符的可读图层名称。');
    }
    return name;
}

function normalizeOptions(value: unknown): SkuPoseAlignmentOptions {
    const record = asRecord(value);
    const strength = Number(record.strength);
    const cuffLockRatio = Number(record.cuffLockRatio);
    const maxIterations = record.maxIterations === undefined
        ? undefined
        : Number(record.maxIterations);
    if (!Number.isFinite(strength) || strength < 0 || strength > 1
        || !Number.isFinite(cuffLockRatio) || cuffLockRatio < 0 || cuffLockRatio > 0.4
        || (maxIterations !== undefined
            && (!Number.isSafeInteger(maxIterations) || maxIterations < 1 || maxIterations > 4))) {
        throw new Error('SKU 姿态统一 options 无效：strength 需为 0~1，cuffLockRatio 需为 0~0.4，maxIterations 需为 1~4 的整数。');
    }
    return {
        strength,
        cuffLockRatio,
        ...(maxIterations === undefined ? {} : { maxIterations })
    };
}

function readAbortSignal(value: unknown): AbortSignal | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const candidate = value as Partial<AbortSignal>;
    return typeof candidate.aborted === 'boolean'
        ? candidate as AbortSignal
        : undefined;
}

function throwIfAborted(signal: AbortSignal | undefined, stage: string): void {
    if (!signal?.aborted) return;
    throw new Error(`SKU 姿态统一已在${stage}取消，本轮没有启动新的 Photoshop 写入。`);
}

export function normalizeSkuPoseAlignmentWorkflowRequest(
    value: unknown
): SkuPoseAlignmentWorkflowRequest {
    const record = asRecord(value);
    if (record.version !== SKU_POSE_ALIGNMENT_WORKFLOW_VERSION) {
        throw new Error(`SKU 姿态统一只接受 ${SKU_POSE_ALIGNMENT_WORKFLOW_VERSION}。`);
    }
    const requestKey = String(record.requestKey || '').trim() || undefined;
    const abortSignal = readAbortSignal(record.abortSignal);
    return {
        version: SKU_POSE_ALIGNMENT_WORKFLOW_VERSION,
        expectedDocumentId: requirePositiveInteger(record.expectedDocumentId, 'expectedDocumentId'),
        expectedHistoryStateId: requirePositiveInteger(record.expectedHistoryStateId, 'expectedHistoryStateId'),
        layerId: requirePositiveInteger(record.layerId, 'layerId'),
        resultLayerName: normalizeResultLayerName(record.resultLayerName),
        options: normalizeOptions(record.options),
        ...(requestKey ? { requestKey } : {}),
        ...(abortSignal ? { abortSignal } : {})
    };
}

function readBounds(value: unknown): SkuPoseAlignmentBounds | undefined {
    const record = asRecord(value);
    const left = Number(record.left);
    const top = Number(record.top);
    const right = Number(record.right);
    const bottom = Number(record.bottom);
    const width = Number(record.width);
    const height = Number(record.height);
    if (![left, top, right, bottom, width, height].every(Number.isFinite)
        || width <= 0 || height <= 0
        || Math.abs((right - left) - width) > 1.1
        || Math.abs((bottom - top) - height) > 1.1) {
        return undefined;
    }
    return { left, top, right, bottom, width, height };
}

function normalizeBounds(value: unknown): SkuPoseAlignmentBounds {
    const bounds = readBounds(value);
    if (!bounds) {
        throw new Error('SKU 姿态统一快照缺少有效的 Photoshop 图层 bounds。');
    }
    return bounds;
}

function boundsMatch(
    first: SkuPoseAlignmentBounds | undefined,
    second: SkuPoseAlignmentBounds,
    tolerance = 1.1
): boolean {
    return Boolean(first
        && Math.abs(first.left - second.left) <= tolerance
        && Math.abs(first.top - second.top) <= tolerance
        && Math.abs(first.right - second.right) <= tolerance
        && Math.abs(first.bottom - second.bottom) <= tolerance
        && Math.abs(first.width - second.width) <= tolerance
        && Math.abs(first.height - second.height) <= tolerance);
}

function normalizeCaptureResult(
    value: unknown,
    request: SkuPoseAlignmentWorkflowRequest
): NormalizedCapture {
    const result = asRecord(value);
    if (result.success !== true) {
        throw new Error(String(result.error || 'Photoshop 图层 RGBA 捕获失败。'));
    }
    const data = asRecord(result.data);
    const mimeType = String(data.mimeType || '').trim().toLowerCase();
    const width = Number(data.width);
    const height = Number(data.height);
    const contentBounds = normalizeBounds(data.contentBounds);
    const targetIdentity = asRecord(data.targetIdentity);
    const rgbaValue = data.rgbaBuffer;
    let rgba: Buffer | null = null;
    if (Buffer.isBuffer(rgbaValue)) {
        rgba = Buffer.from(rgbaValue);
    } else if (rgbaValue instanceof Uint8Array) {
        rgba = Buffer.from(rgbaValue);
    }
    if (data.version !== LAYER_PIXEL_CAPTURE_VERSION
        || mimeType !== 'image/x-raw-rgba'
        || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
        || width <= 0 || height <= 0
        || Number(data.components) !== 4
        || Number(data.componentSize) !== 8
        || !rgba
        || rgba.length !== width * height * 4
        || Number(data.byteLength) !== rgba.length
        || String(data.checksum || '').trim().toLowerCase() !== fnv1a32(rgba)
        || Number(targetIdentity.documentId) !== request.expectedDocumentId
        || Number(targetIdentity.historyStateId) !== request.expectedHistoryStateId
        || Number(targetIdentity.layerId) !== request.layerId
        || data.noMutation !== true) {
        throw new Error('SKU 姿态统一只接受与当前 document/history/layer 绑定的无损 RGBA 捕获收据。');
    }
    if (width > MAX_PROVIDER_IMAGE_EDGE || height > MAX_PROVIDER_IMAGE_EDGE
        || width * height > MAX_PROVIDER_IMAGE_PIXELS) {
        throw new Error(`SKU 姿态统一图层 ${width}×${height} 超出当前离线 Provider 像素预算。`);
    }
    if (Math.abs(width - Math.round(contentBounds.width)) > 1
        || Math.abs(height - Math.round(contentBounds.height)) > 1) {
        throw new Error(
            `SKU 姿态统一快照尺寸 ${width}×${height} 与 Photoshop 图层 bounds `
            + `${contentBounds.width.toFixed(1)}×${contentBounds.height.toFixed(1)} 不一致；`
            + '已拒绝把缩小或裁切后的候选放大回写。'
        );
    }
    return { rgba, width, height, contentBounds };
}

function fnv1a32(value: Uint8Array | string): string {
    const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
    let hash = 0x811c9dc5;
    for (const byte of bytes) {
        hash ^= byte;
        hash = Math.imul(hash, 0x01000193);
    }
    return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function extractAlpha(rgba: Buffer, pixels: number): Buffer {
    const alpha = Buffer.allocUnsafe(pixels);
    for (let index = 0; index < pixels; index += 1) {
        alpha[index] = rgba[index * 4 + 3];
    }
    return alpha;
}

function extractRgb(rgba: Buffer, pixels: number): Buffer {
    const rgb = Buffer.allocUnsafe(pixels * 3);
    for (let index = 0; index < pixels; index += 1) {
        rgb[index * 3] = rgba[index * 4];
        rgb[index * 3 + 1] = rgba[index * 4 + 1];
        rgb[index * 3 + 2] = rgba[index * 4 + 2];
    }
    return rgb;
}

function alphaRepresentsTransparency(alpha: Buffer): boolean {
    let transparentPixels = 0;
    let visiblePixels = 0;
    for (const value of alpha) {
        if (value < 250) transparentPixels += 1;
        if (value >= 24) visiblePixels += 1;
    }
    return visiblePixels > 0 && transparentPixels / alpha.length >= 0.005;
}

async function resolveForegroundMask(input: {
    captured: NormalizedCapture;
    alpha: Buffer;
    dependencies: SkuPoseAlignmentProviderDependencies;
}): Promise<Buffer> {
    if (alphaRepresentsTransparency(input.alpha)) return input.alpha;
    const matting = await input.dependencies.createForegroundMask({
        rgbaBuffer: input.captured.rgba,
        width: input.captured.width,
        height: input.captured.height
    });
    if (!matting.success || !matting.maskBuffer
        || matting.maskWidth !== input.captured.width
        || matting.maskHeight !== input.captured.height
        || matting.maskBuffer.length !== input.captured.width * input.captured.height) {
        throw new Error(`SKU 姿态统一主体分割失败：${matting.error || '蒙版尺寸或像素无效'}`);
    }
    return matting.maskBuffer;
}

function calculateWorkingPadding(width: number, height: number): SkuPoseAlignmentWorkingPadding {
    const horizontal = Math.max(
        24,
        Math.ceil(width * 0.35),
        Math.ceil(height * 0.12)
    );
    const vertical = Math.max(
        24,
        Math.ceil(height * 0.08),
        Math.ceil(width * 0.08)
    );
    return {
        left: horizontal,
        top: vertical,
        right: horizontal,
        bottom: vertical
    };
}

function buildPreparedPoseCanvas(input: {
    captured: NormalizedCapture;
    sourceRgb: Buffer;
    sourceMask: Buffer;
}): PreparedPoseCanvas {
    const padding = calculateWorkingPadding(input.captured.width, input.captured.height);
    const width = input.captured.width + padding.left + padding.right;
    const height = input.captured.height + padding.top + padding.bottom;
    if (width > MAX_PROVIDER_IMAGE_EDGE || height > MAX_PROVIDER_IMAGE_EDGE
        || width * height > MAX_PROVIDER_IMAGE_PIXELS) {
        throw new Error(
            `SKU 姿态统一安全工作画布 ${width}×${height} 超出当前离线 Provider 像素预算。`
        );
    }
    const rgb = Buffer.alloc(width * height * 3);
    const mask = Buffer.alloc(width * height);
    for (let sourceY = 0; sourceY < input.captured.height; sourceY += 1) {
        const sourceRgbOffset = sourceY * input.captured.width * 3;
        const targetRgbOffset = (
            (sourceY + padding.top) * width + padding.left
        ) * 3;
        input.sourceRgb.copy(
            rgb,
            targetRgbOffset,
            sourceRgbOffset,
            sourceRgbOffset + input.captured.width * 3
        );
        const sourceMaskOffset = sourceY * input.captured.width;
        const targetMaskOffset = (sourceY + padding.top) * width + padding.left;
        input.sourceMask.copy(
            mask,
            targetMaskOffset,
            sourceMaskOffset,
            sourceMaskOffset + input.captured.width
        );
    }

    const scaleX = input.captured.contentBounds.width / input.captured.width;
    const scaleY = input.captured.contentBounds.height / input.captured.height;
    const left = input.captured.contentBounds.left - padding.left * scaleX;
    const top = input.captured.contentBounds.top - padding.top * scaleY;
    const outputWidth = width * scaleX;
    const outputHeight = height * scaleY;
    return {
        rgb,
        mask,
        width,
        height,
        padding,
        outputBounds: {
            left,
            top,
            right: left + outputWidth,
            bottom: top + outputHeight,
            width: outputWidth,
            height: outputHeight
        }
    };
}

function buildOutputRgba(input: {
    rgb: Buffer;
    mask: Buffer;
    pixels: number;
}): Buffer {
    const rgba = Buffer.allocUnsafe(input.pixels * 4);
    for (let index = 0; index < input.pixels; index += 1) {
        rgba[index * 4] = input.rgb[index * 3];
        rgba[index * 4 + 1] = input.rgb[index * 3 + 1];
        rgba[index * 4 + 2] = input.rgb[index * 3 + 2];
        rgba[index * 4 + 3] = input.mask[index];
    }
    return rgba;
}

function readOperationApplicationStatus(value: unknown): string {
    return readPhotoshopOperationResult(value)?.applicationStatus || 'unknown';
}

function validateAppliedProviderResult(input: {
    value: unknown;
    request: SkuPoseAlignmentWorkflowRequest;
    sourceBounds: SkuPoseAlignmentBounds;
    outputBounds: SkuPoseAlignmentBounds;
    qualityReportVersion: string;
    qualityProfile: string;
    qualityFingerprint: string;
}): string | undefined {
    const result = asRecord(input.value);
    const data = asRecord(result.data);
    const receipt = asRecord(data.providerReceipt);
    const operation = readPhotoshopOperationResult(input.value);
    if (!operation
        || operation.toolName !== 'applySkuPoseAlignment'
        || operation.status !== 'verified'
        || operation.applicationStatus !== 'applied'
        || operation.transactionState !== 'committed'
        || operation.effect !== 'applied') {
        return 'Photoshop 没有返回通过事务不变量校验的已应用读回。';
    }
    if (operation.before?.documentId !== input.request.expectedDocumentId
        || operation.before.historyStateId !== input.request.expectedHistoryStateId
        || operation.after?.documentId !== input.request.expectedDocumentId
        || operation.after.historyStateId === input.request.expectedHistoryStateId) {
        return 'Photoshop 事务版本没有与请求的文档和历史状态形成可信绑定。';
    }

    const sourceLayerId = Number(data.sourceLayerId);
    const outputLayerId = Number(data.outputLayerId);
    const receiptDocumentId = Number(receipt.documentId);
    const receiptSourceLayerId = Number(receipt.sourceLayerId);
    const receiptOutputLayerId = Number(receipt.outputLayerId);
    if (receipt.version !== SKU_POSE_ALIGNMENT_PROVIDER_RECEIPT_VERSION
        || !Number.isSafeInteger(outputLayerId)
        || outputLayerId <= 0
        || outputLayerId === input.request.layerId
        || sourceLayerId !== input.request.layerId
        || receiptDocumentId !== input.request.expectedDocumentId
        || receiptSourceLayerId !== input.request.layerId
        || receiptOutputLayerId !== outputLayerId
        || receipt.sourcePreserved !== true
        || receipt.sourceVisibleAfter !== false
        || receipt.outputVisible !== true
        || receipt.geometryVerified !== true
        || receipt.sourceImageIdentityVerified !== true) {
        return 'Photoshop 姿态统一收据缺少可信的文档、图层或非破坏写入事实。';
    }
    if (!boundsMatch(readBounds(receipt.sourceBounds), input.sourceBounds)
        || !boundsMatch(readBounds(receipt.outputBounds), input.outputBounds)) {
        return 'Photoshop 姿态统一收据中的源图层或输出图层几何与快照不一致。';
    }
    if (receipt.qualityReportVersion !== input.qualityReportVersion
        || receipt.qualityProfile !== input.qualityProfile
        || receipt.qualityFingerprint !== input.qualityFingerprint) {
        return 'Photoshop 姿态统一收据没有绑定本轮离线质量报告。';
    }
    return undefined;
}

export async function executeSkuPoseAlignmentProvider(
    rawRequest: unknown,
    dependencies: SkuPoseAlignmentProviderDependencies
): Promise<SkuPoseAlignmentProviderResult> {
    const request = normalizeSkuPoseAlignmentWorkflowRequest(rawRequest);
    throwIfAborted(request.abortSignal, '读取图层前');
    const captured = normalizeCaptureResult(
        await dependencies.captureLayer({
            expectedDocumentId: request.expectedDocumentId,
            expectedHistoryStateId: request.expectedHistoryStateId,
            layerId: request.layerId,
            requestKey: request.requestKey
        }),
        request
    );
    throwIfAborted(request.abortSignal, '图层快照后');

    const capturedPixels = captured.width * captured.height;
    const alpha = extractAlpha(captured.rgba, capturedPixels);
    const sourceMask = await resolveForegroundMask({ captured, alpha, dependencies });
    throwIfAborted(request.abortSignal, '主体解析后');
    const prepared = buildPreparedPoseCanvas({
        captured,
        sourceRgb: extractRgb(captured.rgba, capturedPixels),
        sourceMask
    });

    const outcome = alignSkuRetouchPose({
        raster: {
            data: prepared.rgb,
            width: prepared.width,
            height: prepared.height,
            channels: 3
        },
        mask: prepared.mask,
        options: request.options
    });
    if (outcome.report.status === 'not_needed') {
        return {
            success: true,
            status: 'not_needed',
            noMutation: true,
            report: outcome.report
        };
    }
    if (outcome.report.status !== 'applied') {
        return {
            success: false,
            status: 'rejected',
            noMutation: true,
            code: outcome.report.reasonCode || 'sku_pose_alignment_rejected',
            error: outcome.report.reason || '姿态候选未通过机械质量检查。',
            report: outcome.report
        };
    }
    throwIfAborted(request.abortSignal, 'Photoshop 写入前');

    const outputRgba = buildOutputRgba({
        rgb: outcome.raster.data,
        mask: outcome.mask,
        pixels: prepared.width * prepared.height
    });
    const outputPng = await sharp(outputRgba, {
        raw: { width: prepared.width, height: prepared.height, channels: 4 }
    }).png({ compressionLevel: 7 }).toBuffer();
    if (outputPng.length > MAX_RESULT_PNG_BYTES) {
        throw new Error(`SKU 姿态统一 PNG 结果 ${(outputPng.length / 1024 / 1024).toFixed(1)}MB 超出单次 Provider 传输上限。`);
    }
    const qualityFingerprint = fnv1a32(JSON.stringify({
        report: outcome.report,
        sourceBounds: captured.contentBounds,
        outputBounds: prepared.outputBounds,
        workingPadding: prepared.padding
    }));
    const applyRequest: SkuPoseAlignmentApplyRequest = {
        version: SKU_POSE_ALIGNMENT_APPLY_VERSION,
        layerId: request.layerId,
        resultLayerName: request.resultLayerName,
        sourceBounds: captured.contentBounds,
        outputBounds: prepared.outputBounds,
        sourceImageSize: { width: captured.width, height: captured.height },
        outputImageSize: { width: prepared.width, height: prepared.height },
        workingPadding: prepared.padding,
        imageBase64: outputPng.toString('base64'),
        imageByteLength: outputPng.length,
        imageChecksum: fnv1a32(outputPng),
        qualityReportVersion: outcome.report.version,
        qualityProfile: outcome.report.qualityProfile,
        qualityFingerprint
    };
    const providerResult = await dependencies.applyResult(applyRequest, {
        expectedDocumentId: request.expectedDocumentId,
        expectedHistoryStateId: request.expectedHistoryStateId,
        requestKey: request.requestKey
    });
    const providerRecord = asRecord(providerResult);
    if (providerRecord.success !== true) {
        const applicationStatus = readOperationApplicationStatus(providerResult);
        return {
            success: false,
            status: 'failed',
            noMutation: applicationStatus === 'not_applied',
            code: String(providerRecord.code || 'sku_pose_alignment_apply_failed'),
            error: String(providerRecord.error || 'Photoshop 姿态结果写入失败。'),
            report: outcome.report,
            providerResult
        };
    }
    const providerValidationError = validateAppliedProviderResult({
        value: providerResult,
        request,
        sourceBounds: captured.contentBounds,
        outputBounds: prepared.outputBounds,
        qualityReportVersion: outcome.report.version,
        qualityProfile: outcome.report.qualityProfile,
        qualityFingerprint
    });
    if (providerValidationError) {
        const applicationStatus = readOperationApplicationStatus(providerResult);
        return {
            success: false,
            status: 'failed',
            noMutation: applicationStatus === 'not_applied',
            code: 'sku_pose_alignment_receipt_unverified',
            error: providerValidationError,
            report: outcome.report,
            providerResult
        };
    }
    return {
        success: true,
        status: 'applied',
        noMutation: false,
        report: outcome.report,
        providerResult
    };
}
