# RAG 知识库重构与个性化设计方案

## 📋 概述

本方案针对 DesignEcho Agent 的知识库系统进行全面重构，引入向量数据库和 RAG（检索增强生成）能力，同时支持设计师个性化知识管理和视觉偏好。

---

## 🎯 核心目标

1. **语义检索能力** - 从关键词匹配升级为语义相似度搜索
2. **设计师个性化** - 每位设计师拥有独立的知识偏好配置
3. **动态学习** - 系统从设计师操作中自动学习和优化
4. **UI 适配** - 界面根据设计师视觉习惯动态调整

---

## 📚 技术支撑

### 1. 服装变形与纹理保持技术

| 技术 | 来源 | 应用价值 |
|------|------|----------|
| **TPS (薄板样条)** | VITON/CP-VTON | 柔性变形，保持纹理细节 |
| **ARAP (尽量刚性)** | ETH Zurich | 保护花边/袜口等局部刚性区域 |
| **二阶差分约束** | CVPR 2020 ACGPN | 防止过度扭曲，保留花纹 |
| **TPD 模型** | Texture-Preserving Diffusion | 无额外编码器的高保真纹理转移 |
| **GraVITON** | BAAI Research | 图基变形 + 上下文细节保护 |

### 2. RAG 技术栈选择

#### Embedding 模型

| 方案 | 模型 | 维度 | 中文支持 | 特点 |
|------|------|------|----------|------|
| **推荐** | `bge-small-zh-v1.5` | 512 | ✅ 优秀 | 中文优化，体积小 |
| 备选1 | `text2vec-base-chinese` | 768 | ✅ 优秀 | 更高质量，体积大 |
| 备选2 | `multilingual-e5-small` | 384 | ✅ 支持 | 多语言通用 |

#### 向量数据库

| 方案 | 特点 | 选择理由 |
|------|------|----------|
| **LanceDB** | 本地运行、零配置、支持 Node.js | ✅ 推荐：与 Electron 集成简单 |
| Chroma | 需要额外服务 | ❌ 增加部署复杂度 |
| Pinecone | 云服务、需要网络 | ❌ 不符合本地优先原则 |

---

## 🏗️ 架构设计

