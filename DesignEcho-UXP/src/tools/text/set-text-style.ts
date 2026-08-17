/**
 * 以字段 patch 语义设置文本样式。
 *
 * Photoshop 的 textStyleRange 不是安全的稀疏 patch：如果只回放 size 等少数字段，
 * 未提供的字体、颜色和 OpenType 属性可能被重置，并且多段混合样式会被抹平。
 * 本工具先读取完整 textKey，逐 range 克隆现有 textStyle 后只覆盖显式字段，
 * 再通过统一 PhotoshopTransactionRunner 做同目标读回、未请求字段校验和失败回滚。
 */

import {
    photoshopTransactionRunner,
    type PhotoshopTransactionPreparation
} from '../../core/photoshop-transaction-runner';
import { createToolFailureResult } from '../../core/tool-error-normalizer';
import { Tool, ToolExecutionContext, ToolSchema, TextStyle } from '../types';
import {
    FontSuggestion,
    ResolvedFontInfo,
    fontMatchesResolvedFont,
    resolveFont
} from './font-resolver';

const { action } = require('photoshop');
const { LayerKind } = require('photoshop').constants;

type TextStylePatchKey = 'fontName' | 'fontSize' | 'tracking' | 'leading';
type PreservedTextProperty =
    | 'fontName'
    | 'fontStyle'
    | 'fontSize'
    | 'tracking'
    | 'leading'
    | 'horizontalScale'
    | 'verticalScale'
    | 'color';

interface SetTextStyleParams {
    layerId?: number;
    fontSize?: number;
    tracking?: number;
    leading?: number;
    fontName?: string;
}

interface TextStyleRangeState {
    from: number;
    to: number;
    rawRange: Record<string, unknown>;
    rawStyle: Record<string, unknown>;
}

interface TextStyleState {
    documentId: number;
    layerId: number;
    layerName: string;
    parentId: number | null;
    content: string;
    textLayerDescriptor: Record<string, unknown>;
    ranges: TextStyleRangeState[];
}

interface TextStyleSnapshotSummary {
    contentLength: number;
    styleRangeCount: number;
    style: Partial<TextStyle>;
    autoLeading?: boolean | 'mixed';
    mixedProperties: PreservedTextProperty[];
}

interface TextStyleVerificationMismatch {
    kind: 'target' | 'content' | 'range_structure' | 'requested_value' | 'preservation';
    property: string;
    rangeIndex?: number;
}

interface TextStyleVerificationSummary {
    status: 'passed';
    requestedProperties: TextStylePatchKey[];
    preservedProperties: PreservedTextProperty[];
    preservedDescriptorKeyCount: number;
    contentPreserved: true;
    rangeStructurePreserved: true;
    mismatches: [];
}

interface TextStyleVerificationResult {
    verified: boolean;
    message: string;
    requestedProperties: TextStylePatchKey[];
    preservedProperties: PreservedTextProperty[];
    preservedDescriptorKeyCount: number;
    contentPreserved: boolean;
    rangeStructurePreserved: boolean;
    mismatches: TextStyleVerificationMismatch[];
}

// type 而非 interface：需要隐式索引签名以满足 TransactionRunner 的 Record<string, unknown> 约束
type SetTextStyleResult = {
    success: boolean;
    code?: string;
    error?: string;
    data?: unknown;
    mode?: 'patch';
    outcome?: 'changed_verified' | 'unchanged_already_satisfied';
    units?: {
        fontSize: 'pt';
        leading: 'pt';
        tracking: '1/1000em';
    };
    layerId?: number;
    target?: {
        documentId: number;
        layerId: number;
        layerName: string;
        parentId: number | null;
    };
    requestedPatch?: Partial<TextStyle>;
    appliedStyles?: Partial<TextStyle>;
    changedProperties?: TextStylePatchKey[];
    preservedProperties?: PreservedTextProperty[];
    before?: TextStyleSnapshotSummary;
    after?: TextStyleSnapshotSummary;
    verification?: TextStyleVerificationSummary;
    resolvedFont?: ResolvedFontInfo;
    verifiedFont?: string;
    fontSuggestions?: FontSuggestion[];
    errorDetails?: unknown;
}

interface LayerLocation {
    layer: any;
    parentId: number | null;
}

const USER_STYLE_PROPERTIES: PreservedTextProperty[] = [
    'fontName',
    'fontStyle',
    'fontSize',
    'tracking',
    'leading',
    'horizontalScale',
    'verticalScale',
    'color'
];

