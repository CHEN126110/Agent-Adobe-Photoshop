/**
 * 多模块版面布局引擎（纯函数，无 API、无 Photoshop 依赖）
 *
 * 解决"手"的核心缺口：把声明式版式规格（每个模块的角色/占比/对齐）求解成精确坐标，
 * 替代"模型逐个手填坐标"——后者靠空间想象，必然重叠/溢出/不对齐。
 *
 * 设计原则：
 * - 声明式：调用方（模型）只描述"放什么、各占多少、怎么对齐"，不算坐标。
 * - 确定性：同样的规格永远得到同样的、对齐网格、不溢出画布的布局。
 * - 垂直分区为主：电商主图/详情页屏的主体结构是自上而下的区块堆叠（标题→主图→卖点）。
 *
 * 这是 A 路线"手"的地基；smart-layout-service 负责单个主体图的精确缩放定位，二者互补。
 *
 * ── 间距刻度（design token）──
 * 边距与间距不再是本模块的硬编码百分比，而是由 [design-grid-dsl] 的结构参数求解出的
 * 栅格刻度决定：liveArea 定边距、spacingScale 定间距档位。调用方（模型）只能选**档位下标**，
 * 不能给任意像素——这是把"审美决策离散化"的执行点，理由同 Web 端 spacing token：
 * 选错一档的代价远小于随手写一个任意数值。因此本模块刻意不提供 margin/gap 像素入口。
 *
 * 栅格入参是结构参数（几列、哪一档边距），不是业务品类。版面结构由内容决定，
 * 不由物料身份决定——详见 design-grid-dsl 的模块说明。
 */

import {
    createDesignGrid,
    inferNearestGridColumnSpan,
    getGridColumnBox,
    DEFAULT_GAP_SCALE_INDEX,
    SPACING_SCALE_STEPS,
    type DesignGridSpec
} from '../design-grid-dsl';

export type BlockRole =
    | 'background'
    | 'main-image'
    | 'title'
    | 'subtitle'
    | 'selling-point'
    | 'tag'
    | 'decoration';

export type HAlign = 'left' | 'center' | 'right';

/**
 * 图片在声明式区域中的视觉落位语义。
 *
 * 这不是 Photoshop Tool 参数的复制，而是 Planner → Render Bridge → Layout → Executor
 * 的单一 Harness 契约。模型声明设计意图，执行层负责把它翻译为确定性的缩放、裁切和读回。
 */
export interface ImagePlacementSpec {
    fit: 'contain' | 'cover';
    anchor: string;
    scale: number;
    rotation: number;
    focalPoint?: { x: number; y: number };
    mask: 'none' | 'clipping' | 'shape';
    overflow: 'clip' | 'visible';
    /** 主体感知修订时的目标占比；不填时由 Evaluation/Profile 或通用保守值决定。 */
    subjectFillRatio?: number;
    /** 只有明确的留白构图意图才能放宽严重欠填检查，默认 false。 */
    allowUnderfill?: boolean;
}

export interface LayoutBlock {
    id: string;
    role: BlockRole;
    /** 文案内容或素材标识（引擎不关心其含义，原样透传给渲染层） */
    content?: string;
    /** 占可用高度的比例(0-1)。背景固定满画布；不填时按 role 给默认值 */
    heightRatio?: number;
    /** 占可用宽度的比例(0-1)，默认 1（占满安全区宽度） */
    widthRatio?: number;
    /** 水平对齐，默认 center */
    hAlign?: HAlign;
    /** 图片角色的落位语义；非图片角色会原样保留但不执行。 */
    imagePlacement?: ImagePlacementSpec;
    // 刻意不暴露图层层级(z)。图层前后顺序是确定性的设计规则(背景在底、文字压在图上、
    // 装饰最顶)，由 role 直接决定，不交给模型——从根上杜绝"图层顺序写错"，
    // 而不是"让模型写、引擎再纠正"。模型只描述放什么、占多少，不碰顺序。
}

/** 版面的结构参数：只描述"分几列、版心多松、列间多宽"，不含业务品类。 */
export interface LayoutGridOptions {
    /** 并列单元数；省略表示本版面无并列结构，不做列对齐。 */
    columns?: number;
    /** 版心边距档位下标（spacingScale 索引），不是像素。 */
    marginScale?: number;
    /** 列间距档位下标（spacingScale 索引），不是像素。 */
    gutterScale?: number;
}

