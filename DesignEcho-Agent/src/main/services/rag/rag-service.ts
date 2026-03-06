/**
 * RAG 服务主类
 *
 * 整合嵌入服务、向量存储、检索引擎，提供统一的知识检索接口
 */

import { EmbeddingService, getEmbeddingService } from './embedding-service';
import { VectorStore, getVectorStore } from './vector-store';
import { RetrievalEngine } from './retrieval-engine';
import { KnowledgeIndexer, RawKnowledgeData, IndexProgressCallback, IndexResult } from './knowledge-indexer';
import { PsdIngestor, PsdIngestOptions, PsdIngestResult } from './psd-ingestor';
import { EdgeStore, DesignGraphRecord } from './edge-store';
import { DesignerProfileService, getDesignerProfileService } from '../designer/designer-profile.service';
import {
    KnowledgeEntry,
    RAGSearchResult,
    ScoredKnowledgeEntry,
    SearchFilters,
    RAGServiceConfig,
    DEFAULT_EMBEDDING_CONFIG,
    DEFAULT_VECTOR_STORE_CONFIG,
    DEFAULT_RETRIEVAL_CONFIG,
    DesignerProfile
} from './types';

/**
 * RAG 服务状态
 */
interface RAGServiceStatus {
    initialized: boolean;
    embeddingReady: boolean;
    vectorStoreReady: boolean;
    indexedCount: number;
    lastIndexTime: string | null;
}

/**
 * RAG 服务类
 */
export class RAGService {
    private embeddingService: EmbeddingService;
    private vectorStore: VectorStore;
    private retrievalEngine: RetrievalEngine;
    private knowledgeIndexer: KnowledgeIndexer;
    private psdIngestor: PsdIngestor;
    private edgeStore: EdgeStore;
    private designerProfileService: DesignerProfileService;
    
    private initialized = false;
    private lastIndexTime: string | null = null;
    
    constructor(config?: Partial<RAGServiceConfig>) {
        // 初始化子服务
        this.embeddingService = getEmbeddingService(config?.embedding);
        this.vectorStore = getVectorStore(config?.vectorStore);
        this.retrievalEngine = new RetrievalEngine(
            this.embeddingService,
            this.vectorStore,
            config?.retrieval || DEFAULT_RETRIEVAL_CONFIG
        );
        this.knowledgeIndexer = new KnowledgeIndexer(
            this.embeddingService,
            this.vectorStore
        );
        this.psdIngestor = new PsdIngestor(this.embeddingService, this.vectorStore);
        this.edgeStore = new EdgeStore();
        this.designerProfileService = getDesignerProfileService();
    }
    
    /**
     * 初始化 RAG 服务
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;

        console.log('[RAGService] 初始化 RAG 服务...');
        const startTime = performance.now();

        try {
            await Promise.all([
                this.embeddingService.initialize(),
                this.vectorStore.initialize()
            ]);

            this.initialized = true;
            const elapsed = (performance.now() - startTime).toFixed(0);
            console.log(`[RAGService] ✅ RAG 服务初始化完成 (${elapsed}ms)`);
        } catch (error: any) {
            console.error('[RAGService] 初始化失败:', error.message);
            throw error;
        }
    }

    /**
     * 索引知识库数据
     */
    async indexKnowledge(
        data: RawKnowledgeData,
        onProgress?: IndexProgressCallback
    ): Promise<IndexResult> {
        await this.initialize();
        
        const result = await this.knowledgeIndexer.indexAll(data, onProgress);
        
        if (result.success) {
            this.lastIndexTime = new Date().toISOString();
        }
        
        return result;
    }

    async ingestPsdFile(filePath: string, options?: PsdIngestOptions): Promise<PsdIngestResult> {
        await this.initialize();
        const result = await this.psdIngestor.ingestFile(filePath, options);
        if (result.ingested > 0) {
            this.lastIndexTime = new Date().toISOString();
        }
        return result;
    }

    async ingestDocumentContext(doc: any, options?: PsdIngestOptions): Promise<PsdIngestResult> {
        await this.initialize();
        // 确保 doc 符合 DocumentStructure 接口
        const result = await this.psdIngestor.ingestFromObject(doc, options);
        if (result.ingested > 0) {
            this.lastIndexTime = new Date().toISOString();
        }
        return result;
    }

    async getGraph(graphId: string): Promise<DesignGraphRecord | null> {
        await this.initialize();
        return this.edgeStore.readGraph(graphId);
    }
    
    /**
     * 重建知识库索引
     */
    async rebuildIndex(
        data: RawKnowledgeData,
        onProgress?: IndexProgressCallback
    ): Promise<IndexResult> {
        await this.initialize();
        
        const result = await this.knowledgeIndexer.rebuildIndex(data, onProgress);
        
        if (result.success) {
            this.lastIndexTime = new Date().toISOString();
        }
        
        return result;
    }
    
