/**
 * 向量存储服务
 * 
 * 使用 LanceDB 作为本地向量数据库
 */

import * as path from 'path';
import { app } from 'electron';
import { VectorStoreConfig, DEFAULT_VECTOR_STORE_CONFIG, KnowledgeEntry, KnowledgeMetadata } from './types';

// 动态导入 LanceDB
let lancedb: any = null;

function parseMetadata(raw: string): KnowledgeMetadata {
    try {
        return JSON.parse(raw);
    } catch {
        return {
            source: 'system',
            categories: [],
            keywords: [],
            priority: 0,
            createdAt: '',
            usageCount: 0,
            extra: {}
        };
    }
}

/**
 * 向量存储记录
 */
interface VectorRecord {
    id: string;
    text: string;
    title: string;
    type: string;
    embedding: number[];
    visual_embedding?: number[];
    layout_embedding?: number[];
    metadata: string;
}

/**
 * 向量存储服务类
 */
export class VectorStore {
    private db: any = null;
    private table: any = null;
    private config: VectorStoreConfig;
    private initialized = false;
    
    constructor(config?: Partial<VectorStoreConfig>) {
        const defaultDbPath = path.join(app.getPath('userData'), 'vector-db');
        this.config = {
            dbPath: defaultDbPath,
            ...DEFAULT_VECTOR_STORE_CONFIG,
            ...config
        } as VectorStoreConfig;
    }
    
    /**
     * 初始化向量数据库
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;
        
        console.log(`[VectorStore] 初始化向量数据库: ${this.config.dbPath}`);
        
        try {
            // 动态导入 LanceDB
            if (!lancedb) {
                lancedb = await import('@lancedb/lancedb');
            }
            
            // 连接数据库
            this.db = await lancedb.connect(this.config.dbPath);
            
            // 检查表是否存在
            const tableNames = await this.db.tableNames();
            
            if (tableNames.includes(this.config.tableName)) {
                this.table = await this.db.openTable(this.config.tableName);
                console.log(`[VectorStore] ✅ 已打开现有表: ${this.config.tableName}`);
            } else {
                // 创建新表 (需要初始数据)
                await this.createTable();
            }
            
            this.initialized = true;
        } catch (error: any) {
            console.error('[VectorStore] 初始化失败:', error.message);
            throw new Error(`向量数据库初始化失败: ${error.message}`);
        }
    }
    
    /**
     * 创建新表
     */
    private async createTable(): Promise<void> {
        console.log(`[VectorStore] 创建新表: ${this.config.tableName}`);
        
        // 创建初始记录
        const initRecord: VectorRecord = {
            id: '__init__',
            text: 'initialization record',
            title: 'Init',
            type: 'system',
            embedding: new Array(this.config.textDimension).fill(0),
            visual_embedding: new Array(this.config.visualDimension).fill(0),
            layout_embedding: new Array(this.config.visualDimension).fill(0),
            metadata: JSON.stringify({ source: 'system', categories: [], keywords: [], priority: 0, createdAt: new Date().toISOString(), usageCount: 0 })
        };
        
        this.table = await this.db.createTable(this.config.tableName, [initRecord]);
        console.log(`[VectorStore] ✅ 表创建成功`);
    }
    
    /**
     * 插入或更新知识条目
     */
    async upsert(entries: Array<{
        entry: KnowledgeEntry;
        embedding: Float32Array;
        visualEmbedding?: Float32Array;
        layoutEmbedding?: Float32Array;
    }>): Promise<{ inserted: number; updated: number }> {
        await this.initialize();
        
        if (entries.length === 0) return { inserted: 0, updated: 0 };
        
        const records: VectorRecord[] = entries.map(({ entry, embedding, visualEmbedding, layoutEmbedding }) => ({
            id: entry.id,
            text: entry.text,
            title: entry.title,
            type: entry.type,
            embedding: Array.from(embedding),
            visual_embedding: visualEmbedding ? Array.from(visualEmbedding) : undefined,
            layout_embedding: layoutEmbedding ? Array.from(layoutEmbedding) : undefined,
            metadata: JSON.stringify(entry.metadata)
        }));
        
        try {
            // LanceDB 的 add 会自动处理 upsert
            await this.table.add(records);
            
            console.log(`[VectorStore] 已写入 ${records.length} 条记录`);
            return { inserted: records.length, updated: 0 };
        } catch (error: any) {
            console.error('[VectorStore] 写入失败:', error.message);
            throw new Error(`向量写入失败: ${error.message}`);
        }
    }
    
