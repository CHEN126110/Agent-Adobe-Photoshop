/**
 * Skill Runtime（§6.2）
 *
 * Skill = 任务能力定义（manifest），不是代码页面、不是脚本。
 * R0 通过 task_type 找到 manifest，按 manifest.runtime_stages 驱动工作流。
 * 新增一个 skill = 新增一个 manifest，不改 Orchestrator 核心。
 */

import {
    RUNTIME_DESIGN_WORK_MODES,
    type RuntimeDesignWorkMode,
    type SkillRuntimeManifest,
    type SkillRuntimeWorkModeContract
} from './contracts';
import { DETAIL_PAGE_MANIFEST } from './manifests/detail-page.manifest';
import { GENERAL_DESIGN_MANIFEST } from './manifests/general-design.manifest';
import { MAIN_IMAGE_MANIFEST } from './manifests/main-image.manifest';
import { REFERENCE_REPLICATION_MANIFEST } from './manifests/reference-replication.manifest';
import { SINGLE_CANVAS_VISUAL_MANIFEST } from './manifests/single-canvas-visual.manifest';
import { SKU_COLOR_CARD_MANIFEST } from './manifests/sku-color-card.manifest';
import { SKU_BATCH_MANIFEST } from './manifests/sku-batch.manifest';
import { SKU_TEMPLATE_MANIFEST } from './manifests/sku-template.manifest';
import {
    createSkillRuntimeRegistry,
    type ResolveSkillRuntimeManifestSelectionInput,
    type SkillRuntimeManifestSelection,
    type SkillRuntimeManifestSelectionStatus,
    type SkillRuntimeRegistry
} from './skill-runtime-registry';

const BUILT_IN_SKILL_MANIFESTS: readonly SkillRuntimeManifest[] = Object.freeze([
    GENERAL_DESIGN_MANIFEST,
    DETAIL_PAGE_MANIFEST,
    MAIN_IMAGE_MANIFEST,
    SINGLE_CANVAS_VISUAL_MANIFEST,
    REFERENCE_REPLICATION_MANIFEST,
    SKU_COLOR_CARD_MANIFEST,
    SKU_BATCH_MANIFEST,
    SKU_TEMPLATE_MANIFEST
]);

const DEFAULT_SKILL_RUNTIME_REGISTRY = createSkillRuntimeRegistry(BUILT_IN_SKILL_MANIFESTS);

export { createSkillRuntimeRegistry };
export type {
    ResolveSkillRuntimeManifestSelectionInput,
    SkillRuntimeManifestSelection,
    SkillRuntimeManifestSelectionStatus,
    SkillRuntimeRegistry
};

function normalizeKey(value: unknown): string {
    return String(value || '').trim();
}

/**
 * 该 manifest 是否走「agentic」执行模型（开放创意路径：不建 Stage 机、不以声明作写入门票）。
 * 未声明 execution_model 一律按 'staged' 处理，避免静默改变既有生产任务的行为。
 */
export function isAgenticExecutionModel(manifest: SkillRuntimeManifest | undefined): boolean {
    return manifest?.execution_model === 'agentic';
}

export interface SkillRuntimeEffectiveContract extends SkillRuntimeWorkModeContract {
    source: 'manifest-default' | 'work-mode-contract';
    workMode?: RuntimeDesignWorkMode;
}

export function normalizeRuntimeDesignWorkMode(value: unknown): RuntimeDesignWorkMode | undefined {
    const normalized = normalizeKey(value) as RuntimeDesignWorkMode;
    return RUNTIME_DESIGN_WORK_MODES.includes(normalized) ? normalized : undefined;
}

/**
 * 解析 artifact work-mode 拥有的 Capability 硬上限。
 *
 * 返回 undefined 表示该模式沿用 Manifest 的开放式按需能力；返回数组时，调用方必须
 * 在 Capability id 层做 allow-membership，不能转换成 provider Tool deny closure。
 */
export function resolveSkillRuntimeCapabilityCeiling(
    manifest: SkillRuntimeManifest | undefined,
    workMode?: unknown
): string[] | undefined {
    const normalizedWorkMode = normalizeRuntimeDesignWorkMode(workMode);
    if (!manifest || !normalizedWorkMode) return undefined;
    const ceiling = manifest.work_mode_contracts?.[normalizedWorkMode]?.capability_ceiling;
    if (!ceiling) return undefined;
    return Array.from(new Set(ceiling.map(normalizeKey).filter(Boolean)));
}

/** 解析当前模式的首轮最小 Capability seed；未声明模式 seed 时沿用 Manifest 默认种子。 */
export function resolveSkillRuntimeInitialCapabilities(
    manifest: SkillRuntimeManifest | undefined,
    workMode?: unknown
): string[] | undefined {
    if (!manifest) return undefined;
    const normalizedWorkMode = normalizeRuntimeDesignWorkMode(workMode);
    const modeSeed = normalizedWorkMode
        ? manifest.work_mode_contracts?.[normalizedWorkMode]?.initial_capabilities
        : undefined;
    const source = modeSeed || manifest.available_tools;
    return Array.from(new Set(source.map(normalizeKey).filter(Boolean)));
}

