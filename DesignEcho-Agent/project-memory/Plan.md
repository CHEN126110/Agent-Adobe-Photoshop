# Current Implementation Plan

## 2026-08-30 唯一当前顺序：`D-113 + r35（已实现并归因）→ D-114 首写收据 producer/consumer 一致性 → fresh r36 → Task Profile /上下文效率独立治理 → D-102 /D-103 真机复验 → ONNX /构建链`

本节是当前唯一实施优先级；下方旧日期段只保留历史上下文，不再拥有“当前主线”权力。

当前 D-114 进度：D-113 已提交 `80568030` 并取得 clean Agent /UXP identities。fresh r35 用正式 DeepSeek 和真实 Photoshop 只创建一个文档，完成同 revision PSD/JPG 与全生命周期结算，6 个用户文档零变化；但 Reliability consumer 拒绝了缺少 `preexistingDocumentRevisionsUnchanged` 的首写收据。该事实已由 baseline assessment 计算却未序列化，属于 producer/consumer 通用协议漂移。r35 已按 unknown-write 协议重启 Runtime /重载 UXP并合法 reconciliation；D-114 已补齐 state /receipt 字段并增加 producer 真实收据直达 consumer 的集成攻击测试。专项边界、Main /Renderer 类型、Agent /UXP production build 与提交前唯一完整核心 65/65 已通过；下一步只做独立提交 /clean identities和 fresh r36，不重复核心。视觉上 r35 仍有标题过重及“木耳耳边”错误，自动 90 分不作为专业质量通过。

