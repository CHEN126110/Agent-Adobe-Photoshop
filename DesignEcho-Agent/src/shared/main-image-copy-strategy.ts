import {
    buildCopywritingContextChecklist,
    COPYWRITING_TEMPLATES,
    type CopywritingTemplateId
} from './design-copywriting-framework';
import type {
    MainImageProjectStyleStrategy
} from './main-image-project-style-strategy';

export type MainImageCopyStrategyStatus =
    | 'blocked_missing_project_style_strategy'
    | 'blocked_missing_visual_context'
    | 'needs_copy_candidates'
    | 'needs_copy_assignment'
    | 'needs_text_slot_plan'
    | 'ready_copy_strategy';

export type MainImageCopyCandidateRole =
    | 'click-headline'
    | 'conversion-benefit'
    | 'supporting-note';

export interface MainImageCopyCandidate {
    id: string;
    role: MainImageCopyCandidateRole;
    text: string;
    targetImageType: 'click' | 'conversion';
    supportNotes: string[];
    safetyNotes: string[];
}

export interface MainImageTextSlotPlan {
    id: string;
    role: MainImageCopyCandidateRole;
    targetImageType: 'click' | 'conversion';
    maxLines: number;
    maxChars: number;
    priority: 'primary' | 'secondary';
    fitPolicy: string;
}

export interface MainImageProductCopyContext {
    productType: string;
    subjectSummary: string;
    visualAnchors: string[];
    productFacts: string[];
    userScenes: string[];
    userProblems: string[];
    referenceNotes: string[];
}

export interface MainImageCopyStrategy {
    version: 'main-image-copy-strategy/v0';
    skillId: 'main-image-design';
    scene: 'ecommerce-socks';
    status: MainImageCopyStrategyStatus;
    productCopyContext: MainImageProductCopyContext;
    contextChecklist: ReturnType<typeof buildCopywritingContextChecklist>;
    recommendedTemplates: Array<{
        id: CopywritingTemplateId;
        name: string;
        reason: string;
    }>;
    /** Agent 已给出文字但尚未声明用途 /目标图时，只能停在这里，不能按数组顺序分配角色。 */
    pendingCandidateTexts: string[];
    candidates: MainImageCopyCandidate[];
    textSlotPlan: MainImageTextSlotPlan[];
    strategyInputPatch: {
        copyRolePolicy?: Record<string, unknown>;
    };
    canClaimOutputQuality: false;
    canClaimDesignComplete: false;
    noPhotoshopWrites: true;
    mustNotExecutePhotoshop: true;
    blockers: string[];
    warnings: string[];
    limitations: string[];
}

