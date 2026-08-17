/**
 * 图层排序工具
 * 
 * 控制图层的上下层级关系
 */

import { Tool, ToolExecutionContext, ToolSchema } from '../types';
import {
    photoshopTransactionRunner,
    type PhotoshopTransactionPreparation
} from '../../core/photoshop-transaction-runner';
import { createToolFailureResult } from '../../core/tool-error-normalizer';
import {
    executeVerifiedGroupCreation,
    type GroupCreationResult
} from './create-group';
import { getPhotoshopElementPlacement } from './photoshop-runtime-adapters';

const app = require('photoshop').app;
const { core, action, constants } = require('photoshop');

function findLayerById(container: any, id: number): any {
    for (const layer of container.layers || []) {
        if (layer.id === id) return layer;
        if (layer.layers) {
            const found = findLayerById(layer, id);
            if (found) return found;
        }
    }
    return null;
}

function findLayerLocation(container: any, id: number): { layer: any; parent: any; index: number } | null {
    const layers = container.layers || [];
    for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        if (layer.id === id) {
            return { layer, parent: container, index: i };
        }
        if (layer.layers) {
            const found = findLayerLocation(layer, id);
            if (found) return found;
        }
    }
    return null;
}

async function selectLayerById(layerId: number): Promise<void> {
    await action.batchPlay([
        {
            _obj: 'select',
            _target: [{ _ref: 'layer', _id: layerId }],
            makeVisible: false,
            _options: { dialogOptions: 'dontDisplay' }
        }
    ], { synchronousExecution: true });
}

function getElementPlacement(name: 'PLACEBEFORE' | 'PLACEAFTER'): unknown {
    return getPhotoshopElementPlacement(constants, name, 'ReorderLayer');
}

function moveLayerToFront(layer: any): void {
    if (typeof layer.bringToFront === 'function') {
        layer.bringToFront();
        return;
    }
    throw new Error('当前 Photoshop UXP 环境不支持 layer.bringToFront');
}

function moveLayerToBack(layer: any): void {
    if (typeof layer.sendToBack === 'function') {
        layer.sendToBack();
        return;
    }
    throw new Error('当前 Photoshop UXP 环境不支持 layer.sendToBack');
}

function moveLayerRelative(layer: any, relativeLayer: any, placementName: 'PLACEBEFORE' | 'PLACEAFTER'): void {
    if (typeof layer.move !== 'function') {
        throw new Error('当前 Photoshop UXP 环境不支持 layer.move');
    }
    layer.move(relativeLayer, getElementPlacement(placementName));
}

function moveLayerToSiblingIndex(doc: any, targetLayer: any, desiredIndex: number): void {
    const currentLocation = findLayerLocation(doc, targetLayer.id);
    if (!currentLocation) {
        throw new Error('无法读取图层当前位置');
    }

    const movableSiblings = (currentLocation.parent.layers || []).filter((layer: any) => !layer.isBackgroundLayer);
    const currentIndex = movableSiblings.findIndex((layer: any) => layer.id === targetLayer.id);
    if (currentIndex < 0) {
        throw new Error('无法在同级图层中定位目标图层');
    }

    const clampedIndex = Math.max(0, Math.min(movableSiblings.length - 1, desiredIndex));
    if (clampedIndex === currentIndex) return;

    const withoutTarget = movableSiblings.filter((layer: any) => layer.id !== targetLayer.id);
    if (clampedIndex === 0) {
        moveLayerToFront(targetLayer);
        return;
    }
    if (clampedIndex >= withoutTarget.length) {
        moveLayerToBack(targetLayer);
        return;
    }

    moveLayerRelative(targetLayer, withoutTarget[clampedIndex], 'PLACEBEFORE');
}

type ReorderAction = 'up' | 'down' | 'top' | 'bottom' | 'above' | 'below';

interface ReorderLayerParams {
    layerId?: number;
    action: ReorderAction;
    targetLayerId?: number;
    steps?: number;
}

interface ReorderLayerState {
    documentId: number;
    layerId: number;
    layerName: string;
    parentId: number | null;
    siblingIds: number[];
    movableSiblingIds: number[];
    index: number;
    movableIndex: number;
}

interface ReorderLayerBefore extends ReorderLayerState {
    action: ReorderAction;
    steps: number;
    expectedMovableIndex?: number;
    targetLayerId?: number;
    targetLayerName?: string;
}

