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

- 来源：用户希望 Agent 像 Codex 一样操作电脑；合并浏览器、MCP、桌面观察、文件和命令能力条目。
- 归属层级：Tool / Capability Provider / Harness authorization。
- 状态：paused
- 下一步：设计主链达到 S1 后，再按只读观察 → 文件操作 → 受控命令 → 桌面输入逐级验证任务范围、批准、取消、超时、脱敏和副作用读回。
- 边界：DesignEcho 仍是设计 Agent，不扩成任意电脑控制 Agent；已安装或可发现不等于已授权执行。

### INTAKE-089 工作流画布、交互 UI 与多 Agent 形态

- 来源：用户关于可创建交互卡、可复用工作流、节点画布和专业设计团队的长期产品设想；合并旧 UI、Workflow、A0–A9 和多 Agent 条目。
- 归属层级：UI Projection / Workflow Asset / Design Teams。
- 状态：paused
- 下一步：S3 以后只在单一 TaskRun 和真实执行事实稳定时评估产品化；优先投影现有状态，不先造第二执行器。
- 边界：多角色是逻辑分工，不自动等于多个 Runtime；交互卡不执行任意代码，也不能成为业务判断 owner。

### INTAKE-090 运行效率剖析与质量不退化优化

- 来源：用户 2026-08-31 明确反馈 Agent 运行很慢，希望下一纵切定位并处理；它是现有 S5 目标的前置测量需求，不等同于现在提前牺牲质量提速。
- 归属层级：Runtime Accounting / Model Provider / Tool orchestration / Photoshop Provider / Performance Evaluation。
- 状态：in_progress
- 下一步：历史 r35/r38 已证明模型调用占墙钟约 92%/93%，但调用用途仍是 unscoped。先扩展现有 Runtime Accounting：100% 物理模型调用具备 call kind，100% Tool 调用具备 name/origin，视觉调用关联前一 revision，上下文记录脱敏来源桶；固定同一 Case 跑一次后再选择单变量配对实验。
- 边界：没有同 Case 基线不宣称提速；不通过减少必要视觉观察、跳过写后读回、缩短到无法完成的预算、换低质量模型或隐藏等待状态获得速度；优化后技术成功率与人工质量不得显著退化。
