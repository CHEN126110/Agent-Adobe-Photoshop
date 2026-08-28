/**
 * 蒙版连通域拆分（纯逻辑，主/渲染进程共用）
 *
 * 用途：把显著性分割给出的前景蒙版拆成一个个独立主体的边界框，
 * 交给后续的高分辨率精细分割逐个处理。
 *
 * 为什么不直接取整张蒙版的外接框：画面里有两个分离物体时，
 * 一个大框会把它们之间的背景一起圈进去，精分阶段再想剔除就晚了。
 */

export interface MaskRegion {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    /** 前景像素数，用于按大小排序和过滤碎片 */
    area: number;
}

export interface MaskRegionOptions {
    /** 判定前景的灰度阈值 */
    foregroundThreshold: number;
    /** 区域面积下限（占全图比例），滤掉分割毛刺 */
    minAreaRatio: number;
    /** 最多返回几个区域，按面积从大到小 */
    maxRegions: number;
}

export const DEFAULT_MASK_REGION_OPTIONS: MaskRegionOptions = {
    foregroundThreshold: 128,
    minAreaRatio: 0.004,
    maxRegions: 6
};

export interface MaskRegionResult {
    regions: MaskRegion[];
    /** 与蒙版等长：labels[i] 是该像素所属区域在 regions 中的下标 +1，0 表示背景或已被过滤 */
    labels: Int32Array;
}

export interface MaskTargetBox {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

export interface MaskTargetCoverage {
    requestedCount: number;
    coveredCount: number;
    uncoveredIndexes: number[];
    invalidIndexes: number[];
}

/**
 * 核对 union mask 是否在每个声明目标框内都有前景。
 *
 * 这只是完整性事实，不判断蒙版是否好看；任一框无前景时，上层不得把部分 union mask
 * 冒充成全部目标的成功结果。越界框按真实画布夹取，退化框和缓冲区尺寸错误显式记为 invalid。
 */
export function measureMaskTargetCoverage(
    mask: Uint8Array | Buffer,
    width: number,
    height: number,
    boxes: MaskTargetBox[],
    foregroundThreshold: number = DEFAULT_MASK_REGION_OPTIONS.foregroundThreshold
): MaskTargetCoverage {
    const requestedCount = Array.isArray(boxes) ? boxes.length : 0;
    const uncoveredIndexes: number[] = [];
    const invalidIndexes: number[] = [];
    let coveredCount = 0;
    const total = width * height;

    if (width <= 0 || height <= 0 || total <= 0 || mask.length < total) {
        return {
            requestedCount,
            coveredCount: 0,
            uncoveredIndexes,
            invalidIndexes: Array.from({ length: requestedCount }, (_unused, index) => index)
        };
    }

    boxes.forEach((box, index) => {
        if (![box.x1, box.y1, box.x2, box.y2].every(Number.isFinite)) {
            invalidIndexes.push(index);
            return;
        }
        const x1 = Math.max(0, Math.floor(box.x1));
        const y1 = Math.max(0, Math.floor(box.y1));
        const x2 = Math.min(width, Math.ceil(box.x2));
        const y2 = Math.min(height, Math.ceil(box.y2));
        if (x2 <= x1 || y2 <= y1) {
            invalidIndexes.push(index);
            return;
        }

        let covered = false;
        for (let y = y1; y < y2 && !covered; y++) {
            const row = y * width;
            for (let x = x1; x < x2; x++) {
                if (mask[row + x] >= foregroundThreshold) {
                    covered = true;
                    break;
                }
            }
        }
        if (covered) coveredCount++;
        else uncoveredIndexes.push(index);
    });

    return { requestedCount, coveredCount, uncoveredIndexes, invalidIndexes };
}

/**
 * 4 邻域连通域拆分，同时给出每个像素的归属。
 *
 * 用显式栈而非递归：整图连通的前景会让递归深度达到像素级，必然爆栈。
 */
export function extractMaskRegionsWithLabels(
    mask: Uint8Array | Buffer,
    width: number,
    height: number,
    options: MaskRegionOptions = DEFAULT_MASK_REGION_OPTIONS
): MaskRegionResult {
    const total = width * height;
    if (total <= 0 || mask.length < total) {
        return { regions: [], labels: new Int32Array(Math.max(0, total)) };
    }

    const threshold = options.foregroundThreshold;
    const minArea = Math.max(1, Math.floor(total * options.minAreaRatio));
    const visited = new Uint8Array(total);
    const rawLabels = new Int32Array(total);
    const raw: MaskRegion[] = [];
    const stack: number[] = [];
    let nextLabel = 0;

    for (let seed = 0; seed < total; seed++) {
        if (mask[seed] < threshold || visited[seed] === 1) continue;

        nextLabel++;
        let area = 0;
        let minX = width;
        let minY = height;
        let maxX = 0;
        let maxY = 0;

        visited[seed] = 1;
        rawLabels[seed] = nextLabel;
        stack.push(seed);

        while (stack.length > 0) {
            const index = stack.pop() as number;
            const x = index % width;
            const y = (index - x) / width;

            area++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;

            if (x > 0) push(index - 1);
            if (x < width - 1) push(index + 1);
            if (y > 0) push(index - width);
            if (y < height - 1) push(index + width);
        }

        raw.push({ x1: minX, y1: minY, x2: maxX + 1, y2: maxY + 1, area });
    }

    function push(neighbor: number): void {
        if (visited[neighbor] === 1 || mask[neighbor] < threshold) return;
        visited[neighbor] = 1;
        rawLabels[neighbor] = nextLabel;
        stack.push(neighbor);
    }

    // 过滤 + 排序后重新编号，让 labels 与 regions 下标对得上
    const kept = raw
        .map((region, index) => ({ region, rawLabel: index + 1 }))
        .filter(item => item.region.area >= minArea)
        .sort((a, b) => b.region.area - a.region.area)
        .slice(0, Math.max(1, options.maxRegions));

    const remap = new Int32Array(nextLabel + 1);
    kept.forEach((item, index) => { remap[item.rawLabel] = index + 1; });

    const labels = new Int32Array(total);
    for (let i = 0; i < total; i++) {
        const rawLabel = rawLabels[i];
        labels[i] = rawLabel > 0 ? remap[rawLabel] : 0;
    }

    return { regions: kept.map(item => item.region), labels };
}

/** 只要区域框、不关心像素归属时的简化入口 */
export function extractMaskRegions(
    mask: Uint8Array | Buffer,
    width: number,
    height: number,
    options: MaskRegionOptions = DEFAULT_MASK_REGION_OPTIONS
): MaskRegion[] {
    return extractMaskRegionsWithLabels(mask, width, height, options).regions;
}
