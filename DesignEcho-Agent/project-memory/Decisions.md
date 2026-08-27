# Decisions

本文件只保留仍约束当前实现的关键裁决。更早的 D-001～D-059 由 Git 历史保留。

## D-085 动作事实、交互等待、产物完成、设计质量与任务终态必须分轴结算

- 状态：已采用；代码、定向回归与本提交 50 项整仓核心验证已完成，固定 Fixture 实机验收继续以 `CurrentTask.md` 为准。
- 单次 Tool / Skill 尝试是不可改写的历史事实，但不是任务终态。`success:false` 必须先按结构化 disposition 区分真实失败、可恢复失败、workflow handoff、等待用户、取消和未知副作用；只有终态投影可以判断整个 TaskRun 是否失败。
- Task Completion 只消费当前尚未闭合的结构化义务与同目标 operation ledger。相同 Tool、参数和文档上的后续成功可以结清较早失败；不同参数、不同目标、未知写状态和仍缺收据的失败继续保留。旧 revision 的验收不能推翻已经在更新 revision 上完成并读回的结果；后续无副作用的预算拒绝也不能撤销同 revision 已取得的质量闭合证据。
- `artifactStatus` 只表达必需产物、目标、写后读回和交付收据；DesignVerdict 另行表达专业质量。只有携带合格 blocker kind 与 proofRef 的确定性质量问题可以阻断交付；普通审美 finding 保留为改进建议，不能把 `artifact_completed` 改写成“结果需要复核”。
- 等待确认和 workflow handoff 是控制流，不是失败；Task Card 是工作笔记，不是第二 Completion owner；模型最终正文和总结 Provider 只是展示层，不得从措辞反推完成，也不得因总结超时、空回复或半句输出推翻已闭合的结构化结果。
- 模型准备结束但仍缺当前版本读回、正确目标或显式文件交付时，现有同一 Agent 实例在保留完整 Tool Log 的情况下接收缺失事实并继续收尾。Harness 不指定截图、保存 Tool 或设计修法；Agent 自行选能力。只有真正的视觉质量修订才进入 Reflexion，等待用户、预算耗尽、未知副作用或 writer 冲突不得被恢复逻辑升级成写权限。
- 自然终稿先进入“准备闭合”，再进入不可逆提交：准备阶段只评估 Completion、同版本图层结构 / 画面证据与 Delivery 投影，不 finalize Session / Artifact、不 release writer，也不提前推进 E2。只有确定不需要继续收尾时，commit 路径才附加 E2 trace 并发布结果。
- 终态闭合已开始后，任何 `no_progress` / preflight / budget / cancel / waiting / writer conflict / unknown write / needs reobserve / stage mismatch 早退都必须在同一 Agent 实例结算并清除 outer Reflexion handoff；不得通过外层新建 Agent 丢掉原 Tool Log、恢复次数与已知失败事实。同一 gap fingerprint 重复或达到有界次数时诚实停止，但对用户只投影具体对象与缺失事实，不再回落到通用“结果需要复核”。

### 正面经验

1. 把 attempt、action disposition、control flow、artifact completion、quality verdict 和 task outcome 分开后，可以同时做到“不隐藏真实失败”和“不让历史失败污染最终版本”；单一 `success` 布尔无法表达这些语义。
2. 使用同一个 canonical operation ledger，并以 Tool 参数、Host document /history、mutation 与 delivery receipt 精确关联，可以让 Skill 内嵌原子调用和普通 Agent Tool 共享完成口径，不需要为 SKU、主图或详情页各造一套补丁。
3. “最新可验证版本”优先于“最后一条日志”。后来的真实写入会使旧观察失效，但同版本的无副作用拒绝、诊断或预算提示不能撤销已经成功的读回。
4. 产物轴与审美轴拆开后，Agent 可以继续消费具体审美建议做有界改进，同时已保存、已导出、已读回的事实不会被笼统 quality gate 抹掉；软 finding 对用户投影为可选优化，不再变成待复核终态。
5. 用户展示按精确 `toolCallId` 收束过程行：Debug completion 可以关闭对应“处理中”步骤，但不生成红色失败；真正任务终态只来自结构化 Completion。这样并行同名调用、workflow handoff 和重规划不会留下悬空红条。
6. 最终正文生成失败时使用结构化中性摘要，比“回复未完整，继续补全”或根据模型措辞猜状态更可靠；失败诊断仍进入 Run Record，不冒充用户结果。
7. 同实例收尾只反馈“缺什么事实”，不反馈“必须调用哪个 Tool”。这既提高自动闭合率，又保持 Agent 对方法和下一步的作者权。
8. 最终事实只有一份，但可以有多个过程投影：Task Card、Action Plan、legacy public-plan 与 Skill 前置视觉提示都必须服从 canonical Completion。完成后尚未同步的工作笔记可以被压制，但等待、取消、真实失败和未知写状态必须继续显示。
9. Skill 前置刷新改变了实际执行参数后，结果只能从 executor 真正消费的最终参数重建上下文。执行前的 stale context 不能附回成功结果；`assetPath` / `sourcePath` / `sources[].filePath` 等当前调用的显式来源必须被识别，但它们只证明“有来源素材”，不伪造“已完成视觉理解”。
10. 精确 terminal closure outcome 必须同时服务用户与调试：用户只看自然的缺口名称与停止原因；Run Record 只保存 gap kind、reason、证据类别、数量和 document / history 锚点的有界 digest。两边都不保存 public prose、绝对路径、fingerprint、manifest token 或原始缺失项。这样 `debug:runs` 能看到真正 owner，普通对话不会暴露工程术语。

### 负面教训与禁止反例

