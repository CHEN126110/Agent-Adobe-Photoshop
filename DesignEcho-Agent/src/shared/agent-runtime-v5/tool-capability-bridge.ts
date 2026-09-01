/**
 * Legacy tool capability bridge
 *
 * v5 Skill manifests declare namespaced tool capabilities. The current renderer
 * Agent still exposes legacy executable tool schema names. This file keeps that
 * mismatch explicit while the tool registry migrates.
 */

import type { SkillRuntimeManifest } from './contracts';

export interface LegacyToolCapabilityBridgeEntry {
    capability: string;
    executableTools: string[];
    status: 'mapped' | 'unmapped';
}

export interface LegacyToolCapabilityBridge {
    version: 'legacy-tool-capability-bridge/v0';
    skillId: string;
    taskType: string;
    /**
     * 当前 Manifest 显式声明的 workflow bridge 入口。
     *
     * 它与 capability provider Tool 分开记账：前者拥有整项交付物，后者只提供
     * 原子能力。Agent 可在 E1 漂移时回到已选执行 owner，而不靠品类关键词猜测。
     */
    workflowEntryTools: string[];
    entries: LegacyToolCapabilityBridgeEntry[];
    mappedCapabilities: string[];
    unmappedCapabilities: string[];
    executableTools: string[];
}

export interface BuildLegacyToolCapabilityBridgeInput {
    manifest: SkillRuntimeManifest;
    executableToolNames: readonly string[];
}