1. `[已完成 f148 修复、验证与推送]`：完成态可选 generation 的多维容量证明已通过完整核心闸门 58/58，并以 `f148d512` 推送当前分支；提交后 Agent /UXP identity 已重建并在 r23 写前核实为同一干净提交。
2. `[已完成 r23 / 已对账]`：同一句自然需求在全新 fixture 中完成 17 次模型调用、18 次 Tool Call、8 次成功写 /保存 /导出，生成 27,621,377 字节 PSD 与 822,776 字节 JPG；没有创建 r22 式 0 调用空子代。Attempt 因 `finalArtifactRefs` 为空判为 `submission_unknown_write_state`，随后已在同构建重启、0 文档、0 待处理请求和同 fixture 条件下 reconciliation。
3. `[已定位 r23 首个偏差]`：Agent 最终只读取了带 `region` 的局部画面；局部截图能支持裁切微调，但不能形成单画布任务要求的完整 ReviewSet。Run Record 因而出现 `fresh_visual` 缺失、质量覆盖 0/16、R5 未闭合，E2 也不能把真实 PSD /JPG 投影为可信最终交付。
4. `[已完成 D-089 / 329a650e]`：终态质量链先读取同 revision 结构；若单画布完整 ReviewSet 缺失或过期，Harness 只追加一次 target-bound、无 `region` 的全画布只读观察，再把像素交给同一个多模态 Agent 模型的 Final Judge。逐图收据与精确 Host 结果可绑定回 E2；完整核心闸门 58/58、Agent /UXP production build、提交和 GitHub 推送均已完成。
5. `[已完成 r24 / 已对账]`：同一句自然需求在全新 fixture 中完成 15 次模型调用、15 次 Tool Call、5 次成功 mutation，生成 30,118,573 字节 PSD 与 1,016,313 字节 JPG。Agent 自主选图、说明左右构图并针对平铺袜偏小做一次局部修正；但 Final Judge 的描述与真实成品矛盾，Debug Bridge 仍因空 `finalArtifactRefs` 判为未知写状态。PSD/JPG SHA-256 已固化，测试文档已关闭，Attempt 已在同构建、同 fixture、0 文档 /0 pending 下 reconciliation。
6. `[已定位 r24 首个偏差]`：`selectFinalQualityReviewSet` 的注释要求主图选 full-canvas，代码却仍允许 `single || bundle`。同 history 的素材 /局部 Bundle 让 Harness 跳过自动全画布，Judge 评价了辅助素材；E2 同时正确拒绝非 full-surface，所以产生“Judge 已看成品”与“没有可信交付引用”的内部矛盾。
7. `[已完成 D-090 / 1521c504]`：把 ReviewSet source 纳入终局身份：单画布只接受 `single_surface`，多画面只接受完整 Bundle；Judge、E2 与可信运行 Artifact 使用同一选择函数。完整 `maintenance:validate` 58/58、Agent /UXP production build、独立提交、GitHub 推送和提交后双 Runtime identity 均已完成。
8. `[已完成 r25 / 已对账]`：同一句自然需求在全新 fixture 中完成 12 次模型调用、13 次 Tool Call、4 次成功内容 /文件 mutation。自动无 region 全画布与 Judge 对象正确，Agent 自主形成不同于 r24 的三素材分栏成稿；PSD 66,126,102 字节、JPG 1,046,636 字节，质量 86 / `needs_review`。`finalArtifactRefs` 仍为空，Attempt 已在同构建、同 fixture、0 文档 /0 pending 下 reconciliation。
9. `[已定位 r25 首个偏差]`：真实 renderer 探针证明 `quickExport` 重定向写出的 JPG 缺少 `sourceHistoryStateRef`；E2 正确拒绝无法绑定终审 revision 的文件，而 `production-delivery` 只按文件格式计数。进一步证伪确认 ExtendScript 与 UXP history id 不在同一身份空间，不能互相包装。
10. `[已完成 D-091 / 1a3f95d3]`：JSX 只在写前核对实际源文档 ID；UXP 是 revision 唯一 owner，在导出前冻结并在导出后读回同一 history，再返回收据。修复后同形探针的 renderer 收据、导出前 /后 revision 均为 `4492:4497`；完整 `maintenance:validate` 58/58、Agent /UXP production build、独立提交、GitHub 推送和提交后双 Runtime identity 均已完成。
11. `[r26 已提交但未闭合]`：全新 fixture 与干净 `1a3f95d3` 写前预检通过；Agent 自主观察并选择 A01 后，外部 Codex 执行回合关闭了原 CLI、Runtime 与 Photoshop。Attempt 只有 `armed / submission_started`，无 terminal、Run Record 或产物；当前正式账本为 6 次 submission、5 次 terminal、1 次未闭合。
12. `[已完成 D-092 / 3532985b]`：复用现有 `listDocuments`、Operating Context、TaskRun 创建 /mutation 收据和项目路径真相，不新建状态中心。UXP 区分本地路径 `pathState` 与保存后修改 `editState`；模型看到项目内外和 dirty 状态，但不因此取得保存 /关闭权限。reconciliation 使用 `no_fixture_documents`，专项回归、完整核心闸门 58/58、Agent /UXP production build、提交推送和提交后 clean identity 均通过。
13. `[已完成 r28-r31 终局纵切]`：r28 完成精确文档对账；`972baf75` 修正终审 Host 预算，`a56d62c1` 清除 Suite locator 对 Case schema 的污染，`8ccda924` 增加 Main 验真的请求级交互收据并均已推送。r31 取得首个 15 项技术检查通过、同版本 PSD/JPG、Harness 0 写入且 `userInterventionCount=0` 的正式样本；19 次模型、26 次 Tool、约 8 分 59 秒，视觉 85 / `needs_review`，当前只覆盖 1/5 Case。
14. `[已完成 D-093]`：正式 Attempt 和首次 mutation baseline 从全局 `none_open` 收敛为对象级冻结。路径明确的 fixture 外部 dirty 文档可以保留但不能成为写目标；提交时已有 fixture /未知归属文档、新出现的外部文档和对外部活动文档的普通写入继续阻断；`createDocument` 与同请求后打开的 fixture 活动目标可继续。专项行为验证、完整核心闸门 58/58、Agent /UXP production build 与独立 Git 提交均已完成；远端发布状态由 Git 记录。
15. `[已完成 D-094 / eb40a93c]`：保留 D-093 唯一 baseline owner，把提交前已有且 Host revision 可读的未保存文档定义为受保护 TaskRun 前置对象。首次 mutation 必须是 `createDocument`；首次写前与完成时都核对前置 documentId/history、身份和 dirty 状态。缺 revision、对象变化、新外部文档或后来打开 fixture 输入文档均 fail closed，不保存 /关闭用户工作稿。专项、Agent /UXP production build、完整核心闸门 58/58、独立提交和提交后 clean 双 Runtime identity 已完成。
16. `[r32 已失败并留账]`：DeepSeek V4 Flash Vision 在 11 分 29 秒内执行 24 次模型调用、21 次 Tool Call；首个 `placeImage` 被写前安全拒绝，后续正确 `createDocument` 因 baseline 永久 blocked 仍失败，最终 8 次 mutation 尝试全部未派发、成功 mutation 为 0。运行中又发生外部文档并发变化和 UXP build 漂移，Attempt 已以 `submission_unknown_write_state` 终止，不能进入技术成功或质量分母。
17. `[已完成 D-095 / d8ce40ef]`：只在错误首写工具已被 dispatch 前拒绝且没有 Host 副作用时，把 baseline 恢复到 pending；下一次重新读取 Runtime 与完整文档 revision，只有 `createDocument` 可通过。真实 Runtime /文档漂移仍永久 blocked。专项攻击、相邻审计、Main /Renderer 类型检查、Agent /UXP production build、完整核心闸门 58/58 和独立提交均已完成。
18. `[已证伪错误 P0]`：r32 后续写入 Run 来自编辑已发送消息后的新 branch 顶层重发，不是 Debug Attempt 的自动 generation 逃逸；不实施代际 Guard、不延长旧 Attempt lease、不阻断正常重发。该 Run 只作为 262 万 input token、32 次模型调用和低专业完成度的运行 /设计诊断，不计入正式 Attempt。
19. `[D-096 已完成代码阶段]`：正式 `run-live` 与官方 UXP loader 竞争仓库外同一 Photoshop Runtime lease。采集在 armed 前取得并复验 binding；loader 在 UDT mutation 前取得；存活 owner 不被 TTL 误删，死亡 owner 可回收，释放必须匹配 leaseId。纯逻辑、loader self-test、真实双进程拒绝 canary、相邻审计、Main /Renderer 类型检查、Agent /UXP production build、完整核心闸门 58/58、独立提交和提交后 clean identity 均已完成。
20. `[D-097 可证伪根因]`：r32 普通重发的最后一次 3 图 Final Judge 恰好输出 4,320 tokens，与 12 项断言的 `12 × 360` 上限完全相同；accounting 没有 Provider 调用失败，而严格完整性读取会拒绝 `max_tokens`。RunRecord 未保留原始 `finish_reason`，因此当前把隐藏思考耗尽预算作为最强解释并由 r33 证伪；DeepSeek 视觉回执当前是 optional，不是本次 `judge_unavailable` 的已证实 owner。
21. `[D-097 已完成代码与提交]`：只对无 Tool、固定 JSON 契约的 Final Judge 与 diagnosis repair 显式设置 `thinkingEnabled=false`，保留 4,320 token 上限、严格 `end_turn`、同 Photoshop revision、ReviewSet 与 Codex 回执边界；不关闭主 Agent 思考、不按模型名新增 Harness 分支。专项、Main /Renderer 类型检查、Agent production build、完整核心闸门 58/58 与独立提交已完成。
22. `[D-098 已完成 / 独立 worktree]`：已证实 provisional finding 和模型参数 `evaluateDesign.calibration` 绕过 Experience Publisher 进入生产评审。删除两条旁路，保留候选 /provisional 策展和正式用户反馈发布；专项、作者权、Tool 审计、类型、Agent /UXP production build、唯一一次完整核心闸门 58/58、最终差异审查与独立提交均已完成。D-097 worktree 不含本改动，继续承担 r33 单变量验证。
23. `[D-099 已完成 / 独立 worktree]`：把 DeepSeek 官方 cache hit / miss token 沿现有 Provider → Runtime Accounting → RunRecord / `debug:runs` 链路保存。只有完整守恒数据入账；流式请求显式启用 usage 并消费 `choices=[]` 尾块。专项、类型、Agent /UXP production build、完整核心闸门 58/58、最终差异审查与独立提交均已完成；真实 DeepSeek 命中率采集后置。该切片不进入 D-097 的 r33 单变量基线。
24. `[D-100 已完成 / 独立 worktree]`：基于 W3C、Figma、IBM、Adobe、Shopify、Baymard、三个 Eagle 锚点与 C-1204/C-1105 用户成稿完成设计知识差异审查。只保留中文标题断行、商品照片表达模式/合成一致性、目标变体缩略图显著性三条未发布候选；首个 A/B 固定为 C-1105 隔离未见 Case，B1 只测试 C-02。生产 Knowledge /Recipe /Evaluation 未改变，文档快速检查、最终审查与独立提交均已完成。
25. `[D-101 已完成 / 独立 worktree]`：OpenAI-compatible 成功流的请求 JSON /图像 data URL 字节、adapter /测量税、stream open、首块、首语义和 Main 完成时间已沿现有 physical attempt → Runtime Accounting → RunRecord / `debug:runs` 接线。专项攻击、编译产物假流、Main /Renderer 类型检查、相邻审计、Agent /UXP production build、唯一一次完整核心闸门 58/58 与独立代码提交均已完成。最小真实 DeepSeek 双请求进一步取得 2/2 cache usage 与阶段覆盖：冷请求 872ms，精确重复前缀第二次命中 256/313 input tokens、完成 765ms；没有执行 Tool 或触碰 Photoshop。完整 Case /RunRecord 采集仍后置，该切片不进入 D-097 的 r33 单变量基线。
26. `[D-102 代码与工程验证完成 / 独立 worktree]`：从 D-101 `c0b358fb` 逐提交移植已真机暴露过的语义抠图工作流、Agent 实例引导、目标守恒、scope owner、sourceBounds 和同步读回修复；旧项目记忆与旧依赖声明未合并。依赖预检、专项攻击、作者权、181 Tool 注册、Main /Renderer 类型、Agent /UXP production build、相邻审计、文件 parity 和唯一一次完整核心闸门 59/59 均通过。D-097 不含本改动；D-102 exact build 真机复验后置于 r33。
27. `[D-103 代码与工程验证完成 / 独立 worktree]`：在 D-102 `a262a4f8` 上按三个独立提交移植纯离线算法、版本化单事务 Provider 与面板迁移；旧项目记忆和过时依赖声明未进入。依赖预检、算法 /Provider /面板专项、UXP 全测试、181 Tool /作者权 /业务 /Executor /语义 dispatch /变更边界、Main /Renderer 类型检查、两端 production build、唯一一次完整核心闸门 60/60、27 个非重叠功能文件 parity 和独立状态提交均已收口。原分支三次合成曲袜真机只证明几何 /事务，不替代 D-103 exact build 或商业样本质量。
28. `[D-104 工程验证完成 / 独立 worktree]`：祖先提交 `5c1bc06d` 的 Anthropic peer 迁移已在无 junction 的新工作树完成 Agent /UXP `npm ci`、双方 `npm ls --all` 0 problems、依赖完整性 636/636 与 148/148、Agent /UXP production build、UXP 全测试、唯一一次完整核心闸门 60/60 与独立状态提交。首次 Windows 安装只留下 macOS optional `dmg-license` 空残壳，已由 `npm prune` 清理；package /lock /source 零改动，动态安全债务已进入 R-054 并保持未修复状态。
29. `[D-105 工程证据与独立状态提交完成 / 独立 worktree]`：当前主链祖先 `acd53530 /0fa91c6f` 的 Smile 对话与图像 Provider 已完成用途 /单模型路由、独立 Key、图像协议、取消 /错误 /收据、OpenRouter 相邻回归和核心文件 parity 验证；正常用户状态仍以 DeepSeek `deepseek-v4-flash-vision-exp` 为唯一正式 Agent 模型。D-105 不执行付费请求，不把 Smile 变成 fallback，不夹带 R-054 依赖升级；同源码的 D-104 独立安装、两端构建和核心 60/60 证据继续有效，本 docs-only 切片只运行相称治理检查。
30. `[D-106 Electron Runtime 已完成 / 6a37acb9]`：Electron 28.3.3 /Node 18 已迁移到 Electron 44.0.0 /Node 24.18.1；ClipboardItem /sRGB、显式官方二进制安装、Main runtime manifest、clean install、62/62、Agent /UXP clean identity 与 exact clean app.asar 启动均闭合。默认用户 Runtime /Photoshop 未触碰。
31. `[D-107 OpenAI/Zod 已完成 / f3742497]`：OpenAI 7.8.0 正式支持 Zod 4，旧 override 已删除；ws 8.21.3 满足 peer并清除自身 finding，undici ProxyAgent 替代已删除的 `httpAgent`。无凭据协议、最小真实 DeepSeek exact-model Tool stream、完整核心 63/63、Agent /UXP clean identity 与 exact clean app.asar 均已闭合。
32. `[D-108 非 Codex 启动惰性化已完成 / 16db25ec]`：Main /Renderer 只在当前主模型为 `codex-subscription-*` 时启动恢复目录；DeepSeek exact clean packaged runtime 为 0 个 Codex 进程，显式订阅模型仍可启动 1 个受限 model-bridge。完整核心 63/63 与 clean Agent /UXP identity 已闭合。
33. `[D-109 Volcengine SDK 安全覆盖代码 /clean install /本地协议 /production build /dirty app.asar /完整核心 64/64 已通过，提交收口中]`：根 Axios 1.20.0，OpenAPI 1.36.2 与 TOS 2.9.1 子树的安全覆盖由真实 JSON/multipart/TOS/Protobuf/UUID 契约守护；生产 audit 17→6 且本 owner finding 归零。下一步只做独立提交和 clean identity。
34. `[默认端口释放即优先完成 r32 reconciliation]`：r32 fixture 设计文档已经关闭，但用户普通 DesignEcho PID 36604 当前占用默认端口且未绑定 r32；既有用户 Photoshop 现场仍不可抢占。待端口自然释放后用 D-097 clean Debug Runtime 完成唯一 reconciliation，不移动账本或跳过 `unreconciled_live_attempt_exists`。
35. `[待完成 r33]`：对账后使用已冻结的全新 r33 fixture，继续使用 DeepSeek 官方 `deepseek-v4-flash-vision-exp`、真实 Photoshop 和 1440×1440 画布运行正式 Attempt；验证 D-095 正确首写恢复、D-096 loader 互斥、D-097 Final Judge 完整终态、外部 dirty 文档零改动与同 revision PSD/JPG。
36. `[条件后置]`：r33 技术成功后，先用 D-102 exact clean Agent /UXP build 复跑固定语义抠图案例，再用 D-103 exact clean build 分别验证 Provider 与真实面板按钮链；姿态商业视觉验收等待符合适用范围的自然弯曲单袜。随后对 D-100 候选逐条 A/B，并用 D-099 /D-101 真实证据治理性能，不通过减少必要观察换速度。

