export type JpegExportQualityOwner = 'saveDocument' | 'quickExport';

export const SAVE_DOCUMENT_DEFAULT_JPEG_QUALITY = 12;
export const QUICK_EXPORT_DEFAULT_JPEG_QUALITY = 80;

export interface JpegQualityRedirectInput {
    sourceTool: JpegExportQualityOwner;
    targetFormat: unknown;
    requestedQuality: unknown;
    redirectedParams: Record<string, unknown>;
}

function hasExplicitQuality(value: unknown): boolean {
    return value !== undefined && value !== null && String(value).trim() !== '';
}

function isJpegFormat(value: unknown): boolean {
    const format = String(value || '').trim().toLowerCase();
    return format === 'jpg' || format === 'jpeg';
}

function getOriginatingDefaultQuality(sourceTool: JpegExportQualityOwner): number {
    if (sourceTool === 'quickExport') return QUICK_EXPORT_DEFAULT_JPEG_QUALITY;
    return SAVE_DOCUMENT_DEFAULT_JPEG_QUALITY;
}

/**
 * Preserve the public tool's JPEG semantics when Renderer redirects execution
 * through the other Photoshop export tool. Defaults belong to the tool the
 * caller invoked, not to the internal transport selected by Harness.
 */
export function preserveJpegQualityAcrossToolRedirect(
    input: JpegQualityRedirectInput
): Record<string, unknown> {
    const redirectedParams = { ...input.redirectedParams };
    if (hasExplicitQuality(input.requestedQuality)) {
        redirectedParams.quality = input.requestedQuality;
        return redirectedParams;
    }
    if (isJpegFormat(input.targetFormat)) {
        redirectedParams.quality = getOriginatingDefaultQuality(input.sourceTool);
    }
    return redirectedParams;
}
