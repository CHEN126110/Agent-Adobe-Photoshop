/**
 * Detail page bulk filler.
 * Fills copy and images into a parsed detail-page template.
 */

import { app, action, core } from 'photoshop';
import { readUserMaskEnabled } from '../layer/blur-and-mask';
import { GetClippingMaskInfoTool } from '../layer/clipping-mask-info';
import { GetSmartObjectInfoTool } from '../layer/smart-object-tools';
import { SetTextContentTool } from '../text/set-text-content';
import { getBounds } from './layer-utils';
import {
    arrayBufferFromBytes,
    assertImageBytesSafeForPhotoshop,
    bytesFromBase64ImagePayload,
    readFileEntryBytes
} from '../../core/image-safety';
import { getPhotoshopElementPlacement } from './photoshop-runtime-adapters';

const uxp = require('uxp');
const fs = uxp.storage.localFileSystem;
const { constants } = require('photoshop');

type FillMode = 'cover' | 'contain' | 'smart' | 'aesthetic';
type AssetType = 'product' | 'model' | 'detail' | 'scene' | 'icon';
type ContentSource = 'knowledge' | 'ai_generated' | 'user_input' | 'template';
type ScreenType = string;

interface FillPlan {
    screenId: number;
    screenName: string;
    screenType: ScreenType;
    copies: CopyFillItem[];
    images: ImageFillItem[];
    icons?: IconFillItem[];
    confidence: number;
    needsReview: boolean;
}

interface CopyFillItem {
    layerId: number;
    layerName: string;
    content: string;
    source: ContentSource;
    sourceId?: string;
    originalText?: string;
}

interface ImageFillItem {
    layerId: number;
    layerName: string;
    imagePath?: string;
    imageData?: string;
    imageFormat?: 'png' | 'jpeg' | 'webp';
    fillMode: FillMode;
    assetType: AssetType;
    needsMatting?: boolean;
    executionDeferred?: boolean;
    assetCandidates?: Array<{
        candidateSetId: string;
        candidateId: string;
        imagePath: string;
    }>;
    selectionReceipt?: {
        version: 'detail-asset-selection-receipt/v0';
        screenId: number;
        placeholderLayerId: number;
        candidateSetId: string;
        candidateId: string;
        selectedAssetPath: string;
        selectedBy: 'agent' | 'user';
        decisionId: string;
    };
    subjectAlign?: 'center' | 'left' | 'right' | 'top' | 'bottom';
    isClippingMask?: boolean;
    baseLayerId?: number;
    referenceLayerId?: number;
    targetBounds?: Rect & { width?: number; height?: number };
    zone?: 'copy' | 'icon' | 'image' | 'unknown';
    placementTransform?: {
        destinationBox?: PlacementBox;
        visibleBox?: PlacementBox;
        scale?: number;
        scaleX?: number;
        scaleY?: number;
        anchor?: string;
        scaleMode?: string;
        cropRisk?: boolean;
        notes?: string[];
    };
    smartScalingDecision?: {
        destinationBox?: PlacementBox;
        cropRisk?: string;
        confidence?: number;
        warnings?: string[];
    };
    sourceTreatment?: ImagePlacementSourceTreatment;
    container?: ImagePlacementContainer;
    expectedRelation?: ImagePlacementExpectedRelation;
}

interface ImagePlacementMattingReceipt {
    /** Untrusted plan metadata only. Never use as Photoshop execution evidence. */
    status?: 'applied' | 'verified' | 'failed';
    receiptId?: string;
    outputLayerId?: number;
    outputAssetId?: string;
    outputChecksum?: string;
    hasLayerMask?: boolean;
    verified?: boolean;
}

interface ImagePlacementSourceTreatment {
    backgroundTreatment?: 'preserve' | 'matte_to_mask' | 'full_frame';
    mattingReceipt?: ImagePlacementMattingReceipt;
}

interface ImagePlacementContainer {
    mode: 'free' | 'clip_to_base' | 'replace_placeholder';
    placeholderLayerId?: number;
    baseLayerId?: number;
    parentGroupId?: number;
}

interface ImagePlacementExpectedRelation {
    clipped?: boolean;
    clippingBaseId?: number;
    parentGroupId?: number;
    smartObject?: boolean;
    mattingApplied?: boolean;
    containedByTarget?: boolean;
}

interface ImagePlacementActualRelation {
    clipped?: boolean | null;
    clippingBaseId?: number | null;
    parentGroupId?: number | null;
    smartObject?: boolean | null;
    mattingApplied?: boolean | null;
    containedByTarget?: boolean | null;
}

type DeferredImageReasonCode =
    | 'asset_selection_required'
    | 'plan_marked_deferred'
    | 'matting_required'
    | 'clip_base_missing'
    | 'clip_base_not_found';

interface DeferredImageRecord {
    layerId: number;
    layerName: string;
    reasonCode: DeferredImageReasonCode;
    reason: string;
    recoverable: true;
    requiredAction: string;
}

interface ImagePlacementRelationVerification {
    status: 'passed' | 'needs_review' | 'failed';
    expected: ImagePlacementExpectedRelation;
    actual: ImagePlacementActualRelation;
    passedChecks: string[];
    warnings: string[];
    blockers: string[];
}

interface IconFillItem {
    layerId: number;
    layerName: string;
    iconPath?: string;
    iconContent?: string;
}

interface FillResult {
    success: boolean;
    screenId: number;
    screenName: string;
    copiesFilled: number;
    imagesFilled: number;
    placements: ImagePlacementRecord[];
    placementAuditSummary: PlacementAuditSummary;
    errors: string[];
    warnings: string[];
    needsReview: boolean;
    deferredImages: DeferredImageRecord[];
    requestedImageCount: number;
    executableImageCount: number;
    executionDeferred: boolean;
}

