# 能力归属路由

## 路由原则

让一个事实或方法只落在一个权威位置。先修根因，再决定是否值得长期沉淀；不要把“持久化”误当成“已经学会”。

| 观察到的内容 | 权威目标 | 处理方式 | 不应进入 |
| --- | --- | --- | --- |
| 当前任务的临时纠正 | 当前 TaskRun / plan revision | 修正本轮目标并重新验证 | 长期 Memory 或 Skill |
| 用户稳定偏好 | user-scoped Design Memory 候选 | 明确确认、限定用户作用域、允许撤销 | 全局 Skill / Policy |
| 项目事实或品牌规则 | Design Project State 的 fact/rule 候选 | 保留来源，经专用复核后激活 | Global Prompt |
| 可复用 Photoshop/设计方法 | reviewed recipe / Knowledge 候选 | 绑定案例、限制适用条件、评审后检索 | Tool 权限 |
| 可复用多步开发工作法 | 项目 `.agents/skills/**/SKILL.md` | 结构校验、forward-test、人工批准 | 产品 v5 manifest |
| 产品任务能力 overlay | v5 `SkillRuntimeManifest` | 声明输入、Capability、Evaluation、Policy 和交付物 | 开发助手 Skill |
| 单一可执行动作或参数语义 | Tool schema / Tool implementation | 修复原子能力、preflight 分类和读回 | Skill Prompt |
| 计划节点、依赖与恢复 | 现有 TaskRun / R4 / Workflow projection | 修改唯一 Runtime owner，不建第二 DAG | Memory |
| 上下文缺失、陈旧或污染 | Context Compiler / OperatingContextSnapshot | 修复来源、信任、freshness 和裁剪 | Skill workaround |
| 模型选错用途或能力 | Model Router / capability verdict | 修复三态能力、用途和真实探针 | 品类关键词路由 |
| 质量标准或误通过 | Evaluation Profile / DesignVerdict / Release Gate | 增加有证据的检查和校准 | Tool success 判断 |
| 安全、审批或不可逆边界 | Policy / execution preflight | 人工安全审查；Agent 不得自主修改 | Memory / Skill 自更新 |
| 确定性代码缺陷 | 当前代码 owner | 根因修复和回归测试 | “以后记住”式兜底 |
| 当前系统没有动作能力 | Capability gap / Intake / Backlog | 记录缺口与真实消费者，单独开发 Tool/Provider | 虚构 Skill 能力 |

## DesignEcho 现有入口

优先复用以下真相源，不建立平行注册表：

- 演进入口：`DesignEcho-Agent/src/shared/agent-runtime-v5/reflexion-contract.ts` 中的 `RuntimeEvolutionIntake`。
- 经验候选：`DesignEcho-Agent/src/shared/design-learning-experience.ts`。
- 学习复核：`DesignEcho-Agent/src/shared/design-learning-memory-review.ts` 与 `design-learning-memory-review-queue.ts`。
- Memory/Knowledge 映射：`DesignEcho-Agent/src/shared/design-memory-knowledge.ts`。
- 产品 Skill 契约：`DesignEcho-Agent/src/shared/agent-runtime-v5/skill-package-contract.ts`。
- 产品 Skill manifest：`DesignEcho-Agent/src/shared/agent-runtime-v5/manifests/*.manifest.ts`。
- Skill registry/runtime：`DesignEcho-Agent/src/shared/agent-runtime-v5/skill-runtime.ts`。
- 工具执行边界：`DesignEcho-Agent/src/shared/agent-tool-execution-preflight.ts`。
- 项目事实：`DesignEcho-Agent/src/shared/design-project-state.ts` 与对应 types。

## 判断顺序

1. 先判断是否只是当前任务纠正；是则不要持久化。
2. 再判断是否为确定性 bug、Tool 缺口或 Runtime owner 问题；是则修代码或登记 capability gap。
3. 再判断内容是“事实/偏好”还是“如何做”；前者进入受作用域约束的 Memory/Project State，后者才可能成为 recipe 或 Skill。
4. 再区分开发助手 Skill 与产品运行时 SkillManifest；不要让两者共享发布权威。
5. 最后判断是否触及 Policy、权限或完成裁决；一旦触及，停止自主晋级并要求专门安全审查。

不要假设 TypeScript 类型中存在的候选一定能经过当前队列。核对生成器、队列筛选、review gate、writeback 和检索消费者是否对同一 `kind/status/version` 完整接线。
