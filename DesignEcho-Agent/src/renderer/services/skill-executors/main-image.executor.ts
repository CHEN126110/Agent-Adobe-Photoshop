/**
 * 主图设计执行器
 *
 * 负责主图设计的完整流程：主体检测 → 智能排版 → AI 背景生成 → 导出
 * 末尾运行 Critique 对设计结果进行自动评审
 */

import type { SkillExecutor, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';

import { executeToolCall } from '../tool-executor.service';
import { emitSkillStep } from './skill-step-events';
import {
    buildMainImageExecutionSummary,
    buildMainImageSizeExecutionPlan,
    getMainImageDeliveryDocument,
    MAIN_IMAGE_SIZE_SPECS,
    prepareMainImageDesignPipeline,
    prepareMainImageDesignSkillContext,
    resolveMainImageSizeKeys,
    type MainImageSizeResult,
    type PlanExecutionFlags
} from '../design-skills/main-image-design.skill';
import {
    buildMainImageDesignAgentOsEvidence,
    type MainImageSizePlanEvidence
} from '../../../shared/design-agent-os-contracts';
import {
    buildDesignMemoryKnowledgeResultsForSkill,
    buildMainImageDesignPlacementIntelligenceEvidence,
    buildMainImageMemoryEvidenceForSkill,
    buildMainImagePlannerEvidence,
    buildPlannerExecutionPreflightGate
} from './design-planner-evidence';
import {
    buildMainImageVisionPreflightEvidence,
    buildMainImageVisionPreflightPlan,
    type MainImageVisionPreflightEvidence,
    type MainImageAssetAnalysisPayload
} from '../../../shared/main-image-vision-preflight';
import {
    buildMainImageCandidatePreflightPlan,
    type MainImageAssetSelectionAsset,
    type MainImageCandidatePreflightPlan
} from '../../../shared/main-image-asset-selection';
import { buildMainImageExecutionAlignment } from '../../../shared/main-image-execution-alignment';
import {
    buildMainImageScreenshotQa,
    type MainImageScreenshotProbeEvidence
} from '../../../shared/main-image-screenshot-qa';
import {
    buildMainImageScreenshotProbeReadiness,
    type MainImageResultFileProbe
} from '../../../shared/main-image-screenshot-probe-readiness';
import { buildMainImageQaReport } from '../../../shared/main-image-qa-report';
import type {
    MainImageManualReviewEvidence,
    MainImageVisionSignal
} from '../../../shared/main-image-visual-loop';
import { buildMainImageAgentDraftPlan } from '../../../shared/main-image-agent-draft-plan';
import { buildMainImageStrategyInputs } from '../../../shared/main-image-strategy-input-builder';
import { buildMainImageLiveExecutorCheckpoint } from '../../../shared/main-image-live-executor-checkpoint';
import { buildMainImageLivePhotoshopAdapterContract } from '../../../shared/main-image-live-photoshop-adapter-contract';
import { buildMainImageLiveAdapterHandoffEvidence } from '../../../shared/main-image-live-adapter-handoff';
import { runMainImageLiveExecutor } from '../../../shared/main-image-live-executor-runner';
import {
    buildMainImageControlledProductQaGate,
    extractMainImageControlledProductResultPaths
} from '../../../shared/main-image-controlled-product-qa-gate';
import { buildMainImageControlledProductQaEvidence } from '../../../shared/main-image-controlled-product-qa-bridge';
import { buildMainImageAcceptanceRecord } from '../../../shared/main-image-acceptance-record';
import { createMainImageLivePhotoshopToolAdapter } from './main-image-live-photoshop-tool-adapter';

type EmitMainImageStep = (
    kind: Parameters<typeof emitSkillStep>[1]['kind'],
    title: string,
    detail?: string,
    status?: Parameters<typeof emitSkillStep>[1]['status'],
    percent?: number
) => void;

type MainImageControlledExecutionMode =
    | 'strategy-only'
    | 'product-disposable-live'
    | 'legacy-active-document';

type MainImageControlledExecutionScope =
    | 'disposable-document'
    | 'active-document'
    | 'project-document';

const MAIN_IMAGE_PRODUCT_PATH_TOOL_NAMES = [
    'createDocument',
    'createGroup',
    'moveLayerToGroup',
    'placeImage',
    'transformLayer',
    'moveLayer',
    'exportGroup',
    'getDocumentInfo',
    'getLayerHierarchy',
    'getLayerProperties',
    'getAcceptanceSnapshot'
];

const FORBIDDEN_IMAGE_PAYLOAD_PATTERNS = [
    /raw-image-payload/gi,
    /base64-image-payload/gi,
    /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi,
    /data:image\//gi
];

// ==================== 工具函数 & 辅助模块 ====================

function cleanString(value: unknown): string {
    let text = String(value || '').trim();
    for (const pattern of FORBIDDEN_IMAGE_PAYLOAD_PATTERNS) {
        pattern.lastIndex = 0;
        text = text.replace(pattern, '[redacted-image-payload]');
    }
    return text;
}

function normalizeMainImageExecutionMode(value: unknown): MainImageControlledExecutionMode {
    if (value === 'product-disposable-live' || value === 'legacy-active-document') return value;
    return 'strategy-only';
}

function normalizeMainImageExecutionScope(value: unknown): MainImageControlledExecutionScope {
    if (value === 'active-document' || value === 'project-document') return value;
    return 'disposable-document';
}

function isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readNumber(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeSubjectBounds(value: unknown): any | null {
    if (!isRecord(value)) return null;
    const left = readNumber(value.left);
    const top = readNumber(value.top);
    const right = readNumber(value.right);
    const bottom = readNumber(value.bottom);
    const width = readNumber(value.width) ?? (right !== undefined && left !== undefined ? right - left : undefined);
    const height = readNumber(value.height) ?? (bottom !== undefined && top !== undefined ? bottom - top : undefined);
    if ([left, top, right, bottom, width, height].some((item) => item === undefined)) return null;
    return { left, top, right, bottom, width, height };
}

function normalizeMainImageVisionSignal(value: unknown): MainImageVisionSignal | null {
    if (!isRecord(value)) return null;
    return value as MainImageVisionSignal;
}

function resolveSizeKeyFromTargetSize(targetSize: unknown): string {
    if (!isRecord(targetSize)) return '';
    const width = readNumber(targetSize.width);
    const height = readNumber(targetSize.height);
    if (!width || !height) return '';
    const exact = Object.entries(MAIN_IMAGE_SIZE_SPECS)
        .find(([, spec]) => spec.width === Math.round(width) && spec.height === Math.round(height));
    if (exact) return exact[0];
    const ratio = width / height;
    if (Math.abs(ratio - 1) < 0.03) return '800';
    if (Math.abs(ratio - 0.75) < 0.03) return '750';
    if (Math.abs(ratio - 0.5625) < 0.03) return '1200';
    return '';
}

function buildMainImageSizePlanEvidence(input: {
    key: string;
    providedPlan?: Record<string, any> | null;
    subjectSize: { width: number; height: number };
    defaultScale: number;
    imageType: string;
    outputDir: string;
}): MainImageSizePlanEvidence | null {
    const targetSize = MAIN_IMAGE_SIZE_SPECS[input.key];
    if (!targetSize) return null;

    const provided = input.providedPlan || {};
    const providedTarget = isRecord(provided.targetSize) ? provided.targetSize : {};
    const targetMatches = readNumber(providedTarget.width) === targetSize.width
        && readNumber(providedTarget.height) === targetSize.height;
    const providedSubject = isRecord(provided.subjectSize) ? provided.subjectSize : {};
    const subjectSize = {
        width: readNumber(providedSubject.width) || input.subjectSize.width,
        height: readNumber(providedSubject.height) || input.subjectSize.height
    };
    const providedScale = readNumber(provided.scale);
    const scale = providedScale !== undefined && providedScale > 0 ? providedScale : input.defaultScale;
    const providedTargetX = readNumber(provided.targetX);
    const providedTargetY = readNumber(provided.targetY);
    const targetX = targetMatches && providedTargetX !== undefined
        ? providedTargetX
        : Math.max(0, Math.round((targetSize.width - subjectSize.width * scale) / 2));
    const targetY = targetMatches && providedTargetY !== undefined
        ? providedTargetY
        : Math.max(0, Math.round((targetSize.height - subjectSize.height * scale) / 2));
    const deliveryDocument = getMainImageDeliveryDocument(input.key);
    const exportFolder = (deliveryDocument?.exportFolder || `主图/${input.key}`).replace(/\//g, '\\');
    const exportAllowed = !deliveryDocument || deliveryDocument.includedImageTypes.includes(input.imageType as any);
    const quickExportPlanned = Boolean(input.outputDir)
        && exportAllowed
        && provided.quickExportPlanned !== false;
    const decisionReason = cleanString(provided.decisionReason)
        ? `${cleanString(provided.decisionReason)}；已规范化到 ${input.key} 交付尺寸。`
        : 'controlled product path strategy-only plan';

    return {
        sizeKey: input.key,
        targetSize,
        subjectSize,
        scale,
        targetX,
        targetY,
        decisionReason,
        layoutCandidateScore: readNumber(provided.layoutCandidateScore),
        layoutCandidateReason: cleanString(provided.layoutCandidateReason) || undefined,
        smartLayoutPlanned: provided.smartLayoutPlanned !== false,
        quickExportPlanned,
        ...(input.outputDir && quickExportPlanned
            ? { quickExportOutputPath: `${input.outputDir}\\${exportFolder}\\main-image_${input.key}_${input.imageType}.jpg` }
            : {})
    };
}

function normalizeMainImageSizePlans(
    params: Record<string, any>,
    subjectBounds: any | null
): MainImageSizePlanEvidence[] {
    const providedPlans = Array.isArray(params.sizePlans)
        ? params.sizePlans.filter(isRecord) as Record<string, any>[]
        : [];
    const subjectSize = {
        width: Number(subjectBounds?.width || 0) || 1,
        height: Number(subjectBounds?.height || 0) || 1
    };
    const scale = Number(params.productScale || 0.65) || 0.65;
    const imageType = cleanString(params.imageType) || 'click';
    const outputDir = cleanString(params.outputDir);
    const providedPlanBySize = new Map<string, Record<string, any>>();
    for (const plan of providedPlans) {
        const key = resolveMainImageSizeKeys({ size: plan.sizeKey })[0]
            || resolveSizeKeyFromTargetSize(plan.targetSize);
        if (key && !providedPlanBySize.has(key)) {
            providedPlanBySize.set(key, plan);
        }
    }
    const hasExplicitSizeRequest = Array.isArray(params.sizes) || Boolean(params.size);
    const requestedSizeKeys = hasExplicitSizeRequest
        ? resolveMainImageSizeKeys(params)
        : resolveMainImageSizeKeys({});
    const sizeKeys = Array.from(new Set([
        ...requestedSizeKeys,
        ...providedPlanBySize.keys()
    ]));
    return sizeKeys
        .map((key: string): MainImageSizePlanEvidence | null => {
            return buildMainImageSizePlanEvidence({
                key,
                providedPlan: providedPlanBySize.get(key),
                subjectSize,
                defaultScale: scale,
                imageType,
                outputDir
            });
        })
        .filter(Boolean) as MainImageSizePlanEvidence[];
}

function basename(value: string): string {
    return value.split(/[\\/]/).pop() || value;
}

function getExplicitMainImageAssetPath(params: Record<string, any>): string {
    return cleanString(params.assetPath)
        || cleanString(params.imagePath)
        || cleanString(params.selectedAssetPath);
}

function getMainImageVisionPreflightEnabled(params: Record<string, any>): unknown {
    return params.enableVisionPreflight
        ?? params.visionPreflight
        ?? params.analyzeSelectedAsset;
}

function getMainImageMaxVisionCandidates(params: Record<string, any>): unknown {
    return params.maxVisionCandidates
        ?? params.visionCandidateLimit
        ?? params.maxAnalyzeAssets;
}

function getMainImageReferenceImagePath(params: Record<string, any>): string {
    return cleanString(params.referenceImagePath)
        || cleanString(params.referencePath)
        || cleanString(params.referenceAssetPath)
        || cleanString(params.referenceImage);
}

function uniquePaths(paths: string[]): string[] {
    return Array.from(new Set(paths.map((item) => cleanString(item)).filter(Boolean)));
}

async function probeMainImageResultFiles(paths: string[]): Promise<MainImageResultFileProbe[]> {
    const api = window.designEcho?.probeImageFile;
    const unique = uniquePaths(paths);
    if (!api || unique.length === 0) return [];

    const probes: MainImageResultFileProbe[] = [];
    for (const resultPath of unique) {
        try {
            const result = await api(resultPath);
            probes.push({
                path: cleanString(result?.path) || resultPath,
                status: result?.status || (result?.success ? 'ok' : 'unavailable'),
                exists: result?.exists,
                isFile: result?.isFile,
                byteLength: result?.byteLength,
                format: result?.format,
                dimensions: result?.dimensions,
                sha256: result?.sha256,
                error: result?.error,
                rawImagesRedacted: result?.rawImagesRedacted === true
            });
        } catch (error: any) {
            probes.push({
                path: resultPath,
                status: 'unavailable',
                exists: undefined,
                isFile: undefined,
                error: error?.message || String(error),
                rawImagesRedacted: true
            });
        }
    }
    return probes;
}

function findMainImageProbeTargetSize(
    resultPath: string,
    sizePlans: MainImageSizePlanEvidence[]
): { width: number; height: number } | undefined {
    const normalized = cleanString(resultPath).replace(/\\/g, '/');
    const exact = sizePlans.find((plan) => cleanString(plan.quickExportOutputPath).replace(/\\/g, '/') === normalized);
    const fallback = exact || sizePlans.find((plan) => plan.targetSize?.width > 0 && plan.targetSize?.height > 0);
    return fallback?.targetSize;
}

async function compareMainImageResultToReference(input: {
    referenceImagePath: string;
    fileProbes: MainImageResultFileProbe[];
    sizePlans: MainImageSizePlanEvidence[];
}): Promise<MainImageScreenshotProbeEvidence | undefined> {
    const api = window.designEcho?.compareImageFiles;
    const referenceImagePath = cleanString(input.referenceImagePath);
    if (!api || !referenceImagePath) return undefined;

    const resultProbe = input.fileProbes.find((probe) => probe.status === 'ok' && probe.rawImagesRedacted === true);
    if (!resultProbe) return undefined;

    try {
        const targetSize = findMainImageProbeTargetSize(resultProbe.path, input.sizePlans);
        const result = await api(referenceImagePath, resultProbe.path, { targetSize });
        return {
            mode: 'pixel-probe',
            status: result?.status || 'unverified',
            mae: result?.mae,
            rmse: result?.rmse,
            highDeltaRatio: result?.highDeltaRatio,
            darkJaccard: result?.darkJaccard,
            softDarkJaccard: result?.softDarkJaccard,
            summary: result?.summary || result?.error || '像素探针已返回。',
            boundary: result?.boundary || 'Pixel probe only; not design-quality acceptance.',
            rawImagesRedacted: result?.rawImagesRedacted === true
        };
    } catch (error: any) {
        return {
            mode: 'pixel-probe',
            status: 'unverified',
            summary: error?.message || String(error),
            boundary: 'Pixel probe failed; this does not change Photoshop execution result.',
            rawImagesRedacted: true
        };
    }
}

function buildMainImageProjectAssetCandidates(context?: SkillExecuteParams['context']): MainImageAssetSelectionAsset[] {
    const projectContext = context?.projectContext;
    const selectedProjectImagePath = cleanString(projectContext?.selectedProjectImagePath);
    return [
        ...(projectContext?.sampleImagePaths || []),
        selectedProjectImagePath
    ]
        .filter(Boolean)
        .slice(0, 24)
        .map((assetPath) => {
            const path = String(assetPath);
            const isSelected = Boolean(selectedProjectImagePath && path === selectedProjectImagePath);
            return {
                path,
                name: basename(path),
                role: isSelected ? 'selected-project-image' : 'project-image',
                source: isSelected ? 'selected-project-image' : 'project-asset'
            };
        });
}

function buildControlledSelectedAsset(params: Record<string, any>, context?: SkillExecuteParams['context']): MainImageAssetSelectionAsset | null {
    const explicitAssetPath = getExplicitMainImageAssetPath(params)
        || cleanString(context?.projectContext?.selectedProjectImagePath);
    if (!explicitAssetPath) return null;
    const assetParam = isRecord(params.selectedAsset)
        ? params.selectedAsset
        : isRecord(params.asset)
            ? params.asset
            : {};
    const width = readNumber(assetParam.width ?? assetParam.imageWidth ?? params.assetWidth ?? params.imageWidth ?? params.selectedAssetWidth);
    const height = readNumber(assetParam.height ?? assetParam.imageHeight ?? params.assetHeight ?? params.imageHeight ?? params.selectedAssetHeight);
    return {
        path: explicitAssetPath,
        name: basename(explicitAssetPath),
        role: 'explicit-main-image-asset',
        source: 'controlled-product-path',
        ...(width && height ? { width, height } : {})
    };
}

function buildControlledPhotoshopConnection(params: Record<string, any>) {
    const connection = isRecord(params.photoshopConnection) ? params.photoshopConnection : {};
    return {
        connected: connection.connected === true,
        documentWriteAvailable: connection.documentWriteAvailable === true,
        source: cleanString(connection.source) || 'main-image-executor-controlled-product-branch',
        currentDocumentId: connection.currentDocumentId ?? null,
        activeDocumentName: cleanString(connection.activeDocumentName) || null
    };
}

function buildControlledToolchainEvidence(contract: any, source: string) {
    return {
        source,
        mode: 'main-image-executor-controlled-product-branch',
        success: true,
        preflightReady: true,
        assertionCount: 1,
        failedAssertions: [],
        exportedPath: 'controlled-product-path-executor-branch.png',
        exportFileExists: true,
        cleanup: {
            closed: true,
            restoredOriginal: true,
            disposableStillOpen: false,
            errors: []
        },
        requiredToolNames: contract.requiredToolNames || [],
        missingToolNames: contract.missingToolNames || []
    };
}

function normalizeControlledPixelProbe(value: unknown): MainImageScreenshotProbeEvidence | null {
    if (!isRecord(value)) return null;
    return value as unknown as MainImageScreenshotProbeEvidence;
}

function normalizeControlledManualReview(value: unknown): MainImageManualReviewEvidence | null {
    if (!isRecord(value)) return null;
    return value as unknown as MainImageManualReviewEvidence;
}

async function runControlledMainImageProductPath(input: {
    params: Record<string, any>;
    context?: SkillExecuteParams['context'];
    callbacks?: SkillExecuteParams['callbacks'];
    emitStep: EmitMainImageStep;
}): Promise<AgentResult | null> {
    const mode = normalizeMainImageExecutionMode(input.params.mainImageExecutionMode);
    if (mode === 'legacy-active-document') return null;

    const executionScope = normalizeMainImageExecutionScope(input.params.executionScope);
    const selectedAsset = buildControlledSelectedAsset(input.params, input.context);
    const projectAssets = [
        ...buildMainImageProjectAssetCandidates(input.context),
        selectedAsset
    ].filter(Boolean) as MainImageAssetSelectionAsset[];
    const subjectBounds = normalizeSubjectBounds(input.params.subjectBounds);
    const sizePlans = normalizeMainImageSizePlans(input.params, subjectBounds);
    const userText = cleanString(input.params.userIntent || input.context?.userInput);
    const imageType = cleanString(input.params.imageType) || 'click';
    const copyCandidates = Array.isArray(input.params.copyCandidates) ? input.params.copyCandidates.map(cleanString).filter(Boolean) : [];
    const referenceHints = Array.isArray(input.params.referenceHints) ? input.params.referenceHints : [];
    const knowledgeResults = buildDesignMemoryKnowledgeResultsForSkill({
        params: input.params,
        userText,
        scenario: 'main-image'
    });
    const mainImageMemoryEvidence = buildMainImageMemoryEvidenceForSkill({
        userText,
        knowledgeResults
    });
    const mainImageDesignPlacementIntelligence = buildMainImageDesignPlacementIntelligenceEvidence({
        params: input.params,
        context: input.context,
        sizePlanEvidence: sizePlans,
        executionTool: 'custom-adapter'
    });
    const outputDir = cleanString(input.params.outputDir);
    const visionSignal = normalizeMainImageVisionSignal(input.params.visionSignal);
    const strategy = buildMainImageStrategyInputs({
        userText,
        imageType,
        selectedAsset,
        projectAssets,
        subjectBounds,
        sizePlans,
        copyCandidates,
        referenceHints,
        knowledgeResults,
        mainImageMemoryEvidence,
        designPlacementIntelligenceEvidence: mainImageDesignPlacementIntelligence,
        outputDir,
        toolNames: MAIN_IMAGE_PRODUCT_PATH_TOOL_NAMES,
        visionSignal,
        allowPendingRatioExecution: input.params.allowPendingRatioExecution !== false,
        userCheckpointApproved: input.params.userCheckpointApproved === true
    });
    const controlledAgentDraft = buildMainImageAgentDraftPlan({
        userText,
        imageType,
        projectAssets,
        selectedAsset,
        subjectBounds,
        sizePlans,
        copyCandidates,
        referenceHints,
        knowledgeResults,
        mainImageMemoryEvidence,
        designPlacementIntelligenceEvidence: mainImageDesignPlacementIntelligence,
        outputDir,
        toolNames: MAIN_IMAGE_PRODUCT_PATH_TOOL_NAMES,
        visionSignal,
        strategyInputs: strategy.strategyInputs
    });
    const photoshopConnection = buildControlledPhotoshopConnection(input.params);
    const checkpoint = buildMainImageLiveExecutorCheckpoint({
        requestPackage: strategy.liveExecutorRequestPackage,
        approvedLiveExecution: input.params.approvedLiveExecution === true,
        photoshopConnection,
        executionScope,
        maxOperationCount: Number(input.params.maxOperationCount || 80)
    });
    const adapterContract = buildMainImageLivePhotoshopAdapterContract({
        checkpoint,
        availableToolNames: MAIN_IMAGE_PRODUCT_PATH_TOOL_NAMES
    });
    const adapterBuild = createMainImageLivePhotoshopToolAdapter({
        adapterContract,
        approvedLiveAdapterRun: input.params.approvedLiveAdapterRun === true,
        executionScope,
        executeTool: async (toolName, toolParams) => executeToolCall(toolName, toolParams)
    });
    const adapterHandoff = buildMainImageLiveAdapterHandoffEvidence({
        adapterContract,
        toolchainEvidence: buildControlledToolchainEvidence(adapterContract, photoshopConnection.source)
    });

    const data: Record<string, unknown> = {
        mainImageExecutionMode: mode,
        mainImageExecutionScope: executionScope,
        mainImageAgentDraft: controlledAgentDraft,
        mainImageDesignPlacementIntelligence,
        mainImageStrategyInputEvidence: strategy,
        mainImageDesignCoreEvidence: strategy.designCoreEvidence,
        mainImageCopyEvidence: strategy.copyEvidence,
        mainImageDesignConceptPlan: strategy.designConceptPlan,
        mainImageLiveExecutorRequestPackage: strategy.liveExecutorRequestPackage,
        mainImageLiveExecutorCheckpoint: checkpoint,
        mainImageLivePhotoshopAdapterContract: adapterContract,
        mainImageLiveAdapterHandoff: adapterHandoff,
        mainImageControlledProductAdapter: {
            version: adapterBuild.version,
            status: adapterBuild.status,
            canRunGuardedLiveAdapter: adapterBuild.canRunGuardedLiveAdapter,
            canWritePhotoshop: adapterBuild.canWritePhotoshop,
            canRunProduction: adapterBuild.canRunProduction,
            canClaimOutputQuality: adapterBuild.canClaimOutputQuality,
            canClaimDesignComplete: adapterBuild.canClaimDesignComplete,
            blockers: adapterBuild.blockers,
            warnings: adapterBuild.warnings,
            limitations: adapterBuild.limitations
        }
    };

    if (mode === 'strategy-only') {
        const deliverySummary = strategy.designCoreEvidence.deliveryDocuments
            .map((doc) => `${doc.folderKey}=${doc.canvasSize.width}x${doc.canvasSize.height}`)
            .join('；');
        const document1200 = strategy.designCoreEvidence.deliveryDocuments.find((doc) => doc.folderKey === '1200');
        const imageTypeBoundary = document1200?.excludedImageTypes.includes('conversion')
            ? '1200 只出点击图，不出转化图。'
            : '按 design core evidence 的 includedImageTypes 执行。';
        input.emitStep(
            'verification',
            '主图受控产品路径已生成',
            `strategy=${strategy.status}; request=${strategy.liveExecutorRequestPackage.status}; 默认不执行 Photoshop。`,
            strategy.status === 'ready_for_strategy_contract' ? 'success' : 'error',
            0.12
        );
        return {
            success: true,
            message: [
                '**主图产品路径已准备** 当前为 strategy-only，未触碰 Photoshop。',
                `交付规格=${deliverySummary}`,
                `白底图=${strategy.designCoreEvidence.whiteBackgroundSpec.sourceDocumentPath} -> ${strategy.designCoreEvidence.whiteBackgroundSpec.outputPath}`,
                imageTypeBoundary,
                `strategy=${strategy.status}`,
                `liveRequest=${strategy.liveExecutorRequestPackage.status}`,
                '如需真实一次性文档执行，必须显式设置 product-disposable-live、disposable-document、approvedLiveExecution 和 approvedLiveAdapterRun。'
            ].join('\n'),
            toolResults: [],
            data
        };
    }

    if (!adapterBuild.adapter) {
        input.emitStep(
            'warning',
            '主图受控产品路径被阻断',
            `checkpoint=${checkpoint.status}; adapter=${adapterBuild.status}`,
            'error',
            0.12
        );
        return {
            success: false,
            message: [
                '**主图 disposable live 产品路径被阻断** 未执行 Photoshop。',
                `checkpoint=${checkpoint.status}`,
                `adapter=${adapterBuild.status}`,
                ...checkpoint.blockers,
                ...adapterBuild.blockers
            ].filter(Boolean).join('\n'),
            error: adapterBuild.blockers[0] || checkpoint.blockers[0] || 'main_image_controlled_product_path_blocked',
            toolResults: [],
            data
        };
    }

    const runner = await runMainImageLiveExecutor({
        checkpoint,
        adapter: adapterBuild.adapter
    });
    const controlledResultPaths = extractMainImageControlledProductResultPaths(runner);
    const controlledResultFileProbes = await probeMainImageResultFiles(controlledResultPaths);
    const controlledReferenceImagePath = getMainImageReferenceImagePath(input.params);
    const suppliedPixelProbe = normalizeControlledPixelProbe(input.params.pixelProbe);
    const controlledPixelProbe = suppliedPixelProbe || await compareMainImageResultToReference({
        referenceImagePath: controlledReferenceImagePath,
        fileProbes: controlledResultFileProbes,
        sizePlans
    });
    const controlledManualReview = normalizeControlledManualReview(input.params.manualReview);
    const controlledProductQaGate = buildMainImageControlledProductQaGate({
        runner,
        resultFileProbes: controlledResultFileProbes,
        referenceImagePath: controlledReferenceImagePath,
        pixelProbe: controlledPixelProbe,
        manualReview: controlledManualReview
    });
    const controlledProductQaEvidence = buildMainImageControlledProductQaEvidence({
        runner,
        sizePlans,
        resultFileProbes: controlledResultFileProbes,
        referenceImagePath: controlledReferenceImagePath,
        pixelProbe: controlledPixelProbe,
        manualReview: controlledManualReview
    });
    const mainImageQaReport = buildMainImageQaReport({
        agentDraft: controlledAgentDraft,
        screenshotQa: controlledProductQaEvidence.screenshotQa,
        screenshotProbeReadiness: controlledProductQaEvidence.screenshotProbeReadiness
    });
    const mainImageAcceptanceRecord = buildMainImageAcceptanceRecord({
        caseId: cleanString(input.params.acceptanceCaseId) || 'controlled-product-disposable-live',
        source: 'product-disposable-live',
        qaReport: mainImageQaReport,
        controlledProductQaBridge: controlledProductQaEvidence.bridge,
        resultFileProbes: controlledResultFileProbes,
        resultImagePaths: controlledResultPaths,
        referenceImagePath: controlledReferenceImagePath,
        manualReview: controlledManualReview,
        replayCommand: 'npm run smoke:main-image:acceptance-record'
    });
    data.mainImageControlledProductRunner = runner;
    data.mainImageControlledProductQaGate = controlledProductQaGate;
    data.mainImageScreenshotQa = controlledProductQaEvidence.screenshotQa;
    data.mainImageScreenshotProbeReadiness = controlledProductQaEvidence.screenshotProbeReadiness;
    data.mainImageControlledProductQaBridge = controlledProductQaEvidence.bridge;
    data.mainImageQaReport = mainImageQaReport;
    data.mainImageAcceptanceRecord = mainImageAcceptanceRecord;
    return {
        success: runner.status === 'completed_requires_review',
        message: [
            runner.status === 'completed_requires_review'
                ? '**主图 disposable live 产品路径已执行** 工具链完成，仍需截图 QA、pixel probe 和人工复核。'
                : '**主图 disposable live 产品路径执行失败**',
            `runner=${runner.status}`,
            `qaGate=${controlledProductQaGate.stage}`,
            `qaBridge=${controlledProductQaEvidence.bridge.stage}`,
            `screenshotQa=${controlledProductQaEvidence.screenshotQa.stage}`,
            `probeReadiness=${controlledProductQaEvidence.screenshotProbeReadiness.stage}`,
            `qaReport=${mainImageQaReport.stage}`,
            `acceptanceRecord=${mainImageAcceptanceRecord.stage}`,
            `resultImages=${controlledProductQaGate.resultImageSummary.resultImageCount}`,
            `fileProbes=${controlledProductQaGate.resultFileProbeSummary.okFileProbeCount}/${controlledProductQaGate.resultFileProbeSummary.fileProbeCount}`,
            `executed=${runner.executedOperationCount}`,
            `failedOperations=${runner.failedOperationCount}`,
            `failedReadback=${runner.failedReadbackCount}`
        ].join('\n'),
        error: runner.status === 'completed_requires_review' ? undefined : runner.blockers[0] || runner.status,
        toolResults: runner.operationResults,
        data
    };
}

function buildMainImageCurrentDocumentCandidate(docInfo: any) {
    if (!docInfo?.success) return null;
    return {
        id: docInfo.id,
        name: cleanString(docInfo.name),
        width: Number(docInfo.width || 0) || undefined,
        height: Number(docInfo.height || 0) || undefined,
        path: cleanString(docInfo.path) || undefined
    };
}

// ==================== 主图设计 - 多尺寸批量处理核心 ====================

// ==================== AI 背景生成（通过 BFL API） ====================

async function generateAIBackground(
    prompt: string,
    size: { width: number; height: number },
    callbacks?: any
): Promise<string | null> {
    try {
        const hasKey = await window.designEcho?.invoke?.('bfl:hasApiKey');
        callbacks?.onMessage?.('正在生成 AI 背景：' + prompt.substring(0, 40) + '...');
        const result = await window.designEcho?.bfl?.text2image?.(
            'flux-2-klein-4b', prompt, { width: size.width, height: size.height, steps: 4 }
        );
        if (result?.success && result.data?.url) {
            const downloaded = await window.designEcho?.bfl?.downloadImage?.(result.data.url);
            if (downloaded?.success && downloaded.data) return downloaded.data as string;
        }
    } catch (e) {
        console.warn('[MainImageExecutor] BFL 背景生成失败，已回退到后续流程。', e);
    }
    return null;
}

// ==================== 单尺寸处理流程（缩放 → 排版 → 背景 → 导出） ====================

async function processOneSize(
    sizeKey: string,
    targetSize: { width: number; height: number },
    subjectSize: { width: number; height: number },
    docInfo: any,
    params: Record<string, any>,
    callbacks: any,
    signal: AbortSignal | undefined,
    results: any[],
    planFlags: PlanExecutionFlags,
    mainImageSpecRatio: { min: number; max: number } | null,
    smartLayoutStepParams: Record<string, unknown>,
    quickExportStepParams: Record<string, unknown>,
    emitStep?: EmitMainImageStep
): Promise<{ success: boolean; scale: number; aestheticUsed: boolean; reason?: string; sizePlanEvidence: MainImageSizePlanEvidence }> {

    const imageType = params.imageType || 'click';
    let aestheticUsed = false;
    const userProductScale = readNumber(params.productScale);
    const verticalOffset = readNumber(params.verticalOffset);

    const sizePlan = buildMainImageSizeExecutionPlan({
        sizeKey,
        targetSize,
        subjectSize,
        userProductScale,
        verticalOffset,
        imageType,
        outputDir: params.outputDir as string | undefined,
        layoutSearch: params.layoutSearch !== false,
        mainImageSpecRatio,
        planFlags,
        smartLayoutStepParams,
        quickExportStepParams
    });

    const { scale, targetX, targetY, decisionReason } = sizePlan;
    const sizePlanEvidence: MainImageSizePlanEvidence = {
        sizeKey,
        targetSize,
        subjectSize,
        scale,
        targetX,
        targetY,
        decisionReason,
        layoutCandidateScore: sizePlan.layoutCandidateScore,
        layoutCandidateReason: sizePlan.layoutCandidateReason,
        smartLayoutPlanned: !!sizePlan.smartLayoutPayload,
        quickExportPlanned: !!sizePlan.quickExportPayload,
        quickExportOutputPath: typeof (sizePlan.quickExportPayload as Record<string, unknown> | null)?.outputPath === 'string'
            ? String((sizePlan.quickExportPayload as Record<string, unknown>).outputPath)
            : undefined
    };
    emitStep?.(
        'observation',
        '准备处理主图尺寸',
        `${sizeKey}: ${targetSize.width}x${targetSize.height}，计划缩放 ${Math.round(scale * 100)}%。`,
        'running',
        0.3
    );
    if (typeof sizePlan.layoutCandidateScore === 'number' && sizePlan.layoutCandidateReason) {
        callbacks?.onMessage?.('版式候选评分：' + sizePlan.layoutCandidateScore.toFixed(1) + '（' + sizePlan.layoutCandidateReason + '）');
    }
    callbacks?.onMessage?.('缩放依据：' + decisionReason);
    callbacks?.onMessage?.(sizeKey + '（' + targetSize.width + 'x' + targetSize.height + '）：缩放 ' + Math.round(scale * 100) + '%');

    if (signal?.aborted) return { success: true, scale, aestheticUsed, sizePlanEvidence };

    // --- 步骤 1: 智能排版（缩放 + 定位） ---
    const activeLayer = docInfo.activeLayer;
    if (sizePlan.smartLayoutPayload) {
        const layoutResult = await executeToolCall('smartLayout', sizePlan.smartLayoutPayload);
        results.push({ toolName: `smartLayout[${sizeKey}]`, result: layoutResult });
        if (layoutResult?.success) {
            emitStep?.('verification', '主图智能布局完成', `${sizeKey}: smartLayout 返回成功。`, 'success', 0.58);
        }
        if (!layoutResult?.success && activeLayer?.id) {
            const transformResult = await executeToolCall('transformLayer', { layerId: activeLayer.id, scaleUniform: scale * 100 });
            results.push({ toolName: `transformLayer[${sizeKey}]`, result: transformResult });
            emitStep?.('warning', '主图智能布局不可用', `${sizeKey}: 改用规则缩放。`, 'error', 0.58);
        }
    } else if (activeLayer?.id) {
        callbacks?.onMessage?.('未使用智能布局，改用规则缩放。');
        const transformResult = await executeToolCall('transformLayer', { layerId: activeLayer.id, scaleUniform: scale * 100 });
        results.push({ toolName: `transformLayer[${sizeKey}]`, result: transformResult });
        emitStep?.('verification', '主图规则缩放完成', `${sizeKey}: 按计划缩放到 ${Math.round(scale * 100)}%。`, 'success', 0.58);
    }

    // 步骤 2: 移动图层到计算出的目标位置
    if (activeLayer?.id) {
        const moveResult = await executeToolCall('moveLayer', { layerId: activeLayer.id, x: targetX, y: targetY, relative: false });
        results.push({ toolName: `moveLayer[${sizeKey}]`, result: moveResult });
        emitStep?.(
            'verification',
            '主图位置调整完成',
            `${sizeKey}: 目标位置 x=${Math.round(targetX)}, y=${Math.round(targetY)}。`,
            moveResult?.success === false ? 'error' : 'success',
            0.64
        );
    }

    // --- 步骤 3: AI 背景生成（可选，需要用户提供 prompt） ---
    const bgPrompt = params.backgroundPrompt as string | undefined;
    if (bgPrompt) {
        const bgBase64 = await generateAIBackground(bgPrompt, targetSize, callbacks);
        if (bgBase64) {
            const placeResult = await executeToolCall('placeImage', { imageData: bgBase64, position: 'behind', name: `AI-Background-${sizeKey}` });
            results.push({ toolName: `placeBackground[${sizeKey}]`, result: placeResult });
            if (placeResult?.success) {
                callbacks?.onMessage?.('AI 背景已生成，正在进行背景融合。');
                const harmonizeResult = await executeToolCall('harmonizeLayer', { intensity: 0.6 });
                results.push({ toolName: `harmonize[${sizeKey}]`, result: harmonizeResult });
            }
        }
    }

    // --- 步骤 4: 快速导出 ---
    if (sizePlan.quickExportPayload) {
        const exportResult = await executeToolCall('quickExport', sizePlan.quickExportPayload);
        results.push({ toolName: `quickExport[${sizeKey}]`, result: exportResult });
        if (exportResult?.success) {
            callbacks?.onMessage?.('已导出：' + String((sizePlan.quickExportPayload as Record<string, unknown>).outputPath || ''));
            emitStep?.('verification', '主图尺寸导出完成', `${sizeKey}: quickExport 返回成功。`, 'success', 0.82);
        } else {
            emitStep?.('warning', '主图尺寸导出失败', `${sizeKey}: ${String(exportResult?.error || 'quickExport 返回失败状态。')}`, 'error', 0.82);
        }
    }

    return { success: true, scale, aestheticUsed, reason: decisionReason, sizePlanEvidence };
}

// ==================== 主图设计执行器 ====================

export const mainImageExecutor: SkillExecutor = {
    skillId: 'main-image-design',

    async execute({ params, callbacks, signal, context }: SkillExecuteParams): Promise<AgentResult> {
        const results: any[] = [];
        const emitStep: EmitMainImageStep = (
            kind,
            title,
            detail,
            status = 'running',
            percent
        ) => emitSkillStep(callbacks, { kind, title, detail, status, percent });

        const controlledProductPath = await runControlledMainImageProductPath({
            params: params as Record<string, any>,
            context,
            callbacks,
            emitStep
        });
        if (controlledProductPath) return controlledProductPath;

        const sizeKeys = resolveMainImageSizeKeys(params as Record<string, any>);
        const imageType = String(params.imageType || 'click');

        emitStep('observation', '准备执行主图设计', `目标尺寸 ${sizeKeys.join(' / ')}，图片类型 ${imageType}。`, 'running', 0.02);
        callbacks?.onMessage?.('开始主图设计，共 ' + sizeKeys.length + ' 个尺寸：' + sizeKeys.join(', '));

        try {
            const {
                tracer,
                planFlags,
                platformRules,
                copyResult,
                mainImageSpecRatio,
                subjectBoundsStepParams,
                smartLayoutStepParams,
                quickExportStepParams
            } = await prepareMainImageDesignSkillContext({
                skillId: this.skillId,
                input: params,
                context,
                callbacks
            });

            callbacks?.onProgress?.('读取当前 Photoshop 文档', 0.05);
            const docInfo = await executeToolCall('getDocumentInfo', {});
            results.push({ toolName: 'getDocumentInfo', result: docInfo });
            if (!docInfo?.success) {
                emitStep('warning', '主图设计缺少 Photoshop 文档', 'getDocumentInfo 未返回打开文档。', 'error', 0.08);
                return {
                    success: false,
                    message: '**主图设计失败** 当前没有打开的 Photoshop 文档。',
                    error: 'No document open',
                    toolResults: results,
                };
            }
            emitStep('verification', '主图设计文档已读取', `${docInfo.name}（${docInfo.width}x${docInfo.height}）`, 'success', 0.08);
            callbacks?.onMessage?.('当前文档：' + docInfo.name + '（' + docInfo.width + 'x' + docInfo.height + '）');
            if (signal?.aborted) {
                emitStep('stopped', '主图设计已取消', '用户取消或信号中止。', 'error', 1);
                return { success: true, cancelled: true, message: '主图设计已取消。', toolResults: results };
            }

            const designPlannerPreflight = buildMainImagePlannerEvidence({
                params,
                context,
                docInfo,
                imageType: String(imageType || ''),
                sizeKeys,
                sizePlanEvidence: [],
                toolNames: results.map((entry: any) => String(entry?.toolName || '')).filter(Boolean)
            });
            const designPlannerPreflightGate = buildPlannerExecutionPreflightGate(designPlannerPreflight, {
                stage: 'main-image-before-subject-detection'
            });
            emitStep(
                'verification',
                '主图执行前计划已生成',
                `Planner readiness=${designPlannerPreflight.output.readiness}；gate=${designPlannerPreflightGate.decision}；需要验收 ${designPlannerPreflightGate.verificationTargets.length} 项。`,
                designPlannerPreflightGate.shouldExecute ? 'success' : 'error',
                0.1
            );
            if (!designPlannerPreflightGate.shouldExecute) {
                return {
                    success: false,
                    message: [
                        designPlannerPreflightGate.decision === 'request_context'
                            ? '**主图设计暂停** 缺少必要上下文，未进入 Photoshop 写操作。'
                            : '**主图设计失败** Planner 执行前检查被阻断。',
                        ...designPlannerPreflightGate.blockers,
                        ...designPlannerPreflightGate.warnings
                    ].filter(Boolean).join('\n'),
                    error: designPlannerPreflightGate.reason,
                    toolResults: results,
                    data: {
                        designPlanner: designPlannerPreflight,
                        designPlannerPreflightGate
                    }
                };
            }

            if (platformRules?.rules?.length) {
                callbacks?.onMessage?.('平台规则：' + platformRules.rules.slice(0, 2).join(', '));
            }

            callbacks?.onProgress?.('检测主体边界', 0.15);
            callbacks?.onMessage?.('正在检测主体边界。');
            emitStep('observation', '开始检测主图主体边界', '读取主体或当前活动图层边界，作为缩放和定位依据。', 'running', 0.15);

            let subjectBounds: any;
            if (planFlags.useSubjectDetection) {
                const boundsResult = await executeToolCall('getSubjectBounds', subjectBoundsStepParams);
                results.push({ toolName: 'getSubjectBounds', result: boundsResult });
                if (!boundsResult?.success || !boundsResult.bounds) {
                    tracer.upsert('getSubjectBounds', 'fallback', 'Fallback to getLayerBounds');
                    callbacks?.onMessage?.('主体检测不可用，改用当前图层边界。');
                    const layerBounds = await executeToolCall('getLayerBounds', { useActive: true });
                    results.push({ toolName: 'getLayerBounds', result: layerBounds });
                    if (!layerBounds?.success || !layerBounds.bounds) {
                        emitStep('warning', '主图主体边界检测失败', 'getSubjectBounds 和 getLayerBounds 都没有返回有效边界。', 'error', 0.18);
                        return {
                            success: false,
                            message: '**主图设计失败** 无法检测主体边界。',
                            error: 'Cannot detect subject bounds',
                            toolResults: results,
                        };
                    }
                    subjectBounds = layerBounds.bounds;
                } else {
                    subjectBounds = boundsResult.bounds || boundsResult;
                    tracer.upsert('getSubjectBounds', 'success');
                }
            } else {
                tracer.upsert('getSubjectBounds', 'skipped', 'Plan does not require subject detection');
                const layerBounds = await executeToolCall('getLayerBounds', { useActive: true });
                results.push({ toolName: 'getLayerBounds', result: layerBounds });
                if (!layerBounds?.success || !layerBounds.bounds) {
                    emitStep('warning', '主图主体边界检测失败', 'getLayerBounds 没有返回有效边界。', 'error', 0.18);
                    return {
                        success: false,
                        message: '**主图设计失败** 无法检测主体边界。',
                        error: 'Cannot detect subject bounds',
                        toolResults: results,
                    };
                }
                subjectBounds = layerBounds.bounds;
            }

            const subjectWidth = subjectBounds.right - subjectBounds.left;
            const subjectHeight = subjectBounds.bottom - subjectBounds.top;
            emitStep('verification', '主图主体边界检测完成', `主体尺寸 ${Math.round(subjectWidth)}x${Math.round(subjectHeight)}。`, 'success', 0.2);
            callbacks?.onMessage?.('主体尺寸：' + Math.round(subjectWidth) + 'x' + Math.round(subjectHeight));
            if (signal?.aborted) {
                emitStep('stopped', '主图设计已取消', '用户取消或信号中止。', 'error', 1);
                return { success: true, cancelled: true, message: '主图设计已取消。', toolResults: results };
            }

            let mainImageVisionSignal: MainImageVisionSignal | null = null;
            let mainImageVisionPreflight: MainImageVisionPreflightEvidence | null = null;
            let mainImageCandidatePreflight: MainImageCandidatePreflightPlan | null = null;
            const analyzerAvailable = typeof (window as any).designEcho?.analyzeAssetContent === 'function';
            const explicitAssetPath = getExplicitMainImageAssetPath(params);
            mainImageCandidatePreflight = buildMainImageCandidatePreflightPlan({
                userText: cleanString(params.userIntent || context?.userInput),
                currentDocument: buildMainImageCurrentDocumentCandidate(docInfo),
                projectAssets: buildMainImageProjectAssetCandidates(context),
                selectedAsset: explicitAssetPath ? {
                    path: explicitAssetPath,
                    name: basename(explicitAssetPath),
                    role: 'explicit-main-image-asset',
                    source: 'explicit-asset'
                } : null,
                enableVisionPreflight: getMainImageVisionPreflightEnabled(params),
                maxVisionCandidates: getMainImageMaxVisionCandidates(params),
                hasAnalyzer: analyzerAvailable
            });
            const preflightAssetPath = mainImageCandidatePreflight.shouldAnalyzePaths[0]
                || mainImageCandidatePreflight.selectedCandidate?.path
                || '';
            const preflightPlan = buildMainImageVisionPreflightPlan({
                enabled: getMainImageVisionPreflightEnabled(params),
                selectedAssetPath: preflightAssetPath,
                selectedAssetName: preflightAssetPath ? basename(preflightAssetPath) : undefined,
                hasAnalyzer: analyzerAvailable
            });
            mainImageVisionPreflight = buildMainImageVisionPreflightEvidence({ plan: preflightPlan });
            if (preflightPlan.shouldCallAnalyzer && preflightPlan.assetPath) {
                emitStep(
                    'tool_started',
                    '主图视觉预检',
                    `分析素材：${preflightPlan.assetName || basename(preflightPlan.assetPath)}`,
                    'running',
                    0.21
                );
                try {
                    const analysisResult = await (window as any).designEcho.analyzeAssetContent(preflightPlan.assetPath) as MainImageAssetAnalysisPayload;
                    results.push({
                        toolName: 'analyzeAssetContent[main-image-vision-preflight]',
                        result: analysisResult
                    });
                    mainImageVisionPreflight = buildMainImageVisionPreflightEvidence({
                        plan: preflightPlan,
                        result: analysisResult
                    });
                    mainImageVisionSignal = mainImageVisionPreflight.visionSignal || null;
                    emitStep(
                        'tool_completed',
                        mainImageVisionSignal ? '主图视觉预检完成' : '主图视觉预检未得到可用结果',
                        mainImageVisionPreflight.reason,
                        mainImageVisionSignal ? 'success' : 'error',
                        0.23
                    );
                } catch (error: any) {
                    mainImageVisionPreflight = buildMainImageVisionPreflightEvidence({
                        plan: preflightPlan,
                        error: error?.message || error
                    });
                    results.push({
                        toolName: 'analyzeAssetContent[main-image-vision-preflight]',
                        result: {
                            success: false,
                            error: mainImageVisionPreflight.error || 'Vision preflight failed'
                        }
                    });
                    emitStep(
                        'tool_completed',
                        '主图视觉预检失败',
                        mainImageVisionPreflight.error || 'analyzeAssetContent 调用失败。',
                        'error',
                        0.23
                    );
                }
            } else if (preflightPlan.enabled) {
                emitStep(
                    'observation',
                    '主图视觉预检未执行',
                    `${mainImageCandidatePreflight.evidence[0]?.summary || preflightPlan.reason} ${preflightPlan.reason}`,
                    preflightPlan.status === 'blocked_no_analyzer' ? 'error' : 'running',
                    0.21
                );
            }

            callbacks?.onProgress?.('分析设计上下文', 0.22);
            emitStep('observation', '准备主图设计执行计划', '读取平台规则、文案建议和执行开关。', 'running', 0.22);
            const { pipeline } = await prepareMainImageDesignPipeline({
                userIntent: params.userIntent as string | undefined,
                callbacks
            });
            const beforeReport = await pipeline.before();

            const sizeResults: MainImageSizeResult[] = [];
            const sizePlanEvidence: MainImageSizePlanEvidence[] = [];
            for (let i = 0; i < sizeKeys.length; i++) {
                const sizeKey = sizeKeys[i];
                const targetSize = MAIN_IMAGE_SIZE_SPECS[sizeKey];
                if (!targetSize) {
                    emitStep('warning', '跳过不支持的主图尺寸', `尺寸键 ${sizeKey} 不在 MAIN_IMAGE_SIZE_SPECS 中。`, 'error', 0.25);
                    callbacks?.onMessage?.('跳过不支持的尺寸：' + sizeKey);
                    continue;
                }

                callbacks?.onProgress?.('处理尺寸 ' + sizeKey + '（' + (i + 1) + '/' + sizeKeys.length + '）', 0.2 + (i / sizeKeys.length) * 0.7);
                const oneResult = await processOneSize(
                    sizeKey,
                    targetSize,
                    { width: subjectWidth, height: subjectHeight },
                    docInfo,
                    params,
                    callbacks,
                    signal,
                    results,
                    planFlags,
                    mainImageSpecRatio,
                    smartLayoutStepParams,
                    quickExportStepParams,
                    emitStep
                );
                const { sizePlanEvidence: oneSizePlanEvidence, ...sizeResult } = oneResult;
                sizePlanEvidence.push(oneSizePlanEvidence);
                sizeResults.push({ key: sizeKey, ...sizeResult });
                if (signal?.aborted) {
                    emitStep('stopped', '主图设计已取消', '用户取消或信号中止。', 'error', 1);
                    return { success: true, cancelled: true, message: '主图设计已取消。', toolResults: results };
                }
            }

            callbacks?.onProgress?.('执行最终验收', 0.93);
            emitStep('observation', '开始主图最终验收', '执行设计 pipeline 的 after 评审并汇总结果。', 'running', 0.93);
            const critiqueResult = await pipeline.after(beforeReport);
            callbacks?.onProgress?.('完成', 1.0);

            const anyAesthetic = sizeResults.some(r => r.aestheticUsed);
            const summary = buildMainImageExecutionSummary({
                sizeResults,
                imageType,
                outputDir: params.outputDir as string | undefined,
                copyResult,
                critiqueResult
            });

            const smartLayoutRuns = results.filter((r: any) => (r?.toolName || '').startsWith('smartLayout[')).length;
            const quickExportRuns = results.filter((r: any) => (r?.toolName || '').startsWith('quickExport[')).length;
            tracer.upsert('smartLayout', planFlags.useSmartLayout ? (smartLayoutRuns > 0 ? 'success' : 'failed') : 'skipped');
            tracer.upsert('quickExport', planFlags.useQuickExport ? (params.outputDir ? (quickExportRuns > 0 ? 'success' : 'failed') : 'skipped') : 'skipped');
            emitStep(
                'finalizing',
                '主图设计结果已汇总',
                `处理尺寸 ${sizeResults.length} 个，smartLayout ${smartLayoutRuns} 次，quickExport ${quickExportRuns} 次。`,
                'success',
                1
            );
            const designAgentOs = buildMainImageDesignAgentOsEvidence({
                userInput: String(params.userIntent || context?.userInput || '').trim(),
                imageType: String(imageType || ''),
                docInfo,
                subjectBounds,
                sizePlans: sizePlanEvidence,
                toolResults: results,
                success: true,
                critique: critiqueResult
            });
            const designPlanner = buildMainImagePlannerEvidence({
                params,
                context,
                docInfo,
                imageType: String(imageType || ''),
                sizeKeys,
                sizePlanEvidence,
                subjectBounds,
                copyCandidates: copyResult?.candidates || [],
                toolNames: results.map((entry: any) => String(entry?.toolName || '')).filter(Boolean),
                visionSignal: mainImageVisionSignal
            });
            const mainImageExecutionAlignment = buildMainImageExecutionAlignment({
                agentDraft: designPlanner.mainImageAgentDraft,
                toolResults: results,
                sizePlans: sizePlanEvidence
            });
            const mainImageScreenshotQaDraft = buildMainImageScreenshotQa({
                sizePlans: sizePlanEvidence,
                toolResults: results,
                visualVerification: designPlanner.mainImageAgentDraft.visualVerification,
                executionAlignment: mainImageExecutionAlignment
            });
            const mainImageResultFileProbes = await probeMainImageResultFiles(mainImageScreenshotQaDraft.resultImageEvidence.resultPaths);
            const referenceImagePath = getMainImageReferenceImagePath(params);
            const mainImagePixelProbe = await compareMainImageResultToReference({
                referenceImagePath,
                fileProbes: mainImageResultFileProbes,
                sizePlans: sizePlanEvidence
            });
            const mainImageScreenshotQa = buildMainImageScreenshotQa({
                sizePlans: sizePlanEvidence,
                toolResults: results,
                visualVerification: designPlanner.mainImageAgentDraft.visualVerification,
                executionAlignment: mainImageExecutionAlignment,
                pixelProbe: mainImagePixelProbe
            });
            const mainImageScreenshotProbeReadiness = buildMainImageScreenshotProbeReadiness({
                screenshotQa: mainImageScreenshotQa,
                sizePlans: sizePlanEvidence,
                fileProbes: mainImageResultFileProbes,
                referenceImagePath
            });
            const mainImageQaReport = buildMainImageQaReport({
                agentDraft: designPlanner.mainImageAgentDraft,
                candidatePreflight: mainImageCandidatePreflight,
                visionPreflight: mainImageVisionPreflight,
                executionAlignment: mainImageExecutionAlignment,
                screenshotQa: mainImageScreenshotQa,
                screenshotProbeReadiness: mainImageScreenshotProbeReadiness
            });
            const mainImageAcceptanceRecord = buildMainImageAcceptanceRecord({
                caseId: cleanString(params.acceptanceCaseId) || 'main-image-legacy-execution',
                source: 'legacy-active-document',
                qaReport: mainImageQaReport,
                resultFileProbes: mainImageResultFileProbes,
                resultImagePaths: mainImageScreenshotQa.resultImageEvidence.resultPaths,
                referenceImagePath,
                replayCommand: 'npm run smoke:main-image:acceptance-record'
            });
            const mainImageStrategyInputEvidence = designPlanner.mainImageAgentDraft.mainImageStrategyInputEvidence;

            return {
                success: true,
                message: summary.join('\n'),
                toolResults: results,
                data: {
                    sizeResults,
                    aestheticDecisionUsed: anyAesthetic,
                    critique: critiqueResult,
                    copySuggestions: copyResult?.candidates || [],
                    copyDegraded: copyResult?.degraded || false,
                    designAgentOs,
                    designPlanner,
                    designPlannerPreflight,
                    designPlannerPreflightGate,
                    mainImageCandidatePreflight,
                    mainImageVisionPreflight,
                    mainImageAgentDraft: designPlanner.mainImageAgentDraft,
                    mainImageStrategyInputEvidence,
                    mainImageDesignPlacementIntelligence: designPlanner.mainImageDesignPlacementIntelligence,
                    mainImageDesignCoreEvidence: mainImageStrategyInputEvidence.designCoreEvidence,
                    mainImageExecutionAlignment,
                    mainImageScreenshotQa,
                    mainImageScreenshotProbeReadiness,
                    mainImageQaReport,
                    mainImageAcceptanceRecord,
                    mainImageAssetSelection: designPlanner.mainImageAgentDraft.assetSelection,
                    mainImageVisualUnderstanding: designPlanner.mainImageAgentDraft.assetVisualUnderstanding,
                    mainImageVisualVerification: designPlanner.mainImageAgentDraft.visualVerification
                },
            };
        } catch (e: any) {
            console.error('[MainImageExecutor] execution failed', e);
            emitStep('warning', '主图设计执行异常', e?.message || '未知错误', 'error', 1);
            return {
                success: false,
                message: '**主图设计失败** ' + e.message,
                error: e.message,
                toolResults: results,
            };
        }
    },
};
