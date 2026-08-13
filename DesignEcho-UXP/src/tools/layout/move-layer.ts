/**
 * 移动图层工具
 */

import {
    photoshopTransactionRunner,
    type PhotoshopTransactionPreparation
} from '../../core/photoshop-transaction-runner';
import { createToolFailureResult } from '../../core/tool-error-normalizer';
import type { Tool, ToolExecutionContext, ToolSchema } from '../types';

const POSITION_EPSILON = 0.05;

interface MoveLayerParams {
    layerId?: number;
    x?: number;
    y?: number;
    relative?: boolean;
}

interface MoveLayerPoint {
    x: number;
    y: number;
}

interface MoveLayerBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

interface MoveLayerCanvasBounds {
    width: number;
    height: number;
}

interface MoveLayerChecks {
    isOutOfBounds: boolean;
    isPartiallyVisible: boolean;
    visibilityPercent: number;
    overflowDirection?: string;
    suggestedFix?: string;
}

interface MoveLayerState {
    documentId: number;
    layerId: number;
    layerName: string;
    parentId: number | null;
    bounds: MoveLayerBounds;
    canvasBounds: MoveLayerCanvasBounds;
}

interface MoveLayerBefore extends MoveLayerState {
    historyStateId: number;
    deltaX: number;
    deltaY: number;
    targetPosition: MoveLayerPoint;
}

interface MoveLayerResult extends Record<string, unknown> {
    success: boolean;
    code?: string;
    layerId?: number;
    previousPosition?: MoveLayerPoint;
    newPosition?: MoveLayerPoint;
    error?: string;
    errorDetails?: unknown;
    checks?: MoveLayerChecks;
    method?: 'domTranslate';
    layerBounds?: MoveLayerBounds;
    canvasBounds?: MoveLayerCanvasBounds;
}

interface LayerLocation {
    layer: any;
    parentId: number | null;
}

function hasOwn(value: unknown, key: string): boolean {
    return Boolean(value)
        && typeof value === 'object'
        && Object.prototype.hasOwnProperty.call(value, key);
}

function readFiniteNumber(value: unknown): number | undefined {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return undefined;
        const numeric = Number(trimmed);
        return Number.isFinite(numeric) ? numeric : undefined;
    }
    if (value && typeof value === 'object') {
        const unitValue = value as { _value?: unknown; value?: unknown };
        const descriptorValue = unitValue._value ?? unitValue.value;
        if (descriptorValue !== null && descriptorValue !== undefined) {
            const numeric = Number(descriptorValue);
            if (Number.isFinite(numeric)) return numeric;
        }
    }
    return undefined;
}

function readRequiredNumber(value: unknown, fieldName: string): number {
    const numeric = readFiniteNumber(value);
    if (numeric === undefined) {
        throw new Error(`无法读取 ${fieldName}。`);
    }
    return numeric;
}

function findLayerLocation(
    container: any,
    layerId: number,
    parentId: number | null = null
): LayerLocation | null {
    for (const layer of container?.layers || []) {
        if (Number(layer.id) === layerId) {
            return { layer, parentId };
        }
        if (layer.layers) {
            const found = findLayerLocation(layer, layerId, Number(layer.id));
            if (found) return found;
        }
    }
    return null;
}

function getAllLayerIds(container: any): number[] {
    const ids: number[] = [];
    for (const layer of container?.layers || []) {
        const layerId = Number(layer.id);
        if (Number.isSafeInteger(layerId) && layerId > 0) {
            ids.push(layerId);
        }
        if (layer.layers) {
            ids.push(...getAllLayerIds(layer));
        }
    }
    return ids;
}

function readLayerBounds(layer: any): MoveLayerBounds {
    const bounds = layer?.bounds;
    const left = readRequiredNumber(bounds?.left, '图层左边界');
    const top = readRequiredNumber(bounds?.top, '图层上边界');
    const right = readRequiredNumber(bounds?.right, '图层右边界');
    const bottom = readRequiredNumber(bounds?.bottom, '图层下边界');
    return {
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top
    };
}

