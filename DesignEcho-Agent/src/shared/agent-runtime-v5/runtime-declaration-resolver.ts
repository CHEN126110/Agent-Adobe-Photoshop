/**
 * Runtime declaration resolver。
 *
 * 这里只解析结构化 taskType / workMode / skillId，不读取自然语言、不授予权限、
 * 不执行 Tool。可声明目录完全由已注册 Manifest 与评价 Profile 派生，避免调用方
 * 再维护一份 taskType × workMode 笛卡尔积。
 */

import {
    RUNTIME_DESIGN_WORK_MODES,
    type RuntimeDesignWorkMode,
    type SkillRuntimeManifest,
    type SkillRuntimeWorkModeContract
} from './contracts';
import {
    getDesignEvaluationProfileById,
    isDesignEvaluationProfileApplicableToTask,
    validateDesignEvaluationProfile
} from './design-evaluation-profiles';
import {
    buildRuntimeContractBundleForAgentTask,
    type AgentTaskRuntimeContractBundle
} from './runtime-contract-bundle';
import { validateManifestToolSkillBoundary } from './reflexion-contract';
import {
    getManifestByLegacySkillId,
    getManifestBySkillId,
    getManifestByTaskType,
    listSkillManifests,
    normalizeRuntimeDesignWorkMode,
    resolveSkillRuntimeManifestSelection
} from './skill-runtime';

export const RUNTIME_DECLARATION_PROFILE_CATALOG_VERSION =
    'runtime-declaration-profile-catalog/v0' as const;

export type RuntimeDeclarationModePolicy = 'none' | 'required';

export type RuntimeDeclarationProfileIssueCode =
    | 'manifest_boundary_invalid'
    | 'performance_profile_missing'
    | 'production_obligation_missing'
    | 'production_obligation_incompatible'
    | 'evaluation_profile_missing'
    | 'evaluation_profile_invalid'
    | 'evaluation_profile_identity_mismatch'
    | 'scoped_edit_contract_incomplete'
    | 'analyze_only_contract_not_read_only'
    | 'export_only_contract_not_delivery_only';

export interface RuntimeDeclarationProfileIssue {
    code: RuntimeDeclarationProfileIssueCode;
    path: string;
}

export interface RuntimeDeclarationProfile {
    profileId: string;
    skillId: string;
    taskType: string;
    displayName: string;
    modePolicy: RuntimeDeclarationModePolicy;
    workMode?: RuntimeDesignWorkMode;
    reviewRubricRef: string;
}

export interface RuntimeDeclarationBlockedProfile extends RuntimeDeclarationProfile {
    issues: RuntimeDeclarationProfileIssue[];
}

export interface RuntimeDeclarationProfileCatalog {
    version: typeof RUNTIME_DECLARATION_PROFILE_CATALOG_VERSION;
    declarableProfiles: RuntimeDeclarationProfile[];
    blockedProfiles: RuntimeDeclarationBlockedProfile[];
    excludedMethodTaskTypes: string[];
}

/**
 * 一个用户级 workflow entry 可供 Agent 声明的 Artifact Profile family。
 *
 * workflow entry 只是选择手柄；taskType 与 workMode 才组成真正的 Runtime Profile。
 * legacy id 和 method Manifest 不参与这个投影，blocked Profile 也不会被提示给模型。
 */
export interface RuntimeWorkflowEntryDeclarationFamily {
    workflowEntrySkillId: string;
    taskType: string;
    supportedWorkModes: RuntimeDesignWorkMode[];
    profileIds: string[];
}

export interface ResolveRuntimeDeclarationInput {
    taskType?: unknown;
    workMode?: unknown;
    skillId?: unknown;
    executableToolNames: readonly string[];
}

export type RuntimeDeclarationRepairCode =
    | 'task_type_missing'
    | 'task_type_unregistered'
    | 'task_type_not_declarable'
    | 'skill_id_unregistered'
    | 'artifact_identity_conflict'
    | 'work_mode_required'
    | 'work_mode_invalid'
    | 'work_mode_not_applicable'
    | 'work_mode_unsupported';

export type RuntimeDeclarationConfigurationErrorCode =
    | 'runtime_profile_not_declarable'
    | 'runtime_profile_missing_from_catalog'
    | 'runtime_bundle_invalid';

