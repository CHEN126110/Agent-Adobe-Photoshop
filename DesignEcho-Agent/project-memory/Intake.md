# Intake

本文件只保留尚未完成、暂停或仍需规划的用户需求。已完成的 Intake 条目由 Git 历史保留，不在工作树重复维护。

## 当前归属规则

- 当前实施顺序以 `Plan.md` 为准；Intake 不拥有 Runtime 调度权。
- 每个条目保留来源、归属层级、状态和下一步/边界，避免规划遗忘。
- 新增“加入规划 / 后续要做 / 不要遗忘”事项时，必须新增一个 `INTAKE-*` 条目。
- 主图、详情页、SKU 的具体业务策略、用户可见默认值和接受阈值改动前必须先告知用户并完成 checkpoint；共享 Harness、只读契约收敛、静态审计和不改变业务输出的 bugfix 不受此阻塞。

### INTAKE-083 finalArtifactRefs 空引用反复拒收的配对交付根因
- 来源：正式采样五次同类失败（r23/r24/r25/r36/r38，最新 2026-08-30 r38：quality=artifact_completed、PSD+JPG 真实落盘、外部文档保护成立，但 `runtimeDeliveryResultRefs` 为空导致收据拒绝）。触发目标条款「同一 blocker 重复→根因复盘」。
- 归属层级：Runtime 交付阶段证据投影（`projectDeliveryStageEvidence` → `collectRuntimeFinalArtifactPaths`）与 UXP 配对交付收据（d112/1a3f95d3 线）。
- 状态：triaged
- 下一步：判别假设——r35（saveDocument+quickExport）refs 非空、r38（saveDocument×2 出 PSD+JPG）refs 空；核对 saveDocument-as-JPG 的结果是否缺少 raster 交付收据/未进入 producer receipt 选择；修复后用 fresh fixture 复验。
- 边界：不放宽收据校验、不让 Harness 代 Agent 声明交付；只修"真实交付事实未被投影"的记账链。

### INTAKE-084 evaluateDesign 评审链路三连败稳定性
- 来源：r36（评审器 JSON 解析失败）、r37、r38 三次真实运行各出现一次 evaluateDesign 失败；r36 因此陷入重试烧穿预算。
- 归属层级：Evaluation owner（评审器输出协议/解析），不动通用循环。
- 状态：triaged
- 下一步：聚合三次失败的具体错误文案与模型输出形态，判定是解析器过严、提示词欠约束还是模型输出截断；修复后观察评审开机率。
- 边界：评审失败不得阻断 agentic 写入（既有裁决）；不引入第二评审通道。

### INTAKE-081 现有 Design Harness 架构与 Owner 收敛
- 来源：用户 2026-08-03 明确判断项目内容基本齐全但较杂乱，要求继续理顺整体架构；同时确认“从零创作”是 Agent 本身设计能力，不应增加独立代码定义。
- 归属层级：Design Agent OS / Task Semantics / Runtime / Execution / Evaluation / Documentation Governance。
- 状态：in_progress
- 下一步：按 F1/F2 + X1 双车道并行，消除 task type / artifact knowledge / Manifest / document role 重复身份，把 RuntimeSession 原地升级为 TaskRun，并按 capability pack 切换 R4、TransactionRunner、Verification 与 Release Owner。
- 边界：不新增角色 Runtime Contract、任务族枚举、Task / Outcome Contract、第二 Registry、第二 Runtime 或“从零创作”子系统；标准设计 Agent 身份由 Prompt / OS 定义，生产责任由现有 Owner 承担。

### INTAKE-079 设计知识平面、视觉知识浏览器与 Agent 混合检索
- 来源：用户 2026-08-01 明确要求先审计现有知识库，研究适合设计类 Agent 的可视化知识体系和外部最佳实践，再给出重构建议与报告。
- 归属层级：F1/F2 Design Foundation / Knowledge Plane / Context Compiler / Evaluation。
- 状态：planned
- 当前事实：K0 研究与报告已完成，生产实施尚未启动。
- 下一步：按 F1/F2 先收敛 Task Profile / artifact knowledge crosswalk 与阶段化 Context，再做只读 `CatalogRepository + provider contract + Retrieval Trace shadow`；视觉 Explorer、精确 /词法 baseline 和版本化 query set随后推进，混合文本与视觉索引必须建立在 baseline 之后。
- 边界：关键词只保留 exact /FTS /BM25 检索作用，不拥有意图、Skill、Tool、权限或完成裁决；不建大一统向量库、第二 Context Compiler、第二 Memory Store、第二 Artifact Store或全库 GraphRAG；TaskRun 只可产生候选，不可直写 canonical knowledge。
- 报告：`docs/design-knowledge-system-reconstruction-report.md`。

