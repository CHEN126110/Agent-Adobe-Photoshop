# DesignEcho Design Intelligence & Knowledge System 技术路线

> 文档类型：C 层历史设计来源 / Draft，不是当前路线。
> 当前开发权限：不能直接指导当前开发；源码引用只表示历史设计来源，不授予本文排期和成熟度权威。
> 适用范围：Design Intelligence 数据结构、来源和治理思想。
> 不能覆盖：Prompt、CurrentTask、Plan、Status、Design Agent OS 和当前生产代码；后续应抽取短小稳定 Contract 后再解除源码对 Draft 的依赖。

> 文档状态：Draft v0.1
> 适用项目：DesignEcho-Agent + DesignEcho-UXP
> 目标：在不推翻现有 Agent / Photoshop 执行架构的前提下，逐阶段构建可持续维护、可追溯、可学习、可影响设计与创意的 Design Intelligence 系统。
> 原则：**先读后写、证据优先、人机共治、Source of Truth 与 Runtime Projection 分离、开放创意不被知识规则锁死。**

> 治理说明：本文是专项研究草案，不是顶层架构真相源，也不代表对应实现已经可用于生产。架构边界以 `docs/design-agent-operating-system.md` 为准；当前实现风险与待办见 `docs/design-intelligence-knowledge-system-audit.md`。

---

## 0. 文档结论

本方案不把 Obsidian、Eagle 或现有“知识库 UI”中的任何一个单独定义为“知识系统”。

目标系统应拆成五个核心部分：

1. **Visual Evidence / Visual Memory**
   Eagle Library 及其他本地视觉资产，是设计案例、产品图、参考图、视频等视觉证据的 Source of Truth。

2. **Semantic Knowledge / Human Authoring**
   Obsidian Vault 作为人类可读、可编辑、可长期维护的设计知识源之一，存放方法论、规则、案例解释、设计原则、品牌知识等。

3. **DesignEcho Knowledge Runtime**
   DesignEcho 自己维护检索索引、关系索引、Embedding、使用历史、Freshness、候选知识、任务上下文等运行时状态。
   这些数据不应污染 Obsidian Markdown 或 Eagle 原始元数据。

4. **Task Context / Working Memory**
   每次设计任务都生成可审计的 Context Snapshot，将“当前任务真正使用了哪些规则、案例、品牌约束、项目状态、用户固定内容”明确下来。

5. **Knowledge Steward Agent**
   Agent 不仅检索知识，还负责发现知识缺口、整理、去重、建立关系、提出更新候选、发现冲突、检查过期内容，并把真实设计结果和用户反馈转化为候选学习。
   Agent 默认无权直接把候选知识升级为“已验证核心知识”。

最终形成：

```text
External World / User / Projects
          │
          ▼
Evidence & Sources
          │
          ▼
Understanding / Analysis
          │
          ▼
Candidate Knowledge
          │
      Human Review
          │
          ▼
Validated Knowledge
          │
          ▼
Task Context Builder
          │
          ▼
Design Agent / Team
          │
          ▼
Photoshop Execution
          │
          ▼
Critic / User Feedback / Metrics
          │
          ▼
Learning Events
          │
          └──────────────→ Candidate Knowledge
```

---

# 1. 背景与现状

## 1.1 当前 DesignEcho 的技术基础

现有系统已经具备以下基础能力：

- Electron 桌面 Agent；
- Photoshop UXP 原子工具执行；
- v3 自主 Agent 循环；
- 演进中的 v5 manifest/stage runtime；
- Design Project State；
- 多智能体 design-teams；
- 设计纪律运行时；
- 主图、SKU、详情页等业务技能；
- Eagle 参考检索；
- design-learning runtime；
- 工具预检、写入权限和 Photoshop 真实读回；
- 本地视觉能力（ONNX/CV）；
- 当前知识库 UI。

因此本方案**不新建另一套 Agent**，也不把知识系统做成独立孤岛，而是在现有 Agent Runtime 旁增加统一的 Design Intelligence Layer。

---

## 1.2 当前知识能力的主要问题

当前知识能力更接近：

```text
静态方法论 / 内置知识
        ↓
工具或 Prompt 检索
        ↓
Agent 使用
```

但真正的设计 Agent 需要解决：

### A. 知识会变化

例如：

- AI 图像模型能力；
- Photoshop / UXP 能力；
- 电商平台规范；
- 当前视觉趋势；
- 用户品牌偏好；
- Agent 自己在真实任务中的失败经验。

因此知识必须具备：

```text
freshness
last_verified_at
review_after
confidence
status
source
```

### B. 设计知识不仅是文字

设计知识往往由以下内容共同组成：

```text
方法论
+
视觉正例
+
视觉反例
+
项目历史
+
用户修改
+
执行结果
+
平台/业务数据
```

所以不能只把 Markdown 文档做 Embedding。

### C. Agent 不能把自己的输出自动当知识

必须区分：

```text
Evidence
Observation
Hypothesis
Candidate
Validated
Core
Deprecated
```

Agent 可以提出 Candidate，但最终升级必须经过明确 Gate。

### D. 现有 RAG 很难回答“为什么用了这些知识”

