import type {
    MainImageDesignObjective,
    MainImageProjectStyleStrategyEvidence
} from './main-image-project-style-strategy';

export type MainImageDesignStandardsEvidenceStatus =
    | 'blocked_missing_project_style_strategy'
    | 'blocked_needs_visual_grounding'
    | 'ready_for_design_strategy';

export type MainImageDesignStandardsRuleSource =
    | 'project-style-evidence'
    | 'local-recipe'
    | 'qa-boundary';

export interface MainImageDesignStandardsEvidenceInput {
    projectStyleStrategyEvidence?: MainImageProjectStyleStrategyEvidence | null;
}

export interface MainImageDesignStandardsRule {
    id: string;
    appliesTo: MainImageDesignObjective | 'all';
    priority: 'must' | 'should' | 'watch';
    source: MainImageDesignStandardsRuleSource;
    rule: string;
    verificationTarget: string;
}

export interface MainImageDesignRecipeCandidate {
    id: string;
    title: string;
    appliesTo: MainImageDesignObjective;
    source: 'local-recipe';
    status: 'candidate';
    requiresEvidence: string[];
    boundary: string;
}

export interface MainImageDesignRequiredKnowledge {
    id: string;
    title: string;
    status: 'available' | 'missing' | 'needs_review';
    reason: string;
}

export interface MainImageDesignStandardsEvidence {
    version: 'main-image-design-standards-evidence/v0';
    skillId: 'main-image-design';
    scene: 'ecommerce-socks';
    status: MainImageDesignStandardsEvidenceStatus;
    product: {
        productType: string;
        subjectSummary: string;
        visualGrounding: string;
        styleKeywords: string[];
    };
    canGuideDesignPlan: boolean;
    clickImageGoals: string[];
    conversionImageGoals: string[];
    rules: MainImageDesignStandardsRule[];
    recipeCandidates: MainImageDesignRecipeCandidate[];
    requiredKnowledge: MainImageDesignRequiredKnowledge[];
    canClaimOutputQuality: false;
    canClaimDesignComplete: false;
    noPhotoshopWrites: true;
    mustNotExecutePhotoshop: true;
    blockers: string[];
    warnings: string[];
    limitations: string[];
    evidence: Array<{
        source: string;
        summary: string;
        status: 'ready' | 'needs_review' | 'unknown' | 'failed';
    }>;
}

const FORBIDDEN_PAYLOAD_PATTERNS = [
    /raw-image-payload/gi,
    /base64-image-payload/gi,
    /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi,
    /data:image\//gi
];

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
    styleEvidence: MainImageProjectStyleStrategyEvidence | null | undefined
): MainImageDesignStandardsEvidenceStatus {
    if (!styleEvidence) return 'blocked_missing_project_style_strategy';
    if (styleEvidence.status !== 'ready_visual_grounded') return 'blocked_needs_visual_grounding';
    return 'ready_for_design_strategy';
}

function buildProduct(
    styleEvidence: MainImageProjectStyleStrategyEvidence | null | undefined
): MainImageDesignStandardsEvidence['product'] {
    return {
        productType: cleanString(styleEvidence?.projectStyleUnderstanding.productType) || 'unknown',
        subjectSummary: cleanString(styleEvidence?.projectStyleUnderstanding.subjectSummary) || 'unknown',
        visualGrounding: cleanString(styleEvidence?.projectStyleUnderstanding.visualGrounding) || 'none',
        styleKeywords: cleanStrings(styleEvidence?.designDirection.styleKeywords)
    };
}

function buildClickImageGoals(
    status: MainImageDesignStandardsEvidenceStatus
): string[] {
    if (status !== 'ready_for_design_strategy') return [];
    return [
        '第一眼让用户看懂袜子款式、轮廓和上脚氛围。',
        '标题只服务点击兴趣，不堆参数，不遮挡袜子主体。',
        '主体占比、留白和对比度必须在 Photoshop 执行后回读验证。'
    ];
}

function buildConversionImageGoals(
    status: MainImageDesignStandardsEvidenceStatus
): string[] {
    if (status !== 'ready_for_design_strategy') return [];
    return [
        '把点击兴趣转成购买理由：材质感、舒适场景、搭配价值或细节证据。',
        '文案必须来自真实视觉 grounding、商品简报或用户补充，不能凭空编造卖点。',
        '图片和文案分区要保留可编辑结构，便于后续验收和调整。'
    ];
}