interface ReorderLayerReadback {
    layer: ReorderLayerState;
    target?: ReorderLayerState;
}

interface ReorderLayerResult extends Record<string, unknown> {
    success: boolean;
    code?: string;
    layer?: {
        id: number;
        name: string;
        newPosition: string;
    };
    error?: string;
    errorDetails?: unknown;
    data?: null;
}

function readSafePositiveInteger(value: unknown): number | undefined {
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) return undefined;
    return numeric;
}

function isReorderAction(value: unknown): value is ReorderAction {
    return ['up', 'down', 'top', 'bottom', 'above', 'below'].includes(String(value));
}

function readReorderLayerState(document: any, layerId: number): ReorderLayerState {
    const location = findLayerLocation(document, layerId);
    if (!location) {
        throw new Error(`写后读回未找到图层 ID ${layerId}。`);
    }
    const parentId = location.parent === document
        ? null
        : readSafePositiveInteger(location.parent?.id) ?? null;
    const siblings = Array.from(location.parent?.layers || []) as any[];
    const siblingIds = siblings
        .map(layer => readSafePositiveInteger(layer?.id))
        .filter((id): id is number => id !== undefined);
    const movableSiblingIds = siblings
        .filter(layer => !layer?.isBackgroundLayer)
        .map(layer => readSafePositiveInteger(layer?.id))
        .filter((id): id is number => id !== undefined);
    const index = siblingIds.indexOf(layerId);
    const movableIndex = movableSiblingIds.indexOf(layerId);
    if (index < 0 || movableIndex < 0) {
        throw new Error(`无法在父级层序中定位图层 ID ${layerId}。`);
    }
    return {
        documentId: Number(document.id),
        layerId,
        layerName: String(location.layer?.name || ''),
        parentId,
        siblingIds,
        movableSiblingIds,
        index,
        movableIndex
    };
}

function sameReorderTarget(left: ReorderLayerState, right: ReorderLayerState): boolean {
    return left.documentId === right.documentId
        && left.layerId === right.layerId
        && left.layerName === right.layerName;
}

function sameNumberArray(left: readonly number[], right: readonly number[]): boolean {
    return left.length === right.length
        && left.every((value, index) => value === right[index]);
}

function buildReorderFailure(
    params: ReorderLayerParams,
    code: string,
    error: string
): ReorderLayerResult {
    const failure = createToolFailureResult({ toolName: 'reorderLayer', error, params });
    return {
        ...failure,
        success: false,
        code,
        error
    };
}

function describeReorderPosition(before: ReorderLayerBefore): string {
    if (before.action === 'up') return `已上移 ${before.steps} 层`;
    if (before.action === 'down') return `已下移 ${before.steps} 层`;
    if (before.action === 'top') return '已置顶';
    if (before.action === 'bottom') return '已置底';
    const targetName = before.targetLayerName || String(before.targetLayerId || '目标图层');
    return before.action === 'above'
        ? `已移到“${targetName}”上方`
        : `已移到“${targetName}”下方`;
}

function isRequestedReorderApplied(
    before: ReorderLayerBefore,
    after: ReorderLayerReadback
): boolean {
    if (!sameReorderTarget(before, after.layer)) return false;
    if (before.action === 'up'
        || before.action === 'down'
        || before.action === 'top'
        || before.action === 'bottom') {
        return after.layer.parentId === before.parentId
            && after.layer.movableIndex === before.expectedMovableIndex;
    }
    if (!after.target) return false;
    if (after.layer.parentId !== after.target.parentId) return false;
    if (before.action === 'above') {
        return after.layer.index + 1 === after.target.index;
    }
    return after.layer.index === after.target.index + 1;
}

function isReorderAlreadySatisfied(before: ReorderLayerBefore): boolean {
    if (before.action === 'up'
        || before.action === 'down'
        || before.action === 'top'
        || before.action === 'bottom') {
        return before.movableIndex === before.expectedMovableIndex;
    }
    if (!before.targetLayerId) return false;
    const targetIndex = before.siblingIds.indexOf(before.targetLayerId);
    if (targetIndex < 0) return false;
    if (before.action === 'above') return before.index + 1 === targetIndex;
    return before.index === targetIndex + 1;
}