## 2026-08-28 已完成前置里程碑：`DESIGN-RELIABILITY-TERMINAL-TRUTH-001`

本节保留 r20 → r21 的历史上下文，不再拥有当前实施优先级。

1. `[已完成 Attempt 1 / 已定位首个偏差]`：GPT-5.6 Sol 在 r20 真机样本中只建立空白 1440×1440 文档；已确认终态取消身份、结果投影、Case 尺寸与预算边界三类 Harness / benchmark 根因。
2. `[已验证]`：分离用户停止与外部请求取消；结构化 Agent 终态优先；空白建档不取得设计版本信用；主图尺寸 authority 进入 preflight 与 cohort；30 分钟 Agent 预算外保留 5 分钟结算窗口；完整核心闸门 58 个阶段通过。
3. `[待提交]`：完成最终差异审查与项目状态投影检查，形成独立可回滚提交并推送。
4. `[待实机 Attempt 2]`：重启新提交，reconcile r20，创建全新 r21 fixture，以同一句自然需求、同一模型和同一素材执行；只根据首个新偏差继续归因。
5. `[待多次重复与盲评]`：单次技术成功后继续完成至少 5 次零人工纠偏运行，并与用户设计及 Eagle 参考做盲化视觉比较；文件生成不替代设计达标。
6. `[条件后置]`：主图固定案例稳定后依次推进详情页、SKU、参考复刻，再扩展无 Skill 能力；质量不退化后才优化速度。

