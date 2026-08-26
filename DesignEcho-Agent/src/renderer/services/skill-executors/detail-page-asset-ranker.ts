import type {
    DetailScreenAssetSelection,
    DetailScreenPlan,
    DetailScreenRole
} from '../../../shared/detail-page-screen-plan';
import type {
    DetailAssetCandidateProposal,
    DetailAssetSelectionReceipt,
    DetailAssetUsageDecision,
    FillPlan,
    ParsedScreen
} from './detail-page.types';
import type { DesignScene } from '../../../shared/types/design-context.types';
import type { SelectedElementContext } from '../../../shared/types/design-scene.types';
import type { SelectedModuleContext } from '../../../shared/types/design-graph.types';
import type { SelectedDesignContext } from '../../../shared/types/design-context.types';
import {
    calculateDetailPageCopyCapacityTolerance,
    clampDetailPageCopyCandidateCount,
    normalizeDetailPageCopyCandidate,
    normalizeDetailPageCopyFacts,
    selectDetailPageCopyCandidate,
    type DetailPageCopyCandidate,
    type DetailPageCopyFact,
    type DetailPageCopyFactInput
} from '../../../shared/detail-page-copy-generation-contract';
import { containsDetailPageHighRiskClaim } from '../../../shared/detail-page-content-verification';
import {
    applyDetailFillPlanCopiesToScreens,
    auditDetailCopyLayoutForScreens
} from '../../../shared/detail-page-copy-layout-audit';
import {
    computePlacementTransform,
    type PlacementPlan,
    type PlacementTransform
} from '../../../shared/reference-replication-placement';
import {
    computeSmartScalingDecision,
    type SmartScalingDecision
} from '../../../shared/design-smart-scaling-policy';
import type {
    DesignAssetDirectUseSuitability,
    DesignAssetSourceTreatment,
    DesignAssetVisualRole
} from '../../../shared/design-placement-intelligence';
import type {
    ProjectVisualAssetNature,
    ProjectVisualBackgroundType,
    ProjectVisualShotType
} from '../../../shared/project-visual-sampling';

export type { DetailAssetUsageDecision } from './detail-page.types';

type AssetType = 'product' | 'model' | 'detail' | 'scene' | 'icon' | 'unknown';
type FillMode = 'cover' | 'contain' | 'smart';

/**
 * 视觉理解构图信号（可选）。治理审计(2026-07-01)阶段1新增：当调用方能提供该字段时参与打分，
 * 缺省时评分逻辑与此前完全一致（scoreVisionFit 的 neutral 默认值 0.5，与 scoreVisualSummaryFit 同规格）。
 * 数据供给已接线：tool-executor.service.ts 的 executeDetailPageContentMatch 会读取项目视觉理解缓存
 * （.designecho/visual-insights-cache.json，经 ecommerce:readVisualInsightCache 轻量只读通道），按素材路径
 * 匹配出 visionSignal 后传入本模块；缓存缺失或读取失败时该字段保持 undefined，评分回到中性 0.5。
 */
export type DetailAssetVisionSignal = {
    visualObserved?: boolean;
    visualEvidenceId?: string;
    /** 一次候选联系表观察得到的视觉职责；素材事实，不等于当前屏可自动使用。 */
    visualRole?: DesignAssetVisualRole;
    assetNature?: ProjectVisualAssetNature;
    shotType?: ProjectVisualShotType;
    backgroundType?: ProjectVisualBackgroundType;
    mainImageSuitability?: 'suitable' | 'marginal' | 'unsuitable';
    subjectCoverageRatio?: 'dominant' | 'moderate' | 'small';
    productType?: string;
};

export type DetailProjectAsset = {
    name?: string;
    path: string;
    relativePath?: string;
    width?: number;
    height?: number;
    sizeBytes?: number;
    modifiedTimeMs?: number;
    type?: string;
    visionSignal?: DetailAssetVisionSignal;
};

type MatchCandidate = {
    asset: DetailProjectAsset;
    score: number;
    reasons: string[];
};

type DetailAssetCandidateSet = {
    candidateSetId: string;
    proposals: DetailAssetCandidateProposal[];
};

type PlacementMetadata = {
    placementPlan?: PlacementPlan;
    placementTransform?: PlacementTransform;
    smartScalingDecision?: SmartScalingDecision;
};

export type DetailPageCopyScreenDirective = {
    screenId?: number;
    screenName?: string;
    objective?: string;
    visualIntent?: string;
};

export type DetailPageCopyGenerationContext = {
    facts?: DetailPageCopyFactInput[];
    audience?: string;
    brandTone?: string;
    creativeStyle?: 'natural' | 'playful' | 'professional' | string;
    screenDirectives?: DetailPageCopyScreenDirective[];
};

export type MatchParams = {
    screens: ParsedScreen[];
    projectAssets: { images: DetailProjectAsset[] };
    screenPlans?: DetailScreenPlan[];
    selectedScene?: DesignScene | null;
    selectedDesignContext?: SelectedDesignContext | null;
    selectedElementContext?: SelectedElementContext | null;
    selectedModuleContext?: SelectedModuleContext | null;
    copyContext?: DetailPageCopyGenerationContext;
    copyFacts?: DetailPageCopyFactInput[];
    targetAudience?: string;
    aiCopyGeneration?: boolean;
    copyReview?: boolean;
    copyMinScore?: number;
    copyCandidateCount?: number;
    copyCreativeStyle?: 'natural' | 'playful' | 'professional' | string;
    lowScoreCopyStrategy?: 'replace' | 'flag' | 'keep';
    copyLayoutFit?: boolean;
    copyLineBreakStyle?: 'balanced' | 'compact' | string;
    copyTitleMaxLines?: number;
    copySubtitleMaxLines?: number;
    copyBodyMaxLines?: number;
    copyOnly?: boolean;
    brandTone?: string;
    screenCopyDirectives?: DetailPageCopyScreenDirective[];
};

function hasConcreteDetailAssetVisualObservation(signal?: DetailAssetVisionSignal): boolean {
    if (!signal) return false;
    if (signal.visualObserved === true) return true;
    return Boolean(
        signal.assetNature
        || signal.shotType
        || signal.backgroundType
        || signal.mainImageSuitability
        || signal.subjectCoverageRatio
        || String(signal.productType || '').trim()
    );
}

function resolveDetailAssetVisualRole(
    signal: DetailAssetVisionSignal | undefined,
    screenPlan?: DetailScreenPlan
): DesignAssetVisualRole {
    if (!signal) return 'unknown';
    if (signal.visualRole && signal.visualRole !== 'unknown') return signal.visualRole;
    if (signal.shotType === 'on_model') return 'model_context';
    if (signal.shotType === 'detail_closeup') {
        return screenPlan?.screenRole === 'material_detail' ? 'material_evidence' : 'detail_evidence';
    }
    if (signal.shotType === 'chart' || signal.shotType === 'package') return 'reference';
    if (signal.shotType === 'scene' || signal.backgroundType === 'scene') return 'hero_scene';
    if (
        signal.shotType === 'flat_lay'
        || signal.backgroundType === 'transparent'
        || signal.backgroundType === 'white_studio'
        || signal.backgroundType === 'solid_color'
        || String(signal.productType || '').trim()
    ) {
        return 'hero_product';
    }
    if (signal.backgroundType === 'designed_composite') return 'hero_scene';
    return 'unknown';
}

/**
 * 把素材像素事实解释成当前详情屏的使用方式。它不选择 Photoshop Tool，也不声称最终审美通过；
 * 只防止“有一张图”被偷换成“这张图可原样直贴当前槽位”。
 */
export function resolveDetailAssetUsageDecision(
    asset: DetailProjectAsset,
    screenPlan?: DetailScreenPlan
): DetailAssetUsageDecision {
    const signal = asset.visionSignal;
    const visualObserved = hasConcreteDetailAssetVisualObservation(signal);
    const visualRole = resolveDetailAssetVisualRole(signal, screenPlan);
    const backgroundType = signal?.backgroundType || 'unknown';
    const buildDecision = (
        directUseSuitability: DesignAssetDirectUseSuitability,
        sourceTreatment: DesignAssetSourceTreatment,
        reason: string
    ): DetailAssetUsageDecision => ({
        visualObserved,
        ...(signal?.visualEvidenceId ? { visualEvidenceId: signal.visualEvidenceId } : {}),
        visualRole,
        backgroundType,
        directUseSuitability,
        sourceTreatment,
        automaticPlacementEligible: directUseSuitability === 'suitable'
            && (sourceTreatment === 'direct_full_frame' || sourceTreatment === 'clip_to_container'),
        reason
    });

    if (!visualObserved) {
        return buildDecision('unsuitable', 'requires_visual_review', '候选只有文件元数据，没有真实视觉观察，不能自动置入。');
    }
    if (signal?.assetNature === 'finished_design') {
        return buildDecision('unsuitable', 'reject', '该文件被观察为已完成设计成品，不能静默当作原始素材回填新详情页。');
    }
    if (visualRole === 'reference') {
        return buildDecision('conditional', 'supporting_only', '该文件被观察为参考/图表类素材，只能作为设计依据或辅助证据，不能自动直贴或剪切进内容槽位。');
    }
    if (backgroundType === 'designed_composite') {
        return buildDecision('conditional', 'supporting_only', '该文件包含已编排的图文或合成背景；这是画面事实，尚不足以授权把整张成品自动直贴或剪切进新设计。');
    }
    if (!screenPlan || screenPlan.requiresModelDecision === true) {
        return buildDecision('unsuitable', 'requires_visual_review', '当前屏幕角色尚未形成可执行设计决策，候选只能保留为观察结果，不能由启发式排名直接写入。');
    }

    const heroScreen = screenPlan?.screenRole === 'hero' || screenPlan?.imageStrategy === 'hero';
    if (heroScreen) {
        if (visualRole === 'detail_evidence' || visualRole === 'material_evidence') {
            return buildDecision('conditional', 'supporting_only', '素材更适合细节或佐证，不应自动升级为详情页首屏主视觉。');
        }
        if (backgroundType === 'white_studio' || backgroundType === 'solid_color') {
            return buildDecision('conditional', 'matte_and_recompose', '棚拍/纯色底商品素材可作为原料，但首屏需要去底并重新建立背景、尺度和空间关系。');
        }
        if (backgroundType === 'transparent') {
            return buildDecision('suitable', 'clip_to_container', '透明主体素材可进入首屏容器，再按主体边界完成构图适配。');
        }
        if (
            visualRole === 'hero_scene'
            || visualRole === 'model_context'
            || backgroundType === 'scene'
            || signal?.shotType === 'scene'
            || signal?.shotType === 'on_model'
        ) {
            return buildDecision('suitable', 'clip_to_container', '场景或上身素材与首屏叙事相符，可在目标容器内完成裁切和层级组织。');
        }
        if (signal?.mainImageSuitability === 'unsuitable') {
            return buildDecision('conditional', 'supporting_only', '视觉观察已表明该素材不适合突出商品，不能自动作为首屏 Hero。');
        }
        return buildDecision('unsuitable', 'requires_visual_review', '虽已看过素材，但背景与首屏使用方式仍不明确，需要补充视觉用途判断。');
    }

    if (
        (
            screenPlan?.imageStrategy === 'detail'
            || screenPlan?.imageStrategy === 'material'
            || screenPlan?.imageStrategy === 'comparison'
        )
        && (
            visualRole === 'detail_evidence'
            || visualRole === 'material_evidence'
            || visualRole === 'hero_product'
            || signal?.shotType === 'flat_lay'
        )
    ) {
        return buildDecision('suitable', 'clip_to_container', '商品、细节或材质素材与当前证据/对比型屏幕相符，可在目标容器内使用；最终仍需检查矩形边界是否与版式融合。');
    }
    if (
        screenPlan?.imageStrategy === 'context'
        && (visualRole === 'hero_scene' || visualRole === 'model_context')
    ) {
        return buildDecision('suitable', 'clip_to_container', '场景/上身素材与当前情境型屏幕相符，可放入目标容器。');
    }
    if (backgroundType === 'white_studio' || backgroundType === 'solid_color') {
        return buildDecision('unsuitable', 'requires_visual_review', '白底/纯色底只是素材事实；当前屏幕用途不足以决定直用还是去底重组，需要补充用途判断，不能仅按背景类型下命令。');
    }
    if (
        backgroundType === 'transparent'
        || backgroundType === 'scene'
    ) {
        return buildDecision('suitable', 'clip_to_container', '素材背景与当前详情屏可兼容，仍需在容器内完成裁切和读回。');
    }
    return buildDecision('unsuitable', 'requires_visual_review', '当前视觉事实不足以确定安全的直接使用方式。');
}

