/**
 * SKU 排版工具
 *
 * 基于 6.3 顺序占位替换流程，实现 SKU 图片批量生成
 *
 * 功能：
 * 1. 分析项目结构 - 自动识别素材/模板/配置文件
 * 2. 解析配置文件 - 读取 CSV 配置
 * 3. 执行单个 SKU 排版 - 替换素材、缩放对齐
 * 4. 批量导出 - 按配置批量生成
 */

import { Tool, ToolExecutionContext, ToolResult, ToolSchema } from '../types';
import { saveEditableDocumentSnapshotInModal } from '../canvas/save-document';
import { getDirectExportTarget, saveAsJPEGViaJSX } from './export-folder-service';
import { normalizePhotoshopToolError } from '../../core/tool-error-normalizer';
import {
    readActiveHistoryStateRef,
    sameHistoryStateRef,
    type PhotoshopHistoryStateRef
} from '../../core/photoshop-history-state-ref';
import {
    buildSkuAutoLayoutPlan,
    buildSkuBoundedRegionLayoutPlan,
    buildSkuExplicitSingleRowLayoutPlan,
    verifySkuAutoLayoutResult,
    SkuAutoLayoutActualPlacement,
    SkuAutoLayoutObstacle,
    SkuAutoLayoutItem,
    SkuAutoLayoutPlan,
    SkuAutoLayoutQaResult,
    SkuAutoLayoutRect
} from '../sku/sku-auto-layout-plan';

const { app, core, action } = require('photoshop');
const storage = require('uxp').storage;
const fs = storage.localFileSystem;
const REQUEST_CANCELLED_ERROR = 'REQUEST_CANCELLED';

type SkuLiveLayerBounds = {
    bounds: SkuAutoLayoutRect | null;
    subjectBounds: SkuAutoLayoutRect | null;
};

function formatSkuLayoutCaughtError(error: unknown): string {
    const normalized = normalizePhotoshopToolError({
        toolName: 'skuLayout',
        error
    });
    return normalized.message || normalized.userMessage || 'Unknown skuLayout error';
}

function findLayerById(container: any, id: number): any {
    const layers = Array.isArray(container) ? container : container?.layers;
    if (!Array.isArray(layers)) return null;
    for (const layer of layers) {
        if (layer?.id === id) return layer;
        if (layer?.layers) {
            const found = findLayerById(layer.layers, id);
            if (found) return found;
        }
    }
    return null;
}

async function translateLayer(layer: any, offsetX: number, offsetY: number): Promise<void> {
    if (typeof layer?.translate !== 'function') {
        throw new Error(`SKULayout failed: layer ${layer?.id ?? 'unknown'} does not support DOM translate; native offset move is blocked to avoid Photoshop popups.`);
    }
    await Promise.resolve(layer.translate(offsetX, offsetY));
}

function readSkuBoundsCoordinate(value: any): number {
    return Number(value?._value ?? value?.value ?? value);
}

function readLayerBoundsRect(b: any): SkuAutoLayoutRect | null {
    if (!b) return null;

    let left: number;
    let top: number;
    let right: number;
    let bottom: number;

    if (Array.isArray(b) && b.length >= 4) {
        left = readSkuBoundsCoordinate(b[0]);
        top = readSkuBoundsCoordinate(b[1]);
        right = readSkuBoundsCoordinate(b[2]);
        bottom = readSkuBoundsCoordinate(b[3]);
    } else {
        left = readSkuBoundsCoordinate(b._left ?? b.left);
        top = readSkuBoundsCoordinate(b._top ?? b.top);
        right = readSkuBoundsCoordinate(b._right ?? b.right);
        bottom = readSkuBoundsCoordinate(b._bottom ?? b.bottom);
    }

    if (![left, top, right, bottom].every(Number.isFinite)) return null;
    return {
        left: Math.min(left, right),
        top: Math.min(top, bottom),
        right: Math.max(left, right),
        bottom: Math.max(top, bottom),
        width: Math.abs(right - left),
        height: Math.abs(bottom - top)
    };
}

function getLayerBoundsRect(layer: any): SkuAutoLayoutRect | null {
    return readLayerBoundsRect(layer?.bounds);
}

function getLayerBoundsNoEffectsRect(layer: any): SkuAutoLayoutRect | null {
    return readLayerBoundsRect(layer?.boundsNoEffects);
}

function getSkuAutoLayoutSubjectBounds(layer: any): SkuAutoLayoutRect | null {
    const bounds = getLayerBoundsRect(layer);
    const subject = getLayerBoundsNoEffectsRect(layer);
    if (!subject) return bounds;
    if (!bounds) return subject;

    const tolerancePx = 4;
    const contained =
        subject.left >= bounds.left - tolerancePx &&
        subject.top >= bounds.top - tolerancePx &&
        subject.right <= bounds.right + tolerancePx &&
        subject.bottom <= bounds.bottom + tolerancePx;
    const boundsArea = Math.max(1, bounds.width * bounds.height);
    const subjectArea = Math.max(1, subject.width * subject.height);
    const areaRatio = subjectArea / boundsArea;

    if (!contained) return bounds;
    if (areaRatio < 0.18 || areaRatio > 1.05) return bounds;
    return subject;
}

async function readLiveSkuLayerBounds(documentId: number, layerId: number): Promise<SkuLiveLayerBounds> {
    const descriptors = await action.batchPlay([{
        _obj: 'get',
        _target: [
            { _ref: 'layer', _id: layerId },
            { _ref: 'document', _id: documentId }
        ],
        _options: { dialogOptions: 'dontDisplay' }
    }], { synchronousExecution: true });
    const descriptor = descriptors?.[0] || null;
    const descriptorLayerId = Number(descriptor?.layerID ?? descriptor?.layerId);
    if (!Number.isFinite(descriptorLayerId) || descriptorLayerId !== layerId) {
        throw new Error(`SKU 最终边界读回目标不一致：请求图层 ${layerId}，返回 ${String(descriptorLayerId)}。`);
    }
    // 图层组的 batchPlay `bounds` 描述符在很多情况下返回整张画布（2026-08-18 真机：复制进模板的
    // 颜色组 DOM 读 250×380，缩放后 batchPlay 读回 800×800/1440×1440 = 画布 → 被判「缩放未生效」，
    // 18 项 SKU 全败）。组的真实范围以 DOM 的 children 并集为准；只在描述符与画布同尺寸时才改用 DOM，
    // 普通像素 / 智能对象层仍走描述符。
    let descriptorBounds = descriptor?.bounds;
    const isLayerGroup = String(descriptor?.layerSection?._value || '') === 'layerSectionStart';
    if (isLayerGroup) {
        const targetDocument = findOpenDocumentById(documentId);
        const rect = readLayerBoundsRect(descriptorBounds);
        const canvasW = Number(targetDocument?.width);
        const canvasH = Number(targetDocument?.height);
        const looksLikeCanvas = rect && canvasW > 0 && canvasH > 0
            && Math.abs(rect.width - canvasW) <= 1 && Math.abs(rect.height - canvasH) <= 1;
        if (looksLikeCanvas && targetDocument) {
            const domLayer = findLayerById(targetDocument, layerId);
            const domBounds = domLayer?.bounds;
            if (domBounds && Number.isFinite(Number(domBounds.left)) && Number.isFinite(Number(domBounds.right))) {
                descriptorBounds = {
                    left: Number(domBounds.left), top: Number(domBounds.top),
                    right: Number(domBounds.right), bottom: Number(domBounds.bottom)
                };
            }
        }
    }
    return {
        bounds: readLayerBoundsRect(descriptorBounds),
        subjectBounds: getSkuAutoLayoutSubjectBounds({
            bounds: descriptorBounds,
            boundsNoEffects: descriptor?.boundsNoEffects
        })
    };
}

function findOpenDocumentById(documentId: number): any | null {
    const expectedDocumentId = Number(documentId);
    if (!Number.isSafeInteger(expectedDocumentId) || expectedDocumentId <= 0) return null;
    for (let index = 0; index < app.documents.length; index += 1) {
        const document = app.documents[index];
        if (Number(document?.id) === expectedDocumentId) return document;
    }
    return null;
}

async function assertSkuMutationTarget(input: {
    documentId: number;
    layerId: number;
    phase: string;
    activateDocument?: boolean;
}): Promise<any> {
    const documentId = Number(input.documentId);
    const layerId = Number(input.layerId);
    if (!Number.isSafeInteger(documentId) || documentId <= 0) {
        throw new Error(`SKU ${input.phase}缺少有效目标 documentId。`);
    }
    if (!Number.isSafeInteger(layerId) || layerId <= 0) {
        throw new Error(`SKU ${input.phase}缺少有效目标 layerId。`);
    }

    const targetDocument = findOpenDocumentById(documentId);
    if (!targetDocument) {
        throw new Error(`SKU ${input.phase}找不到目标文档 ${documentId}。`);
    }
    if (input.activateDocument === true && Number(app.activeDocument?.id) !== documentId) {
        app.activeDocument = targetDocument;
    }
    if (Number(app.activeDocument?.id) !== documentId) {
        throw new Error(
            `SKU ${input.phase}目标文档不一致：期望 ${documentId}，`
            + `当前为 ${String(app.activeDocument?.id ?? 'none')}。`
        );
    }

    const targetLayer = findLayerById(targetDocument.layers, layerId);
    if (!targetLayer || Number(targetLayer?.id) !== layerId) {
        throw new Error(`SKU ${input.phase}在文档 ${documentId} 中找不到目标图层 ${layerId}。`);
    }

    const descriptors = await action.batchPlay([{
        _obj: 'get',
        _target: [
            { _ref: 'layer', _id: layerId },
            { _ref: 'document', _id: documentId }
        ],
        _options: { dialogOptions: 'dontDisplay' }
    }], { synchronousExecution: true });
    const descriptorLayerId = Number(descriptors?.[0]?.layerID ?? descriptors?.[0]?.layerId);
    if (!Number.isSafeInteger(descriptorLayerId) || descriptorLayerId !== layerId) {
        throw new Error(
            `SKU ${input.phase}目标图层不一致：期望 ${layerId}，返回 ${String(descriptorLayerId)}。`
        );
    }
    return targetLayer;
}

function isSkuAutoLayoutItem(value: SkuAutoLayoutItem | null): value is SkuAutoLayoutItem {
    return value !== null;
}

function getLayerChildren(layer: any): any[] {
    return layer?.layers ? Array.from(layer.layers) : [];
}

function collectSkuLayerIds(layers: any): Set<number> {
    const ids = new Set<number>();
    for (const layer of layers ? Array.from(layers) : []) {
        const id = Number((layer as any)?.id);
        if (Number.isFinite(id)) ids.add(id);
        for (const childId of collectSkuLayerIds((layer as any)?.layers)) ids.add(childId);
    }
    return ids;
}

function countSkuLayerTreeNodes(layer: any): number {
    return 1 + getLayerChildren(layer).reduce(
        (sum, child) => sum + countSkuLayerTreeNodes(child),
        0
    );
}

function assertCopiedSkuLayerStructure(input: {
    sourceLayer: any;
    copiedLayer: any;
    sourceName: string;
    previousTargetLayerIds: Set<number>;
}): void {
    const copiedLayerId = Number(input.copiedLayer?.id);
    if (!Number.isFinite(copiedLayerId) || input.previousTargetLayerIds.has(copiedLayerId)) {
        throw new Error(`复制 SKU 图层组失败：${input.sourceName} 没有生成新的目标图层 ID。`);
    }

    const sourceChildren = getLayerChildren(input.sourceLayer);
    const copiedChildren = getLayerChildren(input.copiedLayer);
    if (sourceChildren.length === 0 || copiedChildren.length === 0) {
        throw new Error(`复制 SKU 图层组失败：${input.sourceName} 的源或目标不是包含内容的图层组。`);
    }

    const sourceNodeCount = countSkuLayerTreeNodes(input.sourceLayer);
    const copiedNodeCount = countSkuLayerTreeNodes(input.copiedLayer);
    if (sourceChildren.length !== copiedChildren.length || sourceNodeCount !== copiedNodeCount) {
        throw new Error(
            `复制 SKU 图层组不完整：${input.sourceName} 源结构 ${sourceChildren.length}/${sourceNodeCount}，`
            + `目标结构 ${copiedChildren.length}/${copiedNodeCount}。`
        );
    }

    const copiedBounds = getLayerBoundsRect(input.copiedLayer);
    if (!copiedBounds || copiedBounds.width <= 0 || copiedBounds.height <= 0) {
        throw new Error(`复制 SKU 图层组失败：${input.sourceName} 的目标图层缺少有效边界。`);
    }
}

type SkuLayerGroupEntry = {
    layer: any;
    name: string;
    path: string;
    depth: number;
    layerCount: number;
    visible: boolean;
    topLevelName: string;
};

function isLayerGroupCandidate(layer: any): boolean {
    return Array.isArray(layer?.layers) && layer.layers.length > 0;
}

function normalizeSkuLayerName(value: string): string {
    return String(value || '').replace(/\s+/g, '').trim().toLowerCase();
}

function collectSkuLayerGroups(
    layers: any[],
    parentNames: string[] = [],
    parentVisible = true
): SkuLayerGroupEntry[] {
    const entries: SkuLayerGroupEntry[] = [];
    for (const layer of Array.isArray(layers) ? layers : []) {
        if (!isLayerGroupCandidate(layer)) continue;

        const name = String(layer?.name || '').trim();
        const pathNames = [...parentNames, name].filter(Boolean);
        const visible = parentVisible && layer?.visible !== false;
        entries.push({
            layer,
            name,
            path: pathNames.join('/'),
            depth: parentNames.length,
            layerCount: layer.layers.length,
            visible,
            topLevelName: pathNames[0] || name
        });
        entries.push(...collectSkuLayerGroups(layer.layers, pathNames, visible));
    }
    return entries;
}

function findSkuLayerGroupByName(layers: any[], colorName: string): SkuLayerGroupEntry | null {
    const target = normalizeSkuLayerName(colorName);
    if (!target) return null;
    const groups = collectSkuLayerGroups(layers);
    return groups.find((entry) => normalizeSkuLayerName(entry.name) === target) || null;
}

type SkuReplacementPlaceholder = {
    layer: any;
    name: string;
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
};

type SkuTemplateLayoutInspectionMode = 'ordered_slots' | 'legacy_single_region' | 'legacy_multi_regions' | 'none';

type SkuTemplateLayoutInspectionSlot = {
    layerId?: number;
    name: string;
    kind: string;
    sourceType: 'group_slot' | 'rectangle_region' | 'reference_group' | 'unknown';
    panelIndex: number;
    declaredCapacity?: number;
    visible: boolean;
    bounds: { left: number; top: number; right: number; bottom: number; width: number; height: number };
};

type SkuTemplateTextObservation = {
    layerId: number;
    name: string;
    contents: string;
    contentsTruncated: boolean;
    visible: boolean;
};

const MAX_SKU_TEMPLATE_TEXT_OBSERVATIONS = 64;

const REPLACEMENT_PLACEHOLDER_KEYWORDS = ['占位', 'placeholder', 'holder', '#'];

function isSkuPlaceholderContainerName(name: string): boolean {
    const n = String(name || '').trim().toLowerCase();
    return ['占位', '占位符', '占位组', 'placeholders', 'placeholder', 'holders', 'holder'].includes(n)
        || /sku.*占位符|占位符.*\d+个/.test(n);
}

function isSkuReplacementPlaceholderName(name: string): boolean {
    const n = String(name || '').trim().toLowerCase();
    // 纯数字名称在旧模板里既可能是顺序槽，也可能是设计容器。数字层不在这里单层自证，
    // 而由 collectTopLevelNumericSkuPlaceholders 按“同级连续集合 + 几何 + 期望数量”统一判定。
    return REPLACEMENT_PLACEHOLDER_KEYWORDS.some((keyword) => n.includes(keyword));
}

function isPureNumericSkuLayerName(name: string): boolean {
    return /^\d+$/.test(String(name || '').trim());
}

function isLegacySkuReferenceRegionName(name: string): boolean {
    const normalized = String(name || '').trim();
    return /^(?:形状|矩形)?参考$|^参考(?:形状|矩形|区域)?$|(?:占位|sku).{0,8}参考|reference|ref(?:erence)?[\s_-]*(?:shape|region|box)?/i.test(normalized);
}

function normalizeSkuReplacementPlaceholder(layer: any): SkuReplacementPlaceholder | null {
    const bounds = getLayerBoundsRect(layer);
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
    return {
        layer,
        name: String(layer?.name || '').trim(),
        left: bounds.left,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
        width: bounds.width,
        height: bounds.height
    };
}

function findSkuPlaceholderContainer(layers: any[]): any | null {
    for (const layer of Array.isArray(layers) ? layers : []) {
        const name = String(layer?.name || '').trim();
        const children = getLayerChildren(layer);
        if (children.length > 0 && isSkuPlaceholderContainerName(name)) return layer;
        const nested = findSkuPlaceholderContainer(children);
        if (nested) return nested;
    }
    return null;
}

function isSkuRectangleReplacementPlaceholderLayer(layer: any, doc: any): boolean {
    const bounds = getLayerBoundsRect(layer);
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return false;
    if (isTemplateGroupLayer(layer)) return false;
    const kind = getLayerKindText(layer);
    const name = String(layer?.name || '').trim();
    if (layer?.isBackgroundLayer === true || kind === 'background') return false;
    if (kind.includes('text')) return false;
    if (isFullCanvasTemplateLayer(bounds, doc)) return false;
    if (!isLegacySkuRegionGeometry(bounds, doc)) return false;
    const referenceRegionName = isLegacySkuReferenceRegionName(name);
    const legacyShapeName = /^(矩形|矩形\s*\d+|形状|rectangle|rect|shape)\b|\b(rectangle|rect|placeholder\s*box)\b/i.test(name);
    const shapeKind = /shape|solidcolor|solidcolorlayer|contentlayer/i.test(kind);
    return referenceRegionName || legacyShapeName || shapeKind;
}

function hasReferenceSlotTextChild(layer: any): boolean {
    return getLayerChildren(layer).some((child) => getLayerKindText(child).includes('text'));
}

function hasReferenceSlotVisualChild(layer: any): boolean {
    return getLayerChildren(layer).some((child) => {
        const kind = getLayerKindText(child);
        return kind.includes('smartobject')
            || kind.includes('pixel')
            || kind.includes('normal')
            || kind.includes('image')
            || kind.includes('shape')
            || kind.includes('solidcolor');
    });
}

function isLegacyReferenceItemGroupLayer(layer: any, doc: any): boolean {
    if (!isTemplateGroupLayer(layer)) return false;
    const bounds = getLayerBoundsRect(layer);
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return false;
    if (isFullCanvasTemplateLayer(bounds, doc)) return false;
    if (!isLegacySkuRegionGeometry(bounds, doc)) return false;
    const name = String(layer?.name || '').trim();
    // 数字组只能作为受约束的 1..N 同级集合被识别，不能因为内含文字和图像就单独变成参考槽。
    if (isPureNumericSkuLayerName(name)) return false;
    if (/背景|background|\bbg\b|底图|底色|白底|装饰|角标|logo|标识|分割|线条|边框|参考|reference|\bref\b|占位|placeholder/i.test(name)) {
        return false;
    }
    return hasReferenceSlotTextChild(layer) && hasReferenceSlotVisualChild(layer);
}

function isLegacySkuReferenceRegionGroupLayer(layer: any, doc: any): boolean {
    if (!isTemplateGroupLayer(layer)) return false;
    const bounds = getLayerBoundsRect(layer);
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return false;
    return isLegacySkuReferenceRegionName(layer?.name) && isLegacySkuRegionGeometry(bounds, doc);
}

function isSkuOrderedPlaceholderLayer(layer: any, doc: any): boolean {
    return isTemplateGroupLayer(layer)
        || isSkuReplacementPlaceholderName(layer?.name)
        || isSkuRectangleReplacementPlaceholderLayer(layer, doc);
}

function collectNamedSkuReplacementPlaceholders(layers: any[], doc: any, result: any[] = [], depth = 0): any[] {
    for (const layer of Array.isArray(layers) ? layers : []) {
        const children = getLayerChildren(layer);
        const name = String(layer?.name || '').trim();
        // 顶层数字组的整体语义由同级 1..N 契约判定，不从单个数字设计容器内递归捡出“伪槽位”。
        // 数字命名的纯色/形状层仍可能是已验收 legacy region；它们必须继续经过矩形区域几何校验。
        if (depth === 0 && isPureNumericSkuLayerName(name) && isTemplateGroupLayer(layer)) continue;
        if (!isSkuPlaceholderContainerName(name)
            && (
                isSkuReplacementPlaceholderName(name)
                || (depth === 0 && isSkuRectangleReplacementPlaceholderLayer(layer, doc))
                || (depth === 0 && isLegacySkuReferenceRegionGroupLayer(layer, doc))
                || (depth === 0 && isLegacyReferenceItemGroupLayer(layer, doc))
            )) {
            result.push(layer);
            continue;
        }
        if (children.length > 0) {
            collectNamedSkuReplacementPlaceholders(children, doc, result, depth + 1);
        }
    }
    return result;
}

function collectTopLevelNumericSkuPlaceholderCandidates(doc: any): SkuReplacementPlaceholder[] {
    const rootLayers: any[] = Array.from(doc?.layers || []);
    const numericLayers = rootLayers
        .filter((layer) => isTemplateGroupLayer(layer) && isPureNumericSkuLayerName(layer?.name))
        .map((layer) => ({
            layer,
            order: Number(String(layer?.name || '').trim())
        }));

    // 单个数字组不构成占位契约：这正是“整页设计容器 3”被误识别的病例。
    if (numericLayers.length < 2) return [];
    numericLayers.sort((left, right) => left.order - right.order);
    if (numericLayers.some((entry, index) => entry.order !== index + 1)) return [];

    const placeholders = numericLayers
        .map((entry) => normalizeSkuReplacementPlaceholder(entry.layer))
        .filter((item): item is SkuReplacementPlaceholder => Boolean(item));
    return placeholders.length === numericLayers.length ? placeholders : [];
}

function collectTopLevelNumericSkuPlaceholders(
    doc: any,
    expectedItemCount?: number
): SkuReplacementPlaceholder[] {
    const placeholders = collectTopLevelNumericSkuPlaceholderCandidates(doc);
    if (placeholders.length === 0) return [];

    const expected = Number(expectedItemCount);
    if (Number.isInteger(expected) && expected > 0 && placeholders.length !== expected) return [];

    const canvasWidth = getDocumentNumber(doc?.width);
    const canvasHeight = getDocumentNumber(doc?.height);
    if (canvasWidth <= 0 || canvasHeight <= 0) return [];
    const hasInvalidGeometry = placeholders.some((placeholder) => (
        isFullCanvasTemplateLayer(placeholder, doc)
        || placeholder.left < -SKU_TEMPLATE_GEOMETRY_TOLERANCE_PX
        || placeholder.top < -SKU_TEMPLATE_GEOMETRY_TOLERANCE_PX
        || placeholder.right > canvasWidth + SKU_TEMPLATE_GEOMETRY_TOLERANCE_PX
        || placeholder.bottom > canvasHeight + SKU_TEMPLATE_GEOMETRY_TOLERANCE_PX
    ));
    if (hasInvalidGeometry) return [];
    const minimumGapPx = Math.max(1, Math.min(8, Math.min(canvasWidth, canvasHeight) * 0.004));

    for (let leftIndex = 0; leftIndex < placeholders.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < placeholders.length; rightIndex += 1) {
            if (skuTemplateRectsOverlap(placeholders[leftIndex], placeholders[rightIndex])) return [];
            if (!skuTemplateRectsRespectMinimumGap(
                placeholders[leftIndex],
                placeholders[rightIndex],
                minimumGapPx
            )) return [];
        }
    }

    const orderBlockers: string[] = [];
    validateSkuTemplatePanelOrder(
        placeholders.map((placeholder, panelIndex) => ({
            layerId: Number(placeholder.layer?.id),
            name: placeholder.name,
            kind: getLayerKindText(placeholder.layer),
            sourceType: 'group_slot' as const,
            panelIndex,
            visible: placeholder.layer?.visible !== false,
            bounds: {
                left: placeholder.left,
                top: placeholder.top,
                right: placeholder.right,
                bottom: placeholder.bottom,
                width: placeholder.width,
                height: placeholder.height
            }
        })),
        orderBlockers
    );
    return orderBlockers.length === 0 ? placeholders : [];
}

function collectOrderedSkuReplacementPlaceholders(
    doc: any,
    expectedItemCount?: number
): SkuReplacementPlaceholder[] {
    const rootLayers = Array.from(doc?.layers || []);
    const container = findSkuPlaceholderContainer(rootLayers);
    if (container) {
        return getLayerChildren(container)
            .filter((layer) => isSkuOrderedPlaceholderLayer(layer, doc))
            .map(normalizeSkuReplacementPlaceholder)
            .filter((item): item is SkuReplacementPlaceholder => Boolean(item));
    }

    const namedPlaceholderLayers = collectNamedSkuReplacementPlaceholders(rootLayers, doc);
    if (namedPlaceholderLayers.length > 0) {
        return namedPlaceholderLayers
            .map(normalizeSkuReplacementPlaceholder)
            .filter((item): item is SkuReplacementPlaceholder => Boolean(item));
    }

    return collectTopLevelNumericSkuPlaceholders(doc, expectedItemCount);
}

