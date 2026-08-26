import { MAX_RUNTIME_DELIVERY_RESULT_REFS } from './agent-runtime-v5/runtime-delivery-receipt';

export type SkuExportReadbackStatus = 'no_exports' | 'needs_file_probe' | 'ready_for_review' | 'blocked';

export type SkuBatchDeliveryOutcomeStatus =
    | 'completed'
    | 'partial'
    | 'failed'
    | 'blocked_export_readback'
    | 'blocked_invalid_sku_template_layout';

export type SkuBatchDeliveryOutcome = {
    success: boolean;
    status: SkuBatchDeliveryOutcomeStatus;
    partial: boolean;
};

export type SkuRequestedOutputRequirement = {
    size: number;
    expectedComboRows: number;
    expectedNoteRows: number;
};

export type SkuRequestedOutputProgress = {
    size: number;
    completedComboRows: number;
    completedNoteRows: number;
};

export type SkuRequestedOutputMismatch = {
    size: number;
    kind: 'combo' | 'note';
    expected: number;
    completed: number;
};

export type SkuRequestedOutputCompletion = {
    allRequestedOutputsComplete: boolean;
    incompleteOutputs: SkuRequestedOutputMismatch[];
};

export type SkuExportFileProbeInput = {
    success?: boolean;
    path?: string;
    status?: 'ok' | 'missing' | 'not_file' | 'unsupported' | 'decode_failed' | string;
    exists?: boolean;
    isFile?: boolean;
    byteLength?: number;
    format?: string;
    mimeType?: string;
    dimensions?: { width?: number; height?: number };
    visualMetrics?: SkuExportVisualMetricsInput;
    sha256?: string;
    /**
     * 该文件是否由本次运行新建或在执行前基线之后发生了修改。
     * undefined 表示调用方没有启用新鲜度校验；false 必须阻断交付，避免旧文件自证。
     */
    freshnessVerified?: boolean;
    freshnessProof?: 'new_path' | 'modified_since_baseline' | 'unverified' | string;
    rawImagesRedacted?: boolean;
    error?: string;
};

export type SkuExportVisualMetricsInput = {
    sampleSize?: { width?: number; height?: number };
    nonWhitePixelRatio?: number;
    nonWhiteBounds?: {
        x?: number;
        y?: number;
        width?: number;
        height?: number;
        centerX?: number;
        centerY?: number;
        widthRatio?: number;
        heightRatio?: number;
    };
    edgeOccupancy?: { top?: number; right?: number; bottom?: number; left?: number };
    averageLuma?: number;
    lumaStdDev?: number;
    darkPixelRatio?: number;
    highlightPixelRatio?: number;
    shadowLikePixelRatio?: number;
    textureContrastScore?: number;
    backgroundColor?: {
        r?: number;
        g?: number;
        b?: number;
        luma?: number;
    };
    backgroundDistanceThreshold?: number;
    rawImagesRedacted?: boolean;
};

export type SkuExportVisualMetrics = {
    sampleSize: { width: number; height: number };
    nonWhitePixelRatio: number;
    nonWhiteBounds?: {
        x: number;
        y: number;
        width: number;
        height: number;
        centerX: number;
        centerY: number;
        widthRatio: number;
        heightRatio: number;
    };
    edgeOccupancy: { top: number; right: number; bottom: number; left: number };
    averageLuma?: number;
    lumaStdDev?: number;
    darkPixelRatio: number;
    highlightPixelRatio: number;
    shadowLikePixelRatio: number;
    textureContrastScore?: number;
    backgroundColor?: {
        r: number;
        g: number;
        b: number;
        luma: number;
    };
    backgroundDistanceThreshold?: number;
    rawImagesRedacted: true;
};

export type SkuExportReadbackProbe = {
    fileName: string;
    status: string;
    success: boolean;
    byteLength?: number;
    format?: string;
    mimeType?: string;
    dimensions?: { width: number; height: number };
    expectedDimensions?: { width: number; height: number };
    visualMetrics?: SkuExportVisualMetrics;
    sha256?: string;
    freshnessVerified?: boolean;
    freshnessProof?: string;
    rawImagesRedacted: boolean;
    error?: string;
};

interface SkuExportProbeEntry {
    pathKey: string;
    probe: SkuExportReadbackProbe;
}

export type SkuExpectedExportReadbackInput = {
    path?: string;
    expectedDimensions?: { width?: number; height?: number } | null;
};

export type SkuExpectedExportInventorySpec = {
    size: number;
    combos?: string[][] | null;
    comboTemplateName?: string | null;
    comboExpectedDimensions?: { width?: number; height?: number } | null;
    noteRows?: string[][] | null;
    noteTemplateName?: string | null;
    noteExpectedDimensions?: { width?: number; height?: number } | null;
};

