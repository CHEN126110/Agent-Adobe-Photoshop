# Current Task

## 2026-08-26 MAIN-IMAGE-RELIABILITY-R18：固定样本下的 Agent + Harness 质量成功率与运行效率

### 切换原因

用户指定一套本地“粉咖微压直板（加厚款木耳边）”摄影素材作为固定样本，要求用自然的一句话测试 Agent 能否在 Photoshop 中做到接近用户人工成稿与 Eagle 参考的专业设计效果，并要求治理无效时如实复盘，不能用机器分数或文件生成掩盖审美失败。真实绝对路径只由本地 Fixture 配置持有，不进入公开仓库。

### 目标

1. 以固定自然请求、不可变摄影输入、同一 Provider/模型、零人工介入和隔离输出目录建立可重复的真机成功率基线，不再按单个截图逐项打补丁。
2. 分开记录技术交付、证据完整性、Agent 决策质量、机器评价和人工成对商业评审；只有人工质量达到与用户作品 / Eagle 锚点大致可比，才算最低产品目标达成。
3. Harness 只承接任务身份、版本、来源、像素送达、预算、权限和验证事实；素材赢家、设计方向、审美取舍与 Photoshop 修订方法仍由同一多模态 Agent 决定。
4. 当前先达到“做得好”，再优化首写与总耗时；不用低思考、裁掉证据或减少复核换取表面提速。

### 当前事实

- r14 使用与 r13 完全相同的 68 个锁定输入，固定请求仍是“用这些摄影图帮我做一张商品主图。”，Provider/模型为 `openai-codex / gpt-5.6-sol`，0 次人工介入。技术交付通过，但运行状态为 `needs_review`。
- r14 用时 522269 ms，首次真实写入 277572 ms；20 iterations、21 次模型调用、29 次 Tool 调用、3 次已提交变更、14 次观察。固定 Case 技术交付 1/1，人工可用仍为 0/1；不能由单 Case 宣称总体成功率。
- Agent 真实看过项目联系表和 Eagle `LAKLHIYBNKNWN`，也正确声明 Reference Brief；它仍选择 `原图\DSC05303.JPG`，以“四色完整并排、色彩真实”作为点击理由，没有解释为什么使用摄影原图而非同名处理图，也没有挑战更强的上脚/场景候选。
- `evaluateDesign` 真实看了成稿、Eagle 参考与 240px 缩略图，给出 6.2 / revise，指出机械等距平排、光影/质感弱、纸带干扰、缩略标题不可读等 5 个具体问题。Agent 却明确选择“只放大标题并下移，不动摄影构图”，证明修订优先级判断失败。
- canonical Final Judge 面对同一成稿却给出 16/16 pass、89 分、零 diagnosis、零 Reflexion；人工成对评审为 `needs_fix / weaker / high confidence`，九维加权约 0.572（选材 0.35、商业效力 0.38）。这证实当前 90/89 机器分数与人工质量变化几乎无分辨力。
- Provider 原始出站证据已锁定 Harness 根因：候选联系表和 Eagle 像素都已真实发给主 Agent 并由成功模型回合消费，但终审额外要求模型输出精确 XML 自评块；因未命中该格式，两组证据均以 `runtime_visual_observation_missing` 被丢弃。Final Judge 实际只收到成稿与已置入源图。
- r14 所有订阅模型调用（主 Agent、素材分析、隔离评审和 Final Judge）的真实 Provider 日志均为 `reasoning_effort=low`，与“质量优先、允许更慢”的当前产品目标冲突。
- r15 / r16 分别用时 741968 / 757013 ms，Tool 参数 repair 均为 4 次；r16 还因视觉 presentation 先入队、下一模型分析槽未原子预留而在终局触发视觉预算错误。两轮都没有证明总体运行更快。
- r17 的原生对象 Tool 参数协议把 36 次完整链 Provider submission 的结构 /参数 repair 降为 0，但首代 `needs_review` 被普通 Reflexion 当成失败，自动重放原任务 393972 ms；完整链累计 903692 ms 并最终耗尽 900000 ms 软时限。首代 Final Judge + diagnosis repair 的 14 次图片 presentation 还被混入普通视觉累计，导致第二代主模型 15 轮全部无图。
- r18 使用同一 68 个锁定输入、同一自然请求与 `openai-codex / gpt-5.6-sol`，0 人工介入，只运行一个 TaskRun。墙钟 536130 ms，首次已提交 mutation 212003 ms，首次真正成功 mutation 249964 ms；16 iterations、18 次 Runtime 模型调用、29 次 Runtime Tool 调用。PSD/JPG、写后结构/视觉读回、目标 revision 和保存收据全部通过，终态为无 blocker 的诚实 `needs_review`，技术交付通过且没有自动第二代。
- r18 共 20 次 Provider submission /20 个独立 thread，envelope repair、Tool arguments repair、`argumentsJson` 与相关 invalid code全为 0。r17+r18 合计 56 次 submission、0 repair，已证明原生 `name.const + arguments object` 消除了 r14-r16 的确定性二次 JSON 修复开销。
- r18 普通 PerformanceLedger 为 model 17、vision candidates 5、visual analyses 5；Final Judge 的 6 张图只进入独立终审事件和 RuntimeAccounting，总视觉池保持 10/22。Final Judge 为 88 分、1 项可行动诊断，仍是 `artifact_incomplete / needs_review`，机器分数不能替代人工商业质量评审。
- 按一次用户任务真实终点，r18 比 r17 完整链缩短 367562 ms（40.67%）；首次真正成功写入 249964 ms 是 r14-r18 最快，比 r14 / r17 分别快 9.95% /18.20%。但 r18 总墙钟仍比 r14 慢 2.65%，单样本不能证明稳定分布全面优于旧基线。

### 实施边界

- 终审比较证据资格已改为“Runtime-owned exact presentation + 合法 identity/digest + 成功模型回合 consumedModelTurn + 候选/参考语义绑定”。未输出 XML 不再丢图，但原观察仍保持 `reviewed=false`，不伪造 Agent 已审美通过。
- 主图 Evaluation Profile 声明 `native_surface + list_thumbnail`；Final Judge 必须收到同版本 240px 列表缩略像素，生成失败时保持 not-ready，不用原图推测缩略效果。视图只校准真实使用情境，不规定版式或字号。
- `evaluateDesign.hardFindings` 保留兼容字段名，语义已降为“设计师自报待核查假设”；只有像素真实支持时才可计分，不再以“规则已核对硬伤”锚定评审。
- 隔离评审不再要求“只改 1–2 处”；问题必须按目标影响排序，“最小修订”指副作用最少地解决根因，不是改动数量最少；素材/方向不成立时局部移动不算解决。
- 主图 Manifest 声明 `reasoning.quality`；对当前同一多模态模型请求 `high`，并只映射到 Provider 目录真实支持的最近档位。不新建第二模型路由。
- Final Judge 的评价权威顺序明确为用户任务/Evaluation Goal → 真实像素与对照 → 作者自述；忠实实现 Agent 自选方向不能证明该方向解决用户任务。

### 验证与未知

- 已通过 Agent production build、Main/Renderer 类型检查、Runtime declaration、设计作者权、Agent 业务边界、Tool 注册、Design Reliability 聚合回归和 `git diff --check`。r18 真实 Provider → Photoshop 运行的 15 项 benchmark 机器检查全部通过。
- 完整 `maintenance:validate` 已通过 41 个核心检查，包含 Agent/UXP 类型检查、UXP production build、Final Judge 比较证据、Provider 逐图出站回执、跨代可信证据和可靠性发布门禁。视觉预算策略已迁出主循环，`agent.ts` 从 12941 行降至 12878 行并下调棘轮基线，没有通过抬高阈值换绿灯。
- Codex Final Judge 现在只有在成功 transport 的逐图回执与实际像素、顺序、candidate key 和字节摘要完全匹配时才采信评分；diagnosis repair 也必须独立证明重放同一组图。Design Reliability 的 `status` 与 `--require-live` 共用 Suite Manifest 门禁，单次满分或只评审少量样本不能再伪装成正式成功率。
- r18 最终画面已真实输出并由 Final Judge 看过，但尚未完成与用户店铺成稿 / Eagle 锚点的人工盲化成对评审；不能把 88 分或技术交付通过写成商业审美通过。
- 当前主要延迟仍是模型：18 次 Runtime 模型调用耗时 406299 ms、输入 990519 tokens；主循环单次平均约 60421 input tokens。两次内部视觉模型（Eagle / `evaluateDesign`）分别约 33.6 /41.2 秒。总墙钟尚未稳定优于 r14。
- r18 仍暴露两个效率 /正确性问题：Runtime 声明同轮的 `recommendAssets` 与 `searchEagleReferences` 被延后到下一轮；失败 `composeDesign` 声称“未修改 Photoshop”但真实 history 已从 8049 变到 8053。后者必须在写前完成可确定预检，或由事务 owner 回滚，不能用错误摘要掩盖 partial commit。

### 下一步

1. 先修 `composeDesign` partial commit：把能确定的主体框 /落位预演移到首次 Photoshop mutation 前；已经发生部分写入时，结果和用户提示必须报告真实 mutation，必要时由现有事务 owner 回滚，不能继续声称“本次未修改”。
2. 收敛 Runtime declaration 同轮工具延后：只在新能力边界下重新预检模型已经请求的兼容只读调用，不重放、不扩权、不替 Agent 选 Tool；以减少一个无信息增益模型回合为验收。
3. 继续按 Performance / final-quality / Runtime reference owner 收缩 `agent.ts`，但本轮视觉预算策略拆分和 12878 行新棘轮已经完成；不得把后续功能重新堆回主循环。
4. 用同一 `main-image-commercial-v1` 对 r18、r14、用户店铺成稿和 Eagle 锚点做人工盲化成对评审；只有质量不退化后才扩大到至少 3 个固定重复样本，验证 wall time /首次成功写入的分布，而不是继续用单次轨迹下结论。

### 状态

`in_progress / live_r18_complete / single_generation_technical_delivery_passed / warning_only_auto_reentry_fixed / native_tool_args_56_submissions_zero_repair / final_quality_budget_isolated / final_quality_visual_receipt_fail_closed / reliability_release_gates_manifest_owned / first_successful_mutation_best_so_far / wall_time_not_yet_better_than_r14 / human_pairwise_review_pending / full_core_validation_41_passed / production_build_green`

---

## 2026-08-24 DESIGN-AESTHETIC-GROUNDING-001：详情页、主图与 SKU 的参考扎根和任务相对审美

### 切换原因

用户要求 Agent 不靠“高级、好看”等空泛提示词，而是先理解详情页、主图、SKU 三类真实交付物，并只读查看 Eagle 收藏参考与本地用户作品，再把可迁移的设计关系接入现有 Agent / Design Kernel / Skill / Evaluation 边界。

### 目标

1. 详情页是多屏连续说服：每屏承担一个消费者问题，感受、机理与证明形成事实有来源的叙事；终审要看完整屏幕集合和跨屏视觉系统。
2. 主图是点击图 + 转化图体系：点击图服务缩略图识别与风格钩子，允许纯摄影成立；转化图用一个主卖点和证明画面解释购买理由，不把两者混成固定模板。
3. SKU 是色卡、可复用组合模板与批量成品组成的交易信息系统：视觉美感服从件数、颜色、款式、自选/固定/随机规则无歧义；2/3/4 件变体共享 token 但按数量重新平衡。

### 当前事实

- 当前 Eagle 4.0.0 库可只读访问，共 2524 项；正式标签命中详情页 93、主图 100（点击图 21、转化图 85）、SKU 53，另有 352 项待人工复核。AI Search 当前为 `starting`、0 项同步、Python 服务不健康，因此本轮只使用目录、标签、关键词与实际看图证据，不伪装成向量语义检索。
- 已对本地用户作品中的 C-1248/C-1183/C-1137/C-1163 等项目详情页切片、主图和 2/3/4 双 SKU 成品做只读联系表与放大观察。用户作品存在多套成立的视觉语言，也存在 `C-1183\images\详情页_05.jpg` 的 `AAAAAAAAAA` 占位错误；收藏或历史作品都不能无条件晋升为正样本。
- 现有 Runtime 已有 `RuntimeReferenceBriefDeclaration`、多模态终局 Judge 和任务 Profile，但终局 Judge 原来只消费 Brief / Strategy，没有消费已经校验的参考洞察；SKU Template Manifest 原来只有通用方法知识，没有任务专属模板方法 overlay。

### 实施边界

- `design-method-knowledge.ts`：主图方法升级为点击/转化双目标；详情页补齐逐屏问题、感受/机理/证明、跨屏节奏与占位清零；新增 `knowledge:ecommerce.sku-template/v1`，覆盖交易无歧义、场景卡/纯底语法、跨 2/3/4 件 token、浅色轮廓、自选备注和可编辑结构。
- `sku-template.manifest.ts`：显式装载 SKU Template 方法知识；仍复用现有 General Design Evaluation，避免在没有完整多变体 ReviewSet 时伪造“整个 SKU 模板系统已视觉通过”。
- `design-quality-assertion.ts` + `agent.ts`：终局视觉评价的 user-data envelope 新增有界 reference 槽；`ready` 才传观察与迁移洞察，`degraded` 只传决策与限制，`waived` 不把“未使用参考”伪装成参考依据。该槽不授权 Tool、不推进阶段、不改变完成权。
- 当前审计产物位于 `tmp/product-design-audit-2026-08-24/`，仅作开发取证，不进入 Runtime、模型长期记忆或正式 Knowledge。

### 验证与未知

- 已通过完整 36 阶段 `maintenance:validate`，包含规划/仓库卫生/编码、工具与 Skill 审计、执行器和简化棘轮、设计作者权/业务边界、现行功能测试、Main/Renderer 类型检查与 UXP production build；定向的 Runtime、Capability、Prompt、Skill Package 审计也均为绿色。
- 本轮没有调用真实 Provider 在 Photoshop 中重新生产详情页、主图或 SKU，不能把静态审计、类型检查或参考分析描述为商业质量已通过。
- Eagle 收藏不等于用户认可；参考洞察保持本次运行范围。正式偏好或 Skill 改进仍须走现有人工复核 /候选发布边界，不能把整库或整目录直接写入生产 Prompt。
- SKU Template 专属 Evaluation Profile 后置到运行时能稳定提交 2/3/4 件与备注图完整多画面 ReviewSet 之后；此前不以单张最终画面冒充跨变体一致性。

### 下一步

1. 完成现行 `maintenance:validate`，确认本轮方法知识与参考评价槽未破坏相邻运行链。
2. 在隔离项目 /测试文档上分别跑一例主图、详情页和 SKU 模板，保存同版本 ReviewSet，做用户作品与 Eagle 多参考的成对视觉复核。
3. 只有多样本真实任务和人工成对比较稳定后，才发布用户偏好校准或新增 SKU Template 专属多画面 Evaluation Profile。

### 状态

`validated / code_complete / source_audit_complete / targeted_validation_green / full_core_validation_36_passed / live_photoshop_multi_task_quality_unverified`

---

# 2026-08-24 同 TaskRun 交互续跑与 Skill 效果真相治理

> 状态：`code_complete / full_core_validation_36_passed / live_photoshop_confirmation_pending`

## 根因与裁决

- 交互卡确认不是新用户任务。卡片 envelope 只证明用户提交、会话、分支与项目归属；带活动 checkpoint 时，Photoshop 当前 document /history 的唯一对账 owner 是同一 `RuntimeSession / TaskRun`，不能再用暂停前旧 revision 提前否决 post-Skill Agent reentry。
- Skill 返回的 `toolResults / operationResults` 只能证明公开出来的调用，不能证明内部没有遗漏写调用。`effect=none` 只能来自执行前、严格只读声明、同 lineage 子收据，或 Runtime-owned 完整原子 Tool ledger。
- Skill effect receipt 必须绑定 `sessionId / runId / generation / taskRunId / planRevision / continuationId / workflowCallId / skillId`；旧 generation、旧 continuation、旧 workflow call 或其他 Skill 的已签收结果不得投影到当前 TaskRun。
- Skill 已开始后出现异常、结算 unknown 或 Agent 初始化失败时，不删除 checkpoint、不重放 Skill；原 TaskRun 保留 writer，并把 reconciliation 保存为 `pendingReentry`。未知副作用即使没有文档绑定，也以独立 `sideEffectState=unknown` 阻止后续外部写入、完成声明与 Artifact 发布。
- 有文档的 unknown 只能由 Runtime-owned 视觉回执解除：回执绑定 observationKey、Host document /history、观察 Tool、像素呈现回合和 Provider 完整消费回合。残留 base64、普通元数据、同一模型响应里的“先截图后写”、预算跳过和失败请求都不能冒充 Agent 已看过现场。
- post-Skill staging /commit /ledger settlement 的极端失败统一进入 abort-to-persistent-unknown：优先原子保留 checkpoint + pendingReentry，并把持久化 operation ledger 标为 unknown；Skill 已开始后绝不释放 writer 或自动重放。
- 同一 Workflow 连续返回下一张确认卡时，复用当前 Session /run /generation /TaskRun，暂停新的 interaction 并注册新 checkpoint；不创建第二 Runtime，也不加入 SKU 专属 Harness 分支。

## 已实现与验证边界

- 已完成 checkpoint reserve /stage /adopt /commit 生命周期、完整 writer 三元身份、单调 unknown、Action Plan journal 与 Workflow handoff 恢复、连续确认卡绑定、Runtime-owned Tool ledger、direct Host proof 与 receipt lineage 校验。
- 现有回归覆盖并发重复确认、旧 generation、post-Skill 异常、Agent 初始化失败、incomplete+completed 混合 revision、无文档 unknown、真实视觉投递→Provider 消费→像素压缩→下一动作、视觉预算跳过、Artifact hold、链式确认卡、staging 丢失恢复和 Skill 只执行一次。
- 自动审计与构建不能替代真实桌面验收。完整 checkpoint 仍是 Renderer 内存 owner；Renderer 重载后会安全拒绝旧卡，尚不能跨重载自动恢复 post-Skill Agent handoff。后续只能把它并入正式持久化 RuntimeSession owner，不能新建 SKU Store。

---

## 2026-08-24 IMAGE-PLACEMENT-FIRST-WRITE-001：图片落位首写准确性治理

### 切换原因

用户把当前优先级明确收敛为：图片不应先错误置入、再在错误结果上连续叠加缩放和位移；Agent 应在第一次 Photoshop 图片写入前理解源图、主体、目标区域、裁切意图和关注点，Harness 只提供事实、机械求解与验证，不替 Agent 选择素材或审美答案。原 `AGENT-PREACTION-EFFICIENCY-AND-PHOTOSHOP-CRAFT-001` 完整保留在本卡之后，但不再占据当前第一任务。

### 目标

1. `renderLayout` / `composeDesign` 在图片写入前读取源尺寸与可用主体框，预测 contain / cover / anchor / focalPoint 的最终图框和主体可见事实。
2. Agent 显式声明的 `subjectFillRatio` 在写入前求出最终图框；正常路径只执行一次 `placeImage`，不再 `placeImage → fit/transform`。
3. `protect-subject` 与可证明的主体裁切冲突时在任何图片写入前返回结构化事实；`allow-crop` 只进入真实画面复核，不由 Harness 否决。
4. UXP 对 place / transform 共用同一 target-fit 几何内核、事务 owner、写后读回和回滚；焦点被边界夹紧与几何执行成功分开记录。
5. 长页图片复核按全部目标保留覆盖义务，局部截图上限只限制生产数量，不能把未截图目标从分母中删除。
6. 写前预演、长页复核和 UXP 几何都进入现有核心验证；不新增一次性 smoke，不把规则继续堆进 7000 行执行器。

### 当前事实

