/**
 * 严格图层编组工具。
 *
 * 语义分区由 Agent/模型负责；本工具只声明结构约束、原子写入和精确读回。
 * modal、History、取消、提交、回滚与结果分类由 PhotoshopTransactionRunner
 * 唯一拥有，避免 Tool 内再维护一套事务状态机。
 */

import { constants } from 'photoshop';
import {
    buildPhotoshopTransactionMutationOutcome,
    photoshopTransactionRunner,
    type PhotoshopTransactionPreparation
} from '../../core/photoshop-transaction-runner';
import type { Tool, ToolExecutionContext, ToolSchema } from '../types';

const GROUP_LAYERS_SAFELY_RECEIPT_VERSION =
    'group-layers-safely-receipt/v0' as const;
const GROUP_LAYERS_MUTATION_RECEIPT_VERSION =
    'group-layers-safely-mutation-receipt/v1' as const;

interface LayerLocation {
    layer: any;
    parent: any;
    parentId: number | null;
    siblings: any[];
    index: number;
}

interface GroupSafetyIssue {
    code: string;
    message: string;
    layerIds?: number[];
}

interface StrictGroupInspection {
    selectedLayerIds: number[];
    selectedIndices: number[];
    parentId: number | null;
    siblingOrderBefore: number[];
    selectedClippingStates: Array<{
        layerId: number;
        isClipped: boolean;
    }>;
    issues: GroupSafetyIssue[];
}

interface LayerIdsParseResult {
    valid: boolean;
    layerIds: number[];
    error?: string;
}

interface GroupTransactionBefore {
    groupName: string;
    inspection: StrictGroupInspection;
}

interface GroupMutationReceipt {
    version: typeof GROUP_LAYERS_MUTATION_RECEIPT_VERSION;
    groupName: string;
    selectedLayerIds: number[];
    createdGroupId?: number;
}

interface GroupTransactionReadback {
    parentAvailable: boolean;
    siblingOrder: number[];
    clippingStates: Array<{
        layerId: number;
        isClipped: boolean;
    }>;
    groupId?: number;
    groupPresent: boolean;
    groupParentId?: number | null;
    groupName?: string;
    groupOpacity?: number;
    groupPassThrough?: boolean;
    childLayerIds: number[];
}

interface GroupLayersSafelyResult {
    success: boolean;
    entityType?: 'group';
    documentId?: number;
    layerId?: number;
    groupId?: number;
    name?: string;
    groupedLayerCount?: number;
    group?: {
        id: number;
        name: string;
        layerCount: number;
    };
    structureReceipt?: {
        version: typeof GROUP_LAYERS_SAFELY_RECEIPT_VERSION;
        safetyMode: 'same-parent-contiguous-clipping-closed';
        parentGroupId: number | null;
        childLayerIds: number[];
        siblingOrderBefore: number[];
        siblingOrderAfter: number[];
        clippingStatesPreserved: true;
        unselectedSiblingOrderPreserved: true;
        groupBlendMode: 'passThrough';
        groupOpacity: 100;
        visualReadbackRequired: true;
    };
    issues?: GroupSafetyIssue[];
    code?: string;
    error?: string;
    message?: string;
    data?: null;
}

function isPositiveInteger(value: unknown): value is number {
    return typeof value === 'number'
        && Number.isSafeInteger(value)
        && value > 0;
}

function parseExplicitLayerIds(value: unknown): LayerIdsParseResult {
    if (!Array.isArray(value) || value.length === 0) {
        return {
            valid: false,
            layerIds: [],
            error: 'layerIds 必须是至少包含一个 Photoshop 图层 ID 的数组。'
        };
    }
    if (!value.every(isPositiveInteger)) {
        return {
            valid: false,
            layerIds: [],
            error: 'layerIds 只能包含正的安全整数；检测到非法值后已拒绝整个编组请求。'
        };
    }
    return {
        valid: true,
        layerIds: [...value]
    };
}

