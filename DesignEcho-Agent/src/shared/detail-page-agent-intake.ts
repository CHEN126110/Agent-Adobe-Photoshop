import type { DetailPageSkillReadiness } from './detail-page-skill-readiness';
import type { DetailPageSkillProjectContext } from './detail-page-skill-readiness';
import type { RuntimeDesignBriefDeclaration } from './agent-runtime-v5/runtime-design-brief-declaration';
import { buildDetailPageSkillReadiness } from './detail-page-skill-readiness';

export type DetailPageAgentMode = 'inspect' | 'execute';
export type DetailPageEditContentMode = 'image_only' | 'copy_only' | 'both';
export type DetailPageAgentRecommendedAction =
    | 'inspect_template'
    | 'execute_with_review'
    | 'request_context'
    | 'stop';
export type DetailPageAgentResultStatus = 'completed' | 'needs_review' | 'blocked' | 'failed';

export interface DetailPageAgentIntakeInput {
    params?: Record<string, any> | null;
    context?: {
        userInput?: string;
        projectContext?: any;
        photoshopContext?: any;
        hasAttachedImage?: boolean;
        attachedImages?: unknown[];
    } | null;
    runtimeDesignBriefDeclaration?: RuntimeDesignBriefDeclaration;
}

export interface DetailPageAgentIntake {
    intakeVersion: 'detail-page-agent-intake/v0';
    mode: DetailPageAgentMode;
    canStart: boolean;
    recommendedAction: DetailPageAgentRecommendedAction;
    params: Record<string, any>;
    blockers: string[];
    warnings: string[];
    requiredNextChecks: string[];
    readiness: DetailPageSkillReadiness;
    userIntent: string;
    projectPath: string;
    workMode: string;
    editContentMode: DetailPageEditContentMode | '';
    identityIssue?: {
        code: 'runtime_work_mode_identity_mismatch';
        declaredWorkMode: string;
        requestedWorkMode: string;
    };
    agentReadableText: string;
}

export interface DetailPageAgentResultSummaryInput {
    intake: DetailPageAgentIntake;
    runtime: {
        success?: boolean;
        reviewLevel?: string;
        screenCount?: number;
        successCount?: number;
        failCount?: number;
        exportFileCount?: number;
        blockers?: string[];
        warnings?: string[];
    };
}

export interface DetailPageAgentResultSummary {
    summaryVersion: 'detail-page-agent-result-summary/v0';
    status: DetailPageAgentResultStatus;
    recommendedAction: DetailPageAgentRecommendedAction;
    nextStep: string;
    agentReadableText: string;
    blockers: string[];
    warnings: string[];
}

const INSPECT_PATTERN = /(检查|分析|结构|模板|看一下|看看|复核|诊断|inspect|review|analy[sz]e|structure)/iu;
const EXECUTE_PATTERN = /(设计|填充|生成|制作|整理|处理|换图|排版|出图|导出|切片|design|fill|generate|export)/iu;
const EXPORT_PATTERN = /(导出|出图|切片|输出|export|slice)/iu;

function normalizeText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function unique(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => normalizeText(value)).filter(Boolean)));
}

function toNumber(value: unknown): number {
    const numberValue = Number(value || 0);
    return Number.isFinite(numberValue) ? numberValue : 0;
}

function resolveMode(params: Record<string, any>, userIntent: string): DetailPageAgentMode {
    const explicitAgentMode = normalizeText(params.agentMode || params.mode || '').toLowerCase();
    if (explicitAgentMode === 'inspect') return 'inspect';
    if (explicitAgentMode === 'execute' || explicitAgentMode === 'export') return 'execute';
    if (params.inspectOnly === true || normalizeText(params.structureMode).toLowerCase() === 'inspect') return 'inspect';

    const asksExecute = EXECUTE_PATTERN.test(userIntent);
    const asksInspect = INSPECT_PATTERN.test(userIntent);
    if (asksInspect && !asksExecute) return 'inspect';
    return 'execute';
}

function normalizeWorkMode(value: unknown): string {
    const normalized = normalizeText(value).toLowerCase();
    return [
        'create_new',
        'redesign',
        'template_fill',
        'edit_existing',
        'analyze_only',
        'export_only'
    ].includes(normalized)
        ? normalized
        : '';
}

