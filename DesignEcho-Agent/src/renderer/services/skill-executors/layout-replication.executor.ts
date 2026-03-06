import type { SkillExecutor, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';
import { executeToolCall } from '../tool-executor.service';
import { useAppStore } from '../../stores/app.store';

interface LayoutElement {
    type?: string;
    name?: string;
    content?: string;
    position?: { x?: number; y?: number };
    size?: { width?: number; height?: number };
    zIndex?: number;
}

interface LayoutAnalysisResult {
    layoutType?: string;
    canvasSize?: { width?: number; height?: number };
    elements?: LayoutElement[];
    alignmentGroups?: Array<{ type?: string; elementIndices?: number[] }>;
}

interface MatchAction {
    tool?: string;
    params?: Record<string, any>;
}

interface MatchItem {
    refElement?: string;
    targetLayerId?: number;
    targetLayerName?: string;
    action?: MatchAction;
}

interface MatchResult {
    matches?: MatchItem[];
    summary?: string;
}

interface TemplateBlueprintElement {
    role: 'copy' | 'icon' | 'image' | 'background' | 'decoration' | 'unknown';
    name: string;
    content?: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

interface TemplateBlueprintScreen {
    index: number;
    type: string;
    label: string;
    groups: Array<'文案' | 'icon' | '图片'>;
    elements: TemplateBlueprintElement[];
}

interface PixelBox {
    left: number;
    top: number;
    width: number;
    height: number;
}

interface GeneratedCopyPlaceholder {
    layerId: number;
    layerName: string;
    currentText: string;
    role: 'title' | 'subtitle' | 'body' | 'label' | 'unknown';
    bounds: PixelBox;
}

interface GeneratedImagePlaceholder {
    layerId: number;
    layerName: string;
    bounds: PixelBox;
    aspectRatio: number;
    recommendedAssetType: 'product' | 'model' | 'detail' | 'scene' | 'icon';
}

interface GeneratedTemplateScreen {
    id: number;
    name: string;
    type: string;
    copyPlaceholders: GeneratedCopyPlaceholder[];
    imagePlaceholders: GeneratedImagePlaceholder[];
}

function clamp01(v: number, fallback = 0): number {
    if (!Number.isFinite(v)) return fallback;
    return Math.max(0, Math.min(1, v));
}

function parseJsonObject(text: string): any | null {
    if (!text) return null;
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first < 0 || last <= first) return null;
    try {
        return JSON.parse(text.slice(first, last + 1));
    } catch {
        return null;
    }
}

function normalizeRole(rawType: string, name: string): TemplateBlueprintElement['role'] {
    const t = String(rawType || '').toLowerCase();
    const n = String(name || '').toLowerCase();
    if (/title|subtitle|text|copy|文案|标题|说明/.test(t) || /title|subtitle|text|copy|文案|标题|说明/.test(n)) return 'copy';
    if (/icon|badge|label|tag|图标|标签/.test(t) || /icon|badge|label|tag|图标|标签/.test(n)) return 'icon';
    if (/image|photo|product|model|hero|kv|picture|图片|主图|模特/.test(t) || /image|photo|product|model|hero|kv|picture|图片|主图|模特/.test(n)) return 'image';
    if (/background|bg|背景/.test(t) || /background|bg|背景/.test(n)) return 'background';
    if (/decoration|shape|line|装饰|图形/.test(t) || /decoration|shape|line|装饰|图形/.test(n)) return 'decoration';
    return 'unknown';
}

function guessDetailScreenType(text: string): string {
    const t = text.toLowerCase();
    if (/营销|活动|优惠|促销|discount|campaign/.test(t)) return '营销信息';
    if (/信任|背书|品牌|认证|award|trust/.test(t)) return '信任状/品牌背书';
    if (/首屏|hero|kv|banner|主视觉/.test(t)) return '详情页首屏';
    if (/icon|图标|标签|卖点/.test(t)) return '图标icon';
    if (/颜色|款式|配色|color|variant/.test(t)) return '颜色款式展示';
    if (/面料|材质|fabric|material/.test(t)) return '面料';
    if (/痛点|问题|解决|pain|solution/.test(t)) return '解决痛点问题';
    if (/穿搭|搭配|outfit|styling/.test(t)) return '穿搭推荐';
    if (/参数|规格|尺码|spec|size/.test(t)) return '产品参数';
    if (/细节|工艺|detail|closeup/.test(t)) return '细节展示';
    return '自定义模块';
}

function buildDetailTemplateBlueprint(layoutAnalysis: LayoutAnalysisResult): {
    layoutType: string;
    screens: TemplateBlueprintScreen[];
} {
    const rawElements = Array.isArray(layoutAnalysis?.elements) ? layoutAnalysis.elements : [];
    const normalized = rawElements
        .map((el, idx) => {
            const x = clamp01(Number(el?.position?.x), 0.5);
            const y = clamp01(Number(el?.position?.y), 0.5);
            const width = clamp01(Number(el?.size?.width), 0.2);
            const height = clamp01(Number(el?.size?.height), 0.1);
            const name = String(el?.name || `${el?.type || 'element'}_${idx + 1}`);
            return {
                role: normalizeRole(String(el?.type || ''), name),
                name,
                content: typeof el?.content === 'string' ? el.content : undefined,
                x,
                y,
                width,
                height
            } as TemplateBlueprintElement;
        })
        .sort((a, b) => a.y - b.y);

    if (normalized.length === 0) {
        return { layoutType: String(layoutAnalysis?.layoutType || 'unknown'), screens: [] };
    }

    const screens: TemplateBlueprintScreen[] = [];
    const GAP_THRESHOLD = 0.12;
    let cluster: TemplateBlueprintElement[] = [];
    let anchorY = normalized[0].y;

    const flushCluster = (items: TemplateBlueprintElement[]) => {
        if (items.length === 0) return;
        const textBlob = items.map(it => `${it.name} ${it.content || ''}`).join(' ');
        const type = guessDetailScreenType(textBlob);
        screens.push({
            index: screens.length + 1,
            type,
            label: `第${screens.length + 1}屏_${type}`,
            groups: ['文案', 'icon', '图片'],
            elements: items
        });
    };

    for (const el of normalized) {
        if (cluster.length === 0) {
            cluster.push(el);
            anchorY = el.y;
            continue;
        }

        if (Math.abs(el.y - anchorY) > GAP_THRESHOLD) {
            flushCluster(cluster);
            cluster = [el];
            anchorY = el.y;
            continue;
        }

        cluster.push(el);
        anchorY = (anchorY + el.y) / 2;
    }

    flushCluster(cluster);

    return {
        layoutType: String(layoutAnalysis?.layoutType || 'unknown'),
        screens
    };
}

function toNumber(v: any, fallback = 0): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
}

