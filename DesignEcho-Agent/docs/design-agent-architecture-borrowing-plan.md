# DesignEcho Agent 架构借鉴与优化计划

## 目标

基于对 `C:\claude-code-haha` 的完整阅读，提炼出适合 `DesignEcho-Agent` 的架构借鉴点，用于增强：

- 设计意图理解
- 设计场景感知
- skills 调度与执行
- 工具体系一致性
- 多 Agent 执行稳定性

前提：

- 不照搬其 TUI / CLI 体系
- 不照搬其重型全局状态和桥接复杂度
- 不影响 SKU 当前链路

## 当前 DesignEcho 的核心问题

### 1. Engine 还没有独立成真正的系统核心

当前：

- `src\renderer\services\agent-orchestration\orchestrator.ts`
- `src\renderer\services\agent-orchestration\routing.ts`
- `src\renderer\services\agent-orchestration\task-classifier.ts`

共同承担了：

- 对话快速判断
- 模型判定
- skill 路由
- fallback
- 执行触发

这会导致：

- 规则越来越多
- 真正的回合生命周期没有统一入口
- 设计任务与普通聊天任务边界不清

### 2. Tool Registry、Tool Policy、Tool Runner 还混在一起

当前：

- `src\renderer\services\tool-executor.service.ts`

同时承担：

- 工具元数据
- alias
- timeout
- 资源型工具识别
- 执行逻辑

这会让工具系统越来越重，不利于 skill 化和 MCP 统一接入。

### 3. Design Skills 已经开始成型，但还缺统一的 Engine/Task 包装

当前已出现较好方向：

- `src\renderer\services\design-skills\detail-page-design.skill.ts`
- `src\renderer\services\design-skills\main-image-design.skill.ts`

但它们还没有建立在统一的：

- `DesignAgentEngine`
- `DesignTask`
- `ToolRegistry`

之上。

## 从 claude-code-haha 借鉴什么

## 一、借鉴 QueryEngine 思想，但不照搬其大文件

来源：

- `C:\claude-code-haha\src\QueryEngine.ts`
- `C:\claude-code-haha\src\query.ts`

可借鉴点：

- 一个共享 engine 管整条回合生命周期
- query loop 独立，不绑 UI
- 入口和执行核心分离

映射到 DesignEcho：

- 新增 `src\renderer\services\agent-engine\DesignAgentEngine.ts`
- 迁移 `processWithUnifiedAgent(...)` 主逻辑

目标：

- UI、MCP、后续 headless 都共用同一个 engine

## 二、借鉴 Task Framework，但做轻量版

来源：

- `C:\claude-code-haha\src\Task.ts`
- `C:\claude-code-haha\src\utils\task\framework.ts`

可借鉴点：

- 长任务有明确对象
- 任务状态、输出、生命周期标准化
- 子任务可组合

映射到 DesignEcho：

- 新增 `src\shared\tasks\design-task.ts`
- 新增 `src\renderer\services\tasks\design-task-framework.ts`

先覆盖：

- `detail-page-design`
- `main-image-design`
- `project-image-analysis`

不先碰 SKU。

## 三、借鉴 Tool Contract / Tool Pool，但拆轻，不做巨型接口

来源：

- `C:\claude-code-haha\src\Tool.ts`
- `C:\claude-code-haha\src\tools.ts`
- `C:\claude-code-haha\src\services\tools\toolOrchestration.ts`

可借鉴点：

- 工具声明与执行分离
- 工具聚合集中
- orchestration 与 executor 解耦

映射到 DesignEcho：

- 新增 `src\shared\tools\tool-registry.ts`
- 新增 `src\shared\tools\tool-policy.ts`
- 保留并瘦身 `src\renderer\services\tool-executor.service.ts`

拆分原则：

- `tool-registry.ts`：工具元数据、能力标签、参数描述、alias
- `tool-policy.ts`：timeout、风险等级、依赖、是否可自动调用
- `tool-executor.service.ts`：真正执行

## 四、借鉴 MCP 统一接入思路，但不搬重桥接

来源：

- `C:\claude-code-haha\src\services\mcp\client.ts`
- `C:\claude-code-haha\src\services\mcp\config.ts`

可借鉴点：

- MCP 作为工具提供者统一纳入 Tool Contract
- 连接管理和工具暴露分开

