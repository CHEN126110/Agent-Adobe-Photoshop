# Current Implementation Plan

## 2026-08-13 当前修复切片：`HARNESS-RECOVERY-AND-DIAGNOSTICS-001`

1. `[已完成]` T1 已由当前 `ReadonlyArray` 实现和类型检查满足，没有重复修改。
2. `[已完成]` T2 已从 CLI、历史会话项目路径及稳定项目集合根发现运行档案；月份过滤、扫描根统计和真实档案 Tool 序列展开均已验证，默认 420 条、2026-08 为 202 条。
3. `[已完成]` T5 / T7 已完成：Provider 截断恢复按 1× / 2× / 4× 增长且不重复消耗普通模型预算；失败结构化保留在内部，用户结果投影仍为自然设计语言。
4. `[已完成，实机待验证]` T3 / T4 已在通用边界修复：Skill 内原子写入复用 Harness target/revision owner；not_applied、unknown 未变化、unknown 已变化分别走放行替代、有界恢复和 fail-closed，不放宽文档版本保护。
5. `[已完成，实机待验证]` T6 十个高频写工具均已进入严格读回范围；已有合格入口未重复迁移，其余统一具备真实结果核对和失败回滚。
6. `[自动验证完成，桌面 E2E 待验证]` `maintenance:validate` 22 项、真实档案统计、Tool / Executor / Runtime /业务边界审计和 UXP production build 已通过；下一步只在加载新构建的安全副本中做 Photoshop 故障注入与 `sku-color-card` 真机回归。

## 2026-08-13 当前优先切片：`DESIGNER-FIRST-HARNESS-001`

1. `[已完成]` 把生产系统提示从 Harness / Runtime / Evidence / Profile 说明收敛为设计师工作原则：理解目标、必要观察、尽早可逆首稿、查看效果、有限调整、自然沟通。Runtime Context 与单轮 Message Context 也只以“项目现状 / 专业方法 / 实际观察 / 当前操作说明”呈现，不再给模型展示 trust、authority、Manifest 或 DATA_ONLY 标签。
2. `[已完成]` 压缩 Capability Session：当前 Tool schema 自己表达可用动作；动态上下文只保留必要的按需能力目录，不向模型倾倒 Manifest、指标、引用解析和权限解释。
3. `[已完成]` 清理用户可见过程与收尾语言：用“正在设计 / 设计过程 / 正在制作 / 当前版本”替代“正在执行 / 已处理 / 任务验收结论 / 自动检查”；Skill 原始结果、完成数组、迭代计数与 Provider / Runtime / Tool 原始错误不再直接进入普通界面。普通追问保留真实问题，只有交互卡才显示“等待确认”。最终结果只根据可信 Photoshop 实际改动、保存 / 导出、生成素材和是否看过改后画面投影；SKU 用户提示与内部诊断已分流，完整 SKU 在前置设计可用后默认显示一次组合卡，确认后再生产。
4. `[必须保留]` documentId / revision、真实 Tool result、读后写、写后查看、保存 / 导出回执与不可逆确认继续由后台自动执行；模型不生产这些事实，用户也不需要阅读其内部报告。
5. `[自动验证完成，实机待验证]` 22 项 `maintenance:validate` 已通过，包含 Renderer / Main 类型检查、Agent / Capability / Executor / Skill / Prompt 正式审计和 UXP production build；真实桌面设计体验与 SKU 质量只在现有应用加载新构建后另行回归。

## 2026-08-12 当前优先切片：`AGENT-RUNTIME-SIMPLIFY-AND-RECOVER-001`

1. `[已完成]` 恢复通用 Agent 主链：模型先理解需求；命中已注册 Skill 就直接调用，未命中则自主规划原子工具。`declareDesignIntent` 只做可选运行时注解，不是启动许可。
2. `[已完成]` 取消未绑定阶段的单工具声明屏障和过小启动预算；未绑定 Agent 使用与完整设计任务相称的统一预算，Skill 推荐只提供能力提示，不拥有路由或权限。
3. `[进行中]` 收口通用 Skill 执行契约：Skill 可声明是否能自行创建目标文档；Skill 内部真实写入、同目标读回和验收进入统一操作证据账本，不能用外层 `success:true` 冒充完成。
4. `[进行中]` 缩小首轮 Tool schema：唯一推荐只预载对应 Skill 与必要通用工具，其他 Skill 保留按需目录；首次 Tool Call 使用确定性进度事件，不额外购买一次模型说明。
5. `[已完成]` Runtime Profile Catalog、能力天花板、TaskRun、写入预检与 Completion 继续作为后台基础设施；它们校验真实执行，不要求模型背诵内部协议。
6. `[已完成]` Renderer production build 已加载，DesignEcho Electron、Host 与 UXP 已重连，项目根为 `E:\WERKE\C-1245`；只读检查无 pending request，未对当前脏的 `SKU.psb` 做写入。
7. `[待本轮代码收口后]` 运行类型检查、核心审计、正式构建与只读运行时核验；真实 Photoshop 写入回归只在安全副本或用户允许的测试窗口执行，`D:\A1 neveralone旗舰店` 保持只读验证集。

## 2026-08-11 真实验证切片：`LIVE-SKU-AUTONOMOUS-DESIGN-VALIDATION-001`

状态：`real_current_app_baseline_captured / 20m33_24_iterations_25_model_calls_zero_mutation / sampling_no_document_and_missing_template_handoff_fixed / sku_budget_bounded / core_validated / live_rerun_pending_after_existing_app_reload`。

目标：在用户当前已运行的 DesignEcho / Photoshop 中，用真实项目完成 2/3/4 双装 SKU 自主设计，并以 `D:\A1 neveralone旗舰店` 成品作为只读人工验证集衡量版式与完成度。先治理首个有效写入前的重复视觉成本，再观察组合事实取得、Photoshop 执行、写后读回和终局质量；不创建样例专属业务路线。

实施顺序：

