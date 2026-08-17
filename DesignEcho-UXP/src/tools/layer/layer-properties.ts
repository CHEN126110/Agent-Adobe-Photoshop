/**
 * 图层属性工具
 * 
 * P0 优先级 - 基础能力
 * - setLayerOpacity: 设置图层不透明度
 * - setBlendMode: 设置混合模式
 * - setLayerFill: 设置图层填充
 * - duplicateLayer: 复制图层
 * - deleteLayer: 删除图层
 * - lockLayer: 锁定/解锁图层
 */

import {
    buildPhotoshopTransactionMutationOutcome,
    photoshopTransactionRunner,
    type PhotoshopTransactionPreparation
} from '../../core/photoshop-transaction-runner';
import { createToolFailureResult, ToolFailureResult } from '../../core/tool-error-normalizer';
import { Tool, ToolExecutionContext, ToolSchema } from '../types';

type LayerPropertiesResult = string | ToolFailureResult;

const photoshop = require('photoshop');
const { app, action } = photoshop;
const { executeAsModal } = photoshop.core;

function findLayerById(container: any, id: number): any {
    for (const layer of container?.layers || []) {
        if (layer.id === id) return layer;
        const nested = findLayerById(layer, id);
        if (nested) return nested;
    }
    return null;
}

function findLayerByName(container: any, name: string): any {
    const needle = String(name || '').trim().toLowerCase();
    if (!needle) return null;
    for (const layer of container?.layers || []) {
        if (String(layer.name || '').toLowerCase().includes(needle)) return layer;
        const nested = findLayerByName(layer, name);
        if (nested) return nested;
    }
    return null;
}

function resolveLayer(doc: any, params: { layerId?: number; layerName?: string }): any {
    if (params.layerId) return findLayerById(doc, params.layerId);
    if (params.layerName) return findLayerByName(doc, params.layerName);
    return doc.activeLayers?.[0];
}

// ==================== 设置图层不透明度 ====================

export class SetLayerOpacityTool implements Tool {
    name = 'setLayerOpacity';
    
    schema: ToolSchema = {
        name: 'setLayerOpacity',
        description: '设置图层不透明度（0-100%）',
        parameters: {
            type: 'object',
            properties: {
                opacity: {
                    type: 'number',
                    description: '不透明度百分比（0-100）'
                },
                layerId: {
                    type: 'number',
                    description: '目标图层 ID（可选，默认当前选中）'
                }
            },
            required: ['opacity']
        }
    };
    
    async execute(params: { opacity: number; layerId?: number }): Promise<LayerPropertiesResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return createToolFailureResult({ toolName: this.name, error: '没有打开的文档', params });
        }
        
        try {
            const layer = resolveLayer(doc, params);
                
            if (!layer) {
                return createToolFailureResult({ toolName: this.name, error: '未找到指定图层', params });
            }
            
            const opacity = Math.max(0, Math.min(100, params.opacity));
            
            await executeAsModal(async () => {
                layer.opacity = opacity;
            }, { commandName: '设置图层不透明度' });
            
            return JSON.stringify({
                success: true,
                layerName: layer.name,
                opacity: opacity
            });
        } catch (error: any) {
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}

// ==================== 设置图层可见性 ====================

export class SetLayerVisibilityTool implements Tool {
    name = 'setLayerVisibility';

    schema: ToolSchema = {
        name: 'setLayerVisibility',
        description: '设置图层或分组的可见性。layerIds 省略时作用于全部顶层图层/分组（用于恢复被导出/截图流程隐藏的屏分组）。',
        parameters: {
            type: 'object',
            properties: {
                visible: {
                    type: 'boolean',
                    description: 'true 显示 / false 隐藏'
                },
                layerIds: {
                    type: 'array',
                    description: '目标图层 ID 列表（可选，省略时作用于全部顶层图层）'
                }
            },
            required: ['visible']
        }
    };

    async execute(params: { visible: boolean; layerIds?: number[] }): Promise<LayerPropertiesResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return createToolFailureResult({ toolName: this.name, error: '没有打开的文档', params });
        }

        try {
            const targetIds = Array.isArray(params.layerIds) && params.layerIds.length > 0
                ? new Set(params.layerIds.map(Number))
                : null;
            const changed: Array<{ id: number; name: string }> = [];

            await executeAsModal(async () => {
                const apply = (layers: any[]) => {
                    for (const layer of layers || []) {
                        if (!targetIds || targetIds.has(Number(layer.id))) {
                            if (layer.visible !== params.visible) {
                                layer.visible = params.visible;
                                changed.push({ id: Number(layer.id), name: String(layer.name) });
                            }
                        }
                        // 指定 layerIds 时递归查找；全顶层模式只作用于顶层
                        if (targetIds && layer.layers && layer.layers.length > 0) {
                            apply(layer.layers);
                        }
                    }
                };
                apply(Array.isArray(doc.layers) ? doc.layers : []);
            }, { commandName: '设置图层可见性' });

            return JSON.stringify({
                success: true,
                visible: params.visible,
                changedCount: changed.length,
                changed: changed.slice(0, 20)
            });
        } catch (error: any) {
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}

