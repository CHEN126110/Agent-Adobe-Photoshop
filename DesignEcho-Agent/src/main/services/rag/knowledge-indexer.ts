/**
 * 知识索引器
 * 
 * 将现有知识库数据向量化并存储到向量数据库
 */

import { EmbeddingService } from './embedding-service';
import { VectorStore } from './vector-store';
import { KnowledgeEntry, KnowledgeMetadata, KnowledgeType, KnowledgeSource } from './types';

/**
 * 索引进度回调
 */
export interface IndexProgressCallback {
    (progress: {
        phase: 'loading' | 'embedding' | 'storing' | 'complete';
        current: number;
        total: number;
        message: string;
    }): void;
}

/**
 * 索引结果
 */
export interface IndexResult {
    success: boolean;
    totalIndexed: number;
    byType: Record<KnowledgeType, number>;
    errors: Array<{ id: string; error: string }>;
    durationMs: number;
}

/**
 * 原始知识数据 (从现有知识库获取)
 */
export interface RawKnowledgeData {
    sellingPoints: any[];
    painPoints: any[];
    colorSchemes: any[];
    copyTemplates: any[];
    categories?: any[];
}

/**
 * 知识索引器类
 */
export class KnowledgeIndexer {
    constructor(
        private embeddingService: EmbeddingService,
        private vectorStore: VectorStore
    ) {}
    
    /**
     * 索引所有知识数据
     */
    async indexAll(
        data: RawKnowledgeData,
        onProgress?: IndexProgressCallback
    ): Promise<IndexResult> {
        const startTime = performance.now();
        const errors: Array<{ id: string; error: string }> = [];
        const byType: Record<KnowledgeType, number> = {
            selling_point: 0,
            pain_point: 0,
            color_scheme: 0,
            technique: 0,
            case: 0,
            copy_template: 0,
            main_image_spec: 0,
            detail_screen_template: 0,
            layout_rule: 0,
            scene_styling: 0,
            brand_guideline: 0
        };
        
        console.log('[KnowledgeIndexer] 开始索引知识库...');
        
        // 1. 转换所有知识为统一格式
        onProgress?.({ phase: 'loading', current: 0, total: 1, message: '加载知识数据...' });
        
        const entries: KnowledgeEntry[] = [
            ...this.convertSellingPoints(data.sellingPoints),
            ...this.convertPainPoints(data.painPoints),
            ...this.convertColorSchemes(data.colorSchemes),
            ...this.convertCopyTemplates(data.copyTemplates)
        ];
        
        console.log(`[KnowledgeIndexer] 共 ${entries.length} 条知识待索引`);
        
        if (entries.length === 0) {
            return {
                success: true,
                totalIndexed: 0,
                byType,
                errors: [],
                durationMs: performance.now() - startTime
            };
        }
        
        // 2. 批量向量化
        onProgress?.({ phase: 'embedding', current: 0, total: entries.length, message: '向量化知识...' });
        
        const embeddings: Float32Array[] = [];
        const batchSize = 32;
        
        for (let i = 0; i < entries.length; i += batchSize) {
            const batch = entries.slice(i, i + batchSize);
            const texts = batch.map(e => e.text);
            
            try {
                const batchEmbeddings = await this.embeddingService.embedBatch(texts);
                embeddings.push(...batchEmbeddings);
                
                onProgress?.({
                    phase: 'embedding',
                    current: Math.min(i + batchSize, entries.length),
                    total: entries.length,
                    message: `向量化: ${Math.min(i + batchSize, entries.length)}/${entries.length}`
                });
            } catch (error: any) {
                console.error(`[KnowledgeIndexer] 批次 ${i}-${i + batchSize} 向量化失败:`, error.message);
                batch.forEach(e => errors.push({ id: e.id, error: error.message }));
            }
        }
        
        // 3. 存储到向量数据库
        onProgress?.({ phase: 'storing', current: 0, total: entries.length, message: '存储向量...' });
        
        const validEntries: Array<{ 
            entry: KnowledgeEntry; 
            embedding: Float32Array;
            visualEmbedding?: Float32Array;
            layoutEmbedding?: Float32Array;
        }> = [];
        
        for (let i = 0; i < entries.length; i++) {
            if (embeddings[i]) {
                validEntries.push({ 
                    entry: entries[i], 
                    embedding: embeddings[i],
                    visualEmbedding: undefined, 
                    layoutEmbedding: undefined
                });
                byType[entries[i].type]++;
            }
        }
        
        if (validEntries.length > 0) {
            try {
                await this.vectorStore.upsert(validEntries);
                onProgress?.({
                    phase: 'storing',
                    current: validEntries.length,
                    total: entries.length,
                    message: `存储完成: ${validEntries.length} 条`
                });
            } catch (error: any) {
                console.error('[KnowledgeIndexer] 存储失败:', error.message);
                validEntries.forEach(e => errors.push({ id: e.entry.id, error: error.message }));
            }
        }
        
        const durationMs = performance.now() - startTime;
        
        onProgress?.({
            phase: 'complete',
            current: validEntries.length,
            total: entries.length,
            message: `索引完成: ${validEntries.length} 条, 耗时 ${(durationMs / 1000).toFixed(1)}s`
        });
        
        console.log(`[KnowledgeIndexer] ✅ 索引完成: ${validEntries.length} 条, 耗时 ${(durationMs / 1000).toFixed(1)}s`);
        
        return {
            success: errors.length === 0,
            totalIndexed: validEntries.length,
            byType,
            errors,
            durationMs
        };
    }
    