    /**
     * 搜索知识库
     */
    async search(
        query: string,
        options?: {
            limit?: number;
            filters?: SearchFilters;
            designerId?: string;
            usePersonalization?: boolean;
        }
    ): Promise<RAGSearchResult> {
        await this.initialize();
        
        const startTime = performance.now();
        const limit = options?.limit || 10;
        
        // 获取设计师档案 (用于个性化)
        let designerProfile: DesignerProfile | null = null;
        if (options?.designerId && options.usePersonalization !== false) {
            designerProfile = this.designerProfileService.getProfile(options.designerId);
            
            // 记录搜索
            if (designerProfile) {
                this.designerProfileService.recordSearch(options.designerId, query);
            }
        }
        
        // 执行检索
        const results = await this.retrievalEngine.search(query, {
            limit,
            filters: options?.filters,
            profile: designerProfile || undefined
        });
        
        const processingTimeMs = performance.now() - startTime;
        
        console.log(`[RAGService] 检索完成: "${query}" (耗时 ${processingTimeMs.toFixed(0)}ms)`);
        console.log(`[RAGService]   结果数: ${results.length} (Limit: ${limit})`);
        if (results.length > 0) {
            console.log(`[RAGService]   Top 1: [${results[0].entry.type}] ${results[0].entry.title} (Score: ${(results[0].score * 100).toFixed(1)}%)`);
            if (options?.filters) {
                console.log(`[RAGService]   Filters: ${JSON.stringify(options.filters)}`);
            }
        } else {
            console.log(`[RAGService]   未找到结果`);
        }
        
        // 构建 Prompt 上下文
        const contextForPrompt = this.buildContextForPrompt(results, query);
        
        return {
            entries: results,
            metadata: {
                query,
                totalResults: results.length,
                processingTimeMs,
                designerId: options?.designerId,
                filters: options?.filters
            },
            contextForPrompt
        };
    }

    async searchAdvanced(
        query: string,
        options?: {
            limit?: number;
            filters?: SearchFilters;
            designerId?: string;
            usePersonalization?: boolean;
            visualEmbedding?: Float32Array;
            layoutEmbedding?: Float32Array;
        }
    ): Promise<RAGSearchResult> {
        await this.initialize();

        const startTime = performance.now();
        const limit = options?.limit || 10;

        let designerProfile: DesignerProfile | null = null;
        if (options?.designerId && options.usePersonalization !== false) {
            designerProfile = this.designerProfileService.getProfile(options.designerId);
            if (designerProfile) {
                this.designerProfileService.recordSearch(options.designerId, query);
            }
        }

        const results = await this.retrievalEngine.search(query, {
            limit,
            filters: options?.filters,
            profile: designerProfile || undefined,
            visualInput: options?.visualEmbedding,
            layoutInput: options?.layoutEmbedding
        });

        const processingTimeMs = performance.now() - startTime;

        console.log(`[RAGService] 高级检索完成: "${query}" (耗时 ${processingTimeMs.toFixed(0)}ms)`);
        console.log(`[RAGService]   输入模态: 文本${options?.visualEmbedding ? '+视觉' : ''}${options?.layoutEmbedding ? '+结构' : ''}`);
        console.log(`[RAGService]   结果数: ${results.length} (Limit: ${limit})`);
        if (results.length > 0) {
            const top = results[0];
            console.log(`[RAGService]   Top 1: [${top.entry.type}] ${top.entry.title} (Score: ${(top.score * 100).toFixed(1)}%)`);
            console.log(`[RAGService]          分项: 语义${(top.semanticScore * 100).toFixed(0)}%` +
                (top.visualScore ? ` 视觉${(top.visualScore * 100).toFixed(0)}%` : '') +
                (top.layoutScore ? ` 结构${(top.layoutScore * 100).toFixed(0)}%` : ''));
        }

        const contextForPrompt = this.buildContextForPrompt(results, query);

        return {
            entries: results,
            metadata: {
                query,
                totalResults: results.length,
                processingTimeMs,
                designerId: options?.designerId,
                filters: options?.filters
            },
            contextForPrompt
        };
    }
    
    /**
     * 快速语义搜索 (不含个性化)
     */
    async quickSearch(query: string, limit = 5): Promise<ScoredKnowledgeEntry[]> {
        await this.initialize();
        return this.retrievalEngine.search(query, { limit });
    }
    