export type SkuExpectedExportInventoryItem = {
    id: string;
    kind: 'combo' | 'note';
    size: number;
    rowIndex: number;
    combination: string[];
    templateName: string;
    fileName: string;
    path: string;
    editableFileName: string;
    editablePath: string;
    expectedDimensions?: { width: number; height: number };
};

export type SkuExpectedExportInventory = {
    version: 'sku-expected-export-inventory/v1';
    status: 'ready' | 'blocked';
    items: SkuExpectedExportInventoryItem[];
    blockers: string[];
    boundaries: {
        frozenBeforeExecution: true;
        doesNotScanSourceDirectory: true;
        doesNotAcceptObservedFilesAsExpectation: true;
    };
};

export type SkuExportReadback = {
    version: 'sku-export-readback/v0';
    status: SkuExportReadbackStatus;
    expectedExportCount: number;
    actualExportCount: number;
    missingActualExportCount: number;
    unexpectedActualExportCount: number;
    duplicateActualExportCount: number;
    fileProbeCount: number;
    okFileProbeCount: number;
    failedFileProbeCount: number;
    missingFileProbeCount: number;
    dimensionMismatchCount: number;
    staleFileProbeCount: number;
    visualMetricBlockerCount: number;
    missingVisualMetricCount: number;
    resultFileNames: string[];
    fileProbes: SkuExportReadbackProbe[];
    blockers: string[];
    warnings: string[];
    boundaries: {
        readonly: true;
        rawImagesRedacted: true;
        doesNotClaimDesignQuality: true;
        doesNotRunPhotoshop: true;
    };
};

export type BuildSkuExportReadbackInput = {
    expectedExportPaths?: string[] | null;
    expectedExports?: SkuExpectedExportReadbackInput[] | null;
    /** 仅接受本次执行返回并验收过的最终路径；不得由目录扫描补齐。 */
    actualExportPaths?: string[] | null;
    fileProbes?: SkuExportFileProbeInput[] | null;
    expectedDimensions?: { width?: number; height?: number } | null;
    /** 工具回执数量、格式或命名异常等无法仅靠最终路径集合表达的违例。 */
    inventoryViolations?: string[] | null;
};

function normalizeOutputRowCount(value: unknown): number {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue <= 0) return 0;
    return Math.floor(numberValue);
}

function normalizeSkuSize(value: unknown): number | undefined {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue <= 0) return undefined;
    return Math.floor(numberValue);
}

