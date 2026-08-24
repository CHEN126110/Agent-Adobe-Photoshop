# 项目文档治理与防偏航规则

日期：2026-07-14

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
5. v3、v5、bridge、legacy 等阶段名如果没有统一解释，容易被误读成多个并行产品版本，或把契约完成误写成真实运行时完成。

## 2.1 运行线归一化规则

当前只承认一条产品演进线，不承认多套互相竞争的顶层架构。

1. `v3`：当前默认真实执行路径。用于描述 ChatPanel、DesignAgentEngine、旧 Agent 循环、skill executor、UXP / Photoshop 工具链仍在承担实际运行。
2. `v5`：目标治理与契约层。用于描述 Skill manifest、ReAct / Reflexion、视觉观察上下文、质量复核、阶段契约和能力边界；视觉观察不承担执行授权。
3. `bridge`：过渡适配层。只允许连接 v5 契约与旧实际工具 / 旧 skill 入口，不允许沉淀业务策略或成为第三套运行时。
4. `legacy`：旧入口、旧命名或旧兼容逻辑。允许保留，不允许扩张。

状态写法：

1. `contract_ready`：契约、schema、manifest 或纯逻辑检查已完成。
2. `bridge_ready`：旧运行线已经能消费新契约或映射关系。
3. `runtime_integrated`：真实运行路径已经接入，而不是只在 smoke fixture 中存在。
4. `photoshop_e2e_verified`：经过真实 ChatPanel / Photoshop / UXP 链路验证。

任何文档不得把 `contract_ready` 或 `bridge_ready` 写成 `photoshop_e2e_verified`。

## 3. 文档权限层级

### A 层：默认当前真相源

默认只让三份短文档直接参与当前任务：

1. [AGENTS.md](C:\UXP\2.0\DesignEcho-Agent\AGENTS.md)
2. [Prompt.md](C:\UXP\2.0\DesignEcho-Agent\project-memory\Prompt.md)
3. [CurrentTask.md](C:\UXP\2.0\DesignEcho-Agent\project-memory\CurrentTask.md) 的第一个 H2 当前任务卡

规则：

1. 当前任务如何做，以 `CurrentTask.md` 为准。
2. 当前总目标和当前北极星，以 `Prompt.md` 为准。
3. 当前代码与真实运行读回决定已经实现和正在发生的事实；历史状态文档不得覆盖它们。

### B 层：条件性执行辅助文档

这些文档有明确价值，但只有在对应动作发生时才进入阅读路径。

1. [documentation-governance.md](C:\UXP\2.0\DesignEcho-Agent\docs\documentation-governance.md)
2. [design-agent-operating-system.md](C:\UXP\2.0\DesignEcho-Agent\docs\design-agent-operating-system.md)
3. [Plan.md](C:\UXP\2.0\DesignEcho-Agent\project-memory\Plan.md)
4. [Status.md](C:\UXP\2.0\DesignEcho-Agent\project-memory\Status.md)
5. [agent-capability-map.md](C:\UXP\2.0\DesignEcho-Agent\docs\agent-capability-map.md)
6. [Intake.md](C:\UXP\2.0\DesignEcho-Agent\project-memory\Intake.md)
7. [Backlog.md](C:\UXP\2.0\DesignEcho-Agent\project-memory\Backlog.md)
8. [Risks.md](C:\UXP\2.0\DesignEcho-Agent\project-memory\Risks.md)
9. [Decisions.md](C:\UXP\2.0\DesignEcho-Agent\project-memory\Decisions.md)
10. [business-skill-design-governance.md](C:\UXP\2.0\DesignEcho-Agent\docs\business-skill-design-governance.md)
11. [project-master-plan.md](C:\UXP\2.0\DesignEcho-Agent\docs\project-master-plan.md)

使用时机：

