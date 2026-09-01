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
12. `[部分完成]` `36a1db51` 已把 Manifest `delivery_plan_binding_required` 与 producer Skill 身份贯穿 agentic Completion 和 E2：普通 PSD/JPG 原子保存、错误 producer、缺 typed plan /文件身份 /revision proof，以及 receipt 后再次保存或内容写入都不能取得正式 completion；完整 Workflow ready receipt 仍可闭合。fresh 65 阶段核心闸门通过。剩余部分是把 prepare workspace 从进程内 Map 收敛为同 TaskRun 可持久化、可 reconciliation 的身份事实。
13. `[已完成]` Run 663 /664 的模型可见路径 GMR 已由 `b10da18a` 落地：首轮从 26 Tool /42,494 schema 字符降为 24 /29,154；`composeDesign`、隔离 `evaluateDesign` 和重复 Skill 手册移为按需，图片 /图形 /可编辑文字原子手柄保留；agentic 通用原则从 6,408 字符降为 1,112 字符。三项高级能力仍可一次装载，fresh 65 阶段核心闸门通过。
14. `[已完成但触发继续 GMR]` 正常程序 Run 665 在新项目用相同自然短提示运行；Agent 形成了合理的主视觉 /辅助素材方向，但 10 次模型调用约耗时 1,176,756 ms、14 次 Tool 仅 11,527 ms，约 15 分钟无内容写入。前三次主图 Skill 调用被 prepare 不应承担的 support refs /scope 拒绝，第四次才成功建空文档；取得明确停滞证据后已停止，不继续购买错误样本。
15. `[已完成待实机]` D-130 已分离 Skill 内部生产契约与模型可见设计接口：主图模型 schema 约 11,007→2,857 字符，绑定后常驻方法上下文降到 2,236，pre-bound Tool schema 约 37,308→32,785；Runtime 参数在入口剥离，prepare 固定 disposable scope 且不提前校验交付字段，基础归组能力直接可达。专项与 fresh 65 阶段核心闸门通过。
16. `[已完成但发现前置故障]` 正常程序启动与窗口检查暴露“礼貌委托被当能力问句 + angle-JSON Tool 协议泄漏”：项目查看 Run 约 4.4 秒结束但 0 Tool，并把内部调用显示给用户。主图复测没有启动；该快响应不计效率收益。
17. `[已完成]` D-131 已让“你可以帮我 +具体只读检查 /参考检索”保留非写入委托语义，写入形态和纯能力问句仍只对话；DSML /XML /angle-JSON 文本 Tool 协议均不能成为自然语言终稿，而进入一次 repair 或诚实协议失败。正常程序原句已真实读取并汇总 30 张项目 JPG（两个子目录各 15 张），自然终稿与独立目录事实一致，协议泄漏为 0。
18. `[已完成待实机]` D-132 已关闭主图复测的新首偏差：正常句末标点 /引号不再让唯一 advisory Skill candidate 消失，能力问句保持无生产候选；单张候选由当前多模态 Agent 直接观察且内部模型调用为 0，设计首轮不再用 `openProjectFile` 打开 JPG，`placeImage` 只提交已选素材；同 run 完全相同的 presentation bytes 不重复进入模型。实现没有增加 Agent 主循环行数或 legacy 正则点，fresh 65 阶段核心闸门通过。
19. `[进行中]` 构建正常程序并在干净新对话重跑原样短提示“帮我设计一张商品主图。”；验证 Agent 主动绑定主图 Profile、首次 Skill prepare、单图观察、首个内容写入、参考选择、唯一规格与 finalize。任何新可归因停滞立即停止，不把通用原子稿或文件存在算成 Skill 成功。
20. `[待开始]` 复测支持精简方向后，把 prepare workspace 最小持久化到既有 TaskRun owner，并注入进程重启、已消费 workspace、TaskRun /project /document /group /revision 和 Host 漂移故障；随后再运行可进入 S1 分母的普通项目 Case。
21. `[待开始]` 闭合 INTAKE-091 的请求级上传附件来源：由 Agent 显式选择 `attachmentRef`，Harness 在同一 TaskRun 内解析真实字节并校验身份，完成一次 `placeImage → removeBackground → 结构 /视觉读回` E2E；通用 CLI 另按 INTAKE-088 的受控 Provider 阶段推进，不用它旁路附件断链。

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
