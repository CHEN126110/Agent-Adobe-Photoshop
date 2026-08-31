# 项目文档治理与防偏航规则

> 文档类型：B 层文档权限真相源。
> 当前开发权限：用于裁决 Markdown 的 owner、生命周期、默认阅读和冲突；不拥有产品目标或排期。
> 适用范围：`DesignEcho-Agent` 下的项目记忆、架构、操作说明、Skill、专项研究、复盘和验收文档。
> 不能覆盖：当前用户目标、根 /子项目 `AGENTS.md`、`project-memory/Prompt.md`、当前代码和真实运行读回。

更新日期：2026-08-31

## 1. 问题定义

项目历史上不是缺文档，而是多份文档都像顶层文档。已经发生过：

- CurrentTask、Plan、Status 与 machine state 指向不同任务；
- 数十个旧“当前主线”同时留在工作树；
- 已退役 smoke 命令继续出现在操作文档；
- 三模型桶等历史结构覆盖当前单一多模态 Agent；
- Draft /研究稿被源码引用后成为隐形契约；
- 用户概念蓝图、专项计划和当前 Runtime 成熟度混为一谈。

治理目标不是让每份文档都同步所有内容，而是让每类事实只有一个 owner，其它文档只引用或明确保留历史价值。

## 2. 事实域与唯一落点

| 事实 | 唯一落点 | 其它文档允许做什么 |
|---|---|---|
| 产品目标、低 /高预期、强约束 | `project-memory/Prompt.md` | 引用，不复制第二套北极星。 |
| 顶层分层、数据流和 owner | `docs/design-agent-operating-system.md` | 做代码映射或专项展开。 |
| 当前任务范围 | `project-memory/CurrentTask.md` | 只保留一张卡。 |
| 当前实施顺序 | `project-memory/Plan.md` | 只保留一个当前 H2。 |
| 跨阶段 SMART 路线 | `docs/project-master-plan.md` | 不激活阶段，不拥有当前顺序。 |
| 当前已核实产品状态 | 当前代码 /真实读回 + `project-memory/Status.md` / `project-state.json` 投影 | 历史由 Git / Run Record 查询。 |
| 未排期需求 | `project-memory/Intake.md` | 不调度，不保存已完成项。 |
| 紧邻当前阶段的可执行队列 | `project-memory/Backlog.md` | 不复制长期路线。 |
| 长期有效决定与当前风险 | `Decisions.md` / `Risks.md` | 不反向生成第二计划。 |
| 能力 inventory | `docs/agent-capability-map.md` | 不能覆盖当前成熟度或顺序。 |
| 业务 /专业方法 | Skill references 或 C 层专项文档 | 只能由当前任务按需激活。 |

新增术语、Contract、Store、Registry 或 Gate 前，必须先证明已有 owner 无法表达。需要跨层展示时使用只读 projection，不再建立持久化真相源。

## 3. 文档权限层级

### A 层：默认入口

中大型任务默认只读：

1. `AGENTS.md`
2. `project-memory/Prompt.md`
3. `project-memory/CurrentTask.md` 的唯一 H2

它们决定稳定边界和本轮范围；已经实现什么仍以代码和真实读回为准。

### B 层：按动作读取的维护文档

- `docs/documentation-governance.md`
- `docs/design-agent-operating-system.md`
- `docs/project-master-plan.md`
- `docs/agent-development-methodology.md`
- `docs/agent-capability-map.md`
- `docs/agent-gates-definitions.md`
- `docs/business-skill-design-governance.md`
- `docs/skill-standard.md`
- `docs/model-settings-configuration.md`
- `docs/browser-extension-bridge.md`
- `docs/repository-maintenance-hygiene.md`
- `docs/project-sustainability-cockpit.md`
- `benchmarks/design-reliability/README.md`
- `project-memory/Plan.md`
- `project-memory/Status.md`
- `project-memory/Intake.md`
- `project-memory/Backlog.md`
- `project-memory/Risks.md`
- `project-memory/Decisions.md`

只在任务实际需要时读取。B 层文档中的命令、路径和当前状态必须保持可执行、可定位。

### C 层：专项实施与专业参考

例如：

- `reference-replication-*`
- `detail-page-*`
- `main-image-design-framework.md`
- `layout-grid-design-knowledge.md`
- `smart-scaling-photoshop-transform-research-plan.md`
- `image-placement-core-mvp.md`
- `matting-*`
- `sock-shape-*`
- `design-agent-professional-capability-system-plan.md`
- `design-agent-prompt-capability-governance.md`
- `design-project-state-and-design-skills-plan.md`

规则：

1. 只有 CurrentTask / Plan 明确命中该专项时才能指导实现；
2. 不能覆盖 A/B 层或当前代码；
3. 不能把旧完成度、旧命令或历史方案写成当前事实；
4. 专项完成后保留稳定方法和边界，实施流水由 Git 保存。

### D 层：历史、研究、审计、复盘和用户概念来源

包括所有按日期命名的审计 /复盘、早期架构优化稿、外部借鉴、一次性验收报告、Superpowers 计划和未发布知识候选。

D 层可以保留：

- 当时的原始证据；
- 用户概念和设计意图；
- 已吸收的正反经验；
- 专项研究数据和适用范围。

D 层不能提供：

- 当前排期；
- 当前模型 / Runtime 结构；
- 可复制的已退役命令；
- 当前能力完成声明；
- 生产权限、TaskRun 状态或质量结论。

## 4. 文档生命周期头

