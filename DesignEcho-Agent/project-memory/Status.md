# Current Status

> 文档类型：B 层当前事实摘要。
> 当前开发权限：只提供已经核实的状态，不拥有目标、排期或执行授权。
> 历史状态：使用 Git，不在本文件继续累积按日期排列的运行病历。

## 当前产品结论

- DesignEcho 仍是“专业视觉设计 Agent + Photoshop 生产环境”的在建系统，不是已经稳定完成的一句话自动设计产品。
- v3 仍承担默认真实执行；v5 提供 manifest、契约和部分治理；bridge 只做过渡适配；legacy 不再扩张。
- Agent 运行时当前使用一个支持视觉的主模型；没有独立第二视觉裁决中心。
- Photoshop 图框几何、目标绑定、写后读回和部分事务能力已经存在，但专业构图、视觉语义到执行参数的连续表达、评审校准和稳定交付仍未闭合。
- 主图、详情页和 SKU 是首批验收 Skill，不是三套 Agent，也不是长期能力边界。

## 已核实（代码）

- Agent / Harness / Design Kernel / Skill / Tool / Evaluation 的 owner 边界已有源码审计与项目规则守护；Harness 不应替模型选择素材、构图、文案或下一项设计动作。
- `agentic` 路径保留自主 ReAct，不以 R1 / R3 / R4 声明作为写入门票；`staged` 路径可以使用确定性阶段和规格化交互。
- 图片 targetBounds、contain / cover / fill、anchor、focal point、subjectFillRatio 与写后几何读回已有共享契约和 UXP 实现。
- 现有设计知识覆盖构图、层级、留白、排版、色彩、主图方法和 Photoshop Craft；知识存在不等于已在具体图片上稳定使用。
- D-113 / D-114 已修复新建文档生命周期收据和首写前置对象 revision 字段的 producer / consumer 漂移；最新未完成问题已进入 Intake，而不是继续占据当前任务入口。
- OpenAI-compatible 非流式视觉终审现会从真实 serializer 图片序列签发出站回执，并把当前 ReviewSet 绑定到同 revision 的可编辑源稿与栅格导出；非完整终态、拒绝、缺 response id 或候选不一致均无回执。
- `evaluateDesign` 明确保持 advisory：不能关闭 TaskCompletion；协议失败不写任务卡或设计学习，也不会被 Harness 伪装成缺少画面检查后拉回主 Agent。
- Final Judge 不足 5 秒时在 Evaluation Owner 内结算 time exhausted；DeepSeek 图片保留使用三态能力裁决，只有明确 unsupported 才降为文本。
- 现有 Runtime Accounting 已扩展为逐物理模型 attempt 的有界归因：调用用途、请求模式、iteration/generation、requested reasoning、上下文准备与来源桶、输出体量及 run-scoped 视觉 revision 摘要均进入同一 owner；没有第二模型账本，也不参与权限、预算、完成或审美判断。
- 模型调用计时与脱敏投影已从 `agent.ts` 抽到品类中立适配模块；Agent 核心行数保持简化棘轮原基线，所有调用用途仍由调用方显式声明，适配模块不决定用途或路线。
- Provider 输出恢复现在遵守视觉事实：带图响应截断且可恢复时会在恢复请求中重发同一像素；只有完整响应可消费 pending observation。恢复完整、blocked、异常或额度耗尽都会退休像素并清理状态；普通任务模型 /视觉预算只扣一次，Runtime Accounting 仍记录全部物理请求。
- 聊天上传图片当前能以 `DesignImageInput` 像素进入主模型，但通用 Agent 没有可供 `placeImage` 消费的请求级附件来源句柄；`fileToken` 是 UXP session token，不能由 Renderer 或模型伪造。该缺口已归属 Input Asset / Attachment Provider，而不是项目搜索或模型能力。
- agentic Task Profile 绑定现在遵守上下文因果一致性：同一响应中的只读观察与知识检索可保留，Photoshop 写入、保存导出、外部生成、状态写入和未知副作用调用必须由绑定后模型轮重新生成。Harness 不改参数、不强制参考，也不把 Brief / Strategy / Plan 变成写入门票。
- Final Quality 在 Host 事实、ReviewSet 或 Judge 调度形成协议前失败时，现通过既有有界协议摘要记录 `unavailable / evaluation_runtime_failed`；交付复入只有 fresh exact revision 才恢复缓存的 `completed`，已知漂移投影 `stale`，两类失败都不会继承旧信用或唤醒普通 Agent。
- Design Reliability 已把 Debug 最终交付来源升级为贯穿 E2/resultRef collector、Sidecar、ChatPanel 与 consumer 的 v5 三态：只有确实未声明时 `absent + []` 才是可信但不完整；非空合法集合为 `valid`；项目外路径、目录穿越、畸形、超量、重复或状态矛盾为 `invalid` 并使收据不可信。canonical 生产完成路径保持原 `string[]` owner；空集合不能构造 Artifact manifest，技术交付仍失败。
- 主 Agent 素材观察已从 requirement 驱动的 `recommendAssets` 收敛为 `browseAssetCandidates` 中性分页：不推断品类、不评分、不返回赢家、不自动选第一项；`candidateSetId + G + path` 绑定 scope、完整候选文件版本与集合内跨页身份。旧推荐入口不再出现在模型 Schema 或 Capability Session，只保留给 Skill-owned 兼容路径。
- 生产知识治理现在把任何来源的 `benchmark_case` 强制限制为 `benchmark_seed`；模型、测试桥和普通时间线读取只能写 /读待审核学习候选，不能发布评价校准或在线改写 Skill。当前没有独立用户审核发布 UI，因此正式发布保持 fail closed。
- 自动 Project State 摘要只展开全局适用的已确认规则、已确认事实、待核候选和历史记录数量；旧选图、版式、文案、评审、版本原因与旧 task/channel 不再自动进入当前方案或激活 scoped rule。明确当前 owner 提供 task/channel 时，scoped 已确认规则仍可按需解析。
- Artifact 与 Evaluation 终态已分轴：PSD/JPG 保存完成继续保留 `artifact_completed`，但 `designVerdict=needs_review` 会让整体终态保持 `needs_review`，用户可见文案不得改称专业完成或“不影响交付”。
- 测试启动器已不再默认指向用户真实项目，并会创建一次性临时项目和 OS-temp userData；Main 通过纯 resolver 独立重验项目 /userData realpath、旧 `.designecho`、目录重叠、打包 /Bridge 与 CDP 信封，正负行为测试已覆盖启动器旁路。
- `INTAKE-092` 主图生产结构已完成代码治理：唯一事实源保存 1500×1500、1500×2000、1440×2160 三份 72 ppi RGB/8 工作文档和每份 5+4 空槽；Agent /用户以逐槽 `slotAssignments` 拥有素材、主体 bounds、target /safe box、缩放 preset、目标和文案决定。空骨架为 39 步 editable-only，满 27 槽为 120 步并使用冻结计划动态预算。UXP 隔离兄弟子组、保留完整工作画布，live adapter 将父组归根、子组归父，并以真实 documentId、Background id、父子路径和规格面板顺序读回。专项行为测试、fresh 65 阶段 `maintenance:validate` 与最终无 P0/P1 独立审查均已通过；fresh Photoshop Host 尚未验证。
- agentic 主图 Runtime 的 pre-bound 与 loop-bound 入口现复用同一个输入 /交付责任投影；自然用户目标、随消息图片、项目素材和当前 Photoshop 文档按 Manifest 允许的 source kind 进入上下文。唯一主图 workflow entry 只在显式绑定后可见，broad atomic Tool 保持可达，绑定本身不执行 Skill 或授予写权限。
- 主图生产参数不能再伪造 live approval；真实执行必须消费同一 branded guarded executor 与其 delivery authority。显式 assignments 只展开实际涉及的规格文档，保存 /导出先写 staging，再依据实际 Tool result、完整文件 identity 和 external commit 整组提交。跨 executor authority、artifact、staged path、lease digest 或提交集合漂移均在 Host 前失败关闭。
- Codex 订阅通道严格 schema 投影已由 `69c54867` 修复：不受支持的条件关键字不再静默消失，约束以有界 advisory 文本保留；同一响应只修复失败 Tool Call，合法兄弟调用不重放。该机制修复 schema 兼容性，不取得 Tool 参数或业务决策权。
- 同分支未完成 Run 的续跑身份已由 `b4998b65` 收敛为结构化 `RunResumeContractBinding`：只恢复 task type /manifest /来源身份，不携带 Tool、写入、完成或设计权限；畸形、跨来源和 Manifest 漂移均失败关闭。
- 当前主图 prepare workspace 仍由 Renderer 进程内 Map 持有，应用重启后不能安全恢复；但 Manifest-bound 正式 completion 已不再接受通用保存 /导出旁路。Agent 仍可生成中间文件，只有声明的 Workflow producer ready receipt 能结算 Skill 交付。唯一 completion owner 已在代码层闭合，workspace 生命周期仍未闭合。
- Agentic Artifact Completion 现在保留 Manifest 的 `delivery_plan_binding_required` 和 producer Skill 身份。通用收据选择器只接受绑定 typed DeliveryPlan、完整 save/export resultRef proof、逐文件身份、源 Photoshop revision 与 exact artifact set 的 ready receipt；后续内容 mutation 或另一次通用保存 /导出会使旧 receipt 失效。该机制是品类无关的交付归属，不执行 Tool、不决定设计，也不阻断 Agent 使用原子工具工作。
- 创意任务模型可见面已由 `b10da18a` 首次收敛：首轮保留项目 /画面观察、Eagle、图片、图形、可编辑文字和局部变换；大型 `composeDesign`、隔离 `evaluateDesign` 与已自动注入方法的 `readSkillPlaybook` 转为同一 Capability Session 的按需能力。主图 /详情页 Skill 不再要求开工重复读取同一手册。agentic 通用原则使用 1,112 字符紧凑底座，staged 全量原则仍保留 6,408 字符。该变更不改变 Tool preflight、TaskRun、Photoshop 事务、读回或交付完成权。
- Skill 现支持把完整内部生产参数与模型可见参数分开投影；投影只能隐藏 optional 技术字段，不能隐藏 required 输入。主图模型接口只保留 Agent-owned 规格、设计和素材语义，Runtime-owned execution mode /scope 在执行入口剥离；prepare 强制 disposable scope，且不在不保存 /不导出的阶段验证 delivery convention /support refs。agentic 常驻上下文只保留任务特有方法 overlay 与紧凑原则，Artifact /Craft 索引按需可达；该机制不选择 Skill、不决定素材或画面。
- 能力 /意愿问句现在会让出仍包含具体只读目标的礼貌表达：去掉“你可以 /你能不能”等开头后，若正文仍是项目 /文档 /SKU 检查或参考检索，就保留非写入语义；写入形态和纯能力询问继续保持 `chat_only`，不能因此取得执行授权。对话出口会拒绝 DSML、`<tool_call>` 与 angle-JSON Tool 协议正文并触发一次自然语言 repair；清洗器只做最后防泄漏，不把协议故障伪装成成功。
- Reflexion 重入容量门按续作类型分流：提供容量证明的重入路径先识别续作类型再取对应最低容量——completed 审美返工与执行 / 复核目标阶段用完整下限，targetStage=E2 的交付闭合用不要求视觉候选的交付下限；「视觉额度耗尽但剩余工具与时间足够交付」的 E2 续作不再被误拦，不提供证明的调用方保持旧行为。
- 唯一 advisory 候选已实现两段式入口：候选提示由动态上下文逐轮渲染，declareDesignIntent 以 enum taskTypeId/workMode 充当结构化选择手柄；模型声明成功时 declaredTaskType、Runtime owner 绑定与 Skill 可见性在同一 Tool result 边界提交，候选提示随即在下一轮移除。Harness 不自动选 Skill；inspect / no-tool 控制面不渲染候选手柄。该机制已有静态与行为断言，尚未经正常程序实机复现。

