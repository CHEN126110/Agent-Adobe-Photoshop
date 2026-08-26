/**
 * SKU Skill 的内部色卡策略。
 *
 * 专业方法和布局由共享契约给出；本文件只按计划调用 Photoshop 原子 Tool，
 * 每个关键写入都保留读回结果，不依赖 Photoshop Action 或 JSX 黑盒。
 */

import type { AgentResult } from '../unified-agent.service';
import type { SkillExecuteParams } from './types';
import {
    SKU_COLOR_CARD_EXECUTION_REPORT_VERSION,
    buildInternalSkuColorCardGeometry,
    buildSkuColorCardUniformScalePlacementReceipt,
    buildSkuColorCardPlan,
    isSkuColorCardClippingReadbackVerified,
    resolveSkuColorCardSources,
    type SkuColorCardColorNameSource,
    type SkuColorCardExecutionReport,
    type SkuColorCardPlacementRect,
    type SkuColorCardPreparedCard,
    type SkuColorCardSourceResolution,
    type SkuColorCardSourceInput,
    type SkuColorCardSubjectFit,
    type SkuColorCardUniformScalePlacementReceipt
} from '../../../shared/sku-color-card-skill';
import {
    bindSkuColorCardRuntimeSelection,
    type SkuColorCardRuntimeSelectionReceipt
} from '../../../shared/sku-color-card-runtime-selection';
import { emitSkillStep } from './skill-step-events';
import {
    isPreparedSkuRetouchSource,
    type SkuRetouchPreparedSource,
    type SkuRetouchReport
} from '../../../shared/sku-retouch-contract';

interface ToolObservation {
    toolName: string;
    stage: string;
    sourceId?: string;
    result: any;
}

interface LayerBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

interface TextFitResult {
    verified: boolean;
    fontSize: number;
    labelBounds?: LayerBounds;
    textBounds?: LayerBounds;
    error?: string;
}

interface SkuSourceFilePreflight {
    success: boolean;
    failures: Array<{ sourceId: string; colorName: string; reason: string }>;
}

const SKU_RASTER_SOURCE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp']);
const SKU_PSD_SOURCE_EXTENSIONS = new Set(['.psd', '.psb']);
const MAX_SKU_SOURCE_PSD_PREFLIGHT_BYTES = 512 * 1024 * 1024;

function buildSubjectPlacementBounds(input: {
    cardBounds: { x: number; y: number; width: number; height: number };
    subjectFillRatio: number;
    anchor: 'center' | 'top-center' | 'bottom-center' | 'left-center' | 'right-center';
}): { x: number; y: number; width: number; height: number } {
    const width = Math.max(1, Math.round(input.cardBounds.width * input.subjectFillRatio));
    const height = Math.max(1, Math.round(input.cardBounds.height * input.subjectFillRatio));
    let x = Math.round(input.cardBounds.x + (input.cardBounds.width - width) / 2);
    let y = Math.round(input.cardBounds.y + (input.cardBounds.height - height) / 2);
    if (input.anchor === 'top-center') y = input.cardBounds.y;
    else if (input.anchor === 'bottom-center') y = input.cardBounds.y + input.cardBounds.height - height;
    else if (input.anchor === 'left-center') x = input.cardBounds.x;
    else if (input.anchor === 'right-center') x = input.cardBounds.x + input.cardBounds.width - width;
    return { x, y, width, height };
}

/**
 * 手工色卡面板兼容旧版视觉 Profile 的不可序列化 capability。
 *
 * 模型只能提交 JSON Tool 参数，无法构造或传递这个 Symbol。正常 SKU Skill 调用不携带
 * 第二参数，因此即使模型伪造 provenance 或历史隐藏布尔字段，也不能启用固定 Profile。
 */
export const MANUAL_SKU_COLOR_CARD_LEGACY_PROFILE_CAPABILITY = Symbol(
    'manual-sku-color-card-legacy-profile-capability'
);

export interface SkuColorCardTrustedExecutionCapabilities {
    manualLegacyProfile?: typeof MANUAL_SKU_COLOR_CARD_LEGACY_PROFILE_CAPABILITY;
    sourceSelectionReceipt?: SkuColorCardRuntimeSelectionReceipt;
}

function clean(value: unknown): string {
    return String(value || '').trim();
}

function fileBaseNameWithoutExtension(filePath: string): string {
    const normalized = clean(filePath).replace(/\\/g, '/');
    const baseName = normalized.split('/').filter(Boolean).pop() || '';
    return baseName.replace(/\.[^.]+$/, '').trim();
}

function fileExtension(filePath: string): string {
    const normalized = clean(filePath).replace(/\\/g, '/');
    const slashIndex = normalized.lastIndexOf('/');
    const dotIndex = normalized.lastIndexOf('.');
    return dotIndex > slashIndex ? normalized.slice(dotIndex).toLocaleLowerCase('en-US') : '';
}

async function preflightSkuSourceFilesBeforePhotoshopWrite(
    sources: Array<{ sourceId: string; colorName: string; filePath: string }>
): Promise<SkuSourceFilePreflight> {
    const bridge = (window as any).designEcho;
    const getFileInfo = bridge?.getFileInfo;
    const probeImageFile = bridge?.probeImageFile;
    const analyzePsdDesignSource = bridge?.analyzePsdDesignSource;
    if (typeof getFileInfo !== 'function') {
        return {
            success: false,
            failures: sources.map((source) => ({
                sourceId: source.sourceId,
                colorName: source.colorName,
                reason: '当前桌面运行时缺少只读文件信息探针'
            }))
        };
    }

    const failures: SkuSourceFilePreflight['failures'] = [];
    for (const source of sources) {
        const extension = fileExtension(source.filePath);
        try {
            const fileInfo = await getFileInfo(source.filePath);
            if (fileInfo?.isFile !== true || !Number.isFinite(Number(fileInfo?.size)) || Number(fileInfo.size) <= 0) {
                failures.push({
                    sourceId: source.sourceId,
                    colorName: source.colorName,
                    reason: '路径不存在、不是普通文件或文件为空'
                });
                continue;
            }
            if (SKU_RASTER_SOURCE_EXTENSIONS.has(extension)) {
                if (typeof probeImageFile !== 'function') {
                    failures.push({
                        sourceId: source.sourceId,
                        colorName: source.colorName,
                        reason: '当前桌面运行时缺少位图解码探针'
                    });
                    continue;
                }
                const probe = await probeImageFile(source.filePath);
                if (probe?.success !== true
                    || probe?.status !== 'ok'
                    || probe?.isFile !== true
                    || !Number.isFinite(Number(probe?.dimensions?.width))
                    || Number(probe.dimensions.width) <= 0
                    || !Number.isFinite(Number(probe?.dimensions?.height))
                    || Number(probe.dimensions.height) <= 0) {
                    failures.push({
                        sourceId: source.sourceId,
                        colorName: source.colorName,
                        reason: clean(probe?.error) || '位图无法完整解码'
                    });
                }
                continue;
            }
            if (SKU_PSD_SOURCE_EXTENSIONS.has(extension)) {
                if (Number(fileInfo.size) > MAX_SKU_SOURCE_PSD_PREFLIGHT_BYTES) {
                    failures.push({
                        sourceId: source.sourceId,
                        colorName: source.colorName,
                        reason: 'PSD/PSB 超过 512MB，只读预检无法在安全内存预算内完成'
                    });
                    continue;
                }
                if (typeof analyzePsdDesignSource !== 'function') {
                    failures.push({
                        sourceId: source.sourceId,
                        colorName: source.colorName,
                        reason: '当前桌面运行时缺少 PSD/PSB 只读解析探针'
                    });
                    continue;
                }
                const analysis = await analyzePsdDesignSource(source.filePath);
                if (analysis?.success !== true) {
                    failures.push({
                        sourceId: source.sourceId,
                        colorName: source.colorName,
                        reason: clean(analysis?.error) || 'PSD/PSB 无法完整解析'
                    });
                }
                continue;
            }
            failures.push({
                sourceId: source.sourceId,
                colorName: source.colorName,
                reason: `不支持的素材格式 ${extension || '(无扩展名)'}`
            });
        } catch (error) {
            failures.push({
                sourceId: source.sourceId,
                colorName: source.colorName,
                reason: error instanceof Error ? error.message : String(error)
            });
        }
    }
    return { success: failures.length === 0, failures };
}

function userAuthorizesFilenameLabels(userInput: string): boolean {
    const text = clean(userInput);
    if (!text) return false;
    if (/(?:不要|别|不用|不使用|不允许|不是|没有|拒绝).{0,16}文件名.{0,12}(?:作为|当作|就是|用于)?.{0,6}(?:颜色名|色名)|文件名.{0,12}(?:不要|别|不用|不使用|不允许|不是).{0,8}(?:颜色名|色名)/i.test(text)) {
        return false;
    }
    return /(?:颜色名|色名).{0,8}(?:用|取|按|采用|使用).{0,8}文件名|文件名.{0,8}(?:作为|当作|就是|用于).{0,6}(?:颜色名|色名)/i.test(text);
}

function userProvidesColorName(userInput: string, colorName: string): boolean {
    const normalizedColorName = clean(colorName).toLocaleLowerCase('zh-Hans-CN').replace(/\s+/g, '');
    if (!normalizedColorName) return false;
    const clauses = clean(userInput)
        .toLocaleLowerCase('zh-Hans-CN')
        .split(/[。！？!?；;\n]/)
        .map((clause) => clause.replace(/\s+/g, '').trim())
        .filter(Boolean);
    return clauses.some((clause) => {
        if (!clause.includes(normalizedColorName)) return false;
        if (/(?:不要|别|不选|不使用|不是|并非|排除|去掉|猜|示例|比如|例如)/.test(clause)) return false;
        const [beforeColorName, ...afterParts] = clause.split(normalizedColorName);
        const afterColorName = afterParts.join(normalizedColorName);
        if (/(?:背景|底色|文字|文案|边框|参考).{0,10}/.test(beforeColorName || '')
            || /^.{0,6}(?:背景|底色|文字|文案|边框|参考)/.test(afterColorName || '')) {
            return false;
        }
        const hasExplicitColorField = /(?:颜色名|色名|可用颜色|产品颜色|sku颜色|颜色有|颜色为|颜色是|颜色包括|颜色包含|配色为|配色是|配色包括|配色包含)/i.test(clause);
        const hasColorCardAction = /(?:做成|制作|生成|用于|作为).{0,12}(?:sku)?(?:色卡|颜色卡)|(?:色卡|颜色卡).{0,12}(?:用|使用|包含|包括)/i.test(clause);
        return hasExplicitColorField || hasColorCardAction;
    });
}

