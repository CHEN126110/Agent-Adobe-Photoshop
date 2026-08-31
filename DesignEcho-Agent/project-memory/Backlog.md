# Backlog

> 本文件只保存紧邻当前阶段的可执行队列。长期阶段见 `docs/project-master-plan.md`，未排期需求见 `Intake.md`。

## 当前执行队列

1. **INTAKE-083 / 084**：关闭真实交付引用和 Evaluation 稳定性两个重复 blocker，为 S1 固定 Case 队列清路。
2. **INTAKE-090 运行效率剖析**：复用同一可靠性 Case 建立端到端耗时分解；先定位模型、Tool、Photoshop 或重入中的主瓶颈，质量优化前只做测量和可逆实验。
3. **S1 技术可靠交付基线**：在隔离 Photoshop 副本完成固定 5 Case × 2 轮，记录技术成功、真实恢复、错误归因和外部文档零改动。
4. **INTAKE-085 / 086**：建立 Agent 作者化的设计感知 /构图关系与可靠图片置入事务，作为 S2 A/B 的最小纵切。
5. **S2 设计认知与首次构图**：在同模型、同素材、同工具和同预算条件下比较现行链与新中间表达，不用 Harness 固定审美答案。
6. **S3 业务 Skill 多样本**：主图 → SKU Template / Color Card / Batch → 详情页；每类先完成 5 个真实 Case，再扩样本。

## 当前约束

- 当前任务只有一个；并行只表示可独立调查，不表示多份 `in_progress` 文档可以共同拥有优先级。
- 失败必须回到明确 owner；同一验收项两轮实质不同实现仍同模式失配时启动 GMR。
- 质量稳定前不以减少必要观察换速度；速度优化必须用配对实验证明质量不退化。
- 不创建第二 Runtime、Task Store、Context Compiler、DAG、Verdict、Release Gate、Capability Registry 或文档目标系统。
- `docs/agent-capability-map.md` 只作能力 inventory；代码、真实运行和当前状态决定事实。