除 A 层入口和 Skill 自身规范外，新增或保留的 Markdown 应在开头明确：

```md
> 文档类型：B 层执行辅助 / C 层专项参考 / D 层历史复盘
> 当前开发权限：可以按需指导 / 不能直接指导
> 适用范围：……
> 不能覆盖：Prompt、CurrentTask、Plan、OS、当前代码和真实读回
```

可选状态：

- `active_reference`
- `candidate`
- `historical`
- `superseded`
- `withdrawn`

`draft` 不能被源码当作稳定契约。源码必须引用稳定 Contract / schema；若一个 Draft 已被大量源码引用，应先抽取稳定契约，再把路线和排期降回研究文档。

## 5. 当前高干扰文档裁决

### 5.1 保留但必须降级

- `design-agent-blueprint-a0-a9.md`：用户概念来源，不是 10 个 Runtime Agent 的当前实现说明。
- `design-agent-os-implementation-tree.md`：历史 implementation inventory，不拥有成熟度和验证命令。
- `design-agent-architecture-optimization-v1.md` / `design-agent-architecture-landing-map.md`：历史架构映射，不是当前入口。
- `design-intelligence-knowledge-system-roadmap-draft.md`：当前仍被源码引用的历史设计来源；在稳定 Contract 抽取前不得删除，也不得拥有当前路线。
- 各类 `*-audit-*`、`*-research-*`、`*-retrospective-*`：只保留证据和反例。

### 5.2 优先删除候选

满足“Git 可恢复、无生产 /脚本消费者、稳定结论已迁移、内容明显失效”的文档可以从工作树删除。当前优先候选包括：

- 一次性 UI /验收截图报告；
- 已不存在源码的重构计划；
- 被正式 Reliability 基准取代的旧 smoke 验收手册；
- 已被 Prompt / OS 裁决吸收且无入站引用的边界 / North Star 工作稿；
- 引用已不存在 Superpowers 能力和 smoke 命令的旧计划。

删除前必须执行引用搜索，并修复现有引用；“没有被链接”本身不是充分理由。

## 6. 项目记忆压缩

- `CurrentTask.md`：恰好一个 H2，固定包含目标、当前事实、实施边界、下一步、验证与未知、状态。
- `Plan.md`：恰好一个当前 H2；步骤和子阶段使用 H3。
- `Status.md`：当前产品结论、当前验证、当前未知和当前风险；不保存逐次运行病历。
- `project-state.json`：当前机器投影；禁止重新加入已完成的历史 `*Slice` 顶层对象。
- `Intake.md`：只保留未完成、暂停或待规划需求；重复细分项合并为用户可观察结果。
- `Backlog.md`：只保留 owner、输入和验证方式已清楚的紧邻任务，不排长期路线。
- `Decisions.md`：只保留仍有效或仍被实现引用的裁决，使用 active / superseded / historical 状态。
- `Risks.md`：只保留当前真实风险；已关闭事故由测试、Decision 和 Git 承担。

不创建 `project-memory/archive/`。Git 是历史记录系统。

## 7. SMART 目标 owner

- `Prompt.md`：稳定结果和阶段治理原则；
- `project-master-plan.md`：跨阶段 SMART 目标和时间盒；
- `Plan.md`：唯一激活阶段；
- `CurrentTask.md`：当前可执行纵切；
- `Status.md` / `project-state.json`：当前基线与结果。

每阶段必须包含 Specific、Measurable、Achievable、Relevant、Time-bound，以及退出 /停止条件。时间盒结束未达标时状态保持失败或待复盘，不移动日期制造完成。

SMART 是研发治理方法，不进入 Agent Prompt、产品 Runtime、Harness Gate 或固定设计工作流。

## 8. 冲突处理

先按事实域裁决：

1. 用户目标和可见取舍：当前用户指令；
2. 稳定产品边界：Prompt；
3. 当前范围：CurrentTask；
4. 当前顺序：Plan；
5. 架构 owner：Design Agent OS；
6. 当前实现与环境：代码和真实读回；
7. 当前验证摘要：Status / project-state；
8. 专业细节：被当前任务激活的 C 层文档；
9. 历史背景：D 层和 Git。

同域仍冲突时，当前、更具体、有真实证据并由 canonical owner 持有的事实优先。历史状态、研究结论和模型自述不能覆盖当前 Host 事实。

## 9. 自动防漂移

维护检查至少应保证：

1. CurrentTask、Plan、activeRequest、activePlan 使用同一任务 ID；
2. CurrentTask 与 Plan 各只有一个 H2；
3. 当前权威文档引用的 `npm run` 命令真实存在；
4. `project-state.json` 可解析并只包含当前投影；
5. A/B 层链接和入口路径存在；
6. 根级 `CLAUDE.md` / `AGENTS.md` 按项目规则同步；
7. UTF-8、LF、仓库卫生与差异检查通过。

ID 漂移和多个当前卡是错误，不能只 warning。历史文档中的已退役命令可以作为历史文本保留，但必须明确其 D 层身份，不能出现在当前操作说明中。

## 10. 写回原则

1. 只更新承担该事实的唯一文档，不做形式化全量同步。
2. 当前任务切换必须同步 CurrentTask、Plan 和 project-state 的活动身份。
3. 当前能力事实变化才更新 Status；长期边界变化才更新 Prompt / OS；阶段定义变化才更新 master plan。
4. 文档清理不能夹带未授权生产改造。
5. 每轮写回后先做相称的快速检查；完成一个文档治理切片后再运行完整核心验证。