interface ImagePlacementRecord {
    screenId: number;
    screenName: string;
    placeholderLayerId: number;
    placeholderLayerName: string;
    actualLayerId: number;
    actualLayerName: string;
    targetBounds: Rect & { width: number; height: number };
    actualBounds: Rect & { width: number; height: number };
    baseLayerId?: number;
    referenceLayerId?: number;
    parentGroupName?: string;
    parentGroupId?: number | null;
    clippingBaseId?: number | null;
    isClipped?: boolean;
    isSmartObject?: boolean | null;
    expectedRelation?: ImagePlacementExpectedRelation;
    actualRelation: ImagePlacementActualRelation;
    relationVerification?: ImagePlacementRelationVerification;
    fillMode: FillMode;
    subjectAlign?: 'center' | 'left' | 'right' | 'top' | 'bottom';
    placementAudit?: PlacementAudit;
}

interface PlacementAudit {
    strategy: 'placementTransform' | 'smartScalingDecision' | 'fitFallback';
    plannedBounds?: Rect & { width: number; height: number };
    deviation?: {
        left: number;
        top: number;
        width: number;
        height: number;
        maxAbs: number;
    };
    status: 'ok' | 'watch' | 'mismatch' | 'unverified';
    smartScaling?: {
        plannedBounds?: Rect & { width: number; height: number };
        confidence?: number;
        cropRisk?: string;
        warnings?: string[];
    };
    notes: string[];
}

interface PlacementAuditSummary {
    total: number;
    ok: number;
    watch: number;
    mismatch: number;
    unverified: number;
    usedPlacementTransform: number;
    usedSmartScalingDecision: number;
    usedFallback: number;
}

// Rect type kept for local usage (subset of BoundingBox)
interface Rect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

interface PlacementBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

function layerRect(layer: any): Rect {
    const b = getBounds(layer);
    return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
}

function normalizeRect(rect: any): Rect | null {
    if (!rect) return null;
    const left = Number(rect.left);
    const top = Number(rect.top);
    const right = Number(rect.right);
    const bottom = Number(rect.bottom);
    if (![left, top, right, bottom].every((value) => Number.isFinite(value))) {
        return null;
    }
    if (right <= left || bottom <= top) {
        return null;
    }
    return { left, top, right, bottom };
}

function normalizePlacementBox(box: any): PlacementBox | null {
    if (!box) return null;
    const x = Number(box.x);
    const y = Number(box.y);
    const width = Number(box.width);
    const height = Number(box.height);
    if (![x, y, width, height].every((value) => Number.isFinite(value))) {
        return null;
    }
    if (width <= 0 || height <= 0) {
        return null;
    }
    return { x, y, width, height };
}

function placementBoxToRect(box: PlacementBox): Rect {
    return {
        left: box.x,
        top: box.y,
        right: box.x + box.width,
        bottom: box.y + box.height
    };
}

function rectContains(outer: Rect, inner: Rect, tolerance = 2): boolean {
    return inner.left >= outer.left - tolerance
        && inner.top >= outer.top - tolerance
        && inner.right <= outer.right + tolerance
        && inner.bottom <= outer.bottom + tolerance;
}

function rectWithSize(rect: Rect): Rect & { width: number; height: number } {
    return {
        ...rect,
        width: Math.max(1, rect.right - rect.left),
        height: Math.max(1, rect.bottom - rect.top)
    };
}

function basename(filePath: string): string {
    return String(filePath || '').split(/[\\/]/).pop() || String(filePath || '');
}

function extensionFromPath(filePath: string): string {
    const match = String(filePath || '').match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : '';
}

function positiveLayerId(value: unknown): number | undefined {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
    return numeric;
}

function mergeExpectedRelation(
    base: ImagePlacementExpectedRelation,
    override: ImagePlacementExpectedRelation | undefined
): ImagePlacementExpectedRelation | undefined {
    const merged = {
        ...base,
        ...(override || {})
    };
    return Object.keys(merged).length > 0 ? merged : undefined;
}

function resolveExpectedRelation(item: ImageFillItem): ImagePlacementExpectedRelation | undefined {
    const derived: ImagePlacementExpectedRelation = {};
    if (item.container?.mode === 'clip_to_base') {
        derived.clipped = true;
        const baseLayerId = positiveLayerId(item.container.baseLayerId);
        if (baseLayerId !== undefined) derived.clippingBaseId = baseLayerId;
    } else if (item.container?.mode === 'replace_placeholder') {
        derived.clipped = false;
        derived.containedByTarget = true;
    } else if (item.container?.mode === 'free') {
        derived.clipped = false;
    }
    const parentGroupId = positiveLayerId(item.container?.parentGroupId);
    if (parentGroupId !== undefined) derived.parentGroupId = parentGroupId;
    if (
        item.needsMatting === true
        || item.sourceTreatment?.backgroundTreatment === 'matte_to_mask'
    ) {
        derived.mattingApplied = true;
    }
    return mergeExpectedRelation(derived, item.expectedRelation);
}

function relationValueIsKnown(value: unknown): boolean {
    return value !== undefined;
}

