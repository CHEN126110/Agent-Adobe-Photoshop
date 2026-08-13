# Current Task

## 2026-08-13 HARNESS-RECOVERY-AND-DIAGNOSTICS-001：按当前代码核对并执行运行恢复改造

### 用户目标

先核对 `C:\Users\12611\Desktop\DesignEcho-Agent-改造任务书-20260813.md` 与当前共享工作树的真实实现，再执行仍然成立的任务；不得按过期行号机械修改，也不得为了通过检查放宽目标文档、revision、图层身份或源文件保护。

### 当前代码判断

1. 外部任务书是用户本轮明确激活的专项输入，但不覆盖 `Prompt.md`、Design Agent OS 和当前 canonical owner。
2. T1 已在当前工作树修复：`USER_DESIGN_PHASES` 使用 `ReadonlyArray`，当前 22 项核心验证已包含 Main / Renderer 类型检查通过，因此不重复改动数组。
3. T2 仍然成立：`debug:runs` 只扫描仓库根并报告 2 条档案；真实 `E:\WERKE` 与 `D:\A1 neveralone旗舰店` 项目目录合计存在 420 条 `agent-run-record/v0`。
4. T3 / T4 / T6 涉及 Photoshop 写入安全和事务 owner；必须先按当前调用链区分已经修复的恢复路径、仍存在的死锁和旧任务书假设，再做通用根修。
5. T5 若当前数学退避仍被成本档上限抵消，可作为独立低风险修复；T7 必须保持内部诊断与用户结果投影分层，不能重新把原始错误泄漏给用户。

### 本轮必须做

1. 修复真实运行诊断的项目根发现、月份过滤、扫描根命中统计与运行档案 Tool 序列展开。
2. 核对并修复 Provider 截断恢复的输出窗口和恢复调用会计，不让系统补偿轮再次受同一普通轮上限阻断。
3. 只在当前代码证明恢复出口不可达时修改目标绑定或失败后读回门禁；保留读后写、documentId / revision、未知写状态和不可逆保护。
4. 审计任务书列出的十个高频 UXP 写工具；已经由 `PhotoshopTransactionRunner` 验证的工具不重复迁移，只补真正缺少读回自证的入口。
5. 保证任何 `success:false` 在内部诊断链具有稳定机器码和可行动摘要，同时继续只向普通用户显示自然、必要的信息。
6. 使用现有正式验证、真实运行档案和 UXP build 验证；不新增一次性 Smoke，不修改断言或债务基线制造假绿。

### 本轮禁止做

- 不重修已经完成的 `inputCoverage` 或 T1。
- 不用关键词、文件名或品类分支替代结构化目标身份。
- 不往 `autonomous-agent.executor.ts` 增加 SKU / 主图 / 详情页专属控制流。
- 不把未知 Photoshop 写状态直接放行，也不因通用读取不足就伪造操作已经完成。
- 不清理、提交或覆盖当前大面积共享脏工作树。

### 当前实施顺序

1. T1 / T2 基线核对；T1 标记已满足，先实施 T2。
2. 并行审计 T3 / T4、T5 / T7 与十个 UXP 写工具的当前事实。
3. 先落低风险、独立且可验证的 T2 / T5 / T7，再处理有明确恢复不变量的 T3 / T4 / T6。
4. 运行 `maintenance:validate`、`debug:runs --since 2026-08`、Tool / Executor 审计和 UXP production build，并单独标记未做的 Photoshop E2E。

### 状态

`implementation_complete / t1_already_satisfied / t2_discovers_420_real_records_and_since_filter / t3_guarded_skill_atomic_owner_wired / t4_bounded_unknown_write_recovery_and_exact_not_applied_unlock / t5_truncation_backoff_accounting_fixed / t6_ten_high_frequency_writes_strict_readback_audited / t7_machine_and_actionable_failure_diagnostics_complete / maintenance_22_passed / dirty_worktree_preserved / live_photoshop_e2e_pending`

### 本轮实施结果

1. `debug:runs` 现在从显式 `--project`、历史会话的真实 `projectPath` 及稳定项目集合根发现档案，支持 `--since YYYY-MM`；默认读取 420 条真实 Run Record，`--since 2026-08` 精确读取 202 条，并以这些档案作为列表、汇总、JSON 和 Tool Trace 的主数据源。8 月口径复现 78 / 202 成功、1919 次 Tool Call、193 次失败，不再混用 73 条会话摘要。
2. Workflow Skill 内部原子 Photoshop 调用新增 Harness-owned 串行执行 owner。`sku-color-card` 不再直接绕过通用 preflight；私有 target guard 只由 Harness 根据真实 documentId / revision 注入，切换文档后必须重新读取再写。
3. 失败写入恢复区分三种事实：`not_applied` 不锁同批独立写入；`unknown` 只允许两次有界、同文档读取且不重放原写入；读回 revision 未变化时解除旧 provider 并允许替代方案，发生变化或无法确认时继续 fail closed。
4. Provider 截断恢复使用 1× / 2× / 4× 输出窗口并受模型硬上限约束；两次恢复调用仍进入 Provider/运行记账，但不重复消耗普通模型调用预算。真实 Agent 行为用例验证 1200 / 2400 / 4800 三次调用后正常完成。
5. 任务书列出的十个高频 UXP 操作入口都已具备工具专属真实状态读回；内容/结构写入通过 `PhotoshopTransactionRunner` 验证目标、结果和失败回滚，`selectLayer` 则直接核对完整活动图层 ID 集合。文字创建与批量换文案会读取 live `textItem.contents`，不再把请求参数当作成功结果。
6. Agent 与 UXP 公共失败边界保证 `success:false` 具有稳定 `code`、具体原因和下一步；原工具机器码保持不变。目标文档/revision 冲突仍在写前硬中止，但 UXP/MCP 直接调用也会得到完整自然诊断。
7. `maintenance:validate` 的 22 项核心检查全部通过，包括 Main / Renderer 类型检查、真实 Agent 行为、业务边界、162 Tool 注册、正式测试和 UXP production build；最新 Renderer production bundle 也已单独构建。当前 Electron 主进程 10:26 启动，早于 11:40 的新 Renderer，因此未执行旧进程上的无效真机测试，也不把自动验证表述为桌面端 E2E 或设计质量通过。
8. 当前共享工作树仍有 303 项变更（248 修改、7 删除、48 未跟踪）。本轮没有暂存、提交、分支切换、清理或恢复这些内容；T8 仍由人工决定如何拆分提交。

## 2026-08-13 DESIGNER-FIRST-HARNESS-001：设计师体验与后台自动记账分离

### 用户目标

让 DesignEcho 的 Agent 在体验上像一名真正的设计师：理解需求后只查看会影响下一步判断的必要内容，尽早开始可逆制作，查看效果并调整；不要让 Agent 背诵 Harness、Runtime、阶段、权限、证据或验收协议，也不要把内部检查过程当成用户交付。

### 架构判断

1. 用户反感的不是结果必须真实，而是系统把“证明自己”交给模型，导致设计师以工程审计口吻思考、汇报，甚至为了满足强硬证据措辞而生成看似完整但不真实的结论。
2. 设计 Agent 不应生产证据。文档身份、revision、真实 Tool 结果、保存和导出回执应由执行边界自动取得；模型既不能自报这些事实，也不需要向用户解释它们。
3. 真实性门槛仍然必要：未真实写入不能说已设计完成，未保存不能说已保存，未导出不能说已导出，不可逆覆盖仍需确认。它们属于后台状态与安全，不是设计方法或用户界面。
4. 开发侧仍需真实构建、类型检查和行为回归；禁止删除失败、修改断言或制造假绿。产品 Agent 去“证据化”不等于工程验证去事实化。

### 本轮必须做

1. 把生产模型提示中的 Harness / Runtime / Task Profile / 阶段打卡 / 证明式措辞改成简洁的设计师工作语言。
2. 压缩 Capability Session 对模型暴露的内部目录、指标和引用信息，只保留当前可用动作、必要的按需能力目录和最短使用说明。
3. 把过程面板与收尾文案从“执行、处理、任务验收结论、自动检查”改成“查看、制作、设计过程、当前版本”等自然设计语言。
4. 保留后台 documentId / revision、读后写、写后查看、保存 / 导出回执和不可逆确认；不新增通用 Evidence 对象或 Evidence 阶段。
5. 用现有类型检查、核心审计和可复用行为测试验证；不新增一次性 Smoke，不改断言制造假绿。

### 本轮禁止做

- 不因删除“证据”字样而放宽目标文档、图层身份、源文件覆盖或真实交付边界。
- 不要求模型生成证明材料、验收清单、阶段报告或工程诊断。
- 不把内部 Capability id、Profile、Runtime 指标和 provider 计数继续倾倒进用户可见过程。
- 不在本轮顺带重写 SKU 业务流程；本切片先修通用 Harness 与设计师体验边界。

### 完成判断（开发侧）

- 生产模型的核心提示使用设计师语言，并明确尽早制作、按需观察、看效果后调整。
- Capability Prompt 不再输出 Runtime 自我模型、Manifest、Provider-backed 指标、验收工具和权限解释。
- 用户过程区不再显示“任务验收结论”“正在执行 / 已处理”等工程流水线语言。
- 后台仍能阻止零写入、错目标、缺读回和伪保存被判为完成。
- 类型检查与相关正式审计如实通过；任何失败都保留并报告，不以调整断言取得绿色结果。

### 状态

`implementation_complete / designer_prompt_capability_runtime_and_message_context_simplified / internal_recovery_language_compacted / skill_model_projection_active / user_process_and_final_result_projection_active / plain_question_and_confirmation_card_separated / raw_runtime_errors_private / sku_user_private_diagnostics_split / sku_prerequisites_before_default_combo_card / trustworthy_mutation_copy_only / automatic_operation_facts_preserved / core_22_validated / live_desktop_design_quality_pending`

## 2026-08-12 AGENT-RUNTIME-SIMPLIFY-AND-RECOVER-001：恢复简单的 Agent → Skill / Tool 执行链

### 用户目标

简化对 Agent 没有生产意义、反而制造多 Owner、非法参数组合和失败分支的代码与架构内容，恢复与通用 Agent 一致的主链：理解用户目标；匹配到完整 Skill 时直接调用 Skill；没有匹配 Skill 时由主 Agent 自主规划并组合原子 Photoshop Tool；写后观察、有限修正并交付。SKU 是完整 `sku-batch` Skill，不在通用 Agent / Harness 复制 SKU 业务流程。当前真实项目为 `E:\WERKE\C-1245`；`D:\A1 neveralone旗舰店` 只作为设计质量验证集。