1. **把 `success:false` 直接变成任务失败**：等待确认、workflow handoff 和可恢复动作会被 UI 提前终态化，随后 Agent 即使成功也留下“未完成”。必须先解析 disposition，再由 Task Completion 结算。
2. **最后一次尝试获胜**：最后一条如果只是重复观察的预算拒绝，会抹掉此前同 revision 的成功读回。正确规则是最新有效状态变化获胜，不是数组最后一项获胜。
3. **历史失败永久计债**：早期失败后同目标已成功，仍按累计失败数阻断最终状态，会诱发重复制作。历史计数保留诊断，完成阻断只看尚未被可信后续证据结清的义务。
4. **旧 revision 验收污染新版本**：旧画面的待复核或失败不能自动迁移到新 revision；新版本必须有自己的观察，而旧结论只保留为历史。
5. **质量状态覆盖产物状态**：把 scorecard 的 `needs_review` 直接写成 artifact incomplete，会让一个审美建议否定真实 PSD /导出图和交付收据。两条轴必须独立，只有 qualified blocker 才阻断。
6. **Task Card、助手正文或 warning 成为第二完成判定器**：卡片没同步、总结没生成、正文写了“还需检查”都不能推翻 operation /receipt；反过来，正文说“已完成”也不能补造收据。
7. **把历史 handoff 伪装成当前失败 Tool Log**：人工合成 `success:false` 复入记录会制造并不存在的新失败，并污染当前 generation。恢复身份应通过结构化 continuation /session 传递。
8. **通用“结果需要复核”兜底**：它混淆缺质量结论、软性改进、真实产物缺口与未知写状态，还把系统未闭合的责任转给用户。必须分别给出精确事实；可自动补齐的在同实例内补齐，软建议不阻断，真实危险才停止。
9. **过程开始公开、Debug 完成被过滤**：只显示 `tool_started`，却丢掉同一 `toolCallId` 的 Debug completion，会留下永久红色“未完成”。过滤内容不能破坏过程生命周期。
10. **重启应用作为验收前置动作**：`pending=0` 不证明 Agent、Provider 或用户 Photoshop 工作空闲；有未保存文档时重启可能中断用户任务。先只读核对 Runtime 与文档，再决定是否需要重启。
11. **只在自然 final response 上加同实例守卫**：收尾后的 Tool 若从 no-progress / preflight 等早退，旧 handoff 仍会逃到外层新建 Agent。“同实例”必须是 terminal-recovery mode 的整个生命周期不变量，不是某一个返回点的补丁。
12. **prepare 阶段提前写 E2 trace**：即使还没 finalize Artifact 或 release writer，提前推进 Stage 也会让后续继续运行面对一个伪终态 Session。审计与提交必须分离，不能只拆出一部分副作用。
13. **把可恢复证据写死为 `fresh_visual`**：Profile 已用 runtime repair metadata 声明 `fresh_structure` 与 `fresh_visual` 都可回到 R5 补证，核心若再按证据名称分支，会重新产生品类式硬编码。应消费既有声明，不在 Agent 内复制方法。
14. **先追加 generic needs-review，再追加精确原因**：这会让用户同时看到“质量仍待复核”与真实缺口，表面有更多信息，实际仍有两份终态。Completion consistency 必须直接消费 typed outcome 作为唯一精确说明，不能在事后用字符串删词。
15. **只修当前传入源字段**：SKU 常用 `sources[].filePath`，其他调用可能用 `sourcePath` / `sourcePaths`。应归一化“明确来源”语义并用真实 Skill 输入形状回归，不要每出现一个字段就在 UI 再补一层压制。

## D-084 交互 owner 与外部能力采用 Agent / Harness Kernel / Skill Package / Tool-Capability Provider + Host 四层边界

- 状态：已采用；本裁决定义当前实现不变量，具体代码接线、构建和真机状态继续以当前代码、`CurrentTask.md` 与 `Status.md` 为准，不能由文档补造成已验证完成。
- Agent / Model 拥有目标理解、Task Profile / Skill 选择、设计取舍、开放任务中的可选澄清和失败后的重规划；已选 staged Skill 可以按确定性生产契约要求必要的领域确认点，Agent 不能绕过，但候选内容和设计判断仍归 Agent /用户。Harness Kernel 只拥有同一 TaskRun、Context、Capability Resolution、跨调用调度、target /revision 绑定、授权 /preflight、reconciliation、验真、完成判定、幂等、预算与停机，不从品类关键词、文件名、旧 route hint 或 `routing recommendation` 补造 owner。推荐只是模型可以忽略的候选，不能抢占 Skill、交互卡、Capability 或恢复路径。
- Skill Package 拥有领域方法、确定性生产规格、卡片 schema、候选语义、校验、提交消费、评价引用，以及按领域 schema 派生的 `decisionFingerprint / candidateFingerprint / answerFingerprint`。三者分别表示稳定决定、本次候选和规范化用户答案；Harness 只做精确判等和 TaskRun /owner 绑定，不解释组合、颜色、版式或其它领域内容，也不以相似度猜“这是同一个决定”。
- Tool / Capability Provider + Host 可以由内置模块、UXP /浏览器扩展桥或插件承载，拥有 Photoshop、项目文件、Eagle、浏览器和桌面观察等跨 Skill 原子能力的协议、schema、Host 连接、Provider-local 取消 /超时、原始读取结果与原始 mutation receipt；受控命令是条件性扩展目标，不是当前已完成事实。Photoshop 写入的唯一 mutation 事务 owner 是 `PhotoshopTransactionRunner`；Provider / Host 不另建跨调用事务、revision 或完成判断。Skill 只声明依赖，Harness 决定能力可见性与一次调用授权并消费原始收据做 reconciliation；Provider 已安装、已登记或 Host 可达均不等于模型可见、已授权、已执行或任务完成。
- 领域卡的 Provider、Renderer、type guard、owner 与版本必须由同一个 Skill package registration 派生。通用 ChatPanel /卡片 Host 只能提交品类中立的短选择或多字段草稿，不能复制 SKU /主图 /详情页字段、默认候选或确认状态来旁路 Skill Provider。未知 kind /版本、缺 owner、owner 不匹配或未注册卡必须 fail closed，并显示不可操作说明；不得使用通用“确认”按钮执行卡片自带 action。
- 同一 TaskRun 已消费一个领域决定后，冻结的决定 /候选 /答案身份必须穿过直接 Skill 续跑与 Agent reentry；如果下一张卡仍是同一决定、候选等于刚确认答案，且期间没有 plan、mutation 或 Photoshop revision 等真实进展，这不是“用户还没说清楚”，而是 Skill /Agent 没有推进。Harness 只报告 `interaction_no_progress` 并保留原 TaskRun；重复只读调用、换标题、换 card id 或把答案写回 initialValue 不能冒充进展。Agent 应重新观察、换方法、调用其它已授权能力或诚实停止，不得再次询问同一问题、重发用户文本创建新任务，或让 Harness 根据 routing recommendation 指定下一 Skill /Tool。

