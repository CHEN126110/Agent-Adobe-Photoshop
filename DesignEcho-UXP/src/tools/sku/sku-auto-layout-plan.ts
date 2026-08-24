export type SkuAutoLayoutStrategy = 'auto' | 'single-row' | 'grid';
export type SkuAutoLayoutPreset = 'sku-combo' | 'sku-note' | 'generic';
export type SkuAutoLayoutStatus = 'ready' | 'needs_review' | 'blocked';
export type SkuAutoLayoutSizingPolicy = 'shared-scale' | 'uniform-width-contain';
type SkuAutoLayoutVerticalAnchor = 'center' | 'row-top';

export interface SkuAutoLayoutRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

export interface SkuAutoLayoutItem {
    id: string;
    layerId?: number;
    name: string;
    bounds: SkuAutoLayoutRect;
    subjectBounds?: SkuAutoLayoutRect;
}

export interface SkuAutoLayoutObstacle {
    id: string;
    role?: string;
    locked?: boolean;
    bounds: SkuAutoLayoutRect;
}

export interface SkuAutoLayoutPlanInput {
    canvas: { width: number; height: number };
    items: SkuAutoLayoutItem[];
    obstacles?: SkuAutoLayoutObstacle[];
    preset?: SkuAutoLayoutPreset;
    strategy?: SkuAutoLayoutStrategy;
    safeMarginPx?: number;
    clearancePx?: number;
    minSpacingPx?: number;
    minScalePercent?: number;
    sizingPolicy?: SkuAutoLayoutSizingPolicy;
}

export interface SkuBoundedRegionLayoutPlanInput {
    region: SkuAutoLayoutRect;
    items: SkuAutoLayoutItem[];
    strategy?: SkuAutoLayoutStrategy;
    minSpacingPx?: number;
    minScalePercent?: number;
    fillRatio?: number;
    sizingPolicy?: SkuAutoLayoutSizingPolicy;
    /**
     * 从模板量出来的沟槽宽度（px）。矩形占位是「一个矩形 = 一整行」的区域模型，
     * 矩形只声明外框、不声明内部怎么分，引擎此前按 region.width*2.5% 估间距——
     * 于是同一张图里「区域内的间距」（引擎估）和「区域之间的间距」（模板定）是两套口径，
     * 用户 2026-08-18 在 4双装上看到上排 3 张比下排排得松。传入本值后区域内外同一把尺子。
     * 不传则回落到旧的比例估算。
     */
    gutterPx?: number;
}

export interface SkuExplicitSingleRowLayoutPlanInput {
    cells: SkuAutoLayoutRect[];
    items: SkuAutoLayoutItem[];
    minSpacingPx?: number;
    minScalePercent?: number;
    fillRatio?: number;
}

export interface SkuAutoLayoutPlacement {
    itemId: string;
    layerId?: number;
    name: string;
    destinationBox: SkuAutoLayoutRect;
    cellBox: SkuAutoLayoutRect;
    scalePercent: number;
    row: number;
    column: number;
    sizingPolicy: SkuAutoLayoutSizingPolicy;
}

export interface SkuAutoLayoutCandidate {
    strategy: Exclude<SkuAutoLayoutStrategy, 'auto'>;
    rows: number;
    cols: number;
    region: SkuAutoLayoutRect;
    score: number;
    minScalePercent: number;
    centerDistance: number;
}

export interface SkuAutoLayoutDiagnosticsSummary {
    itemCount: number;
    obstacleCount: number;
    expandedObstacleCount: number;
    safeBox: SkuAutoLayoutRect;
    safeBoxAreaPx: number;
    freeRegionCount: number;
    largestFreeRegion: SkuAutoLayoutRect;
    largestFreeRegionAreaPx: number;
    totalFreeRegionAreaPx: number;
    largestItemBounds: SkuAutoLayoutRect;
    largestItemAreaPx: number;
    totalItemAreaPx: number;
    constraints: {
        minSpacingPx: number;
        clearancePx: number;
        minScalePercent: number;
    };
    likelyBlockers: string[];
}

export interface SkuAutoLayoutPlan {
    schema: 'sku-auto-layout-plan/v0';
    status: SkuAutoLayoutStatus;
    strategy: Exclude<SkuAutoLayoutStrategy, 'auto'>;
    safeBox: SkuAutoLayoutRect;
    selectedRegion: SkuAutoLayoutRect;
    placements: SkuAutoLayoutPlacement[];
    diagnostics: {
        candidates: SkuAutoLayoutCandidate[];
        warnings: string[];
        blockers: string[];
        summary?: SkuAutoLayoutDiagnosticsSummary;
    };
    constraints: {
        minSpacingPx: number;
        clearancePx: number;
        minScalePercent: number;
    };
    boundaries: {
        writesPhotoshop: false;
        claimsDesignQuality: false;
    };
}

export interface SkuAutoLayoutActualPlacement {
    itemId: string;
    layerId?: number;
    name: string;
    destinationBox: SkuAutoLayoutRect;
    actualBounds?: SkuAutoLayoutRect | null;
    actualSubjectBounds?: SkuAutoLayoutRect | null;
}

export interface SkuAutoLayoutQaPlacement {
    itemId: string;
    layerId?: number;
    name: string;
    destinationBox: SkuAutoLayoutRect;
    actualBounds: SkuAutoLayoutRect | null;
    actualSubjectBounds: SkuAutoLayoutRect | null;
    centerDeltaPx: number | null;
    maxOverflowPx: number | null;
}

export interface SkuAutoLayoutQaResult {
    schema: 'sku-auto-layout-qa/v0';
    status: SkuAutoLayoutStatus;
    actualPlacements: SkuAutoLayoutQaPlacement[];
    warnings: string[];
    blockers: string[];
    boundaries: {
        usesActualBounds: true;
        writesPhotoshop: false;
        claimsDesignQuality: false;
    };
}

export interface SkuAutoLayoutQaInput {
    plan: SkuAutoLayoutPlan;
    actualPlacements: SkuAutoLayoutActualPlacement[];
    expectedItemCount?: number;
    actualTopLevelItemCount?: number;
    expectedTopLevelLayerIds?: number[];
    obstacles?: SkuAutoLayoutObstacle[];
    tolerancePx?: number;
    clearancePx?: number;
    minSpacingPx?: number;
}

interface CandidateBuildResult {
    candidate: SkuAutoLayoutCandidate;
    placements: SkuAutoLayoutPlacement[];
}

const ZERO_RECT: SkuAutoLayoutRect = {
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0
};

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function finite(value: unknown, fallback = 0): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeRect(rect: Partial<SkuAutoLayoutRect> | undefined): SkuAutoLayoutRect {
    if (!rect) return { ...ZERO_RECT };
    const left = finite(rect.left);
    const top = finite(rect.top);
    const right = finite(rect.right, left + finite(rect.width));
    const bottom = finite(rect.bottom, top + finite(rect.height));
    const normalizedLeft = Math.min(left, right);
    const normalizedRight = Math.max(left, right);
    const normalizedTop = Math.min(top, bottom);
    const normalizedBottom = Math.max(top, bottom);
    return {
        left: normalizedLeft,
        top: normalizedTop,
        right: normalizedRight,
        bottom: normalizedBottom,
        width: Math.max(0, normalizedRight - normalizedLeft),
        height: Math.max(0, normalizedBottom - normalizedTop)
    };
}

function makeRect(left: number, top: number, right: number, bottom: number): SkuAutoLayoutRect {
    return normalizeRect({ left, top, right, bottom });
}

function rectArea(rect: SkuAutoLayoutRect): number {
    return Math.max(0, rect.width) * Math.max(0, rect.height);
}

function rectCenter(rect: SkuAutoLayoutRect): { x: number; y: number } {
    return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
    };
}