// ==================== 设置混合模式 ====================

/**
 * Photoshop 支持的混合模式
 */
const BLEND_MODES = [
    'normal', 'dissolve',
    'darken', 'multiply', 'colorBurn', 'linearBurn', 'darkerColor',
    'lighten', 'screen', 'colorDodge', 'linearDodge', 'lighterColor',
    'overlay', 'softLight', 'hardLight', 'vividLight', 'linearLight', 'pinLight', 'hardMix',
    'difference', 'exclusion', 'subtract', 'divide',
    'hue', 'saturation', 'color', 'luminosity'
];

export class SetBlendModeTool implements Tool {
    name = 'setBlendMode';
    
    schema: ToolSchema = {
        name: 'setBlendMode',
        description: '设置图层混合模式（normal, multiply, screen, overlay, softLight, hardLight, colorDodge, colorBurn, difference, exclusion 等）',
        parameters: {
            type: 'object',
            properties: {
                blendMode: {
                    type: 'string',
                    description: '混合模式名称'
                },
                layerId: {
                    type: 'number',
                    description: '目标图层 ID（可选）'
                }
            },
            required: ['blendMode']
        }
    };
    
    async execute(params: { blendMode: string; layerId?: number }): Promise<LayerPropertiesResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return createToolFailureResult({ toolName: this.name, error: '没有打开的文档', params });
        }
        
        try {
            const layer = resolveLayer(doc, params);
                
            if (!layer) {
                return createToolFailureResult({ toolName: this.name, error: '未找到指定图层', params });
            }
            
            // 验证混合模式
            const mode = params.blendMode.toLowerCase();
            if (!BLEND_MODES.includes(mode)) {
                const failure = createToolFailureResult({
                    toolName: this.name,
                    error: `不支持的混合模式: ${params.blendMode}`,
                    params
                });
                return {
                    ...failure,
                    availableModes: BLEND_MODES
                } as ToolFailureResult & { availableModes: string[] };
            }
            
            await executeAsModal(async () => {
                layer.blendMode = mode;
            }, { commandName: '设置混合模式' });
            
            return JSON.stringify({
                success: true,
                layerName: layer.name,
                blendMode: mode
            });
        } catch (error: any) {
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}

// ==================== 设置图层填充颜色 ====================

export class SetLayerFillTool implements Tool {
    name = 'setLayerFill';
    
    schema: ToolSchema = {
        name: 'setLayerFill',
        description: '设置形状图层的填充颜色',
        parameters: {
            type: 'object',
            properties: {
                color: {
                    type: 'object',
                    description: 'RGB 颜色值 { r: 0-255, g: 0-255, b: 0-255 }'
                },
                layerId: {
                    type: 'number',
                    description: '目标图层 ID（可选）'
                }
            },
            required: ['color']
        }
    };
    