### 正面经验

1. 用 `owner + kind + payloadVersion + decision / candidate / answer fingerprints + TaskRun identity` 做精确绑定，可以在 Harness 完全不理解 SKU 字段的情况下阻止跨 Skill 恢复、旧卡重放和无进展重问；通用安全性来自稳定身份，不来自更多品类正则。
2. 把专属 Provider 与 Renderer 放回同一 Skill package，既能保留 SKU 拖拽、增删、排序和人工复核等高价值体验，又能让通用 UI 保持品类中立。可插拔不等于把业务卡降级成通用字段表，而是让领域体验可安装、可移除、可版本化且不污染 Agent 核心。
3. Harness 只比较 Skill 签发的决定指纹、检查 owner /scope /revision 和真实副作用；Agent 负责理解失败并重新规划。这个分工同时减少重复人工确认和 Harness 对模型下一步的劫持。
4. Tool / Capability Provider + Host 作为跨 Skill 原子能力层，可以让 Photoshop、Eagle、浏览器和桌面观察复用同一 Capability /preflight 安全边界，并为未来受控命令保留相同接入方式，避免每个 Skill 各复制一套电脑控制实现；内置与 plugin-backed 只是部署方式，不改变 owner。
5. 复杂度棘轮应该促成真实拆分，而不是在功能通过后抬高基线。本轮把交互复入停滞、工具 /用户结果投影、质量历史闭合和最终结果信号迁出 `agent.ts`，主循环从 12936 行降到 12845 行，再把新低点锁回棘轮；这比在巨型循环里增加一个“通用 guard”更能保护后续泛化能力。

### 负面教训与禁止反例

1. **场景关键词补丁**：为了修复“帮我做一下 SKU”之类单句漏路由而继续扩充正则，只会形成更多互相竞争的分类器。关键词可以帮助召回候选，不能拥有 Task Profile、Skill、交互或执行选择权。
2. **推荐抢 owner**：把 `routing recommendation` 当成已选择 Skill，会让 Harness 在模型判断前裁工具面、拦通用交互或恢复错误 workflow。只有结构化用户 /模型选择可以成为 owner；推荐不产生权限或等待点。
3. **默认首 N 色**：卡片 Builder 缺候选时自动取前 N 个颜色，看似提供“可用默认”，实际替模型 /用户生成 SKU 业务决定，并使不同任务反复得到相同结果。Builder 只能规范化与校验，候选必须由 Agent /用户 /Skill 显式提供；空候选应诚实为空或失败，不得暗选。
4. **通用卡复制领域语义**：用 `editable_confirmation` 复制 SKU 组合字段，会绕过领域校验、记忆、恢复消费与专属体验，并让 ChatPanel 重新认识 SKU。领域交互必须由已选 Skill Provider 生产；通用卡只解决真正通用的选择和草稿。
5. **Provider /Renderer 双注册**：语义 Provider 和视觉 Renderer 分别维护 kind /version 列表，会产生“可提交但不可渲染”或“可渲染但由错误 Provider 消费”的漂移。必须从同一 package registration 派生。
6. **未知卡仍可点击**：未知卡落入通用确认按钮并执行自带 action，把兼容兜底变成未注册执行入口。未知、损坏和版本不支持必须不可操作；兼容只能通过显式迁移或 legacy alias，不得通过任意 action 兜底。
7. **无进展重复询问**：已经收到同一决定的答案，却因 Skill 没有副作用或 revision 变化而再次弹同一张卡，会提高人工介入率并掩盖真实执行 /规划缺陷。正确恢复是把无进展事实交给 Agent 重规划，而不是继续要求用户确认或由 Harness 代选下一步。
8. **把候选摘要当决定身份或把读取次数当进展**：候选稍有变化就生成新 `decisionFingerprint`，会让 Skill 通过改 initialValue 绕过停滞检测；把任意 operationResult /只读调用数量增长视为进展，则会形成“读一次同样现场再问一次”的旁路。稳定决定、候选内容和用户答案必须分开签名，进展只接受计划推进、真实 mutation 或 Photoshop revision 等受治理事实。
9. **审计写死源码形状**：测试只寻找某个文件里的旧字段、旧 helper 或某一行精确调用文本，会在 owner 正确下沉后制造假失败，并诱使维护者恢复重复实现。行为测试应覆盖真实 TaskRun /Provider /事务结果；静态审计只钉 owner、边界、危险旁路与不可缺少的语义链。实现迁移时可以同步更新源码定位，但不得删除或放宽原语义保证。
10. **半成品先接生产**：函数已经被真实服务调用，却仍保留 TODO、忽略声明的过滤 /去重 /封顶参数，比“功能尚未开发”更危险，因为上层会把它当完成能力。本轮语义目标选择器就是反例；生产接线前必须完成最小闭环，或保持不可达，不能让注释替代实现。
11. **有测试但不在核心链**：新增测试脚本若没有进入唯一 `maintenance:validate`，会制造“核心全绿但新能力从未执行”的假安全。本轮已把语义目标框、语义候选和变更边界分类并入核心清单；以后任何 production capability 的长期测试必须同步进入该清单，不能留成旁路命令。
12. **文档把不同粒度写成同一个 owner**：笼统说 Harness 和 Provider 都“拥有事务 /读回”，会让后续实现各建一套真相源。必须分别写清跨调用编排与 reconciliation、原子 Host 调用与原始收据、以及唯一 mutation transaction owner；同样，开放澄清归 Agent，不等于 staged Skill 不能声明必要生产确认点。