export function listSkillManifests(): readonly SkillRuntimeManifest[] {
    return DEFAULT_SKILL_RUNTIME_REGISTRY.manifests;
}

export function getManifestBySkillId(skillId?: string): SkillRuntimeManifest | undefined {
    return DEFAULT_SKILL_RUNTIME_REGISTRY.getManifestBySkillId(skillId);
}

export function getManifestByTaskType(taskType?: string): SkillRuntimeManifest | undefined {
    return DEFAULT_SKILL_RUNTIME_REGISTRY.getManifestByTaskType(taskType);
}

export function getManifestByLegacySkillId(skillId?: string): SkillRuntimeManifest | undefined {
    return DEFAULT_SKILL_RUNTIME_REGISTRY.getManifestByLegacySkillId(skillId);
}

export function resolveSkillRuntimeManifestSelection(
    input: ResolveSkillRuntimeManifestSelectionInput
): SkillRuntimeManifestSelection {
    return DEFAULT_SKILL_RUNTIME_REGISTRY.resolveManifestSelection(input);
}

export function resolveSkillRuntimeEffectiveContract(
    manifest: SkillRuntimeManifest,
    workMode?: unknown
): SkillRuntimeEffectiveContract {
    const normalizedWorkMode = normalizeRuntimeDesignWorkMode(workMode);
    const modeContract = normalizedWorkMode
        ? manifest.work_mode_contracts?.[normalizedWorkMode]
        : undefined;
    if (modeContract && normalizedWorkMode) {
        return {
            source: 'work-mode-contract',
            workMode: normalizedWorkMode,
            required_inputs: [...modeContract.required_inputs],
            optional_inputs: [...modeContract.optional_inputs],
            delivery_outputs: [...modeContract.delivery_outputs],
            ...(modeContract.delivery_output_bindings
                ? {
                    delivery_output_bindings: Object.fromEntries(
                        Object.entries(modeContract.delivery_output_bindings).map(([outputRef, binding]) => [
                            outputRef,
                            {
                                ...binding,
                                capability_refs: [...binding.capability_refs]
                            }
                        ])
                    )
                }
                : {}),
            ...(modeContract.production_obligation
                ? { production_obligation: modeContract.production_obligation }
                : {}),
            ...(modeContract.delivery_plan_binding_required === true
                ? { delivery_plan_binding_required: true }
                : {}),
            exit_criteria: [...modeContract.exit_criteria],
            ...(modeContract.review_rubric_ref
                ? { review_rubric_ref: modeContract.review_rubric_ref }
                : {}),
            ...(modeContract.performance_profile
                ? { performance_profile: modeContract.performance_profile }
                : {}),
            ...(modeContract.execution_scope_kind
                ? { execution_scope_kind: modeContract.execution_scope_kind }
                : {}),
            ...(modeContract.initial_capabilities
                ? { initial_capabilities: [...modeContract.initial_capabilities] }
                : {}),
            ...(modeContract.capability_ceiling
                ? { capability_ceiling: [...modeContract.capability_ceiling] }
                : {}),
            ...(modeContract.runtime_stages
                ? { runtime_stages: [...modeContract.runtime_stages] }
                : {})
        };
    }
    return {
        source: 'manifest-default',
        required_inputs: [...manifest.required_inputs],
        optional_inputs: [...(manifest.optional_inputs || [])],
        delivery_outputs: [...(manifest.delivery_outputs || [])],
        ...(manifest.delivery_output_bindings
            ? {
                delivery_output_bindings: Object.fromEntries(
                    Object.entries(manifest.delivery_output_bindings).map(([outputRef, binding]) => [
                        outputRef,
                        {
                            ...binding,
                            capability_refs: [...binding.capability_refs]
                        }
                    ])
                )
            }
            : {}),
        ...(manifest.production_obligation
            ? { production_obligation: manifest.production_obligation }
            : {}),
        ...(manifest.delivery_plan_binding_required === true
            ? { delivery_plan_binding_required: true }
            : {}),
        exit_criteria: [...manifest.exit_criteria],
        ...(manifest.review_rubric_ref ? { review_rubric_ref: manifest.review_rubric_ref } : {})
    };
}

export function listSkillRuntimeWorkModeInputKeys(manifest: SkillRuntimeManifest): string[] {
    return Array.from(new Set([
        ...manifest.required_inputs,
        ...(manifest.optional_inputs || []),
        ...Object.values(manifest.work_mode_contracts || {}).flatMap((contract) => (
            contract ? [...contract.required_inputs, ...contract.optional_inputs] : []
        ))
    ].map((value) => normalizeKey(value)).filter(Boolean)));
}