    async execute(params: { color: { r: number; g: number; b: number }; layerId?: number }): Promise<LayerPropertiesResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return createToolFailureResult({ toolName: this.name, error: '没有打开的文档', params });
        }
        
        try {
            const layer = resolveLayer(doc, params);
                
            if (!layer) {
                return createToolFailureResult({ toolName: this.name, error: '未找到指定图层', params });
            }
            
            const { r, g, b } = params.color;
            
            await executeAsModal(async () => {
                // 使用 batchPlay 设置填充颜色
                await action.batchPlay([
                    {
                        _obj: 'set',
                        _target: [{ _ref: 'layer', _id: layer.id }],
                        to: {
                            _obj: 'layer',
                            adjustment: {
                                _obj: 'solidColorLayer',
                                color: {
                                    _obj: 'RGBColor',
                                    red: r,
                                    green: g,  // 标准 RGB green 通道
                                    blue: b
                                }
                            }
                        },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });
            }, { commandName: '设置填充颜色' });
            
            return JSON.stringify({
                success: true,
                layerName: layer.name,
                color: { r, g, b }
            });
        } catch (error: any) {
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}

// ==================== 复制图层 ====================

interface DuplicateLayerBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

interface DuplicateLayerState {
    documentId: number;
    layerId: number;
    parentId: number | null;
    name: string;
    kind: string;
    childCount: number;
    subtreeLayerIds: number[];
    bounds?: DuplicateLayerBounds;
}

interface DuplicateLayerBefore {
    source: DuplicateLayerState;
    beforeLayerIds: number[];
    expectedName: string;
}

interface DuplicateLayerReceipt {
    duplicateLayerId: number;
}

interface DuplicateLayerReadback {
    documentId: number;
    currentLayerIds: number[];
    source?: DuplicateLayerState;
    duplicate?: DuplicateLayerState;
}

interface DuplicateLayerResult extends Record<string, unknown> {
    success: boolean;
    code?: string;
    layerId?: number;
    sourceLayerId?: number;
    originalLayer?: string;
    newLayerId?: number;
    newLayerName?: string;
    bounds?: DuplicateLayerBounds;
    layer?: {
        id: number;
        name: string;
    };
    error?: string;
    errorDetails?: unknown;
    data?: null;
}

function readDuplicateLayerBounds(layer: any): DuplicateLayerBounds | undefined {
    const bounds = layer?.boundsNoEffects || layer?.bounds;
    const left = Number(bounds?.left);
    const top = Number(bounds?.top);
    const right = Number(bounds?.right);
    const bottom = Number(bounds?.bottom);
    if (![left, top, right, bottom].every(Number.isFinite)) return undefined;
    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0) return undefined;
    return { left, top, right, bottom, width, height };
}

function readDuplicateLayerState(
    document: any,
    layerId: number,
    container: any = document,
    parentId: number | null = null
): DuplicateLayerState | undefined {
    for (const layer of Array.from(container?.layers || []) as any[]) {
        if (Number(layer?.id) === layerId) {
            return {
                documentId: Number(document.id),
                layerId,
                parentId,
                name: String(layer.name || ''),
                kind: String(layer.kind || layer.typename || ''),
                childCount: Number(layer.layers?.length || 0),
                subtreeLayerIds: [layerId, ...collectDuplicateLayerIds(layer)],
                bounds: readDuplicateLayerBounds(layer)
            };
        }
        if (layer?.layers) {
            const nested = readDuplicateLayerState(
                document,
                layerId,
                layer,
                Number(layer.id)
            );
            if (nested) return nested;
        }
    }
    return undefined;
}

function collectDuplicateLayerIds(container: any): number[] {
    const layerIds: number[] = [];
    for (const layer of Array.from(container?.layers || []) as any[]) {
        const layerId = Number(layer?.id);
        if (Number.isSafeInteger(layerId) && layerId > 0) {
            layerIds.push(layerId);
        }
        if (layer?.layers) {
            layerIds.push(...collectDuplicateLayerIds(layer));
        }
    }
    return layerIds;
}

function sameDuplicateLayerIdentity(
    left: DuplicateLayerState,
    right: DuplicateLayerState
): boolean {
    return left.documentId === right.documentId
        && left.layerId === right.layerId
        && left.parentId === right.parentId
        && left.name === right.name
        && left.kind === right.kind
        && left.childCount === right.childCount
        && sameLayerIdSet(left.subtreeLayerIds, right.subtreeLayerIds);
}

function sameLayerIdSet(left: readonly number[], right: readonly number[]): boolean {
    if (left.length !== right.length) return false;
    const rightSet = new Set(right);
    return left.every(layerId => rightSet.has(layerId));
}

function sameDuplicateGeometry(
    source: DuplicateLayerBounds,
    duplicate: DuplicateLayerBounds
): boolean {
    const widthTolerance = Math.max(0.5, source.width * 0.005);
    const heightTolerance = Math.max(0.5, source.height * 0.005);
    return Math.abs(source.width - duplicate.width) <= widthTolerance
        && Math.abs(source.height - duplicate.height) <= heightTolerance;
}

function buildDuplicateLayerFailure(
    params: { newName?: string; layerId?: number },
    code: string,
    error: string
): DuplicateLayerResult {
    const failure = createToolFailureResult({ toolName: 'duplicateLayer', error, params });
    return {
        ...failure,
        success: false,
        code,
        error
    };
}

export class DuplicateLayerTool implements Tool {
    name = 'duplicateLayer';
    
    schema: ToolSchema = {
        name: 'duplicateLayer',
        description: '复制当前选中或指定的图层；成功前会读回新图层 ID、名称和可判定的真实图层状态。',
        parameters: {
            type: 'object',
            properties: {
                newName: {
                    type: 'string',
                    description: '新图层名称（可选，默认在原名后加"副本"）'
                },
                layerId: {
                    type: 'number',
                    description: '要复制的图层 ID（可选）'
                }
            },
            required: []
        }
    };
    