export type RuntimeDeclarationResolution =
    | {
        status: 'resolved';
        canonicalDeclaration: {
            taskType: string;
            workMode?: RuntimeDesignWorkMode;
        };
        profile: RuntimeDeclarationProfile;
        bundle: AgentTaskRuntimeContractBundle;
    }
    | {
        status: 'repair_required';
        code: RuntimeDeclarationRepairCode;
        requestedTaskType?: string;
        requestedWorkMode?: string;
        requestedSkillId?: string;
        declarableTaskTypes: string[];
        supportedWorkModes: RuntimeDesignWorkMode[];
    }
    | {
        status: 'configuration_error';
        code: RuntimeDeclarationConfigurationErrorCode;
        profileId?: string;
        issues: RuntimeDeclarationProfileIssue[];
    };

const CONTENT_WRITE_CAPABILITY_PREFIXES = Object.freeze([
    'photoshop.apply.',
    'photoshop.sandbox.',
    'photoshop.write.'
]);

function normalize(value: unknown): string {
    return String(value || '').trim();
}

function unique(values: readonly string[]): string[] {
    return Array.from(new Set(values.map(normalize).filter(Boolean)));
}

function buildProfileId(taskType: string, workMode?: RuntimeDesignWorkMode): string {
    return `${taskType}#${workMode || 'default'}`;
}

function listManifestWorkModes(manifest: SkillRuntimeManifest): RuntimeDesignWorkMode[] {
    const contracts = manifest.work_mode_contracts || {};
    return RUNTIME_DESIGN_WORK_MODES.filter((workMode) => Boolean(contracts[workMode]));
}

function containsContentWriteCapability(capabilityIds: readonly string[]): boolean {
    return capabilityIds.some((capabilityId) => (
        CONTENT_WRITE_CAPABILITY_PREFIXES.some((prefix) => capabilityId.startsWith(prefix))
    ));
}

function resolveReviewRubricRef(
    manifest: SkillRuntimeManifest,
    workMode?: RuntimeDesignWorkMode
): string {
    if (workMode) {
        const modeRef = normalize(manifest.work_mode_contracts?.[workMode]?.review_rubric_ref);
        if (modeRef) return modeRef;
    }
    return normalize(manifest.review_rubric_ref);
}

function inspectEvaluationProfile(
    manifest: SkillRuntimeManifest,
    reviewRubricRef: string
): RuntimeDeclarationProfileIssue[] {
    const profile = getDesignEvaluationProfileById(reviewRubricRef);
    if (!profile) {
        return [{
            code: 'evaluation_profile_missing',
            path: 'review_rubric_ref'
        }];
    }
    const issues: RuntimeDeclarationProfileIssue[] = [];
    if (!validateDesignEvaluationProfile(profile).valid) {
        issues.push({
            code: 'evaluation_profile_invalid',
            path: `evaluation_profile:${profile.profileId}`
        });
    }
    if (!isDesignEvaluationProfileApplicableToTask(profile, {
        skillId: manifest.skill_id,
        taskType: manifest.task_type
    })) {
        issues.push({
            code: 'evaluation_profile_identity_mismatch',
            path: `evaluation_profile:${profile.profileId}`
        });
    }
    return issues;
}

function inspectScopedEditContract(
    contract: SkillRuntimeWorkModeContract
): RuntimeDeclarationProfileIssue[] {
    const complete = contract.production_obligation === 'photoshop_mutation_with_readback'
        && contract.execution_scope_kind === 'exact_text_replacement'
        && Boolean(contract.runtime_stages?.length)
        && Boolean(contract.initial_capabilities?.length)
        && Boolean(contract.capability_ceiling?.length);
    return complete
        ? []
        : [{ code: 'scoped_edit_contract_incomplete', path: 'work_mode_contracts.edit_existing' }];
}

function inspectProductionContract(
    workMode: 'create_new' | 'redesign' | 'template_fill',
    contract: SkillRuntimeWorkModeContract
): RuntimeDeclarationProfileIssue[] {
    return contract.production_obligation === 'photoshop_mutation_with_readback'
        ? []
        : [{
            code: 'production_obligation_missing',
            path: `work_mode_contracts.${workMode}.production_obligation`
        }];
}

