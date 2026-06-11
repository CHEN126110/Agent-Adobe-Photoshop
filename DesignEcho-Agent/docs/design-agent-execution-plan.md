# Design Agent 执行规划

> 文档权限：过渡执行规划，非当前顶层真相源。
> 使用方式：只在回看某一阶段的迁移思路时参考，不作为当前实现入口。
> 不可覆盖：`project-memory/Prompt.md`、`project-memory/CurrentTask.md`、`docs/documentation-governance.md`、`docs/design-agent-operating-system.md`、`project-memory/Plan.md`。

## 目标

把当前 `DesignEcho-Agent` 从“路由 + executor + 局部 skill + 局部多智能体”推进到稳定的三层结构：

1. `scene core`
2. `design agent / design teams`
3. `design skills + executors`

同时控制代码残留，不继续引入新的平行入口。

## 当前已落地

### 1. 统一主循环入口

- `src/renderer/services/design-agent/engine.ts`
- `src/renderer/services/design-agent/index.ts`

当前 `processWithUnifiedAgent(...)` 已由 `DesignAgentEngine` 承接。

保留旧出口：

- `src/renderer/services/agent-orchestration/orchestrator.ts`
- `src/renderer/services/unified-agent.service.ts`

原因：
- UI 直接消费旧出口
- 多数 executor / skill 仍从旧出口拿类型

这一步是兼容迁移，不是平行新旧两套运行时。

### 2. 多智能体基础设施

当前已具备：

- 角色定义：`src/shared/types/design-team.types.ts`
- 注册表：`src/renderer/services/design-teams/registry.ts`
- 协调器：`src/renderer/services/design-teams/coordinator.ts`
- 任务对象：`src/renderer/services/design-teams/task.ts`

现有角色：

- `scene-analyst`
- `design-strategist`
- `executor`
- `critic`

现有 teammate 结果已经带：

- `status`
- `startedAt`
- `finishedAt`
- `messages`
- `outputMessage`

不再只是散装文本。

## 设计约束

### 1. 不新增第二套入口

允许保留的兼容出口：

- `unified-agent.service.ts`
- `agent-orchestration/orchestrator.ts`

但它们只能做：

- re-export
- 兼容类型出口

不允许继续往里面加新业务逻辑。

### 2. 不新增第二套多智能体协议

所有新的 teammate / team 消息都必须走：

- `design-team.types.ts`
- `design-teams/task.ts`
- `design-teams/coordinator.ts`

禁止在 skill / executor 内部直接再写一套子 agent prompt + tool map。

### 3. 不做掩盖式修复

禁止：

- 为了兼容旧逻辑继续复制一份 routing
- 为了兜底把同一个决策链写两遍
- 为了避免删除旧代码再套一层旧包装逻辑

如果旧路径已经被新路径替代，应在阶段完成后收敛为 thin wrapper。

### 4. 编码规则

中文字符串修改遵循：

- 优先源码级 UTF-8 修正
- 不以终端输出是否乱码作为唯一判断
- 不使用默认 PowerShell 编码直接重写含中文源码

## 后续执行顺序

### Phase 1

完成项：

- `DesignAgentEngine`
- `DesignTeamCoordinator`
- `DesignTeammateTask`

验收标准：

- `npm run build`
- `npm run smoke:mcp-host`

### Phase 2

目标：

- 统一 `Tool Registry`
- 减少 `tool-schemas.ts / tool-executor.service.ts / mcp-host-service.ts` 的重复定义

原则：

- schema 和实际工具定义必须来自同一真相源
- 不再允许 renderer / main 各自维护一份工具边界

### Phase 3

目标：

- 让 `routing / task-classifier / useChatActions` 不再各自维护任务理解逻辑
- 把 skill 元数据接入正式运行时

### Phase 4

目标：

- detail-page / main-image 继续 skill 化
- 接入 teammate 生命周期而不是局部临时 delegate

## 明确暂不处理

- SKU 链路

原因：
- 当前要求是不影响 SKU
- 先把 design agent 基础设施收稳

## 清理策略

每完成一个 phase，必须复查：

1. 是否留下新的兼容出口
2. 是否留下新的重复 schema / types
3. 是否留下只被旧链路使用的临时字段
4. 是否引入新的中文编码污染

如果答案是“是”，则该 phase 不算真正完成。