    /**
     * 增量索引单个知识条目
     */
    async indexOne(
        entry: KnowledgeEntry, 
        embeddings?: { 
            visual?: Float32Array; 
            layout?: Float32Array; 
        }
    ): Promise<boolean> {
        try {
            const embedding = await this.embeddingService.embed(entry.text);
            await this.vectorStore.upsert([{ 
                entry, 
                embedding,
                visualEmbedding: embeddings?.visual,
                layoutEmbedding: embeddings?.layout
            }]);
            return true;
        } catch (error: any) {
            console.error(`[KnowledgeIndexer] 索引 ${entry.id} 失败:`, error.message);
            return false;
        }
    }
    
    /**
     * 删除索引
     */
    async removeIndex(ids: string[]): Promise<number> {
        return this.vectorStore.delete(ids);
    }
    
    /**
     * 重建全部索引
     */
    async rebuildIndex(
        data: RawKnowledgeData,
        onProgress?: IndexProgressCallback
    ): Promise<IndexResult> {
        console.log('[KnowledgeIndexer] 重建索引...');
        
        // 清空现有索引
        await this.vectorStore.clear();
        
        // 重新索引
        return this.indexAll(data, onProgress);
    }
    
    /**
     * 转换卖点数据
     */
    private convertSellingPoints(items: any[]): KnowledgeEntry[] {
        return items.map((item, index) => ({
            id: item.id || `sp_${index}`,
            type: 'selling_point' as KnowledgeType,
            title: item.title || '',
            text: this.buildSearchText(item.title, item.description, item.detail),
            description: item.description,
            metadata: {
                source: (item.source || 'system') as KnowledgeSource,
                categories: item.categories || [],
                keywords: item.keywords || [],
                priority: item.priority || 3,
                createdAt: item.createdAt || new Date().toISOString(),
                usageCount: item.usageCount || 0,
                extra: {
                    labelStyle: item.labelStyle,
                    suggestedColors: item.suggestedColors
                }
            }
        }));
    }
    
    /**
     * 转换痛点数据
     */
    private convertPainPoints(items: any[]): KnowledgeEntry[] {
        return items.map((item, index) => ({
            id: item.id || `pp_${index}`,
            type: 'pain_point' as KnowledgeType,
            title: item.title || '',
            text: this.buildSearchText(
                item.title,
                item.scenario,
                item.userVoice,
                item.solutionTitle,
                item.solutionDescription
            ),
            description: item.scenario,
            metadata: {
                source: (item.source || 'system') as KnowledgeSource,
                categories: item.categories || [],
                keywords: [],
                priority: item.severity || 3,
                createdAt: item.createdAt || new Date().toISOString(),
                usageCount: item.usageCount || 0,
                extra: {
                    type: item.type,
                    userVoice: item.userVoice,
                    solutionTitle: item.solutionTitle,
                    solutionDescription: item.solutionDescription
                }
            }
        }));
    }
    
    /**
     * 转换配色数据
     */
    private convertColorSchemes(items: any[]): KnowledgeEntry[] {
        return items.map((item, index) => ({
            id: item.id || `cs_${index}`,
            type: 'color_scheme' as KnowledgeType,
            title: item.name || '',
            text: this.buildSearchText(
                item.name,
                item.description,
                ...(item.emotions || [])
            ),
            description: item.description,
            metadata: {
                source: (item.source || 'system') as KnowledgeSource,
                categories: item.categories || [],
                keywords: item.emotions || [],
                priority: 3,
                createdAt: item.createdAt || new Date().toISOString(),
                usageCount: item.usageCount || 0,
                extra: {
                    primary: item.primary?.hex || item.primary,
                    secondary: item.secondary?.hex || item.secondary,
                    accent: item.accent?.hex || item.accent,
                    emotions: item.emotions,
                    scenes: item.scenes
                }
            }
        }));
    }
    
    /**
     * 转换文案模板数据
     */
    private convertCopyTemplates(items: any[]): KnowledgeEntry[] {
        return items.map((item, index) => ({
            id: item.id || `ct_${index}`,
            type: 'copy_template' as KnowledgeType,
            title: item.name || '',
            text: this.buildSearchText(item.name, item.content),
            description: item.content,
            metadata: {
                source: (item.source || 'user') as KnowledgeSource,
                categories: item.categories || [],
                keywords: item.scenes || [],
                priority: 3,
                createdAt: item.createdAt || new Date().toISOString(),
                usageCount: item.usageCount || 0,
                extra: {
                    type: item.type,
                    variables: item.variables
                }
            }
        }));
    }
    
    /**
     * 构建搜索文本 (用于向量化)
     */
    private buildSearchText(...parts: (string | undefined)[]): string {
        return parts
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
    
    /**
     * 获取索引统计
     */
    async getStats(): Promise<{
        totalCount: number;
        byType: Record<string, number>;
    }> {
        const count = await this.vectorStore.count();
        return {
            totalCount: count,
            byType: {}  // 需要额外查询实现
        };
    }
}

export default KnowledgeIndexer;