    /**
     * 根据类型获取知识
     */
    async getByType(
        type: KnowledgeEntry['type'],
        limit = 20
    ): Promise<KnowledgeEntry[]> {
        await this.initialize();
        
        const results = await this.vectorStore.search(
            new Float32Array(this.embeddingService.getDimension()).fill(0),
            {
                limit,
                filter: `type = '${type}'`
            }
        );
        
        return results.map(r => ({
            id: r.id,
            type: r.type as KnowledgeEntry['type'],
            text: r.text,
            title: r.title,
            metadata: r.metadata
        }));
    }
    
    /**
     * 增量添加知识条目
     */
    async addKnowledge(entry: KnowledgeEntry): Promise<boolean> {
        await this.initialize();
        return this.knowledgeIndexer.indexOne(entry);
    }
    
    /**
     * 删除知识条目
     */
    async removeKnowledge(ids: string[]): Promise<number> {
        await this.initialize();
        return this.knowledgeIndexer.removeIndex(ids);
    }
    
    /**
     * 记录知识点击
     */
    recordClick(designerId: string, knowledgeId: string): void {
        this.designerProfileService.recordKnowledgeClick(designerId, knowledgeId);
    }
    
    /**
     * 记录知识应用
     */
    recordApply(designerId: string, knowledgeId: string): void {
        this.designerProfileService.recordKnowledgeApplied(designerId, knowledgeId);
    }
    
    /**
     * 获取服务状态
     */
    async getStatus(): Promise<RAGServiceStatus> {
        return {
            initialized: this.initialized,
            embeddingReady: this.embeddingService.isInitialized(),
            vectorStoreReady: this.vectorStore.isInitialized(),
            indexedCount: await this.vectorStore.count(),
            lastIndexTime: this.lastIndexTime
        };
    }
    
    /**
     * 构建 Prompt 上下文
     */
    private buildContextForPrompt(
        results: ScoredKnowledgeEntry[],
        query: string
    ): string {
        if (results.length === 0) {
            return '';
        }
        
        const contextParts: string[] = [
            `【相关知识检索结果】(查询: "${query}")`,
            ''
        ];
        
        results.forEach((item, index) => {
            const { entry, score } = item;
            const typeLabel = this.getTypeLabel(entry.type);
            
            contextParts.push(`${index + 1}. [${typeLabel}] ${entry.title}`);
            
            if (entry.description) {
                contextParts.push(`   ${entry.description}`);
            }
            
            if (entry.metadata.extra) {
                const extra = entry.metadata.extra;
                if (extra.suggestedColors) {
                    contextParts.push(`   建议配色: ${extra.suggestedColors.join(', ')}`);
                }
                if (extra.solutionDescription) {
                    contextParts.push(`   解决方案: ${extra.solutionDescription}`);
                }
                if (extra.graphRef) {
                    contextParts.push(`   图谱: ${extra.graphRef}`);
                }
            }

            if (typeof item.layoutScore === 'number' && item.layoutScore > 0) {
                contextParts.push(`   结构相似度: ${(item.layoutScore * 100).toFixed(0)}%`);
            }
            if (typeof item.visualScore === 'number' && item.visualScore > 0) {
                contextParts.push(`   视觉相似度: ${(item.visualScore * 100).toFixed(0)}%`);
            }
            
            contextParts.push(`   (相关度: ${(score * 100).toFixed(0)}%)`);
            contextParts.push('');
        });
        
        return contextParts.join('\n');
    }
    
    /**
     * 获取类型标签
     */
    private getTypeLabel(type: KnowledgeEntry['type']): string {
        const labels: Record<KnowledgeEntry['type'], string> = {
            selling_point: '卖点',
            pain_point: '痛点',
            color_scheme: '配色',
            technique: '技巧',
            case: '案例',
            copy_template: '文案',
            main_image_spec: '主图规范',
            detail_screen_template: '详情页屏',
            layout_rule: '布局规则',
            scene_styling: '场景搭配',
            brand_guideline: '品牌规范'
        };
        return labels[type] || type;
    }
    
    /**
     * 获取设计师档案服务
     */
    getDesignerProfileService(): DesignerProfileService {
        return this.designerProfileService;
    }
    
    /**
     * 获取嵌入服务
     */
    getEmbeddingService(): EmbeddingService {
        return this.embeddingService;
    }
    
    /**
     * 获取向量存储
     */
    getVectorStore(): VectorStore {
        return this.vectorStore;
    }
}

// 单例实例
let ragServiceInstance: RAGService | null = null;

/**
 * 获取 RAG 服务单例
 */
export function getRAGService(config?: Partial<RAGServiceConfig>): RAGService {
    if (!ragServiceInstance) {
        ragServiceInstance = new RAGService(config);
    }
    return ragServiceInstance;
}

export default RAGService;