1. 已完成基线取证：当前真实任务一次联系表后仍逐张近看 12 个样本；前 7 个样本中 6 个为相近模特照；最终约 20 分 33 秒、24 iterations、25 model calls，零写入、零输出并以 `tool_preflight_blocked` 收尾。
2. 已完成通用 Project Visual Sampling：联系表成功时只近看明确不确定的关键角色，硬限制任务预算并保证素材角色多样性，不再用 `sampleSize` 回填到上限。
3. 已完成执行闭环修复：消除重复总结模型调用；让 `sku-batch` 在无文档时合法进入；缺模板时由同一 Workflow 自主创建可编辑 2/3/4 双模板、看图、保存和读回；用户委托组合判断只能产生发布前待复核草稿。
4. 已完成代码成本边界：SKU 四阶段链使用 16 模型 / 50 工具 / 30 iterations / 420 秒上限，视觉仅保留 6 候选 / 2 分析；正式类型、业务边界、Capability、Skill Package、Tool 与通用 Executor 审计全部通过。
5. 在不自行启动新应用的前提下等待当前程序加载新构建，再复跑同一用户请求；记录首个 mutation 延迟、模型 /视觉调用、输出文件、组合事实来源、同目标读回与质量结论。
6. 以验证集的两类真实成品作人工对照：花色组合重点检查切图干净、数量准确、间距、标签与信息层级；纯色组合重点检查卡片系统、颜色标识、底色与必要场景图。失败继续回到通用 Candidate /DesignIR /Evaluation Owner，不写测试项目特例。

退出条件：新代码下的真实运行不再无界逐图分析；事实不足时精确等待而非猜测；事实充分时能完成 2/3/4 双可编辑 PSD/PSB 与导出图，并经同版本读回和人工对照给出诚实质量结论。

## 2026-08-11 受控设计纵切：`AUTONOMOUS-DESIGN-KERNEL-V1`

状态：`generation_context_multi_surface_r5_and_request_scaled_cost_core_complete / exact_text_signed_scope_cas_and_final_history_core_validated / full_21_check_maintenance_passed / candidate_set_design_ir_next / live_provider_photoshop_cost_and_reviewed_quality_unverified`。

目标：让现有 Design Kernel、TaskRun、Context、视觉观察、Evaluation 与 Reflexion 组成默认自主设计闭环。Agent 自行完成可逆专业取舍和有界质量返工；只有用户独占事实、不可逆风险、真实能力缺口或多轮仍不达标时进入人工。该切片不新增业务 Skill、第二 Runtime、第二 Context Compiler、第二 Verdict 或第二 Release Gate。

实施顺序：

1. P0-A：Task Profile 晚绑定和每个 Reflexion generation 通过唯一 Context Compiler 刷新当前 Project State、reviewed memory 与阶段化 Design Kernel 上下文，停止复用启动时的陈旧快照。
2. P0-B：复用现有 `VisualObservationBundle` 与 Runtime 视觉 receipt，形成只读、即时派生的 R5 多画面评价集合；单画布需要一张同版本全画布，详情页需要精确覆盖全部目标屏，缺图/重复/越界/跨 history 一律不取得视觉通过信用。
3. P0-C：终局 Judge 在同一次评价中消费完整视觉集合并继续输出现有断言结果；完整 diagnosis 才能进入现有有界 Reflexion。`pipelineCompleted` 与 `qualityPassed` 分离，执行完但未通过质量不能取得 readyForWrite/完成信用。
4. P1：建立通用 CandidateSet / Preview / DesignIR 首条纵切。只对完整新创意生成两个真实低成本预览、按同一 rubric 选择胜者；局部编辑、模板填充与确定性 SKU 生产不强制多稿。语义 R4 继续 shadow，胜者仍通过现有 Capability/preflight/TaskRun/TransactionRunner 执行。
5. 验收：正式审计、Main/Renderer 类型检查与 `maintenance:validate` 先证明代码和 Owner 边界；随后用无业务 Skill 单画布、主图和详情页真实 Provider → Photoshop 多样本记录首稿分、返工增分、视觉覆盖、耗时与人工接受率。
6. 已完成成本纵切：R0 声明 `taskType + workMode`，模式级阶段、Capability ceiling、模型输出/思考策略和累计 Runtime 账本真实生效；`performance_budget` 不再触发 Reflexion 重购预算，Design Team 子额度在启动前预记到同一父账本。
7. 已完成精确文字纵切：只有已授权写入信封内的显式 `text_content` 替换可进入轻量通道；一次完整快照确定唯一目标，`setTextContent` 带原文、文档与 history CAS，写后 acceptance 与最终 history 共同完成 scoped Profile，避免 Eagle、Team、全画布 VLM 和完整创意流程。
8. 已完成视觉传输成本治理：工具图像按 observation 身份复用证据，但 Provider presentation 如实计费；普通图像在一次模型消费后从历史像素块退休，R5 多画面终审按本次真实图片数量计入硬上限。

退出条件：代码与核心治理边界已经闭合；下一阶段以真实样本验证。完整视觉集合而非“最近一张图”决定 R5 是否可评价；晚绑定与 Reflexion 不丢失当前项目和已复核设计经验；质量失败能定向返工且不无限重跑；精确改单字不得进入完整设计链。真实样本需在不扩大人工确认的前提下证明可复查的质量、延迟和费用改善，自动检查不得外推商业质量。

## 2026-08-11 受控插入切片：`AGENT-OBSERVATION-LIVENESS-002`

状态：`code_complete / root_causes_confirmed / semantic_liveness_and_revision_scoped_read_reuse_core_validated / reobserve_replan_loop_core_validated / text_and_extension_guessed_action_owner_retired / full_21_check_maintenance_passed / live_provider_photoshop_unverified / sku_business_fix_separate_pending`。

本切片响应真实运行中“已经发现问题，却反复看图、读文档、换 Tool 重复确认，最终没有执行”的直接反馈。它不新增 SKU 关键词路线，也不把观察去重变成权限门禁；而是让既有 TaskRun / RuntimeSession 用稳定 target、document revision、真实 operation result 和有限新事实判断是否发生语义进展。