    /**
     * 语义搜索
     */
    async search(
        queryEmbedding: Float32Array,
        options?: {
            limit?: number;
            filter?: string;
            distanceType?: 'cosine' | 'euclidean' | 'dot';
            vectorColumn?: 'embedding' | 'visual_embedding' | 'layout_embedding';
        }
    ): Promise<Array<{
        id: string;
        text: string;
        title: string;
        type: string;
        score: number;
        metadata: KnowledgeMetadata;
    }>> {
        await this.initialize();
        
        const limit = options?.limit || 10;
        const distanceType = options?.distanceType || this.config.distanceType;
        const vectorColumn = options?.vectorColumn || 'embedding';
        
        try {
            let query = this.table.search(Array.from(queryEmbedding));
            if (typeof (query as any).column === 'function') {
                query = (query as any).column(vectorColumn);
            } else if (typeof (query as any).vectorColumn === 'function') {
                query = (query as any).vectorColumn(vectorColumn);
            }
            
            // 设置距离类型
            if (distanceType === 'cosine') {
                query = query.distanceType('cosine');
            }
            
            // 设置限制
            query = query.limit(limit);
            
            // 应用过滤器
            if (options?.filter) {
                query = query.where(options.filter);
            }
            
            const results = await query.toArray();
            const filtered = results.filter((r: any) => r.id !== '__init__');

            return filtered.map((r: any) => {
                const distance = r._distance ?? 0;
                const rawScore = distanceType === 'cosine' ? 1 - distance : 1 / (1 + distance);
                const score = Math.max(0, Math.min(1, rawScore));
                const metadata = parseMetadata(r.metadata);
                return { id: r.id, text: r.text, title: r.title, type: r.type, score, metadata };
            });
        } catch (error: any) {
            console.error('[VectorStore] 搜索失败:', error.message);
            throw new Error(`向量搜索失败: ${error.message}`);
        }
    }
    
    /**
     * 根据 ID 获取记录
     */
    async getById(id: string): Promise<{
        id: string;
        text: string;
        title: string;
        type: string;
        embedding: Float32Array;
        metadata: KnowledgeMetadata;
    } | null> {
        await this.initialize();
        
        try {
            const results = await this.table
                .search([])  // 空搜索
                .where(`id = '${id}'`)
                .limit(1)
                .toArray();
            
            if (results.length === 0) return null;
            
            const r = results[0];
            return {
                id: r.id,
                text: r.text,
                title: r.title,
                type: r.type,
                embedding: new Float32Array(r.embedding),
                metadata: JSON.parse(r.metadata)
            };
        } catch (error: any) {
            console.error('[VectorStore] 获取记录失败:', error.message);
            return null;
        }
    }
    
    /**
     * 删除记录
     */
    async delete(ids: string[]): Promise<number> {
        await this.initialize();
        
        if (ids.length === 0) return 0;
        
        try {
            // LanceDB 删除语法
            const whereClause = `id IN (${ids.map(id => `'${id}'`).join(', ')})`;
            await this.table.delete(whereClause);
            
            console.log(`[VectorStore] 已删除 ${ids.length} 条记录`);
            return ids.length;
        } catch (error: any) {
            console.error('[VectorStore] 删除失败:', error.message);
            return 0;
        }
    }
    
    /**
     * 列出样本记录（用于检索验证）
     * 使用向量搜索召回（query().where() 在纯向量表上可能返回空），保证有结果时能正确展示
     */
    async listSample(limit = 10): Promise<Array<{ id: string; title: string; textSnippet: string; type: string }>> {
        await this.initialize();
        try {
            const dim = this.config.textDimension;
            const queryVector = new Array(dim).fill(1 / Math.sqrt(dim));
            const results = await this.table.search(queryVector)
                .where("id != '__init__'")
                .select(['id', 'title', 'text', 'type'])
                .limit(limit)
                .toArray();
            return results.map((r: any) => {
                let textSnippet = '';
                if (typeof r.text === 'string') {
                    textSnippet = r.text.length > 200 ? r.text.slice(0, 200) + '...' : r.text;
                }
                return {
                    id: r.id || '',
                    title: r.title || '',
                    textSnippet,
                    type: r.type || ''
                };
            });
        } catch (error: any) {
            console.error('[VectorStore] listSample 失败:', error.message);
            return [];
        }
    }

    /**
     * 获取记录总数
     */
    async count(): Promise<number> {
        await this.initialize();
        
        try {
            const results = await this.table.countRows();
            return Math.max(0, results - 1);  // 减去初始化记录
        } catch {
            return 0;
        }
    }
    
    /**
     * 清空所有记录
     */
    async clear(): Promise<void> {
        await this.initialize();
        
        try {
            // 删除并重建表
            await this.db.dropTable(this.config.tableName);
            await this.createTable();
            console.log('[VectorStore] 已清空所有记录');
        } catch (error: any) {
            console.error('[VectorStore] 清空失败:', error.message);
        }
    }
    
    /**
     * 检查服务是否已初始化
     */
    isInitialized(): boolean {
        return this.initialized;
    }
    
    /**
     * 获取数据库路径
     */
    getDbPath(): string {
        return this.config.dbPath;
    }
}

// 单例实例
let vectorStoreInstance: VectorStore | null = null;

/**
 * 获取向量存储单例
 */
export function getVectorStore(config?: Partial<VectorStoreConfig>): VectorStore {
    if (!vectorStoreInstance) {
        vectorStoreInstance = new VectorStore(config);
    }
    return vectorStoreInstance;
}

export default VectorStore;