## 已核实（构建与自动检查）

- 整理前最近记录的代码切片曾通过 65 阶段核心验证、Agent / UXP production build 和相关专项审计；这只证明当时提交的工程边界，不证明当前文档改动或真实设计质量。
- 本轮整理开始前 `maintenance:planning-check` 与入口文档同步审计退出 0，但前者同时暴露 CurrentTask 与 project-state ID 漂移；因此旧“绿色”不能作为语义一致性证明。
- 本轮文档改动后的 `maintenance:planning-check`、入口文档审计、编码、仓库卫生、变更边界、Skill /门禁专项及完整 `maintenance:validate` 均通过；核心回归为 65 项，并包含 Agent 类型检查、UXP 测试与 production build。
- S1 交付 /评审根因代码纵切新增后，再次完成一轮 65 阶段 `maintenance:validate`；专项覆盖真实 DeepSeek `chatWithTools(..., tools=[])` 图片出站、OpenAI-compatible receipt、全画布 Final Judge binding、r38 形态 PSD/JPG E2 refs、Evaluation 非法输出和 advisory authority。
- INTAKE-090 性能归因纵切已通过一轮 fresh 65 阶段完整 `maintenance:validate`，其中包含 Runtime ledger、ContextManager、设计作者权与业务边界、Agent 简化棘轮、Renderer/Main 类型检查、Agent/UXP 测试和 UXP production build；尚无 fixed Case 新样本，因此不能把工程绿色表述为已经提速。
- revision 5 实机后的最终整合树已通过 65 阶段 `maintenance:validate`；包含 Debug v5 producer→receipt→consumer 三态、Runtime declaration、TypeScript 控制流业务边界、零任务进展时零 Host /零模型调用、exact / stale / unavailable 终审缓存复入、Design Reliability、设计作者权、Renderer/Main 类型检查、Agent/UXP 测试和 UXP production build。Agent 核心简化棘轮由 12826 下调并锁定到 12825 行。
- 当前防污染切片在首轮局部绿色后接受了独立攻击审计；发现的推荐回落、旧学习伪发布、Main 测试项目 /CDP 旁路、裸 G 集合碰撞和文件版本漂移均已根修。完成态审美复入资格已从主循环下沉到纯逻辑策略，要求产物闭合、`needs_review`、同 revision ReviewSet、完整可靠 Judge、无 blocker 与必需 E2 交付证据同时成立。限定复审已无 P0/P1，fresh 65 阶段 `maintenance:validate` 已通过，含作者权、业务边界、Final Comparison、Learning、Tool、Skill Package、Runtime、Run Ledger、调试信封、Agent 简化棘轮、Main /Renderer 类型检查、Agent /UXP 测试和 UXP production build。
- INTAKE-092 当前整合树的持久行为回归已覆盖空骨架 39 步、两张不同素材逐槽几何、非法 safeBox 写前拒绝、1200 转化槽、27 槽 120 步、显式低预算拒绝、固定 DSL /旧 State /关键词文案 /local recipe 不再补设计答案，以及完整单文档 11 组执行与 documentId、父子关系、根 /子组顺序、Background id /role /locked /层级的八类故障注入；fresh 65 阶段 `maintenance:validate` 已通过，独立复审确认测试实际经过 production validator 且无剩余 P0/P1。真实 Host Attempt 仍待执行，不能把自动绿色登记为实机或视觉质量通过。
- 当前增量已通过 Renderer 类型检查、设计作者权、Runtime 声明、Capability Resolver、Skill Package、业务边界与通用 executor 审计。新增正向行为测试调用真实 `mainImageExecutor`、真实冻结计划 /staging /external commit 链和文件探针完成一份 800 文档的 11 组、JPG /PSB 整组提交；同组负例证明 artifact、路径、lease、commit 与跨 executor 身份漂移零 Host 失败。随后一轮 fresh 65 阶段 `maintenance:validate` 通过，覆盖 Agent /UXP 测试、Main /Renderer 类型检查和 UXP production build。
- 主图开放创意生产现在以同一 Agent 的两段式 Skill 交付：prepare 只创建一个明确规格的工作文档和 11 个空组，签发不授权 Tool 的 TaskRun /project /创建收据 document /group /revision workspace；同一 TaskRun 的 Reflexion generation 可继续使用，换 sessionId 不可复用。中间设计完全使用通用 Photoshop Tool；finalize 只导出实时层级中真实非空且身份未漂移的标准组，并与 `asCopy` 可编辑稿走同一 staged transaction。行为回归证明非法 Task 身份在首次 Host 调用前停止，未修改、空组、错误 TaskRun、错误文档、被替换组和重复提交均不产生正式文件写入；跨 Skill 调用的成功路径只提交一个 Agent 实际填充组与对应 PSB。专项类型、作者权、Runtime、Skill /Capability、Tool、业务边界和通用 executor 审计及 fresh 65 阶段 `maintenance:validate` 均通过，代码已由 `293dd3df` 提交推送；fresh Photoshop Host 仍待验证。
- `69c54867` 与 `b4998b65` 各自在 fresh 工作树通过一轮完整 65 阶段 `maintenance:validate`，并已推送到 `legacy/codex/agent-uxp`。匹配构建分别生成 Agent /UXP production 产物；这证明 schema repair 和 Runtime identity 续跑边界未破坏核心回归，不证明专业设计质量。
- `36a1db51` 的 Manifest-bound Workflow receipt 增量通过 Runtime declaration、Capability、Agent 业务边界、Design Reliability、Renderer 类型检查及 fresh 65 阶段完整核心闸门。验证期间曾分别出现一次既有 SKU 姿态子进程 `3221225477` 和一次 Node/V8 原生崩溃；对应单项立即全通过，最终精确代码版本从头 65/65 通过，没有把原生崩溃删除或冒充产品失败。
- `b10da18a` 的模型可见面纵切实测把首轮 Tool 从 26 降到 24、序列化 schema 从 42,494 降到 29,154 字符；三项移出能力在一次按需 activation 中恢复为 `composeDesign / evaluateDesign / readSkillPlaybook`。设计作者权、Runtime declaration、Capability Resolver、Skill Package、Agent 业务边界、通用 executor、Tool /Skill 审计、Main /Renderer 类型检查及 fresh 65 阶段完整核心闸门通过。首次完整闸门曾由历史“必须恰好 26 个 Tool”断言失败；该断言没有改成 24，而是替换为原子能力、按需可达性和 30k schema 预算的行为契约，随后从头全绿。
- Run 665 根修增量已通过 fresh 65 阶段 `maintenance:validate`：主图模型 schema 约 11,007→2,857 字符，绑定后常驻方法上下文为 2,236 字符，pre-bound Tool schema 约 37,308→32,785；审计同时守护模型投影字段合法性、required 参数可见、prepare 不受伪造 support refs /active-document scope 影响、Runtime 技术字段剥离和基础归组能力可达。自动绿色不等于真实提速或视觉质量通过。
- D-131 礼貌只读委托与文本 Tool 协议增量已通过业务授权边界、简化棘轮（意图正则点保持 137）、Runtime declaration、设计作者权、Renderer 类型检查及 fresh 65 阶段 `maintenance:validate`；正常程序原句复测已真实读取并自然汇总 30 张项目 JPG、两个摄影子目录各 15 张，独立目录事实一致且内部协议泄漏为 0。
- D-132 句末边界、单图直接观察与重复像素复用已通过 Runtime declaration、Capability /Skill Package、业务授权、设计作者权、简化棘轮、Main /Renderer 类型检查及 fresh 65 阶段 `maintenance:validate`。自动验证证明“帮我设计一张商品主图。/！/成对引号”恢复唯一 advisory 主图候选，“你会做主图吗？”仍无生产候选；`describeImage` 由当前多模态 Agent 直接消费像素且内部模型调用为 0，`agent.ts` 仍为 12823 行、legacy 正则点仍为 137。正常程序主图复测尚未完成。
- 可逆负向探针已证明 CurrentTask / Plan / state ID 漂移和多个当前 H2 会直接失败，不再只产生 warning。
- S1 启动时的只读 Design Reliability preflight 可达 Debug Bridge、Photoshop MCP 与真实 UXP Runtime，但当前 Agent Runtime 提交、脏工作树、一次性 fixture、Debug 写授权和打开文档 ownership 尚未同时满足；因此 `readyForLiveCapture=false`，本轮没有启动 Photoshop 写入。

