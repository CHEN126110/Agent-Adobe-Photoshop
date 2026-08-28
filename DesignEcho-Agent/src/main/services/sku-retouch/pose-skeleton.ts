import {
    type SkuRetouchRowProfile,
    type SkuRetouchShapeAnalysis
} from './geometry';

export interface SkuPoseSkeletonFit {
    coefficients: [number, number, number];
    targetCenterNormalized: number;
    coverageRatio: number;
    residualRatio: number;
    bendRatio: number;
    maxRotationDeg: number;
}

export interface SkuPoseMaskMeasurement {
    pixels: number;
    insets: {
        top: number;
        right: number;
        bottom: number;
        left: number;
    };
}

interface SkeletonSample {
    normalizedY: number;
    normalizedCenter: number;
}

const MASK_MEASUREMENT_THRESHOLD = 104;

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function lerp(start: number, end: number, amount: number): number {
    return start + (end - start) * amount;
}

function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = values.slice().sort((first, second) => first - second);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[middle];
    return (sorted[middle - 1] + sorted[middle]) / 2;
}

export function evaluateSkuPosePolynomial(
    coefficients: [number, number, number],
    normalizedY: number
): number {
    return coefficients[0]
        + coefficients[1] * normalizedY
        + coefficients[2] * normalizedY * normalizedY;
}

function solveQuadratic(samples: SkeletonSample[]): [number, number, number] | null {
    let count = 0;
    let sumT = 0;
    let sumT2 = 0;
    let sumT3 = 0;
    let sumT4 = 0;
    let sumC = 0;
    let sumTC = 0;
    let sumT2C = 0;
    for (const sample of samples) {
        const t = sample.normalizedY;
        const t2 = t * t;
        count += 1;
        sumT += t;
        sumT2 += t2;
        sumT3 += t2 * t;
        sumT4 += t2 * t2;
        sumC += sample.normalizedCenter;
        sumTC += t * sample.normalizedCenter;
        sumT2C += t2 * sample.normalizedCenter;
    }
    const matrix = [
        [count, sumT, sumT2, sumC],
        [sumT, sumT2, sumT3, sumTC],
        [sumT2, sumT3, sumT4, sumT2C]
    ];
    for (let column = 0; column < 3; column += 1) {
        let pivot = column;
        for (let row = column + 1; row < 3; row += 1) {
            if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
        }
        const pivotRow = matrix[pivot];
        matrix[pivot] = matrix[column];
        matrix[column] = pivotRow;
        if (Math.abs(matrix[column][column]) < 1e-10) return null;
        for (let row = column + 1; row < 3; row += 1) {
            const factor = matrix[row][column] / matrix[column][column];
            for (let valueColumn = column; valueColumn < 4; valueColumn += 1) {
                matrix[row][valueColumn] -= factor * matrix[column][valueColumn];
            }
        }
    }
    const quadratic = matrix[2][3] / matrix[2][2];
    const linear = (matrix[1][3] - matrix[1][2] * quadratic) / matrix[1][1];
    const constant = (
        matrix[0][3]
        - matrix[0][1] * linear
        - matrix[0][2] * quadratic
    ) / matrix[0][0];
    if (![constant, linear, quadratic].every(Number.isFinite)) return null;
    return [constant, linear, quadratic];
}

function collectSkeletonSamples(
    shape: SkuRetouchShapeAnalysis,
    canvasWidth: number
): SkeletonSample[] {
    const widths: number[] = [];
    for (let y = shape.bounds.top; y < shape.bounds.bottom; y += 1) {
        if (shape.rows[y]?.valid) widths.push(shape.rows[y].width);
    }
    const medianWidth = Math.max(1, median(widths));
    const samples: SkeletonSample[] = [];
    const subjectHeight = Math.max(1, shape.bounds.height - 1);
    for (let y = shape.bounds.top; y < shape.bounds.bottom; y += 1) {
        const row = shape.rows[y];
        if (!row?.valid) continue;
        if (row.width < medianWidth * 0.58 || row.width > medianWidth * 1.55) continue;
        const subjectY = (y - shape.bounds.top) / subjectHeight;
        samples.push({
            normalizedY: subjectY * 2 - 1,
            normalizedCenter: row.center / canvasWidth
        });
    }
    return samples;
}

