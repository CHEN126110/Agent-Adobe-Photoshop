/**
 * 主图设计执行器
 *
 * 负责主图设计的完整流程：主体检测 → 智能排版 → AI 背景生成 → 导出
 * 末尾运行 Critique 对设计结果进行自动评审
 */

import type { SkillExecutor, SkillExecuteParams } from './types';
import type { AgentResult } from '../unified-agent.service';
import type { DesignProjectState } from '../../../shared/types/design-project-state.types';

import { executeToolCall } from '../tool-executor.service';
import { getPhotoshopConnectionStatus } from '../mcp-host.client';
import { emitSkillStep } from './skill-step-events';
import {
    getMainImageDeliveryDocument,
    MAIN_IMAGE_SIZE_SPECS,
    resolveMainImageSizeKeys
} from './main-image-delivery-spec';
import {
    type MainImageSizePlan
} from '../../../shared/design-agent-os-contracts';
import {
    buildDesignMemoryKnowledgeResultsForSkill,
    buildMainImageDesignPlacementIntelligencePlan,
    buildMainImageMemoryContextForSkill,
    extractEcommerceSocksChildStrategyHandoffFromContext
} from './design-planner-context';
import { buildEcommerceSocksChildStrategyInput } from '../../../shared/ecommerce-socks-child-strategy-consumer';
import {
    buildMainImageVisionPreflightResult,
    buildMainImageVisionPreflightPlan,
    type MainImageVisionPreflightResult,
    type MainImageAssetAnalysisPayload
} from '../../../shared/main-image-vision-preflight';
import {
    selectMainImageAssetCandidate,
    type MainImageAssetSelectionAsset,
    type MainImageAssetVisionSignal,
} from '../../../shared/main-image-asset-selection';
import {
    type MainImageScreenshotProbeObservation
} from '../../../shared/main-image-screenshot-qa';
import {
    type MainImageResultFileProbe
} from '../../../shared/main-image-screenshot-probe-readiness';
import { buildMainImageQaReport } from '../../../shared/main-image-qa-report';
import {
    normalizeSkillDeliveryArtifactPath,
    resolveSkillDeliveryConvention
} from '../../../shared/skills/skill-delivery-convention';
import {
    hasConcreteProjectVisualInsight,
    normalizeProjectVisualInsightCompositionFields,
    pickPreferredProjectVisualInsightCacheEntry
} from '../../../shared/project-visual-sampling';
import type {
    MainImageManualReviewRecord,
    MainImageVisionSignal
} from '../../../shared/main-image-visual-loop';
import { buildMainImageAgentDraftPlan } from '../../../shared/main-image-agent-draft-plan';
import { buildMainImageStrategyInputs } from '../../../shared/main-image-strategy-input-builder';
import { buildMainImagePlatformSizeProfile } from '../../../shared/main-image-production-document-structure';
import {
    buildMainImageStateContext,
    buildMainImageStateVersionPatch,
    mergeMainImageStateCopyCandidates,
    mergeMainImageStateReferenceHints,
    type MainImageStateContext
} from '../../../shared/main-image-state-consumption';
import {
    buildMainImageWhiteBackgroundExportContract,
    buildMainImageWhiteBackgroundLiveToolRequest,
    isMainImageWhiteBackgroundFromSkuMaterialRequest
} from '../../../shared/main-image-white-background-export-contract';
import { buildMainImageLiveExecutorCheckpoint } from '../../../shared/main-image-live-executor-checkpoint';
import { buildMainImageLivePhotoshopAdapterContract } from '../../../shared/main-image-live-photoshop-adapter-contract';
import { buildMainImageLiveAdapterHandoff } from '../../../shared/main-image-live-adapter-handoff';
import {
    runMainImageLiveExecutor,
    type MainImageLiveExecutorRunResult
} from '../../../shared/main-image-live-executor-runner';
import {
    buildMainImageControlledProductQaGate,
    extractMainImageControlledProductResultPaths
} from '../../../shared/main-image-controlled-product-qa-gate';
import { buildMainImageControlledProductQaBundle } from '../../../shared/main-image-controlled-product-qa-bridge';
import { buildMainImageAcceptanceRecord } from '../../../shared/main-image-acceptance-record';
import {
    buildMainImageDeliveryRuntimeEvidence,
    inspectMainImageStagedDeliveryBeforePromotion,
    probeMainImageResultFiles
} from './main-image-delivery-runtime';
import { createMainImageLivePhotoshopToolAdapter } from './main-image-live-photoshop-tool-adapter';
import {
    finalizeRuntimeStagedDelivery,
    prepareRuntimeStagedDelivery,
    promoteRuntimeStagedDelivery,
    readRuntimeStagedDeliveryDispatchContext,
    type RuntimeStagedDeliveryContext,
    type RuntimeStagedDeliveryDispatchContext
} from './runtime-staged-delivery.service';

type EmitMainImageStep = (
    kind: Parameters<typeof emitSkillStep>[1]['kind'],
    title: string,
    detail?: string,
    status?: Parameters<typeof emitSkillStep>[1]['status'],
    percent?: number
) => void;

type MainImageControlledExecutionMode =
    | 'strategy-only'
    | 'product-disposable-live';

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
    'saveDocument',
    'exportWhiteBgFromSkuMaterial',
    'getDocumentInfo',
    'getLayerHierarchy',
    'getLayerProperties',
    'getAcceptanceSnapshot'
];

const MAIN_IMAGE_CUSTOM_EXPLICIT_SIZE_KEY = 'custom-explicit-main-image';

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
    if (value === 'product-disposable-live') return value;
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

function readPositiveInteger(value: unknown): number | undefined {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    return Math.round(parsed);
}

function normalizeMainImageCustomSize(value: unknown): { width: number; height: number } | undefined {
    if (!isRecord(value)) return undefined;
    const width = readPositiveInteger(value.width);
    const height = readPositiveInteger(value.height);
    if (!width || !height) return undefined;
    return { width, height };
}

function getExplicitMainImageCustomSize(params: Record<string, any>): { width: number; height: number } | undefined {
    return normalizeMainImageCustomSize(params.customSize)
        || normalizeMainImageCustomSize(params.targetSize)
        || normalizeMainImageCustomSize(params.canvasSize);
}

function formatMainImageRatio(size: { width: number; height: number }): string {
    const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
    const divisor = gcd(size.width, size.height) || 1;
    return `${Math.round(size.width / divisor)}:${Math.round(size.height / divisor)}`;
}

function buildExplicitMainImagePlatformProfile(size: { width: number; height: number }) {
    return buildMainImagePlatformSizeProfile({
        includeProjectPreferenceThirdRatio: true,
        projectPreferenceThirdRatio: {
            id: MAIN_IMAGE_CUSTOM_EXPLICIT_SIZE_KEY,
            ratio: formatMainImageRatio(size),
            label: `用户指定 ${size.width}x${size.height} 主图`,
            designSize: size,
            exportSize: size,
            sourceLevel: 'user_project_rule',
            officialClaimAllowed: false,
            reason: `用户在本次请求中明确指定主图画布和导出尺寸为 ${size.width}x${size.height}。`,
            warnings: []
        }
    });
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

function buildMainImageSizePlan(input: {
    key: string;
    targetSizeOverride?: { width: number; height: number };
    providedPlan?: Record<string, any> | null;
    subjectSize: { width: number; height: number };
    defaultScale?: number;
    imageType: string;
    outputDir: string;
}): MainImageSizePlan | null {
    const targetSize = input.targetSizeOverride || MAIN_IMAGE_SIZE_SPECS[input.key];
    if (!targetSize) return null;

    const provided = input.providedPlan || {};
    const providedTarget = isRecord(provided.targetSize) ? provided.targetSize : {};
    const targetMatches = Boolean(input.targetSizeOverride)
        || readNumber(providedTarget.width) === targetSize.width
        && readNumber(providedTarget.height) === targetSize.height;
    const providedSubject = isRecord(provided.subjectSize) ? provided.subjectSize : {};
    const subjectSize = {
        width: readNumber(providedSubject.width) || input.subjectSize.width,
        height: readNumber(providedSubject.height) || input.subjectSize.height
    };
    const providedScale = readNumber(provided.scale);
    const fallbackScale = readNumber(input.defaultScale);
    const scale = providedScale !== undefined && providedScale > 0
        ? providedScale
        : (fallbackScale !== undefined && fallbackScale > 0 ? fallbackScale : undefined);
    if (scale === undefined) return null;
    const providedTargetX = readNumber(provided.targetX);
    const providedTargetY = readNumber(provided.targetY);
    const targetX = targetMatches && providedTargetX !== undefined
        ? providedTargetX
        : Math.max(0, Math.round((targetSize.width - subjectSize.width * scale) / 2));
    const targetY = targetMatches && providedTargetY !== undefined
        ? providedTargetY
        : Math.max(0, Math.round((targetSize.height - subjectSize.height * scale) / 2));
    const deliveryDocument = input.targetSizeOverride ? null : getMainImageDeliveryDocument(input.key);
    const exportAllowed = !deliveryDocument || deliveryDocument.includedImageTypes.includes(input.imageType as any);
    const quickExportPlanned = Boolean(input.outputDir)
        && exportAllowed
        && provided.quickExportPlanned !== false;
    const customSizeReason = input.targetSizeOverride
        ? `用户明确指定 ${targetSize.width}x${targetSize.height} 像素主图。`
        : '';
    const decisionReason = cleanString(provided.decisionReason)
        ? `${cleanString(provided.decisionReason)}；已规范化到 ${input.key} 交付尺寸。`
        : (customSizeReason || 'controlled product path strategy-only plan');

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
        // 精确输出路径由 MainImage Skill delivery plan 在生产结构确定后统一编译。
        // 这里不能再生成与真实 exportGroup 格式不一致的伪 quickExport 路径。
    };
}

