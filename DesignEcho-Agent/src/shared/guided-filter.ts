/**
 * 引导滤波（Guided Filter）——用高分辨率原图把低分辨率蒙版的边缘吸附回真实边缘。
 *
 * BiRefNet 的 ONNX 输入固定为 1024×1024。蒙版放大回局部原图后，比分割采样间隔
 * 更细的绒毛、纤维和罗纹边缘已经不在蒙版里；引导滤波用同尺寸原图的灰度结构，
 * 在不改变输出分辨率的前提下重新对齐这些边缘。
 *
 * 算法仍是标准灰度 guided filter，复杂度 O(N)。实现按行块计算，并为第二次 box
 * filter 保留精确的半径 halo；块边界不会缩放输入、改变半径或采用近似滤波。四个
 * Float64 中间数组只按单块分配并复用，避免在 3072 路径同时保留十余张全帧数组。
 */

/** 蒙版被判为前景的阈值，与 matting-service 的口径一致 */
const FOREGROUND_THRESHOLD = 128;
const BYTE_NORMALIZATION_SCALE = 1 / 255;
const BYTE_PRODUCT_SCALE = 1 / (255 * 255);
const FLOAT64_BYTES = Float64Array.BYTES_PER_ELEMENT;
const OUTPUT_BYTES_PER_PIXEL = Uint8Array.BYTES_PER_ELEMENT;
const WORK_ARRAY_COUNT = 4;
const DEFAULT_TILE_CORE_ROWS = 256;

/**
 * 只约束本函数新增的 TypedArray（返回值、四个块内工作数组和列和工作区）。
 * 调用方已经持有的 guide/mask，以及返回后调用方可能创建的 Buffer 副本不在此预算内。
 */
export const DEFAULT_GUIDED_FILTER_MEMORY_BUDGET_BYTES = 192 * 1024 * 1024;

export interface GuidedFilterOptions {
    /** 窗口半径。留空则按图像长边推导（长边 / 192，钳 4~24） */
    radius?: number;
    /** 正则化强度。越大越平滑，越小越贴合引导图的细节 */
    epsilon?: number;
    /** 本算法新增 TypedArray 的硬预算；不足时在分配大数组前显式失败 */
    memoryBudgetBytes?: number;
}

export interface GuidedFilterExecutionPlan {
    status: 'ready' | 'rejected_memory_budget';
    executionMode: 'tiled_full_resolution' | 'not_run';
    width: number;
    height: number;
    radius: number;
    memoryBudgetBytes: number;
    estimatedPeakBytes: number;
    tileCoreRows: number;
    workingRows: number;
    /** rejected 时要求调用方记录跳过；算法不会悄悄返回未经精修的蒙版 */
    fallback: 'none' | 'caller_must_record_guided_filter_skip';
    reason?: string;
}

export class GuidedFilterMemoryBudgetError extends Error {
    public readonly code = 'GUIDED_FILTER_MEMORY_BUDGET_EXCEEDED';
    public readonly plan: GuidedFilterExecutionPlan;

    public constructor(plan: GuidedFilterExecutionPlan) {
        super(
            `引导滤波内存预算不足：预计至少需要 ${plan.estimatedPeakBytes} 字节，`
            + `预算为 ${plan.memoryBudgetBytes} 字节；未执行引导精修`
        );
        this.name = 'GuidedFilterMemoryBudgetError';
        this.plan = plan;
    }
}

/** 默认正则化强度：实测 1e-4 在“恢复细节”与“不引入噪声”之间最稳 */
const DEFAULT_EPSILON = 1e-4;
const RADIUS_DIVISOR = 192;
const MIN_RADIUS = 4;
const MAX_RADIUS = 24;

type ByteBoxSource =
    | { kind: 'normalized'; values: Uint8Array }
    | { kind: 'square'; values: Uint8Array }
    | { kind: 'product'; left: Uint8Array; right: Uint8Array };

/** 按图像尺寸推导窗口半径：半径要覆盖插值模糊的波及范围，而它随分辨率等比放大 */
export function resolveGuidedFilterRadius(width: number, height: number): number {
    const longSide = Math.max(width, height);
    const scaled = Math.round(longSide / RADIUS_DIVISOR);
    return Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, scaled));
}

function assertValidGeometry(width: number, height: number): number {
    const total = width * height;
    if (
        !Number.isSafeInteger(width)
        || !Number.isSafeInteger(height)
        || width <= 0
        || height <= 0
        || !Number.isSafeInteger(total)
    ) {
        throw new Error(`引导滤波尺寸无效：${width}x${height}`);
    }
    return total;
}

