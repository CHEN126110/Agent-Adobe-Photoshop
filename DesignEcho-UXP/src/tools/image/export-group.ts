import { app } from 'photoshop';
import { runJsxCode } from '../../core/jsx-bridge';
import { createToolFailureResult } from '../../core/tool-error-normalizer';
import {
    readActiveHistoryStateRef,
    sameHistoryStateRef,
    type PhotoshopHistoryStateRef
} from '../../core/photoshop-history-state-ref';
import { Tool, ToolResult, ToolSchema } from '../types';

type ExportGroupFormat = 'png' | 'jpg';
type ExportGroupConflictPolicy = 'overwrite' | 'fail_if_exists';
type ExportGroupCanvasPolicy = 'trim_content' | 'preserve_document_canvas';

interface ExportGroupParams {
    groupPath?: string | string[];
    layerId?: number;
    outputPath: string;
    format?: ExportGroupFormat;
    conflictPolicy?: ExportGroupConflictPolicy;
    canvasPolicy?: ExportGroupCanvasPolicy;
    maxSize?: number;
    targetWidth?: number;
    targetHeight?: number;
}

interface ExportGroupResult {
    success: boolean;
    outputPath: string;
    format: ExportGroupFormat;
    canvasPolicy: ExportGroupCanvasPolicy;
    width: number;
    height: number;
    targetName: string;
    targetLayerId?: number;
    groupPath?: string[];
    sourceHistoryStateRef?: PhotoshopHistoryStateRef;
    contentBounds?: {
        left: number;
        top: number;
        right: number;
        bottom: number;
        width: number;
        height: number;
    };
}

function cleanString(value: unknown): string {
    return String(value || '').trim();
}

function normalizeGroupPath(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map(cleanString).filter(Boolean);
    }
    const text = cleanString(value);
    if (!text) return [];
    return text.split('/').map(cleanString).filter(Boolean);
}

function normalizeLayerId(value: unknown): number | undefined {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
    return Math.floor(numeric);
}

function normalizeMaxSize(value: unknown): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Math.floor(numeric);
}

function normalizeDimension(value: unknown): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return Math.floor(numeric);
}

function parseJsxNumber(value: unknown): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeExportFormat(value: unknown): ExportGroupFormat | undefined {
    const normalized = cleanString(value).toLowerCase();
    if (!normalized || normalized === 'png') return 'png';
    if (normalized === 'jpg' || normalized === 'jpeg') return 'jpg';
    return undefined;
}

function normalizeConflictPolicy(value: unknown): ExportGroupConflictPolicy | undefined {
    const normalized = cleanString(value).toLowerCase();
    if (!normalized || normalized === 'overwrite') return 'overwrite';
    if (normalized === 'fail_if_exists') return 'fail_if_exists';
    return undefined;
}

function normalizeCanvasPolicy(value: unknown): ExportGroupCanvasPolicy | undefined {
    const normalized = cleanString(value).toLowerCase();
    if (!normalized || normalized === 'trim_content') return 'trim_content';
    if (normalized === 'preserve_document_canvas') return 'preserve_document_canvas';
    return undefined;
}

function outputPathMatchesFormat(outputPath: string, format: ExportGroupFormat): boolean {
    if (format === 'png') return /\.png$/i.test(outputPath);
    return /\.jpe?g$/i.test(outputPath);
}

export class ExportGroupTool implements Tool {
    name = 'exportGroup';