const TEXT_STYLE_UNITS: NonNullable<SetTextStyleResult['units']> = {
    fontSize: 'pt',
    leading: 'pt',
    tracking: '1/1000em'
};

const ALLOWED_SET_TEXT_STYLE_FIELDS = new Set([
    'layerId',
    'fontName',
    'fontSize',
    'tracking',
    'leading'
]);

function cloneValue<T>(value: T): T {
    if (value === undefined || value === null) return value;
    return JSON.parse(JSON.stringify(value));
}

function hasOwn(value: unknown, key: string): boolean {
    return Boolean(value)
        && typeof value === 'object'
        && !Array.isArray(value)
        && Object.prototype.hasOwnProperty.call(value, key);
}

function readUnitNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const unitValue = Number((value as { _value?: unknown })._value);
    return Number.isFinite(unitValue) ? unitValue : undefined;
}

function toPoints(value: number): { _unit: 'pointsUnit'; _value: number } {
    return {
        _unit: 'pointsUnit',
        _value: value
    };
}

function normalizeColorChannel(value: unknown): number | undefined {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? Math.round(numberValue) : undefined;
}

function readTextColor(value: unknown): TextStyle['color'] | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    const r = normalizeColorChannel(record.red ?? record.r);
    const g = normalizeColorChannel(record.green ?? record.g);
    const b = normalizeColorChannel(record.blue ?? record.b);
    if (r === undefined || g === undefined || b === undefined) return undefined;
    return { r, g, b };
}

function readKnownTextStyle(rawStyle: Record<string, unknown>): Partial<TextStyle> {
    const fontName = String(
        rawStyle.fontPostScriptName
        || rawStyle.fontName
        || ''
    ).trim();
    const fontStyle = String(
        rawStyle.fontStyleName
        || rawStyle.fontStyle
        || ''
    ).trim();
    const color = readTextColor(rawStyle.color || rawStyle.fillColor);

    return {
        ...(fontName ? { fontName } : {}),
        ...(fontStyle ? { fontStyle } : {}),
        ...(readUnitNumber(rawStyle.size) !== undefined
            ? { fontSize: readUnitNumber(rawStyle.size) }
            : {}),
        ...(readUnitNumber(rawStyle.tracking) !== undefined
            ? { tracking: readUnitNumber(rawStyle.tracking) }
            : {}),
        ...(readUnitNumber(rawStyle.leading) !== undefined
            ? { leading: readUnitNumber(rawStyle.leading) }
            : {}),
        ...(readUnitNumber(rawStyle.horizontalScale) !== undefined
            ? { horizontalScale: readUnitNumber(rawStyle.horizontalScale) }
            : {}),
        ...(readUnitNumber(rawStyle.verticalScale) !== undefined
            ? { verticalScale: readUnitNumber(rawStyle.verticalScale) }
            : {}),
        ...(color ? { color } : {})
    };
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
        normalized[key] = canonicalize(record[key]);
    }
    return normalized;
}