function assertValidRadius(radius: number): void {
    if (!Number.isSafeInteger(radius) || radius < 0) {
        throw new Error(`引导滤波半径无效：${radius}`);
    }
}

function estimatePeakBytes(
    width: number,
    height: number,
    radius: number,
    tileCoreRows: number
): { estimatedPeakBytes: number; workingRows: number } {
    const total = width * height;
    const workingRows = Math.min(height, tileCoreRows + radius * 2);
    const outputBytes = total * OUTPUT_BYTES_PER_PIXEL;
    const workArrayBytes = width * workingRows * FLOAT64_BYTES * WORK_ARRAY_COUNT;
    const columnWorkspaceBytes = width * FLOAT64_BYTES;
    return {
        estimatedPeakBytes: outputBytes + workArrayBytes + columnWorkspaceBytes,
        workingRows
    };
}

/**
 * 纯逻辑内存计划。不会分配与图像尺寸成比例的数组，可安全用于生产尺寸和拒绝路径测试。
 */
export function planGuidedFilterExecution(
    width: number,
    height: number,
    options?: Pick<GuidedFilterOptions, 'radius' | 'memoryBudgetBytes'>
): GuidedFilterExecutionPlan {
    assertValidGeometry(width, height);
    const radius = options?.radius ?? resolveGuidedFilterRadius(width, height);
    assertValidRadius(radius);

    const memoryBudgetBytes = options?.memoryBudgetBytes
        ?? DEFAULT_GUIDED_FILTER_MEMORY_BUDGET_BYTES;
    if (!Number.isSafeInteger(memoryBudgetBytes) || memoryBudgetBytes <= 0) {
        throw new Error(`引导滤波内存预算无效：${memoryBudgetBytes}`);
    }

    const targetCoreRows = Math.min(height, DEFAULT_TILE_CORE_ROWS);
    const target = estimatePeakBytes(width, height, radius, targetCoreRows);
    if (target.estimatedPeakBytes <= memoryBudgetBytes) {
        return {
            status: 'ready',
            executionMode: 'tiled_full_resolution',
            width,
            height,
            radius,
            memoryBudgetBytes,
            estimatedPeakBytes: target.estimatedPeakBytes,
            tileCoreRows: targetCoreRows,
            workingRows: target.workingRows,
            fallback: 'none'
        };
    }

    const minimum = estimatePeakBytes(width, height, radius, 1);
    if (minimum.estimatedPeakBytes > memoryBudgetBytes) {
        return {
            status: 'rejected_memory_budget',
            executionMode: 'not_run',
            width,
            height,
            radius,
            memoryBudgetBytes,
            estimatedPeakBytes: minimum.estimatedPeakBytes,
            tileCoreRows: 0,
            workingRows: minimum.workingRows,
            fallback: 'caller_must_record_guided_filter_skip',
            reason: '预算不足以容纳输出蒙版和一个精确 halo 行块'
        };
    }

    let low = 1;
    let high = targetCoreRows;
    let acceptedCoreRows = 1;
    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const candidate = estimatePeakBytes(width, height, radius, middle);
        if (candidate.estimatedPeakBytes <= memoryBudgetBytes) {
            acceptedCoreRows = middle;
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }

    const accepted = estimatePeakBytes(width, height, radius, acceptedCoreRows);
    return {
        status: 'ready',
        executionMode: 'tiled_full_resolution',
        width,
        height,
        radius,
        memoryBudgetBytes,
        estimatedPeakBytes: accepted.estimatedPeakBytes,
        tileCoreRows: acceptedCoreRows,
        workingRows: accepted.workingRows,
        fallback: 'none'
    };
}

function accumulateByteRow(
    source: ByteBoxSource,
    globalRow: number,
    sign: 1 | -1,
    width: number,
    columnSums: Float64Array
): void {
    const rowOffset = globalRow * width;
    switch (source.kind) {
        case 'normalized':
            for (let x = 0; x < width; x++) {
                columnSums[x] += sign * source.values[rowOffset + x] * BYTE_NORMALIZATION_SCALE;
            }
            return;
        case 'square':
            for (let x = 0; x < width; x++) {
                const value = source.values[rowOffset + x];
                columnSums[x] += sign * value * value * BYTE_PRODUCT_SCALE;
            }
            return;
        case 'product':
            for (let x = 0; x < width; x++) {
                columnSums[x] += sign
                    * source.left[rowOffset + x]
                    * source.right[rowOffset + x]
                    * BYTE_PRODUCT_SCALE;
            }
    }
}

