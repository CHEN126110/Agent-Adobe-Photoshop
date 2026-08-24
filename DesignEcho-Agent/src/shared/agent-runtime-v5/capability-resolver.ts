/**
 * Manifest-driven Capability Resolver。
 *
 * 数据来源只有现有 Skill manifest、legacy capability bridge 和调用方注入的
 * 真实 Tool / Skill inventory。Resolver 不读取 taskText，不拥有业务 registry，
 * 不决定执行顺序；manifest.available_tools 是首轮种子。只有 artifact work-mode
 * 显式声明 capability_ceiling 时，Resolver 才在 Capability id 层施加硬 allow ceiling。
 */

import {
    getPhotoshopToolSkillSemantics,
    type PhotoshopToolSkillSemantics
} from '../photoshop-tool-skill';
import { listBuiltinNonExecutableCapabilityProviders } from './capability-provider-identities';
import type { SkillRuntimeManifest } from './contracts';
import { listDesignEvaluationProfileCapabilityProviders } from './design-evaluation-profiles';
import type {
    AgentCapabilityActivationResult,
    AgentCapabilityResolution,
    AgentCapabilityResolutionIssue,
    CapabilityKind,
    CapabilityReferenceResolution,
    CapabilityReferenceSet,
    RuntimeCapabilityProviderIdentity,
    RuntimeCapabilityInventoryEntry
} from './contracts/capability-resolution';
import { LEGACY_TOOL_CAPABILITY_MAP } from './tool-capability-bridge';

/** 单轮只允许装载最小充分集合；限制批量，不限制后续轮次的能力可达性。 */
export const MAX_ON_DEMAND_CAPABILITY_REQUESTS = 3;

/**
 * 首轮就递到模型手里的基线能力。
 *
 * 病因（真机 2026-07-26）：此前基线只有 5 条、展开后是 9 个**全只读**工具——没有截图、
 * 没有任何写入，而 17 个脚本技能桥接工具却全量可见。于是「调脚本零成本、自己动手要先申请
 * 两轮」，模型理性地选脚本；一旦脚本不适用（无模板、从零设计），它除了反复看别无可做，
 * 3 轮相同工具组合即被无进展守卫杀掉（7 步 83 秒、画面改动 0 项）。
 *
 * Harness baseline 只保留跨任务必需的定位 / 项目上下文能力。设计任务的「眼、脑、可逆首稿」
 * 由调用方按结构化任务委托追加；其余动作通过 searchAgentCapabilities →
 * requestAgentCapabilities 即时发现和装载。这样基线不再随着事故复盘无限膨胀。
 */
/**
 * 环境恢复不是业务 Skill 的能力。它不进入首轮 schema 或业务 Manifest ceiling，
 * 只在结构化堵塞结果出现后由 Capability Session 暴露；Harness 不自动截图或判断弹窗。
 */
export const HARNESS_ENVIRONMENT_RECOVERY_CAPABILITY_IDS: readonly string[] = Object.freeze([
    'photoshop.read.capturePhotoshopWindow'
]);

export const HARNESS_BASELINE_CAPABILITY_IDS: readonly string[] = Object.freeze([
    'project.listResources',
    'project.searchResources',
    'memory.read.designProjectState',
    'photoshop.read.getDocumentInfo',
    'photoshop.read.listDocuments',
    // 写保护门禁的三条法定出口必须全部可达，否则门禁本身会变成死锁：
    // createDocument / switchDocument 分别由设计执行基座和独立叶子能力带入；
    // openProjectFile 此前不属于任何基线能力——于是「目标文件在磁盘上但还没打开」
    // 时模型无路可走。2026-07-31 真机即如此：模型判断出应当打开既有目标文件并说明了意图，
    // 下一步却只得到「工具被阻止了」，因为该工具不在它的可见集里
    //（当时 on-demand 池为空，requestAgentCapabilities 也申请不到）。
    'photoshop.state.openProjectFile',
    'photoshop.state.switchDocument'
]);

/**
 * 命中 Skill Manifest 时的基线：只保留跨任务通用的上下文能力，**不含设计工具面**。
 * 工具面由该 manifest 的 available_tools 独家决定——这是 manifest「按任务给最小充分集」的本意，
 * 也让首轮 schema 体积保持在预算内。与本次扩容前的历史行为完全一致。
 */
const HARNESS_MANIFEST_BASELINE_CAPABILITY_IDS: readonly string[] = Object.freeze([
    'project.listResources',
    'project.searchResources',
    'memory.designProjectState',
    'photoshop.read.getDocumentSummary'
]);

export interface BuildRuntimeCapabilityInventoryInput {
    executableToolNames: readonly string[];
    workflowBridgeNames?: readonly string[];
}

