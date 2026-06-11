import type {
    DesignAgentOsStatus,
    EvidenceRef,
    VisualUnderstanding,
    VerificationCheck,
    VerificationReport
} from './design-agent-os-contracts';
import type {
    MainImageAssetSelectionResult
} from './main-image-asset-selection';
import type {
    MainImageDraftDocument,
    MainImageDraftSubjectBounds
} from './main-image-agent-draft-plan';
import type { MainImageSizePlanEvidence } from './design-agent-os-contracts';

export type MainImageVisualReadiness =
    | 'ready'
    | 'needs_vision'
    | 'needs_asset'
    | 'blocked';

export type MainImageVisualSource =
    | 'vision-model'
    | 'manual-annotation'
    | 'metadata-only'
    | 'missing';

export interface MainImageAgentDesignDecision {
    styleKeywords?: string[];
    recommendedTone?: string;
    backgroundDirection?: string;
    clickVisualHooks?: string[];
    conversionVisualHooks?: string[];
    clickLayoutFocus?: string;
    conversionLayoutFocus?: string;
    clickCopyRole?: string;
    conversionCopyRole?: string;
    referenceQueries?: string[];
    notes?: string[];
}

export interface MainImageVisionSignal {
    source?: 'vision-model' | 'manual-annotation';
    productType?: string;
    subjectSummary?: string;
    backgroundSummary?: string;
    sceneSummary?: string;
    styleHints?: string[];
    agentDecision?: MainImageAgentDesignDecision;
    risks?: string[];
    evidence?: string[];
}

export interface MainImageVisualUnderstanding {
    source: MainImageVisualSource;
    readiness: MainImageVisualReadiness;
    selectedAssetName?: string;
    selectedAssetPath?: string;
    productIdentity: {
        label: string;
        grounding: MainImageVisualSource;
        status: DesignAgentOsStatus;
        evidence: string[];
    };
    subject: {
        summary: string;
        boundsKnown: boolean;
        status: DesignAgentOsStatus;
        evidence: string[];
    };
    background: {
        summary: string;
        status: DesignAgentOsStatus;
        evidence: string[];
    };
    mainImageFit: {
        status: 'candidate' | 'watch' | 'blocked' | 'unknown';
        evidenceLevel: 'visual-and-bounds' | 'visual-only' | 'bounds-only' | 'metadata-only' | 'none';
        reasons: string[];
    };
    blockers: string[];
    warnings: string[];
    limitations: string[];
    evidence: EvidenceRef[];
}

export interface MainImageResultScreenshotEvidence {
    source?: 'getScreenSnapshotsWithOverlay' | 'getCanvasSnapshot' | 'quickExport' | 'manual' | 'unknown';
    hasImageEvidence?: boolean;
    snapshotCount?: number;
    resultPath?: string;
    redacted?: boolean;
    notes?: string[];
}

export interface MainImageManualReviewEvidence {
    decision?: 'approved' | 'needs_review' | 'rejected';
    score?: number;
    reviewer?: string;
    notes?: string[];
}

export interface MainImageVisualVerification {
    status: DesignAgentOsStatus;
    stage: 'blocked' | 'needs_screenshot' | 'needs_manual_review' | 'ready_for_manual_review' | 'passed';
    checks: VerificationCheck[];
    blockers: string[];
    warnings: string[];
    limitations: string[];
    screenshotEvidence?: MainImageResultScreenshotEvidence;
    manualReview?: MainImageManualReviewEvidence;
    verificationReport: VerificationReport;
}

export interface MainImageVisualLoopInput {
    assetSelection: MainImageAssetSelectionResult;
    currentDocument?: MainImageDraftDocument | null;
    subjectBounds?: MainImageDraftSubjectBounds | null;
    sizePlans?: MainImageSizePlanEvidence[];
    toolNames?: string[];
    visionSignal?: MainImageVisionSignal | null;
    screenshotEvidence?: MainImageResultScreenshotEvidence | null;
    manualReview?: MainImageManualReviewEvidence | null;
}

function cleanString(value: unknown): string {
    return String(value || '').trim();
}

function normalizeStrings(values: unknown): string[] {
    return Array.isArray(values)
        ? values.map(cleanString).filter(Boolean)
        : [];
}