    async execute(
        params: { newName?: string; layerId?: number },
        context?: ToolExecutionContext
    ): Promise<DuplicateLayerResult> {
        const safeParams = params || {};
        const operationId = `duplicateLayer:${String(
            context?.requestId || `${Number(safeParams.layerId) || 'active'}:${Date.now()}`
        )}`;

        return await photoshopTransactionRunner.run<
            DuplicateLayerBefore,
            DuplicateLayerReadback,
            DuplicateLayerResult,
            DuplicateLayerReceipt
        >({
            operationId,
            toolName: this.name,
            commandName: 'DesignEcho: 复制图层',
            params: safeParams,
            context,
            historyMode: 'suspend',
            expectedEffect: 'mutation_required',
            rollbackTargetPolicy: 'document_revision',
            prepare(scope): PhotoshopTransactionPreparation<DuplicateLayerBefore, DuplicateLayerResult> {
                const hasExplicitLayerId = Object.prototype.hasOwnProperty.call(
                    safeParams,
                    'layerId'
                );
                const requestedLayerId = Number(safeParams.layerId);
                if (hasExplicitLayerId
                    && (!Number.isSafeInteger(requestedLayerId) || requestedLayerId <= 0)) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildDuplicateLayerFailure(
                            safeParams,
                            'duplicate_layer_target_invalid',
                            '复制图层失败：layerId 必须是正安全整数。请重新读取图层结构后重试。'
                        )
                    };
                }
                const activeLayerId = Number(scope.document.activeLayers?.[0]?.id);
                const sourceLayerId = hasExplicitLayerId ? requestedLayerId : activeLayerId;
                if (!Number.isSafeInteger(sourceLayerId) || sourceLayerId <= 0) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildDuplicateLayerFailure(
                            safeParams,
                            'duplicate_layer_target_required',
                            '复制图层失败：没有选中的图层。请先选择目标图层或提供 layerId。'
                        )
                    };
                }
                const source = readDuplicateLayerState(scope.document, sourceLayerId);
                if (!source) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildDuplicateLayerFailure(
                            safeParams,
                            'duplicate_layer_target_not_found',
                            `复制图层失败：未找到图层 ID ${sourceLayerId}。请重新读取图层结构后重试。`
                        )
                    };
                }
                const explicitName = typeof safeParams.newName === 'string'
                    ? safeParams.newName.trim()
                    : '';
                if (typeof safeParams.newName === 'string' && !explicitName) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildDuplicateLayerFailure(
                            safeParams,
                            'duplicate_layer_name_invalid',
                            '复制图层失败：newName 不能是空字符串。请提供有效名称或省略该参数。'
                        )
                    };
                }
                return {
                    kind: 'ready',
                    before: {
                        source,
                        beforeLayerIds: collectDuplicateLayerIds(scope.document),
                        expectedName: explicitName || `${source.name} 副本`
                    }
                };
            },
            async mutate(scope, before) {
                const sourceLayer = findLayerById(scope.document, before.source.layerId);
                if (!sourceLayer) {
                    return buildDuplicateLayerFailure(
                        safeParams,
                        'duplicate_layer_target_changed',
                        `复制图层失败：写入前已找不到图层 ID ${before.source.layerId}。请重新读取图层结构后重试。`
                    );
                }
                const duplicateLayer = await sourceLayer.duplicate();
                const duplicateLayerId = Number(duplicateLayer?.id);
                if (!Number.isSafeInteger(duplicateLayerId)
                    || duplicateLayerId <= 0
                    || before.beforeLayerIds.includes(duplicateLayerId)) {
                    return buildDuplicateLayerFailure(
                        safeParams,
                        'duplicate_layer_result_invalid',
                        '复制图层命令已返回，但未能取得新的图层 ID。已停止并回滚；请重新读取图层结构后重试。'
                    );
                }
                duplicateLayer.name = before.expectedName;
                return buildPhotoshopTransactionMutationOutcome(
                    {
                        success: true,
                        layerId: duplicateLayerId,
                        sourceLayerId: before.source.layerId,
                        originalLayer: before.source.name,
                        newLayerId: duplicateLayerId,
                        newLayerName: before.expectedName,
                        layer: {
                            id: duplicateLayerId,
                            name: before.expectedName
                        }
                    },
                    { duplicateLayerId }
                );
            },
            readState({ phase, scope, before, receipt }): DuplicateLayerReadback {
                const currentLayerIds = collectDuplicateLayerIds(scope.document);
                const addedLayerIds = currentLayerIds.filter(
                    layerId => !before.beforeLayerIds.includes(layerId)
                );
                const duplicateLayerId = Number(receipt?.duplicateLayerId || addedLayerIds[0]);
                if (phase !== 'after_rollback'
                    && (!Number.isSafeInteger(duplicateLayerId) || duplicateLayerId <= 0)) {
                    throw new Error('复制图层写后读回缺少新图层 ID。');
                }
                return {
                    documentId: Number(scope.document.id),
                    currentLayerIds,
                    source: readDuplicateLayerState(scope.document, before.source.layerId),
                    duplicate: Number.isSafeInteger(duplicateLayerId) && duplicateLayerId > 0
                        ? readDuplicateLayerState(scope.document, duplicateLayerId)
                        : undefined
                };
            },
            verifyApplied({ before, after, receipt }) {
                const addedLayerIds = after.currentLayerIds.filter(
                    layerId => !before.beforeLayerIds.includes(layerId)
                );
                const duplicate = after.duplicate;
                const sourcePreserved = Boolean(after.source)
                    && sameDuplicateLayerIdentity(before.source, after.source as DuplicateLayerState);
                let duplicateFactVerified = Boolean(duplicate)
                    && duplicate?.layerId === receipt?.duplicateLayerId
                    && duplicate?.name === before.expectedName
                    && duplicate?.kind === before.source.kind
                    && duplicate?.childCount === before.source.childCount
                    && Boolean(duplicate)
                    && sameLayerIdSet(
                        addedLayerIds,
                        (duplicate as DuplicateLayerState).subtreeLayerIds
                    );
                if (duplicateFactVerified && before.source.bounds) {
                    duplicateFactVerified = Boolean(duplicate?.bounds)
                        && sameDuplicateGeometry(
                            before.source.bounds,
                            duplicate?.bounds as DuplicateLayerBounds
                        );
                }
                return {
                    verified: after.documentId === before.source.documentId
                        && sourcePreserved
                        && duplicateFactVerified,
                    message: `复制图层写后读回不一致：新增图层 ID=[${addedLayerIds.join(', ')}]，预期名称=“${before.expectedName}”，实际名称=“${duplicate?.name || ''}”，bounds=${duplicate?.bounds ? `${duplicate.bounds.width}×${duplicate.bounds.height}` : '空'}。`
                };
            },
            verifyRolledBack({ before, after }) {
                return {
                    verified: after.documentId === before.source.documentId
                        && Boolean(after.source)
                        && sameDuplicateLayerIdentity(
                            before.source,
                            after.source as DuplicateLayerState
                        )
                        && sameLayerIdSet(before.beforeLayerIds, after.currentLayerIds),
                    message: `复制图层回滚后图层集合不一致：原 ID=[${before.beforeLayerIds.join(', ')}]，当前 ID=[${after.currentLayerIds.join(', ')}]。`
                };
            },
            buildVerifiedResult({ before, after }): DuplicateLayerResult {
                const duplicate = after.duplicate as DuplicateLayerState;
                return {
                    success: true,
                    layerId: duplicate.layerId,
                    sourceLayerId: before.source.layerId,
                    originalLayer: before.source.name,
                    newLayerId: duplicate.layerId,
                    newLayerName: duplicate.name,
                    bounds: duplicate.bounds,
                    layer: {
                        id: duplicate.layerId,
                        name: duplicate.name
                    }
                };
            }
        });
    }
}

