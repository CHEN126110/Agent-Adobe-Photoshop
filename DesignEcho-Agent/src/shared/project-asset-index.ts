import type { EvidenceRef } from './design-agent-os-contracts';
import type { ProjectVisualInsightCacheReadResult } from './project-visual-insight-cache';
import type { ProjectVisualSamplingPlan } from './project-visual-sampling';

export type ProjectAssetIndexVersion = 'project-asset-index/v0';
export type ContextSnapshotVersion = 'context-snapshot/v0';

export type ProjectAssetFolderRole =
    | 'psd'
    | 'sku'
    | 'main-image'
    | 'main-image-video'
    | 'source'
    | 'detail'
    | 'template'
    | 'config'
    | 'metadata'
    | 'archive'
    | 'unknown';

export type ProjectAssetRole =
    | 'raw-model-wear'
    | 'raw-product-still'
    | 'raw-detail-closeup'
    | 'color-single'
    | 'main-image-output'
    | 'sku-output'
    | 'detail-page-slice'
    | 'template'
    | 'psd'
    | 'config'
    | 'archive'
    | 'unknown';

export type ProjectAssetReadiness =
    | 'ready_for_candidate_selection'
    | 'needs_visual_sampling'
    | 'needs_assets'
    | 'unknown';

export interface ProjectAssetIndexFileInput {
    path: string;
    relativePath?: string;
    name?: string;
    extension?: string;
    sizeBytes?: number;
    width?: number;
    height?: number;
    folderRole?: ProjectAssetFolderRole | string;
}

export interface ProjectAssetIndexProjectConfig {
    projectName?: string;
    projectPath?: string;
    folderMappings?: Record<string, string>;
}

export interface ProjectAssetSkuConfigRow {
    template: string;
    combo: string;
    colors: string[];
}

export interface ProjectAssetIndexInput {
    projectPath?: string;
    projectName?: string;
    folderMappings?: Record<string, string>;
    files: ProjectAssetIndexFileInput[];
    skuConfigRows?: ProjectAssetSkuConfigRow[];
}

export interface ProjectAssetIndexAsset {
    id: string;
    path: string;
    relativePath: string;
    name: string;
    extension: string;
    sizeBytes?: number;
    width?: number;
    height?: number;
    aspectRatio?: number;
    folderRole: ProjectAssetFolderRole;
    role: ProjectAssetRole;
    colorName?: string;
    comboColors: string[];
    isImage: boolean;
    isDesignDocument: boolean;
    isOutput: boolean;
    needsVision: boolean;
    confidence: number;
    reasons: string[];
    evidence: EvidenceRef[];
}

export interface ProjectAssetIndexVisionCandidate {
    assetId: string;
    path: string;
    role: ProjectAssetRole;
    reason: string;
    priority: number;
}

export interface ProjectAssetSkillReadiness {
    skill: 'main-image' | 'detail-page' | 'sku';
    status: ProjectAssetReadiness;
    candidateCount: number;
    blockers: string[];
    warnings: string[];
}

export interface ProjectAssetIndexSummary {
    totalFiles: number;
    totalImages: number;
    totalDesignDocuments: number;
    roleCounts: Record<ProjectAssetRole, number>;
    folderRoleCounts: Record<ProjectAssetFolderRole, number>;
    extensionCounts: Record<string, number>;
    colorNames: string[];
    skuConfigCount: number;
}

export interface ProjectAssetIndex {
    indexVersion: ProjectAssetIndexVersion;
    projectName?: string;
    projectPath?: string;
    generatedFrom: 'file-metadata';
    summary: ProjectAssetIndexSummary;
    assets: ProjectAssetIndexAsset[];
    representativeSamples: Record<ProjectAssetRole, string[]>;
    visionCandidates: ProjectAssetIndexVisionCandidate[];
    skillReadiness: ProjectAssetSkillReadiness[];
    warnings: string[];
    limitations: string[];
    evidence: EvidenceRef[];
}

export interface ContextSnapshotInput {
    projectPath?: string;
    projectName?: string;
    currentDocument?: {
        id?: string | number;
        name?: string;
        path?: string;
        width?: number;
        height?: number;
        hasUnsavedChanges?: boolean;
    } | null;
    selectedAssetPaths?: string[];
    userConstraints?: string[];
    taskHistory?: string[];
    unverifiedItems?: string[];
    assetIndex?: ProjectAssetIndex;
    visualSamplingPlan?: ProjectVisualSamplingPlan;
    visualInsightCache?: ProjectVisualInsightCacheReadResult;
}

