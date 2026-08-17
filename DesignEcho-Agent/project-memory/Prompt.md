# Prompt

## 目的

为 `DesignEcho-Agent` 提供一套长期开发时可持续回顾的项目记忆真相源。

这里记录的是：

- 当前项目的真实目标
- 当前阶段明确聚焦的范围
- 不应夸大的能力边界
- 重要约束
- 近期验收口径

不记录：

- 未经核实的“已完成”
- 只存在于讨论中的理想架构
- 无法对应到代码、构建或手测结果的判断

## 当前项目总目标

长期产品目标是建设一个面向开放式设计任务的专业设计 Agent：它能够理解用户目标与素材条件，检索并使用可追溯的设计知识，选择或组合可插拔 Skill，形成可调整计划，通过 Adobe Photoshop 完成真实操作，并依据结构读回与视觉检查持续修订直至交付或诚实停止。

在不训练或升级基础模型、不在通用 Agent 核心中写入主图、详情页、SKU 品类流程的前提下，把当前 v3 真实执行路径与 v5 治理契约逐步收口为一条生产运行时。

同一个 Agent 入口必须能够根据用户目标、当前上下文和已有观察选择 Skill、形成可调整计划、按阶段装载 Capability、调用 Tool、观察真实结果、执行 Policy、完成 Evaluation，并在失败时修订计划或诚实停止。

`main-image-design`、`detail-page-design`、`sku-batch` 是第一批验收 Skill，不是三套 Agent，也不是 Agent 的最终能力边界。所有开放式设计共享常驻 Design Kernel；新增海报、社媒视觉、包装或其他设计类型时，先判断通用底座是否已经覆盖，只有品类、渠道或交付物特有的方法、约束和评价才新增 Skill overlay，不修改通用 Planner、Agent 循环或执行安全边界。

## 标准设计 Agent 产品边界

DesignEcho Agent 的权威产品身份是：

> **一个面向真实视觉设计工作的专业设计 Agent：它把用户的设计目标、可追溯事实和真实素材转化为可编辑的 Adobe Photoshop 设计交付物，通过写后读回与专业评价进行有界修订，并且只依据可验证结果报告完成、待复核或无法继续。**

这是一条产品与行为边界，不是新的 Runtime Contract、任务族枚举、Intent Router 或 Tool 白名单。现有 Task Profile 负责表达用户要什么交付物，TaskRun 负责活动任务，Capability / Policy 负责能力与权限，Release 负责结果投影；不得再增加 `RoleContract → TaskContract → OutcomeContract` 并行链。

Agent 应能理解“主图、详情页、SKU 模板、SKU 色卡、批量出图、海报、Banner、社媒封面、改版、调色、排版、检查这稿”等自然业务表达，并以用户目标、项目、素材和 Photoshop 上下文消歧。设计知识解释和 Photoshop 工艺说明可以直接回答；与视觉设计无关的通用代办不进入生产执行。边界判断依赖模型对完整上下文的理解，不使用关键词或文件名抢先拒绝。

所有真实设计工作共享四项稳定责任：取得有来源的事实与观察、作出可说明的专业判断、落成可编辑且目标绑定的 Photoshop 结果、通过同目标读回与评价诚实交付。它们是职业责任，不是固定 Workflow，也不需要新增字段逐项打卡。

“从零创作”是 Design Kernel 面对空白或需要重建的目标状态时应具备的本身设计能力，不是独立 Task Type、Skill、Executor、WorkMode 路由或代码子系统。代码只需表达本次任务的目标、现状、保护关系、执行要求和交付规格；设计内容、构图、层级、色彩、排版与工艺由模型结合 Design Kernel、知识、参考和真实观察完成。

Agent 不得无来源编造商品、品牌、价格、SKU、颜色、版权或合规事实；不得把无限研究、多 Agent 讨论、生成式整页图片、Tool success、模型自评或单张截图冒充可编辑设计交付；在线运行也不得自行晋升正式 Skill、Knowledge、Policy、Recipe 或 Evaluation。

## Harness 成果定义

治理是否有效，不以 Tool 数量、Skill 数量、Prompt 长度或模型调用次数判断。有效 Harness 必须让同一 Agent 在不依赖业务 Skill 的情况下具备以下可观察能力：