type GeneratedCopySlot = {
    layerId: number;
    candidates: DetailPageCopyCandidate[];
};

type GeneratedCopySelection = DetailPageCopyCandidate & {
    belowMinScore: boolean;
};

type CopyGenerationFailureReason =
    | 'copy-provider-unavailable'
    | 'copy-provider-request-failed'
    | 'copy-provider-response-invalid'
    | 'copy-candidate-rejected-or-missing';

type GeneratedCopyBatchResult = {
    replacements: Map<number, GeneratedCopySelection>;
    failureReasonByLayerId: Map<number, CopyGenerationFailureReason>;
};

type DetailPageCopyRuntimePolicy = {
    enabled: boolean;
    reviewEnabled: boolean;
    minScore: number;
    candidateCount: number;
    creativeStyle: string;
    lowScoreStrategy: 'replace' | 'flag' | 'keep';
    layoutFit: boolean;
    lineBreakStyle: 'balanced' | 'compact';
    titleMaxLines: number;
    subtitleMaxLines: number;
    bodyMaxLines: number;
    copyOnly: boolean;
    brandTone: string;
    audience: string;
    facts: DetailPageCopyFact[];
    screenDirectives: DetailPageCopyScreenDirective[];
};

type CopyTargetInput = {
    layerId: number;
    layerName?: string;
    originalText?: string;
    role?: string;
    bounds?: unknown;
    fontSize?: number;
    currentText?: string;
    warnings?: string[];
};

type ScreenCopyRequest = {
    screen: ParsedScreen;
    screenPlan: DetailScreenPlan;
    copyTargets: CopyTargetInput[];
    selectedScene?: DesignScene | null;
    selectedElementContext?: SelectedElementContext | null;
    selectedModuleContext?: SelectedModuleContext | null;
    isFocusedScreen?: boolean;
};

const COPY_REQUEST_BATCH_SIZE = 4;

const SCREEN_COPY_BATCH_SIZE = 4;

const DETAIL_PAGE_COPY_SYSTEM_PROMPT = [
    '你是一位负责电商详情页的资深商品文案策划。',
    '模型负责提出文案候选、事实引用、评分与理由；Harness 负责校验引用、容量和最低分。',
    '只允许使用提示词中列出的事实；未确认事实不得写成确定性商品声明。',
    '每个文字槽位必须返回指定数量的候选，不得复述模板旧文案作为兜底。',
    '输出必须是单个 JSON 对象，禁止 Markdown、解释性前后缀或额外字段。',
    '固定结构：{"slots":[{"layerId":123,"candidates":[{"content":"候选文案","supportRefs":["detail-fact:state-record:0123456789abcdef"],"score":0.86,"reason":"为何适合这一屏和槽位"}]}]}'
].join('\n');

const SCREEN_TYPE_ASSET_MAP: Record<string, AssetType[]> = {
    'A_MARKETING_INFO': ['scene'],
    'B_TRUST_BADGE': ['icon'],
    'C_HERO': ['product', 'scene'],
    'C_SELLING_POINT': ['product', 'scene'],
    'D_ICON': ['icon'],
    'D_ICON_SELLING_POINT': ['icon'],
    'E_KV_ATMOSPHERE': ['scene', 'product'],
    'E_KV': ['scene', 'product'],
    'F_COLOR_VARIANT': ['product'],
    'F_COLOR': ['product'],
    'G_MATERIAL': ['detail', 'product'],
    'G_MATERIAL_INFO': ['detail', 'product'],
    'H_PAIN_POINT': ['detail', 'product'],
    'I_STYLING': ['model', 'scene'],
    'J_DETAIL': ['detail', 'product'],
    'K_PARAMETER': ['product', 'detail'],
    'K_PRODUCT_INFO': ['product', 'detail'],
    'L_MODEL': ['model'],
    'M_SERVICE': ['icon'],
    CUSTOM: ['product']
};

const SCREEN_ROLE_ASSET_MAP: Record<DetailScreenRole, AssetType[]> = {
    hero: ['scene', 'product'],
    'selling-point': ['product', 'scene', 'detail'],
    material_detail: ['detail', 'product'],
    process_detail: ['detail', 'product'],
    feature_detail: ['detail', 'product'],
    scene: ['model', 'scene', 'product'],
    parameter: ['product', 'detail'],
    closing: ['scene', 'product'],
    unknown: ['product']
};

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

function chunkItems<T>(items: T[], size: number): T[][] {
    if (!Array.isArray(items) || items.length === 0) return [];
    const chunkSize = Math.max(1, Math.floor(size || 1));
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += chunkSize) {
        chunks.push(items.slice(index, index + chunkSize));
    }
    return chunks;
}

function sortScreensByFocus<T extends { id?: number; screenId?: number }>(items: T[], focusedScreenId: number | null): T[] {
    if (!focusedScreenId) return [...items];
    return [...items].sort((a, b) => {
        const aId = Number(a.id || a.screenId || 0);
        const bId = Number(b.id || b.screenId || 0);
        return Number(bId === focusedScreenId) - Number(aId === focusedScreenId);
    });
}

function normalizeAssetType(value: string | undefined): AssetType {
    const raw = String(value || 'unknown').toLowerCase();
    if (raw.includes('product')) return 'product';
    if (raw.includes('model')) return 'model';
    if (raw.includes('detail')) return 'detail';
    if (raw.includes('scene')) return 'scene';
    if (raw.includes('icon')) return 'icon';
    return 'unknown';
}

function getScreenPreferredTypes(screenType: string): AssetType[] {
    return SCREEN_TYPE_ASSET_MAP[screenType] || SCREEN_TYPE_ASSET_MAP.CUSTOM;
}

function getRolePreferredTypes(screenPlan?: DetailScreenPlan): AssetType[] {
    if (!screenPlan) return [];
    if (screenPlan.requiresModelDecision) return [];
    return SCREEN_ROLE_ASSET_MAP[screenPlan.screenRole] || [];
}

function getPreferredTypes(screen: ParsedScreen, screenPlan?: DetailScreenPlan): AssetType[] {
    const merged = [...getRolePreferredTypes(screenPlan), ...getScreenPreferredTypes(screen.type || 'CUSTOM')];
    return merged.filter((item, index) => merged.indexOf(item) === index);
}

function getPlaceholderAspectRatio(placeholder: any): number {
    const ratio = Number(placeholder?.aspectRatio || 0);
    if (ratio > 0) return ratio;
    const width = Math.max(1, Number(placeholder?.bounds?.width || 1));
    const height = Math.max(1, Number(placeholder?.bounds?.height || 1));
    return width / height;
}

function getAssetAspectRatio(asset: DetailProjectAsset): number {
    const width = Math.max(1, Number(asset?.width || 1));
    const height = Math.max(1, Number(asset?.height || 1));
    return width / height;
}

function getAssetPixelArea(asset: DetailProjectAsset): number {
    return Math.max(1, Number(asset?.width || 1) * Number(asset?.height || 1));
}

function scoreAspectFit(asset: DetailProjectAsset, placeholder: any): number {
    const target = getPlaceholderAspectRatio(placeholder);
    const ratio = getAssetAspectRatio(asset);
    const diff = Math.abs(Math.log(ratio / Math.max(0.01, target)));
    return clamp01(1 - (diff / 1.2));
}

function scoreTypeFit(assetType: AssetType, preferredTypes: AssetType[], recommendedType?: string): number {
    const normalizedRecommended = normalizeAssetType(recommendedType);
    if (assetType === normalizedRecommended && assetType !== 'unknown') return 1;
    if (preferredTypes.includes(assetType)) return 0.84;
    if (assetType === 'unknown') return 0.35;
    if ((assetType === 'detail' && preferredTypes.includes('product')) || (assetType === 'product' && preferredTypes.includes('detail'))) {
        return 0.62;
    }
    if ((assetType === 'scene' && preferredTypes.includes('model')) || (assetType === 'model' && preferredTypes.includes('scene'))) {
        return 0.58;
    }
    return 0.22;
}

function scoreRoleFit(assetType: AssetType, screenType: string, placeholder: any, screenPlan?: DetailScreenPlan): number {
    const zone = String(placeholder?.zone || '').toLowerCase();
    if (zone === 'icon') return assetType === 'icon' ? 1 : 0;

    if (screenPlan) {
        if (screenPlan.requiresModelDecision) {
            return assetType === 'unknown' ? 0.35 : 0.5;
        }
        switch (screenPlan.screenRole) {
            case 'hero':
                return assetType === 'scene' ? 1 : assetType === 'product' ? 0.78 : 0.2;
            case 'selling-point':
                return assetType === 'product' ? 1 : assetType === 'scene' ? 0.74 : assetType === 'detail' ? 0.7 : 0.2;
            case 'material_detail':
                return assetType === 'detail' ? 1 : assetType === 'product' ? 0.72 : 0.2;
            case 'process_detail':
            case 'feature_detail':
                return assetType === 'detail' ? 1 : assetType === 'product' ? 0.68 : 0.2;
            case 'scene':
                return assetType === 'model' ? 1 : assetType === 'scene' ? 0.78 : assetType === 'product' ? 0.52 : 0.18;
            case 'parameter':
                return assetType === 'product' ? 0.92 : assetType === 'detail' ? 0.6 : 0.2;
            case 'closing':
                return assetType === 'scene' ? 0.86 : assetType === 'product' ? 0.8 : 0.18;
            default:
                break;
        }
    }

    const lower = String(screenType || '').toLowerCase();
    if (/hero|kv|banner|首屏|核心|营销/.test(lower)) {
        return assetType === 'scene' ? 1 : assetType === 'product' ? 0.7 : 0.3;
    }
    if (/模特|穿搭|推荐|model/.test(lower)) {
        return assetType === 'model' ? 1 : assetType === 'scene' ? 0.65 : 0.2;
    }
    if (/细节|面料|工艺|detail|material/.test(lower)) {
        return assetType === 'detail' ? 1 : assetType === 'product' ? 0.68 : 0.25;
    }
    if (/参数|信息|规格|尺码|parameter/.test(lower)) {
        return assetType === 'product' ? 0.9 : assetType === 'detail' ? 0.55 : 0.2;
    }
    return assetType === 'product' ? 0.72 : 0.45;
}

