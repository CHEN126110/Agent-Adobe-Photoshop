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

// ============ 姿态统一（骨架标架拉直，2026-08 round-trip 实证方案） ============
// 骨架 = 主体中轴的二次多项式拟合（姿态只有低频自由度，行级噪声留在残差里不矫正）。
// 迭代收敛（实证 130px 弯 3 轮到 <6px），每轮只在 mask 上分析，图像按复合映射一次采样
// （防多轮双线性模糊叠加）。袜口锁定段与强度是判断者（模型/用户）的显式输入。

export interface SkuRetouchPoseAlignmentOptions {
    /** 0~1 全局矫正强度；0 = 不做（默认关，等比缩放阶段验收后由判断者开启）。 */
    strength: number;
    /** 顶部锁定段占主体高的比例（0~0.4）：袜口/木耳边是产品特征，该段强度渐变到 0。 */
    cuffLockRatio: number;
    /** 迭代上限（1~4；实证 3 轮内收敛）。 */
    maxIterations: number;
}

export interface SkuRetouchPoseAlignmentReport {
    applied: boolean;
    iterations: number;
    initialShiftPx: number;
    residualShiftPx: number;
    fitResidualPx: number;
    skippedReason?: string;
}

export interface SkuRetouchPoseAlignmentOutcome {
    raster: SkuRetouchRaster;
    mask: Buffer;
    report: SkuRetouchPoseAlignmentReport;
}

interface PoseIterationMap {
    coef: [number, number, number];
    targetCenter: number;
    top: number;
    bottom: number;
}

const POSE_MAX_ROTATION_RAD = (30 * Math.PI) / 180;

/** 最小二乘二次拟合（正规方程 3×3 高斯消元）；退化返回 null。 */
function fitQuadraticSkeleton(points: Array<[number, number]>): [number, number, number] | null {
    let s0 = 0; let s1 = 0; let s2 = 0; let s3 = 0; let s4 = 0;
    let t0 = 0; let t1 = 0; let t2 = 0;
    for (const [y, c] of points) {
        const y2 = y * y;
        s0 += 1; s1 += y; s2 += y2; s3 += y2 * y; s4 += y2 * y2;
        t0 += c; t1 += y * c; t2 += y2 * c;
    }
    const m = [[s0, s1, s2, t0], [s1, s2, s3, t1], [s2, s3, s4, t2]];
    for (let i = 0; i < 3; i += 1) {
        let pivot = i;
        for (let r = i + 1; r < 3; r += 1) {
            if (Math.abs(m[r][i]) > Math.abs(m[pivot][i])) pivot = r;
        }
        [m[i], m[pivot]] = [m[pivot], m[i]];
        if (Math.abs(m[i][i]) < 1e-9) return null;
        for (let r = i + 1; r < 3; r += 1) {
            const f = m[r][i] / m[i][i];
            for (let col = i; col < 4; col += 1) m[r][col] -= f * m[i][col];
        }
    }
    const c2 = m[2][3] / m[2][2];
    const c1 = (m[1][3] - m[1][2] * c2) / m[1][1];
    const c0 = (m[0][3] - m[0][1] * c1 - m[0][2] * c2) / m[0][0];
    return [c0, c1, c2];
}

/** 拟合行选择：行宽在中位数 ±40% 内（吊牌/腰封/卷边异常行不定义姿态）。 */
function collectSkeletonFitPoints(shape: SkuRetouchShapeAnalysis): Array<[number, number]> {
    const widths: number[] = [];
    for (let y = shape.bounds.top; y < shape.bounds.bottom; y += 1) {
        if (shape.rows[y]?.valid) widths.push(shape.rows[y].width);
    }
    widths.sort((a, b) => a - b);
    const medianWidth = widths[Math.floor(widths.length / 2)] || 1;
    const points: Array<[number, number]> = [];
    for (let y = shape.bounds.top; y < shape.bounds.bottom; y += 1) {
        const row = shape.rows[y];
        if (!row?.valid) continue;
        if (row.width < medianWidth * 0.6 || row.width > medianWidth * 1.4) continue;
        points.push([y, row.center]);
    }
    return points;
}

