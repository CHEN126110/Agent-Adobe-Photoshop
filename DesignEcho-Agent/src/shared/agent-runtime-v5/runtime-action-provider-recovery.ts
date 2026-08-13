/**
 * R4 / E1 provider 失败后的纯恢复契约。
 *
 * 这里只判断 Capability 可用性与失败后去向；不执行 Tool、不推进 Stage、
 * 不授予权限，也不把失败写入当成成功。真正的同文档读回仍由 Agent runtime
 * 调度，并继续经过 execution preflight 与 Runtime Session。
 */

import type { PhotoshopHistoryStateRef } from '../photoshop-history-state-ref';
import type { RuntimeActionPlanCapabilityContext } from './runtime-action-plan-declaration';

export interface RuntimeActionProviderAvailability {
    providerName: string;
    capabilityRefs: string[];
}

export type RuntimeActionProviderFailureDisposition =
    | 'readback_required'
    | 'replan'
    | 'stop';

export type RuntimeActionMutationReadbackDisposition =
    | 'verified_complete'
    | 'replan_repair'
    | 'readback_required';

export type RuntimeActionRepairReadbackContentKind =
    | 'structural'
    | 'visual'
    | 'bounds';

export interface RuntimeActionRepairReadbackContent {
    toolName: string;
    contentKinds: RuntimeActionRepairReadbackContentKind[];
    contentSufficient: boolean;
}

const VISUAL_REPAIR_READBACK_TOOL_NAMES = new Set([
    'getAnnotatedSnapshot',
    'getCanvasSnapshot',
    'getDocumentSnapshot'
]);

const STRUCTURAL_REPAIR_READBACK_TOOL_NAMES = new Set([
    'getLayerHierarchy',
    'findLayers',
    'getAcceptanceSnapshot'
]);

const DOCUMENT_SUMMARY_REPAIR_READBACK_TOOL_NAMES = new Set([
    'getDocumentInfo',
    'getLayerHierarchy'
]);

const BOUNDS_REPAIR_READBACK_TOOL_NAMES = new Set([
    'getLayerBounds',
    'getLayerProperties'
]);

function unique(values: readonly string[]): string[] {
    return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return value as Record<string, unknown>;
}

function hasNonEmptyText(value: unknown, minimumLength = 1): boolean {
    return typeof value === 'string' && value.trim().length >= minimumLength;
}

function hasLayerIdentity(value: unknown): boolean {
    const record = asRecord(value);
    if (!record) return false;
    const id = Number(record.layerId ?? record.id);
    return Number.isFinite(id) || hasNonEmptyText(record.layerName ?? record.name);
}

function hasHierarchyNode(value: unknown, remainingDepth = 32): boolean {
    if (remainingDepth <= 0) return false;
    if (Array.isArray(value)) {
        return value.some((item) => hasHierarchyNode(item, remainingDepth));
    }
    const record = asRecord(value);
    if (!record) return false;
    if (hasLayerIdentity(record)) return true;
    return Array.isArray(record.children)
        && record.children.some((item) => hasHierarchyNode(item, remainingDepth - 1));
}

function hasLayerRecordArray(value: unknown): boolean {
    return Array.isArray(value) && value.some(hasLayerIdentity);
}

function hasVisualContent(result: Record<string, unknown>): boolean {
    const snapshot = asRecord(result.snapshot);
    return hasNonEmptyText(result.imageData, 32)
        || hasNonEmptyText(snapshot?.base64, 32);
}

function hasFiniteBounds(value: unknown): boolean {
    const bounds = asRecord(value);
    if (!bounds) return false;
    const left = Number(bounds.left);
    const top = Number(bounds.top);
    const right = Number(bounds.right);
    const bottom = Number(bounds.bottom);
    if (![left, top, right, bottom].every(Number.isFinite)) return false;
    return right >= left && bottom >= top;
}

