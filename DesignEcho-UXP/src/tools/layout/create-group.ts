/**
 * 创建图层组工具。
 *
 * createGroup 与 groupLayers 共用同一个事务化实现，避免两套编组逻辑分别把
 * “发出 make 命令”误当成“目标子图层已经进入新组”。
 */

import { action } from 'photoshop';
import {
    buildPhotoshopTransactionMutationOutcome,
    photoshopTransactionRunner,
    type PhotoshopTransactionPreparation
} from '../../core/photoshop-transaction-runner';
import { createToolFailureResult } from '../../core/tool-error-normalizer';
import type { Tool, ToolExecutionContext } from '../types';

export interface GroupCreationParams {
    groupName: string;
    fromSelected?: boolean;
    layerIds?: number[];
}

interface LayerLocationState {
    layerId: number;
    parentId: number | null;
    index: number;
}

interface GroupCreationBefore {
    documentId: number;
    groupName: string;
    fromSelected: boolean;
    expectedChildIds: number[];
    originalLocations: LayerLocationState[];
}

interface GroupCreationReceipt {
    groupId: number;
}

interface GroupCreationReadback {
    documentId: number;
    groupId: number;
    groupExists: boolean;
    groupName?: string;
    childIds: number[];
    targetLocations: LayerLocationState[];
}

export interface GroupCreationResult extends Record<string, unknown> {
    success: boolean;
    code?: string;
    entityType?: 'group';
    documentId?: number;
    layerId?: number;
    name?: string;
    groupedLayerCount?: number;
    groupName?: string;
    layerCount?: number;
    group?: {
        id: number;
        name: string;
        layerCount: number;
    };
    message?: string;
    error?: string;
    errorDetails?: unknown;
    data?: null;
}

function readSafeLayerId(value: unknown): number | undefined {
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) return undefined;
    return numeric;
}

function normalizeRequestedLayerIds(value: unknown): {
    ids: number[];
    invalid: boolean;
} {
    if (value === undefined) return { ids: [], invalid: false };
    if (!Array.isArray(value)) return { ids: [], invalid: true };

    const ids: number[] = [];
    const seen = new Set<number>();
    for (const item of value) {
        const layerId = readSafeLayerId(item);
        if (layerId === undefined) return { ids: [], invalid: true };
        if (!seen.has(layerId)) {
            seen.add(layerId);
            ids.push(layerId);
        }
    }
    return { ids, invalid: false };
}

function findLayerLocation(
    container: any,
    layerId: number,
    parentId: number | null = null
): LayerLocationState | undefined {
    const layers = Array.from(container?.layers || []) as any[];
    for (let index = 0; index < layers.length; index++) {
        const layer = layers[index];
        if (Number(layer?.id) === layerId) {
            return { layerId, parentId, index };
        }
        if (layer?.layers) {
            const nested = findLayerLocation(layer, layerId, Number(layer.id));
            if (nested) return nested;
        }
    }
    return undefined;
}

function findLayerById(container: any, layerId: number): any | undefined {
    for (const layer of Array.from(container?.layers || []) as any[]) {
        if (Number(layer?.id) === layerId) return layer;
        if (layer?.layers) {
            const nested = findLayerById(layer, layerId);
            if (nested) return nested;
        }
    }
    return undefined;
}

function readSelectedLayerIds(document: any): number[] {
    return (Array.from(document?.activeLayers || []) as any[])
        .map(layer => readSafeLayerId(layer?.id))
        .filter((layerId): layerId is number => layerId !== undefined);
}

function sameNumberSet(left: readonly number[], right: readonly number[]): boolean {
    if (left.length !== right.length) return false;
    const rightSet = new Set(right);
    return left.every(value => rightSet.has(value));
}

function sameLayerLocations(
    expected: readonly LayerLocationState[],
    actual: readonly LayerLocationState[]
): boolean {
    if (expected.length !== actual.length) return false;
    const actualById = new Map(actual.map(location => [location.layerId, location]));
    return expected.every((location) => {
        const candidate = actualById.get(location.layerId);
        return candidate?.parentId === location.parentId
            && candidate.index === location.index;
    });
}

function readGroupCreationState(
    document: any,
    before: GroupCreationBefore,
    groupId: number
): GroupCreationReadback {
    const group = findLayerById(document, groupId);
    const targetLocations = before.expectedChildIds
        .map(layerId => findLayerLocation(document, layerId))
        .filter((location): location is LayerLocationState => Boolean(location));
    if (!group) {
        return {
            documentId: Number(document.id),
            groupId,
            groupExists: false,
            childIds: [],
            targetLocations
        };
    }

    const childIds = (Array.from(group.layers || []) as any[])
        .map(layer => readSafeLayerId(layer?.id))
        .filter((layerId): layerId is number => layerId !== undefined);
    return {
        documentId: Number(document.id),
        groupId,
        groupExists: true,
        groupName: String(group.name || ''),
        childIds,
        targetLocations
    };
}