// ==================== 删除图层 ====================

export class DeleteLayerTool implements Tool {
    name = 'deleteLayer';
    
    schema: ToolSchema = {
        name: 'deleteLayer',
        description: '删除指定图层。删除会进入 Photoshop 历史记录，可在文档保持打开时撤销；仍应优先传入明确的 layerId，并在删除后读回图层结构。',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '要删除的图层 ID（可选，默认当前选中）'
                },
                layerName: {
                    type: 'string',
                    description: '要删除的图层名称（可选，支持模糊匹配）'
                }
            },
            required: []
        }
    };
    
    async execute(params: { layerId?: number; layerName?: string }): Promise<LayerPropertiesResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return createToolFailureResult({ toolName: this.name, error: '没有打开的文档', params });
        }
        
        try {
            let layer: any;
            
            layer = resolveLayer(doc, params);
            
            if (!layer) {
                return createToolFailureResult({ toolName: this.name, error: '未找到指定图层', params });
            }
            
            const deletedName = layer.name;
            const deletedId = layer.id;
            
            await executeAsModal(async () => {
                await layer.delete();
            }, { commandName: '删除图层' });
            
            return JSON.stringify({
                success: true,
                deletedLayerId: deletedId,
                deletedLayerName: deletedName
            });
        } catch (error: any) {
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}

// ==================== 锁定/解锁图层 ====================