function descriptorValuesEqual(left: unknown, right: unknown): boolean {
    return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function summarizeTextStyleState(state: TextStyleState): TextStyleSnapshotSummary {
    const rangeStyles = state.ranges.map((range) => readKnownTextStyle(range.rawStyle));
    const style: Partial<TextStyle> = {};
    const mixedProperties: PreservedTextProperty[] = [];
    const autoLeadingValues = state.ranges.map((range) => range.rawStyle.autoLeading);
    const autoLeading = autoLeadingValues.length > 0
        && autoLeadingValues.every((value) => typeof value === 'boolean')
        ? (autoLeadingValues.every((value) => value === autoLeadingValues[0])
            ? autoLeadingValues[0] as boolean
            : 'mixed')
        : undefined;

    for (const property of USER_STYLE_PROPERTIES) {
        const values = rangeStyles.map((rangeStyle) => (
            (rangeStyle as Record<string, unknown>)[property]
        ));
        const availableValues = values.filter((value) => value !== undefined);
        if (availableValues.length === 0) continue;
        const first = availableValues[0];
        const uniform = availableValues.length === values.length
            && availableValues.every((value) => descriptorValuesEqual(value, first));
        if (uniform) {
            (style as Record<string, unknown>)[property] = cloneValue(first);
        } else {
            mixedProperties.push(property);
        }
    }

    return {
        contentLength: state.content.length,
        styleRangeCount: state.ranges.length,
        style,
        ...(autoLeading !== undefined ? { autoLeading } : {}),
        mixedProperties
    };
}

function findLayerLocation(
    container: any,
    layerId: number,
    parentId: number | null = null
): LayerLocation | undefined {
    for (const layer of container.layers || []) {
        if (Number(layer.id) === layerId) {
            return { layer, parentId };
        }
        if (layer.layers) {
            const found = findLayerLocation(layer, layerId, Number(layer.id));
            if (found) return found;
        }
    }
    return undefined;
}

function assertBatchPlaySucceeded(result: unknown, fallbackMessage: string): void {
    if (!Array.isArray(result)) return;
    const failure = result.find((entry) => (
        entry
        && typeof entry === 'object'
        && !Array.isArray(entry)
        && (
            String((entry as Record<string, unknown>)._obj || '').toLowerCase() === 'error'
            || Number((entry as Record<string, unknown>).result) < 0
        )
    )) as Record<string, unknown> | undefined;
    if (!failure) return;
    throw new Error(String(failure.message || failure.error || fallbackMessage));
}

async function readTextLayerDescriptor(layerId: number): Promise<Record<string, unknown>> {
    const result = await action.batchPlay([{
        _obj: 'get',
        _target: [{ _ref: 'layer', _id: layerId }],
        _options: { dialogOptions: 'dontDisplay' }
    }], { synchronousExecution: true });
    assertBatchPlaySucceeded(result, `读取文本图层 ID ${layerId} 失败。`);

    const textLayerDescriptor = result?.[0]?.textKey;
    if (!textLayerDescriptor
        || typeof textLayerDescriptor !== 'object'
        || Array.isArray(textLayerDescriptor)) {
        throw new Error(`文本图层 ID ${layerId} 缺少可回放的 textKey 描述符。`);
    }
    return cloneValue(textLayerDescriptor as Record<string, unknown>);
}

function buildTextStyleRanges(
    textLayerDescriptor: Record<string, unknown>
): TextStyleRangeState[] {
    const rawRanges = Array.isArray(textLayerDescriptor.textStyleRange)
        ? textLayerDescriptor.textStyleRange
        : [];
    return rawRanges.map((rawRange, index) => {
        if (!rawRange || typeof rawRange !== 'object' || Array.isArray(rawRange)) {
            throw new Error(`textStyleRange[${index}] 不是有效对象。`);
        }
        const range = rawRange as Record<string, unknown>;
        const rawStyle = range.textStyle;
        if (!rawStyle || typeof rawStyle !== 'object' || Array.isArray(rawStyle)) {
            throw new Error(`textStyleRange[${index}] 缺少完整 textStyle。`);
        }
        const from = Number(range.from);
        const to = Number(range.to);
        if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < from) {
            throw new Error(`textStyleRange[${index}] 的 from/to 无效。`);
        }
        return {
            from,
            to,
            rawRange: cloneValue(range),
            rawStyle: cloneValue(rawStyle as Record<string, unknown>)
        };
    });
}

async function readTextStyleState(document: any, layerId: number): Promise<TextStyleState> {
    const location = findLayerLocation(document, layerId);
    if (!location) throw new Error(`未找到图层 ID: ${layerId}`);
    if (location.layer.kind !== LayerKind.TEXT) {
        throw new Error(`图层 ID ${layerId} 不是文本图层。`);
    }
    const textLayerDescriptor = await readTextLayerDescriptor(layerId);
    const ranges = buildTextStyleRanges(textLayerDescriptor);
    if (ranges.length === 0) {
        throw new Error(`文本图层 ID ${layerId} 没有可保护的 textStyleRange，已拒绝稀疏写入。`);
    }
    const descriptorContent = typeof textLayerDescriptor.textKey === 'string'
        ? textLayerDescriptor.textKey
        : String(location.layer.textItem?.contents || '');

    return {
        documentId: Number(document.id),
        layerId,
        layerName: String(location.layer.name || ''),
        parentId: location.parentId,
        content: descriptorContent,
        textLayerDescriptor,
        ranges
    };
}