function computePixelBox(element: TemplateBlueprintElement, canvasWidth: number, canvasHeight: number): PixelBox {
    // The analysis prompt enforces top-left coordinates in [0,1].
    const left = Math.round(clamp(element.x, 0, 1) * canvasWidth);
    const top = Math.round(clamp(element.y, 0, 1) * canvasHeight);
    const width = Math.round(clamp(element.width, 0.02, 1) * canvasWidth);
    const height = Math.round(clamp(element.height, 0.02, 1) * canvasHeight);
    return {
        left: clamp(left, 0, Math.max(0, canvasWidth - 10)),
        top: clamp(top, 0, Math.max(0, canvasHeight - 10)),
        width: clamp(width, 24, Math.max(24, canvasWidth)),
        height: clamp(height, 24, Math.max(24, canvasHeight))
    };
}

function roleGroupName(role: TemplateBlueprintElement['role']): '文案' | 'icon' | '图片' {
    if (role === 'copy') return '文案';
    if (role === 'icon') return 'icon';
    return '图片';
}

function placeholderColor(role: TemplateBlueprintElement['role']): string {
    if (role === 'icon') return '#BFD7EA';
    if (role === 'image') return '#C7E9B4';
    if (role === 'background') return '#E0E0E0';
    if (role === 'decoration') return '#E8DFF5';
    return '#D9D9D9';
}

function recommendAssetTypeByRole(role: TemplateBlueprintElement['role']): 'product' | 'model' | 'detail' | 'scene' | 'icon' {
    if (role === 'icon') return 'icon';
    if (role === 'background') return 'scene';
    if (role === 'image') return 'product';
    if (role === 'decoration') return 'detail';
    return 'product';
}