未来每个任务应能回答：

```text
为什么检索到这条规则？
为什么选这 6 张 Eagle 图？
哪些内容是用户固定的？
哪些只是 Agent 临时检索的？
哪一条知识影响了最终设计？
```

所以必须增加 Task Context Snapshot。

---

# 2. 设计原则

## 2.1 Knowledge Source ≠ Runtime Database

Obsidian 和 Eagle 都是 Source Provider，不承担全部运行时状态。

```text
Obsidian Vault
    │
    │ Human Source of Truth
    ▼
Knowledge Service
    │
    ├── SQLite Projection
    ├── Full-text Index
    ├── Vector Index
    ├── Relation Index
    └── Runtime Metadata
```

Visual 同理：

```text
Eagle Library
    │
    │ Visual Source of Truth
    ▼
Asset Service
    │
    ├── Search Projection
    ├── AI Metadata
    ├── Visual Embedding
    ├── Usage History
    └── Knowledge Relations
```

Runtime Projection 必须可以删除后重新构建。

## 2.2 管理空间分开，使用上下文合流

产品 UI 不需要把 Eagle 和知识库合并成一个大页面。

推荐：

```text
DesignEcho
├── 工作台
├── 素材库 / Visual Memory
├── 知识库 / Design Intelligence
└── 当前任务 / Workspace
```

但 Agent 执行任务时统一进入：

```text
Task Context Snapshot
```

## 2.3 有唯一正确答案的事情交给代码，无唯一答案的事情交给模型

知识系统必须继承当前 Agent 架构原则。

### 确定性部分

- 是否有来源；
- 文档 hash 是否冲突；
- Knowledge ID 是否存在；
- 是否允许写回；
- 状态能否从 candidate 升级为 validated；
- 不可逆动作是否已确认；
- Task Context 是否包含 P0 输入；
- source locator 是否有效。

### 模型部分

- 某案例为什么值得参考；
- 一条反馈是否可能形成设计规律；
- 两条规则是否语义冲突；
- 应该为当前主图检索哪些设计知识；
- 一个创意方向怎样使用现有知识而不照抄。

不要使用关键词规则去限制开放创意。

## 2.4 Knowledge 是“可引用判断”，不是“信息堆积”

正式知识必须至少回答：

```text
What:      这条知识是什么？
Why:       为什么成立？
Scope:     什么场景适用？
Boundary:  什么场景不适用？
Evidence:  依据是什么？
Confidence:当前置信度如何？
Freshness: 是否需要重新验证？
```

---

# 3. 目标总体架构

```text
┌──────────────────────────────────────────────────────────────┐
│                         DesignEcho UI                         │
│                                                              │
│ Workspace │ Visual Memory │ Design Intelligence │ Agent Chat │
└──────────────┬───────────────────┬───────────────────────────┘
               │                   │
               ▼                   ▼
       ┌───────────────┐   ┌─────────────────────┐
       │ Asset Service │   │ Knowledge Service   │
       └───────┬───────┘   └──────────┬──────────┘
               │                      │
        Eagle Library            Obsidian Vault
        Local Assets             Markdown / YAML
               │                      │
               └──────────┬───────────┘
                          ▼
               ┌─────────────────────┐
               │ Intelligence Index  │
               │                     │
               │ SQLite Registry     │
               │ FTS                 │
               │ Vector              │
               │ Relation Graph      │
               │ Freshness           │
               │ Runtime Usage       │
               └──────────┬──────────┘
                          ▼
               ┌─────────────────────┐
               │ Retrieval Pipeline  │
               │ Filter              │
               │ Search              │
               │ Semantic            │
               │ Graph Expand        │
               │ Rerank              │
               └──────────┬──────────┘
                          ▼
               ┌─────────────────────┐
               │ Task Context Builder│
               └──────────┬──────────┘
                          ▼
          ┌─────────────────────────────────┐
          │ Existing Agent Runtime          │
          │                                 │
          │ v3 Autonomous Loop              │
          │ v5 Stage Runtime                │
          │ Design Teams                    │
          │ Design Discipline               │
          └──────────────┬──────────────────┘
                         ▼
                   Photoshop UXP
                         │
                         ▼
              Critic / User Feedback
                         │
                         ▼
                Learning Manager
                         │
                         ▼
              Candidate Knowledge
```

---

# 4. Memory 分层

## 4.1 Semantic Memory

保存：

- 设计原则；
- 方法论；
- 设计规则；
- 品牌知识；
- 产品知识；
- 评价标准；
- Failure Modes；
- 经过审核的经验。

首选 Authoring Provider：

```text
Obsidian Vault
```

## 4.2 Visual Memory

保存：

- 产品图；
- 设计参考；
- 摄影参考；
- SKU 参考；
- 详情页案例；
- 模特图；
- 视频；
- 正例 / 反例；
- 历史设计结果。

首选 Provider：

```text
Eagle Library
```

注意：DesignEcho 可建立 AI Metadata，但不应把所有 AI 推断写回 Eagle 原始元数据。

## 4.3 Episodic Memory

保存真实经历：

