# `claude-code-haha` 全仓架构研究与对 DesignEcho 的借鉴结论

## 目的

这份文档不是为了照搬 `C:\claude-code-haha`。

目的是回答四个更实际的问题：

1. 它的架构里，哪些部分真的成熟，值得借给 DesignEcho。
2. 哪些部分只是终端产品、远端控制、插件生态带来的复杂度，不该带进来。
3. 哪些问题 DesignEcho 当前已经开始碰到了，如果不收口，会走到和它一样重。
4. 对 DesignEcho，下一步最应该落什么，不该落什么。

---

## 可靠性说明

这次不是只看几份入口文件。

### 本地直接阅读覆盖

已直接阅读的主干实现包括：

- `C:\claude-code-haha\src\entrypoints\cli.tsx`
- `C:\claude-code-haha\src\entrypoints\init.ts`
- `C:\claude-code-haha\src\main.tsx`
- `C:\claude-code-haha\src\query.ts`
- `C:\claude-code-haha\src\QueryEngine.ts`
- `C:\claude-code-haha\src\context.ts`
- `C:\claude-code-haha\src\Tool.ts`
- `C:\claude-code-haha\src\tools.ts`
- `C:\claude-code-haha\src\Task.ts`
- `C:\claude-code-haha\src\commands.ts`
- `C:\claude-code-haha\src\skills\loadSkillsDir.ts`
- `C:\claude-code-haha\src\skills\bundledSkills.ts`
- `C:\claude-code-haha\src\plugins\builtinPlugins.ts`
- `C:\claude-code-haha\src\services\mcp\client.ts`
- `C:\claude-code-haha\src\services\mcp\config.ts`
- `C:\claude-code-haha\src\services\tools\toolOrchestration.ts`
- `C:\claude-code-haha\src\services\tools\StreamingToolExecutor.ts`
- `C:\claude-code-haha\src\bootstrap\state.ts`
- `C:\claude-code-haha\src\state\AppStateStore.ts`
- `C:\claude-code-haha\src\state\store.ts`
- `C:\claude-code-haha\src\state\onChangeAppState.ts`
- `C:\claude-code-haha\src\utils\processUserInput\processUserInput.ts`
- `C:\claude-code-haha\src\utils\task\framework.ts`
- `C:\claude-code-haha\src\utils\plugins\pluginLoader.ts`
- `C:\claude-code-haha\src\utils\sessionStorage.ts`
- `C:\claude-code-haha\src\utils\swarm\spawnUtils.ts`
- `C:\claude-code-haha\src\utils\swarm\reconnection.ts`
- `C:\claude-code-haha\src\tasks\LocalAgentTask\LocalAgentTask.tsx`
- `C:\claude-code-haha\src\tasks\InProcessTeammateTask\InProcessTeammateTask.tsx`

### 并行子智能体补读覆盖

子智能体分别对下面四块做了独立阅读并回传结论：

1. 主循环、入口、query 生命周期
2. tools / MCP / bridge / permission
3. tasks / swarm / session restore / teammate
4. commands / skills / plugins / settings，以及哪些复杂度不该带进 DesignEcho

所以这份结论是：

- 本地主干阅读
- 子智能体分区细读
- 再回到 DesignEcho 对照

三层合并后的结果。

---

## 仓库整体形状

`src` 目录中文件数最多的区域：

| 区域 | 文件数 |
|---|---:|
| `utils` | 566 |
| `components` | 389 |
| `commands` | 207 |
| `tools` | 187 |
| `services` | 130 |
| `hooks` | 104 |
| `ink` | 96 |
| `bridge` | 31 |
| `skills` | 23 |
| `tasks` | 12 |
| `state` | 6 |
| `query` | 4 |
| `plugins` | 2 |

先看这个分布就能知道：

1. 它是一个很重的终端产品，不只是一个“agent loop”。
2. 它真正成熟的地方，是运行时核心、任务、多 Agent、工具/MCP。
3. 很多复杂度来自产品形态，不适合原封不动带进 DesignEcho。

