import type { MainImageSizePlanEvidence } from './design-agent-os-contracts';
import {
    buildMainImageAssetHeroStrategyEvidence,
    type MainImageAssetHeroStrategyEvidence
} from './main-image-asset-hero-strategy';
import {
    buildMainImageProjectStyleStrategyEvidence,
    type MainImageReferenceHint,
    type MainImageProjectStyleStrategyEvidence
} from './main-image-project-style-strategy';
import {
    buildMainImageDesignCoreEvidence,
    type MainImageDesignCoreEvidence
} from './main-image-design-core';
import {
    buildMainImageCopyEvidence,
    type MainImageCopyEvidence
} from './main-image-copy-evidence';
import {
    buildMainImageDesignConceptPlan,
    type MainImageDesignConceptPlan
} from './main-image-design-concept-plan';
import {
    buildMainImageDesignStandardsEvidence,
    type MainImageDesignStandardsEvidence
} from './main-image-design-standards-evidence';
import {
    buildMainImagePlatformSizeProfileEvidence,
    buildMainImageProductionDocumentStructureEvidence,
    type MainImagePlatformSizeProfileEvidence,
    type MainImageProductionDocumentStructureEvidence
} from './main-image-production-document-structure';
import {
    buildMainImageProductionExecutionPlanEvidence,
    type MainImageProductionExecutionPlanEvidence
} from './main-image-production-execution-plan';
import {
    buildMainImageProductionExecutorHandoffEvidence,
    type MainImageProductionExecutorHandoffEvidence
} from './main-image-production-executor-handoff';
import {
    buildMainImageProductionExecutorBridgeEvidence,
    type MainImageProductionExecutorBridgeEvidence
} from './main-image-production-executor-bridge';
import {
    buildMainImageProductionExecutorDryRunEvidence,
    type MainImageProductionExecutorDryRunEvidence
} from './main-image-production-executor-dry-run';
import {
    buildMainImageDesignReadinessReport,
    type MainImageDesignReadinessReport
} from './main-image-design-readiness-report';
import {
    buildMainImageLiveExecutorRequestPackage,
    type MainImageLiveExecutorRequestPackage
} from './main-image-live-executor-request';
import {
    buildMainImageVariantPlacementStrategyEvidence,
    type MainImageVariantPlacementStrategyEvidence
} from './main-image-variant-placement-strategy';
import type {
    MainImageDraftAsset,
    MainImageDraftDocument,
    MainImageDraftSubjectBounds
} from './main-image-agent-draft-plan';
import type { MainImageStrategyInputKey } from './main-image-strategy-contract';
import type { MainImageVisionSignal } from './main-image-visual-loop';
import type { DesignKnowledgeResult } from './design-knowledge-search';
import type { DesignPlacementIntelligencePlan } from './design-placement-intelligence';
import {
    buildMainImageMemoryEvidence,
    type MainImageMemoryEvidence
} from './main-image-memory-evidence';

export type MainImageStrategyInputBuilderStatus =
    | 'blocked_missing_strategy_evidence'
    | 'ready_for_strategy_contract';

export interface MainImageStrategyInputBuilderInput {
    userText?: string;
    imageType?: string;
    currentDocument?: MainImageDraftDocument | null;
    projectAssets?: MainImageDraftAsset[];
    selectedAsset?: MainImageDraftAsset | null;
    subjectBounds?: MainImageDraftSubjectBounds | null;
    sizePlans?: MainImageSizePlanEvidence[];
    copyCandidates?: string[];
    outputDir?: string;
    toolNames?: string[];
    visionSignal?: MainImageVisionSignal | null;
    referenceHints?: MainImageReferenceHint[];
    knowledgeResults?: DesignKnowledgeResult[];
    mainImageMemoryEvidence?: MainImageMemoryEvidence | null;
    designPlacementIntelligenceEvidence?: DesignPlacementIntelligencePlan | null;
    mainImagePlatformProfile?: MainImagePlatformSizeProfileEvidence | null;
    allowPendingRatioExecution?: boolean;
    userCheckpointApproved?: boolean;
}