1. 需要调整文档权威或架构边界时，再读文档治理与 OS。
2. 需要排期、移动优先级时，再读 Plan / Intake / Backlog。
3. 需要核对既有验证时，再读 Status；需要判断历史方案边界时，再读 Risks / Decisions。
4. 需要给新需求归类时，再读能力地图。
5. 需要处理主图、详情页、SKU 场景边界时，再读业务治理文档。
6. 需要看长期路线而非当前实现入口时，再读项目计划书。

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
10. `design-agent-professional-capability-system-plan.md`
11. `agent-governance-implementation-objective.md`
12. `design-agent-os-implementation-tree.md`
13. `design-craft-harness-technical-plan.md`（设计工作法 Harness 技术方案：落地 / 可行性 / 预期 / 风险，2026-08-17）

规则：

1. 专项文档只能服务当前命中的专项任务。
2. 专项文档不能覆盖 A 层真相源。
3. 专项文档若与 `CurrentTask.md` 冲突，先修正 `CurrentTask.md` 或暂停使用专项文档。
4. `agent-governance-implementation-objective.md` 只保留概念到现有 Owner 的实施参考，G0-G7 等历史分组不拥有当前顺序。
5. `design-agent-os-implementation-tree.md` 只保留子系统 inventory 与历史实现证据；其中历史 smoke 名称、旧成熟度和旧 UI 表述不代表当前命令、状态或产品行为。

### 3.1 架构内容的唯一落点

为避免“内容齐全但多处重复”，同一信息只允许一个权威落点：

| 内容 | 唯一落点 | 其它文档允许做什么 |
|---|---|---|
| 产品目标、边界与强约束 | `Prompt.md` | 引用，不复制新的角色 Contract |
| 顶层分层、数据流与 Owner | `design-agent-operating-system.md` | 做代码映射或专项展开，不另建架构 |
| 当前实施顺序、依赖与退出条件 | `Plan.md` | Intake / Backlog 只归类和排队 |
| 当前已核实成熟度 | `Status.md` + `project-state.json` | 能力地图只作 inventory，不覆盖新鲜状态 |
| 当前任务允许修改的范围 | `CurrentTask.md` | 专项文档只有被明确激活才参与实施 |
| 历史选择与当前风险 | `Decisions.md` / `Risks.md` | 不反向生成第二计划 |
| 专业方法、研究与业务细节 | C / D 层专项文档 | 只向当前 Task Profile、Knowledge、Recipe、Skill 或 Evaluation 提供输入 |

新增术语或 Contract 前必须先证明现有 Owner 无法表达该事实。若只是统一展示、跨层摘要或产品说明，使用只读 projection 或文档引用，不建立新的持久化对象、Registry、状态机或 Gate。

### D 层：研究/复盘/借鉴文档

这些文档不是当前实现依据，只能提供背景、启发或反例。

## 4. 已清理的高干扰文档类别

2026-07-14 已删除下列已被 A 层文档取代、且没有运行时消费者的历史文档；如需考古，从 Git 历史恢复，不在工作树继续维护第二套架构：

1. 早期 Agent 架构草案与阶段复盘：`agent-architecture*`。
2. 已完成或失效的过渡计划：`design-agent-execution-plan.md`、`agent-foundation-completion-plan.md`。
3. 已被 Design Agent OS 吸收的研究路线与认知汇总：`design-agent-research-and-roadmap.md`、`design-agent-development-knowledge-base.md`。
4. 外部项目借鉴快照：`claude-code-haha-*`、`agent-mcp-skills-comparison-and-borrowing.md`、`design-agent-architecture-borrowing-plan.md`、`long-horizon-codex-adoption.md`。
5. 一次性 `project-memory/archive/*-pre-2026-06-11.md` 与对应归档脚本；Git 已提供历史追溯能力，不再在仓库保存重复快照。
6. 已与真实代码严重漂移的 `src/main/REFACTOR-PLAN.md`；主进程拆解现状以代码地图和实际目录为准。

以下外部材料仍属于高干扰输入，默认禁止作为开发入口：

1. 用户外部沟通形成的 `Design Agent Studio A0-A9` 架构文本
原因：该文本可作为 Design Agent OS 的角色映射参考，但不能替代 `design-agent-operating-system.md`，也不能把逻辑角色直接升级为已实现的运行时多 Agent 团队。