- 真实失败素材 `4672×6453 → 750×426 cover` 的计划图框约有 `58.88%` 位于目标区域外；此前 UXP 正确执行了 Agent 的 center-cover，错误来自 Agent 构图选择与 Harness 假通过/观察覆盖不足，不是 Photoshop 随机裁坏。
- 写前预览只返回 planned bounds、内外面积、越界边、主体可见比例和焦点偏差；不输出审美分数、素材赢家或自动修复方案。
- `cropPolicy`、主体视觉占比、锚点、关注点与是否接受裁切仍归 Agent；Harness 只执行显式语义并保证事实一致。
- post-write 仍然必须存在，但职责是验证第一次写入是否与计划一致并让模型看真实像素，不能成为正常的试错式排版循环。
- “一次准确”是工程目标，不是伪造的绝对保证：主体检测置信不足或真实像素审美仍未知时，应在写前停止或在写后标记复核，不能把几何通过冒充设计通过。

### 实施边界

- Agent 决定素材、构图、主体视觉占比、锚点、关注点与是否接受裁切；Harness 只取得源/目标事实、求解显式几何、绑定版本、执行事务与返回读回。
- 不为 SKU、主图、详情页维护第二套缩放算法或执行器分支；这些任务共用同一写前计划、UXP target-fit 和视觉复核机制。
- 不以“最多修几次”替代首写质量，也不承诺绝对一次成功；可确定冲突必须写前失败，不确定审美必须由同一多模态 Agent 看真实像素。

### 下一步

1. 已完成完整 `maintenance:validate`，本轮真实回归按当前实现语义修复，没有降低作者权边界。
2. 已完成 compose/renderLayout 的失败清理、ownedLayers 祖先保护、组级 stage swap 与一次 placeImage 接线复查。
3. 待 DesignEcho 与最新版 UXP 运行窗口可用后，用独立 Photoshop 测试文档复现原竖图横框病例；不得修改用户现有成稿。

### 验证与未知

- 已通过纯几何预演、UXP 几何对照、compose 契约、作者权、类型检查、事务 owner 审计和完整 36 阶段 `maintenance:validate`；UXP production build 成功。
- 当前会话没有可用的 DesignEcho 运行窗口，Photoshop 正打开用户的 `SKU.psb`；为避免污染用户文档，本轮没有执行最新版 Agent→UXP→Photoshop 真机写入。静态、纯逻辑和构建结果不能冒充真机视觉通过。
- 最终审美仍取决于模型是否理解商品与设计目标；本轮只保证 Harness 不再把明显冲突写进 Photoshop，也不把几何成功伪装成审美成功。

### 状态

`validated / code_complete / prewrite_geometry_integrated / subject_fill_single_place_integrated / stage_group_swap_integrated / failed_candidate_isolation_integrated / shared_review_plan_integrated / uxp_geometry_tests_green / full_core_validation_36_passed / live_photoshop_recheck_pending`

## 2026-08-24 AGENT-PREACTION-EFFICIENCY-AND-PHOTOSHOP-CRAFT-001：假设驱动的首写效率与 Photoshop 工艺治理

### 切换原因

用户已明确把当前优先级切换为两项相互关联的治理目标：缩短 Agent 在真正操作 Photoshop 前的等待，同时提高 Agent 选择专业 Photoshop 工艺的能力。原 `DESIGN-QUALITY-REFLEXION-LIVE-001` 受共享订阅额度阻断，完整保留在本卡之后；本轮不把旧任务写成已完成，也不让旧任务继续占据当前第一任务卡。

本轮禁止按单个慢步骤或单次失败逐项打补丁。正式运行时改动前先固定因果假设、替代解释、证伪条件、预期区间、回滚门和单变量实验顺序；历史 Run Record 只用于发现重复模式，不直接充当当前 HEAD 的 A/B 基线。

### 目标

1. 把“提交请求到首个已验证有效 mutation”建立为独立产品指标，区分主模型等待、内部视觉调用、项目扫描、Capability 控制轮、Tool 执行、mutation commit 与 verification。
2. 消除重复事实取得和重复视觉消费，不删除真实看图、目标 /revision、安全执行、unknown reconciliation、关键写后读回或 R5 /Release 核查。
3. 让普通开放设计首轮可取得紧凑、品类中立的 Photoshop Craft 选择线索；Recipe 仍是 Knowledge，不是 Tool、权限、固定 Workflow、Stage 门票或完成证明。
4. 把稳定 Photoshop 技法逐步编译成目标绑定、可回滚、可读回的事务；Agent 保留素材、构图、占比、锚点、裁切和审美决定，Harness 只做机械编译与执行治理。
5. 每次只验证一个因果变量；目标指标改善、安全不退化、质量不退化且没有新增重复 owner 后，才进入下一切片。

### 已核实事实与未知边界

- 596 份历史 Run Record 跨多个代码版本，只有 51 份带首写计时；首个成功写入 P50 约 115.4 秒、P90 约 267 秒。它们能证明长期问题规模，不能代表当前未固定工作树的严格基线。
- 12 个带完整 Runtime accounting 的历史样本中，主模型约占总耗时 85.8%，Tool 约占 14.1%；样本偏小，只支持“先测模型回合”的优先级，不支持直接承诺固定提速秒数。
- 本地 `getDocumentInfo / getCanvasSnapshot / getLayerHierarchy` 通常是毫秒级；内部调用模型的联系表分析通常是几十秒级。相邻 Tool 的 `elapsedMs` 差值包含模型决策和 Tool 执行，不能当作纯 Tool 耗时。
- 当前 openai-codex 代码每轮创建 ephemeral thread，并重新注入完整历史和本轮 Tool catalog；服务端前缀缓存、thread start、inject 与推理的实际占比仍未知。
- 调查时普通开放设计首轮约 24 个 Tool、约 35k JSON 字符，全量约 176 个、约 164k 字符。渐进披露方向继续保留，不恢复全量首轮暴露。
- 当前正式 Craft Recipe 只有 3 条。架构裁决 D-070 /历史 Status 声称 plan-neutral 可取得 generic Recipe 索引，但当前源码和两个正式审计仍禁止这条接线；这是 owner /文档漂移，必须单独验证和修复，不能假设已经完成。
- 当前工作树存在持续变化的并行纵切；`composeDesign / subject-fit / tool-executor / preflight / UXP place-transform` 是热区。G0 /G1 不在这些文件上叠加行为改动，也不把并行改动计入本轮成果。

### 因果假设账本

#### H-PERF-01：主要延迟单位是模型回合，而不是本地 Photoshop Tool

- 假设：减少一个不必要的主模型回合，收益显著大于把一个本地读取再优化几十毫秒。
- 替代解释：当前 Provider、网络、项目扫描或 UXP modal 阻塞可能已经改变历史耗时结构。
- 预期：普通文本回合减少时，适用场景可能下降约 7–25 秒；重复视觉回合减少时可能下降约 20–50 秒。该区间只是假设，不是承诺。
- 证伪：当前固定 HEAD 中模型等待占首写时间低于 50%；或减少一轮后 TTFE 中位改善低于 5% 且落在波动内。
- 第一动作：只补 request / model / Tool /视觉 /commit /verification 分段遥测，不先改模型、线程、上下文或预算。

#### H-PERF-02：同一视觉证据被内部 analyzer 与主 Agent 重复消费

- 假设：`agentic` 联系表只生成确定性像素并由主 Agent 看一次，可以减少一次视觉模型成本且不降低素材选择质量；`staged` 可保留 typed analyzer，但不得自动把同一像素再投给主 Agent。
- 替代解释：两次视觉调用可能存在不同且不可替代的消费者，或当前并行代码已经改变了链路。
- 预期：`VisualCallAmplification` 从约 2 降到 1；素材总览任务 TTFE 中位至少改善 20%。
- 证伪：相同 image hash 当前没有重复投递；去重后结构化输出、选材正确率或设计质量明显下降；或第二轮扩展观察使总耗时不降反升。
- 回滚点：保留现有 typed analyzer；视觉交付增加明确 `pixels_for_primary / structured_preanalyzed` 语义，不用字段缺失猜测。

#### H-PERF-03：请求冻结时的 Host Photoshop baseline 可以安全复用

- 假设：Host 签发的 `documentId / historyStateId / activeLayerId` 可以满足同 revision 的 prior-read，避免模型再次读取基础文档身份。
- 替代解释：模型重复读取可能为了取得 baseline 未包含的结构信息；模型思考期间 revision 可能变化。
- 预期：eligible run 中重复 `getDocumentInfo / listDocuments` 比例低于 5%，首写前减少一个约 5–12 秒的模型回合。
- 证伪：模型仍普遍重复读取；首写回合数不降；stale revision、切档或切层时最终 UXP guard 未能 100% 阻断错误写入。
- 不变量：Host receipt 不授予 Tool、不算模型 Tool Call、不算 progress、不证明 mutation，最终 UXP target guard 继续读取真实状态。

#### H-PERF-04：项目重复扫描是确定浪费，但不是首要根因

- 假设：统一 `ProjectAssetSnapshot` 能减少同项目重复扫描并让 context /list /search /recommend /contact-sheet 共用候选事实，但单独不足以把分钟级首写降到几十秒。
- 替代解释：网络盘、超大目录、损坏文件或全量 metadata 读取可能使部分项目以 IO 为主。
- 预期：普通冷路径减少约 0.5–3 秒；同根热路径真实扫描次数降为每个唯一 snapshot key 一次；更重要的收益是一致候选集。
- 证伪：扫描在多数目标场景占 TTFE 超过 20%；或统一 snapshot 无法可靠感知文件新增、替换和删除。
- 回滚点：snapshot 只做只读 provider，保留显式 revision 失效和强制刷新；Photoshop history 变化不清空项目文件域。

#### H-PERF-05：Capability 两段控制轮在 owner 已知时是可消除税

- 假设：manifest owner 已知、唯一查询结果或高频小 schema 能力可受控 seed，减少 `search → request → invoke` 的 1–2 个模型回合。
- 替代解释：需要 discovery 的任务本身更复杂；扩大 schema 可能抵消收益。
- 预期：适用请求减少约 7–20 秒，非目标任务 baseline 不膨胀。
- 证伪：固定 A/B 后主模型回合不降、错选能力增加、Tool 权限扩大或 Tool catalog 成本抵消收益。
- 不变量：Capability 可见性不等于执行授权；不得根据关键词或文件名静默激活能力。

#### H-CRAFT-01：Photoshop 熟练度的首要缺口是技法选择上下文，不是继续增加 Tool

- 假设：普通设计首轮注入约 2.4k 字符的 generic Recipe 紧凑索引，会提高适用场景的正确技法选择率。
- 替代解释：低使用率可能来自 Tool 未暴露、schema 难用、UXP 不稳定或任务不适用，而不是知识缺失。
- 预期：固定适用案例的正确技法选择率达到至少 80%，Tool 调用数下降或持平；subject-fit、Smart Object、Mask、Adjustment + Clipping 和安全分组只按“适用率”统计。
- 证伪：模型确实看到 Recipe 后正确选择率提升不足 10 个百分点，或上下文成本上升但结构 /质量不改善。
- 第一动作：先修 D-070 与当前源码 /审计漂移，只接现有 3 条索引；不同时扩 Recipe、不扩 Tool baseline、不修改 compose schema。

#### H-CRAFT-02：`composeDesign` 大量失败来自模型承担了机械 schema 编译

- 假设：模型拥有设计语义，Harness 只做不改变意图的格式编译，可将近期约 41% 的 contract 失败降到低水平。
- 替代解释：失败可能主要来自 schema 漂移、执行实现或模型策略，而非机械格式。
- 预期：首次 schema /contract 通过率达到 95% 以上，失败后无需重提整份设计对象。
- 证伪：错误分类显示机械格式不是主要部分；编译器上线后通过率没有明显改善；或编译器通过 default /clamp 偷偷改变设计结果。
- 允许的机械处理：trim、Hex 标准化、稳定枚举别名、空可选字段删除、单位转换。
- 禁止：自动补色、改构图、换素材、决定字号、比例 clamp 或隐藏失败。

#### H-CRAFT-03：稳定高频技法适合编译为唯一 Runner 下的复合事务

- 假设：`place + subject-fit`、`adjustment + clipping`、Smart Object 批量替换等稳定机械组合，使用带 target /revision /rollback /readback 的 compound Tool 可减少模型回合、revision 漂移和中间失败。
- 替代解释：复合 Tool 可能放大副作用、隐藏部分失败或限制真实设计修订。
- 预期：适用技法减少 1–4 次 Tool /模型往返，失败只留下一个明确 operation receipt，相互抵消 transform 接近 0。
- 证伪：成功率或可诊断性不高于原子路径；rollback 不完整；模型频繁绕过组合；或复合 Tool 开始替 Agent 决定素材、构图、比例和审美。
- 前置：当前 subject-fit / compose / UXP 热纵切稳定并完成可归属验证；复合能力继续使用唯一 `PhotoshopTransactionRunner`，不能建立第二事务 owner。

#### H-PERF-06：Codex thread 复用可能有价值，但证据不足以立即实施

- 假设：同一 TaskRun 复用 thread、增量注入消息，可以减少重复 thread start、完整 history 与 Tool catalog 提交。
- 替代解释：服务端前缀缓存可能已吸收大部分成本，真实时间主要在推理；动态 Tool surface 与 ContextManager 裁剪可能要求旋转 thread。
- 预期：暂不设秒数。只有 `threadStart + historyInject` 占比和 provider usage 证实后才建立收益目标。
- 证伪：这两段低于模型回合总时长 5%，复用收益落在波动内，或出现跨 Run 串线、取消污染、schema 版本混用。
- 当前动作：只记录 `threadStartMs / historyInjectMs / firstEventMs / turnDurationMs / unsubscribeMs / schemaChars / historyChars / cachedUsage / structuredRepairCount`。

### 实验顺序

1. `G0`：任务卡、假设、基线口径、不变量和回滚门；不改运行行为。
2. `G1`：只观察的 Runtime Accounting / Run Record / Codex phase timing；不得改变预算、Tool 面、模型参数或用户呈现。
3. `G2-A`：Host initial Photoshop receipt；单独 A/B。
4. `G2-B`：同根缓存幂等与 `ProjectAssetSnapshot`；与 Host receipt 分开验证。
5. `G2-C`：视觉证据只消费一次；不同时改候选数、分辨率、model effort 或 Recipe。
6. `G3`：只修 D-070 generic Recipe 首轮接线与正式审计漂移。
7. `G4`：先分类 `composeDesign` 失败，再做机械编译边界；之后才逐个验证最小 Recipe /compound transaction。
8. `G5`：Capability 控制轮治理。
9. `G6`：只有 G1 证明收益后，才考虑 Codex thread 复用、object arguments 与 reasoning 透传。

每个实验固定 commit /build、Provider /model /reasoning、用户文本、项目素材 fingerprint、起始 PSD /history、Tool surface 和缓存状态；真实模型采用配对 ABBA /BAAB，不能拿不同日期、项目和模型的运行直接比较。每个核心 cell 先做 8 对 pilot，正式结论至少 20 对；本地确定性 cache 微基准至少 30 次。

### 核心指标与预期

- 用户主指标：`UI send accepted → first successful UXP mutation commit`，另记 `mutation verified`，不得把 post-readback 时间混成 commit。
- 往返：首写前主模型轮、Tool 调用、内部 VLM、Capability 控制轮、重复 document read、同 image hash presentation 次数。
- 放大率：`VisualCallAmplification`、`ScanAmplification`、`DuplicateObservationRate`。
- 上下文：system /history /Tool schema 字符数、图片数、Provider 真实 input /output /cached token；Provider 未上报时记 `unknown`，不能填 0 或自行估算。
- Craft：适用场景正确技法选择率、相互抵消 mutation、重复完整 compose、首次 schema 通过率、非破坏性结构合规率。
- 安全与质量：正确 document /layer /revision、unknown reconciliation、同目标读回、staged 输出完整性、DesignVerdict、成稿盲评和用户明确接受。

阶段目标值不是当前事实：已知目标的单步修改 TTFE P50 ≤30 秒 / P90 ≤60 秒；冷启动且需要一次素材总览的设计 P50 ≤60–70 秒；项目和视觉缓存命中 P50 ≤40 秒。单切片发布要求目标 cell 中位改善、P90 不明显恶化、完成且有真实写入率不下降超过 5 个百分点、Design evaluator 中位不下降超过 3 分、盲评 B 胜或平至少 80%，且安全边界 100% 通过。

### 立即停止与回滚门

出现任一项立即停止当前切片，不得继续叠加兜底：

1. 错 document、layer 或 revision 写入；stale revision 未被最终 guard 捕获。
2. mutation 失败却记录成功，或 unknown mutation 被自动重放。
3. Host 普通对象可以伪造可信 receipt，或 Capability seed 扩大执行权限。
4. 素材变化后仍返回旧候选 /联系表；agentic 优化破坏 staged typed analyzer。
5. 同一视觉证据仍被隐藏投递两次，或像素没有进入主模型却被标为“已看图”。
6. 模型轮数下降但返工、重复 compose、反向 transform 或失败率上升。
7. Recipe /compiler /compound Tool 开始替 Agent 选择素材、构图、颜色、字号、占比或审美。
8. 性能改善但同目标读回、可编辑结构、DesignVerdict 或专业盲评质量下降。
9. 当前固定 HEAD 基线无法复现，却继续用跨版本历史均值宣布成功。

### 当前实施边界与状态

- `G0` 已完成；`G1-A` 已通过完整 36 项核心验证：普通 plan-neutral / agentic 使用同类型 unscoped `RuntimeAccountingLedger`，晚绑定 staged 时把真实模型 /Tool /usage /prompt shape 转移到 Session 并释放旧 owner，不再补造 `0ms` 模型调用；staged /晚绑定后的 Provider 失败在缺少 Session digest 时仍保留顶层会计 fallback。
- 持久化摘要只保存视觉 observation key 的稳定 SHA-256 投影，活动 Performance Ledger 继续保留原键；生命周期、owner 互斥、超长键、staged failure fallback 与严格持久化边界已有现有 `test:run-fact-ledger` 回归覆盖。
- `G1-A` 尚待重载当前 build 后用一条普通请求确认真实 Run Record 顶层 `runtimeAccounting`；`G1-B` 的 Codex provider phase timing 保持独立切片，不与 thread 复用或性能行为修改混做。
- 开发遥测不得进入生产 Prompt、Tool 权限、完成判定或普通用户 UI。
- 当前并行热区稳定前，不修改 `composeDesign / subject-fit / tool-executor / agent-tool-execution-preflight / Photoshop place-transform`；不覆盖、不暂存、不回退现有未提交改动。
- 不先做持久 Codex thread、不换模型、不扩大 reasoning、不一次新增大量 Recipe、不恢复 176 Tool 首轮、不新增 smoke、不微调模型。
- 状态：`in_progress / g0_hypothesis_ledger_established / g1a_unscoped_accounting_core_validated / staged_failure_fallback_validated / observation_key_digest_boundary_validated / full_36_check_maintenance_passed / live_run_record_pending / g1b_provider_phase_timing_pending / runtime_behavior_unchanged`。

## 2026-08-22 DESIGN-QUALITY-REFLEXION-LIVE-001：无 Skill 设计质量反馈与 Agent 自主修订闭环

### 目标

用同一句普通用户需求和同一组真实素材验证：不依赖业务 Skill 的设计 Agent 能先自主选图和设计，再以同一 Photoshop revision 的真实画面评价发现最影响任务效果的问题，并在同一授权、同一预算内由 Agent 自主完成最多一次有界修订。Harness 只提供画面事实、评价反馈、预算、目标 /revision 与安全边界，不替 Agent 选择版式、文案、素材或修改动作。

### 当前事实

