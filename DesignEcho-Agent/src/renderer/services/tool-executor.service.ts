/**
 * 工具执行服务
 * 
 * 核心职责：
 * 1. 定义可用工具列表
 * 2. 执行工具调用
 * 3. 处理工具结果
 * 
 * 这是从 useChatActions.ts 精简提取的核心功能
 */

import { 
    checkToolDependencies, 
    getErrorRecovery
} from '../../shared/config/tool-dependencies';
import { toolLogger } from './tool-logger';
import { getMemoryService } from './memory.service';
import { useAppStore } from '../stores/app.store';
import {
    matchDetailPageContentPlans,
    type DetailAssetVisionSignal,
    type DetailProjectAsset
} from './skill-executors/detail-page-asset-ranker';
import {
    projectVisualCacheEntryMatchesCurrentAsset,
    normalizeProjectVisualInsightCompositionFields,
    pickPreferredProjectVisualInsightCacheEntry,
    type ProjectVisualSamplingCacheEntry
} from '../../shared/project-visual-sampling';
import {
    evaluateDesignAssetAutoPlacement,
    type DesignAssetDirectUseSuitability,
    type DesignAssetSourceTreatment,
    type DesignAssetVisualRole
} from '../../shared/design-placement-intelligence';
import {
    AcceptanceCaptureResult,
    buildToolAcceptanceVerification,
    formatToolAcceptanceDebug,
    getToolAcceptanceCapturePolicy,
    shouldCollectAcceptanceVerification
} from '../../shared/acceptance/tool-acceptance';
import { sha256Hex } from '../../shared/agent-runtime-v5/content-hash';
import { sanitizeUserVisibleDiagnosticText } from '../../shared/chat-response-cleaner';
import { parseEagleAssetRefToken } from '../../shared/eagle-asset-ref';
import { buildEagleReferenceFacetSummary } from '../../shared/eagle-reference-facets';
import {
    classifyGroupLayersOperationReconciliation
} from '../../shared/group-layers-operation-reconciliation';
import { buildPhotoshopToolSkillPromptSection } from '../../shared/photoshop-tool-skill';
import { normalizePhotoshopToolArguments } from '../../shared/photoshop-tool-parameter-normalizer';
import {
    classifyAgentToolExecution,
    DESIGN_ECHO_TARGET_GUARD_ARGUMENT
} from '../../shared/agent-tool-execution-preflight';
import {
    PHOTOSHOP_OPERATION_RESULT_VERSION,
    readPhotoshopOperationResult,
    requiresPhotoshopOperationReadback
} from '../../shared/photoshop-operation-result';
import { readPhotoshopToolDispatchFailure } from '../../shared/photoshop-tool-dispatch-error';
import {
    buildPhotoshopHistoryTransition,
    findObservedPhotoshopMutationProof,
    readPhotoshopHistoryStateRef,
    readPhotoshopHistoryTransition,
    readPhotoshopMutationCommit,
    samePhotoshopHistoryStateRef,
    type PhotoshopHistoryStateRef
} from '../../shared/photoshop-history-state-ref';
import type { ImagePlacementSpec } from '../../shared/layout/layout-engine';
import {
    buildEditableConfirmationInteractiveCard
} from '../../shared/editable-confirmation-interactive-card';
import { buildDesignProjectFactReviewCard } from '../../shared/design-project-fact-review-card';
import { buildDesignProjectRuleReviewCard } from '../../shared/design-project-rule-review-card';
import {
    buildBundledKnowledgeArtifactRecord,
    selectDesignKnowledgeResultsForUse
} from '../../shared/design-knowledge-governance';
import type { DesignKnowledgeResult } from '../../shared/design-knowledge-search';
import {
    cleanInteractiveCardText,
    stableInteractiveCardHash,
    type InteractiveCardDefinition
} from '../../shared/interactive-card-contract';
import { callPhotoshopMcpTool } from './mcp-host.client';
import { markExecutedToolResultProvenance } from './agent-runtime/tool-result-provenance';

// ==================== 工具定义 ====================

/**
 * 可用工具列表
 * 每个工具包含：名称、描述、参数说明
 */
export const AVAILABLE_TOOLS = [
    // === Agent 交互 ===
    { name: 'createInteractiveCard', description: '创建通用可交互确认卡片，让用户在聊天中确认、修改或提交结构化内容（如设计规划、开放式选项），用 cardKind="editable_confirmation" 并提供 fields。领域 Skill 自己拥有的结构化交互应由对应 Skill 产出，通用卡片不复制其业务状态。', params: '{ cardKind: "editable_confirmation"|"generic_confirmation", title?: string, description?: string, fields?: { id: string, label: string, type?: "short_text"|"long_text"|"choice"|"boolean", value?: string|boolean, required?: boolean, options?: { value: string, label: string }[] }[], initialValue?: any, payload?: any, projectId?: string, memoryEnabled?: boolean, memoryKind?: string, tags?: string[] }' },

    // === 文档/画布操作 ===
    { name: 'createDocument', description: '创建新文档', params: '{ preset?: string, width?: number, height?: number, name?: string, backgroundColor?: "white"|"black"|"transparent" }' },
    { name: 'listDocuments', description: '列出所有【已打开】的文档', params: '{ includeDetails?: boolean, includePaths?: boolean, includeDimensions?: boolean, includeLayerCount?: boolean }' },
    { name: 'switchDocument', description: '切换到【已打开】的指定文档（注意：不能打开新文件，只能切换）', params: '{ documentName: string }' },
    { name: 'closeDocument', description: '关闭指定文档（批量操作后清理）。不保存修改除非指定 save: true', params: '{ documentName?: string, documentId?: number, save?: boolean }' },
    { name: 'getDocumentInfo', description: '获取当前文档信息', params: '{}' },
    { name: 'getDocumentSnapshot', description: '获取文档快照（用于视觉分析）', params: '{ maxSize?: number }' },
    { name: 'getAcceptanceSnapshot', description: '获取轻量验收快照（文档、图层、文字、边界、选中状态），用于任务前后验证和 Debug', params: '{ includeHidden?: boolean, includeBounds?: boolean, includeText?: boolean, maxLayers?: number }' },
    { name: 'diagnoseState', description: '诊断 Photoshop 状态', params: '{ verbose?: boolean }' },
    
    // === 图层操作 ===
    { name: 'selectLayer', description: '选中指定图层', params: '{ layerId?: number, layerIds?: number[], layerName?: string, addToSelection?: boolean }' },
    { name: 'focusLayer', description: '聚焦到指定图层：选中图层、前置 Photoshop、刷新 UI，并返回真实边界；不承诺精确画布视口平移/缩放', params: '{ layerId?: number, layerName?: string, includeBounds?: boolean }' },
    { name: 'getLayerHierarchy', description: '获取图层层级树', params: '{ includeHidden?: boolean }' },
    { name: 'getAllTextLayers', description: '获取所有文本图层', params: '{}' },
    { name: 'getLayerBounds', description: '获取图层边界', params: '{ layerId?: number, includeEffects?: boolean }' },
    { name: 'moveLayer', description: '移动图层在画布上的 x/y 位置；不改变 Photoshop 图层堆叠顺序', params: '{ layerId?: number, x?: number, y?: number, relative?: boolean }' },
    { name: 'reorderLayer', description: '调整 Photoshop 图层堆叠顺序；置顶、置底、上移、下移、移动到指定图层上方/下方', params: '{ layerId?: number, action: "up"|"down"|"top"|"bottom"|"above"|"below", targetLayerId?: number, steps?: number }' },
    { name: 'moveLayerToGroup', description: '移动图层或图层组到目标组内；改变父子层级，不改变画布 x/y 位置', params: '{ layerId: number, targetGroupId: number, position?: "inside"|"inside-top"|"inside-bottom" }' },
    { name: 'alignLayers', description: '对齐图层', params: '{ alignment: "left"|"center"|"right"|"top"|"middle"|"bottom" }' },
    { name: 'distributeLayers', description: '均匀分布图层', params: '{ direction: "horizontal"|"vertical" }' },
    { name: 'transformLayer', description: '变换图层', params: '{ scaleUniform?: number, rotate?: number, flipHorizontal?: boolean }' },
    { name: 'quickScale', description: '快速缩放图层', params: '{ percent: number, fitCanvas?: boolean }' },
    
    // === 图层属性 ===
    { name: 'setLayerOpacity', description: '设置不透明度', params: '{ opacity: number, layerId?: number }' },
    { name: 'setBlendMode', description: '设置混合模式', params: '{ blendMode: string, layerId?: number }' },
    { name: 'addDodgeBurnLayer', description: '新建中性灰减淡加深图层（50%灰+SoftLight，非破坏性提亮/压暗光影）', params: '{ blendMode?: string, layerName?: string }' },
    { name: 'warpLayer', description: '图层预设变形/液化感（膨胀/挤压/扭曲/弧形等，默认复制层非破坏执行）', params: '{ style: string, value?: number, layerId?: number, preserveOriginal?: boolean, resultLayerName?: string }' },
    { name: 'duplicateLayer', description: '复制图层', params: '{ newName?: string }' },
    { name: 'deleteLayer', description: '删除图层', params: '{ layerId?: number }' },
    { name: 'getLayerProperties', description: '获取图层属性', params: '{ layerId?: number }' },
    
    // === 图层效果 ===
    { name: 'addDropShadow', description: '给指定图层添加真实 Photoshop 投影效果', params: '{ layerId?: number, color?: {r,g,b}, colorHex?: string, opacity?: number, distance?: number, spread?: number, size?: number, angle?: number }' },
    { name: 'addStroke', description: '给指定图层添加真实 Photoshop 描边效果', params: '{ layerId?: number, color?: {r,g,b}, colorHex?: string, size?: number, opacity?: number, position?: "outside"|"inside"|"center" }' },
    { name: 'addGlow', description: '给指定图层添加真实 Photoshop 内/外发光效果', params: '{ layerId?: number, type?: "outer"|"inner", color?: {r,g,b}, colorHex?: string, opacity?: number, size?: number, spread?: number }' },
    { name: 'addGradientOverlay', description: '给指定图层添加真实 Photoshop 渐变叠加效果', params: '{ layerId?: number, startColor: {r,g,b}, endColor: {r,g,b}, angle?: number, opacity?: number }' },
    { name: 'clearLayerEffects', description: '清除效果', params: '{ layerId?: number }' },
    { name: 'gaussianBlurLayer', description: '对图层应用高斯模糊（栅格图层破坏性，智能对象成为智能滤镜）', params: '{ layerId?: number, radius?: number }' },
    { name: 'createLayerMask', description: '给图层添加蒙版（显示全部/隐藏全部/按选区）', params: '{ layerId?: number, mode?: "revealAll"|"hideAll"|"revealSelection" }' },
    { name: 'deleteLayerMask', description: '删除图层蒙版（可选择是否应用到像素）', params: '{ layerId?: number, apply?: boolean }' },
    { name: 'cropDocument', description: '把画布裁切到指定像素矩形（破坏性）', params: '{ top: number, left: number, bottom: number, right: number }' },
    { name: 'resizeCanvas', description: '按锚点修改画布大小（留白或裁边，不缩放像素）', params: '{ width: number, height: number, anchor?: string }' },
    { name: 'resizeImage', description: '整图重采样缩放（图像大小）', params: '{ width?: number, height?: number, resample?: string }' },
    { name: 'setLayerFill', description: '设置形状图层的填充颜色', params: '{ layerId?: number, color: {r,g,b} }' },
    { name: 'addBrightnessContrastAdjustment', description: '创建非破坏性亮度/对比度调整图层', params: '{ brightness?: number, contrast?: number, name?: string }' },
    { name: 'addHueSaturationAdjustment', description: '创建非破坏性色相/饱和度调整图层', params: '{ hue?: number, saturation?: number, lightness?: number, name?: string }' },
    { name: 'addLevelsAdjustment', description: '创建非破坏性色阶调整图层', params: '{ inputBlack?: number, inputWhite?: number, gamma?: number, outputBlack?: number, outputWhite?: number, name?: string }' },
    { name: 'addColorBalanceAdjustment', description: '创建非破坏性色彩平衡调整图层', params: '{ shadows?: number[], midtones?: number[], highlights?: number[], preserveLuminosity?: boolean, name?: string }' },
    { name: 'addVibranceAdjustment', description: '创建非破坏性自然饱和度调整图层', params: '{ vibrance?: number, saturation?: number, name?: string }' },
    { name: 'addPhotoFilterAdjustment', description: '创建非破坏性照片滤镜调整图层', params: '{ colorHex?: string, density?: number, preserveLuminosity?: boolean, name?: string }' },
    
    // === 文本操作 ===
    { name: 'getTextContent', description: '获取文本内容', params: '{ layerId?: number, layerIds?: number[] }' },
    { name: 'setTextContent', description: '替换文本内容并保留调用时的当前样式（单层或批量二选一）', params: '{ layerId?: number, content?: string, expectedCurrentContent?: string, expectedDocumentId?: number, expectedHistoryStateRef?: { documentId: number, historyStateId: number }, updates?: { layerId: number, content: string, expectedCurrentContent?: string }[] }' },
    { name: 'getTextStyle', description: '获取文本样式', params: '{ layerId?: number }' },
    { name: 'resolveFontName', description: '解析 Photoshop 可用字体名', params: '{ fontName?: string, limit?: number }' },
    { name: 'setTextStyle', description: '按字段修改并读回验证文本样式（未提供字段保持不变）', params: '{ layerId: number, fontSize?: number(pt), fontName?: string, tracking?: number(1/1000em), leading?: number(pt) }' },
    
    // === 图层管理 ===
    { name: 'renameLayer', description: '重命名图层', params: '{ layerId?: number, newName: string }' },
    { name: 'batchRenameLayers', description: '按显式 layerIds 批量重命名图层，支持 pattern 的 {n}/{name} 或 findReplace', params: '{ layerIds?: number[], pattern?: string, startNumber?: number, findReplace?: { find: string, replace: string } }' },
    { name: 'groupLayers', description: '编组图层', params: '{ layerIds?: number[], groupName?: string }' },
    { name: 'ungroupLayers', description: '解散图层组', params: '{ groupId: number }' },
    { name: 'createClippingMask', description: '给指定图层创建真实 Photoshop 剪切蒙版，剪切到下方图层', params: '{ layerId?: number }' },
    { name: 'releaseClippingMask', description: '释放指定图层的真实 Photoshop 剪切蒙版关系', params: '{ layerId?: number }' },
    { name: 'getClippingMaskInfo', description: '获取剪切蒙版信息（基底与蒙版图层关系）', params: '{ layerId?: number }' },
    { name: 'getAllClippingMasks', description: '获取文档中所有剪切蒙版', params: '{}' },
    { name: 'findLayers', description: '【查图层】按名称/类型/组内条件查找图层，返回扁平列表（id/类型/边界/路径）。找特定图层用它一步命中，不要翻层级树', params: '{ nameContains?: string, nameEquals?: string, kind?: string, withinGroupId?: number, limit?: number }' },
    
    // === 视觉分析 ===
    { name: 'getCanvasSnapshot', description: '获取画布截图', params: '{ maxSize?: number }' },
    { name: 'getElementMapping', description: '获取元素映射', params: '{ includeHidden?: boolean }' },
    { name: 'analyzeLayout', description: '分析布局', params: '{ detectHierarchy?: boolean }' },
    
    // === 历史记录 ===
    { name: 'undo', description: '撤销', params: '{ steps?: number }' },
    { name: 'redo', description: '重做', params: '{ steps?: number }' },
    { name: 'getHistoryInfo', description: '获取历史记录', params: '{}' },
    
    // === 导出 ===
    { name: 'saveDocument', description: '保存或另存为文档；默认覆盖既有目标，未获覆盖授权时用 conflictPolicy="fail_if_exists" 配合显式路径', params: '{ format?: "psd"|"psb"|"png"|"jpg"|"jpeg"|"tiff"|"pdf", path?: string, saveAs?: boolean, quality?: number, conflictPolicy?: "overwrite"|"fail_if_exists" }' },
    { name: 'quickExport', description: '快速导出到明确目录或完整 PNG/JPEG 文件路径；用户给 .png/.jpg/.jpeg 路径时不要删除扩展名，运行时会转为 saveDocument(path)', params: '{ outputPath: string, format?: "png"|"jpg", quality?: number, suffix?: string }' },
    { name: 'exportGroup', description: '导出指定图层组或图层为 PNG 文件；需要 groupPath 或 layerId 以及完整 outputPath', params: '{ groupPath?: string[], layerId?: number, outputPath: string, format?: "png", targetWidth?: number, targetHeight?: number, maxSize?: number }' },
    { name: 'exportMainImageDocuments', description: '按用户导出规范 4.0 批量导出成品：主图文档（800/750/1200）的「转化图」「点击图」父组下每个非空子组各导一张 JPEG（质量自适应≤3MB）到 <导出目录>/主图/<尺寸>/，详情页文档按切片 Save For Web 导出到 <导出目录>；未打开的文档跳过不中断，处理后恢复历史状态', params: '{ outputDir: string, documents?: string[], mainImageGroups?: string[], maxFileSizeMB?: number }' },
    { name: 'exportWhiteBgFromSkuMaterial', description: '从项目 SKU PSD/PSB 源文件生成 800x800 白底图并保存到完整 JPEG 路径', params: '{ sourceDocumentPath: string, outputPath: string, preferredLayerName?: string, canvasWidth?: number, canvasHeight?: number, targetSubjectHeightPx?: number, horizontalMarginPx?: number, jpegQuality?: number }' },
    { name: 'smartSave', description: '智能保存（已有路径直接保存，否则弹出对话框），支持显式 PSD/PSB 路径', params: '{ exportFormat?: "psd"|"psb"|"jpg"|"png", path?: string, exportQuality?: number }' },
    
    // === 图像处理 ===
    { name: 'removeBackground', description: '智能抠图', params: '{ targetPrompt?: string, outputFormat?: "layer"|"mask" }' },
    { name: 'placeImage', description: 'Place an explicitly sourced image as an editable layer. Source discovery is opt-in: autoSelect=true also requires a structured designRole and visual selection evidence; ambiguous or recomposition-required candidates are returned without writing. A model-authored force claim has only agent_judgment authority and must pass the same visual checks.', params: '{ filePath?: string, fileToken?: string, imageData?: string, requirement?: string, query?: string, designRole?: "hero"|"supporting"|"detail"|"background"|"decoration", placementIntent?: "direct_full_frame"|"clip_to_container"|"matte_and_recompose"|"supporting", category?: "products"|"backgrounds"|"elements"|"references"|"others", autoSelect?: boolean, selectionMode?: "auto"|"suggest"|"force", strictDeterministic?: boolean, minScore?: number, minMargin?: number, candidateCount?: number, name?: string, x?: number, y?: number, targetBounds?: { x?: number, y?: number, left?: number, top?: number, right?: number, bottom?: number, width?: number, height?: number }, targetFit?: "contain"|"cover"|"fill", layerOrder?: "front"|"belowText"|"back", center?: boolean, scale?: number, fitToCanvas?: boolean }' },
    { name: 'replaceLayerContent', description: '目标图层和替换文件都明确后，替换图层内容为新图片', params: '{ filePath: string, layerId?: number }' },
    // === 创建工具 ===
    { name: 'createRectangle', description: '创建矩形', params: '{ x: number, y: number, width: number, height: number, name?: string, color?: {r,g,b}, fillColorHex?: string, cornerRadius?: number }' },
    { name: 'createEllipse', description: '创建椭圆', params: '{ x: number, y: number, width: number, height: number }' },
    { name: 'createTextLayer', description: '创建文字', params: '{ content: string, text?: string, name?: string, x: number, y: number, fontSize?: number, fontName?: string, tracking?: number, leading?: number, colorHex?: string, color?: { r: number, g: number, b: number }, alignment?: "left"|"center"|"right" }' },
    { name: 'createGroup', description: '创建图层组', params: '{ groupName: string }' },
    
    // === SKU 相关 ===
    { name: 'skuLayout', description: 'SKU executor 底层工具。仅在用户明确要求生成/导出 SKU 组合图或自选备注，并且已由 SKU 业务流程确认 SKU 源文档、模板和输出目标后使用；能力问答、SKU 说明、只读查看、规划讨论不要调用。listLayerSets/getCapabilities 为只读；execute/arrangeDynamic/exportNote 会写入或导出文件。', params: '{ action: "getCapabilities"|"listLayerSets"|"execute"|"arrangeDynamic"|"exportNote", skuDocName?: string, templateDocName?: string, combos?: string[][], outputDir?: string, noteFilePrefix?: string, autoLayoutWithoutPlaceholders?: boolean }' },
    { name: 'sockLayoutConfig', description: 'SKU 编排配置解析（只读）：首选组合优先，按行填写颜色组合（comboText），颜色数自动匹配 N双装 模板，返回可直接交给 skuLayout 的 combos 分组；兼容旧版排版 CSV + 颜色 CSV', params: '{ action?: string, projectRoot?: string, comboText?: string, templateName?: string, outputPattern?: string, quality?: number, layoutCsvText?: string, colorCsvText?: string }' },
    { name: 'exportColorConfig', description: '导出 SKU 颜色配置', params: '{}' },
    { name: 'createSkuPlaceholders', description: '只在尚无区域/占位标记的文档中创建 SKU 占位槽。已有结构会返回 existing_structure_detected，应 inspectTemplateLayout 后用 transformLayer 转换，或在新文档中重建；不存在模型布尔覆盖授权。', params: '{ count: number, placementMethod?: "ordered_slots"|"region_composition", regionCapacities?: number[], slots?: [{x,y,width,height}], layout?: "horizontal"|"vertical"|"grid", area?: {x,y,width,height} }' },
    { name: 'getSkuPlaceholders', description: '获取 SKU 占位符信息', params: '{}' },
    { name: 'smartLayout', description: '智能布局引擎。只在专门布局流程已确认目标图层/目标区域时使用；不要把它作为普通小工具默认猜测调用。', params: '{ action: "calculateScale"|"applyLayout"|"analyzeLayout"|"getRecommendedConfig"|"smartArrange", sourceLayerName?: string, targetBounds?: { left: number, top: number, width: number, height: number }, layerIds?: number[], layerNames?: string[], config?: object }' },
    { name: 'alignToReference', description: '把显式 layerId 的图层按比例缩放并移动，使主体中心对齐到目标点；必须先读回图层与边界，不按名称猜测参考图层', params: '{ layerId: number, scalePercent: number, targetCenterX: number, targetCenterY: number, subjectOffsetX: number, subjectOffsetY: number }' },
    { name: 'fitLayerSubjectToRegion', description: '【主体感知缩放与定位】按真实主体适配明确目标区域；省略占比和锚点时由 designType/assetRole/intent 共享预设决定，并在同一次调用内返回写后 geometryVerification。参考测量不是通用前置，几何通过也不等于审美通过。', params: '{ layerId: number, targetRegion: {x,y,width,height}, subjectFillRatio?: number, maxUpscaleRatio?: number, designType?: "main-image"|"detail-page"|"sku"|"reference-replication"|"poster"|"banner"|"generic", assetRole?: "product"|"model"|"detail"|"scene"|"icon"|"background"|"group"|"unknown", intent?: "hero"|"supporting"|"thumbnail"|"full-bleed"|"fit-slot"|"compare-grid", anchor?: "center"|"top-center"|"bottom-center"|"left-center"|"right-center", method?: "smart"|"alpha" }' },
    
    // === 智能对象操作 ===
    { name: 'getSmartObjectInfo', description: '读取指定智能对象图层的真实元数据（类型、原始尺寸、是否链接等）', params: '{ layerId?: number }' },
    { name: 'convertToSmartObject', description: '将显式 layerIds 转换为真实 Photoshop 智能对象', params: '{ layerIds?: number[], name?: string }' },
    { name: 'editSmartObjectContents', description: '打开智能对象进行编辑（会打开新的 PSB 文档窗口）', params: '{ layerId?: number }' },
    { name: 'replaceSmartObjectContents', description: '替换智能对象内容为新图片', params: '{ filePath: string, layerId?: number }' },
    { name: 'updateSmartObject', description: '更新链接的智能对象', params: '{ layerId?: number, action?: "update"|"relink" }' },
    { name: 'getSmartObjectLayers', description: '读取智能对象内部图层检查入口；默认 autoOpen=false，不打开新文档', params: '{ layerId?: number, autoOpen?: boolean }' },
    { name: 'duplicateSmartObject', description: '复制指定智能对象图层', params: '{ layerId?: number, name?: string }' },
    { name: 'rasterizeSmartObject', description: '栅格化智能对象为普通像素图层（不可逆）', params: '{ layerId?: number }' },
    
    // 导出目录：使用 getEntryWithUrl 解析项目路径为 UXP 可访问入口
    
    // === 项目资源管理（从项目文件夹操作）===
    { name: 'openProjectFile', description: '【推荐】从项目目录搜索并打开PSD/PSB文件。用户说"打开XX文件"时用这个；CSV/图片素材先用 searchProjectResources 查找。', params: '{ query: string }' },
    { name: 'searchProjectResources', description: '搜索项目目录中的文件（仅搜索，不打开）。用户提到CSV、表格、模板、图标、素材但没给完整路径时，先用它查项目资源，再决定是否需要追问。', params: '{ query: string, type?: "image"|"design"|"all" }' },
    { name: 'openTemplate', description: '打开指定路径的PSD/PSB文件（需要完整路径）', params: '{ psdPath: string }' },
    { name: 'listProjectResources', description: '列出项目目录中的所有资源；资源型任务缺少路径时先列目录，不要直接向用户要文件位置。', params: '{ directory?: string }' },
    { name: 'createProjectContactSheetOverview', description: '把项目图片合成一张带编号的缩略图总览，适合先整体观察款式、素材类型和后续要单独复核的图片。', params: '{ directory?: string, maxImages?: number, columns?: number }' },
    { name: 'analyzeProjectContactSheetOverview', description: '先生成项目图片总览图，再用视觉模型理解整体款式、拍摄风格、素材角色和后续需要单图复核的编号。', params: '{ directory?: string, maxImages?: number, focus?: string }' },
    { name: 'prepareSkuRetouchAssets', description: '为一批纯底棚拍 SKU 商品图生成可编辑精修资产：自动选形态基准、受约束形态统一、独立原影、中性灰低频光影修正和预览。sourceMode=auto 会跳过场景图；该工具只生成项目文件，不代表 Photoshop 色卡已完成。', params: '{ sources: [{sourceId?: string, filePath: string, colorName?: string}], projectPath?: string, outputDir?: string, referenceSourcePath?: string, sourceMode?: "auto"|"studio"|"scene", shapeStrength?: number, lightingStrength?: number, maxLongEdge?: number, force?: boolean }' },
    { name: 'generateImage', description: '使用 Black Forest Labs FLUX 生成新的图片素材。生成结果不会自动写入 Photoshop，采用前仍需查看。', params: '{ prompt: string, model?: "flux-2-max"|"flux-2-pro"|"flux-2-klein-9b"|"flux-2-klein-4b", width?: number, height?: number }' },

    // === 设计源解析（PSD 知识库）===
    {
        name: 'analyzePsdDesignSource',
        description: '【设计源解析】离线解析设计师 PSD/PSB 为设计规范档案（结构树/字号档位/色板/版心边距/分屏节奏），不打开 Photoshop、不读像素。用户说"照这个 PSD 的规范做"时用；.tif 请在 PS 打开后用 getLayerHierarchy。',
        params: '{ filePath: string }'
    },

    // === Eagle 素材参考（P3）===
    {
        name: 'observeEagleAsset',
        description: '【Eagle 素材观察】真实观察 Eagle 素材的图像内容（缩略图/源图回传视觉观察）。拿到 assetRef（libraryId:itemId）且需要"亲眼看"素材时用；元数据不等于看过图。只读。',
        params: '{ assetRef: string, maxSize?: number }'
    },
    {
        name: 'importEagleAssetToProject',
        description: '【Eagle 素材导入】把 Eagle 素材复制进当前项目（默认「Eagle素材」子目录）并记录来源。要把素材真正用进设计（placeImage 置入）时先用它取得项目内路径。只写项目、不写 Eagle。',
        params: '{ assetRef: string, targetSubdir?: string }'
    },
    {
        name: 'measureReferenceComposition',
        description: '【可选参考构图测量】只测已经明确选中的相关参考图，输出主体占比/重心/留白及 fitLayerSubjectToRegion 可用建议（本地主体检测，0 token，支持位图与 PSD）。不是通用开工前置；没有合适参考或测量失败时，按当前画布、组件边界和设计原理继续。',
        params: '{ imagePath: string }'
    },

    // === 设计参考搜索（网页/设计平台）===
    {
        name: 'searchDesigns',
        description: '【设计参考搜索】在花瓣、站酷、Behance、Pinterest 等设计平台搜索设计作品。当用户说"找设计参考"、"搜一下XX风格"、"看看有什么灵感"时使用。',
        params: '{ query: string, platform?: "huaban"|"zcool"|"behance"|"pinterest"|"all", limit?: number }'
    },
    {
        name: 'fetchWebPageDesignContent',
        description: '【网页内容提取】访问指定 URL 提取设计相关内容（标题、正文、图片）。当用户说"打开这个链接"、"去这个网站看看"、"获取这个页面的设计内容"时使用。',
        params: '{ url: string, extractImages?: boolean, maxTextLength?: number }'
    },

    // === 浏览器扩展（操作用户真实浏览器，见 docs/browser-extension-bridge.md）===
    {
        name: 'listBrowserTabs',
        description: '【列出浏览器标签页】列出用户真实 Chrome/Edge 打开的标签页（id/标题/URL）和扩展连接状态。操作用户浏览器前先用它。',
        params: '{}'
    },
    {
        name: 'readBrowserPage',
        description: '【读取浏览器页面】读用户真实浏览器页面的正文/链接/可交互元素（带登录态）。给 url 则后台新标签页打开再读；需点击填写时带 includeElements:true。',
        params: '{ tabId?: number, url?: string, includeElements?: boolean, maxChars?: number }'
    },
    {
        name: 'captureBrowserTab',
        description: '【浏览器截图】截取用户浏览器标签页画面供视觉理解（会临时切前台，只截可见区）。',
        params: '{ tabId?: number, maxWidth?: number }'
    },
    {
        name: 'navigateBrowserTab',
        description: '【浏览器导航】让用户浏览器跳转到 http/https 网址或新开标签页。',
        params: '{ url: string, tabId?: number, newTab?: boolean, background?: boolean }'
    },
    {
        name: 'interactWithBrowserPage',
        description: '【操作浏览器页面】在用户浏览器页面点击/填写输入框/滚动获取信息。填写不提交；支付下单发布删除等不可逆动作须先经用户确认。',
        params: '{ tabId: number, action: "click"|"fill"|"scroll", elementRef?: number, selector?: string, value?: string, deltaY?: number, intoView?: boolean }'
    },
    { name: 'auditDetailPagePlacement', description: 'Audit detail-page image placements against target bounds and flag offset or stacking risks.', params: '{ screens: any[], placements?: any[] }' },
    { name: 'getScreenSnapshotsWithOverlay', description: 'Capture detail-page screen snapshots with target and actual placement boxes drawn on top.', params: '{ screens: any[], placements?: any[], maxWidth?: number, screenIndices?: number[] }' }
];

/**
 * Agent 工具名 → UXP 工具名 映射（UXP 使用 snake_case）
 *
 * 当前为空：唯一用到别名的图像协调工具已随功能整体移除。映射点保留，
 * 因为"两侧命名可能不一致"这件事仍然成立，新增此类工具时在这里登记。
 */
const TOOL_NAME_ALIASES: Record<string, string> = {};

/** 视觉相关工具 */
export const VISION_TOOLS = ['getCanvasSnapshot', 'getDocumentSnapshot', 'getAnnotatedSnapshot'];

/** 长耗时工具超时（ms），默认 30s 不足以完成 SKU 批量排版 */
const LONG_RUNNING_TOOL_TIMEOUT = 5 * 60 * 1000;  // 5 分钟
const AUTO_FOCUS_MIN_INTERVAL_MS = 1200;

const AUTO_FOCUS_AFTER_TOOLS = new Set([
    'createTextLayer',
    'createRectangle',
    'createEllipse',
    'placeImage',
    'replaceLayerContent',
    'moveLayer',
    'reorderLayer',
    'moveLayerToGroup',
    'createClippingMask',
    'releaseClippingMask',
    'alignToReference',
    'transformLayer',
    'quickScale',
    'setTextContent',
    'setTextStyle',
    'setLayerOpacity',
    'setBlendMode',
    'addDropShadow',
    'addStroke',
    'addGlow',
    'addGradientOverlay',
    'clearLayerEffects',
    'setLayerFill',
    'addBrightnessContrastAdjustment',
    'addHueSaturationAdjustment',
    'addLevelsAdjustment',
    'addColorBalanceAdjustment',
    'addVibranceAdjustment',
    'addPhotoFilterAdjustment',
    'renameLayer',
    'batchRenameLayers',
    'convertToSmartObject',
    'duplicateSmartObject',
    'duplicateLayer'
]);