function intersects(a: SkuAutoLayoutRect, b: SkuAutoLayoutRect): boolean {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

// 规划阶段的几何判定容差。坐标全是浮点：单元格被贴满时 (cellWidth / sourceWidth) * sourceWidth
// 可能比 cellWidth 大 1e-13，零容差的 <= 会把"正好铺满区域"的最优候选判成溢出。
// 2026-08-18 真机：3双装区域 770x380 放 3 个 SKU，1×3 候选因 1.1e-13px 被判掉，退化成 2×2（缩到 78%）；
// 4双装区域 450x684 只放 1 个 SKU 时唯一候选被同样误差判掉，直接报"无法在保持间距的前提下容纳 1 个 SKU"。
// 执行后 QA 早已按 tolerancePx 判定，规划阶段不应比验收更严。
const PLAN_GEOMETRY_TOLERANCE_PX = 0.01;

function containsRect(
    outer: SkuAutoLayoutRect,
    inner: SkuAutoLayoutRect,
    tolerancePx: number = PLAN_GEOMETRY_TOLERANCE_PX
): boolean {
    return inner.left >= outer.left - tolerancePx
        && inner.top >= outer.top - tolerancePx
        && inner.right <= outer.right + tolerancePx
        && inner.bottom <= outer.bottom + tolerancePx;
}

function expandRect(rect: SkuAutoLayoutRect, amount: number): SkuAutoLayoutRect {
    return makeRect(rect.left - amount, rect.top - amount, rect.right + amount, rect.bottom + amount);
}

function rectOverflowPx(outer: SkuAutoLayoutRect, inner: SkuAutoLayoutRect): number {
    return Math.max(
        0,
        outer.left - inner.left,
        outer.top - inner.top,
        inner.right - outer.right,
        inner.bottom - outer.bottom
    );
}

function getRectCenterDistance(a: SkuAutoLayoutRect, b: SkuAutoLayoutRect): number {
    const centerA = rectCenter(a);
    const centerB = rectCenter(b);
    return Math.hypot(centerA.x - centerB.x, centerA.y - centerB.y);
}

function unionRects(rects: SkuAutoLayoutRect[]): SkuAutoLayoutRect {
    const valid = rects.filter((rect) => rect.width > 0 && rect.height > 0);
    if (valid.length === 0) return { ...ZERO_RECT };
    return makeRect(
        Math.min(...valid.map((rect) => rect.left)),
        Math.min(...valid.map((rect) => rect.top)),
        Math.max(...valid.map((rect) => rect.right)),
        Math.max(...valid.map((rect) => rect.bottom))
    );
}

function sortRegionsForLayout(regions: SkuAutoLayoutRect[]): SkuAutoLayoutRect[] {
    const minHeight = Math.max(1, Math.min(...regions.map((region) => Math.max(1, region.height))));
    const rowTolerance = Math.max(24, minHeight * 0.18);
    return regions.slice().sort((a, b) => {
        const rowDelta = a.top - b.top;
        if (Math.abs(rowDelta) > rowTolerance) return rowDelta;
        return a.left - b.left;
    });
}

function pushUnique(messages: string[], message: string): void {
    if (!messages.includes(message)) messages.push(message);
}

function formatDimension(value: number): string {
    return String(Math.round(value));
}

function clipRect(rect: SkuAutoLayoutRect, bounds: SkuAutoLayoutRect): SkuAutoLayoutRect | null {
    const clipped = makeRect(
        Math.max(rect.left, bounds.left),
        Math.max(rect.top, bounds.top),
        Math.min(rect.right, bounds.right),
        Math.min(rect.bottom, bounds.bottom)
    );
    return clipped.width > 0 && clipped.height > 0 ? clipped : null;
}

function uniqueSorted(values: number[]): number[] {
    return Array.from(new Set(values.map((value) => Number(value.toFixed(3))))).sort((a, b) => a - b);
}

function getPresetFillRatio(preset: SkuAutoLayoutPreset): number {
    if (preset === 'sku-note') return 0.74;
    if (preset === 'generic') return 0.72;
    return 0.78;
}

function getCompactFallbackFillRatios(baseFillRatio: number, preset: SkuAutoLayoutPreset): number[] {
    const upper = preset === 'generic' ? 0.94 : preset === 'sku-note' ? 0.96 : 1;
    return uniqueSorted([
        Math.min(upper, Math.max(baseFillRatio + 0.1, 0.9)),
        upper
    ]).filter((ratio) => ratio > baseFillRatio + 0.02);
}

function getDefaultMinSpacingPx(canvasMinSide: number, preset: SkuAutoLayoutPreset): number {
    const ratio = preset === 'sku-note' ? 0.018 : 0.022;
    return clamp(canvasMinSide * ratio, 14, 44);
}

function getSafeBox(input: SkuAutoLayoutPlanInput): SkuAutoLayoutRect {
    const width = Math.max(1, finite(input.canvas?.width));
    const height = Math.max(1, finite(input.canvas?.height));
    const margin = input.safeMarginPx ?? clamp(Math.min(width, height) * 0.06, 24, 96);
    return makeRect(margin, margin, width - margin, height - margin);
}

function buildFreeRegions(
    safeBox: SkuAutoLayoutRect,
    obstacles: SkuAutoLayoutObstacle[],
    clearancePx: number
): SkuAutoLayoutRect[] {
    const expandedObstacles = buildExpandedObstacles(safeBox, obstacles, clearancePx);

    if (expandedObstacles.length === 0) return [safeBox];

    const xLines = uniqueSorted([
        safeBox.left,
        safeBox.right,
        ...expandedObstacles.flatMap((rect) => [rect.left, rect.right])
    ]);
    const yLines = uniqueSorted([
        safeBox.top,
        safeBox.bottom,
        ...expandedObstacles.flatMap((rect) => [rect.top, rect.bottom])
    ]);

    const regions: SkuAutoLayoutRect[] = [];
    for (let xIndex = 0; xIndex < xLines.length - 1; xIndex++) {
        for (let yIndex = 0; yIndex < yLines.length - 1; yIndex++) {
            const cell = makeRect(xLines[xIndex], yLines[yIndex], xLines[xIndex + 1], yLines[yIndex + 1]);
            if (cell.width < 32 || cell.height < 32) continue;
            if (expandedObstacles.some((obstacle) => intersects(cell, obstacle))) continue;
            regions.push(cell);
        }
    }

    return mergeAlignedRegions(regions).sort((a, b) => rectArea(b) - rectArea(a));
}

function buildExpandedObstacles(
    safeBox: SkuAutoLayoutRect,
    obstacles: SkuAutoLayoutObstacle[],
    clearancePx: number
): SkuAutoLayoutRect[] {
    return obstacles
        .map((obstacle) => clipRect(expandRect(normalizeRect(obstacle.bounds), clearancePx), safeBox))
        .filter((rect): rect is SkuAutoLayoutRect => Boolean(rect));
}

function mergeAlignedRegions(regions: SkuAutoLayoutRect[]): SkuAutoLayoutRect[] {
    let merged = regions.slice();
    let changed = true;

    while (changed) {
        changed = false;
        outer:
        for (let i = 0; i < merged.length; i++) {
            for (let j = i + 1; j < merged.length; j++) {
                const a = merged[i];
                const b = merged[j];
                const sameVertical = Math.abs(a.top - b.top) < 0.01 && Math.abs(a.bottom - b.bottom) < 0.01;
                const touchingX = Math.abs(a.right - b.left) < 0.01 || Math.abs(b.right - a.left) < 0.01;
                const sameHorizontal = Math.abs(a.left - b.left) < 0.01 && Math.abs(a.right - b.right) < 0.01;
                const touchingY = Math.abs(a.bottom - b.top) < 0.01 || Math.abs(b.bottom - a.top) < 0.01;

                if ((sameVertical && touchingX) || (sameHorizontal && touchingY)) {
                    merged.splice(j, 1);
                    merged.splice(i, 1, makeRect(
                        Math.min(a.left, b.left),
                        Math.min(a.top, b.top),
                        Math.max(a.right, b.right),
                        Math.max(a.bottom, b.bottom)
                    ));
                    changed = true;
                    break outer;
                }
            }
        }
    }

    return merged;
}

function getItemSourceBounds(item: SkuAutoLayoutItem): SkuAutoLayoutRect {
    const subject = normalizeRect(item.subjectBounds || item.bounds);
    if (subject.width > 0 && subject.height > 0) return subject;
    return normalizeRect(item.bounds);
}

function getPresetVerticalAnchor(preset: SkuAutoLayoutPreset): SkuAutoLayoutVerticalAnchor {
    return preset === 'sku-combo' ? 'row-top' : 'center';
}

function getRowMaxHeights<T extends { row: number }>(
    entries: T[],
    getHeight: (entry: T) => number
): Map<number, number> {
    const rowMaxHeights = new Map<number, number>();
    for (const entry of entries) {
        const height = getHeight(entry);
        const current = rowMaxHeights.get(entry.row) || 0;
        rowMaxHeights.set(entry.row, Math.max(current, height));
    }
    return rowMaxHeights;
}

function buildAnchoredDestinationBox(input: {
    source: SkuAutoLayoutRect;
    cellBox: SkuAutoLayoutRect;
    scale: number;
    rowMaxHeight: number;
    verticalAnchor: SkuAutoLayoutVerticalAnchor;
}): SkuAutoLayoutRect {
    const finalWidth = input.source.width * input.scale;
    const finalHeight = input.source.height * input.scale;
    const center = rectCenter(input.cellBox);
    const left = center.x - finalWidth / 2;
    const top = input.verticalAnchor === 'row-top'
        ? input.cellBox.top + (input.cellBox.height - input.rowMaxHeight) / 2
        : center.y - finalHeight / 2;
    return makeRect(left, top, left + finalWidth, top + finalHeight);
}

function enumerateGridShapes(itemCount: number, requested: SkuAutoLayoutStrategy): Array<{ rows: number; cols: number; strategy: Exclude<SkuAutoLayoutStrategy, 'auto'> }> {
    if (itemCount <= 0) return [];

    if (requested === 'single-row') {
        return [{ rows: 1, cols: itemCount, strategy: 'single-row' }];
    }

    const shapes: Array<{ rows: number; cols: number; strategy: Exclude<SkuAutoLayoutStrategy, 'auto'> }> = [];
    if (requested !== 'grid') {
        shapes.push({ rows: 1, cols: itemCount, strategy: 'single-row' });
    }

    const maxRows = Math.min(itemCount, Math.ceil(Math.sqrt(itemCount)) + 2);
    for (let rows = 1; rows <= maxRows; rows++) {
        const cols = Math.ceil(itemCount / rows);
        const strategy = rows === 1 ? 'single-row' : 'grid';
        if (requested === 'grid' && rows === 1 && itemCount > 2) continue;
        if (!shapes.some((shape) => shape.rows === rows && shape.cols === cols)) {
            shapes.push({ rows, cols, strategy });
        }
    }

    return shapes;
}

function buildCandidate(
    region: SkuAutoLayoutRect,
    safeBox: SkuAutoLayoutRect,
    items: SkuAutoLayoutItem[],
    rows: number,
    cols: number,
    strategy: Exclude<SkuAutoLayoutStrategy, 'auto'>,
    verticalAnchor: SkuAutoLayoutVerticalAnchor,
    fillRatio: number,
    minScalePercent: number,
    minSpacingPx: number,
    sizingPolicy: SkuAutoLayoutSizingPolicy = 'shared-scale',
    rejections?: string[],
    gutterPx?: number
): CandidateBuildResult | null {
    function reject(reason: string): null {
        if (rejections) pushUnique(rejections, `${rows}×${cols} 候选被否：${reason}`);
        return null;
    }

    const hasTemplateGutter = Number.isFinite(gutterPx) && (gutterPx as number) > 0;
    const gapX = hasTemplateGutter
        ? (gutterPx as number)
        : Math.max(minSpacingPx, clamp(region.width * 0.025, 12, 48));
    const gapY = hasTemplateGutter
        ? (gutterPx as number)
        : Math.max(minSpacingPx, clamp(region.height * 0.035, 12, 56));
    const cellWidth = (region.width - gapX * (cols - 1)) / cols;
    const cellHeight = (region.height - gapY * (rows - 1)) / rows;

    if (cellWidth <= 12 || cellHeight <= 12) {
        return reject(`单元格 ${formatDimension(cellWidth)}x${formatDimension(cellHeight)}px 过小。`);
    }

    const useUniformWidth = sizingPolicy === 'uniform-width-contain' && strategy === 'single-row';
    const plannedItems: Array<{
        item: SkuAutoLayoutItem;
        source: SkuAutoLayoutRect;
        cellBox: SkuAutoLayoutRect;
        row: number;
        column: number;
        fitScale: number;
        maxUniformWidth: number;
    }> = [];

    for (let index = 0; index < items.length; index++) {
        const row = Math.floor(index / cols);
        const column = index % cols;
        const rowItemCount = Math.min(cols, items.length - row * cols);
        const rowCenterOffsetX = Math.max(0, cols - rowItemCount) * (cellWidth + gapX) / 2;
        const item = items[index];
        const source = useUniformWidth ? normalizeRect(item.bounds) : getItemSourceBounds(item);
        if (source.width <= 0 || source.height <= 0) {
            return reject(`SKU "${item.name || item.id}" 缺少有效源边界。`);
        }

        const cellLeft = region.left + rowCenterOffsetX + column * (cellWidth + gapX);
        const cellTop = region.top + row * (cellHeight + gapY);
        const cellBox = makeRect(cellLeft, cellTop, cellLeft + cellWidth, cellTop + cellHeight);
        const fitScale = Math.min((cellWidth * fillRatio) / source.width, (cellHeight * fillRatio) / source.height);
        const maxUniformWidth = Math.min(
            cellWidth * fillRatio,
            cellHeight * fillRatio * source.width / source.height
        );
        if (!Number.isFinite(fitScale) || fitScale <= 0) {
            return reject(`SKU "${item.name || item.id}" 无法算出有效缩放比例。`);
        }
        plannedItems.push({
            item,
            source,
            cellBox,
            row,
            column,
            fitScale,
            maxUniformWidth
        });
    }

    const uniformWidth = useUniformWidth
        ? Math.min(...plannedItems.map((entry) => entry.maxUniformWidth))
        : 0;
    if (useUniformWidth && (!Number.isFinite(uniformWidth) || uniformWidth <= 0)) {
        return reject('单行等宽策略算不出有效公共宽度。');
    }

    const sharedScale = useUniformWidth
        ? 0
        : Math.min(...plannedItems.map((entry) => entry.fitScale));
    const plannedItemsWithScale = plannedItems.map((entry) => ({
        ...entry,
        targetScale: useUniformWidth ? uniformWidth / entry.source.width : sharedScale
    }));
    const candidateMinScalePercent = Math.min(
        ...plannedItemsWithScale.map((entry) => entry.targetScale * 100)
    );
    if (!Number.isFinite(candidateMinScalePercent) || candidateMinScalePercent < minScalePercent) {
        return reject(
            `最小缩放 ${candidateMinScalePercent.toFixed(1)}% 低于允许值 ${minScalePercent.toFixed(1)}%。`
        );
    }

    const rowMaxHeights = getRowMaxHeights(
        plannedItemsWithScale,
        (entry) => entry.source.height * entry.targetScale
    );
    const placements: SkuAutoLayoutPlacement[] = [];
    for (const entry of plannedItemsWithScale) {
        const rowMaxHeight = rowMaxHeights.get(entry.row) || entry.source.height * entry.targetScale;
        const destinationBox = buildAnchoredDestinationBox({
            source: entry.source,
            cellBox: entry.cellBox,
            scale: entry.targetScale,
            rowMaxHeight,
            verticalAnchor
        });

        if (!containsRect(safeBox, destinationBox) || !containsRect(region, destinationBox)) {
            const overflowPx = Math.max(
                rectOverflowPx(safeBox, destinationBox),
                rectOverflowPx(region, destinationBox)
            );
            return reject(
                `SKU "${entry.item.name || entry.item.id}" 目标框 `
                + `${formatDimension(destinationBox.width)}x${formatDimension(destinationBox.height)}px `
                + `超出区域 ${overflowPx.toFixed(2)}px。`
            );
        }

        placements.push({
            itemId: entry.item.id,
            layerId: entry.item.layerId,
            name: entry.item.name,
            destinationBox,
            cellBox: entry.cellBox,
            scalePercent: entry.targetScale * 100,
            row: entry.row,
            column: entry.column,
            sizingPolicy: useUniformWidth ? 'uniform-width-contain' : 'shared-scale'
        });
    }

    if (placements.length === 0) return reject('没有生成任何可执行 placement。');

    let scaleVariance = 0;
    for (const entry of plannedItemsWithScale) {
        scaleVariance += Math.max(0, entry.fitScale * 100 - entry.targetScale * 100);
    }

    const regionCenter = rectCenter(region);
    const safeCenter = rectCenter(safeBox);
    const centerDistance = Math.hypot(regionCenter.x - safeCenter.x, regionCenter.y - safeCenter.y);
    const unusedSlots = rows * cols - items.length;
    const regionAreaRatio = rectArea(region) / Math.max(1, rectArea(safeBox));
    const rowPenalty = strategy === 'single-row' && items.length > 5 ? 120 : 0;
    const unusedPenalty = unusedSlots * 20;
    const centerPenalty = centerDistance / Math.max(1, Math.min(safeBox.width, safeBox.height));
    const score = candidateMinScalePercent * 5 + regionAreaRatio * 120 - scaleVariance * 0.18 - unusedPenalty - rowPenalty - centerPenalty * 30;

    return {
        candidate: {
            strategy,
            rows,
            cols,
            region,
            score,
            minScalePercent: candidateMinScalePercent,
            centerDistance
        },
        placements
    };
}

function rebuildPlacementsAtSharedScale(
    localPlacements: SkuAutoLayoutPlacement[],
    itemsById: Map<string, SkuAutoLayoutItem>,
    sharedScalePercent: number,
    safeBox: SkuAutoLayoutRect,
    verticalAnchor: SkuAutoLayoutVerticalAnchor
): SkuAutoLayoutPlacement[] | null {
    const sharedScale = sharedScalePercent / 100;
    const placements: SkuAutoLayoutPlacement[] = [];
    const rowMaxHeights = getRowMaxHeights(localPlacements, (placement) => {
        const item = itemsById.get(placement.itemId);
        if (!item) return 0;
        return getItemSourceBounds(item).height * sharedScale;
    });

    for (const placement of localPlacements) {
        const item = itemsById.get(placement.itemId);
        if (!item) return null;
        const source = getItemSourceBounds(item);
        const finalWidth = source.width * sharedScale;
        const finalHeight = source.height * sharedScale;
        if (!Number.isFinite(finalWidth) || !Number.isFinite(finalHeight) || finalWidth <= 0 || finalHeight <= 0) return null;

        const rowMaxHeight = rowMaxHeights.get(placement.row) || finalHeight;
        const destinationBox = buildAnchoredDestinationBox({
            source,
            cellBox: placement.cellBox,
            scale: sharedScale,
            rowMaxHeight,
            verticalAnchor
        });
        if (!containsRect(safeBox, destinationBox) || !containsRect(placement.cellBox, destinationBox)) return null;

        placements.push({
            ...placement,
            destinationBox,
            scalePercent: sharedScalePercent
        });
    }

    return placements;
}

function placementsRespectSpacing(placements: SkuAutoLayoutPlacement[], minSpacingPx: number): boolean {
    const expandBy = Math.max(0, minSpacingPx - PLAN_GEOMETRY_TOLERANCE_PX) / 2;
    for (let i = 0; i < placements.length; i++) {
        for (let j = i + 1; j < placements.length; j++) {
            const a = expandRect(placements[i].destinationBox, expandBy);
            const b = expandRect(placements[j].destinationBox, expandBy);
            if (intersects(a, b)) return false;
        }
    }
    return true;
}

function enumeratePartitions(total: number, parts: number): number[][] {
    if (parts <= 0 || total < parts) return [];
    if (parts === 1) return [[total]];

    const results: number[][] = [];
    const maxFirst = total - (parts - 1);
    for (let first = 1; first <= maxFirst; first++) {
        for (const rest of enumeratePartitions(total - first, parts - 1)) {
            results.push([first, ...rest]);
        }
    }
    return results;
}

function enumerateRegionCombinations(regions: SkuAutoLayoutRect[], count: number, limit = 48): SkuAutoLayoutRect[][] {
    const source = regions.slice(0, Math.min(regions.length, 8));
    const results: SkuAutoLayoutRect[][] = [];

    function walk(start: number, picked: SkuAutoLayoutRect[]) {
        if (results.length >= limit) return;
        if (picked.length === count) {
            results.push(sortRegionsForLayout(picked));
            return;
        }
        for (let index = start; index < source.length; index++) {
            walk(index + 1, [...picked, source[index]]);
        }
    }

    walk(0, []);
    return results;
}

function getTopLocalRegionCandidates(
    region: SkuAutoLayoutRect,
    safeBox: SkuAutoLayoutRect,
    items: SkuAutoLayoutItem[],
    strategyRequest: SkuAutoLayoutStrategy,
    verticalAnchor: SkuAutoLayoutVerticalAnchor,
    fillRatio: number,
    minScalePercent: number,
    minSpacingPx: number
): CandidateBuildResult[] {
    const candidates: CandidateBuildResult[] = [];
    for (const shape of enumerateGridShapes(items.length, strategyRequest)) {
        const candidate = buildCandidate(
            region,
            safeBox,
            items,
            shape.rows,
            shape.cols,
            shape.strategy,
            verticalAnchor,
            fillRatio,
            minScalePercent,
            minSpacingPx
        );
        if (candidate) candidates.push(candidate);
    }

    return candidates
        .sort((a, b) => b.candidate.minScalePercent - a.candidate.minScalePercent || b.candidate.score - a.candidate.score)
        .slice(0, 3);
}

function combineLocalCandidateGroups(
    groups: CandidateBuildResult[][],
    limit = 96
): CandidateBuildResult[][] {
    const results: CandidateBuildResult[][] = [];

    function walk(index: number, picked: CandidateBuildResult[]) {
        if (results.length >= limit) return;
        if (index >= groups.length) {
            results.push(picked);
            return;
        }
        for (const candidate of groups[index]) {
            walk(index + 1, [...picked, candidate]);
        }
    }

    walk(0, []);
    return results;
}

function buildMultiRegionCandidates(
    regions: SkuAutoLayoutRect[],
    safeBox: SkuAutoLayoutRect,
    items: SkuAutoLayoutItem[],
    strategyRequest: SkuAutoLayoutStrategy,
    verticalAnchor: SkuAutoLayoutVerticalAnchor,
    fillRatio: number,
    minScalePercent: number,
    minSpacingPx: number
): CandidateBuildResult[] {
    if (regions.length < 2 || items.length < 2) return [];

    const candidates: CandidateBuildResult[] = [];
    const regionsByArea = regions
        .slice()
        .sort((a, b) => rectArea(b) - rectArea(a))
        .slice(0, Math.min(regions.length, 8));
    const maxRegionCount = Math.min(4, regionsByArea.length, items.length);
    const itemsById = new Map(items.map((item) => [item.id, item]));

    for (let regionCount = 2; regionCount <= maxRegionCount; regionCount++) {
        const regionGroups = enumerateRegionCombinations(regionsByArea, regionCount);
        const partitions = enumeratePartitions(items.length, regionCount);

        for (const regionGroup of regionGroups) {
            for (const partition of partitions) {
                let cursor = 0;
                const localGroups: CandidateBuildResult[][] = [];
                let valid = true;

                for (let groupIndex = 0; groupIndex < regionGroup.length; groupIndex++) {
                    const count = partition[groupIndex];
                    const itemSlice = items.slice(cursor, cursor + count);
                    cursor += count;
                    const localCandidates = getTopLocalRegionCandidates(
                        regionGroup[groupIndex],
                        safeBox,
                        itemSlice,
                        strategyRequest,
                        verticalAnchor,
                        fillRatio,
                        minScalePercent,
                        minSpacingPx
                    );
                    if (localCandidates.length === 0) {
                        valid = false;
                        break;
                    }
                    localGroups.push(localCandidates);
                }

                if (!valid) continue;

                for (const localCombination of combineLocalCandidateGroups(localGroups)) {
                    const sharedScalePercent = Math.min(...localCombination.map((entry) => entry.candidate.minScalePercent));
                    if (!Number.isFinite(sharedScalePercent) || sharedScalePercent < minScalePercent) continue;

                    const localPlacements = localCombination.flatMap((entry) => entry.placements);
                    const placements = rebuildPlacementsAtSharedScale(localPlacements, itemsById, sharedScalePercent, safeBox, verticalAnchor);
                    if (!placements || placements.length !== items.length) continue;
                    if (!placementsRespectSpacing(placements, minSpacingPx)) continue;

                    const usedRegions = localCombination.map((entry) => entry.candidate.region);
                    const selectedRegion = unionRects(usedRegions);
                    const totalRegionAreaRatio = usedRegions.reduce((sum, region) => sum + rectArea(region), 0) / Math.max(1, rectArea(safeBox));
                    const centerDistance = getRectCenterDistance(selectedRegion, safeBox);
                    const strategy = localCombination.every((entry) => entry.candidate.rows === 1) ? 'single-row' : 'grid';
                    const localScore = localCombination.reduce((sum, entry) => sum + entry.candidate.score, 0) / localCombination.length;
                    const balancePenalty = (Math.max(...partition) - Math.min(...partition)) * 8;
                    const centerPenalty = centerDistance / Math.max(1, Math.min(safeBox.width, safeBox.height));
                    const score = sharedScalePercent * 5
                        + totalRegionAreaRatio * 110
                        + localScore * 0.18
                        - balancePenalty
                        - centerPenalty * 26
                        - (regionCount - 1) * 10;

                    candidates.push({
                        candidate: {
                            strategy,
                            rows: Math.max(...localCombination.map((entry) => entry.candidate.rows)),
                            cols: Math.max(...localCombination.map((entry) => entry.candidate.cols)),
                            region: selectedRegion,
                            score,
                            minScalePercent: sharedScalePercent,
                            centerDistance
                        },
                        placements
                    });
                }
            }
        }
    }

    return candidates;
}

function buildCandidateResultsForFillRatio(
    freeRegions: SkuAutoLayoutRect[],
    safeBox: SkuAutoLayoutRect,
    items: SkuAutoLayoutItem[],
    strategyRequest: SkuAutoLayoutStrategy,
    verticalAnchor: SkuAutoLayoutVerticalAnchor,
    fillRatio: number,
    minScalePercent: number,
    minSpacingPx: number,
    sizingPolicy: SkuAutoLayoutSizingPolicy
): CandidateBuildResult[] {
    const results: CandidateBuildResult[] = [];

    for (const region of freeRegions.slice(0, 24)) {
        for (const shape of enumerateGridShapes(items.length, strategyRequest)) {
            const candidate = buildCandidate(
                region,
                safeBox,
                items,
                shape.rows,
                shape.cols,
                shape.strategy,
                verticalAnchor,
                fillRatio,
                minScalePercent,
                minSpacingPx,
                sizingPolicy
            );
            if (candidate) results.push(candidate);
        }
    }

    if (sizingPolicy === 'shared-scale') {
        results.push(...buildMultiRegionCandidates(
            freeRegions,
            safeBox,
            items,
            strategyRequest,
            verticalAnchor,
            fillRatio,
            minScalePercent,
            minSpacingPx
        ));
    }

    return results;
}

function buildLayoutSearchFailureWarnings(input: {
    freeRegions: SkuAutoLayoutRect[];
    obstacles: SkuAutoLayoutObstacle[];
    itemCount: number;
    constraints: SkuAutoLayoutPlan['constraints'];
}): string[] {
    if (input.freeRegions.length === 0) return [];

    const largestRegion = input.freeRegions
        .slice()
        .sort((a, b) => rectArea(b) - rectArea(a))[0] || ZERO_RECT;
    return [
        [
            `已检查 ${input.freeRegions.length} 个空闲区域，但尺寸或缩放比例不足。`,
            `最大空闲区域约 ${formatDimension(largestRegion.width)}x${formatDimension(largestRegion.height)}px。`,
            `SKU 数量 ${input.itemCount}，模板障碍 ${input.obstacles.length} 个，最小缩放 ${formatDimension(input.constraints.minScalePercent)}%，最小间距 ${formatDimension(input.constraints.minSpacingPx)}px，避让 ${formatDimension(input.constraints.clearancePx)}px。`
        ].join(' ')
    ];
}

function buildAutoLayoutDiagnosticsSummary(input: {
    safeBox: SkuAutoLayoutRect;
    freeRegions: SkuAutoLayoutRect[];
    obstacles: SkuAutoLayoutObstacle[];
    items: SkuAutoLayoutItem[];
    constraints: SkuAutoLayoutPlan['constraints'];
}): SkuAutoLayoutDiagnosticsSummary {
    const largestFreeRegion = input.freeRegions
        .slice()
        .sort((a, b) => rectArea(b) - rectArea(a))[0] || ZERO_RECT;
    const totalFreeRegionAreaPx = input.freeRegions.reduce((sum, region) => sum + rectArea(region), 0);
    const safeBoxAreaPx = rectArea(input.safeBox);
    const largestItemBounds = input.items
        .map((item) => getItemSourceBounds(item))
        .sort((a, b) => rectArea(b) - rectArea(a))[0] || ZERO_RECT;
    const largestItemAreaPx = rectArea(largestItemBounds);
    const totalItemAreaPx = input.items.reduce((sum, item) => sum + rectArea(getItemSourceBounds(item)), 0);
    const expandedObstacleCount = buildExpandedObstacles(
        input.safeBox,
        input.obstacles,
        input.constraints.clearancePx
    ).length;
    const likelyBlockers: string[] = [];
    const freeAreaRatio = safeBoxAreaPx > 0 ? totalFreeRegionAreaPx / safeBoxAreaPx : 0;
    const largestRegionRatio = safeBoxAreaPx > 0 ? rectArea(largestFreeRegion) / safeBoxAreaPx : 0;

    if (input.freeRegions.length === 0) {
        likelyBlockers.push('no_free_region');
    } else if (freeAreaRatio < 0.25) {
        likelyBlockers.push('template_obstacles_consume_safe_area');
    }
    if (input.freeRegions.length >= 8 && largestRegionRatio < 0.35) {
        likelyBlockers.push('free_regions_are_fragmented');
    }
    if (input.items.length >= 15 && largestRegionRatio < 0.45) {
        likelyBlockers.push('high_item_count_needs_larger_contiguous_area');
    }
    if (input.items.length >= 24 || (safeBoxAreaPx > 0 && totalItemAreaPx / safeBoxAreaPx > 8)) {
        likelyBlockers.push('high_item_count_needs_more_canvas_area');
    }
    if (input.constraints.minScalePercent >= 30) {
        likelyBlockers.push('min_scale_constraint_is_strict');
    }
    if (input.constraints.minSpacingPx >= 80) {
        likelyBlockers.push('min_spacing_constraint_is_strict');
    }

    return {
        itemCount: input.items.length,
        obstacleCount: input.obstacles.length,
        expandedObstacleCount,
        safeBox: input.safeBox,
        safeBoxAreaPx,
        freeRegionCount: input.freeRegions.length,
        largestFreeRegion,
        largestFreeRegionAreaPx: rectArea(largestFreeRegion),
        totalFreeRegionAreaPx,
        largestItemBounds,
        largestItemAreaPx,
        totalItemAreaPx,
        constraints: input.constraints,
        likelyBlockers
    };
}

function emptyPlan(
    status: SkuAutoLayoutStatus,
    safeBox: SkuAutoLayoutRect,
    blockers: string[],
    warnings: string[] = [],
    constraints: SkuAutoLayoutPlan['constraints'] = { minSpacingPx: 0, clearancePx: 0, minScalePercent: 0 },
    summary?: SkuAutoLayoutDiagnosticsSummary
): SkuAutoLayoutPlan {
    return {
        schema: 'sku-auto-layout-plan/v0',
        status,
        strategy: 'single-row',
        safeBox,
        selectedRegion: { ...ZERO_RECT },
        placements: [],
        diagnostics: {
            candidates: [],
            warnings,
            blockers,
            ...(summary ? { summary } : {})
        },
        constraints,
        boundaries: {
            writesPhotoshop: false,
            claimsDesignQuality: false
        }
    };
}

export function buildSkuAutoLayoutPlan(input: SkuAutoLayoutPlanInput): SkuAutoLayoutPlan {
    const safeBox = getSafeBox(input);
    const warnings: string[] = [];
    const blockers: string[] = [];
    const preset = input.preset || 'sku-combo';
    const strategyRequest = input.strategy || 'auto';
    const items = Array.isArray(input.items) ? input.items : [];
    const canvasMinSide = Math.min(finite(input.canvas?.width, 1), finite(input.canvas?.height, 1));
    const minSpacingPx = Math.max(0, finite(input.minSpacingPx, getDefaultMinSpacingPx(canvasMinSide, preset)));
    const clearancePx = Math.max(0, finite(input.clearancePx, clamp(canvasMinSide * 0.02, 12, 40)));
    const minScalePercent = input.minScalePercent ?? (preset === 'sku-note' ? 16 : 18);
    const constraints = { minSpacingPx, clearancePx, minScalePercent };

    if (items.length === 0) {
        return emptyPlan('blocked', safeBox, ['没有可排版的 SKU 图层。'], [], constraints);
    }

    for (const item of items) {
        const bounds = getItemSourceBounds(item);
        if (!item?.id || bounds.width <= 0 || bounds.height <= 0) {
            blockers.push(`SKU 图层 "${item?.name || item?.id || 'unknown'}" 缺少有效边界。`);
        }
    }
    if (blockers.length > 0) return emptyPlan('blocked', safeBox, blockers, [], constraints);

    const obstacles = (input.obstacles || [])
        .map((obstacle) => ({
            ...obstacle,
            bounds: normalizeRect(obstacle.bounds)
        }))
        .filter((obstacle) => obstacle.bounds.width > 0 && obstacle.bounds.height > 0);
    const freeRegions = buildFreeRegions(safeBox, obstacles, clearancePx);
    const diagnosticsSummary = buildAutoLayoutDiagnosticsSummary({
        safeBox,
        freeRegions,
        obstacles,
        items,
        constraints
    });

    if (freeRegions.length === 0) {
        return emptyPlan(
            'blocked',
            safeBox,
            ['没有可用排版区域：安全区已被模板元素占用或画布过小。'],
            [],
            constraints,
            diagnosticsSummary
        );
    }

    const fillRatio = getPresetFillRatio(preset);
    const verticalAnchor = getPresetVerticalAnchor(preset);
    const sizingPolicy = input.sizingPolicy || 'shared-scale';
    let results = buildCandidateResultsForFillRatio(
        freeRegions,
        safeBox,
        items,
        strategyRequest,
        verticalAnchor,
        fillRatio,
        minScalePercent,
        minSpacingPx,
        sizingPolicy
    );
    let usedCompactFallback = false;

    if (results.length === 0) {
        for (const compactFillRatio of getCompactFallbackFillRatios(fillRatio, preset)) {
            const compactResults = buildCandidateResultsForFillRatio(
                freeRegions,
                safeBox,
                items,
                strategyRequest,
                verticalAnchor,
                compactFillRatio,
                minScalePercent,
                minSpacingPx,
                sizingPolicy
            );
            if (compactResults.length > 0) {
                results = compactResults;
                usedCompactFallback = true;
                break;
            }
        }
    }

    const ranked = results.sort((a, b) => b.candidate.score - a.candidate.score);
    if (ranked.length === 0) {
        return emptyPlan(
            'blocked',
            safeBox,
            ['没有可用排版区域：当前安全区无法在不遮挡模板元素的情况下容纳全部 SKU。'],
            buildLayoutSearchFailureWarnings({
                freeRegions,
                obstacles,
                itemCount: items.length,
                constraints
            }),
            constraints,
            diagnosticsSummary
        );
    }

    const selected = ranked[0];
    if (obstacles.length > 0) {
        warnings.push('已根据模板中可见元素避让生成排版区域，仍需要导出图或人工复核确认视觉效果。');
    }
    if (usedCompactFallback) {
        warnings.push('普通留白排版无法容纳全部 SKU，已启用紧凑排版策略；仍保持最小间距和模板元素避让。');
    }
    if (selected.candidate.minScalePercent < minScalePercent + 4) {
        warnings.push('SKU 缩放接近最小可用阈值，建议复核导出图中袜子是否过小。');
    }

    return {
        schema: 'sku-auto-layout-plan/v0',
        status: 'ready',
        strategy: selected.candidate.strategy,
        safeBox,
        selectedRegion: selected.candidate.region,
        placements: selected.placements,
        diagnostics: {
            candidates: ranked.slice(0, 8).map((result) => result.candidate),
            warnings,
            blockers: [],
            summary: diagnosticsSummary
        },
        constraints,
        boundaries: {
            writesPhotoshop: false,
            claimsDesignQuality: false
        }
    };
}

/**
 * 把一组 SKU 严格排入模板声明的单个矩形区域。
 *
 * 与自由画布自动排版不同，这里不搜索区域，也不读取模板语义；调用方已经通过
 * TemplateLayoutPlan 确认了区域及其容量。本函数只负责把区域确定性拆成互不重叠的
 * 子槽，并以共享缩放比例生成可执行 placement。这样一个区域承载 2/3/4 张卡时，
 * 不会再把每张卡都按整个区域放大后仅靠左/中/右对齐来碰运气。
 */
export function buildSkuBoundedRegionLayoutPlan(
    input: SkuBoundedRegionLayoutPlanInput
): SkuAutoLayoutPlan {
    const region = normalizeRect(input.region);
    const items = Array.isArray(input.items) ? input.items : [];
    const minSide = Math.min(region.width, region.height);
    const templateGutterPx = finite(input.gutterPx, 0);
    const hasTemplateGutter = templateGutterPx > 0;
    // 模板量出来的沟槽是权威：它同时充当最小间距，否则会被默认下限抬高、又和模板对不上。
    const minSpacingPx = hasTemplateGutter
        ? templateGutterPx
        : Math.max(0, finite(input.minSpacingPx, clamp(minSide * 0.035, 8, 32)));
    const minScalePercent = Math.max(0, finite(input.minScalePercent, 8));
    const strategy = input.strategy || 'auto';
    const sizingPolicy = input.sizingPolicy || 'shared-scale';
    // 模板声明的区域就是设计师画好的外框：子槽内按 1.0 贴满、只留 gapX/gapY 作沟槽。
    // 此前多件默认 0.9——每格四周再留 5%，两格之间的可见间距 = 沟槽 + 两个 5% ≈ 三倍宽，
    // 用户 2026-08-18 真机指出「间距太宽，和占位符设计的不一样」。调用方仍可显式传 fillRatio。
    const fillRatio = clamp(
        finite(input.fillRatio, 1),
        0.5,
        1
    );
    const constraints = {
        minSpacingPx,
        clearancePx: 0,
        minScalePercent
    };

    if (region.width <= 12 || region.height <= 12) {
        return emptyPlan(
            'blocked',
            region,
            ['模板声明的 SKU 区域缺少有效矩形边界。'],
            [],
            constraints
        );
    }
    if (items.length === 0) {
        return emptyPlan('blocked', region, ['当前模板区域没有可排版的 SKU 图层。'], [], constraints);
    }

    const blockers: string[] = [];
    for (const item of items) {
        const bounds = getItemSourceBounds(item);
        if (!item?.id || bounds.width <= 0 || bounds.height <= 0) {
            blockers.push(`SKU 图层 "${item?.name || item?.id || 'unknown'}" 缺少有效边界。`);
        }
    }
    if (blockers.length > 0) return emptyPlan('blocked', region, blockers, [], constraints);

    const results: CandidateBuildResult[] = [];
    const rejections: string[] = [];
    for (const shape of enumerateGridShapes(items.length, strategy)) {
        const candidate = buildCandidate(
            region,
            region,
            items,
            shape.rows,
            shape.cols,
            shape.strategy,
            'center',
            fillRatio,
            minScalePercent,
            minSpacingPx,
            sizingPolicy,
            rejections,
            hasTemplateGutter ? templateGutterPx : undefined
        );
        if (!candidate) continue;
        if (!placementsRespectSpacing(candidate.placements, minSpacingPx)) {
            pushUnique(
                rejections,
                `${shape.rows}×${shape.cols} 候选被否：相邻 SKU 的间距小于 ${formatDimension(minSpacingPx)}px。`
            );
            continue;
        }
        results.push(candidate);
    }

    const ranked = results.sort((a, b) => b.candidate.score - a.candidate.score);
    if (ranked.length === 0) {
        return emptyPlan(
            'blocked',
            region,
            [
                `模板区域 ${Math.round(region.width)}x${Math.round(region.height)}px 无法在保持间距的前提下容纳 ${items.length} 个 SKU`
                + `（SKU 原始尺寸 ${formatDimension(getItemSourceBounds(items[0]).width)}x`
                + `${formatDimension(getItemSourceBounds(items[0]).height)}px）。`,
                ...rejections
            ],
            [],
            constraints
        );
    }

    const selected = ranked[0];
    const warnings: string[] = [];
    if (selected.candidate.minScalePercent < 14) {
        warnings.push('SKU 在模板区域内的缩放比例较小，需要在导出读回中复核可读性。');
    }
    rejections.forEach((reason) => pushUnique(warnings, reason));

    return {
        schema: 'sku-auto-layout-plan/v0',
        status: 'ready',
        strategy: selected.candidate.strategy,
        safeBox: region,
        selectedRegion: region,
        placements: selected.placements,
        diagnostics: {
            candidates: ranked.slice(0, 8).map((result) => result.candidate),
            warnings,
            blockers: []
        },
        constraints,
        boundaries: {
            writesPhotoshop: false,
            claimsDesignQuality: false
        }
    };
}

/**
 * 把模板已经确认的显式槽位收敛成一个全局单行计划。
 *
 * 自选备注可能来自单区域 4 槽、两个区域 [2,2]，或四个 ordered slot。
 * 这些槽位不能各自计算缩放，否则多个局部 ready 仍可能导出两行或不等宽色卡。
 * 本函数只在所有槽位存在共同垂直带且按 X 严格递增时签发计划，并以完整图层
 * 外框计算一次全局公共宽度；每张卡独立等比缩放，最终都使用同一个宽度。
 */
export function buildSkuExplicitSingleRowLayoutPlan(
    input: SkuExplicitSingleRowLayoutPlanInput
): SkuAutoLayoutPlan {
    const items = Array.isArray(input.items) ? input.items : [];
    const cells = (Array.isArray(input.cells) ? input.cells : []).map(normalizeRect);
    const safeBox = unionRects(cells);
    const minSide = Math.max(1, Math.min(safeBox.width, safeBox.height));
    const minSpacingPx = Math.max(0, finite(input.minSpacingPx, clamp(minSide * 0.02, 4, 24)));
    const minScalePercent = Math.max(0, finite(input.minScalePercent, 8));
    const fillRatio = clamp(finite(input.fillRatio, 0.9), 0.5, 1);
    const constraints = {
        minSpacingPx,
        clearancePx: 0,
        minScalePercent
    };
    const blockers: string[] = [];

    if (items.length === 0 || cells.length === 0) {
        blockers.push('自选备注全局单行计划缺少颜色卡或显式槽位。');
    }
    if (items.length !== cells.length) {
        blockers.push(`自选备注颜色卡数量 ${items.length} 与显式槽位数量 ${cells.length} 不一致。`);
    }
    if (cells.some((cell) => cell.width <= 12 || cell.height <= 12)) {
        blockers.push('自选备注存在无效显式槽位边界。');
    }

    const itemSources = items.map((item) => normalizeRect(item.bounds));
    if (itemSources.some((source) => source.width <= 0 || source.height <= 0)) {
        blockers.push('自选备注颜色卡缺少有效完整外框。');
    }

    const cellCenters = cells.map(rectCenter);
    for (let index = 1; index < cells.length; index++) {
        if (cellCenters[index - 1].x >= cellCenters[index].x) {
            pushUnique(blockers, '自选备注显式槽位没有按从左到右严格递增。');
        }
        if (cells[index - 1].right > cells[index].left) {
            pushUnique(blockers, '自选备注显式槽位互相重叠，不能形成确定性单行。');
        }
    }

    const sharedRowTop = cells.length > 0 ? Math.max(...cells.map((cell) => cell.top)) : 0;
    const sharedRowBottom = cells.length > 0 ? Math.min(...cells.map((cell) => cell.bottom)) : 0;
    const sharedRowHeight = sharedRowBottom - sharedRowTop;
    if (sharedRowHeight <= 12) {
        pushUnique(blockers, '自选备注模板槽位不在同一水平行，不能导出两行或错位结果。');
    }

    if (blockers.length > 0) {
        return emptyPlan('blocked', safeBox, blockers, [], constraints);
    }

    const uniformWidth = Math.min(...items.map((_, index) => {
        const source = itemSources[index];
        const cell = cells[index];
        return Math.min(
            cell.width * fillRatio,
            sharedRowHeight * fillRatio * source.width / source.height
        );
    }));
    if (!Number.isFinite(uniformWidth) || uniformWidth <= 0) {
        return emptyPlan('blocked', safeBox, ['自选备注无法计算有效的全局统一宽度。'], [], constraints);
    }

    const sharedCenterY = sharedRowTop + sharedRowHeight / 2;
    const placements: SkuAutoLayoutPlacement[] = items.map((item, index) => {
        const source = itemSources[index];
        const cell = cells[index];
        const centerX = cellCenters[index].x;
        const scale = uniformWidth / source.width;
        const height = source.height * scale;
        const destinationBox = makeRect(
            centerX - uniformWidth / 2,
            sharedCenterY - height / 2,
            centerX + uniformWidth / 2,
            sharedCenterY + height / 2
        );
        return {
            itemId: item.id,
            layerId: item.layerId,
            name: item.name,
            destinationBox,
            cellBox: cell,
            scalePercent: scale * 100,
            row: 0,
            column: index,
            sizingPolicy: 'uniform-width-contain'
        };
    });

    const minimumScalePercent = Math.min(...placements.map((placement) => placement.scalePercent));
    if (minimumScalePercent < minScalePercent) {
        return emptyPlan(
            'blocked',
            safeBox,
            [`自选备注统一宽度后的最小缩放 ${minimumScalePercent.toFixed(1)}% 低于允许值 ${minScalePercent.toFixed(1)}%。`],
            [],
            constraints
        );
    }
    if (placements.some((placement, index) => !containsRect(cells[index], placement.destinationBox))) {
        return emptyPlan('blocked', safeBox, ['自选备注统一宽度目标超出对应显式槽位。'], [], constraints);
    }
    if (!placementsRespectSpacing(placements, minSpacingPx)) {
        return emptyPlan('blocked', safeBox, ['自选备注全局单行目标未满足最小间距。'], [], constraints);
    }

    const warnings = minimumScalePercent < 14
        ? ['自选备注统一宽度后的缩放比例较小，需要在导出读回中复核可读性。']
        : [];
    return {
        schema: 'sku-auto-layout-plan/v0',
        status: 'ready',
        strategy: 'single-row',
        safeBox,
        selectedRegion: safeBox,
        placements,
        diagnostics: {
            candidates: [{
                strategy: 'single-row',
                rows: 1,
                cols: items.length,
                region: safeBox,
                score: minimumScalePercent * 5,
                minScalePercent: minimumScalePercent,
                centerDistance: 0
            }],
            warnings,
            blockers: []
        },
        constraints,
        boundaries: {
            writesPhotoshop: false,
            claimsDesignQuality: false
        }
    };
}

export function verifySkuAutoLayoutResult(input: SkuAutoLayoutQaInput): SkuAutoLayoutQaResult {
    const plan = input.plan;
    const blockers: string[] = [];
    const warnings: string[] = [];
    const tolerancePx = Math.max(0, finite(input.tolerancePx, 10));
    const minSpacingPx = Math.max(0, finite(input.minSpacingPx, plan?.constraints?.minSpacingPx || 0));
    const clearancePx = Math.max(0, finite(input.clearancePx, plan?.constraints?.clearancePx || minSpacingPx));
    const safeBox = normalizeRect(plan.safeBox);

    if (!plan || plan.schema !== 'sku-auto-layout-plan/v0') {
        pushUnique(blockers, '执行后校验失败：缺少有效的 SKU 自动排版计划。');
    } else if (plan.status !== 'ready') {
        pushUnique(blockers, `执行后校验失败：SKU 自动排版计划状态不是 ready（当前为 ${plan.status}）。`);
    }

    const planPlacements = Array.isArray(plan?.placements) ? plan.placements : [];
    const actualPlacements = Array.isArray(input.actualPlacements) ? input.actualPlacements : [];
    const requestedExpectedCount = Number(input.expectedItemCount);
    const hasExplicitExpectedCount = input.expectedItemCount !== undefined;
    const hasValidExpectedCount = hasExplicitExpectedCount
        && Number.isInteger(requestedExpectedCount)
        && requestedExpectedCount > 0;
    const expectedItemCount = hasValidExpectedCount
        ? requestedExpectedCount
        : planPlacements.length;

    if (hasExplicitExpectedCount && !hasValidExpectedCount) {
        pushUnique(blockers, '执行后校验失败：expectedItemCount 必须是大于 0 的整数。');
    }
    if (planPlacements.length !== expectedItemCount) {
        pushUnique(
            blockers,
            `执行后校验失败：计划 placement 数量 ${planPlacements.length} 与期望数量 ${expectedItemCount} 不一致。`
        );
    }
    if (actualPlacements.length !== expectedItemCount) {
        pushUnique(
            blockers,
            `执行后校验失败：最终实时边界数量 ${actualPlacements.length} 与期望数量 ${expectedItemCount} 不一致。`
        );
    }
    if (
        input.actualTopLevelItemCount !== undefined
        && Number(input.actualTopLevelItemCount) !== expectedItemCount
    ) {
        pushUnique(
            blockers,
            `执行后校验失败：唯一顶层颜色卡数量 ${Number(input.actualTopLevelItemCount) || 0} 与期望数量 ${expectedItemCount} 不一致。`
        );
    }

    const planIdentityKeys = planPlacements.map((placement) => (
        placement.layerId !== undefined
            ? `layer:${Number(placement.layerId)}`
            : `item:${String(placement.itemId || '')}`
    ));
    if (new Set(planIdentityKeys).size !== planIdentityKeys.length) {
        pushUnique(blockers, '执行后校验失败：计划中存在重复颜色卡，不能把同一顶层组重复排版。');
    }
    const actualIdentityKeys = actualPlacements.map((placement) => (
        placement.layerId !== undefined
            ? `layer:${Number(placement.layerId)}`
            : `item:${String(placement.itemId || '')}`
    ));
    if (new Set(actualIdentityKeys).size !== actualIdentityKeys.length) {
        pushUnique(blockers, '执行后校验失败：最终实时边界中存在重复颜色卡。');
    }

    const expectedTopLevelLayerIds = Array.from(new Set(
        (input.expectedTopLevelLayerIds || [])
            .map((layerId) => Number(layerId))
            .filter(Number.isFinite)
    )).sort((a, b) => a - b);
    if (input.expectedTopLevelLayerIds !== undefined) {
        const plannedLayerIds = Array.from(new Set(
            planPlacements
                .map((placement) => Number(placement.layerId))
                .filter(Number.isFinite)
        )).sort((a, b) => a - b);
        const actualLayerIds = Array.from(new Set(
            actualPlacements
                .map((placement) => Number(placement.layerId))
                .filter(Number.isFinite)
        )).sort((a, b) => a - b);
        const expectedKey = expectedTopLevelLayerIds.join(',');
        if (expectedTopLevelLayerIds.length !== expectedItemCount) {
            pushUnique(blockers, '执行后校验失败：复制得到的唯一顶层颜色卡 ID 集合与期望数量不一致。');
        }
        if (plannedLayerIds.join(',') !== expectedKey) {
            pushUnique(blockers, '执行后校验失败：planner placement 不是复制得到的顶层颜色卡 ID 集合。');
        }
        if (actualLayerIds.join(',') !== expectedKey) {
            pushUnique(blockers, '执行后校验失败：最终实时回读不是复制得到的顶层颜色卡 ID 集合。');
        }
    }

    if (plan?.strategy === 'single-row') {
        const singleRowOrderIsValid = planPlacements.every((placement, index) => (
            placement.row === 0
            && placement.column === index
            && (
                index === 0
                || rectCenter(planPlacements[index - 1].destinationBox).x
                    < rectCenter(placement.destinationBox).x
            )
        ));
        if (!singleRowOrderIsValid) {
            pushUnique(blockers, '执行后校验失败：single-row placement 必须位于第 0 行、列号连续且从左到右递增。');
        }
    }

    const actualByLayerId = new Map<number, SkuAutoLayoutActualPlacement>();
    const actualByItemId = new Map<string, SkuAutoLayoutActualPlacement>();
    for (const actual of actualPlacements) {
        if (actual?.layerId !== undefined) actualByLayerId.set(Number(actual.layerId), actual);
        if (actual?.itemId) actualByItemId.set(String(actual.itemId), actual);
    }

    const qaPlacements: SkuAutoLayoutQaPlacement[] = [];
    for (const placement of planPlacements) {
        const actual = placement.layerId !== undefined
            ? actualByLayerId.get(Number(placement.layerId)) || actualByItemId.get(placement.itemId)
            : actualByItemId.get(placement.itemId);
        const destinationBox = normalizeRect(placement.destinationBox);
        const actualBounds = actual?.actualBounds ? normalizeRect(actual.actualBounds) : null;

        if (!actualBounds || actualBounds.width <= 0 || actualBounds.height <= 0) {
            pushUnique(blockers, `SKU 图层 "${placement.name || placement.itemId}" 执行后缺少有效实际边界，不能导出。`);
            qaPlacements.push({
                itemId: placement.itemId,
                layerId: placement.layerId,
                name: placement.name,
                destinationBox,
                actualBounds: null,
                actualSubjectBounds: null,
                centerDeltaPx: null,
                maxOverflowPx: null
            });
            continue;
        }

        const actualSubjectBounds = actual?.actualSubjectBounds ? normalizeRect(actual.actualSubjectBounds) : actualBounds;
        const usesUniformOuterWidth = placement.sizingPolicy === 'uniform-width-contain';
        const targetBounds = usesUniformOuterWidth
            ? actualBounds
            : (actualSubjectBounds.width > 0 && actualSubjectBounds.height > 0 ? actualSubjectBounds : actualBounds);
        const centerDeltaPx = getRectCenterDistance(destinationBox, targetBounds);
        const targetOverflowPx = rectOverflowPx(expandRect(destinationBox, tolerancePx), targetBounds);
        const safeOverflowPx = rectOverflowPx(expandRect(safeBox, tolerancePx), actualBounds);
        const dimensionTolerancePx = Math.max(2, Math.min(tolerancePx, 4));

        if (targetOverflowPx > 0 || centerDeltaPx > tolerancePx) {
            pushUnique(
                blockers,
                `SKU 图层 "${placement.name || placement.itemId}" 执行后实际边界偏离目标框，不能把计划框当作 Photoshop 执行结果。`
            );
        }

        if (safeOverflowPx > 0) {
            pushUnique(blockers, `SKU 图层 "${placement.name || placement.itemId}" 执行后超出安全区，不能导出。`);
        }

        if (
            usesUniformOuterWidth
            && (
                Math.abs(actualBounds.width - destinationBox.width) > dimensionTolerancePx
                || Math.abs(actualBounds.height - destinationBox.height) > dimensionTolerancePx
            )
        ) {
            pushUnique(
                blockers,
                `SKU 图层 "${placement.name || placement.itemId}" 的最终实时外框尺寸未达到等比统一宽度目标。`
            );
        }

        qaPlacements.push({
            itemId: placement.itemId,
            layerId: placement.layerId,
            name: placement.name,
            destinationBox,
            actualBounds,
            actualSubjectBounds: targetBounds,
            centerDeltaPx,
            maxOverflowPx: Math.max(targetOverflowPx, safeOverflowPx)
        });
    }

    const uniformWidthPlacements = planPlacements.filter(
        (placement) => placement.sizingPolicy === 'uniform-width-contain'
    );
    if (uniformWidthPlacements.length > 1) {
        const plannedWidths = uniformWidthPlacements.map((placement) => normalizeRect(placement.destinationBox).width);
        if (Math.max(...plannedWidths) - Math.min(...plannedWidths) > 0.01) {
            pushUnique(blockers, '执行后校验失败：统一宽度模板规则下的 destinationBox 宽度不一致。');
        }

        const actualWidths = uniformWidthPlacements
            .map((placement) => {
                const actual = placement.layerId !== undefined
                    ? actualByLayerId.get(Number(placement.layerId)) || actualByItemId.get(placement.itemId)
                    : actualByItemId.get(placement.itemId);
                return actual?.actualBounds ? normalizeRect(actual.actualBounds).width : null;
            })
            .filter((width): width is number => width !== null);
        if (actualWidths.length === uniformWidthPlacements.length
            && Math.max(...actualWidths) - Math.min(...actualWidths) > 4) {
            pushUnique(blockers, '执行后校验失败：自选备注色卡的最终实时外框没有保持等宽。');
        }
    }

    for (let i = 0; i < qaPlacements.length; i++) {
        const current = qaPlacements[i];
        if (!current.actualBounds) continue;

        for (let j = i + 1; j < qaPlacements.length; j++) {
            const next = qaPlacements[j];
            if (!next.actualBounds) continue;
            if (intersects(expandRect(current.actualBounds, minSpacingPx / 2), expandRect(next.actualBounds, minSpacingPx / 2))) {
                pushUnique(blockers, `SKU 图层 "${current.name}" 与 "${next.name}" 执行后互相重叠或间距不足。`);
            }
        }
    }

    const obstacles = (input.obstacles || [])
        .map((obstacle) => ({
            ...obstacle,
            bounds: normalizeRect(obstacle.bounds)
        }))
        .filter((obstacle) => obstacle.bounds.width > 0 && obstacle.bounds.height > 0);

    for (const placement of qaPlacements) {
        if (!placement.actualBounds) continue;
        for (const obstacle of obstacles) {
            if (intersects(placement.actualBounds, expandRect(obstacle.bounds, clearancePx))) {
                pushUnique(
                    blockers,
                    `SKU 图层 "${placement.name}" 执行后遮挡模板元素 "${obstacle.id || obstacle.role || 'unknown'}"。`
                );
            }
        }
    }

    if (qaPlacements.length !== planPlacements.length) {
        pushUnique(blockers, '执行后校验失败：QA placement 数量与计划 placement 数量不一致。');
    }

    return {
        schema: 'sku-auto-layout-qa/v0',
        status: blockers.length > 0 ? 'blocked' : warnings.length > 0 ? 'needs_review' : 'ready',
        actualPlacements: qaPlacements,
        warnings,
        blockers,
        boundaries: {
            usesActualBounds: true,
            writesPhotoshop: false,
            claimsDesignQuality: false
        }
    };
}
