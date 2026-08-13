export const LAYER_ORGANIZATION_PLAN_VERSION = 'semantic-layer-organization-plan/v0' as const;

export interface LayerOrganizationInventoryItem {
    layerId: number;
    parentId: number | null;
    index: number;
    pathIds: number[];
    name: string;
    kind: string;
    locked: boolean;
}

export interface LayerOrganizationGroupPlan {
    name: string;
    layerIds: number[];
    confidence: number;
    rationale: string;
}

export interface LayerOrganizationPlanIssue {
    code:
        | 'groups_missing'
        | 'too_many_groups'
        | 'invalid_group'
        | 'duplicate_group_name'
        | 'duplicate_layer_membership'
        | 'unknown_layer_id'
        | 'ancestor_descendant_membership'
        | 'different_parents'
        | 'non_contiguous_siblings'
        | 'locked_layer'
        | 'low_confidence_group'
        | 'preserve_unassigned_required'
        | 'invalid_intentionally_unassigned_layer_ids'
        | 'unknown_intentionally_unassigned_layer_id'
        | 'group_layer_intentionally_unassigned'
        | 'assigned_and_intentionally_unassigned'
        | 'incomplete_layer_coverage';
    message: string;
    groupName?: string;
    layerIds?: number[];
}

export interface LayerOrganizationUnsupportedStructuralGroup {
    group: LayerOrganizationGroupPlan;
    issueCodes: Array<'different_parents' | 'non_contiguous_siblings'>;
}

export interface LayerOrganizationPlanValidation {
    version: typeof LAYER_ORGANIZATION_PLAN_VERSION;
    status: 'ready' | 'needs_review' | 'invalid';
    preserveUnassigned: true;
    groups: LayerOrganizationGroupPlan[];
    executableGroups: LayerOrganizationGroupPlan[];
    reviewGroups: LayerOrganizationGroupPlan[];
    alreadySatisfiedGroups: LayerOrganizationGroupPlan[];
    unsupportedStructuralGroups: LayerOrganizationUnsupportedStructuralGroup[];
    intentionallyUnassignedLayerIds: number[];
    unassignedLayerIds: number[];
    issues: LayerOrganizationPlanIssue[];
}

const MAX_GROUPS = 24;
const MAX_LAYERS_PER_GROUP = 120;
const AUTO_EXECUTION_CONFIDENCE = 0.75;

function isPositiveInteger(value: unknown): value is number {
    return typeof value === 'number'
        && Number.isInteger(value)
        && value > 0;
}

function normalizeLayerIds(value: unknown): number[] {
    if (!Array.isArray(value)) return [];
    return value.filter(isPositiveInteger);
}

function isGroupInventoryItem(item: LayerOrganizationInventoryItem): boolean {
    const kind = item.kind.trim().toLowerCase();
    return kind === 'group'
        || kind === 'layersection'
        || kind === 'layerset'
        || kind.endsWith('group');
}

function normalizeGroup(value: unknown): LayerOrganizationGroupPlan | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const name = typeof record.name === 'string'
        ? record.name.trim().slice(0, 80)
        : '';
    const rationale = typeof record.rationale === 'string'
        ? record.rationale.trim().slice(0, 240)
        : '';
    const layerIds = Array.isArray(record.layerIds)
        ? record.layerIds
        : [];
    const confidence = record.confidence;
    if (!name
        || !rationale
        || !layerIds.every(isPositiveInteger)
        || layerIds.length === 0
        || layerIds.length > MAX_LAYERS_PER_GROUP
        || layerIds.length !== new Set(layerIds).size
        || typeof confidence !== 'number'
        || !Number.isFinite(confidence)
        || confidence < 0
        || confidence > 1) {
        return null;
    }
    return {
        name,
        layerIds,
        confidence,
        rationale
    };
}

