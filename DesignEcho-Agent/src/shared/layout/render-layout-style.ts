export interface RgbColor {
    r: number;
    g: number;
    b: number;
}

export type RenderLayoutStyleMode = 'neutral_wireframe' | 'model_authored';
export type RenderLayoutTextFitMode = 'none' | 'shrink_to_width';

export interface RenderLayoutTypographySpec {
    /** 必须是 resolveFontName 已确认可写的字体名；省略时沿用 Photoshop 当前默认字体。 */
    fontName?: string;
    /** 相对当前文字区域高度的字号比例。 */
    fontSizeRatio: number;
    /** 允许拟合时的字号下限，同样相对当前文字区域高度；不得大于 fontSizeRatio。 */
    minFontSizeRatio: number;
    /** none 保持模型字号和原文；shrink_to_width 明确授权缩小至下限，必要时换行。 */
    fitMode: RenderLayoutTextFitMode;
    /** Photoshop tracking，单位为 1/1000 em。 */
    tracking: number;
    /** 相对字号的行距比例。 */
    leadingRatio: number;
}

export interface RenderLayoutModelAuthoredVisualStyle {
    mode: 'model_authored';
    palette: {
        primaryTextColorHex: string;
        secondaryTextColorHex: string;
        accentColorHex: string;
        sellingPointTextColorHex: string;
        sellingPointFillColorHex?: string;
    };
    typography: {
        title: RenderLayoutTypographySpec;
        subtitle: RenderLayoutTypographySpec;
        body: RenderLayoutTypographySpec;
        sellingPoint: RenderLayoutTypographySpec;
    };
    sellingPoint: {
        treatment: 'text_only' | 'solid_box';
        /** 相对卖点区域短边的圆角比例。 */
        cornerRadiusRatio: number;
        /** 相对卖点区域宽度的左右内边距比例。 */
        paddingRatio: number;
    };
}

export interface RenderLayoutNeutralWireframeStyle {
    mode: 'neutral_wireframe';
}

export type RenderLayoutVisualStyleSpec =
    | RenderLayoutModelAuthoredVisualStyle
    | RenderLayoutNeutralWireframeStyle;

export interface ResolvedRenderLayoutTypography {
    fontName?: string;
    fontSizeRatio: number;
    minFontSizeRatio: number;
    fitMode: RenderLayoutTextFitMode;
    tracking: number;
    leadingRatio: number;
    colorHex: string;
}

export interface RenderLayoutStyle {
    mode: RenderLayoutStyleMode;
    provenance: 'neutral_wireframe_default' | 'model_authored_visual_style';
    pageBackgroundColorHex: string;
    isDarkBackground: boolean;
    pageTextColorHex: string;
    secondaryTextColorHex: string;
    accentColorHex: string;
    placeholderFillColorHex: string;
    sellingPointBoxFillColorHex: string;
    sellingPointTextColorHex: string;
    sellingPointTreatment: 'text_only' | 'solid_box';
    sellingPointCornerRadiusRatio: number;
    sellingPointPaddingRatio: number;
    typography: {
        title: ResolvedRenderLayoutTypography;
        subtitle: ResolvedRenderLayoutTypography;
        body: ResolvedRenderLayoutTypography;
        sellingPoint: ResolvedRenderLayoutTypography;
    };
}

export interface RenderLayoutStyleResolution {
    ok: boolean;
    style?: RenderLayoutStyle;
    issues: string[];
}

const DARK_PAGE_TEXT = '#FFFFFF';
const LIGHT_PAGE_TEXT = '#1A1A1A';
const LIGHT_SECONDARY_TEXT = '#475569';
const DARK_SECONDARY_TEXT = '#CBD5E1';
const LIGHT_SELLING_POINT_BOX = '#E5E7EB';
const DARK_SELLING_POINT_BOX = '#374151';
const DARK_SELLING_POINT_TEXT = '#FFFFFF';
const LIGHT_SELLING_POINT_TEXT_CANDIDATES = ['#111827', '#000000'];
const HEX_COLOR_PATTERN = /^#?[0-9a-fA-F]{6}$/;

function clampChannel(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(255, Math.round(value)));
}

