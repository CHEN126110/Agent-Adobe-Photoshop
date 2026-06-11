# 设计类智能体开发知识文档

## 目的

把当前仓库里关于“设计类智能体”的已有认知、架构经验、实现边界和外部方法论收口成一份可持续复用的文档。

这份文档优先回答四个问题：

1. 设计类智能体和普通对话 Agent、普通 GUI Agent 有什么不同
2. 真正可落地的设计智能体应该分成哪些层
3. 当前 `DesignEcho-Agent` 已经具备了哪些基础，缺口在哪里
4. 后续应该沿什么顺序推进，避免继续堆业务硬编码

## 一句话定义

设计类智能体不是“会调设计工具的聊天机器人”，而是：

**能理解设计目标、感知当前设计场景、形成可解释计划、调用确定性工具落地、并对结果进行复核与迭代的系统。**

它的目标不是只“生成一张图”，而是尽量产出：

- 可编辑
- 可解释
- 可复核
- 可迭代
- 可复用

的设计结果。

## 设计类智能体与其他 Agent 的区别

### 1. 和普通聊天 Agent 的区别

普通聊天 Agent 的重点是：

- 理解问题
- 组织回答
- 必要时调用少量工具

设计类智能体多出来的关键要求是：

- 要理解视觉结构，而不只是文字语义
- 要理解当前画布、图层、模块、主次关系
- 要把设计目标转成可执行动作，而不是只给建议
- 要能判断结果“设计上是否合理”，而不只是“工具是否执行成功”

### 2. 和普通 GUI / 桌面 Agent 的区别

普通 GUI Agent 更关注：

- 点按钮
- 填表单
- 操作成功

设计类智能体更关注：

- 当前文档中的对象语义
- 图层和模块之间的关系
- 结果的版式、层级、对齐、图文说服力

所以设计类智能体不能只依赖截图级感知。

对 Photoshop 这类设计软件，更有价值的是结构化信息：

- 图层
- bounds
- clipping
- group / parent-child
- 文本样式
- z-order

结论：

**设计类智能体的主路线应该是“结构化设计感知优先”，而不是“截图点点点优先”。**

## 设计类智能体的核心目标

一个成熟的设计类智能体，至少应覆盖以下闭环：

1. 理解用户真正要做什么
2. 理解当前设计场景里有什么
3. 把设计任务转成明确计划
4. 用确定性工具执行
5. 对结果做审计、评分、解释和下一轮修正

如果缺少其中任意一层，就容易退化成以下三类半成品：

- 只会答建议，不会执行
- 只会执行工具，不会设计
- 只会生成图片，不会输出可编辑结果

## 推荐的总体架构

推荐采用六层结构：

1. 意图理解层
2. 设计场景感知层
3. 设计推理与规划层
4. 执行层
5. 审计与复核层
6. 记忆与基准层

可简化理解为：

`Perceive -> Plan -> Validate -> Execute -> Audit -> Iterate`

### 1. 意图理解层

负责：

- 区分普通聊天和可执行任务
- 区分设计解释、设计规划、实际执行、结果复核
- 识别任务属于详情页、主图、参考图复刻、文案优化等哪一类

这里的原则应该是：

- 模型负责理解用户想做什么
- 规则负责校验是否允许、是否可行

不应长期停留在“规则决定任务，模型只补文案”的状态。

### 2. 设计场景感知层

负责把当前 PSD / 画布 / 参考图，转成可推理对象。

至少应沉淀以下对象：

- `DesignElement`
- `DesignRelation`
- `DesignModule`
- `DesignScreen`
- `DesignScene`

这层是设计智能体能否真正“理解设计”的起点。

如果没有统一场景模型，后面所有业务功能都会各自解释 PSD，最终变成重复硬编码。

### 3. 设计推理与规划层

负责回答：

- 应该改哪里
- 为什么改这里
- 复用哪些元素
- 新建哪些元素
- 图片怎么放
- 文案如何组织
- 哪些地方有风险

这层产物不应只是自然语言，而应尽量结构化，至少包含：

- 目标区域
- 设计意图
- 动作列表
- 素材策略
- 文案策略
- 约束
- 风险
- 验证点

### 4. 执行层

执行层只负责确定性动作，不负责设计语义决策。

它应做到：

- 创建元素
- 改文字
- 放图
- 对齐
- 缩放
- 排列
- 导出

它不应做到：

- 猜设计意图
- 临场决定设计策略
- 用隐藏兜底掩盖上游规划不足

### 5. 审计与复核层