### 已核实根因

1. `declareDesignIntent` 曾向 SKU 固定 Profile 注入不适用的 `workMode`，导致 Bundle 拒绝并误报 `runtime_declared_manifest_missing`。
2. advisory Skill recommendation 曾被 Executor / Agent 转换成“必须先声明 Runtime”的硬门，并把首轮 Tool Schema 收窄成单一控制 Tool；这违背“匹配 Skill 就直接调用”的 Agent 主链。
3. 未绑定运行只有 6 model / 10 tool / 8 iteration / 120 秒；隐藏开场读取、普通观察和控制 Tool 共用额度，首次 Photoshop 写入前即耗尽。并行读取在剩余槽不足时还会同步抢光预算。
4. SKU 缺模板时会返回结构化 nonFatal 设计交接，但后续原子 Tool 曾依赖 Runtime 绑定才可见，导致 Skill 已决定继续设计、Agent 却没有“手”。
5. Photoshop / UXP 已真实返回只读结果；被预算或 Harness 拒绝的调用没有到达 Host。Completion 0/4 是零写入的诚实结果，不是阻断原因。

### 本轮必须做

1. 保持一个通用自主循环：模型看到注册 Skill 与普通原子 Tool，基于语义自行选择下一步；候选路由只作提示，不授权、不拦截、不强制声明。
2. Skill 匹配时直接调用 Skill。Skill 拥有领域方法、阶段、输入输出和恢复策略；通用 Agent / Harness 不维护 SKU、主图或详情页的专属流程分支。
3. 没有匹配 Skill 时，主 Agent 必须拥有看图、建画布、置图、文字、变换和读回的最小充分工具面，自主完成开放设计。
4. `declareDesignIntent` 仅保留为可选的后台 Task Profile 绑定；它可以加载专属方法、预算和评价，但不是分析、调用 Skill、写入或完成任务的许可。
5. Skill 的结构化 nonFatal 交接可通用激活其声明的后续原子 Tool；该机制只改变下一轮可见 Schema，不执行 Tool、不授予权限，也不按品类分支。
6. 继续保留真正的 Harness 职责：目标 documentId / revision、读后写、显式保护、不可逆操作确认、写后同目标读回、真实交付与预算硬上限。
7. 使用现有构建、类型检查、审计和可复用行为测试验证；不新增临时 Smoke，不修改断言或抬高债务基线制造假绿。

### 本轮禁止做

- 不把 Skill recommendation、Task Profile 或方法论读取变成开工权限。
- 不在通用 Agent、Capability Resolver、文档权限或 Completion 中新增 SKU 专属分支。
- 不用固定 DAG 接管开放创意；只有组合数量、命名、目标一致性、不可逆风险等唯一答案继续确定性校验。
- 不降低 Completion 条件，不用预算扩容掩盖死锁；未绑定预算恢复到普通 Agent 可完成工作的合理总上限，但仍是硬 ceiling。
- 不新增第二 Runtime、Task Store、动态插件系统、Resume Manager 或核心关键词路由。
- 不在当前大面积未提交工作树中做无关删除、格式化或跨模块重构。

### 当前实施顺序

1. 已删除 recommendation → mandatory declaration → 单 Tool Schema 的启动硬门；首轮保持 Skill 与通用设计 Tool 可达。
2. 已把未绑定自主运行恢复为 16 model / 50 tool / 30 iteration / 420 秒总上限，并取消尚未绑定 Profile 时的无效终局 Judge 预留。
3. 已把 Skill nonFatal 交接接到通用 continuation：只激活 Skill 结构化声明且仍在 allow ceiling 内的后续原子 Tool。
4. 已保留共享 Runtime Profile Resolver 作为可选后台能力；合法 Profile 由 Manifest / Evaluation 派生，错误仍精确分类，但不再拥有开工权限。
5. 已把 SKU 领域入口收为一个完整 `sku-batch` Skill；色卡、模板、组合生产由 Skill 内部阶段承接，通用 Executor 无 SKU 控制流。
6. 已完成类型检查、核心测试和 Agent / Capability / Runtime / Skill Package / Executor 审计；Renderer production build 已被 14:53 创建的新 Renderer 进程加载。Host、Photoshop UXP 与 129 个实时 Tool 正常，项目根为 `E:\WERKE\C-1245`。

### 本轮实施结果

1. `sku-batch`、其他已注册 Skill 和通用设计原子 Tool 在未绑定 Runtime 的首轮即可见；`declareDesignIntent` 不在默认启动基线中，也不再由 recommendation 强制签发。
2. 匹配 SKU 时，模型应一次语义核对后直接调用完整 Skill，不重复规划 Skill 内部阶段、不先创建确认卡，也不先声明 Runtime。没有匹配 Skill 时，主 Agent 直接规划原子 Tool。
3. SKU full 缺模板时返回的结构化 nonFatal handoff 会激活该交接列出的文本、形状、置图、保存和读回 Tool；后续仍经过通用 Tool preflight、目标一致性和破坏性操作确认。
4. `ecommerce.sku_batch.v1#default` 仍拒绝伪造通用 `workMode`；若模型主动选择可选 Profile 且形状错误，只允许一次精确结构修复，不进入无界控制循环。
5. Runtime Profile 目录完全由已注册 Manifest、Evaluation 与模式安全边界派生；当前 16 个 Profile 可声明，详情页 `analyze_only` / `export_only` 两个未收窄模式保持阻断。SKU Template 已复用通用设计 Evaluation 并可声明，不新增专属评价 Owner。
6. 预算停机仍按实际模型 / Tool / 时间维度报告；零 mutation 明确没有可验收成品。Completion 继续要求真实写入、正确目标、同目标读回和显式交付义务。
7. 自动验证全部通过：Main / Renderer 类型检查、`npm test`、Agent 业务边界、Capability Resolver、Runtime Declaration、Skill Package、Skill Standard、Skill Coupling、通用 Executor 与定向 `diff --check`。
8. production bundle 时间为 14:50，当前 Renderer 进程于 14:53 创建并已加载该构建。DesignEcho Host / Photoshop UXP 正常、pending request 为 0、实时 Tool 129 个；当前活动文档是有未保存改动的 `SKU.psb`（800×800，11 层），因此本轮只读核验，没有把自动测试冒充真实 SKU 写入或设计质量完成。

### 验收证据

- 裸 `帮我做 SKU` 的首轮能力面包含 `sku-batch`，不要求先调用 `declareDesignIntent`；Skill 匹配后可直接执行。
- 无匹配 Skill 的设计请求拥有最小充分的观察与原子设计 Tool，不因缺 Runtime Profile 退化成只读循环。
- SKU 缺模板的结构化交接可以在同一 Agent 运行中继续设计，不依赖品类硬编码或第二个 Runtime。
- 可选 Runtime Profile 仍返回准确错误并受安全发布目录约束；它不拥有 Skill 选择或写入许可。
- 核心自动验证通过；真实 Photoshop 写入、同目标读回和设计质量仍单独记账。

### 状态

`audit_complete / simple_agent_skill_tool_path_restored / mandatory_runtime_declaration_gate_removed / generic_skill_continuation_reachable / unbound_autonomy_budget_restored / automated_regressions_passed / renderer_built_and_loaded / host_uxp_reconnected / dirty_worktree_preserved / live_sku_write_and_design_quality_pending_safe_window`

## 2026-08-11 LIVE-SKU-AUTONOMOUS-DESIGN-VALIDATION-001：真实项目 SKU 自主设计、效率与质量验证

### 用户目标

在不启动第二个 DesignEcho / Photoshop 实例的前提下，直接使用当前已运行程序和真实项目 `C:\Users\12611\Desktop\测试\测试`，让 Agent 自主完成 2 双、3 双、4 双装 SKU 组合设计。`D:\A1 neveralone旗舰店` 仅作为人工质量验证集，用于校准 INS 与纯色成品的版式、产品呈现和完成度，不复制其文件或把当前袜子样本写成业务特例。

### 已核实基线

1. 当前桌面程序真实选中项目为“测试”，项目素材共 41 张，输出、PSD、模板与 SKU 目录在基线前均为空；Photoshop 当前无打开文档。
2. 普通用户请求已通过当前应用的既有调试桥提交，没有新开应用。运行先调用一次项目联系表视觉分析，随后仍把 `sampleSize=12` 填满并逐张调用视觉模型。
3. 前 7 个近看样本中有 6 张相近模特照；最终运行耗时约 20 分 33 秒、24 iterations、25 model calls，仍为 0 Photoshop mutation、0 输出文件，并以 `tool_preflight_blocked` 收尾。该问题不是超时太短，而是项目观察失控后又被无文档入口和缺模板假 handoff 阻断。
4. 项目目录中没有 CSV / XLSX 文件；“桌面表格”尚未在可读取的 Excel 会话或项目文件中出现。组合事实不可猜测，后续必须从当前应用真实数据源取得，或精确报告缺失字段。

### 本轮必须做

1. 复用现有 Project Visual Sampling /项目图片分析 Owner，使联系表成为首轮语义覆盖证据；近看只补联系表明确标记的不确定关键素材，不再按模型请求无条件填满样本数。
2. 采样必须按素材角色 /目录保持多样性，并受任务级视觉预算硬约束；不得连续分析同类近重复模特照。
3. 联系表已有结构化产品理解时，优先确定性生成摘要，避免为了复述同一结果再付出一次模型调用。
4. 项目图片分析作为交付任务中的前置观察必须有界，不能成为终点；预算耗尽前必须保留首次有效 Photoshop 写入、写后读回和终局评价供给。
5. 在现有正式审计 /行为测试中覆盖联系表成功、关键近看、角色多样性、模型请求超额、失败降级和交付任务继续推进；不新增一次性 Smoke。
6. 完成代码与核心验证后，只在用户当前真实程序自然重启并加载新构建后复跑同一项目；不得为了测试自行启动第二个应用实例。

### 本轮禁止做

- 不增加 SKU /袜子 /2-3-4 双装关键词路由，不把验证集目录变成生产知识或模板来源。
- 不因追求速度取消首次真实观察、商品事实校验、写后同目标读回或最终视觉评价。
- 不猜测 4 双组合、颜色名或产品款式；事实源缺失时必须指出具体缺失项。
- 不把静态审计通过写成真实 SKU 成品已完成，也不把当前超时任务强制终止或杀掉用户应用。