function countTemplateLayers(layers: any[], counters = { total: 0, visible: 0 }): { total: number; visible: number } {
    for (const layer of Array.isArray(layers) ? layers : []) {
        counters.total += 1;
        if (layer?.visible !== false) counters.visible += 1;
        const children = getLayerChildren(layer);
        if (children.length > 0) countTemplateLayers(children, counters);
    }
    return counters;
}

function collectSkuTemplateTextObservations(
    layers: any[],
    parentVisible = true,
    result: SkuTemplateTextObservation[] = [],
    counters = { total: 0 }
): { observations: SkuTemplateTextObservation[]; total: number } {
    for (const layer of Array.isArray(layers) ? layers : []) {
        const visible = parentVisible && layer?.visible !== false;
        const kind = getLayerKindText(layer);
        if (kind.includes('text')) {
            const layerId = Number(layer?.id);
            const contents = String(layer?.textItem?.contents || '').trim();
            if (Number.isSafeInteger(layerId)
                && layerId > 0
                && contents) {
                counters.total += 1;
                if (result.length < MAX_SKU_TEMPLATE_TEXT_OBSERVATIONS) {
                    result.push({
                        layerId,
                        name: String(layer?.name || '').trim(),
                        contents: contents.slice(0, 160),
                        contentsTruncated: contents.length > 160,
                        visible
                    });
                }
            }
        }
        const children = getLayerChildren(layer);
        if (children.length > 0) {
            collectSkuTemplateTextObservations(children, visible, result, counters);
        }
    }
    return { observations: result, total: counters.total };
}

function findOpenDocumentByName(documentName?: string): any | null {
    const target = String(documentName || '').trim();
    if (!target) return null;
    for (let i = 0; i < app.documents.length; i++) {
        const doc = app.documents[i];
        if (doc?.name === target) return doc;
    }
    return null;
}

function readSkuRegionDeclaredCapacity(name: string): number | undefined {
    const match = String(name || '').match(/(?:容量|capacity|cap)[\s:：=_-]*(\d{1,2})/i);
    if (!match) return undefined;
    const value = Number(match[1]);
    return Number.isInteger(value) && value > 0 ? value : undefined;
}

function resolveSkuTemplateSlotSourceType(layer: any, doc: any, insidePlaceholderContainer: boolean): SkuTemplateLayoutInspectionSlot['sourceType'] {
    if (insidePlaceholderContainer) {
        return 'group_slot';
    }
    if (isSkuRectangleReplacementPlaceholderLayer(layer, doc)) return 'rectangle_region';
    if (isLegacySkuReferenceRegionGroupLayer(layer, doc)) return 'reference_group';
    if (isLegacyReferenceItemGroupLayer(layer, doc)) return 'reference_group';
    if (isTemplateGroupLayer(layer)) return 'group_slot';
    return 'unknown';
}

function resolveSkuTemplateLayoutInspectionMode(
    doc: any,
    placeholders: SkuReplacementPlaceholder[]
): SkuTemplateLayoutInspectionMode {
    if (placeholders.length === 0) return 'none';
    const container = findSkuPlaceholderContainer(Array.from(doc?.layers || []));
    if (container) return 'ordered_slots';
    const everySlotIsNamedGroup = placeholders.every((placeholder) =>
        isTemplateGroupLayer(placeholder.layer)
        && !isLegacySkuReferenceRegionGroupLayer(placeholder.layer, doc)
        && !isLegacyReferenceItemGroupLayer(placeholder.layer, doc)
    );
    if (everySlotIsNamedGroup) return 'ordered_slots';
    return placeholders.length === 1 ? 'legacy_single_region' : 'legacy_multi_regions';
}

function resolveSkuTemplatePlacementMethod(
    mode: SkuTemplateLayoutInspectionMode
): 'one_to_one_slots' | 'region_composition' | 'unresolved' {
    if (mode === 'ordered_slots') return 'one_to_one_slots';
    if (mode === 'legacy_single_region' || mode === 'legacy_multi_regions') return 'region_composition';
    return 'unresolved';
}

const SKU_TEMPLATE_GEOMETRY_TOLERANCE_PX = 0.5;

function pushSkuTemplateInspectionMessage(messages: string[], message: string): void {
    if (!messages.includes(message)) messages.push(message);
}

function skuTemplateRectsOverlap(
    left: SkuTemplateLayoutInspectionSlot['bounds'],
    right: SkuTemplateLayoutInspectionSlot['bounds']
): boolean {
    const tolerance = SKU_TEMPLATE_GEOMETRY_TOLERANCE_PX;
    return left.left < right.right - tolerance
        && left.right > right.left + tolerance
        && left.top < right.bottom - tolerance
        && left.bottom > right.top + tolerance;
}

function skuTemplateRectsRespectMinimumGap(
    left: SkuTemplateLayoutInspectionSlot['bounds'],
    right: SkuTemplateLayoutInspectionSlot['bounds'],
    minimumGapPx: number
): boolean {
    const expansion = Math.max(0, minimumGapPx) / 2;
    return !skuTemplateRectsOverlap(
        {
            left: left.left - expansion,
            top: left.top - expansion,
            right: left.right + expansion,
            bottom: left.bottom + expansion,
            width: left.width + expansion * 2,
            height: left.height + expansion * 2
        },
        {
            left: right.left - expansion,
            top: right.top - expansion,
            right: right.right + expansion,
            bottom: right.bottom + expansion,
            width: right.width + expansion * 2,
            height: right.height + expansion * 2
        }
    );
}

function getSkuTemplateRectCenter(bounds: SkuTemplateLayoutInspectionSlot['bounds']): {
    x: number;
    y: number;
} {
    return {
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2
    };
}

function validateSkuTemplatePanelOrder(
    slots: SkuTemplateLayoutInspectionSlot[],
    blockers: string[]
): void {
    if (slots.length <= 1) return;
    const minimumHeight = Math.max(1, Math.min(...slots.map((slot) => slot.bounds.height)));
    const rowTolerance = Math.max(4, minimumHeight * 0.18);

    for (let index = 1; index < slots.length; index += 1) {
        const previous = slots[index - 1];
        const current = slots[index];
        const previousCenter = getSkuTemplateRectCenter(previous.bounds);
        const currentCenter = getSkuTemplateRectCenter(current.bounds);
        const sharedVerticalBand = Math.min(previous.bounds.bottom, current.bounds.bottom)
            - Math.max(previous.bounds.top, current.bounds.top);
        const sameRow = sharedVerticalBand > Math.min(previous.bounds.height, current.bounds.height) * 0.25
            || Math.abs(previousCenter.y - currentCenter.y) <= rowTolerance;

        if (sameRow && currentCenter.x <= previousCenter.x + SKU_TEMPLATE_GEOMETRY_TOLERANCE_PX) {
            pushSkuTemplateInspectionMessage(
                blockers,
                `模板槽位面板顺序与画面顺序不一致：同一行的“${previous.name}”必须位于“${current.name}”左侧。`
            );
            continue;
        }
        if (!sameRow && currentCenter.y <= previousCenter.y + rowTolerance) {
            pushSkuTemplateInspectionMessage(
                blockers,
                `模板槽位面板顺序与画面顺序不一致：“${current.name}”没有位于“${previous.name}”的下一行。`
            );
        }
    }
}

function validateSkuTemplateLayoutGeometry(input: {
    doc: any;
    mode: SkuTemplateLayoutInspectionMode;
    slots: SkuTemplateLayoutInspectionSlot[];
    expectedItemCount?: number;
}): { blockers: string[]; warnings: string[] } {
    const blockers: string[] = [];
    const warnings: string[] = [];
    const canvasWidth = getDocumentNumber(input.doc?.width);
    const canvasHeight = getDocumentNumber(input.doc?.height);
    const expectedValue = Number(input.expectedItemCount);
    const hasExpectedItemCount = input.expectedItemCount !== undefined;
    const expectedItemCount = Number.isInteger(expectedValue) && expectedValue > 0
        ? expectedValue
        : 0;
    const minimumOrderedSlotGapPx = canvasWidth > 0 && canvasHeight > 0
        ? Math.max(1, Math.min(8, Math.min(canvasWidth, canvasHeight) * 0.004))
        : 1;

    if (canvasWidth <= 0 || canvasHeight <= 0) {
        blockers.push('SKU 模板缺少有效画布尺寸，不能验证占位区域。');
    }
    if (hasExpectedItemCount && expectedItemCount <= 0) {
        blockers.push('SKU 模板检查的 expectedItemCount 必须是大于 0 的整数。');
    }

    for (const slot of input.slots) {
        const bounds = slot.bounds;
        if (bounds.width <= 0 || bounds.height <= 0) {
            pushSkuTemplateInspectionMessage(blockers, `模板槽位“${slot.name}”缺少有效矩形边界。`);
            continue;
        }
        if (input.mode === 'ordered_slots' && isFullCanvasTemplateLayer(bounds, input.doc)) {
            pushSkuTemplateInspectionMessage(
                blockers,
                `顺序槽“${slot.name}”接近占满整个画布，不能作为独立 SKU 占位。`
            );
        }
        if (
            canvasWidth > 0
            && canvasHeight > 0
            && (
                bounds.left < -SKU_TEMPLATE_GEOMETRY_TOLERANCE_PX
                || bounds.top < -SKU_TEMPLATE_GEOMETRY_TOLERANCE_PX
                || bounds.right > canvasWidth + SKU_TEMPLATE_GEOMETRY_TOLERANCE_PX
                || bounds.bottom > canvasHeight + SKU_TEMPLATE_GEOMETRY_TOLERANCE_PX
            )
        ) {
            pushSkuTemplateInspectionMessage(
                blockers,
                `模板槽位“${slot.name}”超出 ${Math.round(canvasWidth)}x${Math.round(canvasHeight)}px 画布。`
            );
        }
    }

    for (let leftIndex = 0; leftIndex < input.slots.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < input.slots.length; rightIndex += 1) {
            const left = input.slots[leftIndex];
            const right = input.slots[rightIndex];
            if (skuTemplateRectsOverlap(left.bounds, right.bounds)) {
                pushSkuTemplateInspectionMessage(
                    blockers,
                    `模板槽位“${left.name}”与“${right.name}”互相重叠，不能形成确定性排版。`
                );
            } else if (
                input.mode === 'ordered_slots'
                && !skuTemplateRectsRespectMinimumGap(
                    left.bounds,
                    right.bounds,
                    minimumOrderedSlotGapPx
                )
            ) {
                pushSkuTemplateInspectionMessage(
                    blockers,
                    `模板槽位“${left.name}”与“${right.name}”间距不足 `
                    + `${minimumOrderedSlotGapPx.toFixed(1)}px。`
                );
            }
        }
    }

    if (input.mode === 'ordered_slots') {
        if (expectedItemCount > 0 && input.slots.length !== expectedItemCount) {
            blockers.push(
                `顺序占位模板需要 ${expectedItemCount} 个一色一槽，占位数实际为 ${input.slots.length}。`
            );
        }
        const invalidDeclaredSlot = input.slots.find((slot) => (
            slot.declaredCapacity !== undefined && slot.declaredCapacity !== 1
        ));
        if (invalidDeclaredSlot) {
            blockers.push(`顺序占位槽“${invalidDeclaredSlot.name}”的声明容量必须为 1。`);
        }
        validateSkuTemplatePanelOrder(input.slots, blockers);
    } else if (input.mode === 'legacy_single_region') {
        if (input.slots.length !== 1) {
            blockers.push('单区域组合模板必须只包含一个合法矩形区域。');
        }
        const declaredCapacity = input.slots[0]?.declaredCapacity;
        if (
            expectedItemCount > 0
            && declaredCapacity !== undefined
            && declaredCapacity !== expectedItemCount
        ) {
            blockers.push(
                `单区域“${input.slots[0].name}”声明容量为 ${declaredCapacity}，`
                + `与本次 ${expectedItemCount} 个颜色不一致。`
            );
        }
        if (expectedItemCount > 1 && input.slots.length === 1) {
            warnings.push(
                `单个区域将由确定性算法拆分为 ${expectedItemCount} 个子槽，不要求模板预先存在 ${expectedItemCount} 个物理槽。`
            );
        }
    } else if (input.mode === 'legacy_multi_regions') {
        if (expectedItemCount > 0 && expectedItemCount < input.slots.length) {
            blockers.push(
                `${expectedItemCount} 个颜色无法分配到 ${input.slots.length} 个必须非空的模板区域。`
            );
        }
        const declaredCapacities = input.slots.map((slot) => slot.declaredCapacity);
        const declaredCount = declaredCapacities.filter((capacity) => capacity !== undefined).length;
        if (declaredCount > 0 && declaredCount !== input.slots.length) {
            blockers.push('多区域模板的容量声明不完整：必须全部声明或全部交由布局计划求解。');
        } else if (declaredCount === input.slots.length && expectedItemCount > 0) {
            const declaredTotal = declaredCapacities.reduce<number>(
                (sum, capacity) => sum + Number(capacity || 0),
                0
            );
            if (declaredTotal !== expectedItemCount) {
                blockers.push(
                    `多区域模板声明容量总和为 ${declaredTotal}，与本次 ${expectedItemCount} 个颜色不一致。`
                );
            }
        }
        validateSkuTemplatePanelOrder(input.slots, blockers);
    }

    return { blockers, warnings };
}

function buildTemplateLayoutInspection(doc: any, expectedItemCount?: number): {
    schema: 'sku-template-layout-inspection/v3';
    templateName: string;
    historyStateRef: PhotoshopHistoryStateRef;
    mode: SkuTemplateLayoutInspectionMode;
    slotCount: number;
    expectedItemCount?: number;
    placementMethod: 'one_to_one_slots' | 'region_composition' | 'unresolved';
    supportsMultiColorInSingleRegion: boolean;
    supportsMultiColorPerRegion: boolean;
    slots: SkuTemplateLayoutInspectionSlot[];
    blockers: string[];
    warnings: string[];
    inspectedLayerCount: number;
    visibleLayerCount: number;
    textObservations: SkuTemplateTextObservation[];
    textObservationCount: number;
    textObservationsTruncated: boolean;
    boundaries: { writesPhotoshop: false; claimsDesignQuality: false };
} {
    const rootLayers = Array.from(doc?.layers || []);
    const counters = countTemplateLayers(rootLayers);
    const historyStateRef = readActiveHistoryStateRef(doc);
    if (!historyStateRef) {
        throw new Error('无法读取 SKU 模板的 Photoshop 历史版本，未返回可能过期的结构与文字观察。');
    }
    const textObservationResult = collectSkuTemplateTextObservations(rootLayers);
    const governedPlaceholders = collectOrderedSkuReplacementPlaceholders(doc, expectedItemCount);
    // inspect 必须把“看起来像 1..N，但几何/数量不合法”的候选集合带入验证，
    // 否则只会返回“0 槽”，无法指明重叠、越界或数量冲突的根因。
    const placeholders = governedPlaceholders.length > 0
        ? governedPlaceholders
        : collectTopLevelNumericSkuPlaceholderCandidates(doc);
    const placeholderContainer = findSkuPlaceholderContainer(rootLayers);
    const slots = placeholders.map((placeholder, index) => {
        const declaredCapacity = readSkuRegionDeclaredCapacity(placeholder.name);
        return {
            ...(Number.isFinite(Number(placeholder.layer?.id)) ? { layerId: Number(placeholder.layer.id) } : {}),
            name: placeholder.name,
            kind: getLayerKindText(placeholder.layer),
            sourceType: resolveSkuTemplateSlotSourceType(placeholder.layer, doc, Boolean(placeholderContainer)),
            panelIndex: index,
            ...(declaredCapacity ? { declaredCapacity } : {}),
            visible: placeholder.layer?.visible !== false,
            bounds: {
                left: placeholder.left,
                top: placeholder.top,
                right: placeholder.right,
                bottom: placeholder.bottom,
                width: placeholder.width,
                height: placeholder.height
            }
        };
    });
    const expected = Number(expectedItemCount || 0);
    const mode: SkuTemplateLayoutInspectionMode = resolveSkuTemplateLayoutInspectionMode(doc, placeholders);
    const placementMethod = resolveSkuTemplatePlacementMethod(mode);
    const supportsMultiColorInSingleRegion = mode === 'legacy_single_region';
    const supportsMultiColorPerRegion = placementMethod === 'region_composition';
    const blockers = slots.length > 0
        ? []
        : ['模板没有识别到可用 SKU 占位槽。'];
    const warnings: string[] = [];
    const geometryValidation = validateSkuTemplateLayoutGeometry({
        doc,
        mode,
        slots,
        expectedItemCount
    });
    geometryValidation.blockers.forEach((message) => pushSkuTemplateInspectionMessage(blockers, message));
    geometryValidation.warnings.forEach((message) => pushSkuTemplateInspectionMessage(warnings, message));
    if (mode === 'legacy_single_region' && expected > 1) {
        warnings.push('模板使用单个参考区域承载整组 SKU，导出后需要复核组合内部间距。');
    }
    if (mode === 'legacy_multi_regions') {
        warnings.push('模板使用多个矩形组合区域；执行前必须形成显式区域容量计划并保留当前区域结构。');
    }

    return {
        schema: 'sku-template-layout-inspection/v3',
        templateName: String(doc?.name || ''),
        historyStateRef,
        mode,
        placementMethod,
        slotCount: slots.length,
        ...(expected > 0 ? { expectedItemCount: expected } : {}),
        supportsMultiColorInSingleRegion,
        supportsMultiColorPerRegion,
        slots,
        blockers,
        warnings,
        inspectedLayerCount: counters.total,
        visibleLayerCount: counters.visible,
        textObservations: textObservationResult.observations,
        textObservationCount: textObservationResult.total,
        textObservationsTruncated: textObservationResult.total > textObservationResult.observations.length,
        boundaries: {
            writesPhotoshop: false,
            claimsDesignQuality: false
        }
    };
}

type SkuTemplateGutter = {
    gutterPx: number;
    basis: string;
};

/**
 * 从模板本身量出「沟槽宽度」，供矩形占位的区域模型在区域内分槽时使用。
 *
 * 矩形占位是「一个矩形 = 一整行」：矩形只声明外框，不声明行内怎么分。此前引擎按
 * region.width * 2.5% 估间距，于是同一张成品里「区域内的间距」（引擎估）与「区域之间
 * 的间距」（模板定）是两套口径，必然对不齐——2026-08-18 真机 4双装 1386px 宽的区域
 * 估出 34.65px，比模板自己的留白宽，用户看到上排 3 张排得比下排松。
 *
 * 这里改成只用模板已经给出的证据，按可信度取：
 *   ① 相邻占位区域之间的实际间隙——设计师亲手摆出来的沟槽；
 *   ② 占位区域到画布边缘的留白——设计师的留白语言。
 * 两者都量不出来才返回 null，由调用方回落到旧的比例估算。
 */
function resolveSkuTemplateGutterPx(input: {
    placeholders: SkuReplacementPlaceholder[];
    canvasWidth: number;
    canvasHeight: number;
}): SkuTemplateGutter | null {
    const boxes = (input.placeholders || []).filter((item) => item && item.width > 0 && item.height > 0);
    if (boxes.length === 0) return null;

    const gaps: number[] = [];
    for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i];
            const b = boxes[j];
            const horizontal = Math.max(a.left - b.right, b.left - a.right);
            const vertical = Math.max(a.top - b.bottom, b.top - a.bottom);
            for (const gap of [horizontal, vertical]) {
                if (Number.isFinite(gap) && gap > 0.5) gaps.push(gap);
            }
        }
    }
    if (gaps.length > 0) {
        return { gutterPx: Math.min(...gaps), basis: '模板中相邻占位区域之间的间隙' };
    }

    const canvasWidth = Number(input.canvasWidth) || 0;
    const canvasHeight = Number(input.canvasHeight) || 0;
    if (canvasWidth <= 0 || canvasHeight <= 0) return null;

    const margins: number[] = [];
    for (const box of boxes) {
        for (const margin of [box.left, box.top, canvasWidth - box.right, canvasHeight - box.bottom]) {
            if (Number.isFinite(margin) && margin > 0.5) margins.push(margin);
        }
    }
    if (margins.length > 0) {
        return { gutterPx: Math.min(...margins), basis: '模板中占位区域到画布边缘的留白' };
    }
    return null;
}

function resolveSkuRegionCapacities(input: {
    mode: SkuTemplateLayoutInspectionMode;
    slotCount: number;
    comboSize: number;
    requested?: number[];
}): number[] {
    if (input.mode === 'ordered_slots') {
        if (input.slotCount !== input.comboSize) {
            throw new Error(`顺序占位模板需要 ${input.comboSize} 个一色一槽，占位数实际为 ${input.slotCount}。`);
        }
        return Array.from({ length: input.slotCount }, () => 1);
    }
    if (input.mode === 'legacy_single_region') {
        if (input.slotCount !== 1) throw new Error('单区域组合模板没有识别到唯一矩形区域。');
        return [input.comboSize];
    }
    if (input.mode === 'legacy_multi_regions') {
        const requested = Array.isArray(input.requested)
            ? input.requested.map((value) => Number(value))
            : [];
        const valid = requested.length === input.slotCount
            && requested.every((value) => Number.isInteger(value) && value > 0)
            && requested.reduce((sum, value) => sum + value, 0) === input.comboSize;
        if (!valid) {
            throw new Error(
                `旧版矩形区域模板必须提供 regionCapacities；需要 ${input.slotCount} 个正整数且总和为 ${input.comboSize}，`
                + `当前为 [${requested.join(', ')}]。请先 inspectTemplateLayout，再由 SKU TemplateLayoutPlan 根据区域 bounds 或视觉观察确认容量。`
            );
        }
        return requested;
    }
    throw new Error('模板没有识别到可执行的 SKU 占位结构。');
}

type SkuPlaceholderMismatchData = {
    schema: 'sku-placeholder-mismatch/v1';
    reason: 'placeholder_slot_count_mismatch';
    mode: SkuTemplateLayoutInspectionMode;
    slotCount: number;
    requiredCount: number;
    combo: string[];
    templateDocName: string;
    resolutions: string[];
};

type SkuPlaceholderMismatchCarrier = Error & { skuPlaceholderMismatch?: SkuPlaceholderMismatchData };

function buildSkuPlaceholderMismatchResolutions(requiredCount: number, mode?: SkuTemplateLayoutInspectionMode): string[] {
    // 真机病例（2026-07-07）：用户的 4双装.tif 是 6.0 区域式设计（少量参考区域承载整组多色
    // 水平分布），Agent 按出路①补槽，用 2×2 网格盖掉了用户的设计构图。模板已有参考区域
    //（legacy 模式）时，"这是区域分布设计"的可能性排第一，改用户模板结构的补槽必须垫底并先确认。
    if (mode === 'legacy_single_region' || mode === 'legacy_multi_regions') {
        return [
            `出路① 区域容量计划：用 inspectTemplateLayout 读取区域 bounds 与面板顺序，由 TemplateLayoutPlan 形成总和为 ${requiredCount} 的 regionCapacities；高置信计划可执行，中低置信先看截图确认。`,
            '出路② 调整现有区域：使用 inspectTemplateLayout 返回的 layerId 调用 transformLayer，保留 6.0 区域式模板结构，调整后再次检查。',
            `出路③ 换模板或转换方法：用 openTemplate 打开正确规格模板；只有用户明确要一色一槽时，才用 createSkuPlaceholders 创建 ${requiredCount} 个 ordered_slots。`
        ];
    }
    return [
        `出路① 创建顺序槽：确认模板本意是一色一槽后，调用 createSkuPlaceholders（placementMethod=ordered_slots）创建 ${requiredCount} 个槽并复验。`,
        '出路② 区域组合模式：若模板本意是一个或多个矩形区域承载多色，先用 inspectTemplateLayout 确认 legacy 模式，再形成显式 regionCapacities。',
        `出路③ 换模板：用 openTemplate 打开与颜色数量匹配的规格模板（如「${requiredCount}双装」），读取返回的 documentName 作为 templateDocName 后重试。`
    ];
}

/**
 * 占位槽数量与配色数量不匹配的结构化错误。
 *
 * 错误文本自带三条可达出路，同时把 mode/slotCount/requiredCount/combo/templateDocName
 * 挂在 error.skuPlaceholderMismatch 上，由 catch 出口回传到 ToolResult.data，
 * 让模型拿到机器可读的失败上下文而不是只有一句文案。
 */
function createSkuPlaceholderMismatchError(input: {
    headline: string;
    templateDoc: any;
    slotCount: number;
    requiredCount: number;
    combo: string[];
}): SkuPlaceholderMismatchCarrier {
    const resolvedMode = resolveSkuTemplateLayoutInspectionMode(
        input.templateDoc,
        collectOrderedSkuReplacementPlaceholders(input.templateDoc, input.requiredCount)
    );
    const resolutions = buildSkuPlaceholderMismatchResolutions(input.requiredCount, resolvedMode);
    const data: SkuPlaceholderMismatchData = {
        schema: 'sku-placeholder-mismatch/v1',
        reason: 'placeholder_slot_count_mismatch',
        mode: resolvedMode,
        slotCount: input.slotCount,
        requiredCount: input.requiredCount,
        combo: [...input.combo],
        templateDocName: String(input.templateDoc?.name || ''),
        resolutions
    };
    const error = new Error(`${input.headline} ${resolutions.join(' ')}`) as SkuPlaceholderMismatchCarrier;
    error.skuPlaceholderMismatch = data;
    return error;
}