function normalizeInventoryPath(value: unknown): string {
    return String(value || '')
        .trim()
        .replace(/\//g, '\\')
        .replace(/\\+$/g, '');
}

function normalizeInventoryTemplateName(value: unknown): string {
    const raw = String(value || '').trim();
    if (!raw || /[\\/]/.test(raw)) return '';
    const withoutExtension = raw.replace(/\.[^.]+$/, '').trim();
    if (!withoutExtension || withoutExtension === '.' || withoutExtension === '..') return '';
    if (/[<>:"|?*\x00-\x1F]/.test(withoutExtension)) return '';
    return withoutExtension;
}

/** 与 Photoshop SKU 工具的导出命名规则保持一致。 */
function normalizeInventoryFileNamePart(value: unknown, fallback: string): string {
    const cleaned = String(value || '')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
        .replace(/\s+/g, '')
        .replace(/-+/g, '-')
        .replace(/^[.\-\s]+|[.\-\s]+$/g, '')
        .trim();
    return cleaned || fallback;
}

function normalizeInventoryCombination(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((entry) => String(entry || '').trim()).filter(Boolean);
}

/**
 * 从已经冻结的规格、组合、模板身份、输出目录与命名规则建立精确交付清单。
 * 该函数不读取目录，也不接收执行结果，因此旧文件和实际结果不能反向成为期望。
 */
export function buildSkuExpectedExportInventory(input: {
    outputDir?: string | null;
    specs: SkuExpectedExportInventorySpec[];
}): SkuExpectedExportInventory {
    const outputDir = normalizeInventoryPath(input.outputDir);
    const blockers: string[] = [];
    const items: SkuExpectedExportInventoryItem[] = [];
    const pathKeys = new Set<string>();

    if (!outputDir || !looksLikeAbsoluteLocalPath(outputDir)) {
        blockers.push('SKU 精确交付清单缺少绝对输出目录。');
    }

    for (const rawSpec of input.specs || []) {
        const size = normalizeSkuSize(rawSpec?.size);
        if (!size) {
            blockers.push('SKU 精确交付清单包含无效规格。');
            continue;
        }

        const combos = Array.isArray(rawSpec?.combos) ? rawSpec.combos : [];
        if (combos.length > 0) {
            const templateName = normalizeInventoryTemplateName(rawSpec?.comboTemplateName);
            if (!templateName) {
                blockers.push(`${size}双组合交付缺少安全、稳定的模板名称。`);
            } else {
                combos.forEach((rawCombination, index) => {
                    const combination = normalizeInventoryCombination(rawCombination);
                    if (combination.length !== size) {
                        blockers.push(`${size}双第${index + 1}组包含 ${combination.length} 个颜色，不能建立精确文件名。`);
                        return;
                    }
                    const colorPart = normalizeInventoryFileNamePart(combination.join('+'), '');
                    const baseName = colorPart ? `${index + 1}${colorPart}` : `组合${index + 1}`;
                    const fileName = `${baseName}.jpg`;
                    const itemPath = `${outputDir}\\${templateName}\\${fileName}`;
                    const editableFileName = `${baseName}.psb`;
                    const editablePath = `${outputDir}\\可编辑\\${templateName}\\${editableFileName}`;
                    const pathKey = normalizePathKey(itemPath);
                    const editablePathKey = normalizePathKey(editablePath);
                    if (pathKeys.has(pathKey) || pathKeys.has(editablePathKey)) {
                        blockers.push(`SKU 精确交付清单出现重复路径：${fileName}`);
                        return;
                    }
                    pathKeys.add(pathKey);
                    pathKeys.add(editablePathKey);
                    items.push({
                        id: `combo:${size}:${index + 1}`,
                        kind: 'combo',
                        size,
                        rowIndex: index + 1,
                        combination,
                        templateName,
                        fileName,
                        path: itemPath,
                        editableFileName,
                        editablePath,
                        expectedDimensions: normalizeExpectedDimensions(rawSpec?.comboExpectedDimensions)
                    });
                });
            }
        }

        const noteRows = Array.isArray(rawSpec?.noteRows) ? rawSpec.noteRows : [];
        if (noteRows.length > 0) {
            const templateName = normalizeInventoryTemplateName(rawSpec?.noteTemplateName);
            if (!templateName) {
                blockers.push(`${size}双自选备注交付缺少安全、稳定的模板名称。`);
            } else {
                noteRows.forEach((rawCombination, index) => {
                    const combination = normalizeInventoryCombination(rawCombination);
                    if (combination.length === 0) {
                        blockers.push(`${size}双自选备注第${index + 1}行没有颜色，不能建立精确文件名。`);
                        return;
                    }
                    const baseName = noteRows.length > 1
                        ? `${size}双自选备注-${index + 1}`
                        : `${size}双自选备注`;
                    const fileName = `${baseName}.jpg`;
                    const itemPath = `${outputDir}\\${templateName}\\${fileName}`;
                    const editableFileName = `${baseName}.psb`;
                    const editablePath = `${outputDir}\\可编辑\\${templateName}\\${editableFileName}`;
                    const pathKey = normalizePathKey(itemPath);
                    const editablePathKey = normalizePathKey(editablePath);
                    if (pathKeys.has(pathKey) || pathKeys.has(editablePathKey)) {
                        blockers.push(`SKU 精确交付清单出现重复路径：${fileName}`);
                        return;
                    }
                    pathKeys.add(pathKey);
                    pathKeys.add(editablePathKey);
                    items.push({
                        id: `note:${size}:${index + 1}`,
                        kind: 'note',
                        size,
                        rowIndex: index + 1,
                        combination,
                        templateName,
                        fileName,
                        path: itemPath,
                        editableFileName,
                        editablePath,
                        expectedDimensions: normalizeExpectedDimensions(rawSpec?.noteExpectedDimensions)
                    });
                });
            }
        }
    }

    if (items.length === 0) blockers.push('SKU 精确交付清单为空。');
    if (items.length > MAX_RUNTIME_DELIVERY_RESULT_REFS) {
        blockers.push(
            `SKU 精确交付清单最多支持 ${MAX_RUNTIME_DELIVERY_RESULT_REFS} 行，本次为 ${items.length} 行。`
        );
    }
    return {
        version: 'sku-expected-export-inventory/v1',
        status: blockers.length > 0 ? 'blocked' : 'ready',
        items,
        blockers: uniqueStrings(blockers),
        boundaries: {
            frozenBeforeExecution: true,
            doesNotScanSourceDirectory: true,
            doesNotAcceptObservedFilesAsExpectation: true
        }
    };
}

/**
 * 对照执行前冻结的 SKU 交付要求与真实完成行数。
 *
 * 缺行和多出行都不是完整交付；这样既不会让“空组合但有备注”的规格
 * 真空通过，也不会把重复导出的额外文件冒充成按计划完成。
 */
export function evaluateSkuRequestedOutputCompletion(input: {
    requirements: SkuRequestedOutputRequirement[];
    progress: SkuRequestedOutputProgress[];
}): SkuRequestedOutputCompletion {
    const requirementsBySize = new Map<number, { combo: number; note: number }>();
    const progressBySize = new Map<number, { combo: number; note: number }>();

    for (const requirement of input.requirements || []) {
        const size = normalizeSkuSize(requirement?.size);
        if (!size) continue;
        const existing = requirementsBySize.get(size) || { combo: 0, note: 0 };
        requirementsBySize.set(size, {
            combo: existing.combo + normalizeOutputRowCount(requirement?.expectedComboRows),
            note: existing.note + normalizeOutputRowCount(requirement?.expectedNoteRows)
        });
    }

    for (const item of input.progress || []) {
        const size = normalizeSkuSize(item?.size);
        if (!size) continue;
        const existing = progressBySize.get(size) || { combo: 0, note: 0 };
        progressBySize.set(size, {
            combo: existing.combo + normalizeOutputRowCount(item?.completedComboRows),
            note: existing.note + normalizeOutputRowCount(item?.completedNoteRows)
        });
    }

    const incompleteOutputs: SkuRequestedOutputMismatch[] = [];
    const sizes = Array.from(new Set([
        ...requirementsBySize.keys(),
        ...progressBySize.keys()
    ])).sort((left, right) => left - right);

    for (const size of sizes) {
        const expected = requirementsBySize.get(size) || { combo: 0, note: 0 };
        const completed = progressBySize.get(size) || { combo: 0, note: 0 };
        if (expected.combo !== completed.combo) {
            incompleteOutputs.push({
                size,
                kind: 'combo',
                expected: expected.combo,
                completed: completed.combo
            });
        }
        if (expected.note !== completed.note) {
            incompleteOutputs.push({
                size,
                kind: 'note',
                expected: expected.note,
                completed: completed.note
            });
        }
    }

    return {
        allRequestedOutputsComplete: incompleteOutputs.length === 0,
        incompleteOutputs
    };
}

export function resolveSkuBatchDeliveryOutcome(input: {
    hasAnyProcessedOutput: boolean;
    allRequestedOutputsComplete: boolean;
    hasExecutionWarnings: boolean;
    exportReadbackStatus: SkuExportReadbackStatus;
    blockedByInvalidSkuTemplateLayout?: boolean;
}): SkuBatchDeliveryOutcome {
    if (input.blockedByInvalidSkuTemplateLayout) {
        return {
            success: false,
            status: 'blocked_invalid_sku_template_layout',
            partial: input.hasAnyProcessedOutput
        };
    }
    if (!input.hasAnyProcessedOutput) {
        return { success: false, status: 'failed', partial: false };
    }
    if (input.exportReadbackStatus !== 'ready_for_review') {
        return { success: false, status: 'blocked_export_readback', partial: true };
    }
    if (!input.allRequestedOutputsComplete || input.hasExecutionWarnings) {
        return { success: false, status: 'partial', partial: true };
    }
    return { success: true, status: 'completed', partial: false };
}

export type SkuPublicToolResult = {
    toolName?: string;
    /** Tool Registry 的真实名称；toolName 可能仍是旧版展示标签。 */
    providerToolName?: string;
    arguments?: Record<string, unknown>;
    operationLabel?: string;
    result?: unknown;
};

function basename(value: unknown): string {
    const text = String(value || '').trim();
    if (!text) return '';
    return text.split(/[\\/]/).filter(Boolean).pop() || text;
}

function normalizeDimension(value: unknown): number | undefined {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue) || numberValue < 0) return undefined;
    return Math.round(numberValue);
}

function normalizeExpectedDimensions(
    value?: { width?: number; height?: number } | null
): { width: number; height: number } | undefined {
    const width = normalizeDimension(value?.width);
    const height = normalizeDimension(value?.height);
    if (width === undefined || height === undefined) return undefined;
    return { width, height };
}

export function isSuccessfulSkuExportFileProbe(probe: SkuExportFileProbeInput): boolean {
    return probe?.success === true
        && probe?.status === 'ok'
        && probe?.rawImagesRedacted === true;
}

function sanitizeProbe(
    probe: SkuExportFileProbeInput,
    expectedDimensions?: { width: number; height: number }
): SkuExportReadbackProbe {
    const width = normalizeDimension(probe?.dimensions?.width);
    const height = normalizeDimension(probe?.dimensions?.height);
    const success = isSuccessfulSkuExportFileProbe(probe);
    return {
        fileName: basename(probe?.path) || 'unknown',
        status: String(probe?.status || (success ? 'ok' : 'unknown')),
        success,
        byteLength: normalizeDimension(probe?.byteLength),
        format: probe?.format ? String(probe.format) : undefined,
        mimeType: probe?.mimeType ? String(probe.mimeType) : undefined,
        dimensions: width !== undefined && height !== undefined ? { width, height } : undefined,
        expectedDimensions,
        visualMetrics: sanitizeVisualMetrics(probe?.visualMetrics),
        sha256: probe?.sha256 ? String(probe.sha256).slice(0, 16) : undefined,
        freshnessVerified: typeof probe?.freshnessVerified === 'boolean'
            ? probe.freshnessVerified
            : undefined,
        freshnessProof: probe?.freshnessProof ? String(probe.freshnessProof) : undefined,
        rawImagesRedacted: probe?.rawImagesRedacted === true,
        error: probe?.error ? String(probe.error) : undefined
    };
}

function normalizeRatio(value: unknown): number | undefined {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return undefined;
    return Math.max(0, Math.min(1, Math.round(numberValue * 10000) / 10000));
}

function normalizeMetric(value: unknown): number | undefined {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return undefined;
    return Math.round(numberValue * 100) / 100;
}

function sanitizeVisualMetrics(value: unknown): SkuExportVisualMetrics | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const metrics = value as SkuExportVisualMetricsInput;
    if (metrics.rawImagesRedacted !== true) return undefined;
    const sampleWidth = normalizeDimension(metrics.sampleSize?.width);
    const sampleHeight = normalizeDimension(metrics.sampleSize?.height);
    const nonWhitePixelRatio = normalizeRatio(metrics.nonWhitePixelRatio);
    if (sampleWidth === undefined || sampleHeight === undefined || nonWhitePixelRatio === undefined) {
        return undefined;
    }
    const bounds = metrics.nonWhiteBounds;
    const background = metrics.backgroundColor;
    const normalizedBounds = bounds
        && normalizeRatio(bounds.x) !== undefined
        && normalizeRatio(bounds.y) !== undefined
        && normalizeDimension(bounds.width) !== undefined
        && normalizeDimension(bounds.height) !== undefined
        && normalizeRatio(bounds.centerX) !== undefined
        && normalizeRatio(bounds.centerY) !== undefined
        && normalizeRatio(bounds.widthRatio) !== undefined
        && normalizeRatio(bounds.heightRatio) !== undefined
        ? {
            x: normalizeRatio(bounds.x) as number,
            y: normalizeRatio(bounds.y) as number,
            width: normalizeDimension(bounds.width) as number,
            height: normalizeDimension(bounds.height) as number,
            centerX: normalizeRatio(bounds.centerX) as number,
            centerY: normalizeRatio(bounds.centerY) as number,
            widthRatio: normalizeRatio(bounds.widthRatio) as number,
            heightRatio: normalizeRatio(bounds.heightRatio) as number
        }
        : undefined;
    return {
        sampleSize: { width: sampleWidth, height: sampleHeight },
        nonWhitePixelRatio,
        nonWhiteBounds: normalizedBounds,
        edgeOccupancy: {
            top: normalizeRatio(metrics.edgeOccupancy?.top) || 0,
            right: normalizeRatio(metrics.edgeOccupancy?.right) || 0,
            bottom: normalizeRatio(metrics.edgeOccupancy?.bottom) || 0,
            left: normalizeRatio(metrics.edgeOccupancy?.left) || 0
        },
        averageLuma: normalizeMetric(metrics.averageLuma),
        lumaStdDev: normalizeMetric(metrics.lumaStdDev),
        darkPixelRatio: normalizeRatio(metrics.darkPixelRatio) || 0,
        highlightPixelRatio: normalizeRatio(metrics.highlightPixelRatio) || 0,
        shadowLikePixelRatio: normalizeRatio(metrics.shadowLikePixelRatio) || 0,
        textureContrastScore: normalizeMetric(metrics.textureContrastScore),
        backgroundColor: background
            && normalizeDimension(background.r) !== undefined
            && normalizeDimension(background.g) !== undefined
            && normalizeDimension(background.b) !== undefined
            && normalizeMetric(background.luma) !== undefined
            ? {
                r: normalizeDimension(background.r) as number,
                g: normalizeDimension(background.g) as number,
                b: normalizeDimension(background.b) as number,
                luma: normalizeMetric(background.luma) as number
            }
            : undefined,
        backgroundDistanceThreshold: normalizeMetric(metrics.backgroundDistanceThreshold),
        rawImagesRedacted: true
    };
}