### 系统架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        RAG 增强知识库架构                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                     知识来源层 (Sources)                            │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐              │    │
│  │  │ 系统知识 │ │ 用户知识 │ │ 知识包   │ │ 对话学习 │              │    │
│  │  │ (硬编码) │ │ (JSON)   │ │ (导入)   │ │ (动态)   │              │    │
│  │  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘              │    │
│  │       └────────────┴────────────┴────────────┘                     │    │
│  └───────────────────────────────────┬────────────────────────────────┘    │
│                                      ▼                                      │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                     向量化层 (Embedding)                            │    │
│  │                                                                     │    │
│  │  ┌─────────────────────────────────────────────────────────────┐   │    │
│  │  │ EmbeddingService                                             │   │    │
│  │  │ ├─ @xenova/transformers (ONNX Runtime)                       │   │    │
│  │  │ ├─ bge-small-zh-v1.5 (中文嵌入模型)                          │   │    │
│  │  │ └─ 批量向量化 + 增量更新                                      │   │    │
│  │  └─────────────────────────────────────────────────────────────┘   │    │
│  └───────────────────────────────────┬────────────────────────────────┘    │
│                                      ▼                                      │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                     存储层 (Vector Store)                          │    │
│  │                                                                     │    │
│  │  ┌─────────────────────────────────────────────────────────────┐   │    │
│  │  │ LanceDB (本地向量数据库)                                      │   │    │
│  │  │                                                               │   │    │
│  │  │ Table: knowledge_vectors                                      │   │    │
│  │  │ ┌────────┬──────────┬─────────────┬──────────────────────┐  │   │    │
│  │  │ │ id     │ text     │ embedding   │ metadata             │  │   │    │
│  │  │ ├────────┼──────────┼─────────────┼──────────────────────┤  │   │    │
│  │  │ │ sp_001 │ 纯棉透气 │ [0.12,...]  │ {type, category,...} │  │   │    │
│  │  │ └────────┴──────────┴─────────────┴──────────────────────┘  │   │    │
│  │  └─────────────────────────────────────────────────────────────┘   │    │
│  └───────────────────────────────────┬────────────────────────────────┘    │
│                                      ▼                                      │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                     检索层 (Retrieval)                             │    │
│  │                                                                     │    │
│  │  用户查询: "袜子透气性怎么提高?"                                    │    │
│  │                                                                     │    │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐            │    │
│  │  │ 语义检索    │    │ 关键词检索  │    │ 个性化加权  │            │    │
│  │  │             │    │             │    │             │            │    │
│  │  │ 向量相似度  │ +  │ BM25/TF-IDF │ +  │ 设计师偏好  │            │    │
│  │  │ Top-K       │    │ 精确匹配    │    │ 历史权重    │            │    │
│  │  └─────────────┘    └─────────────┘    └─────────────┘            │    │
│  │             │               │                  │                   │    │
│  │             └───────────────┼──────────────────┘                   │    │
│  │                             ▼                                      │    │
│  │                    ┌─────────────┐                                 │    │
│  │                    │ RRF 重排序  │                                 │    │
│  │                    │ + 去重合并  │                                 │    │
│  │                    └─────────────┘                                 │    │
│  └───────────────────────────────────┬────────────────────────────────┘    │
│                                      ▼                                      │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │                     Agent 集成层                                    │    │
│  │                                                                     │    │
│  │  System Prompt Injection:                                          │    │
│  │  ┌─────────────────────────────────────────────────────────────┐   │    │
│  │  │ ## 相关知识 (RAG 检索结果)                                   │   │    │
│  │  │                                                               │   │    │
│  │  │ 用户问题涉及以下知识:                                        │   │    │
│  │  │ 1. 透气排汗: 采用透气网眼设计，保持双脚干爽 [相似度: 0.92]   │   │    │
│  │  │ 2. 吸湿速干: 高科技吸湿材质，快速导汗 [相似度: 0.87]         │   │    │
│  │  │ 3. 用户痛点: 脚汗导致异味 → 推荐抗菌除臭设计                  │   │    │
│  │  └─────────────────────────────────────────────────────────────┘   │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📁 文件结构

```
DesignEcho-Agent/src/main/services/rag/
├── embedding-service.ts      # 嵌入模型服务
├── vector-store.ts           # LanceDB 向量存储封装
├── retrieval-engine.ts       # 混合检索引擎
├── knowledge-indexer.ts      # 知识索引管理
├── rag-service.ts            # RAG 主服务
└── types.ts                  # 类型定义

DesignEcho-Agent/src/main/services/designer/
├── designer-profile.service.ts    # 设计师档案服务
├── preference-learning.service.ts # 偏好学习服务
└── types.ts                       # 类型定义

DesignEcho-Agent/src/renderer/components/knowledge/
├── PersonalizedKnowledgePanel.tsx  # 个性化知识面板
├── DesignerPreferences.tsx         # 设计师偏好设置
├── SmartRecommendation.tsx         # 智能推荐组件
└── KnowledgeSearch.tsx             # 语义搜索组件
```

---

## 🔧 核心数据模型

### 1. 知识条目 (向量化存储)

```typescript
interface KnowledgeEntry {
    id: string;
    type: 'selling_point' | 'pain_point' | 'color_scheme' | 'technique' | 'case';
    
    // 文本内容 (用于向量化)
    text: string;
    title: string;
    description?: string;
    
    // 向量嵌入
    embedding?: Float32Array;
    
    // 元数据 (用于过滤)
    metadata: {
        source: 'system' | 'user' | 'learned';
        categories: string[];
        keywords: string[];
        priority: number;
        createdAt: string;
        usageCount: number;
    };
}
```

### 2. 设计师档案