## D-083 性能预算账本抽取与静态审计同步维护（agent.ts 拆分批次 1）

- 状态：已采用；代码完成，完整 22 项核心验证进行中；真实 Photoshop E2E 与收敛指标对照待验证。
- `agent.ts` 的运行级预算状态（模型/工具/视觉候选/视觉分析/终局 Judge/质量复核/预留区观察计数与活跃时长）收敛为单一 `performanceLedger` 状态对象；纯记账函数（预算耗尽判定、执行供给预留、质量复核上限、活跃时长）迁入新模块 `src/renderer/services/agent-runtime/performance-ledger.ts`。Agent 侧保留薄包装，注入运行态事实（授权期望、交付动作尝试、终局 Judge 预留、画面改动观察），单一 owner 不变。
- 行为零变化：耗尽判定顺序、终局 Judge 预留口径、切片 2 执行供给预留与质量复核上限语义原样保留；新模块不读 Photoshop、不读模型能力、不写消息历史。
- 静态审计的 agent.ts 文本断言随标识符改名同步迁移：`audit-agent-business-boundaries` 4 处、`audit-capability-resolver` 1 处、`audit-runtime-declaration-resolver` 行为测试 1 处、`audit-tool-registry` 负向正则 1 处。断言语义不变，只跟随唯一 owner 的新位置；任何后续移除对应模式仍会失败，不构成放宽。
- 本裁决不新增 Runtime、不改变预算上限语义，不把审计迁移当作行为验证；真机结论与收敛指标仍单独声明。

## D-082 历史回答不是事实，专业判断由 Agent 承担，只读任务不借写入契约证明完成

- 状态：已采用；代码、纯契约检查、只读自然语言实机与 15 项核心验证完成，专业判断 ownership 的不同问法可见回归待窗口空闲后补齐。
- 历史 user 消息可用于承接仍有效目标；历史 assistant prose 只是 `untrusted_external` 草稿，不能证明事实、进展、授权、质量或阻塞。用户明确要求抛开 /不参考旧答案重新独立判断时，本轮上下文排除旧 assistant 文本，避免模型自我引用形成伪共识。
- 不确定性只有三类：环境中可观察的事实由 Agent 读取；可撤销的构图、选图、抠图、边缘、排版和 Photoshop 工艺由 Agent 依据专业标准决定、执行并复核；只有用户独占的商品 /SKU /权威文案 /合规事实或不可逆风险才询问用户。
- 同商品存在多个可用素材不是天然业务歧义。Agent 应按真实性、清晰度、完整度、代表性、构图潜力和交付适配度排序后选择；“怕选错”“都差不多”或个人偏好不能单独形成等待。
- 开场基础观察是当前 Run 的结构化 Runtime 事实。同 document / revision 下已满足的零参数读取不重复暴露给模型；mutation、文档切换、revision 变化或 unknown reconciliation 会使其失效并重新开放。
- 结构化只读计划或用户明确禁止修改且当前 Run 没有成功 mutation 时，不签发 Photoshop 写入完成契约。`同款产品` 只描述商品关系；只有明确复刻 /照着做 /参考图，或同款版式 /效果 /画面等动作语义才进入 reference replication。
- 以上规则复用会话 Context、Run 内读取缓存、TaskPlan 和现有 Completion Contract，不新增品类 Router、专业路径状态机、Guard、Registry、Runtime 或第二 Completion owner。

## D-081 基础设计工艺按结构化写入委托可见，R3 blocking 只表达用户独占输入

- 状态：已采用；代码与 15 项核心验证完成，重启后的真实 Provider + Photoshop 白底图回归待验证。
- 普通自然语言设计请求继续直接进入同一个自主 Agent。只要现有 Intent Control Plane 已签发 `write_photoshop + confirmed_tool_required`，Capability Session 就应提供通用设计执行基础能力；不要求模型先猜中主图、白底图、SKU 或详情页品类，也不从任务文字建立快速通道。
- `removeBackground` 属于通用 Photoshop 制作工艺，与置入、变换、文字、背景等一起构成 Agent 对自己“能怎么做”的基础认知。Capability 可见只帮助模型选择方法，不授予写权限；TaskRun、请求级写范围、E1 preflight、document / revision 和 TransactionRunner 仍是执行边界。
- R3 `blocking` 的语义是“只有用户才能提供的输入”。项目、画布或 Tool 能自行观察的事实必须在声明前取得；已经具备的 Photoshop 工艺必须进入 R4 执行，不能被重新解释成需要用户补透明素材并转入项目检索循环。
- Assistant 回复中的“我将创建 /移动 /导出”等自然语言永远不是执行来源。不得再用正则从回复文案猜 Tool 并建立第二套 recovery / allowlist；Provider 没有形成 schema-bound Tool call 时，应由同一 TaskRun 的结构化 liveness / no-progress 事实处理并保留真实失败。
- 参考检索是按需的设计信息来源，不是确定性生产任务的默认前置阶段。白底图、尺寸变更、抠图、置入等目标明确且能力已知的工作应走最短专业链：最少必要观察 → 真实制作 → 同目标读回 → 质量 /交付分层；只有真实缺失用户独占素材、规格或取舍时才等待用户。
- 本裁决不新增任务类型、Skill、Executor、Router、Fast Path、权限 Owner 或 Completion。其目标是删掉重复决策点、让隐性 Provider /Tool /Runtime 失败直接暴露，并以不同自然问法的真实 canary 验证稳定性。

## D-079 Task Profile 只绑定语义，用户请求级写范围是不可扩大的执行上限

