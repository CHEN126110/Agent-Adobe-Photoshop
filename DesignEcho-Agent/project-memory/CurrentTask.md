# Current Task

## 2026-08-31 S1-DELIVERY-REVIEW-ROOT-CAUSE-001：技术可靠交付首个根因纵切

### 目标

1. 启动 S1“技术可靠交付基线”，先关闭 `INTAKE-083` 的 `finalArtifactRefs` 丢失，再处理 `INTAKE-084` 的 Evaluation / Review 协议稳定性；不在已知 blocker 未闭合时继续购买形式上的正式样本。
2. 让真实 Photoshop 写入、同目标读回、可编辑源稿、栅格导出、Agent 交付声明、Artifact Repository 与 Debug Attempt 收据形成同一 TaskRun / revision 的可验证链路。
3. 建立第一条可重复的隔离实机 Case 路径：技术失败能够落到唯一 owner 和首个偏差，成功必须由结构化收据证明，不能由文件存在、助手措辞或评测器猜测。
4. 为 S1 的 5 Case × 2 次正式队列清除基础设施 blocker；本纵切通过后才启动完整样本采集。

### 当前事实

- S0 文档真相源治理已提交为 `d44ca46c`；当前项目路线、Owner 边界和 SMART 出口已经收口。
- r38 的首个偏差已经定位：DeepSeek 普通视觉调用曾被强制转为文本；非 Codex Final Judge 又没有 serializer-owned 出站图片收据，导致评分虽返回，`finalArtifactObserved` 仍为 false，后续同 revision PSD/JPG 无法取得 E2 引用信用。
- 当前代码已让 OpenAI-compatible 非流式 Final Judge 保留真实图片、在完整 Provider 终态后签发逐图字节回执，并把回执绑定贯穿到全画布终审、同 revision PSD/JPG `resultRefs` 与 Debug 相对路径；残缺终态、拒绝、缺 response id、图片/候选不一致均不签发。
- Evaluation 协议已 fail closed：非法批次不补默认分数；advisory `evaluateDesign` 不再取得 TaskCompletion 信用；协议失败不写任务卡、不触发重复设计问题，也不进入学习候选；明确 Evaluation 故障不会再被改写成“缺少画面检查”唤醒主 Agent。
- 当前改动已通过相称专项测试和一次完整 65 阶段 `maintenance:validate`，含 Agent 类型检查、UXP 测试与 production build。
- r35 / r38 性能账本显示模型耗时约占墙钟 92% / 93%，普通 Agent 模型回合 35 / 29 次；Photoshop 快照与 transform 本身只占数秒。当前直接瓶颈更像高轮次和少数长输出，巨大 history / reasoning / Tool Schema 是待归因的结构负担，不能直接靠删上下文或降 reasoning 处理。
- INTAKE-090 的 observation-only 归因代码已经接入现有 Runtime Accounting：每个生产模型请求显式记录 call kind、stream 模式、Agent iteration、Runtime generation、请求思考配置、上下文压缩、有限来源桶、输出体量与 transport attempt；不存在静默 `agent_turn` 默认。
- 当前主模型视觉 presentation 与 Final Quality ReviewSet 会把 Runtime-owned observation / Photoshop revision 投影为 run-scoped SHA-256；长期档案不保存原始 observation key、documentId、historyStateId、正文、Tool 参数、路径或 Base64。同一 transport retry 保留同一视觉归因，已退休像素不会误报为再次发送。
- 独立审查发现并修复了一个先于性能优化的视觉事实错误：带图响应截断后旧链会先退休像素，却保留 pending observation，使无像素 recovery 有机会取得“已看图”信用。现在可恢复请求真实重发同一像素，只扣一次逻辑任务预算但记录每次物理请求；完整 /blocked /异常 /恢复耗尽才退休并清理，截断响应不能消费视觉观察。
- `diagnose-runs` 已能按 call kind 汇总模型耗时与 token、列最慢五次请求，并从既有 AgentRunRecord 读取 Tool name/origin/activity。现有 Tool 档案没有单次 duration，报告必须显示 instrumentation unavailable，不能用累计 elapsed 时间相减猜测。
- INTAKE-090 当前工作树已通过一轮 fresh 65 阶段 `maintenance:validate`，覆盖 Agent / UXP 测试、Main / Renderer 类型检查与 UXP production build；这证明归因和视觉恢复改动未破坏现有核心边界，但尚不能证明真实任务已经提速。
- 固定性能 Case `main-image-pink-coffee-unseen-v1` 的源目录已比 revision 4 少 4 张已处理平铺图；旧 fixture 已不存在，不能重放旧摘要。当前已将仍真实存在且摘要匹配的 64 张摄影输入冻结为 revision 5，并生成新的 path-bound 一次性 fixture；revision 4 的 19 次模型调用 /约 539 秒成功样本只保留为历史参考，不进入新 revision 的配对结论。
- revision 5 已完成一轮无人工纠正真实运行：Runtime 墙钟约 319 秒，12 次物理模型请求约占 93%，18 次 Tool 约占 7%；真实 Photoshop 制作、PSD 保存和 JPG 导出发生，但第 11 次候选终稿进入终态闭合后没有启动 Final Judge，第 12 次普通 Agent 恢复遭遇订阅模型 capacity，运行以 `error / artifact_incomplete / 0 of 16` 结束。该样本不进入成功率分子。
- 视觉盲评确认当前成品只把四色平铺摄影放大裁成方图，画面干净且主体完整，但更像 SKU /目录展示，没有建立点击主张、穿着关系或商业信息层级；它显著弱于 `D:\A1 neveralone旗舰店\C-1256\主图` 与 Eagle 点击图参考。Agent 曾选中模特图，却在复核后关闭它；本轮没有调用 Eagle。当前证据说明“看过图”不等于形成成熟设计判断。
- 本轮定位并修复了三个通用首偏差：Debug 收据过去无法区分“未声明交付”和“不安全 /畸形 /超量交付引用”，更上游的文件 collector 还会提前过滤、去重和截断；agentic 同轮写参数可以在 Task Profile 方法知识尚未进入上下文时生成并执行；Final Quality 异常和缓存复入失败会被压成 `null / stale`，再把旧 Judge 结果或缺口错误转嫁给普通 Agent。当前实现从 E2/resultRef 绑定处保留原始逻辑候选并采用 v5 `absent / valid / invalid` 交付状态，同时建立绑定后上下文因果栅栏，以及 exact revision 才允许复用的 Evaluation 协议摘要。
- 最终整合工作树在独立架构审查补齐 Debug v5 三态、Final Quality cache / reentry 与变更边界分类后，再次通过 65 阶段 `maintenance:validate`；覆盖 TypeScript 控制流、零任务进展时零 Host /零模型调用、exact / stale / unavailable 终审复入、Design Reliability、作者权、Main / Renderer 类型检查、Agent / UXP 测试与 UXP production build。fresh Photoshop 复测仍待完成。正式 Attempt 后同一 fixture 又收到一次“继续”并覆盖同名 PSD/JPG，因此该目录已污染，下一次必须新建一次性 fixture。
- 提交 `fc6781da` 后已使用正常程序和新项目 `DesignEcho粉咖主图测试-fc6781da` 完成一次真实 Attempt：15 次模型调用、18 次 Tool、约 703 秒，模型耗时约 90%；PSD/JPG 与 Final Judge 均真实形成。Artifact 已完成，但设计裁决为 `needs_review / 88` 且有两个 major，成品只是通用左图右文结构，明显低于用户成稿 / Eagle 参考，因此不能计为专业质量通过。
- 该 Attempt 的第 2 个 Tool 是旧 `recommendAssets`，并在后续采用 A01 /A02；项目状态还会自动展开旧选图、版式、文案与评审。结合默认 MCP 调试命令曾硬编码用户真实项目，已确认重复选图不能单纯归因模型：检索诱导、旧项目状态与测试环境复用共同污染了模型上下文。
- 提交前攻击审计发现的三个真实调用链旁路已经根修并复审：`browseAssetCandidates` 现在由工具身份保证 Task Profile 绑定前后都走 calling-Agent 中性路径；旧模型时代的 `published/promoted` 与伪 publisher 全部降为 `candidate + publicationReview`，生产 Evaluation 消费为 0；Main 通过纯 `chat-test-environment` 行为校验项目 /userData realpath、旧 `.designecho`、打包 /无 Bridge、目录重叠和单独 CDP。候选完整身份是 `candidateSetId + G + path`，集合指纹同时绑定 scope、size、mtime、alpha 和尺寸。限定复审已无 P0/P1；新增完成态审美复入资格已下沉到纯逻辑策略，并要求当前 ReviewSet、可靠 Judge 与必需 E2 交付证据同时成立。当前整合树已通过 fresh 65 阶段 `maintenance:validate`，含 Agent 简化棘轮、作者权 /业务边界、Main /Renderer 类型检查、Agent /UXP 测试与 UXP production build。
- `INTAKE-092` 的代码治理已落地并通过专项行为测试与一轮 fresh 65 阶段 `maintenance:validate`，覆盖 Main /Renderer 类型检查、作者权边界、Agent /UXP 测试及 UXP production build：唯一生产事实源固定 1500×1500、1500×2000、1440×2160 三份 72 ppi RGB/8 工作文档，每份保留 5 个点击槽与 4 个转化槽；空骨架为 39 步 editable-only 任务，满 27 槽为 120 步冻结计划。槽位内容必须由 Agent /用户通过 `slotAssignments` 逐槽声明素材、主体 bounds、target /safe box、缩放 preset 与理由；旧 `variants[index]`、全局素材扇出、固定 DSL /文案 /recipe 和 1200 禁转化均已移除。UXP 导出会隔离兄弟子组并保留完整工作画布；顶层 /子组归位由真实 documentId、Background id、父子路径和规格面板顺序读回验证。最终独立只读审查确认此前层级测试假绿风险已关闭且当前无 P0/P1；仍缺 fresh 正常程序 Photoshop Host Attempt，不能把自动验证写成实机通过或视觉质量改善。
- 当前增量统一了两种 agentic Runtime 入口：进入 Agent 前已绑定和 Agent 循环内显式声明都会得到同一个 Manifest 输入 /交付责任投影、相同方法上下文和唯一主图 production owner；`user_goal`、随消息图片、项目素材和当前 Photoshop 文档只作为来源事实，workflow entry 不裁掉 broad atomic Tool，也不授予写权限。
- 主图生产执行现在要求同一 TaskRun 的 branded guarded executor 与由它签发的 delivery authority；无效 assignment、跨 executor authority、artifact /staged path /lease digest /完整提交集合漂移都在 Host 前失败。显式 assignment 只创建实际涉及的规格文档；保存和导出写 staging，只有实际 Tool result、文件大小 /hash、同版本和 external commit 全部闭合后才提交正式目录。真实 `mainImageExecutor` 正向行为夹具已证明一份 800 文档、11 组、一张结果图与一份可编辑稿整组提交；这仍不是 Photoshop Host E2E。
- 主图开放创意纵切已实现 `prepare → 同一 Agent 通用 Tool 分层设计 → finalize`：prepare 只接受 Agent 明确选择的一个标准规格，只创建一份工作文档和 11 个空组，不保存、不导出；Runtime 以有界、过期、不可授权的 workspace 引用绑定同一 TaskRun、项目、创建收据 documentId、group layerId 与 Photoshop revision。同一 TaskRun 的 Reflexion generation 可以更换 runId /generation 而不丢 workspace，换 sessionId 才是另一 TaskRun。Agent 随后继续使用 broad atomic Tool 完成多图、文字、形状、蒙版和排版；finalize 只接受同一文档、同一组身份、新 revision 和真实非空标准组，再复用现有 staging /文件身份 /external commit 事务保存可编辑副本并导出。Skill 没有第二套 DesignIR，也没有取得素材、构图或审美决策权。
- 新持久行为回归使用真实 `mainImageExecutor`、真实 guarded executor /delivery authority 和 OS 临时项目证明：prepare 为 1 建档 +11 建组且 save/export=0；未修改、空组、错误 TaskRun、错误 document、被替换 group 和重复 finalize 均在正式文件写入前失败；Agent 通过通用 `placeImage + moveLayerToGroup` 写入一个自己选择的组后，新的 Skill 调用可只导出该真实非空组并把 PSB/JPG 同 revision 整组提交。背景层本地化名称不再作为身份；staged editable 始终 `asCopy=true`，不把活动工作文档改绑到临时目录。Renderer 类型检查、作者权、Runtime 声明、Skill Package、Capability、Tool、业务边界、通用 executor 与简化棘轮专项均通过；随后 fresh `maintenance:validate` 单次通过 65 个核心检查，覆盖规划 /卫生 /编码、Agent /UXP 测试、Main /Renderer 类型检查和 UXP production build。首次全量运行曾在既有 `test:user-choice-request` 出现一次 Windows 访问冲突，单项立即全通过，第二次从头完整闸门为 0 退出码；没有把瞬时崩溃记作产品成功或失败。
- 当前增量已经通过一轮 fresh 65 阶段 `maintenance:validate`，覆盖规划 /卫生 /编码、工具与 Skill 审计、Runtime /Prompt /作者权 /交付行为、Main /Renderer 类型检查、Agent /UXP 测试和 UXP production build；它不证明真实 Photoshop Host 或视觉质量通过。
- Codex strict Tool Schema 兼容层已由 `69c54867` 根修：条件约束在投影为订阅通道可接受 schema 时不再静默丢失，而以有界 advisory 描述保留；一次响应中只有失败 Tool Call 进入有界修复，合法兄弟调用不会被整轮丢弃。续跑身份已由 `b4998b65` 根修：同分支未完成 Run 只携带不授权 Tool /写入 /完成的结构化 Runtime identity，畸形、来源不符或 Manifest 不匹配均失败关闭。两项改动分别通过 fresh 65 阶段 `maintenance:validate` 并已推送。
- 新普通项目的自然短提示 Run 663 证明 `placeImage` 条件 schema 已可正常执行，也形成 PSD/JPG 和真实质量复核；但 Agent 没有采用已设计的 `prepare → 通用 Tool → finalize` 唯一交付接缝，而是用通用保存 /导出先交付 800 稿，随后又建 1440 文档并把导出 JPG 重新置入，产生两套正式文件。最终 1440 PSD 只有 3 层，说明“文件事务成功”仍可旁路“专业可编辑主图”的生产 owner；Renderer 内存 workspace 在应用重启后也无法恢复，不能承担跨进程续跑事实。
- 同一会话只输入“继续”的 Run 664 已真实使用 `structured_run_resume` 恢复 `ecommerce.main_image.v1`，16 次 Tool 全部成功，重新比较候选后由模型选择完整穿着图，PSD/JPG 同版本交付、外部 Photoshop 文档 revision 零变化，canonical 终态为 `completed / 89`。但人工像素对照确认成品主要是对优质摄影图做方形裁切和放大，鞋子视觉重量过大，没有建立点击主张、商业信息层级或显著设计增量；自动 Evaluation 的通过是当前误放行证据，不能登记为专业质量达标。
- Run 663 /664 的 completion 旁路首偏差已经由 `36a1db51` 根修：`delivery_plan_binding_required` 过去在 Manifest → agentic completion contract 投影时丢失，导致普通原子 PSD/JPG 收据可以覆盖 Workflow owner。现在该约束与 Manifest 声明的 producer Skill 身份一起进入通用完成契约；只有 producer 返回绑定执行前 typed DeliveryPlan、完整 resultRef proof、文件身份、Photoshop revision 与 exact artifact set 的 ready receipt 才能结算正式交付，receipt 后任何内容 mutation 或通用 save/export 都使其失效。实现没有主图关键词分支，也没有阻止 Agent 使用通用 Tool 工作，只收回错误 completion 信用。
- 新附件故障已归属为 `INTAKE-091`：聊天上传会给主模型文件名和像素，但当前通用执行链没有可由模型引用、由 Tool 解析的请求级附件句柄；项目搜索和任意 CLI 都不能证明同名文件就是上传字节。P0 方案是 `attachmentRef` Input Asset Provider，通用 CLI 独立归属 `INTAKE-088`。
- revision 5 正式运行前的 Debug Bridge、Photoshop MCP、UXP Runtime、模型、fixture、写授权和外部文档 ownership 均通过只读 preflight；下一轮仍必须在新提交和新 fixture 上重新核对，旧收据不能复用。
- 当前可靠性数据只能证明存在历史单次通过和大量失败记录，不能形成 S1 的当前版本成功率；正式分母必须来自冻结 Case、canonical Attempt 和终态证据。

