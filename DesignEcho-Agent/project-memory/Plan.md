# Current Implementation Plan

> 文档类型：B 层当前执行辅助。
> 当前开发权限：只承载一个当前纵切；长期 S1–S5 路线见 `docs/project-master-plan.md`。
> 当前任务：`S1-DELIVERY-REVIEW-ROOT-CAUSE-001`。
> 能力现状：见 `docs/agent-capability-map.md`；该地图只作 inventory，不拥有排期或完成判断。

## S1-DELIVERY-REVIEW-ROOT-CAUSE-001：交付与评审根因闭环

### SMART 结果

- **Specific**：关闭真实交付引用丢失和 Evaluation 协议失稳两个重复 blocker，形成一条可重复、可归因、不会误动外部文档的隔离 Photoshop 技术交付链。
- **Measurable**：`finalArtifactRefs` 精确包含 Agent 声明的同任务可编辑源稿和栅格导出；空引用失败夹具修复前失败、修复后通过；Evaluation 协议缺陷集不再被默认值掩盖；一轮隔离实机 Case 取得真实 mutation、写后结构 /视觉读回、同版本交付和诚实终态；外部文档 revision 变化为 0；核心验证通过。
- **Achievable**：现有 Runtime Delivery Receipt、Artifact Repository、Debug sidecar、Task completion contract、DesignVerdict 与 Design Reliability 已具备大部分链路，本轮只修首个失配 owner，不重建 Runtime。
- **Relevant**：S1 技术成功率的每个正式样本都依赖可信交付和评审终态；这两个 blocker 不闭合，继续跑样本只会重复失败并增加噪声。
- **Time-bound**：激活后 2 个工作日完成代码根因和自动验证；实机环境身份就绪后 1 个工作日内完成首轮隔离 Case。若同一 blocker 经两种实质不同修复仍同模式失败，立即 GMR。

### 执行步骤

1. `[进行中]` 保存 S0 可回滚基线；核对当前 Git、Agent Runtime、UXP Runtime、Debug Bridge、Photoshop 文档和 fixture 状态。
2. `[进行中]` 并行审计 `finalArtifactRefs`、Evaluation / Review 复入链和 Design Reliability Case / Attempt 基础设施，确定首个偏差与唯一 owner。
3. `[待执行]` 为交付引用建立失败夹具并实施最小根因修复；不得扫描目录、扩展完成权限或为主图写专属分支。
4. `[待执行]` 为 Evaluation 协议建立缺陷注入与同 revision binding 验证；审美校准若需要人工数据，保持独立待验证项。
5. `[待执行]` 运行专项测试、Agent Renderer 类型检查、UXP 相关测试和一次完整 `maintenance:validate`。
6. `[待执行]` 在新一次性 fixture 上完成一轮受控真实 Case；记录 canonical Attempt、首个偏差、Artifact、Review 与外部文档保护事实。

### 退出条件

- 自动夹具能复现并守护 `finalArtifactRefs` 首个丢失点，当前链不再把真实配对交付投影为空。
- Evaluation 非法输出诚实失败且可归因，合法输出与当前 TaskRun / target / revision / Review set 精确绑定。
- 一轮隔离实机 Case 取得非空、同版本、可验证的可编辑源稿和栅格导出；错误完成声明与跨文档副作用均为 0。
- 当前改动通过相称专项测试和完整核心验证；已验证事实回写 `Status.md` 与 `project-state.json`。
- 未达到出口时保持 `in_progress` 或触发 GMR，不进入 S1 的 10 次正式分母，不宣布 S1 达标。

### GMR 触发

- 两种不同实现仍在同一位置产生空交付引用或同一 Evaluation 协议失败。
- 新证据证明当前 owner 归因错误，但实现继续在原模块叠加兜底。
- 准备通过扫描目录、默认分数、减少 Case、放宽收据或建立第二状态 owner 获得通过。
- 输入、代码和环境均未变化，却准备再次运行同一重型验证。
