import type { PhotoshopHistoryStateRef } from './photoshop-history-state-ref';

export const LAYER_ORGANIZATION_VISUAL_EQUIVALENCE_VERSION =
    'layer-organization-visual-equivalence/v1' as const;

export interface LayerOrganizationVisualRegion {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface LayerOrganizationVisualFingerprintObservation {
    sourceId: string;
    region: LayerOrganizationVisualRegion | null;
    fingerprint: string;
}

export interface LayerOrganizationVisualEquivalenceComparison {
    sourceId: string;
    region: LayerOrganizationVisualRegion | null;
    beforeFingerprint: string;
    afterFingerprint: string;
    equivalent: boolean;
}

export interface LayerOrganizationVisualEquivalenceReceipt {
    version: typeof LAYER_ORGANIZATION_VISUAL_EQUIVALENCE_VERSION;
    status: 'equivalent' | 'changed' | 'unavailable';
    beforeHistoryStateRef: PhotoshopHistoryStateRef;
    afterHistoryStateRef: PhotoshopHistoryStateRef;
    expectedRegionCount: number;
    comparedRegionCount: number;
    comparisons: LayerOrganizationVisualEquivalenceComparison[];
    issues: string[];
}

const SHA256_FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/i;

function normalizeRegion(
    value: LayerOrganizationVisualRegion | null
): LayerOrganizationVisualRegion | null {
    if (!value) return null;
    const x = Number(value.x);
    const y = Number(value.y);
    const width = Number(value.width);
    const height = Number(value.height);
    if (![x, y, width, height].every(Number.isFinite)
        || width <= 0
        || height <= 0) {
        return null;
    }
    return {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height)
    };
}

function sameRegion(
    left: LayerOrganizationVisualRegion | null,
    right: LayerOrganizationVisualRegion | null
): boolean {
    if (!left || !right) return left === right;
    return left.x === right.x
        && left.y === right.y
        && left.width === right.width
        && left.height === right.height;
}

function normalizeObservation(
    value: LayerOrganizationVisualFingerprintObservation | undefined
): LayerOrganizationVisualFingerprintObservation | undefined {
    if (!value) return undefined;
    const sourceId = String(value.sourceId || '').trim();
    const fingerprint = String(value.fingerprint || '').trim().toLowerCase();
    if (!sourceId || !SHA256_FINGERPRINT_PATTERN.test(fingerprint)) {
        return undefined;
    }
    const region = normalizeRegion(value.region);
    if (value.region && !region) return undefined;
    return { sourceId, region, fingerprint };
}

export function buildLayerOrganizationVisualEquivalenceReceipt(input: {
    beforeHistoryStateRef: PhotoshopHistoryStateRef;
    afterHistoryStateRef: PhotoshopHistoryStateRef;
    before: readonly LayerOrganizationVisualFingerprintObservation[];
    after: readonly LayerOrganizationVisualFingerprintObservation[];
}): LayerOrganizationVisualEquivalenceReceipt {
    const expectedRegionCount = input.before.length;
    const comparisons: LayerOrganizationVisualEquivalenceComparison[] = [];
    const issues: string[] = [];

    if (expectedRegionCount <= 0) {
        issues.push('没有取得整理前画布指纹。');
    }
    if (input.after.length !== expectedRegionCount) {
        issues.push(
            `整理前后区域数量不一致（before=${expectedRegionCount}, after=${input.after.length}）。`
        );
    }

    const comparisonCount = Math.min(expectedRegionCount, input.after.length);
    for (let index = 0; index < comparisonCount; index += 1) {
        const before = normalizeObservation(input.before[index]);
        const after = normalizeObservation(input.after[index]);
        if (!before || !after) {
            issues.push(`第 ${index + 1} 个区域缺少有效的原始画布 SHA-256 指纹。`);
            continue;
        }
        if (!sameRegion(before.region, after.region)) {
            issues.push(`第 ${index + 1} 个区域的整理前后裁切范围不一致。`);
            continue;
        }
        const equivalent = before.fingerprint === after.fingerprint;
        comparisons.push({
            sourceId: after.sourceId,
            region: after.region,
            beforeFingerprint: before.fingerprint,
            afterFingerprint: after.fingerprint,
            equivalent
        });
        if (!equivalent) {
            issues.push(`第 ${index + 1} 个区域的原始画布像素发生变化。`);
        }
    }

    let status: LayerOrganizationVisualEquivalenceReceipt['status'] = 'unavailable';
    if (comparisons.length === expectedRegionCount
        && comparisons.length === input.after.length) {
        status = comparisons.every((item) => item.equivalent)
            ? 'equivalent'
            : 'changed';
    }

    return {
        version: LAYER_ORGANIZATION_VISUAL_EQUIVALENCE_VERSION,
        status,
        beforeHistoryStateRef: input.beforeHistoryStateRef,
        afterHistoryStateRef: input.afterHistoryStateRef,
        expectedRegionCount,
        comparedRegionCount: comparisons.length,
        comparisons,
        issues
    };
}

export function isLayerOrganizationVisualEquivalenceReceipt(
    value: unknown
): value is LayerOrganizationVisualEquivalenceReceipt {
    if (!value || typeof value !== 'object') return false;
    const receipt = value as LayerOrganizationVisualEquivalenceReceipt;
    return receipt.version === LAYER_ORGANIZATION_VISUAL_EQUIVALENCE_VERSION
        && ['equivalent', 'changed', 'unavailable'].includes(receipt.status)
        && Number.isInteger(receipt.expectedRegionCount)
        && receipt.expectedRegionCount >= 0
        && Number.isInteger(receipt.comparedRegionCount)
        && receipt.comparedRegionCount >= 0
        && Array.isArray(receipt.comparisons)
        && Array.isArray(receipt.issues)
        && Number.isInteger(Number(receipt.beforeHistoryStateRef?.documentId))
        && Number.isInteger(Number(receipt.beforeHistoryStateRef?.historyStateId))
        && Number.isInteger(Number(receipt.afterHistoryStateRef?.documentId))
        && Number.isInteger(Number(receipt.afterHistoryStateRef?.historyStateId));
}

export function isLayerOrganizationVisualEquivalenceProven(
    value: unknown
): value is LayerOrganizationVisualEquivalenceReceipt {
    return isLayerOrganizationVisualEquivalenceReceipt(value)
        && value.status === 'equivalent'
        && value.expectedRegionCount > 0
        && value.comparedRegionCount === value.expectedRegionCount
        && value.comparisons.length === value.expectedRegionCount
        && value.comparisons.every((item) => item.equivalent);
}