设计任务不能只判断“执行成功”，还必须判断“结果是否合理”。

因此需要单独的审计层，至少覆盖：

- placement audit
- copy layout audit
- visual structure audit
- before / after 对照
- 关键风险解释

这层的价值在于：

- 避免系统“做了但不知道做得对不对”
- 支持人工复核
- 支持下一轮修正
- 支持 benchmark 与回归测试

### 6. 记忆与基准层

设计类智能体比普通脚本更依赖长期可复用知识。

至少需要三类记忆：

1. 工作记忆
   - 当前任务上下文
   - 当前文档状态
   - 最近一轮执行产物

2. 项目记忆
   - 真相源文档
   - 当前阶段目标
   - 已核实 / 未核实边界

3. 长期知识
   - 高价值设计规则
   - 已验证的布局 recipe
   - 参考案例与 benchmark

如果没有这层，系统会长期重复犯三类问题：

- 只靠聊天上下文推进
- 同样问题反复分析
- 未验证能力被误写成“已完成”

## 设计类智能体的关键数据模型

建议优先沉淀五类核心对象。

### 1. DesignElement

至少包含：

- `elementId`
- `layerId`
- `kind`
- `bounds`
- `styleHints`
- `parentIds`
- `clippingInfo`
- `moduleId`
- `screenId`
- `semanticRole`
- `evidence`
- `derivedFrom`
- `evidenceStrength`

### 2. DesignRelation

至少表达：

- 对齐
- 间距
- 包含
- 附着
- 重叠
- 主次
- 同组关系

### 3. DesignModule

表达一个局部设计模块，比如：

- 标题模块
- 对比模块
- 卖点模块
- 产品图片区
- 标签区

### 4. DesignScreen

适用于详情页、分屏海报、长图等场景。

核心作用是提供：

- 屏边界
- 屏职责
- 屏内模块集合
- 屏内风险与验收项

### 5. DesignScene

这是全局对象，用于收口：

- 当前文档
- 当前参考输入
- 所有元素、关系、模块、屏
- 当前用户目标
- 当前规划结果

## 推荐的工作流

### 工作流 A：当前文档设计优化

适用于：

- 详情页改版
- 主图优化
- 局部元素替换

推荐步骤：

1. 读取当前文档结构
2. 建立 scene
3. 理解用户目标
4. 生成 plan
5. 校验约束
6. 执行
7. 审计结果
8. 输出复核结论

### 工作流 B：参考图复刻 / 迁移

适用于：

- 给一张参考图，在当前模板或空白文档里复刻
- 把参考图结构迁移到现有 PSD

推荐步骤：

1. 解析参考图
2. 建立最小中间表示
3. 推导 blueprint / layout plan
4. 匹配当前模板或占位结构
5. 生成 placement / copy / style 策略
6. 落地为可编辑骨架
7. 输出 QA 报告

### 工作流 C：多方案设计与评审

适用于：

- 高主观性设计任务
- 需要创意空间而不是单一路径执行

推荐步骤：

1. 先产出 2 到 3 个方案
2. 对方案做结构与风险评审
3. 选一个最优方案执行
4. 保留未选方案，便于继续迭代

结论：

**设计类智能体要想效果更好，通常不能长期停留在“单一路径一把梭”的执行模式。**

## 多智能体在设计任务里的合理用法

多智能体不是为了“显得高级”，而是为了把职责拆开。

推荐的最小角色集：

### 1. Intent Planner

负责：

- 理解用户目标
- 提炼约束
- 决定是解释、规划、执行还是复核

### 2. Scene Analyst

负责：

- 理解当前 PSD / 画布 / 参考图
- 输出 element / relation / module / screen 上下文

### 3. Design Strategist

负责：

- 产出设计方案
- 输出图文策略和动作计划

### 4. Executor

负责：

- 调 Photoshop / UXP / MCP 工具
- 将计划转换成实际动作

### 5. Critic

负责：

- 检查主次关系
- 检查版式风险
- 检查文案与图像协同
- 输出修改建议

最关键的一点不是角色数量，而是：

**不要让同一个 Agent 同时负责“执行”和“自我打分”。**

设计任务高度主观，单体 Agent 自评往往会偏乐观，因此评审角色独立通常更可靠。

## 设计类智能体的工具边界

一个长期可维护的设计系统，必须把下面几层分清：

1. 用户能力
2. workflow skill
3. operation wrapper
4. debug tool
5. system-only orchestration

建议原则：

- 用户聊天默认只能进入 user-facing workflow
- debug 能力不能直接暴露给普通任务
- system-only orchestration 不能当成产品功能展示
- 工具描述、调用策略、执行逻辑最好拆成独立真相源

