import type {
    DetailPageEditContentMode,
    DetailScreenPlan,
    FillPlan,
    LayerIssue,
    ParsedScreen
} from './detail-page.types';
import type { DetailScreenRole } from '../../../shared/detail-page-screen-plan';
import type { DetailPageCopyFactInput } from '../../../shared/detail-page-copy-generation-contract';
import type { DesignImageInput } from '../../../shared/design-image-input';
import type { DesignProjectState } from '../../../shared/types/design-project-state.types';
import type { ProjectVisualInsightCacheReadResult } from '../../../shared/project-visual-insight-cache';
import type { DetailProjectAsset } from './detail-page-asset-ranker';
import { sha256Hex } from '../../../shared/agent-runtime-v5/content-hash';

import { buildSelectedDesignContext } from '../../../shared/design-selected-design-context';
import { buildSelectedElementContext } from '../../../shared/design-selected-element-context';
import { buildSelectedModuleContext } from '../../../shared/design-selected-module-context';
import {
    buildDetailPageStateContext,
    type DetailPageStateContext
} from '../../../shared/detail-page-state-consumption';
import type { DesignScene } from '../../../shared/types/design-context.types';
import type { SelectedElementContext } from '../../../shared/types/design-scene.types';
import type { SelectedModuleContext } from '../../../shared/types/design-graph.types';
import type { SelectedDesignContext } from '../../../shared/types/design-context.types';
import {
    alignDetailFillPlansToScreens,
    analyzeDetailImageAnchors,
    analyzeDetailPlaceholderAnchors,
    calculateDetailPlanQuality,
    collectDetailStructureAlerts,
    enrichDetailFillPlansWithLayerRelations,
    resolveDetailImageExecutionDeferral,
    type DetailImageExecutionDeferral
} from './detail-page-plan-utils';
import {
    applyDetailFillPlanCopiesToScreens,
    auditDetailCopyLayoutForScreens as auditDetailCopyLayout
} from '../../../shared/detail-page-copy-layout-audit';
import {
    normalizeDetailFlatLayers,
    reconstructDetailPlacementsFromHierarchy
} from '../../../shared/detail-page-live-placement';
import {
    auditDetailSegmentationMerge,
    buildDetailScreenVisualSummaries,
    buildDetailVisualModules,
    buildDetailVisualScreenBoundaries,
    type DetailSegmentationMergeAudit,
    type DetailVisualModule,
    type DetailVisualScreenBoundary,
    type DetailScreenVisualSummary
} from '../../../shared/detail-page-visual-segmentation';
import { assessDetailPageTemplateReadiness } from './detail-page-template-readiness';
import { buildDetailPageLayoutGraphs } from './detail-page-layout-graph';
import { analyzeDetailPageLayout } from './detail-page-layout-analyzer';
import { applyDetailImageFitDecisions } from './detail-page-image-fit';
import { describeDetailScreenRole, inferDetailScreenPlans } from './detail-page-screen-role';

type DetailToolRunner = (toolName: string, params: Record<string, any>) => Promise<any>;

export type DetailVisualPlanningContext = {
    visualSummaries: DetailScreenVisualSummary[];
    mergeStatus: 'ok' | 'watch' | 'risky';
    visualScreenCount: number;
    visualModuleCount: number;
    warnings: string[];
    documentInfo: Record<string, unknown> | null;
    flatLayers: Array<Record<string, unknown>>;
    visualScreens: DetailVisualScreenBoundary[];
    visualModules: DetailVisualModule[];
    mergeAudit: DetailSegmentationMergeAudit;
};

export type DetailFocusContext = {
    selectedDesignContext: SelectedDesignContext | null;
    selectedScene: DesignScene | null;
    selectedElementContext: SelectedElementContext | null;
    selectedModuleContext: SelectedModuleContext | null;
    focusedScreenId: number | null;
    focusedScreenName: string | null;
    focusedScreenRole: string | null;
    focusedVisualModuleId: string | null;
    focusedModuleInferenceMode: SelectedModuleContext['diagnostics']['inferenceMode'] | null;
};

export type DetailTemplateState = {
    readiness: ReturnType<typeof assessDetailPageTemplateReadiness>;
    layoutGraphs: ReturnType<typeof buildDetailPageLayoutGraphs>;
    layoutAssessment: ReturnType<typeof analyzeDetailPageLayout>;
    placeholderAnchorDiagnostics: ReturnType<typeof analyzeDetailPlaceholderAnchors>;
    visualPlanning: DetailVisualPlanningContext;
    screenPlans: DetailScreenPlan[];
    projectStateContext: DetailPageStateContext;
    templateCopyAudit: ReturnType<typeof auditDetailCopyLayout>;
    structureAlerts: ReturnType<typeof collectDetailStructureAlerts>;
    focus: DetailFocusContext;
};

export type DetailContentPlanningResult = {
    fillPlans: FillPlan[];
    projectedCopyAudit: ReturnType<typeof auditDetailCopyLayout>;
    anchorDiagnostics: ReturnType<typeof analyzeDetailImageAnchors>;
    copyGenerationSummary: {
        totalCopies: number;
        generatedCopies: number;
        templateCopies: number;
        screensWithGeneratedCopy: number;
        strategiesUsed: string[];
    };
    fitDecisionCount: number;
};

export type DetailPageCopyPlanningInput = {
    copyContext: {
        facts: DetailPageCopyFactInput[];
        audience: string;
        brandTone: string;
        creativeStyle: string;
        screenDirectives: Array<{
            screenId: number;
            screenName: string;
            objective: string;
            visualIntent: string;
        }>;
    };
    copyFacts: DetailPageCopyFactInput[];
    targetAudience: string;
    aiCopyGeneration: boolean;
    copyReview: boolean;
    copyMinScore: number;
    copyCandidateCount: number;
    copyCreativeStyle: string;
    lowScoreCopyStrategy: 'replace' | 'flag' | 'keep';
    copyLayoutFit: boolean;
    copyLineBreakStyle: string;
    copyTitleMaxLines: number;
    copySubtitleMaxLines: number;
    copyBodyMaxLines: number;
    copyOnly: boolean;
    brandTone: string;
    screenCopyDirectives: Array<{
        screenId: number;
        screenName: string;
        objective: string;
        visualIntent: string;
    }>;
};

export type DetailExecutionReviewLevel = 'ok' | 'watch' | 'risky';

export type DetailPreparedScreenPlan = {
    plan: FillPlan | null;
    degraded: boolean;
    skippedRiskyImageCount: number;
    deferredImages: DetailImageExecutionDeferral[];
    notes: string[];
    rebuilt: boolean;
};

export type DetailExecutionScopeResolution = {
    canProceed: boolean;
    failureMessage?: string;
    failureReason?: string;
    screens: ParsedScreen[];
    issues: LayerIssue[];
    crossScreenRiskCount: number;
    templateState: DetailTemplateState;
    notes: string[];
    /** manual-assist 下无法安全写入、但仍必须保留在完整任务验收分母中的屏。 */
    deferredScreenIds?: number[];
};

export type DetailPageTargetScopeResolution = {
    explicit: boolean;
    matched: boolean;
    ambiguous: boolean;
    screens: ParsedScreen[];
    targetScreenIds: number[];
    targetLayerIds: number[];
    targetKind: 'screen' | 'layer';
    message: string;
};

export type DetailPageDeliveryCandidate = {
    version: 'detail-page-delivery-candidate/v1';
    status: 'not_requested' | 'not_ready' | 'awaiting_visual_review';
    deterministicChecksPassed: boolean;
    requiresVisualPass: true;
    completeOnVisualPass: boolean;
    exportRequested: boolean;
    workMode: string;
    targetScreenIds: number[];
    targetLayerIds: number[];
    repairAllowedToolNames: string[];
    reviewAllowedToolNames: string[];
    failedChecks: string[];
};

export type DetailPageOutOfScopePixelVerification = {
    status: 'passed' | 'failed';
    checkedScreenIds: number[];
    missingBeforeScreenIds: number[];
    missingAfterScreenIds: number[];
    duplicateScreenIds: number[];
    changedScreenIds: number[];
    message: string;
};

export type DetailPageOutOfScopeVerification = {
    status: 'passed' | 'failed';
    checkedScreenIds: number[];
    missingScreenIds: number[];
    changedScreenIds: number[];
    foreignScreenIds: number[];
    message: string;
};

export function formatDetailScreenPlanLine(plan: DetailScreenPlan): string {
    const riskText = (plan.risks || []).length > 0 ? ` / 风险 ${plan.risks.length} 项` : '';
    const decisionText = plan.requiresModelDecision
        ? ' / 待模型决策'
        : ` / 决策 ${plan.decisionSource}`;
    return `${plan.screenName}: ${describeDetailScreenRole(plan.screenRole)} / 文案策略 ${plan.copyStrategy} / 图片策略 ${plan.imageStrategy}${decisionText}${riskText}`;
}

