# 项目文档治理与防偏航规则

日期：2026-05-20

## 1. 目的

本文件用于解决一个已经实际发生的问题：

DesignEcho 仓库里同时存在架构文档、方法论文档、长期路线、专项规划、研究笔记和状态日志。它们各自有价值，但如果没有权限分层，就会出现“多份文档同时指挥开发”，最终把项目带偏。

本文件只回答三个问题：

1. 哪些文档是当前开发的真相源
2. 哪些文档只能在特定场景下阅读
3. 哪些文档会干扰方法论，不能作为默认开发入口

## 2. 当前问题

当前干扰不是“文档太少”，而是“多份文档都像顶层文档”。

已出现的典型问题：

1. 顶层目标、当前主线、长期路线分别写在不同文档里，容易把长期愿景当成当前任务。
2. 架构复盘、执行规划、研究路线和 OS 架构入口同时存在，容易产生第二套指挥链。
3. 专项规划文档容易被误读成当前默认实现路径，导致执行时绕开 `CurrentTask.md` 和 `Plan.md`。
4. 外部项目研究、方法论摘录、专题研究如果没有权限说明，容易被误当成现行规则。

## 3. 文档权限层级

### A 层：强约束真相源

这些文档可以直接约束当前开发行为。

1. [AGENTS.md](C:\UXP\2.0\DesignEcho-Agent\AGENTS.md)
2. [Prompt.md](C:\UXP\2.0\DesignEcho-Agent\project-memory\Prompt.md)
3. [CurrentTask.md](C:\UXP\2.0\DesignEcho-Agent\project-memory\CurrentTask.md)
4. [documentation-governance.md](C:\UXP\2.0\DesignEcho-Agent\docs\documentation-governance.md)
5. [design-agent-operating-system.md](C:\UXP\2.0\DesignEcho-Agent\docs\design-agent-operating-system.md)
6. [Plan.md](C:\UXP\2.0\DesignEcho-Agent\project-memory\Plan.md)
7. [Status.md](C:\UXP\2.0\DesignEcho-Agent\project-memory\Status.md)

规则：

1. 当前任务如何做，以 `CurrentTask.md` 为准。
2. 当前总目标和当前北极星，以 `Prompt.md` 为准。
3. 架构总控边界，以 `design-agent-operating-system.md` 为准。
4. 当前阶段顺序和验收，以 `Plan.md` 为准。
5. 已核实事实，以 `Status.md` 为准。

### B 层：条件性执行辅助文档

这些文档有明确价值，但只有在对应动作发生时才进入默认阅读路径。

1. [agent-capability-map.md](C:\UXP\2.0\DesignEcho-Agent\docs\agent-capability-map.md)
2. [Intake.md](C:\UXP\2.0\DesignEcho-Agent\project-memory\Intake.md)
3. [Backlog.md](C:\UXP\2.0\DesignEcho-Agent\project-memory\Backlog.md)
4. [Risks.md](C:\UXP\2.0\DesignEcho-Agent\project-memory\Risks.md)
5. [Decisions.md](C:\UXP\2.0\DesignEcho-Agent\project-memory\Decisions.md)
6. [business-skill-design-governance.md](C:\UXP\2.0\DesignEcho-Agent\docs\business-skill-design-governance.md)
7. [project-master-plan.md](C:\UXP\2.0\DesignEcho-Agent\docs\project-master-plan.md)

使用时机：

1. 需要给新需求归类时，再读能力地图。
2. 需要排期、移动优先级时，再读 Intake / Backlog。
3. 需要判断历史方案边界时，再读 Risks / Decisions。
4. 需要处理主图、详情页、SKU 场景边界时，再读业务治理文档。
5. 需要看长期路线，不是当前实现入口时，再读项目计划书。

### C 层：专项计划与研究文档

这些文档默认不参与当前任务决策，只在命中专项主题时作为参考。

例如：

1. `reference-replication-*`
2. `detail-page-*`
3. `design-knowledge-*`
4. `layout-grid-*`
5. `smart-scaling-*`
6. `photoshop-acceptance-infrastructure.md`
7. `repository-maintenance-hygiene.md`
8. `sock-shape-*`
9. `matting-*`