否则很容易出现：

- 正常请求误入 debug 链路
- 薄封装操作被误当成“完整设计能力”
- tool schema、policy、executor 三处各写一份

## 设计类智能体的验证标准

设计任务很难只靠单一指标验收，建议至少分四层：

### 1. 代码与构建验证

- 类型通过
- 构建通过
- 工具接口一致

### 2. 结构验证

- 结果是否仍然可编辑
- 元素结构是否完整
- 模块关系是否合理

### 3. 执行验证

- 目标元素是否放对
- clipping / anchor / bounds 是否正确
- 不同占位是否误共用锚点

### 4. 设计质量验证

- 层级是否清晰
- 信息组织是否更好
- 图文是否协同
- 是否存在明显机械感

在工程上，建议把“设计质量验证”拆成两层：

- 启发式 QA
- 人工复核 / benchmark case

原因很简单：

- 纯自动评分在设计任务上还不够可靠
- 但完全没有结构化 QA，又无法持续迭代

## 当前项目对设计类智能体的已知可复用经验

以下内容已在仓库中形成较明确结论。

### 1. 设计理解内核比继续堆业务功能更重要

当前项目已经证明：

- 继续堆详情页功能
- 继续堆主图功能
- 继续堆 SKU 功能

并不会自然演化成“真正更聪明的设计智能体”。

更关键的是先建立：

- scene core
- 统一元素模型
- 统一关系模型
- 可解释计划
- 审计闭环

### 2. Photoshop 的结构化信息比纯截图更值钱

对当前项目而言，更高价值的输入不是“屏幕像素本身”，而是：

- layer hierarchy
- bounds
- clipping
- 文本属性
- 模块结构

截图感知仍然重要，但它更适合作为补充证据，而不是唯一真相源。

### 3. executor 不应该继续承载设计策略

当前多个文档都指向同一结论：

- executor 负责动作序列
- skill / planner 负责设计策略

如果长期把策略继续堆到 executor 中，系统会越来越重，也越来越难校验。

### 4. 参考图任务必须先做中间表示

“参考图 -> 直接执行”通常不稳定。

更合理的方式是：

1. 先解析参考图
2. 形成最小中间表示
3. 再推导 blueprint、match、autofill、apply、qa

### 5. 设计任务需要单独的审计面

仅有工具日志不够。

对设计任务来说，必须能检查：

- 计划放置位置
- 实际放置位置
- target bounds
- live placement
- copy layout
- per-screen 结构风险

这决定了系统能否真正进入“可复盘、可回归”的状态。

## 当前项目的真实基础

基于现有文档与代码入口，当前项目已经具备以下基础：

### 已有基础

- 统一主循环入口已经开始由 `DesignAgentEngine` 承接
- 已存在 `scene-analyst / design-strategist / executor / critic` 多角色基础设施
- 已存在 `detail-page-design`、`main-image-design`、`layout-replication` 等 workflow skill
- 已存在参考图复刻相关的最小表示、match、autofill、apply、qa 模块
- 已存在 detail-page 的 placement audit、copy layout audit、visual segmentation 等结构化能力
- 已存在 MCP host 和 UXP 原子工具链
- 已存在项目记忆真相源，能承载长期推进状态

### 当前缺口

- 统一 `DesignScene` schema 仍未完全收口
- detail-page 和 main-image 还没有完全建立在同一 scene core 上
- 参考图到设计动作规划仍在持续拆分中
- 设计评审循环还不够稳定
- benchmark 真实案例仍然不足
- 自动 QA 与人工主观评价之间的一致性仍待验证

## 外部方法论的可吸收结论

结合外部常见 agentic workflow 经验，可以吸收以下通用原则：

### 1. 记忆不是附属品，而是生产系统的一部分

生产级智能体通常至少区分：

- 短期上下文
- 长期知识
- 过程痕迹 / 经验

对设计类智能体来说，还应额外强调：

- 项目阶段真相源
- benchmark case
- 已验证 recipe

### 2. 规划、执行、评审最好适度解耦

通用 agentic engineering 的一个稳定结论是：

- 让同一个体同时规划、执行、评审，质量通常不稳定

对设计任务尤其如此，因为设计质量本身带主观性。

### 3. 多模态感知要服务于结构化决策

图片理解不是终点。

更重要的是把多模态输入变成可推理对象，再进入规划和执行。

### 4. 评估必须从“能运行”升级到“能验收”

设计类智能体的成败，不该只看：