function validateSetTextStyleParams(params: SetTextStyleParams): { code: string; message: string } | null {
    const record = (params || {}) as Record<string, unknown>;
    const unsupportedFields = Object.keys(record).filter((key) => (
        !ALLOWED_SET_TEXT_STYLE_FIELDS.has(key)
    ));
    if (unsupportedFields.length > 0) {
        return {
            code: 'set_text_style_unsupported_fields',
            message: `setTextStyle 当前不支持字段：${unsupportedFields.join('、')}。工具未执行，不能把这些字段当作已修改。`
        };
    }

    if (hasOwn(record, 'layerId')
        && (!Number.isSafeInteger(params.layerId) || Number(params.layerId) <= 0)) {
        return {
            code: 'set_text_style_target_invalid',
            message: '显式 layerId 必须是正安全整数。'
        };
    }
    if (params.fontSize !== undefined
        && (!Number.isFinite(params.fontSize) || params.fontSize <= 0 || params.fontSize > 1296)) {
        return {
            code: 'set_text_style_font_size_invalid',
            message: 'fontSize 必须是大于 0 且不超过 1296 的有限数值。'
        };
    }
    if (params.tracking !== undefined
        && (!Number.isFinite(params.tracking) || params.tracking < -1000 || params.tracking > 1000)) {
        return {
            code: 'set_text_style_tracking_invalid',
            message: 'tracking 必须是 -1000 到 1000 之间的有限数值。'
        };
    }
    if (params.leading !== undefined
        && (!Number.isFinite(params.leading) || params.leading <= 0)) {
        return {
            code: 'set_text_style_leading_invalid',
            message: 'leading 必须是大于 0 的有限数值。'
        };
    }
    if (params.fontName !== undefined && !String(params.fontName).trim()) {
        return {
            code: 'set_text_style_font_name_invalid',
            message: 'fontName 不能为空。'
        };
    }

    const requestedProperties = collectRequestedProperties(params);
    if (requestedProperties.length === 0) {
        return {
            code: 'set_text_style_patch_required',
            message: 'setTextStyle 至少需要 fontName、fontSize、tracking、leading 中的一个字段。'
        };
    }
    return null;
}

function collectRequestedProperties(params: SetTextStyleParams): TextStylePatchKey[] {
    const properties: TextStylePatchKey[] = [];
    if (params.fontName !== undefined) properties.push('fontName');
    if (params.fontSize !== undefined) properties.push('fontSize');
    if (params.tracking !== undefined) properties.push('tracking');
    if (params.leading !== undefined) properties.push('leading');
    return properties;
}

function buildRequestedPatch(params: SetTextStyleParams): Partial<TextStyle> {
    return {
        ...(params.fontName !== undefined ? { fontName: String(params.fontName).trim() } : {}),
        ...(params.fontSize !== undefined ? { fontSize: params.fontSize } : {}),
        ...(params.tracking !== undefined ? { tracking: params.tracking } : {}),
        ...(params.leading !== undefined ? { leading: params.leading } : {})
    };
}

function buildAppliedStyles(
    params: SetTextStyleParams,
    resolvedFont: ResolvedFontInfo | null
): Partial<TextStyle> {
    return {
        ...(resolvedFont ? { fontName: resolvedFont.postScriptName } : {}),
        ...(params.fontSize !== undefined ? { fontSize: params.fontSize } : {}),
        ...(params.tracking !== undefined ? { tracking: params.tracking } : {}),
        ...(params.leading !== undefined ? { leading: params.leading } : {})
    };
}

function buildPreparationFailure(
    params: SetTextStyleParams,
    code: string,
    message: string,
    extra: Partial<SetTextStyleResult> = {}
): SetTextStyleResult {
    return {
        ...createToolFailureResult({
            toolName: 'setTextStyle',
            error: message,
            params
        }),
        success: false,
        code,
        ...extra
    };
}

function scaleDerivedUnit(
    targetValue: number,
    beforeBase: unknown,
    beforeDerived: unknown
): { _unit: 'pointsUnit'; _value: number } | undefined {
    const base = readUnitNumber(beforeBase);
    const derived = readUnitNumber(beforeDerived);
    if (base === undefined || base <= 0 || derived === undefined) return undefined;
    return toPoints(targetValue * (derived / base));
}

function patchRawTextStyle(
    rawStyle: Record<string, unknown>,
    params: SetTextStyleParams,
    resolvedFont: ResolvedFontInfo | null
): Record<string, unknown> {
    const next = cloneValue(rawStyle);
    next._obj = 'textStyle';

    if (params.fontSize !== undefined) {
        const impliedFontSize = scaleDerivedUnit(
            params.fontSize,
            rawStyle.size,
            rawStyle.impliedFontSize
        );
        next.size = toPoints(params.fontSize);
        if (impliedFontSize) next.impliedFontSize = impliedFontSize;
    }
    if (params.tracking !== undefined) {
        next.tracking = params.tracking;
    }
    if (params.leading !== undefined) {
        const impliedLeading = scaleDerivedUnit(
            params.leading,
            rawStyle.leading,
            rawStyle.impliedLeading
        );
        next.leading = toPoints(params.leading);
        next.autoLeading = false;
        if (impliedLeading) next.impliedLeading = impliedLeading;
    }
    if (resolvedFont) {
        next.fontPostScriptName = resolvedFont.postScriptName;
        if (resolvedFont.family) next.fontName = resolvedFont.family;
        else delete next.fontName;
        if (resolvedFont.style) next.fontStyleName = resolvedFont.style;
        else delete next.fontStyleName;
        delete next.fontScript;
        delete next.fontTechnology;
        if (hasOwn(next, 'fontAvailable')) next.fontAvailable = true;
    }
    return next;
}