type LockLayerLockType = 'all' | 'position' | 'transparent';

interface LockLayerParams {
    lock: boolean;
    lockType?: string;
    layerId?: number;
}

interface LockLayerState {
    documentId: number;
    layerId: number;
    layerName: string;
    lockingDescriptor: Record<string, unknown>;
    protectionFlags: Record<string, boolean>;
}

interface LockLayerBefore extends LockLayerState {
    historyStateId: number;
    lockType: LockLayerLockType;
    requestedLock: boolean;
}

interface LockLayerResult extends Record<string, unknown> {
    success: boolean;
    code?: string;
    layerName?: string;
    locked?: boolean;
    lockType?: LockLayerLockType;
    error?: string;
    errorDetails?: unknown;
}

const LOCK_DESCRIPTOR_FIELD_BY_TYPE: Record<LockLayerLockType, string> = {
    all: 'protectAll',
    position: 'protectPosition',
    transparent: 'protectTransparency'
};

const CANONICAL_LOCK_DESCRIPTOR_FIELDS = [
    'protectAll',
    'protectComposite',
    'protectPosition',
    'protectTransparency'
] as const;

function hasOwnProperty(value: unknown, key: string): boolean {
    return Boolean(value)
        && typeof value === 'object'
        && Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeLockType(value: unknown): LockLayerLockType | undefined {
    const normalized = String(value || 'all');
    if (normalized === 'all'
        || normalized === 'position'
        || normalized === 'transparent') {
        return normalized;
    }
    return undefined;
}

function buildLockLayerFailure(
    params: LockLayerParams,
    code: string,
    error: string,
    details?: Record<string, unknown>
): LockLayerResult {
    const failure = createToolFailureResult({
        toolName: 'lockLayer',
        error,
        params
    });
    const baseErrorDetails: Record<string, unknown> = failure.errorDetails
        && typeof failure.errorDetails === 'object'
        && !Array.isArray(failure.errorDetails)
        ? { ...failure.errorDetails }
        : {};
    return {
        ...failure,
        success: false,
        code,
        ...(details
            ? { errorDetails: { ...baseErrorDetails, ...details } }
            : {})
    };
}

function assertLockBatchPlaySucceeded(result: unknown, fallbackMessage: string): void {
    if (!Array.isArray(result)) {
        throw new Error(`${fallbackMessage} Photoshop 未返回 batchPlay 结果数组。`);
    }
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

function readProtectionFlags(
    lockingDescriptor: Record<string, unknown>
): Record<string, boolean> {
    const protectionFlags: Record<string, boolean> = {};
    for (const field of CANONICAL_LOCK_DESCRIPTOR_FIELDS) {
        protectionFlags[field] = lockingDescriptor[field] === true;
    }
    for (const [field, value] of Object.entries(lockingDescriptor)) {
        if (field.startsWith('protect') && typeof value === 'boolean') {
            protectionFlags[field] = value;
        }
    }
    return protectionFlags;
}

async function readLockLayerState(documentId: number, layerId: number): Promise<LockLayerState> {
    const result = await action.batchPlay([{
        _obj: 'get',
        _target: [
            { _ref: 'layer', _id: layerId },
            { _ref: 'document', _id: documentId }
        ],
        _options: { dialogOptions: 'dontDisplay' }
    }], { synchronousExecution: true });
    assertLockBatchPlaySucceeded(result, `读取图层 ID ${layerId} 的锁定状态失败。`);

    const descriptor = result[0];
    if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
        throw new Error(`图层 ID ${layerId} 的 get 描述符无效。`);
    }
    const descriptorRecord = descriptor as Record<string, unknown>;
    const descriptorLayerId = Number(descriptorRecord.layerID);
    if (!Number.isSafeInteger(descriptorLayerId) || descriptorLayerId !== layerId) {
        throw new Error(
            `图层锁定读回目标不一致：请求 ID ${layerId}，返回 ID ${String(descriptorRecord.layerID)}。`
        );
    }
    const locking = descriptorRecord.layerLocking;
    if (!locking || typeof locking !== 'object' || Array.isArray(locking)) {
        throw new Error(`图层 ID ${layerId} 的描述符缺少 layerLocking。`);
    }
    const lockingDescriptor = { ...(locking as Record<string, unknown>) };
    return {
        documentId,
        layerId,
        layerName: String(descriptorRecord.name || ''),
        lockingDescriptor,
        protectionFlags: readProtectionFlags(lockingDescriptor)
    };
}

function readRequestedLock(state: LockLayerState, lockType: LockLayerLockType): boolean {
    return state.protectionFlags[LOCK_DESCRIPTOR_FIELD_BY_TYPE[lockType]] === true;
}

function buildPatchedLockingDescriptor(before: LockLayerBefore): Record<string, unknown> {
    const descriptor: Record<string, unknown> = {
        ...before.lockingDescriptor,
        _obj: 'layerLocking'
    };
    for (const field of CANONICAL_LOCK_DESCRIPTOR_FIELDS) {
        descriptor[field] = before.protectionFlags[field] === true;
    }
    descriptor[LOCK_DESCRIPTOR_FIELD_BY_TYPE[before.lockType]] = before.requestedLock;
    return descriptor;
}

function sameLockLayerTarget(left: LockLayerState, right: LockLayerState): boolean {
    return left.documentId === right.documentId
        && left.layerId === right.layerId
        && left.layerName === right.layerName;
}

function sameProtectionFlags(
    left: Record<string, boolean>,
    right: Record<string, boolean>
): boolean {
    const fields = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const field of fields) {
        if (left[field] !== right[field]) return false;
    }
    return true;
}