- 第七轮真实产物 `腊肠狗条纹袜商品主图-V04.psd` 已形成 13 个可编辑图层、2 个智能对象和清楚分组；两张素材分别承担多色证明与上脚证明，选图已有真实理由，不再是反复盲选单只袜子。
- 第七轮仍只是干净草稿：双栏画册式层级让商品与腊肠狗刺绣没有成为缩略图第一焦点，弱小辅助文案和大面积非商品内容占用注意力。Agent 只做一次 `composeDesign` 后即自行宣布完成，没有做影响点击任务的一轮修订。
- 第七轮终局 Judge 只使用旧版 8 项任务中性目录，`impact.squint` 和 `comp.subject-ratio` 均未评价；89 分只代表这 8 项内部结果，不能解释成主图商业质量接近 90。`impact.squint` 的缺席是通用任务效力盲区；主体比例仍保留给模型绑定的主图 Profile，不为当前样例写入通用固定比例。
- 第七轮已经生成 `completed_aesthetic_improvement` handoff，且两条 diagnosis 均绑定 document 4087 / history 4130；没有子运行的直接原因是 `reflexion-reentry-policy` 把该 handoff 强制改成 `completed_aesthetic_review_terminal`。不是模型、VLM、Project State、预算身份或 Photoshop 失败。
- 终审又发现一个跨代竞态：旧 handoff 只把 `sourceId / observationKey` 写进描述文字，没有机器可校验的 ReviewSet 版本来源；若两代之间 Photoshop 被外部修改，旧评价可能影响新版本。现已把 document/history/observationKeys 写入既有 handoff，并以 WeakMap 可信视觉 Artifact 核对来源；下一代第一项写入若版本已变化，必须由 Agent 自主完整观察当前版本后才能继续。
- 第八轮干净项目已建立，48 张素材与空主图目录均核对；Sol 与临时 Terra 都在 iteration 0、零 Tool、零 Photoshop mutation 时返回同一 ChatGPT/Codex 订阅用量上限，服务提示 2026-08-28 09:01 后重试。原 Sol 模型偏好已经恢复。

### 实施边界

1. `impact.squint` 只判断用户当前任务在典型使用尺寸下能否识别首要沟通对象；不要求高冲击、唯一焦点、营销风格或固定主体比例。
2. completed 后的可靠评价只能在同一 TaskRun 和累计预算中唤醒 Agent 一次；Harness 不直接调用 Photoshop mutation，原 execution preflight、目标绑定、取消、预算、无进展与次数上限继续 fail closed。
3. completed handoff 只传同一 ReviewSet / history 上、带结构化 observationKey 的 paired diagnosis；缺 binding、重复 key、issue 指向集合外 key 或与运行结果的可信视觉 Artifact 不一致时不得重入。同批 `summary.warnings`、failureAnalysis、strategyAdjustments 和 scorecard 通用 expectedFix 不得重复扩大成命令。
4. 评价反馈以“画面观察 + 可检验方向”交给 Agent；Agent 可以接受、否定、补观察或选择其它可逆修订，不能把建议本身当成写入授权。
5. 不用“主图”等关键词让 Harness 选择 Skill / Profile，不强制查询 Eagle、独立评审或固定七步流程；模型完成结构化任务语义绑定后，才可取得对应 Profile 的专门评价。

### 下一步

订阅额度恢复或用户补充可用额度后，在第八轮干净项目中继续使用原句「帮我用这个文件夹里的素材重新做一张商品主图，先自己看素材决定怎么做。」复跑 Sol。必须核对父代终审是否包含 `impact.squint`、handoff 是否与可信 ReviewSet Artifact 完全一致且只携带 paired diagnosis、是否生成独立 parent / child Run Record、同版本时是否直接交给子 Agent 判断、版本漂移时是否先由 Agent 自主完整重看、最终 history 是否变化并重新闭合结构 /像素 /post-judge 读回；再把结果与第七轮、用户原图和 Eagle 参考做同尺寸比较。

### 验证与未知

- 已通过：completed Agent-owned reentry、paired-only handoff、缺失/伪造/错版本 ReviewSet binding 不重入、旧评价第一写入新鲜度、版本变化后 Agent 完整重看恢复、预算耗尽不重入、通用 `impact.squint` 边界、Provider usage-limit 分类的正式业务 /作者权审计；34 项核心维护验证、Agent 生产构建与 UXP 生产构建均通过。
- 第七轮已真实验证：素材观察、选图、Photoshop 写入、可编辑结构、终局 pre-judge 结构包、VLM Judge、post-judge revision 与 handoff 生成。未验证：新策略下的真实父子重入、修订后画面质量和 Sol 商业质量；第八轮被外部订阅额度在首轮阻断，不能冒充 E2E。

### 状态

`in_progress / seventh_live_root_cause_verified / agent_owned_single_reentry_implemented / task_neutral_impact_evaluation_added / paired_diagnosis_only_feedback_implemented / reviewset_provenance_and_first_write_freshness_implemented / provider_usage_limit_classified / full_34_check_maintenance_and_production_build_passed / eighth_live_replay_blocked_by_shared_subscription_usage_limit / sol_preferences_restored / post_reset_live_parent_child_replay_pending`

## 2026-08-21 COMPOSE-FAILURE-SEMANTICS-001：首稿校验、失败熔断与用户表达治理

### 目标

修复主图真机运行中 `composeDesign` 连续补齐不同参数却被 Harness 当成「同一种处理重复失败」终止，以及内部 Tool 名、JSON 字段路径和步数直接展示给用户的问题。Harness 应把完整执行契约一次性交给模型，只在同一失败原因原样重复时熔断；用户只看到设计师能解释的当前结果与卡点。

### 当前事实

- 真实运行的三次 `composeDesign` 失败原因依次为：主体阴影与背景处理冲突、主体占比缺失、第三个排版区域缺少用途与内容。模型在逐项修正，并非重复撞同一堵墙。
- 旧熔断器只按 Tool 名累计，所以三个不同错误也会触发连续失败上限；这是 Harness 误判，不是模型失去修正能力。
- 执行器要求 canvas、palette、subject、background、layout region 和 save 的多层必填字段，但模型可见 JSON Schema 没有完整声明；Harness 先少给说明、再用隐藏规则处罚模型。
- 用户看到的 `composeDesign`、`layout.regions[2]`、`role/content` 与「已处理 10 步」来自运行时收尾模板和原始诊断泄漏，不是设计师面向用户的正常表达。
- 该失败运行沿用了旧会话工具面和重复用户 Prompt，开始时间早于本轮生产构建；不能用它判定最新修复无效，但它暴露的上述代码缺陷均真实存在。
- 重载后的干净会话只输入「帮我用项目里的素材做一张主图。」时，模型已自主选材、决定不编造文案并创建新 Photoshop 文档；新的失败来自复合工具内部：摄影优先路径先按 `main-image` 区域定位商品图，随后从待渲染区域移除该区域，却仍要求至少存在一个文字或装饰区域。有效的纯图片设计因此被 Harness 拒绝。
- 该复合调用已经创建文档、置入并定位商品图，但旧失败结果没有稳定声明 `createdDocument / layoutRendered / partialMutation`，导致运行档案把部分成功写成未新建文档；这是回执一致性问题，不是 Agent 设计判断问题。

### 实施边界

1. Schema 只声明 Tool 真正需要的结构、类型与兼容关系，不替 Agent 选择版式、区域语义、主体占比、颜色或视觉风格。
2. 失败熔断保护真实执行安全，但必须区分「原样重犯」与「根据错误继续修正」；不能按 Tool 名粗暴累计。
3. 内部诊断保留给模型与开发日志；用户可见结果必须表达业务含义，不展示 JSON 路径、Tool 名、循环计数或 Harness 调度术语。
4. 不通过放宽 Photoshop 写入约束、吞掉错误或伪造成功来改善表面体验。

### 实施结果

1. `composeDesign` Schema 已与真实执行契约对齐：多层对象显式声明 required；photo / cutout 分支分别约束主体占比或抠图决定；区域必须带 id、role、content 与完整 bounds。约束只要求模型给出自己的答案，不补任何内置版式或审美默认。
2. 连续失败计数改为比较归一化后的错误原因：同 Tool 出现不同校验问题会重置为 1，表示 Agent 正在取得修正进展；只有相同问题连续出现三次才停止。
3. 循环停机、最后工具摘要和执行告警不再展示内部 Tool 名、字段路径或处理步数；诊断清洗把具体字段问题转换为「第 3 个区域还没有说明用途和内容」等自然表达。
4. 定向验证覆盖完整 Schema、不同错误不误判、相同错误仍能熔断，以及原始真机错误到用户语言的转换；没有为通过检查删除执行器约束或放宽安全门。
5. `renderLayout` 新增受限的 owned-layer-only 结构整理模式：仅当调用方已经提供当前文档中的真实图层时，允许没有剩余 blocks / regions，并继续完成语义分组、图层读回与真实快照；普通空布局仍然 fail closed。它只承认 Agent 已经做出的纯图片设计，不补文案、坐标或审美默认。
6. `composeDesign` 成功和部分失败都返回统一执行收据；新文档已创建、排版是否完成和部分写入分别记账。完成契约只在 `document.mode=new` 时把复合调用计为新建文档，编辑当前文档不再被误算为新建。
7. 用户过程把「一次成稿」改为「制作首稿」，启动状态从固定宣布检查 Photoshop 改为中性的需求理解；Harness 不再替 Agent 公开决定工作步骤。

### 下一步

重载本轮最新 production build 后再建一个干净会话，只输入一句「帮我用项目里的素材做一张主图。」；重点核对纯图片选择能否直接完成语义分组与写后快照、图层结构是否符合交付习惯、最终回复是否只说设计结果与自然卡点，并记录工具次数、首次真实写入延迟和整体耗时。

### 验证与未知

- 已通过：`verify-compose-design-spec`、`verify-design-authorship-boundary`、`verify-run-fact-ledger`、Main / Renderer 类型检查、Skill Package 契约（首轮 13 个 Tool 且 Schema 低于 16000 字符）、完整 `maintenance:validate` 33 个核心检查、Agent / UXP production build 与 scoped `git diff --check`。
- 已完成第一轮干净实机定位：Agent 的选材、纯图片设计判断和新建文档均真实发生；暴露并修复 owned-layer-only 适配与部分成功回执缺口。待完成：重载本轮修复后的第二次 Photoshop 真机复验。

### 状态

`in_progress / implementation_complete / full_core_33_checks_passed / production_build_passed / first_clean_live_replay_root_cause_fixed / second_live_photoshop_replay_pending`

## 2026-08-21 DESIGN-AUTHORSHIP-PRESET-CLEANUP-001：内置设计预设清理

### 目标

解决同类设计反复产出相同版式、主体比例、字色、阴影和占位结构的问题：开放创意由 Agent 基于用户目标、真实素材、项目状态与模型知识做决定；Harness 只提供事实、几何执行、权限、安全、结构收据和写后验证。平台尺寸、文件格式、SKU 组合数量等唯一可校验规格不按“设计预设”误删。

### 当前事实

- 已核实固定结果并非单一模型问题：通用 compose 入口、renderLayout、智能缩放、主图旧策略、参考复刻缺项补造、详情页固定结构卡和部分知识 /Prompt 同时存在隐藏审美默认。
- 已删除六套固定版式 recipe、详情页固定八屏结构预设、旧主图审美配方、未使用的旧视觉 Prompt，以及 agentic 主图 /详情页 Manifest 的标准模板绑定。
- `composeDesign` 现在要求 Agent 显式声明 regions、visualStyle、页面底色、主体处理 /占比和完整投影参数；颜色只接受明确色值，不把“米白 /高级 /柔和阴影”等标签翻译成固定色号或 Photoshop 参数。
- 全局智能缩放不再有品类 /角色 /意图表和 70% 主体占比；参考复刻不再在缺参数时补统一阴影、描边、彩色占位块、坐标或文案。
- SKU 色卡自身明确的组合、卡片结构和主体尺度仍属于 staged Skill 规格，不进入通用 Harness；恢复路径调用主体适配时也必须显式带 fill ratio 与 anchor。

### 实施边界

1. Agent 拥有版式、颜色、字体层级、主体尺度 /重心、背景、阴影、文案表达和是否复核的选择权。
2. Harness 可以校验字段、范围、对比度、越界、目标文档、事务和写后事实，但不得根据任务类型或缺省参数补视觉答案。
3. 用户 /项目模板和参考图属于可选证据；只有显式复刻 /套版任务才消费其真实结构，缺失参数不得用内置配方补造。
4. Skill 可拥有该业务唯一可验的生产规格；可变审美仍由 Agent 决定并作为完整参数交给 Tool。
5. `neutral_wireframe` 只服务明确结构预览，不得冒充设计成品。

### 下一步

重启桌面端，在桌面新建第二个干净项目副本，只提交一句“帮我用项目里的素材做一张主图。”：核对 Agent 是否自主选材、直接创建独立文档、按语义组织图层、使用正式保存 /导出而不是恢复点，并记录首次写入延迟、重复观察、最终画面和订阅桥是否仍会误中断活跃输出。静态验证不能替代这次 Photoshop 真机对照。

### 验证与未知

- 已通过：`test:compose-design-spec`、`test:design-authorship-boundary`、`test:recent-designs`、`test:run-fact-ledger`、Main /Renderer 类型检查、Agent /UXP production build，以及 `maintenance:validate` 33 个核心检查。
- 首轮开放设计仍保留 `createDocument + composeDesign` 真实写入入口；移除非执行必需的 rationale Tool 参数后，13 个首轮工具的 Schema 从 16018 降至 15465 字符，重新低于渐进披露预算。
- 运行事实账本已从固定 recipe 解析改为记录 Agent 显式 regions /blocks 生成的 `layoutSignature`，避免项目记忆继续传播已删除的内置配方身份。
- 2026-08-21 第二轮修复：订阅桥从固定总时限改为“活动增量刷新空闲时限 + 独立硬上限”，Provider 失败保持结构化归因；重复 Prompt 已去重；`smartSave` 从 Agent 工具面移除并强制写入 `.designecho/recovery`；新建模式 `composeDesign` 不再被旧画面读取门禁拦截；未过质量门首稿不再进入近期成稿。
- 工具面仍为 13 个：新增 `getLayerHierarchy` 事实读回，同时把额外设计方法论移到按需检索，避免固定内容和工具选择负担进入首轮；完整 `maintenance:validate` 33 项及 Agent /UXP production build 已通过。
- 待完成：第二轮重载后的 Photoshop 真机差异性、效率、交付完整性与超时验证。

### 状态

`validated / implementation_complete / built_in_aesthetic_presets_removed / deterministic_skill_specs_retained / recovery_save_isolated / subscription_idle_timeout_fixed / first_turn_tool_budget_13 / full_core_33_checks_passed / second_live_photoshop_validation_pending`

## 2026-08-21 MODEL-HARNESS-EFFECTIVENESS-001：GPT-5.6 有效能力与 Harness 运行效率治理

### 目标

不把「模型升级后效果变差」凭感觉归因给模型或 Harness，而是依据真实 Run Record 找到 Harness 对模型的拖慢、误报和越权点；保留权限、目标 /revision、事务、真实读回和硬预算，不以放宽安全换速度。

### 当前事实

- 522 次真实运行中，155 次 success（30%）、73 次 completed（14%）、21 次 completed 且有真实写入（4%）、399 次零写入（76%）、203 次预算 /无进展收尾（39%）。这证明系统有效表现远未稳定，但不能据此把全部失败归因于 GPT-5.6。
- GPT-5.6 SKU run 522 共 15 iterations、25 Tool calls、8 次写入；模型完成了能力发现、变换、文字和终图观察。Harness 同时制造了一次假失败：同一模型轮的只读 `searchAgentCapabilities` 被当成第二次 schema 装载，错误返回 `capability_request_round_budget_exceeded`。
- 普通问候 run 519 和系统审查 run 520 都在模型响应前被 Harness 强制调用 `getDocumentInfo`。这不是安全前置条件，却给非 Photoshop 任务增加延迟、上下文噪声和错误面。
- 重载后的 run 525「你是谁」与 run 526「那你可以看图理解项目图片中有哪些卖点吗」均为 1 iteration、0 Tool、0 Harness observation，证明通用开场不再误碰 Photoshop。新的问题是回答虽然没有越权行动，却把常驻「产品事实必须追溯」原则改写成了能力免责声明；真实输出中的「材质 /功能 /参数 /合规需资料确认」与该常驻原则直接对应。
- 旧审计把已收敛的 `composeDesign` 首稿能力误判为缺少 `placeImage + createTextLayer`，也因上下文编译新增字符预算参数误报 stage context 未刷新；两项已按当前真实不变量校准。
- SKU 自选备注原有两套互斥文件策略已经收口：所有备注先写入项目内隔离暂存目录，逐项验证文件可解码、尺寸和唯一正式路径，全部通过后再独占提交；失败回滚已提交文件并清理暂存，空父目录只走原子非递归删除。业务边界审计 3 条事务违规已清零。
- 用户截图中的「可校验的文档标识 / Photoshop 写入目标 / 当前已授权能力」不是模型生成的设计表达，而是 Tool preflight 原始 blocker 经术语替换后被直接投影进用户过程；实际生产身份虽已写「主设计师」，但 Harness 的公开过程绕过了该身份。这是用户感到 Agent 像工程系统而不是设计师的直接根因。
- 项目目录、当前 Photoshop 文档与用户点名交付物此前缺少同一组结构化事实：现已统一解析 canonical project root，运行上下文带开放文档的路径状态、项目亲和性和文档性质；主图、详情页、SKU 等用户原文交付义务逐项取得独立结果收据，不能再由一份模糊文件或模型完成措辞同时冒充多个交付物完成。

### 实施边界

1. 能力目录搜索保持只读且不消耗「每轮一次 schema 变更」额度；只有 `requestAgentCapabilities` 装载能力时消耗该额度。搜索后装载、装载后再搜索均保持可用。
2. 通用 autonomous Agent 的开场观察默认为 `none`；问候、解释和系统审查不再自动碰 Photoshop。模型仍可按任务需要调用 `getDocumentInfo`；结构化 Design Team 阶段显式保留 `canvas_visual`。
3. 恢复 `maxToolCalls` 真实硬上限；预算不替模型选择下一步，但必须阻止异常循环。连续 3 次同一 Tool 的已证实失败后停止再次执行该 Tool，并把失败事实交回模型；不能通过 no-progress 恢复把它重新放行。
4. `operation_unknown` 写入在两次通用读回仍无法对账后保持写锁并诚实停机，不允许以「继续根据画面操作」掩盖未知副作用。
5. 清除 Capability Resolver 中已失效的 confirmation 全局 deny；`agent.interaction.requestConfirmation` 使用可恢复的 `askUserToChoose`，不再因半迁移而不可达。
6. Runtime /业务审计改为验证生产语义：Capability 按 family 可发现、Prompt 不倾倒全目录、首稿入口为 `createDocument + composeDesign`、阶段上下文编译受统一字符预算约束。
7. 常驻产品事实原则只约束真正生成 /采信商品文案和写入交付物的场景；纯能力说明不主动复述边界。主 Agent 的身份提示要求能力咨询先说明能交付的具体结果和自然下一步，只有真实限制会直接影响当前目标时才展开，不通过关键词改路由，也不强迫能力问答调用 Tool。
8. 主 Agent 的首要身份收紧为对创意与质量负责的资深商业视觉设计师，Photoshop / Capability 只是制作媒介。Tool preflight 原始 blocker 只留给模型和诊断；用户过程由品类中立的公开投影说明正在核对的画面 /图层及设计原因，不展示 documentId、写入目标、授权能力、门禁或调度术语，也不削弱后台目标绑定和安全拦截。
9. 通用任务计划不再制造固定的「开场检查当前画面」步骤；只复用已经取得的上下文事实，由 Agent 自己决定是否补充观察和调用哪个只读 Tool。结构化 staged Skill 可以声明真正必要的输入观察，写入前目标 /revision 校验和写后读回继续强制。
10. 任务卡状态按 TaskRun /请求作用域隔离并可显式释放；用户点名交付物的收据与未完成项写回现有 Design Project State 的 `productionTasks`，不新建第二套任务状态或依赖渲染进程全局单例。

