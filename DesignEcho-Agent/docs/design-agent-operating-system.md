# Design Agent OS 架构真相源

日期：2026-05-08

## 1. 文档定位

本文件是 DesignEcho 设计智能体的顶层架构入口，用于回答一个核心问题：

用户提出任意设计相关需求时，Agent 应该如何理解、组织上下文、选择能力、调用 Photoshop、验收结果并继续修正。

本文件不是宣传文案，也不声明“自动设计能力已经完成”。当前项目已有 Agent 基础设施、Photoshop 工具、参考图复刻、主图、SKU、详情页、文案和知识入口等多个局部能力，但这些能力必须被统一到同一个控制系统下，不能继续以孤立技能或硬编码场景扩张。

## 2. Agent 定义

DesignEcho Agent 不是工具列表，也不是固定关键词路由。

它应该是一个控制系统：

1. 理解用户真实意图。
2. 组织项目、素材、Photoshop 文档、历史任务和用户约束。
3. 判断需要哪些设计知识、视觉理解、Photoshop 操作和验收证据。
4. 生成可执行计划，而不是把模型输出直接当成 Photoshop 动作。
5. 调用工具执行，并记录每一步真实结果。
6. 用 Photoshop 状态、图层、bounds、截图或报告验证结果。
7. 在失败、置信度不足或证据不完整时降级、请求补充或给出可修复原因。

主图、SKU、详情页、参考图复刻、文案撰写、抠图、局部重绘、形态处理都只是这个控制系统上的场景或工具，不是 Agent 的边界。

## 3. 八个核心子系统

### 3.1 Intent Control Plane

职责：判断用户到底要聊天、解释、创建设计、修改 Photoshop、保存文件、分析素材，还是需要澄清。

边界：

1. 不能只靠关键词抢路。
2. “保存详情页 PSD”优先是保存动作，不应因为出现“详情页”就执行详情页生成。
3. 模型身份、能力比较、解释性问题应先走对话，不应触发 Photoshop 工具。
4. 模型前确定性直达只允许机械操作，例如保存/关闭文档、明确图层顺序、明确字体替换；参考图复刻、开放式设计、整套电商设计等需要视觉/设计理解的任务必须先经过模型路由或规划判断。
5. 确定性路由可以作为模型选错 skill 时的安全兜底，但不能替代模型理解设计意图。

### 3.2 Context Memory

职责：管理项目状态、当前 Photoshop 文档、历史任务、用户偏好、待办规划和可恢复上下文。

边界：

1. 不能只依赖聊天历史。
2. 中大型需求必须进入 `CurrentTask.md / Intake.md / Plan.md / project-state.json`。
3. 状态必须区分已核实、未核实、风险和规划。

### 3.3 Visual Perception

职责：理解图片、参考图、当前画布、图层位置、元素关系、文本区域、主体区域和视觉层级。

边界：

1. 从扁平图片只能推断一个可编辑重建方案，不能宣称还原原作者真实 PSD 或历史步骤。
2. 没有图片证据、OCR、产品事实或画布证据时，不能编造款式、材质、场景和卖点。
3. 视觉理解结果必须结构化，不能只停留在自然语言描述。

### 3.4 Knowledge And Recipe

职责：提供设计定义、平台规则、版式规则、文案框架、Photoshop recipe、网页来源证据和案例经验。

边界：

1. 当前不启动重型知识图谱。
2. 知识结果只能作为上下文、约束或 recipe 线索，不能直接变成 Photoshop 动作。
3. 外部网页搜索必须保留来源和置信度，不能把未经验证内容写成项目事实。

### 3.5 Design DSL

职责：把用户需求和视觉理解转成可执行的中间表示，例如画布、网格、文本块、图片槽、主体框、样式、recipe 和验收目标。

边界：

1. executor 只消费 DSL 或执行计划，不应该在执行时重新混合大量推理。
2. Grid DSL、智能缩放、文本排版和样式 recipe 都应挂在同一层，避免各场景各写一套规则。
3. 没有 DSL 或执行计划时，不应让模型直接自由调用 Photoshop 工具碰运气。

### 3.6 Photoshop Execution

职责：用 UXP/MCP/Photoshop 工具真实创建、修改、保存、导出可编辑图层。

边界：

1. 高确定性的 Photoshop 内部操作优先走 UXP/MCP，不走鼠标模拟。
2. UXP 面板工具不自动等于 Agent skill；是否开放给 Agent 必须单独定义安全边界。
3. 工具返回成功不等于任务完成，必须进入验收层。
4. 受控脚本化执行只能消费经过校验的 DSL 或 ExecutionPlan，不能让模型自由写 JS、UXP 脚本或 batchPlay descriptor 后直接执行。

