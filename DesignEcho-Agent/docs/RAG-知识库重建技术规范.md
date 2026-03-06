# DesignEcho 智能体知识库重建技术规范 (Neuro-Symbolic Design Graph RAG)

## 1. 概述 (Overview)

本规范旨在指导 DesignEcho Agent 知识库系统的全面重构。目标是将当前的**单模态文本检索系统**升级为**多模态神经符号化设计图谱 (Neuro-Symbolic Design Graph)**。

新系统将具备以下核心能力：
1.  **视觉理解**：通过 CLIP 模型实现“以图搜图”和“风格检索”。
2.  **结构感知**：通过 DOM 树解析 + 关系签名（Relational Signature）+ 轻量图存储（SQLite），理解布局与组件关系。
3.  **原子化复用**：将 PSD 拆解为可复用的原子组件（标题、价格、主图等）。
4.  **健壮性降级**：支持从完美 PSD 到损坏文件的分级处理策略。

---

## 2. 核心架构 (Architecture)

系统采用 **"双通道摄入 - 多维存储 - 混合检索"** 的架构设计。

### 2.1 逻辑视图

```mermaid
graph TD
    User[设计师] --> Agent[Unified Agent]
    Agent --> Retrieval[多模态检索引擎]
    
    subgraph "Knowledge Base (LanceDB)"
        Vector_Visual[Visual Index (CLIP)]
        Vector_Struct[Layout Signature Index (RelSig)]
        Vector_Text[Text Index (BGE)]
        Graph_Topo[Edge Store (SQLite)]
    end
    
    Retrieval <--> Vector_Visual
    Retrieval <--> Vector_Struct
    Retrieval <--> Vector_Text
    
    subgraph "Ingestion Pipeline (双通道)"
        PSD_File[PSD/PSB 文件] --> Router{完整性检查}
        Router -- "Level 1: 完美" --> UXP_Parser[UXP 解析器 (Photoshop)]
        Router -- "Level 2: 仅视觉" --> AG_Parser[ag-psd 解析器 (Node.js)]
        
        UXP_Parser --> Component_Slicer[组件切片]
        AG_Parser --> Visual_Extractor[视觉提取]
        
        Component_Slicer --> Embedder[向量化服务]
        Visual_Extractor --> Embedder
    end
    
    Embedder --> Knowledge_Base
```

### 2.2 关键隐患与修正 (V1 必须项)

1.  **结构向量化的数学正确性**
    - V1 不使用“bbox flatten”作为主检索信号。
    - V1 采用 **关系签名向量（RelSig）** 做粗召回，Top-K 再做约束校验或几何重排。
2.  **图谱可查询性**
    - V1 不把图谱当 JSON 放进 metadata 当作“图数据库”。
    - 采用 **LanceDB 近邻召回 + SQLite 关系存储** 的组合，SQLite 负责边/约束/版本，LanceDB 负责相似检索。
3.  **组件切片的现实约束**
    - V1 只抽取高置信组件（显式 group、文本+底板、剪切蒙版组等）。
    - 低置信切片进入隔离区（quarantine），默认不参与检索，避免污染。
4.  **性能预算与降级**
    - V1 默认以文本检索为主，视觉/结构仅在明确需要时启用。
    - V1 强制“两段式检索”：快速召回 → Top-K 重排；并支持缓存与自动降级。

---

## 3. 数据模型 (Data Models)

### 3.1 知识条目 Schema (LanceDB)

我们将原有的单一 `KnowledgeEntry` 扩展为支持多模态的结构。

```typescript
/**
 * 多模态设计知识条目
 */
interface DesignKnowledgeEntry {
    id: string;                 // 唯一标识 (UUID)
    type: 'scene' | 'component' | 'rule';
    
    // --- 1. 基础信息 ---
    name: string;               // 标题/文件名
    description: string;        // 自动生成的描述 (VLM/Template)
    sourcePath: string;         // 原始文件路径
    previewPath: string;        // 预览图路径
    
    // --- 2. 多模态向量 (Embeddings) ---
    // 维度: 512 (CLIP/BGE 对齐)
    vec_visual: Float32Array | null;   // 视觉风格向量 (CLIP-ViT)
    vec_text: Float32Array | null;     // 语义内容向量 (BGE-Small-ZH)
    vec_struct: Float32Array | null;   // 关系签名向量 (RelSig)
    
    // --- 3. 结构化数据 (Payload) ---
    metadata: {
        // 来源信息
        projectId: string;
        author: string;
        createdAt: number;
        
        // 视觉特征
        styleTags: Record<string, number>; // e.g. { "minimalist": 0.9 }
        colorPalette: string[];            // e.g. ["#FF0000", "#FFFFFF"]
        
        // 结构特征 (仅 Component/Scene 有效)
        layerCount: number;
        dimensions: { w: number, h: number };
        
        integrity: 'perfect' | 'visual_only' | 'structure_only' | 'failed';
        confidence?: number; // 组件切片置信度 (0-1)，低置信进入隔离区
        graphRef?: string;   // SQLite 图谱引用 ID
    };
}
```

