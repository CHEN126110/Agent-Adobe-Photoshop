# Design Agent OS 架构真相源

> 文档类型：B 层顶层架构真相源。
> 当前开发权限：用于裁决分层、数据流和 owner；不拥有当前排期。
> 适用范围：DesignEcho Agent、Harness、Design Kernel、Skill、Tool、Photoshop、Evaluation、Memory 和用户体验。
> 不能覆盖：当前用户目标、`project-memory/Prompt.md` 的产品边界、`CurrentTask.md` 的修改范围、当前代码与真实运行读回。

更新日期：2026-08-31

## 1. 产品身份与当前边界

DesignEcho 是一个面向真实视觉设计工作的专业 Agent。它把用户目标、可追溯事实和真实素材转化为可编辑的 Adobe Photoshop 设计交付物，通过写后读回和专业评价进行有界修订，并且只依据可验证结果报告完成、待复核或无法继续。

它不是：

- 通用聊天助手；
- 任意电脑控制 Agent；
- Photoshop 命令行外壳；
- 主图、SKU、详情页三套互不相干的自动化；
- 用固定工作流包装的模板系统。

主图、SKU、详情页是第一批验收 Skill。海报、Banner、社媒封面、包装和其它设计类型优先复用同一 Design Kernel；只有确有交付物、渠道或业务特有规则时才增加 Skill overlay。

当前不能宣称：

- 一句话自动设计已经稳定完成；
- 主图、SKU、详情页已经达到稳定商业质量；
- 任意参考图都能高保真复刻；
- 知识库、自动学习或多 Agent 已形成完整闭环；
- Tool 成功、文件生成或模型高分等于设计完成。

## 2. Agent、Model 与 Harness

```text
Agent = Model + Harness
```

- **Model** 提供多模态理解、推理、创意、语言和动态规划，决定智能上限。
- **Harness** 提供任务身份、上下文、能力发现、权限、工具调度、目标 / revision、事务、观察、预算、恢复、验真和停止条件，使模型能力可持续地转化为真实结果。
- **Agent** 是两者组成的工作系统。Harness 不能替 Model 写设计答案，Model 也不能伪造环境事实、权限或 Tool 结果。

### 2.1 语义 owner

| 关注点 | 唯一 owner | 边界 |
|---|---|---|
| 开放语义理解、创意与取舍 | Agent / Model | 解释目标、选择素材、形成方向、决定构图 /比例 /文案 /修订；不得编造事实。 |
| 生命周期、Context、Capability、Tool 与副作用安全 | Harness | 管理运行和执行事实；不得用关键词、默认值或恢复模板替模型规划。 |
| 构图、层级、排版、色彩、空间和工艺方法 | Design Kernel | 提供跨品类专业底座；不是固定七步 Workflow。 |
| 品类 /渠道 /交付物特有能力 | Skill Package | 拥有 Manifest、特有方法、确定性规格、领域卡片和评价引用；不拥有 Agent 循环或 Photoshop 事务。 |
| 可执行原子动作和 Host 集成 | Tool / Capability Provider + Host | 执行并返回原始结果；不理解业务目标，不决定审美或完成。 |
| 项目事实、偏好、案例、方法及来源 | Memory / Knowledge | 提供受作用域和生命周期治理的内容；不授予权限。 |
| 质量 finding 与裁决输入 | Evaluation | 基于真实结构 /像素 /人工反馈评价；不拥有设计品味、执行或经验发布。 |
| 候选审核、版本化发布和撤回 | Experience Publisher | 未审核候选不能进入正式 Knowledge / Skill / Policy / Evaluation。 |

### 2.2 当前运行线

| 名称 | 当前含义 | 不允许的外推 |
|---|---|---|
| `v3` | 当前默认真实执行路径：ChatPanel → DesignAgentEngine →自主 Agent / Skill executor → Tool → IPC / WebSocket → UXP / Photoshop。 | 不能因为叫 v3 就视为待整体废弃。 |
| `v5` | manifest、task semantics、上下文、预算、视觉观察和阶段契约治理层。 | 不等于已经替代 v3 主循环。 |
| `bridge` | 把 v5 声明映射到现有 v3 / Skill / Tool 的过渡适配。 | 不能成为第三 Runtime 或业务逻辑中心。 |
| `legacy` | 仍为兼容存在的旧入口、命名或未迁移执行点。 | 只能收缩，不能新增责任。 |

完成状态必须区分：

- `contract_ready`
- `bridge_ready`
- `runtime_integrated`
- `photoshop_e2e_verified`
- `design_quality_reviewed`
- `commercial_quality_verified`

前一项不能自动升级后一项。