let lastAutoFocusAt = 0;

/** 获取工具调用的超时时间 */
function getToolTimeout(toolName: string, params: any): number | undefined {
    if (toolName === 'focusLayer') return 15 * 1000;
    if (toolName === 'createTextLayer') return 60 * 1000;
    if (toolName === 'saveDocument' || toolName === 'quickExport' || toolName === 'exportGroup') return 2 * 60 * 1000;
    // 批量导出跨多文档多子组、JPEG 自适应降质要反复重存，按长任务给足时间
    if (toolName === 'exportMainImageDocuments') return LONG_RUNNING_TOOL_TIMEOUT;
    if (toolName === 'skuLayout') {
        const action = params?.action;
        if (action === 'execute' || action === 'arrangeDynamic') {
            return LONG_RUNNING_TOOL_TIMEOUT;
        }
    }
    // listDocuments 在 PS 加载文档时可能较慢
    if (toolName === 'listDocuments') return 60 * 1000;
    return undefined;
}

function isPhotoshopNativeModalTimeout(errorMessage: string): boolean {
    const message = String(errorMessage || '');
    return /(?:Request timeout|MCP request timeout|tools\/call timed out)/i.test(message)
        || message.includes('photoshop_native_modal_suspected')
        || message.includes('疑似 Photoshop 原生弹窗');
}

function buildPhotoshopNativeModalSuspectedResult(
    toolName: string,
    errorMessage: string,
    params: any
): Record<string, any> {
    return {
        success: false,
        error: `${toolName} 处理超时：Photoshop 可能有弹窗未关闭，或仍在处理上一步。`,
        originalError: errorMessage,
        errorCategory: 'photoshop_native_modal_suspected',
        recoveryRequired: true,
        userActionRequired: {
            type: 'photoshop_native_dialog',
            message: '请查看 Photoshop 是否有确认框或提示框；关闭后重载插件，再继续执行。'
        },
        suggestion: '先关闭 Photoshop 里的弹窗并重载插件；恢复前不要重复执行写入步骤，避免继续留下临时文档或触发新的弹窗。',
        toolName,
        params
    };
}

function isDispatchedPhotoshopOperationUnknown(errorMessage: string): boolean {
    return String(errorMessage || '').includes('photoshop_operation_outcome_unknown');
}

function readTransportRequestKey(errorMessage: string): string | undefined {
    const match = String(errorMessage || '').match(/\brequestKey=([^\s]+)/);
    return match?.[1] ? String(match[1]) : undefined;
}

function buildPhotoshopOperationOutcomeUnknownResult(
    toolName: string,
    errorMessage: string
): Record<string, any> {
    const requestKey = readTransportRequestKey(errorMessage);
    return {
        success: false,
        code: 'photoshop_operation_outcome_unknown',
        error: `${toolName} 已经发往 Photoshop，但没有收到可确认的执行结果。`,
        originalError: errorMessage,
        recoveryRequired: true,
        suggestion: '不要重复发送本次写入；先读取同一 Photoshop 文档的实际状态。',
        photoshopOperationResult: {
            version: PHOTOSHOP_OPERATION_RESULT_VERSION,
            operationId: requestKey
                ? `${toolName}:${requestKey}`
                : `${toolName}:transport-outcome-unknown`,
            toolName,
            status: 'unknown',
            applicationStatus: 'unknown',
            transactionState: 'transport_unknown',
            effect: 'unknown',
            rollback: {
                attempted: false,
                verified: false
            },
            code: 'photoshop_operation_outcome_unknown',
            message: '写调用已派发，但传输层没有返回可确认结果。'
        }
    };
}

function buildPhotoshopOperationNotDispatchedResult(
    toolName: string,
    errorMessage: string,
    code = 'photoshop_operation_not_dispatched'
): Record<string, any> {
    return {
        success: false,
        code,
        error: sanitizeUserVisibleDiagnosticText(errorMessage)
            || `${toolName} 未能派发到 Photoshop。`,
        recoveryRequired: false,
        suggestion: '确认 Photoshop 与插件连接正常后，可以重新执行这一步。',
        photoshopOperationResult: {
            version: PHOTOSHOP_OPERATION_RESULT_VERSION,
            operationId: `${toolName}:not-dispatched`,
            toolName,
            status: 'failed',
            applicationStatus: 'not_applied',
            transactionState: 'not_started',
            effect: 'none',
            rollback: {
                attempted: false,
                verified: false
            },
            code,
            message: 'Photoshop 写调用未派发，未发生画面修改。'
        }
    };
}

function findLayerIdentityInHierarchy(
    value: unknown,
    layerId: number
): { id: number; name: string } | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, any>;
    const flatList = Array.isArray(record.flatList) ? record.flatList : [];
    const layer = flatList.find((entry: any) => Number(entry?.id) === layerId);
    if (!layer) return undefined;
    return {
        id: layerId,
        name: String(layer.name || '')
    };
}

async function reconcileRenameLayerOperationReadback(
    params: any,
    operationResult: Record<string, any>
): Promise<Record<string, any>> {
    const operation = readPhotoshopOperationResult(operationResult);
    if (!operation || !requiresPhotoshopOperationReadback(operationResult)) {
        return operationResult;
    }
    const guard = params?.[DESIGN_ECHO_TARGET_GUARD_ARGUMENT];
    const hasExplicitLayerId = Object.prototype.hasOwnProperty.call(params || {}, 'layerId');
    const layerId = hasExplicitLayerId
        ? asFinitePositiveId(params?.layerId)
        : asFinitePositiveId(guard?.expectedActiveLayerId);
    const newName = String(params?.newName || '').trim();
    const expectedDocumentId = asFinitePositiveId(
        guard?.expectedDocumentId
    );
    if (!layerId || !newName || !expectedDocumentId) return operationResult;

    let observation: any;
    try {
        observation = await sendToPluginWithCancellation(
            'getLayerHierarchy',
            {
                includeHidden: true,
                includeBounds: false,
                flatList: true
            },
            15_000,
            {},
            'getLayerHierarchy'
        );
    } catch (error) {
        return {
            ...operationResult,
            readback: {
                attempted: true,
                verified: false,
                error: error instanceof Error ? error.message : String(error || '只读核对失败')
            }
        };
    }

    const observedDocumentId = asFinitePositiveId(observation?.historyStateRef?.documentId);
    const layer = findLayerIdentityInHierarchy(observation, layerId);
    const verified = observedDocumentId === expectedDocumentId
        && layer?.name === newName;
    if (!verified) {
        return {
            ...operationResult,
            readback: {
                attempted: true,
                verified: false,
                expectedDocumentId,
                observedDocumentId,
                layerId,
                observedName: layer?.name
            }
        };
    }

    return {
        success: true,
        layer: {
            id: layerId,
            newName
        },
        reconciledAfterUnknownOperation: true,
        ...(operation.transactionState === 'transport_unknown'
            ? { recoveredAfterTransportFailure: true }
            : {}),
        readback: {
            attempted: true,
            verified: true,
            documentId: observedDocumentId,
            layerId,
            name: layer.name
        },
        photoshopOperationResult: {
            ...operationResult.photoshopOperationResult,
            status: 'verified',
            applicationStatus: 'unknown',
            transactionState: operation.transactionState === 'transport_unknown'
                ? 'transport_reconciled'
                : 'readback_reconciled',
            effect: 'already_satisfied',
            code: 'photoshop_operation_reconciled_by_readback',
            message: '已从同一 Photoshop 文档读回并确认目标图层名称。'
        }
    };
}

async function reconcileGroupLayersOperationReadback(
    params: any,
    operationResult: Record<string, any>
): Promise<Record<string, any>> {
    const operation = readPhotoshopOperationResult(operationResult);
    if (!operation || !requiresPhotoshopOperationReadback(operationResult)) {
        return operationResult;
    }

    const guard = params?.[DESIGN_ECHO_TARGET_GUARD_ARGUMENT];
    const expectedDocumentId = asFinitePositiveId(guard?.expectedDocumentId);
    const expectedHistoryStateRef = readPhotoshopHistoryStateRef({
        historyStateRef: guard?.expectedHistoryStateRef
    });
    const groupName = String(params?.groupName || '').trim();
    const layerIds: Array<number | undefined> = Array.isArray(params?.layerIds)
        ? (params.layerIds as unknown[]).map(asFinitePositiveId)
        : [];
    const validLayerIds = layerIds.length > 0
        && layerIds.every((layerId): layerId is number => layerId !== undefined)
        && new Set(layerIds).size === layerIds.length;
    if (!expectedDocumentId
        || !expectedHistoryStateRef
        || !groupName
        || !validLayerIds) {
        return {
            ...operationResult,
            readback: {
                attempted: false,
                verified: false,
                classification: 'ambiguous',
                reasonCode: 'invalid_group_reconciliation_identity'
            }
        };
    }

    let observation: any;
    try {
        observation = await sendToPluginWithCancellation(
            'getLayerHierarchy',
            {
                includeHidden: true,
                includeBounds: false,
                flatList: false
            },
            15_000,
            {},
            'getLayerHierarchy'
        );
    } catch (error) {
        return {
            ...operationResult,
            readback: {
                attempted: true,
                verified: false,
                classification: 'ambiguous',
                reasonCode: 'group_hierarchy_readback_failed',
                error: error instanceof Error
                    ? error.message
                    : String(error || '完整层级只读核对失败')
            }
        };
    }

    const reconciliation = classifyGroupLayersOperationReconciliation({
        groupName,
        layerIds: layerIds as number[],
        expectedDocumentId,
        expectedHistoryStateRef,
        observation
    });
    const readback = {
        attempted: true,
        verified: reconciliation.classification !== 'ambiguous',
        classification: reconciliation.classification,
        reasonCode: reconciliation.reasonCode,
        expectedHistoryStateRef: reconciliation.expectedHistoryStateRef,
        observedHistoryStateRef: reconciliation.observedHistoryStateRef,
        ...(reconciliation.group ? { group: reconciliation.group } : {})
    };
    if (reconciliation.classification === 'ambiguous'
        || !reconciliation.observedHistoryStateRef) {
        return {
            ...operationResult,
            readback
        };
    }

    const reconciledTransactionState = operation.transactionState === 'transport_unknown'
        ? 'transport_reconciled'
        : 'readback_reconciled';
    if (reconciliation.classification === 'not_applied') {
        return {
            ...operationResult,
            success: false,
            code: 'photoshop_group_operation_reconciled_not_applied',
            error: `图层组「${groupName}」未写入；完整层级与写前 Photoshop 历史版本保持一致。`,
            recoveryRequired: false,
            suggestion: '本次未知操作已经结算为未应用；当前调用不会重放写入。',
            historyStateRef: reconciliation.observedHistoryStateRef,
            readback,
            reconciliationReceipt: reconciliation,
            photoshopOperationResult: {
                ...operationResult.photoshopOperationResult,
                status: 'failed',
                applicationStatus: 'not_applied',
                transactionState: 'not_started',
                effect: 'none',
                before: expectedHistoryStateRef,
                after: reconciliation.observedHistoryStateRef,
                code: 'photoshop_group_operation_reconciled_not_applied',
                message: '同一文档的完整层级和历史版本确认该编组没有应用。'
            }
        };
    }

    const group = reconciliation.group;
    if (!group) {
        return {
            ...operationResult,
            readback: {
                ...readback,
                verified: false,
                classification: 'ambiguous',
                reasonCode: 'reconciled_group_identity_missing'
            }
        };
    }
    return {
        success: true,
        entityType: 'group',
        documentId: reconciliation.observedHistoryStateRef.documentId,
        layerId: group.id,
        groupId: group.id,
        name: group.name,
        groupedLayerCount: group.childLayerIds.length,
        group: {
            id: group.id,
            name: group.name,
            layerCount: group.childLayerIds.length
        },
        reconciledAfterUnknownOperation: true,
        ...(operation.transactionState === 'transport_unknown'
            ? { recoveredAfterTransportFailure: true }
            : {}),
        historyStateRef: reconciliation.observedHistoryStateRef,
        readback,
        reconciliationReceipt: {
            ...reconciliation,
            visualReadbackRequired: true
        },
        message: `已从同一 Photoshop 文档的完整层级确认图层组「${group.name}」及其成员顺序。`,
        photoshopOperationResult: {
            ...operationResult.photoshopOperationResult,
            status: 'verified',
            applicationStatus: 'applied',
            transactionState: reconciledTransactionState,
            effect: 'applied',
            before: expectedHistoryStateRef,
            after: reconciliation.observedHistoryStateRef,
            code: 'photoshop_group_operation_reconciled_applied',
            message: '同一文档的 revision 变化与完整层级共同确认该编组已经应用。'
        }
    };
}

async function reconcileOperationSpecificPhotoshopReadback(
    toolName: string,
    params: any,
    operationResult: Record<string, any>
): Promise<Record<string, any>> {
    if (toolName === 'renameLayer') {
        return reconcileRenameLayerOperationReadback(params, operationResult);
    }
    if (toolName === 'groupLayersSafely') {
        return reconcileGroupLayersOperationReadback(params, operationResult);
    }
    return operationResult;
}

function asFinitePositiveId(value: any): number | undefined {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : undefined;
}

function inferFocusLayerId(toolName: string, params: any, result: any): number | undefined {
    const directCandidates = [
        result?.layerId,
        result?.createdLayerId,
        result?.newLayerId,
        result?.placedLayerId,
        result?.layer?.id,
        result?.group?.id,
        result?.focusedLayer?.id,
        result?.data?.layerId,
        result?.data?.createdLayerId,
        result?.data?.newLayerId,
        result?.data?.placedLayerId,
        result?.data?.layer?.id,
        result?.data?.group?.id,
        result?.data?.focusedLayer?.id
    ];
    for (const candidate of directCandidates) {
        const layerId = asFinitePositiveId(candidate);
        if (layerId) return layerId;
    }

    if (Array.isArray(result?.createdLayerIds) && result.createdLayerIds.length === 1) {
        const layerId = asFinitePositiveId(result.createdLayerIds[0]);
        if (layerId) return layerId;
    }

    if (toolName === 'setTextContent' && Array.isArray(params?.updates) && params.updates.length === 1) {
        const layerId = asFinitePositiveId(params.updates[0]?.layerId);
        if (layerId) return layerId;
    }

    return asFinitePositiveId(params?.layerId);
}

function shouldAutoFocusAfterTool(toolName: string, params: any, result: any): boolean {
    if (toolName === 'focusLayer') return false;
    if (!AUTO_FOCUS_AFTER_TOOLS.has(toolName)) return false;
    if (!result || result.success === false) return false;
    if (params?.autoFocus === false || params?.focusAfter === false) return false;
    return Boolean(inferFocusLayerId(toolName, params, result));
}

async function maybeAutoFocusAfterTool(
    toolName: string,
    params: any,
    result: any,
    options: ToolCallExecutionOptions = {}
): Promise<any | undefined> {
    if (!shouldAutoFocusAfterTool(toolName, params, result)) return undefined;

    const now = Date.now();
    if (now - lastAutoFocusAt < AUTO_FOCUS_MIN_INTERVAL_MS) return undefined;

    const layerId = inferFocusLayerId(toolName, params, result);
    if (!layerId) return undefined;

    lastAutoFocusAt = now;
    try {
        const focusResult = await sendToPluginWithCancellation(
            'focusLayer',
            { layerId, includeBounds: true },
            getToolTimeout('focusLayer', { layerId }),
            options,
            'focusLayer'
        );
        return {
            toolName: 'focusLayer',
            triggeredBy: toolName,
            layerId,
            result: focusResult
        };
    } catch (error) {
        return {
            toolName: 'focusLayer',
            triggeredBy: toolName,
            layerId,
            result: {
                success: false,
                error: error instanceof Error ? error.message : String(error || '自动聚焦失败')
            }
        };
    }
}

/** 资源管理工具（Agent 端处理） */
// Renderer / Harness 本地工具：这些工具不能下发到 Photoshop UXP registry。
// 统一在这里登记，避免 schema 已向模型暴露、执行时却落到 MCP 并报 Tool not found。
const RENDERER_LOCAL_TOOLS = [
    'listProjectResources', 'searchProjectResources', 'getProjectStructure',
    'getResourcesByCategory', 'getResourceSummary', 'getAssetPreview',
    'createProjectContactSheetOverview', 'analyzeProjectContactSheetOverview',
    'prepareSkuRetouchAssets',
    'analyzeAssetContent', 'recommendAssets', 'openProjectFile',
    'describeImage',
    'analyzeProjectForDetailPage',
    'getDesignProjectState', 'updateDesignProjectState',
    'getDesignKnowledge',
    'getMainImageDesignFramework',
    'getDetailPageDesignFramework',
    'getDesignPrinciples',
    'declareDesignIntent',
    'searchEagleReferences',
    'analyzeEagleReference',
    'searchDesignKnowledge'
];

// ==================== 执行状态 ====================

let executedToolsInSession: string[] = [];
let currentRound = 0;

export const resetToolSession = () => {
    executedToolsInSession = [];
    currentRound = 0;
};

export const setCurrentRound = (round: number) => {
    currentRound = round;
};

function isChatTestFakePhotoshopEnabled(): boolean {
    if (process.env.NODE_ENV !== 'development') return false;
    try {
        if (typeof window === 'undefined') return false;
        const query = new URLSearchParams(window.location.search || '');
        return query.get('designechoChatTestBridge') === '1'
            && query.get('designechoChatTestFakePhotoshop') === '1';
    } catch {
        return false;
    }
}

function isChatTestFakePhotoshopEmptyInitialEnabled(): boolean {
    if (process.env.NODE_ENV !== 'development') return false;
    try {
        if (typeof window === 'undefined') return false;
        const query = new URLSearchParams(window.location.search || '');
        return query.get('designechoChatTestBridge') === '1'
            && query.get('designechoChatTestFakePhotoshop') === '1'
            && query.get('designechoChatTestFakePhotoshopEmpty') === '1';
    } catch {
        return false;
    }
}

function normalizeFakeSaveExtension(format: string): string {
    const normalized = String(format || 'psd').trim().toLowerCase();
    if (normalized === 'jpeg') return 'jpg';
    if (normalized === 'tif') return 'tiff';
    return normalized || 'psd';
}

type ChatTestFakeLayer = {
    id: number;
    name: string;
    kind: 'text' | 'shape' | 'group';
    content?: string;
    fontSize?: number;
    tracking?: number;
    bounds: { left: number; top: number; width: number; height: number };
};

type ChatTestFakeDocument = {
    id: number;
    name: string;
    path: string;
    width: number;
    height: number;
};

// 必须是一张可解码且足够进行画面观察的图片。历史 1×1 PNG 只有 92 个 base64 字符，
// 会被 tool-result-sanitizer 的最小图像阈值正确丢弃，避免 UI 把“已取快照”误当成
// “视觉模型已复核”，继而触发无意义的整轮返工。
const CHAT_TEST_FAKE_SNAPSHOT_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAO0SURBVDhPBcEJVM8HAMDx3+hQqDDSv+RoJd3xIklJSq+VTrTSWjq10cEo1Tw6pDuaSgezlNCFNzpZl/WGTpKjkYpmSEU69N3nIwiCgOpsA6wXBRC4/CzpWp1UrJOiZ7MJM233o+5yEVuvZ4Tsm09G2FaqoyN4kVKOxJkBNC8oIizQlMRwrTHuZsEcsymgcOcT7u6W48NeCxaFHmZDVCk/JPcRk6XApfxttJRGMVp5E4XGt5i0rkBQ2yHDt57mBP0Uyq+Hiqk81ss/SfKIZdqw6vejbCv5g/0Vb8hsWEZNy3Z6H8cj2X8LraFRHCZXIaw/upDvE62JyjjCxfPXuVc8yPBNZeTrnTC+H4dndw2xfcNcfr+S1oldfBRPQyTXhKniJN5qegg2V5QIvuHA6bpYqu5V8fzREOIvVdF454rdeAoHxBrIkh2nVqTDS1UvZullor3hHo6WMzjksA7Bo0uF6F4Xit4mcf9zHSMzx1gso8VGBU92f3Oa47p/c8VIoM3CgE/2ASi6nWWTbyc+wVLER5gghMzQIGOuB9WL03mh0oyEzjSa69dgv8Wfn+1yOePazi0fSfqCjJEKD0YntgCntCeE5siRW2iBEKOtzyVDX1rMsxnd1orCd+KYeBvhFRhI3OF8imO6aU+VYSzbHKWCUMzKi/Gt7iXhjjxl7TYImS6G1HjtpXffeSTDutCKnoNDihkHzxwk+8Jlbpc9p79qIdJN1ui2HcH56XXCXg2SN6xM/RcnhMtRprQmH+BjVhGi/B5MSxfgXWnFicZISlqv0vHkFZ8HlFjywYHNU7H4SVaROH+I8iWqPFR3RagtseRlRTizGsrQbunH8bGIQ/125AxF8+dkBQMS75g9TwU9JRe2r0zi8Oo6zm4co8FKi0EnT4S2bls+9R1D8f0NNk38h4/4cuLldlCqmECn2m3G9T+ibKyB+VYP/B3TSXJv5qr/NF371zD1iz9Cn5gzUrIn0BHV4qQ6QqieOrkb3KmzPMkrhzvM2TWFvp8+O0J8CY/M5lxcK42nxPk3zwjZokCEMV03lIxSMbNoxNd+ggQ3Xcp8vXkQnMVExH2WHp/JlpOG7MndS/LF81y71sWj2jl8aTZjRedBBGnX3ej6ZOAcdJew8K/Ii11LfdqPvM45x9zCB6y+Ks3OGlMi/jrAbx1FNPX08GZwAXKjVhgQibAkZg+bU/Pwy+4gsWAW5eUbeVgdwuSdQpa1P8Xi2TwCXluSMhLO9ekyuqX6mf5ahMpSO6w0ovkfb9F3H9ny+W8AAAAASUVORK5CYII=';

const chatTestFakePhotoshopState: {
    nextLayerId: number;
    documentCreated: boolean;
    activeDocumentName?: string;
    document: ChatTestFakeDocument;
    layers: ChatTestFakeLayer[];
} = {
    nextLayerId: 92000,
    documentCreated: false,
    document: {
        id: 91001,
        name: 'ChatBridgeTest.psd',
        path: 'C:\\DesignEchoTest\\PSD\\ChatBridgeTest.psd',
        width: 800,
        height: 800
    },
    layers: []
};

function normalizeChatTestFakePath(value: unknown): string {
    return String(value || '').trim().replace(/\//g, '\\');
}

function normalizeChatTestFakePathKey(value: unknown): string {
    return normalizeChatTestFakePath(value).toLowerCase();
}

function basenameFromChatTestPath(value: unknown): string {
    const normalized = normalizeChatTestFakePath(value);
    return normalized.split('\\').filter(Boolean).pop() || normalized;
}

function safeChatTestFileName(value: unknown): string {
    return String(value || 'fake-export')
        .trim()
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
        .replace(/\s+/g, ' ')
        .slice(0, 120) || 'fake-export';
}

function inferChatTestDocumentDimensions(name: string): { width: number; height: number } {
    if (/1200|9[:：]16/.test(name)) return { width: 1440, height: 2560 };
    if (/750|3[:：]4/.test(name)) return { width: 1440, height: 1920 };
    if (/800|1[:：]1/.test(name)) return { width: 1440, height: 1440 };
    return { width: 800, height: 800 };
}

function buildChatTestDocumentId(filePath: string, index: number): number {
    let hash = 0;
    const key = normalizeChatTestFakePathKey(filePath);
    for (let i = 0; i < key.length; i += 1) {
        hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
    }
    return 93000 + (Math.abs(hash) % 50000) + index;
}

function getLatestChatTestUserInput(): string {
    try {
        const messages = useAppStore.getState().messages || [];
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            const message = messages[index] as any;
            if (message?.role !== 'user') continue;
            const content = typeof message.content === 'string' ? message.content : '';
            if (content.trim()) return content.trim();
        }
    } catch {
        // Test bridge fallback only; no user-visible behavior depends on this helper.
    }
    return '';
}

function shouldExposeChatTestProjectDocuments(): boolean {
    return /sku/i.test(getLatestChatTestUserInput());
}

function isFakeGeneratedDocumentAvailable(): boolean {
    return !isChatTestFakePhotoshopEmptyInitialEnabled() || chatTestFakePhotoshopState.documentCreated;
}

async function readChatTestProjectPhotoshopDocuments(): Promise<ChatTestFakeDocument[]> {
    if (!shouldExposeChatTestProjectDocuments()) return [];
    const projectPath = useAppStore.getState().currentProject?.path;
    if (!projectPath) return [];
    const readDirectory = (window as any).designEcho?.readDirectory;
    if (typeof readDirectory !== 'function') return [];

    try {
        const entries = await readDirectory(projectPath, {
            recursive: true,
            filter: ['.psd', '.psb', '.tif', '.tiff']
        });
        return (Array.isArray(entries) ? entries : [])
            .filter((entry: any) => entry?.type === 'file' && /\.(psd|psb|tif|tiff)$/i.test(String(entry?.name || entry?.path || '')))
            .map((entry: any, index: number) => {
                const name = String(entry?.name || basenameFromChatTestPath(entry?.path));
                const dimensions = inferChatTestDocumentDimensions(name);
                return {
                    id: buildChatTestDocumentId(String(entry?.path || name), index),
                    name,
                    path: String(entry?.path || ''),
                    width: dimensions.width,
                    height: dimensions.height
                };
            });
    } catch (error) {
        console.warn('[ToolCall] 测试模式读取项目 Photoshop 文档失败:', error);
        return [];
    }
}

async function listChatTestFakeDocuments(): Promise<ChatTestFakeDocument[]> {
    const documents: ChatTestFakeDocument[] = [];
    if (isFakeGeneratedDocumentAvailable()) {
        documents.push({ ...chatTestFakePhotoshopState.document });
    }

    const projectDocuments = await readChatTestProjectPhotoshopDocuments();
    const seen = new Set(documents.map((doc) => normalizeChatTestFakePathKey(doc.path || doc.name)));
    for (const doc of projectDocuments) {
        const key = normalizeChatTestFakePathKey(doc.path || doc.name);
        if (seen.has(key)) continue;
        seen.add(key);
        documents.push(doc);
    }
    return documents;
}

async function getActiveChatTestFakeDocument(): Promise<ChatTestFakeDocument | undefined> {
    const documents = await listChatTestFakeDocuments();
    if (documents.length === 0) return undefined;
    const activeKey = normalizeChatTestFakePathKey(chatTestFakePhotoshopState.activeDocumentName);
    if (activeKey) {
        const matched = documents.find((doc) =>
            normalizeChatTestFakePathKey(doc.name) === activeKey
            || normalizeChatTestFakePathKey(doc.path) === activeKey
        );
        if (matched) return matched;
    }
    const skuDoc = documents.find((doc) => /sku/i.test(doc.name));
    return shouldExposeChatTestProjectDocuments() && skuDoc ? skuDoc : documents[0];
}

function createFakeLayerId(): number {
    chatTestFakePhotoshopState.nextLayerId += 1;
    return chatTestFakePhotoshopState.nextLayerId;
}

function findChatTestFakeLayer(layerId: number | undefined): ChatTestFakeLayer | undefined {
    const id = Number(layerId);
    if (!Number.isFinite(id)) return undefined;
    return chatTestFakePhotoshopState.layers.find((layer) => layer.id === id);
}

function estimateChatTestTextWidth(content: string, fontSize: number, tracking = 0): number {
    const glyphs = Array.from(String(content || ''));
    const baseUnits = glyphs.reduce((sum, char) => {
        if (/[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(char)) return sum + 1;
        if (/[A-Z]/.test(char)) return sum + 0.62;
        if (/[a-z0-9]/.test(char)) return sum + 0.56;
        if (/[:：,，.。;]/.test(char)) return sum + 0.3;
        if (/[-/\\]/.test(char)) return sum + 0.35;
        if (/\s/.test(char)) return sum + 0.3;
        return sum + 0.55;
    }, 0);
    const trackingWidth = Math.max(0, glyphs.length - 1) * fontSize * (tracking / 1000);
    return Math.max(1, Math.round(baseUnits * fontSize + trackingWidth));
}

function wrapTextForEstimatedWidth(content: string, maxWidth: number, fontSize: number): string {
    const text = String(content || '').replace(/\s+/g, ' ').trim();
    if (!text || !(maxWidth > 0) || !(fontSize > 0)) return text;
    if (estimateChatTestTextWidth(text, fontSize) <= maxWidth) return text;

    const lines: string[] = [];
    let current = '';
    for (const char of Array.from(text)) {
        const candidate = `${current}${char}`;
        if (current && estimateChatTestTextWidth(candidate, fontSize) > maxWidth) {
            lines.push(current.trim());
            current = char;
        } else {
            current = candidate;
        }
    }
    if (current.trim()) lines.push(current.trim());
    return lines.join('\n');
}

function fitLayoutTextToWidth(content: string, maxWidth: number, desiredFontSize: number, minFontSize = 16): {
    content: string;
    fontSize: number;
} {
    const raw = String(content || '').trim();
    if (!raw) return { content: raw, fontSize: Math.max(minFontSize, Math.round(desiredFontSize || minFontSize)) };
    const safeMaxWidth = Math.max(1, Math.round(maxWidth || 1));
    let fontSize = Math.max(minFontSize, Math.round(desiredFontSize || minFontSize));

    while (fontSize > minFontSize && estimateChatTestTextWidth(raw, fontSize) > safeMaxWidth) {
        fontSize -= 2;
    }

    const wrapped = wrapTextForEstimatedWidth(raw, safeMaxWidth, fontSize);
    return { content: wrapped, fontSize };
}

function readChatTestLayerBounds(layer: ChatTestFakeLayer | undefined): any {
    if (!layer) {
        return {
            success: false,
            error: '测试模式：未找到图层'
        };
    }
    const bounds = {
        left: layer.bounds.left,
        top: layer.bounds.top,
        right: layer.bounds.left + layer.bounds.width,
        bottom: layer.bounds.top + layer.bounds.height,
        width: layer.bounds.width,
        height: layer.bounds.height
    };
    return {
        success: true,
        layerId: layer.id,
        bounds,
        boundsNoEffects: bounds
    };
}

async function writeChatTestFakeSvgImage(filePath: string, width: number, height: number, label: string): Promise<void> {
    const writeFile = (window as any).designEcho?.writeFile;
    if (typeof writeFile !== 'function') {
        throw new Error('测试模式：writeFile 不可用，无法生成 SKU 导出文件。');
    }
    const safeLabel = String(label || 'SKU').replace(/[<&>]/g, '');
    const svg = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
        '<rect width="100%" height="100%" fill="#ffffff"/>',
        '<rect x="40" y="40" width="' + Math.max(1, width - 80) + '" height="' + Math.max(1, height - 80) + '" rx="18" fill="#f7f7f7" stroke="#d0d0d0"/>',
        '<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Arial, sans-serif" font-size="42" fill="#222222">',
        safeLabel,
        '</text>',
        '</svg>'
    ].join('');
    await writeFile(filePath, svg);
}