function hasStructuralContent(
    toolName: string,
    result: Record<string, unknown>
): boolean {
    switch (toolName) {
        case 'getLayerHierarchy':
            return hasHierarchyNode(result.hierarchy)
                || hasLayerRecordArray(result.flatList);
        case 'findLayers':
            return hasLayerRecordArray(result.matches);
        case 'getAcceptanceSnapshot':
            return hasLayerRecordArray(result.layers);
        case 'getAnnotatedSnapshot':
            return hasLayerRecordArray(result.elements)
                || hasLayerRecordArray(result.layers);
        default:
            return false;
    }
}

function hasBoundsContent(
    toolName: string,
    result: Record<string, unknown>
): boolean {
    if (toolName === 'getAnnotatedSnapshot') {
        const elements = Array.isArray(result.elements)
            ? result.elements
            : result.layers;
        return Array.isArray(elements) && elements.some((item) => {
            const record = asRecord(item);
            return hasLayerIdentity(record) && hasFiniteBounds(record?.bounds);
        });
    }
    if (toolName === 'getAcceptanceSnapshot') {
        return Array.isArray(result.layers) && result.layers.some((item) => {
            const record = asRecord(item);
            return hasLayerIdentity(record) && hasFiniteBounds(record?.bounds);
        });
    }
    if (toolName === 'getLayerBounds') {
        return hasLayerIdentity(result)
            && (hasFiniteBounds(result.bounds) || hasFiniteBounds(result.boundsNoEffects));
    }
    if (toolName === 'getLayerProperties') {
        const properties = asRecord(result.properties) || result;
        return hasLayerIdentity(properties)
            && (
                hasFiniteBounds(properties.bounds)
                || hasFiniteBounds(properties.boundsNoEffects)
            );
    }
    return false;
}

export function inspectRuntimeActionRepairReadbackContent(input: {
    toolName: string;
    result: unknown;
}): RuntimeActionRepairReadbackContent {
    const toolName = String(input.toolName || '').trim();
    const result = asRecord(input.result);
    if (!result || result.success === false) {
        return {
            toolName,
            contentKinds: [],
            contentSufficient: false
        };
    }
    const contentKinds: RuntimeActionRepairReadbackContentKind[] = [];
    if (hasStructuralContent(toolName, result)) contentKinds.push('structural');
    if (hasVisualContent(result) && VISUAL_REPAIR_READBACK_TOOL_NAMES.has(toolName)) {
        contentKinds.push('visual');
    }
    if (hasBoundsContent(toolName, result)) contentKinds.push('bounds');
    return {
        toolName,
        contentKinds,
        contentSufficient: contentKinds.length > 0
    };
}

export function findUnavailableFailedRuntimeActionCapabilities(input: {
    failedCapabilityRefs: readonly string[];
    failedProviderNames: readonly string[];
    providers: readonly RuntimeActionProviderAvailability[];
}): string[] {
    const failedProviderNames = new Set(unique(input.failedProviderNames));
    const liveCapabilityRefs = new Set(input.providers
        .filter((provider) => !failedProviderNames.has(provider.providerName))
        .flatMap((provider) => unique(provider.capabilityRefs)));
    return unique(input.failedCapabilityRefs)
        .filter((capabilityRef) => !liveCapabilityRefs.has(capabilityRef));
}

