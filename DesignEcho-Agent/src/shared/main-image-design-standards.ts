import type {
    MainImageDesignObjective,
    MainImageProjectStyleStrategy
} from './main-image-project-style-strategy';
import type { MainImageVisualContextStatus } from './main-image-visual-loop';

export type MainImageDesignStandardsStatus =
    | 'blocked_missing_project_style_strategy'
    | 'blocked_needs_visual_context'
    | 'pending_agent_design_decision'
    | 'ready_for_design_strategy';

export type MainImageDesignStandardsRuleSource =
    | 'agent-design-decision'
    | 'qa-boundary';

export interface MainImageDesignStandardsInput {
    projectStyleStrategy?: MainImageProjectStyleStrategy | null;
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
    source: 'agent-design-decision';
    status: 'candidate';
    requiredInputs: string[];
    boundary: string;
}

export interface MainImageDesignRequiredKnowledge {
    id: string;
    title: string;
    status: 'available' | 'missing' | 'needs_review';
    reason: string;
}

export interface MainImageDesignStandards {
    version: 'main-image-design-standards/v0';
    skillId: 'main-image-design';
    scene: 'ecommerce-socks';
    status: MainImageDesignStandardsStatus;
    product: {
        productType: string;
        subjectSummary: string;
        visualContext: MainImageVisualContextStatus;
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
    styleStrategy: MainImageProjectStyleStrategy | null | undefined
): MainImageDesignStandardsStatus {
    if (!styleStrategy) return 'blocked_missing_project_style_strategy';
    if (styleStrategy.status !== 'ready_visual_context') return 'blocked_needs_visual_context';
    const decision = styleStrategy.agentDesignDecision;
    const hasAgentDecision = Boolean(decision && [
        ...(decision.styleKeywords || []),
        decision.recommendedTone,
        decision.backgroundDirection,
        ...(decision.clickVisualHooks || []),
        ...(decision.conversionVisualHooks || []),
        decision.clickLayoutFocus,
        decision.conversionLayoutFocus,
        decision.clickCopyRole,
        decision.conversionCopyRole
    ].some((value) => cleanString(value)));
    if (!hasAgentDecision) return 'pending_agent_design_decision';
    return 'ready_for_design_strategy';
}

function buildProduct(
    styleStrategy: MainImageProjectStyleStrategy | null | undefined
): MainImageDesignStandards['product'] {
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
        styleKeywords: cleanStrings(styleStrategy?.designDirection.styleKeywords)
    };
}

function buildClickImageGoals(
    status: MainImageDesignStandardsStatus,
    styleStrategy: MainImageProjectStyleStrategy | null | undefined
): string[] {
    if (status !== 'ready_for_design_strategy') return [];
    const decision = styleStrategy?.agentDesignDecision;
    return cleanStrings([
        ...(decision?.clickVisualHooks || []),
        decision?.clickLayoutFocus,
        decision?.clickCopyRole
    ]).slice(0, 8);
}

function buildConversionImageGoals(
    status: MainImageDesignStandardsStatus,
    styleStrategy: MainImageProjectStyleStrategy | null | undefined
): string[] {
    if (status !== 'ready_for_design_strategy') return [];
    const decision = styleStrategy?.agentDesignDecision;
    return cleanStrings([
        ...(decision?.conversionVisualHooks || []),
        decision?.conversionLayoutFocus,
        decision?.conversionCopyRole
    ]).slice(0, 8);
}

function buildGenericRules(): MainImageDesignStandardsRule[] {
    return [
        {
            id: 'generic-readability-boundary',
            appliesTo: 'all',
            priority: 'must',
            source: 'qa-boundary',
            rule: '没有与所选素材绑定的可用视觉上下文时，只能输出待复核规范，不能判断商品款式、材质、细节和卖点。',
            verificationTarget: 'projectStyleStrategy.status must be ready_visual_context before design planning'
        },
        {
            id: 'generic-no-quality-claim',
            appliesTo: 'all',
            priority: 'must',
            source: 'qa-boundary',
            rule: '设计规范不是 Photoshop 执行结果，不能声称已完成主图、点击图或转化图。',
            verificationTarget: 'canClaimDesignComplete=false and canClaimOutputQuality=false'
        }
    ];
}