规则：

1. 专项文档只能服务当前命中的专项任务。
2. 专项文档不能覆盖 A 层真相源。
3. 专项文档若与 `CurrentTask.md` 冲突，先修正 `CurrentTask.md` 或暂停使用专项文档。

### D 层：研究/复盘/借鉴文档

这些文档不是当前实现依据，只能提供背景、启发或反例。

## 4. 高干扰文档名单

以下文档最容易把团队重新带回“第二套架构”或“旧的阶段方案”，默认禁止作为开发入口：

1. [agent-architecture.md](C:\UXP\2.0\DesignEcho-Agent\docs\agent-architecture.md)
原因：较早的英文架构草案，和当前 OS 架构、方法论、项目记忆存在明显重叠。

2. [agent-architecture-system-review.md](C:\UXP\2.0\DesignEcho-Agent\docs\agent-architecture-system-review.md)
原因：是阶段性系统复盘快照，不是当前顶层规则。

3. [design-agent-execution-plan.md](C:\UXP\2.0\DesignEcho-Agent\docs\design-agent-execution-plan.md)
原因：描述的是一轮过渡执行规划，不是当前总控平面。

4. [design-agent-research-and-roadmap.md](C:\UXP\2.0\DesignEcho-Agent\docs\design-agent-research-and-roadmap.md)
原因：偏研究路线和外部借鉴，容易被误读成当前立即执行方案。

5. [agent-foundation-completion-plan.md](C:\UXP\2.0\DesignEcho-Agent\docs\agent-foundation-completion-plan.md)
原因：是基础设施阶段收口计划，不是永久性的开发入口。

6. [design-agent-development-knowledge-base.md](C:\UXP\2.0\DesignEcho-Agent\docs\design-agent-development-knowledge-base.md)
原因：是认知收口文档，不应取代 OS、Prompt、Plan。

7. `claude-code-haha-*`、`long-horizon-codex-adoption.md` 等外部借鉴文档
原因：它们只提供方法启发，不能直接变成当前工程规则。

## 5. 默认阅读路径

处理中大型任务时，默认阅读顺序收敛为：

1. `AGENTS.md`
2. `project-memory/README.md`
3. `project-memory/Prompt.md`
4. `project-memory/CurrentTask.md`
5. `docs/documentation-governance.md`
6. `docs/design-agent-operating-system.md`
7. `project-memory/Plan.md`
8. `project-memory/Status.md`

只有在需要归类、排期、回看风险或专项实施时，才继续读：

1. `docs/agent-capability-map.md`
2. `project-memory/Intake.md`
3. `project-memory/Backlog.md`
4. `project-memory/Risks.md`
5. `project-memory/Decisions.md`
6. 命中的专项计划文档

## 6. 冲突处理规则

如果多份文档对同一问题给出不同结论，按以下顺序裁决：

1. `AGENTS.md`
2. `Prompt.md`
3. `CurrentTask.md`
4. `documentation-governance.md`
5. `design-agent-operating-system.md`
6. `Plan.md`
7. `Status.md`
8. 其他文档

专项文档、研究文档、复盘文档不能推翻以上顺序。

## 7. 新文档创建规则

以后新增文档必须在开头明确写清：

1. 文档类型：真相源 / 执行辅助 / 专项计划 / 研究参考 / 历史复盘
2. 是否能直接指导当前开发
3. 适用范围
4. 不能覆盖哪些上位文档

如果做不到这四点，就不应该新增文档。

## 8. 当前立即生效的治理动作

1. 以后默认不从 `docs` 目录随机挑文档开始开发。
2. 高干扰文档必须显式标注“非当前真相源”。
3. `CurrentTask.md` 切换任务时，必须同步说明当前为什么切换，而不是隐式漂移。
4. 新的专项计划必须挂到 OS、Plan 或 CurrentTask 上，不能单独漂浮。
5. 如果某份文档只剩历史价值，应保留，但降级为研究/复盘，不再默认读取。
