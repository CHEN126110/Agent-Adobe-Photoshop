/**
 * 内容匹配服务
 * @description 匹配知识库内容和项目素材到详情页模板占位符
 */

import type { 
    ParsedScreen, 
    FillPlan, 
    CopyFillItem, 
    ImageFillItem,
    ScreenType, 
    AssetType,
    CopyPlaceholder,
    ImagePlaceholder,
    SCREEN_TO_KNOWLEDGE_MAP,
    SCREEN_TO_ASSET_MAP
} from '@shared/types/detail-page.types';

// 重新定义映射以避免循环依赖
const SCREEN_KNOWLEDGE_MAP: Record<ScreenType, string[]> = {
    'A_营销信息': ['promotion', 'discount', 'event'],
    'B_信任状': ['brand', 'certification', 'award'],
    'C_详情页首屏': ['hero', 'selling_point', 'feature', 'benefit'],
    'C_核心卖点': ['hero', 'selling_point', 'feature', 'benefit'],
    'D_图标icon': ['icon', 'quick_point'],
    'D_图标卖点': ['icon', 'quick_point'],
    'E_KV图_调性': ['kv', 'hero', 'tone'],
    'E_KV图': ['kv', 'hero', 'tone'],
    'F_颜色展示': ['color', 'variant'],
    'F_颜色款式展示': ['color', 'variant'],
    'G_面料': ['material', 'fabric', 'composition'],
    'G_面料说明': ['material', 'fabric', 'composition'],
    'H_解决痛点': ['pain_point', 'solution', 'problem'],
    'I_穿搭推荐': ['styling', 'outfit', 'match'],
    'J_细节展示': ['detail', 'craftsmanship', 'closeup'],
    'K_产品信息': ['specification', 'size', 'info'],
    'K_产品参数': ['specification', 'size', 'info'],
    'L_模特实拍': ['model', 'lifestyle'],
    'M_售后服务': ['service', 'guarantee', 'policy'],
    'CUSTOM': []
};

const SCREEN_ASSET_MAP: Record<ScreenType, AssetType[]> = {
    'A_营销信息': ['scene'],
    'B_信任状': ['icon'],
    'C_详情页首屏': ['product'],
    'C_核心卖点': ['product'],
    'D_图标icon': ['icon'],
    'D_图标卖点': ['icon'],
    'E_KV图_调性': ['scene', 'product'],
    'E_KV图': ['scene', 'product'],
    'F_颜色展示': ['product'],
    'F_颜色款式展示': ['product'],
    'G_面料': ['detail'],
    'G_面料说明': ['detail'],
    'H_解决痛点': ['detail', 'product'],
    'I_穿搭推荐': ['model', 'scene'],
    'J_细节展示': ['detail'],
    'K_产品信息': ['product'],
    'K_产品参数': ['product'],
    'L_模特实拍': ['model'],
    'M_售后服务': ['icon'],
    'CUSTOM': ['product']
};

// 项目素材结构
interface ProjectAssets {
    images: {
        path: string;
        type: AssetType;
        width: number;
        height: number;
        name: string;
    }[];
}

// RAG 搜索结果
interface RAGSearchResult {
    id: string;
    text: string;
    score: number;
    metadata?: Record<string, any>;
}

// RAG 服务接口
interface RAGService {
    search(query: string, options?: { filter?: any; limit?: number }): Promise<RAGSearchResult[]>;
}

// 项目服务接口
interface EcommerceProjectService {
    scanProject(projectPath: string): Promise<ProjectAssets>;
}

// 卖点条目（内联类型，避免强耦合）
interface SellingPointEntry {
    id: string;
    title: string;
    description: string;
    type: string;
    priority: number;
    categories?: string[];
    scenes?: string[];
    keywords?: string[];
}

/**
 * 内容匹配服务
 */
export class ContentMatcher {
    private sellingPoints: SellingPointEntry[];
    private styleHintCache = new Map<string, string[]>();
    
    constructor(
        private ragService: RAGService | null,
        private projectService: EcommerceProjectService | null,
        sellingPoints?: SellingPointEntry[]
    ) {
        this.sellingPoints = sellingPoints || [];
    }
    