function resolveDetailPageExportSlices(input: {
    params: Record<string, any>;
    userIntent: string;
    workMode: string;
    mode: DetailPageAgentMode;
}): boolean {
    if (input.mode === 'inspect' || input.workMode === 'analyze_only') return false;

    // Runtime-owned workMode 是交付义务的唯一主事实。完整生产模式不要求用户额外说出
    // “导出/切片”关键词；否则一句自然的“帮我做详情页”会只改画面却不形成交付物。
    if (
        input.workMode === 'create_new'
        || input.workMode === 'redesign'
        || input.workMode === 'template_fill'
        || input.workMode === 'export_only'
    ) {
        return true;
    }

    // edit_existing 的契约只承诺保存当前变更，不默认重做整套切片。只有用户/Agent
    // 明确把切片加入本轮目标时才扩展为 raster 交付。
    if (input.workMode === 'edit_existing') {
        return input.params.exportSlices === true
            || input.params.autoExport === true
            || normalizeText(input.params.agentMode || input.params.mode).toLowerCase() === 'export'
            || EXPORT_PATTERN.test(input.userIntent);
    }

    // 未取得 Runtime workMode 时不臆造完整生产义务；只保留显式参数兼容。
    return input.params.exportSlices === true
        || input.params.autoExport === true
        || normalizeText(input.params.agentMode || input.params.mode).toLowerCase() === 'export';
}

function resolveRuntimeOwnedWorkMode(input: {
    params: Record<string, any>;
    declaration?: RuntimeDesignBriefDeclaration;
}): {
    workMode: string;
    requestedWorkMode: string;
    declaredWorkMode: string;
    conflict: boolean;
} {
    const requestedWorkMode = normalizeWorkMode(
        input.params.workMode || input.params.declaredWorkMode
    );
    const declaredWorkMode = normalizeWorkMode(input.declaration?.payload.workMode);
    return {
        workMode: declaredWorkMode || requestedWorkMode,
        requestedWorkMode,
        declaredWorkMode,
        conflict: Boolean(
            declaredWorkMode
            && requestedWorkMode
            && declaredWorkMode !== requestedWorkMode
        )
    };
}

export function normalizeDetailPageEditContentMode(value: unknown): DetailPageEditContentMode | '' {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === 'image_only') return 'image_only';
    if (normalized === 'copy_only') return 'copy_only';
    if (normalized === 'both') return 'both';
    return '';
}

function hasValue(value: unknown): boolean {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value as object).length > 0;
    return normalizeText(value).length > 0;
}

function coverageIsProvided(
    declaration: RuntimeDesignBriefDeclaration | undefined,
    inputKey: string
): boolean {
    return declaration?.payload.inputCoverage.some((item) => (
        item.inputKey === inputKey && item.status === 'provided'
    )) === true;
}

export function buildDetailPageAgentProjectContext(input: {
    params?: Record<string, any> | null;
    context?: DetailPageAgentIntakeInput['context'];
    runtimeDesignBriefDeclaration?: RuntimeDesignBriefDeclaration;
    projectPath?: string;
}): DetailPageSkillProjectContext {
    const params = input.params || {};
    const context = input.context || {};
    const projectContext = context.projectContext || {};
    const projectPath = normalizeText(input.projectPath || params.projectPath || projectContext.projectPath);
    const assetIndex = projectContext?.assetIndex || {};
    const visualSamplingPlan = projectContext?.visualSamplingPlan || {};
    const visualInsightCache = projectContext?.visualInsightCache || {};
    const declaration = input.runtimeDesignBriefDeclaration;
    const workMode = resolveRuntimeOwnedWorkMode({ params, declaration }).workMode;
    const attachedImageCount = Array.isArray(context.attachedImages)
        ? context.attachedImages.length
        : context.hasAttachedImage === true ? 1 : 0;
    const targetScope = params.targetScope ?? params.target_scope;
    const requestedChange = params.requestedChange ?? params.requested_change;
    const editContentMode = normalizeDetailPageEditContentMode(
        params.editContentMode ?? params.edit_content_mode
    );
    const contentSource = params.contentSource ?? params.content_source;
    const existingDocument = params.existingDocument ?? params.existing_document;
    return {
        workMode,
        projectPathKnown: Boolean(projectPath || projectContext?.projectPath),
        assetImageCount: toNumber(assetIndex?.summary?.totalImages),
        visualCandidateCount: toNumber(assetIndex?.visionCandidates?.length),
        selectedCandidateCount: toNumber(visualSamplingPlan?.selectedCandidates?.length),
        visualInsightCount: toNumber(visualInsightCache?.summary?.entriesWithInsight),
        shouldAnalyzeCount: toNumber(visualSamplingPlan?.cacheSummary?.shouldAnalyze),
        attachedImageCount,
        contentSourceAvailable: hasValue(contentSource)
            || attachedImageCount > 0
            || coverageIsProvided(declaration, 'content_source'),
        existingDocumentAvailable: hasValue(existingDocument)
            || context.photoshopContext?.hasDocument === true
            || coverageIsProvided(declaration, 'existing_document'),
        targetScopeAvailable: hasValue(targetScope),
        requestedChangeAvailable: hasValue(requestedChange)
            || coverageIsProvided(declaration, 'requested_change'),
        editContentModeAvailable: Boolean(editContentMode)
    };
}

