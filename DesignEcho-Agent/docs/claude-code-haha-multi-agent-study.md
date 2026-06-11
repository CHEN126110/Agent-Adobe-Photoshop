# `claude-code-haha` 多智能体系统实现研究

## 目标

这份文档只研究一件事：

**`claude-code-haha` 的多智能体到底是怎么实现的。**

不是看表面有没有 `spawn_agent`，而是看：

1. 怎么建团队
2. 怎么启动 teammate
3. 怎么限制 teammate 的能力边界
4. 怎么给 teammate 发消息
5. 怎么追踪任务状态
6. 怎么恢复和重连

---

## 结论先说

它的多智能体系统，不是“模型自己会分身”。

它本质上是下面这 5 层拼起来的：

1. **Team / Agent 身份层**
2. **Spawn backend 层**
3. **Task 生命周期层**
4. **Mailbox / 消息通信层**
5. **Tool 白名单与权限边界层**

也就是说：

**它的多智能体本质是一个任务系统，不是 prompt 技巧。**

---

## 一、团队和身份是怎么建立的

关键文件：

- `C:\claude-code-haha\src\tools\TeamCreateTool\TeamCreateTool.ts`
- `C:\claude-code-haha\src\utils\swarm\teamHelpers.ts`
- `C:\claude-code-haha\src\utils\swarm\constants.ts`

### 真实做法

当它创建一个 team 时，不是只在内存里放一个数组。

它会：

1. 生成 `team_name`
2. 生成 team lead 的稳定 `agentId`
3. 写一份 **team file**
4. 把 team 信息写进 AppState
5. 初始化对应任务目录
6. 记录当前 leader 属于哪个 team

### 这意味着什么

它的 team 不是“临时 prompt 概念”，而是一个真正的运行时对象。

里面有：

- 团队名
- leader id
- member 列表
- model
- cwd
- teammate 元信息

---

## 二、teammate 是怎么启动的

关键文件：

- `C:\claude-code-haha\src\tools\AgentTool\runAgent.ts`
- `C:\claude-code-haha\src\utils\swarm\spawnUtils.ts`
- `C:\claude-code-haha\src\utils\swarm\spawnInProcess.ts`
- `C:\claude-code-haha\src\utils\swarm\backends\registry.ts`

### 真实做法

它不是只有一种 spawn 方式。

它会先决定 teammate backend，再启动：

1. in-process
2. 外部进程
3. tmux / terminal 类 teammate mode

`spawnUtils.ts` 的作用很关键：

它负责把父会话的重要上下文带给子 agent：

- permission mode
- model override
- settings path
- plugin dir
- teammate mode
- 代理/证书/远程环境变量

### 这意味着什么

它的 teammate 不是“重新开一个空白 agent”。

而是：

**带着父会话的运行参数和环境，启动一个受控的子 agent。**

---

## 三、teammate 的能力为什么不会失控

关键文件：

- `C:\claude-code-haha\src\tools\AgentTool\agentToolUtils.ts`
- `C:\claude-code-haha\src\constants\tools.ts`
- `C:\claude-code-haha\src\Tool.ts`

### 核心机制：工具白名单

它不会把全部工具直接给子 agent。

`resolveAgentTools(...)` 会做几件事：

1. 先基于 agent 类型过滤工具
2. 再应用 `disallowedTools`
3. 再处理 wildcard 或显式工具清单
4. 最后得到这次 teammate 真正能用的 `resolvedTools`

而且它还会区分：

- built-in agent
- custom agent
- async agent
- in-process teammate

### 这意味着什么

它的多智能体不是“多开几个一样的 agent”。

而是：

**不同 teammate 拿到的是不同能力边界。**

这也是它真正能做协作、而不是只会制造混乱的原因。

---

## 四、消息是怎么在多个 agent 之间流动的

关键文件：

- `C:\claude-code-haha\src\tools\SendMessageTool\SendMessageTool.ts`
- `C:\claude-code-haha\src\utils\teammateMailbox.ts`
- `C:\claude-code-haha\src\tasks\InProcessTeammateTask\InProcessTeammateTask.tsx`

### 真实做法

它的 agent 之间不是直接共享一个聊天窗口。

而是通过 mailbox / pending queue 这类机制传消息。

`SendMessageTool` 能做：

1. 给指定 teammate 发普通文本消息
2. 广播给 team 成员
3. 发送结构化消息
   - shutdown_request
   - shutdown_response
   - plan_approval_response

### in-process teammate 的任务对象还会维护：

- `messages`
- `pendingUserMessages`
- `shutdownRequested`
- teammate identity

### 这意味着什么

它的多智能体通信不是“共享上下文池”。

而是：

**每个 agent 有自己的任务上下文，再通过结构化消息交流。**

这是很重要的，因为这让：

- 上下文隔离
- UI 展示
- 审批流
- 中断与恢复