映射到 DesignEcho：

- 新增 `src\main\services\mcp\mcp-client.ts`
- 新增 `src\main\services\mcp\mcp-tool-adapter.ts`
- 瘦身 `src\main\services\mcp-host-service.ts`

目标：

- Photoshop MCP、后续设计类 MCP、OpenAI docs / image 等，都能走统一工具适配层

## 五、借鉴 Skills / Plugins 分层，但不做重插件市场

来源：

- `C:\claude-code-haha\src\skills\loadSkillsDir.ts`
- `C:\claude-code-haha\src\plugins\builtinPlugins.ts`
- `C:\claude-code-haha\src\utils\plugins\pluginLoader.ts`

可借鉴点：

- skill registry 独立
- 插件/skill 的声明和运行分开

映射到 DesignEcho：

- 新增 `src\shared\skills\skill-registry.ts`
- 让 `routing.ts` 不再直接掌握 skill alias / enabled / metadata

## 不该照搬什么

### 1. 巨大的全局状态

`claude-code-haha` 的重 `AppState` 不适合当前 DesignEcho。

我们当前：

- `src\renderer\stores\app.store.ts`

已经偏大，不应该再继续把 engine/task/tool 状态也全堆进去。

### 2. 巨大的入口和巨大的 Query 文件

`main.tsx` / `query.ts` 这类大文件不该成为我们目标。

目标应该是：

- 小 engine
- 小 task framework
- 小 tool registry
- 清晰 skill 边界

### 3. 重型插件/市场/bridge 体系

DesignEcho 是 Photoshop 设计 Agent，不需要这套复杂商业平台骨架。

## 对 DesignEcho 的直接优化清单

## 第一阶段：建立 Engine / Task / Registry 三件套

### A. DesignAgentEngine

新增：

- `src\renderer\services\agent-engine\DesignAgentEngine.ts`
- `src\renderer\services\agent-engine\processUserInput.ts`
- `src\renderer\services\agent-engine\turn-state.ts`

职责：

- 回合生命周期
- 输入理解
- 决策与执行分派
- tool budget / thinking / decision 跟踪

### B. DesignTask Framework

新增：

- `src\shared\tasks\design-task.ts`
- `src\renderer\services\tasks\design-task-framework.ts`

职责：

- 统一任务状态
- 统一输出结构
- 支持子任务

### C. Tool Registry

新增：

- `src\shared\tools\tool-registry.ts`
- `src\shared\tools\tool-policy.ts`

改造：

- `src\renderer\services\tool-executor.service.ts`
- `src\renderer\services\agent-runtime\tool-schemas.ts`

## 第二阶段：让 Design Skills 真正站到 Core 之上

继续推进：

- `detail-page-design.skill.ts`
- `main-image-design.skill.ts`

让它们建立在：

- `DesignScene`
- `SelectedDesignContext`
- `ToolRegistry`
- `DesignTask`

之上，而不是继续挂靠 executor 私有逻辑。

## 第三阶段：主图、详情页统一 scene core

当前已经有：

- `src\shared\types\design-core.types.ts`
- `src\shared\design-scene-graph.ts`
- `src\shared\design-selected-scene.ts`
- `src\shared\design-selected-design-context.ts`

下一步是让：

- detail-page
- main-image

都从 `scene core` 读关系和模块，而不是各自再做局部解释。

## 实施顺序

1. `DesignAgentEngine`
2. `DesignTask Framework`
3. `Tool Registry / Tool Policy`
4. `Skill Registry`
5. `MCP client + adapter`
6. 持续推进 detail-page / main-image skill 化

## 当前最值得立即做的第一步

先做：

- `DesignAgentEngine`

原因：

- 它能先把 `routing / task-classifier / orchestrator` 拉直
- 不会动 SKU
- 能给后面的 `ToolRegistry` 和 `DesignTask` 提供稳定入口

## 结论

对 DesignEcho 最有价值的借鉴不是“抄一个通用 Agent 项目”，而是借它的：

- engine
- task framework
- tool registry
- MCP 统一接入思想

再和我们自己的：

- Photoshop scene core
- design skills

结合起来。

最终目标不是做成另一个通用 Agent，而是做成：

**一个有设计理解内核的 Photoshop Design Agent。**
