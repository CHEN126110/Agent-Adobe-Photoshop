/**
 * 多模块版面布局引擎（纯函数，无 API、无 Photoshop 依赖）
 *
 * 解决"手"的核心缺口：把声明式版式规格（每个模块的角色/占比/对齐）求解成精确坐标，
 * 替代"模型逐个手填坐标"——后者靠空间想象，必然重叠/溢出/不对齐。
 *
 * 设计原则：
 * - 声明式：调用方（模型）只描述"放什么、各占多少、怎么对齐"，不算坐标。
 * - 确定性：同样的规格永远得到同样的、不溢出画布的布局；是否吸附网格与叠放顺序由调用方显式表达。
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
import type {
    SmartScalingAnchor,
    SmartScalingCropPolicy
} from '../design-smart-scaling-policy';

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
    /** Agent 明确选择的图框对齐；执行层只换算像素。 */
    anchor: SmartScalingAnchor;
    scale: number;
    rotation: number;
    /** 源图中的归一化关注点；存在时优先把它对准目标区域中心。 */
    focalPoint?: { x: number; y: number };
    /** cover 只描述图框铺满方式；是否允许裁主体必须独立声明。 */
    cropPolicy: SmartScalingCropPolicy;
    mask: 'none' | 'clipping' | 'shape';
    overflow: 'clip' | 'visible';
    /** Agent 显式选择的主体 contain 占比；缺失时任何层都不得补审美默认值。 */
    subjectFillRatio?: number;
    /** 只有明确的留白构图意图才能放宽严重欠填检查，默认 false。 */
    allowUnderfill?: boolean;
}

export interface LayoutBlock {
    id: string;
    role: BlockRole;
    /** 文案内容或素材标识（引擎不关心其含义，原样透传给渲染层） */
    content?: string;
    /** 占可用高度的比例(0-1)。model_authored 必填；仅 neutral_wireframe 可使用 role 中性默认。 */
    heightRatio?: number;
    /** 占可用宽度的比例(0-1)，默认 1（占满安全区宽度） */
    widthRatio?: number;
    /** 水平对齐，默认 center */
    hAlign?: HAlign;
    /** 图片角色的落位语义；非图片角色会原样保留但不执行。 */
    imagePlacement?: ImagePlacementSpec;
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
    /** 按视觉从上到下排列；同时作为非背景图层从下到上的叠放顺序。background 始终机械垫底。 */
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
    /** 文字在自身区域内的水平排版语义；blocks 正式模式必须由模型声明。 */
    hAlign?: HAlign;
    imagePlacement?: ImagePlacementSpec;
}

export interface ModelAuthoredLayoutValidation {
    valid: boolean;
    issues: string[];
}