function readMoveLayerState(document: any, layerId: number): MoveLayerState {
    const location = findLayerLocation(document, layerId);
    if (!location) {
        throw new Error(`写后读回未找到图层 ID ${layerId}。`);
    }
    return {
        documentId: Number(document.id),
        layerId,
        layerName: String(location.layer.name || ''),
        parentId: location.parentId,
        bounds: readLayerBounds(location.layer),
        canvasBounds: {
            width: readRequiredNumber(document.width, '画布宽度'),
            height: readRequiredNumber(document.height, '画布高度')
        }
    };
}

function positionsEqual(left: number, right: number): boolean {
    return Math.abs(left - right) <= POSITION_EPSILON;
}

function sameMoveTarget(left: MoveLayerState, right: MoveLayerState): boolean {
    return left.documentId === right.documentId
        && left.layerId === right.layerId
        && left.parentId === right.parentId
        && left.layerName === right.layerName;
}

function sameLayerGeometry(left: MoveLayerBounds, right: MoveLayerBounds): boolean {
    return positionsEqual(left.width, right.width)
        && positionsEqual(left.height, right.height);
}

function sameLayerBounds(left: MoveLayerBounds, right: MoveLayerBounds): boolean {
    return sameLayerGeometry(left, right)
        && positionsEqual(left.left, right.left)
        && positionsEqual(left.top, right.top)
        && positionsEqual(left.right, right.right)
        && positionsEqual(left.bottom, right.bottom);
}

function buildMoveChecks(
    layerBounds: MoveLayerBounds,
    canvasBounds: MoveLayerCanvasBounds
): MoveLayerChecks {
    const visibleLeft = Math.max(0, layerBounds.left);
    const visibleTop = Math.max(0, layerBounds.top);
    const visibleRight = Math.min(canvasBounds.width, layerBounds.right);
    const visibleBottom = Math.min(canvasBounds.height, layerBounds.bottom);
    const visibleWidth = Math.max(0, visibleRight - visibleLeft);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);
    const visibleArea = visibleWidth * visibleHeight;
    const totalArea = layerBounds.width * layerBounds.height;
    const visibilityPercent = totalArea > 0
        ? Math.round((visibleArea / totalArea) * 100)
        : 0;
    const overflows: string[] = [];
    if (layerBounds.left < 0) overflows.push('左侧');
    if (layerBounds.top < 0) overflows.push('上方');
    if (layerBounds.right > canvasBounds.width) overflows.push('右侧');
    if (layerBounds.bottom > canvasBounds.height) overflows.push('下方');

    const isOutOfBounds = overflows.length > 0;
    const isPartiallyVisible = isOutOfBounds
        && visibilityPercent > 0
        && visibilityPercent < 100;
    let suggestedFix = '';
    if (visibilityPercent === 0) {
        suggestedFix = '⚠️ 图层完全在画布外，用户看不到！建议将图层移回画布内。';
    } else if (visibilityPercent < 50) {
        suggestedFix = `⚠️ 图层只有 ${visibilityPercent}% 可见，大部分内容被裁剪。建议调整位置。`;
    } else if (isOutOfBounds) {
        suggestedFix = `提示：图层${overflows.join('、')}超出画布，${100 - visibilityPercent}% 内容被裁剪。`;
    }

    return {
        isOutOfBounds,
        isPartiallyVisible,
        visibilityPercent,
        overflowDirection: overflows.length > 0 ? overflows.join('、') : undefined,
        suggestedFix: suggestedFix || undefined
    };
}

function buildMoveLayerFailure(
    params: MoveLayerParams,
    code: string,
    error: string,
    errorDetails?: Record<string, unknown>
): MoveLayerResult {
    const failure = createToolFailureResult({
        toolName: 'moveLayer',
        error,
        params
    });
    const baseErrorDetails = failure.errorDetails
        && typeof failure.errorDetails === 'object'
        && !Array.isArray(failure.errorDetails)
        ? failure.errorDetails as Record<string, unknown>
        : {};
    return {
        ...failure,
        success: false,
        code,
        ...(errorDetails
            ? { errorDetails: { ...baseErrorDetails, ...errorDetails } }
            : {})
    };
}

async function translateLayer(layer: any, offsetX: number, offsetY: number): Promise<void> {
    if (typeof layer?.translate !== 'function') {
        throw new Error('当前图层对象不支持 translate，已拒绝调用 Photoshop 原生 move 命令以避免弹窗。');
    }
    await Promise.resolve(layer.translate(offsetX, offsetY));
}