export interface ContextSnapshot {
    snapshotVersion: ContextSnapshotVersion;
    project: {
        path?: string;
        name?: string;
    };
    currentDocument?: ContextSnapshotInput['currentDocument'];
    selectedAssetPaths: string[];
    userConstraints: string[];
    taskHistory: string[];
    unverifiedItems: string[];
    assetIndex?: ProjectAssetIndex;
    visualSamplingPlan?: ProjectVisualSamplingPlan;
    visualInsightCache?: ProjectVisualInsightCacheReadResult;
    readiness: ProjectAssetReadiness;
    warnings: string[];
    limitations: string[];
    evidence: EvidenceRef[];
}

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.bmp', '.gif']);
const DESIGN_DOCUMENT_EXTENSIONS = new Set(['.psd', '.psb', '.ai', '.pdf']);
const CONFIG_EXTENSIONS = new Set(['.json', '.csv', '.txt', '.md']);
const ARCHIVE_EXTENSIONS = new Set(['.zip', '.rar', '.7z']);
const COLOR_WORDS = [
    '白色',
    '米白',
    '黑色',
    '粉色',
    '浅粉',
    '橘粉',
    '浅绿',
    '草绿',
    '天空蓝',
    '冰川灰',
    '奶油黄',
    '紫色',
    '灰色',
    '蓝',
    '绿',
    '黄',
    '白',
    '黑',
    '粉',
    '紫'
];

function normalizeText(value: unknown): string {
    return String(value || '').trim();
}

function normalizePath(value: string): string {
    return normalizeText(value).replace(/\\/g, '/');
}

function basename(filePath: string): string {
    return normalizePath(filePath).split('/').filter(Boolean).pop() || normalizePath(filePath);
}

function extensionOf(filePath: string, explicit?: string): string {
    const value = normalizeText(explicit).toLowerCase();
    if (value) return value.startsWith('.') ? value : `.${value}`;
    const name = basename(filePath);
    const dotIndex = name.lastIndexOf('.');
    return dotIndex >= 0 ? name.slice(dotIndex).toLowerCase() : '';
}

function pathParts(relativePath: string): string[] {
    return normalizePath(relativePath).split('/').filter(Boolean);
}

function normalizeFolderRole(value: unknown): ProjectAssetFolderRole {
    const text = normalizeText(value);
    if (!text) return 'unknown';
    if (/^psd$/i.test(text)) return 'psd';
    if (/^sku$/i.test(text)) return 'sku';
    if (/mainImage|main-image|主图/.test(text)) return 'main-image';
    if (/video|主图视频/.test(text)) return 'main-image-video';
    if (/source|素材|原图|images/i.test(text)) return 'source';
    if (/detail|详情/.test(text)) return 'detail';
    if (/template|模板/.test(text)) return 'template';
    if (/config|配置/.test(text)) return 'config';
    if (/metadata|designecho/i.test(text)) return 'metadata';
    if (/archive|zip|压缩/.test(text)) return 'archive';
    return 'unknown';
}

function inferFolderRole(file: ProjectAssetIndexFileInput, folderMappings: Record<string, string>): ProjectAssetFolderRole {
    const explicit = normalizeFolderRole(file.folderRole);
    if (explicit !== 'unknown') return explicit;

    const relativePath = normalizePath(file.relativePath || file.path);
    const parts = pathParts(relativePath);
    for (let index = parts.length - 1; index >= 0; index -= 1) {
        const part = parts[index];
        const mapped = folderMappings[part] || folderMappings[parts.slice(0, index + 1).join('/')];
        const mappedRole = normalizeFolderRole(mapped);
        if (mappedRole !== 'unknown') return mappedRole;
    }

    const joined = parts.join('/');
    if (joined.includes('.designecho')) return 'metadata';
    if (joined.includes('PSD')) return 'psd';
    if (joined.includes('SKU')) return 'sku';
    if (joined.includes('主图视频')) return 'main-image-video';
    if (joined.includes('主图')) return 'main-image';
    if (joined.includes('模板文件')) return 'template';
    if (joined.includes('配置文件')) return 'config';
    if (joined.includes('images') || joined.includes('C82602')) return 'source';
    return 'unknown';
}