1. **任务语义扎根**：理解用户所说的交付物及其基本目标、典型输入、可观察事实、用户取舍和完成标准。主图、详情页、SKU 批量、SKU 色卡、SKU 模板、开放式单画布等必须有稳定语义；裸 “SKU” 存在多义时，Agent 先利用当前项目和 Photoshop 上下文消歧，只有结果会实质改变且无法自行取得时才询问用户。
2. **事实与知识扎根**：冲突按 authority domain 裁决，而不是用一条总排序混淆目标、事实和权限。当前用户指令拥有本轮目标与取舍，但不能扩大权限或改写已观察环境事实；当前项目 /PSD 状态以真实读回为准；商品、品牌和规格以有来源且已确认的事实为准；Knowledge、Memory 与参考只提供方法和历史上下文；模型先验只能提出待验证假设。
3. **专业设计判断**：Design Kernel 提供跨品类的构图、信息层级、排版、色彩、空间、可编辑结构和多尺度复核能力；Skill 只叠加特有方法。Harness 不替模型写创意方案，但必须保证模型取得正确的语义、事实、知识、能力和反馈。
4. **Photoshop 工艺落地**：Agent 能把视觉意图映射为适用条件明确的 Photoshop Craft Recipe，再编译为目标绑定、参数有来源、优先非破坏性的原子动作；不能只知道工具名称或临场猜 batchPlay 参数。
5. **真实执行与验真**：每次 mutation 必须通过唯一事务 owner 执行，并以同 target / revision 的结构与像素读回验证。Tool success、截图观感、模型自述和离线 fixture 均不能单独证明设计完成。
6. **持续推进与诚实停止**：真实进展只来自新的语义绑定、事实、计划节点状态、operation result、同目标读回或质量结论；重复控制声明、重复观察和换措辞不算进展。对于已获授权且交付要求 Photoshop mutation 的任务，探索预算不得耗尽至少一次写入后的同目标读回和评价所需供给；只读或建议任务不因此被强迫写入。无可达恢复路径时进入等待、checkpoint、拒绝或诚实停止。

`Task Semantic Binding` 只把模型声明的交付物语义绑定到相应 Design Kernel profile；它不等于选择 Skill，不授予 Tool 权限，不推进 Runtime Stage，也不得由关键词、文件名或旧路由提示补造。

## 当前北极星

当前最重要的能力不是“全设计场景都能做”，而是：