    /**
     * 为所有屏生成填充方案
     */
    async generateFillPlans(
        screens: ParsedScreen[], 
        projectPath: string
    ): Promise<FillPlan[]> {
        const plans: FillPlan[] = [];
        
        // 扫描项目素材
        let projectAssets: ProjectAssets = { images: [] };
        if (this.projectService) {
            try {
                projectAssets = await this.projectService.scanProject(projectPath);
                console.log(`[ContentMatcher] 扫描到 ${projectAssets.images.length} 张素材`);
            } catch (e: any) {
                console.warn(`[ContentMatcher] 扫描项目素材失败: ${e.message}`);
            }
        }
        
        for (const screen of screens) {
            const plan = await this.generateScreenPlan(screen, projectAssets);
            plans.push(plan);
        }
        
        console.log(`[ContentMatcher] 生成 ${plans.length} 个填充方案`);
        
        return plans;
    }
    
    /**
     * 为单个屏生成填充方案
     */
    private async generateScreenPlan(
        screen: ParsedScreen,
        projectAssets: ProjectAssets
    ): Promise<FillPlan> {
        const copies: CopyFillItem[] = [];
        const images: ImageFillItem[] = [];
        
        // 1. 匹配文案
        for (const copy of screen.copyPlaceholders) {
            const matched = await this.matchCopy(copy, screen.type);
            copies.push(matched);
        }
        
        // 2. 匹配图片
        for (const img of screen.imagePlaceholders) {
            const matched = await this.matchImage(img, screen.type, projectAssets);
            images.push(matched);
        }
        
        // 计算置信度
        const avgConfidence = this.calculateConfidence(copies, images);
        
        return {
            screenId: screen.id,
            screenName: screen.name,
            screenType: screen.type,
            copies,
            images,
            confidence: avgConfidence,
            needsReview: avgConfidence < 0.7
        };
    }
    
    /**
     * 匹配文案内容
     */
    private async matchCopy(
        placeholder: CopyPlaceholder, 
        screenType: ScreenType
    ): Promise<CopyFillItem> {
        const knowledgeTypes = SCREEN_KNOWLEDGE_MAP[screenType] || [];
        
        // 尝试从知识库检索
        if (this.ragService && knowledgeTypes.length > 0) {
            try {
                const query = `${screenType} ${placeholder.role} ${placeholder.currentText}`;
                const results = await this.ragService.search(query, {
                    filter: { types: knowledgeTypes },
                    limit: 3
                });
                
                if (results.length > 0 && results[0].score > 0.7) {
                    return {
                        layerId: placeholder.layerId,
                        layerName: placeholder.layerName,
                        content: results[0].text,
                        source: 'knowledge',
                        sourceId: results[0].id,
                        originalText: placeholder.currentText
                    };
                }
            } catch (e: any) {
                console.warn(`[ContentMatcher] RAG 检索失败: ${e.message}`);
            }
        }
        
        // RAG 无匹配时，尝试从本地卖点知识库匹配
        if (this.sellingPoints.length > 0 && knowledgeTypes.length > 0) {
            const matched = this.matchFromSellingPoints(knowledgeTypes, placeholder.role);
            if (matched) {
                return {
                    layerId: placeholder.layerId,
                    layerName: placeholder.layerName,
                    content: matched.description,
                    source: 'knowledge',
                    sourceId: matched.id,
                    originalText: placeholder.currentText
                };
            }
        }

        // 均无匹配时，保留原文案
        return {
            layerId: placeholder.layerId,
            layerName: placeholder.layerName,
            content: placeholder.currentText,
            source: 'template',
            originalText: placeholder.currentText
        };
    }