## 已核实（真实运行）

- 固定主图可靠性队列目前只有 r31 取得一份正式零人工技术通过样本；官方 5 Case 队列尚未覆盖完成，不能宣称稳定成功率。
- r31 的自动视觉结论为 `85 / needs_review`；r35 等运行暴露标题过重、文字错误和自动评分高估，专业商业质量尚未通过人工盲评。
- r37 / r38 在外部 dirty Photoshop 文档仍打开的条件下证明了对象级保护可以成立；两次运行仍分别暴露弃稿文档结算和最终 Artifact 引用问题。
- 多次真实运行证明 Agent 偶尔能说明选图和构图理由，但设计感知、创意方向与后续 Photoshop 参数之间缺少稳定中间表达，常出现连续 transform 搜索。
- r35 / r38 性能账本显示模型调用耗时分别约占墙钟 92.0% / 93.2%，普通 Agent 模型调用 35 / 29 次；11 次快照本身合计不足 1 秒，Final Judge 约 7–8 秒。当前优先归因高轮次、长输出与低增量视觉往返，不先删终审或降低 reasoning。
- 历史 run 602 的补充只读剖析显示 22 次模型调用约 604 秒、19 次 Tool 约 67 秒，历史消息从 16 字增长到约 15.9 万字；这是旧版本单例线索，不是当前固定 Case 基线，也不能单独证明应删除哪类上下文。
- `main-image-pink-coffee-unseen-v1` revision 4 曾有一轮 19 次模型调用、约 539 秒的技术交付样本；其源目录随后缺少 4 张冻结的已处理平铺图且旧 fixture 不在，因此当前已将 64 张现存输入冻结为 revision 5。旧样本不能冒充新 revision 基线。
- `main-image-pink-coffee-unseen-v1` revision 5 已完成一轮无人工纠正真实运行：Runtime 约 319 秒，12 次模型请求约占 93%，18 次 Tool 约占 7%；PSD/JPG 真实生成但 canonical 运行以 `error / artifact_incomplete / 0 of 16` 结束。首个绑定前 `composeDesign` 没有消费主图方法；最终质量链没有发起 `final_quality_judge`，而是错误启动普通恢复回合后遭遇 Provider capacity。
- revision 5 成品经真实像素对照只达到“主体完整、色调协调、结构可编辑”的制作底线；最终画面只保留四色平铺图并关闭模特场景，更像 SKU /目录展示，明显弱于用户 C-1256 主图与 Eagle 点击图参考。当前没有证据证明固定模板，较准确归因是 Agent 设计策略塌缩与 Evaluation 未闭合。
- 提交 `fc6781da` 后的正常程序新项目 Attempt 已真实完成 PSD/JPG 与 Final Judge：15 次模型调用、18 次 Tool、墙钟约 703 秒，模型耗时约 633 秒；Artifact 完成，Evaluation 为 `88 / needs_review`，含两个 major。成品是通用左图右文结构，仍明显低于用户成稿 /Eagle 参考。该运行调用了旧 `recommendAssets` 并选择 A01 /A02，证明重复选图至少受到检索诱导；不能只归因模型审美。
- 新普通项目 Run 663 使用自然短提示完成 53 次 Tool 和真实 PSD/JPG 交付，`placeImage` 条件参数已正常执行，质量终态为 `82 / needs_review`。它随后旁路 prepare /finalize，先提交 800 稿、再创建 1440 文档并把导出 JPG 重新置入，留下两套正式文件；最终 1440 可编辑稿的层级退化为 3 层。该样本证明 schema 修复有效，也证明真实生产 owner 尚未闭合。
- 同一会话 Run 664 只输入“继续”，Runtime 以 `structured_run_resume` 恢复 `ecommerce.main_image.v1`；16 次 Tool 全部成功，Agent 比较候选后自主换成完整穿着图，同版本 PSD/JPG 交付且所有外部 Photoshop 文档 revision 零变化，canonical 终态为 `completed / 89`。人工像素复核却确认它主要是优质摄影图的方形裁切和放大，鞋子过重、无点击主张和商业信息层级；该样本是续跑技术成功，也是 Evaluation 商业质量误放行，不能计为专业设计通过。
- Run 663 的固定开销已量化为首轮 26 Tool /42,521 schema 字符、后期 45 /65,705，System Prompt 峰值 21,473；31 次 Agent 回合约 197 万 input token，53 次 Tool 中 30 次观察、8 次控制且 Eagle 调用为 0。Run 664 首轮 System Prompt 27,705、Tool schema 50,640，11 次 Agent 回合约 67 万 input token，12 次观察与 4 次 mutation。它们证明当前复杂度已进入模型设计路径；`b10da18a` 只修模型可见首偏差，尚无新实机结果。
- 新普通项目 Run 665 使用自然短提示后，Agent 能说明“穿着场景主视觉、四色平铺辅助”的选择理由，却在约 15 分钟内没有产生内容写入。10 次模型调用累计约 1,176,756 ms，14 次 Tool 约 11,527 ms，9 次有 usage 的调用累计约 380,978 input token；前三次主图 Skill 调用被 prepare 阶段无关的 support refs /scope 拒绝，第四次才建成空工作文档。运行在取得明确停滞证据后停止。该样本证明 `b10da18a` 降低首轮 Tool 面仍不够，Skill schema 与常驻知识自身也在形成竞争式控制；它不证明模型没有设计判断，也不进入成功率分母。
- D-130 重测前的项目查看 Run 在约 4.4 秒内以 `success / final_response` 结束，但实际为 1 次模型调用、0 Tool、`toolSchemaChars=2`，并向用户显示 `<{"name":"list_directory",...}`。根因是“你可以帮我”礼貌委托被能力问句判据提前降为 `chat_only`，随后对话协议泄漏检测漏掉 angle-JSON 变体。该运行没有修改 Photoshop，但污染了对话，不能计为响应速度改善。
- D-131 通过后启动的主图诊断在约 245 秒按首偏差纪律停止：16 次模型调用约 235 秒、20 次 Tool 约 10 秒。Agent 已比较联系表并说明平铺 /模特角色，但没有绑定主图 Profile 或调用 `main-image-design`；它用 `openProjectFile` 尝试 JPG，随后在生产画布试放两张候选、重复截图、装载删除能力并清理试放层后才置入第三张。首个确定性根因是原样短提示末尾句号使 Skill recommendation 消失；该 Run 有局部进展但不属于 Skill 主图成功，也不进入 S1 分母。
- D-134（0888b25f）正常程序在全新一次性项目和干净新对话完成一次自然句实机复测：真实建档 1500×1500、置入模特图、色带加标题、保存 PSD 并导出 JPG，构图叙事可解释且按真实像素自我纠错，但全程未绑定 `ecommerce.main_image.v1`，终态 failed / needs_review，不进入 S1 分母。已验证：advisory 候选真实产出、引导块静态重放逐字节复现、上下文零裁剪、订阅通道透传逻辑无截断、declareDesignIntent 在 SDK 子进程 argv 白名单中实证可达。首偏差归因保持**待验证诊断**：组合后的实际系统提示未被运行实拍，且唯一候选以文本提示而非结构化选择手柄提供、绑定后旧候选提示缺一致移除边界，Harness 呈现方式与模型采纳可能共同作用。该模型经该通道 requestedThinking 恒为 disabled，与用户 thinking.enabled=true 偏好不符；D-133 之前的声明基线全部来自 deepseek-v4-flash-vision-exp，跨模型不可比。
- D-134 的 Final Judge 对成品返回完整中文评审散文（工艺分 7/10、三条具体问题、诚实未评价项）但无机读评分批次，协议以 score_batch_invalid 诚实失败、未补默认分；活动文档两次漂移到外部残留文档均被执行前守卫按设计中止，运行期间外部 Photoshop 文档集合确有变化（外部并发成立）。