1. 现有生产 Runtime Session 原地演进为唯一可挂起 TaskRun，拥有 R0 Skill 选择、R1 Brief、R2 Observation、R3 Strategy、R4 Plan、E1 Execution、R5 Evaluation、Reflexion 和 E2 Delivery，以及任务身份、plan revision、节点 cursor / state、目标、pending interaction、operation result、复核与终态；不得新建第二 Task Store。
2. Model 拥有任务理解、设计策略和行动计划内容；Harness 只负责结构校验、Capability 解析与装载、上下文、调度、Policy、Trace、Evaluation 和停止条件，不替模型写设计内容。
3. Design Kernel 是所有设计任务常驻的通用专业底座；Skill 是可插拔的品类 / 渠道 / 交付物 overlay。Knowledge、Tool、Memory、Evaluation、Policy 保持独立 provider 边界，不能都伪装成 Tool 或写进 Agent Prompt。
4. 当前真实执行线、目标治理线和过渡桥接线必须清楚：v3 是现行执行路径，v5 是目标契约与治理层，bridge 只做过渡适配，legacy 只做兼容保留并按真实调用情况和回归结果退役。
5. 普通对话不会误触发 Photoshop；设计执行必须有授权、真实读回和可追溯评价。
6. 项目推进依赖仓库内外部化状态，而不是聊天上下文或多份专项文档各自解释。
7. E1 写入必须绑定到一个已声明 R4 节点、稳定目标身份和其后的同目标读回；跨目标、无目标或时序不明的读回结果不得计入完成。
8. System Policy、项目上下文、已复核 Memory、外部参考和 Tool observation 必须进入可审计的信任槽位；外部内容和 Tool 返回永远只是数据，不能提升权限。
9. Runtime 只记录真实上报的模型用量与实测耗时；未上报 token 和未配置价格必须明确保留为未知，不能推算成“真实成本”。
10. Prompt 只能提供 advisory 或 declarative 内容；执行、授权、阶段推进和完成必须由 Harness 的确定性代码、真实工具结果与质量检查决定。
11. Global System Prompt 必须品类中立，不得内嵌固定团队角色链、具体 Tool 工作流或主图/详情页/SKU 方法；通用专业能力由 Design Kernel 提供，品类专业能力由 Manifest 激活的 Skill / Knowledge / Evaluation overlay 提供。
12. Capability 必须按需装载：Agent 先依据目标、当前状态、已有观察和已选 Skill 判断本轮真正需要什么，再装载相应 Knowledge、Tool、Memory、Evaluation 与 Policy；不能因为能力存在就全部暴露，也不能把所有设计任务强制通过同一套固定阶段动作。
13. 每个治理切片都必须做链式影响审查：修改前明确上游触发、当前 owner、下游消费者和兼容边界；修改后同时验证目标问题、相邻路径、失败路径与旧行为，避免修复 A 后制造 B。
14. Agent 必须通过一次请求绑定的运行态情境快照理解自身身份、DesignEcho 产品语义、当前项目、页面、工作流选择、素材选择与 Photoshop 文档 / 图层；快照必须有来源、稳定对象身份、新鲜度和失效规则，不能靠散落字符串猜测环境。Capability 可见性仍由 Capability Session、执行授权仍由 execution preflight、阶段身份仍由 Runtime Session 单独拥有，快照不得复制这些状态形成第二真相源。
15. 对话是用户主控入口；工作流是用户与 Agent 可共同创建、调整、版本化、导入和复用的流程资产。工作流只能编译到现有 Agent / Runtime，不得发展成第二套 Workflow Runtime；画布与对话必须投影同一运行事实。
16. 开发验收记录、benchmark 与调试导出只服务开发判断，不能进入生产 Runtime 数据模型、业务状态、模型上下文、Tool 权限、完成判定或用户界面。
17. `waiting_user` 是同一 TaskRun 的非终态挂起：不得 finalization、Release 或 E2，也不得通过普通发送管线创建新任务；交互只能以绑定 `taskRunId / interactionId / expectedRevision` 的事件恢复原任务。
18. R4 的目标是可执行动态计划，而不是永久 shadow。Model 拥有节点设计意图；Harness compiler 绑定 capability/provider、typed arguments、AssetHandle / target revision、依赖与预期结果。计划声明不授予权限，节点只能经过 execution preflight 和唯一 PhotoshopTransactionRunner 执行。
19. 产品 Runtime 不建立通用 Evidence 对象或 Evidence 阶段；正确性使用具体的 context、observation、operation result 与 verification 表达，开发验证记录继续与生产状态隔离。
20. 项目彻底退役 smoke 验证体系：不新增、不维护、不依赖 `smoke-*` 脚本，不因为缺少某个 smoke 就补写一次性测试。默认质量依据是构建、类型检查、静态审计、规划/仓库卫生检查和可复用真实功能测试；禁止为了通过测试制造假绿或吞掉真实失败。
21. 设计 Agent 不承担“举证”职责，也不向用户展示 Harness、Runtime、阶段、权限、验收条目或操作计数。它只负责理解目标、做专业取舍、执行设计、查看当前效果并有界调整。文档身份与 revision、真实 Tool 结果、保存 / 导出回执继续由执行边界自动采集，用于防止误报和误覆盖；这些后台事实不得依赖模型自报，不得被包装成用户可见的“证据报告”。

## 当前阶段聚焦

当前阶段只聚焦以下事项：