function compareRelationField(input: {
    field: keyof ImagePlacementExpectedRelation;
    label: string;
    expected: ImagePlacementExpectedRelation;
    actual: ImagePlacementActualRelation;
    passedChecks: string[];
    warnings: string[];
    blockers: string[];
}): void {
    const expectedValue = input.expected[input.field];
    if (expectedValue === undefined) return;
    const actualValue = input.actual[input.field];
    if (!relationValueIsKnown(actualValue)) {
        input.warnings.push(`缺少写后${input.label}读回，无法验证预期 ${String(expectedValue)}`);
        return;
    }
    if (actualValue !== expectedValue) {
        input.blockers.push(`写后${input.label}为 ${String(actualValue)}，与明确预期 ${String(expectedValue)} 不一致`);
        return;
    }
    input.passedChecks.push(`${input.field} matches expected relation`);
}

function verifyPlacementRelation(
    expected: ImagePlacementExpectedRelation | undefined,
    actual: ImagePlacementActualRelation
): ImagePlacementRelationVerification | undefined {
    if (!expected) return undefined;
    const passedChecks: string[] = [];
    const warnings: string[] = [];
    const blockers: string[] = [];
    const fields: Array<{ field: keyof ImagePlacementExpectedRelation; label: string }> = [
        { field: 'clipped', label: '剪切状态' },
        { field: 'clippingBaseId', label: '剪切基底图层 ID' },
        { field: 'parentGroupId', label: '父组图层 ID' },
        { field: 'smartObject', label: '智能对象状态' },
        { field: 'mattingApplied', label: '抠图/蒙版处理状态' },
        { field: 'containedByTarget', label: '目标容器边界包含状态' }
    ];
    for (const relationField of fields) {
        compareRelationField({
            ...relationField,
            expected,
            actual,
            passedChecks,
            warnings,
            blockers
        });
    }

    let status: ImagePlacementRelationVerification['status'] = 'passed';
    if (blockers.length > 0) status = 'failed';
    else if (warnings.length > 0) status = 'needs_review';
    return { status, expected, actual, passedChecks, warnings, blockers };
}

function buildRectDeviation(planned: Rect, actual: Rect): PlacementAudit['deviation'] {
    const plannedSized = rectWithSize(planned);
    const actualSized = rectWithSize(actual);
    const deviation = {
        left: actual.left - planned.left,
        top: actual.top - planned.top,
        width: actualSized.width - plannedSized.width,
        height: actualSized.height - plannedSized.height,
        maxAbs: 0
    };
    deviation.maxAbs = Math.max(
        Math.abs(deviation.left),
        Math.abs(deviation.top),
        Math.abs(deviation.width),
        Math.abs(deviation.height)
    );
    return deviation;
}

function statusFromRectDeviation(maxAbs: number): PlacementAudit['status'] {
    if (maxAbs <= 2) return 'ok';
    if (maxAbs <= 8) return 'watch';
    return 'mismatch';
}

function buildPlacementAudit(input: {
    strategy: PlacementAudit['strategy'];
    plannedRect?: Rect | null;
    actualRect: Rect;
    smartScalingDecision?: ImageFillItem['smartScalingDecision'];
}): PlacementAudit {
    const notes: string[] = [];
    const plannedBounds = input.plannedRect ? rectWithSize(input.plannedRect) : undefined;
    const deviation = input.plannedRect ? buildRectDeviation(input.plannedRect, input.actualRect) : undefined;
    let status: PlacementAudit['status'] = 'unverified';

    if (deviation) {
        status = statusFromRectDeviation(deviation.maxAbs);
        if (status !== 'ok') {
            notes.push(`actual bounds deviate from planned bounds by ${deviation.maxAbs.toFixed(1)}px`);
        }
    } else {
        notes.push('no planned destination bounds available for post-transform verification');
    }

    const smartDestination = normalizePlacementBox(input.smartScalingDecision?.destinationBox);
    const smartPlannedBounds = smartDestination ? rectWithSize(placementBoxToRect(smartDestination)) : undefined;
    if (input.smartScalingDecision?.warnings?.length) {
        notes.push(...input.smartScalingDecision.warnings);
    }

    return {
        strategy: input.strategy,
        plannedBounds,
        deviation,
        status,
        smartScaling: input.smartScalingDecision
            ? {
                plannedBounds: smartPlannedBounds,
                confidence: Number(input.smartScalingDecision.confidence || 0) || undefined,
                cropRisk: input.smartScalingDecision.cropRisk,
                warnings: input.smartScalingDecision.warnings || []
            }
            : undefined,
        notes
    };
}

function summarizePlacementAudits(placements: ImagePlacementRecord[]): PlacementAuditSummary {
    const summary: PlacementAuditSummary = {
        total: placements.length,
        ok: 0,
        watch: 0,
        mismatch: 0,
        unverified: 0,
        usedPlacementTransform: 0,
        usedSmartScalingDecision: 0,
        usedFallback: 0
    };

    for (const placement of placements) {
        const audit = placement.placementAudit;
        if (!audit) {
            summary.unverified++;
            continue;
        }
        summary[audit.status]++;
        if (audit.strategy === 'placementTransform') summary.usedPlacementTransform++;
        else if (audit.strategy === 'smartScalingDecision') summary.usedSmartScalingDecision++;
        else summary.usedFallback++;
    }

    return summary;
}