## 2026-08-24 当前主线：`IMAGE-PLACEMENT-FIRST-WRITE-001`

1. `[已完成] 真实事故归因`：用 UXP 日志复算 `4672×6453 → 750×426 cover`，确认约 58.88% 图框位于裁切目标外；区分 Agent 构图错误、Harness 假通过/观察不足与 UXP 正确机械执行。
2. `[已完成] 语义契约`：图片块显式声明 fit、anchor、cropPolicy，按需声明 focalPoint / subjectFillRatio；移除隐藏 0.82、无效 preserveSubject 和首写后才生效的半失效字段。
3. `[已完成] UXP 统一几何`：placeImage / transformLayer 共用 target-fit 内核和唯一 Photoshop 事务 runner，支持五种锚点与归一化关注点，返回 frame/focal 几何收据并在验证失败时回滚。
4. `[进行中] 写前一次落位`：纯 shared 预览与 UXP 几何做逐项对照；`renderLayout` 主体占比、`composeDesign` 摄影图和图片背景改为写前求最终图框、单次 placeImage；下一步完成纯 shared prewrite planner 抽取，避免规则滞留在通用执行器。
5. `[已完成] 写后观察覆盖`：长页风险目标、局部截图区域、cap=8 与 overflow 规划收进同一 shared 模块；`expectedTargets` 保留全部复核义务，frameVisibleRatio=0 不再被默认值吞掉。
6. `[进行中] 回归与卫生`：写前预览、compose 契约、作者权、Tool 注册、Skill package、UXP target-fit/事务审计已分别验证；待运行 `maintenance:validate`、入口文档同步、仓库卫生和最终 diff 审查。
7. `[待验证] 真机复查`：用独立 Photoshop 测试文档复现原竖图横框病例，确认 protect-subject 在写前不产生错误图片层、allow-crop 一次落位后返回局部同版本画面、subjectFillRatio 不再出现第二次 transform；不能用静态测试冒充真机通过。

## 2026-08-24 当前主线：`AGENT-PREACTION-EFFICIENCY-AND-PHOTOSHOP-CRAFT-001`

1. `[已完成] G0 假设与预期冻结`：第一任务卡已经记录已知事实、未知项、H-PERF / H-CRAFT 因果假设、替代解释、证伪条件、预期区间、不变量、单变量实验顺序和立即回滚门；历史 596 份 Run Record 只作问题发现依据，不作为当前 HEAD 的正式前后对照。
2. `[已完成·核心验证] G1-A 普通 Agent 会计覆盖`：plan-neutral / agentic 使用与 staged 相同的 `RuntimeAccountingLedger`；模型、Tool、usage 与 prompt shape 进入 unscoped bucket，中途绑定 staged 时转移同一 ledger 并释放旧 owner，不再补造 `durationMs=0`。顶层 `runtimeAccounting` 只在没有可持久化 `runtimeSessionDigest` 时作为 fallback，覆盖 staged /晚绑定后的 Provider 失败；实际 nested accounting 存在时仍严格互斥。
3. `[已验证] G1-A 自动检查`：活动账本保留原始视觉去重键，持久化摘要只保存稳定 SHA-256 投影；owner 生命周期、staged failure fallback、nested /top-level 互斥、超长键与失败关闭已有现有运行事实测试覆盖。完整 `maintenance:validate` 36 项通过，包含业务边界审计、Main /Renderer 类型检查、Agent /UXP production build、Capability /Tool /入口文档审计和简化棘轮；`agent.ts` 基线从 12972 下调到 12964。
4. `[真机待验证] G1-A 运行记录`：重载当前 build 后跑一条普通 plan-neutral 请求，确认顶层 `runtimeAccounting.modelCallCount / modelDurationMs / promptShapeSamples` 有真实值；staged 仍只使用 `runtimeSession.accounting`，遥测不改变消息、Tool、预算、Stage、权限或完成结果。
5. `[待做] G1-B Provider phase timing`：独立补 Codex thread start /history inject /first progress /turn /repair /unsubscribe，只透传到现有每轮 accounting sample；不与 thread 复用、reasoning、object arguments 或请求级 Context span 同时修改。
6. `[待验证] 当前 HEAD 基线`：固定 commit /构建、Provider /模型 /reasoning、用户文本、项目素材 fingerprint、起始 PSD /history、Tool surface 与缓存状态；T1 文档内单步、T2 素材驱动 agentic、T3 尾部 Capability、T4 staged 生产、T5 本地项目检索分别建立冷 /热基线。
7. `[待做] G2-A Host Photoshop receipt`：只复用请求冻结时已取得的 document /history /layer 事实；不授予 Tool、不算 progress、不替代最终 UXP target guard。与其它性能优化分开 A/B。
8. `[待做] G2-B ProjectAssetSnapshot`：同 root 设置幂等、项目文件 revision 定向失效、context /list /search /recommend /contact-sheet 复用同一基础 snapshot；不把项目扫描宣传为分钟级延迟的唯一根因。
9. `[待做] G2-C 单次视觉消费`：`agentic` 使用 pixels-only 主 Agent 直看一次；`staged` 保留有明确结构消费者的 typed analyzer 并抑制同像素重复投递。不得同时修改候选数、分辨率、model effort 或 Recipe。
10. `[待做] G3 Craft 入口漂移`：先单独修复 D-070、当前 plan-neutral 代码与正式审计的漂移，只接现有 generic Recipe 紧凑索引；不同时扩 Recipe、Tool baseline 或 compose schema。
11. `[待做] G4 Craft 与执行编译`：先按错误类型量化 `composeDesign`，再验证只做机械格式规范化的 compiler；当前 subject-fit / compose / UXP 热纵切稳定并通过真实 Photoshop 验证后，才逐个增加最小 Recipe 或唯一 Runner 下的 compound transaction。
12. `[待做] G5 Capability 往返治理`：只对 owner 已知、唯一匹配或经数据证明高收益的小能力做受控 seed /续轮窄化；Capability 可见性不等于执行权限，不恢复全量 Tool 首轮。
13. `[条件后置] G6 Codex 订阅桥优化`：只有 G1-B 证明 thread start /inject、双重参数编码或 reasoning 漂移具有实际占比后，才分别 A/B thread 复用、object arguments 与 effort 透传；任何跨 Run 串线、取消污染或 schema 版本混用立即回滚。
14. `[发布门]` 每个切片必须同时满足：目标指标改善、核心 P90 不明显恶化、完成且有真实写入率和设计质量不退化、正确 document /layer /revision 与同目标读回 100% 通过、没有新增 Runtime /Context /事务 /权限 owner。真实性能结论使用配对实验，不使用跨版本总平均。
15. `[工作树边界]` 当前未提交热区仍在并行变化；G0 /G1 不修改 `composeDesign / subject-fit / tool-executor / agent-tool-execution-preflight / UXP place-transform`，不暂存、不回退、不覆盖、不把其结果计入本轮治理。