async function buildChatTestFakeSkuLayoutResult(params: any): Promise<any> {
    const action = String(params?.action || '').trim();
    if (action === 'getCapabilities') {
        return {
            success: true,
            data: {
                schema: 'sku-layout-capabilities/v0',
                runtime: 'DesignEcho chat test fake skuLayout',
                actions: [
                    'getCapabilities',
                    'listLayerSets',
                    'execute',
                    'arrangeDynamic'
                ],
                supportsNoPlaceholderAutoLayout: true,
                supportsRecursiveSkuLayerSets: true,
                skuSourceColorGroups: {
                    revision: 'sku-recursive-color-layer-groups/v1',
                    actions: ['listLayerSets', 'copyLayerSetToTemplate', 'executeOne', 'execute', 'arrangeDynamic'],
                    recursiveLayerSets: true,
                    canResolveNestedColorGroups: true,
                    returnsLayerSetPaths: true
                },
                noPlaceholderAutoLayout: {
                    revision: 'sku-no-placeholder-auto-layout/v2',
                    actions: ['execute', 'arrangeDynamic'],
                    plannerSchema: 'sku-auto-layout-plan/v0',
                    returnsPlanDiagnostics: true,
                    returnsPostExecutionGeometryQa: true,
                    returnsActualSubjectBoundsQa: true,
                    writesPhotoshopOnlyAfterPlanReady: true
                },
                comboExportNaming: {
                    revision: 'sku-combo-export-naming/v1',
                    usesColorComboAsFileName: true,
                    keepsExecutionOrderOutOfFileName: true
                },
                boundaries: {
                    writesPhotoshop: false,
                    claimsDesignQuality: false
                }
            },
            message: '测试模式：skuLayout 支持无占位符自动排版能力查询。'
        };
    }

    if (action === 'listLayerSets') {
        return {
            success: true,
            data: {
                layerSets: [
                    { name: '白色' },
                    { name: '黑色' }
                ]
            },
            message: '测试模式：已读取 2 个 SKU 颜色图层组。'
        };
    }

    if (action !== 'execute' && action !== 'arrangeDynamic') {
        return {
            success: false,
            error: `测试模式：不支持的 skuLayout action: ${action || 'empty'}`
        };
    }

    const activeDocument = await getActiveChatTestFakeDocument();
    const width = Math.max(1, Number(activeDocument?.width || 800));
    const height = Math.max(1, Number(activeDocument?.height || 800));
    const projectPath = useAppStore.getState().currentProject?.path;
    const outputDir = normalizeChatTestFakePath(params?.outputDir || (projectPath ? `${projectPath}\\SKU` : 'C:\\DesignEchoTest\\SKU'));
    const combos = Array.isArray(params?.combos) ? params.combos : [];
    const exportedFiles: string[] = [];

    if (action === 'execute') {
        const sizeMatch = String(params?.templateDocName || '').match(/(\d+)双/);
        const sizeLabel = sizeMatch ? `${sizeMatch[1]}双` : `${Math.max(1, combos[0]?.length || 2)}双`;
        for (let index = 0; index < combos.length; index += 1) {
            const combo = Array.isArray(combos[index]) ? combos[index].map(String).filter(Boolean) : [];
            const comboLabel = combo.length > 0 ? combo.join('+') : `组合${index + 1}`;
            const fileName = safeChatTestFileName(`${sizeLabel}-${index + 1}-${comboLabel}.jpg`);
            const filePath = `${outputDir}\\${fileName}`;
            await writeChatTestFakeSvgImage(filePath, width, height, `${sizeLabel} ${comboLabel}`);
            exportedFiles.push(JSON.stringify({
                status: 'exported_jsx',
                path: filePath,
                targetName: fileName
            }));
        }
    } else {
        const prefix = safeChatTestFileName(params?.noteFilePrefix || '自选备注');
        const fileName = `${prefix}.jpg`;
        const filePath = `${outputDir}\\${fileName}`;
        await writeChatTestFakeSvgImage(filePath, width, height, prefix);
        exportedFiles.push(JSON.stringify({
            status: 'exported_jsx',
            path: filePath,
            targetName: fileName
        }));
    }

    return {
        success: true,
        data: {
            exportedFiles
        },
        message: `测试模式：skuLayout ${action} 已导出 ${exportedFiles.length} 个文件。`
    };
}

async function buildChatTestFakePhotoshopResult(toolName: string, params: any): Promise<any | undefined> {
    if (!isChatTestFakePhotoshopEnabled()) return undefined;

    if (toolName === 'listDocuments') {
        const documents = await listChatTestFakeDocuments();
        const activeDocument = await getActiveChatTestFakeDocument();
        if (documents.length === 0) {
            return {
                success: true,
                message: '测试模式：当前没有打开文档。',
                documents: []
            };
        }
        return {
            success: true,
            message: `测试模式：返回 ${documents.length} 个打开文档。`,
            documents: documents.map((doc) => ({
                id: doc.id,
                name: doc.name,
                isActive: normalizeChatTestFakePathKey(doc.name) === normalizeChatTestFakePathKey(activeDocument?.name),
                path: doc.path,
                width: doc.width,
                height: doc.height
            }))
        };
    }

    if (toolName === 'getDocumentInfo') {
        const activeDocument = await getActiveChatTestFakeDocument();
        if (!activeDocument && !params?.__chatTestAcceptanceFailed) {
            return {
                success: false,
                documentState: 'absent',
                errorCode: 'no_active_document',
                error: '测试模式：当前没有打开文档。'
            };
        }
        return {
            success: true,
            id: activeDocument?.id || chatTestFakePhotoshopState.document.id,
            name: activeDocument?.name || chatTestFakePhotoshopState.document.name,
            path: activeDocument?.path || chatTestFakePhotoshopState.document.path,
            width: activeDocument?.width || chatTestFakePhotoshopState.document.width,
            height: activeDocument?.height || chatTestFakePhotoshopState.document.height,
            mode: 'RGB',
            layers: chatTestFakePhotoshopState.layers.length || 1,
            ...(params?.__chatTestAcceptanceFailed
                ? {
                    acceptance: {
                        enabled: true,
                        verified: false,
                        assertionStatus: 'failed',
                        noDocumentChangeRisk: false,
                        summaryText: '测试模式：模拟验收失败，用于验证 UI 不会把失败任务显示为完成。'
                    }
                }
                : {})
        };
    }

    if (toolName === 'getCanvasSnapshot') {
        const activeDocument = await getActiveChatTestFakeDocument();
        const document = activeDocument || chatTestFakePhotoshopState.document;
        return {
            success: true,
            snapshot: {
                base64: CHAT_TEST_FAKE_SNAPSHOT_BASE64,
                format: 'png',
                width: 16,
                height: 16
            },
            documentInfo: {
                id: document.id,
                name: document.name,
                width: document.width,
                height: document.height
            },
            message: '测试模式：已模拟画布快照。'
        };
    }

    if (toolName === 'createDocument') {
        chatTestFakePhotoshopState.documentCreated = true;
        chatTestFakePhotoshopState.layers = [];
        chatTestFakePhotoshopState.document = {
            id: chatTestFakePhotoshopState.document.id,
            name: String(params?.name || 'ChatBridgeGenerated.psd'),
            path: chatTestFakePhotoshopState.document.path,
            width: Math.max(1, Math.round(Number(params?.width) || 800)),
            height: Math.max(1, Math.round(Number(params?.height) || 800))
        };
        chatTestFakePhotoshopState.activeDocumentName = chatTestFakePhotoshopState.document.name;
        return {
            success: true,
            documentId: chatTestFakePhotoshopState.document.id,
            document: { ...chatTestFakePhotoshopState.document },
            message: '测试模式：已模拟创建文档。'
        };
    }

    if (toolName === 'switchDocument') {
        const documents = await listChatTestFakeDocuments();
        const requested = String(params?.documentName || params?.name || '').trim();
        const requestedKey = normalizeChatTestFakePathKey(requested);
        const matched = documents.find((doc) =>
            normalizeChatTestFakePathKey(doc.name) === requestedKey
            || normalizeChatTestFakePathKey(doc.path) === requestedKey
            || normalizeChatTestFakePathKey(basenameFromChatTestPath(doc.path)) === requestedKey
        );
        if (!matched) {
            return {
                success: false,
                error: `测试模式：未找到要切换的文档 ${requested || '(empty)'}。`
            };
        }
        chatTestFakePhotoshopState.activeDocumentName = matched.name;
        return {
            success: true,
            documentId: matched.id,
            documentName: matched.name,
            path: matched.path,
            message: `测试模式：已切换到 ${matched.name}。`
        };
    }

    if (toolName === 'createTextLayer') {
        const fontSize = Math.max(1, Math.round(Number(params?.fontSize) || 24));
        const tracking = Math.round(Number(params?.tracking) || 0);
        const content = String(params?.content ?? params?.text ?? '');
        const layer: ChatTestFakeLayer = {
            id: createFakeLayerId(),
            name: String(params?.name || `Text ${chatTestFakePhotoshopState.layers.length + 1}`),
            kind: 'text',
            content,
            fontSize,
            tracking,
            bounds: {
                left: Math.round(Number(params?.x) || 0),
                top: Math.round((Number(params?.y) || fontSize) - fontSize),
                width: estimateChatTestTextWidth(content, fontSize, tracking),
                height: Math.max(1, Math.round(fontSize * 0.92))
            }
        };
        chatTestFakePhotoshopState.layers.push(layer);
        return {
            success: true,
            layerId: layer.id,
            layer: { id: layer.id, name: layer.name },
            message: `测试模式：已模拟创建文本图层 ${layer.name}。`
        };
    }

    if (toolName === 'createRectangle') {
        const layer: ChatTestFakeLayer = {
            id: createFakeLayerId(),
            name: String(params?.name || `Rectangle ${chatTestFakePhotoshopState.layers.length + 1}`),
            kind: 'shape',
            bounds: {
                left: Math.round(Number(params?.x) || 0),
                top: Math.round(Number(params?.y) || 0),
                width: Math.max(1, Math.round(Number(params?.width) || 1)),
                height: Math.max(1, Math.round(Number(params?.height) || 1))
            }
        };
        chatTestFakePhotoshopState.layers.push(layer);
        return {
            success: true,
            layerId: layer.id,
            layer: { id: layer.id, name: layer.name },
            message: `测试模式：已模拟创建矩形图层 ${layer.name}。`
        };
    }

    if (toolName === 'renameLayer') {
        const layer = params?.layerId
            ? findChatTestFakeLayer(params.layerId)
            : params?.useCurrentSelection === true
                ? chatTestFakePhotoshopState.layers[chatTestFakePhotoshopState.layers.length - 1]
                : undefined;
        if (layer) layer.name = String(params?.newName || layer.name);
        return { success: true, layerId: layer?.id || params?.layerId, name: layer?.name || params?.newName };
    }

    if (toolName === 'deleteLayer') {
        const layer = params?.layerId
            ? findChatTestFakeLayer(params.layerId)
            : params?.useCurrentSelection === true
                ? chatTestFakePhotoshopState.layers[chatTestFakePhotoshopState.layers.length - 1]
                : undefined;
        if (!layer) return { success: false, error: '测试模式：未找到要删除的图层。' };
        chatTestFakePhotoshopState.layers = chatTestFakePhotoshopState.layers.filter((item) => item.id !== layer.id);
        return { success: true, layerId: layer.id, deletedLayerName: layer.name };
    }

    if (toolName === 'duplicateLayer') {
        const source = params?.layerId
            ? findChatTestFakeLayer(params.layerId)
            : chatTestFakePhotoshopState.layers[chatTestFakePhotoshopState.layers.length - 1];
        if (!source) return { success: false, error: '测试模式：未找到要复制的图层。' };
        const layer: ChatTestFakeLayer = {
            ...source,
            id: createFakeLayerId(),
            name: String(params?.newName || `${source.name} 拷贝`),
            bounds: { ...source.bounds }
        };
        chatTestFakePhotoshopState.layers.push(layer);
        return { success: true, layerId: layer.id, sourceLayerId: source.id, layer: { id: layer.id, name: layer.name } };
    }

    if (toolName === 'getLayerBounds') {
        return readChatTestLayerBounds(findChatTestFakeLayer(params?.layerId));
    }

    if (toolName === 'focusLayer') {
        const layer = params?.layerId
            ? findChatTestFakeLayer(params.layerId)
            : chatTestFakePhotoshopState.layers.find((item) => item.name === params?.layerName);
        const boundsResult = readChatTestLayerBounds(layer);
        if (!boundsResult.success) return boundsResult;
        return {
            success: true,
            focusedLayer: {
                id: layer!.id,
                name: layer!.name,
                kind: layer!.kind
            },
            bounds: boundsResult.bounds,
            boundsNoEffects: boundsResult.boundsNoEffects,
            focusActions: ['selectLayer(makeVisible=true)', 'app.bringToFront', 'app.updateUI'],
            viewport: {
                exactPanZoomSupported: false,
                pannedOrZoomed: false,
                reason: '测试模式：模拟图层聚焦，不模拟 Photoshop 画布视口 pan/zoom。'
            }
        };
    }

    if (toolName === 'moveLayer') {
        const layer = findChatTestFakeLayer(params?.layerId);
        if (!layer) return { success: false, error: '测试模式：未找到要移动的图层。' };
        const relative = params?.relative !== false;
        const x = Math.round(Number(params?.x) || 0);
        const y = Math.round(Number(params?.y) || 0);
        layer.bounds.left = relative ? layer.bounds.left + x : x;
        layer.bounds.top = relative ? layer.bounds.top + y : y;
        return { success: true, layerId: layer.id, bounds: readChatTestLayerBounds(layer).bounds };
    }

    if (toolName === 'reorderLayer') {
        const layer = params?.layerId
            ? findChatTestFakeLayer(params.layerId)
            : params?.useCurrentSelection === true
                ? chatTestFakePhotoshopState.layers[chatTestFakePhotoshopState.layers.length - 1]
                : undefined;
        if (!layer) return { success: false, error: '测试模式：未找到要调整顺序的图层。' };
        const layers = chatTestFakePhotoshopState.layers;
        const fromIndex = layers.findIndex((item) => item.id === layer.id);
        if (fromIndex < 0) return { success: false, error: '测试模式：图层不在当前层级中。' };

        const [removed] = layers.splice(fromIndex, 1);
        const action = String(params?.action || '');
        let toIndex = fromIndex;
        if (action === 'top') {
            toIndex = layers.length;
        } else if (action === 'bottom') {
            toIndex = 0;
        } else if (action === 'up') {
            toIndex = Math.min(layers.length, fromIndex + Math.max(1, Math.round(Number(params?.steps) || 1)));
        } else if (action === 'down') {
            toIndex = Math.max(0, fromIndex - Math.max(1, Math.round(Number(params?.steps) || 1)));
        } else if (action === 'above' || action === 'below') {
            const targetIndex = layers.findIndex((item) => item.id === Number(params?.targetLayerId));
            if (targetIndex < 0) {
                layers.splice(fromIndex, 0, removed);
                return { success: false, error: '测试模式：未找到目标图层。' };
            }
            toIndex = action === 'above' ? targetIndex + 1 : targetIndex;
        } else {
            layers.splice(fromIndex, 0, removed);
            return { success: false, error: `测试模式：未知排序动作 ${action}` };
        }
        layers.splice(Math.max(0, Math.min(layers.length, toIndex)), 0, removed);
        return {
            success: true,
            layer: {
                id: layer.id,
                name: layer.name,
                newPosition: action
            }
        };
    }

    if (toolName === 'setTextStyle') {
        const layer = findChatTestFakeLayer(params?.layerId);
        if (!layer) {
            return {
                success: true,
                layerId: params?.layerId,
                appliedStyles: {
                    fontSize: params?.fontSize,
                    tracking: params?.tracking
                },
                message: '测试模式：未找到文本图层，已跳过样式写入。'
            };
        }
        if (typeof params?.fontSize === 'number' && Number.isFinite(params.fontSize) && params.fontSize > 0) {
            layer.fontSize = Math.round(params.fontSize);
            layer.bounds.height = Math.max(1, Math.round(layer.fontSize * 0.92));
        }
        if (typeof params?.tracking === 'number' && Number.isFinite(params.tracking)) {
            layer.tracking = Math.round(params.tracking);
        }
        layer.bounds.width = estimateChatTestTextWidth(layer.content || '', layer.fontSize || 24, layer.tracking || 0);
        return {
            success: true,
            layerId: layer.id,
            appliedStyles: {
                fontSize: layer.fontSize,
                tracking: layer.tracking
            }
        };
    }

    if (toolName === 'setLayerOpacity' || toolName === 'addStroke') {
        return { success: true, layerId: params?.layerId };
    }

    if (toolName === 'groupLayers') {
        const childIds: number[] = Array.isArray(params?.layerIds) ? params.layerIds.map(Number).filter(Number.isFinite) : [];
        const childLayers = childIds
            .map((id) => findChatTestFakeLayer(id))
            .filter(Boolean) as ChatTestFakeLayer[];
        const left = childLayers.length > 0 ? Math.min(...childLayers.map((layer) => layer.bounds.left)) : 0;
        const top = childLayers.length > 0 ? Math.min(...childLayers.map((layer) => layer.bounds.top)) : 0;
        const right = childLayers.length > 0 ? Math.max(...childLayers.map((layer) => layer.bounds.left + layer.bounds.width)) : 1;
        const bottom = childLayers.length > 0 ? Math.max(...childLayers.map((layer) => layer.bounds.top + layer.bounds.height)) : 1;
        const layer: ChatTestFakeLayer = {
            id: createFakeLayerId(),
            name: String(params?.groupName || `Group ${chatTestFakePhotoshopState.layers.length + 1}`),
            kind: 'group',
            bounds: {
                left,
                top,
                width: Math.max(1, right - left),
                height: Math.max(1, bottom - top)
            }
        };
        chatTestFakePhotoshopState.layers.push(layer);
        return {
            success: true,
            group: { id: layer.id, name: layer.name },
            layerId: layer.id
        };
    }

    if (toolName === 'ungroupLayers') {
        const group = findChatTestFakeLayer(params?.groupId);
        if (!group) return { success: false, error: '测试模式：未找到要解散的图层组。' };
        chatTestFakePhotoshopState.layers = chatTestFakePhotoshopState.layers.filter((item) => item.id !== group.id);
        return { success: true, groupId: group.id, groupName: group.name };
    }

    if (toolName === 'saveDocument' || toolName === 'smartSave') {
        const format = normalizeFakeSaveExtension(params?.format || 'psd');
        const projectSubdir = String(params?.projectSubdir || 'PSD').trim().replace(/[\\/]+/g, '\\') || 'PSD';
        const savePath = String(params?.path || '').trim()
            || `C:\\DesignEchoTest\\${projectSubdir}\\ChatBridgeTest.${format}`;
        return {
            success: true,
            message: `测试模式：已模拟保存文档到 ${savePath}`,
            savePath,
            savedPath: savePath,
            format,
            redirectedFrom: params?.redirectedFrom,
            saveAs: params?.saveAs === true
        };
    }

    if (toolName === 'closeDocument') {
        const activeDocument = await getActiveChatTestFakeDocument();
        const save = params?.save === true;
        return {
            success: true,
            message: save
                ? '测试模式：已模拟保存并关闭文档。'
                : '测试模式：已模拟关闭文档且不保存。',
            closedDocument: activeDocument?.name || chatTestFakePhotoshopState.document.name,
            documentId: Number(params?.documentId) || activeDocument?.id || chatTestFakePhotoshopState.document.id,
            save
        };
    }

    if (toolName === 'skuLayout') {
        return await buildChatTestFakeSkuLayoutResult(params);
    }

    return undefined;
}


function normalizePlaceImageFilePathCandidates(filePath: string, projectPath?: string): string[] {
    const raw = String(filePath || '').trim();
    if (!raw) return [];

    const candidates: string[] = [];
    const seen = new Set<string>();
    const pushCandidate = (value?: string) => {
        const normalized = (value || '').trim();
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        candidates.push(normalized);
    };

    const decodeSafely = (value: string): string => {
        try {
            return decodeURIComponent(value);
        } catch {
            return value;
        }
    };

    const stripFileUrl = (value: string): string => value.replace(/^file:\/\//i, '').replace(/^\/+/, '');
    const toWindowsPath = (value: string): string => {
        let normalized = value.replace(/\//g, '\\');
        if (/^\\[A-Za-z]:\\/.test(normalized)) {
            normalized = normalized.slice(1);
        }
        return normalized;
    };

    const variants = [
        raw,
        decodeSafely(raw),
        stripFileUrl(raw),
        decodeSafely(stripFileUrl(raw)),
        stripFileUrl(decodeSafely(raw))
    ];

    for (const variant of variants) {
        pushCandidate(toWindowsPath(variant));
    }

    const root = String(projectPath || '').trim().replace(/[\\/]+$/, '');
    if (root) {
        const snapshot = [...candidates];
        for (const candidate of snapshot) {
            if (!/^[A-Za-z]:\\/.test(candidate) && !/^\\\\/.test(candidate)) {
                pushCandidate(`${root}\\${candidate.replace(/^[\\/]+/, '')}`);
            }
        }
    }

    return candidates;
}

function extractBase64FromReadResult(readResult: any): string | undefined {
    if (!readResult) return undefined;
    if (typeof readResult === 'string' && readResult.length > 0) return readResult;
    if (typeof readResult?.base64 === 'string' && readResult.base64.length > 0) return readResult.base64;
    return undefined;
}

function extractReadMeta(readResult: any): {
    mimeType?: string;
    assetId?: string;
    checksum?: string;
    byteLength?: number;
} {
    if (!readResult || typeof readResult !== 'object') {
        return {};
    }
    return {
        mimeType: typeof readResult.mimeType === 'string' ? readResult.mimeType : undefined,
        assetId: typeof readResult.assetId === 'string' ? readResult.assetId : undefined,
        checksum: typeof readResult.checksum === 'string' ? readResult.checksum : undefined,
        byteLength: typeof readResult.byteLength === 'number' ? readResult.byteLength : undefined
    };
}

function resolveImageFormat(metaMimeType?: string, pathHint?: string): string {
    const mime = (metaMimeType || '').toLowerCase();
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    if (mime.includes('png')) return 'png';
    if (mime.includes('gif')) return 'gif';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('tiff')) return 'tiff';
    if (mime.includes('bmp')) return 'bmp';

    const ext = ((pathHint || '').match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
    if (ext) return ext;
    return 'png';
}

﻿// AUTO_SELECT_BLOCK_START

type AutoSelectFile = {
    path?: string;
    name?: string;
    relativePath?: string;
    type?: string;
    extension?: string;
    dimensions?: { width?: number; height?: number };
    size?: number;
};

type AutoSelectRecommendation = {
    file?: AutoSelectFile;
    matchScore?: number;
    matchReason?: string;
    suggestedUse?: string;
    visualObserved?: boolean;
    visualRole?: DesignAssetVisualRole;
    backgroundType?: string;
    directUseSuitability?: string;
    sourceTreatment?: string;
    visualEvidence?: {
        observed?: boolean;
        role?: string;
        backgroundType?: string;
        directUseSuitability?: string;
        sourceTreatment?: string;
        reason?: string;
    };
};

type AutoSelectCandidate = {
    path: string;
    name?: string;
    relativePath?: string;
    score: number;
    reason: string;
    suggestedUse?: string;
    visualObserved: boolean;
    visualRole?: string;
    backgroundType?: string;
    directUseSuitability: DesignAssetDirectUseSuitability;
    sourceTreatment: DesignAssetSourceTreatment;
};

type AutoSelectDecision = {
    code?: string;
    requirement: string;
    designRole?: string;
    placementIntent?: string;
    mode: 'auto' | 'suggest' | 'force';
    strictDeterministic: boolean;
    thresholds: { minScore: number; minMargin: number };
    topScore: number;
    margin: number;
    selectionAuthority?: 'visual_evidence' | 'agent_judgment' | 'harness_receipt';
    autoPlacementEligible?: boolean;
    candidates: AutoSelectCandidate[];
};

function normalizeAutoSelectEvidenceValue(value: unknown): string {
    return String(value || '').trim().toLowerCase();
}

function normalizeDirectUseSuitability(value: unknown): DesignAssetDirectUseSuitability {
    const normalized = normalizeAutoSelectEvidenceValue(value);
    if (normalized === 'suitable' || normalized === 'conditional' || normalized === 'unsuitable') {
        return normalized;
    }
    return 'unsuitable';
}

function normalizeVisualRole(value: unknown): DesignAssetVisualRole {
    const normalized = normalizeAutoSelectEvidenceValue(value);
    if (
        normalized === 'hero_product'
        || normalized === 'hero_scene'
        || normalized === 'model_context'
        || normalized === 'detail_evidence'
        || normalized === 'material_evidence'
        || normalized === 'background'
        || normalized === 'decorative'
        || normalized === 'reference'
    ) {
        return normalized;
    }
    return 'unknown';
}

function normalizeSourceTreatment(value: unknown): DesignAssetSourceTreatment {
    const normalized = normalizeAutoSelectEvidenceValue(value);
    if (
        normalized === 'direct_full_frame'
        || normalized === 'clip_to_container'
        || normalized === 'matte_and_recompose'
        || normalized === 'supporting_only'
        || normalized === 'reject'
        || normalized === 'requires_visual_review'
    ) {
        return normalized;
    }
    return 'requires_visual_review';
}

function buildPlaceImageSelectionBlock(
    params: any,
    decision: Partial<AutoSelectDecision> & { code: string; requirement?: string }
): any {
    return {
        ...params,
        __autoSelectBlocked: true,
        __autoSelectDecision: {
            requirement: decision.requirement || extractPlaceImageRequirement(params),
            designRole: decision.designRole || String(params?.designRole || '').trim() || undefined,
            placementIntent: decision.placementIntent || String(params?.placementIntent || '').trim() || undefined,
            mode: decision.mode || 'suggest',
            strictDeterministic: decision.strictDeterministic ?? (params?.strictDeterministic === true),
            thresholds: decision.thresholds || { minScore: 72, minMargin: 8 },
            topScore: decision.topScore || 0,
            margin: decision.margin || 0,
            candidates: decision.candidates || [],
            autoPlacementEligible: decision.autoPlacementEligible === true,
            code: decision.code
        }
    };
}

function extractPlaceImageRequirement(params: any): string {
    const keys = ['requirement', 'query', 'prompt', 'description', 'subject', 'intent', 'keyword'];
    for (const key of keys) {
        const value = String(params?.[key] || '').trim();
        if (value) return value;
    }
    return '';
}

function normalizePlaceImageCategory(value: any): string | undefined {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return undefined;
    if (['products', 'backgrounds', 'elements', 'references', 'others'].includes(raw)) {
        return raw;
    }
    return undefined;
}

function clampAutoScore(score: number): number {
    if (!Number.isFinite(score)) return 0;
    return Math.max(0, Math.min(100, Math.round(score)));
}

function sortAutoSelectCandidates(
    candidates: AutoSelectCandidate[],
    strictDeterministic: boolean
): AutoSelectCandidate[] {
    return [...candidates].sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (strictDeterministic) {
            return a.path.localeCompare(b.path);
        }
        return 0;
    });
}