export interface LayoutSpec extends LayoutGridOptions {
    canvas: { width: number; height: number };
    /** 相邻模块垂直间距的**档位下标**（spacingScale 索引），不是像素。省略走默认档。 */
    gapScale?: number;
    /** 按视觉从上到下的顺序排列（background 可放任意位置，会被单独满铺） */
    blocks: LayoutBlock[];
}

export interface ResolvedBlock {
    id: string;
    role: BlockRole;
    content?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    z: number;
    imagePlacement?: ImagePlacementSpec;
}

export interface LayoutResult {
    blocks: ResolvedBlock[];
    warnings: string[];
    /** 本次实际生效的栅格与刻度，回传给调用方用于复核与排错（不影响执行）。 */
    grid?: {
        liveArea: { x: number; y: number; width: number; height: number };
        columns: number;
        /** 未声明 columns 时为 false：本次没有做列对齐。 */
        columnAlignmentActive: boolean;
        spacingScale: number[];
        gapScaleIndex: number;
        gapPx: number;
    };
}

const DEFAULT_HEIGHT_RATIO: Record<BlockRole, number> = {
    background: 1,
    'main-image': 0.55,
    title: 0.12,
    subtitle: 0.08,
    'selling-point': 0.1,
    tag: 0.06,
    decoration: 0.06
};

// 图层前后顺序 = 确定性的设计规则，由 role 直接决定，模型不参与：
// 背景垫底 → 主图 → 文字(压在图上) → 标签/装饰(最顶)。
const ROLE_Z: Record<BlockRole, number> = {
    background: 0,
    'main-image': 10,
    subtitle: 18,
    title: 20,
    'selling-point': 22,
    tag: 28,
    decoration: 30
};

function clamp01(v: number): number {
    if (!Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(1, v));
}

/** 把间距档位下标解析成像素；越界或非整数一律回落默认档并说明原因。 */
function resolveGapPx(grid: DesignGridSpec, gapScale: number | undefined, warnings: string[]): { gapPx: number; index: number } {
    const scale = grid.spacingScale;
    const fallbackIndex = Math.min(DEFAULT_GAP_SCALE_INDEX, scale.length - 1);
    if (gapScale === undefined || gapScale === null) {
        return { gapPx: Math.round(scale[fallbackIndex]), index: fallbackIndex };
    }
    if (!Number.isInteger(gapScale) || gapScale < 0 || gapScale >= SPACING_SCALE_STEPS) {
        warnings.push(
            `间距档位 gapScale=${String(gapScale)} 不是 0..${SPACING_SCALE_STEPS - 1} 的整数档位，已回落默认档 ${fallbackIndex}` +
            `（本画布可选档位：${scale.map((v) => Math.round(v)).join(' / ')} px）。间距只能选档位，不能给任意像素。`
        );
        return { gapPx: Math.round(scale[fallbackIndex]), index: fallbackIndex };
    }
    return { gapPx: Math.round(scale[gapScale]), index: gapScale };
}

/**
 * 解析本次版面生效的栅格：结构参数 → liveArea / 列盒 / 间距刻度。
 * 这是边距与间距的**唯一来源**，调用方无法绕过给像素。
 * 非法结构参数回落到安全默认值并告警，不升级成失败——这类问题模型下一轮可自愈。
 */
function resolveLayoutGrid(
    canvas: { width: number; height: number },
    options: LayoutGridOptions,
    warnings: string[]
): { grid: DesignGridSpec; columnAlignmentActive: boolean } {
    const columnAlignmentActive = Number.isInteger(options.columns) && (options.columns as number) > 0;
    if (options.columns !== undefined && options.columns !== null && !columnAlignmentActive) {
        warnings.push(
            `columns=${String(options.columns)} 不是正整数，已按「无并列结构」处理，本次不做列对齐。` +
            `并列单元数应来自内容结构，例如三个并排卖点写 3、左图右文写 2。`
        );
    }
    return {
        grid: createDesignGrid({
            canvas,
            columns: columnAlignmentActive ? options.columns : undefined,
            marginScale: options.marginScale,
            gutterScale: options.gutterScale
        }),
        columnAlignmentActive
    };
}

/**
 * 求解版面布局：背景满画布；其余模块在安全区内自上而下按高度比例垂直堆叠、按对齐方式水平摆放。
 * 保证：所有模块不超出画布；垂直方向按 gap 间隔不重叠；比例之和超界时整体压缩并给出 warning。
 */