实施顺序：

1. 已完成：逐条还原附件 Run Record，确认文件引用中的裸 `.jpg` 被第二文本恢复 owner 误判成导出义务；任意成功读取会重置未完成续跑；跨 Tool 同义事实被误算为新进展；`needs_reobserve` 只能进入、不能在重新规划后解除。
2. 已完成：快照读取缓存绑定可信 `documentId@historyStateId`；真实缓存命中由 Runtime 身份签发，不重新向用户或视觉模型发送图像，不消耗视觉预算；写入、导出和文档生命周期变化仍使缓存失效。
3. 已完成：未完成续跑和阶段 liveness 改用语义进展键，消费 TaskRun status / plan revision / current node、目标 document / revision / binding、成功 operation result、输入和 outcome；成功读取次数不再构成进展，novel fact credit 有上限。
4. 已完成：复用既有 RuntimeSession 建立 document change → `needs_reobserve` → R2 重入 →新 revision 承接的闭环。完整创意链由 R4 新 plan 接受 observed revision；无 R4 的 SKU 结构化生产链只能由 R2 真实 Photoshop 观察确认同一 conflict revision 后恢复 E1。`needs_reobserve` 期间 revision 再次漂移会再次清空 R2 及下游状态，旧 plan /旧 revision 不能自动重放。
5. 已完成：所有缓存中的 Photoshop 文档读取共用 `documentId@historyStateId` 作用域；文档上下文屏障、活动图层、undo /redo、项目状态和资源变更复用权威副作用分类统一失效。cache hit 不取得执行目标、R2、Stage Trace、视觉预算或运行摘要观察信用。
6. 已完成：删除从任务正文、附件扩展名和自然语言猜导出 /关闭动作的恢复分支；保留 TaskPlan / Runtime 的结构化交付义务，读取失败回传准确 Host 原因。
7. 已完成自动化验收：Renderer / Main 类型检查、正式业务边界审计、简化债务棘轮和完整 21 项 `maintenance:validate` 全绿，无新增临时 Smoke、无抬高基线、无 SKU 专属 Agent 分支。

退出条件：同一 target / revision 的缓存图与等价读取不会反复消耗视觉预算或刷新续跑；真实 TaskRun / revision / operation 变化仍可推进；外部改文档后必须以新 revision 重新规划才能写；附件文件名不能产生虚假导出义务。真实运行效率和 SKU 成品质量仍须分别用 Provider → Photoshop 与 SKU 确定性业务回归验证。

## 2026-08-10 受控插入切片：`AESTHETIC-ASSET-COMPOSITING-001`

状态：`code_complete_for_existing_detail_fill_path / full_21_check_maintenance_passed / no_new_runtime_store_verdict_or_gate / generic_create_new_structural_repair_permission_pending / automatic_matting_continuation_pending / live_photoshop_quality_unverified`。

本切片响应用户对“Agent 不会设计、不会选图、置入后不会完成 Photoshop 合成关系”的直接反馈。它不新增一个审美 Runtime，也不把审美判断升级成写权限门禁；而是把现有设计知识、素材观察、Placement Intelligence、Photoshop Tool、Evaluation Profile 和一次有界 Reflexion 接成纵向闭环。

实施顺序：

1. 已完成：审计 `recommendAssets` / `placeImage`、详情页首屏知识、容器 /剪切 /主体适配工具、修复边界与最终质量断言的生产调用链。
2. 已完成：删除隐藏白底检索默认和默认自动写入；只有显式 auto、明确设计角色、可靠视觉证据、最低分与候选差距同时满足才自动置入，有歧义时返回候选且不 mutation。
3. 已完成：在既有素材 /Placement owner 中加入视觉角色、背景性质、直接使用适合度和合成建议；先消费新鲜缓存，冷缓存把本轮库存组成一次有界联系表比较，并在单屏重建中复用，不逐图重复分析或重扫项目；metadata-only 候选不能授权写入。
4. 已完成既有详情填充路径：Placement intent 已形成容器、剪切、父组、智能对象与 matting 后置关系；UXP 只用真实 Photoshop 读回证明 clipping /parent /smart-object /user mask，FillPlan 内联 matting receipt 不可信。需抠图或缺 clip base 的图片局部延期且不计完成；已知不一致局部失败、未知只进入复核。create-new /visual-repair 的通用结构写权限扩张仍待明确授权，未绕过安全审查。
5. 已完成：补充详情页条件化素材角色 /合成知识与 `craft.asset-integration` 软视觉断言；审美诊断只驱动一次修订，不改变确定性权限边界。
6. 已完成自动化验收：`maintenance:validate` 21 项全绿并包含 UXP production build；下一步只用真实 Photoshop 样本验证选图、合成、自动去底续接、视觉质量与时间，并在证据出现前保持未验证状态。

退出条件：系统不再替 Agent 隐式选择白底首屏素材；自动置入具有可解释视觉证据和歧义边界；需要容器关系的置入能写后验证并定向修复；审美知识能形成诊断与有界行动，同时不把白底、极简或主观分数变成硬门禁。

## 2026-08-10 当前治理切片：`DESIGN-HARNESS-CONTROL-CONSOLIDATION-001`

状态：`code_complete / advances_existing_vertical_convergence / no_new_runtime_or_owner / p0_runtime_binding_completion_aesthetic_and_compound_budget_core_validated / full_21_check_maintenance_passed / live_photoshop_and_reviewed_quality_pending`。

本切片不替换 `DESIGN-HARNESS-VERTICAL-CONVERGENCE-001`，而是处理 2026-08-10 实际执行审计确认的控制权分裂：自然语言 Task Profile 声明后的 Runtime 半绑定、通用 Completion 电商配方、固定写前设计序列、Critic 审美冲突、复合 Skill /子 Agent 执行账本不贯穿，以及系统前置检索和重复观察。治理必须落在既有 Task Profile、RuntimeSession /TaskRun、Capability Session、Tool execution、DesignVerdict 与 M5 Release 主线上，不创建新的 Harness Runtime。

