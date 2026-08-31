# 仓库改动边界说明

> 文档类型：B 层维护工具说明，不是某次工作树快照。
> 当前开发权限：可以指导如何取得当前边界报告；不能替代实际 `git status` 和脚本输出。
> 适用范围：变更分类、工作树卫生、项目记忆、Agent / UXP /文档切片和提交前审查。
> 不能覆盖：CurrentTask、Plan、当前代码、Git 事实和真实验证结果。

更新日期：2026-08-31

## 1. 为什么不再保存“当前改动报告”正文

工作树、分支、worktree 和未跟踪文件会持续变化。把某次扫描结果写入本文件，会让历史现场很快被误读成当前事实。

当前边界必须在任务开始和提交前重新取得：

```text
git status --short --branch
git worktree list
npm run maintenance:repo-hygiene:summary
npm run maintenance:change-boundaries
```

本文件只说明 owner 和验证方法，不保存某次扫描的文件清单、PID、分支或完成状态。

## 2. 改动分组原则

1. **当前纵向切片**：只包含 CurrentTask 授权范围内、可独立验证和回滚的文件。
2. **项目记忆**：只更新承担当前目标、状态、风险或决定的唯一文档，不批量同步历史稿。
3. **生产 Runtime**：Agent、Harness、Skill、Tool、Provider 和 UXP 按 owner 分开；不能用一份“大整理”混合行为变化。
4. **开发验证**：benchmark、诊断和维护脚本不进入产品 Runtime、模型上下文、权限或完成判定。
5. **用户资产和外部目录**：默认不属于仓库清理范围，不因名称像临时文件就删除。
6. **生成物**：dist、node_modules、缓存和日志按 `.gitignore` 与仓库卫生工具处理，不进入提交。

## 3. 当前检查入口

```text
npm run maintenance:planning-check
npm run maintenance:repo-hygiene:check
npm run maintenance:change-boundaries:check
npm run maintenance:project-cockpit
npm run audit:entry-doc-sync
npm run maintenance:validate
```

- 快速文档或状态修改先运行前五项相称检查。
- 一个完整治理 /代码切片结束时运行 `maintenance:validate`。
- 真实 Photoshop E2E、人工盲评和商业质量必须另行记录，不能由维护检查替代。

## 4. 禁止事项

- 不把整个脏工作树作为一个提交；
- 不重置、覆盖或删除来源不明的用户改动；
- 不因某份旧文档写着“已完成”就跳过当前验证；
- 不用管道、输出截断或改断言掩盖失败退出码；
- 不创建一次性 smoke 来证明缺少正式消费者的功能；
- 不把 historical / draft 文档升级为当前任务。

## 5. 结果解释

- `categorized`：文件已进入已知 owner，不等于实现正确；
- `uncategorized`：边界不明，应先归类，不能通过扩大正则静默放行；
- `clean`：Git 工作树没有待处理文件，不等于构建或产品通过；
- `maintenance:validate` 通过：当前源码和治理检查通过，不等于 Photoshop E2E 或设计质量通过。