export interface LayoutResult {
    blocks: ResolvedBlock[];
    warnings: string[];
    /** 本次实际生效的栅格与刻度，回传给调用方用于复核与排错（不影响执行）。 */
    grid?: {
        liveArea: { x: number; y: number; width: number; height: number };
        columns: number;
        /** 未声明 columns 时为 false；为 true 只表示列盒可用，不表示任一区域已自动吸附。 */
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

const TEXT_ROLES: ReadonlySet<BlockRole> = new Set(['title', 'subtitle', 'selling-point', 'tag']);
const MODEL_AUTHORED_STATIC_TEXT_ROLES: ReadonlySet<BlockRole> = new Set([
    'title', 'subtitle', 'selling-point'
]);
const RENDER_LAYOUT_IMAGE_ROLES: ReadonlySet<BlockRole> = new Set([
    'main-image', 'tag', 'decoration'
]);
const RENDER_LAYOUT_IMAGE_ASSET_PATTERN = /\.(?:png|jpe?g|webp|psd|psb)$/i;

/**
 * 判断声明式块是否会被执行层当作真实图片渲染。
 *
 * 该判定只依据通用 role + 明确素材路径，不读取品类或自然语言意图；validator、schema
 * 审计与 Photoshop executor 必须复用同一语义，避免一处把 tag 当文字、另一处又当图片。
 */
export function rendersLayoutBlockAsImage(candidate: unknown): boolean {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    const record = candidate as Record<string, unknown>;
    const role = String(record.role || '').trim() as BlockRole;
    const content = typeof record.content === 'string' ? record.content : '';
    return RENDER_LAYOUT_IMAGE_ROLES.has(role) && RENDER_LAYOUT_IMAGE_ASSET_PATTERN.test(content);
}

function requiresModelAuthoredTextAlignment(candidate: Record<string, unknown>): boolean {
    const role = String(candidate.role || '').trim() as BlockRole;
    if (MODEL_AUTHORED_STATIC_TEXT_ROLES.has(role)) return true;
    return (role === 'tag' || role === 'decoration') && !rendersLayoutBlockAsImage(candidate);
}

function validateModelAuthoredImagePlacement(
    candidate: Record<string, unknown>,
    path: string,
    issues: string[]
): void {
    if (!rendersLayoutBlockAsImage(candidate)) return;
    const placement = candidate.imagePlacement && typeof candidate.imagePlacement === 'object'
        && !Array.isArray(candidate.imagePlacement)
        ? candidate.imagePlacement as Record<string, unknown>
        : undefined;
    if (!placement) {
        issues.push(`${path}.imagePlacement:explicit_complete_placement_required`);
        return;
    }
    if (!['contain', 'cover'].includes(String(placement.fit || ''))) {
        issues.push(`${path}.imagePlacement.fit:explicit_contain_or_cover_required`);
    }
    const anchors: readonly SmartScalingAnchor[] = [
        'center',
        'top-center',
        'bottom-center',
        'left-center',
        'right-center'
    ];
    if (!anchors.includes(String(placement.anchor || '') as SmartScalingAnchor)) {
        issues.push(`${path}.imagePlacement.anchor:explicit_supported_anchor_required`);
    }
    if (placement.scale !== 1) {
        issues.push(`${path}.imagePlacement.scale:explicit_1_required`);
    }
    if (placement.rotation !== 0) {
        issues.push(`${path}.imagePlacement.rotation:explicit_0_required`);
    }
    const cropPolicies: readonly SmartScalingCropPolicy[] = [
        'avoid-crop',
        'protect-subject',
        'allow-crop'
    ];
    const cropPolicy = String(placement.cropPolicy || '') as SmartScalingCropPolicy;
    if (!cropPolicies.includes(cropPolicy)) {
        issues.push(`${path}.imagePlacement.cropPolicy:explicit_crop_intent_required`);
    }
    if (placement.fit === 'cover' && cropPolicy === 'avoid-crop') {
        issues.push(`${path}.imagePlacement:cover_conflicts_with_avoid_crop`);
    }
    if (placement.subjectFillRatio !== undefined) {
        const subjectFillRatio = placement.subjectFillRatio;
        if (typeof subjectFillRatio !== 'number'
            || !Number.isFinite(subjectFillRatio)
            || subjectFillRatio <= 0
            || subjectFillRatio > 1) {
            issues.push(`${path}.imagePlacement.subjectFillRatio:number_above_0_to_1_required`);
        }
        if (placement.fit === 'cover') {
            issues.push(`${path}.imagePlacement:cover_and_subject_fill_ratio_are_ambiguous`);
        }
    }
    if (placement.focalPoint !== undefined) {
        const focalPoint = placement.focalPoint && typeof placement.focalPoint === 'object'
            && !Array.isArray(placement.focalPoint)
            ? placement.focalPoint as Record<string, unknown>
            : undefined;
        const x = focalPoint?.x;
        const y = focalPoint?.y;
        if (!focalPoint
            || typeof x !== 'number'
            || typeof y !== 'number'
            || !Number.isFinite(x)
            || !Number.isFinite(y)
            || x < 0 || x > 1 || y < 0 || y > 1) {
            issues.push(`${path}.imagePlacement.focalPoint:normalized_x_y_required`);
        }
        if (placement.subjectFillRatio !== undefined) {
            issues.push(`${path}.imagePlacement:focal_point_and_subject_fill_ratio_conflict`);
        }
    }
    if (!['none', 'clipping'].includes(String(placement.mask || ''))) {
        issues.push(`${path}.imagePlacement.mask:explicit_none_or_clipping_required`);
    }
    if (!['clip', 'visible'].includes(String(placement.overflow || ''))) {
        issues.push(`${path}.imagePlacement.overflow:explicit_clip_or_visible_required`);
    }
}

function validateModelAuthoredBackground(
    candidate: Record<string, unknown>,
    path: string,
    issues: string[]
): void {
    if (String(candidate.role || '').trim() !== 'background') return;
    if (!/^#[0-9a-fA-F]{6}$/.test(String(candidate.content || ''))) {
        issues.push(`${path}.content:explicit_hex_background_required`);
    }
}

function validateModelAuthoredRegionBounds(
    candidate: Record<string, unknown>,
    path: string,
    issues: string[]
): void {
    if (String(candidate.role || '').trim() === 'background') return;
    const bounds = candidate.bounds && typeof candidate.bounds === 'object'
        && !Array.isArray(candidate.bounds)
        ? candidate.bounds as Record<string, unknown>
        : undefined;
    if (!bounds) {
        issues.push(`${path}.bounds:explicit_normalized_bounds_required`);
        return;
    }
    const x = bounds.x;
    const y = bounds.y;
    const width = bounds.width;
    const height = bounds.height;
    if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1) {
        issues.push(`${path}.bounds.x:number_0_1_required`);
    }
    if (typeof y !== 'number' || !Number.isFinite(y) || y < 0 || y > 1) {
        issues.push(`${path}.bounds.y:number_0_1_required`);
    }
    if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0 || width > 1) {
        issues.push(`${path}.bounds.width:number_above_0_to_1_required`);
    }
    if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0 || height > 1) {
        issues.push(`${path}.bounds.height:number_above_0_to_1_required`);
    }
    if (typeof x === 'number' && Number.isFinite(x)
        && typeof width === 'number' && Number.isFinite(width)
        && x + width > 1 + Number.EPSILON) {
        issues.push(`${path}.bounds:x_plus_width_must_not_exceed_1`);
    }
    if (typeof y === 'number' && Number.isFinite(y)
        && typeof height === 'number' && Number.isFinite(height)
        && y + height > 1 + Number.EPSILON) {
        issues.push(`${path}.bounds:y_plus_height_must_not_exceed_1`);
    }
}

