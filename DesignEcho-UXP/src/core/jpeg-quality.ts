/**
 * Normalize the public JPEG quality input to Photoshop's native 1-12 scale.
 *
 * Historical callers use percentage-style values such as 80/85, while
 * Photoshop-aware callers use the native 1-12 scale. Keep both forms
 * unambiguous: native values remain unchanged and only 13-100 are mapped.
 */
export function normalizePhotoshopJpegQuality(
    quality: unknown,
    fallbackQuality: number = 12
): number {
    const requested = Number(quality);
    const fallback = Number(fallbackQuality);
    let resolved: number;
    if (quality !== null && quality !== '' && Number.isFinite(requested)) {
        resolved = requested;
    } else if (Number.isFinite(fallback)) {
        resolved = fallback;
    } else {
        resolved = 12;
    }

    if (resolved <= 12) {
        return Math.max(1, Math.min(12, Math.round(resolved)));
    }

    const percentage = Math.max(13, Math.min(100, Math.round(resolved)));
    return Math.max(1, Math.min(12, Math.round(percentage / 100 * 12)));
}