- 状态：已采用；精确属性请求 containment 已完成代码和核心验证，普通自然语言接续同一 TaskRun / R4 仍待 V0 实机。
- Task Profile、Manifest、Skill、Design Kernel 和 Craft Recipe 可以补充交付物语义、方法、Capability 候选与评价标准，但不得扩大当前用户要求的交付物、mutation、目标文档或文件范围。模型声明任务类型不是新的用户授权，也不能隐式把 edit_existing 变成 create_new。
- 对只有一个明确 Photoshop 属性替换且没有第二 mutation、保存或导出要求的请求，复用既有 `runtimeAllowedWriteTools` 作为最小 deny-wins 上限：图层名称仅 `renameLayer`，可见文字仅 `setTextContent`，属性尚未消歧时仅开放两者。只读观察与 Harness control 保持可用。
- 范围必须同时作用于 Capability 候选面和最终 Tool 执行点；只隐藏 schema、Prompt 提醒、Task Profile 文案或 Skill denylist 均不能单独成为安全边界。Skill bridge 和 shared legacy provider alias 必须服从同一上限。
- 局部解析器只对单一、可确定的属性替换签发范围。用户同时明确要求其它 mutation、保存或导出时返回未收窄，由完整目标与计划处理；不得为了安全把复合请求误降成单步，也不得从任务品类关键词创建范围。
- 自然语言声明后进入结构化 Runtime 必须保持同一个 TaskRun，并继承原始用户目标、允许交付物、写范围、document /revision、Tool log 和预算。禁止递归创建新的 autonomous task 或用 Task Profile 默认交付物覆盖原请求。

## D-080 UXP 原生 `get` 必须静默执行，History 位置使用 DOM 真相源

- 状态：已采用；代码、真实 Photoshop 读回、Tool audit、UXP build 与完整维护验证通过。
- History 位置读取使用 `document.historyStates.length` 与 `document.activeHistoryState.id`，不得向 Action `get` 请求不存在的 `historyState.count` 属性。
- 必须使用 Action `get` 的其它 UXP 描述符统一携带 `_options.dialogOptions='dontDisplay'`。此选项只阻止原生 UI 弹窗，不吞掉 Tool error；错误仍以结构化失败返回上游。
- `audit:tools` 是该回归的静态门禁：无效 history count 或缺少 `dontDisplay` 的 native `get` 必须使维护验证失败。Host 请求因原生模态阻塞而超时时禁止自动重放写入。

## D-078 403 不等于认证失败，Provider 失败必须由真实请求边界归因

- 状态：已采用；代码与核心验证完成，应用重启后的 Ollama Cloud 设置页 live 复测待完成。
- 只有 HTTP 401、Provider 明确认证 code/type 或无歧义的认证失败消息可归为 `auth`。HTTP 403 表示服务已理解请求但拒绝访问；没有更具体认证证据时必须归为 `model_access`，不得诱导用户更换正确 Key。
- 模型设置页的“测试”必须是真实 Provider 请求。Key 连接验证与当前模型的订阅 /访问权验证是两个不同结论；长度、格式、已保存或模型列表可见都不能代替指定模型调用成功。
- Provider 失败只在请求抛错边界或显式 failure envelope 分类。UI、Engine 和 Agent 不得从模型正常回复正文、历史错误文案或裸 `401 / 403` 数字反推当前请求失败。
- Run Record 只保存脱敏、有界的失败来源摘要；原始 Key、Authorization、图像或完整 Provider 载荷不入档。失败摘要不授权重试、不改写 TaskRun 成功状态，也不是第二个 Error Store。
- 认证、订阅 /权限、计费和协议错误默认不自动重试。任何未来的暂态重试也必须有明确 retryable 证据、严格上限，且仅允许发生在无 Tool call、无 Photoshop mutation 的请求边界内。

## D-077 R4 语义计划保持非执行，V0 通过一次性执行信封取得派发资格

- 状态：已采用；V0 代码接线与核心验证完成，真实 Provider + Photoshop 纵切待验证。
- Model 继续拥有 R3 设计方向和 R4 语义步骤，只回答“为什么做、做什么、依赖什么”；`runtime-action-plan-declaration` 保持 `shadowOnly / executable=false / schedulerAuthority=false`，不得携带 Tool 名、参数、layerId、坐标或执行权限。
- 首批 `photoshop.mutation.v0` 只认证已经由唯一 `PhotoshopTransactionRunner` 持有的 `renameLayer`、`groupLayersSafely`、`moveLayer`、`lockLayer`、`setTextStyle`。每个动作使用一对一叶子 Capability；broad manage /write alias 和包外 Tool 不取得该资格。
- Model 随后提交真实 schema-bound Tool call 时，现有 E1 派发接缝才可编译一次性执行信封。信封必须绑定 TaskRun /run、plan revision /fingerprint、当前 node、active leaf Capability、provider、参数 fingerprint、document 与 history revision，并再次通过既有 execution preflight 和单文档 writer ownership。
- 执行信封只证明该次调用已满足派发资格，不是第二 DAG、Scheduler、Capability Registry、权限 Owner、TransactionRunner、Completion 或 Release。合法调用仍交给现有 `executeToolWithFailureBreaker`、UXP 和 `PhotoshopTransactionRunner`；包外调用保持现有 v3/E1 路径。
- 真实 `PhotoshopOperationResult` 必须与信封 provider 一致并直接归属其 node。缺失或 provider 不匹配时 TaskRun 转为 `unknown / needs_reobserve`，禁止事后猜归属和自动重放；shadow reconciliation 只保留为独立语义 /观察审计。
- 该裁决只完成代码和核心验证。未经真实 Provider 生成调用、Photoshop 写入、同目标读回以及并发 /恢复验证，不得宣称 V0 E2E、设计质量或标准设计师能力已经完成。

## D-076 自主任务语义续接复用有界会话上下文，生产义务以结构化 Brief 为准

