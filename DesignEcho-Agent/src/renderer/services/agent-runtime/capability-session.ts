/**
 * 单次 Agent 运行的 Capability Session。
 *
 * Session 只改变下一轮模型可见的 ToolSchema；它不执行 Photoshop、不授予权限，
 * 也不改变 Skill 内部或系统自用工具。activeTools 数组原地更新，旧 Agent runtime
 * 下一次 consumeToolsForIteration() 会自然读取新增 schema，无需第三套循环。
 */

import {
    buildRuntimeCapabilityInventory,
    expandAgentCapabilities,
    HARNESS_BASELINE_CAPABILITY_IDS,
    HARNESS_ENVIRONMENT_RECOVERY_CAPABILITY_IDS,
    MAX_ON_DEMAND_CAPABILITY_REQUESTS,
    resolveAgentCapabilities
} from '../../../shared/agent-runtime-v5/capability-resolver';
import type {
    RuntimeDesignWorkMode,
    SkillRuntimeManifest
} from '../../../shared/agent-runtime-v5/contracts';
import {
    resolveSkillRuntimeCapabilityCeiling,
    resolveSkillRuntimeInitialCapabilities
} from '../../../shared/agent-runtime-v5/skill-runtime';
import type {
    AgentCapabilityActivationResult,
    AgentCapabilityResolution,
    CapabilityKind,
    RuntimeCapabilityProviderIdentity,
    RuntimeCapabilityInventoryEntry
} from '../../../shared/agent-runtime-v5/contracts/capability-resolution';
import { getPhotoshopToolSkillSemantics } from '../../../shared/photoshop-tool-skill';
import { getToolDisplayInfo } from '../tool-display-info';
import type { ToolSchema } from './types';

export const REQUEST_AGENT_CAPABILITIES_TOOL_NAME = 'requestAgentCapabilities';
export const SEARCH_AGENT_CAPABILITIES_TOOL_NAME = 'searchAgentCapabilities';

export function isAgentCapabilityLoadTool(value: unknown): boolean {
    return cleanName(value) === REQUEST_AGENT_CAPABILITIES_TOOL_NAME;
}

export function isAgentCapabilityControlTool(value: unknown): boolean {
    const name = cleanName(value);
    return isAgentCapabilityLoadTool(name)
        || name === SEARCH_AGENT_CAPABILITIES_TOOL_NAME;
}

export interface AgentCapabilitySearchMatch {
    capabilityId: string;
    family: string;
    providerToolNames: string[];
    description: string;
    availability: 'active' | 'loadable';
}

export interface AgentCapabilitySearchResult {
    query: string;
    matches: AgentCapabilitySearchMatch[];
    availableCount: number;
    message: string;
}

export interface CreateAgentCapabilitySessionInput {
    candidateTools: readonly ToolSchema[];
    workflowBridgeNames?: readonly string[];
    requestedTaskType?: string;
    manifest?: SkillRuntimeManifest;
    workMode?: RuntimeDesignWorkMode;
    baselineCapabilityIds?: readonly string[];
    /** deny-only 约束；用于把被禁能力保留在审计结果中，并阻止按需重新激活。 */
    deniedCapabilityKinds?: readonly CapabilityKind[];
    deniedCapabilityIds?: readonly string[];
    /**
     * 只有绑定 Manifest 后才能进入能力面的 Skill Capability。
     * 用于区分 advisory recommendation 与已选 Runtime owner；不影响普通原子 Tool。
     */
    manifestRequiredCapabilityIds?: readonly string[];
    /**
     * 默认通道中只有绑定 Manifest 后才能被检索或装载的领域原子 Tool。
     * Tool 仍保留在 Session inventory，late bind 后可按 Manifest ceiling 正常恢复；
     * 显式无 Skill 模式应传空集合，使裸 Agent 能自行使用这些原子能力。
     */
    manifestRequiredProviderToolNames?: readonly string[];
    /** 精确禁止 provider Tool/Skill bridge 名称；先从候选面移除，on-demand 无 provider 可复活。 */
    deniedProviderToolNames?: readonly string[];
    /** 扩展包可登记非执行 provider 身份；不会因此新增 Tool schema。 */
    additionalCapabilityProviders?: readonly RuntimeCapabilityProviderIdentity[];
}

