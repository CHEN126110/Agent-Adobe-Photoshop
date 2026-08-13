# Backlog

## 当前执行队列

1. **F1 `TASK-PROFILE-CROSSWALK-001`**：收敛现有 task type、artifact knowledge、Manifest / Skill 与 document role；`design-task-types.ts` 演进为唯一 Task Profile / crosswalk Owner，不增加第二 Registry、任务族或关键词 Router。
2. **F2 `STAGE-AWARE-DESIGN-CONTEXT-001`**：复用唯一 Context Compiler，按当前 Stage 装载 Design Foundation / Knowledge；只读，不授予权限。F1/F2 可与 X1 并行。
3. **X1 `TASKRUN-TRANSACTION-VERTICAL-001`**：现有 RuntimeSession 原地升级为最小可挂起 TaskRun，拥有 revision-bound interaction、节点 operation result、document / revision 与单文档写者身份；Runner 按 V0 capability pack 迁移。
4. **X2 `R4-DIRECT-EXECUTION-SLICE-001`**：只对完成 X1 Owner 切换的节点开放 R4 受控执行，并在同一切片退役对应 reconciliation / continuation / completion 重推断。
5. **V0 `TARGETED-PHOTOSHOP-OPERATION-VERTICAL-001`**：真实 Provider + disposable PSD 验证“看准、写准、读回准”，不宣称设计质量。
6. **F3/V1 `PHOTOSHOP-CRAFT-RECIPE-001 + NO-SKILL-DESIGN-VERTICAL-001`**：用真实素材、确定文案和品牌约束完成无业务 Skill 的受限单画布设计，接入同一 Release Gate 的首条真实消费路径；不建立“从零创作”子系统。
7. **M5 `UNIFIED-RELEASE-GATE-001`**：迁移全部旧消费者，分离执行提交、同目标验证、设计裁决、交付就绪和用户接受。
8. **M6 `GENERIC-AND-BUSINESS-LIVE-E2E-001`**：无 Skill 单画布 → 主图 → SKU Template / Color Card / Batch → 详情页的真实 Provider + Photoshop E2E 与多样本复核。
9. **M7 `VERIFIED-TASK-METRICS-001`**：真实指标、隔离经验候选、人工批准、Canary 与回滚；不按调用次数自动学习。

## 当前约束

- 只按 `Plan.md` 顶部主线排期；历史切片不拥有执行顺序。
- 主图、详情页、SKU 可以继续做共享 Harness、只读契约、必要 bugfix、验收和边界澄清；具体业务设计策略、用户可见默认值或接受阈值改变前必须先用户 checkpoint。
- 不创建第二 Runtime、第二 Task Store、第二 DAG、第二 Verdict 或第二 Capability Registry。
- 标准设计 Agent 身份只存在于产品与治理边界，不实现为 Runtime Contract、任务族枚举、第二 Intent Router、Capability Registry、Tool permission owner 或 Completion owner。
- F 车道不授予 Photoshop 写权限；任一 X / V 写节点仍必须同时具备 TaskRun、Capability、preflight、稳定 target / revision 和 TransactionRunner owner。
- 任何删除都要有调用图、替代 owner、正反回归和明确的不可删除安全边界。

## 后续候选

候选需求保留在 `Intake.md`；未进入当前 M3 主线的条目不在本文件重复展开。已完成条目和历史排序由 Git 提供查询，不再复制到工作树。