function scoreResolutionSuitability(asset: DetailProjectAsset, placeholder: any): number {
    const placeholderArea = Math.max(1, Number(placeholder?.bounds?.width || 1) * Number(placeholder?.bounds?.height || 1));
    const assetArea = getAssetPixelArea(asset);
    if (assetArea >= placeholderArea * 8) return 1;
    if (assetArea >= placeholderArea * 4) return 0.86;
    if (assetArea >= placeholderArea * 2) return 0.74;
    if (assetArea >= placeholderArea) return 0.58;
    return 0.28;
}

function scoreNameHint(asset: DetailProjectAsset, screenType: string, screenPlan?: DetailScreenPlan): number {
    const name = String(asset?.name || '').toLowerCase();
    if (!name) return 0.4;

    if (screenPlan?.requiresModelDecision) {
        return 0.45;
    }

    if (screenPlan) {
        switch (screenPlan.screenRole) {
            case 'scene':
                if (/模特|上脚|穿搭|model|look/.test(name)) return 1;
                break;
            case 'material_detail':
                if (/面料|材质|纹理|fabric|material/.test(name)) return 1;
                break;
            case 'process_detail':
                if (/工艺|做工|车线|缝合|stitch|craft/.test(name)) return 1;
                break;
            case 'feature_detail':
                if (/细节|面料|纹理|close|detail|fabric/.test(name)) return 1;
                break;
            case 'hero':
            case 'closing':
                if (/场景|氛围|banner|kv|scene|hero/.test(name)) return 1;
                break;
            case 'parameter':
                if (/参数|规格|尺码|flat|pack/.test(name)) return 0.92;
                break;
            default:
                break;
        }
    }

    const lower = String(screenType || '').toLowerCase();
    if (/模特|model/.test(lower) && /模特|上脚|穿搭|model/.test(name)) return 1;
    if (/细节|面料|工艺|detail|material/.test(lower) && /细节|面料|纹理|close|detail|fabric/.test(name)) return 1;
    if (/kv|hero|首屏|营销/.test(lower) && /场景|氛围|banner|kv|scene/.test(name)) return 1;
    if (/颜色|款式|variant|color/.test(lower) && /颜色|色卡|款式|variant|color/.test(name)) return 0.9;
    return 0.45;
}

function scoreVisualSummaryFit(assetType: AssetType, screenPlan?: DetailScreenPlan): number {
    const visual = screenPlan?.visualSummary;
    if (!visual) return 0.5;
    if (screenPlan?.requiresModelDecision) return 0.5;

    let score = 0.5;
    const visualRole = visual.roleHint || screenPlan?.screenRole || 'unknown';

    switch (visualRole) {
        case 'hero':
            if (assetType === 'scene') score += 0.14;
            else if (assetType === 'product') score += 0.1;
            else if (assetType === 'detail') score -= 0.1;
            break;
        case 'scene':
            if (assetType === 'model') score += 0.12;
            else if (assetType === 'scene') score += 0.1;
            else if (assetType === 'detail') score -= 0.08;
            break;
        case 'parameter':
            if (assetType === 'product') score += 0.12;
            else if (assetType === 'detail') score += 0.08;
            else if (assetType === 'scene' || assetType === 'model') score -= 0.08;
            break;
        case 'material_detail':
        case 'process_detail':
        case 'feature_detail':
            if (assetType === 'detail') score += 0.14;
            else if (assetType === 'product') score += 0.06;
            else if (assetType === 'scene' || assetType === 'model') score -= 0.08;
            break;
        case 'selling-point':
            if (assetType === 'product') score += 0.08;
            else if (assetType === 'detail') score += 0.04;
            break;
        default:
            break;
    }

    if (visual.dominantModuleType === 'image' && (assetType === 'scene' || assetType === 'product' || assetType === 'model')) {
        score += 0.04;
    }
    if (visual.imageModuleCount >= 2 && (assetType === 'detail' || assetType === 'product')) {
        score += 0.04;
    }
    if (visual.boundaryRisk === 'risky') {
        score -= 0.06;
    } else if (visual.boundaryRisk === 'ok') {
        score += 0.03;
    }

    return clamp01(score);
}

/**
 * 视觉理解构图信号参与打分（叠加，不替换其余启发式打分）。没有信号时返回 0.5 中性值，
 * 与 scoreVisualSummaryFit 无信号时的默认行为一致，保证旧行为不受影响。
 */
function scoreVisionFit(asset: DetailProjectAsset, screenPlan?: DetailScreenPlan): number {
    const signal = asset.visionSignal;
    if (!signal) return 0.5;

    let score = 0.5;
    const screenRole = screenPlan?.screenRole;
    const productForwardRole = screenRole === 'hero' || screenRole === 'selling-point' || screenRole === 'parameter';
    const sceneForwardRole = screenRole === 'scene';

    if (signal.mainImageSuitability === 'suitable' && productForwardRole) score += 0.14;
    if (signal.mainImageSuitability === 'unsuitable' && productForwardRole) score -= 0.14;
    if (signal.subjectCoverageRatio === 'dominant' && productForwardRole) score += 0.06;
    if (signal.subjectCoverageRatio === 'small' && sceneForwardRole) score += 0.04;
    if (signal.subjectCoverageRatio === 'small' && productForwardRole) score -= 0.06;

    return clamp01(score);
}

function scoreAssetUsageDecision(asset: DetailProjectAsset, screenPlan?: DetailScreenPlan): number {
    const decision = resolveDetailAssetUsageDecision(asset, screenPlan);
    if (decision.automaticPlacementEligible) return 1;
    if (decision.sourceTreatment === 'matte_and_recompose') return 0.48;
    if (decision.sourceTreatment === 'supporting_only') return 0.2;
    return 0;
}

function rankAssetsForPlaceholder(
    screen: ParsedScreen,
    placeholder: any,
    availableAssets: DetailProjectAsset[],
    usedPaths: Set<string>,
    screenPlan?: DetailScreenPlan
): MatchCandidate[] {
    const preferredTypes = getPreferredTypes(screen, screenPlan);

    return (availableAssets || [])
        .map((asset) => {
            const assetType = normalizeAssetType(asset.type);
            const typeFit = scoreTypeFit(assetType, preferredTypes, placeholder?.recommendedAssetType);
            const roleFit = scoreRoleFit(assetType, screen.type || 'CUSTOM', placeholder, screenPlan);
            const aspectFit = scoreAspectFit(asset, placeholder);
            const resolutionFit = scoreResolutionSuitability(asset, placeholder);
            const nameHint = scoreNameHint(asset, screen.type || 'CUSTOM', screenPlan);
            const visualFit = scoreVisualSummaryFit(assetType, screenPlan);
            const visionFit = scoreVisionFit(asset, screenPlan);
            const usageFit = scoreAssetUsageDecision(asset, screenPlan);
            const reusePenalty = usedPaths.has(String(asset.path || '')) ? 0.12 : 0;
            const score = clamp01(
                (typeFit * 0.2)
                + (roleFit * 0.16)
                + (aspectFit * 0.13)
                + (resolutionFit * 0.08)
                + (nameHint * 0.05)
                + (visualFit * 0.06)
                + (visionFit * 0.12)
                + (usageFit * 0.2)
                - reusePenalty
            );

            const reasons = [
                `type:${typeFit.toFixed(2)}`,
                `role:${roleFit.toFixed(2)}`,
                `aspect:${aspectFit.toFixed(2)}`,
                `resolution:${resolutionFit.toFixed(2)}`,
                `name:${nameHint.toFixed(2)}`,
                `visual:${visualFit.toFixed(2)}`,
                `vision:${visionFit.toFixed(2)}`,
                `usage:${usageFit.toFixed(2)}`
            ];
            if (reusePenalty > 0) reasons.push(`reuse:-${reusePenalty.toFixed(2)}`);

            return {
                asset,
                score,
                reasons
            };
        })
        .sort((a, b) => b.score - a.score);
}

function normalizeDetailAssetPath(value: unknown): string {
    const normalized = String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
    return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}