export interface AgentCapabilitySession {
    /** 传给 AgentConfig.tools 的同一个可变数组。 */
    activeTools: ToolSchema[];
    /**
     * 本 Session 在运行时 deny 之后的完整候选 Tool 名称。
     * Runtime Bundle 的循环内重绑定必须复用这一份候选面，不能重新扫描 Tool Registry。
     */
    candidateToolNames: readonly string[];
    inventory: RuntimeCapabilityInventoryEntry[];
    getResolution(): AgentCapabilityResolution;
    /** 只读映射：把真实 provider Tool 解析为当前已激活 Capability，不授予执行权限。 */
    getActiveCapabilityIdsForTool(toolName: string): string[];
    /** 本轮由模型明确按需请求并成功激活的 Capability；供 Stage 投影追加最小 provider 面。 */
    getOnDemandActivatedCapabilityIds(): string[];
    /**
     * 在模型结构化声明成功后，把当前会话原地绑定到已选 Manifest。
     * 保持 activeTools 数组对象身份，只收窄能力面（manifest 不能绕过运行时的 deny）；
     * 先前已按需激活且仍被新 Manifest 允许的能力保留，被禁止的自然丢弃。
     */
    bindManifest(manifest: SkillRuntimeManifest, workMode?: RuntimeDesignWorkMode): void;
    /** 在未激活能力里检索精确 id；只读目录，不修改 schema、不授予权限。 */
    searchCapabilities(query: string, limit?: number): AgentCapabilitySearchResult;
    requestCapabilities(capabilityIds: readonly string[]): AgentCapabilityActivationResult;
    /**
     * Skill 交接声明了后续原子 Tool 时，仅把其中仍属于本会话 on-demand 候选的 schema
     * 暴露给下一轮模型。它不执行 Tool、不授予权限，也不能越过 deny / Manifest ceiling。
     */
    activateToolsForContinuation(toolNames: readonly string[]): string[];
    buildPromptSection(): string;
}

function cleanName(value: unknown): string {
    return String(value || '').trim();
}

function unique(values: readonly string[]): string[] {
    return Array.from(new Set(values.map(cleanName).filter(Boolean)));
}

/**
 * 创意设计的首轮最小执行供给链。
 *
 * 这些只是 schema 可见性：Stage、Tool preflight、目标守卫和确认门禁仍决定能否执行。
 * 非设计对话继续只拿 Harness baseline，不暴露写入起手式。
 */
export const DESIGN_EXECUTION_FOUNDATION_CAPABILITY_IDS: readonly string[] = Object.freeze([
    // 设计执行已经由结构化委托确认时，让模型首轮即可声明自己理解到的 Runtime Profile。
    // 该 schema 的可见性不替模型选择 Profile、不自行绑定 Manifest、不授予 Photoshop 权限；
    // 只有模型调用后现有 Resolver 才处理声明，绑定成功即将它从能力面退役，避免重复声明。
    'agent.intent.declareDesignTask',
    // 项目级观察与候选比较都在首轮可见，只降低能力发现成本，不规定设计步骤：
    // 总览用于会改变开放设计方向的库存/商品身份/素材角色未知；推荐只比较具体需求的候选。
    'project.observeAssets',
    'project.read.recommendAssets',
    // 参考研究是设计师可自行选择的思考资源，不是 Harness 前置流程。首轮直接提供只读
    // 搜索与单图视觉分析，避免模型为了“有没有参考能力”先消耗能力发现回合；是否调用、
    // 查什么、何时停止仍由 Agent 按当前设计问题决定。
    'eagle.read.searchReferences',
    'eagle.read.analyzeReference',
    // 业务工作法手册（官方 skill 包）首轮可见：技能描述会引导「开工先读手册」，
    // 手册工具不可见时该引导就是空指（2026-08-23 真机：模型跳过读手册、按文件名猜色卡站已完成）。
    'knowledge.search.readSkillPlaybook',
    'photoshop.read.getCanvasSnapshot',
    // 设计写入后的图层身份是跨品类基础事实；直接提供层级读取，避免模型靠画面猜结构。
    'photoshop.read.getLayerHierarchy',
    'photoshop.sandbox.createDocument',
    // 单画面开放创意保留一个可逆、由 Agent 完整声明设计参数的首稿入口。独立评价同样
    // 首轮可见，但只是 Agent 可自行取用的视觉证据，不是开工或交付门禁。
    'photoshop.write.composeDesign',
    'review.evaluateDesign',
    // 首稿快照暴露问题后，模型必须有最小的局部修订手柄；这些能力不规定先后、修改对象
    // 或审美答案，只让模型能增补素材、调整几何、建立图形关系与修改文字样式。
    'photoshop.write.placeImage',
    'photoshop.write.transformLayer',
    // 主体大小/裁切是跨品类的通用视觉修订能力。直接可见只减少能力发现回合；
    // 比例与锚点仍必须由 Agent 显式声明，工具只求解几何并返回同版本局部画面。
    'photoshop.write.fitLayerSubjectToRegion',
    'photoshop.sandbox.createShape',
    'photoshop.write.setTextStyle'
]);