function buildPatchedTextLayerDescriptor(
    before: TextStyleState,
    params: SetTextStyleParams,
    resolvedFont: ResolvedFontInfo | null
): Record<string, unknown> {
    return {
        _obj: 'textLayer',
        textStyleRange: before.ranges.map((range) => ({
            ...cloneValue(range.rawRange),
            _obj: 'textStyleRange',
            from: range.from,
            to: range.to,
            textStyle: patchRawTextStyle(range.rawStyle, params, resolvedFont)
        }))
    };
}

function numericMatches(actual: unknown, expected: number, tolerance: number): boolean {
    const value = readUnitNumber(actual);
    return value !== undefined && Math.abs(value - expected) <= tolerance;
}

function rangeMatchesRequestedPatch(
    range: TextStyleRangeState,
    params: SetTextStyleParams,
    resolvedFont: ResolvedFontInfo | null
): boolean {
    if (resolvedFont) {
        const actualFont = String(
            range.rawStyle.fontPostScriptName
            || range.rawStyle.fontName
            || ''
        ).trim();
        if (!fontMatchesResolvedFont(actualFont, resolvedFont)) return false;
    }
    if (params.fontSize !== undefined
        && !numericMatches(range.rawStyle.size, params.fontSize, 0.5)) {
        return false;
    }
    if (params.tracking !== undefined
        && !numericMatches(range.rawStyle.tracking, params.tracking, 1)) {
        return false;
    }
    if (params.leading !== undefined
        && !numericMatches(range.rawStyle.leading, params.leading, 0.5)) {
        return false;
    }
    if (params.leading !== undefined && range.rawStyle.autoLeading !== false) {
        return false;
    }
    return true;
}

function collectChangedProperties(
    before: TextStyleState,
    params: SetTextStyleParams,
    resolvedFont: ResolvedFontInfo | null
): TextStylePatchKey[] {
    return collectRequestedProperties(params).filter((property) => (
        before.ranges.some((range) => {
            if (property === 'fontName') {
                return !rangeMatchesRequestedPatch(
                    range,
                    { fontName: params.fontName },
                    resolvedFont
                );
            }
            if (property === 'fontSize') {
                return !numericMatches(range.rawStyle.size, Number(params.fontSize), 0.5);
            }
            if (property === 'tracking') {
                return !numericMatches(range.rawStyle.tracking, Number(params.tracking), 1);
            }
            return !numericMatches(range.rawStyle.leading, Number(params.leading), 0.5)
                || range.rawStyle.autoLeading !== false;
        })
    ));
}

function collectIgnoredDescriptorKeys(
    before: TextStyleState,
    params: SetTextStyleParams
): Set<string> {
    const ignored = new Set(['_obj']);
    if (params.fontName !== undefined) {
        for (const key of [
            'fontPostScriptName',
            'fontName',
            'fontStyleName',
            'fontStyle',
            'fontScript',
            'fontTechnology',
            'fontAvailable'
        ]) {
            ignored.add(key);
        }
    }
    if (params.fontSize !== undefined) {
        ignored.add('size');
        ignored.add('impliedFontSize');
        const usesAutoLeading = before.ranges.some((range) => range.rawStyle.autoLeading === true);
        if (usesAutoLeading) {
            ignored.add('leading');
            ignored.add('impliedLeading');
        }
    }
    if (params.tracking !== undefined) ignored.add('tracking');
    if (params.leading !== undefined) {
        ignored.add('leading');
        ignored.add('impliedLeading');
        ignored.add('autoLeading');
    }
    return ignored;
}

function isPublicPropertyRequested(
    property: PreservedTextProperty,
    params: SetTextStyleParams,
    before: TextStyleState
): boolean {
    if ((property === 'fontName' || property === 'fontStyle') && params.fontName !== undefined) {
        return true;
    }
    if (property === 'fontSize' && params.fontSize !== undefined) return true;
    if (property === 'tracking' && params.tracking !== undefined) return true;
    if (property === 'leading' && params.leading !== undefined) return true;
    if (property === 'leading'
        && params.fontSize !== undefined
        && before.ranges.some((range) => range.rawStyle.autoLeading === true)) {
        return true;
    }
    return false;
}

