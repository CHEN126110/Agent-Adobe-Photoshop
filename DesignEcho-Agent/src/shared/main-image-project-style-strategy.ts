import type { MainImageDraftAsset } from './main-image-agent-draft-plan';
import type { MainImageAgentDesignDecision, MainImageVisionSignal } from './main-image-visual-loop';

export type MainImageProjectStyleStrategyStatus =
    | 'blocked_missing_project_images'
    | 'needs_vision'
    | 'ready_visual_grounded';

export type MainImageVariantType = 'click' | 'conversion';
export type MainImageDesignObjective = 'click-image' | 'conversion-image';

export interface MainImageReferenceHint {
    title?: string;
    source?: string;
    url?: string;
    note?: string;
}

export interface MainImageProjectStyleStrategyInput {
    userText?: string;
    projectAssets?: MainImageDraftAsset[];
    selectedAsset?: MainImageDraftAsset | null;
    visionSignal?: MainImageVisionSignal | null;
    referenceHints?: MainImageReferenceHint[];
    desiredClickImageCount?: number;
    desiredConversionImageCount?: number;
}

export interface MainImageVariantDirection {
    id: string;
    imageType: MainImageVariantType;
    objective: string;
    visualHook: string;
    layoutFocus: string;
    copyRole: string;
    referenceNeed: string;
    requiredEvidence: string[];
}

export interface MainImageProjectStyleStrategyEvidence {
    version: 'main-image-project-style-strategy/v0';
    skillId: 'main-image-design';
    scene: 'ecommerce-socks';
    status: MainImageProjectStyleStrategyStatus;
    projectStyleUnderstanding: {
        productType: string;
        subjectSummary: string;
        visualGrounding: 'none' | string;
        assetCount: number;
        selectedAssetName?: string;
        selectedAssetPath?: string;
        semanticStatus: 'missing' | 'needs_vision' | 'visual_grounded';
    };
    designDirection: {
        objectives: MainImageDesignObjective[];
        styleKeywords: string[];
        recommendedTone: string;
        designPrinciples: string[];
    };
    agentDesignDecision?: MainImageAgentDesignDecision | null;
    referenceResearchPlan: {
        status: 'planned_not_run' | 'reference_hints_available';
        querySeeds: string[];
        referenceHintCount: number;
        references: Array<{
            title?: string;
            source?: string;
            url?: string;
            note?: string;
        }>;
        boundary: string;
    };
    variantPlan: {
        clickImages: MainImageVariantDirection[];
        conversionImages: MainImageVariantDirection[];
    };
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

function cleanOptionalString(value: unknown): string | undefined {
    const text = cleanString(value);
    return text || undefined;
}

function uniqueCleanStrings(values: unknown, max = 8): string[] {
    if (!Array.isArray(values)) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const text = cleanString(value);
        if (!text || seen.has(text)) continue;
        seen.add(text);
        result.push(text);
        if (result.length >= max) break;
    }
    return result;
}

function normalizeAgentDecision(value: MainImageAgentDesignDecision | null | undefined): MainImageAgentDesignDecision | null {
    if (!value || typeof value !== 'object') return null;
    const decision: MainImageAgentDesignDecision = {
        styleKeywords: uniqueCleanStrings(value.styleKeywords),
        recommendedTone: cleanOptionalString(value.recommendedTone),
        backgroundDirection: cleanOptionalString(value.backgroundDirection),
        clickVisualHooks: uniqueCleanStrings(value.clickVisualHooks),
        conversionVisualHooks: uniqueCleanStrings(value.conversionVisualHooks),
        clickLayoutFocus: cleanOptionalString(value.clickLayoutFocus),
        conversionLayoutFocus: cleanOptionalString(value.conversionLayoutFocus),
        clickCopyRole: cleanOptionalString(value.clickCopyRole),
        conversionCopyRole: cleanOptionalString(value.conversionCopyRole),
        referenceQueries: uniqueCleanStrings(value.referenceQueries, 6),
        notes: uniqueCleanStrings(value.notes)
    };
    if (
        Object.values(decision).some((item) => (
            Array.isArray(item) ? item.length > 0 : Boolean(item)
        ))
    ) {
        return decision;
    }
    return null;
}

