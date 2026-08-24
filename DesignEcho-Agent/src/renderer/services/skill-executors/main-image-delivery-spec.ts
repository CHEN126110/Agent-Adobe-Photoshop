import {
    MAIN_IMAGE_DELIVERY_DOCUMENTS,
    type MainImageDeliveryDocumentSpec
} from '../../../shared/main-image-design-core';

export const MAIN_IMAGE_DEFAULT_SIZE_KEYS = MAIN_IMAGE_DELIVERY_DOCUMENTS.map((document) => document.folderKey);

const MAIN_IMAGE_SIZE_KEY_ALIASES: Readonly<Record<string, string>> = Object.freeze({
    '1:1': '800',
    '1x1': '800',
    'tmall-1x1-main-image': '800',
    'tmall-800-main-image': '800',
    '800x800': '800',
    '1440x1440': '800',
    '方图': '800',
    '方形': '800',
    '3:4': '750',
    '3x4': '750',
    'tmall-3x4-main-image': '750',
    'tmall-750-main-image': '750',
    '750x1000': '750',
    '1440x1920': '750',
    '竖图': '750',
    '竖版': '750',
    '9:16': '1200',
    '9x16': '1200',
    'tmall-9x16-main-image': '1200',
    'tmall-9:16-main-image': '1200',
    'tmall-1200-main-image': '1200',
    '1200x1920': '1200',
    '1440x2560': '1200',
    '长图': '1200',
    '长竖图': '1200'
});

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
    const compact = raw.replace(/\s+/g, '').replace(/：/g, ':').toLowerCase();
    return MAIN_IMAGE_SIZE_KEY_ALIASES[compact] || MAIN_IMAGE_SIZE_KEY_ALIASES[raw] || raw;
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