/**
 * 唯一 advisory Skill 推荐的首轮快速路径。
 *
 * 每个 Capability 当前都只展开一个只读 provider Tool：项目列举/搜索、文档身份、
 * 单画布快照和图层树。它只服务不要求 Manifest owner 的 advisory Skill；声明了
 * canonical production owner 的业务 Skill 在 handoff 前保持不可执行，普通 Agent
 * 仍使用自身原子能力。这里不授予权限，也不绑定 Runtime Manifest。
 */
export const RECOMMENDED_SKILL_BOOTSTRAP_CAPABILITY_IDS: readonly string[] = Object.freeze([
    'project.listResources',
    'project.searchResources',
    'photoshop.read.getDocumentInfo',
    'photoshop.read.getCanvasSnapshot',
    'photoshop.read.getLayerHierarchy'
]);

export function buildRecommendedSkillFastPathBaseline(
    recommendedSkillCapabilityId: string
): string[] {
    return unique([
        ...RECOMMENDED_SKILL_BOOTSTRAP_CAPABILITY_IDS,
        recommendedSkillCapabilityId
    ]);
}

export function buildAgentCapabilityBaseline(
    designExecutionRequired: boolean
): string[] {
    // 设计运行开始时已经把同一份 Project State 摘要注入模型；首轮不再重复暴露读取 Tool，
    // 为真正影响选图的视觉推荐腾出一个 schema。后续仍可从按需目录重新取得完整状态读取。
    const baselineCapabilityIds = designExecutionRequired
        ? HARNESS_BASELINE_CAPABILITY_IDS.filter((id) => id !== 'memory.read.designProjectState')
        : HARNESS_BASELINE_CAPABILITY_IDS;
    return unique([
        ...baselineCapabilityIds,
        ...(designExecutionRequired ? DESIGN_EXECUTION_FOUNDATION_CAPABILITY_IDS : [])
    ]);
}

function buildRequestToolSchema(resolution: AgentCapabilityResolution): ToolSchema {
    const capabilityItemSchema: Record<string, any> = {
        type: 'string',
        description: `要在下一轮装载的精确能力 id；必须来自 ${SEARCH_AGENT_CAPABILITIES_TOOL_NAME} 的当前结果。`
    };

    return {
        name: REQUEST_AGENT_CAPABILITIES_TOOL_NAME,
        description: [
            '按精确 capability id 临时加入下一步需要的动作。',
            `id 不确定时先用 ${SEARCH_AGENT_CAPABILITIES_TOOL_NAME} 检索；一次只加入最少项。`,
            `当前还有 ${resolution.onDemandCapabilityIds.length} 项可按需装载。`
        ].join(' '),
        inputSchema: {
            type: 'object',
            properties: {
                capabilityIds: {
                    type: 'array',
                    minItems: 1,
                    maxItems: MAX_ON_DEMAND_CAPABILITY_REQUESTS,
                    uniqueItems: true,
                    items: capabilityItemSchema
                },
                reason: {
                    type: 'string',
                    description: '这些能力将用于完成哪一个具体的下一步。'
                }
            },
            required: ['capabilityIds']
        }
    };
}

