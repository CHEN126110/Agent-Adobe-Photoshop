/**
 * 从一次运行的工具日志里提取「事实类」设计内容（纯逻辑，无 IO）。
 *
 * 为什么要有它：真机 472 份运行档案里模型只在 9% 的运行里写过项目记忆，
 * 而「看过哪张图、图上有什么、Agent 实际声明了什么版面、文档叫什么、导出到哪」这些
 * 都是有唯一答案的事实——按「确定性归引擎、创造性归模型」的判据，应由 Harness
 * 记账，不该指望模型下班前想起来写。
 *
 * 两个消费者共用同一份提取结果：
 *  - design-run-fact-ledger：写进 Design Project State（跨运行的项目记忆）
 *  - agent-run-record 的 checkpoint.designSummary：续跑摘要（下一轮开工看得懂上一轮做到哪）
 *
 * 边界：只读工具日志、只提取字符串与数值、不含图像 / base64、不做任何推断；
 * 提不到就不记，不臆造。
 */

export interface DesignRunToolLogEntryLike {
    name?: unknown;
    arguments?: unknown;
    result?: unknown;
    origin?: unknown;
}

export interface DesignRunObservedAsset {
    /** 原始路径（保持大小写与分隔符；去重时另行归一） */
    path: string;
    /** 视觉分析得到的主体 / 拍摄形态 / 主体占比 / 适用性，一句话 */
    observation?: string;
    /** 视觉分析判定的素材本质：原始素材 / 已完成设计成品 */
    assetNature?: 'raw_photo' | 'finished_design';
    /** 分析里的粗分类文本（原样保留，供调用方映射） */
    categoryText?: string;
    /** 图上真实可见、可支撑卖点的观察（不含推断） */
    sellingPointObservations: string[];
    /** 本次运行是否把它置入 / 用作版面主体 */
    usedInLayout: boolean;
}

export interface DesignRunSelectedAsset {
    path: string;
    role: string;
    source: 'subject' | 'layout_region' | 'background';
    evidenceStatus: 'matched_observed_candidate' | 'not_observed_in_run';
}

export interface DesignRunMaterialSelectionTrace {
    version: 'material-selection-trace/v1';
    selectedAssets: DesignRunSelectedAsset[];
    modelAuthoredReason?: string;
    explanationStatus: 'provided' | 'missing';
    currentRunCandidateEvidence: {
        status: 'visually_compared' | 'not_available';
        comparedPaths: string[];
        evidenceIds: string[];
    };
    observationStatus:
        | 'selection_recorded'
        | 'selection_without_explanation'
        | 'insufficient_evidence'
        | 'no_asset_selected';
    boundaries: {
        rankingDoesNotSelectWinner: true;
        doesNotRejectUnmatchedAsset: true;
        modelReasonDoesNotProveChoiceIsGood: true;
        doesNotRequireDifferentAsset: true;
    };
}

export interface DesignRunLayoutFact {
    /** 从 Agent 显式声明的 regions / blocks 生成的事实签名，不是 Harness 设计配方。 */
    layoutSignature: string;
    headline: string[];
    subline?: string;
    subjectPath?: string;
    selectedAssets: Array<Pick<DesignRunSelectedAsset, 'path' | 'role' | 'source'>>;
    materialSelectionReason?: string;
    stageGroupName?: string;
    documentName?: string;
}

export interface DesignRunDocumentFacts {
    created?: { name?: string; width?: number; height?: number; preset?: string };
    /** 最后一次读到 / 切到的文档名 */
    lastDocumentName?: string;
}

export interface DesignRunToolLogFacts {
    assets: DesignRunObservedAsset[];
    layouts: DesignRunLayoutFact[];
    materialSelections: DesignRunMaterialSelectionTrace[];
    document: DesignRunDocumentFacts;
    /** 成功写入的文字内容（去重、≤8 条） */
    textContents: string[];
    /** 成功导出 / 保存得到的文件路径 */
    deliveryFiles: string[];
    successfulMutationCount: number;
    /** 模型这次运行里是否已经自己写过项目状态 */
    modelUpdatedProjectState: boolean;
}

