/**
 * 工具类型定义
 */

export interface ToolSchemaProperty {
    type: string;
    description: string;
    enum?: string[];
    items?: { type: string };  // 用于数组类型
    properties?: Record<string, ToolSchemaProperty>;  // 用于嵌套对象类型
}

export interface ToolSchema {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, ToolSchemaProperty>;
        required?: string[];
    };
}

export interface Tool {
    name: string;
    schema: ToolSchema;
    execute(params: any): Promise<any>;
}

/**
 * 文本图层信息
 */
export interface TextLayerInfo {
    id: number;
    name: string;
    contents: string;
    bounds: LayerBounds;
    style: TextStyle;
}

/**
 * 图层边界
 */
export interface LayerBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

/**
 * 文本样式
 */
export interface TextStyle {
    fontSize?: number;
    fontName?: string;
    fontStyle?: string;
    color?: { r: number; g: number; b: number };
    tracking?: number;       // 字间距
    leading?: number;        // 行高
    horizontalScale?: number;
    verticalScale?: number;
}

/**
 * 文档信息
 */
export interface DocumentInfo {
    id: number;
    name: string;
    width: number;
    height: number;
    resolution: number;
    colorMode: string;
    layerCount: number;
}

/**
 * 工具返回结果
 */
export interface ToolResult<T = any> {
    success: boolean;
    error?: string;
    data: T | null;
}