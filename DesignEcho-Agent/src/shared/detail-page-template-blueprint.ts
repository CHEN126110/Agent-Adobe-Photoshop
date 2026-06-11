import type { DetailScreenRole } from './detail-page-screen-plan';

export type DetailTemplateCopyRole = 'title' | 'subtitle' | 'body' | 'label';
export type DetailTemplateIconShape = 'ellipse' | 'rectangle';

export interface DetailTemplateDocumentBlueprint {
    name: string;
    width: number;
    height: number;
    resolution: number;
    backgroundColor: 'white' | 'black' | 'transparent';
}

export interface DetailTemplateCopyBlueprint {
    id: string;
    name: string;
    role: DetailTemplateCopyRole;
    content: string;
    x: number;
    y: number;
    fontSize: number;
    alignment?: 'left' | 'center' | 'right';
    colorHex?: string;
}

export interface DetailTemplateImageBlueprint {
    id: string;
    name: string;
    assetType: 'product' | 'detail' | 'scene' | 'material' | 'comparison';
    x: number;
    y: number;
    width: number;
    height: number;
    fillColorHex?: string;
    cornerRadius?: number;
}

export interface DetailTemplateIconBlueprint {
    id: string;
    name: string;
    shape: DetailTemplateIconShape;
    x: number;
    y: number;
    width: number;
    height: number;
    fillColorHex?: string;
}

export interface DetailTemplateScreenBlueprint {
    id: string;
    order: number;
    name: string;
    screenType: string;
    screenRole: DetailScreenRole;
    top: number;
    left: number;
    width: number;
    height: number;
    copies: DetailTemplateCopyBlueprint[];
    images: DetailTemplateImageBlueprint[];
    icons: DetailTemplateIconBlueprint[];
}

export interface DetailPageTemplateBlueprint {
    sourceIntent: string;
    productTheme: string;
    density: 'compact' | 'standard' | 'rich';
    confidence: number;
    document: DetailTemplateDocumentBlueprint;
    screens: DetailTemplateScreenBlueprint[];
    summary: string[];
}