function detectColorName(name: string): string | undefined {
    const stem = name.replace(/\.[^.]+$/, '');
    const exact = COLOR_WORDS.find((color) => stem === color || stem.includes(color));
    return exact;
}

function parseComboColors(name: string): string[] {
    const stem = name.replace(/\.[^.]+$/, '');
    if (!/[+＋]/.test(stem)) return [];
    return stem.split(/[+＋]/).map((item) => item.replace(/^\d+/, '').trim()).filter(Boolean);
}

function inferImageRole(input: {
    file: ProjectAssetIndexFileInput;
    extension: string;
    folderRole: ProjectAssetFolderRole;
    name: string;
    relativePath: string;
    width?: number;
    height?: number;
    colorName?: string;
    comboColors: string[];
}): { role: ProjectAssetRole; reasons: string[]; confidence: number } {
    const reasons: string[] = [];
    const { extension, folderRole, name, relativePath, width, height, colorName, comboColors } = input;
    const lowerPath = relativePath.toLowerCase();

    if (DESIGN_DOCUMENT_EXTENSIONS.has(extension)) {
        return { role: 'psd', reasons: ['design document extension'], confidence: 0.96 };
    }
    if (ARCHIVE_EXTENSIONS.has(extension)) {
        return { role: 'archive', reasons: ['archive extension'], confidence: 0.95 };
    }
    if (CONFIG_EXTENSIONS.has(extension)) {
        return { role: 'config', reasons: ['config extension'], confidence: 0.9 };
    }
    if (!IMAGE_EXTENSIONS.has(extension)) {
        return { role: 'unknown', reasons: ['unsupported extension'], confidence: 0.2 };
    }

    if (folderRole === 'template') {
        return { role: 'template', reasons: ['template folder'], confidence: 0.95 };
    }
    if (folderRole === 'sku') {
        reasons.push('SKU folder');
        if (comboColors.length) reasons.push('filename contains color combo');
        return { role: 'sku-output', reasons, confidence: comboColors.length ? 0.95 : 0.88 };
    }
    if (folderRole === 'main-image') {
        return { role: 'main-image-output', reasons: ['main image folder'], confidence: 0.92 };
    }
    if (/详情页[_-]?\d+/.test(name) || lowerPath.includes('/images/')) {
        return { role: 'detail-page-slice', reasons: ['detail page slice naming or images folder'], confidence: 0.86 };
    }
    if (colorName) {
        return { role: 'color-single', reasons: [`color name detected: ${colorName}`], confidence: 0.88 };
    }
    if (/^YYC[_-]\d+/i.test(name)) {
        return { role: 'raw-model-wear', reasons: ['camera sequence YYC, likely model wearing shot'], confidence: 0.74 };
    }
    if (/^ZQL[_-]\d+/i.test(name)) {
        const tall = Number(width) > 0 && Number(height) > 0 && Number(height) > Number(width) * 1.2;
        return {
            role: tall ? 'raw-detail-closeup' : 'raw-product-still',
            reasons: [tall ? 'camera sequence ZQL with tall crop' : 'camera sequence ZQL product still'],
            confidence: tall ? 0.62 : 0.7
        };
    }
    if (folderRole === 'source') {
        return { role: 'raw-product-still', reasons: ['source folder image without stronger evidence'], confidence: 0.55 };
    }
    return { role: 'unknown', reasons: ['no reliable project role evidence'], confidence: 0.3 };
}

function createEmptyRoleCounts(): Record<ProjectAssetRole, number> {
    return {
        'raw-model-wear': 0,
        'raw-product-still': 0,
        'raw-detail-closeup': 0,
        'color-single': 0,
        'main-image-output': 0,
        'sku-output': 0,
        'detail-page-slice': 0,
        template: 0,
        psd: 0,
        config: 0,
        archive: 0,
        unknown: 0
    };
}

function createEmptyFolderRoleCounts(): Record<ProjectAssetFolderRole, number> {
    return {
        psd: 0,
        sku: 0,
        'main-image': 0,
        'main-image-video': 0,
        source: 0,
        detail: 0,
        template: 0,
        config: 0,
        metadata: 0,
        archive: 0,
        unknown: 0
    };
}

function increment<T extends string>(target: Record<T, number>, key: T): void {
    target[key] = (target[key] || 0) + 1;
}

function isOutputRole(role: ProjectAssetRole): boolean {
    return role === 'main-image-output' || role === 'sku-output' || role === 'detail-page-slice';
}

