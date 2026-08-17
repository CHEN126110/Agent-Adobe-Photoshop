import type { AgentResult } from '../unified-agent.service';
import type {
    DetailPageEditContentMode,
    DetailScreenPlan,
    FillPlan,
    LayerIssue,
    ParsedScreen
} from './detail-page.types';
import type { DetailProjectAsset } from './detail-page-asset-ranker';
import type { SkillExecuteParams, SkillExecutor } from './types';
import type { DesignProjectState } from '../../../shared/types/design-project-state.types';

import {
    executeToolCall,
    readTrustedDetailPageProjectAssetsFromAnalysis
} from '../tool-executor.service';
import { readAgentVisualObservation } from '../agent-runtime/visual-observation-strategy';
import { isRuntimeVisualReviewBlocked } from '../../../shared/design-discipline-runtime';
import { useAppStore } from '../../stores/app.store';
import { analyzeDetailImageAnchors } from './detail-page-plan-utils';
import {
    auditDetailCopyLayoutForScreens as auditDetailCopyLayout
} from '../../../shared/detail-page-copy-layout-audit';
import {
    normalizeDetailFlatLayers,
    reconstructDetailPlacementsFromHierarchy
} from '../../../shared/detail-page-live-placement';
import {
    buildDetailPageDesignAgentOsRecord,
    type DetailPageScreenPlanInput
} from '../../../shared/design-agent-os-contracts';
import {
    buildDetailPageSkillReadiness,
    type DetailPageSkillProjectContext,
    type DetailPageSkillReadiness,
    type DetailPageSkillTemplateContext
} from '../../../shared/detail-page-skill-readiness';
import {
    buildDetailPageAgentProjectContext,
    buildDetailPageAgentIntake,
    buildDetailPageAgentResultSummary,
    type DetailPageAgentIntake
} from '../../../shared/detail-page-agent-intake';
import {
    formatDesignDocumentRole,
    inferDesignDocumentRoleFromName,
    isKnownNonDetailPageRole
} from '../../../shared/design-document-role';
import {
    buildDetailPageVersionPatch,
    selectDetailPageScreensForStateRedo
} from '../../../shared/detail-page-state-consumption';
import {
    buildDetailPageContentFactCatalog,
    buildDetailPageContentVerification,
    type DetailPageContentVerification
} from '../../../shared/detail-page-content-verification';
import {
    buildDetailPageLiveReadback,
    verifyDetailPageLiveObservationVersion
} from '../../../shared/detail-page-live-readback';
import { buildDetailPageVisualObservationBundle } from '../../../shared/detail-page-visual-observation';
import { buildDetailPagePlannerContext } from './design-planner-context';
import {
    buildDetailExecutionSummary as buildExecutionSummary,
    buildDetailPageDeliveryCandidate,
    buildDetailPageVisualRepairToolAllowlist,
    buildDetailInspectionSummary as buildInspectionSummary,
    buildDetailTemplateState,
    collectDetailPageEditableLayerIds,
    type DetailPageCopyPlanningInput,
    formatDetailScreenPlanLine as formatScreenPlanLine,
    planDetailPageContent,
    prepareDetailScreenExecutionPlan,
    resolveDetailPageExplicitTargetScreens,
    resolveDetailExecutionReviewLevel,
    resolveDetailExecutionScope,
    scopeDetailPageFillPlanToEditContentMode,
    scopeDetailPageFillPlanToTargetLayers,
    scopeDetailPageScreenToEditContentMode,
    scopeDetailPageScreenToTargetLayers,
    verifyDetailPageOutOfScopeScreensUnchanged,
    verifyDetailPageOutOfScopeSnapshotsUnchanged
} from './detail-page-design.skill';
import { emitSkillStep, executeObservedSkillTool } from './skill-step-events';

function clamp01(value: number, fallback: number): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(0, Math.min(1, value));
}

function shouldExportFromRequest(params: Record<string, any>, context?: SkillExecuteParams['context']): boolean {
    if (params.exportSlices === true || params.autoExport === true) return true;
    const intent = String(params.userIntent || context?.userInput || '').toLowerCase();
    return ['导出', '输出', '切片', 'export'].some((keyword) => intent.includes(keyword));
}

function shouldCaptureScreenSnapshots(params: Record<string, any>): boolean {
    if (params.includeScreenSnapshots === true) return true;
    if (params.includeScreenSnapshots === false || params.visualValidation === false) return false;
    if (params.visualValidation === true || params.visualValidation === undefined) return true;
    const visualValidation = String(params.visualValidation || '').trim().toLowerCase();
    return visualValidation === 'snapshot' || visualValidation === 'screenshots';
}

function omitDetailFillPlanImagePayloads(plan: FillPlan): FillPlan {
    return {
        ...plan,
        images: (plan.images || []).map((image) => {
            const { imageData: _imageData, ...safeImage } = image;
            return safeImage;
        })
    };
}

function buildDetailProjectAssetsFromAnalysis(result: any): { images: DetailProjectAsset[] } | undefined {
    return readTrustedDetailPageProjectAssetsFromAnalysis(result);
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.round(parsed)));
}

function uniqueTextParts(values: unknown[], limit = 10): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        if (!text || seen.has(text)) continue;
        seen.add(text);
        result.push(text);
        if (result.length >= limit) break;
    }
    return result;
}

function resolveLowScoreCopyStrategy(value: unknown): DetailPageCopyPlanningInput['lowScoreCopyStrategy'] {
    if (value === 'flag' || value === 'keep') return value;
    return 'replace';
}

function buildDetailPageCopyPlanningInput(params: {
    skillParams: Record<string, any>;
    state: DesignProjectState | null;
    screenPlans: DetailScreenPlan[];
    runtimeDesignBriefDeclaration?: SkillExecuteParams['runtimeDesignBriefDeclaration'];
    runtimeDesignStrategyDeclaration?: SkillExecuteParams['runtimeDesignStrategyDeclaration'];
}): DetailPageCopyPlanningInput {
    const brief = params.runtimeDesignBriefDeclaration?.payload;
    const strategy = params.runtimeDesignStrategyDeclaration?.payload;
    const factCatalog = buildDetailPageContentFactCatalog({ state: params.state });
    const copyFacts = factCatalog.map((fact) => ({
        ref: fact.ref,
        statement: fact.statement,
        confirmation: fact.sourceStrength
    }));
    const targetAudience = uniqueTextParts([
        params.skillParams.targetAudience,
        strategy?.objective?.targetAudienceSummary,
        brief?.targetAudience,
        params.state?.targetUser
    ], 4).join('；');
    const brandTone = uniqueTextParts([
        params.state?.brandStyle,
        ...(strategy?.copyDirection?.toneKeywords || []),
        params.skillParams.brandTone
    ], 8).join('；') || '专业、自然、可信';
    const creativeStyle = String(params.skillParams.copyCreativeStyle || 'natural').trim() || 'natural';
    const strategyMessages = uniqueTextParts([
        strategy?.messageArchitecture?.primaryMessage,
        ...(strategy?.messageArchitecture?.supportingMessages || []),
        ...(strategy?.messageArchitecture?.supportingFacts || [])
    ], 12);
    const visualIntent = uniqueTextParts([
        params.state?.visualDirection,
        ...(strategy?.visualDirection?.moodKeywords || []),
        ...(strategy?.visualDirection?.compositionIntent || []),
        ...(strategy?.visualDirection?.imageTreatment || []),
        ...(strategy?.visualDirection?.typographyIntent || [])
    ], 12).join('；');
    const screenDirectives = params.screenPlans.map((plan, index) => {
        const decidedMessage = !plan.requiresModelDecision && !String(plan.mainMessage || '').includes('待模型')
            ? plan.mainMessage
            : '';
        const supportingMessage = strategyMessages.length > 1
            ? strategyMessages[1 + (index % (strategyMessages.length - 1))]
            : '';
        const objective = uniqueTextParts([
            decidedMessage,
            strategyMessages[0],
            supportingMessage,
            `围绕本屏「${plan.screenName}」的${plan.screenRole}职责建立独立信息任务`
        ], 4).join('；');
        return {
            screenId: plan.screenId,
            screenName: plan.screenName,
            objective,
            visualIntent: visualIntent || `服从本屏${plan.visualPriority}视觉优先级并保持整页一致`
        };
    });

    return {
        copyContext: {
            facts: copyFacts,
            audience: targetAudience,
            brandTone,
            creativeStyle,
            screenDirectives
        },
        copyFacts,
        targetAudience,
        aiCopyGeneration: params.skillParams.aiCopyGeneration !== false,
        copyReview: params.skillParams.copyReview !== false,
        copyMinScore: clamp01(Number(params.skillParams.copyMinScore), 0.72),
        copyCandidateCount: clampInteger(params.skillParams.copyCandidateCount, 3, 2, 5),
        copyCreativeStyle: creativeStyle,
        lowScoreCopyStrategy: resolveLowScoreCopyStrategy(params.skillParams.lowScoreCopyStrategy),
        copyLayoutFit: params.skillParams.copyLayoutFit !== false,
        copyLineBreakStyle: String(params.skillParams.copyLineBreakStyle || 'balanced'),
        copyTitleMaxLines: clampInteger(params.skillParams.copyTitleMaxLines, 2, 1, 4),
        copySubtitleMaxLines: clampInteger(params.skillParams.copySubtitleMaxLines, 2, 1, 5),
        copyBodyMaxLines: clampInteger(params.skillParams.copyBodyMaxLines, 3, 1, 8),
        copyOnly: params.skillParams.copyOnly === true,
        brandTone,
        screenCopyDirectives: screenDirectives
    };
}

type DetailCopyPlanningGap =
    | 'confirmed_product_fact_required'
    | 'copy_provider_unavailable'
    | 'copy_provider_retryable'
    | 'candidate_unavailable';

function resolveUnresolvedGeneratedCopy(
    screen: ParsedScreen,
    plan: FillPlan,
    requireGeneratedCopy: boolean
): DetailCopyPlanningGap | null {
    if (!requireGeneratedCopy || (screen.copyPlaceholders?.length || 0) === 0) return null;
    const copyByLayerId = new Map((plan.copies || []).map((copy) => [Number(copy.layerId || 0), copy]));
    let unresolved: DetailCopyPlanningGap | null = null;
    for (const placeholder of screen.copyPlaceholders || []) {
        const copy = copyByLayerId.get(Number(placeholder.layerId || 0));
        const invalid = !copy
            || !String(copy.content || '').trim()
            || copy.source === 'template'
            || copy.generationStatus === 'failed'
            || copy.generationStatus === 'template';
        if (!invalid) continue;
        if (copy?.generationReason === 'confirmed-product-fact-required') {
            return 'confirmed_product_fact_required';
        }
        if (copy?.generationReason === 'copy-provider-unavailable') {
            return 'copy_provider_unavailable';
        }
        if (
            copy?.generationReason === 'copy-provider-request-failed'
            || copy?.generationReason === 'copy-provider-response-invalid'
        ) {
            return 'copy_provider_retryable';
        }
        unresolved = 'candidate_unavailable';
    }
    return unresolved;
}

type DetailScreenSnapshotVerification = {
    status: 'passed' | 'needs_review' | 'failed';
    requested: boolean;
    expectedScreenCount: number;
    capturedScreenCount: number;
    failedScreenCount: number;
    expectedScreenIds: number[];
    capturedScreenIds: number[];
    missingScreenIds: number[];
    foreignScreenIds: number[];
    duplicateScreenIds: number[];
    unidentifiedSnapshotCount: number;
    snapshots: any[];
    errors: any[];
    message: string;
};

function readSnapshotCollection(result: any, key: 'snapshots' | 'errors'): any[] {
    const primaryCandidates = [
        result?.[key],
        result?.data?.[key],
        result?.result?.[key],
        result?.output?.[key]
    ];
    const compatibilityCandidates = key === 'snapshots'
        ? [
            result?.screens,
            result?.images,
            result?.data?.screenSnapshots,
            result?.data?.screens,
            result?.result?.screens,
            result?.output?.screens
        ]
        : [
            result?.failedScreens,
            result?.data?.failedScreens,
            result?.result?.failedScreens
        ];
    const candidates = [...primaryCandidates, ...compatibilityCandidates];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) return candidate;
    }
    return [];
}

