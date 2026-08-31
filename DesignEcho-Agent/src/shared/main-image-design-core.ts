import type { MainImageProjectStyleStrategy } from './main-image-project-style-strategy';
import {
    MAIN_IMAGE_DELIVERY_DOCUMENTS,
    type MainImageDeliverableImageType,
    type MainImageDeliveryDocumentSpec
} from './main-image-production-spec';
import type { MainImageVisualContextStatus } from './main-image-visual-loop';

export {
    MAIN_IMAGE_DELIVERY_DOCUMENTS,
    type MainImageDeliverableImageType,
    type MainImageDeliveryDocumentSpec,
    type MainImageDeliveryFolderKey,
    type MainImageDeliveryRatio
} from './main-image-production-spec';

export type MainImageDesignCoreStatus =
    | 'blocked_missing_project_style_strategy'
    | 'blocked_needs_visual_context'
    | 'ready_design_core_plan';

export interface MainImageWhiteBackgroundSpec {
    outputPath: string;
    sourceDocumentPath: string;
    sourcePolicy: string;
    canvasSize: {
        width: 800;
        height: 800;
    };
    targetSubjectHeightPx: 760;
    totalHorizontalMarginPx: 40;
    rules: string[];
}

export interface MainImageDesignCorePlan {
    version: 'main-image-design-core/v0';
    skillId: 'main-image-design';
    scene: 'ecommerce-socks';
    status: MainImageDesignCoreStatus;
    productUnderstanding: {
        productType: string;
        subjectSummary: string;
        visualContext: MainImageVisualContextStatus;
        styleKeywords: string[];
        requiredFacts: string[];
    };
    designWorkflow: string[];
    clickImageRules: string[];
    conversionImageRules: string[];
    whiteBackgroundSpec: MainImageWhiteBackgroundSpec;
    deliveryDocuments: MainImageDeliveryDocumentSpec[];
    referencePlan: {
        status: 'planned_not_run' | 'reference_hints_available';
        querySeeds: string[];
        requiredSources: string[];
        boundary: string;
    };
    copyPlan: {
        status: 'reserve_slots' | 'has_candidates';
        candidateCount: number;
        clickCopyRole: string;
        conversionCopyRole: string;
        rules: string[];
    };
    qaRules: string[];
    canClaimOutputQuality: false;
    canClaimDesignComplete: false;
    noPhotoshopWrites: true;
    mustNotExecutePhotoshop: true;
    blockers: string[];
    warnings: string[];
    limitations: string[];
}

const FORBIDDEN_PAYLOAD_PATTERNS = [
    /raw-image-payload/gi,
    /base64-image-payload/gi,
    /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi,
    /data:image\//gi
];

export const MAIN_IMAGE_WHITE_BACKGROUND_SPEC: MainImageWhiteBackgroundSpec = {
    outputPath: '主图/白底.jpg',
    sourceDocumentPath: 'PSD/SKU.psb',
    sourcePolicy: '必须由用户或 Agent 从 SKU 源文件中明确选定一个真实颜色/款式；没有选定时保持待选择，不按文件顺序猜代表色。',
    canvasSize: { width: 800, height: 800 },
    targetSubjectHeightPx: 760,
    totalHorizontalMarginPx: 40,
    rules: [
        '白底图是平台素材图，不从点击图或转化图裁切。',
        '商品主体保持真实颜色、款式、数量和图案，不做主图装饰化处理。',
        '主体居中，背景干净，按 800x800 导出。',
        '如 SKU 颜色来源不明确，应阻断或进入人工选择，不猜测代表色。'
    ]
};

function cleanString(value: unknown): string {
    let text = String(value || '').trim();
    for (const pattern of FORBIDDEN_PAYLOAD_PATTERNS) {
        text = text.replace(pattern, '[redacted-image-payload]');
    }
    return text.replace(/\s+/g, ' ').trim();
}

function cleanStrings(values: unknown): string[] {
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(values.map(cleanString).filter(Boolean)));
}

function resolveStatus(
    styleStrategy: MainImageProjectStyleStrategy | null | undefined
): MainImageDesignCoreStatus {
    if (!styleStrategy) return 'blocked_missing_project_style_strategy';
    if (styleStrategy.status !== 'ready_visual_context') return 'blocked_needs_visual_context';
    return 'ready_design_core_plan';
}

function buildBlockers(status: MainImageDesignCoreStatus): string[] {
    if (status === 'blocked_missing_project_style_strategy') return ['main_image_project_style_strategy_required'];
    if (status === 'blocked_needs_visual_context') return ['main_image_visual_context_required_for_design_core'];
    return [];
}

function buildProductUnderstanding(
    styleStrategy: MainImageProjectStyleStrategy | null | undefined
): MainImageDesignCorePlan['productUnderstanding'] {
    return {
        productType: cleanString(styleStrategy?.projectStyleUnderstanding.productType) || 'unknown',
        subjectSummary: cleanString(styleStrategy?.projectStyleUnderstanding.subjectSummary) || 'unknown',
        visualContext: styleStrategy?.projectStyleUnderstanding.visualContext || {
            readiness: 'missing',
            source: 'missing',
            assetMatch: false,
            usableFields: [],
            reason: '缺少项目款式策略。'
        },
        styleKeywords: cleanStrings(styleStrategy?.designDirection.styleKeywords),
        requiredFacts: [
            '款式、颜色、图案、材质感、袜口和上脚/平铺状态必须来自项目摄影图、SKU 图、项目已确认事实或用户明确事实。',
            '卖点和痛点必须标明来源；没有可靠来源只能进入待确认，不能写进最终文案。',
            '主图设计不得改变商品颜色、数量、图案、包装、标签和材质事实。'
        ]
    };
}