function clampCount(value: unknown, fallback: number, max: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
    return Math.max(0, Math.min(max, Math.round(numeric)));
}

function normalizeAssets(assets: MainImageDraftAsset[] | undefined): MainImageDraftAsset[] {
    return (assets || []).filter((asset) => cleanString(asset.name) || cleanString(asset.path));
}

function getSelectedAsset(input: MainImageProjectStyleStrategyInput): MainImageDraftAsset | undefined {
    if (input.selectedAsset && (cleanString(input.selectedAsset.name) || cleanString(input.selectedAsset.path))) {
        return input.selectedAsset;
    }
    return normalizeAssets(input.projectAssets)[0];
}

function getVisualGrounding(visionSignal: MainImageVisionSignal | null | undefined): 'none' | string {
    return cleanString(visionSignal?.source) || 'none';
}

function hasVisualGrounding(visionSignal: MainImageVisionSignal | null | undefined): boolean {
    return getVisualGrounding(visionSignal) !== 'none';
}

function getStatus(input: {
    assetCount: number;
    visualGrounded: boolean;
}): MainImageProjectStyleStrategyStatus {
    if (input.assetCount === 0) return 'blocked_missing_project_images';
    if (!input.visualGrounded) return 'needs_vision';
    return 'ready_visual_grounded';
}

function buildStyleKeywords(visionSignal: MainImageVisionSignal | null | undefined): string[] {
    const decisionKeywords = uniqueCleanStrings(visionSignal?.agentDecision?.styleKeywords);
    if (decisionKeywords.length > 0) return decisionKeywords;
    return uniqueCleanStrings(visionSignal?.styleHints);
}

function buildDesignPrinciples(visualGrounded: boolean): string[] {
    if (!visualGrounded) {
        return [
            '先补充视觉理解或人工标注，再决定款式、卖点和构图。',
            '没有看图证据时，不生成点击图或转化图方案。',
            '参考搜索只能作为后续证据来源，不能伪造成已执行结果。'
        ];
    }
    return [
        '点击图、转化图的视觉 hook、文案角度和背景方向必须来自模型 Agent 决策或人工标注，不由代码关键词猜测。',
        '代码层只保留主体安全区、可读性、可编辑性和验收约束。',
        '每张图必须保留可编辑图层和后续 QA 证据，不能只导出扁平图。',
        '参考图只提供方向，不直接抄袭版式或文案。'
    ];
}

function buildQuerySeeds(input: {
    productType: string;
    styleKeywords: string[];
    agentDecision?: MainImageAgentDesignDecision | null;
}): string[] {
    const decisionQueries = uniqueCleanStrings(input.agentDecision?.referenceQueries, 6);
    if (decisionQueries.length > 0) return decisionQueries;
    if (input.productType === 'unknown') {
        return [
            '袜子 电商 主图 点击图 参考',
            '袜子 电商 转化图 卖点 参考'
        ];
    }
    const style = input.styleKeywords.slice(0, 3).join(' ');
    return [
        `${input.productType} 电商主图 点击图 参考 ${style}`.trim(),
        `${input.productType} 详情卖点 转化图 参考 ${style}`.trim(),
        `${input.productType} 电商主图 详情页 视觉参考 ${style}`.trim()
    ];
}

function normalizeReferenceHints(hints: MainImageReferenceHint[] | undefined): MainImageProjectStyleStrategyEvidence['referenceResearchPlan']['references'] {
    return (hints || []).slice(0, 8).map((hint) => ({
        title: cleanOptionalString(hint.title),
        source: cleanOptionalString(hint.source),
        url: cleanOptionalString(hint.url),
        note: cleanOptionalString(hint.note)
    }));
}