---

## 一、主循环与入口

### 它怎么组织

`claude-code-haha` 的入口不是一个文件。

它分成三层：

1. **入口分流**
   - `C:\claude-code-haha\src\entrypoints\cli.tsx`
   - 做 fast-path 和动态导入

2. **启动前置**
   - `C:\claude-code-haha\src\entrypoints\init.ts`
   - 做配置、环境、证书、代理、graceful shutdown、scratchpad、预热

3. **主装配**
   - `C:\claude-code-haha\src\main.tsx`
   - 决定 interactive / headless / remote / daemon 等模式
   - 组装 commands / tools / MCP / state

真正的 **agentic query loop** 不是在这些入口里。

它在：

- `C:\claude-code-haha\src\query.ts`
- `C:\claude-code-haha\src\QueryEngine.ts`

### 最值得借鉴的点

1. **入口分流和核心循环分开**
2. **UI 不拥有主循环**
3. **headless/SDK 不是另一套核心逻辑，而是共享同一个 query kernel**

### 不该照搬的点

1. `main.tsx` 已经是典型 god file
2. 过多模式分支深嵌入口
3. 一些启动预热、模式开关、产品分支都挤在入口层

### 对 DesignEcho 的映射

DesignEcho 不该继续让：

- `routing.ts`
- `task-classifier.ts`
- `orchestrator.ts`
- UI 触发逻辑
- executor 特例

一起拼成“伪主循环”。

它需要的是：

### `DesignAgentEngine`

职责只做：

1. 接收一轮请求
2. 构建本轮 scene / context
3. 选择 skill
4. 执行 task pipeline
5. 产生结构化事件流
6. 驱动 review / audit / summary

---

## 二、一次 query 的状态流

### 它怎么跑一轮

在 REPL 模式下，用户输入会统一走：

- `C:\claude-code-haha\src\utils\handlePromptSubmit.ts`
- `C:\claude-code-haha\src\utils\processUserInput\processUserInput.ts`

然后进入：

- `C:\claude-code-haha\src\query.ts`

`query.ts` 维护一份显式 loop state：

- `messages`
- `toolUseContext`
- compact/retry
- stopHook
- tokenBudget
- turnCount
- transition

这意味着它不是“消息来了就走 if/else”，而是一个明确状态机。

### 最值得借鉴的点

1. **直接输入和排队输入走同一条路径**
2. **输入处理和 query loop 分开**
3. **主循环维护显式状态，而不是散在 UI 组件和执行器里**
4. **query 输出本质上是事件流**

### 不该照搬的点

1. `query.ts` 现在已经承担太多职责：
   - compact
   - retry
   - tool orchestration
   - memory
   - hook
   - token budget
2. 这种文件规模不适合 DesignEcho 再复制一份

### 对 DesignEcho 的映射

DesignEcho 可以借鉴它的结构，但要更克制：

### `DesignAgentEngine` 内只保留 6 个阶段

1. `intent`
2. `scene`
3. `plan`
4. `execute`
5. `audit`
6. `respond`

不要把：

- Photoshop bridge
- MCP 连接管理
- settings
- view state

直接塞进主循环。

---

## 三、工具系统、MCP 与桥接

### 它怎么组织

最底层工具契约在：

- `C:\claude-code-haha\src\Tool.ts`

工具池装配在：

- `C:\claude-code-haha\src\tools.ts`

执行入口在：

- `C:\claude-code-haha\src\services\tools\toolOrchestration.ts`
- `C:\claude-code-haha\src\services\tools\toolExecution.ts`
- `C:\claude-code-haha\src\services\tools\StreamingToolExecutor.ts`

MCP 主接入在：

- `C:\claude-code-haha\src\services\mcp\client.ts`
- `C:\claude-code-haha\src\services\mcp\config.ts`

关键点是：

1. built-in tools 是单一来源
2. MCP tools 会被适配成同一套 Tool 对象
3. 工具池在进入模型前就统一装配
4. deny-rule 可以在注册前直接把工具从 prompt 可见集合中移除