function extractSkuPlaceholderMismatchData(error: unknown): SkuPlaceholderMismatchData | null {
    const carrier = error as SkuPlaceholderMismatchCarrier | null;
    const data = carrier?.skuPlaceholderMismatch;
    if (!data || data.schema !== 'sku-placeholder-mismatch/v1') return null;
    return data;
}

type SkuPlaceholderVisibilitySnapshot = {
    layer: any;
    visible: boolean;
};

function hideSkuReplacementPlaceholder(
    layer: any,
    visibilitySnapshots?: SkuPlaceholderVisibilitySnapshot[]
): void {
    try {
        if (!layer) return;
        if (visibilitySnapshots) {
            const layerId = Number(layer.id);
            const alreadyRecorded = visibilitySnapshots.some((snapshot) => {
                const snapshotLayerId = Number(snapshot.layer?.id);
                if (Number.isFinite(layerId) && Number.isFinite(snapshotLayerId)) {
                    return layerId === snapshotLayerId;
                }
                return snapshot.layer === layer;
            });
            if (!alreadyRecorded) {
                visibilitySnapshots.push({
                    layer,
                    visible: layer.visible !== false
                });
            }
        }
        layer.visible = false;
    } catch (error: any) {
        console.warn(`[SKULayout] 隐藏占位符失败: ${layer?.name || 'unknown'} - ${error?.message || error}`);
    }
}

function parseOrderedSkuColorNameSequence(value: string): string[] {
    const normalized = String(value || '')
        .trim()
        .replace(/｜/g, '|')
        .replace(/＋/g, '+')
        .replace(/[，、；;,]/g, '+')
        .replace(/\s+/g, '+');

    if (!normalized) return [];

    const parts = /[+|]/.test(normalized)
        ? normalized.split(/[+|]+/)
        : /^\d+$/.test(normalized)
            ? normalized.split('')
            : [normalized];

    return parts
        .map((part) => String(part || '').trim())
        .filter(Boolean);
}

function normalizeSkuExportFileName(value: string, fallback: string): string {
    const cleaned = String(value || '')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
        .replace(/\s+/g, '')
        .replace(/-+/g, '-')
        .replace(/^[.\-\s]+|[.\-\s]+$/g, '')
        .trim();
    return cleaned || fallback;
}

/**
 * 组合图交付文件名 = 序号 + 颜色组合，例如「1白色+黑色」「2白色+白色」。
 *
 * 用户命名规范：序号在同一规格目录内从 1 连续递增，便于按顺序核对与上架。
 * comboOrder 必须是「跨批次的全局序号」——组合图按 maxRowsPerToolCall 分批执行，
 * 批次内下标每批都从 0 重来，只用批内下标会让第二批又从「1」开始、同目录出现重复序号。
 * 调用方用 batch.rowStartIndex 换算，见 config.comboStartIndex。
 */
function buildSkuComboExportFileName(combo: string[], comboOrder: number, usedNames: Set<string>): string {
    const colorPart = normalizeSkuExportFileName(combo.join('+'), '');
    // 颜色名被清洗成空时退回「组合N」，不产出只剩数字的文件名
    const baseName = colorPart ? `${comboOrder}${colorPart}` : `组合${comboOrder}`;
    let outputName = baseName;
    let duplicateIndex = 2;
    while (usedNames.has(outputName.toLowerCase())) {
        outputName = `${baseName}-${duplicateIndex}`;
        duplicateIndex += 1;
    }
    usedNames.add(outputName.toLowerCase());
    return outputName;
}

function getLayerKindText(layer: any): string {
    const kind = layer?.kind;
    if (typeof kind === 'string') return kind.toLowerCase();
    if (typeof kind === 'number') return String(kind);
    if (kind && typeof kind === 'object') {
        return String(kind.value ?? kind._value ?? kind).toLowerCase();
    }
    return '';
}

function isTemplateGroupLayer(layer: any): boolean {
    const kind = getLayerKindText(layer);
    return kind === 'group' || kind.includes('group') || getLayerChildren(layer).length > 0;
}

function getDocumentNumber(value: any): number {
    const num = Number(value?.value ?? value);
    return Number.isFinite(num) ? num : 0;
}

function isFullCanvasTemplateLayer(bounds: SkuAutoLayoutRect, doc: any): boolean {
    const canvasWidth = getDocumentNumber(doc?.width);
    const canvasHeight = getDocumentNumber(doc?.height);
    if (canvasWidth <= 0 || canvasHeight <= 0) return false;
    return bounds.width >= canvasWidth * 0.92 && bounds.height >= canvasHeight * 0.92;
}

function isExplicitSkuPlaceholderTemplateLayerName(name: string): boolean {
    return /占位符?|placeholder|place[\s_-]*holder|sku[\s_-]*(?:slot|place|placeholder)|产品位|图片位|颜色位|图位/i.test(name);
}

function isLegacySkuRegionGeometry(bounds: SkuAutoLayoutRect, doc: any): boolean {
    if (isFullCanvasTemplateLayer(bounds, doc)) return false;

    const canvasWidth = getDocumentNumber(doc?.width);
    const canvasHeight = getDocumentNumber(doc?.height);
    if (canvasWidth <= 0 || canvasHeight <= 0) {
        return bounds.width >= 120 && bounds.height >= 160;
    }

    const widthRatio = bounds.width / canvasWidth;
    const heightRatio = bounds.height / canvasHeight;
    const areaRatio = (bounds.width * bounds.height) / Math.max(1, canvasWidth * canvasHeight);
    const aspect = bounds.width / Math.max(1, bounds.height);

    if (areaRatio < 0.045 || areaRatio > 0.82) return false;
    if (widthRatio < 0.08 || heightRatio < 0.18) return false;
    if (aspect < 0.18 || aspect > 5) return false;
    return true;
}

function isLegacyTopLevelSkuPlaceholderTemplateLayer(layer: any, bounds: SkuAutoLayoutRect, doc: any, depth: number): boolean {
    if (depth !== 0) return false;
    const name = String(layer?.name || '').trim();
    const kind = getLayerKindText(layer);
    if (layer?.isBackgroundLayer === true || kind === 'background') return false;
    if (kind.includes('text')) return false;
    if (/标题|文案|文字|说明|价格|角标|logo|标识|装饰|参考|背景|底图|白底|底板|分割|线条|边框/i.test(name)) return false;
    if (!isLegacySkuRegionGeometry(bounds, doc)) return false;
    const legacyShapeName = /^(矩形|矩形\s*\d+|rectangle|rect|shape)\b|\b(rectangle|rect|placeholder\s*box)\b/i.test(name);
    const shapeKind = /shape|solidcolorlayer|contentlayer/i.test(kind);
    return legacyShapeName || shapeKind;
}

function isAuxiliaryTemplateLayer(layer: any, bounds: SkuAutoLayoutRect, doc: any, depth: number): boolean {
    const name = String(layer?.name || '').trim();
    const kind = getLayerKindText(layer);
    if (layer?.isBackgroundLayer === true || kind === 'background') return true;
    if (isFullCanvasTemplateLayer(bounds, doc)) return true;
    if (isExplicitSkuPlaceholderTemplateLayerName(name)) return true;
    if (isLegacyTopLevelSkuPlaceholderTemplateLayer(layer, bounds, doc, depth)) return true;
    return /背景|background|\bbg\b|参考|reference|\bref\b|底图|底色|白底/i.test(name);
}

function collectVisibleSkuTemplateObstacles(
    layers: any[],
    doc: any,
    parentVisible = true,
    depth = 0
): SkuAutoLayoutObstacle[] {
    const obstacles: SkuAutoLayoutObstacle[] = [];

    for (const layer of Array.isArray(layers) ? layers : []) {
        const visible = parentVisible && layer?.visible !== false && layer?.isVisible !== false;
        if (!visible) continue;

        if (isTemplateGroupLayer(layer)) {
            obstacles.push(...collectVisibleSkuTemplateObstacles(getLayerChildren(layer), doc, visible, depth + 1));
            continue;
        }

        const bounds = getLayerBoundsRect(layer);
        if (!bounds || bounds.width <= 0 || bounds.height <= 0) continue;
        if (isAuxiliaryTemplateLayer(layer, bounds, doc, depth)) continue;

        obstacles.push({
            id: String(layer?.id || layer?.name || `template-obstacle-${obstacles.length + 1}`),
            role: String(layer?.kind || 'template-element'),
            locked: layer?.locked === true,
            bounds
        });
    }

    return obstacles;
}

function normalizeSkuLayoutDiagnosticList(value: any): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => String(item || '').trim())
        .filter(Boolean);
}

function formatSkuAutoLayoutSummaryDiagnostic(plan: any): string {
    const summary = plan?.summary || plan?.diagnostics?.summary;
    if (!summary || typeof summary !== 'object') return '';

    const itemCount = Number(summary.itemCount || 0);
    const obstacleCount = Number(summary.obstacleCount || 0);
    const freeRegionCount = Number(summary.freeRegionCount || 0);
    const largest = summary.largestFreeRegion || {};
    const largestWidth = Math.round(Number(largest.width || 0));
    const largestHeight = Math.round(Number(largest.height || 0));
    const likelyBlockers = Array.isArray(summary.likelyBlockers)
        ? summary.likelyBlockers.map((item: any) => String(item || '').trim()).filter(Boolean)
        : [];

    if (likelyBlockers.includes('no_free_region')) {
        return `自动排版诊断：模板安全区没有可用空闲区域，已识别 ${obstacleCount} 个需避让元素。`;
    }
    if (likelyBlockers.includes('high_item_count_needs_more_canvas_area')) {
        return `自动排版诊断：SKU 数量 ${itemCount} 较多，当前画布可用面积不足以保持最小缩放和间距。`;
    }
    if (likelyBlockers.includes('free_regions_are_fragmented')) {
        return `自动排版诊断：模板可用区域被切成 ${freeRegionCount} 个小区域，最大区域约 ${largestWidth}x${largestHeight}px。`;
    }
    if (likelyBlockers.includes('template_obstacles_consume_safe_area')) {
        return `自动排版诊断：模板元素占用了大部分安全区，最大空闲区域约 ${largestWidth}x${largestHeight}px。`;
    }
    if (freeRegionCount > 0) {
        return `自动排版诊断：已识别 ${freeRegionCount} 个空闲区域，最大区域约 ${largestWidth}x${largestHeight}px，需避让元素 ${obstacleCount} 个。`;
    }
    return '';
}

function buildSkuLayoutPrimaryFailureReason(input: {
    errors?: string[];
    autoLayoutPlans?: any[];
    noteAutoLayoutPlans?: any[];
    fallback?: string;
}): string {
    const diagnostics: string[] = [];
    diagnostics.push(...normalizeSkuLayoutDiagnosticList(input.errors));

    const planGroups = [
        ...(Array.isArray(input.autoLayoutPlans) ? input.autoLayoutPlans : []),
        ...(Array.isArray(input.noteAutoLayoutPlans) ? input.noteAutoLayoutPlans : [])
    ];
    for (const plan of planGroups) {
        const blockers = normalizeSkuLayoutDiagnosticList(plan?.blockers);
        for (const blocker of blockers) {
            diagnostics.push(`自动排版计划未通过：${blocker}`);
        }
        const summaryDiagnostic = formatSkuAutoLayoutSummaryDiagnostic(plan);
        if (summaryDiagnostic) diagnostics.push(summaryDiagnostic);
    }

    const uniqueDiagnostics = Array.from(new Set(diagnostics));
    if (uniqueDiagnostics.length > 0) return uniqueDiagnostics.slice(0, 3).join('；');
    return input.fallback || '未导出任何文件';
}

async function applySkuAutoLayoutPlan(
    doc: any,
    plan: SkuAutoLayoutPlan,
    options: {
        obstacles?: SkuAutoLayoutObstacle[];
        expectedItemCount?: number;
        expectedTopLevelLayerIds?: number[];
    } = {}
): Promise<{ applied: number; warnings: string[]; autoLayoutQa: SkuAutoLayoutQaResult }> {
    const warnings: string[] = [];
    const actualPlacements: SkuAutoLayoutActualPlacement[] = [];
    const topLevelLayerIds = new Set<number>(
        Array.from(doc?.layers || [])
            .map((layer: any) => Number(layer?.id))
            .filter(Number.isFinite)
    );
    const successfullyAppliedLayerIds = new Set<number>();
    const documentId = Number(doc?.id);
    if (!Number.isFinite(documentId)) {
        throw new Error('SKU 自动排版缺少有效模板 documentId，不能执行实时边界 QA。');
    }
    let applied = 0;

    for (const placement of plan.placements) {
        const layerId = Number(placement.layerId);
        if (!Number.isFinite(layerId)) {
            warnings.push(`缺少图层 ID，跳过 ${placement.itemId}`);
            continue;
        }

        if (!topLevelLayerIds.has(layerId)) {
            warnings.push(`计划中的图层 ${layerId} 不是模板顶层颜色卡，已拒绝对子层重复排版`);
            continue;
        }

        const beforeReadback = await readLiveSkuLayerBounds(documentId, layerId);
        const beforeBounds = beforeReadback.bounds;
        if (!beforeBounds || beforeBounds.width <= 0 || beforeBounds.height <= 0) {
            warnings.push(`图层 ${layerId} 缺少有效实时边界`);
            continue;
        }

        const usesUniformOuterWidth = placement.sizingPolicy === 'uniform-width-contain';
        const beforeLayoutBounds = usesUniformOuterWidth
            ? beforeBounds
            : (beforeReadback.subjectBounds || beforeBounds);
        const scale = usesUniformOuterWidth
            ? placement.destinationBox.width / beforeLayoutBounds.width
            : Math.min(
                placement.destinationBox.width / beforeLayoutBounds.width,
                placement.destinationBox.height / beforeLayoutBounds.height
            );

        if (Number.isFinite(scale) && scale > 0 && Math.abs(scale - 1) > 0.01) {
            await batchPlayResize(documentId, layerId, scale * 100);
        }

        const afterScaleReadback = await readLiveSkuLayerBounds(documentId, layerId);
        const afterScaleBounds = afterScaleReadback.bounds;
        if (!afterScaleBounds || afterScaleBounds.width <= 0 || afterScaleBounds.height <= 0) {
            warnings.push(`图层 ${layerId} 缩放后缺少有效实时边界`);
            continue;
        }

        const afterScaleLayoutBounds = usesUniformOuterWidth
            ? afterScaleBounds
            : (afterScaleReadback.subjectBounds || afterScaleBounds);
        const expectedScaledWidth = beforeLayoutBounds.width * scale;
        const expectedScaledHeight = beforeLayoutBounds.height * scale;
        const scaleTolerancePx = Math.max(
            2,
            Math.max(expectedScaledWidth, expectedScaledHeight) * 0.02
        );
        if (
            Math.abs(afterScaleLayoutBounds.width - expectedScaledWidth) > scaleTolerancePx
            || Math.abs(afterScaleLayoutBounds.height - expectedScaledHeight) > scaleTolerancePx
        ) {
            throw new Error(
                `SKU 图层 ${layerId} 缩放写入未生效：`
                + `期望约 ${expectedScaledWidth.toFixed(1)}x${expectedScaledHeight.toFixed(1)}，`
                + `实时读回 ${afterScaleLayoutBounds.width.toFixed(1)}x${afterScaleLayoutBounds.height.toFixed(1)}。`
            );
        }
        const currentCenterX = afterScaleLayoutBounds.left + afterScaleLayoutBounds.width / 2;
        const currentCenterY = afterScaleLayoutBounds.top + afterScaleLayoutBounds.height / 2;
        const targetCenterX = placement.destinationBox.left + placement.destinationBox.width / 2;
        const targetCenterY = placement.destinationBox.top + placement.destinationBox.height / 2;
        const offsetX = targetCenterX - currentCenterX;
        const offsetY = targetCenterY - currentCenterY;

        if (Math.abs(offsetX) > 0.5 || Math.abs(offsetY) > 0.5) {
            await batchPlayTranslate(documentId, layerId, offsetX, offsetY);
        }

        const afterPositionReadback = await readLiveSkuLayerBounds(documentId, layerId);
        const afterPositionBounds = usesUniformOuterWidth
            ? afterPositionReadback.bounds
            : (afterPositionReadback.subjectBounds || afterPositionReadback.bounds);
        if (!afterPositionBounds) {
            throw new Error(`SKU 图层 ${layerId} 移动后缺少有效实时边界。`);
        }
        const positionedCenterX = afterPositionBounds.left + afterPositionBounds.width / 2;
        const positionedCenterY = afterPositionBounds.top + afterPositionBounds.height / 2;
        const positionTolerancePx = Math.max(
            2,
            Math.min(placement.destinationBox.width, placement.destinationBox.height) * 0.01
        );
        if (
            Math.abs(positionedCenterX - targetCenterX) > positionTolerancePx
            || Math.abs(positionedCenterY - targetCenterY) > positionTolerancePx
        ) {
            throw new Error(
                `SKU 图层 ${layerId} 移动写入未生效：`
                + `目标中心 (${targetCenterX.toFixed(1)}, ${targetCenterY.toFixed(1)})，`
                + `实时读回 (${positionedCenterX.toFixed(1)}, ${positionedCenterY.toFixed(1)})。`
            );
        }

        successfullyAppliedLayerIds.add(layerId);
        applied += 1;
    }

    // 所有写入结束后统一从 Photoshop descriptor 读回。不能沿用逐步变换时的 DOM 快照，
    // 否则后续变换、图层组边界刷新或历史状态变化会让 QA 对着旧 bounds 放行导出。
    for (const placement of plan.placements) {
        const layerId = Number(placement.layerId);
        if (!Number.isFinite(layerId)
            || !topLevelLayerIds.has(layerId)
            || !successfullyAppliedLayerIds.has(layerId)) {
            continue;
        }
        const finalReadback = await readLiveSkuLayerBounds(documentId, layerId);
        if (!finalReadback.bounds || finalReadback.bounds.width <= 0 || finalReadback.bounds.height <= 0) {
            warnings.push(`图层 ${layerId} 最终实时回读缺少有效边界`);
            continue;
        }
        actualPlacements.push({
            itemId: placement.itemId,
            layerId,
            name: placement.name,
            destinationBox: placement.destinationBox,
            actualBounds: finalReadback.bounds,
            actualSubjectBounds: finalReadback.subjectBounds
        });
    }

    const actualTopLevelItemCount = new Set(
        plan.placements
            .map((placement) => Number(placement.layerId))
            .filter((layerId) => Number.isFinite(layerId) && topLevelLayerIds.has(layerId))
    ).size;
    const autoLayoutQa = verifySkuAutoLayoutResult({
        plan,
        actualPlacements,
        expectedItemCount: options.expectedItemCount,
        actualTopLevelItemCount,
        expectedTopLevelLayerIds: options.expectedTopLevelLayerIds,
        obstacles: options.obstacles || []
    });

    return { applied, warnings, autoLayoutQa };
}

/**
 * 使用 batchPlay 缩放图层（兼容图层组）
 * @param documentId 文档 ID
 * @param layerId 图层 ID
 * @param scalePercent 缩放百分比（如 80 表示 80%）
 */
async function batchPlayResize(documentId: number, layerId: number, scalePercent: number): Promise<void> {
    const targetLayer = await assertSkuMutationTarget({
        documentId,
        layerId,
        phase: '缩放写入前',
        activateDocument: true
    });
    const selectionDescriptors = await action.batchPlay([{
        _obj: 'select',
        _target: [
            { _ref: 'layer', _id: layerId },
            { _ref: 'document', _id: documentId }
        ],
        makeVisible: false,
        _options: { dialogOptions: 'dontDisplay' }
    }], { synchronousExecution: true });
    assertSkuBatchPlayCommandSucceeded(selectionDescriptors, `选择 SKU 图层 ${layerId}`);

    let scaledWithDom = false;
    if (typeof targetLayer?.scale === 'function') {
        try {
            await Promise.resolve(targetLayer.scale(scalePercent, scalePercent));
            scaledWithDom = true;
        } catch (error: unknown) {
            console.warn(
                `[SKULayout] 图层 ${layerId} DOM scale 失败，改用已选中图层的 transform：`,
                formatSkuLayoutCaughtError(error)
            );
        }
    }

    if (!scaledWithDom) {
        // Photoshop 的 transform 命令消费当前精确选中的目标；给 transform 再附 layer+document
        // 复合 _target 会在部分宿主版本返回错误描述符或静默不写。目标身份由上面的 exact select
        // 和写后 document/layer 读回共同保证。
        const transformDescriptors = await action.batchPlay([{
            _obj: 'transform',
            freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
            width: { _unit: 'percentUnit', _value: scalePercent },
            height: { _unit: 'percentUnit', _value: scalePercent },
            interfaceIconFrameDimmed: { _enum: 'interpolationType', _value: 'bicubicAutomatic' },
            _options: { dialogOptions: 'dontDisplay' }
        }], { synchronousExecution: true });
        assertSkuBatchPlayCommandSucceeded(transformDescriptors, `缩放 SKU 图层 ${layerId}`);
    }
    await assertSkuMutationTarget({ documentId, layerId, phase: '缩放写入后' });
}

/**
 * 使用 batchPlay 移动图层（兼容图层组）
 * @param documentId 文档 ID
 * @param layerId 图层 ID
 * @param offsetX 水平偏移（像素）
 * @param offsetY 垂直偏移（像素）
 */
async function batchPlayTranslate(
    documentId: number,
    layerId: number,
    offsetX: number,
    offsetY: number
): Promise<void> {
    const targetLayer = await assertSkuMutationTarget({
        documentId,
        layerId,
        phase: '移动写入前',
        activateDocument: true
    });
    const selectionDescriptors = await action.batchPlay([{
        _obj: 'select',
        _target: [
            { _ref: 'layer', _id: layerId },
            { _ref: 'document', _id: documentId }
        ],
        makeVisible: false,
        _options: { dialogOptions: 'dontDisplay' }
    }], { synchronousExecution: true });
    assertSkuBatchPlayCommandSucceeded(selectionDescriptors, `选择 SKU 图层 ${layerId}`);

    await translateLayer(targetLayer, offsetX, offsetY);
    await assertSkuMutationTarget({ documentId, layerId, phase: '移动写入后' });
}

type SkuLayerCleanupFailureStage = 'input' | 'precondition' | 'delete' | 'verify' | 'visibility' | 'close';

type SkuLayerCleanupFailureItem = {
    layerId?: number;
    stage: SkuLayerCleanupFailureStage;
    message: string;
};

type SkuLayerCleanupFailureData = {
    schema: 'sku-layer-cleanup-failure/v1';
    reason: 'sku_layer_cleanup_not_confirmed';
    documentId: number;
    label: string;
    failedLayerIds: number[];
    pendingLayerIds: number[];
    failures: SkuLayerCleanupFailureItem[];
};

type SkuLayerCleanupFailureCarrier = Error & {
    skuLayerCleanupFailure: SkuLayerCleanupFailureData;
};

type SkuLayerCleanupResult = {
    schema: 'sku-layer-cleanup-result/v1';
    documentId: number;
    deletedLayerIds: number[];
    alreadyAbsentLayerIds: number[];
    pendingLayerIds: number[];
};

function readSkuBatchPlayDescriptorError(descriptor: any): string | null {
    if (!descriptor || typeof descriptor !== 'object') return null;
    const objectType = String(descriptor?._obj || '').trim().toLowerCase();
    const resultCode = Number(descriptor?.result);
    if (objectType !== 'error' && (!Number.isFinite(resultCode) || resultCode >= 0)) return null;
    const message = String(descriptor?.message || descriptor?.error || '').trim();
    return message || `Photoshop 返回错误描述符（result=${String(descriptor?.result ?? 'unknown')}）`;
}

function assertSkuBatchPlayCommandSucceeded(descriptors: any, label: string): void {
    if (!Array.isArray(descriptors) || descriptors.length !== 1 || !descriptors[0]) {
        throw new Error(`${label}没有返回唯一 Photoshop 结果描述符。`);
    }
    const descriptorError = readSkuBatchPlayDescriptorError(descriptors[0]);
    if (descriptorError) throw new Error(`${label}失败：${descriptorError}`);
}

function normalizePendingSkuLayerIds(layerIds: number[]): number[] {
    return Array.from(new Set(
        layerIds
            .map((layerId) => Number(layerId))
            .filter((layerId) => Number.isSafeInteger(layerId) && layerId > 0)
    ));
}

function removeConfirmedSkuLayerId(layerIds: number[], confirmedLayerId: number): void {
    for (let index = layerIds.length - 1; index >= 0; index -= 1) {
        if (Number(layerIds[index]) === confirmedLayerId) layerIds.splice(index, 1);
    }
}

