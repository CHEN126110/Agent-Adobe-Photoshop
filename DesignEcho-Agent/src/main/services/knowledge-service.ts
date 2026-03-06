/**
 * 知识库检索服务
 * 
 * 提供统一的知识库检索 API，供 Agent 和前端使用
 */

import {
    // 类目
    SOCKS_CATEGORIES,
    searchCategories,
    getAllCategories,
    getCategoryById,
    searchMaterials,
    searchStyles,
    MATERIALS,
    STYLES,
    ProductCategory,
    MaterialInfo,
    StyleInfo,
    // 卖点
    ALL_SELLING_POINTS,
    getPointsByCategory,
    getPointsByScene,
    getPointsByType,
    searchSellingPoints,
    getTopSellingPoints,
    getRandomPointsCombination,
    SellingPoint,
    // 痛点
    ALL_PAIN_POINTS,
    getPainPointsByCategory,
    getPainPointsByType,
    searchPainPoints,
    getTopPainPoints,
    getPainPointsBySellingPoint,
    getPainSolutionPairs,
    PainPoint,
    // 配色
    COLOR_SCHEMES,
    getSchemesByScene,
    getSchemesByCategory,
    getSchemesBySeason,
    searchSchemesByEmotion,
    getSchemeById,
    getSchemeCSSVariables,
    getGradientCSS,
    recommendColorScheme,
    ColorScheme,
    KNOWLEDGE_BASE_STATS
} from '../../shared/knowledge';

// ===== 类型定义 =====

/** 知识库查询结果 */
export interface KnowledgeQueryResult<T> {
    success: boolean;
    data: T[];
    count: number;
    query?: string;
}

/** 综合搜索结果 */
export interface UnifiedSearchResult {
    categories: ProductCategory[];
    materials: MaterialInfo[];
    styles: StyleInfo[];
    sellingPoints: SellingPoint[];
    painPoints: PainPoint[];
    colorSchemes: ColorScheme[];
}

/** 设计推荐结果 */
export interface DesignRecommendation {
    category: ProductCategory | null;
    topSellingPoints: SellingPoint[];
    topPainPoints: PainPoint[];
    recommendedColors: ColorScheme[];
    painSolutionPairs: Array<{ pain: string; solution: string; userVoice: string }>;
}

// ===== 知识库服务类 =====

export class KnowledgeService {
    constructor() {
        console.log('[KnowledgeService] 知识库服务初始化');
        console.log(`[KnowledgeService] 已加载: ${KNOWLEDGE_BASE_STATS.sellingPoints.total} 条卖点, ${KNOWLEDGE_BASE_STATS.painPoints.total} 条痛点, ${KNOWLEDGE_BASE_STATS.colorSchemes.total} 套配色`);
    }

    // ===== 类目相关 =====

    /**
     * 获取所有主类目
     */
    getMainCategories(): ProductCategory[] {
        return SOCKS_CATEGORIES;
    }

    /**
     * 获取所有类目（包括子类目）
     */
    getAllCategories(): ProductCategory[] {
        return getAllCategories();
    }

    /**
     * 根据 ID 获取类目
     */
    getCategoryById(id: string): ProductCategory | null {
        return getCategoryById(id);
    }

    /**
     * 搜索类目
     */
    searchCategories(keyword: string): KnowledgeQueryResult<ProductCategory> {
        const results = searchCategories(keyword);
        return {
            success: true,
            data: results,
            count: results.length,
            query: keyword
        };
    }

    /**
     * 获取所有材质
     */
    getMaterials(): MaterialInfo[] {
        return MATERIALS;
    }

    /**
     * 搜索材质
     */
    searchMaterials(keyword: string): KnowledgeQueryResult<MaterialInfo> {
        const results = searchMaterials(keyword);
        return {
            success: true,
            data: results,
            count: results.length,
            query: keyword
        };
    }

    /**
     * 获取所有风格
     */
    getStyles(): StyleInfo[] {
        return STYLES;
    }

    /**
     * 搜索风格
     */
    searchStyles(keyword: string): KnowledgeQueryResult<StyleInfo> {
        const results = searchStyles(keyword);
        return {
            success: true,
            data: results,
            count: results.length,
            query: keyword
        };
    }

    // ===== 卖点相关 =====