### 本轮实施结果

1. 联系表成功时只补其明确点名的不确定关键素材；近看按语义角色去重并受视觉预算约束，已有产品理解时不再追加一次模型总结。
2. `sku-batch` 成为合法的无文档入口：工作流可先读取项目、创建 2/3/4 双模板文档，再按现有写入预检和 revision 规则执行；普通原子写入仍需已有文档。
3. 完整 SKU 任务缺模板时不再弹方向确认或只返回观察型回执，而是在同一 Workflow 的 repair continuation 中开放最小的项目观察、创建画布、图形/文字、占位符、截图、保存和验收读回能力；独立模板任务仍先确认方向。
4. 用户原文明确“自行判断/你决定”时，组合候选可作为 `agent_delegated_draft` 自主生成，但保持 `authoritativeBusinessFact=false`；前置色卡 /模板可用后默认仍展示组合卡，确认后再生产，不能把算法候选冒充正式上架配置。
5. SKU Runtime 预算由旧八阶段遗留的 26 模型 / 90 工具 / 50 iterations / 600 秒收敛为四阶段生产链的 16 / 50 / 30 / 420 秒；保留 6 张候选与 2 次视觉分析给缺模板首稿和定向复验。
6. Renderer/Main 类型检查、Agent 业务边界、Capability、Skill Package、Tool Registry 与通用 Executor 审计已通过；真实 Capability Session 验证模板续跑工具实际可见，`deleteLayer` 不在该最小工具面中。

### 状态

`live_baseline_completed_20m33_24_iterations_25_model_calls_zero_mutation / repeated_sampling_no_document_and_missing_template_handoff_root_causes_fixed / core_audits_and_typecheck_passed / product_table_source_unresolved / current_app_untouched / validation_set_read_only / live_rerun_pending_after_existing_app_reload`

## 2026-08-11 AUTONOMOUS-DESIGN-KERNEL-V1：自主设计、完整视觉评价与有界自修正

### 用户目标

用户要的不是“会调用 Photoshop 的 Agent”，而是默认自主完成专业设计的 Agent：自行理解目标与素材、形成设计判断、制作可编辑结果、查看真实成品、发现问题并定向修正；只有商品/品牌事实冲突、不可逆操作、能力真实缺失或有界返工仍不达标时才请求人工介入。

### 根因判断

1. 现有系统已有 Task Profile、阶段 Context、设计知识、Photoshop Tool、逐图视觉观察、Evaluation Profile、DesignVerdict 与 Reflexion，但它们没有组成所有创意任务默认必经的同一质量闭环。
2. 普通自然语言在循环内晚绑定 Task Profile 后，只补 Manifest 方法/工艺上下文；启动时未激活的 reviewed memory 不会回补，Reflexion 新 generation 也复用启动时的 Project State / Memory 快照。
3. 详情页 Skill 已提供同 document/history 的全部屏级 `VisualObservationBundle`，但终局 Judge 只选择一张完整画布截图，跨屏叙事、屏覆盖和局部缺陷没有进入同一 R5 视觉评价。
4. 当前“候选方案”大多是文字策略或固定选择，不是真实多稿比较；这属于后续 CandidateSet / DesignIR 切片，不能用更多 Prompt、更多 Agent 或业务专属 Skill 伪装完成。

### 本轮必须做

1. 复用唯一 Context Compiler，让 Task Profile 晚绑定和每次 Reflexion generation 都能取得当前 Project State、当前任务适用的 reviewed memory 与阶段化 Design Kernel 上下文；不建立第二 Context 或 Memory owner。
2. 把现有 `VisualObservationBundle` 投影为 R5 即时视觉评价集合：单画布一图，详情页为全部目标屏；集合必须精确覆盖预期目标、无重复/缺图/越界，并绑定同一 document/history 与 Runtime 签发的视觉 receipt。
3. 终局 Judge 一次消费完整集合并输出既有断言结果；缺任一目标或版本漂移时保持未评价，不能用最近一张图代替整套设计质量。
4. 只有完整、可归因的视觉 diagnosis 才能驱动现有有界 Reflexion；质量状态与“流水线执行完毕”分离，不能用 `pipelineCompleted` 代替 `qualityPassed`。
5. 扩展现有正式审计与行为回归，运行 Main/Renderer 类型检查和 `maintenance:validate`；不新增临时 Smoke，不抬基线。
6. 让运行成本随任务复杂度确定性缩放：精确属性替换保持最小工具面与零不必要视觉；`edit_existing` 使用短阶段、轻输出和有界评审；完整创意才获得策略、多候选、Design Team 与完整 R5 预算。所有 generation 与子 Agent 必须消费同一请求级账本，预算耗尽不能通过 Reflexion 或委派重新购买。

### 本轮禁止做

- 不新增主图/详情页/SKU 关键词路由、品类状态机或第二 Runtime/Store/Gate/Verdict。
- 不让模型、Skill 或 Tool 自报 `qualityPassed`；质量仍由现有 Evaluation Profile + DesignVerdict 产生。
- 不把 R4 语义声明全局改成可执行；真实写入仍经 Capability、preflight、稳定 target/revision 与 PhotoshopTransactionRunner。
- 不把一轮代码验证描述为“已经稳定做出优秀商业设计”；真实 Provider → Photoshop、多素材样本与人工审美校准仍是独立验收。
- 不用关键词把普通问句升级为 Photoshop 写任务，也不为省 token 取消写后同目标读回、范围外保护或完整多画面终审。

### 实施顺序

1. 先闭合 generation-scoped 设计上下文刷新和多画面 R5 评价，这是自主返工能够成立的前置。
2. 同切片修正 Design Team 执行完成与质量通过的状态语义，避免失败流水线取得写入/完成信用。
3. 下一纵切建立通用 CandidateSet + Preview + DesignIR：完整新创意默认比较两个真实低成本预览，只让胜者进入昂贵 Photoshop 生产；局部编辑和确定性模板填充不强制多稿。
4. 最后用无业务 Skill 单画布、主图和详情页多样本验证首稿分、返工增分、屏覆盖、人工接受率与耗时，再决定是否扩大能力包。
5. 同步收口成本执行面：R0 结构化声明 `taskType + workMode`，模式级阶段与模型调用策略生效，父 Agent / Reflexion / Design Team 共用累计预算；精确改单字只在已确认写入信封内启用确定性 scope，并证明目标唯一后使用 CAS 写入。

### 当前状态

`code_complete_for_generation_context_reviewset_and_request_scaled_cost_core / exact_text_signed_scope_unique_target_cas_and_final_history_verified / full_21_check_maintenance_passed / candidate_set_design_ir_next / no_new_runtime_store_gate_or_business_route / live_provider_photoshop_cost_and_reviewed_design_quality_unverified`

### 本轮实施结果

1. 普通设计请求通过结构化 `taskType + workMode` 绑定运行身份；局部 `edit_existing` 使用短阶段、轻输出、关闭额外 thinking 与最小 Capability ceiling，完整新创意仍保留策略、完整视觉评价和有界返工预算。
2. 精确改单字只在控制面已确认 Photoshop 写入且 Engine 签发 `exact_text_replacement` scope 时成立。Harness 用一次完整 acceptance snapshot 证明全文档唯一目标，随后把真实 `layerId`、原文、`documentId@historyStateId` 作为 CAS 注入 `setTextContent`；问句、图层名、属性不明确、目标重复、快照截断或版本漂移均不得写入。
3. 写后验收必须同时证明用户要求的新值、范围外未变化、acceptance before/after 完整可比，并与最终 Host history 完全一致；最终 history 缺失或后续又发生 mutation 时保持未完成。满足这些条件时直接复用自动 acceptance after 作为 fresh structure，省掉一次重复层树读取。
4. Photoshop UXP 的文字 CAS 统一规范化 `CR/LF`，避免多行文字被误判 stale；81–128 字合法替换不再被 80 字展示摘要误伤。
5. Provider 图片只在首次需要的模型请求中发送，随后退休像素并保留结构化观察；父 Agent、Reflexion 与 Design Team 共享累计成本账本，Team allowance 事前预记且不退款，预算耗尽不能自动购买下一代。
6. 自动验收已通过完整 `maintenance:validate` 21 项核心检查，包含 Main/Renderer 类型检查、UXP production build、工具/Skill/能力/业务边界审计、中文编码、仓库卫生与核心测试。该结论证明代码和治理边界，不证明真实 Provider → Photoshop 已达到目标延迟/费用或商业审美质量。

## 2026-08-11 AGENT-OBSERVATION-LIVENESS-002：证据饱和后的行动推进与目标绑定

### 切换原因

用户提供了真实 SKU 纠错运行记录：Agent 很早就发现“自选备注产物放入整张图片而不是色卡”，但随后反复读取同一文档结构、画布、项目资源、智能对象和设计方法，重复复述相同结论；中途又把 `SKU.psb` 错当问题文档，直到后段才确认它其实是色卡源文档。运行最终没有执行修复，并在视觉预算耗尽后再次请求视觉能力。本切片治理通用 Agent 的观察效率和 liveness，不把样例固化成 SKU 品类分支。

### 用户原始需求

1. Agent 发现问题后应高效形成下一动作并执行，不能在看图、读文档和搜索项目之间反复空转。
2. 已经取得足够证据时，应停止重复观察；若证据指向错误目标，应先纠正目标身份，再做一次最小定向观察。
3. 真实任务仍须保留必要的写前事实、写后同目标读回和质量评价，不能为了速度降低真实性。

### 必须做

1. 依据真实运行记录区分重复调用、重复结论、目标漂移、错误恢复指令和真正的新进展。
2. 复用现有 TaskRun / Agent liveness owner，把观察进展绑定到稳定目标与 revision；相同目标、相同 revision、相同观察结果不能因换 Tool、换措辞或重复控制声明被计为进展。
3. 当只读观察已饱和且任务仍要求 mutation 时，向模型返回结构化行动压力：选择当前可执行动作、一次最小缺失观察，或诚实停止；不得继续扩大泛化搜索。
4. 写入后仍必须重新开放同目标读回；document / revision 变化、目标纠正、失败恢复或明确证据缺口也必须允许必要观察，避免把缓存变成陈旧事实。
5. 复用现有核心审计和 Agent 行为测试；不新增临时 smoke，不修改断言或提高债务基线制造假绿。