function buildFailure(
    code: string,
    error: string,
    issues?: GroupSafetyIssue[]
): GroupLayersSafelyResult {
    return {
        success: false,
        code,
        error,
        ...(issues ? { issues } : {}),
        data: null
    };
}

function getLayerId(layer: any): number {
    return Number(layer?.id || 0);
}

function getLayerName(layer: any): string {
    return String(layer?.name || '').trim();
}

function getLayerKind(layer: any): string {
    return String(layer?.kind?.value ?? layer?.kind ?? '').toLowerCase();
}

function isGroupLayer(layer: any): boolean {
    return getLayerKind(layer).includes('group') || Array.isArray(layer?.layers);
}

function isClippedLayer(layer: any): boolean {
    return layer?.isClippingMask === true || layer?.clipped === true;
}

function isLockedLayer(layer: any): boolean {
    return layer?.locked === true
        || layer?.allLocked === true
        || layer?.positionLocked === true;
}

function isBackgroundLayer(layer: any): boolean {
    return layer?.isBackgroundLayer === true
        || getLayerKind(layer).includes('background');
}

function readSiblingLayers(container: any): any[] {
    return Array.from(container?.layers || []);
}

function findLayerLocation(
    container: any,
    layerId: number,
    parent: any = null
): LayerLocation | null {
    const siblings = readSiblingLayers(container);
    for (let index = 0; index < siblings.length; index += 1) {
        const layer = siblings[index];
        if (getLayerId(layer) === layerId) {
            return {
                layer,
                parent,
                parentId: parent && isPositiveInteger(parent.id)
                    ? Number(parent.id)
                    : null,
                siblings,
                index
            };
        }
        if (isGroupLayer(layer)) {
            const nested = findLayerLocation(layer, layerId, layer);
            if (nested) return nested;
        }
    }
    return null;
}

function buildClippingChains(siblings: any[]): number[][] {
    const chains: number[][] = [];
    for (let baseIndex = 0; baseIndex < siblings.length; baseIndex += 1) {
        if (isClippedLayer(siblings[baseIndex])) continue;
        const chain: number[] = [getLayerId(siblings[baseIndex])];
        for (let index = baseIndex - 1; index >= 0; index -= 1) {
            if (!isClippedLayer(siblings[index])) break;
            chain.unshift(getLayerId(siblings[index]));
        }
        if (chain.length > 1 && chain.every(isPositiveInteger)) {
            chains.push(chain);
        }
    }
    return chains;
}