当天实施顺序：

1. 已完成 P0-A：同一 plan-neutral TaskRun 原地绑定完整 Runtime Bundle；声明后同时刷新 Stage Plan、Capability、预算、阶段 Context、Evaluation、Artifact 授权与 Reflexion generation。
2. 已完成 P0-B：Task Completion 降为事实投影；通用创意不再强制 `createDocument + subject + copy`，只有显式用户 /Profile 义务与最终态证据可成为硬项。
3. 已完成 P0-C：删除通用 Prompt 固定写前序列与全局白底失败规则；结构启发、像素观察、审美评分和确定性 blocker 保持不同权限。
4. 已完成 P0-D：Design Team 复合执行在真实启动点事前分区父 /子预算，角色预算加权，取消 /deadline 传播，完整修订路线原子预留；子使用量不事后倒扣父账本。
5. 已完成 P0-E：终局 Judge 获得每 generation 一次专用模型 /视觉 /candidate /时间槽；score 成为唯一数值权威，可靠 N/A、无分覆盖、top-3 diagnosis 与 completed 后一次有界审美改进闭环已收敛；可选检查只保留告警，若 Runtime 要求 E2，审美改进 marker 必须同时取得本轮新鲜交付证据。
6. 已完成 P1：静态索引与场景采样分离、外部知识按需、Resume 相关性前置、开场观察复用、Profile-aware Critic 上下文和三态能力折叠治理进入现有 Owner。
7. 已完成验证：21 项 `maintenance:validate` 全绿，覆盖 Main /Renderer 类型检查、Agent 核心测试、Tool /Capability /Prompt /Gate /业务边界 /通用 Executor 审计、UXP production build、planning-check 与仓库卫生；未改高基线、未吞错、未用临时 Smoke。

退出条件已在代码与核心验证层满足：P0-A/B/C/D/E 均有生产消费者和现有审计覆盖，未创建第二 Owner；下一阶段只以真实 Provider → Photoshop、多样本人工设计评审和效率指标验证运行质量，不把自动化通过外推成审美或商业质量。

## 2026-08-03 唯一实施主线：`DESIGN-HARNESS-VERTICAL-CONVERGENCE-001`

状态：`architecture_consolidated / f1_f2_code_complete_core_validated / capability_operating_model_code_complete_core_validated / f3_first_recipe_code_complete_core_validated / taskrun_owner_code_complete_core_validated / v0_mutation_pack_code_complete_core_validated / x2_execution_envelope_code_complete_core_validated / exact_property_write_scope_core_validated / uxp_native_get_modal_root_fixed_live_verified / five_runner_owners / r4_semantic_shadow_preserved / live_v0_photoshop_e2e_unverified / release_gate_not_implemented / live_no_skill_design_e2e_unverified`。

本文件只维护当前里程碑、依赖、退出条件和验收顺序。历史计划由 Git 保留，不在工作树形成第二指挥链。

## 2026-08-08 受控插入切片：`DESIGN-INTELLIGENCE-EAGLE-UI-001`

状态：`audit_complete / task_context_runtime_content_fixed_core_validated / knowledge_ui_refactor_code_complete_visually_verified / eagle_dual_channel_explained / product_runtime_store_integration_not_complete / slice_checks_passed / full_core_validation_blocked_by_unrelated_shared_ratchets / live_eagle_agent_photoshop_quality_unverified`。

本切片响应用户对知识系统的直接审计与可用性要求，只整理知识域的既有契约、持久化、Eagle 来源、Task Context 接线和 UI 投影；不替换 `DESIGN-HARNESS-VERTICAL-CONVERGENCE-001`，也不创建新的 Runtime、Context Compiler、Store 或审核 Owner。完成后主线仍回到同 TaskRun → V0 → X1 → V1 的真实 Photoshop 纵切。

实施顺序：

1. 已完成：审计 Trae CN 已实现的 Phase 0–6 契约、命题状态机、持久化、IPC/preload、测试和实际消费点，按 `contract_only / core_validated / runtime_integrated / live_verified` 分级。
2. 已完成本轮最短修复：外部 Eagle/Web 结果不再冒充 `validated`；Task Context 带有界正文、来源和生命周期，不再只注入 id/标题；普通任务不自动检索 Eagle；空上下文不再生成空卡；知识页并行检索独立来源。
3. 已完成：知识库 UI 已重构为面向普通设计用户的决策记忆工作台，包含总览、正式知识、候选审核、任务固定引用、最近使用、Eagle 双通道与健康状态；复杂来源信息渐进披露，内置 Runtime 方法不再整段裸露。
4. 已完成本切片可归属验证：专项审计、状态机、Store 独立 IO、Main/Renderer 类型检查、Agent/UXP 生产构建和 Electron 可见 UI 回归通过。完整核心入口被共享工作树中本切片未修改的意图正则、业务耦合和 SKU 词条棘轮阻断；失败已记录，未改基线或断言制造假绿。
5. 已完成：CurrentTask、Plan、Status 与 `project-state.json` 已同步；Eagle 真实用户库、真实 Provider Agent 消费、候选主进程确认收据和 Photoshop 设计质量继续保留为未验证，不用代码测试冒充。

退出条件：用户能从真实 UI 理解并操作知识生命周期；Candidate Gate 不能被绕过；Task Context 有来源且紧凑；Eagle 离线与磁盘可读状态不冲突；没有第二 Owner、自动晋升、品类分支或伪造数据；本轮相关检查通过。

## 当前判断

项目在概念、知识、业务 Skill、Photoshop Tool、评价和恢复方面已经有大量内容。当前主要缺口不是继续增加角色契约、任务枚举、工作流或专项 Executor，而是把已有内容接到唯一 Owner 上并通过真实 Photoshop 纵切证明有效。

