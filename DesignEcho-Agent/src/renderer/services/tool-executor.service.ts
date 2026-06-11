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
import { matchDetailPageContentPlans } from './skill-executors/detail-page-asset-ranker';
import {
    AcceptanceCaptureResult,
    buildToolAcceptanceEvidence,
    formatToolAcceptanceDebug,
    getToolAcceptanceCapturePolicy,
    shouldCollectAcceptanceEvidence
} from '../../shared/acceptance/tool-acceptance';

// ==================== 工具定义 ====================

/**
 * 可用工具列表
 * 每个工具包含：名称、描述、参数说明
 */
export const AVAILABLE_TOOLS = [
    // === 文档/画布操作 ===
    { name: 'createDocument', description: '创建新文档', params: '{ preset?: string, width?: number, height?: number, name?: string, backgroundColor?: "white"|"black"|"transparent" }' },
    { name: 'listDocuments', description: '列出所有【已打开】的文档', params: '{ includeDetails?: boolean }' },
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
    { name: 'duplicateLayer', description: '复制图层', params: '{ newName?: string }' },
    { name: 'deleteLayer', description: '删除图层', params: '{ layerId?: number }' },
    { name: 'getLayerProperties', description: '获取图层属性', params: '{ layerId?: number }' },
    
    // === 图层效果 ===
    { name: 'addDropShadow', description: '添加投影', params: '{ color?: {r,g,b}, opacity?: number, distance?: number, size?: number }' },
    { name: 'addStroke', description: '添加描边', params: '{ color?: {r,g,b}, size?: number }' },
    { name: 'addGlow', description: '添加发光', params: '{ type?: "outer"|"inner", color?: {r,g,b} }' },
    { name: 'clearLayerEffects', description: '清除效果', params: '{ layerId?: number }' },
    
    // === 文本操作 ===
    { name: 'getTextContent', description: '获取文本内容', params: '{ layerId?: number, layerIds?: number[] }' },
    { name: 'setTextContent', description: '设置文本内容', params: '{ layerId?: number, content?: string, baselineContent?: string, updates?: { layerId: number, content: string, baselineContent?: string }[] }' },
    { name: 'getTextStyle', description: '获取文本样式', params: '{}' },
    { name: 'resolveFontName', description: '解析 Photoshop 可用字体名', params: '{ fontName?: string, limit?: number }' },
    { name: 'setTextStyle', description: '设置文本样式', params: '{ layerId?: number, fontSize?: number, fontName?: string, tracking?: number, leading?: number }' },
    
    // === 图层管理 ===
    { name: 'renameLayer', description: '重命名图层', params: '{ layerId?: number, newName: string }' },
    { name: 'batchRenameLayers', description: '批量重命名图层（支持前缀/后缀/序号）', params: '{ pattern?: string, prefix?: string, suffix?: string }' },
    { name: 'groupLayers', description: '编组图层', params: '{ layerIds?: number[], groupName?: string }' },
    { name: 'ungroupLayers', description: '解散图层组', params: '{ groupId: number }' },
    { name: 'createClippingMask', description: '创建剪切蒙版', params: '{}' },
    { name: 'releaseClippingMask', description: '释放剪切蒙版', params: '{}' },
    { name: 'getClippingMaskInfo', description: '获取剪切蒙版信息（基底与蒙版图层关系）', params: '{ layerId?: number }' },
    { name: 'getAllClippingMasks', description: '获取文档中所有剪切蒙版', params: '{}' },
    
    // === 视觉分析 ===
    { name: 'getCanvasSnapshot', description: '获取画布截图', params: '{ maxSize?: number }' },
    { name: 'getElementMapping', description: '获取元素映射', params: '{ includeHidden?: boolean }' },
    { name: 'analyzeLayout', description: '分析布局', params: '{ detectHierarchy?: boolean }' },
    
    // === 历史记录 ===
    { name: 'undo', description: '撤销', params: '{ steps?: number }' },
    { name: 'redo', description: '重做', params: '{ steps?: number }' },
    { name: 'getHistoryInfo', description: '获取历史记录', params: '{}' },
    
    // === 导出 ===
    { name: 'saveDocument', description: '保存或另存为文档，支持 PSD/PSB 和显式输出路径', params: '{ format?: "psd"|"psb"|"png"|"jpg"|"jpeg"|"tiff"|"pdf", path?: string, saveAs?: boolean, quality?: number }' },
    { name: 'quickExport', description: '快速导出', params: '{ format?: "png"|"jpg", quality?: number }' },
    { name: 'exportGroup', description: '导出指定图层组或图层为 PNG 文件；需要 groupPath 或 layerId 以及完整 outputPath', params: '{ groupPath?: string[], layerId?: number, outputPath: string, format?: "png", targetWidth?: number, targetHeight?: number, maxSize?: number }' },
    { name: 'smartSave', description: '智能保存（已有路径直接保存，否则弹出对话框），支持显式 PSD/PSB 路径', params: '{ exportFormat?: "psd"|"psb"|"jpg"|"png", path?: string, exportQuality?: number }' },
    
    // === 图像处理 ===
    { name: 'removeBackground', description: '智能抠图', params: '{ targetPrompt?: string, outputFormat?: "layer"|"mask" }' },
    { name: 'placeImage', description: 'Place an image into the current document with deterministic/assistive auto-selection options.', params: '{ filePath?: string, fileToken?: string, imageData?: string, requirement?: string, query?: string, category?: "products"|"backgrounds"|"elements"|"references"|"others", autoSelect?: boolean, selectionMode?: "auto"|"suggest"|"force", strictDeterministic?: boolean, minScore?: number, minMargin?: number, candidateCount?: number, name?: string, x?: number, y?: number, center?: boolean, scale?: number, fitToCanvas?: boolean }' },
    { name: 'replaceLayerContent', description: '替换图层内容为新图片', params: '{ filePath: string, layerId?: number }' },
    { name: 'harmonizeLayer', description: '图像协调（将前景与背景色调协调）', params: '{ foregroundLayerId?: number, intensity?: number }' },
    { name: 'quickHarmonize', description: '快速协调（对当前选中图层）', params: '{ intensity?: number }' },
    
    // === 创建工具 ===
    { name: 'createRectangle', description: '创建矩形', params: '{ x: number, y: number, width: number, height: number, name?: string, color?: {r,g,b}, fillColorHex?: string, cornerRadius?: number }' },
    { name: 'createEllipse', description: '创建椭圆', params: '{ x: number, y: number, width: number, height: number }' },
    { name: 'createTextLayer', description: '创建文字', params: '{ content: string, text?: string, name?: string, x: number, y: number, fontSize?: number, fontName?: string, tracking?: number, leading?: number, colorHex?: string, color?: { r: number, g: number, b: number }, alignment?: "left"|"center"|"right" }' },
    { name: 'createGroup', description: '创建图层组', params: '{ groupName: string }' },
    
    // === SKU 相关 ===
    { name: 'skuLayout', description: 'SKU 排版（listLayerSets/execute/arrangeDynamic/exportNote）', params: '{ action: string, combos?: string[][], outputDir?: string, noteFilePrefix?: string }' },
    { name: 'exportColorConfig', description: '导出 SKU 颜色配置', params: '{}' },
    { name: 'createSkuPlaceholders', description: '创建 SKU 占位符', params: '{ placeholderCount?: number, layout?: "horizontal"|"vertical"|"grid" }' },
    { name: 'getSkuPlaceholders', description: '获取 SKU 占位符信息', params: '{}' },
    { name: 'smartLayout', description: '智能布局引擎', params: '{ fillRatio?: number, alignment?: string }' },
    { name: 'alignToReference', description: '对齐到参考形状', params: '{ referenceLayerName?: string }' },
    
    // === 智能对象操作 ===
    { name: 'getSmartObjectInfo', description: '获取智能对象详细信息（类型、原始尺寸、是否链接等）', params: '{ layerId?: number }' },
    { name: 'convertToSmartObject', description: '将图层转换为智能对象', params: '{ layerIds?: number[], name?: string }' },
    { name: 'editSmartObjectContents', description: '打开智能对象进行编辑（会打开新的 PSB 文档窗口）', params: '{ layerId?: number }' },
    { name: 'replaceSmartObjectContents', description: '替换智能对象内容为新图片', params: '{ filePath: string, layerId?: number }' },
    { name: 'updateSmartObject', description: '更新链接的智能对象', params: '{ layerId?: number, action?: "update"|"relink" }' },
    { name: 'getSmartObjectLayers', description: '获取智能对象内部图层结构', params: '{ layerId?: number, autoOpen?: boolean }' },
    { name: 'duplicateSmartObject', description: '复制智能对象（链接副本或独立副本）', params: '{ layerId?: number, linked?: boolean, newName?: string }' },
    { name: 'rasterizeSmartObject', description: '栅格化智能对象为普通像素图层（不可逆）', params: '{ layerId?: number }' },
    
    // 导出目录：使用 getEntryWithUrl 直接绕过授权，无需工具
    
    // === 项目资源管理（从项目文件夹操作）===
    { name: 'openProjectFile', description: '【推荐】从项目目录搜索并打开PSD/PSB文件。用户说"打开XX文件"时用这个。', params: '{ query: string }' },
    { name: 'searchProjectResources', description: '搜索项目目录中的文件（仅搜索，不打开）', params: '{ query: string, type?: "image"|"design"|"all" }' },
    { name: 'openTemplate', description: '打开指定路径的PSD/PSB文件（需要完整路径）', params: '{ psdPath: string }' },
    { name: 'listProjectResources', description: '列出项目目录中的所有资源', params: '{ directory?: string }' },
    
    // === AI 图片生成（BFL FLUX）===
    { 
        name: 'generateImage', 
        description: '【AI 图片生成】使用 FLUX AI 模型生成全新图片。当用户要求"生成图片"、"画一张"、"创作图片"时使用此工具。注意：这是从零生成新图片，不是 Photoshop 操作。', 
        params: '{ prompt: string, model?: "flux-2-max"|"flux-2-pro"|"flux-2-klein", width?: number, height?: number }' 
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
    { name: 'auditDetailPagePlacement', description: 'Audit detail-page image placements against target bounds and flag offset or stacking risks.', params: '{ screens: any[], placements?: any[] }' },
    { name: 'getScreenSnapshotsWithOverlay', description: 'Capture detail-page screen snapshots with target and actual placement boxes drawn on top.', params: '{ screens: any[], placements?: any[], maxWidth?: number, screenIndices?: number[] }' }
];

/** Agent 工具名 → UXP 工具名 映射（UXP 使用 snake_case） */
const TOOL_NAME_ALIASES: Record<string, string> = {
    harmonizeLayer: 'harmonize_layer',
    quickHarmonize: 'quick_harmonize'
};

/** 视觉相关工具 */
export const VISION_TOOLS = ['getCanvasSnapshot', 'getDocumentSnapshot'];

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
    'transformLayer',
    'quickScale',
    'setTextContent',
    'setTextStyle',
    'setLayerOpacity',
    'setBlendMode',
    'addDropShadow',
    'addStroke',
    'addGlow',
    'clearLayerEffects',
    'renameLayer',
    'duplicateLayer'
]);