### 禁止做

- 不用 SKU、色卡、自选备注等关键词在通用 Agent 中硬编码路线。
- 不按 Tool 名粗暴禁止重复；不同 Tool 可能提供结构、像素、文本或目标身份等不同证据。
- 不把“看过一次”当作永久充分；目标、revision、mutation 或证据覆盖变化后必须允许重新观察。
- 不由 Harness 替模型决定具体设计内容或伪造下一 Photoshop 动作。
- 不新增第二 Task Store、第二观察账本、第二 liveness owner 或新的业务状态机。

### 归属层级

- 观察身份与结果指纹：现有 Agent Runtime / TaskRun trace 的通用 liveness 输入。
- 是否允许真实 Tool 执行：现有 Capability Session、execution preflight 与 PhotoshopTransactionRunner，不由观察去重逻辑授予。
- 业务修复内容：模型或已选择的 Workflow / Skill；Harness 只要求其在证据饱和后作出可执行选择。
- 完成与质量：现有 operation result、同目标 verification、DesignVerdict 与后续 Release，不由调用次数推断。

### 当前计划

1. 已完成：还原附件时间线并对照生产代码，确认裸 `.jpg` 被误解释为导出义务、任意成功读取刷新续跑、缓存快照仍重复进入视觉预算、同义读取重复计为新事实，以及 `needs_reobserve` 缺少可解除状态转换是主要通用根因。
2. 已完成：复用现有 Agent Runtime / TaskRun / RuntimeSession owner 建立 revision-scoped 读取复用、语义进展指纹、有限 novel-fact credit 和文档变更后的重新规划闭环；没有新建观察账本、Runtime、Store 或 SKU 品类分支。
3. 已完成：缓存命中不再重新发给用户或视觉模型、不消耗视觉候选；相同目标 / revision 的重复成功读取不再清零续跑守卫；真正的 TaskRun、document、revision、operation result、输入或 outcome 变化仍会推进进展键。
4. 已完成：退役从任务正文和文件扩展名猜导出 /关闭动作的第二恢复 owner；只读失败保留 Host 精确错误，不再被重写成“大文档”之类无证据结论。
5. 已完成：正式业务边界审计覆盖缓存签发身份、revision 作用域、视觉去重、语义 liveness、文本恢复退役和 reobserve 状态序列；Renderer / Main 类型检查、简化棘轮与完整 21 项 `maintenance:validate` 全部通过。
6. 待实机：用重启后的真实 Provider → Photoshop 复跑同一纠错任务，测量首次有效 mutation 延迟、重复观察率、视觉调用数、revision 收敛与同目标读回。

### 实施结果

- `getCanvasSnapshot` / `getAnnotatedSnapshot` 只在可信 `documentId@historyStateId` 作用域内复用；缺少可信 revision、Harness 质量验收、写入、导出、切换或新建 /关闭文档时不复用或立即失效。
- 缓存回执由 Runtime 以对象身份签发，模型或 Tool 仿造 `cacheHit` 字段不能跳过观察、事实记录或视觉验收。
- 未完成续跑键不再包含“成功 Tool 总数”；不同读取 Tool 返回同一事实也不再凭 Tool 名刷新进展。novel fact 只提供有限额度，防止不断换观察方式无限续命。
- 文档被用户或外部进程修改后，旧 plan 保持不可重放；TaskRun 进入 `needs_reobserve` 并回到 R2。完整创意链只有到 R4 重新绑定观察到的新 revision 并生成新 plan 后才恢复写入；无 R4 的 SKU 确定性工作流则只能由同一 R2 的真实 Photoshop 观察确认 conflict revision 后恢复 E1。旧 revision 的写入仍被拒绝，`needs_reobserve` 期间 revision 再次变化会重新废弃旧 R2 及下游证据。
- `getDocumentInfo`、`getLayerHierarchy`、模板解析与两类快照共用 revision-scoped cache key；文档屏障、活动图层变化、undo /redo、项目状态写入、资源导入 /生成都会使相关运行级缓存整体失效。cache hit 不能更新执行目标、满足 R2、进入 Stage Trace 或增加用户可见“已查看 /成功调用”计数。
- 这套治理只减少无效观察，不削弱首次结构读取、目标纠正、revision 变化、mutation 后同目标读回和最终质量验收。

### 验收证据

- 同 target / revision 的等价观察不会让 no-progress 计数清零，也不会反复消耗视觉预算。
- 结构、文本、像素等确实补齐新证据时仍可继续，document / revision 变化或 mutation 后不会被错误去重。
- 已获授权且仍欠 mutation 的任务在观察饱和后只能选择可执行动作、一个明确缺口的最小观察，或诚实停止，不能再次泛搜项目和重复解释。
- 代码与核心验证通过不等于真实 SKU 已修复；最终仍需真实 Provider / Photoshop 运行记录证明首次有效动作延迟和重复观察率下降。

### 状态

`code_complete / root_causes_confirmed / revision_scoped_read_reuse_core_validated / semantic_liveness_core_validated / reobserve_replan_loop_core_validated / prose_and_extension_action_recovery_retired / full_21_check_maintenance_passed / no_new_runtime_store_or_sku_branch / live_provider_photoshop_unverified / sku_arrange_dynamic_business_fix_separate_pending`

## 2026-08-10 AESTHETIC-ASSET-COMPOSITING-001：审美知识、选图与 Photoshop 合成闭环

### 切换原因

用户指出详情页设计 Agent 存在三类相连问题：不能稳定判断素材是否适合首屏、置入后只完成几何摆放而缺少剪切/主体适配/合成关系、虽有设计知识却不能据此发现并自主修复问题。实码审计进一步确认，通用 `placeImage` 在没有明确素材时会隐式采用“白底产品主图”检索默认值，自动模式又绕过候选阈值；详情页视觉修复工具集则缺少剪切蒙版和合成关系修复能力。本切片将审美定义为“基于任务语境与真实画面观察的专业判断能力”，并把判断落实为可解释、可执行、可复核的一条纵向闭环。

### 用户原始需求

1. Agent 应知道详情页首屏的视觉职责，能判断白底图、场景图、模特图、细节图等素材适合直接使用、裁切进容器、抠图重组、仅作辅助，还是应当拒绝。
2. Agent 应理解 Photoshop 图层、容器、剪切蒙版、智能对象、主体边界、混合与图层样式之间的关系；不能把“文件已置入且大小大致正确”误报为设计完成。
3. 审美 Harness 应建立在专业知识储备、真实观察、当前任务语境和可解释判断之上，并能驱动有限、定向的自主修复，至少避免明显低完成度结果。
4. 同时治理效率：素材比较应有界并尽量一次完成；同一 revision 不重复看图，写后只补当前完成契约所需的最小复核。

### 必须做

1. 移除 `placeImage` 的隐藏白底检索默认和默认自动选图；只有显式要求自动选择、给出当前设计角色与用途，且视觉证据、分数和候选差距满足策略时才允许直接置入。
2. 让素材推荐返回可解释的视觉角色、背景性质、直接使用适合度与合成建议；元数据或文件名推断不得单独授权自动置入。
3. 详情页首屏必须区分“白底源素材可用于抠图重组”和“未经处理的矩形白底成片直接成为首屏”；白底、极简本身不是全局缺陷，判断必须服从 Brief、Task Profile 和画面关系。
4. 将置入意图编译为明确的 Photoshop 后置关系：容器范围、contain/cover、是否需要剪切、主体适配与写后关系读回；缺少必要结构时只阻止当前置入完成声明，不封锁读取和修复工具。
5. 为详情页完整创作 Profile 增加素材角色/合成完成度的软视觉评价；只有合格确定性事实可硬阻断，审美诊断最多驱动一次有界改进。
6. 扩展现有核心审计与类型检查；不新增临时 Smoke，不用字符串提示变化冒充真实 Photoshop 质量。

### 禁止做

- 不把“白底不好”“首屏必须场景图”“必须使用剪切蒙版”写成全局硬规则。
- 不让审美分数、知识检索结果或模型自评授予/撤销 Photoshop 权限。
- 不向通用 Agent / Executor 增加详情页、袜子或白底图关键词路由；品类语义只进入现有 Task Profile、知识、Skill 与 Evaluation owner。
- 不新增第二 DesignVerdict、第二 Release Gate、第二 Context Compiler 或平行素材 Store。
- 不因视觉证据缺失直接判失败；应先请求最小缺失观察，只有已证明的不一致才局部阻止错误写入/交付。

### 归属层级

- 设计知识：现有 `knowledge/design-principles.ts`、`knowledge/detail-page-framework.ts` 与 Photoshop craft recipes，拥有判断原则，不执行 Tool。
- 素材角色与直接置入决策：现有 Design Placement Intelligence / Resource Manager，拥有候选证据和可解释选择；不拥有最终审美裁决。
- Photoshop 执行：现有 `placeImage`、`renderLayout`、`fitLayerSubjectToRegion`、剪切蒙版/智能对象/样式 Tool 及其 execution preflight，拥有真实写入与关系读回。
- 评价与改进：现有 Evaluation Profile → DesignAssertion / Scorecard → DesignVerdict → Reflexion，审美 finding 为软评价，只以可靠 diagnosis 驱动一次有界修订。

### 当前计划

1. 已完成：审计素材推荐、详情页首屏、Photoshop 合成与视觉验收的实际调用链，确认隐藏白底默认、机械 top-1、未消费 matting intent 与关系读回缺失是主要根因，不把错误输出解释为 Agent 的有效 art direction。
2. 已完成：删除 `placeImage` 隐藏白底自动选择并收紧自动放置决策；只有显式 auto、当前设计角色、真实视觉观察、可直接使用结论、最低分与候选差距同时满足才产生写入，有歧义时返回结构化原因。
3. 已完成：详情页先消费与当前素材版本一致的新鲜缓存；冷缓存只把本轮已扫描库存组成一次联系表视觉比较，并在单屏重建中复用。库存对象由 Harness 以运行时对象身份签收，模型追加的 JSON `projectAssets` 不能伪造候选来源；空库存也沿用同一会话而不按屏重复扫描。联系表返回视觉角色、背景性质、`assetNature`、直接使用适合度、处理方式与证据引用；详情页 Ranker 再结合当前屏策略判断，白底首屏原料进入 `matte_and_recompose`，场景 /上身图进入容器，细节图只作佐证，参考拼图与设计成品拒绝回流为可自动置入的原始素材。
4. 部分完成：既有 `fillDetailPage` 授权路径已接通容器、剪切基底、父组、智能对象与 Photoshop `userMaskEnabled` 的真实写后读回；FillPlan 内联 matting receipt 明确不可信，需要抠图或缺剪切基底的图片会局部延期且不计完成。已知关系不一致只局部失败，未知降为复核；create-new 与 visual-repair 的通用 clip /group 写权限扩张被安全审查拒绝，未绕过，仍需用户明确授权。
5. 已完成：补充任务条件化的素材角色 /合成审美知识与 `craft.asset-integration` 软视觉断言；可靠 diagnosis 仍最多驱动一次有界审美改进，不改变 Photoshop 权限或事实完成状态。
6. 已完成代码验收：`maintenance:validate` 21 项全部通过，含 Main /Renderer 类型检查、业务边界、Tool /Skill /Executor /Prompt /Gate 审计、Agent 测试与 UXP production build；真实 Photoshop 首屏样本、自动去底续接、通用图层样式计划与人工审美质量继续诚实标为未验证 /未完成。

