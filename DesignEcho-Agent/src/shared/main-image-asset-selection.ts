export type MainImageAssetSelectionReadiness = 'ready' | 'needs_context' | 'blocked';

export type MainImageAssetSelectionMode =
    | 'explicit-asset'
    | 'selected-project-image'
    | 'project-asset-candidate'
    | 'active-document-fallback'
    | 'missing';

export type MainImageAssetCandidateSource =
    | 'explicit-asset'
    | 'selected-project-image'
    | 'project-asset'
    | 'current-document';

export interface MainImageAssetSelectionDocument {
    id?: number | string;
    name?: string;
    width?: number;
    height?: number;
    path?: string;
}

export interface MainImageAssetSelectionAsset {
    id?: string;
    name?: string;
    path?: string;
    width?: number;
    height?: number;
    role?: string;
    source?: MainImageAssetCandidateSource | string;
}

export interface MainImageAssetCandidate {
    id?: string;
    name?: string;
    path?: string;
    width?: number;
    height?: number;
    role?: string;
    source: MainImageAssetCandidateSource;
    isImageLike: boolean;
    score: number;
    reasons: string[];
    warnings: string[];
}

export interface MainImageAssetSelectionResult {
    readiness: MainImageAssetSelectionReadiness;
    preflightGate: 'pass' | 'needs_input' | 'blocked';
    selectionMode: MainImageAssetSelectionMode;
    assetDecisionSource: 'explicit' | 'user-selection' | 'heuristic-candidate' | 'missing';
    requiresModelAssetDecision: boolean;
    selectedAsset?: MainImageAssetCandidate;
    candidates: MainImageAssetCandidate[];
    candidateCount: number;
    blockers: string[];
    warnings: string[];
    limitations: string[];
    evidence: Array<{
        source: string;
        summary: string;
        status: 'ready' | 'needs_review' | 'failed' | 'unknown';
    }>;
}

export interface MainImageAssetSelectionInput {
    userText?: string;
    currentDocument?: MainImageAssetSelectionDocument | null;
    projectAssets?: MainImageAssetSelectionAsset[];
    selectedAsset?: MainImageAssetSelectionAsset | null;
}

export type MainImageCandidatePreflightStatus =
    | 'metadata_only'
    | 'ready_to_analyze'
    | 'needs_asset'
    | 'blocked';

export interface MainImageCandidatePreflightInput extends MainImageAssetSelectionInput {
    enableVisionPreflight?: unknown;
    maxVisionCandidates?: unknown;
    hasAnalyzer?: boolean;
}

export interface MainImageCandidatePreflightPlan {
    status: MainImageCandidatePreflightStatus;
    enabled: boolean;
    maxVisionCandidates: number;
    shouldCallAnalyzer: boolean;
    shouldAnalyzePaths: string[];
    assetSelection: MainImageAssetSelectionResult;
    selectedCandidate?: MainImageAssetCandidate;
    candidates: MainImageAssetCandidate[];
    candidateCount: number;
    blockers: string[];
    warnings: string[];
    limitations: string[];
    evidence: Array<{
        source: string;
        summary: string;
        status: 'ready' | 'needs_review' | 'failed' | 'unknown';
    }>;
}

const IMAGE_LIKE_EXTENSIONS = new Set([
    'jpg',
    'jpeg',
    'png',
    'webp',
    'psd',
    'psb',
    'tif',
    'tiff'
]);

const PRODUCT_HINTS = [
    '主图',
    '商品',
    '产品',
    '袜',
    '鞋',
    '服',
    '包',
    'main',
    'hero',
    'product',
    'sock',
    'shoe'
];

const NON_PRODUCT_HINTS = [
    'reference',
    '参考',
    'certificate',
    '合格证',
    'qr',
    '二维码',
    'logo',
    'watermark',
    '水印'
];

function cleanString(value: unknown): string {
    return String(value || '').trim();
}

function normalizePath(value: unknown): string | undefined {
    const text = cleanString(value);
    return text || undefined;
}

function basename(value: unknown): string | undefined {
    const text = cleanString(value);
    if (!text) return undefined;
    return text.split(/[\\/]/).filter(Boolean).pop() || text;
}

function extensionOf(value: unknown): string {
    const name = cleanString(value).toLowerCase();
    const match = name.match(/\.([a-z0-9]+)$/i);
    return match ? match[1] : '';
}