function collectPreservedPublicProperties(
    before: TextStyleState,
    after: TextStyleState,
    params: SetTextStyleParams
): PreservedTextProperty[] {
    if (before.ranges.length !== after.ranges.length) return [];
    const result: PreservedTextProperty[] = [];
    for (const property of USER_STYLE_PROPERTIES) {
        if (isPublicPropertyRequested(property, params, before)) continue;
        const preserved = before.ranges.every((beforeRange, index) => {
            const beforeValue = (readKnownTextStyle(beforeRange.rawStyle) as Record<string, unknown>)[property];
            const afterValue = (readKnownTextStyle(after.ranges[index].rawStyle) as Record<string, unknown>)[property];
            return beforeValue !== undefined
                && afterValue !== undefined
                && descriptorValuesEqual(beforeValue, afterValue);
        });
        if (preserved) result.push(property);
    }
    return result;
}

function verifyTextStylePatch(
    before: TextStyleState,
    after: TextStyleState,
    params: SetTextStyleParams,
    resolvedFont: ResolvedFontInfo | null
): TextStyleVerificationResult {
    const mismatches: TextStyleVerificationMismatch[] = [];
    const sameTarget = before.documentId === after.documentId
        && before.layerId === after.layerId
        && before.parentId === after.parentId;
    if (!sameTarget) {
        mismatches.push({ kind: 'target', property: 'documentId/layerId/parentId' });
    }

    const contentPreserved = before.content === after.content;
    if (!contentPreserved) {
        mismatches.push({ kind: 'content', property: 'textKey' });
    }

    let rangeStructurePreserved = before.ranges.length === after.ranges.length;
    if (rangeStructurePreserved) {
        for (let index = 0; index < before.ranges.length; index += 1) {
            const beforeRange = before.ranges[index];
            const afterRange = after.ranges[index];
            if (beforeRange.from !== afterRange.from || beforeRange.to !== afterRange.to) {
                rangeStructurePreserved = false;
                mismatches.push({
                    kind: 'range_structure',
                    property: 'from/to',
                    rangeIndex: index
                });
            }
        }
    } else {
        mismatches.push({ kind: 'range_structure', property: 'rangeCount' });
    }

    for (let index = 0; index < after.ranges.length; index += 1) {
        if (!rangeMatchesRequestedPatch(after.ranges[index], params, resolvedFont)) {
            mismatches.push({
                kind: 'requested_value',
                property: collectRequestedProperties(params).join(','),
                rangeIndex: index
            });
        }
    }

    const ignoredKeys = collectIgnoredDescriptorKeys(before, params);
    const preservedDescriptorKeys = new Set<string>();
    if (before.ranges.length === after.ranges.length) {
        for (let index = 0; index < before.ranges.length; index += 1) {
            const beforeStyle = before.ranges[index].rawStyle;
            const afterStyle = after.ranges[index].rawStyle;
            for (const key of Object.keys(beforeStyle)) {
                if (ignoredKeys.has(key)) continue;
                preservedDescriptorKeys.add(key);
                if (!descriptorValuesEqual(beforeStyle[key], afterStyle[key])) {
                    mismatches.push({
                        kind: 'preservation',
                        property: key,
                        rangeIndex: index
                    });
                }
            }
        }
    }

    const verified = mismatches.length === 0;
    const issueSummary = mismatches
        .slice(0, 6)
        .map((item) => `${item.kind}:${item.property}${item.rangeIndex === undefined ? '' : `@${item.rangeIndex}`}`)
        .join('、');
    return {
        verified,
        message: verified
            ? `已验证 ${after.ranges.length} 个 textStyleRange：请求字段生效，文本内容、range 结构和未请求样式保持不变。`
            : `文本样式 patch 写后验证失败：${issueSummary || '状态不一致'}。`,
        requestedProperties: collectRequestedProperties(params),
        preservedProperties: collectPreservedPublicProperties(before, after, params),
        preservedDescriptorKeyCount: preservedDescriptorKeys.size,
        contentPreserved,
        rangeStructurePreserved,
        mismatches
    };
}