function verifyLockApplied(before: LockLayerBefore, after: LockLayerState): boolean {
    if (!sameLockLayerTarget(before, after)) return false;
    const requestedField = LOCK_DESCRIPTOR_FIELD_BY_TYPE[before.lockType];
    const fields = new Set([
        ...Object.keys(before.protectionFlags),
        ...Object.keys(after.protectionFlags)
    ]);
    for (const field of fields) {
        const expected = field === requestedField
            ? before.requestedLock
            : before.protectionFlags[field];
        if (after.protectionFlags[field] !== expected) return false;
    }
    return true;
}

function buildVerifiedLockLayerResult(
    after: LockLayerState,
    lockType: LockLayerLockType
): LockLayerResult {
    return {
        success: true,
        layerName: after.layerName,
        locked: readRequestedLock(after, lockType),
        lockType
    };
}

export class LockLayerTool implements Tool {
    name = 'lockLayer';
    
    schema: ToolSchema = {
        name: 'lockLayer',
        description: '锁定或解锁图层（可分别控制位置锁定、透明度锁定、完全锁定）',
        parameters: {
            type: 'object',
            properties: {
                lock: {
                    type: 'boolean',
                    description: '是否锁定（true=锁定，false=解锁）'
                },
                lockType: {
                    type: 'string',
                    description: '锁定类型：all（完全锁定）、position（位置）、transparent（透明度）'
                },
                layerId: {
                    type: 'number',
                    description: '目标图层 ID（可选）'
                }
            },
            required: ['lock']
        }
    };
    
