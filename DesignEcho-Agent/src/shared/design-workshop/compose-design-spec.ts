/**
 * composeDesign 的模型作者契约（纯逻辑，无 IO、无品类预设）。
 *
 * Agent 决定构图、主体处理、视觉样式与文案；Harness 只校验声明、换算几何、
 * 执行 Photoshop 并回读事实。这里不得按任务类型补版式、占比、锚点、颜色或字体。
 */

import {
    rendersLayoutBlockAsImage,
    validateModelAuthoredLayout,
    type ImagePlacementSpec
} from '../layout/layout-engine';
import type { RenderLayoutModelAuthoredVisualStyle } from '../layout/render-layout-style';

export type ComposeDesignBackgroundKind = 'none' | 'solid' | 'gradient' | 'asset' | 'generated';
export type ComposeDesignLayoutMode = 'agent_authored';

export type ComposeDesignShadowSpec =
    | { kind: 'none' }
    | {
        kind: 'drop-shadow';
        colorHex: string;
        opacity: number;
        angle: number;
        distance: number;
        size: number;
        spread: number;
    };

export interface ComposeDesignPalette {
    backgroundHex: string;
    textHex: string;
    secondaryTextHex?: string;
    accentHex?: string;
    sellingPointFillHex?: string;
    sellingPointTextHex?: string;
}

export interface ComposeDesignBackgroundInput {
    kind: ComposeDesignBackgroundKind;
    colorHex?: string;
    gradient?: { fromHex: string; toHex: string; angle: number };
    filePath?: string;
    prompt?: string;
    referenceFilePath?: string;
    imagePlacement?: ImagePlacementSpec;
}

export interface ComposeDesignLayoutRegion {
    id?: string;
    role: string;
    content: string;
    bounds: { x: number; y: number; width: number; height: number };
    hAlign?: 'left' | 'center' | 'right';
    columnPlacement?: { start: number; span: number };
    fit?: 'contain' | 'cover';
    imagePlacement?: ImagePlacementSpec;
}

export interface ComposeDesignLayoutInput {
    mode?: ComposeDesignLayoutMode;
    regions?: ComposeDesignLayoutRegion[];
    groupName?: string;
    visualStyle?: RenderLayoutModelAuthoredVisualStyle;
    columns?: number;
    marginScale?: number;
    gutterScale?: number;
    headline?: string | string[];
    subline?: string;
    proofItems?: string[];
    dataBar?: string;
    labelPill?: string;
    fontName?: string;
    recipeId?: never;
}

export interface ComposeDesignRationaleInput {
    angle?: string;
    purpose?: string;
    claim?: string;
    materials?: string;
    structure?: string;
    scale?: string;
    visual?: string;
    copySource?: string;
}

export interface ComposeDesignSpecInput {
    rationale?: string | ComposeDesignRationaleInput;
    productFacts?: string[];
    canvas: { width: number; height: number; resolution?: number; colorMode?: 'RGB' | 'CMYK' | 'Grayscale' };
    document?: { mode?: 'new' | 'active'; name?: string };
    background?: ComposeDesignBackgroundInput;
    subject?: {
        filePath?: string;
        existingLayerId?: number;
        fillRatio?: number;
        shadow?: ComposeDesignShadowSpec;
        treatment?: 'photo' | 'cutout';
        cutout?: boolean;
    };
    layout: ComposeDesignLayoutInput;
    palette: ComposeDesignPalette;
}

export interface ComposeDesignSpec {
    rationale: ComposeDesignRationaleInput & { text: string };
    productFacts: string[];
    canvas: { width: number; height: number; resolution?: number; colorMode?: 'RGB' | 'CMYK' | 'Grayscale' };
    document: { mode: 'new' | 'active'; name: string };
    background: ComposeDesignBackgroundInput;
    subject?: {
        filePath?: string;
        existingLayerId?: number;
        fillRatio?: number;
        shadow: ComposeDesignShadowSpec;
        treatment: 'photo' | 'cutout';
        cutout: boolean;
    };
    layout: ComposeDesignLayoutInput & {
        mode: 'agent_authored';
        regions: ComposeDesignLayoutRegion[];
        groupName: string;
        visualStyle: RenderLayoutModelAuthoredVisualStyle;
    };
    palette: ComposeDesignPalette;
}