export interface MainImageStrategyInputEvidence {
    version: 'main-image-strategy-input-builder/v0';
    skillId: 'main-image-design';
    scene: 'ecommerce-socks';
    status: MainImageStrategyInputBuilderStatus;
    strategyInputs: Partial<Record<MainImageStrategyInputKey, unknown>>;
    providedInputs: MainImageStrategyInputKey[];
    missingInputs: MainImageStrategyInputKey[];
    canClaimOutputQuality: false;
    canClaimDesignComplete: false;
    noPhotoshopWrites: true;
    mustNotExecutePhotoshop: true;
    assetHeroStrategyEvidence: MainImageAssetHeroStrategyEvidence;
    projectStyleStrategyEvidence: MainImageProjectStyleStrategyEvidence;
    designCoreEvidence: MainImageDesignCoreEvidence;
    copyEvidence: MainImageCopyEvidence;
    designConceptPlan: MainImageDesignConceptPlan;
    mainImageMemoryEvidence: MainImageMemoryEvidence;
    designPlacementIntelligenceEvidence: DesignPlacementIntelligencePlan | null;
    designStandardsEvidence: MainImageDesignStandardsEvidence;
    variantPlacementStrategyEvidence: MainImageVariantPlacementStrategyEvidence;
    productionDocumentStructureEvidence: MainImageProductionDocumentStructureEvidence;
    productionExecutionPlanEvidence: MainImageProductionExecutionPlanEvidence;
    productionExecutorHandoffEvidence: MainImageProductionExecutorHandoffEvidence;
    productionExecutorBridgeEvidence: MainImageProductionExecutorBridgeEvidence;
    productionExecutorDryRunEvidence: MainImageProductionExecutorDryRunEvidence;
    designReadinessReport: MainImageDesignReadinessReport;
    liveExecutorRequestPackage: MainImageLiveExecutorRequestPackage;
    blockers: string[];
    warnings: string[];
    limitations: string[];
    evidence: Array<{
        source: string;
        summary: string;
        status: 'ready' | 'needs_review' | 'unknown' | 'failed';
    }>;
}

interface NormalizedSubjectBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

interface NormalizedSizePlan {
    sizeKey: string;
    targetSize: { width: number; height: number };
    scale: number;
    targetX: number;
    targetY: number;
    smartLayoutPlanned: boolean;
    quickExportPlanned: boolean;
    decisionReason: string;
}

const REQUIRED_INPUTS: MainImageStrategyInputKey[] = [
    'heroSubjectPolicy',
    'assetSelectionPolicy',
    'imagePlacementPolicy',
    'smartScalingPolicy',
    'copyRolePolicy',
    'exportAcceptancePolicy',
    'performanceBudget'
];

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
    return values.map(cleanString).filter(Boolean);
}

function normalizeReferenceHint(input: MainImageReferenceHint | undefined): MainImageReferenceHint | undefined {
    if (!input) return undefined;
    const title = cleanString(input.title);
    const source = cleanString(input.source);
    const url = cleanString(input.url);
    const note = cleanString(input.note);
    if (!title && !source && !url && !note) return undefined;
    return {
        title: title || undefined,
        source: source || undefined,
        url: url || undefined,
        note: note || undefined
    };
}

function canUseKnowledgeAsReference(result: DesignKnowledgeResult): boolean {
    const allowedUses = Array.isArray(result.allowedUses) ? result.allowedUses : [];
    return result.sourceType !== 'local_case'
        && (allowedUses.includes('prompt_context') || allowedUses.includes('user_reference'));
}

function mapKnowledgeResultToReferenceHint(result: DesignKnowledgeResult): MainImageReferenceHint | undefined {
    if (!result || !canUseKnowledgeAsReference(result)) return undefined;
    const title = cleanString(result.title);
    const sourceType = cleanString(result.sourceType);
    const evidenceLevel = cleanString(result.evidenceLevel);
    const sourceUrl = cleanString(result.sourceUrl);
    const summary = cleanString(result.summary);
    const evidence = cleanStrings(result.evidence).slice(0, 2).join(' / ');
    return normalizeReferenceHint({
        title: title || result.id,
        source: [sourceType, evidenceLevel].filter(Boolean).join(':'),
        url: sourceUrl || undefined,
        note: [summary, evidence].filter(Boolean).join('；')
    });
}

