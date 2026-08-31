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

1. `[已完成]` 保存 S0 可回滚基线并提交 `d44ca46c`；核对历史 Runtime / Debug / Photoshop 证据。
2. `[已完成]` 并行审计 `finalArtifactRefs`、Evaluation / Review 复入链和 Design Reliability 基础设施，确定 DeepSeek 视觉出站收据与 Evaluation authority 为首个偏差。
3. `[已完成]` 建立 r38 失败形态回归并修复 OpenAI-compatible 图片传输、逐图回执、Final Judge binding 和同 revision PSD/JPG 引用链。
4. `[已完成]` 建立 Evaluation 缺陷注入，移除 advisory 完成信用、无效输出副作用和错误的主 Agent terminal recovery；审美校准保持独立待验证项。
5. `[已完成]` 通过专项测试、Agent Renderer 类型检查、UXP 测试与一次完整 65 阶段 `maintenance:validate`。
6. `[已完成]` 提交 S1 代码基线；完成 INTAKE-090 现有 Runtime Accounting 的用途、上下文、输出体量与视觉 revision 归因；同时修复“截断后未重发像素却可取得已观察信用”的事实错误。设计判断与普通任务预算 owner 不变，物理 recovery 成本如实记录。
7. `[进行中]` INTAKE-090 已通过 fresh 65 阶段完整核心验证，当前提交可回滚基线；随后在同一固定 fresh Case 上完成一次 profiling，再在新一次性 fixture 上运行受控真实 Case；记录 canonical Attempt、Artifact、Review、性能归因与外部文档保护事实。
8. `[待开始]` 闭合 INTAKE-091 的请求级上传附件来源：由 Agent 显式选择 `attachmentRef`，Harness 在同一 TaskRun 内解析真实字节并校验身份，完成一次 `placeImage → removeBackground → 结构 /视觉读回` E2E；通用 CLI 另按 INTAKE-088 的受控 Provider 阶段推进，不用它旁路附件断链。

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