    /**
     * 从本地卖点库中匹配文案
     */
    private matchFromSellingPoints(
        knowledgeTypes: string[],
        role: string
    ): SellingPointEntry | null {
        // 将屏的知识类型映射到卖点 type
        const typeMap: Record<string, string[]> = {
            'selling_point': ['material', 'function', 'comfort', 'design', 'quality', 'health'],
            'feature': ['function', 'design', 'quality'],
            'benefit': ['comfort', 'health'],
            'material': ['material'],
            'fabric': ['material'],
            'pain_point': ['comfort', 'health', 'function'],
            'solution': ['function', 'comfort'],
        };

        const allowedTypes = new Set<string>();
        for (const kt of knowledgeTypes) {
            const mapped = typeMap[kt];
            if (mapped) {
                mapped.forEach(t => allowedTypes.add(t));
            }
        }

        if (allowedTypes.size === 0) return null;

        // 按优先级排序，选最高优先级的
        const candidates = this.sellingPoints
            .filter(sp => allowedTypes.has(sp.type))
            .sort((a, b) => b.priority - a.priority);

        // 如果 role 包含关键词，尝试更精确匹配
        const roleText = (role || '').toLowerCase();
        if (roleText) {
            const exactMatch = candidates.find(sp =>
                sp.keywords?.some(k => roleText.includes(k.toLowerCase()))
            );
            if (exactMatch) return exactMatch;
        }

        return candidates[0] || null;
    }
    
    /**
     * 匹配图片素材
     */
    private async matchImage(
        placeholder: ImagePlaceholder,
        screenType: ScreenType,
        projectAssets: ProjectAssets
    ): Promise<ImageFillItem> {
        const zone = placeholder.zone || 'unknown';
        const layerName = String(placeholder.layerName || '').toLowerCase();
        const iconLike = zone === 'icon' || /icon|图标|装饰|标签/.test(layerName);

        let preferredTypes = [...(SCREEN_ASSET_MAP[screenType] || ['product'])];
        if (iconLike) {
            preferredTypes = ['icon', ...preferredTypes.filter(t => t !== 'icon')];
        } else if (zone === 'image') {
            preferredTypes = preferredTypes.filter(t => t !== 'icon');
            if (preferredTypes.length === 0) preferredTypes = ['product'];
        }
        
        // 从占位符名称提取语义 hints
        const semanticHints = this.extractSemanticHints(placeholder.layerName, screenType);
        const styleHints = await this.getScreenStyleHints(screenType);

        // 按优先级查找素材
        for (const assetType of preferredTypes) {
            const candidates = projectAssets.images.filter(
                img => img.type === assetType
            );
            
            if (candidates.length > 0) {
                const best = this.findBestMatch(
                    candidates, 
                    placeholder.aspectRatio,
                    semanticHints,
                    screenType,
                    styleHints
                );
                
                return {
                    layerId: placeholder.layerId,
                    layerName: placeholder.layerName,
                    imagePath: best.path,
                    fillMode: this.resolveFillMode(assetType, iconLike, screenType),
                    assetType,
                    needsMatting: assetType === 'product' && !iconLike,
                    subjectAlign: 'center'
                };
            }
        }
        
        // 尝试任意类型
        if (projectAssets.images.length > 0) {
            const best = this.findBestMatch(
                projectAssets.images, 
                placeholder.aspectRatio,
                    semanticHints,
                    screenType,
                    styleHints
                );
            
            return {
                layerId: placeholder.layerId,
                layerName: placeholder.layerName,
                imagePath: best.path,
                fillMode: this.resolveFillMode(best.type, iconLike, screenType),
                assetType: best.type,
                needsMatting: best.type === 'product' && !iconLike,
                subjectAlign: 'center'
            };
        }
        
        // 无匹配时返回空填充
        return {
            layerId: placeholder.layerId,
            layerName: placeholder.layerName,
            imagePath: '',
            fillMode: this.resolveFillMode(iconLike ? 'icon' : 'product', iconLike, screenType),
            assetType: iconLike ? 'icon' : 'product'
        };
    }

    private resolveFillMode(assetType: AssetType, iconLike: boolean, screenType: ScreenType): 'cover' | 'contain' | 'smart' {
        if (iconLike || assetType === 'icon') return 'contain';

        // 产品、模特、细节图优先完整保留主体，避免误裁切
        if (assetType === 'product' || assetType === 'model' || assetType === 'detail') {
            return 'contain';
        }

        // KV/场景图允许铺满
        if (assetType === 'scene') {
            const lower = String(screenType || '').toLowerCase();
            if (lower.includes('kv') || lower.includes('hero') || lower.includes('banner')) {
                return 'cover';
            }
            return 'smart';
        }

        return 'smart';
    }
    