function resolveInputColorNameSource(input: {
    value: unknown;
    colorName: string;
    userInput: string;
    filenameLabelsAuthorized: boolean;
    filenameDerived: boolean;
    trustedManualSourceLabels: boolean;
}): SkuColorCardColorNameSource {
    if (input.trustedManualSourceLabels && input.value === 'provided' && input.colorName) {
        return 'provided';
    }
    if (input.value === 'filename_fallback') {
        return input.filenameLabelsAuthorized ? 'provided' : 'filename_fallback';
    }
    if (input.filenameLabelsAuthorized && input.filenameDerived) return 'provided';
    if (userProvidesColorName(input.userInput, input.colorName)) return 'provided';
    // source.colorNameSource / colorNames 都是模型可写参数，不能自行把候选升级为用户事实。
    if (input.colorName) return 'inferred_candidate';
    return 'filename_fallback';
}

function normalizeSourceInputs(
    params: Record<string, any>,
    userInput: string,
    trustedManualSourceLabels: boolean
): SkuColorCardSourceInput[] {
    // Tool 参数由模型生成，不能授予“文件名就是权威色名”的事实身份。
    // 只有本轮用户原文能把文件名从 provisional 候选升级为 provided。
    const filenameLabelsAuthorized = userAuthorizesFilenameLabels(userInput);
    const explicit = Array.isArray(params.sources) ? params.sources : [];
    if (explicit.length > 0) {
        return explicit.map((item: unknown) => {
            if (typeof item === 'string') {
                const colorName = filenameLabelsAuthorized ? fileBaseNameWithoutExtension(item) : '';
                return {
                    filePath: item,
                    colorName: colorName || undefined,
                    colorNameSource: filenameLabelsAuthorized ? 'provided' : 'filename_fallback'
                };
            }
            const source = item && typeof item === 'object' ? item as Record<string, unknown> : {};
            // 通用 source.name 通常只是文件名/显示名，不能自动升级成权威颜色名。
            const filePath = clean(source.filePath || source.path);
            const explicitColorName = clean(source.colorName);
            const shouldUseAuthorizedFilename = filenameLabelsAuthorized
                && source.colorNameSource === 'filename_fallback';
            const colorName = shouldUseAuthorizedFilename
                ? fileBaseNameWithoutExtension(filePath)
                : explicitColorName
                || (filenameLabelsAuthorized ? fileBaseNameWithoutExtension(filePath) : '');
            return {
                filePath,
                colorName: colorName || undefined,
                colorNameSource: resolveInputColorNameSource({
                    value: source.colorNameSource,
                    colorName,
                    userInput,
                    filenameLabelsAuthorized,
                    filenameDerived: !explicitColorName && Boolean(colorName),
                    trustedManualSourceLabels
                }),
                relativePath: clean(source.relativePath) || undefined,
                assetId: clean(source.assetId) || undefined
            };
        });
    }

    const sourcePaths = Array.isArray(params.sourcePaths) ? params.sourcePaths : [];
    const colorNames = Array.isArray(params.colorNames) ? params.colorNames : [];
    const sourceCount = Math.max(sourcePaths.length, colorNames.length);
    return Array.from({ length: sourceCount }, (_, index) => {
        const filePath = clean(sourcePaths[index]);
        const explicitColorName = clean(colorNames[index]);
        const colorName = explicitColorName
            || (filenameLabelsAuthorized ? fileBaseNameWithoutExtension(filePath) : '');
        return {
            filePath,
            colorName: colorName || undefined,
            colorNameSource: resolveInputColorNameSource({
                value: undefined,
                colorName,
                userInput,
                filenameLabelsAuthorized,
                filenameDerived: !explicitColorName && Boolean(colorName),
                trustedManualSourceLabels
            })
        };
    });
}

function readPositiveId(result: any, keys: string[]): number | undefined {
    const candidates: unknown[] = [];
    const data = result?.data;
    for (const key of keys) {
        candidates.push(result?.[key], data?.[key], result?.document?.[key], data?.document?.[key]);
    }
    for (const candidate of candidates) {
        const value = Number(candidate);
        if (Number.isFinite(value) && value > 0) return Math.round(value);
    }
    return undefined;
}

function readDocumentSize(result: any): { width: number; height: number; documentId?: number } | null {
    const document = result?.document || result?.data?.document || result?.data || result;
    const width = Number(document?.width);
    const height = Number(document?.height);
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return null;
    return {
        width: Math.round(width),
        height: Math.round(height),
        documentId: readPositiveId(result, ['documentId', 'id'])
    };
}

function readLayerBounds(result: any): LayerBounds | null {
    const value = result?.boundsNoEffects
        || result?.data?.boundsNoEffects
        || result?.bounds
        || result?.data?.bounds;
    if (!value || typeof value !== 'object') return null;
    const left = Number(value.left);
    const top = Number(value.top);
    const right = Number(value.right);
    const bottom = Number(value.bottom);
    const width = Number.isFinite(Number(value.width)) ? Number(value.width) : right - left;
    const height = Number.isFinite(Number(value.height)) ? Number(value.height) : bottom - top;
    if (![left, top, right, bottom, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
        return null;
    }
    return { left, top, right, bottom, width, height };
}

function toolError(result: any, fallback: string): string {
    return clean(result?.error || result?.message) || fallback;
}

function readSkuColorCardFailureSubject(diagnostic: string): string {
    const match = diagnostic.match(/“([^”]{1,80})”/);
    return match ? `“${match[1]}”` : '';
}

function buildSkuColorCardPublicFailureMessage(input: {
    stage: string;
    diagnostic: string;
    cancelled: boolean;
}): string {
    if (input.cancelled) {
        return 'SKU 色卡制作已停止，当前画面已保留。';
    }

    const subject = readSkuColorCardFailureSubject(input.diagnostic);
    if (input.stage === 'blocked_invalid_design_spec') {
        return '还缺少完整的色卡设计信息，本次尚未开始制作。';
    }
    if (input.stage === 'skill-atomic-tool-owner-unavailable') {
        return '当前无法可靠连接要编辑的 Photoshop 文档，本次尚未开始制作。';
    }
    if (input.stage === 'prepare-sku-retouch-assets'
        || input.stage === 'source-file-preflight'
        || input.stage === 'blocked_flat_assets_not_ready'
        || input.stage === 'blocked_retouch_asset_identity_incomplete') {
        return `${subject ? `${subject}素材` : '有素材'}无法安全读取或准备，本次尚未写入 Photoshop。`;
    }
    if (input.stage === 'create-document' || input.stage === 'create-document-readback') {
        return '无法创建或确认本次 SKU 色卡画布，本次没有继续制作。';
    }
    if (input.stage === 'save-output') {
        return 'SKU 色卡已经制作，但未能安全保存；当前画面已保留。';
    }
    if (input.stage.startsWith('verify-')
        || input.stage.startsWith('read-')
        || input.stage.startsWith('rebind-')
        || input.stage === 'return-to-main-document'
        || input.stage === 'final-structure-readback'
        || input.stage === 'draft-visual-snapshot') {
        return `${subject ? `${subject}的` : ''}当前结果无法确认完整，已停止保存；当前画面已保留。`;
    }
    return `${subject ? `${subject}在` : 'SKU 色卡在'}制作过程中遇到问题，已停止后续修改；当前画面已保留。`;
}

function isSmartObjectVerified(result: any): boolean {
    return result?.success === true && (
        result?.isSmartObject === true
        || result?.data?.isSmartObject === true
        || result?.entityType === 'smart-object'
    );
}

function readPlacementRect(value: unknown): SkuColorCardPlacementRect | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    const left = Number(record.left ?? record.x);
    const top = Number(record.top ?? record.y);
    const width = Number(record.width);
    const height = Number(record.height);
    if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
        return undefined;
    }
    return { left, top, width, height };
}

function readPlacedSourceProof(result: any): {
    assetId: string;
    checksum: string;
    byteLength: number;
    identityProofVersion: string;
    identityVerified: boolean;
} {
    const source = result?.data?.source || result?.source || {};
    const identityProof = source?.identityProof || {};
    return {
        assetId: clean(source.assetId),
        checksum: clean(source.checksum).toLocaleLowerCase('en-US'),
        byteLength: Number(source.byteLength) || 0,
        identityProofVersion: clean(identityProof.version),
        identityVerified: identityProof.verified === true
    };
}

function buildUniformScalePlacementReceiptFromToolResults(input: {
    source: SkuRetouchPreparedSource;
    sourceId: string;
    placedLayerId: number;
    documentId: number;
    expectedDocumentId: number;
    targetBounds: { x: number; y: number; width: number; height: number };
    placeResult: any;
    smartObjectInfo: any;
    layerBoundsResult: any;
}): SkuColorCardUniformScalePlacementReceipt {
    const assetSha256 = clean(input.source.productSha256).toLocaleLowerCase('en-US');
    const assetByteLength = Number(input.source.productByteLength) || 0;
    const assetWidth = Number(input.source.width) || 0;
    const assetHeight = Number(input.source.height) || 0;
    const placedSource = readPlacedSourceProof(input.placeResult);
    const targetBounds: SkuColorCardPlacementRect = {
        left: input.targetBounds.x,
        top: input.targetBounds.y,
        width: input.targetBounds.width,
        height: input.targetBounds.height
    };
    const placement = input.placeResult?.data?.placement || input.placeResult?.placement;
    const actualLayerBounds = readLayerBounds(input.layerBoundsResult);
    const smartObjectBounds = readLayerBounds(input.smartObjectInfo);
    const actualBounds = actualLayerBounds
        ? {
            left: actualLayerBounds.left,
            top: actualLayerBounds.top,
            width: actualLayerBounds.width,
            height: actualLayerBounds.height
        }
        : undefined;
    const smartBoundsAgree = Boolean(actualLayerBounds && smartObjectBounds)
        && Math.abs(actualLayerBounds!.left - smartObjectBounds!.left) <= 2
        && Math.abs(actualLayerBounds!.top - smartObjectBounds!.top) <= 2
        && Math.abs(actualLayerBounds!.width - smartObjectBounds!.width) <= 2
        && Math.abs(actualLayerBounds!.height - smartObjectBounds!.height) <= 2;
    const placementActualBounds = readPlacementRect(placement?.actualBounds);
    const placementBoundsAgree = !placementActualBounds || Boolean(actualBounds)
        && Math.abs(placementActualBounds.left - actualBounds!.left) <= 2
        && Math.abs(placementActualBounds.top - actualBounds!.top) <= 2
        && Math.abs(placementActualBounds.width - actualBounds!.width) <= 2
        && Math.abs(placementActualBounds.height - actualBounds!.height) <= 2;
    const observedDocumentId = readPositiveId(input.smartObjectInfo, ['documentId'])
        || readPositiveId(input.layerBoundsResult, ['documentId']);
    const infoFileReference = clean(
        input.smartObjectInfo?.fileReference || input.smartObjectInfo?.data?.fileReference
    );
    return buildSkuColorCardUniformScalePlacementReceipt({
        sourceId: input.sourceId,
        placedLayerId: input.placedLayerId,
        documentId: input.documentId,
        expectedDocumentId: input.expectedDocumentId,
        observedDocumentId,
        asset: {
            path: input.source.productPath || '',
            sha256: assetSha256,
            checksum: clean(input.source.productChecksum).toLocaleLowerCase('en-US'),
            byteLength: assetByteLength,
            width: assetWidth,
            height: assetHeight,
            alphaEnvelopeSafe: input.source.alphaSafety?.sourcePixelsPreserved === true
                && input.source.alphaSafety?.outputEdgesClear === true
        },
        placedSource,
        targetBounds,
        actualBounds,
        smartObjectBounds: smartObjectBounds
            ? {
                left: smartObjectBounds.left,
                top: smartObjectBounds.top,
                width: smartObjectBounds.width,
                height: smartObjectBounds.height
            }
            : undefined,
        placementActualBounds,
        smartObjectFileReference: infoFileReference,
        editableSmartObject: isSmartObjectVerified(input.smartObjectInfo),
        layerBoundsReadSucceeded: input.layerBoundsResult?.success === true
            && smartBoundsAgree
            && placementBoundsAgree,
        placementGeometryVerified: placement?.geometryVerification?.verified === true,
        outsideTargetFraction: Number(placement?.outsideTargetFraction || 0),
        outsideTargetEdges: Array.isArray(placement?.outsideTargetEdges)
            ? placement.outsideTargetEdges.map((edge: unknown) => clean(edge)).filter(Boolean)
            : ['unreadable']
    });
}

