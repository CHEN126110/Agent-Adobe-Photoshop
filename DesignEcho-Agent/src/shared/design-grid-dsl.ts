/**
 * 版面栅格 DSL（纯逻辑，无 API、无 Photoshop 依赖）
 *
 * 只描述版面的**结构参数**：分几列、版心多大、间距刻度有哪些档位。
 *
 * 刻意不包含任何业务品类（主图 / 详情页 / SKU / 合格证…）：
 * 版面结构由内容结构决定，不由物料身份决定。"这个版面有几个并列单元"是设计判断，
 * 应当由模型声明、或从项目真实设计文件测得，不能硬编码成一张品类查找表——
 * 那样既无法解释数字来源，也让新品类必须改代码才能表达。
 *
 * 分工：本模块负责把结构参数换算成精确的列盒与刻度（算术）；
 * 选几列、用哪一档间距属于设计判断，由调用方（模型）决定。
 */

export interface DesignGridCanvas {
    width: number;
    height: number;
}

export interface DesignGridRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface DesignGridColumns {
    count: number;
    gutter: number;
    marginLeft: number;
    marginRight: number;
    columnWidth: number;
}

export interface DesignGridRows {
    baseline: number;
    rowHeight?: number;
    marginTop: number;
    marginBottom: number;
}

export interface DesignGridSpec {
    version: 'design-grid-dsl.v2';
    canvas: DesignGridCanvas;
    liveArea: DesignGridRect;
    columns: DesignGridColumns;
    rows: DesignGridRows;
    /** 本画布下所有可用的间距档位（像素），边距/列间距/模块间距都从这里取档。 */
    spacingScale: number[];
}

/**
 * 通用间距刻度（相对画布短边的比例）。
 *
 * 几何级数，相邻档约 1.6 倍——差异足够大，选错一档在视觉上是可分辨的，
 * 不会出现"26px 还是 28px"这种无意义的纠结。这是通用排版模数，不含品类假设。
 * 用短边而非宽度作基准：长图与横幅的宽高差异极大，短边对极端画幅更稳健。
 */
const SPACING_SCALE_RATIOS = [0.008, 0.0125, 0.02, 0.03, 0.05, 0.08];

/** 可选间距档位数量（下标 0..SPACING_SCALE_STEPS-1）。 */
export const SPACING_SCALE_STEPS = SPACING_SCALE_RATIOS.length;

/** 版心边距默认档（短边 5%）——与本模块接线前各处通用的安全边距一致。 */
export const DEFAULT_MARGIN_SCALE_INDEX = 4;
/** 模块垂直间距默认档（短边 3%）。 */
export const DEFAULT_GAP_SCALE_INDEX = 3;
/** 列间距默认档（短边 2%）。 */
export const DEFAULT_GUTTER_SCALE_INDEX = 2;

export interface DesignGridInput {
    canvas: DesignGridCanvas;
    /**
     * 并列单元数（列数）。由内容结构决定，例如三个并排卖点 = 3、左图右文 = 2。
     * 省略表示"本版面没有并列结构"，此时不做列对齐，仅提供版心与间距刻度。
     */
    columns?: number;
    /** 版心边距档位下标，省略取 DEFAULT_MARGIN_SCALE_INDEX。 */
    marginScale?: number;
    /** 列间距档位下标，省略取 DEFAULT_GUTTER_SCALE_INDEX。 */
    gutterScale?: number;
}

function assertPositiveNumber(value: number, label: string): void {
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`${label} must be a positive number.`);
    }
}