### 最值得借鉴的点

1. **统一 tool contract**
2. **唯一 tool pool assembler**
3. **连接管理和工具执行分开**
4. **显式优先级和去重规则**

### 不该照搬的点

1. `Tool` 接口过大，执行/展示/MCP/UI 元数据全揉在一起
2. 完整 bridge 太重
3. channel permission / remote control 的信任域复杂度过高
4. 大量 feature gate 是产品历史，不是好架构本身

### 对 DesignEcho 的映射

DesignEcho 需要的是：

### 1. 轻量 `ExecutableTool` 契约

只保留：

- `id`
- `kind`
- `inputSchema`
- `run()`
- `policyTags`
- `capabilities`

### 2. 单一 Tool Registry

替代继续膨胀的：

- `tool-executor.service.ts`

应该拆成：

- `tool-registry`
- `tool-runner`
- `tool-policy`
- `tool-adapters/mcp`

### 3. 桥接方案优先用轻量 direct-connect

如果 DesignEcho 只是：

- 自家桌面端
- 自家后台工具
- Photoshop/UXP/MCP 桥接

那就不要引入完整 remote bridge 复杂度。

---

## 四、Task Framework 与多 Agent

### 它怎么组织

这里最容易被误读。

它实际上有 **两层 task**：

1. **运行态 task**
   - `Task.ts`
   - `tasks/*`
   - `utils/task/framework.ts`

2. **持久化协作任务清单**
   - `utils/tasks.ts`

也就是说：

- 真正运行的 local shell / local agent / remote agent / in-process teammate
  是一层
- 跨 agent 共享的任务队列和 owner/blocking/highwatermark
  是另一层

这是一个非常值得借鉴的点。

多 Agent 的核心不在 `buddy`。

核心在：

- `utils/swarm/*`
- `tasks/InProcessTeammateTask/*`
- `tasks/LocalAgentTask/*`
- `coordinator/coordinatorMode.ts`

特别值得读的是：

- `spawnInProcess.ts`
- `inProcessRunner.ts`
- `leaderPermissionBridge.ts`
- `permissionSync.ts`
- `reconnection.ts`

### 最值得借鉴的点

1. **运行态 task 与持久化 work item 分开**
2. **mailbox 协议优于共享内存状态**
3. **backend-neutral teammate executor**
4. **worker 生命周期 abort 和当前回合 abort 分开**
5. **transcript/output/metadata sidecar 化**

### 不该照搬的点

1. 两套 `Task` 同名但语义不同，认知成本高
2. `AppStateStore.ts` 仍然太大
3. `LocalAgentTask` / `RemoteAgentTask` / `inProcessRunner` 已经偏单体
4. 权限同步存在新旧双通道迁移债

### 对 DesignEcho 的映射

DesignEcho 很适合借鉴，但必须重新命名并简化：

### 运行态任务

- `DesignRunTask`
- `SceneAuditTask`
- `SubagentTask`
- `PhotoshopExecutionTask`

### 持久化任务

- `DesignWorkItem`
- `ReviewItem`
- `DeferredExportJob`

不要继续让：

- 详情页执行
- 主图执行
- MCP 分析
- 子智能体研究

全靠一坨 runtime state 临时拼起来。

---

## 五、Commands、Skills、Plugins、Settings

### 它怎么组织

它不是把 slash command、skill、plugin command 分成三套平行系统。

它会统一收成 `Command` 模型：

- `C:\claude-code-haha\src\types\command.ts`
- `C:\claude-code-haha\src\commands.ts`

skill 来源包括：

1. 文件系统 skills
   - `src/skills/loadSkillsDir.ts`
2. bundled skills
   - `src/skills/bundledSkills.ts`
3. built-in plugin skills
   - `src/plugins/builtinPlugins.ts`
4. plugin commands / plugin skills
   - `src/utils/plugins/loadPluginCommands.ts`

### 最值得借鉴的点