function buildRules(): MainImageDesignStandardsRule[] {
    return [
        ...buildGenericRules(),
        {
            id: 'editable-layer-boundary',
            appliesTo: 'all',
            priority: 'must',
            source: 'qa-boundary',
            rule: '已声明方案必须保留可编辑图层和后续验收入口，不能只生成扁平图片。',
            verificationTarget: 'Photoshop layer hierarchy readback after future execution'
        }
    ];
}

function buildRecipeCandidates(): MainImageDesignRecipeCandidate[] {
    return [];
}

function buildRequiredKnowledge(
    status: MainImageDesignStandardsStatus,
    styleStrategy: MainImageProjectStyleStrategy | null | undefined
): MainImageDesignRequiredKnowledge[] {
    const visualContextStatus = status === 'ready_for_design_strategy'
        || status === 'pending_agent_design_decision'
        ? 'available'
        : 'missing';
    const referenceStatus = Number(styleStrategy?.referenceResearchPlan.referenceHintCount || 0) > 0
        ? 'available'
        : 'missing';

    return [
        {
            id: 'product-visual-context',
            title: '款式和视觉锚点',
            status: visualContextStatus,
            reason: visualContextStatus === 'available'
                ? 'projectStyleStrategy 已提供与所选素材绑定的可用视觉上下文。'
                : '缺少与所选素材绑定的可用视觉分析，不能判断袜子款式和卖点。'
        },
        {
            id: 'product-brief-facts',
            title: '商品事实和卖点边界',
            status: 'missing',
            reason: '当前设计规范不包含商品简报，后续文案和转化理由必须由用户、知识库或网页来源补齐。'
        },
        {
            id: 'external-reference-sources',
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

function buildBlockers(status: MainImageDesignStandardsStatus): string[] {
    switch (status) {
        case 'blocked_missing_project_style_strategy':
            return ['main_image_project_style_strategy_required'];
        case 'blocked_needs_visual_context':
            return ['main_image_visual_context_required_for_design_standards'];
        case 'pending_agent_design_decision':
        case 'ready_for_design_strategy':
        default:
            return [];
    }
}

function buildWarnings(
    status: MainImageDesignStandardsStatus,
    styleStrategy: MainImageProjectStyleStrategy | null | undefined
): string[] {
    const warnings: string[] = [];
    if (status !== 'ready_for_design_strategy') {
        warnings.push(status === 'pending_agent_design_decision'
            ? '已有视觉上下文，但 Agent 尚未声明视觉 hook、版式重点或文案角色；设计目标保持 pending。'
            : '主图设计规范尚未获得可用视觉上下文，只能保留通用边界，不能进入真实设计决策。');
    }
    if (Number(styleStrategy?.referenceResearchPlan.referenceHintCount || 0) === 0) {
        warnings.push('尚未提供外部参考或网页知识来源；不能声称当前设计方向来自已检索案例。');
    }
    return warnings;
}

export function buildMainImageDesignStandards(
    input: MainImageDesignStandardsInput
): MainImageDesignStandards {
    const styleStrategy = input.projectStyleStrategy;
    const status = resolveStatus(styleStrategy);
    const product = buildProduct(styleStrategy);
    const rules = buildRules();
    const recipeCandidates = buildRecipeCandidates();
    const requiredKnowledge = buildRequiredKnowledge(status, styleStrategy);

    return {
        version: 'main-image-design-standards/v0',
        skillId: 'main-image-design',
        scene: 'ecommerce-socks',
        status,
        product,
        canGuideDesignPlan: status === 'ready_for_design_strategy',
        clickImageGoals: buildClickImageGoals(status, styleStrategy),
        conversionImageGoals: buildConversionImageGoals(status, styleStrategy),
        rules,
        recipeCandidates,
        requiredKnowledge,
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        blockers: buildBlockers(status),
        warnings: buildWarnings(status, styleStrategy),
        limitations: [
            '主图设计规范只消费 projectStyleStrategy，不调用 provider、不搜索网页、不读取像素、不执行 Photoshop。',
            '它只投影 Agent 已声明的点击图 /转化图目标和通用 QA 边界，不提供本地构图 recipe。',
            '商品事实、外部参考和执行后 QA 缺失时必须显示为 missing 或 needs_review，不能伪造成已具备。'
        ]
    };
}