export interface ResolveAgentCapabilitiesInput {
    manifest?: SkillRuntimeManifest;
    requestedTaskType?: string;
    inventory: readonly RuntimeCapabilityInventoryEntry[];
    candidateToolNames: readonly string[];
    baselineCapabilityIds?: readonly string[];
    /** 可选的模式级首轮 seed；只影响初始 schema，不扩大 capability ceiling。 */
    initialCapabilityIds?: readonly string[];
    /** 工作模式拥有的 Capability allow ceiling；与 deny closure 分离，避免共享 Tool alias 误杀。 */
    capabilityCeilingIds?: readonly string[];
    /** 调用方给出的 deny-only 能力上限；只能收窄 inventory，不能授予能力。 */
    deniedCapabilityIds?: readonly string[];
    additionalCapabilityProviders?: readonly RuntimeCapabilityProviderIdentity[];
}

export interface ExpandAgentCapabilitiesInput {
    resolution: AgentCapabilityResolution;
    inventory: readonly RuntimeCapabilityInventoryEntry[];
    requestedCapabilityIds: readonly string[];
    additionalCapabilityProviders?: readonly RuntimeCapabilityProviderIdentity[];
}

function cleanName(value: unknown): string {
    return String(value || '').trim();
}

function unique(values: readonly string[]): string[] {
    return Array.from(new Set(values.map(cleanName).filter(Boolean)));
}

function buildMatchingToolSemanticMetadata(
    _capabilityId: string,
    providerToolNames: readonly string[]
): RuntimeCapabilityInventoryEntry['semanticMetadata'] | undefined {
    if (providerToolNames.length === 0) return undefined;
    const semanticsList = providerToolNames
        .map((toolName) => getPhotoshopToolSkillSemantics(toolName))
        .filter((semantics): semantics is PhotoshopToolSkillSemantics => Boolean(semantics));
    if (semanticsList.length !== providerToolNames.length) return undefined;
    const semantics = semanticsList[0];
    const compatible = semanticsList.every((candidate) => (
        candidate.capabilityKind === semantics.capabilityKind
        && candidate.sideEffect === semantics.sideEffect
        && candidate.requiresPhotoshopConnection === semantics.requiresPhotoshopConnection
        && candidate.requiresOpenDocument === semantics.requiresOpenDocument
        && candidate.requiresPriorDocumentRead === semantics.requiresPriorDocumentRead
    ));
    if (!compatible) return undefined;
    return {
        capabilityKind: semantics.capabilityKind,
        sideEffect: semantics.sideEffect,
        requiresPhotoshopConnection: semantics.requiresPhotoshopConnection,
        requiresOpenDocument: semantics.requiresOpenDocument,
        requiresPriorDocumentRead: semantics.requiresPriorDocumentRead,
        userIntentBoundary: semantics.userIntentBoundary,
        verifyWith: unique(semanticsList.flatMap((candidate) => candidate.verifyWith))
    };
}

function capabilityEntryMap(
    inventory: readonly RuntimeCapabilityInventoryEntry[]
): Map<string, RuntimeCapabilityInventoryEntry> {
    return new Map(inventory.map((entry) => [entry.capabilityId, entry]));
}

function collectToolNames(
    capabilityIds: readonly string[],
    inventory: readonly RuntimeCapabilityInventoryEntry[],
    excludedToolNames: ReadonlySet<string> = new Set()
): string[] {
    const byId = capabilityEntryMap(inventory);
    return unique(capabilityIds.flatMap((capabilityId) => (
        byId.get(capabilityId)?.providerToolNames || []
    ))).filter((toolName) => !excludedToolNames.has(toolName));
}

function hasAvailableProvider(
    entry: RuntimeCapabilityInventoryEntry,
    deniedToolNames: ReadonlySet<string>
): boolean {
    return entry.providerToolNames.some((toolName) => !deniedToolNames.has(toolName));
}

function buildReferenceSet(
    manifest: SkillRuntimeManifest | undefined,
    selectedCapabilityIds: readonly string[],
    inventory: readonly RuntimeCapabilityInventoryEntry[]
): CapabilityReferenceSet {
    const byId = capabilityEntryMap(inventory);
    const workModeEvaluationRefs = Object.values(manifest?.work_mode_contracts || {})
        .flatMap((contract) => contract?.review_rubric_ref ? [contract.review_rubric_ref] : []);
    const selectedSkillCapabilityIds = selectedCapabilityIds.filter((capabilityId) => (
        byId.get(capabilityId)?.kind === 'skill'
    ));
    const selectedToolCapabilityIds = selectedCapabilityIds.filter((capabilityId) => (
        byId.get(capabilityId)?.kind === 'tool'
    ));
    return {
        knowledgeRefs: unique(manifest?.knowledge_refs || []),
        skillRefs: unique([
            ...(manifest ? [manifest.skill_id] : []),
            ...selectedSkillCapabilityIds
        ]),
        toolCapabilityIds: unique(selectedToolCapabilityIds),
        memoryRefs: unique(manifest?.memory_refs || []),
        evaluationRefs: unique([
            ...(manifest?.evaluation_refs || []),
            ...(manifest?.review_rubric_ref ? [manifest.review_rubric_ref] : []),
            ...workModeEvaluationRefs
        ]),
        policyRefs: unique(manifest?.policy_refs || [])
    };
}