## 2026-08-21 当前主线：`MODEL-HARNESS-EFFECTIVENESS-001`

1. `[已完成]` 用 522 份真实 Run Record 建立有效表现基线；重点复盘 GPT-5.6 run 522 与非 Photoshop run 519 /520，不把模型、Provider、Harness 和 Skill 失败混为一类。
2. `[已完成]` 修复 Capability 控制面假失败：只读 search 不占 schema-load 轮次额度，只有精确 request 触发一次变更预算；按 family 的生产目录发现仍可达。
3. `[已完成]` 删除通用 Agent 的强制开场 Photoshop 观察；模型按需读取，Design Team 视觉阶段显式保留开场画布观察。
4. `[已完成]` 恢复有效硬上限与安全停机：`maxToolCalls` 真正生效；同一 Tool 连续 3 次已证实失败后不再执行；未知写入两次读回仍无法对账时保持写锁。
5. `[已完成]` 修复 confirmation Capability 半迁移，并把 Runtime /业务审计从旧 Prompt 全目录、旧原子拼图入口和旧单行上下文匹配迁移到当前生产不变量。
6. `[已完成]` 类型检查、正式构建与定向 Runtime 审计通过；完整 `maintenance:validate` 的 Harness /Runtime 失败已清零，首个阻断点是 3 条 SKU 自选备注文件事务冲突；补跑后置检查另有 4 条既有 Category Terms 基线 /扩张词债务。
7. `[真机待验证]` 重载最新 `dist`，用同模型同设置复放问候、系统审查和 SKU：检查 0 次无关开场 PS 调用、search→request→search 无假失败、首次有用动作延迟、重复观察、真实写入和完成结果。
8. `[独立治理]` SKU 文件事务必须同时保留可重跑体验与原子交付；不恢复「目标存在就失败」的旧暂存方案，也不把直接写正式目录当成已解决。

## 2026-08-21 当前主线：`TODAY-BOUNDARY-LANDING-001`

1. `[已完成]` 权力边界：Agent 选择下一步；Harness 只管能力真相、上下文、权限、任务身份、目标 /revision、事务、核验、预算和安全停机。
2. `[已完成]` 包边界：SKU /主图 /详情页业务方法与领域卡归 Skill；Photoshop /项目文件 /浏览器 /桌面 /命令归跨 Skill Tool Provider，Skill 只声明依赖。
3. `[已完成]` 交互能力修正：确认 capability → `askUserToChoose`，多字段草稿 → `createInteractiveCard`；SKU 两类 Provider 声明 owner 并受唯一注册校验。
4. `[已完成]` 电脑能力事实校准：浏览器已有生产 Provider；外部 MCP 仅有设置存储；通用桌面写入与命令执行未接安全生产链，界面不得宣称已可用。
5. `[已完成]` 定向测试、Main /Renderer 类型检查、Tool /Skill /Executor /Capability /Prompt 审计和 Agent production build 通过；编码检查通过。Runtime declaration 仍有既有 hard-budget 断言失败，业务边界仍是相同 7 条既有债务，本轮零新增。
6. `[下一纵切]` `COMPUTER-PROVIDER-AUTHORIZATION-001`：在现有 Capability Session /preflight 上实现任务级授权、范围、风险、批准、取消 /超时、脱敏和副作用读回，再依次开放桌面观察、文件操作、命令和桌面输入。
7. `[真机待验证]` 重载桌面端验证卡片同任务恢复、SKU 交互和浏览器 approval；电脑写能力在安全纵切完成前不做假 E2E。

## 2026-08-21 当前主线：`SKILL-INTERACTION-BOUNDARY-001`