function inspectDefaultProductionContract(
    manifest: SkillRuntimeManifest
): RuntimeDeclarationProfileIssue[] {
    if (!manifest.production_obligation) {
        return [{
            code: 'production_obligation_missing',
            path: 'production_obligation'
        }];
    }
    const exposesContentProduction = manifest.runtime_stages.includes('E1')
        && containsContentWriteCapability(manifest.available_tools);
    const expectedObligation = exposesContentProduction
        ? 'photoshop_mutation_with_readback'
        : 'none';
    return manifest.production_obligation === expectedObligation
        ? []
        : [{
            code: 'production_obligation_incompatible',
            path: 'production_obligation'
        }];
}

function inspectAnalyzeOnlyContract(
    contract: SkillRuntimeWorkModeContract
): RuntimeDeclarationProfileIssue[] {
    const ceiling = contract.capability_ceiling || [];
    const readOnly = contract.production_obligation === 'none'
        && Boolean(contract.runtime_stages?.length)
        && ceiling.length > 0
        && !containsContentWriteCapability(ceiling)
        && !ceiling.some((capabilityId) => capabilityId.startsWith('delivery.'));
    return readOnly
        ? []
        : [{ code: 'analyze_only_contract_not_read_only', path: 'work_mode_contracts.analyze_only' }];
}

function inspectExportOnlyContract(
    contract: SkillRuntimeWorkModeContract
): RuntimeDeclarationProfileIssue[] {
    const ceiling = contract.capability_ceiling || [];
    const bindingCapabilities = Object.values(contract.delivery_output_bindings || {})
        .flatMap((binding) => binding.capability_refs);
    const deliveryOnly = contract.production_obligation === 'none'
        && Boolean(contract.runtime_stages?.length)
        && ceiling.length > 0
        && !containsContentWriteCapability(ceiling)
        && bindingCapabilities.length > 0
        && bindingCapabilities.every((capabilityId) => ceiling.includes(capabilityId));
    return deliveryOnly
        ? []
        : [{ code: 'export_only_contract_not_delivery_only', path: 'work_mode_contracts.export_only' }];
}

function inspectWorkModeContract(
    workMode: RuntimeDesignWorkMode | undefined,
    contract: SkillRuntimeWorkModeContract | undefined
): RuntimeDeclarationProfileIssue[] {
    if (!workMode || !contract) return [];
    switch (workMode) {
        case 'edit_existing':
            return inspectScopedEditContract(contract);
        case 'analyze_only':
            return inspectAnalyzeOnlyContract(contract);
        case 'export_only':
            return inspectExportOnlyContract(contract);
        case 'create_new':
        case 'redesign':
        case 'template_fill':
            return inspectProductionContract(workMode, contract);
    }
}

function buildProfile(
    manifest: SkillRuntimeManifest,
    workMode?: RuntimeDesignWorkMode
): RuntimeDeclarationProfile {
    return {
        profileId: buildProfileId(manifest.task_type, workMode),
        skillId: manifest.skill_id,
        taskType: manifest.task_type,
        displayName: normalize(manifest.display_name) || manifest.task_type,
        modePolicy: workMode ? 'required' : 'none',
        ...(workMode ? { workMode } : {}),
        reviewRubricRef: resolveReviewRubricRef(manifest, workMode)
    };
}

function inspectProfile(
    manifest: SkillRuntimeManifest,
    profile: RuntimeDeclarationProfile
): RuntimeDeclarationProfileIssue[] {
    const boundary = validateManifestToolSkillBoundary(manifest);
    const boundaryIssues = boundary.violations.map((violation) => ({
        code: 'manifest_boundary_invalid' as const,
        path: violation.path
    }));
    const performanceIssues = manifest.performance_profile
        ? []
        : [{
            code: 'performance_profile_missing' as const,
            path: 'performance_profile'
        }];
    const evaluationIssues = inspectEvaluationProfile(manifest, profile.reviewRubricRef);
    const modeContract = profile.workMode
        ? manifest.work_mode_contracts?.[profile.workMode]
        : undefined;
    return [
        ...boundaryIssues,
        ...performanceIssues,
        ...evaluationIssues,
        ...(profile.modePolicy === 'none'
            ? inspectDefaultProductionContract(manifest)
            : []),
        ...inspectWorkModeContract(profile.workMode, modeContract)
    ];
}