function assertBatchPlaySucceeded(descriptors: unknown, operation: string): void {
    if (!Array.isArray(descriptors) || descriptors.length === 0) {
        throw new Error(`${operation} 未返回 Photoshop 命令结果。`);
    }
    const failure = descriptors.find((descriptor) => (
        descriptor
        && typeof descriptor === 'object'
        && !Array.isArray(descriptor)
        && String((descriptor as Record<string, unknown>)._obj || '').toLowerCase() === 'error'
    )) as Record<string, unknown> | undefined;
    if (!failure) return;
    throw new Error(String(failure.message || failure.error || `${operation} 被 Photoshop 拒绝。`));
}

async function selectLayersByIds(layerIds: number[]): Promise<void> {
    const descriptors = await action.batchPlay([
        {
            _obj: 'select',
            _target: layerIds.map(id => ({ _ref: 'layer', _id: id })),
            makeVisible: false,
            _options: { dialogOptions: 'dontDisplay' }
        }
    ], {});
    assertBatchPlaySucceeded(descriptors, '选择待编组图层');
}

function buildGroupCreationFailure(
    toolName: string,
    params: GroupCreationParams,
    code: string,
    error: string
): GroupCreationResult {
    const failure = createToolFailureResult({ toolName, error, params });
    return {
        ...failure,
        success: false,
        code,
        error
    };
}

function buildVerifiedGroupResult(
    after: GroupCreationReadback
): GroupCreationResult {
    const name = String(after.groupName || '');
    const layerCount = after.childIds.length;
    return {
        success: true,
        entityType: 'group',
        documentId: after.documentId,
        layerId: after.groupId,
        name,
        groupedLayerCount: layerCount,
        groupName: name,
        layerCount,
        group: {
            id: after.groupId,
            name,
            layerCount
        },
        message: layerCount > 0
            ? `已创建图层组“${name}”，并读回确认包含 ${layerCount} 个图层。`
            : `已创建空图层组“${name}”，并读回确认组内没有子图层。`
    };
}