1. M0–M2 的可信工作树、`RuntimeTaskSnapshot` 只读投影和单一 Artifact Repository 事实继续有效，不重新实现这些 owner。
2. 标准设计 Agent 的产品身份与职业边界只由 `Prompt.md` 和 Design Agent OS 定义，不新增角色 Runtime Contract、任务族枚举、Intent Router、Task Contract 或 Outcome Contract；既有 Task Profile、TaskRun、Capability、Verification、DesignVerdict、Release 与 Delivery 各自承担生产责任。
3. `PhotoshopTransactionRunner` 继续作为唯一 mutation 事务 owner，但迁移按真实纵切需要的 capability pack 推进，不再等待全仓所有 direct-modal 文件完成水平迁移；每个已迁移动作仍必须统一目标 / revision、同一 modal、取消、提交、未知写状态读回与回滚。
4. 与 Runner capability pack 同步把现有 Runtime Session 原地升级为最小可挂起 TaskRun；优先拥有 plan revision、节点状态、`waiting_user`、revision-bound interaction、operation result、document / revision 与单文档写者身份。UI、Snapshot、结果卡与完成摘要只读投影。
5. 只读 Design Foundation 可以与执行 owner 收敛并行：复用现有 `design-task-types.ts` 收敛 Task Profile / crosswalk，明确 artifact knowledge、Manifest 与 document role 的 owner；唯一 Context Compiler 必须按当前 Stage 装载方法论。该车道不授予 Tool、Skill、Stage 或完成权限。
6. 对同时具备 TaskRun、Capability、execution preflight、稳定 target / revision 和 TransactionRunner owner 的节点，把 R4 从 shadow 按 capability pack 切为受控执行；Tool 结果直接归属节点。未迁移 legacy Tool 不进入该执行切片。
7. continuation / resume / public-plan、Completion 重推断、Recovery Queue、workflow scope、no-progress 争抢和 shadow reconciliation 按节点切换同步退役，而不是等待所有 Photoshop Tool 迁移后一次性清理；保留不可逆审批、schema / permission、目标绑定、回滚与 unknown readback。
8. 先用通用目标替换 /语义图层整理验证“看准、写准、读回准”，再用真实素材、确定文案与品牌约束打穿不使用业务 Skill 的受限单画布设计；第一条纵切直接接入唯一 Release Gate 的首个消费路径，不建立临时第二 Gate。
9. 唯一 Gate 成熟后依次验收主图、SKU Template / Color Card / Batch、详情页；每类覆盖成功、可恢复失败、真实等待和诚实停止，并把 Photoshop E2E、设计质量复核与稳定商业质量分开声明。
10. 用真实 TaskRun、operation result、Release 与 Delivery 建立 verified-task 指标；缺少真实 usage 或价格时保持 unknown，不估算成本。Hermes 式候选晋升、Canary 与回滚继续后置到多样本真实验收之后。
11. 每个纵切必须替换或退役对应旧责任；现有 Manifest、Skill declaration、Capability resolution、Runtime Session、Project State 与 `DesignVerdict` 继续作为 canonical owner 演进，不复制 Registry 或状态机。

## 当前阶段非目标

以下内容当前不作为主目标推进：

1. 在首批验收完成前宣称已经具备全场景品牌设计能力
2. 在没有真实 Skill、Knowledge、Photoshop 运行结果与 Evaluation 检查时宣称已经具备全场景平面设计能力
3. 训练、微调或更换更强模型来代替 Harness 治理
4. 一次性重写全部 v3，或新建第三套 Runtime / DAG
5. 不再把袜子形态统一作为孤立的 UXP 实验继续扩张；当前只允许在统一 SKU Skill 内实现「纯底素材精修 → 可编辑色卡 → 读回验收」这条受控纵切
6. 大规模 UI 改版
7. 无明确消费者的重型知识图谱建设
8. 用固定模板包装成“动态规划”
9. 候选审议、偏好 posterior、自动演进发布、更多 Agent 角色或 Marketplace
10. 在 PhotoshopTransactionRunner、TaskRun、目标绑定和 execution preflight 完成前，直接授予 R4 无约束写调度权

## 强约束

1. 不允许用兜底、遮掩、对抗性修复掩盖根因。
2. 不允许把内部调试链路直接暴露到普通用户聊天链路。
3. 不允许把“未验证”写成“已完成”。
4. 中文源码与文档必须保持 UTF-8，可读，不接受乱码进入业务逻辑。
5. 对项目能力的描述必须区分：
   - 已核实（代码）
   - 已核实（构建）
   - 已核实（手测）
   - 未核实 / 待验证
6. 不允许只为当前样例写单点补丁；任何会改变路由、Capability 可见性、文档选择、Tool 执行或完成判定的修改，必须附带上游—当前—下游影响矩阵和相邻回归结果。

## 当前阶段的能力边界表述

允许这样描述：

- v3 仍是当前默认真实执行路径。
- v5 已承担部分契约、manifest、视觉观察上下文、ReAct / Reflexion 和边界治理能力；视觉观察负责提供设计输入，不负责授予或阻断执行。
- bridge 已用于把部分 v5 契约映射到旧 Agent / 旧工具链，但它只是过渡层。
- 参考图复刻、主图、详情页、SKU 等是业务场景能力，不是当前运行线命名的依据。

不允许这样描述：

- v5 已经完全替代 v3。
- bridge 是新的业务运行时。
- legacy 逻辑可以继续扩张。
- 已实现完整设计能力
- 已实现品牌设计/平面设计全场景能力
- 已能稳定高保真复刻任意参考图

## 近期验收标准

### A. 代码与构建