function hasDimensionMismatch(probe: SkuExportReadbackProbe): boolean {
    if (!probe.success || !probe.dimensions || !probe.expectedDimensions) return false;
    if (probe.dimensions.width !== probe.expectedDimensions.width) return true;
    if (probe.dimensions.height !== probe.expectedDimensions.height) return true;
    return false;
}

function getMaxEdgeOccupancy(metrics?: SkuExportVisualMetrics): number {
    if (!metrics) return 0;
    return Math.max(
        metrics.edgeOccupancy.top || 0,
        metrics.edgeOccupancy.right || 0,
        metrics.edgeOccupancy.bottom || 0,
        metrics.edgeOccupancy.left || 0
    );
}

function getFinalImageMetricBlocker(probe: SkuExportReadbackProbe): string | undefined {
    if (!probe.success) return undefined;
    const metrics = probe.visualMetrics;
    if (!metrics) return undefined;
    const bounds = metrics.nonWhiteBounds;
    if (metrics.nonWhitePixelRatio <= 0.005 || !bounds) {
        return `导出图几乎为空或缺少主体边界：${probe.fileName}`;
    }
    if (bounds.widthRatio < 0.04 || bounds.heightRatio < 0.04) {
        return `导出图主体像素占比异常偏小：${probe.fileName}`;
    }
    if (getMaxEdgeOccupancy(metrics) > 0.55) {
        return `导出图主体边缘占用过高，可能存在裁切或贴边：${probe.fileName}`;
    }
    if (bounds.centerX < 0.06 || bounds.centerX > 0.94 || bounds.centerY < 0.06 || bounds.centerY > 0.94) {
        return `导出图主体中心明显偏离画布：${probe.fileName}`;
    }
    return undefined;
}