function resolveRetouchMode(value: unknown): 'auto' | 'layout_only' | 'studio_retouch_required' {
    if (value === 'layout_only') return 'layout_only';
    if (value === 'studio_retouch_required') return 'studio_retouch_required';
    return 'auto';
}

function hasUniformScaleAssetIdentity(
    source: SkuRetouchPreparedSource | undefined
): source is SkuRetouchPreparedSource & Required<Pick<
    SkuRetouchPreparedSource,
    'productPath' | 'previewPath' | 'productSha256' | 'productChecksum' | 'productByteLength' | 'width' | 'height' | 'alphaSafety'
>> {
    return isPreparedSkuRetouchSource(source)
        && /^[a-f0-9]{64}$/i.test(clean(source.productSha256))
        && /^fnv1a32:[a-f0-9]{8}$/i.test(clean(source.productChecksum))
        && Number.isFinite(Number(source.productByteLength))
        && Number(source.productByteLength) > 0
        && Number.isFinite(Number(source.width))
        && Number(source.width) > 0
        && Number.isFinite(Number(source.height))
        && Number(source.height) > 0
        && source.alphaSafety?.sourcePixelsPreserved === true
        && source.alphaSafety?.outputEdgesClear === true;
}

function resolveUniformScaleLayerStructureCheck(
    cards: SkuColorCardPreparedCard[]
): 'passed' | 'not_applicable' | 'failed' {
    const uniformScaleCards = cards.filter((card) => card.uniformScaleAssetApplied === true);
    if (uniformScaleCards.length === 0) return 'not_applicable';
    return uniformScaleCards.every((card) => (
        card.uniformScalePlacementVerified === true
        && card.uniformScalePlacementReceipt?.verified === true
    ))
        ? 'passed'
        : 'failed';
}

function resolveClippingStructureCheck(
    cards: SkuColorCardPreparedCard[]
): 'passed' | 'not_applicable' | 'failed' {
    if (cards.length === 0) return 'failed';
    const requiredCards = cards.filter((card) => card.clippingRequired === true);
    if (requiredCards.length === 0) return 'not_applicable';
    return requiredCards.every((card) => card.clippingVerified === true)
        ? 'passed'
        : 'failed';
}

function resolveRetouchAssetsCheck(input: {
    cards: SkuColorCardPreparedCard[];
    retouchReport?: SkuRetouchReport;
    expectedSourceCount: number;
}): 'passed' | 'not_applicable' | 'failed' {
    if (!input.retouchReport) return 'not_applicable';
    if (input.retouchReport.workflowStatus !== 'prepared') return 'failed';
    const verifiedCards = input.cards.filter((card) => (
        card.uniformScaleAssetApplied === true
        && card.uniformScalePlacementVerified === true
        && card.uniformScalePlacementReceipt?.verified === true
    ));
    return verifiedCards.length === input.expectedSourceCount ? 'passed' : 'failed';
}

function resolveSourceCoverageStatus(
    preparedCards: SkuColorCardPreparedCard[],
    sourceCount: number
): SkuColorCardExecutionReport['checks']['sourceCoverage'] {
    if (preparedCards.length !== sourceCount) return 'failed';
    if (preparedCards.some((card) => card.colorNameSource !== 'provided')) return 'needs_review';
    return 'passed';
}

function allPreparedCardsSatisfy(
    cards: SkuColorCardPreparedCard[],
    expectedSourceCount: number,
    predicate: (card: SkuColorCardPreparedCard) => boolean
): boolean {
    return expectedSourceCount > 0
        && cards.length === expectedSourceCount
        && cards.every(predicate);
}

function buildFailureReport(input: {
    outputPath: string;
    presentationMode: SkuColorCardExecutionReport['presentationMode'];
    sourceCount: number;
    preparedCards: SkuColorCardPreparedCard[];
    stage: string;
    error: string;
    indexReferenceIsolation: 'passed' | 'failed' | 'not_requested';
    finalStructureReadback?: boolean;
}): SkuColorCardExecutionReport {
    return {
        version: SKU_COLOR_CARD_EXECUTION_REPORT_VERSION,
        status: 'failed',
        outputPath: input.outputPath,
        presentationMode: input.presentationMode,
        sourceCount: input.sourceCount,
        preparedCards: input.preparedCards,
        checks: {
            sourceCoverage: resolveSourceCoverageStatus(input.preparedCards, input.sourceCount),
            smartObjectEditability: allPreparedCardsSatisfy(
                input.preparedCards,
                input.sourceCount,
                (card) => card.smartObjectVerified
            ) ? 'passed' : 'failed',
            clippingStructure: resolveClippingStructureCheck(input.preparedCards),
            labelTextFit: allPreparedCardsSatisfy(
                input.preparedCards,
                input.sourceCount,
                (card) => card.labelTextFitVerified
            ) ? 'passed' : 'failed',
            indexReferenceIsolation: input.indexReferenceIsolation,
            finalStructureReadback: input.finalStructureReadback ? 'passed' : 'failed',
            visualComposition: 'failed'
        },
        failureStage: input.stage,
        error: input.error
    };
}