- 某次任务做了什么；
- 用户修改了什么；
- 哪些版本被否决；
- 哪些版本被接受；
- critic 发现的问题；
- 执行失败与恢复过程。

推荐保存：

```text
DesignEcho Runtime DB
+
Design Project State
+
Event Log
```

## 4.4 Working Memory

即：

```text
Task Context Snapshot
```

生命周期只覆盖当前任务或当前阶段。

## 4.5 Procedural Memory

保存 Agent “怎么做”：

- Skill；
- Manifest；
- Design Discipline；
- 工具链；
- 工作流契约；
- 执行策略。

这部分继续存在现有代码体系中，不迁入 Obsidian。

---

# 5. Knowledge 数据模型

## 5.1 KnowledgeNode

建议定义统一契约：

```ts
export type KnowledgeStatus =
  | 'observation'
  | 'candidate'
  | 'validated'
  | 'core'
  | 'deprecated';

export type KnowledgeKind =
  | 'principle'
  | 'method'
  | 'rule'
  | 'case'
  | 'failure_mode'
  | 'brand'
  | 'product'
  | 'evaluation'
  | 'research'
  | 'learning';

export interface KnowledgeNode {
  id: string;
  kind: KnowledgeKind;
  title: string;

  status: KnowledgeStatus;
  confidence?: number;

  applicableTaskTypes: string[];
  domains: string[];
  tags: string[];

  sourceRefs: EvidenceRef[];
  relatedIds: string[];

  scope?: string;
  boundary?: string;

  freshness: {
    mode: 'stable' | 'medium' | 'volatile';
    lastVerifiedAt?: string;
    reviewAfter?: string;
  };

  provider: {
    type: 'obsidian' | 'builtin' | 'runtime';
    locator: string;
  };

  version: number;
  contentHash: string;
}
```

## 5.2 EvidenceRef

```ts
export type EvidenceProvider =
  | 'eagle'
  | 'web'
  | 'local_file'
  | 'project'
  | 'user_feedback'
  | 'agent_execution'
  | 'metric';

export interface EvidenceRef {
  id: string;
  provider: EvidenceProvider;

  locator: string;
  title?: string;

  capturedAt?: string;
  contentHash?: string;

  role:
    | 'source'
    | 'support'
    | 'counterexample'
    | 'positive_example'
    | 'negative_example'
    | 'observation';
}
```

## 5.3 CandidateKnowledge

候选知识必须与正式知识分开。

```ts
export interface CandidateKnowledge {
  id: string;

  proposedKind: KnowledgeKind;
  proposedTitle: string;
  proposedContent: string;

  evidenceRefs: EvidenceRef[];

  generatedFrom:
    | 'user_note'
    | 'task_feedback'
    | 'critic'
    | 'external_source'
    | 'knowledge_conflict'
    | 'brainstorm';

  confidence: number;

  decision:
    | 'pending'
    | 'accepted'
    | 'continue_observing'
    | 'rejected';

  targetKnowledgeId?: string;
}
```

---

# 6. Obsidian 的定位

## 6.1 Obsidian 不作为 Agent Runtime DB

不要把以下字段频繁写进 Markdown：

```text
retrieval_count
last_retrieved_at
rerank_score
embedding_id
task_context_id
token_usage
execution_trace
```

它们属于 DesignEcho Runtime。

## 6.2 Obsidian 作为 Human Authoring Source

建议 Vault 目录：

```text
Design-Brain/
├── 00_Inbox/
├── 10_Principles/
├── 20_Methods/
├── 30_Design-Patterns/
├── 40_Cases/
├── 50_Brand-Product/
├── 60_Evaluation/
├── 70_Research/
├── 80_Agent-Learnings/
└── 90_Archive/
```

## 6.3 YAML Schema

```yaml
---
id: dk_01JXXX
type: design_rule

status: validated
confidence: 0.91

domains:
  - ecommerce
  - composition

tasks:
  - main_image
  - detail_page

freshness: stable

related:
  - dk_01JYYY

version: 3
---
```

Markdown 正文负责：

- 原则；
- 解释；
- Scope；
- Boundary；
- 判断方式；
- 例子；
- 反例；
- 备注。

## 6.4 Provider-neutral 知识平面与未来可选 Provider

> 权威定义（2026-08-07 对齐）：知识库的本质是「**决策时记忆服务**」——在 Agent 做设计决策那一刻，把经过治理、有版本、可信的知识在正确时机喂给正确决策点。价值 = 它让设计决策变好了多少；一条知识若从未在决策时刻被消费，对系统价值为零。容器 / 编辑器 / 关系图谱都是手段，不是本质。

本路线图不绑定任何单一编辑器或数据格式。**开放 Markdown/YAML 是第一种（首选）作者源**，Obsidian 是推荐的默认编辑器，但 VS Code / Typora 等 Markdown 工具同样兼容；DesignEcho 自己必须能完整读写与重建该源，不依赖某个笔记软件运行。

统一抽象（provider-neutral，避免出现品类/工具专属分支）：