function buildReferenceHints(input: MainImageStrategyInputBuilderInput): MainImageReferenceHint[] {
    const hints = [
        ...(Array.isArray(input.referenceHints) ? input.referenceHints : []).map(normalizeReferenceHint),
        ...(Array.isArray(input.knowledgeResults) ? input.knowledgeResults : []).map(mapKnowledgeResultToReferenceHint)
    ].filter((hint): hint is MainImageReferenceHint => Boolean(hint));
    const seen = new Set<string>();
    const deduped: MainImageReferenceHint[] = [];
    for (const hint of hints) {
        const key = [
            cleanString(hint.url),
            cleanString(hint.title),
            cleanString(hint.source)
        ].filter(Boolean).join('|');
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        deduped.push(hint);
        if (deduped.length >= 8) break;
    }
    return deduped;
}

function toPositiveNumber(value: unknown): number | undefined {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function normalizeSubjectBounds(
    bounds: MainImageDraftSubjectBounds | null | undefined
): NormalizedSubjectBounds | undefined {
    if (!bounds) return undefined;
    const left = Number(bounds.left ?? 0);
    const top = Number(bounds.top ?? 0);
    const right = Number(bounds.right ?? (left + Number(bounds.width || 0)));
    const bottom = Number(bounds.bottom ?? (top + Number(bounds.height || 0)));
    const width = Number(bounds.width ?? (right - left));
    const height = Number(bounds.height ?? (bottom - top));
    if (![left, top, right, bottom, width, height].every(Number.isFinite)) return undefined;
    if (width <= 0 || height <= 0) return undefined;
    return {
        left: Math.round(left),
        top: Math.round(top),
        right: Math.round(right),
        bottom: Math.round(bottom),
        width: Math.round(width),
        height: Math.round(height)
    };
}

function normalizeSizePlans(sizePlans: MainImageSizePlanEvidence[] | undefined): NormalizedSizePlan[] {
    return (sizePlans || [])
        .map((plan) => {
            const width = toPositiveNumber(plan.targetSize?.width);
            const height = toPositiveNumber(plan.targetSize?.height);
            const scale = toPositiveNumber(plan.scale);
            if (!width || !height || !scale) return null;
            return {
                sizeKey: cleanString(plan.sizeKey) || `${Math.round(width)}x${Math.round(height)}`,
                targetSize: {
                    width: Math.round(width),
                    height: Math.round(height)
                },
                scale,
                targetX: Math.round(Number(plan.targetX || 0)),
                targetY: Math.round(Number(plan.targetY || 0)),
                smartLayoutPlanned: plan.smartLayoutPlanned === true,
                quickExportPlanned: plan.quickExportPlanned === true,
                decisionReason: cleanString(plan.decisionReason) || 'size plan evidence'
            };
        })
        .filter((plan): plan is NormalizedSizePlan => Boolean(plan));
}

function buildPlacementPolicy(
    subjectBounds: NormalizedSubjectBounds | undefined,
    sizePlans: NormalizedSizePlan[],
    imageType: string,
    variantPlacementStrategyEvidence: MainImageVariantPlacementStrategyEvidence,
    designConceptPlan: MainImageDesignConceptPlan,
    designPlacementIntelligenceEvidence: DesignPlacementIntelligencePlan | null
): Record<string, unknown> | undefined {
    if (!subjectBounds || sizePlans.length === 0) return undefined;
    return {
        imageType: imageType || 'unknown',
        subjectBounds,
        targetSizes: sizePlans.map((plan) => plan.targetSize),
        placementMode: 'derive-from-subject-bounds-and-size-plan',
        variantPlacementStrategyStatus: variantPlacementStrategyEvidence.status,
        variantPlacementPlanCount: variantPlacementStrategyEvidence.variantPlacementPlans.length,
        designConceptStatus: designConceptPlan.status,
        designConceptVariantCount: designConceptPlan.variantConcepts.length,
        ...(designPlacementIntelligenceEvidence ? {
            designPlacementIntelligence: {
                status: designPlacementIntelligenceEvidence.status,
                candidateCount: designPlacementIntelligenceEvidence.summary.candidateCount,
                selectedCandidateId: designPlacementIntelligenceEvidence.selectedCandidateId || null,
                reviewRequirements: designPlacementIntelligenceEvidence.reviewRequirements.map((item) => item.type),
                boundary: 'DPI evidence ranks placement candidates only; it does not execute Photoshop or claim design quality.'
            }
        } : {}),
        safeAreaRequired: true,
        boundary: 'placement policy is a plan input, not a Photoshop transform result'
    };
}

function buildSmartScalingPolicy(
    subjectBounds: NormalizedSubjectBounds | undefined,
    sizePlans: NormalizedSizePlan[],
    variantPlacementStrategyEvidence: MainImageVariantPlacementStrategyEvidence
): Record<string, unknown> | undefined {
    if (!subjectBounds || sizePlans.length === 0) return undefined;
    return {
        subjectBounds,
        plans: sizePlans.map((plan) => ({
            sizeKey: plan.sizeKey,
            targetSize: plan.targetSize,
            scale: plan.scale,
            targetX: plan.targetX,
            targetY: plan.targetY,
            smartLayoutPlanned: plan.smartLayoutPlanned,
            decisionReason: plan.decisionReason
        })),
        variantPlacementStrategyStatus: variantPlacementStrategyEvidence.status,
        variantPlacementPlanCount: variantPlacementStrategyEvidence.variantPlacementPlans.length,
        variantPlacementVerificationPolicy: variantPlacementStrategyEvidence.verificationPolicy,
        cropRiskPolicy: 'must verify post-transform bounds and screenshot before claiming quality',
        boundary: 'smart scaling policy does not execute transformLayer'
    };
}

function buildCopyRolePolicy(input: {
    copyCandidates: string[];
    userText: string;
    projectStyleStrategyEvidence: MainImageProjectStyleStrategyEvidence;
    designCoreEvidence: MainImageDesignCoreEvidence;
    copyEvidence: MainImageCopyEvidence;
    designConceptPlan: MainImageDesignConceptPlan;
    mainImageMemoryEvidence: MainImageMemoryEvidence;
    designStandardsEvidence: MainImageDesignStandardsEvidence;
}): Record<string, unknown> | undefined {
    const styleEvidence = {
        projectStyleStrategyStatus: input.projectStyleStrategyEvidence.status,
        designCoreStatus: input.designCoreEvidence.status,
        deliveryDocuments: input.designCoreEvidence.deliveryDocuments.map((document) => ({
            folderKey: document.folderKey,
            ratio: document.ratio,
            sourceDocumentPath: document.sourceDocumentPath,
            exportFolder: document.exportFolder,
            includedImageTypes: document.includedImageTypes.slice(),
            excludedImageTypes: document.excludedImageTypes.slice()
        })),
        designStandardsStatus: input.designStandardsEvidence.status,
        designStandardsCanGuideDesignPlan: input.designStandardsEvidence.canGuideDesignPlan,
        productType: input.projectStyleStrategyEvidence.projectStyleUnderstanding.productType,
        styleKeywords: input.projectStyleStrategyEvidence.designDirection.styleKeywords,
        plannedClickImageCount: input.projectStyleStrategyEvidence.variantPlan.clickImages.length,
        plannedConversionImageCount: input.projectStyleStrategyEvidence.variantPlan.conversionImages.length
    };
    const copyEvidencePatch = input.copyEvidence.strategyInputPatch.copyRolePolicy || {};
    const conceptPatch = {
        designConceptStatus: input.designConceptPlan.status,
        designConceptVariantCount: input.designConceptPlan.variantConcepts.length,
        designConceptBackgroundDirection: input.designConceptPlan.backgroundDirection
    };
    const memoryPatch = input.mainImageMemoryEvidence.strategyInputPatch.copyRolePolicy || {};
    if (input.copyCandidates.length > 0) {
        return {
            mode: 'fit-provided-copy-candidates',
            candidateCount: input.copyCandidates.length,
            candidates: input.copyCandidates.slice(0, 5),
            ...copyEvidencePatch,
            ...conceptPatch,
            ...memoryPatch,
            ...styleEvidence,
            boundary: 'copy candidates must be fitted to editable text slots'
        };
    }
    if (!input.userText) return undefined;
    return {
        mode: 'reserve-editable-copy-slots-without-inventing-selling-points',
        candidateCount: 0,
        ...copyEvidencePatch,
        ...conceptPatch,
        ...memoryPatch,
        ...styleEvidence,
        boundary: 'missing product facts; do not fabricate copy semantics'
    };
}

function buildExportAcceptancePolicy(
    sizePlans: NormalizedSizePlan[],
    outputDir: string,
    designCoreEvidence: MainImageDesignCoreEvidence,
    productionDocumentStructureEvidence: MainImageProductionDocumentStructureEvidence,
    productionExecutionPlanEvidence: MainImageProductionExecutionPlanEvidence,
    productionExecutorHandoffEvidence: MainImageProductionExecutorHandoffEvidence,
    productionExecutorBridgeEvidence: MainImageProductionExecutorBridgeEvidence,
    productionExecutorDryRunEvidence: MainImageProductionExecutorDryRunEvidence,
    designConceptPlan: MainImageDesignConceptPlan
): Record<string, unknown> | undefined {
    if (sizePlans.length === 0) return undefined;
    return {
        outputDir: outputDir || undefined,
        exportPlanned: Boolean(outputDir) || sizePlans.some((plan) => plan.quickExportPlanned),
        designCoreStatus: designCoreEvidence.status,
        expectedSourceDocuments: Array.from(new Set([
            ...designCoreEvidence.deliveryDocuments.map((document) => document.sourceDocumentPath),
            designCoreEvidence.whiteBackgroundSpec.sourceDocumentPath
        ])),
        expectedExportFolders: designCoreEvidence.deliveryDocuments.map((document) => document.exportFolder),
        whiteBackgroundOutputPath: designCoreEvidence.whiteBackgroundSpec.outputPath,
        noConversionExportFolderKeys: designCoreEvidence.deliveryDocuments
            .filter((document) => document.excludedImageTypes.includes('conversion'))
            .map((document) => document.folderKey),
        productionDocumentStatus: productionDocumentStructureEvidence.status,
        productionDocumentCount: productionDocumentStructureEvidence.documents.length,
        exportSpecCount: productionDocumentStructureEvidence.exportSpecs.length,
        productionExecutionPlanStatus: productionExecutionPlanEvidence.status,
        plannedOperationCount: productionExecutionPlanEvidence.plannedOperationCount,
        productionExecutorHandoffStatus: productionExecutorHandoffEvidence.status,
        executorHandoffRequestCount: productionExecutorHandoffEvidence.toolRequests.length,
        executorHandoffMissingTools: productionExecutorHandoffEvidence.missingToolNames,
        productionExecutorBridgeStatus: productionExecutorBridgeEvidence.status,
        executorBridgeQueueCount: productionExecutorBridgeEvidence.executorQueue.length,
        executorBridgeMissingTools: productionExecutorBridgeEvidence.missingToolNames,
        productionExecutorDryRunStatus: productionExecutorDryRunEvidence.status,
        executorDryRunOperationCount: productionExecutorDryRunEvidence.operationCount,
        designConceptStatus: designConceptPlan.status,
        designConceptVariantCount: designConceptPlan.variantConcepts.length,
        pendingConfirmationCount: productionExecutionPlanEvidence.pendingConfirmations.length,
        canExecuteWithoutReview: productionExecutionPlanEvidence.canExecuteWithoutReview,
        pendingRatioWarnings: productionDocumentStructureEvidence.warnings.filter((warning) => warning.includes('第三比例')),
        acceptedWhen: [
            'export path exists if export is requested',
            'planned production documents and child groups exist after Photoshop execution',
            'planned operation sequence has been read back through Photoshop execution evidence',
            'post-export screenshot or pixel probe is available',
            'manual or QA report does not reject the result'
        ],
        boundary: 'export acceptance policy is not an exported file'
    };
}

function buildPerformanceBudget(
    sizePlans: NormalizedSizePlan[],
    projectAssetCount: number,
    toolNames: string[],
    memoryEvidence: MainImageMemoryEvidence
): Record<string, unknown> {
    return {
        maxStrategyInputAssets: Math.max(1, Math.min(8, projectAssetCount || 1)),
        plannedSizeCount: sizePlans.length,
        toolEvidenceCount: toolNames.length,
        memoryEvidenceCount: memoryEvidence.preferenceSummary.sourceResultCount,
        allowProviderCalls: false,
        allowPhotoshopExecution: false,
        boundary: 'strategy input builder must stay local and read-only'
    };
}

function collectProvidedInputs(
    strategyInputs: Partial<Record<MainImageStrategyInputKey, unknown>>
): MainImageStrategyInputKey[] {
    return REQUIRED_INPUTS.filter((key) => strategyInputs[key] !== undefined && strategyInputs[key] !== null);
}

function mapDesignPlacementEvidenceStatus(
    evidence: DesignPlacementIntelligencePlan | null
): 'ready' | 'needs_review' | 'unknown' | 'failed' {
    if (!evidence) return 'unknown';
    if (evidence.status === 'blocked') return 'failed';
    return 'needs_review';
}

function buildWarnings(input: {
    hasAsset: boolean;
    subjectBounds?: NormalizedSubjectBounds;
    sizePlans: NormalizedSizePlan[];
    copyCandidates: string[];
    outputDir: string;
    visionSignal?: MainImageVisionSignal | null;
}): string[] {
    const warnings: string[] = [];
    if (!input.hasAsset) {
        warnings.push('缺少素材、项目图片或当前文档上下文，不能生成素材策略。');
    }
    if (!input.subjectBounds) {
        warnings.push('缺少主体 bounds，不能生成主视觉、落位和智能缩放策略。');
    }
    if (input.sizePlans.length === 0) {
        warnings.push('缺少尺寸计划，不能生成落位、缩放和导出验收策略。');
    }
    if (input.copyCandidates.length === 0) {
        warnings.push('缺少文案候选；只能保留可编辑文案槽，不能编造卖点。');
    }
    if (!input.outputDir && !input.sizePlans.some((plan) => plan.quickExportPlanned)) {
        warnings.push('未提供导出目录且尺寸计划未声明导出，不能声明导出完成。');
    }
    if (!input.visionSignal) {
        warnings.push('缺少真实视觉模型或人工标注，素材语义只能保持 unknown 或 metadata-only。');
    }
    return warnings;
}

export function buildMainImageStrategyInputs(
    input: MainImageStrategyInputBuilderInput
): MainImageStrategyInputEvidence {
    const userText = cleanString(input.userText);
    const imageType = cleanString(input.imageType);
    const outputDir = cleanString(input.outputDir);
    const subjectBounds = normalizeSubjectBounds(input.subjectBounds);
    const sizePlans = normalizeSizePlans(input.sizePlans);
    const copyCandidates = cleanStrings(input.copyCandidates);
    const toolNames = cleanStrings(input.toolNames);
    const referenceHints = buildReferenceHints(input);
    const mainImageMemoryEvidence = input.mainImageMemoryEvidence || buildMainImageMemoryEvidence({
        userText: input.userText,
        knowledgeResults: input.knowledgeResults
    });
    const designPlacementIntelligenceEvidence = input.designPlacementIntelligenceEvidence || null;
    const strategyInputs: Partial<Record<MainImageStrategyInputKey, unknown>> = {};
    const assetHeroStrategyEvidence = buildMainImageAssetHeroStrategyEvidence({
        userText: input.userText,
        currentDocument: input.currentDocument,
        projectAssets: input.projectAssets || [],
        selectedAsset: input.selectedAsset,
        subjectBounds: input.subjectBounds,
        visionSignal: input.visionSignal
    });
    const projectStyleStrategyEvidence = buildMainImageProjectStyleStrategyEvidence({
        userText: input.userText,
        projectAssets: input.projectAssets || [],
        selectedAsset: input.selectedAsset,
        visionSignal: input.visionSignal,
        referenceHints
    });
    const designCoreEvidence = buildMainImageDesignCoreEvidence({
        projectStyleStrategyEvidence,
        copyCandidates
    });
    const copyEvidence = buildMainImageCopyEvidence({
        userText: input.userText,
        projectStyleStrategyEvidence,
        copyCandidates
    });
    const designStandardsEvidence = buildMainImageDesignStandardsEvidence({
        projectStyleStrategyEvidence
    });
    const mainImagePlatformProfile = input.mainImagePlatformProfile || buildMainImagePlatformSizeProfileEvidence();
    const productionDocumentStructureEvidence = buildMainImageProductionDocumentStructureEvidence({
        platformSizeProfileEvidence: mainImagePlatformProfile,
        projectStyleStrategyEvidence
    });
    const variantPlacementStrategyEvidence = buildMainImageVariantPlacementStrategyEvidence({
        userText: input.userText,
        projectStyleStrategyEvidence,
        selectedAsset: input.selectedAsset,
        subjectBounds: input.subjectBounds,
        sizePlans: input.sizePlans
    });
    const designConceptPlan = buildMainImageDesignConceptPlan({
        designCoreEvidence,
        projectStyleStrategyEvidence,
        assetHeroStrategyEvidence,
        copyEvidence,
        variantPlacementStrategyEvidence
    });
    const productionExecutionPlanEvidence = buildMainImageProductionExecutionPlanEvidence({
        productionDocumentStructureEvidence,
        variantPlacementStrategyEvidence,
        selectedAsset: input.selectedAsset,
        outputDir,
        allowPendingRatioExecution: input.allowPendingRatioExecution
    });
    const productionExecutorHandoffEvidence = buildMainImageProductionExecutorHandoffEvidence({
        productionExecutionPlanEvidence,
        availableToolNames: toolNames,
        outputDir,
        mode: 'dry-run'
    });
    const productionExecutorBridgeEvidence = buildMainImageProductionExecutorBridgeEvidence({
        productionExecutorHandoffEvidence,
        availableToolNames: toolNames,
        mode: 'dry-run-bridge'
    });
    const productionExecutorDryRunEvidence = buildMainImageProductionExecutorDryRunEvidence({
        productionExecutorBridgeEvidence
    });

    const assetSelectionPolicy = assetHeroStrategyEvidence.strategyInputPatch.assetSelectionPolicy;
    if (assetSelectionPolicy) strategyInputs.assetSelectionPolicy = assetSelectionPolicy;

    const heroSubjectPolicy = assetHeroStrategyEvidence.strategyInputPatch.heroSubjectPolicy;
    if (heroSubjectPolicy) strategyInputs.heroSubjectPolicy = heroSubjectPolicy;

    const imagePlacementPolicy = buildPlacementPolicy(
        subjectBounds,
        sizePlans,
        imageType,
        variantPlacementStrategyEvidence,
        designConceptPlan,
        designPlacementIntelligenceEvidence
    );
    if (imagePlacementPolicy) strategyInputs.imagePlacementPolicy = imagePlacementPolicy;

    const smartScalingPolicy = buildSmartScalingPolicy(
        subjectBounds,
        sizePlans,
        variantPlacementStrategyEvidence
    );
    if (smartScalingPolicy) strategyInputs.smartScalingPolicy = smartScalingPolicy;

    const copyRolePolicy = buildCopyRolePolicy({
        copyCandidates,
        userText,
        projectStyleStrategyEvidence,
        designCoreEvidence,
        copyEvidence,
        designConceptPlan,
        mainImageMemoryEvidence,
        designStandardsEvidence
    });
    if (copyRolePolicy) strategyInputs.copyRolePolicy = copyRolePolicy;

    const exportAcceptancePolicy = buildExportAcceptancePolicy(
        sizePlans,
        outputDir,
        designCoreEvidence,
        productionDocumentStructureEvidence,
        productionExecutionPlanEvidence,
        productionExecutorHandoffEvidence,
        productionExecutorBridgeEvidence,
        productionExecutorDryRunEvidence,
        designConceptPlan
    );
    if (exportAcceptancePolicy) strategyInputs.exportAcceptancePolicy = exportAcceptancePolicy;

    strategyInputs.performanceBudget = buildPerformanceBudget(
        sizePlans,
        (input.projectAssets || []).length,
        toolNames,
        mainImageMemoryEvidence
    );

    const providedInputs = collectProvidedInputs(strategyInputs);
    const missingInputs = REQUIRED_INPUTS.filter((key) => !providedInputs.includes(key));
    const status: MainImageStrategyInputBuilderStatus = missingInputs.length === 0
        ? 'ready_for_strategy_contract'
        : 'blocked_missing_strategy_evidence';
    const designReadinessReport = buildMainImageDesignReadinessReport({
        strategyInputEvidence: {
            status,
            missingInputs,
            blockers: missingInputs.length > 0 ? ['main_image_strategy_input_evidence_missing'] : [],
            warnings: [],
            designStandardsEvidence,
            productionExecutorDryRunEvidence
        },
        userCheckpointApproved: input.userCheckpointApproved
    });
    const liveExecutorRequestPackage = buildMainImageLiveExecutorRequestPackage({
        designReadinessReport,
        productionExecutorDryRunEvidence,
        requestLabel: cleanString(input.userText) || 'main-image-live-executor-request'
    });
    const warnings = buildWarnings({
        hasAsset: Boolean(assetSelectionPolicy),
        subjectBounds,
        sizePlans,
        copyCandidates,
        outputDir,
        visionSignal: input.visionSignal
    });

    return {
        version: 'main-image-strategy-input-builder/v0',
        skillId: 'main-image-design',
        scene: 'ecommerce-socks',
        status,
        strategyInputs,
        providedInputs,
        missingInputs,
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        assetHeroStrategyEvidence,
        projectStyleStrategyEvidence,
        designCoreEvidence,
        copyEvidence,
        designConceptPlan,
        mainImageMemoryEvidence,
        designPlacementIntelligenceEvidence,
        designStandardsEvidence,
        variantPlacementStrategyEvidence,
        productionDocumentStructureEvidence,
        productionExecutionPlanEvidence,
        productionExecutorHandoffEvidence,
        productionExecutorBridgeEvidence,
        productionExecutorDryRunEvidence,
        designReadinessReport,
        liveExecutorRequestPackage,
        blockers: missingInputs.length > 0 ? ['main_image_strategy_input_evidence_missing'] : [],
        warnings: [
            ...warnings,
            ...assetHeroStrategyEvidence.warnings,
            ...projectStyleStrategyEvidence.warnings,
            ...designCoreEvidence.warnings,
            ...copyEvidence.warnings,
            ...designConceptPlan.warnings,
            ...mainImageMemoryEvidence.warnings,
            ...(designPlacementIntelligenceEvidence?.warnings || []),
            ...designStandardsEvidence.warnings,
            ...variantPlacementStrategyEvidence.warnings,
            ...productionDocumentStructureEvidence.warnings,
            ...productionExecutionPlanEvidence.warnings,
            ...productionExecutorHandoffEvidence.warnings,
            ...productionExecutorBridgeEvidence.warnings,
            ...productionExecutorDryRunEvidence.warnings,
            ...designReadinessReport.warnings,
            ...liveExecutorRequestPackage.warnings
        ],
        limitations: [
            ...designCoreEvidence.limitations,
            ...copyEvidence.limitations,
            ...designConceptPlan.limitations,
            ...(designPlacementIntelligenceEvidence?.limitations || []),
            '策略输入生成器只整理上下文 evidence，不调用模型、不读取图片像素、不执行 Photoshop。',
            'metadata-only 素材和 bounds 只能进入策略讨论，不能证明设计质量。',
            '缺少真实视觉理解时，不能猜测产品款式、材质、风格和最佳构图。',
            '主图设计规范 evidence 只约束点击图/转化图设计策略，不代表已经完成设计或参考搜索。',
            '主图本地记忆 evidence 只提供用户偏好候选，不替代视觉证据、商品事实、平台规范或 Photoshop 验收。',
            'DesignPlacementIntelligence evidence 只提供选图和落位候选解释，不替代主体 bounds、actualBounds、截图 QA 或人工验收。',
            '生产文档结构 evidence 只描述文档/分组/导出计划，不创建 PSD/PSB。',
            '生产执行计划 evidence 只描述 Photoshop 操作顺序，不执行 Photoshop。',
            '生产执行交接 evidence 只描述 dry-run/tool handoff 请求，不执行 Photoshop。',
            '生产 executor bridge evidence 只描述真实执行前门禁和队列预览，不执行 Photoshop。',
            '生产 executor dry-run evidence 只记录将要执行的操作和读回计划，不执行 Photoshop、不伪造读回结果。',
            '设计 readiness report 只判断是否具备进入真实 executor 或质量声明的证据，不执行 Photoshop。',
            'live executor request package 只生成未来执行请求包和验收要求，不执行 Photoshop。'
        ],
        evidence: [
            {
                source: 'main-image-strategy-input-builder',
                summary: `provided=${providedInputs.length}; missing=${missingInputs.join('/') || 'none'}; toolEvidence=${toolNames.length}`,
                status: status === 'ready_for_strategy_contract' ? 'ready' : 'unknown'
            },
            ...(designPlacementIntelligenceEvidence ? [{
                source: 'design-placement-intelligence',
                summary: `status=${designPlacementIntelligenceEvidence.status}; candidates=${designPlacementIntelligenceEvidence.summary.candidateCount}; selected=${designPlacementIntelligenceEvidence.selectedCandidateId || 'none'}`,
                status: mapDesignPlacementEvidenceStatus(designPlacementIntelligenceEvidence)
            }] : []),
            ...mainImageMemoryEvidence.evidence
        ]
    };
}
