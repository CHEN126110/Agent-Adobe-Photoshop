/**
 * RAG 知识库系统类型定义
 */

// ==================== 知识条目类型 ====================

export type KnowledgeType =
    | 'selling_point'
    | 'pain_point'
    | 'color_scheme'
    | 'technique'
    | 'case'
    | 'copy_template'
    | 'main_image_spec'
    | 'detail_screen_template'
    | 'layout_rule'
    | 'scene_styling'
    | 'brand_guideline';
export type KnowledgeSource = 'system' | 'user' | 'learned' | 'import' | 'uxp';

/**
 * 知识条目 - 向量化存储的基本单位
 */
export interface KnowledgeEntry {
    id: string;
    type: KnowledgeType;
    
    // 文本内容 (用于向量化)
    text: string;
    title: string;
    description?: string;
    
    // 元数据 (用于过滤和展示)
    metadata: KnowledgeMetadata;
}

/**
 * 知识元数据
 */
export interface KnowledgeMetadata {
    source: KnowledgeSource;
    categories: string[];
    keywords: string[];
    priority: number;
    createdAt: string;
    updatedAt?: string;
    usageCount: number;
    
    // 类型特定元数据
    extra?: Record<string, any>;
}

/**
 * 向量化的知识条目 (存储在向量数据库中)
 */
export interface VectorizedKnowledge extends KnowledgeEntry {
    embedding: Float32Array;
    visualEmbedding?: Float32Array;
    layoutEmbedding?: Float32Array;
    embeddingModel: string;
    vectorizedAt: string;
}

// ==================== 设计师档案类型 ====================

/**
 * 设计师个人档案
 */
export interface DesignerProfile {
    designerId: string;
    name: string;
    avatar?: string;
    createdAt: string;
    updatedAt: string;
    
    // 设计风格偏好
    stylePreferences: StylePreferences;
    
    // 工作流偏好
    workflowPreferences: WorkflowPreferences;
    
    // UI 视觉偏好
    uiPreferences: UIPreferences;
    
    // 检索偏好
    retrievalPreferences: RetrievalPreferences;
    
    // 学习数据 (自动积累)
    learningData: LearningData;
}

/**
 * 设计风格偏好
 */
export interface StylePreferences {
    preferredStyles: string[];          // 极简、复古、现代、轻奢...
    colorTendency: 'warm' | 'cool' | 'neutral' | 'mixed';
    designPrinciples: string[];         // 设计原则描述
    favoriteColorSchemes: string[];     // 收藏的配色方案 ID
}

/**
 * 工作流偏好
 */
export interface WorkflowPreferences {
    defaultTechnique: 'TPS' | 'MLS' | 'ARAP';
    autoCorrection: boolean;
    batchProcessing: boolean;
    previewMode: '2D' | '3D' | 'split';
    confirmBeforeApply: boolean;
    autoSave: boolean;
}

/**
 * UI 视觉偏好
 */
export interface UIPreferences {
    theme: 'dark' | 'light' | 'auto';
    layoutMode: 'grid' | 'list' | 'compact';
    infoDensity: 'dense' | 'normal' | 'spacious';
    primaryColor?: string;
    fontSize: 'small' | 'medium' | 'large';
    showTips: boolean;
}

/**
 * 检索偏好
 */
export interface RetrievalPreferences {
    preferredCategories: string[];      // 优先检索的类目
    keywordBoosts: Record<string, number>; // 关键词权重提升
    excludedTopics: string[];           // 排除的主题
    semanticWeight: number;             // 语义权重 (0-1)
    resultLimit: number;                // 默认返回结果数
}

/**
 * 学习数据 (系统自动积累)
 */
export interface LearningData {
    frequentSearches: Array<{
        query: string;
        count: number;
        lastSearched: string;
    }>;
    
    clickedResults: Array<{
        knowledgeId: string;
        count: number;
        lastClicked: string;
    }>;
    
    createdKnowledge: string[];         // 用户创建的知识 ID
    appliedKnowledge: string[];         // 用户应用过的知识 ID
    
    sessionStats: {
        totalSessions: number;
        avgSessionDuration: number;
        lastSessionAt: string;
    };
}

