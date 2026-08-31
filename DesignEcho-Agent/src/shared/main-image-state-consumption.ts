import type {
    DesignProjectState,
    DesignProjectStatePatch
} from './types/design-project-state.types';
import type { MainImageReferenceHint } from './main-image-project-style-strategy';
import {
    buildDesignProjectFactProvenanceSummary,
    canDesignProjectFactSupportEvaluation,
    listDesignProjectFactRecords
} from './design-project-fact-provenance';

export type MainImageStateVersionAction = 'strategy' | 'execute' | 'export';

export interface MainImageCompositionVersion {
    id: string;
    name: string;
    imageType: 'click' | 'conversion' | 'main-image';
    objective: string;
    mainCopy: string;
    supportingPoints: string[];
    visualDirection: string;
    layoutIntent: string;
    sourceContext: string[];
}

export interface MainImageStateContext {
    projectStateAvailable: boolean;
    targetUser: string;
    visualDirection: string;
    brandStyle: string;
    copyCandidates: string[];
    referenceHints: MainImageReferenceHint[];
    compositionVersions: MainImageCompositionVersion[];
    compositionStatus: 'pending_agent_declaration';
    confirmedProductFacts: string[];
    confirmedSellingPoints: string[];
    sourceSummary: {
        copywritingCount: number;
        sellingPointCount: number;
        painPointCount: number;
        hasVisualDirection: boolean;
        confirmedFactCount: number;
        pendingFactCount: number;
    };
}

export interface MainImageStateContextInput {
    state?: DesignProjectState | null;
    imageType?: string;
    /** 兼容旧调用方；数量不能再触发 Harness 自动生成设计版本。 */
    requestedVersionCount?: number;
}

export interface MainImageStateVersionPatchInput {
    action: MainImageStateVersionAction;
    compositionVersions?: MainImageCompositionVersion[];
    selectedVersionId?: string;
    reason?: string;
    exportedFileCount?: number;
}

function cleanText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueClean(values: unknown, limit = 12): string[] {
    if (!Array.isArray(values)) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const text = cleanText(value);
        if (!text || seen.has(text)) continue;
        seen.add(text);
        result.push(text);
        if (result.length >= limit) break;
    }
    return result;
}

export function buildMainImageStateContext(input: MainImageStateContextInput): MainImageStateContext {
    const state = input.state || null;
    const factRecords = listDesignProjectFactRecords(state, { includeLegacy: false });
    const confirmedFacts = factRecords.filter(canDesignProjectFactSupportEvaluation);
    const confirmedProductFacts = uniqueClean(confirmedFacts
        .filter((fact) => fact.claimType === 'product_fact')
        .map((fact) => fact.statement), 8);
    const confirmedSellingPoints = uniqueClean(confirmedFacts
        .filter((fact) => fact.claimType === 'selling_point')
        .map((fact) => fact.statement), 8);
    const factSummary = buildDesignProjectFactProvenanceSummary(state);

    return {
        projectStateAvailable: Boolean(state),
        targetUser: '',
        visualDirection: '',
        brandStyle: '',
        copyCandidates: [],
        referenceHints: [],
        compositionVersions: [],
        compositionStatus: 'pending_agent_declaration',
        confirmedProductFacts,
        confirmedSellingPoints,
        sourceSummary: {
            copywritingCount: 0,
            sellingPointCount: confirmedSellingPoints.length,
            painPointCount: 0,
            hasVisualDirection: false,
            confirmedFactCount: factSummary.userConfirmed + factSummary.sourceSupported,
            pendingFactCount: factSummary.needsReview
        }
    };
}

export function mergeMainImageStateCopyCandidates(
    currentCandidates: unknown,
    stateContext: MainImageStateContext | null | undefined,
    limit = 5
): string[] {
    return uniqueClean([
        ...uniqueClean(currentCandidates, limit),
        ...(stateContext?.copyCandidates || [])
    ], limit);
}

export function mergeMainImageStateReferenceHints(
    currentHints: unknown,
    stateContext: MainImageStateContext | null | undefined,
    limit = 8
): MainImageReferenceHint[] {
    const existing = Array.isArray(currentHints) ? currentHints : [];
    const merged = [
        ...existing,
        ...(stateContext?.referenceHints || [])
    ];
    const seen = new Set<string>();
    const result: MainImageReferenceHint[] = [];
    for (const hint of merged) {
        const record = hint as MainImageReferenceHint;
        const key = [
            cleanText(record.title),
            cleanText(record.source),
            cleanText(record.url),
            cleanText(record.note)
        ].filter(Boolean).join('|');
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push(record);
        if (result.length >= limit) break;
    }
    return result;
}

function formatActionLabel(action: MainImageStateVersionAction): string {
    switch (action) {
        case 'execute':
            return '主图执行';
        case 'export':
            return '主图导出';
        default:
            return '主图策略记录';
    }
}

export function buildMainImageStateVersionPatch(input: MainImageStateVersionPatchInput): DesignProjectStatePatch | null {
    const versions = Array.isArray(input.compositionVersions) ? input.compositionVersions : [];
    const selected = input.selectedVersionId
        ? versions.find((version) => version.id === input.selectedVersionId)
        : undefined;
    const reasonParts = [
        formatActionLabel(input.action),
        versions.length > 0 ? `候选 ${versions.length} 个` : '',
        selected?.name ? `选用 ${selected.name}` : '',
        cleanText(input.reason),
        Number(input.exportedFileCount || 0) > 0 ? `导出 ${Number(input.exportedFileCount)} 个文件` : ''
    ].filter(Boolean);
    if (reasonParts.length === 0) return null;
    return {
        appendVersion: {
            reason: reasonParts.join('；')
        },
        updatedBy: 'main-image-design'
    };
}
