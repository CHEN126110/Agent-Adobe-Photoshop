export type PhotoshopBitDepth = 1 | 8 | 16 | 32;

export interface PhotoshopBitsPerChannelConstants {
    ONE?: unknown;
    EIGHT?: unknown;
    SIXTEEN?: unknown;
    THIRTYTWO?: unknown;
}

const DEPTH_BY_CONSTANT: ReadonlyArray<{
    key: keyof PhotoshopBitsPerChannelConstants;
    bitDepth: PhotoshopBitDepth;
}> = [
    { key: 'ONE', bitDepth: 1 },
    { key: 'EIGHT', bitDepth: 8 },
    { key: 'SIXTEEN', bitDepth: 16 },
    { key: 'THIRTYTWO', bitDepth: 32 }
];

function normalizeNumericBitDepth(value: unknown): PhotoshopBitDepth | undefined {
    const numeric = Number(value);
    if (numeric === 1 || numeric === 8 || numeric === 16 || numeric === 32) {
        return numeric;
    }
    return undefined;
}

/**
 * Resolve Photoshop's host enum without depending on its private serialized value.
 * Unknown host values stay unknown; this function never assumes that a document is 8-bit.
 */
export function resolvePhotoshopBitDepth(
    value: unknown,
    hostConstants?: PhotoshopBitsPerChannelConstants | null
): PhotoshopBitDepth | undefined {
    for (const candidate of DEPTH_BY_CONSTANT) {
        const hostValue = hostConstants?.[candidate.key];
        if (hostValue !== undefined && value === hostValue) {
            return candidate.bitDepth;
        }
    }
    return normalizeNumericBitDepth(value);
}
