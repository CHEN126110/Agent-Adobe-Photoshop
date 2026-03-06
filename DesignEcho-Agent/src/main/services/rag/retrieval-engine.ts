/**
 * 混合检索引擎
 * 
 * 结合语义检索、关键词检索和个性化加权
 */

import { EmbeddingService } from './embedding-service';
import { VectorStore } from './vector-store';
import {
    RAGSearchResult,
    ScoredKnowledgeEntry,
    SearchFilters,
    SearchMetadata,
    KnowledgeEntry,
    KnowledgeMetadata,
    RetrievalConfig,
    DesignerProfile,
    DEFAULT_RETRIEVAL_CONFIG
} from './types';

/**
 * 混合检索引擎类
 */
export class RetrievalEngine {
    private config: RetrievalConfig;
    
    constructor(
        private embeddingService: EmbeddingService,
        private vectorStore: VectorStore,
        config?: Partial<RetrievalConfig>
    ) {
        this.config = { ...DEFAULT_RETRIEVAL_CONFIG, ...config };
    }
    
    /**
     * 执行混合检索
     */
    async search(
        query: string,
        options?: {
            limit?: number;
            filters?: SearchFilters;
            profile?: DesignerProfile;
            visualInput?: Float32Array;
            layoutInput?: Float32Array;
        }
    ): Promise<ScoredKnowledgeEntry[]> {
        const startTime = performance.now();
        const limit = options?.limit || this.config.defaultLimit;
        
        console.log(`[RetrievalEngine] 搜索: "${query.slice(0, 50)}..."`);
        
        // 1. 语义检索
        let semanticResults: any[] = [];
        try {
            const queryEmbedding = await this.embeddingService.embed(query);
            semanticResults = await this.vectorStore.search(queryEmbedding, {
                limit: limit * 2,
                filter: this.buildFilter(options?.filters),
                vectorColumn: 'embedding'
            });
            semanticResults = this.applyPostFilters(semanticResults, options?.filters);
        } catch (e) {
            console.warn('[RetrievalEngine] 语义检索失败:', e);
        }
        
        // 2. 视觉检索
        let visualResults: any[] = [];
        if (options?.visualInput && this.config.visualWeight > 0) {
            try {
                visualResults = await this.vectorStore.search(options.visualInput, {
                    limit: limit * 2,
                    filter: this.buildFilter(options?.filters),
                    vectorColumn: 'visual_embedding'
                });
                visualResults = this.applyPostFilters(visualResults, options?.filters);
            } catch (e) {
                console.warn('[RetrievalEngine] 视觉检索失败:', e);
            }
        }

        // 3. 布局检索
        let layoutResults: any[] = [];
        if (options?.layoutInput && this.config.layoutWeight > 0) {
            try {
                layoutResults = await this.vectorStore.search(options.layoutInput, {
                    limit: limit * 2,
                    filter: this.buildFilter(options?.filters),
                    vectorColumn: 'layout_embedding'
                });
                layoutResults = this.applyPostFilters(layoutResults, options?.filters);
            } catch (e) {
                console.warn('[RetrievalEngine] 布局检索失败:', e);
            }
        }
        
        // 4. 关键词检索 (简化版 BM25)
        const keywordResults = this.keywordSearch(query, semanticResults, limit * 2);
        
        // 5. RRF 融合
        const fusedResults = this.fuseResultsMultiModal(
            semanticResults, 
            keywordResults,
            visualResults,
            layoutResults
        );
        
        // 6. 个性化加权
        const personalizedResults = options?.profile
            ? this.applyPersonalization(fusedResults, options.profile)
            : fusedResults;
        
        // 7. 过滤低分结果
        const filteredResults = personalizedResults
            .filter(r => r.score >= this.config.minScore)
            .slice(0, limit);
        
        const processingTimeMs = performance.now() - startTime;
        console.log(`[RetrievalEngine] 完成: ${filteredResults.length} 条结果 (${processingTimeMs.toFixed(0)}ms)`);
        
        return filteredResults;
    }

    /**
     * 构建 LanceDB 过滤器
     */
    private buildFilter(filters?: SearchFilters): string | undefined {
        if (!filters) return undefined;
        
        const conditions: string[] = [];
        
        if (filters.types && filters.types.length > 0) {
            const typeList = filters.types.map(t => `'${t}'`).join(', ');
            conditions.push(`type IN (${typeList})`);
        }
        
        // 注意：更复杂的过滤需要在元数据中实现
        // LanceDB 的 where 语法有限制
        
        return conditions.length > 0 ? conditions.join(' AND ') : undefined;
    }