    /**
     * 综合匹配：宽高比 + 语义关键词加权
     */
    private findBestMatch(
        candidates: ProjectAssets['images'],
        targetRatio: number,
        semanticHints?: string[],
        screenType?: ScreenType,
        styleHints?: string[]
    ): ProjectAssets['images'][0] {
        if (candidates.length === 0) return candidates[0];
        if (candidates.length === 1) return candidates[0];

        let best = candidates[0];
        let bestScore = -Infinity;

        const hints = (semanticHints || []).map(h => h.toLowerCase());
        const styleTokens = (styleHints || []).map(t => t.toLowerCase());
        const targetLandscape = targetRatio >= 1;
        const targetAbsRatio = targetRatio > 0 ? targetRatio : 1;

        for (const img of candidates) {
            const ratio = (img.width && img.height) ? (img.width / img.height) : 1;
            const ratioDiff = Math.abs(ratio - targetRatio);
            const ratioScore = Math.max(0, 1 - ratioDiff);

            let semanticScore = 0;
            if (hints.length > 0) {
                const searchText = `${img.name || ''} ${img.path || ''}`.toLowerCase();
                const matchCount = hints.filter(h => searchText.includes(h)).length;
                semanticScore = matchCount / hints.length;
            }

            const keywordText = `${img.name || ''} ${img.path || ''}`.toLowerCase();
            const screenPriorScore = this.calculateScreenPriorScore(screenType, keywordText, img.type);
            const maxSide = Math.max(img.width || 0, img.height || 0);
            const qualityScore = Math.min(1, maxSide / 2500);
            const imageLandscape = (img.width || 0) >= (img.height || 0);
            const orientationScore = imageLandscape === targetLandscape ? 1 : 0.35;

            let styleScore = 0;
            if (styleTokens.length > 0) {
                const styleMatches = styleTokens.filter(t => keywordText.includes(t)).length;
                styleScore = styleMatches / styleTokens.length;
            }

            const rawScore =
                semanticScore * 0.3 +
                ratioScore * 0.25 +
                screenPriorScore * 0.2 +
                qualityScore * 0.15 +
                styleScore * 0.1;
            const ratioPenalty = Math.max(0.6, 1 - Math.abs((ratio || 1) - targetAbsRatio) * 0.25);
            const totalScore = rawScore * orientationScore * ratioPenalty;

            if (totalScore > bestScore) {
                bestScore = totalScore;
                best = img;
            }
        }

        return best;
    }

    /**
     * 找到宽高比最接近的图片（向后兼容）
     */
    private findBestAspectRatioMatch(
        candidates: ProjectAssets['images'], 
        targetRatio: number
    ): ProjectAssets['images'][0] {
        return this.findBestMatch(candidates, targetRatio);
    }

    private calculateScreenPriorScore(
        screenType: ScreenType | undefined,
        searchText: string,
        assetType: AssetType
    ): number {
        if (!screenType) return 0.5;
        const priors: Record<string, string[]> = {
            'E_KV图_调性': ['kv', 'hero', 'banner', '主图', '封面', '调性'],
            'E_KV图': ['kv', 'hero', 'banner', '主图', '封面', '调性'],
            'J_细节展示': ['detail', 'close', 'macro', '细节', '特写'],
            'L_模特实拍': ['model', 'lifestyle', 'look', '模特', '上身'],
            'G_面料': ['fabric', 'material', 'texture', '面料', '材质'],
            'G_面料说明': ['fabric', 'material', 'texture', '面料', '材质'],
            'F_颜色款式展示': ['color', 'variant', 'swatch', '颜色', '色卡'],
            'F_颜色展示': ['color', 'variant', 'swatch', '颜色', '色卡'],
            'I_穿搭推荐': ['outfit', 'style', 'wear', '穿搭', '搭配'],
        };

        const tokens = priors[screenType] || [];
        if (tokens.length === 0) {
            return assetType === 'product' ? 0.8 : 0.6;
        }

        const hit = tokens.filter(t => searchText.includes(t)).length;
        const tokenScore = hit / tokens.length;
        const typeBase: Record<AssetType, number> = {
            product: 0.7,
            detail: 0.65,
            model: 0.65,
            scene: 0.6,
            icon: 0.55
        };
        return Math.min(1, tokenScore * 0.75 + (typeBase[assetType] || 0.5) * 0.25);
    }

