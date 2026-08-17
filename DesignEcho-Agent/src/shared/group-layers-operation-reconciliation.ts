import type { PhotoshopHistoryStateRef } from './photoshop-history-state-ref';

export const GROUP_LAYERS_OPERATION_RECONCILIATION_VERSION =
    'group-layers-operation-reconciliation/v1' as const;

export type GroupLayersOperationReconciliationClassification =
    | 'applied'
    | 'not_applied'
    | 'ambiguous';

interface ParsedHierarchyNode {
    id: number;
    name: string;
    kind: string;
    parentId: number | null;
    opacity: number;
    blendMode: string;
    isClipped: boolean;
    children: ParsedHierarchyNode[];
}

export interface GroupLayersOperationReconciliationResult {
    version: typeof GROUP_LAYERS_OPERATION_RECONCILIATION_VERSION;
    classification: GroupLayersOperationReconciliationClassification;
    reasonCode: string;
    expectedHistoryStateRef?: PhotoshopHistoryStateRef;
    observedHistoryStateRef?: PhotoshopHistoryStateRef;
    group?: {
        id: number;
        name: string;
        parentGroupId: number | null;
        childLayerIds: number[];
        siblingOrderAfter: number[];
        groupOpacity: number;
        groupBlendMode: 'passThrough';
    };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return value as Record<string, unknown>;
}

function readPositiveInteger(value: unknown): number | undefined {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : undefined;
}

function readNonNegativeInteger(value: unknown): number | undefined {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : undefined;
}

function readHistoryStateRef(value: unknown): PhotoshopHistoryStateRef | undefined {
    const record = asRecord(value);
    const documentId = readPositiveInteger(record?.documentId);
    const historyStateId = readPositiveInteger(record?.historyStateId);
    if (!documentId || !historyStateId) return undefined;
    return { documentId, historyStateId };
}

function sameNumberArray(left: readonly number[], right: readonly number[]): boolean {
    return left.length === right.length
        && left.every((value, index) => value === right[index]);
}

function isPassThroughBlendMode(value: unknown): boolean {
    return String(value ?? '')
        .replace(/[^a-z]/gi, '')
        .toLowerCase()
        .includes('passthrough');
}

function ambiguous(
    reasonCode: string,
    expectedHistoryStateRef?: PhotoshopHistoryStateRef,
    observedHistoryStateRef?: PhotoshopHistoryStateRef
): GroupLayersOperationReconciliationResult {
    return {
        version: GROUP_LAYERS_OPERATION_RECONCILIATION_VERSION,
        classification: 'ambiguous',
        reasonCode,
        ...(expectedHistoryStateRef ? { expectedHistoryStateRef } : {}),
        ...(observedHistoryStateRef ? { observedHistoryStateRef } : {})
    };
}

function parseCompleteHierarchy(
    observation: unknown
): {
    roots: ParsedHierarchyNode[];
    nodes: ParsedHierarchyNode[];
    historyStateRef: PhotoshopHistoryStateRef;
} | undefined {
    const root = asRecord(observation);
    const payload = Array.isArray(root?.hierarchy)
        ? root
        : asRecord(root?.data);
    const hierarchy = payload?.hierarchy;
    const historyStateRef = readHistoryStateRef(
        root?.historyStateRef ?? payload?.historyStateRef
    );
    const totalLayers = readNonNegativeInteger(payload?.totalLayers);
    if (root?.success !== true
        || !historyStateRef
        || !Array.isArray(hierarchy)
        || totalLayers === undefined
        || payload?.rootLayerId !== undefined) {
        return undefined;
    }

    const nodes: ParsedHierarchyNode[] = [];
    const seenIds = new Set<number>();
    let valid = true;

    function visit(
        value: unknown,
        expectedParentId: number | null,
        expectedIndex: number
    ): ParsedHierarchyNode | undefined {
        const record = asRecord(value);
        const id = readPositiveInteger(record?.id);
        const rawParentId = record?.parentId;
        const parentId = rawParentId === null
            ? null
            : readPositiveInteger(rawParentId);
        const index = readNonNegativeInteger(record?.index);
        const rawChildren = record?.children;
        if (!record
            || !id
            || seenIds.has(id)
            || parentId === undefined
            || parentId !== expectedParentId
            || index !== expectedIndex
            || (rawChildren !== undefined && !Array.isArray(rawChildren))) {
            valid = false;
            return undefined;
        }

        seenIds.add(id);
        const node: ParsedHierarchyNode = {
            id,
            name: String(record.name ?? ''),
            kind: String(record.kind ?? '').trim().toLowerCase(),
            parentId,
            opacity: Number(record.opacity),
            blendMode: String(record.blendMode ?? ''),
            isClipped: record.isClipped === true,
            children: []
        };
        nodes.push(node);
        const children = Array.isArray(rawChildren) ? rawChildren : [];
        node.children = children
            .map((child, childIndex) => visit(child, id, childIndex))
            .filter((child): child is ParsedHierarchyNode => Boolean(child));
        if (node.children.length !== children.length) valid = false;
        return node;
    }

    const roots = hierarchy
        .map((node, index) => visit(node, null, index))
        .filter((node): node is ParsedHierarchyNode => Boolean(node));
    if (!valid || roots.length !== hierarchy.length || nodes.length !== totalLayers) {
        return undefined;
    }
    return { roots, nodes, historyStateRef };
}

