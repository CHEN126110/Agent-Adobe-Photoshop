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

1. 提交并推送已经通过完整核心验证的交付分类、上下文因果栅栏与 Evaluation owner 修复，形成干净可回滚基线。
2. 重建与提交一致的 Agent / UXP 调试运行，创建新的 path-bound 一次性 fixture；旧 revision 5 运行目录只保留诊断，不再写入或作为完成证据。
3. 用同一冻结 Case 再运行一次自然短提示，验证绑定前 sibling 写为零、绑定后模型真实消费主图方法、Final Judge 有独立 `callKind`、失败不再转成普通 Agent recovery，并重新做用户成稿 /Eagle 盲评。
4. 若作品仍退化为安全平铺图，保持 Agent /Evaluation owner 归因，按 GMR 选择一个可证伪变量：参考研究上下文供给或 Evaluation 对“点击目标 /安全方案塌缩”的检出，不再继续增加缩放规则或品类提示。
5. fresh Attempt 同时证明 `finalArtifactObserved=true`、PSD/JPG 精确 `runtimeDeliveryResultRefs`、非空 Debug `finalArtifactRefs` 与外部文档零变化后，再冻结剩余 5 Case × 2 队列。
6. 在 S1 正式队列扩大前完成一个上传附件的通用 `attachmentRef → placeImage → removeBackground → 同目标读回` E2E；随后再按 INTAKE-088 分阶段建设受控外部文件与 CLI Provider。

### 验证与未知

- 必须验证：交付引用来自 Agent 声明且精确匹配 producer receipt；包含至少一个可编辑源稿和一个栅格导出；二者绑定同一任务目标与允许的 revision。
- 必须验证：外部文档 revision 零变化；失败不会被表达成“已完成”或“结果需要复核”；同一 blocker 不会通过重试、换措辞或新 TaskRun 被隐藏。
- 已自动验证：Evaluation 输出非法时保持协议失败且不污染 Agent、TaskCompletion、任务卡或学习；合法结果只能消费当前 ReviewSet，不得伪造人工裁决或默认高分。
- 已自动验证：r38 形态的同 revision PSD/JPG 能机械投影 E2 refs 与 Debug 相对路径，任一 revision 不一致时整组失败。
- 已自动验证：模型调用用途、上下文桶守恒、压缩计数、输出形态、多 transport attempt、run-scoped 视觉摘要、深拷贝和旧 v0 兼容；这些字段保持 observation-only，不获得预算、权限、任务结果或审美裁决权。
- 当前未知：本轮新补丁尚未在 fresh production build 上证明 `final_quality_judge` 可真实启动，也未证明上下文因果栅栏会改善选图、参考取舍或成品质量。
- 当前未知：合法空交付收据修复能否在真实失败 Attempt 中稳定落为 `evidence_incomplete`，仍需新 fixture 验证；不能用已被后续“继续”覆盖的文件反补旧 Attempt。
- 当前未知：自动 Evaluation 对错字、标题重量、点击目标、视觉主次和商业完成度的校准问题仍未解决；当前设计质量仍不达标。

### 状态

`in_progress`