const CAPABILITY_REFERENCE_FIELDS: ReadonlyArray<{
    kind: CapabilityKind;
    key: keyof CapabilityReferenceSet;
}> = Object.freeze([
    { kind: 'knowledge', key: 'knowledgeRefs' },
    { kind: 'skill', key: 'skillRefs' },
    { kind: 'tool', key: 'toolCapabilityIds' },
    { kind: 'memory', key: 'memoryRefs' },
    { kind: 'evaluation', key: 'evaluationRefs' },
    { kind: 'policy', key: 'policyRefs' }
]);

function emptyReferenceSet(): CapabilityReferenceSet {
    return {
        knowledgeRefs: [],
        skillRefs: [],
        toolCapabilityIds: [],
        memoryRefs: [],
        evaluationRefs: [],
        policyRefs: []
    };
}

function normalizeProviderIdentity(
    provider: RuntimeCapabilityProviderIdentity,
    forceExtensionSource = false
): RuntimeCapabilityProviderIdentity | undefined {
    const capabilityId = cleanName(provider.capabilityId);
    const providerId = cleanName(provider.providerId);
    const safeTokenPattern = /^[a-zA-Z0-9._:@/-]+$/;
    const containsSensitiveLabel = /api[_-]?key|access[_-]?token|secret/i;
    const unsafeToken = (value: string): boolean => (
        value.length > 160
        || !safeTokenPattern.test(value)
        || value.includes('..')
        || value.includes('://')
        || containsSensitiveLabel.test(value)
    );
    if (!capabilityId || !providerId || unsafeToken(capabilityId) || unsafeToken(providerId)) {
        return undefined;
    }
    const applicableSkillIds = unique(provider.applicableSkillIds || []).filter((value) => !unsafeToken(value));
    const applicableTaskTypes = unique(provider.applicableTaskTypes || []).filter((value) => !unsafeToken(value));
    return {
        capabilityId,
        kind: provider.kind,
        providerId,
        source: forceExtensionSource ? 'extension_provider' : provider.source,
        exposure: provider.exposure,
        // 扩展 provider 只能声明身份；是否进入 schema 必须由真实 action inventory 决定。
        exposedAsToolSchema: forceExtensionSource ? false : provider.exposedAsToolSchema === true,
        ...(applicableSkillIds.length > 0 ? { applicableSkillIds } : {}),
        ...(applicableTaskTypes.length > 0 ? { applicableTaskTypes } : {})
    };
}

function buildCapabilityProviderCatalog(input: {
    manifestRef?: AgentCapabilityResolution['manifestRef'];
    inventory: readonly RuntimeCapabilityInventoryEntry[];
    selectedCapabilityIds: readonly string[];
    selectedToolNames: readonly string[];
    additionalCapabilityProviders?: readonly RuntimeCapabilityProviderIdentity[];
}): RuntimeCapabilityProviderIdentity[] {
    const selectedCapabilityIds = new Set(input.selectedCapabilityIds);
    const selectedToolNames = new Set(input.selectedToolNames);
    const providers: RuntimeCapabilityProviderIdentity[] = [];

    input.inventory.forEach((entry) => {
        providers.push({
            capabilityId: entry.capabilityId,
            kind: entry.kind,
            providerId: `action:${entry.capabilityId}`,
            source: 'runtime_tool_inventory',
            exposure: 'model_tool_schema',
            exposedAsToolSchema: selectedCapabilityIds.has(entry.capabilityId)
        });
    });

    if (input.manifestRef) {
        providers.push({
            capabilityId: input.manifestRef.skillId,
            kind: 'skill',
            providerId: `manifest:${input.manifestRef.skillId}@${input.manifestRef.version}`,
            source: 'skill_manifest',
            exposure: 'manifest_context',
            exposedAsToolSchema: false
        });
    }

    unique(input.inventory.flatMap((entry) => entry.providerToolNames)).forEach((toolName) => {
        const semantics = getPhotoshopToolSkillSemantics(toolName);
        if (semantics?.capabilityKind !== 'knowledge_search') return;
        providers.push({
            capabilityId: `tool:${toolName}`,
            kind: 'knowledge',
            providerId: `knowledge-tool:${toolName}`,
            source: 'knowledge_tool_semantics',
            exposure: 'model_tool_schema',
            exposedAsToolSchema: selectedToolNames.has(toolName)
        });
    });

    providers.push(...listBuiltinNonExecutableCapabilityProviders());
    providers.push(...listDesignEvaluationProfileCapabilityProviders());
    (input.additionalCapabilityProviders || []).forEach((provider) => {
        const normalized = normalizeProviderIdentity(provider, true);
        if (normalized) providers.push(normalized);
    });

    const uniqueProviders = new Map<string, RuntimeCapabilityProviderIdentity>();
    providers.forEach((provider) => {
        const normalized = normalizeProviderIdentity(provider);
        if (!normalized) return;
        const key = `${normalized.kind}:${normalized.capabilityId}:${normalized.providerId}`;
        if (!uniqueProviders.has(key)) uniqueProviders.set(key, normalized);
    });
    return Array.from(uniqueProviders.values());
}

