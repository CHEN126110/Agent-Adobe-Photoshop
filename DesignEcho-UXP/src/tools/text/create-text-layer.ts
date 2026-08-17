/**
 * 创建文字图层工具
 */

import { action } from 'photoshop';
import { createToolFailureResult } from '../../core/tool-error-normalizer';
import {
    normalizePhotoshopTextContent,
    toPhotoshopTextKey as toSharedPhotoshopTextKey
} from '../../core/photoshop-text-content';
import {
    buildPhotoshopTransactionMutationOutcome,
    photoshopTransactionRunner,
    type PhotoshopTransactionPreparation
} from '../../core/photoshop-transaction-runner';
import type { Tool, ToolExecutionContext } from '../types';
import { FontSuggestion, ResolvedFontInfo, resolveFont } from './font-resolver';

const { LayerKind } = require('photoshop').constants;

interface RGBColorValue {
    r: number;
    g: number;
    b: number;
}

interface CreateTextLayerParams {
    content?: string;
    text?: string;
    name?: string;
    x: number;
    y: number;
    fontSize?: number;
    fontName?: string;
    tracking?: number;
    leading?: number;
    colorHex?: string;
    color?: RGBColorValue;
    alignment?: 'left' | 'center' | 'right';
}

interface TextLayerBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

interface CreatedTextLayerState {
    layerId: number;
    name: string;
    content: string;
    isTextLayer: boolean;
    bounds: TextLayerBounds;
}

interface CreateTextLayerBefore {
    documentId: number;
    beforeLayerIds: number[];
    expectedName: string;
    expectedContent: string;
    expectedX: number;
    expectedY: number;
}

interface CreateTextLayerReadback {
    documentId: number;
    currentLayerIds: number[];
    createdLayer?: CreatedTextLayerState;
}

interface CreateTextLayerReceipt {
    createdLayerId: number;
}

interface CreateTextLayerResult extends Record<string, unknown> {
    success: boolean;
    entityType?: 'text';
    documentId?: number;
    layerId?: number;
    name?: string;
    layerName?: string;
    content?: string;
    bounds?: TextLayerBounds;
    message?: string;
    resolvedFont?: ResolvedFontInfo;
    fontSuggestions?: FontSuggestion[];
    code?: string;
    error?: string;
    errorDetails?: unknown;
}

function tryHexToRgb(hex: string): RGBColorValue {
    const normalized = String(hex || '').trim();
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(normalized);
    return result
        ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        }
        : { r: 0, g: 0, b: 0 };
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function normalizeColor(color?: RGBColorValue, colorHex?: string): RGBColorValue {
    if (color && [color.r, color.g, color.b].every(channel => Number.isFinite(channel))) {
        return color;
    }
    return tryHexToRgb(colorHex || '#000000');
}

function normalizeTextContent(content: string): string {
    // 换行口径统一走 core/photoshop-text-content；首尾空白是模型声明内容的一部分，原样保留。
    return normalizePhotoshopTextContent(content);
}

function toPhotoshopTextKey(content: string): string {
    // Photoshop 的段落分隔符是 \r，写 \n 会得到"看起来只有一行"的文字层
    return toSharedPhotoshopTextKey(normalizeTextContent(content));
}

function collectLayerIds(container: any): number[] {
    const layerIds: number[] = [];
    for (const layer of container.layers || []) {
        const layerId = Number(layer?.id);
        if (Number.isSafeInteger(layerId) && layerId > 0) {
            layerIds.push(layerId);
        }
        if (layer?.layers) {
            layerIds.push(...collectLayerIds(layer));
        }
    }
    return layerIds;
}

function findLayerById(container: any, layerId: number): any | null {
    for (const layer of container.layers || []) {
        if (Number(layer?.id) === layerId) return layer;
        if (layer?.layers) {
            const nested = findLayerById(layer, layerId);
            if (nested) return nested;
        }
    }
    return null;
}

function readTextLayerBounds(layer: any): TextLayerBounds {
    const bounds = layer?.bounds || {};
    const left = Number(bounds.left);
    const top = Number(bounds.top);
    const right = Number(bounds.right);
    const bottom = Number(bounds.bottom);
    return {
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top
    };
}