function stableDetailCandidateHash(value: string): string {
    let hash = 0x811c9dc5;
    for (const char of value) {
        hash ^= char.codePointAt(0) || 0;
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

function buildDetailAssetCandidateSet(
    screen: ParsedScreen,
    placeholder: any,
    ranked: MatchCandidate[],
    recommendedPaths: Set<string>,
    screenPlan?: DetailScreenPlan
): DetailAssetCandidateSet {
    const stableShortlist = ranked.slice(0, 3);
    // 候选集由占位、素材版本和基础相关性唯一决定；跨槽位多样性只能调整推荐展示顺序，
    // 不能改变已经签发给 Agent 的 candidateSetId / candidateId。
    const shortlist = [...stableShortlist].sort((left, right) => {
        const leftUsed = recommendedPaths.has(normalizeDetailAssetPath(left.asset.path));
        const rightUsed = recommendedPaths.has(normalizeDetailAssetPath(right.asset.path));
        if (leftUsed !== rightUsed) return leftUsed ? 1 : -1;
        return stableShortlist.indexOf(left) - stableShortlist.indexOf(right);
    });
    const assetIdentity = [...stableShortlist]
        .sort((left, right) => normalizeDetailAssetPath(left.asset.path).localeCompare(
            normalizeDetailAssetPath(right.asset.path)
        ))
        .map((candidate) => [
        normalizeDetailAssetPath(candidate.asset.path),
        Number(candidate.asset.sizeBytes || 0),
        Number(candidate.asset.modifiedTimeMs || 0)
    ].join(':')).join('|');
    const identity = [
        String(screenPlan?.screenRole || ''),
        String(screenPlan?.imageStrategy || ''),
        String(screenPlan?.visualPriority || ''),
        assetIdentity
    ].join('|');
    const candidateSetId = `detail-candidates:${Number(screen.id || 0)}:${Number(placeholder?.layerId || 0)}:${stableDetailCandidateHash(identity)}`;
    const recommendedPath = normalizeDetailAssetPath(shortlist[0]?.asset?.path);
    if (recommendedPath) recommendedPaths.add(recommendedPath);
    return {
        candidateSetId,
        proposals: shortlist.map((candidate) => {
            const assetUsageDecision = resolveDetailAssetUsageDecision(candidate.asset, screenPlan);
            return {
                candidateSetId,
                candidateId: `${candidateSetId}:${stableDetailCandidateHash(normalizeDetailAssetPath(candidate.asset.path))}`,
                imagePath: candidate.asset.path,
                score: candidate.score,
                reasons: [...candidate.reasons],
                // 相关性分数只决定候选展示顺序，不能否决 Agent 对第二、第三候选的设计选择。
                // 执行资格只消费与直接置入安全有关的已观察事实。
                placementSafetyEligible: assetUsageDecision.automaticPlacementEligible,
                needsMatting: assetUsageDecision.sourceTreatment === 'matte_and_recompose',
                assetUsageDecision
            };
        })
    };
}

function findExplicitDetailAssetSelection(
    screenPlan: DetailScreenPlan | undefined,
    placeholder: any,
    candidateSet: DetailAssetCandidateSet
): {
    proposal: DetailAssetCandidateProposal;
    selection: DetailScreenAssetSelection;
    receipt: DetailAssetSelectionReceipt;
} | null {
    const placeholderLayerId = Number(placeholder?.layerId || 0);
    const selection = screenPlan?.agentDecision?.imageSelections?.find((item) => (
        Number(item.placeholderLayerId || 0) === placeholderLayerId
    ));
    if (!selection || selection.candidateSetId !== candidateSet.candidateSetId) return null;
    const proposal = candidateSet.proposals.find((candidate) => (
        candidate.candidateId === selection.candidateId
        && normalizeDetailAssetPath(candidate.imagePath) === normalizeDetailAssetPath(selection.imagePath)
    ));
    if (!proposal) return null;
    return {
        proposal,
        selection,
        receipt: {
            version: 'detail-asset-selection-receipt/v0',
            screenId: Number(screenPlan?.screenId || screenPlan?.agentDecision?.screenId || 0),
            placeholderLayerId,
            candidateSetId: candidateSet.candidateSetId,
            candidateId: proposal.candidateId,
            selectedAssetPath: proposal.imagePath,
            selectedBy: 'agent',
            decisionId: selection.decisionId,
            ...(selection.rationale ? { rationale: selection.rationale } : {})
        }
    };
}

function buildDetailPlacementSourceTreatment(decision: DetailAssetUsageDecision): {
    backgroundTreatment: 'preserve' | 'matte_to_mask' | 'full_frame';
} {
    if (decision.sourceTreatment === 'matte_and_recompose') {
        return { backgroundTreatment: 'matte_to_mask' };
    }
    if (decision.sourceTreatment === 'direct_full_frame') {
        return { backgroundTreatment: 'full_frame' };
    }
    return { backgroundTreatment: 'preserve' };
}

function buildDetailPlacementRelation(
    screen: ParsedScreen,
    placeholder: any
): {
    container: {
        mode: 'clip_to_base' | 'replace_placeholder';
        placeholderLayerId: number;
        baseLayerId?: number;
        parentGroupId: number;
    };
    expectedRelation: {
        clipped?: boolean;
        clippingBaseId?: number;
        parentGroupId: number;
    };
} {
    const placeholderLayerId = Number(placeholder?.layerId || 0);
    const baseLayerId = Number(
        placeholder?.baseLayerId
        || placeholder?.clippingInfo?.baseLayerId
        || 0
    );
    const parentGroupId = Number(screen.id || 0);
    if (baseLayerId > 0) {
        return {
            container: {
                mode: 'clip_to_base',
                placeholderLayerId,
                baseLayerId,
                parentGroupId
            },
            expectedRelation: {
                clipped: true,
                clippingBaseId: baseLayerId,
                parentGroupId
            }
        };
    }
    return {
        container: {
            mode: 'replace_placeholder',
            placeholderLayerId,
            parentGroupId
        },
        expectedRelation: { parentGroupId }
    };
}

function normalizeText(text: unknown): string {
    return String(text || '').replace(/\r\n/g, '\n').trim();
}

function countContentChars(text: unknown): number {
    return normalizeText(text).replace(/[\r\n]/g, '').length;
}

function resolvePositiveInteger(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.round(parsed)));
}

function resolveLowScoreStrategy(value: unknown): DetailPageCopyRuntimePolicy['lowScoreStrategy'] {
    if (value === 'flag' || value === 'keep') return value;
    return 'replace';
}

function resolveLineBreakStyle(value: unknown): DetailPageCopyRuntimePolicy['lineBreakStyle'] {
    return value === 'compact' ? 'compact' : 'balanced';
}

function resolveDetailPageCopyPolicy(params: MatchParams): DetailPageCopyRuntimePolicy {
    const context = params.copyContext || {};
    const facts = normalizeDetailPageCopyFacts([
        ...(Array.isArray(context.facts) ? context.facts : []),
        ...(Array.isArray(params.copyFacts) ? params.copyFacts : [])
    ]);
    const screenDirectives = [
        ...(Array.isArray(context.screenDirectives) ? context.screenDirectives : []),
        ...(Array.isArray(params.screenCopyDirectives) ? params.screenCopyDirectives : [])
    ];
    const minScore = Number.isFinite(Number(params.copyMinScore))
        ? clamp01(Number(params.copyMinScore))
        : 0.72;

    return {
        enabled: params.aiCopyGeneration !== false,
        reviewEnabled: params.copyReview !== false,
        minScore,
        candidateCount: clampDetailPageCopyCandidateCount(params.copyCandidateCount, 3),
        creativeStyle: normalizeText(params.copyCreativeStyle || context.creativeStyle || 'natural'),
        lowScoreStrategy: resolveLowScoreStrategy(params.lowScoreCopyStrategy),
        layoutFit: params.copyLayoutFit !== false,
        lineBreakStyle: resolveLineBreakStyle(params.copyLineBreakStyle),
        titleMaxLines: resolvePositiveInteger(params.copyTitleMaxLines, 2, 1, 4),
        subtitleMaxLines: resolvePositiveInteger(params.copySubtitleMaxLines, 2, 1, 5),
        bodyMaxLines: resolvePositiveInteger(params.copyBodyMaxLines, 3, 1, 8),
        copyOnly: params.copyOnly === true,
        brandTone: normalizeText(params.brandTone || context.brandTone || 'professional'),
        audience: normalizeText(params.targetAudience || context.audience || ''),
        facts,
        screenDirectives
    };
}

type CopyShapeSpec = {
    lineCount: number;
    charCount: number;
    lineLengths: number[];
    hasOriginalText: boolean;
};

function estimateCharsPerLine(copyStrategy: DetailScreenPlan['copyStrategy'] | undefined, role: string | undefined): number {
    const normalizedRole = String(role || '').toLowerCase();
    if (normalizedRole === 'title' || copyStrategy === 'headline') return 10;
    if (copyStrategy === 'parameter') return 9;
    if (copyStrategy === 'supporting_copy') return 12;
    if (copyStrategy === 'emotional') return 11;
    return 10;
}

function estimateLineCount(copyStrategy: DetailScreenPlan['copyStrategy'] | undefined, role: string | undefined): number {
    const normalizedRole = String(role || '').toLowerCase();
    if (normalizedRole === 'title' || copyStrategy === 'headline') return 2;
    if (copyStrategy === 'parameter') return 2;
    return 2;
}

function buildCopyShapeSpec(
    originalText: string,
    placeholder: { role?: string; bounds?: unknown; fontSize?: number },
    screenPlan: DetailScreenPlan | undefined,
    maxLines?: number
): CopyShapeSpec {
    const boundedMaxLines = Math.max(1, Math.round(Number(maxLines) || Number.MAX_SAFE_INTEGER));
    const original = String(originalText || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .map((line) => normalizeText(line))
        .filter(Boolean)
        .join('\n');
    if (original) {
        const originalLines = original.split('\n').slice(0, boundedMaxLines);
        return {
            lineCount: Math.max(1, originalLines.length),
            charCount: countContentChars(originalLines.join('\n')),
            lineLengths: originalLines.map((line) => line.length),
            hasOriginalText: true
        };
    }

    const bounds = placeholder?.bounds as Record<string, unknown> | undefined;
    const width = Math.max(0, Number(bounds?.width || 0));
    const fontSize = Math.max(0, Number(placeholder?.fontSize || 0));
    const fallbackLineCount = estimateLineCount(screenPlan?.copyStrategy, placeholder?.role);
    const estimatedCharsPerLine = estimateCharsPerLine(screenPlan?.copyStrategy, placeholder?.role);
    const capacityFromBounds = width > 0 && fontSize > 0
        ? Math.max(4, Math.floor(width / Math.max(fontSize * 0.95, 1)))
        : estimatedCharsPerLine;
    const targetCharsPerLine = Math.max(4, Math.min(capacityFromBounds, estimatedCharsPerLine + 4));
    const lineCount = Math.max(1, Math.min(fallbackLineCount, boundedMaxLines));

    return {
        lineCount,
        charCount: targetCharsPerLine * lineCount,
        lineLengths: Array.from({ length: lineCount }, () => targetCharsPerLine),
        hasOriginalText: false
    };
}

function applyLineBreakSkeleton(
    shape: CopyShapeSpec,
    candidateText: string,
    style: DetailPageCopyRuntimePolicy['lineBreakStyle'],
    maxLines: number
): string {
    const normalizedCandidate = normalizeText(candidateText).replace(/\n+/g, '');
    const boundedMaxLines = Math.max(1, Math.round(Number(maxLines) || 1));
    let targetLineCount = Math.max(1, Math.min(shape.lineCount, boundedMaxLines));
    if (style === 'compact') {
        const maxLineCapacity = Math.max(1, ...shape.lineLengths);
        targetLineCount = Math.max(
            1,
            Math.min(targetLineCount, Math.ceil(normalizedCandidate.length / maxLineCapacity))
        );
    }
    if (targetLineCount <= 1) return normalizedCandidate;

    const chars = normalizedCandidate.split('');
    const rebuilt: string[] = [];
    let cursor = 0;

    for (let index = 0; index < targetLineCount; index++) {
        const isLastLine = index === targetLineCount - 1;
        if (isLastLine) {
            rebuilt.push(chars.slice(cursor).join(''));
            break;
        }
        const remainingLines = targetLineCount - index;
        const take = Math.max(1, Math.ceil((chars.length - cursor) / remainingLines));
        rebuilt.push(chars.slice(cursor, cursor + take).join(''));
        cursor += take;
    }

    return rebuilt.join('\n');
}

function normalizeGeneratedCopy(
    rawText: string,
    originalText: string,
    placeholder: { role?: string; bounds?: unknown; fontSize?: number },
    screenPlan: DetailScreenPlan | undefined,
    policy: DetailPageCopyRuntimePolicy
): string | null {
    const generated = normalizeText(rawText);
    if (!generated) return null;

    const maxLines = getCopyTargetMaxLines(placeholder, policy);
    const shape = buildCopyShapeSpec(originalText, placeholder, screenPlan, maxLines);
    return applyLineBreakSkeleton(shape, generated, policy.lineBreakStyle, maxLines);
}

function parseGeneratedCopyCandidateList(value: unknown): DetailPageCopyCandidate[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => normalizeDetailPageCopyCandidate(item))
        .filter((item): item is DetailPageCopyCandidate => Boolean(item))
        .slice(0, 5);
}