```ts
interface KnowledgeSourceProvider {
    readonly providerId: string;
    readonly capabilities: { read: boolean; write: boolean; watch: boolean; history: boolean };
    scan(): Promise<SourceAssetRevision[]>;
    getAsset(assetId: string): Promise<SourceAssetRevision | null>;
    search(query: KnowledgeQuery): Promise<SourceSearchResult[]>;
}
```

第一阶段实现：`MarkdownVaultProvider` / `BuiltinKnowledgeProvider` / `ReviewedMemoryProvider` / `EagleEvidenceProvider`。

**未来可选 Provider —— SiYuan（只读，默认不启用）**：

- 采纳其组织思想：块级稳定身份（KnowledgeBlock：claim/rule/method_step/boundary/example/counterexample）、反向链接、属性视图、历史版本。这些可借鉴到复核收件箱与单条知识 Inspector，但**不把 DesignEcho 做成块编辑器**。
- 不作为技术底座：SiYuan 原生数据是 `.sy`（JSON，与 Kernel 深度耦合）且为 AGPL-3.0。不把 `.sy` 作为真相源、不复制/嵌入其前端或 Kernel、不直接读写 `.sy`、不做深集成（避免 AGPL 组合程序合规风险）。
- 若将来提供，作为用户主动启用的可选 **只读** Provider，通过其本地 HTTP API（`endpoint + token`）访问文档/块/属性/搜索；返回内容仍须进入 Catalog revision/governance，不把 SiYuan 搜索结果直接标为已验证知识；离线时正常降级。
- 只有在 Markdown Vault 主链纵切稳定、且有唯一 Catalog / Query Gateway / Context Compiler 之后，才评估增加 SiYuanProvider / ObsidianEnhancedProvider / WebSnapshotProvider。

---

# 7. Eagle / Visual Asset 的定位

## 7.1 Eagle 是视觉资产 Source of Truth

DesignEcho 已有本地素材管理能力时，应继续保持：

```text
Eagle Library
→ DesignEcho Asset Adapter
→ Unified Asset Model
```

不要求 Eagle App 必须运行。

## 7.2 不要复制图片到知识库

知识只保存：

```text
asset_id
library_id
relation
analysis
role
```

图片原文件仍然由素材库负责。

## 7.3 AI Metadata 与 Human Metadata 分离

```text
Human Metadata
- folder
- tags
- rating
- annotation

AI Metadata
- composition
- subject ratio
- style
- visual saliency
- background
- semantic description
- visual embedding
- design pattern
```

AI Metadata 写到 DesignEcho Runtime DB。

---

# 8. Relation Graph

第一阶段不要引入 Neo4j 等重型 Graph DB。

用 SQLite Relation Table 即可：

```ts
export type RelationType =
  | 'related'
  | 'supports'
  | 'contradicts'
  | 'example_of'
  | 'counterexample_of'
  | 'derived_from'
  | 'supersedes'
  | 'used_in'
  | 'learned_from';

export interface ResourceRelation {
  id: string;
  fromId: string;
  toId: string;
  type: RelationType;
  confidence?: number;
  createdBy: 'user' | 'agent' | 'system';
}
```

前端“知识图谱”只是 Relation Index 的一种可视化。

Graph 的核心价值不是画点，而是：

```text
知识追溯
关系扩展检索
冲突发现
案例关联
知识缺口发现
```

---

# 9. Retrieval Pipeline

不要只做 Vector Top-K。

推荐：

```text
1. Task Structured Filter
2. Full-text Search
3. Semantic Search
4. Relation Expansion
5. Visual Retrieval
6. Rerank
7. Context Budgeting
```

## 9.1 Structured Filter

根据：

```text
task_type
product_category
brand
knowledge_status
freshness
project_context
```

过滤。

## 9.2 Full-text

适合：

- 精确术语；
- SKU；
- 图层规范；
- 品牌词；
- API 名称；
- 设计规则标题。

## 9.3 Semantic

适合：

- “主体太弱”；
- “画面没有呼吸感”；
- “需要更高级的感觉”；
- “找与当前构图相似的方法论”。

## 9.4 Relation Expansion

如果命中：

```text
主体视觉权重
```

可以扩展：

```text
信息层级
视觉中心
留白
正例
反例
```

## 9.5 Rerank

建议综合：

```text
semantic relevance
task applicability
status
confidence
freshness
user-pinned
historical usefulness
```

---

# 10. Task Context Snapshot

这是整个系统最重要的新中间层。

```ts
export interface TaskContextSnapshot {
  id: string;
  taskId: string;

  hardConstraints: ContextItem[];
  pinnedItems: ContextItem[];
  retrievedKnowledge: ContextItem[];
  visualReferences: ContextItem[];
  projectStateRefs: ContextItem[];

  createdAt: string;
  knowledgeIndexVersion: string;
}

export interface ContextItem {
  resourceId: string;
  resourceType: string;

  reason: string;

  priority: 'critical' | 'high' | 'normal' | 'low';

  selectedBy:
    | 'user'
    | 'agent'
    | 'system';

  pinned: boolean;
}
```

## 10.1 三类 Context

### Hard Constraint

```text
袜型不得改变
品牌 Logo 不得修改
SKU 数量必须满足规格
```

代码/契约强制。

### Pinned Context

