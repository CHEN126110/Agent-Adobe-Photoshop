import {
    selectMainImageAssetCandidate,
    type MainImageAssetSelectionAsset,
    type MainImageAssetSelectionDocument,
    type MainImageAssetSelectionMode,
    type MainImageAssetSelectionResult
} from './main-image-asset-selection';
import type { MainImageStrategyInputKey } from './main-image-strategy-contract';
import type { MainImageVisionSignal } from './main-image-visual-loop';

export type MainImageAssetHeroStrategyStatus =
    | 'blocked_missing_asset'
    | 'blocked_missing_subject_bounds'
    | 'ready_metadata_only'
    | 'ready_visual_grounded';

export interface MainImageAssetHeroStrategySubjectBounds {
    left?: number;
    top?: number;
    right?: number;
    bottom?: number;
    width?: number;
    height?: number;
}

export interface MainImageAssetHeroStrategyInput {
    userText?: string;
    currentDocument?: MainImageAssetSelectionDocument | null;
    projectAssets?: MainImageAssetSelectionAsset[];
    selectedAsset?: MainImageAssetSelectionAsset | null;
    subjectBounds?: MainImageAssetHeroStrategySubjectBounds | null;
    visionSignal?: MainImageVisionSignal | null;
}

export interface MainImageAssetHeroStrategyEvidence {
    version: 'main-image-asset-hero-strategy/v0';
    skillId: 'main-image-design';
    scene: 'ecommerce-socks';
    status: MainImageAssetHeroStrategyStatus;
    assetUnderstanding: {
        selectionMode: MainImageAssetSelectionMode;
        candidateCount: number;
        selectedAssetName?: string;
        selectedAssetPath?: string;
        selectedAssetRole?: string;
        selectedAssetSource?: string;
        visualGrounding: 'none' | string;
        semanticStatus: 'metadata_only' | 'visual_grounded' | 'missing';
        warnings: string[];
    };
    heroSubjectSelection: {
        status: 'missing_bounds' | 'bounds_ready';
        bounds?: Required<MainImageAssetHeroStrategySubjectBounds>;
        productType: string;
        subjectSummary: string;
        source: 'none' | 'subject-bounds' | 'subject-bounds-plus-vision';
    };
    strategyInputPatch: Partial<Record<MainImageStrategyInputKey, unknown>>;
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

interface NormalizedSubjectBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
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

function cleanStrings(values: unknown[]): string[] {
    return values.map(cleanString).filter(Boolean);
}

function normalizeSubjectBounds(
    bounds: MainImageAssetHeroStrategySubjectBounds | null | undefined
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

function getVisualGrounding(visionSignal: MainImageVisionSignal | null | undefined): 'none' | string {
    const source = cleanString(visionSignal?.source);
    return source || 'none';
}

function hasVisualGrounding(visionSignal: MainImageVisionSignal | null | undefined): boolean {
    return getVisualGrounding(visionSignal) !== 'none';
}

function buildStatus(input: {
    assetSelection: MainImageAssetSelectionResult;
    subjectBounds?: NormalizedSubjectBounds;
    visualGrounded: boolean;
}): MainImageAssetHeroStrategyStatus {
    if (!input.assetSelection.selectedAsset) return 'blocked_missing_asset';
    if (!input.subjectBounds) return 'blocked_missing_subject_bounds';
    if (input.visualGrounded) return 'ready_visual_grounded';
    return 'ready_metadata_only';
}

function evidenceStatusFromStrategyStatus(
    status: MainImageAssetHeroStrategyStatus
): MainImageAssetHeroStrategyEvidence['evidence'][number]['status'] {
    if (status === 'blocked_missing_asset' || status === 'blocked_missing_subject_bounds') return 'failed';
    if (status === 'ready_visual_grounded') return 'ready';
    return 'needs_review';
}

function buildAssetSelectionPolicy(
    assetSelection: MainImageAssetSelectionResult,
    visualGrounding: string
): Record<string, unknown> | undefined {
    const selected = assetSelection.selectedAsset;
    if (!selected) return undefined;
    return {
        mode: assetSelection.selectionMode,
        selectedAssetName: cleanString(selected.name) || undefined,
        selectedAssetPath: cleanString(selected.path) || undefined,
        selectedAssetRole: cleanString(selected.role) || undefined,
        selectedAssetSource: cleanString(selected.source) || undefined,
        selectedAssetScore: Math.round(Number(selected.score || 0)),
        candidateCount: assetSelection.candidateCount,
        visualGrounding,
        boundary: 'asset policy is selected from metadata and optional visual/manual signal; it is not Photoshop placement'
    };
}

function buildHeroSubjectPolicy(
    subjectBounds: NormalizedSubjectBounds | undefined,
    visionSignal: MainImageVisionSignal | null | undefined
): Record<string, unknown> | undefined {
    if (!subjectBounds) return undefined;
    return {
        source: hasVisualGrounding(visionSignal) ? 'subject-bounds-plus-vision' : 'subject-bounds',
        bounds: subjectBounds,
        productType: cleanString(visionSignal?.productType) || 'unknown',
        subjectSummary: cleanString(visionSignal?.subjectSummary) || 'bounds only; visual semantics not confirmed',
        boundary: 'hero subject policy is a planning input and still needs post-transform QA'
    };
}

function buildBlockers(
    status: MainImageAssetHeroStrategyStatus,
    assetSelection: MainImageAssetSelectionResult
): string[] {
    const blockers = [...assetSelection.blockers];
    if (status === 'blocked_missing_asset') {
        blockers.push('main_image_asset_missing');
    }
    if (status === 'blocked_missing_subject_bounds') {
        blockers.push('main_image_subject_bounds_missing');
    }
    return blockers;
}

function buildWarnings(input: {
    assetSelection: MainImageAssetSelectionResult;
    status: MainImageAssetHeroStrategyStatus;
    visionSignal?: MainImageVisionSignal | null;
}): string[] {
    const warnings = [...input.assetSelection.warnings];
    if (!hasVisualGrounding(input.visionSignal)) {
        warnings.push('缺少真实视觉模型或人工标注，不能判断款式、材质、风格或最佳构图。');
    }
    if (input.status === 'blocked_missing_subject_bounds') {
        warnings.push('已有素材上下文，但缺少主体 bounds，不能计算主视觉大小和位置。');
    }
    return cleanStrings(warnings);
}

function buildSemanticStatus(input: {
    selected: boolean;
    visualGrounded: boolean;
}): MainImageAssetHeroStrategyEvidence['assetUnderstanding']['semanticStatus'] {
    if (!input.selected) return 'missing';
    if (input.visualGrounded) return 'visual_grounded';
    return 'metadata_only';
}

function buildHeroSubjectSource(input: {
    subjectBounds?: NormalizedSubjectBounds;
    visualGrounded: boolean;
}): MainImageAssetHeroStrategyEvidence['heroSubjectSelection']['source'] {
    if (!input.subjectBounds) return 'none';
    if (input.visualGrounded) return 'subject-bounds-plus-vision';
    return 'subject-bounds';
}

export function buildMainImageAssetHeroStrategyEvidence(
    input: MainImageAssetHeroStrategyInput
): MainImageAssetHeroStrategyEvidence {
    const assetSelection = selectMainImageAssetCandidate({
        userText: cleanString(input.userText),
        currentDocument: input.currentDocument,
        projectAssets: input.projectAssets || [],
        selectedAsset: input.selectedAsset
    });
    const selected = assetSelection.selectedAsset;
    const subjectBounds = normalizeSubjectBounds(input.subjectBounds);
    const visualGrounding = getVisualGrounding(input.visionSignal);
    const visualGrounded = visualGrounding !== 'none';
    const status = buildStatus({ assetSelection, subjectBounds, visualGrounded });
    const strategyInputPatch: Partial<Record<MainImageStrategyInputKey, unknown>> = {};
    const assetSelectionPolicy = buildAssetSelectionPolicy(assetSelection, visualGrounding);
    if (assetSelectionPolicy) strategyInputPatch.assetSelectionPolicy = assetSelectionPolicy;
    const heroSubjectPolicy = buildHeroSubjectPolicy(subjectBounds, input.visionSignal);
    if (heroSubjectPolicy) strategyInputPatch.heroSubjectPolicy = heroSubjectPolicy;

    return {
        version: 'main-image-asset-hero-strategy/v0',
        skillId: 'main-image-design',
        scene: 'ecommerce-socks',
        status,
        assetUnderstanding: {
            selectionMode: assetSelection.selectionMode,
            candidateCount: assetSelection.candidateCount,
            selectedAssetName: cleanString(selected?.name) || undefined,
            selectedAssetPath: cleanString(selected?.path) || undefined,
            selectedAssetRole: cleanString(selected?.role) || undefined,
            selectedAssetSource: cleanString(selected?.source) || undefined,
            visualGrounding,
            semanticStatus: buildSemanticStatus({ selected: Boolean(selected), visualGrounded }),
            warnings: cleanStrings(selected?.warnings || [])
        },
        heroSubjectSelection: {
            status: subjectBounds ? 'bounds_ready' : 'missing_bounds',
            bounds: subjectBounds,
            productType: cleanString(input.visionSignal?.productType) || 'unknown',
            subjectSummary: cleanString(input.visionSignal?.subjectSummary) || 'bounds only; visual semantics not confirmed',
            source: buildHeroSubjectSource({ subjectBounds, visualGrounded })
        },
        strategyInputPatch,
        canClaimOutputQuality: false,
        canClaimDesignComplete: false,
        noPhotoshopWrites: true,
        mustNotExecutePhotoshop: true,
        blockers: buildBlockers(status, assetSelection),
        warnings: buildWarnings({ assetSelection, status, visionSignal: input.visionSignal }),
        limitations: [
            '素材与主体策略 evidence 只整理上下文，不调用 provider、不读取图片像素、不执行 Photoshop。',
            'metadata-only 只能说明候选来源和 bounds 存在，不能证明图片内容、审美或商业适配。',
            '没有真实视觉信号时，productType 必须保持 unknown，不能凭文件名猜款式。'
        ],
        evidence: [{
            source: 'main-image-asset-hero-strategy',
            summary: `status=${status}; assetMode=${assetSelection.selectionMode}; candidates=${assetSelection.candidateCount}; visualGrounding=${visualGrounding}`,
            status: evidenceStatusFromStrategyStatus(status)
        }]
    };
}