function createSkuLayerCleanupFailure(input: {
    documentId: number;
    label: string;
    pendingLayerIds: number[];
    failures: SkuLayerCleanupFailureItem[];
}): SkuLayerCleanupFailureCarrier {
    const failedLayerIds = Array.from(new Set(
        input.failures
            .map((failure) => Number(failure.layerId))
            .filter((layerId) => Number.isSafeInteger(layerId) && layerId > 0)
    ));
    const data: SkuLayerCleanupFailureData = {
        schema: 'sku-layer-cleanup-failure/v1',
        reason: 'sku_layer_cleanup_not_confirmed',
        documentId: Number(input.documentId),
        label: input.label,
        failedLayerIds,
        pendingLayerIds: [...input.pendingLayerIds],
        failures: input.failures.map((failure) => ({ ...failure }))
    };
    const details = data.failures.map((failure) => failure.message).join('；');
    const error = new Error(
        `${input.label}: Photoshop 图层清理未被确认，已停止继续使用当前模板。`
        + `${details ? ` ${details}` : ''}`
    ) as SkuLayerCleanupFailureCarrier;
    error.skuLayerCleanupFailure = data;
    return error;
}

function extractSkuLayerCleanupFailureData(error: unknown): SkuLayerCleanupFailureData | null {
    const carrier = error as Partial<SkuLayerCleanupFailureCarrier> | null;
    const data = carrier?.skuLayerCleanupFailure;
    return data?.schema === 'sku-layer-cleanup-failure/v1' ? data : null;
}

async function confirmSkuLayerAbsent(documentId: number, layerId: number): Promise<{
    confirmed: boolean;
    diagnostic: string;
}> {
    const targetDocument = findOpenDocumentById(documentId);
    if (!targetDocument) {
        return {
            confirmed: false,
            diagnostic: `删除后验证找不到目标文档 ${documentId}。`
        };
    }
    if (Number(app.activeDocument?.id) !== documentId) app.activeDocument = targetDocument;
    if (Number(app.activeDocument?.id) !== documentId) {
        return {
            confirmed: false,
            diagnostic: `删除后验证文档不一致：期望 ${documentId}，当前 ${String(app.activeDocument?.id ?? 'none')}。`
        };
    }

    const domLayer = findLayerById(targetDocument.layers, layerId);
    if (domLayer) {
        return {
            confirmed: false,
            diagnostic: `目标文档 ${documentId} 的实时 DOM 中仍存在图层 ${layerId}。`
        };
    }
    const historyStateRef = readActiveHistoryStateRef(targetDocument);
    return {
        confirmed: true,
        diagnostic: historyStateRef
            ? `目标文档 ${documentId} 的实时 DOM 已确认图层 ${layerId} 不存在（history ${historyStateRef.historyStateId}）。`
            : `目标文档 ${documentId} 的实时 DOM 已确认图层 ${layerId} 不存在。`
    };
}

async function deleteCopiedSkuLayers(
    documentId: number,
    layerIds: number[],
    label: string
): Promise<SkuLayerCleanupResult> {
    const failures: SkuLayerCleanupFailureItem[] = [];
    const deletedLayerIds: number[] = [];
    const alreadyAbsentLayerIds: number[] = [];
    const uniqueLayerIds = normalizePendingSkuLayerIds(layerIds).reverse();
    const invalidLayerIdCount = layerIds.length - layerIds.filter((layerId) => (
        Number.isSafeInteger(Number(layerId)) && Number(layerId) > 0
    )).length;
    if (invalidLayerIdCount > 0) {
        failures.push({
            stage: 'input',
            message: `${label}: 待清理列表包含 ${invalidLayerIdCount} 个无效 layerId，未从 pending 列表移除。`
        });
    }

    for (const layerId of uniqueLayerIds) {
        const targetDocument = findOpenDocumentById(documentId);
        if (targetDocument && !findLayerById(targetDocument.layers, layerId)) {
            removeConfirmedSkuLayerId(layerIds, layerId);
            alreadyAbsentLayerIds.push(layerId);
            continue;
        }
        let targetReady = true;
        try {
            await assertSkuMutationTarget({
                documentId,
                layerId,
                phase: '删除写入前',
                activateDocument: true
            });
        } catch (error: unknown) {
            targetReady = false;
            const absence = await confirmSkuLayerAbsent(documentId, layerId);
            if (absence.confirmed) {
                removeConfirmedSkuLayerId(layerIds, layerId);
                alreadyAbsentLayerIds.push(layerId);
                continue;
            }
            failures.push({
                layerId,
                stage: 'precondition',
                message: `${label}: 图层 ${layerId} 删除前目标断言失败，且无法确认已不存在：`
                    + `${formatSkuLayoutCaughtError(error)}；${absence.diagnostic}`
            });
        }
        if (!targetReady) continue;

        let deleteDescriptors: any[] | null = null;
        try {
            deleteDescriptors = await action.batchPlay([{
                _obj: 'delete',
                _target: [
                    { _ref: 'layer', _id: layerId },
                    { _ref: 'document', _id: documentId }
                ],
                _options: { dialogOptions: 'dontDisplay' }
            }], { synchronousExecution: true });
        } catch (error: unknown) {
            failures.push({
                layerId,
                stage: 'delete',
                message: `${label}: 删除图层 ${layerId} 的 batchPlay 请求失败：${formatSkuLayoutCaughtError(error)}`
            });
            continue;
        }

        const deleteDescriptor = deleteDescriptors?.[0];
        if (!Array.isArray(deleteDescriptors) || deleteDescriptors.length !== 1 || !deleteDescriptor) {
            failures.push({
                layerId,
                stage: 'delete',
                message: `${label}: 删除图层 ${layerId} 没有返回唯一 Photoshop 结果描述符。`
            });
            continue;
        }
        const descriptorError = readSkuBatchPlayDescriptorError(deleteDescriptor);
        if (descriptorError) {
            failures.push({
                layerId,
                stage: 'delete',
                message: `${label}: Photoshop 拒绝删除图层 ${layerId}：${descriptorError}`
            });
            continue;
        }

        const absence = await confirmSkuLayerAbsent(documentId, layerId);
        if (!absence.confirmed) {
            failures.push({
                layerId,
                stage: 'verify',
                message: `${label}: 图层 ${layerId} 删除后验证失败：${absence.diagnostic}`
            });
            continue;
        }
        removeConfirmedSkuLayerId(layerIds, layerId);
        deletedLayerIds.push(layerId);
    }

    const pendingLayerIds = normalizePendingSkuLayerIds(layerIds);
    if (failures.length > 0 || pendingLayerIds.length > 0) {
        throw createSkuLayerCleanupFailure({ documentId, label, pendingLayerIds, failures });
    }
    return {
        schema: 'sku-layer-cleanup-result/v1',
        documentId,
        deletedLayerIds,
        alreadyAbsentLayerIds,
        pendingLayerIds: []
    };
}

async function cleanupCopiedSkuLayersAfterModal(
    layerIds: number[],
    label: string,
    documentId: number,
    options?: {
        templateDoc?: any;
        placeholderVisibilitySnapshots?: SkuPlaceholderVisibilitySnapshot[];
    }
): Promise<SkuLayerCleanupResult | null> {
    const visibilitySnapshots = options?.placeholderVisibilitySnapshots || [];
    if (layerIds.length === 0 && visibilitySnapshots.length === 0) return null;
    return await core.executeAsModal(async () => {
        const targetDocument = findOpenDocumentById(documentId);
        if (!targetDocument) {
            throw createSkuLayerCleanupFailure({
                documentId,
                label,
                pendingLayerIds: normalizePendingSkuLayerIds(layerIds),
                failures: [{
                    stage: 'precondition',
                    message: `${label}: 找不到目标模板文档 ${String(documentId)}。`
                }]
            });
        }
        if (
            options?.templateDoc
            && Number(options.templateDoc?.id) !== Number(documentId)
        ) {
            throw createSkuLayerCleanupFailure({
                documentId,
                label,
                pendingLayerIds: normalizePendingSkuLayerIds(layerIds),
                failures: [{
                    stage: 'precondition',
                    message: `${label}: 模板文档 ID ${String(options.templateDoc?.id)} `
                        + `与删除目标 ${String(documentId)} 不一致。`
                }]
            });
        }
        app.activeDocument = targetDocument;

        let cleanupResult: SkuLayerCleanupResult | null = null;
        let cleanupError: unknown = null;
        try {
            cleanupResult = await deleteCopiedSkuLayers(documentId, layerIds, label);
        } catch (error: unknown) {
            cleanupError = error;
        }

        const visibilityFailures: SkuLayerCleanupFailureItem[] = [];
        for (let index = visibilitySnapshots.length - 1; index >= 0; index -= 1) {
            const snapshot = visibilitySnapshots[index];
            try {
                if (snapshot.layer) snapshot.layer.visible = snapshot.visible;
                visibilitySnapshots.splice(index, 1);
            } catch (error: unknown) {
                visibilityFailures.push({
                    layerId: Number.isSafeInteger(Number(snapshot.layer?.id))
                        ? Number(snapshot.layer.id)
                        : undefined,
                    stage: 'visibility',
                    message: `${label}: 恢复占位层 ${snapshot.layer?.name || snapshot.layer?.id || 'unknown'} `
                        + `可见性失败：${formatSkuLayoutCaughtError(error)}`
                });
            }
        }

        if (cleanupError || visibilityFailures.length > 0) {
            const cleanupFailure = extractSkuLayerCleanupFailureData(cleanupError);
            const failures = cleanupFailure
                ? [...cleanupFailure.failures, ...visibilityFailures]
                : [
                    ...(cleanupError ? [{
                        stage: 'delete' as const,
                        message: `${label}: 图层清理失败：${formatSkuLayoutCaughtError(cleanupError)}`
                    }] : []),
                    ...visibilityFailures
                ];
            throw createSkuLayerCleanupFailure({
                documentId,
                label,
                pendingLayerIds: normalizePendingSkuLayerIds(layerIds),
                failures
            });
        }
        return cleanupResult;
    }, { commandName: label });
}

async function closeSkuTemplateAfterCleanupFailure(input: {
    documentId: number;
    label: string;
    cause: unknown;
    pendingLayerIds: number[];
}): Promise<SkuLayerCleanupFailureCarrier> {
    const existingFailure = extractSkuLayerCleanupFailureData(input.cause);
    const failures: SkuLayerCleanupFailureItem[] = existingFailure
        ? existingFailure.failures.map((failure) => ({ ...failure }))
        : [{
            stage: 'delete',
            message: `${input.label}: ${formatSkuLayoutCaughtError(input.cause)}`
        }];
    const pendingLayerIds = normalizePendingSkuLayerIds(input.pendingLayerIds);
    const targetDocument = findOpenDocumentById(input.documentId);
    if (targetDocument) {
        try {
            await core.executeAsModal(async () => {
                app.activeDocument = targetDocument;
                await targetDocument.closeWithoutSaving();
            }, { commandName: `${input.label}：关闭未清理模板` });
        } catch (error: unknown) {
            failures.push({
                stage: 'close',
                message: `${input.label}: 图层清理失败后，关闭模板文档 ${input.documentId} 也失败：`
                    + `${formatSkuLayoutCaughtError(error)}`
            });
        }
    }
    return createSkuLayerCleanupFailure({
        documentId: input.documentId,
        label: input.label,
        pendingLayerIds,
        failures
    });
}

/**
 * 使用 batchPlay 导出 JPEG（通过 Photoshop 导出动作完成受控保存）
 * @param outputPath 完整输出路径
 * @param quality JPEG 质量 (1-12)
 */
async function batchPlayExportJPEG(outputPath: string, quality: number = 10): Promise<boolean> {
    try {
        // 使用 Quick Export as JPEG
        await action.batchPlay([{
            _obj: 'exportDocumentAsFileTypePressed',
            _target: [{ _ref: 'document', _enum: 'ordinal', _value: 'first' }],
            fileType: 'jpg',
            quality: quality,
            _options: { dialogOptions: 'dontDisplay' }
        } as any], { synchronousExecution: true });
        return true;
    } catch (e: any) {
        console.warn(`[batchPlayExportJPEG] 快速导出失败: ${e.message}`);
        return false;
    }
}

/**
 * SKU 配置项
 */
interface SKUConfig {
    templateName: string;      // 模板文件名
    colorCombination: string;  // 颜色组合，如 "红色+黑色|蓝色+白色"
}

/**
 * 颜色配置项
 */
interface ColorConfig {
    name: string;
    hexColor: string;
}

/**
 * 项目结构分析结果
 */
interface ProjectStructure {
    psdFolder?: string;        // PSD 素材文件夹
    templateFolder?: string;   // 模板文件夹
    configFolder?: string;     // 配置文件夹
    outputFolder?: string;     // 输出文件夹
    skuFile?: string;          // SKU 素材文件
    configFile?: string;       // 配置 CSV 文件
    colorFile?: string;        // 颜色配置文件
    note?: string;             // 备注信息
}

function describeComboValue(value: any): string {
    if (Array.isArray(value)) return 'array';
    if (value === null) return 'null';
    return typeof value;
}

function buildCombosShapeError(position: string, value: any): string {
    return `skuLayout execute 参数错误：combos 必须是颜色名数组的数组 (array of color name arrays: string[][])。出错位置 ${position} 是 ${describeComboValue(value)}。示例：{"combos":[["红色","黑色"],["蓝色","白色"]]}`;
}

function validateCombosShape(combos: any): string | null {
    if (combos === undefined || combos === null) return null;
    if (!Array.isArray(combos)) {
        return buildCombosShapeError('combos', combos);
    }

    for (let comboIndex = 0; comboIndex < combos.length; comboIndex++) {
        const combo = combos[comboIndex];
        if (!Array.isArray(combo)) {
            return buildCombosShapeError(`combos[${comboIndex}]`, combo);
        }

        for (let colorIndex = 0; colorIndex < combo.length; colorIndex++) {
            const colorName = combo[colorIndex];
            if (typeof colorName !== 'string') {
                return buildCombosShapeError(`combos[${comboIndex}][${colorIndex}]`, colorName);
            }
        }
    }

    return null;
}

function normalizeSkuNoteColorRegions(combos: string[][] | undefined): string[][] {
    if (!Array.isArray(combos)) return [];

    const regions: string[][] = [];
    for (const combo of combos) {
        if (!Array.isArray(combo)) continue;
        const region = combo
            .map(colorName => String(colorName || '').trim())
            .filter(Boolean);
        if (region.length > 0) {
            regions.push(region);
        }
    }
    return regions;
}

interface SkuLayoutDeliveryPlanItem {
    itemId: string;
    rasterOutputPath: string;
    editableOutputPath: string;
}

interface SkuLayoutDeliveryPlan {
    version: 'sku-layout-delivery-plan/v1';
    items: SkuLayoutDeliveryPlanItem[];
}

function normalizeSkuDeliveryPath(value: unknown): string {
    return String(value || '')
        .trim()
        .replace(/\//g, '\\')
        .replace(/\\+/g, '\\')
        .toLowerCase();
}

function isAbsoluteSkuDeliveryPath(value: string): boolean {
    return /^[a-z]:\\/i.test(value) || /^\\\\[^\\]+\\[^\\]+/i.test(value);
}

function readSkuLayoutDeliveryPlan(
    value: unknown,
    expectedItemCount: number
): SkuLayoutDeliveryPlan | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const candidate = value as Record<string, unknown>;
    if (candidate.version !== 'sku-layout-delivery-plan/v1'
        || !Array.isArray(candidate.items)
        || candidate.items.length !== expectedItemCount
        || expectedItemCount <= 0) {
        return undefined;
    }
    const items: SkuLayoutDeliveryPlanItem[] = [];
    const identities = new Set<string>();
    const paths = new Set<string>();
    for (const rawItem of candidate.items) {
        if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) return undefined;
        const item = rawItem as Record<string, unknown>;
        const itemId = String(item.itemId || '').trim();
        const rasterOutputPath = String(item.rasterOutputPath || '').trim();
        const editableOutputPath = String(item.editableOutputPath || '').trim();
        const rasterPathKey = normalizeSkuDeliveryPath(rasterOutputPath);
        const editablePathKey = normalizeSkuDeliveryPath(editableOutputPath);
        if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(itemId)
            || !isAbsoluteSkuDeliveryPath(rasterPathKey)
            || !isAbsoluteSkuDeliveryPath(editablePathKey)
            || !/\.jpe?g$/i.test(rasterOutputPath)
            || !/\.psb$/i.test(editableOutputPath)
            || /(?:^|\\)\.\.(?:\\|$)/.test(rasterPathKey)
            || /(?:^|\\)\.\.(?:\\|$)/.test(editablePathKey)
            || identities.has(itemId)
            || paths.has(rasterPathKey)
            || paths.has(editablePathKey)
            || rasterPathKey === editablePathKey) {
            return undefined;
        }
        identities.add(itemId);
        paths.add(rasterPathKey);
        paths.add(editablePathKey);
        items.push({ itemId, rasterOutputPath, editableOutputPath });
    }
    return { version: 'sku-layout-delivery-plan/v1', items };
}

/**
 * SKU 排版工具
 */
export class SKULayoutTool implements Tool {
    name = 'skuLayout';