function hasAncestorDescendantPair(
    layerIds: number[],
    inventoryById: Map<number, LayerOrganizationInventoryItem>
): boolean {
    const selected = new Set(layerIds);
    return layerIds.some((layerId) => {
        const item = inventoryById.get(layerId);
        return item?.pathIds.some((ancestorId) => (
            ancestorId !== layerId && selected.has(ancestorId)
        )) === true;
    });
}

function inspectSiblingStructure(
    group: LayerOrganizationGroupPlan,
    inventoryById: Map<number, LayerOrganizationInventoryItem>
): LayerOrganizationPlanIssue[] {
    const items = group.layerIds
        .map((layerId) => inventoryById.get(layerId))
        .filter(Boolean) as LayerOrganizationInventoryItem[];
    if (items.length !== group.layerIds.length) return [];

    const parentKeys = new Set(items.map((item) => (
        item.parentId === null ? 'root' : String(item.parentId)
    )));
    if (parentKeys.size > 1) {
        return [{
            code: 'different_parents',
            message: `图层组「${group.name}」跨越了不同父级，当前安全归组能力不支持该结构。不要原样重试；请重新划分为同父级语义组，或把无法安全归组的图层列入 intentionallyUnassignedLayerIds。`,
            groupName: group.name,
            layerIds: group.layerIds
        }];
    }

    const indices = items
        .map((item) => item.index)
        .sort((left, right) => left - right);
    const expectedLength = indices[indices.length - 1] - indices[0] + 1;
    if (expectedLength !== indices.length) {
        return [{
            code: 'non_contiguous_siblings',
            message: `图层组「${group.name}」不是连续兄弟层，当前安全归组能力不支持该结构。不要原样重试；请重新划分连续成员，或把无法安全归组的图层列入 intentionallyUnassignedLayerIds。`,
            groupName: group.name,
            layerIds: group.layerIds
        }];
    }
    return [];
}

function hasSameDirectMembers(
    group: LayerOrganizationGroupPlan,
    inventory: LayerOrganizationInventoryItem[]
): boolean {
    const normalizedName = group.name.trim().toLowerCase();
    const expectedMembers = new Set(group.layerIds);
    return inventory
        .filter((item) => (
            isGroupInventoryItem(item)
            && item.name.trim().toLowerCase() === normalizedName
        ))
        .some((existingGroup) => {
            const directChildren = inventory.filter((item) => item.parentId === existingGroup.layerId);
            return directChildren.length === expectedMembers.size
                && directChildren.every((item) => expectedMembers.has(item.layerId));
        });
}