function roundPx(value: number): number {
    return Math.round(value * 100) / 100;
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

/** 把档位下标夹回合法范围；非整数或越界一律回落到给定默认档。 */
function resolveScaleIndex(index: number | undefined, fallback: number): number {
    if (index === undefined || index === null) return fallback;
    if (!Number.isInteger(index) || index < 0 || index >= SPACING_SCALE_STEPS) return fallback;
    return index;
}

/**
 * 计算本画布下各间距档位的实际像素值。
 * 取整而非保留小数：间距最终要落到 Photoshop 的整数像素坐标上，
 * 留小数只会让版心宽度产生 1px 级的漂移。
 */
export function buildSpacingScale(canvas: DesignGridCanvas): number[] {
    const shortSide = Math.min(canvas.width, canvas.height);
    return SPACING_SCALE_RATIOS.map((ratio) => Math.max(1, Math.round(shortSide * ratio)));
}

/**
 * 由结构参数求解栅格：版心 = 画布减去四边等距边距；列宽 = 版心宽度按列数与列间距均分。
 * 同一套 spacingScale 同时供边距、列间距与模块间距取档——单一刻度系统是版面成体系的前提。
 */
export function createDesignGrid(input: DesignGridInput): DesignGridSpec {
    const { canvas } = input;
    assertPositiveNumber(canvas.width, 'canvas.width');
    assertPositiveNumber(canvas.height, 'canvas.height');

    const spacingScale = buildSpacingScale(canvas);
    const margin = spacingScale[resolveScaleIndex(input.marginScale, DEFAULT_MARGIN_SCALE_INDEX)];
    const gutter = spacingScale[resolveScaleIndex(input.gutterScale, DEFAULT_GUTTER_SCALE_INDEX)];

    // 版心不做"是否为空"的防御：最大边距档是短边 8%，双边合计 16%，
    // 在任何画布上都吃不光版心——写一个不可达的分支只会制造它被验证过的错觉。
    const liveWidth = canvas.width - margin * 2;
    const liveHeight = canvas.height - margin * 2;

    // 列数缺省或非法时按 1 列处理（= 整个版心），此时列吸附等价于对齐版心边缘。
    const count = Number.isInteger(input.columns) && (input.columns as number) > 0
        ? Math.min(input.columns as number, 24)
        : 1;
    const columnWidth = roundPx((liveWidth - gutter * (count - 1)) / count);
    if (columnWidth <= 0) {
        throw new Error(
            `列宽为负：版心宽 ${liveWidth}px 放不下 ${count} 列 + ${count - 1} 个 ${gutter}px 列间距，请减少列数或调小 gutterScale。`
        );
    }

    return {
        version: 'design-grid-dsl.v2',
        canvas: { width: canvas.width, height: canvas.height },
        liveArea: { x: margin, y: margin, width: liveWidth, height: liveHeight },
        columns: { count, gutter, marginLeft: margin, marginRight: margin, columnWidth },
        rows: { baseline: spacingScale[1], marginTop: margin, marginBottom: margin },
        spacingScale
    };
}

export function getGridColumnBox(spec: DesignGridSpec, columnStart: number, columnSpan = 1): DesignGridRect {
    if (!Number.isInteger(columnStart) || columnStart < 1 || columnStart > spec.columns.count) {
        throw new Error('columnStart must be a 1-based column index inside the grid.');
    }
    if (!Number.isInteger(columnSpan) || columnSpan < 1 || columnStart + columnSpan - 1 > spec.columns.count) {
        throw new Error('columnSpan must fit inside the grid.');
    }
    const x = spec.liveArea.x + (columnStart - 1) * (spec.columns.columnWidth + spec.columns.gutter);
    const width = columnSpan * spec.columns.columnWidth + (columnSpan - 1) * spec.columns.gutter;
    return {
        x: roundPx(x),
        y: spec.liveArea.y,
        width: roundPx(width),
        height: spec.liveArea.height
    };
}

export function inferNearestGridColumnSpan(
    spec: DesignGridSpec,
    box: DesignGridRect
): { columnStart: number; columnSpan: number; score: number } {
    // 按几何偏差选最近列区间，而不是按 score 选：score 经 clamp01 归一化后，
    // 所有候选都超出容差时会一律为 0，用 score 比较会退化成"永远返回第 1 列"，
    // 把右侧元素吸到画布最左边。偏差最小者才是真正的最近列；score 只作贴合度输出。
    const tolerance = Math.max(spec.columns.gutter, spec.rows.baseline * 2, 1);
    let best = { columnStart: 1, columnSpan: 1, score: 0, delta: Number.POSITIVE_INFINITY };
    for (let start = 1; start <= spec.columns.count; start += 1) {
        for (let span = 1; span <= spec.columns.count - start + 1; span += 1) {
            const candidate = getGridColumnBox(spec, start, span);
            const leftDelta = Math.abs(candidate.x - box.x);
            const rightDelta = Math.abs(candidate.x + candidate.width - (box.x + box.width));
            const maxDelta = Math.max(leftDelta, rightDelta);
            if (maxDelta < best.delta) {
                best = {
                    columnStart: start,
                    columnSpan: span,
                    score: roundPx(clamp01(1 - maxDelta / tolerance)),
                    delta: maxDelta
                };
            }
        }
    }
    return { columnStart: best.columnStart, columnSpan: best.columnSpan, score: best.score };
}