    async execute(
        params: LockLayerParams,
        context?: ToolExecutionContext
    ): Promise<LockLayerResult> {
        const safeParams = params || {} as LockLayerParams;
        const operationId = `lockLayer:${String(
            context?.requestId
            || `${Number(safeParams.layerId) || 'active'}:${Date.now()}`
        )}`;

        return await photoshopTransactionRunner.run<
            LockLayerBefore,
            LockLayerState,
            LockLayerResult
        >({
            operationId,
            toolName: this.name,
            commandName: safeParams.lock ? '锁定图层' : '解锁图层',
            params: safeParams,
            context,
            historyMode: 'suspend',
            expectedEffect: 'mutation_required',
            requiredBinding: 'document_revision',
            rollbackTargetPolicy: 'document_revision',
            async prepare(scope): Promise<PhotoshopTransactionPreparation<LockLayerBefore, LockLayerResult>> {
                if (typeof safeParams.lock !== 'boolean') {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildLockLayerFailure(
                            safeParams,
                            'lock_layer_value_invalid',
                            'lock 必须是 boolean。'
                        )
                    };
                }
                const lockType = normalizeLockType(safeParams.lockType);
                if (!lockType) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildLockLayerFailure(
                            safeParams,
                            'lock_layer_type_invalid',
                            'lockType 仅支持 all、position 或 transparent。',
                            { receivedLockType: safeParams.lockType }
                        )
                    };
                }

                const hasExplicitLayerId = hasOwnProperty(safeParams, 'layerId');
                const requestedLayerId = Number(safeParams.layerId);
                if (hasExplicitLayerId
                    && (!Number.isSafeInteger(requestedLayerId) || requestedLayerId <= 0)) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildLockLayerFailure(
                            safeParams,
                            'lock_layer_target_invalid',
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
                        result: buildLockLayerFailure(
                            safeParams,
                            'lock_layer_target_required',
                            '请先选中一个图层，或传入显式 layerId。'
                        )
                    };
                }
                if (!findLayerById(scope.document, layerId)) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildLockLayerFailure(
                            safeParams,
                            'lock_layer_target_not_found',
                            `未找到图层 ID ${layerId}。`
                        )
                    };
                }

                const documentId = Number(scope.beforeTarget.documentId);
                const historyStateId = Number(scope.beforeTarget.historyStateId);
                if (scope.beforeTarget.documentId === null
                    || scope.beforeTarget.historyStateId === null
                    || !Number.isSafeInteger(documentId)
                    || documentId <= 0
                    || !Number.isSafeInteger(historyStateId)) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildLockLayerFailure(
                            safeParams,
                            'lock_layer_revision_binding_invalid',
                            '无法在 prepare 阶段绑定当前 Photoshop 文档 revision，已拒绝写入。',
                            {
                                documentId: scope.beforeTarget.documentId,
                                historyStateId: scope.beforeTarget.historyStateId
                            }
                        )
                    };
                }

                const state = await readLockLayerState(documentId, layerId);
                const before: LockLayerBefore = {
                    ...state,
                    historyStateId,
                    lockType,
                    requestedLock: safeParams.lock
                };
                if (readRequestedLock(before, lockType) === safeParams.lock) {
                    return {
                        kind: 'complete',
                        effect: 'already_satisfied',
                        result: buildVerifiedLockLayerResult(before, lockType)
                    };
                }
                return { kind: 'ready', before };
            },
            async mutate(_scope, before): Promise<LockLayerResult> {
                const result = await action.batchPlay([{
                    _obj: 'applyLocking',
                    _target: [
                        { _ref: 'layer', _id: before.layerId },
                        { _ref: 'document', _id: before.documentId }
                    ],
                    layerLocking: buildPatchedLockingDescriptor(before),
                    _options: { dialogOptions: 'dontDisplay' }
                }], { synchronousExecution: true });
                assertLockBatchPlaySucceeded(
                    result,
                    `Photoshop 拒绝修改图层 ID ${before.layerId} 的锁定状态。`
                );
                return {
                    success: true,
                    layerName: before.layerName,
                    locked: before.requestedLock,
                    lockType: before.lockType
                };
            },
            async readState({ before }): Promise<LockLayerState> {
                return await readLockLayerState(before.documentId, before.layerId);
            },
            verifyApplied({ before, after }) {
                const verified = verifyLockApplied(before, after);
                return {
                    verified,
                    message: verified
                        ? `图层 ID ${before.layerId} 的 ${before.lockType} 锁已写入并读回。`
                        : `图层 ID ${before.layerId} 的锁定状态或非目标锁位与预期不一致。`
                };
            },
            verifyRolledBack({ before, after }) {
                const verified = sameLockLayerTarget(before, after)
                    && sameProtectionFlags(before.protectionFlags, after.protectionFlags);
                return {
                    verified,
                    message: verified
                        ? `回滚后图层 ID ${before.layerId} 的全部锁位已恢复。`
                        : `回滚后图层 ID ${before.layerId} 的目标或锁位未恢复。`
                };
            },
            buildVerifiedResult({ before, after }): LockLayerResult {
                return buildVerifiedLockLayerResult(after, before.lockType);
            }
        });
    }
}

// ==================== 获取图层属性 ====================

export class GetLayerPropertiesTool implements Tool {
    name = 'getLayerProperties';
    
    schema: ToolSchema = {
        name: 'getLayerProperties',
        description: '获取图层的详细属性（不透明度、混合模式、锁定状态等）',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '目标图层 ID（可选）'
                }
            },
            required: []
        }
    };
    
    async execute(params: { layerId?: number }): Promise<LayerPropertiesResult> {
        const doc = app.activeDocument;
        if (!doc) {
            return createToolFailureResult({ toolName: this.name, error: '没有打开的文档', params });
        }
        
        try {
            const layer = resolveLayer(doc, params);
                
            if (!layer) {
                return createToolFailureResult({ toolName: this.name, error: '未找到指定图层', params });
            }
            
            return JSON.stringify({
                success: true,
                properties: {
                    id: layer.id,
                    name: layer.name,
                    kind: layer.kind,
                    opacity: layer.opacity,
                    blendMode: layer.blendMode,
                    visible: layer.visible,
                    locked: {
                        all: layer.allLocked,
                        position: layer.positionLocked,
                        transparent: layer.transparentPixelsLocked
                    },
                    bounds: layer.bounds ? {
                        left: layer.bounds.left,
                        top: layer.bounds.top,
                        right: layer.bounds.right,
                        bottom: layer.bounds.bottom,
                        width: layer.bounds.right - layer.bounds.left,
                        height: layer.bounds.bottom - layer.bounds.top
                    } : null
                }
            });
        } catch (error: any) {
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }
}