function buildReferencePlan(
    styleStrategy: MainImageProjectStyleStrategy | null | undefined
): MainImageDesignCorePlan['referencePlan'] {
    return {
        status: styleStrategy?.referenceResearchPlan.status === 'reference_hints_available'
            ? 'reference_hints_available'
            : 'planned_not_run',
        querySeeds: cleanStrings(styleStrategy?.referenceResearchPlan.querySeeds),
        requiredSources: [
            '同类袜子天猫/淘宝点击图参考',
            '同类袜子卖点转化图参考',
            '参考图构图、文字层级、主体比例和色彩氛围分析',
            '参考来源记录，不能把未搜索的内容说成已参考'
        ],
        boundary: '参考图只提供设计方向和结构来源，不抄袭原图，不替代项目摄影图理解。'
    };
}

function buildWarnings(input: {
    status: MainImageDesignCoreStatus;
    styleStrategy?: MainImageProjectStyleStrategy | null;
    copyCandidates: string[];
}): string[] {
    const warnings: string[] = [];
    if (input.status !== 'ready_design_core_plan') {
        warnings.push('主图设计核心缺少与所选素材绑定的可用视觉上下文，不能进入可执行设计概念。');
    }
    if (input.copyCandidates.length === 0) {
        warnings.push('缺少文案候选；只能规划文案槽和写作规则，不能编造卖点。');
    }
    if (input.styleStrategy?.referenceResearchPlan.status !== 'reference_hints_available') {
        warnings.push('尚未接入参考图来源；只能生成参考检索计划，不能声称已参考案例。');
    }
    return warnings;
}

export function buildMainImageDesignCorePlan(input: {
    projectStyleStrategy?: MainImageProjectStyleStrategy | null;
    copyCandidates?: string[];
}): MainImageDesignCorePlan {
    const styleStrategy = input.projectStyleStrategy;
    const status = resolveStatus(styleStrategy);
    const copyCandidates = cleanStrings(input.copyCandidates);
    const blockers = buildBlockers(status);

    return {
        version: 'main-image-design-core/v0',
        skillId: 'main-image-design',
        scene: 'ecommerce-socks',
        status,
        productUnderstanding: buildProductUnderstanding(styleStrategy),
        designWorkflow: [
            '读取项目摄影图、SKU 源文件、已有主图和参考素材。',
            '理解款式、视觉锚点、商品事实、卖点和待确认痛点。',
            '检索或读取同类参考，拆解构图、主体比例、文案层级和氛围。',
            '生成统一主图设计概念，再适配 800/750/1200 三个文档。',
            '输出可编辑 PSB、导出图、白底图和 QA 检查结果。'
        ],
        clickImageRules: [
            '点击图负责第一眼点击动机，必须让用户快速看懂款式和视觉气质。',
            '800、750、1200 都保留点击图容器；本次填充与交付哪些槽由 Agent 或用户根据任务决定。',
            '如 Agent 决定使用文字，应保持信息克制且图文关系清楚；摄影本身完成点击任务时，无文字同样可以成立。'
        ],
        conversionImageRules: [
            '转化图负责解释为什么买，一张图只解决一个卖点或痛点。',
            '800、750、1200 都保留 2/3/4/5 转化图容器；本次填充哪些槽位由 Agent 或用户决定。',
            '痛点和卖点必须有用户事实、项目资料、参考知识或图片观察支撑。'
        ],
        whiteBackgroundSpec: MAIN_IMAGE_WHITE_BACKGROUND_SPEC,
        deliveryDocuments: MAIN_IMAGE_DELIVERY_DOCUMENTS,
        referencePlan: buildReferencePlan(styleStrategy),
        copyPlan: {
            status: copyCandidates.length > 0 ? 'has_candidates' : 'reserve_slots',
            candidateCount: copyCandidates.length,
            clickCopyRole: '短标题抓第一眼，承接款式、氛围或核心利益点。',
            conversionCopyRole: '一图一个购买理由，解释材质、舒适、透气、袜口、搭配或颜色选择。',
            rules: [
                '点击图文案短，不堆参数。',
                '转化图文案必须能被商品事实或画面观察支撑。',
                '不使用无依据绝对化、医疗化、功效化和逼单式表达。',
                '文案必须适配可编辑文字槽，后续执行要检查溢出和遮挡。'
            ]
        },
        qaRules: [
            'PSD/800.psb、PSD/750.psb、PSD/1200.psb 必须存在且尺寸匹配。',
            '三个文档都必须保留 5 个点击槽与 4 个转化槽；空槽不是缺少设计，只有结构非空的子组进入批量导出。',
            '批量导出文件名必须等于子组名，且每次只合成当前子组，不能叠加同父组的兄弟方案。',
            '主图/白底.jpg 必须来自 SKU 真实颜色/款式源文件。',
            '三规格点击图内容同源，不能出现卖点、颜色、款式互相矛盾。',
            '文字不得溢出安全区，不得遮挡商品真实性信息。',
            '没有截图、导出文件和人工复核结果时，不能声明设计质量完成。'
        ],
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        blockers,
        warnings: buildWarnings({ status, styleStrategy, copyCandidates }),
        limitations: [
            '设计核心计划只定义设计逻辑、交付结构和 QA 规则，不执行 Photoshop。',
            '1500x1500、1500x2000、1440x2160 是当前店铺工作画布与无缩放批量导出尺寸，不等于已确认的平台上传尺寸。',
            '它不调用网页搜索、不读取像素、不保存文件；参考来源和视觉观察必须由上游提供。',
            '输出结构正确不等于主图审美质量通过，仍需结果图、图层读回和人工复核。'
        ]
    };
}