function normalizeCopyRole(content: string): 'title' | 'subtitle' | 'body' | 'label' | 'unknown' {
    const t = String(content || '').toLowerCase();
    if (t.length <= 12) return 'title';
    if (t.length <= 24) return 'subtitle';
    if (/价格|price|¥|￥|元/.test(t)) return 'label';
    if (t.length > 32) return 'body';
    return 'unknown';
}

async function safeRenameLayer(layerId: number | undefined, newName: string): Promise<void> {
    if (!layerId) return;
    try {
        await executeToolCall('renameLayer', { layerId, newName });
    } catch {
        // Non-blocking.
    }
}

async function ensurePlaceholderByRole(
    role: '文案' | 'icon' | '图片',
    screenIndex: number,
    canvasWidth: number,
    canvasHeight: number
): Promise<number | undefined> {
    if (role === '文案') {
        const textResult = await executeToolCall('createTextLayer', {
            content: `[文案占位] 第${screenIndex}屏`,
            x: 24,
            y: 48,
            fontSize: 28,
            colorHex: '#444444'
        });
        const layerId = textResult?.layerId as number | undefined;
        await safeRenameLayer(layerId, `文案_占位_${screenIndex}`);
        return layerId;
    }

    const shapeResult = await executeToolCall('createRectangle', {
        name: `${role}_占位_${screenIndex}`,
        x: Math.round(canvasWidth * (role === 'icon' ? 0.05 : 0.1)),
        y: Math.round(canvasHeight * (role === 'icon' ? 0.12 : 0.18)),
        width: Math.round(canvasWidth * (role === 'icon' ? 0.12 : 0.7)),
        height: Math.round(canvasHeight * (role === 'icon' ? 0.08 : 0.24)),
        fillColorHex: role === 'icon' ? '#BFD7EA' : '#C7E9B4',
        cornerRadius: role === 'icon' ? 18 : 8
    });
    const layerId = shapeResult?.layerId as number | undefined;
    if (layerId) {
        await executeToolCall('setLayerOpacity', { layerId, opacity: 28 });
    }
    return layerId;
}

