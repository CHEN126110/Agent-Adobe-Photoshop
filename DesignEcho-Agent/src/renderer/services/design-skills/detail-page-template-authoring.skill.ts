import type {
    DetailPageTemplateBlueprint,
    DetailTemplateCopyBlueprint,
    DetailTemplateIconBlueprint,
    DetailTemplateImageBlueprint,
    DetailTemplateScreenBlueprint
} from '../../../shared/detail-page-template-blueprint';
import { describeDetailScreenRole, type DetailScreenRole } from '../../../shared/detail-page-screen-plan';

const DOCUMENT_WIDTH = 790;
const DOCUMENT_RESOLUTION = 72;
const SCREEN_GAP = 40;
const PAGE_MARGIN = 40;

const ROLE_SCREEN_TYPE: Record<DetailScreenRole, string> = {
    hero: 'C_详情页首屏',
    'selling-point': 'A_营销信息',
    'material-proof': 'G_面料',
    'detail-proof': 'J_细节展示',
    scene: 'I_穿搭推荐',
    parameter: 'K_产品参数',
    closing: 'M_售后服务',
    unknown: 'CUSTOM_待确认'
};

const ROLE_DEFAULT_HEIGHT: Record<DetailScreenRole, number> = {
    hero: 880,
    'selling-point': 760,
    'material-proof': 760,
    'detail-proof': 760,
    scene: 760,
    parameter: 720,
    closing: 560,
    unknown: 720
};

function clampScreenCount(value: number | undefined): number {
    if (!Number.isFinite(value)) return 6;
    return Math.max(3, Math.min(10, Math.round(value as number)));
}

function extractRequestedScreenCount(input: string, explicitCount?: number): number {
    if (Number.isFinite(explicitCount)) return clampScreenCount(explicitCount);
    const match = String(input || '').match(/(\d+)\s*屏/);
    if (!match) return 6;
    return clampScreenCount(Number(match[1]));
}

