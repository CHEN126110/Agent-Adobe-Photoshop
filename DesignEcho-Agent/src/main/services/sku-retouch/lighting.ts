export interface SkuRetouchLowResolutionProduct {
    rgb: Buffer;
    alpha: Buffer;
    width: number;
    height: number;
}

export interface SkuRetouchNeutralGrayResult {
    neutralGray: Buffer;
    residualBefore: number;
    residualAfter: number;
    correctionMin: number;
    correctionMax: number;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
    const normalized = clamp((value - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
    return normalized * normalized * (3 - 2 * normalized);
}

function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
}

/** 积分图方框滤波，专门处理低分辨率光照场；不作用于商品高频纹理。 */
function boxBlurFloat(input: Float32Array, width: number, height: number, radius: number): Float32Array {
    const integralWidth = width + 1;
    const integral = new Float64Array(integralWidth * (height + 1));
    for (let y = 0; y < height; y += 1) {
        let rowSum = 0;
        for (let x = 0; x < width; x += 1) {
            rowSum += input[y * width + x];
            integral[(y + 1) * integralWidth + x + 1] = integral[y * integralWidth + x + 1] + rowSum;
        }
    }
    const output = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
        const top = Math.max(0, y - radius);
        const bottom = Math.min(height - 1, y + radius);
        for (let x = 0; x < width; x += 1) {
            const left = Math.max(0, x - radius);
            const right = Math.min(width - 1, x + radius);
            const sum = integral[(bottom + 1) * integralWidth + right + 1]
                - integral[top * integralWidth + right + 1]
                - integral[(bottom + 1) * integralWidth + left]
                + integral[top * integralWidth + left];
            output[y * width + x] = sum / ((right - left + 1) * (bottom - top + 1));
        }
    }
    return output;
}

function buildLowFrequencyField(product: SkuRetouchLowResolutionProduct): {
    field: Float32Array;
    normalized: Float32Array;
    weight: Float32Array;
    baseLuminance: Float32Array;
} {
    const pixelCount = product.width * product.height;
    const weightedLogLuminance = new Float32Array(pixelCount);
    const weight = new Float32Array(pixelCount);
    const baseLuminance = new Float32Array(pixelCount);
    for (let index = 0; index < pixelCount; index += 1) {
        const alpha = product.alpha[index] / 255;
        const red = product.rgb[index * 3] / 255;
        const green = product.rgb[index * 3 + 1] / 255;
        const blue = product.rgb[index * 3 + 2] / 255;
        const luminance = clamp(red * 0.2126 + green * 0.7152 + blue * 0.0722, 0.003, 1);
        baseLuminance[index] = luminance;
        weight[index] = alpha;
        weightedLogLuminance[index] = Math.log(luminance + 0.015) * alpha;
    }

    const radius = Math.max(5, Math.round(Math.min(product.width, product.height) * 0.055));
    const blurredNumerator = boxBlurFloat(weightedLogLuminance, product.width, product.height, radius);
    const blurredWeight = boxBlurFloat(weight, product.width, product.height, radius);
    const field = new Float32Array(pixelCount);
    for (let index = 0; index < pixelCount; index += 1) {
        field[index] = blurredWeight[index] > 0.03
            ? blurredNumerator[index] / blurredWeight[index]
            : 0;
    }

    const subjectValues: number[] = [];
    for (let index = 0; index < pixelCount; index += 1) {
        if (weight[index] >= 0.75) subjectValues.push(field[index]);
    }
    const subjectMedian = median(subjectValues);
    const normalized = new Float32Array(pixelCount);
    for (let index = 0; index < pixelCount; index += 1) {
        normalized[index] = field[index] - subjectMedian;
    }
    return { field, normalized, weight, baseLuminance };
}

function solveSoftLightGray(base: number, desired: number): number {
    const safeBase = clamp(base, 0.01, 0.99);
    const safeDesired = clamp(desired, 0, 1);
    if (safeDesired < safeBase) {
        const denominator = 2 * safeBase * (1 - safeBase);
        return clamp(0.5 - (safeBase - safeDesired) / Math.max(1e-5, denominator), 0.12, 0.5);
    }
    const dodge = safeBase <= 0.25
        ? ((16 * safeBase - 12) * safeBase + 4) * safeBase
        : Math.sqrt(safeBase);
    return clamp(0.5 + (safeDesired - safeBase) / Math.max(1e-5, 2 * (dodge - safeBase)), 0.5, 0.88);
}

/**
 * 以整批商品的低频受光场中位数为目标。每张图先减去自身主体中位亮度，所以白袜、灰袜、
 * 黑袜的固有明度不会被统一；输出只包含可置于 Soft Light 的低频中性灰修正。
 */
export function buildSkuRetouchNeutralGrayMaps(input: {
    products: SkuRetouchLowResolutionProduct[];
    strength: number;
}): SkuRetouchNeutralGrayResult[] {
    if (input.products.length === 0) return [];
    const width = input.products[0].width;
    const height = input.products[0].height;
    if (input.products.some((product) => product.width !== width || product.height !== height)) {
        throw new Error('中性灰批次的工作图尺寸不一致。');
    }
    const fields = input.products.map(buildLowFrequencyField);
    const pixelCount = width * height;
    const target = new Float32Array(pixelCount);
    for (let index = 0; index < pixelCount; index += 1) {
        const values: number[] = [];
        for (const field of fields) {
            if (field.weight[index] >= 0.42) values.push(field.normalized[index]);
        }
        target[index] = values.length > 1 ? median(values) : 0;
    }

    const strength = clamp(input.strength, 0, 1);
    return fields.map((field) => {
        const neutralGray = Buffer.alloc(pixelCount, 128);
        let residualBefore = 0;
        let residualAfter = 0;
        let totalWeight = 0;
        let correctionMin = 0;
        let correctionMax = 0;
        for (let index = 0; index < pixelCount; index += 1) {
            const alpha = field.weight[index];
            if (alpha <= 0.01) continue;
            const protection = smoothstep(0.48, 0.9, alpha);
            const rawDelta = clamp(target[index] - field.normalized[index], -0.26, 0.26);
            const appliedDelta = rawDelta * strength * protection;
            const base = field.baseLuminance[index];
            const desired = clamp((base + 0.015) * Math.exp(appliedDelta) - 0.015, 0, 1);
            const gray = solveSoftLightGray(base, desired);
            neutralGray[index] = Math.round(gray * 255);
            correctionMin = Math.min(correctionMin, appliedDelta);
            correctionMax = Math.max(correctionMax, appliedDelta);
            residualBefore += Math.abs(rawDelta) * alpha;
            residualAfter += Math.abs(rawDelta - appliedDelta) * alpha;
            totalWeight += alpha;
        }
        return {
            neutralGray,
            residualBefore: totalWeight > 0 ? residualBefore / totalWeight : 0,
            residualAfter: totalWeight > 0 ? residualAfter / totalWeight : 0,
            correctionMin,
            correctionMax
        };
    });
}

export function applySoftLightChannel(baseByte: number, blendByte: number): number {
    const base = baseByte / 255;
    const blend = blendByte / 255;
    let result: number;
    if (blend <= 0.5) {
        result = base - (1 - 2 * blend) * base * (1 - base);
    } else {
        const dodge = base <= 0.25
            ? ((16 * base - 12) * base + 4) * base
            : Math.sqrt(base);
        result = base + (2 * blend - 1) * (dodge - base);
    }
    return Math.round(clamp(result, 0, 1) * 255);
}