async function applyTemplateBlueprintToDocument(
    blueprint: { layoutType: string; screens: TemplateBlueprintScreen[] },
    canvas: { width: number; height: number },
    callbacks: SkillExecuteParams['callbacks'],
    signal?: AbortSignal
): Promise<{
    success: boolean;
    screenCount: number;
    createdLayers: number;
    rootGroupName?: string;
    failedOps: number;
    generatedScreens: GeneratedTemplateScreen[];
}> {
    const screenGroupIds: number[] = [];
    const generatedScreens: GeneratedTemplateScreen[] = [];
    let createdLayers = 0;
    let failedOps = 0;

    for (const screen of blueprint.screens) {
        if (signal?.aborted) {
            return {
                success: true,
                screenCount: screenGroupIds.length,
                createdLayers,
                failedOps,
                rootGroupName: undefined,
                generatedScreens
            };
        }

        callbacks?.onMessage?.(`生成模板骨架: 第${screen.index}屏 ${screen.type}`);

        const roleLayerMap: Record<'文案' | 'icon' | '图片', number[]> = {
            文案: [],
            icon: [],
            图片: []
        };
        const generatedCopyPlaceholders: GeneratedCopyPlaceholder[] = [];
        const generatedImagePlaceholders: GeneratedImagePlaceholder[] = [];

        for (let i = 0; i < screen.elements.length; i++) {
            const element = screen.elements[i];
            const group = roleGroupName(element.role);
            const box = computePixelBox(element, canvas.width, canvas.height);

            try {
                if (element.role === 'copy') {
                    const content = String(element.content || '').trim() || `[文案] ${screen.type}`;
                    const fontSize = clamp(Math.round(box.height * 0.45), 16, 72);
                    const textResult = await executeToolCall('createTextLayer', {
                        content,
                        x: box.left + 6,
                        y: box.top + fontSize + 4,
                        fontSize,
                        colorHex: '#333333'
                    });
                    const layerId = textResult?.layerId as number | undefined;
                    await safeRenameLayer(layerId, `文案_${screen.index}_${i + 1}`);
                    if (layerId) {
                        const layerName = `文案_${screen.index}_${i + 1}`;
                        generatedCopyPlaceholders.push({
                            layerId,
                            layerName,
                            currentText: content,
                            role: normalizeCopyRole(content),
                            bounds: box
                        });
                        roleLayerMap[group].push(layerId);
                        createdLayers++;
                    } else {
                        failedOps++;
                    }
                } else {
                    const layerName = `${group}_${screen.index}_${i + 1}`;
                    const shapeResult = await executeToolCall('createRectangle', {
                        name: layerName,
                        x: box.left,
                        y: box.top,
                        width: box.width,
                        height: box.height,
                        fillColorHex: placeholderColor(element.role),
                        cornerRadius: group === 'icon' ? 16 : 6
                    });
                    const layerId = shapeResult?.layerId as number | undefined;
                    if (layerId) {
                        generatedImagePlaceholders.push({
                            layerId,
                            layerName,
                            bounds: box,
                            aspectRatio: box.width > 0 && box.height > 0 ? box.width / box.height : 1,
                            recommendedAssetType: recommendAssetTypeByRole(element.role)
                        });
                        await executeToolCall('setLayerOpacity', { layerId, opacity: group === 'icon' ? 35 : 26 });
                        roleLayerMap[group].push(layerId);
                        createdLayers++;
                    } else {
                        failedOps++;
                    }
                }
            } catch {
                failedOps++;
            }
        }

        // Ensure each required subgroup exists even if no detected elements.
        for (const requiredRole of ['文案', 'icon', '图片'] as const) {
            if (roleLayerMap[requiredRole].length === 0) {
                const fallbackLayerId = await ensurePlaceholderByRole(requiredRole, screen.index, canvas.width, canvas.height);
                if (fallbackLayerId) {
                    if (requiredRole === '文案') {
                        generatedCopyPlaceholders.push({
                            layerId: fallbackLayerId,
                            layerName: `文案_占位_${screen.index}`,
                            currentText: `[文案占位] 第${screen.index}屏`,
                            role: 'title',
                            bounds: {
                                left: 24,
                                top: 24,
                                width: Math.round(canvas.width * 0.7),
                                height: Math.round(canvas.height * 0.1)
                            }
                        });
                    } else {
                        const isIcon = requiredRole === 'icon';
                        const box: PixelBox = {
                            left: Math.round(canvas.width * (isIcon ? 0.05 : 0.1)),
                            top: Math.round(canvas.height * (isIcon ? 0.12 : 0.18)),
                            width: Math.round(canvas.width * (isIcon ? 0.12 : 0.7)),
                            height: Math.round(canvas.height * (isIcon ? 0.08 : 0.24))
                        };
                        generatedImagePlaceholders.push({
                            layerId: fallbackLayerId,
                            layerName: `${requiredRole}_占位_${screen.index}`,
                            bounds: box,
                            aspectRatio: box.width > 0 && box.height > 0 ? box.width / box.height : 1,
                            recommendedAssetType: isIcon ? 'icon' : 'product'
                        });
                    }
                    roleLayerMap[requiredRole].push(fallbackLayerId);
                    createdLayers++;
                } else {
                    failedOps++;
                }
            }
        }

        const roleGroupIds: number[] = [];
        for (const role of ['文案', 'icon', '图片'] as const) {
            const ids = roleLayerMap[role];
            if (ids.length === 0) continue;
            const grouped = await executeToolCall('groupLayers', {
                layerIds: ids,
                groupName: role
            });
            const groupId = grouped?.group?.id as number | undefined;
            if (groupId) {
                roleGroupIds.push(groupId);
            } else {
                failedOps++;
            }
        }

        let currentScreenId = screen.index;
        if (roleGroupIds.length > 0) {
            const screenGroupResult = await executeToolCall('groupLayers', {
                layerIds: roleGroupIds,
                groupName: `一_${String(screen.index).padStart(2, '0')}_${screen.type}`
            });
            const screenGroupId = screenGroupResult?.group?.id as number | undefined;
            if (screenGroupId) {
                currentScreenId = screenGroupId;
                screenGroupIds.push(screenGroupId);
            } else {
                failedOps++;
            }
        }

        generatedScreens.push({
            id: currentScreenId,
            name: `一_${String(screen.index).padStart(2, '0')}_${screen.type}`,
            type: screen.type,
            copyPlaceholders: generatedCopyPlaceholders,
            imagePlaceholders: generatedImagePlaceholders
        });
    }

    let rootGroupName: string | undefined;
    if (screenGroupIds.length > 0) {
        rootGroupName = `详情页模板骨架_${new Date().toISOString().slice(0, 10)}`;
        const root = await executeToolCall('groupLayers', {
            layerIds: screenGroupIds,
            groupName: rootGroupName
        });
        if (!root?.success) {
            failedOps++;
        }
    }

    return {
        success: failedOps === 0 || createdLayers > 0,
        screenCount: blueprint.screens.length,
        createdLayers,
        rootGroupName,
        failedOps,
        generatedScreens
    };
}