function resolveCapabilityReferences(input: {
    references: CapabilityReferenceSet;
    providers: readonly RuntimeCapabilityProviderIdentity[];
    manifestRef?: AgentCapabilityResolution['manifestRef'];
}): { resolution: CapabilityReferenceResolution; issues: AgentCapabilityResolutionIssue[] } {
    const requested = emptyReferenceSet();
    const resolved = emptyReferenceSet();
    const unavailable = emptyReferenceSet();
    const resolvedProviders = new Map<string, RuntimeCapabilityProviderIdentity>();
    const issues: AgentCapabilityResolutionIssue[] = [];
    const providersByCapabilityId = new Map<string, RuntimeCapabilityProviderIdentity[]>();

    input.providers.forEach((provider) => {
        const current = providersByCapabilityId.get(provider.capabilityId) || [];
        current.push(provider);
        providersByCapabilityId.set(provider.capabilityId, current);
    });

    CAPABILITY_REFERENCE_FIELDS.forEach(({ kind, key }) => {
        const refs = unique(input.references[key]);
        requested[key] = refs;
        refs.forEach((capabilityId) => {
            const candidates = providersByCapabilityId.get(capabilityId) || [];
            const exactProviders = candidates.filter((provider) => provider.kind === kind);
            const applicableProviders = exactProviders.filter((provider) => {
                const skillIds = provider.applicableSkillIds || [];
                const taskTypes = provider.applicableTaskTypes || [];
                if (!input.manifestRef) return skillIds.length === 0 && taskTypes.length === 0;
                const skillMatches = skillIds.length === 0 || skillIds.includes(input.manifestRef.skillId);
                const taskMatches = taskTypes.length === 0 || taskTypes.includes(input.manifestRef.taskType);
                return skillMatches && taskMatches;
            });
            if (applicableProviders.length > 0) {
                resolved[key].push(capabilityId);
                applicableProviders.forEach((provider) => {
                    resolvedProviders.set(
                        `${provider.kind}:${provider.capabilityId}:${provider.providerId}`,
                        provider
                    );
                });
                return;
            }

            unavailable[key].push(capabilityId);
            if (exactProviders.length > 0) {
                issues.push({
                    code: 'capability_reference_scope_mismatch',
                    capabilityId,
                    message: `能力引用 ${capabilityId} 存在 ${kind} provider，但不适用于当前 Skill / task type。`
                });
                return;
            }
            if (candidates.length > 0) {
                issues.push({
                    code: 'capability_reference_kind_mismatch',
                    capabilityId,
                    message: `能力引用 ${capabilityId} 声明为 ${kind}，但已注册 provider 属于 ${unique(candidates.map((provider) => provider.kind)).join(', ')}。`
                });
                return;
            }
            issues.push({
                code: 'capability_reference_unavailable',
                capabilityId,
                message: `能力引用 ${capabilityId} 当前没有可追溯 provider；保留现有执行，但不能声明该能力已装载。`
            });
        });
    });

    const byKind = Object.fromEntries(CAPABILITY_REFERENCE_FIELDS.map(({ kind, key }) => [
        kind,
        {
            requested: requested[key].length,
            resolved: resolved[key].length,
            unavailable: unavailable[key].length
        }
    ])) as CapabilityReferenceResolution['metrics']['byKind'];
    const requestedCount = Object.values(byKind).reduce((sum, metric) => sum + metric.requested, 0);
    const resolvedCount = Object.values(byKind).reduce((sum, metric) => sum + metric.resolved, 0);
    const unavailableCount = Object.values(byKind).reduce((sum, metric) => sum + metric.unavailable, 0);

    return {
        resolution: {
            version: 'runtime-capability-reference-resolution/v0',
            status: requestedCount === 0
                ? 'not_applicable'
                : (unavailableCount > 0 ? 'partial' : 'resolved'),
            requested,
            resolved,
            unavailable,
            providers: Array.from(resolvedProviders.values()),
            metrics: {
                requestedCount,
                resolvedCount,
                unavailableCount,
                byKind
            },
            boundaries: [
                '引用 resolved 只表示 provider 身份可追溯，不表示内容已读取、Skill 已执行、Policy 已触发或 Evaluation 已通过。',
                'Knowledge / Memory / Evaluation / Policy provider 不会因引用解析而新增 Tool schema。',
                '引用解析不授予权限、不执行 Tool、不调用模型、不生成 Workflow / DAG。'
            ]
        },
        issues
    };
}

