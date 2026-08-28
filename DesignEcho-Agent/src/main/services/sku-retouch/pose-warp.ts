import type { SkuPoseAlignmentOptions } from '../../../shared/sku-pose-alignment-contract';
import type { SkuRetouchRaster, SkuRetouchShapeAnalysis } from './geometry';
import {
    evaluateSkuPosePolynomial,
    sampleSkuPoseShapeRow,
    type SkuPoseSkeletonFit
} from './pose-skeleton';

export interface SkuPoseWarpMap {
    coefficients: [number, number, number];
    targetCenterNormalized: number;
    topNormalized: number;
    bottomNormalized: number;
    canvasAspectRatio: number;
}

export interface SkuPoseWarpSafety {
    minJacobianDeterminant: number;
    maxLocalScaleDeviation: number;
}

interface NormalizedPoint {
    x: number;
    y: number;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function lerp(start: number, end: number, amount: number): number {
    return start + (end - start) * amount;
}

export function createSkuPoseWarpMap(input: {
    fit: SkuPoseSkeletonFit;
    shape: SkuRetouchShapeAnalysis;
    width: number;
    height: number;
}): SkuPoseWarpMap {
    return {
        coefficients: input.fit.coefficients,
        targetCenterNormalized: input.fit.targetCenterNormalized,
        topNormalized: input.shape.bounds.top / input.height,
        bottomNormalized: input.shape.bounds.bottom / input.height,
        canvasAspectRatio: input.width / input.height
    };
}

function rowStrength(
    normalizedY: number,
    map: SkuPoseWarpMap,
    options: Required<SkuPoseAlignmentOptions>
): number {
    const subjectHeight = Math.max(1e-6, map.bottomNormalized - map.topNormalized);
    const subjectOffset = clamp((normalizedY - map.topNormalized) / subjectHeight, 0, 1);
    if (options.cuffLockRatio <= 0) return options.strength;
    if (subjectOffset <= options.cuffLockRatio) return 0;
    const transitionRatio = Math.min(0.08, Math.max(0.025, options.cuffLockRatio * 0.35));
    if (subjectOffset >= options.cuffLockRatio + transitionRatio) return options.strength;
    const amount = (subjectOffset - options.cuffLockRatio) / transitionRatio;
    return options.strength * amount * amount * (3 - 2 * amount);
}

function inverseMapPoint(
    point: NormalizedPoint,
    map: SkuPoseWarpMap,
    options: Required<SkuPoseAlignmentOptions>,
    maximumRotationDeg: number
): NormalizedPoint {
    const normalizedY = clamp(point.y, map.topNormalized, map.bottomNormalized);
    const subjectHeight = Math.max(1e-6, map.bottomNormalized - map.topNormalized);
    const subjectY = (normalizedY - map.topNormalized) / subjectHeight;
    const fitY = subjectY * 2 - 1;
    const sourceCenter = evaluateSkuPosePolynomial(map.coefficients, fitY);
    const strength = rowStrength(normalizedY, map, options);
    const derivativeBySubjectY = 2 * (map.coefficients[1] + 2 * map.coefficients[2] * fitY);
    const derivativeByCanvasY = derivativeBySubjectY * map.canvasAspectRatio / subjectHeight;
    const maximumRotation = maximumRotationDeg * Math.PI / 180;
    const rotation = clamp(Math.atan(derivativeByCanvasY) * strength, -maximumRotation, maximumRotation);
    const effectiveCenter = map.targetCenterNormalized
        + (sourceCenter - map.targetCenterNormalized) * (1 - strength);
    const crossSectionOffset = point.x - effectiveCenter;
    return {
        x: sourceCenter + crossSectionOffset * Math.cos(rotation),
        y: point.y + crossSectionOffset * map.canvasAspectRatio * Math.sin(rotation)
    };
}

function inverseMapThroughPlan(
    point: NormalizedPoint,
    maps: SkuPoseWarpMap[],
    options: Required<SkuPoseAlignmentOptions>,
    maximumRotationDeg: number
): NormalizedPoint {
    let mapped = point;
    for (let index = maps.length - 1; index >= 0; index -= 1) {
        mapped = inverseMapPoint(mapped, maps[index], options, maximumRotationDeg);
    }
    return mapped;
}

function sampleBilinear(
    data: Buffer,
    width: number,
    height: number,
    channels: number,
    x: number,
    y: number,
    channel: number
): number {
    const safeX = clamp(x, 0, width - 1);
    const safeY = clamp(y, 0, height - 1);
    const x0 = Math.floor(safeX);
    const y0 = Math.floor(safeY);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const amountX = safeX - x0;
    const amountY = safeY - y0;
    const top = lerp(
        data[(y0 * width + x0) * channels + channel],
        data[(y0 * width + x1) * channels + channel],
        amountX
    );
    const bottom = lerp(
        data[(y1 * width + x0) * channels + channel],
        data[(y1 * width + x1) * channels + channel],
        amountX
    );
    return lerp(top, bottom, amountY);
}

export function transformSkuPoseMask(input: {
    source: Buffer;
    width: number;
    height: number;
    maps: SkuPoseWarpMap[];
    options: Required<SkuPoseAlignmentOptions>;
    maximumRotationDeg: number;
}): Buffer {
    const output = Buffer.alloc(input.width * input.height);
    for (let y = 0; y < input.height; y += 1) {
        for (let x = 0; x < input.width; x += 1) {
            const mapped = inverseMapThroughPlan({
                x: (x + 0.5) / input.width,
                y: (y + 0.5) / input.height
            }, input.maps, input.options, input.maximumRotationDeg);
            const sourceX = mapped.x * input.width - 0.5;
            const sourceY = mapped.y * input.height - 0.5;
            output[y * input.width + x] = Math.round(sampleBilinear(
                input.source,
                input.width,
                input.height,
                1,
                sourceX,
                sourceY,
                0
            ));
        }
    }
    return output;
}

export function transformSkuPoseRaster(input: {
    raster: SkuRetouchRaster;
    mask: Buffer;
    maps: SkuPoseWarpMap[];
    options: Required<SkuPoseAlignmentOptions>;
    maximumRotationDeg: number;
}): { raster: SkuRetouchRaster; mask: Buffer } {
    const { width, height } = input.raster;
    const outputRgb = Buffer.alloc(width * height * 3);
    const outputMask = Buffer.alloc(width * height);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const mapped = inverseMapThroughPlan({
                x: (x + 0.5) / width,
                y: (y + 0.5) / height
            }, input.maps, input.options, input.maximumRotationDeg);
            const sourceX = mapped.x * width - 0.5;
            const sourceY = mapped.y * height - 0.5;
            const pixelIndex = y * width + x;
            for (let channel = 0; channel < 3; channel += 1) {
                outputRgb[pixelIndex * 3 + channel] = Math.round(sampleBilinear(
                    input.raster.data,
                    width,
                    height,
                    3,
                    sourceX,
                    sourceY,
                    channel
                ));
            }
            outputMask[pixelIndex] = Math.round(sampleBilinear(
                input.mask,
                width,
                height,
                1,
                sourceX,
                sourceY,
                0
            ));
        }
    }
    return {
        raster: { data: outputRgb, width, height, channels: 3 },
        mask: outputMask
    };
}