- 状态：已采用；代码接线与核心验证完成，真实 SKU 同会话复跑待验证。
- 当前用户指令仍是最高优先级；最近有界历史只用于解析指代、承接同一会话已经明确且尚未完成的交付物、避免重复探索。历史是 data-only Runtime Context，不授予 Tool、Stage、mutation、完成或 Release 权限，也不能覆盖实时项目 /Photoshop 事实。
- 普通自然语言入口保持中性 Task Plan，不用关键词、品类正则或历史文件名预造 SKU /主图 /详情页身份。主 Agent 在运行中声明 Task Profile / Runtime Design Brief；如果当前短指令结合有界历史仍不能唯一确定交付物，只问一个会改变执行方向的用户问题，不用反复项目搜索代替澄清。
- ready Runtime Design Brief 若声明 `photoshop_mutation_with_readback`，现有完成义务必须要求真实写入或交付动作；合法只读、打开、解释和分析任务继续按自己的交付类型完成，不为满足统计而制造 mutation。
- 只读观察失败必须区分“确定性环境事实”和“可选上下文没读到”。前者可阻断或要求用户动作；后者保留失败 Trace，但不得独自冒充交付失败，Agent 应在同一 TaskRun 内用更轻读取、当前画布 /组件边界、设计原理或其它存活能力局部重规划。
- 没有成功 Photoshop 写入、导出或外部生成时，任何 `needs_review` 输出都不得声称已有“当前版本”。诚实输出必须说明只完成了读取、尚无可复核设计结果。
- 该裁决复用 `agent-conversation-context.ts`、Runtime Context Compiler、Runtime Design Brief、现有 Completion 会计和 Tool Trace；不新增 Conversation Memory Store、关键词 Router、品类 Executor 状态机、第二 Completion 或第二权限通道。

## D-075 Agent 的能力自我模型由现有 Task Profile 与 Capability Session 实时投影

- 状态：已采用；代码接线与核心验证完成，真实设计效率和选择质量待 V0/V1/M6 实机验证。
- 成熟设计师式作业不是新增角色状态机，而是让主 Agent 在每个模型轮次看见稳定的交付物语义和真实能力边界。Task Profile 继续拥有“要做什么”；Capability Session 继续拥有“当前能用什么、还能装载什么、明确不能用什么”；Tool 语义继续拥有前置条件、副作用与验收方式。
- `declareDesignIntent` 形成合法 Task Profile 后，下一轮及后续轮次持续注入对应交付物责任、默认结构与阻塞输入；不能只把知识作为一次性 Tool result 返回后依赖模型自行记住。
- Capability self-model 每轮重新投影 active / on-demand / denied / unavailable。legacy capability alias 复用其真实 provider Tool 的已审核语义，但 alias、语义和 schema 均不授予执行权限。
- Agent 先明确交付物与完成标准，再区分已有事实、可观察事实和用户独占取舍，并选择最短可靠能力链；只有下一步 schema 缺失时才装载最小能力集。随机调用、遍历 Tool、重复失败 provider 都不是能力发现机制。
- 这一裁决不引入新的 Capability Registry、Context Compiler、Task Runtime、Workflow 或角色级 Tool 白名单；动态上下文是现有 Owner 的只读 projection。

## D-074 Task Profile 统一知识身份，设计知识按 Stage 渐进装载，参考默认按需

- 状态：已采用；F1/F2 代码接线与核心验证已完成，真实 Provider + Photoshop 设计质量仍待 V1/M6 验证。
- `design-task-types.ts` 是 task type、artifact knowledge、artifact-owner Manifest /兼容 Skill 与 document role 的唯一 crosswalk Owner。Artifact Knowledge 只拥有交付物方法、输入解释和 provenance；Manifest 只拥有结构化生产声明与 Capability 引用；两者不得反向创建任务身份或权限。
- 设计方法和交付物知识作为 `RuntimeContextItem` 进入唯一 `runtime-context-compiler.ts`。结构化运行按当前 Runtime Stage 在每轮模型调用前重新编译；不适用知识不装载。无业务 Skill 运行在合法 Task Profile 声明后也能取得同一带治理记录的基础知识。
- Skill 是受控生产 Overlay，不是 Agent 懂主图、详情页、SKU 或通用设计的前提，也不是唯一方法来源。SKU Template 拥有 artifact-owner Manifest，但不为此新增业务 Executor；它使用通用设计能力、现有原子 Tool 与统一运行约束。
- 首条 `photoshop-craft.editable-single-canvas-composition@1.0.0` 作为现有 Knowledge provider 的版本化记录落地：只为通用单画布、主图与 SKU Template 提供视觉意图到真实 Photoshop Tool 语义、参数来源、保持项和读回方法的候选映射；R3 不装载，R4/R5 可选用。它不是 Recipe Registry、执行计划或成功证明。
- 普通设计参考默认 `reuse_or_optional`：仅在能实质降低设计不确定性时读取项目 /品牌资料、Eagle 或外部来源，离线 /无命中不阻断执行。用户明确要求复刻、指定参考或品牌约束时，相关任务 Contract 可以把它提升为必需输入。
- Knowledge、Reference、Memory 和模型先验均为 data-only；不能覆盖用户当前目标与 ProductTruth，不能证明看过图片，不能授予 Tool /Stage /完成 /Release 权限。

## D-073 DesignEcho 收紧为标准专业视觉设计 Agent，但不新增角色 Runtime 层

