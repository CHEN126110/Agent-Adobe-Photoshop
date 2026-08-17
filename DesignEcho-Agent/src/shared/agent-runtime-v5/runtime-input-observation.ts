import type { RuntimeDesignWorkMode } from './contracts';
import type { RuntimeDesignBriefAvailableInputSource } from './runtime-design-brief-declaration';

export interface RuntimeInputObservationToolCall {
    name: string;
    arguments?: unknown;
    result?: unknown;
}

interface PhotoshopLayerIdentity {
    id?: number;
    name?: string;
    parentId?: number;
    ancestorNames?: string[];
}

const PHOTOSHOP_TARGET_SOURCE_KIND = 'photoshop_target' as const;
const PROJECT_PRODUCT_SOURCE_KIND = 'project_product' as const;
const MAX_LAYER_IDENTITIES = 256;
const MAX_HIERARCHY_NODES = 512;

const PHOTOSHOP_DOCUMENT_BOUNDARY_TOOLS = new Set([
    'closeAllDocuments',
    'closeDocument',
    'closeSmartObjectContents',
    'createDocument',
    'editSmartObjectContents',
    'openDocument',
    'openTemplate',
    'switchDocument'
]);

const GENERIC_LAYER_NAMES = new Set([
    'artboard',
    'group',
    'layer',
    'object',
    'rectangle',
    'shape',
    'smartobject',
    'text',
    '元素',
    '图层',
    '图层组',
    '对象',
    '形状',
    '文字',
    '文本',
    '智能对象',
    '画板',
    '矩形',
    '组',
    '群组'
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

function readFiniteLayerId(value: unknown): number | undefined {
    const numberValue = Number(value);
    return Number.isSafeInteger(numberValue) && numberValue > 0
        ? numberValue
        : undefined;
}

function readNonEmptyText(value: unknown): string | undefined {
    const text = String(value || '').trim();
    return text ? text : undefined;
}

function normalizeComparableText(value: string): string {
    return value
        .normalize('NFKC')
        .toLocaleLowerCase()
        .replace(/[\s"'“”‘’「」『』《》〈〉【】[\]()（）]+/gu, '');
}

const ORDERED_HIERARCHY_SCOPE_LABEL_PATTERN = '(?:屏|页|版|模块|画板)';
const ORDERED_HIERARCHY_SCOPE_VALUE_PATTERN = '(?:\\d+|[〇零一二两三四五六七八九十百千]+)';

function parsePositiveOrdinal(value: string): number | undefined {
    const normalizedValue = value.normalize('NFKC').trim();
    if (/^\d+$/u.test(normalizedValue)) {
        const ordinal = Number(normalizedValue);
        return Number.isSafeInteger(ordinal) && ordinal > 0 ? ordinal : undefined;
    }
    if (!/^[〇零一二两三四五六七八九十百千]+$/u.test(normalizedValue)) {
        return undefined;
    }
    const digitValues: Record<string, number> = {
        '〇': 0,
        '零': 0,
        '一': 1,
        '二': 2,
        '两': 2,
        '三': 3,
        '四': 4,
        '五': 5,
        '六': 6,
        '七': 7,
        '八': 8,
        '九': 9
    };
    if (!/[十百千]/u.test(normalizedValue)) {
        const ordinal = Number(Array.from(normalizedValue)
            .map((character) => digitValues[character])
            .join(''));
        return Number.isSafeInteger(ordinal) && ordinal > 0 ? ordinal : undefined;
    }
    const unitValues: Record<string, number> = {
        '十': 10,
        '百': 100,
        '千': 1000
    };
    let total = 0;
    let pendingDigit = 0;
    for (const character of normalizedValue) {
        if (Object.prototype.hasOwnProperty.call(digitValues, character)) {
            pendingDigit = digitValues[character];
            continue;
        }
        const unit = unitValues[character];
        if (!unit) return undefined;
        total += (pendingDigit || 1) * unit;
        pendingDigit = 0;
    }
    const ordinal = total + pendingDigit;
    return Number.isSafeInteger(ordinal) && ordinal > 0 ? ordinal : undefined;
}

function readOrderedHierarchyScopeOrdinal(value: string): number | undefined {
    const normalizedValue = value.normalize('NFKC').replace(/\s+/gu, '');
    const firstScopePattern = new RegExp(
        `首${ORDERED_HIERARCHY_SCOPE_LABEL_PATTERN}`,
        'u'
    );
    if (firstScopePattern.test(normalizedValue)) return 1;
    const leadingOrdinalPattern = new RegExp(
        `(?:第)?(${ORDERED_HIERARCHY_SCOPE_VALUE_PATTERN})${ORDERED_HIERARCHY_SCOPE_LABEL_PATTERN}`,
        'u'
    );
    const trailingOrdinalPattern = new RegExp(
        `${ORDERED_HIERARCHY_SCOPE_LABEL_PATTERN}(?:第)?(${ORDERED_HIERARCHY_SCOPE_VALUE_PATTERN})`,
        'u'
    );
    const match = normalizedValue.match(leadingOrdinalPattern)
        || normalizedValue.match(trailingOrdinalPattern);
    return match ? parsePositiveOrdinal(match[1]) : undefined;
}

function readOrderedHierarchyPrefixOrdinal(value: string): number | undefined {
    const normalizedValue = value.normalize('NFKC').trim();
    const prefixPattern = new RegExp(
        `^(?:第\\s*)?(${ORDERED_HIERARCHY_SCOPE_VALUE_PATTERN})(?:\\s*[-_.－–—、:：]+\\s*|\\s+)`,
        'u'
    );
    const match = normalizedValue.match(prefixPattern);
    return match ? parsePositiveOrdinal(match[1]) : undefined;
}

function buildOrderedHierarchyScopeKey(ordinal: number): string {
    return `ordered_hierarchy_scope:${ordinal}`;
}

function collectTaskOrderedHierarchyScopeKeys(task: string): Set<string> {
    const tokenPattern = new RegExp(
        [
            `首\\s*${ORDERED_HIERARCHY_SCOPE_LABEL_PATTERN}`,
            `(?:第\\s*)?${ORDERED_HIERARCHY_SCOPE_VALUE_PATTERN}\\s*${ORDERED_HIERARCHY_SCOPE_LABEL_PATTERN}`,
            `${ORDERED_HIERARCHY_SCOPE_LABEL_PATTERN}\\s*(?:第\\s*)?${ORDERED_HIERARCHY_SCOPE_VALUE_PATTERN}`
        ].join('|'),
        'gu'
    );
    const scopeKeys = new Set<string>();
    for (const match of task.matchAll(tokenPattern)) {
        const ordinal = readOrderedHierarchyScopeOrdinal(match[0]);
        if (ordinal) scopeKeys.add(buildOrderedHierarchyScopeKey(ordinal));
    }
    return scopeKeys;
}

function buildHierarchySegmentKeys(
    value: string,
    options?: {
        allowOrderedPrefix?: boolean;
    }
): string[] {
    const normalizedValue = normalizeComparableText(value);
    const ordinal = readOrderedHierarchyScopeOrdinal(value)
        ?? (options?.allowOrderedPrefix
            ? readOrderedHierarchyPrefixOrdinal(value)
            : undefined);
    return [
        ...(normalizedValue ? [`hierarchy_name:${normalizedValue}`] : []),
        ...(ordinal ? [buildOrderedHierarchyScopeKey(ordinal)] : [])
    ];
}

function isSpecificLayerName(name: string): boolean {
    const normalizedName = normalizeComparableText(name);
    if (normalizedName.length < 2) return false;
    if (GENERIC_LAYER_NAMES.has(normalizedName)) return false;
    return !/^(?:artboard|group|layer|object|rectangle|shape|smartobject|text|元素|图层|图层组|对象|形状|文字|文本|智能对象|画板|矩形|组|群组)\d*$/iu
        .test(normalizedName);
}

function taskReferencesExplicitLayerId(task: string, layerId: number): boolean {
    const escapedLayerId = String(layerId).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return new RegExp(
        `(?:图层|对象|元素)\\s*(?:id|编号|#)\\s*[:：#]?\\s*${escapedLayerId}(?:\\D|$)`
        + `|\\blayer\\s*(?:id\\s*[:：#]?|#)\\s*${escapedLayerId}(?:\\D|$)`,
        'iu'
    ).test(task);
}

function resolveTaskLayerIdentityMatchPriority(
    task: string,
    identity: PhotoshopLayerIdentity,
    taskScopeKeys: ReadonlySet<string>,
    structuralContainerLayerIds: ReadonlySet<number>
): number {
    if (identity.id && taskReferencesExplicitLayerId(task, identity.id)) return 3;
    const normalizedTask = normalizeComparableText(task);
    const normalizedName = normalizeComparableText(identity.name || '');
    const hierarchyKeys = buildHierarchySegmentKeys(
        identity.name || '',
        {
            allowOrderedPrefix: !!identity.id
                && structuralContainerLayerIds.has(identity.id)
        }
    );
    if (isSpecificLayerName(identity.name || '')
        && normalizedTask.includes(normalizedName)) {
        return 2;
    }
    if (isSpecificLayerName(identity.name || '')
        && hierarchyKeys.some((key) => taskScopeKeys.has(key))) {
        return 2;
    }
    return 0;
}

function collectStructuralContainerLayerIds(
    identities: readonly PhotoshopLayerIdentity[]
): Set<number> {
    const containerLayerIds = new Set<number>();
    identities.forEach((identity) => {
        if (identity.parentId) containerLayerIds.add(identity.parentId);
    });

    const nameCounts = new Map<string, number>();
    identities.forEach((identity) => {
        const normalizedName = normalizeComparableText(identity.name || '');
        if (!normalizedName) return;
        nameCounts.set(normalizedName, (nameCounts.get(normalizedName) || 0) + 1);
    });
    identities.forEach((candidate) => {
        if (!candidate.id || containerLayerIds.has(candidate.id)) return;
        const normalizedName = normalizeComparableText(candidate.name || '');
        if (!normalizedName || nameCounts.get(normalizedName) !== 1) return;
        const appearsAsAncestor = identities.some((other) => (
            other.id !== candidate.id
            && (other.ancestorNames || [])
                .map(normalizeComparableText)
                .includes(normalizedName)
        ));
        if (appearsAsAncestor) containerLayerIds.add(candidate.id);
    });
    return containerLayerIds;
}

function removeShadowedHierarchyScopeCandidates(
    identities: PhotoshopLayerIdentity[]
): PhotoshopLayerIdentity[] {
    return identities.filter((candidate) => {
        const normalizedCandidateName = normalizeComparableText(candidate.name || '');
        if (!normalizedCandidateName) return true;
        return !identities.some((other) => (
            other !== candidate
            && (other.ancestorNames || [])
                .map(normalizeComparableText)
                .includes(normalizedCandidateName)
        ));
    });
}

function appendLayerIdentity(
    identities: PhotoshopLayerIdentity[],
    seen: Set<string>,
    idValue: unknown,
    nameValue: unknown,
    context?: {
        parentId?: unknown;
        ancestorNames?: readonly string[];
    }
): void {
    const id = readFiniteLayerId(idValue);
    const name = readNonEmptyText(nameValue);
    if (!id) return;
    const key = `${id}:${normalizeComparableText(name || '')}`;
    const parentId = readFiniteLayerId(context?.parentId);
    const ancestorNames = (context?.ancestorNames || [])
        .map(readNonEmptyText)
        .filter((item): item is string => !!item);
    if (seen.has(key)) {
        const existing = identities.find((identity) => (
            identity.id === id
            && normalizeComparableText(identity.name || '') === normalizeComparableText(name || '')
        ));
        if (existing && !existing.parentId && parentId) existing.parentId = parentId;
        if (existing && (!existing.ancestorNames || existing.ancestorNames.length === 0)
            && ancestorNames.length > 0) {
            existing.ancestorNames = ancestorNames;
        }
        return;
    }
    if (identities.length >= MAX_LAYER_IDENTITIES) return;
    seen.add(key);
    identities.push({
        id,
        ...(name ? { name } : {}),
        ...(parentId ? { parentId } : {}),
        ...(ancestorNames.length > 0 ? { ancestorNames } : {})
    });
}

function readRecordAncestorNames(
    record: Record<string, unknown>,
    ownName: string | undefined
): string[] {
    if (Array.isArray(record.ancestorNames)) {
        return record.ancestorNames
            .map(readNonEmptyText)
            .filter((item): item is string => !!item);
    }
    const path = readNonEmptyText(
        record.path
        ?? record.layerPath
        ?? record.hierarchyPath
        ?? record.parentPath
    );
    if (!path) return [];
    const segments = path
        .split(/[\\/>›→]+/gu)
        .map((segment) => segment.trim())
        .filter(Boolean);
    if (ownName
        && segments.length > 0
        && normalizeComparableText(segments[segments.length - 1]) === normalizeComparableText(ownName)) {
        segments.pop();
    }
    return segments;
}

function appendIdentityRecord(
    identities: PhotoshopLayerIdentity[],
    seen: Set<string>,
    value: unknown,
    inheritedContext?: {
        parentId?: unknown;
        ancestorNames?: readonly string[];
    }
): void {
    const record = asRecord(value);
    if (!record) return;
    const name = readNonEmptyText(record.layerName ?? record.name);
    const recordedAncestors = readRecordAncestorNames(record, name);
    appendLayerIdentity(
        identities,
        seen,
        record.layerId ?? record.id,
        name,
        {
            parentId: record.parentId ?? record.parentLayerId ?? inheritedContext?.parentId,
            ancestorNames: recordedAncestors.length > 0
                ? recordedAncestors
                : inheritedContext?.ancestorNames
        }
    );
}

function appendIdentityArray(
    identities: PhotoshopLayerIdentity[],
    seen: Set<string>,
    value: unknown
): void {
    if (!Array.isArray(value)) return;
    const records = value
        .slice(0, MAX_LAYER_IDENTITIES)
        .map(asRecord)
        .filter((record): record is Record<string, unknown> => !!record);
    const recordsById = new Map<number, Record<string, unknown>>();
    records.forEach((record) => {
        const id = readFiniteLayerId(record.layerId ?? record.id);
        if (id) recordsById.set(id, record);
    });

    function resolveFlatAncestors(
        record: Record<string, unknown>,
        visited: Set<number>
    ): string[] {
        const ownName = readNonEmptyText(record.layerName ?? record.name);
        const recordedAncestors = readRecordAncestorNames(record, ownName);
        if (recordedAncestors.length > 0) return recordedAncestors;
        const parentId = readFiniteLayerId(record.parentId ?? record.parentLayerId);
        if (!parentId || visited.has(parentId)) return [];
        const parent = recordsById.get(parentId);
        if (!parent) return [];
        const nextVisited = new Set(visited);
        nextVisited.add(parentId);
        const parentAncestors = resolveFlatAncestors(parent, nextVisited);
        const parentName = readNonEmptyText(parent.layerName ?? parent.name);
        return parentName ? [...parentAncestors, parentName] : parentAncestors;
    }

    records.forEach((record) => {
        const id = readFiniteLayerId(record.layerId ?? record.id);
        appendIdentityRecord(identities, seen, record, {
            parentId: record.parentId ?? record.parentLayerId,
            ancestorNames: resolveFlatAncestors(record, new Set(id ? [id] : []))
        });
    });
}

function appendHierarchyIdentities(
    identities: PhotoshopLayerIdentity[],
    seen: Set<string>,
    value: unknown,
    rootContext?: {
        parentId?: number;
        ancestorNames?: readonly string[];
    }
): void {
    let visitedNodes = 0;

    function visit(
        node: unknown,
        parentId: number | undefined,
        ancestorNames: readonly string[]
    ): void {
        if (visitedNodes >= MAX_HIERARCHY_NODES
            || identities.length >= MAX_LAYER_IDENTITIES) {
            return;
        }
        if (Array.isArray(node)) {
            node.slice(0, MAX_LAYER_IDENTITIES).forEach((item) => (
                visit(item, parentId, ancestorNames)
            ));
            return;
        }
        const record = asRecord(node);
        if (!record) return;
        visitedNodes += 1;
        const id = readFiniteLayerId(record.layerId ?? record.id);
        const name = readNonEmptyText(record.layerName ?? record.name);
        appendIdentityRecord(identities, seen, record, {
            parentId,
            ancestorNames
        });
        // getLayerHierarchy 的真实树契约只有 children；不递归扫描 diagnostics/data 等任意字段。
        if (Array.isArray(record.children)) {
            visit(
                record.children,
                id,
                name ? [...ancestorNames, name] : ancestorNames
            );
        }
    }

    visit(
        value,
        rootContext?.parentId,
        rootContext?.ancestorNames || []
    );
}

function collectToolResultLayerIdentities(
    toolName: string,
    result: Record<string, unknown>
): PhotoshopLayerIdentity[] {
    const identities: PhotoshopLayerIdentity[] = [];
    const seen = new Set<string>();

    switch (toolName) {
        case 'getLayerHierarchy': {
            const rootLayerId = readFiniteLayerId(result.rootLayerId);
            const rootLayerName = readNonEmptyText(result.rootLayerName);
            const topLevelNodes = Array.isArray(result.hierarchy)
                ? result.hierarchy
                : [];
            const hierarchyIncludesRoot = !!rootLayerId && topLevelNodes.some((node) => {
                const record = asRecord(node);
                return readFiniteLayerId(record?.layerId ?? record?.id) === rootLayerId;
            });
            appendHierarchyIdentities(
                identities,
                seen,
                result.hierarchy,
                !hierarchyIncludesRoot && rootLayerId
                    ? {
                        parentId: rootLayerId,
                        ancestorNames: rootLayerName ? [rootLayerName] : []
                    }
                    : undefined
            );
            appendIdentityArray(identities, seen, result.flatList);
            break;
        }
        case 'getAnnotatedSnapshot':
            appendIdentityArray(identities, seen, result.layers);
            appendIdentityArray(identities, seen, result.elements);
            break;
        case 'getElementMapping':
            appendIdentityArray(identities, seen, result.elements);
            break;
        case 'findLayers':
            appendIdentityArray(identities, seen, result.matches);
            break;
        case 'getLayerProperties':
            appendIdentityRecord(identities, seen, result.properties);
            break;
        case 'getLayerBounds':
        case 'getLayerTextInfo':
        case 'getSmartObjectInfo':
            appendIdentityRecord(identities, seen, result);
            break;
        default:
            break;
    }
    return identities;
}

function countHierarchyNodesUpTo(value: unknown, limit: number): number {
    let count = 0;

    function visit(node: unknown): void {
        if (count >= limit) return;
        if (Array.isArray(node)) {
            node.forEach(visit);
            return;
        }
        const record = asRecord(node);
        if (!record) return;
        count += 1;
        if (Array.isArray(record.children)) visit(record.children);
    }

    visit(value);
    return count;
}

function toolResultLayerCollectionReachedLimit(
    toolName: string,
    result: Record<string, unknown>
): boolean {
    function arrayReachedLimit(value: unknown): boolean {
        return Array.isArray(value) && value.length >= MAX_LAYER_IDENTITIES;
    }

    switch (toolName) {
        case 'getLayerHierarchy': {
            const hierarchyNodeCount = countHierarchyNodesUpTo(
                result.hierarchy,
                MAX_HIERARCHY_NODES
            );
            return hierarchyNodeCount >= MAX_LAYER_IDENTITIES
                || hierarchyNodeCount >= MAX_HIERARCHY_NODES
                || arrayReachedLimit(result.flatList);
        }
        case 'getAnnotatedSnapshot':
            return arrayReachedLimit(result.layers)
                || arrayReachedLimit(result.elements);
        case 'getElementMapping':
            return arrayReachedLimit(result.elements);
        case 'findLayers':
            return arrayReachedLimit(result.matches);
        default:
            return false;
    }
}

function readExplicitLayerQuery(value: unknown): {
    id?: number;
    exactName?: string;
    containsName?: string;
} | undefined {
    const args = asRecord(value);
    if (!args) return undefined;
    const id = readFiniteLayerId(
        args.layerId
        ?? args.targetLayerId
    );
    const exactName = readNonEmptyText(
        args.nameEquals
        ?? args.layerName
        ?? args.targetLayerName
    );
    const containsName = readNonEmptyText(args.nameContains);
    if (!id && !exactName && !containsName) return undefined;
    return {
        ...(id ? { id } : {}),
        ...(exactName ? { exactName } : {}),
        ...(containsName ? { containsName } : {})
    };
}

function identityMatchesExplicitQuery(
    identity: PhotoshopLayerIdentity,
    query: ReturnType<typeof readExplicitLayerQuery>
): boolean {
    if (!query || !identity.id) return false;
    if (query.id && identity.id !== query.id) return false;
    const normalizedName = normalizeComparableText(identity.name || '');
    if (query.exactName
        && normalizedName !== normalizeComparableText(query.exactName)) {
        return false;
    }
    if (query.containsName
        && !normalizedName.includes(normalizeComparableText(query.containsName))) {
        return false;
    }
    return true;
}

function readSuccessfulDocumentId(toolCall: RuntimeInputObservationToolCall): number | undefined {
    if (toolCall.name !== 'getDocumentInfo') return undefined;
    const result = asRecord(toolCall.result);
    if (!result || result.success !== true || result.documentState !== 'present') return undefined;
    return readFiniteLayerId(asRecord(result.document)?.id);
}

/**
 * 只使用最近一次活动文档身份建立后的观察窗口。切换/打开/关闭文档会清空窗口，
 * 后续必须重新成功读取 getDocumentInfo；因此旧文档里的图层命中不会永久留在 R1。
 */
function selectCurrentDocumentObservationWindow(
    toolCalls: readonly RuntimeInputObservationToolCall[]
): RuntimeInputObservationToolCall[] {
    let activeDocumentId: number | undefined;
    let windowStart = -1;

    toolCalls.forEach((toolCall, index) => {
        const result = asRecord(toolCall.result);
        if (PHOTOSHOP_DOCUMENT_BOUNDARY_TOOLS.has(toolCall.name)
            && result?.success === true) {
            activeDocumentId = undefined;
            windowStart = -1;
            return;
        }
        const documentId = readSuccessfulDocumentId(toolCall);
        if (!documentId) return;
        if (activeDocumentId !== documentId) {
            activeDocumentId = documentId;
            windowStart = index;
        }
    });

    return windowStart >= 0 ? toolCalls.slice(windowStart) : [];
}

function workModeCanUseExistingPhotoshopTarget(
    workMode: RuntimeDesignWorkMode | undefined
): boolean {
    return workMode !== 'create_new' && workMode !== 'export_only';
}

function toolCallGroundsProjectProduct(
    toolCall: RuntimeInputObservationToolCall
): boolean {
    if (toolCall.name !== 'analyzeProjectContactSheetOverview') return false;
    const result = asRecord(toolCall.result);
    if (!result || result.success !== true) return false;

    const contactSheet = asRecord(result.contactSheet);
    const items = Array.isArray(contactSheet?.items) ? contactSheet.items : [];
    const renderedImageIds = new Set(items.flatMap((item) => {
        const record = asRecord(item);
        const id = record?.status === 'rendered'
            ? readNonEmptyText(record.id)
            : undefined;
        return id ? [id] : [];
    }));
    if (renderedImageIds.size === 0) return false;

    const observation = asRecord(result.observation);
    const productResolution = asRecord(observation?.productResolution);
    if (productResolution?.status !== 'resolved') return false;
    if (!readNonEmptyText(productResolution.primaryProduct)) return false;

    const basisImageIds = Array.isArray(productResolution.basisImageIds)
        ? productResolution.basisImageIds
            .map(readNonEmptyText)
            .filter((id): id is string => Boolean(id))
        : [];
    return basisImageIds.length > 0
        && basisImageIds.every((id) => renderedImageIds.has(id));
}

function toolCallGroundsPhotoshopTarget(
    task: string,
    currentDocumentId: number,
    toolCall: RuntimeInputObservationToolCall
): boolean {
    const result = asRecord(toolCall.result);
    if (!result || result.success !== true) return false;
    const resultHistoryStateRef = asRecord(result.historyStateRef);
    const resultDocumentId = readFiniteLayerId(resultHistoryStateRef?.documentId);
    if (resultDocumentId && resultDocumentId !== currentDocumentId) return false;

    const identities = collectToolResultLayerIdentities(toolCall.name, result);
    if (identities.length === 0) return false;
    if (identities.length >= MAX_LAYER_IDENTITIES
        || toolResultLayerCollectionReachedLimit(toolCall.name, result)) {
        return false;
    }
    const args = asRecord(toolCall.arguments);
    const explicitQuery = readExplicitLayerQuery(args?.layerFilter ?? args);
    const taskScopeKeys = collectTaskOrderedHierarchyScopeKeys(task);
    const structuralContainerLayerIds = collectStructuralContainerLayerIds(identities);
    const rankedIdentities = identities
        .filter((identity) => !explicitQuery || identityMatchesExplicitQuery(identity, explicitQuery))
        .map((identity) => ({
            identity,
            priority: resolveTaskLayerIdentityMatchPriority(
                task,
                identity,
                taskScopeKeys,
                structuralContainerLayerIds
            )
        }));
    const highestMatchPriority = rankedIdentities.reduce(
        (highest, candidate) => Math.max(highest, candidate.priority),
        0
    );
    const matchingIdentities = removeShadowedHierarchyScopeCandidates(
        rankedIdentities
            .filter((candidate) => (
                candidate.priority > 0
                && candidate.priority === highestMatchPriority
            ))
            .map((candidate) => candidate.identity)
    );
    if (matchingIdentities.length === 0) return false;

    const normalizedTask = normalizeComparableText(task);
    const matchingLeafNames = new Set(
        matchingIdentities
            .map((identity) => normalizeComparableText(identity.name || ''))
            .filter(Boolean)
    );
    const requiredScopeKeys = new Set<string>(taskScopeKeys);
    const referencedAncestorNames = Array.from(new Set(
        matchingIdentities.flatMap((identity) => identity.ancestorNames || [])
            .filter(isSpecificLayerName)
            .map(normalizeComparableText)
            .filter((ancestorName) => (
                !!ancestorName
                && !matchingLeafNames.has(ancestorName)
                && normalizedTask.includes(ancestorName)
            ))
    ));
    referencedAncestorNames.forEach((ancestorName) => (
        requiredScopeKeys.add(`hierarchy_name:${ancestorName}`)
    ));
    const scopedMatches = matchingIdentities.filter((identity) => {
        const hierarchyKeys = new Set([
            ...(identity.ancestorNames || [])
                .flatMap((ancestorName) => (
                    buildHierarchySegmentKeys(ancestorName, { allowOrderedPrefix: true })
                )),
            ...buildHierarchySegmentKeys(
                identity.name || '',
                {
                    allowOrderedPrefix: !!identity.id
                        && structuralContainerLayerIds.has(identity.id)
                }
            )
        ]);
        return Array.from(requiredScopeKeys).every((key) => hierarchyKeys.has(key));
    });

    // 同名目标必须由父级路径消歧；任务明确说出有序层级范围却没有可验证路径时也失败关闭。
    // “第4屏 / 第四屏 / 屏4 / 一屏 / 首屏”等显式说法，以及被父子结构证明的
    // “4-主视觉”类数字前缀容器，只归一为路径定位依据，不决定业务品类、执行步骤
    // 或 Tool，也不授予任何写权限。数字叶子名称本身不能建立有序范围。
    // source 只声明“目标已被 Host 证实”，不能把多个候选中的任意一个冒充成确定目标。
    const uniqueMatchedLayerIds = new Set(scopedMatches.map((identity) => identity.id));
    return uniqueMatchedLayerIds.size === 1;
}

/**
 * 把当前运行中已经由只读观察证实的输入登记为 R1 来源。
 *
 * Photoshop 目标要求当前文档观察窗口、稳定图层身份和用户点名目标共同成立；
 * 项目商品要求总览视觉观察明确 resolved，并引用真实渲染成功的缩略图编号。
 * 这不是意图识别或权限放行，写入仍需经过 R4/E1、Tool preflight 与写后读回。
 */
export function buildObservedRuntimeInputSources(input: {
    task: string;
    toolCalls: readonly RuntimeInputObservationToolCall[];
    workMode?: RuntimeDesignWorkMode;
}): RuntimeDesignBriefAvailableInputSource[] {
    const sources: RuntimeDesignBriefAvailableInputSource[] = [];
    if (input.toolCalls.some(toolCallGroundsProjectProduct)) {
        sources.push({ sourceKind: PROJECT_PRODUCT_SOURCE_KIND });
    }
    if (!workModeCanUseExistingPhotoshopTarget(input.workMode)) return sources;

    const observationWindow = selectCurrentDocumentObservationWindow(input.toolCalls);
    const documentInfoCall = observationWindow.find((toolCall) => (
        readSuccessfulDocumentId(toolCall) !== undefined
    ));
    const currentDocumentId = documentInfoCall
        ? readSuccessfulDocumentId(documentInfoCall)
        : undefined;
    if (!currentDocumentId) return sources;

    const groundedTarget = observationWindow.some((toolCall) => (
        toolCallGroundsPhotoshopTarget(input.task, currentDocumentId, toolCall)
    ));
    if (groundedTarget) {
        sources.push({ sourceKind: PHOTOSHOP_TARGET_SOURCE_KIND });
    }
    return sources;
}