function normalizeProductTheme(raw: string): string {
    const cleaned = String(raw || '')
        .replace(/[，。、“”"'：:；;！!？?（）()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || '产品';
}

function extractProductTheme(input: string, explicitTheme?: string): string {
    if (String(explicitTheme || '').trim()) return normalizeProductTheme(explicitTheme || '');

    const text = String(input || '');
    const patterns = [
        /(?:给|为|做|制作|设计|新建|创建)(.+?)(?:的)?详情页(?:模板|文档)?/i,
        /(.+?)(?:详情页模板|详情页文档|详情页)/i,
        /(?:关于|针对)(.+)$/i
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        const candidate = normalizeProductTheme(match?.[1] || '');
        if (candidate !== '产品') return candidate;
    }

    return '产品';
}

function inferDensity(input: string, explicitDensity?: string): 'compact' | 'standard' | 'rich' {
    const normalized = String(explicitDensity || input || '').toLowerCase();
    if (/精简|紧凑|compact/.test(normalized)) return 'compact';
    if (/丰富|完整|rich/.test(normalized)) return 'rich';
    return 'standard';
}

function pickScreenRoles(screenCount: number): DetailScreenRole[] {
    const presets: Record<number, DetailScreenRole[]> = {
        3: ['hero', 'selling-point', 'parameter'],
        4: ['hero', 'selling-point', 'detail-proof', 'parameter'],
        5: ['hero', 'selling-point', 'material-proof', 'detail-proof', 'parameter'],
        6: ['hero', 'selling-point', 'material-proof', 'detail-proof', 'scene', 'parameter'],
        7: ['hero', 'selling-point', 'material-proof', 'detail-proof', 'scene', 'parameter', 'closing']
    };
    if (presets[screenCount]) return presets[screenCount];

    const roles: DetailScreenRole[] = ['hero', 'selling-point', 'material-proof', 'detail-proof'];
    while (roles.length < screenCount - 2) {
        roles.push(roles.length % 2 === 0 ? 'selling-point' : 'detail-proof');
    }
    roles.push('parameter', 'closing');
    return roles.slice(0, screenCount);
}

function createCopy(
    screenId: string,
    name: string,
    role: DetailTemplateCopyBlueprint['role'],
    content: string,
    x: number,
    y: number,
    fontSize: number,
    alignment: 'left' | 'center' | 'right' = 'left',
    colorHex = '#1F2937'
): DetailTemplateCopyBlueprint {
    return { id: `${screenId}:${name}`, name, role, content, x, y, fontSize, alignment, colorHex };
}

function createImage(
    screenId: string,
    name: string,
    assetType: DetailTemplateImageBlueprint['assetType'],
    x: number,
    y: number,
    width: number,
    height: number,
    fillColorHex = '#D9E6FF',
    cornerRadius = 20
): DetailTemplateImageBlueprint {
    return { id: `${screenId}:${name}`, name, assetType, x, y, width, height, fillColorHex, cornerRadius };
}

function createIcon(
    screenId: string,
    name: string,
    shape: DetailTemplateIconBlueprint['shape'],
    x: number,
    y: number,
    width: number,
    height: number,
    fillColorHex = '#2F6BFF'
): DetailTemplateIconBlueprint {
    return { id: `${screenId}:${name}`, name, shape, x, y, width, height, fillColorHex };
}

function buildHeroScreen(screenId: string, top: number, productTheme: string): Pick<DetailTemplateScreenBlueprint, 'copies' | 'images' | 'icons'> {
    return {
        images: [createImage(screenId, '主图_产品图', 'product', PAGE_MARGIN, top + 60, DOCUMENT_WIDTH - PAGE_MARGIN * 2, 420, '#DDEBFF', 24)],
        copies: [
            createCopy(screenId, '标题', 'title', `${productTheme}核心卖点`, PAGE_MARGIN + 20, top + 540, 44),
            createCopy(screenId, '副标题', 'subtitle', '把第一眼感受、材质和调性放在同一屏建立起来', PAGE_MARGIN + 20, top + 608, 24, 'left', '#4B5563'),
            createCopy(screenId, '正文', 'body', '这里预留给品牌一句主张或首屏利益点说明', PAGE_MARGIN + 20, top + 662, 20, 'left', '#6B7280')
        ],
        icons: []
    };
}

function buildSellingPointScreen(screenId: string, top: number): Pick<DetailTemplateScreenBlueprint, 'copies' | 'images' | 'icons'> {
    return {
        images: [createImage(screenId, '卖点图_场景', 'scene', PAGE_MARGIN, top + 220, DOCUMENT_WIDTH - PAGE_MARGIN * 2, 360, '#E6EEFF', 20)],
        copies: [
            createCopy(screenId, '标题', 'title', '把可见特征翻译成用户能感受到的好处', PAGE_MARGIN, top + 56, 34),
            createCopy(screenId, '正文', 'body', '建议这一屏只讲 2-3 个重点，不要把所有信息堆在一起', PAGE_MARGIN, top + 118, 20, 'left', '#4B5563'),
            createCopy(screenId, '标签_1', 'label', '卖点 1', PAGE_MARGIN + 24, top + 182, 18, 'center', '#1D4ED8'),
            createCopy(screenId, '标签_2', 'label', '卖点 2', PAGE_MARGIN + 240, top + 182, 18, 'center', '#1D4ED8'),
            createCopy(screenId, '标签_3', 'label', '卖点 3', PAGE_MARGIN + 456, top + 182, 18, 'center', '#1D4ED8')
        ],
        icons: [
            createIcon(screenId, 'icon_1', 'ellipse', PAGE_MARGIN, top + 168, 32, 32),
            createIcon(screenId, 'icon_2', 'ellipse', PAGE_MARGIN + 216, top + 168, 32, 32),
            createIcon(screenId, 'icon_3', 'ellipse', PAGE_MARGIN + 432, top + 168, 32, 32)
        ]
    };
}

function buildMaterialScreen(screenId: string, top: number): Pick<DetailTemplateScreenBlueprint, 'copies' | 'images' | 'icons'> {
    return {
        images: [
            createImage(screenId, '面料图_细节', 'material', PAGE_MARGIN, top + 168, 300, 420, '#EAF3FF', 20),
            createImage(screenId, '材质图_细节_2', 'detail', PAGE_MARGIN + 340, top + 300, 210, 160, '#EAF3FF', 20)
        ],
        copies: [
            createCopy(screenId, '标题', 'title', '材质与触感说明屏', PAGE_MARGIN, top + 56, 34),
            createCopy(screenId, '副标题', 'subtitle', '让图片承担材质和纤维说明，而不是再重复讲卖点', PAGE_MARGIN, top + 114, 20, 'left', '#4B5563'),
            createCopy(screenId, '正文', 'body', '这里适合写材质来源、触感、亲肤感、透气感等说明型文案', PAGE_MARGIN + 340, top + 186, 20, 'left', '#6B7280')
        ],
        icons: []
    };
}

function buildDetailScreen(screenId: string, top: number): Pick<DetailTemplateScreenBlueprint, 'copies' | 'images' | 'icons'> {
    return {
        images: [
            createImage(screenId, '细节图_1', 'detail', PAGE_MARGIN, top + 190, 320, 260, '#F1F5FF', 20),
            createImage(screenId, '细节图_2', 'detail', PAGE_MARGIN + 350, top + 190, 320, 260, '#F1F5FF', 20)
        ],
        copies: [
            createCopy(screenId, '标题', 'title', '细节和工艺说明', PAGE_MARGIN, top + 56, 34),
            createCopy(screenId, '正文', 'body', '这一屏适合承接局部特写、工艺细节、边缘处理、版型和做工说明', PAGE_MARGIN, top + 118, 20, 'left', '#4B5563'),
            createCopy(screenId, '标签_1', 'label', '细节标签 A', PAGE_MARGIN, top + 484, 18),
            createCopy(screenId, '标签_2', 'label', '细节标签 B', PAGE_MARGIN + 350, top + 484, 18)
        ],
        icons: []
    };
}

function buildSceneScreen(screenId: string, top: number): Pick<DetailTemplateScreenBlueprint, 'copies' | 'images' | 'icons'> {
    return {
        images: [createImage(screenId, '场景图_模特', 'scene', PAGE_MARGIN, top + 150, DOCUMENT_WIDTH - PAGE_MARGIN * 2, 420, '#E8F0FF', 20)],
        copies: [
            createCopy(screenId, '标题', 'title', '场景表达与使用感', PAGE_MARGIN, top + 56, 34),
            createCopy(screenId, '正文', 'body', '适合承接穿搭、上身状态、氛围感和生活场景，让用户更容易代入', PAGE_MARGIN, top + 112, 20, 'left', '#4B5563')
        ],
        icons: []
    };
}

function buildParameterScreen(screenId: string, top: number): Pick<DetailTemplateScreenBlueprint, 'copies' | 'images' | 'icons'> {
    return {
        images: [createImage(screenId, '参数图_产品', 'comparison', PAGE_MARGIN + 430, top + 160, 280, 360, '#EEF4FF', 20)],
        copies: [
            createCopy(screenId, '标题', 'title', '参数与信息说明', PAGE_MARGIN, top + 56, 34),
            createCopy(screenId, '标签_1', 'label', '参数项 1', PAGE_MARGIN, top + 160, 18),
            createCopy(screenId, '正文_1', 'body', '在这里放材质、尺码、规格、适用季节等信息', PAGE_MARGIN, top + 196, 18, 'left', '#4B5563'),
            createCopy(screenId, '标签_2', 'label', '参数项 2', PAGE_MARGIN, top + 278, 18),
            createCopy(screenId, '正文_2', 'body', '参数文案要直接、克制，不要写成营销口号', PAGE_MARGIN, top + 314, 18, 'left', '#4B5563')
        ],
        icons: []
    };
}

function buildClosingScreen(screenId: string, top: number): Pick<DetailTemplateScreenBlueprint, 'copies' | 'images' | 'icons'> {
    return {
        images: [],
        copies: [
            createCopy(screenId, '标题', 'title', '收尾与服务说明', PAGE_MARGIN, top + 56, 32),
            createCopy(screenId, '正文', 'body', '这一屏适合承接服务说明、购买安心感、品牌信任收口', PAGE_MARGIN, top + 112, 20, 'left', '#4B5563'),
            createCopy(screenId, '标签_1', 'label', '服务 1', PAGE_MARGIN + 4, top + 244, 18),
            createCopy(screenId, '标签_2', 'label', '服务 2', PAGE_MARGIN + 236, top + 244, 18),
            createCopy(screenId, '标签_3', 'label', '服务 3', PAGE_MARGIN + 468, top + 244, 18)
        ],
        icons: [
            createIcon(screenId, 'icon_1', 'ellipse', PAGE_MARGIN, top + 196, 28, 28),
            createIcon(screenId, 'icon_2', 'ellipse', PAGE_MARGIN + 232, top + 196, 28, 28),
            createIcon(screenId, 'icon_3', 'ellipse', PAGE_MARGIN + 464, top + 196, 28, 28)
        ]
    };
}

function buildScreenContent(role: DetailScreenRole, screenId: string, top: number, productTheme: string) {
    switch (role) {
        case 'hero': return buildHeroScreen(screenId, top, productTheme);
        case 'selling-point': return buildSellingPointScreen(screenId, top);
        case 'material-proof': return buildMaterialScreen(screenId, top);
        case 'detail-proof': return buildDetailScreen(screenId, top);
        case 'scene': return buildSceneScreen(screenId, top);
        case 'parameter': return buildParameterScreen(screenId, top);
        case 'closing': return buildClosingScreen(screenId, top);
        default: return buildSellingPointScreen(screenId, top);
    }
}

function buildScreenBlueprint(params: {
    role: DetailScreenRole;
    order: number;
    top: number;
    productTheme: string;
}): DetailTemplateScreenBlueprint {
    const { role, order, top, productTheme } = params;
    const screenId = `screen-${order + 1}`;
    const screenType = ROLE_SCREEN_TYPE[role] || ROLE_SCREEN_TYPE.unknown;
    const height = ROLE_DEFAULT_HEIGHT[role] || ROLE_DEFAULT_HEIGHT.unknown;
    const name = `${String(order + 1).padStart(2, '0')}_${screenType}`;
    const content = buildScreenContent(role, screenId, top, productTheme);
    return {
        id: screenId,
        order,
        name,
        screenType,
        screenRole: role,
        top,
        left: 0,
        width: DOCUMENT_WIDTH,
        height,
        copies: content.copies,
        images: content.images,
        icons: content.icons
    };
}

export function buildDetailPageTemplateBlueprint(params: {
    userIntent?: string;
    productTheme?: string;
    screenCount?: number;
    density?: 'compact' | 'standard' | 'rich';
    width?: number;
}): DetailPageTemplateBlueprint {
    const userIntent = String(params.userIntent || '').trim();
    const screenCount = extractRequestedScreenCount(userIntent, params.screenCount);
    const productTheme = extractProductTheme(userIntent, params.productTheme);
    const density = inferDensity(userIntent, params.density);
    const roles = pickScreenRoles(screenCount);

    let top = 0;
    const screens = roles.map((role, index) => {
        const screen = buildScreenBlueprint({ role, order: index, top, productTheme });
        top += screen.height + SCREEN_GAP;
        return screen;
    });

    const documentWidth = Number.isFinite(params.width) ? Math.max(600, Math.round(params.width as number)) : DOCUMENT_WIDTH;
    const documentHeight = Math.max(2200, top - SCREEN_GAP + 80);
    const documentName = `${productTheme}详情页模板`;

    return {
        sourceIntent: userIntent,
        productTheme,
        density,
        confidence: userIntent ? 0.7 : 0.55,
        document: {
            name: documentName,
            width: documentWidth,
            height: documentHeight,
            resolution: DOCUMENT_RESOLUTION,
            backgroundColor: 'white'
        },
        screens,
        summary: [
            `新建文档：${documentName}（${documentWidth}x${documentHeight}）`,
            `模板屏数：${screens.length} 屏`,
            ...screens.map((screen) => `${screen.order + 1}. ${describeDetailScreenRole(screen.screenRole)} / ${screen.name}`)
        ]
    };
}

export function buildDetailPageTemplateAuthoringSummary(blueprint: DetailPageTemplateBlueprint): string[] {
    const lines = [
        '**详情页模板已创建**',
        '',
        `产品主题：${blueprint.productTheme}`,
        `文档尺寸：${blueprint.document.width} x ${blueprint.document.height} @ ${blueprint.document.resolution}dpi`,
        `屏数：${blueprint.screens.length}`,
        ''
    ];

    lines.push(...blueprint.screens.map((screen) => {
        return `${screen.order + 1}. ${describeDetailScreenRole(screen.screenRole)} | 图片位 ${screen.images.length} | 文案位 ${screen.copies.length} | 图标位 ${screen.icons.length}`;
    }));

    return lines;
}
