import {
    EAGLE_ASSET_GROUP_LIMIT,
    buildEagleAssetRef,
    formatEagleAssetRefToken,
    isModelSafeEagleAssetRef,
    type EagleAssetRef
} from './eagle-asset-ref';

export const EAGLE_COMPOSER_DRAG_MIME = 'application/x-designecho-eagle-assets+json' as const;
export const EAGLE_COMPOSER_DRAG_VERSION = 'eagle-composer-drag/v0' as const;
export const EAGLE_COMPOSER_DRAG_MAX_BYTES = 64 * 1024;

export interface EagleComposerDragPayload {
    version: typeof EAGLE_COMPOSER_DRAG_VERSION;
    kind: 'eagle_asset_refs';
    assets: EagleAssetRef[];
}

export interface EagleComposerInsertRequest {
    revision: number;
    assetRefs: EagleAssetRef[];
}

const EAGLE_ASSET_REF_KEYS = new Set([
    'schemaVersion',
    'libraryId',
    'libraryName',
    'itemId',
    'name',
    'ext',
    'fileKind',
    'role',
    'tags',
    'folderPaths',
    'width',
    'height',
    'selectedAt'
]);

const EAGLE_COMPOSER_PAYLOAD_KEYS = new Set(['version', 'kind', 'assets']);
const EMBEDDED_PREVIEW_DATA_PATTERN = /(?:data:(?:image|video|application)\/[^;,\s]+(?:;base64)?,|blob:)/i;

export function normalizeEagleComposerAssetRefs(
    refs: readonly EagleAssetRef[]
): EagleAssetRef[] {
    return normalizeUnknownEagleComposerAssetRefs(refs);
}

export function serializeEagleComposerDragPayload(
    refs: readonly EagleAssetRef[]
): string | null {
    const assets = normalizeEagleComposerAssetRefs(refs);
    if (assets.length === 0) return null;

    const payload: EagleComposerDragPayload = {
        version: EAGLE_COMPOSER_DRAG_VERSION,
        kind: 'eagle_asset_refs',
        assets
    };
    const serialized = JSON.stringify(payload);
    return getUtf8ByteLength(serialized) <= EAGLE_COMPOSER_DRAG_MAX_BYTES
        ? serialized
        : null;
}

export function parseEagleComposerDragPayload(raw: string): EagleAssetRef[] | null {
    const serialized = String(raw || '').trim();
    if (!serialized || serialized.length > EAGLE_COMPOSER_DRAG_MAX_BYTES) return null;
    if (getUtf8ByteLength(serialized) > EAGLE_COMPOSER_DRAG_MAX_BYTES) return null;

    let parsed: unknown;
    try {
        parsed = JSON.parse(serialized);
    } catch {
        return null;
    }
    if (!isPlainRecord(parsed)) return null;
    if (!hasOnlyKeys(parsed, EAGLE_COMPOSER_PAYLOAD_KEYS)) return null;
    if (parsed.version !== EAGLE_COMPOSER_DRAG_VERSION) return null;
    if (parsed.kind !== 'eagle_asset_refs') return null;
    if (!Array.isArray(parsed.assets)) return null;

    const assets = normalizeUnknownEagleComposerAssetRefs(parsed.assets);
    return assets.length > 0 ? assets : null;
}

function normalizeUnknownEagleComposerAssetRefs(refs: unknown): EagleAssetRef[] {
    if (!Array.isArray(refs)) return [];
    const normalized: EagleAssetRef[] = [];
    const seen = new Set<string>();

    for (const candidate of refs) {
        if (normalized.length >= EAGLE_ASSET_GROUP_LIMIT) break;
        if (!isPlainRecord(candidate) || !hasOnlyKeys(candidate, EAGLE_ASSET_REF_KEYS)) continue;

        const assetRef = buildEagleAssetRef(candidate);
        if (!assetRef.libraryId || !assetRef.itemId) continue;
        if (!isModelSafeEagleAssetRef(assetRef)) continue;
        if (EMBEDDED_PREVIEW_DATA_PATTERN.test(JSON.stringify(assetRef))) continue;

        const token = formatEagleAssetRefToken(assetRef);
        if (!token || seen.has(token)) continue;
        seen.add(token);
        normalized.push(assetRef);
    }
    return normalized;
}

function hasOnlyKeys(record: Record<string, unknown>, allowedKeys: ReadonlySet<string>): boolean {
    return Object.keys(record).every((key) => allowedKeys.has(key));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function getUtf8ByteLength(value: string): number {
    return new TextEncoder().encode(value).byteLength;
}