function inspectStrictGroup(
    document: any,
    layerIds: number[]
): StrictGroupInspection {
    const issues: GroupSafetyIssue[] = [];
    const uniqueLayerIds = Array.from(new Set(layerIds));
    if (uniqueLayerIds.length !== layerIds.length) {
        issues.push({
            code: 'duplicate_layer_id',
            message: '图层集合包含重复 ID，已拒绝编组。',
            layerIds
        });
    }

    const locations = uniqueLayerIds
        .map((layerId) => findLayerLocation(document, layerId))
        .filter(Boolean) as LayerLocation[];
    const missingLayerIds = uniqueLayerIds.filter((layerId) => (
        !locations.some((location) => getLayerId(location.layer) === layerId)
    ));
    if (missingLayerIds.length > 0) {
        issues.push({
            code: 'layer_not_found',
            message: `以下图层已不存在：${missingLayerIds.join(', ')}。`,
            layerIds: missingLayerIds
        });
    }

    const parentIds = new Set(locations.map((location) => (
        location.parentId === null ? 'root' : String(location.parentId)
    )));
    if (parentIds.size > 1) {
        issues.push({
            code: 'different_parents',
            message: '严格编组只接受同一父级下的兄弟图层；跨父级移动可能改变蒙版、混合和调整层作用域。',
            layerIds: uniqueLayerIds
        });
    }

    const parent = locations[0]?.parent || document;
    const parentId = locations[0]?.parentId ?? null;
    const siblings = readSiblingLayers(parent);
    const selectedIndices = locations
        .map((location) => location.index)
        .sort((left, right) => left - right);
    if (selectedIndices.length > 0) {
        const expectedSpan = selectedIndices[selectedIndices.length - 1]
            - selectedIndices[0]
            + 1;
        if (expectedSpan !== selectedIndices.length) {
            issues.push({
                code: 'non_contiguous_siblings',
                message: '严格编组只接受连续兄弟图层；非连续归组会改变未选图层的相对层级。',
                layerIds: uniqueLayerIds
            });
        }
    }

    for (const location of locations) {
        if (isBackgroundLayer(location.layer)) {
            issues.push({
                code: 'background_layer',
                message: `背景图层「${getLayerName(location.layer)}」不能自动编组。`,
                layerIds: [getLayerId(location.layer)]
            });
        }
        if (isLockedLayer(location.layer)) {
            issues.push({
                code: 'locked_layer',
                message: `图层「${getLayerName(location.layer)}」已锁定，不能自动编组。`,
                layerIds: [getLayerId(location.layer)]
            });
        }
    }
    if (parent !== document && isLockedLayer(parent)) {
        issues.push({
            code: 'locked_parent',
            message: `父级图层组「${getLayerName(parent)}」已锁定，不能在其中自动编组。`,
            layerIds: isPositiveInteger(parent?.id)
                ? [Number(parent.id)]
                : undefined
        });
    }

    const selectedIdSet = new Set(uniqueLayerIds);
    for (const chain of buildClippingChains(siblings)) {
        const selectedCount = chain.filter((layerId) => (
            selectedIdSet.has(layerId)
        )).length;
        if (selectedCount > 0 && selectedCount !== chain.length) {
            issues.push({
                code: 'partial_clipping_chain',
                message: '目标集合只包含剪贴蒙版链的一部分；必须把被剪切层与基底作为完整连续链一起编组。',
                layerIds: chain
            });
        }
    }

    return {
        selectedLayerIds: locations
            .sort((left, right) => left.index - right.index)
            .map((location) => getLayerId(location.layer)),
        selectedIndices,
        parentId,
        siblingOrderBefore: siblings.map(getLayerId).filter(isPositiveInteger),
        selectedClippingStates: locations
            .sort((left, right) => left.index - right.index)
            .map((location) => ({
                layerId: getLayerId(location.layer),
                isClipped: isClippedLayer(location.layer)
            })),
        issues
    };
}

function sameNumberArray(left: number[], right: number[]): boolean {
    return left.length === right.length
        && left.every((value, index) => value === right[index]);
}

function sameClippingStates(
    left: Array<{ layerId: number; isClipped: boolean }>,
    right: Array<{ layerId: number; isClipped: boolean }>
): boolean {
    return left.length === right.length
        && left.every((value, index) => (
            value.layerId === right[index]?.layerId
            && value.isClipped === right[index]?.isClipped
        ));
}

function buildExpectedSiblingOrder(
    before: number[],
    selectedIndices: number[],
    groupId: number
): number[] {
    if (selectedIndices.length === 0) return before;
    const selectedSet = new Set(selectedIndices);
    const result: number[] = [];
    for (let index = 0; index < before.length; index += 1) {
        if (index === selectedIndices[0]) result.push(groupId);
        if (!selectedSet.has(index)) result.push(before[index]);
    }
    return result;
}

function readClippingStatesByLayerIds(
    document: any,
    layerIds: number[]
): Array<{ layerId: number; isClipped: boolean }> {
    const states: Array<{ layerId: number; isClipped: boolean }> = [];
    for (const layerId of layerIds) {
        const location = findLayerLocation(document, layerId);
        if (!location) return [];
        states.push({
            layerId,
            isClipped: isClippedLayer(location.layer)
        });
    }
    return states;
}

function isPassThroughBlendMode(value: unknown): boolean {
    return String((value as any)?.value ?? value ?? '')
        .replace(/[^a-z]/gi, '')
        .toLowerCase()
        .includes('passthrough');
}

function resolvePassThroughBlendMode(): any {
    const blendModes = (constants as any)?.BlendMode || {};
    return blendModes.PASSTHROUGH
        ?? blendModes.PASS_THROUGH
        ?? 'passThrough';
}