function normalizeMainImageSizePlans(
    params: Record<string, any>,
    subjectBounds: any | null
): MainImageSizePlan[] {
    const providedPlans = Array.isArray(params.sizePlans)
        ? params.sizePlans.filter(isRecord) as Record<string, any>[]
        : [];
    const subjectSize = {
        width: Number(subjectBounds?.width || 0) || 1,
        height: Number(subjectBounds?.height || 0) || 1
    };
    const requestedScale = readNumber(params.productScale);
    const scale = requestedScale !== undefined && requestedScale > 0 ? requestedScale : undefined;
    const imageType = cleanString(params.imageType) || 'click';
    const outputDir = cleanString(params.outputDir);
    const customSize = getExplicitMainImageCustomSize(params);
    if (customSize) {
        const plan = buildMainImageSizePlan({
            key: MAIN_IMAGE_CUSTOM_EXPLICIT_SIZE_KEY,
            targetSizeOverride: customSize,
            providedPlan: providedPlans[0],
            subjectSize,
            defaultScale: scale,
            imageType,
            outputDir
        });
        return plan ? [plan] : [];
    }
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
        .map((key: string): MainImageSizePlan | null => {
            return buildMainImageSizePlan({
                key,
                providedPlan: providedPlanBySize.get(key),
                subjectSize,
                defaultScale: scale,
                imageType,
                outputDir
            });
        })
        .filter(Boolean) as MainImageSizePlan[];
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

function getMainImageReferenceImagePath(params: Record<string, any>): string {
    return cleanString(params.referenceImagePath)
        || cleanString(params.referencePath)
        || cleanString(params.referenceAssetPath)
        || cleanString(params.referenceImage);
}

function uniquePaths(paths: string[]): string[] {
    return Array.from(new Set(paths.map((item) => cleanString(item)).filter(Boolean)));
}

function getPathBasename(value: unknown): string {
    const normalized = cleanString(value).replace(/\\/g, '/').replace(/\/+$/g, '');
    const parts = normalized.split('/').filter(Boolean);
    return parts[parts.length - 1] || normalized;
}

function selectMainImageUserVisibleResultFile(probes: MainImageResultFileProbe[]): MainImageResultFileProbe | undefined {
    return probes.find((probe) => probe.status === 'ok' && probe.exists !== false && probe.isFile !== false)
        || probes.find((probe) => probe.status === 'ok');
}

function formatMainImageUserVisibleResultFile(probe: MainImageResultFileProbe | undefined): string {
    if (!probe) return '可验收文件：本轮没有读回到可打开的导出文件。';
    const fileName = getPathBasename(probe.path);
    const dimensions = probe.dimensions?.width && probe.dimensions?.height
        ? `（${probe.dimensions.width}x${probe.dimensions.height}）`
        : '';
    return `可验收文件：${fileName}${dimensions}`;
}

function findMainImageProbeTargetSize(
    resultPath: string,
    sizePlans: MainImageSizePlan[]
): { width: number; height: number } | undefined {
    const normalized = cleanString(resultPath).replace(/\\/g, '/');
    const exact = sizePlans.find((plan) => cleanString(plan.quickExportOutputPath).replace(/\\/g, '/') === normalized);
    const fallback = exact || sizePlans.find((plan) => plan.targetSize?.width > 0 && plan.targetSize?.height > 0);
    return fallback?.targetSize;
}

async function compareMainImageResultToReference(input: {
    referenceImagePath: string;
    fileProbes: MainImageResultFileProbe[];
    sizePlans: MainImageSizePlan[];
}): Promise<MainImageScreenshotProbeObservation | undefined> {
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

function getMainImageProjectPath(context?: SkillExecuteParams['context']): string {
    const projectContext = context?.projectContext as any;
    return cleanString(projectContext?.projectPath || projectContext?.contextSnapshot?.project?.path);
}

function normalizeMainImagePathKey(value: unknown): string {
    return cleanString(value).replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
}

function joinProjectRelativePath(projectPath: string, relativePath: string): string {
    const root = cleanString(projectPath).replace(/\\/g, '/').replace(/\/+$/g, '');
    const relative = cleanString(relativePath).replace(/\\/g, '/').replace(/^\/+/g, '');
    if (!root) return relative;
    if (!relative) return root;
    return `${root}/${relative}`;
}

function getProjectAssetIndexAssets(context?: SkillExecuteParams['context']): Record<string, any>[] {
    const assets = (context?.projectContext as any)?.assetIndex?.assets;
    return Array.isArray(assets) ? assets.filter(isRecord) : [];
}

function findProjectAssetIndexAsset(
    context: SkillExecuteParams['context'] | undefined,
    assetPath: string
): Record<string, any> | null {
    const target = normalizeMainImagePathKey(assetPath);
    if (!target) return null;
    const projectPath = getMainImageProjectPath(context);
    for (const asset of getProjectAssetIndexAssets(context)) {
        const paths = [
            asset.path,
            asset.relativePath,
            projectPath && asset.relativePath ? joinProjectRelativePath(projectPath, asset.relativePath) : ''
        ].map(normalizeMainImagePathKey).filter(Boolean);
        if (paths.includes(target)) return asset;
    }
    return null;
}

function buildMainImageAssetVisionSignalFromCache(
    context: SkillExecuteParams['context'] | undefined,
    candidate: { path?: string; name?: string }
): MainImageAssetVisionSignal | undefined {
    const insight = findProjectVisualInsightForAsset(context, candidate);
    if (!insight) return undefined;
    // 构图理解字段（缓存透传，见 project-visual-sampling 的归一化口径）：
    // 有值则送达 makeCandidate 的 visionSignal 打分；旧缓存条目没有这些字段时保持原有 productType/scene 行为。
    const composition = normalizeProjectVisualInsightCompositionFields(insight as unknown as Record<string, unknown>);
    const productType = cleanString(insight.productType);
    const compositionFocus = composition.compositionFocus || cleanString(insight.scene);
    if (!productType && !compositionFocus && !composition.mainImageSuitability && !composition.subjectCoverageRatio) {
        return undefined;
    }
    return {
        ...(composition.mainImageSuitability ? { mainImageSuitability: composition.mainImageSuitability } : {}),
        ...(composition.subjectCoverageRatio ? { subjectCoverageRatio: composition.subjectCoverageRatio } : {}),
        productType: productType || undefined,
        compositionFocus: compositionFocus || undefined,
        source: 'project-visual-insight-cache'
    };
}

function buildMainImageProjectAssetCandidate(input: {
    path: string;
    context?: SkillExecuteParams['context'];
    selectedProjectImagePath?: string;
}): MainImageAssetSelectionAsset | null {
    const rawPath = cleanString(input.path);
    if (!rawPath) return null;
    const asset = findProjectAssetIndexAsset(input.context, rawPath);
    const projectPath = getMainImageProjectPath(input.context);
    const resolvedPath = cleanString(asset?.path)
        || (asset?.relativePath && projectPath ? joinProjectRelativePath(projectPath, asset.relativePath) : '')
        || rawPath;
    const selectedKey = normalizeMainImagePathKey(input.selectedProjectImagePath);
    const isSelected = Boolean(selectedKey && normalizeMainImagePathKey(resolvedPath) === selectedKey);
    const width = readNumber(asset?.width);
    const height = readNumber(asset?.height);
    const name = cleanString(asset?.name) || basename(resolvedPath);
    // 治理审计(2026-07-01)阶段1：把项目视觉理解缓存(若已存在)接入候选打分，叠加而非替换关键词打分。
    // 见 design-agent-governance-audit-20260701 与 main-image-asset-selection.ts 的 makeCandidate。
    const visionSignal = buildMainImageAssetVisionSignalFromCache(input.context, { path: resolvedPath, name });
    return {
        ...(cleanString(asset?.id) ? { id: cleanString(asset?.id) } : {}),
        path: resolvedPath,
        name,
        role: isSelected ? 'selected-project-image' : cleanString(asset?.role) || 'project-image',
        source: isSelected ? 'selected-project-image' : 'project-asset',
        ...(width && height ? { width, height } : {}),
        ...(visionSignal ? { visionSignal } : {})
    };
}

function buildMainImageProjectAssetCandidates(context?: SkillExecuteParams['context']): MainImageAssetSelectionAsset[] {
    const projectContext = context?.projectContext as any;
    const selectedProjectImagePath = cleanString(projectContext?.selectedProjectImagePath);
    const visualSamplingPaths = Array.isArray(projectContext?.visualSamplingPlan?.selectedCandidates)
        ? projectContext.visualSamplingPlan.selectedCandidates.map((candidate: any) => candidate?.path)
        : [];
    const visionCandidatePaths = Array.isArray(projectContext?.assetIndex?.visionCandidates)
        ? projectContext.assetIndex.visionCandidates.map((candidate: any) => candidate?.path)
        : [];
    const rawPaths = [
        selectedProjectImagePath,
        ...(projectContext?.sampleImagePaths || []),
        ...visualSamplingPaths,
        ...visionCandidatePaths
    ].filter(Boolean);
    const seen = new Set<string>();
    const candidates: MainImageAssetSelectionAsset[] = [];
    for (const rawPath of rawPaths) {
        const candidate = buildMainImageProjectAssetCandidate({
            path: String(rawPath),
            context,
            selectedProjectImagePath
        });
        const key = normalizeMainImagePathKey(candidate?.path);
        if (!candidate || !key || seen.has(key)) continue;
        seen.add(key);
        candidates.push(candidate);
        if (candidates.length >= 24) break;
    }
    return candidates;
}

function resolveMainImageProjectOutputDir(params: Record<string, any>, context?: SkillExecuteParams['context']): string {
    const explicitOutputDir = cleanString(params.outputDir);
    if (explicitOutputDir) return explicitOutputDir;
    const userText = cleanString(params.userIntent || context?.userInput);
    const projectPath = getMainImageProjectPath(context);
    const asksProjectMainImageDir = params.outputDirPolicy === 'project-main-image-dir'
        || /项目.{0,8}主图.{0,4}(目录|文件夹)|主图目录|["“”]主图["“”]目录/.test(userText);
    if (!projectPath || !asksProjectMainImageDir) return '';
    return joinProjectRelativePath(projectPath, '主图');
}

function inferSubjectBoundsFromSelectedAsset(asset: MainImageAssetSelectionAsset | null | undefined): any | null {
    const width = readNumber(asset?.width);
    const height = readNumber(asset?.height);
    if (!width || !height || width <= 0 || height <= 0) return null;
    return {
        left: 0,
        top: 0,
        right: width,
        bottom: height,
        width,
        height
    };
}

function enrichMainImageSelectedAsset(
    selectedAsset: MainImageAssetSelectionAsset | null | undefined,
    projectAssets: MainImageAssetSelectionAsset[]
): MainImageAssetSelectionAsset | null {
    if (!selectedAsset) return null;
    const selectedKey = normalizeMainImagePathKey(selectedAsset.path);
    const matchingProjectAsset = projectAssets.find((asset) => (
        selectedKey && normalizeMainImagePathKey(asset.path) === selectedKey
    ));
    if (!matchingProjectAsset) return selectedAsset;
    return {
        ...matchingProjectAsset,
        ...selectedAsset,
        width: readNumber(selectedAsset.width) || readNumber(matchingProjectAsset.width),
        height: readNumber(selectedAsset.height) || readNumber(matchingProjectAsset.height),
        role: selectedAsset.role || matchingProjectAsset.role,
        source: selectedAsset.source || matchingProjectAsset.source,
        name: selectedAsset.name || matchingProjectAsset.name,
        path: selectedAsset.path || matchingProjectAsset.path
    };
}

function findProjectVisualInsightForAsset(
    context: SkillExecuteParams['context'] | undefined,
    asset: MainImageAssetSelectionAsset | null | undefined
): Record<string, any> | null {
    const entries = (context?.projectContext as any)?.visualInsightCache?.entries;
    if (!Array.isArray(entries) || !asset) return null;
    const assetPathKey = normalizeMainImagePathKey(asset.path);
    const assetIdKey = cleanString(asset.id).toLowerCase();
    if (!assetPathKey && !assetIdKey) return null;
    // 同一素材路径可能同时存在 project-image-analysis:*（仅 productType/summary）与
    // project-visual:*（含构图字段）两类条目；不能「先到先得」，否则旧条目在前时
    // 构图信号会被无声遮蔽。按共享择优规则取信号最富的一条（同富度取时间戳最新/后写入）。
    let preferredEntry: Record<string, any> | undefined;
    for (const entry of entries) {
        if (!isRecord(entry)) continue;
        const insight = isRecord(entry.insight) ? entry.insight : null;
        const expiresAt = cleanString(entry.expiresAt || insight?.expiresAt);
        const expiresAtMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;
        if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) continue;
        const pathKeys = [entry.path, insight?.path]
            .map(normalizeMainImagePathKey)
            .filter(Boolean);
        const idKeys = [entry.assetId, insight?.assetId]
            .map((value) => cleanString(value).toLowerCase())
            .filter(Boolean);
        const matched = assetPathKey && pathKeys.length > 0
            ? pathKeys.every((pathKey) => pathKey === assetPathKey)
            : Boolean(assetIdKey && idKeys.includes(assetIdKey));
        if (!matched || !hasConcreteProjectVisualInsight(insight)) continue;
        preferredEntry = pickPreferredProjectVisualInsightCacheEntry(preferredEntry, entry);
    }
    return preferredEntry && isRecord(preferredEntry.insight) ? preferredEntry.insight : null;
}

function buildVisionSignalFromProjectInsight(
    insight: Record<string, any> | null,
    asset: MainImageAssetSelectionAsset | null | undefined
): MainImageVisionSignal | null {
    if (!hasConcreteProjectVisualInsight(insight)) return null;
    const assetPath = cleanString(asset?.path);
    if (!assetPath) return null;
    const productType = cleanString(insight.productType) || 'unknown';
    const summary = cleanString(insight.summary)
        || [
            productType !== 'unknown' ? productType : '',
            cleanString(insight.scene),
            cleanString(insight.material)
        ].filter(Boolean).join('，');
    const styleTags = Array.isArray(insight.styleTags)
        ? insight.styleTags.map(cleanString).filter(Boolean).slice(0, 8)
        : [];
    if (!summary && productType === 'unknown' && styleTags.length === 0) return null;
    // 构图理解字段（缓存透传）：与打分端同一归一化口径，旧缓存条目缺字段时保持 undefined。
    const composition = normalizeProjectVisualInsightCompositionFields(insight as unknown as Record<string, unknown>);
    const sourceNotes = [
        'source=project-visual-insight-cache',
        `cachedInsight=${cleanString(asset?.name || asset?.path) || 'project asset'}`,
        summary ? `summary=${summary}` : '',
        styleTags.length ? `style=${styleTags.join(',')}` : '',
        composition.subjectCoverageRatio ? `subjectCoverageRatio=${composition.subjectCoverageRatio}` : '',
        composition.subjectPosition ? `subjectPosition=${composition.subjectPosition}` : '',
        composition.compositionFocus ? `compositionFocus=${composition.compositionFocus}` : '',
        composition.mainImageSuitability ? `mainImageSuitability=${composition.mainImageSuitability}` : ''
    ].filter(Boolean);
    return {
        source: 'project-visual-insight-cache',
        assetRef: {
            ...(cleanString(asset?.id) ? { id: cleanString(asset?.id) } : {}),
            path: assetPath,
            ...(cleanString(asset?.name) ? { name: cleanString(asset?.name) } : {})
        },
        productType,
        subjectSummary: summary || undefined,
        backgroundSummary: cleanString(insight.scene) || 'unknown',
        sceneSummary: cleanString(insight.scene) || undefined,
        styleHints: styleTags,
        ...(composition.subjectCoverageRatio ? { subjectCoverageRatio: composition.subjectCoverageRatio } : {}),
        ...(composition.subjectPosition ? { subjectPosition: composition.subjectPosition } : {}),
        ...(composition.compositionFocus ? { compositionFocus: composition.compositionFocus } : {}),
        ...(composition.mainImageSuitability ? { mainImageSuitability: composition.mainImageSuitability } : {}),
        ...(composition.mainImageSuitabilityReason ? { mainImageSuitabilityReason: composition.mainImageSuitabilityReason } : {}),
        risks: [],
        sourceNotes
    };
}

async function resolveControlledMainImageVisionSignal(input: {
    params: Record<string, any>;
    context?: SkillExecuteParams['context'];
    selectedAsset: MainImageAssetSelectionAsset | null;
    emitStep: EmitMainImageStep;
    toolResults: Array<Record<string, unknown>>;
}): Promise<{
    visionSignal: MainImageVisionSignal | null;
    visionPreflight: MainImageVisionPreflightResult | null;
}> {
    const cached = buildVisionSignalFromProjectInsight(
        findProjectVisualInsightForAsset(input.context, input.selectedAsset),
        input.selectedAsset
    );
    if (cached) {
        return {
            visionSignal: cached,
            visionPreflight: {
                status: 'succeeded',
                resultStatus: 'succeeded',
                enabled: true,
                shouldCallAnalyzer: false,
                assetPath: cleanString(input.selectedAsset?.path) || undefined,
                assetName: cleanString(input.selectedAsset?.name) || undefined,
                reason: '已复用与所选素材绑定的项目视觉缓存。',
                warnings: [],
                limitations: [
                    '项目视觉缓存只提供素材理解结果，不代表主图质量通过。',
                    '真实执行后仍必须读回导出文件和截图/人工验收。'
                ],
                visionSignal: cached
            }
        };
    }

    const analyzer = typeof window !== 'undefined'
        ? (window as any).designEcho?.analyzeAssetContent
        : null;
    const assetPath = cleanString(input.selectedAsset?.path);
    const plan = buildMainImageVisionPreflightPlan({
        enabled: getMainImageVisionPreflightEnabled(input.params),
        selectedAssetId: input.selectedAsset?.id,
        selectedAssetPath: assetPath,
        selectedAssetName: input.selectedAsset?.name,
        hasAnalyzer: typeof analyzer === 'function'
    });
    if (!plan.shouldCallAnalyzer || !assetPath || typeof analyzer !== 'function') {
        return {
            visionSignal: null,
            visionPreflight: buildMainImageVisionPreflightResult({ plan })
        };
    }

    input.emitStep(
        'tool_started',
        '主图素材视觉预检',
        `分析素材：${plan.assetName || basename(assetPath)}`,
        'running',
        0.16
    );
    try {
        const analysisResult = await analyzer(assetPath) as MainImageAssetAnalysisPayload;
        input.toolResults.push({
            toolName: 'analyzeAssetContent[main-image-controlled-product]',
            result: analysisResult
        });
        const preflightResult = buildMainImageVisionPreflightResult({
            plan,
            result: analysisResult
        });
        input.emitStep(
            'tool_completed',
            '主图素材视觉预检完成',
            '素材视觉信息已返回，后续策略只消费这次受控观察。',
            preflightResult.visionSignal ? 'success' : 'error',
            0.18
        );
        return {
            visionSignal: preflightResult.visionSignal || null,
            visionPreflight: preflightResult
        };
    } catch (error: any) {
        const preflightResult = buildMainImageVisionPreflightResult({
            plan,
            error: error?.message || String(error)
        });
        input.toolResults.push({
            toolName: 'analyzeAssetContent[main-image-controlled-product]',
            result: {
                success: false,
                error: error?.message || String(error)
            }
        });
        input.emitStep(
            'warning',
            '主图素材视觉预检未完成',
            '视觉分析未返回可用结果，后续不会把缺失观察当成事实。',
            'error',
            0.18
        );
        return {
            visionSignal: null,
            visionPreflight: preflightResult
        };
    }
}

async function readDesignProjectStateForMainImage(
    projectPath: string,
    results: Array<Record<string, unknown>>
): Promise<DesignProjectState | null> {
    if (!projectPath || typeof window === 'undefined') return null;
    const designEcho = (window as any).designEcho;
    if (!designEcho?.getDesignState) return null;
    try {
        const state = await designEcho.getDesignState(projectPath);
        results.push({
            toolName: 'getDesignProjectState[main-image]',
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
            toolName: 'getDesignProjectState[main-image]',
            result: {
                success: false,
                error: error?.message || String(error)
            }
        });
        return null;
    }
}

async function appendMainImageVersionRecord(params: {
    projectPath: string;
    action: 'strategy' | 'execute' | 'export';
    stateContext: MainImageStateContext | null;
    reason?: string;
    exportedFileCount?: number;
    results: Array<Record<string, unknown>>;
}) {
    if (!params.projectPath || typeof window === 'undefined') return null;
    const patch = buildMainImageStateVersionPatch({
        action: params.action,
        compositionVersions: params.stateContext?.compositionVersions || [],
        selectedVersionId: params.stateContext?.compositionVersions?.[0]?.id,
        reason: params.reason,
        exportedFileCount: params.exportedFileCount
    });
    if (!patch) return null;
    const designEcho = (window as any).designEcho;
    if (!designEcho?.updateDesignState) return null;
    try {
        const result = await designEcho.updateDesignState(params.projectPath, patch);
        params.results.push({
            toolName: `updateDesignProjectState[main-image:${params.action}]`,
            result
        });
        return result;
    } catch (error: any) {
        const result = {
            success: false,
            error: error?.message || String(error)
        };
        params.results.push({
            toolName: `updateDesignProjectState[main-image:${params.action}]`,
            result
        });
        return result;
    }
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

function hasExplicitPhotoshopConnection(params: Record<string, any>): boolean {
    const connection = isRecord(params.photoshopConnection) ? params.photoshopConnection : {};
    return Object.prototype.hasOwnProperty.call(connection, 'connected')
        || Object.prototype.hasOwnProperty.call(connection, 'documentWriteAvailable');
}

function buildExplicitControlledPhotoshopConnection(params: Record<string, any>) {
    const connection = isRecord(params.photoshopConnection) ? params.photoshopConnection : {};
    return {
        connected: connection.connected === true,
        documentWriteAvailable: connection.documentWriteAvailable === true,
        source: cleanString(connection.source) || 'main-image-executor-controlled-product-branch',
        currentDocumentId: connection.currentDocumentId ?? null,
        activeDocumentName: cleanString(connection.activeDocumentName) || null
    };
}

async function resolveControlledPhotoshopConnection(params: Record<string, any>) {
    if (hasExplicitPhotoshopConnection(params)) {
        return buildExplicitControlledPhotoshopConnection(params);
    }

    try {
        const status = await getPhotoshopConnectionStatus();
        const connected = status.connected === true;
        return {
            connected,
            documentWriteAvailable: connected,
            source: `runtime-${status.source || 'photoshop-connection-status'}`,
            currentDocumentId: null,
            activeDocumentName: null
        };
    } catch (error: any) {
        return {
            connected: false,
            documentWriteAvailable: false,
            source: `runtime-connection-status-error:${cleanString(error?.message || error) || 'unknown'}`,
            currentDocumentId: null,
            activeDocumentName: null
        };
    }
}

function buildControlledToolchainCheck(contract: any, source: string) {
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

function normalizeControlledPixelProbe(value: unknown): MainImageScreenshotProbeObservation | null {
    if (!isRecord(value)) return null;
    return value as unknown as MainImageScreenshotProbeObservation;
}

function normalizeControlledManualReview(value: unknown): MainImageManualReviewRecord | null {
    if (!isRecord(value)) return null;
    return value as unknown as MainImageManualReviewRecord;
}

function buildPublicMainImageRunnerSummary(
    runner: MainImageLiveExecutorRunResult
): Record<string, unknown> {
    return {
        version: runner.version,
        skillId: runner.skillId,
        status: runner.status,
        executionScope: runner.executionScope,
        executedWithAdapter: runner.executedWithAdapter,
        mayWritePhotoshop: runner.mayWritePhotoshop,
        operationCount: runner.operationCount,
        executedOperationCount: runner.executedOperationCount,
        successfulOperationCount: runner.successfulOperationCount,
        failedOperationCount: runner.failedOperationCount,
        failedReadbackCount: runner.failedReadbackCount,
        finalAcceptanceSnapshotCaptured: runner.finalAcceptanceSnapshot?.success === true,
        blockers: [...runner.blockers],
        warnings: [...runner.warnings],
        limitations: [...runner.limitations]
    };
}

function buildPublicMainImageOperationResults(
    runner: MainImageLiveExecutorRunResult
): Array<Record<string, unknown>> {
    return runner.operationResults.map((operation) => ({
        toolName: operation.tool,
        requestId: operation.requestId,
        result: {
            success: operation.success,
            phase: operation.phase,
            summary: operation.success
                ? '主图生产步骤已完成并读回。'
                : '主图生产步骤未完成。',
            readbackCount: operation.readbackResults.length,
            failedReadbackCount: operation.readbackResults.filter((readback) => !readback.success).length
        }
    }));
}

async function runControlledMainImageProductPath(input: {
    params: Record<string, any>;
    context?: SkillExecuteParams['context'];
    callbacks?: SkillExecuteParams['callbacks'];
    signal?: AbortSignal;
    runtimeDeliveryPlanAuthority?: SkillExecuteParams['runtimeDeliveryPlanAuthority'];
    emitStep: EmitMainImageStep;
}): Promise<AgentResult> {
    const mode = normalizeMainImageExecutionMode(input.params.mainImageExecutionMode);
    const toolResults: Array<Record<string, unknown>> = [];

    input.emitStep(
        'task_started',
        '准备执行主图设计',
        mode === 'strategy-only'
            ? '整理素材、尺寸与交付规则，当前只生成方案。'
            : '整理素材、尺寸与受控 Photoshop 执行条件。',
        'running',
        0.02
    );

    const userText = cleanString(input.params.userIntent || input.context?.userInput);
    const imageType = cleanString(input.params.imageType) || 'click';
    const executionScope = normalizeMainImageExecutionScope(input.params.executionScope);
    const projectPath = getMainImageProjectPath(input.context);
    if (input.params.deliveryConvention !== undefined && input.params.deliveryConvention !== null) {
        const deliveryConventionResolution = resolveSkillDeliveryConvention(input.params.deliveryConvention);
        if (deliveryConventionResolution.status === 'blocked') {
            return {
                success: false,
                message: '本次主图的目录、命名或版本约定不安全，尚未读取或修改 Photoshop 文档。',
                error: deliveryConventionResolution.blockers[0] || 'invalid_main_image_delivery_convention',
                toolResults,
                data: {
                    status: 'blocked_invalid_main_image_delivery_convention',
                    blockers: deliveryConventionResolution.blockers
                }
            };
        }
    }
    const explicitSelectedAsset = buildControlledSelectedAsset(input.params, input.context);
    const projectAssetCandidates = buildMainImageProjectAssetCandidates(input.context);
    const assetSelection = selectMainImageAssetCandidate({
        userText,
        projectAssets: projectAssetCandidates,
        selectedAsset: explicitSelectedAsset
    });
    const selectedAsset = enrichMainImageSelectedAsset(
        explicitSelectedAsset || assetSelection.selectedAsset || null,
        projectAssetCandidates
    );
    const projectAssets = [
        ...projectAssetCandidates,
        selectedAsset
    ].filter(Boolean) as MainImageAssetSelectionAsset[];
    const subjectBounds = normalizeSubjectBounds(input.params.subjectBounds)
        || inferSubjectBoundsFromSelectedAsset(selectedAsset);
    const outputDir = resolveMainImageProjectOutputDir(input.params, input.context);
    const effectiveParams = {
        ...input.params,
        outputDir
    };
    const sizePlans = normalizeMainImageSizePlans(effectiveParams, subjectBounds);
    input.emitStep(
        'verification',
        '主图素材与尺寸方案已确认',
        `已确认 ${selectedAsset ? '1 个主素材' : '素材待补'}，并形成 ${sizePlans.length} 组尺寸计划。`,
        selectedAsset && sizePlans.length > 0 ? 'success' : 'error',
        0.08
    );
    const explicitCustomSize = getExplicitMainImageCustomSize(effectiveParams);
    const knowledgeResults = buildDesignMemoryKnowledgeResultsForSkill({
        params: input.params,
        userText,
        scenario: 'main-image',
        context: input.context
    });
    const mainImageMemoryContext = buildMainImageMemoryContextForSkill({
        userText,
        knowledgeResults,
        context: input.context
    });
    const mainImageDesignPlacementIntelligence = buildMainImageDesignPlacementIntelligencePlan({
        params: input.params,
        context: input.context,
        sizePlans: sizePlans,
        executionTool: 'custom-adapter'
    });
    const ecommerceSocksChildStrategyInput = buildEcommerceSocksChildStrategyInput({
        handoff: extractEcommerceSocksChildStrategyHandoffFromContext({
            params: input.params,
            context: input.context
        }),
        skillId: 'main-image-design',
        expectedScenario: 'main-image'
    });
    const parentHandoffStrategyInputs = ecommerceSocksChildStrategyInput.canUseAsChildStrategyInput
        ? ecommerceSocksChildStrategyInput.strategyInputsPatch
        : {};
    const designProjectState = await readDesignProjectStateForMainImage(projectPath, toolResults);
    const mainImageStateContext = buildMainImageStateContext({
        state: designProjectState,
        imageType,
        requestedVersionCount: input.params.compositionVersionCount || input.params.versionCount
    });
    const copyCandidates = mergeMainImageStateCopyCandidates(
        input.params.copyCandidates,
        mainImageStateContext,
        Number(input.params.copyCount || 5)
    );
    const referenceHints = mergeMainImageStateReferenceHints(
        input.params.referenceHints,
        mainImageStateContext
    );
    const whiteBackgroundExportContract = isMainImageWhiteBackgroundFromSkuMaterialRequest({
        userIntent: userText,
        imageType,
        sourceAssetKind: input.params.sourceAssetKind,
        mainImageCapability: input.params.mainImageCapability
    })
        ? buildMainImageWhiteBackgroundExportContract({
            userIntent: userText,
            imageType,
            sourceAssetKind: input.params.sourceAssetKind,
            outputDirPolicy: input.params.outputDirPolicy,
            outputDir,
            projectPath,
            preferredSkuColor: input.params.preferredSkuColor || input.params.skuColor || input.params.colorName,
            mainImageExecutionMode: mode,
            approvedLiveExecution: input.params.approvedLiveExecution,
            approvedLiveAdapterRun: input.params.approvedLiveAdapterRun
        })
        : null;
    const whiteBackgroundLiveToolRequest = whiteBackgroundExportContract
        ? buildMainImageWhiteBackgroundLiveToolRequest(whiteBackgroundExportContract)
        : null;
    const controlledVision = await resolveControlledMainImageVisionSignal({
        params: input.params,
        context: input.context,
        selectedAsset,
        emitStep: input.emitStep,
        toolResults
    });
    const visionSignal = controlledVision.visionSignal;
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
        mainImageMemoryContext,
        designPlacementIntelligencePlan: mainImageDesignPlacementIntelligence,
        outputDir,
        projectPath,
        deliveryConvention: input.params.deliveryConvention,
        deliveryVersion: input.params.deliveryVersion,
        toolNames: MAIN_IMAGE_PRODUCT_PATH_TOOL_NAMES,
        visionSignal,
        mainImagePlatformProfile: explicitCustomSize ? buildExplicitMainImagePlatformProfile(explicitCustomSize) : undefined,
        allowPendingRatioExecution: input.params.allowPendingRatioExecution !== false,
        userCheckpointApproved: input.params.userCheckpointApproved === true
    });
    const effectiveStrategyInputs = {
        ...strategy.strategyInputs,
        ...parentHandoffStrategyInputs
    };
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
        mainImageMemoryContext,
        designPlacementIntelligencePlan: mainImageDesignPlacementIntelligence,
        ecommerceSocksChildStrategyInput,
        outputDir,
        toolNames: MAIN_IMAGE_PRODUCT_PATH_TOOL_NAMES,
        visionSignal,
        strategyInputs: effectiveStrategyInputs
    });
    const photoshopConnection = await resolveControlledPhotoshopConnection(input.params);
    let executionEnvironmentDetail: string;
    let executionEnvironmentStatus: 'success' | 'error';
    if (mode === 'strategy-only') {
        executionEnvironmentDetail = '当前只生成方案，不会写入 Photoshop。';
        executionEnvironmentStatus = 'success';
    } else if (photoshopConnection.documentWriteAvailable) {
        executionEnvironmentDetail = 'Photoshop 写入通道可用，仍需通过受控执行许可。';
        executionEnvironmentStatus = 'success';
    } else {
        executionEnvironmentDetail = 'Photoshop 写入通道当前不可用，执行将在写入前停止。';
        executionEnvironmentStatus = 'error';
    }
    input.emitStep(
        'verification',
        '主图执行环境已确认',
        executionEnvironmentDetail,
        executionEnvironmentStatus,
        0.1
    );
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
    let mainImageStagedDeliveryContext: RuntimeStagedDeliveryContext | undefined;
    let mainImageStagedDispatchContext: RuntimeStagedDeliveryDispatchContext | undefined;
    const executeMainImageTool = async (
        toolName: string,
        toolParams: Record<string, unknown>
    ): Promise<unknown> => {
        if (toolName !== 'exportGroup' && toolName !== 'saveDocument') {
            return executeToolCall(toolName, toolParams, { signal: input.signal });
        }
        const expectedKind = toolName === 'saveDocument' ? 'editable_document' : 'raster_export';
        const targetPath = toolName === 'saveDocument'
            ? cleanString(toolParams.path)
            : cleanString(toolParams.outputPath);
        const artifact = strategy.deliveryPlan.typedPlan?.artifacts.find((candidate) => (
            candidate.kind === expectedKind
            && normalizeSkillDeliveryArtifactPath(candidate.path)
                === normalizeSkillDeliveryArtifactPath(targetPath)
        ));
        if (!artifact || !input.runtimeDeliveryPlanAuthority || !mainImageStagedDispatchContext) {
            return {
                success: false,
                code: !artifact
                    ? 'runtime_delivery_artifact_not_in_skill_plan'
                    : 'runtime_delivery_staging_context_required',
                error: !artifact
                    ? '主图保存或导出目标不在本次文件计划中。'
                    : '主图整组文件暂存还没有准备完成。'
            };
        }
        const stagedPath = mainImageStagedDispatchContext
            .stagedPathsByArtifactId[artifact.artifactId];
        const stagedParams = toolName === 'saveDocument'
            ? {
                ...toolParams,
                path: stagedPath,
                asCopy: true
            }
            : {
                ...toolParams,
                outputPath: stagedPath
            };
        return input.runtimeDeliveryPlanAuthority.executeStagedArtifacts({
            lease: mainImageStagedDispatchContext.lease,
            artifactIds: [artifact.artifactId],
            toolName,
            params: stagedParams
        });
    };
    const adapterBuild = createMainImageLivePhotoshopToolAdapter({
        adapterContract,
        approvedLiveAdapterRun: input.params.approvedLiveAdapterRun === true,
        executionScope,
        executeTool: executeMainImageTool
    });
    const adapterHandoff = buildMainImageLiveAdapterHandoff({
        adapterContract,
        toolchainCheck: buildControlledToolchainCheck(adapterContract, photoshopConnection.source)
    });

    const {
        deliveryPlan: _runtimeDeliveryPlanCandidate,
        productionExecutionPlan: _deliveryExecutionPlan,
        productionExecutorHandoff: _deliveryExecutorHandoff,
        productionExecutorDispatchPlan: _deliveryDispatchPlan,
        productionExecutorDryRunPreview: _deliveryDryRunPreview,
        liveExecutorRequestPackage: _deliveryLiveRequestPackage,
        ...strategyResultProjection
    } = strategy;
    const data: Record<string, unknown> = {
        mainImageExecutionMode: mode,
        mainImageExecutionScope: executionScope,
        mainImageStateContext,
        mainImageCompositionVersions: mainImageStateContext.compositionVersions,
        mainImageAgentDraft: controlledAgentDraft,
        ecommerceSocksChildStrategyInput,
        mainImageDesignPlacementIntelligence,
        mainImageStrategyInputBundle: strategyResultProjection,
        mainImageDesignCorePlan: strategy.designCorePlan,
        mainImageCopyStrategy: strategy.copyStrategy,
        mainImageDesignConceptPlan: strategy.designConceptPlan,
        ...(whiteBackgroundExportContract ? { mainImageWhiteBackgroundExportContract: whiteBackgroundExportContract } : {}),
        ...(whiteBackgroundLiveToolRequest ? { mainImageWhiteBackgroundLiveToolRequest: whiteBackgroundLiveToolRequest } : {}),
        ...(controlledVision.visionPreflight ? { mainImageVisionPreflight: controlledVision.visionPreflight } : {}),
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
        const deliverySummary = strategy.designCorePlan.deliveryDocuments
            .map((doc) => `${doc.folderKey}=${doc.canvasSize.width}x${doc.canvasSize.height}`)
            .join('；');
        const document1200 = strategy.designCorePlan.deliveryDocuments.find((doc) => doc.folderKey === '1200');
        const imageTypeBoundary = document1200?.excludedImageTypes.includes('conversion')
            ? '1200 只出点击图，不出转化图。'
            : '按当前主图交付规则执行。';
        input.emitStep(
            'verification',
            whiteBackgroundExportContract ? '白底图生产路径已生成' : '主图受控产品路径已生成',
            whiteBackgroundExportContract
                ? '已生成白底图生产方案，默认不执行 Photoshop。'
                : '已生成主图生产方案，默认不执行 Photoshop。',
            strategy.status === 'ready_for_strategy_contract' ? 'success' : 'error',
            0.12
        );
        if (!whiteBackgroundExportContract) {
            await appendMainImageVersionRecord({
                projectPath,
                action: 'strategy',
                stateContext: mainImageStateContext,
                reason: '受控产品路径生成主图策略方案',
                results: toolResults
            });
        }
        if (whiteBackgroundExportContract) {
            return {
                success: false,
                nonFatal: true,
                message: [
                    '**白底图方案已准备** 当前只是规划，没有改动 Photoshop，也不算完成。',
                    `画布规格：${whiteBackgroundExportContract.canvasSize.width}x${whiteBackgroundExportContract.canvasSize.height}，主体会尽量保持白底图规范比例。`,
                    '素材来源和导出位置已确认；真实导出需要显式确认。'
                ].join('\n'),
                toolResults,
                data
            };
        }
        return {
            success: false,
            nonFatal: true,
            message: [
                '**主图产品方案已准备** 当前只是规划，没有改动 Photoshop，也不算完成。',
                `交付规格：${deliverySummary}`,
                strategy.deliveryPlan.status === 'ready'
                    ? '结果图和可编辑稿的目录与命名计划已生成。'
                    : '交付目录或命名计划还不完整，实际生产会在写入前停止。',
                imageTypeBoundary,
                '本轮是明确的方案请求，因此没有改动 Photoshop；实际生产请求应由主图能力在写入条件满足后直接制作和保存。'
            ].join('\n'),
            toolResults,
            data
        };
    }

    if (whiteBackgroundExportContract) {
        if (!whiteBackgroundLiveToolRequest?.canExecute) {
            input.emitStep(
                'warning',
                '白底图导出被阻断',
                `request=${whiteBackgroundLiveToolRequest?.status || 'missing'}；${(whiteBackgroundLiveToolRequest?.blockers || []).join('；')}`,
                'error',
                0.12
            );
            return {
                success: false,
                message: [
                    '**白底图暂时不能导出**',
                    (whiteBackgroundLiveToolRequest?.blockers || [])[0] || '当前还缺少项目路径、SKU 源文件或执行授权。',
                    '本轮未改动画面；补齐条件后可以继续导出。'
                ].filter(Boolean).join('\n'),
                error: whiteBackgroundLiveToolRequest?.blockers[0] || whiteBackgroundLiveToolRequest?.status || 'white_background_live_tool_request_blocked',
                toolResults,
                data
            };
        }

        input.emitStep(
            'tool_started',
            '开始导出白底图',
            '从项目 SKU 源文件生成主图目录的白底图。',
            'running',
            0.18
        );
        const toolResult = await executeToolCall(
            whiteBackgroundLiveToolRequest.toolName,
            whiteBackgroundLiveToolRequest.params,
            { signal: input.signal }
        );
        const toolData = isRecord(toolResult?.data) ? toolResult.data : (isRecord(toolResult) ? toolResult : {});
        const readback = isRecord(toolData.readback) ? toolData.readback : {};
        const outputPath = cleanString(toolData.outputPath)
            || cleanString(readback.outputPath)
            || whiteBackgroundLiveToolRequest.params.outputPath;
        const resultFileProbes = await probeMainImageResultFiles([outputPath]);
        const hasOkProbe = resultFileProbes.some((probe) => probe.status === 'ok' && probe.exists !== false);
        const savedByTool = toolData.success === true || readback.saved === true;
        const success = toolResult?.success !== false && (savedByTool || hasOkProbe);

        data.mainImageWhiteBackgroundToolResult = toolResult;
        data.mainImageWhiteBackgroundResultFileProbes = resultFileProbes;
        data.mainImageWhiteBackgroundOutputPath = outputPath;

        input.emitStep(
            success ? 'tool_completed' : 'warning',
            success ? '白底图导出完成' : '白底图导出失败',
            success
                ? `已保存到 ${whiteBackgroundExportContract.exportTarget.relativePath}`
                : '没有确认导出文件，已停止后续处理。',
            success ? 'success' : 'error',
            1
        );

        const rawFailure = cleanString(toolResult?.error);
        const userFailure = /超时|模态|弹窗|timeout/i.test(rawFailure)
            ? 'Photoshop 可能正被弹窗或面板状态阻塞，本轮未继续改动画面。请关闭弹窗或等待面板恢复后再重试。'
            : '没有确认导出文件，本轮未继续改动画面。请确认项目 SKU 源文件和主图目录后再重试。';

        return {
            success,
            message: [
                success ? '**白底图已导出**' : '**白底图没有导出成功**',
                success
                    ? '已保存到项目主图交付位置，并完成文件读回。'
                    : userFailure,
                '这一步只处理白底图素材，整套主图排版和设计仍需要单独完成。'
            ].join('\n'),
            error: success ? undefined : userFailure,
            toolResults: [...toolResults, {
                toolName: whiteBackgroundLiveToolRequest.toolName,
                result: toolResult
            }],
            data
        };
    }

    if (!adapterBuild.adapter) {
        input.emitStep(
            'warning',
            '主图受控产品路径被阻断',
            '当前还缺少可直接写入 Photoshop 的项目条件，已停止在写入前。',
            'error',
            0.12
        );
        return {
            success: false,
            message: [
                '**主图暂时不能执行** 当前还缺少可以直接写入 Photoshop 的项目条件。',
                '本轮没有改动画面；补齐项目素材、文档或执行授权后可以继续。'
            ].filter(Boolean).join('\n'),
            error: adapterBuild.blockers[0] || checkpoint.blockers[0] || 'main_image_controlled_product_path_blocked',
            toolResults,
            data
        };
    }

    const exactDeliveryPlan = strategy.deliveryPlan;
    if (exactDeliveryPlan.status !== 'ready'
        || !exactDeliveryPlan.typedPlan
        || !exactDeliveryPlan.deliveryPlanDigest
        || exactDeliveryPlan.artifacts.length === 0) {
        return {
            success: false,
            message: '主图的输出目录和文件名还不能唯一确认，本轮没有写入 Photoshop。',
            error: exactDeliveryPlan.blockers[0] || 'main_image_delivery_plan_not_ready',
            toolResults,
            data: {
                ...data,
                status: 'blocked_main_image_delivery_plan'
            }
        };
    }
    const runtimeDeliveryPlanAuthority = input.runtimeDeliveryPlanAuthority;
    const deliveryPlanFreeze = runtimeDeliveryPlanAuthority?.freeze({
        projectPath,
        convention: exactDeliveryPlan.typedPlan.convention,
        artifacts: exactDeliveryPlan.typedPlan.artifacts
    });
    if (!runtimeDeliveryPlanAuthority
        || !deliveryPlanFreeze
        || (deliveryPlanFreeze.status !== 'frozen' && deliveryPlanFreeze.status !== 'retained')) {
        return {
            success: false,
            message: '主图的输出目录和文件名在开始前没有完成唯一确认，本轮没有写入 Photoshop。',
            error: 'main_image_delivery_plan_freeze_blocked',
            toolResults,
            data: {
                ...data,
                status: 'blocked_main_image_delivery_plan_freeze'
            }
        };
    }
    const stagedDeliveryPreparation = await prepareRuntimeStagedDelivery({
        projectRoot: projectPath,
        runtimeDeliveryPlanBinding: deliveryPlanFreeze.binding
    });
    if (stagedDeliveryPreparation.status !== 'ready') {
        return {
            success: false,
            message: '主图文件的临时交付位置没有准备完成，本轮没有写入 Photoshop，也没有覆盖项目文件。',
            error: stagedDeliveryPreparation.blockers[0]
                || 'main_image_staged_delivery_preparation_blocked',
            toolResults,
            data: {
                ...data,
                status: 'blocked_main_image_staged_delivery_preparation',
                blockers: stagedDeliveryPreparation.blockers,
                ...(stagedDeliveryPreparation.recoveryPath
                    ? { recoveryPath: stagedDeliveryPreparation.recoveryPath }
                    : {})
            }
        };
    }
    mainImageStagedDeliveryContext = stagedDeliveryPreparation.context;
    mainImageStagedDispatchContext = readRuntimeStagedDeliveryDispatchContext(
        mainImageStagedDeliveryContext
    );
    if (!mainImageStagedDispatchContext) {
        await finalizeRuntimeStagedDelivery({
            context: mainImageStagedDeliveryContext,
            preserveStagingRoot: false
        });
        return {
            success: false,
            message: '主图临时文件映射无法读取，本轮没有写入 Photoshop。',
            error: 'main_image_staging_mapping_unavailable',
            toolResults,
            data: {
                ...data,
                status: 'blocked_main_image_staging_mapping'
            }
        };
    }

    input.emitStep(
        'tool_started',
        '开始执行主图 Photoshop 生产',
        '按已授权的一次性文档计划串行执行，并在每个工具调用中保留停止信号。',
        'running',
        0.2
    );
    const runner = await runMainImageLiveExecutor({
        checkpoint,
        adapter: adapterBuild.adapter
    });
    const publicRunnerSummary = buildPublicMainImageRunnerSummary(runner);
    const publicRunnerOperationResults = buildPublicMainImageOperationResults(runner);
    const actualControlledResultPaths = extractMainImageControlledProductResultPaths(runner);
    const stagedDeliveryReadiness = await inspectMainImageStagedDeliveryBeforePromotion({
        plan: exactDeliveryPlan,
        runner,
        actualRasterPaths: actualControlledResultPaths,
        stagedPathsByArtifactId: mainImageStagedDispatchContext.stagedPathsByArtifactId
    });
    if (!stagedDeliveryReadiness.ready) {
        const cleanup = await finalizeRuntimeStagedDelivery({
            context: mainImageStagedDeliveryContext,
            preserveStagingRoot: false
        });
        return {
            success: false,
            message: cleanup.success
                ? '主图没有完整生成，临时文件已清理，项目交付目录没有留下半成品。'
                : '主图没有完整生成，临时文件清理也没有完成；已保留恢复位置，项目交付目录没有被当作成功结果。',
            error: stagedDeliveryReadiness.issues[0] || cleanup.error
                || 'main_image_staged_delivery_incomplete',
            toolResults: [...toolResults, ...publicRunnerOperationResults],
            data: {
                ...data,
                status: 'failed_main_image_staged_delivery',
                mainImageControlledProductRunner: publicRunnerSummary,
                blockers: [...runner.blockers, ...stagedDeliveryReadiness.issues],
                ...(cleanup.recoveryPath ? { recoveryPath: cleanup.recoveryPath } : {})
            }
        };
    }
    const promotedDelivery = await promoteRuntimeStagedDelivery({
        context: mainImageStagedDeliveryContext,
        runtimeDeliveryPlanBinding: deliveryPlanFreeze.binding,
        label: '主图整组交付'
    });
    if (!promotedDelivery.success
        || !promotedDelivery.runtimeDeliveryCommitReceipt
        || !promotedDelivery.committedFiles) {
        const cleanup = await finalizeRuntimeStagedDelivery({
            context: mainImageStagedDeliveryContext,
            preserveStagingRoot: promotedDelivery.preserveStagingRoot === true,
            recoveryPath: promotedDelivery.recoveryPath
        });
        return {
            success: false,
            message: promotedDelivery.preserveStagingRoot === true
                ? '主图文件提交时状态无法完全确认，已保留恢复位置，没有把本轮当作成功交付。'
                : '主图整组文件没有提交成功，已撤回本轮文件变化，没有留下正式半成品。',
            error: promotedDelivery.error || cleanup.error || 'main_image_delivery_promotion_failed',
            toolResults: [...toolResults, ...publicRunnerOperationResults],
            data: {
                ...data,
                status: 'failed_main_image_delivery_promotion',
                mainImageControlledProductRunner: publicRunnerSummary,
                blockers: [promotedDelivery.error].filter(Boolean),
                ...(promotedDelivery.recoveryPath
                    ? { recoveryPath: promotedDelivery.recoveryPath }
                    : {})
            }
        };
    }
    const externalCommitDecision = runtimeDeliveryPlanAuthority.acceptExternalCommit({
        artifactIds: exactDeliveryPlan.typedPlan.artifacts.map((artifact) => artifact.artifactId),
        receipt: promotedDelivery.runtimeDeliveryCommitReceipt
    });
    if (externalCommitDecision.status !== 'accepted') {
        await finalizeRuntimeStagedDelivery({
            context: mainImageStagedDeliveryContext,
            preserveStagingRoot: false,
            recoveryPath: promotedDelivery.recoveryPath
        });
        return {
            success: false,
            message: '主图文件已经写入，但与本次完整交付清单的绑定没有闭合；已保留恢复信息，不能声明交付完成。',
            error: externalCommitDecision.blockers[0] || 'main_image_external_commit_rejected',
            toolResults: [...toolResults, ...publicRunnerOperationResults],
            data: {
                ...data,
                status: 'failed_main_image_external_commit_binding',
                mainImageControlledProductRunner: publicRunnerSummary,
                blockers: externalCommitDecision.blockers
            }
        };
    }
    const stagingCleanup = await finalizeRuntimeStagedDelivery({
        context: mainImageStagedDeliveryContext,
        preserveStagingRoot: false
    });
    const deliveryEvidence = await buildMainImageDeliveryRuntimeEvidence({
        plan: exactDeliveryPlan,
        runner,
        actualRasterPaths: actualControlledResultPaths,
        stagedPathsByArtifactId: mainImageStagedDispatchContext.stagedPathsByArtifactId,
        stagedFileProbes: stagedDeliveryReadiness.allFileProbes,
        committedFiles: promotedDelivery.committedFiles,
        externalCommitAccepted: true
    });
    const controlledResultPaths = deliveryEvidence.rasterPaths;
    const controlledResultFileProbes = deliveryEvidence.rasterFileProbes;
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
        resultImagePaths: controlledResultPaths,
        resultFileProbes: controlledResultFileProbes,
        referenceImagePath: controlledReferenceImagePath,
        pixelProbe: controlledPixelProbe,
        manualReview: controlledManualReview
    });
    const controlledProductQaBundle = buildMainImageControlledProductQaBundle({
        runner,
        sizePlans,
        resultImagePaths: controlledResultPaths,
        resultFileProbes: controlledResultFileProbes,
        referenceImagePath: controlledReferenceImagePath,
        pixelProbe: controlledPixelProbe,
        manualReview: controlledManualReview
    });
    const mainImageQaReport = buildMainImageQaReport({
        agentDraft: controlledAgentDraft,
        screenshotQa: controlledProductQaBundle.screenshotQa,
        screenshotProbeReadiness: controlledProductQaBundle.screenshotProbeReadiness
    });
    const mainImageAcceptanceRecord = buildMainImageAcceptanceRecord({
        caseId: cleanString(input.params.acceptanceCaseId) || 'controlled-product-disposable-live',
        source: 'product-disposable-live',
        qaReport: mainImageQaReport,
        controlledProductQaBridge: controlledProductQaBundle.bridge,
        resultFileProbes: controlledResultFileProbes,
        resultImagePaths: controlledResultPaths,
        referenceImagePath: controlledReferenceImagePath,
        manualReview: controlledManualReview
    });
    data.mainImageControlledProductRunner = publicRunnerSummary;
    data.mainImageControlledProductQaGate = controlledProductQaGate;
    data.mainImageScreenshotQa = controlledProductQaBundle.screenshotQa;
    data.mainImageScreenshotProbeReadiness = controlledProductQaBundle.screenshotProbeReadiness;
    data.mainImageControlledProductQaBridge = controlledProductQaBundle.bridge;
    data.mainImageQaReport = mainImageQaReport;
    data.mainImageAcceptanceRecord = mainImageAcceptanceRecord;
    const okResultFileCount = controlledResultFileProbes
        .filter((probe) => probe.status === 'ok' && probe.exists === true && probe.isFile === true)
        .length;
    const reviewableResultCount = okResultFileCount;
    const hasReviewableMainImageOutput = reviewableResultCount > 0;
    const runtimeDeliveryReceipt = deliveryEvidence.receipt;
    data.runtimeDeliveryReceipt = runtimeDeliveryReceipt;
    const deliveryComplete = runtimeDeliveryReceipt.status === 'ready';
    if (deliveryComplete) {
        await appendMainImageVersionRecord({
            projectPath,
            action: 'execute',
            stateContext: mainImageStateContext,
            reason: `受控主图整组交付完成，结果图片 ${controlledProductQaGate.resultImageSummary.resultImageCount} 个`,
            results: toolResults
        });
    }
    data.mainImageDeliveryTransaction = {
        status: deliveryComplete ? 'committed' : 'verification_incomplete',
        committedFileCount: promotedDelivery.committedFiles.length,
        exactArtifactSet: true,
        stagingCleanupComplete: stagingCleanup.success === true
    };
    data.status = deliveryComplete ? 'needs_review' : 'failed';
    data.outputCount = reviewableResultCount;
    data.exportCount = reviewableResultCount;
    data.canClaimOutputQuality = false;
    data.blockers = deliveryComplete ? [] : [
        ...runner.blockers,
        ...runtimeDeliveryReceipt.issues
    ];
    data.warnings = [
        ...runner.warnings,
        ...(promotedDelivery.warnings || []),
        ...(!stagingCleanup.success && stagingCleanup.error
            ? [stagingCleanup.error]
            : []),
        ...(
            hasReviewableMainImageOutput && !deliveryComplete
                ? [`已读回 ${reviewableResultCount} 张结果图，但可编辑稿、冻结路径或完整文件收据尚未闭合。`]
                : []
        )
    ];
    input.emitStep(
        deliveryComplete ? 'verification' : 'warning',
        '主图执行与验收结果已汇总',
        deliveryComplete
            ? `已验证 ${reviewableResultCount} 张结果图和对应可编辑稿，视觉质量仍需看真实画面确认。`
            : '主图交付文件没有全部通过路径、文件和 Photoshop 版本对账，已按未完成处理。',
        deliveryComplete ? 'success' : 'error',
        1
    );
    const userVisibleResultFile = selectMainImageUserVisibleResultFile(controlledResultFileProbes);
    let userVisibleHeading = '**主图执行未完成** 本轮已停止。';
    let userVisibleSummary = '本轮没有得到可验收的主图文件。';
    if (deliveryComplete) {
        userVisibleHeading = '**主图文件已生成**';
        userVisibleSummary = '结果图和可编辑源稿已按本次约定放入项目目录，下面的结果图可以先验收。';
    } else if (hasReviewableMainImageOutput) {
        userVisibleHeading = '**主图文件已整组写入，但交付验证还没有闭合**';
        userVisibleSummary = '全部文件已按同一组提交，但其中一项版本或文件身份复核没有通过，不能声明交付完成。';
    }
    return {
        success: deliveryComplete,
        message: [
            userVisibleHeading,
            userVisibleSummary,
            formatMainImageUserVisibleResultFile(userVisibleResultFile),
            '我已经做过文件检查；视觉好坏仍以你看到的实际图片为准。'
        ].filter(Boolean).join('\n'),
        error: deliveryComplete
            ? undefined
            : '主图结果图和可编辑源稿没有全部生成并通过文件检查。',
        toolResults: [...toolResults, ...publicRunnerOperationResults],
        data
    };
}

// ==================== 主图设计执行器 ====================

export const mainImageExecutor: SkillExecutor = {
    skillId: 'main-image-design',

    async execute({
        params,
        callbacks,
        context,
        signal,
        runtimeDeliveryPlanAuthority
    }: SkillExecuteParams): Promise<AgentResult> {
        const emitStep: EmitMainImageStep = (
            kind,
            title,
            detail,
            status = 'running',
            percent
        ) => emitSkillStep(callbacks, { kind, title, detail, status, percent });

        return runControlledMainImageProductPath({
            params: params as Record<string, any>,
            context,
            callbacks,
            signal,
            runtimeDeliveryPlanAuthority,
            emitStep
        });
    },
};