function normalizeParams(input: {
    params: Record<string, any>;
    mode: DetailPageAgentMode;
    userIntent: string;
    projectPath: string;
    workMode: string;
}): Record<string, any> {
    const { params, mode, userIntent, projectPath, workMode } = input;
    const exportSlices = resolveDetailPageExportSlices({
        params,
        userIntent,
        workMode,
        mode
    });
    const targetScope = params.targetScope ?? params.target_scope;
    const requestedChange = params.requestedChange ?? params.requested_change;
    const editContentMode = normalizeDetailPageEditContentMode(
        params.editContentMode ?? params.edit_content_mode
    );
    const contentSource = params.contentSource ?? params.content_source;
    const existingDocument = params.existingDocument ?? params.existing_document;
    return {
        ...params,
        userIntent,
        projectPath: normalizeText(params.projectPath) || projectPath,
        ...(workMode ? { workMode } : {}),
        ...(hasValue(targetScope) ? { targetScope } : {}),
        ...(hasValue(requestedChange) ? { requestedChange } : {}),
        ...(editContentMode ? { editContentMode } : {}),
        ...(hasValue(contentSource) ? { contentSource } : {}),
        ...(hasValue(existingDocument) ? { existingDocument } : {}),
        inspectOnly: mode === 'inspect',
        structureMode: mode === 'inspect'
            ? 'inspect'
            : (normalizeText(params.structureMode) || 'guided'),
        autoFix: mode === 'execute' && workMode !== 'edit_existing'
            ? params.autoFix !== false
            : false,
        planGuard: params.planGuard !== false,
        allowLowConfidenceFill: params.allowLowConfidenceFill === true,
        visualValidation: mode === 'execute'
            ? (params.visualValidation || (exportSlices ? 'screenshots' : 'snapshot'))
            : false,
        exportSlices,
        reviewPolicy: normalizeText(params.reviewPolicy) || 'review_required'
    };
}

function buildAgentReadableIntakeText(input: {
    mode: DetailPageAgentMode;
    canStart: boolean;
    recommendedAction: DetailPageAgentRecommendedAction;
    blockers: string[];
    warnings: string[];
}): string {
    const modeText = input.mode === 'inspect' ? '检查详情页模板结构' : '执行详情页设计/填充';
    if (!input.canStart) {
        return `${modeText}暂不能开始：${input.blockers[0] || '缺少必要上下文。'}`;
    }
    if (input.warnings.length > 0) {
        return `${modeText}可以开始，但需要复核：${input.warnings[0]}`;
    }
    return `${modeText}可以开始，建议动作：${input.recommendedAction}。`;
}

