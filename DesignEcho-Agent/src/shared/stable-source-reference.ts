/**
 * Stable evidence references shared by delivery conventions and Design Project State.
 *
 * Opaque references identify an already-governed record; they are not filesystem paths
 * or URLs. Project files use the explicit project-file prefix and remain project-relative.
 */

export interface StableSourceReferenceOptions {
    allowedOpaquePrefixes?: readonly string[];
    allowProjectFile?: boolean;
    maxLength?: number;
}

const DEFAULT_MAX_REFERENCE_LENGTH = 240;
const OPAQUE_PREFIX = /^[a-z][a-z0-9._-]{0,47}$/i;
const OPAQUE_PAYLOAD = /^[a-z0-9][a-z0-9._-]{0,191}$/i;
const SENSITIVE_REFERENCE = /(?:api[_-]?key|authorization|bearer|credential|password|secret|token)/i;
const WINDOWS_RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function cleanReferenceText(value: unknown, maxLength: number): string {
    const text = String(value || '').trim();
    return text.length <= maxLength ? text : '';
}

export function normalizeStableProjectRelativePath(value: unknown): string | undefined {
    const raw = String(value || '').trim().replace(/\\/g, '/');
    if (!raw
        || raw.startsWith('/')
        || /^[a-z]:/i.test(raw)
        || raw.includes('\0')) {
        return undefined;
    }
    const segments = raw.split('/');
    if (segments.length === 0 || segments.some((segment) => (
        !segment
        || segment === '.'
        || segment === '..'
        || /[<>:"|?*\x00-\x1F]/.test(segment)
        || /[. ]$/.test(segment)
        || WINDOWS_RESERVED_SEGMENT.test(segment)
    ))) {
        return undefined;
    }
    return segments.join('/');
}

function normalizeOpaqueReference(
    prefix: string,
    payload: string,
    options: StableSourceReferenceOptions
): string | undefined {
    const allowedPrefixes = options.allowedOpaquePrefixes
        ? new Set(options.allowedOpaquePrefixes.map((item) => String(item || '').trim().toLowerCase()))
        : undefined;
    const normalizedPrefix = prefix.toLowerCase();
    if (!OPAQUE_PREFIX.test(prefix)
        || (allowedPrefixes && !allowedPrefixes.has(normalizedPrefix))
        || !OPAQUE_PAYLOAD.test(payload)
        || SENSITIVE_REFERENCE.test(`${prefix}:${payload}`)) {
        return undefined;
    }
    return `${normalizedPrefix}:${payload}`;
}

export function normalizeStableSourceReference(
    value: unknown,
    options: StableSourceReferenceOptions = {}
): string | undefined {
    const maxLength = Number.isSafeInteger(options.maxLength) && Number(options.maxLength) > 0
        ? Number(options.maxLength)
        : DEFAULT_MAX_REFERENCE_LENGTH;
    const text = cleanReferenceText(value, maxLength);
    const separatorIndex = text.indexOf(':');
    if (!text
        || separatorIndex <= 0
        || separatorIndex !== text.lastIndexOf(':')) {
        return undefined;
    }
    const prefix = text.slice(0, separatorIndex);
    const payload = text.slice(separatorIndex + 1);
    if (prefix.toLowerCase() === 'project-file') {
        if (options.allowProjectFile !== true) return undefined;
        const projectRelativePath = normalizeStableProjectRelativePath(payload);
        return projectRelativePath ? `project-file:${projectRelativePath}` : undefined;
    }
    return normalizeOpaqueReference(prefix, payload, options);
}

export function normalizeStableSourceReferenceList(
    value: unknown,
    options: StableSourceReferenceOptions & { maxItems?: number } = {}
): { refs: string[]; invalidCount: number } {
    if (!Array.isArray(value)) return { refs: [], invalidCount: 1 };
    const maxItems = Number.isSafeInteger(options.maxItems) && Number(options.maxItems) > 0
        ? Number(options.maxItems)
        : 12;
    const refs: string[] = [];
    let invalidCount = 0;
    for (const candidate of value.slice(0, maxItems + 1)) {
        const normalized = normalizeStableSourceReference(candidate, options);
        if (!normalized) {
            invalidCount += 1;
            continue;
        }
        if (!refs.includes(normalized)) refs.push(normalized);
    }
    if (value.length > maxItems) invalidCount += value.length - maxItems;
    return { refs: refs.slice(0, maxItems), invalidCount };
}