### 下一步

重载最新 `dist` 后继续同模型、同设置对照：能力问答应先说清能做出的结果和下一步，不再以常识性限制收尾；明确的「去看项目图片并提炼卖点」仍应由模型调用必要的只读观察，而不是被问答风格提示压成纯聊天。设计写入前缺少目标身份时，用户过程应显示「确认当前工作画面 /图层」及避免改错的设计师说明，后台仍保留原始 preflight blocker。SKU 还需验证一次装载前后继续搜索而无假失败。记录首次有用动作延迟、模型 /Tool 调用数、重复观察、真实写入和完成结果；只有真实重放仍显示搜索重复或视觉成本过高时，才继续改缓存和观察策略。

SKU 自选备注事务治理已完成代码和静态回归；下一次真机只需要验证同规格重跑、任一批次失败不留下部分正式交付、既有文件不被覆盖以及暂存目录可清理，不再需要设计第二套文件策略。

### 验证与未知

- 已通过：Renderer /Main 类型检查、Capability resolver、Runtime declaration、简化棘轮、Prompt capability governance、Tool /Handler /Skill /通用 Executor 审计、UTF-8 检查、scoped `git diff --check`、默认 5/5 测试与 Agent production build。Prompt 审计显式断言了「具体结果 /自然下一步 /不写免责声明」「产品事实只在交付内容中生效」，以及「资深商业视觉设计师 /创意与质量负责人 /工具只是媒介」；preflight 公开投影用真实原 blocker 回归，并断言用户文案不含 documentId、写入目标、文档身份、授权能力、Harness 或门禁。
- `maintenance:validate` 已完整通过 33 个核心检查，覆盖规划一致性、仓库卫生、UTF-8、Tool /Handler /Skill /Executor /Capability /Prompt /业务边界、事实账本、任务卡、Agent 类型检查和 UXP production build。Category Terms 审计已修复孤立根快照无法取得迁移前基线的问题，改为从仓库保留引用中找到真实首次引入父提交逐词对照；`KV / 视觉稿 / 场景图` 均取得旧代码证据，没有删词或放宽断言制造假绿。
- 已验证：桌面端重放 run 525 /526 后，普通对话的强制开场 Photoshop 调用已从真实运行中消失。未知：本次能力问答 Prompt 修复刚完成 production build，当前桌面进程尚未再次重载；SKU 搜索额度、真实 GPT-5.6 设计完成率和设计质量仍未实机复验。

### 状态

`validated / harness_root_causes_fixed / capability_search_no_longer_consumes_load_budget / generic_opening_observation_owned_by_agent / capability_answer_disclaimer_leak_fixed_in_prompt / designer_identity_strengthened / preflight_diagnostics_removed_from_user_process / hard_budget_and_repeated_failure_stop_restored / unknown_write_fail_closed / project_and_document_identity_structured / literal_deliverable_receipts_enforced / task_card_scope_isolated / sku_staging_transaction_closed / full_core_33_checks_passed / production_build_passed / designer_process_capability_answer_and_live_photoshop_replay_pending`

## 2026-08-21 TODAY-BOUNDARY-LANDING-001：今日 Agent / Harness / Skill / Tool 讨论落地

### 目标

把今天关于 Harness 不替 Agent 决策、业务能力归 Skill、通用电脑能力归受控 Tool Provider、SKU 好体验保留、交互卡减少沟通成本和代码卫生的讨论收敛为同一套生产边界；不把“像 Codex 一样操作电脑”误实现为默认开放任意 Shell 或无范围桌面控制。

### 当前事实

- Agent 拥有目标理解、设计判断、动态计划和下一动作选择；Harness 只拥有能力真相、上下文、权限、任务身份、目标 /revision、事务、核验、预算和安全停机。
- SKU、主图、详情页的业务方法、领域卡片 schema、校验和提交消费归各自 Skill package。Photoshop、项目文件、浏览器、桌面观察和未来命令执行是跨业务 Tool Provider，归 Harness 的 Capability /preflight /执行边界；Skill 只声明依赖，不能各复制一套电脑控制代码。
- DesignEcho 的产品边界仍是专业视觉设计与 Photoshop 生产 Agent，不扩张为任意通用电脑代办。电脑能力只按当前设计任务需要渐进装载。
- 原始命令工具暂不进入生产：当前还缺任务级批准回执、工作目录 /目标范围、风险分类、取消 /超时、输出脱敏和副作用读回。直接开启内置 Codex `shell_tool / computer_use` 或把外部 MCP 配置当作已授权工具都会越过现有安全 owner。

### 实施边界

1. 修正 Capability 映射：`agent.interaction.requestConfirmation` 改为 `askUserToChoose`；`createInteractiveCard` 只对应多字段结构化草稿，避免确认能力加载错工具。
2. 浏览器导航与交互被显式登记为 Harness 跨业务 Provider capability；业务 Skill 不拥有浏览器实现，执行仍走现有风险分类和批准纪律。
3. SKU 组合卡和人工复核卡 Provider 增加 `ownerSkillId=sku-batch`，注册表在启动时检查 owner 存在以及 `kind@payloadVersion` 唯一，并提供只读审计投影；通用 UI 不据此选择 Skill 或取得权限。
4. 设置页明确标注外部 MCP 当前只是配置存储，启用不等于 Agent 已可调用；在安全契约完成前不制造“已经接线”的假象。
5. 浏览器桥文档改用 `askUserToChoose(decisionKind=approval)`，并移除已退役 smoke 入口的错误说明。

### 下一步

在不新建第二 Capability Registry 的前提下，基于现有 Capability Session 和 execution preflight 实现 `COMPUTER-PROVIDER-AUTHORIZATION-001`：先做只读桌面观察与连接状态，再做有范围的文件操作；最后才接命令执行和桌面输入。每个 Provider 必须有用户启用、任务范围、Tool annotations /本地风险覆盖、批准回执、超时 /取消、结果脱敏和写后核验。外部 MCP 只编译已批准且分类完整的工具，未知与高风险能力 fail closed。

### 验证与未知

- 已通过：选择卡 /Skill Provider 定向测试、Main /Renderer 类型检查、Tool /Skill package /Executor /Capability /Prompt 审计、Agent 与 UXP production build、UTF-8 检查和 scoped `git diff --check`。
- 业务边界审计仍为相同 7 条既有失败：SKU 布局 /交付 1 条、SKU 暂存清理 2 条、主图 handoff 基线 3 条、stage context 刷新 1 条；Runtime declaration 审计仍停在既有 `hard tool budget must still stop all calls` 断言。本轮零新增，未修改断言制造假绿。
- 未知：真实桌面 UI 中选择卡加载、SKU 卡片恢复和浏览器 approval 尚未点击验收；外部 MCP、通用桌面写入和命令执行仍未接生产 Runtime，不能宣称可用。

### 状态

`validated / first_safe_slice_complete / interaction_mapping_fixed / skill_card_owner_registered / computer_provider_boundary_defined / arbitrary_shell_not_exposed / focused_tests_passed / production_build_passed / full_validation_still_blocked_by_preexisting_runtime_budget_assertion_and_7_business_audit_failures / live_ui_pending`

## 2026-08-21 SKILL-INTERACTION-BOUNDARY-001：Skill 卡片 Provider 与低沟通成本交互

### 目标

SKU、主图、详情页等 Skill 的业务交互不得渗入通用 Agent、ChatPanel 或通用卡片 Host；同时保留 SKU 组合卡已有的拖拽、增删、排序和人工复核体验。通用 Agent 卡片必须减少歧义，而不是为了展示 UI 增加沟通轮次或把同一任务重新发送一遍。

### 当前事实

- Agent 只直接看见通用交互能力和按需装载的 Skill 公开入口；SKU 组合卡、人工复核卡的构造、语义校验、提交和持久化属于 SKU Skill Provider，不作为散装 Tool 暴露。
- 通用交互只有两种稳定入口：`askUserToChoose` 处理 1–3 个实质选择；`createInteractiveCard` 只处理确有必要的多字段可编辑草稿。领域卡片只能由已选择 Skill 的 Provider 生成。
- 选择问题必须区分 `preference / required_fact / approval`。自动模式只能采用有推荐项的专业偏好；用户事实与授权不能由模型代答。
- 交互提交通过来源消息、对话 /项目作用域和 Runtime 身份恢复原任务；普通发送管线不得把卡片答案新建为无归属任务。

### 实施边界

1. SKU 组合提交、配方记忆、人工复核持久化和两类专属 Renderer 已迁入 `skill-executors/interaction-cards/` Provider 包；通用 `ChatPanel` 与 `InteractiveCardBlock` 不再导入或分支处理 SKU 卡片类型。
2. 通用 Tool executor 不再包含 `sku_combo_editor` 特判，而是只接受通用卡白名单；未注册业务卡 fail closed，由对应 Skill Provider 负责。
3. 关闭无法表达稳定提交语义的 `generic_confirmation`；简短选择走 `askUserToChoose`，多字段草稿走 `editable_confirmation`，两者提交后都结构化恢复原任务。
4. `askUserToChoose` 一次最多 3 题、每题最多 5 项，必须说明为什么由用户决定以及结果影响；可观察事实不应询问，低影响可逆判断由 Agent 自主完成。
5. 不允许 Agent 生成 React /HTML /CSS /脚本或任意提交动作；卡片内容可声明，渲染、身份、幂等、作用域和恢复由受控 Runtime 负责。

### 下一步

重载当前桌面端后做一次真实 UI 验收：普通偏好卡在 ask /auto 两种模式的行为、事实 /授权在 auto 模式仍停下、SKU 组合拖拽增删排序、SKU 人工复核写入、可编辑草稿提交后继续原任务。若出现额外沟通轮次，依据同一 Run 的来源消息和 resume 记录定位，不恢复普通发送重开任务。

### 验证与未知

- 已通过：选择卡与 Skill Provider 纯逻辑 /边界测试、Main /Renderer 类型检查、Agent 与 UXP production build、Tool registry、通用 executor 审计、UTF-8 检查与 scoped `git diff --check`。
- 完整 `maintenance:validate` 已运行，并在业务边界审计的 7 条既有债务处停止：SKU 布局接线 1、SKU 暂存 /清理 2、主图 handoff 3、stage context 1；本轮没有新增违规，也没有修改断言制造假绿。
- 未做：真实桌面卡片点击、同 TaskRun 恢复和 Photoshop 端到端验收。因此代码契约与构建已验证，不宣称真实交互耗时和视觉体验已经实机通过。

### 状态

`validated / code_complete / provider_boundary_closed_for_sku_cards / generic_card_modes_stabilized / focused_tests_passed / production_build_passed / full_validation_blocked_by_7_preexisting_business_audit_failures / live_ui_resume_validation_pending`

## 2026-08-21 AGENT-HARNESS-AUTHORITY-SUBTRACTION-002：Harness 下一步规划越权链完整收口

### 目标

用户确认「Harness 替模型决定下一步」属于越界，而且会拖慢 Agent；要求不再停在第一切片，直接完成治理，并把代码卫生作为硬要求。

### 当前事实

- Agent 拥有：理解目标、设计判断、动态计划、从当前可用能力中选择动作、根据失败事实决定恢复路线。
- Harness 拥有：上下文与能力真相、权限、目标文档与 revision、事务、副作用核验、预算和安全停机。
- Harness 可以拒绝不安全动作并返回事实、原因和当前授权边界；除非属于显式 staged Manifest 的规格或安全协议唯一动作，否则不得替 Agent 选择下一工具、裁剪下一轮工具面、合成 Tool call 或把验收缺口翻译成工具步骤。
- Tool / Skill 原始结果仍可在 Runtime 内部保留 `nextRequiredTool`、`allowedToolNames` 等历史兼容字段，但模型可见投影会剥离这些规划字段；开放式 agentic 路径不消费它们作为权限、计划或下一轮 allowlist。
- 显式 staged Runtime 仍可按版本化 Manifest、当前 Stage、Capability、目标 /revision 与工作流 continuation 做最小权限约束。这是规格化生产和执行安全，不进入开放创意路径，也不替模型生成调用。

### 实施边界

本轮删除所有已确认会接管下一轮动作选择的生产链；同时保留能力真相、授权、目标 /revision、事务、未知写入读回、完成真实性、预算与安全停机。不得以“自主”为名放宽 Photoshop 执行安全，也不新增第三套 Runtime。

1. 完整删除 `AgentRecoveryQueue` 及其 Tool decision、preflight、no-progress、stage-stall、required/no-call 等下一轮排队、allowlist 消费和强制 no-call 状态；恢复消息只报告失败、未完成、剩余授权能力数量或用户输入缺口。
2. 删除紧凑 E1 的确定性 workflow-owner Tool call 合成和首轮 owner-only 工具面裁剪。staged 执行点仍能拒绝越过唯一 workflow owner 的提前写入，但返回事实后由模型自己发起合法动作。
3. `applyWorkflowContinuationScope` 只在真实 `runtimeSession + runtimeStagePlan` 下生效；开放式 agentic Skill 结果中的 continuation、recovery 与 `allowedToolNames` 不再取得计划或权限。
4. Skill 模型投影不再输出 `nextAction / nextStep`；通用 Tool 模型投影递归剥离 `nextRequiredTool*`、`requiredTool*`、`requiredArguments` 与 `allowedToolNames`。原始结果仍供日志、staged 对账和诊断使用。
5. 完成契约补救从「调用哪个 Tool、传什么参数、按什么顺序」改为只列出确定未满足 /尚未验证的验收事实；用户目标、禁止项、同目标读回与真实交付证明仍是硬边界，具体补救动作由 Agent 选择。
6. 删除 execution preflight 对 Tool result `nextRequiredTool` 的隐式消费，以及失去调用方的交付工具筛选器；目标身份缺失的 blocker 不再点名 `getDocumentInfo`，只声明必须取得带文档身份的只读事实。
7. `audit:simplification-ratchet` 新增零容忍项，禁止 Recovery Queue、Tool call 合成、补救策略点名 Tool /参数、Skill nextStep 投影和 Tool-result 隐式预检授权回潮。

本文件较早条目中由 `resolveRequiredToolRecovery`、`nextRequiredTool` 或紧凑 owner 合成下一步的方案均为历史记录，不代表当前 Runtime 行为。

### 下一步

代码与生产构建已收口。下一步只做真机效果验证：重启桌面端加载新 `dist`，在安全 Photoshop 副本用同一批任务对比首次有效写入延迟、模型调用数、重复观察、工作流 owner 是否仍可达，以及完成且有真实写入率。若仍慢，依据运行档案定位新的事实瓶颈，不恢复下一步工具笼子。

### 验证与未知

- 已通过：Main / Renderer 类型检查、Agent production build、Tool、Executor generic、Capability resolver、Prompt capability governance、Planning check 与 simplification ratchet。
- 权力棘轮当前为：下一步 Tool 规划接管入口 `0`；主循环控制分支 `21 → 17 → 13`；`agent.ts` 行数 `13,707 → 13,554 → 13,025`。
- 新行为断言已通过：开放式 Skill 结果不把 nextAction / allowlist 投给模型；通用 Tool 结果不泄露内部下一 Tool 字段；紧凑 E1 owner 保持模型选择；完成契约只投验收事实。
- 完整 Runtime declaration 审计仍被既有 `hard tool budget must still stop all calls` 断言阻断。本轮没有降低或改写该无关断言。
- 业务边界审计仍为同样 7 条既有 SKU /主图 /stage-context 失败；本轮新增的权力边界检查全部为零违规，没有改断言、吞错误或扩充兜底制造假绿。
- 正式 `maintenance:validate` 已运行：规划一致性和仓库卫生通过，随后被未跟踪旧文档 `docs/asset-distillation-knowledge-feasibility-2026-08-19.md` 第 3 /165 行疑似乱码阻断；该文件不属于本任务，保持原状。
- 未做真实 Provider + Photoshop 端到端写入，因此不宣称真实设计速度和成功率已经改善。
- 历史兼容类型仍保留 `harness_compact_workflow_owner` 与若干 `nextRequiredTool*` 字段，用于读取旧运行档案和内部 staged 契约；生产 Agent 已不再生成前者，也不会把后者回灌成模型计划。

### 状态

`validated / code_complete / next_turn_planning_authority_zero / agent_recovery_queue_retired / production_build_passed / focused_boundary_checks_passed / full_runtime_and_business_audits_blocked_by_preexisting_failures / live_photoshop_effect_validation_pending`

## 2026-08-21 AGENT-HARNESS-BOUNDARY-CLOSURE-001：经验、设计能力、Prompt 与上下文边界收口

### 目标

用户不再接受零散修补或半成品：需要把经验到底归谁、Harness 与 Agent 的边界、通用设计能力与业务 Skill 的边界、系统提示和模型上下文如何治理一次收口，并参考行业最新实践给出工程决定，不把技术方案选择题交回用户。

### 当前事实

1. 经验不是 Agent 或 Harness 的附属字段：Memory / Knowledge 拥有内容与来源，Experience Publisher 拥有候选晋升，Evaluation 只提交 finding，Harness 负责检索、作用域、预算和生命周期，Agent 只在任务中解释 /使用。
2. Design Kernel 拥有跨品类设计能力；Skill 只叠加品类、渠道、交付物特有的方法与契约。开放创意保持 agentic；只有有唯一正确答案的规格化生产使用 staged。
3. 七步法、任务卡和独立评价都是按任务复杂度 /风险装载的脚手架，不是所有设计任务的固定门禁。System Prompt 只保留稳定身份、安全和少量跨任务原则。
4. 首轮 Capability 必须是真正小面：一对一叶子能力 + 只读搜索 + 精确装载；Capability 可见性不等于执行授权。
5. 每次模型调用只使用一个 context capacity plan：以真实模型窗口为总账本，预留输出和 Tool schema 后再编译消息；未知窗口保持 unknown，不按模型名猜测。

#### 已完成代码闭环

- Experience v2 候选隔离与 v1 安全迁移；模型评审只产生候选，用户明确项目反馈才可进入项目 Evaluation calibration。
- `studyReference` 的模型解读进入现有 Memory 人工审核队列；未审条目不可检索，审核批准后才转 active 知识。
- `searchAgentCapabilities → requestAgentCapabilities` 两阶段按需发现；中文长句复用真实 Tool 语义进行 CJK 片段匹配，搜索不改变 active tools。
- 通用设计首轮能力从聚合映射拆成叶子能力：实测 active tools 25 → 13，Tool schema 约 27.4k → 14.3k 字符，同时保留项目定位、文档识别 /切换、项目状态、看画布、建画布和可逆首稿。
- 模型窗口、输出、Tool schema、Runtime Context 与历史消息已纳入同一容量计划；受保护内容无法容纳时明确返回 `context_window_budget_exceeded`。
- 开放设计纪律中只有确定错误 /安全错误可硬阻断；七步 /任务卡 /评价已降为按需专业脚手架。

### 实施边界

本轮允许修改经验候选 /发布路径、Capability Session /Resolver、Context Manager /容量计划、通用 Prompt /设计纪律及其现有测试与真相源文档。不得借此重写 v3 循环、建立第三 Runtime、自动发布跨项目知识、放宽 Photoshop 事务安全，或修复共享脏工作树中与本边界无关的 SKU /Provider /UI 债务。

### 下一步

本轮代码、文档与本地验证已收口。后续仅在环境具备显式双重 opt-in 与有效 Provider 凭据时运行只读 search→load 接受测试；Photoshop 商业设计质量另走安全副本真机验收。共享工作树中的旧 SKU /Runtime /品类词与编码债务按各自任务处理，不归入本轮实现。

### 验证与未知