export function measureSkuPoseWarpSafety(input: {
    shape: SkuRetouchShapeAnalysis;
    width: number;
    height: number;
    maps: SkuPoseWarpMap[];
    options: Required<SkuPoseAlignmentOptions>;
    maximumRotationDeg: number;
}): SkuPoseWarpSafety {
    let minimumDeterminant = Number.POSITIVE_INFINITY;
    let maximumScaleDeviation = 0;
    const xStep = 1 / input.width;
    const yStep = 1 / input.height;
    const rowSamples = 28;
    const crossSamples = 5;
    for (let rowIndex = 0; rowIndex < rowSamples; rowIndex += 1) {
        const normalizedSubjectY = rowIndex / (rowSamples - 1);
        const row = sampleSkuPoseShapeRow(input.shape, normalizedSubjectY);
        const y = (
            input.shape.bounds.top
            + normalizedSubjectY * Math.max(1, input.shape.bounds.height - 1)
            + 0.5
        ) / input.height;
        for (let crossIndex = 0; crossIndex < crossSamples; crossIndex += 1) {
            const x = (
                lerp(row.left, row.right, crossIndex / (crossSamples - 1))
                + 0.5
            ) / input.width;
            const center = inverseMapThroughPlan(
                { x, y },
                input.maps,
                input.options,
                input.maximumRotationDeg
            );
            const alongX = inverseMapThroughPlan(
                { x: x + xStep, y },
                input.maps,
                input.options,
                input.maximumRotationDeg
            );
            const alongY = inverseMapThroughPlan(
                { x, y: y + yStep },
                input.maps,
                input.options,
                input.maximumRotationDeg
            );
            const a = (alongX.x - center.x) * input.width;
            const b = (alongY.x - center.x) * input.width;
            const c = (alongX.y - center.y) * input.height;
            const d = (alongY.y - center.y) * input.height;
            const determinant = a * d - b * c;
            minimumDeterminant = Math.min(minimumDeterminant, determinant);
            const trace = a * a + b * b + c * c + d * d;
            const discriminant = Math.sqrt(Math.max(0, trace * trace - 4 * determinant * determinant));
            const maximumScale = Math.sqrt(Math.max(0, (trace + discriminant) / 2));
            const minimumScale = Math.sqrt(Math.max(0, (trace - discriminant) / 2));
            maximumScaleDeviation = Math.max(
                maximumScaleDeviation,
                Math.abs(maximumScale - 1),
                Math.abs(minimumScale - 1)
            );
        }
    }
    return {
        minJacobianDeterminant: Number.isFinite(minimumDeterminant) ? minimumDeterminant : 0,
        maxLocalScaleDeviation: maximumScaleDeviation
    };
}