2. `C:\Users\12611\Downloads\design_agent_studio_rebuild_full_dev_pack_v4\design_agent_studio_rebuild_pack_v4`
原因：该包是 clean-start rebuild 文档包，包含删除旧实现、重新建立 `apps/desktop` / `apps/uxp` 等目录假设的指令；当前项目已经决定不重构、不整包迁移，只吸收 Agent / Skill / Tool / UXP / Photoshop 边界、real/mock/fallback 真实性规则和 UI 产品化原则。

3. `C:\UXP\2.0\docs\long-horizon`
原因：该目录是早期全工作区长任务协作记忆，不是当前 `DesignEcho-Agent` 的默认开发入口；其中部分对齐目标指向已降级的历史架构文档，后续只能作为历史协作记录或背景材料。

根目录 `CLAUDE.md` / `AGENTS.md` 是继承生效的工作区规则，不属于外部高干扰材料。子项目 `AGENTS.md` 只能细化，不能否定根规则；项目当前目标、架构和历史细节仍应放在子项目自己的权威文档中。

特别规则：

1. `REBUILD_PROTOCOL.md` 不适用于当前仓库，除非用户以后明确重新授权 clean-start 重建。
2. 下载包中的 `docs/14_UI_PRODUCTIZATION_SPEC.md`、`docs/32_FRONTEND_CODEX_RULES.md` 只能作为 UI 方向参考；当前 UI 保持现有 DesignEcho 工作台路径，不按下载包重做。
3. 下载包中的 schema、skills、prompts 和 tool_registry 不复制进仓库；如需采用某条规则，必须先映射到现有 OS、能力地图、项目记忆和代码真相源。

## 5. 默认阅读路径

处理中大型任务时，默认阅读顺序收敛为：

1. `AGENTS.md`
2. `project-memory/Prompt.md`
3. `project-memory/CurrentTask.md` 的第一个 H2 当前任务卡

只有在实际动作需要时，才读取文档治理、OS、Plan、Status、能力地图、Intake / Backlog、Risks / Decisions 或命中的专项文档。不得为了“完整回顾”把历史状态日志整体注入当前任务。

## 6. 冲突处理规则

先按事实所属领域裁决，而不是用一条总排序混淆目标、事实和权限：当前任务目标与用户可见边界看第一个 `CurrentTask` 卡；稳定产品边界看 `Prompt`；项目执行原则看继承生效的根 /子项目 `AGENTS`；架构改动按需看 OS；排期看 Plan；既有验证看 Status；实际实现和运行事实以当前代码与真实读回为准。

同一领域仍冲突时，继承生效的根规则与子项目 `AGENTS.md` 优先，其次是当前任务卡和对应领域的唯一文档。专项、研究、复盘和历史状态不能推翻当前规则，也不能把 `staged` 阶段门禁扩展到 `agentic` 路径。

## 7. 新文档创建规则

以后新增文档必须在开头明确写清：

1. 文档类型：真相源 / 执行辅助 / 专项计划 / 研究参考 / 历史复盘
2. 是否能直接指导当前开发
3. 适用范围
4. 不能覆盖哪些上位文档

如果做不到这四点，就不应该新增文档。

删除旧文档必须同时满足：

1. 已被 A/B 层真相源或代码契约覆盖，不再承担唯一现行结论。
2. 没有生产代码、验证脚本或默认阅读路径依赖。
3. 不是仍在使用的专项契约；“没有被链接”不能单独作为删除理由。
4. 文件已进入 Git 历史，删除后仍可追溯。
5. 删除时同步修复现有引用，并运行文档/维护检查。

## 8. 当前立即生效的治理动作

1. 以后默认不从 `docs` 目录随机挑文档开始开发。
2. 高干扰文档必须显式标注“非当前真相源”。
3. `CurrentTask.md` 切换任务时，必须同步说明当前为什么切换，而不是隐式漂移。
4. 新的专项计划必须挂到 OS、Plan 或 CurrentTask 上，不能单独漂浮。
5. 如果某份文档只剩历史价值，优先依赖 Git 历史；仅在仍有独立检索价值时保留为研究/复盘。