/**
 * 对已经派发但结果未知的 groupLayersSafely 做一次纯读回分类。
 *
 * 只有“同一文档 + 完整层级 + 精确成员顺序 + 明确 revision 关系”才能解除 unknown。
 * 该函数不产生写调用，也不把近似组、部分成员或历史竞争解释成成功。
 */
export function classifyGroupLayersOperationReconciliation(input: {
    groupName: string;
    layerIds: readonly number[];
    expectedDocumentId: number;
    expectedHistoryStateRef: PhotoshopHistoryStateRef;
    observation: unknown;
}): GroupLayersOperationReconciliationResult {
    const groupName = String(input.groupName || '').trim();
    const expectedDocumentId = readPositiveInteger(input.expectedDocumentId);
    const expectedHistoryStateRef = readHistoryStateRef(input.expectedHistoryStateRef);
    const layerIds = input.layerIds.map(readPositiveInteger);
    if (!groupName
        || !expectedDocumentId
        || !expectedHistoryStateRef
        || expectedHistoryStateRef.documentId !== expectedDocumentId
        || layerIds.length === 0
        || layerIds.some((layerId) => layerId === undefined)
        || new Set(layerIds).size !== layerIds.length) {
        return ambiguous('invalid_reconciliation_identity', expectedHistoryStateRef);
    }

    const expectedLayerIds = layerIds as number[];
    const hierarchy = parseCompleteHierarchy(input.observation);
    if (!hierarchy) {
        return ambiguous('complete_hierarchy_unavailable', expectedHistoryStateRef);
    }
    const observedHistoryStateRef = hierarchy.historyStateRef;
    if (observedHistoryStateRef.documentId !== expectedDocumentId) {
        return ambiguous(
            'document_mismatch',
            expectedHistoryStateRef,
            observedHistoryStateRef
        );
    }

    const nodesById = new Map<number, ParsedHierarchyNode>();
    for (const node of hierarchy.nodes) nodesById.set(node.id, node);
    const allTargetsExist = expectedLayerIds.every((layerId) => nodesById.has(layerId));
    const namedGroups = hierarchy.nodes.filter((node) => (
        node.kind === 'group' && node.name === groupName
    ));
    const exactGroups = namedGroups.filter((group) => (
        sameNumberArray(
            group.children.map((child) => child.id),
            expectedLayerIds
        )
        && group.children.every((child) => child.parentId === group.id)
        && group.opacity === 100
        && isPassThroughBlendMode(group.blendMode)
    ));
    const revisionUnchanged = (
        observedHistoryStateRef.historyStateId
        === expectedHistoryStateRef.historyStateId
    );

    if (!revisionUnchanged && exactGroups.length === 1 && allTargetsExist) {
        const group = exactGroups[0];
        const parentSiblings = group.parentId === null
            ? hierarchy.roots
            : nodesById.get(group.parentId)?.children;
        if (!parentSiblings
            || !expectedLayerIds.every((layerId) => (
                nodesById.get(layerId)?.parentId === group.id
            ))) {
            return ambiguous(
                'group_parentage_incomplete',
                expectedHistoryStateRef,
                observedHistoryStateRef
            );
        }
        return {
            version: GROUP_LAYERS_OPERATION_RECONCILIATION_VERSION,
            classification: 'applied',
            reasonCode: 'exact_group_found_after_revision_change',
            expectedHistoryStateRef,
            observedHistoryStateRef,
            group: {
                id: group.id,
                name: group.name,
                parentGroupId: group.parentId,
                childLayerIds: group.children.map((child) => child.id),
                siblingOrderAfter: parentSiblings.map((sibling) => sibling.id),
                groupOpacity: 100,
                groupBlendMode: 'passThrough'
            }
        };
    }

    if (revisionUnchanged && exactGroups.length === 0 && allTargetsExist) {
        return {
            version: GROUP_LAYERS_OPERATION_RECONCILIATION_VERSION,
            classification: 'not_applied',
            reasonCode: 'revision_unchanged_and_exact_group_absent',
            expectedHistoryStateRef,
            observedHistoryStateRef
        };
    }

    let reasonCode = 'hierarchy_or_revision_ambiguous';
    if (!allTargetsExist) {
        reasonCode = 'target_layers_missing';
    } else if (exactGroups.length > 1) {
        reasonCode = 'multiple_exact_groups';
    } else if (revisionUnchanged && exactGroups.length === 1) {
        reasonCode = 'exact_group_preexisted_at_guard_revision';
    } else if (!revisionUnchanged && exactGroups.length === 0) {
        reasonCode = namedGroups.length > 0
            ? 'partial_or_misordered_group_after_revision_change'
            : 'revision_changed_without_exact_group';
    }
    return ambiguous(
        reasonCode,
        expectedHistoryStateRef,
        observedHistoryStateRef
    );
}
