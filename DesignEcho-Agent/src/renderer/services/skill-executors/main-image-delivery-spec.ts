import {
    MAIN_IMAGE_DELIVERY_DOCUMENTS,
    resolveMainImageProductionSizeKey,
    type MainImageDeliveryFolderKey,
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

export type MainImagePrepareSizeResolutionStatus =
    | 'resolved'
    | 'missing'
    | 'multiple'
    | 'invalid'
    | 'custom_not_supported'
    | 'conflict';

export interface MainImagePrepareSizeResolution {
    status: MainImagePrepareSizeResolutionStatus;
    sizeKey?: MainImageDeliveryFolderKey;
    standardSizeKeys: MainImageDeliveryFolderKey[];
    requestedValues: string[];
    invalidValues: string[];
    customSizeProvided: boolean;
}

export interface MainImagePrepareSizeInput {
    size?: unknown;
    sizes?: unknown;
    customSize?: unknown;
    targetSize?: unknown;
    canvasSize?: unknown;
}

function hasOwnValue(input: MainImagePrepareSizeInput, key: keyof MainImagePrepareSizeInput): boolean {
    return Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined;
}

function formatRequestedSizeValue(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (value === null) return 'null';
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '[invalid-size-value]';
}

function isCustomPrepareSizeToken(value: unknown): boolean {
    return typeof value === 'string' && value.trim().toLowerCase() === 'custom';
}

/**
 * Resolve the one standard workspace that open-creative `prepare` may create.
 *
 * This deliberately does not infer a standard workspace from a custom ratio or pixel size.
 * Choosing 800/750/1200 remains an Agent/user decision; the Skill only validates it before
 * any Photoshop Host operation can begin.
 */
export function resolveMainImagePrepareSize(
    params?: MainImagePrepareSizeInput | null
): MainImagePrepareSizeResolution {
    const input = params || {};
    const sizeProvided = hasOwnValue(input, 'size');
    const sizesProvided = hasOwnValue(input, 'sizes');
    const requested: unknown[] = sizeProvided ? [input.size] : [];
    if (sizesProvided) requested.push(...(Array.isArray(input.sizes) ? input.sizes : [input.sizes]));
    const requestedValues = requested.map(formatRequestedSizeValue);
    const customSizeProvided = ['customSize', 'targetSize', 'canvasSize'].some((key) => {
        const typedKey = key as keyof MainImagePrepareSizeInput;
        return hasOwnValue(input, typedKey) && input[typedKey] !== null;
    });
    const hasCustomToken = sizeProvided && isCustomPrepareSizeToken(input.size);
    if (sizesProvided) {
        const multipleRequested = Array.isArray(input.sizes) && input.sizes.length > 1;
        return {
            status: multipleRequested ? 'multiple' : 'conflict',
            standardSizeKeys: [],
            requestedValues,
            invalidValues: [],
            customSizeProvided
        };
    }
    if (hasCustomToken || customSizeProvided) {
        return {
            status: sizeProvided && !hasCustomToken ? 'conflict' : 'custom_not_supported',
            standardSizeKeys: [],
            requestedValues,
            invalidValues: [],
            customSizeProvided
        };
    }
    if (!sizeProvided || formatRequestedSizeValue(input.size) === '') {
        return {
            status: 'missing',
            standardSizeKeys: [],
            requestedValues,
            invalidValues: [],
            customSizeProvided
        };
    }
    const sizeKey = typeof input.size === 'string'
        && ['800', '750', '1200'].includes(input.size.trim())
        ? input.size.trim() as MainImageDeliveryFolderKey
        : undefined;
    if (!sizeKey) {
        const invalidValue = formatRequestedSizeValue(input.size);
        return {
            status: 'invalid',
            standardSizeKeys: [],
            requestedValues,
            invalidValues: [invalidValue],
            customSizeProvided
        };
    }
    return {
        status: 'resolved',
        sizeKey,
        standardSizeKeys: [sizeKey],
        requestedValues,
        invalidValues: [],
        customSizeProvided
    };
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