function readCreatedTextLayerState(document: any, layerId: number): CreatedTextLayerState | undefined {
    const layer = findLayerById(document, layerId);
    if (!layer) return undefined;
    return {
        layerId: Number(layer.id),
        name: String(layer.name || ''),
        content: normalizePhotoshopTextContent(layer.textItem?.contents),
        isTextLayer: layer.kind === LayerKind.TEXT,
        bounds: readTextLayerBounds(layer)
    };
}

function sameLayerIdSet(left: number[], right: number[]): boolean {
    if (left.length !== right.length) return false;
    const expected = new Set(left);
    return right.every(layerId => expected.has(layerId));
}

function nearlyEqual(left: number, right: number, tolerance = 1): boolean {
    return Number.isFinite(left)
        && Number.isFinite(right)
        && Math.abs(left - right) <= tolerance;
}

function buildCreateTextFailure(
    params: CreateTextLayerParams,
    code: string,
    error: string,
    extra: Partial<CreateTextLayerResult> = {}
): CreateTextLayerResult {
    return {
        ...createToolFailureResult({ toolName: 'createTextLayer', error, params }),
        ...extra,
        success: false,
        code,
        error
    };
}

export class CreateTextLayerTool implements Tool {
    name = 'createTextLayer';
    schema = {
        name: 'createTextLayer',
        description: '在 Photoshop 中创建文字图层，可指定内容、位置、字号、颜色、字距、行高和对齐方式。',
        parameters: {
            type: 'object' as const,
            properties: {
                content: { type: 'string', description: '文字内容。' },
                text: { type: 'string', description: '文字内容，content 的别名。' },
                name: { type: 'string', description: '图层名称，默认使用文字内容。' },
                x: { type: 'number', description: '文字位置 X 坐标（像素）。' },
                y: { type: 'number', description: '文字位置 Y 坐标（像素）。' },
                fontSize: { type: 'number', description: '字号（point），默认 24。' },
                fontName: { type: 'string', description: '字体名称、字体族或 PostScript 名称；会先经 resolveFontName 精确解析，解析失败不创建带 fallback 字体的文字。' },
                tracking: { type: 'number', description: '字间距（Photoshop tracking，千分之一 em）。' },
                leading: { type: 'number', description: '行高（point）。' },
                colorHex: { type: 'string', description: '文字颜色，十六进制，例如 #000000。' },
                color: { type: 'object', description: '文字颜色 RGB 对象，优先级高于 colorHex。' },
                alignment: {
                    type: 'string',
                    enum: ['left', 'center', 'right'],
                    description: '段落对齐方式。'
                }
            },
            required: ['x', 'y']
        }
    };

