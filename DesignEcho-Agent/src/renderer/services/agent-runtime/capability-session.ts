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
import type { ToolSchema } from './types';

export const REQUEST_AGENT_CAPABILITIES_TOOL_NAME = 'requestAgentCapabilities';

export function isAgentCapabilityControlTool(value: unknown): boolean {
    return cleanName(value) === REQUEST_AGENT_CAPABILITIES_TOOL_NAME;
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
    'knowledge.read.designFoundation',
    'photoshop.read.getVisualSnapshot',
    'photoshop.sandbox.createDocument',
    'preview.renderStoryboard',
    'photoshop.write.fitLayerSubjectToRegion',
    // 抠图是通用电商设计基本工艺，不是白底图/SKU 等业务 Skill 的专属能力。
    // 放入基础自我认知后，模型在 R3 就知道普通项目图片可以在 E1 抠图，
    // 不会因为按需目录截断而把“透明底素材”误报为只能由用户提供的阻塞输入。
    'photoshop.write.removeBackground'
]);

/**
 * 唯一 advisory Skill 推荐的首轮快速路径。
 *
 * 每个 Capability 当前都只展开一个只读 provider Tool：项目列举/搜索、文档身份、
 * 单画布快照和图层树。推荐 Skill 不匹配或仍缺少动作时，其余原子 Tool / Skill 继续通过
 * requestAgentCapabilities 按需装载；这里不授予权限，也不绑定 Runtime Manifest。
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
    return unique([
        ...HARNESS_BASELINE_CAPABILITY_IDS,
        ...(designExecutionRequired ? DESIGN_EXECUTION_FOUNDATION_CAPABILITY_IDS : [])
    ]);
}

function buildRequestToolSchema(resolution: AgentCapabilityResolution): ToolSchema {
    const capabilityIds = [...resolution.onDemandCapabilityIds];
    const capabilityItemSchema: Record<string, any> = {
        type: 'string',
        description: '要在下一轮装载的能力 id。只选择完成当前下一步真正需要的能力。'
    };
    if (capabilityIds.length > 0) capabilityItemSchema.enum = capabilityIds;

    return {
        name: REQUEST_AGENT_CAPABILITIES_TOOL_NAME,
        description: [
            '当下一步真正需要的动作不在当前工具列表时，临时加入相应能力。',
            '一次只选择马上要用的最少项；加入后直接使用具体动作，不要重复申请。'
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

/** 取 Tool schema 描述的第一句作为能力目录的一句话说明；过长时截断。 */
function firstSentence(value: unknown): string {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const match = text.match(/^(.{10,80}?[。！？.!?])(?:\s|$)/);
    if (match) return match[1];
    return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

const MAX_ON_DEMAND_CATALOG_TOOL_LINES = 40;
const MAX_ON_DEMAND_CATALOG_OTHER_LINES = 10;

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
    const deniedCapabilityIds = unique([
        ...(input.deniedCapabilityIds || []),
        ...inventory
            .filter((entry) => deniedKinds.has(entry.kind))
            .map((entry) => entry.capabilityId)
    ]);
    let resolution = resolveAgentCapabilities({
        manifest: input.manifest,
        requestedTaskType: input.requestedTaskType,
        inventory,
        candidateToolNames,
        baselineCapabilityIds: input.baselineCapabilityIds,
        initialCapabilityIds: resolveSkillRuntimeInitialCapabilities(input.manifest, input.workMode),
        capabilityCeilingIds: resolveSkillRuntimeCapabilityCeiling(input.manifest, input.workMode),
        deniedCapabilityIds,
        additionalCapabilityProviders: input.additionalCapabilityProviders
    });
    const activeTools: ToolSchema[] = [];
    const onDemandActivatedCapabilityIds = new Set<string>();

    function refreshActiveTools(): void {
        const selectedSet = new Set(resolution.selectedToolNames);
        const nextTools = candidateTools.filter((tool) => selectedSet.has(tool.name));
        if (resolution.onDemandCapabilityIds.length > 0) {
            nextTools.push(buildRequestToolSchema(resolution));
        }
        activeTools.splice(0, activeTools.length, ...nextTools);
    }

    refreshActiveTools();

    const toolDescriptionByName = new Map<string, string>(
        candidateTools.map((tool) => [tool.name, firstSentence(tool.description)])
    );

    function buildCapabilityLine(entry: RuntimeCapabilityInventoryEntry): string {
        const providerNames = entry.providerToolNames.slice(0, 3);
        const providerSuffix = entry.providerToolNames.length > providerNames.length
            ? ` +${entry.providerToolNames.length - providerNames.length}`
            : '';
        const description = toolDescriptionByName.get(entry.providerToolNames[0] || '') || '';
        const detailText = description ? ` — ${description}` : '';
        return `- ${entry.capabilityId} → ${providerNames.join(', ')}${providerSuffix}${detailText}`;
    }

    /**
     * On-demand 能力的可读目录：裸 id 列表对模型没有信息量——它无法从
     * photoshop.sandbox.writeText 这种 id 推断用途。目录把每个 id 映射到首个
     * provider Tool 的一句话描述，requestAgentCapabilities 才真正可用。
     */
    function buildOnDemandCatalogLines(): string[] {
        if (resolution.onDemandCapabilityIds.length === 0) return [];
        const byId = new Map(inventory.map((entry) => [entry.capabilityId, entry]));
        const skillLines: string[] = [];
        const toolLines: string[] = [];
        const otherLines: string[] = [];
        resolution.onDemandCapabilityIds.forEach((capabilityId) => {
            const entry = byId.get(capabilityId);
            const line = entry ? buildCapabilityLine(entry) : `- ${capabilityId}`;
            if (entry?.kind === 'skill') {
                skillLines.push(line);
            } else if (entry?.kind === 'tool') {
                toolLines.push(line);
            } else {
                otherLines.push(line);
            }
        });
        const lines: string[] = ['还可按需加入的能力：'];
        skillLines.forEach((line) => lines.push(line));
        toolLines.slice(0, MAX_ON_DEMAND_CATALOG_TOOL_LINES).forEach((line) => lines.push(line));
        if (toolLines.length > MAX_ON_DEMAND_CATALOG_TOOL_LINES) {
            lines.push(`- 还有 ${toolLines.length - MAX_ON_DEMAND_CATALOG_TOOL_LINES} 项编辑能力未展开`);
        }
        otherLines.slice(0, MAX_ON_DEMAND_CATALOG_OTHER_LINES).forEach((line) => lines.push(line));
        if (otherLines.length > MAX_ON_DEMAND_CATALOG_OTHER_LINES) {
            lines.push(`- 还有 ${otherLines.length - MAX_ON_DEMAND_CATALOG_OTHER_LINES} 项其他能力未展开`);
        }
        return lines;
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
            const selectedCapabilityIds = new Set(resolution.selectedCapabilityIds);
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
                deniedCapabilityIds,
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
            refreshActiveTools();
            return unique(activatedCapabilityIds);
        },
        buildPromptSection(): string {
            return [
                '当前工具列表就是现在可以直接使用的动作。下一步已经能做时直接执行，不要重复申请能力。',
                ...buildOnDemandCatalogLines(),
                resolution.onDemandCapabilityIds.length > 0
                    ? `只有下一步确实缺少动作时，才用 ${REQUEST_AGENT_CAPABILITIES_TOOL_NAME} 从上面选择最少的相关能力；加入后直接继续制作。`
                    : '当前没有需要额外加入的能力，直接使用具体动作。',
                '只查看会影响下一步设计的内容；目标明确时尽早做出可逆版本，修改后再看当前效果。',
                '动作失败时只调整当前这一步，不要重新猜整个任务，也不要用随机调用试探能力。'
            ].join('\n');
        }
    };
}