export function resolveDetailExecutionReviewLevel(params: {
    failCount: number;
    degradedScreenCount: number;
    readinessMode: ReturnType<typeof assessDetailPageTemplateReadiness>['mode'];
    layoutMode: ReturnType<typeof analyzeDetailPageLayout>['mode'];
    visualMergeStatus: DetailVisualPlanningContext['mergeStatus'];
    hasBoundaryRisk: boolean;
    anchorWarningCount: number;
    templateCopyWarningCount: number;
    liveCopyRiskyCount: number;
    liveCopyWarningCount: number;
    unmatchedPlaceholderCount: number;
    riskyPlacementCount: number;
    pendingScreenDecisionCount?: number;
    contentVerificationStatus?: 'passed' | 'needs_review' | 'failed';
    screenSnapshotStatus?: 'passed' | 'needs_review' | 'failed';
}): DetailExecutionReviewLevel {
    const hardRisk = params.failCount > 0
        || params.liveCopyRiskyCount > 0
        || params.unmatchedPlaceholderCount > 0
        || params.riskyPlacementCount > 0
        || params.contentVerificationStatus === 'failed'
        || params.screenSnapshotStatus === 'failed';

    if (hardRisk) {
        return 'risky';
    }

    const watchRisk = params.degradedScreenCount > 0
        || params.readinessMode !== 'auto-fill'
        || params.layoutMode !== 'stable'
        || params.visualMergeStatus !== 'ok'
        || params.hasBoundaryRisk
        || params.anchorWarningCount > 0
        || params.templateCopyWarningCount > 0
        || params.liveCopyWarningCount > 0
        || Number(params.pendingScreenDecisionCount || 0) > 0
        || params.contentVerificationStatus === 'needs_review'
        || params.screenSnapshotStatus === 'needs_review';

    return watchRisk ? 'watch' : 'ok';
}

export function buildDetailExecutionSummary(params: {
    screens: ParsedScreen[];
    screenPlans: DetailScreenPlan[];
    readiness: ReturnType<typeof assessDetailPageTemplateReadiness>;
    layoutAssessment: ReturnType<typeof analyzeDetailPageLayout>;
    visualPlanning: DetailVisualPlanningContext;
    anchorDiagnostics: ReturnType<typeof analyzeDetailImageAnchors>;
    placementAudit?: {
        warnings?: string[];
        riskyScreenIds?: number[];
    };
    copyLayoutAudit?: {
        summary?: {
            riskyCopyCount?: number;
            watchCopyCount?: number;
            warningCount?: number;
        };
        warnings?: string[];
    };
    copyGenerationSummary?: DetailContentPlanningResult['copyGenerationSummary'];
    contentVerification?: {
        status: 'passed' | 'needs_review' | 'failed';
        unsupportedCopyCount: number;
        failedScreenCount: number;
        needsReviewScreenCount: number;
    };
    focus?: DetailFocusContext;
    livePlacementDiagnostics?: {
        placementCount: number;
        unmatchedPlaceholderCount: number;
    };
    reviewLevel: DetailExecutionReviewLevel;
    successCount: number;
    failCount: number;
    degradedScreenNames: string[];
    phaseDurations?: Record<string, number>;
    exportResult?: any;
    totalTime: number;
}): string {
    const lines: string[] = [
        params.failCount > 0
            ? '详情页已部分执行完成，存在失败屏，需要优先复核。'
            : params.reviewLevel === 'risky'
                ? '详情页已执行完成，但结果风险较高，需要优先复核。'
                : params.reviewLevel === 'watch'
                    ? '详情页已执行完成，存在观察项。'
                    : '详情页执行完成。',
        '',
        `模板评估: ${params.readiness.mode} (${Math.round(params.readiness.score * 100)} 分)`,
        `版式评估: ${params.layoutAssessment.mode} (${Math.round(params.layoutAssessment.score * 100)} 分)`,
        `视觉分块: ${params.visualPlanning.mergeStatus}（视觉屏 ${params.visualPlanning.visualScreenCount} / 模块 ${params.visualPlanning.visualModuleCount}）`,
        `执行结果: 共 ${params.screens.length} 屏，成功 ${params.successCount} 屏，失败 ${params.failCount} 屏`
    ];

    if (params.readiness.risks.length > 0) {
        lines.push(`结构风险: ${params.readiness.risks.join('；')}`);
    }
    if (params.focus?.focusedScreenName) {
        const roleText = params.focus.focusedScreenRole
            ? ` / ${describeDetailScreenRole(params.focus.focusedScreenRole as DetailScreenRole)}`
            : '';
        lines.push(`当前关注点: ${params.focus.focusedScreenName}${roleText}`);
    }
    if (params.layoutAssessment.warnings.length > 0) {
        lines.push(`版式提示: ${params.layoutAssessment.warnings.join('；')}`);
    }
    if (params.anchorDiagnostics.warnings.length > 0) {
        lines.push(`放图风险: ${params.anchorDiagnostics.warnings.join('；')}`);
    }
    if (params.visualPlanning.warnings.length > 0) {
        lines.push(`视觉分割提示: ${params.visualPlanning.warnings.join('；')}`);
    }
    if (params.copyGenerationSummary) {
        lines.push(
            `文案生成: 共 ${params.copyGenerationSummary.totalCopies} 条，AI 生成 ${params.copyGenerationSummary.generatedCopies} 条，涉及 ${params.copyGenerationSummary.screensWithGeneratedCopy} 屏`
        );
    }
    if (params.contentVerification) {
        lines.push(
            `内容事实校验: ${params.contentVerification.status}（失败屏 ${params.contentVerification.failedScreenCount}，待复核屏 ${params.contentVerification.needsReviewScreenCount}，无可靠依据文案 ${params.contentVerification.unsupportedCopyCount} 条）`
        );
    }
    if (params.copyLayoutAudit?.summary) {
        lines.push(
            `文案布局风险: 高风险 ${params.copyLayoutAudit.summary.riskyCopyCount || 0}，观察项 ${params.copyLayoutAudit.summary.watchCopyCount || 0}`
        );
    }
    if (params.livePlacementDiagnostics) {
        lines.push(
            `Live 放图重建: ${params.livePlacementDiagnostics.placementCount} 个已匹配，${params.livePlacementDiagnostics.unmatchedPlaceholderCount} 个占位仍未匹配`
        );
    }
    if ((params.placementAudit?.warnings?.length || 0) > 0) {
        lines.push(`落位复核: ${params.placementAudit?.warnings?.join('；')}`);
    }
    if (params.degradedScreenNames.length > 0) {
        lines.push(`受保护屏: ${params.degradedScreenNames.join('、')}`);
    }
    if (params.screenPlans.length > 0) {
        lines.push('屏规划:');
        lines.push(...params.screenPlans.map((plan) => `- ${formatDetailScreenPlanLine(plan)}`));
    }
    if (params.phaseDurations && Object.keys(params.phaseDurations).length > 0) {
        const phaseText = Object.entries(params.phaseDurations)
            .map(([name, duration]) => `${name} ${duration}ms`)
            .join('；');
        lines.push(`阶段耗时: ${phaseText}`);
    }
    if (params.exportResult?.success) {
        lines.push(`导出: 已输出 ${params.exportResult.exportedCount || 0} 张切片`);
    }
    lines.push(`总耗时: ${(params.totalTime / 1000).toFixed(1)}s`);

    return lines.join('\n');
}

export function buildDetailInspectionSummary(params: {
    screens: ParsedScreen[];
    screenPlans: DetailScreenPlan[];
    readiness: ReturnType<typeof assessDetailPageTemplateReadiness>;
    layoutAssessment: ReturnType<typeof analyzeDetailPageLayout>;
    visualPlanning: DetailVisualPlanningContext;
    focus?: DetailFocusContext;
    anchorDiagnostics: ReturnType<typeof analyzeDetailPlaceholderAnchors>;
    copyLayoutAudit?: {
        summary?: {
            riskyCopyCount?: number;
            watchCopyCount?: number;
            warningCount?: number;
        };
        warnings?: string[];
    };
    totalTime: number;
}): string {
    const lines: string[] = [
        '详情页结构检查完成。',
        '',
        `模板评估: ${params.readiness.mode} (${Math.round(params.readiness.score * 100)} 分)`,
        `版式评估: ${params.layoutAssessment.mode} (${Math.round(params.layoutAssessment.score * 100)} 分)`,
        `视觉分块: ${params.visualPlanning.mergeStatus}（视觉屏 ${params.visualPlanning.visualScreenCount} / 模块 ${params.visualPlanning.visualModuleCount}）`,
        `当前共识别 ${params.screens.length} 屏`
    ];

    if (params.readiness.risks.length > 0) {
        lines.push(`结构风险: ${params.readiness.risks.join('；')}`);
    }
    if (params.focus?.focusedScreenName) {
        const roleText = params.focus.focusedScreenRole
            ? ` / ${describeDetailScreenRole(params.focus.focusedScreenRole as DetailScreenRole)}`
            : '';
        lines.push(`当前关注点: ${params.focus.focusedScreenName}${roleText}`);
    }
    if (params.layoutAssessment.warnings.length > 0) {
        lines.push(`版式提示: ${params.layoutAssessment.warnings.join('；')}`);
    }
    if (params.anchorDiagnostics.warnings.length > 0) {
        lines.push(`锚点风险: ${params.anchorDiagnostics.warnings.join('；')}`);
    }
    if (params.visualPlanning.warnings.length > 0) {
        lines.push(`视觉分割提示: ${params.visualPlanning.warnings.join('；')}`);
    }
    if (params.copyLayoutAudit?.summary) {
        lines.push(
            `文案布局风险: 高风险 ${params.copyLayoutAudit.summary.riskyCopyCount || 0}，观察项 ${params.copyLayoutAudit.summary.watchCopyCount || 0}`
        );
    }
    if (params.screenPlans.length > 0) {
        lines.push('屏规划:');
        lines.push(...params.screenPlans.map((plan) => `- ${formatDetailScreenPlanLine(plan)}`));
    }
    lines.push(`总耗时: ${(params.totalTime / 1000).toFixed(1)}s`);

    return lines.join('\n');
}