function buildVariantDirection(
    index: number,
    imageType: MainImageVariantType,
    productType: string,
    styleKeywords: string[],
    agentDecision?: MainImageAgentDesignDecision | null
): MainImageVariantDirection {
    const style = styleKeywords.length > 0 ? styleKeywords.join(' / ') : '视觉款式待复核';
    const typeLabel = imageType === 'click' ? '点击图' : '转化图';
    const visualHooks = imageType === 'click'
        ? uniqueCleanStrings(agentDecision?.clickVisualHooks)
        : uniqueCleanStrings(agentDecision?.conversionVisualHooks);
    const layoutFocus = cleanString(imageType === 'click'
        ? agentDecision?.clickLayoutFocus
        : agentDecision?.conversionLayoutFocus)
        || '待模型 Agent 基于素材视觉证据、参考和用户目标决定；代码层仅约束主体安全区、可读性和可编辑性。';
    const copyRole = cleanString(imageType === 'click'
        ? agentDecision?.clickCopyRole
        : agentDecision?.conversionCopyRole)
        || '待模型 Agent 基于商品事实和视觉证据决定文案角度；不能由代码临场编造卖点。';

    return {
        id: `${imageType}-${index + 1}`,
        imageType,
        objective: `${typeLabel} ${index + 1}: ${productType === 'unknown' ? '商品款式' : productType} ${style}`,
        visualHook: visualHooks[index % Math.max(1, visualHooks.length)] || '待模型 Agent 决定视觉 hook',
        layoutFocus,
        copyRole,
        referenceNeed: imageType === 'click'
            ? '需要召回同类袜子点击图参考，关注第一眼构图、留白和主体占比。'
            : '需要召回同类袜子转化图参考，关注卖点证据、图文关系和可信表达。',
        requiredEvidence: [
            'visual_or_manual_style_grounding',
            'selected_asset_or_project_image',
            'photoshop_editable_layer_plan',
            'post_export_or_screenshot_qa'
        ]
    };
}

function buildVariants(input: {
    status: MainImageProjectStyleStrategyStatus;
    productType: string;
    styleKeywords: string[];
    clickCount: number;
    conversionCount: number;
    agentDecision?: MainImageAgentDesignDecision | null;
}): MainImageProjectStyleStrategyEvidence['variantPlan'] {
    if (input.status !== 'ready_visual_grounded') {
        return { clickImages: [], conversionImages: [] };
    }
    return {
        clickImages: Array.from({ length: input.clickCount }, (_, index) => (
            buildVariantDirection(index, 'click', input.productType, input.styleKeywords, input.agentDecision)
        )),
        conversionImages: Array.from({ length: input.conversionCount }, (_, index) => (
            buildVariantDirection(index, 'conversion', input.productType, input.styleKeywords, input.agentDecision)
        ))
    };
}

function buildBlockers(status: MainImageProjectStyleStrategyStatus): string[] {
    if (status === 'blocked_missing_project_images') return ['main_image_project_images_missing'];
    if (status === 'needs_vision') return ['main_image_project_style_vision_required'];
    return [];
}

function buildWarnings(input: {
    status: MainImageProjectStyleStrategyStatus;
    referenceHintCount: number;
    agentDecision?: MainImageAgentDesignDecision | null;
}): string[] {
    const warnings: string[] = [];
    if (input.status === 'needs_vision') {
        warnings.push('已有项目图片 metadata，但还没有真实看图或人工标注，不能判断袜子款式和设计方向。');
    }
    if (input.status === 'ready_visual_grounded' && !input.agentDecision) {
        warnings.push('已有视觉 grounding，但缺少模型 Agent 设计决策；风格、视觉 hook、背景和文案角度只能保持待决策。');
    }
    if (input.referenceHintCount === 0) {
        warnings.push('尚未执行参考搜索；只能输出参考搜索计划，不能声称已参考优秀案例。');
    }
    return warnings;
}