export function solveLayout(spec: LayoutSpec): LayoutResult {
    const warnings: string[] = [];
    const { width: cw, height: ch } = spec.canvas;
    if (!(cw > 0 && ch > 0)) {
        return { blocks: [], warnings: ['画布尺寸无效'] };
    }

    // 边距与间距全部来自栅格刻度：liveArea 定版心，spacingScale 定间距档位。
    const { grid, columnAlignmentActive } = resolveLayoutGrid({ width: cw, height: ch }, spec, warnings);
    const { gapPx: gap, index: gapScaleIndex } = resolveGapPx(grid, spec.gapScale, warnings);

    const innerX = Math.round(grid.liveArea.x);
    const innerW = Math.max(0, Math.round(grid.liveArea.width));
    const innerY = Math.round(grid.liveArea.y);
    const innerH = Math.max(0, Math.round(grid.liveArea.height));

    const blocks = Array.isArray(spec.blocks) ? spec.blocks : [];
    const backgrounds = blocks.filter((b) => b.role === 'background');
    const flow = blocks.filter((b) => b.role !== 'background');

    const resolved: ResolvedBlock[] = [];

    // 背景：满画布，z 垫底
    for (const bg of backgrounds) {
        resolved.push({
            id: bg.id, role: bg.role, content: bg.content,
            x: 0, y: 0, width: cw, height: ch,
            z: ROLE_Z.background,
            imagePlacement: bg.imagePlacement
        });
    }

    // 流式模块：垂直堆叠
    const n = flow.length;
    if (n > 0) {
        const totalGap = gap * (n - 1);
        const availH = Math.max(0, innerH - totalGap);

        // 取各模块高度比例（缺省按 role），归一化到可用高度
        const ratios = flow.map((b) => clamp01(b.heightRatio ?? DEFAULT_HEIGHT_RATIO[b.role] ?? 0.1));
        const ratioSum = ratios.reduce((s, r) => s + r, 0) || 1;
        let scale = 1;
        if (ratioSum > 1) {
            scale = 1 / ratioSum;
            warnings.push(`模块高度比例之和 ${ratioSum.toFixed(2)} 超过 1，已整体压缩以适配画布。`);
        }

        let cursorY = innerY;
        flow.forEach((b, i) => {
            const h = Math.round(availH * ratios[i] * scale);
            const wRatio = clamp01(b.widthRatio ?? 1);
            const w = Math.round(innerW * wRatio);
            const hAlign: HAlign = b.hAlign ?? 'center';
            let x = innerX;
            if (hAlign === 'center') x = innerX + Math.round((innerW - w) / 2);
            else if (hAlign === 'right') x = innerX + (innerW - w);

            resolved.push({
                id: b.id, role: b.role, content: b.content,
                x, y: cursorY, width: w, height: h,
                z: ROLE_Z[b.role],
                imagePlacement: b.imagePlacement
            });
            cursorY += h + gap;
        });

        const usedBottom = cursorY - gap;
        if (usedBottom > innerY + innerH + 1) {
            warnings.push('模块总高超出安全区，存在溢出风险（请减少模块或调小比例）。');
        }
    }

    // 最终边界检查：任何模块越出画布都记 warning（理论上不应发生，作为安全网）
    for (const r of resolved) {
        if (r.x < 0 || r.y < 0 || r.x + r.width > cw + 1 || r.y + r.height > ch + 1) {
            warnings.push(`模块 ${r.id}(${r.role}) 越出画布边界。`);
        }
    }

    resolved.sort((a, b) => a.z - b.z);
    return {
        blocks: resolved,
        warnings,
        grid: {
            liveArea: { x: innerX, y: innerY, width: innerW, height: innerH },
            columns: grid.columns.count,
            columnAlignmentActive,
            spacingScale: grid.spacingScale.map((v) => Math.round(v)),
            gapScaleIndex,
            gapPx: gap
        }
    };
}

// ── 二维区域模式（渲染桥）──
// solveLayout 只会垂直堆叠，做不了左右分栏/图文叠压/杂志式构图；v5 契约（LayoutRegion）
// 用归一化 0..1 区域描述版面。本模式接受同一套渲染角色 + 归一化 bounds，换算像素并保持
// 两条不变量：坐标由引擎换算（调用方不给像素）、图层顺序由 role 决定（调用方不排 z）。