标准设计 Agent 的产品身份已经在 `Prompt.md` 与 Design Agent OS 定义完成，不是代码里待实现的 F0 里程碑。不新增 `standard-design-agent-role-contract`、六任务族枚举、`standard-design-task-contract` 或 `standard-design-outcome`；这些责任分别由现有 Task Profile、TaskRun、Capability、Verification、DesignVerdict、Release 和 Delivery 承担。

“从零创作”是 Design Kernel 在空白目标状态下的本身设计能力，不是独立 Task Type、Skill、Executor、Workflow 或通用 `workMode` 路由。现有业务字段 `workMode=create_new` 只在兼容边界内表达目标状态与保护关系，不向通用 Agent 扩张。

当前横切维护 `MODEL-PROVIDER-FAILURE-PROVENANCE-001` 已完成代码和核心验证：Provider 请求边界成为失败来源 Owner，403 与 API Key 认证分离，Ollama Cloud 设置页使用真实 Key + 具体模型测试，Run Record 保存脱敏摘要。该维护不改变当前 X2/V0 主线；应用重启后 live 复测和当前账号的模型访问权仍是外部验收条件。

2026-08-03 晚间 V0 实机尝试补充了两项边界。第一，Task Profile / Manifest 只解释任务语义，不能把精确图层修改扩张成整图创作；当前已复用请求级 `runtimeAllowedWriteTools`，对没有第二个写入要求的精确图层名 /画面文字替换形成候选面与最终执行点双重最小范围。第二，UXP `historyState.count` 的无效 Action `get` 是 Photoshop 原生错误弹窗根因，已改用 DOM history state 并为其它原生 `get` 补齐 `dontDisplay`，真实读回与核心验证通过。这两项只清除了 V0 前置风险，不等于 TaskRun V0 已完成。

最新白底图真实运行进一步证明，当前低效不是缺少“白底图工作流”，而是通用 Agent 的能力自知和 liveness owner 仍有冲突：R3 把 Agent 能自行完成的抠图工艺误报成用户素材缺口，Capability 基线在普通写入请求首轮可见性不足，基于 assistant 回复文案猜 Tool 的 recovery 又掩盖了 schema-bound Tool call 缺失。本轮已按 D-081 做减法修复：R3 blocking 收紧为用户独占输入；结构化 Photoshop 写入委托取得通用设计工艺基线并补齐 `removeBackground`；退役 prose-guessed Tool recovery。代码与 15 项核心验证通过，但应用重启后的真实白底图制作尚未验证，不能据此宣称 Agent 已会做白底图或标准设计 Agent 已完成。

随后自然语言回归又清除了三处品类中立的 Harness 噪声：历史 assistant prose 降为不可信草稿，用户明确要求独立重判时不再把旧答案重新注入；同 document / revision 的开场基础观察在当前 Run 内复用，mutation 或目标变化后才失效；只读 /明确禁止写入的任务不再被写入完成契约接管，裸“同款产品”也不再等同参考复刻。真实只读问法已从 61.7 秒、重复读取和错误 0/3 收口，复验为约 3 秒、1 轮、仅开场 `getDocumentInfo`、0 mutation、无 blocker。该证据证明问答和观察 Harness 收敛，不证明 V0 写入或设计质量；专业判断 ownership 仍需在干净窗口上用不同自然问法补一组可见模型回归。

## 唯一实施链

```text
F1 Task Profile / crosswalk ──→ F2 stage-aware Context ──→ F3 Craft Recipe
              \                                      /
               X1 RuntimeSession→TaskRun + mutation pack
                              ↓
                 X2 pack-scoped execution envelope
                              ↓
                 V0 看准 /写准 /读回准
                              ↓
                 V1 无业务 Skill 设计闭环
                              ↓
                     M5 唯一 Release
                              ↓
                M6 业务 Overlay 多样本 E2E
                              ↓
                   M7 受审经验与指标
```

F 车道只整理语义、知识与上下文，不授予写权限；X 车道只迁移当前纵切需要的执行 Owner。两条车道在 V0/V1 会合，不再等待全仓所有 legacy mutation 水平迁移。

## F1 `TASK-PROFILE-CROSSWALK-001`

目标：让 Agent 稳定理解用户要做什么设计，并消除 task type、artifact knowledge、Manifest、Skill 与 document role 的重复身份。

实施：

1. 复用 `design-task-types.ts`，原地演进为 Task Profile 身份与 crosswalk 的 canonical owner；不新建 Registry。
2. Task Profile 只表达稳定任务身份、声明指引、通用 intake /默认结构、Runtime hint 与跨 Owner 身份映射，不保存 Runtime 状态；交付要求、保护关系、事实 /观察、用户取舍和最低完成条件继续由 Manifest、TaskRun、ProjectTruth /Observation、Interaction 与 Evaluation 等既有 Owner 分担。
3. `knowledge/design-artifact-knowledge.ts` 只拥有可检索的方法与输入解释；Manifest 只拥有 Capability overlay 激活；`DesignDocumentRole` 只描述已观察文档身份。
4. Task Semantic Binding 来自模型对完整上下文的结构化声明并经合法 id 校验；关键词、文件名、旧路由 hint 和 Tool 参数不能补造 binding。
5. 不建立“设计创作”等第二层任务族。主图、详情页、SKU Template / Color Card / Batch 和通用设计直接映射 Task Profile；未登记设计类型使用通用 profile。

退出条件：相同设计需求只有一份任务身份；无 Skill 请求能取得稳定语义，但不因此获得 Skill、Tool、Stage 或完成权限。

实施状态：`code_complete / core_validated / live_design_e2e_pending`。`design-task-types.ts` 已成为 task type、artifact knowledge、Manifest /旧 Skill 与 document role 的唯一 crosswalk Owner；8 个 artifact-owner Manifest 均受现有业务边界审计覆盖。该结论只证明身份与知识接线，不证明模型已在真实设计中正确选用。

## F2 `STAGE-AWARE-DESIGN-CONTEXT-001`

