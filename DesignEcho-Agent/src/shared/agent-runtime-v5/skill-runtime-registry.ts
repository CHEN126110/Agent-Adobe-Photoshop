/**
 * Skill Runtime Manifest Registry core.
 *
 * This module owns only immutable registry composition and identity resolution.
 * Built-in or product-specific manifests are supplied by the composition root;
 * no manifest registers itself through import side effects.
 */

import type { SkillRuntimeManifest } from './contracts';

export interface ResolveSkillRuntimeManifestSelectionInput {
    skillId?: string;
    taskType?: string;
}

export type SkillRuntimeManifestSelectionStatus =
    | 'none'
    | 'resolved'
    | 'unresolved_task_type'
    | 'conflict';

/**
 * R0 的统一 Manifest 身份解析结果。
 *
 * - artifact-owner 决定交付物身份；
 * - method 只叠加方法输入、来源引用和检查项；
 * - 两个不同 artifact-owner 不允许按调用方各自的优先级静默拆开消费。
 */
export interface SkillRuntimeManifestSelection {
    status: SkillRuntimeManifestSelectionStatus;
    skillManifest?: SkillRuntimeManifest;
    taskTypeManifest?: SkillRuntimeManifest;
    artifactManifest?: SkillRuntimeManifest;
    methodManifests: SkillRuntimeManifest[];
    manifests: SkillRuntimeManifest[];
    conflictReason?: 'artifact_manifest_conflict';
    unresolvedTaskType?: string;
}

/**
 * 不可变 Manifest 集合及其纯查询边界。
 *
 * Registry 在创建时复制并冻结成员列表；它没有动态注册入口，因而不依赖模块加载顺序。
 * Manifest 正文仍由各 package 自己拥有，本层不会改写或深冻结调用方数据。
 */
export interface SkillRuntimeRegistry {
    readonly manifests: readonly SkillRuntimeManifest[];
    getManifestBySkillId(skillId?: string): SkillRuntimeManifest | undefined;
    getManifestByTaskType(taskType?: string): SkillRuntimeManifest | undefined;
    getManifestByLegacySkillId(skillId?: string): SkillRuntimeManifest | undefined;
    resolveManifestSelection(
        input: ResolveSkillRuntimeManifestSelectionInput
    ): SkillRuntimeManifestSelection;
}

function normalizeKey(value: unknown): string {
    return String(value || '').trim();
}

function buildUniqueManifestIndex(
    label: string,
    entries: Array<{ key: string; manifest: SkillRuntimeManifest }>
): ReadonlyMap<string, SkillRuntimeManifest> {
    const index = new Map<string, SkillRuntimeManifest>();
    entries.forEach(({ key, manifest }) => {
        const normalized = normalizeKey(key);
        if (!normalized) return;
        const existing = index.get(normalized);
        if (existing && existing.skill_id !== manifest.skill_id) {
            throw new Error(
                `Skill manifest ${label} 重复: ${normalized} 同时属于 ${existing.skill_id} 与 ${manifest.skill_id}`
            );
        }
        index.set(normalized, manifest);
    });
    return index;
}

function isMethodManifest(manifest: SkillRuntimeManifest): boolean {
    return manifest.planning_role === 'method';
}

function uniqueManifests(manifests: Array<SkillRuntimeManifest | undefined>): SkillRuntimeManifest[] {
    const uniqueById = new Map<string, SkillRuntimeManifest>();
    manifests.forEach((manifest) => {
        if (manifest) uniqueById.set(manifest.skill_id, manifest);
    });
    return Array.from(uniqueById.values());
}

function skillRoutesToTaskTypeVariant(
    skillManifest: SkillRuntimeManifest | undefined,
    taskTypeManifest: SkillRuntimeManifest | undefined
): boolean {
    if (!skillManifest || !taskTypeManifest) return false;
    if (skillManifest.skill_id === taskTypeManifest.skill_id) return false;
    return (skillManifest.task_type_variants || []).includes(taskTypeManifest.task_type);
}

export function createSkillRuntimeRegistry(
    sourceManifests: readonly SkillRuntimeManifest[]
): SkillRuntimeRegistry {
    const manifests = Object.freeze([...sourceManifests]);
    const manifestBySkillId = buildUniqueManifestIndex(
        'skill_id',
        manifests.map((manifest) => ({ key: manifest.skill_id, manifest }))
    );
    const manifestByTaskType = buildUniqueManifestIndex(
        'task_type',
        manifests.map((manifest) => ({ key: manifest.task_type, manifest }))
    );
    const manifestByLegacySkillId = buildUniqueManifestIndex(
        'legacy_skill_id',
        manifests.flatMap((manifest) => (
            (manifest.legacy_skill_ids || []).map((key) => ({ key, manifest }))
        ))
    );

    function getManifestBySkillId(skillId?: string): SkillRuntimeManifest | undefined {
        return manifestBySkillId.get(normalizeKey(skillId));
    }

    function getManifestByTaskType(taskType?: string): SkillRuntimeManifest | undefined {
        return manifestByTaskType.get(normalizeKey(taskType));
    }

    function getManifestByLegacySkillId(skillId?: string): SkillRuntimeManifest | undefined {
        return manifestByLegacySkillId.get(normalizeKey(skillId));
    }

    function resolveManifestSelection(
        input: ResolveSkillRuntimeManifestSelectionInput
    ): SkillRuntimeManifestSelection {
        const skillId = normalizeKey(input.skillId);
        const taskType = normalizeKey(input.taskType);
        const skillManifest = getManifestBySkillId(skillId) || getManifestByLegacySkillId(skillId);
        const taskTypeManifest = getManifestByTaskType(taskType);

        // 结构化 taskType 一旦出现就是权威身份；未知值不能回退到另一个 Skill 猜测。
        if (taskType && !taskTypeManifest) {
            return {
                status: 'unresolved_task_type',
                skillManifest,
                methodManifests: [],
                manifests: [],
                unresolvedTaskType: taskType
            };
        }

        // 一个用户级 Skill 可以按结构化 task_type 选择内部交付物方法。此时 taskType 是
        // 已声明的权威 artifact owner，入口 Skill 只负责路由，不能制造第二个 owner 冲突。
        const taskTypeOwnsVariant = skillRoutesToTaskTypeVariant(skillManifest, taskTypeManifest);
        const candidates = taskTypeOwnsVariant
            ? uniqueManifests([taskTypeManifest])
            : uniqueManifests([skillManifest, taskTypeManifest]);
        if (candidates.length === 0) {
            return {
                status: 'none',
                methodManifests: [],
                manifests: []
            };
        }

        const artifactManifests = candidates.filter((manifest) => !isMethodManifest(manifest));
        const methodManifests = candidates.filter(isMethodManifest);
        if (artifactManifests.length > 1) {
            return {
                status: 'conflict',
                skillManifest,
                taskTypeManifest,
                methodManifests,
                manifests: candidates,
                conflictReason: 'artifact_manifest_conflict'
            };
        }
        return {
            status: 'resolved',
            skillManifest,
            taskTypeManifest,
            artifactManifest: artifactManifests[0],
            methodManifests,
            manifests: uniqueManifests([artifactManifests[0], ...methodManifests])
        };
    }

    return Object.freeze({
        manifests,
        getManifestBySkillId,
        getManifestByTaskType,
        getManifestByLegacySkillId,
        resolveManifestSelection
    });
}