function buildPublicVerification(
    verification: TextStyleVerificationResult
): TextStyleVerificationSummary {
    if (!verification.verified
        || !verification.contentPreserved
        || !verification.rangeStructurePreserved
        || verification.mismatches.length > 0) {
        throw new Error('不能把失败的文本样式读回投影为 passed。');
    }
    return {
        status: 'passed',
        requestedProperties: verification.requestedProperties,
        preservedProperties: verification.preservedProperties,
        preservedDescriptorKeyCount: verification.preservedDescriptorKeyCount,
        contentPreserved: true,
        rangeStructurePreserved: true,
        mismatches: []
    };
}

function sameTextStyleState(left: TextStyleState, right: TextStyleState): boolean {
    return left.documentId === right.documentId
        && left.layerId === right.layerId
        && left.parentId === right.parentId
        && left.content === right.content
        && descriptorValuesEqual(
            left.textLayerDescriptor.textStyleRange,
            right.textLayerDescriptor.textStyleRange
        );
}

function buildTarget(state: TextStyleState): SetTextStyleResult['target'] {
    return {
        documentId: state.documentId,
        layerId: state.layerId,
        layerName: state.layerName,
        parentId: state.parentId
    };
}

function resolveVerifiedFont(summary: TextStyleSnapshotSummary): string | undefined {
    return typeof summary.style.fontName === 'string'
        ? summary.style.fontName
        : undefined;
}

export class SetTextStyleTool implements Tool {
    name = 'setTextStyle';