- 调没调成工具
- 有没有报错

更应看：

- 结果是否可编辑
- 结果是否接近预期结构
- 结果是否通过人工复核

## 常见反模式

下面这些路线，短期可能快，长期通常会把系统做乱。

### 1. 把业务分支不断堆进 executor

问题：

- 策略和动作混在一起
- 无法复用
- 无法解释
- 无法稳定评审

### 2. 只做截图感知，不用 PSD 结构信息

问题：

- 丢失高价值语义
- 放置、裁切、层级更容易猜错

### 3. 只有执行，没有计划

问题：

- 用户很难理解系统准备做什么
- 调试时没有中间产物
- 失败时只能回看日志

### 4. 只有结果，没有 QA

问题：

- 看起来做完了，但没有证据证明做对了
- 后续无法做 benchmark 回归

### 5. 把“兜底成功”当成“能力成熟”

问题：

- 会持续掩盖真正缺口
- 会让状态文档失真

## 对当前项目更合适的推进顺序

### Phase 1：统一 scene core

先收口：

- element
- relation
- module
- screen
- scene

### Phase 2：让主图和详情页真正依赖同一内核

避免继续各自解释 PSD。

### Phase 3：把参考图能力推进到 plan-first

优先做：

- 参考图解析
- 中间表示
- blueprint / match / apply / qa

而不是一上来追求“任意风格高保真复刻”。

### Phase 4：加入稳定的 critic / review 闭环

让系统能对候选方案进行比较、复核和收敛。

### Phase 5：积累 benchmark 与 recipe

让系统从“每次现想”逐步过渡到“有验证过的经验库”。

## 适合作为后续文档索引的主题

如果后面继续扩展知识库，建议按这些主题拆文档：

1. 统一 scene schema
2. 参考图最小中间表示
3. placement policy
4. design review / critic 规则
5. benchmark case 录入规范
6. design recipe 库
7. skill 与 MCP 边界
8. 多智能体协作协议

## 结论

对 `DesignEcho-Agent` 这类 Photoshop 设计系统来说，真正正确的方向不是：

- 把它做成普通聊天机器人
- 把它做成普通 GUI 自动化器
- 把它做成只会一键出图的生成器

更合理的方向是：

**Photoshop 结构感知 + 设计场景建模 + 可解释规划 + 确定性执行 + 审计复核 + 项目记忆与 benchmark**

只有这几层一起成立，系统才会从“能跑一些设计功能”，逐步推进到“真正具备设计理解能力的设计智能体”。

## 深入版能力地图

前面的内容给出的是总框架。若要把设计类智能体真正做成工程系统，还需要把能力再拆成八个正交维度。

### 1. Perception：感知

负责把输入世界转成机器能处理的事实。

输入可能包括：

- 用户自然语言
- 当前 PSD / PSB 文档
- 选中图层
- 参考图
- 模板
- 素材库
- 执行痕迹

设计任务里的感知不只是一张图的视觉理解，还包括：

- 文档级几何结构
- 图层类型
- 组层级
- clipping 关系
- 文本内容与样式
- 视觉分块
- 当前选择状态

感知层的专业标准是：

- 先返回事实，再返回推断
- 先返回结构，再返回摘要
- 每条推断都能追溯到事实输入

### 2. Representation：表示

表示层是设计类智能体和普通工作流系统的分水岭。

如果没有稳定表示层，系统会出现三个问题：

1. 每个功能都各自解释同一份 PSD
2. 一旦换场景，旧逻辑几乎不能复用
3. 模型输出和执行器输入长期耦合

表示层至少要承载：

- 元素
- 关系
- 模块
- 屏
- 场景
- 规划
- 评估

专业系统里的表示层，原则上要满足：

- 面向执行稳定，而不是面向 prompt 临时方便
- 面向跨模块复用，而不是只服务单一 skill
- 面向版本演化，而不是一次性拍脑袋定死

### 3. Planning：规划

规划层负责把“意图”翻译成“计划”。

一个专业的设计 Agent 计划，不是泛泛而谈的描述，而是可以被执行、被质疑、被审计的结构化对象。

好的计划应同时包含四类信息：

1. Objective
   - 到底要达成什么视觉或业务目标
2. Strategy
   - 用什么设计思路达成
3. Operations
   - 需要执行哪些确定性动作
4. Validation
   - 如何判断这一步算成功

### 4. Execution：执行

执行层只做动作，不做审美判断。

在设计系统里，这层经常被做坏，原因是开发时很容易为了“先跑通”把策略偷偷塞到执行器里。