```typescript
interface DesignerProfile {
    designerId: string;
    name: string;
    
    // 设计风格偏好
    stylePreferences: {
        preferredStyles: string[];        // 极简、复古、现代...
        colorTendency: 'warm' | 'cool' | 'neutral';
        designPrinciples: string[];       // 设计原则描述
    };
    
    // 工作流偏好
    workflowPreferences: {
        defaultTechnique: 'TPS' | 'MLS' | 'ARAP';
        autoCorrection: boolean;
        batchProcessing: boolean;
        previewMode: '2D' | '3D' | 'split';
    };
    
    // UI 视觉偏好
    uiPreferences: {
        theme: 'dark' | 'light' | 'auto';
        layoutMode: 'grid' | 'list' | 'compact';
        infoDensity: 'dense' | 'normal' | 'spacious';
        primaryColor: string;
    };
    
    // 检索偏好
    retrievalPreferences: {
        preferredCategories: string[];    // 优先检索的类目
        keywordBoosts: Record<string, number>; // 关键词权重提升
        excludedTopics: string[];         // 排除的主题
    };
    
    // 学习数据
    learningData: {
        frequentSearches: Array<{ query: string; count: number }>;
        clickedResults: Array<{ id: string; count: number }>;
        createdKnowledge: string[];
    };
}
```

### 3. RAG 检索结果

```typescript
interface RAGSearchResult {
    entries: Array<{
        entry: KnowledgeEntry;
        score: number;          // 综合得分 (0-1)
        semanticScore: number;  // 语义相似度
        keywordScore: number;   // 关键词匹配度
        personalBoost: number;  // 个性化加权
    }>;
    
    // 检索元数据
    metadata: {
        query: string;
        totalResults: number;
        processingTimeMs: number;
        designerId?: string;
    };
    
    // 生成的上下文 (注入到 Prompt)
    contextForPrompt: string;
}
```

---

## 🔄 核心服务实现

### 1. EmbeddingService

```typescript
// embedding-service.ts
import { pipeline, Pipeline } from '@xenova/transformers';

export class EmbeddingService {
    private extractor: Pipeline | null = null;
    private modelId = 'Xenova/bge-small-zh-v1.5';
    
    async initialize(): Promise<void> {
        if (this.extractor) return;
        
        console.log('[EmbeddingService] 加载嵌入模型...');
        this.extractor = await pipeline(
            'feature-extraction',
            this.modelId,
            { quantized: true }  // 使用量化模型减少内存
        );
        console.log('[EmbeddingService] ✅ 模型加载完成');
    }
    
    async embed(text: string): Promise<Float32Array> {
        if (!this.extractor) {
            await this.initialize();
        }
        
        const output = await this.extractor!(text, {
            pooling: 'mean',
            normalize: true
        });
        
        return new Float32Array(output.data);
    }
    
    async embedBatch(texts: string[]): Promise<Float32Array[]> {
        return Promise.all(texts.map(t => this.embed(t)));
    }
}
```

### 2. VectorStore

```typescript
// vector-store.ts
import * as lancedb from 'vectordb';

export class VectorStore {
    private db: lancedb.Connection | null = null;
    private tableName = 'knowledge_vectors';
    
    async initialize(dbPath: string): Promise<void> {
        this.db = await lancedb.connect(dbPath);
        
        // 确保表存在
        const tables = await this.db.tableNames();
        if (!tables.includes(this.tableName)) {
            await this.createTable();
        }
    }
    
    private async createTable(): Promise<void> {
        // 创建初始表结构
        await this.db!.createTable(this.tableName, [
            { id: 'init', text: 'init', embedding: new Array(512).fill(0), metadata: {} }
        ]);
    }
    
    async upsert(entries: Array<{
        id: string;
        text: string;
        embedding: Float32Array;
        metadata: Record<string, any>;
    }>): Promise<void> {
        const table = await this.db!.openTable(this.tableName);
        await table.add(entries.map(e => ({
            ...e,
            embedding: Array.from(e.embedding)
        })));
    }
    
    async search(
        queryEmbedding: Float32Array,
        limit: number = 10,
        filter?: string
    ): Promise<Array<{ id: string; text: string; score: number; metadata: any }>> {
        const table = await this.db!.openTable(this.tableName);
        
        let query = table.search(Array.from(queryEmbedding)).limit(limit);
        if (filter) {
            query = query.where(filter);
        }
        
        const results = await query.execute();
        return results.map(r => ({
            id: r.id,
            text: r.text,
            score: r._distance ? 1 - r._distance : 1,
            metadata: r.metadata
        }));
    }
}
```