function summarizeDetailCopyGeneration(fillPlans: FillPlan[]) {
    const totalCopies = fillPlans.reduce((sum, plan) => sum + (plan.copies?.length || 0), 0);
    const generatedCopies = fillPlans.reduce(
        (sum, plan) => sum + (plan.copies || []).filter((copy) => copy.source === 'ai_generated' || copy.generationStatus === 'generated').length,
        0
    );
    const screensWithGeneratedCopy = new Set<number>();
    const strategiesUsed = new Set<string>();

    for (const plan of fillPlans) {
        if (plan.copyStrategy) strategiesUsed.add(plan.copyStrategy);
        if ((plan.copies || []).some((copy) => copy.source === 'ai_generated' || copy.generationStatus === 'generated')) {
            screensWithGeneratedCopy.add(plan.screenId);
        }
    }

    return {
        totalCopies,
        generatedCopies,
        templateCopies: Math.max(0, totalCopies - generatedCopies),
        screensWithGeneratedCopy: screensWithGeneratedCopy.size,
        strategiesUsed: Array.from(strategiesUsed)
    };
}

function removeRiskyPlanImages(plan: FillPlan, riskyLayerIds: Set<number>): FillPlan {
    if (!riskyLayerIds.size || !Array.isArray(plan.images) || plan.images.length === 0) {
        return plan;
    }
    return {
        ...plan,
        images: plan.images.filter((image) => !riskyLayerIds.has(Number(image.layerId || 0)))
    };
}

export async function buildDetailVisualPlanningContext(params: {
    screens: ParsedScreen[];
    runTool: DetailToolRunner;
    results: Array<Record<string, unknown>>;
}): Promise<DetailVisualPlanningContext> {
    const { screens, runTool, results } = params;
    const emptyMergeAudit: DetailSegmentationMergeAudit = {
        status: 'watch',
        summary: {
            parsedScreenCount: screens.length,
            visualScreenCount: 0,
            moduleCount: 0,
            lowOverlapScreenCount: 0,
            unmatchedVisualScreenCount: 0,
            modulesWithoutSourceScreenCount: 0
        },
        lowOverlapScreens: [],
        unmatchedVisualScreens: [],
        modulesWithoutSourceScreen: []
    };

    if (!Array.isArray(screens) || screens.length === 0) {
        return {
            visualSummaries: [],
            mergeStatus: 'watch',
            visualScreenCount: 0,
            visualModuleCount: 0,
            warnings: ['没有可用于视觉分块的屏'],
            documentInfo: null,
            flatLayers: [],
            visualScreens: [],
            visualModules: [],
            mergeAudit: emptyMergeAudit
        };
    }

    const docInfoResult = await runTool('getDocumentInfo', {});
    results.push({ toolName: 'getDocumentInfo[detailVisualPlanning]', result: docInfoResult });
    if (!docInfoResult?.success) {
        return {
            visualSummaries: [],
            mergeStatus: 'watch',
            visualScreenCount: 0,
            visualModuleCount: 0,
            warnings: ['无法读取文档信息，视觉分块未参与本轮规划'],
            documentInfo: null,
            flatLayers: [],
            visualScreens: [],
            visualModules: [],
            mergeAudit: emptyMergeAudit
        };
    }

    const hierarchyResult = await runTool('getLayerHierarchy', { includeBounds: true, flatList: true });
    results.push({ toolName: 'getLayerHierarchy[detailVisualPlanning]', result: hierarchyResult });

    const flatLayers = normalizeDetailFlatLayers(hierarchyResult);
    const width = Math.max(0, Number(docInfoResult?.width || 0));
    const height = Math.max(0, Number(docInfoResult?.height || 0));
    if (!flatLayers.length || width <= 0 || height <= 0) {
        return {
            visualSummaries: [],
            mergeStatus: 'watch',
            visualScreenCount: 0,
            visualModuleCount: 0,
            warnings: ['文档几何信息不完整，视觉分块未参与本轮规划'],
            documentInfo: docInfoResult,
            flatLayers,
            visualScreens: [],
            visualModules: [],
            mergeAudit: emptyMergeAudit
        };
    }

    const documentBounds = { left: 0, top: 0, right: width, bottom: height, width, height };
    const visualScreens = buildDetailVisualScreenBoundaries({ screens, flatLayers, documentBounds });
    const visualModules = buildDetailVisualModules({ screens, visualScreens, flatLayers, documentBounds });
    const mergeAudit = auditDetailSegmentationMerge({ screens, visualScreens, visualModules });
    const visualSummaries = buildDetailScreenVisualSummaries({
        screens: screens as unknown as Array<Record<string, unknown>>,
        visualScreens,
        visualModules,
        mergeAudit
    });

    return {
        visualSummaries,
        mergeStatus: mergeAudit.status,
        visualScreenCount: visualScreens.length,
        visualModuleCount: visualModules.length,
        warnings: mergeAudit.lowOverlapScreens.map((item) => `${item.screenName} 的视觉边界和结构边界重合度偏低`),
        documentInfo: docInfoResult,
        flatLayers,
        visualScreens,
        visualModules,
        mergeAudit
    };
}