目标：让已有专业知识在正确阶段进入唯一 Context Compiler，避免 Agent 开场靠猜或全程携带全部方法论。

实施：

1. 继续复用 `runtime-context-compiler.ts`，不创建第二 Context Compiler。
2. 自主 Agent 与结构化 Runtime 提供当前 Stage / generation，使 `design-method-knowledge.ts` 的 `applicableStages` 真正生效。
3. Context 按当前任务组合用户目标、Task Profile、ProductTruth、AssetHandle、项目 /PSD 观察、通用设计原则、经审核 Memory、外部参考和所需 Knowledge，并保留来源、新鲜度与冲突键。
4. 当前项目 /PSD 事实必须来自真实观察；模型先验、知识和参考只能支持设计判断或待验证假设，不能补造商品、颜色、规格、文案或目标状态。
5. Task Profile 与 Capability Session 必须形成每轮实时刷新的只读作业上下文：模型声明任务身份后持续取得对应交付物责任；能力目录明确区分当前已开放、按需可装载、denied 与 unavailable，并复用现有 Tool 语义说明前置条件、副作用和验收方式。该投影不新增 Registry、Context Compiler 或权限 Owner。

退出条件：R1/R2/R3/R4 各自收到紧凑且来源可审计的上下文；不适用知识被排除；Context 不授予权限、不推进 Stage、不声明质量。

实施状态：`code_complete / stage_selection_audited / dynamic_task_profile_and_capability_self_model_core_validated / live_design_e2e_pending`。结构化运行会在每轮模型调用前按 Runtime 当前 Stage 重新编译方法知识和交付物知识；无业务 Skill 路径在声明 Task Profile 后也能持续取得带 provenance / governance 的设计基础。Capability Session 的实时投影已覆盖当前能力、按需能力、明确不可用能力及 provider Tool 的已审核 Photoshop 语义，禁止通过随机 Tool 调用探索能力。普通设计的参考检索为按需输入，缺失或离线不再硬阻断；显式复刻或用户 /品牌参考约束仍可声明为必需输入。

## X1 `TASKRUN-TRANSACTION-VERTICAL-001`

目标：把现有 `runtime-session` 原地升级为第一个纵切所需的最小 TaskRun，并和 `PhotoshopTransactionRunner` 闭合写入责任。

TaskRun 必须拥有：

1. `taskRunId`、generation、plan revision、当前 node / cursor / state。
2. 非终态 `waiting_user` / checkpoint、`interactionId + expectedRevision` 恢复和 pending interaction。
3. 当前 document / target / revision 与单文档写者身份；外部变化只能重新观察、等待、显式接管或停止，禁止自动重放。
4. 节点 operation result、verification ref、finding / review 状态和终态；`DesignTaskRunRecord`、Completion、Run Record、Snapshot 与 UI 只读投影。
5. capability snapshot 与 no-Skill 等 deny-wins 边界跨等待保持，不能从裸“继续”恢复旧写权限。

Runner 按 capability pack 迁移：

- V0 复用已迁移的 `renameLayer`、`groupLayersSafely`、`moveLayer`、`lockLayer`、`setTextStyle`，不把未迁移动作混入首批认证包。
- V1 再迁移受限单画布需要的画布、置入、非破坏性变换、文字、背景 /形状、语义分组 /排序和保存 /导出动作。
- 每迁移一个动作，同切片退役其旧 modal、retry、rollback 与结果归属 Owner；未迁移 Tool 不进入 R4 纵切。

退出条件：同一 disposable 文档上的陈旧 revision 与第二写者被明确阻止或转为等待；写入与同目标读回直接归属当前节点。

实施状态：`taskrun_owner_code_complete_core_validated / v0_mutation_pack_code_complete_core_validated / live_concurrency_and_resume_pending`。现有 `RuntimeSession` 已原地持有稳定 TaskRun、plan revision /nodes /cursor、非终态 interaction、document /revision /writer 与 Host OperationResult refs；Agent 写入点和结构化确认续跑已接入精确 revision 与单写者判断。V0 已冻结为五个已由现有 Runner 持有的一对一叶子 Capability，并完成执行信封生产接线；R4 语义声明仍为 shadow，现有 Runner owner 数仍为 5。X1 只有在真实并发、等待恢复和应用重启边界验证后才整体退出。

## X2 `R4-DIRECT-EXECUTION-SLICE-001`

目标：保持 R4 declaration 为 `shadowOnly / executable=false / schedulerAuthority=false` 的模型语义计划；只对完成 X1 Owner 切换的 capability pack，把模型随后提交的 schema-bound Tool call 编译为一次性、受控的执行信封。

1. Model 声明设计意图；Harness compiler 绑定 capability/provider、typed arguments、AssetHandle、target / revision、依赖、预期结果和 verification。
2. ready 节点必须经过 Capability、execution preflight、TaskRun writer ownership 和 TransactionRunner；缺任一条件不 dispatch。
3. operation result 由执行信封绑定的实际节点直接登记；缺失或 provider 不匹配转为 `unknown / needs_reobserve`，不得由事后 reconciliation 猜 Tool result 或自动重放。
4. 只退役该切片对应的 shadow reconciliation、continuation、recovery、completion 重推断和 no-redo 补偿；不可逆审批、schema / permission、target / revision、rollback 与 unknown readback 保留。

实施状态：`v0_execution_envelope_code_complete_core_validated / semantic_r4_shadow_preserved / live_provider_photoshop_e2e_pending`。当前编译资格同时要求叶子 Capability 已激活、唯一 ready mutation 节点、TaskRun 当前节点与 plan revision 一致、Tool schema /参数有效、preflight ready、document /history revision 一致；编译器不执行 Tool、不授予权限、不拥有调度、重试、Completion 或 Release。包外调用保持现有 v3/E1 路径。

## V0 `TARGETED-PHOTOSHOP-OPERATION-VERTICAL-001`