    schema: ToolSchema = {
        name: 'setTextStyle',
        description: '以字段 patch 方式修改一个文本图层。只改变显式提供的 fontName/fontSize/tracking/leading；所有省略的文字样式、文本内容和混合 style ranges 必须保持不变。写后会读取同一图层验证，出现未请求属性漂移时自动回滚。',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '目标文本图层 ID。优先使用 getAllTextLayers/getLayerHierarchy 返回的稳定 ID；省略时绑定执行前当前选中的唯一文本图层。'
                },
                fontSize: {
                    type: 'number',
                    description: '目标字号（pt，0 < fontSize <= 1296）。省略时保持原字号。'
                },
                tracking: {
                    type: 'number',
                    description: '目标字间距（Photoshop tracking，-1000 到 1000，单位为千分之一 em）。省略时保持原字距。'
                },
                leading: {
                    type: 'number',
                    description: '目标固定行高（pt，必须大于 0）；提供后会关闭 autoLeading。省略时保持原行高/自动行高状态。'
                },
                fontName: {
                    type: 'string',
                    description: '目标字体名称。写入前应先调用 resolveFontName；省略时必须保持原字体和字体样式。'
                }
            }
        }
    };

    async execute(
        params: SetTextStyleParams,
        context?: ToolExecutionContext
    ): Promise<SetTextStyleResult> {
        const safeParams = params || {};
        const validationFailure = validateSetTextStyleParams(safeParams);
        const requestedPatch = buildRequestedPatch(safeParams);
        const fontResolution = safeParams.fontName !== undefined
            ? resolveFont(String(safeParams.fontName).trim())
            : null;
        const resolvedFont = fontResolution?.resolved || null;
        const fontSuggestions = fontResolution?.suggestions || [];
        const operationId = `setTextStyle:${String(
            context?.requestId
            || `${Number(safeParams.layerId) || 'active'}:${Date.now()}`
        )}`;

        return await photoshopTransactionRunner.run<
            TextStyleState,
            TextStyleState,
            SetTextStyleResult
        >({
            operationId,
            toolName: this.name,
            commandName: 'DesignEcho: Patch 文本样式',
            params: safeParams,
            context,
            historyMode: 'suspend',
            expectedEffect: 'mutation_required',
            async prepare(scope): Promise<PhotoshopTransactionPreparation<TextStyleState, SetTextStyleResult>> {
                if (validationFailure) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildPreparationFailure(
                            safeParams,
                            validationFailure.code,
                            validationFailure.message
                        )
                    };
                }
                if (safeParams.fontName !== undefined && !resolvedFont) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildPreparationFailure(
                            safeParams,
                            'set_text_style_font_unavailable',
                            `未找到可用字体：${safeParams.fontName}`,
                            {
                                fontSuggestions,
                                errorDetails: {
                                    requestedFont: safeParams.fontName,
                                    suggestions: fontSuggestions
                                }
                            }
                        )
                    };
                }

                const explicitLayerId = hasOwn(safeParams, 'layerId');
                const activeLayerId = Number(scope.document.activeLayers?.[0]?.id);
                const layerId = explicitLayerId
                    ? Number(safeParams.layerId)
                    : activeLayerId;
                if (!Number.isSafeInteger(layerId) || layerId <= 0) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildPreparationFailure(
                            safeParams,
                            'set_text_style_target_required',
                            '没有可绑定的目标文本图层。请先读取图层并提供 layerId。'
                        )
                    };
                }

                const location = findLayerLocation(scope.document, layerId);
                if (!location) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildPreparationFailure(
                            safeParams,
                            'set_text_style_target_not_found',
                            `未找到图层 ID: ${layerId}`
                        )
                    };
                }
                if (location.layer.kind !== LayerKind.TEXT) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildPreparationFailure(
                            safeParams,
                            'set_text_style_target_not_text',
                            `图层 ID ${layerId} 不是文本图层。`
                        )
                    };
                }
                if (location.layer.locked) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildPreparationFailure(
                            safeParams,
                            'set_text_style_target_locked',
                            `文本图层「${String(location.layer.name || layerId)}」已锁定，无法修改。`
                        )
                    };
                }

                const before = await readTextStyleState(scope.document, layerId);
                const changedProperties = collectChangedProperties(before, safeParams, resolvedFont);
                if (changedProperties.length === 0) {
                    const verification = verifyTextStylePatch(before, before, safeParams, resolvedFont);
                    const summary = summarizeTextStyleState(before);
                    return {
                        kind: 'complete',
                        effect: 'already_satisfied',
                        result: {
                            success: true,
                            mode: 'patch',
                            outcome: 'unchanged_already_satisfied',
                            units: TEXT_STYLE_UNITS,
                            layerId,
                            target: buildTarget(before),
                            requestedPatch,
                            appliedStyles: buildAppliedStyles(safeParams, resolvedFont),
                            changedProperties: [],
                            preservedProperties: verification.preservedProperties,
                            before: summary,
                            after: summary,
                            verification: buildPublicVerification(verification),
                            ...(resolvedFont ? { resolvedFont } : {}),
                            ...(resolvedFont ? { verifiedFont: resolveVerifiedFont(summary) } : {}),
                            ...(fontSuggestions.length > 0 ? { fontSuggestions } : {})
                        }
                    };
                }
                return { kind: 'ready', before };
            },
            async mutate(_scope, before): Promise<SetTextStyleResult> {
                const patchedDescriptor = buildPatchedTextLayerDescriptor(
                    before,
                    safeParams,
                    resolvedFont
                );
                const result = await action.batchPlay([{
                    _obj: 'set',
                    _target: [{ _ref: 'layer', _id: before.layerId }],
                    to: patchedDescriptor,
                    _options: { dialogOptions: 'dontDisplay' }
                }], { synchronousExecution: true });
                assertBatchPlaySucceeded(result, 'Photoshop 拒绝了文本样式 patch。');

                return {
                    success: true,
                    mode: 'patch',
                    units: TEXT_STYLE_UNITS,
                    layerId: before.layerId,
                    target: buildTarget(before),
                    requestedPatch,
                    appliedStyles: buildAppliedStyles(safeParams, resolvedFont),
                    changedProperties: collectChangedProperties(before, safeParams, resolvedFont),
                    before: summarizeTextStyleState(before),
                    ...(resolvedFont ? { resolvedFont } : {}),
                    ...(fontSuggestions.length > 0 ? { fontSuggestions } : {})
                };
            },
            async readState({ scope, before }): Promise<TextStyleState> {
                return await readTextStyleState(scope.document, before.layerId);
            },
            verifyApplied({ before, after }) {
                const verification = verifyTextStylePatch(
                    before,
                    after,
                    safeParams,
                    resolvedFont
                );
                return {
                    verified: verification.verified,
                    message: verification.message
                };
            },
            verifyRolledBack({ before, after }) {
                const verified = sameTextStyleState(before, after);
                return {
                    verified,
                    message: verified
                        ? '文本样式 patch 失败后已恢复原始内容和全部 textStyleRange。'
                        : '回滚后文本内容或 textStyleRange 与写入前不一致。'
                };
            },
            buildVerifiedResult({ before, after, result }): SetTextStyleResult {
                const verification = verifyTextStylePatch(
                    before,
                    after,
                    safeParams,
                    resolvedFont
                );
                const afterSummary = summarizeTextStyleState(after);
                return {
                    ...result,
                    success: true,
                    outcome: 'changed_verified',
                    units: TEXT_STYLE_UNITS,
                    target: buildTarget(after),
                    preservedProperties: verification.preservedProperties,
                    after: afterSummary,
                    verification: buildPublicVerification(verification),
                    ...(resolvedFont ? { verifiedFont: resolveVerifiedFont(afterSummary) } : {})
                };
            }
        });
    }
}