function buildGenericRules(): MainImageDesignStandardsRule[] {
    return [
        {
            id: 'generic-readability-boundary',
            appliesTo: 'all',
            priority: 'must',
            source: 'qa-boundary',
            rule: '没有真实视觉 grounding 时，只能输出待复核规范，不能判断袜子款式、材质、罗口和卖点。',
            verificationTarget: 'projectStyleStrategyEvidence.status must be ready_visual_grounded before design planning'
        },
        {
            id: 'generic-no-quality-claim',
            appliesTo: 'all',
            priority: 'must',
            source: 'qa-boundary',
            rule: '设计规范 evidence 不是 Photoshop 执行结果，不能声称已完成主图、点击图或转化图。',
            verificationTarget: 'canClaimDesignComplete=false and canClaimOutputQuality=false'
        }
    ];
}

function buildGroundedRules(): MainImageDesignStandardsRule[] {
    return [
        {
            id: 'click-hero-focus',
            appliesTo: 'click-image',
            priority: 'must',
            source: 'project-style-evidence',
            rule: '点击图优先放大款式第一眼识别点，主体不能被文案、装饰或裁切破坏。',
            verificationTarget: 'post-transform actualBounds and screenshot must show product subject remains primary focus'
        },
        {
            id: 'click-copy-short',
            appliesTo: 'click-image',
            priority: 'should',
            source: 'local-recipe',
            rule: '点击图文案使用短标题承接视觉钩子，避免把商品参数写成大段说明。',
            verificationTarget: 'copy slot count and line length reviewed before final export'
        },
        {
            id: 'conversion-evidence-first',
            appliesTo: 'conversion-image',
            priority: 'must',
            source: 'project-style-evidence',
            rule: '转化图需要把视觉细节转译成可信购买理由，例如穿着场景、舒适感、搭配价值或材质细节。',
            verificationTarget: 'each conversion image has visible product evidence or user-provided brief support'
        },
        {
            id: 'conversion-layout-readable',
            appliesTo: 'conversion-image',
            priority: 'should',
            source: 'local-recipe',
            rule: '转化图需要稳定的信息层级：主视觉、主文案、辅助证据分区清晰，不把所有信息挤到同一块。',
            verificationTarget: 'layer snapshot and screenshot QA verify spacing, overlap and hierarchy'
        },
        {
            id: 'editable-layer-boundary',
            appliesTo: 'all',
            priority: 'must',
            source: 'qa-boundary',
            rule: '所有方案都必须保留可编辑图层和后续验收入口，不能只生成扁平图片。',
            verificationTarget: 'Photoshop layer hierarchy readback after future execution'
        }
    ];
}

function buildRules(status: MainImageDesignStandardsEvidenceStatus): MainImageDesignStandardsRule[] {
    if (status !== 'ready_for_design_strategy') return buildGenericRules();
    return [...buildGenericRules(), ...buildGroundedRules()];
}

function buildRecipeCandidates(
    status: MainImageDesignStandardsEvidenceStatus
): MainImageDesignRecipeCandidate[] {
    if (status !== 'ready_for_design_strategy') return [];
    return [
        {
            id: 'recipe-click-clean-hero',
            title: '清爽主体点击图',
            appliesTo: 'click-image',
            source: 'local-recipe',
            status: 'candidate',
            requiresEvidence: [
                'visual_or_manual_product_grounding',
                'subject_bounds',
                'safe_area',
                'post_transform_screenshot'
            ],
            boundary: '候选 recipe 只提供构图方向，不代表已参考外部案例或已执行 Photoshop。'
        },
        {
            id: 'recipe-conversion-detail-proof',
            title: '细节证据转化图',
            appliesTo: 'conversion-image',
            source: 'local-recipe',
            status: 'candidate',
            requiresEvidence: [
                'visual_or_manual_product_grounding',
                'product_brief_or_user_fact',
                'text_slot_plan',
                'post_export_qa'
            ],
            boundary: '候选 recipe 需要商品事实支撑，不能凭空写材质、功能或效果承诺。'
        }
    ];
}

