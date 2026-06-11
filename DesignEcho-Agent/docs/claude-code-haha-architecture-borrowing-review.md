# 借鉴 `C:\claude-code-haha` 的智能体架构复盘

## 目的

不是照搬 `claude-code-haha`，而是回答三个问题：

1. 它的架构里哪些设计是成熟的，值得 DesignEcho 借鉴
2. 哪些部分和 DesignEcho 的 Photoshop / 设计场景不匹配，不该生搬硬套
3. 结合当前 DesignEcho 的代码，下一步最值得怎么改

---

## 结论先说

`claude-code-haha` 最值得借鉴的，不是它的 TUI，也不是 Anthropic 兼容接口，而是这几条结构化能力：

1. **QueryEngine 把“对话轮次、消息、工具、模型调用、会话状态”收成了单一主循环**
2. **Task 框架把异步任务、状态、输出、通知统一成了同一种对象**
3. **工具注册是中心化的，工具集合不是散落在各处拼出来的**
4. **多 Agent / swarm 是基础设施，不是某个业务功能里的特例**
5. **全局状态非常明确，哪些是 session 级，哪些是 turn 级，分得很清**

DesignEcho 现在的主要问题正好相反：

1. 路由、技能、执行三层还在互相渗透
2. Photoshop 场景理解还没有成为统一内核
3. detail-page / main-image 已经开始 skill 化，但共享的任务框架还不够强
4. 多 Agent 还更像“手段”，没有成为稳定的系统能力
5. 状态和上下文构建虽然已经开始统一，但还没有一个真正的主循环

因此，**最适合借鉴的不是界面形态，而是“主循环 + 任务框架 + 场景内核 + 技能边界”**。

---

## 对 `claude-code-haha` 的观察

### 1. 它有明确的 QueryEngine

关键文件：

- `C:\claude-code-haha\src\QueryEngine.ts`

这个类做的事情很清楚：

1. 一轮输入怎么进来
2. 会话消息怎么维护
3. tools / commands / agents / mcpClients 怎么组织
4. model query 怎么调用
5. permissions / hooks / session persistence 怎么串起来

这意味着：

- 它的“智能体运行循环”是明确的
- 很多能力不是散落在 UI 或命令侧，而是挂在统一引擎上

### 2. 它有明确的 Task 框架

关键文件：

- `C:\claude-code-haha\src\Task.ts`
- `C:\claude-code-haha\src\utils\task\framework.ts`

这里最值得借鉴的是：

1. 任务类型统一
2. 任务状态统一
3. 任务输出文件统一
4. 任务通知和淘汰机制统一

这让多 Agent、后台任务、工具执行、长耗时流程都能落在同一种框架里。

### 3. 它的工具系统是中心化的

关键文件：

- `C:\claude-code-haha\src\tools.ts`
- `C:\claude-code-haha\src\Tool.ts`

特点：

1. 工具注册中心化
2. 工具能力和可用性统一判断
3. feature flag / env gating 清楚
4. tools 不是每个业务链自己定义一套

### 4. 它把用户输入处理拆得很细

关键文件：

- `C:\claude-code-haha\src\utils\processUserInput\processUserInput.ts`

这里的重要点不是“函数多”，而是：

1. slash command
2. 普通 prompt
3. pasted content
4. hooks
5. attachments

这些都不是在主循环里硬塞 if/else，而是分成明确步骤。

### 5. 它把多 Agent 当成基础设施

关键文件：

- `C:\claude-code-haha\src\utils\swarm\spawnUtils.ts`
- `C:\claude-code-haha\src\utils\swarm\...`

它的做法值得借鉴的点是：

1. teammate/spawn 是标准能力
2. 会继承关键运行上下文
3. 后端方式可以变化，但调用语义稳定

---

## 当前 DesignEcho 的真实情况

关键文件：

- `C:\UXP\2.0\DesignEcho-Agent\src\renderer\services\agent-orchestration\orchestrator.ts`
- `C:\UXP\2.0\DesignEcho-Agent\src\renderer\services\agent-orchestration\routing.ts`
- `C:\UXP\2.0\DesignEcho-Agent\src\renderer\services\agent-orchestration\task-classifier.ts`
- `C:\UXP\2.0\DesignEcho-Agent\src\renderer\services\tool-executor.service.ts`
- `C:\UXP\2.0\DesignEcho-Agent\src\renderer\services\design-skills\detail-page-design.skill.ts`
- `C:\UXP\2.0\DesignEcho-Agent\src\renderer\services\design-skills\main-image-design.skill.ts`
- `C:\UXP\2.0\DesignEcho-Agent\src\shared\design-selected-design-context.ts`
- `C:\UXP\2.0\DesignEcho-Agent\src\shared\design-scene-graph.ts`