export function normalizeHexColor(value: unknown, fallback = '#FFFFFF'): string {
    const text = String(value || '').trim();
    const match = text.match(/^#?([0-9a-fA-F]{6})$/);
    if (!match) return fallback;
    return `#${match[1].toUpperCase()}`;
}

export function parseHexColor(value: unknown): RgbColor | null {
    const hex = normalizeHexColor(value, '');
    if (!hex) return null;
    return {
        r: parseInt(hex.slice(1, 3), 16),
        g: parseInt(hex.slice(3, 5), 16),
        b: parseInt(hex.slice(5, 7), 16)
    };
}

function channelToLinear(value: number): number {
    const normalized = clampChannel(value) / 255;
    return normalized <= 0.03928
        ? normalized / 12.92
        : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(color: unknown): number {
    const rgb = typeof color === 'string' ? parseHexColor(color) : color as RgbColor | null;
    if (!rgb) return 1;
    return channelToLinear(rgb.r) * 0.2126
        + channelToLinear(rgb.g) * 0.7152
        + channelToLinear(rgb.b) * 0.0722;
}

export function contrastRatio(backgroundHex: unknown, textHex: unknown): number {
    const a = relativeLuminance(backgroundHex);
    const b = relativeLuminance(textHex);
    const lighter = Math.max(a, b);
    const darker = Math.min(a, b);
    return (lighter + 0.05) / (darker + 0.05);
}

function pickReadableTextColor(backgroundHex: string, candidates: string[]): string {
    let best = candidates[0] || LIGHT_PAGE_TEXT;
    let bestContrast = -1;
    for (const candidate of candidates) {
        const ratio = contrastRatio(backgroundHex, candidate);
        if (ratio > bestContrast) {
            best = candidate;
            bestContrast = ratio;
        }
    }
    return best;
}

function buildTypography(input: {
    spec: RenderLayoutTypographySpec;
    colorHex: string;
}): ResolvedRenderLayoutTypography {
    const fontName = String(input.spec.fontName || '').trim();
    return {
        ...(fontName ? { fontName } : {}),
        fontSizeRatio: input.spec.fontSizeRatio,
        minFontSizeRatio: input.spec.minFontSizeRatio,
        fitMode: input.spec.fitMode,
        tracking: input.spec.tracking,
        leadingRatio: input.spec.leadingRatio,
        colorHex: input.colorHex
    };
}

function buildNeutralWireframeStyle(backgroundHex?: unknown): RenderLayoutStyle {
    const pageBackgroundColorHex = normalizeHexColor(backgroundHex, '#FFFFFF');
    const isDarkBackground = relativeLuminance(pageBackgroundColorHex) < 0.36;
    const pageTextColorHex = isDarkBackground ? DARK_PAGE_TEXT : LIGHT_PAGE_TEXT;
    const secondaryTextColorHex = isDarkBackground ? DARK_SECONDARY_TEXT : LIGHT_SECONDARY_TEXT;
    const sellingPointBoxFillColorHex = isDarkBackground ? DARK_SELLING_POINT_BOX : LIGHT_SELLING_POINT_BOX;
    const sellingPointTextColorHex = isDarkBackground
        ? DARK_SELLING_POINT_TEXT
        : pickReadableTextColor(sellingPointBoxFillColorHex, LIGHT_SELLING_POINT_TEXT_CANDIDATES);
    return {
        mode: 'neutral_wireframe',
        provenance: 'neutral_wireframe_default',
        pageBackgroundColorHex,
        isDarkBackground,
        pageTextColorHex,
        secondaryTextColorHex,
        accentColorHex: sellingPointBoxFillColorHex,
        placeholderFillColorHex: isDarkBackground ? '#3A3A3A' : '#E5E7EB',
        sellingPointBoxFillColorHex,
        sellingPointTextColorHex,
        sellingPointTreatment: 'solid_box',
        sellingPointCornerRadiusRatio: 0.12,
        sellingPointPaddingRatio: 0.05,
        typography: {
            title: buildTypography({
                spec: { fontSizeRatio: 0.45, minFontSizeRatio: 0.18, fitMode: 'shrink_to_width', tracking: 0, leadingRatio: 1.18 },
                colorHex: pageTextColorHex
            }),
            subtitle: buildTypography({
                spec: { fontSizeRatio: 0.36, minFontSizeRatio: 0.16, fitMode: 'shrink_to_width', tracking: 0, leadingRatio: 1.18 },
                colorHex: secondaryTextColorHex
            }),
            body: buildTypography({
                spec: { fontSizeRatio: 0.32, minFontSizeRatio: 0.14, fitMode: 'shrink_to_width', tracking: 0, leadingRatio: 1.18 },
                colorHex: pageTextColorHex
            }),
            sellingPoint: buildTypography({
                spec: { fontSizeRatio: 0.38, minFontSizeRatio: 0.16, fitMode: 'shrink_to_width', tracking: 0, leadingRatio: 1.18 },
                colorHex: sellingPointTextColorHex
            })
        }
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readRequiredColor(value: unknown, path: string, issues: string[]): string {
    if (!HEX_COLOR_PATTERN.test(String(value || '').trim())) {
        issues.push(`${path}:invalid_hex_color`);
        return '';
    }
    return normalizeHexColor(value);
}

function readTypography(
    value: unknown,
    path: string,
    colorHex: string,
    issues: string[]
): ResolvedRenderLayoutTypography {
    const record = isRecord(value) ? value : {};
    if (!isRecord(value)) issues.push(`${path}:object_required`);
    const fontName = record.fontName === undefined ? '' : String(record.fontName || '').trim();
    if (record.fontName !== undefined && (!fontName || fontName.length > 120)) {
        issues.push(`${path}.fontName:invalid`);
    }
    const fontSizeRatio = typeof record.fontSizeRatio === 'number' ? record.fontSizeRatio : Number.NaN;
    const minFontSizeRatio = typeof record.minFontSizeRatio === 'number' ? record.minFontSizeRatio : Number.NaN;
    const fitMode = String(record.fitMode || '').trim();
    const tracking = typeof record.tracking === 'number' ? record.tracking : Number.NaN;
    const leadingRatio = typeof record.leadingRatio === 'number' ? record.leadingRatio : Number.NaN;
    if (!Number.isFinite(fontSizeRatio) || fontSizeRatio < 0.08 || fontSizeRatio > 0.9) {
        issues.push(`${path}.fontSizeRatio:out_of_range`);
    }
    if (!Number.isFinite(minFontSizeRatio) || minFontSizeRatio < 0.02 || minFontSizeRatio > 0.9
        || (Number.isFinite(fontSizeRatio) && minFontSizeRatio > fontSizeRatio)) {
        issues.push(`${path}.minFontSizeRatio:out_of_range`);
    }
    if (!['none', 'shrink_to_width'].includes(fitMode)) {
        issues.push(`${path}.fitMode:invalid`);
    }
    if (!Number.isFinite(tracking) || tracking < -1000 || tracking > 1000) {
        issues.push(`${path}.tracking:out_of_range`);
    }
    if (!Number.isFinite(leadingRatio) || leadingRatio < 0.8 || leadingRatio > 2) {
        issues.push(`${path}.leadingRatio:out_of_range`);
    }
    return {
        ...(fontName ? { fontName } : {}),
        fontSizeRatio: Number.isFinite(fontSizeRatio) ? fontSizeRatio : 0,
        minFontSizeRatio: Number.isFinite(minFontSizeRatio) ? minFontSizeRatio : 0,
        fitMode: fitMode as RenderLayoutTextFitMode,
        tracking: Number.isFinite(tracking) ? tracking : 0,
        leadingRatio: Number.isFinite(leadingRatio) ? leadingRatio : 0,
        colorHex
    };
}

function estimateTextWidth(content: string, fontSize: number, tracking: number): number {
    const glyphs = Array.from(String(content || ''));
    const baseUnits = glyphs.reduce((sum, char) => {
        if (/[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(char)) return sum + 1;
        if (/[A-Z]/.test(char)) return sum + 0.62;
        if (/[a-z0-9]/.test(char)) return sum + 0.56;
        if (/[:：,，.。;]/.test(char)) return sum + 0.3;
        if (/[-/\\]/.test(char)) return sum + 0.35;
        if (/\s/.test(char)) return sum + 0.3;
        return sum + 0.55;
    }, 0);
    const trackingWidth = Math.max(0, glyphs.length - 1) * fontSize * (tracking / 1000);
    return Math.max(0, baseUnits * fontSize + trackingWidth);
}

function estimateMultilineTextWidth(content: string, fontSize: number, tracking: number): number {
    return String(content ?? '')
        .split(/\r\n|\r|\n/)
        .reduce((maxWidth, line) => Math.max(maxWidth, estimateTextWidth(line, fontSize, tracking)), 0);
}

function wrapLineToWidthPreservingWhitespace(
    line: string,
    maxWidth: number,
    fontSize: number,
    tracking: number
): string {
    if (!line || estimateTextWidth(line, fontSize, tracking) <= maxWidth) return line;
    const lines: string[] = [];
    let current = '';
    for (const char of Array.from(line)) {
        const candidate = `${current}${char}`;
        if (current && estimateTextWidth(candidate, fontSize, tracking) > maxWidth) {
            lines.push(current);
            current = char;
        } else {
            current = candidate;
        }
    }
    if (current) lines.push(current);
    return lines.join('\n');
}

function wrapTextToWidthPreservingWhitespace(
    content: string,
    maxWidth: number,
    fontSize: number,
    tracking: number
): string {
    return String(content ?? '')
        .split(/(\r\n|\r|\n)/)
        .map((part) => (/^(?:\r\n|\r|\n)$/.test(part)
            ? part
            : wrapLineToWidthPreservingWhitespace(part, maxWidth, fontSize, tracking)))
        .join('');
}

/**
 * 把模型声明的字号与拟合权限转换为实际文字参数。
 * fitMode=none 时逐值透传；只有 shrink_to_width 才允许缩小或插入换行，且不会低于模型下限。
 */
export function fitRenderLayoutTextToWidth(input: {
    content: string;
    maxWidth: number;
    desiredFontSize: number;
    minFontSize: number;
    fitMode: RenderLayoutTextFitMode;
    tracking: number;
}): { content: string; fontSize: number; fitApplied: boolean; wrapped: boolean } {
    const content = String(input.content ?? '');
    if (input.fitMode === 'none' || !content.trim()) {
        return { content, fontSize: input.desiredFontSize, fitApplied: false, wrapped: false };
    }
    const maxWidth = Math.max(1, input.maxWidth);
    const desiredWidth = estimateMultilineTextWidth(content, input.desiredFontSize, input.tracking);
    if (desiredWidth <= maxWidth) {
        return { content, fontSize: input.desiredFontSize, fitApplied: false, wrapped: false };
    }
    const proportionalFontSize = input.desiredFontSize * (maxWidth / Math.max(1, desiredWidth));
    const fontSize = Math.max(input.minFontSize, Math.min(input.desiredFontSize, proportionalFontSize));
    const fittedContent = estimateMultilineTextWidth(content, fontSize, input.tracking) > maxWidth
        ? wrapTextToWidthPreservingWhitespace(content, maxWidth, fontSize, input.tracking)
        : content;
    return {
        content: fittedContent,
        fontSize,
        fitApplied: fontSize !== input.desiredFontSize || fittedContent !== content,
        wrapped: fittedContent !== content
    };
}

/**
 * 解析模型声明的视觉样式。Harness 只验证字段、范围与可计算对比度；
 * 不为 model_authored 补色、补字号或选择视觉方案。
 */
export function resolveRenderLayoutVisualStyle(input: {
    backgroundHex?: unknown;
    visualStyle?: unknown;
}): RenderLayoutStyleResolution {
    const backgroundHex = normalizeHexColor(input.backgroundHex, '#FFFFFF');
    if (input.visualStyle === undefined || input.visualStyle === null) {
        return { ok: true, style: buildNeutralWireframeStyle(backgroundHex), issues: [] };
    }
    const visualStyle = isRecord(input.visualStyle) ? input.visualStyle : {};
    if (!isRecord(input.visualStyle)) {
        return { ok: false, issues: ['visualStyle:object_required'] };
    }
    const mode = String(visualStyle.mode || '').trim();
    if (mode === 'neutral_wireframe') {
        return { ok: true, style: buildNeutralWireframeStyle(backgroundHex), issues: [] };
    }
    if (mode !== 'model_authored') {
        return { ok: false, issues: ['visualStyle.mode:invalid'] };
    }

    const issues: string[] = [];
    const palette = isRecord(visualStyle.palette) ? visualStyle.palette : {};
    if (!isRecord(visualStyle.palette)) issues.push('visualStyle.palette:object_required');
    const primaryTextColorHex = readRequiredColor(
        palette.primaryTextColorHex,
        'visualStyle.palette.primaryTextColorHex',
        issues
    );
    const secondaryTextColorHex = readRequiredColor(
        palette.secondaryTextColorHex,
        'visualStyle.palette.secondaryTextColorHex',
        issues
    );
    const accentColorHex = readRequiredColor(
        palette.accentColorHex,
        'visualStyle.palette.accentColorHex',
        issues
    );
    const sellingPointTextColorHex = readRequiredColor(
        palette.sellingPointTextColorHex,
        'visualStyle.palette.sellingPointTextColorHex',
        issues
    );

    const sellingPoint = isRecord(visualStyle.sellingPoint) ? visualStyle.sellingPoint : {};
    if (!isRecord(visualStyle.sellingPoint)) issues.push('visualStyle.sellingPoint:object_required');
    const treatment = String(sellingPoint.treatment || '').trim();
    if (!['text_only', 'solid_box'].includes(treatment)) {
        issues.push('visualStyle.sellingPoint.treatment:invalid');
    }
    let sellingPointFillColorHex = '';
    if (treatment === 'solid_box') {
        sellingPointFillColorHex = readRequiredColor(
            palette.sellingPointFillColorHex,
            'visualStyle.palette.sellingPointFillColorHex',
            issues
        );
    } else if (palette.sellingPointFillColorHex !== undefined) {
        sellingPointFillColorHex = readRequiredColor(
            palette.sellingPointFillColorHex,
            'visualStyle.palette.sellingPointFillColorHex',
            issues
        );
    }
    const cornerRadiusRatio = typeof sellingPoint.cornerRadiusRatio === 'number'
        ? sellingPoint.cornerRadiusRatio
        : Number.NaN;
    const paddingRatio = typeof sellingPoint.paddingRatio === 'number'
        ? sellingPoint.paddingRatio
        : Number.NaN;
    if (!Number.isFinite(cornerRadiusRatio) || cornerRadiusRatio < 0 || cornerRadiusRatio > 0.5) {
        issues.push('visualStyle.sellingPoint.cornerRadiusRatio:out_of_range');
    }
    if (!Number.isFinite(paddingRatio) || paddingRatio < 0 || paddingRatio > 0.2) {
        issues.push('visualStyle.sellingPoint.paddingRatio:out_of_range');
    }

    const typography = isRecord(visualStyle.typography) ? visualStyle.typography : {};
    if (!isRecord(visualStyle.typography)) issues.push('visualStyle.typography:object_required');
    const resolvedTypography = {
        title: readTypography(typography.title, 'visualStyle.typography.title', primaryTextColorHex, issues),
        subtitle: readTypography(typography.subtitle, 'visualStyle.typography.subtitle', secondaryTextColorHex, issues),
        body: readTypography(typography.body, 'visualStyle.typography.body', primaryTextColorHex, issues),
        sellingPoint: readTypography(
            typography.sellingPoint,
            'visualStyle.typography.sellingPoint',
            sellingPointTextColorHex,
            issues
        )
    };

    // 普通文字可能压在真实图片而非整页底色上；这里只能确定性验证已知的实色卖点底块。
    // 主/次文字与局部像素的真实对比度交给写后视觉读回，不能用 page background 误拦开放构图。
    if (treatment === 'solid_box'
        && sellingPointFillColorHex
        && sellingPointTextColorHex
        && contrastRatio(sellingPointFillColorHex, sellingPointTextColorHex) < 3) {
        issues.push('visualStyle.palette.sellingPointTextColorHex:contrast_below_3');
    }
    if (issues.length > 0) return { ok: false, issues };

    return {
        ok: true,
        issues: [],
        style: {
            mode: 'model_authored',
            provenance: 'model_authored_visual_style',
            pageBackgroundColorHex: backgroundHex,
            isDarkBackground: relativeLuminance(backgroundHex) < 0.36,
            pageTextColorHex: primaryTextColorHex,
            secondaryTextColorHex,
            accentColorHex,
            placeholderFillColorHex: relativeLuminance(backgroundHex) < 0.36 ? '#3A3A3A' : '#E5E7EB',
            sellingPointBoxFillColorHex: sellingPointFillColorHex || backgroundHex,
            sellingPointTextColorHex,
            sellingPointTreatment: treatment as RenderLayoutStyle['sellingPointTreatment'],
            sellingPointCornerRadiusRatio: cornerRadiusRatio,
            sellingPointPaddingRatio: paddingRatio,
            typography: resolvedTypography
        }
    };
}