已通过：Main /Renderer 类型检查、Agent 与 UXP 生产构建、Tool /Handler /Skill /Capability /Prompt /Executor /Gate /三态 /Design Intelligence 审计、Skill Package、简化棘轮、经验专项及核心列出的全部功能测试；`git diff --check` 通过。完整 `maintenance:validate` 未全绿，首先被未跟踪旧文档两处疑似乱码阻断；逐项补跑还确认了 7 条既有业务边界债、1 条既有 Runtime hard-tool-budget 断言和品类词库无父提交 /3 个扩张词。未改这些无关文件或断言制造假绿。

真实 Provider 的 search→load 接受脚本语法与双重 opt-in 边界已验证，但本轮没有使用用户凭据发起真实 API 请求，因此不外推真实模型选择质量。真实 Photoshop 商业设计质量仍需独立真机任务验收，不由本次边界治理冒充。

### 状态

`done / runtime_and_governance_implemented / focused_and_production_build_validation_passed / documentation_converged / full_core_blocked_by_preexisting_dirty_worktree_failures / live_provider_and_photoshop_quality_not_claimed`

## 2026-08-21 CODEX-SUBSCRIPTION-PROVIDER-001：内置 ChatGPT 订阅登录、GPT-5.6 模型与 gpt-image-2 生图

### 目标

「我想在项目中内置一个 GPT 订阅的登录的模型，用户可以选择订阅模型 5.6 系列。」后续补充：「借助 Codex 的生图能力或 ChatGPT/Codex 订阅额度，让 Agent 调用生图。」

### 当前事实

- 官方 Codex App Server 是可嵌入自有产品的 JSON-RPC 协议层，支持 managed ChatGPT 登录、凭据自动刷新、`account/read`、`model/list`、`thread/start`、`turn/start` 与结构化最终输出。
- 捆绑并锁定 `@openai/codex@0.149.0` 后，本机协议握手真实返回 `gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna`；旧全局 Codex 0.125.0 无法解析新增的 `max` effort，证明产品不能依赖用户全局安装。
- 直接把 App Server 当第二个 Agent Runtime 会与 DesignEcho 现有 Agent 循环争夺历史、工具、完成判定与权限。已实测可用 `turn/start.outputSchema` 把 App Server 收敛为「单步模型桥」：只返回正文或 DesignEcho 工具调用 JSON，实际工具执行仍由现有 preflight / policy / Photoshop 事务链负责。
- 0.149.0 的真实协议包含 `modelProvider/capabilities/read.imageGeneration`、`imageGeneration` ThreadItem、`usageLimitExceeded` 与 `savedPath/result`；官方说明内置生图使用 `gpt-image-2`，计入 Codex 通用用量。普通模型桥仍禁用全部内建工具，生图由第二个单用途 Runtime 独立承接。
- 实机根因已验证：只启用 `image_generation` 只会暴露 `$imagegen` 技能说明，模型会发出 code-mode `exec`，但缺少 code-mode host 时不会产生图片。生图 Runtime 必须同时启用并捆绑同版本 `codex-code-mode-host`；其余内建能力继续禁用，宿主请求仍拒绝。

### 实施边界

**必须**

1. 新增独立 provider `openai-codex`，与 OpenAI API Key 通道明确分离；订阅凭据不得进入 renderer、`apiKeys` 或项目文件。
2. 主进程启动随应用捆绑的 Codex App Server，使用应用私有 `CODEX_HOME` 和空白只读 cwd；完成初始化、登录、退出、账号状态、配额、动态 5.6 模型目录、取消与进程清理。
3. provider 每次调用使用 ephemeral thread + structured output，只返回一轮 `ProviderResponse`；不得注册 Photoshop MCP、不得执行 Codex 内建工具、不得形成第二套 Agent 循环。
4. 设置页提供「ChatGPT 订阅（Codex）」登录卡和动态 5.6 模型选择，并明确说明它与 OpenAI API 独立计费/独立认证。
5. 打包时解包平台原生 Codex 可执行文件；完成类型检查、构建、静态审计和协议级验证。
6. 订阅生图使用独立 ephemeral thread、隔离工作目录和独立 App Server 进程；只允许 `$imagegen` 的 code-mode 编排与一个 `imageGeneration` 完成项。普通模型桥的 `image_generation` / `code_mode_host` 禁用不变。Agent 的 `generateImage` 通过显式设置选择订阅 `gpt-image-2` 或既有 BFL FLUX，不静默跨渠道回退。

**不做**

- 不抓取浏览器 Cookie，不复制 ChatGPT OAuth token，不读取或回传 App Server 的认证文件。
- 不复用现有无鉴权的 Photoshop MCP 调试端点，不让 App Server 绕过 DesignEcho 工具执行契约。
- 不硬编码宣称账号一定拥有某个模型；界面只展示当前 `model/list` 实际返回且非隐藏的 GPT-5.6 模型。
- 不依赖全局 `codex`、全局 `~/.codex` 配置、第三方插件或 MCP。订阅生图只使用随锁定 Runtime 一起提供的官方 `$imagegen` 系统技能与 code-mode host。

### 下一步

用户在已启动的应用中进入「设置 → AI 模型 → ChatGPT 订阅模型（Beta）」完成登录；能力探针通过后，把「Agent 生图渠道」切换为「ChatGPT/Codex 订阅（gpt-image-2）」并保存。随后让 Agent 调用一次 `generateImage`，确认聊天里能看到真实图片，再决定是否置入 Photoshop；普通对话与 Photoshop 工具仍走原 DesignEcho Agent 循环。

### 验证与未知

- 已验证：官方协议、锁定运行时、GPT-5.6 模型目录协议、ephemeral thread + structured output 单步桥、独立只读 Runtime、登录发起/取消、取消竞态、工具 schema 二次校验、主/渲染类型检查、UXP 生产构建、安装目录原生运行时 `0.149.0`、打包应用启动与进程响应。
- 已验证（订阅生图）：真实账户能力探针返回 `available=true / model=gpt-image-2 / usageKind=codex_subscription`；真实生成返回 1254×1254 PNG、约 1.03 MB、`model=gpt-image-2`、`provider=codex-subscription`。该次透明背景请求实际返回 false，运行时按真实结果上报，未虚报透明。`npm run pack` 成功，`release/win-unpacked/resources/app.asar.unpacked/.../bin/` 同时包含 `codex.exe` 与 `codex-code-mode-host.exe`，二者 Authenticode 均为 `Valid`、签名主体 OpenAI OpCo, LLC。
- 已验证（最终打包产物）：`app.asar` 新于当前订阅功能源码，顶层仅含 `dist`、`node_modules`、`package.json`、`public`；登录错误脱敏、官方域名/标准端口校验、`config/read` 安全审计和内置工具禁用均已进入包内。打包后的干净隔离配置可启动 0.149.0 并返回未登录状态；人为启用 MCP 的隔离配置被拒绝。物理 `codex.exe` 的 Authenticode 状态为 `Valid`，签名主体为 OpenAI OpCo, LLC。
- 正式核心验证未全绿，但阻断项来自当前脏工作树中的既有内容：一个未跟踪设计知识文档触发疑似乱码；另外 SKU 生产接线、Runtime budget 断言和品类词基线审计仍有失败。它们不应被伪装成本功能通过，也没有证据表明由本次订阅 provider 引入。
- 仍未知：打包应用 UI 中的生图渠道保存与 Agent `generateImage` 整链、真实 `usageLimitExceeded` 配额事件、登录跨重启保持、Photoshop 置入后的视觉观察与人工采用闭环。未取得的结果不外推、不补造。

### 状态

`subscription_model_bridge_done / dedicated_image_lane_done / real_gpt_image_2_generation_validated / packaged_image_lane_binaries_validated / ui_agent_chain_pending`

## 2026-08-17 DESIGN-PATH-CONSTITUTION-001：创意路径退出 Stage 门禁（设计路径宪法第一刀）

### 用户原始需求

「让 Agent 和设计师一样会设计而不是呆呆傻傻的机器人」；「从能做到能做好」；「你回顾过历史我们一直在治理但是没有解决问题」——要求给出有主见的专业决定并执行。

### 决定（已落地，详见 Status.md 同日条目与 CLAUDE.md「设计路径宪法」）

- 病根不是「还差哪个门禁没修好」，而是造门禁的机器还在运转：v5 Stage 机（R1/R3/R4 三张表 → E1 才许写）被接成了所有设计任务的写入门禁，连 general-design 也是 8 阶段；每修一堵墙都对，完成率仍 4%。
- 第一刀：创意路径（general / main-image / detail-page / single-canvas-visual / reference-replication）以 manifest 字段 `execution_model: 'agentic'` 退出 Stage 机——不建 Runtime Session、声明不作写入门票、工具面 broad discovery、方法知识第一轮全部可见；SKU 批量 / 色卡 / 模板保持 staged。
- 配套减法：观察预算拦截 → 一次性提醒；proven-applied 写入不再逼模型多花一轮读回、不锁同批写入；表单驳回可执行化 + 上撞墙账本 + 恢复 allowlist 不收成只剩控制工具；预算抬到设计师量级；棘轮钉住 agent.ts 行数 / 控制工具数 / 拦截返回点数只减不增 + 5 份创意清单必须 agentic。

### 禁止做

- 不得把创意清单改回 staged；不得新增前置拦截而不回答「拦做错还是说错 / 出口可达 / 真机档案编号」三问；不得再往 agent.ts 长分支（棘轮会拦）。

### 后续刀（同日，已落地）

- 第十刀 = 技术方案 P0（`docs/design-craft-harness-technical-plan.md` §4）：原则按七步工作法重排为 14 条并进棘轮（`design_principle_lines`）；`generic` 知识条目改写为七步工作法正文 + 七步自检；`getDesignKnowledge` 描述注明 generic 用途。P1 起点：② 文案功能词 vs 产品观察硬项、③ 选图留白方向评分、⑦ Harness 收尾自看 + 评分卡开机、配方表可加载数据、四宫格图片格。

- 第十一刀（08-18）= 记忆与上下文第一批：运行事实账本（Harness 记事实、模型记判断）+ 状态摘要素材行 + 续跑摘要「上次做到」+ 去重复读。真机验收：`debug:runs` 看项目记忆写入率（基线 5%）；同一对话第二句「把标题改大点」是否还重新看图。剩余 P3：轮内语义摘要压缩、店铺级记忆（等账本有数据后做「成稿→标准档案」）。

- 第十二刀（08-18）= 主体框变素材属性：alpha → 纯色底裁边 → 本地分割 → 整框，逐级本地求解带置信度；`getSubjectBounds` / `fitLayerSubjectToRegion` 默认不再用 PS 选择主体（显式 smart 才用）；写后读回按相对框投影。真机验收：fit 结果 `subjectDetection.method` 分布（asset:trim / alpha / layer:matting / frame），frame 占比越低越好；主体缩放不再因 PS 弹窗 / 超时失败。第二批：视觉粗框 + SAM 精修、主体框入素材记忆。

- 第十三刀（08-18）= SKU 缺模板时「把色卡当模板」修法：handoff 契约写清模板定义（独立新文档 / 只放版式与占位 / 不置入颜色图 / 色卡只读不同名 / 先找项目与 Eagle 合适模板再新建）+ sku-batch 预算 16→32 + UXP switchDocument 同分不再静默选旧文档。真机验收：重跑「帮我做SKU」，色卡文档零写入、出现 2/3/4 双装独立文档、不在 14 轮被砍。

- 第十四刀（08-18）= 推演第二批：缺模板时先弹组合确认卡（双数可改）再设计模板；handoff「合适」判据分两半；版式起点数字（三份共用刻度）。真机验收：「帮我做SKU」第一步应看到确认卡；确认后模板设计三份风格一致、占位数正确；色卡零写入。

- 第十五 / 十六刀（08-18）= 来源只读（Skill 声明 `protectSourceDocument`）+ owner 先行（写入门禁 + 阶段提示）+ 账本不误导 + 提示体量测量（`debug:runs --trace` 看「提示体量」表）。真机验收：SKU 运行开工 ≤3 轮就到 owner；色卡写入被拦（错误里见「只读来源文档」/「先调用 SKU 工作流」）；档案里 promptShapeSamples 有数据。

### 待验证（真机）

- 重启应用后用同一组提示复测：「帮我做 详情页」「帮我完成SKU编排」「你帮我看看这个淘宝链接的设计 <url>」；`npm run debug:runs` 同口径看「完成且有写入率」（基线 08-14~17：41 次 0 次自然完成）、门禁拒绝占失败比（基线约三分之二）、首次写入延迟。
- 已知遗留：agentic 路径无自动 Reflexion 返工（原依赖 Session 账本）；staged 路径 `createTextLayer::runtime_task_run_revision_reobserve_required` 待单独查；`audit:category-terms` 因仓库压成单一根提交而失败（与本刀无关）。

## 2026-08-16 GATE-SIMPLIFY-009：cut 意图审议闸门（治理切片 9，最后一刀）

### 用户原始需求

审计 cut 唯一候选：`agent-intent-deliberation-gate.ts` 的意图审议闸门——`diagnosticOnly` 四字段（不改变路由/不跑 Provider/不跑 Photoshop/纯诊断）不拦任何路由或执行，无任何事故记录、也防不了任何事故；留痕可下沉运行日志，不构成收益闸门。审计判据：cut。

### 必须做

1. 定位该文件的全部生产消费者与审计依赖；确认四字段确实无执行语义后删除（或留墓碑导出防误导入）。
2. 若存在调用点，改为直接跳过该闸门（行为零变化：它本就不拦）；若仅剩日志价值，把留痕下沉到运行记录或直接退役。
3. 审计断言迁移：如 business-boundaries/simplification 棘轮引用该文件标识符，按经批准契约迁移并记录理由。
4. 验证：build:typecheck:renderer、audit:tools、audit:agent-business-boundaries、audit:simplification-ratchet、maintenance:validate 22/22、生产构建。
5. 全部 9+1 项落地后做总验收：收敛指标对照机制（完成且有写入率 / 误判"我不会"次数 / 首次写入延迟）就位、等待真机数据回填，并回写最终治理总结。

### 禁止做

- 不动数据安全类门禁与审计 keep 清单；不动共享脏工作树提交/清理。

### 验收证据

- 已核实：`buildAgentIntentDeliberationGate` 唯一生产消费者是 engine 的诊断记录构建点；诊断脚本（diagnose-runs）只读旧档案的 modelConsulted 字段且 `|| {}` 容错；无 gates 手册/审计文本依赖（report-change-boundaries 的路径正则只匹配 diff）。
- 已退役：删除 `agent-intent-deliberation-gate.ts` 文件、移除 engine 构建点与 import（决策来源主口径继续由 decision.source 承担）；`agent-diagnostic-record.ts` 字段保留并标 @deprecated（兼容读取旧档案）。
- 已落地（总验收·收敛指标机制）：①完成且有写入率（已有，切片 3）；②首次写入延迟——run record toolCalls 增 `elapsedMs` 时序（账本未启动不写、旧档案缺失不臆造），diagnose-runs 输出中位/P90 与时序覆盖率；③误判"我不会"次数——启发式候选圈定（零写入+无阻塞+自然停机+能力信号），逐条人工确认。convergenceBaseline 增两项 null 槽位待真机回填。
- 验证：build:typecheck:renderer、audit:runtime-declaration 全过；audit:tools / business-boundaries / capability-resolver / simplification-ratchet 全部通过；maintenance:validate 22/22；diagnose-runs --convergence 真机数据试跑正常（首次写入延迟覆盖率 0/21 如实上报、疑似能力误判 0 候选）。

### 状态

`deliberation_gate_consumers_confirmed / file_deleted_engine_wiring_removed / record_field_deprecated_for_legacy / convergence_indicators_mechanized(elapsedMs_timing+capability_denial_heuristic+baseline_slots) / typecheck_and_behavior_suite_passed / maintenance_validate_22of22 / DONE`

---

## 2026-08-16 GATE-SIMPLIFY-008：工具决策契约 A-2 补结构化授权升级出口（治理切片 8）

### 用户原始需求

审计 simplify 候选 #8：工具执行预检的 A-2 授权门（执行授权不足时拦截）没有升级出口——模型被拦后收到「当前条件还不够完整」就原地转圈不干活（gates-definitions 4.3 记录）。审计建议：被拦时给结构化升级出口（请求授权/切换文档/明确指路），不是砍拦截。

### 必须做

1. 定位 agent-tool-decision-contract.ts 中授权不足类的 blocker（A-2 / executionAuthorization 相关），确认当前返回形状。
2. 在 blocker 结果中补结构化升级指引：明确列出「如何解锁」的可执行选项（如：用户显式授权/切换到正确文档/按允许面选择替代动作），模型据此一步到位，不再空转。
3. 行为测试：授权不足拦截返回含升级指引（具体可选动作清单）；已授权路径不受影响。
4. 验证：build:typecheck:renderer、audit:tools、audit:agent-business-boundaries、audit:runtime-declaration、maintenance:validate 22/22、生产构建。

### 禁止做

- 不砍拦截本身（授权门拦的是"确定没授权"）；不自动授予写权限（升级出口只指路，不代授权）；不动数据安全类门禁。

### 验收证据

- `AgentToolDecisionBlocker` 新增结构化 `unlockOptions` 字段；A-2 授权拦截的 message 改为三条解锁路径（只读先行 / createInteractiveCard 请求确认 / 用户明确授权后重新发起），解锁选项同时进入 blocker 对象与重规划指令（buildToolDecisionReplanDirective 追加 "Ways to unlock..." 行）。
- 修复去重路径丢字段 bug：序列化去重只保身份三要素，unlockOptions 从原对象回补。
- 行为测试：candidate_only 下写工具 → blocked + execution_authorization_required + unlockOptions ≥3（含确认卡路径）；confirmed_tool_required 同调用 → ready 不受影响。
- 验证：build:typecheck:renderer、audit:runtime-declaration 全过；audit:tools、audit:agent-business-boundaries 0 违规、audit:capability-resolver 0 违规、简化棘轮 21/21 持平、maintenance:validate 22/22、生产构建全部通过。

### 状态

`unlock_options_added_to_blocker / dedupe_field_preservation_fixed / replan_directive_carries_unlock / behavior_tests_added / full_core_validation_22_of_22_passed / production_build_passed / slice8_complete_next_slice9_cut_intent_deliberation`

---

## 2026-08-16 GATE-SIMPLIFY-007：裸确认配 resume token（治理切片 7）

### 用户原始需求

审计 simplify 候选 #7：预算熔断后用户最自然的「继续」命中轻量意图判定（ack/continuation）→ confirmed 降为 candidate_only，续跑失去写权限——真机 #228/#229「继续」零写入。建议：有结构化续跑身份（resume token：同会话上一轮 TaskRun/续跑记录）时，裸确认不降级，恢复受控续跑路径。

### 必须做

1. 定位 engine 的 detectLightweightIntent / 裸确认降级点与既有续跑身份机制（agent-resume-execution-gate / continuation-operation handlers / RunRecord），确认为何「有续跑身份的裸继续」没有走恢复路径。
2. 实现：当同会话存在结构化可恢复身份（最近一轮运行记录 + 明确续跑点）时，裸「继续」不再降级 candidate_only，而是签发 resume token 进入受控续跑（写权限恢复仍走既有 resume gate 的 revision/授权校验，不裸放行）。
3. 行为测试：有续跑身份的裸继续 → 续跑路径（写权限恢复受 gate 校验）；无续跑身份的裸继续 → 维持降级只读（不恢复写权限，安全边界不变）。
4. 验证：build:typecheck:renderer、audit:tools、audit:agent-business-boundaries、audit:runtime-declaration、maintenance:validate 22/22、生产构建。

### 禁止做

- 不放宽 resume gate 的 revision/授权校验；无身份裸继续仍不得恢复写权限；不动数据安全类门禁。
- 不动共享脏工作树提交/清理。

### 验收证据