let lastAutoFocusAt = 0;

/** 获取工具调用的超时时间 */
function getToolTimeout(toolName: string, params: any): number | undefined {
    if (toolName === 'focusLayer') return 15 * 1000;
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
        error: `${toolName} 调用超时：疑似 Photoshop 原生弹窗或 UXP 模态状态阻塞。`,
        originalError: errorMessage,
        errorCategory: 'photoshop_native_modal_suspected',
        recoveryRequired: true,
        userActionRequired: {
            type: 'photoshop_native_dialog',
            message: '请查看 Photoshop 是否弹出“命令当前不可用”等确认框；关闭弹窗后重载 UXP 插件，再继续执行。'
        },
        suggestion: '先关闭 Photoshop 原生弹窗并重载 UXP 插件；恢复前不要重复执行写入工具，避免继续留下临时文档或触发新的弹窗。',
        toolName,
        params
    };
}

function asFinitePositiveId(value: any): number | undefined {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : undefined;
}

function inferFocusLayerId(toolName: string, params: any, result: any): number | undefined {
    const directCandidates = [
        result?.layerId,
        result?.createdLayerId,
        result?.newLayerId,
        result?.layer?.id,
        result?.group?.id,
        result?.focusedLayer?.id
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

async function maybeAutoFocusAfterTool(toolName: string, params: any, result: any): Promise<any | undefined> {
    if (!shouldAutoFocusAfterTool(toolName, params, result)) return undefined;

    const now = Date.now();
    if (now - lastAutoFocusAt < AUTO_FOCUS_MIN_INTERVAL_MS) return undefined;

    const layerId = inferFocusLayerId(toolName, params, result);
    if (!layerId) return undefined;

    lastAutoFocusAt = now;
    try {
        const focusResult = await window.designEcho.sendToPlugin(
            'focusLayer',
            { layerId, includeBounds: true },
            getToolTimeout('focusLayer', { layerId })
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
const RESOURCE_TOOLS = [
    'listProjectResources', 'searchProjectResources', 'getProjectStructure',
    'getResourcesByCategory', 'getResourceSummary', 'getAssetPreview',
    'analyzeAssetContent', 'recommendAssets', 'openProjectFile'
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

const chatTestFakePhotoshopState: {
    nextLayerId: number;
    documentCreated: boolean;
    document: {
        id: number;
        name: string;
        path: string;
        width: number;
        height: number;
    };
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

function isFakeDocumentAvailable(): boolean {
    return !isChatTestFakePhotoshopEmptyInitialEnabled() || chatTestFakePhotoshopState.documentCreated;
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

function buildChatTestFakePhotoshopResult(toolName: string, params: any): any | undefined {
    if (!isChatTestFakePhotoshopEnabled()) return undefined;

    const documentId = chatTestFakePhotoshopState.document.id;
    const documentName = chatTestFakePhotoshopState.document.name;
    const documentPath = chatTestFakePhotoshopState.document.path;

    if (toolName === 'listDocuments') {
        if (!isFakeDocumentAvailable()) {
            return {
                success: true,
                message: '测试模式：当前没有打开文档。',
                documents: []
            };
        }
        return {
            success: true,
            message: '测试模式：返回 1 个打开文档。',
            documents: [
                {
                    id: documentId,
                    name: documentName,
                    isActive: true,
                    path: documentPath
                }
            ]
        };
    }

    if (toolName === 'getDocumentInfo') {
        if (!isFakeDocumentAvailable() && !params?.__chatTestAcceptanceFailed) {
            return {
                success: false,
                error: '测试模式：当前没有打开文档。'
            };
        }
        return {
            success: true,
            id: documentId,
            name: documentName,
            path: documentPath,
            width: chatTestFakePhotoshopState.document.width,
            height: chatTestFakePhotoshopState.document.height,
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

    if (toolName === 'createDocument') {
        chatTestFakePhotoshopState.documentCreated = true;
        chatTestFakePhotoshopState.layers = [];
        chatTestFakePhotoshopState.document = {
            id: documentId,
            name: String(params?.name || 'ChatBridgeGenerated.psd'),
            path: documentPath,
            width: Math.max(1, Math.round(Number(params?.width) || 800)),
            height: Math.max(1, Math.round(Number(params?.height) || 800))
        };
        return {
            success: true,
            documentId,
            document: { ...chatTestFakePhotoshopState.document },
            message: '测试模式：已模拟创建文档。'
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
        const save = params?.save === true;
        return {
            success: true,
            message: save
                ? '测试模式：已模拟保存并关闭文档。'
                : '测试模式：已模拟关闭文档且不保存。',
            closedDocument: documentName,
            documentId: Number(params?.documentId) || documentId,
            save
        };
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
};

type AutoSelectCandidate = {
    path: string;
    name?: string;
    relativePath?: string;
    score: number;
    reason: string;
    suggestedUse?: string;
};

type AutoSelectDecision = {
    requirement: string;
    mode: 'auto' | 'suggest' | 'force';
    strictDeterministic: boolean;
    thresholds: { minScore: number; minMargin: number };
    topScore: number;
    margin: number;
    candidates: AutoSelectCandidate[];
};

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
            suggestedUse: 'Scored from local scan fallback.'
        };
    });

    return sortAutoSelectCandidates(scored, strictDeterministic).slice(0, Math.max(1, limit));
}

async function autoResolvePlaceImageSource(params: any): Promise<any> {
    if (params?.imageData || params?.filePath || params?.fileToken) {
        return params;
    }
    if (params?.autoSelect === false) {
        return params;
    }

    const designEcho = (window as any).designEcho;
    if (!designEcho) {
        return params;
    }

    const requirement = extractPlaceImageRequirement(params) || 'product hero image white background';
    const category = normalizePlaceImageCategory(params?.category);
    const selectionMode = (String(params?.selectionMode || params?.autoSelectMode || 'auto').toLowerCase() as 'auto' | 'suggest' | 'force');
    const strictDeterministic = params?.strictDeterministic === true;
    const minScore = Number.isFinite(Number(params?.minScore)) ? Number(params.minScore) : 72;
    const minMargin = Number.isFinite(Number(params?.minMargin)) ? Number(params.minMargin) : 8;
    const candidateCountRaw = Number(params?.candidateCount);
    const candidateCount = Number.isFinite(candidateCountRaw)
        ? Math.max(1, Math.min(5, Math.floor(candidateCountRaw)))
        : 3;

    let candidates: AutoSelectCandidate[] = [];

    try {
        const recommendResult = await designEcho.recommendAssets({
            requirement,
            maxResults: Math.max(candidateCount, 5),
            category,
            deterministic: strictDeterministic
        });

        const recommendations: AutoSelectRecommendation[] = Array.isArray(recommendResult?.recommendations)
            ? recommendResult.recommendations
            : [];
        candidates = recommendations
            .filter((r) => typeof r?.file?.path === 'string' && !!r.file?.path)
            .map((r) => ({
                path: String(r.file!.path),
                name: r.file?.name,
                relativePath: r.file?.relativePath,
                score: clampAutoScore(Number(r.matchScore || 0)),
                reason: String(r.matchReason || '').trim() || 'recommendation',
                suggestedUse: String(r.suggestedUse || '').trim()
            }));
        candidates = sortAutoSelectCandidates(candidates, strictDeterministic);
    } catch (error) {
        console.warn('[placeImage] auto-recommend failed, fallback to local scan:', error);
    }

    if (candidates.length === 0) {
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
        return params;
    }

    const topCandidate = candidates[0];
    const secondCandidate = candidates[1];
    const margin = secondCandidate ? (topCandidate.score - secondCandidate.score) : topCandidate.score;
    const decision: AutoSelectDecision = {
        requirement,
        mode: selectionMode,
        strictDeterministic,
        thresholds: { minScore, minMargin },
        topScore: topCandidate.score,
        margin,
        candidates: candidates.slice(0, candidateCount)
    };

    // In "suggest" mode we return candidates for manual confirmation.
    // "auto" and "force" now both place the top candidate directly.
    const shouldBlockForSelection = selectionMode === 'suggest';

    if (shouldBlockForSelection) {
        return {
            ...params,
            __autoSelectBlocked: true,
            __autoSelectDecision: decision
        };
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
    const format = String(value || 'psd').trim().toLowerCase();
    if (format === 'psb') return 'psb';
    if (format === 'png') return 'png';
    if (format === 'jpg' || format === 'jpeg') return 'jpg';
    if (format === 'tif' || format === 'tiff') return 'tiff';
    if (format === 'pdf') return 'pdf';
    return 'psd';
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

async function getCurrentDocumentName(): Promise<string | undefined> {
    try {
        const result = await (window as any).designEcho?.sendToPlugin?.('getDocumentInfo', {});
        return result?.documentName || result?.name || result?.document?.name;
    } catch {
        return undefined;
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
    }
): Promise<AcceptanceCaptureResult> {
    try {
        const designEcho = (window as any).designEcho;
        if (!designEcho?.sendToPlugin) {
            return { error: `无法采集 ${stage} 快照：DesignEcho Photoshop bridge 不可用` };
        }
        const snapshot = await designEcho.sendToPlugin('getAcceptanceSnapshot', {
            includeHidden: options.includeHidden,
            includeBounds: options.includeBounds,
            includeText: options.includeText,
            maxLayers: options.maxLayers
        }, options.timeoutMs);

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

function attachAcceptanceEvidence(toolName: string, params: any, result: any, before: AcceptanceCaptureResult, after: AcceptanceCaptureResult): any {
    const acceptance = buildToolAcceptanceEvidence({
        toolName,
        params,
        result,
        before,
        after
    });

    if (result && typeof result === 'object' && !Array.isArray(result)) {
        return {
            ...result,
            acceptance
        };
    }

    return {
        success: result !== false,
        value: result,
        acceptance
    };
}
// ==================== 工具执行 ====================

/**
 * 执行工具调用
 */
export const executeToolCall = async (toolName: string, params: any): Promise<any> => {
    const startTime = Date.now();
    console.log(`[ToolCall] 执行: ${toolName}`, params);
    
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

        const chatTestFakePhotoshopResult = buildChatTestFakePhotoshopResult(toolName, params);
        if (chatTestFakePhotoshopResult) {
            if (chatTestFakePhotoshopResult.success) {
                executedToolsInSession.push(toolName);
                recordToolExecution(toolName, params, chatTestFakePhotoshopResult);
            }
            toolLogger.logToolCall(toolName, params, chatTestFakePhotoshopResult, Date.now() - startTime, currentRound);
            return chatTestFakePhotoshopResult;
        }
        
        // 资源工具在 Agent 端处理
        if (RESOURCE_TOOLS.includes(toolName)) {
            result = await executeResourceTool(toolName, params);
            if (result.success) executedToolsInSession.push(toolName);
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

        // 自动化无弹窗策略：默认阻止会触发系统/PS 文件弹窗的调用
        if (AUTOMATION_BLOCK_DIALOG && params?.allowDialog !== true) {
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
                const quality = params?.quality ?? params?.exportQuality;
                if (hasValue(quality)) {
                    saveParams.quality = quality;
                }
                const saveResult = await window.designEcho.sendToPlugin(
                    'saveDocument',
                    saveParams,
                    getToolTimeout('saveDocument', { path: autoPath })
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
                const result = {
                    success: false,
                    error: 'Candidate list returned. Please confirm before placement.',
                    selectionRequired: true,
                    requirement: decision.requirement,
                    mode: decision.mode,
                    strictDeterministic: decision.strictDeterministic,
                    topScore: decision.topScore,
                    margin: decision.margin,
                    thresholds: decision.thresholds,
                    candidates: decision.candidates || [],
                    suggestion: 'Pass filePath directly, or set selectionMode to "auto" or "force" to place Top1 automatically.'
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
        
        // UXP 工具调用（应用名称别名）
        const uxpToolName = TOOL_NAME_ALIASES[toolName] || toolName;
        const timeout = getToolTimeout(toolName, finalParams);
        const acceptancePolicy = getToolAcceptanceCapturePolicy(toolName, finalParams);
        const collectAcceptance = acceptancePolicy.collect && shouldCollectAcceptanceEvidence(toolName, finalParams);
        const acceptanceBefore = collectAcceptance
            ? await captureAcceptanceSnapshot('before', toolName, acceptancePolicy)
            : undefined;
        result = await window.designEcho.sendToPlugin(uxpToolName, finalParams, timeout);
        console.log(`[ToolCall] 结果:`, result);

        if (collectAcceptance && acceptanceBefore) {
            const acceptanceAfter = await captureAcceptanceSnapshot('after', toolName, acceptancePolicy);
            result = attachAcceptanceEvidence(toolName, finalParams, result, acceptanceBefore, acceptanceAfter);
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

        const focusEvidence = await maybeAutoFocusAfterTool(toolName, finalParams, result);
        if (focusEvidence && result && typeof result === 'object' && !Array.isArray(result)) {
            result = {
                ...result,
                focusEvidence
            };
        }
        
        // 记录成功的工具
        if (result?.success !== false) {
            executedToolsInSession.push(toolName);
            recordToolExecution(toolName, params, result);
        }
        
        // 错误恢复建议
        if (!result?.success && result?.error) {
            const recovery = getErrorRecovery(toolName, result.error);
            if (recovery) result.suggestion = recovery;
        }
        
        toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
        return result;
        
    } catch (error) {
        console.error(`[ToolCall] 错误:`, error);
        const errorMessage = error instanceof Error ? error.message : '工具调用失败';
        if (isPhotoshopNativeModalTimeout(errorMessage)) {
            const modalResult = buildPhotoshopNativeModalSuspectedResult(toolName, errorMessage, params);
            toolLogger.logToolCall(toolName, params, modalResult, Date.now() - startTime, currentRound);
            return modalResult;
        }
        const result = { 
            success: false, 
            error: errorMessage,
            suggestion: getErrorRecovery(toolName, errorMessage)
        };
        toolLogger.logToolCall(toolName, params, result, Date.now() - startTime, currentRound);
        return result;
    }
};

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
        
        // 记录字体偏好
        if (params?.fontName) {
            memory.learnPreference('font', params.fontName);
        }
    } catch (e) {
        console.warn('[ToolExecutor] 记录失败:', e);
    }
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
                
                // 4. 使用系统方法打开文件（绕过 UXP 安全限制）
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
                
            case 'analyzeAssetContent':
                return await window.designEcho.invoke('resource:analyzeAsset', params.imagePath || params.path || '');
                
            case 'recommendAssets':
                return await window.designEcho.invoke('resource:recommendAssets', {
                    requirement: params.requirement || params.query || '',
                    maxResults: params.maxResults || 5,
                    category: params.category,
                    deterministic: params.deterministic === true
                });
                
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

// ==================== AI 图片生成 ====================

/**
 * 执行 AI 图片生成（BFL FLUX）
 * 
 * 这是 Agent 可调用的工具，当用户要求"生成图片"、"画一张"时使用
 */
async function executeImageGeneration(params: {
    prompt: string;
    model?: string;
    width?: number;
    height?: number;
}): Promise<any> {
    const { prompt, model = 'flux-2-max', width = 1024, height = 1024 } = params;
    
    if (!prompt) {
        return { success: false, error: '请提供图片描述（prompt）' };
    }
    
    console.log(`[generateImage] 开始生成图片: "${prompt.substring(0, 50)}..."`);
    
    try {
        // 1. 检查 BFL API Key
        const hasApiKey = await window.designEcho.bfl.hasApiKey();
        if (!hasApiKey) {
            return {
                success: false,
                error: '未配置 BFL API 密钥',
                message: '⚠️ **未配置 BFL API 密钥**\n\n请在 **设置 → API 密钥 → Black Forest Labs** 中配置 API Key。\n\n获取 API Key: [bfl.ai](https://bfl.ai)',
                suggestion: '请先在设置中配置 BFL API 密钥'
            };
        }
        
        // 2. 调用 BFL API 生成图片
        console.log(`[generateImage] 调用 BFL API: model=${model}, size=${width}x${height}`);
        const result = await window.designEcho.bfl.text2image(model, prompt, { width, height });
        
        if (!result.success || !result.data?.url) {
            return {
                success: false,
                error: result.error || '图片生成失败',
                message: `❌ 图片生成失败: ${result.error || '未知错误'}`
            };
        }
        
        console.log(`[generateImage] 生成成功，下载图片...`);
        
        // 3. 下载图片
        const downloadResult = await window.designEcho.bfl.downloadImage(result.data.url);
        
        if (!downloadResult.success || !downloadResult.data) {
            return {
                success: true,
                message: `⚠️ 图片生成成功但下载失败\n\n**图片链接**: ${result.data.url}\n\n*链接24小时内有效*`,
                imageUrl: result.data.url
            };
        }
        
        console.log(`[generateImage] 下载完成`);
        
        // 4. 返回成功结果（包含 base64 图片数据）
        return {
            success: true,
            message: `✅ **图片生成成功！**\n\n**模型**: FLUX ${model.replace('flux-2-', '').toUpperCase()}\n**提示词**: ${prompt}`,
            imageData: downloadResult.data,
            imageUrl: result.data.url,
            width: result.data.width,
            height: result.data.height
        };
        
    } catch (error: any) {
        console.error('[generateImage] 错误:', error);
        return {
            success: false,
            error: error.message || '图片生成出错',
            message: `❌ 图片生成出错: ${error.message || '未知错误'}`
        };
    }
}

// ==================== 结果处理 ====================

/**
 * 处理工具结果，识别图像数据
 */
export const processToolResults = (
    results: { toolName: string; result: any }[]
): { textContent: string; hasImages: boolean; images: { data: string; mediaType: string }[] } => {
    const textParts: string[] = [];
    const images: { data: string; mediaType: string }[] = [];
    let hasImages = false;

    for (const { toolName, result } of results) {
        if (VISION_TOOLS.includes(toolName) && result?.success && result?.imageData) {
            hasImages = true;
            images.push({
                data: result.imageData,
                mediaType: result.format === 'png' ? 'image/png' : 'image/jpeg'
            });
            textParts.push(`[${toolName}] 返回画布截图`);
        } else {
            textParts.push(`[${toolName}] ${summarizeToolResultForModel(result)}`);
        }
    }

    return { textContent: textParts.join('\n\n'), hasImages, images };
};

function summarizeToolResultForModel(result: any): string {
    if (result === null || result === undefined) return '无返回结果';
    if (typeof result === 'string') return result.length > 500 ? `${result.slice(0, 500)}...` : result;
    if (typeof result !== 'object') return String(result);

    const parts: string[] = [];
    const success = result.success !== false;
    parts.push(success ? '执行成功' : '执行失败');

    if (typeof result.message === 'string' && result.message.trim()) {
        parts.push(`消息：${truncateForToolSummary(result.message, 300)}`);
    }
    if (typeof result.error === 'string' && result.error.trim()) {
        parts.push(`错误：${truncateForToolSummary(result.error, 300)}`);
    }
    if (typeof result.acceptance?.summaryText === 'string') {
        parts.push(result.acceptance.summaryText);
    }

    const scalarFields = ['name', 'documentName', 'layerName', 'count', 'totalLayers', 'width', 'height', 'path'];
    for (const key of scalarFields) {
        const value = result[key];
        if (value === null || value === undefined || typeof value === 'object') continue;
        parts.push(`${key}=${truncateForToolSummary(String(value), 160)}`);
    }

    return parts.join('；');
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
    return AVAILABLE_TOOLS
        .filter((tool) => tool.name !== 'removeBackground')
        .map(t => `- ${t.name}: ${t.description}`)
        .join('\n');
};

// ==================== 详情页内容匹配 ====================


/**
 * 屏类型到素材类型映射
 */
const SCREEN_ASSET_MAP: Record<string, string[]> = {
    'A_营销信息': ['scene'],
    'B_信任状': ['icon'],
    'C_详情页首屏': ['product'],
    'C_核心卖点': ['product'],
    'D_图标icon': ['icon'],
    'D_图标卖点': ['icon'],
    'E_KV图_调性': ['scene', 'product'],
    'E_KV图': ['scene', 'product'],
    'F_颜色款式展示': ['product'],
    'F_颜色展示': ['product'],
    'G_面料': ['detail'],
    'G_面料说明': ['detail'],
    'H_解决痛点': ['detail', 'product'],
    'I_穿搭推荐': ['model', 'scene'],
    'J_细节展示': ['detail'],
    'K_产品参数': ['product'],
    'K_产品信息': ['product'],
    'L_模特实拍': ['model'],
    'M_售后服务': ['icon'],
    'CUSTOM': ['product']
};

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

/**
 * 执行详情页内容匹配
 */
async function executeDetailPageContentMatch(params: {
    screens: any[];
    projectPath: string;
    screenPlans?: any[];
    selectedScene?: any;
    selectedDesignContext?: any;
    selectedElementContext?: any;
    selectedModuleContext?: any;
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

    let projectAssets: { images: any[] } = { images: [] };
    if (projectPath) {
        try {
            const scanResult = await window.designEcho.invoke('ecommerce:scanProject', projectPath);
            if (scanResult?.folders) {
                projectAssets.images = flattenFolderImages(scanResult.folders);
                console.log(`[ContentMatch] 扫描到 ${projectAssets.images.length} 张详情页可用素材（已排除 PSD/主图/SKU/视频等文件夹）`);
            } else if (scanResult?.images) {
                projectAssets.images = scanResult.images;
            }
        } catch (e: any) {
            console.warn(`[ContentMatch] 扫描项目素材失败: ${e.message}`);
        }
    } else {
        console.warn('[ContentMatch] 未指定 projectPath，且 appStore 中无当前项目');
    }

    const ranked = await matchDetailPageContentPlans({
        screens: screens || [],
        projectAssets,
        screenPlans: Array.isArray(params.screenPlans) ? params.screenPlans : [],
        selectedScene: params.selectedScene || null,
        selectedDesignContext: params.selectedDesignContext || null,
        selectedElementContext: params.selectedElementContext || null,
        selectedModuleContext: params.selectedModuleContext || null
    });

    console.log(`[ContentMatch] 生成 ${ranked.plans.length} 个填充方案`);
    return ranked;
}

/**
 * 为单个屏生成填充方案
 */
async function generateScreenPlan(screen: any, projectAssets: { images: any[] }) {
    const copies: any[] = [];
    const images: any[] = [];
    
    const screenType = screen.type || 'CUSTOM';
    
    // 1. 匹配文案（暂时保留模板原文）
    for (const copy of screen.copyPlaceholders || []) {
        copies.push({
            layerId: copy.layerId,
            layerName: copy.layerName,
            content: copy.currentText || '',
            source: 'template',
            originalText: copy.currentText
        });
    }
    
    // 2. 匹配图片
    const preferredTypes = SCREEN_ASSET_MAP[screenType] || ['product'];
    
    for (const img of screen.imagePlaceholders || []) {
        let matched = false;
        
        // 按优先级查找素材
        for (const assetType of preferredTypes) {
            const candidates = projectAssets.images.filter(
                (i: any) => i.type === assetType
            );
            
            if (candidates.length > 0) {
                // 选择宽高比最接近的
                const best = findBestAspectRatioMatch(candidates, img.aspectRatio || 1);
                images.push({
                    layerId: img.layerId,
                    layerName: img.layerName,
                    imagePath: best.path,
                    fillMode: resolveDetailFillMode(assetType, img, screenType),
                    assetType,
                    needsMatting: assetType === 'product',
                    subjectAlign: 'center'
                });
                matched = true;
                break;
            }
        }
        
        // 无匹配时使用任意可用素材
        if (!matched && projectAssets.images.length > 0) {
            const best = findBestAspectRatioMatch(projectAssets.images, img.aspectRatio || 1);
            const bestType = best.type || 'product';
            images.push({
                layerId: img.layerId,
                layerName: img.layerName,
                imagePath: best.path,
                fillMode: resolveDetailFillMode(bestType, img, screenType),
                assetType: bestType,
                needsMatting: bestType === 'product',
                subjectAlign: 'center'
            });
        } else if (!matched) {
            // 无素材时返回空
            images.push({
                layerId: img.layerId,
                layerName: img.layerName,
                imagePath: '',
                fillMode: resolveDetailFillMode('product', img, screenType),
                assetType: 'product'
            });
        }
    }
    
    // 计算置信度
    const total = copies.length + images.length;
    const matched = images.filter(i => i.imagePath).length;
    const confidence = total > 0 ? matched / total : 0;
    
    return {
        screenId: screen.id,
        screenName: screen.name,
        screenType,
        copies,
        images,
        confidence,
        needsReview: confidence < 0.7
    };
}

function resolveDetailFillMode(assetType: string, placeholder: any, screenType: string): 'cover' | 'contain' | 'smart' {
    const zone = String(placeholder?.zone || '').toLowerCase();
    const layerName = String(placeholder?.layerName || '').toLowerCase();
    const iconLike = zone === 'icon' || /icon|图标|装饰|标签/.test(layerName);
    if (iconLike || assetType === 'icon') return 'contain';

    if (assetType === 'product' || assetType === 'model' || assetType === 'detail') {
        return 'contain';
    }

    if (assetType === 'scene') {
        const lower = String(screenType || '').toLowerCase();
        if (lower.includes('kv') || lower.includes('hero') || lower.includes('banner')) {
            return 'cover';
        }
        return 'smart';
    }

    return 'smart';
}

/**
 * 找到宽高比最接近的图片
 */
function findBestAspectRatioMatch(candidates: any[], targetRatio: number): any {
    let best = candidates[0];
    let minDiff = Infinity;
    
    for (const img of candidates) {
        const ratio = (img.width || 1) / (img.height || 1);
        const diff = Math.abs(ratio - targetRatio);
        if (diff < minDiff) {
            minDiff = diff;
            best = img;
        }
    }
    
    return best;
}