### 2.3 agentic 与 staged

| 执行模型 | 适用任务 | 计划与写入边界 |
|---|---|---|
| `agentic` | 开放创意、没有唯一机械答案的设计任务 | 模型通过 ReAct 自主观察、行动和调整；Brief / Strategy / Plan 可作为工作笔记，但不是写入门票。 |
| `staged` | SKU 组合、模板规格、批量导出等具有唯一可校验答案的生产任务 | Runtime Session 可以持有阶段和确定性节点；模型声明内容，Harness 校验结构；写入仍需 Capability、preflight、目标 / revision 与唯一事务。 |

不得把 staged 的表单、阶段或卡片推广成所有设计的固定流程。也不得因为 agentic 自主就跳过执行安全和真实交付验证。

### 2.4 单一多模态 Agent 模型

当前生产 Agent 只使用一个支持视觉的 `primaryModel` 完成目标理解、图片观察、设计判断、Tool 使用和写后复核。

- `visualModel` 只保留为旧配置兼容镜像，归一化后与 `primaryModel` 相同；新代码不得重新建立独立视觉选择源。
- `layoutAnalysis / textOptimize / visualAnalyze` 等任务桶只保留兼容数据，不是当前 Agent 的三个运行模型。
- 图片生成、Embedding、重排、音频、视频等 Provider 可以作为专门 Tool，但不成为第二个最终设计裁决中心。
- 模型能力只依据当前目录和真实 Provider 能力；名称不能自动授予视觉或 Tool 能力。

统一模型的意义是让看图、决策和修订由同一上下文连续完成，不是把图片交给模型后立即跳过专业观察。

### 2.5 Task Semantic Binding、TaskRun 与 Context

1. **Task Semantic Binding** 表达用户要什么交付物；它不选择 Skill、不授予 Tool 权限、不推进阶段。
2. **TaskRun** 是活动任务的唯一生命期身份，拥有目标、必要交互、operation result、目标 / revision 和终态事实；UI、完成摘要和 Run Record 只能投影。
3. **Runtime Session** 只在 staged 路径拥有阶段状态；agentic 不创建阶段写入门禁。
4. **OperatingContextSnapshot** 是请求冻结的项目、页面、素材和 Photoshop 只读事实；它不复制 Capability 或权限。
5. **Context Compiler** 按当前目标、任务类型、观察和模型窗口装载最少必要内容；不能把全部方法、工具、历史和研究常驻 Prompt。
6. 当前用户指令拥有本轮目标和取舍；真实项目 / PSD 读回拥有环境事实；有来源的商品资料拥有商品事实；Knowledge / Memory /参考只提供方法和历史；模型先验只形成待验证假设。

### 2.6 Capability 与 Prompt

- Capability Session 负责“本轮模型能看见哪些能力”；可见性不等于执行授权。
- Agent 先通过能力搜索取得精确 id，再按需装载最小 Tool / Skill schema；搜索不执行动作。
- Prompt 只产生 advisory 或 declarative 内容，不授予权限、推进阶段或声明完成。
- Global System Prompt 只保存稳定身份、安全和少量跨任务原则；品类方法留在 Skill / Knowledge。
- 所有 mutation 仍由 execution preflight、目标 / revision 和 Host 事务决定。

### 2.7 Photoshop Craft 与事务

Tool semantics 回答“动作有哪些参数、副作用和读回”；Photoshop Craft Recipe 回答“为了某个视觉意图，什么条件下选择、组合并验证这些动作”。Recipe 属于 Design Kernel / Knowledge，模型可以选择、裁剪或拒绝。

`PhotoshopTransactionRunner` 是 mutation 的唯一事务 owner。每次受治理写入必须明确：

- 目标 document / layer；
- 写前 revision；
- 授权和副作用等级；
- 原子提交 /取消 /回滚；
- unknown write reconciliation；
- 与风险相称的同目标读回。

未迁移 legacy Tool 可以兼容运行，但不得另建事务、重试或完成 owner。已经 applied 但读回失败的写入不能被改写成“没有执行”后自动重放。

### 2.8 生产结果分层

生产任务不能用一个 `success` 同时表达所有事实：

1. `executionApplied`：Host mutation 已提交；
2. `executionVerified`：同目标 / revision 读回证明变化存在；
3. `designVerdict`：Evaluation 对最后成品给出质量结论；
4. `deliveryReady`：源稿、导出和交付收据齐全；
5. `userAccepted`：只来自用户明确动作。

Release 只能消费这些已有事实并投影 `release_ready / review_required / release_rejected`。审美 finding 通常驱动有界修订或人工复核；只有目标、权限、事实、结构或必需交付物的确定性错误才能形成硬拒绝。