export class DetailPageFiller {
    async fill(plan: FillPlan): Promise<FillResult> {
        const errors: string[] = [];
        const warnings: string[] = [];
        const deferredImages: DeferredImageRecord[] = [];
        const placements: ImagePlacementRecord[] = [];
        let copiesFilled = 0;
        let imagesFilled = 0;
        let executableImageCount = 0;

        console.log(`[DetailPageFiller] Start screen: ${plan.screenName}`);

        for (const copy of plan.copies || []) {
            try {
                await this.fillCopy(copy);
                copiesFilled++;
                console.log(`[DetailPageFiller] Copy filled: ${copy.layerName}`);
            } catch (e: any) {
                const message = e?.message || String(e);
                errors.push(`copy failed [${copy.layerName}]: ${message}`);
                console.error(`[DetailPageFiller] Copy failed: ${copy.layerName}`, e);
            }
        }

        for (const image of plan.images || []) {
            const imageDeferral = this.resolveImageDeferral(image, plan.screenId);
            if (imageDeferral) {
                deferredImages.push(imageDeferral);
                warnings.push(`图片已延后 [${image.layerName}]: ${imageDeferral.reason}`);
                continue;
            }
            if (!image.imagePath && !image.imageData) {
                continue;
            }
            executableImageCount++;
            try {
                const placement = await this.fillImage(image, plan.screenId, plan.screenName);
                if (placement) {
                    placements.push(placement);
                    const relationVerification = placement.relationVerification;
                    if (relationVerification?.status === 'failed') {
                        errors.push(
                            `图片关系校验失败 [${image.layerName}]: ${relationVerification.blockers.join('; ')}`
                        );
                    } else if (relationVerification?.status === 'needs_review') {
                        warnings.push(
                            `图片关系待复核 [${image.layerName}]: ${relationVerification.warnings.join('; ')}`
                        );
                    }
                }
                imagesFilled++;
                console.log(`[DetailPageFiller] Image filled: ${image.layerName}`);
            } catch (e: any) {
                const message = e?.message || String(e);
                errors.push(`image failed [${image.layerName}]: ${message}`);
                console.error(`[DetailPageFiller] Image failed: ${image.layerName}`, e);
            }
        }

        for (const icon of plan.icons || []) {
            try {
                await this.fillIcon(icon);
            } catch (e: any) {
                const message = e?.message || String(e);
                errors.push(`icon failed [${icon.layerName}]: ${message}`);
            }
        }

        return {
            success: errors.length === 0,
            screenId: plan.screenId,
            screenName: plan.screenName,
            copiesFilled,
            imagesFilled,
            placements,
            placementAuditSummary: summarizePlacementAudits(placements),
            errors,
            warnings,
            needsReview: plan.needsReview === true || warnings.length > 0 || deferredImages.length > 0,
            deferredImages,
            requestedImageCount: (plan.images || []).length,
            executableImageCount,
            executionDeferred: deferredImages.length > 0
        };
    }

    async fillAll(plans: FillPlan[]): Promise<FillResult[]> {
        const results: FillResult[] = [];
        for (const plan of plans || []) {
            results.push(await this.fill(plan));
        }
        return results;
    }

    private resolveImageDeferral(item: ImageFillItem, screenId: number): DeferredImageRecord | null {
        const record = (
            reasonCode: DeferredImageReasonCode,
            reason: string,
            requiredAction: string
        ): DeferredImageRecord => ({
            layerId: Number(item.layerId || 0),
            layerName: String(item.layerName || ''),
            reasonCode,
            reason,
            recoverable: true,
            requiredAction
        });
        if ((item.imagePath || item.imageData) && !this.hasValidAssetSelectionReceipt(item, screenId)) {
            return record(
                'asset_selection_required',
                '图片仍是候选态，缺少与当前屏、占位和候选集绑定的 Agent / 用户选择收据。',
                '由主 Agent 查看候选画面并提交当前 candidateSetId / candidateId 的明确选择后，仅重试该图片。'
            );
        }
        if (
            item.needsMatting === true
            || item.sourceTreatment?.backgroundTreatment === 'matte_to_mask'
            || item.expectedRelation?.mattingApplied === true
        ) {
            return record(
                'matting_required',
                '该素材需要真实抠图/蒙版处理；FillPlan 内联 receipt 不可信，当前没有与本次置入绑定的 Photoshop userMaskEnabled 事实。',
                '先完成可验证的抠图结果应用，或改选可直接使用的透明/场景素材后重试该图片。'
            );
        }
        if (item.executionDeferred === true) {
            return record(
                'plan_marked_deferred',
                '计划已明确标记该图片当前不可自动执行。',
                '补齐素材处理或人工确认后，仅重试该图片。'
            );
        }
        if (item.container?.mode !== 'clip_to_base') return null;
        const clippingBaseId = positiveLayerId(item.expectedRelation?.clippingBaseId)
            || positiveLayerId(item.container.baseLayerId);
        if (clippingBaseId === undefined) {
            return record(
                'clip_base_missing',
                'clip_to_base 没有明确 baseLayerId，不能把 replace_placeholder 冒充为已剪切。',
                '补齐真实剪切基底图层 ID，或把容器策略明确改为 replace_placeholder。'
            );
        }
        const doc = app.activeDocument;
        const clippingBase = doc ? this.findLayerById(doc.layers, clippingBaseId) : null;
        if (!clippingBase) {
            return record(
                'clip_base_not_found',
                `Photoshop 中找不到预期剪切基底图层 ${clippingBaseId}。`,
                '重新读取图层层级并更新 baseLayerId 后，仅重试该图片。'
            );
        }
        return null;
    }

    private hasValidAssetSelectionReceipt(item: ImageFillItem, screenId: number): boolean {
        const receipt = item.selectionReceipt;
        if (!receipt || receipt.version !== 'detail-asset-selection-receipt/v0') return false;
        if (Number(receipt.screenId || 0) !== Number(screenId || 0)) return false;
        if (Number(receipt.placeholderLayerId || 0) !== Number(item.layerId || 0)) return false;
        if (!String(receipt.decisionId || '').trim()
            || !String(receipt.candidateSetId || '').trim()
            || !String(receipt.candidateId || '').trim()) {
            return false;
        }
        const normalizePath = (value: unknown): string => {
            const normalized = String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
            return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
        };
        if (item.imagePath
            && normalizePath(receipt.selectedAssetPath) !== normalizePath(item.imagePath)) {
            return false;
        }
        return (item.assetCandidates || []).some((candidate) => (
            candidate.candidateSetId === receipt.candidateSetId
            && candidate.candidateId === receipt.candidateId
            && normalizePath(candidate.imagePath) === normalizePath(receipt.selectedAssetPath)
        ));
    }

