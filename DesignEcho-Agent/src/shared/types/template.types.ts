/**
 * 模板知识库类型定义
 * 
 * 用于存储 SKU 模板、详情页模板等设计资源
 * 支持 PSD、TIF、PSB 格式
 */

/**
 * 模板类型
 */
export type TemplateType = 'sku' | 'detail-page' | 'banner' | 'main-image' | 'other';

/**
 * 模板文件格式
 */
export type TemplateFormat = 'psd' | 'tif' | 'psb';

/**
 * 模板规格信息
 */
export interface TemplateSpecs {
    /** 宽度（像素） */
    width: number;
    /** 高度（像素） */
    height: number;
    /** 颜色模式 */
    colorMode?: 'RGB' | 'CMYK' | 'Grayscale';
    /** DPI */
    resolution?: number;
}

/**
 * 模板元数据 - 供 AI 理解模板结构
 */
export interface TemplateMetadata {
    /** SKU 规格（如 2双装、3双装） */
    comboSize?: number;
    /** 产品类目（如 袜子、内衣） */
    category?: string;
    /** 占位图层名称列表 */
    placeholderLayers?: string[];
    /** 文字图层名称列表 */
    textLayers?: string[];
    /** 背景图层名称 */
    backgroundLayer?: string;
    /** 图层组结构描述 */
    layerStructure?: string;
    /** 适用平台（如 淘宝、京东、拼多多） */
    platforms?: string[];
    /** 适用场景（如 日常、促销、节日） */
    scenes?: string[];
    /** 原始来源文件路径（用于追溯） */
    sourcePath?: string;
    /** 来源文档名称（例如 Photoshop 文档名） */
    sourceDocumentName?: string;
}

/**
 * 模板资源
 */
export interface TemplateAsset {
    /** 唯一 ID */
    id: string;
    /** 模板名称 */
    name: string;
    /** 模板类型 */
    type: TemplateType;
    /** 模板文件路径 */
    filePath: string;
    /** 文件格式 */
    fileFormat: TemplateFormat;
    /** 缩略图（Base64） */
    thumbnail?: string;
    /** 模板描述 - 供 AI 理解模板用途 */
    description: string;
    /** AI 使用提示 - 指导 AI 如何使用此模板 */
    aiPrompt?: string;
    /** 模板规格 */
    specs?: TemplateSpecs;
    /** 模板元数据 */
    metadata?: TemplateMetadata;
    /** 标签 */
    tags?: string[];
    /** 来源 */
    source?: 'user' | 'system' | 'import';
    /** 创建时间 */
    createdAt: number;
    /** 更新时间 */
    updatedAt: number;
}

/**
 * 模板知识库
 */
export interface TemplateKnowledge {
    /** 知识库 ID */
    id: string;
    /** 知识库名称 */
    name: string;
    /** 模板列表 */
    templates: TemplateAsset[];
    /** 创建时间 */
    createdAt: number;
    /** 更新时间 */
    updatedAt: number;
}

/**
 * 模板查询参数
 */
export interface TemplateQuery {
    /** 按类型筛选 */
    type?: TemplateType;
    /** 按标签筛选 */
    tags?: string[];
    /** 按类目筛选 */
    category?: string;
    /** 按规格筛选（如 2双装） */
    comboSize?: number;
    /** 搜索关键词 */
    keyword?: string;
}

/**
 * 模板添加参数
 */
export interface AddTemplateParams {
    name: string;
    type: TemplateType;
    filePath: string;
    description: string;
    aiPrompt?: string;
    metadata?: TemplateMetadata;
    tags?: string[];
}

/**
 * 模板更新参数
 */
export interface UpdateTemplateParams {
    id: string;
    name?: string;
    description?: string;
    aiPrompt?: string;
    metadata?: TemplateMetadata;
    tags?: string[];
}

/**
 * 从 Photoshop 文档解析模板源文件参数
 */
export interface ResolvePhotoshopTemplateFileParams {
    documentName: string;
    documentPath?: string;
    currentProjectPath?: string;
}

/**
 * 从 Photoshop 文档添加模板参数
 */
export interface AddTemplateFromPhotoshopParams extends ResolvePhotoshopTemplateFileParams {
    type: TemplateType;
    description?: string;
    aiPrompt?: string;
    metadata?: TemplateMetadata;
    tags?: string[];
}

/**
 * 模板解析设置（用于 SKU 自动找模板）
 * 查找顺序固定：项目模板目录 -> 本地模板库
 */
export interface TemplateResolverSettings {
    /** 用户配置的本地模板库目录列表 */
    localLibraryDirs: string[];
}

/**
 * SKU 模板候选来源
 */
export type SKUTemplateSource = 'local-library' | 'knowledge-library';

/**
 * SKU 模板候选（供 Agent 查找模板）
 */
export interface SKUTemplateCandidate {
    id: string;
    name: string;
    filePath: string;
    description?: string;
    metadata?: {
        comboSize?: number;
    };
    source: SKUTemplateSource;
    /** 越小优先级越高 */
    sourcePriority: number;
}

/**
 * SKU 模板查询参数
 */
export interface FindSKUTemplateParams {
    comboSize: number;
    keyword?: string;
    noteMode?: boolean;
    /** 可选：限制候选来源，默认不限制 */
    sources?: SKUTemplateSource[];
}

/**
 * 获取可用 SKU 规格参数
 */
export interface GetAvailableSKUSpecsParams {
    /** 可选：限制候选来源，默认不限制 */
    sources?: SKUTemplateSource[];
}