/** 行强度：顶部锁定段 smoothstep 渐入，其余为全局强度。 */
function poseRowStrength(y: number, map: PoseIterationMap, options: SkuRetouchPoseAlignmentOptions): number {
    const height = Math.max(1, map.bottom - map.top);
    const lockRows = clamp(options.cuffLockRatio, 0, 0.4) * height;
    if (lockRows <= 0) return options.strength;
    const offset = y - map.top;
    if (offset <= 0) return 0;
    if (offset >= lockRows) return options.strength;
    const t = offset / lockRows;
    return options.strength * t * t * (3 - 2 * t);
}

/** 单轮逆映射：输出点 → 源点（骨架局部标架，行旋转 = 局部刚性）。 */
function poseInverseMap(
    x: number,
    y: number,
    map: PoseIterationMap,
    options: SkuRetouchPoseAlignmentOptions
): { x: number; y: number } {
    const yc = clamp(y, map.top, map.bottom - 1);
    const [c0, c1, c2] = map.coef;
    const srcCenter = c0 + c1 * yc + c2 * yc * yc;
    const rowStrength = poseRowStrength(yc, map, options);
    const theta = clamp(Math.atan(c1 + 2 * c2 * yc) * rowStrength, -POSE_MAX_ROTATION_RAD, POSE_MAX_ROTATION_RAD);
    const effCenter = map.targetCenter + (srcCenter - map.targetCenter) * (1 - rowStrength);
    const d = x - effCenter;
    return {
        x: srcCenter + d * Math.cos(theta),
        y: y + d * Math.sin(theta)
    };
}

function sampleBilinearChannel(
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
    const fx = safeX - x0;
    const fy = safeY - y0;
    const top = lerp(data[(y0 * width + x0) * channels + channel], data[(y0 * width + x1) * channels + channel], fx);
    const bottom = lerp(data[(y1 * width + x0) * channels + channel], data[(y1 * width + x1) * channels + channel], fx);
    return lerp(top, bottom, fy);
}

/**
 * 姿态统一主入口：迭代拟合骨架并拉直，返回矫正后的 raster/mask 与如实报告。
 * 拟合残差过大（S 形/复杂姿态）时如实跳过，不硬扭——恢复出口是交回判断者。
 */