### 1. 优点

当前已经有这些正确方向：

1. 开始有 `scene core`
2. detail-page 已经开始 skill 化
3. main-image 也开始 skill 化
4. MCP 调试面很强
5. `selectedDesignContext` 已经开始统一

### 2. 主要结构问题

#### 问题 A：没有真正的 QueryEngine

现在主入口虽然有：

- `routing.ts`
- `task-classifier.ts`
- `orchestrator.ts`

但它们还更像“路由 + 决策分发”，而不是一个完整的 agent run loop。

缺的不是代码量，而是一个明确的主循环对象，统一维护：

1. 本轮上下文
2. turn state
3. selected design scene
4. skill plan
5. execution tasks
6. review/audit

#### 问题 B：任务框架还不够强

当前 detail-page / main-image 虽然在 skill 化，但长任务、后台任务、分阶段任务没有统一 task object。

这导致：

1. 进度呈现分散
2. 多 Agent 难稳定接入
3. 后台分析 / 批量审计不好管理
4. 任务恢复和追踪弱

#### 问题 C：工具注册还是偏“业务调用中心”

`tool-executor.service.ts` 现在既像：

1. 工具目录
2. 调用网关
3. 资源管理工具
4. 业务特例层

这会让系统长期越来越重。

#### 问题 D：路由仍然偏硬编码

`routing.ts` 当前仍然大量依赖：

1. regex pattern
2. deterministic route
3. skill hint

虽然已经比之前好，但这仍然意味着：

- “真实理解”还不是第一优先级
- 规则仍然在和模型争主导权

#### 问题 E：DesignScene 还是局部上下文，不是 session 级事实

当前已经有：

1. `selectedElementContext`
2. `selectedModuleContext`
3. `selectedDesignContext`
4. `selectedScene`

但它们主要还是“临时为当前动作构建”，而不是系统长期维护的一份场景事实。

---

## 哪些东西值得借鉴

### 1. 借鉴 QueryEngine，不借鉴 TUI

我们要借鉴的是：

1. 统一一轮对话/执行/复核的主循环
2. 输入处理和技能执行分开
3. 状态放在引擎里，不散在 UI 和 executor

不需要借鉴：

1. Ink/TUI
2. 命令式 CLI 入口
3. 终端交互组件

### 2. 借鉴 Task Framework

DesignEcho 最该借鉴的，是把这些东西统一成 task：

1. detail-page design run
2. main-image design run
3. project-image-analysis
4. scene inspection
5. MCP live audit
6. multi-agent research / planning

这样后续：

1. 进度条
2. thinking
3. 阶段耗时
4. 中间产物
5. 回滚/重试

才能有一致的落点。

### 3. 借鉴中心化工具注册

DesignEcho 已经有 `tool-schemas.ts`，但还不够。

应该进一步统一：

1. tool schema
2. capability tags
3. preflight rules
4. timeout policy
5. mcp exposure
6. skill-allowed tools

也就是不只是“有 schema”，而是有**完整的工具注册中心**。

### 4. 借鉴“spawn teammate 是基础设施”

当前 DesignEcho 里，多 Agent 还更像“我手动决定什么时候开子智能体”。

更好的方向是：

1. multi-agent 是标准执行策略
2. skill 可声明自己是否允许分解
3. 引擎统一管理：
   - 子任务
   - 上下文继承
   - 权限范围
   - 回收

### 5. 借鉴“输入处理分阶段”

现在 DesignEcho 的用户输入会很快进入：

1. routing
2. classifier
3. skill / autonomous agent

建议借鉴 `processUserInput.ts` 的思路，把输入处理分成：

1. 纯对话
2. design query
3. actionable design task
4. debug / inspect
5. attachments / selected scene enrichment

这样就不会再出现“用户问模型，你却去读 Photoshop 文档”这种体验问题。

---

## 哪些东西不该照搬

### 1. 不要照搬它的命令体系

`claude-code-haha` 的 slash command / CLI command 很重，适合通用代码 Agent，不适合 Photoshop 设计 Agent。

