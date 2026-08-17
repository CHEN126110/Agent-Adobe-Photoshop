# 架构清晰化草稿：Agent 分层与 Harness 定义（v1，待评审）

- **文档类型**：专项计划草稿（C 层）
- **是否直接指导当前开发**：否。本文是 `docs/design-agent-operating-system.md`（A 层真相源）第 2 节重构的评审稿；用户批准并正式升入 A 层前，不约束任何开发行为。
- **适用范围**：Agent 架构分层图、Harness 单一定义、多视角分工、运行线新提法、载体清单。**不重整** OS 5.0.1 的 120 条治理条款（条款保持原位，本轮只做定义层）。
- **不能覆盖的上位文档**：`project-memory/Prompt.md`、`docs/design-agent-operating-system.md`、`AGENTS.md`、`project-memory/CurrentTask.md`。

---

## 0. 现状怎么定义的（摘录）

| 定义 | 出处 | 原文要点 |
|---|---|---|
| 一句话公式 | OS §2 | `Agent = Model + Harness` |
| Harness 职责 | OS §2.1 | 9 项：任务/状态管理、上下文裁剪与恢复、Capability 发现与装载、工具调度、权限安全、执行追踪、观察回读、评价回流、失败恢复与停止条件 |
| Capability 六类 | OS §2.2 | Knowledge / Skill / Tool / Memory / Evaluation / Policy |
| 生产链 owner | OS §2.2.4 | 14 行「关注点 → canonical owner」表 |
| 运行线 | OS §5.0 | v3=默认执行路径 / v5=目标治理契约层 / bridge=过渡 / legacy=兼容保留 |
| 四套视角 | §3 / §2.11 / §5.1 / §5.2 | 8 子系统、五层权责、A0-A9 角色、K0-P0 横向能力 |

## 1. 代码载体清单（2026-08-16 核对）

```
用户/产品层
  ChatPanel.tsx                发送管线、续跑、交互卡、结果投影
Agent 执行环
  engine.ts (DesignAgentEngine)  入口与保留闸门
  autonomous-agent.executor.ts   自主循环容器（创建 Capability Session、注入预算）
  agent.ts (agent-runtime)       ReAct 循环（chatWithTools 原生工具调用）
  capability-session.ts          模型可见 schema + 按需目录 + 家族摘要
  capability-resolver.ts         基线/on-demand/deny/ceiling 解析（shared/agent-runtime-v5）
  tool-schemas.ts                164 工具 schema（RAW_TOOL_CATALOG + DEFAULT_AGENT_TOOL_NAMES）
  tool-executor.service.ts       分发：renderer-local / 浏览器桥 / UXP
Harness 治理层
  agent-tool-decision-contract.ts  每轮工具决策契约
  agent-tool-execution-preflight.ts 读后写/目标守卫/分类（photoshop-tool-skill.ts 双源）
  runtime-session.ts (v5)          TaskRun 身份与阶段状态
  declareDesignBrief/ReferenceBrief/Strategy/ActionPlan  R1/R2/R3/R4 声明契约
  visual-observation-gate.ts      视觉观察前置
  design-quality-verdict-bundle.ts DesignVerdict
  agent-policies / design-discipline-runtime / policy-gate-repeat-guard  策略与熔断
Harness 交付层
  artifact-repository-service.ts（主进程）Artifact/ArtifactRef 唯一发布 owner
  run-record / runtime-task-snapshot  审计投影
  Release Gate                     目标契约，M5 未实现
Capability 层
  skill-declarations.ts + skill-executors/  技能声明与执行器
  knowledge/ + design-intelligence/ + Eagle 只读服务   知识与记忆
  design-teams/                    子代理队友（scene-analyst/design-strategist/executor/critic）
外部世界
  main: websocket(8765→UXP) / browser-bridge(8769→扩展) / model-service(providers)
  UXP: tools/registry.ts + core/photoshop-transaction-runner.ts（唯一 mutation 事务 owner，
       已接入 11 个写工具：renameLayer/groupLayersSafely/setTextStyle/setTextContent/
       placeImage/moveLayer/reorderLayer/createGroup/create-text-layer/transform-layer/layer-properties）
  Photoshop / 浏览器扩展 / Eagle MCP / Provider API
```