1. `[已完成]` 卡片能力分层：通用 Agent 选择卡、通用多字段草稿卡、Skill 业务卡三类责任分开；Agent 不直接调用业务卡内部工具。
2. `[已完成]` SKU Provider 化：组合编辑与人工复核的 Renderer、校验、提交、记忆 /复核持久化迁入 Skill Provider；原拖拽、增删、排序体验保留。
3. `[已完成]` 通用层去 SKU：ChatPanel、通用卡片 Host、通用卡片 Tool executor 不再导入或特判 SKU 卡片；旧人工复核 action 仅由 Provider registry 做兼容映射。
4. `[已完成]` 沟通成本治理：选择卡最多 3 题 /每题 5 项，只有 material /high 的偏好、用户事实或授权可打断；auto 只代做有推荐的 preference，事实与授权仍等待用户。
5. `[已完成]` 稳定卡片面：关闭不可可靠提交的 `generic_confirmation`；短选择走 `askUserToChoose`，多字段草稿走 `editable_confirmation`，业务结构走 Skill Provider。
6. `[已完成]` 同任务恢复：选择卡和记录型可编辑卡不再作为普通用户消息重开任务，而是通过来源消息、作用域和 Runtime 身份结构化续接。
7. `[已完成]` 自动验证：纯逻辑 /边界测试、Main /Renderer 类型检查、生产构建、Tool registry、通用 executor、编码与差异检查通过；完整维护链在既有 7 条业务审计债务处停止，本轮零新增。
8. `[真机待验证]` 重载桌面端，检查 ask /auto、事实 /授权停顿、SKU 组合编辑、SKU 人审、可编辑草稿和同任务恢复的用户体验与额外轮次。

## 2026-08-21 当前主线：`AGENT-HARNESS-AUTHORITY-SUBTRACTION-002`

1. `[已完成]` 权力边界钉桩：Agent 负责目标理解、设计判断、动态计划、动作与恢复路线；Harness 负责事实、能力真相、权限、目标 /revision、事务、核验、预算和安全停机。
2. `[已完成]` 删除 Tool result 规划越权：移除 `required_tool_result`、整套 `AgentRecoveryQueue`、强制 no-call 与结果驱动 Tool allowlist；失败和未完成只作为事实返回。
3. `[已完成]` 删除隐藏调度：紧凑 E1 不再合成 workflow-owner Tool call，也不再把首轮工具面裁成 owner；staged 执行点只保留 Manifest /Stage /Capability /目标安全约束。
4. `[已完成]` 关闭提示词侧越权：Skill 模型投影不输出 nextAction /nextStep；通用 Tool 模型投影剥离内部 nextRequired /requiredTool /allowedToolNames；完成契约补救只列验收缺口，不点名 Tool、参数或步骤。
5. `[已完成]` 保持安全不退化：受保护文档、执行 preflight、目标 /revision、写入事务、unknown mutation 读回、交付回执和安全停机继续在执行点强制；Capability 可见性不等于授权。
6. `[已完成]` 代码卫生与防回潮：删除死 helper 与无消费者筛选器；控制分支 21 → 13，`agent.ts` 13,707 → 13,025；「Harness 接管下一轮 Tool 规划入口」静态基线为 0，并有 Skill /Tool 投影和紧凑 E1 行为断言。
7. `[已完成]` 自动验证：Main /Renderer 类型检查、Agent production build、Tool /Executor /Capability /Prompt /Planning /简化棘轮通过；正式核心预检在规划和仓库卫生后被既有未跟踪文档两处疑似乱码阻断，Runtime declaration 的 1 条 hard-budget 断言和业务边界 7 条 SKU /主图 /stage-context 债务保持既有失败，未制造假绿。
8. `[真机待验证]` 重启桌面端加载新 `dist`，在安全 Photoshop 副本对比同一任务的首次有效写入延迟、模型调用数、重复观察次数、workflow owner 可达性和完成且有真实写入率。静态通过不替代真机结论。

## 2026-08-21 当前收口：`AGENT-HARNESS-BOUNDARY-CLOSURE-001`

1. `[已完成]` 经验生产隔离：Evaluation finding、用户项目校准、参考学习候选分流；旧 v1 自动晋升记录安全迁移；生产消费者只读已发布 /已审核内容。
2. `[已完成]` Experience Publisher 接线：用户项目校准保留发布来源；参考图解读接入现有 Memory 人工审核队列，未审不可检索。
3. `[已完成]` Capability 渐进披露：search → 精确 request；中文自然语言检索；首轮聚合能力拆为叶子能力，工具面由 25 收到 13。
4. `[已完成]` 单一模型上下文预算：真实模型 window → 输出 /schema 预留 → Runtime Context /消息裁剪；unknown 不伪装成真实规格，关键内容放不下明确失败。
5. `[已完成]` Prompt 与设计流程减法：System Prompt 品类中立；七步、任务卡、Evaluation 按复杂度 /风险装载；开放创意不以方法表单或自动评审作写入门票。
6. `[已完成]` 设计纪律硬 /软分流：只阻断明确错目标、明确缺真实参考、未经授权的重复文档等确定错误；过程建议和审美复核不拦开放写入。
7. `[已完成]` 文档真相源、专项验证、Agent /UXP 生产构建与差异检查已收口；完整核心闸门被共享脏工作树中既有编码、SKU /Runtime 与品类词债务阻断，已逐项记录且未改断言制造假绿。
8. `[外部验收]` 有凭据时运行真实 Provider search→load；在安全 Photoshop 副本上验证开放设计体验和商业质量。两者不是本轮静态 /纯逻辑通过的同义词。

## 2026-08-17 路线图：`SELF-SUFFICIENT-DESIGN-HARNESS-001`（自助完成设计的 Agent Harness）

技术方案（落地 / 可行性 / 预期 / 风险，C 层）：`docs/design-craft-harness-technical-plan.md`——七步设计工作法 × 四层支撑（知识 / 引擎 / 证据 / 验收）作为骨架，症状按「第几步·哪一层」归位后做通用修复。

目标（用户拍板）：Agent 能**自助**完成设计任务——不靠人在旁边教、推、点；先「能做」再「做好」；审美要**可靠、稳定、好维护**（从成稿量出来，不靠对话教）；知识来源分工排队（模型知识=默认 / 我们的标准=校准 / Eagle 参考=例子 / 联网=查证；冲突取舍：标准 > 参考 > 模型常识 > 网上；产品事实只认用户与图上可见）。验收只认真机（`npm run debug:runs`），smoke 全绿不算数。