### 3.7 Verification And QA

职责：验证工具执行、图层变化、bounds、文本内容、样式、截图相似度、失败原因和人工验收结论。

边界：

1. 当前已有结构和 bounds 验收，但不能等同于审美质量验收。
2. 参考图复刻必须区分骨架复刻、基础样式复刻、截图级相似和设计质量。
3. 任务失败或需复核时，不能用模型最终话术覆盖真实执行摘要。

### 3.8 User Feedback UX

职责：让用户看见真实模型输出、工具调用、执行日志、阻塞原因、验收报告和下一步建议。

边界：

1. 不展示私有 chain-of-thought。
2. 不用硬编码模板伪装模型思考。
3. “正在思考”只用于真实 provider thinking/reasoning 或模型真实输出；系统路由、工具事件和验收证据显示为执行日志或任务报告。

## 4. 最小数据契约

当前先定义契约清单和职责，不要求一次性落地完整 TypeScript schema。

| 契约 | 职责 | 当前状态 |
| --- | --- | --- |
| `UserIntent` | 用户真实任务、动作优先级、是否需要 Photoshop、是否需要澄清 | 部分存在于路由和分类器 |
| `DesignBrief` | 设计目标、受众、场景、风格、尺寸、输出物、禁忌 | 缺统一真相源 |
| `AssetUnderstanding` | 项目素材、图片内容、主体、尺寸、可用性、风险 | 部分存在，未统一 |
| `VisualUnderstanding` | 参考图/画布元素、层级、布局、文本、样式、视觉关系 | 参考图复刻中部分存在 |
| `DesignDSL` | 网格、区域、文本块、图片槽、样式、recipe、约束 | 分散在 Grid、reference、smart-scaling |
| `ExecutionPlan` | 工具调用计划、依赖、降级策略、预期证据 | 分散在 skill executor |
| `ExecutionTrace` | 真实工具调用、结果、错误、耗时、focus、acceptance | 部分存在于 onStep 和 executionSummary |
| `VerificationReport` | 结构验收、bounds、截图、任务级结论、需复核项 | 部分存在于 acceptance 和 QA |

## 5. 设计任务生命周期

标准流程：

1. Intake：接收用户需求和素材。
2. Intent：判断意图、动作优先级和是否需要澄清。
3. Context：读取项目、Photoshop 文档、素材和历史任务。
4. Perception：理解图片、画布、图层和文本。
5. Brief：生成设计简报和约束。
6. Plan：生成 DSL 与 Photoshop 执行计划。
7. Execute：调用 UXP/MCP/工具执行。
8. Verify：读取真实 Photoshop 状态并验收。
9. Revise：必要时修正、降级或请求补充。
10. Deliver：输出结果、证据和剩余风险。

任何业务场景都应该套入这个生命周期。主图、详情页、SKU 和参考图复刻的差异应体现在 DesignBrief、DesignDSL、ExecutionPlan 和 VerificationReport 中，而不是各自绕过总控系统。

## 6. 现有文档角色

1. `project-memory/Plan.md`：阶段路线、里程碑、顺序约束和验收口径。
2. `docs/project-master-plan.md`：长期项目计划书，区分已实现、当前开发和未来愿景。
3. `docs/agent-capability-map.md`：能力 inventory，用于盘点当前有哪些能力、证据、边界和缺口。
4. `docs/reference-replication-project-plan.md`：参考图复刻专项计划。
5. `docs/design-domain-knowledge-implementation-plan.md`：设计领域定义和轻量知识入口计划。
6. `docs/design-knowledge-web-search-plan.md`：外部设计知识和网页搜索规划。
7. `docs/layout-grid-design-knowledge.md`：网格排版知识和 Grid DSL 规划。
8. `docs/smart-scaling-photoshop-transform-research-plan.md`：智能缩放和 Photoshop 变换研究。

本文件位于这些文档之上。其他文档可以继续保留，但必须服务于 Design Agent OS，不应成为第二套架构真相源。

## 7. 严格执行顺序

从现在开始，执行顺序按“先 Agent、后业务 skill”推进。

### 7.1 阶段 0：文档治理与方法论收口

1. 收口真相源。
2. 固定默认阅读顺序。
3. 降级高干扰文档。

这是所有后续开发的前置条件。