    private async fillCopy(item: CopyFillItem): Promise<void> {
        // Use setTextContent tool to preserve text style and avoid style reset.
        const setTextTool = new SetTextContentTool();
        const result = await setTextTool.execute({
            layerId: item.layerId,
            content: String(item.content || '')
        });
        if (!result?.success) {
            throw new Error(result?.error || `copy fill failed: ${item.layerName}`);
        }
    }

    private async fillImage(
        item: ImageFillItem,
        screenId: number,
        screenName: string
    ): Promise<ImagePlacementRecord> {
        const expectedRelation = resolveExpectedRelation(item);
        const placementRecord: ImagePlacementRecord = await core.executeAsModal(async () => {
            const doc = app.activeDocument;
            if (!doc) throw new Error('No active document');

            const placeholderLayerId = positiveLayerId(item.container?.placeholderLayerId) || item.layerId;
            const placeholderLayer = this.findLayerById(doc.layers, placeholderLayerId);
            if (!placeholderLayer) {
                throw new Error(`Target layer not found: ${placeholderLayerId}`);
            }

            const explicitClippingBaseId = positiveLayerId(expectedRelation?.clippingBaseId)
                || positiveLayerId(item.container?.baseLayerId);
            if (item.container?.mode === 'clip_to_base' && explicitClippingBaseId === undefined) {
                throw new Error('显式 clip_to_base 容器缺少有效 baseLayerId。');
            }
            const resolvedClippingBaseId = explicitClippingBaseId || positiveLayerId(item.baseLayerId);
            const clippingBaseLayer = resolvedClippingBaseId
                ? this.findLayerById(doc.layers, resolvedClippingBaseId)
                : null;
            if (explicitClippingBaseId !== undefined && !clippingBaseLayer) {
                throw new Error(`找不到明确预期的剪切基底图层：${explicitClippingBaseId}`);
            }
            const referenceLayer = item.referenceLayerId
                ? this.findLayerById(doc.layers, item.referenceLayerId)
                : null;
            const targetLayer = clippingBaseLayer || placeholderLayer;
            const stackAnchorLayer = clippingBaseLayer || referenceLayer || placeholderLayer;
            const targetRect = normalizeRect(item.targetBounds) || layerRect(targetLayer);
            const targetWidth = Math.max(1, targetRect.right - targetRect.left);
            const targetHeight = Math.max(1, targetRect.bottom - targetRect.top);
            const targetCenterX = targetRect.left + (targetWidth / 2);
            const targetCenterY = targetRect.top + (targetHeight / 2);

            let token = '';
            let temporaryFile: any;
            if (item.imageData) {
                const decoded = bytesFromBase64ImagePayload(item.imageData);
                const extension = item.imageFormat || 'png';
                assertImageBytesSafeForPhotoshop(decoded.bytes, {
                    formatHint: extension || decoded.mimeType,
                    sourceLabel: `详情页附件图片「${item.layerName}」`
                });
                const tempFolder = await fs.getTemporaryFolder();
                temporaryFile = await tempFolder.createFile(
                    `detail_fill_${Date.now()}_${item.layerId}.${extension}`,
                    { overwrite: true }
                );
                await temporaryFile.write(arrayBufferFromBytes(decoded.bytes), {
                    format: uxp.storage.formats.binary
                });
                token = await fs.createSessionToken(temporaryFile);
            } else {
                const imagePath = String(item.imagePath || '');
                const fileEntry = await fs.getEntryWithUrl('file:' + imagePath);
                if (!fileEntry) {
                    throw new Error(`Cannot access file: ${imagePath}`);
                }
                const imageBytes = await readFileEntryBytes(fileEntry, uxp.storage);
                assertImageBytesSafeForPhotoshop(imageBytes, {
                    formatHint: extensionFromPath(imagePath),
                    sourceLabel: `详情页图片「${basename(imagePath)}」`
                });
                token = await fs.createSessionToken(fileEntry);
            }

            try {
                await action.batchPlay([{
                    _obj: 'placeEvent',
                    null: { _path: token, _kind: 'local' },
                    freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
                    offset: {
                        _obj: 'offset',
                        horizontal: { _unit: 'pixelsUnit', _value: targetCenterX },
                        vertical: { _unit: 'pixelsUnit', _value: targetCenterY }
                    },
                    _options: { dialogOptions: 'dontDisplay' }
                }], { synchronousExecution: true });
            } finally {
                if (temporaryFile) {
                    try {
                        await temporaryFile.delete();
                    } catch {
                        // 临时附件已不再参与后续 Photoshop 操作，清理失败不覆盖主结果。
                    }
                }
            }

            const placedLayer = doc.activeLayers?.[0];
            if (!placedLayer) {
                throw new Error('Placed layer missing');
            }

            try {
                placedLayer.name = item.layerName || placedLayer.name;
            } catch {
                // Ignore rename failures.
            }

            await this.moveLayerAbove(placedLayer, stackAnchorLayer);
            const legacyShouldClip = !!clippingBaseLayer
                || !!item.isClippingMask
                || !!placeholderLayer.clipped;
            const shouldClip = expectedRelation?.clipped !== undefined
                ? expectedRelation.clipped
                : legacyShouldClip;
            const transformDestination = normalizePlacementBox(item.placementTransform?.destinationBox);
            const transformVisible = normalizePlacementBox(item.placementTransform?.visibleBox);
            const smartScalingDestination = normalizePlacementBox(item.smartScalingDecision?.destinationBox);
            const transformDestinationRect = transformDestination ? placementBoxToRect(transformDestination) : null;
            const transformVisibleRect = transformVisible ? placementBoxToRect(transformVisible) : null;
            const smartScalingDestinationRect = smartScalingDestination ? placementBoxToRect(smartScalingDestination) : null;
            const canUseTransformDestination = !!transformDestinationRect
                && (shouldClip || rectContains(targetRect, transformDestinationRect));
            const canUseSmartScalingDestination = !canUseTransformDestination
                && !!smartScalingDestinationRect
                && (shouldClip || rectContains(targetRect, smartScalingDestinationRect));
            const destinationRect = canUseTransformDestination
                ? transformDestinationRect
                : canUseSmartScalingDestination
                    ? smartScalingDestinationRect
                    : null;
            const placementStrategy: PlacementAudit['strategy'] = canUseTransformDestination
                ? 'placementTransform'
                : canUseSmartScalingDestination
                    ? 'smartScalingDecision'
                    : 'fitFallback';
            const effectiveFillMode: FillMode = item.container?.mode === 'replace_placeholder'
                ? 'contain'
                : item.fillMode || 'cover';

            if (destinationRect) {
                await this.scaleToRect(placedLayer, destinationRect);
            } else {
                await this.scaleToFit(placedLayer, targetWidth, targetHeight, effectiveFillMode);
                const alignRect = transformVisibleRect || targetRect;
                await this.positionPlacedLayer(placedLayer, alignRect, item.subjectAlign || 'center');
            }

            if (shouldClip) {
                await this.createClippingMask(placedLayer);
            }

            const placeholderActsAsClipBase = shouldClip && !clippingBaseLayer;
            if (!placeholderActsAsClipBase && (!clippingBaseLayer || placeholderLayer.id !== clippingBaseLayer.id)) {
                try {
                    await placeholderLayer.delete();
                } catch {
                    placeholderLayer.visible = false;
                }
            }

            let placedRect = layerRect(placedLayer);
            const auditPlannedRect = destinationRect
                ? destinationRect
                : transformVisibleRect || targetRect;

            // 放置后回正护栏：替换/缩放在个别智能对象上会让图层落到远离目标的位置
            // （实测：素材被丢到画布外 9000+px，撑爆所在屏分组的边界）。
            // 中心偏差超阈值时按计划位置平移回正，再重新读取实际边界供审计使用。
            if (auditPlannedRect) {
                const plannedCenterX = (auditPlannedRect.left + auditPlannedRect.right) / 2;
                const plannedCenterY = (auditPlannedRect.top + auditPlannedRect.bottom) / 2;
                const actualCenterX = (placedRect.left + placedRect.right) / 2;
                const actualCenterY = (placedRect.top + placedRect.bottom) / 2;
                const centerDrift = Math.max(
                    Math.abs(actualCenterX - plannedCenterX),
                    Math.abs(actualCenterY - plannedCenterY)
                );
                if (centerDrift > 24) {
                    await this.translateLayer(
                        placedLayer,
                        plannedCenterX - actualCenterX,
                        plannedCenterY - actualCenterY
                    );
                    placedRect = layerRect(placedLayer);
                }
            }
            const parentGroupId = this.resolveParentGroupId(placedLayer, doc);
            return {
                screenId,
                screenName,
                placeholderLayerId,
                placeholderLayerName: item.layerName,
                actualLayerId: Number(placedLayer.id || 0),
                actualLayerName: String(placedLayer.name || item.layerName || 'Placed Image'),
                targetBounds: {
                    ...targetRect,
                    width: targetWidth,
                    height: targetHeight
                },
                actualBounds: {
                    ...placedRect,
                    width: Math.max(1, placedRect.right - placedRect.left),
                    height: Math.max(1, placedRect.bottom - placedRect.top)
                },
                baseLayerId: resolvedClippingBaseId,
                referenceLayerId: item.referenceLayerId,
                parentGroupName: String((placedLayer as any)?.parent?.name || ''),
                parentGroupId,
                expectedRelation,
                actualRelation: {
                    parentGroupId,
                    containedByTarget: rectContains(targetRect, placedRect)
                },
                fillMode: effectiveFillMode,
                subjectAlign: item.subjectAlign || 'center',
                placementAudit: buildPlacementAudit({
                    strategy: placementStrategy,
                    plannedRect: auditPlannedRect,
                    actualRect: placedRect,
                    smartScalingDecision: item.smartScalingDecision
                })
            };

        }, { commandName: `Fill image: ${item.layerName}` });

        const actualRelation = await this.readActualRelation(
            placementRecord.actualLayerId,
            placementRecord.actualRelation
        );
        const relationVerification = verifyPlacementRelation(expectedRelation, actualRelation);
        return {
            ...placementRecord,
            ...(typeof actualRelation.clipped === 'boolean' ? { isClipped: actualRelation.clipped } : {}),
            clippingBaseId: actualRelation.clippingBaseId,
            parentGroupId: actualRelation.parentGroupId,
            isSmartObject: actualRelation.smartObject,
            actualRelation,
            ...(relationVerification ? { relationVerification } : {})
        };
    }