    async execute(
        params: CreateTextLayerParams,
        context?: ToolExecutionContext
    ): Promise<CreateTextLayerResult> {
        const safeParams = params || ({} as CreateTextLayerParams);
        const content = normalizeTextContent(String(safeParams.content ?? safeParams.text ?? ''));
        if (!content.trim()) {
            return buildCreateTextFailure(
                safeParams,
                'create_text_layer_content_required',
                '文字内容不能为空。请提供要创建的文字后再继续。'
            );
        }
        if (!isFiniteNumber(safeParams.x) || !isFiniteNumber(safeParams.y)) {
            return buildCreateTextFailure(
                safeParams,
                'create_text_layer_position_invalid',
                '文字位置无效：x 和 y 必须是有限数值。请重新读取画布位置后再继续。'
            );
        }

        const fontSize = safeParams.fontSize ?? 24;
        if (!isFiniteNumber(fontSize) || fontSize <= 0) {
            return buildCreateTextFailure(
                safeParams,
                'create_text_layer_font_size_invalid',
                '字号无效：fontSize 必须大于 0。请修正字号后再继续。'
            );
        }
        if (safeParams.tracking !== undefined && !isFiniteNumber(safeParams.tracking)) {
            return buildCreateTextFailure(
                safeParams,
                'create_text_layer_tracking_invalid',
                '字间距无效：tracking 必须是有限数值。请修正字间距后再继续。'
            );
        }
        if (safeParams.leading !== undefined
            && (!isFiniteNumber(safeParams.leading) || safeParams.leading <= 0)) {
            return buildCreateTextFailure(
                safeParams,
                'create_text_layer_leading_invalid',
                '行高无效：leading 必须是大于 0 的有限数值。请修正行高后再继续。'
            );
        }

        const alignment = safeParams.alignment || 'left';
        const color = normalizeColor(safeParams.color, safeParams.colorHex);
        const layerName = safeParams.name?.trim() || content;
        let resolvedFont: ResolvedFontInfo | null = null;
        let fontSuggestions: FontSuggestion[] = [];

        if (safeParams.fontName && safeParams.fontName.trim()) {
            const fontResolution = resolveFont(safeParams.fontName);
            resolvedFont = fontResolution.resolved;
            fontSuggestions = fontResolution.suggestions;
            if (!resolvedFont) {
                return buildCreateTextFailure(
                    safeParams,
                    'create_text_layer_font_unavailable',
                    `未找到可用字体“${safeParams.fontName}”。请选择建议字体或改用已安装字体后再继续。`,
                    {
                        fontSuggestions,
                        errorDetails: {
                            requestedFont: safeParams.fontName,
                            suggestions: fontSuggestions
                        }
                    }
                );
            }
        }

        const operationId = `createTextLayer:${String(context?.requestId || Date.now())}`;
        return await photoshopTransactionRunner.run<
            CreateTextLayerBefore,
            CreateTextLayerReadback,
            CreateTextLayerResult,
            CreateTextLayerReceipt
        >({
            operationId,
            toolName: this.name,
            commandName: 'DesignEcho: 创建文字图层',
            params: safeParams,
            context,
            historyMode: 'suspend',
            expectedEffect: 'mutation_required',
            rollbackTargetPolicy: 'document_revision',
            prepare(scope): PhotoshopTransactionPreparation<CreateTextLayerBefore, CreateTextLayerResult> {
                return {
                    kind: 'ready',
                    before: {
                        documentId: Number(scope.document.id),
                        beforeLayerIds: collectLayerIds(scope.document),
                        expectedName: layerName,
                        expectedContent: content,
                        expectedX: safeParams.x,
                        expectedY: safeParams.y
                    }
                };
            },
            async mutate(scope, before) {
                const textKey = toPhotoshopTextKey(content);
                const textStyle: Record<string, unknown> = {
                    _obj: 'textStyle',
                    size: { _unit: 'pointsUnit', _value: fontSize },
                    color: {
                        _obj: 'RGBColor',
                        red: color.r,
                        green: color.g,
                        blue: color.b
                    }
                };

                if (resolvedFont) {
                    textStyle.fontPostScriptName = resolvedFont.postScriptName;
                }
                if (isFiniteNumber(safeParams.tracking)) {
                    textStyle.tracking = safeParams.tracking;
                }
                if (isFiniteNumber(safeParams.leading) && safeParams.leading > 0) {
                    textStyle.leading = { _unit: 'pointsUnit', _value: safeParams.leading };
                    textStyle.autoLeading = false;
                }

                await action.batchPlay([
                    {
                        _obj: 'make',
                        _target: [{ _ref: 'textLayer' }],
                        using: {
                            _obj: 'textLayer',
                            textKey,
                            textStyleRange: [{
                                _obj: 'textStyleRange',
                                from: 0,
                                to: textKey.length,
                                textStyle
                            }],
                            paragraphStyleRange: [{
                                _obj: 'paragraphStyleRange',
                                from: 0,
                                to: textKey.length,
                                paragraphStyle: {
                                    _obj: 'paragraphStyle',
                                    align: {
                                        _enum: 'alignmentType',
                                        _value: ['center', 'right'].includes(alignment) ? alignment : 'left'
                                    }
                                }
                            }]
                        },
                        layerID: { _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' },
                        _options: { dialogOptions: 'dontDisplay' }
                    },
                    {
                        _obj: 'set',
                        _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                        to: {
                            _obj: 'layer',
                            name: layerName
                        },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });

                const createdLayer = scope.document.activeLayers[0] as any;
                if (!createdLayer) {
                    throw new Error('Photoshop 创建文字后没有返回活动文字图层。请重新读取当前图层结构后再继续。');
                }

                const bounds = createdLayer.bounds || {};
                const currentX = Number(bounds.left);
                const currentY = Number(bounds.top);
                if (!Number.isFinite(currentX) || !Number.isFinite(currentY)) {
                    throw new Error('无法读取新文字图层的位置边界。请重新读取该图层后再继续。');
                }
                if (typeof createdLayer.translate !== 'function') {
                    throw new Error('新建图层不支持位置移动。请确认创建结果是可编辑文字图层后再继续。');
                }

                const deltaX = before.expectedX - currentX;
                const deltaY = before.expectedY - currentY;
                if (deltaX !== 0 || deltaY !== 0) {
                    await createdLayer.translate(deltaX, deltaY);
                }
                const createdLayerId = Number(createdLayer.id);
                if (!Number.isSafeInteger(createdLayerId)
                    || createdLayerId <= 0
                    || before.beforeLayerIds.includes(createdLayerId)) {
                    return buildCreateTextFailure(
                        safeParams,
                        'create_text_layer_result_invalid',
                        'Photoshop 未返回新的文字图层 ID。请重新读取图层结构后再继续。'
                    );
                }
                return buildPhotoshopTransactionMutationOutcome(
                    {
                        success: true,
                        entityType: 'text',
                        documentId: before.documentId,
                        layerId: createdLayerId,
                        name: before.expectedName,
                        layerName: before.expectedName,
                        content: before.expectedContent,
                        ...(resolvedFont ? { resolvedFont } : {}),
                        ...(fontSuggestions.length > 0 ? { fontSuggestions } : {}),
                        message: `已创建文字图层“${before.expectedName}”，等待 Photoshop 状态读回。`
                    },
                    { createdLayerId }
                );
            },
            readState({ phase, scope, before, receipt }): CreateTextLayerReadback {
                const currentLayerIds = collectLayerIds(scope.document);
                const addedLayerIds = currentLayerIds.filter(
                    layerId => !before.beforeLayerIds.includes(layerId)
                );
                const createdLayerId = Number(receipt?.createdLayerId || addedLayerIds[0]);
                if (phase !== 'after_rollback'
                    && (!Number.isSafeInteger(createdLayerId) || createdLayerId <= 0)) {
                    throw new Error('createTextLayer 写后读回缺少新图层 ID。');
                }
                return {
                    documentId: Number(scope.document.id),
                    currentLayerIds,
                    createdLayer: Number.isSafeInteger(createdLayerId) && createdLayerId > 0
                        ? readCreatedTextLayerState(scope.document, createdLayerId)
                        : undefined
                };
            },
            verifyApplied({ before, after, receipt }) {
                const addedLayerIds = after.currentLayerIds.filter(
                    layerId => !before.beforeLayerIds.includes(layerId)
                );
                const layer = after.createdLayer;
                const verified = after.documentId === before.documentId
                    && addedLayerIds.length === 1
                    && layer !== undefined
                    && layer.layerId === receipt?.createdLayerId
                    && layer.isTextLayer
                    && layer.name === before.expectedName
                    && layer.content === before.expectedContent
                    && layer.bounds.width > 0
                    && layer.bounds.height > 0
                    && nearlyEqual(layer.bounds.left, before.expectedX)
                    && nearlyEqual(layer.bounds.top, before.expectedY);
                return {
                    verified,
                    message: `createTextLayer 写后读回不一致：新增图层 ID=[${addedLayerIds.join(', ')}]，预期内容=“${before.expectedContent}”，实际内容=“${layer?.content || ''}”，预期位置=(${before.expectedX}, ${before.expectedY})，实际位置=(${layer?.bounds.left ?? '空'}, ${layer?.bounds.top ?? '空'})。`
                };
            },
            verifyRolledBack({ before, after }) {
                return {
                    verified: after.documentId === before.documentId
                        && sameLayerIdSet(before.beforeLayerIds, after.currentLayerIds)
                        && !after.createdLayer,
                    message: `createTextLayer 回滚后图层集合不一致：原 ID=[${before.beforeLayerIds.join(', ')}]，当前 ID=[${after.currentLayerIds.join(', ')}]。`
                };
            },
            buildVerifiedResult({ after }): CreateTextLayerResult {
                const layer = after.createdLayer as CreatedTextLayerState;
                return {
                    success: true,
                    entityType: 'text',
                    documentId: after.documentId,
                    layerId: layer.layerId,
                    name: layer.name,
                    layerName: layer.name,
                    content: layer.content,
                    bounds: layer.bounds,
                    ...(resolvedFont ? { resolvedFont } : {}),
                    ...(fontSuggestions.length > 0 ? { fontSuggestions } : {}),
                    message: `已创建文字图层“${layer.name}”，并读回确认内容、位置和非空 bounds。`
                };
            }
        });
    }
}