function resolveLiveParent(
    document: any,
    parentId: number | null
): any | undefined {
    if (parentId === null) return document;
    return findLayerLocation(document, parentId)?.layer;
}

function readGroupTransactionState(
    document: any,
    before: GroupTransactionBefore,
    receipt?: GroupMutationReceipt
): GroupTransactionReadback {
    const parent = resolveLiveParent(document, before.inspection.parentId);
    const groupId = receipt?.createdGroupId;
    const groupLocation = groupId
        ? findLayerLocation(document, groupId)
        : null;
    const liveGroup = groupLocation?.layer;
    return {
        parentAvailable: Boolean(parent),
        siblingOrder: parent
            ? readSiblingLayers(parent).map(getLayerId).filter(isPositiveInteger)
            : [],
        clippingStates: readClippingStatesByLayerIds(
            document,
            before.inspection.selectedLayerIds
        ),
        ...(groupId ? { groupId } : {}),
        groupPresent: Boolean(liveGroup),
        ...(groupLocation
            ? { groupParentId: groupLocation.parentId }
            : {}),
        ...(liveGroup
            ? {
                groupName: getLayerName(liveGroup),
                groupOpacity: Number(liveGroup.opacity),
                groupPassThrough: isPassThroughBlendMode(liveGroup.blendMode),
                childLayerIds: readSiblingLayers(liveGroup)
                    .map(getLayerId)
                    .filter(isPositiveInteger)
            }
            : { childLayerIds: [] })
    };
}

function readAppliedIssues(
    before: GroupTransactionBefore,
    after: GroupTransactionReadback,
    result: GroupLayersSafelyResult,
    receipt?: GroupMutationReceipt
): string[] {
    const issues: string[] = [];
    const groupId = Number(result.groupId || receipt?.createdGroupId || 0);
    if (!isPositiveInteger(groupId)
        || receipt?.createdGroupId !== groupId
        || after.groupId !== groupId) {
        issues.push('Photoshop 没有返回一致、可验证的新图层组 ID。');
    }
    if (!after.parentAvailable) {
        issues.push('写后无法重新定位原父级。');
    }
    if (!after.groupPresent
        || after.groupParentId !== before.inspection.parentId) {
        issues.push('新图层组不存在，或父级与计划不一致。');
    }
    if (after.groupName !== before.groupName) {
        issues.push('新图层组名称与计划不一致。');
    }
    if (!sameNumberArray(
        after.childLayerIds,
        before.inspection.selectedLayerIds
    )) {
        issues.push('新图层组的子层集合或面板顺序与计划不一致。');
    }
    if (isPositiveInteger(groupId)) {
        const expectedSiblingOrder = buildExpectedSiblingOrder(
            before.inspection.siblingOrderBefore,
            before.inspection.selectedIndices,
            groupId
        );
        if (!sameNumberArray(after.siblingOrder, expectedSiblingOrder)) {
            issues.push('编组改变了未选兄弟图层的相对顺序。');
        }
    }
    if (after.groupOpacity !== 100 || after.groupPassThrough !== true) {
        issues.push('新图层组未保持 100% 不透明度和 Pass Through 混合模式。');
    }
    if (!sameClippingStates(
        after.clippingStates,
        before.inspection.selectedClippingStates
    )) {
        issues.push('编组后的剪贴蒙版状态与编组前不一致。');
    }
    return issues;
}

function readRollbackIssues(
    before: GroupTransactionBefore,
    after: GroupTransactionReadback,
    receipt?: GroupMutationReceipt
): string[] {
    const issues: string[] = [];
    if (!after.parentAvailable) {
        issues.push('回滚后无法重新定位原父级。');
    }
    if (!sameNumberArray(
        after.siblingOrder,
        before.inspection.siblingOrderBefore
    )) {
        issues.push('回滚后兄弟图层顺序没有恢复。');
    }
    if (!sameClippingStates(
        after.clippingStates,
        before.inspection.selectedClippingStates
    )) {
        issues.push('回滚后剪贴蒙版状态没有恢复。');
    }
    if (receipt?.createdGroupId && after.groupPresent) {
        issues.push('回滚后本次创建的图层组仍然存在。');
    }
    return issues;
}

function readFailureMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    const message = String(error || '').trim();
    return message || '安全编组失败。';
}

export class GroupLayersSafelyTool implements Tool {
    name = 'groupLayersSafely';

    schema: ToolSchema = {
        name: 'groupLayersSafely',
        description: '把显式 layerIds 作为一个严格、可回滚的结构事务编成语义图层组。调用必须绑定当前文档历史版本（document_revision guard）。只接受同一父级的连续兄弟层，并要求剪贴蒙版链完整；语义成员由 Agent 看图和读层树后决定。写后核对新组父级、子层顺序、Pass Through、未选兄弟层顺序和剪贴状态。复杂或不确定集合会安全拒绝，不会逐层盲移。',
        parameters: {
            type: 'object',
            properties: {
                groupName: {
                    type: 'string',
                    description: '新图层组的语义名称，例如「01 首屏」或「卖点模块」。'
                },
                layerIds: {
                    type: 'array',
                    description: '要编组的明确图层 ID，必须来自当前历史版本的标注画面或完整层级读取。',
                    items: { type: 'number' }
                }
            },
            required: ['groupName', 'layerIds']
        }
    };

    async execute(
        params: { groupName?: unknown; layerIds?: unknown } = {},
        context?: ToolExecutionContext
    ): Promise<any> {
        const groupName = String(params.groupName || '').trim();
        const parsedLayerIds = parseExplicitLayerIds(params.layerIds);
        const operationId = `${this.name}:${String(
            context?.requestId || Date.now()
        )}`;

        return await photoshopTransactionRunner.run<
            GroupTransactionBefore,
            GroupTransactionReadback,
            GroupLayersSafelyResult,
            GroupMutationReceipt
        >({
            operationId,
            toolName: this.name,
            commandName: 'DesignEcho: 安全编组图层',
            params,
            context,
            historyMode: 'suspend',
            expectedEffect: 'mutation_required',
            requiredBinding: 'document_revision',
            rollbackTargetPolicy: 'document_revision',
            prepare(scope): PhotoshopTransactionPreparation<
                GroupTransactionBefore,
                GroupLayersSafelyResult
            > {
                if (!groupName) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildFailure(
                            'invalid_group_name',
                            'groupName 不能为空，已在写入前拒绝编组。'
                        )
                    };
                }
                if (!parsedLayerIds.valid) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildFailure(
                            'invalid_layer_ids',
                            parsedLayerIds.error
                                || 'layerIds 无效，已在写入前拒绝编组。'
                        )
                    };
                }