### INTAKE-078 有效 Design Harness、常驻设计底座与受审演进
- 来源：用户 2026-08-01 明确要求 Agent 不再靠感觉猜测，必须理解主图、SKU、详情页等需求，具备设计知识、项目 /知识库 grounding、Adobe Photoshop 工艺和真实完成能力；Hermes 可作为机制参考。
- 归属层级：Design Agent OS / Task Semantics / Design Kernel / Photoshop Craft / Evaluation / Reviewed Learning。
- 状态：planned
- 下一步：按 F1/F2 与 X1 双车道会合推进；再完成 X2/V0、F3/V1、M5 Release 收口、M6 通用及业务真实 E2E、M7 受审经验。写节点仍严格依赖 TaskRun + preflight + target/revision + capability-pack TransactionRunner。
- 边界：基本交付物语义和通用设计能力不依赖业务 Skill；Hermes 不拥有 Runtime、Photoshop 执行或质量结论，自动 Skill 演进不得在 M7 前进入生产。

### INTAKE-077 Design Agent 单一 TaskRun、可执行计划、Design Kernel 与防御性减重
- 来源：用户明确需求与 2026-07-30 架构收口。
- 归属层级：Runtime / Photoshop Transaction / Design Kernel。
- 状态：planned
- 下一步：按 `Plan.md` 的 F1/F2 + X1 → X2/V0 → F3/V1 实施；旧 M3-A～M3-D 责任按纵向 capability pack 切换和退役，不再作为全仓水平阶段墙。

### INTAKE-076 泛详情页整单闭环、验收续跑与真实交付
- 来源：用户真实详情页复测反馈。
- 归属层级：Runtime R4/R5/E2 / Photoshop Delivery。
- 状态：in_progress
- 边界：必须依附通用 Runtime，不得把详情页固定流程写入 Agent 核心。

### INTAKE-072 按重规划顺序开始落地
- 来源：用户对当前主线重排的明确要求。
- 归属层级：Project Planning / Runtime Governance。
- 状态：in_progress
- 下一步：只按当前 `Plan.md` 的两车道纵向会合主线推进。

### INTAKE-070 Agent 审美判断、候选审议与偏好校准
- 来源：用户长期能力规划。
- 归属层级：Evaluation / Reviewed Memory。
- 状态：paused
- 边界：V1 与唯一 Release Gate 形成真实任务事实前不实施偏好自动更新或经验晋升；只读评价目录校准可作为 F 车道输入，但不取得发布权威。

### INTAKE-069 Agent 运行态情境认知与工作流 / 对话主控闭环
- 来源：用户长期能力规划。
- 归属层级：Operating Context / Runtime。
- 状态：planned
- 边界：不得建立第二 Context Store 或第二 Workflow Runtime。

### INTAKE-067 ComfyUI 式节点卡片与画布能力扩展
- 来源：用户产品形态探索。
- 归属层级：UI / Workflow Projection。
- 状态：paused
- 边界：只能投影同一 Runtime 事实，不能成为第二执行器。

### INTAKE-066 按需设计决策与受控 Agent 演进
- 来源：用户长期能力规划。
- 归属层级：Design Kernel / Memory / Evaluation。
- 状态：paused
- 边界：不得用学习或演进掩盖 Runtime 不稳定。

### INTAKE-061 主模型与视觉模型自由组合
- 来源：用户能力规划。
- 归属层级：Provider / Capability Resolution。
- 状态：in_progress
- 边界：视觉模型拥有感知权，不拥有执行授权或完成裁决。

### INTAKE-056 SKU 双模板语义、布局感知与占位治理
- 来源：用户业务 Skill 规划。
- 归属层级：SKU Skill overlay。
- 状态：in_progress
- 边界：具体设计策略前必须先用户 checkpoint，不能反向定义 Agent 架构。

