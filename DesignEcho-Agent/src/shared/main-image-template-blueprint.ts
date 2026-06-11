export type MainImageTemplateTextRole = 'title' | 'subtitle' | 'badge' | 'cta';
export type MainImageTemplateShapeRole = 'background' | 'product-placeholder' | 'badge-chip' | 'copy-panel';
export type MainImageTemplateShapeType = 'rectangle' | 'ellipse';

export interface MainImageTemplateDocumentBlueprint {
    name: string;
    width: number;
    height: number;
    resolution: number;
    backgroundColor: 'white' | 'black' | 'transparent';
}

export interface MainImageTemplateShapeBlueprint {
    id: string;
    name: string;
    role: MainImageTemplateShapeRole;
    shape: MainImageTemplateShapeType;
    x: number;
    y: number;
    width: number;
    height: number;
    fillColorHex?: string;
    cornerRadius?: number;
}

export interface MainImageTemplateTextBlueprint {
    id: string;
    name: string;
    role: MainImageTemplateTextRole;
    content: string;
    x: number;
    y: number;
    fontSize: number;
    alignment?: 'left' | 'center' | 'right';
    colorHex?: string;
}

export interface MainImageTemplateBlueprint {
    sourceIntent: string;
    productTheme: string;
    imageType: 'click' | 'conversion' | 'white-bg';
    density: 'minimal' | 'standard' | 'rich';
    document: MainImageTemplateDocumentBlueprint;
    groupName: string;
    shapes: MainImageTemplateShapeBlueprint[];
    copies: MainImageTemplateTextBlueprint[];
    summary: string[];
}
