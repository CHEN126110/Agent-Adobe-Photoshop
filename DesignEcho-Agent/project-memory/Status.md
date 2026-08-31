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

## 已核实（构建与自动检查）

- 整理前最近记录的代码切片曾通过 65 阶段核心验证、Agent / UXP production build 和相关专项审计；这只证明当时提交的工程边界，不证明当前文档改动或真实设计质量。
- 本轮整理开始前 `maintenance:planning-check` 与入口文档同步审计退出 0，但前者同时暴露 CurrentTask 与 project-state ID 漂移；因此旧“绿色”不能作为语义一致性证明。
- 本轮文档改动后的 `maintenance:planning-check`、入口文档审计、编码、仓库卫生、变更边界、Skill /门禁专项及完整 `maintenance:validate` 均通过；核心回归为 65 项，并包含 Agent 类型检查、UXP 测试与 production build。
- S1 交付 /评审根因代码纵切新增后，再次完成一轮 65 阶段 `maintenance:validate`；专项覆盖真实 DeepSeek `chatWithTools(..., tools=[])` 图片出站、OpenAI-compatible receipt、全画布 Final Judge binding、r38 形态 PSD/JPG E2 refs、Evaluation 非法输出和 advisory authority。
- INTAKE-090 性能归因纵切已通过一轮 fresh 65 阶段完整 `maintenance:validate`，其中包含 Runtime ledger、ContextManager、设计作者权与业务边界、Agent 简化棘轮、Renderer/Main 类型检查、Agent/UXP 测试和 UXP production build；尚无 fixed Case 新样本，因此不能把工程绿色表述为已经提速。
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

## 当前未核实

- 5 Case 技术成功率、重复运行稳定性和恢复成功率。
- 主图、详情页、SKU 各自的多样本 Photoshop E2E 与可编辑交付稳定性。
- 无业务 Skill 的通用单画布设计能否稳定达到成熟设计师水平。
- 与 `D:\A1 neveralone旗舰店` 用户成稿及 Eagle 参考相比的非劣视觉质量。
- 自动 Evaluation 对裁切、图文关系、错字、光学平衡和商业完成度的可靠检出率。
- 在质量不退化前提下的速度、token 和观察次数改善。
- 修复后固定 Case 的 call-kind、上下文来源、输出体量和同 revision 重复视觉 presentation 分布。

## 当前主要风险

1. `finalArtifactRefs` 的代码级首个偏差已修复，但尚无当前提交的 fresh 真实 sidecar Attempt，运行态闭环仍未核实。
2. `evaluateDesign` 的协议与 authority 已修复；自动高分漏检错字、标题重量和商业完成度的校准仍未解决。
3. 图片内容被压缩成单主体 bbox、矩形目标区和粗锚点，不能完整表达负空间、保护部位、多主体和视觉重量。
4. `fitLayerSubjectToRegion` 的 `alignToReference` 尚未纳入统一事务，存在部分写入风险。
5. 历史 Markdown、旧命令和旧模型配置可能再次进入上下文并误导开发。

## 当前下一步

1. 当前 `S1-DELIVERY-REVIEW-ROOT-CAUSE-001` 的代码根因与核心验证已闭合，先提交可回滚基线；fresh Photoshop Attempt 仍是退出条件。
2. INTAKE-090 observation-only 归因与视觉恢复修复已通过完整核心验证；提交该可回滚基线后固定同一 Case 跑一次。只有取得新样本后才选择一个可逆优化变量，不用删必要观察、降 reasoning 或缩短到无法完成的预算换取表面速度。
3. 新提交与 Agent / UXP 构建身份一致、一次性 fixture 和写授权都就绪后，运行首轮隔离实机 Case；只有同时取得真实交付引用和外部文档零变化，才启动 S1 固定 5 Case × 2 次正式队列。