    /**
     * 获取所有卖点
     */
    getAllSellingPoints(): SellingPoint[] {
        return ALL_SELLING_POINTS;
    }

    /**
     * 根据类目获取卖点
     */
    getSellingPointsByCategory(categoryId: string): KnowledgeQueryResult<SellingPoint> {
        const results = getPointsByCategory(categoryId);
        return {
            success: true,
            data: results,
            count: results.length,
            query: categoryId
        };
    }

    /**
     * 根据场景获取卖点
     */
    getSellingPointsByScene(scene: string): KnowledgeQueryResult<SellingPoint> {
        const results = getPointsByScene(scene);
        return {
            success: true,
            data: results,
            count: results.length,
            query: scene
        };
    }

    /**
     * 根据类型获取卖点
     */
    getSellingPointsByType(type: SellingPoint['type']): KnowledgeQueryResult<SellingPoint> {
        const results = getPointsByType(type);
        return {
            success: true,
            data: results,
            count: results.length,
            query: type
        };
    }

    /**
     * 搜索卖点
     */
    searchSellingPoints(keyword: string): KnowledgeQueryResult<SellingPoint> {
        const results = searchSellingPoints(keyword);
        return {
            success: true,
            data: results,
            count: results.length,
            query: keyword
        };
    }

    /**
     * 获取推荐卖点
     */
    getTopSellingPoints(categoryId: string, limit: number = 5): SellingPoint[] {
        return getTopSellingPoints(categoryId, limit);
    }

    /**
     * 获取随机卖点组合
     */
    getRandomSellingPoints(categoryId: string, count: number = 3): SellingPoint[] {
        return getRandomPointsCombination(categoryId, count);
    }

    // ===== 痛点相关 =====

    /**
     * 获取所有痛点
     */
    getAllPainPoints(): PainPoint[] {
        return ALL_PAIN_POINTS;
    }

    /**
     * 根据类目获取痛点
     */
    getPainPointsByCategory(categoryId: string): KnowledgeQueryResult<PainPoint> {
        const results = getPainPointsByCategory(categoryId);
        return {
            success: true,
            data: results,
            count: results.length,
            query: categoryId
        };
    }

    /**
     * 根据类型获取痛点
     */
    getPainPointsByType(type: PainPoint['type']): KnowledgeQueryResult<PainPoint> {
        const results = getPainPointsByType(type);
        return {
            success: true,
            data: results,
            count: results.length,
            query: type
        };
    }

    /**
     * 搜索痛点
     */
    searchPainPoints(keyword: string): KnowledgeQueryResult<PainPoint> {
        const results = searchPainPoints(keyword);
        return {
            success: true,
            data: results,
            count: results.length,
            query: keyword
        };
    }

    /**
     * 获取严重程度最高的痛点
     */
    getTopPainPoints(categoryId: string, limit: number = 5): PainPoint[] {
        return getTopPainPoints(categoryId, limit);
    }

    /**
     * 根据卖点获取解决的痛点
     */
    getPainPointsBySellingPoint(sellingPointId: string): PainPoint[] {
        return getPainPointsBySellingPoint(sellingPointId);
    }

    /**
     * 获取痛点-解决方案配对
     */
    getPainSolutionPairs(categoryId: string): Array<{ pain: string; solution: string; userVoice: string }> {
        return getPainSolutionPairs(categoryId);
    }

    // ===== 配色相关 =====

    /**
     * 获取所有配色方案
     */
    getAllColorSchemes(): ColorScheme[] {
        return COLOR_SCHEMES;
    }

    /**
     * 根据 ID 获取配色方案
     */
    getColorSchemeById(id: string): ColorScheme | null {
        return getSchemeById(id);
    }

    /**
     * 根据场景获取配色方案
     */
    getColorSchemesByScene(scene: string): KnowledgeQueryResult<ColorScheme> {
        const results = getSchemesByScene(scene);
        return {
            success: true,
            data: results,
            count: results.length,
            query: scene
        };
    }

    /**
     * 根据类目获取配色方案
     */
    getColorSchemesByCategory(categoryId: string): KnowledgeQueryResult<ColorScheme> {
        const results = getSchemesByCategory(categoryId);
        return {
            success: true,
            data: results,
            count: results.length,
            query: categoryId
        };
    }