function calculatePlanScore(plan: any): {
    confidence: number;
    imageCoverage: number;
    score: number;
} {
    const images = Array.isArray(plan?.images) ? plan.images : [];
    const copies = Array.isArray(plan?.copies) ? plan.copies : [];
    const imageTotal = images.length;
    const imageMatched = images.filter((img: any) => !!img?.imagePath).length;
    const imageCoverage = imageTotal > 0 ? imageMatched / imageTotal : 1;
    const copyTotal = copies.length;
    const copyNonEmpty = copies.filter((c: any) => String(c?.content || '').trim().length > 0).length;
    const copyCoverage = copyTotal > 0 ? copyNonEmpty / copyTotal : 1;
    const confidence = clamp01(Number(plan?.confidence), imageCoverage);
    const score = imageCoverage * 0.65 + copyCoverage * 0.2 + confidence * 0.15;
    return { confidence, imageCoverage, score };
}

async function autoFillAppliedTemplate(
    screens: GeneratedTemplateScreen[],
    projectPath: string,
    callbacks: SkillExecuteParams['callbacks'],
    signal?: AbortSignal,
    options?: {
        minPlanScore?: number;
        minImageCoverage?: number;
        allowLowConfidenceFill?: boolean;
    }
): Promise<{
    success: boolean;
    filledScreens: number;
    failedScreens: number;
    skippedScreens: number;
    guardedScreens: number;
    filledImages: number;
    plansCount: number;
}> {
    const minPlanScore = clamp01(Number(options?.minPlanScore), 0.62);
    const minImageCoverage = clamp01(Number(options?.minImageCoverage), 0.6);
    const allowLowConfidenceFill = options?.allowLowConfidenceFill === true;

    const matchResult = await executeToolCall('matchDetailPageContent', {
        screens,
        projectPath
    });
    if (!matchResult?.success || !Array.isArray(matchResult?.plans)) {
        return {
            success: false,
            filledScreens: 0,
            failedScreens: 0,
            skippedScreens: screens.length,
            guardedScreens: 0,
            filledImages: 0,
            plansCount: 0
        };
    }

    const plans: any[] = matchResult.plans;
    const planByScreenId = new Map<number, any>();
    plans.forEach((plan) => {
        if (!planByScreenId.has(plan.screenId)) {
            planByScreenId.set(plan.screenId, plan);
        }
    });

    let filledScreens = 0;
    let failedScreens = 0;
    let skippedScreens = 0;
    let guardedScreens = 0;
    let filledImages = 0;

    for (let i = 0; i < screens.length; i++) {
        if (signal?.aborted) break;

        const screen = screens[i];
        const plan = planByScreenId.get(screen.id) || plans[i];
        if (!plan) {
            skippedScreens++;
            continue;
        }

        const quality = calculatePlanScore(plan);
        const shouldGuard = !allowLowConfidenceFill
            && (
                !!plan.needsReview
                || quality.score < minPlanScore
                || quality.imageCoverage < minImageCoverage
            );
        const planToApply = shouldGuard ? { ...plan, images: [] } : plan;
        if (shouldGuard) {
            guardedScreens++;
            callbacks?.onMessage?.(
                `自动填充保护: ${screen.name} 评分 ${quality.score.toFixed(2)}，仅填文案`
            );
        }

        const hasCopies = Array.isArray(planToApply.copies) && planToApply.copies.length > 0;
        const hasImages = Array.isArray(planToApply.images) && planToApply.images.some((img: any) => !!img?.imagePath);
        if (!hasCopies && !hasImages) {
            skippedScreens++;
            continue;
        }

        callbacks?.onMessage?.(`自动填充: ${screen.name}`);
        const fillResult = await executeToolCall('fillDetailPage', { plan: planToApply });
        if (fillResult?.success) {
            filledScreens++;
            filledImages += (planToApply.images || []).filter((img: any) => !!img?.imagePath).length;
        } else {
            failedScreens++;
        }
    }

    return {
        success: failedScreens === 0,
        filledScreens,
        failedScreens,
        skippedScreens,
        guardedScreens,
        filledImages,
        plansCount: plans.length
    };
}