```text
用户选中的方法论
用户固定的 Eagle 参考
用户指定品牌规范
```

Agent 不得自动移除。

### Retrieved Context

```text
Agent 本轮自动搜索出来的规则和案例
```

允许用户移除。

---

# 11. Knowledge 对设计 Agent 的影响方式

知识不能简单变成一段大 System Prompt。

应分别进入不同角色和阶段。

## 11.1 Scene Analyst

输入：

- 产品资料；
- Visual Evidence；
- Brand / Product Knowledge；
- 历史设计状态。

输出：

```text
视觉事实
问题
机会
不确定项
```

## 11.2 Design Strategist

重点使用：

```text
Principles
Methods
Patterns
Positive / Negative Cases
Brand Knowledge
```

形成：

```text
Design Intent
Layout Strategy
Information Hierarchy
Visual Direction
```

## 11.3 Executor

不应该塞入大量方法论。

主要接收：

```text
Design Plan
Hard Constraints
Pinned References
必要的操作知识
```

避免上下文过载。

## 11.4 Critic

重点使用：

```text
Evaluation
Failure Modes
Design Rules
Project Goal
Original Visual Evidence
```

Critic 的问题可以反向产生 Learning Event。

---

# 12. Knowledge Steward Agent

Agent 的新职责：

```text
Search
Organize
Link
Detect Conflict
Detect Stale Knowledge
Summarize Sources
Propose Candidate
Merge Duplicate
Find Knowledge Gap
Build Evidence Chain
```

默认禁止：

```text
自动删除核心知识
自动把 candidate 变成 validated
自动覆盖用户手工编辑内容
自动将一次设计偏好升级为全局规则
```

---

# 13. Knowledge Lifecycle

```text
Raw Source
    ↓
Observation
    ↓
Candidate
    ↓
Validated
    ↓
Core
    ↓
Deprecated
```

## 13.1 Candidate 产生来源

- 用户阅读笔记；
- Eagle 视觉案例；
- Web / PDF / 视频；
- Agent Critic；
- 用户对设计的修改；
- 多次重复失败；
- Brainstorm；
- 外部趋势更新；
- 项目复盘。

## 13.2 Candidate Review

用户可以：

```text
接受
继续观察
合并到现有知识
拒绝
```

接受后才允许：

```text
write → Obsidian Vault
```

---

# 14. Freshness / Knowledge Health

知识应有刷新策略。

### Stable

例如：

```text
Gestalt
对比
视觉层级
字体基础
```

### Medium

例如：

```text
Photoshop 工作流
电商平台规范
UXP 能力
```

### Volatile

例如：

```text
AI 模型能力
生成模型排名
设计趋势
平台算法
市场热点
```

## 14.1 Knowledge Health 页面

未来知识库增加：

```text
有效
候选
待验证
需要更新
存在冲突
缺少来源
可能重复
长期未使用
```

Agent 可以执行：

```text
检查更新
查找来源
合并重复
发现冲突
生成审查摘要
```

---

# 15. Evidence → Knowledge 阅读工作区

借鉴参考案例，但不照搬 UI。

适合：

```text
文章
PDF
网页
视频字幕
研究报告
评论研究
设计复盘
```

建议结构：

```text
┌────────────────────────────┬─────────────────────┐
│ Source                     │ Annotation / Agent  │
│                            │                     │
│ 原文 / 视频 / PDF          │ 笔记                │
│                            │ 理解                │
│ 选中文本                   │ 候选知识            │
│                            │ 入库审查            │
└────────────────────────────┴─────────────────────┘
```

支持：

```text
引用到笔记
解释选中内容
基于全文回答
提出候选知识
关联现有知识
添加证据
```

---

# 16. Visual Evidence 工作流

Eagle 页面不需要重做。

增加：

```text
+ 当前任务
关联知识
沉淀为设计案例
标记为正例
标记为反例
找相似
```

## 16.1 示例

```text
Eagle Asset 0821
      ↓
关联
      ↓
主体视觉权重
      ↓
relation = positive_example
```

以后 Agent 检索：

```text
主体视觉权重
```

可以同时拿到：

```text
规则解释
+
Eagle 正例
+
Eagle 反例
```

---

# 17. Post-Task Learning

一次设计任务结束后产生：

```text
Learning Event
```

记录：

```text
用户指出了什么问题？
Agent 修改了什么？
修改前后差异是什么？
用户是否接受？
是否重复发生？
```

## 17.1 不直接写知识

例如：

```text
最近 7 个 SKU 任务中
5 次用户要求统一字号
```

Agent 提议：

```text
Candidate:
SKU 卡片中文字视觉规格应保持统一，
不应因文字长度自动改变字号。
```

用户选择：

```text
接受
继续观察
忽略
```

---

# 18. Brainstorm / Knowledge Gap

该模块属于后续阶段，不应第一期就实现。

目标：

```text
从现有知识出发
↓
发现还没想清楚的问题
↓
生成探索路线
↓
形成命题
↓
挂接证据
↓
产生 Candidate Knowledge
```

推荐状态：

```text
unsupported
supported
supported_with_gaps
conflicting
revised
user_confirmed
```

它不是普通聊天历史，而是：