## 3. 八个核心子系统

### 3.1 Intent Control Plane

职责：由模型结合完整上下文判断当前请求是对话、只读分析、精确编辑、开放设计、规格化生产还是需要用户独占信息。

边界：

- 关键词、文件名和 routing hint 只能提供可忽略候选；
- 保存 /关闭等明确机械动作不能被业务品类词劫持；
- 普通对话不自动升级为 Photoshop 写入；
- 技术路线不交给用户，只有用户可见业务结果、权限或不可逆取舍才询问。

### 3.2 Context Memory

职责：组织当前项目、TaskRun、Photoshop 文档、素材、用户约束、已审核 Memory 和可恢复上下文。

边界：

- 历史状态不能覆盖当前指令和真实 Host；
- Project State 保存共享项目上下文，不是权限系统；
- 项目记忆文档只投影当前事实，历史由 Git / Run Record 承担；
- 上下文必须有来源、新鲜度、稳定对象身份和失效规则。

### 3.3 Visual Perception

职责：让同一多模态 Agent 理解素材和当前画面中的主体、陪体、背景、文字、层级、光色、空间、动作方向、负空间和设计机会。

当前缺口：已有素材分类、单主体 bbox、快照和视觉评价，但“看图 → 设计假设 → 图文关系 → 执行参数”没有稳定连续表达。

目标边界：

- 开放设计在必要时可以形成 Agent 作者化、任务内的 Design Perception Note / Composition Intent；
- 内容可以包括可见事实、主次、保护部位、text-safe / negative-space、视觉重心、候选方向、阅读顺序和图文关系；
- 它不是固定 Workflow、表单、用户卡或写入门票；简单精确编辑可以跳过；
- Harness 只绑定 observation identity、校验结构和机械编译，不补造素材选择、构图、比例、文案或审美答案；
- 用户只看到简短设计依据，不展示私有思维链。

### 3.4 Knowledge And Recipe

职责：提供设计原则、交付物方法、平台规则、Photoshop Craft、经审核案例和来源。

边界：

- 模型知识是冷启动底座，知识库不是 Agent 会设计的前置许可；
- Eagle、用户成稿和外部网页是可选证据，不是设计答案；
- 未审核模型解读、Tool success、调用次数和单张截图不能发布为正式知识；
- 不建设没有当前消费者的重型知识图谱；
- 经验应优先沉淀“观察 → 方向 → 成品 → 人工理由”的可追溯案例，而不是更多抽象口号。

### 3.5 Design DSL

职责：在需要时把模型的设计意图转成可执行中间表达，例如 regions、elements、reading order、image placement、text style、constraints 和 verification targets。

边界：

- agentic 可以直接通过受 schema 和 preflight 约束的原子 Tool 行动，不因缺少声明式 DSL 被禁止写入；
- staged 的确定性节点可以要求结构化计划；
- DSL / Action Plan 的模型内容与 Harness 编译细节分离；
- 模型不直接生成自由 JS、任意 batchPlay 或未经约束的像素脚本；
- 不让模型在 Strategy 和 Tool schema 中重复手填两套无法衔接的设计关系，是后续收口目标。

### 3.6 Photoshop Execution

职责：通过 UXP / MCP / Photoshop Provider 创建、修改、保存和导出可编辑文档。

边界：

- 高确定性 Photoshop 操作优先使用 UXP / MCP，不靠鼠标模拟；
- Tool 返回成功不等于任务完成；
- 图片图框几何可以确定性执行，但“什么比例好看”由 Agent 判断；
- `cover`、裁切、蒙版、主体保护和可见范围必须分别如实表达；
- 失败恢复不能在半完成画面上静默叠加下一次写入。

### 3.7 Verification And QA

职责：验证 mutation、结构、bounds、文字、样式、图像、保存 /导出、设计 finding 和人工结论。

边界：

- 几何验收只证明执行符合声明，不证明设计选择好看；
- 自动 VLM Judge 必须用人工缺陷注入和盲评校准；
- 局部截图不能冒充完整画布终审；
- Evaluation 不拥有下一 Tool、写入许可或经验发布；
- 质量未通过不能被模型最终话术覆盖。

### 3.8 User Feedback UX

职责：向用户呈现目标、必要观察、简短设计判断、当前版本、真实阻塞和交付结果。

边界：

- 不展示私有 chain-of-thought、raw Tool JSON、内部阶段和调试协议；
- 不用 Harness 固定话术伪装模型设计思考；
- 模型空正文直接 Tool call 时，不能只显示“准备执行并复核”这类无设计含义的替代文本；
- 交互卡只用于用户独占且会实质改变结果的事实 /取舍，或 staged Skill 的确定性生产输入；
- UI 只投影同一 TaskRun，不形成第二执行器或完成 owner。