function buildBoundaries(): string[] {
    return [
        'Capability Resolution 只控制模型可见 schema，不授予 Tool 执行权限。',
        '无可执行 continuation owner 的交互能力不进入 autonomous 模型 schema；叶子 Skill 与 Harness 内建 HITL 仍拥有各自卡片。',
        'manifest 初始能力是可扩展种子；能力所有权、显式 forbidden capability 与执行点 Policy 是硬边界。',
        '未分类 legacy Tool 以迁移标识保留可发现性，不伪装成已完成命名空间治理。',
        'Resolution 不生成 Workflow / DAG，不证明 Photoshop 写入或设计质量完成。'
    ];
}

export function buildRuntimeCapabilityInventory(
    input: BuildRuntimeCapabilityInventoryInput
): RuntimeCapabilityInventoryEntry[] {
    const executableToolNames = unique(input.executableToolNames);
    const executableSet = new Set(executableToolNames);
    const workflowBridgeSet = new Set(unique(input.workflowBridgeNames || []));
    const coveredToolNames = new Set<string>();
    const inventory: RuntimeCapabilityInventoryEntry[] = [];

    Object.entries(LEGACY_TOOL_CAPABILITY_MAP).forEach(([capabilityId, candidates]) => {
        const providerToolNames = unique(candidates.filter((name) => executableSet.has(name)));
        if (providerToolNames.length === 0) return;
        providerToolNames.forEach((name) => coveredToolNames.add(name));
        const entry: RuntimeCapabilityInventoryEntry = {
            capabilityId,
            kind: 'tool',
            providerToolNames,
            source: 'legacy_tool_capability_bridge'
        };
        const semanticMetadata = buildMatchingToolSemanticMetadata(capabilityId, providerToolNames);
        if (semanticMetadata) entry.semanticMetadata = semanticMetadata;
        inventory.push(entry);
    });

    workflowBridgeSet.forEach((toolName) => {
        if (!executableSet.has(toolName)) return;
        coveredToolNames.add(toolName);
        inventory.push({
            capabilityId: `skill.${toolName}`,
            kind: 'skill',
            providerToolNames: [toolName],
            source: 'legacy_workflow_bridge'
        });
    });

    executableToolNames.forEach((toolName) => {
        if (coveredToolNames.has(toolName)) return;
        const semantics = getPhotoshopToolSkillSemantics(toolName);
        if (semantics) {
            inventory.push({
                capabilityId: semantics.capabilityId,
                kind: 'tool',
                providerToolNames: [toolName],
                source: 'tool_semantics',
                semanticMetadata: {
                    capabilityKind: semantics.capabilityKind,
                    sideEffect: semantics.sideEffect,
                    requiresPhotoshopConnection: semantics.requiresPhotoshopConnection,
                    requiresOpenDocument: semantics.requiresOpenDocument,
                    requiresPriorDocumentRead: semantics.requiresPriorDocumentRead,
                    userIntentBoundary: semantics.userIntentBoundary,
                    verifyWith: [...semantics.verifyWith]
                }
            });
            return;
        }
        inventory.push({
            capabilityId: `legacy.tool.${toolName}`,
            kind: 'tool',
            providerToolNames: [toolName],
            source: 'legacy_unclassified_tool'
        });
    });

    return inventory;
}

