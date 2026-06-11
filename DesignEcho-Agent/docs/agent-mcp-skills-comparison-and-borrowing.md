# DesignEcho 与 `claude-code-haha` 在 Agent / MCP / Skills 上的对照与借鉴

## 目标

这份文档只回答三个问题：

1. `claude-code-haha` 在 Agent、MCP、skills 上真正成熟的能力是什么。
2. DesignEcho 当前哪些地方可以直接借鉴，哪些地方绝对不该照搬。
3. 接下来应该按什么顺序改 DesignEcho，才能更适合“做设计”，而不是继续堆业务逻辑。

---

## 结论先说

对 DesignEcho 最有价值的，不是照搬 `claude-code-haha` 的产品形态，而是借它的三层结构：

1. **共享 Agent Engine**
2. **中心化 Tool/MCP Registry**
3. **元数据驱动的 Skills 边界**

不该照搬的是：

1. 巨大的入口和全局状态
2. 很重的 bridge / remote-control / daemon 体系
3. 过度复杂的插件市场和自动更新系统
4. 大而全的命令系统

DesignEcho 是 Photoshop 设计 Agent，不是终端型通用 Agent。

所以我们要借的是“架构骨架”，不是“产品壳”。

---

## 一、Agent：两边的真正差异

### `claude-code-haha` 已有的能力

核心文件：

- `C:\claude-code-haha\src\QueryEngine.ts`
- `C:\claude-code-haha\src\query.ts`
- `C:\claude-code-haha\src\utils\processUserInput\processUserInput.ts`
- `C:\claude-code-haha\src\commands.ts`
- `C:\claude-code-haha\src\tools\AgentTool\runAgent.ts`

它最成熟的点不是“回答问题更聪明”，而是：

1. **主循环是独立引擎**
   - query loop 不绑在 UI 上
   - 输入、工具调用、压缩、续跑都走同一条核

2. **输入处理是统一管线**
   - 用户输入、命令、技能、附件，都先经过统一处理
   - 再决定是否进主循环

3. **子 Agent 是系统能力**
   - 不是某个业务里临时做一个“分身”
   - 而是标准运行路径

4. **任务是标准对象**
   - 有状态
   - 有生命周期
   - 有结果与通知

### DesignEcho 当前状态

当前主要在：

- `C:\UXP\2.0\DesignEcho-Agent\src\renderer\services\agent-orchestration\orchestrator.ts`
- `C:\UXP\2.0\DesignEcho-Agent\src\renderer\services\agent-orchestration\routing.ts`
- `C:\UXP\2.0\DesignEcho-Agent\src\renderer\services\agent-orchestration\task-classifier.ts`
- `C:\UXP\2.0\DesignEcho-Agent\src\renderer\services\agent-runtime\agent.ts`
- `C:\UXP\2.0\DesignEcho-Agent\src\renderer\services\skill-executors\autonomous-agent.executor.ts`

现在的问题是：

1. `orchestrator` 既做路由，又做执行选择
2. `routing` 和 `task-classifier` 有重叠
3. `autonomous-agent.executor` 和主引擎边界不够清楚
4. 多 Agent 已经能用，但还不是正式基础设施

### 最值得借的点

1. **把 Agent 核心循环抽成 `DesignAgentEngine`**
2. **把输入处理统一成一条正式入口**
3. **把多 Agent / task 变成系统能力**
4. **让 UI 只消费事件流，不直接决定执行**

### 不该借的点

1. `main.tsx` 这种 god file 结构
2. CLI / daemon / bridge 这些多入口复杂度
3. 过度依赖供应商细节的 query 分支

---

## 二、MCP / Tools：两边的真正差异

### `claude-code-haha` 已有的能力

核心文件：

- `C:\claude-code-haha\src\Tool.ts`
- `C:\claude-code-haha\src\tools.ts`
- `C:\claude-code-haha\src\entrypoints\mcp.ts`
- `C:\claude-code-haha\src\services\mcp\client.ts`
- `C:\claude-code-haha\src\utils\mcpValidation.ts`
- `C:\claude-code-haha\src\utils\mcpOutputStorage.ts`