function buildVerifiedMoveResult(
    before: MoveLayerBefore,
    after: MoveLayerState
): MoveLayerResult {
    return {
        success: true,
        layerId: after.layerId,
        previousPosition: {
            x: before.bounds.left,
            y: before.bounds.top
        },
        newPosition: {
            x: after.bounds.left,
            y: after.bounds.top
        },
        checks: buildMoveChecks(after.bounds, after.canvasBounds),
        method: 'domTranslate',
        layerBounds: after.bounds,
        canvasBounds: after.canvasBounds
    };
}

export class MoveLayerTool implements Tool {
    name = 'moveLayer';

    schema: ToolSchema = {
        name: 'moveLayer',
        description: '移动图层（带智能检查）。会自动检测移动后图层是否超出画布、可见比例等，并给出修复建议。返回的 checks 对象包含 visibilityPercent（可见比例%）、suggestedFix（修复建议）等信息。',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '图层ID，如果不提供则移动当前选中的图层'
                },
                x: {
                    type: 'number',
                    description: 'X 轴目标位置或偏移量 (px)，不提供时保持当前位置'
                },
                y: {
                    type: 'number',
                    description: 'Y 轴目标位置或偏移量 (px)，不提供时保持当前位置'
                },
                relative: {
                    type: 'boolean',
                    description: '是否为相对移动（偏移），默认 false（绝对位置）'
                }
            },
            required: []
        }
    };

    async execute(
        params: MoveLayerParams,
        context?: ToolExecutionContext
    ): Promise<MoveLayerResult> {
        const safeParams = params || {};
        const operationId = `moveLayer:${String(
            context?.requestId
            || `${Number(safeParams.layerId) || 'active'}:${Date.now()}`
        )}`;

        return await photoshopTransactionRunner.run<
            MoveLayerBefore,
            MoveLayerState,
            MoveLayerResult
        >({
            operationId,
            toolName: this.name,
            commandName: 'DesignEcho: 移动图层',
            params: safeParams,
            context,
            historyMode: 'suspend',
            expectedEffect: 'mutation_required',
            requiredBinding: 'document_revision',
            rollbackTargetPolicy: 'document_revision',
            prepare(scope): PhotoshopTransactionPreparation<MoveLayerBefore, MoveLayerResult> {
                const hasExplicitLayerId = hasOwn(safeParams, 'layerId');
                const requestedLayerId = Number(safeParams.layerId);
                if (hasExplicitLayerId
                    && (!Number.isSafeInteger(requestedLayerId) || requestedLayerId <= 0)) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildMoveLayerFailure(
                            safeParams,
                            'move_layer_target_invalid',
                            '显式 layerId 必须是正安全整数。'
                        )
                    };
                }

                const activeLayerId = Number(scope.document.activeLayers?.[0]?.id);
                const layerId = hasExplicitLayerId ? requestedLayerId : activeLayerId;
                if (!Number.isSafeInteger(layerId) || layerId <= 0) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildMoveLayerFailure(
                            safeParams,
                            'move_layer_target_required',
                            '请先选中一个图层。'
                        )
                    };
                }

                const xProvided = safeParams.x !== undefined && safeParams.x !== null;
                const yProvided = safeParams.y !== undefined && safeParams.y !== null;
                const requestedX = xProvided ? readFiniteNumber(safeParams.x) : undefined;
                const requestedY = yProvided ? readFiniteNumber(safeParams.y) : undefined;
                if ((xProvided && requestedX === undefined)
                    || (yProvided && requestedY === undefined)) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildMoveLayerFailure(
                            safeParams,
                            'move_layer_position_invalid',
                            'x / y 必须是有限数值。'
                        )
                    };
                }

                const location = findLayerLocation(scope.document, layerId);
                if (!location) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildMoveLayerFailure(
                            safeParams,
                            'move_layer_target_not_found',
                            `未找到图层 ID: ${layerId}`,
                            {
                                requestedLayerId: layerId,
                                availableLayerIds: getAllLayerIds(scope.document)
                            }
                        )
                    };
                }
                if (location.layer.locked) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildMoveLayerFailure(
                            safeParams,
                            'move_layer_target_locked',
                            `图层 "${String(location.layer.name || layerId)}" 已锁定，无法移动`,
                            {
                                locked: true,
                                layerId,
                                layerName: String(location.layer.name || '')
                            }
                        )
                    };
                }
                if (location.layer.isBackgroundLayer) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildMoveLayerFailure(
                            safeParams,
                            'move_layer_background_not_movable',
                            `背景图层无法移动，请先将其转换为普通图层`,
                            { isBackgroundLayer: true, layerId }
                        )
                    };
                }

                const state = readMoveLayerState(scope.document, layerId);
                const boundDocumentId = readFiniteNumber(scope.beforeTarget.documentId);
                const boundHistoryStateId = readFiniteNumber(scope.beforeTarget.historyStateId);
                if (boundDocumentId === undefined
                    || boundHistoryStateId === undefined
                    || state.documentId !== boundDocumentId
                    || !Number.isSafeInteger(boundHistoryStateId)) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildMoveLayerFailure(
                            safeParams,
                            'move_layer_revision_binding_invalid',
                            '无法在 prepare 阶段绑定当前 Photoshop 文档 revision，已拒绝移动。',
                            {
                                documentId: state.documentId,
                                boundDocumentId: scope.beforeTarget.documentId,
                                boundHistoryStateId: scope.beforeTarget.historyStateId
                            }
                        )
                    };
                }
                const relative = safeParams.relative === true;
                const targetX = relative
                    ? state.bounds.left + (requestedX ?? 0)
                    : requestedX ?? state.bounds.left;
                const targetY = relative
                    ? state.bounds.top + (requestedY ?? 0)
                    : requestedY ?? state.bounds.top;
                const before: MoveLayerBefore = {
                    ...state,
                    historyStateId: boundHistoryStateId,
                    deltaX: targetX - state.bounds.left,
                    deltaY: targetY - state.bounds.top,
                    targetPosition: { x: targetX, y: targetY }
                };

                if (before.deltaX === 0 && before.deltaY === 0) {
                    return {
                        kind: 'complete',
                        effect: 'already_satisfied',
                        result: {
                            success: true,
                            layerId,
                            previousPosition: {
                                x: state.bounds.left,
                                y: state.bounds.top
                            },
                            newPosition: {
                                x: state.bounds.left,
                                y: state.bounds.top
                            }
                        }
                    };
                }

                return { kind: 'ready', before };
            },
            async mutate(scope, before): Promise<MoveLayerResult> {
                const location = findLayerLocation(scope.document, before.layerId);
                if (!location || location.parentId !== before.parentId) {
                    return buildMoveLayerFailure(
                        safeParams,
                        'move_layer_target_changed',
                        '移动前图层或其父级已变化，请重新读取当前图层。'
                    );
                }
                await translateLayer(location.layer, before.deltaX, before.deltaY);
                return {
                    success: true,
                    layerId: before.layerId,
                    previousPosition: {
                        x: before.bounds.left,
                        y: before.bounds.top
                    },
                    newPosition: before.targetPosition,
                    method: 'domTranslate'
                };
            },
            readState({ scope, before }): MoveLayerState {
                return readMoveLayerState(scope.document, before.layerId);
            },
            verifyApplied({ before, after }) {
                const sameTarget = sameMoveTarget(before, after);
                const geometryPreserved = sameLayerGeometry(before.bounds, after.bounds);
                const positionApplied = positionsEqual(
                    after.bounds.left,
                    before.targetPosition.x
                ) && positionsEqual(
                    after.bounds.top,
                    before.targetPosition.y
                );
                return {
                    verified: sameTarget && geometryPreserved && positionApplied,
                    message: sameTarget && geometryPreserved
                        ? `写后读回位置 (${after.bounds.left}, ${after.bounds.top})，目标位置 (${before.targetPosition.x}, ${before.targetPosition.y})。`
                        : '写后读回的文档、图层、父级、名称或几何尺寸与事务目标不一致。'
                };
            },
            verifyRolledBack({ before, after }) {
                const verified = sameMoveTarget(before, after)
                    && sameLayerBounds(before.bounds, after.bounds);
                return {
                    verified,
                    message: verified
                        ? `回滚后图层已恢复到 (${before.bounds.left}, ${before.bounds.top})。`
                        : '回滚读回的图层目标、父级或 bounds 未恢复。'
                };
            },
            buildVerifiedResult({ before, after }): MoveLayerResult {
                return buildVerifiedMoveResult(before, after);
            }
        });
    }
}