### 验收证据

- 未显式要求自动选图时，`placeImage` 不再扫描素材并偷偷写入；显式自动模式必须有视觉角色证据、最低分与候选差距。模型发出的 `force` 仍按 `agent_judgment` 走同一证据边界，只有未来由非模型控制面签发的 Harness receipt 才能表达外部授权；显式唯一素材来源仍可直接执行。
- “首屏白底源图”会被区分为直接使用、裁切进容器、抠图重组或拒绝，并返回可追溯理由；不能仅凭文件名/分辨率自动决定。
- 需要容器约束的置入在同一 Photoshop history 上能读回并验证 clipping / fit 关系；缺关系时仍允许定向修复，不把整个 Agent 封印。
- 详情页审美评价能指出素材角色不匹配、主体裁切、边缘/光影/背景融合问题，并只把带可靠 diagnosis 的问题交给一次修订。
- 自动化只证明契约与接线；至少一组真实详情页首屏样本需在 Photoshop 中验证选图、合成、视觉质量和耗时后，才能声明实机闭环。

### 状态

`code_complete_for_existing_detail_fill_path / hidden_white_background_auto_selection_removed / harness_owned_inventory_identity_core_validated / contact_sheet_asset_nature_core_validated / role_aware_usage_decision_core_validated / placement_relation_readback_core_validated / aesthetic_asset_integration_soft_judge_core_validated / full_21_check_maintenance_passed / generic_create_new_structural_repair_permission_pending / automatic_matting_continuation_pending / layer_effects_plan_pending / live_photoshop_and_reviewed_quality_unverified`

## 2026-08-10 DESIGN-HARNESS-CONTROL-CONSOLIDATION-001：多 Harness 控制权治理

### 切换原因

用户确认当前设计 Agent 实际由多个半独立 Harness 子系统共同控制，并要求立即开始治理、当天形成完整可验证闭环。本轮不是新增一个“超级 Harness”，而是沿既有 `DESIGN-HARNESS-VERTICAL-CONVERGENCE-001` 主线，把任务语义、Runtime、工具执行、设计评价与完成投影收回现有 canonical owner，优先解除会在首稿前封印 Agent、违背用户约束或制造整轮返工的 P0 根因。

### 用户原始需求

1. 治理审美、门禁、工具、Skill、系统提示、上下文、预算与恢复机制之间的冲突。
2. 保留确定性安全边界，但避免 Harness 在 Agent 尚未完成设计前因开放性判断过早阻断或收窄能力。
3. 立即开始实施，并在当天以真实代码、构建和审计结果形成阶段闭环；不得用降低断言、吞错或只改提示词制造假完成。

### 必须做

1. 完成普通自然语言在循环内声明 Task Profile 后的同 TaskRun 原子 Runtime 绑定：Stage Plan、Capability Session、预算、阶段 Context、Evaluation Profile、Artifact 授权与 Reflexion lineage 必须来自同一新鲜 Runtime Bundle，不允许只收紧阶段而缺失配套能力。
2. 将通用 Task Completion 降为 TaskRun /Task Profile /真实 operation result 的事实型投影；删除“所有创意必须新建画布、主体图、标题和卖点”的全局电商配方，用户明确负面约束不得被补救策略反向覆盖。
3. 删除通用 Prompt 中固定的写前四步顺序和与结构 /视觉证据冲突的措辞；简单局部任务必须保留最短路径。
4. 收敛 Critic /Evaluation 的全局审美硬规则，白底、极简、扁平、对称等只能按当前 Task Profile 与用户目标评价。
5. 审计并治理复合 Skill /子 Agent 对父 TaskRun 的预算、目标、Capability 与 Tool 语义继承；不能让顶层严格而内部原子调用成为不透明旁路。
6. 运行 Main /Renderer 类型检查、现有核心审计、Agent 核心测试与 UXP production build；真实失败必须保留并修复，实机未验证必须明确记录。

### 禁止做

- 不新建第三 Runtime、第二 Task Store、第二 Context Compiler、第二 Capability Registry、第二 DesignVerdict 或第二 Release Gate。
- 不创建新的巨型 Harness Kernel 类复制现有 Owner；统一控制通过现有 Task Profile、RuntimeSession /TaskRun、Capability Session、execution preflight、TransactionRunner、DesignVerdict 与后续唯一 Release 收口。
- 不向通用 Agent 核心增加主图、详情页、SKU 或白底图品类关键词分支。
- 不以审美评分、Brief 措辞、固定步骤或知识检索结果授予 /撤销 Photoshop 权限。
- 不 reset、checkout、暂存、提交或覆盖共享工作树中的无关改动。
- 不把静态审计或构建通过写成真实 Photoshop E2E、设计质量或商业质量已验证。

### 归属层级

- Task Profile /crosswalk：`shared/design-task-types.ts`，只拥有交付物语义与跨 Owner 身份。
- Runtime：现有 `agent-runtime-v5/runtime-contract-bundle.ts`、`runtime-session.ts` 与 Renderer `Agent`，拥有同一 TaskRun 的阶段、generation 与运行绑定。
- Capability /Tool：现有 Capability Session、Tool semantics、execution preflight 与 PhotoshopTransactionRunner；Skill 只编排，不取得第二执行权威。
- Evaluation：Manifest-selected Evaluation Profile、共享 DesignAssertion /DesignVerdict；审美 finding 不直接成为写前权限门禁。
- Completion /Release：当前 Completion 只作迁移期事实投影；最终发布裁决仍归既定 M5 唯一 Release Gate。

### 当前计划

1. 已完成：项目记忆与现有 Owner 对齐，冻结 P0 修改边界和影响矩阵。
2. 已完成：循环内动态 Task Profile 声明后，在同一 TaskRun 原子刷新 Runtime Bundle、Capability、预算、阶段 Context、Evaluation、Artifact 授权与 generation lineage。
3. 已完成：通用创意 Completion /Policy 移除电商内容配方，改为显式交付义务、真实写入、正确目标、同目标读回与可验证文件证据。
4. 已完成：通用 Prompt、Critic、视觉 Judge 与局部编辑 Profile 做减法治理；审美 finding 与 Profile 可选检查保持软评价，只有合格确定性事实和必需检查可硬阻断。
5. 已完成：复合 Design Team 使用父级事前预算分区、角色加权额度、绝对 deadline、取消传播和整组修订预留；Brief /Strategy /Profile 上下文贯穿全部阶段。
6. 已完成：21 项 `maintenance:validate` 全绿并同步 Status /project-state；真实 Provider → Photoshop、多样本审美质量与稳定效率仍明确保留为未验证。

### 验收证据

- 自然语言声明 Task Profile 后，同一 TaskRun 中的 stage、Capability、预算、Context、Evaluation 与 Artifact 授权来自同一 generation；Reflexion 不退回“收窄能力但无阶段计划”的半绑定状态。
- “极简白底产品图，不要文字”“纯排版海报”“当前画布局部修改”等合法任务不会被通用 Completion 强制添加标题、卖点或新建文档。
- 局部 Photoshop 修改不自动进入外部知识 /Eagle /市场研究与完整 R1-R4 仪式；必要目标读回和写后验证仍保留。
- Skill /子 Agent 内部原子 Tool 调用能够被父运行计数、约束和追溯，或明确记录尚未迁移的真实边界，不再假装已统一。
- 现有安全门禁、未知写状态、防重放、document /revision /layer provenance 与不可逆审批不回退。

### 状态

`code_complete / runtime_binding_core_validated / factual_completion_core_validated / aesthetic_harness_core_validated / compound_budget_core_validated / full_21_check_maintenance_passed / photoshop_e2e_unverified / reviewed_design_quality_unverified / commercial_quality_unverified`

## 2026-08-08 DESIGN-INTELLIGENCE-EAGLE-UI-001：Eagle-first 设计知识闭环与知识库 UI 重构

### 切换原因

用户明确了真实使用习惯：绝大多数设计参考先进入 Eagle，问题不在“缺一个 Markdown 编辑器”，而在素材看过之后不能沉淀为可复用的设计判断，也不能让 Agent 在主图、详情页等任务中可靠使用。用户同时要求审计 Trae CN 已实现的 Design Intelligence Phase 0–6 契约、命题状态机和运行时持久化，并重构当前难以理解的知识库 UI。

本轮是知识域内的受控纵切，不替换既有 Harness 主线，也不扩张为全工作台改版。

### 用户原始需求

1. 审计当前“契约地基 + Task Context Builder + Obsidian 适配与 Candidate Gate + Phase 3–6 纯逻辑契约 + 命题状态机单测 + 运行时持久化层”的真实完成度，不能只相信实现者的自述。
2. 回到知识库本质，明确它在 DesignEcho 中的定义、价值和边界。
3. 以 Eagle 为主要视觉素材来源，让已有设计参考能够被理解、关联、审查，并供 Agent 在主图、详情页等任务中按需使用。
4. 重构知识库 UI，使非技术用户看得懂“素材、候选、已验证知识、任务上下文”之间的关系，并能完成检索、审查和追溯。

### 当前已确认事实