### 3. RetrievalEngine (混合检索)

```typescript
// retrieval-engine.ts
export class RetrievalEngine {
    constructor(
        private embeddingService: EmbeddingService,
        private vectorStore: VectorStore,
        private designerProfileService?: DesignerProfileService
    ) {}
    
    async search(
        query: string,
        options?: {
            limit?: number;
            designerId?: string;
            categoryFilter?: string[];
        }
    ): Promise<RAGSearchResult> {
        const startTime = performance.now();
        
        // 1. 语义检索
        const queryEmbedding = await this.embeddingService.embed(query);
        const semanticResults = await this.vectorStore.search(
            queryEmbedding,
            options?.limit || 20
        );
        
        // 2. 关键词检索 (BM25 简化版)
        const keywordResults = this.keywordSearch(query, options?.limit || 20);
        
        // 3. 获取设计师偏好
        let designerProfile: DesignerProfile | null = null;
        if (options?.designerId && this.designerProfileService) {
            designerProfile = await this.designerProfileService.getProfile(options.designerId);
        }
        
        // 4. RRF 融合 + 个性化加权
        const fusedResults = this.fuseResults(
            semanticResults,
            keywordResults,
            designerProfile
        );
        
        // 5. 生成 Prompt 上下文
        const contextForPrompt = this.generateContext(fusedResults.slice(0, 5));
        
        return {
            entries: fusedResults.slice(0, options?.limit || 10),
            metadata: {
                query,
                totalResults: fusedResults.length,
                processingTimeMs: performance.now() - startTime,
                designerId: options?.designerId
            },
            contextForPrompt
        };
    }
    
    private fuseResults(
        semantic: Array<{ id: string; score: number; text: string; metadata: any }>,
        keyword: Array<{ id: string; score: number; text: string; metadata: any }>,
        profile: DesignerProfile | null
    ): RAGSearchResult['entries'] {
        const scoreMap = new Map<string, {
            entry: KnowledgeEntry;
            semanticScore: number;
            keywordScore: number;
            personalBoost: number;
        }>();
        
        // RRF (Reciprocal Rank Fusion)
        const k = 60; // RRF 参数
        
        semantic.forEach((r, rank) => {
            const existing = scoreMap.get(r.id);
            const rrfScore = 1 / (k + rank + 1);
            
            if (existing) {
                existing.semanticScore = rrfScore;
            } else {
                scoreMap.set(r.id, {
                    entry: { id: r.id, text: r.text, type: r.metadata.type, ...r.metadata } as KnowledgeEntry,
                    semanticScore: rrfScore,
                    keywordScore: 0,
                    personalBoost: 1
                });
            }
        });
        
        keyword.forEach((r, rank) => {
            const existing = scoreMap.get(r.id);
            const rrfScore = 1 / (k + rank + 1);
            
            if (existing) {
                existing.keywordScore = rrfScore;
            } else {
                scoreMap.set(r.id, {
                    entry: { id: r.id, text: r.text, type: r.metadata.type, ...r.metadata } as KnowledgeEntry,
                    semanticScore: 0,
                    keywordScore: rrfScore,
                    personalBoost: 1
                });
            }
        });
        
        // 个性化加权
        if (profile) {
            scoreMap.forEach((value, id) => {
                // 类目偏好加权
                if (profile.retrievalPreferences.preferredCategories.some(
                    cat => value.entry.metadata?.categories?.includes(cat)
                )) {
                    value.personalBoost *= 1.5;
                }
                
                // 历史点击加权
                const clickData = profile.learningData.clickedResults.find(c => c.id === id);
                if (clickData) {
                    value.personalBoost *= (1 + Math.log(clickData.count + 1) * 0.2);
                }
            });
        }
        
        // 计算最终得分并排序
        return Array.from(scoreMap.values())
            .map(v => ({
                ...v,
                score: (v.semanticScore * 0.6 + v.keywordScore * 0.4) * v.personalBoost
            }))
            .sort((a, b) => b.score - a.score);
    }
    
    private generateContext(results: RAGSearchResult['entries']): string {
        if (results.length === 0) return '';
        
        const lines = [
            '## 相关知识参考',
            ''
        ];
        
        results.forEach((r, i) => {
            const entry = r.entry;
            lines.push(`${i + 1}. **${entry.title || entry.text.slice(0, 50)}** [相关度: ${(r.score * 100).toFixed(0)}%]`);
            if (entry.description) {
                lines.push(`   ${entry.description}`);
            }
            lines.push('');
        });
        
        return lines.join('\n');
    }
    
    private keywordSearch(query: string, limit: number): Array<{ id: string; score: number; text: string; metadata: any }> {
        // 简化的关键词搜索实现
        // 实际应使用 BM25 或 TF-IDF
        // 这里暂时返回空数组，后续实现
        return [];
    }
}
```