    private async getScreenStyleHints(screenType: ScreenType): Promise<string[]> {
        const cacheKey = `screen:${screenType}`;
        if (this.styleHintCache.has(cacheKey)) {
            return this.styleHintCache.get(cacheKey) || [];
        }
        if (!this.ragService) {
            this.styleHintCache.set(cacheKey, []);
            return [];
        }

        try {
            const results = await this.ragService.search(`${screenType} 版式 构图 图层 命名`, {
                filter: { categories: ['psd', 'design'] },
                limit: 6
            });

            const tokenSet = new Set<string>();
            for (const r of results || []) {
                const metaKeywords = Array.isArray(r.metadata?.keywords) ? r.metadata?.keywords : [];
                for (const k of metaKeywords) {
                    if (typeof k === 'string' && k.trim().length >= 2 && k.trim().length <= 20) {
                        tokenSet.add(k.trim().toLowerCase());
                    }
                }
                const text = (r.text || '').toLowerCase();
                const matches = text.match(/[a-z0-9_\-\u4e00-\u9fa5]{2,20}/g) || [];
                for (const t of matches) {
                    if (tokenSet.size >= 20) break;
                    if (t.length >= 2 && t.length <= 20) tokenSet.add(t);
                }
                if (tokenSet.size >= 20) break;
            }

            const hints = Array.from(tokenSet).slice(0, 20);
            this.styleHintCache.set(cacheKey, hints);
            return hints;
        } catch (e: any) {
            console.warn(`[ContentMatcher] 获取屏风格线索失败: ${e.message}`);
            this.styleHintCache.set(cacheKey, []);
            return [];
        }
    }
    
    /**
     * 从占位符名称和屏类型提取语义关键词
     */
    private extractSemanticHints(layerName: string, screenType: ScreenType): string[] {
        const hints: string[] = [];
        const name = (layerName || '').toLowerCase();

        // 从图层名提取
        const nameKeywords: Record<string, string[]> = {
            '产品': ['product', '产品', '主体'],
            '模特': ['model', '模特', '穿搭'],
            '细节': ['detail', '细节', '特写', '局部'],
            '场景': ['scene', '场景', '生活'],
            '面料': ['material', '面料', '材质'],
            '图标': ['icon', '图标'],
        };
        for (const [, keywords] of Object.entries(nameKeywords)) {
            if (keywords.some(k => name.includes(k))) {
                hints.push(...keywords);
            }
        }

        // 从屏类型提取
        const typeKeywords: Record<string, string[]> = {
            'E_KV图_调性': ['产品', '主图', '调性'],
            'E_KV图': ['产品', '主图', '调性'],
            'G_面料': ['面料', '材质', '纹理'],
            'G_面料说明': ['面料', '材质', '纹理'],
            'J_细节展示': ['细节', '特写'],
            'L_模特实拍': ['模特', '穿搭', '上身'],
        };
        if (typeKeywords[screenType]) {
            hints.push(...typeKeywords[screenType]);
        }

        return [...new Set(hints)];
    }

    /**
     * 计算匹配置信度
     */
    private calculateConfidence(copies: CopyFillItem[], images: ImageFillItem[]): number {
        let total = 0;
        let matched = 0;
        
        for (const copy of copies) {
            total++;
            if (copy.source === 'knowledge') matched++;
        }
        
        for (const img of images) {
            total++;
            if (img.imagePath) matched++;
        }
        
        return total > 0 ? matched / total : 0;
    }
}

/**
 * 创建内容匹配服务实例
 */
export function createContentMatcher(
    ragService?: RAGService | null,
    projectService?: EcommerceProjectService | null
): ContentMatcher {
    return new ContentMatcher(ragService || null, projectService || null);
}