function toPositiveNumber(value: unknown): number | undefined {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function toBoundedPositiveInteger(value: unknown, fallback: number, min: number, max: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function isVisionPreflightEnabled(value: unknown): boolean {
    if (value === true) return true;
    const text = cleanString(value).toLowerCase();
    return ['true', '1', 'yes', 'on', 'enabled', 'auto', 'required'].includes(text);
}

function evidenceStatusFromReadiness(
    readiness: MainImageAssetSelectionReadiness
): MainImageAssetSelectionResult['evidence'][number]['status'] {
    if (readiness === 'blocked') return 'failed';
    if (readiness === 'ready') return 'ready';
    return 'unknown';
}

function resolveAssetDecisionSource(
    selectionMode: MainImageAssetSelectionMode
): MainImageAssetSelectionResult['assetDecisionSource'] {
    if (selectionMode === 'explicit-asset') return 'explicit';
    if (selectionMode === 'selected-project-image') return 'user-selection';
    if (selectionMode === 'missing') return 'missing';
    return 'heuristic-candidate';
}

function isImageLikeAsset(asset: { path?: unknown; name?: unknown }): boolean {
    const ext = extensionOf(asset.path) || extensionOf(asset.name);
    if (!ext) return true;
    return IMAGE_LIKE_EXTENSIONS.has(ext);
}

function userHintTokens(userText: string): string[] {
    const lower = userText.toLowerCase();
    const tokens = PRODUCT_HINTS.filter((hint) => lower.includes(hint.toLowerCase()));
    const asciiTokens = lower
        .split(/[^a-z0-9]+/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 3 && !['the', 'and', 'for', 'with'].includes(item));
    return Array.from(new Set([...tokens, ...asciiTokens])).slice(0, 8);
}

function includesAny(text: string, hints: string[]): boolean {
    const lower = text.toLowerCase();
    return hints.some((hint) => lower.includes(hint.toLowerCase()));
}

function makeCandidate(
    source: MainImageAssetCandidateSource,
    asset: MainImageAssetSelectionAsset | MainImageAssetSelectionDocument,
    baseScore: number,
    userTokens: string[]
): MainImageAssetCandidate | null {
    const path = normalizePath((asset as MainImageAssetSelectionAsset).path);
    const name = cleanString((asset as MainImageAssetSelectionAsset).name) || basename(path);
    if (!path && !name) return null;

    const text = `${name || ''} ${path || ''} ${(asset as MainImageAssetSelectionAsset).role || ''}`;
    const isImageLike = isImageLikeAsset({ path, name });
    const reasons: string[] = [];
    const warnings: string[] = [];
    let score = baseScore;

    if (source === 'explicit-asset') reasons.push('上下文提供了明确素材。');
    if (source === 'selected-project-image') reasons.push('项目面板已有选中的图片素材。');
    if (source === 'project-asset') reasons.push('项目资源列表中存在候选素材。');
    if (source === 'current-document') reasons.push('当前 Photoshop 文档可作为活动素材上下文。');

    if (isImageLike) {
        score += 10;
        reasons.push('文件类型可作为图片或设计源使用。');
    } else {
        score -= 35;
        warnings.push('候选文件扩展名不像图片或 Photoshop 设计源。');
    }

    const width = toPositiveNumber((asset as MainImageAssetSelectionAsset).width);
    const height = toPositiveNumber((asset as MainImageAssetSelectionAsset).height);
    if (width && height) {
        score += 5;
        reasons.push(`已有尺寸证据 ${Math.round(width)}x${Math.round(height)}。`);
    }

    const role = cleanString((asset as MainImageAssetSelectionAsset).role);
    if (/selected/i.test(role) || role.includes('选中')) {
        score += 12;
        reasons.push('候选来自用户当前选择。');
    }
    if (/project-image|product|hero|main/i.test(role) || role.includes('项目图片') || role.includes('商品')) {
        score += 6;
        reasons.push('候选角色接近主图素材。');
    }
    if (includesAny(text, PRODUCT_HINTS)) {
        score += 8;
        reasons.push('文件名或路径包含商品/主图线索。');
    }
    if (includesAny(text, NON_PRODUCT_HINTS)) {
        score -= 12;
        warnings.push('文件名或路径更像参考、合格证、二维码、Logo 或水印，需复核是否适合主图。');
    }
    for (const token of userTokens) {
        if (token && text.toLowerCase().includes(token.toLowerCase())) {
            score += 2;
        }
    }

    return {
        id: cleanString((asset as MainImageAssetSelectionAsset).id) || undefined,
        name,
        path,
        width,
        height,
        role: role || undefined,
        source,
        isImageLike,
        score,
        reasons,
        warnings
    };
}

function dedupeCandidates(candidates: MainImageAssetCandidate[]): MainImageAssetCandidate[] {
    const seen = new Set<string>();
    const result: MainImageAssetCandidate[] = [];
    for (const candidate of candidates) {
        const key = (candidate.path || candidate.name || '').toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push(candidate);
    }
    return result;
}

export function selectMainImageAssetCandidate(input: MainImageAssetSelectionInput): MainImageAssetSelectionResult {
    const userTokens = userHintTokens(cleanString(input.userText));
    const rawCandidates: MainImageAssetCandidate[] = [];

    const explicit = input.selectedAsset
        ? makeCandidate('explicit-asset', input.selectedAsset, 140, userTokens)
        : null;
    if (explicit) rawCandidates.push(explicit);

    for (const asset of input.projectAssets || []) {
        const source = cleanString(asset.source) === 'selected-project-image' || /selected/i.test(cleanString(asset.role))
            ? 'selected-project-image'
            : 'project-asset';
        const baseScore = source === 'selected-project-image' ? 90 : 70;
        const candidate = makeCandidate(source, asset, baseScore, userTokens);
        if (candidate) rawCandidates.push(candidate);
    }

    const currentDocument = input.currentDocument;
    if (currentDocument?.name || currentDocument?.path) {
        const activeCandidate = makeCandidate('current-document', currentDocument, 58, userTokens);
        if (activeCandidate) rawCandidates.push(activeCandidate);
    }

    const candidates = dedupeCandidates(rawCandidates).sort((a, b) => b.score - a.score);
    const selectedAsset = candidates[0];
    const blockers: string[] = [];
    const warnings: string[] = [];

    if (!selectedAsset) {
        warnings.push('缺少明确素材、项目候选图片和当前 Photoshop 文档，不能安全生成主图草案。');
    } else {
        warnings.push(...selectedAsset.warnings);
        if (!selectedAsset.isImageLike && selectedAsset.source === 'explicit-asset') {
            blockers.push('明确选择的素材不像图片或 Photoshop 设计源，需要用户重新选择。');
        }
    }

    const selectionMode: MainImageAssetSelectionMode = selectedAsset
        ? selectedAsset.source === 'current-document'
            ? 'active-document-fallback'
            : selectedAsset.source === 'project-asset'
                ? 'project-asset-candidate'
                : selectedAsset.source
        : 'missing';
    const assetDecisionSource = resolveAssetDecisionSource(selectionMode);
    const requiresModelAssetDecision = assetDecisionSource === 'heuristic-candidate';
    const readiness: MainImageAssetSelectionReadiness = blockers.length > 0
        ? 'blocked'
        : selectedAsset
            ? 'ready'
            : 'needs_context';
    const preflightGate = readiness === 'blocked'
        ? 'blocked'
        : readiness === 'ready'
            ? 'pass'
            : 'needs_input';

    const limitations = [
        '当前素材选择只基于路径、文件名、角色、尺寸和上下文来源，不做真实视觉审美判断。',
        '没有模型视觉分析、主体检测和截图验收时，不能声明素材已经选对或设计质量通过。',
        '当前文档 fallback 只能证明 Photoshop 有活动上下文，不等于项目素材已被正确导入。'
    ];
    if (requiresModelAssetDecision) {
        limitations.push('当前素材只是规则排序出的候选，最终主图素材需要模型 Agent 或用户选择确认。');
    }

    return {
        readiness,
        preflightGate,
        selectionMode,
        assetDecisionSource,
        requiresModelAssetDecision,
        selectedAsset,
        candidates: candidates.slice(0, 8),
        candidateCount: candidates.length,
        blockers,
        warnings,
        limitations,
        evidence: [{
            source: 'main-image-asset-selection',
            summary: selectedAsset
                ? `素材门禁 ${preflightGate}：${selectedAsset.name || selectedAsset.path || 'unknown'}，mode=${selectionMode}，decisionSource=${assetDecisionSource}，score=${Math.round(selectedAsset.score)}。`
                : '素材门禁 needs_input：没有可用素材候选。',
            status: evidenceStatusFromReadiness(readiness)
        }]
    };
}

export function buildMainImageCandidatePreflightPlan(input: MainImageCandidatePreflightInput): MainImageCandidatePreflightPlan {
    const assetSelection = selectMainImageAssetCandidate(input);
    const enabled = isVisionPreflightEnabled(input.enableVisionPreflight);
    const maxVisionCandidates = toBoundedPositiveInteger(input.maxVisionCandidates, 1, 1, 3);
    const candidates = assetSelection.candidates;
    const selectedCandidate = assetSelection.selectedAsset;
    const blockers = [...assetSelection.blockers];
    const warnings = [...assetSelection.warnings];
    const limitations = [
        ...assetSelection.limitations,
        '候选预检只负责整理项目素材上下文，不做批量视觉理解，也不改变 Photoshop 写入参数。',
        '未显式启用视觉预检时，只输出 metadata-only 证据，不调用模型。',
        '显式启用视觉预检时默认只分析排序最高的一张候选，避免隐藏成本和长时间等待。',
        '规则排序不能替代模型 Agent 对主体、款式、卖点和画面适配度的素材判断。'
    ];

    if (!selectedCandidate) {
        return {
            status: 'needs_asset',
            enabled,
            maxVisionCandidates,
            shouldCallAnalyzer: false,
            shouldAnalyzePaths: [],
            assetSelection,
            candidates,
            candidateCount: assetSelection.candidateCount,
            blockers,
            warnings: [
                ...warnings,
                '没有可用候选图，无法进入主图素材视觉预检。'
            ],
            limitations,
            evidence: [{
                source: 'main-image-candidate-preflight',
                summary: '候选预检 needs_asset：缺少显式素材、项目选中图或当前文档上下文。',
                status: 'unknown'
            }]
        };
    }

    if (blockers.length > 0) {
        return {
            status: 'blocked',
            enabled,
            maxVisionCandidates,
            shouldCallAnalyzer: false,
            shouldAnalyzePaths: [],
            assetSelection,
            selectedCandidate,
            candidates,
            candidateCount: assetSelection.candidateCount,
            blockers,
            warnings,
            limitations,
            evidence: [{
                source: 'main-image-candidate-preflight',
                summary: `候选预检 blocked：${blockers[0] || '素材门禁阻断'}。`,
                status: 'failed'
            }]
        };
    }

    if (!enabled) {
        return {
            status: 'metadata_only',
            enabled,
            maxVisionCandidates,
            shouldCallAnalyzer: false,
            shouldAnalyzePaths: [],
            assetSelection,
            selectedCandidate,
            candidates,
            candidateCount: assetSelection.candidateCount,
            blockers,
            warnings: [
                ...warnings,
                '主图视觉预检未显式启用，保持 metadata-only。'
            ],
            limitations,
            evidence: [{
                source: 'main-image-candidate-preflight',
                summary: `候选预检 metadata_only：已选 ${selectedCandidate.name || selectedCandidate.path || 'unknown'}，不调用视觉模型。`,
                status: 'needs_review'
            }]
        };
    }

    if (input.hasAnalyzer === false) {
        return {
            status: 'blocked',
            enabled,
            maxVisionCandidates,
            shouldCallAnalyzer: false,
            shouldAnalyzePaths: [],
            assetSelection,
            selectedCandidate,
            candidates,
            candidateCount: assetSelection.candidateCount,
            blockers: [
                ...blockers,
                '当前运行环境没有 analyzeAssetContent 能力，不能执行视觉预检。'
            ],
            warnings,
            limitations,
            evidence: [{
                source: 'main-image-candidate-preflight',
                summary: '候选预检 blocked：缺少 analyzeAssetContent。',
                status: 'failed'
            }]
        };
    }

    const shouldAnalyzePaths = candidates
        .filter((candidate) => candidate.isImageLike && candidate.path)
        .slice(0, maxVisionCandidates)
        .map((candidate) => candidate.path!)
        .filter(Boolean);

    if (shouldAnalyzePaths.length === 0) {
        return {
            status: 'needs_asset',
            enabled,
            maxVisionCandidates,
            shouldCallAnalyzer: false,
            shouldAnalyzePaths: [],
            assetSelection,
            selectedCandidate,
            candidates,
            candidateCount: assetSelection.candidateCount,
            blockers,
            warnings: [
                ...warnings,
                '候选素材没有可传给视觉模型的图片路径。'
            ],
            limitations,
            evidence: [{
                source: 'main-image-candidate-preflight',
                summary: '候选预检 needs_asset：候选存在，但没有可分析路径。',
                status: 'unknown'
            }]
        };
    }

    return {
        status: 'ready_to_analyze',
        enabled,
        maxVisionCandidates,
        shouldCallAnalyzer: true,
        shouldAnalyzePaths,
        assetSelection,
        selectedCandidate,
        candidates,
        candidateCount: assetSelection.candidateCount,
        blockers,
        warnings,
        limitations,
        evidence: [{
            source: 'main-image-candidate-preflight',
            summary: `候选预检 ready_to_analyze：准备分析 ${shouldAnalyzePaths.length} 张，首选 ${selectedCandidate.name || selectedCandidate.path || 'unknown'}。`,
            status: 'ready'
        }]
    };
}