function parseGeneratedCopySlot(value: unknown): GeneratedCopySlot | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    const layerId = Number(record.layerId);
    if (!Number.isFinite(layerId) || layerId <= 0) return null;
    const candidates = parseGeneratedCopyCandidateList(record.candidates);
    if (candidates.length > 0) {
        return { layerId, candidates };
    }
    const legacyCandidate = normalizeDetailPageCopyCandidate(record);
    if (!legacyCandidate?.content) return null;
    return {
        layerId,
        candidates: [legacyCandidate]
    };
}

function parseGeneratedCopies(raw: unknown): GeneratedCopySlot[] {
    if (!raw) return [];

    if (Array.isArray(raw)) {
        return raw
            .map((item) => parseGeneratedCopySlot(item))
            .filter((item): item is GeneratedCopySlot => Boolean(item));
    }

    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return [];

        const jsonBlock = trimmed.match(/```json\s*([\s\S]*?)\s*```/i);
        if (jsonBlock) {
            try {
                return parseGeneratedCopies(JSON.parse(jsonBlock[1]));
            } catch {
                return [];
            }
        }

        try {
            return parseGeneratedCopies(JSON.parse(trimmed));
        } catch {
            return [];
        }
    }

    if (typeof raw === 'object') {
        const record = raw as Record<string, unknown>;
        if (Array.isArray(record.slots)) {
            return record.slots
                .map((item) => parseGeneratedCopySlot(item))
                .filter((item): item is GeneratedCopySlot => Boolean(item));
        }
        if (Array.isArray(record.copies)) {
            return record.copies
                .map((item) => parseGeneratedCopySlot(item))
                .filter((item): item is GeneratedCopySlot => Boolean(item));
        }

        for (const key of ['data', 'result', 'text', 'content']) {
            if (key in record) {
                const nested = parseGeneratedCopies(record[key]);
                if (nested.length > 0) return nested;
            }
        }
    }

    return [];
}

function buildFocusedContextPromptLines(
    selectedScene: DesignScene | null | undefined,
    selectedElementContext: SelectedElementContext | null | undefined,
    selectedModuleContext: SelectedModuleContext | null | undefined,
    screenId: number,
    isFocusedScreen: boolean
): string[] {
    if (!selectedScene && !selectedElementContext && !selectedModuleContext) return [];

    const sceneScreenId = Number(selectedScene?.selectedScreen?.sourceScreenId || 0) || null;
    const sceneModule = selectedScene?.selectedModule || null;
    const detail = selectedElementContext?.detail;
    const element = selectedElementContext?.selectedElement;
    const lines: string[] = [];

    if ((sceneScreenId !== null && sceneScreenId === screenId) || (detail?.screenId && Number(detail.screenId) === screenId)) {
        lines.push(`Focused screen: yes`);
    } else if (isFocusedScreen) {
        lines.push(`Focused screen: yes`);
    }

    if (sceneScreenId !== null && sceneScreenId !== Number(screenId || 0) && !isFocusedScreen) {
        return lines;
    }

    if (sceneScreenId === null && (!detail || (detail.screenId !== null && Number(detail.screenId) !== screenId && !isFocusedScreen))) {
        return lines;
    }

    if (element) {
        lines.push(`Selected element kind: ${element.kind}`);
        lines.push(`Selected element name: ${element.name}`);
    }
    if (selectedElementContext?.text?.content) {
        lines.push(`Selected text: ${normalizeText(selectedElementContext.text.content)}`);
    }
    if (detail?.screenRole) {
        lines.push(`Selected element screen role: ${detail.screenRole}`);
    }
    if (detail?.visualModuleId) {
        lines.push(`Selected visual module: ${detail.visualModuleId}`);
    }
    if (selectedElementContext?.relations.nearestImageLayers.length) {
        lines.push(`Nearest image layer: ${selectedElementContext.relations.nearestImageLayers[0].name}`);
    }
    if (selectedElementContext?.relations.nearestTextLayers.length) {
        lines.push(`Nearest text layer: ${selectedElementContext.relations.nearestTextLayers[0].name}`);
    }
    if (sceneModule) {
        lines.push(`Focused module id: ${sceneModule.id}`);
        lines.push(`Focused module layer count: ${sceneModule.layerIds.length}`);
    }
    if (selectedModuleContext?.module) {
        lines.push(`Focused module inference: ${selectedModuleContext.diagnostics.inferenceMode}`);
        const memberNames = selectedModuleContext.memberLayers
            .map((item) => normalizeText(item.name))
            .filter(Boolean)
            .slice(0, 4);
        if (memberNames.length > 0) {
            lines.push(`Focused module members: ${memberNames.join(' | ')}`);
        }
    }

    return lines;
}

function getFocusedModuleLayerIds(
    selectedScene: DesignScene | null | undefined,
    selectedElementContext: SelectedElementContext | null | undefined,
    selectedModuleContext: SelectedModuleContext | null | undefined,
    screenId: number
): Set<number> {
    const focusedScreenId = Number(selectedScene?.selectedScreen?.sourceScreenId || 0) || null;
    if (focusedScreenId !== null && focusedScreenId !== Number(screenId || 0)) {
        return new Set<number>();
    }
    const layerIds = selectedScene?.selectedModule?.layerIds?.length
        ? selectedScene.selectedModule.layerIds
        : selectedModuleContext?.module?.layerIds?.length
            ? selectedModuleContext.module.layerIds
            : (selectedElementContext?.detail?.visualModuleLayerIds || []);
    return new Set(
        (Array.isArray(layerIds) ? layerIds : [])
            .map((item) => Number(item))
            .filter((item) => item > 0)
    );
}

function sortPlaceholdersByFocusedModule<T extends { layerId?: number }>(items: T[], focusedModuleLayerIds: Set<number>): T[] {
    if (!focusedModuleLayerIds.size) return items;
    return [...items].sort((a, b) => {
        const aFocused = focusedModuleLayerIds.has(Number(a.layerId || 0)) ? 1 : 0;
        const bFocused = focusedModuleLayerIds.has(Number(b.layerId || 0)) ? 1 : 0;
        return bFocused - aFocused;
    });
}

function findScreenCopyDirective(
    policy: DetailPageCopyRuntimePolicy,
    screen: ParsedScreen
): DetailPageCopyScreenDirective | null {
    const screenName = normalizeText(screen.name).toLowerCase();
    return policy.screenDirectives.find((directive) => {
        const directiveId = Number(directive.screenId || 0);
        if (directiveId > 0 && directiveId === Number(screen.id || 0)) return true;
        const directiveName = normalizeText(directive.screenName).toLowerCase();
        return Boolean(directiveName && directiveName === screenName);
    }) || null;
}

function getCopyTargetMaxLines(
    copy: { role?: string },
    policy: DetailPageCopyRuntimePolicy
): number {
    const role = normalizeText(copy.role).toLowerCase();
    if (role === 'title' || role === 'headline') return policy.titleMaxLines;
    if (role === 'subtitle' || role === 'subheading') return policy.subtitleMaxLines;
    return policy.bodyMaxLines;
}

function copyTargetRequiresFactSupport(
    _copy: CopyTargetInput,
    screenPlan?: DetailScreenPlan
): boolean {
    // 屏幕角色只描述传播任务，不能把所有非 emotional 文案都定性为商品事实。
    // 真正的候选仍会按最终 content 重新扫描高风险声明；这里只在策划本身已经
    // 指定材质、参数、功能等可验证主张时，提前要求事实目录。
    return containsDetailPageHighRiskClaim([
        screenPlan?.mainMessage,
        ...(screenPlan?.supportingPoints || [])
    ].filter(Boolean).join(' '));
}

function buildCopyFactPromptLines(policy: DetailPageCopyRuntimePolicy): string[] {
    if (policy.facts.length === 0) {
        return [
            'Confirmed product facts: none supplied.',
            'Fact boundary: do not invent materials, parameters, functions, efficacy, certifications or comparison claims; use supportRefs: [].'
        ];
    }
    return [
        'Product fact catalog (only evaluationEligible=true facts may support a definite product claim):',
        ...policy.facts.map((fact) => JSON.stringify({
            ref: fact.ref,
            statement: fact.statement,
            confirmation: fact.confirmation,
            evaluationEligible: fact.evaluationEligible
        }))
    ];
}

function buildBatchScreenCopyPrompt(
    requests: ScreenCopyRequest[],
    mode: 'initial' | 'repair',
    policy: DetailPageCopyRuntimePolicy
): string {
    const header = mode === 'repair'
        ? 'Repair only the rejected detail-page copy slots. Preserve the screen strategy and return fresh candidates.'
        : 'Create fact-grounded detail-page copy candidates for multiple screens.';

    const rules = [
        'Rules:',
        `1. Return exactly ${policy.candidateCount} candidates for every layerId (allowed range 2-5).`,
        '2. Every candidate must include content, supportRefs, score (0-1) and a concise reason.',
        '3. Every factual clause must be a faithful rewrite of one or more evaluationEligible=true facts and cite those refs. Non-factual emotional or navigational wording must use supportRefs: [] and must not contain material, parameter, efficacy, certification or comparison claims.',
        '4. The template text is not supplied as content and must never be reconstructed as a fallback.',
        policy.layoutFit
            ? '5. Respect target charCount, allowedCharDifference and maxLines without sacrificing the screen objective.'
            : '5. Layout fitting is disabled: prioritize the screen objective and natural phrasing instead of imitating the template length.',
        '6. Score candidates by fact grounding, screen-role fit, distinctiveness, natural language, brand tone and slot capacity.',
        '7. Do not use exaggerated efficacy, unsupported comparisons, fake parameters or generic advertising slogans.',
        '8. Return one JSON object only: {"slots":[{"layerId":123,"candidates":[{"content":"...","supportRefs":[],"score":0.82,"reason":"..."}]}]}.',
        '9. Do not return markdown.'
    ];

    const requestBlocks = requests.map(({ screen, screenPlan, copyTargets, selectedScene, selectedElementContext, selectedModuleContext, isFocusedScreen }) => {
        const directive = findScreenCopyDirective(policy, screen);
        const visual = screenPlan.visualSummary;
        const visualLines = visual
            ? [
                `Visual boundary risk: ${visual.boundaryRisk}`,
                `Visual module count: ${visual.visualModuleCount}`,
                `Visual dominant type: ${visual.dominantModuleType}`,
                `Visual role hint: ${visual.roleHint || 'none'}`
            ]
            : [];
        const focusLines = buildFocusedContextPromptLines(
            selectedScene,
            selectedElementContext,
            selectedModuleContext,
            Number(screen.id || 0),
            Boolean(isFocusedScreen)
        );
        const focusedModuleLayerIds = getFocusedModuleLayerIds(selectedScene, selectedElementContext, selectedModuleContext, Number(screen.id || 0));
        const orderedCopyTargets = sortPlaceholdersByFocusedModule(copyTargets, focusedModuleLayerIds);
        const targets = orderedCopyTargets.map((copy) => {
            const shape = buildCopyShapeSpec(
                copy.originalText || '',
                copy,
                screenPlan,
                getCopyTargetMaxLines(copy, policy)
            );
            return JSON.stringify({
                layerId: copy.layerId,
                layerName: copy.layerName,
                role: copy.role || 'copy',
                lineCount: shape.lineCount,
                charCount: shape.charCount,
                allowedCharDifference: calculateDetailPageCopyCapacityTolerance(shape.charCount),
                maxLines: getCopyTargetMaxLines(copy, policy),
                warnings: copy.warnings || []
            });
        });

        return [
            `Screen name: ${screen.name}`,
            `Screen type: ${screen.type}`,
            `Screen role: ${screenPlan.screenRole}`,
            `Copy strategy: ${screenPlan.copyStrategy}`,
            `Main message: ${screenPlan.mainMessage}`,
            `Supporting points: ${screenPlan.supportingPoints.join(' / ')}`,
            `Screen objective: ${normalizeText(directive?.objective || screenPlan.mainMessage)}`,
            `Visual intent: ${normalizeText(directive?.visualIntent || 'follow the current screen composition and visual hierarchy')}`,
            ...buildScreenPlanDecisionLines(screenPlan),
            ...visualLines,
            ...focusLines,
            'Copy placeholders:',
            ...targets
        ].join('\n');
    });

    return [
        header,
        `Audience: ${policy.audience || 'not specified; keep wording broadly understandable'}`,
        `Brand tone: ${policy.brandTone}`,
        `Creative style: ${policy.creativeStyle}`,
        `Line-break style: ${policy.lineBreakStyle}`,
        `Layout fitting enabled: ${policy.layoutFit ? 'yes' : 'no'}`,
        ...buildCopyFactPromptLines(policy),
        ...rules,
        '',
        ...requestBlocks.map((block, index) => `=== Screen ${index + 1} ===\n${block}`)
    ].join('\n');
}

