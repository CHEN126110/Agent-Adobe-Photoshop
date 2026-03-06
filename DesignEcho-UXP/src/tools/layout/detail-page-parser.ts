/**
 * Detail page template parser for UXP side.
 * Parses top-level screens and placeholder layers for the Agent pipeline.
 */

import { app } from 'photoshop';

interface BoundingBox {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

type AssetType = 'product' | 'model' | 'detail' | 'scene' | 'icon';
type LayerZone = 'copy' | 'icon' | 'image' | 'unknown';
type ScreenType = string;

interface ScreenTypeConfig {
    type: ScreenType;
    namePatterns: RegExp[];
    keywords: string[];
    recommendedAssetType: AssetType;
}

interface CopyPlaceholder {
    layerId: number;
    layerName: string;
    currentText: string;
    bounds: BoundingBox;
    role: 'title' | 'subtitle' | 'body' | 'label' | 'unknown';
    fontSize: number;
    fontFamily?: string;
    maxWidth?: number;
    zone?: LayerZone;
}

interface ImagePlaceholder {
    layerId: number;
    layerName: string;
    baseLayerId?: number;
    baseLayerName?: string;
    bounds: BoundingBox;
    isClippingMask: boolean;
    clippingInfo?: {
        isClipped: boolean;
        baseLayerId: number;
        baseBounds: BoundingBox;
    };
    recommendedAssetType: AssetType;
    aspectRatio: number;
    zone?: LayerZone;
}

interface IconPlaceholder {
    layerId: number;
    layerName: string;
    bounds: BoundingBox;
    size: { width: number; height: number };
    isVector: boolean;
    zone?: LayerZone;
}

interface ParsedScreen {
    id: number;
    name: string;
    type: ScreenType;
    typeConfidence: number;
    index: number;
    bounds: BoundingBox;
    visible: boolean;
    copyPlaceholders: CopyPlaceholder[];
    imagePlaceholders: ImagePlaceholder[];
    iconPlaceholders: IconPlaceholder[];
    structure?: {
        hasCopyGroup: boolean;
        hasIconGroup: boolean;
        hasImageGroup: boolean;
        missingGroups: Array<'文案' | 'icon' | '图片'>;
        recognizedGroups: string[];
    };
}

interface LayerIssue {
    type: string;
    severity: 'critical' | 'warning' | 'info';
    layerId: number;
    layerName: string;
    screenIndex?: number;
    description: string;
    autoFixable: boolean;
    suggestedFix?: string;
    fixParams?: Record<string, any>;
}

interface TemplateParseResult {
    success: boolean;
    documentName: string;
    documentSize: { width: number; height: number };
    screenCount: number;
    screens: ParsedScreen[];
    issues: LayerIssue[];
    parseTime: number;
}

const ICON_SIZE_THRESHOLD = 120;

const SCREEN_TYPE_CONFIGS: ScreenTypeConfig[] = [
    { type: 'A_营销信息', namePatterns: [/营销/i, /活动/i, /优惠/i, /促销/i], keywords: ['营销', '活动', '优惠'], recommendedAssetType: 'scene' },
    { type: 'B_信任状', namePatterns: [/信任/i, /背书/i, /品牌/i, /认证/i, /品牌背书/i], keywords: ['品牌', '认证', '资质', '背书'], recommendedAssetType: 'icon' },
    { type: 'C_详情页首屏', namePatterns: [/首屏/i, /hero/i, /主视觉/i, /核心/i, /卖点/i], keywords: ['首屏', '卖点', '核心'], recommendedAssetType: 'product' },
    { type: 'D_图标icon', namePatterns: [/icon/i, /图标/i, /图标卖点/i], keywords: ['icon', '图标', '辅助'], recommendedAssetType: 'icon' },
    { type: 'E_KV图_调性', namePatterns: [/kv/i, /氛围/i, /banner/i, /调性/i], keywords: ['kv', '氛围', '调性'], recommendedAssetType: 'scene' },
    { type: 'F_颜色款式展示', namePatterns: [/颜色/i, /款式/i, /color/i], keywords: ['颜色', '款式'], recommendedAssetType: 'product' },
    { type: 'G_面料', namePatterns: [/面料/i, /材质/i, /fabric/i, /材质面料/i], keywords: ['面料', '材质', '纤维'], recommendedAssetType: 'detail' },
    { type: 'H_解决痛点', namePatterns: [/痛点/i, /问题/i, /解决/i], keywords: ['痛点', '解决'], recommendedAssetType: 'detail' },
    { type: 'I_穿搭推荐', namePatterns: [/穿搭/i, /搭配/i, /outfit/i], keywords: ['穿搭', '搭配'], recommendedAssetType: 'model' },
    { type: 'J_细节展示', namePatterns: [/细节/i, /工艺/i, /detail/i], keywords: ['细节', '工艺'], recommendedAssetType: 'detail' },
    { type: 'K_产品参数', namePatterns: [/参数/i, /规格/i, /尺码/i, /信息表/i], keywords: ['参数', '规格', '数据'], recommendedAssetType: 'product' },
    { type: 'L_模特实拍', namePatterns: [/模特/i, /实拍/i, /model/i], keywords: ['模特', '实拍'], recommendedAssetType: 'model' },
    { type: 'M_售后服务', namePatterns: [/售后/i, /服务/i, /保障/i], keywords: ['售后', '服务'], recommendedAssetType: 'icon' }
];

function toNumber(v: any): number {
    if (typeof v === 'number') return v;
    if (typeof v?.value === 'number') return v.value;
    if (typeof v?._value === 'number') return v._value;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function normalizeKind(kind: any): string {
    return String(kind || '').toLowerCase();
}

function isGroup(layer: any): boolean {
    const kind = normalizeKind(layer?.kind);
    return kind.includes('group') || Array.isArray(layer?.layers);
}

function isTextLayer(layer: any): boolean {
    return normalizeKind(layer?.kind).includes('text');
}

function isVectorLike(layer: any): boolean {
    const kind = normalizeKind(layer?.kind);
    return kind.includes('vector') || kind.includes('shape');
}

function isImageLike(layer: any): boolean {
    const kind = normalizeKind(layer?.kind);
    return kind.includes('pixel') || kind.includes('smart') || kind.includes('normal') || kind.includes('layer');
}

function getRoleByName(layerName: string): CopyPlaceholder['role'] {
    const name = layerName.toLowerCase();
    if (/副标题|subtitle/.test(name)) return 'subtitle';
    if (/标题|title/.test(name)) return 'title';
    if (/正文|描述|卖点|detail|body/.test(name)) return 'body';
    if (/标签|价格|price|label/.test(name)) return 'label';
    return 'unknown';
}

function resolveZone(layerName: string, parentZone: LayerZone): LayerZone {
    const name = String(layerName || '').toLowerCase();
    if (/文案|text|copy|title|subtitle/.test(name)) return 'copy';
    if (/icon|图标|装饰|element|辅助/.test(name)) return 'icon';
    if (/图片|image|photo|product|主图|素材|背景|kv/.test(name)) return 'image';
    return parentZone;
}

export class DetailPageParser {
    async parse(): Promise<TemplateParseResult> {
        const startTime = Date.now();
        const doc = app.activeDocument;

        if (!doc) {
            return {
                success: false,
                documentName: '',
                documentSize: { width: 0, height: 0 },
                screenCount: 0,
                screens: [],
                issues: [],
                parseTime: 0
            };
        }

        const screens: ParsedScreen[] = [];
        const issues: LayerIssue[] = [];
        let screenIndex = 0;

        for (const layer of doc.layers || []) {
            if (!isGroup(layer)) continue;
            try {
                const screen = this.parseScreen(layer, screenIndex);
                screens.push(screen);
                screenIndex += 1;
            } catch (error: any) {
                issues.push({
                    type: 'invalid_structure',
                    severity: 'warning',
                    layerId: Number(layer?.id || 0),
                    layerName: String(layer?.name || 'unknown'),
                    screenIndex,
                    description: `parse failed: ${error?.message || 'unknown error'}`,
                    autoFixable: false
                });
            }
        }

        return {
            success: true,
            documentName: String(doc.name || ''),
            documentSize: { width: toNumber(doc.width), height: toNumber(doc.height) },
            screenCount: screens.length,
            screens,
            issues,
            parseTime: Date.now() - startTime
        };
    }

    private parseScreen(groupLayer: any, index: number): ParsedScreen {
        const copyPlaceholders: CopyPlaceholder[] = [];
        const imagePlaceholders: ImagePlaceholder[] = [];
        const iconPlaceholders: IconPlaceholder[] = [];

        const directChildren = Array.isArray(groupLayer.layers) ? groupLayer.layers : [];
        const structure = this.analyzeScreenGroups(directChildren);

        this.traverseLayers(directChildren, {
            parentZone: 'unknown',
            onTextLayer: (layer: any, zone: LayerZone) => {
                copyPlaceholders.push(this.parseTextLayer(layer, zone));
            },
            onClippingBase: (baseLayer: any, clippedLayer: any, zone: LayerZone) => {
                imagePlaceholders.push(this.parseImagePlaceholder(clippedLayer, baseLayer, zone));
            },
            onSmallShape: (layer: any, zone: LayerZone) => {
                iconPlaceholders.push(this.parseIconPlaceholder(layer, zone));
            },
            onImageLayer: (layer: any, zone: LayerZone) => {
                imagePlaceholders.push(this.parseImagePlaceholder(layer, null, zone));
            }
        });

        const guessed = this.guessScreenType(groupLayer.name || '', copyPlaceholders, imagePlaceholders, iconPlaceholders);

        return {
            id: Number(groupLayer.id || 0),
            name: String(groupLayer.name || `Screen_${index + 1}`),
            type: guessed.type,
            typeConfidence: guessed.confidence,
            index,
            bounds: this.getBounds(groupLayer),
            visible: groupLayer.visible !== false,
            copyPlaceholders,
            imagePlaceholders,
            iconPlaceholders,
            structure
        };
    }

    private analyzeScreenGroups(layers: any[]): ParsedScreen['structure'] {
        const directGroups = (layers || [])
            .filter((layer) => isGroup(layer));
        const names = directGroups
            .map((layer) => String(layer?.name || ''));

        const hasCopyGroup = names.some((name) => /文案|text|copy|title|subtitle/i.test(name));
        const hasIconGroup = names.some((name) => /icon|图标|辅助|element/i.test(name));
        const hasImageGroup = names.some((name) => /图片|image|photo|主图|素材|kv|背景/i.test(name));

        const missingGroups: Array<'文案' | 'icon' | '图片'> = [];
        if (!hasCopyGroup) missingGroups.push('文案');
        if (!hasIconGroup) missingGroups.push('icon');
        if (!hasImageGroup) missingGroups.push('图片');

        return {
            hasCopyGroup,
            hasIconGroup,
            hasImageGroup,
            missingGroups,
            recognizedGroups: names
        };
    }

    private traverseLayers(
        layers: any[],
        handlers: {
            parentZone: LayerZone;
            onTextLayer: (layer: any, zone: LayerZone) => void;
            onClippingBase: (baseLayer: any, clippedLayer: any, zone: LayerZone) => void;
            onSmallShape: (layer: any, zone: LayerZone) => void;
            onImageLayer: (layer: any, zone: LayerZone) => void;
        }
    ): void {
        for (let i = 0; i < (layers || []).length; i++) {
            const layer = layers[i];
            const currentZone = resolveZone(String(layer?.name || ''), handlers.parentZone);

            if (isGroup(layer)) {
                this.traverseLayers(layer.layers || [], { ...handlers, parentZone: currentZone });
                continue;
            }

            if (isTextLayer(layer)) {
                handlers.onTextLayer(layer, currentZone);
                continue;
            }

            if (isVectorLike(layer) && this.isSmallShape(layer)) {
                handlers.onSmallShape(layer, currentZone);
                continue;
            }

            if (isImageLike(layer)) {
                if (layer.clipped) {
                    const baseLayer = this.findClippingBase(layers, i);
                    if (baseLayer) {
                        handlers.onClippingBase(baseLayer, layer, currentZone);
                        continue;
                    }
                }
                handlers.onImageLayer(layer, currentZone);
            }
        }
    }

    private findClippingBase(layers: any[], clippedIndex: number): any | null {
        for (let i = clippedIndex + 1; i < layers.length; i++) {
            const candidate = layers[i];
            if (!candidate?.clipped) {
                return candidate;
            }
        }
        return null;
    }

    private parseTextLayer(layer: any, zone: LayerZone): CopyPlaceholder {
        const bounds = this.getBounds(layer);
        const text = String(layer?.textItem?.contents || layer?.text || layer?.name || '').trim();
        const fontSize = toNumber(layer?.textItem?.characterStyle?.size) || 16;
        const fontFamily = String(layer?.textItem?.characterStyle?.font || '').trim() || undefined;

        return {
            layerId: Number(layer?.id || 0),
            layerName: String(layer?.name || 'Text'),
            currentText: text,
            bounds,
            role: getRoleByName(String(layer?.name || '')),
            fontSize,
            fontFamily,
            maxWidth: bounds.width,
            zone
        };
    }

    private parseImagePlaceholder(layer: any, baseLayer: any | null, zone: LayerZone): ImagePlaceholder {
        const bounds = this.getBounds(layer);
        const aspectRatio = bounds.height > 0 ? bounds.width / bounds.height : 1;
        const recommended = this.recommendAssetType(layer.name || '', zone);

        const baseBounds = baseLayer ? this.getBounds(baseLayer) : undefined;

        return {
            layerId: Number(layer?.id || 0),
            layerName: String(layer?.name || 'Image'),
            baseLayerId: baseLayer ? Number(baseLayer.id || 0) : undefined,
            baseLayerName: baseLayer ? String(baseLayer.name || '') : undefined,
            bounds,
            isClippingMask: !!layer?.clipped,
            clippingInfo: layer?.clipped && baseLayer
                ? {
                    isClipped: true,
                    baseLayerId: Number(baseLayer.id || 0),
                    baseBounds: baseBounds || bounds
                }
                : undefined,
            recommendedAssetType: recommended,
            aspectRatio,
            zone
        };
    }

    private parseIconPlaceholder(layer: any, zone: LayerZone): IconPlaceholder {
        const bounds = this.getBounds(layer);
        return {
            layerId: Number(layer?.id || 0),
            layerName: String(layer?.name || 'Icon'),
            bounds,
            size: { width: bounds.width, height: bounds.height },
            isVector: true,
            zone
        };
    }

    private recommendAssetType(layerName: string, zone: LayerZone): AssetType {
        const name = String(layerName || '').toLowerCase();
        if (zone === 'icon' || /icon|图标/.test(name)) return 'icon';
        if (/model|模特/.test(name)) return 'model';
        if (/detail|细节|close/.test(name)) return 'detail';
        if (/scene|场景|背景|kv/.test(name)) return 'scene';
        return 'product';
    }

    private guessScreenType(
        groupName: string,
        copies: CopyPlaceholder[],
        images: ImagePlaceholder[],
        icons: IconPlaceholder[]
    ): { type: ScreenType; confidence: number } {
        const lowerName = String(groupName || '').toLowerCase();
        const scored = SCREEN_TYPE_CONFIGS.map((cfg) => {
            let score = 0;

            for (const re of cfg.namePatterns) {
                if (re.test(lowerName)) score += 50;
            }
            for (const kw of cfg.keywords) {
                if (lowerName.includes(kw.toLowerCase())) score += 15;
            }
            if (cfg.recommendedAssetType === 'icon' && icons.length > images.length) score += 20;
            if (cfg.recommendedAssetType === 'scene' && images.length > 0 && copies.length <= 2) score += 10;

            return { type: cfg.type, score };
        }).sort((a, b) => b.score - a.score);

        const top = scored[0];
        if (!top || top.score <= 0) {
            return { type: 'CUSTOM', confidence: 0.4 };
        }

        return {
            type: top.type,
            confidence: Math.min(0.98, Math.max(0.5, top.score / 100))
        };
    }

    private isSmallShape(layer: any): boolean {
        if (!isVectorLike(layer)) return false;
        const bounds = this.getBounds(layer);
        return bounds.width <= ICON_SIZE_THRESHOLD && bounds.height <= ICON_SIZE_THRESHOLD;
    }

    private getBounds(layer: any): BoundingBox {
        const b = layer?.bounds || {};
        const left = toNumber(b.left);
        const top = toNumber(b.top);
        const right = toNumber(b.right);
        const bottom = toNumber(b.bottom);
        return {
            left,
            top,
            right,
            bottom,
            width: Math.max(0, right - left),
            height: Math.max(0, bottom - top)
        };
    }
}

export class DetailPageParserTool {
    name = 'parseDetailPageTemplate';

    schema = {
        name: 'parseDetailPageTemplate',
        description: 'Parse detail page template into screen and placeholder structure.',
        parameters: {
            type: 'object' as const,
            properties: {
                includeStructure: {
                    type: 'boolean',
                    description: 'Whether to include structure analysis result for each screen.'
                }
            },
            required: [] as string[]
        }
    };

    async execute(_params: { includeStructure?: boolean }): Promise<TemplateParseResult> {
        const parser = new DetailPageParser();
        return parser.parse();
    }
}