### 实施边界

- Agent 拥有交付声明、设计判断和修订选择；Harness 只绑定 TaskRun、target / revision、权限、Tool 收据、Repository 投影、Evaluation 结果与终态。
- 不扫描项目目录猜最终文件，不把全部导出当最终稿，不放宽 `finalArtifactManifest`，不把 Debug sidecar 升级为生产完成 owner。
- 不建立第二套 Evaluation、Review 状态机或品类专属 Runtime；协议修复进入现有 `DesignVerdict`、completion contract 和同任务复入链。
- 不关闭、保存或修改用户当前打开的外部 Photoshop 文档。正式写入只允许发生在通过 preflight 的一次性 fixture 和明确授权范围内。
- S0 文档改动先形成可回滚 Git 基线；S1 生产改动与评测记录保持独立提交边界。

### 下一步

1. `69c54867` 与 `b4998b65` 已分别提交并推送；用户未提交的 3 个 UI 文件未进入提交。Run 663 /664 与四份真实交付保留为失败归因证据，不进入 S1 专业质量分子。
2. `36a1db51` 已关闭正式 completion 旁路：Manifest-bound 主图不能再由普通 PSD/JPG 保存冒充 Skill finalize；原子 Tool 保持可达，Harness 不替 Agent 选择文件、画面或下一动作。
3. 停止购买相同自然提示样本，继续把主图 prepare workspace 从 Renderer 进程内 Map 收敛为 TaskRun-owned、可持久化、可 reconciliation 的有界身份事实；不得新建第二 Task Store，也不得从旧助手措辞、Project State 或文件名恢复执行权限。
4. 建立“进程重启、错误 TaskRun /project /document /group /revision、已消费 workspace、Host 文件漂移”故障注入；证明恢复只重建身份资格，必须重新读回当前 Host 才能 finalize。
5. 在新普通项目中再运行一次自然短提示；验证同一 Agent 的对象理解、候选比较、可选参考、复杂分层、唯一规格、finalize、同版本可编辑稿 /导出、Final Judge 与外部文档零变化。
6. 用用户成稿 /Eagle 参考校准 Evaluation 的误放行：裁切完整只能算摄影素材可用，不能替代点击主张、商业信息层级、图文关系、可编辑结构和设计增量；校准仍保持 advisory，不取得设计作者权。
7. 在 S1 正式队列扩大前完成一个上传附件的通用 `attachmentRef → placeImage → removeBackground → 同目标读回` E2E；随后再按 INTAKE-088 分阶段建设受控外部文件与 CLI Provider。