    /**
     * 对 Lance 返回结果执行元数据级后过滤（categories/sources/date/minPriority）
     */
    private applyPostFilters(results: any[], filters?: SearchFilters): any[] {
        if (!filters) return results;
        return results.filter(r => this.matchMetadataFilters(r?.metadata, filters));
    }

    private matchMetadataFilters(metadata: KnowledgeMetadata | undefined, filters: SearchFilters): boolean {
        if (!metadata) return false;

        if (filters.sources && filters.sources.length > 0) {
            if (!filters.sources.includes(metadata.source as any)) return false;
        }

        if (typeof filters.minPriority === 'number') {
            if ((metadata.priority ?? 0) < filters.minPriority) return false;
        }

        if (filters.categories && filters.categories.length > 0) {
            const cats = metadata.categories || [];
            const hasAnyCategory = filters.categories.some(c => cats.includes(c));
            if (!hasAnyCategory) return false;
        }

        if (filters.dateRange) {
            const createdAt = Date.parse(metadata.createdAt || '');
            if (!Number.isFinite(createdAt)) return false;
            if (filters.dateRange.start) {
                const startTs = Date.parse(filters.dateRange.start);
                if (Number.isFinite(startTs) && createdAt < startTs) return false;
            }
            if (filters.dateRange.end) {
                const endTs = Date.parse(filters.dateRange.end);
                if (Number.isFinite(endTs) && createdAt > endTs) return false;
            }
        }

        return true;
    }
    