## 当前未核实

- 5 Case 技术成功率、重复运行稳定性和恢复成功率。
- 主图、详情页、SKU 各自的多样本 Photoshop E2E 与可编辑交付稳定性。
- 无业务 Skill 的通用单画布设计能否稳定达到成熟设计师水平。
- 与 `D:\A1 neveralone旗舰店` 用户成稿及 Eagle 参考相比的非劣视觉质量。
- 自动 Evaluation 对裁切、图文关系、错字、光学平衡和商业完成度的可靠检出率。
- 在质量不退化前提下的速度、token 和观察次数改善。
- 修复后固定 Case 的 call-kind、上下文来源、输出体量和同 revision 重复视觉 presentation 分布。
- 中性候选和历史状态隔离已在 fresh 正常程序证明 Agent 可以比较并更换素材；主动参考、成熟创意、复杂分层与设计收益仍未核实。
- 主图 5+4 容器中哪些槽位必须填满、1200 转化图是否为必交物，以及最终平台上传尺寸；空骨架与当前 JSX 只能证明容器和逐非空组导出，不能证明这些业务取舍。
- `slotAssignments` 仍只是一素材一几何的确定性兼容入口；真实 Host 已证明 Agent 可以用通用 Tool 置入、变换、保存和导出，但也证伪其会自然采用 prepare /finalize。TaskRun-owned workspace 持久化、唯一 finalizer、复杂图层工艺与专业视觉质量仍未验证。