export class ReorderLayerTool implements Tool {
    name = 'reorderLayer';

    schema: ToolSchema = {
        name: 'reorderLayer',
        description: '调整图层的堆叠顺序。可以将图层上移、下移、置顶、置底，或移动到指定图层的上方/下方；成功前会读回真实层序。',
        parameters: {
            type: 'object',
            properties: {
                layerId: {
                    type: 'number',
                    description: '要移动的图层 ID（可选，默认使用当前选中的图层）'
                },
                action: {
                    type: 'string',
                    enum: ['up', 'down', 'top', 'bottom', 'above', 'below'],
                    description: '移动方式: up(上移), down(下移), top(置顶), bottom(置底), above(移到指定图层上方), below(移到指定图层下方)'
                },
                targetLayerId: {
                    type: 'number',
                    description: '参考图层 ID（仅当 action 为 above 或 below 时需要）'
                },
                steps: {
                    type: 'number',
                    description: '移动层数（仅当 action 为 up 或 down 时有效），必须是正整数，默认 1'
                }
            },
            required: ['action']
        }
    };

    async execute(
        params: ReorderLayerParams,
        context?: ToolExecutionContext
    ): Promise<ReorderLayerResult> {
        const safeParams = params || {} as ReorderLayerParams;
        const operationId = `reorderLayer:${String(
            context?.requestId || `${Number(safeParams.layerId) || 'active'}:${Date.now()}`
        )}`;

        return await photoshopTransactionRunner.run<
            ReorderLayerBefore,
            ReorderLayerReadback,
            ReorderLayerResult
        >({
            operationId,
            toolName: this.name,
            commandName: 'DesignEcho: 调整图层顺序',
            params: safeParams,
            context,
            historyMode: 'suspend',
            expectedEffect: 'mutation_required',
            rollbackTargetPolicy: 'document_revision',
            prepare(scope): PhotoshopTransactionPreparation<ReorderLayerBefore, ReorderLayerResult> {
                if (!isReorderAction(safeParams.action)) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildReorderFailure(
                            safeParams,
                            'reorder_layer_action_invalid',
                            '调整图层层序失败：action 必须是 up、down、top、bottom、above 或 below。请修正参数后重试。'
                        )
                    };
                }

                const hasExplicitLayerId = Object.prototype.hasOwnProperty.call(
                    safeParams,
                    'layerId'
                );
                const explicitLayerId = readSafePositiveInteger(safeParams.layerId);
                if (hasExplicitLayerId && explicitLayerId === undefined) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildReorderFailure(
                            safeParams,
                            'reorder_layer_target_invalid',
                            '调整图层层序失败：layerId 必须是正安全整数。请重新读取图层结构后重试。'
                        )
                    };
                }
                const layerId = hasExplicitLayerId
                    ? explicitLayerId
                    : readSafePositiveInteger(scope.document.activeLayers?.[0]?.id);
                if (layerId === undefined) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildReorderFailure(
                            safeParams,
                            'reorder_layer_target_required',
                            '调整图层层序失败：没有选中的图层。请先选择目标图层或提供 layerId。'
                        )
                    };
                }

                const targetLayer = findLayerById(scope.document, layerId);
                if (!targetLayer) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildReorderFailure(
                            safeParams,
                            'reorder_layer_target_not_found',
                            `调整图层层序失败：未找到图层 ID ${layerId}。请重新读取图层结构后重试。`
                        )
                    };
                }
                if (targetLayer.isBackgroundLayer) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildReorderFailure(
                            safeParams,
                            'reorder_layer_background_not_movable',
                            '调整图层层序失败：背景图层不能移动。请先将背景转换为普通图层后重试。'
                        )
                    };
                }

                const usesSteps = safeParams.action === 'up' || safeParams.action === 'down';
                const steps = usesSteps && safeParams.steps !== undefined
                    ? readSafePositiveInteger(safeParams.steps)
                    : 1;
                if (steps === undefined) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildReorderFailure(
                            safeParams,
                            'reorder_layer_steps_invalid',
                            '调整图层层序失败：steps 必须是正整数。请修正移动层数后重试。'
                        )
                    };
                }

                const state = readReorderLayerState(scope.document, layerId);
                const before: ReorderLayerBefore = {
                    ...state,
                    action: safeParams.action,
                    steps
                };
                if (safeParams.action === 'up') {
                    before.expectedMovableIndex = Math.max(0, state.movableIndex - steps);
                } else if (safeParams.action === 'down') {
                    before.expectedMovableIndex = Math.min(
                        state.movableSiblingIds.length - 1,
                        state.movableIndex + steps
                    );
                } else if (safeParams.action === 'top') {
                    before.expectedMovableIndex = 0;
                } else if (safeParams.action === 'bottom') {
                    before.expectedMovableIndex = state.movableSiblingIds.length - 1;
                } else {
                    const targetLayerId = readSafePositiveInteger(safeParams.targetLayerId);
                    if (targetLayerId === undefined || targetLayerId === layerId) {
                        return {
                            kind: 'complete',
                            effect: 'none',
                            result: buildReorderFailure(
                                safeParams,
                                'reorder_layer_reference_invalid',
                                '调整图层层序失败：above/below 必须提供另一个有效的 targetLayerId。请重新读取图层结构后重试。'
                            )
                        };
                    }
                    const referenceLayer = findLayerById(scope.document, targetLayerId);
                    if (!referenceLayer) {
                        return {
                            kind: 'complete',
                            effect: 'none',
                            result: buildReorderFailure(
                                safeParams,
                                'reorder_layer_reference_not_found',
                                `调整图层层序失败：未找到参考图层 ID ${targetLayerId}。请重新读取图层结构后重试。`
                            )
                        };
                    }
                    before.targetLayerId = targetLayerId;
                    before.targetLayerName = String(referenceLayer.name || targetLayerId);
                }

                if (isReorderAlreadySatisfied(before)) {
                    return {
                        kind: 'complete',
                        effect: 'already_satisfied',
                        result: {
                            success: true,
                            layer: {
                                id: before.layerId,
                                name: before.layerName,
                                newPosition: describeReorderPosition(before)
                            }
                        }
                    };
                }
                return { kind: 'ready', before };
            },
            async mutate(scope, before): Promise<ReorderLayerResult> {
                const targetLayer = findLayerById(scope.document, before.layerId);
                if (!targetLayer) {
                    return buildReorderFailure(
                        safeParams,
                        'reorder_layer_target_changed',
                        `调整图层层序失败：写入前已找不到图层 ID ${before.layerId}。请重新读取图层结构后重试。`
                    );
                }

                if (before.action === 'up' || before.action === 'down') {
                    moveLayerToSiblingIndex(
                        scope.document,
                        targetLayer,
                        Number(before.expectedMovableIndex)
                    );
                    await selectLayerById(before.layerId);
                } else if (before.action === 'top') {
                    moveLayerToFront(targetLayer);
                    await selectLayerById(before.layerId);
                } else if (before.action === 'bottom') {
                    moveLayerToBack(targetLayer);
                    await selectLayerById(before.layerId);
                } else {
                    const referenceLayer = findLayerById(
                        scope.document,
                        Number(before.targetLayerId)
                    );
                    if (!referenceLayer) {
                        return buildReorderFailure(
                            safeParams,
                            'reorder_layer_reference_changed',
                            `调整图层层序失败：写入前已找不到参考图层 ID ${before.targetLayerId}。请重新读取图层结构后重试。`
                        );
                    }
                    moveLayerRelative(
                        targetLayer,
                        referenceLayer,
                        before.action === 'above' ? 'PLACEBEFORE' : 'PLACEAFTER'
                    );
                    await selectLayerById(before.layerId);
                }

                return {
                    success: true,
                    layer: {
                        id: before.layerId,
                        name: before.layerName,
                        newPosition: describeReorderPosition(before)
                    }
                };
            },
            readState({ scope, before }): ReorderLayerReadback {
                const layer = readReorderLayerState(scope.document, before.layerId);
                const target = before.targetLayerId
                    ? readReorderLayerState(scope.document, before.targetLayerId)
                    : undefined;
                return { layer, target };
            },
            verifyApplied({ before, after }) {
                return {
                    verified: isRequestedReorderApplied(before, after),
                    message: `调整图层层序写后读回不一致：图层 ${before.layerId} 当前父级=${String(after.layer.parentId)}, 层序=${after.layer.index}；请求动作=${before.action}${before.targetLayerId ? `, 参考图层=${before.targetLayerId}` : ''}。`
                };
            },
            verifyRolledBack({ before, after }) {
                return {
                    verified: sameReorderTarget(before, after.layer)
                        && after.layer.parentId === before.parentId
                        && sameNumberArray(after.layer.siblingIds, before.siblingIds),
                    message: `调整图层层序回滚后读回不一致：原层序 [${before.siblingIds.join(', ')}]，当前层序 [${after.layer.siblingIds.join(', ')}]。`
                };
            },
            buildVerifiedResult({ before, after }): ReorderLayerResult {
                return {
                    success: true,
                    layer: {
                        id: after.layer.layerId,
                        name: after.layer.layerName,
                        newPosition: describeReorderPosition(before)
                    }
                };
            }
        });
    }
}