现状盘点（2026-08-17）：
- 循环 / 权限：设计路径宪法第一刀已落地（创意清单 agentic、观察预算提示化、proven-applied 写入不再逼读回、表单驳回可执行 + 上账本、预算抬升、棘轮扩容）；同日 run [470]/[471] 首次自然写入 5/8 层。剩：SKU 流水线四缝隙、「承接上一轮」注入替模型判断、能力可见性打地鼠、renderLayout 样式表单过重、视觉回合成本。
- 眼：像素进模型已通；缺 Harness 收尾自看；评审员几乎不开机（08-01 起 91 次有写入运行仅 2 次出评分卡）。
- 脑 / 知识：模型底子 + 方法论注册表 + Eagle（搜索框级）+ 联网（慢、不可信标记）；缺资料柜地图、抽屉级经验、模板抽屉接线；来源优先级未钉。
- 手：原子工具最小集够用；缺文字样式 / 蒙版 / 效果一批；布局引擎保留，内置审美配方已撤回。
- 记忆：Design Project State 骨架好（事实带来源与确认、规则、素材、文案、任务、版本、学习）内容稀；运行档案 + 续跑摘要有；已审核设计记忆 14 条；**缺店铺级标准档案、缺偏好、缺跨项目**。
- 上下文：context-manager 只裁剪不摘要（长任务会突然遗忘）；每轮重发全部历史；系统提示已稳定利于前缀缓存；工具面 baseline + 按需目录。

阶段（按复利排，每阶段有真机验收）：

**Phase 0（本周）— 宪法第一刀真机复测 + 收尾缝隙**
1. `[真机待验证]` 同一组提示复测：「帮我做 详情页」「帮我完成SKU编排」「看看这个淘宝链接」「帮我做主图」；口径：完成且有写入率、门禁拒绝占失败比、首次写入延迟。
2. `[待做]` SKU 四缝隙：自选备注子流程；缺模板时转 agentic 造模板再接回流水线；缺源文件改为问用户而非撞三次；staged 路径 `runtime_task_run_revision_reobserve_required` 跟上自身写入。
3. `[待做]`「承接上一轮任务」的注入改由模型判断新请求 / 续做；`audit:category-terms` 对无父提交仓库的处理。
4. `[已完成 2026-08-21，真机待验]` renderLayout 视觉样式：正式设计必须由 Agent 显式声明视觉样式、文字工艺参数、页面底色与占位色；Harness 不再用档位默认补视觉答案，缺项在写入前失败。`neutral_wireframe` 只用于显式结构预览。

**Phase 1（第 2–3 周）— 稳定审美 + 收尾自看**
1. `[待做]` 成稿 → 标准档案（自动、后台）：读项目 / 店铺已完成 PSD/PSB（现有 `analyzePsdDesignSource`），按交付物类型汇总成数据（画布规格、边距档位、主体占比区间、字号层级比、色板、每屏元素数、文案字数区间），存项目级 + 店铺级；无成稿的品类用通用底座并标明来源。
2. `[待做]` Harness 收尾自看：有写入的运行结束前系统自己读一次结构（含边界）+ 截一张画面（同一 history 版本），保证每次有写入运行都出评分卡；实现为循环外模块，不进 agent.ts 主体（棘轮）。
3. `[待做]` 量尺对比 + 两条硬规则：与标准逐项对比，越界 / 遮挡 / 文案功能词对不上产品观察为硬项要求改，比例 / 字号 / 边距偏离为「改哪里」提示；视觉评审员改可选、默认关。
4. `[待做]` 开工注入「本店标准」；四类知识来源标签 + 冲突优先级钉进上下文编译。
5. `[待做]` 评审建议进下一轮：创意路径不拦路的返工（≤2 轮，改不动即停并说明）。
验收：每次有写入运行 100% 出评分卡；文案功能词无来源 = 0；返工 ≤2 轮收敛。

**Phase 2（第 4–6 周）— 资料柜 + 可选参考 + 选图**
1. `[待做]` Eagle 资料柜地图（文件夹树 + 数量）开工注入；「一次看一个抽屉」拼版观察；抽屉级经验（带来源、未审核标候选、按抽屉批量审核）。
2. `[待做]` 模板抽屉接流水线：SKU / 主图 / 详情页模板从 Eagle 找 → 导入项目 → 开工。
3. `[已撤回并替换 2026-08-21，真机待验]` 内置配方架已删除：Eagle、项目成稿和用户模板只作为可选证据提供给 Agent，不再展开为 Harness 固定版式。renderLayout 只执行 Agent 显式 regions /blocks 与 visualStyle；运行记忆记录版面签名以提示雷同，但不自动改稿。
4. `[待做]` 选图：项目打开即后台索引（拍摄类型 / 主体占比位置 / 背景 / 清晰度 / 可支撑卖点）；任务里查表排序（客观层 + 用途层 + 偏好层：Eagle 星标 / 成稿里用过的原图）；模型只对最后 2–3 张取舍。
验收：做点击图档案里出现翻点击图抽屉；SKU 不再自造模板；首次写入延迟砍半；选图候选 <1s。

**Phase 3（第 6–8 周）— 记忆与上下文**
1. `[待做]` 上下文摘要压缩：旧回合摘要而非整段丢弃，长任务不遗忘目标与已做项；每轮重发成本可量下降。
2. `[待做]` 店铺级记忆（品牌 / 标准 / 偏好）跨项目继承；项目记忆按 generation 刷新照旧。
3. `[待做]`（可选）对话式整理 Eagle → 标签 / 标注写回（现有写回能力），非必需路径。
验收：20+ 轮任务不重复置入、不遗忘目标；单次运行 token 成本下降可量。

贯穿：宪法（新增拦截必答三问）、棘轮（agent.ts 行数 / 控制工具 / 拦截点只减不增、创意清单必须 agentic）、每周真机记分卡；新增能力走注册表 / manifest / 数据层，不进主循环。上限如实：数据与结构能到「稳、准、像你」的可靠中级设计师；「惊艳」不在承诺内。

---

## 2026-08-16 当前修复切片：`SKU-LAYOUT-DOCUMENT-SCOPE-001`