async function requestGeneratedCopies(
    screen: ParsedScreen,
    screenPlan: DetailScreenPlan,
    copyTargets: CopyTargetInput[],
    mode: 'initial' | 'repair',
    policy: DetailPageCopyRuntimePolicy
): Promise<GeneratedCopyBatchResult> {
    return requestBatchGeneratedCopies([{ screen, screenPlan, copyTargets }], mode, policy);
}

function selectGeneratedCopyForTarget(
    slot: GeneratedCopySlot,
    target: CopyTargetInput,
    screenPlan: DetailScreenPlan,
    policy: DetailPageCopyRuntimePolicy
): GeneratedCopySelection | null {
    const shape = buildCopyShapeSpec(
        target.originalText || '',
        target,
        screenPlan,
        getCopyTargetMaxLines(target, policy)
    );
    const normalizedCandidates = slot.candidates
        .map((candidate): DetailPageCopyCandidate | null => {
            const content = normalizeGeneratedCopy(
                candidate.content,
                target.originalText || '',
                target,
                screenPlan,
                policy
            );
            if (!content) return null;
            return {
                ...candidate,
                content,
                requiresFactSupport: copyTargetRequiresFactSupport(target, screenPlan)
            };
        })
        .filter((candidate): candidate is DetailPageCopyCandidate => Boolean(candidate));
    const requireFactSupport = copyTargetRequiresFactSupport(target, screenPlan);
    const enforceMinimumScore = policy.reviewEnabled && policy.lowScoreStrategy === 'replace';
    const selection = selectDetailPageCopyCandidate({
        candidates: normalizedCandidates,
        facts: policy.facts,
        minScore: enforceMinimumScore ? policy.minScore : 0,
        targetCharCount: policy.layoutFit ? shape.charCount : 0,
        allowedCharDifference: policy.layoutFit
            ? calculateDetailPageCopyCapacityTolerance(shape.charCount)
            : 0,
        requireFactSupport,
        // candidateCount 是给 Provider 的探索目标，不是批次必须完整返回的成功条件。
        // Harness 仍要求至少两个可解析候选，避免单一候选未经比较就直接写入。
        minimumCandidateCount: 2
    });
    if (!selection.selected) return null;
    return {
        ...selection.selected,
        belowMinScore: selection.selected.score < policy.minScore
    };
}

async function requestBatchGeneratedCopies(
    requests: ScreenCopyRequest[],
    mode: 'initial' | 'repair',
    policy: DetailPageCopyRuntimePolicy
): Promise<GeneratedCopyBatchResult> {
    const replacements = new Map<number, GeneratedCopySelection>();
    const failureReasonByLayerId = new Map<number, CopyGenerationFailureReason>();
    const validRequests = requests
        .filter((request) => request.copyTargets.length > 0)
        .sort((a, b) => Number(Boolean(b.isFocusedScreen)) - Number(Boolean(a.isFocusedScreen)));
    if (!policy.enabled || validRequests.length === 0 || typeof window === 'undefined') {
        return { replacements, failureReasonByLayerId };
    }

    const invokeTask = (window as any).designEcho?.invoke;
    if (typeof invokeTask !== 'function') {
        for (const request of validRequests) {
            for (const target of request.copyTargets) {
                failureReasonByLayerId.set(Number(target.layerId || 0), 'copy-provider-unavailable');
            }
        }
        return { replacements, failureReasonByLayerId };
    }

    for (const requestChunk of chunkItems(validRequests, COPY_REQUEST_BATCH_SIZE)) {
        const targetByLayerId = new Map<number, { target: CopyTargetInput; screenPlan: DetailScreenPlan }>();
        for (const request of requestChunk) {
            for (const target of request.copyTargets) {
                targetByLayerId.set(Number(target.layerId), { target, screenPlan: request.screenPlan });
            }
        }
        try {
            const prompt = buildBatchScreenCopyPrompt(requestChunk, mode, policy);
            const raw = await invokeTask('task:execute', 'text-optimize', {
                systemPromptOverride: DETAIL_PAGE_COPY_SYSTEM_PROMPT,
                text: prompt,
                context: {
                    source: mode === 'repair' ? 'detail-page-copy-repair-batch' : 'detail-page-copy-plan-batch',
                    screenCount: requestChunk.length,
                    placeholderCount: requestChunk.reduce((sum, request) => sum + request.copyTargets.length, 0),
                    screenRoles: requestChunk.map((request) => request.screenPlan.screenRole),
                    copyCandidateCount: policy.candidateCount,
                    copyMinScore: policy.minScore
                }
            });

            if (raw?.success === false) {
                for (const layerId of targetByLayerId.keys()) {
                    failureReasonByLayerId.set(layerId, 'copy-provider-request-failed');
                }
                continue;
            }
            const generatedItems = parseGeneratedCopies(raw);
            if (generatedItems.length === 0) {
                for (const layerId of targetByLayerId.keys()) {
                    failureReasonByLayerId.set(layerId, 'copy-provider-response-invalid');
                }
                continue;
            }

            const generatedByLayerId = new Map(generatedItems.map((item) => [Number(item.layerId || 0), item]));
            for (const [layerId, meta] of targetByLayerId.entries()) {
                const item = generatedByLayerId.get(layerId);
                if (!item) {
                    failureReasonByLayerId.set(layerId, 'copy-provider-response-invalid');
                    continue;
                }
                const selected = selectGeneratedCopyForTarget(
                    item,
                    meta.target,
                    meta.screenPlan,
                    policy
                );
                if (selected) {
                    replacements.set(layerId, selected);
                    failureReasonByLayerId.delete(layerId);
                } else {
                    failureReasonByLayerId.set(layerId, 'copy-candidate-rejected-or-missing');
                }
            }
        } catch (error) {
            for (const layerId of targetByLayerId.keys()) {
                failureReasonByLayerId.set(layerId, 'copy-provider-request-failed');
            }
            console.warn(`[DetailPageAssetRanker] ${mode} batch copy generation failed`, error);
        }
    }

    return { replacements, failureReasonByLayerId };
}

async function generateScreenCopies(
    screen: ParsedScreen,
    screenPlan: DetailScreenPlan | undefined,
    policy: DetailPageCopyRuntimePolicy,
    preGeneratedCopies?: GeneratedCopyBatchResult
): Promise<GeneratedCopyBatchResult> {
    const copyPlaceholders = screen.copyPlaceholders || [];
    if (!policy.enabled || !screenPlan || copyPlaceholders.length === 0) {
        return {
            replacements: new Map<number, GeneratedCopySelection>(),
            failureReasonByLayerId: new Map<number, CopyGenerationFailureReason>()
        };
    }

    if (preGeneratedCopies) {
        const replacements = new Map<number, GeneratedCopySelection>();
        const failureReasonByLayerId = new Map<number, CopyGenerationFailureReason>();
        for (const placeholder of copyPlaceholders) {
            const layerId = Number(placeholder.layerId || 0);
            const generated = preGeneratedCopies.replacements.get(layerId);
            if (generated) {
                replacements.set(layerId, generated);
            }
            const failureReason = preGeneratedCopies.failureReasonByLayerId.get(layerId);
            if (failureReason) {
                failureReasonByLayerId.set(layerId, failureReason);
            }
        }
        return { replacements, failureReasonByLayerId };
    }

    return requestGeneratedCopies(screen, screenPlan, copyPlaceholders, 'initial', policy);
}

function buildCopyAuditScore(copyAudit?: FillPlan['copyAudit']): number {
    if (!copyAudit) return 0;
    return ((copyAudit.riskyPlaceholderCount || 0) * 100) + (copyAudit.watchPlaceholderCount || 0);
}

function buildRepairTargets(screen: ParsedScreen, plan: FillPlan): CopyTargetInput[] {
    const placeholderByLayerId = new Map<number, any>((screen.copyPlaceholders || []).map((copy) => [Number(copy.layerId), copy]));
    const auditByLayerId = new Map<number, NonNullable<NonNullable<FillPlan['copyAudit']>['placeholderAudits']>[number]>(
        (plan.copyAudit?.placeholderAudits || []).map((item) => [Number(item.placeholderLayerId), item])
    );

    return (plan.copies || [])
        .map((copy) => {
            const layerId = Number(copy.layerId || 0);
            const placeholder = placeholderByLayerId.get(layerId);
            const audit = auditByLayerId.get(layerId);
            const content = normalizeText(copy.content);
            const needsRepair = !content
                || copy.generationStatus === 'failed'
                || Boolean(audit && audit.status === 'risky');
            if (!placeholder || !needsRepair) return null;
            return {
                layerId,
                layerName: copy.layerName || placeholder.layerName,
                originalText: String(copy.originalText || placeholder.currentText || ''),
                currentText: content,
                role: placeholder.role,
                bounds: placeholder.bounds,
                fontSize: placeholder.fontSize,
                warnings: audit?.warnings || []
            };
        })
        .filter(Boolean) as CopyTargetInput[];
}

