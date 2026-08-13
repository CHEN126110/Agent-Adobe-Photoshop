import type {
    SkuColorCardColorNameSource,
    SkuColorCardExecutionReport,
    SkuColorCardSourceInput
} from './sku-color-card-skill';

export const MANUAL_SKU_COLOR_CARD_REQUEST_VERSION = 'manual-sku-color-card-request/v1' as const;
export const MANUAL_SKU_COLOR_CARD_RESULT_VERSION = 'manual-sku-color-card-result/v1' as const;
export const MANUAL_SKU_COLOR_CARD_BRIDGE_VERSION = 'manual-sku-color-card-bridge/v1' as const;

export type ManualSkuColorCardMode = 'ins' | 'studio';
export type ManualSkuColorCardAvailabilityState = 'ready' | 'starting' | 'unavailable';
export type ManualSkuColorCardErrorCode =
    | 'bridge_unavailable'
    | 'connection_lost'
    | 'busy'
    | 'invalid_request'
    | 'execution_failed'
    | 'outcome_unknown';

export interface ManualSkuColorCardBridgeProbe {
    probeId: string;
}

export interface ManualSkuColorCardBridgeReady {
    version: typeof MANUAL_SKU_COLOR_CARD_BRIDGE_VERSION;
    probeId?: string;
}

export interface ManualSkuColorCardAvailability {
    version: typeof MANUAL_SKU_COLOR_CARD_BRIDGE_VERSION;
    available: boolean;
    state: ManualSkuColorCardAvailabilityState;
    modes: ManualSkuColorCardMode[];
    reason?: string;
}

export interface ManualSkuColorCardSource extends SkuColorCardSourceInput {
    colorName: string;
    colorNameSource: SkuColorCardColorNameSource;
}

export interface ManualSkuColorCardRequest {
    version: typeof MANUAL_SKU_COLOR_CARD_REQUEST_VERSION;
    mode: ManualSkuColorCardMode;
    sources: ManualSkuColorCardSource[];
    outputFolder: string;
    outputPath: string;
    showIndexNumbers?: boolean;
    columns?: number;
}

export interface ManualSkuColorCardRendererRequest extends ManualSkuColorCardRequest {
    requestId: string;
}

export interface ManualSkuColorCardProgress {
    requestId: string;
    progress: number;
    message: string;
    stage?: string;
}

export interface ManualSkuColorCardResult {
    version: typeof MANUAL_SKU_COLOR_CARD_RESULT_VERSION;
    requestId: string;
    success: boolean;
    mode: ManualSkuColorCardMode;
    message: string;
    outputPath?: string;
    documentId?: number;
    sourceCount: number;
    preparedCardCount: number;
    retouchedCardCount: number;
    status?: SkuColorCardExecutionReport['status'];
    checks?: SkuColorCardExecutionReport['checks'];
    retouchReportPath?: string;
    needsVisualReview: boolean;
    errorCode?: ManualSkuColorCardErrorCode;
    error?: string;
}

export interface ManualSkuColorCardRequestValidation {
    success: boolean;
    request?: ManualSkuColorCardRequest;
    error?: string;
}

const SUPPORTED_SOURCE_EXTENSIONS = new Set([
    '.jpg',
    '.jpeg',
    '.png',
    '.tif',
    '.tiff',
    '.psd',
    '.psb',
    '.webp'
]);

function clean(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function extensionOf(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    const slashIndex = normalized.lastIndexOf('/');
    const dotIndex = normalized.lastIndexOf('.');
    if (dotIndex <= slashIndex) return '';
    return normalized.slice(dotIndex).toLowerCase();
}

function normalizedPath(value: string): string {
    return value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function parentFolderOf(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    const slashIndex = normalized.lastIndexOf('/');
    return slashIndex > 0 ? normalized.slice(0, slashIndex) : '';
}

function normalizeMode(value: unknown): ManualSkuColorCardMode | null {
    if (value === 'ins' || value === 'studio') return value;
    return null;
}

function normalizeColumns(value: unknown): number | undefined {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
    return Math.max(1, Math.min(8, Math.round(numeric)));
}

function normalizeSources(value: unknown): ManualSkuColorCardSource[] | null {
    if (!Array.isArray(value) || value.length === 0) return null;

    const sources: ManualSkuColorCardSource[] = [];
    const seenPaths = new Set<string>();
    for (const item of value) {
        if (!item || typeof item !== 'object') return null;
        const record = item as Record<string, unknown>;
        const filePath = clean(record.filePath);
        const colorName = clean(record.colorName);
        const extension = extensionOf(filePath);
        if (!filePath || !colorName || !SUPPORTED_SOURCE_EXTENSIONS.has(extension)) return null;

        const pathKey = filePath.replace(/\\/g, '/').toLowerCase();
        if (seenPaths.has(pathKey)) continue;
        seenPaths.add(pathKey);
        sources.push({
            filePath,
            colorName,
            colorNameSource: 'provided'
        });
    }

    return sources.length > 0 ? sources : null;
}

export function validateManualSkuColorCardRequest(
    value: unknown
): ManualSkuColorCardRequestValidation {
    if (!value || typeof value !== 'object') {
        return { success: false, error: '手动色卡请求格式无效。' };
    }

    const record = value as Record<string, unknown>;
    const mode = normalizeMode(record.mode);
    if (!mode) {
        return { success: false, error: '请选择 INS 卡片色卡或纯底精修色卡。' };
    }

    const sources = normalizeSources(record.sources);
    if (!sources) {
        return { success: false, error: '至少选择一张受支持的商品图片，并填写颜色名。' };
    }

    const outputFolder = clean(record.outputFolder);
    const outputPath = clean(record.outputPath);
    if (!outputFolder || !outputPath) {
        return { success: false, error: '请选择输出目录并填写色卡文件名。' };
    }
    if (extensionOf(outputPath) !== '.psb') {
        return { success: false, error: '手动色卡必须保存为可编辑的 PSB 文件。' };
    }
    if (normalizedPath(parentFolderOf(outputPath)) !== normalizedPath(outputFolder)) {
        return { success: false, error: '色卡输出文件必须位于已选择的输出目录中。' };
    }

    return {
        success: true,
        request: {
            version: MANUAL_SKU_COLOR_CARD_REQUEST_VERSION,
            mode,
            sources,
            outputFolder,
            outputPath,
            showIndexNumbers: record.showIndexNumbers !== false,
            columns: normalizeColumns(record.columns)
        }
    };
}
