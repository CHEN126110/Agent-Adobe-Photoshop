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

## 当前未核实

- 5 Case 技术成功率、重复运行稳定性和恢复成功率。
- 主图、详情页、SKU 各自的多样本 Photoshop E2E 与可编辑交付稳定性。
- 无业务 Skill 的通用单画布设计能否稳定达到成熟设计师水平。
- 与 `D:\A1 neveralone旗舰店` 用户成稿及 Eagle 参考相比的非劣视觉质量。
- 自动 Evaluation 对裁切、图文关系、错字、光学平衡和商业完成度的可靠检出率。
- 在质量不退化前提下的速度、token 和观察次数改善。
- 修复后固定 Case 的 call-kind、上下文来源、输出体量和同 revision 重复视觉 presentation 分布。
- 中性候选、历史状态隔离、学习发布防火墙与诚实质量终态在 fresh 正常程序中的真实行为和设计收益。
- 主图 5+4 容器中哪些槽位必须填满、1200 转化图是否为必交物，以及最终平台上传尺寸；空骨架与当前 JSX 只能证明容器和逐非空组导出，不能证明这些业务取舍。
- `slotAssignments` 仍只是一素材一几何的确定性兼容入口；开放创意的 prepare /Agent 通用 Tool /finalize 已实现并通过模拟 Host 行为回归，但真实 Host 能力、Agent 是否主动采用、复杂图层工艺与视觉质量尚未验证。

## 当前主要风险

1. 当前防污染根修已通过完整核心闸门，但尚无 fresh 正常程序 Attempt；自动检查只能证明旧旁路关闭，不能证明选图或设计质量已经改善。
2. Evaluation authority 已修复且故障不再转嫁主 Agent；自动高分漏检错字、标题重量、点击目标和商业完成度的校准仍未解决。
3. 图片内容被压缩成单主体 bbox、矩形目标区和粗锚点，不能完整表达负空间、保护部位、多主体和视觉重量。
4. `fitLayerSubjectToRegion` 的 `alignToReference` 尚未纳入统一事务，存在部分写入风险。
5. 历史 Markdown、旧命令和旧模型配置可能再次进入上下文并误导开发。
6. 已上传图片若没有请求级 `attachmentRef`，Agent 会把 Harness 输入断链误判成“文件不在项目”，产生无效搜索并把路径问题退回用户；直接开放任意 CLI 会扩大权限面但不证明同名文件身份。
7. 主图生产结构已从错误画布和固定方案中解耦，开放创意也不再受限于逐槽一素材一几何，但新的 prepare /finalize、整组 staging 事务与层级读回尚未经过 fresh Photoshop Host。每个实际素材的“模型确实观察过该版本”仍缺少逐对象视觉观察收据引用，不能把路径 /尺寸完整误当作模型已经看图。

## 当前下一步

1. `293dd3df` 已提交推送且未包含用户 3 个 UI 文件；在正常程序的新普通项目中验证同一 Agent 能否主动采用 prepare /通用 Tool /finalize，并用真实 Photoshop 读回证明复杂分层、非空组导出、活动文档路径不被 staging 改绑和外部文档零变化。
2. 用自然短提示核对候选覆盖、选图说明、参考取舍、分层设计、真实 5+4 Photoshop 层级、保画布导出、诚实 Final Judge 和外部文档零变化；不使用 fake /Debug fixture 或用户参考项目作为 active test project。
3. 只有取得新样本后才选择一个设计质量变量；若仍退化为相同安全构图，优先证伪 Agent 设计认知 /参考信息增益或 Evaluation 检出，不恢复推荐排序、固定 Eagle 步骤或品类 Prompt。
4. 在扩大 S1 队列前实现并验证上传附件的请求级来源绑定；之后再按只读观察、受控文件、受控命令、桌面输入顺序建设通用 CLI 能力。