function buildDetailScreenSnapshotVerification(input: {
    requested: boolean;
    expectedScreens: readonly ParsedScreen[];
    result?: any;
}): DetailScreenSnapshotVerification {
    const expectedScreenIds = Array.from(new Set(input.expectedScreens
        .map((screen) => Math.round(Number(screen.id) || 0))
        .filter((screenId) => screenId > 0)));
    const expectedScreenIdSet = new Set(expectedScreenIds);
    const expectedScreenCount = expectedScreenIds.length;
    if (!input.requested) {
        return {
            status: 'needs_review',
            requested: false,
            expectedScreenCount,
            capturedScreenCount: 0,
            failedScreenCount: 0,
            expectedScreenIds,
            capturedScreenIds: [],
            missingScreenIds: expectedScreenIds,
            foreignScreenIds: [],
            duplicateScreenIds: [],
            unidentifiedSnapshotCount: 0,
            snapshots: [],
            errors: [],
            message: '本次明确关闭了屏级截图，画面质量仍需后续复核。'
        };
    }
    const snapshots = readSnapshotCollection(input.result, 'snapshots');
    const errors = readSnapshotCollection(input.result, 'errors');
    const capturedScreenIds = new Set<number>();
    const foreignScreenIds = new Set<number>();
    const duplicateScreenIds = new Set<number>();
    const snapshotCountByScreenId = new Map<number, number>();
    let unidentifiedSnapshotCount = 0;
    snapshots.forEach((snapshot) => {
        if (!snapshot || typeof snapshot !== 'object') return;
        const screenId = Math.round(Number(snapshot.screenId) || 0);
        if (!expectedScreenIdSet.has(screenId)) return;
        const snapshotCount = (snapshotCountByScreenId.get(screenId) || 0) + 1;
        snapshotCountByScreenId.set(screenId, snapshotCount);
        if (snapshotCount > 1) duplicateScreenIds.add(screenId);
    });
    snapshots.forEach((snapshot) => {
        if (!snapshot
            || typeof snapshot !== 'object'
            || String(snapshot.base64 || snapshot.imageData || '').length === 0) {
            return;
        }
        const screenId = Math.round(Number(snapshot.screenId) || 0);
        if (screenId <= 0) {
            unidentifiedSnapshotCount++;
            return;
        }
        if (!expectedScreenIdSet.has(screenId)) {
            foreignScreenIds.add(screenId);
            return;
        }
        capturedScreenIds.add(screenId);
    });
    const capturedScreenCount = capturedScreenIds.size;
    const missingScreenIds = expectedScreenIds.filter((screenId) => !capturedScreenIds.has(screenId));
    const toolSucceeded = input.result?.success !== false
        && input.result?.data?.success !== false
        && input.result?.result?.success !== false;
    if (!toolSucceeded || capturedScreenCount === 0) {
        return {
            status: 'failed',
            requested: true,
            expectedScreenCount,
            capturedScreenCount,
            failedScreenCount: Math.max(1, errors.length, expectedScreenCount - capturedScreenCount),
            expectedScreenIds,
            capturedScreenIds: Array.from(capturedScreenIds),
            missingScreenIds,
            foreignScreenIds: Array.from(foreignScreenIds),
            duplicateScreenIds: Array.from(duplicateScreenIds),
            unidentifiedSnapshotCount,
            snapshots,
            errors,
            message: String(
                input.result?.error
                || input.result?.data?.error
                || input.result?.result?.error
                || '没有取得可供视觉复核的屏级截图。'
            )
        };
    }
    const failedScreenCount = Math.max(
        errors.length,
        missingScreenIds.length
            + foreignScreenIds.size
            + duplicateScreenIds.size
            + unidentifiedSnapshotCount
    );
    if (
        failedScreenCount > 0
        || capturedScreenCount < expectedScreenCount
        || foreignScreenIds.size > 0
        || duplicateScreenIds.size > 0
        || unidentifiedSnapshotCount > 0
    ) {
        return {
            status: 'needs_review',
            requested: true,
            expectedScreenCount,
            capturedScreenCount,
            failedScreenCount,
            expectedScreenIds,
            capturedScreenIds: Array.from(capturedScreenIds),
            missingScreenIds,
            foreignScreenIds: Array.from(foreignScreenIds),
            duplicateScreenIds: Array.from(duplicateScreenIds),
            unidentifiedSnapshotCount,
            snapshots,
            errors,
            message: `已取得 ${capturedScreenCount}/${expectedScreenCount} 个目标屏截图；缺失 ${missingScreenIds.length} 屏、重复 ${duplicateScreenIds.size} 屏、错误 ${errors.length} 项、其他身份异常 ${foreignScreenIds.size + unidentifiedSnapshotCount} 项。`
        };
    }
    return {
        // 截图成功只证明“眼睛拿到了像素”，不证明画面已经被模型看过并通过。
        // 当前工具结果会在 Skill 返回后由通用 Agent 视觉通道逐屏回填；工具自身不得伪造视觉裁决。
        status: 'needs_review',
        requested: true,
        expectedScreenCount,
        capturedScreenCount,
        failedScreenCount: 0,
        expectedScreenIds,
        capturedScreenIds: Array.from(capturedScreenIds),
        missingScreenIds: [],
        foreignScreenIds: [],
        duplicateScreenIds: [],
        unidentifiedSnapshotCount: 0,
        snapshots,
        errors,
        message: `已取得 ${capturedScreenCount}/${expectedScreenCount} 个目标屏截图，等待 Agent 逐屏查看真实画面后再决定修复或交付。`
    };
}

function buildContentVerificationMessages(
    verification: DetailPageContentVerification
): { blockers: string[]; warnings: string[] } {
    const unsupported = verification.summary.unsupportedCopyCount;
    const failedScreens = verification.summary.failedScreenCount;
    const reviewScreens = verification.summary.needsReviewScreenCount;
    const blockers = verification.status === 'failed'
        ? [`内容事实校验失败：${failedScreens} 屏无法形成可交付文案，${unsupported} 条文案缺少可靠依据。`]
        : [];
    const warnings = verification.status === 'needs_review'
        ? [`内容事实校验待复核：${reviewScreens} 屏、${unsupported} 条文案需要补充或确认事实依据。`]
        : [];
    return { blockers, warnings };
}

function buildFailureResult(message: string, error: string, toolResults: any[], data?: any): AgentResult {
    return {
        success: false,
        message,
        error,
        toolResults,
        data
    };
}

const DETAIL_PAGE_CREATE_NEW_HANDOFF_TOOLS = [
    'getDetailPageDesignFramework',
    'getDesignPrinciples',
    'searchDesignKnowledge',
    'listProjectResources',
    'searchProjectResources',
    'analyzeProjectForDetailPage',
    'analyzeAssetContent',
    'recommendAssets',
    'searchEagleReferences',
    'measureReferenceComposition',
    'generateImage',
    'getDocumentInfo',
    'getLayerHierarchy',
    'findLayers',
    'createDocument',
    'renderLayout',
    'placeImage',
    'fitLayerSubjectToRegion',
    'moveLayer',
    'transformLayer',
    'createTextLayer',
    'getCanvasSnapshot',
    'getAnnotatedSnapshot',
    'getScreenSnapshots'
] as const;

function buildDetailPageCreateNewHandoffResult(input: {
    intake: DetailPageAgentIntake;
    toolResults: any[];
    reason: string;
    diagnostics?: Record<string, unknown>;
}): AgentResult {
    const summary = '当前没有可复用模板，已切换到详情页从零设计能力面；主 Agent 将继续理解素材、规划分屏并在 Photoshop 中完成首稿与复核。';
    return {
        success: true,
        message: summary,
        skillOutcome: {
            version: 'skill-execution-outcome/v0',
            status: 'executed',
            summary,
            outputs: ['已确定使用从零设计路径，尚未把任务误报为完成。'],
            blockers: [],
            warnings: input.intake.warnings,
            sourceStatus: 'delegated_autonomous_create_new'
        },
        toolResults: input.toolResults,
        data: {
            status: 'delegated_autonomous_create_new',
            workMode: 'create_new',
            runtimeActionProviderHandoff: {
                version: 'runtime-action-provider-handoff/v0',
                disposition: 'decompose_to_atomic_actions',
                reason: input.reason,
                boundaries: {
                    sameGoal: true,
                    noMutationCredit: true,
                    noTaskCompletionCredit: true,
                    requiresR4Replan: true
                }
            },
            detailPageAgentIntake: input.intake,
            templateFallbackDiagnostics: {
                version: 'detail-page-template-fallback-diagnostics/v0',
                reason: input.reason,
                ...(input.diagnostics || {})
            },
            agentReActContinuation: {
                status: 'needs_decision',
                summary,
                details: [
                    input.reason,
                    '先形成产品理解、卖点顺序与逐屏计划，再创建长画布并分屏执行；每次写后读取真实画面。'
                ],
                blockers: [],
                warnings: input.intake.warnings,
                nextAction: 'decide_next',
                sourceStatus: 'delegated_autonomous_create_new',
                recovery: {
                    mode: 'allowlist',
                    purpose: 'execute',
                    allowedToolNames: [...DETAIL_PAGE_CREATE_NEW_HANDOFF_TOOLS],
                    reason: '模板路径不适用；仅开放详情页从零设计所需的知识、素材、Photoshop 原子执行与视觉观察能力。'
                }
            }
        }
    };
}

function countExportedDetailFiles(exportResult: any): number {
    const candidates = [
        exportResult?.files,
        exportResult?.exports,
        exportResult?.slices,
        exportResult?.exportedFiles,
        exportResult?.results
    ];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) return candidate.length;
    }
    const count = Number(exportResult?.count || exportResult?.fileCount || 0);
    return Number.isFinite(count) ? Math.max(0, count) : 0;
}

function filterScreenPlansByScreens(screenPlans: DetailScreenPlan[], screens: ParsedScreen[]): DetailScreenPlan[] {
    const screenIds = new Set((screens || []).map((screen) => Number(screen.id || 0)));
    return (screenPlans || []).filter((plan) => screenIds.has(Number(plan.screenId || 0)));
}

function shouldUseStateReviewRedoScope(params: Record<string, any>, userInput: string): boolean {
    if (params.redoFromStateReview === true || params.onlyReviewIssues === true) return true;
    const text = String(userInput || params.userIntent || '').toLowerCase();
    if (!text) return false;
    const asksRevision = /(重做|返工|修改|修复|修一下|调整|优化|redo|revise|fix)/i.test(text);
    const detailScope = /(详情|detail|屏|这一屏|这屏|问题|复核|review)/i.test(text);
    return asksRevision && detailScope;
}

function extractOpenPhotoshopDocuments(result: any): Array<{ name: string; isActive?: boolean }> {
    const candidates = [
        result?.documents,
        result?.openDocuments,
        result?.data?.documents,
        result?.data?.openDocuments,
        result?.result?.documents
    ];
    for (const candidate of candidates) {
        if (!Array.isArray(candidate)) continue;
        return candidate
            .map((item) => ({
                name: String(item?.name || item?.documentName || item?.title || '').trim(),
                isActive: item?.isActive === true
            }))
            .filter((item) => item.name);
    }
    return [];
}

function pickDetailPageDocumentName(documents: Array<{ name: string; isActive?: boolean }>): string {
    const exact = documents.find((doc) => inferDesignDocumentRoleFromName(doc.name) === 'detailPage');
    return exact?.name || '';
}

async function readDesignProjectStateForDetailPage(
    projectPath: string,
    results: Array<Record<string, unknown>>
): Promise<DesignProjectState | null> {
    if (!projectPath || typeof window === 'undefined') return null;
    const designEcho = (window as any).designEcho;
    if (!designEcho?.getDesignState) return null;
    try {
        const state = await designEcho.getDesignState(projectPath);
        results.push({
            toolName: 'getDesignProjectState[detail-page]',
            result: {
                success: true,
                hasState: Boolean(state),
                copywritingCount: Array.isArray(state?.copywriting) ? state.copywriting.length : 0,
                sellingPointCount: Array.isArray(state?.sellingPoints) ? state.sellingPoints.length : 0,
                hasVisualDirection: Boolean(state?.visualDirection)
            }
        });
        return state || null;
    } catch (error: any) {
        results.push({
            toolName: 'getDesignProjectState[detail-page]',
            result: {
                success: false,
                error: error?.message || String(error)
            }
        });
        return null;
    }
}

async function appendDetailPageVersionRecord(params: {
    projectPath: string;
    action: 'fill' | 'export' | 'screen-redo';
    screens: ParsedScreen[];
    reason?: string;
    exportedFileCount?: number;
    results: Array<Record<string, unknown>>;
}) {
    if (!params.projectPath || typeof window === 'undefined') return null;
    const patch = buildDetailPageVersionPatch({
        action: params.action,
        screens: params.screens,
        reason: params.reason,
        exportedFileCount: params.exportedFileCount
    });
    if (!patch) return null;
    const designEcho = (window as any).designEcho;
    if (!designEcho?.updateDesignState) return null;
    try {
        const result = await designEcho.updateDesignState(params.projectPath, patch);
        params.results.push({
            toolName: `updateDesignProjectState[detail-page:${params.action}]`,
            result
        });
        return result;
    } catch (error: any) {
        const result = {
            success: false,
            error: error?.message || String(error)
        };
        params.results.push({
            toolName: `updateDesignProjectState[detail-page:${params.action}]`,
            result
        });
        return result;
    }
}

function buildDetailPageScreenPlanInputs(
    screenPlans: DetailScreenPlan[],
    fillPlans: FillPlan[] = [],
    resultByScreenId: Map<number, string> = new Map()
): DetailPageScreenPlanInput[] {
    const fillPlanByScreenId = new Map<number, FillPlan>();
    for (const fillPlan of fillPlans || []) {
        const screenId = Number((fillPlan as any)?.screenId || 0);
        if (screenId) fillPlanByScreenId.set(screenId, fillPlan);
    }
    return (screenPlans || []).map((plan) => {
        const screenId = Number((plan as any)?.screenId || 0);
        const fillPlan = fillPlanByScreenId.get(screenId) as any;
        const visualSummary = (plan as any)?.visualSummary || {};
        const riskCount = [
            visualSummary.boundaryRisk === 'risky',
            Array.isArray((plan as any)?.risks) && (plan as any).risks.length > 0
        ].filter(Boolean).length;
        return {
            screenId: String(screenId || (plan as any)?.screenName || 'unknown'),
            role: String((plan as any)?.screenRole || (plan as any)?.role || ''),
            decisionSource: String((plan as any)?.decisionSource || 'unknown'),
            requiresModelDecision: Boolean((plan as any)?.requiresModelDecision),
            riskCount,
            plannedCopyCount: Array.isArray(fillPlan?.copies) ? fillPlan.copies.length : undefined,
            plannedImageCount: Array.isArray(fillPlan?.images) ? fillPlan.images.length : undefined,
            resultStatus: resultByScreenId.get(screenId)
        };
    });
}

function buildDetailPageProjectReadinessContext(
    context: SkillExecuteParams['context'],
    projectPath: string
): DetailPageSkillProjectContext {
    const projectContext = context?.projectContext;
    const assetIndex = projectContext?.assetIndex;
    const visualSamplingPlan = projectContext?.visualSamplingPlan;
    const visualInsightCache = projectContext?.visualInsightCache;

    return {
        projectPathKnown: Boolean(projectPath || projectContext?.projectPath),
        assetImageCount: Number(assetIndex?.summary.totalImages || 0),
        visualCandidateCount: Number(assetIndex?.visionCandidates.length || 0),
        selectedCandidateCount: Number(visualSamplingPlan?.selectedCandidates.length || 0),
        visualInsightCount: Number(visualInsightCache?.summary.entriesWithInsight || 0),
        shouldAnalyzeCount: Number(visualSamplingPlan?.cacheSummary.shouldAnalyze || 0)
    };
}