长期正确做法是：

- 规划对象决定做什么
- 执行器决定动作顺序
- 工具只实现动作

### 5. Evaluation：评估

设计系统里的评估至少有两套：

1. Runtime evaluation
   - 当前执行是否成功
   - 是否存在几何/结构风险
2. Design evaluation
   - 最终结果是否在设计上成立

这两者必须分开。

“执行成功”不等于“设计正确”。

### 6. Memory：记忆

记忆层不是为了“让 Agent 看起来像记住了你”，而是为了降低重复分析、重复犯错和重复走弯路。

对设计系统尤其重要的记忆包括：

- 已验证的版式 recipe
- benchmark case
- 容易出错的模板结构
- 常见失败模式与诊断路径

### 7. Tooling：工具化

专业系统不是“有很多工具”，而是“工具边界清楚、可调试、可约束、可演化”。

要区分：

- user-facing workflow
- read-only inspect tools
- write actions
- debug tools
- system-only orchestration

### 8. Governance：治理

设计类智能体一旦进入真实生产场景，必须补治理层。

治理不等于合规文档，而是最少要做到：

- 不破坏原稿
- 能回放关键步骤
- 能分清已核实和未核实
- 能知道失败是意图错、计划错、工具错还是运行时错

## 专业系统的数据契约

这一节给出更偏工程化的数据契约草案。它不是要求当前仓库一次性全部实现，而是给后续统一 schema 一个更专业的目标模板。

### 1. DesignElement 契约

建议字段分为六组。

#### A. 身份字段

- `elementId`
- `layerId`
- `sourceDocumentId`
- `sourcePath`
- `revision`

#### B. 几何字段

- `bounds`
- `rotation`
- `opacity`
- `visible`
- `zIndex`
- `transform`

#### C. 语义字段

- `kind`
- `semanticRole`
- `contentType`
- `importance`
- `editable`

#### D. 风格字段

- `fill`
- `stroke`
- `font`
- `fontSize`
- `fontWeight`
- `cornerRadius`
- `shadowHints`
- `styleHints`

#### E. 结构字段

- `parentIds`
- `childIds`
- `clippingBaseId`
- `maskedBy`
- `moduleId`
- `screenId`

#### F. 证据字段

- `evidence`
- `derivedFrom`
- `evidenceStrength`

其中最容易被忽略但很重要的是：

- `evidence`
- `derivedFrom`

因为后续很多判断都要追溯“这个结论是来自真实图层信息，还是来自视觉推断”。

### 2. DesignRelation 契约

推荐不要只存“元素 A 和 B 有关系”，而要把关系标准化。

至少包括：

- `relationId`
- `type`
- `fromElementId`
- `toElementId`
- `strength`
- `direction`
- `evidence`
- `evidenceStrength`

`type` 建议从有限集合开始：

- `aligned-left`
- `aligned-center-x`
- `aligned-right`
- `aligned-top`
- `aligned-center-y`
- `aligned-bottom`
- `spaced-horizontal`
- `spaced-vertical`
- `contained-by`
- `attached-to`
- `overlaps`
- `dominates`
- `belongs-to-module`

### 3. DesignModule 契约

模块不是“一个组”那么简单。

建议同时表达：

- `moduleId`
- `moduleType`
- `purpose`
- `elementIds`
- `primaryElementIds`
- `bounds`
- `readingOrder`
- `visualWeight`
- `screenId`
- `constraints`

`purpose` 很重要，因为它能把“看起来像一组元素”升级成“承担某种沟通职责的设计模块”。

例如：

- 卖点说明
- 产品展示
- 参数对比
- CTA
- 信任背书

### 4. DesignScreen 契约

适用于详情页、长图、分屏视觉设计。

建议字段：

- `screenId`
- `screenIndex`
- `bounds`
- `moduleIds`
- `theme`
- `purpose`
- `entryFocus`
- `exitFocus`
- `risks`

`entryFocus` 和 `exitFocus` 是专业设计系统里非常有价值但常被忽略的字段。

它们表达的是：

- 用户先看到什么
- 这一屏希望用户最后记住什么

### 5. DesignScene 契约

建议 `DesignScene` 作为全局快照对象。

可包含：

- `sceneId`
- `document`
- `referenceInputs`
- `elements`
- `relations`
- `modules`
- `screens`
- `selection`
- `taskIntent`
- `planContext`
- `artifacts`
- `warnings`

### 6. DesignPlan 契约

专业设计计划建议至少有以下字段：