/**
 * 图层编组工具
 */
export class GroupLayersTool implements Tool {
    name = 'groupLayers';

    schema: ToolSchema = {
        name: 'groupLayers',
        description: '将选中的图层编组（创建图层组）。',
        parameters: {
            type: 'object',
            properties: {
                layerIds: {
                    type: 'array',
                    description: '要编组的图层 ID 列表（可选，默认使用当前选中的所有图层）',
                    items: { type: 'number' }
                },
                groupName: {
                    type: 'string',
                    description: '新建组的名称，默认为 "组 1"'
                }
            }
        }
    };

    async execute(params: {
        layerIds?: number[];
        groupName?: string;
    }, context?: ToolExecutionContext): Promise<GroupCreationResult> {
        const requestedName = String(params?.groupName || '').trim();
        const layerIds = params?.layerIds;
        const useCurrentSelection = layerIds === undefined
            || (Array.isArray(layerIds) && layerIds.length === 0);
        return await executeVerifiedGroupCreation(this.name, {
            groupName: requestedName || '组 1',
            ...(useCurrentSelection ? { fromSelected: true } : { layerIds })
        }, context);
    }
}

/**
 * 取消编组工具
 */
export class UngroupLayersTool implements Tool {
    name = 'ungroupLayers';

    schema: ToolSchema = {
        name: 'ungroupLayers',
        description: '取消图层组，将组内的图层释放出来。',
        parameters: {
            type: 'object',
            properties: {
                groupId: {
                    type: 'number',
                    description: '要取消编组的图层组 ID（可选，默认使用当前选中的组）'
                }
            }
        }
    };