export const LEGACY_TOOL_CAPABILITY_MAP: Readonly<Record<string, readonly string[]>> = Object.freeze({
    // 简短选择、必要事实与授权确认统一走受控选择卡。createInteractiveCard
    // 只负责多字段可编辑草稿，不能再冒充确认能力。
    'agent.interaction.requestConfirmation': ['askUserToChoose'],
    'agent.interaction.editStructuredDraft': ['createInteractiveCard'],
    'agent.intent.declareDesignTask': ['declareDesignIntent'],
    'agent.team.collaborate': ['delegateToAgent', 'runDesignTeamPipeline'],
    'project.listResources': ['listProjectResources'],
    'project.searchResources': ['searchProjectResources'],
    'project.observeAssets': ['analyzeProjectContactSheetOverview'],
    // 首轮上下文只装载一对一叶子能力；聚合 capability 仍供 Manifest 和按需检索使用。
    // 这样“9 个能力”不会在 provider 层悄悄膨胀为二十多个 Tool schema。
    'knowledge.read.getDesignPrinciples': ['getDesignPrinciples'],
    'knowledge.read.designFoundation': [
        'getDesignKnowledge',
        'getDesignPrinciples',
        'getMainImageDesignFramework',
        'getDetailPageDesignFramework',
        'searchDesignKnowledge',
        'analyzePsdDesignSource',
        'measureReferenceComposition'
    ],
    'memory.read.designProjectState': ['getDesignProjectState'],
    'memory.designProjectState': ['getDesignProjectState', 'updateDesignProjectState'],
    // 设计任务卡：计划 = 完成契约（模型写卡，Harness 核收据打勾）
    'plan.designTaskCard': ['planDesignTaskCard', 'updateDesignTaskCard', 'getDesignTaskCard', 'askUserToChoose'],
    // 独立评审器：出稿后评好不好看（四标准 + 硬伤），结果进任务卡「验」栏
    'review.evaluateDesign': ['evaluateDesign'],
    // 学习闭环：用户留改弃进候选区 + 「学到了什么」时间线
    'learn.designCandidates': ['recordDesignVerdict', 'getDesignLearningTimeline', 'learnTasteFromEagle'],
    'preview.renderStoryboard': ['renderLayout'],
    // 整稿车间是可选的批量编译能力；普通创意首轮先保留更小的原子工作台，
    // Agent 确实已经形成完整 regions / visualStyle 时再按需装载。
    'photoshop.write.composeDesign': ['composeDesign'],
    'eagle.read.searchReferences': ['searchEagleReferences', 'searchDesignKnowledge'],
    'eagle.read.analyzeReference': ['analyzeEagleReference'],
    // 看参考：带目的说得出好坏并形成可复核学习候选；不能在线沉淀正式原则。
    'reference.study': ['studyReference'],
    'eagle.read.observeAsset': ['observeEagleAsset'],
    'project.importEagleAsset': ['importEagleAssetToProject'],
    // 外部参考检索（2026-08-16 全量工具审计补齐）：用户贴链接/要联网时，搜索与读页
    // 必须第一轮就对模型可见——此前它们只在被截断的按需目录里，真机表现为模型
    // 诚实但错误地宣称「没有实时抓取网页内容的能力」（13:05 淘宝链接案例）。
    'web.searchInternet': ['webSearch'],
    'web.readPageContent': [
        'fetchWebPageDesignContent',
        'listBrowserTabs',
        'readBrowserPage',
        'captureBrowserTab'
    ],
    // 浏览器是 Harness 提供的跨业务 Tool Provider；Skill 只声明依赖，
    // 不复制导航和交互实现。两项状态能力按需装载，执行点仍负责审批与副作用约束。
    'web.navigatePage': ['navigateBrowserTab'],
    'web.interactPage': ['interactWithBrowserPage'],
    'photoshop.read.getDocumentSummary': [
        'getDocumentInfo',
        'listDocuments',
        'switchDocument',
        'getLayerHierarchy'
    ],
    'photoshop.read.getDocumentInfo': ['getDocumentInfo'],
    'photoshop.read.listDocuments': ['listDocuments'],
    'photoshop.state.switchDocument': ['switchDocument'],
    'photoshop.read.getLayerHierarchy': ['getLayerHierarchy'],
    'photoshop.read.getAcceptanceSnapshot': ['getAcceptanceSnapshot'],
    'photoshop.read.getCanvasSnapshot': ['getCanvasSnapshot'],
    'photoshop.read.inspectDetailPageTemplate': ['parseDetailPageTemplate', 'detectLayerIssues'],
    'photoshop.read.getVisualSnapshot': [
        'getAnnotatedSnapshot',
        'getDocumentSnapshot',
        'getAcceptanceSnapshot',
        'getCanvasSnapshot',
        'getScreenSnapshots',
    ],
    'photoshop.read.inspectLayers': [
        'getLayerHierarchy',
        'findLayers',
        'getAllTextLayers',
        'getLayerProperties',
        'getClippingMaskInfo',
        'getAllClippingMasks',
        'getTextContent',
        'getTextStyle',
        'getSmartObjectInfo',
        'getSmartObjectLayers'
    ],
    'photoshop.read.getLayerBounds': ['getLayerBounds', 'getLayerProperties'],
    'photoshop.apply.fixDetailPageTemplate': ['fixLayerIssues'],
    'photoshop.apply.matchDetailPageContent': ['matchDetailPageContent'],
    'photoshop.apply.fillDetailPageTemplate': ['fillDetailPage'],
    'photoshop.sandbox.createDocument': ['createDocument'],
    'photoshop.sandbox.createScreenGroup': ['createDocument', 'renderLayout'],
    'photoshop.sandbox.createShape': ['createRectangle', 'createEllipse'],
    'photoshop.sandbox.createSkuPlaceholders': ['createSkuPlaceholders'],
    // 叶子 capability 保留既有稳定身份；manageLayers 同时装载完成局部编辑所需的
    // 可逆原子动作，避免专用占位替换 provider 缺失时失去 place + clip 路径。
    'photoshop.write.moveLayer': ['moveLayer'],
    'photoshop.write.reorderLayer': ['reorderLayer'],
    'photoshop.write.alignLayers': ['alignLayers'],
    'photoshop.write.fitLayerSubjectToRegion': ['fitLayerSubjectToRegion'],
    'photoshop.write.setLayerVisibility': ['setLayerVisibility'],
    'photoshop.write.renameLayer': ['renameLayer'],
    // TransactionRunner V0 认证包只接受一对一叶子 Capability。broad sandbox
    // capability 继续用于旧 Tool surface，但不能借此取得可执行 R4 节点资格。
    'photoshop.write.groupLayersSafely': ['groupLayersSafely'],
    'photoshop.write.lockLayer': ['lockLayer'],
    'photoshop.write.createTextLayer': ['createTextLayer'],
    'photoshop.write.setTextStyle': ['setTextStyle'],
    'photoshop.write.setTextContent': ['setTextContent'],
    'photoshop.write.setLayerOpacity': ['setLayerOpacity'],
    'photoshop.write.setBlendMode': ['setBlendMode'],
    'photoshop.write.setLayerFill': ['setLayerFill'],
    'photoshop.write.replaceSmartObjectContents': ['replaceSmartObjectContents'],
    'photoshop.write.placeImage': ['placeImage'],
    'photoshop.write.replaceImagePlaceholder': ['replaceImagePlaceholder'],
    'photoshop.write.transformLayer': ['transformLayer'],
    'photoshop.sandbox.manageLayers': [
        'createGroup',
        'groupLayersSafely',
        'groupLayers',
        'ungroupLayers',
        'moveLayer',
        'reorderLayer',
        'moveLayerToGroup',
        'alignLayers',
        'fitLayerSubjectToRegion',
        'setLayerVisibility',
        'renameLayer',
        'batchRenameLayers',
        'createClippingMask'
    ],
    'photoshop.sandbox.editSmartObject': [
        'convertToSmartObject',
        'editSmartObjectContents',
        'getSmartObjectInfo',
        'closeDocument',
        'switchDocument'
    ],
    'photoshop.sandbox.placeImage': ['placeImage'],
    'photoshop.sandbox.replaceImagePlaceholder': ['replaceImagePlaceholder'],
    'photoshop.sandbox.transformLayer': ['transformLayer'],
    'photoshop.sandbox.writeText': [
        'resolveFontName',
        'createTextLayer',
        'setTextContent',
        'setTextStyle'
    ],
    'delivery.exportSlices': ['exportDetailPageSlices'],
    'delivery.exportAsset': ['exportGroup', 'quickExport'],
    'delivery.saveDocument': ['saveDocument']
});