export async function readDetailFocusContext(params: {
    screens: ParsedScreen[];
    screenPlans: DetailScreenPlan[];
    visualPlanning: DetailVisualPlanningContext;
    runTool: DetailToolRunner;
    results: Array<Record<string, unknown>>;
}): Promise<DetailFocusContext> {
    const { screens, screenPlans, visualPlanning, runTool, results } = params;

    const fallback: DetailFocusContext = {
        selectedDesignContext: null,
        selectedScene: null,
        selectedElementContext: null,
        selectedModuleContext: null,
        focusedScreenId: null,
        focusedScreenName: null,
        focusedScreenRole: null,
        focusedVisualModuleId: null,
        focusedModuleInferenceMode: null
    };

    if (!visualPlanning.documentInfo || visualPlanning.flatLayers.length === 0) {
        return fallback;
    }

    const diagnoseState = await runTool('diagnoseState', { verbose: false });
    results.push({ toolName: 'diagnoseState[detailFocus]', result: diagnoseState });
    if (!diagnoseState?.success) {
        return fallback;
    }

    const state = diagnoseState?.state && typeof diagnoseState.state === 'object'
        ? diagnoseState.state as Record<string, unknown>
        : {};
    const selectedLayers = Array.isArray(state.selectedLayers)
        ? state.selectedLayers as Array<Record<string, unknown>>
        : [];
    const selectedLayerId = selectedLayers.length > 0 && typeof selectedLayers[0]?.id === 'number'
        ? Number(selectedLayers[0].id)
        : null;
    if (!selectedLayerId) {
        return fallback;
    }

    const selectedNode = visualPlanning.flatLayers.find((layer) => Number(layer?.id || 0) === selectedLayerId) || null;
    if (!selectedNode) {
        return fallback;
    }

    const propertiesPayload = await runTool('getLayerProperties', { layerId: selectedLayerId });
    results.push({ toolName: 'getLayerProperties[detailFocus]', result: propertiesPayload });
    const boundsPayload = await runTool('getLayerBounds', { layerId: selectedLayerId });
    results.push({ toolName: 'getLayerBounds[detailFocus]', result: boundsPayload });
    const clippingPayload = await runTool('getClippingMaskInfo', { layerId: selectedLayerId });
    results.push({ toolName: 'getClippingMaskInfo[detailFocus]', result: clippingPayload });

    const properties = propertiesPayload?.success ? propertiesPayload : null;
    const bounds = boundsPayload?.success ? boundsPayload : null;
    const clipping = clippingPayload?.success ? clippingPayload : null;
    const propertyRecord = properties?.properties && typeof properties.properties === 'object'
        ? properties.properties as Record<string, unknown>
        : {};
    const layerKind = String(propertyRecord.kind || selectedNode.kind || '').toLowerCase();
    const isTextLayer = layerKind.includes('text');

    let textContentPayload: Record<string, unknown> | null = null;
    let textStylePayload: Record<string, unknown> | null = null;
    if (isTextLayer) {
        const textContent = await runTool('getTextContent', { layerId: selectedLayerId });
        results.push({ toolName: 'getTextContent[detailFocus]', result: textContent });
        const textStyle = await runTool('getTextStyle', { layerId: selectedLayerId });
        results.push({ toolName: 'getTextStyle[detailFocus]', result: textStyle });
        textContentPayload = textContent?.success ? textContent : null;
        textStylePayload = textStyle?.success ? textStyle : null;
    }

    const selectedElementContext = buildSelectedElementContext({
        source: 'active-layer',
        documentInfo: visualPlanning.documentInfo,
        selectedNode: {
            ...selectedNode,
            bounds: propertyRecord.bounds || bounds?.bounds || selectedNode.bounds
        },
        flatLayers: visualPlanning.flatLayers,
        propertiesPayload: properties,
        clippingPayload: clipping,
        textContentPayload,
        textStylePayload,
        detailPayload: {
            success: true,
            screens,
            screenPlans,
            visualModules: visualPlanning.visualModules,
            audit: visualPlanning.mergeAudit
        },
        includeText: isTextLayer,
        includeDetailContext: true,
        relationLimit: 6,
        usedTools: [
            'diagnoseState',
            'getLayerProperties',
            'getLayerBounds',
            'getClippingMaskInfo',
            ...(isTextLayer ? ['getTextContent', 'getTextStyle'] : [])
        ]
    });

    const selectedModuleContext = buildSelectedModuleContext({
        selectedElementContext,
        visualModules: visualPlanning.visualModules,
        visualScreens: visualPlanning.visualScreens,
        relationLimit: 6
    });

    const selectedDesignContext: SelectedDesignContext = buildSelectedDesignContext({
        selectedElementContext,
        selectedModuleContext
    });
    const selectedScene = selectedDesignContext.scene ?? null;

    return {
        selectedDesignContext,
        selectedScene,
        selectedElementContext,
        selectedModuleContext,
        focusedScreenId: selectedScene?.selectedScreen?.sourceScreenId ?? selectedElementContext.detail?.screenId ?? null,
        focusedScreenName: selectedScene?.selectedScreen?.name ?? selectedElementContext.detail?.screenName ?? null,
        focusedScreenRole: selectedScene?.selectedScreen?.role ?? selectedElementContext.detail?.screenRole ?? null,
        focusedVisualModuleId: selectedScene?.selectedModule?.id ?? selectedElementContext.detail?.visualModuleId ?? null,
        focusedModuleInferenceMode: selectedModuleContext.diagnostics.inferenceMode
    };
}

function sortDetailScreensByFocus<T extends { id?: number; screenId?: number }>(items: T[], focusedScreenId: number | null): T[] {
    if (!focusedScreenId) return items;
    return [...items].sort((a, b) => {
        const aId = Number(a.id || a.screenId || 0);
        const bId = Number(b.id || b.screenId || 0);
        const aFocus = aId === focusedScreenId ? 1 : 0;
        const bFocus = bId === focusedScreenId ? 1 : 0;
        return bFocus - aFocus;
    });
}

function normalizeTargetText(value: unknown): string {
    return String(value || '')
        .normalize('NFKC')
        .replace(/\s+/g, '')
        .toLowerCase();
}

function collectTargetScopeValues(value: unknown): unknown[] {
    if (Array.isArray(value)) return value.flatMap((item) => collectTargetScopeValues(item));
    if (!value || typeof value !== 'object') return [value];
    const record = value as Record<string, unknown>;
    return [
        record.screenId,
        record.screenIds,
        record.screenIndex,
        record.screenIndexes,
        record.screenName,
        record.screenNames,
        record.layerId,
        record.layerIds,
        record.layerName,
        record.layerNames,
        record.description
    ].flatMap((item) => collectTargetScopeValues(item));
}

function collectLayerTargetScopeValues(value: unknown): unknown[] {
    if (Array.isArray(value)) return value.flatMap((item) => collectLayerTargetScopeValues(item));
    if (!value || typeof value !== 'object') return [value];
    const record = value as Record<string, unknown>;
    return [
        record.layerId,
        record.layerIds,
        record.layerName,
        record.layerNames,
        record.description
    ].flatMap((item) => collectLayerTargetScopeValues(item));
}

function collectScreenTargetScopeValues(value: unknown): unknown[] {
    if (Array.isArray(value)) return value.flatMap((item) => collectScreenTargetScopeValues(item));
    if (!value || typeof value !== 'object') return [value];
    const record = value as Record<string, unknown>;
    return [
        record.screenId,
        record.screenIds,
        record.screenIndex,
        record.screenIndexes,
        record.screenName,
        record.screenNames,
        record.description
    ].flatMap((item) => collectScreenTargetScopeValues(item));
}

function targetScopeDeclaresLayer(
    value: unknown,
    screens: readonly ParsedScreen[]
): boolean {
    if (Array.isArray(value)) {
        return value.some((item) => targetScopeDeclaresLayer(item, screens));
    }
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const explicitLayerValues = [
            record.layerId,
            record.layerIds,
            record.layerName,
            record.layerNames
        ].flatMap((item) => collectLayerTargetScopeValues(item));
        if (explicitLayerValues.some((item) => normalizeTargetText(item).length > 0)) return true;
        return targetScopeDeclaresLayer(record.description, screens);
    }
    const normalized = normalizeTargetText(value);
    if (!normalized) return false;
    const numeric = Number(value);
    if (Number.isSafeInteger(numeric) && numeric > 0) {
        const matchesScreen = screens.some((screen) => Number(screen.id) === numeric);
        const matchesLayer = screens.some((screen) => (
            [...(screen.copyPlaceholders || []), ...(screen.imagePlaceholders || [])]
                .some((placeholder) => Number(placeholder.layerId) === numeric)
        ));
        return matchesLayer && !matchesScreen;
    }
    if (screens.some((screen) => normalizeTargetText(screen.name) === normalized)) return false;
    let remainder = normalized.replace(/第\d+屏/gu, '');
    for (const screen of screens) {
        const screenName = normalizeTargetText(screen.name);
        if (screenName && remainder.includes(screenName)) {
            remainder = remainder.split(screenName).join('');
        }
    }
    return remainder.length > 0;
}

function screenMatchesTargetToken(screen: ParsedScreen, token: unknown): boolean {
    const numeric = Number(token);
    if (Number.isSafeInteger(numeric) && numeric > 0) {
        return Number(screen.id) === numeric;
    }
    const normalized = normalizeTargetText(token);
    if (!normalized) return false;
    if (normalizeTargetText(screen.name) === normalized) return true;
    const screenName = normalizeTargetText(screen.name);
    return Boolean(
        screenName
        && (screenName.includes(normalized) || normalized.includes(screenName))
    );
}

function resolveTargetLayerIds(
    screens: readonly ParsedScreen[],
    scopeValues: readonly unknown[]
): number[] {
    const normalizedScreenNames = new Set(screens.map((screen) => normalizeTargetText(screen.name)));
    const layerScopeValues = scopeValues.filter((value) => {
        const normalized = normalizeTargetText(value);
        if (!normalized) return false;
        if (/^第\d+屏$/u.test(normalized)) return false;
        return !normalizedScreenNames.has(normalized);
    });
    const normalizedScopeValues = layerScopeValues
        .map((value) => normalizeTargetText(value))
        .filter(Boolean);
    return Array.from(new Set(screens.flatMap((screen) => (
        [...(screen.copyPlaceholders || []), ...(screen.imagePlaceholders || [])]
            .filter((placeholder) => {
                const layerId = Number(placeholder.layerId || 0);
                if (layerScopeValues.some((value) => Number(value) === layerId && layerId > 0)) {
                    return true;
                }
                const layerName = normalizeTargetText(placeholder.layerName);
                if (!layerName) return false;
                return normalizedScopeValues.some((scopeValue) => (
                    scopeValue === layerName
                    || scopeValue.includes(layerName)
                    || layerName.includes(scopeValue)
                ));
            })
            .map((placeholder) => Number(placeholder.layerId || 0))
            .filter((layerId) => layerId > 0)
    ))));
}