```text
Reasoning Session
```

---

# 19. 外部世界更新

未来支持：

```text
Web
论文
GitHub
官方文档
视频
社媒讨论
平台数据
```

进入：

```text
External Signal
```

但 External Signal 不直接进入 Knowledge。

必须经过：

```text
Signal
↓
Evidence
↓
Candidate
↓
Review
↓
Knowledge
```

---

# 20. 与现有 v3 / v5 Runtime 的集成

## 20.1 核心原则

Knowledge System 必须独立于 v3/v5。

```text
Knowledge Service
        │
        ▼
Task Context Snapshot
        │
   ┌────┴─────┐
   ▼          ▼
  v3          v5
```

## 20.2 v3 集成

只做 Bridge：

```text
processWithUnifiedAgent
↓
Context Builder
↓
生成 taskContextSummary
↓
注入 autonomous loop
```

不要：

```text
在 autonomous-agent.executor.ts 增加
main_image / detail_page / sku 专属知识分支
```

避免扩大品类耦合。

## 20.3 v5 集成

v5 最终成为主要落点。

Manifest 可以声明：

```ts
knowledgeRequirements: {
  requiredKinds: ['method', 'evaluation'],
  optionalKinds: ['case', 'research'],
  requireVisualReferences: true,
}
```

Stage Context 持有：

```text
task_context_snapshot_id
knowledge_refs
visual_refs
evidence_refs
```

v5 不负责自己实现检索。

---

# 21. 与 Design Project State 的关系

Design Project State 保存：

```text
当前项目的事实与共享状态
```

Knowledge 保存：

```text
跨项目可复用的方法和经验
```

Task Context 连接两者：

```text
Design Project State
        │
        ▼
Task Context
        ▲
        │
Knowledge / Visual Memory
```

禁止把项目瞬时事实直接沉淀成长期知识。

---

# 22. 与 design-learning runtime 的关系

不要新建第二套 Learning Runtime。

推荐将现有 design-learning 逐步收口成：

```text
Learning Event
↓
Candidate Knowledge
↓
Review / Writeback Gate
↓
Knowledge Service
```

现有 review/writeback gate 可以继续作为迁移基座。

---

# 23. 与现有知识工具的迁移

当前类似：

```text
getMainImageDesignFramework
searchEagleReferences
```

短期不删除。

改成 Wrapper：

```text
legacy tool
    ↓
Knowledge Service / Asset Service
```

等新系统稳定后再逐步退役硬编码来源。

---

# 24. 存储建议

## 24.1 Source

```text
Obsidian Vault
Eagle Library
Project Files
```

## 24.2 Runtime SQLite

建议表：

```text
knowledge_registry
knowledge_runtime
knowledge_relations

asset_registry
asset_ai_metadata

candidate_knowledge
evidence_refs

task_context
task_context_items

learning_events
knowledge_usage_events

sync_state
index_state
```

## 24.3 Search

第一阶段：

```text
现有全文搜索
+
现有向量能力
```

先封装统一接口。

不要第一阶段换数据库。

---

# 25. 同步与一致性

## 25.1 Obsidian

读取：

```text
Markdown + YAML
```

写入前：

```text
read
↓
contentHash
↓
Agent/User Edit
↓
recheck hash
↓
same → atomic write
different → conflict
```

冲突 UI：

```text
Obsidian 版本
Agent 版本
Diff

[合并]
[保留我的]
[采用 Agent]
```

## 25.2 Eagle

所有写操作必须经过：

```text
Asset Service
```

Agent 不直接使用裸 fs API 修改素材库。

批量写：

```text
Plan
↓
Preview
↓
Confirm
↓
Journal
↓
Atomic Operation
↓
Verify
↓
Update Index
```

---

# 26. Agent Tool Contract

第一阶段建议只增加少量通用工具。

```text
knowledgeSearch
knowledgeGet
knowledgeRelated

assetSearch
assetGet

taskContextGet
taskContextPin
taskContextRemove

proposeKnowledgeCandidate
listKnowledgeCandidates
```

后续：

```text
reviewKnowledgeCandidate
mergeKnowledge
deprecateKnowledge
refreshKnowledge
findKnowledgeConflicts
```

不要为不同品类增加：

```text
searchSockKnowledge
searchMainImageKnowledge
searchDetailPageKnowledge
```

品类属于参数，不属于工具身份。

---

# 27. UI 信息架构

当前知识库页面保留。

建议逐步增加四个顶层视图：

```text
知识资产
关系图谱
候选审查
知识健康
```

## 27.1 知识资产

继续使用当前卡片 UI。

新增：

```text
类型
状态
Confidence
Freshness
来源
视觉案例数量
使用次数
```

## 27.2 关系图谱

不是默认首页。

用于：

```text
探索关系
查看来源
查正反例
发现知识孤岛
```

## 27.3 候选审查

Agent 建议写库的内容集中在这里。

## 27.4 知识健康

处理：

```text
过期
冲突
重复
无来源
长期未验证
```

---

# 28. Agent 右侧交互

将纯 Chat 升级为：

```text
对话
上下文
执行
```

上下文页面显示：