1. **commands / skills / plugin skills 统一到同一注册模型**
2. **skill frontmatter 元数据比较完整**
3. **builtin / plugin / external 来源清楚**

### 不该照搬的点

1. 整套 marketplace / plugin cache / dependency resolver 过重
2. 老 `commands` 与新 `skills` 双轨兼容的历史包袱不该再复制
3. settings 多来源系统太复杂：
   - file
   - project
   - policy
   - remote managed
   - plugin base

### 对 DesignEcho 的映射

这是当前最值得直接借的一块：

### 统一 `DesignCommand / DesignSkill` 注册模型

把现在分散在：

- routing
- design skills
- MCP prompts
- 局部 UI actions

里的能力统一收成一份 registry。

但不要引入完整 plugin 市场。

DesignEcho 当前阶段只需要：

1. 内置 skill
2. 项目级 skill
3. 本地插件级 skill

三层足够。

---

## 六、状态层

### 它怎么组织

它有两套状态：

1. `bootstrap/state.ts`
   - 会话级、进程级、全局可变状态

2. `state/AppStateStore.ts`
   - UI 和运行时组合态

这种做法的优点是：

- 很多地方调用方便

缺点也很明显：

- 很容易变成跨层总线
- 依赖难收口
- 测试和迁移越来越脆

### 对 DesignEcho 的结论

这里要借鉴的是：

1. selector 式订阅
2. store 与 onChange 分离

不该借鉴的是：

1. 巨型单 store
2. 巨型 bootstrap singleton
3. UI、运行态、远端桥、插件、权限都塞一起

DesignEcho 当前已经有这个苗头：

- `C:\UXP\2.0\DesignEcho-Agent\src\renderer\stores\app.store.ts`

这条线必须尽早收，不然会走到和 `AppStateStore.ts` 一样重。

---

## 对 DesignEcho 的最终结论

`claude-code-haha` 最值得借的，不是“功能更多”，而是它清楚地把系统拆成了这些层：

1. **入口 / 模式装配**
2. **查询主循环**
3. **工具契约与工具池**
4. **任务框架**
5. **多 Agent 基础设施**
6. **命令 / skill 注册模型**

而 DesignEcho 当前最需要的，正好也是这些层。

但不能照搬它的产品复杂度。

---

## 对 DesignEcho 的落地建议

### 第一批：必须先做

1. **`DesignAgentEngine`**
   - 统一 request pipeline
   - 统一事件流
   - UI/headless 共用同一核心

2. **轻量 Tool Registry**
   - built-in / MCP / internal adapters 统一装配
   - 拆掉继续膨胀的 `tool-executor.service.ts`

3. **显式 DesignTask Framework**
   - 运行态 task
   - 持久化 work item
   - 两层分开

### 第二批：建立设计理解内核

1. `DesignElement`
2. `DesignRelation`
3. `DesignModule`
4. `DesignScreen`
5. `DesignScene`

以及：

- `selectedDesignContext`
- `selectedScene`

从“局部包装层”提升成真正的 core。

### 第三批：业务 skill 建立在 core 上

1. `detail-page-design`
2. `main-image-design`
3. `reference-to-design`
4. `design-review`

SKU 先不动。

---

## 不该做的事

1. 不要复制巨型 `main.tsx`
2. 不要复制巨型 `query.ts`
3. 不要复制完整 bridge
4. 不要复制完整 plugin marketplace
5. 不要继续把 DesignEcho 的状态、设置、工具、UI、桥接全堆进一个 store
6. 不要用兜底链掩盖边界问题
7. 不要忽略源码里的中文编码污染继续重构

---

## 一句话结论

如果只看表面，`claude-code-haha` 像是一个很重的终端产品。

但对 DesignEcho 真正有价值的，是它已经把下面这些东西做成了基础设施：

- 主循环
- 工具契约
- task framework
- multi-agent infrastructure
- command/skill registry

DesignEcho 现在最该借的就是这些“骨架”，而不是它的产品体积。