export function buildMainImageProjectStyleStrategyEvidence(
    input: MainImageProjectStyleStrategyInput
): MainImageProjectStyleStrategyEvidence {
    const projectAssets = normalizeAssets(input.projectAssets);
    const selectedAsset = getSelectedAsset(input);
    const visualGrounding = getVisualGrounding(input.visionSignal);
    const visualGrounded = hasVisualGrounding(input.visionSignal);
    const agentDecision = normalizeAgentDecision(input.visionSignal?.agentDecision);
    const status = getStatus({ assetCount: projectAssets.length + (selectedAsset ? 1 : 0), visualGrounded });
    const productType = visualGrounded
        ? cleanString(input.visionSignal?.productType) || 'unknown'
        : 'unknown';
    const subjectSummary = visualGrounded
        ? cleanString(input.visionSignal?.subjectSummary) || 'visual signal present; subject summary missing'
        : 'unknown';
    const styleKeywords = visualGrounded ? buildStyleKeywords(input.visionSignal) : [];
    const referenceHints = normalizeReferenceHints(input.referenceHints);
    const clickCount = clampCount(input.desiredClickImageCount, 2, 6);
    const conversionCount = clampCount(input.desiredConversionImageCount, 2, 6);
    const variantPlan = buildVariants({
        status,
        productType,
        styleKeywords,
        clickCount,
        conversionCount,
        agentDecision
    });
    const objectives: MainImageDesignObjective[] = [];
    if (variantPlan.clickImages.length > 0) objectives.push('click-image');
    if (variantPlan.conversionImages.length > 0) objectives.push('conversion-image');

    return {
        version: 'main-image-project-style-strategy/v0',
        skillId: 'main-image-design',
        scene: 'ecommerce-socks',
        status,
        projectStyleUnderstanding: {
            productType,
            subjectSummary,
            visualGrounding,
            assetCount: projectAssets.length,
            selectedAssetName: cleanOptionalString(selectedAsset?.name),
            selectedAssetPath: cleanOptionalString(selectedAsset?.path),
            semanticStatus: status === 'blocked_missing_project_images'
                ? 'missing'
                : visualGrounded ? 'visual_grounded' : 'needs_vision'
        },
        designDirection: {
            objectives,
            styleKeywords,
            recommendedTone: visualGrounded
                ? agentDecision?.recommendedTone || 'pending-agent-design-decision'
                : 'pending-vision',
            designPrinciples: buildDesignPrinciples(visualGrounded)
        },
        agentDesignDecision: agentDecision,
        referenceResearchPlan: {
            status: referenceHints.length > 0 ? 'reference_hints_available' : 'planned_not_run',
            querySeeds: buildQuerySeeds({ productType, styleKeywords, agentDecision }),
            referenceHintCount: referenceHints.length,
            references: referenceHints,
            boundary: '参考搜索结果只能作为外部知识 evidence，不能替代看图理解、Photoshop 执行或设计质量验收。'
        },
        variantPlan,
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        blockers: buildBlockers(status),
        warnings: buildWarnings({ status, referenceHintCount: referenceHints.length, agentDecision }),
        limitations: [
            '项目款式策略只消费图片 metadata、视觉模型结果、模型 Agent 决策或人工标注，不直接读取像素、不调用 provider、不执行 Photoshop。',
            '没有真实视觉 grounding 时，不能判断袜子款式、材质、罗口、图案和最佳设计方向。',
            '风格关键词、视觉 hook、背景方向和文案角度必须来自 visionSignal.styleHints / agentDecision / 人工标注，不能由代码根据关键词猜测。',
            '点击图/转化图方案是可执行前的方向计划，不是已生成图片或已通过验收的设计结果。'
        ],
        evidence: [{
            source: 'main-image-project-style-strategy',
            summary: `status=${status}; productType=${productType}; click=${variantPlan.clickImages.length}; conversion=${variantPlan.conversionImages.length}; references=${referenceHints.length}`,
            status: status === 'ready_visual_grounded' ? 'ready' : status === 'needs_vision' ? 'needs_review' : 'failed'
        }]
    };
}
