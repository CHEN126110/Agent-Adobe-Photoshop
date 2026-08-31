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
7. `[已完成]` 防污染旁路已根修并以 `217368bd` 提交推送；Task Profile 绑定前后保持中性浏览，旧伪发布被隔离，测试项目 /userData /CDP 使用独立信封，完成态审美复入绑定当前 ReviewSet 与必需 E2 证据。
8. `[已完成]` INTAKE-092 基础生产骨架已以 `3cb1594e` 提交推送：三个真实工作画布、每文档 5 个点击槽 +4 个转化槽、空骨架、逐槽 assignment、动态预算、兄弟组隔离、保画布导出和精确层级读回均有持久回归。
9. `[已完成]` agentic Runtime owner 与主图整组文件事务已以 `a42de03b` 提交并推送：pre-bound / loop-bound 复用同一责任投影，broad atomic Tool 保持可达，guarded executor、delivery authority、staging、实际结果路径、文件身份与 external commit 同源闭合。
10. `[已完成]` 开放创意的 `prepare → Agent 分层设计 → finalize` 已由 `293dd3df` 提交推送：prepare 只建一个 Agent 明确规格的标准工作文档 /空组并返回 TaskRun-bound workspace；Agent 使用现有通用 Tool 完成文字、形状、蒙版、多图和排版；finalize 只对账同一任务、项目、document /group /revision 和真实非空组，再走 exact staged file transaction。持久回归覆盖未修改、空组、TaskRun /document /group 漂移、跨 Reflexion generation /Skill 成功交付和重复 finalize，未复制第二套 DesignIR；fresh `maintenance:validate` 通过 65 个核心检查。
11. `[已完成但未达出口]` 与提交一致的正常 Agent / UXP 已在新普通项目运行自然短提示和一次“继续”。`69c54867` 证明条件 Tool Schema 可执行，`b4998b65` 证明续跑能以 `structured_run_resume` 恢复 Runtime identity，外部文档 revision 零变化；但 Agent 旁路 prepare /finalize 产生 800 /1440 两套交付，最终 1440 PSD 只有 3 层，且裁切摄影图被 Evaluation 以 89 分误放行为完成，因此不计入专业质量分子。
12. `[进行中]` 收敛主图正式交付唯一 owner：prepare workspace 必须成为同 TaskRun 可持久化、可 reconciliation 的身份事实；通用保存 /导出不得在 workspace 存在时结算 Main Image Skill completion。用旁路交付、重复规格、扁平化再置入、进程重启和身份漂移负例证明正式交付只能由同 workspace finalize 闭合。
13. `[待开始]` 在新的普通项目重新运行自然短提示；先证明唯一规格、复杂可编辑分层、同任务 finalize、PSD/JPG 同版本与外部文档零变化，再用用户成稿 /Eagle 参考对 Evaluation 的商业质量误放行做 advisory 校准。
14. `[待开始]` 闭合 INTAKE-091 的请求级上传附件来源：由 Agent 显式选择 `attachmentRef`，Harness 在同一 TaskRun 内解析真实字节并校验身份，完成一次 `placeImage → removeBackground → 结构 /视觉读回` E2E；通用 CLI 另按 INTAKE-088 的受控 Provider 阶段推进，不用它旁路附件断链。

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
