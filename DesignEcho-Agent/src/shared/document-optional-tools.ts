/**
 * 无文档可用工具共享常量
 *
 * 统一三层工具过滤中"无文档时仍可调用"的工具列表，
 * 避免工具决策契约（agent-tool-decision-contract.ts）和
 * freshDetailPage 状态机守卫（autonomous-agent.executor.ts）各自维护不同步。
 *
 * 用途：
 * 1. agent-tool-decision-contract.ts: DOCUMENT_OPTIONAL_TOOLS — 工具决策契约判定
 * 2. autonomous-agent.executor.ts: FRESH_DETAIL_PAGE_PRE_DOCUMENT_TOOL_NAMES — 状态机守卫基础列表
 */

import { getSkillById } from './skills/skill-declarations';

/**
 * 基础无文档可用工具列表：这些工具不依赖当前打开的 Photoshop 文档。
 * 包括：文档管理、项目资源读取、视觉分析、设计知识、AI 生成。
 */
export const BASE_DOCUMENT_OPTIONAL_TOOL_NAMES: readonly string[] = [
    // 交互卡片
    'createInteractiveCard',
    // Capability Resolver：只扩展下一轮模型 schema，不依赖 Photoshop 文档
    'requestAgentCapabilities',
    // 文档管理（创建/切换/列表不依赖已打开文档）
    'createDocument',
    'listDocuments',
    'switchDocument',
    'getDocumentInfo',
    // 项目资源读取
    'listProjectResources',
    'searchProjectResources',
    'getResourceSummary',
    'getAssetPreview',
    'openProjectFile',
    // 视觉分析
    'analyzeProjectContactSheetOverview',
    'analyzeAssetContent',
    'recommendAssets',
    'describeImage',
    // 设计知识
    'getDetailPageDesignFramework',
    'getMainImageDesignFramework',
    'getDesignPrinciples',
    // 声明设计意图：不依赖已打开文档，须在 createDocument 前即可调用（早窗口声明）
    'declareDesignIntent',
    'searchDesignKnowledge',
    'searchEagleReferences',
    // 项目状态
    'getDesignProjectState',
    'updateDesignProjectState',
    'analyzeProjectForDetailPage',
    'matchDetailPageContent',
    // AI 生成
    'generateImage',
    // 浏览器扩展工具（操作用户真实浏览器，完全不依赖 Photoshop 文档）
    'listBrowserTabs',
    'readBrowserPage',
    'captureBrowserTab',
    'navigateBrowserTab',
    'interactWithBrowserPage',
    // 字体解析（不依赖画布文档）
    'resolveFontName',
    // 图层结构读取（在文档已打开但无目标图层时仍可用）
    'getLayerHierarchy'
];

export const BASE_DOCUMENT_OPTIONAL_TOOLS: ReadonlySet<string> = new Set(BASE_DOCUMENT_OPTIONAL_TOOL_NAMES);

/**
 * 判断一个 Agent Tool / Skill 是否可以在没有打开 Photoshop 文档时启动。
 *
 * 原子工具继续使用上面的静态基础集合；工作流 Skill 则只读取自身声明，避免
 * Harness 按 sku-batch、layout-replication 等业务 id 维护例外。该判据只允许入口
 * 被调度，不代表 Skill 内部后续 Photoshop mutation 已取得目标或写入权限。
 */
export function canAgentToolStartWithoutOpenDocument(toolName: unknown): boolean {
    const normalizedToolName = String(toolName || '').trim();
    if (!normalizedToolName) return false;
    if (BASE_DOCUMENT_OPTIONAL_TOOLS.has(normalizedToolName)) return true;
    return getSkillById(normalizedToolName)?.runtimeRequirements?.document === 'not_required';
}