function validateUniqueModelAuthoredIds(
    items: unknown[],
    path: 'regions' | 'blocks',
    issues: string[]
): void {
    const firstIndexById = new Map<string, number>();
    items.forEach((candidate, index) => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return;
        const id = String((candidate as Record<string, unknown>).id || '').replace(/\s+/g, ' ').trim();
        if (!id) return;
        const key = id.toLocaleLowerCase();
        const firstIndex = firstIndexById.get(key);
        if (firstIndex !== undefined) {
            issues.push(`${path}[${index}].id:duplicate_of_${path}[${firstIndex}]`);
            return;
        }
        firstIndexById.set(key, index);
    });
}

/**
 * 正式版式的模型主权边界。
 *
 * neutral_wireframe 可以使用本文件的中性默认值；正式视觉稿则必须把会改变构图的
 * 边距、间距、模块高宽比例和对齐全部显式声明。regions 虽已用 bounds 声明几何，
 * 文字对齐仍是构图决策；声明 columnPlacement 时，columns 与 margin/gutter 共同决定列盒，
 * 因此都必须显式。仅声明 columns 只提供网格事实，不得改写区域坐标。
 * 这里仅验证结构，不替模型补值。
 */
export function validateModelAuthoredLayout(input: {
    mode: 'blocks' | 'regions';
    marginScale?: unknown;
    gapScale?: unknown;
    gutterScale?: unknown;
    columns?: unknown;
    blocks?: unknown;
    regions?: unknown;
}): ModelAuthoredLayoutValidation {
    const issues: string[] = [];
    const validateScaleLevel = (value: unknown, path: string): void => {
        if (!Number.isInteger(value) || Number(value) < 0 || Number(value) >= SPACING_SCALE_STEPS) {
            issues.push(`${path}:explicit_integer_0_${SPACING_SCALE_STEPS - 1}_required`);
        }
    };

    if (input.mode === 'regions') {
        const regions = Array.isArray(input.regions) ? input.regions : [];
        if (regions.length === 0) issues.push('regions:non_empty_array_required');
        validateUniqueModelAuthoredIds(regions, 'regions', issues);
        let nonBackgroundRegionSeen = false;
        regions.forEach((candidate, index) => {
            const region = candidate && typeof candidate === 'object'
                ? candidate as Record<string, unknown>
                : {};
            const path = `regions[${index}]`;
            const role = String(region.role || '').trim();
            if (role === 'background' && nonBackgroundRegionSeen) {
                issues.push(`${path}.role:background_must_precede_visual_layers`);
            } else if (role !== 'background') {
                nonBackgroundRegionSeen = true;
            }
            if (requiresModelAuthoredTextAlignment(region)
                && !['left', 'center', 'right'].includes(String(region.hAlign || ''))) {
                issues.push(`${path}.hAlign:explicit_alignment_required`);
            }
            validateModelAuthoredBackground(region, path, issues);
            validateModelAuthoredRegionBounds(region, path, issues);
            validateModelAuthoredImagePlacement(region, path, issues);
            if (region.columnPlacement !== undefined && region.columnPlacement !== null) {
                const placement = region.columnPlacement && typeof region.columnPlacement === 'object'
                    && !Array.isArray(region.columnPlacement)
                    ? region.columnPlacement as Record<string, unknown>
                    : {};
                const start = placement.start;
                const span = placement.span;
                const columnCount = Number(input.columns);
                if (!Number.isInteger(start) || Number(start) < 1) {
                    issues.push(`${path}.columnPlacement.start:positive_integer_required`);
                }
                if (!Number.isInteger(span) || Number(span) < 1) {
                    issues.push(`${path}.columnPlacement.span:positive_integer_required`);
                }
                if (!Number.isInteger(input.columns)
                    || columnCount < 1
                    || columnCount > 24
                    || (Number.isInteger(start)
                        && Number.isInteger(span)
                        && Number(start) + Number(span) - 1 > columnCount)) {
                    issues.push(`${path}.columnPlacement:must_fit_declared_columns`);
                }
            }
        });
        if (input.columns !== undefined && input.columns !== null) {
            if (!Number.isInteger(input.columns) || Number(input.columns) < 1 || Number(input.columns) > 24) {
                issues.push('columns:explicit_integer_1_24_required');
            }
            validateScaleLevel(input.marginScale, 'marginScale');
            validateScaleLevel(input.gutterScale, 'gutterScale');
        }
        return { valid: issues.length === 0, issues };
    }

    validateScaleLevel(input.marginScale, 'marginScale');
    validateScaleLevel(input.gapScale, 'gapScale');

    const blocks = Array.isArray(input.blocks) ? input.blocks : [];
    if (blocks.length === 0) issues.push('blocks:non_empty_array_required');
    validateUniqueModelAuthoredIds(blocks, 'blocks', issues);
    let flowHeightRatioSum = 0;
    let nonBackgroundBlockSeen = false;
    blocks.forEach((candidate, index) => {
        const block = candidate && typeof candidate === 'object'
            ? candidate as Record<string, unknown>
            : {};
        const role = String(block.role || '').trim();
        const path = `blocks[${index}]`;
        if (role === 'background' && nonBackgroundBlockSeen) {
            issues.push(`${path}.role:background_must_precede_visual_layers`);
        } else if (role !== 'background') {
            nonBackgroundBlockSeen = true;
        }
        validateModelAuthoredBackground(block, path, issues);
        validateModelAuthoredImagePlacement(block, path, issues);
        if (role === 'background') return;
        const heightRatio = block.heightRatio;
        const widthRatio = block.widthRatio;
        if (typeof heightRatio !== 'number' || !Number.isFinite(heightRatio)
            || heightRatio <= 0 || heightRatio > 1) {
            issues.push(`${path}.heightRatio:explicit_number_0_1_required`);
        } else {
            flowHeightRatioSum += heightRatio;
        }
        if (typeof widthRatio !== 'number' || !Number.isFinite(widthRatio)
            || widthRatio <= 0 || widthRatio > 1) {
            issues.push(`${path}.widthRatio:explicit_number_0_1_required`);
        }
        if (requiresModelAuthoredTextAlignment(block)
            && !['left', 'center', 'right'].includes(String(block.hAlign || ''))) {
            issues.push(`${path}.hAlign:explicit_alignment_required`);
        }
    });
    if (flowHeightRatioSum > 1 + Number.EPSILON) {
        issues.push('blocks.heightRatio:sum_must_not_exceed_1');
    }
    return { valid: issues.length === 0, issues };
}

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
    backgrounds.forEach((bg, index) => {
        resolved.push({
            id: bg.id, role: bg.role, content: bg.content,
            x: 0, y: 0, width: cw, height: ch,
            z: index - backgrounds.length,
            hAlign: bg.hAlign,
            imagePlacement: bg.imagePlacement
        });
    });

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
                // 非背景图层按 Agent 给出的 blocks 顺序从下到上叠放，不再按 role 改写。
                z: i + 1,
                hAlign,
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
// 两条不变量：坐标由引擎换算（调用方不给像素）、非背景图层按 Agent 数组顺序叠放。