function buildRequiredKnowledge(
    status: MainImageDesignStandardsEvidenceStatus,
    styleEvidence: MainImageProjectStyleStrategyEvidence | null | undefined
): MainImageDesignRequiredKnowledge[] {
    const visualGroundingStatus = status === 'ready_for_design_strategy' ? 'available' : 'missing';
    const referenceStatus = Number(styleEvidence?.referenceResearchPlan.referenceHintCount || 0) > 0
        ? 'available'
        : 'missing';

    return [
        {
            id: 'product-visual-grounding',
            title: '款式和视觉锚点',
            status: visualGroundingStatus,
            reason: visualGroundingStatus === 'available'
                ? '已由 projectStyleStrategyEvidence 提供视觉或人工 grounding。'
                : '缺少真实看图或人工标注，不能判断袜子款式和卖点。'
        },
        {
            id: 'product-brief-facts',
            title: '商品事实和卖点边界',
            status: 'missing',
            reason: '当前 evidence 不包含商品简报，后续文案和转化理由必须由用户、知识库或网页证据补齐。'
        },
        {
            id: 'external-reference-evidence',
            title: '外部参考和设计知识来源',
            status: referenceStatus,
            reason: referenceStatus === 'available'
                ? '已有 referenceHints，可作为后续参考来源线索。'
                : '尚未执行网页搜索或案例检索，不能声称参考了优秀案例。'
        },
        {
            id: 'photoshop-readback-qa',
            title: 'Photoshop 执行后读回和验收',
            status: 'missing',
            reason: '设计规范阶段不会执行 Photoshop，后续必须读回图层、bounds、截图或导出图。'
        }
    ];
}

function buildBlockers(status: MainImageDesignStandardsEvidenceStatus): string[] {
    switch (status) {
        case 'blocked_missing_project_style_strategy':
            return ['main_image_project_style_strategy_required'];
        case 'blocked_needs_visual_grounding':
            return ['main_image_visual_grounding_required_for_design_standards'];
        case 'ready_for_design_strategy':
        default:
            return [];
    }
}

function buildWarnings(
    status: MainImageDesignStandardsEvidenceStatus,
    styleEvidence: MainImageProjectStyleStrategyEvidence | null | undefined
): string[] {
    const warnings: string[] = [];
    if (status !== 'ready_for_design_strategy') {
        warnings.push('主图设计规范尚未获得视觉 grounding，只能保留通用边界，不能进入真实设计决策。');
    }
    if (Number(styleEvidence?.referenceResearchPlan.referenceHintCount || 0) === 0) {
        warnings.push('尚未提供外部参考或网页知识 evidence；recipe 只能作为本地候选，不是已检索案例。');
    }
    return warnings;
}

function getEvidenceStatus(status: MainImageDesignStandardsEvidenceStatus): 'ready' | 'needs_review' | 'unknown' | 'failed' {
    switch (status) {
        case 'ready_for_design_strategy':
            return 'ready';
        case 'blocked_needs_visual_grounding':
            return 'needs_review';
        case 'blocked_missing_project_style_strategy':
        default:
            return 'failed';
    }
}

export function buildMainImageDesignStandardsEvidence(
    input: MainImageDesignStandardsEvidenceInput
): MainImageDesignStandardsEvidence {
    const styleEvidence = input.projectStyleStrategyEvidence;
    const status = resolveStatus(styleEvidence);
    const product = buildProduct(styleEvidence);
    const rules = buildRules(status);
    const recipeCandidates = buildRecipeCandidates(status);
    const requiredKnowledge = buildRequiredKnowledge(status, styleEvidence);

    return {
        version: 'main-image-design-standards-evidence/v0',
        skillId: 'main-image-design',
        scene: 'ecommerce-socks',
        status,
        product,
        canGuideDesignPlan: status === 'ready_for_design_strategy',
        clickImageGoals: buildClickImageGoals(status),
        conversionImageGoals: buildConversionImageGoals(status),
        rules,
        recipeCandidates,
        requiredKnowledge,
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        blockers: buildBlockers(status),
        warnings: buildWarnings(status, styleEvidence),
        limitations: [
            '主图设计规范 evidence 只消费 projectStyleStrategyEvidence，不调用 provider、不搜索网页、不读取像素、不执行 Photoshop。',
            '它用于约束后续点击图/转化图设计计划，不代表已经完成 Photoshop 设计。',
            '商品事实、外部参考和执行后 QA 缺失时必须显示为 missing 或 needs_review，不能伪造成已具备。'
        ],
        evidence: [{
            source: 'main-image-design-standards-evidence',
            summary: `status=${status}; productType=${product.productType}; rules=${rules.length}; recipes=${recipeCandidates.length}`,
            status: getEvidenceStatus(status)
        }]
    };
}