export function resolveAgentCapabilities(
    input: ResolveAgentCapabilitiesInput
): AgentCapabilityResolution {
    const inventory = [...input.inventory];
    const byId = capabilityEntryMap(inventory);
    const manifestWorkflowEntryCapabilityIds = unique(
        (input.manifest?.workflow_entry_skill_ids || [])
            .map((skillId) => `skill.${skillId}`)
    ).filter((capabilityId) => byId.has(capabilityId));
    const manifestWorkflowEntryCapabilitySet = new Set(manifestWorkflowEntryCapabilityIds);
    const manifestOwnedDeniedCapabilityIds = input.manifest
        ? inventory
            .filter((entry) => (
                entry.kind === 'skill'
                && !manifestWorkflowEntryCapabilitySet.has(entry.capabilityId)
            ))
            .map((entry) => entry.capabilityId)
        : [];
    const manifestRetiredControlCapabilityIds = input.manifest
        ? ['agent.intent.declareDesignTask']
        : [];
    const deniedCapabilityIds = unique([
        ...(input.manifest?.forbidden_tools || []),
        ...(input.deniedCapabilityIds || []),
        ...manifestOwnedDeniedCapabilityIds,
        ...manifestRetiredControlCapabilityIds
    ]);
    const deniedSet = new Set(deniedCapabilityIds);
    const capabilityCeilingIds = input.capabilityCeilingIds
        ? unique(input.capabilityCeilingIds)
        : undefined;
    const capabilityCeilingSet = capabilityCeilingIds
        ? new Set(capabilityCeilingIds)
        : undefined;
    const isWithinCapabilityCeiling = (capabilityId: string): boolean => (
        !capabilityCeilingSet || capabilityCeilingSet.has(capabilityId)
    );
    // legacy bridge 允许多个 capability 指向同一个 executable Tool。若只过滤 capability id，
    // 被禁止能力会从另一条映射重新暴露；因此 provider Tool 闭包必须全局 deny-wins。
    const deniedToolNames = collectToolNames(deniedCapabilityIds, inventory);
    const deniedToolSet = new Set(deniedToolNames);
    // 基线里的「设计工具面」只服务 broad discovery（无 manifest：没人替模型定工具面，
    // 若只给只读工具它除了反复看别无可做，3 轮相同调用即被无进展守卫杀掉）。
    // 命中 manifest 时，工具面由该 manifest 的 available_tools 独家负责——否则基线会叠加到
    // 每个 Skill 上，既撑破首轮 schema 预算，也架空了 manifest「按任务给最小充分集」的设计。
    // Manifest 是 staged Skill 首轮工具面的唯一 owner。调用方的 broad / design baseline
    // 只服务未绑定自主发现，不能在 Manifest 已选后穿透 work-mode seed 或 ceiling。
    // 过去这里优先采用 input.baselineCapabilityIds，导致调用方传入的通用设计基线叠加到
    // scoped edit；聚合 capability 恰好被 ceiling 过滤时问题被掩盖，拆成叶子能力后会泄露。
    const baselineIds = input.manifest
        ? HARNESS_MANIFEST_BASELINE_CAPABILITY_IDS
        : (input.baselineCapabilityIds || HARNESS_BASELINE_CAPABILITY_IDS);
    const baselineCapabilityIds = unique(baselineIds).filter((capabilityId) => (
        // Manifest 已经提供结构化 task_type，R0 不需要再让模型调用影子声明工具。
        // 该工具只服务 broad discovery；继续暴露会产生无意义的重复分类，甚至与
        // Manifest task_type 漂移。移除 schema 不影响权限或执行能力。
        !input.manifest || capabilityId !== 'agent.intent.declareDesignTask'
    ));
    const manifestSeedIds = unique(
        input.initialCapabilityIds || input.manifest?.available_tools || []
    );
    // Broad discovery 不再把全部 user-facing Skill 的完整 schema 塞进首轮。
    // Advisory recommendation 若存在，由调用方作为单一 initial seed 传入；其余 Skill 仍保留在
    // on-demand 能力目录中，可通过 requestAgentCapabilities 按需装载。可见性不等于授权，
    // recommendation 也不绑定 Manifest、不改变 mandatory declaration 或执行点 Policy。
    const initialCapabilityIds = unique([
        ...baselineCapabilityIds,
        ...manifestSeedIds,
        ...manifestWorkflowEntryCapabilityIds
    ]).filter((capabilityId) => (
        !deniedSet.has(capabilityId)
        && isWithinCapabilityCeiling(capabilityId)
    ));
    const issues: AgentCapabilityResolutionIssue[] = [];
    const selectedCapabilityIds: string[] = [];

    const requestedTaskType = cleanName(input.requestedTaskType);
    if (!input.manifest && requestedTaskType) {
        issues.push({
            code: 'structured_manifest_unresolved',
            capabilityId: requestedTaskType,
            message: `结构化任务类型 ${requestedTaskType} 当前没有注册 Skill manifest；保持 broad discovery，不猜测相似品类。`
        });
    }

    capabilityCeilingIds?.forEach((capabilityId) => {
        if (byId.has(capabilityId)) return;
        issues.push({
            code: 'capability_ceiling_unavailable',
            capabilityId,
            message: `工作模式能力上限 ${capabilityId} 当前没有可用 provider。`
        });
    });

    initialCapabilityIds.forEach((capabilityId) => {
        const entry = byId.get(capabilityId);
        if (!entry) {
            issues.push({
                code: 'initial_capability_unavailable',
                capabilityId,
                message: `初始能力 ${capabilityId} 当前没有可用 provider。`
            });
            return;
        }
        if (!hasAvailableProvider(entry, deniedToolSet)) {
            issues.push({
                code: 'initial_capability_unavailable',
                capabilityId,
                message: `初始能力 ${capabilityId} 的 legacy provider 已被 forbidden capability 硬禁止。`
            });
            return;
        }
        selectedCapabilityIds.push(capabilityId);
    });

    const selectedSet = new Set(selectedCapabilityIds);
    const onDemandCapabilityIds = inventory
        .filter((entry) => hasAvailableProvider(entry, deniedToolSet))
        .map((entry) => entry.capabilityId)
        .filter((capabilityId) => (
            !selectedSet.has(capabilityId)
            && !deniedSet.has(capabilityId)
            && isWithinCapabilityCeiling(capabilityId)
        ));
    const selectedToolNames = collectToolNames(selectedCapabilityIds, inventory, deniedToolSet);
    const candidateToolNames = unique(input.candidateToolNames);
    const manifestRef = input.manifest
        ? {
            skillId: input.manifest.skill_id,
            version: input.manifest.version,
            taskType: input.manifest.task_type
        }
        : undefined;
    const references = buildReferenceSet(input.manifest, selectedCapabilityIds, inventory);
    const capabilityReferenceResult = resolveCapabilityReferences({
        references,
        manifestRef,
        providers: buildCapabilityProviderCatalog({
            manifestRef,
            inventory,
            selectedCapabilityIds,
            selectedToolNames,
            additionalCapabilityProviders: input.additionalCapabilityProviders
        })
    });
    issues.push(...capabilityReferenceResult.issues);

    return {
        version: 'agent-capability-resolution/v0',
        status: input.manifest
            ? (issues.length > 0 ? 'partial' : 'resolved')
            : 'broad_discovery',
        selectionMode: input.manifest ? 'manifest_seeded' : 'broad_discovery',
        ...(manifestRef ? { manifestRef } : {}),
        selectedCapabilityIds,
        selectedToolNames,
        onDemandCapabilityIds,
        ...(capabilityCeilingIds ? { capabilityCeilingIds } : {}),
        deniedCapabilityIds,
        deniedToolNames,
        unavailableCapabilityIds: unique(issues.map((issue) => issue.capabilityId)),
        issues,
        references,
        referenceResolution: capabilityReferenceResult.resolution,
        metrics: {
            inventoryCapabilityCount: inventory.length,
            candidateToolCount: candidateToolNames.length,
            selectedToolCount: selectedToolNames.length,
            schemaReductionApplied: selectedToolNames.length < candidateToolNames.length
        },
        boundaries: buildBoundaries()
    };
}

