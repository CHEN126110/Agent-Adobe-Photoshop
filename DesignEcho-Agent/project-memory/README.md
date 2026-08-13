# Project Memory

## 目的

本目录用于承载长期任务的外部化状态，避免依赖聊天上下文记忆。

## 文件说明

- `Prompt.md`：目标、范围、约束、验收口径
- `CurrentTask.md`：当前这轮任务的需求对齐卡
- `Intake.md`：用户明确要求加入规划或后续处理的需求池
- `Plan.md`：当前里程碑与阶段顺序
- `Implement.md`：执行手册与更新规则
- `Status.md`：当前事实状态
- `Backlog.md`：待办项
- `Risks.md`：风险与观察项
- `Decisions.md`：关键决策
- `project-state.json`：机器可读状态

## 回顾顺序

每次重新开始前按这个顺序读：

1. `Prompt.md`
2. `CurrentTask.md`
3. `../docs/documentation-governance.md`
4. `../docs/design-agent-operating-system.md`
5. `Plan.md`
6. `Status.md`
7. 如需分类再读 `../docs/agent-capability-map.md`
8. 如需排期再读 `Intake.md` 与 `Backlog.md`
9. 如需判断风险或方案边界再读 `Risks.md` 与 `Decisions.md`

## 写回顺序

每次重要修改后至少更新：

1. `CurrentTask.md`（如果当前任务状态或范围变化）
2. `Intake.md`（如果用户提出新的规划需求，或已有规划项状态变化）
3. `Status.md`
4. `Backlog.md`
5. `Risks.md`
6. `Decisions.md`（如果发生了关键方案决策）
7. `project-state.json`

## 真实性规则

文档中的结论必须落在以下四类之一：

- 已核实（代码）
- 已核实（构建）
- 已核实（手测）
- 未核实 / 待验证

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

如果本轮正在执行中大型任务，必须先在 `CurrentTask.md` 写明：

1. 用户原始需求
2. 必须做
3. 禁止做
4. 归属层级
5. 当前计划
6. 验收证据

## 记忆压缩规则

- `CurrentTask.md` 只保留当前对齐卡；完成后的任务详情由 Git 历史承担。
- `Plan.md` 只保留当前唯一实施主线，不在文件中重复旧阶段或已完成切片。
- `Status.md` 只保留当前事实摘要；`project-state.json` 必须与它保持同一主线和边界。
- `Intake.md` 只保留未完成、暂停或仍需规划的用户需求；已完成条目不复制回工作树。
- `Backlog.md` 只保留当前队列和明确约束；`Decisions.md`、`Risks.md` 只保留仍有效的内容。
- 不创建 `project-memory/archive/` 保存历史副本；需要历史时使用 Git。
- 每次写回后优先运行 `npm run maintenance:planning-check` 和 `npm run maintenance:validate`，并检查 UTF-8、JSON parse 与 `git diff --check`。