/** 从 Manifest 注册表构建唯一的公开声明目录；method Manifest 永不成为交付物身份。 */
export function buildRuntimeDeclarationProfileCatalog(
    manifests: readonly SkillRuntimeManifest[] = listSkillManifests()
): RuntimeDeclarationProfileCatalog {
    const declarableProfiles: RuntimeDeclarationProfile[] = [];
    const blockedProfiles: RuntimeDeclarationBlockedProfile[] = [];
    const excludedMethodTaskTypes: string[] = [];

    manifests.forEach((manifest) => {
        if (manifest.planning_role === 'method') {
            excludedMethodTaskTypes.push(manifest.task_type);
            return;
        }
        const workModes = listManifestWorkModes(manifest);
        const profileWorkModes: Array<RuntimeDesignWorkMode | undefined> = workModes.length > 0
            ? workModes
            : [undefined];
        profileWorkModes.forEach((workMode) => {
            const profile = buildProfile(manifest, workMode);
            const issues = inspectProfile(manifest, profile);
            if (issues.length > 0) {
                blockedProfiles.push({ ...profile, issues });
                return;
            }
            declarableProfiles.push(profile);
        });
    });

    return {
        version: RUNTIME_DECLARATION_PROFILE_CATALOG_VERSION,
        declarableProfiles,
        blockedProfiles,
        excludedMethodTaskTypes: unique(excludedMethodTaskTypes)
    };
}

export function listDeclarableRuntimeTaskTypes(
    catalog: RuntimeDeclarationProfileCatalog = buildRuntimeDeclarationProfileCatalog()
): string[] {
    return unique(catalog.declarableProfiles.map((profile) => profile.taskType));
}

export function listDeclarableRuntimeWorkModes(
    taskType: unknown,
    catalog: RuntimeDeclarationProfileCatalog = buildRuntimeDeclarationProfileCatalog()
): RuntimeDesignWorkMode[] {
    const normalizedTaskType = normalize(taskType);
    return RUNTIME_DESIGN_WORK_MODES.filter((workMode) => (
        catalog.declarableProfiles.some((profile) => (
            profile.taskType === normalizedTaskType && profile.workMode === workMode
        ))
    ));
}

export function listRuntimeWorkflowEntryDeclarationFamilies(
    workflowEntrySkillId: unknown,
    catalog: RuntimeDeclarationProfileCatalog = buildRuntimeDeclarationProfileCatalog()
): RuntimeWorkflowEntryDeclarationFamily[] {
    const normalizedSkillId = normalize(workflowEntrySkillId);
    if (!normalizedSkillId) return [];
    const taskTypes = unique(
        listSkillManifests()
            .filter((manifest) => (
                manifest.planning_role !== 'method'
                && (manifest.workflow_entry_skill_ids || []).includes(normalizedSkillId)
            ))
            .map((manifest) => manifest.task_type)
    );
    return taskTypes.map((taskType) => {
        const profiles = catalog.declarableProfiles.filter((profile) => profile.taskType === taskType);
        if (profiles.length === 0) return undefined;
        return {
            workflowEntrySkillId: normalizedSkillId,
            taskType,
            supportedWorkModes: RUNTIME_DESIGN_WORK_MODES.filter((workMode) => (
                profiles.some((profile) => profile.workMode === workMode)
            )),
            profileIds: unique(profiles.map((profile) => profile.profileId))
        };
    }).filter((family): family is RuntimeWorkflowEntryDeclarationFamily => Boolean(family));
}

/**
 * 只有一个 Artifact taskType 时返回 family；workMode 仍由 Agent 显式选择。
 * 多 Profile Package（例如 SKU）保持未选择，绝不按 Manifest 注册顺序取首项。
 */
export function resolveRuntimeWorkflowEntryDeclarationFamily(
    workflowEntrySkillId: unknown,
    catalog?: RuntimeDeclarationProfileCatalog
): RuntimeWorkflowEntryDeclarationFamily | undefined {
    const families = listRuntimeWorkflowEntryDeclarationFamilies(workflowEntrySkillId, catalog);
    return families.length === 1 ? families[0] : undefined;
}