function hasSubjectBounds(bounds: MainImageDraftSubjectBounds | null | undefined): boolean {
    const width = Number(bounds?.width ?? (Number(bounds?.right) - Number(bounds?.left)));
    const height = Number(bounds?.height ?? (Number(bounds?.bottom) - Number(bounds?.top)));
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
}

function resolveVisualReadiness(input: {
    hasBlockers: boolean;
    hasSelectedAsset: boolean;
    hasVision: boolean;
}): MainImageVisualReadiness {
    if (input.hasBlockers) return 'blocked';
    if (!input.hasSelectedAsset) return 'needs_asset';
    if (input.hasVision) return 'ready';
    return 'needs_vision';
}

function resolveMainImageFitStatus(input: {
    readiness: MainImageVisualReadiness;
    hasVision: boolean;
    boundsKnown: boolean;
    hasSelectedAsset: boolean;
}): MainImageVisualUnderstanding['mainImageFit']['status'] {
    if (input.readiness === 'blocked') return 'blocked';
    if (input.hasVision && input.boundsKnown) return 'candidate';
    if (input.hasSelectedAsset) return 'watch';
    return 'unknown';
}

function resolveMainImageFitEvidenceLevel(input: {
    hasVision: boolean;
    boundsKnown: boolean;
    hasSelectedAsset: boolean;
}): MainImageVisualUnderstanding['mainImageFit']['evidenceLevel'] {
    if (input.hasVision && input.boundsKnown) return 'visual-and-bounds';
    if (input.hasVision) return 'visual-only';
    if (input.boundsKnown) return 'bounds-only';
    if (input.hasSelectedAsset) return 'metadata-only';
    return 'none';
}

function statusFromVisualReadiness(readiness: MainImageVisualReadiness): DesignAgentOsStatus {
    if (readiness === 'blocked') return 'failed';
    if (readiness === 'ready') return 'needs_review';
    return 'unknown';
}

function inferCanvas(input: MainImageVisualLoopInput): { width: number; height: number } {
    const planSize = input.sizePlans?.[0]?.targetSize;
    const selected = input.assetSelection.selectedAsset;
    const width = Number(planSize?.width ?? input.currentDocument?.width ?? selected?.width ?? 0);
    const height = Number(planSize?.height ?? input.currentDocument?.height ?? selected?.height ?? 0);
    return {
        width: Number.isFinite(width) && width > 0 ? Math.round(width) : 0,
        height: Number.isFinite(height) && height > 0 ? Math.round(height) : 0
    };
}

export function buildMainImageScreenshotEvidenceFromSizePlans(
    sizePlans: MainImageSizePlanEvidence[] | undefined
): MainImageResultScreenshotEvidence | null {
    const plans = Array.isArray(sizePlans) ? sizePlans : [];
    const exported = plans.find((plan) => cleanString(plan.quickExportOutputPath));
    if (exported?.quickExportOutputPath) {
        return {
            source: 'quickExport',
            hasImageEvidence: true,
            resultPath: exported.quickExportOutputPath,
            redacted: true,
            notes: [`来自 size ${exported.sizeKey} 的 quickExportOutputPath。`]
        };
    }
    const planned = plans.find((plan) => plan.quickExportPlanned);
    if (planned) {
        return {
            source: 'quickExport',
            hasImageEvidence: false,
            redacted: true,
            notes: [`size ${planned.sizeKey} 计划导出，但没有记录可复核的 outputPath。`]
        };
    }
    return null;
}