1. 当前源码对应的 Agent fast、Renderer/Main 类型检查、`npm run build` 与 UXP build 通过，并保存可定位的汇总；旧 `dist` 或历史文字记录不能代替当前基线。
2. 未跟踪生产源码、删除隔离区和变化批次都有 owner / 处置状态，不把整个工作树作为单一切片处理。
3. 项目记忆文件存在且结构稳定；回顾时不需要先翻长聊天记录。

### B. Agent 运行线与治理主链

1. 文档和运行结果能明确区分 v3、v5、bridge 和 legacy，并能指出每段责任的唯一 owner。
2. 一个生产 TaskRun 拥有 R0-R5/E1-E2 与计划节点生命周期；阶段、等待和终态不能由 UI、普通 Tool success、TaskCompletion 摘要或 legacy 状态机伪造推进。
3. Model 声明 Brief / Strategy / Plan；Harness 只校验、调度和约束，不能补造观察、工具结果或固定品类流程。
4. 新增能力优先进入对应 v5 manifest / Capability provider，不继续扩张 legacy 分支。
5. 已完成状态必须区分 contract_ready、bridge_ready、runtime_integrated 和 photoshop_e2e_verified。
6. `RuntimeTaskSnapshot` 只能派生现有 Runtime / Tool / Verdict / Delivery 事实；Artifact 必须由主进程 Repository 发布；Release 只能由唯一 Gate 裁决。
7. `waiting_user` 必须保持同一 TaskRun 非终态并可由 revision-bound interaction 恢复；新建 run、重新发送用户文本或独立卡片 ledger 均不能代替恢复。

### C. Skill 与扩展性

1. 主图、详情页、SKU 使用同一 R1 / R3 / R4 控制契约和同一 Harness 闭环。
2. Agent 核心不新增主图、详情页、SKU 的关键词路由、Tool 白名单、Prompt 分支或状态机。
3. 第四个 Skill 接入演练原则上不修改 Agent 循环、Planner validator、Policy 核心或 UI 发送管线。
4. Skill 接入必须同时具备 Manifest、输入输出、Knowledge 引用、Capability 引用、Evaluation Profile 和真实 E2E 验证结果。
5. Skill Package audit 通过只证明契约完整和引用可解析，不等于 provider 可用、设计质量通过或 Photoshop E2E 已完成。
6. Prompt 模块必须声明 owner、implementation、authority、scope、activation、stage 和 capability kind；固定顺序、独立 Runtime State、模型执行权或完成权必须被治理审计拒绝。
7. 无业务 Skill 的开放式设计仍必须能由 Design Kernel 形成 ProductTruth、AssetHandle、SceneGraph / DesignIR、动态计划、Photoshop 执行与多尺度复核；Skill 缺失不能等同于 Agent 不会设计。

### D. 实机与真实性要求

1. 主图、详情页、SKU 均从统一生产入口完成真实 Provider + 一次性 Photoshop 文档的执行、读回、Evaluation、DesignVerdict 和交付检查。
2. 文档中每项“已完成”都能对应到代码、构建、运行记录或手测结果。
3. 离线 fixture、Smoke、Manifest 存在或单张截图不能冒充 Photoshop E2E 或设计质量通过。
4. 未手测通过的内容必须显式写“未手测”；风险项不能因为讨论次数多而自动变成结论。

### E. 结果分层与学习边界

1. 生产结果必须分别记录 mutation 是否提交、同目标读回是否验证、`DesignVerdict` 是否通过、交付物是否齐全、用户是否明确接受；上层状态不能补造下层事实，用户接受只能来自用户明确动作。
2. 任务执行内环只完成当前任务；经验演进外环只消费已经结束且来源可追溯的 TaskRun。设计方法、Recipe 或 Skill 收益候选必须具备真实 operation result、同目标读回、`DesignVerdict` 与相应交付 /人工反馈；失败或中止运行可以形成代码、契约、Provider、恢复缺陷、负向设计 finding 或 Evaluation-gap 假设，但不能据此晋升设计方法。
3. 未复核经验、Tool success、模型自评、调用频次或单次截图不得进入正式 Knowledge / Skill / Policy。任何在线 TaskRun 都只能写隔离候选；canonical 内容只能由发布 owner 在离线对比、人工批准、Canary 和可回滚版本准备完成后变更。
4. `photoshop_e2e_verified` 只证明真实生产闭环；稳定审美或商业质量必须另行达到 `commercial_quality_verified`，并由多样本真实任务、专业设计师盲评 /成对比较和可报告的样本量支持。