- `planId`
- `planType`
- `goal`
- `scope`
- `constraints`
- `assumptions`
- `operations`
- `assetStrategy`
- `copyStrategy`
- `placementStrategy`
- `validationChecks`
- `riskItems`
- `rollbackPolicy`

这比只返回“我会先分析、再执行”专业得多。

### 7. AuditReport 契约

审计结果不应只是一个总分。

建议包含：

- `auditId`
- `targetPlanId`
- `status`
- `summary`
- `findings`
- `metrics`
- `evidenceArtifacts`
- `manualReviewRequired`

`findings` 建议是结构化列表，每条至少有：

- `severity`
- `category`
- `message`
- `elementIds`
- `screenIds`
- `suggestedActions`

## 设计类智能体的模型分工

一个专业系统通常不会让单一模型承担所有子任务。

更合理的方式是按子任务切模型职责。

### 1. 感知模型

适合处理：

- 参考图解析
- 视觉模块识别
- 文档截图辅助理解
- 主体位置和裁切风险辅助判断

要求：

- 多模态
- 稳定输出结构化结果
- 对几何关系相对敏感

### 2. 推理模型

适合处理：

- 意图理解
- 设计计划生成
- 风险解释
- 多方案比较

要求：

- 强约束理解能力
- 稳定的结构化输出
- 较好的长上下文能力

### 3. 评审模型

适合处理：

- 方案比较
- 审美风险提醒
- 对计划的质疑和修正建议

要求：

- 相对“挑剔”
- 不轻易给高分
- 能给出具体而非空泛的批评

### 4. 执行层不应再依赖模型做临场决策

这是非常关键的工程原则。

一旦工具调用前还在靠模型“最后拍板”，系统会出现：

- 结果不可重复
- 失败不可追溯
- 很难建立 benchmark

## Prompt 与结构化输出策略

设计类智能体的 prompt 设计，重点不是“写得多像人”，而是“能稳定产出可消费结构”。

### 1. Prompt 应分层

至少区分：

- intent prompt
- scene analysis prompt
- reference parse prompt
- planning prompt
- critic prompt
- audit prompt

不建议一个巨型 prompt 试图包办全部工作。

### 2. 输出优先 JSON，而不是散文

设计任务尤其需要：

- 明确字段
- 可选字段
- 枚举值
- 缺失字段策略

### 3. Prompt 要显式区分事实、推断、建议

这是降低幻觉和降低错误传播的关键。

推荐每次结构化输出都区分三层：

- `facts`
- `inferences`
- `recommendations`

### 4. 对主观设计判断要显式标注证据强弱

例如：

- 某块区域推断为 CTA：`evidenceStrength = "weak"`，证据来自视觉推断，需人工复核
- 某元素推断为装饰性背景：`evidenceStrength = "medium"`，证据来自图层命名与视觉位置

当证据不足时，规划层应采取保守策略，而不是假装确定。

## 评估框架：从“能跑”到“专业可验收”

如果要把设计类智能体做专业，评估体系必须是多维的。

### 1. 四层评估面

#### A. Representation Accuracy

评估：

- 元素识别是否正确
- 关系识别是否合理
- 模块边界是否稳定

#### B. Planning Quality

评估：

- 计划是否完整
- 是否考虑约束
- 是否区分复用 / 新建 / 替换 / 调整
- 是否有清晰验证点

#### C. Execution Fidelity

评估：

- 实际动作是否按计划发生
- bounds / anchor / clipping 是否正确
- 是否引入破坏性副作用

#### D. Design Outcome Quality

评估：

- 视觉层级
- 信息组织
- 文图协同
- 编辑可持续性

### 2. 推荐指标

#### 结构指标

- 元素命中率
- 模块命中率
- 关系命中率
- 错配率

#### 几何指标

- bounds 偏移
- 尺寸误差
- 对齐误差
- 重叠风险

#### 执行指标

- 计划步骤执行率
- 工具错误率
- 回退触发率
- 非预期副作用率

#### 设计指标

- 层级清晰度
- 构图稳定度
- 说服力
- 机械感
- 人工复核通过率

### 3. 评分建议

建议不要只给一个总分，而是采用分维度评分卡。

例如：

- `structureScore`
- `placementScore`
- `copyHierarchyScore`
- `editabilityScore`
- `overallReview`

其中 `overallReview` 只能是结果摘要，不能替代分项指标。

## Benchmark 体系应该怎么建

设计类智能体没有 benchmark，就几乎无法专业推进。

### 1. Benchmark case 最少要记录什么