function accumulateFloatRow(
    source: Float64Array,
    sourceStartY: number,
    globalRow: number,
    sign: 1 | -1,
    width: number,
    columnSums: Float64Array
): void {
    const rowOffset = (globalRow - sourceStartY) * width;
    for (let x = 0; x < width; x++) {
        columnSums[x] += sign * source[rowOffset + x];
    }
}

function writeBoxMeanRow(
    output: Float64Array,
    outputOffset: number,
    localOutputRow: number,
    globalRow: number,
    width: number,
    height: number,
    radius: number,
    columnSums: Float64Array
): void {
    const y0 = Math.max(0, globalRow - radius);
    const y1 = Math.min(height - 1, globalRow + radius);
    const verticalCount = y1 - y0 + 1;
    let x0 = 0;
    let x1 = Math.min(width - 1, radius);
    let horizontalSum = 0;
    for (let x = x0; x <= x1; x++) horizontalSum += columnSums[x];

    const rowOffset = outputOffset + localOutputRow * width;
    for (let x = 0; x < width; x++) {
        if (x > 0) {
            const removedX = x - radius - 1;
            const addedX = x + radius;
            if (removedX >= 0) horizontalSum -= columnSums[removedX];
            if (addedX < width) horizontalSum += columnSums[addedX];
            x0 = Math.max(0, x - radius);
            x1 = Math.min(width - 1, x + radius);
        }
        output[rowOffset + x] = horizontalSum / (verticalCount * (x1 - x0 + 1));
    }
}

function boxFilterByteRowsInto(
    source: ByteBoxSource,
    output: Float64Array,
    outputStartY: number,
    outputEndY: number,
    width: number,
    height: number,
    radius: number,
    columnSums: Float64Array
): void {
    columnSums.fill(0);
    const initialStartY = Math.max(0, outputStartY - radius);
    const initialEndY = Math.min(height - 1, outputStartY + radius);
    for (let y = initialStartY; y <= initialEndY; y++) {
        accumulateByteRow(source, y, 1, width, columnSums);
    }

    for (let y = outputStartY; y < outputEndY; y++) {
        if (y > outputStartY) {
            const removedY = y - radius - 1;
            const addedY = y + radius;
            if (removedY >= 0) accumulateByteRow(source, removedY, -1, width, columnSums);
            if (addedY < height) accumulateByteRow(source, addedY, 1, width, columnSums);
        }
        writeBoxMeanRow(
            output,
            0,
            y - outputStartY,
            y,
            width,
            height,
            radius,
            columnSums
        );
    }
}

function boxFilterFloatRowsInto(
    source: Float64Array,
    sourceStartY: number,
    sourceRows: number,
    output: Float64Array,
    outputStartY: number,
    outputEndY: number,
    width: number,
    height: number,
    radius: number,
    columnSums: Float64Array
): void {
    const requiredStartY = Math.max(0, outputStartY - radius);
    const requiredEndY = Math.min(height, outputEndY + radius);
    if (requiredStartY < sourceStartY || requiredEndY > sourceStartY + sourceRows) {
        throw new Error('引导滤波块 halo 不完整，拒绝产生近似结果');
    }

    columnSums.fill(0);
    const initialEndY = Math.min(height - 1, outputStartY + radius);
    for (let y = requiredStartY; y <= initialEndY; y++) {
        accumulateFloatRow(source, sourceStartY, y, 1, width, columnSums);
    }

    for (let y = outputStartY; y < outputEndY; y++) {
        if (y > outputStartY) {
            const removedY = y - radius - 1;
            const addedY = y + radius;
            if (removedY >= 0) {
                accumulateFloatRow(source, sourceStartY, removedY, -1, width, columnSums);
            }
            if (addedY < height) {
                accumulateFloatRow(source, sourceStartY, addedY, 1, width, columnSums);
            }
        }
        writeBoxMeanRow(
            output,
            0,
            y - outputStartY,
            y,
            width,
            height,
            radius,
            columnSums
        );
    }
}

/**
 * 用灰度引导图精修蒙版。
 *
 * @param guide 引导图灰度，长度必须为 width*height（取自与蒙版同尺寸的原图）
 * @param mask  待精修的蒙版，同尺寸
 */