- 新共享纯函数 `agent-bare-continuation-resume.ts`：裸确认 × 写授权 × 可续接档案的三元裁决（demote / 保留 + resume 信号）；engine 降级点改走该裁决，并用 `resolveBareContinuationResumableRecord`（listAgentRunRecords 桥 + buildRunRecordResumeBrief 同会话分支匹配）查询可续接身份；查询失败/桥缺失一律降级（安全侧）。
- 安全边界：只有「同会话分支 + 未完成 + 未过期」档案存在时保留写权限；新会话/已完成/跨分支/无档案维持旧降级；所有执行点约束（读后写/预检/runner）不变。
- 行为测试 4 项：有档案→保留写权限+信号；无档案→降级；非确认形态→不裁决；已降级授权→不重复裁决。
- 验证：build:typecheck:renderer、audit:runtime-declaration 全过；audit:tools / business-boundaries / capability-resolver 与 maintenance:validate 见本轮结果。

### 状态

`pure_decision_module_added / engine_demotion_wired_to_resume_identity / record_query_fail_closed / behavior_tests_added / full_core_validation_22_of_22_passed / production_build_passed / slice7_complete_next_slice8_authorization_upgrade_exit`

---

## 2026-08-16 GATE-SIMPLIFY-006：能力可见性 deny/ceiling 仅 manifest 绑定场景生效 + 按能力面收敛（治理切片 6）

### 用户原始需求

审计 simplify 候选 #6：能力可见性五层（baseline/on-demand/deny/ceiling/manifest-required + 40 行截断）造成三次同型隐身事故（07-26 全只读基线、07-31 openProjectFile 隐身死锁、08-16 淘宝链接"我无法抓取网页"）。止血已做（web 进基线 + 家族摘要不截断）；本切片做治本两件：①deny/ceiling 只在 manifest 绑定场景生效（无 manifest 的自主运行不再叠加 manifest 语义的 deny 层）；②按需目录明细从"扁平 40 行截断"改为**按能力家族分组截断**（每个家族至少可见代表项，全局总量封顶）。

### 必须做

1. 读 resolver/session 现状，确认无 manifest 运行时 deny/ceiling 的实际叠加点，把 manifest 语义层（manifest-required deny、work-mode ceiling）严格限定在 manifest 绑定场景。
2. 按需目录明细改按家族分组：每个家族前 N 条明细可见（家族摘要已保证全家族可见，明细层也保证每家族有代表），全局行数封顶不变。
3. 行为测试：无 manifest 运行的可见面断言（业务 workflow bridge 仍走 handoff 逻辑、不被 manifest deny 误伤；通用工具完整可见）；按家族分组截断断言（每个家族至少 1 行明细）。
4. 验证：build:typecheck:renderer、audit:tools、audit:agent-business-boundaries、audit:capability-resolver、maintenance:validate 22/22、生产构建。

### 禁止做

- 不动 baseline 白名单内容与 web 止血成果；不动 deny-wins 的最终执行点（写权限仍由 preflight）；不动数据安全类门禁。
- 不让业务 workflow bridge 在无 manifest 时变成可直接执行（handoff 契约保留）。

### 验收证据

- 核实（部分 1 已天然满足）：ceiling 由 `resolveSkillRuntimeCapabilityCeiling(manifest, workMode)` 派生，无 manifest 时为空；resolver 的 manifestOwnedDenied / manifestRetiredControl 均已 manifest 门控；无 manifest 运行时唯一的 manifest 语义 deny（manifestRequiredCapabilityIds → skill.* 所有权 deny）被 business-boundaries 10592-10607 钉死为「无 manifest 时业务 skill bridge 必须 deny」的有意契约，按本卡「禁止做」保留不动——因此 deny/ceiling 仅 manifest 场景生效在代码里已成立，本轮只做核实与记录。
- 已修复（部分 2）：按需目录明细从扁平 40 行截断改为**按能力家族分组截断**（每家族前 3 行代表项，全局 40 行封顶不变，"还有 N 项能力明细未展开"如实上报）；家族总览（上轮止血）保持全量不截断。
- 行为测试：全量 164 工具 session 断言——每个家族名都在目录中可见、靠后家族（context.state 浏览器工具）与写家族（photoshop.write）都有明细代表项、全局封顶提示仍在。
- 验证：build:typecheck:renderer、audit:runtime-declaration 全过；audit:tools / business-boundaries / capability-resolver 与 maintenance:validate 见本轮结果。

### 状态

`deny_ceiling_verified_manifest_only / ownership_deny_kept_per_pinned_contract / per_family_catalog_truncation_implemented / behavior_test_added / full_core_validation_22_of_22_passed / production_build_passed / slice6_complete_next_slice7_resume_token`

---

## 2026-08-16 GATE-SIMPLIFY-005：route-boundary 回复文案正则降级为事后 warnings（治理切片 5）

### 用户原始需求

审计 simplify 候选 #5：`agent-route-boundary-policy.ts` 的「确定路由否决/非执行保护」用正则匹配**模型回复文案**（isUnsafeDirectResponseDrift / isExecutionClarificationQuestionDrift 等大段正则）强制执行——这是拦「说错」，按 AGENTS.md 分流判据应降级为事后 warnings；与完成契约推回/执行供给预留执行点层重叠（AGENTS.md 已列 13 处为棘轮化兼容债）。

### 必须做

1. 定位 route-boundary 中"读回复文案并强制改行为"的判定函数与全部消费者（engine/executor/agent），把其执行语义改为**事后告警**：不再用正则命中替换模型回复、不再强制重执行、不改变工具选择。
2. 保留：告警记录（可进运行诊断/完成警告，不进用户可见工程话术）；「长输入短路径保护」「对话路由边界」两个 keep 判定不动（它们拦的是确定路由抢跑，不是回复文案）。
3. 简化棘轮：该文件在意图正则棘轮（137）与业务词棘轮（13 处兼容债）范围内——删除的用点可下调基线？不——基线只许减，本轮先保持计数不涨；若删除后计数下降，按脚本提示更新基线到新值并记录。
4. 验证：build:typecheck:renderer、audit:tools、audit:agent-business-boundaries、audit:simplification-ratchet、maintenance:validate 22/22、生产构建。

### 禁止做

- 不删「长输入短路径保护」（07-07 文案被当指令的事故防线）与「对话路由边界」；不动数据安全类门禁；不动共享脏工作树提交/清理。

### 验收证据

- 核实：`evaluateDeterministicNonExecutionProtection` 及其全部回复文案正则助手（isUnsafeDirectResponseDrift / isExecutionClarificationDirectResponseDrift / isExecutionClarificationQuestionDrift / isGenericClarificationDrift / isBusinessDefaultDecisionClarificationDrift / isSelfResolvableBusinessClarification / isSkuSourceSelectionClarification / hasDomainSpecificClarification / isExplicitUserDecisionDirectResponse / normalizeText）在**生产代码零消费者**——执行强制早已随 v3 路由改造退役。
- 已退役：全部回复文案正则与输入接口删除（-190 行）；导出函数留墓碑（恒 not_applicable + 退役说明），保留结构化 keep 函数（shouldEnterConversationalRoute / isSimpleDeterministicShortPathSkill / evaluateSimpleDeterministicRouteBoundary / evaluateDeterministicRouteVeto）不动。
- 验证：build:typecheck:renderer、audit:tools、audit:agent-business-boundaries 0 违规、简化棘轮 137/137 持平；maintenance:validate 与生产构建见本轮结果。

### 状态

`reply_text_regexes_confirmed_dead / enforcement_retired_with_tombstone / structured_keep_functions_untouched / typecheck_and_audits_passed / full_core_validation_22_of_22_passed / production_build_passed / slice5_complete_next_slice6_capability_visibility`

---

## 2026-08-16 GATE-SIMPLIFY-004：视觉候选/分析/终局 Judge 三档合并为单一运行级视觉池（治理切片 4）

### 用户原始需求

审计 simplify 候选 #4：视觉候选（maxVisionCandidates）、视觉分析（maxVisualAnalyses）、终局 Judge（MAX_FINAL_QUALITY_JUDGE_CALLS）三档并行预算 + maxInitialVisionCandidates 子窗，档位过多且互锁曾致死锁（逃生舱已修）。合并为单一运行级视觉池。

### 必须做

1. **池化设计（只放宽不收紧）**：执行层从"每类各自上限"改为单一运行级视觉池——池消耗 = visionCandidateCount + visualAnalysisCount + finalQualityJudgeCallCount 之和；池上限 = 候选硬上限 + 配置的分析上限（未配置分析上限时按 0 计，分析维持旧的不受限语义）；总量与原两档之和相等，跨类可互通。
2. 保留：每类计数器与子 Agent 用量合并行（audit 文本断言 4294/4295/6083 依赖）、配置字段与 profile 值（6/3、1/1 等审计断言不动）、终局 Judge 一次性硬上限、ReviewSet 感知候选上限（min 组合进池剩余量）、`agent_vision_candidate_budget_exhausted` / `agent_visual_analysis_budget_exhausted` 错误码与消息形状。
3. 行为测试：池互通断言——(候选6, 分析2) 配置下连续 8 次视觉分析调用放行、第 9 次拒绝（旧契约第 3 次即拒绝）；(0,0) 零视觉 fixture 语义不变。
4. 验证：build:typecheck:renderer、audit:tools、audit:agent-business-boundaries、audit:capability-resolver、audit:runtime-declaration、maintenance:validate 22/22、生产构建。

### 禁止做

- 不改配置字段名/Profile 预算值（审计断言与 manifest 契约保持）；不动 deliver 门与逃生舱；不动数据安全类门禁。
- 不收紧任何现有总额度（池上限 = 原两档之和）。

### 验收证据

- 池化落地：`readRunLevelVisionBudgetConsumed()` = 候选+分析+Judge 之和；`getRunLevelVisionBudgetLimit()` = 候选硬上限 + 配置分析上限（总量与原两档之和相等，只放宽不收紧）；`getPerformanceVisionCandidateLimit()` = min(ReviewSet 感知上限, 池剩余)；`hasPerformanceVisualAnalysisCapacity` 改读池；Judge 类候选额度与终审画面计划（remainingVisionCandidates）均加池剩余约束。
- 保留不动：每类计数器与子 Agent 合并行（audit 文本 4294/4295/6083 依赖）、配置字段与 profile 值、Judge 一次性硬上限、ReviewSet 契约、两个错误码与消息形状。
- 行为测试：池互通（6+2=8，连续 8 次视觉分析放行、第 9 次拒绝——旧契约第 3 次即拒）；池耗尽后候选额度归零；(0,0) 零视觉 fixture 语义不变。
- 验证：build:typecheck:renderer、audit:runtime-declaration 全过；audit:tools / business-boundaries / capability-resolver / simplification-ratchet 与 maintenance:validate 见本轮结果。

### 状态

`pool_design_fixed_sum_of_kind_limits / current_task_recorded / pool_enforcement_implemented / behavior_tests_added / full_core_validation_22_of_22_passed / production_build_passed / slice4_complete_next_slice5_route_boundary_warnings`

---

## 2026-08-16 GATE-SIMPLIFY-003：终局质量 Judge 预留取消事前扣减（治理切片 3）

### 用户原始需求

审计 simplify 候选 #3：`shouldReserveFinalQualityJudgeBudget` 在普通任务预算里事前扣 1 次模型调用、90 秒（AGENT_FINALIZATION_TIME_RESERVE_MS）和 1 个视觉候选/视觉分析，为"可能发生的终局 Judge"预留供给——审计结论：无任何事故记录支撑的预防性税，且曾饿死身份声明（agent.ts 原注释自证）。

### 必须做

1. 删除三处事前扣减：`readPerformanceBudgetExhaustion` 的模型/软时间扣减、`getPerformanceVisionCandidateLimit` 的候选收窄分支、`hasPerformanceVisualAnalysisCapacity` 的 -1 分支；`PerformanceToolConsumeContext.reservesFinalQualityJudge` 字段与全部透传删除。
2. 删除已无消费者的 `shouldReserveFinalQualityJudgeBudget` 与 `resolveFinalQualityJudgeAssertions`（其断言计算在 Judge 实际调用路径 11781/12558/12933 独立存在）。
3. **硬上限保留**：`MAX_FINAL_QUALITY_JUDGE_CALLS=1` 与 `beginPerformanceModelCall` 按 budgetClass 的拒绝逻辑不变。
4. 行为测试：普通任务预算在 modelCallCount=budget-1 时不得再判耗尽；同一运行第二次 final_quality_judge 调用必须被拒（agent_final_quality_judge_budget_exhausted）。
5. 验证：build:typecheck:renderer、audit:tools、audit:agent-business-boundaries、audit:simplification-ratchet（agent.ts 循环分支计数不得上涨）、maintenance:validate 22/22、生产构建。

### 禁止做

- 不动 Judge 的一次性硬上限与终局评价语义；不动视觉观察/读后写等数据安全门禁；不动共享脏工作树提交/清理。

### 验收证据

- 三处事前扣减删除：readPerformanceBudgetExhaustion（模型 -1 / 软时间 -90s）、hasPerformanceVisualAnalysisCapacity（视觉分析 -1）、PerformanceToolConsumeContext.reservesFinalQualityJudge 字段与透传；shouldReserveFinalQualityJudgeBudget / resolveFinalQualityJudgeAssertions 两个死方法删除。
- ReviewSet 感知的候选上限**保留并解耦**：getPerformanceVisionCandidateLimit 不再依赖预留开关，同版本完整 ReviewSet 始终装得进视觉候选预算（终审契约不变，business-boundaries 文本断言 continue 通过）；无 ReviewSet 时返回硬上限。
- 硬上限保留：MAX_FINAL_QUALITY_JUDGE_CALLS=1 与 beginPerformanceModelCall 按 budgetClass 的拒绝逻辑不变；行为测试证明第二次 final_quality_judge 调用被拒（agent_final_quality_judge_budget_exhausted），且普通任务预算在 modelCallCount=budget-1 时不再判耗尽。
- 验证：build:typecheck:renderer、audit:agent-business-boundaries 0 违规、audit:runtime-declaration 全过、简化棘轮 agent.ts 循环分支 21/21 持平；maintenance:validate 与生产构建见本轮结果。

### 状态

`reservation_tax_removed_three_consumers / dead_methods_removed / review_set_aware_candidate_limit_kept_decoupled / hard_cap_kept / behavior_test_added / capability_audit_contract_migrated_with_approval_basis / full_core_validation_22_of_22_passed / production_build_passed / slice3_complete_next_slice4_vision_budget_merge`

---

## 2026-08-16 GATE-SIMPLIFY-002：完成契约推回触发口径收紧（治理切片 2）

### 用户原始需求

审计 simplify 候选 #2：run#242（2026-08-16 13:05「帮我看看这个淘宝链接的设计」）纯分析/评审请求被误判 write_photoshop，零写入后被完成契约推回 plan_execution_mismatch。根因定位：`agent-intent-control-plane.ts` 的「参考链接 + 设计/复刻意图」分支（REFERENCE_LINK_PATTERN × DESIGN_OR_REPLICATION_INTENT_PATTERN）在只读检查分支之前命中，任何带链接和"设计"二字的请求都签发写入授权。

### 必须做

1. READ_ONLY_INSPECT_PATTERNS 新增「链接/网页评审」模式（句尾锚定 + 尾部 URL 容差）：只认纯评审问句（看看这个链接的设计/怎么样），不吞「看看链接…然后照着做」复合委托。
2. 参考链接分支加排除条件 `!isReadOnlyInspectRequest(normalized)`，纯评审不命中写入授权；复合委托仍走 autonomous_execution。
3. 行为测试：纯链接评审 → read_only_inspect 且 toolScope≠write_photoshop；无 URL 变体同样只读；复合委托 → autonomous_execution；循环级回归——零写入链接评审运行不被推回（stopReason≠plan_execution_mismatch）。
4. 验证：build:typecheck:renderer、audit:tools、audit:agent-business-boundaries、audit:simplification-ratchet（意图正则棘轮不得上涨）、maintenance:validate 22/22、生产构建。

### 禁止做

- 不加品类词正则（不涨业务词债务棘轮）；不动数据安全类门禁；不动共享脏工作树提交/清理。
- 不把「链接评审」放宽到所有含"设计"的句子——只覆盖链接/网页对象 + 评价词 + 句尾锚定。

### 验收证据

- 纯链接评审「帮我看看这个淘宝链接的设计」→ `read_only_inspect`（toolScope=read_only，不签 write_photoshop）；无 URL 变体「帮我看看这个链接的设计怎么样」同样只读。
- 复合委托「帮我看看这个淘宝链接的设计，然后照着做一张主图」→ `autonomous_execution`（创作授权保留，句尾锚定不误吞）。
- 循环级回归：零写入链接评审运行不再被推回（stopReason≠plan_execution_mismatch，error≠completion_contract_unsatisfied_zero_progress）。
- build:typecheck:renderer、audit:tools（164）、audit:agent-business-boundaries 0 违规、audit:simplification-ratchet 意图正则 137/137 持平、maintenance:validate 22/22、生产构建全部通过。

### 状态

`root_cause_located_in_reference_link_branch / link_review_patterns_added_end_anchored / exclusion_wired / behavior_tests_added_and_passing / full_core_validation_22_of_22_passed / production_build_passed / slice2_complete_next_slice3_judge_reservation`

---

## 2026-08-16 GATE-SIMPLIFY-001：执行供给预留与交付前观察上限合并（治理切片 1）

### 用户原始需求

用户批准按门禁收益审计账本执行治理（"梳理清楚了就可以治理了"）。第一刀 = simplify 候选 #1/#2：执行供给预留（performance-ledger，预算尾部只放行 ≤2 次写前观察、其余转执行指令）与交付前观察上限（agent.ts PRE_DELIVERY_OBSERVATION_ROUND_LIMIT，首个交付动作前只允许 ≤2 轮观察）是**两套计数拦同一件事**，审计证据：治理后观察占比降到 43% 但完成且有写入率反而从 9.2% 降到 4.6%——拦观察没换来写入，模型被拒观察后转向停话/提问而非动手。

### 必须做

1. 把「写前观察限量」收为**单一 owner**（保留预算账本 owner：performance-ledger），删除/退役重复的轮级计数（PRE_DELIVERY_OBSERVATION_ROUND_LIMIT 路径），行为契约不变部分（写后读回与 unknown 现场确认始终放行、只读任务不饿死）必须保持。
2. allowance 按审计建议放宽（≤2 → 更高值或按预算比例），并保持「超出转执行指令」的诚实提示（agent_observation_budget_reserved）——方向不变，松绑程度变。
3. 行为测试同步：`scripts/audit-runtime-declaration-resolver.cjs` 中切片 2 的账本/循环断言按新契约迁移（**这是经批准的治理行为变更，不是改断言制造假绿**；迁移理由写入本卡与 Status）。
4. 验证：build:typecheck:renderer、audit:tools、audit:agent-business-boundaries、maintenance:validate 22 项全绿；生产构建后待真机收敛对照。

### 禁止做

- 不删写后读回放行、不删只读任务保护（测试必须继续证明只读分析不被饿死）。
- 不动读后写纪律、文档写保护、确认卡、熔断簇（审计 keep 清单）。
- 不批量改其他 simplify 项；不动共享脏工作树提交/清理。

### 验收证据

