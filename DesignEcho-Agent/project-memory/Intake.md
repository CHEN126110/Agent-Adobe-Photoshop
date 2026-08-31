# Intake

本文件只保留尚未完成、暂停或仍需规划的用户需求。早期细分条目与完成记录由 Git 历史查询，不继续伪装成 30 多个并行 `in_progress` 任务。

## 当前归属规则

- 当前顺序由 `Plan.md` 唯一拥有；Intake 只归类，不调度。
- 一个需求可以合并多个早期条目，但必须保留来源、owner、状态、下一步和边界。
- 用户可见业务策略、默认值或接受阈值变化前仍需业务 checkpoint；共享 Harness、只读契约和不改变业务结果的根因修复不受此限制。

### INTAKE-083 finalArtifactRefs 真实交付引用缺失

- 来源：r23 / r24 / r25 / r36 / r38 多次出现 PSD/JPG 真实落盘但最终 Artifact 引用为空；合并早期 Artifact、Delivery、主图 QA 细分条目。
- 归属层级：Runtime Delivery / Artifact Repository / same-revision visual binding。
- 状态：triaged
- 下一步：代码级首个偏差已修复并通过核心验证；在一次 fresh 受控真机运行中确认 `finalArtifactObserved=true`、PSD/JPG 精确 `runtimeDeliveryResultRefs`、Debug `finalArtifactRefs` 与匹配的视觉出站收据。
- 边界：不放宽收据、不扫描目录补造交付、不让 Harness 代 Agent 宣称完成。

### INTAKE-084 Evaluation 协议稳定性与人类校准

- 来源：r36 / r37 / r38 的 evaluateDesign 失败，以及自动 85–90 分与人工 `needs_fix` 的偏差；合并早期 QA、评分卡和审美校准条目。
- 归属层级：Evaluation Profile / model output protocol / reviewed calibration。
- 状态：triaged
- 下一步：协议完整性、authority 与失败副作用已修复并通过自动验证；下一步用固定缺陷图片和人工标签测关键缺陷检出率、假通过率与分数校准，不把协议通过等同于审美可靠。
- 边界：评审失败不阻断 agentic 首次可逆写入；不建立第二评审器或默认分数兜底。

### INTAKE-085 设计师式视觉感知与构图关系

- 来源：用户 2026-08-31 指出 Agent 虽被定义为设计师，却没有稳定描述图中内容、设计机会、图文关系和创意方向；合并通用设计判断、Design Kernel、DesignIR 与无 Skill 设计条目。
- 归属层级：Agent / Visual Perception / Design Kernel / model-authored working memory。
- 状态：planned
- 下一步：用可选、任务内的 Design Perception Note 与 Composition Intent 做最小 A/B；Agent 作者化内容，Harness 只绑定观察身份、校验结构和编译现有工具参数。
- 边界：不展示私有思维链，不变成固定工作流、表单或写入门票，不由 Harness 填写素材、构图、比例或文案。

### INTAKE-086 图片置入、主体关系与事务可靠性

- 来源：用户关于裁切、缩放、比例和一次准确落位的连续反馈；合并早期智能缩放、图片 placement、Photoshop 验收和合成条目。
- 归属层级：Photoshop Craft / Tool / Transaction / Verification。
- 状态：triaged
- 下一步：先修 `alignToReference` 非统一事务、主体事实版本绑定、EXIF / alpha 坐标一致性和极端放大清晰度；再扩展 Agent 可声明的 protected / text-safe / optical intent。
- 边界：Host 只精确执行和读回，不决定“多大好看”；不新增第二 placement core owner。

### INTAKE-087 主图、SKU、详情页多样本 E2E

- 来源：用户明确的低预期产品目标；合并原主图、详情页、SKU 的细分计划、模板、QA 和交付条目。
- 归属层级：Skill Package / shared Runtime / Photoshop E2E / Delivery。
- 状态：planned
- 下一步：S1 / S2 退出后，按主图 → SKU Template / Color Card / Batch → 详情页，每类至少 5 个未见真实 Case，分别记录技术与视觉结果。
- 边界：业务 Skill 不复制 Agent 循环、TaskRun、Tool、事务、Evaluation 或 Release owner；具体业务策略变更前保留用户 checkpoint。

### INTAKE-079 设计知识、Eagle 与经审核案例

- 来源：用户希望 Agent 会查 Eagle、参考用户设计目录并积累可移除的专业经验；合并知识平面、网页搜索、PSD 学习、Memory 与参考学习条目。
- 归属层级：Knowledge / Memory / Eagle read-only provider / Experience Publisher。
- 状态：planned
- 下一步：先建立与 S2 / S3 评价直接相关的最小案例集，记录“观察 → 方向 → 成品 → 人工理由”，再评估检索与发布收益。
- 边界：未经审核的模型解读、Tool success 和单次截图不能进入正式 Knowledge；不建无消费者的重型知识图谱。

### INTAKE-088 浏览器、桌面与命令能力扩展

- 来源：用户希望 Agent 像 Codex 一样操作电脑；2026-08-31 又明确要求加入系统命令 / CLI，避免只能访问当前项目；合并浏览器、MCP、桌面观察、文件和命令能力条目。
- 归属层级：Tool / Capability Provider / Harness authorization。
- 状态：planned
- 下一步：先由 `INTAKE-091` 闭合附件与受控外部文件来源；随后按只读环境观察 → scope 内文件操作 → argv 化受控命令 → 必要的桌面输入逐级实现，并验证 cwd、授权目录、可执行程序策略、取消、超时、输出上限、环境变量脱敏和副作用读回。
- 边界：CLI 是通用 Harness Provider，Skill 只声明依赖；DesignEcho 获得的是任务范围内接近 Codex 的工程能力，不是默认管理员 shell、全盘隐式扫描或任意后台进程。已安装、可发现或模型请求不等于已授权执行。