    private resolveParentGroupId(layer: any, doc: any): number | null {
        const parent = layer?.parent;
        if (!parent || parent === doc || Number(parent.id || 0) === Number(doc?.id || 0)) return null;
        return positiveLayerId(parent.id) || null;
    }

    private async readActualRelation(
        layerId: number,
        seed: ImagePlacementActualRelation
    ): Promise<ImagePlacementActualRelation> {
        const actual: ImagePlacementActualRelation = { ...seed };
        const clippingTool = new GetClippingMaskInfoTool();
        const clippingResultText = await clippingTool.execute({ layerId });
        let clippingResult: any = null;
        try {
            clippingResult = JSON.parse(clippingResultText);
        } catch {
            clippingResult = null;
        }
        if (clippingResult?.success === true && clippingResult.clippingMaskInfo) {
            const clippingInfo = clippingResult.clippingMaskInfo;
            actual.clipped = clippingInfo.isClipped === true;
            actual.clippingBaseId = positiveLayerId(clippingInfo.clippingBaseId) || null;
        }

        const smartObjectTool = new GetSmartObjectInfoTool();
        const smartObjectResult = await smartObjectTool.execute({ layerId });
        if (smartObjectResult?.success === true) {
            actual.smartObject = smartObjectResult?.data?.isSmartObject === true;
        } else if (String(smartObjectResult?.error || '').toLowerCase().includes('not a smart object')) {
            actual.smartObject = false;
        }

        const doc = app.activeDocument;
        const layer = doc ? this.findLayerById(doc.layers, layerId) : null;
        if (layer) {
            actual.parentGroupId = this.resolveParentGroupId(layer, doc);
        }
        const userMaskEnabled = await readUserMaskEnabled(layerId);
        if (typeof userMaskEnabled === 'boolean') {
            actual.mattingApplied = userMaskEnabled;
        }
        return actual;
    }

