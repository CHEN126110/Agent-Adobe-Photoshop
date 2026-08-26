export interface SkuRetouchRaster {
    data: Buffer;
    width: number;
    height: number;
    channels: 3;
}

export interface SkuRetouchBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

export interface SkuRetouchRowProfile {
    left: number;
    right: number;
    center: number;
    width: number;
    valid: boolean;
}

export interface SkuRetouchShapeAnalysis {
    bounds: SkuRetouchBounds;
    rows: SkuRetouchRowProfile[];
    foregroundPixels: number;
    maxWidth: number;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function lerp(start: number, end: number, amount: number): number {
    return start + (end - start) * amount;
}

function smoothSeries(values: number[], start: number, end: number, radius: number): number[] {
    const output = values.slice();
    const prefix = new Float64Array(values.length + 1);
    for (let index = 0; index < values.length; index += 1) {
        prefix[index + 1] = prefix[index] + values[index];
    }
    for (let index = start; index <= end; index += 1) {
        const from = Math.max(start, index - radius);
        const to = Math.min(end, index + radius);
        output[index] = (prefix[to + 1] - prefix[from]) / (to - from + 1);
    }
    return output;
}

function fillMissing(values: number[], valid: boolean[], start: number, end: number): number[] {
    const output = values.slice();
    let last = -1;
    for (let index = start; index <= end; index += 1) {
        if (valid[index]) {
            if (last < 0) {
                for (let fill = start; fill < index; fill += 1) output[fill] = output[index];
            } else if (index - last > 1) {
                for (let fill = last + 1; fill < index; fill += 1) {
                    output[fill] = lerp(output[last], output[index], (fill - last) / (index - last));
                }
            }
            last = index;
        }
    }
    if (last >= 0) {
        for (let fill = last + 1; fill <= end; fill += 1) output[fill] = output[last];
    }
    return output;
}

/**
 * 从蒙版逐行选择主体的主连续区间。相比“取这一行所有前景的 min/max”，该方法不会
 * 被远处阴影或少量分割噪声拉宽轮廓，也不依赖轮廓点的极角排序。
 */
export function analyzeSkuRetouchShape(
    mask: Buffer,
    width: number,
    height: number,
    threshold = 104
): SkuRetouchShapeAnalysis {
    if (mask.length !== width * height) {
        throw new Error(`主体蒙版尺寸不一致：期望 ${width * height} 字节，实际 ${mask.length} 字节。`);
    }

    const rows: SkuRetouchRowProfile[] = Array.from({ length: height }, () => ({
        left: 0,
        right: 0,
        center: 0,
        width: 0,
        valid: false
    }));
    let foregroundPixels = 0;
    let previousCenter = width / 2;

    for (let y = 0; y < height; y += 1) {
        const segments: Array<{ left: number; right: number; length: number }> = [];
        let segmentStart = -1;
        for (let x = 0; x <= width; x += 1) {
            const foreground = x < width && mask[y * width + x] >= threshold;
            if (foreground) {
                foregroundPixels += 1;
                if (segmentStart < 0) segmentStart = x;
            } else if (segmentStart >= 0) {
                const right = x - 1;
                segments.push({ left: segmentStart, right, length: right - segmentStart + 1 });
                segmentStart = -1;
            }
        }
        if (segments.length === 0) continue;

        segments.sort((a, b) => {
            const centerA = (a.left + a.right) / 2;
            const centerB = (b.left + b.right) / 2;
            const scoreA = a.length - Math.abs(centerA - previousCenter) * 0.08;
            const scoreB = b.length - Math.abs(centerB - previousCenter) * 0.08;
            return scoreB - scoreA;
        });
        const selected = segments[0];
        if (selected.length < Math.max(3, Math.round(width * 0.002))) continue;
        const center = (selected.left + selected.right) / 2;
        rows[y] = {
            left: selected.left,
            right: selected.right,
            center,
            width: selected.length,
            valid: true
        };
        previousCenter = center;
    }

    const validRows = rows.map((row, index) => row.valid ? index : -1).filter((index) => index >= 0);
    if (validRows.length < Math.max(20, Math.round(height * 0.08))) {
        throw new Error('主体蒙版有效行过少，无法建立稳定的袜子中心线与宽度轮廓。');
    }
    const top = validRows[0];
    const bottom = validRows[validRows.length - 1];
    const valid = rows.map((row) => row.valid);
    const rawCenters = fillMissing(rows.map((row) => row.center), valid, top, bottom);
    const rawWidths = fillMissing(rows.map((row) => row.width), valid, top, bottom);
    const radius = Math.max(2, Math.round((bottom - top + 1) / 180));
    const centers = smoothSeries(rawCenters, top, bottom, radius);
    const widths = smoothSeries(rawWidths, top, bottom, radius);

    let left = width;
    let right = 0;
    let maxWidth = 0;
    for (let y = top; y <= bottom; y += 1) {
        const rowWidth = Math.max(1, widths[y]);
        const rowLeft = centers[y] - rowWidth / 2;
        const rowRight = centers[y] + rowWidth / 2;
        rows[y] = {
            left: rowLeft,
            right: rowRight,
            center: centers[y],
            width: rowWidth,
            valid: true
        };
        left = Math.min(left, rowLeft);
        right = Math.max(right, rowRight);
        maxWidth = Math.max(maxWidth, rowWidth);
    }

    const safeLeft = clamp(Math.floor(left), 0, width - 1);
    const safeRight = clamp(Math.ceil(right), safeLeft + 1, width);
    return {
        bounds: {
            left: safeLeft,
            top,
            right: safeRight,
            bottom: bottom + 1,
            width: safeRight - safeLeft,
            height: bottom - top + 1
        },
        rows,
        foregroundPixels,
        maxWidth
    };
}

function sampleProfileAt(shape: SkuRetouchShapeAnalysis, normalizedY: number): SkuRetouchRowProfile {
    const sourceY = shape.bounds.top + clamp(normalizedY, 0, 1) * Math.max(1, shape.bounds.height - 1);
    const y0 = clamp(Math.floor(sourceY), shape.bounds.top, shape.bounds.bottom - 1);
    const y1 = clamp(y0 + 1, shape.bounds.top, shape.bounds.bottom - 1);
    const amount = sourceY - y0;
    const first = shape.rows[y0];
    const second = shape.rows[y1];
    return {
        left: lerp(first.left, second.left, amount),
        right: lerp(first.right, second.right, amount),
        center: lerp(first.center, second.center, amount),
        width: lerp(first.width, second.width, amount),
        valid: true
    };
}

export function measureSkuRetouchShapeDistance(
    first: SkuRetouchShapeAnalysis,
    second: SkuRetouchShapeAnalysis
): number {
    const samples = 160;
    let total = 0;
    for (let index = 0; index < samples; index += 1) {
        const normalizedY = index / (samples - 1);
        const firstRow = sampleProfileAt(first, normalizedY);
        const secondRow = sampleProfileAt(second, normalizedY);
        const firstCenter = (firstRow.center - first.bounds.left) / Math.max(1, first.bounds.width);
        const secondCenter = (secondRow.center - second.bounds.left) / Math.max(1, second.bounds.width);
        const firstWidth = firstRow.width / Math.max(1, first.bounds.width);
        const secondWidth = secondRow.width / Math.max(1, second.bounds.width);
        total += Math.abs(firstCenter - secondCenter) * 0.58
            + Math.abs(firstWidth - secondWidth) * 0.42;
    }
    const firstAspect = first.bounds.width / Math.max(1, first.bounds.height);
    const secondAspect = second.bounds.width / Math.max(1, second.bounds.height);
    return total / samples + Math.abs(firstAspect - secondAspect) * 0.2;
}

export function chooseSkuRetouchReferenceIndex(shapes: SkuRetouchShapeAnalysis[]): number {
    if (shapes.length === 0) throw new Error('没有可用于选择形态基准的主体。');
    if (shapes.length === 1) return 0;
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let candidate = 0; candidate < shapes.length; candidate += 1) {
        let distance = 0;
        for (let other = 0; other < shapes.length; other += 1) {
            if (candidate === other) continue;
            distance += measureSkuRetouchShapeDistance(shapes[candidate], shapes[other]);
        }
        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = candidate;
        }
    }
    return bestIndex;
}