- 单一 owner：写前观察限量全部收进 `performance-ledger.ts` 账本；`agent.ts` 的 `preDeliveryObservationRoundCount`/`PRE_DELIVERY_OBSERVATION_ROUND_LIMIT`/`isPreDeliveryObservationKind`/`updatePreDeliveryObservationRoundGuard` 已删除（-68 行），交付工具收窄（selectPreDeliveryObligationProgressToolNames）保留并由账本指令触发。
- 放宽：预留区 allowance 2→4；新增总次数上限 6 次调用（取代 2 轮）——真实读后写准备序列（文档身份+层级/边界+快照）不再被中途打断。
- 行为契约迁移（经批准）：audit-runtime-declaration-resolver 纯账本断言（allowance 4 + 总上限 6）、循环场景 A（6 次观察全放行零指令）、场景 B（第 7 次转指令且无交付工具时诚实停机）、收窄测试（6 读 → 指令 → 下一轮只见 createRectangle）全部按合并契约重写并通过；护栏反面（只读/聊天/计划不饿死）保持原样通过。
- 验证：build:typecheck:renderer、audit:tools（164）、audit:agent-business-boundaries 0 违规、maintenance:validate 22/22、生产构建全部通过。

### 状态

`goal_armed / slice1立项 / dual_observation_limits_merged_into_ledger / allowance_relaxed_2_to_4 / total_pre_delivery_limit_6_in_ledger / directive_triggers_delivery_tool_narrowing / behavior_tests_migrated_to_merged_contract / full_core_validation_22_of_22_passed / production_build_passed / slice1_complete_next_slice2_trigger_scope`

---

## 2026-08-16 WEB-CAPABILITY-VISIBILITY-001：联网/读网页工具第一轮不可见（淘宝链接真机案例）

### 用户原始需求

用户贴淘宝链接让 Agent 分析设计，Agent 却答复「我不具备实时抓取网页内容的能力，之前也确认过这一点」——但系统里已有 webSearch（DeepSeek 原生）、fetchWebPageDesignContent（无头抓取）、浏览器扩展工具（readBrowserPage/captureBrowserTab，带登录态）三条路。

### 已核实根因

`HARNESS_BASELINE_CAPABILITY_IDS`（无 manifest 运行的第一轮可见能力基线）只含 designFoundation / eagle.read.searchReferences 等，**不含任何联网/读页能力**；这些工具只在按需目录里，而按需目录被截断到 40 行（164 个工具轮不到）。模型的第一轮可见世界里确实没有任何「看网页」工具，所以它「不具备抓取能力」的表述是对其真实能力面的诚实描述——运行证据佐证：浏览器工具 459 次真实运行 0 次被调用。

### 已修复

1. `tool-capability-bridge.ts` LEGACY_TOOL_CAPABILITY_MAP 新增 `web.searchInternet → [webSearch]` 与 `web.readPageContent → [fetchWebPageDesignContent, listBrowserTabs, readBrowserPage, captureBrowserTab]`。
2. `capability-resolver.ts` HARNESS_BASELINE_CAPABILITY_IDS 追加这两个 id（与文件内「脑：设计原理与参考」定位一致），并写明真机案例注释。
3. 验证：build:typecheck:renderer、audit:capability-resolver、audit:tools 通过；maintenance:validate 与生产构建见本轮结果。

### 禁止做

- 不把全部 164 工具塞进基线（首轮 schema 体积有预算）；只补「参考检索」这一条被真机证明缺失的链路。
- 不动读后写纪律、SKU 生产链、共享脏工作树。

### 状态

`live_case_root_cause_confirmed_capability_invisibility / web_search_and_read_page_added_to_first_turn_baseline / typecheck_and_audits_passed / full_validation_and_production_build_running`

---

## 2026-08-16 TOOL-UNDERSTANDING-USAGE-AUDIT-001：全量 164 工具「理解→使用」审计与指引补强

### 用户原始需求

用户要求检查全部工具，判断 Agent 能否从「理解工具」到「很好使用工具」。已用 15 个子代理完成全量审计（14 个静态批次 + 1 个真实运行证据分析），并修复高危缺口。

### 已核实发现（审计结论）

1. **分发严重缺陷（1 个，已修）**：`inspectDetailPageLivePlacements` 在 UXP 有完整实现类（471 行）但未注册进 ToolRegistry 且 Agent 侧无分发——模型可见不可执行。已在 `DesignEcho-UXP/src/tools/registry.ts` 注册。
2. **E 系统性缺口（已修）**：写类工具 schema 描述拼了「能力边界/副作用/不适用」但从不拼「执行后复核」——`withPhotoshopToolSkillDescription` 现已把 `verifyWith` 追加进每个工具描述（一次性覆盖全部写类/导出类）。
3. **B/C 专属指引缺口（已修）**：约 35 个高频/破坏性写类工具只有通用兜底、无工具专属边界与「不要」条目——已为 createDocument/moveLayer/reorderLayer/duplicateLayer/renameLayer/setTextContent/setTextStyle/createRectangle/createEllipse/quickExport/smartSave/deleteLayer/setLayerOpacity/setBlendMode/groupLayers/createGroup/addDropShadow/addStroke/lockLayer/setLayerVisibility/batchExport/createClippingMask/releaseClippingMask/replaceLayerContent/transformLayer/quickScale/renderLayout/clearLayerEffects/delegateToAgent/runDesignTeamPipeline 补边界；为 closeDocument/deleteLayer/cropDocument/resizeImage/resizeCanvas/gaussianBlurLayer/deleteLayerMask/replaceLayerContent/replaceSmartObjectContents/setLayerVisibility/createDocument/batchExport/delegateToAgent/runDesignTeamPipeline/createClippingMask/releaseClippingMask/applyMorphedImage 补「不要」反例。
4. **A 参数描述系统性缺失（部分已修，其余记债）**：RAW_TOOL_CATALOG 大量参数无 description。已为高频工具补齐：getDocumentSnapshot/getAcceptanceSnapshot/getCanvasSnapshot/getLayerHierarchy/getLayerBounds/getLayerProperties/getTextContent/getTextStyle/resolveFontName/moveLayer/reorderLayer/createTextLayer/placeImage/replaceLayerContent/getElementMapping/analyzeLayout/listProjectResources/searchProjectResources/openProjectFile/describeImage/analyzeAssetContent。其余低调用量工具的参数描述债务记录在 Status，不追求一轮清完。
5. **真实运行证据（459 条档案）**：declareDesignBrief 失败 186/381（49%，input_ref_not_resolved_for_key 反复拒）是最大单一失败源；sku-batch 57 次多为「未绑定写入目标文档」；观察调用占业务动作 43%；164 个工具中 78 个（47.6%）真实运行 0 次出现；完成且有写入 4.6%（较基线 9.2% 回退）。这些是契约/预算/运行行为问题，不属工具描述层，记为后续切片候选。

### 禁止做

- 不为审计结果新增一次性 smoke；不修改断言；不动 SKU 生产链与读后写纪律。
- 不把「工具描述补强」写成模型一定会选对——真实运行证据继续是唯一验收。
- 不清理、暂存、提交共享脏工作树。

### 状态

`full_tool_audit_15_agents_completed / dispatch_gap_inspect_detail_page_registered / verify_hint_wired_into_schema_descriptions / boundary_and_donotuse_entries_added / high_frequency_param_descriptions_added / typecheck_and_audits_passed / full_core_validation_22_of_22_passed / live_guidance_effect_pending`

---

## 2026-08-16 BROWSER-EXT-VISUAL-REF-001：浏览器助手增强——页面图片进视觉通道 + 长页拼接截图

### 用户原始需求

用户想把淘宝商品链接（重 JS 渲染 + 登录态）作为设计参考给 Agent「看」。现状：`readBrowserPage` 只返回文字/链接/元素，拿不到图片像素；`captureBrowserTab` 只能截当前可见屏，长详情页要反复滚动截图。要求优化现有「DesignEcho 浏览器助手」扩展，让 Agent 能真实看到参考页图片。

### 必须做

1. `browser.readPage` 增加 `includeImages`（默认 false）+ `maxImages`（默认 8，上限 12）+ `maxImageEdge`（默认 1024，上限 2048）：页面脚本收集可见、去重、≥100px 的候选 img；service worker 用扩展 host_permissions 带 credentials 逐张下载、解码、缩边、JPEG 归一，返回 `images: [{ src, alt, width, height, base64, format }]`——该形状命中 `collectImagesFromToolResult` 视觉通道（`images` 是 DIRECT_IMAGE_CONTAINER_KEYS），图片真正进模型视觉理解，受既有视觉预算上限约束。单张失败（防盗链/CORS/超时）只记 warnings，不整体失败。
2. `browser.capture` 增加 `fullPage`（默认 false）+ `maxSlices`（默认 3，上限 4）：按真实 scrollY 切片滚动截图、OffscreenCanvas 拼接、完成后滚回原位；高度封顶（9600px）并返回 `truncatedFullPage`，避免超长页撑爆上下文。
3. Agent 侧：`tool-schemas.ts` 两个工具的 schema 与描述同步（参数经 `browserBridge:call` 原样透传，无需新增方法/分发）；`tool-executor.service.ts` 工具信息表同步；`docs/browser-extension-bridge.md` 协议表同步；扩展 manifest 升 1.1.0 + README 增补。
4. 验证：扩展 JS 语法检查、`build:typecheck:renderer`、`audit:tools`、`audit:agent-business-boundaries`、`git diff --check`、`maintenance:validate` 22/22。

### 禁止做

- 不新增第 6 个桥方法 / 新工具名（复用 readPage / capture 参数扩展，注册面最小）。
- 不动连接层、心跳、token、安全边界；不改 fill 不提交红线。
- 不把图片像素写成"已核实设计事实"；参考图只作视觉上下文，防照抄边界不变。
- 不清理、暂存、提交或覆盖共享脏工作树。

### 归属层级

能力地图：Agent 基础设施 → 浏览器桥（外部参考视觉观察）；运行线 v3 工具参数增强，无新 Runtime / Registry。

### 当前计划

1. 扩展端 `page-scripts.js`：readPageScript 收集候选图片元数据 + `scrollToScript`。
2. 扩展端 `handlers.js`：readPage 图片像素下载/缩放/编码；capture fullPage 切片拼接。
3. Agent 端 schema + 工具信息 + 协议文档 + README + manifest 版本。
4. 验证与记忆回写。

### 验收证据

- 扩展 `readPageScript` 收集候选图片元数据，`handlers.js` 在 service worker 用 host_permissions + credentials 下载、解码、缩边（≤1024）并编码回传 `images[{src,alt,width,height,base64,format}]`——该形状命中净化器 `DIRECT_IMAGE_CONTAINER_KEYS`，图片可进模型视觉通道（代码级核实）。
- 扩展 `capture` 支持 `fullPage`：按真实 scrollY 逐屏截图、OffscreenCanvas 拼接、切片/总高封顶、finally 滚回原位；位图及时 close。
- 扩展 5 个 JS 文件语法检查通过；`build:typecheck:renderer`、`audit:tools`（164 工具）、`audit:agent-business-boundaries`（0 违规）、`git diff --check`、`maintenance:validate` 22/22（含 UXP production build）全部通过。
- 真实浏览器端到端（真机装扩展 1.1.0 后 readBrowserPage(includeImages) / captureBrowserTab(fullPage)）待用户验证。

### 状态

`extension_and_bridge_chain_audited / visual_channel_shape_confirmed / current_task_recorded / read_page_include_images_implemented / capture_full_page_stitch_implemented / extension_js_syntax_checked / agent_schemas_and_docs_synced / tool_selection_guidance_hardened / full_core_validation_22_of_22_passed / live_browser_e2e_pending`

---

## 2026-08-16 WEB-SEARCH-AGENT-TOOL-001：给设计 Agent 增加联网搜索能力（DeepSeek 原生 web_search）

### 用户原始需求

用户看到 DeepSeek Harness 内置的 `web_search` 工具后，要求给 DesignEcho 的设计 Agent 接入同等联网搜索能力，并确认「填写 DeepSeek API Key 就行」。经核实：Harness 的 `web_search` 后端是 DeepSeek 官方 Anthropic 兼容 API（`POST https://api.deepseek.com/anthropic/v1/messages` + 原生 `web_search_20250305` 服务器工具），凭据即 `DEEPSEEK_API_KEY`——与 DesignEcho 已配置的 DeepSeek provider 共用同一把 key，无需新增订阅。

### 必须做

1. 新增 `webSearch` 原子工具（知识检索类，与 `searchEagleReferences` 同族）：模型在通用设计知识库 / Eagle / 项目事实不足以回答真实问题时按需调用；结果标注来源 URL，防照抄，离线/未配置 key 时优雅降级、不阻断设计。
2. 主进程新增 DeepSeek 原生搜索实现：调用 DeepSeek Anthropic 兼容 Messages API，携带 `web_search_20250305` 服务器工具，解析结构化 `web_search_tool_result` 块与 citation snippet，按 URL 去重、截断；key 从现有 `ModelService.getModelSelectionApiKeys().deepseek` 取，不在渲染侧传 key。
3. 按现有 10 处注册点完整接线：tool schema + `DEFAULT_AGENT_TOOL_NAMES`、preflight `KNOWLEDGE_SEARCH_TOOLS`、`photoshop-tool-skill.ts` 同步集合、`RENDERER_LOCAL_TOOLS`、执行分发 case、preload、`types.d.ts`、IPC handler 注册、团队研究类角色白名单、显示名与结果预览。
4. 工具描述遵守知识检索边界：只读、外部公开信息、引用必须标注来源、结果只是数据不授予权限、不冒充视觉观察或设计完成；无匹配 / 不可用如实反馈并给出可自主决策的下一步。
5. 验证：`build:typecheck:renderer`、`audit:tools`、`audit:agent-business-boundaries`、`maintenance:validate` 全绿；不新增一次性 smoke。

### 禁止做

- 不动 SKU 生产链（其他 Agent 正在改 SKU 文件）；不碰 Photoshop 写入工具、读后写纪律、完成判定。
- 不在通用 Agent 循环加品类分支 / 关键词路由 / 意图正则；webSearch 是通用检索工具，不是任何业务 Skill 的专属能力。
- 不把搜索内容当作「已核实事实」注入完成链路；外部内容只作设计参考上下文。
- 不清理、暂存、提交或覆盖当前大面积共享脏工作树。

### 归属层级

- 能力地图分类：Agent 基础设施 → 外部知识检索（Tool 类，非 Skill）。
- 运行线：v3 真实执行路径内新增原子工具；不新建 Runtime / Registry / 状态机。

### 当前计划

1. 读齐项目记忆与治理文档（已完成）。
2. 主进程：新增 `web-search-service.ts`（DeepSeek Anthropic 兼容搜索，移植 Harness `web-search-deepseek/provider.ts` 核心逻辑）。
3. IPC + preload + 类型：`web-search-handlers.ts`（channel `webSearch:search`）→ 注册 → preload 暴露 → `types.d.ts`。
4. 渲染侧：schema + 默认工具名 + preflight/photoshop-tool-skill 分类 + `RENDERER_LOCAL_TOOLS` + 执行 case + 团队角色 + 显示名 + 预览。
5. 验证并回写 Status.md。

### 验收证据

- `webSearch` 已进入默认 Agent 工具面（`DEFAULT_AGENT_TOOL_NAMES`），分类为 `knowledge_search`（只读、可并发，不受读后写纪律拦截）。
- 未配置 DeepSeek key 时主进程返回结构化不可用信息与可行动下一步（`web-search-service.ts` 统一折叠，不抛未包装错误）。
- 类型检查、工具注册审计（164 工具全一致）、业务边界审计（0 违规）与完整核心验证（22/22）全部通过。
- 真实 DeepSeek 联网搜索（真机）待验证：应用重启加载新构建后，由用户在配置了 DeepSeek API Key 的环境里实测一次。

### 状态

`memory_files_read / integration_points_mapped / deepseek_native_search_backend_confirmed / implementation_complete / external_content_trust_marked / tool_audit_and_business_boundaries_passed / full_core_validation_22_of_22_passed / live_deepseek_search_pending`

---

## 2026-08-16 SKU-LAYOUT-DOCUMENT-SCOPE-001：已验收模板的确定性排版与暂存清理

### 用户目标

用户要求修复真实 SKU 批次：组合确认阶段正常，但 2 / 3 / 4 双共 15 个组合与 3 个自选备注在 Photoshop 排版后全部被 QA 拒绝，SKU 输出目录没有图片，并残留空的 `.designecho-staging` 目录。用户已人工确认模板占位符的位置、大小与间距正确；生产态必须准确消费这些坐标，不能让模型自动改模板来掩盖执行错误。

### 已核实根因与本轮边界

1. 首轮根因是 SKU UXP 写入曾依赖 `app.activeDocument / activeLayers[0]`；改为精确目标后，15:21 真机复跑又暴露第二层宿主适配问题：`transform` 不接受额外的 `(layer, document)` 复合 `_target`，返回错误描述符或静默不写，而调用点未检查结果。两张复制卡因此仍保持初始尺寸，最终 QA 正确判定偏框、越界和重叠。修复后的首选路径使用 Photoshop UXP 正式 `Layer.scale()`，只在该 API 不可用或失败时回退到 exact select 后的无 `_target` transform。
2. 无显式占位容器时，纯数字层名会被直接当成占位符；真实自选备注模板中的顶层设计容器组 `3` 因此与 `形状参考` 一起被识别为两个区域，且该组越出 800×800 画布。预检只看“有槽”，没有提前拒绝非法区域几何。
3. 自选备注采用规格级 staging 事务，但 finally 只清理 `sku-note-*` 子目录，空的 `.designecho-staging` 父目录会留在正式 SKU 目录。
4. 15:03 的真实复跑暴露了模板识别回归：为排除全画布数字设计组 `3`，检查器曾跳过全部顶层纯数字图层，连已验收 `4双装.tif` 中隐藏的数字 `solidColor` 区域 `2 / 1` 也一起丢弃。该模板真实是两个合法区域承载 4 色，既有几何算法应确定性得到 `[3,1]`，不需要模型修模板。
5. 同一真机复跑的 Photoshop 弹窗“命令‘获取’当前不可用”来自失败清理：delete 成功后又对已删除的 layerId 执行 `_obj:'get'`。`dontDisplay` 无法抑制不存在对象的宿主错误；删除回执与目标文档 DOM 已足以识别成功和 no-op，不应制造一次预期失败命令。
6. 本轮只修确定性生产链：文档级 transform、占位识别、几何预检、真实读回 QA、无弹窗清理与空目录生命周期。已批准模板的坐标保持不变；不放宽 QA、不让模型直接修改坐标、不把 SKU 逻辑写进通用 Agent。
7. 完整的“模板校准态 / 已批准生产态 + TemplateLayoutManifest + 安全候选视觉排序”仍是后续架构切片；不能用它替代当前明确的执行器 P0 修复。
8. 旧版 `executeOne / executeBatch` 没有当前生产链要求的模板预检、实时几何 QA 和事务导出，已从 Agent schema 与 UXP capabilities 移除，并在 UXP 直接调用时失败关闭；唯一生产入口继续由 SKU Skill 通过 `action=execute` 所有。

### 状态

`root_cause_confirmed / numeric_solid_color_legacy_regions_restored / live_template_preflight_passed / official_layer_scale_primary_path_wired / transform_compound_target_incompatibility_fixed / transform_descriptor_and_live_geometry_readback_fail_closed / missing_layer_get_popup_removed / cleanup_descriptor_plus_target_document_dom_fail_closed / unsafe_legacy_execute_actions_fail_closed / agent_combo_and_note_batches_stop_on_cleanup_failure / sku_staging_parent_cleanup_capability_scoped / uxp_and_agent_production_builds_passed / business_audit_passed / full_core_validation_22_of_22_passed / latest_agent_restarted / latest_uxp_plugin_reloaded_and_bridge_ready / live_photoshop_18_output_rerun_pending`

---

## 2026-08-14 MAIN-IMAGE-COMMERCIAL-QUALITY-001：整套任务恢复主图 Manifest 所有权并阻断占位半成品

### 用户目标

用户给出的真实 Agent 稿仍停留在“原图 + 默认文字 + 空灰块”的线框层，与淘宝搜索页成熟主图在商品主体、点击理由、信息层级、配色和完成度上差距明显。要求定位并修复生产链，而不是补“高级感”提示词或把袜子/淘宝规则塞进通用 Agent。