## 4. 唯一生产链

```text
用户目标
  → Model 声明 Task Profile /必要 Skill
  → Context Compiler + Capability Session
  → 同一 TaskRun
      ├─ agentic：自主 ReAct + Tool calls
      └─ staged：Runtime Session + 确定性阶段 /节点
  → execution preflight
  → PhotoshopTransactionRunner /其它 Provider
  → operation result + same-target verification
  → Evaluation / DesignVerdict
  → Release / Delivery projection
  → 受审经验候选（只在终态后）
```

不得新增平行的 Role Contract、Task Store、Context Compiler、DAG、Verdict、Release Gate、Capability Registry 或 Learning Store。需要统一展示时使用只读 projection。

## 5. 最小数据 owner

| 数据 | canonical owner | 当前说明 |
|---|---|---|
| 产品目标与强约束 | `project-memory/Prompt.md` | 治理真相，不生成 Runtime 对象。 |
| 当前任务 | `project-memory/CurrentTask.md` | 只保留一张当前卡。 |
| 当前顺序 | `project-memory/Plan.md` | 只保留一个激活阶段。 |
| 长期 SMART 路线 | `docs/project-master-plan.md` | 不直接调度。 |
| 当前事实 | 代码 /真实读回 + `Status.md` / `project-state.json` 投影 | 历史由 Git / Run Record 保存。 |
| 交付物语义 | Task Profile / crosswalk | 不选择 Skill 或授权。 |
| 活动任务 | TaskRun | 仍在从多处历史投影向单一 owner 收口。 |
| staged 阶段 | Runtime Session | agentic 不消费阶段写入门禁。 |
| Photoshop mutation | `PhotoshopTransactionRunner` | 部分 legacy Tool 尚待迁移。 |
| 设计质量 | `DesignVerdict` +校准 Evaluation | 商业质量仍未多样本验证。 |
| Artifact 正文与 hash | 主进程 Artifact Repository | 发布不等于质量通过。 |
| 项目设计上下文 | Design Project State | 不是权限和当前任务 owner。 |

## 6. Skill、Tool、交互和扩展

1. Skill 以 Tool 形式对 Agent 可发现，但内部可以拥有多步专业工作法；结果必须回到主 Agent 观察和评价。
2. SKU 专属交互卡归 SKU Skill Package；通用卡不能复制 SKU 字段或旁路 Provider。
3. Tool schema、UXP registry、preflight 分类、显示名和 scope 必须保持一致；新增 Tool 必须进入现有统一审计。
4. 浏览器、项目文件、Eagle、桌面观察和未来受控命令是跨 Skill Provider；安装 /登记 /Host 可达不等于模型可见、已授权或可执行。
5. 电脑能力只服务当前视觉设计和交付目标，必须有任务级范围、风险、批准、取消 /超时、脱敏和副作用核验。
6. 多 Agent 是可选的逻辑协作方式，不形成多个最终裁决中心；共享同一任务目标和项目状态。

## 7. 经验生命周期

任务执行内环只完成当前任务。经验外环只消费已结束、来源可追溯的 TaskRun。

```text
真实结果 /用户反馈 /参考分析
  → 隔离候选
  → 按 owner 分流
  → 离线比较或人工审核
  → 版本化发布
  → Canary
  → 可撤回生产消费
```

在线模型不能把自己的输出直接晋升为正式 Skill、Knowledge、Policy、Recipe 或 Evaluation。用户对本项目明确的“留 /改 /弃 + 原因”可以成为项目级校准，但仍要保留来源和作用域。

## 8. 架构验收

架构治理有效必须同时满足：

1. 文档能明确区分 v3、v5、bridge、legacy 和各自成熟度；
2. agentic / staged 的边界不被 Prompt、UI 或业务关键词改写；
3. Harness 不替 Agent 选择开放设计答案；
4. mutation 绑定目标 / revision，并由唯一事务提交和读回；
5. 技术、质量、交付、用户接受分别记账；
6. 主图、SKU、详情页在统一入口完成真实 Provider + Photoshop 多样本；
7. 无 Skill 设计仍能使用 Design Kernel 和原子 Tool；
8. 商业质量由人工盲评 /成对比较验证；
9. 文档、静态审计和单次成功不能外推产品完成。

当前具体阶段、样本量、目标值和时间盒见 `docs/project-master-plan.md`；当前唯一实施顺序见 `project-memory/Plan.md`。