    private async fillIcon(item: IconFillItem): Promise<void> {
        if (!item.iconPath && !item.iconContent) {
            throw new Error(`Icon layer [${item.layerName}]: no iconPath or iconContent provided`);
        }

        await core.executeAsModal(async () => {
            const doc = app.activeDocument;
            if (!doc) throw new Error('No active document');

            const targetLayer = this.findLayerById(doc.layers, item.layerId);
            if (!targetLayer) {
                throw new Error(`Icon layer not found: ${item.layerId}`);
            }

            if (!item.iconPath) {
                return;
            }

            const fileEntry = await fs.getEntryWithUrl('file:' + item.iconPath);
            if (!fileEntry) {
                throw new Error(`Cannot access icon file: ${item.iconPath}`);
            }
            const iconBytes = await readFileEntryBytes(fileEntry, uxp.storage);
            assertImageBytesSafeForPhotoshop(iconBytes, {
                formatHint: extensionFromPath(item.iconPath),
                sourceLabel: `详情页图标「${basename(item.iconPath)}」`
            });

            const token = await fs.createSessionToken(fileEntry);
            const rect = layerRect(targetLayer);

            await action.batchPlay([{
                _obj: 'placeEvent',
                null: { _path: token, _kind: 'local' },
                offset: {
                    _obj: 'offset',
                    horizontal: { _unit: 'pixelsUnit', _value: (rect.left + rect.right) / 2 },
                    vertical: { _unit: 'pixelsUnit', _value: (rect.top + rect.bottom) / 2 }
                },
                _options: { dialogOptions: 'dontDisplay' }
            }], { synchronousExecution: true });

            const placedLayer = doc.activeLayers?.[0];
            if (!placedLayer) {
                throw new Error(`Icon place failed: no placed layer after placeEvent`);
            }

            const targetSize = Math.max(1, Math.min(rect.right - rect.left, rect.bottom - rect.top));
            await this.scaleToSize(placedLayer, targetSize, targetSize);

            try {
                await targetLayer.delete();
            } catch {
                targetLayer.visible = false;
            }
        }, { commandName: `Fill icon: ${item.layerName}` });
    }

    private async scaleToFit(
        layer: any,
        targetWidth: number,
        targetHeight: number,
        mode: FillMode
    ): Promise<void> {
        const rect = layerRect(layer);
        const currentWidth = Math.max(1, rect.right - rect.left);
        const currentHeight = Math.max(1, rect.bottom - rect.top);

        let scale: number;
        const containScale = Math.min(targetWidth / currentWidth, targetHeight / currentHeight);
        const coverScale = Math.max(targetWidth / currentWidth, targetHeight / currentHeight);
        if (mode === 'contain') {
            scale = containScale;
        } else if (mode === 'aesthetic') {
            scale = containScale * 0.7;
        } else if (mode === 'smart') {
            const ratioGap = Math.abs((targetWidth / Math.max(1, targetHeight)) - (currentWidth / Math.max(1, currentHeight)));
            const blend = ratioGap > 0.9 ? 0.72 : 0.5;
            scale = containScale + ((coverScale - containScale) * blend);
        } else {
            scale = coverScale;
        }

        const scalePercent = Math.max(1, scale * 100);
        await action.batchPlay([{
            _obj: 'transform',
            _target: [{ _ref: 'layer', _id: layer.id }],
            freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
            width: { _unit: 'percentUnit', _value: scalePercent },
            height: { _unit: 'percentUnit', _value: scalePercent },
            interfaceIconFrameDimmed: { _enum: 'interpolationType', _value: 'bicubic' },
            _options: { dialogOptions: 'dontDisplay' }
        }], { synchronousExecution: true });
    }