都更可控。

---

## 五、任务状态是怎么管理的

关键文件：

- `C:\claude-code-haha\src\tasks\LocalAgentTask\LocalAgentTask.tsx`
- `C:\claude-code-haha\src\tasks\InProcessTeammateTask\InProcessTeammateTask.tsx`
- `C:\claude-code-haha\src\utils\task\framework.ts`

### 它有两种核心任务对象

1. **LocalAgentTask**
   - 更像后台 agent task
   - 跟踪：
     - progress
     - token
     - tool use
     - transcript
     - notifications

2. **InProcessTeammateTask**
   - 更像团队内 teammate
   - 跟踪：
     - identity
     - messages
     - pending queue
     - shutdown state

### 共同点

它们都不是“函数执行完就没了”。

而是标准化的 task state：

- running / completed / killed / failed
- progress
- output
- transcript
- cleanup

### 这意味着什么

它的多智能体系统之所以稳定，不是因为模型更聪明，
而是因为：

**多 agent 行为被任务系统托住了。**

---

## 六、重连和恢复是怎么做的

关键文件：

- `C:\claude-code-haha\src\utils\swarm\reconnection.ts`
- `C:\claude-code-haha\src\utils\sessionStorage.ts`

### 真实做法

它会在 session transcript 和 team file 里保留：

- teamName
- agentName
- agentId
- leadAgentId

恢复时再通过 `computeInitialTeamContext()` /
`initializeTeammateContextFromSession()` 重建 team context。

### 这意味着什么

它的多智能体不是一次性内存结构。

而是：

**即使恢复会话，也还能知道这个 agent 属于哪个 team。**

---

## 七、它的多智能体为什么好用

真正让它多智能体系统成立的，不是“可以开子 agent”。

而是这 4 点同时成立：

1. **有团队身份**
2. **有 spawn backend**
3. **有 task 生命周期**
4. **有 mailbox + tool 边界**

缺一个都容易退化成“多开几个乱跑的 agent”。

---

## 八、对 DesignEcho 最值得借什么

### 1. 借“任务化”的多智能体，而不是 prompt 化

DesignEcho 现在虽然已经能开多 Agent，但还不够像正式基础设施。

应该借的是：

- `DesignTask`
- `DesignAgentTask`
- `DesignTeammateTask`

让每个子 agent 都有：

- 目标
- 状态
- 消息
- 输出
- 生命周期

### 2. 借“能力边界”

不同设计 teammate 不应该拿到同一套工具。

例如：

- `Scene Analyst`
  - 只读 scene / MCP / analyze tools

- `Design Strategist`
  - 读 scene、读参考、出 plan

- `Executor`
  - 有 Photoshop 写操作

- `Critic`
  - 只读审计工具

这点最值得借。

### 3. 借“结构化消息”

DesignEcho 后面如果真做：

- planner
- scene analyst
- executor
- critic

它们之间不该只靠共享聊天历史。

应该有结构化消息，例如：

- `plan_request`
- `plan_response`
- `review_request`
- `review_result`
- `retry_request`

### 4. 借“恢复能力”

设计任务经常是长任务。

后面如果要让：

- 详情页设计
- 批量主图
- 批量详情页审计

真正稳定，多 Agent 也要能恢复，而不是中断后全丢。

---

## 九、哪些不要照搬

### 1. 不要照搬它的 team 文件和目录复杂度

它为终端/远程环境做了很多兼容。

DesignEcho 没必要一开始就复制：

- tmux
- 远程控制
- bridge session
- daemon

### 2. 不要照搬它的大状态树

它的 task/state/UI 体系已经很重。

DesignEcho 应该做更轻的版本：

- 只保留设计任务真正需要的状态

### 3. 不要照搬它的全部工具矩阵

我们更需要：

- 设计感知工具
- Photoshop 执行工具
- 审计工具

不是通用 shell/CLI agent 的全家桶。

---

## 十、对 DesignEcho 的直接改造建议

### 第一阶段

先做 3 类任务对象：

1. `DesignAgentTask`
2. `DesignTeammateTask`
3. `DesignReviewTask`

### 第二阶段

定义 4 类 teammate：

1. `scene-analyst`
2. `design-strategist`
3. `executor`
4. `critic`

### 第三阶段

定义结构化消息协议：

1. `scene_summary`
2. `design_plan`
3. `execution_report`
4. `review_report`
5. `revision_request`

### 第四阶段

再把它们接进：

- `DesignAgentEngine`
- `Tool Registry`
- `DesignScene Core`

---

## 一句话总结

`claude-code-haha` 的多智能体系统，本质上不是“多开模型”。

它的核心是：

**团队身份 + 受控 spawn + 任务生命周期 + 结构化通信 + 工具边界。**

对 DesignEcho 来说，最值得借的是这一整套“多智能体基础设施思路”，
而不是它终端产品那层复杂壳。