### 验证与未知

- 必须验证：交付引用来自 Agent 声明且精确匹配 producer receipt；包含至少一个可编辑源稿和一个栅格导出；二者绑定同一任务目标与允许的 revision。
- 必须验证：外部文档 revision 零变化；失败不会被表达成“已完成”或“结果需要复核”；同一 blocker 不会通过重试、换措辞或新 TaskRun 被隐藏。
- 已自动验证：Evaluation 输出非法时保持协议失败且不污染 Agent、TaskCompletion、任务卡或学习；合法结果只能消费当前 ReviewSet，不得伪造人工裁决或默认高分。
- 已自动验证：r38 形态的同 revision PSD/JPG 能机械投影 E2 refs 与 Debug 相对路径，任一 revision 不一致时整组失败。
- 已自动验证：模型调用用途、上下文桶守恒、压缩计数、输出形态、多 transport attempt、run-scoped 视觉摘要、深拷贝和旧 v0 兼容；这些字段保持 observation-only，不获得预算、权限、任务结果或审美裁决权。
- 已实机验证：中性候选与历史状态隔离后，Agent 能比较候选并在返修时选择不同的完整穿着图；这证明 Harness 没有继续锁死旧首图，但尚不能证明 Agent 会主动看 Eagle、形成成熟创意或做出专业商业主图。
- 当前未知：用户主图骨架只证明 5+4 容器，尚不能证明 1200 四个转化槽是否必须填满、点击图五个非空候选是否全部交付，以及最终平台上传尺寸；当前实现因此默认全部为空，只执行 Agent /用户显式 assignment，这些业务取舍不能由 Harness 猜测。
- 当前未知：合法空交付收据修复能否在真实失败 Attempt 中稳定落为 `evidence_incomplete`，仍需新 fixture 验证；不能用已被后续“继续”覆盖的文件反补旧 Attempt。
- 当前未知：自动 Evaluation 对错字、标题重量、点击目标、视觉主次和商业完成度的校准问题仍未解决；当前设计质量仍不达标。
- 已实机证伪：正常程序中的 Agent 没有主动走完 prepare / finalize，而由通用保存 /导出旁路产生重复规格与低层数稿件；现有进程内 workspace 也不能支持应用重启后的可信续跑。下一轮必须先关闭唯一 finalizer 与持久化身份根因，再验证专业分层设计；不能继续把模拟 Host 绿色外推成真实工作流成立。

### 状态

`in_progress`