---

## 🎨 UI 重构方案

### 1. 设计师偏好设置组件

```tsx
// DesignerPreferences.tsx
interface DesignerPreferencesProps {
    profile: DesignerProfile;
    onUpdate: (updates: Partial<DesignerProfile>) => void;
}

export const DesignerPreferences: React.FC<DesignerPreferencesProps> = ({ profile, onUpdate }) => {
    return (
        <div className="designer-preferences">
            {/* 设计风格偏好 */}
            <section className="preference-section">
                <h3>🎨 设计风格</h3>
                <div className="style-tags">
                    {['极简', '现代', '复古', '轻奢', '可爱', '运动'].map(style => (
                        <button
                            key={style}
                            className={profile.stylePreferences.preferredStyles.includes(style) ? 'active' : ''}
                            onClick={() => toggleStyle(style)}
                        >
                            {style}
                        </button>
                    ))}
                </div>
            </section>
            
            {/* 工作流偏好 */}
            <section className="preference-section">
                <h3>⚙️ 工作流</h3>
                <div className="preference-row">
                    <label>默认变形算法</label>
                    <select value={profile.workflowPreferences.defaultTechnique}>
                        <option value="TPS">TPS (平滑)</option>
                        <option value="MLS">MLS (快速)</option>
                        <option value="ARAP">ARAP (刚性保护)</option>
                    </select>
                </div>
            </section>
            
            {/* 检索偏好 */}
            <section className="preference-section">
                <h3>🔍 检索偏好</h3>
                <div className="category-priorities">
                    {/* 拖拽排序的类目优先级 */}
                </div>
            </section>
        </div>
    );
};
```

### 2. 智能推荐面板

```tsx
// SmartRecommendation.tsx
interface SmartRecommendationProps {
    currentContext: {
        selectedLayer?: string;
        currentTask?: string;
        recentActions?: string[];
    };
}

export const SmartRecommendation: React.FC<SmartRecommendationProps> = ({ currentContext }) => {
    const [recommendations, setRecommendations] = useState<RAGSearchResult | null>(null);
    
    useEffect(() => {
        if (currentContext.currentTask) {
            fetchRecommendations(currentContext);
        }
    }, [currentContext]);
    
    return (
        <div className="smart-recommendation">
            <div className="rec-header">
                <span>💡</span>
                <h4>智能推荐</h4>
            </div>
            
            {recommendations?.entries.map((entry, i) => (
                <div key={entry.entry.id} className="rec-card">
                    <div className="rec-score">
                        {(entry.score * 100).toFixed(0)}%
                    </div>
                    <div className="rec-content">
                        <h5>{entry.entry.title}</h5>
                        <p>{entry.entry.description}</p>
                    </div>
                    <button className="rec-apply">应用</button>
                </div>
            ))}
        </div>
    );
};
```