```text
Hard Constraints
Pinned Knowledge
Retrieved Knowledge
Visual References
Project State
```

每条 Agent 检索知识必须支持：

```text
为什么加入？
移除
固定
查看来源
```

---

# 29. 分阶段实施路线

## Phase 0 — Contract Foundation

### 目标

建立底层契约，不改变用户 UI，不改变 Agent 设计结果。

### 实现

```text
Resource ID
KnowledgeNode Contract
EvidenceRef
Relation
TaskContextSnapshot
LearningEvent
```

增加：

```text
KnowledgeService interface
AssetService interface
```

现有知识能力包进 Adapter。

### 暂不做

- Obsidian 写入；
- Graph UI；
- 自动学习；
- 外部热点；
- Brainstorm。

### Exit Criteria

- 现有主图 / SKU / 详情页运行不受影响；
- 现有 knowledge tools 可通过新 Service 调用；
- contract 有 smoke / audit；
- Runtime 不出现品类专属知识分支。

---

## Phase 1 — Read-only Intelligence + Task Context

### 目标

让 Agent 在设计前能可靠读取知识，并明确知道本次任务用了什么。

### 实现

```text
Knowledge Search
Asset Search
Hybrid Retrieval
Task Context Builder
Context Snapshot
Context Inspector UI
```

Agent 只读。

### 设计 Agent 接入

```text
Scene Analyst
Strategist
Critic
```

Executor 只接受经过压缩的必要 Context。

### Exit Criteria

每一次设计任务都可回答：

```text
使用了哪些知识？
使用了哪些 Eagle 参考？
为什么使用？
哪些由用户固定？
```

---

## Phase 2 — Obsidian Authoring + Candidate Review

### 目标

把 Obsidian 正式接成可编辑知识源。

### 实现

```text
Obsidian Vault Adapter
Markdown/YAML Parser
File Watcher
Content Hash
Atomic Write
Conflict Detection
Candidate Review UI
```

### 学习写入

现有 design-learning 不再直接维护独立记忆格式，而逐步输出 Candidate。

### Exit Criteria

```text
Obsidian 修改 → DesignEcho 更新
DesignEcho 审核写入 → Obsidian 更新
冲突不覆盖
Candidate 无法绕过 Gate 变成 Validated
```

---

## Phase 3 — Visual-Semantic Linking

### 目标

让“设计方法论”和“Eagle 视觉案例”真正关联。

### 实现

```text
Knowledge ↔ Eagle Asset Relation

positive_example
negative_example
reference
counterexample
```

增加：

```text
关联知识
沉淀为案例
正例 / 反例
找相似
```

### Retrieval

Context Builder 可以同时返回：

```text
Rule
+
Positive Examples
+
Negative Examples
```

### Exit Criteria

任意核心设计规则可反查视觉案例；
任意 Eagle 案例可反查关联知识。

---

## Phase 4 — Knowledge Steward

### 目标

Agent 开始辅助维护知识，而不是只读取。

### 实现

```text
Duplicate Detection
Conflict Detection
Freshness
Knowledge Health
Source Traceability
Candidate Merge
Stale Review
```

### Agent Actions

```text
“这条知识 90 天未验证”
“这两条规则可能冲突”
“这三个案例可能属于同一 Pattern”
```

但所有高影响写回继续过 Gate。

### Exit Criteria

知识库开始具备“自我维护能力”，而不是越用越乱。

---

## Phase 5 — Design Feedback Learning Loop

### 目标

真实设计行为反向影响知识。

### 实现

```text
User Feedback Event
Critic Event
Before/After Diff
Accepted Revision
Repeated Pattern Detection
```

Agent 生成 Candidate：

```text
“最近 8 个任务中出现 6 次相同修改”
```

### Exit Criteria

知识的新增可以明确追溯到：

```text
哪几个任务
哪几次用户反馈
哪几个视觉版本
```

---

## Phase 6 — External Signals & Brainstorm

### 目标

让系统感知外部世界变化并主动扩展认知。

### 实现

```text
Web / PDF / Video Ingestion
External Signal
Knowledge Gap
Brainstorm Session
Proposition Ledger
Research Evidence
```

### 注意

External Signal 不直接成为知识。

### Exit Criteria

Agent 可以：

```text
发现知识可能过期
提出研究问题
形成带证据的新命题
用户确认后写入 Knowledge
```

---

# 30. 不建议第一阶段实现的内容

以下内容应该延后：

```text
Neo4j / Heavy Graph DB
完全自动写知识库
完全自动外部爬取
复杂多 Agent 研究团队
自动删除/重构用户知识
Graph 作为主导航
大规模重做现有知识库 UI
```

原因：

当前价值首先来自：

```text
Context
Provenance
Review
Visual Linking
```

而不是基础设施复杂度。

---

# 31. 推荐代码结构

建议：

```text
src/renderer/services/design-intelligence/
├── knowledge-service.ts
├── asset-service.ts
├── retrieval-service.ts
├── context-builder.ts
├── knowledge-steward.ts
├── learning-manager.ts
├── freshness-service.ts
└── adapters/
    ├── builtin-knowledge.adapter.ts
    ├── obsidian-vault.adapter.ts
    └── eagle-library.adapter.ts
```