const MAX_ASSETS = 24;
const MAX_TEXTS = 8;
const MAX_DELIVERY_FILES = 12;
const MAX_SELLING_POINT_OBSERVATIONS_PER_ASSET = 4;
const MAX_TEXT_CHARS = 60;
const MAX_OBSERVATION_CHARS = 100;
const MAX_SELECTION_ASSETS = 12;
const MAX_VISUAL_CANDIDATES = 12;

const ASSET_ANALYSIS_TOOLS: ReadonlySet<string> = new Set(['analyzeAssetContent']);
const PLACEMENT_TOOLS: ReadonlySet<string> = new Set(['placeImage', 'replaceLayerContent', 'replaceImagePlaceholder', 'replaceSmartObjectContents']);
const EXPORT_TOOLS: ReadonlySet<string> = new Set([
    'quickExport',
    'exportGroup',
    'saveDocument',
    'batchExport',
    'exportMainImageDocuments',
    'exportDetailPageSlices',
    'exportToSkuDir',
    'exportWhiteBgFromSkuMaterial'
]);
const TEXT_WRITE_TOOLS: ReadonlySet<string> = new Set(['createTextLayer', 'setTextContent', 'replaceTextPlaceholder']);
const MUTATION_TOOLS: ReadonlySet<string> = new Set([
    ...PLACEMENT_TOOLS,
    ...TEXT_WRITE_TOOLS,
    'composeDesign',
    'renderLayout',
    'createDocument',
    'setTextStyle',
    'batchRenderTemplate',
    'createSkuPlaceholders'
]);
const FILE_PATH_PATTERN = /\.(?:psd|psb|png|jpe?g|webp|tiff?|gif|bmp|pdf|svg)$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value: unknown, maxLength: number): string {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…` : text;
}

function firstString(...values: unknown[]): string {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
}

function firstNumber(...values: unknown[]): number | undefined {
    for (const value of values) {
        const numeric = typeof value === 'number' ? value : Number(value);
        if (Number.isFinite(numeric) && numeric > 0) return Math.round(numeric);
    }
    return undefined;
}

export function normalizeAssetPathKey(value: unknown): string {
    return String(value || '').trim().replace(/\\/g, '/').toLowerCase();
}

export function assetPathBasename(value: unknown): string {
    const normalized = String(value || '').trim().replace(/\\/g, '/');
    const segments = normalized.split('/').filter(Boolean);
    return segments.length > 0 ? segments[segments.length - 1] : normalized;
}

function isSuccessful(result: unknown): boolean {
    return isRecord(result) && result.success !== false;
}

function looksLikeFilePath(value: unknown): value is string {
    return typeof value === 'string' && FILE_PATH_PATTERN.test(value.trim()) && !/^data:/i.test(value.trim());
}

function collectComposeSelectedAssets(args: Record<string, unknown>): Array<Pick<DesignRunSelectedAsset, 'path' | 'role' | 'source'>> {
    const selected = new Map<string, Pick<DesignRunSelectedAsset, 'path' | 'role' | 'source'>>();
    const add = (
        value: unknown,
        role: string,
        source: DesignRunSelectedAsset['source']
    ): void => {
        if (!looksLikeFilePath(value) || selected.size >= MAX_SELECTION_ASSETS) return;
        const path = value.trim();
        const key = normalizeAssetPathKey(path);
        if (!key || selected.has(key)) return;
        selected.set(key, { path, role: cleanText(role, 40) || source, source });
    };

    const subject = isRecord(args.subject) ? args.subject : undefined;
    add(subject?.filePath, 'subject', 'subject');
    const background = isRecord(args.background) ? args.background : undefined;
    if (background?.kind === 'asset') add(background.filePath, 'background', 'background');
    const layout = isRecord(args.layout) ? args.layout : undefined;
    const regions = Array.isArray(layout?.regions) ? layout.regions.filter(isRecord) : [];
    for (const region of regions) {
        const content = firstString(region.content);
        if (!looksLikeFilePath(content)) continue;
        add(content, firstString(region.role, region.id, 'layout-image'), 'layout_region');
    }
    return Array.from(selected.values());
}

function readVisualCandidateEvidence(result: Record<string, unknown>): {
    status: 'visually_compared' | 'not_available';
    comparedPaths: string[];
    evidenceIds: string[];
} {
    const comparedPaths: string[] = [];
    const evidenceIds: string[] = [];
    const seen = new Set<string>();
    const addEvidence = (filePath: string, evidenceId: unknown): void => {
        const key = normalizeAssetPathKey(filePath);
        if (!looksLikeFilePath(filePath) || !key || seen.has(key)) return;
        seen.add(key);
        comparedPaths.push(filePath);
        const normalizedEvidenceId = cleanText(evidenceId, 40);
        if (normalizedEvidenceId && !evidenceIds.includes(normalizedEvidenceId)) {
            evidenceIds.push(normalizedEvidenceId);
        }
    };

    // comparisonItems 是同一张候选联系表的编号清单。status=rendered 代表该图片
    // 确实出现在模型和主 Agent 收到的视觉证据中，即使它没有进入截断后的推荐短名单。
    const comparisonItems = Array.isArray(result.comparisonItems)
        ? result.comparisonItems.filter(isRecord)
        : [];
    for (const item of comparisonItems) {
        if (item.status !== 'rendered') continue;
        addEvidence(firstString(item.path), item.id);
        if (comparedPaths.length >= MAX_VISUAL_CANDIDATES) break;
    }

    const contactSheet = isRecord(result.contactSheet) ? result.contactSheet : undefined;
    const overviewItems = [
        ...(Array.isArray(contactSheet?.items) ? contactSheet.items.filter(isRecord) : []),
        ...(Array.isArray(result.items) ? result.items.filter(isRecord) : [])
    ];
    for (const item of overviewItems) {
        if (item.status !== 'rendered') continue;
        addEvidence(firstString(item.path), item.id);
        if (comparedPaths.length >= MAX_VISUAL_CANDIDATES) break;
    }

    const recommendations = Array.isArray(result.recommendations)
        ? result.recommendations.filter(isRecord)
        : [];
    for (const recommendation of recommendations) {
        if (recommendation.visualObserved !== true) continue;
        const file = isRecord(recommendation.file) ? recommendation.file : undefined;
        const filePath = firstString(file?.path, recommendation.path);
        addEvidence(filePath, recommendation.visualEvidenceId);
        if (comparedPaths.length >= MAX_VISUAL_CANDIDATES) break;
    }
    return {
        status: comparedPaths.length > 0 ? 'visually_compared' : 'not_available',
        comparedPaths,
        evidenceIds
    };
}

const SHOT_TYPE_LABELS: Record<string, string> = {
    flat_lay: '平铺',
    on_model: '模特上身',
    detail_closeup: '细节特写',
    package: '包装',
    chart: '色卡/图表',
    scene: '场景'
};

const COVERAGE_LABELS: Record<string, string> = {
    dominant: '主体占画面大',
    moderate: '主体占画面中等',
    small: '主体占画面小'
};

const SUITABILITY_LABELS: Record<string, string> = {
    suitable: '适合突出商品',
    marginal: '突出商品勉强',
    unsuitable: '不适合突出商品'
};

function describeAssetAnalysis(analysis: Record<string, unknown>): string {
    const parts = [
        cleanText(analysis.mainSubject, 30),
        SHOT_TYPE_LABELS[String(analysis.shotType || '')] || '',
        COVERAGE_LABELS[String(analysis.subjectCoverageRatio || '')] || '',
        SUITABILITY_LABELS[String(analysis.mainImageSuitability || '')] || '',
        analysis.assetNature === 'finished_design' ? '已是设计成品（不当原始素材）' : ''
    ].filter(Boolean);
    return cleanText(parts.join('；'), MAX_OBSERVATION_CHARS);
}

function readAssetNature(value: unknown): DesignRunObservedAsset['assetNature'] {
    if (value === 'raw_photo' || value === 'finished_design') return value;
    return undefined;
}

function upsertAsset(
    assets: Map<string, DesignRunObservedAsset>,
    path: string,
    patch: Partial<DesignRunObservedAsset>
): void {
    const key = normalizeAssetPathKey(path);
    if (!key) return;
    const existing = assets.get(key);
    if (existing) {
        if (patch.observation && !existing.observation) existing.observation = patch.observation;
        if (patch.assetNature && !existing.assetNature) existing.assetNature = patch.assetNature;
        if (patch.categoryText && !existing.categoryText) existing.categoryText = patch.categoryText;
        if (patch.sellingPointObservations && patch.sellingPointObservations.length > 0 && existing.sellingPointObservations.length === 0) {
            existing.sellingPointObservations = patch.sellingPointObservations;
        }
        if (patch.usedInLayout) existing.usedInLayout = true;
        return;
    }
    if (assets.size >= MAX_ASSETS) return;
    assets.set(key, {
        path,
        observation: patch.observation,
        assetNature: patch.assetNature,
        categoryText: patch.categoryText,
        sellingPointObservations: patch.sellingPointObservations || [],
        usedInLayout: Boolean(patch.usedInLayout)
    });
}

function collectDeliveryPaths(result: Record<string, unknown>, into: Set<string>): void {
    const visit = (value: unknown, depth: number): void => {
        if (into.size >= MAX_DELIVERY_FILES || depth > 3) return;
        if (looksLikeFilePath(value)) {
            into.add(value.trim());
            return;
        }
        if (Array.isArray(value)) {
            for (const item of value) visit(item, depth + 1);
            return;
        }
        if (isRecord(value)) {
            for (const key of ['outputPath', 'path', 'filePath', 'savedPath', 'exportedPath', 'exportedFiles', 'files', 'outputs', 'results', 'exports', 'saved']) {
                if (key in value) visit(value[key], depth + 1);
            }
        }
    };
    visit(result, 0);
}

function readFiniteNumber(value: unknown): number | undefined {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
}

function buildAgentLayoutSignature(layout: Record<string, unknown>): string {
    const regions = Array.isArray(layout.regions) ? layout.regions.filter(isRecord) : [];
    const regionParts = regions.map((region) => {
        const bounds = isRecord(region.bounds) ? region.bounds : {};
        const x = readFiniteNumber(bounds.x);
        const y = readFiniteNumber(bounds.y);
        const width = readFiniteNumber(bounds.width);
        const height = readFiniteNumber(bounds.height);
        if ([x, y, width, height].some((value) => value === undefined)) return '';
        const role = cleanText(region.role, 30) || 'region';
        return `${role}@${x?.toFixed(3)},${y?.toFixed(3)},${width?.toFixed(3)},${height?.toFixed(3)}`;
    }).filter(Boolean);
    if (regionParts.length > 0) return `regions:${regionParts.join('|')}`.slice(0, 500);

    const blocks = Array.isArray(layout.blocks) ? layout.blocks.filter(isRecord) : [];
    const blockParts = blocks.map((block) => {
        const role = cleanText(block.role, 30) || 'block';
        const heightRatio = readFiniteNumber(block.heightRatio);
        return heightRatio === undefined ? '' : `${role}@${heightRatio.toFixed(3)}`;
    }).filter(Boolean);
    return blockParts.length > 0 ? `blocks:${blockParts.join('|')}`.slice(0, 500) : '';
}

function readLayoutText(regions: Record<string, unknown>[], role: string): string[] {
    return regions
        .filter((region) => String(region.role || '').trim() === role)
        .map((region) => cleanText(region.content, MAX_TEXT_CHARS))
        .filter(Boolean)
        .slice(0, 2);
}

/**
 * 提取一次运行工具日志中的设计事实。输入可以是 Agent 的原始 toolCallLog
 * （含完整 result 对象），也可以是任何形状相似的记录；字段缺失一律跳过。
 */
export function extractDesignRunToolLogFacts(log: readonly DesignRunToolLogEntryLike[]): DesignRunToolLogFacts {
    const assets = new Map<string, DesignRunObservedAsset>();
    const layouts: DesignRunLayoutFact[] = [];
    const materialSelections: DesignRunMaterialSelectionTrace[] = [];
    const document: DesignRunDocumentFacts = {};
    const textContents = new Set<string>();
    const deliveryFiles = new Set<string>();
    let successfulMutationCount = 0;
    let modelUpdatedProjectState = false;
    let currentCandidateEvidence: DesignRunMaterialSelectionTrace['currentRunCandidateEvidence'] = {
        status: 'not_available',
        comparedPaths: [],
        evidenceIds: []
    };

    for (const entry of log) {
        const name = String(entry?.name || '').trim();
        if (!name) continue;
        const args = isRecord(entry.arguments) ? entry.arguments : {};
        const result = isRecord(entry.result) ? entry.result : {};
        const success = isSuccessful(entry.result);

        if (name === 'updateDesignProjectState' && success) {
            modelUpdatedProjectState = true;
            continue;
        }

        if ((name === 'recommendAssets'
            || name === 'analyzeProjectContactSheetOverview'
            || name === 'createProjectContactSheetOverview') && success) {
            currentCandidateEvidence = readVisualCandidateEvidence(result);
        }

        if (name === 'recommendAssets' && success) {
            const recommendations = Array.isArray(result.recommendations)
                ? result.recommendations.filter(isRecord)
                : [];
            for (const recommendation of recommendations) {
                if (recommendation.visualObserved !== true) continue;
                const file = isRecord(recommendation.file) ? recommendation.file : undefined;
                const filePath = firstString(file?.path, recommendation.path);
                if (!looksLikeFilePath(filePath)) continue;
                upsertAsset(assets, filePath, {
                    observation: cleanText(firstString(recommendation.reason, recommendation.matchReason), MAX_OBSERVATION_CHARS) || undefined,
                    assetNature: readAssetNature(recommendation.assetNature),
                    sellingPointObservations: []
                });
            }
            continue;
        }

        if (ASSET_ANALYSIS_TOOLS.has(name) && success) {
            const path = firstString(args.imagePath, args.filePath, args.path, result.imagePath, result.filePath);
            const analysis = isRecord(result.analysis) ? result.analysis : undefined;
            if (path && analysis) {
                const nature = readAssetNature(analysis.assetNature);
                const observations = nature === 'finished_design'
                    ? []
                    : (Array.isArray(analysis.sellingPointObservations) ? analysis.sellingPointObservations : [])
                        .map((item) => cleanText(item, 80))
                        .filter(Boolean)
                        .slice(0, MAX_SELLING_POINT_OBSERVATIONS_PER_ASSET);
                upsertAsset(assets, path, {
                    observation: describeAssetAnalysis(analysis),
                    assetNature: nature,
                    categoryText: cleanText(analysis.category, 40) || undefined,
                    sellingPointObservations: observations
                });
            }
            continue;
        }

        if (name === 'createDocument') {
            if (success) {
                successfulMutationCount += 1;
                document.created = {
                    name: firstString(result.documentName, result.name, args.name) || undefined,
                    width: firstNumber(result.width, args.width),
                    height: firstNumber(result.height, args.height),
                    preset: firstString(args.preset) || undefined
                };
                const createdName = document.created.name;
                if (createdName) document.lastDocumentName = createdName;
            }
            continue;
        }

        if ((name === 'switchDocument' || name === 'getDocumentInfo' || name === 'openTemplate' || name === 'openProjectFile') && success) {
            const documentInfo = isRecord(result.documentInfo) ? result.documentInfo : result;
            const documentName = firstString(documentInfo.documentName, documentInfo.name, result.documentName, args.documentName);
            if (documentName) document.lastDocumentName = documentName;
            continue;
        }

        if (name === 'renderLayout' || name === 'composeDesign') {
            if (!success) continue;
            successfulMutationCount += 1;
            const layout = name === 'composeDesign' && isRecord(args.layout) ? args.layout : args;
            const visualStyle = isRecord(layout.visualStyle) ? layout.visualStyle : undefined;
            const modelAuthored = name === 'composeDesign'
                ? String(layout.mode || '').trim() === 'agent_authored'
                : String(visualStyle?.mode || '').trim() === 'model_authored';
            const layoutSignature = modelAuthored ? buildAgentLayoutSignature(layout) : '';
            const regions = Array.isArray(layout.regions) ? layout.regions.filter(isRecord) : [];
            const subject = name === 'composeDesign' && isRecord(args.subject) ? args.subject : undefined;
            const mainImageRegion = regions.find((region) => String(region.role || '').trim() === 'main-image');
            const mainImageContent = firstString(mainImageRegion?.content);
            const selectedAssets = name === 'composeDesign'
                ? collectComposeSelectedAssets(args)
                : (looksLikeFilePath(mainImageContent)
                    ? [{ path: mainImageContent, role: 'main-image', source: 'layout_region' as const }]
                    : []);
            const subjectPath = firstString(
                subject?.filePath,
                selectedAssets.find((asset) => asset.role === 'main-image')?.path,
                selectedAssets[0]?.path
            );
            const rationale = name === 'composeDesign' && isRecord(args.rationale) ? args.rationale : undefined;
            const materialSelectionReason = cleanText(rationale?.materials, 240);
            const documentInfo = isRecord(result.documentInfo) ? result.documentInfo : undefined;
            const documentName = firstString(documentInfo?.documentName, documentInfo?.name) || document.lastDocumentName;
            if (documentName) document.lastDocumentName = documentName;
            const headline = readLayoutText(regions, 'title');
            for (const text of headline) textContents.add(text);
            const subline = readLayoutText(regions, 'subtitle')[0] || '';
            if (subline) textContents.add(subline);
            if (layoutSignature) {
                layouts.push({
                    layoutSignature,
                    headline,
                    subline: subline || undefined,
                    subjectPath: subjectPath || undefined,
                    selectedAssets,
                    materialSelectionReason: materialSelectionReason || undefined,
                    stageGroupName: firstString(result.stageGroupName, layout.groupName) || undefined,
                    documentName: documentName || undefined
                });
            }
            for (const selectedAsset of selectedAssets) {
                upsertAsset(assets, selectedAsset.path, { usedInLayout: true });
            }
            if (name === 'composeDesign') {
                const candidateKeys = new Set(currentCandidateEvidence.comparedPaths.map(normalizeAssetPathKey));
                const selectedWithEvidence: DesignRunSelectedAsset[] = selectedAssets.map((asset) => ({
                    ...asset,
                    evidenceStatus: candidateKeys.has(normalizeAssetPathKey(asset.path))
                        ? 'matched_observed_candidate'
                        : 'not_observed_in_run'
                }));
                let observationStatus: DesignRunMaterialSelectionTrace['observationStatus'];
                if (selectedWithEvidence.length === 0) observationStatus = 'no_asset_selected';
                else if (materialSelectionReason) observationStatus = 'selection_recorded';
                else if (currentCandidateEvidence.comparedPaths.length >= 2) observationStatus = 'selection_without_explanation';
                else observationStatus = 'insufficient_evidence';
                materialSelections.push({
                    version: 'material-selection-trace/v1',
                    selectedAssets: selectedWithEvidence,
                    ...(materialSelectionReason ? { modelAuthoredReason: materialSelectionReason } : {}),
                    explanationStatus: materialSelectionReason ? 'provided' : 'missing',
                    currentRunCandidateEvidence: {
                        status: currentCandidateEvidence.status,
                        comparedPaths: [...currentCandidateEvidence.comparedPaths],
                        evidenceIds: [...currentCandidateEvidence.evidenceIds]
                    },
                    observationStatus,
                    boundaries: {
                        rankingDoesNotSelectWinner: true,
                        doesNotRejectUnmatchedAsset: true,
                        modelReasonDoesNotProveChoiceIsGood: true,
                        doesNotRequireDifferentAsset: true
                    }
                });
                const documentSpec = isRecord(args.document) ? args.document : undefined;
                const canvas = isRecord(args.canvas) ? args.canvas : undefined;
                if (documentSpec?.mode === 'new' && canvas) {
                    document.created = {
                        name: firstString(documentName, documentSpec.name) || undefined,
                        width: firstNumber(canvas.width),
                        height: firstNumber(canvas.height)
                    };
                }
                collectDeliveryPaths(result, deliveryFiles);
            }
            continue;
        }

        if (PLACEMENT_TOOLS.has(name)) {
            if (!success) continue;
            successfulMutationCount += 1;
            const path = firstString(result.filePath, result.imagePath, result.selectedPath, result.sourcePath, args.filePath, args.imagePath);
            if (path && looksLikeFilePath(path)) upsertAsset(assets, path, { usedInLayout: true });
            continue;
        }

        if (TEXT_WRITE_TOOLS.has(name)) {
            if (!success) continue;
            successfulMutationCount += 1;
            const text = cleanText(firstString(args.content, args.text, args.newText), MAX_TEXT_CHARS);
            if (text && textContents.size < MAX_TEXTS) textContents.add(text);
            continue;
        }

        if (EXPORT_TOOLS.has(name)) {
            if (!success) continue;
            successfulMutationCount += 1;
            collectDeliveryPaths(result, deliveryFiles);
            for (const candidate of [args.outputPath, args.path]) {
                if (looksLikeFilePath(candidate) && deliveryFiles.size < MAX_DELIVERY_FILES) deliveryFiles.add(candidate.trim());
            }
            continue;
        }

        if (MUTATION_TOOLS.has(name) && success) {
            successfulMutationCount += 1;
        }
    }

    return {
        assets: Array.from(assets.values()),
        layouts,
        materialSelections,
        document,
        textContents: Array.from(textContents).slice(0, MAX_TEXTS),
        deliveryFiles: Array.from(deliveryFiles).slice(0, MAX_DELIVERY_FILES),
        successfulMutationCount,
        modelUpdatedProjectState
    };
}

/**
 * 给续跑摘要 / 运行档案用的自然语言「做到哪」（≤ maxChars，默认 600）。
 * 只陈述工具日志能证明的事实；没有事实就返回空串，让调用方跳过。
 */
export function describeDesignRunToolLogFacts(
    facts: DesignRunToolLogFacts,
    options: { maxChars?: number } = {}
): string {
    const maxChars = options.maxChars ?? 600;
    const lines: string[] = [];
    if (facts.document.created) {
        const created = facts.document.created;
        const size = created.width && created.height ? `${created.width}×${created.height}` : created.preset || '';
        lines.push(`新建了文档${created.name ? `「${created.name}」` : ''}${size ? `（${size}）` : ''}`);
    } else if (facts.document.lastDocumentName) {
        lines.push(`在文档「${facts.document.lastDocumentName}」上工作`);
    }
    const lookedAt = facts.assets.filter((asset) => asset.observation);
    if (lookedAt.length > 0) {
        lines.push(`看过素材：${lookedAt.slice(0, 4).map((asset) => (
            `${assetPathBasename(asset.path)}（${asset.observation}）`
        )).join('；')}${lookedAt.length > 4 ? `等 ${lookedAt.length} 张` : ''}`);
    }
    const used = facts.assets.filter((asset) => asset.usedInLayout);
    if (used.length > 0) {
        lines.push(`已置入：${used.slice(0, 4).map((asset) => assetPathBasename(asset.path)).join('、')}${used.length > 4 ? ` 等 ${used.length} 张` : ''}`);
    }
    const latestMaterialSelection = facts.materialSelections[facts.materialSelections.length - 1];
    if (latestMaterialSelection?.selectedAssets.length) {
        const selectedNames = latestMaterialSelection.selectedAssets
            .slice(0, 4)
            .map((asset) => assetPathBasename(asset.path));
        const compared = latestMaterialSelection.currentRunCandidateEvidence.evidenceIds;
        lines.push([
            `选图：${selectedNames.join('、')}`,
            compared.length > 0 ? `候选证据 ${compared.join('、')}` : '未取得可绑定的候选编号',
            latestMaterialSelection.modelAuthoredReason
                ? `Agent 依据：${latestMaterialSelection.modelAuthoredReason}`
                : 'Agent 未提供选图依据'
        ].join('；'));
    }
    const latestLayout = facts.layouts[facts.layouts.length - 1];
    if (latestLayout) {
        lines.push(`版面：Agent 版面签名「${latestLayout.layoutSignature}」${latestLayout.headline.length > 0 ? `，标题「${latestLayout.headline.join(' / ')}」` : ''}${latestLayout.stageGroupName ? `，图层组「${latestLayout.stageGroupName}」` : ''}`);
    } else if (facts.textContents.length > 0) {
        lines.push(`已写文字：${facts.textContents.slice(0, 4).map((text) => `「${text}」`).join('')}`);
    }
    if (facts.deliveryFiles.length > 0) {
        lines.push(`已导出：${facts.deliveryFiles.slice(0, 3).map((file) => assetPathBasename(file)).join('、')}${facts.deliveryFiles.length > 3 ? ` 等 ${facts.deliveryFiles.length} 个` : ''}`);
    }
    if (lines.length === 0) return '';
    const text = lines.join('。') + '。';
    return text.length > maxChars ? `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…` : text;
}