export function fitSkuPoseSkeleton(
    shape: SkuRetouchShapeAnalysis,
    canvasWidth: number
): SkuPoseSkeletonFit | null {
    const initialSamples = collectSkeletonSamples(shape, canvasWidth);
    if (initialSamples.length < 30) return null;
    let coefficients = solveQuadratic(initialSamples);
    if (!coefficients) return null;

    const residuals = initialSamples.map((sample) => (
        Math.abs(evaluateSkuPosePolynomial(coefficients!, sample.normalizedY) - sample.normalizedCenter)
        * canvasWidth
    ));
    const residualMedian = median(residuals);
    const residualMad = median(residuals.map((value) => Math.abs(value - residualMedian)));
    const robustLimitPx = Math.max(1.25, residualMedian + Math.max(1, residualMad * 3.5));
    const robustSamples = initialSamples.filter((sample, index) => residuals[index] <= robustLimitPx);
    if (robustSamples.length >= 30 && robustSamples.length >= initialSamples.length * 0.72) {
        coefficients = solveQuadratic(robustSamples);
        if (!coefficients) return null;
    }

    const samples = robustSamples.length >= 30 ? robustSamples : initialSamples;
    const targetCenterNormalized = evaluateSkuPosePolynomial(coefficients, 0);
    let totalResidualPx = 0;
    let maxShiftPx = 0;
    let maxRotationDeg = 0;
    for (const sample of samples) {
        const predicted = evaluateSkuPosePolynomial(coefficients, sample.normalizedY);
        totalResidualPx += Math.abs(predicted - sample.normalizedCenter) * canvasWidth;
        maxShiftPx = Math.max(maxShiftPx, Math.abs(predicted - targetCenterNormalized) * canvasWidth);
        const derivativeBySubjectY = 2 * (coefficients[1] + 2 * coefficients[2] * sample.normalizedY);
        const derivativeByCanvasY = derivativeBySubjectY * canvasWidth / Math.max(1, shape.bounds.height);
        maxRotationDeg = Math.max(maxRotationDeg, Math.abs(Math.atan(derivativeByCanvasY) * 180 / Math.PI));
    }
    return {
        coefficients,
        targetCenterNormalized,
        coverageRatio: samples.length / Math.max(1, shape.bounds.height),
        residualRatio: totalResidualPx / Math.max(1, samples.length) / Math.max(1, shape.bounds.width),
        bendRatio: maxShiftPx / Math.max(1, shape.bounds.width),
        maxRotationDeg
    };
}

export function measureSkuPoseMask(
    mask: Buffer,
    width: number,
    height: number
): SkuPoseMaskMeasurement {
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    let pixels = 0;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            if (mask[y * width + x] < MASK_MEASUREMENT_THRESHOLD) continue;
            pixels += 1;
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x);
            bottom = Math.max(bottom, y);
        }
    }
    if (pixels === 0) {
        return { pixels: 0, insets: { top: 0, right: 0, bottom: 0, left: 0 } };
    }
    return {
        pixels,
        insets: {
            top,
            right: width - right - 1,
            bottom: height - bottom - 1,
            left
        }
    };
}

export function skuPoseInsetsMeetMinimum(
    insets: SkuPoseMaskMeasurement['insets'],
    minimum: number
): boolean {
    return Object.values(insets).every((value) => value >= minimum);
}

export function sampleSkuPoseShapeRow(
    shape: SkuRetouchShapeAnalysis,
    normalizedY: number
): SkuRetouchRowProfile {
    const sourceY = shape.bounds.top + clamp(normalizedY, 0, 1) * Math.max(1, shape.bounds.height - 1);
    const firstY = clamp(Math.floor(sourceY), shape.bounds.top, shape.bounds.bottom - 1);
    const secondY = clamp(firstY + 1, shape.bounds.top, shape.bounds.bottom - 1);
    const amount = sourceY - firstY;
    const first = shape.rows[firstY];
    const second = shape.rows[secondY];
    return {
        left: lerp(first.left, second.left, amount),
        right: lerp(first.right, second.right, amount),
        center: lerp(first.center, second.center, amount),
        width: lerp(first.width, second.width, amount),
        valid: first.valid && second.valid
    };
}

export function measureSkuPoseCuffDrift(
    source: SkuRetouchShapeAnalysis,
    output: SkuRetouchShapeAnalysis,
    cuffLockRatio: number
): number | null {
    if (cuffLockRatio <= 0) return null;
    const samples = 16;
    let total = 0;
    for (let index = 0; index < samples; index += 1) {
        const normalizedY = (index / (samples - 1)) * cuffLockRatio;
        const sourceRow = sampleSkuPoseShapeRow(source, normalizedY);
        const outputRow = sampleSkuPoseShapeRow(output, normalizedY);
        total += Math.abs(sourceRow.center - outputRow.center) / Math.max(1, source.bounds.width);
        total += Math.abs(sourceRow.width - outputRow.width) / Math.max(1, source.bounds.width);
    }
    return total / samples;
}