export const layoutReplicationExecutor: SkillExecutor = {
    skillId: 'layout-replication',

    async execute({ params, callbacks, signal, context }: SkillExecuteParams): Promise<AgentResult> {
        callbacks?.onMessage?.('正在分析参考图布局...');

        let refImage: string | undefined = context?.attachedImageData;
        if (!refImage && params.referenceImage) {
            let paramImage = params.referenceImage as string;
            if (paramImage.startsWith('data:')) {
                const base64Match = paramImage.match(/base64,(.+)/);
                if (base64Match) paramImage = base64Match[1];
            }
            refImage = paramImage;
        }

        if (!refImage) {
            return {
                success: false,
                message: '缺少参考图。请提供一张参考图后再执行。',
                error: 'No reference image provided'
            };
        }

        const outputMode = String(params.outputMode || '').toLowerCase();
        const templateApplyMode = outputMode === 'template_apply' || params.templateApply === true;
        const templateBlueprintOnly = outputMode === 'template_blueprint' || params.templateBlueprintOnly === true;

        try {
            callbacks?.onToolStart?.('analyzeReferenceLayout');
            callbacks?.onMessage?.('正在调用视觉模型分析元素结构...');

            const modelPreferences = useAppStore.getState().modelPreferences;
            const visionModel = modelPreferences?.mode === 'local'
                ? (modelPreferences?.preferredLocalModels?.visualAnalyze || 'local-llava-13b')
                : (modelPreferences?.preferredCloudModels?.visualAnalyze || 'google-gemini-3-flash');

            const analysisPrompt = [
                '你是电商设计布局分析专家。',
                '请分析参考图并输出 JSON：',
                '{',
                '  "layoutType": "center|left|right|split|grid",',
                '  "elements": [',
                '    {',
                '      "type": "title|subtitle|image|icon|badge|background|decoration",',
                '      "name": "元素名称",',
                '      "position": { "x": 0-1, "y": 0-1 }, // 左上角坐标',
                '      "size": { "width": 0-1, "height": 0-1 },',
                '      "zIndex": 1,',
                '      "content": "文本元素时填写"',
                '    }',
                '  ],',
                '  "alignmentGroups": []',
                '}',
                '只输出 JSON，不要输出额外解释。'
            ].join('\n');

            const analysisResponse = await window.designEcho.chat(visionModel, [
                { role: 'system', content: '你是专业电商设计布局分析助手，只输出 JSON。' },
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: analysisPrompt },
                        { type: 'image', image: { data: refImage, mediaType: 'image/jpeg' } }
                    ]
                }
            ], { maxTokens: 4096, temperature: 0.1 });

            callbacks?.onToolComplete?.('analyzeReferenceLayout', { success: true });

            const layoutAnalysis = parseJsonObject(analysisResponse?.text || '') as LayoutAnalysisResult | null;
            if (!layoutAnalysis || !Array.isArray(layoutAnalysis.elements) || layoutAnalysis.elements.length === 0) {
                return {
                    success: false,
                    message: '无法识别参考图中的有效元素。建议更清晰的参考图后重试。',
                    error: 'Failed to parse layout analysis'
                };
            }

            callbacks?.onMessage?.(`识别到 ${layoutAnalysis.elements.length} 个元素`);

            const templateBlueprint = buildDetailTemplateBlueprint(layoutAnalysis);

            if (templateBlueprintOnly && !templateApplyMode) {
                const screenCount = templateBlueprint.screens.length;
                const previewTypes = templateBlueprint.screens.slice(0, 6).map(s => s.type).join(' / ');

                return {
                    success: true,
                    message: [
                        '参考图模板骨架生成完成',
                        `识别元素: ${layoutAnalysis.elements.length}`,
                        `拆分屏数: ${screenCount}`,
                        previewTypes ? `结构预览: ${previewTypes}` : ''
                    ].filter(Boolean).join('\n'),
                    data: {
                        layoutAnalysis,
                        templateBlueprint
                    },
                    toolResults: [{
                        toolName: 'layout-template-blueprint',
                        result: {
                            success: true,
                            layoutType: templateBlueprint.layoutType,
                            screenCount
                        }
                    }]
                };
            }

            if (templateApplyMode) {
                let docInfo = await executeToolCall('getDocumentInfo', {});
                if (!docInfo?.success && params.autoCreateDocument !== false) {
                    const width = Math.max(800, Math.round(toNumber(layoutAnalysis.canvasSize?.width, 1242)));
                    const height = Math.max(1200, Math.round(toNumber(layoutAnalysis.canvasSize?.height, 3600)));
                    callbacks?.onMessage?.(`未检测到文档，自动创建模板画布 ${width}x${height}`);
                    await executeToolCall('createDocument', {
                        width,
                        height,
                        name: '详情页模板骨架',
                        backgroundColor: 'white'
                    });
                    docInfo = await executeToolCall('getDocumentInfo', {});
                }

                if (!docInfo?.success) {
                    return {
                        success: false,
                        message: '请先打开一个 Photoshop 文档，或开启 autoCreateDocument。',
                        error: 'No document for template apply'
                    };
                }

                const canvas = {
                    width: Math.max(1, Math.round(toNumber(docInfo.width, 1242))),
                    height: Math.max(1, Math.round(toNumber(docInfo.height, 3600)))
                };

                callbacks?.onMessage?.(`开始落地模板骨架到文档: ${docInfo.name} (${canvas.width}x${canvas.height})`);
                const applyResult = await applyTemplateBlueprintToDocument(
                    templateBlueprint,
                    canvas,
                    callbacks,
                    signal
                );

                const projectPath = String(
                    params.projectPath || useAppStore.getState().currentProject?.path || ''
                ).trim();
                const autoFillAfterApply = params.autoFillAfterApply !== false;
                let autoFillResult: Awaited<ReturnType<typeof autoFillAppliedTemplate>> | null = null;

                if (autoFillAfterApply && applyResult.generatedScreens.length > 0) {
                    if (projectPath) {
                        callbacks?.onMessage?.(`开始自动选图填充（项目: ${projectPath}）`);
                        autoFillResult = await autoFillAppliedTemplate(
                            applyResult.generatedScreens,
                            projectPath,
                            callbacks,
                            signal,
                            {
                                minPlanScore: params.minAutoFillPlanScore,
                                minImageCoverage: params.minAutoFillImageCoverage,
                                allowLowConfidenceFill: params.allowLowConfidenceFill !== false
                            }
                        );
                    } else {
                        callbacks?.onMessage?.('已跳过自动填充：缺少 projectPath（请传入或先导入项目）');
                    }
                }

                return {
                    success: autoFillResult ? (applyResult.success && autoFillResult.success) : applyResult.success,
                    message: [
                        '详情页模板骨架已生成',
                        `屏数: ${applyResult.screenCount}`,
                        `创建图层: ${applyResult.createdLayers}`,
                        applyResult.rootGroupName ? `根分组: ${applyResult.rootGroupName}` : '',
                        applyResult.failedOps > 0 ? `失败/跳过操作: ${applyResult.failedOps}` : '',
                        autoFillResult ? `自动填充: ${autoFillResult.filledScreens} 屏成功, ${autoFillResult.filledImages} 张图片` : '',
                        autoFillResult && autoFillResult.guardedScreens > 0 ? `保护策略: ${autoFillResult.guardedScreens} 屏` : '',
                        autoFillResult && autoFillResult.failedScreens > 0 ? `自动填充失败: ${autoFillResult.failedScreens} 屏` : ''
                    ].filter(Boolean).join('\n'),
                    data: {
                        layoutAnalysis,
                        templateBlueprint,
                        applyResult,
                        autoFillResult,
                        projectPathUsed: projectPath || undefined
                    },
                    toolResults: [{
                        toolName: 'layout-template-apply',
                        result: applyResult
                    }, ...(autoFillResult ? [{
                        toolName: 'layout-template-autofill',
                        result: autoFillResult
                    }] : [])]
                };
            }

            if (signal?.aborted) {
                return { success: true, cancelled: true, message: '已停止' };
            }

            const docCheckResult = await executeToolCall('getDocumentInfo', {});
            if (!docCheckResult?.success) {
                return {
                    success: false,
                    message: '请先打开一个 Photoshop 文档，再执行布局复刻。',
                    error: 'No document open'
                };
            }

            const targetDoc = docCheckResult;
            callbacks?.onMessage?.(`目标文档: ${targetDoc.name} (${targetDoc.width}x${targetDoc.height})`);

            callbacks?.onToolStart?.('getElementMapping');
            const elementsResult = await executeToolCall('getElementMapping', {
                sortBy: 'position',
                includeHidden: false
            });
            callbacks?.onToolComplete?.('getElementMapping', elementsResult);

            if (!elementsResult?.success || !Array.isArray(elementsResult.elements) || elementsResult.elements.length === 0) {
                return {
                    success: false,
                    message: '当前文档没有可用于复刻的图层元素。',
                    error: 'No elements in document'
                };
            }

            const currentElements = elementsResult.elements;

            const matchPrompt = [
                '你是 Photoshop 布局复刻专家。',
                '请将参考布局元素与当前文档图层做匹配，并输出 JSON：',
                '{ "matches": [{ "refElement": "", "targetLayerId": 1, "targetLayerName": "", "action": { "tool": "moveLayer", "params": {} } }], "summary": "" }',
                '只输出 JSON。',
                '',
                `参考布局: ${JSON.stringify(layoutAnalysis, null, 2)}`,
                `目标画布尺寸: ${targetDoc.width}x${targetDoc.height}`,
                `当前图层: ${JSON.stringify(currentElements.map((e: any) => ({ id: e.id, name: e.name, type: e.type, bounds: e.bounds, textContent: e.textContent })), null, 2)}`
            ].join('\n');

            const matchResponse = await window.designEcho.chat(
                modelPreferences?.preferredLocalModels?.layoutAnalysis || 'openrouter-qwen/qwen-2.5-72b-instruct',
                [
                    { role: 'system', content: '你是 Photoshop 布局专家，只输出 JSON。' },
                    { role: 'user', content: matchPrompt }
                ],
                { maxTokens: 4096, temperature: 0.1 }
            );

            const matchResult = parseJsonObject(matchResponse?.text || '') as MatchResult | null;
            if (!matchResult || !Array.isArray(matchResult.matches) || matchResult.matches.length === 0) {
                return {
                    success: true,
                    message: [
                        '布局分析完成，但未生成可执行匹配。',
                        `参考布局类型: ${layoutAnalysis.layoutType || 'unknown'}`,
                        '建议先统一图层命名后重试。'
                    ].join('\n'),
                    data: { layoutAnalysis, currentElements }
                };
            }

            let successCount = 0;
            let failCount = 0;

            for (const match of matchResult.matches) {
                if (signal?.aborted) {
                    return { success: true, cancelled: true, message: '已停止' };
                }

                const toolName = match?.action?.tool;
                const toolParams = match?.action?.params;
                if (!toolName || !toolParams) continue;

                callbacks?.onToolStart?.(toolName);
                const actionResult = await executeToolCall(toolName, toolParams);

                if (actionResult?.success) {
                    successCount++;
                    callbacks?.onToolComplete?.(toolName, actionResult);
                } else {
                    failCount++;
                }

                await new Promise(resolve => setTimeout(resolve, 80));
            }

            return {
                success: true,
                message: [
                    '布局复刻完成',
                    `参考元素: ${layoutAnalysis.elements.length}`,
                    `成功调整: ${successCount}`,
                    failCount > 0 ? `失败/跳过: ${failCount}` : '',
                    matchResult.summary || ''
                ].filter(Boolean).join('\n'),
                toolResults: [{ toolName: 'layout-replication', result: { successCount, failCount } }],
                data: { layoutAnalysis, matchResult }
            };
        } catch (replicationError: any) {
            return {
                success: false,
                message: `布局复刻失败: ${replicationError.message}`,
                error: replicationError.message
            };
        }
    }
};