### INTAKE-091 上传附件与外部文件的可执行来源绑定

- 来源：用户 2026-08-31 上传“厚袜子女中筒袜…tmall.com天猫.jpg”并要求置入 Photoshop 抠图；Agent 已看到像素和文件名，却因附件没有 Tool 可消费的来源句柄而搜索当前项目、再要求用户提供路径。
- 归属层级：Input Asset / Attachment Provider / File Capability Provider / Tool dispatch / Harness request scope。
- 状态：planned
- 下一步：先实现请求级 `attachmentRef` 注册、不可变字节身份和有限生命周期，让 Agent 显式选择后由 `placeImage` 解析已有字节；再做 `placeImage → removeBackground → 同目标结构 /视觉读回` 的上传、拖拽和剪贴板 E2E。随后支持用户显式路径或选择器授权目录的只读搜索与复制收据，不等待任意 CLI 才解决附件任务。
- 边界：不把 Base64、绝对路径或原始附件长期写入 Prompt /状态；不复用 UXP session token；不从文件名替 Agent 选图；不全盘扫描；不把详情页现有专属附件注入复制进通用 Agent。

### INTAKE-092 主图生产文档、物料槽位与批量导出规范对齐

- 来源：用户 2026-08-31 提供 800 /750 /1200 Photoshop 空骨架截图与 `4.0主图导出所有主图文档.jsx`。截图确认工作画布分别为 1500×1500、1500×2000、1440×2160，三文档均含「点击图」5 个槽位与「转化图」2–5 四个槽位；脚本对三文档两个父组的所有非空子组逐一导出。
- 归属层级：Main Image Skill production structure / delivery inventory / UXP exporter / Photoshop readback verification。
- 状态：in_progress
- 已实现：`main-image-production-spec.ts` 是 Skill-owned 唯一事实源；稳定 5+4 容器与 Agent 逐槽 `slotAssignments` 分离，assignmentKey 贯穿 structure / placement / operation / handoff / dry-run / live request。空骨架只保存 3 份可编辑稿，满 27 槽冻结为 120 步；非法主体 bounds、target /safe box 或低于冻结计划的显式预算写前拒绝。UXP 导出先隔离兄弟子组并保留工作画布，Adapter 以 documentId、Background id、父子路径和规格面板顺序读回。当前增量又统一了 pre-bound / loop-bound agentic Runtime 责任投影，只开放 Manifest 的唯一主图 production entry 并保留 broad atomic Tool；显式 assignments 只展开实际规格，guarded executor、delivery authority、staging、完整提交和实际 Tool result /文件身份形成同一事务链。旧固定 DSL、Project State 三套方案、关键词痛点 /场景、local recipe 和 1200 禁转化已从生产投影清除。
- 下一步：当前增量的 fresh 65 阶段完整核心闸门已通过，完成只读审查、独立提交与推送；随后把生产入口拆成 prepare / finalize，中间由同一 Agent 使用现有通用 Tool 在绑定的 document /group /revision 内完成文字、形状、蒙版、多图和排版。再在正常程序的新普通项目里验证真实 800 /750 /1200 文档、5+4 层级、非空组逐图导出、源文档零意外修改及设计质量；补逐 assignment 视觉观察收据引用，自定义尺寸槽位契约另行立项。
- 边界：截图只能证明容器，不能规定子组内部素材、图层、文案、版式或必须填满的数量；`slotAssignments` 也只是一素材一几何的生产交接，不等于完整设计表达。1200 的四个转化槽先保留，是否必须生产 /交付需用户规则或真实非空成稿证据。工作画布与平台上传尺寸分字段，不能从当前 JSX 猜 800×800 /750×1000 下采样。测试 fixture 不能反向成为生产 Skill 规则，也不能在 Skill 内复制第二套 DesignIR。

### INTAKE-089 工作流画布、交互 UI 与多 Agent 形态

- 来源：用户关于可创建交互卡、可复用工作流、节点画布和专业设计团队的长期产品设想；合并旧 UI、Workflow、A0–A9 和多 Agent 条目。
- 归属层级：UI Projection / Workflow Asset / Design Teams。
- 状态：paused
- 下一步：S3 以后只在单一 TaskRun 和真实执行事实稳定时评估产品化；优先投影现有状态，不先造第二执行器。
- 边界：多角色是逻辑分工，不自动等于多个 Runtime；交互卡不执行任意代码，也不能成为业务判断 owner。

### INTAKE-090 运行效率剖析与质量不退化优化

- 来源：用户 2026-08-31 明确反馈 Agent 运行很慢，希望下一纵切定位并处理；它是现有 S5 目标的前置测量需求，不等同于现在提前牺牲质量提速。
- 归属层级：Runtime Accounting / Model Provider / Tool orchestration / Photoshop Provider / Performance Evaluation。
- 状态：triaged
- 下一步：归因代码已让生产模型请求显式携带 call kind，并记录 context/output/transport/视觉 revision；审查同时修复了截断恢复未重发像素却可能取得视觉信用的事实错误。Tool name/origin/activity 继续由既有 AgentRunRecord 拥有，当前缺单次 Tool duration 时如实标记 unavailable，不复制第二账本。fresh 65 阶段完整核心验证已经通过；提交后固定同一 Case 跑一次，再选择单变量配对实验。
- 边界：没有同 Case 基线不宣称提速；不通过减少必要视觉观察、跳过写后读回、缩短到无法完成的预算、换低质量模型或隐藏等待状态获得速度；优化后技术成功率与人工质量不得显著退化。