    /**
     * 根据季节获取配色方案
     */
    getColorSchemesBySeason(season: string): KnowledgeQueryResult<ColorScheme> {
        const results = getSchemesBySeason(season as ColorScheme['seasons'][number]);
        return {
            success: true,
            data: results,
            count: results.length,
            query: season
        };
    }

    /**
     * 搜索配色方案
     */
    searchColorSchemes(emotion: string): KnowledgeQueryResult<ColorScheme> {
        const results = searchSchemesByEmotion(emotion);
        return {
            success: true,
            data: results,
            count: results.length,
            query: emotion
        };
    }

    /**
     * 智能推荐配色方案
     */
    recommendColorSchemes(options: {
        category?: string;
        season?: string;
        emotion?: string;
        scene?: string;
    }): ColorScheme[] {
        return recommendColorScheme(options);
    }

    /**
     * 获取配色方案的 CSS 变量
     */
    getColorSchemeCSSVariables(schemeId: string): Record<string, string> | null {
        const scheme = getSchemeById(schemeId);
        if (!scheme) return null;
        return getSchemeCSSVariables(scheme);
    }

    /**
     * 获取渐变 CSS
     */
    getGradientCSS(schemeId: string, gradientIndex: number = 0): string | null {
        const scheme = getSchemeById(schemeId);
        if (!scheme) return null;
        return getGradientCSS(scheme, gradientIndex);
    }

    // ===== 综合查询 =====

    /**
     * 统一搜索（全文检索）
     */
    unifiedSearch(keyword: string): UnifiedSearchResult {
        return {
            categories: searchCategories(keyword),
            materials: searchMaterials(keyword),
            styles: searchStyles(keyword),
            sellingPoints: searchSellingPoints(keyword),
            painPoints: searchPainPoints(keyword),
            colorSchemes: searchSchemesByEmotion(keyword)
        };
    }

    /**
     * 获取类目的设计推荐
     */
    getDesignRecommendation(categoryId: string, options?: {
        season?: string;
        scene?: string;
    }): DesignRecommendation {
        const category = getCategoryById(categoryId);
        const topSellingPoints = getTopSellingPoints(categoryId, 5);
        const topPainPoints = getTopPainPoints(categoryId, 5);
        const painSolutionPairs = getPainSolutionPairs(categoryId);
        
        const recommendedColors = recommendColorScheme({
            category: categoryId,
            season: options?.season,
            scene: options?.scene
        });

        return {
            category,
            topSellingPoints,
            topPainPoints,
            recommendedColors: recommendedColors.slice(0, 3),
            painSolutionPairs: painSolutionPairs.slice(0, 5)
        };
    }

    /**
     * 获取知识库统计信息
     */
    getStats(): typeof KNOWLEDGE_BASE_STATS {
        return KNOWLEDGE_BASE_STATS;
    }

    /**
     * 生成设计提示词（供 Agent 使用）
     */
    generateDesignPrompt(categoryId: string, options?: {
        season?: string;
        scene?: string;
        style?: string;
    }): string {
        const recommendation = this.getDesignRecommendation(categoryId, options);
        
        if (!recommendation.category) {
            return '未找到对应类目信息';
        }

        const lines: string[] = [
            `## 产品信息`,
            `- 类目: ${recommendation.category.name}`,
            `- 描述: ${recommendation.category.description}`,
            `- 目标人群: ${recommendation.category.targetAudience.join('、')}`,
            ``,
            `## 核心卖点 (可选择 2-3 个)`,
            ...recommendation.topSellingPoints.map(p => 
                `- **${p.title}**: ${p.description}`
            ),
            ``,
            `## 用户痛点 (用于文案共鸣)`,
            ...recommendation.topPainPoints.slice(0, 3).map(p => 
                `- 痛点: ${p.title} → 解决: ${p.solutionTitle}`
            ),
            ``,
            `## 推荐配色`,
            ...recommendation.recommendedColors.map(c => 
                `- **${c.name}**: 主色 ${c.primary.hex} / 强调色 ${c.accent.hex}`
            ),
        ];

        if (options?.season) {
            lines.push(``, `## 季节: ${options.season}`);
        }

        if (options?.style) {
            lines.push(``, `## 风格: ${options.style}`);
        }

        return lines.join('\n');
    }
}

// 单例导出
export const knowledgeService = new KnowledgeService();
export default knowledgeService;