    async execute(params: {
        groupId?: number;
    }): Promise<{
        success: boolean;
        ungroupedLayers?: Array<{
            id: number;
            name: string;
        }>;
        error?: string;
    }> {
        try {
            const doc = app.activeDocument;
            if (!doc) {
                return { success: false, error: '没有打开的文档' };
            }

            let targetGroup: any;

            if (params.groupId) {
                targetGroup = findLayerById(doc, params.groupId);
                if (!targetGroup) {
                    return { success: false, error: `未找到 ID 为 ${params.groupId} 的图层组` };
                }
            } else {
                if (doc.activeLayers.length === 0) {
                    return { success: false, error: '没有选中的图层' };
                }
                targetGroup = doc.activeLayers[0];
            }

            // 检查是否是图层组
            const kind = targetGroup.kind?.toString() || '';
            if (!kind.includes('group') && !targetGroup.layers) {
                return { success: false, error: `图层 "${targetGroup.name}" 不是图层组` };
            }

            // 取消编组
            await core.executeAsModal(async () => {
                await action.batchPlay([
                    {
                        _obj: 'select',
                        _target: [{ _ref: 'layer', _id: targetGroup.id }],
                        makeVisible: false,
                        _options: { dialogOptions: 'dontDisplay' }
                    },
                    {
                        _obj: 'ungroupLayersEvent',
                        _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
                        _options: { dialogOptions: 'dontDisplay' }
                    }
                ], { synchronousExecution: true });
            }, { commandName: 'DesignEcho: 取消编组' });

            // 获取释放出来的图层
            const ungroupedLayers = doc.activeLayers.map((l: any) => ({
                id: l.id,
                name: l.name
            }));

            console.log(`[UngroupLayers] 已取消编组，释放 ${ungroupedLayers.length} 个图层`);

            return {
                success: true,
                ungroupedLayers
            };

        } catch (error) {
            console.error('[UngroupLayers] Error:', error);
            return createToolFailureResult({ toolName: this.name, error, params });
        }
    }

}