export interface BuildMainImageCopyStrategyInput {
    userText?: string;
    projectStyleStrategy?: MainImageProjectStyleStrategy | null;
    copyCandidates?: string[];
    candidateAssignments?: MainImageCopyCandidate[];
    textSlotPlan?: MainImageTextSlotPlan[];
    recommendedTemplateIds?: CopywritingTemplateId[];
    confirmedProductFacts?: string[];
    confirmedUserScenes?: string[];
    confirmedUserProblems?: string[];
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

function uniqueClean(values: unknown[]): string[] {
    return Array.from(new Set(values.map(cleanString).filter(Boolean)));
}

function isVisualContextReady(styleStrategy: MainImageProjectStyleStrategy | null | undefined): boolean {
    return styleStrategy?.status === 'ready_visual_context'
        && styleStrategy.projectStyleUnderstanding.semanticStatus === 'visual_context_ready';
}

function buildVisualAnchors(styleStrategy: MainImageProjectStyleStrategy | null | undefined): string[] {
    if (!isVisualContextReady(styleStrategy)) return [];
    return uniqueClean([
        styleStrategy?.projectStyleUnderstanding.subjectSummary,
        ...styleStrategy?.designDirection.styleKeywords || []
    ]);
}

function buildReferenceNotes(styleStrategy: MainImageProjectStyleStrategy | null | undefined): string[] {
    return uniqueClean((styleStrategy?.referenceResearchPlan.references || []).map((reference) => (
        [
            reference.title,
            reference.source,
            reference.note
        ].map(cleanString).filter(Boolean).join(' / ')
    )));
}

function buildRecommendedTemplates(
    declaredIds: CopywritingTemplateId[] | undefined
): MainImageCopyStrategy['recommendedTemplates'] {
    const ids = Array.from(new Set(Array.isArray(declaredIds) ? declaredIds : [])).slice(0, 4);
    return ids
        .map((id) => COPYWRITING_TEMPLATES.find((template) => template.id === id))
        .filter((template): template is NonNullable<typeof template> => Boolean(template))
        .map((template) => ({
            id: template.id,
            name: template.name,
            reason: template.suitableFor
        }));
}

function buildCandidateSupport(context: MainImageProductCopyContext): string[] {
    return uniqueClean([
        ...context.productFacts,
        ...context.visualAnchors.map((anchor) => `视觉观察：${anchor}`),
        ...context.userScenes.map((scene) => `已确认使用场景：${scene}`),
        ...context.userProblems.map((problem) => `已确认用户顾虑：${problem}`)
    ]).slice(0, 8);
}

function normalizeCandidateAssignments(input: {
    context: MainImageProductCopyContext;
    candidateAssignments?: MainImageCopyCandidate[];
}): MainImageCopyCandidate[] {
    if (!Array.isArray(input.candidateAssignments)) return [];
    const roles = new Set<MainImageCopyCandidateRole>([
        'click-headline', 'conversion-benefit', 'supporting-note'
    ]);
    return input.candidateAssignments.flatMap((candidate, index) => {
        const text = cleanString(candidate?.text);
        const role = candidate?.role;
        const targetImageType = candidate?.targetImageType;
        if (!text || !roles.has(role) || !['click', 'conversion'].includes(targetImageType)) return [];
        return [{
            id: cleanString(candidate.id) || `agent-copy-${index + 1}`,
            role,
            text,
            targetImageType,
            supportNotes: uniqueClean([
                ...(candidate.supportNotes || []),
                ...buildCandidateSupport(input.context)
            ]).slice(0, 8),
            safetyNotes: uniqueClean(candidate.safetyNotes || []).slice(0, 6)
        }];
    }).slice(0, 8);
}

function normalizeTextSlotPlan(value: MainImageTextSlotPlan[] | undefined): MainImageTextSlotPlan[] {
    if (!Array.isArray(value)) return [];
    const roles = new Set<MainImageCopyCandidateRole>([
        'click-headline', 'conversion-benefit', 'supporting-note'
    ]);
    return value.flatMap((slot) => {
        const id = cleanString(slot?.id);
        const maxLines = Math.round(Number(slot?.maxLines));
        const maxChars = Math.round(Number(slot?.maxChars));
        if (!id || !roles.has(slot?.role) || !['click', 'conversion'].includes(slot?.targetImageType)
            || !Number.isFinite(maxLines) || maxLines <= 0
            || !Number.isFinite(maxChars) || maxChars <= 0
            || !['primary', 'secondary'].includes(slot?.priority)) {
            return [];
        }
        return [{
            id,
            role: slot.role,
            targetImageType: slot.targetImageType,
            maxLines,
            maxChars,
            priority: slot.priority,
            fitPolicy: cleanString(slot.fitPolicy)
        }];
    }).slice(0, 8);
}

function buildContext(input: {
    styleStrategy?: MainImageProjectStyleStrategy | null;
    confirmedProductFacts?: string[];
    confirmedUserScenes?: string[];
    confirmedUserProblems?: string[];
}): MainImageProductCopyContext {
    const productType = isVisualContextReady(input.styleStrategy)
        ? cleanString(input.styleStrategy?.projectStyleUnderstanding.productType) || 'unknown'
        : 'unknown';
    const subjectSummary = isVisualContextReady(input.styleStrategy)
        ? cleanString(input.styleStrategy?.projectStyleUnderstanding.subjectSummary) || 'unknown'
        : 'unknown';
    return {
        productType,
        subjectSummary,
        visualAnchors: buildVisualAnchors(input.styleStrategy),
        productFacts: uniqueClean(input.confirmedProductFacts || []).slice(0, 12),
        userScenes: uniqueClean(input.confirmedUserScenes || []).slice(0, 8),
        userProblems: uniqueClean(input.confirmedUserProblems || []).slice(0, 8),
        referenceNotes: buildReferenceNotes(input.styleStrategy)
    };
}

function resolveStatus(input: {
    styleStrategy?: MainImageProjectStyleStrategy | null;
    pendingCandidateCount: number;
    assignedCandidateCount: number;
    textSlotCount: number;
}): MainImageCopyStrategyStatus {
    if (!input.styleStrategy) return 'blocked_missing_project_style_strategy';
    if (!isVisualContextReady(input.styleStrategy)) return 'blocked_missing_visual_context';
    if (input.pendingCandidateCount === 0 && input.assignedCandidateCount === 0) return 'needs_copy_candidates';
    if (input.assignedCandidateCount === 0) return 'needs_copy_assignment';
    if (input.textSlotCount === 0) return 'needs_text_slot_plan';
    return 'ready_copy_strategy';
}

function buildBlockers(status: MainImageCopyStrategyStatus): string[] {
    if (status === 'blocked_missing_project_style_strategy') return ['main_image_project_style_strategy_required'];
    if (status === 'blocked_missing_visual_context') return ['main_image_visual_context_required_for_copy'];
    return [];
}

function buildWarnings(input: {
    status: MainImageCopyStrategyStatus;
    context: MainImageProductCopyContext;
    copyCandidateCount: number;
}): string[] {
    const warnings: string[] = [];
    if (input.status === 'needs_copy_candidates') {
        warnings.push('已有视觉上下文但没有 Agent 声明的候选文案；保持 pending，不创建默认标题或卖点。');
    }
    if (input.status === 'needs_copy_assignment') {
        warnings.push('已有候选文字，但 Agent 尚未声明每条文字的角色和目标图；不能按数组顺序自动分配。');
    }
    if (input.status === 'needs_text_slot_plan') {
        warnings.push('已有 Agent 分配的文案候选，但尚未声明文字槽位；不能补默认行数、字数或层级。');
    }
    if (input.context.referenceNotes.length === 0) {
        warnings.push('没有参考来源记录；可生成本地文案策略，但不能声称已经参考竞品案例。');
    }
    if (input.context.userProblems.length === 0) {
        warnings.push('没有明确痛点依据；转化图文案只能写视觉事实或请求补充卖点。');
    }
    if (input.copyCandidateCount === 0) {
        warnings.push('缺少候选文案；不得临场编造强卖点。');
    }
    return warnings;
}

function buildStrategyInputPatch(input: {
    status: MainImageCopyStrategyStatus;
    context: MainImageProductCopyContext;
    recommendedTemplates: MainImageCopyStrategy['recommendedTemplates'];
    pendingCandidateTexts: string[];
    candidates: MainImageCopyCandidate[];
    textSlotPlan: MainImageTextSlotPlan[];
}): MainImageCopyStrategy['strategyInputPatch'] {
    return {
        copyRolePolicy: {
            copyStrategyStatus: input.status,
            copyCandidateCount: input.candidates.length,
            claimCount: input.context.productFacts.length + input.context.userProblems.length,
            referenceCount: input.context.referenceNotes.length,
            recommendedTemplateIds: input.recommendedTemplates.map((template) => template.id),
            pendingCandidateCount: input.pendingCandidateTexts.length,
            textSlotRoles: input.textSlotPlan.map((slot) => slot.role),
            productCopyContext: input.context,
            candidateSupport: input.candidates.map((candidate) => ({
                id: candidate.id,
                role: candidate.role,
                targetImageType: candidate.targetImageType,
                supportNoteCount: candidate.supportNotes.length
            })),
            boundary: 'copy strategy can guide editable text slots, but does not write text layers or prove final copy quality'
        }
    };
}

export function buildMainImageCopyStrategy(
    input: BuildMainImageCopyStrategyInput
): MainImageCopyStrategy {
    const pendingCandidateTexts = uniqueClean(input.copyCandidates || []).slice(0, 8);
    const context = buildContext({
        styleStrategy: input.projectStyleStrategy,
        confirmedProductFacts: input.confirmedProductFacts,
        confirmedUserScenes: input.confirmedUserScenes,
        confirmedUserProblems: input.confirmedUserProblems
    });
    const candidates = normalizeCandidateAssignments({
        context,
        candidateAssignments: input.candidateAssignments
    });
    const textSlotPlan = normalizeTextSlotPlan(input.textSlotPlan);
    const status = resolveStatus({
        styleStrategy: input.projectStyleStrategy,
        pendingCandidateCount: pendingCandidateTexts.length,
        assignedCandidateCount: candidates.length,
        textSlotCount: textSlotPlan.length
    });
    const contextChecklist = buildCopywritingContextChecklist({
        hasImage: isVisualContextReady(input.projectStyleStrategy),
        hasTargetAudience: false,
        hasAudienceInterest: context.userScenes.length > 0 || context.userProblems.length > 0,
        hasVisualAnchors: context.visualAnchors.length > 0,
        hasProductFacts: context.productFacts.length > 0,
        hasUserScene: context.userScenes.length > 0,
        hasProductProblem: context.userProblems.length > 0
    });
    const recommendedTemplates = buildRecommendedTemplates(input.recommendedTemplateIds);
    const blockers = buildBlockers(status);
    const warnings = buildWarnings({
        status,
        context,
        copyCandidateCount: pendingCandidateTexts.length + candidates.length
    });

    return {
        version: 'main-image-copy-strategy/v0',
        skillId: 'main-image-design',
        scene: 'ecommerce-socks',
        status,
        productCopyContext: context,
        contextChecklist,
        recommendedTemplates,
        pendingCandidateTexts,
        candidates,
        textSlotPlan,
        strategyInputPatch: buildStrategyInputPatch({
            status,
            context,
            recommendedTemplates,
            pendingCandidateTexts,
            candidates,
            textSlotPlan
        }),
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        blockers,
        warnings,
        limitations: [
            '主图文案策略只投影 Agent 已声明的候选 /槽位与已确认事实；缺失项保持 pending，不调用模型补写。',
            '候选文案必须继续经过文本溢出、遮挡和最终人工/截图复核，不能仅凭策略声明可投放。',
            '参考来源只作为写作方向，不能替代项目摄影图和商品事实。'
        ]
    };
}