使用 disposable PSD 完成一次目标绑定的语义图层整理或确定内容替换：真实 Provider → TaskRun → R4 → UXP → Photoshop → 同目标 verification。它只证明 Harness 能看准、写准、读回准；离线 fixture、单独 Tool canary 或手工调用不能替代，也不能据此宣称设计质量。

当前状态：五动作认证包、执行信封、TaskRun 派发记录、OperationResult 精确节点绑定、精确属性请求最小写范围和静态治理审计已完成并通过核心验证；v3/E1 + UXP + Photoshop 已真实验证三类自然请求（图层名、可见文字、真实歧义零写入），原生 `get` 弹窗也已根因修复并真实读回。但普通自然语言尚未安全接续到同一 TaskRun / R4 execution envelope，第二写者竞争和等待恢复也未实机验收，因此 V0 仍未退出。

## F3 / V1 `NO-SKILL-DESIGN-VERTICAL-001`

F3 不是建立新的 Recipe Runtime，而是为现有 Knowledge / Design Kernel 增加首条可版本化 Photoshop Craft Recipe：声明视觉意图、适用条件、必要观察、参数来源、保护关系、非破坏性选项、失败方式和读回方法。Model 可选用，R4 compiler 负责绑定，Runner 负责执行。

F3 知识状态：`three_recipes_code_complete / ordinary_natural_language_fallback_core_validated / live_recipe_effectiveness_pending`。首条“可编辑单画布图文构成”以及由真实任务缺口驱动的“合并图局部文字替换”“主体感知图片置入与视觉定尺”均已接入统一知识检索、无 Skill Task Profile 声明与 Stage-aware Context，只在 R4/R5 提供建议。普通自然语言在尚无 taskType 时也按 Recipe 自身的 `design.generic.v1` applicability marker 取得同一组紧凑索引；这只提供通用工艺知识，不选择 generic Manifest、Skill、交付物或固定阶段。索引明确候选动作不是逐项试探顺序，目标 /素材已确定时不重搜项目或参考；完整正文仍通过现有 `searchDesignKnowledge` 按需读取。四种自然问法及可编辑 /均匀背景 /复杂背景分支已由正式业务边界审计覆盖，完整 15 项维护验证通过。三条 Recipe 都不执行 Tool、不推进 Stage，也未经过真实 Photoshop V1 验证；后续仍只能由真实任务中的稳定工艺缺口驱动增加。

V1 使用 disposable 1080×1080 PSD、真实商品素材、逐字确定文案、品牌色与参考方向，显式禁用业务 Skill但保留通用能力。Agent 必须完成任务语义扎根、真实观察、设计方向与构图 /层级 /色彩 /排版判断、可编辑 Photoshop 制作、同 document / revision 的结构与像素读回、确定性检查与专业视觉评价、有证据且有界的局部修订，以及真实文件与 Delivery。

V1 硬失败只接受目标 / revision /权限、不可逆动作未批准、确定性商品或文案错误、必需产物缺失、结构损坏和真实 capability gap。审美 finding 进入 `review_required` 或有界修订，不能重演 0 写入门禁。

## M5 `UNIFIED-RELEASE-GATE-001`

V1 直接成为唯一 Release owner 的首个消费者，不建立临时 Gate。Gate 分别消费 `executionApplied`、`executionVerified`、`designVerdict`、`deliveryReady` 与 `userAccepted`，输出 `release_ready / review_required / release_rejected`。Completion、Reflexion、UI、Run Record 和 Delivery 只能投影，绕过 Gate 的质量 hard-block consumer 必须归零。

## M6 `GENERIC-AND-BUSINESS-LIVE-E2E-001`

扩张顺序：V0 → V1 → `main-image-design` → SKU Template / Color Card / Batch → `detail-page-design`。业务 Skill 只叠加特有 Knowledge、Recipe、Policy 与 Evaluation，不复制 TaskRun、Runner、Context Compiler、R4 scheduler 或 Release。

每类先做一个可复查真实 canary，再冻结多样本任务包；稳定性结论要求每个验证类别至少 5 个不同真实任务。分别记录 `photoshop_e2e_verified`、`design_quality_reviewed` 和 `commercial_quality_verified`，不能由单次成功外推。

## M7 `VERIFIED-TASK-METRICS-001`

只从已结束、来源可追溯、版本固定并具备 operation result、同目标 verification、Release 和相应 Delivery /人工反馈的 TaskRun 生成指标与隔离经验候选。采用候选隔离、按 Owner 分流、离线对比、人工批准、版本化 Canary 与回滚；不按调用次数、模型自评或在线写回自动进化。

## 立即执行顺序

1. 冻结已通过核心验证的 F1/F2 Owner、三条 F3 Recipe 与 D-081 通用能力边界，不再向通用 Agent 核心增加品类流程、关键词 Fast Path、第二 Registry、第二 Context Compiler、prose Tool 猜测器或 Recipe Runtime。
2. 在窗口空闲时完成不同自然问法的专业判断 ownership 可见复验；随后完成普通自然语言声明后的同 TaskRun 接续：先由主进程为普通自主运行签发 plan-neutral identity，使 taskRunId 在理解品类前即稳定；模型结构化声明通过后，在同一 identity 上绑定 Manifest /stage plan、Capability Session 与 Artifact 授权。当前授权服务只在 skillId/taskType 已知后签发 identity、Capability Session 也没有运行中 Manifest 绑定 API，这是该纵切必须一起修复的真实边界。保持本轮原始用户目标、交付物 /mutation 上限、document / revision、Tool log、预算和请求级写范围；不得递归创建新任务、在 Renderer 伪造 identity，或默认套用 `design.generic.v1` 的交付物 /固定八阶段扩大、拖慢简单请求。
3. 完成 X2 + V0 真实纵切：由真实 Provider 在同一 TaskRun 内生成包内 Tool call，经 execution envelope、现有 E1、UXP 与 TransactionRunner 写入，再做同目标 verification；随后完成 X1 双 TaskRun 竞争、stale revision、waiting /resume、重复提交与应用重启验证。
4. 在上述边界稳定后，先复跑原 SKU 同会话，验证它承接 2/3/4 双装与自选备注而非重新盲搜；再用不同自然问法复跑 disposable 白底图，验证 R3 不再把已有抠图能力误报成用户输入。两者都只依据真实 PSD /导出读回和人工复核记账。
5. 以 F3 Recipe 完成 V1 无业务 Skill 单画布设计：把设计意图转换为可编辑 Photoshop 工艺并进行真实读回与评价，同时成为唯一 Release Gate 的首个真实消费者；局部文字替换和主体感知置入只作为共享工艺用例，不改变 V1 的通用任务身份，也只按实证补充新 Recipe。
6. 收敛 M5 全部消费者，再进入主图、SKU Template / Color Card / Batch、详情页多样本 E2E；M7 最后引入隔离候选、离线评测、人工批准、Canary 与回滚，不允许在线运行直接改 canonical Knowledge / Recipe / Skill。