export function alignSkuRetouchPose(input: {
    raster: SkuRetouchRaster;
    mask: Buffer;
    shape: SkuRetouchShapeAnalysis;
    options: SkuRetouchPoseAlignmentOptions;
    /**
     * 可选全分辨率输出：骨架在工作分辨率上拟合（快），复合映射是解析函数，
     * 最终采样在原分辨率上一次完成（质量无损）。scale = 全分辨率 / 工作分辨率。
     */
    fullResolution?: {
        raster: SkuRetouchRaster;
        mask: Buffer;
        scale: number;
    };
}): SkuRetouchPoseAlignmentOutcome {
    const { raster, options } = input;
    const { width, height } = raster;
    const passthrough = (skippedReason?: string): SkuRetouchPoseAlignmentOutcome => ({
        raster: input.fullResolution?.raster || raster,
        mask: input.fullResolution?.mask || input.mask,
        report: {
            applied: false,
            iterations: 0,
            initialShiftPx: 0,
            residualShiftPx: 0,
            fitResidualPx: 0,
            skippedReason
        }
    });
    if (options.strength <= 0) return passthrough();

    const maps: PoseIterationMap[] = [];
    let currentMask = input.mask;
    let currentShape = input.shape;
    let initialShiftPx = 0;
    let residualShiftPx = 0;
    let fitResidualPx = 0;
    const maxIterations = clamp(Math.round(options.maxIterations), 1, 4);
    const convergedThreshold = Math.max(4, height * 0.004);

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        const points = collectSkeletonFitPoints(currentShape);
        if (points.length < 30) {
            if (maps.length === 0) return passthrough(`骨架拟合有效行不足（${points.length} 行），已跳过姿态矫正。`);
            break;
        }
        const coef = fitQuadraticSkeleton(points);
        if (!coef) {
            if (maps.length === 0) return passthrough('骨架二次拟合退化，已跳过姿态矫正。');
            break;
        }
        const [c0, c1, c2] = coef;
        const skeleton = (y: number): number => c0 + c1 * y + c2 * y * y;
        let residual = 0;
        for (const [y, c] of points) residual += Math.abs(skeleton(y) - c);
        residual /= Math.max(1, points.length);
        if (iteration === 0) {
            fitResidualPx = residual;
            const applicabilityLimit = Math.max(4, currentShape.bounds.width * 0.02);
            if (residual > applicabilityLimit) {
                return passthrough(
                    `骨架拟合残差 ${residual.toFixed(1)}px 超过适用上限 ${applicabilityLimit.toFixed(1)}px（姿态复杂或轮廓异常），已如实跳过；可人工处理或更换源图。`
                );
            }
        }

        const midY = (currentShape.bounds.top + currentShape.bounds.bottom) / 2;
        const map: PoseIterationMap = {
            coef,
            targetCenter: skeleton(midY),
            top: currentShape.bounds.top,
            bottom: currentShape.bounds.bottom
        };
        let maxShift = 0;
        for (let y = map.top; y < map.bottom; y += 1) {
            maxShift = Math.max(maxShift, Math.abs((skeleton(y) - map.targetCenter) * options.strength));
        }
        if (iteration === 0) initialShiftPx = maxShift;
        residualShiftPx = maxShift;
        if (maxShift < convergedThreshold) break;
        maps.push(map);

        // mask 按本轮映射变换后重新分析（mask 重采样便宜且不劣化最终图像质量）
        const nextMask = Buffer.alloc(width * height);
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const src = poseInverseMap(x, y, map, options);
                nextMask[y * width + x] = sampleBilinearChannel(currentMask, width, height, 1, src.x, src.y, 0) >= 128 ? 255 : 0;
            }
        }
        currentMask = nextMask;
        try {
            currentShape = analyzeSkuRetouchShape(currentMask, width, height);
        } catch {
            break;
        }
    }

    if (maps.length === 0) return passthrough();

    // 复合映射一次采样：输出点依次经最后一轮到第一轮的逆映射回到原始源坐标。
    // 有 fullResolution 时：映射链在工作坐标系上解析计算，采样在全分辨率上进行。
    const outputRaster = input.fullResolution?.raster || raster;
    const outputMask = input.fullResolution?.mask || input.mask;
    const scale = input.fullResolution ? Math.max(1e-6, input.fullResolution.scale) : 1;
    const outWidth = outputRaster.width;
    const outHeight = outputRaster.height;
    const outRgb = Buffer.alloc(outWidth * outHeight * 3);
    const outMask = Buffer.alloc(outWidth * outHeight);
    for (let y = 0; y < outHeight; y += 1) {
        for (let x = 0; x < outWidth; x += 1) {
            let point = { x: x / scale, y: y / scale };
            for (let level = maps.length - 1; level >= 0; level -= 1) {
                point = poseInverseMap(point.x, point.y, maps[level], options);
            }
            const sourceX = point.x * scale;
            const sourceY = point.y * scale;
            const index = y * outWidth + x;
            outRgb[index * 3] = Math.round(sampleBilinearChannel(outputRaster.data, outWidth, outHeight, 3, sourceX, sourceY, 0));
            outRgb[index * 3 + 1] = Math.round(sampleBilinearChannel(outputRaster.data, outWidth, outHeight, 3, sourceX, sourceY, 1));
            outRgb[index * 3 + 2] = Math.round(sampleBilinearChannel(outputRaster.data, outWidth, outHeight, 3, sourceX, sourceY, 2));
            outMask[index] = sampleBilinearChannel(outputMask, outWidth, outHeight, 1, sourceX, sourceY, 0) >= 128 ? 255 : 0;
        }
    }

    return {
        raster: { data: outRgb, width: outWidth, height: outHeight, channels: 3 },
        mask: outMask,
        report: {
            // 位移量按输出分辨率报告（工作坐标 × scale），与用户看到的画面一致
            applied: true,
            iterations: maps.length,
            initialShiftPx: Math.round(initialShiftPx * scale),
            residualShiftPx: Math.round(residualShiftPx * scale),
            fitResidualPx: Number((fitResidualPx * scale).toFixed(2))
        }
    };
}