共享契约：

```text
src/shared/design-intelligence/
├── knowledge.types.ts
├── evidence.types.ts
├── relation.types.ts
├── task-context.types.ts
├── candidate.types.ts
├── learning-event.types.ts
├── retrieval-contract.ts
└── knowledge-writeback-contract.ts
```

Runtime Persistence：

```text
src/main/services/design-intelligence/
├── intelligence-db.ts
├── knowledge-index-store.ts
├── asset-index-store.ts
├── sync-service.ts
└── file-watch-service.ts
```

具体目录最终以现有代码约束和依赖方向为准。

---

# 32. 与 Agent Tools 的边界

工具层只暴露意图稳定的能力：

```text
search / get / relate / propose / review
```

文件系统格式、Obsidian YAML、Eagle metadata 不能暴露给模型。

```text
Agent
↓
Tool Contract
↓
Knowledge / Asset Service
↓
Adapter
↓
Provider
```

---

# 33. 安全与权限

### Read

默认允许：

```text
搜索
查看
分析
建立临时 Context
```

### Safe Write

低风险：

```text
新增 Candidate
新增 AI Relation
新增 Runtime Tag
```

### Knowledge Write

需要 Gate：

```text
修改正式知识
升级 Validated
合并知识
Deprecated
```

### Destructive

必须用户确认：

```text
删除
覆盖
批量结构调整
```

---

# 34. 关键审计事件

建议记录：

```text
knowledge_retrieved
knowledge_pinned
knowledge_removed
knowledge_used_in_plan
visual_reference_used
candidate_proposed
candidate_accepted
knowledge_updated
knowledge_deprecated
learning_event_created
```

用于未来分析：

```text
哪类知识真的帮助设计？
哪些知识从来没有被用到？
哪些规则经常导致 critic fail？
哪些用户反馈重复发生？
```

---

# 35. 质量指标

不要只看知识数量。

### Retrieval

```text
Context Precision
Context Coverage
User Remove Rate
User Pin Rate
```

### Knowledge

```text
Validated Ratio
Source Coverage
Conflict Rate
Stale Rate
Duplicate Rate
```

### Design

```text
First-pass Acceptance
Critic Pass Rate
Revision Count
User Correction Frequency
```

### Learning

```text
Candidate Acceptance Rate
Repeated Feedback Reduction
Knowledge Reuse Rate
```

---

# 36. 迁移策略

不要一次性“替换原知识库”。

推荐：

```text
现有 Knowledge
      │
      ▼
Legacy Adapter
      │
      ▼
Knowledge Service
```

然后：

```text
Phase 1:
只读统一

Phase 2:
Obsidian 新知识优先

Phase 3:
逐步迁移设计方法论

Phase 4:
旧硬编码知识改 Wrapper

Phase 5:
确认稳定后再退役旧入口
```

---

# 37. 当前需要先确认的实现差异

现有项目文档中可能仍描述：

```text
Eagle Reference → MCP
```

但当前产品界面已经采用直接读取本地 Eagle 素材库的方式。

正式编码前需要以代码现状确认：

```text
当前真实读取路径
写权限路径
素材 ID 稳定策略
文件变更监听
```

确认后同步更新：

```text
CLAUDE.md
AGENTS.md
design-agent-operating-system.md
```

避免技术文档再次与真实代码漂移。

---

# 38. 第一批建议落地 Backlog

优先级 P0：

```text
DI-001 定义 KnowledgeNode
DI-002 定义 EvidenceRef
DI-003 定义 ResourceRelation
DI-004 定义 TaskContextSnapshot
DI-005 建 KnowledgeService 抽象
DI-006 建 AssetService 抽象
DI-007 把现有 knowledge tool 接入 Service
DI-008 Context Builder Read-only V1
DI-009 Agent Context Inspector
DI-010 Context 使用审计
```

P1：

```text
DI-011 Obsidian Vault Read Adapter
DI-012 YAML Schema
DI-013 File Watcher
DI-014 Content Hash
DI-015 Candidate Knowledge Store
DI-016 Candidate Review UI
```

P2：

```text
DI-017 Eagle Relation
DI-018 Visual Case
DI-019 Positive / Negative Example
DI-020 Rule + Case Joint Retrieval
```

---

# 39. 最终产品定义

DesignEcho 的知识系统不应被定义成：

> “一个支持 Obsidian 的知识库。”

更准确的产品定义：

> **Design Intelligence Layer：把用户经验、设计方法论、视觉案例、项目状态、Agent 运行反馈和外部世界的新信息，持续转化为可追溯、可审查、可复用的设计智能，并在每一次设计任务中通过 Task Context 精确影响 Agent 的分析、策略、执行和评审。**

最终目标不是让 Agent “记住更多”。

而是让它逐渐拥有：

```text
知道什么
知道为什么
知道何时适用
知道什么还不确定
知道应该参考什么
知道过去哪里做错过
知道用户最终接受了什么
```

这才是 DesignEcho 从“可操作 Photoshop 的 Agent”走向“拥有设计经验与持续学习能力的 Design Agent”的关键路径。
