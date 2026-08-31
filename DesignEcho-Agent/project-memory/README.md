# Project Memory

## 目的

本目录用于承载长期任务的外部化状态，避免依赖聊天上下文记忆。

## 文件说明

- `Prompt.md`：目标、范围、约束、验收口径
- `CurrentTask.md`：当前这轮任务的需求对齐卡
- `Intake.md`：用户明确要求加入规划或后续处理的需求池
- `Plan.md`：当前里程碑与阶段顺序
- `../docs/project-master-plan.md`：跨阶段 SMART 路线；不拥有当前任务顺序
- `Implement.md`：条件性执行参考；不能覆盖 `AGENTS.md` 的执行优先级
- `Status.md`：当前事实状态
- `Backlog.md`：待办项
- `Risks.md`：风险与观察项
- `Decisions.md`：关键决策
- `project-state.json`：机器可读状态

## 回顾顺序

每次重新开始默认只读：

1. `Prompt.md`
2. `CurrentTask.md` 的第一个 H2 当前任务卡

其余内容按需要读取：改架构或文档权威时读 `../docs/documentation-governance.md` 与 `../docs/design-agent-operating-system.md`；归类时读 `../docs/agent-capability-map.md`；排期时读 `Plan.md`、`Intake.md` 与 `Backlog.md`；核对既有验证、风险或方案边界时再读 `Status.md`、`Risks.md` 与 `Decisions.md`。历史任务不属于默认上下文。

## 写回顺序

每次重要修改后只更新承担该事实的唯一文档：

1. 当前任务状态或边界变化时更新 `CurrentTask.md`。
2. 用户明确加入规划或规划项状态变化时更新 `Intake.md` / `Backlog.md`。
3. 当前已验证产品状态变化时更新 `Status.md`，并同步 `project-state.json`。
4. 产生长期有效的关键方案决定或风险变化时更新 `Decisions.md` / `Risks.md`。

没有对应事实变化时不要为了完成固定写回清单而改文档。

## 真实性规则

对完成状态、构建、手测、外部能力和用户可见行为等重要判断，应明确它是已验证事实、合理推断还是未知。普通说明不强制套固定标签；暂时无法取得验证时如实保留未知，不得补造日志、测试、引用或运行结果。

## 验证治理规则

1. 项目不再新增、维护或依赖 `smoke-*` 测试脚本；不得因为某个功能暂时缺少 smoke 就补建一次性脚本。
2. 默认验证只使用构建、类型检查、静态审计、规划/仓库卫生检查和已有可复用功能测试；验证失败必须暴露真实原因，不得为了“通过”修改断言、吞掉错误或制造假绿。
3. 旧 smoke 文件和命令应在迁移时删除，不改名为另一种测试继续堆积；历史需要时从 Git 恢复。
4. 项目记忆不得把 smoke 通过写成产品能力、Runtime 完成或设计质量完成。

## 文档治理补充

1. `documentation-governance.md` 定义项目文档权限层级和高干扰文档名单。
2. `docs` 目录下的研究、复盘、借鉴和专项计划文档，默认都不是当前开发入口。
3. 如果某份文档与 `Prompt.md`、`CurrentTask.md`、`Plan.md` 冲突，先按文档治理规则裁决，再继续开发。

## 需求不遗忘规则

如果用户说“加入规划”“纳入规划”“后续要做”“不要遗忘”，必须写入 `Intake.md`。

如果本轮正在执行中大型任务，`CurrentTask.md` 的第一个 H2 当前任务卡应使用精简结构：

1. 目标
2. 当前事实
3. 实施边界
4. 下一步
5. 验证与未知
6. 状态

## 记忆压缩规则

- `CurrentTask.md` 只保留当前对齐卡；完成后的任务详情由 Git 历史承担。
- `Plan.md` 只保留当前唯一实施主线，不在文件中重复旧阶段或已完成切片。
- `Status.md` 只保留当前事实摘要；`project-state.json` 必须与它保持同一主线和边界。
- `Intake.md` 只保留未完成、暂停或仍需规划的用户需求；已完成条目不复制回工作树。
- `Backlog.md` 只保留当前队列和明确约束；`Decisions.md`、`Risks.md` 只保留仍有效的内容。
- 不创建 `project-memory/archive/` 保存历史副本；需要历史时使用 Git。
- 每次写回后优先运行 `npm run maintenance:planning-check` 和 `npm run maintenance:validate`，并检查 UTF-8、JSON parse 与 `git diff --check`。

## SMART 阶段规则

- `Prompt.md` 只保存稳定结果、边界与阶段治理原则；不展开每个阶段的实施清单。
- `../docs/project-master-plan.md` 保存跨阶段目标，每阶段必须有基线、样本、目标值、时间盒、退出条件和 GMR 触发条件。
- `Plan.md` 只展开当前激活阶段；未激活阶段不得以“当前主线”形式并列。
- `project-state.json` 只投影当前任务和当前计划，不保存已完成的历史 `*Slice` 对象。
- 时间盒到期但目标未达成时，状态保持未达成并复盘；不能通过改措辞或移动日期制造完成。