export function filterRuntimeActionPlanCapabilityContext(input: {
    context: RuntimeActionPlanCapabilityContext;
    unavailableActionCapabilityRefs: readonly string[];
}): RuntimeActionPlanCapabilityContext {
    const unavailable = new Set(unique(input.unavailableActionCapabilityRefs));
    const activeActionCapabilityRefs = unique(input.context.activeActionCapabilityRefs)
        .filter((capabilityRef) => !unavailable.has(capabilityRef));
    const onDemandActionCapabilityRefs = unique(input.context.onDemandActionCapabilityRefs)
        .filter((capabilityRef) => !unavailable.has(capabilityRef));
    const remainingActionRefs = new Set([
        ...activeActionCapabilityRefs,
        ...onDemandActionCapabilityRefs
    ]);
    const originalActionRefs = new Set([
        ...input.context.activeActionCapabilityRefs,
        ...input.context.onDemandActionCapabilityRefs
    ]);
    const operationKindsByCapabilityRef = input.context.operationKindsByCapabilityRef;
    const providerNamesByCapabilityRef = input.context.providerNamesByCapabilityRef;
    return {
        discoveredCapabilityRefs: unique(input.context.discoveredCapabilityRefs)
            .filter((capabilityRef) => (
                !originalActionRefs.has(capabilityRef)
                || remainingActionRefs.has(capabilityRef)
            )),
        activeActionCapabilityRefs,
        onDemandActionCapabilityRefs,
        ...(operationKindsByCapabilityRef
            ? {
                operationKindsByCapabilityRef: Object.fromEntries(
                    Object.entries(operationKindsByCapabilityRef)
                        .filter(([capabilityRef]) => (
                            !originalActionRefs.has(capabilityRef)
                            || remainingActionRefs.has(capabilityRef)
                        ))
                        .map(([capabilityRef, operationKinds]) => [
                            capabilityRef,
                            unique(operationKinds || []) as typeof operationKinds
                        ])
                )
            }
            : {}),
        ...(providerNamesByCapabilityRef
            ? {
                providerNamesByCapabilityRef: Object.fromEntries(
                    Object.entries(providerNamesByCapabilityRef)
                        .filter(([capabilityRef]) => (
                            !originalActionRefs.has(capabilityRef)
                            || remainingActionRefs.has(capabilityRef)
                        ))
                        .map(([capabilityRef, providerNames]) => [
                            capabilityRef,
                            unique(providerNames || [])
                        ])
                )
            }
            : {})
    };
}

export function hasReadyRuntimeActionProvider(
    context: RuntimeActionPlanCapabilityContext
): boolean {
    return context.activeActionCapabilityRefs.length > 0
        || context.onDemandActionCapabilityRefs.length > 0;
}

export function supportsRuntimeActionRepairReadback(
    capabilityRefs: readonly string[],
    toolName?: string
): boolean {
    const capabilitySet = new Set(unique(capabilityRefs));
    const normalizedToolName = String(toolName || '').trim();
    if (!normalizedToolName) {
        return capabilitySet.has('photoshop.read.getVisualSnapshot')
            || capabilitySet.has('photoshop.read.getLayerBounds');
    }
    if (capabilitySet.has('photoshop.read.getVisualSnapshot')
        && (
            VISUAL_REPAIR_READBACK_TOOL_NAMES.has(normalizedToolName)
            || normalizedToolName === 'getAcceptanceSnapshot'
        )) {
        return true;
    }
    if (capabilitySet.has('photoshop.read.inspectLayers')
        && STRUCTURAL_REPAIR_READBACK_TOOL_NAMES.has(normalizedToolName)) {
        return true;
    }
    if (capabilitySet.has('photoshop.read.getDocumentSummary')
        && DOCUMENT_SUMMARY_REPAIR_READBACK_TOOL_NAMES.has(normalizedToolName)) {
        return true;
    }
    return capabilitySet.has('photoshop.read.getLayerBounds')
        && BOUNDS_REPAIR_READBACK_TOOL_NAMES.has(normalizedToolName);
}

export function resolveRuntimeActionProviderFailureDisposition(input: {
    mutationProofObserved: boolean;
    hasReadyReplacementProvider: boolean;
}): RuntimeActionProviderFailureDisposition {
    if (input.mutationProofObserved) return 'readback_required';
    if (input.hasReadyReplacementProvider) return 'replan';
    return 'stop';
}

export function resolveRuntimeActionMutationReadbackDisposition(input: {
    mutationAfter: PhotoshopHistoryStateRef;
    toolActionCompleted: boolean;
    readback?: PhotoshopHistoryStateRef;
    readbackContent?: RuntimeActionRepairReadbackContent;
}): RuntimeActionMutationReadbackDisposition {
    if (!input.readback
        || input.readback.documentId !== input.mutationAfter.documentId
        || input.readbackContent?.contentSufficient !== true) {
        return 'readback_required';
    }
    if (input.toolActionCompleted
        && input.readback.historyStateId === input.mutationAfter.historyStateId) {
        return 'verified_complete';
    }
    return 'replan_repair';
}