function buildDetailPageTemplateReadinessContext(input: {
    parseResult?: any;
    screens?: ParsedScreen[];
    issues?: LayerIssue[];
    crossScreenRiskCount?: number;
    readiness?: { mode?: string; metrics?: Record<string, any> };
}): DetailPageSkillTemplateContext {
    const metrics = input.readiness?.metrics || {};
    const screens = input.screens || [];
    const issues = input.issues || [];

    return {
        parseSuccess: input.parseResult?.success === true,
        screenCount: Number(input.parseResult?.screenCount || screens.length || 0),
        readinessMode: input.readiness?.mode || undefined,
        issueCount: Number(issues.length || 0),
        crossScreenRiskCount: Number(input.crossScreenRiskCount || 0),
        copyPlaceholderCount: Number(metrics.copyPlaceholderCount || 0),
        imagePlaceholderCount: Number(metrics.imagePlaceholderCount || 0)
    };
}

function buildDetailPageSkillReadinessContext(input: {
    inspectOnly: boolean;
    parseResult?: any;
    screens?: ParsedScreen[];
    issues?: LayerIssue[];
    crossScreenRiskCount?: number;
    readiness?: { mode?: string; metrics?: Record<string, any> };
    context: SkillExecuteParams['context'];
    projectPath: string;
    projectReadiness?: DetailPageSkillProjectContext;
}): DetailPageSkillReadiness {
    return buildDetailPageSkillReadiness({
        mode: input.inspectOnly ? 'inspect' : 'execute',
        template: buildDetailPageTemplateReadinessContext({
            parseResult: input.parseResult,
            screens: input.screens,
            issues: input.issues,
            crossScreenRiskCount: input.crossScreenRiskCount,
            readiness: input.readiness
        }),
        project: input.projectReadiness
            || buildDetailPageProjectReadinessContext(input.context, input.projectPath),
        imagePlacementCoreAvailable: true,
        verificationToolsAvailable: true
    });
}

