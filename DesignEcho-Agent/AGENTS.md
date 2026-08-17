# AGENTS.md

在开始任何中大型修改前，先阅读以下项目记忆文件：

1. `project-memory/README.md`
2. `project-memory/Prompt.md`
3. `project-memory/CurrentTask.md`
4. `docs/documentation-governance.md`
5. `docs/design-agent-operating-system.md`
6. `project-memory/Plan.md`
7. `project-memory/Status.md`

规则：

- `Prompt.md` 是目标、约束、范围、验收标准的真相源。
- `CurrentTask.md` 是当前这轮任务的需求对齐卡，中大型任务开始前必须更新。
- `documentation-governance.md` 是文档权限分层真相源，定义哪些文档能直接指导当前开发，哪些只能作为参考。
- `design-agent-operating-system.md` 是顶层架构真相源，定义 Agent 控制系统，不负责记录当前阶段细节。
- `Intake.md` 是用户明确要求加入规划或后续处理的需求池，不能只在聊天里承诺。
- `Plan.md` 只维护当前阶段的里程碑和验收动作，不写空话。
- `Implement.md` 是执行手册，定义 agent 应该如何工作。
- `Status.md` 是共享状态和审计日志，每次重要修改后更新。
- `Backlog.md` 只维护明确可执行的待办项。
- `project-state.json` 是机器可读状态，内容必须与 `Status.md` 保持一致。

强约束：

- 不用兜底和掩盖式修复覆盖根因。
- 避免把内部调试能力暴露到用户链路。
- 注意 UTF-8 编码，避免中文乱码进入源码。
- 详情页 / 主图优先走 design skill + scene core，不继续往 executor 堆硬编码。
- SKU 不是当前优先改造对象，除非任务明确要求。
- 项目状态必须区分“已核实（代码/构建/手测）”与“未核实 / 待验证”。
- 新需求先按能力地图分类：Agent 基础设施、Photoshop 操作能力、设计理解能力、设计执行能力、业务场景、benchmark。
- benchmark 不能升级为 skill / tool / 产品能力。
- 开发验收记录、smoke、benchmark 与调试导出只能存在于开发路径；不得进入生产 Runtime 类型、业务状态、模型上下文、Tool 权限、完成判定或用户界面。
- 下一步规划必须能追溯到 `CurrentTask.md`、`Intake.md`、`Backlog.md` 或明确风险项。
- Windows 命令默认使用 `pwsh -NoLogo -NoProfile -Command`；复杂脚本优先放入 `.cjs` / `.ps1` 文件，避免多层 shell 字符串转义污染。
- 默认不要把 `docs` 下的研究、复盘、借鉴或专项计划文档当作当前开发入口；是否可读先看 `docs/documentation-governance.md`。

运行线归一化：

- `v3` 是当前默认真实执行路径：ChatPanel、DesignAgentEngine、旧 Agent 循环、skill executor、UXP / Photoshop 工具链仍以它为主。
- `v5` 是目标治理与契约层：Skill manifest、ReAct / Reflexion、阶段计划、视觉观察上下文和质量复核优先落在这里；视觉观察不拥有执行许可，不能把 v5 契约完成写成 v5 已完全接管运行时。
- `bridge` 是过渡适配层：只负责把 v5 契约和旧工具 / 旧 skill 入口接起来，不允许继续长成新的业务逻辑中心。
- `legacy` 是旧入口、旧命名或旧兼容逻辑：允许为兼容保留，但不得继续扩张；新增能力必须先说明如何进入 v5 manifest / 契约。
- 后续文档、计划、验收和汇报必须区分：契约已完成、桥接已完成、真实运行已完成、Photoshop E2E 已完成。

如果当前任务会改变范围、约束或阶段目标，先更新这些文件，再继续改代码。