---

## 📋 实施路线图

### Phase 1: RAG 基础设施 ✅ 已完成

| 任务 | 说明 | 产出 | 状态 |
|------|------|------|------|
| 安装依赖 | `@xenova/transformers`, `@lancedb/lancedb` | package.json 更新 | ✅ |
| EmbeddingService | 加载 bge-small-zh 模型 | embedding-service.ts | ✅ |
| VectorStore | LanceDB 封装 | vector-store.ts | ✅ |
| RetrievalEngine | 混合检索实现 (RRF + 个性化加权) | retrieval-engine.ts | ✅ |

### Phase 2: 知识库重构 ✅ 已完成

| 任务 | 说明 | 产出 | 状态 |
|------|------|------|------|
| 数据模型 | KnowledgeEntry, DesignerProfile, SearchFilters | rag/types.ts | ✅ |
| 知识索引器 | 批量向量化、增量更新 | knowledge-indexer.ts | ✅ |
| DesignerProfileService | 设计师档案管理、偏好存储 | designer/designer-profile.service.ts | ✅ |
| RAGService | 统一服务主类 | rag-service.ts | ✅ |

### Phase 3: UI 重构 ✅ 已完成

| 任务 | 说明 | 产出 | 状态 |
|------|------|------|------|
| IPC 处理程序 | RAG + Designer IPC handlers | ipc-handlers/rag-handlers.ts | ✅ |
| 渲染进程服务 | RAG 客户端封装 | renderer/services/rag.service.ts | ✅ |
| 设计师偏好组件 | 风格/工作流/UI/检索偏好设置 | DesignerSettings.tsx | ✅ |
| 语义搜索组件 | 智能检索 + 过滤 + 结果展示 | KnowledgeSearch.tsx | ✅ |

### Phase 4: Agent 集成 ✅ 已完成

| 任务 | 说明 | 产出 | 状态 |
|------|------|------|------|
| Prompt 集成 | RAG 检索结果自动注入 Prompt | agent-orchestrator.ts | ✅ |
| 个性化检索 | 基于 designerId 的个性化加权 | retrieval-engine.ts | ✅ |
| 学习数据记录 | 搜索/点击/应用自动记录 | designer-profile.service.ts | ✅ |

### Phase 5: 待完成

| 任务 | 说明 | 产出 | 状态 |
|------|------|------|------|
| 偏好学习服务 | 从操作中自动学习偏好 | preference-learning.service.ts | ⏳ |
| 智能推荐面板 | 上下文感知主动推荐 | SmartRecommendation.tsx | ⏳ |
| 主题适配 | 根据 UI 偏好动态切换主题 | theme-adapter.ts | ⏳ |
| 单元测试 | 验证检索质量 | *.test.ts | ⏳ |
| 集成测试 | 端到端验证 | integration.test.ts | ⏳ |

---

## 🔄 依赖安装

```bash
# 安装 RAG 相关依赖 (已完成)
cd DesignEcho-Agent
npm install @xenova/transformers @lancedb/lancedb
```

> **注意**: `vectordb` 包已弃用，改用 `@lancedb/lancedb`

---

## ✅ 验收标准

1. **语义检索准确率** > 85% (Top-5 召回)
2. **检索延迟** < 200ms
3. **个性化加权有效性**: 点击率提升 > 20%
4. **UI 响应性**: 推荐更新 < 500ms
5. **模型加载时间** < 5s (首次)

---

## 📝 注意事项

1. **模型缓存**: 首次加载模型会下载到本地缓存，后续使用无需网络
2. **内存占用**: bge-small-zh 量化版约 50MB 内存
3. **向量库大小**: 10000 条知识约 50MB 磁盘空间
4. **增量索引**: 支持增量更新，无需全量重建索引