### 已核实根因

1. 整套主图 + 详情页 + SKU 请求进入 `ecommerce-socks-design` 后，父 workflow 为主图默认铸造 `product-disposable-live` 与多个 `approved=true`，随后直接调用 legacy `main-image-design` executor；这绕过了主图声明的 `controlledRouteEntry=autonomous-react-loop`、Manifest 的 R1/R2/R3/R4/R5、项目素材视觉观察、方法知识与写后质量复核。
2. `renderLayout` 在主视觉没有真实素材路径时会创建灰色占位矩形，但此前不产生 quality finding，因而“白底 + 灰块”可返回 `qualityState=passed/completed`。
3. 主图 Profile 要求 legacy-only `main_image_qa_report`，canonical autonomous 路径无法生产；同时缺少已有的 brief coverage 与 asset integration 断言。Artifact Runtime 又只自动注入 overview，点击结构、卖点证据和 review 分面未进入主图阶段上下文。
4. 用户截图中的首次整套任务在桌面端重启时中断；后续“继续”无可恢复 RunRecord，退化为 generic autonomous text edit。这是普通运行 durable resume 的独立 Harness 债务，不能用聊天历史猜任务或放宽“继续”权限来掩盖。
5. `renderLayout` 还在代码里固定白底、黑字、浅蓝卖点块和固定字号比例；模型即使形成了设计策略，进入 R4 后也会被这一套隐式视觉预设压平。旧默认样式没有 provenance，也能参与正式完成判定。
6. 设计记忆虽已接线，但项目身份曾可能退化成脱敏路径；自动查询又混入跨品类固定词并让 source rank 压过当前任务相关性。操作推断记忆还可能在未复核时被描述为已人工复核，导致模型拿到的不是可信、相关的项目经验。

### 本轮实施边界

- 父 workflow 只做结构化调度与子报告汇总；凡子 Skill 声明 `autonomous-react-loop`，统一用 `runtimeSelectedSkillHandoff + declaredSkillId/taskType/workMode` 进入 `autonomous-agent`，不直调 legacy executor。
- 主图、详情页、SKU 的知识、阶段、能力与验收继续归各自 Manifest/Skill；不向通用 Agent 增加袜子、淘宝、主图工具表或品类正则。
- 父级只有在所有子报告明确 `canClaimOutputQuality=true` 时才成功；`partial/needs_review/completed-without-quality-owner` 都不能被父级升级。
- 主视觉无真实素材时仍可生成可逆草稿，但必须返回 `main_image_placeholder_unresolved`，只能通过新的真实素材布局重算闭合，不能交付。
- 主图 Profile 补 `req.brief-coverage` 与 `craft.asset-integration`；legacy QA 报告改为兼容提示，canonical 完成继续由 fresh structure、fresh visual 和 Profile assertions 所有。
- 主图 Artifact Runtime 注入完整方法分面；内容仍是知识上下文，不授权 Tool、不替代模型设计判断。
- `renderLayout` 的正式视觉样式改由模型显式声明：颜色、字体层级、字距/行距和卖点载体来自当前 R3 方向。未声明样式只能生成灰阶 `neutral_wireframe`，并留下不可完成的质量发现；Harness 只验证字段、可计算对比度和几何，不选择审美答案。
- 正式 `model_authored` 构图必须显式给出区块几何、对齐、间距、真实图片落位、背景色与文字拟合策略；Harness 不再补白底、居中、固定比例、默认字号或默认裁切。文字内容在 Agent 与 UXP 两端保持空白 /换行保真并返回 fit receipt；质量 finding 按文档、阶段和屏幕区域独立追踪，不能由另一屏的视觉通过串台关闭。
- R3 可在开放创意不确定时提出 2–3 个方向并显式选择、记录理由；方向明确或规格化任务无需强制探索，系统也不会默认选择第一项。该声明不授权 Tool、不算进度、不冒充质量通过。
- 当前项目事实、已审核记忆和真实参考在 Context Compiler 中优先于通用方法；R3 只能引用实际进入本轮上下文的 item。项目记忆优先绑定稳定 projectId，缺失时只使用不可逆路径指纹；操作推断与来源待审记录不得自动进入模型。
- 主图 Manifest 暴露知识、项目记忆、可选参考与通用 Photoshop 设计原子能力；这些能力仍由 Manifest/Capability owner 提供，没有把主图或 SKU 方法写进通用 Agent。
- 尚未完成真实 CandidateSet → 非破坏性视觉预览 → 同 rubric 候选比较闭环；本轮方向探索是模型思考与证据记录，不等同于已完成视觉 A/B。真实商业质量仍需 Photoshop 成品复跑确认。

### 状态

`parent_manifest_owned_child_dispatch_wired / legacy_main_image_authority_defaults_removed / parent_quality_claim_requires_explicit_child_owner / main_image_placeholder_repair_finding_wired / model_owned_visual_style_and_neutral_wireframe_gate_wired / optional_r3_direction_exploration_wired / stable_reviewed_relevant_memory_context_wired / main_image_profile_and_full_knowledge_context_updated / business_behavior_audit_passed / renderer_typecheck_passed / full_core_validation_22_of_22_passed / production_agent_build_passed / real_candidate_preview_comparison_pending / live_photoshop_commercial_quality_pending`

---

## 2026-08-14 SKILL-GOVERNANCE-001：主图成功语义 + 详情页视觉死锁出口（SKU 由其他 Agent 修改，本切片不碰任何 SKU 文件）

### 用户目标

按审计结论修复两个技能的结构性病灶：①主图 strategy-only 恒 success:true 零写入（"方案=成功"）；②详情页视觉复核运行时不可用时完成链死锁（恒 needs_review 永不导出、且向模型承诺运行时做不到的"逐屏查看"路径）。SKU 明确不碰（其他 Agent 在改）。

### 已核实根因与实施边界

- 主图（main-image.executor.ts:1272-1322）：strategy-only 两条 return 均 success:true，消息称"只是规划，没有改动 Photoshop"——零写入报成功。修复：改为 `success:false + nonFatal:true`，消息补"也不算完成"与"继续用当前画布工具实际制作"的下一步。不引入结构化 handoff 字段（它本来就不是移交协议），循环层切片 1 闸门会据此推回真实执行。
- 详情页（detail-page.executor.ts）：`visualBundleComplete` 不区分"运行时做不到"与"没看"；`awaiting_visual_review` 续跑摘要承诺"等待 Agent 逐屏查看真实像素"而视觉不可用时该路径不可达。修复：检测 `isRuntimeVisualReviewBlocked(readAgentVisualObservation(snapshotResult))`，命中时 ①completionWarnings 追加诚实出口（人工查看后明确指示保存/导出）；②续跑摘要与 reason 改为诚实文案（不再承诺不可达路径）。deliver 门本身不动（视觉纪律是 P0 安全门，开闸需要单独切片 + 审计同步）。

### 禁止做

- 不碰任何 SKU 文件（sku-batch.executor.ts / sku-*.ts / sku manifest 等，其他 Agent 并行修改中）。
- 不放松 deliver 门 / requiresVisualPass（视觉纪律红线）。
- 不新增一次性 smoke；不抬债务基线。

### 状态

`main_image_strategy_success_semantics_fixed / detail_page_visual_deadlock_honest_exit_wired / agent_result_nonFatal_field_added / sku_files_untouched / full_22_check_passed / rebuild_restart_done_bridge_ready / live_photoshop_e2e_pending`

---

## 2026-08-14 HARNESS-COMPLETION-OWNERSHIP-001 真机迭代 1：文档写保护的兜底恢复

### 用户目标

治理代码已装载后第一次真实运行（run #439，15:35）暴露：写保护边界拦下技能后，模型不切目标、反复观察同一受保护文档直至判停。要求按真机证据修复。

### 已核实根因与实施边界

- 真机事实（run-20260814073437254-42236955.json）：`sku-batch` 被 `current_document_write_protected` 拦下（详情页.psb 受保护），模型随后 2 次只读观察后停；`plan_execution_mismatch`、mutation 0/1、观察 8/8；stageState E1/awaiting_outcomes。
- 代码根因：`resolveRequiredToolRecovery` 只认结果里的结构化 `nextRequiredToolOptions`；技能包装层丢弃该字段后恢复 allowlist 为空 → 模型自由重复观察受保护文档（07-31 死锁变体）。
- 修复：`resolveRequiredToolRecovery` 增加兜底——失败 `code=current_document_write_protected` 且无结构化指路时，合成解锁 allowlist `[switchDocument, openProjectFile, createDocument]`（与执行点门禁 unlockOptions 同一口径），普通失败不触发。新增行为测试（正例 + 反例）。

### 状态

`live_run_439_root_cause_confirmed / protection_recovery_fallback_code_applied / behavior_test_added / validation_running / rebuild_and_restart_pending`

---

## 2026-08-14 HARNESS-COMPLETION-OWNERSHIP-001：把「完成」从模型收回 Harness（治理 + 分片重构）

### 用户目标

用户判断：项目从「提出需求 → 完成任务」只完成了前者（理解需求本质是模型的能力），Harness 没有拥有完成权；项目已膨胀为代码屎山。要求治理，必要时重构，使「完成且有真实写入/交付」成为常态化、可验证的收敛指标。

### 已核实根因与证据（2026-08 共 217 次真实运行，数据源 agent-run-record/v0，`debug:runs --all --since 2026-08`）

1. 92/217（42%）以 `final_response` 结束——模型停话即结束，**完成是模型决定的**；Harness 只有收尾后注解权（52% 运行带 blockers 注解）。
2. 144/217（66%）运行零写入；37 次 `status=completed` 但 `successfulMutationCalls=0`；**完成且真有写入仅 20/217（9%）**。
3. 62/217（29%）预算/空转耗尽；大量运行死在读取工具：末工具 `getDocumentInfo`=36、`getCanvasSnapshot`=17、`getAnnotatedSnapshot`=14、`getLayerHierarchy`=12。
4. 高频阻塞文本：「我先看了一下现状，但还没开始动手改」28 次、「这次还没真正开始动手」16 次、「最后一步没做成」14 次。
5. 代码根因（`agent-runtime/agent.ts`）：`resolveUnfinishedExecutionObligation` 只在 manifest 绑定的 `runtimeSession.stageState` 存在时才生效；**默认自主路径无 Session 时，模型停话 → `final_response` 直接收尾**，`task-completion-contract.ts`（141KB）只在收尾时注解 blockers，不参与退出判定。预算不分观察/执行/验证，没有任何机制保证「至少一次写入 + 同目标读回 + 评价」的供给。

### 必须做

1. 完成所有权前移：默认路径模型停话时，Harness 依据 `executionRequirement` 判定（零写入/无同目标读回/无评价）→ 有界推回（最多 N 次，带具体缺口）；推回失败以 `needs_review`/checkpoint 诚实停止，不允许 `final_response` 吞掉未完成。
2. 预算分区：观察 / 执行 / 验证分开记账，执行+验证供给在执行前原子预留（Prompt.md 第 6 条已规定，落地到默认路径）。
3. 收敛指标：completed-且-真有写入率、零写入率、首次写入前迭代数、预算耗尽率，接入 `debug:runs` 汇总输出并作为治理基线。
4. 分片重构：`agent.ts`（13457 行）按职责拆分；按 Prompt.md 规则退役 shadow 重复链（no-redo shadow、reconciliation 等），不新增第三 Runtime。

### 禁止做

- 不一次性重写 v3、不新建第三套 Runtime/DAG。
- 不向通用循环新增品类分支、关键词门禁或意图正则。
- 不清理、暂存、提交或覆盖当前大面积共享脏工作树（agent.ts / ChatPanel.tsx / engine.ts 等 303 项既有改动必须原样保留）。
- 不新增 smoke、不修改断言、不抬高债务基线制造假绿。

### 当前计划

1. 证据级诊断（已完成，见上）。
2. 用户批准治理方案与切片顺序（已批准：全方案，从切片 1 开始）。
3. 按切片实施：完成所有权前移（**切片 1 完成**）→ 预算分区（**切片 2 完成**）→ 收敛指标（**切片 3 完成**）→ agent.ts 拆分（**切片 4 批次 1 完成**：预算账本抽取为 `performance-ledger.ts`）→ 真机闭环制度化（**切片 5：真机验证清单已写入本卡，待用户执行**）。

### 切片 5 真机验证清单（用户执行，未执行不写完成）

重新加载应用（含最新 Renderer/UXP 构建）后依次验证，每条结果记入本卡：

1. **零写入推回**：发设计指令（如「帮我做SKU」）。预期：Agent 不再「看了一眼就停」——要么被推回真正动手，要么明确说「这轮还没有真正动手完成设计」并给出下一步（`plan_execution_mismatch`），不再出现零写入 `final_response`。
2. **预留区观察转执行**：同一任务若长时间观察，预期出现「这一轮还没做出可以看的结果，剩下的处理空间只保留给真正动手」的提示，且不再扩展观察/检索。
3. **写后读回开闸**：完成一次真实写入后，观察/复核读取应恢复正常（不被预留区拦截）。
4. **收敛指标对照**：治理后运行积累后执行 `node scripts/diagnose-runs.cjs --all --since <月份> --convergence`——输出「完成且有写入」率与观察占比，并与 `project-state.json` 的 `convergenceBaseline`（2026-08：9.2% / 79.8%）自动对照 Δ；完成且有写入率上升、观察占比下降为收敛方向。

### 验收证据

- 8 月 217 次真实运行基线已取得（上方数据）。
- 切片 1 代码：`agent.ts` 零业务动作停话分支新增完成契约闸门（有界推回 ≤2 次 + 推回耗尽诚实停止 `plan_execution_mismatch`），护栏为「写入已授权（write_photoshop 意图或结构化交付义务）且契约明确缺失执行」；仅拦截确定没做到，不拦措辞。
- 切片 2 代码：执行供给预留——已授权写入且尚无交付动作尝试时，工具预算尾部（上限 6、预算 20% 取小）只放行 ≤2 次写入前观察，其余观察/检索转为执行指令（`agent_observation_budget_reserved`）；已有交付动作尝试后不再设闸（写后读回与 unknown 现场确认始终放行）。授权口径提取为单一 owner `hasAuthorizedMutationExpectation()`。
- 切片 3 代码：`debug:runs` 汇总新增「完成且有写入」率与「真实写入 / 观察调用 / 业务动作」计数。当前基线：完成且有写入 20/217（9%）；真实写入 143 次 vs 观察调用 1484 次（占业务动作 80%）。
- 切片 4 批次 1 代码：预算账本（11 个状态字段 + 耗尽/预留/复核/活跃时长纯函数）抽取为 `agent-runtime/performance-ledger.ts`（新模块约 310 行），`agent.ts` 保留薄包装（13587 → 13473 行）；行为零变化。静态审计文本断言随标识符改名同步迁移（business-boundaries 4 处、capability-resolver 1 处、runtime-declaration-resolver 行为测试 1 处、tool-registry 负向正则 1 处），断言语义不变、失败条件不变，已记入 D-083。
- 切片 4 批次 2 代码：最终摘要纯逻辑（`buildSummaryFromStatefulWrites` / `readOutputPathFromToolResult` / `buildToolResultFallbackMessage` / `shouldRequestRicherFinalSummary`，107 行）抽取为 `agent-runtime/final-summary.ts`；`agent.ts` 13473 → 13418 行，薄包装注入运行态事实；行为零变化，无审计匹配串受影响（提前扫描确认零匹配）。
- **治理路径行为测试（切片 1/2 的可复用正式测试）**：`audit-runtime-declaration-resolver.cjs`（maintenance:validate 既有行为套件）新增 3 项——①切片 2 纯账本断言（预留边界 / 写入前观察 allowance=2 / 超限转执行指令 / 交付动作尝试后开闸 / 硬预算兜底）；②切片 1 真实循环断言（零业务动作停话被推回、最终 `plan_execution_mismatch` + `completion_contract_unsatisfied_zero_progress`，绝不吞成 final_response）；③切片 2 真实循环断言（maxToolCalls=15 时恰好 14 次观察执行、第 15 次起转为执行指令且不真正执行）。全部通过。
- **治理护栏反面行为测试（防 07-31 门禁事故复发）**：同套件新增——聊天请求（chat_only）不推回、以 final_response 正常成功；只读检查请求（read_only_inspect）执行其读取且不推回；只读分析在同预算形状下 14 次观察全部放行、零执行指令（永不饿死）；计划类请求（plan_only）不推回、final_response 正常结束。全部通过。
- **收敛对照工具（切片 5 制度化）**：`debug:runs --convergence` 输出「完成且有写入」率与观察占比，自动对照 `project-state.json` 的 `convergenceBaseline`（2026-08 治理前：9.2% / 79.8%）并打印 Δ 与收敛判据；只报告不判定失败。运行档案当前 436 条，治理后尚无新构建运行数据（最近记录仍为旧代码时段 13:31 前）。
- 每一切片：`build:typecheck:renderer`、`audit:executor-generic`、`audit:agent-business-boundaries`、`audit:simplification-ratchet`（21/21 持平）、`maintenance:validate`（22/22）、`git diff --check` 全部通过。

### 状态

`plan_approved_full / slice1_code_complete / slice2_execution_supply_reserve_code_complete / slice3_convergence_metrics_code_complete / slice4_ledger_extraction_code_complete / slice4_final_summary_extraction_code_complete / audit_matchers_synced_to_ledger / governance_behavior_tests_added_and_passing / negative_guard_behavior_tests_added_and_passing / convergence_comparison_tool_shipped / full_22_check_maintenance_validation_running / slice5_live_probe_checklist_recorded / live_photoshop_e2e_pending`

---

## 2026-08-14 SKU-INTERACTIVE-REVISION-BINDING-001：修复组合确认后的错误版本冲突

### 用户目标

SKU 组合卡已经确认并保存，但确认后不能因为 Harness 绑定了旧 Photoshop 文档版本而中止；同时必须继续阻止用户等待期间真实发生的文档或 history revision 变化被旧确认卡重放。

### 已核实根因与实施边界

- 真实运行 `run-20260814043634539-2d09aafb` 在暂停边界观察到 `documentId=457 / historyStateId=495`，而 TaskRun 恢复绑定错误沿用开工文档 `documentId=1465 / historyStateId=1510`，所以确认后必然触发 revision mismatch。
- 根修位置是交互暂停边界：以卡片生成前最后一次真实 `getDocumentInfo` 观察绑定恢复 revision；只有完全没有 `scopeObservation` 的历史旧卡，才允许在同文档条件下兼容旧 TaskRun revision。
- 等待期间若实际 documentId 或 historyStateId 改变，恢复仍必须 fail-closed；不删除版本守卫，不重放旧写入，不在 SKU executor 中加绕过。
- 当前协议只要已记录暂停观察但无法取得自洽 revision（含 `unknown` / `absent` / history 缺失），恢复就明确拒绝，不把“无法证明”折成旧 revision 或可写状态。

### 验收证据

- 暂停边界从旧文档切到新文档时，TaskRun、pending interaction 和 continuation binding 统一绑定新文档/revision。
- 同一暂停 revision 的确认可继续；等待期间真实 revision 漂移仍返回 `interactive_continuation_photoshop_revision_mismatch`。
- 本次实机旧账本仍为 `claimed`；相同提交指纹会幂等承接，resolver 会把旧 `1465@1510` 绑定归一到可信暂停版本 `457@495`，无需修改或删除历史账本。
- `build:typecheck:renderer`、`audit:agent-business-boundaries`、`git diff --check` 与 `maintenance:preflight:core`（22/22）均通过；不新增一次性 Smoke。

### 状态

`implementation_complete / real_run_root_cause_verified / pause_revision_is_authoritative / persisted_stale_binding_backward_normalized / missing_pause_or_live_revision_fail_closed / core_validation_22_passed / live_photoshop_confirmation_e2e_pending`

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
