# AGENTS.md

在开始中大型、跨模块或高风险修改前，默认只阅读：

1. `project-memory/Prompt.md`
2. `project-memory/CurrentTask.md` 的第一个 H2 当前任务卡

其余文档按动作读取：改文档权威或架构边界时读 `docs/documentation-governance.md` 与 `docs/design-agent-operating-system.md`；调整排期时读 `project-memory/Plan.md`；核对既有验证、风险或历史选择时再读 `project-memory/Status.md`、`Risks.md` 与 `Decisions.md`。`project-memory/README.md` 只说明文件角色，不是每轮必读材料。

规则：

- `Prompt.md` 是目标、约束、范围、验收标准的真相源。
- `CurrentTask.md` 的第一个 H2 是当前任务卡；只有本轮目标、边界、状态或下一步变化时才更新。
- `documentation-governance.md` 是文档权限分层真相源，定义哪些文档能直接指导当前开发，哪些只能作为参考。
- `design-agent-operating-system.md` 是顶层架构真相源，定义 Agent 控制系统，不负责记录当前阶段细节。
- `Intake.md` 是用户明确要求加入规划或后续处理的需求池，不能只在聊天里承诺。
- `Plan.md` 只维护当前阶段的里程碑和验收动作，不写空话。
- `Implement.md` 是条件性执行参考，不能覆盖本文件的执行优先级。
- `Status.md` 只保存当前已验证产品状态；对应事实变化时才更新。
- `Backlog.md` 只维护明确可执行的待办项。
- `project-state.json` 是机器可读状态，内容必须与 `Status.md` 保持一致。

执行优先级：

1. 当前用户指令决定业务目标、优先级和用户可见取舍；当前代码、真实运行状态和 Tool 读回决定事实；工程 Agent 负责技术路线、实现、兼容、验证与回滚。
2. 开放创意走 `agentic`；存在唯一可校验结果的规格化生产走 `staged`。声明与表单不得成为 `agentic` 写入门票。
3. 未知按对象处理：模型或环境能力未知时允许可逆真实尝试；写入目标、权限、副作用或写入结果未知时先观察、校验或 reconciliation；可选知识与审美信息未知只降级或告警。只有明确不支持、未授权、无效或不安全才终止相应动作。
4. 不把技术方案选择题交给用户。只有用户可见结果无法从目标确定、需要新增预算 / 权限 /责任，或动作不可逆时才询问；其余情况给出专业判断并继续推进。
5. 验证与风险相称。区分已验证、合理推断和未知，禁止伪造；缺少非关键验证不等于任务失败，也不要求面向用户提交证据报告。
6. 历史记录不是当前指令。旧任务、旧计划和事故只作按需背景，不得覆盖第一个当前任务卡和当前代码事实。

强约束：

- 不用兜底和掩盖式修复覆盖根因。
- 避免把内部调试能力暴露到用户链路。
- 注意 UTF-8 编码，避免中文乱码进入源码。
- 详情页 / 主图优先走 design skill + scene core，不继续往 executor 堆硬编码。
- SKU 不是当前优先改造对象，除非任务明确要求。
- 对完成状态、构建、手测和外部能力等重要判断，必须区分已验证、合理推断与未知；普通说明不强制套固定证据标签。
- 只有会改变公共能力归属的新需求才按能力地图分类：Agent 基础设施、Photoshop 操作能力、设计理解能力、设计执行能力、业务场景、benchmark。
- benchmark 不能升级为 skill / tool / 产品能力。
- 开发验收记录、smoke、benchmark 与调试导出只能存在于开发路径；不得进入生产 Runtime 类型、业务状态、模型上下文、Tool 权限、完成判定或用户界面。
- 下一步规划必须能追溯到 `CurrentTask.md`、`Intake.md`、`Backlog.md` 或明确风险项。
- Windows 命令默认使用 `pwsh -NoLogo -NoProfile -Command`；复杂脚本优先放入 `.cjs` / `.ps1` 文件，避免多层 shell 字符串转义污染。
- 默认不要把 `docs` 下的研究、复盘、借鉴或专项计划文档当作当前开发入口；是否可读先看 `docs/documentation-governance.md`。

运行线归一化：

- `v3` 是当前默认真实执行路径：ChatPanel、DesignAgentEngine、旧 Agent 循环、skill executor、UXP / Photoshop 工具链仍以它为主。
- `v5` 是目标治理与契约层：manifest 必须显式区分 `agentic` 与 `staged`。阶段计划只约束 `staged` 生产链；`agentic` 只消费知识、预算画像和任务语义，不以阶段声明取得写入许可。视觉观察不拥有执行许可，不能把 v5 契约完成写成 v5 已完全接管运行时。
- `bridge` 是过渡适配层：只负责把 v5 契约和旧工具 / 旧 skill 入口接起来，不允许继续长成新的业务逻辑中心。
- `legacy` 是旧入口、旧命名或旧兼容逻辑：允许为兼容保留，但不得继续扩张；新增能力必须先说明如何进入 v5 manifest / 契约。
- 后续文档、计划、验收和汇报必须区分：契约已完成、桥接已完成、真实运行已完成、Photoshop E2E 已完成。

如果当前任务会改变范围、约束或阶段目标，只更新承担该事实的唯一文档；不要为了形式同步重写所有项目记忆文件。