export interface NormalizedRegionBlock {
    id: string;
    role: BlockRole;
    /** 同 LayoutBlock.content：文案或素材路径，引擎原样透传 */
    content?: string;
    /** 归一化边界 0..1（相对画布），x/y 为左上角 */
    bounds: { x: number; y: number; width: number; height: number };
    /** 文字对齐；model_authored 的文字类 region 必须显式声明，neutral 可省略。 */
    hAlign?: HAlign;
    /**
     * 可选的显式列落位。只有 Agent 同时声明 columns 与本字段时，引擎才把 x/width
     * 换算为列盒；省略时 bounds 原样生效，不能由 role 自动吸附。
     */
    columnPlacement?: { start: number; span: number };
    /** 内部桥接用的原数组序号；composeDesign 抽出已置入主体后仍靠它保持原始层序。 */
    stackOrder?: number;
    /** 图片角色的落位语义；由 v5 图片槽位与区域契约共同生成。 */
    imagePlacement?: ImagePlacementSpec;
}

export interface RegionLayoutSpec extends LayoutGridOptions {
    canvas: { width: number; height: number };
    regions: NormalizedRegionBlock[];
}

const MIN_REGION_PX = 24;

function rectsOverlap(a: ResolvedBlock, b: ResolvedBlock): boolean {
    return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** 对齐诊断阈值只产生 warning，不授权 Harness 改坐标。 */
const COLUMN_ALIGNMENT_WARN_SCORE = 0.5;

/**
 * 列网格是 Agent 可选择的几何能力，不是按 role 自动生效的设计规则。
 * - 没有 columnPlacement：保留 bounds，只报告明显偏离。
 * - 明确给出 start/span：确定性换算为列盒。
 * 非法声明在正式 model_authored 路径会先被 validator 拒绝；本函数仍安全保留原坐标。
 */
function resolveRegionColumnPlacement(
    box: { x: number; y: number; width: number; height: number },
    grid: DesignGridSpec,
    region: NormalizedRegionBlock,
    warnings: string[]
): { x: number; width: number } {
    const placement = region.columnPlacement;
    if (!placement) {
        const nearest = inferNearestGridColumnSpan(grid, box);
        if (nearest.score < COLUMN_ALIGNMENT_WARN_SCORE) {
            warnings.push(
                `区域 ${region.id}(${region.role}) 未贴合 ${grid.columns.count} 列栅格（最接近列区间把握度 ${nearest.score.toFixed(2)}）；` +
                '未声明 columnPlacement，因此按 Agent 给出的 bounds 保持不变。'
            );
        }
        return { x: box.x, width: box.width };
    }

    const start = Number(placement.start);
    const span = Number(placement.span);
    if (!Number.isInteger(start)
        || !Number.isInteger(span)
        || start < 1
        || span < 1
        || start + span - 1 > grid.columns.count) {
        warnings.push(
            `区域 ${region.id}(${region.role}) 的 columnPlacement=${String(placement.start)}/${String(placement.span)} ` +
            `超出 ${grid.columns.count} 列范围，已保留原始 bounds。`
        );
        return { x: box.x, width: box.width };
    }

    const columnBox = getGridColumnBox(grid, start, span);
    return { x: Math.round(columnBox.x), width: Math.round(columnBox.width) };
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
    // 二维模式可声明栅格作为几何能力；只有 region 显式给出 columnPlacement 才换算列盒。
    const { grid, columnAlignmentActive } = resolveLayoutGrid({ width: cw, height: ch }, spec, warnings);
    if (!columnAlignmentActive) {
        warnings.push(
            '未声明 columns，本次二维构图不提供列落位能力：各区域按给定的归一化 bounds 落位。'
        );
    }

    for (let regionIndex = 0; regionIndex < regions.length; regionIndex += 1) {
        const region = regions[regionIndex];
        if (region.role === 'background') {
            resolved.push({
                id: region.id, role: region.role, content: region.content,
                x: 0, y: 0, width: cw, height: ch,
                z: regionIndex - regions.length,
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
        const horizontalPlacement = columnAlignmentActive
            ? resolveRegionColumnPlacement({ x: rawX, y, width, height }, grid, region, warnings)
            : { x: rawX, width };
        resolved.push({
            id: region.id, role: region.role, content: region.content,
            x: horizontalPlacement.x, y, width: horizontalPlacement.width, height,
            // 非背景图层按 Agent regions 数组顺序从下到上；role 不再替模型决定前后关系。
            z: Number.isFinite(Number(region.stackOrder))
                ? Number(region.stackOrder) + 1
                : regionIndex + 1,
            hAlign: region.hAlign,
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