export function refineMaskWithGuidedFilter(
    guide: Uint8Array | Buffer,
    mask: Uint8Array | Buffer,
    width: number,
    height: number,
    options?: GuidedFilterOptions
): Uint8Array {
    const total = assertValidGeometry(width, height);
    if (guide.length !== total || mask.length !== total) {
        throw new Error(
            `引导滤波输入尺寸不一致：期望 ${width}x${height}=${total}，`
            + `实际 guide=${guide.length}、mask=${mask.length}`
        );
    }

    const radius = options?.radius ?? resolveGuidedFilterRadius(width, height);
    assertValidRadius(radius);
    const epsilon = options?.epsilon ?? DEFAULT_EPSILON;
    if (!Number.isFinite(epsilon) || epsilon <= 0) {
        throw new Error(`引导滤波 epsilon 无效：${epsilon}`);
    }

    const plan = planGuidedFilterExecution(width, height, {
        radius,
        memoryBudgetBytes: options?.memoryBudgetBytes
    });
    if (plan.status !== 'ready') throw new GuidedFilterMemoryBudgetError(plan);

    const tileCapacity = width * plan.workingRows;
    const meanGuide = new Float64Array(tileCapacity);
    const meanMask = new Float64Array(tileCapacity);
    const coefficientA = new Float64Array(tileCapacity);
    const coefficientB = new Float64Array(tileCapacity);
    const columnSums = new Float64Array(width);
    const output = new Uint8Array(total);

    const normalizedGuide: ByteBoxSource = { kind: 'normalized', values: guide };
    const normalizedMask: ByteBoxSource = { kind: 'normalized', values: mask };
    const squaredGuide: ByteBoxSource = { kind: 'square', values: guide };
    const guideMaskProduct: ByteBoxSource = { kind: 'product', left: guide, right: mask };

    for (let coreStartY = 0; coreStartY < height; coreStartY += plan.tileCoreRows) {
        const coreEndY = Math.min(height, coreStartY + plan.tileCoreRows);
        const expandedStartY = Math.max(0, coreStartY - radius);
        const expandedEndY = Math.min(height, coreEndY + radius);
        const expandedRows = expandedEndY - expandedStartY;
        const expandedPixels = expandedRows * width;

        boxFilterByteRowsInto(
            normalizedGuide,
            meanGuide,
            expandedStartY,
            expandedEndY,
            width,
            height,
            radius,
            columnSums
        );
        boxFilterByteRowsInto(
            normalizedMask,
            meanMask,
            expandedStartY,
            expandedEndY,
            width,
            height,
            radius,
            columnSums
        );
        boxFilterByteRowsInto(
            squaredGuide,
            coefficientA,
            expandedStartY,
            expandedEndY,
            width,
            height,
            radius,
            columnSums
        );
        boxFilterByteRowsInto(
            guideMaskProduct,
            coefficientB,
            expandedStartY,
            expandedEndY,
            width,
            height,
            radius,
            columnSums
        );

        for (let i = 0; i < expandedPixels; i++) {
            const variance = coefficientA[i] - meanGuide[i] * meanGuide[i];
            const covariance = coefficientB[i] - meanGuide[i] * meanMask[i];
            coefficientA[i] = covariance / (variance + epsilon);
            coefficientB[i] = meanMask[i] - coefficientA[i] * meanGuide[i];
        }

        boxFilterFloatRowsInto(
            coefficientA,
            expandedStartY,
            expandedRows,
            meanGuide,
            coreStartY,
            coreEndY,
            width,
            height,
            radius,
            columnSums
        );
        boxFilterFloatRowsInto(
            coefficientB,
            expandedStartY,
            expandedRows,
            meanMask,
            coreStartY,
            coreEndY,
            width,
            height,
            radius,
            columnSums
        );

        const corePixels = (coreEndY - coreStartY) * width;
        const outputOffset = coreStartY * width;
        for (let i = 0; i < corePixels; i++) {
            const guideValue = guide[outputOffset + i] * BYTE_NORMALIZATION_SCALE;
            const value = Math.round((meanGuide[i] * guideValue + meanMask[i]) * 255);
            output[outputOffset + i] = value < 0 ? 0 : value > 255 ? 255 : value;
        }
    }

    return output;
}

/** 统计前景像素数，供调用方判断精修是否让选区异常膨胀 */
export function countForeground(mask: Uint8Array | Buffer): number {
    let count = 0;
    for (let i = 0; i < mask.length; i++) {
        if (mask[i] >= FOREGROUND_THRESHOLD) count++;
    }
    return count;
}