DesignEcho 更适合：

1. 自然语言任务
2. 选中元素上下文
3. MCP / UXP 工具
4. design skills

### 2. 不要照搬它的权限系统复杂度

它面向通用 shell / file / network agent，所以权限系统非常重。

DesignEcho 主要在：

1. Photoshop
2. 本地项目
3. 有限外部模型/API

这里可以借鉴结构，但不需要照搬复杂度。

### 3. 不要照搬它的全局状态规模

`bootstrap/state.ts` 承载了大量 session state，这在它那个系统里合理。

DesignEcho 更适合：

1. UI state
2. agent runtime state
3. design scene state
4. task state

分层清楚，而不是堆进一个超大 state。

---

## 最适合 DesignEcho 的目标架构

### 1. Agent Engine

新增一层真正的主循环：

- `DesignAgentEngine`

职责：

1. 接受用户输入
2. 处理输入类型
3. 拉取 selected scene / project context
4. 规划 skill run
5. 调 task framework
6. 汇总结果 / review / audit

### 2. Design Scene Core

继续把下面这些正式收成系统内核：

1. `DesignElement`
2. `DesignRelation`
3. `DesignModule`
4. `DesignScreen`
5. `DesignScene`

并且：

1. 不是临时构造
2. 而是每一轮先建立 scene，再给 skill 使用

### 3. Design Skills

skill 只负责：

1. 详情页怎么设计
2. 主图怎么设计
3. 参考图怎么迁移
4. 项目图片怎么分析

skill 不再负责：

1. Photoshop 原子动作
2. 低层状态读取
3. 零散 task 管理

### 4. Task Framework

建立统一的任务对象：

1. planning task
2. execution task
3. audit task
4. multi-agent task

### 5. Tool Registry

建立统一工具注册中心：

1. schema
2. preflight
3. timeout
4. capability tags
5. mcp exposure
6. allowed skill sets

---

## 推荐的实施顺序

### Phase 1：引擎成型

先做：

1. `DesignAgentEngine`
2. turn state
3. 输入处理分阶段
4. skill 运行入口统一

### Phase 2：任务框架

再做：

1. `DesignTask`
2. task status
3. task result
4. task output / audit attachment

### Phase 3：工具中心化

把现在散在：

1. `tool-executor.service.ts`
2. `tool-schemas.ts`
3. MCP host policy

里的能力整成统一 registry。

### Phase 4：多 Agent 基础设施化

不是“需要时手工开子智能体”，而是：

1. skill 声明可否分解
2. engine 决定是否开 teammate
3. task framework 接管生命周期

### Phase 5：主图 / 详情页彻底 skill 化

detail-page 和 main-image 已经开始拆了，这一步是顺势推进，不要回头再堆 executor。

---

## 直接可执行的借鉴清单

### 借鉴项 1

新增：

- `src/renderer/services/agent-engine/design-agent-engine.ts`

不要再让 `orchestrator.ts` 同时承担：

1. 轻量路由
2. 模型分类
3. skill 分发
4. autonomous fallback

### 借鉴项 2

新增：

- `src/shared/tasks/design-task.types.ts`
- `src/renderer/services/tasks/design-task-runtime.ts`

先把 detail-page / main-image / project-image-analysis 统一成 task。

### 借鉴项 3

把 `tool-executor.service.ts` 拆成：

1. `tool-registry.ts`
2. `tool-runner.ts`
3. `tool-policy.ts`

### 借鉴项 4

把 `selectedDesignContext` 的构建正式纳入每轮运行，而不是让每个 skill 按需拉。

### 借鉴项 5

建立 `skill execution contract`：

每个 skill 固定输出：

1. `plan`
2. `executionTasks`
3. `auditTasks`
4. `summary`

---

## 最后的判断

对 DesignEcho 来说，`claude-code-haha` 最有价值的不是“它是 Claude Code”，而是：

**它把一个复杂智能体系统做成了明确的主循环、任务框架、工具注册和多 Agent 基础设施。**

DesignEcho 当前最该借鉴的正是这四件事。

而不该照搬的，是它的：

1. TUI
2. 命令系统
3. 终端导向权限复杂度

因此，下一步最合理的不是继续堆 detail-page 功能，而是：

1. 做 `DesignAgentEngine`
2. 做 `DesignTask Framework`
3. 做 `Tool Registry`
4. 再继续推进 detail-page / main-image 的 skill 化