function shouldNeedVision(role: ProjectAssetRole): boolean {
    return role === 'raw-model-wear'
        || role === 'raw-product-still'
        || role === 'raw-detail-closeup'
        || role === 'color-single'
        || role === 'unknown';
}

function buildVisionCandidates(assets: ProjectAssetIndexAsset[]): ProjectAssetIndexVisionCandidate[] {
    const rolePriority: Record<ProjectAssetRole, number> = {
        'raw-model-wear': 100,
        'raw-product-still': 90,
        'raw-detail-closeup': 80,
        'color-single': 70,
        'main-image-output': 30,
        'detail-page-slice': 20,
        'sku-output': 10,
        template: 0,
        psd: 0,
        config: 0,
        archive: 0,
        unknown: 40
    };
    return assets
        .filter((asset) => asset.isImage && asset.needsVision && !asset.isOutput)
        .sort((left, right) => {
            const priorityDiff = (rolePriority[right.role] || 0) - (rolePriority[left.role] || 0);
            if (priorityDiff !== 0) return priorityDiff;
            return right.confidence - left.confidence;
        })
        .map((asset) => ({
            assetId: asset.id,
            path: asset.path,
            role: asset.role,
            reason: `${asset.role} 需要视觉模型确认产品、场景、细节或可用性。`,
            priority: rolePriority[asset.role] || 0
        }))
        .slice(0, 12);
}

function sampleByRole(assets: ProjectAssetIndexAsset[]): Record<ProjectAssetRole, string[]> {
    const samples: Record<ProjectAssetRole, string[]> = {
        'raw-model-wear': [],
        'raw-product-still': [],
        'raw-detail-closeup': [],
        'color-single': [],
        'main-image-output': [],
        'sku-output': [],
        'detail-page-slice': [],
        template: [],
        psd: [],
        config: [],
        archive: [],
        unknown: []
    };
    for (const asset of assets) {
        if (samples[asset.role].length < 6) {
            samples[asset.role].push(asset.relativePath);
        }
    }
    return samples;
}

function skillReadiness(assets: ProjectAssetIndexAsset[], roleCounts: Record<ProjectAssetRole, number>): ProjectAssetSkillReadiness[] {
    const mainImageCandidates = roleCounts['raw-model-wear'] + roleCounts['raw-product-still'] + roleCounts['color-single'];
    const detailCandidates = roleCounts['raw-detail-closeup'] + roleCounts['raw-model-wear'] + roleCounts['raw-product-still'] + roleCounts['color-single'];
    const skuCandidates = roleCounts['color-single'] + roleCounts['sku-output'];
    const imageCount = assets.filter((asset) => asset.isImage).length;
    return [
        {
            skill: 'main-image',
            status: mainImageCandidates > 0 ? 'needs_visual_sampling' : imageCount > 0 ? 'unknown' : 'needs_assets',
            candidateCount: mainImageCandidates,
            blockers: imageCount > 0 ? [] : ['项目中没有可用图片素材。'],
            warnings: mainImageCandidates > 0 ? ['主图候选需要视觉模型或人工确认，不能只凭文件名决定。'] : []
        },
        {
            skill: 'detail-page',
            status: detailCandidates > 0 || roleCounts['detail-page-slice'] > 0 ? 'needs_visual_sampling' : imageCount > 0 ? 'unknown' : 'needs_assets',
            candidateCount: detailCandidates + roleCounts['detail-page-slice'],
            blockers: imageCount > 0 ? [] : ['项目中没有可用图片素材。'],
            warnings: ['详情页需要区分原始素材和已有详情页切图，避免把成品切图当作原始拍摄素材。']
        },
        {
            skill: 'sku',
            status: skuCandidates > 0 ? 'ready_for_candidate_selection' : imageCount > 0 ? 'unknown' : 'needs_assets',
            candidateCount: skuCandidates,
            blockers: imageCount > 0 ? [] : ['项目中没有可用图片素材。'],
            warnings: roleCounts['sku-output'] > 0 ? ['项目已有 SKU 成品图；生成新 SKU 前需要确认是复用、更新还是重新生成。'] : []
        }
    ];
}