export function expandAgentCapabilities(
    input: ExpandAgentCapabilitiesInput
): AgentCapabilityActivationResult {
    const requestedCapabilityIds = unique(input.requestedCapabilityIds);
    if (requestedCapabilityIds.length > MAX_ON_DEMAND_CAPABILITY_REQUESTS) {
        const issue: AgentCapabilityResolutionIssue = {
            code: 'requested_capability_limit_exceeded',
            capabilityId: '*',
            message: `单轮最多按需装载 ${MAX_ON_DEMAND_CAPABILITY_REQUESTS} 项能力；请只请求当前下一步的最小充分集合。`
        };
        return {
            version: 'agent-capability-activation/v0',
            status: 'rejected',
            requestedCapabilityIds,
            activatedCapabilityIds: [],
            activatedToolNames: [],
            issues: [issue],
            resolution: input.resolution
        };
    }
    const inventory = [...input.inventory];
    const byId = capabilityEntryMap(inventory);
    const deniedSet = new Set(input.resolution.deniedCapabilityIds);
    const capabilityCeilingSet = input.resolution.capabilityCeilingIds
        ? new Set(input.resolution.capabilityCeilingIds)
        : undefined;
    const deniedToolSet = new Set(input.resolution.deniedToolNames);
    const selectedSet = new Set(input.resolution.selectedCapabilityIds);
    const issues: AgentCapabilityResolutionIssue[] = [];
    const activatedCapabilityIds: string[] = [];

    requestedCapabilityIds.forEach((capabilityId) => {
        if (deniedSet.has(capabilityId)
            || (capabilityCeilingSet && !capabilityCeilingSet.has(capabilityId))) {
            issues.push({
                code: 'requested_capability_forbidden',
                capabilityId,
                message: `能力 ${capabilityId} 被当前 Runtime 的能力所有权或 Skill manifest 边界禁止。`
            });
            return;
        }
        const entry = byId.get(capabilityId);
        if (!entry) {
            issues.push({
                code: 'requested_capability_unknown',
                capabilityId,
                message: `能力 ${capabilityId} 不在当前运行时 inventory 中。`
            });
            return;
        }
        if (!hasAvailableProvider(entry, deniedToolSet)) {
            issues.push({
                code: 'requested_capability_forbidden',
                capabilityId,
                message: `能力 ${capabilityId} 的 legacy provider 已被 forbidden capability 硬禁止。`
            });
            return;
        }
        if (selectedSet.has(capabilityId)) {
            issues.push({
                code: 'requested_capability_already_active',
                capabilityId,
                message: `能力 ${capabilityId} 已经处于激活状态，请直接调用它提供的具体动作。`
            });
            return;
        }
        selectedSet.add(capabilityId);
        activatedCapabilityIds.push(capabilityId);
    });

    const selectedCapabilityIds = inventory
        .map((entry) => entry.capabilityId)
        .filter((capabilityId) => selectedSet.has(capabilityId));
    const selectedToolNames = collectToolNames(selectedCapabilityIds, inventory, deniedToolSet);
    const onDemandCapabilityIds = inventory
        .filter((entry) => hasAvailableProvider(entry, deniedToolSet))
        .map((entry) => entry.capabilityId)
        .filter((capabilityId) => (
            !selectedSet.has(capabilityId)
            && !deniedSet.has(capabilityId)
            && (!capabilityCeilingSet || capabilityCeilingSet.has(capabilityId))
        ));
    const activatedToolNames = collectToolNames(activatedCapabilityIds, inventory, deniedToolSet)
        .filter((toolName) => !input.resolution.selectedToolNames.includes(toolName));
    const selectedSkillCapabilityIds = selectedCapabilityIds.filter((capabilityId) => (
        byId.get(capabilityId)?.kind === 'skill'
    ));
    const selectedToolCapabilityIds = selectedCapabilityIds.filter((capabilityId) => (
        byId.get(capabilityId)?.kind === 'tool'
    ));
    const references: CapabilityReferenceSet = {
        ...input.resolution.references,
        skillRefs: unique([
            ...(input.resolution.manifestRef ? [input.resolution.manifestRef.skillId] : []),
            ...selectedSkillCapabilityIds
        ]),
        toolCapabilityIds: selectedToolCapabilityIds
    };
    const capabilityReferenceResult = resolveCapabilityReferences({
        references,
        manifestRef: input.resolution.manifestRef,
        providers: buildCapabilityProviderCatalog({
            manifestRef: input.resolution.manifestRef,
            inventory,
            selectedCapabilityIds,
            selectedToolNames,
            additionalCapabilityProviders: input.additionalCapabilityProviders
        })
    });
    const retainedIssues = input.resolution.issues.filter((issue) => ![
        'capability_reference_unavailable',
        'capability_reference_kind_mismatch',
        'capability_reference_scope_mismatch'
    ].includes(issue.code));
    const persistentRequestIssues = issues.filter((issue) => (
        issue.code !== 'requested_capability_already_active'
    ));
    const allIssues = [
        ...retainedIssues,
        ...persistentRequestIssues,
        ...capabilityReferenceResult.issues
    ];
    const resolution: AgentCapabilityResolution = {
        ...input.resolution,
        status: input.resolution.selectionMode === 'broad_discovery'
            ? 'broad_discovery'
            : (allIssues.length > 0 ? 'partial' : 'resolved'),
        selectedCapabilityIds,
        selectedToolNames,
        onDemandCapabilityIds,
        unavailableCapabilityIds: unique(allIssues.map((issue) => issue.capabilityId)),
        issues: allIssues,
        references,
        referenceResolution: capabilityReferenceResult.resolution,
        metrics: {
            ...input.resolution.metrics,
            selectedToolCount: selectedToolNames.length,
            schemaReductionApplied: selectedToolNames.length < input.resolution.metrics.candidateToolCount
        }
    };

    const status = activatedCapabilityIds.length > 0
        ? (issues.length > 0 ? 'partial' : 'activated')
        : 'rejected';

    return {
        version: 'agent-capability-activation/v0',
        status,
        requestedCapabilityIds,
        activatedCapabilityIds,
        activatedToolNames,
        issues,
        resolution
    };
}