export async function executeSkuColorCardStrategy(
    executeParams: SkillExecuteParams,
    trustedCapabilities: SkuColorCardTrustedExecutionCapabilities = {}
): Promise<AgentResult> {
        const {
            callbacks,
            signal,
            context,
            guardedAtomicToolExecutor
        } = executeParams;
        let params: Record<string, any> = executeParams.params || {};
        // 只有 Runtime context 中的原始用户消息可以授权“文件名就是颜色名”。
        // params.userIntent 为模型可写参数，不得据此提升来源可信度。
        const userInput = clean(context?.userInput);
        // 目录级参数：sourceDirectory（项目内子目录或绝对目录）→ 目录里全部图片按文件名当色名。
        // 20 张源图逐条写绝对路径会把模型的工具调用撑爆（真机截断循环 5 次）；一个目录名就够。
        if (!Array.isArray(params.sources) && !Array.isArray(params.sourcePaths) && clean(params.sourceDirectory)) {
            const rootPath = clean(params.projectPath || context?.projectContext?.projectPath);
            const dirRaw = clean(params.sourceDirectory);
            const dirPath = /^(?:[A-Za-z]:[\\/]|\\\\)/.test(dirRaw) || !rootPath
                ? dirRaw
                : `${rootPath.replace(/[\\/]+$/, '')}/${dirRaw.replace(/^[\\/]+/, '')}`;
            try {
                const scan = await (window as any).designEcho?.scanDirectory?.(dirPath, { recursive: false });
                const files: any[] = Array.isArray(scan?.files) ? scan.files : (Array.isArray(scan?.images) ? scan.images : []);
                const images = files
                    .map((f: any) => clean(f?.path || f?.filePath || f))
                    .filter((fp: string) => /\.(?:png|jpe?g|webp|tif{1,2}|ps[db])$/i.test(fp))
                    .sort((a: string, b: string) => a.localeCompare(b, 'zh'));
                if (images.length === 0) {
                    { const error = `sourceDirectory「${dirRaw}」里没有图片（解析为 ${dirPath}）；换目录或改传 sources。`; return { success: false, error, message: error }; }
                }
                // 同名不同扩展可能是副本，也可能是不同处理版。格式优先级只能排序，
                // 不能代替 Agent 对真实像素、可编辑性和当前目标的选择。在任何 Photoshop 写入前返回精确候选。
                const imagesByColorName = new Map<string, string[]>();
                for (const fp of images) {
                    const name = fileBaseNameWithoutExtension(fp);
                    const identityKey = name.normalize('NFKC').toLocaleLowerCase('zh-Hans-CN');
                    const group = imagesByColorName.get(identityKey) || [];
                    group.push(fp);
                    imagesByColorName.set(identityKey, group);
                }
                const ambiguousGroups = Array.from(imagesByColorName.entries())
                    .filter(([, group]) => group.length > 1)
                    .map(([, group]) => ({
                        name: fileBaseNameWithoutExtension(group[0]),
                        files: [...group]
                    }));
                if (ambiguousGroups.length > 0) {
                    const detail = ambiguousGroups
                        .map((group) => `「${group.name}」：${group.files.join('、')}`)
                        .join('；');
                    const message = `目录中存在同名的多个素材，尚不能判断应使用哪一个版本：${detail}。请先比较内容与可编辑性，再用 sources 显式传入选定文件。`;
                    return {
                        success: false,
                        error: message,
                        message,
                        toolResults: [],
                        data: {
                            status: 'needs_agent_source_selection',
                            sourceDirectory: dirPath,
                            ambiguousGroups
                        }
                    };
                }
                params = {
                    ...params,
                    sources: images.map((filePath: string) => ({
                        filePath,
                        colorName: fileBaseNameWithoutExtension(filePath),
                        colorNameSource: 'filename_fallback'
                    }))
                };
            } catch (error: any) {
                { const message = `读取 sourceDirectory 失败：${error?.message || error}`; return { success: false, error: message, message }; }
            }
        }
        const requestedSources = normalizeSourceInputs(
            params,
            userInput,
            trustedCapabilities.manualLegacyProfile === MANUAL_SKU_COLOR_CARD_LEGACY_PROFILE_CAPABILITY
        );
        const runtimeSelectionBinding = bindSkuColorCardRuntimeSelection(
            requestedSources,
            trustedCapabilities.sourceSelectionReceipt
        );
        const sourceResolution: SkuColorCardSourceResolution = runtimeSelectionBinding.applied
            ? {
                status: runtimeSelectionBinding.blockers.length > 0 ? 'blocked' : 'resolved',
                sources: runtimeSelectionBinding.sources,
                items: runtimeSelectionBinding.sources.map((source) => ({
                    colorName: clean(source.colorName) || fileBaseNameWithoutExtension(source.filePath),
                    colorNameSource: source.colorNameSource || 'inferred_candidate',
                    requestedPath: source.filePath,
                    resolvedPath: source.filePath,
                    method: 'runtime_asset_selection',
                    exactMatchCount: 1
                })),
                blockers: runtimeSelectionBinding.blockers,
                warnings: []
            }
            : resolveSkuColorCardSources({
                sources: requestedSources,
                assetIndex: context?.projectContext?.assetIndex,
                userInput
            });
        const sources = sourceResolution.sources;
        const projectPath = clean(params.projectPath || context?.projectContext?.projectPath);
        const plan = buildSkuColorCardPlan({
            sources,
            projectPath,
            outputPath: clean(params.outputPath),
            outputRelativePath: clean(params.outputRelativePath),
            designSpec: params.colorCardDesignSpec,
            allowExplicitLegacyProfile:
                trustedCapabilities.manualLegacyProfile === MANUAL_SKU_COLOR_CARD_LEGACY_PROFILE_CAPABILITY,
            sourceResolution
        });
        const observations: ToolObservation[] = [];
        const preparedCards: SkuColorCardPreparedCard[] = [];
        let retouchReport: SkuRetouchReport | undefined;
        let indexReferenceIsolation: 'passed' | 'failed' | 'not_requested' = plan.indexReference.enabled
            ? 'failed'
            : 'not_requested';

        function cancelled(): boolean {
            return signal?.aborted === true;
        }

        async function callTool(
            toolName: string,
            toolParams: Record<string, any>,
            stage: string,
            sourceId?: string
        ): Promise<any> {
            if (cancelled()) {
                return { success: false, cancelled: true, error: '任务已取消' };
            }
            callbacks?.onToolStart?.(toolName);
            const result = guardedAtomicToolExecutor
                ? await guardedAtomicToolExecutor(toolName, toolParams)
                : {
                    success: false,
                    code: 'skill_atomic_tool_owner_unavailable',
                    error: '当前 Skill 没有 Harness 签发的原子工具执行边界，已停止 Photoshop 写入。'
                };
            callbacks?.onToolComplete?.(toolName, result);
            observations.push({ toolName, stage, sourceId, result });
            return result;
        }

        async function fitAndPositionLabelText(input: {
            sourceId: string;
            labelLayerId?: number;
            targetBounds?: LayerBounds;
            textLayerId: number;
            initialFontSize: number;
            leadingToFontSizeRatio: number;
            alignment: 'left' | 'center' | 'right';
            horizontalPaddingRatio: number;
            verticalPaddingRatio: number;
        }): Promise<TextFitResult> {
            const labelBoundsResult = input.labelLayerId
                ? await callTool('getLayerBounds', {
                    layerId: input.labelLayerId,
                    includeEffects: false
                }, 'read-label-background-bounds', input.sourceId)
                : null;
            const initialTextBoundsResult = await callTool('getLayerBounds', {
                layerId: input.textLayerId,
                includeEffects: false
            }, 'read-label-text-bounds', input.sourceId);
            const labelBounds = input.targetBounds || readLayerBounds(labelBoundsResult);
            let textBounds = readLayerBounds(initialTextBoundsResult);
            if (!labelBounds || !textBounds) {
                return {
                    verified: false,
                    fontSize: input.initialFontSize,
                    error: '无法取得色名排版区域或文字的真实边界。'
                };
            }

            const horizontalPadding = Math.round(labelBounds.width * input.horizontalPaddingRatio);
            const verticalPadding = Math.round(labelBounds.height * input.verticalPaddingRatio);
            const availableWidth = Math.max(1, labelBounds.width - horizontalPadding * 2);
            const availableHeight = Math.max(1, labelBounds.height - verticalPadding * 2);
            const fitScale = Math.min(1, availableWidth / textBounds.width, availableHeight / textBounds.height);
            let fittedFontSize = input.initialFontSize;

            if (fitScale < 0.995) {
                fittedFontSize = Math.max(1, Math.floor(input.initialFontSize * fitScale));
                const resizeResult = await callTool('setTextStyle', {
                    layerId: input.textLayerId,
                    fontSize: fittedFontSize,
                    leading: fittedFontSize * input.leadingToFontSizeRatio
                }, 'fit-label-text-size', input.sourceId);
                if (!resizeResult?.success) {
                    return {
                        verified: false,
                        fontSize: fittedFontSize,
                        labelBounds,
                        textBounds,
                        error: toolError(resizeResult, '色名文字无法按标签底宽度缩放。')
                    };
                }
                const resizedTextBoundsResult = await callTool('getLayerBounds', {
                    layerId: input.textLayerId,
                    includeEffects: false
                }, 'read-fitted-label-text-bounds', input.sourceId);
                textBounds = readLayerBounds(resizedTextBoundsResult);
                if (!textBounds) {
                    return {
                        verified: false,
                        fontSize: fittedFontSize,
                        labelBounds,
                        error: '色名缩放后无法读回真实文字边界。'
                    };
                }
            }

            let targetX = Math.round(labelBounds.left + horizontalPadding);
            if (input.alignment === 'center') {
                targetX = Math.round(labelBounds.left + (labelBounds.width - textBounds.width) / 2);
            } else if (input.alignment === 'right') {
                targetX = Math.round(labelBounds.right - horizontalPadding - textBounds.width);
            }
            const targetY = Math.round(labelBounds.top + (labelBounds.height - textBounds.height) / 2);
            const moveResult = await callTool('moveLayer', {
                layerId: input.textLayerId,
                x: targetX,
                y: targetY,
                relative: false
            }, 'position-label-text', input.sourceId);
            if (!moveResult?.success) {
                return {
                    verified: false,
                    fontSize: fittedFontSize,
                    labelBounds,
                    textBounds,
                    error: toolError(moveResult, '色名文字无法移动到 Agent 声明的标签对齐位置。')
                };
            }

            const finalTextBoundsResult = await callTool('getLayerBounds', {
                layerId: input.textLayerId,
                includeEffects: false
            }, 'verify-positioned-label-text', input.sourceId);
            const finalTextBounds = readLayerBounds(finalTextBoundsResult);
            if (!finalTextBounds) {
                return {
                    verified: false,
                    fontSize: fittedFontSize,
                    labelBounds,
                    error: '色名文字对齐后无法读回最终边界。'
                };
            }

            const tolerance = 2;
            const labelCenterX = labelBounds.left + labelBounds.width / 2;
            const labelCenterY = labelBounds.top + labelBounds.height / 2;
            const textCenterX = finalTextBounds.left + finalTextBounds.width / 2;
            const textCenterY = finalTextBounds.top + finalTextBounds.height / 2;
            const inside = finalTextBounds.left >= labelBounds.left + horizontalPadding - tolerance
                && finalTextBounds.right <= labelBounds.right - horizontalPadding + tolerance
                && finalTextBounds.top >= labelBounds.top + verticalPadding - tolerance
                && finalTextBounds.bottom <= labelBounds.bottom - verticalPadding + tolerance;
            let horizontallyAligned = Math.abs(labelCenterX - textCenterX) <= tolerance;
            if (input.alignment === 'left') {
                horizontallyAligned = Math.abs(finalTextBounds.left - (labelBounds.left + horizontalPadding)) <= tolerance;
            } else if (input.alignment === 'right') {
                horizontallyAligned = Math.abs(finalTextBounds.right - (labelBounds.right - horizontalPadding)) <= tolerance;
            }
            const verticallyCentered = Math.abs(labelCenterY - textCenterY) <= tolerance;
            return {
                verified: inside && horizontallyAligned && verticallyCentered,
                fontSize: fittedFontSize,
                labelBounds,
                textBounds: finalTextBounds,
                ...(!inside || !horizontallyAligned || !verticallyCentered
                    ? { error: '色名文字最终边界没有同时满足标签底内收纳、Agent 声明的水平对齐与垂直居中。' }
                    : {})
            };
        }

        function fail(stage: string, error: string): AgentResult {
            const isCancelled = cancelled();
            const userMessage = buildSkuColorCardPublicFailureMessage({
                stage,
                diagnostic: error,
                cancelled: isCancelled
            });
            const report = buildFailureReport({
                outputPath: plan.outputPath,
                presentationMode: plan.presentationMode,
                sourceCount: plan.slots.length,
                preparedCards,
                stage,
                error,
                indexReferenceIsolation
            });
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: 'SKU 色卡未完成',
                detail: userMessage,
                status: 'error',
                percent: 100,
                issue: stage
            });
            return {
                success: false,
                message: userMessage,
                error: userMessage,
                cancelled: isCancelled,
                toolResults: observations,
                data: { plan, report, sourceResolution }
            };
        }

        emitSkillStep(callbacks, {
            kind: 'observation',
            title: '检查 SKU 色卡输入与结构',
            detail: plan.canvas
                ? `输入图片 ${sources.length} 张；目标文档 ${plan.documentName}；画布 ${plan.canvas.width}×${plan.canvas.height}。`
                : `输入图片 ${sources.length} 张；目标文档 ${plan.documentName}；首次写入前还缺少 Agent 的色卡设计声明。`,
            status: plan.canExecute ? 'success' : 'error',
            percent: 6,
            issue: plan.canExecute ? undefined : plan.status
        });
        if (!plan.canExecute) {
            return fail(plan.status, plan.blockers.join('；'));
        }
        if (!plan.canvas || !plan.cardStyle || !plan.imagePlacement) {
            return fail('blocked_invalid_design_spec', '色卡设计声明没有形成完整的可执行计划。');
        }
        if (!guardedAtomicToolExecutor) {
            return fail(
                'skill-atomic-tool-owner-unavailable',
                '色卡制作还没有开始：当前运行环境无法可靠绑定要写入的 Photoshop 文档。请重新加载 DesignEcho 插件，必要时重启 Photoshop 后再试。'
            );
        }

        const retouchMode = resolveRetouchMode(params.retouchMode);
        if (plan.presentationMode === 'flat' && retouchMode === 'layout_only') {
            return fail(
                'blocked_flat_assets_not_ready',
                'Agent 选择了 flat 平铺结构，但当前请求禁止准备平铺所需的可编辑精修资产。首次 Photoshop 写入前已停止。'
            );
        }
        const shouldPrepareRetouchAssets = plan.presentationMode === 'flat'
            || retouchMode === 'studio_retouch_required';
        if (shouldPrepareRetouchAssets) {
            emitSkillStep(callbacks, {
                kind: 'tool_planned',
                title: '准备纯底 SKU 精修资产',
                detail: '先判断纯底/场景，再生成等比缩放统一尺度的透明底主体（不变形保版型；阴影与光影修正属下一阶段）。',
                status: 'running',
                percent: 8
            });
            const retouchResult = await callTool('prepareSkuRetouchAssets', {
                sources: plan.slots.map((slot) => ({
                    sourceId: slot.source.sourceId,
                    filePath: slot.source.filePath,
                    colorName: slot.source.colorName
                })),
                projectPath,
                outputDir: clean(params.retouchOutputDir) || undefined,
                referenceSourcePath: clean(params.referenceSourcePath) || undefined,
                sourceMode: params.sourceMode === 'studio' || params.sourceMode === 'scene'
                    ? params.sourceMode
                    : 'auto',
                maxLongEdge: params.retouchMaxLongEdge,
                force: params.forceRetouch === true
            }, 'prepare-sku-retouch-assets');
            if (!retouchResult?.success) {
                return fail(
                    'prepare-sku-retouch-assets',
                    toolError(retouchResult, 'SKU 纯底素材精修资产生成失败。')
                );
            }
            retouchReport = retouchResult as SkuRetouchReport;
            const missingRequiredRetouchSources = plan.slots.filter((slot) => !hasUniformScaleAssetIdentity(
                retouchReport?.sources.find((source) => source.sourceId === slot.source.sourceId)
            ));
            if (retouchMode === 'studio_retouch_required' && missingRequiredRetouchSources.length > 0) {
                return fail(
                    'prepare-sku-retouch-assets',
                    `当前任务要求所有纯底素材形成统一尺度资产，但 ${missingRequiredRetouchSources.map((slot) => `“${slot.source.colorName}”`).join('、')} 未通过适用性检查。`
                );
            }
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: retouchReport.workflowStatus === 'prepared' ? 'SKU 统一尺度资产已生成' : '已跳过纯底统一处理',
                detail: retouchReport.workflowStatus === 'prepared'
                    ? `基准：${retouchReport.referenceSourceId || '自动'}；已生成 ${retouchReport.sources.filter((source) => source.status === 'prepared').length} 组可编辑资产。`
                    : '素材不适用纯底处理，将保留原图进入色卡结构并等待场景方向复核。',
                status: 'success',
                percent: 10
            });
        }

        if (plan.presentationMode === 'flat') {
            const unavailableFlatSources = plan.slots.filter((slot) => !hasUniformScaleAssetIdentity(
                retouchReport?.sources.find((source) => source.sourceId === slot.source.sourceId)
            ));
            if (unavailableFlatSources.length > 0) {
                return fail(
                    'blocked_flat_assets_not_ready',
                    `Agent 选择了 flat 平铺结构，但 ${unavailableFlatSources.map((slot) => `“${slot.source.colorName}”`).join('、')} 没有形成所需的统一尺度主体资产。首次 Photoshop 写入前已停止。`
                );
            }
        }

        const sourceFilePreflight = await preflightSkuSourceFilesBeforePhotoshopWrite(
            plan.slots.map((slot) => ({
                sourceId: slot.source.sourceId,
                colorName: slot.source.colorName,
                filePath: slot.source.filePath
            }))
        );
        if (!sourceFilePreflight.success) {
            const detail = sourceFilePreflight.failures
                .map((failure) => `“${failure.colorName}”：${failure.reason}`)
                .join('；');
            return fail(
                'source-file-preflight',
                `SKU 色卡素材在首次 Photoshop 写入前未通过完整文件检查：${detail}`
            );
        }

        callbacks?.onProgress?.('创建 SKU 色卡文档', 10);
        const createDocumentResult = await callTool('createDocument', {
            name: plan.documentName,
            width: plan.canvas.width,
            height: plan.canvas.height,
            backgroundColor: plan.canvas.backgroundColor
        }, 'create-document');
        if (!createDocumentResult?.success) {
            return fail('create-document', toolError(createDocumentResult, '创建 SKU 文档失败。'));
        }
        const mainDocumentId = readPositiveId(createDocumentResult, ['documentId', 'id']);
        if (!mainDocumentId) {
            return fail('create-document-readback', 'SKU 文档创建后没有返回可用文档 ID。');
        }

        for (let slotIndex = 0; slotIndex < plan.slots.length; slotIndex += 1) {
            const slot = plan.slots[slotIndex];
            const sourceId = slot.source.sourceId;
            const progressBase = 14 + Math.round((slotIndex / plan.slots.length) * 68);
            callbacks?.onProgress?.(`制作色卡：${slot.source.colorName}`, progressBase);
            emitSkillStep(callbacks, {
                kind: 'tool_planned',
                title: `制作色卡 ${slot.index}/${plan.slots.length}`,
                detail: `${slot.source.colorName} ← ${slot.source.filePath}`,
                status: 'running',
                percent: progressBase
            });

            const groupResult = await callTool('createGroup', {
                groupName: slot.groupName
            }, 'create-color-group', sourceId);
            const groupId = readPositiveId(groupResult, ['layerId', 'createdLayerId', 'id']);
            if (!groupResult?.success || !groupId) {
                return fail('create-color-group', toolError(groupResult, `颜色组“${slot.groupName}”创建失败。`));
            }
            const normalizeGroupRootResult = await callTool('moveLayerToGroup', {
                layerId: groupId,
                targetGroupId: 0,
                position: 'inside'
            }, 'normalize-color-group-root', sourceId);
            if (!normalizeGroupRootResult?.success) {
                return fail(
                    'normalize-color-group-root',
                    toolError(normalizeGroupRootResult, `颜色组“${slot.groupName}”无法归位到文档根级。`)
                );
            }

            const earlyRetouchSource: SkuRetouchPreparedSource | undefined = retouchReport?.sources.find(
                (source) => source.sourceId === sourceId
            );

            // Agent 显式选择 flat 时，Skill 只把已准备的统一尺度主体资产
            // 编译为可编辑平铺结构；离线处理结果本身不能把 card 自动改成 flat。
            if (plan.presentationMode === 'flat') {
                if (!hasUniformScaleAssetIdentity(earlyRetouchSource)) {
                    return fail(
                        'blocked_flat_assets_not_ready',
                        `“${slot.source.colorName}”缺少 flat 平铺结构所需的完整统一尺度资产身份或 alpha 安全收据。`
                    );
                }
                const flatGeometry = buildInternalSkuColorCardGeometry({
                    width: slot.cardBounds.width,
                    height: slot.cardBounds.height,
                    recipe: plan.cardStyle.internalLabel,
                    typography: plan.cardStyle.labelTypography,
                    labelText: slot.source.colorName
                });
                const offsetRect = (rect: { x: number; y: number; width: number; height: number }) => ({
                    ...rect,
                    x: rect.x + slot.cardBounds.x,
                    y: rect.y + slot.cardBounds.y
                });
                const flatImageBounds = buildSubjectPlacementBounds({
                    cardBounds: slot.cardBounds,
                    subjectFillRatio: plan.imagePlacement.subjectFillRatio,
                    anchor: plan.imagePlacement.anchor
                });

                const placeIntoGroup = async (
                    stage: string,
                    input: Record<string, any>
                ): Promise<{ layerId: number; placeResult: any } | undefined> => {
                    const placed = await callTool('placeImage', input, stage, sourceId);
                    const placedLayerId = readPositiveId(placed, ['layerId', 'placedLayerId', 'createdLayerId']);
                    if (!placed?.success || !placedLayerId) {
                        return undefined;
                    }
                    const moved = await callTool('moveLayerToGroup', {
                        layerId: placedLayerId,
                        targetGroupId: groupId,
                        position: 'inside'
                    }, `${stage}-group`, sourceId);
                    if (!moved?.success) return undefined;
                    return { layerId: placedLayerId, placeResult: placed };
                };

                const flatBackupPlacement = await placeIntoGroup('place-flat-source-backup', {
                    filePath: slot.source.filePath,
                    name: `${slot.source.colorName}-原始素材（备份）`,
                    targetBounds: flatImageBounds,
                    targetFit: 'contain',
                    targetAnchor: plan.imagePlacement.anchor,
                    layerOrder: 'front'
                });
                if (!flatBackupPlacement) {
                    return fail('place-flat-source-backup', `“${slot.source.colorName}”原始素材备份置入或入组失败。`);
                }
                const hideFlatBackupResult = await callTool('setLayerVisibility', {
                    layerId: flatBackupPlacement.layerId,
                    visible: false
                }, 'hide-flat-source-backup', sourceId);
                if (!hideFlatBackupResult?.success) {
                    return fail('hide-flat-source-backup', `“${slot.source.colorName}”原始素材备份无法隐藏。`);
                }
                const flatProductPlacement = await placeIntoGroup('place-flat-product', {
                    filePath: earlyRetouchSource.productPath,
                    sourcePath: earlyRetouchSource.productPath,
                    sourceAssetId: sourceId,
                    sourceChecksum: earlyRetouchSource.productChecksum,
                    sourceByteLength: earlyRetouchSource.productByteLength,
                    name: `${slot.source.colorName}-统一尺度主体`,
                    targetBounds: flatImageBounds,
                    targetFit: 'contain',
                    targetAnchor: plan.imagePlacement.anchor,
                    layerOrder: 'front'
                });
                if (!flatProductPlacement) {
                    return fail('place-flat-product', `“${slot.source.colorName}”统一尺度主体置入或入组失败。`);
                }
                const flatProductLayerId = flatProductPlacement.layerId;

                const flatTextResult = await callTool('createTextLayer', {
                    content: slot.source.colorName,
                    name: `${slot.source.colorName}-色名`,
                    x: flatGeometry.text.x + slot.cardBounds.x,
                    y: flatGeometry.text.y + slot.cardBounds.y,
                    fontSize: flatGeometry.text.fontSize,
                    fontName: plan.cardStyle.labelTypography.fontName || undefined,
                    tracking: plan.cardStyle.labelTypography.tracking,
                    leading: flatGeometry.text.fontSize * plan.cardStyle.labelTypography.leadingToFontSizeRatio,
                    colorHex: plan.cardStyle.labelTextColorHex,
                    alignment: plan.cardStyle.labelTypography.alignment
                }, 'create-flat-color-label', sourceId);
                const flatTextLayerId = readPositiveId(flatTextResult, ['layerId', 'createdLayerId']);
                if (!flatTextResult?.success || !flatTextLayerId) {
                    return fail('create-flat-color-label', toolError(flatTextResult, `“${slot.source.colorName}”色名文字创建失败。`));
                }
                const flatTextMove = await callTool('moveLayerToGroup', {
                    layerId: flatTextLayerId,
                    targetGroupId: groupId,
                    position: 'inside'
                }, 'group-flat-color-label', sourceId);
                if (!flatTextMove?.success) {
                    return fail('group-flat-color-label', `“${slot.source.colorName}”色名文字无法移入颜色组。`);
                }
                const flatLabelRect = offsetRect(flatGeometry.label);
                const flatTextFitResult = await fitAndPositionLabelText({
                    sourceId,
                    targetBounds: {
                        left: flatLabelRect.x,
                        top: flatLabelRect.y,
                        right: flatLabelRect.x + flatLabelRect.width,
                        bottom: flatLabelRect.y + flatLabelRect.height,
                        width: flatLabelRect.width,
                        height: flatLabelRect.height
                    },
                    textLayerId: flatTextLayerId,
                    initialFontSize: flatGeometry.text.fontSize,
                    leadingToFontSizeRatio: plan.cardStyle.labelTypography.leadingToFontSizeRatio,
                    alignment: plan.cardStyle.labelTypography.alignment,
                    horizontalPaddingRatio: plan.cardStyle.labelTypography.horizontalPaddingRatio,
                    verticalPaddingRatio: plan.cardStyle.labelTypography.verticalPaddingRatio
                });
                if (!flatTextFitResult.verified) {
                    return fail(
                        'verify-flat-label-text-fit',
                        `“${slot.source.colorName}”平铺色名文字适配未通过：${flatTextFitResult.error || '未知原因'}`
                    );
                }

                const flatProductInfo = await callTool('getSmartObjectInfo', {
                    layerId: flatProductLayerId
                }, 'verify-flat-product-smart-object', sourceId);
                const flatProductVerified = isSmartObjectVerified(flatProductInfo);
                if (!flatProductVerified) {
                    return fail('verify-flat-product-smart-object', toolError(flatProductInfo, `“${slot.source.colorName}”主体未读回为可编辑智能对象。`));
                }
                const flatProductBounds = await callTool('getLayerBounds', {
                    layerId: flatProductLayerId,
                    includeEffects: true
                }, 'verify-flat-product-bounds', sourceId);
                const flatPlacementReceipt = buildUniformScalePlacementReceiptFromToolResults({
                    source: earlyRetouchSource,
                    sourceId,
                    placedLayerId: flatProductLayerId,
                    documentId: mainDocumentId,
                    expectedDocumentId: mainDocumentId,
                    targetBounds: flatImageBounds,
                    placeResult: flatProductPlacement.placeResult,
                    smartObjectInfo: flatProductInfo,
                    layerBoundsResult: flatProductBounds
                });
                if (!flatPlacementReceipt.verified) {
                    return fail(
                        'verify-flat-product-placement',
                        `“${slot.source.colorName}”统一尺度主体的来源身份、真实边界、比例或 alpha 安全收据未通过，已停止保存。`
                    );
                }

                preparedCards.push({
                    sourceId,
                    colorName: slot.source.colorName,
                    colorNameSource: slot.source.colorNameSource,
                    sourcePath: slot.source.filePath,
                    groupId,
                    smartObjectLayerId: flatProductLayerId,
                    imageLayerId: flatProductLayerId,
                    labelTextLayerId: flatTextLayerId,
                    // flat 平铺没有剪切关系要求；必须明确记 not_applicable，不能冒充读回通过。
                    clippingRequired: false,
                    clippingVerified: false,
                    smartObjectVerified: flatProductVerified,
                    labelTextFitVerified: flatTextFitResult.verified,
                    sourceBackupLayerId: flatBackupPlacement.layerId,
                    uniformScaleAssetApplied: true,
                    uniformScalePlacementVerified: flatPlacementReceipt.verified,
                    uniformScalePlacementReceipt: flatPlacementReceipt,
                    retouchAssetReportPath: retouchReport?.reportPath
                });
                emitSkillStep(callbacks, {
                    kind: 'verification',
                    title: `“${slot.source.colorName}”纯底色卡组已就绪`,
                    detail: '统一尺度主体平铺（无卡片壳），色名文字已入组；阴影与光影修正属下一阶段。',
                    status: 'success',
                    percent: 40
                });
                continue;
            }

            const rectangleResult = await callTool('createRectangle', {
                name: `${slot.source.colorName}-圆角占位`,
                ...slot.cardBounds,
                fillColorHex: plan.cardStyle.fillColorHex,
                cornerRadius: plan.cardStyle.cornerRadius
            }, 'create-rounded-placeholder', sourceId);
            const rectangleLayerId = readPositiveId(rectangleResult, ['layerId', 'createdLayerId']);
            if (!rectangleResult?.success || !rectangleLayerId) {
                return fail('create-rounded-placeholder', toolError(rectangleResult, `“${slot.source.colorName}”圆角占位创建失败。`));
            }

            const convertResult = await callTool('convertToSmartObject', {
                layerIds: [rectangleLayerId],
                name: slot.smartObjectName
            }, 'convert-placeholder-to-smart-object', sourceId);
            const smartObjectLayerId = readPositiveId(convertResult, ['layerId', 'createdLayerId']);
            if (!convertResult?.success || !smartObjectLayerId) {
                return fail('convert-placeholder-to-smart-object', toolError(convertResult, `“${slot.source.colorName}”占位转智能对象失败。`));
            }

            const editResult = await callTool('editSmartObjectContents', {
                layerId: smartObjectLayerId
            }, 'open-smart-object', sourceId);
            const internalDocumentId = readPositiveId(editResult, ['documentId', 'id']);
            if (!editResult?.success || !internalDocumentId) {
                return fail('open-smart-object', toolError(editResult, `“${slot.source.colorName}”智能对象内容无法打开。`));
            }

            const internalInfoResult = await callTool('getDocumentInfo', {}, 'read-smart-object-document', sourceId);
            const internalSize = readDocumentSize(internalInfoResult);
            if (!internalInfoResult?.success || !internalSize) {
                return fail('read-smart-object-document', toolError(internalInfoResult, `无法读取“${slot.source.colorName}”智能对象内部尺寸。`));
            }
            const internalGeometry = buildInternalSkuColorCardGeometry({
                width: internalSize.width,
                height: internalSize.height,
                recipe: plan.cardStyle.internalLabel,
                typography: plan.cardStyle.labelTypography,
                labelText: slot.source.colorName
            });

            const retouchSource: SkuRetouchPreparedSource | undefined = retouchReport?.sources.find(
                (source) => source.sourceId === sourceId
            );
            let sourceBackupLayerId: number | undefined;
            let imageLayerId: number;
            let clippingVerified = false;
            let subjectFit: SkuColorCardSubjectFit | undefined;
            let uniformScalePlacementReceipt: SkuColorCardUniformScalePlacementReceipt | undefined;

            // card + studio_retouch_required 仍保持 Agent 选择的 card 外壳；离线处理只提供
            // 等比缩放统一尺度的主体资产，不得把 presentationMode 改成 flat。
            if (isPreparedSkuRetouchSource(retouchSource)) {
                if (!hasUniformScaleAssetIdentity(retouchSource)) {
                    return fail(
                        'blocked_retouch_asset_identity_incomplete',
                        `“${slot.source.colorName}”统一尺度资产缺少摘要、尺寸或 alpha 安全收据，不能写入 Photoshop。`
                    );
                }
                const retouchedCardImageBounds = buildSubjectPlacementBounds({
                    cardBounds: {
                        x: internalGeometry.image.x,
                        y: internalGeometry.image.y,
                        width: internalGeometry.image.width,
                        height: internalGeometry.image.height
                    },
                    subjectFillRatio: plan.imagePlacement.subjectFillRatio,
                    anchor: plan.imagePlacement.anchor
                });
                const backupResult = await callTool('placeImage', {
                    filePath: slot.source.filePath,
                    name: `${slot.source.colorName}-原始素材（备份）`,
                    targetBounds: retouchedCardImageBounds,
                    targetFit: 'contain',
                    targetAnchor: plan.imagePlacement.anchor,
                    layerOrder: 'back'
                }, 'place-source-backup', sourceId);
                sourceBackupLayerId = readPositiveId(backupResult, ['layerId', 'placedLayerId', 'createdLayerId']);
                if (!backupResult?.success || !sourceBackupLayerId) {
                    return fail('place-source-backup', toolError(backupResult, `“${slot.source.colorName}”原始素材备份置入失败。`));
                }
                const hideBackupResult = await callTool('setLayerVisibility', {
                    layerId: sourceBackupLayerId,
                    visible: false
                }, 'hide-source-backup', sourceId);
                if (!hideBackupResult?.success) {
                    return fail('hide-source-backup', toolError(hideBackupResult, `“${slot.source.colorName}”原始素材备份无法隐藏。`));
                }

                const productResult = await callTool('placeImage', {
                    filePath: retouchSource.productPath,
                    sourcePath: retouchSource.productPath,
                    sourceAssetId: sourceId,
                    sourceChecksum: retouchSource.productChecksum,
                    sourceByteLength: retouchSource.productByteLength,
                    name: `${slot.source.colorName}-统一尺度主体`,
                    targetBounds: retouchedCardImageBounds,
                    targetFit: 'contain',
                    targetAnchor: plan.imagePlacement.anchor,
                    layerOrder: 'front'
                }, 'place-retouched-product', sourceId);
                imageLayerId = readPositiveId(productResult, ['layerId', 'placedLayerId', 'createdLayerId']) || 0;
                if (!productResult?.success || !imageLayerId) {
                    return fail('place-retouched-product', toolError(productResult, `“${slot.source.colorName}”统一尺度主体置入失败。`));
                }
                const productClipResult = await callTool('createClippingMask', {
                    layerId: imageLayerId
                }, 'clip-retouched-product', sourceId);
                const productClipReadback = productClipResult?.success
                    ? await callTool('getClippingMaskInfo', { layerId: imageLayerId }, 'verify-retouched-product-clipping', sourceId)
                    : productClipResult;
                clippingVerified = isSkuColorCardClippingReadbackVerified(productClipReadback);
                if (!clippingVerified) {
                    return fail('verify-retouched-product-clipping', toolError(productClipReadback, `“${slot.source.colorName}”主体层剪切关系未通过读回。`));
                }
                const productSmartObjectInfo = await callTool('getSmartObjectInfo', {
                    layerId: imageLayerId
                }, 'verify-retouched-product-smart-object', sourceId);
                const productBoundsResult = await callTool('getLayerBounds', {
                    layerId: imageLayerId,
                    includeEffects: true
                }, 'verify-retouched-product-bounds', sourceId);
                uniformScalePlacementReceipt = buildUniformScalePlacementReceiptFromToolResults({
                    source: retouchSource,
                    sourceId,
                    placedLayerId: imageLayerId,
                    documentId: internalDocumentId,
                    expectedDocumentId: internalDocumentId,
                    targetBounds: retouchedCardImageBounds,
                    placeResult: productResult,
                    smartObjectInfo: productSmartObjectInfo,
                    layerBoundsResult: productBoundsResult
                });
                if (!uniformScalePlacementReceipt.verified) {
                    return fail(
                        'verify-retouched-product-placement',
                        `“${slot.source.colorName}”统一尺度主体的来源身份、真实边界、比例或 alpha 安全收据未通过，已停止保存智能对象。`
                    );
                }
            } else {
                const imageResult = await callTool('placeImage', {
                    filePath: slot.source.filePath,
                    name: `${slot.source.colorName}-商品图`,
                    targetBounds: internalGeometry.image,
                    targetFit: 'contain',
                    targetAnchor: plan.imagePlacement.anchor,
                    layerOrder: 'front'
                }, 'place-product-image-draft', sourceId);
                imageLayerId = readPositiveId(imageResult, ['layerId', 'placedLayerId', 'createdLayerId']) || 0;
                if (!imageResult?.success || !imageLayerId) {
                    return fail('place-product-image', toolError(imageResult, `“${slot.source.colorName}”图片置入失败。`));
                }

                const clippingResult = await callTool('createClippingMask', {
                    layerId: imageLayerId
                }, 'clip-product-image', sourceId);
                if (!clippingResult?.success) {
                    return fail('clip-product-image', toolError(clippingResult, `“${slot.source.colorName}”图片剪切蒙版创建失败。`));
                }
                const clippingReadback = await callTool('getClippingMaskInfo', {
                    layerId: imageLayerId
                }, 'verify-product-clipping', sourceId);
                clippingVerified = isSkuColorCardClippingReadbackVerified(clippingReadback);
                if (!clippingVerified) {
                    return fail('verify-product-clipping', toolError(clippingReadback, `“${slot.source.colorName}”图片未读回为剪切蒙版。`));
                }

                // 主体落位由 Agent 在首次写入前声明，Skill 只把该构图意图兑现为几何并读回。
                const subjectFitResult = await callTool('fitLayerSubjectToRegion', {
                    layerId: imageLayerId,
                    targetRegion: internalGeometry.image,
                    subjectFillRatio: plan.imagePlacement.subjectFillRatio,
                    anchor: plan.imagePlacement.anchor
                }, 'fit-subject-to-card-region', sourceId);
                if (!subjectFitResult?.success) {
                    return fail(
                        'fit-subject-to-card-region',
                        toolError(subjectFitResult, `“${slot.source.colorName}”商品主体缩放失败，卡片停留在原图置入状态。`)
                    );
                }
                const fitMethod = clean(subjectFitResult?.subjectDetection?.method);
                subjectFit = {
                    method: fitMethod || 'unknown',
                    confidence: clean(subjectFitResult?.subjectDetection?.confidence) || 'unknown',
                    appliedScalePercent: Number.isFinite(Number(subjectFitResult?.appliedScalePercent))
                        ? Number(subjectFitResult.appliedScalePercent)
                        : undefined,
                    geometryStatus: clean(subjectFitResult?.geometryVerification?.status) || undefined,
                    // 整框退化 = 没找到主体，缩放形同未做；如实标注交给视觉站，不记成已完成
                    subjectResolved: Boolean(fitMethod) && fitMethod !== 'frame'
                };
            }

            const labelResult = await callTool('createRectangle', {
                name: `${slot.source.colorName}-色名标签底`,
                ...internalGeometry.label,
                fillColorHex: plan.cardStyle.labelFillColorHex,
                cornerRadius: internalGeometry.label.cornerRadius
            }, 'create-color-label-background', sourceId);
            const labelBackgroundLayerId = readPositiveId(labelResult, ['layerId', 'createdLayerId']);
            if (!labelResult?.success || !labelBackgroundLayerId) {
                return fail('create-color-label-background', toolError(labelResult, `“${slot.source.colorName}”色名标签底创建失败。`));
            }

            const textResult = await callTool('createTextLayer', {
                content: slot.source.colorName,
                name: `${slot.source.colorName}-色名`,
                ...internalGeometry.text,
                fontName: plan.cardStyle.labelTypography.fontName || undefined,
                tracking: plan.cardStyle.labelTypography.tracking,
                leading: internalGeometry.text.fontSize * plan.cardStyle.labelTypography.leadingToFontSizeRatio,
                colorHex: plan.cardStyle.labelTextColorHex,
                alignment: plan.cardStyle.labelTypography.alignment
            }, 'create-color-label-text', sourceId);
            const labelTextLayerId = readPositiveId(textResult, ['layerId', 'createdLayerId']);
            if (!textResult?.success || !labelTextLayerId) {
                return fail('create-color-label-text', toolError(textResult, `“${slot.source.colorName}”色名文字创建失败。`));
            }

            const textFitResult = await fitAndPositionLabelText({
                sourceId,
                labelLayerId: labelBackgroundLayerId,
                textLayerId: labelTextLayerId,
                initialFontSize: internalGeometry.text.fontSize,
                leadingToFontSizeRatio: plan.cardStyle.labelTypography.leadingToFontSizeRatio,
                alignment: plan.cardStyle.labelTypography.alignment,
                horizontalPaddingRatio: plan.cardStyle.labelTypography.horizontalPaddingRatio,
                verticalPaddingRatio: plan.cardStyle.labelTypography.verticalPaddingRatio
            });
            if (!textFitResult.verified) {
                return fail(
                    'verify-label-text-fit',
                    `“${slot.source.colorName}”色名文字适配未通过：${textFitResult.error || '未知原因'}`
                );
            }

            const closeResult = await callTool('closeDocument', {
                documentId: internalDocumentId,
                save: true
            }, 'save-and-close-smart-object', sourceId);
            if (!closeResult?.success) {
                return fail('save-and-close-smart-object', toolError(closeResult, `“${slot.source.colorName}”智能对象保存失败。`));
            }

            const switchMainResult = await callTool('switchDocument', {
                documentId: mainDocumentId,
                documentName: plan.documentName
            }, 'return-to-main-document', sourceId);
            if (!switchMainResult?.success) {
                return fail('return-to-main-document', toolError(switchMainResult, '无法返回 SKU 主文档。'));
            }
            const reboundMainDocumentResult = await callTool(
                'getDocumentInfo',
                {},
                'rebind-main-document-after-switch',
                sourceId
            );
            const reboundMainDocument = readDocumentSize(reboundMainDocumentResult);
            if (!reboundMainDocumentResult?.success
                || reboundMainDocument?.documentId !== mainDocumentId) {
                return fail(
                    'rebind-main-document-after-switch',
                    '切回 SKU 主文档后未能读回同一文档身份，已停止后续图层写入。'
                );
            }
            const reboundMainHierarchyResult = await callTool(
                'getLayerHierarchy',
                {},
                'rebind-main-layers-after-switch',
                sourceId
            );
            if (!reboundMainHierarchyResult?.success) {
                return fail(
                    'rebind-main-layers-after-switch',
                    `切回 SKU 主文档后无法重新读取颜色组“${slot.groupName}”及其智能对象图层。`
                );
            }

            const moveSmartObjectResult = await callTool('moveLayerToGroup', {
                layerId: smartObjectLayerId,
                targetGroupId: groupId,
                position: 'inside'
            }, 'group-smart-object', sourceId);
            if (!moveSmartObjectResult?.success) {
                return fail('group-smart-object', toolError(moveSmartObjectResult, `“${slot.source.colorName}”智能对象无法移入颜色组。`));
            }

            const smartObjectInfo = await callTool('getSmartObjectInfo', {
                layerId: smartObjectLayerId
            }, 'verify-smart-object', sourceId);
            const smartObjectVerified = isSmartObjectVerified(smartObjectInfo);
            if (!smartObjectVerified) {
                return fail('verify-smart-object', toolError(smartObjectInfo, `“${slot.source.colorName}”未读回为可编辑智能对象。`));
            }

            preparedCards.push({
                sourceId,
                colorName: slot.source.colorName,
                colorNameSource: slot.source.colorNameSource,
                sourcePath: slot.source.filePath,
                groupId,
                smartObjectLayerId,
                internalDocumentId,
                internalCanvas: { width: internalSize.width, height: internalSize.height },
                imageLayerId,
                labelBackgroundLayerId,
                labelTextLayerId,
                clippingVerified,
                clippingRequired: true,
                smartObjectVerified,
                labelTextFitVerified: textFitResult.verified,
                subjectFit,
                sourceBackupLayerId,
                uniformScaleAssetApplied: Boolean(uniformScalePlacementReceipt),
                uniformScalePlacementVerified: uniformScalePlacementReceipt?.verified,
                uniformScalePlacementReceipt,
                retouchAssetReportPath: uniformScalePlacementReceipt
                    ? retouchReport?.reportPath
                    : undefined
            });
            emitSkillStep(callbacks, {
                kind: 'verification',
                title: `色卡结构已确认：${slot.source.colorName}`,
                detail: subjectFit
                    ? (subjectFit.subjectResolved
                        ? `已读回智能对象、剪切关系与色名文字边界；商品主体已按 Agent 声明的 ${Math.round(plan.imagePlacement.subjectFillRatio * 100)}% 占比和 ${plan.imagePlacement.anchor} 锚点完成检测缩放（${subjectFit.method}）${subjectFit.appliedScalePercent ? `，实际缩放 ${subjectFit.appliedScalePercent}%` : ''}。`
                        : '已读回智能对象、剪切关系与色名文字边界；但主体检测退化成整框，商品大小仍是原图状态，待视觉复核处理。')
                    : '已读回智能对象、商品图剪切关系，以及色名文字的真实边界与居中结果。',
                status: 'success',
                percent: progressBase + 8
            });
        }

        if (plan.indexReference.enabled) {
            if (!plan.indexReference.style) {
                return fail('blocked_invalid_design_spec', '已启用序号，但没有 Agent 声明的序号样式。');
            }
            const referenceGroupResult = await callTool('createGroup', {
                groupName: plan.indexReference.groupName
            }, 'create-index-reference-group');
            const referenceGroupId = readPositiveId(referenceGroupResult, ['layerId', 'createdLayerId', 'id']);
            if (!referenceGroupResult?.success || !referenceGroupId) {
                return fail(
                    'create-index-reference-group',
                    toolError(referenceGroupResult, '序号参考组创建失败。')
                );
            }
            const normalizeReferenceGroupResult = await callTool('moveLayerToGroup', {
                layerId: referenceGroupId,
                targetGroupId: 0,
                position: 'inside'
            }, 'normalize-index-reference-group-root');
            if (!normalizeReferenceGroupResult?.success) {
                return fail(
                    'normalize-index-reference-group-root',
                    toolError(normalizeReferenceGroupResult, '序号参考组无法归位到文档根层级。')
                );
            }

            for (const slot of plan.slots) {
                if (!slot.indexText) continue;
                const indexTextResult = await callTool('createTextLayer', {
                    content: slot.indexText.content,
                    name: slot.indexLayerName,
                    x: slot.indexText.x,
                    y: slot.indexText.y,
                    fontSize: slot.indexText.fontSize,
                    fontName: plan.indexReference.style.fontName || undefined,
                    tracking: plan.indexReference.style.tracking,
                    leading: slot.indexText.fontSize * plan.indexReference.style.leadingToFontSizeRatio,
                    colorHex: plan.indexReference.style.colorHex,
                    alignment: plan.indexReference.style.alignment
                }, 'create-index-reference-text', slot.source.sourceId);
                const indexLayerId = readPositiveId(indexTextResult, ['layerId', 'createdLayerId']);
                if (!indexTextResult?.success || !indexLayerId) {
                    return fail(
                        'create-index-reference-text',
                        toolError(indexTextResult, `“${slot.source.colorName}”参考序号创建失败。`)
                    );
                }
                const moveIndexResult = await callTool('moveLayerToGroup', {
                    layerId: indexLayerId,
                    targetGroupId: referenceGroupId,
                    position: 'inside'
                }, 'move-index-to-reference-group', slot.source.sourceId);
                if (!moveIndexResult?.success) {
                    return fail(
                        'move-index-to-reference-group',
                        toolError(moveIndexResult, `“${slot.source.colorName}”参考序号无法移入参考组。`)
                    );
                }
            }
            indexReferenceIsolation = 'passed';
        }

        const finalDocumentInfo = await callTool('getDocumentInfo', {}, 'verify-main-document');
        const finalDocumentSize = readDocumentSize(finalDocumentInfo);
        if (!finalDocumentInfo?.success
            || !finalDocumentSize
            || finalDocumentSize.documentId !== mainDocumentId
            || finalDocumentSize.width !== plan.canvas.width
            || finalDocumentSize.height !== plan.canvas.height) {
            return fail('verify-main-document', '最终活动文档不是预期的 SKU 画布，已停止保存。');
        }

        const snapshotResult = await callTool('getAcceptanceSnapshot', {
            includeHidden: true,
            includeText: true,
            includeBounds: true,
            maxLayers: 240
        }, 'final-structure-readback');
        if (!snapshotResult?.success) {
            return fail('final-structure-readback', toolError(snapshotResult, 'SKU 色卡完成后无法读回图层结构。'));
        }

        const draftVisualSnapshot = await callTool('getCanvasSnapshot', {
            maxSize: 1500
        }, 'draft-visual-snapshot');
        if (!draftVisualSnapshot?.success) {
            return fail('draft-visual-snapshot', toolError(draftVisualSnapshot, 'SKU 色卡结构草稿创建后无法取得视觉快照。'));
        }

        const saveResult = await callTool('saveDocument', {
            format: 'psb',
            path: plan.outputPath,
            saveAs: true,
            conflictPolicy: 'fail_if_exists'
        }, 'save-output');
        if (!saveResult?.success) {
            return fail('save-output', toolError(saveResult, `SKU 色卡无法保存到 ${plan.outputPath}。`));
        }

        const report: SkuColorCardExecutionReport = {
            version: SKU_COLOR_CARD_EXECUTION_REPORT_VERSION,
            status: 'structure_ready',
            outputPath: plan.outputPath,
            presentationMode: plan.presentationMode,
            documentId: mainDocumentId,
            sourceCount: plan.slots.length,
            preparedCards,
            checks: {
                sourceCoverage: resolveSourceCoverageStatus(preparedCards, plan.slots.length),
                smartObjectEditability: allPreparedCardsSatisfy(
                    preparedCards,
                    plan.slots.length,
                    (card) => card.smartObjectVerified
                ) ? 'passed' : 'failed',
                clippingStructure: resolveClippingStructureCheck(preparedCards),
                labelTextFit: allPreparedCardsSatisfy(
                    preparedCards,
                    plan.slots.length,
                    (card) => card.labelTextFitVerified
                ) ? 'passed' : 'failed',
                indexReferenceIsolation,
                finalStructureReadback: 'passed',
                visualComposition: 'needs_review',
                retouchAssets: resolveRetouchAssetsCheck({
                    cards: preparedCards,
                    retouchReport,
                    expectedSourceCount: plan.slots.length
                }),
                uniformScaleLayerStructure: resolveUniformScaleLayerStructureCheck(preparedCards)
            },
            retouchReport
        };
        // 统一尺度卡 = 离线等比缩放资产已置入的卡（跨色尺度由资产画布保证，无需再缩放）。
        const uniformScaledCardCount = preparedCards.filter((card) => (
            card.uniformScaleAssetApplied === true && card.uniformScalePlacementVerified === true
        )).length;
        // 主体缩放已在站①由引擎按色卡标准执行；只有主体检测退化成整框的原图卡片才需要视觉站补做。
        const cardsNeedingSubjectReview = preparedCards.filter((card) =>
            card.uniformScaleAssetApplied !== true && card.subjectFit?.subjectResolved !== true
        );
        const subjectReviewCardNames = cardsNeedingSubjectReview.map((card) => card.colorName).join('、');
        const visualAdjustmentHandoff = {
            version: 'sku-color-card-visual-adjustment-handoff/v0' as const,
            status: 'needs_visual_review' as const,
            mainDocumentId,
            outputPath: plan.outputPath,
            cards: preparedCards.map((card) => ({
                colorName: card.colorName,
                colorNameSource: card.colorNameSource,
                sourcePath: card.sourcePath,
                smartObjectLayerId: card.smartObjectLayerId,
                imageLayerId: card.imageLayerId,
                labelBackgroundLayerId: card.labelBackgroundLayerId,
                labelTextLayerId: card.labelTextLayerId,
                internalCanvas: card.internalCanvas,
                /** 该卡是否已置入离线等比缩放的统一尺度主体（true 时跨色尺度由资产画布保证）。 */
                uniformScaleApplied: card.uniformScaleAssetApplied === true
                    && card.uniformScalePlacementVerified === true,
                /** 站①引擎主体缩放结果；subjectResolved=false 的卡片商品大小仍是原图状态。 */
                subjectFit: card.subjectFit,
                /**
                 * 只有这里为 true 的卡片才需要模型动手调主体大小——旧方案把建议参数塞给模型
                 * 「考虑」，真机 2026-08-01 模型看了 12 次快照一次没调；现在排版归引擎，
                 * 模型只处理检测退化的例外：显式 fitLayerSubjectToRegion(method:"smart",
                 * subjectFillRatio:<本卡片判断>, anchor:<本卡片判断>)
                 * 重试一次，或按画面用 transformLayer/moveLayer 小步调整。
                 */
                subjectFitPendingVisualFix: card.uniformScaleAssetApplied !== true
                    && card.subjectFit?.subjectResolved !== true
            })),
            reviewQuestions: [
                '商品主体是否足够突出，且没有因原图留白显得偏小？',
                '主体重心和裁切是否适合卡片，而不是机械居中或机械铺满？',
                '色名标签是否遮挡关键商品细节，整体位置是否需要微调？'
            ],
            nextSteps: [
                '只打开尚未复核的色卡智能对象并取得真实画布快照；不要移动 SKU 主文档中的颜色组或重新编排卡片。',
                `原图卡片已按 Agent 首次写入前声明的主体占比 ${Math.round(plan.imagePlacement.subjectFillRatio * 100)}% 与 ${plan.imagePlacement.anchor} 锚点完成几何落位；视觉复核只判断真实大小、重心和裁切是否合适，不要对 subjectFitPendingVisualFix=false 的卡片重复执行 fitLayerSubjectToRegion。`,
                ...(cardsNeedingSubjectReview.length > 0
                    ? [`${subjectReviewCardNames} 的主体检测退化成整框、商品大小仍是原图状态：请先看画面确认主体位置，再按本卡片判断显式提供 subjectFillRatio 与 anchor 调用 fitLayerSubjectToRegion（method:"smart"）重试一次；仍失败就按画面用 transformLayer/moveLayer 小步调整，不要重复阻塞调用。`]
                    : []),
                '已置入「统一尺度主体」的卡片跨色大小由离线资产保证，只在画面确实需要时做小步调整，不重复执行主体缩放。',
                '只有画面确实需要修改时才执行一次小步调整；每次调整后重新取得快照复核，再保存关闭智能对象并返回 SKU 主文档。',
                '同一对象的写后验收未通过时停止重复动作，改用其他方法或如实说明阻塞原因。',
                '全部色卡复核后保存主文档，并读取最终画面与结构；视觉未复核时不得声明设计完成。'
            ]
        };
        emitSkillStep(callbacks, {
            kind: 'observation',
            title: 'SKU 色卡结构草稿已生成',
            detail: `已创建 ${preparedCards.length} 个可编辑颜色卡，其中 ${uniformScaledCardCount} 个已置入等比缩放统一尺度主体；下一步需要 Agent 依据真实快照完成视觉验收。`,
            status: 'running',
            percent: 88
        });
        callbacks?.onProgress?.('SKU 色卡结构草稿已生成，等待视觉调整', 88);

        return {
            success: true,
            // 结构化交接：这些字段报告仍可使用的观察 /修订能力，但不裁剪下一轮工具面、
            // 不授予权限，也不替模型选择下一步。是否完成仍由真实视觉复核与交付契约判断。
            nextRequiredToolOptions: cardsNeedingSubjectReview.length === 0
                ? ['getAnnotatedSnapshot', 'getCanvasSnapshot', 'editSmartObjectContents', 'transformLayer']
                : ['getAnnotatedSnapshot', 'getCanvasSnapshot', 'editSmartObjectContents', 'fitLayerSubjectToRegion', 'getSubjectBounds', 'transformLayer'],
            nextRequiredToolReason: cardsNeedingSubjectReview.length === 0
                ? '所有卡片的结构与主体大小已由引擎写入并读回（原图卡片按色卡标准完成主体缩放，统一尺度卡片由离线资产保证跨色一致）；请查看真实画面，比较各颜色的主体大小、重心、受光和裁切，只在有明确视觉问题时小步修订，不重复执行主体缩放。'
                : `${subjectReviewCardNames} 的主体检测退化成整框、商品大小仍是原图状态；请先看真实画面，再只对这些卡片按画面显式提供 subjectFillRatio 与 anchor 使用 fitLayerSubjectToRegion（method:"smart"），或用 transformLayer 小步修正，其余卡片不要重复缩放。`,
            message: `SKU 色卡可编辑结构已生成：${preparedCards.length} 个颜色，${uniformScaledCardCount} 个已置入等比缩放统一尺度主体（保版型不变形；阴影与光影修正属下一阶段），原图卡片主体已按 Agent 声明的 ${Math.round(plan.imagePlacement.subjectFillRatio * 100)}% 占比与 ${plan.imagePlacement.anchor} 锚点完成几何落位${cardsNeedingSubjectReview.length > 0 ? `（${subjectReviewCardNames} 主体检测退化成整框，大小待视觉修正）` : ''}，已保存到 ${plan.outputPath}；仍需 Agent 根据真实快照完成最终视觉验收。${preparedCards.some((card) => card.colorNameSource !== 'provided') ? '部分标签来自文件名或未经证实的候选，真实颜色名仍待确认。' : ''}`,
            toolResults: observations,
            data: {
                plan,
                report,
                snapshot: draftVisualSnapshot.snapshot,
                snapshotResult,
                draftVisualSnapshot,
                saveResult,
                sourceResolution,
                visualAdjustmentHandoff,
                agentReActContinuation: {
                    status: 'needs_decision',
                    summary: 'SKU 色卡可编辑结构与统一尺度主体已生成，但主体大小、重心和裁切尚未由 Agent 根据真实画面确认。',
                    details: [
                        `已创建 ${preparedCards.length} 个可编辑色卡智能对象。`,
                        `其中 ${uniformScaledCardCount} 个已置入等比缩放统一尺度主体（阴影与光影修正属下一阶段）。`,
                        '色名文字已按 Photoshop 真实 bounds 完成宽度适配和水平/垂直居中。',
                        '已取得 SKU 主文档写后视觉快照。'
                    ],
                    warnings: [
                        '当前只完成结构和统一尺度主体写入（阴影与光影修正属下一阶段）；没有通过真实快照视觉验收，不得直接宣称色卡完成。',
                        ...(preparedCards.some((card) => card.colorNameSource !== 'provided')
                            ? ['部分色名只是文件名或模型/上游推断生成的 provisional 资产标签；确认真实颜色名之前不得宣称色名准确性通过。']
                            : []),
                        '视觉复核只处理智能对象内部商品图，不得移动主文档颜色组或重复执行验收未通过的相同动作。'
                    ],
                    nextAction: 'decide_next',
                    sourceStatus: 'structure_ready'
                }
            }
        };
}