function applyBatchCopyRepairs(
    plans: FillPlan[],
    screens: ParsedScreen[],
    screenPlanById: Map<number, DetailScreenPlan>,
    repairReplacements: Map<number, GeneratedCopySelection>
): FillPlan[] {
    if (repairReplacements.size === 0) {
        return plans;
    }

    const screenById = new Map<number, ParsedScreen>((screens || []).map((screen) => [Number(screen.id || 0), screen]));

    return plans.map((plan) => {
        const screen = screenById.get(Number(plan.screenId || 0));
        const screenPlan = screenPlanById.get(Number(plan.screenId || 0));
        if (!screen || !screenPlan) {
            return plan;
        }

        const repairTargets = buildRepairTargets(screen, plan);
        if (repairTargets.length === 0) {
            return plan;
        }

        let changed = false;
        const repairedCopies = (plan.copies || []).map((copy) => {
            const replacement = repairReplacements.get(Number(copy.layerId || 0));
            if (!replacement) return copy;
            changed = true;
            return {
                ...copy,
                content: replacement.content,
                source: 'ai_generated' as const,
                generationStatus: 'generated' as const,
                generationReason: 'screen-plan-copy-repair',
                supportRefs: replacement.supportRefs,
                candidateScore: replacement.score,
                candidateReason: replacement.reason,
                candidateBelowThreshold: replacement.belowMinScore,
                requiresFactSupport: replacement.requiresFactSupport
            };
        });

        if (!changed) {
            return plan;
        }

        const repairedPlan: FillPlan = {
            ...plan,
            copies: repairedCopies
        };
        const repairedScreens = applyDetailFillPlanCopiesToScreens([screen], [repairedPlan]);
        const repairedAuditResult = auditDetailCopyLayoutForScreens({
            screens: repairedScreens,
            screenPlans: [screenPlan]
        });
        const repairedScreenAudits = repairedAuditResult.audits.filter((item) => Number(item.screenId || 0) === Number(screen.id || 0));
        const repairedRiskyCount = repairedScreenAudits.filter((item) => item.status === 'risky').length;
        const repairedWatchCount = repairedScreenAudits.filter((item) => item.status === 'watch').length;
        const repairedCopyAudit: NonNullable<FillPlan['copyAudit']> = {
            status: repairedRiskyCount > 0 ? 'risky' : repairedWatchCount > 0 ? 'watch' : 'ok',
            warningCount: repairedScreenAudits.reduce((sum, item) => sum + (item.warnings?.length || 0), 0),
            riskyPlaceholderCount: repairedRiskyCount,
            watchPlaceholderCount: repairedWatchCount,
            warnings: repairedScreenAudits.flatMap((item) => item.warnings || []),
            placeholderAudits: repairedScreenAudits.map((item) => ({
                placeholderLayerId: Number(item.placeholderLayerId || 0),
                status: item.status,
                warnings: item.warnings || []
            }))
        };

        if (buildCopyAuditScore(repairedCopyAudit) > buildCopyAuditScore(plan.copyAudit)) {
            return plan;
        }

        return {
            ...repairedPlan,
            needsReview: Boolean(plan.needsReview) || repairedCopyAudit.status === 'risky',
            copyAudit: repairedCopyAudit
        };
    });
}

function resolveInitialFillMode(assetType: AssetType, screenType: string, placeholder: any, screenPlan?: DetailScreenPlan): FillMode {
    const zone = String(placeholder?.zone || '').toLowerCase();
    const lower = String(screenType || '').toLowerCase();
    const iconLike = zone === 'icon' || /icon|图标|徽章|badge/.test(String(placeholder?.layerName || '').toLowerCase());
    if (iconLike || assetType === 'icon') return 'contain';

    if (screenPlan && !screenPlan.requiresModelDecision) {
        switch (screenPlan.imageStrategy) {
            case 'hero':
                return assetType === 'scene' ? 'cover' : 'contain';
            case 'context':
                return assetType === 'scene' || assetType === 'model' ? 'cover' : 'smart';
            case 'detail':
            case 'material':
                return 'smart';
            case 'comparison':
                return 'contain';
            default:
                break;
        }
    }

    if (assetType === 'scene') {
        return /hero|kv|banner|首屏|核心/.test(lower) ? 'cover' : 'smart';
    }
    if (assetType === 'detail') return 'smart';
    return 'contain';
}

function summarizeCandidate(candidate?: MatchCandidate): string | undefined {
    if (!candidate) return undefined;
    return candidate.reasons.length > 0 ? candidate.reasons.join(' / ') : undefined;
}

function buildScreenPlanDecisionLines(screenPlan: DetailScreenPlan): string[] {
    const lines = [
        `Decision source: ${screenPlan.decisionSource}`,
        `Model decision required: ${screenPlan.requiresModelDecision ? 'yes' : 'no'}`
    ];
    if (screenPlan.agentDecision?.rationale?.length) {
        lines.push(`Agent rationale: ${screenPlan.agentDecision.rationale.join(' / ')}`);
    }
    const structuralReasons = screenPlan.structuralSignals?.reasons || [];
    if (structuralReasons.length > 0) {
        lines.push(`Structural candidates: ${structuralReasons.join(' / ')}`);
    }
    if (screenPlan.requiresModelDecision) {
        lines.push('Decision boundary: template and filename rules are candidate signals only; decide the actual content from confirmed product facts, asset observations and user intent.');
    }
    return lines;
}

function buildSmartScalingCanvas(screen: ParsedScreen, targetBox: { x: number; y: number; width: number; height: number }) {
    const screenBounds = screen.bounds || {};
    return {
        width: Math.max(1, Number(screenBounds.width || 0), targetBox.x + targetBox.width),
        height: Math.max(1, Number(screenBounds.height || 0), targetBox.y + targetBox.height)
    };
}

function buildPlacementMetadata(
    screen: ParsedScreen,
    placeholder: ParsedScreen['imagePlaceholders'][number],
    assetType: AssetType,
    fillMode: FillMode,
    screenPlan?: DetailScreenPlan,
    asset?: DetailProjectAsset
): PlacementMetadata {
    const placementPlan = placeholder.placementPlan;
    if (!placementPlan) {
        return {};
    }

    const width = Number(asset?.width || 0);
    const height = Number(asset?.height || 0);
    if (!asset?.path || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return { placementPlan };
    }

    const placementTransform = computePlacementTransform(placementPlan, { width, height });
    const targetBox = placementPlan.safeBox || placementPlan.targetBox;
    const smartScalingDecision = computeSmartScalingDecision({
        canvas: buildSmartScalingCanvas(screen, targetBox),
        source: { width, height },
        targetBox,
        designType: 'detail-page',
        assetRole: assetType,
        intent: fillMode === 'cover' ? 'full-bleed' : 'fit-slot',
        presetOverride: {
            scaleMode: fillMode === 'cover' ? 'cover' : 'contain',
            targetFill: 1,
            minFill: 1,
            maxFill: 1,
            anchor: 'center',
            cropPolicy: fillMode === 'cover' ? 'allow-crop' : 'protect-subject',
            visualBiasY: 0,
            minScale: 0.01,
            maxScale: 100
        }
    });

    return {
        placementPlan: {
            ...placementPlan,
            transform: placementTransform
        },
        placementTransform,
        smartScalingDecision
    };
}