function buildSearchToolSchema(resolution: AgentCapabilityResolution): ToolSchema {
    return {
        name: SEARCH_AGENT_CAPABILITIES_TOOL_NAME,
        description: [
            '检索当前能力目录，返回精确 capability id、具体动作以及 active/loadable 状态。',
            'active 项已经可以直接调用 providerToolNames，不要再次申请；只有 loadable 项需要装载。',
            '只读目录，不执行动作、不改变权限。',
            `当前可检索 ${resolution.onDemandCapabilityIds.length} 项。`
        ].join(' '),
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: '用自然语言描述马上缺少的动作，例如「读取网页」「主体抠图」「导出 PNG」。'
                },
                limit: {
                    type: 'number',
                    minimum: 1,
                    maximum: 8,
                    description: '返回数量，默认 5。'
                }
            },
            required: ['query']
        }
    };
}

/** 取 Tool schema 描述的第一句作为能力目录的一句话说明；过长时截断。 */
function firstSentence(value: unknown): string {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const match = text.match(/^(.{10,80}?[。！？.!?])(?:\s|$)/);
    if (match) return match[1];
    return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

/** 中文长句不能只按整句匹配；从真实查询中抽 2–4 字短语，不维护第二张业务同义词表。 */
function buildCapabilitySearchTerms(query: string): string[] {
    const terms = unique(query.split(/[\s,，。；;、/|]+/u));
    const cjkRuns = query.match(/[\p{Script=Han}]{2,}/gu) || [];
    for (const run of cjkRuns) {
        for (let size = Math.min(4, run.length); size >= 2; size -= 1) {
            for (let index = 0; index <= run.length - size; index += 1) {
                terms.push(run.slice(index, index + size));
            }
        }
    }
    return unique(terms).filter((term) => term.length >= 2).slice(0, 60);
}

export function createAgentCapabilitySession(
    input: CreateAgentCapabilitySessionInput
): AgentCapabilitySession {
    const deniedProviderToolNames = new Set(
        unique(input.deniedProviderToolNames || []).map((name) => name.toLowerCase())
    );
    const candidateTools = input.candidateTools.filter((tool) => (
        !deniedProviderToolNames.has(cleanName(tool.name).toLowerCase())
    ));
    const candidateToolNames = candidateTools.map((tool) => tool.name);
    const inventory = buildRuntimeCapabilityInventory({
        executableToolNames: candidateToolNames,
        workflowBridgeNames: input.workflowBridgeNames
    });
    const deniedKinds = new Set(input.deniedCapabilityKinds || []);
    const baseDeniedCapabilityIds = unique([
        ...(input.deniedCapabilityIds || []),
        ...inventory
            .filter((entry) => deniedKinds.has(entry.kind))
            .map((entry) => entry.capabilityId)
    ]);
    const manifestRequiredCapabilityIds = unique(input.manifestRequiredCapabilityIds || []);
    const manifestRequiredProviderToolNames = new Set(
        unique(input.manifestRequiredProviderToolNames || [])
    );
    const manifestRequiredProviderCapabilityIds = inventory
        .filter((entry) => entry.providerToolNames.some((toolName) => (
            manifestRequiredProviderToolNames.has(toolName)
        )))
        .map((entry) => entry.capabilityId);
    const initialDeniedCapabilityIds = input.manifest
        ? baseDeniedCapabilityIds
        : unique([
            ...baseDeniedCapabilityIds,
            ...manifestRequiredCapabilityIds,
            ...manifestRequiredProviderCapabilityIds
        ]);
    let resolution = resolveAgentCapabilities({
        manifest: input.manifest,
        requestedTaskType: input.requestedTaskType,
        inventory,
        candidateToolNames,
        baselineCapabilityIds: input.baselineCapabilityIds,
        initialCapabilityIds: resolveSkillRuntimeInitialCapabilities(input.manifest, input.workMode),
        capabilityCeilingIds: resolveSkillRuntimeCapabilityCeiling(input.manifest, input.workMode),
        deniedCapabilityIds: initialDeniedCapabilityIds,
        additionalCapabilityProviders: input.additionalCapabilityProviders
    });
    const activeTools: ToolSchema[] = [];
    const onDemandActivatedCapabilityIds = new Set<string>();
    // 只由结构化运行结果触发。它不进入 Manifest ceiling / on-demand 目录，
    // 避免环境诊断污染业务能力面或首轮 schema。
    const environmentRecoveryCapabilityIds = new Set<string>();
    const allowedEnvironmentRecoveryCapabilityIds = new Set(
        HARNESS_ENVIRONMENT_RECOVERY_CAPABILITY_IDS
    );

    function refreshActiveTools(): void {
        const selectedSet = new Set(resolution.selectedToolNames);
        const deniedToolNames = new Set(resolution.deniedToolNames);
        inventory.forEach((entry) => {
            if (!environmentRecoveryCapabilityIds.has(entry.capabilityId)) return;
            entry.providerToolNames.forEach((toolName) => {
                if (!deniedToolNames.has(toolName)) selectedSet.add(toolName);
            });
        });
        const nextTools = candidateTools.filter((tool) => selectedSet.has(tool.name));
        if (resolution.onDemandCapabilityIds.length > 0) {
            nextTools.push(buildSearchToolSchema(resolution));
            nextTools.push(buildRequestToolSchema(resolution));
        }
        activeTools.splice(0, activeTools.length, ...nextTools);
    }

    refreshActiveTools();

    const toolSearchTextByName = new Map<string, string>(
        candidateTools.map((tool) => {
            const semantics = getPhotoshopToolSkillSemantics(tool.name);
            const displayInfo = getToolDisplayInfo(tool.name);
            return [tool.name, [
                displayInfo.name,
                displayInfo.description,
                firstSentence(tool.description),
                semantics?.userIntentBoundary || ''
            ].filter(Boolean).join(' ')] as [string, string];
        })
    );

    /** 能力 id 的家族名：≥3 段取前两段（photoshop.write.moveLayer → photoshop.write），否则取首段。 */
    function familyOfCapabilityId(capabilityId: string): string {
        const segments = cleanName(capabilityId).split('.');
        if (segments.length >= 3) return `${segments[0]}.${segments[1]}`;
        return segments[0] || capabilityId;
    }

    function searchCapabilityInventory(query: string, limit: number = 5): AgentCapabilitySearchResult {
        const normalizedQuery = cleanName(query).toLowerCase();
        const boundedLimit = Math.min(8, Math.max(1, Math.floor(Number(limit) || 5)));
        if (!normalizedQuery) {
            return {
                query: '',
                matches: [],
                availableCount: resolution.onDemandCapabilityIds.length,
                message: '请描述马上缺少的具体动作，例如「读取网页」「主体抠图」或「导出 PNG」。'
            };
        }
        const terms = buildCapabilitySearchTerms(normalizedQuery);
        const loadableIds = new Set(resolution.onDemandCapabilityIds);
        const activeIds = new Set([
            ...resolution.selectedCapabilityIds,
            ...environmentRecoveryCapabilityIds
        ]);
        const scored = inventory
            .filter((entry) => loadableIds.has(entry.capabilityId) || activeIds.has(entry.capabilityId))
            .map((entry) => {
                const description = toolSearchTextByName.get(entry.providerToolNames[0] || '') || '';
                const family = familyOfCapabilityId(entry.capabilityId);
                const haystack = [
                    entry.capabilityId,
                    family,
                    ...entry.providerToolNames,
                    description
                ].join(' ').toLowerCase();
                let score = 0;
                if (entry.capabilityId.toLowerCase() === normalizedQuery) score += 1000;
                if (entry.providerToolNames.some((name) => name.toLowerCase() === normalizedQuery)) score += 800;
                if (haystack.includes(normalizedQuery)) score += 200;
                for (const term of terms) {
                    const termWeight = 10 + Math.min(30, term.length * 5);
                    if (haystack.includes(term)) score += termWeight;
                    if (entry.capabilityId.toLowerCase().includes(term)) score += Math.ceil(termWeight / 2);
                }
                return { entry, description, family, score };
            })
            .filter((item) => item.score > 0)
            .sort((left, right) => (
                right.score - left.score
                || left.entry.capabilityId.localeCompare(right.entry.capabilityId)
            ))
            .slice(0, boundedLimit);
        const matches: AgentCapabilitySearchMatch[] = scored.map((item) => ({
            capabilityId: item.entry.capabilityId,
            family: item.family,
            providerToolNames: item.entry.providerToolNames.slice(0, 4),
            description: item.description,
            availability: activeIds.has(item.entry.capabilityId) ? 'active' : 'loadable'
        }));
        const activeMatchCount = matches.filter((match) => match.availability === 'active').length;
        const loadableMatchCount = matches.length - activeMatchCount;
        return {
            query: normalizedQuery,
            matches,
            availableCount: resolution.onDemandCapabilityIds.length,
            message: matches.length > 0
                ? `找到 ${matches.length} 项：${activeMatchCount} 项已可直接调用，${loadableMatchCount} 项需要装载；不要申请 active 项。`
                : '没有匹配项。请换成动作和对象描述重试；不要猜 capability id。'
        };
    }

    return {
        activeTools,
        candidateToolNames,
        inventory,
        getResolution(): AgentCapabilityResolution {
            return resolution;
        },
        getActiveCapabilityIdsForTool(toolName: string): string[] {
            const normalizedToolName = cleanName(toolName);
            if (!normalizedToolName || resolution.deniedToolNames.includes(normalizedToolName)) return [];
            const selectedCapabilityIds = new Set([
                ...resolution.selectedCapabilityIds,
                ...environmentRecoveryCapabilityIds
            ]);
            return unique(inventory
                .filter((entry) => (
                    selectedCapabilityIds.has(entry.capabilityId)
                    && entry.providerToolNames.includes(normalizedToolName)
                ))
                .map((entry) => entry.capabilityId));
        },
        getOnDemandActivatedCapabilityIds(): string[] {
            return Array.from(onDemandActivatedCapabilityIds);
        },
        bindManifest(manifest: SkillRuntimeManifest, workMode?: RuntimeDesignWorkMode): void {
            const priorOnDemand = Array.from(onDemandActivatedCapabilityIds);
            let nextResolution = resolveAgentCapabilities({
                manifest,
                inventory,
                candidateToolNames,
                baselineCapabilityIds: input.baselineCapabilityIds,
                initialCapabilityIds: resolveSkillRuntimeInitialCapabilities(manifest, workMode),
                capabilityCeilingIds: resolveSkillRuntimeCapabilityCeiling(manifest, workMode),
                deniedCapabilityIds: baseDeniedCapabilityIds,
                additionalCapabilityProviders: input.additionalCapabilityProviders
            });
            // bindManifest 只保留新 Manifest 下仍可按需激活的旧能力。越过 work-mode ceiling
            // 的旧能力是“已被收窄”，不是本次请求失败；若把它们重新送进 expand，会把
            // 正常的 late bind 污染成 partial。旧能力可能来自多轮请求，因此按同一服务端
            // 批次上限重放，而不是用一次超限请求制造假失败。
            const preservableOnDemand = priorOnDemand.filter((capabilityId) => (
                nextResolution.onDemandCapabilityIds.includes(capabilityId)
            ));
            const reactivatedCapabilityIds: string[] = [];
            for (let index = 0; index < preservableOnDemand.length; index += MAX_ON_DEMAND_CAPABILITY_REQUESTS) {
                const reActivation = expandAgentCapabilities({
                    resolution: nextResolution,
                    inventory,
                    requestedCapabilityIds: preservableOnDemand.slice(
                        index,
                        index + MAX_ON_DEMAND_CAPABILITY_REQUESTS
                    ),
                    additionalCapabilityProviders: input.additionalCapabilityProviders
                });
                nextResolution = reActivation.resolution;
                reactivatedCapabilityIds.push(...reActivation.activatedCapabilityIds);
            }
            resolution = nextResolution;
            onDemandActivatedCapabilityIds.clear();
            reactivatedCapabilityIds.forEach((capabilityId) => {
                onDemandActivatedCapabilityIds.add(capabilityId);
            });
            refreshActiveTools();
        },
        searchCapabilities(query: string, limit?: number): AgentCapabilitySearchResult {
            return searchCapabilityInventory(query, limit);
        },
        requestCapabilities(capabilityIds: readonly string[]): AgentCapabilityActivationResult {
            const activation = expandAgentCapabilities({
                resolution,
                inventory,
                requestedCapabilityIds: capabilityIds,
                additionalCapabilityProviders: input.additionalCapabilityProviders
            });
            activation.activatedCapabilityIds.forEach((capabilityId) => {
                onDemandActivatedCapabilityIds.add(capabilityId);
            });
            resolution = activation.resolution;
            refreshActiveTools();
            return activation;
        },
        activateToolsForContinuation(toolNames: readonly string[]): string[] {
            const requestedToolNames = new Set(unique(toolNames));
            if (requestedToolNames.size === 0) return [];
            const remainingCapabilityIds = new Set(resolution.onDemandCapabilityIds);
            const capabilityIds = inventory
                .filter((entry) => (
                    entry.kind === 'tool'
                    && remainingCapabilityIds.has(entry.capabilityId)
                    && entry.providerToolNames.some((toolName) => requestedToolNames.has(toolName))
                ))
                .map((entry) => entry.capabilityId);
            const activatedCapabilityIds: string[] = [];
            for (let index = 0; index < capabilityIds.length; index += MAX_ON_DEMAND_CAPABILITY_REQUESTS) {
                const activation = expandAgentCapabilities({
                    resolution,
                    inventory,
                    requestedCapabilityIds: capabilityIds.slice(
                        index,
                        index + MAX_ON_DEMAND_CAPABILITY_REQUESTS
                    ),
                    additionalCapabilityProviders: input.additionalCapabilityProviders
                });
                activation.activatedCapabilityIds.forEach((capabilityId) => {
                    onDemandActivatedCapabilityIds.add(capabilityId);
                    activatedCapabilityIds.push(capabilityId);
                });
                resolution = activation.resolution;
            }
            const selectedCapabilityIds = new Set(resolution.selectedCapabilityIds);
            const deniedToolNames = new Set(resolution.deniedToolNames);
            inventory.forEach((entry) => {
                if (!allowedEnvironmentRecoveryCapabilityIds.has(entry.capabilityId)) return;
                if (selectedCapabilityIds.has(entry.capabilityId)) return;
                if (!entry.providerToolNames.some((toolName) => requestedToolNames.has(toolName))) return;
                if (!entry.providerToolNames.some((toolName) => !deniedToolNames.has(toolName))) return;
                if (environmentRecoveryCapabilityIds.has(entry.capabilityId)) return;
                environmentRecoveryCapabilityIds.add(entry.capabilityId);
                activatedCapabilityIds.push(entry.capabilityId);
            });
            refreshActiveTools();
            return unique(activatedCapabilityIds);
        },
        buildPromptSection(): string {
            return [
                '当前工具列表就是现在可以直接使用的动作。下一步已经能做时直接执行；搜索结果为 active 时使用其 providerToolNames，不要重复申请能力。',
                resolution.onDemandCapabilityIds.length > 0
                    ? `缺少下一步动作时，先用 ${SEARCH_AGENT_CAPABILITIES_TOOL_NAME} 按用途检索，再把返回的精确 id 交给 ${REQUEST_AGENT_CAPABILITIES_TOOL_NAME}；加入后直接继续。`
                    : '当前没有需要额外加入的能力，直接使用具体动作。',
                '只查看会影响下一步设计的内容；目标明确时尽早做出可逆版本，修改后再看当前效果。',
                '动作失败时只调整当前这一步，不要重新猜整个任务，也不要用随机调用试探能力。'
            ].join('\n');
        }
    };
}
