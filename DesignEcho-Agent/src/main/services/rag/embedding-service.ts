/**
 * 嵌入服务
 * 
 * 使用 @xenova/transformers 加载本地 ONNX 模型进行文本向量化
 */

import { EmbeddingConfig, DEFAULT_EMBEDDING_CONFIG } from './types';

// 动态导入 transformers.js
let pipeline: any = null;

/**
 * 嵌入服务类
 */
export class EmbeddingService {
    private extractor: any = null;
    private visualExtractor: any = null;
    private config: EmbeddingConfig;
    private initialized = false;
    private initPromise: Promise<void> | null = null;
    
    constructor(config?: Partial<EmbeddingConfig>) {
        this.config = { ...DEFAULT_EMBEDDING_CONFIG, ...config };
    }
    
    /**
     * 初始化嵌入模型
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;
        if (this.initPromise) return this.initPromise;
        
        this.initPromise = this._doInitialize();
        await this.initPromise;
    }
    
    private async _doInitialize(): Promise<void> {
        console.log(`[EmbeddingService] 加载嵌入模型...`);
        const startTime = performance.now();
        
        try {
            // 动态导入 transformers.js (使用 Function 构造器绕过 TypeScript 转换)
            if (!pipeline) {
                // 使用 Function 构造器确保真正的 ES Module 动态导入
                const dynamicImport = new Function('specifier', 'return import(specifier)');
                const transformers = await dynamicImport('@xenova/transformers');
                pipeline = transformers.pipeline;
            }
            
            this.extractor = await pipeline(
                'feature-extraction',
                this.config.modelId,
                { 
                    quantized: this.config.quantized,
                    cache_dir: this.config.cachePath
                }
            );
            this.initialized = true;
            const elapsed = (performance.now() - startTime).toFixed(0);
            console.log(`[EmbeddingService] ✅ 文本模型加载完成 (${elapsed}ms)`);
        } catch (error: any) {
            console.error('[EmbeddingService] 模型加载失败:', error.message);
            throw new Error(`嵌入模型加载失败: ${error.message}`);
        }
    }
    
    /**
     * 获取视觉向量 (CLIP)
     */
    async embedImage(imageInput: any): Promise<Float32Array> {
        await this.initialize();
        
        try {
            if (!this.visualExtractor) {
                console.log(`[EmbeddingService] 加载视觉模型: ${this.config.visualModelId}`);
                if (!pipeline) {
                     const dynamicImport = new Function('specifier', 'return import(specifier)');
                     const transformers = await dynamicImport('@xenova/transformers');
                     pipeline = transformers.pipeline;
                }
                this.visualExtractor = await pipeline(
                    'image-feature-extraction', 
                    this.config.visualModelId,
                    { 
                        quantized: this.config.quantized,
                        cache_dir: this.config.cachePath
                    }
                );
            }
            
            const output = await this.visualExtractor(imageInput);
            
            return new Float32Array(output.data);
        } catch (error: any) {
            console.error('[EmbeddingService] 视觉向量化失败:', error.message);
            throw new Error(`视觉向量化失败: ${error.message}`);
        }
    }

    /**
     * 将单个文本转换为向量
     */
    async embed(text: string): Promise<Float32Array> {
        await this.initialize();
        
        if (!text || text.trim().length === 0) {
            throw new Error('输入文本不能为空');
        }
        
        try {
            const output = await this.extractor(text, {
                pooling: 'mean',
                normalize: true
            });
            
            return new Float32Array(output.data);
        } catch (error: any) {
            console.error('[EmbeddingService] 向量化失败:', error.message);
            throw new Error(`文本向量化失败: ${error.message}`);
        }
    }
    
    /**
     * 批量将文本转换为向量
     */
    async embedBatch(texts: string[]): Promise<Float32Array[]> {
        if (texts.length === 0) return [];
        
        await this.initialize();
        
        const results: Float32Array[] = [];
        const batchSize = this.config.batchSize;
        
        // 分批处理
        for (let i = 0; i < texts.length; i += batchSize) {
            const batch = texts.slice(i, i + batchSize);
            const batchResults = await Promise.all(
                batch.map(text => this.embed(text))
            );
            results.push(...batchResults);
            
            // 进度日志
            if (texts.length > batchSize) {
                const progress = Math.min(100, Math.round((i + batchSize) / texts.length * 100));
                console.log(`[EmbeddingService] 向量化进度: ${progress}%`);
            }
        }
        
        return results;
    }
    
    /**
     * 计算两个向量的余弦相似度
     */
    static cosineSimilarity(a: Float32Array, b: Float32Array): number {
        if (a.length !== b.length) {
            throw new Error('向量维度不匹配');
        }
        
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        
        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        
        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }
    
    /**
     * 获取模型维度
     */
    getDimension(type: 'text' | 'visual' = 'text'): number {
        return 512;
    }
    
    /**
     * 获取模型ID
     */
    getModelId(type: 'text' | 'visual' = 'text'): string {
        return type === 'text' ? this.config.modelId : this.config.visualModelId;
    }
    
    /**
     * 检查服务是否已初始化
     */
    isInitialized(): boolean {
        return this.initialized;
    }
    
    /**
     * 释放资源
     */
    dispose(): void {
        this.extractor = null;
        this.visualExtractor = null;
        this.initialized = false;
        this.initPromise = null;
    }
}

// 单例实例
let embeddingServiceInstance: EmbeddingService | null = null;

/**
 * 获取嵌入服务单例
 */
export function getEmbeddingService(config?: Partial<EmbeddingConfig>): EmbeddingService {
    if (!embeddingServiceInstance) {
        embeddingServiceInstance = new EmbeddingService(config);
    }
    return embeddingServiceInstance;
}

export default EmbeddingService;