1. DesignEcho 的知识库不是另一个文件管理器，也不是 Obsidian 或 SiYuan 的替代品；它是面向设计决策的记忆服务，价值由是否改善任务决策、执行和复盘衡量。
2. Eagle 是视觉素材的事实来源；DesignEcho 不应复制或接管 Eagle 素材，只保存稳定标识、关系、观察、使用角色和审核状态。
3. “Agent 使用过素材”不等于“素材已成为知识”。临时任务上下文、候选知识、人工确认后的正式知识必须分层；AI 不得自动晋升为正式知识。
4. 项目同时存在 Eagle 静态磁盘读取与 Eagle MCP 实时检索两条通道。用户能在 UI 看见素材而 Agent 检索报告不可用，是当前必须重点审计的一致性风险。
5. Trae CN 的 Design Intelligence 代码主要以未跟踪文件形式存在于 `src/shared/design-intelligence/`、`src/main/services/design-intelligence/`、`src/renderer/services/design-intelligence/` 与相关脚本中；其契约完整性、Owner 唯一性、真实接线和失败语义尚未由本轮验证。
6. 当前知识库页面的产品语言、信息架构和状态表达偏工程视角；用户难以判断下一步该检索、审查、关联 Eagle，还是查看 Agent 实际使用了什么。
7. 当前工作树包含大量用户与其它任务的并行改动；本轮不得 reset、checkout、暂存、提交或覆盖无关内容。

### 必须做

1. 逐层审计 Design Intelligence 的共享契约、主进程持久化、Renderer 服务、IPC/preload、测试与实际消费点，区分“存在文件”“通过纯逻辑测试”“运行时已接线”“产品闭环已可用”。
2. 验证 Candidate Gate、命题状态机、来源与 provenance、冲突/撤销语义、持久化原子性及重启恢复；发现根因缺口时在既有 Owner 上做最小修复。
3. 建立或补齐最短 Eagle-first 纵切：Eagle 素材保持外部事实来源 → 形成有来源的观察/关系或候选 → Task Context 按任务编译 → Agent 可消费并可追溯；不得以复制整库或无界检索代替。
4. 重构知识库页面的信息架构与交互，至少清楚表达：知识总览、正式知识、待审核候选、任务上下文/最近使用、Eagle 视觉来源入口和系统健康状态。
5. UI 只呈现真实数据或诚实空状态；内部 id、route、skill、原始 Tool JSON、调试字段不得直接暴露给普通用户。复杂 provenance 和技术诊断必须渐进披露。
6. 为加载、空、错误、离线、冲突和审核结果提供明确状态与恢复动作；主要交互满足键盘焦点、语义按钮、足够命中区和非颜色单一表达。
7. 运行 Renderer/Main 类型检查、Design Intelligence 专项审计与状态机/持久化测试；条件允许时进行可见 UI 回归。最终结论必须区分代码验证、运行时接线、Eagle 实机和 Agent→Photoshop 设计质量证据。
8. 完成后同步 Plan、Status 和 `project-state.json`，不把自动化测试通过描述成商业知识质量已验证。

### 禁止做

- 不 fork 或内嵌 Obsidian/SiYuan，不把 DesignEcho 变成通用双链笔记软件。
- 不重造 Eagle 的文件夹、标签、预览、去重和素材管理能力，也不复制 Eagle 原图建立第二素材真相源。
- 不新增第二 Runtime、Task Store、Context Compiler、Capability Registry、Learning Store、Release Gate 或知识状态 Owner。
- 不允许 AI、Tool success、模型自评或使用次数自动把候选升级为正式知识。
- 不把知识检索或 Eagle 参考设为所有设计任务的阻塞前置；只有任务明确需要且能改变决策时才装载。
- 不向通用 Agent/Executor 增加主图、详情页、SKU 等品类关键词分支或固定知识流程。
- 不做全工作台视觉翻新，不修改与知识闭环无关的页面与业务。
- 不隐藏失败、不伪造演示数据、不用默认值把缺失来源或持久化错误伪装成成功。

### 归属层级

- Eagle / Source Adapter：视觉素材事实来源与稳定引用，不拥有知识审核状态。
- Design Intelligence contracts：知识条目、候选、命题、关系、provenance 与状态转换的唯一语义 Owner。
- Runtime stores：上述契约的持久化和查询 Owner，不自行推断知识真伪。
- Runtime Context Compiler / Task Context Builder：按当前任务选择、压缩和组合已允许内容；不授予权限、不晋升知识。
- Agent：基于 Task Context 作设计判断并记录使用证据；不能把自己的输出直接认证为知识。
- Human Review / Candidate Gate：正式知识晋升、驳回、冲突处理与撤销的最终 Owner。
- Knowledge UI：上述真实状态的可理解投影和审核工作台，不成为新的数据 Owner。

### 当前计划

1. 已完成：项目记忆对齐，共享工作树和 Design Intelligence/Eagle/Knowledge UI 的真实代码边界已盘点。
2. 已完成：Phase 0–6 契约、状态机、持久化、IPC/preload 与 Agent 消费链已分级审计；“文件存在 / 纯逻辑通过 / Store 独立 IO 通过 / 产品运行时接线”不再混称完成。
3. 已完成本轮最短根因修复：Task Context 现在携带有界知识正文、来源与生命周期；外部结果保持候选语义；普通任务不自动拉取 Eagle；空上下文不展示；知识页多来源查询并行。
4. 已完成：知识库页面已重构为知识总览、可用知识、待我审核三段；Eagle 本地库浏览与 Agent MCP 全库检索明确分开；内部方法长契约、id 和 Tool 标签不再作为主卡片内容。
5. 已完成本切片验证：类型检查、Agent/UXP 生产构建、42 项 Design Intelligence 审计、16 项命题状态机、8 项 Store 独立 IO 与 Electron 可见 UI 回归已通过。完整核心入口被共享工作树中本切片未修改的意图正则、业务耦合与 SKU 词条棘轮阻断；未改基线或断言制造假绿。
6. 已完成：状态文档与机器状态已同步；审计结论明确区分已完成、未接线、未实机和后续真实设计 E2E。

### 验收证据

- 每个“Phase 已完成”声明都有对应代码路径、调用方、测试与失败边界；仅有接口或纯逻辑文件的阶段不得标为运行时完成。
- 用户能够不理解内部架构也回答：我有哪些正式知识、哪些在等我审核、Agent 最近用了什么、来源是哪张 Eagle 素材、出错后怎么办。
- Eagle 离线、MCP 未启动、磁盘库可读、素材被移动/删除等状态不会互相伪装，UI 与 Agent 对可用性的解释一致。
- 候选只有经人工确认才能成为正式知识；冲突、驳回、撤销和来源追溯均可验证。
- Task Context 只包含与当前设计决策相关的紧凑内容，保留来源和理由，不把整篇文档或整批 Eagle 元数据塞入模型上下文。
- 没有新增第二 Owner、品类专属 Agent 分支、自动晋升或虚假示例数据；现有核心验证不回退。

### 状态

`audit_complete / task_context_runtime_content_fixed_core_validated / knowledge_ui_refactor_code_complete_visually_verified / eagle_dual_channel_explained / phase_2_to_6_product_loop_incomplete / slice_checks_passed / full_core_validation_blocked_by_unrelated_shared_ratchets / shared_worktree_preserved / live_eagle_agent_photoshop_quality_unverified`
# 当前任务切换：SKU-COLOR-CARD-RETOUCH-LOOP-001

> 状态：`code_complete / real_five_color_offline_verified / auto_studio_classification_verified / manual_uxp_dual_mode_entry_code_complete / agent_uxp_builds_and_direct_contract_audits_passed / live_photoshop_document_writeback_unverified / commercial_quality_unverified`
> 切换原因：用户在 2026-08-08 明确要求把「形态统一」与「中性灰光影修正」纳入 Agent 的 SKU 能力，形成从基础素材到成品色卡的完整闭环。此前任务记录保留在本文后部，作为历史审计信息。

## 用户原始目标

当用户没有 SKU 模板、没有既有色卡、只有一组商品图片时，Agent 能判断素材属于纯底棚拍还是场景图。对于纯底棚拍袜子，自动完成素材精修、色卡创建、Photoshop 写入和结果验收；场景图继续走既定的 INS 场景方向，不套用纯底精修链。

本轮先实现纯底棚拍链路中的两个核心生产能力：

1. 形态统一与结构修正；
2. 中性灰方式的低频光影统一，同时保留不同颜色和织物纹理。

## 已确认事实

- 当前 UXP 已存在形态统一实验实现，但其轮廓坐标、轮廓点顺序、位移场尺寸与 Photoshop 图层像素尺寸之间存在契约不一致，不能直接作为生产路径。
- 现有 `addDodgeBurnLayer` 只创建空白 50% 灰柔光层，没有分析和绘制修正内容，尚不构成自动中性灰精修。
- 当前 `sku-color-card.executor.ts` 已能创建色卡结构和智能对象，但只是排版草稿，素材仍直接置入，没有形态、阴影和光影精修闭环。
- 当前 SKU 已有统一的用户侧 Skill；本轮能力必须作为其内部阶段和 Agent 原子工具接入，不新增第二个互相竞争的 SKU Skill。
- 实物样本位于 `D:\A1 neveralone旗舰店\C-1029\灰色系月子袜\平铺模特\新建文件夹`，共五张 4480×6720 纯底棚拍图。

## 实现边界

### 必须完成

- 新增确定性的 SKU 素材精修资产生成工具：抠图/主体蒙版、自动基准选择、中心线与宽度轮廓形态归一、原影分离、中性灰光影修正图、可复核预览与量化报告。
- 在 SKU 色卡执行器中按素材类型调用该工具，并把生成资产以可编辑图层写入色卡智能对象。
- 写入后执行结构读回与视觉快照验收；工具执行失败必须如实暴露，不得降级为“已完成”。
- UXP 提供不经过聊天的手动色卡入口：INS 模式只建立卡片结构，纯底模式才执行抠图、形态统一、原影和中性灰修正；两种模式复用同一个 SKU 色卡执行器。
- 新工具进入统一工具目录、执行预检分类、Agent schema、IPC/preload 和必要的 UXP/Photoshop 写入能力；不得绕开既有 Photoshop 事务与工具契约。
- 使用真实五色素材做离线处理验证，并运行 Agent/UXP 构建及核心工具审计。

### 明确不做

- 不继续调参修补旧 `optimized-displacement` 作为生产主路径。
- 不把 SKU 品类分支写进通用 Agent 循环或自主执行器。
- 不把“专业级”写成无法验证的主观完成声明；本轮以结构、轮廓一致性、光照残差、图层可编辑性和 Photoshop 读回证据验收。
- 不在本轮扩展场景图生成或 INS 风格设计，只保留分类与路由边界。