export function resolveDetailPageExplicitTargetScreens(input: {
    screens: readonly ParsedScreen[];
    targetScope: unknown;
}): DetailPageTargetScopeResolution {
    const scopeValues = collectTargetScopeValues(input.targetScope)
        .filter((value) => normalizeTargetText(value).length > 0);
    if (scopeValues.length === 0) {
        return {
            explicit: false,
            matched: false,
            ambiguous: false,
            screens: [],
            targetScreenIds: [],
            targetLayerIds: [],
            targetKind: 'screen',
            message: 'edit_existing 需要显式 targetScope，不能默认把局部修改扩大为整页填充。'
        };
    }

    const screenScopeValues = collectScreenTargetScopeValues(input.targetScope)
        .filter((value) => normalizeTargetText(value).length > 0);
    const ordinalIndexes = new Set<number>();
    for (const value of screenScopeValues) {
        const text = String(value || '');
        for (const match of text.matchAll(/第\s*(\d+)\s*屏/gu)) {
            const ordinal = Number(match[1]);
            if (Number.isSafeInteger(ordinal) && ordinal > 0) ordinalIndexes.add(ordinal - 1);
        }
    }
    const screenMatches = input.screens.filter((screen, index) => (
        ordinalIndexes.has(index)
        || screenScopeValues.some((value) => screenMatchesTargetToken(screen, value))
    ));
    // 组合 targetScope 必须先确定屏，再在该屏内找图层；否则模板里各屏复用
    // “D40”一类同名占位符时，会把单屏局部编辑扩张成跨屏写入。
    const layerSearchScreens = screenMatches.length > 0 ? screenMatches : input.screens;
    const layerScopeValues = collectLayerTargetScopeValues(input.targetScope);
    const declaresLayer = targetScopeDeclaresLayer(input.targetScope, input.screens);
    const targetLayerIds = resolveTargetLayerIds(
        layerSearchScreens,
        layerScopeValues
    );
    const targetLayerIdSet = new Set(targetLayerIds);
    const layerScreens = layerSearchScreens.filter((screen) => (
        [...(screen.copyPlaceholders || []), ...(screen.imagePlaceholders || [])]
            .some((placeholder) => targetLayerIdSet.has(Number(placeholder.layerId || 0)))
    ));
    const hasStableScreenSelector = ordinalIndexes.size > 0
        || screenScopeValues.some((value) => {
            const numeric = Number(value);
            return Number.isSafeInteger(numeric)
                && input.screens.some((screen) => Number(screen.id) === numeric);
        });
    const hasStableLayerSelector = layerScopeValues.some((value) => {
        const numeric = Number(value);
        return Number.isSafeInteger(numeric)
            && numeric > 0
            && targetLayerIdSet.has(numeric);
    });
    const ambiguousScreenName = screenMatches.length > 1 && !hasStableScreenSelector;
    const ambiguousLayerName = targetLayerIds.length > 1 && !hasStableLayerSelector;
    const ambiguous = ambiguousScreenName || ambiguousLayerName;
    const unresolvedLayerTarget = declaresLayer && targetLayerIds.length === 0;
    // 图层是比屏更窄的目标。只要 scope 能明确命中占位图层，就绝不因同一句里
    // 还出现“第 N 屏”而退化成整屏填充。
    let selected = screenMatches;
    if (ambiguous || unresolvedLayerTarget) {
        selected = [];
    } else if (layerScreens.length > 0) {
        selected = layerScreens;
    }
    const targetScreenIds = Array.from(new Set(selected
        .map((screen) => Number(screen.id || 0))
        .filter((id) => id > 0)));
    const resolvedTargetLayerIds = ambiguous ? [] : targetLayerIds;
    const targetKind = resolvedTargetLayerIds.length > 0 ? 'layer' : 'screen';
    let message = 'targetScope 无法对应到当前详情页任一屏或占位图层，已拒绝整页兜底。';
    if (ambiguous) {
        message = 'targetScope 命中多个同名屏或同名图层；请补充第N屏、screenId 或 layerId，系统不会静默扩大写入范围。';
    } else if (unresolvedLayerTarget) {
        message = 'targetScope 明确指定了局部图层，但该图层没有在目标屏中命中；系统已拒绝降级为整屏编辑。';
    } else if (selected.length > 0 && targetKind === 'layer') {
        message = `局部编辑已限定到 ${selected.map((screen) => screen.name).join('、')} 的 ${resolvedTargetLayerIds.length} 个明确图层。`;
    } else if (selected.length > 0) {
        message = `局部编辑已限定到 ${selected.map((screen) => screen.name).join('、')}。`;
    }
    return {
        explicit: true,
        matched: selected.length > 0,
        ambiguous,
        screens: selected,
        targetScreenIds,
        targetLayerIds: resolvedTargetLayerIds,
        targetKind,
        message
    };
}

export function collectDetailPageEditableLayerIds(
    screens: readonly ParsedScreen[],
    editContentMode: DetailPageEditContentMode
): number[] {
    const layerIds: number[] = [];
    for (const screen of screens) {
        if (editContentMode !== 'image_only') {
            layerIds.push(...(screen.copyPlaceholders || []).map((copy) => Number(copy.layerId || 0)));
        }
        if (editContentMode !== 'copy_only') {
            layerIds.push(...(screen.imagePlaceholders || []).map((image) => Number(image.layerId || 0)));
        }
    }
    return Array.from(new Set(layerIds.filter((layerId) => layerId > 0)));
}

export function scopeDetailPageScreenToEditContentMode(
    screen: ParsedScreen,
    editContentMode: DetailPageEditContentMode
): ParsedScreen {
    return {
        ...screen,
        copyPlaceholders: editContentMode === 'image_only'
            ? []
            : (screen.copyPlaceholders || []),
        imagePlaceholders: editContentMode === 'copy_only'
            ? []
            : (screen.imagePlaceholders || [])
    };
}

export function scopeDetailPageFillPlanToEditContentMode(
    plan: FillPlan,
    editContentMode: DetailPageEditContentMode
): FillPlan {
    return {
        ...plan,
        copyExpected: editContentMode === 'image_only' ? false : plan.copyExpected,
        copies: editContentMode === 'image_only' ? [] : (plan.copies || []),
        images: editContentMode === 'copy_only' ? [] : (plan.images || []),
        ...({ icons: [] } as Record<string, unknown>)
    };
}

export function buildDetailPageVisualRepairToolAllowlist(input: {
    workMode: string;
    editContentMode?: DetailPageEditContentMode | '';
}): string[] {
    const readAndAuditTools = [
        'getScreenSnapshots',
        'getAnnotatedSnapshot',
        'parseDetailPageTemplate',
        'getLayerHierarchy',
        'getLayerBounds',
        'getLayerProperties',
        'getTextContent',
        'auditDetailPagePlacement'
    ];
    const geometryTools = [
        'moveLayer',
        'alignToReference',
        'transformLayer'
    ];
    const isScopedEdit = String(input.workMode || '').trim() === 'edit_existing';
    const allowCopyStyle = !isScopedEdit
        || input.editContentMode === 'copy_only'
        || input.editContentMode === 'both';
    const allowImageFit = !isScopedEdit
        || input.editContentMode === 'image_only'
        || input.editContentMode === 'both';
    return [
        ...readAndAuditTools,
        ...(allowImageFit ? geometryTools : []),
        ...(allowCopyStyle ? ['setTextStyle'] : []),
        ...(allowImageFit ? ['fitLayerSubjectToRegion'] : [])
    ];
}

export function scopeDetailPageScreenToTargetLayers(
    screen: ParsedScreen,
    targetLayerIds: readonly number[]
): ParsedScreen {
    const targetIds = new Set(targetLayerIds.map(Number).filter((layerId) => layerId > 0));
    if (targetIds.size === 0) return screen;
    return {
        ...screen,
        copyPlaceholders: (screen.copyPlaceholders || []).filter((copy) => (
            targetIds.has(Number(copy.layerId || 0))
        )),
        imagePlaceholders: (screen.imagePlaceholders || []).filter((image) => (
            targetIds.has(Number(image.layerId || 0))
        ))
    };
}

export function scopeDetailPageFillPlanToTargetLayers(
    plan: FillPlan,
    targetLayerIds: readonly number[]
): FillPlan {
    const targetIds = new Set(targetLayerIds.map(Number).filter((layerId) => layerId > 0));
    if (targetIds.size === 0) return plan;
    return {
        ...plan,
        copies: (plan.copies || []).filter((copy) => targetIds.has(Number(copy.layerId || 0))),
        images: (plan.images || []).filter((image) => targetIds.has(Number(image.layerId || 0))),
        // UXP 的旧 FillPlan 仍接受 icons；局部图层模式显式清空未纳入契约的写列表，
        // 防止上游对象残留字段绕过目标图层边界。
        ...({ icons: [] } as Record<string, unknown>)
    };
}