export function buildMainImageVisualUnderstanding(input: MainImageVisualLoopInput): MainImageVisualUnderstanding {
    const selectedAsset = input.assetSelection.selectedAsset;
    const vision = input.visionSignal || null;
    const productLabel = cleanString(vision?.productType);
    const subjectSummary = cleanString(vision?.subjectSummary);
    const backgroundSummary = cleanString(vision?.backgroundSummary);
    const boundsKnown = hasSubjectBounds(input.subjectBounds);
    const blockers = [...input.assetSelection.blockers];
    const warnings = [
        ...input.assetSelection.warnings,
        ...normalizeStrings(vision?.risks)
    ];

    let source: MainImageVisualSource = 'missing';
    if (vision?.source === 'vision-model') source = 'vision-model';
    else if (vision?.source === 'manual-annotation') source = 'manual-annotation';
    else if (selectedAsset) source = 'metadata-only';

    if (!selectedAsset) {
        warnings.push('缺少主图素材候选，不能进行视觉理解。');
    }
    if (selectedAsset && !vision) {
        warnings.push('已有素材候选，但缺少视觉模型或人工标注，不能判断款式、场景、背景和主图适配度。');
    }
    if (!boundsKnown) {
        warnings.push('缺少主体 bounds，不能判断主视觉大小和构图落位。');
    }

    const readiness = resolveVisualReadiness({
        hasBlockers: blockers.length > 0,
        hasSelectedAsset: Boolean(selectedAsset),
        hasVision: Boolean(vision)
    });
    const fitStatus = resolveMainImageFitStatus({
        readiness,
        hasVision: Boolean(vision),
        boundsKnown,
        hasSelectedAsset: Boolean(selectedAsset)
    });
    const fitEvidenceLevel = resolveMainImageFitEvidenceLevel({
        hasVision: Boolean(vision),
        boundsKnown,
        hasSelectedAsset: Boolean(selectedAsset)
    });

    return {
        source,
        readiness,
        selectedAssetName: selectedAsset?.name,
        selectedAssetPath: selectedAsset?.path,
        productIdentity: {
            label: productLabel || 'unknown',
            grounding: source === 'vision-model' || source === 'manual-annotation' ? source : 'missing',
            status: productLabel ? 'needs_review' : 'unknown',
            evidence: [
                productLabel ? `视觉信号识别产品：${productLabel}` : '没有真实视觉识别结果，不能猜测产品款式。',
                ...normalizeStrings(vision?.evidence)
            ]
        },
        subject: {
            summary: subjectSummary || (boundsKnown ? '已有 Photoshop 主体 bounds，但没有视觉语义描述。' : 'unknown'),
            boundsKnown,
            status: boundsKnown ? 'needs_review' : 'unknown',
            evidence: [
                boundsKnown ? '存在主体 bounds，可作为缩放和安全区复核依据。' : '缺少主体 bounds。',
                subjectSummary ? `视觉主体描述：${subjectSummary}` : ''
            ].filter(Boolean)
        },
        background: {
            summary: backgroundSummary || 'unknown',
            status: backgroundSummary ? 'needs_review' : 'unknown',
            evidence: [backgroundSummary ? `背景描述：${backgroundSummary}` : '没有背景视觉证据。']
        },
        mainImageFit: {
            status: fitStatus,
            evidenceLevel: fitEvidenceLevel,
            reasons: [
                selectedAsset ? `素材候选：${selectedAsset.name || selectedAsset.path || 'unknown'}` : '缺少素材候选。',
                vision ? '存在视觉模型或人工标注信号。' : '缺少真实视觉信号。',
                boundsKnown ? '存在主体 bounds。' : '缺少主体 bounds。'
            ]
        },
        blockers,
        warnings,
        limitations: [
            'metadata-only 素材候选不能替代视觉模型理解。',
            '视觉理解 evidence 不代表 Photoshop 已完成主图设计。',
            '即使存在视觉模型结果，也需要截图或人工复核确认构图、尺寸和审美。'
        ],
        evidence: [{
            source: 'main-image-visual-understanding',
            summary: `source=${source}; readiness=${readiness}; selected=${selectedAsset?.name || selectedAsset?.path || 'none'}。`,
            status: statusFromVisualReadiness(readiness)
        }]
    };
}

export function buildMainImageVisualUnderstandingContract(input: MainImageVisualLoopInput): VisualUnderstanding {
    const visual = buildMainImageVisualUnderstanding(input);
    const canvas = inferCanvas(input);
    return {
        source: visual.source,
        canvas,
        layoutType: 'main-image-visual-loop',
        designIntent: '理解主图素材、主体、背景和结果验收缺口。',
        elementCount: visual.selectedAssetName || visual.selectedAssetPath ? 1 : 0,
        nodeKindCounts: {
            asset: visual.selectedAssetName || visual.selectedAssetPath ? 1 : 0,
            subjectBounds: visual.subject.boundsKnown ? 1 : 0,
            screenshot: input.screenshotEvidence?.hasImageEvidence ? 1 : 0
        },
        roleCounts: {
            'hero-subject': visual.subject.boundsKnown ? 1 : 0,
            'main-image-asset': visual.selectedAssetName || visual.selectedAssetPath ? 1 : 0
        },
        primaryRoles: [
            visual.selectedAssetName || visual.selectedAssetPath ? 'main-image-asset' : '',
            visual.subject.boundsKnown ? 'hero-subject' : ''
        ].filter(Boolean),
        evidence: visual.evidence,
        limitations: visual.limitations
    };
}