export async function executeVerifiedGroupCreation(
    toolName: string,
    params: GroupCreationParams,
    context?: ToolExecutionContext
): Promise<GroupCreationResult> {
    const safeParams = params || { groupName: '' };
    const operationId = `${toolName}:${String(
        context?.requestId || `${Date.now()}`
    )}`;

    return await photoshopTransactionRunner.run<
        GroupCreationBefore,
        GroupCreationReadback,
        GroupCreationResult,
        GroupCreationReceipt
    >({
        operationId,
        toolName,
        commandName: 'DesignEcho: 创建图层组',
        params: safeParams,
        context,
        historyMode: 'suspend',
        expectedEffect: 'mutation_required',
        rollbackTargetPolicy: 'document_revision',
        prepare(scope): PhotoshopTransactionPreparation<GroupCreationBefore, GroupCreationResult> {
            const groupName = String(safeParams.groupName || '').trim();
            if (!groupName) {
                return {
                    kind: 'complete',
                    effect: 'none',
                    result: buildGroupCreationFailure(
                        toolName,
                        safeParams,
                        'create_group_name_required',
                        '创建图层组失败：groupName 不能为空。请提供明确的组名称后重试。'
                    )
                };
            }

            const normalizedIds = normalizeRequestedLayerIds(safeParams.layerIds);
            if (normalizedIds.invalid) {
                return {
                    kind: 'complete',
                    effect: 'none',
                    result: buildGroupCreationFailure(
                        toolName,
                        safeParams,
                        'create_group_layer_ids_invalid',
                        '创建图层组失败：layerIds 必须只包含正安全整数。请重新读取图层 ID 后重试。'
                    )
                };
            }

            const useExplicitLayerIds = normalizedIds.ids.length > 0;
            const fromSelected = useExplicitLayerIds || safeParams.fromSelected === true;
            let expectedChildIds: number[] = [];
            if (useExplicitLayerIds) {
                expectedChildIds = normalizedIds.ids;
            } else if (fromSelected) {
                expectedChildIds = readSelectedLayerIds(scope.document);
            }
            if (fromSelected && expectedChildIds.length === 0) {
                return {
                    kind: 'complete',
                    effect: 'none',
                    result: buildGroupCreationFailure(
                        toolName,
                        safeParams,
                        'create_group_selection_required',
                        '创建图层组失败：fromSelected 模式下没有选中图层。请先选择图层，或提供明确的 layerIds。'
                    )
                };
            }

            const originalLocations: LayerLocationState[] = [];
            for (const layerId of expectedChildIds) {
                const location = findLayerLocation(scope.document, layerId);
                if (!location) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildGroupCreationFailure(
                            toolName,
                            safeParams,
                            'create_group_target_not_found',
                            `创建图层组失败：未找到图层 ID ${layerId}。请重新读取图层结构后重试。`
                        )
                    };
                }
                originalLocations.push(location);
            }

            return {
                kind: 'ready',
                before: {
                    documentId: Number(scope.document.id),
                    groupName,
                    fromSelected,
                    expectedChildIds,
                    originalLocations
                }
            };
        },
        async mutate(scope, before) {
            if (before.expectedChildIds.length > 0) {
                await selectLayersByIds(before.expectedChildIds);
                const selectedIds = readSelectedLayerIds(scope.document);
                if (!sameNumberSet(selectedIds, before.expectedChildIds)) {
                    return buildGroupCreationFailure(
                        toolName,
                        safeParams,
                        'create_group_selection_mismatch',
                        `创建图层组失败：写入前选中图层与请求不一致；请求 ${before.expectedChildIds.join(', ')}，实际 ${selectedIds.join(', ') || '无'}。请重新读取图层结构后重试。`
                    );
                }
            }

            const makeDescriptors = before.fromSelected
                ? [{
                    _obj: 'make',
                    _target: [{ _ref: 'layerSection' }],
                    from: {
                        _ref: 'layer',
                        _enum: 'ordinal',
                        _value: 'targetEnum'
                    },
                    using: {
                        _obj: 'layerSection',
                        name: before.groupName
                    },
                    _options: { dialogOptions: 'dontDisplay' }
                }]
                : [
                    {
                        _obj: 'make',
                        _target: [{ _ref: 'layerSection' }],
                        _options: { dialogOptions: 'dontDisplay' }
                    },
                    {
                        _obj: 'set',
                        _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                        to: {
                            _obj: 'layer',
                            name: before.groupName
                        },
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ];
            const descriptors = await action.batchPlay(makeDescriptors, {});
            assertBatchPlaySucceeded(descriptors, '创建图层组');

            const groupId = readSafeLayerId(scope.document.activeLayers?.[0]?.id);
            if (groupId === undefined) {
                return buildGroupCreationFailure(
                    toolName,
                    safeParams,
                    'create_group_result_missing',
                    '创建图层组命令已返回，但未能读到新组 ID。已停止并回滚；请重新读取图层结构后重试。'
                );
            }
            return buildPhotoshopTransactionMutationOutcome(
                {
                    success: true,
                    entityType: 'group',
                    documentId: before.documentId,
                    layerId: groupId,
                    name: before.groupName,
                    groupedLayerCount: before.expectedChildIds.length,
                    groupName: before.groupName,
                    layerCount: before.expectedChildIds.length,
                    group: {
                        id: groupId,
                        name: before.groupName,
                        layerCount: before.expectedChildIds.length
                    }
                },
                { groupId }
            );
        },
        readState({ phase, scope, before, receipt }): GroupCreationReadback {
            const groupId = readSafeLayerId(receipt?.groupId);
            if (groupId === undefined) {
                // mutate 在真正创建组之前失败时没有 receipt；Runner 仍会进入
                // after_rollback 复核，此时只需确认原图层结构已经恢复。
                if (phase === 'after_rollback') {
                    return readGroupCreationState(scope.document, before, 0);
                }
                throw new Error('创建图层组写后读回缺少新组 ID。');
            }
            return readGroupCreationState(scope.document, before, groupId);
        },
        verifyApplied({ before, after }) {
            const sameDocument = after.documentId === before.documentId;
            const sameName = after.groupName === before.groupName;
            const sameChildren = sameNumberSet(after.childIds, before.expectedChildIds);
            let message = `创建图层组写后读回子图层为 [${after.childIds.join(', ')}]，预期为 [${before.expectedChildIds.join(', ')}]。`;
            if (!sameDocument) {
                message = '创建图层组写后读回的文档与事务目标不一致。';
            } else if (!after.groupExists) {
                message = `创建图层组写后读回未找到新组 ID ${after.groupId}。`;
            } else if (!sameName) {
                message = `创建图层组写后读回名称为“${after.groupName || ''}”，预期为“${before.groupName}”。`;
            }
            return {
                verified: sameDocument && after.groupExists && sameName && sameChildren,
                message
            };
        },
        verifyRolledBack({ before, after }) {
            return {
                verified: after.documentId === before.documentId
                    && !after.groupExists
                    && sameLayerLocations(before.originalLocations, after.targetLocations),
                message: after.groupExists
                    ? `回滚后仍能读到新组 ID ${after.groupId}。`
                    : '回滚后原图层的父级或层序没有恢复到事务开始前。'
            };
        },
        buildVerifiedResult({ after }): GroupCreationResult {
            return buildVerifiedGroupResult(after);
        }
    });
}

export class CreateGroupTool implements Tool {
    name = 'createGroup';
    schema = {
        name: 'createGroup',
        description: '创建图层组。支持创建空组、将当前选中图层编组，或使用显式 layerIds 编组；成功前会读回新组和真实子图层。',
        parameters: {
            type: 'object' as const,
            properties: {
                groupName: {
                    type: 'string',
                    description: '图层组名称。'
                },
                fromSelected: {
                    type: 'boolean',
                    description: '是否将当前选中图层编组。默认 false，表示创建空组。'
                },
                layerIds: {
                    type: 'array',
                    description: '要编组的图层 ID 列表。提供后优先级高于 fromSelected。',
                    items: { type: 'number' }
                }
            },
            required: ['groupName']
        }
    };

    async execute(
        params: GroupCreationParams,
        context?: ToolExecutionContext
    ): Promise<GroupCreationResult> {
        return await executeVerifiedGroupCreation(this.name, params, context);
    }
}