## 当前主要风险

1. Run 665 已证伪“只缩首轮 Tool 数量就足够”；0 Tool 项目查看 Run 又证伪“响应快就代表效率高”；最新主图 Run 则证伪“开发句去掉标点能路由就代表真实用户输入也能路由”。D-130 / D-132 仍需正常程序验证 Skill 绑定和设计结果，不能用 schema、单测或通用原子写入替代业务 Skill 成功。
2. Evaluation authority 已修复且故障不再转嫁主 Agent；自动高分漏检错字、标题重量、点击目标和商业完成度的校准仍未解决。
3. 图片内容被压缩成单主体 bbox、矩形目标区和粗锚点，不能完整表达负空间、保护部位、多主体和视觉重量。
4. `fitLayerSubjectToRegion` 的 `alignToReference` 尚未纳入统一事务，存在部分写入风险。
5. 历史 Markdown、旧命令和旧模型配置可能再次进入上下文并误导开发。
6. 已上传图片若没有请求级 `attachmentRef`，Agent 会把 Harness 输入断链误判成“文件不在项目”，产生无效搜索并把路径问题退回用户；直接开放任意 CLI 会扩大权限面但不证明同名文件身份。
7. 主图生产结构已从错误画布和固定方案中解耦，开放创意也不再受限于逐槽一素材一几何，但新的 prepare /finalize、整组 staging 事务与层级读回尚未经过 fresh Photoshop Host。每个实际素材的“模型确实观察过该版本”仍缺少逐对象视觉观察收据引用，不能把路径 /尺寸完整误当作模型已经看图。
8. 正常程序暴露的正式 completion owner 旁路已在代码层关闭，但通用 Tool 仍可能生成重复规格或低层数中间文件，且进程内 workspace 仍无法跨重启恢复。下一风险是恢复后如何只承接同一 TaskRun /Host 身份，而不是重新授予旧写入信用。
9. Evaluation 把摄影图裁切稿以 89 分判为通过，说明当前评分更擅长检查主体完整和基础协调，尚不能可靠区分“素材很好”与“设计增量足够”。在校准前，自动 pass 不能作为专业质量分子。

## 当前下一步

1. 构建包含 D-132 的正常程序，在现有普通测试项目的干净新对话原样重跑“帮我设计一张商品主图。”；记录 advisory 候选、Profile 绑定、首次 Skill prepare、单图直接观察、同像素复用、首个内容写入、参考选择、图层复杂度和真实视觉结果，不把通用原子写入或文件成功算成 Skill /质量改善。
2. 若精简方向得到运行证据，再把 prepare workspace 最小持久化到既有 TaskRun owner，并用进程重启、已消费 workspace、错误 TaskRun /project /document /group /revision 与 Host 漂移做故障注入。
3. 完成 reconciliation 后再购买可进入 S1 分母的普通项目 Case，并以用户成稿 /Eagle 参考校准 Evaluation 的商业质量误放行。
4. 在扩大 S1 队列前实现上传附件请求级来源绑定；通用 CLI 仍按独立 Capability Provider 阶段推进。