    schema: ToolSchema = {
        name: 'skuLayout',
        description: 'SKU 图片批量排版工具，支持自动识别项目结构、解析配置、执行排版',
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    description: '操作类型: analyzeProject, parseConfig, getProgress, getCapabilities, inspectTemplateLayout, listLayerSets, execute, arrangeDynamic'
                },
                projectPath: {
                    type: 'string',
                    description: '项目根目录路径'
                },
                config: {
                    type: 'object',
                    description: 'SKU 配置对象'
                },
                templateIndex: {
                    type: 'number',
                    description: '旧版模板索引参数（executeOne 已停用，仅为旧客户端解析兼容保留）'
                },
                outputFormat: {
                    type: 'string',
                    description: '输出格式: jpg, png'
                },
                quality: {
                    type: 'number',
                    description: 'JPEG 质量 (1-12)'
                },
                combos: {
                    type: 'array',
                    description: '颜色组合列表，每个元素是一个颜色名称数组'
                },
                skuDocName: {
                    type: 'string',
                    description: '明确指定 SKU 素材文档名称，避免误用当前打开的其他项目 SKU'
                },
                templateDocName: {
                    type: 'string',
                    description: '明确指定模板文档名称，避免依赖当前活动文档'
                },
                outputDir: {
                    type: 'string',
                    description: '输出目录路径'
                },
                editableOutputDir: {
                    type: 'string',
                    description: '可选的可编辑 PSD/PSB 配对输出根目录；只在最终几何 QA 通过后、清理复制图层前保存'
                },
                deliveryPlan: {
                    type: 'object',
                    description: '由 SKU Skill 在执行前冻结的逐行 JPG/PSB 精确路径与 itemId；生产结果必须逐项匹配',
                    properties: {
                        version: {
                            type: 'string',
                            enum: ['sku-layout-delivery-plan/v1'],
                            description: '冻结交付计划协议版本'
                        },
                        items: {
                            type: 'array',
                            description: '与 combos 同序的一组精确交付项',
                            items: {
                                type: 'object',
                                description: '一行 SKU 的 JPG/PSB 配对目标',
                                properties: {
                                    itemId: { type: 'string', description: '冻结清单中的逐行身份' },
                                    rasterOutputPath: { type: 'string', description: '本行 JPG 绝对路径' },
                                    editableOutputPath: { type: 'string', description: '本行 PSB 绝对路径' }
                                },
                                required: ['itemId', 'rasterOutputPath', 'editableOutputPath']
                            }
                        }
                    },
                    required: ['version', 'items']
                },
                autoLayoutWithoutPlaceholders: {
                    type: 'boolean',
                    description: '低层兼容参数；SKU 6.3 默认不使用，正常业务按模板顺序占位组替换'
                },
                expectedItemCount: {
                    type: 'number',
                    description: '只读模板检查时用于判断本次 SKU 组合期望的颜色数量'
                },
                regionCapacities: {
                    type: 'array',
                    items: { type: 'number' },
                    description: '6.0 矩形多区域模板的区域容量，按 Photoshop 图层面板从上到下，例如 4双上3下1传 [3,1]'
                }
            },
            required: ['action']
        }
    };

    // 缓存
    private projectStructure: ProjectStructure | null = null;
    private skuConfigs: SKUConfig[] = [];
    private colorConfigs: Map<number, ColorConfig> = new Map();
    private progress = { current: 0, total: 0, message: '' };
    private activeExecutionContext: ToolExecutionContext | undefined;

    private isCancelled(): boolean {
        return Boolean(this.activeExecutionContext?.isCancelled?.());
    }

    private throwIfCancelled(): void {
        if (!this.isCancelled()) return;
        const error = new Error('请求已取消');
        (error as Error & { code?: string }).code = REQUEST_CANCELLED_ERROR;
        throw error;
    }

    private buildCancelledResult(): ToolResult<any> {
        return {
            success: false,
            error: '请求已取消',
            data: {
                cancelled: true
            }
        };
    }

    private isCancellationError(error: any): boolean {
        return error?.code === REQUEST_CANCELLED_ERROR || this.isCancelled();
    }

    async execute(params: {
        action: string;
        projectPath?: string;
        config?: any;
        templateIndex?: number;
        outputFormat?: string;
        quality?: number;
        combos?: string[][];
        skuDocName?: string;
        templateDocName?: string;
        outputDir?: string;
        editableOutputDir?: string;
        deliveryPlan?: SkuLayoutDeliveryPlan;
        autoLayoutWithoutPlaceholders?: boolean;
        expectedItemCount?: number;
        regionCapacities?: number[];
        noteFilePrefix?: string;   // 自选备注文件名前缀
        isNoteTemplate?: boolean;  // 是否为自选备注模式
        comboStartIndex?: number;  // 本批 combos[0] 在同规格全部组合中的下标，用于组合图文件名连续编号
    }, context?: ToolExecutionContext): Promise<ToolResult<any>> {
        const previousContext = this.activeExecutionContext;
        this.activeExecutionContext = context;
        try {
            this.throwIfCancelled();
            switch (params.action) {
                case 'analyzeProject':
                    return await this.analyzeProject(params.projectPath);

                case 'parseConfig':
                    return await this.parseConfigFiles();

                case 'executeOne':
                case 'executeBatch':
                    return {
                        success: false,
                        error: '旧版 executeOne/executeBatch 已停用：它们没有当前 SKU 工作流要求的模板预检、实时几何 QA 与事务导出。请通过 sku-batch 工作流使用 action=execute。',
                        data: null
                    };

                case 'getProgress':
                    return { success: true, data: this.progress };

                case 'getCapabilities':
                    return this.getCapabilities();

                case 'inspectTemplateLayout':
                    return await this.inspectTemplateLayout({
                        templateDocName: params.templateDocName,
                        expectedItemCount: params.expectedItemCount
                    });

                case 'listLayerSets':
                    return await this.listLayerSets();

                case 'copyLayerSetToTemplate':
                    return await this.copyLayerSetToTemplate(params.config);

                case 'execute':
                    const combosShapeError = validateCombosShape(params.combos);
                    if (combosShapeError) {
                        return { success: false, error: combosShapeError, data: null };
                    }
                    return await this.executeComboLayout({
                        combos: params.combos || [],
                        skuDocName: params.skuDocName,
                        templateDocName: params.templateDocName,
                        outputDir: params.outputDir,
                        editableOutputDir: params.editableOutputDir,
                        deliveryPlan: params.deliveryPlan,
                        format: params.outputFormat || 'jpg',
                        quality: params.quality || 12,
                        autoLayoutWithoutPlaceholders: params.autoLayoutWithoutPlaceholders,
                        regionCapacities: params.regionCapacities,
                        noteFilePrefix: params.noteFilePrefix,  // 自选备注文件名前缀
                        isNoteTemplate: params.isNoteTemplate,  // 是否为自选备注模式
                        comboStartIndex: params.comboStartIndex // 组合图连续编号的批次偏移
                    });

                case 'exportNote':
                    // ★ 自选备注专用：直接导出当前文档，不复制图层
                    return await this.exportNoteTemplate({
                        outputDir: params.outputDir,
                        editableOutputDir: params.editableOutputDir,
                        deliveryPlan: params.deliveryPlan,
                        format: params.outputFormat || 'jpg',
                        quality: params.quality || 12,
                        noteFileName: params.noteFilePrefix || '自选备注'
                    });

                case 'arrangeDynamic':
                    const dynamicCombosShapeError = validateCombosShape(params.combos);
                    if (dynamicCombosShapeError) {
                        return { success: false, error: dynamicCombosShapeError, data: null };
                    }
                    // ★ 动态排列模式（类似 6.1颜色排列-动态调整.jsx）
                    // 用于自选备注：从 SKU 素材复制颜色，动态排列，导出
                    return await this.executeNoteWithDynamicArrange({
                        colorsByRegion: normalizeSkuNoteColorRegions(params.combos || []),
                        skuDocName: params.skuDocName,
                        templateDocName: params.templateDocName,
                        outputDir: params.outputDir,
                        editableOutputDir: params.editableOutputDir,
                        deliveryPlan: params.deliveryPlan,
                        format: params.outputFormat || 'jpg',
                        quality: params.quality || 12,
                        autoLayoutWithoutPlaceholders: params.autoLayoutWithoutPlaceholders,
                        regionCapacities: params.regionCapacities,
                        noteFileName: params.noteFilePrefix || '自选备注'
                    });

                default:
                    return { success: false, error: `未知操作: ${params.action}`, data: null };
            }
        } catch (error: any) {
            if (error?.code === REQUEST_CANCELLED_ERROR || this.isCancelled()) {
                return this.buildCancelledResult();
            }
            console.error('[SKULayout] 错误:', error);
            return { success: false, error: formatSkuLayoutCaughtError(error), data: null };
        } finally {
            this.activeExecutionContext = previousContext;
        }
    }

    private getCapabilities(): ToolResult<any> {
        return {
            success: true,
            data: {
                schema: 'sku-layout-capabilities/v0',
                runtime: 'DesignEcho-UXP skuLayout',
                actions: [
                    'analyzeProject',
                    'parseConfig',
                    'getProgress',
                    'getCapabilities',
                    'inspectTemplateLayout',
                    'listLayerSets',
                    'copyLayerSetToTemplate',
                    'execute',
                    'exportNote',
                    'arrangeDynamic'
                ],
                supportsRecursiveSkuLayerSets: true,
                skuSourceColorGroups: {
                    revision: 'sku-recursive-color-layer-groups/v1',
                    actions: ['listLayerSets', 'copyLayerSetToTemplate', 'execute', 'arrangeDynamic'],
                    recursiveLayerSets: true,
                    canResolveNestedColorGroups: true,
                    returnsLayerSetPaths: true,
                    returnsLayerSetBounds: true
                },
                supportsNoPlaceholderAutoLayout: true,
                noPlaceholderAutoLayout: {
                    revision: 'sku-no-placeholder-auto-layout/v2',
                    actions: ['execute', 'arrangeDynamic'],
                    plannerSchema: 'sku-auto-layout-plan/v0',
                    returnsPlanDiagnostics: true,
                    returnsPostExecutionGeometryQa: true,
                    returnsActualSubjectBoundsQa: true,
                    writesPhotoshopOnlyAfterPlanReady: true
                },
                errorNormalization: {
                    revision: 'sku-layout-error-normalization/v1',
                    normalizesNonErrorExceptions: true
                },
                comboExportNaming: {
                    revision: 'sku-combo-export-naming/v1',
                    usesColorComboAsFileName: true,
                    keepsExecutionOrderOutOfFileName: true
                },
                pairedEditableDelivery: {
                    revision: 'sku-paired-editable-delivery/v1',
                    deliveryPlanVersion: 'sku-layout-delivery-plan/v1',
                    actions: ['execute', 'arrangeDynamic'],
                    savesAfterGeometryQa: true,
                    savesBeforeCopiedLayerCleanup: true,
                    returnsEditableDocumentArtifact: true,
                    returnsStructureReadback: true,
                    bindsRasterAndEditableHistory: true
                },
                orderedPlaceholders: {
                    revision: 'sku-ordered-placeholder-recognition/v4',
                    acceptsCreateSkuPlaceholdersShapeLayers: true,
                    acceptsHiddenReferenceShapeRegions: true,
                    supportsSingleLegacyReferenceRegion: true,
                    acceptsLegacyReferenceItemGroups: true
                },
                templateLayoutInspection: {
                    revision: 'sku-template-layout-inspection/v3',
                    actions: ['inspectTemplateLayout'],
                    ownsPhotoshopTemplateRecognition: true,
                    returnsSlotBounds: true,
                    returnsBlockers: true,
                    returnsVersionedTextObservations: true
                },
                templateRegionComposition: {
                    revision: 'sku-region-composition/v1',
                    actions: ['inspectTemplateLayout', 'execute', 'arrangeDynamic'],
                    acceptsExplicitRegionCapacities: true,
                    preservesPhotoshopPanelOrder: true,
                    supportsMultipleRectangleRegions: true
                },
                selfSelectNotePlaceholders: {
                    revision: 'sku-note-placeholder-overflow/v2',
                    allowsExtraPlaceholders: true,
                    hidesUnusedPlaceholders: true,
                    supportsSingleLegacyReferenceRegion: true
                },
                boundaries: {
                    writesPhotoshop: false,
                    claimsDesignQuality: false
                }
            }
        };
    }

    private async inspectTemplateLayout(config: {
        templateDocName?: string;
        expectedItemCount?: number;
    } = {}): Promise<ToolResult<any>> {
        const templateDoc = config.templateDocName
            ? findOpenDocumentByName(config.templateDocName)
            : app.activeDocument;
        if (!templateDoc) {
            return {
                success: false,
                error: config.templateDocName
                    ? `未找到指定模板文档: ${config.templateDocName}`
                    : '没有打开的模板文档',
                data: null
            };
        }

        try {
            return await core.executeAsModal(async () => {
                const historyBefore = readActiveHistoryStateRef(templateDoc);
                if (!historyBefore) {
                    throw new Error('无法读取 SKU 模板的 Photoshop 历史版本。');
                }
                const data = buildTemplateLayoutInspection(templateDoc, config.expectedItemCount);
                const historyAfter = readActiveHistoryStateRef(templateDoc);
                if (!sameHistoryStateRef(historyBefore, historyAfter)) {
                    throw new Error('SKU 模板在检查期间发生变化，已丢弃这次可能不一致的观察结果。');
                }
                return { success: true, data };
            }, {
                commandName: 'DesignEcho: 检查 SKU 模板结构与文字',
                timeOut: 5
            });
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                data: null
            };
        }
    }

    /**
     * 分析项目结构
     */
    private async analyzeProject(projectPath?: string): Promise<ToolResult<ProjectStructure>> {
        try {
            if (!projectPath) {
                // 尝试从当前文档路径推断
                const doc = app.activeDocument;
                if (!doc) {
                    return { success: false, error: '请指定项目路径或打开一个文档', data: null };
                }
                // UXP 无法直接获取文档路径，返回提示
                return {
                    success: false,
                    error: '请提供项目根目录路径',
                    data: null
                };
            }

            const structure: ProjectStructure = {};

            // 预期的文件夹结构：
            // 项目根目录/
            //   PSD/          - 素材 PSD 文件
            //   模板文件/     - 模板 PSD 文件
            //   配置文件/     - CSV 配置文件
            //   SKU/          - 输出目录

            // 检查各个文件夹
            const expectedFolders = [
                { key: 'psdFolder', name: 'PSD' },
                { key: 'templateFolder', name: '模板文件' },
                { key: 'configFolder', name: '配置文件' },
                { key: 'outputFolder', name: 'SKU' }
            ];

            console.log(`[SKULayout] 分析项目结构: ${projectPath}`);

            // 这里需要使用 UXP 文件系统 API
            // 由于 UXP 限制，实际文件系统访问需要用户授权
            // 返回预期结构供参考

            this.projectStructure = {
                psdFolder: `${projectPath}/PSD`,
                templateFolder: `${projectPath}/模板文件`,
                configFolder: `${projectPath}/配置文件`,
                outputFolder: `${projectPath}/SKU`
            };

            return {
                success: true,
                data: {
                    ...this.projectStructure,
                    note: '请确认以上路径存在。SKU 文件应位于 PSD 文件夹中，配置文件应位于配置文件文件夹中。'
                }
            };

        } catch (error: any) {
            return { success: false, error: formatSkuLayoutCaughtError(error), data: null };
        }
    }

    /**
     * 解析配置文件
     * 由于 UXP 文件系统限制，这里返回配置文件格式说明
     */
    private async parseConfigFiles(): Promise<ToolResult<any>> {
        return {
            success: true,
            data: {
                configFormat: {
                    description: 'CSV 配置文件格式说明',
                    columns: ['模板名称', '颜色组合'],
                    example: [
                        '模板1.psd,1|2+3',
                        '模板2.psd,4+5|6'
                    ],
                    colorFormat: {
                        description: '颜色配置文件格式',
                        columns: ['颜色名称', 'HEX颜色值'],
                        example: [
                            '红色,FF0000',
                            '黑色,000000'
                        ]
                    }
                },
                note: '旧版 CSV 直执行入口已停用；请由 sku-batch 工作流解析组合并通过 action=execute 执行，以保留模板预检、实时几何 QA 与事务导出。'
            }
        };
    }

    /**
     * 列出当前文档中的所有图层组（LayerSets）
     *
     * 注意：SKU 素材文件的结构是图层组，每个颜色是一个图层组
     * 图层组结构示例：
     *   白色（图层组）
     *     ├─ 白色（文字图层）
     *     ├─ 主体（图片图层）
     *     └─ 阴影（图层）
     *
     * UXP API 注意：Document 没有 layerSets 属性，需要从 layers 过滤
     */
    private async listLayerSets(): Promise<ToolResult<any>> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档', data: null };
            }

            const layers = Array.from(doc.layers || []);
            const layerSets = collectSkuLayerGroups(layers).map((entry, index) => ({
                name: entry.name,
                index,
                layerCount: entry.layerCount,
                visible: entry.visible,
                path: entry.path,
                depth: entry.depth,
                topLevelName: entry.topLevelName,
                bounds: getLayerBoundsRect(entry.layer)
            }));
            console.log(`[listLayerSets] 文档: ${doc.name}, 顶层图层数: ${layers.length}, 递归图层组数: ${layerSets.length}`);
            for (const layerSet of layerSets) {
                console.log(`[listLayerSets]   [${layerSet.index}] "${layerSet.path}" (${layerSet.layerCount} 子图层)`);
            }

            return {
                success: true,
                data: {
                    documentName: doc.name,
                    layerSetCount: layerSets.length,
                    recursive: true,
                    layerSets
                }
            };

        } catch (error: any) {
            console.error('[listLayerSets] 错误:', error);
            return { success: false, error: formatSkuLayoutCaughtError(error), data: null };
        }
    }

    /**
     * 复制图层组到模板
     */
    private async copyLayerSetToTemplate(config: {
        sourceDocName: string;
        layerSetName: string;
        targetDocName: string;
        targetBounds?: { left: number; top: number; width: number; height: number };
        alignment?: 'center' | 'left' | 'right' | 'top' | 'bottom';
    }): Promise<ToolResult<any>> {
        this.throwIfCancelled();
        if (!config) {
            return { success: false, error: '缺少配置参数', data: null };
        }

        try {
            // 找到源文档
            let sourceDoc: any = null;
            let targetDoc: any = null;

            for (let i = 0; i < app.documents.length; i++) {
                const doc = app.documents[i];
                if (doc.name === config.sourceDocName) {
                    sourceDoc = doc;
                }
                if (doc.name === config.targetDocName) {
                    targetDoc = doc;
                }
            }

            if (!sourceDoc) {
                return { success: false, error: `未找到源文档: ${config.sourceDocName}`, data: null };
            }
            if (!targetDoc) {
                return { success: false, error: `未找到目标文档: ${config.targetDocName}`, data: null };
            }

            // 在源文档中找到图层组
            app.activeDocument = sourceDoc;
            const targetSet = findSkuLayerGroupByName(Array.from(sourceDoc.layers || []), config.layerSetName)?.layer || null;

            if (!targetSet) {
                return { success: false, error: `未找到图层组: ${config.layerSetName}`, data: null };
            }

            // 复制图层组到目标文档
            await core.executeAsModal(async () => {
                // 选中图层组
                sourceDoc.activeLayer = targetSet;

                // 复制到目标文档
                await action.batchPlay([{
                    _obj: 'duplicate',
                    _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                    to: { _ref: 'document', _name: config.targetDocName },
                    _options: { dialogOptions: 'dontDisplay' }
                }], { synchronousExecution: true });

                // 切换到目标文档进行调整
                app.activeDocument = targetDoc;
                const copiedLayer = targetDoc.activeLayer;

                // 如果提供了目标边界，进行缩放和对齐
                if (config.targetBounds && copiedLayer) {
                    const bounds = copiedLayer.bounds;
                    const layerWidth = bounds[2] - bounds[0];
                    const layerHeight = bounds[3] - bounds[1];

                    // 计算缩放比例（等比缩放，取较小值以适应目标区域）
                    const scaleX = config.targetBounds.width / layerWidth;
                    const scaleY = config.targetBounds.height / layerHeight;
                    const scale = Math.min(scaleX, scaleY);

                    if (Math.abs(scale - 1) > 0.01) {
                        await copiedLayer.scale(scale * 100, scale * 100);
                    }

                    // 移动到目标位置（居中对齐）
                    const newBounds = copiedLayer.bounds;
                    const newWidth = newBounds[2] - newBounds[0];
                    const newHeight = newBounds[3] - newBounds[1];

                    const targetCenterX = config.targetBounds.left + config.targetBounds.width / 2;
                    const targetCenterY = config.targetBounds.top + config.targetBounds.height / 2;
                    const layerCenterX = newBounds[0] + newWidth / 2;
                    const layerCenterY = newBounds[1] + newHeight / 2;

                    await copiedLayer.translate(targetCenterX - layerCenterX, targetCenterY - layerCenterY);
                }

            }, { commandName: 'Copy Layer Set to Template' });

            return {
                success: true,
                data: {
                    message: `已复制图层组 "${config.layerSetName}" 到 "${config.targetDocName}"`,
                    layerSetName: config.layerSetName
                }
            };

        } catch (error: any) {
            if (this.isCancellationError(error)) {
                return this.buildCancelledResult();
            }
            console.error('[SKULayout] copyLayerSetToTemplate 错误:', error);
            return { success: false, error: formatSkuLayoutCaughtError(error), data: null };
        }
    }

    /**
     * 执行单个 SKU 排版
     */
    private async executeOneSKU(index: number, config?: {
        skuDocName: string;           // SKU 素材文档名
        templateDocName: string;      // 模板文档名
        colorMappings: Array<{
            layerIndex: number;        // 模板中的图层索引
            colorNames: string[];      // 要填充的颜色名称（从素材文档的图层组）
        }>;
        outputPath?: string;
        outputName?: string;
        quality?: number;
    }): Promise<ToolResult<any>> {
        if (!config) {
            return { success: false, error: '缺少配置参数', data: null };
        }

        try {
            this.progress = { current: index, total: 1, message: '开始处理...' };

            // 找到文档
            let skuDoc: any = null;
            let templateDoc: any = null;

            for (let i = 0; i < app.documents.length; i++) {
                const doc = app.documents[i];
                if (doc.name === config.skuDocName) {
                    skuDoc = doc;
                }
                if (doc.name === config.templateDocName) {
                    templateDoc = doc;
                }
            }

            if (!skuDoc) {
                return { success: false, error: `未找到 SKU 文档: ${config.skuDocName}`, data: null };
            }
            if (!templateDoc) {
                return { success: false, error: `未找到模板文档: ${config.templateDocName}`, data: null };
            }

            const processedLayers: string[] = [];

            await core.executeAsModal(async () => {
                // 处理每个颜色映射
                for (const mapping of config.colorMappings) {
                    const templateLayers = templateDoc.layers;

                    if (mapping.layerIndex >= templateLayers.length) {
                        console.warn(`[SKULayout] 图层索引 ${mapping.layerIndex} 超出范围`);
                        continue;
                    }

                    const templateLayer = templateLayers[mapping.layerIndex];
                    const templateBounds = templateLayer.bounds;
                    const targetBounds = {
                        left: templateBounds[0].value || templateBounds[0],
                        top: templateBounds[1].value || templateBounds[1],
                        width: (templateBounds[2].value || templateBounds[2]) - (templateBounds[0].value || templateBounds[0]),
                        height: (templateBounds[3].value || templateBounds[3]) - (templateBounds[1].value || templateBounds[1])
                    };

                    // 复制每个颜色的图层组
                    for (const colorName of mapping.colorNames) {
                        // 在 SKU 文档中找到对应的图层组
                        app.activeDocument = skuDoc;
                        const colorSet = findSkuLayerGroupByName(Array.from(skuDoc.layers || []), colorName)?.layer || null;

                        if (!colorSet) {
                            console.warn(`[SKULayout] 未找到素材图层组: ${colorName}`);
                            continue;
                        }

                        // 复制到模板
                        skuDoc.activeLayer = colorSet;
                        await action.batchPlay([{
                            _obj: 'duplicate',
                            _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                            to: { _ref: 'document', _name: config.templateDocName },
                            _options: { dialogOptions: 'dontDisplay' }
                        }], { synchronousExecution: true });

                        // 切换到模板文档调整
                        app.activeDocument = templateDoc;
                        const copiedLayer = templateDoc.activeLayer;

                        if (copiedLayer) {
                            // 缩放以适应目标区域
                            const bounds = copiedLayer.bounds;
                            const layerWidth = (bounds[2].value || bounds[2]) - (bounds[0].value || bounds[0]);
                            const layerHeight = (bounds[3].value || bounds[3]) - (bounds[1].value || bounds[1]);

                            const scaleX = targetBounds.width / layerWidth;
                            const scaleY = targetBounds.height / layerHeight;
                            const scale = Math.min(scaleX, scaleY);

                            if (Math.abs(scale - 1) > 0.01) {
                                await copiedLayer.scale(scale * 100, scale * 100);
                            }

                            // 居中对齐
                            const newBounds = copiedLayer.bounds;
                            const newWidth = (newBounds[2].value || newBounds[2]) - (newBounds[0].value || newBounds[0]);
                            const newHeight = (newBounds[3].value || newBounds[3]) - (newBounds[1].value || newBounds[1]);

                            const targetCenterX = targetBounds.left + targetBounds.width / 2;
                            const targetCenterY = targetBounds.top + targetBounds.height / 2;
                            const layerCenterX = (newBounds[0].value || newBounds[0]) + newWidth / 2;
                            const layerCenterY = (newBounds[1].value || newBounds[1]) + newHeight / 2;

                            await copiedLayer.translate(targetCenterX - layerCenterX, targetCenterY - layerCenterY);
                        }

                        processedLayers.push(colorName);
                    }
                }

            }, { commandName: 'Execute SKU Layout' });

            this.progress = { current: 1, total: 1, message: '完成' };

            return {
                success: true,
                data: {
                    message: 'SKU 排版完成',
                    processedLayers,
                    templateDoc: config.templateDocName
                }
            };

        } catch (error: any) {
            console.error('[SKULayout] executeOneSKU 错误:', error);
            return { success: false, error: formatSkuLayoutCaughtError(error), data: null };
        }
    }

    /**
     * 执行颜色组合排版
     * 这是智能排版的核心方法，接收颜色组合并自动处理
     */
    /**
     * ★ 自选备注专用导出
     *
     * 自选备注是一张**提示图**，告诉买家可以自选颜色
     * 不需要复制颜色图层，只需要直接导出当前模板即可
     *
     * @param config 导出配置
     * @returns 导出结果
     */
    /**
     * 自选备注动态排列导出
     *
     * 6.3 核心逻辑：
     * 1. 从 SKU 素材复制指定颜色图层组到自选备注模板
     * 2. 按模板“占位”容器下的一级图层组顺序逐个替换
     * 3. 每个颜色图层组缩放并居中到对应占位组
     * 4. 隐藏已被替换的占位组
     * 5. 导出到临时目录（由 Agent 复制到正确位置）
     */
    private async executeNoteWithDynamicArrange(config: {
        colors?: string[];          // 简单模式：所有颜色放第一个占位区域
        colorsByRegion?: string[][]; // 兼容旧入参；6.3 会展平成顺序颜色槽
        colorString?: string;        // 字符串模式："1+2|2+3"、"123" 都按顺序槽位解析
        skuDocName?: string;
        templateDocName?: string;
        outputDir?: string;
        editableOutputDir?: string;
        deliveryPlan?: SkuLayoutDeliveryPlan;
        format: string;
        quality: number;
        autoLayoutWithoutPlaceholders?: boolean;
        regionCapacities?: number[];
        noteFileName: string;
    }): Promise<ToolResult<any>> {
        this.throwIfCancelled();
        const { noteFileName } = config;

        // 6.3 顺序占位替换：所有分隔符都只表示顺序槽位，"|" 不再表示区域。
        let orderedNoteColors: string[];
        let colorRegions: string[][];

        if (config.colorsByRegion && config.colorsByRegion.length > 0) {
            orderedNoteColors = config.colorsByRegion.flat().map((color) => String(color || '').trim()).filter(Boolean);
            console.log(`[SKULayout] 使用顺序颜色槽 (${orderedNoteColors.length} 个)`);
        } else if (config.colorString) {
            orderedNoteColors = parseOrderedSkuColorNameSequence(config.colorString);
            console.log(`[SKULayout] 解析顺序颜色字符串: "${config.colorString}" → ${orderedNoteColors.length} 个槽位`);
        } else if (config.colors && config.colors.length > 0) {
            orderedNoteColors = config.colors.map((color) => String(color || '').trim()).filter(Boolean);
            console.log(`[SKULayout] 使用颜色列表: ${orderedNoteColors.length} 个槽位`);
        } else {
            return { success: false, error: '没有提供颜色列表', data: null };
        }

        colorRegions = [orderedNoteColors];

        const totalColors = orderedNoteColors.length;
        if (totalColors === 0) {
            return { success: false, error: '颜色列表为空', data: null };
        }
        const deliveryPlan = config.deliveryPlan
            ? readSkuLayoutDeliveryPlan(config.deliveryPlan, 1)
            : undefined;
        if (config.deliveryPlan && !deliveryPlan) {
            return { success: false, error: '自选备注交付计划无效或与组合数量不一致。', data: null };
        }
        if (config.editableOutputDir && !deliveryPlan) {
            return { success: false, error: '保存可编辑自选备注必须提供冻结的逐项交付计划。', data: null };
        }
        const noteAutoLayoutPlans: any[] = [];
        const noteLayerIdsForCleanup: number[] = [];
        const notePlannerLayerIds: number[] = [];
        const noteExplicitSingleRowCells: SkuAutoLayoutRect[] = [];
        const notePlaceholderVisibilitySnapshots: SkuPlaceholderVisibilitySnapshot[] = [];
        let noteTemplateDoc: any = null;

        try {
            console.log(`[SKULayout] ★★★ 自选备注顺序占位替换模式 ★★★`);
            console.log(`[SKULayout]   顺序槽位: ${orderedNoteColors.join(' + ')}`);
            console.log(`[SKULayout]   总颜色数: ${totalColors}`);
            console.log(`[SKULayout]   输出文件名: ${noteFileName}`);

            // 1. 识别 SKU 素材文档和自选备注模板
            let skuDoc: any = null;
            let templateDoc: any = null;

            if (config.skuDocName) {
                for (let i = 0; i < app.documents.length; i++) {
                    if (app.documents[i].name === config.skuDocName) {
                        skuDoc = app.documents[i];
                        break;
                    }
                }
            }

            if (config.templateDocName) {
                for (let i = 0; i < app.documents.length; i++) {
                    if (app.documents[i].name === config.templateDocName) {
                        templateDoc = app.documents[i];
                        break;
                    }
                }
            }

            if (!skuDoc) {
                for (let i = 0; i < app.documents.length; i++) {
                    const doc = app.documents[i];
                    const name = (doc.name || '').toLowerCase();
                    if (name.includes('sku') || name.includes('素材')) {
                        skuDoc = doc;
                        break;
                    }
                }
            }

            if (!templateDoc) {
                templateDoc = app.activeDocument;  // 当前活动文档应该是自选备注模板
                const activeDocName = (templateDoc?.name || '').toLowerCase();
                if (activeDocName.includes('sku') || activeDocName.includes('素材')) {
                    templateDoc = null;
                }
            }

            if (!templateDoc) {
                for (let i = 0; i < app.documents.length; i++) {
                    const doc = app.documents[i];
                    const name = (doc.name || '').toLowerCase();
                    if (name.includes('自选备注')) {
                        templateDoc = doc;
                        break;
                    }
                }
            }

            if (config.skuDocName && !skuDoc) {
                return { success: false, error: `未找到指定 SKU 素材文档: ${config.skuDocName}`, data: null };
            }

            if (config.templateDocName && !templateDoc) {
                return { success: false, error: `未找到指定自选备注模板文档: ${config.templateDocName}`, data: null };
            }

            if (!skuDoc) {
                return { success: false, error: '未找到 SKU 素材文档（名称应包含 "SKU"）', data: null };
            }

            if (!templateDoc) {
                return { success: false, error: '没有打开的文档', data: null };
            }
            noteTemplateDoc = templateDoc;

            console.log(`[SKULayout]   SKU 素材: ${skuDoc.name}`);
            console.log(`[SKULayout]   模板: ${templateDoc.name}`);

            // 2. 获取画布尺寸
            const canvasWidth = templateDoc.width;
            const canvasHeight = templateDoc.height;
            console.log(`[SKULayout]   画布: ${canvasWidth}x${canvasHeight}`);

            await core.executeAsModal(async () => {
                // 4. 切换到模板，获取 6.3 顺序占位图层组
                app.activeDocument = templateDoc;

                const templateLayers = templateDoc.layers || [];
                console.log(`[SKULayout] 查找顺序占位组，顶层图层数: ${templateLayers.length}`);

                const autoLayoutObstacles: SkuAutoLayoutObstacle[] = config.autoLayoutWithoutPlaceholders
                    ? collectVisibleSkuTemplateObstacles(Array.from(templateLayers), templateDoc)
                    : [];
                let sortedPlaceholders: SkuReplacementPlaceholder[] = [];
                if (config.autoLayoutWithoutPlaceholders) {
                    sortedPlaceholders = [{
                        layer: null,
                        name: '画布',
                        left: Number(canvasWidth) * 0.05,
                        top: Number(canvasHeight) * 0.35,
                        right: Number(canvasWidth) * 0.95,
                        bottom: Number(canvasHeight) * 0.95,
                        width: Number(canvasWidth) * 0.9,
                        height: Number(canvasHeight) * 0.6
                    }];
                    console.log(`[SKULayout] 自选备注无占位符自动排版：${autoLayoutObstacles.length} 个递归可见前景图层将作为避让元素`);
                } else {
                    sortedPlaceholders = collectOrderedSkuReplacementPlaceholders(
                        templateDoc,
                        orderedNoteColors.length
                    );
                    const inspectionMode = resolveSkuTemplateLayoutInspectionMode(templateDoc, sortedPlaceholders);
                    if (inspectionMode === 'ordered_slots' && sortedPlaceholders.length >= orderedNoteColors.length) {
                        // 顺序槽位足够：一槽一色；多余槽位会在下方隐藏。
                        colorRegions = orderedNoteColors.map((color) => [color]);
                    } else if (sortedPlaceholders.length >= 1) {
                        // 旧版单/多矩形区域必须消费 inspectTemplateLayout 形成的容量计划。
                        // 单区域天然等于 [全部颜色]；多区域禁止在写入时重新猜测分区。
                        const regionCapacities = resolveSkuRegionCapacities({
                            mode: inspectionMode,
                            slotCount: sortedPlaceholders.length,
                            comboSize: orderedNoteColors.length,
                            requested: config.regionCapacities
                        });
                        let colorCursor = 0;
                        colorRegions = regionCapacities.map((capacity) => {
                            const colors = orderedNoteColors.slice(colorCursor, colorCursor + capacity);
                            colorCursor += capacity;
                            return colors;
                        });
                        console.log(
                            `[SKULayout] 自选备注 ${orderedNoteColors.length} 色按容量 [${regionCapacities.join(', ')}] `
                            + `分配到 ${sortedPlaceholders.length} 个参考区域：${JSON.stringify(colorRegions)}`
                        );
                    } else {
                        // 真正 0 槽（既非无占位符自动排版、又找不到任何参考区域）才报错指路
                        throw createSkuPlaceholderMismatchError({
                            headline: `占位槽数量-${sortedPlaceholders.length} 少于自选备注配色数量-${orderedNoteColors.length}：${orderedNoteColors.join('+')}。`,
                            templateDoc,
                            slotCount: sortedPlaceholders.length,
                            requiredCount: orderedNoteColors.length,
                            combo: orderedNoteColors
                        });
                    }
                }

                console.log(`[SKULayout] 顺序占位映射:`);
                sortedPlaceholders.forEach((p, i) => {
                    console.log(`[SKULayout]   ${i + 1}. ${p.name || p.layer?.name || '画布'} (${p.width.toFixed(0)}x${p.height.toFixed(0)}) @ (${p.left.toFixed(0)}, ${p.top.toFixed(0)})`);
                });

                // 矩形占位（区域模型）在区域内分槽时，间距改用从模板量出来的沟槽，
                // 与「区域之间的间距」用同一把尺子；图层组占位是一位一符、位置本就由模板定，不受影响。
                const templateGutter = config.autoLayoutWithoutPlaceholders
                    ? null
                    : resolveSkuTemplateGutterPx({
                        placeholders: sortedPlaceholders,
                        canvasWidth: Number(canvasWidth),
                        canvasHeight: Number(canvasHeight)
                    });
                if (templateGutter) {
                    console.log(
                        `[SKULayout] 区域内沟槽 ${templateGutter.gutterPx.toFixed(1)}px（依据：${templateGutter.basis}）`
                    );
                }
                const numRegions = colorRegions.length;
                const useGlobalFourCardNoteLayout = !config.autoLayoutWithoutPlaceholders
                    && orderedNoteColors.length === 4;

                const effectivePlaceholders = sortedPlaceholders.length;
                const allNoteLayerIds = noteLayerIdsForCleanup;

                // 遍历每个顺序占位槽位
                for (let regionIdx = 0; regionIdx < Math.max(numRegions, effectivePlaceholders); regionIdx++) {
                    this.throwIfCancelled();
                    const placeholderIdx = Math.min(regionIdx, effectivePlaceholders - 1);
                    const placeholder = sortedPlaceholders[placeholderIdx];

                    if (regionIdx >= numRegions) {
                        hideSkuReplacementPlaceholder(placeholder.layer, notePlaceholderVisibilitySnapshots);
                        console.log(`[SKULayout] 跳过空槽位 ${regionIdx + 1}（无对应颜色）`);
                        continue;
                    }

                    const regionColors = colorRegions[regionIdx];
                    const regionColorCount = regionColors.length;

                    if (regionColorCount === 0) {
                        console.log(`[SKULayout] 跳过空槽位 ${regionIdx + 1}`);
                        continue;
                    }

                    console.log(`[SKULayout] ===== 处理槽位 ${regionIdx + 1}/${numRegions} =====`);
                    console.log(`[SKULayout]   占位组: ${placeholder.layer?.name || '画布回退'}`);
                    console.log(`[SKULayout]   颜色: ${regionColors.join(' + ')}`);

                    const placeholderRect = {
                        left: placeholder.left,
                        top: placeholder.top,
                        right: placeholder.right,
                        bottom: placeholder.bottom,
                        width: placeholder.width,
                        height: placeholder.height
                    };

                    console.log(`[SKULayout]   占位尺寸: ${placeholderRect.width.toFixed(0)}x${placeholderRect.height.toFixed(0)}`);
                    console.log(`[SKULayout]   颜色数: ${regionColorCount}`);

                    // 存储当前槽位复制的图层 ID（低层兼容分支可能需要统一定位）
                    const regionLayerIds: number[] = [];

                    // 遍历该区域的每个颜色
                    for (let colorIdx = 0; colorIdx < regionColorCount; colorIdx++) {
                        this.throwIfCancelled();
                        const colorName = regionColors[colorIdx];
                        if (!colorName) continue;

                        console.log(`[SKULayout]   颜色 ${colorIdx + 1}/${regionColorCount}: ${colorName}`);

                        // 切换到 SKU 素材查找颜色图层
                        app.activeDocument = skuDoc;
                        const skuLayers = skuDoc.layers || [];
                        let foundLayer: any = findSkuLayerGroupByName(Array.from(skuLayers), colorName)?.layer || null;
                        if (!foundLayer) {
                            for (let i = 0; i < skuLayers.length; i++) {
                                const layer = skuLayers[i];
                                const layerName = (layer.name || '').replace(/\s+/g, '').trim();
                                const searchName = colorName.replace(/\s+/g, '').trim();

                                if (layerName === searchName || layer.name.trim() === colorName.trim()) {
                                    foundLayer = layer;
                                    break;
                                }
                            }
                        }

                        if (!foundLayer) {
                            console.warn(`[SKULayout]   ⚠️ 未找到颜色图层: ${colorName}`);
                            continue;
                        }

                        // 复制颜色图层到模板。这里只复制并确认完整图层组；缩放和定位必须等
                        // 当前区域的全部颜色到齐后，由统一的 bounded-region 子槽计划一次完成。
                        try {
                            // 复制前先激活模板占位组，避免 duplicate 把新图层放入错误父级。
                            // 步骤 1：切换到模板文档，选中占位组
                            app.activeDocument = templateDoc;
                            const placeholder = sortedPlaceholders[Math.min(regionIdx, sortedPlaceholders.length - 1)];
                            if (placeholder?.layer?.id) {
                                await action.batchPlay([{
                                    _obj: 'select',
                                    _target: [{ _ref: 'layer', _id: placeholder.layer.id }],
                                    makeVisible: false,
                                    _options: { dialogOptions: 'dontDisplay' }
                                }], { synchronousExecution: true });
                                console.log(`[SKULayout]   准备: 选中模板占位矩形 "${placeholder.layer.name}"`);
                            }

                            const targetLayerIdsBefore = collectSkuLayerIds(templateDoc.layers);
                            const topLevelLayerIdsBefore = new Set<number>(
                                Array.from(templateDoc.layers || [])
                                    .map((layer: any) => Number(layer?.id))
                                    .filter(Number.isFinite)
                            );
                            const layerCountBefore = Number(templateDoc.layers?.length || 0);

                            // 步骤 2：切回素材文档，选中颜色图层
                            app.activeDocument = skuDoc;
                            await action.batchPlay([{
                                _obj: 'select',
                                _target: [{ _ref: 'layer', _id: foundLayer.id }],
                                makeVisible: false,
                                _options: { dialogOptions: 'dontDisplay' }
                            }], { synchronousExecution: true });

                            // 步骤 3：复制到模板文档
                            // 按文档 id 投递而不是按名：同名 / 相近名文档并存时（2026-08-18 真机同时开着
                            // 2/3/4双自选备注.tif、4双装.tif、SKU.psb 等），按名投递可能把副本送进别的文档，
                            // 模板里认领不到新增层，后续就会拿整幅层去缩放（读回 800×800「缩放未生效」）。
                            await action.batchPlay([{
                                _obj: 'duplicate',
                                _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                                to: { _ref: 'document', _id: templateDoc.id },
                                _options: { dialogOptions: 'dontDisplay' }
                            }], { synchronousExecution: true });

                            // 复制后只接受本次新增的唯一顶层图层组，禁止把模板原有同名层、
                            // 占位层或错误父级里的局部图层误当成颜色卡。
                            app.activeDocument = templateDoc;
                            const layerCountAfter = Number(templateDoc.layers?.length || 0);
                            const targetLayerIdsAfter = collectSkuLayerIds(templateDoc.layers);
                            for (const newLayerId of targetLayerIdsAfter) {
                                if (!targetLayerIdsBefore.has(newLayerId) && !allNoteLayerIds.includes(newLayerId)) {
                                    allNoteLayerIds.push(newLayerId);
                                }
                            }
                            const newTopLevelLayers = Array.from(templateDoc.layers || [])
                                .filter((layer: any) => !topLevelLayerIdsBefore.has(Number(layer?.id)));
                            let copiedLayer: any = templateDoc.activeLayers?.[0] || null;
                            const activeLayerId = Number(copiedLayer?.id);
                            const activeLayerIsNewTopLevel = Number.isFinite(activeLayerId)
                                && !topLevelLayerIdsBefore.has(activeLayerId);
                            if (!activeLayerIsNewTopLevel || layerCountAfter !== layerCountBefore + 1) {
                                copiedLayer = newTopLevelLayers.length === 1 ? newTopLevelLayers[0] : null;
                            }
                            if (!copiedLayer) {
                                throw new Error(`复制颜色卡失败：${colorName} 没有产生唯一的新顶层图层。`);
                            }
                            assertCopiedSkuLayerStructure({
                                sourceLayer: foundLayer,
                                copiedLayer,
                                sourceName: colorName,
                                previousTargetLayerIds: targetLayerIdsBefore
                            });

                            // 复制后立刻核对尺寸：副本应与色卡里的颜色组同尺寸（允许 5%），且不能等于整张画布。
                            // 2026-08-18 真机 18 项全败于「缩放写入未生效：读回 800×800」——问题其实出在这一步
                            //（副本已经不是那块 154×234 的色块），却拖到缩放步才以一句看不懂的话失败。
                            try {
                                const srcB = foundLayer?.bounds;
                                const dstB = copiedLayer?.bounds;
                                const srcW = Number(srcB?.width ?? (Number(srcB?.right) - Number(srcB?.left)));
                                const srcH = Number(srcB?.height ?? (Number(srcB?.bottom) - Number(srcB?.top)));
                                const dstW = Number(dstB?.width ?? (Number(dstB?.right) - Number(dstB?.left)));
                                const dstH = Number(dstB?.height ?? (Number(dstB?.bottom) - Number(dstB?.top)));
                                const canvasW = Number(templateDoc.width);
                                const canvasH = Number(templateDoc.height);
                                if (srcW > 0 && srcH > 0 && dstW > 0 && dstH > 0) {
                                    const fillsCanvas = Math.abs(dstW - canvasW) <= 1 && Math.abs(dstH - canvasH) <= 1;
                                    const ratioOff = Math.abs(dstW / srcW - 1) > 0.05 || Math.abs(dstH / srcH - 1) > 0.05;
                                    if (fillsCanvas || ratioOff) {
                                        throw new Error(
                                            `颜色「${colorName}」复制到模板「${templateDoc.name}」后尺寸不对：色卡里是 ${srcW.toFixed(0)}×${srcH.toFixed(0)}，`
                                            + `副本读回 ${dstW.toFixed(0)}×${dstH.toFixed(0)}${fillsCanvas ? '（等于整张画布）' : ''}；`
                                            + `色卡分辨率 ${Number(skuDoc.resolution) || '?'}ppi / 模板 ${Number(templateDoc.resolution) || '?'}ppi。`
                                            + `请检查模板是否与色卡同尺寸同分辨率、色卡颜色组内是否只含该色块。`
                                        );
                                    }
                                }
                            } catch (sizeErr: any) {
                                if (/复制到模板/.test(String(sizeErr?.message || ''))) throw sizeErr;
                                console.warn(`[SKULayout]   ⚠️ 复制后尺寸核对未能执行：${sizeErr?.message || sizeErr}`);
                            }

                            const newLayerId = Number(copiedLayer.id);
                            const layerParent = copiedLayer.parent;
                            if (layerParent && layerParent !== templateDoc) {
                                throw new Error(
                                    `复制颜色卡失败：${colorName} 被放入父级 "${layerParent.name || 'unknown'}"，不是模板文档顶层。`
                                );
                            }

                            regionLayerIds.push(newLayerId);
                            if (!notePlannerLayerIds.includes(newLayerId)) {
                                notePlannerLayerIds.push(newLayerId);
                            }
                            console.log(`[SKULayout]   ✓ 复制: ${colorName} -> ID: ${newLayerId}`);
                            console.log(`[SKULayout]     保留复制后原始边界，等待区域子槽计划统一缩放和定位`);
                        } catch (err: any) {
                            throw new Error(`处理颜色卡 ${colorName} 失败：${formatSkuLayoutCaughtError(err)}`);
                        }
                    }

                    if (config.autoLayoutWithoutPlaceholders) {
                        console.log(`[SKULayout]   无占位符模式：稍后由全画布自动排版计划统一处理`);
                    } else {
                        const validLayerIds = regionLayerIds.filter((id) => Number.isFinite(Number(id)));
                        if (validLayerIds.length !== regionColors.length) {
                            throw new Error(
                                `模板区域 ${regionIdx + 1} 计划放置 ${regionColors.length} 个 SKU，`
                                + `实际只复制 ${validLayerIds.length} 个，禁止导出不完整自选备注。`
                            );
                        }

                        const regionItems = validLayerIds
                            .map((layerId): SkuAutoLayoutItem | null => {
                                const layer = findLayerById(templateDoc.layers, layerId);
                                const bounds = getLayerBoundsRect(layer);
                                if (!layer || !bounds || bounds.width <= 0 || bounds.height <= 0) return null;
                                return {
                                    id: String(layerId),
                                    layerId,
                                    name: String(layer.name || layerId),
                                    bounds,
                                    subjectBounds: getSkuAutoLayoutSubjectBounds(layer) || undefined
                                };
                            })
                            .filter(isSkuAutoLayoutItem);
                        if (regionItems.length !== regionColors.length) {
                            throw new Error(`模板区域 ${regionIdx + 1} 的自选备注颜色卡缺少有效真实边界。`);
                        }

                        const boundedRegionPlan = buildSkuBoundedRegionLayoutPlan({
                            region: placeholderRect,
                            items: regionItems,
                            strategy: 'single-row',
                            sizingPolicy: useGlobalFourCardNoteLayout
                                ? 'uniform-width-contain'
                                : 'shared-scale',
                            gutterPx: templateGutter?.gutterPx
                        });
                        if (boundedRegionPlan.status === 'blocked') {
                            throw new Error(
                                `自选备注模板区域 ${regionIdx + 1} 子槽规划失败：`
                                + boundedRegionPlan.diagnostics.blockers.join('；')
                            );
                        }
                        if (useGlobalFourCardNoteLayout) {
                            noteExplicitSingleRowCells.push(
                                ...boundedRegionPlan.placements.map((placement) => placement.cellBox)
                            );
                            hideSkuReplacementPlaceholder(placeholder.layer, notePlaceholderVisibilitySnapshots);
                            console.log(
                                `[SKULayout] 自选备注模板区域 ${regionIdx + 1} 已展开 ${regionColors.length} 个显式槽位，`
                                + '等待四卡全局单行等宽计划统一执行。'
                            );
                        } else {
                            const notePlanRecord: any = {
                                regionIndex: regionIdx,
                                mode: 'bounded_note_region',
                                capacity: regionColors.length,
                                status: boundedRegionPlan.status,
                                strategy: boundedRegionPlan.strategy,
                                placements: boundedRegionPlan.placements.length,
                                blockers: boundedRegionPlan.diagnostics.blockers,
                                warnings: boundedRegionPlan.diagnostics.warnings
                            };
                            noteAutoLayoutPlans.push(notePlanRecord);
                            const appliedRegionPlan = await applySkuAutoLayoutPlan(templateDoc, boundedRegionPlan, {
                                expectedItemCount: regionColors.length,
                                expectedTopLevelLayerIds: validLayerIds
                            });
                            notePlanRecord.autoLayoutQa = appliedRegionPlan.autoLayoutQa;
                            if (
                                appliedRegionPlan.applied !== regionColors.length
                                || appliedRegionPlan.autoLayoutQa.status !== 'ready'
                            ) {
                                throw new Error(
                                    `自选备注模板区域 ${regionIdx + 1} 执行后校验失败：`
                                    + (appliedRegionPlan.autoLayoutQa.blockers.join('；')
                                        || `仅完成 ${appliedRegionPlan.applied}/${regionColors.length}`)
                                );
                            }

                            hideSkuReplacementPlaceholder(placeholder.layer, notePlaceholderVisibilitySnapshots);
                            console.log(
                                `[SKULayout] ✅ 自选备注模板区域 ${regionIdx + 1} 子槽排版完成：`
                                + `${appliedRegionPlan.applied}/${regionColors.length}`
                            );
                        }
                    }

                    console.log(`[SKULayout] ===== 槽位 ${regionIdx + 1} 处理完成 =====`);
                }

                const uniqueNotePlannerLayerIds = Array.from(new Set(notePlannerLayerIds));
                const requiresUnifiedNoteLayout = config.autoLayoutWithoutPlaceholders
                    || useGlobalFourCardNoteLayout;
                if (
                    requiresUnifiedNoteLayout
                    && uniqueNotePlannerLayerIds.length !== orderedNoteColors.length
                ) {
                    throw new Error(
                        `自选备注计划需要 ${orderedNoteColors.length} 个唯一顶层颜色卡，`
                        + `实际复制 ${uniqueNotePlannerLayerIds.length} 个，禁止对子层递归排版或导出不完整结果。`
                    );
                }

                if (requiresUnifiedNoteLayout && uniqueNotePlannerLayerIds.length >= 1) {
                    console.log(
                        useGlobalFourCardNoteLayout
                            ? '[SKULayout] 🎯 自选备注使用四卡全局显式槽位单行等宽模式...'
                            : '[SKULayout] 🎯 自选备注使用无占位符自动排版模式...'
                    );

                    const plannerItems = uniqueNotePlannerLayerIds
                        .map((layerId): SkuAutoLayoutItem | null => {
                            const layer = findLayerById(templateDoc.layers, layerId);
                            const bounds = getLayerBoundsRect(layer);
                            if (!layer || !bounds || bounds.width <= 0 || bounds.height <= 0) return null;
                            const subjectBounds = getSkuAutoLayoutSubjectBounds(layer) ?? undefined;
                            return {
                                id: String(layerId),
                                layerId,
                                name: layer.name || String(layerId),
                                bounds,
                                subjectBounds
                            };
                        })
                        .filter(isSkuAutoLayoutItem);
                    if (plannerItems.length !== orderedNoteColors.length) {
                        throw new Error(
                            `自选备注 planner 只接受唯一顶层颜色卡：期望 ${orderedNoteColors.length} 个，`
                            + `取得 ${plannerItems.length} 个有效实时外框。`
                        );
                    }

                    const plannerObstacles = autoLayoutObstacles;
                    if (
                        useGlobalFourCardNoteLayout
                        && noteExplicitSingleRowCells.length !== orderedNoteColors.length
                    ) {
                        throw new Error(
                            `自选备注四卡全局计划需要 ${orderedNoteColors.length} 个显式槽位，`
                            + `模板实际展开 ${noteExplicitSingleRowCells.length} 个。`
                        );
                    }

                    const actualNoteAutoLayoutPlan = useGlobalFourCardNoteLayout
                        ? buildSkuExplicitSingleRowLayoutPlan({
                            cells: noteExplicitSingleRowCells,
                            items: plannerItems
                        })
                        : buildSkuAutoLayoutPlan({
                            canvas: { width: Number(canvasWidth), height: Number(canvasHeight) },
                            items: plannerItems,
                            obstacles: plannerObstacles,
                            preset: 'sku-note',
                            strategy: plannerItems.length === 4 ? 'single-row' : 'auto',
                            sizingPolicy: plannerItems.length === 4
                                ? 'uniform-width-contain'
                                : 'shared-scale'
                        });

                    noteAutoLayoutPlans.push({
                        mode: useGlobalFourCardNoteLayout
                            ? 'explicit_note_single_row'
                            : 'auto_note_region',
                        capacity: orderedNoteColors.length,
                        status: actualNoteAutoLayoutPlan.status,
                        strategy: actualNoteAutoLayoutPlan.strategy,
                        placements: actualNoteAutoLayoutPlan.placements.length,
                        blockers: actualNoteAutoLayoutPlan.diagnostics.blockers,
                        warnings: actualNoteAutoLayoutPlan.diagnostics.warnings,
                        summary: actualNoteAutoLayoutPlan.diagnostics.summary
                    });

                    if (actualNoteAutoLayoutPlan.status === 'blocked') {
                        const summaryDiagnostic = formatSkuAutoLayoutSummaryDiagnostic(actualNoteAutoLayoutPlan);
                        throw new Error([
                            `自选备注全局自动排版失败：${actualNoteAutoLayoutPlan.diagnostics.blockers.join('；')}`,
                            summaryDiagnostic
                        ].filter(Boolean).join('；'));
                    }

                    const appliedNotePlan = await applySkuAutoLayoutPlan(templateDoc, actualNoteAutoLayoutPlan, {
                        obstacles: plannerObstacles,
                        expectedItemCount: orderedNoteColors.length,
                        expectedTopLevelLayerIds: uniqueNotePlannerLayerIds
                    });
                    const autoLayoutQa = appliedNotePlan.autoLayoutQa;
                    noteAutoLayoutPlans[noteAutoLayoutPlans.length - 1].autoLayoutQa = autoLayoutQa;
                    if (appliedNotePlan.warnings.length > 0) {
                        console.warn(`[SKULayout] 自选备注无占位符自动排版警告: ${appliedNotePlan.warnings.join('；')}`);
                    }
                    if (
                        appliedNotePlan.applied !== orderedNoteColors.length
                        || autoLayoutQa.status !== 'ready'
                    ) {
                        throw new Error(`自选备注全局自动排版执行后校验失败：${autoLayoutQa.blockers.join('；')}`);
                    }
                    console.log(`[SKULayout] ✅ 自选备注全局自动排版完成: ${appliedNotePlan.applied}/${actualNoteAutoLayoutPlan.placements.length}`);
                }

                // ★ 使用占位符逻辑已完成缩放和对齐，无需再编组缩放
                console.log(`[SKULayout] ✅ 排列完成 (顺序占位替换模式)`);

            }, { commandName: '自选备注动态排列' });

            const allNoteQaReady = noteAutoLayoutPlans.length > 0
                && noteAutoLayoutPlans.every((plan) => String(plan?.autoLayoutQa?.status || '') === 'ready');
            if (!allNoteQaReady) {
                throw new Error('自选备注最终实时边界 QA 未达到 ready，已停止导出。');
            }
            const uniqueNoteLayerIds = Array.from(new Set(notePlannerLayerIds));
            const copiedLayerNames = uniqueNoteLayerIds
                .map((layerId) => String(findLayerById(noteTemplateDoc?.layers, layerId)?.name || '').trim())
                .filter(Boolean);
            if (uniqueNoteLayerIds.length !== orderedNoteColors.length
                || copiedLayerNames.length !== uniqueNoteLayerIds.length) {
                throw new Error('自选备注可编辑结构无法绑定全部复制颜色组。');
            }

            // 5. 导出到临时目录
            const exportResult = await this.exportNoteTemplate({
                outputDir: config.outputDir,
                editableOutputDir: config.editableOutputDir,
                deliveryPlan: config.deliveryPlan,
                format: config.format,
                quality: config.quality,
                noteFileName: config.noteFileName,
                structureReadback: {
                    combination: [...orderedNoteColors],
                    copiedLayerIds: uniqueNoteLayerIds,
                    copiedLayerNames,
                    flattened: false,
                    autoLayoutQaStatus: 'ready'
                }
            });

            if (!exportResult.success || exportResult.data?.closeWarning) {
                await cleanupCopiedSkuLayersAfterModal(
                    noteLayerIdsForCleanup,
                    '回滚自选备注模板',
                    Number(noteTemplateDoc?.id),
                    {
                        templateDoc: noteTemplateDoc,
                        placeholderVisibilitySnapshots: notePlaceholderVisibilitySnapshots
                    }
                );
            }

            if (exportResult.success && noteAutoLayoutPlans.length > 0) {
                return {
                    ...exportResult,
                    data: {
                        ...(exportResult.data || {}),
                        noteAutoLayoutPlans
                    }
                };
            }

            return exportResult;

        } catch (error: any) {
            const cancelled = this.isCancellationError(error);
            const rollbackLabel = cancelled
                ? '回滚已取消的自选备注模板'
                : '回滚失败的自选备注模板';
            let rollbackError: unknown = null;
            try {
                await cleanupCopiedSkuLayersAfterModal(
                    noteLayerIdsForCleanup,
                    rollbackLabel,
                    Number(noteTemplateDoc?.id),
                    {
                        templateDoc: noteTemplateDoc,
                        placeholderVisibilitySnapshots: notePlaceholderVisibilitySnapshots
                    }
                );
            } catch (cleanupError: unknown) {
                rollbackError = cleanupError;
            }

            const originalCleanupFailure = extractSkuLayerCleanupFailureData(error);
            if (rollbackError || originalCleanupFailure) {
                const terminalCleanupError = await closeSkuTemplateAfterCleanupFailure({
                    documentId: Number(noteTemplateDoc?.id),
                    label: rollbackLabel,
                    cause: rollbackError || error,
                    pendingLayerIds: noteLayerIdsForCleanup
                });
                return {
                    success: false,
                    error: terminalCleanupError.message,
                    data: { cleanupFailure: terminalCleanupError.skuLayerCleanupFailure }
                };
            }
            if (cancelled) return this.buildCancelledResult();

            console.error(`[SKULayout] 自选备注动态排列失败:`, error);
            const placeholderMismatch = extractSkuPlaceholderMismatchData(error);
            return {
                success: false,
                error: formatSkuLayoutCaughtError(error),
                data: placeholderMismatch ? { placeholderMismatch } : null
            };
        }
    }

    /**
     * 导出自选备注模板
     *
     * ★★★ 最优方案：强制使用临时目录 + Electron 复制 ★★★
     * 使用临时目录 + Electron 复制，降低 UXP 文件入口处理复杂度
     * Agent 端（Node.js）负责把已导出的临时文件复制到目标目录
     */
    private async exportNoteTemplate(config: {
        outputDir?: string;
        editableOutputDir?: string;
        deliveryPlan?: SkuLayoutDeliveryPlan;
        format: string;
        quality: number;
        noteFileName: string;
        structureReadback?: {
            combination: string[];
            copiedLayerIds: number[];
            copiedLayerNames: string[];
            flattened: false;
            autoLayoutQaStatus: 'ready';
        };
    }): Promise<ToolResult<any>> {
        this.throwIfCancelled();
        // 前置校验
        const templateDoc = app.activeDocument;
        if (!templateDoc) {
            return { success: false, error: '没有打开的文档', data: null };
        }

        if (!config.outputDir) {
            return { success: false, error: '必须指定输出目录 (outputDir)', data: null };
        }

        console.log(`[SKULayout] ★ 自选备注导出`);
        console.log(`[SKULayout]   文档: ${templateDoc.name}`);
        console.log(`[SKULayout]   输出文件名: ${config.noteFileName}`);
        console.log(`[SKULayout]   目标目录: ${config.outputDir}`);

        const templateName = templateDoc.name.replace(/\.[^.]+$/, '');
        const outputFileName = config.noteFileName;
        const targetDir = `${config.outputDir}\\${templateName}`;
        const fullPath = `${targetDir}\\${outputFileName}.jpg`;
        const deliveryPlan = config.deliveryPlan
            ? readSkuLayoutDeliveryPlan(config.deliveryPlan, 1)
            : undefined;
        const deliveryItem = deliveryPlan?.items[0];
        const editablePath = config.editableOutputDir
            ? `${config.editableOutputDir}\\${templateName}\\${outputFileName}.psb`
            : '';
        if (config.deliveryPlan && !deliveryPlan) {
            return { success: false, error: '自选备注冻结交付计划无效。', data: null };
        }
        if (deliveryItem
            && (normalizeSkuDeliveryPath(deliveryItem.rasterOutputPath) !== normalizeSkuDeliveryPath(fullPath)
                || normalizeSkuDeliveryPath(deliveryItem.editableOutputPath) !== normalizeSkuDeliveryPath(editablePath))) {
            return { success: false, error: '自选备注实际输出路径与执行前冻结计划不一致。', data: null };
        }
        if (config.editableOutputDir && (!deliveryItem || !config.structureReadback)) {
            return { success: false, error: '自选备注缺少可编辑配对身份或图层结构读回。', data: null };
        }

        const pairHistoryStateRef = readActiveHistoryStateRef(templateDoc);
        if (!pairHistoryStateRef) {
            return { success: false, error: '自选备注导出前无法读取 Photoshop 文档版本。', data: null };
        }
        // 使用 JSX 脚本保存（通过 token/临时 JSX 完成受控保存）
        const saveSuccess = await saveAsJPEGViaJSX(fullPath, config.quality);

        if (!saveSuccess) {
            return {
                success: false,
                error: `JSX 保存失败: ${fullPath}`,
                data: null
            };
        }
        const afterRasterHistoryStateRef = readActiveHistoryStateRef(templateDoc);
        if (!afterRasterHistoryStateRef
            || !sameHistoryStateRef(pairHistoryStateRef, afterRasterHistoryStateRef)) {
            return {
                success: false,
                error: '自选备注 JPG 导出后 Photoshop 文档版本发生变化，无法与可编辑 PSB 形成同画面配对。',
                data: { partialRasterPath: fullPath }
            };
        }

        console.log(`[SKULayout] ✅ 导出成功: ${fullPath}`);
        let editableDocument: any;
        if (config.editableOutputDir) {
            try {
                await core.executeAsModal(async () => {
                    app.activeDocument = templateDoc;
                    const savedEditableDocument = await saveEditableDocumentSnapshotInModal({
                        document: templateDoc,
                        path: editablePath
                    });
                    if (!sameHistoryStateRef(
                        pairHistoryStateRef,
                        savedEditableDocument.sourceHistoryStateRef
                    )) {
                        throw new Error('JPG 与 PSB 不是同一 Photoshop 文档版本。');
                    }
                    editableDocument = {
                        ...savedEditableDocument,
                        deliveryItemId: deliveryItem?.itemId,
                        rasterSourceHistoryStateRef: pairHistoryStateRef,
                        structureReadback: {
                            schema: 'sku-editable-structure-readback/v1',
                            templateName,
                            ...config.structureReadback
                        }
                    };
                }, { commandName: '保存 SKU 自选备注可编辑源稿' });
            } catch (error: any) {
                return {
                    success: false,
                    error: `自选备注 JPG 已导出，但同画面可编辑 PSD 保存失败：${error?.message || error}`,
                    data: {
                        exportedCount: 0,
                        expectedExportCount: 1,
                        partialRasterPath: fullPath
                    }
                };
            }
        }

        // 关闭自选备注模板文档（不保存修改，与组合模板一致）。
        // Photoshop 在 JSX 保存后偶发进入 modal state；导出已经成功时，关闭失败不应覆盖任务结果。
        const templateNameForClose = templateDoc.name;
        let closeWarning: string | undefined;
        try {
            await core.executeAsModal(async () => {
                await (templateDoc as any).closeWithoutSaving();
            }, { commandName: '关闭自选备注模板文档' });
            console.log(`[SKULayout] ✅ 已关闭自选备注模板文档: ${templateNameForClose}`);
        } catch (closeError: any) {
            closeWarning = `导出成功，但关闭自选备注模板失败: ${closeError?.message || closeError}`;
            console.warn(`[SKULayout] ${closeWarning}`);
        }

        return {
            success: true,
            data: {
                exportedCount: 1,
                exportedFiles: [JSON.stringify({
                    path: fullPath,
                    targetName: `${outputFileName}.jpg`,
                    status: 'exported_jsx'
                })],
                ...(editableDocument ? { editableDocuments: [editableDocument] } : {}),
                outputDir: config.outputDir,
                closeWarning
            }
        };
    }

    /**
     * 执行 SKU 组合排版
     *
     * 6.3 核心流程：
     * 1. 识别 SKU 素材文档（包含颜色图层组）和模板文档（包含占位图层）
     * 2. 遍历每个颜色组合
     * 3. 对于每个组合：
     *    a. 获取模板中的占位图层（作为目标区域）
     *    b. 从 SKU 素材复制对应颜色图层组到模板
     *    c. 缩放图层以适应目标区域
     *    d. 对齐图层（左对齐/居中/右对齐）
     *    e. 水平分布所有图层
     * 4. 导出为 JPEG
     * 5. 恢复模板（删除复制的图层）
     */
    /**
     * 执行 SKU 组合排版
     *
     * 正确的工作流程：
     * 1. 打开 SKU 素材文件 → 获取颜色列表
     * 2. 规划颜色组合 → AI/用户决定
     * 3. 打开对应的模板 → 根据组合数量选择模板（2双、3双、4双...）
     * 4. 执行排版 → 复制颜色图层到模板占位区域
     * 5. 导出图片 → 保存 JPEG
     */
    private async executeComboLayout(config: {
        combos: string[][];      // 颜色组合列表
        outputDir?: string;      // 输出目录
        editableOutputDir?: string; // 与每张 raster 同画面的可编辑 PSD 根目录
        deliveryPlan?: SkuLayoutDeliveryPlan;
        format: string;          // 输出格式
        quality: number;         // JPEG 质量
        skuDocName?: string;     // 明确指定 SKU 素材文档名称
        templateDocName?: string; // 明确指定模板文档名称
        autoLayoutWithoutPlaceholders?: boolean; // 无占位符自动排版
        regionCapacities?: number[]; // 6.0 多矩形区域按面板顺序的容量计划
        noteFilePrefix?: string;   // 自选备注文件名前缀（如"2双自选备注"）
        isNoteTemplate?: boolean;  // ★ 是否为自选备注模式（影响文件命名和目录结构）
        // 本批 combos[0] 在同规格全部组合里的下标（batch.rowStartIndex），默认 0。
        // 组合图文件名的序号要在整个规格内连续，而 combos 是分批传进来的、
        // 批内下标每批都从 0 重来；缺了这个偏移，第二批会又从「1」开始。
        comboStartIndex?: number;
    }): Promise<ToolResult<any>> {
        this.throwIfCancelled();
        if (!config.combos || config.combos.length === 0) {
            return { success: false, error: '没有提供颜色组合', data: null };
        }
        const deliveryPlan = config.deliveryPlan
            ? readSkuLayoutDeliveryPlan(config.deliveryPlan, config.combos.length)
            : undefined;
        if (config.deliveryPlan && !deliveryPlan) {
            return { success: false, error: 'SKU 组合交付计划无效或与组合数量不一致。', data: null };
        }
        if (config.editableOutputDir && !deliveryPlan) {
            return { success: false, error: '保存可编辑 SKU 组合必须提供冻结的逐项交付计划。', data: null };
        }

        try {
            // 列出所有打开的文档
            const allDocs: Array<{ name: string; width: number; height: number }> = [];
            for (let i = 0; i < app.documents.length; i++) {
                const doc = app.documents[i];
                allDocs.push({
                    name: doc.name,
                    width: doc.width,
                    height: doc.height
                });
            }
            console.log(`[SKULayout] ==================== 开始执行 ====================`);
            console.log(`[SKULayout] 打开的文档 (${allDocs.length} 个):`);
            allDocs.forEach((d, i) => console.log(`[SKULayout]   ${i + 1}. ${d.name} (${d.width}x${d.height})`));
            console.log(`[SKULayout] 待处理组合: ${config.combos.length} 个`);
            config.combos.forEach((c, i) => console.log(`[SKULayout]   ${i + 1}. ${c.join(' + ')}`));

            // 1. 识别 SKU 素材文档
            let skuDoc: any = null;

            // 如果明确指定了名称，直接查找
            if (config.skuDocName) {
                for (let i = 0; i < app.documents.length; i++) {
                    if (app.documents[i].name === config.skuDocName) {
                        skuDoc = app.documents[i];
                        break;
                    }
                }
            }

            // 否则按关键词查找
            if (!skuDoc) {
            for (let i = 0; i < app.documents.length; i++) {
                const doc = app.documents[i];
                const name = (doc.name || '').toLowerCase();
                if (name.includes('sku') || name.includes('素材')) {
                    skuDoc = doc;
                        break;
                    }
                }
            }

            if (!skuDoc) {
                return {
                    success: false,
                    error: `未找到 SKU 素材文档。\n\n当前打开的文档: ${allDocs.map(d => d.name).join(', ')}\n\n请先打开 SKU 素材文件（名称通常包含 "SKU"）。`,
                    data: null
                };
            }

            console.log(`[SKULayout] ✓ SKU 素材: ${skuDoc.name}`);

            // 2. 识别模板文档
            // ★ 修复：优先使用 app.activeDocument（Agent 已切换到正确的模板）
            // 只有当 activeDocument 是 SKU 素材时，才自动查找其他模板
            let templateDoc: any = null;
            const firstComboSize = config.combos[0]?.length || 2;

            // ★ 优先使用当前活动文档作为模板
            // Agent 端已经通过 switchDocument 切换到了正确的模板
            const activeDoc = app.activeDocument;
            const activeDocName = (activeDoc?.name || '').toLowerCase();

            // 如果当前活动文档不是 SKU 素材，就用它作为模板
            if (activeDoc && !activeDocName.includes('sku') && !activeDocName.includes('素材')) {
                templateDoc = activeDoc;
                console.log(`[SKULayout] ★ 使用当前活动文档作为模板: ${templateDoc.name}`);
            }

            // 如果明确指定了名称，覆盖查找
            if (config.templateDocName) {
                for (let i = 0; i < app.documents.length; i++) {
                    if (app.documents[i].name === config.templateDocName) {
                        templateDoc = app.documents[i];
                        console.log(`[SKULayout] ✓ 使用指定模板: ${templateDoc.name}`);
                        break;
                    }
                }
            }

            // 只有在没有找到模板时，才按组合数量自动查找
            if (!templateDoc) {
                console.log(`[SKULayout] 根据组合数量 ${firstComboSize} 查找对应模板...`);

                const sizeStr = String(firstComboSize);

                for (let i = 0; i < app.documents.length; i++) {
                    const doc = app.documents[i];
                    const name = (doc.name || '').toLowerCase();

                    // 跳过 SKU 素材
                    if (name.includes('sku') || name.includes('素材')) {
                        continue;
                    }

                    // 查找包含对应数量的模板（精确匹配）
                    if (name.includes(sizeStr + '双装') ||
                        name.includes(sizeStr + '双模板') ||
                        name.includes(sizeStr + '双') ||
                        name.includes(sizeStr + '个')) {
                        templateDoc = doc;
                        console.log(`[SKULayout] ✓ 找到模板: ${doc.name}`);
                        break;
                    }
                }
            }

            // 如果还没找到，提示用户需要打开模板
            if (!templateDoc) {
                const templateSuggestion = `${firstComboSize}双模板` ;
                return {
                    success: false,
                    error: `未找到 ${firstComboSize} 双的模板文档。\n\n当前打开的文档: ${allDocs.map(d => d.name).join(', ')}\n\n请打开对应的模板文件（如 "${templateSuggestion}.psd" 或 "${firstComboSize}双自选备注.tif"）。`,
                    data: null
                };
            }

            console.log(`[SKULayout] ✓ 模板: ${templateDoc.name} (${templateDoc.width}x${templateDoc.height})`);
            console.log(`[SKULayout] ====================================================`);
            console.log(`[SKULayout] 待处理组合: ${config.combos.length} 个`);

            const templateOutputName = templateDoc.name.replace(/\.[^.]+$/, '');
            const exportedFiles: string[] = [];
            const editableDocuments: any[] = [];
            const errors: string[] = [];
            const placeholderMismatches: SkuPlaceholderMismatchData[] = [];
            const autoLayoutPlans: any[] = [];
            const templateLayoutPlans: Array<{
                comboIndex: number;
                mode: SkuTemplateLayoutInspectionMode | 'auto_without_placeholders';
                regionCapacities: number[];
                assignments: string[][];
            }> = [];
            const usedComboOutputFileNames = new Set<string>();

            this.progress = {
                current: 0,
                total: config.combos.length,
                message: '开始处理...'
            };

            // 获取图层边界。
            const getBounds = (layer: any): { left: number; top: number; width: number; height: number } => {
                const b = layer.bounds;

                // Photoshop bounds 格式：[left, top, right, bottom] 或 { left, top, right, bottom }
                let left: number, top: number, right: number, bottom: number;

                if (Array.isArray(b) && b.length >= 4) {
                    left = b[0]?.value ?? b[0];
                    top = b[1]?.value ?? b[1];
                    right = b[2]?.value ?? b[2];
                    bottom = b[3]?.value ?? b[3];
                } else {
                    left = b._left ?? b.left;
                    top = b._top ?? b.top;
                    right = b._right ?? b.right;
                    bottom = b._bottom ?? b.bottom;
                }

                return { left, top, width: right - left, height: bottom - top };
            };

            // 2. 遍历每个组合
            for (let comboIndex = 0; comboIndex < config.combos.length; comboIndex++) {
                this.throwIfCancelled();
                const combo = config.combos[comboIndex];
                const comboSize = combo.length;

                this.progress = {
                    current: comboIndex + 1,
                    total: config.combos.length,
                    message: `处理第 ${comboIndex + 1}/${config.combos.length} 个: ${combo.join('+')}`
                };

                const comboLayerIdsForCleanup: number[] = [];

                try {
                    console.log(`[SKULayout] === 开始处理组合 ${comboIndex + 1} ===`);
                    console.log(`[SKULayout]   组合内容: ${combo.join(' + ')}`);
                    console.log(`[SKULayout]   模板文档: ${templateDoc?.name || 'undefined'}`);
                    console.log(`[SKULayout]   SKU文档: ${skuDoc?.name || 'undefined'}`);

                    await core.executeAsModal(async () => {
                        app.activeDocument = templateDoc;

                        const allLayers = templateDoc.layers || [];
                        const autoLayoutObstacles: SkuAutoLayoutObstacle[] = config.autoLayoutWithoutPlaceholders
                            ? collectVisibleSkuTemplateObstacles(Array.from(allLayers), templateDoc)
                            : [];

                        console.log(`[SKULayout] 模板顶层图层数: ${allLayers.length}`);

                        let orderedPlaceholderInfo: SkuReplacementPlaceholder[] = [];
                        if (config.autoLayoutWithoutPlaceholders) {
                            console.log(`[SKULayout] 无占位符自动排版：${autoLayoutObstacles.length} 个递归可见前景图层将作为避让元素，不作为占位符`);
                        } else {
                            orderedPlaceholderInfo = collectOrderedSkuReplacementPlaceholders(templateDoc, comboSize);
                            console.log(`[SKULayout] 顺序占位组（按图层面板顺序）:`);
                            orderedPlaceholderInfo.forEach((placeholder, idx) => {
                                console.log(`[SKULayout]   ${idx + 1}. ${placeholder.name} (${Math.round(placeholder.width)}x${Math.round(placeholder.height)})`);
                            });
                            if (orderedPlaceholderInfo.length === 0) {
                                throw createSkuPlaceholderMismatchError({
                                    headline: `占位槽数量-${orderedPlaceholderInfo.length} 与配色顺序数量-${comboSize} 不匹配：${combo.join('+')}。`,
                                    templateDoc,
                                    slotCount: orderedPlaceholderInfo.length,
                                    requiredCount: comboSize,
                                    combo
                                });
                            }
                        }

                        const sortedPlaceholderInfo: SkuReplacementPlaceholder[] = config.autoLayoutWithoutPlaceholders
                            ? [{
                                layer: null as any,
                                name: '画布',
                                left: 0,
                                top: Number(templateDoc.height) * 0.05,
                                right: Number(templateDoc.width),
                                bottom: Number(templateDoc.height) * 0.95,
                                width: Number(templateDoc.width),
                                height: Number(templateDoc.height) * 0.9
                            }]
                            : orderedPlaceholderInfo;
                        const inspectionMode = config.autoLayoutWithoutPlaceholders
                            ? 'auto_without_placeholders' as const
                            : resolveSkuTemplateLayoutInspectionMode(templateDoc, orderedPlaceholderInfo);
                        const templateGutter = config.autoLayoutWithoutPlaceholders
                            ? null
                            : resolveSkuTemplateGutterPx({
                                placeholders: orderedPlaceholderInfo,
                                canvasWidth: Number(templateDoc.width),
                                canvasHeight: Number(templateDoc.height)
                            });
                        if (templateGutter) {
                            console.log(
                                `[SKULayout] 区域内沟槽 ${templateGutter.gutterPx.toFixed(1)}px（依据：${templateGutter.basis}）`
                            );
                        }
                        if (
                            inspectionMode === 'ordered_slots'
                            && orderedPlaceholderInfo.length !== comboSize
                        ) {
                            throw createSkuPlaceholderMismatchError({
                                headline: `顺序占位槽数量-${orderedPlaceholderInfo.length} 与配色顺序数量-${comboSize} 不匹配：${combo.join('+')}。`,
                                templateDoc,
                                slotCount: orderedPlaceholderInfo.length,
                                requiredCount: comboSize,
                                combo
                            });
                        }
                        const regionCapacities = inspectionMode === 'auto_without_placeholders'
                            ? [comboSize]
                            : resolveSkuRegionCapacities({
                                mode: inspectionMode,
                                slotCount: orderedPlaceholderInfo.length,
                                comboSize,
                                requested: config.regionCapacities
                            });
                        let assignmentCursor = 0;
                        const regionColorAssignments = regionCapacities.map((capacity) => {
                            const colors = combo.slice(assignmentCursor, assignmentCursor + capacity);
                            assignmentCursor += capacity;
                            return colors;
                        });
                        templateLayoutPlans.push({
                            comboIndex,
                            mode: inspectionMode,
                            regionCapacities: [...regionCapacities],
                            assignments: regionColorAssignments.map((colors) => [...colors])
                        });

                        console.log(`[SKULayout] 占位顺序映射:`);
                        sortedPlaceholderInfo.forEach((p, i) => {
                            const regionColors = regionColorAssignments[i] || [];
                            console.log(`[SKULayout]   ${i + 1}: ${p.name || '画布'} → ${regionColors.join(' + ')}`);
                        });

                        // 收集所有复制的图层 ID（用于最后清理）
                        const allCopiedLayerIds = comboLayerIdsForCleanup;

                        // ★★★ 双层循环：遍历每个占位矩形 ★★★
                        for (let placeholderIdx = 0; placeholderIdx < sortedPlaceholderInfo.length; placeholderIdx++) {
                            this.throwIfCancelled();
                            const placeholderInfo = sortedPlaceholderInfo[placeholderIdx];

                            // 6.3 一槽一色与 6.0 区域多色都消费同一份显式区域分配计划。
                            const regionColors = regionColorAssignments[placeholderIdx] || [];

                            if (regionColors.length === 0) {
                                console.log(`[SKULayout] 跳过空区域 ${placeholderIdx + 1}`);
                                continue;
                            }

                            console.log(`[SKULayout] ===== 处理区域 ${placeholderIdx + 1}/${sortedPlaceholderInfo.length} =====`);
                            console.log(`[SKULayout]   占位矩形: ${placeholderInfo.layer?.name || '画布'}`);
                            console.log(`[SKULayout]   颜色: ${regionColors.join(' + ')}`);

                            const placeholderRect = {
                                left: placeholderInfo.left,
                                top: placeholderInfo.top,
                                width: placeholderInfo.width,
                                height: placeholderInfo.height
                            };

                            // 当前区域的复制图层 ID（用于水平分布）
                            const regionLayerIds: number[] = [];

                            // 遍历该区域的每个颜色
                            for (let colorIdx = 0; colorIdx < regionColors.length; colorIdx++) {
                                this.throwIfCancelled();
                                const colorName = regionColors[colorIdx];
                                if (!colorName) continue;

                                console.log(`[SKULayout]   颜色 ${colorIdx + 1}/${regionColors.length}: ${colorName}`);
                            // 在 SKU 文档中找到对应的颜色【图层组】（不是普通图层！）
                            // SKU 素材的结构是：每个颜色是一个图层组，包含主体、阴影、文字等子图层
                            app.activeDocument = skuDoc;

                            // UXP API: 从 layers 中过滤出图层组（有 layers 子属性的就是图层组）
                            // 安全检查：确保 skuDoc.layers 存在
                            const skuLayers = skuDoc.layers || [];
                            if (!skuLayers || skuLayers.length === 0) {
                                throw new Error('SKU 素材文档没有可复制图层。');
                            }
                            const availableGroups: string[] = [];

                            console.log(`[SKULayout] 在 SKU 文档中查找颜色图层组: "${colorName}"`);

                            const allGroups = collectSkuLayerGroups(Array.from(skuLayers));
                            availableGroups.push(...allGroups.map((entry) => entry.path || entry.name));
                            const matchedGroup = findSkuLayerGroupByName(Array.from(skuLayers), colorName);
                            const colorSet: any = matchedGroup?.layer || null;
                            if (colorSet) {
                                console.log(`[SKULayout] ✓ 找到颜色图层组: "${matchedGroup?.path || colorName}" (子图层: ${colorSet.layers.length})`);
                            }

                            if (!colorSet) {
                                throw new Error(
                                    `未找到颜色图层组 "${colorName}"。可用图层组：${availableGroups.join('、') || '无'}`
                                );
                            }

                            // 复制颜色图层组到模板（使用参考脚本的方式）
                            try {
                                console.log(`[SKULayout] 准备复制图层组 "${colorName}" (ID: ${colorSet.id}) 到模板 "${templateDoc.name}"`);

                                // 复制前先激活模板占位组，避免 duplicate 把新图层放入错误父级。
                                // 步骤 1：切换到模板文档，选中当前占位组
                                app.activeDocument = templateDoc;
                                if (placeholderInfo.layer?.id) {
                                    await action.batchPlay([{
                                        _obj: 'select',
                                        _target: [{ _ref: 'layer', _id: placeholderInfo.layer.id }],
                                        makeVisible: false,
                                        _options: { dialogOptions: 'dontDisplay' }
                                    }], { synchronousExecution: true });
                                    console.log(`[SKULayout] 准备: 选中模板占位矩形 "${placeholderInfo.layer.name}"`);
                                }

                                // 步骤 2：切换到 SKU 文档并选中图层组
                                app.activeDocument = skuDoc;

                                // 记录复制前模板的完整图层身份。后续只接受新生成的顶层图层组，
                                // 禁止按同名回退到模板里原有的旧图层。
                                const targetLayerIdsBefore = collectSkuLayerIds(templateDoc.layers);
                                const topLevelLayerIdsBefore = new Set<number>(
                                    Array.from(templateDoc.layers || [])
                                        .map((layer: any) => Number(layer?.id))
                                        .filter(Number.isFinite)
                                );
                                const layerCountBefore = templateDoc.layers.length;

                                // 使用 batchPlay select 选中图层组
                                await action.batchPlay([{
                                    _obj: 'select',
                                    _target: [{ _ref: 'layer', _id: colorSet.id }],
                                    makeVisible: false,
                                    _options: { dialogOptions: 'dontDisplay' }
                                }], { synchronousExecution: true });

                                // 步骤 3：使用参考脚本的 copylay 方法复制
                            await action.batchPlay([{
                                _obj: 'duplicate',
                                _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                                to: { _ref: 'document', _name: templateDoc.name },
                                    version: 5,
                                _options: { dialogOptions: 'dontDisplay' }
                            }], { synchronousExecution: true });

                                // 复制后切回模板文档，并从 activeLayers 获取刚复制的图层。
                            app.activeDocument = templateDoc;

                                // 检查图层数是否增加
                                const layerCountAfter = templateDoc.layers.length;
                                const newTopLevelLayers = Array.from(templateDoc.layers || [])
                                    .filter((layer: any) => !topLevelLayerIdsBefore.has(Number(layer?.id)));
                                for (const newLayer of newTopLevelLayers) {
                                    const newLayerId = Number((newLayer as any)?.id);
                                    if (Number.isFinite(newLayerId) && !allCopiedLayerIds.includes(newLayerId)) {
                                        allCopiedLayerIds.push(newLayerId);
                                    }
                                }
                                console.log(`[SKULayout] 复制后图层数: ${layerCountBefore} → ${layerCountAfter}`);

                                // ★★★ 修复：使用 activeLayers[0] 获取刚复制的图层 ★★★
                                // 与 JSX 的 doc.activeLayer 行为一致
                                let copiedLayer: any = templateDoc.activeLayers?.[0];

                                // 验证是否真的是刚复制的图层
                                if (copiedLayer) {
                                    console.log(`[SKULayout] 通过 activeLayers 获取: ${copiedLayer.name} (ID: ${copiedLayer.id})`);

                                    // 安全检查：确认是新增的图层，而非原有图层
                                    // 如果名称匹配则确认
                                    const copiedId = Number(copiedLayer.id);
                                    const isNewTopLevelLayer = Number.isFinite(copiedId)
                                        && !topLevelLayerIdsBefore.has(copiedId);
                                    if (!isNewTopLevelLayer || layerCountAfter !== layerCountBefore + 1) {
                                        console.warn('[SKULayout] activeLayers 不是本次唯一新增的顶层图层，改按新 ID 查找');
                                        copiedLayer = null;
                                    }
                                }

                                // 回退：只按复制前不存在的新顶层 ID 查找；同名旧图层不具备来源证明。
                                if (!copiedLayer) {
                                    if (newTopLevelLayers.length === 1) copiedLayer = newTopLevelLayers[0];
                                }

                                if (!copiedLayer) {
                                    throw new Error(`复制图层组失败：${colorName} 没有产生唯一的新顶层图层。`);
                                }

                                assertCopiedSkuLayerStructure({
                                    sourceLayer: colorSet,
                                    copiedLayer,
                                    sourceName: colorName,
                                    previousTargetLayerIds: targetLayerIdsBefore
                                });

                                // ★★★ 诊断：验证图层位置是否在顶层 ★★★
                                // 检查 parent 属性，如果是 null 或 document，说明在顶层
                                const layerParent = copiedLayer.parent;
                                if (layerParent && layerParent !== templateDoc) {
                                    throw new Error(
                                        `复制图层组失败：${colorName} 被放入父级 "${layerParent.name || 'unknown'}"，`
                                        + '不是模板文档顶层。'
                                    );
                                }
                                console.log(`[SKULayout] ✓ 确认: 图层 "${copiedLayer.name}" 在文档顶层`);

                                // 验证是否是图层组
                                const isGroup = getLayerChildren(copiedLayer).length > 0;
                                console.log(`[SKULayout] ✓ 复制成功: ${colorName} (ID: ${copiedLayer.id}, 是图层组: ${isGroup}, 子图层: ${isGroup ? copiedLayer.layers.length : 0})`);

                                // ★ 添加到区域图层列表和全局列表
                                regionLayerIds.push(copiedLayer.id);

                                // 获取复制图层的边界
                                const layerBounds = getBounds(copiedLayer);
                                if (!layerBounds || layerBounds.width <= 0 || layerBounds.height <= 0) {
                                    throw new Error(`复制图层组 ${colorName} 后缺少有效边界。`);
                                }

                                if (config.autoLayoutWithoutPlaceholders) {
                                    console.log(`[SKULayout] 无占位符模式：保留 ${colorName} 的复制后原始边界，交给自动排版计划统一缩放和定位`);
                                } else {
                                    console.log(
                                        `[SKULayout] 已复制 ${colorName} (${Math.round(layerBounds.width)}x${Math.round(layerBounds.height)})，`
                                        + '等待当前模板区域的统一子槽规划'
                                    );
                                }
                            } catch (copyErr: any) {
                                console.error(`[SKULayout] 复制图层异常: ${colorName} - ${copyErr.message}`);
                                throw new Error(`复制 SKU "${colorName}" 失败：${copyErr.message}`);
                            }
                        }

                        console.log(`[SKULayout] ===== 槽位 ${placeholderIdx + 1} 定位收尾 =====`);

                        const validLayerIds = regionLayerIds.filter(id => id !== undefined && id !== null && !isNaN(id));

                        // ===== 无占位符自动排版模式 =====
                        if (config.autoLayoutWithoutPlaceholders && validLayerIds.length >= 1) {
                            console.log(`[SKULayout] 🎯 使用无占位符自动排版模式...`);
                            if (validLayerIds.length !== regionColors.length) {
                                throw new Error(
                                    `无占位符模板计划放置 ${regionColors.length} 个 SKU，`
                                    + `实际只有 ${validLayerIds.length} 个唯一顶层颜色卡。`
                                );
                            }

                            const canvasWidth = Number(templateDoc.width);
                            const canvasHeight = Number(templateDoc.height);
                            const plannerItems = validLayerIds
                                .map((layerId): SkuAutoLayoutItem | null => {
                                    const layer = findLayerById(templateDoc.layers, layerId);
                                    const bounds = getLayerBoundsRect(layer);
                                    if (!layer || !bounds || bounds.width <= 0 || bounds.height <= 0) return null;
                                    const subjectBounds = getSkuAutoLayoutSubjectBounds(layer) ?? undefined;
                                    return {
                                        id: String(layerId),
                                        layerId,
                                        name: layer.name || String(layerId),
                                        bounds,
                                        subjectBounds
                                    };
                                })
                                .filter(isSkuAutoLayoutItem);

                            const plannerObstacles = autoLayoutObstacles;

                            const actualAutoLayoutPlan = buildSkuAutoLayoutPlan({
                                canvas: { width: canvasWidth, height: canvasHeight },
                                items: plannerItems,
                                obstacles: plannerObstacles,
                                preset: config.isNoteTemplate ? 'sku-note' : 'sku-combo',
                                strategy: config.isNoteTemplate && plannerItems.length === 4 ? 'single-row' : 'auto',
                                sizingPolicy: config.isNoteTemplate && plannerItems.length === 4
                                    ? 'uniform-width-contain'
                                    : 'shared-scale'
                            });

                            autoLayoutPlans.push({
                                comboIndex,
                                regionIndex: placeholderIdx,
                                status: actualAutoLayoutPlan.status,
                                strategy: actualAutoLayoutPlan.strategy,
                                placements: actualAutoLayoutPlan.placements.length,
                                blockers: actualAutoLayoutPlan.diagnostics.blockers,
                                warnings: actualAutoLayoutPlan.diagnostics.warnings,
                                summary: actualAutoLayoutPlan.diagnostics.summary
                            });

                            if (actualAutoLayoutPlan.status === 'blocked') {
                                const summaryDiagnostic = formatSkuAutoLayoutSummaryDiagnostic(actualAutoLayoutPlan);
                                throw new Error([
                                    `无占位符自动排版失败：${actualAutoLayoutPlan.diagnostics.blockers.join('；')}`,
                                    summaryDiagnostic
                                ].filter(Boolean).join('；'));
                            }

                            const appliedPlan = await applySkuAutoLayoutPlan(templateDoc, actualAutoLayoutPlan, {
                                obstacles: plannerObstacles,
                                expectedItemCount: regionColors.length,
                                expectedTopLevelLayerIds: validLayerIds
                            });
                            const autoLayoutQa = appliedPlan.autoLayoutQa;
                            autoLayoutPlans[autoLayoutPlans.length - 1].autoLayoutQa = autoLayoutQa;
                            if (appliedPlan.warnings.length > 0) {
                                console.warn(`[SKULayout] 无占位符自动排版警告: ${appliedPlan.warnings.join('；')}`);
                            }
                            if (
                                appliedPlan.applied !== regionColors.length
                                || autoLayoutQa.status !== 'ready'
                            ) {
                                throw new Error(`无占位符自动排版执行后校验失败：${autoLayoutQa.blockers.join('；')}`);
                            }
                            console.log(`[SKULayout] ✅ 无占位符自动排版完成: ${appliedPlan.applied}/${actualAutoLayoutPlan.placements.length}`);
                        }
                        // ===== 模板声明区域的确定性子槽排版 =====
                        else {
                            if (validLayerIds.length !== regionColors.length) {
                                throw new Error(
                                    `模板区域 ${placeholderIdx + 1} 计划放置 ${regionColors.length} 个 SKU，`
                                    + `实际只复制 ${validLayerIds.length} 个，禁止导出不完整组合。`
                                );
                            }

                            const regionItems = validLayerIds
                                .map((layerId): SkuAutoLayoutItem | null => {
                                    const layer = findLayerById(templateDoc.layers, layerId);
                                    const bounds = getLayerBoundsRect(layer);
                                    if (!layer || !bounds || bounds.width <= 0 || bounds.height <= 0) return null;
                                    return {
                                        id: String(layerId),
                                        layerId,
                                        name: String(layer.name || layerId),
                                        bounds,
                                        subjectBounds: getSkuAutoLayoutSubjectBounds(layer) || undefined
                                    };
                                })
                                .filter(isSkuAutoLayoutItem);
                            if (regionItems.length !== regionColors.length) {
                                throw new Error(`模板区域 ${placeholderIdx + 1} 的复制图层缺少有效真实边界。`);
                            }

                            const boundedRegionPlan = buildSkuBoundedRegionLayoutPlan({
                                region: {
                                    left: placeholderRect.left,
                                    top: placeholderRect.top,
                                    right: placeholderRect.left + placeholderRect.width,
                                    bottom: placeholderRect.top + placeholderRect.height,
                                    width: placeholderRect.width,
                                    height: placeholderRect.height
                                },
                                items: regionItems,
                                gutterPx: templateGutter?.gutterPx
                            });
                            autoLayoutPlans.push({
                                comboIndex,
                                regionIndex: placeholderIdx,
                                mode: 'bounded_template_region',
                                capacity: regionColors.length,
                                status: boundedRegionPlan.status,
                                strategy: boundedRegionPlan.strategy,
                                placements: boundedRegionPlan.placements.length,
                                blockers: boundedRegionPlan.diagnostics.blockers,
                                warnings: boundedRegionPlan.diagnostics.warnings
                            });
                            if (boundedRegionPlan.status === 'blocked') {
                                throw new Error(
                                    `模板区域 ${placeholderIdx + 1} 子槽规划失败：`
                                    + boundedRegionPlan.diagnostics.blockers.join('；')
                                );
                            }

                            const appliedRegionPlan = await applySkuAutoLayoutPlan(templateDoc, boundedRegionPlan, {
                                expectedItemCount: regionColors.length,
                                expectedTopLevelLayerIds: validLayerIds
                            });
                            const regionQa = appliedRegionPlan.autoLayoutQa;
                            autoLayoutPlans[autoLayoutPlans.length - 1].autoLayoutQa = regionQa;
                            if (appliedRegionPlan.applied !== regionColors.length || regionQa.status !== 'ready') {
                                throw new Error(
                                    `模板区域 ${placeholderIdx + 1} 执行后校验失败：`
                                    + (regionQa.blockers.join('；') || `仅完成 ${appliedRegionPlan.applied}/${regionColors.length}`)
                                );
                            }

                            hideSkuReplacementPlaceholder(placeholderInfo.layer);
                            console.log(
                                `[SKULayout] ✅ 模板区域 ${placeholderIdx + 1} 子槽排版完成：`
                                + `${appliedRegionPlan.applied}/${regionColors.length}`
                            );
                        }

                        console.log(`[SKULayout] ===== 槽位 ${placeholderIdx + 1} 处理完成 =====`);

                        } // ★★★ 结束占位矩形循环 ★★★

                        console.log(`[SKULayout] ★ 所有 ${sortedPlaceholderInfo.length} 个槽位处理完成，准备导出`);

                        const currentComboQaPlans = autoLayoutPlans.filter((plan) => plan?.comboIndex === comboIndex);
                        const currentComboQaReady = currentComboQaPlans.length > 0
                            && currentComboQaPlans.every((plan) => String(plan?.autoLayoutQa?.status || '') === 'ready');
                        if (!currentComboQaReady) {
                            throw new Error(`组合 ${comboIndex + 1} 最终实时边界 QA 未达到 ready，已停止导出。`);
                        }
                        const copiedLayerIds = Array.from(new Set(comboLayerIdsForCleanup));
                        const copiedLayerNames = copiedLayerIds
                            .map((layerId) => String(findLayerById(templateDoc.layers, layerId)?.name || '').trim())
                            .filter(Boolean);
                        if (copiedLayerIds.length !== comboSize
                            || copiedLayerNames.length !== copiedLayerIds.length) {
                            throw new Error(`组合 ${comboIndex + 1} 无法把可编辑结构绑定到全部颜色组。`);
                        }

                        // 获取模板名称（去掉扩展名）
                        const templateName = templateOutputName;

                        // 构建输出文件名
                        // 如果是自选备注模式（isNoteTemplate），使用简化格式
                        let outputSubPath: string;
                        let outputFileName: string;

                        if (config.isNoteTemplate && config.noteFilePrefix) {
                            // ★ 自选备注模式：只导出 1 张图，不带序号
                            // 例如："4双自选备注" (直接使用前缀，颜色已经排列在模板上)
                            outputFileName = config.noteFilePrefix;
                            outputSubPath = `${templateName}/${outputFileName}`;
                            console.log(`[SKULayout] 自选备注文件名: ${outputFileName} (展示颜色: ${combo.join('+')})`);
                        } else if (config.noteFilePrefix) {
                            // 非自选备注但有前缀：使用前缀 + 序号
                            outputFileName = `${config.noteFilePrefix}-${comboIndex + 1}`;
                            outputSubPath = `${templateName}/${outputFileName}`;
                        } else {
                            // 普通组合模式：交付文件名 = 序号 + 颜色组合（用户命名规范），例如「1白色+黑色」。
                            // 序号取全局下标：批内 comboIndex + 本批起始偏移，保证同规格目录内连续不重号。
                            const comboOrder = Math.max(0, Number(config.comboStartIndex) || 0) + comboIndex + 1;
                            outputFileName = buildSkuComboExportFileName(combo, comboOrder, usedComboOutputFileNames);
                            outputSubPath = `${templateName}/${outputFileName}`;
                        }

                        // 导出到当前任务目标目录
                        const quality = config.quality || 10;
                        app.activeDocument = templateDoc;

                        if (!config.outputDir) {
                            errors.push(`组合 ${comboIndex + 1}: 必须指定输出目录`);
                        } else {
                            const targetDir = `${config.outputDir}\\${templateName}`;
                            const fullPath = `${targetDir}\\${outputFileName}.jpg`;
                            const editablePath = config.editableOutputDir
                                ? `${config.editableOutputDir}\\${templateName}\\${outputFileName}.psb`
                                : '';
                            const deliveryItem = deliveryPlan?.items[comboIndex];
                            if (deliveryItem
                                && (normalizeSkuDeliveryPath(deliveryItem.rasterOutputPath)
                                    !== normalizeSkuDeliveryPath(fullPath)
                                    || normalizeSkuDeliveryPath(deliveryItem.editableOutputPath)
                                        !== normalizeSkuDeliveryPath(editablePath))) {
                                throw new Error(`组合 ${comboIndex + 1} 的实际输出路径与执行前冻结计划不一致。`);
                            }
                            if (config.editableOutputDir && !deliveryItem) {
                                throw new Error(`组合 ${comboIndex + 1} 缺少可编辑配对身份。`);
                            }
                            const pairHistoryStateRef = readActiveHistoryStateRef(templateDoc);
                            if (!pairHistoryStateRef) {
                                throw new Error(`组合 ${comboIndex + 1} 导出前无法读取 Photoshop 文档版本。`);
                            }

                            // 使用 JSX 脚本保存（通过 token/临时 JSX 完成受控保存）
                            const saveSuccess = await saveAsJPEGViaJSX(fullPath, quality);

                            if (!saveSuccess) {
                                errors.push(`组合 ${comboIndex + 1}: JSX 保存失败 ${fullPath}`);
                            } else {
                                const afterRasterHistoryStateRef = readActiveHistoryStateRef(templateDoc);
                                if (!afterRasterHistoryStateRef
                                    || !sameHistoryStateRef(pairHistoryStateRef, afterRasterHistoryStateRef)) {
                                    throw new Error(`组合 ${comboIndex + 1} JPG 导出后文档版本发生变化。`);
                                }
                                if (config.editableOutputDir) {
                                    const savedEditableDocument = await saveEditableDocumentSnapshotInModal({
                                        document: templateDoc,
                                        path: editablePath
                                    });
                                    if (!sameHistoryStateRef(
                                        pairHistoryStateRef,
                                        savedEditableDocument.sourceHistoryStateRef
                                    )) {
                                        throw new Error(`组合 ${comboIndex + 1} 的 JPG 与 PSB 不是同一文档版本。`);
                                    }
                                    editableDocuments.push({
                                        ...savedEditableDocument,
                                        deliveryItemId: deliveryItem?.itemId,
                                        rasterSourceHistoryStateRef: pairHistoryStateRef,
                                        structureReadback: {
                                            schema: 'sku-editable-structure-readback/v1',
                                            templateName,
                                            combination: [...combo],
                                            copiedLayerIds,
                                            copiedLayerNames,
                                            flattened: false,
                                            autoLayoutQaStatus: 'ready'
                                        }
                                    });
                                }
                                exportedFiles.push(JSON.stringify({
                                    path: fullPath,
                                    targetName: `${outputFileName}.jpg`,
                                    status: 'exported_jsx'
                                }));
                                console.log(`[SKULayout] ✅ 导出成功: ${fullPath}`);
                            }
                        }

                        // 清理复制的图层（恢复模板原状）。失败路径由外层 catch 再做清理，避免残留影响下一组。
                        await deleteCopiedSkuLayers(
                            Number(templateDoc?.id),
                            allCopiedLayerIds,
                            `组合 ${comboIndex + 1} 清理复制图层`
                        );

                    }, { commandName: `执行组合排版 ${comboIndex + 1}` });

                } catch (err: any) {
                    console.error(`[SKULayout] 处理组合 ${comboIndex + 1} 失败:`, err);
                    const cleanupLabel = `清理失败组合 ${comboIndex + 1} 的复制图层`;
                    let rollbackError: unknown = null;
                    try {
                        await cleanupCopiedSkuLayersAfterModal(
                            comboLayerIdsForCleanup,
                            cleanupLabel,
                            Number(templateDoc?.id),
                            { templateDoc }
                        );
                    } catch (cleanupError: unknown) {
                        rollbackError = cleanupError;
                    }
                    const originalCleanupFailure = extractSkuLayerCleanupFailureData(err);
                    if (rollbackError || originalCleanupFailure) {
                        throw await closeSkuTemplateAfterCleanupFailure({
                            documentId: Number(templateDoc?.id),
                            label: cleanupLabel,
                            cause: rollbackError || err,
                            pendingLayerIds: comboLayerIdsForCleanup
                        });
                    }
                    if (this.isCancellationError(err)) throw err;
                    const comboMismatch = extractSkuPlaceholderMismatchData(err);
                    if (comboMismatch) placeholderMismatches.push(comboMismatch);
                    errors.push(`组合 ${comboIndex + 1}: ${formatSkuLayoutCaughtError(err)}`);
                }
            }

            this.progress = {
                current: config.combos.length,
                total: config.combos.length,
                message: '完成'
            };

            // 关闭模板文档（不保存修改）
            const templateNameForClose = templateDoc.name;
            await core.executeAsModal(async () => {
                await templateDoc.closeWithoutSaving();
            }, { commandName: '关闭模板文档' });
            console.log(`[SKULayout] ✅ 已关闭模板文档: ${templateNameForClose}`);

            const editableDocumentsComplete = !config.editableOutputDir
                || editableDocuments.length === config.combos.length;
            const allCombosExported = exportedFiles.length === config.combos.length
                && editableDocumentsComplete
                && errors.length === 0;
            return {
                success: allCombosExported,
                error: !allCombosExported
                    ? buildSkuLayoutPrimaryFailureReason({
                        errors,
                        autoLayoutPlans,
                        fallback: `仅导出 ${exportedFiles.length}/${config.combos.length} 个组合文件`
                    })
                    : undefined,
                data: {
                    exportedCount: exportedFiles.length,
                    expectedExportCount: config.combos.length,
                    partial: exportedFiles.length > 0 && !allCombosExported,
                    exportedFiles,
                    ...(config.editableOutputDir ? { editableDocuments } : {}),
                    errors: errors.length > 0 ? errors : undefined,
                    placeholderMismatches: placeholderMismatches.length > 0 ? placeholderMismatches : undefined,
                    templateLayoutPlans: templateLayoutPlans.length > 0 ? templateLayoutPlans : undefined,
                    autoLayoutPlans: autoLayoutPlans.length > 0 ? autoLayoutPlans : undefined,
                    outputDir: config.outputDir,
                    format: config.format,
                    quality: config.quality
                }
            };

        } catch (error: any) {
            if (this.isCancellationError(error)) {
                return this.buildCancelledResult();
            }
            console.error('[SKULayout] executeComboLayout 错误:', error);
            const cleanupFailure = extractSkuLayerCleanupFailureData(error);
            return {
                success: false,
                error: formatSkuLayoutCaughtError(error),
                data: cleanupFailure ? { cleanupFailure } : null
            };
        }
    }

    /**
     * 批量执行 SKU 排版
     */
    private async executeBatch(config?: {
        items: Array<{
            skuDocName: string;
            templateDocName: string;
            colorMappings: Array<{
                layerIndex: number;
                colorNames: string[];
            }>;
            outputName?: string;
        }>;
        outputPath?: string;
        quality?: number;
    }): Promise<ToolResult<any>> {
        if (!config || !config.items || config.items.length === 0) {
            return { success: false, error: '缺少批量配置', data: null };
        }

        const results: Array<{ index: number; success: boolean; message: string }> = [];
        this.progress = { current: 0, total: config.items.length, message: '开始批量处理...' };

        for (let i = 0; i < config.items.length; i++) {
            this.throwIfCancelled();
            this.progress = {
                current: i + 1,
                total: config.items.length,
                message: `处理第 ${i + 1}/${config.items.length} 个...`
            };

            const result = await this.executeOneSKU(i, {
                ...config.items[i],
                quality: config.quality
            });

            results.push({
                index: i,
                success: result.success,
                message: result.success ? '成功' : (result.error || '未知错误')
            });
        }

        const successCount = results.filter(r => r.success).length;
        this.progress = {
            current: config.items.length,
            total: config.items.length,
            message: `完成: ${successCount}/${config.items.length} 成功`
        };

        const allItemsSucceeded = successCount === config.items.length;
        return {
            success: allItemsSucceeded,
            error: allItemsSucceeded
                ? undefined
                : `批量 SKU 排版仅完成 ${successCount}/${config.items.length} 项。`,
            data: {
                total: config.items.length,
                successCount,
                failCount: config.items.length - successCount,
                results
            }
        };
    }
}

export default SKULayoutTool;