- `caseId`
- `taskType`
- `inputAssets`
- `referenceImage`
- `templateState`
- `expectedConstraints`
- `manualRubric`
- `outputArtifacts`
- `scores`
- `manualVerified`

### 2. Benchmark 不只是“存几张图”

更重要的是存以下内容：

- 输入事实
- 期望行为
- 不允许行为
- 人工验收口径
- 失败样例

### 3. Benchmark 应覆盖三类案例

#### A. Happy path

最标准、最理想的模板与素材。

#### B. Edge cases

例如：

- 模板结构不完整
- clipping 缺失
- 文本过长
- 素材尺寸异常

#### C. Adversarial cases

例如：

- 相似模块混淆
- 锚点极易误判
- 多占位共享同名层

## Observability：观测、追踪与调试

设计 Agent 一定要有比普通日志更强的观测体系。

### 1. 最少应记录的 trace

- 用户输入
- intent 输出
- plan 输出
- 关键工具调用
- 执行前状态
- 执行后状态
- audit 结果
- 最终结论

### 2. 最少应保留的 artifact

- before 图
- after 图
- overlay 图
- trace json
- tool result json
- error payload

### 3. 最少应有的调试入口

- active context
- recent task trace
- detail placement audit
- text replacement audit
- selected design context
- benchmark replay

这正是当前仓库 MCP 工具面值得继续增强的方向。

## 安全与可逆性

设计系统和普通自动化系统不同，它处理的是用户真实设计资产，因此必须优先考虑可逆性。

### 1. 非破坏原则

优先采用：

- 新建而不是覆盖
- 复制而不是就地破坏
- 可回退变换而不是不可逆修改

### 2. 原稿保护原则

必须能回答：

- 改了哪些图层
- 新建了哪些图层
- 隐藏了哪些图层
- 哪一步可以回退

### 3. 风险显式化原则

当系统不确定时，不应假装确定。

应明确输出：

- 哪些地方不确定
- 为什么不确定
- 建议人工确认什么

## 能力成熟度模型

为了避免“做了很多功能但不知道到了哪一层”，建议给设计类智能体定义成熟度分级。

### Level 0：Tool Wrapper

特征：

- 只是会调用 Photoshop 工具
- 没有统一意图理解
- 没有设计表示层

### Level 1：Workflow Agent

特征：

- 已有若干业务流程
- 能把输入路由到执行器
- 但策略大量写死在业务链中

### Level 2：Scene-Aware Agent

特征：

- 已能读取元素、模块、屏等结构化上下文
- 有统一 scene 入口
- 多业务开始复用同一内核

### Level 3：Plan-Driven Design Agent

特征：

- 设计动作先产出 plan
- executor 只消费 plan
- 有独立的 validation 和 audit

### Level 4：Reviewable Design Agent

特征：

- 支持多方案
- 有 critic / review 回路
- 有 benchmark 与评分卡

### Level 5：Learning Design System

特征：

- 已有稳定 recipe
- 已有案例库和经验沉淀
- 新任务可以复用既有知识，而不是每次从零开始

就当前仓库看，更接近：

- 主体处于 `Level 1` 到 `Level 2` 之间
- 某些 detail-page / reference replication 能力局部接近 `Level 3`

这也是为什么它已经明显超出“工具脚本”，但还不能被描述成“成熟设计智能体”。

## 与当前仓库的模块映射

下面给出更工程化的映射，帮助后续把知识落到实际代码收口。

### 1. Agent 主循环

当前主要入口：

- `src/renderer/services/design-agent/engine.ts`
- `src/renderer/services/agent-orchestration/orchestrator.ts`
- `src/renderer/services/agent-orchestration/routing.ts`
- `src/renderer/services/agent-orchestration/task-classifier.ts`

建议目标：

- `engine.ts` 成为唯一真实回合入口
- `orchestrator.ts` 逐步收敛为兼容包装
- `routing.ts` 从关键字主导转为元数据和模型共同驱动

### 2. Design Team / Multi-Agent

当前基础设施：

- `src/renderer/services/design-teams/registry.ts`
- `src/renderer/services/design-teams/coordinator.ts`
- `src/renderer/services/design-teams/task.ts`
- `src/shared/types/design-team.types.ts`

建议目标：

- 让多智能体真正绑定 scene、plan、audit，而不是只做文本委托

### 3. Skill 层

当前主线：

- `src/shared/skills/skill-declarations.ts`
- `src/renderer/services/design-skills/detail-page-design.skill.ts`
- `src/renderer/services/design-skills/main-image-design.skill.ts`
- `src/renderer/services/skill-executors/*.ts`

建议目标：