export function validateLayerOrganizationPlan(input: {
    groups: unknown;
    preserveUnassigned?: unknown;
    intentionallyUnassignedLayerIds?: unknown;
    inventory: LayerOrganizationInventoryItem[];
}): LayerOrganizationPlanValidation {
    const issues: LayerOrganizationPlanIssue[] = [];
    const rawGroups = Array.isArray(input.groups) ? input.groups : [];
    if (rawGroups.length === 0) {
        issues.push({
            code: 'groups_missing',
            message: '没有可执行的语义图层组计划。'
        });
    }
    if (rawGroups.length > MAX_GROUPS) {
        issues.push({
            code: 'too_many_groups',
            message: `单次最多声明 ${MAX_GROUPS} 个语义图层组。`
        });
    }

    const groups = rawGroups
        .slice(0, MAX_GROUPS)
        .map(normalizeGroup);
    groups.forEach((group, index) => {
        if (!group) {
            issues.push({
                code: 'invalid_group',
                message: `第 ${index + 1} 个图层组必须包含 name、明确 layerIds、0–1 confidence 和非空 rationale。`
            });
        }
    });
    const validGroups = groups.filter(Boolean) as LayerOrganizationGroupPlan[];
    const inventoryById = new Map(
        input.inventory.map((item) => [item.layerId, item])
    );
    const usedNames = new Set<string>();
    const membershipOwner = new Map<number, string>();
    const executableGroups: LayerOrganizationGroupPlan[] = [];
    const reviewGroups: LayerOrganizationGroupPlan[] = [];
    const alreadySatisfiedGroups: LayerOrganizationGroupPlan[] = [];
    const unsupportedStructuralGroups: LayerOrganizationUnsupportedStructuralGroup[] = [];

    for (const group of validGroups) {
        const normalizedName = group.name.toLowerCase();
        if (usedNames.has(normalizedName)) {
            issues.push({
                code: 'duplicate_group_name',
                message: `图层组名称「${group.name}」重复，无法形成稳定语义结构。`,
                groupName: group.name
            });
        }
        usedNames.add(normalizedName);

        const duplicateMembership = group.layerIds.filter((layerId) => membershipOwner.has(layerId));
        if (duplicateMembership.length > 0) {
            issues.push({
                code: 'duplicate_layer_membership',
                message: `同一图层不能同时属于多个新组：${duplicateMembership.join(', ')}。`,
                groupName: group.name,
                layerIds: duplicateMembership
            });
        }
        group.layerIds.forEach((layerId) => membershipOwner.set(layerId, group.name));

        const unknownLayerIds = group.layerIds.filter((layerId) => !inventoryById.has(layerId));
        if (unknownLayerIds.length > 0) {
            issues.push({
                code: 'unknown_layer_id',
                message: `图层组「${group.name}」引用了当前层树中不存在的 ID。`,
                groupName: group.name,
                layerIds: unknownLayerIds
            });
        }
        if (hasAncestorDescendantPair(group.layerIds, inventoryById)) {
            issues.push({
                code: 'ancestor_descendant_membership',
                message: `图层组「${group.name}」同时包含祖先组与其子层，不能重复归属。`,
                groupName: group.name,
                layerIds: group.layerIds
            });
        }
        if (hasSameDirectMembers(group, input.inventory)) {
            alreadySatisfiedGroups.push(group);
            continue;
        }
        const structuralIssues = inspectSiblingStructure(group, inventoryById);
        issues.push(...structuralIssues);
        const structuralIssueCodes = structuralIssues
            .map((issue) => issue.code)
            .filter((code): code is 'different_parents' | 'non_contiguous_siblings' => (
                code === 'different_parents' || code === 'non_contiguous_siblings'
            ));
        if (structuralIssueCodes.length > 0) {
            unsupportedStructuralGroups.push({
                group,
                issueCodes: structuralIssueCodes
            });
        }
        const lockedLayerIds = group.layerIds.filter((layerId) => inventoryById.get(layerId)?.locked === true);
        if (lockedLayerIds.length > 0) {
            issues.push({
                code: 'locked_layer',
                message: `图层组「${group.name}」包含锁定图层，不能自动写入。`,
                groupName: group.name,
                layerIds: lockedLayerIds
            });
        }
        if (group.confidence < AUTO_EXECUTION_CONFIDENCE) {
            reviewGroups.push(group);
            issues.push({
                code: 'low_confidence_group',
                message: `图层组「${group.name}」的成员归属置信度不足，保留为待复核，不自动改动。`,
                groupName: group.name,
                layerIds: group.layerIds
            });
        } else {
            executableGroups.push(group);
        }
    }

    const rawIntentionallyUnassignedLayerIds = input.intentionallyUnassignedLayerIds;
    const intentionallyUnassignedLayerIds = normalizeLayerIds(rawIntentionallyUnassignedLayerIds);
    if (
        rawIntentionallyUnassignedLayerIds !== undefined
        && (
            !Array.isArray(rawIntentionallyUnassignedLayerIds)
            || rawIntentionallyUnassignedLayerIds.length !== intentionallyUnassignedLayerIds.length
            || intentionallyUnassignedLayerIds.length !== new Set(intentionallyUnassignedLayerIds).size
        )
    ) {
        issues.push({
            code: 'invalid_intentionally_unassigned_layer_ids',
            message: 'intentionallyUnassignedLayerIds 必须是无重复的正整数图层 ID 数组。'
        });
    }
    const unknownIntentionallyUnassignedLayerIds = intentionallyUnassignedLayerIds
        .filter((layerId) => !inventoryById.has(layerId));
    if (unknownIntentionallyUnassignedLayerIds.length > 0) {
        issues.push({
            code: 'unknown_intentionally_unassigned_layer_id',
            message: 'intentionallyUnassignedLayerIds 引用了当前层树中不存在的 ID。',
            layerIds: unknownIntentionallyUnassignedLayerIds
        });
    }
    const intentionallyUnassignedGroupLayerIds = intentionallyUnassignedLayerIds
        .filter((layerId) => {
            const item = inventoryById.get(layerId);
            return item ? isGroupInventoryItem(item) : false;
        });
    if (intentionallyUnassignedGroupLayerIds.length > 0) {
        issues.push({
            code: 'group_layer_intentionally_unassigned',
            message: 'intentionallyUnassignedLayerIds 只声明未归组的非组图层，不接受已有 group ID。',
            layerIds: intentionallyUnassignedGroupLayerIds
        });
    }
    const assignedLayerIds = new Set(validGroups.flatMap((group) => group.layerIds));
    const assignedAndIntentionallyUnassignedLayerIds = intentionallyUnassignedLayerIds
        .filter((layerId) => assignedLayerIds.has(layerId));
    if (assignedAndIntentionallyUnassignedLayerIds.length > 0) {
        issues.push({
            code: 'assigned_and_intentionally_unassigned',
            message: '同一图层不能既进入语义组，又声明为 intentionallyUnassigned。',
            layerIds: assignedAndIntentionallyUnassignedLayerIds
        });
    }
    const intentionallyUnassignedSet = new Set(intentionallyUnassignedLayerIds);
    const unassignedLayerIds = input.inventory
        .filter((item) => !isGroupInventoryItem(item))
        .map((item) => item.layerId)
        .filter((layerId) => (
            !assignedLayerIds.has(layerId)
            && !intentionallyUnassignedSet.has(layerId)
        ));
    if (unassignedLayerIds.length > 0) {
        issues.push({
            code: 'incomplete_layer_coverage',
            message: 'organize 计划没有完整覆盖当前非组图层。请把每个 ID 放入一个语义组，或显式列入 intentionallyUnassignedLayerIds；少量子集不能声明整理完成。',
            layerIds: unassignedLayerIds
        });
    }

    if (input.preserveUnassigned === false) {
        issues.push({
            code: 'preserve_unassigned_required',
            message: '语义整理必须保留未分配图层；当前版本不允许自动删除或吸收歧义图层。'
        });
    }

    const hardIssueCodes = new Set<LayerOrganizationPlanIssue['code']>([
        'groups_missing',
        'too_many_groups',
        'invalid_group',
        'duplicate_group_name',
        'duplicate_layer_membership',
        'unknown_layer_id',
        'ancestor_descendant_membership',
        'different_parents',
        'non_contiguous_siblings',
        'locked_layer',
        'preserve_unassigned_required',
        'invalid_intentionally_unassigned_layer_ids',
        'unknown_intentionally_unassigned_layer_id',
        'group_layer_intentionally_unassigned',
        'assigned_and_intentionally_unassigned',
        'incomplete_layer_coverage'
    ]);
    const hasHardIssue = issues.some((issue) => hardIssueCodes.has(issue.code));
    let status: LayerOrganizationPlanValidation['status'] = 'ready';
    if (hasHardIssue) {
        status = 'invalid';
    } else if (reviewGroups.length > 0) {
        status = 'needs_review';
    }

    return {
        version: LAYER_ORGANIZATION_PLAN_VERSION,
        status,
        preserveUnassigned: true,
        groups: validGroups,
        executableGroups: hasHardIssue ? [] : executableGroups,
        reviewGroups,
        alreadySatisfiedGroups,
        unsupportedStructuralGroups,
        intentionallyUnassignedLayerIds,
        unassignedLayerIds,
        issues
    };
}