    /**
     * 简化的关键词搜索
     * 在语义检索结果基础上进行关键词匹配评分
     */
    private keywordSearch(
        query: string,
        candidates: Array<{ id: string; text: string; title: string; type: string; score: number; metadata: KnowledgeMetadata }>,
        limit: number
    ): Array<{ id: string; score: number; entry: KnowledgeEntry }> {
        const queryTerms = this.tokenize(query);
        
        return candidates
            .map(candidate => {
                // 计算关键词匹配分数
                const textTerms = this.tokenize(candidate.text + ' ' + candidate.title);
                const metadataTerms = this.tokenize(
                    (candidate.metadata.keywords || []).join(' ') +
                    ' ' +
                    (candidate.metadata.categories || []).join(' ')
                );
                const allTerms = [...textTerms, ...metadataTerms];
                
                let matchCount = 0;
                let weightedScore = 0;
                
                for (const qt of queryTerms) {
                    for (const ct of allTerms) {
                        if (ct.includes(qt) || qt.includes(ct)) {
                            matchCount++;
                            // 完全匹配给更高分
                            weightedScore += ct === qt ? 1 : 0.5;
                        }
                    }
                }
                
                const score = queryTerms.length > 0
                    ? weightedScore / (queryTerms.length * 2)  // 归一化
                    : 0;
                
                return {
                    id: candidate.id,
                    score: Math.min(1, score),
                    entry: {
                        id: candidate.id,
                        text: candidate.text,
                        title: candidate.title,
                        type: candidate.type as KnowledgeEntry['type'],
                        metadata: candidate.metadata
                    }
                };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }
    
    /**
     * 简单分词
     */
    private tokenize(text: string): string[] {
        return text
            .toLowerCase()
            .replace(/[^\u4e00-\u9fa5a-z0-9\s]/g, ' ')  // 保留中文、英文、数字
            .split(/\s+/)
            .filter(t => t.length > 1);
    }
    
    /**
     * RRF 融合
     */
    private fuseResultsMultiModal(
        semanticResults: Array<any>,
        keywordResults: Array<any>,
        visualResults: Array<any> = [],
        layoutResults: Array<any> = []
    ): ScoredKnowledgeEntry[] {
        const scoreMap = new Map<string, ScoredKnowledgeEntry>();
        
        const updateScore = (id: string, result: any, type: 'semantic' | 'keyword' | 'visual' | 'layout', rank: number) => {
            let entry = scoreMap.get(id);
            
            if (!entry) {
                entry = {
                    entry: result.entry || {
                        id: result.id,
                        text: result.text,
                        title: result.title,
                        type: result.type,
                        metadata: result.metadata
                    },
                    semanticScore: 0,
                    keywordScore: 0,
                    visualScore: 0,
                    layoutScore: 0,
                    personalBoost: 1,
                    score: 0
                } as ScoredKnowledgeEntry;
                scoreMap.set(id, entry);
            }
            
            const rawScore = typeof result?.score === 'number' ? result.score : 0;
            const normalizedScore = Math.max(0, Math.min(1, rawScore));
            if (type === 'semantic') entry.semanticScore = Math.max(entry.semanticScore, normalizedScore);
            if (type === 'keyword') entry.keywordScore = Math.max(entry.keywordScore, normalizedScore);
            if (type === 'visual') entry.visualScore = Math.max(entry.visualScore || 0, normalizedScore);
            if (type === 'layout') entry.layoutScore = Math.max(entry.layoutScore || 0, normalizedScore);
        };

        semanticResults.forEach((r, i) => updateScore(r.id, r, 'semantic', i));
        keywordResults.forEach((r, i) => updateScore(r.id, r, 'keyword', i));
        visualResults.forEach((r, i) => updateScore(r.id, r, 'visual', i));
        layoutResults.forEach((r, i) => updateScore(r.id, r, 'layout', i));

        // 计算综合权重分数
        return Array.from(scoreMap.values()).map(r => {
            r.score = (
                r.semanticScore * this.config.semanticWeight +
                r.keywordScore * this.config.keywordWeight +
                (r.visualScore || 0) * (this.config.visualWeight || 0) +
                (r.layoutScore || 0) * (this.config.layoutWeight || 0)
            );
            return r;
        }).sort((a, b) => b.score - a.score);
    }
    
    /**
     * 应用个性化加权
     */
    private applyPersonalization(
        results: ScoredKnowledgeEntry[],
        profile: DesignerProfile
    ): ScoredKnowledgeEntry[] {
        const prefs = profile.retrievalPreferences;
        const learning = profile.learningData;
        
        for (const result of results) {
            let boost = 1;
            
            // 1. 类目偏好加权
            if (prefs.preferredCategories.length > 0) {
                const entryCategories = result.entry.metadata?.categories || [];
                const hasPreferredCategory = prefs.preferredCategories.some(
                    cat => entryCategories.includes(cat)
                );
                if (hasPreferredCategory) {
                    boost *= 1.3;
                }
            }
            
            // 2. 关键词加权
            for (const [keyword, weight] of Object.entries(prefs.keywordBoosts)) {
                if (result.entry.text.includes(keyword) || result.entry.title.includes(keyword)) {
                    boost *= (1 + weight);
                }
            }
            
            // 3. 历史点击加权
            const clickData = learning.clickedResults.find(c => c.knowledgeId === result.entry.id);
            if (clickData) {
                boost *= (1 + Math.log(clickData.count + 1) * 0.15);
            }
            
            // 4. 排除主题
            if (prefs.excludedTopics.length > 0) {
                const isExcluded = prefs.excludedTopics.some(topic =>
                    result.entry.text.includes(topic) ||
                    result.entry.title.includes(topic) ||
                    (result.entry.metadata?.keywords || []).includes(topic)
                );
                if (isExcluded) {
                    boost *= 0.1;  // 大幅降权但不完全排除
                }
            }
            
            result.personalBoost = boost;
            result.score *= boost;
        }
        
        return results.sort((a, b) => b.score - a.score);
    }
    
    /**
     * 生成 Prompt 上下文
     */
    private generateContext(results: ScoredKnowledgeEntry[]): string {
        if (results.length === 0) {
            return '';
        }
        
        const lines: string[] = [
            '## 相关知识参考',
            '',
            '以下是从知识库中检索到的相关信息，请参考使用：',
            ''
        ];
        
        results.forEach((r, i) => {
            const entry = r.entry;
            const confidence = (r.score * 100).toFixed(0);
            const typeLabel = this.getTypeLabel(entry.type);
            
            lines.push(`### ${i + 1}. ${entry.title} [${typeLabel}] (相关度: ${confidence}%)`);
            lines.push('');
            
            if (entry.description) {
                lines.push(entry.description);
            } else {
                lines.push(entry.text);
            }
            
            // 添加元数据提示
            if (entry.metadata?.categories?.length) {
                lines.push(`> 类目: ${entry.metadata.categories.join(', ')}`);
            }
            
            lines.push('');
        });
        
        lines.push('---');
        lines.push('');
        
        return lines.join('\n');
    }
    
    /**
     * 获取类型标签
     */
    private getTypeLabel(type: string): string {
        const labels: Record<string, string> = {
            'selling_point': '卖点',
            'pain_point': '痛点',
            'color_scheme': '配色',
            'technique': '技术',
            'case': '案例',
            'copy_template': '文案'
        };
        return labels[type] || type;
    }
    
    /**
     * 更新配置
     */
    updateConfig(config: Partial<RetrievalConfig>): void {
        this.config = { ...this.config, ...config };
    }
    
    /**
     * 获取当前配置
     */
    getConfig(): RetrievalConfig {
        return { ...this.config };
    }
}

export default RetrievalEngine;