function buildRepairResolution(
    code: RuntimeDeclarationRepairCode,
    catalog: RuntimeDeclarationProfileCatalog,
    taskType: string,
    workMode: string,
    skillId: string
): RuntimeDeclarationResolution {
    return {
        status: 'repair_required',
        code,
        ...(taskType ? { requestedTaskType: taskType } : {}),
        ...(workMode ? { requestedWorkMode: workMode } : {}),
        ...(skillId ? { requestedSkillId: skillId } : {}),
        declarableTaskTypes: listDeclarableRuntimeTaskTypes(catalog),
        supportedWorkModes: listDeclarableRuntimeWorkModes(taskType, catalog)
    };
}

/**
 * 解析结构化 Runtime 声明。repair_required 只表示可以让模型修正一次声明；
 * configuration_error 表示仓库契约本身未达到可发布条件，调用方不得降级绕过。
 */
export function resolveRuntimeDeclarationForAgentTask(
    input: ResolveRuntimeDeclarationInput
): RuntimeDeclarationResolution {
    const taskType = normalize(input.taskType);
    const workModeText = normalize(input.workMode);
    const skillId = normalize(input.skillId);
    const catalog = buildRuntimeDeclarationProfileCatalog();
    if (!taskType) {
        return buildRepairResolution('task_type_missing', catalog, taskType, workModeText, skillId);
    }

    const manifest = getManifestByTaskType(taskType);
    if (!manifest) {
        return buildRepairResolution('task_type_unregistered', catalog, taskType, workModeText, skillId);
    }
    if (manifest.planning_role === 'method') {
        return buildRepairResolution('task_type_not_declarable', catalog, taskType, workModeText, skillId);
    }

    if (skillId && !getManifestBySkillId(skillId) && !getManifestByLegacySkillId(skillId)) {
        return buildRepairResolution('skill_id_unregistered', catalog, taskType, workModeText, skillId);
    }

    const manifestWorkModes = listManifestWorkModes(manifest);
    const normalizedWorkMode = normalizeRuntimeDesignWorkMode(workModeText);
    if (manifestWorkModes.length === 0 && workModeText) {
        return buildRepairResolution(
            'work_mode_not_applicable',
            catalog,
            taskType,
            workModeText,
            skillId
        );
    }
    if (manifestWorkModes.length > 0 && !workModeText) {
        return buildRepairResolution('work_mode_required', catalog, taskType, workModeText, skillId);
    }
    if (workModeText && !normalizedWorkMode) {
        return buildRepairResolution('work_mode_invalid', catalog, taskType, workModeText, skillId);
    }
    if (normalizedWorkMode && !manifestWorkModes.includes(normalizedWorkMode)) {
        return buildRepairResolution('work_mode_unsupported', catalog, taskType, workModeText, skillId);
    }

    const profileId = buildProfileId(taskType, normalizedWorkMode);
    const blockedProfile = catalog.blockedProfiles.find((profile) => profile.profileId === profileId);
    if (blockedProfile) {
        return {
            status: 'configuration_error',
            code: 'runtime_profile_not_declarable',
            profileId,
            issues: [...blockedProfile.issues]
        };
    }
    const profile = catalog.declarableProfiles.find((candidate) => candidate.profileId === profileId);
    if (!profile) {
        return {
            status: 'configuration_error',
            code: 'runtime_profile_missing_from_catalog',
            profileId,
            issues: []
        };
    }

    const selection = resolveSkillRuntimeManifestSelection({
        ...(skillId ? { skillId } : {}),
        taskType
    });
    if (selection.status !== 'resolved'
        || selection.artifactManifest?.task_type !== manifest.task_type) {
        return buildRepairResolution(
            'artifact_identity_conflict',
            catalog,
            taskType,
            workModeText,
            skillId
        );
    }

    const bundle = buildRuntimeContractBundleForAgentTask({
        ...(skillId ? { skillId } : {}),
        taskType,
        ...(normalizedWorkMode ? { workMode: normalizedWorkMode } : {}),
        executableToolNames: input.executableToolNames
    });
    if (!bundle || !bundle.evaluationProfile) {
        return {
            status: 'configuration_error',
            code: 'runtime_bundle_invalid',
            profileId,
            issues: []
        };
    }

    return {
        status: 'resolved',
        canonicalDeclaration: {
            taskType,
            ...(normalizedWorkMode ? { workMode: normalizedWorkMode } : {})
        },
        profile,
        bundle
    };
}