export interface NormalizedRegionBlock {
    id: string;
    role: BlockRole;
    /** 同 LayoutBlock.content：文案或素材路径，引擎原样透传 */
    content?: string;
    /** 归一化边界 0..1（相对画布），x/y 为左上角 */
    bounds: { x: number; y: number; width: number; height: number };
    /** 图片角色的落位语义；由 v5 图片槽位与区域契约共同生成。 */
    imagePlacement?: ImagePlacementSpec;
}

export interface RegionLayoutSpec extends LayoutGridOptions {
    canvas: { width: number; height: number };
    regions: NormalizedRegionBlock[];
}

const TEXT_ROLES: ReadonlySet<BlockRole> = new Set(['title', 'subtitle', 'selling-point', 'tag']);
const MIN_REGION_PX = 24;

function rectsOverlap(a: ResolvedBlock, b: ResolvedBlock): boolean {
    return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * 对齐诊断阈值：把握度低于此值说明给的区域离任何列区间都明显偏远。
 * 它只影响 warning 文案，**不否决吸附**——判据说"必须对齐"就该真的对齐，
 * 否则栅格会退化成"碰巧接近才生效"，等于没有栅格。
 */
const COLUMN_ALIGNMENT_WARN_SCORE = 0.5;

/**
 * 判断某个角色的区域是否必须吸附到列栅格。
 * 只在调用方声明了 columns（版面确实有并列结构）时才会被问到。
 *
 * 返回 true  → 左右边界无条件吸附到最近的列区间，这些元素因此共享同一批对齐基准线。
 * 返回 false → 保留调用方给的归一化位置，仅在明显偏离列时记 warning，不改坐标。
 *
 * 这是"对齐纪律"与"构图自由"的分界线：判据只依据角色在画面中的职责，
 * 不依据业务品类——栅格已经不含品类信息，可用的只有 role 与结构化的 grid。
 */
function shouldSnapRegionToColumns(role: BlockRole, grid: DesignGridSpec): boolean {
    // 文字类角色强制对齐：标题、副标、卖点、标签共享同一批基准线，
    // 这是消除"假居中/无关键线"（design-principles 列举的反模式）最直接的手段，
    // 而吸附对文字块的代价只是宽度变成列宽整数倍，不损伤内容。
    //
    // 主视觉与装饰不吸附：出血、非对称构图、自由摆放的装饰都是正当版式，
    // 且吸附只改 x/width 不改 height，会连带改变图片区域的宽高比意图。
    //
    // 复用 TEXT_ROLES 而非另建集合：目前"文字角色"与"需共享基准线的角色"完全重合，
    // 重复定义只会让两处将来悄悄分叉。若日后装饰也需入栅，再拆成独立集合。
    return TEXT_ROLES.has(role);
}

/**
 * 把已换算成像素的区域吸附到最近的列区间，只动水平方向（x / width），保留垂直位置。
 * 判据说必须对齐就无条件吸附：共享同一批基准线的收益，大于几十像素位移的损失。
 */
function snapRegionToColumns(
    box: { x: number; y: number; width: number; height: number },
    grid: DesignGridSpec,
    regionId: string,
    role: BlockRole,
    warnings: string[]
): { x: number; width: number } {
    const nearest = inferNearestGridColumnSpan(grid, box);

    if (!shouldSnapRegionToColumns(role, grid)) {
        if (nearest.score < COLUMN_ALIGNMENT_WARN_SCORE) {
            warnings.push(
                `区域 ${regionId}(${role}) 未贴合 ${grid.columns.count} 列栅格（最接近列区间把握度 ${nearest.score.toFixed(2)}）；` +
                `该角色按判据允许破格，坐标保持不变。`
            );
        }
        return { x: box.x, width: box.width };
    }

    const columnBox = getGridColumnBox(grid, nearest.columnStart, nearest.columnSpan);
    const snappedX = Math.round(columnBox.x);
    const snappedWidth = Math.round(columnBox.width);

    if (nearest.score < COLUMN_ALIGNMENT_WARN_SCORE) {
        warnings.push(
            `区域 ${regionId}(${role}) 原始位置离 ${grid.columns.count} 列栅格较远（把握度 ${nearest.score.toFixed(2)}），` +
            `已吸附到第 ${nearest.columnStart}~${nearest.columnStart + nearest.columnSpan - 1} 列：` +
            `x ${box.x}→${snappedX}px、宽 ${box.width}→${snappedWidth}px。` +
            `若这是有意的破格构图，应改用允许破格的角色，而不是给一个偏离栅格的 bounds。`
        );
    }
    return { x: snappedX, width: snappedWidth };
}

/**
 * 求解二维区域布局：背景满画布；其余区域按归一化 bounds 换算像素并夹回画布内。
 * 图文叠压是二维模式的正当用法，不告警；文字区域彼此重叠几乎必是错误，逐对告警。
 */
export function solveRegionLayout(spec: RegionLayoutSpec): LayoutResult {
    const warnings: string[] = [];
    const { width: cw, height: ch } = spec.canvas;
    if (!(cw > 0 && ch > 0)) {
        return { blocks: [], warnings: ['画布尺寸无效'] };
    }

    const regions = Array.isArray(spec.regions) ? spec.regions : [];
    const resolved: ResolvedBlock[] = [];
    // 二维模式同样受栅格约束：坐标仍由模型的归一化 bounds 表达构图意图，
    // 但需要共享对齐基准的角色会被吸附到列区间，避免"看起来差不多"的假对齐。
    const { grid, columnAlignmentActive } = resolveLayoutGrid({ width: cw, height: ch }, spec, warnings);
    if (!columnAlignmentActive) {
        warnings.push(
            '未声明 columns，本次二维构图不做列对齐：各区域按给定的归一化 bounds 落位。' +
            '若版面存在并列结构（分栏、并排卖点），声明列数可让同组元素共享对齐基准线。'
        );
    }

    for (const region of regions) {
        if (region.role === 'background') {
            resolved.push({
                id: region.id, role: region.role, content: region.content,
                x: 0, y: 0, width: cw, height: ch,
                z: ROLE_Z.background,
                imagePlacement: region.imagePlacement
            });
            continue;
        }
        const raw = region.bounds || { x: 0, y: 0, width: 0, height: 0 };
        const nx = clamp01(raw.x);
        const ny = clamp01(raw.y);
        const nw = clamp01(raw.width);
        const nh = clamp01(raw.height);
        let clamped = nx !== raw.x || ny !== raw.y || nw !== raw.width || nh !== raw.height;
        let fitW = nw;
        let fitH = nh;
        if (nx + nw > 1) { fitW = 1 - nx; clamped = true; }
        if (ny + nh > 1) { fitH = 1 - ny; clamped = true; }
        if (clamped) {
            warnings.push(`区域 ${region.id}(${region.role}) 的归一化 bounds 超出 0..1 范围，已夹回画布内。`);
        }
        const width = Math.round(cw * fitW);
        const height = Math.round(ch * fitH);
        if (width < MIN_REGION_PX || height < MIN_REGION_PX) {
            warnings.push(`区域 ${region.id}(${region.role}) 换算后过小（${width}x${height}px），内容可能不可读。`);
        }
        const y = Math.round(ch * ny);
        const rawX = Math.round(cw * nx);
        const snapped = columnAlignmentActive
            ? snapRegionToColumns({ x: rawX, y, width, height }, grid, region.id, region.role, warnings)
            : { x: rawX, width };
        resolved.push({
            id: region.id, role: region.role, content: region.content,
            x: snapped.x, y, width: snapped.width, height,
            z: ROLE_Z[region.role],
            imagePlacement: region.imagePlacement
        });
    }

    // 文字区域两两重叠告警（图 x 文重叠是二维模式的正当用法，不告警）
    const textBlocks = resolved.filter((r) => TEXT_ROLES.has(r.role));
    for (let i = 0; i < textBlocks.length; i++) {
        for (let j = i + 1; j < textBlocks.length; j++) {
            if (rectsOverlap(textBlocks[i], textBlocks[j])) {
                warnings.push(`文字区域 ${textBlocks[i].id} 与 ${textBlocks[j].id} 重叠，文案会互相压盖。`);
            }
        }
    }

    resolved.sort((a, b) => a.z - b.z);
    return {
        blocks: resolved,
        warnings,
        grid: {
            liveArea: {
                x: Math.round(grid.liveArea.x),
                y: Math.round(grid.liveArea.y),
                width: Math.round(grid.liveArea.width),
                height: Math.round(grid.liveArea.height)
            },
            columns: grid.columns.count,
            columnAlignmentActive,
            spacingScale: grid.spacingScale.map((v) => Math.round(v)),
            // 二维模式不按档位排间距（区域自带 bounds），刻度仍回传供复核与后续 linter 使用。
            gapScaleIndex: -1,
            gapPx: 0
        }
    };
}