---

## 4. 核心服务设计 (Service Design)

### 4.1 摄入服务 (Ingestion Service)

负责将 PSD 文件转化为知识条目。采用 **分级降级策略**：

*   **Level 1 (Perfect)**: 调用 UXP 脚本（当 PS 运行时），获取精确的 DOM 树和渲染图。
    *   *产出*: Visual + Text + RelSig 向量 + 图谱边（写入 SQLite）。
*   **Level 2 (Structure Only)**: 调用 `ag-psd`（后台批量处理）。
    *   *产出*: Text + RelSig 向量 + 基础图谱边（可选）。
    *   *标记*: `metadata.integrity = 'structure_only'`。
*   **Level 3 (Visual Only)**: 仅提取预览与 VLM/OCR 描述。
    *   *产出*: Visual + Text 向量。
    *   *标记*: `metadata.integrity = 'visual_only'`。
*   **隔离区 (Quarantine)**: 任意阶段如遇到结构混乱/异常过多/解析不稳定，进入隔离区。

### 4.2 向量化服务 (Embedding Service)

升级现有的 `EmbeddingService`，支持多模型加载：

*   **Text Encoder**: `Xenova/bge-small-zh-v1.5` (沿用)
*   **Visual Encoder**: `Xenova/clip-vit-base-patch32` (新增，用于图像特征提取)
*   **Struct Encoder (V1)**: 关系签名向量（RelSig），不依赖训练，强调稳定性与可解释性

### 4.3 检索引擎 (Retrieval Engine)

V1 采用“两段式检索 + 可控加权”：

1.  Stage A：文本召回（BGE + 关键词融合）为默认路径
2.  Stage B：视觉/结构重排（仅在存在明确输入且启用权重时执行）

```typescript
interface SearchOptions {
    query?: string;           // 文本查询
    imageInput?: string;      // 图片路径或 Base64 (用于以图搜图)
    weights?: {
        visual: number;       // 视觉权重 (0-1)
        text: number;         // 语义权重 (0-1)
        struct: number;       // 结构权重 (0-1)
    };
    filter?: Record<string, any>;
}
```

**融合算法**:
`FinalScore = (Sim_Vis * W_Vis) + (Sim_Txt * W_Txt) + (Sim_Struct * W_Struct)`

**性能预算 (建议)**
- Stage A: < 300ms
- Stage B: Top-K 重排 < 300ms

---

## 5. 实施路线图 (Implementation Roadmap)

### Phase 1: 基础设施升级 (Infrastructure)
1.  **依赖安装**: 引入 `@xenova/transformers` 的 CLIP 模型支持。
2.  **数据库迁移**: 修改 LanceDB Schema，增加向量字段。
3.  **服务重构**: 升级 `EmbeddingService` 为多模态版本。

### Phase 2: 摄入管线开发 (Ingestion Pipeline)
1.  **PSD 解析器**: 开发 `PsdIngestor` 类，集成 `ag-psd` 和错误处理逻辑。
2.  **组件切片**: 实现简单的启发式算法（基于图层组）进行组件拆解。
3.  **批量索引脚本**: 编写脚本遍历用户工作区，建立初始索引。

### Phase 3: 检索与应用 (Application)
1.  **Agent 集成**: 更新 `UnifiedAgentService`，在 RAG 检索时同时传入图片上下文（如有）。
2.  **UI 交互**: 在聊天面板增加“参考图”上传入口，支持“以图搜图”。
3.  **主动推荐**: 当用户选中图层时，自动检索相似组件。

---

## 6. 异常处理与降级 (Error Handling)

1.  **解析失败**: 记录错误日志，将文件标记为 `skipped`，不中断索引进程。
2.  **模型加载失败**: 如果本地环境不支持 CLIP（如内存不足），自动降级为仅文本检索模式。
3.  **冷启动**: 若数据库为空，自动加载预置的 `knowledge-packs`（基础设计规范）。

---

## 7. 验收标准 (Acceptance Criteria)

1.  **多模态检索**: 输入“红色 促销”，能检索到红色调的图片（Visual）和包含“促销”文字的组件（Text）。
2.  **结构匹配**: 输入一张左图右文的参考图，能检索到布局相似的模板。
3.  **性能**: 单次检索（混合路）耗时 < 500ms。
4.  **稳定性**: 批量导入 100 个 PSD 文件，进程不崩溃，错误文件被正确跳过。