export interface SelectPreferredLegacyToolsInput {
    capabilityIds: readonly string[];
    executableToolNames: readonly string[];
}

export interface SelectLegacyToolProvidersInput {
    capabilityIds: readonly string[];
    executableToolNames: readonly string[];
}

/**
 * 为阶段规划选择每个 Capability 的首选 provider Tool。
 * 这是 Capability→Tool 的通用映射收敛，不按任务品类或用户文本建立白名单。
 */
export function selectPreferredLegacyToolsForCapabilities(
    input: SelectPreferredLegacyToolsInput
): string[] {
    const executableSet = new Set(unique(input.executableToolNames));
    const selected: string[] = [];
    unique(input.capabilityIds).forEach((capabilityId) => {
        const preferred = (LEGACY_TOOL_CAPABILITY_MAP[capabilityId] || [])
            .find((toolName) => executableSet.has(toolName));
        if (preferred) selected.push(preferred);
    });
    return unique(selected);
}

/**
 * 为已经激活的 Capability 返回可执行 provider，并按 Capability 轮询展开。
 *
 * 正常阶段仍应使用 selectPreferredLegacyToolsForCapabilities 保持 Tool surface 精简；
 * 只有 Harness 已确认存在来源缺口时，才应有界地使用本函数公开替代 provider。
 * 轮询顺序避免一个 provider 很多的 Capability 永久遮住其他观察通道。
 */
export function selectLegacyToolProvidersForCapabilities(
    input: SelectLegacyToolProvidersInput
): string[] {
    const executableSet = new Set(unique(input.executableToolNames));
    const providerGroups = unique(input.capabilityIds)
        .map((capabilityId) => (
            unique(LEGACY_TOOL_CAPABILITY_MAP[capabilityId] || [])
                .filter((toolName) => executableSet.has(toolName))
        ))
        .filter((providerNames) => providerNames.length > 0);
    const selected: string[] = [];
    const maximumProviderCount = providerGroups.reduce(
        (maximum, providerNames) => Math.max(maximum, providerNames.length),
        0
    );
    for (let providerIndex = 0; providerIndex < maximumProviderCount; providerIndex += 1) {
        providerGroups.forEach((providerNames) => {
            const providerName = providerNames[providerIndex];
            if (providerName) selected.push(providerName);
        });
    }
    return unique(selected);
}

function normalizeName(value: unknown): string {
    return String(value || '').trim();
}

function unique(values: readonly string[]): string[] {
    return Array.from(new Set(values.map(normalizeName).filter(Boolean)));
}

export function buildLegacyToolCapabilityBridge(
    input: BuildLegacyToolCapabilityBridgeInput
): LegacyToolCapabilityBridge {
    const executableNameSet = new Set(unique(input.executableToolNames));
    const workflowEntryTools = unique(input.manifest.workflow_entry_skill_ids || [])
        .filter((toolName) => executableNameSet.has(toolName));
    const entries = input.manifest.available_tools.map((capability) => {
        const candidates = LEGACY_TOOL_CAPABILITY_MAP[capability] || [];
        const executableTools = candidates.filter((toolName) => executableNameSet.has(toolName));
        return {
            capability,
            executableTools,
            status: executableTools.length > 0 ? 'mapped' : 'unmapped'
        } satisfies LegacyToolCapabilityBridgeEntry;
    });

    return {
        version: 'legacy-tool-capability-bridge/v0',
        skillId: input.manifest.skill_id,
        taskType: input.manifest.task_type,
        workflowEntryTools,
        entries,
        mappedCapabilities: entries
            .filter((entry) => entry.status === 'mapped')
            .map((entry) => entry.capability),
        unmappedCapabilities: entries
            .filter((entry) => entry.status === 'unmapped')
            .map((entry) => entry.capability),
        executableTools: unique(entries.flatMap((entry) => entry.executableTools))
    };
}

export function summarizeLegacyToolCapabilityBridge(bridge: LegacyToolCapabilityBridge): string {
    const lines = [
        `Tool capability bridge: ${bridge.version}`,
        `Skill: ${bridge.skillId} (${bridge.taskType})`,
        `Workflow entry: ${(bridge.workflowEntryTools || []).join(', ') || 'none'}`
    ];

    bridge.entries.forEach((entry) => {
        const target = entry.executableTools.length
            ? entry.executableTools.join(', ')
            : 'unmapped';
        lines.push(`${entry.capability} -> ${target}`);
    });

    if (bridge.unmappedCapabilities.length) {
        lines.push(`Unmapped capabilities: ${bridge.unmappedCapabilities.join(', ')}`);
    }

    return lines.join('\n');
}