function normalizePathKey(value: unknown): string {
    return String(value || '').trim().replace(/\//g, '\\').toLowerCase();
}

function looksLikeAbsoluteLocalPath(value: string): boolean {
    const text = String(value || '').trim();
    return /^[a-zA-Z]:[\\/]/.test(text)
        || text.startsWith('\\\\')
        || /^\/(users|home|var|tmp|mnt)\//i.test(text);
}

function isSensitivePathKey(key?: string): boolean {
    return /(^|_)(path|dir|directory|tempPath|targetDir|sourcePath|filePath|outputDir)$/i.test(String(key || ''));
}

function sanitizePublicString(value: string, key?: string): string {
    const text = String(value || '');
    if (/data:image\/|base64-image-payload|raw-image-payload/i.test(text)) {
        return '[raw-image-redacted]';
    }
    const maybeJson = text.trim();
    if (maybeJson.startsWith('{') && maybeJson.endsWith('}')) {
        try {
            return JSON.stringify(sanitizeSkuPublicValue(JSON.parse(maybeJson), key));
        } catch {
            // Fall through to local path redaction.
        }
    }
    if (isSensitivePathKey(key) || looksLikeAbsoluteLocalPath(text)) {
        const fileName = basename(text);
        return fileName ? `[local-path-redacted]/${fileName}` : '[local-path-redacted]';
    }
    return text;
}

function sanitizeSkuPublicValue(value: unknown, key?: string): unknown {
    if (typeof value === 'string') return sanitizePublicString(value, key);
    if (Array.isArray(value)) return value.map((item) => sanitizeSkuPublicValue(item, key));
    if (!value || typeof value !== 'object') return value;
    const output: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
        output[entryKey] = sanitizeSkuPublicValue(entryValue, entryKey);
    }
    return output;
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.map((item) => String(item || '').trim()).filter(Boolean)));
}