export interface ComposeDesignSpecNormalization {
    ok: boolean;
    issues: string[];
    notes: string[];
    spec?: ComposeDesignSpec;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const BACKGROUND_KINDS: ComposeDesignBackgroundKind[] = ['none', 'solid', 'gradient', 'asset', 'generated'];
const RATIONALE_KEYS = ['angle', 'purpose', 'claim', 'materials', 'structure', 'scale', 'visual', 'copySource'] as const;
const RATIONALE_LABELS: Record<keyof ComposeDesignRationaleInput, string> = {
    angle: '角度', purpose: '目的', claim: '主张', materials: '选图',
    structure: '结构', scale: '尺度', visual: '视觉', copySource: '文案来源'
};
const IMPLEMENTATION_REGION_ID = /^(?:headline|title|subtitle|tag|decoration|main[-_ ]?image|subject|scene[-_ ]?line|color[-_ ]?note|selling[-_ ]?point)(?:[-_ ]?\d+)?$/i;

export function isComposeDesignSubjectAliasRegion(region: unknown): boolean {
    if (!region || typeof region !== 'object' || Array.isArray(region)) return false;
    const record = region as Record<string, unknown>;
    return String(record.role || '').trim() === 'main-image'
        && /^subject$/i.test(String(record.content || '').trim());
}

function isImplementationRegionId(value: unknown): boolean {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    return !normalized || IMPLEMENTATION_REGION_ID.test(normalized);
}

function isHex(value: unknown): value is string {
    return HEX.test(String(value || ''));
}

export function normalizeHexColor(value: unknown): string | undefined {
    const raw = String(value ?? '').trim();
    if (!raw) return undefined;
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toUpperCase();
    if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
        return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`.toUpperCase();
    }
    if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw}`.toUpperCase();
    if (/^[0-9a-fA-F]{3}$/.test(raw)) {
        return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`.toUpperCase();
    }
    return undefined;
}

/** 只做格式归一，不补配色、不从底色推导字色。 */
export function normalizePaletteInput(raw: unknown): Record<string, string | undefined> {
    const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const out: Record<string, string | undefined> = {};
    for (const key of ['backgroundHex', 'textHex', 'secondaryTextHex', 'accentHex', 'sellingPointFillHex', 'sellingPointTextHex']) {
        const normalized = normalizeHexColor(source[key]);
        if (normalized) out[key] = normalized;
    }
    return out;
}

function normalizeRationale(raw: unknown): ComposeDesignRationaleInput & { text: string } {
    const rationale: ComposeDesignRationaleInput & { text: string } = { text: '' };
    if (typeof raw === 'string') {
        rationale.claim = raw.trim();
    } else if (raw && typeof raw === 'object') {
        for (const key of RATIONALE_KEYS) {
            const value = String((raw as Record<string, unknown>)[key] || '').trim();
            if (value) rationale[key] = value;
        }
    }
    rationale.text = RATIONALE_KEYS
        .filter((key) => rationale[key])
        .map((key) => `${RATIONALE_LABELS[key]}：${rationale[key]}`)
        .join('\n');
    return rationale;
}

function normalizeBackground(
    input: ComposeDesignSpecInput | Record<string, any>,
    treatment: 'photo' | 'cutout' | undefined,
    issues: string[]
): ComposeDesignBackgroundInput {
    const raw = input?.background && typeof input.background === 'object'
        ? input.background as Record<string, any>
        : {};
    const kind = String(raw.kind || '').trim() as ComposeDesignBackgroundKind;
    if (!BACKGROUND_KINDS.includes(kind)) {
        issues.push(`background.kind：必须显式声明 ${BACKGROUND_KINDS.join(' / ')}；摄影图满幅可用 none`);
        return { kind: 'none' };
    }
    if (treatment === 'photo' && kind !== 'none') {
        issues.push('background.kind：subject.treatment=photo 时必须为 none；若要另铺背景，请显式改用 cutout');
    }
    if (treatment === 'cutout' && kind === 'none') {
        issues.push('background.kind：subject.treatment=cutout 需要明确的 solid / gradient / asset / generated 背景');
    }
    const background: ComposeDesignBackgroundInput = { kind };
    if (kind === 'solid') {
        const colorHex = normalizeHexColor(raw.colorHex);
        if (!colorHex) issues.push('background.colorHex：solid 背景必须由 Agent 显式给出颜色，Harness 不从 palette 代填');
        if (colorHex) background.colorHex = colorHex;
    }
    if (kind === 'gradient') {
        const fromHex = normalizeHexColor(raw.gradient?.fromHex);
        const toHex = normalizeHexColor(raw.gradient?.toHex);
        const angle = Number(raw.gradient?.angle);
        if (!fromHex || !toHex || !Number.isFinite(angle)) {
            issues.push('background.gradient：需要显式 {fromHex,toHex,angle}；Harness 不派生渐变颜色或方向');
        } else {
            background.gradient = { fromHex, toHex, angle };
        }
    }
    if (kind === 'asset') {
        const filePath = String(raw.filePath || '').trim();
        if (!filePath) issues.push('background.filePath：asset 背景需要可追溯的绝对路径');
        if (filePath) background.filePath = filePath;
    }
    if (kind === 'generated') {
        const prompt = String(raw.prompt || '').trim();
        if (prompt.length < 6) issues.push('background.prompt：generated 背景需要明确的场景方向，至少 6 个字');
        if (prompt) background.prompt = prompt;
        const referenceFilePath = String(raw.referenceFilePath || '').trim();
        if (referenceFilePath) background.referenceFilePath = referenceFilePath;
    }
    if (kind === 'asset' || kind === 'generated') {
        const placement = raw.imagePlacement && typeof raw.imagePlacement === 'object'
            && !Array.isArray(raw.imagePlacement)
            ? raw.imagePlacement as ImagePlacementSpec
            : undefined;
        if (!placement) {
            issues.push('background.imagePlacement：图片背景必须由 Agent 显式声明 fit / anchor / cropPolicy 等落位意图');
        } else {
            if (placement.cropPolicy === 'protect-subject') {
                issues.push('background.imagePlacement.cropPolicy：背景图片没有可验证的主体框，不能使用 protect-subject；请由 Agent 选择完整保留或允许裁切，仅在需要保留特定背景位置时再提供 focalPoint');
            }
            if (placement.subjectFillRatio !== undefined) {
                issues.push('background.imagePlacement.subjectFillRatio：背景图片没有可验证的主体框；请用 fit 与 anchor 表达构图，仅在需要保留特定背景位置时再提供 focalPoint');
            }
            const placementValidation = validateModelAuthoredLayout({
                mode: 'regions',
                regions: [{
                    id: '背景素材',
                    role: 'main-image',
                    content: '__declared_background__.png',
                    bounds: { x: 0, y: 0, width: 1, height: 1 },
                    imagePlacement: placement
                }]
            });
            issues.push(...placementValidation.issues.map((issue) => `background.${issue}`));
            background.imagePlacement = placement;
        }
    }
    return background;
}

function normalizeSubjectShadow(raw: unknown, issues: string[]): ComposeDesignShadowSpec | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        issues.push('subject.shadow：必须显式声明 {kind:"none"} 或完整 drop-shadow 参数；Harness 不提供阴影配方');
        return undefined;
    }
    const source = raw as Record<string, unknown>;
    const kind = String(source.kind || '').trim();
    if (kind === 'none') return { kind: 'none' };
    if (kind !== 'drop-shadow') {
        issues.push('subject.shadow.kind：只能是 none 或 drop-shadow；soft/contact 等内置阴影配方已移除');
        return undefined;
    }
    const colorHex = normalizeHexColor(source.colorHex);
    const opacity = Number(source.opacity);
    const angle = Number(source.angle);
    const distance = Number(source.distance);
    const size = Number(source.size);
    const spread = Number(source.spread);
    if (!colorHex
        || !Number.isFinite(opacity) || opacity < 0 || opacity > 100
        || !Number.isFinite(angle) || angle < -360 || angle > 360
        || !Number.isFinite(distance) || distance < 0
        || !Number.isFinite(size) || size < 0
        || !Number.isFinite(spread) || spread < 0 || spread > 100) {
        issues.push('subject.shadow：drop-shadow 需要显式 colorHex、opacity(0–100)、angle、distance、size、spread(0–100)');
        return undefined;
    }
    return { kind: 'drop-shadow', colorHex, opacity, angle, distance, size, spread };
}

export function normalizeComposeDesignSpec(input: ComposeDesignSpecInput | any): ComposeDesignSpecNormalization {
    const issues: string[] = [];
    const notes: string[] = [];
    const rationale = normalizeRationale(input?.rationale);
    const width = Number(input?.canvas?.width);
    const height = Number(input?.canvas?.height);
    if (!(width >= 200 && height >= 200 && width <= 30000 && height <= 30000)) {
        issues.push('canvas：需要 200–30000 像素范围内的明确 width 与 height');
    }

    const paletteRaw = normalizePaletteInput(input?.palette);
    if (!isHex(paletteRaw.backgroundHex) || !isHex(paletteRaw.textHex)) {
        issues.push('palette：必须由 Agent 显式给 backgroundHex 与 textHex；Harness 不按底色派生字色');
    }
    const palette = paletteRaw as unknown as ComposeDesignPalette;

    const subjectRaw = input?.subject && typeof input.subject === 'object' ? input.subject : undefined;
    const subjectFilePath = String(subjectRaw?.filePath || '').trim();
    const existingLayerId = Number.isFinite(Number(subjectRaw?.existingLayerId)) && Number(subjectRaw?.existingLayerId) > 0
        ? Number(subjectRaw.existingLayerId)
        : undefined;
    const hasSubjectSource = Boolean(subjectFilePath) || existingLayerId !== undefined;
    let treatment: 'photo' | 'cutout' | undefined;
    let shadow: ComposeDesignShadowSpec | undefined;
    if (subjectRaw) {
        if (subjectRaw.treatment === 'photo' || subjectRaw.treatment === 'cutout') {
            treatment = subjectRaw.treatment;
        } else {
            issues.push('subject.treatment：必须由 Agent 显式选择 photo 或 cutout；Harness 不根据是否有背景猜测');
        }
        shadow = normalizeSubjectShadow(subjectRaw.shadow, issues);
        if (treatment === 'photo' && subjectRaw.fillRatio !== undefined) {
            const fillRatio = Number(subjectRaw.fillRatio);
            if (!(fillRatio > 0 && fillRatio <= 1)) {
                issues.push('subject.fillRatio：若 Agent 选择按主体框控制摄影占比，必须显式给 (0,1] 的有限数值；普通完整摄影构图请省略该字段并使用 region.imagePlacement');
            }
        }
        if (treatment === 'cutout' && typeof subjectRaw.cutout !== 'boolean') {
            issues.push('subject.cutout：cutout 模式必须显式说明是否需要抠图；Harness 不按扩展名猜测');
        }
    }

    const background = normalizeBackground(input, treatment, issues);
    if (background.kind === 'generated' && !subjectFilePath && !background.referenceFilePath) {
        issues.push('background.referenceFilePath：generated 背景需要主体照片或显式参照图来约束光线');
    }

    const layout = input?.layout && typeof input.layout === 'object' ? input.layout : {};
    if (layout.mode !== 'agent_authored') {
        issues.push('layout.mode：只能是 agent_authored；内置版式配方已移除');
    }
    if (layout.recipe !== undefined || layout.recipeId !== undefined) {
        issues.push('layout.recipe：内置设计配方已移除，请把本稿判断表达为 regions + visualStyle');
    }
    const regions = Array.isArray(layout.regions) ? layout.regions : [];
    if (regions.length === 0) {
        issues.push('layout.regions：必须由 Agent 显式声明构图区域，Harness 不补默认版式');
    }
    regions.forEach((region: any, index: number) => {
        const bounds = region?.bounds || {};
        if (isImplementationRegionId(region?.id)) {
            issues.push(`layout.regions[${index}].id：需要用户可读、能说明实际内容或作用的语义图层名；headline / scene-line / color-note / main-image 等实现标识不能用于交付图层`);
        }
        if (!String(region?.role || '').trim() || !String(region?.content || '').trim()) {
            issues.push(`layout.regions[${index}]：需要 role 与 content`);
        }
        const role = String(region?.role || '').trim();
        const subjectAlias = isComposeDesignSubjectAliasRegion(region);
        const directImage = rendersLayoutBlockAsImage(region);
        if (role === 'main-image' && !subjectAlias && !directImage) {
            issues.push(`layout.regions[${index}].content：main-image 必须是 subject 别名或可追溯的图片绝对路径`);
        }
        if ((subjectAlias || directImage) && (!region?.imagePlacement || typeof region.imagePlacement !== 'object')) {
            issues.push(`layout.regions[${index}].imagePlacement：每个视觉元素都需要自己显式声明 fit / anchor / scale / rotation / mask / overflow`);
        }
        const values = [bounds.x, bounds.y, bounds.width, bounds.height].map(Number);
        if (!values.every(Number.isFinite)
            || values[0] < 0 || values[1] < 0
            || values[2] <= 0 || values[3] <= 0
            || values[0] + values[2] > 1 || values[1] + values[3] > 1) {
            issues.push(`layout.regions[${index}].bounds：需要位于 0..1 画布内的 {x,y,width,height}`);
        }
    });
    const groupName = String(layout.groupName || '').replace(/\s+/g, ' ').trim();
    if (!groupName || groupName.length > 40) {
        issues.push('layout.groupName：需要不超过 40 字符、符合当前项目规范的语义图层组名');
    }
    if (layout.visualStyle?.mode !== 'model_authored') {
        issues.push('layout.visualStyle：正式首稿必须由 Agent 声明完整的 mode=model_authored 样式');
    }
    if (regions.some(isComposeDesignSubjectAliasRegion) && !hasSubjectSource) {
        issues.push('subject：只有 content="subject" 的视觉元素需要 subject.filePath 或 existingLayerId；直接图片路径可独立声明多个视觉元素');
    }
    if (treatment === 'photo') {
        regions.forEach((region: any, index: number) => {
            if (!isComposeDesignSubjectAliasRegion(region)) return;
            if (region?.imagePlacement?.fit !== 'cover') {
                issues.push(`layout.regions[${index}].imagePlacement.fit：subject.treatment=photo 表示全画布摄影底，必须显式声明 cover；非满幅照片请作为普通图片 region 使用`);
            }
        });
    }
    const layoutValidation = validateModelAuthoredLayout({
        mode: 'regions',
        columns: layout.columns,
        marginScale: layout.marginScale,
        gutterScale: layout.gutterScale,
        regions: regions.map((region: any) => (
            isComposeDesignSubjectAliasRegion(region)
                ? { ...region, content: subjectFilePath || '__declared_subject__.png' }
                : region
        ))
    });
    issues.push(...layoutValidation.issues.map((issue) => `layout.${issue}`));

    const documentMode = String(input?.document?.mode || 'new') === 'active' ? 'active' : 'new';
    const declaredDocumentName = String(input?.document?.name || '').replace(/\s+/g, ' ').trim();
    if (documentMode === 'new' && (!declaredDocumentName || declaredDocumentName.length > 80)) {
        issues.push('document.name：新建设计必须由 Agent 声明不超过 80 字符的用户可读名称；Harness 不用尺寸或时间戳生成工程名');
    }
    const documentName = declaredDocumentName || groupName;
    if (input?.save !== undefined) {
        issues.push('save：composeDesign 不在 Agent 看见写后真实画面前保存；请先完成视觉复核，再单独调用 saveDocument 或导出工具');
    }

    if (issues.length > 0) return { ok: false, issues, notes };

    return {
        ok: true,
        issues,
        notes,
        spec: {
            rationale,
            productFacts: Array.from(new Set([
                ...(Array.isArray(input?.productFacts) ? input.productFacts : []),
                ...String(rationale.copySource || '').split(/[，,；;、/\s]+/u)
            ].map((item: unknown) => String(item ?? '').trim()).filter((item: string) => item.length >= 2))),
            canvas: {
                width: Math.round(width),
                height: Math.round(height),
                ...(Number(input?.canvas?.resolution) > 0 ? { resolution: Math.round(Number(input.canvas.resolution)) } : {}),
                ...(['RGB', 'CMYK', 'Grayscale'].includes(String(input?.canvas?.colorMode)) ? { colorMode: input.canvas.colorMode } : {})
            },
            document: { mode: documentMode, name: documentName },
            background,
            subject: subjectRaw
                ? {
                    filePath: subjectFilePath || undefined,
                    existingLayerId,
                    fillRatio: treatment === 'photo' && subjectRaw.fillRatio !== undefined
                        ? Number(subjectRaw.fillRatio)
                        : undefined,
                    shadow: shadow!,
                    treatment: treatment!,
                    cutout: treatment === 'cutout' ? Boolean(subjectRaw.cutout) : false
                }
                : undefined,
            layout: {
                ...layout,
                mode: 'agent_authored',
                regions,
                groupName,
                visualStyle: layout.visualStyle
            },
            palette
        }
    };
}

function describeTextSideForRegions(regions: ComposeDesignLayoutRegion[]): string {
    const texts = regions.filter((region) => (
        region.role !== 'main-image'
        && region.role !== 'decoration'
        && !rendersLayoutBlockAsImage(region)
        && region.bounds
    ));
    if (texts.length === 0) return 'central';
    const centerX = texts.reduce((sum, region) => sum + region.bounds.x + region.bounds.width / 2, 0) / texts.length;
    const centerY = texts.reduce((sum, region) => sum + region.bounds.y + region.bounds.height / 2, 0) / texts.length;
    const horizontal = centerX < 0.4 ? 'left' : centerX > 0.6 ? 'right' : '';
    const vertical = centerY < 0.4 ? 'upper' : centerY > 0.6 ? 'lower' : '';
    return [vertical, horizontal].filter(Boolean).join('-') || 'central';
}

export function buildBackdropPrompt(spec: ComposeDesignSpec): string {
    const emptySide = describeTextSideForRegions(spec.layout.regions);
    return [
        `Generate an empty product photography backdrop only: ${String(spec.background.prompt || '').trim()}.`,
        'Match the reference lighting and color temperature, but do not include the product, people, hands, text, letters, watermark or border.',
        `Keep the explicitly declared ${emptySide} text area low-detail and usable.`,
        'Return only the backdrop; product composition and typography will be authored separately.'
    ].join(' ');
}

export function describeTextSideForLayout(layout: ComposeDesignLayoutInput): 'left' | 'center' | 'right' {
    const regions = Array.isArray(layout?.regions) ? layout.regions : [];
    const texts = regions.filter((region) => (
        region.role !== 'main-image'
        && region.role !== 'decoration'
        && !rendersLayoutBlockAsImage(region)
        && region.bounds
    ));
    if (texts.length === 0) return 'center';
    const centerX = texts.reduce((sum, region) => sum + region.bounds.x + region.bounds.width / 2, 0) / texts.length;
    return centerX < 0.4 ? 'left' : centerX > 0.6 ? 'right' : 'center';
}

export function planPhotoFullBleedPlacement(input: {
    canvas: { width: number; height: number };
    photo: { width: number; height: number };
    subjectBox: { x: number; y: number; width: number; height: number };
    targetRegion: { x: number; y: number; width: number; height: number };
    fillRatio: number;
    anchor: ImagePlacementSpec['anchor'];
    focalPoint?: ImagePlacementSpec['focalPoint'];
}): {
    x: number;
    y: number;
    width: number;
    height: number;
    scale: number;
    coverLimited: boolean;
    focusSource: { x: number; y: number; kind: 'subject-anchor' | 'focal-point' };
    focusTarget: { x: number; y: number };
    actualFocus: { x: number; y: number };
    focusDeviationPx: number;
    focusIntentSatisfied: boolean;
    requestedFillRatio: number;
    actualFillRatio: number;
    fillIntentSatisfied: boolean;
    designIntentSatisfied: boolean;
    constraintIssues: Array<
        'full_canvas_cover_conflicts_with_subject_fill'
        | 'focus_position_conflicts_with_subject_fill'
    >;
    notes: string[];
} | null {
    const canvasWidth = Number(input.canvas?.width);
    const canvasHeight = Number(input.canvas?.height);
    const photoWidth = Number(input.photo?.width);
    const photoHeight = Number(input.photo?.height);
    const box = input.subjectBox;
    const region = input.targetRegion;
    const fill = Number(input.fillRatio);
    if (!(canvasWidth > 0 && canvasHeight > 0 && photoWidth > 0 && photoHeight > 0)
        || !box || !region
        || !(box.width > 0 && box.height > 0 && region.width > 0 && region.height > 0)
        || !(fill > 0 && fill <= 1)
        || !['center', 'top-center', 'bottom-center', 'left-center', 'right-center'].includes(input.anchor)) {
        return null;
    }
    const notes: string[] = [];
    const subjectWidth = box.width * photoWidth;
    const subjectHeight = box.height * photoHeight;
    const regionWidth = region.width * canvasWidth;
    const regionHeight = region.height * canvasHeight;
    const scaleForFill = fill * Math.min(regionWidth / subjectWidth, regionHeight / subjectHeight);
    const scaleForCover = Math.max(canvasWidth / photoWidth, canvasHeight / photoHeight);
    const anchorRatios: Record<ImagePlacementSpec['anchor'], { x: number; y: number }> = {
        center: { x: 0.5, y: 0.5 },
        'top-center': { x: 0.5, y: 0 },
        'bottom-center': { x: 0.5, y: 1 },
        'left-center': { x: 0, y: 0.5 },
        'right-center': { x: 1, y: 0.5 }
    };
    const anchorRatio = anchorRatios[input.anchor];
    const focalX = Number(input.focalPoint?.x);
    const focalY = Number(input.focalPoint?.y);
    const hasFocalPoint = Number.isFinite(focalX) && Number.isFinite(focalY)
        && focalX >= 0 && focalX <= 1 && focalY >= 0 && focalY <= 1;
    const sourceFocusXRatio = hasFocalPoint ? focalX : box.x + box.width * anchorRatio.x;
    const sourceFocusYRatio = hasFocalPoint ? focalY : box.y + box.height * anchorRatio.y;
    const targetFocusX = (region.x + region.width * (hasFocalPoint ? 0.5 : anchorRatio.x)) * canvasWidth;
    const targetFocusY = (region.y + region.height * (hasFocalPoint ? 0.5 : anchorRatio.y)) * canvasHeight;
    const positionScales = [
        sourceFocusXRatio > 0 ? targetFocusX / (sourceFocusXRatio * photoWidth) : 0,
        sourceFocusXRatio < 1 ? (canvasWidth - targetFocusX) / ((1 - sourceFocusXRatio) * photoWidth) : 0,
        sourceFocusYRatio > 0 ? targetFocusY / (sourceFocusYRatio * photoHeight) : 0,
        sourceFocusYRatio < 1 ? (canvasHeight - targetFocusY) / ((1 - sourceFocusYRatio) * photoHeight) : 0
    ].filter((value) => Number.isFinite(value) && value > 0);
    const scaleForPosition = positionScales.length ? Math.max(...positionScales) : 0;
    let scale = Math.max(scaleForFill, scaleForCover);
    let coverLimited = false;
    const constraintIssues: Array<
        'full_canvas_cover_conflicts_with_subject_fill'
        | 'focus_position_conflicts_with_subject_fill'
    > = [];
    if (scaleForFill < scaleForCover) {
        coverLimited = true;
        constraintIssues.push('full_canvas_cover_conflicts_with_subject_fill');
        notes.push('声明的主体占比与摄影满幅覆盖不能同时满足；当前几何仅用于返回冲突事实，执行器不得直接写入');
    }
    if (scaleForPosition > scale) {
        scale = scaleForPosition;
        constraintIssues.push('focus_position_conflicts_with_subject_fill');
        notes.push('声明的主体占比与锚点/关注点满幅位置不能同时满足；当前几何仅用于返回冲突事实，执行器不得直接写入');
    }
    const width = photoWidth * scale;
    const height = photoHeight * scale;
    let x = targetFocusX - sourceFocusXRatio * width;
    let y = targetFocusY - sourceFocusYRatio * height;
    x = Math.max(canvasWidth - width, Math.min(0, x));
    y = Math.max(canvasHeight - height, Math.min(0, y));
    const actualFocus = {
        x: x + sourceFocusXRatio * width,
        y: y + sourceFocusYRatio * height
    };
    const focusDeviationPx = Math.hypot(
        actualFocus.x - targetFocusX,
        actualFocus.y - targetFocusY
    );
    const focusTolerancePx = Math.max(2, Math.min(canvasWidth, canvasHeight) * 0.01);
    const actualFillRatio = Math.max(
        (subjectWidth * scale) / regionWidth,
        (subjectHeight * scale) / regionHeight
    );
    const fillIntentSatisfied = scale === scaleForFill;
    const focusIntentSatisfied = focusDeviationPx <= focusTolerancePx;
    return {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
        scale,
        coverLimited,
        focusSource: {
            x: sourceFocusXRatio,
            y: sourceFocusYRatio,
            kind: hasFocalPoint ? 'focal-point' : 'subject-anchor'
        },
        focusTarget: { x: targetFocusX, y: targetFocusY },
        actualFocus,
        focusDeviationPx,
        focusIntentSatisfied,
        requestedFillRatio: fill,
        actualFillRatio,
        fillIntentSatisfied,
        designIntentSatisfied: fillIntentSatisfied && focusIntentSatisfied,
        constraintIssues,
        notes
    };
}

/** 透传并复制 Agent 显式声明的 Photoshop 投影参数；不生成或选择视觉配方。 */
export function planSubjectShadow(shadow: ComposeDesignShadowSpec): {
    opacity: number;
    angle: number;
    distance: number;
    size: number;
    spread: number;
    colorHex: string;
} | null {
    if (shadow.kind === 'none') return null;
    return {
        opacity: shadow.opacity,
        angle: shadow.angle,
        distance: shadow.distance,
        size: shadow.size,
        spread: shadow.spread,
        colorHex: shadow.colorHex
    };
}

export function describeComposeDesignForModel(): string {
    return [
        '一次调用执行一张可编辑候选稿：建画布、处理显式背景、按 Agent 声明的 regions 与 visualStyle 建层、执行已选择的投影、回读真实结构与快照。',
        'layout.mode 只能是 agent_authored；regions 是元素数组而不是固定模板，同一 role 可以出现多次。main-image / tag / decoration 可直接给各自图片绝对路径；subject 只是其中一个可选别名，不是单素材上限。',
        '每个 region.id 必须是用户可读、符合当前项目命名规范且能说明真实内容或作用的语义名称；Harness 只校验，绝不自动把 headline / scene-line / color-note 等实现标识改成设计答案。',
        '必须显式给 mode=model_authored 的 visualStyle、栅格档位与语义 groupName。',
        '主体 treatment、完整 shadow 参数、背景颜色或渐变都由 Agent 根据用户目标与真实素材决定；普通完整摄影构图用 region.imagePlacement 表达，只有需要按可靠主体框精确控制占比时才声明 subject.fillRatio。Harness 不提供品类预设。',
        'document.mode=new 会另建独立候选，不会修改或自动胜出于上一稿；同素材候选发生结构变化时，返回 before / after 角色与元素事实，变化本身不等于质量结论。',
        '产品本体必须来自可追溯真实素材；背景生成只生成空场景；文字保持可编辑。',
        '返回的结构收据与快照是事实，不是审美结论；是否评审、修订以及如何修订由 Agent 根据风险与画面决定。保存与导出必须发生在 Agent 看过当前版本之后。'
    ].join('\n');
}