// ==================== 检索结果类型 ====================

/**
 * RAG 检索结果
 */
export interface RAGSearchResult {
    entries: ScoredKnowledgeEntry[];
    
    // 检索元数据
    metadata: SearchMetadata;
    
    // 生成的上下文 (注入到 Prompt)
    contextForPrompt: string;
}

/**
 * 带评分的知识条目
 */
export interface ScoredKnowledgeEntry {
    entry: KnowledgeEntry;
    score: number;              // 综合得分 (0-1)
    semanticScore: number;      // 语义相似度
    keywordScore: number;       // 关键词匹配度
    visualScore?: number;       // 视觉相似度
    layoutScore?: number;       // 布局相似度
    personalBoost: number;      // 个性化加权
}

/**
 * 检索元数据
 */
export interface SearchMetadata {
    query: string;
    totalResults: number;
    processingTimeMs: number;
    designerId?: string;
    filters?: SearchFilters;
}

/**
 * 检索过滤器
 */
export interface SearchFilters {
    types?: KnowledgeType[];
    categories?: string[];
    sources?: KnowledgeSource[];
    minPriority?: number;
    dateRange?: {
        start?: string;
        end?: string;
    };
}

// ==================== 服务配置类型 ====================

/**
 * 嵌入服务配置
 */
export interface EmbeddingConfig {
    modelId: string;
    visualModelId: string;
    quantized: boolean;
    cachePath?: string;
    batchSize: number;
}

/**
 * 向量存储配置
 */
export interface VectorStoreConfig {
    dbPath: string;
    tableName: string;
    textDimension: number;
    visualDimension: number;
    distanceType: 'cosine' | 'euclidean' | 'dot';
}

/**
 * 检索引擎配置
 */
export interface RetrievalConfig {
    semanticWeight: number;
    visualWeight: number;
    layoutWeight: number;
    keywordWeight: number;
    rrfK: number;
    defaultLimit: number;
    minScore: number;
}

/**
 * RAG 服务配置
 */
export interface RAGServiceConfig {
    embedding: EmbeddingConfig;
    vectorStore: VectorStoreConfig;
    retrieval: RetrievalConfig;
}

// ==================== 默认配置 ====================

export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
    modelId: 'Xenova/bge-small-zh-v1.5',
    visualModelId: 'Xenova/clip-vit-base-patch32',
    quantized: true,
    batchSize: 32
};

export const DEFAULT_VECTOR_STORE_CONFIG: Partial<VectorStoreConfig> = {
    tableName: 'knowledge_vectors',
    textDimension: 512,
    visualDimension: 512,
    distanceType: 'cosine'
};

export const DEFAULT_RETRIEVAL_CONFIG: RetrievalConfig = {
    semanticWeight: 0.45,
    visualWeight: 0.2,
    layoutWeight: 0.15,
    keywordWeight: 0.2,
    rrfK: 60,
    defaultLimit: 10,
    minScore: 0.3
};

export const DEFAULT_DESIGNER_PROFILE: Omit<DesignerProfile, 'designerId' | 'name' | 'createdAt' | 'updatedAt'> = {
    stylePreferences: {
        preferredStyles: [],
        colorTendency: 'neutral',
        designPrinciples: [],
        favoriteColorSchemes: []
    },
    workflowPreferences: {
        defaultTechnique: 'TPS',
        autoCorrection: true,
        batchProcessing: false,
        previewMode: '2D',
        confirmBeforeApply: false,
        autoSave: true
    },
    uiPreferences: {
        theme: 'dark',
        layoutMode: 'grid',
        infoDensity: 'normal',
        fontSize: 'medium',
        showTips: true
    },
    retrievalPreferences: {
        preferredCategories: [],
        keywordBoosts: {},
        excludedTopics: [],
        semanticWeight: 0.6,
        resultLimit: 10
    },
    learningData: {
        frequentSearches: [],
        clickedResults: [],
        createdKnowledge: [],
        appliedKnowledge: [],
        sessionStats: {
            totalSessions: 0,
            avgSessionDuration: 0,
            lastSessionAt: ''
        }
    }
};