function rankFallbackImagesFromScan(
    scanResult: any,
    requirement: string,
    limit: number = 3,
    strictDeterministic: boolean = false
): AutoSelectCandidate[] {
    const files: AutoSelectFile[] = Array.isArray(scanResult?.files) ? scanResult.files : [];
    const images = files.filter((f) => typeof f?.path === 'string' && f.path && f.type === 'image');
    if (images.length === 0) return [];

    const keywords = requirement
        .toLowerCase()
        .split(/[\s,;:，。！？、/\\|()[\]{}"'`~!@#$%^&*+=<>?-]+/)
        .map((k) => k.trim())
        .filter((k) => k.length >= 2);

    const scored = images.map((file): AutoSelectCandidate => {
        const name = String(file.name || '').toLowerCase();
        const relativePath = String(file.relativePath || '').toLowerCase();
        const searchText = `${name} ${relativePath}`;

        let score = 10;
        for (const keyword of keywords) {
            if (searchText.includes(keyword)) {
                score += 18;
            }
        }

        const width = Number(file.dimensions?.width || 0);
        const height = Number(file.dimensions?.height || 0);
        if (width > 0 && height > 0) {
            const megaPixels = (width * height) / 1_000_000;
            score += Math.min(20, megaPixels * 5);
        }

        const ext = String(file.extension || '').toLowerCase();
        if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.webp') {
            score += 3;
        }

        return {
            path: String(file.path),
            name: file.name,
            relativePath: file.relativePath,
            score: clampAutoScore(score),
            reason: 'fallback_scan_match',
            suggestedUse: 'Scored from local scan fallback; visual content was not observed.',
            visualObserved: false,
            directUseSuitability: 'unsuitable',
            sourceTreatment: 'requires_visual_review'
        };
    });

    return sortAutoSelectCandidates(scored, strictDeterministic).slice(0, Math.max(1, limit));
}

async function autoResolvePlaceImageSource(params: any): Promise<any> {
    if (params?.imageData || params?.filePath || params?.fileToken) {
        return params;
    }

    // placeImage 是执行工具，不拥有素材发现权。缺少 source 时默认不扫描、不猜测；
    // 调用方必须先显式选择素材，或明确请求一次有视觉证据的自动选择。
    if (params?.autoSelect !== true) {
        return buildPlaceImageSelectionBlock(params, {
            code: 'explicit_source_required',
            mode: 'suggest'
        });
    }

    const designEcho = (window as any).designEcho;
    if (!designEcho) {
        return buildPlaceImageSelectionBlock(params, {
            code: 'asset_selection_service_unavailable',
            mode: 'suggest'
        });
    }

    const requirement = extractPlaceImageRequirement(params);
    const designRole = String(params?.designRole || '').trim().toLowerCase();
    const placementIntent = String(params?.placementIntent || '').trim().toLowerCase();
    const category = normalizePlaceImageCategory(params?.category);
    const selectionMode = (String(params?.selectionMode || params?.autoSelectMode || 'auto').toLowerCase() as 'auto' | 'suggest' | 'force');
    const strictDeterministic = params?.strictDeterministic === true;
    const minScore = Number.isFinite(Number(params?.minScore)) ? Number(params.minScore) : 72;
    const minMargin = Number.isFinite(Number(params?.minMargin)) ? Number(params.minMargin) : 8;
    const candidateCountRaw = Number(params?.candidateCount);
    const candidateCount = Number.isFinite(candidateCountRaw)
        ? Math.max(1, Math.min(5, Math.floor(candidateCountRaw)))
        : 3;

    if (!requirement) {
        return buildPlaceImageSelectionBlock(params, {
            code: 'selection_requirement_required',
            designRole,
            placementIntent,
            mode: selectionMode,
            strictDeterministic,
            thresholds: { minScore, minMargin }
        });
    }

    let candidates: AutoSelectCandidate[] = [];

    try {
        const recommendResult = await designEcho.recommendAssets({
            requirement,
            maxResults: Math.max(candidateCount, 5),
            category,
            designRole: designRole || undefined,
            placementIntent: placementIntent || undefined,
            deterministic: strictDeterministic
        });

        const recommendations: AutoSelectRecommendation[] = Array.isArray(recommendResult?.recommendations)
            ? recommendResult.recommendations
            : [];
        candidates = recommendations
            .filter((r) => typeof r?.file?.path === 'string' && !!r.file?.path)
            .map((r) => {
                const visualEvidence = r.visualEvidence || {};
                const visualObserved = r.visualObserved === true || visualEvidence.observed === true;
                const directUseSuitability = normalizeDirectUseSuitability(
                    r.directUseSuitability || visualEvidence.directUseSuitability
                );
                const sourceTreatment = normalizeSourceTreatment(
                    r.sourceTreatment || visualEvidence.sourceTreatment
                );
                return {
                    path: String(r.file!.path),
                    name: r.file?.name,
                    relativePath: r.file?.relativePath,
                    score: clampAutoScore(Number(r.matchScore || 0)),
                    reason: String(r.matchReason || visualEvidence.reason || '').trim() || 'recommendation',
                    suggestedUse: String(r.suggestedUse || '').trim(),
                    visualObserved,
                    visualRole: normalizeVisualRole(r.visualRole || visualEvidence.role),
                    backgroundType: String(r.backgroundType || visualEvidence.backgroundType || '').trim() || undefined,
                    directUseSuitability,
                    sourceTreatment
                };
            });
        candidates = sortAutoSelectCandidates(candidates, strictDeterministic);
    } catch (error) {
        console.warn('[placeImage] auto-recommend failed, fallback to local scan:', error);
    }

    // auto 只有视觉比较结果才能落图；推荐服务失败后再递归扫目录只能得到元数据，
    // 既无法通过自动置入边界又会制造额外 IO。fallback 仅保留给 suggest/有来源 force 展示候选。
    if (candidates.length === 0 && selectionMode !== 'auto') {
        try {
            const projectPath = await getCurrentProjectPath();
            if (projectPath && designEcho?.setProjectRoot) {
                await designEcho.setProjectRoot(projectPath);
            }
            const scanResult = await designEcho.scanDirectory(projectPath || undefined, {
                recursive: true,
                includeDesignFiles: false,
                maxDepth: 6
            });
            candidates = rankFallbackImagesFromScan(scanResult, requirement, Math.max(candidateCount, 3), strictDeterministic);
        } catch (error) {
            console.warn('[placeImage] local scan fallback failed:', error);
        }
    }

    if (candidates.length === 0) {
        return buildPlaceImageSelectionBlock(params, {
            code: 'no_asset_candidate',
            requirement,
            designRole,
            placementIntent,
            mode: selectionMode,
            strictDeterministic,
            thresholds: { minScore, minMargin }
        });
    }

    const topCandidate = candidates[0];
    const secondCandidate = candidates[1];
    const margin = secondCandidate ? (topCandidate.score - secondCandidate.score) : topCandidate.score;
    const decision: AutoSelectDecision = {
        requirement,
        designRole: designRole || undefined,
        placementIntent: placementIntent || undefined,
        mode: selectionMode,
        strictDeterministic,
        thresholds: { minScore, minMargin },
        topScore: topCandidate.score,
        margin,
        candidates: candidates.slice(0, candidateCount)
    };

    const autoPlacementDecision = evaluateDesignAssetAutoPlacement({
        mode: selectionMode,
        designRole,
        minScore,
        minMargin,
        candidates
    });
    decision.selectionAuthority = autoPlacementDecision.authority;
    decision.autoPlacementEligible = autoPlacementDecision.eligible;
    const blockCode = autoPlacementDecision.eligible ? '' : autoPlacementDecision.code;

    if (blockCode) {
        return buildPlaceImageSelectionBlock(params, {
            ...decision,
            code: blockCode,
            autoPlacementEligible: false
        });
    }

    const fallbackName = String(topCandidate.name || topCandidate.relativePath || '')
        .split(/[\\/]/)
        .pop();

    const autoSelected = {
        ...decision,
        selectedPath: topCandidate.path,
        selectedReason: topCandidate.reason
    };

    console.log('[placeImage] auto-selected candidate:', autoSelected);

    return {
        ...params,
        filePath: topCandidate.path,
        name: String(params?.name || '').trim() || fallbackName || 'Auto Selected Image',
        fitToCanvas: params?.fitToCanvas ?? false,
        autoSelected
    };
}

// AUTO_SELECT_BLOCK_END
async function getCurrentProjectPath(): Promise<string> {
    try {
        return useAppStore.getState().currentProject?.path || '';
    } catch {
        return '';
    }
}
const AUTOMATION_BLOCK_DIALOG = true;

function sanitizeFileName(name: string): string {
    const base = (name || 'document').replace(/\.[^.]+$/, '');
    const safe = base.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
    return safe || 'document';
}

function normalizeNoDialogSaveFormat(value: any): string {
    const text = String(value || 'psd').trim().toLowerCase();
    const extensionMatch = text.match(/\.([a-z0-9]+)(?:[?#].*)?$/i);
    const format = extensionMatch?.[1] || text;
    if (format === 'psb') return 'psb';
    if (format === 'png') return 'png';
    if (format === 'jpg' || format === 'jpeg') return 'jpg';
    if (format === 'tif' || format === 'tiff') return 'tiff';
    if (format === 'pdf') return 'pdf';
    return 'psd';
}

function isExplicitRasterFilePath(value: any): boolean {
    return /\.(?:png|jpe?g)$/i.test(String(value || '').trim());
}

function buildNoDialogSavePath(projectPath: string, documentName?: string, format?: string): string {
    const safeName = sanitizeFileName(documentName || 'document');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const root = projectPath.replace(/[\\/]+$/, '');
    const ext = normalizeNoDialogSaveFormat(format);
    return `${root}\\${safeName}_autosave_${stamp}.${ext}`;
}

function sanitizeProjectSaveSubdir(value: any): string | undefined {
    const subdir = String(value || '').trim();
    if (!subdir) return undefined;
    if (subdir.includes('/') || subdir.includes('\\') || subdir.includes('..')) return undefined;
    const safe = subdir.replace(/[<>:"|?*\x00-\x1F]/g, '_').trim();
    return safe || undefined;
}

async function resolveNoDialogSaveRoot(projectPath: string, requestedSubdir?: any): Promise<{
    directory: string;
    error?: string;
}> {
    const root = projectPath.replace(/[\\/]+$/, '');
    const safeSubdir = sanitizeProjectSaveSubdir(requestedSubdir);
    if (!safeSubdir) {
        return { directory: root };
    }

    const targetDirectory = `${root}\\${safeSubdir}`;
    const bridge = (window as any).designEcho;
    if (!bridge?.createDirectory) {
        return {
            directory: root,
            error: `无法创建项目子目录 ${safeSubdir}：文件系统桥接不可用`
        };
    }

    try {
        const exists = bridge.pathExists ? await bridge.pathExists(targetDirectory) : false;
        if (!exists) {
            const created = await bridge.createDirectory(targetDirectory);
            if (created?.success === false) {
                return {
                    directory: root,
                    error: created?.error || `创建项目子目录失败：${targetDirectory}`
                };
            }
        }
        return { directory: targetDirectory };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error || '未知错误');
        return {
            directory: root,
            error: `创建项目子目录失败：${message}`
        };
    }
}

function hasValue(v: any): boolean {
    return v !== undefined && v !== null && String(v).trim() !== '';
}

export interface ToolCallExecutionOptions {
    signal?: AbortSignal;
}

function buildCancelledToolResult(toolName: string): Record<string, any> {
    return {
        success: false,
        cancelled: true,
        error: '任务已取消',
        message: `已停止 ${toolName}，不会继续发送后续 Photoshop 操作。`
    };
}

function isCancelledToolError(message: string): boolean {
    return /请求已取消|任务已取消|cancelled|canceled|abort/i.test(message);
}

async function sendToPluginWithCancellation(
    method: string,
    params: any,
    timeout?: number,
    options: ToolCallExecutionOptions = {},
    publicToolName: string = method
): Promise<any> {
    const signal = options.signal;
    if (signal?.aborted) {
        return buildCancelledToolResult(publicToolName);
    }

    try {
        return await callPhotoshopMcpTool(method, params ?? {}, {
            signal,
            timeoutMs: timeout
        });
    } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error || '工具调用失败');
        if (isDispatchedPhotoshopOperationUnknown(message)) {
            throw error;
        }
        if (signal?.aborted || isCancelledToolError(message)) {
            return buildCancelledToolResult(publicToolName);
        }
        throw error;
    }
}

async function getCurrentDocumentName(): Promise<string | undefined> {
    try {
        const result = await sendToPluginWithCancellation('getDocumentInfo', {});
        return result?.documentName || result?.name || result?.document?.name;
    } catch {
        return undefined;
    }
}

/**
 * 结构化探测当前文档状态。纪律：只有 UXP 返回的结构化确认
 * （documentState:'absent' / errorCode:'no_active_document'）才能断言"没有打开的文档"；
 * 探测本身失败或 UXP 报 unknown 时必须保持中性——读取失败不代表没有文档
 * （Photoshop 可能正忙、处于模态或文档仍在加载）。
 */
async function probeCurrentDocumentPresence(): Promise<{ state: 'present' | 'absent' | 'unknown'; name?: string }> {
    try {
        const result = await sendToPluginWithCancellation('getDocumentInfo', {});
        if (result?.documentState === 'absent' || result?.errorCode === 'no_active_document') {
            return { state: 'absent' };
        }
        const name = result?.documentName || result?.name || result?.document?.name;
        if (result?.success !== false && name) {
            return { state: 'present', name };
        }
        return { state: 'unknown' };
    } catch {
        return { state: 'unknown' };
    }
}

async function captureAcceptanceSnapshot(
    stage: 'before' | 'after',
    toolName: string,
    options: {
        includeHidden: boolean;
        includeBounds: boolean;
        includeText: boolean;
        maxLayers: number;
        timeoutMs: number;
        signal?: AbortSignal;
    }
): Promise<AcceptanceCaptureResult> {
    try {
        const designEcho = (window as any).designEcho;
        if (!designEcho?.sendToPlugin) {
            return { error: `无法采集 ${stage} 快照：DesignEcho Photoshop bridge 不可用` };
        }
        const snapshot = await sendToPluginWithCancellation('getAcceptanceSnapshot', {
            includeHidden: options.includeHidden,
            includeBounds: options.includeBounds,
            includeText: options.includeText,
            maxLayers: options.maxLayers
        }, options.timeoutMs, { signal: options.signal }, 'getAcceptanceSnapshot');

        if (!snapshot || snapshot.success === false) {
            return { snapshot, error: snapshot?.error || `无法采集 ${stage} 快照` };
        }
        return { snapshot };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error || '未知错误');
        console.warn(`[Acceptance] ${stage} snapshot failed for ${toolName}:`, message);
        return { error: message };
    }
}

function attachAcceptanceVerification(toolName: string, params: any, result: any, before: AcceptanceCaptureResult, after: AcceptanceCaptureResult): any {
    const acceptance = buildToolAcceptanceVerification({
        toolName,
        params,
        result,
        before,
        after
    });
    const photoshopHistoryTransition = buildPhotoshopHistoryTransition(
        before.snapshot,
        after.snapshot
    );

    if (result && typeof result === 'object' && !Array.isArray(result)) {
        return {
            ...result,
            acceptance,
            photoshopHistoryTransition
        };
    }

    return {
        success: result !== false,
        value: result,
        acceptance,
        photoshopHistoryTransition
    };
}

function normalizeFailedToolResultForPublicUse(result: any): any {
    if (!result || typeof result !== 'object' || Array.isArray(result) || result.success !== false) {
        return result;
    }

    const normalized = { ...result };
    if (typeof normalized.error === 'string' && normalized.error.trim()) {
        normalized.error = sanitizeUserVisibleDiagnosticText(normalized.error) || normalized.error;
    }
    if (typeof normalized.message === 'string' && normalized.message.trim()) {
        normalized.message = sanitizeUserVisibleDiagnosticText(normalized.message) || normalized.message;
    }
    return normalized;
}

function buildInteractiveCardToolResult(params: any): {
    success: boolean;
    message?: string;
    interactiveCards?: InteractiveCardDefinition[];
    error?: string;
} {
    const cardKind = cleanInteractiveCardText(params?.cardKind || params?.kind || params?.type);
    if (cardKind === 'sku_combo_editor') {
        // 明确拒绝：SKU 组合确认卡必须由 sku-batch 技能产出。sku-batch 会检查项目素材、用规范生成器
        // 算出真实颜色组合，再经 buildSkuComboConfirmationRequest 把组合预填进可编辑组合表。
        // createInteractiveCard 没有项目上下文与生成器，硬建只会得到空/臆造的组合卡，用户提交也接不回
        // SKU 出图管线（即用户反馈的“卡片偏离预期、提交也无法完成 SKU”）。这里指路而非静默兜底建空卡。
        return {
            success: false,
            error: 'createInteractiveCard 不能自建 SKU 组合卡。请调用 sku-batch；该 Skill 会依据真实用户指令和项目事实决定直接生产草稿，或在用户明确要求时返回可编辑组合确认卡。'
        };
    }
    if (cardKind === 'editable_confirmation' || Array.isArray(params?.fields)) {
        const card = buildEditableConfirmationInteractiveCard({
            id: params?.id,
            title: params?.title,
            description: params?.description,
            fields: params?.fields || params?.payload?.fields || [],
            initialValue: params?.initialValue || params?.payload?.initialValue,
            projectId: params?.projectId,
            productType: params?.productType,
            style: params?.style,
            memoryEnabled: params?.memoryEnabled === true,
            memoryKind: params?.memoryKind,
            tags: params?.tags || params?.payload?.tags
        });
        return {
            success: true,
            message: '已创建可编辑确认卡片。',
            interactiveCards: [card]
        };
    }

    const title = cleanInteractiveCardText(params?.title) || '请确认';
    const payload = params?.payload && typeof params.payload === 'object'
        ? params.payload
        : {};
    const card: InteractiveCardDefinition = {
        version: 'interactive-card/v0',
        id: cleanInteractiveCardText(params?.id) || `interactive-card-${stableInteractiveCardHash({ cardKind, title, payload })}`,
        kind: cardKind || 'generic_confirmation',
        title,
        description: cleanInteractiveCardText(params?.description),
        payload,
        status: 'draft',
        submitAction: 'submitInteractiveCard',
        memoryPolicy: {
            enabled: false,
            mode: 'none'
        }
    };
    return {
        success: true,
        message: '已创建确认卡片。',
        interactiveCards: [card]
    };
}
// ==================== 工具执行 ====================

/**
 * 执行工具调用
 */
const executeToolCallImpl = async (toolName: string, params: any, options: ToolCallExecutionOptions = {}): Promise<any> => {
    const startTime = Date.now();
    console.log(`[ToolCall] 执行: ${toolName}`, params);

    if (options.signal?.aborted) {
        const cancelledResult = buildCancelledToolResult(toolName);
        toolLogger.logToolCall(toolName, params, cancelledResult, Date.now() - startTime, currentRound);
        return cancelledResult;
    }
    
    // 依赖检查
    const depCheck = checkToolDependencies(toolName, executedToolsInSession, params);
    if (!depCheck.valid) {
        console.warn(`[ToolCall] 依赖检查失败:`, depCheck);
        const result = { 
            success: false, 
            error: `工具依赖未满足: ${depCheck.missingDependencies.join(', ')}`,
            suggestion: depCheck.suggestion
        };
        toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
        return result;
    }
    
    try {
        let result: any;

        if (toolName === 'createInteractiveCard') {
            result = buildInteractiveCardToolResult(params || {});
            if (result.success) executedToolsInSession.push(toolName);
            toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
            return result;
        }

        const chatTestFakePhotoshopResult = await buildChatTestFakePhotoshopResult(toolName, params);
        if (chatTestFakePhotoshopResult) {
            if (chatTestFakePhotoshopResult.success) {
                executedToolsInSession.push(toolName);
                recordToolExecution(toolName, params, chatTestFakePhotoshopResult);
            }
            toolLogger.logToolCall(toolName, params, chatTestFakePhotoshopResult, Date.now() - startTime, currentRound);
            return chatTestFakePhotoshopResult;
        }
        
        // Renderer / Harness 本地工具在 Agent 端处理，禁止误发到 Photoshop UXP。
        if (RENDERER_LOCAL_TOOLS.includes(toolName)) {
            result = await executeResourceTool(toolName, params);
            if (result.success) executedToolsInSession.push(toolName);
            toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
            return result;
        }

        // 声明式版面渲染：模型只出"放什么 + 各占多少"，坐标/图层顺序/字号/字色由引擎和代码确定，
        // 批量建图层——替代逐个 transformLayer 手填坐标（手填靠空间想象，必然重叠/溢出/不齐）。
        if (toolName === 'renderLayout') {
            const { solveLayout, solveRegionLayout } = await import('../../shared/layout/layout-engine');
            const { evaluateImagePlacementQuality } = await import('../../shared/layout/image-placement-quality');
            const { resolveRenderLayoutStyle } = await import('../../shared/layout/render-layout-style');
            const { validateCreativeStagePlan } = await import('../../shared/creative-stage-plan');
            const canvas = (params.canvas && params.canvas.width && params.canvas.height) ? params.canvas : null;
            const rawSpecBlocks = Array.isArray(params.blocks) ? params.blocks : [];
            const rawSpecRegions = Array.isArray(params.regions) ? params.regions : [];
            // 二维区域模式优先：regions 有值时按归一化 bounds 自由构图（左右分栏/图文叠压），
            // 否则走垂直堆叠。两种模式共用同一套渲染角色、草稿替换与建层管线。
            const regionMode = rawSpecRegions.length > 0;
            const specBlocks = (regionMode ? rawSpecRegions : rawSpecBlocks).map((block: any, index: number) => {
                const role = String(block?.role || 'block').trim() || 'block';
                const id = String(block?.id || '').trim();
                return {
                    ...block,
                    id: id || `${role}-${index + 1}`
                };
            });
            const stagePlanValidation = params.stagePlan
                ? validateCreativeStagePlan(params.stagePlan)
                : null;
            if (stagePlanValidation && !stagePlanValidation.valid) {
                result = {
                    success: false,
                    error: `renderLayout 的 stagePlan 不完整：${stagePlanValidation.blockers.join('；')}`,
                    stagePlanValidation
                };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
            if (!canvas) {
                result = { success: false, error: 'renderLayout 需要 canvas.width 和 canvas.height，且必须与当前新建画布尺寸一致；不能依赖默认 800x800。' };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
            if (specBlocks.length === 0) {
                result = { success: false, error: 'renderLayout 需要 blocks（垂直堆叠：role + content + heightRatio）或 regions（二维构图：role + content + 归一化 bounds{x,y,width,height}）之一。坐标和图层顺序由引擎确定，你不要填像素坐标或 z。' };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
            const supportedRenderLayoutRoles = new Set(['background', 'main-image', 'title', 'subtitle', 'selling-point', 'tag', 'decoration']);
            const invalidBlock = specBlocks.find((block: any) => !supportedRenderLayoutRoles.has(String(block?.role || '').trim()));
            if (invalidBlock) {
                result = {
                    success: false,
                    error: `renderLayout ${regionMode ? 'region' : 'block'} ${String(invalidBlock.id || '').trim() || '未命名'} 的 role「${String(invalidBlock.role || '空')}」不支持；只能使用 background/main-image/title/subtitle/selling-point/tag/decoration。`
                };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
            if (regionMode) {
                const missingBounds = specBlocks.find((block: any) => String(block?.role || '').trim() !== 'background'
                    && !(block?.bounds && typeof block.bounds === 'object'
                        && Number.isFinite(Number(block.bounds.x)) && Number.isFinite(Number(block.bounds.y))
                        && Number(block.bounds.width) > 0 && Number(block.bounds.height) > 0));
                if (missingBounds) {
                    result = {
                        success: false,
                        error: `renderLayout region ${String(missingBounds.id || '').trim() || '未命名'} 缺少有效的归一化 bounds：需要 {x,y,width,height} 且均在 0..1 之间、width/height > 0（background 区域可不给 bounds，自动满画布）。`
                    };
                    toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                    return result;
                }
            }
            const stageId = String(params.stagePlan?.currentStage?.id || '').trim();
            const stageTitle = String(params.stagePlan?.currentStage?.title || '').replace(/\s+/g, ' ').trim().slice(0, 12);
            // 组名用业务可读名（如「A-首屏KV·首屏KV」风格的 id·标题）——图层树本身就是详情页结构文档；
            // 替换识别见下方 isCurrentStageDraftGroupName（兼容旧「阶段草稿-{id}」格式）。
            const stageGroupName = stageId ? (stageTitle ? `${stageId}·${stageTitle}` : `阶段草稿-${stageId}`) : '';
            // 逐屏排版区间：详情页等长文档上，本屏只在 screenRegion 指定的像素区间内求解并平移，
            // 否则每次 renderLayout 都从文档顶部排，多屏必然互相覆盖。
            const screenRegionRaw = params.screenRegion && typeof params.screenRegion === 'object' ? params.screenRegion : null;
            const screenRegion = (screenRegionRaw
                && Number.isFinite(Number(screenRegionRaw.y))
                && Number(screenRegionRaw.height) > 0)
                ? { y: Math.max(0, Math.round(Number(screenRegionRaw.y))), height: Math.round(Number(screenRegionRaw.height)) }
                : null;
            const isLongCanvas = Number(canvas.height) > Number(canvas.width) * 3;
            if (isLongCanvas && stageId && !screenRegion) {
                result = {
                    success: false,
                    error: 'renderLayout 正在处理分阶段长画布，但缺少 screenRegion。为避免把当前阶段铺到整张长图并生成不可读缩略图，请提供本阶段 {y,height} 像素区间后再写入。'
                };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
            if (screenRegion && screenRegion.y + screenRegion.height > Number(canvas.height) + 1) {
                result = {
                    success: false,
                    error: `renderLayout 的 screenRegion 超出文档：区间 y=${screenRegion.y} + height=${screenRegion.height} 大于画布高度 ${canvas.height}。请按整页文档的真实像素给本屏区间。`
                };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
            // 先完成纯逻辑求解与图片语义预检，再删除旧草稿或写 Photoshop。
            // 任何当前执行层尚不支持的声明都必须 fail closed，不能先写半成品再让模型返工。
            const solveCanvas = screenRegion ? { width: canvas.width, height: screenRegion.height } : canvas;
            // 版面结构参数：边距/间距的唯一来源是栅格刻度，模型只能选档位不能给像素。
            // 非法值不在这里拦截——布局引擎会回落默认值并把原因写进 warnings，避免为一个可降级的
            // 参数问题拒绝整次写入。
            const numericParam = (value: unknown): number | undefined => {
                if (value === undefined || value === null) return undefined;
                const parsed = Number(value);
                return Number.isFinite(parsed) ? parsed : undefined;
            };
            const gridOptions = {
                columns: numericParam(params.columns),
                marginScale: numericParam(params.marginScale),
                gutterScale: numericParam(params.gutterScale)
            };
            const gapScale = numericParam(params.gapScale);
            const solveOutcome = regionMode
                ? solveRegionLayout({ canvas: solveCanvas, ...gridOptions, regions: specBlocks })
                : solveLayout({ canvas: solveCanvas, ...gridOptions, gapScale, blocks: specBlocks });
            const warnings = [...solveOutcome.warnings];
            const resolved = screenRegion
                ? solveOutcome.blocks.map((block) => ({ ...block, y: block.y + screenRegion.y }))
                : solveOutcome.blocks;
            const placementPreflightFindings: any[] = [];
            for (const block of resolved) {
                if (!['main-image', 'decoration', 'tag'].includes(block.role)) continue;
                const src = typeof block.content === 'string'
                    && /\.(png|jpe?g|webp|psd|psb)$/i.test(block.content)
                    ? block.content
                    : null;
                if (!src) continue;
                const placement: Partial<ImagePlacementSpec> = block.imagePlacement
                    && typeof block.imagePlacement === 'object'
                    ? block.imagePlacement
                    : {};
                const unsupportedSemantics: string[] = [];
                const anchor = String(placement.anchor || 'center').toLowerCase();
                if (anchor !== 'center') unsupportedSemantics.push(`anchor=${anchor}`);
                const scale = placement.scale === undefined ? 1 : Number(placement.scale);
                if (!Number.isFinite(scale) || Math.abs(scale - 1) > 0.001) {
                    unsupportedSemantics.push(`scale=${String(placement.scale)}`);
                }
                const rotation = placement.rotation === undefined ? 0 : Number(placement.rotation);
                if (!Number.isFinite(rotation) || Math.abs(rotation) > 0.001) {
                    unsupportedSemantics.push(`rotation=${String(placement.rotation)}`);
                }
                if (placement.focalPoint) unsupportedSemantics.push('focalPoint');
                if (placement.mask === 'shape') unsupportedSemantics.push('shape mask');

                const fit = placement.fit === 'cover' ? 'cover' : 'contain';
                const hasRectangularClip = placement.mask === 'clipping' || placement.overflow === 'clip';
                const isWholeDocument = Math.abs(block.x) <= 1
                    && Math.abs(block.y) <= 1
                    && Math.abs(block.width - Number(canvas.width)) <= 1
                    && Math.abs(block.height - Number(canvas.height)) <= 1;
                if (fit === 'cover' && !hasRectangularClip && !isWholeDocument) {
                    unsupportedSemantics.push('cover without clipping/clip on a non-document region');
                }
                if (unsupportedSemantics.length > 0) {
                    placementPreflightFindings.push({
                        code: 'placement_semantics_unsupported_prewrite',
                        severity: 'repair',
                        closureKind: 'replan',
                        blockId: block.id,
                        role: block.role,
                        message: `图片块「${block.id}」包含当前 renderLayout 尚不能可靠执行的语义：`
                            + `${unsupportedSemantics.join('、')}。本次未写入任何草稿，请先重规划为已支持语义。`,
                        recommendedStrategies: [
                            '使用 center + scale=1 + rotation=0 且不设置 focalPoint',
                            '非整画布 cover 必须声明 mask=clipping 或 overflow=clip',
                            '需要复杂锚点/焦点/形状蒙版时改用具备该能力的专用执行路径'
                        ]
                    });
                }
            }
            if (placementPreflightFindings.length > 0) {
                result = {
                    success: false,
                    status: 'failed',
                    qualityState: 'failed',
                    continuationRequired: true,
                    requiresVisualReview: false,
                    qualityFindings: placementPreflightFindings,
                    errors: placementPreflightFindings.map((finding) => ({
                        block: finding.blockId,
                        role: finding.role,
                        error: finding.message
                    })),
                    warnings,
                    message: 'renderLayout 在写入前拒绝了当前无法可靠执行的图片落位语义；Photoshop 文档未被本次调用修改。'
                };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
            const flattenHierarchyLayers = (layers: any[], out: any[] = []): any[] => {
                for (const layer of Array.isArray(layers) ? layers : []) {
                    out.push(layer);
                    flattenHierarchyLayers(layer?.children || layer?.layers || [], out);
                }
                return out;
            };
            const buildExpectedTopLevelDraftLayerNames = (): Set<string> => {
                const names = new Set<string>();
                for (const block of specBlocks) {
                    const role = String(block?.role || '').trim();
                    const id = String(block?.id || '').trim();
                    if (!id || role === 'background') continue;
                    if (role === 'selling-point') {
                        names.add(`${id}-底块`);
                        names.add(`${id}-文字`);
                    } else if (role === 'main-image' || role === 'decoration' || role === 'tag') {
                        const content = String(block?.content || '');
                        names.add(/\.(png|jpe?g|webp|psd|psb)$/i.test(content) ? id : `${id}-占位`);
                    } else {
                        names.add(id);
                    }
                }
                return names;
            };
            const stageRefreshActions: any[] = [];
            let layoutStartHistoryStateRef: PhotoshopHistoryStateRef | undefined;
            let layoutFinalWriteHistoryStateRef: PhotoshopHistoryStateRef | undefined;
            // 建组归位需要引用替换前的根级屏组清单（作用域提升：替换块内赋值、建组段消费）
            let layersBeforeSnapshot: any[] = [];
            const reusableDraftLayerNames = buildExpectedTopLevelDraftLayerNames();
            if (stageGroupName || reusableDraftLayerNames.size > 0) {
                const hierarchyBefore = await executeToolCall('getLayerHierarchy', {}, options);
                if (hierarchyBefore?.success === false) {
                    result = {
                        success: false,
                        error: `renderLayout 无法读取当前图层结构，不能安全替换阶段草稿：${hierarchyBefore.error || 'getLayerHierarchy failed'}`
                    };
                    toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                    return result;
                }
                layoutStartHistoryStateRef = readPhotoshopHistoryStateRef(hierarchyBefore);
                if (!layoutStartHistoryStateRef) {
                    const startDocumentInfo = await executeToolCall('getDocumentInfo', {}, options);
                    layoutStartHistoryStateRef = readPhotoshopHistoryStateRef(startDocumentInfo);
                }
                const layersBefore = flattenHierarchyLayers(hierarchyBefore?.layers || hierarchyBefore?.hierarchy || []);
                layersBeforeSnapshot = layersBefore;
                // 逐屏保真（2026-07-06 修正）：只替换「当前 stageId」的旧草稿组——换 stageId 是在做新屏，
                // 其他屏的组必须保留（此前全前缀清除会把已完成屏一并删掉，详情页最终只剩最后一屏）。
                // 无 stageId（未带 stagePlan 的通用重排）时保持原全清语义，避免旧草稿叠加。
                const isCurrentStageDraftGroupName = (name: string): boolean => {
                    if (!name) return false;
                    if (stageId) {
                        return name === `阶段草稿-${stageId}`
                            || name === stageGroupName
                            || name.startsWith(`${stageId}·`);
                    }
                    return /^阶段草稿-/.test(name);
                };
                const previousStageGroups = layersBefore
                    .filter((layer: any) => isCurrentStageDraftGroupName(String(layer?.name || '')))
                    .filter((layer: any) => String(layer?.kind || '').toLowerCase().includes('group') || Array.isArray(layer?.children) || Array.isArray(layer?.layers));
                for (const previousGroup of previousStageGroups) {
                    const deleteResult = await executeToolCall('deleteLayer', { layerId: previousGroup.id }, options);
                    stageRefreshActions.push({ action: 'deletePreviousStageGroup', layerId: previousGroup.id, name: previousGroup.name, success: deleteResult?.success !== false });
                    if (deleteResult?.success === false) {
                        result = {
                            success: false,
                            error: `renderLayout 无法替换旧阶段草稿「${previousGroup.name}」：${deleteResult.error || 'deleteLayer failed'}`
                        };
                        toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                        return result;
                    }
                }
                const previousReusableLayers = layersBefore
                    .filter((layer: any) => Number(layer?.depth || 0) === 0 || layer?.parentName == null)
                    .filter((layer: any) => reusableDraftLayerNames.has(String(layer?.name || '')));
                for (const previousLayer of previousReusableLayers) {
                    const deleteResult = await executeToolCall('deleteLayer', { layerId: previousLayer.id }, options);
                    stageRefreshActions.push({ action: 'deleteReusableDraftLayer', layerId: previousLayer.id, name: previousLayer.name, success: deleteResult?.success !== false });
                    if (deleteResult?.success === false) {
                        result = {
                            success: false,
                            error: `renderLayout 无法替换旧草稿层「${previousLayer.name}」：${deleteResult.error || 'deleteLayer failed'}`
                        };
                        toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                        return result;
                    }
                }
            }
            const bgHex = (String(specBlocks.find((b: any) => b.role === 'background')?.content || '').match(/#[0-9a-fA-F]{6}/) || [])[0];
            const style = resolveRenderLayoutStyle(bgHex || '#FFFFFF');
            const created = [];
            const errors = [];
            const createdLayerIds: number[] = [];
            const imagePlacementReceipts: any[] = [];
            const qualityFindings: any[] = [];
            const clippingPairs: Array<{
                blockId: string;
                layerId: number;
                baseLayerId: number;
                receipt: any;
            }> = [];
            // 分屏结构化（用户规范/详情页方法论）：屏组内固定 文案/图标/图片 三子组，
            // 每层按角色归桶，建组阶段自动分发——图层树本身就是交付物的一部分。
            const createdLayerBuckets = new Map<number, '文案' | '图标' | '图片'>();
            // 显式主体图层 id：只收 role==='main-image' 的块（来自布局规格声明，不靠几何猜测），
            // 供画面质量评分判定主体占比/对比等（design-surface-snapshot-normalizer 不臆断主体）。
            const subjectLayerIds: number[] = [];
            // resolved 已按 z 升序：先建底层(背景)，文字最后建在最上层
            for (const b of resolved) {
                let r;
                let placementReceipt: any = null;
                let clippingBaseLayerId: number | undefined;
                let clippingApplied = false;
                let createdEntryExtras: Record<string, any> = {};
                // 仅当 main-image 块真正置入了素材图时，其图层才算"主体"；占位灰矩形不是真实主体，
                // 不能进 subjectLayerIds（否则下游把占位块面积当主体占比，伪造"主体充足"掩盖"无真实主体"）。
                let mainImageHasRealSrc = false;
                if (b.role === 'background') {
                    r = await executeToolCall('createRectangle', { x: b.x, y: b.y, width: b.width, height: b.height, fillColorHex: style.pageBackgroundColorHex, name: '背景' }, options);
                } else if (b.role === 'main-image' || b.role === 'decoration' || b.role === 'tag') {
                    const src = typeof b.content === 'string' && /\.(png|jpe?g|webp|psd|psb)$/i.test(b.content) ? b.content : null;
                    if (src) {
                        const placement: Partial<ImagePlacementSpec> = b.imagePlacement && typeof b.imagePlacement === 'object'
                            ? b.imagePlacement
                            : {};
                        const targetFit = placement.fit === 'cover' ? 'cover' : 'contain';
                        const needsRectangularClip = placement.mask === 'clipping'
                            || placement.overflow === 'clip';

                        // cover 只有在存在可靠裁切基底时才安全：否则图框会溢出目标区域并盖住文字。
                        // 先创建区域矩形，再由 createClippingMask 把图片移动到基底正上方并剪切。
                        if (needsRectangularClip) {
                            const clippingBaseResult = await executeToolCall('createRectangle', {
                                x: b.x,
                                y: b.y,
                                width: b.width,
                                height: b.height,
                                fillColorHex: style.pageBackgroundColorHex,
                                cornerRadius: 0,
                                name: `${b.id}-裁切框`
                            }, options);
                            clippingBaseLayerId = inferFocusLayerId('createRectangle', {}, clippingBaseResult);
                            if (clippingBaseResult?.success === false || !clippingBaseLayerId) {
                                errors.push({
                                    block: b.id,
                                    role: b.role,
                                    error: clippingBaseResult?.error || 'cover 置入无法创建可靠裁切基底。'
                                });
                                continue;
                            }
                        }

                        // 有真实素材：置入后按引擎算出的区域缩放定位（不让模型猜大小位置）。
                        // fit 由 Planner/Skill 声明并贯通到 Photoshop，不再在 Render Bridge 丢失后默认为 contain。
                        r = await executeToolCall('placeImage', {
                            filePath: src,
                            name: b.id,
                            targetBounds: { x: b.x, y: b.y, width: b.width, height: b.height },
                            targetFit
                        }, options);
                        if (b.role === 'main-image') mainImageHasRealSrc = true;

                        const placedLayerId = inferFocusLayerId('placeImage', {}, r);
                        if (r?.success === false && clippingBaseLayerId) {
                            await executeToolCall('deleteLayer', { layerId: clippingBaseLayerId }, options);
                            clippingBaseLayerId = undefined;
                        } else if (needsRectangularClip && !placedLayerId && clippingBaseLayerId) {
                            errors.push({
                                block: b.id,
                                role: b.role,
                                error: 'cover 置入没有返回真实图片 layerId，不能安全创建剪切蒙版。'
                            });
                            await executeToolCall('deleteLayer', { layerId: clippingBaseLayerId }, options);
                            clippingBaseLayerId = undefined;
                            continue;
                        } else if (needsRectangularClip && placedLayerId && clippingBaseLayerId) {
                            const clippingResult = await executeToolCall('createClippingMask', {
                                layerId: placedLayerId,
                                baseLayerId: clippingBaseLayerId
                            }, options);
                            clippingApplied = clippingResult?.success !== false;
                            if (!clippingApplied) {
                                errors.push({
                                    block: b.id,
                                    role: b.role,
                                    error: clippingResult?.error || 'cover 置入创建剪切蒙版失败。'
                                });
                                await executeToolCall('deleteLayer', { layerId: placedLayerId }, options);
                                await executeToolCall('deleteLayer', { layerId: clippingBaseLayerId }, options);
                                clippingBaseLayerId = undefined;
                                continue;
                            }
                        }

                        if (r?.success !== false) {
                            placementReceipt = evaluateImagePlacementQuality({
                                block: b,
                                layerId: placedLayerId,
                                actualBounds: r?.data?.bounds || r?.bounds,
                                clippingApplied,
                                clippingBaseLayerId,
                                canvas
                            });
                            imagePlacementReceipts.push(placementReceipt);
                            qualityFindings.push(...placementReceipt.findings);
                            if (clippingApplied && placedLayerId && clippingBaseLayerId) {
                                clippingPairs.push({
                                    blockId: b.id,
                                    layerId: placedLayerId,
                                    baseLayerId: clippingBaseLayerId,
                                    receipt: placementReceipt
                                });
                            }
                            createdEntryExtras = {
                                layerId: placedLayerId,
                                actualBounds: placementReceipt.actualBounds,
                                imagePlacement: b.imagePlacement,
                                placementQualityState: placementReceipt.qualityState
                            };
                        }
                    } else {
                        r = await executeToolCall('createRectangle', { x: b.x, y: b.y, width: b.width, height: b.height, fillColorHex: style.isDarkBackground ? '#3A3A3A' : '#E5E7EB', cornerRadius: 8, name: `${b.id}-占位` }, options);
                    }
                } else if (b.role === 'selling-point') {
                    const boxResult = await executeToolCall('createRectangle', {
                        x: b.x,
                        y: b.y,
                        width: b.width,
                        height: b.height,
                        fillColorHex: style.sellingPointBoxFillColorHex,
                        cornerRadius: 12,
                        name: `${b.id}-底块`
                    }, options);
                    const paddingX = Math.max(12, Math.round(b.width * 0.05));
                    const fittedText = fitLayoutTextToWidth(
                        String(b.content || ''),
                        Math.max(1, b.width - paddingX * 2),
                        Math.max(18, Math.round(b.height * 0.38)),
                        16
                    );
                    const textResult = await executeToolCall('createTextLayer', {
                        content: fittedText.content,
                        x: b.x + paddingX,
                        y: b.y + Math.max(8, Math.round(b.height * 0.22)),
                        fontSize: fittedText.fontSize,
                        leading: Math.round(fittedText.fontSize * 1.18),
                        colorHex: style.sellingPointTextColorHex,
                        name: `${b.id}-文字`
                    }, options);
                    if (boxResult && boxResult.success === false) errors.push({ block: b.id, role: b.role, error: boxResult.error });
                    if (textResult && textResult.success === false) errors.push({ block: b.id, role: b.role, error: textResult.error });
                    if (!(boxResult && boxResult.success === false) && !(textResult && textResult.success === false)) {
                        const boxLayerId = inferFocusLayerId('createRectangle', {}, boxResult);
                        const textLayerId = inferFocusLayerId('createTextLayer', {}, textResult);
                        if (boxLayerId) { createdLayerIds.push(boxLayerId); createdLayerBuckets.set(boxLayerId, '图片'); }
                        if (textLayerId) { createdLayerIds.push(textLayerId); createdLayerBuckets.set(textLayerId, '文案'); }
                        created.push({ id: b.id, role: b.role, x: b.x, y: b.y, width: b.width, height: b.height });
                    }
                    continue;
                } else {
                    const fittedText = fitLayoutTextToWidth(
                        String(b.content || ''),
                        Math.max(1, b.width),
                        Math.max(18, Math.round(b.height * 0.45)),
                        16
                    );
                    r = await executeToolCall('createTextLayer', {
                        content: fittedText.content,
                        x: b.x,
                        y: b.y,
                        fontSize: fittedText.fontSize,
                        leading: Math.round(fittedText.fontSize * 1.18),
                        colorHex: style.pageTextColorHex,
                        name: b.id
                    }, options);
                }
                if (r && r.success === false) errors.push({ block: b.id, role: b.role, error: r.error });
                else {
                    const layerId = inferFocusLayerId(
                        b.role === 'main-image' || b.role === 'decoration' || b.role === 'tag' ? 'placeImage'
                            : b.role === 'background' ? 'createRectangle'
                                : 'createTextLayer',
                        {},
                        r
                    );
                    if (layerId) {
                        createdLayerIds.push(layerId);
                        createdLayerBuckets.set(
                            layerId,
                            b.role === 'background' || b.role === 'main-image' ? '图片'
                                : (b.role === 'decoration' || b.role === 'tag') ? '图标'
                                    : '文案'
                        );
                    }
                    if (clippingBaseLayerId) {
                        createdLayerIds.push(clippingBaseLayerId);
                        createdLayerBuckets.set(clippingBaseLayerId, '图片');
                    }
                    if (layerId && b.role === 'main-image' && mainImageHasRealSrc) subjectLayerIds.push(layerId);
                    created.push({
                        id: b.id,
                        role: b.role,
                        x: b.x,
                        y: b.y,
                        width: b.width,
                        height: b.height,
                        ...createdEntryExtras
                    });
                }
            }
            let stageGroupResult: any = null;
            if (stageGroupName && errors.length === 0 && createdLayerIds.length > 0) {
                stageGroupResult = await executeToolCall('createGroup', { groupName: stageGroupName }, options);
                const groupId = inferFocusLayerId('createGroup', {}, stageGroupResult);
                stageRefreshActions.push({ action: 'createStageGroup', groupName: stageGroupName, groupId, success: stageGroupResult?.success !== false });
                if (!groupId || stageGroupResult?.success === false) {
                    errors.push({ block: stageGroupName, role: 'stage-group', error: stageGroupResult?.error || 'createGroup failed' });
                } else {
                    const visibilityResult = await executeToolCall('setLayerVisibility', {
                        layerId: groupId,
                        visible: true
                    }, options);
                    stageRefreshActions.push({
                        action: 'ensureStageGroupVisible',
                        layerId: groupId,
                        success: visibilityResult?.success !== false
                    });
                    if (visibilityResult?.success === false) {
                        warnings.push(`屏组「${stageGroupName}」无法确认可见：${visibilityResult?.error || 'setLayerVisibility failed'}`);
                        qualityFindings.push({
                            code: 'stage_group_visibility_unverified',
                            severity: 'repair',
                            closureKind: 'mutation',
                            blockId: stageGroupName,
                            role: 'stage-group',
                            layerId: groupId,
                            message: `屏组「${stageGroupName}」没有可靠的 visible=true 执行收据，当前阶段可能整体不可见。`,
                            recommendedAction: {
                                toolName: 'setLayerVisibility',
                                params: { layerId: groupId, visible: true },
                                reason: '显式恢复当前阶段屏组可见后，重新读取当前屏区域。'
                            }
                        });
                    }
                    // 屏组归位（2026-07-07 真机病例）：createGroup 出生位置取决于当前选中图层，
                    // 新屏组可能误生在上一屏组内部（B 屏组嵌进 A 屏图标子组）。先归位文档根级，
                    // 再排到已有屏组序列末尾——结构后置条件由引擎保证，不靠模型返工。
                    const rootMove = await executeToolCall('moveLayerToGroup', { layerId: groupId, targetGroupId: 0 }, options);
                    stageRefreshActions.push({ action: 'moveStageGroupToRoot', layerId: groupId, success: rootMove?.success !== false });
                    if (rootMove?.success === false) {
                        warnings.push(`屏组归位文档根级失败（可能仍嵌在其他组内）：${rootMove?.error || 'moveLayerToGroup root failed'}`);
                    } else {
                        const previousScreenGroups = layersBeforeSnapshot
                            .filter((layer: any) => Number(layer?.depth || 0) === 0)
                            .filter((layer: any) => String(layer?.kind || '').toLowerCase().includes('group') || Array.isArray(layer?.children) || Array.isArray(layer?.layers))
                            .filter((layer: any) => /·|^阶段草稿-/.test(String(layer?.name || '')) && Number(layer?.id) !== groupId);
                        const lastScreenGroup = previousScreenGroups[previousScreenGroups.length - 1];
                        if (lastScreenGroup?.id) {
                            const orderMove = await executeToolCall('reorderLayer', { layerId: groupId, action: 'below', targetLayerId: lastScreenGroup.id }, options);
                            stageRefreshActions.push({ action: 'orderStageGroupAfterPrevious', layerId: groupId, targetLayerId: lastScreenGroup.id, success: orderMove?.success !== false });
                            if (orderMove?.success === false) {
                                warnings.push(`屏组排序到「${lastScreenGroup.name}」之后失败（结构正确，仅面板顺序未排）：${orderMove?.error || 'reorderLayer failed'}`);
                            }
                        }
                    }
                    // 分屏结构化：屏组内固定 文案/图标/图片 三子组（用户分屏规范/详情页方法论）。
                    // 空桶不建组（真机教训：空组会成为剪切蒙版的无效基底）；子组建失败时该桶
                    // 图层退回直接进屏组（分组是增益不是门闸），并记入 warnings。
                    const subgroupIds: Partial<Record<'文案' | '图标' | '图片', number>> = {};
                    for (const bucket of ['图片', '图标', '文案'] as const) {
                        if (![...createdLayerBuckets.values()].includes(bucket)) continue;
                        const subgroupResult = await executeToolCall('createGroup', { groupName: bucket }, options);
                        const subgroupId = inferFocusLayerId('createGroup', {}, subgroupResult);
                        stageRefreshActions.push({ action: 'createStageSubgroup', groupName: bucket, groupId: subgroupId, success: subgroupResult?.success !== false });
                        if (subgroupId && subgroupResult?.success !== false) {
                            const subgroupMove = await executeToolCall('moveLayerToGroup', { layerId: subgroupId, targetGroupId: groupId, position: 'inside' }, options);
                            if (subgroupMove?.success !== false) {
                                subgroupIds[bucket] = subgroupId;
                            } else {
                                warnings.push(`子组「${bucket}」移入屏组失败，该类图层将直接放在屏组内：${subgroupMove?.error || 'moveLayerToGroup failed'}`);
                            }
                        } else {
                            warnings.push(`子组「${bucket}」创建失败，该类图层将直接放在屏组内：${subgroupResult?.error || 'createGroup failed'}`);
                        }
                    }
                    for (const layerId of createdLayerIds) {
                        const bucket = createdLayerBuckets.get(layerId);
                        const targetGroupId = (bucket && subgroupIds[bucket]) || groupId;
                        const moveResult = await executeToolCall('moveLayerToGroup', { layerId, targetGroupId, position: 'inside' }, options);
                        stageRefreshActions.push({ action: 'moveLayerToStageGroup', layerId, groupId: targetGroupId, success: moveResult?.success !== false });
                        if (moveResult?.success === false) {
                            errors.push({ block: stageGroupName, role: 'stage-group', error: moveResult.error || `moveLayerToGroup failed for ${layerId}` });
                        }
                    }
                }
            }
            // 剪切关系必须按“最终分组后的结构”验真。图片与基底分别 moveLayerToGroup 后，
            // Photoshop 可能改变相邻关系或释放剪切；分组前的 createClippingMask 成功不能作为最终收据。
            for (const pair of clippingPairs) {
                const readClippingInfo = async (): Promise<any> => {
                    const rawInfo = await executeToolCall('getClippingMaskInfo', { layerId: pair.layerId }, options);
                    if (typeof rawInfo !== 'string') return rawInfo;
                    try {
                        return JSON.parse(rawInfo);
                    } catch {
                        return { success: false, error: 'getClippingMaskInfo 返回了无法解析的结果。' };
                    }
                };
                let clippingInfoResult = await readClippingInfo();
                let clippingInfo = clippingInfoResult?.clippingMaskInfo
                    || clippingInfoResult?.data?.clippingMaskInfo;
                let relationVerified = clippingInfoResult?.success !== false
                    && clippingInfo?.isClipped === true
                    && Number(clippingInfo?.clippingBaseId) === pair.baseLayerId;

                // 仅在最终读回证明关系已丢失时做一次确定性恢复；不循环盲试。
                if (!relationVerified) {
                    if (clippingInfo?.isClipped === true) {
                        await executeToolCall('releaseClippingMask', { layerId: pair.layerId }, options);
                    }
                    const repairClipping = await executeToolCall('createClippingMask', {
                        layerId: pair.layerId,
                        baseLayerId: pair.baseLayerId
                    }, options);
                    if (repairClipping?.success !== false) {
                        clippingInfoResult = await readClippingInfo();
                        clippingInfo = clippingInfoResult?.clippingMaskInfo
                            || clippingInfoResult?.data?.clippingMaskInfo;
                        relationVerified = clippingInfoResult?.success !== false
                            && clippingInfo?.isClipped === true
                            && Number(clippingInfo?.clippingBaseId) === pair.baseLayerId;
                    }
                }

                pair.receipt.clippingApplied = relationVerified;
                pair.receipt.clippingVerification = {
                    layerId: pair.layerId,
                    baseLayerId: pair.baseLayerId,
                    relationVerified
                };
                if (!relationVerified) {
                    const finding = {
                        code: 'clipping_relationship_unverified',
                        severity: 'repair',
                        closureKind: 'replan',
                        blockId: pair.blockId,
                        role: 'image',
                        layerId: pair.layerId,
                        message: `图片块「${pair.blockId}」在最终分组后无法证明仍剪切到基底 ${pair.baseLayerId}；`
                            + '一次确定性恢复也未通过读回，本轮不能声明裁切结构完成。',
                        recommendedStrategies: [
                            '重新 renderLayout 建立图片与裁切基底',
                            '检查目标图片层与基底层是否位于同一父组且图片紧邻基底上方'
                        ]
                    };
                    pair.receipt.qualityState = 'needs_repair';
                    pair.receipt.findings.push(finding);
                    qualityFindings.push(finding);
                    warnings.push(finding.message);
                }
            }
            // 写后即时自检（2026-07-06）：结构性遮挡是纯几何+层序问题，不需要视觉模型——
            // 排版一结束就确定性判出「内容层被背景/色块完全盖住」（如先 placeImage 的主图
            // 被本次屏组背景压住），连同修复出口回给模型，不等事后截图才发现。检测失败不阻塞。
            let occlusionFindings: Array<{
                occludedLayerId?: number;
                occludedLayerName?: string;
                occluderLayerId?: number;
                occluderLayerName?: string;
                message: string;
            }> = [];
            if (errors.length === 0 && created.length > 0) {
                const { detectFullLayerOcclusions } = await import('../../shared/layer-occlusion');
                const hierarchyAfter = await executeToolCall('getLayerHierarchy', { includeBounds: true }, options);
                if (hierarchyAfter?.success !== false) {
                    layoutFinalWriteHistoryStateRef = readPhotoshopHistoryStateRef(hierarchyAfter);
                    const hierarchyAfterTree = hierarchyAfter?.hierarchy || hierarchyAfter?.flatList || [];
                    occlusionFindings = detectFullLayerOcclusions(hierarchyAfterTree);
                    for (const finding of occlusionFindings) {
                        warnings.push(finding.message);
                        const touchesCurrentLayout = createdLayerIds.includes(Number(finding.occludedLayerId))
                            || createdLayerIds.includes(Number(finding.occluderLayerId));
                        if (!touchesCurrentLayout) continue;
                        qualityFindings.push({
                            code: 'full_layer_occlusion',
                            severity: 'repair',
                            closureKind: 'mutation',
                            blockId: String(finding.occludedLayerName || finding.occludedLayerId || 'unknown-layer'),
                            role: 'layer',
                            layerId: finding.occludedLayerId,
                            message: finding.message,
                            recommendedAction: finding.occludedLayerId && finding.occluderLayerId
                                ? {
                                    toolName: 'reorderLayer',
                                    params: {
                                        layerId: finding.occludedLayerId,
                                        action: 'above',
                                        targetLayerId: finding.occluderLayerId
                                    },
                                    reason: '把被遮挡的内容层放到遮挡背景之上，再读取同一屏区域复核。'
                                }
                                : undefined
                        });
                    }
                    // 游离层检测（2026-07-07 真机病例：模型单独 placeImage 的主图落在屏组/子组外）：
                    // 本屏区间内的图像层若不在本次屏组子树里，如实提醒收纳——结构完整性即交付物。
                    if (stageGroupName && screenRegion) {
                        const flattenAll = (nodes: any[], out: any[] = [], inStageGroup = false): any[] => {
                            for (const node of Array.isArray(nodes) ? nodes : []) {
                                if (!node) continue;
                                const isStage = inStageGroup || String(node?.name || '') === stageGroupName;
                                out.push({ node, inStageGroup: isStage });
                                flattenAll(node.children || node.layers || [], out, isStage);
                            }
                            return out;
                        };
                        const strayImages = flattenAll(hierarchyAfterTree)
                            .filter(({ node, inStageGroup }) => !inStageGroup
                                && ['smartobject', 'pixel'].includes(String(node?.kind || '').toLowerCase())
                                && !(node?.children || node?.layers)
                                && node?.bounds
                                && Number(node.bounds.top) < screenRegion.y + screenRegion.height
                                && Number(node.bounds.bottom) > screenRegion.y
                                && !/背景|底图|bg/i.test(String(node?.name || '')))
                            .slice(0, 3);
                        for (const { node } of strayImages) {
                            warnings.push(`图层「${node.name}」(ID: ${node.id}) 位于本屏区域内但不在屏组「${stageGroupName}」结构里——若它属于本屏，用 moveLayerToGroup 收纳进该屏的「图片」子组，保持图层树结构完整。`);
                            qualityFindings.push({
                                code: 'image_outside_stage_group',
                                severity: 'review',
                                closureKind: 'visual',
                                blockId: String(node.name || node.id || 'unknown-layer'),
                                role: 'image',
                                layerId: Number(node.id) || undefined,
                                message: `图层「${node.name}」不在当前屏组「${stageGroupName}」内，阶段结构和层序无法可靠交付；`
                                    + '先确认当前屏「图片」子组 ID，再用 moveLayerToGroup 收纳并复核。'
                            });
                        }
                    }
                } else {
                    qualityFindings.push({
                        code: 'post_layout_structure_readback_missing',
                        severity: 'review',
                        closureKind: 'observation',
                        blockId: stageGroupName || 'renderLayout',
                        role: 'layout',
                        message: `renderLayout 写入后无法读取图层结构：${hierarchyAfter?.error || 'getLayerHierarchy failed'}。`,
                        recommendedAction: {
                            toolName: 'getLayerHierarchy',
                            params: { includeBounds: true },
                            reason: '重新读取当前 Photoshop 文档结构，确认本轮创建层的父组与层序。'
                        }
                    });
                }
            }
            if (created.length > 0 && !layoutFinalWriteHistoryStateRef) {
                // 超大文档的完整层级读取可能失败；视觉身份不能因此永久卡死。
                // 仅在缺最终 Host 版本时补一次轻量文档读取。结构复核 finding 保留，
                // 但局部截图仍可与这个最终版本做同文档、同 historyState 的精确绑定。
                const finalDocumentInfo = await executeToolCall('getDocumentInfo', {}, options);
                if (finalDocumentInfo?.success !== false) {
                    layoutFinalWriteHistoryStateRef = readPhotoshopHistoryStateRef(finalDocumentInfo);
                }
            }
            const nonBackgroundBlocks = resolved.filter((block) =>
                block.role !== 'background'
                && Number(block.width) > 0
                && Number(block.height) > 0);
            const contentUnion = nonBackgroundBlocks.length > 0
                ? nonBackgroundBlocks.reduce((union, block) => ({
                    left: Math.min(union.left, Number(block.x)),
                    top: Math.min(union.top, Number(block.y)),
                    right: Math.max(union.right, Number(block.x) + Number(block.width)),
                    bottom: Math.max(union.bottom, Number(block.y) + Number(block.height))
                }), {
                    left: Number.POSITIVE_INFINITY,
                    top: Number.POSITIVE_INFINITY,
                    right: Number.NEGATIVE_INFINITY,
                    bottom: Number.NEGATIVE_INFINITY
                })
                : null;
            const observationPadding = Math.max(16, Math.round(Math.min(Number(canvas.width), Number(canvas.height)) * 0.02));
            const contentObservationRegion = contentUnion
                ? {
                    x: Math.max(0, Math.floor(contentUnion.left - observationPadding)),
                    y: Math.max(0, Math.floor(contentUnion.top - observationPadding)),
                    width: Math.min(
                        Number(canvas.width),
                        Math.ceil(contentUnion.right + observationPadding)
                    ) - Math.max(0, Math.floor(contentUnion.left - observationPadding)),
                    height: Math.min(
                        Number(canvas.height),
                        Math.ceil(contentUnion.bottom + observationPadding)
                    ) - Math.max(0, Math.floor(contentUnion.top - observationPadding))
                }
                : null;
            const suggestedObservationRegion = screenRegion
                ? { x: 0, y: screenRegion.y, width: canvas.width, height: screenRegion.height }
                : (isLongCanvas && contentObservationRegion
                    ? contentObservationRegion
                    : { x: 0, y: 0, width: canvas.width, height: canvas.height });
            const suggestedObservation = {
                toolName: 'getCanvasSnapshot',
                params: { region: suggestedObservationRegion, maxSize: 1600 },
                reason: screenRegion || isLongCanvas
                    ? '长文档必须复核本次阶段/内容并集的局部高分辨率画面；全页缩略图只可用于导航，不能判定设计质量。'
                    : '读取本次布局后的完整画面，确认主体、文字层级和可读性。'
            };
            let postWriteObservation: {
                toolName: string;
                params: Record<string, any>;
                captured: boolean;
                historyStateRef?: PhotoshopHistoryStateRef;
                writeHistoryStateRef?: PhotoshopHistoryStateRef;
                documentInfo?: Record<string, any>;
                verifiedSameDocumentVersion: boolean;
                error?: string;
            } | undefined;
            let postWriteSnapshot: any;
            if (created.length > 0) {
                // renderLayout 是复合写操作。布局完成后由 Harness 主动读取一次本次区域，
                // 直接复用 Agent 的图像观察通道，避免再花一轮让模型决定“要不要截图”。
                // 这只负责取得真实像素；审美判断仍由视觉模型完成，抓图成功不等于质量通过。
                const observationResult = await sendToPluginWithCancellation(
                    suggestedObservation.toolName,
                    suggestedObservation.params,
                    getToolTimeout(suggestedObservation.toolName, suggestedObservation.params),
                    options,
                    suggestedObservation.toolName
                );
                const snapshotPayload = observationResult?.snapshot
                    || observationResult?.data?.snapshot;
                const observationBase64 = typeof snapshotPayload === 'string'
                    ? snapshotPayload
                    : (
                        snapshotPayload?.base64
                        || snapshotPayload?.imageData
                        || observationResult?.base64
                        || observationResult?.imageData
                        || observationResult?.data?.base64
                        || observationResult?.data?.imageData
                    );
                const observationCaptured = observationResult?.success !== false
                    && typeof observationBase64 === 'string'
                    && observationBase64.length > 0;
                const observationHistoryStateRef = readPhotoshopHistoryStateRef(observationResult);
                const observationDocumentInfo = observationResult?.documentInfo
                    || observationResult?.data?.documentInfo;
                const writeHistoryStateRef = layoutFinalWriteHistoryStateRef
                    || layoutStartHistoryStateRef;
                // hierarchyAfter 是最后一次布局写入之后、自动截图之前的 Host 观察。
                // 只有文档 ID 与 historyStateId 都相等，才能证明截图对应本次最终画布；
                // 缺身份或期间用户切换/编辑文档一律不授予“写后复核”信用。
                const verifiedSameDocumentVersion = observationCaptured
                    && Boolean(layoutFinalWriteHistoryStateRef)
                    && samePhotoshopHistoryStateRef(
                        layoutFinalWriteHistoryStateRef,
                        observationHistoryStateRef
                    );
                let observationIdentityError: string | undefined;
                if (observationCaptured && !verifiedSameDocumentVersion) {
                    if (!layoutFinalWriteHistoryStateRef) {
                        observationIdentityError = '缺少最终写入后的 Host 文档版本，无法把快照绑定到本次布局';
                    } else if (!observationHistoryStateRef) {
                        observationIdentityError = '快照缺少 Host 文档版本，无法证明来自本次布局';
                    } else {
                        observationIdentityError = '布局写入后 Photoshop 文档或历史版本发生变化，快照不再对应本次最终写入';
                    }
                }
                postWriteObservation = {
                    toolName: suggestedObservation.toolName,
                    params: suggestedObservation.params,
                    captured: observationCaptured,
                    historyStateRef: observationHistoryStateRef,
                    writeHistoryStateRef,
                    documentInfo: observationDocumentInfo,
                    verifiedSameDocumentVersion,
                    error: observationCaptured
                        ? observationIdentityError
                        : String(observationResult?.error || 'getCanvasSnapshot 未返回可读取的画面')
                };
                if (observationCaptured) {
                    postWriteSnapshot = snapshotPayload
                        || {
                            base64: observationBase64,
                            format: observationResult?.format || observationResult?.data?.format
                        };
                }
                if (!observationCaptured) {
                    qualityFindings.push({
                        code: 'post_layout_visual_observation_missing',
                        severity: 'review',
                        closureKind: 'observation',
                        blockId: stageGroupName || 'renderLayout',
                        role: 'layout',
                        message: `renderLayout 已写入画面，但 Harness 无法取得本次区域的真实像素：${postWriteObservation.error}。`,
                        recommendedAction: {
                            toolName: suggestedObservation.toolName,
                            params: suggestedObservation.params,
                            reason: suggestedObservation.reason
                        }
                    });
                } else if (!verifiedSameDocumentVersion) {
                    qualityFindings.push({
                        code: 'post_layout_visual_identity_mismatch',
                        severity: 'repair',
                        closureKind: 'replan',
                        blockId: stageGroupName || 'renderLayout',
                        role: 'layout',
                        message: `renderLayout 已取得像素，但不能证明它属于本次最终写入：${observationIdentityError}。`,
                        recommendedStrategies: [
                            '重新读取当前 Photoshop 文档与图层结构，确认活动文档',
                            '基于当前文档版本重新执行本阶段布局，再由 Harness 自动复核'
                        ]
                    });
                }
            }
            const hasRepairFinding = qualityFindings.some((finding: any) => finding?.severity === 'repair');
            const qualityState = errors.length > 0
                ? 'failed'
                : hasRepairFinding
                    ? 'needs_repair'
                    : qualityFindings.length > 0
                        ? 'needs_review'
                        : 'passed';
            const layoutHistoryTransition = buildPhotoshopHistoryTransition(
                { historyStateRef: layoutStartHistoryStateRef },
                { historyStateRef: layoutFinalWriteHistoryStateRef }
            );
            result = {
                success: errors.length === 0,
                status: qualityState === 'passed' ? 'completed' : qualityState,
                qualityState,
                continuationRequired: qualityState === 'needs_repair' || qualityState === 'needs_review',
                requiresVisualReview: created.length > 0,
                suggestedObservation,
                postWriteObservation,
                historyStateRef: postWriteObservation?.historyStateRef,
                documentInfo: postWriteObservation?.documentInfo,
                photoshopHistoryTransition: layoutHistoryTransition.mutationObserved === true
                    ? layoutHistoryTransition
                    : undefined,
                // 保持 getCanvasSnapshot 的真实 payload 形状，让 Agent 现有视觉通道可直接提取图像。
                snapshot: postWriteSnapshot,
                created,
                createdLayerIds,
                subjectLayerIds: subjectLayerIds.length > 0 ? subjectLayerIds : undefined,
                imagePlacementReceipts: imagePlacementReceipts.length > 0 ? imagePlacementReceipts : undefined,
                qualityFindings: qualityFindings.length > 0 ? qualityFindings : undefined,
                errors,
                warnings,
                // 本次生效的栅格与刻度：让模型看见自己实际吃到的版心、列数与可选间距档位，
                // 下一次调用才能选档位而不是凭空估像素。
                grid: solveOutcome.grid,
                occlusionFindings: occlusionFindings.length > 0 ? occlusionFindings : undefined,
                stageGroupName: stageGroupName || undefined,
                stageRefreshActions: stageRefreshActions.length > 0 ? stageRefreshActions : undefined,
                stagePlan: params.stagePlan || undefined,
                stagePlanValidation: stagePlanValidation || undefined,
                message: `${qualityState === 'passed' ? '已完成当前版式写入' : qualityState === 'failed' ? '当前版式写入存在执行失败' : '已写入当前版式，但必须继续复核/修订'}：`
                    + `按${regionMode ? '二维区域' : '垂直堆叠'}规格建 ${created.length} 个图层`
                    + '（坐标与图层顺序由布局引擎确定，未手填）'
                    + `${errors.length ? `，${errors.length} 个失败` : ''}`
                    + `${qualityFindings.length ? `，${qualityFindings.length} 个质量发现` : ''}`
                    + `${warnings.length ? `；${warnings.join('；')}` : ''}`
            };
            if (created.length > 0) executedToolsInSession.push('renderLayout');
            // ToolLogger 只保留结构化收据；真实像素仍随返回值进入 Agent 视觉通道，
            // 避免同一张 base64 同时在内部截图日志和 renderLayout 日志中重复常驻内存。
            const resultForToolLog = postWriteSnapshot
                ? {
                    ...result,
                    snapshot: {
                        omittedFromToolLog: true,
                        reason: 'post-write pixels are carried only in the live tool result'
                    }
                }
                : result;
            toolLogger.logToolCall(toolName, params, resultForToolLog, Date.now() - startTime, currentRound);
            return result;
        }

        // 主体感知缩放：模型只声明「哪层主体填哪个区域到什么程度」，缩放/位移由引擎求解，
        // 执行复用 alignToReference（缩放+主体中心对齐一步完成）。把"合适的视觉大小"
        // 从图框适配升级为主体适配（留白多的图不再看起来太小）。
        if (toolName === 'fitLayerSubjectToRegion') {
            const {
                computeSubjectFitToRegion,
                verifySubjectFitResult
            } = await import('../../shared/subject-fit');
            const { getSmartScalingPreset } = await import('../../shared/design-smart-scaling-policy');
            const fitLayerId = Number(params.layerId);
            if (!Number.isFinite(fitLayerId) || fitLayerId <= 0) {
                result = { success: false, error: 'fitLayerSubjectToRegion 需要 layerId：先用 getLayerHierarchy 或 placeImage 结果确定目标图层 id。' };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
            const requestedMethod = params.method === 'alpha' ? 'alpha' : 'smart';
            let methodUsed: string = requestedMethod;
            let subjectResult = await executeToolCall('getSubjectBounds', { layerId: fitLayerId, method: requestedMethod }, options);
            // 降级判据不再匹配错误措辞（2026-08-06）。原条件要求 error 里出现「不支持」或「smart」，
            // 而真机失败是「处理超时：Photoshop 可能有弹窗未关闭」——两个词都不含，降级被挡在门外，
            // 整个工具直接失败。smart 走 Photoshop 的选择主体（依赖 PS 状态与 AI 能力，会超时、会弹窗），
            // alpha 是纯像素边界计算（不依赖 PS 智能功能，稳定得多）：
            // 只要 smart 没拿到结果，无论什么原因都该退到 alpha，而不是让整条链停在这。
            if (requestedMethod === 'smart'
                && (subjectResult?.success === false || !subjectResult?.data?.bounds)) {
                methodUsed = 'alpha';
                subjectResult = await executeToolCall('getSubjectBounds', { layerId: fitLayerId, method: 'alpha' }, options);
            }
            if (subjectResult?.success === false || !subjectResult?.data?.bounds) {
                result = {
                    success: false,
                    error: `fitLayerSubjectToRegion 读取主体失败（method=${methodUsed}）：${subjectResult?.error || '未返回主体边界'}。可先把图层转换为智能对象，或用 getCanvasSnapshot 人工确认主体后改用 transformLayer。`
                };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
            const layerBoundsResult = await executeToolCall('getLayerBounds', { layerId: fitLayerId }, options);
            const frameBounds = layerBoundsResult?.boundsNoEffects || layerBoundsResult?.bounds;
            if (layerBoundsResult?.success === false || !frameBounds) {
                result = { success: false, error: `fitLayerSubjectToRegion 读取图层边界失败：${layerBoundsResult?.error || '未返回 bounds'}。` };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
            const docInfo = await executeToolCall('getDocumentInfo', {}, options);
            const designTypeValues = [
                'main-image', 'detail-page', 'sku', 'reference-replication', 'poster', 'banner', 'generic'
            ];
            const assetRoleValues = [
                'product', 'model', 'detail', 'scene', 'icon', 'background', 'group', 'unknown'
            ];
            const intentValues = [
                'hero', 'supporting', 'thumbnail', 'full-bleed', 'fit-slot', 'compare-grid'
            ];
            const anchorValues = [
                'center', 'top-center', 'bottom-center', 'left-center', 'right-center'
            ];
            const designType = designTypeValues.includes(String(params.designType))
                ? String(params.designType)
                : 'generic';
            const assetRole = assetRoleValues.includes(String(params.assetRole))
                ? String(params.assetRole)
                : 'unknown';
            const intent = intentValues.includes(String(params.intent))
                ? String(params.intent)
                : undefined;
            const preset = getSmartScalingPreset({
                designType: designType as any,
                assetRole: assetRole as any,
                ...(intent ? { intent: intent as any } : {})
            });
            const explicitFillRatio = Number(params.subjectFillRatio);
            const hasExplicitFillRatio = Number.isFinite(explicitFillRatio)
                && explicitFillRatio > 0
                && explicitFillRatio <= 1;
            const refFill = Number(params.referenceComposition?.subjectFillRatioForFullCanvas);
            const hasRefFill = Number.isFinite(refFill)
                && refFill > 0
                && refFill <= 1;
            const resolvedFillRatio = hasExplicitFillRatio
                ? explicitFillRatio
                : hasRefFill
                    ? refFill
                    : preset.targetFill;
            const resolvedAnchor = anchorValues.includes(String(params.anchor))
                ? String(params.anchor)
                : preset.anchor;
            const fitPlan = computeSubjectFitToRegion({
                subjectBounds: subjectResult.data.bounds,
                layerBounds: frameBounds,
                targetRegion: params.targetRegion,
                subjectFillRatio: resolvedFillRatio,
                maxUpscaleRatio: params.maxUpscaleRatio,
                anchor: resolvedAnchor as any,
                visualBiasY: preset.visualBiasY,
                canvas: (docInfo?.width && docInfo?.height)
                    ? { width: Number(docInfo.width), height: Number(docInfo.height) }
                    : undefined
            });
            if (!fitPlan.ok) {
                result = { success: false, error: `fitLayerSubjectToRegion 无法求解：${fitPlan.reason}` };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
            const alignResult = await executeToolCall('alignToReference', { layerId: fitLayerId, ...fitPlan.alignParams }, options);
            if (alignResult?.success === false) {
                result = { success: false, error: `fitLayerSubjectToRegion 执行缩放对齐失败：${alignResult.error || 'alignToReference failed'}`, plan: fitPlan };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
            // 复合工具必须保留底层原子写入的 Host 证明，否则 Photoshop 已经改图，
            // Runtime 却会把本次操作判成没有真实进展。解析器会重算派生布尔值；
            // 不照抄 alignResult 上的 mutationObserved/documentId/historyStateRef 等裸字段。
            const alignMutationCommit = readPhotoshopMutationCommit(alignResult);
            const alignHistoryTransition = readPhotoshopHistoryTransition(alignResult);
            const alignMutationProof = findObservedPhotoshopMutationProof(alignResult);
            const alignAcceptance = alignResult?.acceptance
                && typeof alignResult.acceptance === 'object'
                && !Array.isArray(alignResult.acceptance)
                ? alignResult.acceptance
                : undefined;
            const postSubjectResult = await executeToolCall(
                'getSubjectBounds',
                { layerId: fitLayerId, method: methodUsed },
                options
            );
            const postLayerBoundsResult = await executeToolCall(
                'getLayerBounds',
                { layerId: fitLayerId },
                options
            );
            const actualSubjectBounds = postSubjectResult?.data?.bounds;
            const actualFrameBounds = postLayerBoundsResult?.boundsNoEffects
                || postLayerBoundsResult?.bounds;
            const geometryVerification = actualSubjectBounds
                ? verifySubjectFitResult({
                    actualSubjectBounds,
                    targetRegion: params.targetRegion,
                    requestedFillRatio: fitPlan.resolved.subjectFillRatio,
                    anchor: fitPlan.resolved.anchor,
                    visualBiasY: fitPlan.resolved.visualBiasY,
                    projectedSubject: fitPlan.projectedSubject
                })
                : {
                    status: 'needs_review' as const,
                    warnings: [
                        `缩放已经写入，但同 layerId 主体读回失败：${postSubjectResult?.error || '未返回主体边界'}。`
                    ],
                    limitation: '无法完成几何验收；禁止把写入成功声明为视觉质量通过。'
                };
            const combinedWarnings = [
                ...fitPlan.warnings,
                ...(Array.isArray(geometryVerification.warnings)
                    ? geometryVerification.warnings
                    : [])
            ];
            result = {
                success: true,
                methodUsed,
                appliedScalePercent: fitPlan.alignParams.scalePercent,
                fitSource: hasExplicitFillRatio ? 'explicit' : 'design-preset',
                designSemantics: {
                    designType,
                    assetRole,
                    ...(intent ? { intent } : {}),
                    subjectFillRatio: fitPlan.resolved.subjectFillRatio,
                    anchor: fitPlan.resolved.anchor,
                    visualBiasY: fitPlan.resolved.visualBiasY
                },
                subjectBefore: subjectResult.data.bounds,
                projectedSubject: fitPlan.projectedSubject,
                projectedFrame: fitPlan.projectedFrame,
                subjectAfter: actualSubjectBounds,
                frameAfter: actualFrameBounds,
                geometryVerification,
                newBounds: alignResult?.newBounds,
                warnings: combinedWarnings,
                ...(alignMutationCommit
                    ? { photoshopMutationCommit: alignMutationCommit }
                    : {}),
                ...(alignHistoryTransition
                    ? { photoshopHistoryTransition: alignHistoryTransition }
                    : {}),
                ...(alignAcceptance
                    ? { acceptance: alignAcceptance }
                    : {}),
                ...(alignMutationProof
                    ? {
                        documentId: alignMutationProof.after.documentId,
                        historyStateRef: {
                            documentId: alignMutationProof.after.documentId,
                            historyStateId: alignMutationProof.after.historyStateId
                        }
                    }
                    : {}),
                message: `已按主体感知缩放对齐并完成同 layerId 几何读回：缩放 ${fitPlan.alignParams.scalePercent}%，目标占比 ${fitPlan.resolved.subjectFillRatio}，锚点 ${fitPlan.resolved.anchor}（主体检测 ${methodUsed}；几何状态 ${geometryVerification.status}）${combinedWarnings.length ? `；${combinedWarnings.join('；')}` : ''}。几何通过不等于审美通过；只需再观察一次真实画面，必要时做一次有依据的修订。`
            };
            executedToolsInSession.push(toolName);
            toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
            return result;
        }

        // 设计源解析（PSD 知识库 P0）：离线读设计师 PSD/PSB 的结构/字号/色板/边距做设计参照
        if (toolName === 'analyzePsdDesignSource') {
            const sourceFilePath = String(params.filePath || '').trim();
            if (!sourceFilePath) {
                result = { success: false, error: 'analyzePsdDesignSource 需要 filePath：设计源文件（.psd/.psb）的完整路径。项目内文件可先用 searchProjectResources 查找。' };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
            const analyzeBridge = (window as any).designEcho?.analyzePsdDesignSource;
            if (typeof analyzeBridge !== 'function') {
                result = { success: false, error: '设计源解析桥不可用：当前应用版本较旧（preload 缺少 analyzePsdDesignSource），请重启应用加载最新构建。' };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
            result = await analyzeBridge(sourceFilePath);
            if (result?.success) executedToolsInSession.push(toolName);
            toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
            return result;
        }

        // Eagle 素材真实视觉观察（P3）：从不透明 assetRef 观察素材图像，回包无本地路径
        if (toolName === 'observeEagleAsset') {
            const parsedRef = parseEagleAssetRefToken(params.assetRef);
            if (!parsedRef) {
                result = { success: false, error: 'observeEagleAsset 需要 assetRef（形如 libraryId:itemId 的不透明引用）。情境快照中「assetRef=」后的值即是。' };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
            const observeBridge = (window as any).designEcho?.observeEagleAsset;
            if (typeof observeBridge !== 'function') {
                result = { success: false, error: 'Eagle 素材观察桥不可用：当前应用版本较旧（preload 缺少 observeEagleAsset），请重启应用加载最新构建。' };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
            result = await observeBridge({
                libraryId: parsedRef.libraryId,
                itemId: parsedRef.itemId,
                ...(Number.isFinite(Number(params.maxSize)) ? { maxSize: Number(params.maxSize) } : {})
            });
            if (result?.success) executedToolsInSession.push(toolName);
            toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
            return result;
        }

        // Eagle 素材复制进项目（P3）：解析 assetRef → 复制到项目目录 → 来源追踪
        if (toolName === 'importEagleAssetToProject') {
            const parsedRef = parseEagleAssetRefToken(params.assetRef);
            if (!parsedRef) {
                result = { success: false, error: 'importEagleAssetToProject 需要 assetRef（形如 libraryId:itemId 的不透明引用）。' };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
            const projectPath = useAppStore.getState().currentProject?.path;
            if (!projectPath) {
                result = { success: false, error: '当前没有打开的项目：请先在工作台打开一个项目，再导入 Eagle 素材。' };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
            const importBridge = (window as any).designEcho?.importEagleAssetToProject;
            if (typeof importBridge !== 'function') {
                result = { success: false, error: 'Eagle 素材导入桥不可用：当前应用版本较旧（preload 缺少 importEagleAssetToProject），请重启应用加载最新构建。' };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
            result = await importBridge({
                libraryId: parsedRef.libraryId,
                itemId: parsedRef.itemId,
                projectPath,
                ...(String(params.targetSubdir || '').trim() ? { targetSubdir: String(params.targetSubdir).trim() } : {})
            });
            if (result?.success) executedToolsInSession.push(toolName);
            toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
            return result;
        }

        // AI 图片生成工具（BFL FLUX）
        if (toolName === 'generateImage') {
            result = await executeImageGeneration(params);
            if (result.success) executedToolsInSession.push(toolName);
            toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
            return result;
        }

        // 详情页内容匹配工具（Agent 端执行）
        if (toolName === 'matchDetailPageContent') {
            result = await executeDetailPageContentMatch(params);
            if (result.success) executedToolsInSession.push(toolName);
            toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
            return result;
        }

        // 标注式空间快照：UXP 返回截图+图层边界映射，Agent 端叠印编号边框后
        // 返回标注图像（imageData 字段，自动进入循环的画面观察）+ 元素坐标表。
        if (toolName === 'getAnnotatedSnapshot') {
            const raw = await sendToPluginWithCancellation('getAnnotatedSnapshot', {
                maxWidth: params?.maxWidth,
                maxHeight: params?.maxHeight,
                includeHidden: params?.includeHidden,
                layerFilter: params?.layerFilter,
                // region 必须透传（视神经病例 2026-07-07）：此前被静默丢弃——UXP 失败文案教模型
                // 「长文档请带 region」，模型照做也到不了 UXP，超长详情页标注快照成死循环陷阱。
                region: params?.region
            }, undefined, options, toolName);
            if (!raw?.success || !raw.imageData) {
                result = {
                    success: false,
                    error: `标注快照获取失败：${raw?.error || 'UXP 未返回截图数据'}`
                };
            } else {
                const { renderAnnotatedSnapshot } = await import('./annotated-snapshot-renderer');
                const layers = Array.isArray(raw.layers) ? raw.layers : [];
                try {
                    const { annotatedBase64, rendered } = await renderAnnotatedSnapshot({
                        imageBase64: raw.imageData,
                        layers,
                        scale: Number(raw.scale) || 1,
                        snapshotSize: raw.snapshotSize || { width: 1200, height: 900 }
                    });
                    // UXP 端返回的 bounds 是**截图坐标**（get-annotated-snapshot.ts 按
                    // (bounds.left - viewX) * scale 换算过）。此前原样透传却在 message 与 tool schema 里
                    // 声明为「文档像素坐标」，模型据此算位移会系统性偏移（2400px 文档缩到 1200 时，
                    // 它说「左移 24px 对齐」实际只移 12px）——这是唯一会让 Agent **自信地做错**的缺陷。
                    // 这里还原成真实文档坐标，让「眼睛看到的坐标」与「手要用的坐标」是同一套。
                    const snapshotScale = Number(raw.scale) > 0 ? Number(raw.scale) : 1;
                    const regionOriginX = Number(
                        raw.region?.x
                        ?? raw.region?.left
                        ?? raw.regionRect?.x
                        ?? raw.regionRect?.left
                        ?? 0
                    ) || 0;
                    const regionOriginY = Number(
                        raw.region?.y
                        ?? raw.region?.top
                        ?? raw.regionRect?.y
                        ?? raw.regionRect?.top
                        ?? 0
                    ) || 0;
                    const toDocumentBounds = (b: any) => {
                        if (!b) return b;
                        const left = Math.round(b.left / snapshotScale + regionOriginX);
                        const top = Math.round(b.top / snapshotScale + regionOriginY);
                        const width = Math.round(b.width / snapshotScale);
                        const height = Math.round(b.height / snapshotScale);
                        return { left, top, right: left + width, bottom: top + height, width, height };
                    };
                    result = {
                        success: true,
                        imageData: annotatedBase64,
                        format: 'jpeg',
                        mediaType: 'image/jpeg',
                        // 语义整理前后要比较未叠加标注的真实画布，而不是会随标注框变化的
                        // annotatedBase64；这里只返回摘要，不复制第二份原始 base64。
                        visualContentFingerprint: `sha256:${sha256Hex(raw.imageData)}`,
                        documentSize: raw.documentSize,
                        snapshotSize: raw.snapshotSize,
                        historyStateRef: raw.historyStateRef,
                        ...(raw.region ? { region: raw.region } : {}),
                        scale: raw.scale,
                        elements: layers.map((l: any) => ({
                            index: l.index,
                            layerId: l.id,
                            name: l.name,
                            parentId: Number.isFinite(Number(l.parentId)) ? Number(l.parentId) : null,
                            ancestorNames: Array.isArray(l.ancestorNames) ? l.ancestorNames : [],
                            path: l.path,
                            depth: Number.isFinite(Number(l.depth)) ? Number(l.depth) : undefined,
                            kind: l.kind,
                            bounds: toDocumentBounds(l.bounds)
                        })),
                        summary: raw.summary,
                        annotated: rendered,
                        message: rendered
                            ? `标注快照已生成：${layers.length} 个元素已编号标注（编号与坐标表对应，bounds 为文档像素坐标，可直接用于 moveLayer/alignToReference）。`
                            : `已读取截图和 ${layers.length} 个元素坐标；这次没有叠加编号，仍可按坐标核对元素位置。`
                    };
                } catch (renderError: any) {
                    result = {
                        success: false,
                        error: `标注快照绘制失败：${renderError?.message || renderError}`
                    };
                }
            }
            if (result.success) executedToolsInSession.push(toolName);
            toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
            return result;
        }

        // 设计参考搜索（MCP 设计平台爬虫）
        if (toolName === 'searchDesigns') {
            result = await executeSearchDesigns(params);
            if (result.success) executedToolsInSession.push(toolName);
            toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
            return result;
        }

        // 网页内容提取（Playwright）
        if (toolName === 'fetchWebPageDesignContent') {
            result = await executeFetchWebPageDesignContent(params);
            if (result.success) executedToolsInSession.push(toolName);
            toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
            return result;
        }

        // 浏览器扩展工具（操作用户真实浏览器，见 docs/browser-extension-bridge.md）
        if (BROWSER_BRIDGE_TOOL_METHODS[toolName]) {
            result = await executeBrowserBridgeTool(toolName, params);
            if (result.success) executedToolsInSession.push(toolName);
            toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
            return result;
        }

        // 自动化无弹窗策略：默认阻止会触发系统/PS 文件弹窗的调用
        if (AUTOMATION_BLOCK_DIALOG && params?.allowDialog !== true) {
            if (toolName === 'quickExport' && hasValue(params?.outputPath) && isExplicitRasterFilePath(params.outputPath)) {
                const requestedPath = String(params.outputPath).trim();
                const requestedFormat = normalizeNoDialogSaveFormat(params?.format || requestedPath);
                const saveParams: Record<string, any> = {
                    path: requestedPath,
                    format: requestedFormat === 'jpeg' ? 'jpg' : requestedFormat
                };
                if (hasValue(params?.quality)) {
                    saveParams.quality = params.quality;
                }
                const saveResult = await sendToPluginWithCancellation(
                    'saveDocument',
                    saveParams,
                    getToolTimeout('saveDocument', { path: requestedPath }),
                    options,
                    'saveDocument'
                );
                if (saveResult?.success !== false) {
                    executedToolsInSession.push('quickExport');
                    return {
                        ...saveResult,
                        success: true,
                        message: `✅ 已按完整路径无弹窗导出到: ${requestedPath}`,
                        outputPath: requestedPath,
                        exportedFiles: [requestedPath],
                        redirectedTo: 'saveDocument',
                        redirectedFrom: 'quickExport'
                    };
                }
                return {
                    ...saveResult,
                    redirectedTo: 'saveDocument',
                    redirectedFrom: 'quickExport'
                };
            }

            if (toolName === 'quickExport' && !hasValue(params?.outputPath)) {
                return {
                    success: false,
                    error: '自动化执行已阻止 quickExport 弹窗：缺少 outputPath',
                    suggestion: '请传入 outputPath（完整导出路径），或设置 allowDialog=true'
                };
            }

            if (toolName === 'smartSave' || (toolName === 'saveDocument' && !hasValue(params?.path))) {
                const projectPath = await getCurrentProjectPath();
                if (!projectPath) {
                    return {
                        success: false,
                        error: `自动化执行已阻止 ${toolName} 弹窗：未设置当前项目路径`,
                        suggestion: '请先导入项目，或使用 saveDocument(path) 显式传路径，或设置 allowDialog=true'
                    };
                }

                const docName = await getCurrentDocumentName();
                const requestedFormat = normalizeNoDialogSaveFormat(params?.format || params?.exportFormat);
                const saveRoot = await resolveNoDialogSaveRoot(projectPath, params?.projectSubdir);
                if (saveRoot.error) {
                    return {
                        success: false,
                        error: saveRoot.error,
                        suggestion: '请确认项目路径可写，或使用 saveDocument(path) 显式传入完整保存路径'
                    };
                }
                const autoPath = buildNoDialogSavePath(saveRoot.directory, docName, requestedFormat);
                const saveParams: Record<string, any> = {
                    path: autoPath,
                    format: requestedFormat
                };
                if (hasValue(params?.conflictPolicy)) {
                    saveParams.conflictPolicy = params.conflictPolicy;
                }
                const quality = params?.quality ?? params?.exportQuality;
                if (hasValue(quality)) {
                    saveParams.quality = quality;
                }
                if (toolName === 'saveDocument'
                    && (requestedFormat === 'png' || requestedFormat === 'jpg')
                    && params?.conflictPolicy !== 'fail_if_exists') {
                    const exportParams: Record<string, any> = {
                        outputPath: saveRoot.directory,
                        format: requestedFormat
                    };
                    if (hasValue(quality)) {
                        exportParams.quality = quality;
                    }
                    const exportResult = await sendToPluginWithCancellation(
                        'quickExport',
                        exportParams,
                        getToolTimeout('quickExport', { outputPath: saveRoot.directory }),
                        options,
                        'quickExport'
                    );

                    if (exportResult?.success !== false) {
                        executedToolsInSession.push('saveDocument');
                        const exportedPath = Array.isArray(exportResult?.exportedFiles) && exportResult.exportedFiles[0]
                            ? String(exportResult.exportedFiles[0])
                            : autoPath;
                        return {
                            ...exportResult,
                            success: true,
                            message: `✅ 已无弹窗导出到: ${exportedPath}`,
                            savePath: exportedPath,
                            redirectedFrom: toolName
                        };
                    }

                    return exportResult;
                }
                const saveResult = await sendToPluginWithCancellation(
                    'saveDocument',
                    saveParams,
                    getToolTimeout('saveDocument', { path: autoPath }),
                    options,
                    'saveDocument'
                );

                if (saveResult?.success !== false) {
                    executedToolsInSession.push('saveDocument');
                    return {
                        ...saveResult,
                        success: true,
                        message: `✅ 已无弹窗保存到: ${autoPath}`,
                        savePath: autoPath,
                        redirectedFrom: toolName
                    };
                }

                return saveResult;
            }
        }
        // placeImage 自动选图 + 路径预处理
        let finalParams = params;
        if (toolName === 'placeImage') {
            finalParams = await autoResolvePlaceImageSource(finalParams);
            if (finalParams?.__autoSelectBlocked) {
                const decision = finalParams.__autoSelectDecision || {};
                const code = String(decision.code || 'candidate_confirmation_required');
                const errorByCode: Record<string, string> = {
                    explicit_source_required: 'placeImage 需要明确图片来源；当前没有执行素材扫描或 Photoshop 写入。',
                    asset_selection_service_unavailable: '素材选择服务当前不可用；没有执行 Photoshop 写入。',
                    selection_requirement_required: '自动选图缺少明确的设计需求；没有执行 Photoshop 写入。',
                    no_asset_candidate: '没有找到可用素材候选；没有执行 Photoshop 写入。',
                    design_role_required: '自动置入缺少结构化 designRole，无法判断素材在画面中的职责。',
                    visual_selection_evidence_required: '候选只有文件名/路径等元数据，没有真实视觉观察，不能自动置入。',
                    candidate_requires_recomposition: '最佳候选需要去底或重组合成，不能作为原始矩形图片直接置入。',
                    candidate_role_mismatch: '最佳候选只适合作辅助素材，与当前设计角色不匹配。',
                    candidate_unsuitable: '最佳候选被视觉判断为不适合当前用途。',
                    candidate_direct_use_unverified: '最佳候选是否适合直接使用仍不确定。',
                    candidate_score_below_threshold: '最佳候选没有达到自动置入最低分。',
                    candidate_margin_below_threshold: '前两名候选过于接近，无法可靠自动选择。',
                    candidate_confirmation_required: '已返回候选，等待明确选择；没有执行 Photoshop 写入。'
                };
                const result = {
                    success: false,
                    error: errorByCode[code] || errorByCode.candidate_confirmation_required,
                    code,
                    recoverable: true,
                    noMutation: true,
                    selectionRequired: true,
                    requirement: decision.requirement,
                    designRole: decision.designRole,
                    placementIntent: decision.placementIntent,
                    mode: decision.mode,
                    strictDeterministic: decision.strictDeterministic,
                    topScore: decision.topScore,
                    margin: decision.margin,
                    selectionAuthority: decision.selectionAuthority,
                    autoPlacementEligible: decision.autoPlacementEligible === true,
                    thresholds: decision.thresholds,
                    candidates: decision.candidates || [],
                    suggestion: code === 'candidate_requires_recomposition'
                        ? '先明确选择该素材并完成去底/蒙版与合成计划，再用显式 source 置入；不要用 force 绕过合成。'
                        : '使用 recommendAssets 观察候选并传入明确 filePath；模型填写 force/source/reason 不能替代视觉证据或 Harness receipt。'
                };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
        }

        // placeImage 预处理：优先将路径读取为 Base64，规避 UXP 对本地路径/URI 的访问限制
        if (toolName === 'placeImage' && finalParams?.filePath && !finalParams?.imageData && !finalParams?.fileToken) {
            try {
                const designEcho = (window as any).designEcho;
                if (designEcho?.readImageBase64) {
                    const projectPath = await getCurrentProjectPath();
                    const filePathCandidates = normalizePlaceImageFilePathCandidates(finalParams.filePath, projectPath);
                    let usedPath = '';
                    let imageBase64 = '';
                    let readMeta: { mimeType?: string; assetId?: string; checksum?: string; byteLength?: number } = {};

                    for (const candidatePath of filePathCandidates) {
                        const readResult = await designEcho.readImageBase64(candidatePath);
                        const extracted = extractBase64FromReadResult(readResult);
                        if (extracted) {
                            usedPath = candidatePath;
                            imageBase64 = extracted;
                            readMeta = extractReadMeta(readResult);
                            break;
                        }
                    }

                    if (imageBase64) {
                        const imageFormat = resolveImageFormat(readMeta.mimeType, usedPath || finalParams.filePath);
                        finalParams = {
                            ...finalParams,
                            imageData: imageBase64,
                            imageFormat,
                            filePath: undefined,
                            sourceAssetId: readMeta.assetId,
                            sourceChecksum: readMeta.checksum,
                            sourceByteLength: readMeta.byteLength,
                            sourcePath: usedPath || finalParams.filePath
                        };
                        console.log('[placeImage] 已从文件路径转为 Base64 置入:', usedPath || finalParams.filePath, `assetId=${readMeta.assetId || 'n/a'}`);
                    } else {
                        console.warn('[placeImage] Base64 预读失败，将尝试原始路径:', filePathCandidates);
                    }
                }
            } catch (e) {
                console.warn('[placeImage] 读取 Base64 失败，将尝试原路径:', e);
            }
        }

        // replaceLayerContent 预处理：支持 filePath 输入并在 Agent 侧转成 imageBase64
        if (toolName === 'replaceLayerContent' && finalParams?.filePath && !finalParams?.imageBase64) {
            try {
                const designEcho = (window as any).designEcho;
                if (designEcho?.readImageBase64) {
                    const projectPath = await getCurrentProjectPath();
                    const filePathCandidates = normalizePlaceImageFilePathCandidates(finalParams.filePath, projectPath);
                    let imageBase64 = '';
                    let usedPath = '';

                    for (const candidatePath of filePathCandidates) {
                        const readResult = await designEcho.readImageBase64(candidatePath);
                        const extracted = extractBase64FromReadResult(readResult);
                        if (extracted) {
                            imageBase64 = extracted;
                            usedPath = candidatePath;
                            break;
                        }
                    }

                    if (imageBase64) {
                        finalParams = {
                            ...finalParams,
                            imageBase64,
                            filePath: undefined,
                            sourcePath: usedPath || finalParams.filePath
                        };
                        console.log('[replaceLayerContent] 已从文件路径转为 imageBase64:', usedPath || finalParams.filePath);
                    } else {
                        console.warn('[replaceLayerContent] Base64 预读失败，将尝试原始参数:', filePathCandidates);
                    }
                }
            } catch (e) {
                console.warn('[replaceLayerContent] 读取 Base64 失败:', e);
            }
        }
        finalParams = normalizePhotoshopToolArguments(toolName, finalParams);

        // UXP 工具调用（应用名称别名）
        const uxpToolName = TOOL_NAME_ALIASES[toolName] || toolName;
        const timeout = getToolTimeout(toolName, finalParams);
        const acceptancePolicy = getToolAcceptanceCapturePolicy(toolName, finalParams);
        const collectAcceptance = acceptancePolicy.collect && shouldCollectAcceptanceVerification(toolName, finalParams);

        // 写工具执行前验证当前文档：防止用户中途切换/关闭文档导致操作错误文档
        // Agent 启动时的文档快照可能已过期，这里在执行前做一次轻量级实时检查
        if (collectAcceptance && toolName !== 'createDocument') {
            const presence = await probeCurrentDocumentPresence();
            if (presence.state === 'absent') {
                // 结构化确认没有打开的文档，但 Agent 预期有文档——说明用户关闭了文档
                return {
                    success: false,
                    error: `操作失败：当前 Photoshop 中没有打开的文档（经结构化确认）。可能是在 Agent 执行期间文档被关闭了。请重新打开文档后再试，或让 Agent 重新确认文档状态。`,
                    suggestion: '调用 getDocumentInfo 或 listDocuments 确认当前文档状态，然后重新执行操作。'
                };
            }
            if (presence.state === 'unknown') {
                // 读不出状态不等于没有文档（PS 正忙/模态常见）：本次写入暂缓并明说可重试，
                // 不把瞬时探测失败升级成"文档被关闭"的误判。
                return {
                    success: false,
                    error: `暂时无法确认 Photoshop 文档状态（Photoshop 可能正忙或处于模态状态），本次写入已暂缓；这不代表文档已关闭，请稍后重试。`,
                    suggestion: '稍后重试本操作；反复出现再调用 getDocumentInfo 或 listDocuments 确认文档状态。'
                };
            }
        }

        const acceptanceBefore = collectAcceptance
            ? await captureAcceptanceSnapshot('before', toolName, {
                ...acceptancePolicy,
                signal: options.signal
            })
            : undefined;
        result = await sendToPluginWithCancellation(uxpToolName, finalParams, timeout, options, toolName);
        if (requiresPhotoshopOperationReadback(result)) {
            result = await reconcileOperationSpecificPhotoshopReadback(
                toolName,
                finalParams,
                result
            );
        }
        console.log(`[ToolCall] 结果:`, result);

        if (collectAcceptance && acceptanceBefore) {
            const acceptanceAfter = await captureAcceptanceSnapshot('after', toolName, {
                ...acceptancePolicy,
                signal: options.signal
            });
            result = attachAcceptanceVerification(toolName, finalParams, result, acceptanceBefore, acceptanceAfter);
            const acceptanceWithPolicy = {
                ...result.acceptance,
                policy: {
                    mode: acceptancePolicy.mode,
                    includeHidden: acceptancePolicy.includeHidden,
                    includeBounds: acceptancePolicy.includeBounds,
                    includeText: acceptancePolicy.includeText,
                    maxLayers: acceptancePolicy.maxLayers,
                    timeoutMs: acceptancePolicy.timeoutMs,
                    reason: acceptancePolicy.reason
                }
            };
            result.acceptance = {
                ...acceptanceWithPolicy,
                debugText: formatToolAcceptanceDebug(acceptanceWithPolicy)
            };
        }

        const focusResult = await maybeAutoFocusAfterTool(toolName, finalParams, result, options);
        if (focusResult && result && typeof result === 'object' && !Array.isArray(result)) {
            result = {
                ...result,
                focusResult
            };
        }
        
        // 记录成功的工具
        if (result?.success !== false) {
            executedToolsInSession.push(toolName);
            recordToolExecution(toolName, finalParams, result);
        }

        // 错误恢复建议
        result = normalizeFailedToolResultForPublicUse(result);
        if (!result?.success && result?.error) {
            const recovery = getErrorRecovery(toolName, result.error);
            if (recovery) result.suggestion = recovery;
            // 工具失败时附加当前文档状态，帮助 Agent 理解失败原因（如文档被切换/关闭）。
            // 纪律：只有结构化确认（documentState:'absent'）才能断言"没有打开的文档"；
            // 探测未知时必须保持中性，且中性文案不得包含「无文档恢复」分支的触发字样。
            try {
                const presence = await probeCurrentDocumentPresence();
                if (presence.state === 'absent') {
                    result.error = `${result.error}\n\n[文档状态] 当前 Photoshop 中没有打开的文档（经结构化确认）。可能文档在操作期间被关闭或切换。`;
                } else if (presence.state === 'present') {
                    result.error = `${result.error}\n\n[文档状态] 当前文档：${presence.name}`;
                } else {
                    result.error = `${result.error}\n\n[文档状态] 文档状态暂时无法确认：本次失败不代表文档已关闭（Photoshop 可能正忙），可稍后重试确认。`;
                }
            } catch {
                // 文档状态检查失败不影响原有错误信息
            }
        }
        
        toolLogger.logToolCall(toolName, finalParams, result, Date.now() - startTime, currentRound);
        return result;
        
    } catch (error) {
        console.error(`[ToolCall] 错误:`, error);
        const errorMessage = error instanceof Error ? error.message : '工具调用失败';
        const executionKind = classifyAgentToolExecution(toolName, params);
        const isPhotoshopWrite = (
            executionKind === 'photoshop_write'
            || executionKind === 'save_export'
        );
        const dispatchFailure = readPhotoshopToolDispatchFailure(error);
        if (dispatchFailure?.phase === 'pre_dispatch') {
            const notDispatchedResult = isPhotoshopWrite
                ? buildPhotoshopOperationNotDispatchedResult(
                    toolName,
                    dispatchFailure.message || errorMessage,
                    dispatchFailure.code
                )
                : {
                    success: false,
                    code: dispatchFailure.code,
                    error: sanitizeUserVisibleDiagnosticText(
                        dispatchFailure.message || errorMessage
                    ) || errorMessage
                };
            toolLogger.logToolCall(
                toolName,
                params,
                notDispatchedResult,
                Date.now() - startTime,
                currentRound
            );
            return notDispatchedResult;
        }
        const dispatchedWriteOutcomeUnknown = isPhotoshopWrite && (
            dispatchFailure?.phase === 'dispatched'
            || isDispatchedPhotoshopOperationUnknown(errorMessage)
            || isPhotoshopNativeModalTimeout(errorMessage)
        );
        if (dispatchedWriteOutcomeUnknown) {
            const unknownResult = buildPhotoshopOperationOutcomeUnknownResult(
                toolName,
                errorMessage
            );
            const reconciledResult = await reconcileOperationSpecificPhotoshopReadback(
                toolName,
                params,
                unknownResult
            );
            toolLogger.logToolCall(
                toolName,
                params,
                reconciledResult,
                Date.now() - startTime,
                currentRound
            );
            return reconciledResult;
        }
        if (isPhotoshopNativeModalTimeout(errorMessage)) {
            const modalResult = buildPhotoshopNativeModalSuspectedResult(toolName, errorMessage, params);
            toolLogger.logToolCall(toolName, params, modalResult, Date.now() - startTime, currentRound);
            return modalResult;
        }
        const result = { 
            success: false, 
            error: sanitizeUserVisibleDiagnosticText(errorMessage) || errorMessage,
            suggestion: getErrorRecovery(toolName, errorMessage)
        };
        toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
        return result;
    }
};

/**
 * 统一 Tool 分发边界同时签发对象身份来源。
 * 复合 Skill 只有保留这里返回的原始 result 对象，Runtime 才会承认其嵌套原子调用。
 */
export async function executeToolCall(
    toolName: string,
    params: any,
    options: ToolCallExecutionOptions = {}
): Promise<any> {
    const result = await executeToolCallImpl(toolName, params, options);
    markExecutedToolResultProvenance(toolName, result);
    return result;
}

/**
 * 记录工具执行到记忆服务
 */
async function recordToolExecution(toolName: string, params: any, result: any) {
    try {
        const memory = getMemoryService();
        
        const currentProject = useAppStore.getState().currentProject;
        const projectId = currentProject?.id || '__default__';
        
        memory.recordOperation(toolName, params, result, true);
        memory.recordToolUsage(projectId, toolName);
        
        // 记录图层选择
        if (result?.layerId && result?.layerName) {
            memory.setContextVariable('selectedLayerId', result.layerId);
            memory.setContextVariable('selectedLayerName', result.layerName);
            memory.rememberLayer(result.layerId, result.layerName);
        }
        
        // 记录颜色
        if (params?.color) {
            const colorStr = typeof params.color === 'object' 
                ? `rgb(${params.color.r},${params.color.g},${params.color.b})`
                : params.color;
            memory.rememberColor(colorStr);
        }
        
    } catch (e) {
        console.warn('[ToolExecutor] 记录失败:', e);
    }
}

async function prepareProjectContactSheetInput(params: any, designEcho: any): Promise<{
    projectDir?: string;
    images: Array<{
        path: string;
        relativePath?: string;
        labelHint?: string;
        role?: string;
    }>;
}> {
    let projectDir = params.projectPath || params.directory;
    const currentProject = useAppStore.getState().currentProject;
    if (!projectDir && currentProject?.path) {
        projectDir = currentProject.path;
    } else if (projectDir && !String(projectDir).startsWith('/') && !/^[a-zA-Z]:[\\/]/.test(String(projectDir)) && currentProject?.path) {
        projectDir = `${currentProject.path.replace(/[\\/]+$/, '')}/${String(projectDir).replace(/^[\\/]+/, '')}`;
    }
    if (currentProject?.path) {
        await designEcho.setProjectRoot?.(currentProject.path);
    }

    let images = Array.isArray(params.images) ? params.images : [];
    if (images.length === 0) {
        const scan = await designEcho.scanDirectory(projectDir || currentProject?.path, {
            recursive: true,
            includeDesignFiles: false,
            maxDepth: params.maxDepth || 5,
            generateThumbnails: false
        });
        images = (scan?.files || [])
            .filter((file: any) => file?.type === 'image' && file?.path)
            .slice(0, params.maxImages || 40)
            .map((file: any) => ({
                path: file.path,
                relativePath: file.relativePath || file.name,
                labelHint: file.name
            }));
    }

    return { projectDir, images };
}

/**
 * 执行资源工具
 */
async function executeResourceTool(toolName: string, params: any): Promise<any> {
    const designEcho = (window as any).designEcho;
    
    try {
        switch (toolName) {
            case 'listProjectResources':
                // 与 searchProjectResources 一致：自动使用当前项目路径，支持子目录
                let listDirectory = params.directory;
                if (!listDirectory) {
                    const currentProject = useAppStore.getState().currentProject;
                    if (currentProject?.path) {
                        listDirectory = currentProject.path;
                        await designEcho.setProjectRoot?.(currentProject.path);
                    }
                } else if (!listDirectory.startsWith('/') && !/^[a-zA-Z]:[\\/]/.test(listDirectory)) {
                    // 相对路径（如 "薄款堆堆袜"）拼接项目根
                    const currentProject = useAppStore.getState().currentProject;
                    if (currentProject?.path) {
                        listDirectory = `${currentProject.path.replace(/[\\/]+$/, '')}/${listDirectory.replace(/^[\\/]+/, '')}`;
                        await designEcho.setProjectRoot?.(currentProject.path);
                    }
                }
                const scanResult = await designEcho.scanDirectory(listDirectory);
                if (!scanResult || scanResult.totalFiles === 0) {
                    return {
                        success: true,
                        message: '没有找到图片文件',
                        suggestion: listDirectory ? `请检查目录是否存在: ${listDirectory}` : '请先设置项目根目录'
                    };
                }
                return {
                    success: true,
                    totalFiles: scanResult.totalFiles,
                    files: scanResult.files.slice(0, 30),
                    summary: `找到 ${scanResult.imageCount} 张图片`
                };
                
            case 'searchProjectResources':
                // 如果没有提供 directory，自动使用当前项目路径
                let searchDirectory = params.directory;
                if (!searchDirectory) {
                    // 从 store 获取当前项目路径
                    const currentProject = useAppStore.getState().currentProject;
                    if (currentProject?.path) {
                        searchDirectory = currentProject.path;
                        // 同时设置 projectRoot
                        await designEcho.setProjectRoot?.(currentProject.path);
                    }
                }
                
                const searchOptions: any = { limit: params.limit || 20 };
                if (searchDirectory) {
                    searchOptions.directory = searchDirectory;
                }
                if (params.type) {
                    searchOptions.type = params.type;
                }
                
                console.log('[searchProjectResources] 搜索目录:', searchDirectory, '查询:', params.query);
                const results = await designEcho.searchResources(params.query, searchOptions);
                console.log('[searchProjectResources] 搜索结果:', results?.length || 0, '个');

                // 搜索是纯文件名/路径子串匹配。真实素材常是相机导出的时间戳名（如 2026-04-17 151327.jpg），
                // 用「摄影图/素材/刺绣」这类语义词必然 0 命中——但素材其实就在项目里。
                // 命中为空时直接回退列出目录内实际存在的资源，避免模型据此判定「项目没有素材」而停摆。
                if (!results || results.length === 0) {
                    const fallbackOptions: any = { limit: params.limit || 20 };
                    if (searchDirectory) fallbackOptions.directory = searchDirectory;
                    if (params.type) fallbackOptions.type = params.type;
                    const available = await designEcho.searchResources('', fallbackOptions);
                    const availableList = Array.isArray(available) ? available : [];
                    return {
                        success: true,
                        results: [],
                        matchedQuery: params.query,
                        availableResources: availableList,
                        directory: searchDirectory,
                        summary: availableList.length > 0
                            ? `按名称匹配「${params.query}」没有命中，但项目目录里实际有 ${availableList.length} 个可用资源（素材常是时间戳文件名，语义词匹配不到）。请直接从 availableResources 里挑选，不要据此认为项目没有素材。`
                            : `在 ${searchDirectory || '(未设置)'} 中没有找到任何资源文件。`
                    };
                }

                return {
                    success: true,
                    results: results || [],
                    directory: searchDirectory,
                    summary: `在 ${searchDirectory || '(未设置)'} 中找到 ${results?.length || 0} 个匹配资源`
                };
                
            case 'getProjectStructure':
                const structure = await designEcho.getResourceStructure(params.directory);
                return { success: true, structure };
                
            case 'getResourceSummary':
                const summary = await designEcho.getResourceSummary(params.directory);
                return { success: true, summary };
                
            case 'getAssetPreview':
                const preview = await designEcho.getResourcePreview(params.imagePath, params.maxSize || 512);
                if (!preview?.base64) {
                    return { success: false, error: '无法获取预览' };
                }
                return { success: true, imageData: preview.base64, width: preview.width, height: preview.height };

            case 'createProjectContactSheetOverview': {
                const prepared = await prepareProjectContactSheetInput(params, designEcho);

                const result = await designEcho.createProjectContactSheetOverview?.({
                    projectPath: prepared.projectDir,
                    images: prepared.images,
                    columns: params.columns,
                    tileWidth: params.tileWidth,
                    tileHeight: params.tileHeight,
                    maxImages: params.maxImages
                });

                return {
                    ...(result || { success: false, items: [], warnings: [], limitations: [] }),
                    summary: result?.success
                        ? `已生成项目素材总览：${result.items?.length || 0} 张图片，编号 ${result.items?.[0]?.id || 'A01'} 起。`
                        : (result?.error || '项目素材总览生成失败。')
                };
            }

            case 'analyzeProjectContactSheetOverview': {
                const prepared = await prepareProjectContactSheetInput(params, designEcho);
                const result = await designEcho.analyzeProjectContactSheetOverview?.({
                    projectPath: prepared.projectDir,
                    images: prepared.images,
                    columns: params.columns,
                    tileWidth: params.tileWidth,
                    tileHeight: params.tileHeight,
                    maxImages: params.maxImages,
                    focus: params.focus,
                    userIntent: params.userIntent || params.requirement || params.query
                });

                return {
                    ...(result || { success: false, warnings: [], limitations: [] }),
                    summary: result?.success
                        ? `已完成项目素材总览观察：${result.contactSheet?.items?.length || 0} 张图片，建议重点复核 ${result.observation?.nextSingleImageChecks?.join('、') || '若干编号'}。`
                        : (result?.error || '项目素材总览观察失败。')
                };
            }

            case 'prepareSkuRetouchAssets': {
                const currentProject = useAppStore.getState().currentProject;
                const result = await designEcho.prepareSkuRetouchAssets?.({
                    ...params,
                    projectPath: params.projectPath || currentProject?.path
                });
                if (!result) {
                    return { success: false, error: 'SKU 素材精修服务未接入当前应用版本。' };
                }
                let summary = result.error || 'SKU 素材精修失败。';
                if (result.workflowStatus === 'prepared') {
                    summary = `已生成 ${result.sources?.filter((source: any) => source.status === 'prepared').length || 0} 组 SKU 精修资产；仍需写入 Photoshop 并读回验收。`;
                } else if (result.workflowStatus === 'not_applicable') {
                    summary = '当前素材不适用纯底 SKU 精修链，应改走场景图设计方向。';
                }
                return { ...result, summary };
            }
            
            case 'openProjectFile':
                // 组合工具：搜索 + 打开
                console.log('[openProjectFile] 开始，查询:', params.query, '目录:', params.directory || '默认');
                
                // 1. 获取项目目录
                const projectForOpen = useAppStore.getState().currentProject;
                if (!projectForOpen?.path) {
                    return { success: false, error: '未选择项目，请先打开一个项目' };
                }
                
                // 2. 搜索文件（如果指定了目录，则在该目录搜索）
                const searchDir = params.directory || projectForOpen.path;
                await designEcho.setProjectRoot?.(projectForOpen.path);
                const searchResultsForOpen = await designEcho.searchResources(params.query, {
                    directory: searchDir,
                    type: params.type || 'design',
                    limit: 10
                });
                
                console.log('[openProjectFile] 搜索目录:', searchDir);
                
                console.log('[openProjectFile] 搜索结果:', searchResultsForOpen?.length || 0, '个');
                
                if (!searchResultsForOpen || searchResultsForOpen.length === 0) {
                    return { 
                        success: false, 
                        error: `在项目目录中未找到包含 "${params.query}" 的文件`,
                        searchedDirectory: projectForOpen.path
                    };
                }
                
                // 3. 找到可以用 Photoshop 打开的文件（按优先级排序）
                // 支持的格式：PSD, PSB, TIF, TIFF, PNG, JPG, JPEG, BMP, GIF 等
                const supportedExtensions = ['.psd', '.psb', '.tif', '.tiff', '.png', '.jpg', '.jpeg', '.bmp', '.gif'];
                const query = params.query.toLowerCase();
                
                console.log('[openProjectFile] 搜索结果:', searchResultsForOpen.map((f: any) => f.name).join(', '));
                
                // 优先级1: 精确匹配文件名（不含扩展名）
                // 例如: 搜索 "4双装" 应该精确匹配 "4双装.tif" 而不是 "4双自选备注.tif"
                let fileToOpen = searchResultsForOpen.find((f: any) => {
                    const nameWithoutExt = f.name.replace(/\.[^.]+$/, '').toLowerCase();
                    return nameWithoutExt === query;
                });
                
                if (fileToOpen) {
                    console.log('[openProjectFile] ✓ 精确匹配:', fileToOpen.name);
                }
                
                // 优先级2: 文件名以搜索词开头（例如 "4双装" 匹配 "4双装-xxx.tif"）
                if (!fileToOpen) {
                    fileToOpen = searchResultsForOpen.find((f: any) => {
                        const nameWithoutExt = f.name.replace(/\.[^.]+$/, '').toLowerCase();
                        return nameWithoutExt.startsWith(query) && supportedExtensions.some(ext => f.name.toLowerCase().endsWith(ext));
                    });
                    if (fileToOpen) {
                        console.log('[openProjectFile] ✓ 前缀匹配:', fileToOpen.name);
                    }
                }
                
                // 优先级3: 选择设计文件（PSD/PSB）
                if (!fileToOpen) {
                    fileToOpen = searchResultsForOpen.find((f: any) => 
                        f.name.toLowerCase().endsWith('.psd') || f.name.toLowerCase().endsWith('.psb')
                    );
                }
                
                // 优先级4: 选择其他支持的格式
                if (!fileToOpen) {
                    fileToOpen = searchResultsForOpen.find((f: any) => 
                        supportedExtensions.some(ext => f.name.toLowerCase().endsWith(ext))
                    );
                }
                
                // 优先级5: 尝试打开第一个文件
                if (!fileToOpen) {
                    fileToOpen = searchResultsForOpen[0];
                }
                console.log('[openProjectFile] 最终选择:', fileToOpen.path);
                
                // 4. 使用系统关联应用打开文件
                // 通过 Electron 的 shell.openPath 让系统用关联的应用程序（Photoshop）打开文件
                console.log('[openProjectFile] 使用系统方法打开文件:', fileToOpen.path);
                
                try {
                    // 使用已暴露的 designEcho.openPath 方法（异步，不阻塞）
                    const openError = await designEcho.openPath(fileToOpen.path);
                    
                    // shell.openPath 返回空字符串表示成功，返回错误信息表示失败
                    if (openError && openError !== '' && openError !== true) {
                        console.error('[openProjectFile] 系统打开失败:', openError);
                        return { 
                            success: false, 
                            error: `打开文件失败: ${openError}`,
                            filePath: fileToOpen.path
                        };
                    }
                    
                    console.log('[openProjectFile] 系统打开命令已发送');
                    
                    // 立即返回成功，不等待 Photoshop 完全加载
                    return { 
                        success: true, 
                        message: `✅ 正在打开: ${fileToOpen.name}`,
                        openedFile: fileToOpen.name,
                        filePath: fileToOpen.path
                    };
                } catch (shellError: any) {
                    console.error('[openProjectFile] 系统打开异常:', shellError);
                    return {
                        success: false,
                        error: `打开文件失败: ${shellError?.message || shellError}`,
                        filePath: fileToOpen.path
                    };
                }
                
            case 'getResourcesByCategory':
                const categories = await designEcho.getResourcesByCategory?.(params.directory);
                return { success: true, categories: categories || {} };
                
            case 'analyzeAssetContent': {
                const assetResult = await window.designEcho.invoke('resource:analyzeAsset', params.imagePath || params.path || '');
                // 素材观察不应使用后丢弃；把可见卖点提醒给后续分屏规划，并将确认后的结论写入项目状态。
                const sellingPointObservations = assetResult?.analysis?.sellingPointObservations;
                if (assetResult?.success && Array.isArray(sellingPointObservations) && sellingPointObservations.length > 0) {
                    return {
                        ...assetResult,
                        sellingPointObservationNotice: '本图包含卖点观察（sellingPointObservations）。多张素材分析后，用 updateDesignProjectState.upsertFacts 写入来源为 project_asset_observation 的事实候选；未经用户确认或可靠来源支持前只能待复核。'
                    };
                }
                return assetResult;
            }
                
            case 'describeImage':
                // describeImage 与 analyzeAssetContent 功能一致，参数名不同
                return await window.designEcho.invoke('resource:analyzeAsset', params.filePath || params.imagePath || params.path || '');

            case 'recommendAssets':
                return await window.designEcho.invoke('resource:recommendAssets', {
                    requirement: params.requirement || params.query || '',
                    maxResults: params.maxResults || 5,
                    category: params.category,
                    designRole: params.designRole,
                    placementIntent: params.placementIntent,
                    deterministic: params.deterministic === true
                });

            case 'measureReferenceComposition':
                return await window.designEcho.invoke('resource:measureComposition', params.imagePath || params.path || '');

            case 'analyzeProjectForDetailPage': {
                // 详情页素材分析：聚合项目扫描 + 分类，输出可直接用于内容规划的素材清单
                let projectDir = params.projectPath || params.directory;
                if (!projectDir) {
                    const currentProject = useAppStore.getState().currentProject;
                    projectDir = currentProject?.path;
                }
                if (!projectDir) {
                    return {
                        success: false,
                        error: '素材分析失败：没有项目路径。请先在项目管理中打开项目，或在参数中提供 projectPath。'
                    };
                }
                await designEcho.setProjectRoot?.(projectDir);

                // getResourceSummary 内部也会扫描并重新分类；这里已经需要完整分类结果，
                // 直接从同一份分类构造摘要，避免一次详情页前置观察触发三遍目录扫描。
                const categorized = await designEcho.getResourcesByCategory(projectDir);
                if (!categorized) {
                    return {
                        success: false,
                        error: `素材分析失败：无法扫描项目目录 ${projectDir}，请检查目录是否存在且可读。`
                    };
                }

                const describeFiles = (files: any[], limit: number) =>
                    (Array.isArray(files) ? files : []).slice(0, limit).map((f: any) => ({
                        name: f.name,
                        path: f.path,
                        relativePath: f.relativePath,
                        ...(Number(f.size) > 0 ? { sizeBytes: Number(f.size) } : {}),
                        ...(Number(new Date(f.modifiedTime).getTime()) > 0
                            ? { modifiedTimeMs: Number(new Date(f.modifiedTime).getTime()) }
                            : {}),
                        ...(f.dimensions ? { dimensions: f.dimensions } : {})
                    }));

                const categories = {
                    products: describeFiles(categorized.products, 20),
                    backgrounds: describeFiles(categorized.backgrounds, 10),
                    elements: describeFiles(categorized.elements, 10),
                    references: describeFiles(categorized.references, 10),
                    others: describeFiles(categorized.others, 6)
                };
                const counts = {
                    products: categorized.products?.length || 0,
                    backgrounds: categorized.backgrounds?.length || 0,
                    elements: categorized.elements?.length || 0,
                    references: categorized.references?.length || 0,
                    others: categorized.others?.length || 0
                };
                const total = Object.values(counts).reduce((a, b) => a + b, 0);
                const summary = `项目素材共 ${total} 个：产品图 ${counts.products}、背景 ${counts.backgrounds}、元素 ${counts.elements}、参考 ${counts.references}、其他 ${counts.others}。`;

                const analysisResult = {
                    success: true,
                    projectPath: projectDir,
                    counts,
                    categories,
                    summary,
                    message: total > 0
                        ? `项目素材分析完成：共 ${total} 个素材（产品图 ${counts.products}、背景 ${counts.backgrounds}、元素 ${counts.elements}、参考 ${counts.references}）。各分类已列出文件路径，可用 describeImage 进一步理解单图内容，placeImage/replaceLayerContent 置入。`
                        : `项目目录 ${projectDir} 中没有找到可用图片素材。请确认素材已放入项目目录，或让用户提供素材位置。`
                };
                registerTrustedDetailPageProjectAssetAnalysis(
                    analysisResult,
                    buildTrustedDetailPageProjectAssets(categories),
                    projectDir
                );
                return analysisResult;
            }

            case 'getDesignProjectState': {
                const stateProjectPath = params.projectPath || useAppStore.getState().currentProject?.path;
                if (!stateProjectPath) {
                    return { success: false, error: '读取设计项目状态失败：没有项目路径。请先打开项目，或在参数中提供 projectPath。' };
                }
                const response = await designEcho.getDesignState(stateProjectPath);
                if (response?.success !== true) return response;
                const interactiveCards: InteractiveCardDefinition[] = [];
                if (params.includeFactReviewCard === true) {
                    const factReviewCard = buildDesignProjectFactReviewCard({
                        state: response.state,
                        projectIdentity: stateProjectPath
                    });
                    if (factReviewCard) interactiveCards.push(factReviewCard);
                }
                if (params.includeRuleReviewCard === true) {
                    const ruleReviewCard = buildDesignProjectRuleReviewCard({
                        state: response.state,
                        projectIdentity: stateProjectPath
                    });
                    if (ruleReviewCard) interactiveCards.push(ruleReviewCard);
                }
                return interactiveCards.length > 0 ? { ...response, interactiveCards } : response;
            }

            case 'updateDesignProjectState': {
                const stateProjectPath = params.projectPath || useAppStore.getState().currentProject?.path;
                if (!stateProjectPath) {
                    return { success: false, error: '更新设计项目状态失败：没有项目路径。请先打开项目，或在参数中提供 projectPath。' };
                }
                const patch = {
                    set: params.set && typeof params.set === 'object' ? params.set : undefined,
                    upsertFacts: Array.isArray(params.upsertFacts) ? params.upsertFacts : undefined,
                    upsertRules: Array.isArray(params.upsertRules) ? params.upsertRules : undefined,
                    appendLearning: typeof params.appendLearning === 'string' ? params.appendLearning : undefined,
                    appendVersion: params.appendVersion && typeof params.appendVersion === 'object' ? params.appendVersion : undefined,
                    factWriteAuthority: 'agent_proposal' as const,
                    ruleWriteAuthority: 'agent_proposal' as const,
                    updatedBy: typeof params.updatedBy === 'string' ? params.updatedBy : 'autonomous-agent'
                };
                if (!patch.set && !patch.upsertFacts && !patch.upsertRules && !patch.appendLearning && !patch.appendVersion) {
                    return { success: false, error: '更新设计项目状态失败：patch 为空。请提供 set、upsertFacts、upsertRules、appendLearning 或 appendVersion。' };
                }
                return await designEcho.updateDesignState(stateProjectPath, patch);
            }

            case 'searchEagleReferences': {
                // Eagle 创意参考检索（R0 参考源：只读、标记来源、防照抄；离线优雅降级）
                const eagleKeyword = String(params.query || '').trim();
                if (!eagleKeyword) {
                    return { success: false, error: 'Eagle 参考检索失败：请提供搜索关键词（query）。' };
                }
                const eagleQuery = {
                    query: eagleKeyword,
                    limit: Math.min(Math.max(Number(params.limit) || 8, 1), 20),
                    preferAiSearch: params.preferAiSearch !== false,
                    ...(Array.isArray(params.tags) ? { tags: params.tags.map(String) } : {}),
                    ...(Array.isArray(params.folders) ? { folders: params.folders.map(String) } : {}),
                    ...(params.ext ? { ext: String(params.ext) } : {}),
                    ...(params.selectedOnly === true ? { selectedOnly: true } : {})
                };
                const eagleResponse = await designEcho.invoke('designKnowledge:searchEagleReadonly', eagleQuery);
                const eagleOk = eagleResponse?.status === 'ok'
                    && Array.isArray(eagleResponse?.results)
                    && eagleResponse.results.length > 0;
                if (!eagleOk) {
                    const eagleStatus = eagleResponse?.status || 'unavailable';
                    const eagleWarnings = (eagleResponse?.warnings || []).join('；');
                    const noResults = eagleResponse?.status === 'ok'
                        && Array.isArray(eagleResponse?.results)
                        && eagleResponse.results.length === 0;
                    // 把工具的真实状态如实反馈给 Agent，并给出可自主决策的下一步——不替它做决定。
                    let agentHint = '这是工具/环境状态问题（通常是 Eagle 未运行，或未在 Eagle 偏好设置启用 MCP Server，默认端口 41596），不是参数用法问题。你可以稍后重试一次，或按 Skill 参考策略选择其他来源。';
                    if (noResults) {
                        agentHint = 'Eagle 服务正常，但当前关键词没有命中。请调整一次检索表达或使用其他允许的参考来源；不要把空结果当成有效参考。';
                    } else if (eagleStatus === 'disabled') {
                        agentHint = 'Eagle 只读参考连接器当前被禁用。可在设置中启用，或按 Skill 参考策略选择其他来源。';
                    }
                    return {
                        success: false,
                        status: noResults ? 'no_results' : eagleStatus,
                        error: eagleWarnings
                            || (noResults
                                ? `Eagle 中没有找到“${eagleKeyword}”的参考候选。请调整关键词或使用其他参考源。`
                                : 'Eagle 参考检索不可用：请确认 Eagle（4.0+）正在运行，并已在 Eagle 偏好设置中启用 MCP Server（默认端口 41596）。'),
                        agentHint
                    };
                }
                const eagleDispositionSelection = getMemoryService()
                    .applyDesignKnowledgeDispositions(eagleResponse.results);
                const eagleResults = eagleDispositionSelection.visibleResults;
                // 分面视图：让模型看见这批候选可按哪些维度收敛。库里条目的标题多是电商商品名，
                // 只做关键词全文搜索永远命中同品类竞品图；tags 分面过滤的能力一直都在，
                // 缺的是"有哪些维度可选"这个信息。
                const eagleFacetSummary = buildEagleReferenceFacetSummary(eagleResults);
                return {
                    success: true,
                    status: 'ok',
                    query: eagleKeyword,
                    resultCount: eagleResults.length,
                    results: eagleResults,
                    availableFacets: eagleFacetSummary.facets,
                    ...(eagleFacetSummary.refinementHint
                        ? { refinementHint: eagleFacetSummary.refinementHint }
                        : {}),
                    knowledgeUsageSnapshot: selectDesignKnowledgeResultsForUse(eagleResults, {
                        query: eagleKeyword,
                        purpose: 'planning'
                    }).snapshot,
                    warnings: [
                        ...(eagleResponse.warnings || []),
                        ...(eagleDispositionSelection.disabledResults.length > 0
                            ? [`已按用户治理决定过滤 ${eagleDispositionSelection.disabledResults.length} 条 Eagle 参考。`]
                            : [])
                    ],
                    boundaries: eagleResponse.boundaries,
                    candidateMetadataOnly: true,
                    countsAsVisualUnderstanding: false,
                    message: `Eagle 参考检索完成：${eagleResults.length} 条可用候选。结果仅作灵感与方向参考，引用时必须标注来源（Eagle 素材库），禁止照抄复刻。`
                };
            }

            case 'analyzeEagleReference': {
                const itemId = String(params.itemId || params.id || '').trim().replace(/^eagle:/i, '');
                if (!itemId) {
                    return {
                        success: false,
                        error: 'Eagle 参考视觉分析失败：请提供 searchEagleReferences 返回的 item id。'
                    };
                }
                return await designEcho.invoke('designKnowledge:analyzeEagleReference', {
                    itemId,
                    ...(Array.isArray(params.topics) ? { topics: params.topics.map(String) } : {})
                });
            }

            case 'getDesignKnowledge': {
                const {
                    buildDesignArtifactKnowledgeSummary,
                    resolveDesignArtifactKnowledgeByText,
                    getDesignArtifactKnowledge,
                    listDesignArtifactFocusValues,
                    listDesignArtifactIds
                } = await import('../../shared/knowledge/design-artifact-knowledge');
                const requested = String(params.artifact || '').trim();
                // 先按 id 精确取；取不到再按用户原话匹配别名，仍不中则落 generic 底座。
                const knowledge = getDesignArtifactKnowledge(requested)
                    || resolveDesignArtifactKnowledgeByText(requested);
                const focusValues = listDesignArtifactFocusValues(knowledge.artifactId);
                const focus = focusValues.includes(String(params.focus || '')) ? String(params.focus) : 'all';
                const framework = buildDesignArtifactKnowledgeSummary(knowledge.artifactId, focus);
                const knowledgeRecord = buildBundledKnowledgeArtifactRecord({
                    id: `design-artifact-knowledge:${knowledge.artifactId}:${focus}`,
                    title: `${knowledge.displayName}设计方法论：${focus}`,
                    summary: JSON.stringify(framework),
                    sourceRevision: 'design-artifact-knowledge-v1'
                });
                return {
                    success: true,
                    artifact: knowledge.artifactId,
                    displayName: knowledge.displayName,
                    // 如实告知这份方法论是用户既定规范还是通用实践，模型据此决定可否当验收依据。
                    provenance: knowledge.provenance,
                    matchedByFallback: knowledge.artifactId === 'generic' && requested.length > 0,
                    focus,
                    framework,
                    knowledgeGovernance: knowledgeRecord.governance,
                    knowledgeUsageSnapshot: knowledgeRecord.usageSnapshot,
                    availableFocus: focusValues,
                    availableArtifacts: listDesignArtifactIds()
                };
            }

            case 'getMainImageDesignFramework': {
                const { buildMainImageFrameworkSummary, MAIN_IMAGE_FRAMEWORK_FOCUS_VALUES } =
                    await import('../../shared/knowledge/main-image-framework');
                const focus = MAIN_IMAGE_FRAMEWORK_FOCUS_VALUES.includes(params.focus) ? params.focus : 'overview';
                const framework = buildMainImageFrameworkSummary(focus);
                const knowledgeRecord = buildBundledKnowledgeArtifactRecord({
                    id: `main-image-framework:${focus}`,
                    title: `主图设计方法论：${focus}`,
                    summary: JSON.stringify(framework),
                    sourceRevision: 'main-image-framework-v1'
                });
                return {
                    success: true,
                    focus,
                    framework,
                    knowledgeGovernance: knowledgeRecord.governance,
                    knowledgeUsageSnapshot: knowledgeRecord.usageSnapshot,
                    availableFocus: MAIN_IMAGE_FRAMEWORK_FOCUS_VALUES
                };
            }

            case 'getDetailPageDesignFramework': {
                const { buildDetailPageFrameworkSummary, DETAIL_PAGE_FRAMEWORK_FOCUS_VALUES } =
                    await import('../../shared/knowledge/detail-page-framework');
                const focus = DETAIL_PAGE_FRAMEWORK_FOCUS_VALUES.includes(params.focus) ? params.focus : 'overview';
                const framework = buildDetailPageFrameworkSummary(focus);
                const knowledgeRecord = buildBundledKnowledgeArtifactRecord({
                    id: `detail-page-framework:${focus}`,
                    title: `详情页设计方法论：${focus}`,
                    summary: JSON.stringify(framework),
                    sourceRevision: 'detail-page-framework-v1'
                });
                return {
                    success: true,
                    focus,
                    framework,
                    knowledgeGovernance: knowledgeRecord.governance,
                    knowledgeUsageSnapshot: knowledgeRecord.usageSnapshot,
                    availableFocus: DETAIL_PAGE_FRAMEWORK_FOCUS_VALUES
                };
            }

            case 'getDesignPrinciples': {
                const { buildDesignPrinciplesSummary, DESIGN_PRINCIPLE_FOCUS_VALUES } =
                    await import('../../shared/knowledge/design-principles');
                const focus = DESIGN_PRINCIPLE_FOCUS_VALUES.includes(params.focus) ? params.focus : 'all';
                const principles = buildDesignPrinciplesSummary(focus);
                const knowledgeRecord = buildBundledKnowledgeArtifactRecord({
                    id: `design-principles:${focus}`,
                    title: `通用设计原则：${focus}`,
                    summary: JSON.stringify(principles),
                    sourceRevision: 'design-principles-v1'
                });
                return {
                    success: true,
                    focus,
                    principles,
                    knowledgeGovernance: knowledgeRecord.governance,
                    knowledgeUsageSnapshot: knowledgeRecord.usageSnapshot,
                    availableFocus: DESIGN_PRINCIPLE_FOCUS_VALUES
                };
            }

            case 'declareDesignIntent': {
                // 本地 Tool 只传输模型的结构化声明，不在这里维护第二份 taskType/workMode
                // 合法性。唯一 Runtime Resolver 会在同一 TaskRun 提交边界校验 Profile、
                // Manifest、Evaluation、Capability 与模式组合；本结果本身不授权也不激活。
                const taskTypeId = String(params.taskTypeId || '').trim();
                const rationale = String(params.rationale || '').trim();
                const requestedWorkMode = String(params.workMode || '').trim();
                return {
                    success: true,
                    taskTypeId,
                    ...(rationale ? { rationale } : {}),
                    data: {
                        declaredDesignTaskTypeId: taskTypeId,
                        ...(requestedWorkMode
                            ? { declaredDesignWorkMode: requestedWorkMode }
                            : {})
                    },
                    boundaries: {
                        identityOnly: true,
                        validatedByRuntimeResolver: false,
                        knowledgeInjectedByRuntimeCompiler: true,
                        grantsPermission: false,
                        provesCompletion: false
                    },
                    message: '已接收设计 Runtime 声明，等待同一 TaskRun 的 Resolver 校验与绑定。'
                };
            }

            case 'searchDesignKnowledge': {
                const kgQuery = String(params.query || '').trim();
                if (!kgQuery) {
                    return { success: false, error: '设计知识检索失败：请提供检索词（query），描述你要做的设计。' };
                }
                const knowledgeQuery = {
                    query: kgQuery,
                    ...(Array.isArray(params.intents) ? { intents: params.intents.map(String) } : {}),
                    ...(Array.isArray(params.sourceTypes) ? { sourceTypes: params.sourceTypes.map(String) } : {}),
                    limit: Math.min(Math.max(Number(params.limit) || 6, 1), 20)
                };
                const knowledgeSettings = useAppStore.getState().designKnowledgeSettings;
                const kgResponse = await designEcho.invoke(
                    'designKnowledge:search',
                    knowledgeQuery,
                    knowledgeSettings
                );
                if (!kgResponse?.success || !Array.isArray(kgResponse?.results)) {
                    return {
                        success: false,
                        error: kgResponse?.error
                            || (kgResponse?.warnings || []).join('；')
                            || '设计知识检索不可用。'
                    };
                }
                const memory = getMemoryService();
                const knowledgeProjectId = useAppStore.getState().currentProject?.id;
                const learnedResults = memory.getDesignKnowledgeResults(knowledgeQuery, {
                    scope: knowledgeProjectId
                        ? { type: 'project', id: knowledgeProjectId }
                        : { type: 'user' }
                });
                const mergedById = new Map<string, DesignKnowledgeResult>();
                for (const result of [...kgResponse.results, ...learnedResults]) {
                    mergedById.set(`${result.sourceType}:${result.id}`, result);
                }
                const dispositionSelection = memory.applyDesignKnowledgeDispositions(
                    Array.from(mergedById.values())
                );
                const governedSelection = selectDesignKnowledgeResultsForUse(
                    dispositionSelection.visibleResults,
                    { query: kgQuery, purpose: 'planning' }
                );
                const results = governedSelection.usableResults;
                return {
                    success: true,
                    query: kgQuery,
                    resultCount: results.length,
                    results,
                    knowledgeUsageSnapshot: governedSelection.snapshot,
                    warnings: [
                        ...(kgResponse.warnings || []),
                        ...(dispositionSelection.disabledResults.length > 0
                            ? [`已按用户治理决定过滤 ${dispositionSelection.disabledResults.length} 条知识。`]
                            : [])
                    ],
                    message: `设计知识检索完成：${results.length} 条当前有效参考（含已复核长期知识）。把它们当设计依据落到构图、配色、文案里；引用 web 来源要标注出处，只学风格方向，禁止照抄复刻他人成品。`
                };
            }

            default:
                return { success: false, error: `未知资源工具: ${toolName}` };
        }
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

// ==================== 设计参考搜索 ====================

/**
 * 执行设计参考搜索（花瓣/站酷/Behance/Pinterest）
 */
async function executeSearchDesigns(params: {
    query: string;
    platform?: 'huaban' | 'zcool' | 'behance' | 'pinterest' | 'all';
    limit?: number;
}): Promise<any> {
    const query = (params?.query || '').trim();
    if (!query) {
        return { success: false, error: '请提供搜索关键词', message: '❌ 缺少搜索关键词' };
    }

    try {
        const invoke = (window as any).designEcho?.invoke;
        if (!invoke) {
            return { success: false, error: 'designEcho.invoke 不可用' };
        }

        const raw = await invoke('mcp:searchDesigns', {
            query,
            platform: params.platform || 'all',
            limit: params.limit || 10
        });

        if (!Array.isArray(raw) || raw.length === 0) {
            return {
                success: true,
                message: `未找到与「${query}」相关的设计参考`,
                results: [],
                total: 0
            };
        }

        const results: any[] = [];
        for (const p of raw) {
            const works = p?.works || [];
            if (works.length) {
                results.push(...works.map((w: any) => ({ ...w, platform: p.platform || w.platform })));
            }
        }

        const platformNames: Record<string, string> = {
            huaban: '花瓣',
            zcool: '站酷',
            behance: 'Behance',
            pinterest: 'Pinterest'
        };

        return {
            success: true,
            message: `找到 ${results.length} 个与「${query}」相关的设计参考`,
            results,
            total: results.length,
            platformSummary: [...new Set(results.map((r: any) => platformNames[r.platform] || r.platform))].join('、')
        };
    } catch (error: any) {
        console.error('[searchDesigns] 失败:', error);
        return {
            success: false,
            error: error?.message || '搜索失败',
            message: `❌ 设计参考搜索失败: ${error?.message || '未知错误'}`
        };
    }
}

/**
 * 执行网页内容提取（Playwright）
 */
async function executeFetchWebPageDesignContent(params: {
    url: string;
    extractImages?: boolean;
    maxTextLength?: number;
}): Promise<any> {
    const url = (params?.url || '').trim();
    if (!url) {
        return { success: false, error: '请提供网页 URL', message: '❌ 缺少 URL' };
    }

    try {
        const invoke = (window as any).designEcho?.invoke;
        if (!invoke) {
            return { success: false, error: 'designEcho.invoke 不可用' };
        }

        const data = await invoke('web:fetchPageDesignContent', {
            url,
            extractImages: params.extractImages !== false,
            maxTextLength: params.maxTextLength
        });

        if (data?.success) {
            return {
                success: true,
                url: data.url,
                title: data.title,
                description: data.description,
                textContent: data.textContent,
                images: data.images,
                message: `✅ 已获取网页内容: ${data.title || url}`
            };
        }

        return {
            success: false,
            error: data?.error || '访问失败',
            message: `❌ 无法获取网页内容: ${data?.error || '未知错误'}`
        };
    } catch (error: any) {
        console.error('[fetchWebPageDesignContent] 失败:', error);
        return {
            success: false,
            error: (error as Error)?.message || '访问失败',
            message: `❌ 网页内容提取失败: ${(error as Error)?.message || '未知错误'}`
        };
    }
}

// ==================== 浏览器扩展工具 ====================

/** Agent 工具名 → 扩展方法名（协议见 docs/browser-extension-bridge.md） */
const BROWSER_BRIDGE_TOOL_METHODS: Record<string, string> = {
    listBrowserTabs: 'browser.listTabs',
    readBrowserPage: 'browser.readPage',
    captureBrowserTab: 'browser.capture',
    navigateBrowserTab: 'browser.navigate',
    interactWithBrowserPage: 'browser.interact'
};

/**
 * 执行浏览器扩展工具：经主进程桥转发到用户浏览器扩展。
 * 失败信息面向模型（中文、指路），扩展未连接会明确告知如何安装/启用。
 */
async function executeBrowserBridgeTool(toolName: string, params: any): Promise<any> {
    const method = BROWSER_BRIDGE_TOOL_METHODS[toolName];
    if (!method) {
        return { success: false, error: `未知浏览器工具: ${toolName}` };
    }
    const invoke = (window as any).designEcho?.invoke;
    if (!invoke) {
        return { success: false, error: 'designEcho.invoke 不可用（渲染进程桥未就绪）' };
    }
    try {
        const data = await invoke('browserBridge:call', { method, params: params || {} });
        if (data?.success) {
            return { ...data, message: data.message || `✅ 浏览器操作完成: ${toolName}` };
        }
        return {
            success: false,
            error: data?.error || '浏览器操作失败',
            message: `❌ ${data?.error || '浏览器操作失败'}`
        };
    } catch (error: any) {
        console.error(`[${toolName}] 失败:`, error);
        return {
            success: false,
            error: (error as Error)?.message || '浏览器操作失败',
            message: `❌ 浏览器操作失败: ${(error as Error)?.message || '未知错误'}`
        };
    }
}

// ==================== AI 图片生成 ====================

async function executeImageGeneration(params: {
    prompt: string;
    model?: string;
    width?: number;
    height?: number;
}): Promise<any> {
    const prompt = String(params?.prompt || '').trim();
    const model = String(params?.model || 'flux-2-max');
    const width = Number.isFinite(Number(params?.width)) ? Number(params.width) : 1024;
    const height = Number.isFinite(Number(params?.height)) ? Number(params.height) : 1024;

    if (!prompt) {
        return {
            success: false,
            error: '缺少图片描述',
            message: '请先说明要生成什么画面。'
        };
    }

    try {
        const hasApiKey = await window.designEcho.bfl.hasApiKey();
        if (!hasApiKey) {
            return {
                success: false,
                error: '未配置 BFL API Key',
                message: '请先在设置的「API 密钥」中配置 Black Forest Labs API Key。'
            };
        }

        const generation = await window.designEcho.bfl.text2image(model, prompt, { width, height });
        if (!generation?.success || !generation?.data?.url) {
            return {
                success: false,
                error: generation?.error || '图片生成失败',
                message: `图片生成没有完成：${generation?.error || '服务没有返回图片。'}`
            };
        }

        const download = await window.designEcho.bfl.downloadImage(generation.data.url);
        if (!download?.success || !download?.data) {
            return {
                success: true,
                message: '图片已经生成，但本地下载没有完成。请在链接失效前查看或保存。',
                imageUrl: generation.data.url,
                width: generation.data.width,
                height: generation.data.height
            };
        }

        return {
            success: true,
            message: '图片已经生成，请先查看效果，再决定是否放入设计。',
            imageData: download.data,
            imageUrl: generation.data.url,
            width: generation.data.width,
            height: generation.data.height,
            model
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误';
        return {
            success: false,
            error: message,
            message: `图片生成没有完成：${message}`
        };
    }
}

function summarizeToolResultForModel(result: any): string {
    if (result === null || result === undefined) return '无返回结果';
    if (typeof result === 'string') return sanitizeForToolSummary(result, 500);
    if (typeof result !== 'object') return String(result);

    const parts: string[] = [];
    const success = result.success !== false;
    parts.push(success ? '执行成功' : '执行失败');

    if (typeof result.message === 'string' && result.message.trim()) {
        parts.push(`消息：${sanitizeForToolSummary(result.message, 300)}`);
    }
    if (typeof result.error === 'string' && result.error.trim()) {
        parts.push(`错误：${sanitizeForToolSummary(result.error, 300)}`);
    }
    if (typeof result.acceptance?.summaryText === 'string') {
        parts.push(sanitizeForToolSummary(result.acceptance.summaryText, 300));
    }

    const scalarFields = ['name', 'documentName', 'layerName', 'count', 'totalLayers', 'width', 'height', 'path'];
    for (const key of scalarFields) {
        const value = result[key];
        if (value === null || value === undefined || typeof value === 'object') continue;
        parts.push(`${key}=${sanitizeForToolSummary(String(value), 160)}`);
    }

    return parts.join('；');
}

function sanitizeForToolSummary(value: string, maxLength: number): string {
    const cleaned = sanitizeUserVisibleDiagnosticText(value).trim() || '处理细节已收起';
    return truncateForToolSummary(cleaned, maxLength);
}

function truncateForToolSummary(value: string, maxLength: number): string {
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

/**
 * 清理 AI 响应文本
 */
export const cleanAIResponse = (text: string): string => {
    const toolNames = AVAILABLE_TOOLS.map(t => t.name).join('|');
    
    return text
        .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
        .replace(/CALL:\s*\w+\s*\(\{[\s\S]*?\}\)/g, '')
        .replace(/```json[\s\S]*?```/g, '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(new RegExp(`(?:${toolNames})\\s*\\([^)]*\\)`, 'gi'), '')
        .replace(/我将调用\s*\w+\s*来[\s\S]*?。/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
};

/**
 * 解析工具调用
 * @param text AI 返回的文本
 * @param userInput 可选的用户输入（用于意图推断，目前未使用）
 */
export const parseToolCalls = (text: string, userInput?: string): { toolName: string; params: any }[] => {
    const calls: { toolName: string; params: any }[] = [];
    
    // 匹配标准格式: CALL: toolName({params})
    const callRegex = /CALL:\s*(\w+)\s*\(\s*(\{[\s\S]*?\})\s*\)/g;
    let match;
    
    while ((match = callRegex.exec(text)) !== null) {
        try {
            const toolName = match[1];
            const params = JSON.parse(match[2]);
            calls.push({ toolName, params });
        } catch (e) {
            console.warn('[parseToolCalls] 解析失败:', match[0]);
        }
    }
    
    // 匹配 tool_call 标签格式
    const tagRegex = /<tool_call>\s*(\w+)\s*\(\s*(\{[\s\S]*?\})\s*\)\s*<\/tool_call>/g;
    while ((match = tagRegex.exec(text)) !== null) {
        try {
            calls.push({ toolName: match[1], params: JSON.parse(match[2]) });
        } catch (e) {
            console.warn('[parseToolCalls] 标签解析失败');
        }
    }
    
    return calls;
};

/**
 * 获取工具列表字符串（用于 AI Prompt）
 */
export const getToolsListString = (): string => {
    const photoshopSkillGuidance = buildPhotoshopToolSkillPromptSection(AVAILABLE_TOOLS.map((tool) => tool.name));

    const toolList = AVAILABLE_TOOLS
        .filter((tool) => tool.name !== 'removeBackground')
        .map(t => `- ${t.name}: ${t.description}`)
        .join('\n');

    return `${photoshopSkillGuidance}\n\n${toolList}`;
};

// ==================== 详情页内容匹配 ====================


/**
 * 从嵌套 folders 结构中递归收集所有图片
 */
function flattenFolderImages(folders: any[]): any[] {
    const images: any[] = [];
    const walk = (items: any[]) => {
        for (const folder of items || []) {
            if (Array.isArray(folder?.images)) {
                images.push(...folder.images);
            }
            if (Array.isArray(folder?.children)) {
                walk(folder.children);
            }
        }
    };
    walk(folders);
    return images;
}

/** 路径归一化为匹配键（正斜杠、去重复分隔符、小写），与 main-image.executor 的口径一致。 */
function normalizeDetailAssetPathKey(value: unknown): string {
    return String(value || '').trim().replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
}

function joinDetailProjectRelativePath(projectPath: string, relativePath: string): string {
    const root = String(projectPath || '').trim().replace(/\\/g, '/').replace(/\/+$/g, '');
    const relative = String(relativePath || '').trim().replace(/\\/g, '/').replace(/^\/+/g, '');
    if (!root) return relative;
    if (!relative) return root;
    return `${root}/${relative}`;
}

/**
 * 同一详情页执行中的候选视觉观察账本。按业务执行器传入的库存对象身份复用，
 * 不持久化、不跨任务、也不接受 JSON 中伪造的 observation receipt。
 */
const detailPageContactSheetObservationByInventory = new WeakMap<
    object,
    Map<string, DetailAssetVisionSignal>
>();

type TrustedDetailPageProjectAssets = { images: DetailProjectAsset[] };

/**
 * 真实 analyzeProjectForDetailPage 结果与其库存对象的进程内身份 receipt。
 * 模型只能回传 JSON 副本，无法命中 WeakMap；因此不能借 projectAssets 注入任意路径。
 */
const trustedDetailPageProjectAssetReceipt = new WeakMap<object, string>();
const trustedDetailPageProjectAssetsByAnalysis = new WeakMap<object, TrustedDetailPageProjectAssets>();

function buildTrustedDetailPageProjectAssets(categories: Record<string, any[]>): TrustedDetailPageProjectAssets {
    const categoryTypes: Array<[string, string]> = [
        ['products', 'product'],
        ['backgrounds', 'scene'],
        ['elements', 'icon'],
        ['references', 'unknown'],
        ['others', 'unknown']
    ];
    const byPath = new Map<string, DetailProjectAsset>();
    for (const [category, type] of categoryTypes) {
        for (const file of Array.isArray(categories?.[category]) ? categories[category] : []) {
            const filePath = String(file?.path || '').trim();
            if (!filePath || byPath.has(filePath)) continue;
            const width = Number(file?.width || file?.dimensions?.width || 0);
            const height = Number(file?.height || file?.dimensions?.height || 0);
            const sizeBytes = Number(file?.sizeBytes || file?.size || 0);
            const modifiedTimeMs = Number(file?.modifiedTimeMs || 0);
            byPath.set(filePath, {
                path: filePath,
                ...(file?.name ? { name: String(file.name) } : {}),
                ...(file?.relativePath ? { relativePath: String(file.relativePath) } : {}),
                ...(width > 0 ? { width } : {}),
                ...(height > 0 ? { height } : {}),
                ...(sizeBytes > 0 ? { sizeBytes } : {}),
                ...(modifiedTimeMs > 0 ? { modifiedTimeMs } : {}),
                type
            });
        }
    }
    return { images: Array.from(byPath.values()) };
}

function registerTrustedDetailPageProjectAssets(
    inventory: TrustedDetailPageProjectAssets,
    projectPath: string
): void {
    trustedDetailPageProjectAssetReceipt.set(inventory, normalizeDetailAssetPathKey(projectPath));
}

function registerTrustedDetailPageProjectAssetAnalysis(
    analysis: object,
    inventory: TrustedDetailPageProjectAssets,
    projectPath: string
): void {
    registerTrustedDetailPageProjectAssets(inventory, projectPath);
    trustedDetailPageProjectAssetsByAnalysis.set(analysis, inventory);
}

export function readTrustedDetailPageProjectAssetsFromAnalysis(
    analysis: unknown
): TrustedDetailPageProjectAssets | undefined {
    if (!analysis || typeof analysis !== 'object') return undefined;
    return trustedDetailPageProjectAssetsByAnalysis.get(analysis);
}

function isTrustedDetailPageProjectAssets(
    inventory: unknown,
    projectPath: string
): inventory is TrustedDetailPageProjectAssets {
    if (!inventory || typeof inventory !== 'object') return false;
    const receiptProjectPath = trustedDetailPageProjectAssetReceipt.get(inventory);
    return Boolean(receiptProjectPath)
        && receiptProjectPath === normalizeDetailAssetPathKey(projectPath);
}

function indexDetailAssetVisionSignal(
    index: Map<string, DetailAssetVisionSignal>,
    projectPath: string,
    file: { path?: string; relativePath?: string },
    signal: DetailAssetVisionSignal
): void {
    const keys = [
        normalizeDetailAssetPathKey(file?.path),
        normalizeDetailAssetPathKey(
            file?.relativePath ? joinDetailProjectRelativePath(projectPath, file.relativePath) : ''
        )
    ].filter(Boolean);
    for (const key of keys) index.set(key, signal);
}

async function observeDetailPageCandidatesWithContactSheet(input: {
    projectPath: string;
    inventoryOwner?: object;
    images: Array<{
        name?: string;
        path?: string;
        relativePath?: string;
        width?: number;
        height?: number;
        sizeBytes?: number;
        modifiedTimeMs?: number;
        hasAlpha?: boolean;
    }>;
    existingIndex: Map<string, DetailAssetVisionSignal>;
}): Promise<Map<string, DetailAssetVisionSignal>> {
    const index = new Map(input.existingIndex);
    if (!input.inventoryOwner || input.images.length === 0) return index;

    const memoized = detailPageContactSheetObservationByInventory.get(input.inventoryOwner);
    if (memoized) {
        for (const [key, signal] of memoized) {
            if (!index.has(key)) index.set(key, signal);
        }
        return index;
    }

    const unresolved = input.images.filter((image) => !findDetailAssetVisionSignal(index, image, input.projectPath));
    if (unresolved.length === 0 || typeof window.designEcho?.recommendAssets !== 'function') {
        return index;
    }

    try {
        if (input.projectPath && typeof window.designEcho?.setProjectRoot === 'function') {
            await window.designEcho.setProjectRoot(input.projectPath);
        }
        const recommendation = await window.designEcho.recommendAssets({
            requirement: '一次比较当前项目候选，识别详情页首屏主视觉、场景/上身、商品细节、材质证据、背景与装饰职责；区分白底原料、透明主体、场景图和已完成设计，不把所有图片都当首屏。',
            maxResults: Math.min(12, unresolved.length),
            deterministic: true,
            designRole: 'detail_page_inventory',
            placementIntent: '先分类素材职责和背景处理，再由每一屏的设计策略决定是否直接整图、容器剪切、去底重构、仅作辅图或拒绝。',
            candidateFiles: unresolved.map((image) => ({
                path: String(image.path || ''),
                name: image.name,
                relativePath: image.relativePath,
                sizeBytes: image.sizeBytes,
                modifiedTimeMs: image.modifiedTimeMs,
                width: image.width,
                height: image.height,
                dimensions: Number(image.width) > 0 && Number(image.height) > 0
                    ? { width: Number(image.width), height: Number(image.height) }
                    : undefined,
                hasAlpha: image.hasAlpha
            }))
        });
        const observed = new Map<string, DetailAssetVisionSignal>();
        for (const item of recommendation?.recommendations || []) {
            if (item?.visualObserved !== true || !item?.file?.path) continue;
            const signal: DetailAssetVisionSignal = {
                visualObserved: true,
                visualEvidenceId: `detail-page-contact-sheet:${String(item.visualEvidenceId || item.file.path)}`,
                visualRole: item.visualRole,
                ...(item.assetNature ? { assetNature: item.assetNature } : {}),
                backgroundType: item.backgroundType
            };
            indexDetailAssetVisionSignal(observed, input.projectPath, item.file, signal);
            indexDetailAssetVisionSignal(index, input.projectPath, item.file, signal);
        }
        detailPageContactSheetObservationByInventory.set(input.inventoryOwner, observed);
        console.log(
            `[ContentMatch] 冷缓存候选总览完成：1 次视觉比较，`
            + `${observed.size} 个路径键获得可复用观察；未观察候选保持 deferred。`
        );
    } catch (error) {
        console.warn('[ContentMatch] 候选总览视觉比较失败；未观察候选保持 deferred：', error);
        detailPageContactSheetObservationByInventory.set(input.inventoryOwner, new Map());
    }
    return index;
}

/**
 * 读取项目视觉理解缓存（.designecho/visual-insights-cache.json），
 * 建立「素材路径 → 视觉构图信号」索引供详情页选图打分使用。
 * 只读通道：ecommerce:readVisualInsightCache（只读该 JSON 文件，不扫描项目、不初始化、不写入项目配置）。
 * 同一素材路径可能同时存在 project-image-analysis:*（仅 productType/summary）与
 * project-visual:*（含构图字段）两类条目，按共享择优规则（信号富度优先）选条目，
 * 避免旧条目在前时构图信号被无声遮蔽——见 pickPreferredProjectVisualInsightCacheEntry。
 * 但择优前必须通过共享 freshness + 当前文件 assetVersion 校验；过期或文件已变化的条目不再按 path 复用。
 * 缓存缺失/失配/读取失败时返回空信号——Ranker 会把该素材视为未观察，由既有有界视觉刷新计划补看；
 * 刷新能力不可用时只延后该图片，不把整个详情页任务硬失败。
 */
async function buildDetailPageVisionSignalIndex(
    projectPath: string,
    projectAssets: Array<{
        path?: string;
        relativePath?: string;
        sizeBytes?: number;
        size?: number;
        modifiedTimeMs?: number;
        modifiedTime?: unknown;
        modified?: unknown;
    }>
): Promise<Map<string, DetailAssetVisionSignal>> {
    const index = new Map<string, DetailAssetVisionSignal>();
    if (!projectPath) return index;
    try {
        if (typeof window.designEcho?.readProjectVisualInsightCache !== 'function') {
            console.warn('[ContentMatch] 读取项目视觉理解缓存失败：preload 未暴露 readProjectVisualInsightCache（应用可能仍在运行旧版 preload，需重启加载；本轮选图 visionFit 保持中性，不影响其余打分维度）');
            return index;
        }
        const readResult = await window.designEcho.readProjectVisualInsightCache({ projectPath });
        const entries = readResult?.entries;
        if (!Array.isArray(entries)) return index;
        const currentAssetByKey = new Map<string, {
            modifiedTimeMs?: number;
            sizeBytes?: number;
        }>();
        for (const asset of projectAssets || []) {
            const rawModifiedTime = asset?.modifiedTimeMs || asset?.modifiedTime || asset?.modified;
            const numericModifiedTime = Number(rawModifiedTime);
            const parsedModifiedTime = Number.isFinite(numericModifiedTime) && numericModifiedTime > 0
                ? numericModifiedTime
                : Date.parse(String(rawModifiedTime || ''));
            const sizeBytes = Number(asset?.sizeBytes || asset?.size || 0);
            const assetVersion = {
                ...(Number.isFinite(parsedModifiedTime) && parsedModifiedTime > 0 ? { modifiedTimeMs: parsedModifiedTime } : {}),
                ...(Number.isFinite(sizeBytes) && sizeBytes > 0 ? { sizeBytes } : {})
            };
            for (const key of [
                asset?.path,
                asset?.relativePath ? joinDetailProjectRelativePath(projectPath, asset.relativePath) : ''
            ].map(normalizeDetailAssetPathKey)) {
                if (key) currentAssetByKey.set(key, assetVersion);
            }
        }
        const preferredEntryByKey = new Map<string, ProjectVisualSamplingCacheEntry>();
        const nowMs = Date.now();
        for (const entry of entries) {
            const insight = entry?.insight;
            if (!insight || typeof insight !== 'object') continue;
            const composition = normalizeProjectVisualInsightCompositionFields(insight as unknown as Record<string, unknown>);
            const productType = String((insight as any).productType || '').trim();
            if (
                !composition.assetNature
                && !composition.shotType
                && !composition.backgroundType
                && !composition.mainImageSuitability
                && !composition.subjectCoverageRatio
                && !productType
            ) continue;
            for (const key of [entry?.path, (insight as any)?.path].map(normalizeDetailAssetPathKey)) {
                if (!key) continue;
                const currentAssetVersion = currentAssetByKey.get(key);
                if (!projectVisualCacheEntryMatchesCurrentAsset({
                    entry,
                    assetVersion: currentAssetVersion,
                    nowMs
                })) continue;
                preferredEntryByKey.set(key, pickPreferredProjectVisualInsightCacheEntry(preferredEntryByKey.get(key), entry));
            }
        }
        for (const [key, entry] of preferredEntryByKey) {
            const insight = entry.insight as unknown as Record<string, unknown>;
            const composition = normalizeProjectVisualInsightCompositionFields(insight);
            const productType = String(insight.productType || '').trim();
            const signal: DetailAssetVisionSignal = {
                visualObserved: true,
                ...((entry as any).cacheKey ? { visualEvidenceId: String((entry as any).cacheKey) } : {}),
                ...(composition.assetNature ? { assetNature: composition.assetNature } : {}),
                ...(composition.shotType ? { shotType: composition.shotType } : {}),
                ...(composition.backgroundType ? { backgroundType: composition.backgroundType } : {}),
                ...(composition.mainImageSuitability ? { mainImageSuitability: composition.mainImageSuitability } : {}),
                ...(composition.subjectCoverageRatio ? { subjectCoverageRatio: composition.subjectCoverageRatio } : {}),
                ...(productType ? { productType } : {})
            };
            index.set(key, signal);
        }
    } catch (e: any) {
        console.warn(`[ContentMatch] 读取项目视觉理解缓存失败：${e?.message || e}（ecommerce:readVisualInsightCache 通道；本轮选图 visionFit 保持中性，不影响其余打分维度）`);
    }
    return index;
}

/** 按素材绝对路径 / 项目相对路径匹配视觉构图信号；匹配不到时返回 undefined（打分保持中性）。 */
function findDetailAssetVisionSignal(
    index: Map<string, DetailAssetVisionSignal>,
    image: { path?: string; relativePath?: string },
    projectPath: string
): DetailAssetVisionSignal | undefined {
    if (index.size === 0) return undefined;
    const keys = [
        normalizeDetailAssetPathKey(image?.path),
        normalizeDetailAssetPathKey(
            image?.relativePath ? joinDetailProjectRelativePath(projectPath, image.relativePath) : ''
        )
    ].filter(Boolean);
    for (const key of keys) {
        const signal = index.get(key);
        if (signal) return signal;
    }
    return undefined;
}

/**
 * 执行详情页内容匹配
 */
async function executeDetailPageContentMatch(params: {
    screens: any[];
    projectPath: string;
    projectAssets?: { images?: any[] };
    screenPlans?: any[];
    selectedScene?: any;
    selectedDesignContext?: any;
    selectedElementContext?: any;
    selectedModuleContext?: any;
    copyContext?: any;
    copyFacts?: any[];
    targetAudience?: string;
    aiCopyGeneration?: boolean;
    copyReview?: boolean;
    copyMinScore?: number;
    copyCandidateCount?: number;
    copyCreativeStyle?: string;
    lowScoreCopyStrategy?: 'replace' | 'flag' | 'keep';
    copyLayoutFit?: boolean;
    copyLineBreakStyle?: string;
    copyTitleMaxLines?: number;
    copySubtitleMaxLines?: number;
    copyBodyMaxLines?: number;
    copyOnly?: boolean;
    brandTone?: string;
    screenCopyDirectives?: any[];
}): Promise<any> {
    let projectPath = params.projectPath || '';
    if (!projectPath) {
        try {
            const appState = useAppStore.getState();
            projectPath = (appState as any)?.currentProject?.path || '';
        } catch { /* ignore */ }
    }

    const { screens } = params;
    
    console.log('[ContentMatch] 开始匹配内容...');
    console.log(`[ContentMatch] 屏数量: ${screens?.length || 0}, 项目: ${projectPath}`);

    const trustedSuppliedInventory = isTrustedDetailPageProjectAssets(params.projectAssets, projectPath)
        ? params.projectAssets
        : undefined;
    const suppliedInventoryTrusted = Boolean(trustedSuppliedInventory);
    const projectAssets: TrustedDetailPageProjectAssets = trustedSuppliedInventory ?? { images: [] };
    if (suppliedInventoryTrusted) {
        console.log(`[ContentMatch] 复用带 Harness 身份 receipt 的前置素材库存 ${projectAssets.images.length} 张，不重复扫描项目。`);
    } else if (projectPath) {
        if (Array.isArray(params.projectAssets?.images) && params.projectAssets.images.length > 0) {
            console.warn('[ContentMatch] 忽略没有 Harness 身份 receipt 的 projectAssets；将从当前项目重新取得真实库存。');
        }
        try {
            const scanResult = await window.designEcho.invoke('ecommerce:scanProject', projectPath);
            if (scanResult?.folders) {
                projectAssets.images.push(...flattenFolderImages(scanResult.folders));
                console.log(`[ContentMatch] 扫描到 ${projectAssets.images.length} 张候选图片；是否可直接使用仍由视觉观察与槽位用途判定。`);
            } else if (scanResult?.images) {
                projectAssets.images.push(...scanResult.images);
            }
        } catch (e: any) {
            console.warn(`[ContentMatch] 扫描项目素材失败: ${e.message}`);
        }
        registerTrustedDetailPageProjectAssets(projectAssets, projectPath);
    } else {
        console.warn('[ContentMatch] 未指定 projectPath，且 appStore 中无当前项目');
    }

    // 视觉理解构图信号供给：按素材路径匹配项目视觉缓存中的 insight，送入 ranker 的 visionFit 维度。
    // 不改任何打分权重；没有信号的素材 scoreVisionFit 保持中性 0.5，行为与此前完全一致。
    if (projectPath && projectAssets.images.length > 0) {
        const cachedVisionSignalIndex = await buildDetailPageVisionSignalIndex(projectPath, projectAssets.images);
        const visionSignalIndex = await observeDetailPageCandidatesWithContactSheet({
            projectPath,
            inventoryOwner: projectAssets,
            images: projectAssets.images,
            existingIndex: cachedVisionSignalIndex
        });
        if (visionSignalIndex.size > 0) {
            let suppliedCount = 0;
            projectAssets.images = projectAssets.images.map((image: any) => {
                const visionSignal = findDetailAssetVisionSignal(visionSignalIndex, image, projectPath);
                if (!visionSignal) return image;
                suppliedCount += 1;
                return { ...image, visionSignal };
            });
            console.log(
                `[ContentMatch] 新鲜缓存/本轮候选总览共同供给 `
                + `${suppliedCount}/${projectAssets.images.length} 张素材的视觉职责信号`
            );
        }
    }

    const ranked = await matchDetailPageContentPlans({
        screens: screens || [],
        projectAssets,
        screenPlans: Array.isArray(params.screenPlans) ? params.screenPlans : [],
        selectedScene: params.selectedScene || null,
        selectedDesignContext: params.selectedDesignContext || null,
        selectedElementContext: params.selectedElementContext || null,
        selectedModuleContext: params.selectedModuleContext || null,
        copyContext: params.copyContext || undefined,
        copyFacts: Array.isArray(params.copyFacts) ? params.copyFacts : undefined,
        targetAudience: params.targetAudience,
        aiCopyGeneration: params.aiCopyGeneration,
        copyReview: params.copyReview,
        copyMinScore: params.copyMinScore,
        copyCandidateCount: params.copyCandidateCount,
        copyCreativeStyle: params.copyCreativeStyle,
        lowScoreCopyStrategy: params.lowScoreCopyStrategy,
        copyLayoutFit: params.copyLayoutFit,
        copyLineBreakStyle: params.copyLineBreakStyle,
        copyTitleMaxLines: params.copyTitleMaxLines,
        copySubtitleMaxLines: params.copySubtitleMaxLines,
        copyBodyMaxLines: params.copyBodyMaxLines,
        copyOnly: params.copyOnly,
        brandTone: params.brandTone,
        screenCopyDirectives: Array.isArray(params.screenCopyDirectives)
            ? params.screenCopyDirectives
            : undefined
    });

    console.log(`[ContentMatch] 生成 ${ranked.plans.length} 个填充方案`);
    return ranked;
}