export function buildDetailPageDeliveryCandidate(input: {
    exportRequested: boolean;
    workMode: string;
    targetScreenIds: readonly number[];
    targetLayerIds?: readonly number[];
    repairAllowedToolNames?: readonly string[];
    reviewAllowedToolNames?: readonly string[];
    checks: Record<string, boolean>;
}): DetailPageDeliveryCandidate {
    const failedChecks = Object.entries(input.checks)
        .filter(([, passed]) => passed !== true)
        .map(([name]) => name);
    const deterministicChecksPassed = failedChecks.length === 0;
    let status: DetailPageDeliveryCandidate['status'] = 'not_ready';
    if (deterministicChecksPassed) {
        status = 'awaiting_visual_review';
    }
    return {
        version: 'detail-page-delivery-candidate/v1',
        status,
        deterministicChecksPassed,
        requiresVisualPass: true,
        completeOnVisualPass: !input.exportRequested,
        exportRequested: input.exportRequested,
        workMode: String(input.workMode || '').trim(),
        targetScreenIds: Array.from(new Set(input.targetScreenIds.map(Number).filter((id) => id > 0))),
        targetLayerIds: Array.from(new Set((input.targetLayerIds || [])
            .map(Number)
            .filter((id) => id > 0))),
        repairAllowedToolNames: Array.from(new Set((input.repairAllowedToolNames || [])
            .map((toolName) => String(toolName || '').trim())
            .filter(Boolean))),
        reviewAllowedToolNames: Array.from(new Set((input.reviewAllowedToolNames || [])
            .map((toolName) => String(toolName || '').trim())
            .filter(Boolean))),
        failedChecks
    };
}

function resolveAttachedImageFormat(
    mediaType: DesignImageInput['mediaType']
): 'png' | 'jpeg' | 'webp' {
    if (mediaType === 'image/png') return 'png';
    if (mediaType === 'image/webp') return 'webp';
    return 'jpeg';
}

export function applyAttachedImagesToDetailFillPlans(
    plans: readonly FillPlan[],
    attachedImages: readonly DesignImageInput[]
): FillPlan[] {
    const usableImages = attachedImages.filter((image) => (
        String(image?.data || '').trim().length > 0
    ));
    if (usableImages.length === 0) return plans.slice();
    const totalImageSlots = plans.reduce((count, plan) => count + (plan.images || []).length, 0);
    const unambiguousSinglePlacement = usableImages.length === 1 && totalImageSlots === 1;
    let attachmentIndex = 0;
    return plans.map((plan) => ({
        ...plan,
        images: (plan.images || []).map((image) => {
            const attachment = usableImages[attachmentIndex];
            if (!attachment) return image;
            attachmentIndex += 1;
            const attachmentRef = `attachment:${String(attachment.id || attachment.name || attachmentIndex).trim()}`;
            const candidateSetId = `detail-attachments:${Number(plan.screenId || 0)}:${Number(image.layerId || 0)}`;
            const candidateId = `${candidateSetId}:${attachmentIndex}`;
            const assetUsageDecision = image.assetUsageDecision || {
                visualObserved: true,
                visualRole: 'unknown' as const,
                backgroundType: 'unknown' as const,
                directUseSuitability: 'conditional' as const,
                sourceTreatment: 'requires_visual_review' as const,
                automaticPlacementEligible: false,
                reason: '用户提供了附件，但多个附件或多个图片区之间的映射仍需主 Agent 决定。'
            };
            const assetCandidates = [{
                candidateSetId,
                candidateId,
                imagePath: attachmentRef,
                score: 1,
                reasons: ['user_attachment'],
                placementSafetyEligible: unambiguousSinglePlacement,
                needsMatting: false,
                assetUsageDecision
            }];
            if (!unambiguousSinglePlacement) {
                return {
                    ...image,
                    imagePath: '',
                    imageData: undefined,
                    assetCandidates,
                    requiresModelAssetDecision: true,
                    executionDeferred: true,
                    selectionReason: '用户附件已进入候选集；主 Agent 尚未决定它对应哪个详情页图片区。'
                };
            }
            return {
                ...image,
                imagePath: '',
                imageData: String(attachment.data).trim(),
                imageFormat: resolveAttachedImageFormat(attachment.mediaType),
                assetType: image.assetType || 'product',
                fitReason: image.fitReason || `用户附件 ${attachment.name || attachment.id}`,
                assetCandidates,
                requiresModelAssetDecision: false,
                selectionReceipt: {
                    version: 'detail-asset-selection-receipt/v0',
                    screenId: Number(plan.screenId || 0),
                    placeholderLayerId: Number(image.layerId || 0),
                    candidateSetId,
                    candidateId,
                    selectedAssetPath: attachmentRef,
                    selectedBy: 'user',
                    decisionId: `user-attachment:${String(attachment.id || attachment.name || attachmentIndex).trim()}`
                },
                executionDeferred: false
            };
        })
    }));
}

function normalizeBoundsForComparison(value: any): Record<string, number> {
    return {
        top: Math.round(Number(value?.top || 0) * 100) / 100,
        left: Math.round(Number(value?.left || 0) * 100) / 100,
        bottom: Math.round(Number(value?.bottom || 0) * 100) / 100,
        right: Math.round(Number(value?.right || 0) * 100) / 100
    };
}

function buildDetailScreenStructureFingerprint(
    screen: ParsedScreen,
    excludedLayerIds: ReadonlySet<number> = new Set<number>()
): string {
    return JSON.stringify({
        id: Number(screen.id || 0),
        name: String(screen.name || '').trim(),
        type: String(screen.type || '').trim(),
        bounds: normalizeBoundsForComparison(screen.bounds),
        copies: (screen.copyPlaceholders || [])
            .filter((copy) => !excludedLayerIds.has(Number(copy.layerId || 0)))
            .map((copy) => ({
            layerId: Number(copy.layerId || 0),
            layerName: String(copy.layerName || '').trim(),
            currentText: String(copy.currentText ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim(),
            bounds: normalizeBoundsForComparison(copy.bounds)
        })),
        images: (screen.imagePlaceholders || [])
            .filter((image) => !excludedLayerIds.has(Number(image.layerId || 0)))
            .map((image) => ({
            layerId: Number(image.layerId || 0),
            layerName: String(image.layerName || '').trim(),
            baseLayerId: Number(image.baseLayerId || 0),
            bounds: normalizeBoundsForComparison(image.bounds)
        }))
    });
}

export function verifyDetailPageOutOfScopeScreensUnchanged(input: {
    beforeScreens: readonly ParsedScreen[];
    afterScreens: readonly ParsedScreen[];
    targetScreenIds: readonly number[];
    targetLayerIds?: readonly number[];
}): DetailPageOutOfScopeVerification {
    const targetIds = new Set(input.targetScreenIds.map(Number).filter((id) => id > 0));
    const targetLayerIds = new Set((input.targetLayerIds || []).map(Number).filter((id) => id > 0));
    const beforeById = new Map(input.beforeScreens
        .filter((screen) => (
            !targetIds.has(Number(screen.id || 0))
            || targetLayerIds.size > 0
        ))
        .map((screen) => [Number(screen.id || 0), screen]));
    const afterById = new Map(input.afterScreens.map((screen) => [Number(screen.id || 0), screen]));
    const missingScreenIds: number[] = [];
    const changedScreenIds: number[] = [];
    for (const [screenId, before] of beforeById.entries()) {
        const after = afterById.get(screenId);
        if (!after) {
            missingScreenIds.push(screenId);
            continue;
        }
        const excludedLayerIds = targetIds.has(screenId)
            ? targetLayerIds
            : new Set<number>();
        if (
            buildDetailScreenStructureFingerprint(before, excludedLayerIds)
            !== buildDetailScreenStructureFingerprint(after, excludedLayerIds)
        ) {
            changedScreenIds.push(screenId);
        }
    }
    const beforeIds = new Set(input.beforeScreens.map((screen) => Number(screen.id || 0)));
    const foreignScreenIds = input.afterScreens
        .map((screen) => Number(screen.id || 0))
        .filter((screenId) => screenId > 0 && !beforeIds.has(screenId));
    const status = missingScreenIds.length === 0
        && changedScreenIds.length === 0
        && foreignScreenIds.length === 0
        ? 'passed'
        : 'failed';
    let message = `局部编辑越界：缺失屏 ${missingScreenIds.join('、') || '无'}，变化屏 ${changedScreenIds.join('、') || '无'}，新增屏 ${foreignScreenIds.join('、') || '无'}。`;
    if (status === 'passed' && targetLayerIds.size > 0) {
        message = '局部编辑目标图层外的屏结构、文字与占位边界保持不变。';
    } else if (status === 'passed') {
        message = '局部编辑目标外屏的结构、文字与占位边界保持不变。';
    }
    return {
        status,
        checkedScreenIds: Array.from(beforeById.keys()),
        missingScreenIds,
        changedScreenIds,
        foreignScreenIds: Array.from(new Set(foreignScreenIds)),
        message
    };
}

function readSnapshotItems(result: any): any[] {
    const candidates = [
        result?.snapshots,
        result?.data?.snapshots,
        result?.result?.snapshots,
        result?.output?.snapshots,
        result?.screens,
        result?.data?.screenSnapshots
    ];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) return candidate;
    }
    return [];
}