## 不变量与验收入口

- v3 是当前默认真实执行路径；v5 是目标契约与治理层；bridge 只做过渡适配；legacy 不再扩张。
- 不创建第二 Runtime、Task Store、Task Profile Registry、Context Compiler、DAG、Verdict、Capability Registry、Release Gate 或 Learning Store。
- 任一 mutation 都必须经过 Capability、preflight、稳定 target / revision 和该动作的 TransactionRunner owner；pack-scoped 执行信封还必须绑定 TaskRun 节点、plan revision 与 writer ownership。语义 R4 本身永不直接执行。
- 未经真实 Provider、Photoshop 写入、同目标读回、Evaluation 和 Delivery，不得宣称设计完成；未经多样本人工校准，不得宣称稳定商业质量。
- 自动验证入口：`npm run maintenance:planning-check`、`npm run maintenance:validate`、`npm run audit:agent-business-boundaries`、Main / Renderer 类型检查和 UXP production build。
- 真实 Photoshop E2E 必须另行记录 document / revision、operation result、verification、Evaluation、Release 与 Delivery；自动检查只证明代码和治理边界。

## 2026-08-11 真实 SKU 2 / 3 / 4 双装验证纵切

1. `[已完成]` 记录真实失败基线：当前桌面程序在真实项目上耗时约 20 分钟，24 iterations /25 model calls /1 Reflexion，零 Photoshop 写入、零导出，并以 Tool preflight 阻断结束。
2. `[已完成]` 修复多卡生产的确定性几何与成功语义：区域内 2 / 3 / 4 卡使用有界子槽与共享缩放；复制结构、数量、越界、重叠和写后读回任一不成立时 fail closed /partial，不把部分产物冒充完整交付。
3. `[已完成]` 将布局与交付状态纳入现有业务边界行为审计；UXP production build、Renderer typecheck 与 21 项 `maintenance:validate` 均通过。
4. `[待真实运行]` 不新开第二个应用；等待用户当前非 watch DesignEcho /UXP 自然加载最新构建后，在同一实例内只重跑真实 2 / 3 / 4 双装任务，保存 document /history、首次 mutation 延迟、调用成本、输出文件、组合来源和同版本读回。
5. `[待人工评价]` 将 `D:\A1 neveralone旗舰店` 仅作为只读验证集，分别按 INS /生活方式感与纯色 SKU 卡检查商品数量真实性、主体处理、裁切、尺度、间距、标签、留白和商业完成度；不复制其素材、模板、配置或文案。
6. `[判定规则]` 自动构建与审计通过不等于设计完成；只有真实 Photoshop 写入、完整导出、同版本证据和人工视觉对照同时成立，才能把该 canary 记为 `photoshop_e2e_verified / design_quality_reviewed`。
# 2026-08-08 受控纵切：SKU-COLOR-CARD-RETOUCH-LOOP-001

## 目标

在不新增第二个 SKU Skill、不向通用 Agent 执行器增加品类分支的前提下，把纯底棚拍袜子的「形态统一、原影分离、中性灰光影统一、色卡排版、Photoshop 读回验收」接入现有 SKU 色卡工作流。

## 实施里程碑

- [x] M1：版本化素材精修输入/输出/指标契约与纯底/场景分类边界；
- [x] M2：确定性离线精修资产生成器，并用五色真实素材验证；自动模式对五张样本均判定为 `studio`，置信度 0.74–0.88；
- [x] M3：Agent 工具目录、IPC/preload、执行预检接入；
- [x] M4：SKU 色卡智能对象内的原图/主体/阴影/中性灰可编辑图层写入代码完成；
- [x] M5：结构读回、视觉快照、量化报告与失败语义完成；五色离线报告五项检查通过，但 Photoshop 文档内真实写入与视觉读回仍待实机；
- [x] M5.5：UXP 手动色卡入口完成；支持 INS 卡片与纯底精修两种互斥模式，文件选择、颜色名编辑、排序、输出路径、进度和失败回传均接入同一 SKU 色卡执行器，不经过 Agent 对话或模型路由；
- [ ] M6：Agent/UXP 构建、类型检查、工具/Skill/Handler/通用执行器审计均通过；完整 `maintenance:validate` 被本切片未修改的 legacy/fallback 意图简化棘轮 `147 > 140` 阻断，未抬高基线或改断言制造假绿。

## 关键架构决定

- 形态生产路径采用同品类棚拍图适用的「中心线 + 逐行宽度轮廓」受约束归一，不继续依赖当前坐标契约错误的稀疏位移场。
- 中性灰修正图由多色批次的低频亮度场统计生成，边缘与高频织物纹理受保护；颜色/整体明度不是统一目标。
- 主进程负责可测试的确定性像素处理，Photoshop/UXP 负责可编辑写入和真实读回，SKU executor 只负责编排。
- 手动与 Agent 两个入口共享 renderer 的 `executeSkuColorCardStrategy`；UXP 只采集确定性输入并展示进度，不复制第二套色卡工作流。
- “专业级”必须由轮廓一致性、低频光照残差、图层结构和截图证据共同验收，不靠成功文案。

---
