import {
    MAIN_IMAGE_DELIVERY_DOCUMENTS,
    resolveMainImageProductionSizeKey,
    type MainImageDeliveryDocumentSpec
} from '../../../shared/main-image-production-spec';

export const MAIN_IMAGE_DEFAULT_SIZE_KEYS = MAIN_IMAGE_DELIVERY_DOCUMENTS.map((document) => document.folderKey);

function buildMainImageSizeSpecs(): Record<string, { width: number; height: number }> {
    const specs: Record<string, { width: number; height: number }> = {};
    for (const document of MAIN_IMAGE_DELIVERY_DOCUMENTS) {
        const size = { width: document.canvasSize.width, height: document.canvasSize.height };
        specs[document.folderKey] = size;
        specs[document.ratio] = size;
    }
    return specs;
}

export const MAIN_IMAGE_SIZE_SPECS: Readonly<Record<string, { width: number; height: number }>> = Object.freeze(
    buildMainImageSizeSpecs()
);

function normalizeMainImageSizeKey(value: unknown): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return resolveMainImageProductionSizeKey(raw) || raw;
}

export function resolveMainImageSizeKeys(params?: {
    size?: unknown;
    sizes?: unknown;
} | null): string[] {
    const sizes = Array.isArray(params?.sizes) ? params.sizes : [];
    const explicit = sizes.length > 0 ? sizes : (params?.size ? [params.size] : []);
    const source = explicit.length > 0 ? explicit : MAIN_IMAGE_DEFAULT_SIZE_KEYS;
    const resolved = source
        .map(normalizeMainImageSizeKey)
        .filter((key) => Boolean(MAIN_IMAGE_SIZE_SPECS[key]));
    return Array.from(new Set(resolved));
}

export function getMainImageDeliveryDocument(sizeKey: unknown): MainImageDeliveryDocumentSpec | null {
    const key = normalizeMainImageSizeKey(sizeKey);
    return MAIN_IMAGE_DELIVERY_DOCUMENTS.find((document) => (
        document.folderKey === key || document.ratio === key
    )) || null;
}