它成熟的点在：

1. **统一 Tool contract**
   - 工具名字、输入、权限、启用条件、输出语义更集中

2. **统一 Tool registry**
   - `tools.ts` 是主入口
   - tools/list、tools/call 基本共享一套真相源

3. **MCP 是一等能力**
   - 不只是额外接一个服务器
   - 而是和工具系统统一

4. **大结果处理更正式**
   - 大输出可以落盘/截断
   - 减少上下文污染

### DesignEcho 当前状态

当前主要在：

- `C:\UXP\2.0\DesignEcho-Agent\src\renderer\services\tool-executor.service.ts`
- `C:\UXP\2.0\DesignEcho-Agent\src\renderer\services\agent-runtime\tool-schemas.ts`
- `C:\UXP\2.0\DesignEcho-Agent\src\main\services\mcp-host-service.ts`
- `C:\UXP\2.0\DesignEcho-Agent\src\renderer\services\mcp-host.client.ts`
- `C:\UXP\2.0\DesignEcho-Agent\src\main\websocket\server.ts`

现在的问题是：

1. `tool-executor.service.ts` 太重
   - 工具定义
   - 执行逻辑
   - 资源逻辑
   - 一些策略逻辑
   混在一起

2. `tool-schemas.ts` 和执行层是两套真相源

3. `mcp-host-service.ts` 已经做得很多，但仍然偏手工拼装

4. MCP smoke / batch policy / audit 已经不错，但还没真正基于统一工具注册表

### 最值得借的点

1. **建立统一 Tool Registry**
   - 名称
   - 描述
   - schema
   - 分类
   - 权限
   - 风险级别
   - 是否能进 batch

2. **让 Tool Schema 自动从注册表生成**
   - 不再双写

3. **让 MCP host 基于注册表暴露**
   - tools/list
   - tools/call
   - batch policy
   - health check

4. **规范大结果和二进制结果**
   - 截断
   - 落盘
   - 引用而不是内联塞进上下文

### 不该借的点

1. 多传输 MCP client 的完整复杂度
2. 远程 bridge / remote control
3. 海量 feature flag 控制工具矩阵

对 DesignEcho 来说，这些复杂度收益太低。

---

## 三、Skills：两边的真正差异

### `claude-code-haha` 已有的能力

核心文件：

- `C:\claude-code-haha\src\types\command.ts`
- `C:\claude-code-haha\src\skills\loadSkillsDir.ts`
- `C:\claude-code-haha\src\skills\bundledSkills.ts`
- `C:\claude-code-haha\src\plugins\builtinPlugins.ts`

它最值得借鉴的，不是 skill 内容，而是 **skill 边界定义方式**：

1. skill 本质是**元数据 + prompt 能力**
2. skill 有明确边界字段：
   - `allowedTools`
   - `whenToUse`
   - `context`
   - `agent`
   - `paths`
   - `model`
   - `effort`
   - `userInvocable`
3. 技能来源清楚：
   - bundled
   - disk
   - plugin
   - mcp

### DesignEcho 当前状态

当前主要在：

- `C:\UXP\2.0\DesignEcho-Agent\src\shared\types\skill.types.ts`
- `C:\UXP\2.0\DesignEcho-Agent\src\shared\skills\skill-declarations.ts`
- `C:\UXP\2.0\DesignEcho-Agent\src\renderer\services\design-skills\detail-page-design.skill.ts`
- `C:\UXP\2.0\DesignEcho-Agent\src\renderer\services\design-skills\main-image-design.skill.ts`
- `C:\UXP\2.0\DesignEcho-Agent\.agents\skills\**\SKILL.md`

优点：

1. 我们已经开始走对路
   - detail-page skill 化
   - main-image skill 化

2. 我们已经有本地 `SKILL.md` 资源

问题：

1. `SkillDeclaration` 还太薄
2. skills 元数据还没正式接进路由、执行权限、工具白名单
3. `.agents/skills/**/SKILL.md` 还没成为运行时一等输入