export const detailPageExecutor: SkillExecutor = {
    skillId: 'detail-page-design',

    async execute({
        params,
        callbacks,
        signal,
        context,
        runtimeDesignBriefDeclaration,
        runtimeDesignStrategyDeclaration
    }: SkillExecuteParams): Promise<AgentResult> {
        const startedAt = Date.now();
        const results: any[] = [];
        const phaseDurations: Record<string, number> = {};
        const markPhaseDuration = (name: string, phaseStartedAt: number) => {
            phaseDurations[name] = Math.max(0, Date.now() - phaseStartedAt);
        };

        const report = (message: string, percent: number, options?: { thinking?: boolean; assistant?: boolean }) => {
            callbacks?.onProgress?.(message, percent);
            if (options?.thinking !== false) {
                callbacks?.onStatus?.(message);
            }
            if (options?.assistant === true) {
                callbacks?.onMessage?.(message);
            }
        };
        const emitStep = (
            kind: Parameters<typeof emitSkillStep>[1]['kind'],
            title: string,
            detail?: string,
            status: Parameters<typeof emitSkillStep>[1]['status'] = 'running',
            percent?: number
        ) => emitSkillStep(callbacks, { kind, title, detail, status, percent });
        const callTool = (toolName: string, toolParams: Record<string, any>, detail?: string) => {
            return executeObservedSkillTool(callbacks, toolName, toolParams, executeToolCall, detail);
        };

        const detailPageAgentIntake: DetailPageAgentIntake = buildDetailPageAgentIntake({
            params,
            context,
            runtimeDesignBriefDeclaration
        });
        params = {
            ...(params || {}),
            ...detailPageAgentIntake.params
        };
        const detailPageAgentProjectReadiness = buildDetailPageAgentProjectContext({
            params,
            context,
            runtimeDesignBriefDeclaration,
            projectPath: detailPageAgentIntake.projectPath
        });
        const blockedIntakeResultSummary = () => buildDetailPageAgentResultSummary({
            intake: detailPageAgentIntake,
            runtime: {
                success: false,
                blockers: detailPageAgentIntake.blockers,
                warnings: detailPageAgentIntake.warnings
            }
        });

        if (!detailPageAgentIntake.canStart) {
            const detailPageAgentResultSummary = blockedIntakeResultSummary();
            emitStep(
                'warning',
                '详情页执行上下文不足',
                detailPageAgentIntake.agentReadableText,
                'error',
                0.04
            );
            callbacks?.onStatus?.(detailPageAgentIntake.agentReadableText);
            return buildFailureResult(
                detailPageAgentIntake.agentReadableText,
                detailPageAgentIntake.identityIssue?.code || 'detail_page_agent_intake_blocked',
                results,
                {
                    detailPageAgentIntake,
                    detailPageAgentResultSummary,
                    detailPageSkillReadiness: detailPageAgentIntake.readiness
                }
            );
        }

        const projectPath = String(params.projectPath || context?.projectContext?.projectPath || '').trim();
        const userInputForOs = String(params.userIntent || context?.userInput || '').trim();
        const workMode = String(detailPageAgentIntake.workMode || params.workMode || '').trim().toLowerCase();
        const editContentMode = detailPageAgentIntake.editContentMode as DetailPageEditContentMode | '';
        const attachedContentImages = String(params.contentSource || '').trim().toLowerCase() === 'attached_image'
            && Array.isArray(context?.attachedImages)
            ? context.attachedImages
            : [];
        const inspectOnly = params.inspectOnly === true || String(params.structureMode || '').toLowerCase() === 'inspect';
        const autoFix = !inspectOnly && params.autoFix !== false;
        const usePlanGuard = params.planGuard !== false;
        const allowLowConfidenceFill = params.allowLowConfidenceFill === true;
        const minPlanConfidence = clamp01(Number(params.minPlanConfidence), 0.62);
        const minImageCoverage = clamp01(Number(params.minImageCoverage), 0.6);

        if (workMode === 'create_new') {
            const reason = '结构化 workMode=create_new；跳过模板解析器，避免把无模板创作误判为模板失败。';
            emitStep(
                'observation',
                '进入详情页从零设计',
                reason,
                'running',
                0.05
            );
            return buildDetailPageCreateNewHandoffResult({
                intake: detailPageAgentIntake,
                toolResults: results,
                reason
            });
        }

        const currentDocumentName = String(context?.photoshopContext?.documentName || '').trim();
        const currentDocumentRole = inferDesignDocumentRoleFromName(currentDocumentName);
        if (currentDocumentName && isKnownNonDetailPageRole(currentDocumentRole)) {
            const roleLabel = formatDesignDocumentRole(currentDocumentRole);
            emitStep(
                'observation',
                '当前文档不是详情页',
                `当前 Photoshop 文档是「${currentDocumentName}」，按名称识别为${roleLabel}文档；详情页技能需要先切换到详情页文档。`,
                'running',
                0.05
            );
            const openDocumentsResult = await callTool('listDocuments', { includeDetails: true }, '查找是否已有打开的详情页文档。');
            results.push({ toolName: 'listDocuments[detailDocumentRole]', result: openDocumentsResult });
            const detailDocumentName = pickDetailPageDocumentName(extractOpenPhotoshopDocuments(openDocumentsResult));

            if (detailDocumentName) {
                emitStep(
                    'tool_started',
                    '切换到详情页文档',
                    `已找到「${detailDocumentName}」，先切换文档再继续详情页解析。`,
                    'running',
                    0.07
                );
                const switchResult = await callTool('switchDocument', { documentName: detailDocumentName }, `切换到详情页文档：${detailDocumentName}`);
                results.push({ toolName: 'switchDocument[detailDocumentRole]', result: switchResult });
                if (!switchResult?.success) {
                    const message = `当前是${roleLabel}文档「${currentDocumentName}」，并且切换到详情页文档「${detailDocumentName}」失败。`;
                    emitStep('warning', '详情页文档切换失败', message, 'error', 0.08);
                    return buildFailureResult(
                        message,
                        'detail_page_document_switch_failed',
                        results,
                        {
                            currentDocumentName,
                            currentDocumentRole,
                            targetDocumentName: detailDocumentName
                        }
                    );
                }
            } else {
                const message = `当前是${roleLabel}文档「${currentDocumentName}」，没有找到已打开的详情页文档；详情页技能不会在非详情页文档上继续执行。`;
                if (!workMode) {
                    emitStep(
                        'observation',
                        '没有可复用详情页文档',
                        '当前文档不属于详情页且没有其他详情页文档，交回主 Agent 走从零设计，不在错误文档上写入。',
                        'running',
                        0.08
                    );
                    return buildDetailPageCreateNewHandoffResult({
                        intake: detailPageAgentIntake,
                        toolResults: results,
                        reason: message
                    });
                }
                const detailPageAgentResultSummary = buildDetailPageAgentResultSummary({
                    intake: detailPageAgentIntake,
                    runtime: {
                        success: false,
                        blockers: [message],
                        warnings: detailPageAgentIntake.warnings
                    }
                });
                emitStep('warning', '未找到详情页文档', message, 'error', 0.08);
                return buildFailureResult(
                    message,
                    'detail_page_document_role_mismatch',
                    results,
                    {
                        detailPageAgentIntake,
                        detailPageAgentResultSummary,
                        currentDocumentName,
                        currentDocumentRole
                    }
                );
            }
        }

        const designProjectState = await readDesignProjectStateForDetailPage(projectPath, results);

        try {
            const buildTemplateState = async (
                nextScreens: ParsedScreen[],
                nextIssues: LayerIssue[],
                crossScreenRiskCount: number
            ) => buildDetailTemplateState({
                screens: nextScreens,
                issues: nextIssues,
                crossScreenRiskCount,
                runTool: executeToolCall,
                results,
                designProjectState,
                visualInsightCache: context?.projectContext?.visualInsightCache || null
            });

            const templatePhaseStartedAt = Date.now();
            emitStep(
                'observation',
                '准备执行详情页技能',
                inspectOnly ? '当前请求为模板结构检查，不执行填充。' : '当前请求会解析模板、规划内容并按屏填充。',
                'running',
                0.04
            );
            report('先检查当前详情页模板结构。', 0.08);
            let parseResult = await callTool('parseDetailPageTemplate', { includeStructure: true }, '读取详情页屏结构、占位符和跨屏图层风险。');
            results.push({ toolName: 'parseDetailPageTemplate', result: parseResult });

            if (!parseResult?.success) {
                // 解析失败最常见的语境是 Photoshop 没有打开文档：UXP 工具此时返回
                // success:false 且 documentName/documentSize 全空，但不带 error 字段——
                // 必须翻译成用户能行动的指引，而不是「未知错误」。
                const noDocumentContext = !parseResult?.documentName
                    && !(Number(parseResult?.documentSize?.width) > 0);
                const failureReason = parseResult?.error
                    || (noDocumentContext
                        ? 'Photoshop 当前没有打开的文档。请先在 Photoshop 中打开详情页模板（PSD/PSB），再重新发起请求。'
                        : 'parseDetailPageTemplate 未返回成功状态，且没有给出失败原因；请检查当前文档是否是详情页模板结构。');
                if (!workMode) {
                    emitStep(
                        'observation',
                        '没有识别到可复用模板',
                        '已完成模板探测但当前没有可用模板，交回主 Agent 继续从零设计。',
                        'running',
                        0.1
                    );
                    return buildDetailPageCreateNewHandoffResult({
                        intake: detailPageAgentIntake,
                        toolResults: results,
                        reason: failureReason
                    });
                }
                const detailPageSkillReadiness = buildDetailPageSkillReadinessContext({
                    inspectOnly,
                    parseResult,
                    context,
                    projectPath,
                    projectReadiness: detailPageAgentProjectReadiness
                });
                const detailPageAgentResultSummary = buildDetailPageAgentResultSummary({
                    intake: detailPageAgentIntake,
                    runtime: {
                        success: false,
                        blockers: [`详情页模板解析失败: ${failureReason}`],
                        warnings: detailPageAgentIntake.warnings
                    }
                });
                emitStep(
                    'warning',
                    '详情页模板解析失败',
                    failureReason,
                    'error',
                    0.1
                );
                return buildFailureResult(
                    `详情页模板解析失败: ${failureReason}`,
                    failureReason,
                    results,
                    { detailPageAgentIntake, detailPageAgentResultSummary, detailPageSkillReadiness }
                );
            }

            // 按用户尺寸规范评估文档宽度（提示性检查，不拦截执行——多尺寸版本工作流见规范说明）
            try {
                const { normalizeDesignDimensionSpec, evaluateDetailPageDocumentWidth } =
                    await import('../../../shared/design-dimension-spec');
                const widthSpec = normalizeDesignDimensionSpec(useAppStore.getState().designDimensionSpec);
                const widthEvaluation = evaluateDetailPageDocumentWidth(widthSpec, Number(parseResult?.documentSize?.width) || 0);
                emitStep(
                    widthEvaluation.ok ? 'observation' : 'warning',
                    widthEvaluation.ok ? '文档宽度符合尺寸规范' : '文档宽度不在尺寸规范内',
                    widthEvaluation.hint,
                    'success',
                    0.1
                );
            } catch (error: any) {
                console.warn(`[DetailPage] 尺寸规范评估失败（不影响执行）：${error?.message || error}`);
            }

            let screens: ParsedScreen[] = parseResult.screens || [];
            if (screens.length === 0) {
                if (!workMode) {
                    emitStep(
                        'observation',
                        '模板没有可用屏结构',
                        '当前文档不能作为可靠模板，交回主 Agent 走从零设计，不把空模板判成整单失败。',
                        'running',
                        0.1
                    );
                    return buildDetailPageCreateNewHandoffResult({
                        intake: detailPageAgentIntake,
                        toolResults: results,
                        reason: '模板解析成功但没有识别到可用屏结构。'
                    });
                }
                const detailPageSkillReadiness = buildDetailPageSkillReadinessContext({
                    inspectOnly,
                    parseResult,
                    screens,
                    context,
                    projectPath,
                    projectReadiness: detailPageAgentProjectReadiness
                });
                const detailPageAgentResultSummary = buildDetailPageAgentResultSummary({
                    intake: detailPageAgentIntake,
                    runtime: {
                        success: false,
                        blockers: ['当前文档没有识别到可用的详情页屏结构。'],
                        warnings: detailPageAgentIntake.warnings
                    }
                });
                emitStep('warning', '详情页模板解析无可用屏', '当前文档没有识别到详情页屏结构。', 'error', 0.1);
                return buildFailureResult(
                    '当前文档没有识别到可用的详情页屏结构。',
                    'No parsed screens',
                    results,
                    { detailPageAgentIntake, detailPageAgentResultSummary, detailPageSkillReadiness }
                );
            }

            emitStep(
                'verification',
                '详情页模板解析完成',
                `识别到 ${screens.length} 屏，跨屏图层风险 ${Array.isArray(parseResult.crossScreenLayers) ? parseResult.crossScreenLayers.length : 0} 个。`,
                'success',
                0.12
            );
            callbacks?.onStatus?.(`已识别到 ${screens.length} 屏，先检查结构问题和可自动化程度。`);
            report('正在评估模板是否适合自动化。', 0.16, { assistant: false });
            let detectResult = await callTool('detectLayerIssues', { screens }, '检查详情页图层命名、分组和可自动化风险。');
            results.push({ toolName: 'detectLayerIssues', result: detectResult });

            let issues: LayerIssue[] = detectResult?.issues || [];
            let crossScreenRiskCount = Array.isArray(parseResult.crossScreenLayers) ? parseResult.crossScreenLayers.length : 0;
            let {
                readiness,
                layoutGraphs,
                layoutAssessment,
                placeholderAnchorDiagnostics,
                visualPlanning,
                screenPlans,
                projectStateContext,
                templateCopyAudit,
                structureAlerts,
                focus
            } = await buildTemplateState(screens, issues, crossScreenRiskCount);
            let detailPageSkillReadiness = buildDetailPageSkillReadinessContext({
                inspectOnly,
                parseResult,
                screens,
                issues,
                crossScreenRiskCount,
                readiness,
                context,
                projectPath,
                projectReadiness: detailPageAgentProjectReadiness
            });
            markPhaseDuration('模板解析', templatePhaseStartedAt);

            emitStep(
                'verification',
                '详情页模板评估完成',
                `就绪度 ${readiness.mode}，版式 ${layoutAssessment.mode}，文案位 ${readiness.metrics.copyPlaceholderCount} 个，图片区 ${readiness.metrics.imagePlaceholderCount} 个。`,
                'success',
                0.22
            );
            callbacks?.onStatus?.(
                `模板评估为 ${readiness.mode}，识别到 ${readiness.metrics.copyPlaceholderCount} 个文案位、${readiness.metrics.imagePlaceholderCount} 个图片区。`
            );
            callbacks?.onStatus?.(`版式评估为 ${layoutAssessment.mode}，当前平均得分 ${Math.round(layoutAssessment.score * 100)}。`);
            callbacks?.onStatus?.(
                `视觉分块判断为 ${visualPlanning.mergeStatus}，识别到 ${visualPlanning.visualScreenCount} 个视觉屏、${visualPlanning.visualModuleCount} 个视觉模块。`
            );
            if (placeholderAnchorDiagnostics.warnings.length > 0) {
                callbacks?.onStatus?.(`模板里还存在 ${placeholderAnchorDiagnostics.warnings.length} 条图片区锚点风险。`);
            }

            if (inspectOnly) {
                emitStep('finalizing', '详情页结构检查结果已汇总', '仅输出模板诊断，不修改 Photoshop 文档。', 'success', 1);
                callbacks?.onStatus?.('结构检查已完成，正在整理诊断结论。');
                const designAgentOs = buildDetailPageDesignAgentOsRecord({
                    userInput: userInputForOs,
                    screenCount: screens.length,
                    screens: buildDetailPageScreenPlanInputs(screenPlans),
                    toolResults: results,
                    success: true,
                    warnings: [
                        ...structureAlerts.map((alert) => String(alert)),
                        ...placeholderAnchorDiagnostics.warnings.map((warning) => String(warning))
                    ]
                });
                const designPlanner = buildDetailPagePlannerContext({
                    userInput: userInputForOs,
                    params,
                    context,
                    projectPath,
                    screenCount: screens.length,
                    mode: 'inspect',
                    readinessMode: readiness.mode,
                    screenPlanCount: screenPlans.length
                });
                const detailPageAgentResultSummary = buildDetailPageAgentResultSummary({
                    intake: detailPageAgentIntake,
                    runtime: {
                        success: true,
                        reviewLevel: 'inspect_only',
                        screenCount: screens.length,
                        successCount: screens.length,
                        failCount: 0,
                        warnings: [
                            ...structureAlerts.map((alert) => String(alert)),
                            ...placeholderAnchorDiagnostics.warnings.map((warning) => String(warning))
                        ]
                    }
                });
                return {
                    success: true,
                    message: buildInspectionSummary({
                        screens,
                        screenPlans,
                    readiness,
                    layoutAssessment,
                    visualPlanning,
                    focus,
                    anchorDiagnostics: placeholderAnchorDiagnostics,
                    copyLayoutAudit: templateCopyAudit,
                    totalTime: Date.now() - startedAt
                }),
                    toolResults: results,
                    data: {
                        inspectOnly: true,
                        readiness,
                        layoutGraphs,
                        layoutAssessment,
                        screenPlans,
                        screenPlanLines: screenPlans.map(formatScreenPlanLine),
                        projectStateContext,
                        visualPlanning,
                        focus,
                        copyLayoutAudit: templateCopyAudit,
                        anchorDiagnostics: placeholderAnchorDiagnostics,
                        structureAlerts,
                        detailPageAgentIntake,
                        detailPageAgentResultSummary,
                        detailPageSkillReadiness,
                        businessSkillMemoryContext: designPlanner.businessSkillMemoryContext,
                        businessSkillMemoryStrategy: designPlanner.businessSkillMemoryStrategy,
                        detailPageMemoryStrategy: designPlanner.detailPageMemoryStrategy,
                        ecommerceSocksChildStrategyInput: designPlanner.ecommerceSocksChildStrategyInput,
                        detailPageDesignPlacementIntelligence: designPlanner.detailPageDesignPlacementIntelligence,
                        businessSkillDesignPlacementIntelligence: designPlanner.businessSkillDesignPlacementIntelligence,
                        designAgentOs,
                        designPlanner,
                        stats: {
                            screensProcessed: screens.length,
                            issueCount: issues.length
                        }
                    }
                };
            }

            if (signal?.aborted) {
                return {
                    success: false,
                    cancelled: true,
                    message: '已取消。',
                    toolResults: results,
                    data: { readiness, layoutGraphs, layoutAssessment }
                };
            }

            const scopePhaseStartedAt = Date.now();
            emitStep('observation', '准备确认详情页执行范围', '根据结构问题判断是否可继续自动修复和填充。', 'running', 0.28);
            const executionScope = await resolveDetailExecutionScope({
                screens,
                issues,
                crossScreenRiskCount,
                autoFix,
                runTool: executeToolCall,
                results,
                designProjectState,
                visualInsightCache: context?.projectContext?.visualInsightCache || null
            });
            markPhaseDuration('结构修复', scopePhaseStartedAt);

            if (!executionScope.canProceed) {
                const failureMessage = executionScope.failureMessage
                    || executionScope.failureReason
                    || '模板结构不满足自动执行条件。';
                if (!workMode) {
                    emitStep(
                        'observation',
                        '模板修复后仍不可执行',
                        '保留模板诊断并交回主 Agent 走从零设计，不把模板修复失败升级为整单终止。',
                        'running',
                        0.32
                    );
                    return buildDetailPageCreateNewHandoffResult({
                        intake: detailPageAgentIntake,
                        toolResults: results,
                        reason: failureMessage,
                        diagnostics: {
                            sourceStage: 'execution_scope',
                            autoFix,
                            initialScreenCount: Array.isArray(parseResult?.screens)
                                ? parseResult.screens.length
                                : 0,
                            resolvedScreenCount: Array.isArray(executionScope.screens)
                                ? executionScope.screens.length
                                : 0,
                            readinessMode: executionScope.templateState?.readiness?.mode,
                            failureReason: executionScope.failureReason || undefined
                        }
                    });
                }
                const detailPageAgentResultSummary = buildDetailPageAgentResultSummary({
                    intake: detailPageAgentIntake,
                    runtime: {
                        success: false,
                        blockers: [failureMessage],
                        warnings: detailPageAgentIntake.warnings
                    }
                });
                emitStep(
                    'warning',
                    '详情页执行范围不可继续',
                    failureMessage,
                    'error',
                    0.32
                );
                return buildFailureResult(
                    executionScope.failureMessage || '当前模板不适合自动执行',
                    executionScope.failureReason || 'Template scope resolution failed',
                    results,
                    {
                        detailPageAgentIntake,
                        detailPageAgentResultSummary,
                        readiness,
                        layoutGraphs,
                        layoutAssessment,
                        visualPlanning,
                        screenPlans,
                        projectStateContext,
                        templateCopyAudit,
                        detailPageSkillReadiness
                    }
                );
            }

            if (executionScope.screens.length === 0) {
                const failureMessage = '模板修复后没有剩余可执行屏。';
                const diagnostics = {
                    sourceStage: 'execution_scope_empty',
                    autoFix,
                    initialScreenCount: Array.isArray(parseResult?.screens)
                        ? parseResult.screens.length
                        : 0,
                    resolvedScreenCount: 0,
                    readinessMode: executionScope.templateState?.readiness?.mode,
                    failureReason: 'No executable screens after scope resolution'
                };
                if (!workMode) {
                    emitStep(
                        'observation',
                        '模板修复后没有可执行屏',
                        '保留重新解析结果并交回主 Agent 走从零设计。',
                        'running',
                        0.32
                    );
                    return buildDetailPageCreateNewHandoffResult({
                        intake: detailPageAgentIntake,
                        toolResults: results,
                        reason: failureMessage,
                        diagnostics
                    });
                }
                const detailPageAgentResultSummary = buildDetailPageAgentResultSummary({
                    intake: detailPageAgentIntake,
                    runtime: {
                        success: false,
                        blockers: [failureMessage],
                        warnings: detailPageAgentIntake.warnings
                    }
                });
                emitStep('warning', '详情页执行范围为空', failureMessage, 'error', 0.32);
                return buildFailureResult(
                    failureMessage,
                    'No executable screens after scope resolution',
                    results,
                    {
                        detailPageAgentIntake,
                        detailPageAgentResultSummary,
                        readiness,
                        layoutGraphs,
                        layoutAssessment,
                        visualPlanning,
                        screenPlans,
                        projectStateContext,
                        templateCopyAudit,
                        detailPageSkillReadiness,
                        templateFallbackDiagnostics: {
                            version: 'detail-page-template-fallback-diagnostics/v0',
                            ...diagnostics
                        }
                    }
                );
            }

            screens = executionScope.screens;
            issues = executionScope.issues;
            crossScreenRiskCount = executionScope.crossScreenRiskCount;
            ({
                readiness,
                layoutGraphs,
                layoutAssessment,
                placeholderAnchorDiagnostics,
                visualPlanning,
                screenPlans,
                projectStateContext,
                templateCopyAudit,
                structureAlerts,
                focus
            } = executionScope.templateState);
            let editTargetScreenIds: number[] = [];
            let editTargetLayerIds: number[] = [];
            let outOfScopeBaselineScreens: ParsedScreen[] = [];
            let outOfScopeBaselineSnapshotResult: any;
            let scopedDeferredScreenIds = (executionScope.deferredScreenIds || []).slice();
            if (workMode === 'edit_existing') {
                outOfScopeBaselineScreens = screens.slice();
                const targetResolution = resolveDetailPageExplicitTargetScreens({
                    screens,
                    targetScope: params.targetScope
                });
                results.push({
                    toolName: 'resolveDetailPageEditTargetScope',
                    result: targetResolution
                });
                if (!targetResolution.matched) {
                    const detailPageAgentResultSummary = buildDetailPageAgentResultSummary({
                        intake: detailPageAgentIntake,
                        runtime: {
                            success: true,
                            reviewLevel: 'needs_review',
                            blockers: [targetResolution.message],
                            warnings: detailPageAgentIntake.warnings
                        }
                    });
                    return {
                        success: true,
                        message: targetResolution.message,
                        toolResults: results,
                        data: {
                            detailPageAgentIntake,
                            detailPageAgentResultSummary,
                            detailPageSkillReadiness,
                            agentReActContinuation: {
                                status: 'needs_decision',
                                summary: targetResolution.message,
                                details: [],
                                blockers: [],
                                warnings: [targetResolution.message],
                                nextAction: 'ask_user',
                                sourceStatus: 'needs_review',
                                recovery: {
                                    mode: 'allowlist',
                                    purpose: 'collect_input',
                                    allowedToolNames: ['createInteractiveCard'],
                                    reason: '需要用户或当前选择明确局部编辑的目标屏/图层。'
                                }
                            }
                        }
                    };
                }
                screens = targetResolution.screens;
                editTargetScreenIds = targetResolution.targetScreenIds;
                const editableLayerIds = collectDetailPageEditableLayerIds(
                    targetResolution.screens,
                    editContentMode as DetailPageEditContentMode
                );
                if (targetResolution.targetKind === 'layer') {
                    const editableLayerIdSet = new Set(editableLayerIds);
                    editTargetLayerIds = targetResolution.targetLayerIds.filter((layerId) => (
                        editableLayerIdSet.has(Number(layerId))
                    ));
                } else {
                    // 屏级 edit 仍要向后续 repair scope 提供精确图层白名单，不能用空
                    // targetLayerIds 让视觉修复阶段失去边界。
                    editTargetLayerIds = editableLayerIds;
                }
                if (editTargetLayerIds.length === 0) {
                    const message = `targetScope 与 editContentMode=${editContentMode} 没有共同的可编辑占位图层；请修正目标或写入类型，系统不会扩大为整屏重填。`;
                    const detailPageAgentResultSummary = buildDetailPageAgentResultSummary({
                        intake: detailPageAgentIntake,
                        runtime: {
                            success: true,
                            reviewLevel: 'needs_review',
                            blockers: [message],
                            warnings: detailPageAgentIntake.warnings
                        }
                    });
                    return {
                        success: true,
                        message,
                        toolResults: results,
                        data: {
                            detailPageAgentIntake,
                            detailPageAgentResultSummary,
                            detailPageSkillReadiness,
                            agentReActContinuation: {
                                status: 'needs_decision',
                                summary: message,
                                details: [],
                                blockers: [],
                                warnings: [message],
                                nextAction: 'ask_user',
                                sourceStatus: 'needs_review',
                                recovery: {
                                    mode: 'allowlist',
                                    purpose: 'collect_input',
                                    allowedToolNames: ['createInteractiveCard'],
                                    reason: '需要模型或用户修正 editContentMode 与局部目标的对应关系。'
                                }
                            }
                        }
                    };
                }
                screenPlans = filterScreenPlansByScreens(screenPlans, screens);
                scopedDeferredScreenIds = scopedDeferredScreenIds.filter((screenId) => (
                    editTargetScreenIds.includes(Number(screenId))
                ));
                callbacks?.onStatus?.(targetResolution.message);
                const outsideScreens = outOfScopeBaselineScreens.filter((screen) => (
                    !editTargetScreenIds.includes(Number(screen.id || 0))
                ));
                if (outsideScreens.length > 0) {
                    outOfScopeBaselineSnapshotResult = await callTool(
                        'getScreenSnapshots',
                        { screens: outsideScreens, maxWidth: 1200 },
                        '局部编辑前采集目标外屏像素，用于防止图片内容越界变化。'
                    );
                    results.push({
                        toolName: 'getScreenSnapshots[editOutsideBefore]',
                        result: outOfScopeBaselineSnapshotResult
                    });
                }
            }

            let detailExecutionAction: 'fill' | 'screen-redo' = 'fill';
            if (
                workMode !== 'edit_existing'
                && shouldUseStateReviewRedoScope(params, userInputForOs)
                && designProjectState
            ) {
                const redoScreens = selectDetailPageScreensForStateRedo({
                    state: designProjectState,
                    screens
                }) as ParsedScreen[];
                if (redoScreens.length > 0 && redoScreens.length < screens.length) {
                    screens = redoScreens;
                    screenPlans = filterScreenPlansByScreens(screenPlans, screens);
                    projectStateContext = {
                        ...projectStateContext,
                        redoScreenIds: screens.map((screen) => Number(screen.id || 0)).filter((id) => id > 0)
                    };
                    detailExecutionAction = 'screen-redo';
                    const scopeMessage = `按项目复核结果只重做 ${screens.map((screen) => screen.name).join('、')}。`;
                    results.push({
                        toolName: 'resolveDetailStateRedoScope',
                        result: {
                            success: true,
                            screenIds: screens.map((screen) => screen.id),
                            screenNames: screens.map((screen) => screen.name)
                        }
                    });
                    callbacks?.onStatus?.(scopeMessage);
                }
            }
            const activeScreenIdSet = new Set(screens.map((screen) => Number(screen.id || 0)));
            scopedDeferredScreenIds = scopedDeferredScreenIds.filter((screenId) => (
                activeScreenIdSet.has(Number(screenId))
            ));
            // 本轮执行目标在此冻结。后续 PSD 回读即使缺屏，也不能缩小验收分母。
            const targetScreens = screens.slice();
            const targetScreenPlans = screenPlans.slice();
            const deferredTargetScreenIds = targetScreens
                .map((screen) => Number(screen.id || 0))
                .filter((screenId) => (
                    screenId > 0
                    && scopedDeferredScreenIds.includes(screenId)
                ));
            if (
                targetScreens.length > 0
                && deferredTargetScreenIds.length === targetScreens.length
            ) {
                const failureMessage = `当前模板 ${targetScreens.length} 屏均缺少可安全写入的占位结构。`;
                const diagnostics = {
                    sourceStage: 'execution_scope_all_deferred',
                    autoFix,
                    initialScreenCount: Array.isArray(parseResult?.screens)
                        ? parseResult.screens.length
                        : 0,
                    resolvedScreenCount: targetScreens.length,
                    deferredScreenIds: deferredTargetScreenIds,
                    readinessMode: executionScope.templateState?.readiness?.mode,
                    failureReason: 'All template screens require manual assist'
                };
                if (!workMode) {
                    emitStep(
                        'observation',
                        '模板没有可自动执行的屏',
                        '所有屏都需要人工重建结构，保留诊断并交回主 Agent 走从零设计。',
                        'running',
                        0.33
                    );
                    return buildDetailPageCreateNewHandoffResult({
                        intake: detailPageAgentIntake,
                        toolResults: results,
                        reason: failureMessage,
                        diagnostics
                    });
                }
                const detailPageAgentResultSummary = buildDetailPageAgentResultSummary({
                    intake: detailPageAgentIntake,
                    runtime: {
                        success: false,
                        blockers: [failureMessage],
                        warnings: detailPageAgentIntake.warnings
                    }
                });
                emitStep('warning', '详情页模板需要人工处理', failureMessage, 'error', 0.33);
                return buildFailureResult(
                    failureMessage,
                    'All template screens require manual assist',
                    results,
                    {
                        detailPageAgentIntake,
                        detailPageAgentResultSummary,
                        readiness,
                        layoutGraphs,
                        layoutAssessment,
                        visualPlanning,
                        screenPlans: targetScreenPlans,
                        projectStateContext,
                        templateCopyAudit,
                        detailPageSkillReadiness,
                        templateFallbackDiagnostics: {
                            version: 'detail-page-template-fallback-diagnostics/v0',
                            ...diagnostics
                        }
                    }
                );
            }

            detailPageSkillReadiness = buildDetailPageSkillReadinessContext({
                inspectOnly,
                parseResult,
                screens,
                issues,
                crossScreenRiskCount,
                readiness,
                context,
                projectPath,
                projectReadiness: detailPageAgentProjectReadiness
            });

            for (const note of executionScope.notes) {
                callbacks?.onStatus?.(note);
            }

            const assetPhaseStartedAt = Date.now();
            report('正在整理当前项目素材。', 0.34);
            const assetAnalysis = await callTool(
                'analyzeProjectForDetailPage',
                { projectPath },
                projectPath ? '读取当前项目中的详情页可用素材。' : '没有项目路径时仅按当前上下文尝试分析素材。'
            );
            results.push({ toolName: 'analyzeProjectForDetailPage', result: assetAnalysis });
            const preScannedProjectAssets = buildDetailProjectAssetsFromAnalysis(assetAnalysis);
            markPhaseDuration('素材分析', assetPhaseStartedAt);

            if (!projectPath) {
                callbacks?.onStatus?.('当前没有明确项目路径，接下来只能按当前上下文和已知素材做匹配。');
            }

            const planningPhaseStartedAt = Date.now();
            emitStep(
                'observation',
                '开始生成详情页填充计划',
                `基于 ${screens.length} 屏结构、模板评估和项目素材生成文案与图片放置计划。`,
                'running',
                0.42
            );
            report('正在为每一屏生成填充计划。', 0.46);
            const copyPlanning = buildDetailPageCopyPlanningInput({
                skillParams: params,
                state: designProjectState,
                screenPlans,
                runtimeDesignBriefDeclaration,
                runtimeDesignStrategyDeclaration
            });
            const deferredScreenIdSet = new Set(scopedDeferredScreenIds.map(Number));
            const executionScreens = screens.filter((screen) => (
                !deferredScreenIdSet.has(Number(screen.id || 0))
            ));
            const planningScreens = workMode === 'edit_existing'
                ? executionScreens.map((screen) => {
                    const contentScopedScreen = scopeDetailPageScreenToEditContentMode(
                        screen,
                        editContentMode as DetailPageEditContentMode
                    );
                    return scopeDetailPageScreenToTargetLayers(
                        contentScopedScreen,
                        editTargetLayerIds
                    );
                })
                : executionScreens;
            const planningScreenById = new Map(planningScreens.map((screen) => [
                Number(screen.id || 0),
                screen
            ]));
            const executionScreenPlans = filterScreenPlansByScreens(screenPlans, planningScreens);
            const plannedContent = planningScreens.length > 0
                ? await planDetailPageContent({
                    screens: planningScreens,
                    screenPlans: executionScreenPlans,
                    focus,
                    projectPath,
                    projectAssets: preScannedProjectAssets,
                    attachedImages: attachedContentImages,
                    copyPlanning,
                    layoutAssessment,
                    runTool: executeToolCall,
                    results
                })
                : {
                    fillPlans: [] as FillPlan[],
                    projectedCopyAudit: auditDetailCopyLayout({ screens: [], screenPlans: [] }),
                    anchorDiagnostics: analyzeDetailImageAnchors([], []),
                    copyGenerationSummary: {
                        totalCopies: 0,
                        generatedCopies: 0,
                        templateCopies: 0,
                        screensWithGeneratedCopy: 0,
                        strategiesUsed: []
                    },
                    fitDecisionCount: 0
                };
            let fillPlans: FillPlan[] = plannedContent.fillPlans;
            if (workMode === 'edit_existing') {
                fillPlans = fillPlans.map((plan) => ({
                    ...plan,
                    workMode,
                    targetScope: params.targetScope,
                    requestedChange: String(params.requestedChange || '').trim(),
                    editContentMode: editContentMode as DetailPageEditContentMode
                }));
            }
            const projectedCopyAudit = plannedContent.projectedCopyAudit;
            const anchorDiagnostics = plannedContent.anchorDiagnostics;
            const copyGenerationSummary = plannedContent.copyGenerationSummary;
            const placementRecords: any[] = [];
            const screenPlanById = new Map<number, DetailScreenPlan>(screenPlans.map((plan) => [plan.screenId, plan]));
            emitStep(
                'verification',
                '详情页填充计划已生成',
                `填充计划 ${fillPlans.length} 个，图片区放置决策 ${plannedContent.fitDecisionCount} 个，锚点风险 ${anchorDiagnostics.warnings.length} 条。`,
                'success',
                0.52
            );
            callbacks?.onStatus?.(`已为 ${plannedContent.fitDecisionCount} 个图片区生成放置决策，接下来开始逐屏填充。`);
            if (anchorDiagnostics.warnings.length > 0) {
                callbacks?.onStatus?.(`检测到 ${anchorDiagnostics.warnings.length} 条放图锚点风险，执行时会优先局部修正。`);
            }
            markPhaseDuration('内容规划', planningPhaseStartedAt);

            const degradedScreenNames: string[] = [];
            const deferredScreenNames: string[] = targetScreens
                .filter((screen) => deferredScreenIdSet.has(Number(screen.id || 0)))
                .map((screen) => screen.name);
            const missingFactScreenNames: string[] = [];
            const copyProviderIssueScreenNames: string[] = [];
            const copyCandidateIssueScreenNames: string[] = [];
            const executedFillPlans: FillPlan[] = [];
            const recoverableImageDeferrals: Array<{
                screenId: number;
                screenName: string;
                layerId: number;
                layerName: string;
                code: string;
                reason: string;
                recoverable: true;
                source: 'plan' | 'filler';
                requiredAction?: string;
            }> = [];
            const preWriteContentVerifications: DetailPageContentVerification[] = [];
            let successCount = 0;
            let failCount = 0;
            let writtenScreenCount = 0;
            const resultByScreenId = new Map<number, string>(targetScreens
                .filter((screen) => deferredScreenIdSet.has(Number(screen.id || 0)))
                .map((screen) => [screen.id, 'needs-review:manual-assist']));

            const fillPhaseStartedAt = Date.now();
            report('开始按屏执行详情页填充。', 0.58, { assistant: false });
            emitStep(
                'observation',
                '开始按屏执行详情页填充',
                `目标 ${targetScreens.length} 屏，可自动执行 ${executionScreens.length} 屏，显式待修复 ${deferredScreenNames.length} 屏。`,
                'running',
                0.58
            );

            const fillPlanByScreenId = new Map(fillPlans.map((plan) => [Number(plan.screenId || 0), plan]));
            for (let i = 0; i < executionScreens.length; i++) {
                if (signal?.aborted) {
                    return {
                        success: false,
                        cancelled: true,
                        message: '已取消。',
                        toolResults: results,
                        data: { readiness, layoutGraphs, layoutAssessment }
                    };
                }

                const screen = executionScreens[i];
                const planningScreen = planningScreenById.get(Number(screen.id || 0)) || screen;
                const screenPlan = screenPlanById.get(screen.id);
                const prepared = await prepareDetailScreenExecutionPlan({
                    screen: planningScreen,
                    screenPlan,
                    initialPlan: fillPlanByScreenId.get(Number(screen.id || 0)),
                    focus,
                    anchorDiagnostics,
                    usePlanGuard,
                    allowLowConfidenceFill,
                    minImageCoverage,
                    projectPath,
                    projectAssets: preScannedProjectAssets,
                    attachedImages: attachedContentImages,
                    copyPlanning,
                    runTool: executeToolCall,
                    results
                });
                if (!prepared.plan) {
                    failCount++;
                    resultByScreenId.set(screen.id, 'failed:no-executable-plan');
                    emitStep(
                        'warning',
                        '单屏填充计划缺失',
                        `${screen.name}: 单屏重建后仍没有可执行计划。`,
                        'error',
                        0.58 + ((i + 1) / Math.max(1, executionScreens.length)) * 0.14
                    );
                    callbacks?.onStatus?.(`${screen.name}: 单屏重建后仍没有可执行计划。`);
                    continue;
                }
                const preparedImageDeferrals = prepared.deferredImages.filter((deferral) => {
                    if (workMode !== 'edit_existing') return true;
                    if (editContentMode === 'copy_only') return false;
                    if (editTargetLayerIds.length === 0) return true;
                    return editTargetLayerIds.includes(Number(deferral.layerId || 0));
                });
                for (const deferral of preparedImageDeferrals) {
                    recoverableImageDeferrals.push({
                        screenId: screen.id,
                        screenName: screen.name,
                        layerId: deferral.layerId,
                        layerName: deferral.layerName,
                        code: deferral.code,
                        reason: deferral.reason,
                        recoverable: true,
                        source: 'plan'
                    });
                }
                let planToApply: FillPlan = {
                    ...prepared.plan,
                    ...(workMode === 'edit_existing' ? {
                        workMode,
                        targetScope: params.targetScope,
                        requestedChange: String(params.requestedChange || '').trim(),
                        editContentMode: editContentMode as DetailPageEditContentMode
                    } : {})
                };
                let validationScreen = planningScreen;
                if (workMode === 'edit_existing') {
                    planToApply = scopeDetailPageFillPlanToEditContentMode(
                        planToApply,
                        editContentMode as DetailPageEditContentMode
                    );
                    planToApply = scopeDetailPageFillPlanToTargetLayers(
                        planToApply,
                        editTargetLayerIds
                    );
                }
                const scopedActionCount = (planToApply.copies?.length || 0)
                    + (planToApply.images?.filter((image) => (
                        String(image?.imagePath || '').trim()
                        || String(image?.imageData || '').trim()
                    )).length || 0);
                if (scopedActionCount === 0) {
                    if (!deferredScreenNames.includes(screen.name)) deferredScreenNames.push(screen.name);
                    const hasImageDeferral = preparedImageDeferrals.length > 0;
                    resultByScreenId.set(
                        screen.id,
                        hasImageDeferral
                            ? 'needs-review:image-execution-deferred'
                            : 'needs-review:target-layer-action-unavailable'
                    );
                    emitStep(
                        'warning',
                        hasImageDeferral ? '图片处理结果尚不可验证' : '局部目标没有可执行动作',
                        hasImageDeferral
                            ? `${screen.name}: ${preparedImageDeferrals.length} 个图片项需要真实处理结果，已结构化延后且未送入 filler。`
                            : `${screen.name}: 目标图层没有匹配到可验证的文字或图片写入计划；已拒绝整屏兜底。`,
                        'error',
                        0.58 + ((i + 1) / Math.max(1, executionScreens.length)) * 0.14
                    );
                    callbacks?.onStatus?.(
                        hasImageDeferral
                            ? `${screen.name}: 待处理图片未执行；可在取得可信蒙版结果或更换可直接使用素材后局部续跑。`
                            : `${screen.name}: 局部目标没有可执行动作，已等待 Agent 改用明确原子工具。`
                    );
                    continue;
                }
                const unresolvedCopy = resolveUnresolvedGeneratedCopy(
                    validationScreen,
                    planToApply,
                    copyPlanning.aiCopyGeneration
                );
                if (unresolvedCopy) {
                    deferredScreenNames.push(screen.name);
                    if (unresolvedCopy === 'confirmed_product_fact_required') {
                        missingFactScreenNames.push(screen.name);
                    } else if (
                        unresolvedCopy === 'copy_provider_unavailable'
                        || unresolvedCopy === 'copy_provider_retryable'
                    ) {
                        copyProviderIssueScreenNames.push(screen.name);
                    } else {
                        copyCandidateIssueScreenNames.push(screen.name);
                    }
                    resultByScreenId.set(screen.id, `needs-review:${unresolvedCopy.replace(/_/g, '-')}`);
                    let stepTitle = '单屏文案候选需要重新规划';
                    let stepMessage = `${screen.name}: 两轮候选后仍没有同时满足事实依据、质量分和版式容量的文案，本屏保持待复核且未写入。`;
                    let statusMessage = `${screen.name}: 文案候选仍需重新规划，本轮不会沿用模板旧文案。`;
                    let stepStatus: 'running' | 'error' = 'error';
                    if (unresolvedCopy === 'confirmed_product_fact_required') {
                        stepTitle = '单屏文案等待商品事实';
                        stepMessage = `${screen.name}: 事实型文案缺少已确认商品事实，本屏保持等待且未写入模板旧文案。`;
                        statusMessage = `${screen.name}: 需要先补充或确认商品事实，Agent 可继续取得事实来源后重试。`;
                        stepStatus = 'running';
                    } else if (unresolvedCopy === 'copy_provider_unavailable') {
                        stepTitle = '文案模型暂不可用';
                        stepMessage = `${screen.name}: 当前没有可用的文案模型调用入口，本屏保持待续跑且未写入模板旧文案。`;
                        statusMessage = `${screen.name}: 文案模型暂不可用；Agent 可检查模型配置或稍后重试，不需要重新开始整个任务。`;
                    } else if (unresolvedCopy === 'copy_provider_retryable') {
                        stepTitle = '文案模型响应需要重试';
                        stepMessage = `${screen.name}: 文案模型请求失败或返回了不可解析结果，本屏保持待续跑且未写入模板旧文案。`;
                        statusMessage = `${screen.name}: 文案生成可重试；已保留当前屏计划和事实上下文。`;
                    }
                    emitStep(
                        'warning',
                        stepTitle,
                        stepMessage,
                        stepStatus,
                        0.58 + ((i + 1) / Math.max(1, executionScreens.length)) * 0.14
                    );
                    callbacks?.onStatus?.(statusMessage);
                    continue;
                }
                if (!screenPlan) {
                    failCount++;
                    resultByScreenId.set(screen.id, 'failed:screen-plan-missing');
                    callbacks?.onStatus?.(`${screen.name}: 缺少对应的屏级设计计划，已停止本屏写入。`);
                    continue;
                }

                const preWriteContentVerification = buildDetailPageContentVerification({
                    state: designProjectState,
                    screenPlans: [screenPlan],
                    fillPlans: [{
                        ...planToApply,
                        copyExpected: (validationScreen.copyPlaceholders?.length || 0) > 0
                    }],
                    executionResults: [{ screenId: screen.id, status: 'passed' }]
                });
                preWriteContentVerifications.push(preWriteContentVerification);
                if (preWriteContentVerification.status !== 'passed') {
                    deferredScreenNames.push(screen.name);
                    copyCandidateIssueScreenNames.push(screen.name);
                    resultByScreenId.set(screen.id, 'needs-review:content-preflight');
                    emitStep(
                        'warning',
                        '单屏文案事实预检未通过',
                        `${screen.name}: 候选文案尚未通过与商品事实的一致性校验，本屏未写入 Photoshop。`,
                        'error',
                        0.58 + ((i + 1) / Math.max(1, executionScreens.length)) * 0.14
                    );
                    callbacks?.onStatus?.(`${screen.name}: 文案事实预检未通过，已保留计划并停止本屏写入。`);
                    continue;
                }

                emitStep(
                    'observation',
                    '准备填充详情页屏',
                    `第 ${i + 1}/${executionScreens.length} 屏：${screen.name}`,
                    'running',
                    0.58 + (i / Math.max(1, executionScreens.length)) * 0.14
                );
                callbacks?.onStatus?.(`正在处理第 ${i + 1}/${executionScreens.length} 屏: ${screen.name}`);
                for (const note of prepared.notes) {
                    callbacks?.onStatus?.(`${screen.name}: ${note}`);
                }

                if (prepared.degraded) {
                    degradedScreenNames.push(screen.name);
                }

                const fillResult = await callTool('fillDetailPage', { plan: planToApply }, `填充详情页屏：${screen.name}`);
                results.push({ toolName: `fillDetailPage[${screen.name}]`, result: fillResult });
                const fillerDeferredImages = Array.isArray(fillResult?.deferredImages)
                    ? fillResult.deferredImages
                    : [];
                const fillerDeferredLayerIds = new Set<number>();
                for (const deferral of fillerDeferredImages) {
                    const layerId = Number(deferral?.layerId || 0);
                    if (layerId > 0) fillerDeferredLayerIds.add(layerId);
                    recoverableImageDeferrals.push({
                        screenId: screen.id,
                        screenName: screen.name,
                        layerId,
                        layerName: String(deferral?.layerName || ''),
                        code: String(deferral?.reasonCode || 'plan_marked_deferred'),
                        reason: String(deferral?.reason || '图片执行被 Photoshop filler 延后。'),
                        recoverable: true,
                        source: 'filler',
                        requiredAction: String(deferral?.requiredAction || '').trim() || undefined
                    });
                }
                executedFillPlans.push(fillerDeferredLayerIds.size > 0
                    ? {
                        ...planToApply,
                        images: (planToApply.images || []).filter((image) => (
                            !fillerDeferredLayerIds.has(Number(image?.layerId || 0))
                        ))
                    }
                    : planToApply);
                if (Array.isArray(fillResult?.placements) && fillResult.placements.length > 0) {
                    placementRecords.push(...fillResult.placements);
                }
                const screenHasWrite = Number(fillResult?.copiesFilled || 0) > 0
                    || Number(fillResult?.imagesFilled || 0) > 0
                    || (fillResult?.success === true && fillerDeferredImages.length === 0);
                if (screenHasWrite) writtenScreenCount++;

                if (fillResult?.success) {
                    const screenHasImageDeferral = preparedImageDeferrals.length > 0
                        || fillerDeferredImages.length > 0;
                    if (screenHasImageDeferral) {
                        if (!deferredScreenNames.includes(screen.name)) deferredScreenNames.push(screen.name);
                        resultByScreenId.set(screen.id, 'needs-review:image-execution-deferred');
                        emitStep(
                            'warning',
                            '单屏部分写入，图片处理待续跑',
                            `${screen.name}: 已保留可验证写入，但未处理图片仍为可恢复延后，本屏不计为完成。`,
                            'running',
                            0.58 + ((i + 1) / Math.max(1, executionScreens.length)) * 0.14
                        );
                    } else {
                        successCount++;
                        resultByScreenId.set(screen.id, 'passed');
                        emitStep(
                            'verification',
                            '单屏填充完成',
                            `${screen.name}: 填充工具返回成功。`,
                            'success',
                            0.58 + ((i + 1) / Math.max(1, executionScreens.length)) * 0.14
                        );
                    }
                } else {
                    failCount++;
                    resultByScreenId.set(screen.id, 'failed:fill-tool');
                    const fillErrors = Array.isArray(fillResult?.errors)
                        ? fillResult.errors.map((item: unknown) => String(item || '')).filter(Boolean)
                        : [];
                    const fillFailureReason = String(fillResult?.error || fillErrors.join('；') || 'fillDetailPage 返回失败状态。');
                    emitStep(
                        'warning',
                        '单屏填充失败',
                        `${screen.name}: ${fillFailureReason}`,
                        'error',
                        0.58 + ((i + 1) / Math.max(1, executionScreens.length)) * 0.14
                    );
                }
            }
            markPhaseDuration('执行填充', fillPhaseStartedAt);
            if (writtenScreenCount > 0) {
                await appendDetailPageVersionRecord({
                    projectPath,
                    action: detailExecutionAction,
                    screens,
                    reason: `写入 ${writtenScreenCount} 屏，完成 ${successCount} 屏，失败 ${failCount} 屏，延后图片 ${recoverableImageDeferrals.length} 项`,
                    results
                });
            }

            const auditPhaseStartedAt = Date.now();
            report('正在回读 PSD，复核文案和图片区结果。', 0.76, { assistant: false });
            emitStep('observation', '开始回读详情页执行结果', '重新读取 PSD 结构、图层层级和放置结果。', 'running', 0.76);
            const liveParseResult = await callTool('parseDetailPageTemplate', { includeStructure: true }, '回读执行后的详情页屏结构。');
            results.push({ toolName: 'parseDetailPageTemplate[liveAudit]', result: liveParseResult });
            const liveScreens: ParsedScreen[] = liveParseResult?.success ? (liveParseResult.screens || []) : [];
            const plannedReadbackFillPlans = new Map<number, FillPlan>();
            executedFillPlans.forEach((plan) => {
                plannedReadbackFillPlans.set(
                    Number(plan.screenId || 0),
                    omitDetailFillPlanImagePayloads(plan)
                );
            });
            targetScreens
                .filter((screen) => (
                    String(resultByScreenId.get(Number(screen.id || 0)) || '').startsWith('needs-review')
                ))
                .forEach((screen) => {
                    if (plannedReadbackFillPlans.has(Number(screen.id || 0))) return;
                    plannedReadbackFillPlans.set(Number(screen.id || 0), {
                        screenId: screen.id,
                        screenName: screen.name,
                        screenType: screen.type,
                        copyExpected: false,
                        executionDeferred: true,
                        copies: [],
                        images: [],
                        needsReview: true
                    });
                });
            const targetScreenIdSet = new Set(targetScreens.map((screen) => Number(screen.id || 0)));
            const liveTargetScreens = liveScreens.filter((screen) => (
                targetScreenIdSet.has(Number(screen.id || 0))
            ));
            const placedTargetLayerIds = placementRecords
                .filter((placement) => (
                    editTargetLayerIds.includes(Number(placement?.placeholderLayerId || 0))
                ))
                .map((placement) => Number(placement?.actualLayerId || 0))
                .filter((layerId) => layerId > 0);
            const currentEditTargetLayerIds = Array.from(new Set([
                ...editTargetLayerIds,
                ...placedTargetLayerIds
            ]));
            const readbackTargetScreens = workMode === 'edit_existing'
                ? targetScreens.map((screen) => (
                    scopeDetailPageScreenToTargetLayers(
                        scopeDetailPageScreenToEditContentMode(
                            screen,
                            editContentMode as DetailPageEditContentMode
                        ),
                        editTargetLayerIds
                    )
                ))
                : targetScreens;
            const readbackLiveScreens = workMode === 'edit_existing'
                ? liveTargetScreens.map((screen) => (
                    scopeDetailPageScreenToTargetLayers(screen, currentEditTargetLayerIds)
                ))
                : liveTargetScreens;
            const liveReadback = buildDetailPageLiveReadback({
                targetScreens: readbackTargetScreens,
                plannedFillPlans: Array.from(plannedReadbackFillPlans.values()),
                liveScreens: readbackLiveScreens
            });
            const liveCopyLayoutAudit = auditDetailCopyLayout({
                screens: readbackLiveScreens,
                screenPlans: targetScreenPlans
            });
            let outOfScopeAfterSnapshotResult: any;
            const outsideScreens = workMode === 'edit_existing'
                ? outOfScopeBaselineScreens.filter((screen) => (
                    !editTargetScreenIds.includes(Number(screen.id || 0))
                ))
                : [];
            if (outsideScreens.length > 0) {
                outOfScopeAfterSnapshotResult = await callTool(
                    'getScreenSnapshots',
                    { screens: outsideScreens, maxWidth: 1200 },
                    '局部编辑后复拍目标外屏，校验图片内容没有越界变化。'
                );
                results.push({
                    toolName: 'getScreenSnapshots[editOutsideAfter]',
                    result: outOfScopeAfterSnapshotResult
                });
            }
            const outOfScopeStructureVerification = workMode === 'edit_existing'
                ? verifyDetailPageOutOfScopeScreensUnchanged({
                    beforeScreens: outOfScopeBaselineScreens,
                    afterScreens: liveScreens,
                    targetScreenIds: editTargetScreenIds,
                    targetLayerIds: currentEditTargetLayerIds
                })
                : {
                    status: 'passed' as const,
                    checkedScreenIds: [],
                    missingScreenIds: [],
                    changedScreenIds: [],
                    foreignScreenIds: [],
                    message: '完整详情页任务不使用局部编辑外屏检查。'
                };
            const outOfScopePixelVerification = workMode === 'edit_existing'
                ? verifyDetailPageOutOfScopeSnapshotsUnchanged({
                    expectedScreens: outsideScreens,
                    beforeResult: outOfScopeBaselineSnapshotResult,
                    afterResult: outOfScopeAfterSnapshotResult
                })
                : {
                    status: 'passed' as const,
                    checkedScreenIds: [],
                    missingBeforeScreenIds: [],
                    missingAfterScreenIds: [],
                    duplicateScreenIds: [],
                    changedScreenIds: [],
                    message: '完整详情页任务不使用局部编辑外屏像素检查。'
                };
            const outOfScopeVerification = {
                ...outOfScopeStructureVerification,
                status: outOfScopeStructureVerification.status === 'passed'
                    && outOfScopePixelVerification.status === 'passed'
                    ? 'passed' as const
                    : 'failed' as const,
                pixelVerification: outOfScopePixelVerification,
                message: outOfScopeStructureVerification.status === 'passed'
                    ? outOfScopePixelVerification.message
                    : outOfScopeStructureVerification.message
            };

            const hierarchyResult = await callTool('getLayerHierarchy', { includeBounds: true, flatList: true }, '读取执行后的图层边界和层级。');
            results.push({ toolName: 'getLayerHierarchy[livePlacement]', result: hierarchyResult });
            const livePlacementState = reconstructDetailPlacementsFromHierarchy(
                readbackLiveScreens,
                normalizeDetailFlatLayers(hierarchyResult),
                0.18
            );
            const placementReceiptByActualLayerId = new Map<number, any>();
            for (const placementReceipt of placementRecords) {
                const actualLayerId = Number(placementReceipt?.actualLayerId || 0);
                if (actualLayerId > 0) {
                    placementReceiptByActualLayerId.set(actualLayerId, placementReceipt);
                }
            }
            const auditPlacements = livePlacementState.placements.map((livePlacement) => {
                const actualLayerId = Number(livePlacement?.actualLayerId || 0);
                const placementReceipt = placementReceiptByActualLayerId.get(actualLayerId);
                if (!placementReceipt) return livePlacement;
                return {
                    ...placementReceipt,
                    ...livePlacement,
                    expectedRelation: placementReceipt.expectedRelation,
                    actualRelation: placementReceipt.actualRelation,
                    clippingBaseId: placementReceipt.clippingBaseId,
                    parentGroupId: placementReceipt.parentGroupId,
                    isSmartObject: placementReceipt.isSmartObject,
                    isClipped: placementReceipt.isClipped
                };
            });

            let placementAuditResult: any = {
                success: true,
                warnings: [],
                riskyScreenIds: []
            };
            if (livePlacementState.placements.length > 0) {
                placementAuditResult = await callTool('auditDetailPagePlacement', {
                    screens: readbackLiveScreens,
                    placements: auditPlacements
                }, '校验图片区实际放置位置和目标占位关系。');
                results.push({ toolName: 'auditDetailPagePlacement', result: placementAuditResult });
            }

            emitStep(
                'verification',
                '详情页结果复核完成',
                `目标回读屏数 ${readbackLiveScreens.length}，实际放置 ${livePlacementState.placements.length} 个，未匹配占位 ${livePlacementState.unmatchedPlaceholders.length} 个。`,
                (placementAuditResult?.warnings?.length || 0) > 0 ? 'error' : 'success',
                0.8
            );
            if ((placementAuditResult?.warnings?.length || 0) > 0) {
                callbacks?.onStatus?.(`放置校验发现 ${placementAuditResult.warnings.length} 条风险，最终结果需要复核。`);
            }
            markPhaseDuration('结果复核', auditPhaseStartedAt);

            let snapshotResult: any;
            const snapshotRequested = shouldCaptureScreenSnapshots(params);
            if (snapshotRequested) {
                const snapshotPhaseStartedAt = Date.now();
                report('正在采集屏级画面供视觉复核。', 0.82);
                snapshotResult = await callTool(
                    'getScreenSnapshots',
                    { screens: targetScreens, maxWidth: 1200 },
                    '采集屏级截图并交给通用视觉观察通道。'
                );
                results.push({ toolName: 'getScreenSnapshots', result: snapshotResult });
                markPhaseDuration('截图校验', snapshotPhaseStartedAt);
            }
            const screenSnapshotVerification = buildDetailScreenSnapshotVerification({
                requested: snapshotRequested,
                expectedScreens: targetScreens,
                result: snapshotResult
            });
            const liveObservationVersionVerification = verifyDetailPageLiveObservationVersion({
                liveParseResult,
                snapshotResult,
                snapshots: screenSnapshotVerification.snapshots
            });
            const verifiedSnapshotHistoryStateRef =
                liveObservationVersionVerification.screenSnapshotHistoryStateRef;
            const screenSnapshotIdentityComplete = screenSnapshotVerification.requested
                && screenSnapshotVerification.expectedScreenCount > 0
                && screenSnapshotVerification.capturedScreenCount
                    === screenSnapshotVerification.expectedScreenCount
                && screenSnapshotVerification.failedScreenCount === 0
                && screenSnapshotVerification.missingScreenIds.length === 0
                && screenSnapshotVerification.foreignScreenIds.length === 0
                && screenSnapshotVerification.duplicateScreenIds.length === 0
                && screenSnapshotVerification.unidentifiedSnapshotCount === 0;
            const visualObservationReceipt = liveObservationVersionVerification.status === 'passed'
                && screenSnapshotIdentityComplete
                && verifiedSnapshotHistoryStateRef
                ? {
                    version: 'visual-observation-receipt/v1' as const,
                    document: String(verifiedSnapshotHistoryStateRef.documentId),
                    history: String(verifiedSnapshotHistoryStateRef.historyStateId),
                    sourceTool: 'getScreenSnapshots' as const
                }
                : undefined;
            // parseDetailPageTemplate 自身已绑定稳定 Photoshop 历史版本；截图版本不一致
            // 只代表视觉观察需重试，不能反向伪造为文案写入失败。
            const versionBoundLiveReadbackFillPlans = liveReadback.fillPlans;
            const visualObservationBundle = buildDetailPageVisualObservationBundle({
                expectedScreenIds: screenSnapshotVerification.expectedScreenIds,
                snapshots: screenSnapshotVerification.snapshots,
                snapshotResult
            });
            if (screenSnapshotVerification.status !== 'passed') {
                callbacks?.onStatus?.(screenSnapshotVerification.message);
            }
            if (liveObservationVersionVerification.status === 'failed') {
                callbacks?.onStatus?.(liveObservationVersionVerification.message);
            }

            const detailPageContentVerification = buildDetailPageContentVerification({
                state: designProjectState,
                screenPlans: targetScreenPlans,
                fillPlans: versionBoundLiveReadbackFillPlans,
                executionResults: Array.from(resultByScreenId.entries()).map(([screenId, status]) => ({
                    screenId,
                    status
                }))
            });
            const contentVerificationMessages = buildContentVerificationMessages(detailPageContentVerification);

            const exportRequested = shouldExportFromRequest(params, context);
            const repairAllowedToolNames = buildDetailPageVisualRepairToolAllowlist({
                workMode,
                editContentMode
            });
            const visualBundleComplete = visualObservationBundle.expectedObservationCount
                === targetScreens.length
                && visualObservationBundle.items.length === targetScreens.length
                && visualObservationBundle.items.every((item) => (
                    item.captured === true
                    && item.identity.document !== 'unknown'
                    && item.identity.history !== 'unknown'
                ));
            // 视觉复核运行时不可用（无视觉能力 / 视觉预算耗尽 / 视觉专家失败）是确定性事实，
            // 不是模型的过错：不得把「等待 Agent 逐屏查看」当作下一步承诺，也不能假装视觉通过。
            // 结构读回已通过时，诚实出口是明确告知用户人工查看后再指示保存/导出。
            const visualReviewRuntimeBlocked = !visualBundleComplete
                && isRuntimeVisualReviewBlocked(readAgentVisualObservation(snapshotResult));
            const visualReviewBlockedReason = visualReviewRuntimeBlocked
                ? String(readAgentVisualObservation(snapshotResult)?.reason || '').trim()
                : '';
            const deliveryCandidate = buildDetailPageDeliveryCandidate({
                exportRequested,
                workMode,
                targetScreenIds: targetScreens.map((screen) => Number(screen.id || 0)),
                targetLayerIds: currentEditTargetLayerIds,
                repairAllowedToolNames,
                reviewAllowedToolNames: ['getScreenSnapshots'],
                checks: {
                    fill_execution: failCount === 0,
                    deferred_screens: deferredScreenNames.length === 0,
                    degraded_screens: degradedScreenNames.length === 0,
                    content_verification: detailPageContentVerification.status === 'passed',
                    live_readback: liveReadback.complete,
                    out_of_scope: outOfScopeVerification.status === 'passed',
                    snapshot_identity: screenSnapshotIdentityComplete,
                    observation_version: liveObservationVersionVerification.status === 'passed',
                    visual_bundle: visualBundleComplete,
                    copy_planning_gaps: missingFactScreenNames.length === 0
                        && copyProviderIssueScreenNames.length === 0
                        && copyCandidateIssueScreenNames.length === 0
                }
            });
            // Workflow owner 只产出交付候选，绝不在模型真实查看像素前内部导出。
            // Harness 在下一轮收到全部屏级视觉 passed 后，才会兑现 deliver allowlist。
            const exportResult: any = undefined;
            if (exportRequested) {
                callbacks?.onStatus?.(
                    deliveryCandidate.status === 'awaiting_visual_review'
                        ? '内容与结构检查已通过，等待 Agent 看完全部目标屏后再开放保存/导出。'
                        : '当前仍有确定性检查未通过，已暂缓保存/导出并保留定向修复范围。'
                );
            }

            const livePlacementDiagnostics = {
                placementCount: livePlacementState.placements.length,
                unmatchedPlaceholderCount: livePlacementState.unmatchedPlaceholders.length,
                diagnostics: livePlacementState.diagnostics,
                unmatchedPlaceholders: livePlacementState.unmatchedPlaceholders
            };
            const reviewLevel = resolveDetailExecutionReviewLevel({
                failCount,
                degradedScreenCount: degradedScreenNames.length,
                readinessMode: readiness.mode,
                layoutMode: layoutAssessment.mode,
                visualMergeStatus: visualPlanning.mergeStatus,
                hasBoundaryRisk: screenPlans.some((plan) => plan.visualSummary?.boundaryRisk === 'risky'),
                anchorWarningCount: anchorDiagnostics.warnings.length,
                templateCopyWarningCount: templateCopyAudit.summary.warningCount || 0,
                liveCopyRiskyCount: liveCopyLayoutAudit.summary.riskyCopyCount || 0,
                liveCopyWarningCount: liveCopyLayoutAudit.summary.warningCount || 0,
                unmatchedPlaceholderCount: livePlacementDiagnostics.unmatchedPlaceholderCount,
                riskyPlacementCount: placementAuditResult?.riskyScreenIds?.length || 0,
                pendingScreenDecisionCount: screenPlans.filter((plan) => plan.requiresModelDecision).length,
                contentVerificationStatus: detailPageContentVerification.status,
                screenSnapshotStatus: screenSnapshotVerification.status
            });
            const hardFailure = failCount > 0
                || detailPageContentVerification.status === 'failed'
                || outOfScopeVerification.status === 'failed';
            const needsReview = reviewLevel !== 'ok'
                || detailPageContentVerification.status !== 'passed'
                || deferredScreenNames.length > 0
                || screenSnapshotVerification.status !== 'passed'
                || liveObservationVersionVerification.status !== 'passed';
            const completionStatus: 'passed' | 'needs_review' | 'failed' = hardFailure
                ? 'failed'
                : needsReview ? 'needs_review' : 'passed';
            // 确定性检查通过只形成交付候选；在 Harness 真实查看全部屏级像素前，
            // Workflow 仍必须保持 needs_review，不能先标 completed 而丢失 deliver continuation。
            const workflowCompletionStatus: 'passed' | 'needs_review' | 'failed' =
                deliveryCandidate.status === 'awaiting_visual_review'
                    ? 'needs_review'
                    : completionStatus;
            const executionSucceeded = workflowCompletionStatus !== 'failed';
            const completionBlockers = [
                ...(failCount > 0 ? [`${failCount} 屏填充失败或缺少可执行计划。`] : []),
                ...(liveObservationVersionVerification.status === 'failed'
                    ? [liveObservationVersionVerification.message]
                    : []),
                ...(outOfScopeVerification.status === 'failed'
                    ? [outOfScopeVerification.message]
                    : []),
                ...contentVerificationMessages.blockers
            ];
            const completionWarnings = [
                ...degradedScreenNames.map((name) => `${name}: 降级填充`),
                ...(visualReviewRuntimeBlocked
                    ? [`视觉复核在当前运行中不可用（${visualReviewBlockedReason || '运行时限制'}）：确定性检查已通过，但未经视觉确认的画面不得自动导出。请在 Photoshop 中查看效果后，明确指示保存或导出。`]
                    : []),
                ...(missingFactScreenNames.length > 0
                    ? [`${missingFactScreenNames.join('、')}: 需要先补充或确认商品事实，再生成事实型文案。`]
                    : []),
                ...(copyProviderIssueScreenNames.length > 0
                    ? [`${copyProviderIssueScreenNames.join('、')}: 文案模型入口、请求或响应异常；保留上下文后可重试。`]
                    : []),
                ...(copyCandidateIssueScreenNames.length > 0
                    ? [`${copyCandidateIssueScreenNames.join('、')}: 文案候选未通过事实、质量或版式容量校验，需要重新规划。`]
                    : []),
                ...recoverableImageDeferrals.slice(0, 12).map((item) => (
                    `${item.screenName}/${item.layerName || `图层 ${item.layerId}`}: ${item.reason}`
                    + (item.requiredAction ? ` 后续：${item.requiredAction}` : '')
                )),
                ...(screenSnapshotVerification.status === 'needs_review'
                    ? [screenSnapshotVerification.message]
                    : []),
                ...(screenSnapshotVerification.status === 'failed'
                    ? [`屏级视觉素材采集失败，可在保留当前设计状态后重试：${screenSnapshotVerification.message}`]
                    : []),
                ...(exportRequested && !exportResult
                    ? ['用户要求导出，但当前结果尚未通过真实画面复核；导出动作已留给 Agent 下一步处理。']
                    : []),
                ...anchorDiagnostics.warnings.map((warning) => String(warning)),
                ...((placementAuditResult?.warnings || []) as any[]).map((warning) => String(warning)),
                ...contentVerificationMessages.warnings
            ];
            let continuationStatus: 'needs_decision' | 'needs_repair' = 'needs_decision';
            let continuationNextAction: 'decide_next' | 'repair' | 'ask_user' = 'decide_next';
            let continuationSummary = exportRequested
                ? '屏级截图已附给 Agent；请查看真实画面，必要时修复，通过后再调用导出工具。'
                : '屏级截图已附给 Agent；请查看真实画面并判断是否需要继续修复。';
            if (missingFactScreenNames.length > 0) {
                continuationNextAction = 'ask_user';
                continuationSummary = '部分屏缺少已确认商品事实，未写入模板旧文案；请先取得或确认事实后继续。';
            } else if (copyProviderIssueScreenNames.length > 0) {
                continuationStatus = 'needs_repair';
                continuationNextAction = 'repair';
                continuationSummary = '文案模型入口、请求或响应暂时异常；屏计划与事实上下文已保留，请有限重试文案生成。';
            } else if (copyCandidateIssueScreenNames.length > 0) {
                continuationStatus = 'needs_repair';
                continuationNextAction = 'repair';
                continuationSummary = '文案候选未通过事实、质量或版式容量校验，需要重新规划后再写入。';
            } else if (recoverableImageDeferrals.length > 0) {
                continuationStatus = 'needs_repair';
                continuationNextAction = 'repair';
                continuationSummary = '部分图片没有与本次 Photoshop 写入绑定的可信处理结果；已保留其他写入，请取得真实蒙版读回或改选可直接使用素材后仅续跑这些图片。';
            } else if (liveObservationVersionVerification.status === 'failed') {
                continuationStatus = 'needs_repair';
                continuationNextAction = 'repair';
                continuationSummary = '写后结构回读与屏级截图没有形成同一 Photoshop 历史版本观察记录；请重新回读并截图，不要从头重做。';
            } else if (screenSnapshotVerification.status === 'failed') {
                continuationStatus = 'needs_repair';
                continuationNextAction = 'repair';
                continuationSummary = '设计写入结果已保留，但屏级截图未取得；请重试视觉观察，不要从头重做。';
            }
            let continuationRecovery: Record<string, unknown>;
            if (missingFactScreenNames.length > 0) {
                continuationRecovery = {
                    mode: 'allowlist' as const,
                    purpose: 'collect_input' as const,
                    allowedToolNames: ['createInteractiveCard'],
                    reason: '仅收集缺失的商品事实，不重跑或扩大 Photoshop 写入范围。'
                };
            } else if (deliveryCandidate.status === 'awaiting_visual_review') {
                continuationSummary = visualReviewRuntimeBlocked
                    ? `全部确定性检查已通过，但视觉复核在当前运行中不可用（${visualReviewBlockedReason || '运行时限制'}）：不会自动保存或导出。请用户在 Photoshop 中人工查看画面；明确指示保存或导出后再继续。`
                    : (exportRequested
                        ? '全部确定性检查已通过；等待 Agent 逐屏查看真实像素，通过后仅开放保存与导出。'
                        : '全部确定性检查已通过；等待 Agent 逐屏查看真实像素，通过后即可完成当前设计任务。');
                continuationRecovery = {
                    mode: 'allowlist' as const,
                    purpose: 'deliver' as const,
                    allowedToolNames: exportRequested
                        ? ['saveDocument', 'exportDetailPageSlices']
                        : [],
                    repairAllowedToolNames,
                    reviewAllowedToolNames: deliveryCandidate.reviewAllowedToolNames,
                    requiresVisualPass: true,
                    completeOnVisualPass: deliveryCandidate.completeOnVisualPass,
                    targetScreenIds: editTargetScreenIds,
                    targetLayerIds: currentEditTargetLayerIds,
                    requireExplicitLayerTarget: workMode === 'edit_existing',
                    reason: visualReviewRuntimeBlocked
                        ? '视觉复核运行时不可用：保存与导出必须由用户明确指示，且不冒充视觉通过。'
                        : (exportRequested
                            ? '只有全部目标屏真实视觉复核通过后，才允许保存并导出详情页切片。'
                            : '全部目标屏真实视觉复核通过后即可完成；若发现问题，只开放定向修复。')
                };
            } else {
                continuationRecovery = {
                    mode: 'allowlist' as const,
                    purpose: 'repair' as const,
                    allowedToolNames: repairAllowedToolNames,
                    targetScreenIds: editTargetScreenIds,
                    targetLayerIds: currentEditTargetLayerIds,
                    requireExplicitLayerTarget: workMode === 'edit_existing',
                    reason: workMode === 'edit_existing'
                        ? '只开放目标屏/图层的观察与原子修复；修复后必须重新由详情页 owner 验收，不能直接保存或导出。'
                        : '只开放当前详情页的观察与原子修复；修复后必须重新由详情页 owner 验收，不能直接保存或导出。'
                };
            }
            const designAgentOs = buildDetailPageDesignAgentOsRecord({
                userInput: userInputForOs,
                screenCount: targetScreens.length,
                screens: buildDetailPageScreenPlanInputs(
                    screenPlans,
                    fillPlans.map(omitDetailFillPlanImagePayloads),
                    resultByScreenId
                ),
                toolResults: results,
                success: executionSucceeded,
                completionContract: {
                    status: workflowCompletionStatus,
                    summary: `详情页完成 ${successCount} 屏，写入 ${writtenScreenCount} 屏，失败 ${failCount} 屏，延后图片 ${recoverableImageDeferrals.length} 项，内容校验 ${detailPageContentVerification.status}，复核等级 ${reviewLevel}。`,
                    blockers: completionBlockers,
                    warnings: completionWarnings
                }
            });
            const designPlanner = buildDetailPagePlannerContext({
                userInput: userInputForOs,
                params,
                context,
                projectPath,
                screenCount: targetScreens.length,
                mode: 'execute',
                readinessMode: readiness.mode,
                screenPlanCount: screenPlans.length
            });
            detailPageSkillReadiness = buildDetailPageSkillReadinessContext({
                inspectOnly,
                parseResult: liveParseResult?.success ? liveParseResult : parseResult,
                screens: liveScreens,
                issues,
                crossScreenRiskCount,
                readiness,
                context,
                projectPath,
                projectReadiness: detailPageAgentProjectReadiness
            });
            const detailPageAgentResultSummary = buildDetailPageAgentResultSummary({
                intake: detailPageAgentIntake,
                runtime: {
                    success: executionSucceeded,
                    reviewLevel: workflowCompletionStatus === 'passed'
                        ? reviewLevel
                        : 'needs_review',
                    screenCount: targetScreens.length,
                    successCount,
                    failCount,
                    exportFileCount: countExportedDetailFiles(exportResult),
                    blockers: completionBlockers,
                    warnings: completionWarnings
                }
            });
            emitStep(
                'finalizing',
                '详情页执行结果已汇总',
                `完成 ${successCount} 屏，写入 ${writtenScreenCount} 屏，失败 ${failCount} 屏，延后图片 ${recoverableImageDeferrals.length} 项，内容校验 ${detailPageContentVerification.status}，复核等级 ${reviewLevel}。`,
                workflowCompletionStatus === 'failed' ? 'error' : 'success',
                1
            );

            return {
                success: executionSucceeded,
                message: buildExecutionSummary({
                    screens: targetScreens,
                    screenPlans,
                    readiness,
                    layoutAssessment,
                    visualPlanning,
                    focus,
                    anchorDiagnostics,
                    placementAudit: placementAuditResult,
                    copyLayoutAudit: liveCopyLayoutAudit,
                    copyGenerationSummary,
                    contentVerification: {
                        status: detailPageContentVerification.status,
                        unsupportedCopyCount: detailPageContentVerification.summary.unsupportedCopyCount,
                        failedScreenCount: detailPageContentVerification.summary.failedScreenCount,
                        needsReviewScreenCount: detailPageContentVerification.summary.needsReviewScreenCount
                    },
                    livePlacementDiagnostics: {
                        placementCount: livePlacementDiagnostics.placementCount,
                        unmatchedPlaceholderCount: livePlacementDiagnostics.unmatchedPlaceholderCount
                    },
                    reviewLevel,
                    successCount,
                    failCount,
                    degradedScreenNames,
                    phaseDurations,
                    exportResult,
                    totalTime: Date.now() - startedAt
                }),
                toolResults: results,
                data: {
                    inspectOnly: false,
                    status: workflowCompletionStatus === 'passed'
                        ? 'completed'
                        : workflowCompletionStatus,
                    reviewLevel,
                    needsReview,
                    readiness,
                    layoutGraphs,
                    layoutAssessment,
                    screenPlans,
                    screenPlanLines: screenPlans.map(formatScreenPlanLine),
                    projectStateContext,
                    visualPlanning,
                    focus,
                    imageFit: {
                        decisionCount: plannedContent.fitDecisionCount
                    },
                    copyLayoutAudit: {
                        template: templateCopyAudit,
                        projected: projectedCopyAudit,
                        live: liveCopyLayoutAudit
                    },
                    copyGenerationSummary,
                    recoverableImageDeferrals,
                    preWriteContentVerifications,
                    anchorDiagnostics,
                    placementAudit: placementAuditResult,
                    livePlacementDiagnostics,
                    liveReadback,
                    outOfScopeVerification,
                    liveObservationVersionVerification,
                    structureAlerts,
                    export: exportResult,
                    screenSnapshots: screenSnapshotVerification.snapshots,
                    screenSnapshotVerification,
                    visualObservationBundle,
                    deliveryCandidate,
                    visualReviewRequest: {
                        toolName: 'getScreenSnapshots',
                        params: {
                            screens: targetScreens,
                            maxWidth: 1200
                        }
                    },
                    ...(visualObservationReceipt ? { visualObservationReceipt } : {}),
                    phaseDurations,
                    workMode,
                    ...(workMode === 'edit_existing' ? {
                        targetScope: params.targetScope,
                        requestedChange: String(params.requestedChange || '').trim(),
                        editContentMode,
                        targetScreenIds: editTargetScreenIds,
                        originalTargetLayerIds: editTargetLayerIds,
                        targetLayerIds: currentEditTargetLayerIds
                    } : {}),
                    detailPageAgentIntake,
                    detailPageAgentResultSummary,
                    detailPageContentVerification,
                    ...(workflowCompletionStatus !== 'passed' ? {
                        agentReActContinuation: {
                            status: continuationStatus,
                            summary: continuationSummary,
                            details: completionWarnings.slice(0, 8),
                            blockers: [],
                            warnings: completionWarnings.slice(0, 8),
                            nextAction: continuationNextAction,
                            sourceStatus: workflowCompletionStatus,
                            recovery: continuationRecovery
                        }
                    } : {}),
                    exportRequested,
                    exportDeferred: exportRequested && !exportResult,
                    detailPageSkillReadiness,
                    businessSkillMemoryContext: designPlanner.businessSkillMemoryContext,
                    businessSkillMemoryStrategy: designPlanner.businessSkillMemoryStrategy,
                    detailPageMemoryStrategy: designPlanner.detailPageMemoryStrategy,
                    ecommerceSocksChildStrategyInput: designPlanner.ecommerceSocksChildStrategyInput,
                    detailPageDesignPlacementIntelligence: designPlanner.detailPageDesignPlacementIntelligence,
                    businessSkillDesignPlacementIntelligence: designPlanner.businessSkillDesignPlacementIntelligence,
                    designAgentOs,
                    designPlanner,
                    stats: {
                        screensProcessed: targetScreens.length,
                        screensSuccess: successCount,
                        screensWritten: writtenScreenCount,
                        screensFailed: failCount,
                        degradedScreenCount: degradedScreenNames.length,
                        deferredImageCount: recoverableImageDeferrals.length
                    }
                }
            };
        } catch (error: any) {
            const detailPageAgentResultSummary = buildDetailPageAgentResultSummary({
                intake: detailPageAgentIntake,
                runtime: {
                    success: false,
                    blockers: [error?.message || '未知错误'],
                    warnings: detailPageAgentIntake.warnings
                }
            });
            emitStep(
                'warning',
                '详情页执行异常',
                error?.message || '未知错误',
                'error',
                1
            );
            return buildFailureResult(
                `详情页执行失败: ${error?.message || '未知错误'}`,
                error?.message || 'Unknown error',
                results,
                {
                    detailPageAgentIntake,
                    detailPageAgentResultSummary,
                    detailPageSkillReadiness: detailPageAgentIntake.readiness
                }
            );
        }
    }
};
