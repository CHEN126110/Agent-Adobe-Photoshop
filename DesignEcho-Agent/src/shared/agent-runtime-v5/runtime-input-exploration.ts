/**
 * Runtime input exploration
 *
 * Manifest 只声明输入可以来自哪里；本模块把“环境来源”投影为已经授权的只读
 * Capability。它不理解业务品类、不选择具体 Tool，也不授予写权限。
 */

import type {
    SkillRuntimeInputSourceKind,
    SkillRuntimeInputSourceMap
} from './contracts';

export type RuntimeInputObservationToolKind = 'read_only_observation' | 'knowledge_search';

export interface RuntimeInputExplorationRequest {
    sourceKinds: SkillRuntimeInputSourceKind[];
    capabilityIds: string[];
    toolKinds: RuntimeInputObservationToolKind[];
    photoshopObservationOnly: boolean;
}

export interface ResolveRuntimeInputExplorationRequestInput {
    missingInputKeys: readonly string[];
    inputSources: SkillRuntimeInputSourceMap;
    activeCapabilityIds: readonly string[];
}

const SOURCE_CAPABILITY_IDS: Readonly<
    Partial<Record<SkillRuntimeInputSourceKind, readonly string[]>>
> = Object.freeze({
    photoshop_document: [
        'photoshop.read.getDocumentSummary',
        'photoshop.read.getVisualSnapshot'
    ],
    photoshop_target: [
        'photoshop.read.inspectLayers',
        'photoshop.read.getVisualSnapshot',
        'photoshop.read.getDocumentSummary'
    ],
    project_asset: [
        'project.searchResources',
        'project.listResources'
    ],
    selected_project_asset: [
        'project.searchResources',
        'project.listResources'
    ],
    project_product: [
        'project.observeAssets',
        'project.searchResources',
        'project.listResources',
        'memory.designProjectState'
    ],
    project_sku: [
        'project.searchResources',
        'project.listResources',
        'memory.designProjectState'
    ],
    project_template: [
        'project.searchResources',
        'project.listResources'
    ],
    project_context: [
        'memory.designProjectState',
        'project.searchResources',
        'project.listResources'
    ]
});

const SOURCE_TOOL_KIND: Readonly<
    Partial<Record<SkillRuntimeInputSourceKind, RuntimeInputObservationToolKind>>
> = Object.freeze({
    photoshop_document: 'read_only_observation',
    photoshop_target: 'read_only_observation',
    project_asset: 'read_only_observation',
    selected_project_asset: 'read_only_observation',
    project_product: 'read_only_observation',
    project_sku: 'read_only_observation',
    project_template: 'read_only_observation',
    project_context: 'read_only_observation'
});

function unique<T>(values: readonly T[]): T[] {
    return Array.from(new Set(values));
}

/**
 * 只返回当前 Stage 已拥有的 Capability。来源缺失不能成为偷偷扩权的理由。
 */
export function resolveRuntimeInputExplorationRequest(
    input: ResolveRuntimeInputExplorationRequestInput
): RuntimeInputExplorationRequest {
    const activeCapabilityIds = new Set(input.activeCapabilityIds);
    const sourceKinds = unique(input.missingInputKeys.flatMap((inputKey) => (
        input.inputSources[inputKey] || []
    )));
    const capabilityIds = unique(sourceKinds.flatMap((sourceKind) => (
        SOURCE_CAPABILITY_IDS[sourceKind] || []
    ))).filter((capabilityId) => activeCapabilityIds.has(capabilityId));
    const toolKinds = unique(sourceKinds.flatMap((sourceKind) => {
        const toolKind = SOURCE_TOOL_KIND[sourceKind];
        return toolKind ? [toolKind] : [];
    }));
    return {
        sourceKinds,
        capabilityIds,
        toolKinds,
        photoshopObservationOnly: toolKinds.length === 1
            && toolKinds[0] === 'read_only_observation'
            && sourceKinds.every((sourceKind) => (
                sourceKind === 'photoshop_document'
                || sourceKind === 'photoshop_target'
                || !SOURCE_TOOL_KIND[sourceKind]
            ))
    };
}