- 状态：已采用；产品边界已经由 `Prompt.md` 与 Design Agent OS 定义完成，不存在待实现的 F0 角色合约里程碑。
- 权威身份：DesignEcho Agent 把用户设计目标、有来源事实和真实素材转化为可编辑 Photoshop 设计交付物，通过同目标读回与专业 Evaluation 有界修订，并只依据 Release 事实报告完成、待复核或无法继续。它不是通用助手、任意电脑控制 Agent 或 Photoshop 命令行外壳。
- 产品身份是行为边界，不是生产数据 Owner。不得新增 `standard-design-agent-role-contract`、六任务族枚举、角色级 Intent Router、永久 Tool 白名单、`standard-design-task-contract` 或 `standard-design-outcome`。
- Model 依据完整目标和上下文理解是否属于设计工作；设计知识与 Photoshop 工艺说明可以直接回答，与视觉设计无关的通用代办不进入生产执行。关键词、文件名、Tool 名或本地正则不得抢先接受 /拒绝、选择 Skill 或授予权限。
- 生产责任继续由现有 Owner 分担：Task Profile 表达交付物语义；Capability Session 与 Policy 管理能力 /权限；TaskRun 拥有活动任务；operation result 与 Verification 拥有执行事实；DesignVerdict 拥有质量裁决；Release 与 Delivery 投影结果。需要统一输出时只做只读 projection，不再新建 Contract 链。
- “从零创作”是 Design Kernel 的内在设计能力，不是独立 Task Type、Skill、Executor、Workflow 或通用 WorkMode 路由。代码只表达目标状态、保护关系、执行要求和交付规格；创意判断由模型结合 Kernel、知识、参考与真实观察完成。
- 所有真实设计保持四项职业责任：事实与观察扎根、专业设计判断、可编辑 Photoshop 落地、同目标复核与诚实交付。它们是行为要求，不是固定 Workflow 或逐项状态字段。

## D-072 Harness 采用两车道纵向会合，不再以全量 mutation 迁移作为总阶段墙

- 状态：已采用，按 F1/F2/F3、X1/X2、V0/V1、M5～M7 实施。
- 旧 M3-A → M3-B → M3-C → M3-D 的安全依赖仍适用于每个真实写节点，但不再解释为“全仓所有 legacy mutation 迁移完成后才能启动 TaskRun 或只读 Design Foundation”。
- F 车道只收敛现有 Task Profile / crosswalk、阶段化 Context 与 Photoshop Craft Recipe Knowledge；不选择 Skill、不授予 Tool、不推进 Stage、不形成完成或发布结论，可以与 X1 并行。
- X 车道把现有 RuntimeSession 原地升级为最小 TaskRun，并按当前纵切需要的 capability pack 迁移 TransactionRunner。TaskRun 拥有 plan revision、节点状态、waiting interaction、operation result、document / revision 和单文档写者身份；Runner 拥有单次 mutation 的 modal、取消、commit、unknown readback 与 rollback。
- 语义 R4 不取得 scheduler authority；只对同时满足 TaskRun、叶子 Capability、Tool schema、execution preflight、稳定 target / revision 和 TransactionRunner owner 的真实 Tool call 编译一次性执行信封。未迁移 legacy Tool 不进入该切片；每个切片按实证退役对应 reconciliation、retry、continuation 和 completion 重推断，避免长期双 owner。
- V0 只证明“看准、写准、读回准”；V1 才证明无业务 Skill 的受限真实设计闭环。V1 直接消费同一个 canonical Release Gate owner 的首条实现，不建立临时第二 Gate。
- 依据：Runner 当前仅迁移 5 个 owner，而 UXP `src/` 有 52 个包含 `executeAsModal` 的文件；另一方面同文档并发写已经证明 TaskRun writer ownership 不能继续排在全量迁移之后，且近期只读 Design Foundation 已部分落地。水平全量阶段会同时延迟安全 owner 和设计结果。

## D-071 生产结果、设计质量、交付与用户接受分层

- 状态：已采用，待 M5 完整实施。
- `executionApplied`、`executionVerified`、`designVerdict`、`deliveryReady` 与 `userAccepted` 分别由现有执行、读回、Evaluation、Delivery 和用户动作 owner 产生；任何上层状态不得补造下层事实。
- Tool success 不等于同目标验证，同目标验证不等于设计质量通过，设计质量通过不等于交付齐全，交付齐全不等于用户接受。
- TaskRun / Release Profile 必须显式区分 `mutation_required` 与 `mutation_not_required`；合法只读、建议和分析任务用匹配交付类型的 Observation / Artifact 验证，不被迫制造 Photoshop mutation。
- Release 输出使用 `release_ready / review_required / release_rejected`，不复用 transaction `commit`。硬拒绝只接受带 `blockerKind + proofRef` 的目标 / revision / permission、不可逆动作未批准、确定性事实错误、必需产物缺失或结构损坏；裸 `severity=blocker` 没有发布权威。
- 构图、色彩、排版、对比、工艺、总体观感、VLM coverage 和 `above-baseline` 都属于质量 finding；没有独立的 OCR /结构 /事实 proof 时只能进入 `review_required`。`passed_unverified / needs_review` 不自动返工，`not_applicable` 不能为设计任务提供通过信用，`userAccepted` 始终是正交状态。
- `designVerdict.blockers / scorecard.blockers / designQualityHardBlocked / summary.blockers` 等迁移字段不得由 Runtime、Reflexion、Completion、UI 或 Run Record 在 Gate 前直接消费为硬终止；M5 退出要求旁路消费者为 0。

## D-070 Design Harness 以常驻 Kernel 为底座，Hermes 仅作受审经验机制参考