### INTAKE-054 专业方法、Artifact 与 R4 成熟度治理
- 来源：用户专业能力治理要求。
- 归属层级：Knowledge / Artifact / R4 Governance。
- 状态：in_progress
- 边界：契约或 bridge ready 不得写成 Photoshop E2E verified。

### INTAKE-037 Agent 治理目标具体化与实施顺序
- 来源：用户 Agent 架构治理要求。
- 归属层级：Design Agent OS / Project Planning。
- 状态：in_progress
- 已进入：当前 `Prompt.md`、`Plan.md` 与 `design-agent-operating-system.md`。

### INTAKE-002 所有回复的流式输出与可观察步骤
- 来源：用户产品体验规划。
- 归属层级：UI / Agent Runtime Observability。
- 状态：in_progress
- 边界：只投影真实运行事实，不暴露 raw tool JSON。

### INTAKE-003 Agent 能力地图与业务场景边界
- 来源：用户架构规划。
- 归属层级：Capability Map / Skill Governance。
- 状态：in_progress
- 已进入：`docs/agent-capability-map.md` 与当前 Plan。

### INTAKE-004 网页搜索获取设计知识
- 来源：用户知识能力规划。
- 归属层级：Knowledge / Source Governance。
- 状态：planned
- 边界：外部内容只能作为 data-only evidence，不授予权限。

### INTAKE-005 Grid DSL 与网格排版
- 来源：用户设计底座规划。
- 归属层级：Design Kernel / Layout Knowledge。
- 状态：planned
- 边界：必须服务通用 Design Kernel，不进入业务 executor 分支。

### INTAKE-006 Photoshop 验收工具
- 来源：用户真实 Photoshop 验收要求。
- 归属层级：Photoshop Verification / Evaluation。
- 状态：in_progress
- 下一步：绑定最新 document / target / revision，不能以 Tool success 代替验收。

### INTAKE-007 智能缩放与 Photoshop 自由变换
- 来源：用户 Photoshop 能力规划。
- 归属层级：Photoshop Craft / Tool。
- 状态：planned
- 边界：先完成通用事务与读回边界，再扩能力。

### INTAKE-008 文本工具与文本排版底座
- 来源：用户设计底座规划。
- 归属层级：Design Kernel / Photoshop Craft。
- 状态：in_progress
- 边界：不把单 case benchmark 写成通用质量结论。

### INTAKE-009 多 Agent 系统
- 来源：用户长期架构规划。
- 归属层级：Design Teams / Runtime。
- 状态：planned
- 边界：多角色不是当前必须拆出的多个产品 Runtime。

### INTAKE-010 Design Agent OS 总架构与数据契约
- 来源：用户架构规划。
- 归属层级：Design Agent OS / Shared Contracts。
- 状态：in_progress
- 已进入：`docs/design-agent-operating-system.md`，当前 Plan 只保留实施主线。

### INTAKE-011 端到端自动设计闭环
- 来源：用户产品目标。
- 归属层级：Design Kernel / Runtime / Photoshop E2E。
- 状态：in_progress
- 边界：必须经过真实 Provider、Photoshop、读回、Evaluation 和 Delivery。

### INTAKE-012 Photoshop 实时聚焦执行反馈
- 来源：用户 Photoshop 使用体验反馈。
- 归属层级：Operating Context / Photoshop Bridge。
- 状态：in_progress
- 边界：连接状态和执行授权仍由各自唯一 owner 管理。

### INTAKE-013 图文文案证据链
- 来源：用户详情页 / 主图内容规划。
- 归属层级：ProductTruth / Knowledge / Skill overlay。
- 状态：planned
- 边界：事实来源必须可追溯，不能由文件名或模型自述补造。

### INTAKE-019 主图项目素材候选预检
- 来源：用户主图能力规划。
- 归属层级：main-image-design / Asset Understanding。
- 状态：in_progress
- 边界：只读候选 evidence，不直接授权 Photoshop 写入。

### INTAKE-020 主图 DSL 与执行证据对齐
- 来源：用户主图能力规划。
- 归属层级：main-image-design / Design DSL。
- 状态：in_progress
- 边界：必须映射当前 Runtime owner，不新增主图专用调度器。