function readSnapshotPayload(snapshot: any): string {
    return String(snapshot?.base64 || snapshot?.imageData || '').trim();
}

export function verifyDetailPageOutOfScopeSnapshotsUnchanged(input: {
    expectedScreens: readonly ParsedScreen[];
    beforeResult: any;
    afterResult: any;
}): DetailPageOutOfScopePixelVerification {
    const expectedScreenIds = Array.from(new Set(input.expectedScreens
        .map((screen) => Number(screen.id || 0))
        .filter((screenId) => screenId > 0)));
    const expectedIds = new Set(expectedScreenIds);
    const beforeBuckets = new Map<number, string[]>();
    const afterBuckets = new Map<number, string[]>();
    const addSnapshots = (target: Map<number, string[]>, result: any): void => {
        readSnapshotItems(result).forEach((snapshot) => {
            const screenId = Number(snapshot?.screenId || 0);
            const payload = readSnapshotPayload(snapshot);
            if (!expectedIds.has(screenId) || !payload) return;
            const bucket = target.get(screenId) || [];
            bucket.push(payload);
            target.set(screenId, bucket);
        });
    };
    addSnapshots(beforeBuckets, input.beforeResult);
    addSnapshots(afterBuckets, input.afterResult);

    const missingBeforeScreenIds = expectedScreenIds.filter((screenId) => (
        (beforeBuckets.get(screenId) || []).length === 0
    ));
    const missingAfterScreenIds = expectedScreenIds.filter((screenId) => (
        (afterBuckets.get(screenId) || []).length === 0
    ));
    const duplicateScreenIds = expectedScreenIds.filter((screenId) => (
        (beforeBuckets.get(screenId) || []).length > 1
        || (afterBuckets.get(screenId) || []).length > 1
    ));
    const changedScreenIds = expectedScreenIds.filter((screenId) => {
        const before = beforeBuckets.get(screenId) || [];
        const after = afterBuckets.get(screenId) || [];
        if (before.length !== 1 || after.length !== 1) return false;
        return sha256Hex(before[0]) !== sha256Hex(after[0]);
    });
    const status = missingBeforeScreenIds.length === 0
        && missingAfterScreenIds.length === 0
        && duplicateScreenIds.length === 0
        && changedScreenIds.length === 0
        ? 'passed'
        : 'failed';
    return {
        status,
        checkedScreenIds: expectedScreenIds,
        missingBeforeScreenIds,
        missingAfterScreenIds,
        duplicateScreenIds,
        changedScreenIds,
        message: status === 'passed'
            ? `目标外 ${expectedScreenIds.length} 屏前后像素保持一致。`
            : `局部编辑目标外像素变化：前置缺失 ${missingBeforeScreenIds.join('、') || '无'}，后置缺失 ${missingAfterScreenIds.join('、') || '无'}，重复 ${duplicateScreenIds.join('、') || '无'}，变化 ${changedScreenIds.join('、') || '无'}。`
    };
}

export function resolveDetailManualAssistDeferredScreenIds(
    screens: readonly ParsedScreen[]
): number[] {
    return screens
        .filter((screen) => (
            (screen.copyPlaceholders?.length || 0) + (screen.imagePlaceholders?.length || 0)
        ) === 0)
        .map((screen) => Number(screen.id || 0))
        .filter((screenId) => screenId > 0);
}

export async function buildDetailTemplateState(params: {
    screens: ParsedScreen[];
    issues: LayerIssue[];
    crossScreenRiskCount: number;
    runTool: DetailToolRunner;
    results: Array<Record<string, unknown>>;
    designProjectState?: DesignProjectState | null;
    visualInsightCache?: ProjectVisualInsightCacheReadResult | null;
}): Promise<DetailTemplateState> {
    const { screens, issues, crossScreenRiskCount, runTool, results } = params;
    const readiness = assessDetailPageTemplateReadiness({
        screens,
        issues,
        crossScreenRiskCount
    });
    const layoutGraphs = buildDetailPageLayoutGraphs(screens);
    const layoutAssessment = analyzeDetailPageLayout(layoutGraphs);
    const placeholderAnchorDiagnostics = analyzeDetailPlaceholderAnchors(screens);
    const visualPlanning = await buildDetailVisualPlanningContext({
        screens,
        runTool,
        results
    });
    const projectStateContext = buildDetailPageStateContext({
        state: params.designProjectState || null,
        screens
    });
    const screenPlans = inferDetailScreenPlans(screens, layoutAssessment, {
        visualSummaries: visualPlanning.visualSummaries,
        agentDecisions: projectStateContext.agentDecisions
    });
    const templateCopyAudit = auditDetailCopyLayout({
        screens,
        screenPlans
    });
    const focus = await readDetailFocusContext({
        screens,
        screenPlans,
        visualPlanning,
        runTool,
        results
    });

    return {
        readiness,
        layoutGraphs,
        layoutAssessment,
        placeholderAnchorDiagnostics,
        visualPlanning,
        screenPlans,
        projectStateContext,
        templateCopyAudit,
        structureAlerts: collectDetailStructureAlerts(screens),
        focus
    };
}

export async function resolveDetailExecutionScope(params: {
    screens: ParsedScreen[];
    issues: LayerIssue[];
    crossScreenRiskCount: number;
    autoFix: boolean;
    runTool: DetailToolRunner;
    results: Array<Record<string, unknown>>;
    designProjectState?: DesignProjectState | null;
    visualInsightCache?: ProjectVisualInsightCacheReadResult | null;
}): Promise<DetailExecutionScopeResolution> {
    const { autoFix, runTool, results } = params;
    let screens = params.screens;
    let issues = params.issues;
    let crossScreenRiskCount = params.crossScreenRiskCount;
    const notes: string[] = [];
    let deferredScreenIds: number[] = [];

    let templateState = await buildDetailTemplateState({
        screens,
        issues,
        crossScreenRiskCount,
        runTool,
        results,
        designProjectState: params.designProjectState || null,
        visualInsightCache: params.visualInsightCache || null
    });

    if (autoFix) {
        const fixableIssues = issues.filter((issue) => issue.autoFixable);
        if (fixableIssues.length > 0) {
            const fixResult = await runTool('fixLayerIssues', { issues: fixableIssues });
            results.push({ toolName: 'fixLayerIssues', result: fixResult });

            const parseResult = await runTool('parseDetailPageTemplate', { includeStructure: true });
            results.push({ toolName: 'parseDetailPageTemplate[afterFix]', result: parseResult });
            if (!parseResult?.success) {
                return {
                    canProceed: false,
                    failureMessage: `自动修复后重新解析详情页失败: ${parseResult?.error || '未知错误'}`,
                    failureReason: parseResult?.error || 'Parse after fix failed',
                    screens,
                    issues,
                    crossScreenRiskCount,
                    templateState,
                    notes
                };
            }

            screens = parseResult.screens || [];
            crossScreenRiskCount = Array.isArray(parseResult.crossScreenLayers) ? parseResult.crossScreenLayers.length : 0;

            const detectResult = await runTool('detectLayerIssues', { screens });
            results.push({ toolName: 'detectLayerIssues[afterFix]', result: detectResult });
            issues = detectResult?.issues || [];

            templateState = await buildDetailTemplateState({
                screens,
                issues,
                crossScreenRiskCount,
                runTool,
                results,
                designProjectState: params.designProjectState || null,
                visualInsightCache: params.visualInsightCache || null
            });
            notes.push(`已自动修复 ${fixableIssues.length} 个结构问题`);
        }
    }

    if (templateState.readiness.mode === 'manual-assist') {
        deferredScreenIds = resolveDetailManualAssistDeferredScreenIds(screens);
        const recoverableScreenCount = screens.length - deferredScreenIds.length;

        if (deferredScreenIds.length > 0) {
            notes.push(
                `模板结构较乱，${recoverableScreenCount}/${screens.length} 屏可自动执行；`
                + `其余 ${deferredScreenIds.length} 屏保留在验收分母并标记待人工/Agent 修复`
            );
        } else {
            notes.push('模板结构不够规整，但仍存在可恢复屏，继续按可恢复策略执行');
        }
    }

    return {
        canProceed: true,
        screens,
        issues,
        crossScreenRiskCount,
        templateState,
        notes,
        deferredScreenIds
    };
}