## 推荐归属

- `shared/`：版本化输入、输出、指标和验收契约；
- `main/services/`：确定性像素处理、形态与光影算法、资产落盘；
- `main/ipc-handlers/` + preload：Agent 工具桥接；
- `renderer/services/skill-executors/sku-color-card.executor.ts`：SKU 内部阶段编排；
- `DesignEcho-UXP`：只承担 Photoshop 原子写入和读回，不承担业务路由；
- v5 SKU manifest/评价适配器：声明阶段和完成条件，不新建独立运行时。

## 当前实施顺序

1. 固化契约和素材分类；
2. 实现离线资产处理器并用五色原图验证；
3. 接入 Agent 工具目录、IPC/preload 和执行预检；
4. 接入 SKU 色卡智能对象图层写入；
5. 增加读回证据与报告字段；
6. 构建、类型检查、工具审计和真实素材回归。

## 完成判据

- 五张真实输入可稳定生成同尺寸、透明背景的主体层、独立原影层和中性灰修正层；
- 自动选出的基准和每张图的形态/光影指标写入版本化报告；
- 色卡 PSD/PSB 中每个颜色卡片保留原图、主体、阴影和光影修正的可编辑结构；
- Photoshop 读回能证明目标文档、目标图层和最终快照真实存在；
- 任何未通过的视觉验收明确标为 `needs_review` 或失败，不伪造完成。

---

# 当前任务切换：KNOWLEDGE-MULTIMODAL-COMPOSER-001

> 状态：`code_complete / lovart_live_reference_inspected / ordered_edit_resend_core_validated / default_agent_bridge_validated / latest_live_edit_flow_not_retested`
> 切换原因：用户明确要求知识、Eagle 素材与自然语言在同一个多模态输入编辑器中按语义顺序串联，而不是通过输入框外部的“加入本次任务”状态胶囊表达。

## 用户目标

1. 右侧 Agent 输入框参考 Lovart 的真实交互骨架：素材或知识引用是可插入到文字光标位置的行内对象，不是工具栏上的任务状态标签；
2. 用户可以表达“参考【素材 A】的排版，但不要采用【素材 B】的配色”这类文本—引用—文本顺序，Agent 收到的上下文必须保留该顺序；
3. 当前选择、当前消息附件与项目长期记忆必须分开；选择素材不能自动升级成长期知识或权限；
4. 发送后的用户消息继续显示有缩略图/来源的富引用，且本轮引用不能静默污染下一轮；
5. 复用现有 OperatingContextSnapshot、KnowledgeSelectionReference、EagleAssetRef 与消息 Store，不创建第二 Context、Store 或 Runtime。

## 本轮受控纵切

- Composer：把现有 textarea + 外挂 context chips 改为可编辑的行内多模态内容；文本与引用按 DOM/结构化 segment 顺序序列化；
- 活来源：首版只接现有真实能力——项目素材、Eagle 单选/多选、经治理知识引用、上传/粘贴/拖入图片与现有截图能力；不伪造尚未接线的视频转录或 PSD 二进制直传；
- 发送：保留同一 OperatingContextSnapshot 事实 owner，把行内顺序编译为模型可理解的有界文本投影，并在消息对象保存 UI 回显所需的安全描述；
- 清理：只有成功进入发送管线后才清除该条消息的引用；会话切换继续提示未发送内容；失败或未发送不丢草稿；
- 视觉：深色主题内复刻 Lovart 的 120px 双层 Composer、24px 行内引用、底部能力工具条和 32–34px 发送键，不照搬其白色主题或 Agent/图像/视频路由。

## 禁止做

- 不把缩略图或素材引用冒充视觉观察、商品事实、强制规则或 Photoshop 写权限；
- 不把 Eagle 原始路径写进模型提示词或行内消息引用；
- 不为了视觉相似新增无实际能力的装饰按钮；
- 不引入第二消息 Store、第二任务上下文或独立知识附件 Owner；
- 不把所有未来多模态能力一次性伪装完成，未接线媒体必须诚实不可用或保持既有路径。

## 完成判据

- 文本前、中、后插入引用后，发送消息和 Agent 输入都保持相同顺序；
- 仅有暂态选择、没有文字指令时不可发送；上传图片仍允许以“请分析这张图片”的既有语义发送；
- 成功发送后当前消息引用被清理，历史消息中的安全引用仍可见；
- Main / Renderer 类型检查与既有相关审计通过；可见 UI 与 Lovart 实测参考做同状态对照，不以截图本身冒充交互验证。

## 本轮结果

- 消息以 `ChatComposerContentPart[]` 保存文本与引用的原始顺序；输入框、发送后的用户消息和编辑重发复用同一结构，UI 不再直接显示模型专用的 `【引用…】` 标记；旧消息没有保存顺序时会移除内部标记并明确提示用户复核，不能伪装成精确恢复。
- 冻结的单条消息同时驱动 Message、Operating Context 和 Agent 初始消息；当前用户指令按 `origin=current_user_instruction + authority=user` 定位，不再修改最后一条 Harness `role=user` 观察消息。默认 v3 Agent 已消费同一有序 parts，并且只有视觉预算批准的图片才能进入初始 `contentBlocks`。
- 粘贴与拖入在文件读取前同步插入稳定占位，混合剪贴板保留纯文本和图片顺序，原生 HTML 不进入编辑器；图片数量、单图 8 MB、总计 20 MB 在入口与最终发送边界双重校验，迟到的 FileReader 不能复活已删除附件。
- 已通过 `build:typecheck:renderer`、`build:renderer`、`audit:agent-business-boundaries`、`audit:tools` 与相关 `git diff --check`；核心业务边界审计新增 `multimodal-composer-order-provenance-and-budget-boundary`，真实窗口审计的内部 marker 检查从仅 assistant 扩大到本轮全部可见消息。
- 保留边界：会话文件写入仍有 2 秒防抖，草稿清理发生在内存 Store 提交后而非磁盘 ACK 后；历史上一轮图片也尚未预算化重新附给下一轮模型。当前修复保证本条消息的编辑重发与本轮 Agent 输入一致，不把这两个后续能力伪装为已完成。

---

# 当前任务切换：SKU-PROBLEM-DISCOVERY-AND-EFFICIENCY-001

> 状态：`code_complete / deterministic_consistency_repair_core_validated / first_turn_workflow_recommendation_core_validated / repeated_control_noop_contained / real_project_role_balanced_visual_sampling_core_validated / full_21_check_maintenance_passed / live_provider_photoshop_writeback_unverified`
> 切换原因：用户用“文件名为 3 双装、PSD 可见文字为 4 双装”的真实 SKU 模板场景，要求 Agent 不仅能发现单个例子，还要具备快速发现、局部自主修复和避免重复观察的通用能力。

## 用户目标

1. 规格化生产任务应把执行计划、文件元数据、文档结构、可见文字和操作结果对账，尽早发现不一致；
2. 只有事实唯一、目标可编辑、修复范围单一且可读回时才自动修复；不能确定时补最小观察，证明无法安全修复时只局部阻止当前模板；
3. SKU 任务优先进入现有受治理 Workflow，不在通用 Agent 中反复激活能力、扫描模板、读取全部文档图层或截图；
4. 不把文件名当成绝对真相，不用 OCR 代替可编辑文字事实，不把区域模板的 region 数误当商品数量。

## 已实现纵切

- 首轮导航：复用既有 Skill routing 声明生成唯一候选 recommendation；它只让模型首轮看见正确 Workflow schema，不绑定 Runtime、不授权 Tool，也不会在歧义时硬路由。
- 事实发现：`skuLayout.inspectTemplateLayout` 在同一次递归检查中返回文档 /history revision、ordered-slot 结构和有界可见文字观察；不新增截图或第二次文字扫描。
- 通用一致性契约：新增纯逻辑、无 IO /Store /Tool /权限的 deterministic consistency verifier；SKU 适配器将当前执行计划作为唯一 authoritative expectation，将文件名、结构和可见文字作为版本绑定 observations。
- 有界自动修复：只有“计划、文件名和 ordered slots 一致，且恰好一个可编辑文字图层冲突”时才生成提案。写入同时校验 documentId、historyStateRef 和旧文字内容，写后重跑 inspect 与一致性验证；任何 revision 变化、多点冲突或截断证据都会取消自动修复。
- 局部门禁：`needs_observation` 继续允许读；可修冲突只阻止当前模板 execute /save /export，允许精确修复和再观察；结构与文字同时冲突时禁止“只改字”假修；其他规格继续执行并可返回 partial。
- 效率治理：文档轮询不再递归统计全部打开文档的图层；同一运行先取一次模板 inventory 并本地派生规格，常规路径不重复递归扫描模板库；main 与 renderer 共同消费唯一共享纯 scorer，减少扫描不会改变模板选择 owner，且用户真实规格模板优先于生成卡片兜底；重复的能力激活返回结构化 no-op，连续三轮无状态变化即停止。

## 验收边界

- 已通过 3/3/3/4 可修、3/3/4/4 不可只改字、4/3/4/4 仅元数据 warning、无数量文字不误判、旧 revision 失效、legacy region 不误当 item count、旧 inspection schema 不静默通过、截断 /同层多数量不可修、隐藏文字不参与可见事实等行为用例。
- `maintenance:validate` 完整通过 21 个现行核心检查，Agent /UXP 工具契约、类型检查、生产构建与业务边界审计均为绿色。
- 本轮没有启动真实 Provider → Photoshop 生产会话，也没有写入用户 PSD；因此不能把代码与审计闭环描述为真实批量任务已完成。
- `getAnnotatedSnapshot` 仍只能证明同历史的视觉 /空间观察，不能证明完整图层树。缺少强结构证据时只定向补 `getLayerHierarchy`，不能为了省一次读取降低证据真实性。

## 2026-08-11 真实项目纵切：2 / 3 / 4 双装 SKU