export function sanitizeSkuToolResultsForPublicResult(
    toolResults: SkuPublicToolResult[] = []
): SkuPublicToolResult[] {
    return toolResults.map((entry) => ({
        toolName: entry?.toolName ? String(entry.toolName) : undefined,
        providerToolName: entry?.providerToolName ? String(entry.providerToolName) : undefined,
        arguments: entry?.arguments
            ? sanitizeSkuPublicValue(entry.arguments) as Record<string, unknown>
            : undefined,
        operationLabel: entry?.operationLabel ? String(entry.operationLabel) : undefined,
        result: sanitizeSkuPublicValue(entry?.result)
    }));
}

export function buildSkuExportReadback(
    input: BuildSkuExportReadbackInput
): SkuExportReadback {
    const explicitExpectedExports = (input.expectedExports || [])
        .map((item) => ({
            path: String(item?.path || '').trim(),
            expectedDimensions: normalizeExpectedDimensions(item?.expectedDimensions)
        }))
        .filter((item) => Boolean(item.path));
    const rawExpectedExportPaths = explicitExpectedExports.length > 0
        ? explicitExpectedExports.map((item) => item.path)
        : (input.expectedExportPaths || []);
    const expectedExportPathMap = new Map<string, string>();
    const expectedPathCountByKey = new Map<string, number>();
    for (const candidate of rawExpectedExportPaths) {
        const exportPath = String(candidate || '').trim();
        const pathKey = normalizePathKey(exportPath);
        if (!pathKey) continue;
        expectedPathCountByKey.set(pathKey, (expectedPathCountByKey.get(pathKey) || 0) + 1);
        if (!expectedExportPathMap.has(pathKey)) expectedExportPathMap.set(pathKey, exportPath);
    }
    const expectedExportPaths = Array.from(expectedExportPathMap.values());
    const expectedPathKeys = new Set(expectedExportPathMap.keys());
    const expectedFileNames = Array.from(new Set(expectedExportPaths.map(basename).filter(Boolean)));
    const duplicateExpectedPathKeys = Array.from(expectedPathCountByKey.entries())
        .filter(([, count]) => count > 1)
        .map(([pathKey]) => pathKey);
    const actualExportPathsProvided = Array.isArray(input.actualExportPaths);
    const actualExportPaths = (input.actualExportPaths || [])
        .map((value) => String(value || '').trim())
        .filter(Boolean);
    const actualPathCountByKey = new Map<string, number>();
    for (const actualPath of actualExportPaths) {
        const pathKey = normalizePathKey(actualPath);
        if (!pathKey) continue;
        actualPathCountByKey.set(pathKey, (actualPathCountByKey.get(pathKey) || 0) + 1);
    }
    const missingActualPathKeys = actualExportPathsProvided
        ? Array.from(expectedPathKeys).filter((pathKey) => !actualPathCountByKey.has(pathKey))
        : [];
    const unexpectedActualPaths = actualExportPathsProvided
        ? actualExportPaths.filter((actualPath) => !expectedPathKeys.has(normalizePathKey(actualPath)))
        : [];
    const duplicateActualPathKeys = actualExportPathsProvided
        ? Array.from(actualPathCountByKey.entries())
            .filter(([, count]) => count > 1)
            .map(([pathKey]) => pathKey)
        : [];
    const globalExpectedDimensions = normalizeExpectedDimensions(input.expectedDimensions);
    const expectedDimensionsByPath = new Map<string, { width: number; height: number }>();
    const expectedDimensionsByFileName = new Map<string, { width: number; height: number }>();
    for (const item of explicitExpectedExports) {
        if (!item.expectedDimensions) continue;
        expectedDimensionsByPath.set(normalizePathKey(item.path), item.expectedDimensions);
        expectedDimensionsByFileName.set(basename(item.path).toLowerCase(), item.expectedDimensions);
    }
    const getExpectedDimensionsForProbe = (probe: SkuExportFileProbeInput): { width: number; height: number } | undefined => {
        const pathKey = normalizePathKey(probe?.path);
        if (pathKey && expectedDimensionsByPath.has(pathKey)) {
            return expectedDimensionsByPath.get(pathKey);
        }
        const fileNameKey = basename(probe?.path).toLowerCase();
        if (fileNameKey && expectedDimensionsByFileName.has(fileNameKey)) {
            return expectedDimensionsByFileName.get(fileNameKey);
        }
        return globalExpectedDimensions;
    };
    const probeEntries: SkuExportProbeEntry[] = (input.fileProbes || []).map((probe) => ({
        pathKey: normalizePathKey(probe?.path),
        probe: sanitizeProbe(probe, getExpectedDimensionsForProbe(probe))
    }));
    const fileProbes = probeEntries.map((entry) => entry.probe);
    const probeCountByPath = new Map<string, number>();
    for (const entry of probeEntries) {
        probeCountByPath.set(entry.pathKey, (probeCountByPath.get(entry.pathKey) || 0) + 1);
    }
    const missingExpectedPathKeys = Array.from(expectedPathKeys).filter(
        (pathKey) => !probeCountByPath.has(pathKey)
    );
    const extraProbeEntries = probeEntries.filter(
        (entry) => !entry.pathKey || !expectedPathKeys.has(entry.pathKey)
    );
    const duplicateProbePathKeys = Array.from(probeCountByPath.entries())
        .filter(([pathKey, count]) => Boolean(pathKey) && expectedPathKeys.has(pathKey) && count > 1)
        .map(([pathKey]) => pathKey);
    const failedProbes = fileProbes.filter((probe) => !probe.success);
    const dimensionMismatchProbes = fileProbes.filter((probe) => hasDimensionMismatch(probe));
    const staleFileProbes = fileProbes.filter((probe) => probe.freshnessVerified === false);
    const finalImageMetricBlockers = uniqueStrings(fileProbes
        .map(getFinalImageMetricBlocker)
        .filter(Boolean) as string[]);
    const missingVisualMetricCount = fileProbes.filter((probe) => probe.success && !probe.visualMetrics).length;
    const missingFileProbeCount = missingExpectedPathKeys.length;
    const blockers: string[] = [];
    const warnings: string[] = [];
    const inventoryViolations = uniqueStrings(input.inventoryViolations || []);

    if (expectedExportPaths.length === 0) {
        warnings.push('SKU 工具没有返回导出文件路径，无法进行文件读回。');
    }
    if (duplicateExpectedPathKeys.length > 0) {
        blockers.push(`执行前 SKU 精确交付清单包含 ${duplicateExpectedPathKeys.length} 个重复路径。`);
    }
    if (missingActualPathKeys.length > 0) {
        blockers.push(`本次执行结果缺少 ${missingActualPathKeys.length} 个计划内 SKU 导出路径。`);
    }
    if (unexpectedActualPaths.length > 0) {
        blockers.push(`本次执行返回 ${unexpectedActualPaths.length} 个计划外 SKU 导出路径：${unexpectedActualPaths.map(basename).join('、')}`);
    }
    if (duplicateActualPathKeys.length > 0) {
        blockers.push(`本次执行重复返回 ${duplicateActualPathKeys.length} 个 SKU 导出路径。`);
    }
    blockers.push(...inventoryViolations.map((message) => `SKU 导出清单违例：${message}`));
    if (missingFileProbeCount > 0) {
        blockers.push(`缺少 ${missingFileProbeCount} 个 SKU 导出文件探针。`);
    }
    if (extraProbeEntries.length > 0) {
        blockers.push(`发现 ${extraProbeEntries.length} 个不属于本次精确导出集合的文件探针：${extraProbeEntries.map((entry) => entry.probe.fileName).join('、')}`);
    }
    if (duplicateProbePathKeys.length > 0) {
        blockers.push(`同一导出路径存在重复文件探针 ${duplicateProbePathKeys.length} 个；已拒绝用重复探针替代其他文件的读回。`);
    }
    if (failedProbes.length > 0) {
        blockers.push(`导出文件探针失败 ${failedProbes.length} 个：${failedProbes.map((probe) => probe.fileName).join('、')}`);
    }
    if (dimensionMismatchProbes.length > 0) {
        blockers.push(`导出文件尺寸不符合预期 ${dimensionMismatchProbes.length} 个：${dimensionMismatchProbes.map((probe) => probe.fileName).join('、')}`);
    }
    if (staleFileProbes.length > 0) {
        blockers.push(`有 ${staleFileProbes.length} 个导出文件未能证明由本次运行新建或修改：${staleFileProbes.map((probe) => probe.fileName).join('、')}`);
    }
    blockers.push(...finalImageMetricBlockers);
    if (missingVisualMetricCount > 0) {
        warnings.push(`有 ${missingVisualMetricCount} 个导出文件缺少 visualMetrics，只能确认文件存在、可解码和尺寸，无法做最终图片像素验收。`);
    }

    const hasPathIdentityBlocker = extraProbeEntries.length > 0
        || duplicateProbePathKeys.length > 0
        || duplicateExpectedPathKeys.length > 0
        || missingActualPathKeys.length > 0
        || unexpectedActualPaths.length > 0
        || duplicateActualPathKeys.length > 0
        || inventoryViolations.length > 0;
    const status: SkuExportReadbackStatus = expectedExportPaths.length === 0
        ? 'no_exports'
        : blockers.length > 0
            ? (failedProbes.length > 0
                || dimensionMismatchProbes.length > 0
                || staleFileProbes.length > 0
                || finalImageMetricBlockers.length > 0
                || hasPathIdentityBlocker
                ? 'blocked'
                : 'needs_file_probe')
            : 'ready_for_review';

    return {
        version: 'sku-export-readback/v0',
        status,
        expectedExportCount: expectedExportPaths.length,
        actualExportCount: actualExportPaths.length,
        missingActualExportCount: missingActualPathKeys.length,
        unexpectedActualExportCount: unexpectedActualPaths.length,
        duplicateActualExportCount: duplicateActualPathKeys.length,
        fileProbeCount: fileProbes.length,
        okFileProbeCount: fileProbes.filter((probe) => probe.success).length,
        failedFileProbeCount: fileProbes.filter((probe) => (
            !probe.success || hasDimensionMismatch(probe) || probe.freshnessVerified === false
        )).length,
        missingFileProbeCount,
        dimensionMismatchCount: dimensionMismatchProbes.length,
        staleFileProbeCount: staleFileProbes.length,
        visualMetricBlockerCount: finalImageMetricBlockers.length,
        missingVisualMetricCount,
        resultFileNames: expectedFileNames,
        fileProbes,
        blockers,
        warnings,
        boundaries: {
            readonly: true,
            rawImagesRedacted: true,
            doesNotClaimDesignQuality: true,
            doesNotRunPhotoshop: true
        }
    };
}