    private async scaleToSize(layer: any, targetWidth: number, targetHeight: number): Promise<void> {
        const rect = layerRect(layer);
        const currentWidth = Math.max(1, rect.right - rect.left);
        const currentHeight = Math.max(1, rect.bottom - rect.top);
        const scaleX = (targetWidth / currentWidth) * 100;
        const scaleY = (targetHeight / currentHeight) * 100;
        const scale = Math.max(1, Math.min(scaleX, scaleY));

        await action.batchPlay([{
            _obj: 'transform',
            _target: [{ _ref: 'layer', _id: layer.id }],
            freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
            width: { _unit: 'percentUnit', _value: scale },
            height: { _unit: 'percentUnit', _value: scale },
            interfaceIconFrameDimmed: { _enum: 'interpolationType', _value: 'bicubic' },
            _options: { dialogOptions: 'dontDisplay' }
        }], { synchronousExecution: true });
    }

    private async scaleToRect(layer: any, targetRect: Rect): Promise<void> {
        const targetWidth = Math.max(1, targetRect.right - targetRect.left);
        const targetHeight = Math.max(1, targetRect.bottom - targetRect.top);
        const rect = layerRect(layer);
        const currentWidth = Math.max(1, rect.right - rect.left);
        const currentHeight = Math.max(1, rect.bottom - rect.top);
        const scaleX = (targetWidth / currentWidth) * 100;
        const scaleY = (targetHeight / currentHeight) * 100;

        await action.batchPlay([{
            _obj: 'transform',
            _target: [{ _ref: 'layer', _id: layer.id }],
            freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
            width: { _unit: 'percentUnit', _value: Math.max(1, scaleX) },
            height: { _unit: 'percentUnit', _value: Math.max(1, scaleY) },
            interfaceIconFrameDimmed: { _enum: 'interpolationType', _value: 'bicubic' },
            _options: { dialogOptions: 'dontDisplay' }
        }], { synchronousExecution: true });

        const scaledRect = layerRect(layer);
        const moveX = targetRect.left - scaledRect.left;
        const moveY = targetRect.top - scaledRect.top;
        if (Math.abs(moveX) < 0.5 && Math.abs(moveY) < 0.5) {
            return;
        }

        await this.translateLayer(layer, moveX, moveY);
    }

    private async positionPlacedLayer(layer: any, targetRect: Rect, align: 'center' | 'left' | 'right' | 'top' | 'bottom'): Promise<void> {
        const rect = layerRect(layer);
        const layerWidth = Math.max(1, rect.right - rect.left);
        const layerHeight = Math.max(1, rect.bottom - rect.top);
        const currentCenterX = (rect.left + rect.right) / 2;
        const currentCenterY = (rect.top + rect.bottom) / 2;

        let targetCenterX = (targetRect.left + targetRect.right) / 2;
        let targetCenterY = (targetRect.top + targetRect.bottom) / 2;

        if (align === 'left') {
            targetCenterX = targetRect.left + (layerWidth / 2);
        } else if (align === 'right') {
            targetCenterX = targetRect.right - (layerWidth / 2);
        } else if (align === 'top') {
            targetCenterY = targetRect.top + (layerHeight / 2);
        } else if (align === 'bottom') {
            targetCenterY = targetRect.bottom - (layerHeight / 2);
        }

        const moveX = targetCenterX - currentCenterX;
        const moveY = targetCenterY - currentCenterY;
        if (Math.abs(moveX) < 0.5 && Math.abs(moveY) < 0.5) {
            return;
        }

        await this.translateLayer(layer, moveX, moveY);
    }

    private async translateLayer(layer: any, offsetX: number, offsetY: number): Promise<void> {
        if (typeof layer?.translate !== 'function') {
            throw new Error(`DetailPageFiller failed: layer ${layer?.id ?? 'unknown'} does not support DOM translate; native offset move is blocked to avoid Photoshop popups.`);
        }
        await Promise.resolve(layer.translate(offsetX, offsetY));
    }

    private async moveLayerAbove(layer: any, targetLayer: any): Promise<void> {
        if (!layer?.id || !targetLayer?.id) {
            throw new Error('DetailPageFiller failed: cannot reorder placed image because source or target layer is missing.');
        }
        if (typeof layer.move !== 'function') {
            throw new Error(`DetailPageFiller failed: layer ${layer.id} does not support DOM move; native Photoshop move is blocked to avoid popups.`);
        }
        const placement = getPhotoshopElementPlacement(constants, 'PLACEBEFORE', 'DetailPageFiller failed');
        await Promise.resolve(layer.move(targetLayer, placement));
    }

    private async createClippingMask(layer: any): Promise<void> {
        await action.batchPlay([{
            _obj: 'groupEvent',
            _target: [{ _ref: 'layer', _id: layer.id }],
            _options: { dialogOptions: 'dontDisplay' }
        }], { synchronousExecution: true });
    }

    private findLayerById(layers: any, id: number): any {
        if (!layers) return null;
        const list = Array.isArray(layers) ? layers : [layers];
        for (const layer of list) {
            if (layer?.id === id) return layer;
            if (layer?.layers) {
                const found = this.findLayerById(layer.layers, id);
                if (found) return found;
            }
        }
        return null;
    }
}

export class DetailPageFillerTool {
    name = 'fillDetailPage';

    schema = {
        name: 'fillDetailPage',
        description: 'Bulk fill copy and images into detail-page template.',
        parameters: {
            type: 'object' as const,
            properties: {
                plan: {
                    type: 'object',
                    description: 'Single fill plan'
                },
                plans: {
                    type: 'array',
                    description: 'Batch fill plan list'
                }
            },
            required: [] as string[]
        }
    };

    async execute(params: { plan?: FillPlan; plans?: FillPlan[] }): Promise<FillResult | FillResult[]> {
        const filler = new DetailPageFiller();
        if (params.plans) {
            return filler.fillAll(params.plans);
        }
        if (params.plan) {
            return filler.fill(params.plan);
        }
        throw new Error('Missing fill plan');
    }
}
