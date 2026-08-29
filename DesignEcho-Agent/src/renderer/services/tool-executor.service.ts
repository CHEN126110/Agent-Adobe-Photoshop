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
import { hasValidDetailAssetSelectionReceipt } from './skill-executors/detail-page-plan-utils';
import {
    buildProjectContactSheetCandidateCoverage,
    projectVisualCacheEntryMatchesCurrentAsset,
    normalizeProjectVisualInsightCompositionFields,
    pickPreferredProjectVisualInsightCacheEntry,
    reconcileProjectContactSheetCandidateCoverage,
    selectDiverseProjectVisualCandidates,
    type ProjectContactSheetCandidateCoverage,
    type ProjectVisualSamplingCacheEntry
} from '../../shared/project-visual-sampling';
import {
    AcceptanceCaptureResult,
    buildToolAcceptanceVerification,
    formatToolAcceptanceDebug,
    getToolAcceptanceCapturePolicy,
    shouldCollectAcceptanceVerification,
    type ToolAcceptanceCapturePolicy
} from '../../shared/acceptance/tool-acceptance';
import {
    attachPhotoshopModalRecoveryEvidenceIfUnresolved,
    readPhotoshopModalRecoveryEvidence
} from '../../shared/agent-react-observation-contract';
import { sha256Hex } from '../../shared/agent-runtime-v5/content-hash';
import { sanitizeUserVisibleDiagnosticText } from '../../shared/chat-response-cleaner';
import { buildCompoundPhotoshopWriteExceptionSettlement } from '../../shared/compound-photoshop-write-settlement';
import { parseEagleAssetRefToken } from '../../shared/eagle-asset-ref';
import { buildEagleReferenceFacetSummary } from '../../shared/eagle-reference-facets';
import { describeDesignDocumentNature } from '../../shared/design-document-nature';
import {
    classifyGroupLayersOperationReconciliation
} from '../../shared/group-layers-operation-reconciliation';
import {
    classifyPlaceImageOperationReconciliation
} from '../../shared/place-image-operation-reconciliation';
import { buildPhotoshopToolSkillPromptSection } from '../../shared/photoshop-tool-skill';
import { enrichPhotoshopDocumentInventory } from '../../shared/photoshop-document-inventory';
import { normalizePhotoshopToolArguments } from '../../shared/photoshop-tool-parameter-normalizer';
import {
    classifyAgentToolExecution,
    DESIGN_ECHO_TARGET_GUARD_ARGUMENT,
    isAgentToolExecutionGuarded
} from '../../shared/agent-tool-execution-preflight';
import {
    enforceGuardedPhotoshopExecutionBaseline,
    type GuardedPhotoshopExecutionBaseline
} from '../../shared/guarded-photoshop-execution-baseline';
import {
    readDebugBridgePhotoshopRuntimeLiveIdentity,
    type DebugBridgePhotoshopRuntimeLiveIdentity
} from '../../shared/debug-bridge-chat';
import { isTransientPhotoshopBusyFailure } from '../../shared/photoshop-transient-error';
import { preserveJpegQualityAcrossToolRedirect } from '../../shared/jpeg-export-quality-semantics';
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
import {
    VISUAL_OBSERVATION_BUNDLE_VERSION,
    type VisualObservationBundle,
    type VisualObservationImagePayload
} from '../../shared/visual-observation-bundle';
import { buildImagePlacementReviewPlan } from '../../shared/layout/image-placement-review-plan';
import type { ImagePlacementSpec } from '../../shared/layout/layout-engine';
import { preflightResolvedImagePlacements } from '../../shared/layout/resolved-image-placement-preflight';
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
    { name: 'createInteractiveCard', description: '创建通用可编辑草稿卡。只有多个结构化字段明显比简短选择更清楚时使用；短选择使用 askUserToChoose，领域数据默认由对应 Skill Provider 产卡。用户明确禁用 Skill 时也只能收集无法观察的用户事实，不能无证据声明现有文件角色。', params: '{ cardKind: "editable_confirmation", title: string, description?: string, fields: { id: string, label: string, type?: "short_text"|"long_text"|"choice"|"boolean", value?: string|boolean, required?: boolean, options?: { value: string, label: string }[] }[], initialValue?: any, projectId?: string, memoryEnabled?: boolean, memoryKind?: string, tags?: string[] }' },

    // === 文档/画布操作 ===
    { name: 'createDocument', description: '创建新文档', params: '{ preset?: string, width?: number, height?: number, name?: string, backgroundColor?: "white"|"black"|"transparent" }' },
    { name: 'listDocuments', description: '一次列出所有【已打开】文档，并返回保存路径状态、当前项目归属和文档性质提示', params: '{ includeDetails?: boolean, includePaths?: boolean, includeDimensions?: boolean, includeLayerCount?: boolean }' },
    { name: 'switchDocument', description: '切换到【已打开】的指定文档（注意：不能打开新文件，只能切换）', params: '{ documentName: string }' },
    { name: 'closeDocument', description: '关闭指定文档（批量操作后清理）。不保存修改除非指定 save: true', params: '{ documentName?: string, documentId?: number, save?: boolean }' },
    { name: 'getDocumentInfo', description: '获取当前文档信息', params: '{}' },
    { name: 'getDocumentSnapshot', description: '获取文档快照（用于视觉分析）', params: '{ maxSize?: number }' },
    { name: 'capturePhotoshopWindow', description: '读取完整 Photoshop 应用窗口（含原生弹窗），仅用于真实堵塞诊断', params: '{}' },
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
    { name: 'getCanvasSnapshot', description: '获取当前活动文档的画布截图，可用 expectedDocumentId 做目标身份断言', params: '{ maxSize?: number, expectedDocumentId?: number, region?: { x: number, y: number, width: number, height: number } }' },
    { name: 'getElementMapping', description: '获取元素映射', params: '{ includeHidden?: boolean }' },
    { name: 'analyzeLayout', description: '分析布局', params: '{ detectHierarchy?: boolean }' },
    
    // === 历史记录 ===
    { name: 'undo', description: '撤销', params: '{ steps?: number }' },
    { name: 'redo', description: '重做', params: '{ steps?: number }' },
    { name: 'getHistoryInfo', description: '获取历史记录', params: '{}' },
    
    // === 导出 ===
    { name: 'saveDocument', description: '正式保存或导出交付文件；省略 path 时使用当前文档的用户可读名称，不附加时间戳或内部状态词', params: '{ format?: "psd"|"psb"|"png"|"jpg"|"jpeg"|"tiff"|"pdf", path?: string, projectSubdir?: string, saveAs?: boolean, quality?: number, conflictPolicy?: "overwrite"|"fail_if_exists" }' },
    { name: 'quickExport', description: '快速导出到明确目录或完整 PNG/JPEG 文件路径；用户给 .png/.jpg/.jpeg 路径时不要删除扩展名，运行时会转为 saveDocument(path)', params: '{ outputPath: string, format?: "png"|"jpg", quality?: number, suffix?: string }' },
    { name: 'exportGroup', description: '导出指定图层组或图层为 PNG 文件；需要 groupPath 或 layerId 以及完整 outputPath', params: '{ groupPath?: string[], layerId?: number, outputPath: string, format?: "png", targetWidth?: number, targetHeight?: number, maxSize?: number }' },
    { name: 'exportMainImageDocuments', description: '按用户导出规范 4.0 批量导出成品：主图文档（800/750/1200）的「转化图」「点击图」父组下每个非空子组各导一张 JPEG（质量自适应≤3MB）到 <导出目录>/主图/<尺寸>/，详情页文档按切片 Save For Web 导出到 <导出目录>；未打开的文档跳过不中断，处理后恢复历史状态', params: '{ outputDir: string, documents?: string[], mainImageGroups?: string[], maxFileSizeMB?: number }' },
    { name: 'exportWhiteBgFromSkuMaterial', description: '从项目 SKU PSD/PSB 源文件生成 800x800 白底图并保存到完整 JPEG 路径', params: '{ sourceDocumentPath: string, outputPath: string, preferredLayerName?: string, canvasWidth?: number, canvasHeight?: number, targetSubjectHeightPx?: number, horizontalMarginPx?: number, jpegQuality?: number }' },
    { name: 'smartSave', description: '建立项目内部可编辑恢复点；路径固定由宿主解析到 .designecho/recovery，不属于最终交付', params: '{ exportFormat?: "psd"|"psb" }' },
    
    // === 图像处理 ===
    { name: 'removeBackground', description: '智能抠图', params: '{ targetPrompt?: string, outputFormat?: "layer"|"mask" }' },
    { name: 'placeImage', description: 'Place an image that the Agent has explicitly selected. This execution tool never scans, ranks, or chooses project assets. When no source is supplied, inspect candidates with recommendAssets and call placeImage again with filePath/fileToken/imageData.', params: '{ filePath?: string, fileToken?: string, imageData?: string, name?: string, x?: number, y?: number, targetBounds?: { x?: number, y?: number, left?: number, top?: number, right?: number, bottom?: number, width?: number, height?: number }, targetFit?: "contain"|"cover"|"fill", layerOrder?: "front"|"belowText"|"back", center?: boolean, scale?: number, fitToCanvas?: boolean }' },
    { name: 'replaceLayerContent', description: '目标图层和替换文件都明确后，替换图层内容为新图片', params: '{ filePath: string, layerId?: number }' },
    // === 创建工具 ===
    { name: 'createRectangle', description: '创建矩形', params: '{ x: number, y: number, width: number, height: number, name?: string, color?: {r,g,b}, fillColorHex?: string, cornerRadius?: number }' },
    { name: 'createEllipse', description: '创建椭圆', params: '{ x: number, y: number, width: number, height: number }' },
    { name: 'createTextLayer', description: '创建文字', params: '{ content: string, text?: string, name?: string, x: number, y: number, fontSize?: number, fontName?: string, tracking?: number, leading?: number, colorHex?: string, color?: { r: number, g: number, b: number }, alignment?: "left"|"center"|"right" }' },
    { name: 'createGroup', description: '创建图层组', params: '{ groupName: string }' },
    
    // === SKU 相关 ===
    { name: 'skuLayout', description: 'SKU executor 底层工具。仅在用户明确要求生成/导出 SKU 组合图或自选备注，并且已由 SKU 业务流程确认 SKU 源文档、模板和输出目标后使用；能力问答、SKU 说明、只读查看、规划讨论不要调用。listLayerSets/getCapabilities 为只读；execute/arrangeDynamic/exportNote 会写入或导出文件。', params: '{ action: "getCapabilities"|"listLayerSets"|"execute"|"arrangeDynamic"|"exportNote", skuDocName?: string, templateDocName?: string, combos?: string[][], regionCapacities?: number[], outputDir?: string, noteFilePrefix?: string, autoLayoutWithoutPlaceholders?: boolean }' },
    { name: 'sockLayoutConfig', description: 'SKU 编排配置解析（只读）：首选组合优先，按行填写颜色组合（comboText），颜色数自动匹配 N双装 模板，返回可直接交给 skuLayout 的 combos 分组；兼容旧版排版 CSV + 颜色 CSV', params: '{ action?: string, projectRoot?: string, comboText?: string, templateName?: string, outputPattern?: string, quality?: number, layoutCsvText?: string, colorCsvText?: string }' },
    { name: 'exportColorConfig', description: '导出 SKU 颜色配置', params: '{}' },
    { name: 'createSkuPlaceholders', description: '只在尚无区域/占位标记的文档中创建 SKU 占位槽。已有结构会返回 existing_structure_detected，应 inspectTemplateLayout 后用 transformLayer 转换，或在新文档中重建；不存在模型布尔覆盖授权。', params: '{ count: number, placementMethod?: "ordered_slots"|"region_composition", regionCapacities?: number[], slots?: [{x,y,width,height}], layout?: "horizontal"|"vertical"|"grid", area?: {x,y,width,height} }' },
    { name: 'getSkuPlaceholders', description: '获取 SKU 占位符信息', params: '{}' },
    { name: 'smartLayout', description: '智能布局引擎。只在专门布局流程已确认目标图层/目标区域时使用；不要把它作为普通小工具默认猜测调用。', params: '{ action: "calculateScale"|"applyLayout"|"analyzeLayout"|"getRecommendedConfig"|"smartArrange", sourceLayerName?: string, targetBounds?: { left: number, top: number, width: number, height: number }, layerIds?: number[], layerNames?: string[], config?: object }' },
    { name: 'alignToReference', description: '把显式 layerId 的图层按比例缩放并移动，使主体中心对齐到目标点；必须先读回图层与边界，不按名称猜测参考图层', params: '{ layerId: number, scalePercent: number, targetCenterX: number, targetCenterY: number, subjectOffsetX: number, subjectOffsetY: number }' },
    { name: 'fitLayerSubjectToRegion', description: '【主体感知缩放与定位】按真实主体适配明确目标区域；视觉占比必须来自 Agent 的明确设计判断或已选参考实测，锚点必须显式声明。Harness 只求解几何，并返回写后 geometryVerification 与同版本局部画面。', params: '{ layerId: number, targetRegion: {x,y,width,height}, subjectFillRatio?: number, referenceComposition?: { subjectFillRatioForFullCanvas?: number }, anchor: "center"|"top-center"|"bottom-center"|"left-center"|"right-center", maxUpscaleRatio?: number, method?: "auto"|"alpha"|"smart" }' },
    
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
    { name: 'createProjectContactSheetOverview', description: '把项目图片按角色和桶内跨度抽样后合成带编号的缩略图总览；结果分开披露候选全集、选入渲染、成功展示、渲染失败和未展示数，只有真正可见的图片才计入展示。抽样只扩大事实覆盖，不排序，也不替 Agent 选最终素材。', params: '{ directory?: string, maxImages?: number, columns?: number }' },
    { name: 'analyzeProjectContactSheetOverview', description: '先按角色和桶内跨度抽样生成项目图片总览，再把同一张带编号总览直接交给当前多模态 Agent 建立有界视觉库存；顶层 Agent 路径不让第二个模型重复解释相同像素。结果分开披露选入渲染、成功展示、渲染失败和未展示数，只提供事实，不排序、不替 Agent 选图或决定设计方向。', params: '{ directory?: string, maxImages?: number, focus?: string }' },
    { name: 'prepareSkuRetouchAssets', description: '为一批纯底棚拍 SKU 商品图生成透明主体等比统一尺度资产：保持真实版型，不做形态变形、阴影/投影分离或光影修正。sourceMode=auto 会跳过场景图；该工具只生成项目文件，不代表 Photoshop 色卡已完成。', params: '{ sources: [{sourceId?: string, filePath: string, colorName?: string}], projectPath?: string, outputDir?: string, referenceSourcePath?: string, sourceMode?: "auto"|"studio"|"scene", maxLongEdge?: number, force?: boolean }' },
    { name: 'generateImage', description: '使用设置中选择的生图渠道生成新素材：ChatGPT/Codex 订阅的 gpt-image-2，或 BFL API 的 FLUX。生成结果不会自动写入 Photoshop，采用前仍需查看。', params: '{ prompt: string, model?: "flux-2-max"|"flux-2-pro"|"flux-2-klein-9b"|"flux-2-klein-4b", width?: number, height?: number, transparentBackground?: boolean }' },

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
        description: '【读取浏览器页面】读用户真实浏览器页面的正文/链接/可交互元素（带登录态）。给 url 则后台新标签页打开再读；需点击填写时带 includeElements:true；想看页面图片时带 includeImages:true（图片进视觉理解）。',
        params: '{ tabId?: number, url?: string, includeElements?: boolean, includeImages?: boolean, maxImages?: number, maxImageEdge?: number, maxChars?: number }'
    },
    {
        name: 'captureBrowserTab',
        description: '【浏览器截图】截取用户浏览器标签页画面供视觉理解（会临时切前台，只截可见区；fullPage:true 可滚动拼接长图）。',
        params: '{ tabId?: number, maxWidth?: number, fullPage?: boolean, maxSlices?: number }'
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
export const VISION_TOOLS = ['getCanvasSnapshot', 'getDocumentSnapshot', 'getAnnotatedSnapshot', 'capturePhotoshopWindow'];

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
    // 正常文档清单是轻量读；20 秒仍无响应时应尽快暴露 modal_suspected，
    // 不能让一次环境观察把 Agent 卡住整分钟。
    if (toolName === 'listDocuments') return 20 * 1000;
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
        environmentState: 'photoshop_native_modal_suspected',
        recoveryRequired: true,
        environmentObservation: {
            capability: 'capturePhotoshopWindow',
            scope: 'adobe_photoshop_application_window',
            purpose: '读取包含原生弹窗和应用界面的真实 Photoshop 窗口；画布快照无法证明是否存在应用级弹窗。'
        },
        suggestion: '先由 Agent 观察 Photoshop 完整窗口再判断恢复方式；如果真实画面确认有必须人工处理的原生弹窗，再请用户关闭。恢复前不要重复执行写入步骤。',
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

interface PhotoshopOperationReconciliationContext {
    acceptanceBefore?: AcceptanceCaptureResult;
    acceptancePolicy?: ToolAcceptanceCapturePolicy;
}

function waitForPhotoshopReadbackRetry(): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, 1_100);
    });
}

async function captureAcceptanceAfterUnknownOperation(
    toolName: string,
    policy: ToolAcceptanceCapturePolicy
): Promise<AcceptanceCaptureResult> {
    let latest: AcceptanceCaptureResult = { error: 'Photoshop 写后状态暂时不可读' };
    for (let attempt = 0; attempt < 3; attempt += 1) {
        latest = await captureAcceptanceSnapshot('after', toolName, policy);
        if (latest.snapshot) return latest;
        if (attempt < 2) await waitForPhotoshopReadbackRetry();
    }
    return latest;
}