- 状态：已采用，按 M4～M7 分阶段实施。
- 主图、详情页、SKU 批量 /色卡 /模板与开放式单画布的基本语义属于 Task Semantics / Design Kernel；不依赖业务 Skill 才能理解。Skill 只提供品类、渠道或交付物特有 overlay，不拥有 TaskRun、Tool 权限、PhotoshopTransactionRunner 或 Release Gate。
- Task Semantic Binding 与 Skill 选择分离：前者只保存交付物语义和 Kernel profile 引用，由唯一 Context Compiler 消费；它不装配上下文、不授予权限、不推进阶段，也不得由关键词、文件名或旧路由提示补造。
- Photoshop Craft Recipe 负责把视觉意图、适用条件、参数来源、非破坏性工艺、保持项和结构 /像素验收连接起来；Recipe 是 Knowledge / Kernel provider，不是 Tool 或固定 Workflow。
- 普通自然语言在尚未声明 taskType 时，允许按 Recipe 自身的 `design.generic.v1` applicability marker 注入紧凑通用索引，使 Agent 先拥有品类中立的 Photoshop 工艺知识；该 fallback 不得选择 `design.general` Manifest /Skill、预造交付物、授予 Tool、推进 Stage 或成为完成依据。索引只描述有条件候选工艺和最短选择原则，不能变成逐项试 Tool 的固定流程。
- 任务执行内环与经验演进外环分离。在线运行只完成当前 TaskRun 并最多写隔离候选；设计方法 /Recipe /Skill 收益候选要求真实 operation result、同目标读回、DesignVerdict 与相应 Delivery /人工反馈，失败或中止运行只能生成缺陷、负向 finding 或 Evaluation-gap 候选，不能证明方法收益。
- Task Semantic Binding 只作语义身份一致性校验，不激活 Skill；Capability / Skill 激活继续由结构化 R0 选择、当前 stage、Capability / Policy owner 与模型在合法候选内的判断共同决定，不能只让模型看短描述后独自选择。
- 借鉴 Hermes 的渐进加载、事实 /程序分离、Patch 优先、来源与生命周期、归档和回滚；不采用调用计数即学习、纯 LLM 自评、任何在线路径直接改 canonical Skill、usage 等同质量或平面 Memory 充当项目 /PSD 真相源。
- 当前用户指令和真实项目 /Photoshop 状态永远高于历史 Memory；M7 前不启用生产经验自动化，M7 内只实施受审候选与人工生命周期，更进一步的自动优化在 M7 退出后另行决策。
- 外部依据（2026-08-01 核对）：[Hermes Agent 主仓](https://github.com/NousResearch/hermes-agent)提供在线记忆 /Skill 管理机制；[Hermes Agent Self-Evolution](https://github.com/NousResearch/hermes-agent-self-evolution)是独立离线演进仓库，不能把后者的目标能力写成主仓或 DesignEcho 已实现事实。

## D-068 RuntimeSession 原地演进为单一 TaskRun

- 状态：已采用；TaskRun reducer 与 Agent /交互恢复生产接线已完成代码和核心验证，V0 capability pack 与真实并发 /恢复验证仍在实施中。
- TaskRun 唯一拥有任务身份、plan revision、节点状态、目标、交互等待、operation result、复核和终态；不创建第三 Runtime、第二 Task Store、第二 DAG 或第二 Verdict。
- Photoshop mutation 的 TaskRun snapshot 必须固化 document /revision，并成为单文档并发写者身份 owner；同一文档被其它 TaskRun 或外部操作改动时，只能重新观察、等待、显式接管或终止，不能依赖活动文档、自动切换目标或重放旧写入。
- `waiting_user` 是非终态，恢复必须绑定 `taskRunId / interactionId / expectedRevision`。

## D-069 彻底退役 smoke 验证体系

- 状态：已采用，已完成。
- 后续不再新增、维护或依赖 `smoke-*` 脚本；“某个功能没有 smoke”不是新增一次性测试的理由。
- smoke 在本项目规模下造成脚本和 package 命令膨胀，容易出现重复断言、假绿通过和验证债务，最终增加 BUG 风险。
- 默认质量依据改为构建、类型检查、静态审计、规划/仓库卫生检查和可复用的真实功能测试；验证失败必须保留真实失败，不得删断言或吞错。
- 旧 smoke 文件、package 命令和分层调度器在本次迁移中删除；包含额外乱码/卫生护栏的旧历史实现暂不从磁盘删除，但不被任何活动命令调用，历史细节由 Git 保留，不建立新测试框架替代它。

## D-067 第四设计 Skill 采用通用单画布能力

- 状态：已采用。
- 海报是 canary，不创建固定 poster 流程、关键词路由或专用 Agent 核心；Skill 只提供 overlay。

## D-066 R1 语义由模型声明，精确来源由 Harness 绑定

- 状态：已采用。
- 模型只声明 inputKey / status；Harness 绑定真实来源。没有来源的 provided 必须失败关闭。

## D-065 人工落盘与 Agent 承接分开幂等

- 状态：已采用。
- 确认卡不能通过重新发送自然语言创建新任务；内部承接必须绑定来源运行和结构化 Runtime identity。

## D-064 业务 card.id 与渲染实例身份分离

- 状态：已采用。
- 内容定义 id 用于 stale 校验，重复提交使用 source message / block / card 的渲染实例键。

## D-063 Provider 截断续跑保留原生 Assistant 回合

- 状态：已采用。
- 保留 content、tool calls 和 reasoning；禁止发送 role-only assistant 历史或重放 Photoshop 写入。

## D-062 设计首轮只加载最小执行供给

- 状态：已采用。
- R4 只投影计划 schema，E1 才执行；视觉复核必须消费实际图像和同一 revision。

## D-061 复核卡安全让出，来源精确承接

- 状态：已采用。
- 通用 continuation 不拥有业务写入；恢复通过精确来源和结构化 owner 完成。

## D-060 破坏性确认与普通续跑分离

- 状态：已采用。
- 不可逆动作保留真实审批；可撤销且目标明确的 Photoshop 操作不以无必要确认替代执行。

## D-059 缺输入时开放“可自行取得”的只读路径

- 状态：已采用。
- 不把 Harness 缺失的环境事实推回用户；只有真实歧义、不可取得的用户独占信息或不可逆边界才等待。

## D-057 瞬时读取失败保持中性

- 状态：已采用。
- “没有打开的文档”等结论必须来自结构化证据；瞬时失败可重试，不能被写成确定性否定。

## D-054 Artifact 由主进程 Repository 发布

- 状态：已采用。
- Renderer 只能提交受限收尾声明；Project State、Runtime Snapshot 和 Run Record 不复制 Artifact 正文。