export function buildMainImageVisualVerification(input: MainImageVisualLoopInput): MainImageVisualVerification {
    const visual = buildMainImageVisualUnderstanding(input);
    const screenshot = input.screenshotEvidence || undefined;
    const manualReview = input.manualReview || undefined;
    const hasScreenshot = Boolean(screenshot?.hasImageEvidence && (screenshot.snapshotCount || screenshot.resultPath));
    const manualDecision = manualReview?.decision;
    const blockers = [...visual.blockers];
    const warnings = [...visual.warnings];

    if (!hasScreenshot) {
        warnings.push('缺少结果截图或导出图证据，不能进行截图级主图验收。');
    }
    if (!manualDecision) {
        warnings.push('缺少人工复核结论，不能声明主图设计质量通过。');
    }
    if (manualDecision === 'rejected') {
        blockers.push('人工复核拒绝当前主图结果。');
    }

    const checks: VerificationCheck[] = [
        {
            id: 'main-image-visual-understanding',
            label: '素材视觉理解',
            status: visual.readiness === 'ready'
                ? 'needs_review'
                : visual.readiness === 'blocked'
                    ? 'failed'
                    : 'unknown',
            summary: `readiness=${visual.readiness}; source=${visual.source}; product=${visual.productIdentity.label}。`
        },
        {
            id: 'main-image-subject-bounds',
            label: '主体 bounds',
            status: visual.subject.boundsKnown ? 'needs_review' : 'unknown',
            summary: visual.subject.boundsKnown ? '存在主体 bounds，可继续截图复核。' : '缺少主体 bounds。'
        },
        {
            id: 'main-image-result-screenshot',
            label: '结果截图',
            status: hasScreenshot ? 'needs_review' : 'not_run',
            summary: hasScreenshot
                ? `存在截图/导出证据：${screenshot?.resultPath || screenshot?.source || 'unknown'}。`
                : '没有结果截图或导出图证据。'
        },
        {
            id: 'main-image-manual-review',
            label: '人工复核',
            status: manualDecision === 'approved'
                ? 'passed'
                : manualDecision === 'rejected'
                    ? 'failed'
                    : 'not_run',
            summary: manualDecision
                ? `manual=${manualDecision}; score=${manualReview?.score ?? 'unknown'}。`
                : '没有人工复核结论。'
        }
    ];

    const status: DesignAgentOsStatus = blockers.length > 0
        ? 'failed'
        : hasScreenshot && manualDecision === 'approved'
            ? 'passed'
            : hasScreenshot
                ? 'needs_review'
                : 'not_run';
    const stage = blockers.length > 0
        ? 'blocked'
        : !hasScreenshot
            ? 'needs_screenshot'
            : !manualDecision
                ? 'needs_manual_review'
                : manualDecision === 'approved'
                    ? 'passed'
                    : 'ready_for_manual_review';

    const limitations = [
        '截图证据必须是结果图或 Photoshop 画布截图，不允许传 raw base64 到用户报告。',
        '工具调用成功、bounds 成功和导出成功都不等于审美通过。',
        '没有人工复核或明确验收策略时，主图设计质量只能是 needs_review。'
    ];
    const verificationReport: VerificationReport = {
        reportId: 'main-image-visual-verification',
        scenario: 'main-image',
        status,
        scope: hasScreenshot ? 'screenshot' : 'task',
        summary: status === 'passed'
            ? '主图结果已有截图证据和人工通过结论。'
            : hasScreenshot
                ? '主图结果已有截图证据，但仍需人工或更强视觉 QA 复核。'
                : '主图结果缺少截图证据，不能声明设计完成。',
        checks,
        blockers,
        warnings,
        limitations,
        evidence: [{
            source: 'main-image-visual-verification',
            summary: `stage=${stage}; screenshot=${hasScreenshot ? 'yes' : 'no'}; manual=${manualDecision || 'none'}。`,
            status
        }]
    };

    return {
        status,
        stage,
        checks,
        blockers,
        warnings,
        limitations,
        screenshotEvidence: screenshot,
        manualReview,
        verificationReport
    };
}