async function generateScreenPlan(
    screen: ParsedScreen,
    projectAssets: { images: DetailProjectAsset[] },
    usedPaths: Set<string>,
    screenPlan?: DetailScreenPlan,
    policy?: DetailPageCopyRuntimePolicy,
    preGeneratedCopies?: GeneratedCopyBatchResult,
    selectedScene?: DesignScene | null,
    selectedElementContext?: SelectedElementContext | null,
    selectedModuleContext?: SelectedModuleContext | null
) {
    const copies: any[] = [];
    const images: any[] = [];
    const screenType = screen.type || 'CUSTOM';
    const focusedModuleLayerIds = getFocusedModuleLayerIds(selectedScene, selectedElementContext, selectedModuleContext, Number(screen.id || 0));
    const resolvedPolicy = policy || resolveDetailPageCopyPolicy({
        screens: [screen],
        projectAssets
    });
    const generatedCopyBatch = await generateScreenCopies(screen, screenPlan, resolvedPolicy, preGeneratedCopies);
    const generatedCopies = generatedCopyBatch.replacements;

    for (const copy of sortPlaceholdersByFocusedModule(screen.copyPlaceholders || [], focusedModuleLayerIds)) {
        const generatedSelection = generatedCopies.get(copy.layerId);
        const generatedContent = generatedSelection?.content || '';
        const originalText = String(copy.currentText || '');
        let generationReason = 'screen-plan-copy-candidate-selected';
        if (generatedSelection?.belowMinScore) {
            generationReason = resolvedPolicy.lowScoreStrategy === 'keep'
                ? 'screen-plan-copy-candidate-kept-below-threshold'
                : 'screen-plan-copy-candidate-flagged-below-threshold';
        }
        if (!generatedContent) {
            const requiresFactSupport = copyTargetRequiresFactSupport(copy, screenPlan);
            const hasEligibleFact = resolvedPolicy.facts.some((fact) => fact.evaluationEligible);
            const failureReason = generatedCopyBatch.failureReasonByLayerId.get(Number(copy.layerId || 0));
            if (!resolvedPolicy.enabled) {
                generationReason = 'copy-generation-disabled';
            } else if (requiresFactSupport && !hasEligibleFact) {
                generationReason = 'confirmed-product-fact-required';
            } else if (failureReason) {
                generationReason = failureReason;
            } else {
                generationReason = 'copy-candidate-rejected-or-missing';
            }
        }
        copies.push({
            layerId: copy.layerId,
            layerName: copy.layerName,
            content: generatedContent || originalText || '',
            source: generatedContent ? 'ai_generated' : 'template',
            originalText,
            copyStrategy: screenPlan?.copyStrategy,
            mainMessage: screenPlan?.mainMessage,
            supportingPoints: screenPlan?.supportingPoints,
            generationStatus: generatedContent ? 'generated' : 'failed',
            generationReason,
            requiresFactSupport: generatedSelection?.requiresFactSupport
                ?? copyTargetRequiresFactSupport(copy, screenPlan),
            supportRefs: generatedSelection?.supportRefs || [],
            candidateScore: generatedSelection?.score,
            candidateReason: generatedSelection?.reason,
            candidateBelowThreshold: generatedSelection?.belowMinScore === true
        });
    }

    const availableAssets = projectAssets.images || [];
    const imageScores: number[] = [];

    const imagePlaceholders = resolvedPolicy.copyOnly
        ? []
        : sortPlaceholdersByFocusedModule(screen.imagePlaceholders || [], focusedModuleLayerIds);
    for (const placeholder of imagePlaceholders) {
        // candidateSet 必须与之前签发给 Agent 的集合稳定一致，因此基础排名不消费本轮选择状态。
        // usedPaths 在这里仅记录各槽位的推荐展示，保留多样性体验而不参与候选身份。
        const ranked = rankAssetsForPlaceholder(screen, placeholder, availableAssets, new Set<string>(), screenPlan);
        const candidateSet = buildDetailAssetCandidateSet(screen, placeholder, ranked, usedPaths, screenPlan);
        const explicitSelection = findExplicitDetailAssetSelection(screenPlan, placeholder, candidateSet);
        const recommendedCandidate = candidateSet.proposals[0];
        const selectedAsset = explicitSelection
            ? availableAssets.find((asset) => (
                normalizeDetailAssetPath(asset.path)
                === normalizeDetailAssetPath(explicitSelection.proposal.imagePath)
            ))
            : undefined;
        const planningAsset = selectedAsset
            || (recommendedCandidate
                ? availableAssets.find((asset) => (
                    normalizeDetailAssetPath(asset.path)
                    === normalizeDetailAssetPath(recommendedCandidate.imagePath)
                ))
                : undefined);

        if (planningAsset?.path) {
            const assetType = normalizeAssetType(planningAsset.type);
            const assetUsageDecision = explicitSelection?.proposal.assetUsageDecision
                || recommendedCandidate?.assetUsageDecision
                || resolveDetailAssetUsageDecision(planningAsset, screenPlan);
            const fillMode = resolveInitialFillMode(assetType, screenType, placeholder, screenPlan);
            const placementMetadata = buildPlacementMetadata(screen, placeholder, assetType, fillMode, screenPlan, planningAsset);
            const placementRelation = buildDetailPlacementRelation(screen, placeholder);
            const selectedForDirectPlacement = Boolean(
                explicitSelection?.proposal.placementSafetyEligible
            );
            const selectedForMatting = Boolean(
                explicitSelection?.proposal.needsMatting
            );
            imageScores.push(explicitSelection?.proposal.score ?? recommendedCandidate?.score ?? 0);
            images.push({
                layerId: placeholder.layerId,
                layerName: placeholder.layerName,
                imagePath: selectedForDirectPlacement
                    ? explicitSelection!.proposal.imagePath
                    : '',
                fillMode,
                assetType,
                needsMatting: selectedForMatting,
                subjectAlign: 'center',
                selectionReason: explicitSelection
                    ? `主 Agent 已选择候选 ${explicitSelection.proposal.candidateId}；${explicitSelection.selection.rationale || assetUsageDecision.reason}`
                    : `Harness 仅整理了 ${candidateSet.proposals.length} 个候选；排序第一名不是生产选定。`,
                assetUsageDecision,
                assetCandidates: candidateSet.proposals,
                requiresModelAssetDecision: !explicitSelection,
                ...(explicitSelection ? { selectionReceipt: explicitSelection.receipt } : {}),
                executionDeferred: !selectedForDirectPlacement,
                sourceTreatment: buildDetailPlacementSourceTreatment(assetUsageDecision),
                ...placementRelation,
                ...placementMetadata
            });
        } else {
            const fillMode = resolveInitialFillMode('product', screenType, placeholder, screenPlan);
            const placementMetadata = buildPlacementMetadata(screen, placeholder, 'product', fillMode, screenPlan);
            images.push({
                layerId: placeholder.layerId,
                layerName: placeholder.layerName,
                imagePath: '',
                fillMode,
                assetType: 'product',
                ...placementMetadata
            });
        }
    }

    const imageCoverage = images.length > 0
        ? images.filter((item) => (
            !!item.imagePath
            && item.assetUsageDecision?.automaticPlacementEligible !== false
        )).length / images.length
        : 1;
    const averageImageScore = imageScores.length > 0
        ? imageScores.reduce((sum, score) => sum + score, 0) / imageScores.length
        : imageCoverage;
    const baseConfidence = clamp01((imageCoverage * 0.55) + (averageImageScore * 0.45));
    const planPenalty = screenPlan?.requiresModelDecision ? 0.12 : 0;
    const confidence = clamp01(baseConfidence - planPenalty);
    const requiresModelDecision = Boolean(screenPlan?.requiresModelDecision)
        || images.some((image) => image.requiresModelAssetDecision === true);
    const hasFailedCopy = copies.some((copy) => copy.generationStatus === 'failed');
    const hasFlaggedLowScoreCopy = resolvedPolicy.reviewEnabled
        && resolvedPolicy.lowScoreStrategy === 'flag'
        && copies.some((copy) => copy.candidateBelowThreshold === true);
    const hasDeferredAssetUsage = images.some((image) => image.executionDeferred === true);

    const draftPlan = {
        screenId: screen.id,
        screenName: screen.name,
        screenType,
        screenRole: screenPlan?.screenRole,
        imageStrategy: screenPlan?.imageStrategy,
        copyStrategy: screenPlan?.copyStrategy,
        mainMessage: screenPlan?.mainMessage,
        supportingPoints: screenPlan?.supportingPoints,
        supportRefs: screenPlan?.supportRefs || [],
        copies,
        images,
        confidence,
        needsReview: confidence < 0.68
            || requiresModelDecision
            || hasFailedCopy
            || hasFlaggedLowScoreCopy
            || hasDeferredAssetUsage,
        decisionBoundary: {
            screenDecisionSource: screenPlan?.decisionSource || 'missing',
            requiresModelDecision,
            assetSelectionSource: images.some((image) => image.requiresModelAssetDecision === true)
                ? 'candidate_only'
                : 'agent_explicit_selection',
            note: images.some((image) => image.requiresModelAssetDecision === true)
                ? '素材排序只提供有限候选；主 Agent 尚未在当前候选集上逐占位选定，图片不会进入 filler。'
                : '每个可执行图片路径都绑定了主 Agent 在当前候选集上的选择收据。'
        },
        ranking: {
            matchedImages: imageScores.length,
            averageImageScore
        }
    };

    const auditedScreens = applyDetailFillPlanCopiesToScreens([screen], [draftPlan]);
    const copyAuditResult = auditDetailCopyLayoutForScreens({
        screens: auditedScreens,
        screenPlans: screenPlan ? [screenPlan] : []
    });
    const screenCopyAudits = copyAuditResult.audits.filter((item) => item.screenId === screen.id);
    const riskyPlaceholderCount = screenCopyAudits.filter((item) => item.status === 'risky').length;
    const watchPlaceholderCount = screenCopyAudits.filter((item) => item.status === 'watch').length;
    const copyAuditStatus: 'ok' | 'watch' | 'risky' =
        riskyPlaceholderCount > 0
            ? 'risky'
            : watchPlaceholderCount > 0
                ? 'watch'
                : 'ok';
    const copyAuditWarnings = screenCopyAudits.flatMap((item) => item.warnings);

    return {
        ...draftPlan,
        needsReview: draftPlan.needsReview || copyAuditStatus === 'risky',
        copyAudit: {
            status: copyAuditStatus,
            warningCount: copyAuditWarnings.length,
            riskyPlaceholderCount,
            watchPlaceholderCount,
            warnings: copyAuditWarnings,
            placeholderAudits: screenCopyAudits.map((item) => ({
                placeholderLayerId: Number(item.placeholderLayerId || 0),
                status: item.status,
                warnings: item.warnings || []
            }))
        }
    };
}

export async function matchDetailPageContentPlans(params: MatchParams): Promise<{ success: true; plans: any[] }> {
    const plans: any[] = [];
    const usedPaths = new Set<string>();
    const copyPolicy = resolveDetailPageCopyPolicy(params);
    const screenPlanById = new Map<number, DetailScreenPlan>((params.screenPlans || []).map((plan) => [plan.screenId, plan]));
    const selectedElementContext =
        params.selectedDesignContext?.selectedElementContext ?? params.selectedElementContext ?? null;
    const selectedModuleContext =
        params.selectedDesignContext?.selectedModuleContext ?? params.selectedModuleContext ?? null;
    const selectedScene = params.selectedScene ?? params.selectedDesignContext?.scene ?? null;
    const focusedScreenId = Number(selectedScene?.selectedScreen?.sourceScreenId || 0) || null;
    const orderedScreens = sortScreensByFocus(params.screens || [], focusedScreenId);
    const initialCopyRequests: ScreenCopyRequest[] = orderedScreens
        .map((screen) => {
            const screenPlan = screenPlanById.get(screen.id);
            const copyTargets = (screen.copyPlaceholders || []).map((copy) => ({
                layerId: copy.layerId,
                layerName: copy.layerName,
                originalText: String(copy.currentText || ''),
                currentText: String(copy.currentText || ''),
                role: copy.role,
                bounds: copy.bounds,
                fontSize: copy.fontSize
            }));
            if (!screenPlan || copyTargets.length === 0) {
                return null;
            }
                return {
                    screen,
                    screenPlan,
                    copyTargets: sortPlaceholdersByFocusedModule(copyTargets, getFocusedModuleLayerIds(selectedScene, selectedElementContext, selectedModuleContext, Number(screen.id || 0))),
                    selectedScene,
                    selectedElementContext,
                    selectedModuleContext,
                    isFocusedScreen: focusedScreenId !== null && Number(screen.id || 0) === focusedScreenId
                };
        })
        .filter(Boolean) as ScreenCopyRequest[];
    const initialCopyGeneration = await requestBatchGeneratedCopies(initialCopyRequests, 'initial', copyPolicy);

    for (const screen of orderedScreens) {
        plans.push(await generateScreenPlan(
            screen,
            params.projectAssets,
            usedPaths,
            screenPlanById.get(screen.id),
            copyPolicy,
            initialCopyGeneration,
            selectedScene,
            selectedElementContext,
            selectedModuleContext
        ));
    }

    let repairRequests: ScreenCopyRequest[] = [];
    if (copyPolicy.enabled && copyPolicy.reviewEnabled && copyPolicy.lowScoreStrategy === 'replace') {
        repairRequests = plans.map((plan) => {
            const screen = orderedScreens.find((item) => Number(item.id || 0) === Number(plan.screenId || 0));
            const screenPlan = screenPlanById.get(Number(plan.screenId || 0));
            if (!screen || !screenPlan) {
                return null;
            }
            const copyTargets = buildRepairTargets(screen, plan);
            if (copyTargets.length === 0) {
                return null;
            }
                return {
                    screen,
                    screenPlan,
                    copyTargets: sortPlaceholdersByFocusedModule(copyTargets, getFocusedModuleLayerIds(selectedScene, selectedElementContext, selectedModuleContext, Number(screen.id || 0))),
                    selectedScene,
                    selectedElementContext,
                    selectedModuleContext,
                    isFocusedScreen: focusedScreenId !== null && Number(screen.id || 0) === focusedScreenId
                };
        })
        .filter(Boolean) as ScreenCopyRequest[];
    }

    const repairCopyGeneration = await requestBatchGeneratedCopies(repairRequests, 'repair', copyPolicy);
    const repairedPlans = applyBatchCopyRepairs(
        plans,
        orderedScreens,
        screenPlanById,
        repairCopyGeneration.replacements
    ).map((plan) => ({
        ...plan,
        copies: (plan.copies || []).map((copy) => {
            if (copy.generationStatus !== 'failed') return copy;
            const repairFailureReason = repairCopyGeneration.failureReasonByLayerId.get(Number(copy.layerId || 0));
            return repairFailureReason
                ? { ...copy, generationReason: repairFailureReason }
                : copy;
        })
    }));
    const planByScreenId = new Map<number, any>(repairedPlans.map((plan) => [Number(plan.screenId || 0), plan]));
    const finalPlans = (params.screens || [])
        .map((screen) => planByScreenId.get(Number(screen.id || 0)))
        .filter(Boolean);

    return {
        success: true,
        plans: finalPlans
    };
}