## 2. 六个裂缝（定义与现实之间）

1. 「Harness」一词三层意思未分层：职责清单、代码里"一切非模型"、owner 表——没有执行环/治理层/交付层的切分，新增代码"放哪层"无答案。
2. v3/v5 已不是两条线：v5 契约深插在 v3 主循环内部（autonomous-agent.executor 恒建 Capability Session；declareDesignBrief 失败 49% 是混合带产物）。能力隐身、声明空转都发生在这个混合带。
3. 文档状态标注陈旧：OS §2.4 标「截至 2026-07-13」、TaskRun 标 implementation_not_started；实际 08-13 已做 X1；runner 接入工具数已从记忆中的 5 个增长到 11 个。
4. 四套视角（8 子系统/Capability 六类/五层权责/A0-A9+K0-P0）并存但无「提问分工」。
5. 120 条治理条款以章节为主体，架构结构被条款淹没（条款应挂 owner 名下做附录）。
6. 没有「最后核对日期 + 载体清单」机制，漂移靠人脑对齐。

## 3. 提议：清晰定义 v1

### 3.1 一句话

> **Agent = 模型 + Harness。Harness 分三层：执行环陪模型把事做完，治理层保证做完的事真实且安全，交付层保证结果可追溯。三层都不替模型做设计判断。**

### 3.2 Harness 三层单一定义

| 层 | 职责（每条有唯一 owner） | 关键载体 |
|---|---|---|
| 执行环 | ReAct 循环、工具调度、schema 可见面、执行前预检、事务执行 | agent.ts、capability-session、tool-executor、preflight、UXP TransactionRunner |
| 治理层 | 任务身份与阶段、能力解析、安全与预算门禁、质量裁决 | runtime-session、capability-resolver、gates/policies、DesignVerdict |
| 交付层 | 产物发布与引用、审计记录、只读投影 | Artifact Repository、Run Record、Snapshot、Release（M5 未实现） |

### 3.3 四套视角的分工（哪套回答什么问题）

| 问题 | 用哪套 |
|---|---|
| 这个功能在哪个文件、归哪个子系统？ | 8 子系统地图 |
| 这个能力怎么注册/发现/授权/评价？ | Capability 六类 + Capability Session |
| 这件事谁是唯一 owner、谁不能越权？ | 五层权责表（§2.11） |
| 长期产品要哪些角色协作、缺口在哪？ | A0-A9 蓝图（逻辑角色，非运行时拆件） |

### 3.4 运行线新提法

把「v3/v5 两条并行线」改为「**一条执行线，三代治理深度**」：

- 执行载体唯一：主循环（agent.ts）。不存在第二执行引擎。
- 治理深度按能力切片渐深：`legacy 正则提示 → v5 过渡契约（声明桥，已在主循环内）→ 目标契约（TaskRun + Runner 直连）`。
- 混合带如实标注为「迁移期事实」：它产生真实故障（declareDesignBrief 49% 失败、能力隐身），治理动作必须优先清理混合带，而不是继续加层。
- 汇报四态保留：`contract_ready / bridge_ready / runtime_integrated / photoshop_e2e_verified`。

### 3.5 文档机制（升入 A 层时附带）

1. OS 第 2 节开头放分层图 + 载体清单 + 「最后核对日期」。
2. 每层/每个 owner 一段话；治理条款降为各 owner 名下的附录条目。
3. 新增代码落层规则：写工具语义去 Capability 层、写执行闸去治理层、写循环控制去执行环——三选一，不存在第四层。

## 4. 评审要点（需要用户拍板）

1. 三层 Harness 切法（执行环/治理层/交付层）是否认可？还是想按"运行时/治理/交付"或"循环/约束/账本"命名？
2. 「一条执行线，三代治理深度」是否替代 v3/v5 说法？项目记忆里 v3/v5/bridge 术语使用面很广，替换需要同步成本。
3. 分层图放在 OS 第 2 节，还是单独建 `docs/design-agent-architecture.md` 作为 A 层附图？
4. 载体清单是否要每月随 maintenance:validate 加一条"OS 载体核对"检查（防漂移机制化）？