### 7.2 阶段 1：Agent 认知控制面

1. 修正用户意图理解。
2. 修正对话 / 澄清 / 确定性 Photoshop 操作 / 开放式设计任务的边界。
3. 消除“不经模型理解直接硬编码执行”的路径。
4. 消除“简单任务很慢、绕很多步、像傻子”的路径。

本阶段的目标不是做设计效果，而是让 Agent 至少像一个正常的控制系统，而不是一组互相竞争的硬编码分支。

### 7.3 阶段 2：Photoshop 执行控制面

1. 稳定 UXP、MCP、bridge 健康检查。
2. 稳定简单 Photoshop 操作的真实执行和真实读回。
3. 让错误、弹窗、无响应和 cleanup 都进入结构化控制。

如果执行层不稳定，后续任何设计能力都会被假通过和随机失败污染。

### 7.4 阶段 3：验收与 QA 控制面

1. 统一 ExecutionTrace 和 VerificationReport。
2. 明确“工具成功”“执行成功”“设计完成”“质量通过”的区别。
3. 建立自动停机和失败反馈机制。

没有这一层，Agent 只会不断调用工具，却不知道自己到底有没有做对。

### 7.5 阶段 4：Planner / 契约 / DSL

1. 把 `UserIntent`、`DesignBrief`、`AssetUnderstanding`、`VisualUnderstanding`、`DesignDSL`、`ExecutionPlan`、`ExecutionTrace`、`VerificationReport` 真正接成运行时主线。
2. 让 executor 只消费计划，不在执行期继续承担大量推理。
3. 在 Photoshop 执行控制面稳定后，允许新增受控脚本化执行引擎作为 ExecutionPlan 的批处理解释器；它只提升确定性执行效率，不替代视觉理解、审美判断或验收。

### 7.6 阶段 5：通用设计闭环

1. 优先打穿参考图复刻。
2. 证明 Agent 能完成“理解需求 -> 规划 -> Photoshop 执行 -> QA -> 修正”。

这一步通过前，不能把业务 skill 的局部效果误写成通用设计能力完成。

### 7.7 阶段 6：共享设计能力补强

1. 文本排版。
2. Grid DSL。
3. 智能缩放。
4. 图片置入。
5. 素材理解。
6. 设计知识与 recipe 入口。

这些都必须作为共享层服务总控，不允许直接硬编码进主图、详情页或 SKU。

### 7.8 阶段 7：业务 skill 集成

1. `main-image-design`
2. `detail-page-design`
3. `sku-batch`
4. `ecommerce-design` 统一父 skill

它们只能建立在前面通用能力之上，不得反向定义 Agent 架构，也不得在基础设施未稳定前继续扩张策略和 UI。

### 7.9 阶段 8：偏好与学习

1. 用户偏好。
2. 项目偏好。
3. 可复用 recipe 和记忆。

这一层必须后置，不能用“学习能力”掩盖当前基础能力不稳定。

## 8. 冻结规则

1. 在阶段 1 到阶段 4 没有稳定通过前，主图、详情页、SKU 只允许做必要 bugfix、验收、边界澄清和只读 evidence，不继续扩新设计策略。
2. 新的设计知识、网页搜索、视觉模型入口、父子 skill 编排，都必须说明自己服务于哪个阶段；如果没有明确消费者，不进入实现。
3. 任何 benchmark、synthetic case、单次成功截图，都不能推动阶段跳级。
4. 任何业务 skill 不得再新增第二套规划入口或第二套控制平面。
## 9. 不可外推结论

1. 当前不能宣称“一句话自动设计已经完成”。
2. 当前不能宣称“参考图高保真复刻已经完成”。
3. 当前不能宣称“知识库 / RAG / 网页搜索已经完整可用”。
4. 当前不能把 Photoshop 工具成功当成设计任务成功。
5. 当前不能把 FEX 或任一单 case 当成通用设计能力。

## 10. 验收口径

本架构收口完成的验收标准：

1. 本文档存在并成为顶层架构入口。
2. `Plan.md` 有 M0d 控制平面与数据契约里程碑。
3. `CurrentTask.md` 指向本轮架构收口，而不是继续堆旧任务。
4. `Intake.md` 记录 Design Agent OS、端到端自动设计、Photoshop 聚焦、文案证据链和知识搜索等需求归属。
5. `project-state.json` 的 activeRequest / activePlan 指向本轮架构收口。
6. 维护校验通过，且没有把未完成能力写成已完成事实。