async function reconcilePlaceImageOperationReadback(
    params: any,
    operationResult: Record<string, any>,
    context: PhotoshopOperationReconciliationContext
): Promise<Record<string, any>> {
    const operation = readPhotoshopOperationResult(operationResult);
    if (!operation || !requiresPhotoshopOperationReadback(operationResult)) {
        return operationResult;
    }
    const before = context.acceptanceBefore?.snapshot;
    if (!before) {
        return {
            ...operationResult,
            readback: {
                attempted: false,
                verified: false,
                classification: 'ambiguous',
                reasonCode: 'place_image_before_snapshot_unavailable'
            }
        };
    }

    const policy = context.acceptancePolicy || getToolAcceptanceCapturePolicy('placeImage', params);
    const afterCapture = await captureAcceptanceAfterUnknownOperation('placeImage', policy);
    const reconciliation = classifyPlaceImageOperationReconciliation({
        before,
        after: afterCapture.snapshot
    });
    const readback = {
        attempted: true,
        verified: reconciliation.classification !== 'ambiguous',
        classification: reconciliation.classification,
        reasonCode: reconciliation.reasonCode,
        expectedHistoryStateRef: reconciliation.expectedHistoryStateRef,
        observedHistoryStateRef: reconciliation.observedHistoryStateRef,
        addedLayerIds: reconciliation.addedLayerIds,
        ...(afterCapture.error ? { error: afterCapture.error } : {})
    };
    if (reconciliation.classification === 'ambiguous'
        || !afterCapture.snapshot
        || !reconciliation.observedHistoryStateRef) {
        return {
            ...operationResult,
            readback,
            reconciliationReceipt: reconciliation
        };
    }
    if (reconciliation.classification === 'not_applied') {
        return {
            ...operationResult,
            success: false,
            code: 'photoshop_place_image_reconciled_not_applied',
            error: '置入图片没有应用到当前文档；写前与写后图层结构及历史版本保持一致。',
            recoveryRequired: false,
            suggestion: '本次未知写入已经结算为未应用；需要时可以重新发起置入。',
            historyStateRef: reconciliation.observedHistoryStateRef,
            readback,
            reconciliationReceipt: reconciliation,
            photoshopOperationResult: {
                ...operationResult.photoshopOperationResult,
                status: 'failed',
                applicationStatus: 'not_applied',
                transactionState: 'not_started',
                effect: 'none',
                before: reconciliation.expectedHistoryStateRef,
                after: reconciliation.observedHistoryStateRef,
                code: 'photoshop_place_image_reconciled_not_applied',
                message: '同一文档的完整图层快照与历史版本确认图片没有置入。'
            }
        };
    }

    const layer = reconciliation.layer;
    if (!layer) {
        return {
            ...operationResult,
            readback: {
                ...readback,
                verified: false,
                classification: 'ambiguous',
                reasonCode: 'reconciled_place_image_layer_missing'
            },
            reconciliationReceipt: reconciliation
        };
    }
    const provisionalResult = {
        success: true,
        layerId: layer.id,
        layer: {
            id: layer.id,
            name: layer.name,
            kind: layer.kind,
            bounds: layer.boundsNoEffects || layer.bounds
        },
        data: {
            layerId: layer.id,
            layerName: layer.name,
            bounds: layer.boundsNoEffects || layer.bounds,
            source: {
                ...(params?.sourceAssetId ? { assetId: params.sourceAssetId } : {}),
                ...(params?.sourcePath || params?.filePath ? {
                    path: params.sourcePath || params.filePath
                } : {})
            }
        },
        historyStateRef: reconciliation.observedHistoryStateRef
    };
    const verifiedResult = attachAcceptanceVerification(
        'placeImage',
        params,
        provisionalResult,
        context.acceptanceBefore as AcceptanceCaptureResult,
        afterCapture
    );
    if (verifiedResult.acceptance?.verified !== true) {
        return {
            ...operationResult,
            readback: {
                ...readback,
                verified: false,
                classification: 'ambiguous',
                reasonCode: 'place_image_acceptance_assertion_not_verified'
            },
            reconciliationReceipt: reconciliation,
            acceptance: verifiedResult.acceptance,
            photoshopHistoryTransition: verifiedResult.photoshopHistoryTransition
        };
    }

    const reconciledTransactionState = operation.transactionState === 'transport_unknown'
        ? 'transport_reconciled'
        : 'readback_reconciled';
    return {
        ...verifiedResult,
        recoveredAfterTransportFailure: operation.transactionState === 'transport_unknown',
        reconciledAfterUnknownOperation: true,
        readback,
        reconciliationReceipt: reconciliation,
        message: `已从同一 Photoshop 文档读回并确认图片图层「${layer.name || layer.id}」。`,
        photoshopOperationResult: {
            ...operationResult.photoshopOperationResult,
            status: 'verified',
            applicationStatus: 'applied',
            transactionState: reconciledTransactionState,
            effect: 'applied',
            before: reconciliation.expectedHistoryStateRef,
            after: reconciliation.observedHistoryStateRef,
            code: 'photoshop_place_image_reconciled_applied',
            message: '同一文档的 revision 变化与完整图层快照共同确认图片已经置入。'
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
    operationResult: Record<string, any>,
    context: PhotoshopOperationReconciliationContext = {}
): Promise<Record<string, any>> {
    if (toolName === 'placeImage') {
        return reconcilePlaceImageOperationReadback(params, operationResult, context);
    }
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
    'webSearch',
    'analyzeEagleReference',
    'searchDesignKnowledge',
    'readSkillPlaybook',
    'runSkillScript',
    'proposeSkillImprovement',
    // 设计知识笔记（用户与 Agent 共写；主进程磁盘存储，Obsidian 兼容）
    'searchDesignNotes',
    'readDesignNote',
    'writeDesignNote'
];

// ==================== 执行状态 ====================

let executedToolsInSession: string[] = [];
let currentRound = 0;

// ==================== 主体框：素材属性而不是画布上的实时识别 ====================

/**
 * 本会话里「图层 → 来源文件」的记录（placeImage / replaceLayerContent 等成功后写入）。
 * 有了它，主体框可以直接从素材文件算（主进程本地：alpha → 纯色底裁边 → 分割模型），
 * 不必在 Photoshop 里跑「选择主体」。图层 id 在不同文档间会重复，所以带 documentId。
 */
interface LayerSourceFileRecord {
    filePath: string;
    documentId?: number;
    recordedAt: number;
}
const layerSourceFileById = new Map<number, LayerSourceFileRecord>();

function rememberLayerSourceFile(layerId: unknown, filePath: unknown, documentId?: unknown): void {
    const id = Number(layerId);
    const file = String(filePath || '').trim();
    if (!Number.isFinite(id) || id <= 0 || !file) return;
    const doc = Number(documentId);
    layerSourceFileById.set(id, {
        filePath: file,
        ...(Number.isFinite(doc) && doc > 0 ? { documentId: doc } : {}),
        recordedAt: Date.now()
    });
}

function readLayerSourceFile(layerId: number, documentId?: number): string | undefined {
    const record = layerSourceFileById.get(layerId);
    if (!record) return undefined;
    if (record.documentId && documentId && record.documentId !== documentId) return undefined;
    return record.filePath;
}

function readResultDocumentId(result: unknown): number | undefined {
    const proof = findObservedPhotoshopMutationProof(result);
    const fromProof = Number(proof?.after?.documentId);
    if (Number.isFinite(fromProof) && fromProof > 0) return fromProof;
    const record = result && typeof result === 'object' ? result as Record<string, any> : undefined;
    const direct = Number(record?.documentId ?? record?.document?.id ?? record?.data?.documentId);
    return Number.isFinite(direct) && direct > 0 ? direct : undefined;
}

type SubjectBoundsRect = { left: number; top: number; right: number; bottom: number };

interface ResolvedLayerSubject {
    bounds: SubjectBoundsRect & { width: number; height: number };
    /** 主体相对图层外框的位置（0–1）；缩放后按新外框投影即可得到新主体框，不必再检测 */
    relativeBox?: { x: number; y: number; width: number; height: number };
    /** 人话方法名：asset:trim / asset:matting / alpha / layer:matting / photoshop / frame */
    method: string;
    confidence: 'certain' | 'high' | 'medium' | 'low';
    note: string;
    warnings: string[];
}

function toSubjectRect(value: unknown): SubjectBoundsRect | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const rect = value as Record<string, unknown>;
    const left = Number(rect.left);
    const top = Number(rect.top);
    const right = Number(rect.right);
    const bottom = Number(rect.bottom);
    if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return undefined;
    return { left, top, right, bottom };
}

function withSize(rect: SubjectBoundsRect): SubjectBoundsRect & { width: number; height: number } {
    return { ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top };
}

function readHierarchyNodeChildren(node: any): any[] {
    if (Array.isArray(node?.children)) return node.children;
    if (Array.isArray(node?.layers)) return node.layers;
    return [];
}

function hierarchyNodeContainsAnyLayerId(
    node: any,
    targetLayerIds: ReadonlySet<number>
): boolean {
    const layerId = Number(node?.id);
    if (Number.isInteger(layerId) && targetLayerIds.has(layerId)) return true;
    const children = readHierarchyNodeChildren(node);
    return children.some((child: any) => hierarchyNodeContainsAnyLayerId(child, targetLayerIds));
}

function collectHierarchyNodeLayerIds(
    node: any,
    out: Set<number> = new Set<number>()
): Set<number> {
    const layerId = Number(node?.id);
    if (Number.isInteger(layerId) && layerId > 0) out.add(layerId);
    const children = readHierarchyNodeChildren(node);
    for (const child of children) collectHierarchyNodeLayerIds(child, out);
    return out;
}

/**
 * 求一个图层的主体框——按可靠性逐级降级，每级带置信度，PS「选择主体」只在显式要求时才用：
 *  1) 来源文件已知 → 主进程按素材算（alpha / 纯色底裁边 / 本地分割），相对框投影到图层外框
 *  2) 图层透明边界（插件像素统计，确定）
 *  3) 图层像素导出 → 主进程本地分割（不依赖 Photoshop 智能功能）
 *  4) 显式 method="smart" → Photoshop 选择主体
 *  5) 整个图层外框（低置信，明说）
 */
async function resolveLayerSubjectBounds(input: {
    layerId: number;
    frameBounds: SubjectBoundsRect;
    requestedMethod: 'auto' | 'alpha' | 'smart';
    documentId?: number;
    options: ToolCallExecutionOptions;
}): Promise<ResolvedLayerSubject> {
    const { layerId, frameBounds, requestedMethod, options } = input;
    const warnings: string[] = [];
    const bridge = (window as any).designEcho;
    const { projectRelativeBoxOntoFrame, relativeBoxFromFrame } = await import('../../shared/subject-box-from-pixels');

    const finish = (
        rect: SubjectBoundsRect,
        method: string,
        confidence: ResolvedLayerSubject['confidence'],
        note: string,
        relativeBox?: ResolvedLayerSubject['relativeBox']
    ): ResolvedLayerSubject => ({
        bounds: withSize(rect),
        relativeBox: relativeBox || relativeBoxFromFrame(rect, frameBounds),
        method,
        confidence,
        note,
        warnings
    });

    const readAlpha = async (): Promise<ResolvedLayerSubject | undefined> => {
        const alphaResult = await executeToolCall('getSubjectBounds', { layerId, method: 'alpha' }, options);
        const rect = toSubjectRect(alphaResult?.data?.bounds);
        if (alphaResult?.success === false || !rect) return undefined;
        const frameArea = Math.max(1, (frameBounds.right - frameBounds.left) * (frameBounds.bottom - frameBounds.top));
        const rectArea = (rect.right - rect.left) * (rect.bottom - rect.top);
        // 几乎等于外框 = 这一层是不透明的整图，alpha 说明不了主体在哪
        if (rectArea / frameArea > 0.985) return undefined;
        return finish(rect, 'alpha', 'certain', '透明底图层：主体 = 不透明像素范围');
    };

    if (requestedMethod === 'smart') {
        const smart = await executeToolCall('getSubjectBounds', { layerId, method: 'smart' }, options);
        const rect = toSubjectRect(smart?.data?.bounds);
        if (smart?.success !== false && rect) {
            return finish(rect, 'photoshop', 'medium', 'Photoshop 选择主体（显式要求）；复杂场景请看画面确认');
        }
        warnings.push(`Photoshop 选择主体未拿到结果（${smart?.error || '未返回主体边界'}），已改用本地方式。`);
    }

    // 1) 素材属性
    if (requestedMethod !== 'alpha') {
        const sourceFile = readLayerSourceFile(layerId, input.documentId);
        if (sourceFile && typeof bridge?.invoke === 'function') {
            try {
                const asset = await bridge.invoke('resource:getAssetSubjectBox', sourceFile);
                const resolution = asset?.success ? asset.resolution : undefined;
                if (resolution?.box && resolution.method !== 'frame') {
                    if (resolution.method === 'alpha') {
                        // 透明底素材：图层外框可能已经是不透明范围，投影不可靠，直接读图层像素更准
                        const alpha = await readAlpha();
                        if (alpha) return alpha;
                    } else {
                        const rect = projectRelativeBoxOntoFrame(resolution.box, frameBounds);
                        return finish(
                            rect,
                            `asset:${resolution.method}`,
                            resolution.confidence,
                            `${resolution.note}（来自素材文件，一次计算重复使用）`,
                            resolution.box
                        );
                    }
                }
            } catch (error: any) {
                warnings.push(`素材主体框读取失败：${error?.message || error}`);
            }
        }
    }

    // 2) 图层透明边界
    const alpha = await readAlpha();
    if (alpha) return alpha;
    if (requestedMethod === 'alpha') {
        warnings.push('该图层没有透明边界（整图不透明），alpha 方式说明不了主体在哪，已按整个图层外框处理。');
        return finish(frameBounds, 'frame', 'low', '按整个图层外框适配；主体尺度请看画面确认');
    }

    // 3) 图层像素 → 主进程本地分割
    if (typeof bridge?.invoke === 'function') {
        try {
            const detected = await bridge.invoke('resource:detectLayerSubjectBox', { layerId });
            const rect = toSubjectRect(detected?.bounds);
            if (detected?.success && rect && detected.resolution?.method !== 'frame') {
                return finish(
                    rect,
                    `layer:${detected.resolution?.method || 'matting'}`,
                    detected.resolution?.confidence || 'medium',
                    detected.resolution?.note || '本地分割模型给出的主体框',
                    detected.resolution?.box
                );
            }
            if (detected?.success === false && detected?.error) warnings.push(String(detected.error));
        } catch (error: any) {
            warnings.push(`图层本地主体检测失败：${error?.message || error}`);
        }
    }

    // 5) 兜底
    return finish(frameBounds, 'frame', 'low', '没有可用的主体检测，按整个图层外框适配；文字区域仍由版面结构避开，主体尺度请看画面确认');
}

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
                    'inspectTemplateLayout',
                    'listLayerSets',
                    'execute',
                    'arrangeDynamic'
                ],
                supportsNoPlaceholderAutoLayout: true,
                supportsRecursiveSkuLayerSets: true,
                skuSourceColorGroups: {
                    revision: 'sku-recursive-color-layer-groups/v1',
                    actions: ['listLayerSets', 'copyLayerSetToTemplate', 'execute', 'arrangeDynamic'],
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
                templateRegionComposition: {
                    revision: 'sku-region-composition/v1',
                    actions: ['inspectTemplateLayout', 'execute', 'arrangeDynamic'],
                    acceptsExplicitRegionCapacities: true,
                    preservesPhotoshopPanelOrder: true,
                    supportsMultipleRectangleRegions: true
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

    if (action === 'inspectTemplateLayout') {
        const activeDocument = await getActiveChatTestFakeDocument();
        const width = Math.max(1, Number(activeDocument?.width || 800));
        const height = Math.max(1, Number(activeDocument?.height || 800));
        const expectedItemCount = Math.max(1, Number(params?.expectedItemCount || 1));
        const documentId = Math.max(1, Number(activeDocument?.id || 1));
        return {
            success: true,
            data: {
                schema: 'sku-template-layout-inspection/v3',
                templateName: String(params?.templateDocName || activeDocument?.name || '测试模板.psb'),
                historyStateRef: {
                    documentId,
                    historyStateId: 1
                },
                mode: 'legacy_single_region',
                placementMethod: 'region_composition',
                slotCount: 1,
                expectedItemCount,
                supportsMultiColorInSingleRegion: true,
                supportsMultiColorPerRegion: true,
                slots: [{
                    name: '测试 SKU 区域',
                    kind: 'shape',
                    sourceType: 'rectangle_region',
                    panelIndex: 0,
                    visible: true,
                    bounds: {
                        left: width * 0.05,
                        top: height * 0.35,
                        right: width * 0.95,
                        bottom: height * 0.9,
                        width: width * 0.9,
                        height: height * 0.55
                    }
                }],
                blockers: [],
                warnings: [],
                inspectedLayerCount: 1,
                visibleLayerCount: 1,
                textObservations: [],
                textObservationCount: 0,
                textObservationsTruncated: false,
                boundaries: {
                    writesPhotoshop: false,
                    claimsDesignQuality: false
                }
            },
            message: '测试模式：已读取 SKU 模板单区域布局。'
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
            exportedFiles,
            ...(action === 'arrangeDynamic'
                ? {
                    noteAutoLayoutPlans: [{
                        regionIndex: 0,
                        mode: 'bounded_note_region',
                        capacity: Math.max(1, Number(combos[0]?.length || 1)),
                        status: 'ready',
                        strategy: 'single-row',
                        placements: Math.max(1, Number(combos[0]?.length || 1)),
                        blockers: [],
                        warnings: [],
                        autoLayoutQa: {
                            status: 'ready',
                            blockers: [],
                            warnings: []
                        }
                    }]
                }
                : {})
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
        if (Object.prototype.hasOwnProperty.call(params || {}, 'documentId')) {
            return {
                success: false,
                code: 'unsupported_document_id_parameter',
                error: '画布快照不会按 documentId 选择或切换文档。请改用 expectedDocumentId 断言当前活动文档。'
            };
        }
        if (Object.prototype.hasOwnProperty.call(params || {}, 'expectedDocumentId')) {
            const expectedDocumentId = params?.expectedDocumentId;
            if (!Number.isSafeInteger(expectedDocumentId) || expectedDocumentId <= 0) {
                return {
                    success: false,
                    code: 'invalid_expected_document_id',
                    error: 'expectedDocumentId 必须是正整数文档 ID。'
                };
            }
            if (expectedDocumentId !== document.id) {
                return {
                    success: false,
                    code: 'unexpected_active_document',
                    error: `画布快照目标不一致：预期活动文档 ${expectedDocumentId}，实际活动文档 ${document.id}。未读取任何像素。`
                };
            }
        }
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

function resolveExplicitPlaceImageSource(params: any): any {
    if (params?.imageData || params?.filePath || params?.fileToken) {
        return params;
    }

    // placeImage 只执行 Agent 已经作出的选择。素材发现与候选比较由 recommendAssets
    // 单独完成并返回主循环；Harness 不得在执行工具内部把推荐 Top1 变成设计决定。
    return {
        ...params,
        __placeImageSourceBlocked: true,
        __placeImageSourceDecision: {
            code: 'explicit_source_required',
            searchedCandidates: false,
            selectedCandidate: false,
            photoshopWriteAttempted: false,
            nextTool: 'recommendAssets'
        }
    };
}
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

function normalizeRecoverySaveFormat(value: any): 'psd' | 'psb' {
    return String(value || '').trim().toLowerCase() === 'psb' ? 'psb' : 'psd';
}

function isExplicitRasterFilePath(value: any): boolean {
    return /\.(?:png|jpe?g)$/i.test(String(value || '').trim());
}

function buildNoDialogSavePath(projectPath: string, documentName?: string, format?: string): string {
    const safeName = sanitizeFileName(documentName || 'document');
    const root = projectPath.replace(/[\\/]+$/, '');
    const ext = normalizeNoDialogSaveFormat(format);
    return `${root}\\${safeName}.${ext}`;
}

function buildRecoverySavePath(recoveryDirectory: string, documentName?: string, format?: string): string {
    const safeName = sanitizeFileName(documentName || 'document');
    const root = recoveryDirectory.replace(/[\\/]+$/, '');
    const ext = normalizeNoDialogSaveFormat(format);
    return `${root}\\${safeName}-恢复.${ext}`;
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

async function resolveProjectRecoveryRoot(projectPath: string): Promise<{
    directory: string;
    error?: string;
}> {
    const root = projectPath.replace(/[\\/]+$/, '');
    const metadataDirectory = `${root}\\.designecho`;
    const recoveryDirectory = `${metadataDirectory}\\recovery`;
    const bridge = (window as any).designEcho;
    if (!bridge?.createDirectory) {
        return {
            directory: recoveryDirectory,
            error: '无法建立项目恢复目录：文件系统桥接不可用'
        };
    }

    try {
        for (const directory of [metadataDirectory, recoveryDirectory]) {
            const exists = bridge.pathExists ? await bridge.pathExists(directory) : false;
            if (exists) continue;
            const created = await bridge.createDirectory(directory);
            if (created?.success === false) {
                return {
                    directory: recoveryDirectory,
                    error: created?.error || `创建项目恢复目录失败：${directory}`
                };
            }
        }
        return { directory: recoveryDirectory };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error || '未知错误');
        return {
            directory: recoveryDirectory,
            error: `创建项目恢复目录失败：${message}`
        };
    }
}

function hasValue(v: any): boolean {
    return v !== undefined && v !== null && String(v).trim() !== '';
}

export interface ToolCallExecutionOptions {
    signal?: AbortSignal;
    /** 请求级任务卡作用域；由 Agent 运行入口签发，不来自模型参数。 */
    taskCardScope?: string;
    /** 仅复合执行器内部签发：外层会在全部写入结束后统一采集最终视觉版本。 */
    deferCompositeVisualObservation?: boolean;
    /**
     * 由真实 Agent 调用边界签发：图像结果直接交给当前多模态 Agent 观察，Tool 内部不得
     * 再调用一次模型解释同一像素。未签发时保持结构化 Skill / 旧调用方的既有分析语义。
     */
    visualConsumptionOwner?: 'calling_agent';
    /** 仅正式 disposable Debug 请求签发；模型与 Tool 参数不能创建或覆盖。 */
    guardedPhotoshopExecutionBaseline?: GuardedPhotoshopExecutionBaseline;
}

function readGuardedPhotoshopRuntimeIdentity(
    value: unknown
): DebugBridgePhotoshopRuntimeLiveIdentity | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const state = (value as any).state;
    const runtime = state && typeof state === 'object' && !Array.isArray(state)
        ? state.runtime
        : undefined;
    return readDebugBridgePhotoshopRuntimeLiveIdentity(runtime);
}

function readGuardedOpenDocumentCount(value: unknown): number | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    if ((value as any).success === false || !Array.isArray((value as any).documents)) return undefined;
    return (value as any).documents.length;
}

function readGuardedOpenDocumentIds(value: unknown): number[] | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    if ((value as any).success === false || !Array.isArray((value as any).documents)) return undefined;
    const ids: number[] = [];
    for (const document of (value as any).documents) {
        const id = Number(document?.id);
        if (!Number.isSafeInteger(id) || id <= 0) return undefined;
        ids.push(id);
    }
    return ids;
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

    const guardedBaseline = options.guardedPhotoshopExecutionBaseline;
    if (guardedBaseline && isAgentToolExecutionGuarded(publicToolName, params)) {
        const baselineDecision = await enforceGuardedPhotoshopExecutionBaseline(
            guardedBaseline,
            publicToolName,
            {
                observePhotoshopRuntimeIdentity: async (): Promise<DebugBridgePhotoshopRuntimeLiveIdentity | undefined> => (
                    readGuardedPhotoshopRuntimeIdentity(await callPhotoshopMcpTool(
                        'diagnoseState',
                        { verbose: false },
                        { signal, timeoutMs: 5_000 }
                    ))
                ),
                observeOpenDocumentCount: async (): Promise<number | undefined> => (
                    readGuardedOpenDocumentCount(await callPhotoshopMcpTool(
                        'listDocuments',
                        { includeDetails: false },
                        { signal, timeoutMs: 5_000 }
                    ))
                ),
                observeOpenDocumentIds: async (): Promise<number[] | undefined> => (
                    readGuardedOpenDocumentIds(await callPhotoshopMcpTool(
                        'listDocuments',
                        { includeDetails: false, includePaths: false },
                        { signal, timeoutMs: 5_000 }
                    ))
                )
            }
        );
        if (!baselineDecision.ready) {
            return {
                success: false,
                code: 'guarded_first_photoshop_mutation_baseline_failed',
                policyGate: true,
                blockedTool: publicToolName,
                error: baselineDecision.error || '首次 Photoshop 写入隔离基线未通过。',
                firstPhotoshopMutationBaseline: baselineDecision.receipt,
                executesPhotoshop: false,
                countsAsTaskProgress: false
            };
        }
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

interface BoundPostWriteObservation {
    toolName: 'getCanvasSnapshot';
    params: Record<string, any>;
    captured: boolean;
    historyStateRef?: PhotoshopHistoryStateRef;
    writeHistoryStateRef?: PhotoshopHistoryStateRef;
    documentInfo?: Record<string, any>;
    verifiedSameDocumentVersion: boolean;
    error?: string;
}

interface BoundPostWriteObservationResult {
    observation: BoundPostWriteObservation;
    snapshot?: any;
    sourceResult?: Record<string, any>;
}

/**
 * 取得绑定到某次 Photoshop 写入版本的局部真实像素。
 *
 * 这里只负责采集与身份核对，不评价审美。所有复合视觉写工具复用同一实现，避免某条
 * 路径只返回“几何成功”却不给 Agent 看当前版本的真实画面。
 */
async function captureBoundPostWriteObservation(input: {
    region: { x: number; y: number; width: number; height: number };
    maxSize: number;
    writeHistoryStateRef?: PhotoshopHistoryStateRef;
    options: ToolCallExecutionOptions;
    sourceKind?: string;
    sourceId?: string;
}): Promise<BoundPostWriteObservationResult> {
    const params = {
        region: input.region,
        maxSize: input.maxSize,
        ...(input.writeHistoryStateRef?.documentId
            ? { expectedDocumentId: input.writeHistoryStateRef.documentId }
            : {})
    };
    const observationResult = await sendToPluginWithCancellation(
        'getCanvasSnapshot',
        params,
        getToolTimeout('getCanvasSnapshot', params),
        input.options,
        'getCanvasSnapshot'
    );
    if (observationResult && typeof observationResult === 'object' && !Array.isArray(observationResult)) {
        if (input.sourceKind) observationResult.sourceKind = input.sourceKind;
        if (input.sourceId) observationResult.sourceId = input.sourceId;
        markExecutedToolResultProvenance('getCanvasSnapshot', observationResult);
    }
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
    const captured = observationResult?.success !== false
        && typeof observationBase64 === 'string'
        && observationBase64.length > 0;
    const historyStateRef = readPhotoshopHistoryStateRef(observationResult);
    const verifiedSameDocumentVersion = captured
        && Boolean(input.writeHistoryStateRef)
        && samePhotoshopHistoryStateRef(input.writeHistoryStateRef, historyStateRef);
    let error: string | undefined;
    if (!captured) {
        error = String(observationResult?.error || 'getCanvasSnapshot 未返回可读取的画面');
    } else if (!verifiedSameDocumentVersion) {
        if (!input.writeHistoryStateRef) {
            error = '缺少最终写入后的 Host 文档版本，无法把快照绑定到本次写入';
        } else if (!historyStateRef) {
            error = '快照缺少 Host 文档版本，无法证明来自本次写入';
        } else {
            error = '写入后 Photoshop 文档或历史版本发生变化，快照不再对应本次最终写入';
        }
    }
    const snapshot = captured
        ? snapshotPayload || {
            base64: observationBase64,
            format: observationResult?.format || observationResult?.data?.format
        }
        : undefined;
    return {
        observation: {
            toolName: 'getCanvasSnapshot',
            params,
            captured,
            historyStateRef,
            writeHistoryStateRef: input.writeHistoryStateRef,
            documentInfo: observationResult?.documentInfo || observationResult?.data?.documentInfo,
            verifiedSameDocumentVersion,
            error
        },
        snapshot,
        sourceResult: observationResult && typeof observationResult === 'object'
            && !Array.isArray(observationResult)
            ? observationResult
            : undefined
    };
}

function readVisualObservationImagePayload(snapshot: unknown): VisualObservationImagePayload | undefined {
    if (typeof snapshot === 'string' && snapshot.length > 0) {
        return { base64: snapshot };
    }
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return undefined;
    const record = snapshot as Record<string, unknown>;
    const base64 = typeof record.base64 === 'string' ? record.base64 : undefined;
    const imageData = typeof record.imageData === 'string' ? record.imageData : undefined;
    const dataUrl = typeof record.dataUrl === 'string' ? record.dataUrl : undefined;
    if (!base64 && !imageData && !dataUrl) return undefined;
    return {
        ...(base64 ? { base64 } : {}),
        ...(imageData ? { imageData } : {}),
        ...(dataUrl ? { dataUrl } : {}),
        ...(typeof record.format === 'string' ? { format: record.format } : {}),
        ...(typeof record.mediaType === 'string' ? { mediaType: record.mediaType } : {})
    };
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
    const supportedKinds = new Set(['editable_confirmation']);
    if (cardKind && !supportedKinds.has(cardKind)) {
        return {
            success: false,
            error: `createInteractiveCard 不支持卡片类型「${cardKind}」。业务卡片只能由已选择的 Skill Provider 生成；普通选择请使用 askUserToChoose，可编辑草稿请使用 editable_confirmation。`
        };
    }
    if (cardKind === 'editable_confirmation') {
        if (!Array.isArray(params?.fields) || params.fields.length === 0) {
            return {
                success: false,
                error: 'editable_confirmation 至少需要一个可编辑字段；只有简短选择时请使用 askUserToChoose。'
            };
        }
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
    return {
        success: false,
        error: '未识别可创建的通用交互卡类型。'
    };
}
// ==================== 工具执行 ====================

/**
 * 执行工具调用
 */
const executeToolCallImpl = async (toolName: string, params: any, options: ToolCallExecutionOptions = {}): Promise<any> => {
    const startTime = Date.now();
    let dispatchedPhotoshopParams = params;
    let dispatchedPhotoshopAcceptanceBefore: AcceptanceCaptureResult | undefined;
    let dispatchedPhotoshopAcceptancePolicy: ToolAcceptanceCapturePolicy | undefined;
    let compoundWriteStartHistoryStateRef: PhotoshopHistoryStateRef | undefined;
    let compoundWriteExecutionArmed = false;
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
            const normalizedFakeResult = toolName === 'listDocuments'
                ? enrichPhotoshopDocumentInventory(
                    chatTestFakePhotoshopResult,
                    useAppStore.getState().currentProject?.path
                )
                : chatTestFakePhotoshopResult;
            if (normalizedFakeResult.success) {
                executedToolsInSession.push(toolName);
                recordToolExecution(toolName, params, normalizedFakeResult);
            }
            toolLogger.logToolCall(toolName, params, normalizedFakeResult, Date.now() - startTime, currentRound);
            return normalizedFakeResult;
        }

        // Renderer / Harness 本地工具在 Agent 端处理，禁止误发到 Photoshop UXP。
        if (RENDERER_LOCAL_TOOLS.includes(toolName)) {
            result = await executeResourceTool(toolName, params, options);
            if (result.success) executedToolsInSession.push(toolName);
            toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
            return result;
        }

        // 设计任务卡：模型写卡（角色与为什么 / 判断 / 清单），Harness 核收据打勾；完成 = 清单达成。
        if (toolName === 'planDesignTaskCard' || toolName === 'updateDesignTaskCard' || toolName === 'getDesignTaskCard') {
            const store = await import('./design-workshop/design-task-card.store');
            const taskCardScope = String(options.taskCardScope || '').trim();
            result = toolName === 'planDesignTaskCard'
                ? store.executePlanDesignTaskCard(taskCardScope, params)
                : toolName === 'updateDesignTaskCard'
                    ? store.executeUpdateDesignTaskCard(taskCardScope, params)
                    : store.executeGetDesignTaskCard(taskCardScope);
            if (result?.success) executedToolsInSession.push(toolName);
            toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
            return result;
        }

        // 让用户帮我选：Agent 拿不准时列选项。ask 模式返回 userChoiceRequest（Agent 循环据此暂停本轮）；
        // auto 模式不停下，按 Agent 自己倾向的选项继续（用户不在场时的全自动）。
        if (toolName === 'askUserToChoose') {
            const {
                canAutoResolveUserChoiceRequest,
                normalizeUserChoiceRequest,
                describeAutoDecision,
                describeChoiceRequestForModel
            } = await import('../../shared/user-choice-request');
            const normalized = normalizeUserChoiceRequest(params);
            if (!normalized.ok || !normalized.request) {
                result = { success: false, error: `askUserToChoose 选项没写全：${normalized.issues.join('；')}`, issues: normalized.issues };
            } else if (
                useAppStore.getState().agentDecisionMode === 'auto'
                && canAutoResolveUserChoiceRequest(normalized.request)
            ) {
                result = {
                    success: true,
                    mode: 'auto',
                    decisions: normalized.request.questions.map((question) => ({
                        question: question.question,
                        chosen: question.options.find((item) => item.id === question.recommendedId) || question.options[0]
                    })),
                    message: describeAutoDecision(normalized.request)
                };
            } else {
                result = {
                    success: true,
                    mode: 'ask',
                    userChoiceRequest: normalized.request,
                    message: useAppStore.getState().agentDecisionMode === 'auto'
                        ? `当前问题涉及用户事实或授权，不能由自动模式代替确认。${describeChoiceRequestForModel(normalized.request)}`
                        : describeChoiceRequestForModel(normalized.request)
                };
            }
            if (result?.success) executedToolsInSession.push(toolName);
            toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
            return result;
        }

        // 独立评审器：好不好看（四标准）+ 硬伤汇总 → 分数与可执行批评，写进任务卡「验」栏。不写 Photoshop。
        if (toolName === 'evaluateDesign') {
            const { executeEvaluateDesign } = await import('./design-workshop/evaluate-design.executor');
            result = await executeEvaluateDesign(params, {
                executeToolCall,
                invokeMain: (channel: string, ...args: any[]) => (window as any).designEcho.invoke(channel, ...args),
                readImageBase64: (filePath: string) => (window as any).designEcho?.readImageBase64?.(filePath),
                projectPath: useAppStore.getState().currentProject?.path,
                taskCardScope: options.taskCardScope,
                options
            });
            if (result?.success) executedToolsInSession.push(toolName);
            toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
            return result;
        }

        // 从用户指定的 Eagle 参考文件夹批量提取方法候选；进入长期知识人工审核队列，不自动发布。
        if (toolName === 'learnTasteFromEagle') {
            const { executeLearnTasteFromEagle } = await import('./design-workshop/learn-taste.executor');
            result = await executeLearnTasteFromEagle(params, {
                invokeMain: (channel: string, ...args: any[]) => (window as any).designEcho.invoke(channel, ...args),
                readImageBase64: (filePath: string) => (window as any).designEcho?.readImageBase64?.(filePath),
                projectPath: useAppStore.getState().currentProject?.path
            });
            if (result?.success) executedToolsInSession.push(toolName);
            toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
            return result;
        }

        // 看参考：带目的看一张参考——好在哪 / 差在哪 / 怎么做的 / 换成我们怎么改 / 起手式区域 / 沉淀
        if (toolName === 'studyReference') {
            const { executeStudyReference } = await import('./design-workshop/study-reference.executor');
            result = await executeStudyReference(params, {
                invokeMain: (channel: string, ...args: any[]) => (window as any).designEcho.invoke(channel, ...args),
                readImageBase64: (filePath: string) => (window as any).designEcho?.readImageBase64?.(filePath),
                projectPath: useAppStore.getState().currentProject?.path
            });
            if (result?.success) executedToolsInSession.push(toolName);
            toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
            return result;
        }

        // 经验闭环：自动观察只进候选区；用户「留 / 改 / 弃 + 为什么」发布为项目评审校准。
        // 时间线可读、可驳回；原则 / 配方 / 模型观察不能在在线运行里自行发布。
        if (toolName === 'recordDesignVerdict' || toolName === 'getDesignLearningTimeline' || toolName === 'proposeSkillImprovement') {
            const learning = await import('./design-workshop/design-learning.store');
            const invokeMain = (channel: string, ...args: any[]) => (window as any).designEcho.invoke(channel, ...args);
            const projectPath = useAppStore.getState().currentProject?.path;
            if (toolName === 'proposeSkillImprovement') {
                result = await learning.executeProposeSkillImprovement(invokeMain, projectPath, params);
            } else {
                result = toolName === 'recordDesignVerdict'
                    ? await learning.executeRecordDesignVerdict(invokeMain, projectPath, params, options.taskCardScope)
                    : await learning.executeGetDesignLearningTimeline(invokeMain, projectPath, params);
            }
            if (result?.success) executedToolsInSession.push(toolName);
            toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
            return result;
        }

        // 一次成稿车间：模型给完整设计稿（画布 / 背景方向 / 主体 / 构图 / 文案 / 视觉样式），
        // 车间串既有工具做完整张首稿（建画布 → 铺背景 → 执行构图 → 主体投影 → 回读）。
        // Photoshop 原生弹窗会同时阻塞 UXP 画布工具；应用窗口截图必须走 Electron Host，
        // 不能再发回同一条已堵塞的 Photoshop 工具链。Harness 只提供真实画面，后续恢复由 Agent 判断。
        if (toolName === 'capturePhotoshopWindow') {
            const capture = (window as any).designEcho?.capturePhotoshopWindowScreenshot;
            result = typeof capture === 'function'
                ? await capture()
                : {
                    success: false,
                    error: '当前运行环境没有提供 Photoshop 应用窗口截图能力。',
                    environmentState: 'photoshop_window_capture_unavailable'
                };
            if (result?.success) executedToolsInSession.push(toolName);
            toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
            return result;
        }

        // 只编排、不新造排版逻辑；每一步失败都指名道姓。
        if (toolName === 'composeDesign') {
            const { executeComposeDesign } = await import('./design-workshop/compose-design.executor');
            result = await executeComposeDesign(params, {
                executeToolCall,
                inferLayerId: inferFocusLayerId,
                invokeMain: (channel: string, ...args: any[]) => (window as any).designEcho.invoke(channel, ...args),
                projectPath: useAppStore.getState().currentProject?.path,
                taskScopeId: options.taskCardScope,
                options
            });
            if (result?.success) executedToolsInSession.push(toolName);
            toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
            return result;
        }

        // 声明式版面渲染：模型声明内容、视觉样式、语义区域、数组叠放顺序与可选列落位；
        // Harness 只换算坐标和应用确定性可读性约束，不能按 role 替模型改图层顺序或吸附区域。
        if (toolName === 'renderLayout') {
            const {
                rendersLayoutBlockAsImage,
                solveLayout,
                solveRegionLayout,
                validateModelAuthoredLayout
            } = await import('../../shared/layout/layout-engine');
            const { buildRenderLayoutStackPlan } = await import(
                '../../shared/layout/render-layout-stack-plan'
            );
            const { evaluateImagePlacementQuality } = await import('../../shared/layout/image-placement-quality');
            const {
                fitRenderLayoutTextToWidth,
                resolveRenderLayoutVisualStyle
            } = await import('../../shared/layout/render-layout-style');
            const { validateCreativeStagePlan } = await import('../../shared/creative-stage-plan');
            if (params.recipe !== undefined) {
                result = {
                    success: false,
                    status: 'failed',
                    qualityState: 'failed',
                    continuationRequired: true,
                    requiresVisualReview: false,
                    errors: [{
                        block: 'recipe',
                        role: 'layout',
                        error: '内置版式配方已移除；请由 Agent 显式声明 regions / blocks 与 visualStyle'
                    }],
                    warnings: [],
                    message: 'renderLayout 不再接受内置 recipe；本次未修改 Photoshop。开放设计由 Agent 声明构图，规格化生产应由对应 Skill 把用户或项目规范转换为显式布局参数。'
                };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
            const canvas = (params.canvas && params.canvas.width && params.canvas.height) ? params.canvas : null;
            const rawSpecBlocks = Array.isArray(params.blocks) ? params.blocks : [];
            const rawSpecRegions = Array.isArray(params.regions) ? params.regions : [];
            const rawOwnedLayers = Array.isArray(params.ownedLayers) ? params.ownedLayers : [];
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
            // composeDesign 的摄影优先路径已经按 Agent 声明的 main-image region 完成了
            // 商品图定位。此时 renderLayout 只负责把该既有图层收进语义图层组，不应为了
            // “至少还有一个待渲染区域”而逼 Agent 虚构文字或装饰。没有 ownedLayers 时仍
            // 保持原来的 fail-closed：普通模型调用不能用空布局绕过显式构图契约。
            const ownedLayerOnlyMode = specBlocks.length === 0
                && rawOwnedLayers.some((entry: any) => {
                    const layerId = Number(entry?.layerId);
                    const bucket = String(entry?.bucket || '图片');
                    return Number.isInteger(layerId)
                        && layerId > 0
                        && ['文案', '图标', '图片'].includes(bucket);
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
            if (specBlocks.length === 0 && !ownedLayerOnlyMode) {
                result = { success: false, error: 'renderLayout 需要 blocks（垂直堆叠：role + content + heightRatio）或 regions（二维构图：role + content + 归一化 bounds{x,y,width,height}）之一。非背景图层按 Agent 数组顺序从下到上叠放；Harness 只把比例换成像素，所以不要填像素坐标或 z。' };
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
            // Agent-authored 版面由调用方声明业务可读组名；staged 生产链可使用其稳定阶段身份。
            const stageId = String(params.stagePlan?.currentStage?.id || '').trim();
            const stageTitle = String(params.stagePlan?.currentStage?.title || '').replace(/\s+/g, ' ').trim().slice(0, 12);
            const explicitGroupName = String(params.groupName || '').replace(/\s+/g, ' ').trim();
            if (explicitGroupName.length > 40) {
                result = {
                    success: false,
                    error: 'renderLayout.groupName 最多 40 个字符；请使用与交付物和项目规范一致的简短语义名称。'
                };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
            // 组名用业务可读名（如「A-首屏KV·首屏KV」风格的 id·标题）——图层树本身就是详情页结构文档；
            // 替换识别见下方 isCurrentStageDraftGroupName（兼容旧「阶段草稿-{id}」格式）。
            let stageGroupName = explicitGroupName;
            if (!stageGroupName && stageId) {
                stageGroupName = stageTitle ? `${stageId}·${stageTitle}` : `阶段草稿-${stageId}`;
            }
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
            const modelAuthoredLayoutValidation = !ownedLayerOnlyMode
                && String(params.visualStyle?.mode || '').trim() === 'model_authored'
                ? validateModelAuthoredLayout({
                    mode: regionMode ? 'regions' : 'blocks',
                    marginScale: params.marginScale,
                    gapScale: params.gapScale,
                    gutterScale: params.gutterScale,
                    columns: params.columns,
                    blocks: regionMode ? undefined : specBlocks,
                    regions: regionMode ? specBlocks : undefined
                })
                : null;
            if (String(params.visualStyle?.mode || '').trim() === 'model_authored' && !stageGroupName) {
                result = {
                    success: false,
                    status: 'failed',
                    qualityState: 'failed',
                    continuationRequired: true,
                    requiresVisualReview: false,
                    errors: [{ block: 'groupName', role: 'layout', error: 'model_authored 正式版面缺少语义图层组名' }],
                    warnings: [],
                    message: 'renderLayout 在写入前拒绝了无语义分组的正式设计；请按交付物和当前项目规范提供 groupName。'
                };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
            if (modelAuthoredLayoutValidation && !modelAuthoredLayoutValidation.valid) {
                const layoutModeLabel = regionMode ? 'regions' : 'blocks';
                result = {
                    success: false,
                    status: 'failed',
                    qualityState: 'failed',
                    continuationRequired: true,
                    requiresVisualReview: false,
                    qualityFindings: [{
                        code: 'render_layout_model_authored_spec_invalid',
                        severity: 'repair',
                        closureKind: 'replan',
                        blockId: stageGroupName || 'renderLayout',
                        role: 'layout',
                        message: `model_authored ${layoutModeLabel} 缺少显式构图参数：${modelAuthoredLayoutValidation.issues.join('；')}。本次未修改 Photoshop 文档。`,
                        recommendedStrategies: regionMode
                            ? [
                                '为文字类 region 显式声明 hAlign',
                                '若声明 columns，同时显式选择 marginScale 与 gutterScale；只有需要列落位的 region 才声明 columnPlacement'
                            ]
                            : [
                                '显式选择 marginScale 与 gapScale 档位',
                                '为每个非背景 block 声明 heightRatio、widthRatio 与 hAlign，且高度比例总和不超过 1'
                            ]
                    }],
                    errors: modelAuthoredLayoutValidation.issues.map((issue) => ({
                        block: layoutModeLabel,
                        role: 'layout',
                        error: issue
                    })),
                    warnings: [],
                    message: `renderLayout 在写入前拒绝了会触发隐藏构图默认值的正式 ${layoutModeLabel}；没有替模型选择版心、间距、比例或对齐。`
                };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
            // 版面结构参数：边距/间距的唯一来源是栅格刻度，模型只能选档位不能给像素。
            // neutral_wireframe 必须显式请求；model_authored 已在上方按显式契约校验。
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
            let solveOutcome: ReturnType<typeof solveLayout>;
            if (ownedLayerOnlyMode) {
                solveOutcome = { blocks: [], warnings: [], grid: undefined };
            } else if (regionMode) {
                solveOutcome = solveRegionLayout({ canvas: solveCanvas, ...gridOptions, regions: specBlocks });
            } else {
                solveOutcome = solveLayout({ canvas: solveCanvas, ...gridOptions, gapScale, blocks: specBlocks });
            }
            const warnings = [...solveOutcome.warnings];
            const resolved = screenRegion
                ? solveOutcome.blocks.map((block) => ({ ...block, y: block.y + screenRegion.y }))
                : solveOutcome.blocks;
            const placementPreflight = await preflightResolvedImagePlacements({
                blocks: resolved,
                canvas,
                executorLabel: 'renderLayout',
                readAssetSubjectBox: (sourcePath: string) => (
                    (window as any).designEcho?.invoke?.('resource:getAssetSubjectBox', sourcePath)
                )
            });
            const placementPreflightFindings = placementPreflight.findings;
            const placementPrewritePlansByBlockId = placementPreflight.plansByBlockId;
            const { verifySubjectFitResult } = await import('../../shared/subject-fit');
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
            const bgHex = (String(specBlocks.find((b: any) => b.role === 'background')?.content || '')
                .match(/#[0-9a-fA-F]{6}/) || [])[0];
            // 配方 background:'none'（车间已铺背景层）时不再画纯色底，但对比度校验仍按声明的页面底色算。
            const pageBackgroundHint = (String(params.pageBackgroundHex || '').match(/#[0-9a-fA-F]{6}/) || [])[0];
            const styleResolution = resolveRenderLayoutVisualStyle({
                backgroundHex: bgHex || pageBackgroundHint,
                visualStyle: params.visualStyle
            });
            if (!styleResolution.ok || !styleResolution.style) {
                result = {
                    success: false,
                    status: 'failed',
                    qualityState: 'failed',
                    continuationRequired: true,
                    requiresVisualReview: false,
                    qualityFindings: [{
                        code: 'render_layout_visual_style_invalid',
                        severity: 'repair',
                        closureKind: 'replan',
                        blockId: stageGroupName || 'renderLayout',
                        role: 'layout',
                        message: `visualStyle 无法执行：${styleResolution.issues.join('；')}。本次未修改 Photoshop 文档。`,
                        recommendedStrategies: [
                            '由当前 R3 设计策略声明完整的 model_authored 颜色与字体层级',
                            '若只需要验证结构，显式使用 neutral_wireframe，并在正式交付前替换为 model_authored'
                        ]
                    }],
                    errors: styleResolution.issues.map((issue) => ({
                        block: 'visualStyle',
                        role: 'layout',
                        error: issue
                    })),
                    warnings,
                    // 拒绝必须可执行：给出缺什么 + 一份最小合法样式骨架，模型才能一次改对（真机 run [471] 连拒两次后放弃该工具）。
                    message: `renderLayout 在写入前拒绝了无效视觉样式（${styleResolution.issues.slice(0, 6).join('；')}）；没有用代码默认审美替代模型选择。`
                        + ' 修正提示：mode 取 model_authored 时需完整给出 palette{primaryTextColorHex,secondaryTextColorHex,accentColorHex,sellingPointTextColorHex[,sellingPointFillColorHex]}、'
                        + 'sellingPoint{treatment:text_only|solid_box,cornerRadiusRatio 0–0.5,paddingRatio 0–0.2}、'
                        + 'typography{title,subtitle,body,sellingPoint 各含已确认可写的 fontName,fontSizeRatio 0.08–0.9,minFontSizeRatio ≤fontSizeRatio,fitMode:none|shrink_to_width,tracking,leadingRatio 0.8–2}；'
                        + '只想先看结构可用 mode:neutral_wireframe；也可以改用 createTextLayer/placeImage 等原子工具直接排。'
                };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
            const style = styleResolution.style;
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
                        if (style.sellingPointTreatment === 'solid_box') names.add(`${id}-底块`);
                        names.add(`${id}-文字`);
                    } else if (role === 'main-image' || role === 'decoration' || role === 'tag') {
                        // 这三类块既可能是真实图片，也可能在旧草稿中留下占位层；
                        // tag / decoration 的非图片内容现在按文字渲染，名称同样是 id。
                        // 同时纳入两种稳定名称，确保重渲染不会把旧占位或旧文字留在画布上。
                        names.add(id);
                        names.add(`${id}-占位`);
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
            const validatedOwnedLayers: Array<{
                layerId: number;
                bucket: '文案' | '图标' | '图片';
                blockId: string;
                stackOrder: number;
                originalParentId: number | null;
            }> = [];
            let previousStageGroups: any[] = [];
            let deferredOwnedAncestorGroups: any[] = [];
            let previousReusableLayers: any[] = [];
            const reusableDraftLayerNames = buildExpectedTopLevelDraftLayerNames();
            if (stageGroupName || reusableDraftLayerNames.size > 0 || rawOwnedLayers.length > 0) {
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
                const ownedLayerPreflightIssues: string[] = [];
                const seenOwnedLayerIds = new Set<number>();
                for (const ownedLayer of rawOwnedLayers) {
                    const layerId = Number(ownedLayer?.layerId);
                    const bucket = String(ownedLayer?.bucket || '图片');
                    const stackOrder = Number(ownedLayer?.stackOrder);
                    const blockId = String(ownedLayer?.blockId || `owned-layer-${String(ownedLayer?.layerId)}`).trim();
                    if (!Number.isInteger(layerId) || layerId <= 0) {
                        ownedLayerPreflightIssues.push(`ownedLayers 含无效 layerId=${String(ownedLayer?.layerId)}`);
                        continue;
                    }
                    if (!['文案', '图标', '图片'].includes(bucket)) {
                        ownedLayerPreflightIssues.push(`ownedLayers 图层 ${layerId} 的 bucket「${bucket}」无效`);
                        continue;
                    }
                    if (style.mode === 'model_authored' && !Number.isFinite(stackOrder)) {
                        ownedLayerPreflightIssues.push(
                            `ownedLayers 图层 ${layerId} 缺少原始 stackOrder，无法兑现 Agent 数组层序`
                        );
                        continue;
                    }
                    if (seenOwnedLayerIds.has(layerId)) {
                        ownedLayerPreflightIssues.push(`ownedLayers 重复引用图层 ${layerId}`);
                        continue;
                    }
                    const ownedLayerNode = layersBefore.find(
                        (layer: any) => Number(layer?.id) === layerId
                    );
                    if (!ownedLayerNode) {
                        ownedLayerPreflightIssues.push(`ownedLayers 引用了当前文档中不存在的图层 ${layerId}`);
                        continue;
                    }
                    seenOwnedLayerIds.add(layerId);
                    validatedOwnedLayers.push({
                        layerId,
                        bucket: bucket as '文案' | '图标' | '图片',
                        blockId,
                        stackOrder: Number.isFinite(stackOrder) ? stackOrder : -1,
                        originalParentId: Number.isInteger(Number(ownedLayerNode?.parentId))
                            && Number(ownedLayerNode.parentId) > 0
                            ? Number(ownedLayerNode.parentId)
                            : null
                    });
                }
                if (ownedLayerPreflightIssues.length > 0) {
                    result = {
                        success: false,
                        status: 'failed',
                        qualityState: 'failed',
                        continuationRequired: true,
                        requiresVisualReview: false,
                        noMutation: true,
                        errors: ownedLayerPreflightIssues.map((error) => ({
                            block: stageGroupName || 'renderLayout',
                            role: 'owned-layer',
                            error
                        })),
                        warnings,
                        message: `renderLayout 在替换旧稿前拒绝了失效的 ownedLayers：${ownedLayerPreflightIssues.join('；')}。本次未删除或创建任何图层。`
                    };
                    toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                    return result;
                }
                const ownedLayerIds = new Set(validatedOwnedLayers.map((item) => item.layerId));
                // 逐屏保真（2026-07-06 修正）：只替换「当前 stageId」的旧草稿组——换 stageId 是在做新屏，
                // 其他屏的组必须保留（此前全前缀清除会把已完成屏一并删掉，详情页最终只剩最后一屏）。
                // 无 stageId（未带 stagePlan 的通用重排）时保持原全清语义，避免旧草稿叠加。
                const isCurrentStageDraftGroupName = (name: string): boolean => {
                    if (!name) return false;
                    if (name === `${stageGroupName}·新稿待切换`) return true;
                    if (explicitGroupName) return name === explicitGroupName;
                    if (stageId) {
                        return name === `阶段草稿-${stageId}`
                            || name === stageGroupName
                            || name.startsWith(`${stageId}·`);
                    }
                    return /^阶段草稿-/.test(name);
                };
                const matchingPreviousStageGroups = layersBefore
                    .filter((layer: any) => isCurrentStageDraftGroupName(String(layer?.name || '')))
                    .filter((layer: any) => String(layer?.kind || '').toLowerCase().includes('group') || Array.isArray(layer?.children) || Array.isArray(layer?.layers));
                // owned layer 可能是旧组的后代。只比较组自身 ID 会让 deleteLayer
                // 连同已验证要复用的子层一起删除。含 owned 后代的祖先组必须延迟到新组
                // 收纳并读回这些 owned layer 之后，再用最新 hierarchy 重新判定是否可删。
                previousStageGroups = matchingPreviousStageGroups
                    .filter((layer: any) => !hierarchyNodeContainsAnyLayerId(layer, ownedLayerIds));
                deferredOwnedAncestorGroups = matchingPreviousStageGroups
                    .filter((layer: any) => hierarchyNodeContainsAnyLayerId(layer, ownedLayerIds));
                const matchedPreviousStageGroupIds = new Set(
                    matchingPreviousStageGroups.map((layer: any) => Number(layer?.id))
                );
                previousReusableLayers = layersBefore
                    .filter((layer: any) => Number(layer?.depth || 0) === 0 || layer?.parentName == null)
                    .filter((layer: any) => !ownedLayerIds.has(Number(layer?.id)))
                    .filter((layer: any) => !matchedPreviousStageGroupIds.has(Number(layer?.id)))
                    .filter((layer: any) => reusableDraftLayerNames.has(String(layer?.name || '')));
            }
            if (!layoutStartHistoryStateRef) {
                const startDocumentInfo = await executeToolCall('getDocumentInfo', {}, options);
                layoutStartHistoryStateRef = readPhotoshopHistoryStateRef(startDocumentInfo);
            }
            // 所有写前语义/owned-layer 校验都已通过；从这里开始任何异常都必须按复合写结算。
            compoundWriteStartHistoryStateRef = layoutStartHistoryStateRef;
            compoundWriteExecutionArmed = true;
            const created = [];
            const errors = [];
            const cleanupFailures: Array<{
                layerId: number;
                blockId: string;
                role: string;
                reason: string;
                error: string;
            }> = [];
            const cleanedCreatedLayerIds = new Set<number>();
            const cleanupCreatedLayer = async (
                layerId: number | undefined,
                blockId: string,
                role: string,
                reason: string
            ): Promise<boolean> => {
                if (!Number.isInteger(layerId) || Number(layerId) <= 0) return true;
                const cleanupResult = await executeToolCall(
                    'deleteLayer',
                    { layerId: Number(layerId) },
                    options
                );
                if (cleanupResult?.success === true) {
                    cleanedCreatedLayerIds.add(Number(layerId));
                    return true;
                }
                const cleanupError = String(cleanupResult?.error || 'deleteLayer failed');
                cleanupFailures.push({
                    layerId: Number(layerId),
                    blockId,
                    role,
                    reason,
                    error: cleanupError
                });
                errors.push({
                    block: blockId,
                    role,
                    error: `${reason}后清理图层 ${layerId} 失败：${cleanupError}；该图层可能仍留在当前文档，不能把失败当成无副作用。`
                });
                return false;
            };
            const createdLayerIds: number[] = [];
            const imagePlacementReceipts: any[] = [];
            const textFitReceipts: Array<{
                blockId: string;
                originalContent: string;
                finalContent: string;
                originalFontSize: number;
                finalFontSize: number;
                fitApplied: boolean;
                wrapped: boolean;
            }> = [];
            const qualityFindings: any[] = [];
            if (style.mode === 'neutral_wireframe') {
                qualityFindings.push({
                    code: 'render_layout_neutral_wireframe_unresolved',
                    severity: 'review',
                    closureKind: 'replan',
                    blockId: stageGroupName || 'renderLayout',
                    role: 'layout',
                    message: '当前 renderLayout 使用中性线框样式，只能验证信息结构和几何关系，不能作为正式视觉设计交付。',
                    recommendedStrategies: [
                        '基于已选 R3 视觉方向声明 model_authored visualStyle 后重新渲染',
                        '结合当前画面观察调整配色、字体层级和卖点表现，再进入最终评审'
                    ]
                });
            }
            const clippingPairs: Array<{
                blockId: string;
                layerId: number;
                baseLayerId: number;
                receipt: any;
            }> = [];
            // 三桶只服务 neutral/staged 兼容结构；model_authored 使用独立 stack ledger。
            const createdLayerBuckets = new Map<number, '文案' | '图标' | '图片'>();
            const modelAuthoredStackUnits: Array<{
                blockId: string;
                stackOrder: number;
                layerIdsBottomToTop: number[];
            }> = validatedOwnedLayers.map((ownedLayer) => ({
                blockId: ownedLayer.blockId,
                stackOrder: ownedLayer.stackOrder,
                layerIdsBottomToTop: [ownedLayer.layerId]
            }));
            for (const ownedLayer of validatedOwnedLayers) {
                createdLayerIds.push(ownedLayer.layerId);
                createdLayerBuckets.set(ownedLayer.layerId, ownedLayer.bucket);
            }
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
                const rendersAsRealImage = rendersLayoutBlockAsImage(b);
                const imageSourcePath = rendersAsRealImage
                    ? String(b.content)
                    : null;
                const rendersAsImage = b.role === 'main-image'
                    || rendersAsRealImage;
                // 仅当 main-image 块真正置入了素材图时，其图层才算"主体"；占位灰矩形不是真实主体，
                // 不能进 subjectLayerIds（否则下游把占位块面积当主体占比，伪造"主体充足"掩盖"无真实主体"）。
                let mainImageHasRealSrc = false;
                if (b.role === 'background') {
                    r = await executeToolCall('createRectangle', { x: b.x, y: b.y, width: b.width, height: b.height, fillColorHex: style.pageBackgroundColorHex, name: '背景' }, options);
                } else if (rendersAsImage) {
                    const src = imageSourcePath;
                    if (src) {
                        const placement: Partial<ImagePlacementSpec> = b.imagePlacement && typeof b.imagePlacement === 'object'
                            ? b.imagePlacement
                            : {};
                        const targetFit = placement.fit === 'cover' ? 'cover' : 'contain';
                        let actualPlacementBounds: any;
                        let actualSubjectBounds: any;
                        let placementSubjectDetection: any;
                        let subjectFitVerification: any;
                        let executionPlacement: any;
                        const prewritePlan = placementPrewritePlansByBlockId.get(b.id);
                        const onePassSubjectFit = prewritePlan?.subjectFill?.geometryPlan;
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
                                if (clippingBaseLayerId) {
                                    await cleanupCreatedLayer(
                                        clippingBaseLayerId,
                                        b.id,
                                        b.role,
                                        '裁切基底创建失败但执行结果仍返回图层身份'
                                    );
                                    clippingBaseLayerId = undefined;
                                }
                                continue;
                            }
                        }

                        const finalTargetBounds = prewritePlan?.finalWrite?.targetBounds
                            || { x: b.x, y: b.y, width: b.width, height: b.height };
                        // 有真实素材时，所有可预演语义都在写入前求出最终图框；placeImage 的第一次写入
                        // 就使用最终 targetBounds。subjectFillRatio 不再走 place → fit 的二次修补路径。
                        r = await executeToolCall('placeImage', {
                            filePath: src,
                            name: b.id,
                            targetBounds: finalTargetBounds,
                            targetFit: prewritePlan?.finalWrite?.fit || targetFit,
                            targetAnchor: prewritePlan?.finalWrite?.anchor || placement.anchor,
                            ...(prewritePlan?.finalWrite?.focalPoint
                                ? { focalPoint: prewritePlan.finalWrite.focalPoint }
                                : {})
                        }, options);
                        if (b.role === 'main-image') mainImageHasRealSrc = true;

                        const placedLayerId = inferFocusLayerId('placeImage', {}, r);
                        actualPlacementBounds = r?.data?.bounds || r?.bounds;
                        executionPlacement = r?.data?.placement || r?.placement;
                        if (r?.success === false) {
                            if (placedLayerId) {
                                await cleanupCreatedLayer(
                                    placedLayerId,
                                    b.id,
                                    b.role,
                                    '图片置入失败且执行结果仍返回图层身份'
                                );
                            }
                            if (clippingBaseLayerId) {
                                await cleanupCreatedLayer(
                                    clippingBaseLayerId,
                                    b.id,
                                    b.role,
                                    '图片置入失败'
                                );
                            }
                            clippingBaseLayerId = undefined;
                        } else if (needsRectangularClip && !placedLayerId && clippingBaseLayerId) {
                            errors.push({
                                block: b.id,
                                role: b.role,
                                error: 'cover 置入没有返回真实图片 layerId，不能安全创建剪切蒙版。'
                            });
                            await cleanupCreatedLayer(
                                clippingBaseLayerId,
                                b.id,
                                b.role,
                                '置入结果缺少图片图层身份'
                            );
                            clippingBaseLayerId = undefined;
                            continue;
                        }

                        // 写前主体框来自源素材；写后用 UXP 返回的真实图框重新投影并核对主体占比。
                        // 这里只做几何验证，不因为数值达成就声明审美通过。
                        if (r?.success !== false
                            && placedLayerId
                            && onePassSubjectFit
                            && prewritePlan?.source?.subject?.box) {
                            const actualFrame = toSubjectRect(actualPlacementBounds);
                            if (actualFrame) {
                                const frameWidth = actualFrame.right - actualFrame.left;
                                const frameHeight = actualFrame.bottom - actualFrame.top;
                                const relativeSubject = prewritePlan.source.subject.box;
                                actualSubjectBounds = {
                                    left: actualFrame.left + frameWidth * relativeSubject.x,
                                    top: actualFrame.top + frameHeight * relativeSubject.y,
                                    right: actualFrame.left + frameWidth * (relativeSubject.x + relativeSubject.width),
                                    bottom: actualFrame.top + frameHeight * (relativeSubject.y + relativeSubject.height)
                                };
                                subjectFitVerification = verifySubjectFitResult({
                                    actualSubjectBounds,
                                    targetRegion: { x: b.x, y: b.y, width: b.width, height: b.height },
                                    requestedFillRatio: Number(placement.subjectFillRatio),
                                    anchor: placement.anchor as any,
                                    projectedSubject: onePassSubjectFit.projectedSubject
                                });
                                placementSubjectDetection = {
                                    method: `asset:${prewritePlan.source.subject.method}`,
                                    confidence: prewritePlan.source.subject.confidence,
                                    relativeBox: relativeSubject,
                                    note: '写入前从源素材取得主体框；写后按同一源图相对框投影到 UXP 真实图框'
                                };
                            } else {
                                subjectFitVerification = {
                                    status: 'failed',
                                    warnings: ['placeImage 未返回可解析的真实图框，无法验证一次落位后的主体占比。']
                                };
                            }
                        }

                        if (needsRectangularClip && placedLayerId && clippingBaseLayerId) {
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
                                await cleanupCreatedLayer(
                                    placedLayerId,
                                    b.id,
                                    b.role,
                                    '剪切蒙版创建失败'
                                );
                                await cleanupCreatedLayer(
                                    clippingBaseLayerId,
                                    b.id,
                                    b.role,
                                    '剪切蒙版创建失败'
                                );
                                clippingBaseLayerId = undefined;
                                continue;
                            }
                        }

                        if (r?.success !== false) {
                            // 只有 Agent 声明 protect-subject 时才为裁切事实做主体检测；allow-crop 仅返回
                            // 图框裁切事实并交给视觉模型判断，避免 Harness 把检测器变成审美裁判。
                            if (placedLayerId
                                && placement.cropPolicy === 'protect-subject'
                                && !actualSubjectBounds) {
                                const placementLayerBoundsResult = await executeToolCall(
                                    'getLayerBounds',
                                    { layerId: placedLayerId },
                                    options
                                );
                                const placementFrameRaw = placementLayerBoundsResult?.boundsNoEffects
                                    || placementLayerBoundsResult?.bounds;
                                const placementFrameRect = toSubjectRect(placementFrameRaw);
                                if (placementFrameRect) {
                                    actualPlacementBounds = placementFrameRaw;
                                    const placementDocInfo = await executeToolCall('getDocumentInfo', {}, options);
                                    const resolvedPlacementSubject = await resolveLayerSubjectBounds({
                                        layerId: placedLayerId,
                                        frameBounds: placementFrameRect,
                                        requestedMethod: 'auto',
                                        documentId: readResultDocumentId(placementDocInfo),
                                        options
                                    });
                                    actualSubjectBounds = resolvedPlacementSubject.bounds;
                                    placementSubjectDetection = {
                                        method: resolvedPlacementSubject.method,
                                        confidence: resolvedPlacementSubject.confidence,
                                        note: resolvedPlacementSubject.note,
                                        ...(resolvedPlacementSubject.relativeBox
                                            ? { relativeBox: resolvedPlacementSubject.relativeBox }
                                            : {})
                                    };
                                }
                            }
                            const evaluatedPlacement = evaluateImagePlacementQuality({
                                block: b,
                                layerId: placedLayerId,
                                actualBounds: actualPlacementBounds,
                                actualSubjectBounds,
                                subjectDetection: placementSubjectDetection,
                                subjectFitVerification,
                                executionPlacement,
                                clippingApplied,
                                clippingBaseLayerId,
                                canvas
                            });
                            placementReceipt = {
                                ...evaluatedPlacement,
                                ...(prewritePlan?.normalPreview
                                    ? {
                                        prewritePreview: prewritePlan.normalPreview,
                                        prewriteFinalWrite: prewritePlan.finalWrite
                                    }
                                    : {}),
                                executionMode: onePassSubjectFit
                                    ? 'precomputed_subject_fit_single_place'
                                    : 'precomputed_target_fit_single_place'
                            };
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
                        r = await executeToolCall('createRectangle', {
                            x: b.x,
                            y: b.y,
                            width: b.width,
                            height: b.height,
                            fillColorHex: style.placeholderFillColorHex,
                            cornerRadius: 8,
                            name: `${b.id}-占位`
                        }, options);
                        if (b.role === 'main-image' && r?.success !== false) {
                            const placeholderLayerId = inferFocusLayerId('createRectangle', {}, r);
                            createdEntryExtras = {
                                layerId: placeholderLayerId,
                                placeholder: true,
                                sourceKind: 'placeholder'
                            };
                            qualityFindings.push({
                                code: 'main_image_placeholder_unresolved',
                                severity: 'repair',
                                closureKind: placeholderLayerId ? 'mutation' : 'replan',
                                blockId: b.id,
                                role: b.role,
                                layerId: placeholderLayerId,
                                message: `主视觉块「${b.id}」没有真实素材，当前灰色矩形只是占位，不能作为主图主体或成品交付。`,
                                recommendedAction: placeholderLayerId
                                    ? {
                                        toolName: 'replaceImagePlaceholder',
                                        params: { placeholderLayerId },
                                        reason: '用已观察且来源明确的真实图片原位替换该占位层；该工具的 acceptance 会验证旧占位消失、新图层层级与落位。替换后仍需读取同文档最新结构和当前画面。'
                                    }
                                    : undefined,
                                recommendedStrategies: [
                                    '从已观察且来源明确的项目素材中选择真实商品图并置入该区域',
                                    '置入后重新读取最终图层结构和当前画面，确认占位层已经移除或替换'
                                ]
                            });
                        }
                    }
                } else if (b.role === 'selling-point') {
                    const boxResult = style.sellingPointTreatment === 'solid_box'
                        ? await executeToolCall('createRectangle', {
                            x: b.x,
                            y: b.y,
                            width: b.width,
                            height: b.height,
                            fillColorHex: style.sellingPointBoxFillColorHex,
                            cornerRadius: Math.round(
                                Math.min(b.width, b.height) * style.sellingPointCornerRadiusRatio
                            ),
                            name: `${b.id}-底块`
                        }, options)
                        : null;
                    const paddingX = b.width * style.sellingPointPaddingRatio;
                    const sellingPointTypography = style.typography.sellingPoint;
                    const originalContent = String(b.content ?? '');
                    const originalFontSize = b.height * sellingPointTypography.fontSizeRatio;
                    const fittedText = fitRenderLayoutTextToWidth({
                        content: originalContent,
                        maxWidth: Math.max(1, b.width - paddingX * 2),
                        desiredFontSize: originalFontSize,
                        minFontSize: b.height * sellingPointTypography.minFontSizeRatio,
                        fitMode: sellingPointTypography.fitMode,
                        tracking: sellingPointTypography.tracking
                    });
                    textFitReceipts.push({
                        blockId: b.id,
                        originalContent,
                        finalContent: fittedText.content,
                        originalFontSize,
                        finalFontSize: fittedText.fontSize,
                        fitApplied: fittedText.fitApplied,
                        wrapped: fittedText.wrapped
                    });
                    const textHeight = fittedText.fontSize * sellingPointTypography.leadingRatio;
                    const textResult = await executeToolCall('createTextLayer', {
                        content: fittedText.content,
                        x: b.x + paddingX,
                        y: b.y + Math.max(0, (b.height - textHeight) / 2),
                        fontSize: fittedText.fontSize,
                        ...(sellingPointTypography.fontName
                            ? { fontName: sellingPointTypography.fontName }
                            : {}),
                        tracking: sellingPointTypography.tracking,
                        leading: fittedText.fontSize * sellingPointTypography.leadingRatio,
                        colorHex: sellingPointTypography.colorHex,
                        alignment: b.hAlign || 'left',
                        name: `${b.id}-文字`
                    }, options);
                    const boxLayerId = inferFocusLayerId('createRectangle', {}, boxResult);
                    const textLayerId = inferFocusLayerId('createTextLayer', {}, textResult);
                    // 每个成功原子写都必须立即进入 retained ledger。不能等同组的后续文字也成功
                    // 才登记底块，否则“底块已创建、文字失败”会让真实图层从失败收据中消失。
                    if (boxLayerId) {
                        createdLayerIds.push(boxLayerId);
                        createdLayerBuckets.set(boxLayerId, '图片');
                    }
                    if (textLayerId) {
                        createdLayerIds.push(textLayerId);
                        createdLayerBuckets.set(textLayerId, '文案');
                    }
                    const sellingPointLayerIds = [boxLayerId, textLayerId]
                        .filter((layerId): layerId is number => Number.isInteger(layerId) && Number(layerId) > 0);
                    if (sellingPointLayerIds.length > 0) {
                        modelAuthoredStackUnits.push({
                            blockId: b.id,
                            stackOrder: b.z,
                            layerIdsBottomToTop: sellingPointLayerIds
                        });
                    }
                    if (boxResult && boxResult.success === false) errors.push({ block: b.id, role: b.role, error: boxResult.error });
                    if (textResult && textResult.success === false) errors.push({ block: b.id, role: b.role, error: textResult.error });
                    if (!(boxResult && boxResult.success === false) && !(textResult && textResult.success === false)) {
                        created.push({ id: b.id, role: b.role, x: b.x, y: b.y, width: b.width, height: b.height });
                    }
                    continue;
                } else {
                    let typography = style.typography.body;
                    if (b.role === 'title') typography = style.typography.title;
                    else if (b.role === 'subtitle') typography = style.typography.subtitle;
                    else if (b.role === 'tag' || b.role === 'decoration') {
                        typography = {
                            ...style.typography.body,
                            colorHex: style.accentColorHex
                        };
                    }
                    const originalContent = String(b.content ?? '');
                    const originalFontSize = b.height * typography.fontSizeRatio;
                    const fittedText = fitRenderLayoutTextToWidth({
                        content: originalContent,
                        maxWidth: Math.max(1, b.width),
                        desiredFontSize: originalFontSize,
                        minFontSize: b.height * typography.minFontSizeRatio,
                        fitMode: typography.fitMode,
                        tracking: typography.tracking
                    });
                    textFitReceipts.push({
                        blockId: b.id,
                        originalContent,
                        finalContent: fittedText.content,
                        originalFontSize,
                        finalFontSize: fittedText.fontSize,
                        fitApplied: fittedText.fitApplied,
                        wrapped: fittedText.wrapped
                    });
                    r = await executeToolCall('createTextLayer', {
                        content: fittedText.content,
                        x: b.x,
                        y: b.y,
                        fontSize: fittedText.fontSize,
                        ...(typography.fontName ? { fontName: typography.fontName } : {}),
                        tracking: typography.tracking,
                        leading: fittedText.fontSize * typography.leadingRatio,
                        colorHex: typography.colorHex,
                        alignment: b.hAlign || 'left',
                        name: b.id
                    }, options);
                }
                if (r && r.success === false) errors.push({ block: b.id, role: b.role, error: r.error });
                else {
                    const layerId = inferFocusLayerId(
                        rendersAsImage ? (imageSourcePath ? 'placeImage' : 'createRectangle')
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
                                : rendersAsImage ? '图标'
                                    : '文案'
                        );
                    }
                    if (clippingBaseLayerId) {
                        createdLayerIds.push(clippingBaseLayerId);
                        createdLayerBuckets.set(clippingBaseLayerId, '图片');
                    }
                    const blockLayerIds = [clippingBaseLayerId, layerId]
                        .filter((candidate): candidate is number => (
                            Number.isInteger(candidate) && Number(candidate) > 0
                        ));
                    if (blockLayerIds.length > 0) {
                        modelAuthoredStackUnits.push({
                            blockId: b.id,
                            stackOrder: b.z,
                            layerIdsBottomToTop: blockLayerIds
                        });
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
            let stageGroupId: number | undefined;
            let stageSubgroupIds: Partial<Record<'文案' | '图标' | '图片', number>> = {};
            let stageSwapReceipt: Record<string, unknown> | undefined;
            let modelAuthoredStackReceipt: Record<string, unknown> | undefined;
            const hasStageReplacementTargets = previousStageGroups.length > 0
                || deferredOwnedAncestorGroups.length > 0
                || previousReusableLayers.length > 0;
            const stageCandidateGroupName = stageGroupName && hasStageReplacementTargets
                ? `${stageGroupName}·新稿待切换`
                : stageGroupName;
            let stageCandidatePromoted = stageCandidateGroupName === stageGroupName;
            if (stageGroupName && errors.length === 0 && createdLayerIds.length > 0) {
                stageGroupResult = await executeToolCall('createGroup', {
                    groupName: stageCandidateGroupName
                }, options);
                const groupId = inferFocusLayerId('createGroup', {}, stageGroupResult);
                stageGroupId = groupId;
                stageRefreshActions.push({
                    action: 'createStageGroup',
                    groupName: stageCandidateGroupName,
                    finalGroupName: stageGroupName,
                    groupId,
                    success: stageGroupResult?.success !== false
                });
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
                    if (style.mode === 'model_authored') {
                        const stackPlan = buildRenderLayoutStackPlan(modelAuthoredStackUnits);
                        const stackLayerIds = new Set(stackPlan.layerIdsBottomToTop);
                        const missingLayerIds = createdLayerIds.filter((layerId) => !stackLayerIds.has(layerId));
                        modelAuthoredStackReceipt = {
                            version: 'render-layout-stack-receipt/v0',
                            source: 'agent_array_order',
                            valid: stackPlan.valid && missingLayerIds.length === 0,
                            issues: [...stackPlan.issues],
                            missingLayerIds,
                            expectedLayerIdsBottomToTop: stackPlan.layerIdsBottomToTop,
                            expectedLayerIdsTopToBottom: stackPlan.layerIdsTopToBottom,
                            units: stackPlan.unitsBottomToTop
                        };
                        if (!stackPlan.valid || missingLayerIds.length > 0) {
                            errors.push({
                                block: stageGroupName,
                                role: 'stage-group',
                                error: `model_authored 层序账本无效：${[
                                    ...stackPlan.issues,
                                    ...(missingLayerIds.length > 0
                                        ? [`未登记图层 ${missingLayerIds.join('、')}`]
                                        : [])
                                ].join('；')}`
                            });
                        } else {
                            for (const layerId of stackPlan.layerIdsBottomToTop) {
                                const moveResult = await executeToolCall('moveLayerToGroup', {
                                    layerId,
                                    targetGroupId: groupId,
                                    position: 'inside-top'
                                }, options);
                                stageRefreshActions.push({
                                    action: 'moveModelAuthoredLayerByStackLedger',
                                    layerId,
                                    groupId,
                                    position: 'inside-top',
                                    success: moveResult?.success !== false
                                });
                                if (moveResult?.success === false) {
                                    errors.push({
                                        block: stageGroupName,
                                        role: 'stage-group',
                                        error: moveResult.error || `moveLayerToGroup failed for ${layerId}`
                                    });
                                }
                            }
                            if (errors.length === 0) {
                                const stackReadback = await executeToolCall(
                                    'getLayerHierarchy',
                                    { includeBounds: false },
                                    options
                                );
                                const stackHierarchy = Array.isArray(stackReadback?.hierarchy)
                                    ? stackReadback.hierarchy
                                    : Array.isArray(stackReadback?.layers) ? stackReadback.layers : [];
                                const stackGroup = flattenHierarchyLayers(stackHierarchy)
                                    .find((layer: any) => Number(layer?.id) === groupId);
                                const directChildren = Array.isArray(stackGroup?.children)
                                    ? stackGroup.children
                                    : Array.isArray(stackGroup?.layers) ? stackGroup.layers : [];
                                const actualLayerIdsTopToBottom = directChildren
                                    .map((layer: any) => Number(layer?.id))
                                    .filter((layerId: number) => stackLayerIds.has(layerId));
                                const orderVerified = stackReadback?.success === true
                                    && actualLayerIdsTopToBottom.length === stackPlan.layerIdsTopToBottom.length
                                    && actualLayerIdsTopToBottom.every((layerId: number, index: number) => (
                                        layerId === stackPlan.layerIdsTopToBottom[index]
                                    ));
                                modelAuthoredStackReceipt = {
                                    ...modelAuthoredStackReceipt,
                                    actualLayerIdsTopToBottom,
                                    orderVerified
                                };
                                if (!orderVerified) {
                                    errors.push({
                                        block: stageGroupName,
                                        role: 'stage-group',
                                        error: `model_authored 图层层序读回不一致：期望 top→bottom ${stackPlan.layerIdsTopToBottom.join('、')}，实际 ${actualLayerIdsTopToBottom.join('、') || '不可读取'}`
                                    });
                                }
                            }
                        }
                    } else {
                        // neutral/staged 兼容生产结构：继续使用文案/图标/图片三桶。
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
                        stageSubgroupIds = subgroupIds;
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

            // 阶段替换采用组级 swap：旧稿在新稿全部建层、归组、剪切验真之前保持不动。
            // 新稿先使用临时组名；结构读回通过后先把新组改成最终语义名，再删除旧稿。
            // 即使旧稿清理中途失败，完整新组仍然存在，结果会以失败和结构化收据如实返回。
            if (hasStageReplacementTargets) {
                const expectedCandidateLayerIds = Array.from(new Set(createdLayerIds));
                const ownedLayerIds = new Set(validatedOwnedLayers.map((entry) => entry.layerId));
                let candidateHierarchyResult: any;
                let candidateHierarchy: any[] = [];
                let candidateStructureVerified = errors.length === 0
                    && expectedCandidateLayerIds.length > 0;
                const stageSwapIssues: string[] = [];

                if (candidateStructureVerified) {
                    candidateHierarchyResult = await executeToolCall(
                        'getLayerHierarchy',
                        { includeBounds: false },
                        options
                    );
                    if (candidateHierarchyResult?.success === false) {
                        candidateStructureVerified = false;
                        stageSwapIssues.push(
                            `新阶段结构读回失败：${candidateHierarchyResult?.error || 'getLayerHierarchy failed'}`
                        );
                    } else {
                        candidateHierarchy = Array.isArray(candidateHierarchyResult?.hierarchy)
                            ? candidateHierarchyResult.hierarchy
                            : [];
                        const candidateFlat = flattenHierarchyLayers(candidateHierarchy);
                        if (stageGroupName) {
                            const candidateGroup = candidateFlat.find(
                                (layer: any) => Number(layer?.id) === Number(stageGroupId)
                            );
                            const candidateAtRoot = candidateHierarchy.some(
                                (layer: any) => Number(layer?.id) === Number(stageGroupId)
                            );
                            const candidateVisible = candidateGroup?.visible === true;
                            const candidateDescendantIds = candidateGroup
                                ? collectHierarchyNodeLayerIds(candidateGroup)
                                : new Set<number>();
                            const missingLayerIds = expectedCandidateLayerIds.filter(
                                (layerId) => !candidateDescendantIds.has(layerId)
                            );
                            const clippingVerified = clippingPairs.every(
                                (pair) => pair.receipt?.clippingVerification?.relationVerified === true
                            );
                            if (!candidateGroup || !candidateAtRoot || !candidateVisible
                                || missingLayerIds.length > 0) {
                                candidateStructureVerified = false;
                                stageSwapIssues.push(
                                    `新阶段组结构不完整：groupId=${String(stageGroupId || 'missing')}，`
                                    + `root=${String(candidateAtRoot)}，visible=${String(candidateVisible)}，`
                                    + `缺少图层=[${missingLayerIds.join(', ')}]`
                                );
                            }
                            if (!clippingVerified) {
                                candidateStructureVerified = false;
                                stageSwapIssues.push('新阶段仍有未通过读回的剪切关系');
                            }
                        } else {
                            const liveLayerIds = new Set(
                                candidateFlat
                                    .map((layer: any) => Number(layer?.id))
                                    .filter((layerId: number) => Number.isInteger(layerId) && layerId > 0)
                            );
                            const missingLayerIds = expectedCandidateLayerIds.filter(
                                (layerId) => !liveLayerIds.has(layerId)
                            );
                            if (missingLayerIds.length > 0) {
                                candidateStructureVerified = false;
                                stageSwapIssues.push(`新草稿缺少图层=[${missingLayerIds.join(', ')}]`);
                            }
                        }

                        // 初始 hierarchy 中含 owned 后代的旧组没有进入普通删除候选。
                        // 只有最新读回证明 owned 已经进入新组、旧祖先不再包含它们，才允许加入清理集合。
                        const currentFlat = flattenHierarchyLayers(candidateHierarchy);
                        for (const deferredGroup of deferredOwnedAncestorGroups) {
                            const currentGroup = currentFlat.find(
                                (layer: any) => Number(layer?.id) === Number(deferredGroup?.id)
                            );
                            if (currentGroup && hierarchyNodeContainsAnyLayerId(currentGroup, ownedLayerIds)) {
                                candidateStructureVerified = false;
                                stageSwapIssues.push(
                                    `旧阶段组 ${deferredGroup.id} 仍包含 owned layer，已拒绝删除该祖先组`
                                );
                            }
                        }
                    }
                } else {
                    stageSwapIssues.push('新阶段写入已有错误或没有可验证的新图层');
                }

                if (candidateStructureVerified && stageGroupName && stageGroupId
                    && stageCandidateGroupName !== stageGroupName) {
                    const renameCandidate = await executeToolCall('renameLayer', {
                        layerId: stageGroupId,
                        newName: stageGroupName
                    }, options);
                    stageRefreshActions.push({
                        action: 'promoteStageCandidateGroup',
                        layerId: stageGroupId,
                        fromName: stageCandidateGroupName,
                        toName: stageGroupName,
                        success: renameCandidate?.success === true
                    });
                    if (renameCandidate?.success !== true) {
                        candidateStructureVerified = false;
                        stageSwapIssues.push(
                            `新阶段组无法提升为最终语义名：${renameCandidate?.error || 'renameLayer failed'}`
                        );
                    } else {
                        stageCandidatePromoted = true;
                    }
                }

                let oldStageCleanupComplete = candidateStructureVerified;
                if (candidateStructureVerified) {
                    const safePreviousStageGroups = [
                        ...previousStageGroups,
                        ...deferredOwnedAncestorGroups
                    ];
                    for (const previousGroup of safePreviousStageGroups) {
                        const deleteResult = await executeToolCall(
                            'deleteLayer',
                            { layerId: previousGroup.id },
                            options
                        );
                        const deleteSucceeded = deleteResult?.success === true;
                        stageRefreshActions.push({
                            action: 'deletePreviousStageGroup',
                            layerId: previousGroup.id,
                            name: previousGroup.name,
                            success: deleteSucceeded
                        });
                        if (!deleteSucceeded) {
                            oldStageCleanupComplete = false;
                            stageSwapIssues.push(
                                `完整新组已保留，但旧阶段组「${previousGroup.name}」清理失败：`
                                + `${deleteResult?.error || 'deleteLayer failed'}`
                            );
                            break;
                        }
                    }
                    if (oldStageCleanupComplete) {
                        for (const previousLayer of previousReusableLayers) {
                            const deleteResult = await executeToolCall(
                                'deleteLayer',
                                { layerId: previousLayer.id },
                                options
                            );
                            const deleteSucceeded = deleteResult?.success === true;
                            stageRefreshActions.push({
                                action: 'deleteReusableDraftLayer',
                                layerId: previousLayer.id,
                                name: previousLayer.name,
                                success: deleteSucceeded
                            });
                            if (!deleteSucceeded) {
                                oldStageCleanupComplete = false;
                                stageSwapIssues.push(
                                    `完整新稿已保留，但旧草稿层「${previousLayer.name}」清理失败：`
                                    + `${deleteResult?.error || 'deleteLayer failed'}`
                                );
                                break;
                            }
                        }
                    }
                }

                let failedCandidateRetained = false;
                let failedCandidateHidden = false;
                let failedCandidateCleanupComplete = candidateStructureVerified;
                if (!candidateStructureVerified) {
                    failedCandidateCleanupComplete = true;
                    let rollbackHierarchy = candidateHierarchy;
                    let rollbackHierarchyVerified = rollbackHierarchy.length > 0;
                    if (rollbackHierarchy.length === 0) {
                        const rollbackHierarchyResult = await executeToolCall(
                            'getLayerHierarchy',
                            { includeBounds: false },
                            options
                        );
                        rollbackHierarchy = Array.isArray(rollbackHierarchyResult?.hierarchy)
                            ? rollbackHierarchyResult.hierarchy
                            : [];
                        if (rollbackHierarchyResult?.success !== true) {
                            rollbackHierarchyVerified = false;
                            failedCandidateCleanupComplete = false;
                            stageSwapIssues.push(
                                `失败候选清理前无法读取当前层级：`
                                + `${rollbackHierarchyResult?.error || 'getLayerHierarchy failed'}`
                            );
                        } else {
                            rollbackHierarchyVerified = true;
                        }
                    }
                    const rollbackFlat = flattenHierarchyLayers(rollbackHierarchy);
                    const candidateGroup = rollbackFlat.find(
                        (layer: any) => Number(layer?.id) === Number(stageGroupId)
                    );
                    const candidateLayerIds = candidateGroup
                        ? collectHierarchyNodeLayerIds(candidateGroup)
                        : new Set<number>();
                    let ownedLayersRestored = true;
                    for (const ownedLayer of validatedOwnedLayers) {
                        if (!candidateLayerIds.has(ownedLayer.layerId)) continue;
                        const restoreOwnedLayer = await executeToolCall('moveLayerToGroup', {
                            layerId: ownedLayer.layerId,
                            targetGroupId: ownedLayer.originalParentId || 0,
                            position: 'inside'
                        }, options);
                        const restored = restoreOwnedLayer?.success === true;
                        stageRefreshActions.push({
                            action: 'restoreOwnedLayerAfterCandidateFailure',
                            layerId: ownedLayer.layerId,
                            targetGroupId: ownedLayer.originalParentId || 0,
                            success: restored
                        });
                        if (!restored) {
                            ownedLayersRestored = false;
                            failedCandidateCleanupComplete = false;
                            stageSwapIssues.push(
                                `失败候选中的 owned layer ${ownedLayer.layerId} 无法恢复到原父级：`
                                + `${restoreOwnedLayer?.error || 'moveLayerToGroup failed'}`
                            );
                        }
                    }

                    let candidateGroupRemoved = !candidateGroup && rollbackHierarchyVerified;
                    if (stageGroupId && !candidateGroup && !rollbackHierarchyVerified) {
                        failedCandidateRetained = true;
                    }
                    if (candidateGroup && ownedLayersRestored) {
                        const removeCandidateGroup = await executeToolCall(
                            'deleteLayer',
                            { layerId: stageGroupId },
                            options
                        );
                        candidateGroupRemoved = removeCandidateGroup?.success === true;
                        stageRefreshActions.push({
                            action: 'deleteFailedStageCandidateGroup',
                            layerId: stageGroupId,
                            name: stageCandidateGroupName,
                            success: candidateGroupRemoved
                        });
                        if (!candidateGroupRemoved) {
                            failedCandidateCleanupComplete = false;
                            failedCandidateRetained = true;
                            stageSwapIssues.push(
                                `失败候选组 ${stageGroupId} 清理失败：`
                                + `${removeCandidateGroup?.error || 'deleteLayer failed'}`
                            );
                            const hideCandidateGroup = await executeToolCall(
                                'setLayerVisibility',
                                { layerId: stageGroupId, visible: false },
                                options
                            );
                            failedCandidateHidden = hideCandidateGroup?.success === true;
                            stageRefreshActions.push({
                                action: 'hideRetainedFailedStageCandidateGroup',
                                layerId: stageGroupId,
                                success: failedCandidateHidden
                            });
                            if (!failedCandidateHidden) {
                                stageSwapIssues.push(
                                    `失败候选组 ${stageGroupId} 也无法隐藏：`
                                    + `${hideCandidateGroup?.error || 'setLayerVisibility failed'}`
                                );
                            }
                        }
                    } else if (candidateGroup && !ownedLayersRestored) {
                        failedCandidateRetained = true;
                        stageSwapIssues.push(
                            `失败候选组 ${stageGroupId} 因仍承载 owned layer 而保留，未执行危险删除`
                        );
                    }

                    if (ownedLayersRestored) {
                        const liveHierarchyResult = await executeToolCall(
                            'getLayerHierarchy',
                            { includeBounds: false },
                            options
                        );
                        const liveHierarchy = Array.isArray(liveHierarchyResult?.hierarchy)
                            ? liveHierarchyResult.hierarchy
                            : [];
                        if (liveHierarchyResult?.success !== true) {
                            failedCandidateCleanupComplete = false;
                            stageSwapIssues.push(
                                `失败候选清理后无法验证剩余图层：`
                                + `${liveHierarchyResult?.error || 'getLayerHierarchy failed'}`
                            );
                        } else {
                            const liveLayerIds = new Set(
                                flattenHierarchyLayers(liveHierarchy)
                                    .map((layer: any) => Number(layer?.id))
                                    .filter((layerId: number) => Number.isInteger(layerId) && layerId > 0)
                            );
                            const nonOwnedCandidateLayerIds = expectedCandidateLayerIds.filter(
                                (layerId) => !ownedLayerIds.has(layerId) && liveLayerIds.has(layerId)
                            );
                            for (const layerId of nonOwnedCandidateLayerIds) {
                                const cleaned = await cleanupCreatedLayer(
                                    layerId,
                                    stageGroupName || 'renderLayout',
                                    'stage-swap',
                                    '失败候选回滚'
                                );
                                if (!cleaned) failedCandidateCleanupComplete = false;
                            }
                        }
                    }
                    if (candidateGroupRemoved && failedCandidateCleanupComplete) {
                        stageSwapIssues.push('失败候选已清理，旧阶段保持原状');
                    }
                }

                if (!candidateStructureVerified || !oldStageCleanupComplete) {
                    errors.push({
                        block: stageGroupName || 'renderLayout',
                        role: 'stage-swap',
                        error: stageSwapIssues.join('；') || '阶段替换未完成'
                    });
                }
                let stageSwapStatus = 'candidate_not_promoted';
                if (candidateStructureVerified && oldStageCleanupComplete) {
                    stageSwapStatus = 'committed';
                } else if (candidateStructureVerified) {
                    stageSwapStatus = 'old_stage_cleanup_incomplete';
                }
                stageSwapReceipt = {
                    version: 'render-layout-stage-swap/v1',
                    status: stageSwapStatus,
                    oldStagePreservedUntilCandidateVerified: true,
                    candidateGroupId: stageGroupId,
                    candidatePromoted: stageCandidatePromoted,
                    candidateStructureVerified,
                    oldStageCleanupComplete,
                    failedCandidateCleanupComplete,
                    failedCandidateRetained,
                    failedCandidateHidden,
                    previousStageGroupIds: [
                        ...previousStageGroups,
                        ...deferredOwnedAncestorGroups
                    ].map((layer: any) => Number(layer?.id)),
                    previousReusableLayerIds: previousReusableLayers.map(
                        (layer: any) => Number(layer?.id)
                    ),
                    ...(stageSwapIssues.length > 0 ? { issues: stageSwapIssues } : {})
                };
            }
            const retainedCreatedLayerIds = createdLayerIds.filter(
                (layerId) => !cleanedCreatedLayerIds.has(layerId)
            );
            const retainedSubjectLayerIds = subjectLayerIds.filter(
                (layerId) => !cleanedCreatedLayerIds.has(layerId)
            );
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
            if (errors.length === 0 && retainedCreatedLayerIds.length > 0) {
                const { detectFullLayerOcclusions } = await import('../../shared/layer-occlusion');
                const hierarchyAfter = await executeToolCall('getLayerHierarchy', { includeBounds: true }, options);
                if (hierarchyAfter?.success !== false) {
                    layoutFinalWriteHistoryStateRef = readPhotoshopHistoryStateRef(hierarchyAfter);
                    const hierarchyAfterTree = hierarchyAfter?.hierarchy || hierarchyAfter?.flatList || [];
                    occlusionFindings = detectFullLayerOcclusions(hierarchyAfterTree);
                    for (const finding of occlusionFindings) {
                        warnings.push(finding.message);
                        const touchesCurrentLayout = retainedCreatedLayerIds.includes(Number(finding.occludedLayerId))
                            || retainedCreatedLayerIds.includes(Number(finding.occluderLayerId));
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
            if (layoutStartHistoryStateRef && !layoutFinalWriteHistoryStateRef) {
                // 失败路径也必须结算最终 Host revision。不能用 errors.length 或已登记图层数决定
                // 是否读回：原子写可能已经发生，却在登记 layerId 前失败。
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
                params: {
                    region: suggestedObservationRegion,
                    maxSize: 1600,
                    ...(layoutFinalWriteHistoryStateRef?.documentId
                        ? { expectedDocumentId: layoutFinalWriteHistoryStateRef.documentId }
                        : {})
                },
                reason: screenRegion || isLongCanvas
                    ? '长文档必须复核本次阶段/内容并集的局部高分辨率画面；全页缩略图只可用于导航，不能判定设计质量。'
                    : '读取本次布局后的完整画面，确认主体、文字层级和可读性。'
            };
            let postWriteObservation: BoundPostWriteObservation | undefined;
            let postWriteSnapshot: any;
            if (retainedCreatedLayerIds.length > 0
                && options.deferCompositeVisualObservation !== true) {
                // renderLayout 是复合写操作。布局完成后由 Harness 主动读取一次本次区域，
                // 直接复用 Agent 的图像观察通道，避免再花一轮让模型决定“要不要截图”。
                // 这只负责取得真实像素；审美判断仍由视觉模型完成，抓图成功不等于质量通过。
                const writeHistoryStateRef = layoutFinalWriteHistoryStateRef
                    || layoutStartHistoryStateRef;
                const capturedObservation = await captureBoundPostWriteObservation({
                    region: suggestedObservationRegion,
                    maxSize: 1600,
                    writeHistoryStateRef,
                    options
                });
                postWriteObservation = capturedObservation.observation;
                postWriteSnapshot = capturedObservation.snapshot;
                if (!postWriteObservation.captured) {
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
                } else if (!postWriteObservation.verifiedSameDocumentVersion) {
                    qualityFindings.push({
                        code: 'post_layout_visual_identity_mismatch',
                        severity: 'repair',
                        closureKind: 'replan',
                        blockId: stageGroupName || 'renderLayout',
                        role: 'layout',
                        message: `renderLayout 已取得像素，但不能证明它属于本次最终写入：${postWriteObservation.error}。`,
                        recommendedStrategies: [
                            '重新读取当前 Photoshop 文档与图层结构，确认活动文档',
                            '基于当前文档版本重新执行本阶段布局，再由 Harness 自动复核'
                        ]
                    });
                }
            }
            let visualObservationBundle: VisualObservationBundle | undefined;
            const visualObservationToolResults: Array<{
                toolName: 'getCanvasSnapshot';
                success: boolean;
                result: Record<string, any>;
            }> = [];
            if (retainedCreatedLayerIds.length > 0
                && isLongCanvas
                && options.deferCompositeVisualObservation !== true) {
                // 长页全页图只用于导航。按确定性裁切事实选取风险最高的少量图片区域，
                // 让同一个 Agent 看清局部；排序不等于审美选择，也不会替模型决定是否保留裁切。
                const reviewPlan = buildImagePlacementReviewPlan({
                    receipts: imagePlacementReceipts,
                    canvas: {
                        width: Number(canvas.width),
                        height: Number(canvas.height)
                    }
                });
                if (reviewPlan.selectedTargets.length > 0) {
                    const items = [];
                    for (let index = 0; index < reviewPlan.selectedTargets.length; index += 1) {
                        const reviewTarget = reviewPlan.selectedTargets[index];
                        const receipt = reviewTarget.receipt;
                        const capturedLocal = await captureBoundPostWriteObservation({
                            region: reviewTarget.captureRegion,
                            maxSize: 1400,
                            writeHistoryStateRef: layoutFinalWriteHistoryStateRef,
                            options,
                            sourceKind: reviewTarget.sourceKind,
                            sourceId: reviewTarget.sourceId
                        });
                        if (capturedLocal.sourceResult) {
                            visualObservationToolResults.push({
                                toolName: 'getCanvasSnapshot',
                                success: capturedLocal.observation.captured,
                                result: capturedLocal.sourceResult
                            });
                        }
                        const image = readVisualObservationImagePayload(capturedLocal.snapshot);
                        const captured = capturedLocal.observation.captured
                            && capturedLocal.observation.verifiedSameDocumentVersion
                            && Boolean(image);
                        items.push({
                            identity: {
                                outer: 'renderLayout',
                                resultPath: `$.visualObservationBundle.items[${index}]`,
                                document: String(capturedLocal.observation.historyStateRef?.documentId || 'unknown'),
                                history: String(capturedLocal.observation.historyStateRef?.historyStateId || 'unknown'),
                                sourceKind: reviewTarget.sourceKind,
                                sourceId: reviewTarget.sourceId
                            },
                            label: `图片区域「${String(receipt.blockId)}」裁切复核`,
                            captured,
                            ...(image ? { image } : {})
                        });
                    }
                    visualObservationBundle = {
                        version: VISUAL_OBSERVATION_BUNDLE_VERSION,
                        expectedObservationCount: reviewPlan.expectedTargets.length,
                        expectedTargets: reviewPlan.expectedTargets,
                        items,
                        ...(reviewPlan.overflow ? { overflow: reviewPlan.overflow } : {})
                    };
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
            const canReportStageStructure = Boolean(stageGroupId)
                && (!hasStageReplacementTargets
                    || stageSwapReceipt?.candidateStructureVerified === true);
            result = {
                success: errors.length === 0,
                status: qualityState === 'passed' ? 'completed' : qualityState,
                qualityState,
                continuationRequired: qualityState === 'needs_repair' || qualityState === 'needs_review',
                requiresVisualReview: retainedCreatedLayerIds.length > 0,
                suggestedObservation,
                postWriteObservation,
                historyStateRef: postWriteObservation?.historyStateRef,
                documentInfo: postWriteObservation?.documentInfo,
                photoshopHistoryTransition: layoutHistoryTransition.mutationObserved === true
                    ? layoutHistoryTransition
                    : undefined,
                // 保持 getCanvasSnapshot 的真实 payload 形状，让 Agent 现有视觉通道可直接提取图像。
                snapshot: postWriteSnapshot,
                visualObservationBundle,
                observationDeferredToComposite: options.deferCompositeVisualObservation === true,
                toolResults: visualObservationToolResults.length > 0
                    ? visualObservationToolResults
                    : undefined,
                created,
                createdLayerIds: retainedCreatedLayerIds,
                subjectLayerIds: retainedSubjectLayerIds.length > 0
                    ? retainedSubjectLayerIds
                    : undefined,
                imagePlacementReceipts: imagePlacementReceipts.length > 0 ? imagePlacementReceipts : undefined,
                textFitReceipts: textFitReceipts.length > 0 ? textFitReceipts : undefined,
                qualityFindings: qualityFindings.length > 0 ? qualityFindings : undefined,
                cleanupFailures: cleanupFailures.length > 0 ? cleanupFailures : undefined,
                errors,
                warnings,
                // 本次生效的栅格与刻度：让模型看见自己实际吃到的版心、列数与可选间距档位，
                // 下一次调用才能选档位而不是凭空估像素。
                grid: solveOutcome.grid,
                occlusionFindings: occlusionFindings.length > 0 ? occlusionFindings : undefined,
                stageGroupName: stageGroupName || undefined,
                layerStructureReceipt: canReportStageStructure
                    ? {
                        version: 'render-layout-layer-structure/v1',
                        groupName: stageCandidatePromoted
                            ? stageGroupName
                            : stageCandidateGroupName,
                        groupId: stageGroupId,
                        subgroupIds: stageSubgroupIds,
                        modelAuthoredStackReceipt,
                        ownedLayerIds: validatedOwnedLayers.map((entry) => entry.layerId),
                        semanticNamesRequired: true,
                        verifiedBy: 'getLayerHierarchy'
                    }
                    : undefined,
                ownerReceipt: {
                    version: 'render-layout-owner/v1',
                    stageId: stageId || undefined,
                    screenRegion: screenRegion
                        ? { x: 0, y: screenRegion.y, width: Number(canvas.width), height: screenRegion.height }
                        : undefined
                },
                stageSwapReceipt,
                modelAuthoredStackReceipt,
                stageRefreshActions: stageRefreshActions.length > 0 ? stageRefreshActions : undefined,
                stagePlan: params.stagePlan || undefined,
                stagePlanValidation: stagePlanValidation || undefined,
                visualStyle: {
                    mode: style.mode,
                    provenance: style.provenance,
                    sellingPointTreatment: style.sellingPointTreatment
                },
                message: `${qualityState === 'passed' ? '已完成当前版式写入' : qualityState === 'failed' ? '当前版式写入存在执行失败' : '已写入当前版式，但必须继续复核/修订'}：`
                    + `按${regionMode ? 'Agent 声明的二维区域' : 'Agent 声明的垂直结构'}建 ${created.length} 个图层`
                    + '（坐标与图层顺序由布局引擎确定，未手填）'
                    + `${errors.length ? `，${errors.length} 个失败` : ''}`
                    + `${qualityFindings.length ? `，${qualityFindings.length} 个质量发现` : ''}`
                    + `${warnings.length ? `；${warnings.join('；')}` : ''}`
            };
            if (retainedCreatedLayerIds.length > 0) executedToolsInSession.push('renderLayout');
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
        // getSubjectBounds 默认不再走 Photoshop「选择主体」：省略 method（或 method="auto"）时按
        // 素材属性 → 透明边界 → 本地分割 → 整框 逐级求；显式 alpha / smart 仍直达插件。
        if (toolName === 'getSubjectBounds' && params?.method !== 'alpha' && params?.method !== 'smart') {
            const subjectLayerId = Number(params?.layerId);
            if (!Number.isFinite(subjectLayerId) || subjectLayerId <= 0) {
                result = { success: false, error: 'getSubjectBounds 需要 layerId：先用 getLayerHierarchy 或 placeImage 结果确定目标图层 id。' };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
            const layerBoundsResult = await executeToolCall('getLayerBounds', { layerId: subjectLayerId }, options);
            const frameRect = toSubjectRect(layerBoundsResult?.boundsNoEffects || layerBoundsResult?.bounds);
            if (layerBoundsResult?.success === false || !frameRect) {
                result = { success: false, error: `getSubjectBounds 读取图层边界失败：${layerBoundsResult?.error || '未返回 bounds'}。` };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
            const docInfo = await executeToolCall('getDocumentInfo', {}, options);
            const resolved = await resolveLayerSubjectBounds({
                layerId: subjectLayerId,
                frameBounds: frameRect,
                requestedMethod: 'auto',
                documentId: readResultDocumentId(docInfo),
                options
            });
            result = {
                success: true,
                data: {
                    bounds: resolved.bounds,
                    method: resolved.method,
                    confidence: resolved.confidence,
                    ...(resolved.relativeBox ? { relativeBox: resolved.relativeBox } : {})
                },
                method: resolved.method,
                confidence: resolved.confidence,
                note: resolved.note,
                warnings: resolved.warnings,
                message: `主体框：${resolved.method}（置信度 ${resolved.confidence}）—— ${resolved.note}`
            };
            executedToolsInSession.push(toolName);
            toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
            return result;
        }

        if (toolName === 'fitLayerSubjectToRegion') {
            const {
                computeSubjectFitToRegion,
                verifySubjectFitResult
            } = await import('../../shared/subject-fit');
            const fitLayerId = Number(params.layerId);
            if (!Number.isFinite(fitLayerId) || fitLayerId <= 0) {
                result = { success: false, error: 'fitLayerSubjectToRegion 需要 layerId：先用 getLayerHierarchy 或 placeImage 结果确定目标图层 id。' };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
            // 主体框不再默认依赖 Photoshop「选择主体」（用户 2026-08-18：复杂场景不可靠、不想绑死 Adobe 智能功能）：
            // 先读图层外框，再按「素材属性 → 透明边界 → 本地分割 → （显式才用）PS 选择主体 → 整框」逐级求主体，
            // 每级带置信度；缩放后主体框按相对框投影，不再做第二次检测。
            const requestedMethod: 'auto' | 'alpha' | 'smart' = params.method === 'alpha'
                ? 'alpha'
                : params.method === 'smart'
                    ? 'smart'
                    : 'auto';
            const layerBoundsResult = await executeToolCall('getLayerBounds', { layerId: fitLayerId }, options);
            const frameBounds = layerBoundsResult?.boundsNoEffects || layerBoundsResult?.bounds;
            if (layerBoundsResult?.success === false || !frameBounds) {
                result = { success: false, error: `fitLayerSubjectToRegion 读取图层边界失败：${layerBoundsResult?.error || '未返回 bounds'}。` };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
            const frameRect = toSubjectRect(frameBounds);
            if (!frameRect) {
                result = { success: false, error: 'fitLayerSubjectToRegion 读取图层边界失败：bounds 不是有效矩形。' };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
            const docInfo = await executeToolCall('getDocumentInfo', {}, options);
            const resolvedSubject = await resolveLayerSubjectBounds({
                layerId: fitLayerId,
                frameBounds: frameRect,
                requestedMethod,
                documentId: readResultDocumentId(docInfo),
                options
            });
            const methodUsed = resolvedSubject.method;
            const subjectResult = { data: { bounds: resolvedSubject.bounds } };
            const anchorValues = [
                'center', 'top-center', 'bottom-center', 'left-center', 'right-center'
            ];
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
                    : undefined;
            if (resolvedFillRatio === undefined) {
                result = {
                    success: false,
                    error: 'fitLayerSubjectToRegion 缺少主体视觉占比：请由 Agent 显式给 subjectFillRatio，或传入已选参考的 referenceComposition.subjectFillRatioForFullCanvas。Harness 不再按品类套用内置占比。'
                };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
            if (!anchorValues.includes(String(params.anchor))) {
                result = {
                    success: false,
                    error: 'fitLayerSubjectToRegion 缺少明确 anchor：请根据本稿构图声明 center / top-center / bottom-center / left-center / right-center。Harness 不替 Agent 选择视觉重心。'
                };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
            const resolvedAnchor = String(params.anchor);
            const fitPlan = computeSubjectFitToRegion({
                subjectBounds: subjectResult.data.bounds,
                layerBounds: frameBounds,
                targetRegion: params.targetRegion,
                subjectFillRatio: resolvedFillRatio,
                maxUpscaleRatio: params.maxUpscaleRatio,
                anchor: resolvedAnchor as any,
                visualBiasY: 0,
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
            const postLayerBoundsResult = await executeToolCall(
                'getLayerBounds',
                { layerId: fitLayerId },
                options
            );
            const actualFrameBounds = postLayerBoundsResult?.boundsNoEffects
                || postLayerBoundsResult?.bounds;
            // 读回：alpha 重新量像素（便宜且确定）；其余按相对框投影到新外框——等比缩放 + 平移下投影是精确的，
            // 不需要（也不该）再跑一次识别。
            let actualSubjectBounds: any;
            let postSubjectError = '';
            const actualFrameRect = toSubjectRect(actualFrameBounds);
            if (methodUsed === 'alpha') {
                const postSubjectResult = await executeToolCall('getSubjectBounds', { layerId: fitLayerId, method: 'alpha' }, options);
                actualSubjectBounds = postSubjectResult?.data?.bounds;
                postSubjectError = postSubjectResult?.error || '';
            } else if (actualFrameRect && resolvedSubject.relativeBox) {
                const { projectRelativeBoxOntoFrame } = await import('../../shared/subject-box-from-pixels');
                actualSubjectBounds = withSize(projectRelativeBoxOntoFrame(resolvedSubject.relativeBox, actualFrameRect));
            } else {
                postSubjectError = postLayerBoundsResult?.error || '未返回图层边界';
            }
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
                        `缩放已经写入，但同 layerId 主体读回失败：${postSubjectError || '未返回主体边界'}。`
                    ],
                    limitation: '无法完成几何验收；禁止把写入成功声明为视觉质量通过。'
                };
            const combinedWarnings = [
                ...resolvedSubject.warnings,
                ...(resolvedSubject.confidence === 'low'
                    ? [`主体框置信度低（${resolvedSubject.note}）`]
                    : []),
                ...fitPlan.warnings,
                ...(Array.isArray(geometryVerification.warnings)
                    ? geometryVerification.warnings
                    : [])
            ];
            const fitWriteHistoryStateRef = readPhotoshopHistoryStateRef(postLayerBoundsResult)
                || alignMutationProof?.after;
            const targetRegion = params.targetRegion as {
                x: number;
                y: number;
                width: number;
                height: number;
            };
            const documentWidth = Number(docInfo?.width);
            const documentHeight = Number(docInfo?.height);
            const observationPadding = Math.max(
                16,
                Math.round(Math.min(targetRegion.width, targetRegion.height) * 0.04)
            );
            const observationX = Math.max(0, Math.floor(targetRegion.x - observationPadding));
            const observationY = Math.max(0, Math.floor(targetRegion.y - observationPadding));
            const observationRight = Number.isFinite(documentWidth) && documentWidth > 0
                ? Math.min(documentWidth, Math.ceil(targetRegion.x + targetRegion.width + observationPadding))
                : Math.ceil(targetRegion.x + targetRegion.width + observationPadding);
            const observationBottom = Number.isFinite(documentHeight) && documentHeight > 0
                ? Math.min(documentHeight, Math.ceil(targetRegion.y + targetRegion.height + observationPadding))
                : Math.ceil(targetRegion.y + targetRegion.height + observationPadding);
            let capturedFitObservation: BoundPostWriteObservationResult | undefined;
            let fitVisualObservationBundle: VisualObservationBundle | undefined;
            if (options.deferCompositeVisualObservation !== true) {
                capturedFitObservation = await captureBoundPostWriteObservation({
                    region: {
                        x: observationX,
                        y: observationY,
                        width: Math.max(1, observationRight - observationX),
                        height: Math.max(1, observationBottom - observationY)
                    },
                    maxSize: 1400,
                    writeHistoryStateRef: fitWriteHistoryStateRef,
                    options,
                    sourceKind: 'subject-fit-region',
                    sourceId: `layer:${fitLayerId}`
                });
                const fitObservationImage = readVisualObservationImagePayload(
                    capturedFitObservation.snapshot
                );
                const fitObservationCaptured = capturedFitObservation.observation.captured
                    && capturedFitObservation.observation.verifiedSameDocumentVersion
                    && Boolean(fitObservationImage);
                fitVisualObservationBundle = {
                    version: VISUAL_OBSERVATION_BUNDLE_VERSION,
                    expectedObservationCount: 1,
                    expectedTargets: [{
                        sourceKind: 'subject-fit-region',
                        sourceId: `layer:${fitLayerId}`
                    }],
                    items: [{
                        identity: {
                            outer: 'fitLayerSubjectToRegion',
                            resultPath: '$.visualObservationBundle.items[0]',
                            document: String(
                                capturedFitObservation.observation.historyStateRef?.documentId || 'unknown'
                            ),
                            history: String(
                                capturedFitObservation.observation.historyStateRef?.historyStateId || 'unknown'
                            ),
                            sourceKind: 'subject-fit-region',
                            sourceId: `layer:${fitLayerId}`
                        },
                        label: `图层 ${fitLayerId} 主体调整后画面`,
                        captured: fitObservationCaptured,
                        ...(fitObservationImage ? { image: fitObservationImage } : {})
                    }]
                };
                if (!capturedFitObservation.observation.captured
                    || !capturedFitObservation.observation.verifiedSameDocumentVersion) {
                    combinedWarnings.push(
                        `主体调整后的局部画面未完成同版本绑定：${capturedFitObservation.observation.error || '未知原因'}`
                    );
                }
            }
            let fitQualityState: 'passed' | 'needs_review' | 'needs_repair' = 'passed';
            if (geometryVerification.status === 'failed') {
                fitQualityState = 'needs_repair';
            } else if (geometryVerification.status === 'needs_review') {
                fitQualityState = 'needs_review';
            }
            result = {
                success: true,
                methodUsed,
                subjectDetection: {
                    method: resolvedSubject.method,
                    confidence: resolvedSubject.confidence,
                    note: resolvedSubject.note,
                    ...(resolvedSubject.relativeBox ? { relativeBox: resolvedSubject.relativeBox } : {})
                },
                appliedScalePercent: fitPlan.alignParams.scalePercent,
                fitSource: hasExplicitFillRatio ? 'agent_declared' : 'reference_measured',
                designSemantics: {
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
                qualityState: fitQualityState,
                continuationRequired: fitQualityState !== 'passed',
                postWriteObservation: capturedFitObservation?.observation,
                snapshot: capturedFitObservation?.snapshot,
                visualObservationBundle: fitVisualObservationBundle,
                toolResults: capturedFitObservation?.sourceResult
                    ? [{
                        toolName: 'getCanvasSnapshot',
                        success: capturedFitObservation.observation.captured,
                        result: capturedFitObservation.sourceResult
                    }]
                    : undefined,
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
                message: `已按主体感知缩放对齐并完成同 layerId 几何读回：缩放 ${fitPlan.alignParams.scalePercent}%，目标占比 ${fitPlan.resolved.subjectFillRatio}，锚点 ${fitPlan.resolved.anchor}（主体检测 ${methodUsed}；几何状态 ${geometryVerification.status}）${combinedWarnings.length ? `；${combinedWarnings.join('；')}` : ''}。${capturedFitObservation ? '已随结果返回当前版本的局部真实画面；' : '外层复合布局将在全部写入结束后统一返回最终画面；'}几何通过不等于审美通过，由 Agent 看图决定保留或有依据地修订。`
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
            // 真机 2026-08-17（两次）：模型把设计源 PSD 里读到的文字（含上一稿编的「防滑硅胶」）当作
            // 「产品事实（来自详情页真实内容）」抄进新稿。描述里写过不管用——把提醒直接放进结果对象。
            if (result && typeof result === 'object' && !Array.isArray(result) && result.success !== false) {
                result = {
                    ...result,
                    textProvenance: {
                        kind: 'design_copy_not_product_fact',
                        notice: '本文件里的文字是上一稿的设计文案，不是产品事实来源：其中的功能 / 材质 / 工艺 / 参数类描述在写进新稿前，必须先在产品图上核对（analyzeAssetContent / analyzeProjectContactSheetOverview）或经用户确认；画面看不出、用户没说过的一律不写。'
                    }
                };
            }
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

        if (toolName === 'fillDetailPage') {
            const plans = Array.isArray(params?.plans)
                ? params.plans
                : params?.plan ? [params.plan] : [];
            const missingSelectionReceipts = plans.flatMap((plan: any) => (
                (Array.isArray(plan?.images) ? plan.images : [])
                    .filter((image: any) => (
                        (String(image?.imagePath || '').trim() || String(image?.imageData || '').trim())
                        && !hasValidDetailAssetSelectionReceipt(image, Number(plan?.screenId || 0))
                    ))
                    .map((image: any) => ({
                        screenId: Number(plan?.screenId || 0),
                        placeholderLayerId: Number(image?.layerId || 0),
                        layerName: String(image?.layerName || '')
                    }))
            ));
            if (missingSelectionReceipts.length > 0) {
                result = {
                    success: false,
                    code: 'detail_asset_selection_receipt_required',
                    error: '详情页图片仍是候选态，缺少与当前屏、占位和候选集绑定的 Agent / 用户选择，已停止置入。',
                    missingSelectionReceipts,
                    executesPhotoshop: false
                };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
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
                const saveParams = preserveJpegQualityAcrossToolRedirect({
                    sourceTool: 'quickExport',
                    targetFormat: requestedFormat,
                    requestedQuality: params?.quality,
                    redirectedParams: {
                        path: requestedPath,
                        format: requestedFormat === 'jpeg' ? 'jpg' : requestedFormat
                    }
                });
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

            if (toolName === 'smartSave'
                || (toolName === 'saveDocument' && !hasValue(params?.path))) {
                const projectPath = await getCurrentProjectPath();
                if (!projectPath) {
                    return {
                        success: false,
                        error: `自动化执行已阻止 ${toolName} 弹窗：未设置当前项目路径`,
                        suggestion: toolName === 'smartSave'
                            ? '请先导入项目，再由宿主在项目内部建立恢复点'
                            : '请先导入项目，或使用 saveDocument(path) 显式传路径，或设置 allowDialog=true'
                    };
                }

                const docName = await getCurrentDocumentName();
                if (!docName) {
                    return {
                        success: false,
                        error: `${toolName} 无法取得当前文档名称，未生成通用工程文件名`,
                        suggestion: toolName === 'smartSave'
                            ? '先确认活动文档后再建立恢复点'
                            : '先确认活动文档名称，或为 saveDocument 显式传入用户可读的完整 path'
                    };
                }
                const requestedFormat = toolName === 'smartSave'
                    ? normalizeRecoverySaveFormat(params?.exportFormat)
                    : normalizeNoDialogSaveFormat(params?.format);
                const saveRoot = toolName === 'smartSave'
                    ? await resolveProjectRecoveryRoot(projectPath)
                    : await resolveNoDialogSaveRoot(projectPath, params?.projectSubdir);
                if (saveRoot.error) {
                    return {
                        success: false,
                        error: saveRoot.error,
                        suggestion: '请确认项目路径可写，或使用 saveDocument(path) 显式传入完整保存路径'
                    };
                }
                const autoPath = toolName === 'smartSave'
                    ? buildRecoverySavePath(saveRoot.directory, docName, requestedFormat)
                    : buildNoDialogSavePath(saveRoot.directory, docName, requestedFormat);
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
                    const exportParams = preserveJpegQualityAcrossToolRedirect({
                        sourceTool: 'saveDocument',
                        targetFormat: requestedFormat,
                        requestedQuality: quality,
                        redirectedParams: {
                            outputPath: saveRoot.directory,
                            format: requestedFormat
                        }
                    });
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
                    executedToolsInSession.push(toolName);
                    if (toolName === 'smartSave') {
                        return {
                            ...saveResult,
                            success: true,
                            message: `已建立项目内部恢复点：${autoPath}`,
                            recoveryPath: autoPath,
                            internalCheckpoint: true,
                            countsAsDelivery: false,
                            countsAsTaskProgress: false,
                            countsAsObservation: false,
                            redirectedFrom: toolName
                        };
                    }
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
        // placeImage 只接受 Agent 已明确选中的来源；候选发现与比较必须先回到主循环。
        let finalParams = params;
        if (toolName === 'placeImage') {
            finalParams = resolveExplicitPlaceImageSource(finalParams);
            if (finalParams?.__placeImageSourceBlocked) {
                const decision = finalParams.__placeImageSourceDecision || {};
                const result = {
                    success: false,
                    error: 'placeImage 需要 Agent 明确选择图片来源；当前没有扫描候选，也没有写入 Photoshop。',
                    code: 'explicit_source_required',
                    recoverable: true,
                    noMutation: true,
                    selectionRequired: true,
                    searchedCandidates: decision.searchedCandidates === true,
                    selectedCandidate: decision.selectedCandidate === true,
                    photoshopWriteAttempted: decision.photoshopWriteAttempted === true,
                    nextTool: decision.nextTool,
                    suggestion: '先用 recommendAssets 查看候选，再由 Agent 选择并把明确的 filePath 传给 placeImage。'
                };
                toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
                return result;
            }
        }

        // 项目内显式路径直接交给 UXP 创建会话 token。历史上这里先转为 Base64，
        // 9–12MB 素材会膨胀成超大 JSON 文本帧，实机多次触发 WebSocket UTF-8 帧错误；
        // 路径直传已经由 UXP 的 getEntryWithUrl + 真实 placeImage 读回验证。
        if (toolName === 'placeImage' && finalParams?.filePath && !finalParams?.imageData && !finalParams?.fileToken) {
            const projectPath = await getCurrentProjectPath();
            const filePathCandidates = normalizePlaceImageFilePathCandidates(finalParams.filePath, projectPath);
            const resolvedFilePath = filePathCandidates[0] || String(finalParams.filePath);
            finalParams = {
                ...finalParams,
                filePath: resolvedFilePath,
                sourcePath: finalParams.sourcePath || resolvedFilePath
            };
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
        dispatchedPhotoshopParams = finalParams;
        dispatchedPhotoshopAcceptancePolicy = acceptancePolicy;

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
        dispatchedPhotoshopAcceptanceBefore = acceptanceBefore;
        result = await sendToPluginWithCancellation(uxpToolName, finalParams, timeout, options, toolName);
        if (requiresPhotoshopOperationReadback(result)) {
            result = await reconcileOperationSpecificPhotoshopReadback(
                toolName,
                finalParams,
                result,
                {
                    acceptanceBefore,
                    acceptancePolicy
                }
            );
        }
        if (toolName === 'listDocuments'
            && result && typeof result === 'object' && !Array.isArray(result)) {
            result = enrichPhotoshopDocumentInventory(
                result,
                useAppStore.getState().currentProject?.path
            );
        }
        // 文档性质提示（2026-08-17 真机：模型把一张 AI 生图结果 png 当成「主图文档」直接往上排字）：
        // 按文件名扩展名 + 图层数判断「这是设计文件还是一张图片」，附在结果里给模型看，只提示不拦截。
        if (toolName === 'getDocumentInfo'
            && result && typeof result === 'object' && !Array.isArray(result)
            && result.success !== false
            && result.document && typeof result.document === 'object') {
            const document = result.document as Record<string, unknown>;
            result = {
                ...result,
                documentNature: describeDesignDocumentNature({
                    name: document.name,
                    layerCount: document.layerCount,
                    width: document.width,
                    height: document.height
                })
            };
        }
        // 记住「这一层来自哪个文件」：主体框以后按素材算，不必在 Photoshop 里识别。
        if ((toolName === 'placeImage' || toolName === 'replaceLayerContent' || toolName === 'replaceSmartObjectContents' || toolName === 'replaceImagePlaceholder')
            && result && typeof result === 'object' && result.success !== false) {
            const placedLayerId = result.layerId ?? result.layer?.id ?? result.data?.layerId ?? result.newLayerId ?? finalParams?.layerId ?? finalParams?.targetLayerId;
            const sourcePath = finalParams?.sourcePath || finalParams?.filePath || params?.filePath;
            rememberLayerSourceFile(placedLayerId, sourcePath, readResultDocumentId(result));
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
        if (toolName === 'renderLayout' && compoundWriteExecutionArmed) {
            let finalDocumentInfo: any;
            try {
                finalDocumentInfo = await executeToolCallImpl('getDocumentInfo', {}, options);
            } catch (settlementError) {
                finalDocumentInfo = {
                    success: false,
                    error: settlementError instanceof Error
                        ? settlementError.message
                        : String(settlementError)
                };
            }
            const finalHistoryStateRef = finalDocumentInfo?.success === false
                ? undefined
                : readPhotoshopHistoryStateRef(finalDocumentInfo);
            const settlement = buildCompoundPhotoshopWriteExceptionSettlement({
                operationId: `render-layout-exception-${startTime}-${currentRound}`,
                toolName,
                before: compoundWriteStartHistoryStateRef,
                after: finalHistoryStateRef,
                message: errorMessage
            });
            const modalRecoveryResult = isPhotoshopNativeModalTimeout(errorMessage)
                ? buildPhotoshopNativeModalSuspectedResult(toolName, errorMessage, params)
                : undefined;
            const modalRecovery = readPhotoshopModalRecoveryEvidence(modalRecoveryResult);
            const compoundFailure = {
                success: false,
                status: 'failed',
                qualityState: 'failed',
                continuationRequired: true,
                applicationStatus: settlement.photoshopOperationResult.applicationStatus,
                mutationStatus: settlement.mutationObserved ? 'applied' : 'unknown',
                ...(settlement.mutationObserved ? { partialMutation: true } : {}),
                ...settlement,
                ...(finalHistoryStateRef ? { finalHistoryStateRef } : {}),
                ...(modalRecovery ? {
                    errorCategory: modalRecovery.errorCategory,
                    environmentState: modalRecovery.environmentState,
                    recoveryRequired: modalRecovery.recoveryRequired,
                    environmentObservation: modalRecovery.environmentObservation,
                    suggestion: modalRecovery.suggestion,
                    ...(modalRecovery.originalError
                        ? { originalError: modalRecovery.originalError }
                        : {})
                } : {}),
                error: modalRecoveryResult?.error
                    || sanitizeUserVisibleDiagnosticText(errorMessage)
                    || errorMessage,
                message: settlement.mutationObserved
                    ? 'renderLayout 未完整完成，但最终 Host 版本证明已经发生部分写入；请先查看当前文档，不能直接重放整次布局。'
                    : 'renderLayout 未完整完成，且最终写入状态无法证明；请先读取当前文档与版本，不能直接重放整次布局。'
            };
            toolLogger.logToolCall(toolName, params, compoundFailure, Date.now() - startTime, currentRound);
            return compoundFailure;
        }
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
                dispatchedPhotoshopParams,
                unknownResult,
                {
                    acceptanceBefore: dispatchedPhotoshopAcceptanceBefore,
                    acceptancePolicy: dispatchedPhotoshopAcceptancePolicy
                }
            );
            const modalRecoveryResult = isPhotoshopNativeModalTimeout(errorMessage)
                ? buildPhotoshopNativeModalSuspectedResult(toolName, errorMessage, params)
                : undefined;
            const resultWithRecovery = attachPhotoshopModalRecoveryEvidenceIfUnresolved(
                reconciledResult,
                readPhotoshopModalRecoveryEvidence(modalRecoveryResult)
            );
            toolLogger.logToolCall(
                toolName,
                params,
                resultWithRecovery,
                Date.now() - startTime,
                currentRound
            );
            return resultWithRecovery;
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
/** 瞬态忙碌的退避间隔：读类观察失败先等 1.5s 再试，仍失败等 3s 最后一试。 */
const TRANSIENT_READ_RETRY_DELAYS_MS: readonly number[] = [1500, 3000];

function waitForRetry(delayMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function executeToolCall(
    toolName: string,
    params: any,
    options: ToolCallExecutionOptions = {}
): Promise<any> {
    let result = await executeToolCallImpl(toolName, params, options);
    // 瞬态重试纪律：只有「只读观察」类工具的短时忙碌失败才自动退避重试（真机病历 [508][509][510]：
    // "Photoshop 可能正忙" 被当普通失败烧熔断计数，三连即 no_progress 判停）。
    // 写类 / 导出 / 未知类绝不自动重放——重复副作用交给未知写状态 reconciliation 处理。
    if (
        result?.success === false
        && !result?.cancelled
        && isTransientPhotoshopBusyFailure(result)
        && classifyAgentToolExecution(toolName, params) === 'read_only_observation'
    ) {
        let retryCount = 0;
        for (const delayMs of TRANSIENT_READ_RETRY_DELAYS_MS) {
            if (options.signal?.aborted) {
                break;
            }
            await waitForRetry(delayMs);
            if (options.signal?.aborted) {
                break;
            }
            retryCount += 1;
            const retryResult = await executeToolCallImpl(toolName, params, options);
            if (retryResult?.success !== false) {
                result = retryResult;
                if (result && typeof result === 'object') {
                    result.transientRetryCount = retryCount;
                }
                break;
            }
            result = retryResult;
            if (!isTransientPhotoshopBusyFailure(retryResult)) {
                break;
            }
        }
        if (result?.success === false && result && typeof result === 'object' && retryCount > 0) {
            result.transientRetriesExhausted = true;
            result.transientRetryCount = retryCount;
        }
    }
    markExecutedToolResultProvenance(toolName, result);
    // 任务卡证据账本：每次成功调用记一笔（观察 / 写入 / 问用户），供打勾核对；失败不记。
    try {
        const store = await import('./design-workshop/design-task-card.store');
        store.noteToolForTaskCardEvidence(options.taskCardScope || '', toolName, params, result);
    } catch {
        // 账本失败不影响工具结果
    }
    // 自主沉淀 P1：导出交付 = 正向行为结局，回写本次运行关联的观察候选并跑保守自动晋升。
    // fire-and-forget：账本 IO 失败只留 warning，绝不影响导出结果。
    if (
        result?.success !== false
        && classifyAgentToolExecution(toolName, params) === 'save_export'
        && options.taskCardScope
    ) {
        const projectPath = useAppStore.getState().currentProject?.path;
        import('./design-workshop/design-learning.store')
            .then((learning) => learning.recordDesignRunDeliveryOutcome(
                (channel: string, ...args: any[]) => (window as any).designEcho.invoke(channel, ...args),
                projectPath,
                options.taskCardScope
            ))
            .catch(() => undefined);
    }
    return result;
}

// 测试桥（仅 URL 带 designechoChatTestBridge=1 的调试窗口）：让真机验收脚本能不经模型直接调用任一工具，
// 用于车间 / 引擎类工具的确定性验证与画廊评测。生产窗口不安装。
try {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search || '').get('designechoChatTestBridge') === '1') {
        (window as any).__DESIGNECHO_TOOL_TEST_BRIDGE__ = {
            executeToolCall: (toolName: string, params: any, options?: ToolCallExecutionOptions) => executeToolCall(toolName, params, options || {}),
            // 技能（sku-batch 等）走技能执行器而非 Photoshop MCP：给车间验收脚本一个不经模型直接跑一站的入口
            executeSkill: async (skillId: string, params: any) => {
                const { executeSkillTool } = await import('./skill-executors/skill-tools');
                const project = useAppStore.getState().currentProject;
                const steps: any[] = [];
                const { createGuardedAtomicToolExecutor } = await import('../../shared/agent-skill-atomic-tool-execution');
                const result = await executeSkillTool(skillId, params || {}, {
                    callbacks: { onStep: (step: any) => steps.push({ kind: step?.kind, title: step?.title, detail: step?.detail, status: step?.status }) },
                    // 与手动色卡面板同一做法：测试桥自己签发原子工具执行边界（不经模型）
                    guardedAtomicToolExecutor: createGuardedAtomicToolExecutor({
                        userRequest: String(params?.userInput || `测试桥执行 ${skillId}`),
                        executeTool: (toolName: string, toolParams: any) => executeToolCall(toolName, toolParams, {})
                    }),
                    context: {
                        projectContext: project ? { projectId: project.id, projectPath: project.path } : undefined,
                        conversationHistory: [],
                        userInput: String(params?.userInput || ''),
                        testBridge: true
                    }
                });
                return { ...(result || {}), __steps: steps.slice(-40) };
            }
        };
    }
} catch {
    // 非浏览器环境（单元测试）忽略
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

type PreparedProjectContactSheetCandidate = {
    path: string;
    relativePath?: string;
    labelHint?: string;
    role?: string;
    folderType?: string;
    imageType?: string;
};

function buildCandidateSetObservationSourceId(
    prefix: string,
    imageData: string,
    items: Array<{
        id?: unknown;
        path?: unknown;
        relativePath?: unknown;
        status?: unknown;
    }> | undefined
): string {
    const sourceManifest = (items || []).map((item) => ({
        id: String(item.id || ''),
        path: String(item.path || ''),
        relativePath: String(item.relativePath || ''),
        status: String(item.status || '')
    }));
    const observationIdentity = JSON.stringify({
        imageHash: sha256Hex(imageData),
        sourceManifest
    });
    return `${prefix}:${sha256Hex(observationIdentity).slice(0, 24)}`;
}

function normalizeProjectContactSheetMaxImages(value: unknown): number {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) return 40;
    return Math.max(1, Math.min(80, Math.round(numeric)));
}

async function prepareProjectContactSheetInput(params: any, designEcho: any): Promise<{
    projectDir?: string;
    images: PreparedProjectContactSheetCandidate[];
    maxImages: number;
    candidateCoverage: ProjectContactSheetCandidateCoverage;
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

    const providedImages = Array.isArray(params.images) ? params.images : [];
    const universeScope: ProjectContactSheetCandidateCoverage['universeScope'] = providedImages.length > 0
        ? 'provided_candidates'
        : 'project_scan';
    let candidateUniverse: PreparedProjectContactSheetCandidate[];
    if (providedImages.length > 0) {
        candidateUniverse = providedImages
            .map((image: any) => ({
                path: String(image?.path || '').trim(),
                relativePath: String(image?.relativePath || '').trim() || undefined,
                labelHint: String(image?.labelHint || image?.name || '').trim() || undefined,
                role: String(image?.role || '').trim() || undefined,
                folderType: String(image?.folderType || image?.role || '').trim() || undefined,
                imageType: String(image?.imageType || '').trim() || undefined
            }))
            .filter((image: PreparedProjectContactSheetCandidate) => Boolean(image.path));
    } else {
        const scan = await designEcho.scanDirectory(projectDir || currentProject?.path, {
            recursive: true,
            includeDesignFiles: false,
            maxDepth: params.maxDepth || 5,
            generateThumbnails: false
        });
        const scannedImages = (scan?.files || [])
            .filter((file: any) => file?.type === 'image' && file?.path);
        candidateUniverse = scannedImages.map((file: any) => {
            const relativePath = String(file.relativePath || file.name || '').replace(/\\/g, '/');
            const segments = relativePath.split('/').filter(Boolean);
            return {
                path: file.path,
                relativePath,
                labelHint: file.name,
                role: segments.length > 1 ? segments[segments.length - 2] : undefined,
                folderType: segments.length > 1 ? segments[segments.length - 2] : undefined,
                imageType: file.imageType
            };
        });
    }

    const uniqueCandidates = selectDiverseProjectVisualCandidates(
        candidateUniverse,
        candidateUniverse.length
    );
    const maxImages = normalizeProjectContactSheetMaxImages(params.maxImages);
    const images = selectDiverseProjectVisualCandidates(uniqueCandidates, maxImages);
    const candidateCoverage = buildProjectContactSheetCandidateCoverage({
        candidateUniverseCount: uniqueCandidates.length,
        attemptedCandidateCount: images.length,
        displayedCandidateCount: images.length,
        universeScope
    });

    return { projectDir, images, maxImages, candidateCoverage };
}

function formatProjectContactSheetCandidateCoverage(
    coverage: ProjectContactSheetCandidateCoverage
): string {
    const scope = coverage.universeScope === 'project_scan' ? '项目扫描候选' : '调用方提供候选';
    let status = '跨度抽样';
    if (coverage.failedRenderCount > 0) {
        status = '渲染不完整';
    } else if (coverage.status === 'complete') {
        status = '完整展示';
    }
    return `${scope}共 ${coverage.candidateUniverseCount} 张，选入渲染 ${coverage.attemptedCandidateCount} 张、成功展示 ${coverage.displayedCandidateCount} 张、渲染失败 ${coverage.failedRenderCount} 张、未展示 ${coverage.omittedCandidateCount} 张（${status}）；抽样不排序，也不指定最终素材。`;
}

async function loadEagleReferencePixelsForCallingAgent(
    designEcho: any,
    itemId: string
): Promise<Record<string, any>> {
    const eaglePreview = await Promise.resolve().then(() => designEcho.invoke(
        'designKnowledge:getEagleReferenceImageForEvaluation',
        { itemId }
    )).catch((error: unknown) => ({
        success: false,
        error: error instanceof Error ? error.message : String(error)
    }));
    const previewImageData = String(eaglePreview?.imageData || '')
        .replace(/^data:image\/[a-z0-9.+-]+;base64,/iu, '')
        .replace(/\s+/gu, '');
    if (eaglePreview?.success !== true || previewImageData.length === 0) {
        return {
            success: false,
            status: 'unavailable',
            item: { id: itemId },
            error: sanitizeUserVisibleDiagnosticText(
                eaglePreview?.error || 'Eagle 参考预览没有返回可用像素。'
            ),
            referencePixelObservation: {
                status: 'unavailable',
                localPathRedacted: true
            },
            visualObservationHandoff: {
                owner: 'calling_agent',
                status: 'pixels_unavailable',
                sourceKind: 'reference'
            },
            boundaries: {
                readonly: true,
                localPathRedacted: true,
                rawImageRedacted: true,
                doesNotWriteEagle: true,
                doesNotRunPhotoshop: true
            }
        };
    }

    const sourceName = String(eaglePreview?.item?.title || itemId);
    return {
        success: true,
        status: 'ok',
        item: {
            id: String(eaglePreview?.item?.id || itemId),
            title: sourceName
        },
        image: {
            imageData: previewImageData,
            mediaType: 'image/jpeg',
            sourceId: `eagle:${itemId}`,
            sourceKind: 'reference',
            sourceName
        },
        referencePixelObservation: {
            status: 'attached_to_primary_agent',
            sourceId: `eagle:${itemId}`,
            localPathRedacted: true,
            originalFileBytesRedacted: true
        },
        visualObservationHandoff: {
            owner: 'calling_agent',
            status: 'pixels_attached',
            sourceKind: 'reference'
        },
        boundaries: {
            readonly: true,
            localPathRedacted: true,
            rawImageRedacted: true,
            doesNotWriteEagle: true,
            doesNotRunPhotoshop: true,
            agentPreviewAttached: true,
            agentPreviewIsDerivedJpeg: true,
            agentPreviewDoesNotPersist: true
        },
        summary: '已将这条 Eagle 参考的去路径预览交给当前多模态 Agent 直接观察；Tool 内未重复调用视觉模型。'
    };
}

/**
 * 执行资源工具
 */
async function executeResourceTool(toolName: string, params: any, options: ToolCallExecutionOptions = {}): Promise<any> {
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
                    maxImages: prepared.maxImages
                });
                const candidateCoverage = reconcileProjectContactSheetCandidateCoverage({
                    plannedCoverage: prepared.candidateCoverage,
                    renderedItems: result?.items,
                    sheetAvailable: result?.success === true && Boolean(result?.sheet?.imageData)
                });
                const coverageSummary = formatProjectContactSheetCandidateCoverage(
                    candidateCoverage
                );

                return {
                    ...(result || { success: false, items: [], warnings: [], limitations: [] }),
                    candidateCoverage,
                    summary: result?.success
                        ? `已生成项目素材总览：${candidateCoverage.displayedCandidateCount} 张图片成功渲染，编号 ${result.items?.find((item: any) => item?.status === 'rendered')?.id || 'A01'} 起；${coverageSummary}`
                        : `${result?.error || '项目素材总览生成失败。'}；${coverageSummary}`
                };
            }

            case 'analyzeProjectContactSheetOverview': {
                const prepared = await prepareProjectContactSheetInput(params, designEcho);
                if (options.visualConsumptionOwner === 'calling_agent') {
                    const contactSheet = await designEcho.createProjectContactSheetOverview?.({
                        projectPath: prepared.projectDir,
                        images: prepared.images,
                        columns: params.columns,
                        tileWidth: params.tileWidth,
                        tileHeight: params.tileHeight,
                        maxImages: prepared.maxImages
                    });
                    const candidateCoverage = reconcileProjectContactSheetCandidateCoverage({
                        plannedCoverage: prepared.candidateCoverage,
                        renderedItems: contactSheet?.items,
                        sheetAvailable: contactSheet?.success === true
                            && Boolean(contactSheet?.sheet?.imageData)
                    });
                    const sheet = contactSheet?.sheet;
                    const presentationSheet = sheet?.imageData
                        ? {
                            ...sheet,
                            sourceKind: 'candidate_set',
                            sourceId: buildCandidateSetObservationSourceId(
                                'project-contact-sheet',
                                sheet.imageData,
                                contactSheet?.items
                            ),
                            sourceName: '项目素材候选联系表'
                        }
                        : undefined;
                    const contactSheetMetadata = contactSheet && typeof contactSheet === 'object'
                        ? { ...contactSheet, sheet: undefined }
                        : { success: false, items: [], warnings: [], limitations: [] };
                    return {
                        success: contactSheet?.success === true && Boolean(presentationSheet?.imageData),
                        contactSheet: contactSheetMetadata,
                        ...(presentationSheet ? { sheet: presentationSheet } : {}),
                        candidateCoverage,
                        visualObservationHandoff: {
                            owner: 'calling_agent',
                            status: presentationSheet?.imageData ? 'pixels_attached' : 'pixels_unavailable',
                            sourceKind: 'candidate_set'
                        },
                        summary: presentationSheet?.imageData
                            ? `已将项目素材总览交给当前多模态 Agent 直接观察：${candidateCoverage.displayedCandidateCount} 张图片成功渲染；Tool 内未重复调用视觉模型。${formatProjectContactSheetCandidateCoverage(candidateCoverage)}`
                            : `${contactSheet?.error || '项目素材总览生成失败。'}；${formatProjectContactSheetCandidateCoverage(candidateCoverage)}`
                    };
                }
                const result = await designEcho.analyzeProjectContactSheetOverview?.({
                    projectPath: prepared.projectDir,
                    images: prepared.images,
                    columns: params.columns,
                    tileWidth: params.tileWidth,
                    tileHeight: params.tileHeight,
                    maxImages: prepared.maxImages,
                    focus: params.focus,
                    userIntent: params.userIntent || params.requirement || params.query
                });
                const candidateCoverage = reconcileProjectContactSheetCandidateCoverage({
                    plannedCoverage: prepared.candidateCoverage,
                    renderedItems: result?.contactSheet?.items,
                    sheetAvailable: result?.contactSheet?.success === true
                        && Boolean(result?.contactSheet?.sheet?.imageData)
                });
                const inventory = result?.observation?.visualInventory;
                const inventorySummary = inventory
                    ? `可见主体群 ${inventory.visibleSubjectGroups.length}、变体群 ${inventory.visibleVariantGroups.length}、拍摄覆盖 ${inventory.shootingCoverage.length}；仍不确定 ${inventory.uncertainCoverage.length} 项。`
                    : `建议重点复核 ${result?.observation?.nextSingleImageChecks?.join('、') || '若干编号'}。`;

                return {
                    ...(result || { success: false, warnings: [], limitations: [] }),
                    candidateCoverage,
                    summary: result?.success
                        ? `已完成项目素材总览观察：${candidateCoverage.displayedCandidateCount} 张图片成功渲染；${inventorySummary}${formatProjectContactSheetCandidateCoverage(candidateCoverage)}`
                        : `${result?.error || '项目素材总览观察失败。'}；${formatProjectContactSheetCandidateCoverage(candidateCoverage)}`
                };
            }

            case 'prepareSkuRetouchAssets': {
                const currentProject = useAppStore.getState().currentProject;
                const result = await designEcho.prepareSkuRetouchAssets?.({
                    ...params,
                    projectPath: params.projectPath || currentProject?.path
                });
                if (!result) {
                    return { success: false, error: 'SKU 透明主体统一尺度服务未接入当前应用版本。' };
                }
                let summary = result.error || 'SKU 透明主体统一尺度资产准备失败。';
                if (result.workflowStatus === 'prepared') {
                    summary = `已生成 ${result.sources?.filter((source: any) => source.status === 'prepared').length || 0} 组透明主体等比统一尺度资产；仍需写入 Photoshop 并读回验收。`;
                } else if (result.workflowStatus === 'not_applicable') {
                    summary = '当前素材不适用纯底透明主体统一尺度链，应保留原图并改走场景图设计方向。';
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
                    // 真机 08 月：「未找到包含 "2双装" 的文件」被同一模型连喊 5 次——项目里本来就没有这个名字，
                    // 但工具只说「没有」不说「有什么」，模型只能换个写法再猜。把不限类型的近似结果一起交回，让它一次改对。
                    let nearby: string[] = [];
                    try {
                        const broad = await designEcho.searchResources(params.query, { directory: searchDir, limit: 8 });
                        nearby = Array.isArray(broad) ? broad.map((f: any) => String(f?.name || '')).filter(Boolean) : [];
                        if (nearby.length === 0) {
                            const tokens = String(params.query || '').split(/[\s_\-·]+/).filter((t) => t.length >= 2);
                            for (const token of tokens.slice(0, 2)) {
                                const partial = await designEcho.searchResources(token, { directory: searchDir, limit: 8 });
                                if (Array.isArray(partial)) nearby.push(...partial.map((f: any) => String(f?.name || '')).filter(Boolean));
                            }
                            nearby = Array.from(new Set(nearby)).slice(0, 8);
                        }
                    } catch {
                        nearby = [];
                    }
                    return {
                        success: false,
                        error: `在项目目录中未找到名字含 "${params.query}" 的可打开文件（默认只找设计文件 psd/psb/tif）。${nearby.length ? `名字相近的有：${nearby.join('、')}——要打开其中一个就用它的原名；` : '相近的名字也没有；'}换关键词或先 listProjectResources 看目录里到底有什么，不要原样重试。`,
                        searchedDirectory: searchDir,
                        nearbyFiles: nearby
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

            case 'recommendAssets': {
                const result = await window.designEcho.invoke('resource:recommendAssets', {
                    requirement: params.requirement || params.query || '',
                    maxResults: params.maxResults || 5,
                    category: params.category,
                    designRole: params.designRole,
                    placementIntent: params.placementIntent,
                    deterministic: params.deterministic === true,
                    ...(options.visualConsumptionOwner === 'calling_agent'
                        ? { visualConsumptionOwner: 'calling_agent' as const }
                        : {})
                });
                if (options.visualConsumptionOwner !== 'calling_agent') return result;

                const sheet = result?.sheet;
                const presentationSheet = sheet?.imageData
                    ? {
                        ...sheet,
                        sourceKind: 'candidate_set',
                        sourceId: buildCandidateSetObservationSourceId(
                            'asset-shortlist',
                            sheet.imageData,
                            result?.comparisonItems
                        ),
                        sourceName: '素材候选联系表'
                    }
                    : undefined;
                return {
                    ...result,
                    ...(presentationSheet ? { sheet: presentationSheet } : {}),
                    visualObservationHandoff: {
                        owner: 'calling_agent',
                        status: presentationSheet?.imageData ? 'pixels_attached' : 'pixels_unavailable',
                        sourceKind: 'candidate_set'
                    },
                    summary: presentationSheet?.imageData
                        ? `候选联系表已交给当前多模态 Agent 直接比较；内部模型调用为 0。请按 A 编号与 comparisonItems 的路径绑定你自己的选图判断，不要把 metadata 排序当成视觉结论。`
                        : '候选联系表生成失败或没有可用像素；当前只返回 metadata-only 候选，不能据此自动置入。'
                };
            }

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

            case 'searchDesignNotes': {
                // 设计知识笔记检索（用户与 Agent 共写的本地 Markdown 笔记库；只读）
                const noteMatches = await designEcho.invoke('designNotes:search', {
                    query: String(params.query || '').trim(),
                    ...(Array.isArray(params.tags) ? { tags: params.tags.map(String) } : {}),
                    limit: Math.min(Math.max(Number(params.limit) || 20, 1), 50)
                });
                const noteList = Array.isArray(noteMatches) ? noteMatches : [];
                return {
                    success: true,
                    resultCount: noteList.length,
                    results: noteList.map((match: any) => ({
                        id: match?.note?.id,
                        title: match?.note?.title,
                        tags: match?.note?.tags,
                        author: match?.note?.author,
                        updatedAt: match?.note?.updatedAt,
                        excerpt: match?.note?.excerpt,
                        matchedIn: match?.matchedIn
                    })),
                    message: noteList.length > 0
                        ? `找到 ${noteList.length} 条设计笔记。这是用户与 Agent 共同维护的知识，引用时说明来自哪条笔记；需要全文时用 readDesignNote。`
                        : '设计笔记库中没有匹配的笔记。可以换关键词再试，或在形成可复用结论后用 writeDesignNote 记录一条。'
                };
            }

            case 'readDesignNote': {
                const noteId = String(params.id || '').trim();
                if (!noteId) {
                    return { success: false, error: '读取笔记失败：请提供笔记 id（searchDesignNotes 返回的相对路径）。' };
                }
                const readResponse = await designEcho.invoke('designNotes:read', noteId);
                return {
                    success: true,
                    note: readResponse?.note,
                    backlinks: Array.isArray(readResponse?.backlinks)
                        ? readResponse.backlinks.map((meta: any) => ({ id: meta?.id, title: meta?.title }))
                        : [],
                    message: `已读取笔记「${readResponse?.note?.title || noteId}」。正文中的 [[链接]] 指向其他笔记，可按需继续读取。`
                };
            }

            case 'writeDesignNote': {
                const writeContent = String(params.content || '');
                if (!writeContent.trim()) {
                    return { success: false, error: '写入笔记失败：正文（content）为空。' };
                }
                const existingId = String(params.id || '').trim();
                if (!existingId && !String(params.title || '').trim()) {
                    return { success: false, error: '新建笔记失败：缺少标题（title）。更新已有笔记请传 id。' };
                }
                // Agent 更新已有笔记默认追加，避免覆盖用户手写内容；replace 须显式声明
                const writeMode = params.mode === 'replace' ? 'replace' : 'append';
                const written = await designEcho.invoke('designNotes:write', {
                    ...(existingId ? { id: existingId } : {}),
                    ...(params.title ? { title: String(params.title) } : {}),
                    content: writeContent,
                    ...(Array.isArray(params.tags) ? { tags: params.tags.map(String) } : {}),
                    mode: writeMode,
                    author: 'agent'
                });
                return {
                    success: true,
                    note: { id: written?.id, title: written?.title, tags: written?.tags, updatedAt: written?.updatedAt },
                    message: existingId
                        ? `已${writeMode === 'append' ? '追加到' : '重写'}笔记「${written?.title || existingId}」。用户可在知识库·设计笔记页查看和修改。`
                        : `已创建设计笔记「${written?.title}」。用户可在知识库·设计笔记页查看和修改。`
                };
            }

            case 'webSearch': {
                // 通用联网搜索（DeepSeek 原生 web_search：只读外部公开信息、标注来源、防照抄；离线优雅降级）
                const webQuery = String(params.query || '').trim();
                if (!webQuery) {
                    return { success: false, error: '联网搜索失败：请提供搜索关键词（query）。' };
                }
                const webLimit = Math.min(Math.max(Number(params.limit) || 8, 1), 10);
                const webResponse = await designEcho.invoke('webSearch:search', {
                    query: webQuery,
                    limit: webLimit
                });
                if (webResponse?.status !== 'ok') {
                    const webStatus = webResponse?.status || 'unavailable';
                    // 把工具的真实状态如实反馈给 Agent，并给出可自主决策的下一步——不替它做决定。
                    const agentHint = webStatus === 'no_results'
                        ? '本次搜索没有返回可引用的结构化来源。可以调整一次检索表达，或改用本地知识库 / Eagle 参考继续；不要把空结果当成有效信息。'
                        : '这是工具/环境状态问题（通常是未配置 DeepSeek API Key、网络不可达或搜索超时），不是参数用法问题。你可以稍后重试一次，或改用本地知识库 / Eagle 参考继续。';
                    return {
                        success: false,
                        status: webStatus,
                        error: webResponse?.error || '联网搜索不可用。',
                        agentHint
                    };
                }
                const webSources = Array.isArray(webResponse.sources) ? webResponse.sources : [];
                return {
                    success: true,
                    status: 'ok',
                    query: webQuery,
                    resultCount: webSources.length,
                    sources: webSources,
                    warnings: Array.isArray(webResponse.warnings) ? webResponse.warnings : [],
                    countsAsVisualUnderstanding: false,
                    message: `联网搜索完成：${webSources.length} 条来源。结果只是外部公开信息，引用时必须标注来源 URL，禁止照抄；商品/品牌/价格等事实仍需以有来源且已确认的信息为准。`
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
                const eagleAnalysis = await designEcho.invoke('designKnowledge:analyzeEagleReference', {
                    itemId,
                    ...(Array.isArray(params.topics) ? { topics: params.topics.map(String) } : {})
                });
                // 自主沉淀 P1.5：参考观察的可迁移启发入候选池（fire-and-forget，失败不影响分析结果）；
                // 晋升仍由行为验证管辖（启发关联的稿被导出交付才进 provisional），参考解读不直接教评审器。
                if (eagleAnalysis?.success && eagleAnalysis.observation && typeof eagleAnalysis.observation === 'object') {
                    const observations = Object.values(eagleAnalysis.observation as Record<string, unknown>)
                        .filter((value): value is string => typeof value === 'string' && value.trim().length >= 8)
                        .map((value) => `参考启发：${value.trim()}`);
                    if (observations.length > 0) {
                        const projectPath = useAppStore.getState().currentProject?.path;
                        import('./design-workshop/design-learning.store')
                            .then((learning) => learning.recordReferenceLearnings(
                                (channel: string, ...args: any[]) => (window as any).designEcho.invoke(channel, ...args),
                                projectPath,
                                { observations, runScope: options.taskCardScope, eagleItemId: itemId }
                            ))
                            .catch(() => undefined);
                    }
                }
                if (eagleAnalysis?.success !== true
                    || options.visualConsumptionOwner !== 'calling_agent') {
                    return eagleAnalysis;
                }
                // R2 目前仍以结构化 observation 作为 Reference Brief 的可验证来源；在
                // primary semantic sidecar 落地前，顶层 Agent 同时取得真实像素以维持终审
                // 对照证据。这里只保留既有质量语义，不把该路径计入本轮单消费者提速收益。
                const primaryPixelResult = await loadEagleReferencePixelsForCallingAgent(
                    designEcho,
                    itemId
                );
                const previewAttached = primaryPixelResult.success === true
                    && Boolean(primaryPixelResult.image?.imageData);
                return {
                    ...eagleAnalysis,
                    ...(previewAttached ? { image: primaryPixelResult.image } : {}),
                    referencePixelObservation: primaryPixelResult.referencePixelObservation,
                    boundaries: {
                        ...(eagleAnalysis?.boundaries || {}),
                        ...(primaryPixelResult.boundaries || {}),
                        agentPreviewAttached: previewAttached
                    }
                };
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

            case 'readSkillPlaybook': {
                const playbookId = String(params.skillId || '').trim();
                if (!playbookId) {
                    const listResult = await designEcho.invoke('skillPackage:list');
                    if (!listResult?.success) {
                        return { success: false, error: listResult?.error || 'Skill 手册列表读取失败。' };
                    }
                    const items = (listResult.packages || []).map((item: any) => (
                        `${item.id}：${item.description || item.name}（references：${(item.references || []).join('、') || '无'}）`
                    ));
                    return {
                        success: true,
                        packages: listResult.packages,
                        message: items.length > 0
                            ? `可用工作法手册 ${items.length} 份：\n${items.join('\n')}\n传 skillId 读正文。`
                            : '当前没有安装任何工作法手册。'
                    };
                }
                const readResult = await designEcho.invoke(
                    'skillPackage:read',
                    playbookId,
                    String(params.reference || '').trim() || undefined
                );
                if (!readResult?.success) {
                    return { success: false, error: readResult?.error || 'Skill 手册读取失败。' };
                }
                return {
                    success: true,
                    ...readResult,
                    message: readResult.reference
                        ? `手册「${playbookId}」细则 ${readResult.reference}：\n\n${readResult.body}`
                        : `手册「${playbookId}」正文：\n\n${readResult.body}\n\n可用细则：${(readResult.references || []).join('、') || '无'}（按需再读，不要一次全读）。`
                };
            }
            case 'runSkillScript': {
                const scriptSkillId = String(params.skillId || '').trim();
                const scriptName = String(params.script || '').trim();
                if (!scriptSkillId || !scriptName) {
                    return { success: false, error: 'runSkillScript：需要 skillId 与 script（脚本文件名，见手册）。' };
                }
                const scriptResult = await designEcho.invoke(
                    'skillPackage:runScript',
                    scriptSkillId,
                    scriptName,
                    params.params && typeof params.params === 'object' ? params.params : {},
                    useAppStore.getState().currentProject?.path || undefined
                );
                if (!scriptResult?.success) {
                    return {
                        success: false,
                        error: scriptResult?.error || `脚本「${scriptName}」执行失败。`,
                        stdout: scriptResult?.stdout,
                        stderr: scriptResult?.stderr
                    };
                }
                return {
                    success: true,
                    ...scriptResult,
                    message: `脚本「${scriptName}」执行完成（退出码 ${scriptResult.exitCode}）：\n${scriptResult.stdout || '（无输出）'}`
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
    transparentBackground?: boolean;
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
        const provider = useAppStore.getState().integrationSettings.imageGenerationProvider;
        if (provider === 'codex-subscription') {
            const generate = window.designEcho.generateCodexSubscriptionImage;
            if (!generate) {
                return {
                    success: false,
                    error: '当前构建未包含 ChatGPT/Codex 订阅生图通道',
                    message: '订阅生图没有执行：请更新或重新构建 DesignEcho。'
                };
            }
            const generation = await generate({
                prompt,
                width,
                height,
                transparentBackground: params.transparentBackground === true
            });
            if (!generation?.success || !generation.imageData) {
                return {
                    success: false,
                    error: generation?.error || '订阅生图失败',
                    code: generation?.code,
                    resetsAt: generation?.resetsAt,
                    message: `ChatGPT/Codex 订阅生图没有完成：${generation?.error || '服务没有返回图片。'}`
                };
            }
            return {
                success: true,
                message: '图片已通过 ChatGPT/Codex 订阅的 gpt-image-2 生成，请先查看效果，再决定是否放入设计。',
                imageData: generation.imageData,
                width: generation.width,
                height: generation.height,
                mediaType: generation.mediaType,
                model: generation.model || 'gpt-image-2',
                provider: 'codex-subscription',
                revisedPrompt: generation.revisedPrompt,
                transparentBackground: generation.transparentBackground === true
            };
        }

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
            model,
            provider: 'bfl'
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