export function buildDetailPageAgentIntake(input: DetailPageAgentIntakeInput): DetailPageAgentIntake {
    const params = { ...(input.params || {}) };
    const context = input.context || {};
    if (
        !hasValue(params.contentSource ?? params.content_source)
        && (context.hasAttachedImage === true || (context.attachedImages?.length || 0) > 0)
    ) {
        params.contentSource = 'attached_image';
    }
    if (
        !hasValue(params.existingDocument ?? params.existing_document)
        && context.photoshopContext?.hasDocument === true
    ) {
        params.existingDocument = context.photoshopContext.documentName
            || context.photoshopContext.documentId
            || 'active_photoshop_document';
    }
    if (
        !hasValue(params.targetScope ?? params.target_scope)
        && coverageIsProvided(input.runtimeDesignBriefDeclaration, 'target_scope')
        && (
            hasValue(context.photoshopContext?.activeLayerName)
            || Number(context.photoshopContext?.activeLayerId || 0) > 0
        )
    ) {
        params.targetScope = context.photoshopContext.activeLayerName
            || context.photoshopContext.activeLayerId;
    }
    if (
        !hasValue(params.requestedChange ?? params.requested_change)
        && coverageIsProvided(input.runtimeDesignBriefDeclaration, 'requested_change')
    ) {
        params.requestedChange = input.runtimeDesignBriefDeclaration?.payload.taskGoal;
    }
    const userIntent = normalizeText(params.userIntent || context.userInput);
    const projectContext = context.projectContext || {};
    const projectPath = normalizeText(params.projectPath || projectContext.projectPath);
    const mode = resolveMode(params, userIntent);
    const workModeResolution = resolveRuntimeOwnedWorkMode({
        params,
        declaration: input.runtimeDesignBriefDeclaration
    });
    const workMode = workModeResolution.workMode;
    const normalizedParams = normalizeParams({ params, mode, userIntent, projectPath, workMode });
    const editContentMode = normalizeDetailPageEditContentMode(normalizedParams.editContentMode);

    const readiness = buildDetailPageSkillReadiness({
        mode,
        template: null,
        project: buildDetailPageAgentProjectContext({
            params: normalizedParams,
            context,
            runtimeDesignBriefDeclaration: input.runtimeDesignBriefDeclaration,
            projectPath
        }),
        imagePlacementCoreAvailable: true,
        verificationToolsAvailable: true
    });

    const identityIssue = workModeResolution.conflict
        ? {
            code: 'runtime_work_mode_identity_mismatch' as const,
            declaredWorkMode: workModeResolution.declaredWorkMode,
            requestedWorkMode: workModeResolution.requestedWorkMode
        }
        : undefined;
    const blockers = mode === 'execute'
        ? unique([
            ...(identityIssue
                ? [`Runtime 已锁定 workMode=${identityIssue.declaredWorkMode}，本次 Skill 参数不得切换为 ${identityIssue.requestedWorkMode}。`]
                : []),
            ...readiness.sections.projectVisualContext.blockers
        ])
        : [];
    const warnings = mode === 'execute'
        ? unique([
            ...readiness.sections.projectVisualContext.warnings,
            ...readiness.sections.imagePlacement.warnings,
            ...readiness.sections.verification.warnings
        ])
        : [];
    const requiredNextChecks = mode === 'execute'
        ? unique(readiness.sections.projectVisualContext.requiredNextChecks)
        : [];
    const canStart = mode === 'inspect' || blockers.length === 0;
    const recommendedAction: DetailPageAgentRecommendedAction = mode === 'inspect'
        ? 'inspect_template'
        : canStart
            ? 'execute_with_review'
            : 'request_context';

    return {
        intakeVersion: 'detail-page-agent-intake/v0',
        mode,
        canStart,
        recommendedAction,
        params: normalizedParams,
        blockers,
        warnings,
        requiredNextChecks,
        readiness,
        userIntent,
        projectPath,
        workMode,
        editContentMode,
        ...(identityIssue ? { identityIssue } : {}),
        agentReadableText: buildAgentReadableIntakeText({
            mode,
            canStart,
            recommendedAction,
            blockers,
            warnings
        })
    };
}

export function buildDetailPageAgentResultSummary(
    input: DetailPageAgentResultSummaryInput
): DetailPageAgentResultSummary {
    const runtime = input.runtime || {};
    const failCount = toNumber(runtime.failCount);
    const screenCount = toNumber(runtime.screenCount);
    const successCount = toNumber(runtime.successCount);
    const exportFileCount = toNumber(runtime.exportFileCount);
    const blockers = unique(runtime.blockers || input.intake.blockers);
    const warnings = unique(runtime.warnings || input.intake.warnings);
    const reviewLevel = normalizeText(runtime.reviewLevel);
    const status: DetailPageAgentResultStatus = runtime.success === false || failCount > 0
        ? (failCount > 0 ? 'needs_review' : 'failed')
        : reviewLevel && reviewLevel !== 'ok'
            ? 'needs_review'
            : 'completed';
    const nextStep = status === 'completed'
        ? (exportFileCount > 0 ? '确认导出文件和页面视觉效果。' : '复核当前 PSD 中每屏内容和图片区落位。')
        : status === 'needs_review'
            ? '复核失败屏、降级填充屏和图片落位风险后再继续。'
            : blockers[0] || '补齐详情页执行所需上下文后再继续。';

    return {
        summaryVersion: 'detail-page-agent-result-summary/v0',
        status,
        recommendedAction: status === 'completed'
            ? 'execute_with_review'
            : status === 'needs_review'
                ? 'execute_with_review'
                : 'request_context',
        nextStep,
        agentReadableText: `详情页处理结果：${successCount}/${screenCount || successCount} 屏完成，失败 ${failCount} 屏，复核状态 ${status}。${exportFileCount > 0 ? `导出 ${exportFileCount} 个文件。` : ''}`,
        blockers,
        warnings
    };
}