### 最值得借的点

1. **扩展 SkillDeclaration 元数据**
   - `allowedTools`
   - `context`
   - `agent`
   - `paths`
   - `model`
   - `effort`
   - `userInvocable`
   - `disableModelInvocation`

2. **把 SKILL.md 接进运行时**
   - 不是只放在仓库里
   - 而是和声明合并，成为设计技能真实输入

3. **路由开始认 skill 元数据**
   - 不只靠字符串规则

4. **执行前强制校验 allowedTools / requiredTools**

### 不该借的点

1. 技能内执行 shell 片段
2. 很重的技能发现与 gitignore 规则系统
3. 完整插件市场与自动更新
4. 很重的 slash command 体系

---

## 四、对 DesignEcho 的直接优化建议

### A. Agent 层

最先改这些文件：

- `C:\UXP\2.0\DesignEcho-Agent\src\renderer\services\agent-orchestration\orchestrator.ts`
- `C:\UXP\2.0\DesignEcho-Agent\src\renderer\services\agent-runtime\agent.ts`
- `C:\UXP\2.0\DesignEcho-Agent\src\renderer\services\agent-orchestration\routing.ts`
- `C:\UXP\2.0\DesignEcho-Agent\src\renderer\services\agent-orchestration\task-classifier.ts`

目标：

1. 抽 `DesignAgentEngine`
2. 输入处理统一
3. route 输出统一结构
4. 多 Agent 进入正式 task 框架

### B. MCP / Tools 层

最先改这些文件：

- `C:\UXP\2.0\DesignEcho-Agent\src\renderer\services\tool-executor.service.ts`
- `C:\UXP\2.0\DesignEcho-Agent\src\renderer\services\agent-runtime\tool-schemas.ts`
- `C:\UXP\2.0\DesignEcho-Agent\src\main\services\mcp-host-service.ts`
- `C:\UXP\2.0\DesignEcho-Agent\src\renderer\services\mcp-host.client.ts`
- `C:\UXP\2.0\DesignEcho-Agent\src\main\websocket\server.ts`

目标：

1. 抽统一 Tool Registry
2. schema 自动生成
3. MCP host 基于注册表
4. 统一 health check / timeout / batch policy / output truncation

### C. Skills 层

最先改这些文件：

- `C:\UXP\2.0\DesignEcho-Agent\src\shared\types\skill.types.ts`
- `C:\UXP\2.0\DesignEcho-Agent\src\shared\skills\skill-declarations.ts`
- `C:\UXP\2.0\DesignEcho-Agent\src\renderer\services\skill-executors\index.ts`
- `C:\UXP\2.0\DesignEcho-Agent\src\renderer\services\skill-executors\types.ts`
- `C:\UXP\2.0\DesignEcho-Agent\src\renderer\stores\app.store.ts`

目标：

1. 扩 SkillDeclaration 边界
2. 把 `SKILL.md` 接进运行时
3. 执行前校验 allowedTools / requiredTools
4. skill 开关和扩展能力进入 store

---

## 五、最适合 DesignEcho 的改造顺序

不要并行到失控，按这个顺序最稳：

1. **DesignAgentEngine**
2. **Tool Registry**
3. **扩 SkillDeclaration + 接入 SKILL.md**
4. **把 route / task-classifier 改成认 skill 元数据**
5. **让 MCP host 和 tool schemas 都吃注册表**
6. **继续推进 detail-page / main-image 的 design skill 化**

SKU 先不动。

---

## 六、一句话总结

`claude-code-haha` 最值得借的不是“它会做很多事”，而是：

**它把 Agent、MCP、skills 都做成了正式基础设施。**

DesignEcho 当前已经有了设计理解内核和 design skills 的雏形。

接下来要做的不是再堆业务功能，而是把：

- `Agent`
- `MCP / Tools`
- `Skills`

这三层正式拉直。

这样它后面才能真正更像“设计智能体”，而不是“会调用 Photoshop 工具的一组业务工作流”。