### INTAKE-021 主图截图 QA 与输出验收证据
- 来源：用户主图验收要求。
- 归属层级：main-image-design / Verification / Delivery。
- 状态：in_progress
- 边界：截图或 benchmark 不得单独升级为质量通过。

### INTAKE-022 主图截图探针就绪与结果文件证据
- 来源：用户主图验收要求。
- 归属层级：main-image-design / Artifact / QA。
- 状态：in_progress
- 边界：文件证据必须绑定真实 revision 和交付收据。

### INTAKE-023 主图结果像素探针适配器
- 来源：用户主图视觉验收规划。
- 归属层级：main-image-design / Evaluation。
- 状态：in_progress
- 边界：像素探针是开发验证，不是产品质量裁决的唯一来源。

### INTAKE-024 主图 QA 报告聚合器
- 来源：用户主图验收规划。
- 归属层级：main-image-design / QA / Release。
- 状态：in_progress
- 边界：最终裁决仍归唯一 Release Gate。

### INTAKE-026 Design Agent OS 子系统实施树
- 来源：用户架构实施规划。
- 归属层级：Design Agent OS / Documentation Governance。
- 状态：in_progress
- 已进入：`docs/design-agent-os-implementation-tree.md`，不拥有当前排期。

### INTAKE-027 Planner 执行前控制面
- 来源：用户 Agent 治理规划。
- 归属层级：Planner / Capability / Preflight。
- 状态：in_progress
- 边界：执行前约束必须保护真实边界，不能阻断开放式模型理解。

### INTAKE-028 主图/详情页业务 skill 边界校准
- 来源：用户业务 Skill 治理要求。
- 归属层级：Skill Governance。
- 状态：in_progress
- 边界：`main-image-design`、`detail-page-design`、`sku-batch` 具体设计策略前必须先用户 checkpoint。

### INTAKE-029 项目素材理解与 ProjectAssetIndex
- 来源：用户素材理解规划。
- 归属层级：Project Context / Asset Understanding。
- 状态：in_progress
- 边界：素材理解只提供只读上下文，不推断商品事实或授予执行权。

### INTAKE-030 Agent 性能预算与资源控制面
- 来源：用户 Agent 稳定性规划。
- 归属层级：Runtime Accounting / Liveness。
- 状态：in_progress
- 边界：真实 usage 缺失时保持 unknown，不用预算补丁掩盖 owner 问题。

### INTAKE-031 主图、详情页、SKU 三个业务 skill 拆分治理
- 来源：用户业务 Skill 治理要求。
- 归属层级：Skill / Knowledge / Evaluation Governance。
- 状态：in_progress
- 下一步：先完成用户 checkpoint，再做具体设计策略改动。

### INTAKE-032 图片置入、智能缩放与 Photoshop 执行验证
- 来源：用户 Photoshop 能力规划。
- 归属层级：Photoshop Craft / Tool / Verification。
- 状态：in_progress
- 边界：执行必须绑定目标、revision 和写后读回。

### INTAKE-033 详情页验收模板自动识别与陷阱验证
- 来源：用户详情页验收规划。
- 归属层级：detail-page-design / Verification。
- 状态：in_progress
- 边界：模板识别不能固化固定屏数或品类关键词到通用 Agent。

### INTAKE-034 Project Asset Understanding Intake
- 来源：用户素材上下文规划。
- 归属层级：Project Context / Product Understanding。
- 状态：in_progress
- 边界：只整理有来源的 asset role 与观察，不读取任务文本替代 Brief。

### INTAKE-035 Business Skill Image Placement Verification Intake
- 来源：用户业务 Skill 执行验证规划。
- 归属层级：Business Skill / Image Placement / Verification。
- 状态：in_progress
- 边界：business skill 不能拥有第二套执行器或完成裁决。

### INTAKE-036 Business Skill Execution Plan Intake
- 来源：用户业务 Skill 计划契约规划。
- 归属层级：Business Skill / R4 Plan Contract。
- 状态：in_progress
- 边界：计划声明不授予权限，必须经过当前 Runtime 的 preflight 与执行 owner。