function uniqueSorted(values: string[]): string[] {
    return Array.from(new Set(values.map(normalizeText).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

export function parseSkuConfigCsv(text: string): ProjectAssetSkuConfigRow[] {
    return normalizeText(text)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(1)
        .map((line) => {
            const [template, combo] = line.split(',');
            const normalizedCombo = normalizeText(combo);
            return {
                template: normalizeText(template),
                combo: normalizedCombo,
                colors: normalizedCombo.split(/[+|＋]/).map((item) => item.trim()).filter(Boolean)
            };
        })
        .filter((row) => row.template && row.combo);
}

export function buildProjectAssetIndex(input: ProjectAssetIndexInput): ProjectAssetIndex {
    const folderMappings = input.folderMappings || {};
    const roleCounts = createEmptyRoleCounts();
    const folderRoleCounts = createEmptyFolderRoleCounts();
    const extensionCounts: Record<string, number> = {};
    const warnings: string[] = [];
    const assets = input.files.map((file, index) => {
        const normalizedPath = normalizePath(file.path);
        const relativePath = normalizePath(file.relativePath || file.path);
        const name = normalizeText(file.name) || basename(normalizedPath);
        const extension = extensionOf(name || normalizedPath, file.extension);
        const folderRole = inferFolderRole(file, folderMappings);
        const width = Number(file.width) > 0 ? Math.round(Number(file.width)) : undefined;
        const height = Number(file.height) > 0 ? Math.round(Number(file.height)) : undefined;
        const aspectRatio = width && height ? Number((width / height).toFixed(4)) : undefined;
        const colorName = detectColorName(name);
        const comboColors = parseComboColors(name);
        const inferred = inferImageRole({ file, extension, folderRole, name, relativePath, width, height, colorName, comboColors });
        const isImage = IMAGE_EXTENSIONS.has(extension);
        const isDesignDocument = DESIGN_DOCUMENT_EXTENSIONS.has(extension);
        const asset: ProjectAssetIndexAsset = {
            id: `asset-${index + 1}`,
            path: normalizedPath,
            relativePath,
            name,
            extension,
            sizeBytes: Number(file.sizeBytes) > 0 ? Number(file.sizeBytes) : undefined,
            width,
            height,
            aspectRatio,
            folderRole,
            role: inferred.role,
            colorName,
            comboColors,
            isImage,
            isDesignDocument,
            isOutput: isOutputRole(inferred.role),
            needsVision: shouldNeedVision(inferred.role),
            confidence: inferred.confidence,
            reasons: inferred.reasons,
            evidence: [{
                source: 'project-asset-index',
                summary: `${relativePath} classified as ${inferred.role}; reasons=${inferred.reasons.join(' / ') || 'none'}`,
                status: inferred.confidence >= 0.75 ? 'needs_review' : 'unknown',
                confidence: inferred.confidence
            }]
        };
        increment(roleCounts, asset.role);
        increment(folderRoleCounts, asset.folderRole);
        extensionCounts[extension || '(none)'] = (extensionCounts[extension || '(none)'] || 0) + 1;
        return asset;
    });

    if (assets.length === 0) warnings.push('项目素材索引没有收到任何文件。');
    if (!assets.some((asset) => asset.role === 'raw-model-wear' || asset.role === 'raw-product-still' || asset.role === 'color-single')) {
        warnings.push('未发现明确原始素材或颜色单品，业务 skill 选择需要补充上下文。');
    }
    if (assets.some((asset) => asset.role === 'main-image-output' || asset.role === 'sku-output' || asset.role === 'detail-page-slice')) {
        warnings.push('项目包含成品图；后续执行需要区分“参考成品”和“可编辑原始素材”。');
    }

    const colorNames = uniqueSorted(assets.map((asset) => asset.colorName || '').filter(Boolean));
    const totalImages = assets.filter((asset) => asset.isImage).length;
    const index: ProjectAssetIndex = {
        indexVersion: 'project-asset-index/v0',
        projectName: input.projectName,
        projectPath: input.projectPath ? normalizePath(input.projectPath) : undefined,
        generatedFrom: 'file-metadata',
        summary: {
            totalFiles: assets.length,
            totalImages,
            totalDesignDocuments: assets.filter((asset) => asset.isDesignDocument).length,
            roleCounts,
            folderRoleCounts,
            extensionCounts,
            colorNames,
            skuConfigCount: input.skuConfigRows?.length || 0
        },
        assets,
        representativeSamples: sampleByRole(assets),
        visionCandidates: buildVisionCandidates(assets),
        skillReadiness: skillReadiness(assets, roleCounts),
        warnings,
        limitations: [
            'ProjectAssetIndex 只使用目录、文件名、尺寸、扩展名和配置证据。',
            'ProjectAssetIndex 不做审美判断，不声明最佳主图、最佳详情页或最佳 SKU。',
            '没有视觉模型或人工确认时，不能编造款式、场景、材质、卖点或图片用途。',
            '视觉模型应按候选抽样调用，不应默认批量分析全项目图片。'
        ],
        evidence: [{
            source: 'project-asset-index',
            summary: `Indexed ${assets.length} files, ${totalImages} images, ${roleCounts['main-image-output']} main-image outputs, ${roleCounts['sku-output']} SKU outputs.`,
            status: assets.length > 0 ? 'needs_review' : 'unknown'
        }]
    };
    return index;
}

export function buildContextSnapshot(input: ContextSnapshotInput): ContextSnapshot {
    const assetIndex = input.assetIndex;
    const visualSamplingPlan = input.visualSamplingPlan;
    const visualInsightCache = input.visualInsightCache;
    const warnings = [
        ...(assetIndex?.warnings || []),
        ...(visualSamplingPlan?.warnings || []),
        ...(visualInsightCache?.warnings || []),
        assetIndex ? '' : '缺少 ProjectAssetIndex，开放式设计任务不能可靠选择业务 skill。'
    ].filter(Boolean);
    let readiness: ProjectAssetReadiness = 'unknown';
    if (assetIndex && assetIndex.summary.totalImages > 0) {
        readiness = 'needs_visual_sampling';
    } else if (assetIndex) {
        readiness = 'needs_assets';
    }
    return {
        snapshotVersion: 'context-snapshot/v0',
        project: {
            path: input.projectPath ? normalizePath(input.projectPath) : assetIndex?.projectPath,
            name: input.projectName || assetIndex?.projectName
        },
        currentDocument: input.currentDocument || undefined,
        selectedAssetPaths: (input.selectedAssetPaths || []).map(normalizePath),
        userConstraints: (input.userConstraints || []).map(normalizeText).filter(Boolean),
        taskHistory: (input.taskHistory || []).map(normalizeText).filter(Boolean),
        unverifiedItems: [
            ...(input.unverifiedItems || []),
            'ProjectAssetIndex 需要后续视觉模型或人工确认候选图。',
            visualSamplingPlan ? 'VisualSamplingPlan 是候选计划，不代表已经理解图片内容。' : '',
            visualInsightCache && visualInsightCache.summary.entriesWithInsight > 0
                ? ''
                : 'VisualInsightCache 缺少可复用视觉理解，不能声明已经看懂项目图片。'
        ].map(normalizeText).filter(Boolean),
        assetIndex,
        visualSamplingPlan,
        visualInsightCache,
        readiness,
        warnings,
        limitations: [
            'ContextSnapshot 是执行前上下文证据，不是 Photoshop 执行结果。',
            'ContextSnapshot 不暴露私有模型思考，也不替代真实工具调用和验收。',
            '业务 skill 必须消费该快照后再决定是否执行。',
            visualSamplingPlan ? 'ContextSnapshot 携带的 VisualSamplingPlan 只用于限制视觉候选，不可编造视觉结论。' : '',
            visualInsightCache ? 'ContextSnapshot 携带的 VisualInsightCache 只表示已有视觉证据可复用，不代表设计质量通过。' : ''
        ].filter(Boolean),
        evidence: [
            {
                source: 'context-snapshot',
                summary: assetIndex
                    ? `snapshot includes ProjectAssetIndex with ${assetIndex.summary.totalImages} images`
                    : 'snapshot has no ProjectAssetIndex',
                status: assetIndex ? 'needs_review' : 'unknown'
            },
            visualSamplingPlan
                ? {
                    source: 'context-snapshot',
                    summary: `snapshot includes VisualSamplingPlan ${visualSamplingPlan.selectedCandidates.length}/${assetIndex?.visionCandidates.length || 0}`,
                    status: 'needs_review'
                }
                : null,
            visualInsightCache
                ? {
                    source: 'context-snapshot',
                    summary: `snapshot includes VisualInsightCache entries=${visualInsightCache.summary.totalEntries}, insights=${visualInsightCache.summary.entriesWithInsight}`,
                    status: visualInsightCache.summary.entriesWithInsight > 0 ? 'needs_review' : 'unknown'
                }
                : null
        ].filter(Boolean) as EvidenceRef[]
    };
}