- skill 声明承载更完整元数据
- skill 只定义设计策略和约束
- executor 不再偷偷承接策略职责

### 4. Scene Core 候选

当前已经具备雏形的共享模块：

- `src/shared/design-selected-element-context.ts`
- `src/shared/design-selected-module-context.ts`
- `src/shared/design-selected-design-context.ts`
- `src/shared/detail-page-screen-plan.ts`
- `src/shared/detail-page-visual-segmentation.ts`
- `src/shared/detail-page-live-placement.ts`
- `src/shared/detail-page-copy-layout-audit.ts`

建议目标：

- 从“detail-page 相关共享模块”升级成“统一 scene core”

### 5. Reference Replication

当前主线模块：

- `src/shared/reference-replication.ts`
- `src/shared/reference-replication-blueprint.ts`
- `src/shared/reference-replication-placement.ts`
- `src/renderer/services/skill-executors/layout-replication.executor.ts`
- `src/renderer/services/skill-executors/layout-replication-match.ts`
- `src/renderer/services/skill-executors/layout-replication-autofill.ts`
- `src/renderer/services/skill-executors/layout-replication-apply.ts`
- `src/renderer/services/skill-executors/layout-replication-qa.ts`

建议目标：

- 继续把表示、策略、执行、QA 四层清晰拆开

### 6. MCP / Tooling

当前主线：

- `src/main/services/mcp-host-service.ts`
- `src/renderer/services/tool-executor.service.ts`
- `src/renderer/services/agent-runtime/tool-schemas.ts`

建议目标：

- 统一 tool registry
- schema 不再双写
- MCP tools 更偏“事实暴露”和“调试可观测”

## 更专业的近期研发顺序

如果按专业工程方式推进，推荐把近期工作拆成下面七个包，而不是继续零散修。

### 包 1：Schema 收口

目标：

- 正式定义 `DesignElement / Relation / Module / Screen / Scene`

产出：

- 类型文件
- 版本字段
- 最小序列化示例

### 包 2：Selected Context 正式化

目标：

- 让 selected context 变成所有设计 skill 的统一输入

产出：

- 标准返回结构
- 证据字段
- 邻域关系字段

### 包 3：Reference Plan-First

目标：

- 从“看图 + 执行”推进成“看图 + 计划 + 执行”

产出：

- plan schema
- reference compare schema
- action proposal schema

### 包 4：Audit 标准化

目标：

- 统一不同链路的 audit 输出结构

产出：

- `AuditReport`
- finding categories
- severity 标准

### 包 5：Benchmark 与评分卡

目标：

- 让所有设计优化从“感觉更好”进入“可比较”

产出：

- case 模板
- rubric 模板
- 人工复核模板

### 包 6：Tool Registry 收口

目标：

- tool definition、schema、policy、MCP exposure 一套真相源

### 包 7：Critic 闭环

目标：

- 把评审从“日志后看”推进成“运行时一等能力”

产出：

- critic prompt
- review rubric
- plan revision interface

## 适合写进后续专题文档的专业章节

如果继续扩展知识库，建议把后续文档拆得更专业，而不是继续堆在一篇总文档里。

推荐专题如下：

1. `scene-core-schema.md`
2. `design-plan-contract.md`
3. `audit-report-contract.md`
4. `benchmark-rubric.md`
5. `critic-loop-design.md`
6. `mcp-observability-spec.md`
7. `reference-action-planning.md`
8. `design-recipe-registry.md`

## 最终判断

如果用更专业的语言来描述，设计类智能体的本质不是“多模态 + 工具调用”这么简单。

它至少是下面这套系统的组合：

1. 一个能感知设计场景的感知系统
2. 一个能稳定表达设计对象的表示系统
3. 一个能输出结构化动作计划的规划系统
4. 一个只做确定性落地的执行系统
5. 一个能判断结构风险和设计风险的评估系统
6. 一个能沉淀案例、recipe、benchmark 和项目真相源的记忆系统
7. 一个能提供可观测、可调试、可治理边界的工程系统

对当前 `DesignEcho-Agent` 来说，最重要的结论不是“还差多少功能”，而是：

**它接下来最应该补的是系统级能力，而不是继续堆场景级分支。**

更具体地说，就是优先补：

- 统一 scene schema
- 统一 plan schema
- 统一 audit schema
- benchmark 与评分卡
- tool / MCP 真相源
- critic / review 闭环

这六项一旦站稳，后面的详情页、主图、参考图迁移、文案优化，才会从“越来越重的专项功能”变成“共享内核上的能力实例”。