    schema: ToolSchema = {
        name: 'exportGroup',
        description: '将指定图层组或图层导出为 PNG/JPEG 文件。通过临时文档隔离导出，不修改原文档可见性。适合一个 PSD 内多个主图/转化图组分别导出。',
        parameters: {
            type: 'object',
            properties: {
                groupPath: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '目标组路径，例如 ["点击图转化图", "1x1", "点击图 A"]。如果提供 layerId，可选。'
                },
                layerId: {
                    type: 'number',
                    description: '目标图层或组 ID。没有 groupPath 时必填。'
                },
                outputPath: {
                    type: 'string',
                    description: '完整 PNG/JPEG 输出路径，扩展名必须与 format 一致。'
                },
                format: {
                    type: 'string',
                    enum: ['png', 'jpg'],
                    description: '导出格式。'
                },
                conflictPolicy: {
                    type: 'string',
                    enum: ['overwrite', 'fail_if_exists'],
                    description: '目标冲突策略。受治理生产应显式使用 fail_if_exists。'
                },
                canvasPolicy: {
                    type: 'string',
                    enum: ['trim_content', 'preserve_document_canvas'],
                    description: '画布策略：trim_content 裁掉目标内容外的透明画布（默认）；preserve_document_canvas 仅隔离目标图层/组，保留源文档完整画布。'
                },
                maxSize: {
                    type: 'number',
                    description: '最大边长。0 或不传表示不缩放。'
                },
                targetWidth: {
                    type: 'number',
                    description: '导出目标宽度。targetWidth 和 targetHeight 同时提供时按指定尺寸缩放。'
                },
                targetHeight: {
                    type: 'number',
                    description: '导出目标高度。targetWidth 和 targetHeight 同时提供时按指定尺寸缩放。'
                }
            },
            required: ['outputPath']
        }
    };

    async execute(params: ExportGroupParams): Promise<ToolResult<ExportGroupResult>> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, data: null, error: '没有打开的 Photoshop 文档' };
            }

            const groupPath = normalizeGroupPath(params.groupPath);
            const layerId = normalizeLayerId(params.layerId);
            const outputPath = cleanString(params.outputPath);
            const format = normalizeExportFormat(params.format);
            const conflictPolicy = normalizeConflictPolicy(params.conflictPolicy);
            const canvasPolicy = normalizeCanvasPolicy(params.canvasPolicy);

            if (!format) {
                return { success: false, data: null, error: 'exportGroup format 必须是 png 或 jpg' };
            }
            if (!conflictPolicy) {
                return { success: false, data: null, error: 'exportGroup conflictPolicy 无效' };
            }
            if (!canvasPolicy) {
                return { success: false, data: null, error: 'exportGroup canvasPolicy 必须是 trim_content 或 preserve_document_canvas' };
            }
            if (!outputPath) {
                return { success: false, data: null, error: 'exportGroup requires outputPath' };
            }
            if (!layerId && groupPath.length === 0) {
                return { success: false, data: null, error: 'exportGroup requires groupPath or layerId' };
            }
            if (!outputPathMatchesFormat(outputPath, format)) {
                return { success: false, data: null, error: 'exportGroup outputPath 扩展名必须与 format 一致' };
            }

            const sourceHistoryStateRef = readActiveHistoryStateRef(doc);
            if (!sourceHistoryStateRef) {
                return { success: false, data: null, error: 'exportGroup 无法读取源文档版本' };
            }

            const jsxData = await this.exportWithJsx({
                groupPath,
                layerId,
                outputPath,
                format,
                conflictPolicy,
                canvasPolicy,
                maxSize: normalizeMaxSize(params.maxSize),
                targetWidth: normalizeDimension(params.targetWidth),
                targetHeight: normalizeDimension(params.targetHeight)
            });
            const afterExportHistoryStateRef = readActiveHistoryStateRef(app.activeDocument);
            if (!sameHistoryStateRef(sourceHistoryStateRef, afterExportHistoryStateRef)) {
                return { success: false, data: null, error: 'exportGroup 导出后源文档版本发生变化' };
            }
            if (cleanString(jsxData.canvasPolicy) !== canvasPolicy) {
                return { success: false, data: null, error: 'exportGroup 无法确认导出产物使用了请求的画布策略' };
            }

            return {
                success: true,
                data: {
                    success: true,
                    outputPath: cleanString(jsxData.path) || outputPath,
                    format,
                    canvasPolicy,
                    width: parseJsxNumber(jsxData.width),
                    height: parseJsxNumber(jsxData.height),
                    targetName: cleanString(jsxData.targetName),
                    targetLayerId: parseJsxNumber(jsxData.targetLayerId) || layerId,
                    groupPath,
                    sourceHistoryStateRef,
                    contentBounds: {
                        left: parseJsxNumber(jsxData.contentLeft),
                        top: parseJsxNumber(jsxData.contentTop),
                        right: parseJsxNumber(jsxData.contentRight),
                        bottom: parseJsxNumber(jsxData.contentBottom),
                        width: Math.max(0, parseJsxNumber(jsxData.contentRight) - parseJsxNumber(jsxData.contentLeft)),
                        height: Math.max(0, parseJsxNumber(jsxData.contentBottom) - parseJsxNumber(jsxData.contentTop))
                    }
                }
            };
        } catch (error) {
            console.error('[ExportGroup] Error:', error);
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }

    private async exportWithJsx(input: {
        groupPath: string[];
        layerId?: number;
        outputPath: string;
        format: ExportGroupFormat;
        conflictPolicy: ExportGroupConflictPolicy;
        canvasPolicy: ExportGroupCanvasPolicy;
        maxSize: number;
        targetWidth: number;
        targetHeight: number;
    }): Promise<any> {
        const groupPathJson = JSON.stringify(input.groupPath);
        const layerIdJson = JSON.stringify(input.layerId || 0);
        const outputPathJson = JSON.stringify(input.outputPath.replace(/\\/g, '/'));
        const formatJson = JSON.stringify(input.format);
        const conflictPolicyJson = JSON.stringify(input.conflictPolicy);
        const canvasPolicyJson = JSON.stringify(input.canvasPolicy);
        const maxSizeJson = JSON.stringify(input.maxSize);
        const targetWidthJson = JSON.stringify(input.targetWidth);
        const targetHeightJson = JSON.stringify(input.targetHeight);

        const jsx = `
var __dePrevDialogs = app.displayDialogs;
app.displayDialogs = DialogModes.NO;
var __deOutput = '';
function __deEncode(value) {
    return encodeURIComponent(String(value === undefined || value === null ? '' : value));
}
function __deResult(fields) {
    var parts = [];
    for (var key in fields) {
        if (!fields.hasOwnProperty(key)) continue;
        if (fields[key] === undefined || fields[key] === null) continue;
        parts.push(__deEncode(key) + '=' + __deEncode(fields[key]));
    }
    __deOutput = '__DESIGNECHO_RESULT__' + parts.join('&');
    return __deOutput;
}

var sourceDoc = null;
var tempDoc = null;
try {
    if (!app.documents.length) throw new Error('No active document');
    sourceDoc = app.activeDocument;

    var GROUP_PATH = ${groupPathJson};
    var LAYER_ID = ${layerIdJson};
    var OUTPUT_PATH = ${outputPathJson};
    var FORMAT = ${formatJson};
    var CONFLICT_POLICY = ${conflictPolicyJson};
    var CANVAS_POLICY = ${canvasPolicyJson};
    var MAX_SIZE = ${maxSizeJson};
    var TARGET_WIDTH = ${targetWidthJson};
    var TARGET_HEIGHT = ${targetHeightJson};

    function asPixels(unitValue) {
        try { return Number(unitValue.as('px')); }
        catch (e) { return Number(unitValue); }
    }

    function findLayerById(container, id) {
        if (!id || !container || !container.layers) return null;
        for (var i = 0; i < container.layers.length; i++) {
            var layer = container.layers[i];
            if (layer.id === id) return layer;
            if (layer.layers && layer.layers.length > 0) {
                var found = findLayerById(layer, id);
                if (found) return found;
            }
        }
        return null;
    }

    function findLayerByPath(container, parts) {
        if (!parts || !parts.length) return null;
        var current = container;
        for (var i = 0; i < parts.length; i++) {
            if (!current || !current.layers) return null;
            var part = String(parts[i]);
            var found = null;
            for (var j = 0; j < current.layers.length; j++) {
                if (String(current.layers[j].name) === part) {
                    found = current.layers[j];
                    break;
                }
            }
            if (!found) return null;
            current = found;
        }
        return current;
    }

    function resolveTarget(container) {
        if (GROUP_PATH && GROUP_PATH.length) {
            return findLayerByPath(container, GROUP_PATH);
        }
        return findLayerById(container, LAYER_ID);
    }

    function readBounds(layer) {
        var result = { left: 0, top: 0, right: 0, bottom: 0 };
        try {
            result.left = Math.round(asPixels(layer.bounds[0]));
            result.top = Math.round(asPixels(layer.bounds[1]));
            result.right = Math.round(asPixels(layer.bounds[2]));
            result.bottom = Math.round(asPixels(layer.bounds[3]));
        } catch (boundsError) {}
        return result;
    }

    var sourceTarget = resolveTarget(sourceDoc);
    if (!sourceTarget) {
        throw new Error(GROUP_PATH && GROUP_PATH.length
            ? 'Target group path not found: ' + GROUP_PATH.join('/')
            : 'Target layer not found: ' + LAYER_ID);
    }

    var sourceBounds = readBounds(sourceTarget);
    var targetName = String(sourceTarget.name || '');
    var sourceTargetId = Number(sourceTarget.id || LAYER_ID || 0);

    var tempName = 'designecho_export_group_' + (new Date().getTime());
    tempDoc = sourceDoc.duplicate(tempName, false);
    app.activeDocument = tempDoc;

    var tempTarget = resolveTarget(tempDoc);
    if (!tempTarget) {
        throw new Error(GROUP_PATH && GROUP_PATH.length
            ? 'Target group path not found after duplication: ' + GROUP_PATH.join('/')
            : 'Target layer not found after duplication: ' + LAYER_ID);
    }
    var keepId = Number(tempTarget.id || 0);

    function pruneNonTarget(container, targetId) {
        if (!container || !container.layers) return false;
        var hasTargetInside = false;
        for (var i = container.layers.length - 1; i >= 0; i--) {
            var layer = container.layers[i];
            if (Number(layer.id || 0) === targetId) {
                hasTargetInside = true;
                continue;
            }
            if (layer.layers && layer.layers.length > 0) {
                var childHasTarget = pruneNonTarget(layer, targetId);
                if (childHasTarget) {
                    hasTargetInside = true;
                } else {
                    try { layer.remove(); } catch (removeGroupError) {}
                }
            } else {
                try { layer.remove(); } catch (removeLayerError) {}
            }
        }
        return hasTargetInside;
    }

    var foundInTemp = pruneNonTarget(tempDoc, keepId);
    if (!foundInTemp) throw new Error('Target disappeared while pruning temp document');

    if (CANVAS_POLICY === 'trim_content') {
        try {
            tempDoc.trim(TrimType.TRANSPARENT, true, true, true, true);
        } catch (trimError) {}
    }

    var width = Math.max(1, Math.round(asPixels(tempDoc.width) || 1));
    var height = Math.max(1, Math.round(asPixels(tempDoc.height) || 1));
    if (TARGET_WIDTH > 0 && TARGET_HEIGHT > 0) {
        width = Math.max(1, Math.round(TARGET_WIDTH));
        height = Math.max(1, Math.round(TARGET_HEIGHT));
        tempDoc.resizeImage(
            UnitValue(width, 'px'),
            UnitValue(height, 'px'),
            undefined,
            ResampleMethod.BICUBICSHARPER
        );
    } else if (MAX_SIZE > 0) {
        var longest = Math.max(width, height);
        if (longest > MAX_SIZE) {
            var scale = MAX_SIZE / longest;
            width = Math.max(1, Math.round(width * scale));
            height = Math.max(1, Math.round(height * scale));
            tempDoc.resizeImage(
                UnitValue(width, 'px'),
                UnitValue(height, 'px'),
                undefined,
                ResampleMethod.BICUBICSHARPER
            );
        }
    }

    var targetFile = new File(OUTPUT_PATH);
    if (CONFLICT_POLICY === 'fail_if_exists' && targetFile.exists) {
        throw new Error('Target already exists: ' + targetFile.fsName);
    }
    if (!targetFile.parent.exists) targetFile.parent.create();
    if (FORMAT === 'jpg') {
        var jpgOptions = new JPEGSaveOptions();
        jpgOptions.quality = 12;
        jpgOptions.embedColorProfile = true;
        jpgOptions.formatOptions = FormatOptions.STANDARDBASELINE;
        jpgOptions.matte = MatteType.WHITE;
        tempDoc.saveAs(targetFile, jpgOptions, true, Extension.LOWERCASE);
    } else {
        var pngOptions = new PNGSaveOptions();
        pngOptions.compression = 6;
        pngOptions.interlaced = false;
        tempDoc.saveAs(targetFile, pngOptions, true, Extension.LOWERCASE);
    }

    __deResult({
        success: 1,
        path: targetFile.fsName,
        canvasPolicy: CANVAS_POLICY,
        width: width,
        height: height,
        targetName: targetName,
        targetLayerId: sourceTargetId,
        contentLeft: sourceBounds.left,
        contentTop: sourceBounds.top,
        contentRight: sourceBounds.right,
        contentBottom: sourceBounds.bottom
    });
} catch (error) {
    __deResult({
        success: 0,
        error: String(error && error.message ? error.message : error)
    });
} finally {
    try {
        if (tempDoc && sourceDoc && tempDoc !== sourceDoc) {
            tempDoc.close(SaveOptions.DONOTSAVECHANGES);
        }
    } catch (cleanupError) {}
    try {
        if (sourceDoc) app.activeDocument = sourceDoc;
    } catch (activeRestoreError) {}
    try {
        app.displayDialogs = __dePrevDialogs;
    } catch (dialogsError) {}
}
__deOutput;
`;

        const result = await runJsxCode(jsx, `Export Group as ${input.format.toUpperCase()}`);
        const data = result.data;
        if (!data?.success) {
            throw new Error(data?.error || result.message || 'Export group failed');
        }
        return data;
    }
}