1. `[已完成]` 对真实 12:45 批次取证：组合卡与 continuation 正常，15 个组合和 3 个自选备注均真实进入 UXP 写入后 QA，最终 0 导出；源 SKU 与模板磁盘文件未被保存覆盖。
2. `[已完成]` 把 SKU resize / translate / cleanup 收成 document-scoped 写入：所有选择、变换、删除和读回绑定同一 `(documentId, layerId)`，禁止 `activeLayers[0]` 兜底。
3. `[已完成]` 修正占位符发现与几何预检：无受治理容器时单个数字设计组不再冒充槽位；合法连续 `1..N` 旧槽位仍兼容；区域需在画布内、互不重叠并满足顺序/间距语义；单个合法 `形状参考` 区域继续由算法拆槽。
4. `[已完成]` 增加 SKU 专用的空目录原子清理：主进程仅允许非递归删除 `SKU\\.designecho-staging`；非空、符号链接、路径歧义或任意其他目录均拒绝。
5. `[已完成]` UXP production build、Agent Main / Renderer typecheck、正式业务边界审计、Tool / Executor 审计及 `maintenance:preflight:core` 22 / 22 全部通过。
6. `[已完成]` 已生成 Agent production bundle、启动最新桌面端并重载 UXP；Photoshop 27.9.1 桥接 ready，pending request 为 0，dist 已包含结构化 cleanup failure 的外层批次终止逻辑。
7. `[真机待验证]` 用同一已验收模板复跑 2 / 3 / 4 双组合与自选备注，要求 18 个目标输出均来自同文档实际 bounds QA；自动验证通过不冒充真机交付通过。

---

## 2026-08-14 当前实施主线：`HARNESS-COMPLETION-OWNERSHIP-001`（治理：完成所有权前移）

状态：`diagnosis_complete / plan_approved_full / slice1_code_complete / slice2_execution_supply_reserve_code_complete / slice3_convergence_metrics_code_complete / slice4_ledger_extraction_code_complete / audit_matchers_synced_to_ledger / full_22_check_passed / slice5_live_probe_checklist_recorded / live_photoshop_e2e_pending`

1. `[已完成]` 证据级诊断：2026-08 共 217 次真实运行基线——`final_response` 92（42%）、零写入 144（66%）、completed 且零写入 37、**完成且真有写入仅 20（9%）**；观察调用占业务动作 80%。
2. `[已完成]` 代码根因：默认自主路径收尾时 `resolveUnfinishedExecutionObligation` 依赖 manifest 绑定的 `runtimeSession`；零业务动作停话直接吞成 `final_response`，完成契约只做事后注解。
3. `[已完成]` 切片 1（完成所有权前移）：零业务动作停话并入既有成品契约推回分支——写入已授权且契约明确缺失执行时，有界推回（≤2 次），推回耗尽诚实停止（`plan_execution_mismatch` + `completion_contract_unsatisfied_zero_progress`）；只拦确定没做到，不拦措辞；简化棘轮保持 21/21。
4. `[已完成]` 切片 2（执行供给预留）：已授权写入且尚无交付动作尝试时，工具预算尾部（固定上限 6 与预算 20% 取小）只放行 ≤2 次写入前观察，其余观察/检索转为执行指令（`agent_observation_budget_reserved`）；已有交付动作尝试后不设闸（写后读回与 unknown 现场确认始终放行）。授权口径单一 owner `hasAuthorizedMutationExpectation()`。
5. `[已完成]` 切片 3（收敛指标）：`debug:runs` 汇总新增「完成且有写入」率与真实写入/观察/业务动作计数；基线 20/217（9%）与 143 写入 vs 1484 观察（80%）已入档。
6. `[已完成]` 切片 4 批次 1（agent.ts 拆分）：预算账本（11 状态字段 + 耗尽/预留/复核/活跃时长纯函数）抽取为 `agent-runtime/performance-ledger.ts`（约 310 行新模块），agent.ts 13587 → 13473 行，薄包装注入运行态事实，行为零变化。静态审计文本断言随标识符改名同步迁移（business-boundaries 4 处、capability-resolver 1 处、runtime-declaration-resolver 行为测试 1 处、tool-registry 负向正则 1 处），语义与失败条件不变（D-083）。
7. `[已完成]` 切片 5 制度化（文档侧）：真机验证清单写入 CurrentTask（零写入推回 / 预留区转执行 / 写后读回开闸 / 收敛指标对照），待用户执行后回填。
8. `[真机待验证]` 安全一次性文档上验证「零写入被推回」「预留区观察转执行指令」与「推回后完成闭环」，未验证不写完成。

---

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

## 2026-08-24 `RUNTIME-INTERACTIVE-REENTRY-001`

目标：确认卡消费后继续同一 TaskRun，让 Agent 在 Photoshop 中基于当前真实 document /revision 接管后续判断；Harness 只维护身份、单写者、效果收据、未知状态和交付安全，不替 Agent 选择设计方案。

1. `[已完成]` 交互 checkpoint 两阶段 reserve /adopt；重复请求不得抢占或释放现有 writer。
2. `[已完成]` post-Skill 异常、settlement unknown 与 Agent 初始化失败统一保存 `pendingReentry`；重试只恢复 Agent，不重放 Skill。
3. `[已完成]` Runtime-owned 完整原子 Tool ledger 与全 lineage Skill effect receipt；Executor 自报可见数组不再证明零写入，旧 generation 收据不可复用。
4. `[已完成]` 文档绑定外的 `sideEffectState=unknown` 同时进入 Tool gate、Completion 与 Artifact hold；有文档对账只消费绑定 observationKey、Host revision、呈现回合和 Provider 消费回合的 Runtime-owned 视觉回执，像素残留、普通元数据、同回合预读与预算跳过均不能解锁。
5. `[已完成]` 连续确认卡复用同一 Session /run /generation /TaskRun 并原子换代 interaction checkpoint；post-Skill staging /commit /settlement 异常统一转为 checkpoint recovery + 持久化 operation unknown，不新增业务专属 Runtime 分支，也不释放未知副作用的 writer。
6. `[待真实运行]` 在加载最新 Renderer 的 DesignEcho 中完成普通一句话设计任务与至少一次连续卡片确认：记录同一 taskRunId、Skill 只执行一次、post-Skill Photoshop revision、Agent 后续真实写入与同目标读回。
7. `[待持久化纵切]` 将 active checkpoint /pending reentry 纳入正式 RuntimeSession 持久化 owner，覆盖 Renderer 重载；在此之前只允许安全失败，不伪造跨重载恢复。

自动验收入口：`npm run maintenance:validate`。退出条件仍要求真实 Provider → Photoshop 写入、同目标读回与人工视觉复核；自动审计只证明代码和治理边界。

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