export async function rebuildSingleDetailScreenPlan(params: {
    screen: ParsedScreen;
    screenPlan: DetailScreenPlan | undefined;
    focus?: DetailFocusContext;
    projectPath?: string;
    projectAssets?: { images: DetailProjectAsset[] };
    attachedImages?: DesignImageInput[];
    copyPlanning?: DetailPageCopyPlanningInput;
    runTool: DetailToolRunner;
    results: Array<Record<string, unknown>>;
}): Promise<FillPlan | null> {
    const {
        screen,
        screenPlan,
        focus,
        projectPath,
        projectAssets,
        attachedImages,
        copyPlanning,
        runTool,
        results
    } = params;
    const rebuildMatch = await runTool('matchDetailPageContent', {
        screens: [screen],
        projectPath,
        projectAssets,
        attachedImages,
        screenPlans: screenPlan ? [screenPlan] : [],
        selectedScene: focus?.selectedScene || undefined,
        selectedDesignContext: focus?.selectedDesignContext || undefined,
        selectedElementContext: focus?.selectedElementContext || undefined,
        selectedModuleContext: focus?.selectedModuleContext || undefined,
        ...(copyPlanning || {})
    });
    results.push({ toolName: `matchDetailPageContent[rebuild:${screen.name}]`, result: rebuildMatch });
    if (!rebuildMatch?.success) return null;

    const plansWithAttachments = applyAttachedImagesToDetailFillPlans(
        rebuildMatch.plans || [],
        attachedImages || []
    );
    const enriched = enrichDetailFillPlansWithLayerRelations(plansWithAttachments, [screen]);
    const aligned = alignDetailFillPlansToScreens(enriched, [screen]);
    const singleLayoutAssessment = analyzeDetailPageLayout(buildDetailPageLayoutGraphs([screen]));
    const fitAdjusted = applyDetailImageFitDecisions(aligned.alignedPlans, [screen], singleLayoutAssessment);
    return (fitAdjusted.plans.filter(Boolean)[0] as FillPlan | undefined) || null;
}

export async function planDetailPageContent(params: {
    screens: ParsedScreen[];
    screenPlans: DetailScreenPlan[];
    focus?: DetailFocusContext;
    projectPath?: string;
    projectAssets?: { images: DetailProjectAsset[] };
    attachedImages?: DesignImageInput[];
    copyPlanning?: DetailPageCopyPlanningInput;
    layoutAssessment: ReturnType<typeof analyzeDetailPageLayout>;
    runTool: DetailToolRunner;
    results: Array<Record<string, unknown>>;
}): Promise<DetailContentPlanningResult> {
    const {
        screens,
        screenPlans,
        projectPath,
        projectAssets,
        attachedImages,
        copyPlanning,
        layoutAssessment,
        runTool,
        results,
        focus
    } = params;

    const matchResult = await runTool('matchDetailPageContent', {
        screens,
        projectPath,
        projectAssets,
        attachedImages,
        screenPlans,
        selectedScene: focus?.selectedScene || undefined,
        selectedDesignContext: focus?.selectedDesignContext || undefined,
        selectedElementContext: focus?.selectedElementContext || undefined,
        selectedModuleContext: focus?.selectedModuleContext || undefined,
        ...(copyPlanning || {})
    });
    results.push({ toolName: 'matchDetailPageContent', result: matchResult });
    if (!matchResult?.success) {
        throw new Error(matchResult?.error || 'Match failed');
    }

    const plansWithAttachments = applyAttachedImagesToDetailFillPlans(
        matchResult.plans || [],
        attachedImages || []
    );
    let fillPlans: FillPlan[] = enrichDetailFillPlansWithLayerRelations(plansWithAttachments, screens);
    const aligned = alignDetailFillPlansToScreens(fillPlans, screens);
    const fitAdjusted = applyDetailImageFitDecisions(aligned.alignedPlans, screens, layoutAssessment);
    fillPlans = fitAdjusted.plans.filter(Boolean) as FillPlan[];
    const projectedScreens = applyDetailFillPlanCopiesToScreens(screens, fillPlans);
    const projectedCopyAudit = auditDetailCopyLayout({
        screens: projectedScreens,
        screenPlans
    });
    const anchorDiagnostics = analyzeDetailImageAnchors(fillPlans, screens);

    return {
        fillPlans,
        projectedCopyAudit,
        anchorDiagnostics,
        copyGenerationSummary: summarizeDetailCopyGeneration(fillPlans),
        fitDecisionCount: fitAdjusted.decisionCount
    };
}

export async function prepareDetailScreenExecutionPlan(params: {
    screen: ParsedScreen;
    screenPlan: DetailScreenPlan | undefined;
    initialPlan: FillPlan | undefined;
    focus?: DetailFocusContext;
    anchorDiagnostics: ReturnType<typeof analyzeDetailImageAnchors>;
    usePlanGuard: boolean;
    allowLowConfidenceFill: boolean;
    minImageCoverage: number;
    projectPath?: string;
    projectAssets?: { images: DetailProjectAsset[] };
    attachedImages?: DesignImageInput[];
    copyPlanning?: DetailPageCopyPlanningInput;
    runTool: DetailToolRunner;
    results: Array<Record<string, unknown>>;
}): Promise<DetailPreparedScreenPlan> {
    const {
        screen,
        screenPlan,
        initialPlan,
        focus,
        anchorDiagnostics,
        usePlanGuard,
        allowLowConfidenceFill,
        minImageCoverage,
        projectPath,
        projectAssets,
        attachedImages,
        copyPlanning,
        runTool,
        results
    } = params;

    const notes: string[] = [];
    let rebuilt = false;
    let plan: FillPlan | null | undefined = initialPlan;

    if (!plan) {
        notes.push('初始计划缺失，已尝试单屏重建');
        plan = await rebuildSingleDetailScreenPlan({
            screen,
            screenPlan,
            focus,
            projectPath,
            projectAssets,
            attachedImages,
            copyPlanning,
            runTool,
            results
        });
        rebuilt = true;
    }

    if (!plan) {
        return {
            plan: null,
            degraded: false,
            skippedRiskyImageCount: 0,
            deferredImages: [],
            notes,
            rebuilt
        };
    }

    let quality = calculateDetailPlanQuality(plan);
    const hasMissingImagePlan = (screen.imagePlaceholders?.length || 0) > 0
        && (plan.images || []).some((image) => (
            !resolveDetailImageExecutionDeferral(image, plan?.screenId)
            && !String(image?.imagePath || '').trim()
            && !String(image?.imageData || '').trim()
        ));
    const hasImageCoverageRisk = (screen.imagePlaceholders?.length || 0) > 0
        && quality.imageCoverage < minImageCoverage;
    const shouldRebuildScreen = usePlanGuard
        && !allowLowConfidenceFill
        && (hasImageCoverageRisk || hasMissingImagePlan);

    if (shouldRebuildScreen) {
        notes.push('图片覆盖率偏低或存在缺图，已尝试重建单屏计划');
        const rebuiltPlan = await rebuildSingleDetailScreenPlan({
            screen,
            screenPlan,
            focus,
            projectPath,
            projectAssets,
            attachedImages,
            copyPlanning,
            runTool,
            results
        });
        if (rebuiltPlan) {
            plan = rebuiltPlan;
            quality = calculateDetailPlanQuality(plan);
            rebuilt = true;
        }
    }

    const riskyLayerIds = new Set(
        (anchorDiagnostics.alerts || [])
            .filter((alert) => alert.screenId === screen.id && alert.severity === 'critical')
            .flatMap((alert) => Array.isArray(alert.layerIds) ? alert.layerIds : [])
            .map((layerId) => Number(layerId))
            .filter((layerId) => Number.isFinite(layerId) && layerId > 0)
    );
    const riskFilteredPlan = removeRiskyPlanImages(plan, riskyLayerIds);
    const skippedRiskyImageCount = Math.max(0, (plan.images?.length || 0) - (riskFilteredPlan.images?.length || 0));
    if (skippedRiskyImageCount > 0) {
        notes.push(`已移除 ${skippedRiskyImageCount} 个高风险图片区`);
    }
    if (screenPlan?.visualSummary?.boundaryRisk === 'risky') {
        notes.push('当前屏视觉边界与结构边界不一致，结果需要重点复核');
    }
    const deferredImages = (riskFilteredPlan.images || [])
        .map((image) => resolveDetailImageExecutionDeferral(image, riskFilteredPlan.screenId))
        .filter((item): item is DetailImageExecutionDeferral => Boolean(item));
    const filteredPlan: FillPlan = {
        ...riskFilteredPlan,
        images: (riskFilteredPlan.images || []).filter((image) => (
            !resolveDetailImageExecutionDeferral(image, riskFilteredPlan.screenId)
        ))
    };
    if (deferredImages.length > 0) {
        notes.push(`已延后 ${deferredImages.length} 个当前没有可信处理结果的图片项，不送入 filler。`);
    }

    return {
        plan: filteredPlan,
        degraded: skippedRiskyImageCount > 0
            || deferredImages.length > 0
            || quality.imageCoverage < minImageCoverage,
        skippedRiskyImageCount,
        deferredImages,
        notes,
        rebuilt
    };
}
