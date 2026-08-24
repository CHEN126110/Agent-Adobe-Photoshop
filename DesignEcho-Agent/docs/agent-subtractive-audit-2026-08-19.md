# Agent 代码减法审计（2026-08-19）

> 用户原则：「对抗性修复」和「做减法」是同一个原则的两面——加补偿是承认缺陷并绕过它，减环节是让缺陷没有产生的余地。
>
> 判据：一段代码若存在的理由是「模型 / 上一层做错了，我在下游把它兜住 / 拦住 / 洗掉」，它就是补偿；减法要问的是「上游为什么会做错，能不能让那个错误没地方发生」。

审计范围：Agent 主链（`agent.ts` 13.7k 行、`autonomous-agent.executor.ts` 5.5k、`tool-executor.service.ts` 6.8k、`chat-response-cleaner.ts` 0.9k、`ChatPanel.tsx` 8.4k、`design-agent/engine.ts` 4k）与真实运行档案（08-14→08-19 共 71 次）。全仓 251k 行没有逐行读，未覆盖的部分在末尾列出。

## 一、全景数字（补偿层有多厚）

| 指标 | 数值 | 说明 |
|---|---|---|
| `fallback` / `Fallback` 命中 | 735 / 185（143 个文件） | 大多数是"主路径失败后换一条"的分支 |
| `legacy` / `Legacy` | 232 / 110（64 个文件） | 旧契约与新契约并存 |
| `降级` / `兜底` / `重试` | 146 / 75 / 230 | |
| 空 `catch {}`（吞错） | 212 处 | 其中 17 处直接 `return null/''/[]` |
| agent.ts 向模型压的控制消息（`createHarnessControlMessage`） | 35 处 | 每一处都是一句"纠偏指令" |
| agent.ts recovery / directive / nudge / blocker 方法 | 26 个 | 恢复机制本身成了子系统 |
| agent.ts 执行点拦截（`blockedTool:`，5 文件） | 20 处 | 每处一堵墙 |
| agent.ts 锁 / 计数状态字段 | 14 个 | `…WriteLocked / …Blocked / …Repeats / …StallCount` |
| 用户可见文本清洗判定函数（chat-response-cleaner） | 35 个，894 行 | 其中 15 个 `looksLike*/contains*` 判定 |
| 内部重试循环（agent.ts） | 10 处 | provider 截断恢复、最终答复重试、能力请求轮次… |

## 二、五个"加法叠加"热区（按减法收益排序）

### 热区 A：执行点门禁栈 —— 15 层守着同一扇门

`Agent.executeToolCall` 前后依次有：工作流续接权 → owner 重入 → repair 只读回 → 批内写锁 / 动作读回锁 / provider 恢复封锁 → 计划写入范围 allowlist → 只读缓存 → 性能预算（模型 / 工具 / 时间三维）→ 观察预留 → 简报门票 → 参考上下文门票 → 策略声明 → Runtime Session 阶段门 → 目标守卫 writer claim → 参考检索预算 → 同工具连败熔断。

**每一层都是某次事故后加的补偿**（注释里写着日期与病例）。真实运行里的死循环几乎全部来自"两层门禁互相矛盾"或"门禁说的出口不是它认的出口"（见 `gate-audit-2026-08-19`）。

减法方案（目标 3 层）：
1. **不可逆 / 安全**：破坏性动作确认、跨文档 / 版本目标守卫（保留，但报错必须点名出口工具，本轮已改）。
2. **预算**：只留"模型调用数 + 墙钟时间"一把尺；删工具调用预算、观察预留（后者已被并行会话降为提示）、参考检索预算。
3. **无进展停机**：一个检测器——连续 N 轮既无新的成功写入、又无新信息（同一工具同参数重复 / 同一评审首要问题重复）→ 停下如实说。用它替代：同工具连败熔断、`plan_execution_mismatch`、`no_progress`、动作计划回 R4、provider 恢复封锁。

不该保留的（开放创意任务上已由宪法关掉，SKU / 详情页清单仍在跑）：简报门票、参考上下文门票、策略声明、Runtime Session 阶段门、写入范围 allowlist。建议下一步让 SKU / 详情页也退出阶段机，改走"任务卡 + 车间"。

### 热区 B：Harness 对模型的"纠偏指令" —— 35 条控制消息、26 个恢复方法

形态：模型没按预期做 → Harness 压一条"请你先 X 再 Y"的消息 → 模型照做或再撞 → 再压一条。典型：`applyRequiredToolRecoveryDirective`（把 nextRequiredTool 翻译成单工具 allowlist，memory：`required-tool-allowlist-cage`）、`applyLoopGuardLivenessRecovery`、`applyRuntimeControlStageStallRecovery`、`buildZeroProgressContractRemediationDirective`、`applyInvalidHarnessControlRepairDirective`、`buildToolDecisionReplanDirective`……

它们补偿的是同一件事：**模型不知道该干什么**。减法不是删消息，是删"让模型不知道该干什么"的源头：把该做的事放进开工那一段（现在的三段：弄懂 → 规划 → 做与看）与工具结果里，而不是事后 26 种纠偏。