- 真实输入项目固定为 `C:\Users\12611\Desktop\测试\测试`；只消费项目自身的商品素材、桌面程序内项目状态和用户当前请求，不从历史成品目录反向复制素材或业务配置。
- `D:\A1 neveralone旗舰店` 固定为只读验证集：用于分别校准 INS /生活方式感成品与干净纯色 SKU 卡的商品数量、主体真实性、裁切、比例、间距、标签、留白和商业完成度；不得成为素材源、模板源、组合规格真相源或 Photoshop 写入目标。
- 首次真实运行已暴露可复现基线：约 20 分钟、24 iterations、25 model calls、1 次 Reflexion，重复读取后以 `tool_preflight_blocked` 停止；Photoshop mutation、导出文件和有效交付均为 0，不能记为设计完成。
- 已完成确定性修复：多卡区域先拆为互不重叠的 2 / 3 / 4 个子槽，再以共享 contain scale 布局；复制卡片必须保持可编辑结构与节点数量；缺卡、重叠、越界、读回阻断或只完成部分规格时顶层结果不再伪报成功。
- 已完成成本边界：正式行为审计覆盖 2 / 3 / 4 卡布局、缺卡阻断、完整 /部分 /读回失败三类交付状态；UXP production build、Renderer typecheck 与完整 21 项 `maintenance:validate` 全部通过。
- 当前真实桌面程序仍是用户原有进程 PID 59956 / 56416，8765–8767 均属于 PID 59956；未启动、关闭、重启或替换任何应用。该实例为非 watch 运行，尚未自然加载本轮新构建，因此禁止用旧运行时重复购买一次已知会空转的 20 分钟链路。
- 下一验收只在同一当前程序自然重载最新构建后执行：对真实项目生成 2 / 3 / 4 双装，记录首次有效 mutation 延迟、模型 /Tool /视觉呈现次数、组合 provenance、同 revision 读回、导出文件和验证集人工对照；在取得真实 PSD /导出前保持 `live_provider_photoshop_writeback_unverified`。
- 真实抽样根因：项目共有 20 张模特图和 21 张平铺图；旧 `ProjectAssetIndex` 按角色优先级直接截取 12 张，历史视觉缓存因而形成 11 张模特、1 张平铺，并出现把小羊袜误判为蘑菇袜的错误观察。该缓存不能作为三款 SKU 的完整商品事实。
- 已完成固定成本修复：素材索引的 12 张候选改为角色轮转，真实项目生产探针得到 6 张模特 + 6 张平铺；SKU 场景仍只取 4 张，但稳定为 3 张平铺 + 1 张模特，通用设计为 2 + 2，没有增加视觉候选或模型调用上限。真实平铺联系表确认前三张分别覆盖灰褐小羊、米白红花 /小羊和深咖像素小羊三款。
- 验证集边界已量化：`D:\A1 neveralone旗舰店` 包含 23,341 张图和 1,025 个 PSD /PSB；仅抽取 12 张跨货号顶层成品和 4 组 2 /3 /4 双装模板做只读联系表。归纳结果是商品主体、少量清晰文案和克制背景的共性，而非复制某个模板。无合成预览的 TIF 明确视为未观察，不能冒充成品证据。
- 当前唯一运行实例已通过自身 `http://127.0.0.1:8768/mcp` 验证：MCP Host 与 Photoshop UXP 均在线、无挂起请求、项目根目录正确；Photoshop 当前没有打开文档。MCP 只暴露宿主 /Photoshop 原子工具，没有当前自主 Agent 或 Renderer reload 入口，因此不会用原子调用代替 Agent 完成设计，也不会再次向尚未重载的旧 Renderer 提交高成本失败链。

---
# 当前任务切换：SKU-SKILL-AUTONOMY-002

> 状态：`real_run_audited / root_causes_fixed / core_22_validated / production_builds_complete / live_photoshop_rerun_pending`
> 切换原因：2026-08-12 最新真实运行中，裸“帮我做SKU”已正确直达 `sku-batch`，但 Skill 在任何 Photoshop 写入前弹出组合确认卡，并只生成 2 双装候选，未进入 2 / 3 / 4 模板设计、占位符创建与调整。

## 用户原始目标

1. 用户说“帮我做SKU”时，Agent 理解需求并直接调用现有 SKU Skill；Skill 在同一任务中自主完成组合草稿、模板设计、占位符创建/调整、批量出图、写后读回与质量复核。
2. 色卡、模板和占位符等可逆前置设计不得默认打断；候选组合准备完成后统一展示一次 SKU 组合卡，用户确认后直接生产。只有用户明确要求跳过组合卡或项目已有受信权威组合时才不暂停。
3. SKU 业务流程只属于 SKU Skill；不得在通用 Agent、Harness、Completion 或权限层新增 SKU 专属工作流分支。

## 已核实事实

- 最新真实 Run 的首个业务 Tool 是 `sku-batch`，路由已正确；停止原因为 Skill 返回 `pending_sku_combo_confirmation`，不是 Agent 未选择 Skill、Provider 丢 Tool Call、Photoshop Host 失败或 Completion 误判。
- 旧 `skill-param-defaults.ts` 曾在项目检查前把普通 SKU 出图命令改写为确认要求，导致只生成 2 双 5 组便过早弹卡；当前要求不是删除组合卡，而是把卡片移动到色卡 /模板 /占位符检查或补齐之后，并带完整 2 /3 /4 候选。
- `sku-batch.executor.ts` 在未声明规格时从模板库存反推需求，并最终静默降级为 `[2]`；模板库存只能证明能力/缺件，不能拥有用户所需规格。
- 缺模板的 full 阶段已有非阻塞 `agent_design_handoff`，但续跑工具面与占位符检查/调整契约仍需按真实可达性复核。

## 本轮必须完成

- 普通 full SKU 执行先自主完成前置观察、色卡 /模板 /占位符检查与必要补齐；候选组合准备好后默认显示结构化组合卡，用户确认后直接批量生产。
- 当前 SKU Skill 的临时生产草稿规格为 2 / 3 / 4；它必须标记为非权威、发布前待复核，不能伪装成项目配置或用户确认。
- 模板库存不再反向决定任务规格；缺少 2 / 3 / 4 模板时进入同一 Skill 的自主模板设计续跑。
- 模板续跑真实开放检查占位结构、创建/调整占位、排版设计、保存和写后读回所需的既有 Tool；不通过通用占位脚本冒充设计稿。
- 使用现有核心审计和类型/构建链验证直接执行、明确确认、模板 handoff 与占位修复出口；不新增临时 smoke。

## 明确不做

- 不把 2 / 3 / 4 写入通用 Agent 或 Harness；它只属于当前 SKU Skill 的可替换生产草稿配置。
- 不把算法组合或 Skill 默认规格升级为正式上架事实。
- 不对用户当前 `E:\WERKE\C-1245` 的 PSD/PSB 做未隔离写入；代码验证完成后再用安全测试副本或用户允许的真实运行验收。

## 验收证据

- 裸“帮我做SKU”：缺色卡 /模板时先进入 Agent continuation 完成设计、占位检查 /调整、保存和读回；前置条件可用后返回 `pending_sku_combo_confirmation`，卡片覆盖 2 /3 /4 候选。
- “先给我确认组合再出图”与普通裸执行最终都使用同一结构化确认流程；确认后的组合是唯一用户确认输入。用户明确说“跳过组合确认”时才允许继续非权威草稿。
- 无项目规格时的 2 / 3 / 4 计划带 draft provenance 与 `requiresReviewBeforePublishing=true`；项目/用户/结构化确认仍优先覆盖。
- Renderer 类型检查、SKU/Skill/业务边界审计、核心维护验证与构建结果如实记录；未做真实 Photoshop E2E 时不得声称设计质量完成。

## 2026-08-12 实施结果

- 裸“帮我做SKU”不再在项目和模板检查前被参数默认器过早打断；无权威规格时，SKU Skill 先使用 2 /3 /4 双非权威草稿准备前置设计和候选组合，并保留 `requiresReviewBeforePublishing=true`。候选准备完成后默认显示组合卡，确认后再生产；只有用户明确跳过组合确认或已有受信权威组合时才直接继续。
- 未知规格的普通 PSD（例如 `800.psd`）不再冒充任意 N 双生产模板。缺组合模板、自选备注模板，或已有模板的占位符 /布局可以安全修复时，统一返回同一 Skill 的声明式 repair handoff；续跑工具面包含真实结构检查、文档 /图层创建、占位符创建与调整、快照、另存和验收读回。
- 模板结构检查失败、缺少可靠 v3 inspection、documentId 或 historyStateId 时保持 unknown /fail-closed，不给 Agent 修复写权限。所有模板先完成只读聚合预检，再执行受约束的内容修复，避免预检一半改脏源模板。
- 修复 /新建设计必须另存为项目「模板文件」目录中的新候选，并使用 `conflictPolicy=fail_if_exists`；模型布尔参数不能授权覆盖源文件。新版候选只有按精确路径打开、取得当前 Photoshop revision，并通过占位、布局和内容预检后才优先于旧模板，不能靠文件名评分重新选回坏模板。
- 通用 compact E1 continuation 使用 repair epoch：原子读、写、保存和文档切换仍可连续执行；Workflow owner 只有在本 epoch 真实写过、且所有目标文档的最后 mutation 都取得 exact revision readback 后才可重入。第二轮 handoff 保留上一轮证据但 mutation 计数归零，不能清空旧证据或零写入复用旧证据提前完成。owner 最终返回 `completed` 且自身产生新 mutation 时进入通用 `ownerAccepted` 相位：owner 与后续写入保持关闭，只等待 latest exact readback，读回后直接闭合 E1，不得再次执行 owner；该逻辑没有 SKU 品类分支。
- 真实 `Agent.run` 行为回归覆盖 success 与 nonFatal handoff、两轮 repair、owner 动态隐藏 /恢复、旧 revision 拒绝、双文档必须全部精确读回、最终 owner 的可信嵌套 mutation、`ownerAccepted` 后一次 exact readback 直接进入 R5、owner 不重复生产以及最终 pending /scope 清理；候选策略回归覆盖旧坏模板与新版候选并存、候选 inspect 失败不得偷渡普通评分。
- `npm run maintenance:validate` 完整通过 22 个核心检查；`audit:runtime-declaration`、`audit:agent-business-boundaries`（0 violations）、Main /Renderer 类型检查、Agent production build、UXP production build 与 scoped `git diff --check` 均通过。
- 当前 Electron 主进程与 Renderer 启动于 17:29，早于 17:57 的最终 Agent 构建，仍在运行旧代码。本轮未重启用户程序、未写入 `E:\WERKE\C-1245`，也未通过真实 Provider → Photoshop 重新产出 2 / 3 / 4 双模板；因此实机完成度、视觉质量和耗时仍待安全重载后的真实复跑，不能由自动审计冒充。

---
