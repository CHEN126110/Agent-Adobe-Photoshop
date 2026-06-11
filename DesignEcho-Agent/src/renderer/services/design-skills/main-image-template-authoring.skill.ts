import type {
    MainImageTemplateBlueprint,
    MainImageTemplateShapeBlueprint,
    MainImageTemplateTextBlueprint
} from '../../../shared/main-image-template-blueprint';

const DEFAULT_RESOLUTION = 72;

const SIZE_PRESETS: Record<string, { width: number; height: number }> = {
    '800': { width: 800, height: 800 },
    '750': { width: 750, height: 750 },
    '1200': { width: 1200, height: 1000 },
    '3:4': { width: 750, height: 1000 }
};

function normalizeText(value: unknown): string {
    return String(value || '')
        .replace(/[，。、“”"'：:；;！!？?（）()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function inferSize(userIntent: string, explicitSize?: string): keyof typeof SIZE_PRESETS {
    const size = String(explicitSize || '').trim();
    if (size in SIZE_PRESETS) return size as keyof typeof SIZE_PRESETS;
    if (/1200/.test(userIntent)) return '1200';
    if (/750/.test(userIntent)) return '750';
    if (/3[:：]4|竖版|长图主图/.test(userIntent)) return '3:4';
    return '800';
}

function inferImageType(userIntent: string, explicitType?: string): 'click' | 'conversion' | 'white-bg' {
    const normalizedExplicit = String(explicitType || '').trim().toLowerCase();
    if (normalizedExplicit === 'conversion' || normalizedExplicit === 'white-bg' || normalizedExplicit === 'click') {
        return normalizedExplicit as 'click' | 'conversion' | 'white-bg';
    }
    if (/白底|white/.test(userIntent)) return 'white-bg';
    if (/转化|卖点|促销|conversion/.test(userIntent)) return 'conversion';
    return 'click';
}

function inferDensity(userIntent: string, explicitDensity?: string): 'minimal' | 'standard' | 'rich' {
    const normalized = String(explicitDensity || userIntent || '').toLowerCase();
    if (/极简|minimal|简洁/.test(normalized)) return 'minimal';
    if (/丰富|rich|信息多/.test(normalized)) return 'rich';
    return 'standard';
}

function inferProductTheme(userIntent: string, explicitTheme?: string): string {
    const direct = normalizeText(explicitTheme);
    if (direct) return direct;

    const text = String(userIntent || '');
    const patterns = [
        /(?:给|为|做|制作|设计|新建|创建)(.+?)(?:的)?主图(?:模板|文档)?/i,
        /(.+?)(?:主图模板|主图文档|主图)/i
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        const candidate = normalizeText(match?.[1] || '');
        if (candidate) return candidate;
    }
    return '产品';
}

function resolveProductHeight(
    preset: { width: number; height: number },
    sizeKey: keyof typeof SIZE_PRESETS,
    density: 'minimal' | 'standard' | 'rich'
): number {
    if (sizeKey === '3:4') return Math.round(preset.height * 0.66);
    if (density === 'minimal') return Math.round(preset.height * 0.62);
    return Math.round(preset.height * 0.58);
}

function resolveCopyPanelHeight(density: 'minimal' | 'standard' | 'rich'): number {
    if (density === 'rich') return 176;
    if (density === 'minimal') return 120;
    return 148;
}

function resolveImageTypeLabel(imageType: 'click' | 'conversion' | 'white-bg'): string {
    if (imageType === 'conversion') return '转化';
    if (imageType === 'white-bg') return '白底';
    return '点击';
}

function createShape(
    name: string,
    role: MainImageTemplateShapeBlueprint['role'],
    shape: MainImageTemplateShapeBlueprint['shape'],
    x: number,
    y: number,
    width: number,
    height: number,
    fillColorHex: string,
    cornerRadius = 0
): MainImageTemplateShapeBlueprint {
    return {
        id: `shape:${name}`,
        name,
        role,
        shape,
        x,
        y,
        width,
        height,
        fillColorHex,
        cornerRadius
    };
}

function createCopy(
    name: string,
    role: MainImageTemplateTextBlueprint['role'],
    content: string,
    x: number,
    y: number,
    fontSize: number,
    alignment: 'left' | 'center' | 'right' = 'left',
    colorHex = '#111827'
): MainImageTemplateTextBlueprint {
    return {
        id: `copy:${name}`,
        name,
        role,
        content,
        x,
        y,
        fontSize,
        alignment,
        colorHex
    };
}

export function buildMainImageTemplateBlueprint(params: {
    userIntent?: string;
    size?: string;
    imageType?: string;
    productTheme?: string;
    density?: string;
}): MainImageTemplateBlueprint {
    const userIntent = String(params.userIntent || '').trim();
    const sizeKey = inferSize(userIntent, params.size);
    const imageType = inferImageType(userIntent, params.imageType);
    const density = inferDensity(userIntent, params.density);
    const productTheme = inferProductTheme(userIntent, params.productTheme);
    const preset = SIZE_PRESETS[sizeKey];

    const productX = Math.round(preset.width * 0.15);
    const productWidth = Math.round(preset.width * 0.7);
    const productHeight = resolveProductHeight(preset, sizeKey, density);
    const productY = imageType === 'white-bg'
        ? Math.round(preset.height * 0.14)
        : Math.round(preset.height * 0.16);

    const copyPanelHeight = resolveCopyPanelHeight(density);
    const copyPanelY = preset.height - copyPanelHeight - Math.round(preset.height * 0.05);

    const shapes: MainImageTemplateShapeBlueprint[] = [
        createShape('背景底板', 'background', 'rectangle', 0, 0, preset.width, preset.height, imageType === 'white-bg' ? '#FFFFFF' : '#F5F7FB', 0),
        createShape('产品主体占位', 'product-placeholder', 'rectangle', productX, productY, productWidth, productHeight, '#D9E7FF', 24),
        createShape('文案底板', 'copy-panel', 'rectangle', Math.round(preset.width * 0.07), copyPanelY, Math.round(preset.width * 0.86), copyPanelHeight, '#FFFFFF', 24),
        createShape('卖点徽章底板', 'badge-chip', 'ellipse', Math.round(preset.width * 0.07), Math.round(preset.height * 0.08), 92, 92, '#2F6BFF', 46)
    ];

    const copies: MainImageTemplateTextBlueprint[] = [
        createCopy('标题', 'title', `${productTheme}主视觉标题`, Math.round(preset.width * 0.12), copyPanelY + 26, density === 'minimal' ? 34 : 38),
        createCopy('副标题', 'subtitle', '一句简短的利益点说明，控制在一到两行内。', Math.round(preset.width * 0.12), copyPanelY + 78, density === 'rich' ? 22 : 20, 'left', '#4B5563'),
        createCopy('CTA', 'cta', imageType === 'conversion' ? '立即下单' : '点击查看', Math.round(preset.width * 0.7), copyPanelY + 110, 18, 'center', '#1D4ED8'),
        createCopy('卖点徽章', 'badge', '核心卖点', Math.round(preset.width * 0.07) + 18, Math.round(preset.height * 0.08) + 34, 16, 'left', '#FFFFFF')
    ];

    const documentName = `${productTheme}${resolveImageTypeLabel(imageType)}主图模板`;
    const groupName = 'MainImage_Template';

    return {
        sourceIntent: userIntent,
        productTheme,
        imageType,
        density,
        document: {
            name: documentName,
            width: preset.width,
            height: preset.height,
            resolution: DEFAULT_RESOLUTION,
            backgroundColor: imageType === 'white-bg' ? 'white' : 'transparent'
        },
        groupName,
        shapes,
        copies,
        summary: [
            `新建文档：${documentName}（${preset.width}x${preset.height}）`,
            `模板类型：${imageType}`,
            `模板密度：${density}`,
            `产品占位：${productWidth}x${productHeight}`,
            `文案位：${copies.length} 个，形状位：${shapes.length} 个`
        ]
    };
}

export function buildMainImageTemplateAuthoringSummary(blueprint: MainImageTemplateBlueprint): string[] {
    return [
        '**主图模板已创建**',
        '',
        `产品主题：${blueprint.productTheme}`,
        `模板类型：${blueprint.imageType}`,
        `文档尺寸：${blueprint.document.width} x ${blueprint.document.height} @ ${blueprint.document.resolution}dpi`,
        `形状位：${blueprint.shapes.length}`,
        `文案位：${blueprint.copies.length}`
    ];
}