保留 4 类：① 目标守卫失败后的出口点名 ② 预算将尽的一次提醒 ③ 出稿评审结果 ④ 用户选项 / 确认的回执。其余逐个观察 3 次真机运行，没触发的删。

### 热区 C：用户可见文本清洗器 —— 35 个判定，洗两遍

`chat-response-cleaner.ts` 里 `looksLikeCannedCapabilityMenu / looksLikeFormulaicCapabilityExplainer / looksLikeCapabilityExecutionPromise / looksLikeMechanicalThinkingNarration / looksLikeEnglishDominantRuntimeMonologue / stripLeadingEnglishThinkingNarration / looksLikeConcreteProjectUnderstanding(例外的例外)` —— 全是硬编码正则匹配**某次真机模型的原话**（"我可以协助这些设计工作"、"会做。SKU 主要包括…"、"现在…调用…"）。这是最典型的对抗性修复：模型说了不该说的 → 在出口把它洗成空 → 用户看到"当前模型没有生成面向用户的判断"（比看到那句话更糟）。

**本轮已做**：思考通道只留三类真泄漏（工具标记 / 路由 JSON / 工程话术），去掉"机械叙述 / 英文独白 / 能力菜单 / 套话解释 / 能力承诺"五种"内容质量"过滤；正文通道去掉三种"能力菜单"过滤。上游对应的减法：系统提示里已有"像设计师说话，不讲工具"，够了。

### 热区 D：写后读回 / 验收 —— 同一件事三份账

- UXP 事务执行器：写前 / 写后各拍一次验收快照，返回 `status: verified`（Host 已证明）。
- Agent：`lockFollowingBatchWritesAfterRuntimeActionFailure` + `capturePhotoshopOperationReadbackRequirement` + `handlePendingRuntimeActionMutationReadback`（两次通用读回后永久封锁）。
- 完成契约 / 观察门：又数一遍"写后有没有看"。

真机 08-14/17：**成功**写入之后同批第二个写入被锁，报错却说"上一个动作失败"（08-18 后未再见）。减法：Host 的 `verified` 就是事实；`unknown` 时 Agent 只做一件事——下一轮只允许读、读到版本号后解锁并把"没确认"写进消息，不再永久封锁、不再"专用核对能力"。

### 热区 E：重复实现（同一件事两套代码）

| 重复 | 位置 | 减法 |
|---|---|---|
| 过程流两套渲染器 | 运行中 `ThinkingProcess`（时间线 + 快照）/ 历史 `ThinkingBlock`（编号列表，无快照） | 历史也用 `ThinkingProcess`（任务卡内已经这么做） |
| 意图分类三套正则 | routing / control-plane / engine（memory：`intent-stack-over-coupling`） | 交给模型（用户已拍板） |
| 设计说明两处展示 | 车间返回投影 + 模型自述 | 本轮已改成只在模型没说时补 |
| 任务卡打勾账本 | 已按项核对（本轮改） | — |
| 视觉观察三条路 | primary-self / visual-expert / no-capability，各自成段 | 主模型换能看图的模型后，删 visual-expert 整条路 |

### 热区 F：吞错 `catch {}` 212 处

抽样 30 处：约 2/3 是"可选增强失败不影响主路径"（读缓存、写学习候选、发遥测），可以接受；约 1/3 把**主路径**错误吞掉后继续（IPC 调用失败当作"没有结果"、JSON 解析失败当作"空"）——这些让"为什么没成"变成不可诊断。减法：主路径 catch 必须把错误写进结果的 `error` 字段（用户可诊断性原则），不许静默。

## 三、建议顺序（先删什么）

1. **门禁栈**：先合并"无进展停机"为一个检测器并删同工具连败熔断、`plan_execution_mismatch` 单独判停（它们都在停同一件事）；再删工具调用预算与参考检索预算。每删一层，用 `debug:runs` 对照前后 10 次真机运行的 stopReason 分布。
2. **纠偏指令**：给 26 个 recovery 方法加一次性计数（已有 issue 字段），跑 10 次真机，触发次数为 0 的直接删；触发的先看能不能并进开工那一段。
3. **清洗器**：本轮已减；下一步把 `conversational.ts` 里"识别套话 → 重问"的循环也删（把"别罗列能力菜单"写进对话提示即可）。
4. **读回锁**：以 Host `verified` 为唯一事实，删永久封锁分支。
5. **SKU / 详情页退出阶段机**：这是最大的一刀，也是热区 A/B 大部分代码的存在理由。

## 四、本轮已落地的减法

- 清洗器：思考通道去 5 种内容过滤、正文通道去 3 种能力菜单过滤（只留真泄漏）。
- 门禁：简报表单洁癖降为提醒；守卫报错点名出口；熔断器"前提变了给一次新机会"；能力装载失败说清 id；评审同一首要问题两次 → 提醒换方法。
- 车间：删掉摄影分支替模型排版的固定文字骨架。
- 界面：删"为什么这样设计"固定模块、删 Harness 状态口播垫底优先级。

## 五、没覆盖的

`mcp-host-service.ts`（4k）、`SettingsModal.tsx`（4k）、`sku-batch.executor.ts`（6.7k，并行会话在改）、`tool-acceptance.ts`（3.3k）、UXP 端 tools。这些按同样判据再过一遍。