                const inspection = inspectStrictGroup(
                    scope.document,
                    parsedLayerIds.layerIds
                );
                if (inspection.issues.length > 0) {
                    return {
                        kind: 'complete',
                        effect: 'none',
                        result: buildFailure(
                            'unsafe_layer_grouping_plan',
                            inspection.issues
                                .map((issue) => issue.message)
                                .join('\n'),
                            inspection.issues
                        )
                    };
                }
                return {
                    kind: 'ready',
                    before: {
                        groupName,
                        inspection
                    }
                };
            },
            async mutate(scope, before) {
                let createdGroupId: number | undefined;
                const receiptBase = {
                    version: GROUP_LAYERS_MUTATION_RECEIPT_VERSION,
                    groupName: before.groupName,
                    selectedLayerIds: before.inspection.selectedLayerIds
                } as const;
                try {
                    const fromLayers = before.inspection.selectedLayerIds
                        .map((layerId) => (
                            findLayerLocation(scope.document, layerId)?.layer
                        ))
                        .filter(Boolean);
                    if (fromLayers.length
                        !== before.inspection.selectedLayerIds.length) {
                        return buildPhotoshopTransactionMutationOutcome(
                            buildFailure(
                                'layer_grouping_targets_changed',
                                '编组前图层集合发生变化，请重新读取当前图层结构。'
                            ),
                            receiptBase
                        );
                    }
                    if (typeof scope.document.createLayerGroup !== 'function') {
                        return buildPhotoshopTransactionMutationOutcome(
                            buildFailure(
                                'layer_grouping_host_unsupported',
                                '当前 Photoshop UXP 环境不支持事务化 createLayerGroup。'
                            ),
                            receiptBase
                        );
                    }

                    const group = await scope.document.createLayerGroup({
                        name: before.groupName,
                        opacity: 100,
                        blendMode: resolvePassThroughBlendMode(),
                        fromLayers
                    });
                    createdGroupId = isPositiveInteger(group?.id)
                        ? Number(group.id)
                        : undefined;
                    const receipt: GroupMutationReceipt = {
                        ...receiptBase,
                        ...(createdGroupId ? { createdGroupId } : {})
                    };
                    if (!createdGroupId) {
                        return buildPhotoshopTransactionMutationOutcome(
                            buildFailure(
                                'layer_grouping_group_id_missing',
                                'Photoshop 没有返回可验证的新图层组 ID。'
                            ),
                            receipt
                        );
                    }
                    return buildPhotoshopTransactionMutationOutcome(
                        {
                            success: true,
                            groupId: createdGroupId
                        },
                        receipt
                    );
                } catch (error) {
                    return buildPhotoshopTransactionMutationOutcome(
                        buildFailure(
                            'layer_grouping_mutation_failed',
                            readFailureMessage(error)
                        ),
                        {
                            ...receiptBase,
                            ...(createdGroupId ? { createdGroupId } : {})
                        }
                    );
                }
            },
            readState({ scope, before, receipt }) {
                return readGroupTransactionState(
                    scope.document,
                    before,
                    receipt
                );
            },
            verifyApplied({ before, after, result, receipt }) {
                const issues = readAppliedIssues(
                    before,
                    after,
                    result,
                    receipt
                );
                return {
                    verified: issues.length === 0,
                    message: issues.length > 0
                        ? issues.join('\n')
                        : '图层组父级、成员顺序、兄弟层顺序、混合模式与剪贴状态均已核对。'
                };
            },
            verifyRolledBack({ before, after, receipt }) {
                const issues = readRollbackIssues(before, after, receipt);
                return {
                    verified: issues.length === 0,
                    message: issues.length > 0
                        ? issues.join('\n')
                        : '原父级、完整兄弟层顺序、剪贴状态和本次新组均已恢复。'
                };
            },
            buildVerifiedResult({ scope, before, after }) {
                const groupId = after.groupId;
                if (!isPositiveInteger(groupId)
                    || !after.groupPresent
                    || !after.groupName) {
                    throw new Error('真实结构读回缺少已验证的新图层组。');
                }
                return {
                    success: true,
                    entityType: 'group',
                    documentId: Number(scope.document.id),
                    layerId: groupId,
                    groupId,
                    name: after.groupName,
                    groupedLayerCount: after.childLayerIds.length,
                    group: {
                        id: groupId,
                        name: after.groupName,
                        layerCount: after.childLayerIds.length
                    },
                    structureReceipt: {
                        version: GROUP_LAYERS_SAFELY_RECEIPT_VERSION,
                        safetyMode: 'same-parent-contiguous-clipping-closed',
                        parentGroupId: before.inspection.parentId,
                        childLayerIds: after.childLayerIds,
                        siblingOrderBefore:
                            before.inspection.siblingOrderBefore,
                        siblingOrderAfter: after.siblingOrder,
                        clippingStatesPreserved: true,
                        unselectedSiblingOrderPreserved: true,
                        groupBlendMode: 'passThrough',
                        groupOpacity: 100,
                        visualReadbackRequired: true
                    },
                    message: `已安全创建图层组「${after.groupName}」，包含 ${after.childLayerIds.length} 个连续兄弟图层；请继续读取画面确认视觉未变化。`
                };
            }
        });
    }
}
