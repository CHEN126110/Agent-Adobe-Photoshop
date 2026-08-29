# 2026-08-03 DESIGN-HARNESS-VERTICAL-CONVERGENCE-001 / 当前状态

本文件只记录当前事实摘要。历史实施日志由 Git 承担；不能从历史日志反推当前完成度。

## 2026-08-29 D-104 依赖独立安装与安全债务分流

- Anthropic peer 迁移已经以祖先提交 `5c1bc06d` 独立存在，只修改 Agent package /lock；当前主链不再合并旧 `@anthropic-ai/sdk ^0.30.0`，实际安装为 SDK `0.122.0`、Claude Agent SDK `0.3.241` 与 Zod `4.4.3`，满足 `>=0.93.0 / ^4.0.0` peer。
- D-104 从 `a335ca41` 建立无 `node_modules` junction 的新工作树。Agent /UXP 分别完成真实 `npm ci`；Windows 对 macOS-only optional `dmg-license` 的一次 EPERM 清理留下无 package 的空目录，经 `npm prune --ignore-scripts` 删除后，两仓 `npm ls --all` 均 exit 0、0 problems。
- 仓库自有依赖预检在独立安装上报告 Agent 636/636、UXP 148/148，直接 CLI 23 /4；Agent production build、preload sandbox、Renderer build、UXP 全测试 /类型检查 /production build 和唯一一次完整 `maintenance:validate` 60/60 通过。package /lock 与源码均未修改。
- 提交前复核确认两仓 `npm ls --all` 仍为 0 problems，`git diff -- package.json package-lock.json src` 为空，规划、JSON、UTF-8、入口文档、变更边界与 diff 检查通过；D-104 只有五份项目记忆进入独立状态提交。
- `openai 4.104.0` 的可选 Zod peer 仍是 v3，当前 override 把它绑定到根 Zod 4；项目未使用 OpenAI Zod helper，现有构建通过，但该 seam 不属于理想终态。OpenAI v6 已正式支持 Zod 4，却要求 Node 20+；Electron 28.3.3 内置 Node 18.18.2 且已 EOL，因此必须先独立升级 Electron Runtime，不能只抬 OpenAI 版本。
- 2026-08-29 动态 `npm audit` 报告 Agent 40 项（2 low /5 moderate /30 high /3 critical）和 UXP 7 项（2 moderate /5 high）。这不推翻当前 lock 可安装事实，但证明依赖安全尚未收口；Electron /builder、Volcengine /axios /protobuf、sharp /ws、Vite /PostCSS /UXP 构建链将分片治理，未执行 `audit fix` 或 `--force`。
- 项目正式模型选择保持 DeepSeek `deepseek-v4-flash-vision-exp`；D-104 没有改模型目录、Provider、Prompt、工具、权限、预算或 Photoshop 行为。默认端口仍由 PID 16228 的普通 dirty Runtime 占用，活动 `1200.psb` 未被触碰。

## 2026-08-29 D-103 SKU 姿态统一三片集成

- D-103 从 D-102 `a262a4f8` 建立独立 worktree，保持三份因果与回滚边界：`c8793b1d` 只引入纯离线算法与 `sku-pose-alignment-report/v1`，`5ff69b19` 引入精确 document /history /layer 的版本化单事务 Provider，`2d4924d0` 迁移真实 WebView 与批处理协调器。旧姿态分支的项目记忆和过时依赖声明没有进入当前链。
- 离线层不读取文件、不访问网络 /Photoshop、不注册 Agent Tool；中等弯曲、确定性、直袜 /零强度 no-op、袜口锁定、复杂 S 形、贴边防裁切和非法像素 /参数均由可复用测试覆盖。机械质量不通过时返回原像素，不能下发写入。
- Provider 用未裁边 RAW RGBA 与明确 source bounds 构建透明安全工作画布；所有 no-op /质量拒绝发生在写前，通过后只调用一次内部 `applySkuPoseAlignment`，唯一 mutation owner 是 `PhotoshopTransactionRunner`。成功需要捕获、Provider、mutation 与同目标读回收据；两个内部原子工具不在普通 Agent Tool 面。
- 面板不再展示未进入 Provider 的参考形状、款式、内容保护、平滑度、分区、执行步骤或模拟进度，只保留批量图层、显式强度和袜口保护。整批绑定加载时 documentId，逐层读取最新 revision；切换文档、未知 mutation 或网络异常停止后续层，已证明零写入的拒绝可继续。
- 当前依赖树 Agent 636/636、UXP 148/148；算法 /Provider /面板专项、UXP 全测试、181 Tool 审计、设计作者权、业务 /Executor /语义 dispatch /变更边界、Main 构建、Renderer 类型检查、Agent /UXP production build 与唯一一次完整 `maintenance:validate` 60/60 均通过。该结论只覆盖代码和工程验证，不覆盖 exact D-103 Photoshop 或商业质量。
- 最终移植审查确认原姿态范围共 36 个文件，其中 27 个无需 owner 合并的功能文件与原分支逐字节一致；其余 9 个重叠文件只在当前依赖、核心阶段、MCP Host、WebView 和项目记忆 owner 处合并。三份功能提交与独立状态提交保持分离，未发现冲突标记或未分类变更。
- 原分支在隔离 Photoshop 文档 `4180 /4187 /4194` 连续完成三次合成曲袜 Provider E2E，均为 source layer 3 → output layer 4，中心线弯曲降低约 83.9%，袜口漂移约 0.04%，并取得 history 前进、可见性和恢复读回。该证据属于原提交，只证明几何 /事务闭环，不是 D-103 exact build、面板按钮或商业设计质量证据。
- 原分支真实 UXP 面板壳曾加载，但自动化无法向 `msedgewebview2.exe` 子窗口送达点击，因此 UXP→Main→UXP 按钮链仍未验证；没有通过隐藏 postMessage、猜坐标或产品旁路伪造成功。
- C-1256 8 张代表图、跨商品 36 + 48 张确定性抽样与 C-1024 六张原图都没有提供“单只完整主体 + 自然中等弯曲 + 袜口 /图案清晰”的固定商业样本。当前结论是 `real_product_applicability_unproven`，不是算法失败，也不是质量通过。
- 用户普通 DesignEcho PID 48836 仍占用默认端口，当前 Host identity 不可验证；Photoshop 有 5 个文档且活动对象为外部 Eagle 素材。D-103 没有加载、停止或替换该运行时，也没有保存、关闭、丢弃或修改任何 Photoshop 文档；D-097 继续作为 r32 /r33 单变量基线。

## 2026-08-29 D-102 语义抠图能力集成到 D-101 当前主链

- 原 `0c404cda` 分支已完成一次 `DSC08187.jpg` 双袜固定 Photoshop E2E，证明语义检测、Agent 正负点实例引导、MobileSAM /BiRefNet、二进制 mask 写入、history `4091→4092` 和 `user-mask-enabled` 读回可以闭合；该证据不自动覆盖新集成提交。
- D-102 从 D-101 `c0b358fb` 建立独立 worktree，逐提交移植 MCP 完整工作流、目标实例绑定、scope owner、Provider sourceBounds 和 synchronous batchPlay 读回修复。D-097 未改变，仍是 r32 /r33 单变量基线。
- 旧语义分支的 `@anthropic-ai/sdk ^0.30.0` 与 Claude Agent SDK peer 冲突；没有用 `--force` 或兼容兜底修 lock。D-102 复用当前主链 `^0.122.0`，依赖预检 Agent 636/636、UXP 148/148 通过。
- D-102 专项语义契约、SAM、Photoshop workflow dispatch、设计作者权、181 Tool 注册、Main /Renderer 类型检查、Agent /UXP production build、业务 /Runtime /Capability /Skill /Executor /Handler 审计和唯一一次完整 `maintenance:validate` 59/59 均通过。
- 原语义分支 18 个未与 D-101 重叠的功能文件在 D-102 中逐字节一致；11 个重叠文件按当前 owner 合并，旧项目记忆未进入，HEAD 无冲突标记，提交范围为 25 个功能文件。该工程证据仍不能替代 D-102 exact build 的真实 Photoshop canary。
- 当前用户 DesignEcho /Photoshop 未加载 D-102；默认端口仍由 PID 48836 占用，Host identity 不可验证，5 个文档中 4 个 dirty。本切片没有执行 Photoshop Tool 或修改画面，D-102 exact build 的固定真机复验仍为未验证。

## 2026-08-29 D-101 Provider 流式阶段与请求负载观测

- r32 普通重发的模型总耗时、token、Prompt 体量已经可见，但仍无法拆分请求准备、流建立、首块、首语义和持续输出。D-101 复用现有 physical transport attempt 与 Runtime Accounting，不新增 tracing Store、Span Runtime 或性能 Gate。
- Main 只对当前正式路径使用的 OpenAI-compatible 成功流采集 `serializedRequestBytes / imageDataUrlBytes / adapterFormatMs / payloadMeasurementMs / streamOpenMs / firstChunkMs / firstSemanticDeltaMs / completedMs`；非流式、fallback 和失败路径保持 unknown。
- 共享边界拒绝非安全整数、图像字节大于总请求、非单调时间和任何未知字段。Runtime digest 不保存 Prompt、Tool schema、图片、响应、Header、Key、URL 或错误正文；指标也不进入 Agent Prompt、预算、路由、权限、质量或完成判断。
- 现有设计作者权与运行事实测试已覆盖合法投影、时间乱序、未知字段 /原始载荷、深拷贝和持久化篡改；Main /Renderer 类型检查、简化棘轮、Runtime 与业务边界审计、变更边界均通过。编译产物假 DeepSeek 流同时证明 Tool call、usage、cache hit / miss 和新阶段指标可以共同闭合。
- Agent /UXP production build、完整 `maintenance:validate` 58/58、最终差异审查和独立代码提交均已完成。提交后最小真实 DeepSeek 双请求取得 2/2 usage 与 transport 覆盖：两次请求均为 582 bytes、313 input /53 output；冷请求 cache 0/313、首语义 544ms、完成 872ms，第二次 cache hit 256 /miss 57、首语义 469ms、完成 765ms。该 micro-canary 证明真实 Provider 协议和指标接线，不证明完整 Agent 性能或稳定提速。
- 最新实时只读现场为：默认 8765–8769 仍由用户普通 DesignEcho PID 48836 占用；Host build identity 不可验证；UXP 为 clean D-096；Photoshop 有 5 个文档且 4 个 dirty，活动文档是外部 Eagle 素材。本切片没有启动、停止、替换应用或写入 Photoshop；真实 Provider canary 未执行返回的 Tool call。

## 2026-08-29 D-100 电商单画布设计知识候选研究

- 现有 Design Kernel / Artifact Knowledge / Craft Recipe / Evaluation 已覆盖通用信息层级、缩略图、商品真实性和素材融合。D-100 没有重写这些内容，而是以来源强度和失效条件做差异审查，避免继续堆泛化设计原则。
- W3C CLReq、WCAG 2.2、Figma Layout Guides、Carbon Typography、Adobe compositing、Shopify 商品摄影和 Baymard 商品列表研究已按 standard /standards note /research fact /vendor guidance 分级。只有中文标题断行、商品照片表达模式/合成一致性、目标变体缩略图显著性形成未发布候选。
- 本轮只读观察了 r32 JPG、Eagle `LAKLHIYBNKNWN / LAKLE0ETHZ6AF / MK6GJVHBBCK6F` 与用户 `C-1204 / C-1105` 成稿。可迁移的是穿着/细节证据、紧凑标题组、明确的摄影关系和目标款识别；原素材、文案、坐标和品牌风格不得照抄。
- 首个可执行 A/B 已冻结为 `main-image-c1105-airy-ruffle-unseen-v1`：Fixture 排除用户成稿、PSD、SKU、模板、TM、Eagle 和研究文档；B0/B1 同 DeepSeek、预算、Tool surface 与素材 digest，B1 只加入 C-02。研究完成不代表候选有效，真实 Photoshop canary、多 Case 重复和盲评均待完成。
- D-100 仅新增 D 层研究文档与项目状态投影，没有修改生产 Prompt、Knowledge、Recipe、Evaluation、权限、Tool 或 Photoshop；默认端口仍由用户普通 DesignEcho 占用。
- `git diff --check`、文档治理/规划、project-state JSON、入口同步、变更边界、Node 语法与 UTF-8 检查均通过，最终差异审查和独立提交已完成；按文档-only 规则没有重复运行无关 58 项核心闸门。

## 2026-08-29 D-099 DeepSeek 缓存事实进入 Runtime Accounting

- r32 普通重发的 262 万 input token 暴露了完整历史、Tool schema 和重复观察成本，但旧账本无法判断 DeepSeek 上下文缓存真实命中情况。D-099 只补官方 cache hit / miss 观测，不修改模型、Prompt、工具、预算、权限、价格或 Photoshop 行为。
- 官方流式协议要求 `stream_options.include_usage=true`，并通过 `choices=[]` 的独立尾块返回 usage。现有工具流既未请求该尾块，又会在缺少 delta 时提前跳过；两个断点均已在 Provider 请求 /解析点修复。
- 共享 usage 投影只接受 DeepSeek 完整、非负安全整数且 `hit + miss = inputTokens` 的数据。缺失、单边、矛盾或其他 Provider 的同名字段保持 unknown；Runtime digest 和 `debug:runs` 只在真实上报时显示命中率及调用覆盖率。
- 现有设计作者权与运行事实测试已覆盖完整、部分、矛盾、跨 Provider 冒充和持久化篡改；Main /Renderer 类型检查、Agent /UXP production build、完整 `maintenance:validate` 58/58、最终差异审查和独立提交均已完成。第一次核心运行被 `agent.ts` 行数棘轮拦截后，没有调高基线，而是复用已有类型导入使主循环恢复 12,826 行；随后完整 58 阶段通过。
- 真实 DeepSeek 热 /冷命中率采集仍待完成，当前不能宣称缓存提高了速度；D-099 只把后续性能决策所需的 Provider 事实变成可查询证据。
- 本切片来自 D-098 独立 worktree，没有启动或替换 DesignEcho，也没有连接、保存、关闭、丢弃或修改 Photoshop 文档；D-097 继续承担 r32 reconciliation / r33 单变量真机验证。

## 2026-08-29 D-098 未发布经验与模型伪校准退出生产 Evaluation

- 当前代码审计证实两条发布旁路：自动晋升的 provisional evaluation finding 会由专用 helper 注入 `evaluateDesign`，且模型可见 Tool schema 允许直接传入 `calibration`。两者都绕过了当前唯一 Experience Publisher /项目校准发布边界。
- D-098 删除 provisional 生产读取 helper、executor 注入和 Prompt 字段，同时删除模型可见 `evaluateDesign.calibration` 与参数解析。候选累计、provisional 策展、否决回退、人工 /离线送审以及正式 `recordDesignVerdict → published evaluation_calibration` 路径保持不变。
- 现有学习候选专项新增攻击断言：试用状态继续存在但不进入生产，模块不再导出旁路，旧参数不能污染 Prompt，生产源码不读该字段，Tool schema 也不允许模型伪造用户校准。专项、设计作者权、Tool 注册、Main /Renderer 类型检查、Agent /UXP production build、唯一一次完整 `maintenance:validate` 58/58、最终差异审查与独立提交均已完成。
- 本切片在 D-097 提交上独立开发，没有启动或替换 DesignEcho、没有连接 Photoshop、没有修改 r32/r33 fixture。代码绿色只证明发布边界收口，不证明设计质量提高。

## 2026-08-29 D-097 DeepSeek Final Judge 完整终态代码收口

- r32 普通重发的最后一次模型调用是 3 图、0 Tool 的 Final Judge：输入 3,907、输出恰好 4,320 tokens、耗时 40,205ms；12 项断言的代码预算也恰好是 4,320。Provider accounting 无调用失败，但协议最终为 `judge_unavailable`、质量覆盖 0/12。原始 `finish_reason` 没有进入 RunRecord，因此当前把隐藏思考触发 `max_tokens` 视为最强可证伪解释，不冒充真机已证实。
- 当前代码只对 Codex 订阅 Final Judge 要求视觉出站回执，DeepSeek 是 optional；D-097 没有扩展回执协议。生产改动只让固定 JSON、无 Tool 的 Final Judge 与 diagnosis-only repair 显式传 `thinkingEnabled=false`，主 Agent 的模型思考设置、设计判断、Tool 权限和 Photoshop 事务均未改变。
- 回归证明 12 项 Judge 仍使用 4,320 token，DeepSeek adapter 将请求序列化为 `thinking:{type:'disabled'}` 且不残留 `reasoning_effort=high`；`end_turn`、同 history、ReviewSet、Codex 回执和残缺输出失败关闭全部保留。
- `audit:runtime-declaration`、Main /Renderer 类型检查、Agent production build、规划 /变更边界 /入口文档审计、完整 `maintenance:validate` 58/58 与独立提交已完成。第一次核心命令只在依赖预检发现隔离 UXP 缺 `node_modules` junction，未进入核心阶段；补齐与主工作区 lock 一致的依赖入口并单独通过完整性检查后，唯一一次真实 58 阶段运行完整通过。
- 本切片没有启动、停止或替换用户普通 DesignEcho，也没有连接、保存、关闭、丢弃或修改 Photoshop 文档。r33 仍需真实 DeepSeek + Photoshop 证明 Judge 取得完整终态，代码绿色不等于真机成功或商业质量达标。

## 2026-08-29 D-096 正式采集 Runtime 租约与 r32 普通重发归因

- r32 失败 Attempt 后的第二 Run 已按对话存储、RunRecord 和代码入口重新归因：同 conversationId、不同 branchId；branchId 只有编辑已发送用户消息时才更换。正式 Attempt 在 `05:07:17.986Z` 终止，第二 Run 约 25 秒后启动；同期 Codex 仅做页面文本读取。该 Run 是新的显式顶层重发，不是 Reflexion /Debug guard 逃逸，因此没有新增 generation Gate。
- 普通重发 Run `run-20260829051822-b6f8c117-e4c2` 使用 DeepSeek V4 Flash Vision，32 次模型调用、38 次 Tool Call、2,619,699 input tokens、57,939 output tokens、约 639 秒总耗时；9 次成功 mutation，生成 PSD 31,987,098 字节与 JPG 942,389 字节。它脱离正式 Attempt，不能计入技术成功或零人工分母。
- 真实 JPG 的基础层级和可读性成立，但商业视觉未达标：原始平铺摄影以大矩形嵌入，四色商品稀释粉咖主焦点，底部三个大胶囊卖点争抢注意力，照片 /背景缺少空间融合。与固定 Eagle 的手持近景、穿着主视觉和场景化搭配锚点相比，主体塑造、卖点证明、质感和缩略图点击力均较弱。
- r32 的 UXP 漂移根因独立成立：官方 loader 没有跨 worktree 互斥；三处 binding 只能在提交 /首次写 /完成时发现漂移。D-096 新增仓库外单一开发租约，`formal_capture` 与 `uxp_loader` 在 UDT mutation 前竞争；`run-live` 在任何 Attempt Event 前取得租约并复验完整 binding。
- 专项验证已通过：并发 loader 被结构化拒绝；错误 leaseId 不能释放；存活 owner 即使 TTL 到点也不能被删除；死亡 owner 可回收；旧 owner 不能删除新 owner。loader self-test 和真实双进程拒绝 canary 均通过，canary 在连接 UDT 前结束且 Photoshop 零 mutation。相邻审计、Main /Renderer 类型检查、Agent /UXP production build、完整核心闸门 58/58、独立提交和提交后 clean identity 均已完成。
- 当前 r32 fixture 设计文档已经关闭，账本仍保持 `submission_unknown_write_state`；没有自动保存、关闭、丢弃或移动任何文档 /证据。用户启动的普通 DesignEcho 当前占用默认端口且未绑定 r32，待其自然释放后再以 clean Debug Runtime 做合法 reconciliation，r33 仍必须在对账后开始。

## 2026-08-29 D-095 无副作用首写拒绝恢复与 r32 失败病历

- D-094 已形成干净提交 `eb40a93c`，提交后 Agent /UXP production identity 匹配。r32 在真实未保存 `800` 保持打开时通过 read-only preflight，证明 `documentId/historyStateId` 前置对象隔离可以在真机建立。
- r32 Attempt `main-image-pink-coffee-unseen-v1-attempt-20260829045547-706e60bd6c2e` / Run `run-20260829050717-b6f8c117-8f2a` 使用 DeepSeek 官方 `deepseek-v4-flash-vision-exp`，最终失败：23 iterations、24 次模型调用、21 次 Tool Call、1,764,991 input tokens、67,813 output tokens、649,831 ms 模型耗时、689,034 ms 总耗时。
- 首个写尝试 `placeImage` 在 Photoshop dispatch 前被 `first_mutation_must_create_task_document` 拒绝。模型下一轮已经改用 `createDocument`，但 baseline 的 blocked 状态不可恢复，5 次 `createDocument` 与 2 次 `composeDesign` 继续失败；RunRecord 证明 8 次 mutation 尝试均 `mutationObserved=false`、成功 mutation 为 0，因此用户 `800` 的 revision 变化不是本 Run 写入。
- 运行期间外部又打开 `E:\WERKE\C-1258\PSD\详情页.psb`，并把 UXP 从 clean D-094 build 切换到旧 `de628ade...-dirty`；Debug Bridge 在完成态按 runtime binding 失败关闭，Attempt 记录 `submission_unknown_write_state`。该失败不能重放，也不能计入设计质量。
- D-095 已在独立提交 `d8ce40ef` 实现：只有纯工具选择错误可以返回 pending 并要求下一次重新检查；Runtime /文档事实错误仍永久 blocked。攻击用例已证明 `placeImage → createDocument` 可恢复，以及两次之间 revision 漂移继续永久阻断；Design Reliability 专项、相邻审计、Main /Renderer 类型检查、Agent /UXP production build 和完整核心闸门 58/58 已通过，r33 真机待完成。

## 2026-08-29 D-094 未保存前置文档的 TaskRun 对象隔离

- r32 fixture 已以全新实例 `fixture-20260829040410-92601cced5ad` 准备完成，输入 digest 与锁定 Case 一致且没有旧输出。当前真实模型已按用户要求切换为 DeepSeek 官方 `deepseek-v4-flash-vision-exp`；正常配置中的官方 Key 未丢失，内置 Key 连通性、真实 Agent 图像输入和结构化 Tool Call 探针均通过。
- Photoshop 当前保留真实未保存 `800` 与路径明确 dirty `DSC08212.jpg`。`800` 包含“转化图 /点击图”等 13 层真实结构，不能为 benchmark 擅自保存、关闭或丢弃。D-093 的剩余限制是把缺少磁盘路径等同于归属未知，导致 r32 无法提交。
- D-094 沿用同一个 `guarded-photoshop-execution-baseline`：UXP `listDocuments` 默认返回每个打开文档的 `documentId/historyStateId`；提交前已有且 revision 可读的未保存文档被定义为受保护 TaskRun 前置对象，不获得任何写入、保存或关闭权限。
- 从零创作正式 Case 的首个 Photoshop mutation 现在必须是 `createDocument`。首次写入前与任务完成时都重新读取完整文档集合；前置对象缺失、名称 /路径状态 /dirty 状态变化、revision 变化、新外部文档出现、缺少 revision 或先打开 fixture 输入文档都会失败关闭。完成结果沿用同一 baseline receipt v2，并进入 Debug submit receipt v4 和脱敏持久化证明摘要。
- 已通过 Design Reliability 专项、Main /Renderer 类型检查、UXP 类型检查、181 工具注册审计、设计作者权、UXP 行为测试、PhotoshopTransactionRunner 唯一 owner 审计、Agent /UXP production build 和完整 `maintenance:validate` 58/58。独立提交、提交后 Runtime identity 和 r32 真机尚未完成，不能宣称 D-094 或 r32 已完成。

## 2026-08-29 r31 首个零人工技术成功与 D-093 对象级文档隔离

- `972baf75` 已补齐终局质量 Host 调用预算，`a56d62c1` 已阻止 Suite loader 把内部 locator 注入 Case /Rubric，`8ccda924` 已让 Main 对请求绑定的 UI 交互收据重新验签；三次提交均已推送，提交时完整核心闸门 58/58、Agent /UXP production build 与提交后双 Runtime identity 均通过。
- r31 Attempt `main-image-pink-coffee-unseen-v1-attempt-20260829030300-d3e055211c70` / Run `main-image-pink-coffee-unseen-v1-run-20260829031200-b6f8c117-9e00` 是首个同时取得正式技术交付和 `userInterventionCount=0` 收据的样本：15 项机器检查通过、Harness 写入 0、5 次真实 model-owned mutation、19 次模型调用、26 次 Tool Call、约 8 分 59 秒完成。
- r31 PSD 为 16,087,874 字节、SHA-256 `c6a5de30afceecbffffa3ea316e81f49dfb311a20d3de4b6fb4b0094145cd6d4`；JPG 为 889,003 字节、SHA-256 `5930817666232cc4412195850e4d418fa0f171c3bc70cc1e2654e5b25408afc2`。Final Judge 为 85 / `needs_review`：结果可用但鞋体权重、副文案缩略可读性和完整色系表达仍弱；当前官方 cohort 只有 1/5 Case、1 次重复，不能宣称稳定成功率或专业质量达标。
- r31 返回后的活动文档仍是同一路径，但现为 `dirty`、history `164:345`，画面与终态 JPG 不同；磁盘 PSD/JPG 摘要保持 r31 终态 history `164:197` 的原值。变化发生在终态之后且来源无法归属，系统没有自动保存、关闭或丢弃，也不能把未知外部变化倒算为 Agent 失败。
- D-093 已将正式 Debug 协议升级到 `debug-bridge-chat-submit-receipt/v3`，首次写入基线升级到 v1：提交时冻结文档对象，允许路径明确的 fixture 外部 dirty 文档保留；普通写入不能作用于外部活动文档，`createDocument` 可建立新目标，同请求后打开的 fixture 活动文档可承接写入。路径未知、提交时已有 fixture 文档或后来新开的外部文档继续 fail closed。
- D-093 的 Design Reliability 专项行为验证、完整 `maintenance:validate` 58/58、Agent /UXP production build、`git diff --check` 与独立 Git 提交已完成；r32 外部 dirty 文档共存真机尚未完成，远端发布状态由 Git 记录。

## 2026-08-29 D-092 文档事实与 reconciliation 范围收敛

- 用户指出无关 `SKU.psb` 不应成为全局阻塞。现有产品能力并非完全不知道环境：`listDocuments` 已读取文档路径，Renderer 已计算 `projectAffinity` 与文档性质，Operating Context 也会把完整清单交给模型。真实缺口是没有区分“文档有文件路径”和“文件自上次保存后又被修改”，而开发 reconciliation 又绕过上述事实，只检查打开文档数量。
- D-092 新增 `editState=clean|dirty|unknown`：UXP 从官方 `Document.saved` 属性读取，`getDocumentInfo` 与 `listDocuments` 都返回；`pathState` 继续只表达本地路径是否存在。Renderer 兼容旧 Provider 结果并默认 unknown，把 editState、路径和项目归属共同放进 Operating Context，同时明确 dirty 不是 TaskRun 所有权、保存授权或关闭授权。
- D-092 当时先把 reconciliation 改为 `no_fixture_documents`：路径明确且在原 fixture 外的用户文档不阻塞；路径未知 /未保存文档和原 fixture 内文档仍阻断。正式 Attempt 残留的 `none_open` 已由后续 D-093 收敛为对象级写前隔离。对账还要求 Photoshop Runtime 在异常后重新加载，与 Agent Runtime 重启、0 pending 和原项目绑定共同闭合未知写状态。
- 专项回归、完整 `maintenance:validate` 58/58、Agent /UXP production build、提交 `3532985b`、GitHub 推送和提交后 clean Runtime identity 均已通过。真机临时文档依次返回 `unsaved /clean`、`saved /clean`、`saved /dirty`，证明路径和保存后修改是独立事实；文档已按 ID 关闭，Photoshop 回到 0 文档。
- r26 已在 dirty 外部临时文档仍打开时完成 reconciliation；正式事件记录 Agent /Photoshop Runtime 均在异常后重启、0 pending、原 fixture 文档 0、外部文档 1、所有权已解析。Design Reliability 账本现为 6 次 submission、6 次 terminal、0 次未闭合、0 条写状态未清账。r26 没有 Run /产物，仍不能计为技术成功。
- 探针 PSD 为 27,302 字节，终端安全策略拒绝直接删除后仍留在系统 Temp 的 `designecho-document-state-probe-3532985b` 目录；它不属于用户项目、运行证据目录或 Git 工作树。

## 2026-08-29 r26 外部执行环境中断：已提交但无终态

- D-091 已以 `1a3f95d3` 提交并推送；提交后 Agent build `designecho-1a3f95d3d1a7-63de096427d3` 与 UXP build `designecho-uxp-production-1a3f95d3d1a7-be4ae879ddb5` 均为同一干净提交。r26 全新 fixture、GPT-5.6 Sol、真实 Photoshop、1440×1440、0 文档 /0 pending 写前预检全部通过。
- r26 Agent 在中断前完成候选总览视觉观察，自主选择 A01 穿着素材并说明木耳边、袜筒纹理和鞋袜关系更适合缩略图识别，计划使用满版主视觉与左侧短文案；当时 UI 仍在下一轮模型思考，没有创建 Photoshop 文档、Run Record 或交付文件。
- Codex 执行回合被外部中断后，原 CLI 句柄、干净 Runtime 与原 Photoshop 进程均已退出。Attempt `main-image-pink-coffee-unseen-v1-attempt-20260828225315-864c4e8f021f` 只有 `armed` 和 `submission_started`；r26 项目除允许的 `.designecho/project.json` 外仍只有 68 个输入文件。
- 随后用户通过桌面启动脚本运行了主工作区旧 /脏 Runtime（commit `de628ade`），并在 08:46 新 Photoshop 进程中打开 `SKU.psb`。该会话不是 r26 现场；本轮没有重载其 UXP、关闭 SKU 文档、停止进程或发送任何 Agent 消息。
- r26 中断后账本曾为 6 次 submission、5 次 terminal、1 次未闭合、1 条写状态未清账；不能把它计为 D-091 失败。D-092 已在 clean Agent /UXP 重启、0 pending、原 fixture 文档 0、外部 dirty 文档 1 且路径所有权已解析的条件下完成 reconciliation；当前账本为 6 次 submission、6 次 terminal、0 次未闭合、0 条未清账。
- r26 fixture 已消耗，只允许 reconciliation，不得复用。下一次正式样本必须从锁定源创建全新 r27 fixture。

## 2026-08-29 r25 正确终审后的 JPG revision 收据缺口

- D-090 已以 `1521c504` 提交并推送；提交后 Agent build `designecho-1521c5046227-63de096427d3`、UXP build `designecho-uxp-production-1521c5046227-cdcad214d92e` 与运行时身份均为同一干净提交。r25 使用真实 GPT-5.6 Sol /Photoshop、全新 fixture、同一句自然需求和 1440×1440 画布完成 12 次模型调用、13 次 Tool Call、4 次成功内容 /文件 mutation。
- r25 自动追加的终审 `getCanvasSnapshot` 不带 `region`，Final Judge 实际看到了 `4428:4472` 完整画布；对副文案偏淡偏小、四色辅助图偏小的 finding 与成品一致。Agent 自主选择三张不同职责素材，形成右侧穿着主视觉、左上纹理、左中文案和左下四色陈列；质量为 86 / `needs_review`，说明结果可评且有明显进步，不等于已达到用户成稿 /Eagle 专业质量。
- 正式 PSD 为 66,126,102 字节、SHA-256 `4264951178ee1d05f3eb8114edd2b3a4ad96745bea470dffd4d815af4e98bbe3`；JPG 为 1,046,636 字节、SHA-256 `9efe6d895b836e36455529a828ae8e0a131749577152046f2b37c969800591a1`。结构化完成 7/7，但 Debug Bridge 仍因 `runtimeDeliveryResultRefs` 为空把 Attempt 结算为 `submission_unknown_write_state`；现场已在同构建、同 fixture、0 文档 /0 pending 下完成 reconciliation。
- 受控 renderer 探针已证明根因：PSD 保存结果带 UXP 源 revision，`quickExport` 重定向写出的 JPG 却只有路径，没有 `sourceHistoryStateRef`。E2 拒绝该文件是正确行为；不能用文件存在或格式计数替代同版本来源。第二个证伪探针进一步确认 ExtendScript history id 与 UXP history id 不同域，不能交叉包装。
- D-091 当前实现让 JSX 只核对写前源文档 ID，UXP 在导出前 /后闭合同一 revision，并把 UXP ref 作为唯一 raster 交付来源。修复后同形探针返回 `documentId=4492`、`sourceHistoryStateRef=4492:4497`，导出后仍为 `4492:4497`。定向回归、顺序化 Main /Renderer 类型检查、完整核心闸门 58/58、Agent /UXP production build、提交 `1a3f95d3`、GitHub 推送和提交后双 Runtime identity 均已完成；r26 因外部执行环境中断未形成产品终态。
- 三个成功探针文件已从 r25 项目移到 `C:\Users\12611\AppData\Local\Temp\designecho-e2-probe-cleanup-1521c504`，可恢复；r25 `主图` 目录只保留正式 PSD/JPG。探针 Photoshop 文档和授权调试 Runtime 均已关闭。

## 2026-08-29 r24 终局看错对象：ReviewSet 类型身份修复

- D-089 提交 `329a650e` 已推送；提交后 Agent build `designecho-329a650e2103-69bc9c69c06c` 与 UXP build `designecho-uxp-production-329a650e2103-cdcad214d92e` 均为干净同提交。r24 Run `run-20260828211234-b6f8c117-f38e` 在真实 GPT-5.6 Sol /Photoshop、全新 fixture 和 1440×1440 画布下完成 15 次模型调用、15 次 Tool Call、5 次成功 mutation。PSD 为 30,118,573 字节、SHA-256 `cfdb48b106abbb3d40183a96e7a1f9b6c2a1256abd5349d3f93416eebbfbdcfc`；JPG 为 1,016,313 字节、SHA-256 `1f0c3c2f1708d1eebf21e716c1a9d0f17827a89eb3eccb1c7bb293da22515e0f`。
- Agent 自主选择 `DSC05845.jpg` 上脚图和 `DSC05304.jpg` 四色平铺，说明左图右文结构，并在观察成品后只放大偏小的平铺商品。最终 history `4389:4424` 的真实画面包含左侧主体、右侧“加厚 木耳边 /粉咖微压直板”标题和四色陈列；Final Judge 却报告“大片上下留白、没有设计文字、商品群偏小”，证明确实看错了视觉对象。
- 根因已落实到通用 Runtime：`selectFinalQualityReviewSet` 对单画布错误使用 `single || bundle`。一个同 history、结构完整的素材 /局部 Bundle 被当成终局候选，自动全画布采集因而未发生；Judge 绑定了错误 source output，E2 又只接受 full-surface，最终 `finalArtifactObserved=true`、生产交付检查通过但安全 `finalArtifactRefs` 为空。该 Attempt 已完成 `reconciled_after_runtime_restart`，测试文档和授权调试 Runtime 均已关闭。
- D-090 已将 ReviewSet 类型纳入终局身份：单画布只接受 `single_surface`，多画面只接受 Bundle；Judge、E2 和可信跨代 Artifact 共用同一选择。Runtime Declaration 攻击回归覆盖合法同 history 误导 Bundle，并证明自动全画布仍会执行、Judge 第一张图正确、误导图被排除、持久 Artifact 为 `single_surface`。Design Authorship /Agent Business Boundary、Simplification Ratchet、Renderer 类型检查、完整核心闸门 58/58、Agent /UXP production build、提交 `1521c504` 和 GitHub 推送均已完成；r25 已证明 Judge 对象正确，剩余交付问题由 D-091 处理。

## 2026-08-29 r23 完整画布终审缺口与通用证据链修复

- `f148d512` 已提交并推送；提交后 Agent build `designecho-f148d5127d5b-a489bf79025e` 与 UXP build `designecho-uxp-production-f148d5127d5b-cdcad214d92e` 在 r23 写前同时验证为干净、同提交、真实模型 /真实 Photoshop，画布 1440×1440、0 打开文档、0 待处理请求。
- r23 正式 Attempt `main-image-pink-coffee-unseen-v1-attempt-20260828191922-4584ae55aa1b` 使用同一句“用这些摄影图帮我做一张商品主图。”。唯一 Run `run-20260828194852-b6f8c117-8307` 完成 17 次模型调用、18 次 Tool Call、8 次成功写 /保存 /导出；没有 r22 的 0 调用空子代。
- Agent 自主选择 `DSC05845.jpg` 为上脚主视觉、`DSC05303.jpg` 为四色辅助，先放大辅助商品，再把主视觉上移集中木耳边与袜筒。最终 PSD 为 27,621,377 字节、SHA-256 `2B321F62BF65BC27A0082D91F6DC53086A90CBCB526058699C5B37F8C661F44D`；JPG 为 822,776 字节、SHA-256 `524B7F1A888E1612EF5D1FC55902051360DB28033500B4264A922A7822BA34E1`。
- 正式技术结果仍失败：最后一次内容 revision 为 `4355:4385`，其后结构读回与局部画布读取成功，但所有 `getCanvasSnapshot` 都带 `region`，没有完整单画布 ReviewSet。Run Record 因而是 `success=false / needs_review / artifact_incomplete`，缺口为 `fresh_visual`，评价覆盖率 0/16；Debug Bridge 收据没有安全 `finalArtifactRefs`，Attempt 终态为 `submission_unknown_write_state`。
- 文件生成不能覆盖该失败。现场在固定文件哈希后关闭已保存文档；随后停止并以同一 f148 构建重启，确认同 fixture、Photoshop 0 文档、0 pending 后追加 `04-reconciled.json`，状态为 `reconciled_after_runtime_restart`。
- 已实现 D-089：通用 Host evidence 模块统一结构版本读回与单画布终审快照；缺失 /陈旧完整 ReviewSet 时只读一次无 region 全画布，并要求同一多模态 Judge 的逐图出站收据。E2 可消费该精确 Judge 绑定，但不能伪造普通视觉 review、扫描目录或替 Agent 做审美决定；多画面 Profile 不降级。
- 定向 Runtime Declaration 回归已覆盖 r23 形态并通过；完整 `maintenance:validate` 已从头通过 58/58，Agent /UXP production build、提交 `329a650e`、GitHub 推送与提交后 fresh identity 均已完成。r24 已执行并暴露 D-090 的 ReviewSet 类型偷换，不能再沿用本段旧的“r24 待完成”状态。
- 视觉事实：r23 比早期固定素材 /空白稿更接近真实设计过程，选图与两次调整均有可追溯理由；但成稿仍偏简单左右硬分栏，标题偏大、四色辅助偏小，与用户成稿 /Eagle 专业完成度尚有明显差距。首个 Photoshop 写入约 8 分钟、总运行约 29 分 29 秒，效率不达标；质量与可靠交付闭合前不以删观察换速度。

## 2026-08-29 r22 完成父代被无预算空子代覆盖：新根因与通用修复

- r21 通用终局生命周期修复已以 `4549a846` 推送，Agent /UXP production build 与完整 `maintenance:validate` 58/58 通过；`agent.ts` 保持 12,826 行基线。
- r22 正式主图 Attempt 使用全新 fixture、GPT-5.6 Sol、真实 Photoshop、1440×1440 画布和同一句自然需求。父 Run 完成 14 次成功模型调用、15 次 Tool Call、5 次 mutation /保存 /导出，产生 58,284,496 字节 PSD 与 835,805 字节 JPG；结构化终态是 `success=true / executionStatus=completed / artifactStatus=artifact_completed`。
- Agent 使用一张模特图和四张不同平铺图形成粉咖色左右分栏设计，视觉结果明显好于 r21；终审为 `needs_review / 83`。这只证明出现可评分改善，不等于用户成稿 /Eagle 盲评通过。
- 外层随后错误启动完成态审美子 Run。它继承约 2,065 秒活动时长，已超过 1,800 秒软预算，因此 0 模型 /0 Tool 即以 `performance_budget` 停止，并覆盖父代交付投影；Attempt 已 reconciliation，正式技术结果仍为 0/2。
- 新根因不是模型或 Photoshop：`final_response` 只能说明父代如何结束，不能证明下一 generation 仍有完整执行容量。现有策略只识别显式 `performance_budget` stopReason，缺少对累计模型、Tool、迭代、视觉与活动时间的启动前证明。
- 通用修复已落代码：共享性能策略定义完成态重入最小容量，Reflexion 唯一 owner 比较同一 TaskRun 累计用量和当前有效预算，Executor 复用同一快照作为容量证明与下一代 seed。任一维度不足或证明缺失时，在 run /sidecar 切换前停止重入并保留父代；不选择设计内容、不执行 Tool、不增加权限。
- 已通过 Agent Business Boundary、Design Authorship Boundary、Runtime Declaration、Capability Resolver、Simplification Ratchet、Main /Renderer 类型检查、完整 `maintenance:validate` 58/58 与 Agent production build。第一次完整闸门因 `reflexion-reentry-policy.ts` 缺少现有变更边界分类而 fail closed；将该唯一重入 owner 归入既有 Agent 生命周期边界后从头通过，未跳过检查或改断言。提交推送、提交后 Agent /UXP identity 重建和 r23 真机仍待完成，因此当前不能宣称正式成功率已经改善。

## 2026-08-21 设计作者权与内置预设清理

- agentic 主图、详情页和通用单画布设计不再绑定内置版式或标准模板；`layout-recipes.ts`、详情页固定结构草案、旧主图设计配方与旧视觉分析 Prompt 已删除。平台尺寸、文件格式、SKU 数量和模板真实结构等可校验生产规格继续保留，并与审美决定分文件治理。
- `composeDesign` 只接受 Agent 显式声明的 regions、完整 visualStyle、背景、主体处理、主体占比和完整投影参数；不再派生字色、渐变、阴影、主体比例或固定配方，也不再隐藏执行独立评价、重复快照和等待轮询。
- `renderLayout` 缺 visualStyle 会在写入前失败；model_authored 还必须提供真实页面底色和占位层颜色。只有 Agent 明确选择结构预览时可用 `neutral_wireframe`，且不能作为成品质量结论。
- 全局智能缩放品类 /角色 /意图预设和 70% 兼容主体占比已删除；开放主体适配必须显式提供 fill ratio 与 anchor。主图变体不再按点击 /转化类型偷偷缩放或预留文案区；详情模板和 SKU Skill 只能把自身明确规格作为调用参数传入。
- 参考复刻缺失效果参数时不再伪造统一黑色阴影、内描边、角色彩色占位块、固定坐标或占位文案；只执行真实观察到且参数完整的颜色、透明度、圆角和文字几何，缺项如实进入失败 /待补事实。
- 运行事实账本不再解析或传播 `renderLayout.recipe`，改为从 Agent 显式 regions /blocks 记录 `layoutSignature`；近期稿去重也比较 Agent 版面签名，而不是内置配方 id。
- 已通过 `test:compose-design-spec`、`test:design-authorship-boundary`、`test:recent-designs`、`test:run-fact-ledger`、Main /Renderer 类型检查、Agent /UXP production build 与 `maintenance:validate` 33 个核心检查。真实 Photoshop 视觉效果尚未在重载后的桌面进程复跑，不能仅凭静态契约宣称质量已经改善。

## 2026-08-21 Harness 下一步规划越权链完整收口

- 生产 Runtime 已完整删除 `AgentRecoveryQueue`、`required_tool_result`、required Tool no-call、恢复源排队 /消费和下一轮 Tool allowlist；no-progress、preflight、stage-stall 与 unfinished 只回报失败事实、未完成事实、用户输入缺口或剩余授权能力，不替 Agent 选下一工具。
- 紧凑 E1 不再由 Harness 合成 workflow-owner Tool call，也不再把首轮工具面裁成 owner。显式 staged Runtime 仍在执行点按 Manifest /Stage /Capability /目标 /revision 拒绝越权写入，但合法调用由模型自己产生；开放式 agentic Skill continuation 不取得计划或权限。
- 模型可见 Tool /Skill 结果已隔离内部规划字段：Skill 不再投影 nextAction /nextStep；通用 Tool 投影剥离 nextRequiredTool、requiredTool、requiredArguments 与 allowedToolNames。完成契约补救只报告确定未满足 /尚未验证的验收事实，不再点名 Tool、参数或操作顺序。
- Photoshop 写保护、受保护来源、执行 preflight、目标 /revision、事务、unknown mutation 读回、真实保存 /导出回执、完成契约、预算和安全停机均保留；本次减掉的是计划所有权，不是执行安全。
- 代码卫生棘轮当前为：下一步 Tool 规划接管入口 `0`，控制分支 `21 → 17 → 13`，`agent.ts` `13,707 → 13,554 → 13,025`。静态棘轮同时禁止 Tool call 合成、完成补救点名 Tool /参数、Skill nextStep 投影和 Tool result 隐式预检消费回潮。
- Main /Renderer 类型检查、Agent production build、Tool /Executor /Capability /Prompt /Planning /简化棘轮通过；新增边界断言均为零违规。正式核心预检在规划和仓库卫生后被既有未跟踪文档两处疑似乱码阻断；Runtime declaration 仍被既有 hard-tool-budget 断言阻断；业务边界仍有同样 7 条既有 SKU /主图 /stage-context 债务，未修改无关文件或断言制造假绿。
- 真实 Provider + Photoshop 端到端尚未运行，因此当前可宣称代码边界治理完成，不能外推首次写入延迟、真实成功率或设计质量已经改善。用户需重启桌面端加载新 `dist` 后在安全副本验收。

## 2026-08-21 Agent + Harness 边界与运行时收口

- 经验治理已从“模型输出直接沉淀”改为两条明确发布链：用户明确项目反馈可发布为项目 Evaluation calibration；Evaluation 模型 finding 留在候选；参考图模型解读进入现有 Memory 人工审核队列，未审不可检索、批准后才成为 active 长期知识。v1 无来源 promoted 原则迁回候选。
- Capability 首轮不再用聚合 id 暗中展开大工具面。通用设计实测从 25 个 active tools /约 27.4k schema 字符收至 13 个 /约 14.3k；其余 142 项可达能力通过 `searchAgentCapabilities` 检索、`requestAgentCapabilities` 精确装载。中文“分析项目素材”和“主体适配区域”均命中目标叶子能力，搜索前后 active tools 相同。
- 上下文已统一到模型级 capacity plan：实际模型窗口优先，其次经验证 Provider 默认，缺失保持 unknown；每次调用预留输出与当前 Tool schema，ContextManager 以完整消息 / Tool exchange 裁剪，关键内容放不下时明确失败。Runtime Context Compiler 消费同一派生字符预算。
- System Prompt 已收为跨任务原则；七步法留在 Design Kernel / Knowledge 按需调用，任务卡仅复杂任务使用，Evaluation 按交付风险调用。开放创意不以三者作为写入前置。
- 设计纪律仅保留确定错误 /安全红线为 hard gate；过程顺序、观察节奏、返工次数和一般评审为 advisory。Capability 装载仍不授予 Tool 权限，写入继续经过 preflight、目标 /revision 与事务链。
- 已通过 Renderer / Main 类型检查、Agent /UXP 生产构建、Capability resolver、Prompt /Context、Executor、Tool、Handler、Skill、Gate、三态与 Design Intelligence 审计、Skill Package /简化棘轮、经验专项及核心清单中的全部功能测试；`git diff --check` 通过。
- 完整 `maintenance:validate` 仍不是全绿：未跟踪旧文档 `asset-distillation-knowledge-feasibility-2026-08-19.md` 两处疑似乱码首先阻断；逐项补跑确认 7 条既有业务边界债、Runtime hard-tool-budget 断言和品类词库无父提交 /3 个扩张词仍失败。本轮未修改这些无关债务或降低断言。
- 真实 Provider Capability 接受脚本已通过语法检查，但因缺少本轮显式双重 opt-in /凭据而未发 API；Photoshop 商业设计质量也未实机复跑。二者不由本地治理测试代替。

## 2026-08-21 ChatGPT 订阅模型 Provider（CODEX-SUBSCRIPTION-PROVIDER-001）

- 已实现独立 `openai-codex` Provider：应用捆绑并锁定 `@openai/codex@0.149.0`，通过 App Server 使用 managed ChatGPT 登录和账号动态模型目录；订阅凭据只保存在应用私有 `CODEX_HOME` 与系统 keyring，不进入 renderer、API Key 配置或项目文件。
- 架构边界为「App Server 只提供模型访问，DesignEcho 仍是唯一 Agent Runtime」：每次模型决策使用 ephemeral read-only thread 和结构化输出，不注册 Photoshop MCP、不开放 Codex 内置工具、不让 App Server 执行 DesignEcho Tool。模型返回的 Tool call 仍经过现有 schema、preflight、Policy 和 Photoshop 事务链。
- 安全边界已收口：启动后读取并审计实际 Codex config；非 keyring、自定义 Provider / endpoint、非官方 ChatGPT base URL、任意启用的 MCP 或字段形状异常均 fail closed；登录 URL 只允许官方 HTTPS 主机、无凭据且无非标准端口，系统浏览器失败时不向 renderer 回传原始 URL /错误；主窗口导航和新窗口均拒绝远端 preload 页面。
- 最终源码已通过主/渲染类型检查、生产构建、Handler / Tool / Skill 审计与现有测试。最终 Windows unpacked 包的 ASAR 白名单、源码新鲜度、内置工具禁用、配置审计和登录脱敏已检查；干净隔离配置可启动 0.149.0，启用 MCP 的测试配置被拒绝；物理 Runtime 签名有效。
- 未把无账号验证包装成真实账号 E2E：用户账号登录、账号实际可见 GPT-5.6 型号、配额、跨重启保持、普通对话与 Photoshop 可逆写入仍待一次真实验收。模型列表只消费当前账号 `model/list`，不硬编码承诺所有套餐都拥有同一型号。

## 2026-08-21 开发规则减压与职责治理

- 用户负责业务目标、优先级、验收口径和用户可见取舍；工程 Agent 负责技术路线、架构、兼容、迁移、验证与回滚。除业务结果冲突、新授权或不可逆操作外，不再把底层技术选择题交回用户。
- 默认阅读链收为子项目 `AGENTS.md`、`project-memory/Prompt.md` 和 `CurrentTask.md` 第一张卡；其它架构、计划、状态和历史文档按改动类型加载。`Implement.md` 降为条件性短参考，不再要求每个中大型任务全量读文档、固定写证据报告或无条件同步所有记忆文件。
- v5 收口改为按 `execution_model` 分流：`staged` 规格化生产可由 stage plan 驱动；`agentic` 开放创意保持自主 ReAct，只消费 manifest 的任务语义、知识和预算画像，不以 Brief /Strategy /Plan 表单作写入门票。
- 证据用于提高判断可靠性，不是完成仪式：必须区分已验证事实、合理推断、待验证假设和未知项，但不强制固定标签或用户可见证据报告。写后验证按目标身份、风险和交付边界选择；同一受控批次可合并读回，不要求每个原子动作都提交结构与像素双证明。
- 执行约束分为三类：确定做不到或会破坏数据的情况可以阻断；后续真实执行能够验证的能力未知应放行并保留准确失败；审美、措辞、知识缺口和暂时无法取证的内容进入 warning /待验证，不得补造日志、状态或成功结论。
- 当前任务真相源已在 `MODEL-HARNESS-EFFECTIVENESS-001` 收口：`CurrentTask` 与 `project-state.activeRequest/activePlan` 已同步；OS 仍偏长且混有历史迁移，通用 preload `invoke` 和既有 API Key 存储也不是本轮 Harness 效率修复的一部分，后续应单独治理。

## 2026-08-17 设计路径宪法第一刀：创意路径退出 Stage 门禁（DESIGN-PATH-CONSTITUTION-001）

- 诊断依据（真机档案，非 smoke）：08-14~08-17 共 41 次运行，0 次自然完成；59 次工具失败中 `declareDesignBrief::runtime_design_brief_declaration_invalid` 15 次、状态新鲜度门禁 14 次、观察预算拦截 6 次、写保护 5 次——约三分之二是 Harness 拒绝模型。同一项目同一下午：绑 Stage 机的三次「帮我做 详情页」零写入（简报表 `array_too_long (inputCoverage)` 连驳 7 次 + 观察预算 + 单工具 allowlist 三面夹击）；未绑的一次续跑写入 6 层后被预算掐断。模型原话「这次卡在简报提交这个系统环节，不是设计判断问题」属实。
- 已落地①（数据层）：`SkillRuntimeManifest.execution_model: 'staged'|'agentic'`；general-design / main-image / detail-page / single-canvas-visual / reference-replication 标 `agentic`。executor `resolveAutonomousCapabilityRuntime` 把 agentic 清单分流到 `agenticManifestBundle`：不建 Runtime Session、不以声明作写入门票、工具面走 broad discovery；清单仍供方法知识注入（去 applicableStages，从第一轮全部可见）、预算画像（详情页 30/140/70）与任务类型。循环内 `declareDesignIntent` 声明 agentic 类型时只更新知识上下文（`Agent.replaceRuntimeStageContextItems`），不切回 staged。SKU 批量 / 色卡 / 模板保持 staged。
- 已落地②（执行点降级）：写前观察超限 `agent_observation_budget_reserved` 由拦截改为一次性提醒（`performance-ledger.takeObservationReserveAdvice`），不再触发 liveness 收窄工具面；`status:'applied'` 且同 modal history 前进证明的成功写入不再建立模型轮次读回义务、不锁同批后续写入（`Agent.isPhotoshopOperationOutcomeSettled`）。
- 已落地③（表单可执行化 + 账本）：`declareDesignBrief` 的 `inputCoverage` 改为宽容读取（备注字段不驳回整表）、schema maxItems 不再随 manifest 归零；驳回信息附字段/限制值/允许集合（`describeRuntimeDesignBriefValidationIssues`）；`*_declaration_invalid` 计入 `policy-gate-repeat-guard`（同表连驳 5 次如实停机，停机文案区分「表单校验」与「门禁」）；`queueRecovery` 的 allowlist 若只剩控制/声明工具则不收窄。
- 已落地④（预算）：未绑清单自主预算 16/50/7min → 32/120/15min；全局上限 30/600s → 40/900s。
- 已落地⑤（棘轮 + 宪法）：`audit:simplification-ratchet` 新增 agent.ts 行数（基线 13488）、控制工具数（6）、执行点拦截返回点（19）三条只减不增度量 + 5 份创意清单必须 agentic 的硬断言；CLAUDE.md / AGENTS.md 同步新增「设计路径宪法」一节（新增前置拦截必答三问）。
- 已核实：`build:typecheck:renderer` 通过；`audit:runtime-declaration` 通过（含新增 `assertProvenAppliedWriteDoesNotLockFollowingSerialWrite`、观察预算 advisory 三处断言改写）；`audit:agent-business-boundaries` 0 违规（含新增 `policy-gate:declaration-rejection-escapes-repeat-ledger`、未绑预算下限断言）；`audit:executor-generic` 0 违规；简化棘轮全绿；`npm run build` 产物已更新（dist 含 agentic / observation-reserve-advice）。
- 真机首验（同日 18:03，run [470]「帮我 做主图吧」，C-1248）：agentic 路径 23 轮 28 调用、写入 5（一轮内连写 3 个文字层，无任何 Harness 门禁）、自然收尾——四天来第一次「不是被系统卡死」的设计运行。暴露的下一层问题：①慢（4m50s，其中 4 分钟是 4 次带截图的模型回合，每次 40–75s）；②没看过一张产品图，把 `analyzePsdDesignSource` 读到的上一稿文案「防滑硅胶」直接抄成中筒袜卖点（画面无硅胶）；③收尾说「还想再调」却用文字结束本轮；④「做主图吧」未解析到 main_image 清单（方法知识靠模型自己调 `getMainImageDesignFramework`）。
- 已落地（同日追刀，做好·第一课「产品事实先于文案」）：`designer-agent-autonomy-principles.ts` 无条件注入两条——写功能/材质/工艺文案前先看产品图并说得出来源、旧稿/模板/PSD 文字不算产品事实、画面看不出且用户没说的功能一律不写、收尾前对照产品图核文案、想调就直接调；`analyzePsdDesignSource` 描述改为「设计规范最可靠 / 文字是上一稿文案不是产品事实，须经产品图或用户核对」。已 typecheck、audit:tools / prompt-capability-governance / executor-generic / 棘轮 / business-boundaries 全过，已 build。待真机同一句复测：首批调用应出现看产品图，文案每条能说来源。
- 真机二验（19:47，run [471]「帮我 做主图吧」）：新原则生效——先 analyzeProjectContactSheetOverview + analyzeAssetContent×2 再建档铺图（8 写入），但 8m16s 后 `performance_budget`（32 次模型调用在第 28 轮耗尽，其中 5 次视觉回合各 50–110s）；中途 renderLayout 因 visualStyle 表单被拒 2 次（模型改用原子工具成功）、设计纪律 `block-2-mutation-cap`「连续写入未回看」拦下 transformLayer 2 次。
- 已落地（同日三刀）：①`design-discipline-runtime` 守卫结果附 `disciplineRuleId/Category`，`redo-cap` 类降级为提示（executor 照常执行并在结果附 `disciplineAdvice`），其余纪律不变；②renderLayout 拒绝信息附具体 issue 与最小合法样式骨架、并提示可改用原子工具；③预算：未绑清单 32→40 模型调用 / 视觉分析 5，main-image 清单 22/60/35/10min→36/120/60/15min。typecheck、executor-generic、skill-package-contract、runtime-declaration、棘轮、capability-resolver、business-boundaries 全过，已 build。
- 已落地（同日四刀，用户要求「先修好主图做不完 + 看得见走 skill 还是自己用工具」）：①开工可见步骤「这次怎么做」（staged→「按你的固定流程做：X」/ agentic→「自己动手排：X」/ 未识别→「自己动手排」），循环内声明绑定同样可见；②原则加两条：接手半成品（画布已有内容是起点，不推倒、不冒领）与看画面按需选清晰度（整体用 600–800，写入已读回不再截图）；③`getCanvasSnapshot.maxSize` 描述标 COST 与推荐值。typecheck / executor-generic / 棘轮 / business-boundaries / tools 全过，已 build。
- 已落地（同日五刀，用户反馈「看图时以为卡住 / 预算耗尽他眼瞎了 / 预算设计合理吗」）：①模型回合实时活动：`model_request` 投影为带起始时间的实时活动（不进持久步骤流），带图回合明说「正在看刚才的画面…」，界面 6 秒后显示「已 N 秒」计秒，模型回话即清除（`agent-visible-feedback.buildVisibleAgentActivityFromModelTurnEvent` + ChatPanel 计秒）；②视觉候选额度用尽不再失明：主模型自看时超额画面缩成 ≤512px 缩略图读入（新模块 `agent-runtime/vision-thumbnail.ts`，防失控硬顶 +12），并在消息里如实说明只看整体；候选上限未绑 8→16、主图清单 8→16、视觉分析 5→6；③agent.ts 棘轮基线 13488→13519（有评审理由）。typecheck / 棘轮 / business-boundaries / runtime-declaration / executor-generic 全过，已 build。
- 真机三验（20:39，run 32 轮 37 调用、6 写入、6m41s，**首次 final_response 自然收尾**）：模型在用户自己的「800」文档上加了三层文案（接手半成品 ✓），但标题压在模特腿上——原因链已从推理原文确认：看图额度（当时上限 8）在反复看文档时耗尽 → 「无法确认主体位置」→ 「采用最安全布局：标题放顶部」→ 压主体；全程 29 次观察 / 6 次写入，`getAcceptanceSnapshot`+`getDocumentSnapshot` 同轮成对调用；从未调 `getSubjectBounds`（本地检测、不花看图额度，但只在按需目录里）。
- 已落地（同日六刀）：①`photoshop.read.getSubjectBounds` 与 `photoshop.write.fitLayerSubjectToRegion` 进 baseline 能力面；②`getSubjectBounds` / `getDocumentSnapshot` 描述改口（放文字前先定主体框；两个截图工具同轮只调一个）；③主图方法论加「排版顺序：先定主体框→主体外划文字框→一格一元素不叠压→字号比例→留白不够缩主体不叠字」；原则加「排版先划格」；④写前观察提醒改为每 6 次周期性提醒（仍不拦截）；⑤capability-resolver 注释去品类词过审计。typecheck / capability-resolver / runtime-declaration / tools / business-boundaries / 棘轮全过，已 build（需重启）。
- 已落地（同日第七刀，用户拍板「帮我开发好」——版面引擎 v2 第一批 = 版面配方）：新模块 `shared/layout/layout-recipes.ts`，从用户 Eagle「主图/点击图-参考、转化图-卖点参考」与其文案模板提炼 6 套配方（标题上左·主体右下 / 标题上·主体中·底部卖点条 / 大标题·四宫格 / 特写满幅·底部一句话 / 标题上·主体下·数据条 / 文案块左上·主体右下），纯数据 + `expandLayoutRecipe`：模型只给 recipeId、标题 1–2 行、副标题、2–4 条证据、数据条、主体（素材路径或已有图层 id）、三四个颜色 → 引擎展开为 regions + model_authored visualStyle（字距 / 行距 / 拟合 / 最小字号等工艺参数由引擎档位默认），走 renderLayout 既有管线（求解、建层、按 `版面-<配方>·<标题>` 建组 + 文案/图片子组、校验、写后自读）；文字区域与主体区域在配方里不相交（不压主体由构造保证）；existingLayerId 场景渲染后引擎调 `fitLayerSubjectToRegion` 把已有主体适配进主体区域。`renderLayout` schema 增 `recipe`，描述改为「首稿首选 recipe，不要徒手 createTextLayer」；主图方法论与原则同步。新增纯逻辑测试 `scripts/verify-layout-recipes.cjs`（`test:layout-recipes`，已入 core validation）：6 套配方全部通过校验 / 样式解析 / 文字不压主体不越界不互压 + 反向缺内容拒绝；首跑抓出两处文字压主体、边距未对齐栅格并已修。typecheck / tools / 棘轮 / capability / executor-generic / prompt-governance / business-boundaries / runtime-declaration 全过，已 build（需重启）。
- 已落地（同日第八刀，用户关切「主体尺度要有审美地调，不是置入就完」）：配方模式的主体不再只做外框 contain——渲染后引擎对主体图层（新置入或已有）调 `fitLayerSubjectToRegion`，按检测到的真实主体以配方默认占比（0.62–0.72，满幅 cover 配方除外）或模型给的 `recipe.subjectFillRatio`（0.3–0.95）适配进主体区域；schema 与描述同步；`test:layout-recipes` 6/6、typecheck、tools、business-boundaries 全过，已 build。
- 已落地（同日第九刀，真机：模型把活动文档「image-to-image_….png」896×1200 单一锁定背景当成「主图文档」要直接叠字；并再次把详情页 PSD 文字当「产品事实」）：①新模块 `shared/design-document-nature.ts`——按文件名扩展名 + 图层数判「设计文件 / 一张图片 / 空画布 / 未知」，`getDocumentInfo` 结果附 `documentNature`（理由 + 设计师式建议：图片是素材不是画布，新建规格画布再置入），只提示不拦截；原则「先认清打开的是什么」替换「接手半成品」并要求一句话说明「原文件继续 / 另开画布」的选择；②`analyzePsdDesignSource` 结果对象直接附 `textProvenance`（设计文案≠产品事实，功能词须经产品图或用户核对）。typecheck / tools / business-boundaries / 棘轮 / executor-generic 全过，已 build（需重启）。
- 已落地（同日第十刀，技术方案 P0「骨架立起来」，方案见 `docs/design-craft-harness-technical-plan.md`）：①`GENERAL_DESIGN_PRINCIPLES` 按七步设计工作法重排——【设计工作法】总纲 + ①目的 ②内容 ③材料 ④结构 ⑤视觉语言 ⑥制作 ⑦看与修 + 决策所有权 + 方法选择 / 面向用户，去重去品类后 14 条（原约 21），`audit:simplification-ratchet` 新增度量 `design_principle_lines` 基线 14 只减不增；②知识层 `design-artifact-knowledge.ts` 的 `generic` 条目改写为「设计工作法：七步做完一张画面」（每步：想什么 / 做好的标志 / 最常失手）+「七步自检」，作为任何交付物（含未登记品类）的 `getDesignKnowledge` 底座；`getDesignKnowledge` 工具描述注明 `generic` = 通用七步工作法。原则是目录、知识是正文，两层引用而非重复。
- 已核实（第十刀）：`build:typecheck:renderer`、`audit:simplification-ratchet`（原则 14/14 持平）、`audit:tools`、`audit:executor-generic`、`audit:agent-business-boundaries`、`audit:capability-resolver`、`audit:runtime-declaration`、`audit:prompt-capability-governance`、`audit:skill-standard`、`audit:design-intelligence`、`test:layout-recipes`、`test:proposition-ledger`、`test:intelligence-stores`、`npm test` 全过；`npm run build` 通过（dist 已含今日全部改动，应用需重启）。`maintenance:validate` 仍只在「品类词条库」一步失败（下条所述的无父提交问题，与本刀无关）。
- 已落地（08-18 第十一刀，记忆与上下文测绘后的第一批修法，用户拍板「可以」）：诊断依据——472 份运行档案里 `getDesignProjectState` 出现 245 次、`updateDesignProjectState` 只有 42 次（9%），08-10 后 5/102；28 个 `design-state.json` 里 productFacts 非空 1 个、sellingPoints 2、layoutPlan 4；今日 C-1248 跑 11 次含成功主图，状态文件只有 Harness 写的 artifactRefs。病根 = 记忆全靠模型「想起来写」，且提示词写着「只有即将暂停时才记录」。修法（全部循环外、不加门禁）：①新模块 `shared/design-run-tool-log-facts.ts`（从工具日志提取事实：看过 / 置入的素材与视觉观察、图上卖点线索、版面配方 + 标题 + 图层组、新建画布、最后文档、写入文字、导出文件、写入计数；设计成品上的文字不进卖点）+ `shared/design-run-fact-ledger.ts`（生成 Design Project State patch：materialAssets 合并不覆盖模型 / 用户备注、selling_point 事实 unverified 带 `asset:<指纹>` 来源、layoutPlan 只在空或「[自动记录]」时代填、canvasSize / deliveryFiles 补空、有写入且模型未记版本时 appendVersion；只读运行不产生 patch）；②执行器新增 `recordRunFactsToProjectStateSafely`，在三处代际结束点（正常 / Reflexion 重入 / 运行失败）先记账再刷新代际上下文，写入失败只记日志；③`buildDesignProjectStateSummary` 新增「已看过的素材」「素材上看到的卖点线索（未经用户确认）」两行；④`buildTaskStateDisciplineSection` 改口：事实由 Harness 自动记、模型只记判断、摘要够用不必再调 getDesignProjectState；⑤`getDesignProjectState` 工具描述同口径（去重复读）；⑥运行档案 `checkpoint.designSummary`（≤600 字「做到哪」）+ 续跑摘要「上次做到：…」（brief 上限 1200→1800）。
- 已核实（第十一刀）：新增 `scripts/verify-run-fact-ledger.cjs`（`test:run-fact-ledger`，已入 run-core-validation）29 项断言全过（含真实 applyDesignProjectStatePatch 合并后摘要可见、成品文字不混入事实、模型写的 layoutPlan 不被覆盖、只读运行无 patch、续跑摘要带「上次做到」且尾部指引未被挤掉）；`build:typecheck:renderer`、`audit:simplification-ratchet`、`audit:executor-generic`、`audit:agent-business-boundaries`、`audit:tools`、`audit:capability-resolver`、`audit:runtime-declaration`、`audit:prompt-capability-governance`、`audit:skill-standard`、`audit:design-intelligence`、`test:layout-recipes`、`npm test`、`check:repository-encoding` 全过；`npm run build` 通过（应用需重启）。真机验收口径新增：项目记忆写入率（有看图 / 有写入的运行里 design-state 被更新的比例，基线 5%）与「第二句话还要不要重新看图」。
- 已落地（08-18 第十二刀，用户：不想依赖 Photoshop「选择主体」识别主体，复杂场景不可靠；「我不懂技术，方向一致，你来定」）：主体框从「画布上的实时识别」改成「素材属性」——①新纯逻辑 `shared/subject-box-from-pixels.ts`：透明 alpha 边界（确定）/ 纯色底裁边（高置信，边框中位色 + 容差 22 + 均匀度 ≥94%）/ 分割框按覆盖率定置信 / 整框兜底（低置信明说），相对框（0–1）↔ 图层外框投影可逆；②主进程新服务 `services/asset-subject-box-service.ts`：对文件 / 已编码图 / 原始像素跑 alpha → trim → 本地分割（SubjectDetectionService，BiRefNet）→ 整框，按路径+大小+mtime 缓存一次算多次用；IPC `resource:getAssetSubjectBox`（文件）与 `resource:detectLayerSubjectBox`（插件导出图层像素 → 本地计算 → 相对框 + 文档坐标，复用抠图导出通道，不用 PS 智能功能）；③渲染进程 `tool-executor`：会话级「图层 → 来源文件」登记（placeImage / replaceLayerContent 等成功后写入，带 documentId），`resolveLayerSubjectBounds` 逐级链：素材属性 → 图层透明边界 → 图层像素本地分割 → （仅显式 method="smart"）PS 选择主体 → 整框；`getSubjectBounds` 省略 method 走该链并返回 method/confidence/relativeBox；`fitLayerSubjectToRegion` 同链，写后读回改为按相对框投影到新外框（等比缩放下精确，不再第二次识别；alpha 仍重量像素），结果附 `subjectDetection{method,confidence,note}`，低置信进 warnings；④工具描述改口（默认 auto，smart 显式）；⑤顺手修「建好未接线」：`index.ts` 从未调用 `subjectDetectionService.setMattingService` → 本地主体检测一直「抠图服务未初始化」，`measureReferenceComposition` 长期静默失败，已接线。
- 已核实（第十二刀）：新增 `scripts/verify-subject-box.cjs`（`test:subject-box`，已入核心验证）15 项断言全过（alpha 框准 / 白底含 JPEG 噪声裁边命中 / 渐变与顶边内容不认 / 投影可逆 / 分割覆盖率→置信 / 兜底）；真实平铺场景照（袜子压在书上）ad-hoc 走链：alpha 跳过、trim 正确不认（边框两色）、分割级因脚本外无抠图服务落到整框低置信——行为符合设计；typecheck / 棘轮 / executor-generic / business-boundaries / tools / capability-resolver / runtime-declaration / prompt-capability-governance / skill-standard / test:run-fact-ledger / test:layout-recipes / npm test / 编码检查全过；`npm run build` 通过（应用需重启）。真机待验：白底 SKU 图与透明 PNG 应命中 asset:trim / alpha（不再调 PS 选择主体）；场景照走 layer:matting 或 frame 并在 fit 结果里看到 confidence。第二批（待）：视觉模型粗框 + MobileSAM 精修（场景图「找产品」而不是「找显眼」）、主体框写进素材记忆跨会话复用、YOLO-World 实为固定 COCO 80 类（无袜子/服装）需开放词汇模型才可用。
- 已落地（08-18 第十三刀，真机 run-20260818020052415「帮我做SKU」：用户只给了色卡 SKU.psb 没给模板，模型把「组合 01」卡片叠在色卡文档上并溢出画布；用户：「他不知道这是 SKU 色卡吗，起码不能在这里面做」）。病历：模型明知是色卡（原话「当前 SKU.psb 已经是一张完整的色卡…可以把它当作组合模板的底版来复用」），新建了 800×800 文档「SKU」后想把 5 款袜子图置入模板 → 找不到素材路径 → 「回到 SKU.psb 在这里搭建组合模板」；色卡里遗留的隐藏 A1/B2 矩形被读成「早期模板雏形」；createSkuPlaceholders 因 regionCapacities 缺失失败后徒手画矩形；sku_batch 清单 16 次模型调用上限在第 14 轮把整件事砍停（零模板）。三个根因三处修：①**知识 / 契约**：`sku-template-design-loop.ts` handoff 契约新增「模板定义」——每规格一份独立新文档、画布沿用色卡尺寸、只放版式与占位符、**不置入颜色图**（颜色由批量从色卡填）、色卡文档只读且新文档不得同名、遗留隐藏矩形不是模板；「先找现成再新建」——项目模板目录 → Eagle「SKU 模板」类目（合适 = 双数 / 画布尺寸 / 占位数 / 风格都对，importEagleAssetToProject 导入后 openTemplate 检查）→ 都没有再 createDocument；createSkuPlaceholders region_composition 必须显式 regionCapacities；工具面加 openTemplate / importEagleAssetToProject / observeEagleAsset；executor 两处 handoff 传 sourceDocumentName + sourceCanvas。②**预算**：sku-batch 清单 16/50/30/420s → 32/100/50/900s（vision 6/2 → 8/3），审计钉住值同步。③**UXP switchDocument 同分陷阱**：新建「SKU」与色卡「SKU.psb」去扩展名后同分 1，旧写法取先遇到的色卡——现在完整名精确 = 1、去扩展名精确 = 0.98，真同分且不同名直接报「无法确定要切到哪一个，请用 documentId」而不是静默选旧的。未做硬写锁（宪法：拦「做错」前三问——已答；但既有 protected-source 写锁曾自锁误伤，本刀先靠定义 + 预算 + 不静默送错，账本会显示是否复发）。
- 已核实（第十三刀）：`build:typecheck:renderer`、`audit:agent-business-boundaries`（handoff 契约断言仍过）、`audit:runtime-declaration`、`audit:skill-package-contract`（预算钉住值已更新并注明真机依据）、`audit:capability-resolver`、棘轮、executor-generic、tools、skill-standard、prompt-capability-governance、`test:run-fact-ledger`、编码检查全过；Agent `npm run build` 与 UXP `npm run build` 均通过（应用需重启；UXP 需在 UXP Developer Tool 重载插件）。真机待验：重跑「帮我做SKU」，看是否新建 2/3/4 双装独立文档、色卡文档零写入、fit/handoff 不再在第 14 轮被砍。
- 已落地（08-18 第十四刀，用户「假设你是 Agent」推演拍板后的第二批：①该问的先问一次问在开头 ③「合适」判据分层 ④SKU 卡片版式起点）：①`sku-batch.executor.ts` 设计闸门处新增 `draftComboConfirmationBeforeTemplateDesign`——缺模板且规格 / 组合仍是 Skill 草稿（未确认、未明说跳过、无项目配置）时，先用同一张组合确认卡（双数可改）问用户，返回 `pending_sku_combo_confirmation` + `confirmationBeforeTemplateDesign: true`，确认续跑后规格权威再进入模板 handoff（避免按默认 2/3/4 做完三份模板被用户改规格白做）；已确认 / 明说不用复核 / 项目配置权威时不问。②handoff 契约「合适」写成两半：确定的一半自己量（导入 → openTemplate → inspectTemplateLayout(expectedItemCount) 无 blockers 且槽位 / 区域容量与双数一致、画布与色卡一致或可等比），判断的一半才看图（风格与项目 / 品牌一致）。③`sku-template-design-loop.ts` 新增纯几何 `buildSkuTemplateLayoutSuggestion`（画布 + 双数 + 色卡色块宽高比 → 卡片框 / 占位槽 / 标题区 / 共用刻度；>4 槽分两行），handoff 契约字段 `templateLayoutSuggestions` + message「版式起点」段（三份共用同一套边距 / 间距 / 圆角 / 字号，先做完一份看效果其余派生，槽位可直接作 createSkuPlaceholders slots）；executor 传 `sourceCardAspectRatio` 并把建议进 data。800×800 实算：2 双 324×492 / 3 双 208×316 / 4 双 150×228（≈色卡色块 154×234），标题 y632 字号 28。
- 已核实（第十四刀）：新增 `scripts/verify-sku-template-handoff.cjs`（`test:sku-template-handoff`，已入核心验证）33 项断言全过（定义 / 只读不同名 / 先找现成 / 合适两半 / 版式几何：槽位在框内、互不重叠、标题在下、三份同刻度、5 色分两行、缺尺寸不建议、修复路径不给新建版式）；typecheck、business-boundaries、runtime-declaration、skill-package-contract、capability-resolver、棘轮、executor-generic、tools、skill-standard、prompt-capability-governance、其余测试、编码检查全过；`npm run build` 通过（应用需重启）。未做：④SKU 卡片版式引擎化为独立工具（本刀用「数字建议 + 模型执行」代替，先看真机效果）；「合适」的确定半自动打分（inspect 结果 → 结构性 verdict）留待真机数据。
- 已落地（08-18 第十五刀，用户真机反馈「看半天不动手」「还在改色卡」+「不要打补丁，要有效的 Harness 和 Agent」）：把同一条治理原则落到三处执行点，不再逐症状修——**来源 ≠ 产出、owner 先行、账本不误导**。①**Skill 声明只读来源文档**：`autonomous-agent.executor.ts` 既有「用户保护源稿」写锁增加第二个合法来源 `data.protectSourceDocument{documentName,documentId,reason}`（Skill 结果里结构化声明；不靠关键词、不由开场观察武装），sku-batch 三处 handoff 声明色卡为只读来源；写锁沿既有开合逻辑（createDocument / switchDocument / getDocumentInfo 读回），拦截文案改为「只读来源文档…产出请在另一份文档里做」。②**紧凑工作流 owner 先行**：`runtime-session.ts` 执行门新增 `workflowOwnerFirst`——无 R4、唯一 workflow owner 且它没跑过、也没交出续跑范围时，E1 直接外部写入不放行，`code=runtime_workflow_owner_first`、`nextRequiredTool=owner`（同一返回点，blockedTool 计数不变）；判据 `resolveCompactWorkflowOwnerFirst` 落在 `agent-workflow-continuation-scope.ts`（循环外），agent.ts 只转发（行数棘轮 13519→13533 有评审理由上调）。③**账本不误导**：`design-run-fact-ledger` 只对有配方身份的版面自动记 layoutPlan（徒手 regions「已渲染一版排版」不记）；C-1249 里被误记的「[自动记录] 已渲染一版排版；文档「SKU」」已从状态文件移除。
- 已核实（第十五刀）：typecheck、棘轮（基线注明理由）、runtime-declaration、business-boundaries、executor-generic、capability-resolver（Runtime Session 契约仍 category-neutral，注释已去品类词）、skill-package-contract、test:sku-template-handoff、test:run-fact-ledger、npm test、编码检查全过；`npm run build` 通过（应用需重启）。真机口径不变：「帮我做SKU」→ 先弹确认卡（或直接进 owner）→ 色卡零写入（写入被拦时错误里应看到「只读来源文档」或「先调用 SKU 工作流」）→ 模板独立文档三份一致 → 出图。
- 已落地（08-18 第十六刀，用户问「我们没把模型脑子锁住吧」→ 回答是「没锁脑、锁了手在规格化路径、但饿着脑还淹着脑」→ 用户「可以的话就开动」）：①**量「淹」**：`runtime-accounting.ts` 新增 `measureRuntimePromptShape`（系统提示字符 / 历史字符 / 消息数 / 图像块 / 工具数 / 工具 schema 字符）与账本 `promptShapeSamples`（每次模型调用一条，上限 48，含 provider 报告的 token），digest 进运行档案；agent.ts 两处模型调用点传入；`debug:runs --trace` 新增「提示体量」表 + 小结（系统提示 / 工具 schema 是固定开销，历史增长是轮次税，哪个大先砍哪个）。真机基线（run-20260818020052415，SKU）：R2 平均 7.5k tokens/调用，E1 平均 22k，16 次共 326k——问题在 E1 增长而非开工提示。②**紧凑工作流 owner 先行的提示侧**：阶段提示在 R2 明说「工作流会自己读来源，这一步不要逐层查看图层 / 文字 / 智能对象」、E1 明说「直接调用它，交接范围内再自己动手」，与写入门禁同口径。棘轮 agent.ts 基线 13537→13547（理由已注）。
- 已核实（第十六刀）：typecheck、棘轮、runtime-declaration、business-boundaries、executor-generic、capability-resolver、prompt-capability-governance、skill-package-contract、全部测试、编码检查过；`npm run build` 过（应用需重启）。下一步（待真机数据）：任务模型进 manifest（`resource_roles` + 缺项清单）通用化到所有 Skill；按提示体量样本决定砍哪一层。
- 已落地（08-18 第十七刀，真机截图「这次怎么做：自己动手排：这句需求没有对应的固定流程」+ 又把色卡当模板设计）：**根因是路由**——「帮我做一下SKU」不在 sku-batch 的 canonical 白名单（`isCanonicalSkillProductionEntry` 只放行「帮我做SKU」这类裸命令，多个「一下」就落空），于是没有 Runtime owner、没有 SKU 工作流，模型在普通设计循环里把 SKU.psb 当画布；而普通循环里给它的候选提示「用结构化设计意图绑定」不说是哪个工具哪个 id，`declareDesignIntent` 描述又写「别在 Skill 前调它」——两头矛盾，模型放弃绑定自己动手。三处修：①sku-batch canonical 入口接受非语义包装「一下 / 一下子 / 下」（白名单自己的定义，不是新路由；「帮我看一下SKU」「SKU怎么做」仍不命中）；②普通循环候选工作流提示写实：`候选工作流是「SKU 设计与生产」（Profile：ecommerce.sku_batch.v1）——如果用户要的就是这类交付物，先调用 declareDesignIntent({taskType}) 绑定，绑定后工作流入口可调用，由它读来源 / 准备前置 / 给确认卡；不要在绑定前替它动手`（`findManifestTaskTypeForSkill`）；③`declareDesignIntent` 描述改为「系统提示给出候选 Profile 时用它绑定；Skill 工具已可调用时直接调 Skill 也行」，去掉矛盾句。ad-hoc 验证：帮我做SKU / 帮我做一下SKU / 做下SKU / 帮我做一下SKU色卡 → canonical；帮我看一下SKU / SKU怎么做 / 可以用这批素材给我出一个主图吗 → 不命中。审计（business-boundaries 的 canonical 正 / 负 / deferred 用例）全过。
- 用户疑问「这不是 Agent 自己的思考内容吧 / 系统提示词不会显示在对话里吧」：不会。「这次怎么做：…」是 Harness 的模式播报（用户 08-17 要求「看得见走 skill 还是自己动手」），来源标 skill_executor；这次它恰好把误路由暴露出来了。
- 已落地（08-18 第十八刀，用户问「关键词命中不准确，要不要去掉、理解交给模型？」）：决定 = **不整套去掉，改它的角色**——关键词 canonical 只做「零歧义裸命令」的快路径（命中即省一轮模型），**漏掉时不再让模型独自摸索**：普通循环（无 Runtime owner、无显式 declaredTaskType、未禁 Skill）系统提示注入「可选的固定生产流程」菜单——所有 staged 清单的名称 / 何时用（取入口 Skill 的 whenToUse[0]）/ Profile id + 一句绑定动作（`declareDesignIntent({taskType})`）+ 「只是提问 / 查看 / 当来源素材时不要绑定」（`buildStagedWorkflowMenuLines`，品类词全部来自声明与清单数据，执行器无字面量；executor-generic 棘轮通过）。模型选了就绑定，Harness 再接管工具面、owner 先行与只读来源。审计与 build 全过（应用需重启）。
- 未核实 / 待验证：`maintenance:validate` 里「品类词条库」一步失败原因是仓库今日被压成单一根提交（`词条库首次引入提交没有可用父提交`），与本次改动无关、需修审计脚本对无父提交的处理；真机需重启应用后用同一组提示（帮我做详情页 / 帮我完成SKU编排 / 看看这个淘宝链接）复测，用 `debug:runs` 同口径看「完成且有写入率」；agentic 路径没有自动 Reflexion 返工（原实现依赖 Runtime Session 账本），质量返工留给用户续跑与后续 critic 挂钩；staged 路径（SKU）里 `createTextLayer::runtime_task_run_revision_reobserve_required` 14 次仍待单独查。

## 2026-08-16 治理切片 9：cut 意图审议闸门 + 9+1 总验收（GATE-SIMPLIFY-009）

- 已核实（cut 判定成立）：`agent-intent-deliberation-gate.ts` 的唯一生产消费者是 engine 的诊断记录构建点；四字段（不改变路由/不跑 Provider/不跑 Photoshop/纯诊断）无任何执行语义、无事故记录、也防不了任何事故；诊断脚本只读旧档案 modelConsulted 字段且 `|| {}` 容错——审计建议的 cut 判据全部复核属实。
- 已退役：删除该文件、移除 engine 构建点与 import（决策来源主口径继续由 decision.source 承担）；`agent-diagnostic-record.ts` 字段保留并标 @deprecated（兼容读取旧档案，不破坏历史数据形状）。
- 已落地（总验收·收敛指标机制补齐）：①完成且有写入率——diagnose-runs `--convergence` 已有（切片 3 口径不变）；②首次写入延迟——run record toolCalls 增 `elapsedMs` 时序（距 run 起点毫秒，时序账本未启动不写、旧档案缺失不臆造），诊断输出中位/P90 与时序覆盖率；③误判"我不会"次数——启发式候选圈定（零写入 + 无阻塞 + 自然停机 + 能力信号：model_access / 能力类失败码 / 能力否定措辞），逐条人工确认、绝不自动定罪。`convergenceBaseline` 增两项 null 槽位待真机回填。
- 已核实（构建/审计）：build:typecheck:renderer、audit:runtime-declaration 全过、audit:tools（164）、audit:agent-business-boundaries 0 违规、audit:capability-resolver 0 违规、maintenance:validate 22/22、生产构建、git diff --check 全部通过。
- 未核实 / 待验证：真机重启加载新构建后用 debug:runs --convergence 观察三项指标回填（首次写入延迟需新档案才有时序）；9+1 全部落地——①观察限额合并 ②链接评审 read_only_inspect ③Judge 预保留移除 ④视觉池合并 ⑤回复正则退役 ⑥按能力面收敛 ⑦裸确认 resume token ⑧A-2 unlockOptions ⑨审议闸门 cut + 审计 cut 1 项。

## 2026-08-16 治理切片 8：工具决策契约 A-2 补授权升级出口（GATE-SIMPLIFY-008）

- 已修复：`AgentToolDecisionBlocker` 新增结构化 `unlockOptions` 字段；`execution_authorization_required` 拦截消息改为三条解锁路径（①只读先行并回答用户 ②createInteractiveCard 请求用户确认 ③用户明确授权后重新发起），解锁选项进入 blocker 对象与重规划指令（"Ways to unlock the blocked action: …"行）——模型被拦后一步到位，不再「条件不完整」原地空转（gates-definitions 4.3 病例）。
- 已修复（去重 bug）：序列化去重原只保身份三要素、把新字段丢掉——已改为从原对象回补 unlockOptions。
- 已核实（行为测试）：candidate_only 下写工具 → blocked + unlockOptions ≥3 且含确认卡路径；confirmed_tool_required 同调用 → ready 不受影响。
- 已核实（构建/审计）：build:typecheck:renderer、audit:runtime-declaration 全过、audit:tools（164）、audit:agent-business-boundaries 0 违规、audit:capability-resolver 0 违规、简化棘轮 21/21 持平、maintenance:validate 22/22、生产构建、git diff --check 全部通过。
- 未核实 / 待验证：真机验证模型被授权门拦下时能按解锁路径一步行动而非转圈；剩余 cut（意图审议闸门）继续立项。

## 2026-08-16 治理切片 7：裸确认配 resume token（GATE-SIMPLIFY-007）

- 已修复：engine 的裸确认降级点（ack/continuation/公开计划确认 → candidate_only）改走新共享纯函数 `agent-bare-continuation-resume.ts` 的三元裁决：同会话分支存在可续接的未完成运行档案（经 `listAgentRunRecords` 桥 + `buildRunRecordResumeBrief` 匹配）时**保留写权限**并签发 `bare_continuation_resume_identity` 信号，Run Record 续接机制照常注入续接上下文（真机 #228/#229「继续」零写入的修复）。
- 已修复（安全边界 fail-closed）：新会话/已完成/跨分支/过期/桥缺失/查询失败一律维持旧降级（不恢复历史写权限）；所有执行点约束（读后写/预检/事务 runner）不变。
- 已核实（行为测试 4 项）：有档案→保留写权限+信号；无档案→降级；非确认形态→不裁决；已降级授权→不重复裁决。
- 已核实（构建/审计）：build:typecheck:renderer、audit:runtime-declaration 全过、audit:tools（164）、audit:agent-business-boundaries 0 违规、audit:capability-resolver 0 违规、maintenance:validate 22/22、生产构建、git diff --check 全部通过。
- 未核实 / 待验证：真机验证预算熔断后「继续」能恢复写权限并完成原任务；剩余 simplify ⑧-⑨ + cut 继续逐项立项。

## 2026-08-16 治理切片 6：能力可见性按能力面收敛（GATE-SIMPLIFY-006）

- 已核实（deny/ceiling 已天然仅 manifest 生效）：ceiling 由 `resolveSkillRuntimeCapabilityCeiling(manifest, workMode)` 派生、无 manifest 为空；resolver 的 manifestOwnedDenied / manifestRetiredControl 均已 manifest 门控；无 manifest 时唯一的 manifest 语义 deny（skill.* 所有权 deny）被 business-boundaries 10592-10607 钉死为「无 manifest 时业务 skill bridge 必须 deny」的有意契约——按本卡禁止做保留。结论：deny/ceiling 的 manifest 限定在代码里已成立，本轮做核实记录而非改动。
- 已修复（按能力面收敛）：按需目录明细从扁平 40 行截断改为**按能力家族分组截断**——每家族前 3 行代表项明细，全局 40 行封顶不变、省略量如实上报；配合上轮的全量家族总览（不截断），模型在任何运行里都能看到全部能力家族 + 每家族至少一条明细代表。
- 已核实（行为测试）：全量 164 工具 session——每个家族名均出现在目录、靠后家族（context.state 浏览器工具）与 photoshop.write 有明细代表项、全局封顶提示仍在。
- 已核实（构建/审计）：build:typecheck:renderer、audit:runtime-declaration 全过、audit:tools（164）、audit:agent-business-boundaries 0 违规、audit:capability-resolver 0 违规、maintenance:validate 22/22、生产构建、git diff --check 全部通过。
- 未核实 / 待验证：真机验证模型在无 manifest 对话中能主动说出并申请此前不可见的能力家族（如浏览器/联网）；剩余 simplify ⑦-⑨ + cut 继续逐项立项。

## 2026-08-16 治理切片 5：route-boundary 回复文案正则退役（GATE-SIMPLIFY-005）

- 已核实（死代码）：`evaluateDeterministicNonExecutionProtection` 与全部回复文案正则助手在**生产代码零消费者**（执行强制早已随 v3 路由改造退役，仅剩定义）——审计列出的"拦说错"执行事实上不存在运行时危害，是纯死代码。
- 已修复（退役）：回复文案正则与输入接口整体删除（约 -190 行）；导出函数保留墓碑（恒 not_applicable + 退役说明，防未来误导入）；结构化 keep 函数（shouldEnterConversationalRoute 对话路由边界、isSimpleDeterministicShortPathSkill、evaluateSimpleDeterministicRouteBoundary 长输入短路径保护、evaluateDeterministicRouteVeto 结构化否决）原样保留。
- 已核实（构建/审计）：build:typecheck:renderer、audit:tools（164）、audit:agent-business-boundaries 0 违规、简化棘轮 137/137 持平、maintenance:validate 22/22、生产构建、git diff --check 全部通过。
- 未核实 / 待验证：无运行时行为变化（零消费者），无需真机专项验证；剩余 simplify ⑥-⑨ + cut 继续逐项立项。

## 2026-08-16 治理切片 4：视觉三档预算合并为单一运行级视觉池（GATE-SIMPLIFY-004）

- 已修复（池化）：执行层从"候选/分析/Judge 各自上限"改为单一运行级视觉池——池消耗 = visionCandidateCount + visualAnalysisCount + finalQualityJudgeCallCount 之和；池上限 = 候选硬上限 + 配置分析上限（**总量与原两档之和相等，只放宽不收紧**；(1,1) 精准编辑、(0,0) 零视觉语义均不变）。候选额度 = min(ReviewSet 感知上限, 池剩余)；视觉分析容量改读池；Judge 类候选额度与终审画面计划（remainingVisionCandidates）均加池剩余约束。
- 已保留：每类计数器与子 Agent 用量合并行（business-boundaries 文本断言 4294/4295/6083 继续通过）、配置字段与 Profile 预算值（6/3、1/1 等审计断言不动）、终局 Judge 一次性硬上限、ReviewSet 完整集合契约、两个错误码与消息形状。
- 已核实（行为测试）：池互通——(候选6, 分析2) 池=8，连续 8 次视觉分析放行、第 9 次拒绝（旧契约第 3 次即拒）；池耗尽后候选额度归零；(0,0) 零视觉 fixture 第一次即拒绝。
- 已核实（构建/审计）：build:typecheck:renderer、audit:runtime-declaration 全过、audit:tools（164）、audit:agent-business-boundaries 0 违规、audit:capability-resolver 0 违规、简化棘轮 agent.ts 循环分支 21/21 持平、maintenance:validate 22/22、生产构建全部通过。
- 未核实 / 待验证：真机验证池互通对多图任务的实际效果（候选/分析混用时不再被双档卡住）；预算簇治理（①-④）已全部完成，剩余 simplify ⑤-⑨ + cut 继续逐项立项。

## 2026-08-16 治理切片 3：终局质量 Judge 预留取消事前扣减（GATE-SIMPLIFY-003）

- 已修复：删除三处对普通任务预算的事前扣减（模型调用 -1、软时间 -90s、视觉分析 -1、视觉候选收窄分支与 PerformanceToolConsumeContext.reservesFinalQualityJudge 字段）；`shouldReserveFinalQualityJudgeBudget` 与 `resolveFinalQualityJudgeAssertions` 两个死方法删除（断言计算在 Judge 实际调用路径独立存在）。
- 已修复（契约保留并解耦）：ReviewSet 感知的视觉候选上限（同版本完整 ReviewSet 必须装得进候选预算）**不再依赖预留开关、始终生效**；无 ReviewSet 时返回硬上限。终审契约不变，business-boundaries 相关断言继续通过。
- 已修复（硬上限保留）：MAX_FINAL_QUALITY_JUDGE_CALLS=1 与 beginPerformanceModelCall 按 budgetClass 的拒绝逻辑不变。
- 已核实（审计契约迁移，有批准依据）：`audit-capability-resolver.cjs` 旧断言「普通任务必须保留共享 finalization 时间窗」按治理切片 3 立项迁移为 forbidPattern（agent 与账本不得再引用 AGENT_FINALIZATION_TIME_RESERVE_MS），Judge 一次性硬上限断言保留——契约变更依据 CurrentTask 立项，非改断言保绿。
- 已核实（构建/审计）：build:typecheck:renderer、audit:agent-business-boundaries 0 违规、audit:capability-resolver 0 违规、audit:runtime-declaration 行为套件全过（新增「预算不再扣减 + 硬上限保留」断言）、简化棘轮 agent.ts 循环分支 21/21 持平、maintenance:validate 22/22、生产构建全部通过。
- 未核实 / 待验证：真机验证普通任务不再被预留税挤压（首次写入延迟、终局 Judge 调用成功率）；剩余 simplify 项 ④-⑨ + cut 继续逐项立项。

## 2026-08-16 治理切片 2：完成契约推回触发口径收紧（GATE-SIMPLIFY-002）

- 已核实（根因）：run#242「帮我看看这个淘宝链接的设计」被误判写入授权的根因在 `agent-intent-control-plane.ts` 的「参考链接 + 设计/复刻意图」分支——它在只读检查分支之前命中，任何带链接和"设计"二字的请求都签 write_photoshop，零写入后被完成契约推回 plan_execution_mismatch。
- 已修复：READ_ONLY_INSPECT_PATTERNS 新增「链接/网页评审」模式（看看/分析/评审 + 链接 + 的设计/怎么样，句尾锚定、尾部容忍贴 URL）；参考链接分支加 `!isReadOnlyInspectRequest(normalized)` 排除——纯评审走 read_only_inspect，复合委托（看看…然后照着做）仍走 autonomous_execution。
- 已核实（行为测试 4 项）：纯链接评审→read_only_inspect 且不签写范围；无 URL 变体同样只读；复合委托→autonomous_execution；零写入链接评审循环运行不被推回（run#242 回归）。
- 已核实（构建/审计）：build:typecheck:renderer、audit:tools（164 全一致）、audit:agent-business-boundaries 0 违规、audit:simplification-ratchet 意图正则 137/137 持平（新模式为数组字面量，不涨 `.test(` 计数）、maintenance:validate 22/22、生产构建全部通过。
- 未核实 / 待验证：真机复测原 run#242 同型请求（贴淘宝链接问设计分析）不再被推回；剩余 simplify 项 ③-⑨ + cut 继续逐项立项。

## 2026-08-16 治理切片 1：写前观察限量合并（GATE-SIMPLIFY-001）

- 已修复（单一 owner）：「写前观察限量」从两套计数（账本预留区 allowance=2 + agent.ts 轮级守卫 2 轮）合并为 `performance-ledger.ts` 账本单一 owner；agent.ts 的轮级计数/守卫/常量删除（-68 行），交付工具收窄路径保留并由账本指令触发。
- 已修复（放宽）：预留区 allowance 2→4（真实读后写准备序列 3-4 次读取不再被中途打断）；新增写前观察总次数上限 6 次调用（取代 2 轮，预算尾部无关）；两层触发返回同一指令码 `agent_observation_budget_reserved`，只读/聊天/计划任务不设闸（authorizedMutationExpectation 门槛保留）。
- 已修复（指令闭环）：updateLoopGuards 检测到该指令码后返回「不再扩散读取」收窄消息 → liveness 恢复把下一轮可见面收窄到已授权交付动作；无交付工具可收窄时立即诚实停机（no_progress），不再回灌裸错误码。
- 已核实（行为测试按经批准的新契约迁移）：纯账本断言（allowance 4 + 总上限 6）、循环场景 A（6 次观察全放行零指令）/B（第 7 次转指令、只读面运行诚实停机）、收窄测试（6 读→指令→下一轮只见 createRectangle）、护栏反面（只读/聊天/计划不饿死）全部通过。
- 已核实（构建/审计）：build:typecheck:renderer、audit:tools（164 工具全一致）、audit:agent-business-boundaries 0 违规、maintenance:validate 22/22、生产构建全部通过。
- 未核实 / 待验证：合并+放宽后的真机收敛（首次有效写入延迟、观察占比、完成且有写入率）需用户重启加载新构建后积累新运行数据对照；其余 simplify 项（②-⑨ + cut）按账本逐项立项推进。

## 2026-08-16 架构清晰化草稿（ARCH-CLARITY-DRAFT-001，评审中）

- 已核实（现状定义）：OS 文档对 Agent/Harness 的定义总量充分——Agent=Model+Harness、Harness 9 项职责、Capability 六类、14 行 owner 表、v3/v5/bridge/legacy 归一化、四套视角（8 子系统/五层权责/A0-A9/K0-P0）。
- 已核实（六个裂缝）：①「Harness」一词未分层（执行环/治理/交付混在一个词）；②v3/v5 已是混合带而非两条线（autonomous-agent.executor 恒建 Capability Session，declareDesignBrief 49% 失败、能力隐身均发生于此）；③文档状态标注陈旧（OS §2.4 截至 07-13、TaskRun 标未实现而实际 08-13 已做 X1；UXP runner 实际接入 11 个写工具而非记忆中的 5 个——实体在 DesignEcho-UXP/src/core/photoshop-transaction-runner.ts）；④四套视角无提问分工；⑤120 条治理条款淹没架构结构；⑥无载体清单与核对日期机制。
- 已产出：`docs/architecture-clarity-draft-2026-08-16.md`（C 层评审稿）——分层图、Harness 三层单一定义（执行环/治理层/交付层）、视角分工表、「一条执行线三代治理深度」提法、载体清单（真实文件核对）、文档机制建议。待用户对 4 个评审点拍板后升入 A 层 OS 文档。

## 2026-08-16 门禁收益审计 + 能力自知摘要（GATE-BENEFIT-AUDIT-001）

- 已核实（审计方法）：6 个并行研究代理按门禁簇取证（代码守卫实现 + project-memory 事故记录 + diagnose-runs 失败码统计），总账 32 项门禁，产出 `docs/gate-benefit-audit-2026-08-16.md`（C 层专项分析，不直接指导开发）。
- 已核实（处置结论）：cut 1（意图审议闸门，diagnosticOnly 不拦任何事且无事故证据）；simplify 9（执行供给预留与交付前观察上限重叠、完成契约推回触发口径误伤分析请求 run#242、终局 Judge 预留无事故证据、视觉三档预算可合并、route-boundary 回复文案正则拦"说错"应降级 warnings、能力可见性五层三次隐身事故、裸确认降级缺 resume token、预检 A-2 无升级出口）；keep 22（读后写/文档写保护/破坏性确认卡/熔断簇/三态判定等，全部有真实事故支撑且误伤已修）。
- 已修复（能力自知摘要，方案 1）：`capability-session.ts` 按需目录在 40 行明细截断之外，新增**全量能力家族摘要**（按家族聚合：家族名+数量+首工具一句话描述+示例 id，封顶 30 族永不截断）——模型永远知道自己还有哪些能力家族可申请，能力自知不再依赖目录窗口；配合此前 web.searchInternet/web.readPageContent 进基线，淘宝链接类请求第一轮即有路。
- 未实施（需逐项立项批准）：9 个 simplify + 1 个 cut 均只出账本不动代码；实施纪律＝单独立项 → 改代码 → 22 项验证 + 真机收敛指标对照（完成且有写入率、误判"我不会"次数、首次写入延迟）。
- 未核实 / 待验证：家族摘要与基线补强对新运行的真机效果（模型能否在首轮正确路由到联网/读页工具）；完整验证与生产构建见本轮结果。

## 2026-08-16 全量 164 工具「理解→使用」审计（TOOL-UNDERSTANDING-USAGE-AUDIT-001）

- 已核实（审计方法）：15 个子代理并行完成——14 个静态批次逐工具核五维（schema 描述/参数、语义边界、反例、分发闭合、写类读回指引）+ 1 个真实运行证据分析（`diagnose-runs` 全量 459 条 agent-run-record/v0，5189 次工具调用、724 次失败）。
- 已修复（分发缺陷）：`inspectDetailPageLivePlacements` 实现类完整但从未注册进 UXP ToolRegistry、Agent 侧也无分发——模型可见不可执行。已注册进 `DesignEcho-UXP/src/tools/registry.ts` 详情页工具组。
- 已修复（读回指引系统性缺失）：`withPhotoshopToolSkillDescription` 现把 `verifyWith` 以「执行后复核: …（只有真实读回确认后才能继续或宣称完成）」追加进每个工具描述——覆盖全部 photoshop_write/save_export 类（此前只拼能力边界/副作用/不适用）。
- 已修复（B/C 专属指引）：约 30 个高频/破坏性写类工具此前只有通用兜底、无专属条目；已补 USER_INTENT_BOUNDARY_OVERRIDES（createDocument/moveLayer/reorderLayer/duplicateLayer/renameLayer/setTextContent/setTextStyle/createRectangle/createEllipse/quickExport/smartSave/deleteLayer/setLayerOpacity/setBlendMode/groupLayers/createGroup/addDropShadow/addStroke/lockLayer/setLayerVisibility/batchExport/createClippingMask/releaseClippingMask/replaceLayerContent/transformLayer/quickScale/renderLayout/clearLayerEffects/delegateToAgent/runDesignTeamPipeline）与 DO_NOT_USE_OVERRIDES（closeDocument/deleteLayer/cropDocument/resizeImage/resizeCanvas/gaussianBlurLayer/deleteLayerMask/replaceLayerContent/replaceSmartObjectContents/setLayerVisibility/createDocument/batchExport/delegateToAgent/runDesignTeamPipeline/createClippingMask/releaseClippingMask/applyMorphedImage）。
- 已修复（A 参数描述，高频子集）：getDocumentSnapshot/getAcceptanceSnapshot/getCanvasSnapshot/getLayerHierarchy/getLayerBounds/getLayerProperties/getTextContent/getTextStyle/resolveFontName/moveLayer/reorderLayer/createTextLayer/placeImage/replaceLayerContent/getElementMapping/analyzeLayout/listProjectResources/searchProjectResources/openProjectFile/describeImage/analyzeAssetContent 补齐参数描述与「何时用」。**剩余债务**：约 120 个低调用量工具的参数描述仍缺失（RAW_TOOL_CATALOG 系统性缺省），已记录待后续批次补。
- 已核实（真实运行证据，未修——属契约/预算层而非描述层）：①declareDesignBrief 失败 186/381（49%，input_ref_not_resolved_for_key 反复拒）为最大单一失败源；②sku-batch 57 次失败多为 current_document_write_protected（模型在未绑定为写入目标的文档上动手）；③观察类调用占业务动作 43%（getDocumentInfo 616 次、getLayerHierarchy 372 次）；④164 个工具中 78 个（47.6%）真实运行 0 次出现（对齐/分布/图层样式/调整层/morphing/抠图等能力从未被调用）；⑤完成且有写入 21/459（4.6%），较治理前基线 9.2% 回退。后续切片候选：declareDesignBrief 契约修复、未绑定目标写入的提前指路、闲置能力面收敛。
- 已核实（构建/审计）：`build:typecheck:renderer`、`audit:tools`（164 工具全一致）、`audit:agent-business-boundaries` 0 违规通过；完整 `maintenance:validate` 见本轮结果。
- 未核实 / 待验证：补强后的工具指引对真实运行选择质量的改善（首次写入门禁通过率、声明类失败率、闲置工具被启用情况）需真机积累新运行数据后对照。

## 2026-08-16 浏览器助手增强：页面图片进视觉通道 + 长页拼接截图（BROWSER-EXT-VISUAL-REF-001）

- 已核实（现状缺口）：`DesignEcho-Browser-Extension` 原 1.0.0 只有 5 个方法（listTabs/readPage/capture/navigate/interact）；readPage 只回文字/链接/元素，capture 只截可见屏——「看淘宝详情页图片做参考」场景需要用户登录态的页面图片像素与整页视觉，原实现都够不到。
- 已修复（扩展 1.1.0，`lib/page-scripts.js` + `lib/handlers.js`）：①`readPage` 新增 `includeImages/maxImages/maxImageEdge`——页面脚本收集 ≥100px、去重的候选 img 元数据，service worker 用扩展 host_permissions 带 credentials 跨域逐张下载、解码、二次尺寸过滤（剔除占位像素）、缩边 ≤1024px 后回传 `images[{src,alt,width,height,base64,format}]`；单张失败（防盗链/CORS/超时/过小）只记 `imageWarnings`，不整体失败。②`capture` 新增 `fullPage/maxSlices`——按真实 scrollY 逐屏滚动截图、OffscreenCanvas 纵向拼接（默认 ≤3 屏、总高封顶 9600px、DPR 按 scaleY 校正），返回 `sliceCount/truncatedFullPage`，finally 滚回原滚动位置。
- 已核实（视觉通道接线）：`images` 是 `tool-result-sanitizer.ts` 的 DIRECT_IMAGE_CONTAINER_KEYS 且 `base64` 是 IMAGE_PAYLOAD_KEYS，readPage 返回的每张图会被 `attachToolImageObservations` 收集进模型视觉通道，受既有视觉候选预算上限约束；readBrowserPage 已在 `external-content-trust.ts` 不可信外部内容登记内，图片内容沿同一信任边界（数据不是指令）。
- 已核实（Agent 侧同步）：`tool-schemas.ts` 两个工具 schema/描述与 `tool-executor.service.ts` 工具信息表同步新参数；参数经 `browserBridge:call` 原样透传，未新增桥方法/工具名；`docs/browser-extension-bridge.md` 协议表与扩展 README 已同步；扩展 manifest 1.0.0 → 1.1.0。
- 已修复（工具选择指引，纯描述层、不设路由闸门）：`photoshop-tool-skill.ts` 的 `USER_INTENT_BOUNDARY_OVERRIDES` 补 `webSearch` / `fetchWebPageDesignContent` / `searchDesignKnowledge` / `searchEagleReferences` 边界条目（各工具"何时用/何时不用"一句话，进模型提示），更新 `readBrowserPage`/`captureBrowserTab` 条目反映 includeImages/fullPage；`TOOL_USAGE_WARNINGS` 补 `webSearch`（搜索结果是外部数据不是已核实事实、够用时不要重复搜）与 `captureBrowserTab`（扩展未连接/截图失败不得假装看过画面、长页不要只凭一屏下结论）反例，`readBrowserPage` 补"没传 includeImages 不得假装看过图片"。
- 已核实（构建/审计）：扩展 5 个 JS 文件 `node --check`（ESM）通过；`build:typecheck:renderer`、`audit:tools`（164 工具全一致）、`audit:agent-business-boundaries` 0 违规、`git diff --check` 与 `maintenance:validate` 22/22 全部通过（含 UXP production build）。
- 未核实 / 待验证：真实浏览器端到端——浏览器里重载扩展 1.1.0 后，用真实淘宝详情页验证 `readBrowserPage(includeImages:true)` 拿到商品图像素并进入视觉理解、`captureBrowserTab(fullPage:true)` 拼出完整长图；防盗链/CDN 实际命中率与图片质量需真机确认。

## 2026-08-16 给设计 Agent 增加联网搜索能力（WEB-SEARCH-AGENT-TOOL-001）

- 已核实（后端机制）：DeepSeek Harness 的 web_search 后端是 DeepSeek 官方 Anthropic 兼容 Messages API（`POST https://api.deepseek.com/anthropic/v1/messages`）+ 原生 `web_search_20250305` 服务器工具，凭据即 `DEEPSEEK_API_KEY`——与 DesignEcho 已配置的 DeepSeek provider 共用同一把 key，无需新增订阅。主进程新增 `web-search-service.ts` 按其 provider 逻辑移植：只解析结构化 `web_search_tool_result` 来源（url/title/page_age + citation snippet），按 URL 去重、上限 10 截断、45 秒超时、不信任 provider 生成文本、绝不从文本抓 URL。
- 已修复（工具接线）：新增 `webSearch` 原子工具并完成全部注册点——tool schema + `DEFAULT_AGENT_TOOL_NAMES`、preflight `KNOWLEDGE_SEARCH_TOOLS`、`photoshop-tool-skill.ts` 同名集合（`audit:tools` 校验两源一致）、`RENDERER_LOCAL_TOOLS`、执行分发 case、`external-content-trust.ts` 外部内容信任标记（防提示注入）、IPC channel `webSearch:search` + preload + `types.d.ts`、团队研究类角色（scene-analyst / market-researcher / design-strategist）白名单、显示名与结果预览。分类为 `knowledge_search`：只读、可并发、不受读后写纪律拦截；executor 类角色不开放。
- 已修复（边界语义）：工具描述要求「只在本地知识库 / 项目事实 / Eagle 无法回答真实问题时按需检索」；结果必须标注来源 URL、只提取可迁移方法、禁止照抄；未配置 key / 无结果 / 超时 / 网络失败返回结构化不可用与可行动下一步，不阻断设计；所有结果带 untrustedExternalContent 信任标记。
- 已核实（构建/审计）：`build:typecheck:renderer`（Main + Renderer）、`audit:tools`（164 工具，显示名 / scope / 两源同步 / 团队白名单全一致）、`audit:agent-business-boundaries` 0 违规、`audit:executor-generic` 0 违规、简化棘轮持平、`git diff --check` 与完整 `maintenance:validate` 22/22 全部通过（含 UXP production build）。
- 已核实（真机教训）：用户重启桌面端后 Agent 仍答「实时互联网搜索不属于我的能力范围」——根因是**渲染进程 production bundle 从未重建**：类型检查与 maintenance:validate 均不含 vite build，dist/renderer 一直是旧代码，模型没看到 webSearch 工具。已执行 `npm run build`（clean + build:main + build:renderer），并在产物中核实 webSearch 工具描述（1 个 renderer 资产文件）与 `webSearch:search` IPC 通道（1 个主进程文件）均已进入 dist。后续每次改渲染侧工具/schema 后必须 `npm run build`（或 `build:renderer`）再让用户重启，类型检查通过不等于应用加载了新代码。
- 未核实 / 待验证：真实 DeepSeek API Key 下的真实联网搜索（首次搜索延迟、来源质量、citation snippet、超时与缺 key 降级）仅为代码级验证；当前应用需再次重启并加载新构建后 `webSearch` 才对模型可见，真实搜索行为待真机确认。

## 2026-08-16 SKU 确定性排版与暂存目录修复（SKU-LAYOUT-DOCUMENT-SCOPE-001）

- 已核实（真实失败现场）：12:45 的 SKU continuation 确实进入 15 个组合和 3 个自选备注的 Photoshop 编排，但 18 个布局全部被实时边界 QA 拒绝，最终导出 0 张。源 SKU.psb 与 6 份模板磁盘文件未被本轮保存覆盖；输出目录仅遗留空 `.designecho-staging` 父目录，没有可恢复图片。
- 已修复（写目标一致性）：UXP 的 SKU 缩放、移动、失败回滚删除与最终读回均先绑定精确 `(documentId, layerId)`。缩放优先调用 Photoshop UXP 正式 `Layer.scale()`；宿主回退只在精确选中目标后发送不带错误复合 `_target` 的 `transform`，并检查 select /transform 错误描述符。缩放后尺寸和移动后中心必须立即由同一 document/layer descriptor 读回命中计划，否则在导出前失败。
- 已修复（模板识别）：纯数字名不再单层自证占位语义；顶层数字 `group` 只有在形成合法连续 `1..N`、数量符合、全部在画布内、不重叠、间距与视觉顺序正确时才是 ordered slots。数字命名的隐藏 `solidColor / shape` 仍可经过完整几何校验成为 legacy region，因此已验收 `4双装.tif` 的两个区域 `2 / 1` 会被确定性识别为 `legacy_multi_regions`，容量为 `[3,1]`；单独越画布的数字设计组 `3` 继续被排除。
- 已修复（几何预检）：`inspectTemplateLayout` 在执行前确定性检查画布范围、槽位数量/容量、重叠、最小间距、顺序与区域几何；这些检查只阻断确定做不到的布局，不重设计已批准占位符，不放宽写后 QA。
- 已修复（暂存生命周期）：Main / Preload / Renderer 只暴露 SKU 专用 `removeSkuStagingParentIfEmpty`，主进程仅允许非递归删除 `SKU\\.designecho-staging`。任意其他目录、符号链接、路径歧义和非空目录均失败关闭；清理问题只是 maintenance advisory，不伪造 SKU 交付失败。
- 已修复（无弹窗清理与失败关闭）：Photoshop delete 返回 `_obj:error`、负 `result`或成功描述符但目标文档 DOM 仍含该 layerId 时，pending ID 不会被清空；结构化 `sku-layer-cleanup-failure/v1` 继续贯穿 SKU Skill 外层并立即停止后续批次。delete 成功后不再对预期已经不存在的 layerId 执行 `_obj:'get'`，避免“命令‘获取’当前不可用”宿主弹窗；目标文档 DOM 仍在可稳定拦截 delete no-op，同 ID 的其他文档不参与判定。
- 已修复（旧入口失败关闭）：`executeOne / executeBatch` 仍使用旧图层索引协议，缺少模板预检、实时几何 QA 与事务导出，已从 Agent schema 和 UXP capabilities 移除；即使被旧客户端直接调用也返回明确失败，不会绕过 `sku-batch → action=execute` 的生产合同。
- 已核实（15:21 真机复跑）：4 双数字纯色区域识别已经通过，SKU Skill 正常完成 2 /3 /4 双模板预检、出组合卡并进入真实复制排版，证明 15:03 的模板误判已关闭。新失败发生在首个 2 双组合的 mutation adapter：生产 planner 对 B2 与两张 193×293 色卡给出互不重叠的左右目标框，但 Photoshop 实际尺寸未按 174.849% 缩放，最终 QA 拒绝偏框、越界与重叠。失败清理随后对已删除 ID 发 get，造成用户截图中的宿主弹窗。
- 已核实（当前代码验证与装载）：UXP production build、Agent production build、Main / Renderer typecheck、正式 business audit（0 violations）与完整核心预检（22/22）均通过。最新 Agent 已重启；UXP Developer Tools 已校验并重载插件，Photoshop 桥接健康检查为 `ready`。
- 未核实 /待验证：修复后的 transform 与无弹窗清理尚未在真实 Photoshop 完整跑完 18 个输出。需要重新发起一张新的 SKU 确认卡（旧 continuation 已终止），期望 2 /3 /4 双各 5 组 + 3 个自选备注；以正式文件、同 revision QA 和没有宿主弹窗为准。

## 2026-08-14 主图商业质量生产链根修（MAIN-IMAGE-COMMERCIAL-QUALITY-001）

- 已核实（真实运行）：用户截图中的空灰块来自桌面端重启时中断的半成品；后续“继续”丢失原整套任务身份，退化为 generic autonomous text edit。两次续跑均未绑定主图 Manifest、项目素材视觉观察、参考检索或 R5 评审，因此不能把该截图解释成“主图 Skill 已完整执行但审美差”。
- 已修复（父子 Owner）：`ecommerce-socks-design` 不再给主图默认铸造 `product-disposable-live` 与四个 approval true，也不再直调声明为 `autonomous-react-loop` 的 legacy child executor。主图、详情页、SKU 子项统一以 `runtimeSelectedSkillHandoff + declaredSkillId/taskType/workMode` 进入各自 Manifest-owned autonomous Runtime；父级只下发和汇总。
- 已修复（质量所有权）：父级不再把 child `completed/partial/needs_review` 自动升级成整套成功；只有所有子报告显式 `canClaimOutputQuality=true` 才能成功。主视觉缺真实素材时，灰色占位会产生 `main_image_placeholder_unresolved` repair finding，不能再作为成品通过。
- 已修复（主图知识与验收）：主图 Runtime 注入完整 click/structure/review 方法分面；Profile 补 `req.brief-coverage` 与 `craft.asset-integration`。legacy-only `main_image_qa_report` 改为可选兼容记录，canonical 完成继续由 fresh structure、fresh visual 与 Profile assertions 所有。
- 已修复（模型拥有视觉方向）：`renderLayout` 不再用白底、黑字、浅蓝卖点块的隐藏代码预设替模型设计。正式草稿必须由模型根据 R3、当前事实、可信记忆和参考声明 `model_authored` 的配色、字体层级与卖点载体；省略样式只产生灰阶 `neutral_wireframe`，并保留不可交付 finding。R3 可按需记录 2–3 个方向、选择与理由，不强制探索、不默认第一项，也不取得权限/进度/质量所有权。
- 已修复（正式构图不再吃隐藏几何）：`model_authored` 的区块比例、对齐、间距、真实图片裁切 /锚点 /缩放 /遮罩、背景色与文字拟合都必须显式声明；非法边界在写前失败，不再静默夹回画布。文字拟合与 UXP 最终写入保留原有空白和换行，并返回逐块 fit receipt。布局质量按文档、阶段与 `screenRegion` 独立归属；不同屏幕的通过结果不能关闭另一屏的占位或失败，只有同目标新 revision 的有效复核或有删除收据的完整草稿退役才能闭合。
- 已修复（知识与记忆真相源）：Context Compiler 现在先保留当前项目事实、真实观察和已审核记忆，再用剩余预算放通用方法；R3 只可引用实际 included item。项目记忆使用稳定 projectId 或不可逆路径指纹，自动检索只根据当前任务相关度，不再拼接主图/详情页/SKU 等固定词；操作推断和待审来源不能冒充 `local_reviewed`。
- 已修复（能力归属）：主图 Manifest 声明可选参考、知识、项目记忆与通用 Photoshop 设计原子能力；主图/SKU 方法仍归各自 Manifest/Skill，通用 Agent 未新增品类正则、固定视觉配方或业务工具表。
- 已核实（构建/审计）：`audit:agent-business-boundaries` 0 违规，新增父工作流 Manifest-owned child 行为矩阵通过；`maintenance:preflight:core` 22/22 通过；Agent production build 通过；UXP production build 随核心预检通过；规划一致性、project-state JSON 与 `git diff --check` 均通过。
- 未核实 / 待验证：本轮没有让真实 Photoshop 重新完成同一项目主图，因此不能宣称已经达到淘宝商业水准。真实验收必须核对主体、唯一点击理由、事实证据、文字层级、占位清零与 300×300 缩略图；真实 CandidateSet、非破坏性低成本预览和候选间同 rubric 比较仍是后续切片；普通自然语言运行跨重启的 durable active-task 恢复是独立 Harness 切片，不能用聊天历史猜测掩盖。

## 2026-08-14 技能可插拔性验证（"技能是否变成了 Agent 内置系统"）

- 已核实（主循环）：agent.ts 全部 24 处业务符号均为注释（真机病例/治理说明），零业务代码分支。
- 已核实（能力面）：capability-session 无技能运行时暴露 41 个通用工具，业务执行工具不可见、业务技能 Manifest 绑定前不可激活；可见面由 manifest 驱动。
- 已核实（提示词）：生产提示词品类中立；enhanced-agent-prompt.ts 零导入死代码。
- 已核实（纪律运行时）：design-discipline-runtime 的详情页命中 21/25 为注释/病例，4 处代码是工具名单数据（fillDetailPage/exportDetailPageSlices 复核工具表、参数化文案），非控制流分支。
- 已核实（硬编码技能 id 分布）：合法数据/注册层（design-task-types、design-domain-knowledge、business-skill-*、photoshop-tool-semantics、评价适配器 contributions、conversational 显示名映射）+ 棘轮化兼容债（agent-intent-control-plane、agent-task-planning-contract、agent-tool-execution-preflight、agent-route-boundary-policy 13 处、skill-param-defaults、routing 提示层）。
- 判定：**技能没有变成 Agent 内置系统**。新品类 = design-task-types 加一条 profile + manifest + 声明，通用循环/Planner validator/Policy 核心/发送管线零改动（Prompt.md C.3 判据成立）。残余品类字面量全部有合法 owner 或债务棘轮，无新增。

## 2026-08-14 技能治理切片 1（SKILL-GOVERNANCE-001：主图成功语义 + 详情页视觉死锁出口）

- 已核实（代码，主图）：strategy-only 两条 return 由 `success:true` 改为 `success:false + nonFatal:true`（main-image.executor.ts:1298-1325），消息补"也不算完成"与"继续用当前画布工具实际制作"；`AgentResult` 增加可选 `nonFatal` 字段（agent-orchestration/types.ts，与运行时既有 nonFatal 约定一致，注明不得升级为完成）。
- 已核实（代码，详情页）：检测 `isRuntimeVisualReviewBlocked(readAgentVisualObservation(snapshotResult))`（detail-page.executor.ts），命中时 completionWarnings 追加诚实出口（人工查看后明确指示保存/导出），`awaiting_visual_review` 续跑摘要与 reason 不再承诺运行时做不到的"逐屏查看"路径；deliver 门 / requiresVisualPass 未动（视觉纪律红线，开闸留待专门切片）。
- 已核实（边界）：全程未碰任何 SKU 文件；期间业务边界审计短暂出现 `sku-batch:note-generation-not-bound-to-explicit-note-request` 违规（并行修改 SKU 的 Agent 所致），随后其修复落地，审计恢复 0 违规。
- 已核实（构建/审计）：`build:typecheck:renderer`、简化棘轮 21/21、executor-generic 0 违规、完整 `maintenance:validate` 22 项通过；production build 后应用已重启（PID 55232，8765 就绪），Photoshop 桥接 `ready`（插件自动重连成功）。
- 未核实 / 待验证：两个修复的真实运行表现（主图方案不再报完成、详情页视觉不可用时给出诚实出口）。

## 2026-08-14 业务渗透 Agent 内部审计（无技能设计能力验证）

- 已核实（运行时可见面，品类中立）：无 manifest 绑定 + write_photoshop 授权时，capability session 暴露 41 个通用工具（文档/快照/图层/文本读写/placeImage/renderLayout/removeBackground/fitLayerSubjectToRegion/设计知识/参考），**业务执行工具全部不可见**（skuLayout/parseDetailPageTemplate/exportWhiteBgFromSkuMaterial/analyzeProjectForDetailPage 均不在 activeTools；实测脚本验证）。业务技能在 Manifest 绑定前不可按需激活（manifestRequiredCapabilityIds 门禁）。
- 已核实（生产提示词，品类中立）：生产 system prompt = buildBaseSystemPrompt + buildBaseCapabilityPolicyPrompt（autonomous-agent.executor.ts:2619-2650），零业务词；`shared/prompts/enhanced-agent-prompt.ts` 是零导入死代码（旧业务重提示词，可清理）。
- 已核实（无技能设计能力存在）：HARNESS_BASELINE_CAPABILITY_IDS（capability-resolver.ts:45-70，含写保护三出口 openProjectFile/switchDocument/createDocument，07-31 教训已修）+ DESIGN_EXECUTION_FOUNDATION_CAPABILITY_IDS（capability-session.ts:103-113，通用工艺，注释明确抠图非业务专属）。眼/脑/手齐备。
- 已核实（残余渗透面，均有棘轮但未清零）：agent-intent-control-plane.ts 84+35+21 业务词条（ratchet 22 基线）；agent-task-planning-contract.ts 82 处（基线 51）；agent-design-execution-preflight.ts 52 处（基线 40）；skill-routing.ts 35 处；design-discipline-runtime.ts 品类数据 25 处（D→B 治理中）；无技能基线可见 getMainImageDesignFramework/getDetailPageDesignFramework 两个品类知识工具（知识层，非执行渗透，属按需目录小瑕疵）。
- 已核实（棘轮现状）：audit:executor-generic violationCount=0；audit:skill-coupling 33/42 低于基线（main-image 11/14、sku-batch 14/18）；audit:agent-business-boundaries violationCount=0。
- 未核实 / 待验证：**无技能设计的真实 Photoshop E2E 从未验证**（live_no_skill_design_e2e_unverified）——能力面齐备不等于端到端能完成设计。

## 2026-08-14 三个业务技能结构审计（SKU / 主图 / 详情页）

- 已核实（440 条运行档案按类目统计）：SKU 192 次运行零写入 81%、完成且有写入仅 2；主图 36 次零写入 86%、完成 1；详情页 131 次零写入 87%、完成 8。
- 已核实（主图，最重）：默认 `mainImageExecutionMode='strategy-only'`（声明 1531 + main-image.executor.ts:136-139/1272-1322 恒 success:true 零写入）；live 授权是模型自赋布尔 approvedLiveExecution/approvedLiveAdapterRun（1537-1538，无人审闸门）；受控路径无文案写入工具（101-114）；live adapter 写入不绑 documentId/revision；白底图能力被窄化为 SKU 素材导出。判定：策略层自洽、交付层结构性空转。
- 已核实（SKU）：完成判定链严谨（读回+行数+视觉指标），但 `success:true + exportCount:0` 被复用于组合确认卡 :4278 / 模板方向卡 :3750 / 色卡草稿源就绪 :3135/:3171（completed 零写入的技能层根因）；执行器主体写入直接 executeToolCall（:2422/:3278/:5773/:6000），guardedAtomicToolExecutor 仅色卡子路径用（:2280/:2562）——写入绑定完整性待查 executeToolCall 的 pre_dispatch 兜底；nonFatal 移交无持久状态（:3896/:4593）；6526 行单执行器 + 43 处正则。
- 已核实（详情页）：freshDetailPage 状态机已通用化（design-discipline-runtime.ts，AGENTS.md 债务描述已过时，audit:executor-generic 已下降）；完成链要求 snapshot_identity+observation_version+visual_bundle 全绿（detail-page.executor.ts:2368-2395/2445-2448），视觉永久不可用恒 needs_review 永不导出，而通用纪律已有 RUNTIME_VISUAL_REVIEW_BLOCKED_REASONS 逃生舱（design-discipline-runtime.ts:298-316）但执行器未消费——最小成本最高收益的接线点；exportResult 恒 undefined 两段式交付；edit_existing 仍跑全量 analyzeProjectForDetailPage；写保护全仓唯一强制点 autonomous-agent.executor.ts:1790，嵌套写经 executeToolCall 不重查（待查兜底）。
- 建议修复顺序（待用户指定）：详情页逃生舱接线 → 主图 P0（授权改人审交互卡 + 策略成功改 needs_review）→ SKU success 语义拆分 + 交接持久化。

## 2026-08-14 Harness 完成所有权治理（HARNESS-COMPLETION-OWNERSHIP-001）真机迭代 1

- 已核实（真机 run #439）：治理装载后第一条真实运行（15:35）——模型正确识别 SKU.psb 并调用 `sku-batch`，被 `current_document_write_protected` 拦下（详情页.psb 受保护）；随后 2 次只读观察后停，`plan_execution_mismatch`、mutation 0/1、观察 8/8、stageState E1/awaiting_outcomes。
- 历史方案（已于 2026-08-21 退役）：当时由 `resolveRequiredToolRecovery` 读取或合成解锁 allowlist `[switchDocument, openProjectFile, createDocument]`。当前实现只把这些字段作为恢复选项，不再由 Harness 限制下一轮工具面；该历史结论不可继续作为当前代码事实。
- 已核实（构建/审计）：`build:typecheck:renderer`、简化棘轮 21/21、完整 `maintenance:validate` 22/22 通过；production build 后应用已重启（新 PID 22740，8765 就绪）。
- 未核实 / 待验证：本次重启后 Photoshop UXP 插件未自动重连（photoshop_plugin_not_connected），需用户在 Photoshop 内点击 DesignEcho 面板或经 UXP Developer Tool 重载插件后复测「帮我做SKU」。

## 2026-08-14 Harness 完成所有权治理（HARNESS-COMPLETION-OWNERSHIP-001）新构建已装载

- 已核实（构建）：用户要求「确保代码生效」后执行完整 production build（`npm run build`，renderer bundle 15:33:52 生成）；验证 4 个治理特征串（切片 1 诚实停止文案、切片 2 预留区执行指令、`completion_contract_unsatisfied_zero_progress`、`agent_observation_budget_reserved`）全部进入 dist。
- 已核实（手测/运行）：旧 Electron 进程已结束，应用以新构建重启（PID 39900，15:34:16 起），WS 8765 就绪；`maintenance:photoshop-bridge-health` 返回 `ready`、无 blockers——Photoshop 内 UXP 插件已自动重连新 Agent 服务。
- 当前状态：治理代码已在运行中的应用内生效；收敛数据待用户按切片 5 清单执行真实任务后产生。

## 2026-08-14 Harness 完成所有权治理（HARNESS-COMPLETION-OWNERSHIP-001）双路径覆盖验证

- 已核实（代码追踪）：完成所有权在两条运行路径上均闭合——①无 manifest 绑定的默认自主路径：零业务动作停话走切片 1 闸门（完成契约推回 → 诚实停止）；②manifest 绑定的技能路径：`resolveUnfinishedExecutionObligation` 在收尾前依据活跃 `runtimeSession.stageState` 返回 `runtime_stage_incomplete`，经 `decideStageIncompleteRecovery` 有界推回，耗尽后以 `plan_execution_mismatch` 诚实停止——两条路径无重叠无漏洞。
- 已核实（数据）：运行档案仍为 436 条，最新记录 2026-08-14 14:49（旧代码）；治理后新构建的运行数据仍未产生。

## 2026-08-14 Harness 完成所有权治理（HARNESS-COMPLETION-OWNERSHIP-001）切片 4 批次 2

- 已核实（代码）：最终摘要纯逻辑（`buildSummaryFromStatefulWrites` / `readOutputPathFromToolResult` / `buildToolResultFallbackMessage` / `shouldRequestRicherFinalSummary`，共 107 行）抽取为 `src/renderer/services/agent-runtime/final-summary.ts`；`agent.ts` 13473 → 13418 行，薄包装注入运行态事实（工具日志、画面改动观察、保存/导出成功、预算与意图作用域）。行为零变化；提前扫描确认无审计匹配串受影响，无需迁移断言。
- 已核实（构建/审计）：`build:typecheck:renderer`、`audit:simplification-ratchet`（21/21 持平）与完整 `maintenance:validate` 22 项通过（含全部治理行为测试与 UXP production build）。
- 未核实 / 待验证：真实 Photoshop 上的治理行为表现（切片 5 清单见 CurrentTask）；脏工作树保持原样未提交。

## 2026-08-14 Harness 完成所有权治理（HARNESS-COMPLETION-OWNERSHIP-001）防御性完整复查

- 已核实（代码终态复核）：切片 1 闸门终态正确——推回并入既有 `earlyStopRemediation` 单一分支（≤2 次共用计数）、零业务动作推回耗尽诚实停止（`plan_execution_mismatch` + `completion_contract_unsatisfied_zero_progress`）、has-progress 原路径行为保留；切片 2 预留闸在 `performance-ledger.ts` 单一 owner 内，交付动作尝试后开闸。
- 已核实（编码/卫生）：`performance-ledger.ts` UTF-8 无 BOM、LF 行尾；`check:repository-encoding` 1075 文件全通过；`git diff --check` 通过；新模块为未跟踪新文件（随脏工作树人工提交）。
- 已核实（数据）：运行档案 436 条，最新记录 2026-08-14 14:49（文档保护边界的既有路径，非治理闸门触发）；治理后新构建的运行数据仍未产生，`--convergence` 与基线持平属预期。
- 已核实（构建/审计）：`maintenance:validate` 22 项通过；治理变更完整验证矩阵：类型检查、简化棘轮 21/21、executor 通用性、业务边界、能力解析、工具注册、规划一致性、仓库卫生全部绿色。
- 未核实 / 待验证：真实 Photoshop 上的治理行为表现（切片 5 清单见 CurrentTask）；脏工作树保持原样未提交。

## 2026-08-14 Harness 完成所有权治理（HARNESS-COMPLETION-OWNERSHIP-001）收敛对照工具

- 已核实（工具）：`debug:runs --all --since <月份> --convergence` 输出「完成且有写入」率与观察占比，并自动对照 `project-state.json` 的 `convergenceBaseline`（2026-08 治理前基线：完成且有写入 20/217=9.2%、观察占比 1484/1860=79.8%、零写入 66.4%）打印 Δ 与收敛判据；只报告不判定失败，收敛由人评估。
- 已核实（数据）：运行档案当前 436 条；最新记录仍为 2026-08-14 13:31 前旧代码时段，治理后暂无新构建运行数据；`--convergence` 当前输出 20/218（9.2%）与 79.9% 与基线持平。
- 已核实（构建/审计）：`maintenance:planning-check`、JSON 校验、`git diff --check` 与完整 `maintenance:validate` 22 项通过。
- 未核实 / 待验证：真实 Photoshop 上的治理行为表现（切片 5 清单见 CurrentTask）；脏工作树保持原样未提交。

## 2026-08-14 Harness 完成所有权治理（HARNESS-COMPLETION-OWNERSHIP-001）治理路径行为测试

- 已核实（行为测试）：`audit-runtime-declaration-resolver.cjs`（maintenance:validate 既有可复用行为套件）新增 3 项治理断言并通过——①切片 2 纯账本（预留边界、写入前观察 allowance=2、超限转 `agent_observation_budget_reserved`、交付动作尝试后开闸、硬预算兜底）；②切片 1 真实循环（零业务动作停话被有界推回，最终 `plan_execution_mismatch` + `completion_contract_unsatisfied_zero_progress`，不吞成 final_response）；③切片 2 真实循环（maxToolCalls=15 下恰好 14 次观察执行，第 15 次起转执行指令且不真正执行）。非新增一次性 smoke，属既有正式测试套件扩展。
- 已核实（行为测试，护栏反面）：聊天（chat_only）、只读检查（read_only_inspect）、计划（plan_only）请求均不进入完成推回；只读分析在同预算形状下 14 次观察全部放行、零执行指令（不被执行供给预留饿死）。防 07-31 门禁事故复发的关键断言已固化。
- 已核实（构建/审计）：完整 `maintenance:validate` 22 项通过（含新测试与 UXP production build）；`git diff --check` 通过。
- 未核实 / 待验证：真实 Photoshop 上的治理行为表现（切片 5 清单见 CurrentTask）；脏工作树保持原样未提交。

## 2026-08-14 Harness 完成所有权治理（HARNESS-COMPLETION-OWNERSHIP-001）切片 4/5

- 已核实（代码，切片 4 批次 1）：预算账本（模型/工具/视觉候选/视觉分析/终局 Judge/质量复核/预留区观察计数与活跃时长共 11 个状态字段）与纯记账函数（耗尽判定、执行供给预留、质量复核上限、活跃时长）抽取为 `src/renderer/services/agent-runtime/performance-ledger.ts`（约 310 行）；`agent.ts` 13587 → 13473 行，保留薄包装注入运行态事实（授权期望、交付动作尝试、终局 Judge 预留、画面改动观察）。行为零变化。
- 已核实（审计同步维护，D-083）：静态审计的 agent.ts 文本断言随标识符改名同步迁移——`audit-agent-business-boundaries` 4 处、`audit-capability-resolver` 1 处、`audit-runtime-declaration-resolver` 行为测试 1 处、`audit-tool-registry` 负向正则 1 处。断言语义与失败条件不变，只跟随唯一 owner 新位置；任何后续移除对应模式仍会失败。
- 已核实（构建/审计）：`build:typecheck:renderer`、`audit:simplification-ratchet`（21/21 持平）、`audit:agent-business-boundaries`（violationCount=0）、`audit:capability-resolver`、完整 `maintenance:validate` 22 项全部通过；UXP production build 通过。
- 已核实（文档侧切片 5）：真机验证清单已写入 CurrentTask（零写入推回 / 预留区观察转执行 / 写后读回开闸 / 收敛指标对照），待用户执行后回填；未真机验证不写完成。
- 未核实 / 待验证：真实 Photoshop 上的治理行为表现；脏工作树 303 项共享改动保持原样未提交。

## 2026-08-14 Harness 完成所有权治理（HARNESS-COMPLETION-OWNERSHIP-001）切片 2/3

- 已核实（代码，切片 2 执行供给预留）：`consumePerformanceToolCallBudget` 在「已授权写入（write_photoshop 意图或结构化交付义务，单一 owner `hasAuthorizedMutationExpectation`）且尚无交付动作尝试」时启用尾部预留区——工具预算最后 min(6, 20%) 次调用只放行 ≤2 次写入前观察，其余观察/检索转为执行指令（`agent_observation_budget_reserved`，designer 语言）；已有交付动作尝试后不设闸，写后读回与 unknown 现场确认始终放行。与既有 `PRE_DELIVERY_OBSERVATION_ROUND_LIMIT`（轮级、结构化计划义务）互补不重复。
- 已核实（代码，切片 3 收敛指标）：`debug:runs` 汇总新增「完成且有写入」率与真实写入/观察/业务动作计数。
- 已核实（真实运行记录，收敛基线）：2026-08 217 次运行——完成且有写入 20（9%）；真实写入合计 143 次 vs 观察调用 1484 次（占 1860 次业务动作的 80%）。该组数字是治理收敛对照基线。
- 已核实（构建/审计）：切片 2/3 后 `build:typecheck:renderer` 与 `audit:simplification-ratchet`（21/21 持平）通过；完整 `maintenance:validate` 见本轮结果。
- 未核实 / 待验证：预留区行为与推回闭环的真机表现；脏工作树 303 项共享改动保持原样未提交。

## 2026-08-14 Harness 完成所有权治理（HARNESS-COMPLETION-OWNERSHIP-001）切片 1

- 用户判断已用真实数据证实：2026-08 共 217 次真实运行中 `final_response` 结束 92 次（42%）、零写入 144 次（66%）、`completed` 且零写入 37 次、**完成且真有写入仅 20 次（9%）**；62 次（29%）预算/空转耗尽，末工具高频为读取类（getDocumentInfo=36）。高频阻塞文本：「我先看了一下现状，但还没开始动手改」28 次。
- 已核实（代码）：默认自主路径收尾时 `resolveUnfinishedExecutionObligation` 依赖 manifest 绑定的 runtimeSession；零业务动作停话直接吞成 `final_response`，完成契约（task-completion-contract）只做事后注解。完成权实际在模型手里，Harness 只有注解权。
- 已核实（代码，切片 1）：`agent.ts` 收尾分支把零业务动作并入既有成品契约推回——写入已授权（write_photoshop 意图或结构化交付义务）且完成契约缺失执行时，有界推回（≤2 次，共用 contractRemediationAttempts），推回耗尽诚实停止（`plan_execution_mismatch` + `completion_contract_unsatisfied_zero_progress`），不再吞成 final_response；聊天、只读分析、计划类请求不命中（无写入授权或推断不出执行契约）。只拦「确定没做到」，不拦措辞。
- 已核实（构建/审计）：`build:typecheck:renderer`、`audit:simplification-ratchet`（21/21 持平）、`audit:executor-generic`、`audit:agent-business-boundaries`、`git diff --check` 与完整 `maintenance:validate` 22 项全部通过；UXP production build 通过。
- 未核实 / 待验证：真实 Photoshop 上「零写入被推回」与「推回后写入+读回+评价闭环」尚未真机验证；收敛指标（切片 3）尚未固化；脏工作树 303 项共享改动保持原样未提交。

## 2026-08-13 运行恢复、事务读回与失败诊断改造

- 已先按当前共享工作树核对外部任务书，没有机械套用过期行号。T1 的 `ReadonlyArray` 已存在并通过类型检查，因此未重复修改。
- 真实运行诊断已从“仓库里只看到 2 条”恢复为默认发现 420 条 `agent-run-record/v0`；`--since 2026-08` 精确读取 202 条。扫描来源按显式项目、历史会话真实项目集合、仓库兜底排序并去重；档案现为列表、汇总、JSON 与 `--trace` 的主数据源，8 月口径复现 78 次成功、1919 次 Tool Call、193 次失败，不再回退为 73 条会话摘要。
- Skill 内部原子 Photoshop 调用新增一个 Harness-owned 串行 owner，复用现有 preflight 和 documentId / revision guard。`sku-color-card` 的写→读→写链不再直接调用 raw Tool executor；文档切换会失效旧目标，必须重新读取后再写。
- 失败写入恢复按 Host 事实分流：明确 `not_applied` 不阻断同一批次的独立后续写；`unknown` 只开放最多两种同文档读回能力，不自动重放；读回仍是原 revision 时可更换失败 provider，revision 已变化或无法确认时继续锁定现场。
- Provider 截断恢复使用 1× / 2× / 4× 输出窗口，模型硬上限始终生效；补偿轮仍记 Provider 调用但不重复扣普通模型轮预算。正式 Agent 行为回归验证 1200 / 2400 / 4800。
- 十个高频 UXP 操作工具均已核对并纳入严格读回：`moveLayer` 保留原有合格事务实现；create/group/reorder/place/duplicate/quickScale/createText/setText 等内容或结构写入补齐真实 ID、层级、bounds、文本、位置或比例核对并在失败时回滚；`selectLayer` 核对完整活动图层 ID 集合并拒绝部分选择。
- Agent 与 UXP 的公共失败边界现在补齐稳定机器码、具体原因和可行动下一步；已有 Tool code 不被公共层改写。目标文档或 revision 变化仍在写前中止，直接 UXP/MCP 调用也不再只返回裸 error。
- 正式 `maintenance:validate` 22 项全部通过：Main / Renderer 类型检查、真实 Agent Runtime 行为、业务边界、Capability / Executor / Tool / Skill 审计、Agent 测试和 UXP production build 均为绿色；最新 Renderer production bundle 另行构建成功。没有新增一次性 Smoke，也没有修改债务基线制造假绿。
- 当前 Electron 主进程于 10:26 启动，最新 Renderer 于 11:40 生成，UXP bundle 于 11:34 生成；现有桌面进程没有加载本轮最终代码。为避免打断用户正在使用的 Photoshop，本轮没有擅自重启 Electron、重载 UXP 或在旧运行时上制造无效真机结论。
- 尚未验证：真实 Photoshop Host 上的 `sku-color-card` 完整链、十个事务工具的故障注入/回滚、桌面 Agent 成功率和设计质量。自动验证只证明当前代码与正式契约一致，不能替代真机结论。
- T8 未自动处理：当前 `DesignEcho-Agent` 仍有 303 项共享脏改（248 修改、7 删除、48 未跟踪）。本轮没有暂存、提交、清理或恢复任何用户/其他 Agent 改动，后续必须由人工决定提交拆分。

## 2026-08-13 设计师体验与后台自动记账分离

- 用户明确取消产品 Agent 的“举证”职责：设计 Agent 应像设计师一样理解、制作、看效果和调整，不应背诵 Harness、Runtime、阶段、权限或验收协议，也不应把内部检查组织成用户可见报告。
- 架构边界已重新确认：后台仍自动记录目标文档 / revision、真实 Tool 结果、保存与导出状态，用于防止误报和误覆盖；这些事实不由模型自报、不进入设计方法，也默认不展示给用户。
- 生产模型提示、Capability 动态上下文、阶段与复盘提示已经收敛为设计语言：只查看影响下一步判断的信息，尽早制作可逆版本，查看效果并有限调整；Manifest、Profile、阶段编号、Provider 引用、权限解释和完成计数仍由 Runtime 私下处理。
- Skill 的原始结果只在进入模型前做白名单投影。模型只看到做了什么、当前问题、下一步和是否等待用户；原始 Tool 明细、Continuation、卡片 owner、操作账本与完整 Run Record 保持不变。普通日志也只保存浅摘要，避免再次序列化真实 SKU 运行中曾超过 40 万字符的工作流对象。
- 用户过程区只接受显式 `audience=user + visibility=user_process` 的投影；普通 Tool、Skill 包装、迭代计数、成本账本和后台完成数组不再旁路显示。任务计划按“查看素材、确定方向、制作、调整、交付”等设计动作投影，不显示模型声明的 Tool /阶段原文。
- Agent 的异常恢复、续做、交付收尾和改后复盘提示已进一步改成简短设计动作语言；模型不再接收长篇英文 Runtime 状态、阶段号、证明式要求或整块 JSON 复盘信封。安全边界仍在执行点生效。
- Runtime Context 与单轮 Message Context 的内部 trust / authority / source / Manifest 身份仍用于程序选择和隔离，但不再写进模型正文；模型只看到“项目现状、专业设计方法、实际观察、当前操作说明”等自然内容。外部参考和工具观察继续有明确边界，不会因此获得指令或权限。
- 最终用户结果由单一投影生成，只根据本轮实际修改、保存 /导出、外部素材生成、必要观察和是否看过改后画面说明“做出了什么 /有没有版本 /下一步”；`summaryText`、blockers、lastError 和内部验收数组不再由 UI 二次拼回用户卡片。
- “有可看版本”只接受 Photoshop Host 返回的真实改动，或真实保存 / 导出结果；写工具仅返回 success、完成计数增加或 UI 兜底都不能再声称画面已改变。普通自然追问与交互确认卡也已分开：前者保留 Agent 的实际问题，后者才显示卡片确认和绑定续跑。
- Provider、Runtime 和 Tool 的原始错误继续保存在运行记录和开发诊断中，但用户过程与最终回复只展示可理解、可行动的自然信息；没有可靠公开映射时使用中性说明，不把内部报文包装成“错误：原文”。
- SKU 已建立用户提示与私有诊断双通道：用户只看到具体规格、模板、排版或文件问题和下一步；能力版本、Photoshop 修订、排版 QA、导出读回及原始错误仍保留并继续决定任务是否完成，但不再直接展示或灌回设计模型。
- SKU 交互顺序已按用户最新要求校正：裸“帮我做 SKU”先检查或补齐色卡、模板和占位符，再生成 2 /3 /4 候选组合并显示一次组合卡；确认后直接批量生产。明确跳过组合确认、已确认 continuation 或项目已有受信权威组合时不重复弹卡。该规则只在 SKU Skill 内，不进入通用 Harness。
- SKU 模板设计交接给模型的是目标、版面与占位符要求、可编辑性和下一步；内部 allowlist、revision、精确读回与 owner 重入仍由同一 continuation 机制管理，没有把 SKU 流程写进通用 Harness。
- 正式 `maintenance:validate` 22 项全部通过，包括仓库卫生、UTF-8、162 Tool、18 Skill、Capability、Runtime 声明、Agent 业务边界、Prompt 治理、Main / Renderer 类型检查、Agent 核心测试与 UXP production build。第一次全量验证如实发现旧审计仍要求不可靠的写调用计数口径；生产行为没有回退，审计被迁移为真实 Host 改动或保存 / 导出边界后再次全量通过。
- 尚未验证：当前桌面应用加载新构建后的真实 Provider → Photoshop 设计体验、首次有效写入速度、SKU 色卡/模板/占位符/2-3-4 组合交付和人工审美质量。自动检查通过只说明代码边界没有已知回归，不代表 Agent 已经“很会设计”。

## 2026-08-12 简单 Agent → Skill / Tool 主链恢复

- 真实故障位于 Harness，而不是 Photoshop / UXP：旧链把 advisory SKU recommendation 变成必须先调用 `declareDesignIntent` 的硬门，并将首轮 Tool Schema 收窄；模型又按通用 Schema 给无模式 SKU Profile 携带 `workMode`，绑定失败后停留在 6 model / 10 tool / 8 iteration / 120 秒的小预算中。隐藏开场读取、控制 Tool 和普通观察共同耗尽额度，写入没有抵达 Host。
- 当前真实项目为 `E:\WERKE\C-1245`。失败 Run Record 证明 `declareDesignIntent`、`requestAgentCapabilities` 与只读调用均是真实模型 Tool Call；并非模型只说不做，也不是 Photoshop Tool 缺失。Completion 0/4 是零写入后的正确结果，不是根因。
- 当前主链已恢复为：Agent 理解需求；匹配注册 Skill 时直接调用 Skill；无匹配 Skill 时自主规划原子 Photoshop Tool；执行后读回、有限修正并交付。候选推荐只作提示，不授权、不拦截、不签发 mandatory control Tool。
- SKU 领域只有一个完整用户级入口 `sku-batch`。色卡、模板、组合规划、生产与恢复属于 Skill 内部；通用 Agent / Harness 不维护 SKU 阶段、占位数量、组合规则或专属工具笼。
- `declareDesignIntent` 保留为可选后台 Task Profile 绑定：精确 Profile 确实能提供专属方法、阶段、预算或评价时可调用；它不是分析、Skill 调用、Photoshop 写入或完成任务的许可，也不在默认启动基线中。
- 未绑定自主运行总上限已恢复为 16 model / 50 tool / 30 iteration / 420 秒；匹配 Skill 时仍应尽快调用，预算不是鼓励用完。未绑定运行不再提前购买一个最终不会执行的通用 VLM Judge reserve。
- Broad discovery 首轮同时暴露用户可见 Skill bridge 与最小充分设计 Tool：项目/文档观察、画布、置图、文字、变换、参考和快照。无匹配 Skill 的开放设计不会因缺 Runtime Profile 退化为只读循环。
- Skill nonFatal handoff 现在可通用激活其结构化声明的后续原子 Tool，只从当前 on-demand 候选且未被 deny / Manifest ceiling 禁止的集合中选择；不执行 Tool、不授予权限、不按品类分支。SKU 缺模板后可在同一 Agent 运行中继续完成可编辑设计。
- Harness 继续保留真正需要确定性的边界：documentId / revision、读后写、显式保护、不可逆操作确认、同目标写后读回、交付收据、Completion 与全局预算 ceiling。开放创意的文案、排版、风格和下一步不由 Harness 固定 DAG 接管。
- Runtime Profile Catalog 仍由 Manifest / Evaluation /权限安全边界派生。当前 16 个 Profile ready；详情页 `analyze_only` / `export_only` 两个能力尚未收窄的模式保持 blocked。SKU Template 复用通用设计 Evaluation，可声明但没有新增 SKU 专属评价 Owner。
- 自动验证通过：Main / Renderer 类型检查、`npm test`、Agent 业务边界、Capability Resolver、Runtime Declaration、Skill Package、Skill Standard、Skill Coupling、通用 Executor 与定向 `diff --check`。没有修改断言、吞错误或提高债务基线制造假绿。
- production bundle 于 14:50 生成，当前 Renderer 进程于 14:53 创建并已加载。DesignEcho Host 健康、Photoshop UXP 已连接、pending request 为 0、129 个实时 Tool 可见；项目根核验为 `E:\WERKE\C-1245`。
- 未验证：当前活动 `SKU.psb` 为 800×800、11 层且有未保存改动，本轮没有对该用户文档做写入。2/3/4 双装的首次真实写入、同目标读回、导出文件、跨 Run 续跑和相对 `D:\A1 neveralone旗舰店` 的人工审美质量仍需在一次可隔离的真实 Agent 回归中单独记账；自动测试通过不等于商业设计质量通过。

## 2026-08-11 真实项目 SKU 自主设计基线

- 已核实（手测）：通过当前已运行 DesignEcho 的既有调试桥提交普通用户 2/3/4 双装 SKU 交付请求，没有启动第二个 Electron / Photoshop 实例。当前项目为 `C:\Users\12611\Desktop\测试\测试`，基线时 41 张素材、Photoshop 无文档、SKU/PSD/输出目录无产物。
- 已核实（真实运行）：Agent 先做一次项目联系表视觉分析，随后仍宣称“从 41 张里抽取 12 张样本”并逐张调用视觉模型；前 7 个近看样本中 6 个来自模特目录。最终约 20 分 33 秒、24 iterations、25 model calls，0 Photoshop mutation、0 输出文件，以 `tool_preflight_blocked` 收尾。
- 已核实（代码）：`project-image-analysis.executor.ts` 将模型请求的 sampleSize 允许到 12；联系表选出素材后又用 `buildPreferredImages` 回填到 sampleSize，并逐项串行调用 `analyzeAssetContent`。数字文件名的 series 分组不能区分模特 /平铺目录，导致同类照片连续入选。
- 已核实（事实边界）：项目目录没有 CSV / XLSX，当前没有连接的 Excel workbook 会话；因此 4 双组合规则、颜色名和款式映射不能从本轮已知事实推断。后续必须从桌面应用现有项目数据源取得或精确报告缺失字段。
- 已修复（项目观察成本）：联系表输出成为语义覆盖证据，只对明确不确定的关键角色做少量、多角色近看；已有产品理解时不再追加模型总结调用。
- 已修复（执行入口）：`sku-batch` 可在无 Photoshop 文档时进入项目扫描与受控新建；缺模板时在同一 Workflow repair continuation 中自主创建、设计、看图、保存和读回，独立模板任务仍保留方向确认。
- 已修复（真实委托边界）：用户原文明确委托可逆组合判断时可继续生成 `agent_delegated_draft` 候选，但不取得权威业务事实信用；前置条件可用后默认展示组合卡，用户确认后再生产。“识别”中的“别”不再误判为撤销委托。
- 已修复（成本上限）：SKU 四阶段链从旧上限 26 模型 / 90 工具 / 50 iterations / 600 秒收敛为 16 / 50 / 30 / 420 秒，视觉上限 6 候选 / 2 分析。Renderer/Main 类型检查、Agent 业务边界、Capability、Skill Package、Tool Registry 和通用 Executor 审计全部通过。
- 未验证：当前已运行应用没有加载本轮新构建，且本轮遵守约束未重启、未新开、未杀进程；修复后的首次有效写入延迟、2/3/4 双组合正确性、PSD/PSB 可编辑结构、导出产物和与验证集相近的人工审美质量仍待该实例自然重载后复跑。

## 2026-08-11 自主设计能力研究与实施切换

- 用户目标已明确为默认自主的专业设计 Agent，而不是更多工具调用或更多人工确认：Agent 应自行理解、设计、落地、看结果、诊断和有界修正；人工只处理用户独占事实、不可逆风险、能力真实缺失或返工超限。
- 代码审计确认现有能力不是空白：Task Profile、R1/R3/R4、Design Kernel 方法知识、Project State、reviewed memory、Eagle、Photoshop Tool、逐图视觉观察、Evaluation Profile、DesignVerdict 与 Reflexion 都有真实生产接线。核心问题是这些组件没有成为主图/详情页/开放设计默认必经的一条质量闭环。
- 已确认两个首要生产断点：普通自然语言晚绑定 Manifest 后不会回补启动时缺失的 reviewed memory，Reflexion 新 Agent 继续复用启动时的 Project State / Memory；详情页虽已有同 history 的全部屏截图和逐屏 review，终局 R5 Judge 仍只消费一张完整画布，无法证明跨屏叙事和全部屏质量。
- 已确认 Candidate 断点：现有 variant/composition 多为文字策略或固定首选，没有“真实预览 → 同 rubric 比较 → 选择胜者 → 只生产胜者”的通用 CandidateSet。该能力按下一纵切实施，不用更多 Prompt、更多队友或品类 Skill 替代。
- 当前进入 `AUTONOMOUS-DESIGN-KERNEL-V1`：先在唯一 Context Compiler、现有 VisualObservationBundle、Evaluation/DesignVerdict 与 Reflexion Owner 上闭合 generation-scoped 上下文和完整视觉集合评价，再做 CandidateSet / DesignIR。尚未改写完成事实，也未取得真实 Provider → Photoshop 或人工质量证据。
- 已完成请求复杂度成本纵切：自然语言设计通过结构化 `taskType + workMode` 选择模式级阶段、Capability ceiling、模型 token/thinking 策略与 Evaluation Profile；精确文字替换只开放文档身份、完整 acceptance snapshot、`setTextContent` 和必要读回，不进入 Eagle、Design Team、完整策略或全画布 VLM。
- 已完成精确文字可信闭环：Engine 签名 scope → 全文档唯一目标 → 原文/文档/history CAS → Photoshop 写入 → 完整 acceptance diff → 最终 Host history。错误 layer/value、目标歧义、快照截断、外层失败但 Host 已证明越界、最终 history 缺失或后续 mutation 均不能取得 scoped 完成信用；合法长文案与 Photoshop CR 多行文字已纳入正式回归。
- 已完成跨 generation /复合 Agent 成本治理：Runtime 累计模型、工具、迭代、视觉候选、视觉分析与活跃时长；预算耗尽不再 Reflexion 重购，Design Team allowance 启动前全额预记且不退款；Provider 图片一次消费后退休历史像素，终局 ReviewSet 按真实 presentation 数量计费。
- 已验证完整 `maintenance:validate` 21 项全部通过，含 Main/Renderer 类型检查、UXP production build、Agent 业务边界、Tool/Skill/Capability/Prompt/Gate/三态/设计智能审计、中文编码、仓库卫生和核心测试。尚未验证真实 Provider → Photoshop 的改单字端到端耗时/费用，也未证明主图/详情页已达到稳定商业审美质量；下一纵切仍是 CandidateSet / Preview / DesignIR 与真实样本基准。

## 2026-08-11 Agent 重复观察与行动活性治理

- 已核实真实运行根因：附件只引用 `2双自选备注.jpg`，旧 Agent 文本恢复却用裸 `jpg/png` 正则生成“用户要求导出”的虚假义务；任意成功读取会刷新未完成续跑；同一事实经不同 Tool 返回仍被算作新进展；快照 cache hit 虽不再访问 Host，却仍会重复发送给视觉模型；RuntimeSession 进入 `needs_reobserve` 后缺少接受新 revision 的重新规划状态转换。
- 已退役从任务正文、附件扩展名和模型措辞猜导出 /关闭动作的第二恢复 owner。结构化 TaskPlan / Runtime 继续拥有真实交付义务；只读 Tool 失败保留原始精确原因，不再泛化为无证据的大文档或格式结论。
- 已将 `getDocumentInfo`、`getLayerHierarchy`、模板解析及 Canvas /Annotated Snapshot 全部绑定可信 `documentId@historyStateId`。Runtime 以对象身份签发 cache hit，伪造或复制字段不能取得运行时信用；缓存图不再重复显示、不进入视觉观察、不消耗视觉候选，缓存复用也不更新执行目标、不满足 R2、不进入 Stage Trace 或用户可见观察 /成功计数。权威文档屏障（含打开项目 /模板、进入智能对象、autoOpen）、活动图层、undo /redo、项目状态和资源变化统一清缓存。
- 已把未完成续跑和阶段 liveness 改为语义进展：TaskRun status、plan revision、current node、target document /revision /binding、成功 operation result、输入与 outcome 才构成稳定进展；成功读取总数不再刷新 key，跨 Tool 同义事实也不凭 Tool 名续命，novel fact credit 有界。
- 已复用现有 RuntimeSession / Runtime Stage reducer 闭合文档变化：外部或用户修改触发 `needs_reobserve` 并使旧 plan 失效；完整创意链只有在 R4 绑定 observed revision 的新 plan 才释放同一 TaskRun writer；无 R4 的 `sku-batch` / `sku-color-card` 则由 R2 真实文档观察精确确认 conflict revision 后恢复 E1。连续 11→12→13 漂移会再次退回 R2并清空旧观察，旧 revision mutation 仍被拒绝且不自动重放。
- 已验证：`build:typecheck:renderer`、`audit:agent-business-boundaries`、`audit:simplification-ratchet` 均通过；完整 `maintenance:validate` 21 项全部通过，含 Main / Renderer 类型检查、Agent 行为与业务边界、Tool / Skill / Handler / Prompt / Gate /三态 /设计智能审计、仓库卫生和 UXP production build。简化棘轮从 24 收紧到 22，没有提高债务基线或修改断言制造假绿。
- 当前边界：本轮证明通用运行时契约和接线，不证明真实 Provider 已更果断，也不证明投诉中的 JPG 已修好。实际 `SKU.psb` 是完整可编辑色卡源；自选备注 4 色进入 2 区时的 `arrangeDynamic` 多卡同区缩放、复制后结构 /bounds 验收，以及导出读回 blocked 仍可能顶层 `success:true`，属于独立 SKU 确定性业务缺陷，必须在后续切片单独修复和回归。
- 未验证：重启后同一 SKU 纠错对话的首次有效 mutation 延迟、重复结构 /视觉观察率、新 revision 重新规划后的真实写入、同目标读回，以及最终自选备注色卡质量。

## 2026-08-09 SKU 纯底素材精修与色卡闭环

- 已在唯一用户侧 `sku-batch` Skill 内接入 `prepareSkuRetouchAssets` 原子工具，没有新增第二个 SKU Skill，也没有向通用 Agent executor 增加 SKU 品类分支。
- 主进程新增版本化精修服务：BiRefNet 主体蒙版、批次中位形态基准、中心线与逐行宽度轮廓受约束归一、独立标准棚拍阴影、批次低频亮度统计及可编辑 Soft Light 中性灰修正图。旧 `optimized-displacement` 因坐标空间、轮廓顺序和位移场尺寸契约不一致，未作为生产主路径。
- SKU 色卡执行器在建文档前自动分类纯底/场景；纯底智能对象写入隐藏原图备份、主体、阴影和中性灰层并读回智能对象、剪贴、混合模式、边界和最终快照；场景图跳过纯底精修，保留给场景设计方向。
- 真实五色 4480×6720 原素材已用 DirectML BiRefNet 回归：五张自动判定为 `studio`，置信度 0.74–0.88，自动参考为黑色；输出统一为 828×1337，五项报告检查全部 `passed`。形态残差由 0.0165–0.0290 降到 0.0046–0.0081（参考图为 0），光影残差由 0.0104–0.1053 降到 0.0035–0.0343。首次运行约 44.5 秒，版本化缓存复用为 4 ms。
- 真实预览已人工检查白色、黑色、奶白、浅灰和深灰：通道步长错误造成的周期条纹已按根因修复，产品颜色与针织高频纹理保留，阴影不再提取原 JPEG 背景噪声。
- 已通过 Main/Renderer 类型检查、163 Tool 注册审计、18 Skill 声明审计、8 Skill package 契约、Handler、通用 executor、默认 5/5 形态回归、UXP production build 与 `git diff --check`。完整 `maintenance:validate` 只在本切片未修改的 legacy/fallback 意图简化棘轮 `147 > 140` 处失败；没有修改基线、断言或并行代码制造假绿。
- 旧 `exam:sku:card` 是只读候选诊断器，只读取路径、尺寸和视觉缓存，不消费新精修工具；对只有五张图片、没有视觉缓存的目录仍报告 `blocked_missing_execution_assets`。生产闭环由 Agent 观察/选择来源后进入统一 SKU Skill 与新工具，二者不能混称同一验收。
- 未验证：本轮环境没有暴露 DesignEcho Photoshop MCP 运行时工具，因此尚未在真实 Photoshop 文档中完成 `createDocument → 智能对象分层写入 → 同文档读回 → 保存 PSB` 实机 E2E；也未用多款袜型和人工精修基准证明稳定商业质量。

## 2026-08-08 Eagle-first 设计知识审计、Task Context 修复与知识库 UI 重构

- 产品定义已收敛：DesignEcho 不做第二个 Eagle、Obsidian 或 SiYuan。Eagle 继续拥有原图、文件夹和标签；DesignEcho 只拥有经来源约束、审核和任务用途约束的设计判断。素材被 Agent 看过不等于已成为正式知识，`Task Context / Candidate / Validated Knowledge` 保持分层。
- Phase 0 审计结论为 `core_validated / partial_runtime_consumer`：KnowledgeNode、Evidence、Relation、TaskContext、Candidate、LearningEvent、检索与写回契约存在，42 项专项审计通过；但现有全部 knowledge tool 并未统一迁移到新 Service，不能宣称完整 Foundation runtime 收口。
- Phase 1 审计结论为 `runtime_integrated_partial / live_agent_unverified`：TaskContextBuilder 已由 autonomous Agent executor 实例化并注入 loop，聊天可展示只读 Context 卡；本轮修复了“只有 id/标题、没有真实知识内容”的根因，新增有界 excerpt、来源、生命周期与选入理由，外部 Eagle/Web 保持 observation/candidate，不再冒充 validated。普通任务不自动检索 Eagle，空 Context 不再注入或展示。尚未用真实 Provider 证明每轮 Agent 的实际消费与决策质量，Context 审计事件也仍只是诊断日志。
- Phase 2 审计结论为 `contract_only`：Obsidian parser/hash/atomic write、watcher、vault service 和 Candidate Gate 纯逻辑存在；但主进程产品入口、IPC/preload 和知识 UI 没有实例化这些 Owner，`KnowledgeSyncStore` 仍是内存 Map。确认收据只校验形状，没有主进程签发、过期与一次性消费 Owner。当前可见“待我审核”继续使用既有 `MemoryService` 生产路径，不能把它冒充为新 Candidate Gate / Obsidian 双向闭环。
- Phase 3 审计结论为 `core_validated_isolated_io`：视觉关系构造、正反例反查与 RelationStore 真实临时文件 IO 已通过；但 Store 只被专项脚本实例化，没有产品 IPC、UI 关联动作或 Context Builder 的 Rule + Positive + Negative 运行时检索，因此不满足路线图退出条件。
- Phase 4 审计结论为 `contract_only_with_isolated_store`：重复、冲突、freshness、health 和 merge 纯逻辑通过，KnowledgeIndexStore 独立 IO 通过；没有运行中的 Steward、陈旧复核调度或面向用户的冲突处理闭环。
- Phase 5 审计结论为 `existing_learning_owner_live / new_contract_not_integrated`：既有 MemoryService 候选复核是当前产品 Owner；新 LearningEventStore 与重复模式检测仅在临时文件脚本中通过，尚未接 TaskRun、用户反馈、before/after、Accepted Revision 和版本证据，不能宣称 Design Feedback Learning Loop 完成。
- Phase 6 审计结论为 `pure_state_machine_only`：16 项命题状态机测试通过，External Signal 不能直接成为知识；但没有 Web/PDF/Video ingestion、Brainstorm Session、Proposition Store/UI 和真实用户确认收据 Owner，所以不是产品功能。
- “运行时持久化层完成”声明已纠正：IntelligenceDb 的原子写、重开、损坏隔离以及 Relation/KnowledgeIndex/LearningEvent Store 的 8 项真实 IO 测试通过，证明 Store 实现可工作；仓库产品代码没有导入或实例化这些 Store。专项脚本现已明确标注“独立 IO 测试，不代表产品运行时已接线”。盲目接入会与现有 MemoryService 形成第二知识/学习 Owner，本轮没有这样做。
- 知识库 UI 已重构：导航只保留“知识总览 / 可用知识 / 待我审核”；总览解释“收集素材 → 看图提炼 → 人工审核 → 加入任务”，展示正式知识、候选、任务固定引用、最近使用和 Eagle 双通道；可用知识页把内部 recipeId、长 Runtime 契约和 Tool 标签收起为一句设计意图，按使用方式说明“Agent 按需取用 / 可固定到任务 / 审核后可用”；审核页移除了会误导用户的自动学习设置，明确只有人工批准后才会复用。
- 知识检索后端已把统一知识与 Eagle MCP 两个独立来源并行，避免外部等待串行叠加。Electron 假运行时中“构图”全来源检索约 0.34 秒返回 2 条内置方法与 1 条 Eagle 候选；这只证明页面交互和来源降级，不代表真实 Eagle 用户库的速度或语义质量。
- 可见 UI 回归已通过：在隔离 Electron debug 窗口检查 1200×800 与宽屏，总览按内容容器自适应，无横向溢出；知识检索、审核空态、键盘焦点、Eagle 页面入口和双通道说明可见。截图保存在 `output/playwright/knowledge-ui/`，属于开发验证产物。
- 已验证：Main/Renderer 类型检查、Agent production build、42 项 Design Intelligence 审计、16 项命题状态机、8 项 Store 独立 IO、Agent 默认测试、Capability、Skill Package、Prompt、Gate、UXP production build 与 `git diff --check` 通过。
- 完整 `maintenance:validate` 未形成全绿，原因是共享工作树中本切片未修改的三组债务棘轮：`agent-intent-control-plane.ts` 新增 7 个 `new RegExp`，使简化计数 `147 > 140`；业务边界中的 `agent-intent-control-plane.ts 28 > 22`、`agent-task-planning-contract.ts 58 > 51`；`task-completion-contract.ts` 的 SKU 子集出现 8 个旧版未登记词。规划、卫生、编码、Tool、Handler、Skill、通用 Executor 等此前 7 项已通过。没有回退这些并行改动，也没有抬高基线、改断言或跳过失败来制造假绿。
- 未验证：真实 Eagle 用户库与 MCP 实机、素材移动/删除后的稳定引用、真实 Provider 对 Task Context 的消费、候选确认收据主进程 Owner、Obsidian 双向同步、Phase 3–6 产品闭环、Agent→Photoshop 主图/详情页设计质量与商业稳定性。

## 2026-08-04 模糊委托、新建文档死锁与假完成根因修复

- 已核实（真实 Run Record）：自然请求“再新建一个文档，尺寸随意都行”首次在 Tool 前停止的直接原因是 DeepSeek HTTP 503 `Service is too busy`，不是 API Key、用户措辞或 Photoshop 门禁；服务恢复后的同一请求又被 `create_document_target_unresolved` 重复拦截，`listDocuments` 无法改变门禁输入，最终 20 轮、0 mutation 却被标成 completed。这是两个独立根因。
- 已修复（设计判断 ownership）：用户说“随意、你决定、看着办、按常用规格、合适就行”视为把可逆专业选择委托给 Agent，而不是缺少输入。该规则是品类中立的设计决策原则，没有新增新建文档 /白底图 /SKU 关键词 Router 或专属状态机。
- 已修复（目标边界）：`observe_only` 表示当前文档只是只读上下文，不再以未知角色阻断建立独立目标；只有用户明确绑定继续修改当前文档形成 `reuse` 时，`createDocument` 仍会因防分叉被拦。
- 已修复（完成与验收）：一旦模型真实尝试 Photoshop 写入、导出或外部生成，零成功交付不能再由成功读取抵消为 completed；`createDocument` 允许合法的 before 无活动文档，并用写后 documentId、名称、尺寸和分辨率验证结果，规格不一致仍失败。
- 已修复（Provider 瞬时故障）：`service_unavailable / network / timeout` 只在本次模型请求尚未产生任何流式内容或 Tool proposal 时同模型重试一次；不切换模型，不重放 Photoshop Tool。仍失败时用户会看到“服务繁忙 /网络 /超时”的真实分类和正式 failed execution summary，不再误导检查 API Key。
- 已接入（现有 loop guard owner）：同一 policyGate 在一次 Run 内累计命中 5 次时停止原样重试；不同门禁分开记账，等待用户确认的 HITL 卡不计入。同步修复旧 loop guard 在 `ToolResult` 包装外层读取 `policyGate` 的错层问题，统一读取真实 `output`；停机文案明确这是系统门禁路径问题，不把责任推回用户描述。
- 已验证（代码）：四种自然用户问法、合法“无文档→新文档”、尺寸不一致、重复门禁与 HITL 排除均已进入正式 `audit:agent-business-boundaries`；Main /Renderer 类型检查和完整 15 项 `maintenance:validate` 通过，其中包括规划 /卫生 /编码、162 Tool、20 Skill、Capability、8 Skill Package、Prompt、5/5 核心测试和 UXP production build。
- 未验证（真实结果）：本轮遵守共享窗口约束，没有启动或关闭 DesignEcho /Photoshop，也没有写入用户 PSD；因此最新构建下的真实 Provider → createDocument → Photoshop 写后读回、多问法稳定性和设计质量仍待一次性文档可见回归。

## 2026-08-03 标准设计 Agent 最短专业路径：R3 与能力自知根因修复

- 已核实（真实运行）：Run Record `run-20260803115420027-31eea942.json` 的用户目标是从项目选择图片、置入、抠图并制作 800×800 白底图。运行共 11 轮，读取了文档、资源、Project State、缩略图和图层但没有 Photoshop mutation，最终错误地把“透明商品素材”声明为唯一 blocker 并进入 `waiting_user`。这不是白底图 Skill 缺失，而是通用 Runtime 误判。
- 已修复（R3 所有权）：`resolveRuntimeStageNeedsInputRecovery` 不再把 R3 `blocking` missing input 转成 observation / knowledge recovery。R3 blocking 现在只表达用户独占输入；可观察事实必须先观察，Agent 已有工艺必须进入执行，不再用重复项目检索代替动作或澄清。
- 已修复（能力自知）：结构化 Intent Control Plane 已签发 `write_photoshop + confirmed_tool_required` 时，普通自然语言设计请求也会取得通用设计执行 Capability 基线，不必先猜中 SKU /主图 /详情页身份；基础集合补齐 `photoshop.write.removeBackground`。这只改变模型可见能力，不扩大 Tool 权限、请求写范围、TaskRun 或 revision 边界。
- 已删除（第二执行 Owner）：移除了从 assistant 回复文字正则猜测 `createTextLayer / moveLayer / export` 等 Tool 并强制重规划的恢复链。没有真实 schema-bound Tool call 时，系统不再用猜出来的动作掩盖 Provider /Runtime 失败；后续统一由 TaskRun 结构化 liveness / no-progress 收口。
- 已固化（减法棘轮）：Agent loop 复杂度基线由 33 收紧到 24；Capability 审计要求基础设计会话知道 `removeBackground`、R3 blocking 保持 user-owned，并禁止 prose-based Tool recovery 回归。`audit:simplification-ratchet` 已纳入 `maintenance:validate`，核心检查由 14 项增至 15 项。
- 已验证（代码）：Main /Renderer 类型检查、Capability resolver、Agent business boundary、generic executor、simplification ratchet、UXP production build 与完整 15 项 `maintenance:validate` 全部通过；`git diff --check` 通过。没有启动或关闭 DesignEcho /Photoshop，没有写入用户 PSD。
- 未验证（真实结果）：新构建尚未在重启后的真实 Provider + Photoshop 中复跑白底图；同 TaskRun 自然语言接续、V0 execution envelope、双 TaskRun /恢复、原 SKU 同会话、V1 无 Skill 设计与唯一 Release 仍按既定顺序待完成。因此本轮只证明系统性阻塞已修复并受审计约束，不证明 Agent 已会高质量设计。

## 本轮项目记忆维护

- 已核实（代码）：项目记忆从约 1.8 MB 压缩到 62 KB，保留当前主线、40 个未完成/暂停 Intake 项、关键决策、现实风险和自动校验锚点。
- 已核实（构建/脚本）：最新 `maintenance:validate` 的 15 个无 smoke 核心检查、Main /Renderer 类型检查、UXP production build、语义约束矩阵和 `git diff --check` 通过。
- 当前验证体系不再创建、恢复、运行或依赖 smoke；质量结论只引用现行核心检查、构建、审计和真实 E2E 证据。

## 2026-08-03 模型设置与 Provider 失败来源治理

- 已核实截图对应的真实请求：Run Record `run-20260803074300-3478c19d-811c.json` 在工具调用前结束，同时间主进程日志保留 Ollama Cloud `HTTP 403` 和 `this model requires a subscription, upgrade for access`。这是模型订阅 /访问权失败，不是 API Key 认证失败。
- 已修复共享分类口径：401 /明确认证证据才归为 `auth`；403 无更具体证据时归为 `model_access`；订阅、计费、限流、超时、网络、上游 5xx、协议和 unknown 保持独立。普通模型正文不再被 UI 字符串扫描为当前失败。
- Ollama Cloud 设置页已连通真实主进程测试：对当前选中模型发起最小 `/api/chat`，以同一真实请求区分成功、401 认证失败、403 订阅 /模型访问失败与其他故障；移除了该 Provider 原先的长度检查假成功。Ollama 官方的 `/api/tags` 只用于列出模型，不被当作 Key 认证证据。
- 新 Provider 失败 Run Record 保存脱敏有界摘要，日后可直接审计 `kind / basis / modelId / status / providerCode / diagnostic`，不保存 Key、Authorization 或完整响应载荷。
- 未对订阅 /权限失败增加自动重试；这类确定性失败不会因重试恢复。`build:typecheck:renderer`、新增 Provider 边界核心审计和完整 14 项 `maintenance:validate` 通过；应用重启后真实设置页测试与可用模型切换尚待 live 确认。

## 当前主线

- 当前切片：X2/V0 `R4-EXECUTABLE-V0-VERTICAL-001`，服务总主线 `DESIGN-HARNESS-VERTICAL-CONVERGENCE-001`
- 当前里程碑：F1/F2、动态 Task Profile + Capability 作业模型、F3 首条 Craft Recipe、X1 TaskRun owner、X2/V0 执行信封与精确属性请求最小写范围均已完成代码接线和核心验证；Photoshop 原生 `get` 弹窗根因也已修复并实机读回。下一步仍是真实 Provider + TaskRun + Photoshop V0 纵切、同文档并发 /等待恢复和 SKU 同会话复跑。
- 状态：`architecture_consolidated / product_boundary_defined / foundation_core_validated / capability_operating_model_core_validated / taskrun_owner_code_complete_core_validated / v0_mutation_pack_code_complete_core_validated / x2_execution_envelope_code_complete_core_validated / exact_property_write_scope_core_validated / uxp_native_get_modal_root_fixed_live_verified / five_runner_owners / r4_semantic_shadow_preserved / live_v0_photoshop_e2e_unverified / release_gate_not_implemented / live_no_skill_design_e2e_unverified`
- 当前规划结论：只读 Foundation 可以与 X1 owner 收敛并行；任一 Photoshop 写节点仍必须同时满足 TaskRun、Capability、execution preflight、稳定 target / revision 和该动作的 TransactionRunner owner。

## 2026-08-03 自然语言 Harness 去重、只读完成与专业判断 ownership

- 已核实（历史上下文）：旧 assistant 回复以 Runtime 事实级信任进入新一轮，导致模型继续沿用“抠图方法、用途和同商品候选交给运营决定”的错误答案。当前历史 assistant 输出降为 `untrusted_external` 草稿；用户明确要求抛开旧答案重新独立判断时不再注入旧 assistant 文本，历史 user 目标仍可有界承接。
- 已核实（重复读取）：开场 `getDocumentInfo` 已带 document / revision /画布 /模式 /图层事实，但模型仍重复调用同一零参数 Tool。当前 Run 会复用同 revision 的基础读取并从下一轮候选面移除；任何 mutation、文档切换、缓存失效或 unknown reconciliation 后会重新开放，不形成跨 revision 陈旧缓存。
- 已核实（Completion 误判）：自然用户请求“不要修改，也不要找参考，只回答当前 Photoshop 文档名、画布尺寸、颜色模式和图层数量”曾正确回答后被图层管理 0/3 判失败；“同款产品实拍”也曾因裸 `同款` 被判为参考复刻 0/4。当前结构化只读计划或明确禁止写入且零 mutation 的运行不再取得写入完成契约；真实复刻需要明确参考 /复刻动作或版式 /效果 /画面语义。
- 已验证（真实只读实机）：修复前同一问法耗时 61.7 秒并在开场观察后再次读取；中间版本 Run `run-20260803132644-cab1eb3b-a2b7.json` 已做到单次读取却被错误完成契约阻断；最终 Run `run-20260803133253-cab1eb3b-a2b7.json` 约 3 秒、1 轮、仅 `harness_opening_observation:getDocumentInfo`、0 mutation、无 blocker /warning，正确返回当前 `绿色.jpg` 的 4284×4284、300 dpi、RGB、1 个背景图层。测试没有修改或关闭 Photoshop 文档。
- 已验证（契约与核心）：独立重判会排除旧 assistant；“同款产品实拍”不构成复刻，“照着参考图复刻同款版式”仍构成复刻。Renderer/Main 类型检查、Renderer build、UXP production build、通用执行器棘轮及完整 15 项 `maintenance:validate` 通过。
- 仍未核实：决定 ownership 的最终可见模型输出尚未在最新构建上用不同自然问法复跑；此前窗口出现用户输入并被最小化，本轮遵守不抢占 /不关闭可见应用的约束停止操作。V0 写入、X1 并发恢复、V1 设计质量、Release 和业务多样本状态均不因此升级。

## 2026-08-03 晚间 V0 实机审计、授权范围 containment 与原生弹窗修复

- 已核实（真实 Provider + Photoshop，非 TaskRun V0）：在同一 disposable PSD 上使用自然用户表达验证了三种确定性修改。明确“改图层名称”只调用 `renameLayer` 且可见文字保持不变；明确“改画面文字”只调用 `setTextContent` 且图层名称保持不变；旧值同时匹配图层名与可见文字时零写入并向用户澄清。三者走 v3/E1 + UXP + PhotoshopTransactionRunner，不包含 TaskRun / R4 execution envelope，不能外推为 V0 完成。
- 已核实（事故与恢复）：一次实验性 `declareDesignIntent` →结构化 Runtime 重入把精确重命名扩张成整张海报创作。已立即停止、撤回 `runtime_selection_handoff` 实验接线，并通过 18 次真实 undo 与独立结构读回把 disposable 文档恢复到 historyStateId `3757`、2 个图层、文字层名称 `待修改标题`、可见内容 `V0 CANARY`。用户文档未被修改。
- 已实现（确定性授权范围）：Task Profile / Manifest 不再被当作 mutation 授权。对只有一个明确属性替换且没有第二 mutation /保存 /导出要求的请求，Engine 复用现有 `runtimeAllowedWriteTools`：图层名称仅 `renameLayer`，画面文字仅 `setTextContent`，属性待观察时仅两者候选。该范围同时过滤模型可见写能力，并由 Agent Runtime 最终执行点二次拒绝；Skill bridge、别名、Task Profile 和后续模型声明都不能扩张。复合请求保持未收窄，交回完整计划。
- 已核实（Photoshop 原生弹窗根因）：UXP `getHistoryInfo` 过去对 `historyState` 请求不存在的 `count` 属性，Photoshop 因 Action `get` 描述符无效弹出“命令‘获取’当前不可用”，同时阻塞 UXP 线程并造成上游超时。当前改用 `document.historyStates.length + activeHistoryState.id`；其它原生 `get` 均要求 `_options.dialogOptions='dontDisplay'`。
- 已核实（实机与构建）：修复后的 `getHistoryInfo` 多次真实返回且无弹窗，UXP 连接 `connected=true`、`pendingRequestCount=0`、`lastError=null`；Tool audit 报告 `UXP 原生 get 弹窗风险: 0`。业务边界审计新增 6 个自然语言范围样本并通过，Main /Renderer 类型检查、Tool /Capability /Prompt /Skill 审计、Agent 测试、UXP production build 与完整 14 项 `maintenance:validate` 全部通过。
- 仍未核实：普通自然语言如何在不创建新任务、不扩大目标的前提下接续同一 TaskRun / R4 节点并取得 V0 execution envelope；因此本轮只关闭精确请求范围扩张和原生弹窗两个 P0，不宣称 V0 E2E 完成。

## 标准设计 Agent 架构收敛

- 已确认产品身份：DesignEcho 是专业视觉设计与 Photoshop 生产 Agent，不是通用聊天助手、任意电脑控制 Agent 或 Photoshop 命令行外壳。该身份由 `Prompt.md` 与 Design Agent OS 定义，不实现为新的 Runtime Contract 或分类器。
- 已撤销 F0 代码化方向：不新增 `standard-design-agent-role-contract`、scope /六任务族枚举、`standard-design-task-contract` 或 `standard-design-outcome`。这些概念会与 Task Profile、Capability、TaskRun、Verification、DesignVerdict、Release 和 Delivery 重复。
- 已确认“从零创作”属于 Design Kernel 的本身设计能力，不是独立 Task Type、Skill、Executor、Workflow 或通用 WorkMode 路由。现有 `workMode=create_new` 只在业务兼容边界表达目标状态与保护关系。
- 已在 OS 固定唯一生产链与 Owner 矩阵：Task Profile → Context Compiler → RuntimeSession/TaskRun → R4 → Capability/preflight → TransactionRunner → operation result/verification → DesignVerdict → Release/Delivery → reviewed learning candidate。
- F1/F2 已完成 Task Profile crosswalk 与阶段化 Design Context 的 Owner 接线，F3 已落地首条受治理的单画布 Photoshop Craft Recipe。TaskRun 最小 owner、V0 五动作认证包和 X2 执行信封已接入现有 Agent /E1；当前真正缺口转为真实并发 /恢复、V0 Provider→Photoshop 纵切和真实设计纵切。Runner 仍仅迁移 5 个 owner，Recipe 尚未被 V1 实机验证，唯一 Release 尚未完成，无业务 Skill 的真实设计 E2E 未验证。
- 本切片修改了明确列出的 F1/F2 生产 Owner、既有业务边界审计与项目记忆，没有回退、暂存或提交并行会话改动。
- 本切片完整 `maintenance:validate`（14 个现行核心检查、无 smoke）和定向 `git diff --check` 均通过；验证覆盖 43 个 Intake、1037 个仓库文件、162 个 Tool、20 个 Skill、8 个 Runtime Skill Package、Main / Renderer 类型检查和 UXP production build，但不证明真实 Photoshop V0 E2E 或设计质量。

## 2026-08-03 X2/V0 执行信封纵切

- 已冻结 `photoshop.mutation.v0`：只包含 `renameLayer`、`groupLayersSafely`、`moveLayer`、`lockLayer`、`setTextStyle` 五个已由唯一 `PhotoshopTransactionRunner` 持有的 provider；每个动作新增一对一叶子 Capability，映射仍由既有 `LEGACY_TOOL_CAPABILITY_MAP` 单一拥有。
- 已保持语义 R4 的正确边界：Model 只声明设计步骤与依赖，`runtime-action-plan-declaration` 继续 `shadowOnly / executable=false / schedulerAuthority=false`；Tool 名、参数、layerId、坐标和目标 revision 不被塞入语义计划。
- 已在现有 E1 逐调用接缝编译一次性执行信封：同时校验 active leaf Capability、唯一 ready mutation node、TaskRun 当前 node /plan revision、Tool schema /参数、execution preflight、document /history revision 和单文档 writer。编译器不执行 Tool、不授予权限、不拥有调度 /重试 /完成。
- 已让 TaskRun 在派发前原子记录 node `in_progress` 与有界 execution ref；真实 `PhotoshopOperationResult` 必须与信封 provider 一致后按同一 nodeId 回写。缺失或错配转为 `unknown / needs_reobserve`，禁止盲目重放；包外 Tool 保持现有 v3/E1 路径。
- 已扩展既有 Capability 审计，静态证明 V0 默认收窄、broad Capability 不入包、五个 provider 均调用现有 Runner、Agent 只有一个生产编译接缝。完整 `maintenance:validate` 通过 14 个核心检查；没有创建、恢复或运行 smoke。
- 未验证：真实 Provider 是否选择并提交正确包内调用、Bridge /UXP /Photoshop 写入、同目标 verification、双 TaskRun 竞争、waiting /resume 与应用重启。以上未完成前不能把本切片描述为 V0 E2E 或“Agent 已会设计”。

## 2026-08-03 X1 TaskRun 与专业能力作业模型

- 已实现（唯一 Owner）：`runtime-session.ts` 原地持有 `taskRunId`、plan revision、nodes /cursor、非终态 `waiting_user`、pending interaction、document /history revision、单文档 writer claim 与 Host `PhotoshopOperationResult` refs；没有新增 Runtime、Task Store、DAG、continuation ledger、Completion 或 writer registry 模块。
- 已实现（真实执行点）：Agent 普通 Photoshop 写入在 dispatch 前保留 `expectedHistoryStateRef` 并声明 TaskRun writer；Engine 的确认卡续跑从现有持久化 continuation ledger 读取冻结 envelope，校验 `taskRunId / runId / generation / interactionId / planRevision / expectedRevision` 后才直接承接原 leaf operation。裸“继续 /可以”不恢复写权限。
- 已实现（诚实状态）：`awaiting_confirmation` 返回 `finalized=false / waiting_user`；stale revision、第二 TaskRun 与 `unknown` operation 转为明确拒绝或 `needs_reobserve`，不自动重放。语义 R4 继续 `shadowOnly / executable=false / schedulerAuthority=false`；只有 X2/V0 一次性执行信封可进入现有 E1。
- 已修复（原链路缺陷）：普通自主 Tool adapter 过去会在转交 UXP 前丢弃 private target guard 中的 `expectedHistoryStateRef`；现在完整保留并校验 document/revision。
- 已实现（成熟设计师式作业上下文）：Task Profile 声明后不再只停留在一次性 Tool result，下一轮起持续进入每轮 system context；Capability Session 每轮动态区分 active / on-demand / denied / unavailable，复用真实 provider Tool 的 Photoshop 前置条件、副作用和验收语义，并明确禁止随机 Tool 探索与重复失败尝试。
- 已验证（非实机）：Main/Renderer 类型检查、Capability 审计、Agent 业务边界审计通过；一次性 TaskRun reducer 行为检查覆盖等待、匹配 /stale 恢复、第二写者、OperationResult 节点归属和 unknown 防重放；一次性 Capability 行为检查覆盖装载前后实时投影及 legacy alias 语义继承。临时验证文件已删除，未创建或恢复 smoke。
- 未验证：两个真实 DesignEcho 任务竞争同一 Photoshop 文档、等待期间外部修改、应用重启后确认卡恢复、V0 执行信封的真实 Provider + Photoshop 闭环，以及无 Skill 设计效率与质量。

## 2026-08-03 近期改动复盘与重规划验证

- 已核实（Git /工作树）：当前分支最新提交早于 8 月 1 日，近期实现全部位于共享未提交工作树；本切片没有 reset、checkout、批量清理、stage 或 commit，并保持其它会话改动原状。
- 已核实（执行 owner）：Transaction ownership audit 仍报告 5 个 migrated owners；UXP `src/` 有 52 个包含 `executeAsModal` 的文件，不能把文件数量直接等同于 52 个 Agent mutation，但足以证明“全量迁移后再做 TaskRun / Foundation”没有稳定边界。
- 已核实（TaskRun / R4）：`runtime-session/v0` 的兼容外壳现内含 `runtime-task-run-state/v0`，拥有 plan revision、节点 cursor、pending interaction、operation result 和进程内单文档写者身份；`awaiting_confirmation` 不再 finalization。语义 R4 仍是 `shadowOnly / non-executable / no scheduler authority`，V0 通过后续 schema-bound Tool call 编译的独立执行信封取得单次派发资格。
- 已核实（Design Foundation）：`design-task-types.ts` 已成为 task type、artifact knowledge、Manifest /旧 Skill 与 document role 的唯一 crosswalk Owner；交付物知识和 Manifest 方法论通过唯一 Context Compiler 按当前 Runtime Stage 装载。无业务 Skill 路径声明合法 Task Profile 后，动态 operating context 会在后续每轮持续提供对应作业语义；Capability Session 也同步提供实时能力自我模型。
- 已采用 D-072：Runner 与 TaskRun 改为纵向会合依赖，Foundation 与执行 owner 分两条安全车道推进；未迁移 Tool 不进入 R4 capability pack，写入安全边界没有放宽。
- 已核实（验证）：`maintenance:planning-check`、完整 `maintenance:validate`（14 个现行核心检查、无 smoke）与全工作树 `git diff --check` 通过；这些结果不证明真实 Photoshop 无 Skill 设计 E2E 或设计质量。

## 本轮知识库重构研究（M4 前置）

- 已完成对内置方法论、统一知识检索、Memory、Project State、Eagle、Web、模板 /PSD、v3 Tool、v5 knowledge provider、Context Compiler 和知识库 UI 的代码级审计，并形成 `docs/design-knowledge-system-reconstruction-report.md`。
- 结论不是建设“大一统向量库”，而是建设 provider-neutral 的 Design Knowledge Plane：主进程唯一 Catalog Repository、可重建派生索引、唯一 Query Gateway、唯一 Context Compiler、证据中心的可视化和独立 Eval。
- 关键词保留为 exact /FTS /BM25 检索信号；它不拥有自然语言意图、Skill /Tool 选择、权限、写入门禁或完成裁决。开放式任务由模型理解，确定性边界仍在真实执行点校验。
- 已核实当前 Agent 与 UI 对“统一搜索”的覆盖和去重不一致；Agent Tool 描述声称包含 Eagle，但真实 Agent 聚合链未包含 Eagle。当前本地检索主要是 `includes()` 与固定 `sourceRank`，没有正式 FTS /BM25 /vector index 或独立检索质量 baseline。
- 已核实 Memory 将完整 state 写入 renderer `localStorage`，且视觉案例可携带无可靠字节上限的 `previewDataUrl`；目标方案要求 renderer 不再拥有 canonical knowledge，视觉二进制改为受治理的 artifact /thumbnail ref。
- Manifest knowledge identity、正文可达、Tool 可见与 Context 选入仍是四个不同状态；本切片已让现有 `applicableStages` 真正驱动结构化运行的阶段装载，并继续复用唯一 `runtime-context-compiler.ts`。
- K0 研究仍是知识系统长期参考；其中映射到 F1/F2 的只读 Owner / crosswalk /阶段装载已经实施。Catalog /索引 /检索评测等 K1—K6 其余内容未据此宣称完成，Knowledge 仍不得取得 Tool、Stage 或完成权限。
- 本轮文档变更已通过 `maintenance:planning-check`、1030 个仓库文件的 UTF-8 /行尾检查和 `git diff --check`；这些检查证明文档治理与补丁完整性，不证明 Knowledge Runtime 已实现。

## Harness 治理计划（目标已确认，基础层实施中）

- 用户目标已收敛为有效 Design Harness：Agent 即使不加载业务 Skill，也必须理解主图、详情页、SKU 子类型与开放式设计，使用真实项目 /PSD /知识来源形成设计判断，并把视觉意图通过 Adobe Photoshop 落成可编辑、可读回、可评价的结果。
- `Prompt.md` 与 Design Agent OS 已明确 Task Semantic Binding、Knowledge 优先级、常驻 Design Kernel、Photoshop Craft Recipe、TaskRun liveness、生产结果分层和执行内环 /经验外环；这些是目标治理，不是当前 Runtime 已实现事实。
- `Plan.md` 已移除 F0 角色 Runtime 合约，把产品边界留在 Prompt / OS；两车道纵向会合保持不变：F1/F2/F3 收敛现有 Task Profile、阶段化 Context 与 Craft Recipe，X1/X2 收敛最小 TaskRun、纵切 TransactionRunner capability pack 与 R4 节点直执行，随后先 V0 操作闭环、再 V1 无 Skill 设计闭环，并把 V1 接入唯一 Release 首条路径。
- Hermes 只作为渐进加载、Patch 优先、来源 /版本 /归档 /回滚的外部机制参考；不采用调用次数触发学习、纯模型自评或后台直写正式 Skill。
- 旧 M3-A 的全量迁移不再拥有后续全部工作的总门禁。Runner 仍唯一拥有单次 mutation 事务；TaskRun 最小 owner 已取得跨节点、跨等待与进程内单文档写者身份；V0 pack 与执行信封已完成代码和核心验证。当前仍没有完成 V0 实机纵切、Craft Recipe 的真实执行验证、Release Gate 或真实无 Skill 设计 E2E；代码完成不能替代这些执行证据。

## 通用设计判断与公开表达根因修复（已完成的 Foundation 部分）

- 已修复新消息的推理来源边界：`provider_thinking_delta` / `provider_final_thinking` 现在属于隐藏诊断，不可进入普通思考面板、不可持久化为公开判断，也不可占用写前公开说明状态；Provider reasoning 字段仍保留给协议连续性。
- Agent 的公开摘要只消费专门模型调用的 `content`，该调用显式关闭 Provider Thinking；进入 `visibleReasoningSent` 和写前 rationale 前再次执行共享通道策略。ChatPanel 不再把 Provider 的流式 thinking 直接投影到 UI，新公开摘要以 `decision / 判断` 呈现，而不是“思考日记”。
- 通用设计原则已改为任务目的条件化：区分说服、比较、解释、表达、规格化生产和局部修订。单焦点、主体 40%~60%、60-30-10、三级层次、复杂背景与投影都被降为特定场景启发式；白底、扁平、对称和多同权焦点不再被全局判失败。
- SKU 已拆成三个不同语义：`sku-template` 是比较型组件系统设计，`sku-color-card` 是真实、可编辑的颜色资产，`sku-batch` 是消费既有模板与组合规格的确定性生产。笼统 `sku` 只返回辨析知识，不选择 Skill、权限或 Runtime。
- `ecommerce.sku_batch.v1` 已加入 canonical 设计任务类型目录并与现有 `sku-batch` Skill /v5 Manifest 对齐；`ecommerce.sku_template.v1` 已解除错误的 `sku-config` 绑定，在没有专用 Skill Overlay 时明确回到通用设计能力。
- SKU Template 不再要求 Eagle /知识检索 /参考分析任一成功后才允许建画布。参考仍是有价值的设计依据，但参考服务离线不能再形成“确定做不到”的硬门禁；Agent 应继续使用模型基础知识、项目 /PSD 事实与写后视觉复核推进。
- 默认设计质量目录已改为任务中性断言，确定性检查、VLM 待评目录与最终评分保持同源；显式 Evaluation Profile 继续携带主图、详情页、SKU 等任务规则，避免把营销图启发式重新扩散为跨品类硬门禁。
- SKU 用户授权已从模型参数中剥离：组合、模板与占位回退的模型字段只能表达候选，不能伪造用户确认。结构化确认必须经过 Engine 对 continuation ledger、owner、card、fingerprint 与 scope 的校验后，通过独立 trusted continuation 通道进入 Skill；模型 schema 拒绝未声明顶层字段并剥离 Runtime-owned card/continuation 字段。
- 色名来源已保真：文件名回退与视觉/模型推断保持 provisional，并进入 `needs_review`；普通资源 `name` 不再自动等同于用户提供色名。SKU 备注也不再默认生成，只有用户、权威项目配置或可信交互确认明确要求时才进入交付范围。
- 在上述最终代码状态下，`build:typecheck:renderer`、`audit:capability-resolver`、`audit:executor-generic`、`audit:skill-standard`、`audit:agent-business-boundaries` 与完整 `maintenance:validate` 均通过；完整验证覆盖 14 个现行核心检查、Main/Renderer 类型、工具/Handler/Skill/通用执行器/业务边界/Capability/Skill Package/Prompt 治理、Agent 核心测试与 UXP production build，`git diff --check` 通过。
- 当前已实现最小 TaskRun owner、动态能力作业模型、V0 mutation pack 与 pack-scoped 执行信封，但没有完成 V0 /Craft Recipe 的真实执行闭环或 Release Gate，也没有运行真实 Provider + Photoshop 设计 E2E；因此不能据此宣称 Agent 已能稳定“把设计做好”。
- F1/F2 的静态退出条件已由业务边界审计和阶段编译断言覆盖：8 个 artifact-owner Manifest 均回到唯一 Task Profile，R3/R4 只装载适用方法知识，普通参考为按需输入；真实任务上的选择质量仍待 V1/M6 验证。
- 首条 `photoshop-craft.editable-single-canvas-composition@1.0.0` 已绑定真实 Tool 名、必要观察、稳定 document/layer 目标、参数 authority、保持项、结构 /像素读回、unknown 与 rollback；统一知识检索可召回，无 Skill Task Profile 声明可回填，Stage Context 在 R3 排除、R4/R5 装载。它不授权执行，真实工艺有效性仍待 V1。

## 2026-08-03 SKU 真机运行 60：任务语义续接与局部恢复

- 已核实（真实运行）：同一会话此前已明确需要制作 `2双装.tif / 3双装.tif / 4双装.tif / 自选备注模板`，且先修改占位符避免色卡重叠；当前短指令“帮我做SKU”却被自主 Agent 当成无历史的新任务。Run Record [60] 共 9 轮，完成摘要为 12 次 Tool（11 成功、1 失败）、`successfulMutationCalls=0`，最终没有 Photoshop 写入。
- 已核实（根因）：Engine 持有 `conversationHistory`，现有 `agent-conversation-context.ts` 也已提供有界、data-only、当前指令优先的历史编译器，但自主执行器没有把它交给 Agent；模型只能从当前四个字和项目资源重新猜交付物。Task Plan 因而保持中性 `agent_resolved_result`，没有承接此前明确的 SKU Template 目标。
- 已核实（次生问题）：`measureReferenceComposition` 的 Tool 描述把可选参考测量表达成普遍置图前置，模型在已经读过目标文档与画面后仍搜索参考并调用它；调用失败后虽收到“不阻断继续”的恢复指令，最终失败会计仍把它算成未恢复项。0 写入的 `needs_review` 默认文案又错误声称“已经生成当前版本”。
- 已实现（通用 Harness）：自主 Agent 复用唯一会话上下文编译器，注入当前输入之外最近 8 条 /6400 字符的有界历史；新增任务落地纪律要求先绑定具体交付物、能从同会话唯一承接时直接续接、仍不唯一时只问一个决定执行方向的问题，禁止用反复搜素材代替澄清。没有新增 SKU 关键词 Router、Executor 状态机、Memory Store 或权限通道。
- 已实现（完成义务）：模型一旦用 ready Runtime Design Brief 声明 `photoshop_mutation_with_readback`，现有任务义务门禁就要求真实写入 /交付动作；只读、打开、解释和分析任务不受影响。可选只读观察失败继续在 Trace 中保真，但可标记为 `non_blocking_observation`，不再独自把后续有效交付降级。
- 已实现（诚实输出）：没有成功 Photoshop 写入、导出或外部生成的 `needs_review` 不再声称已有版本；返回“只完成现状读取、没有可供复核的设计版本”。参考构图测量只在已经明确选中相关参考且需要复现数值时使用，没有参考或测量失败必须按当前画布、组件边界与设计原理继续。
- 已验证（非实机）：Renderer/Main 类型检查、`audit:agent-business-boundaries` 与完整 `maintenance:validate` 通过；完整验证仍为 14 个现行核心检查、无 smoke，并包含 UXP production build。修复后的同会话 SKU 复跑尚未执行，首次有效写入延迟、交付物正确率和设计质量仍未验证。

## 已核实（代码）

- `PhotoshopTransactionRunner` 已承接 `renameLayer`、`groupLayersSafely`、`setTextStyle`、`moveLayer` 与 `lockLayer`。后四者均绑定 document /revision；`setTextStyle` 按稳定 ID 逐 range patch，`moveLayer` 读回位置与几何，`lockLayer` 以显式 `_id` 的 `applyLocking` 取代会落到活动图层的 DOM setter。
- R-040 最小 containment 已实施：只有 `fail + severity=blocker + deterministic + 合法 blockerKind + 安全 proofRef` 能形成质量硬阻断；通用审美、VLM coverage 与 above-baseline 缺陷只进入 finding / `needs_review`。Completion、DesignVerdict、Critic 与 Reflexion 使用同一资格谓词；M5 的唯一 Release Gate 与全量旁路消费者归一仍未完成。
- 普通 `setTextContent` 已停止复用隐式旧样式 descriptor；显式候选文案基线按 documentId+layerId 隔离。Agent 外层 acceptance 现在会把改字号时的字体/内容漂移、改文案时的样式漂移判为失败或需复核，而不是只看请求字段。
- `groupLayersSafely` 的 Host unknown 与 transport unknown 只通过一次严格层级读回分类为 `applied / not_applied / ambiguous`，不重放写入；mutation proof reader 只读取声明式 `toolResults[].result`。
- 当前实现区分 `pre_dispatch` 与 `dispatched`，并保留 `verified / failed / unknown` 的 operation result 语义。
- 普通自然语言现直接进入通用 Agent；前置 `task-classifier` 模块与 Router 专属 helper 已退役，不再为同一请求先付出一次分类模型调用。关键词不再决定回复、澄清、Skill、Tool 或写权限，只保留无模型兼容提示和用户明确给出的 deny-only 能力边界。
- 普通 `autonomous-agent` 请求的规划场景不再从用户文本推导主图、详情页或 SKU 类型；只有结构化 `skillId` / `taskTypeId` / Runtime bundle 能绑定确定性工作流。模型可在运行中通过 `declareDesignIntent` 声明设计任务类型，声明结果会写回本轮纪律上下文与最终 Run Record。
- 自然语言 Agent 的开场观察已改为文档身份级 `getDocumentInfo`；只有结构化 Runtime 明确需要像素时才预取画布。文档打开/切换以文档列表、documentId 与切换读回为充分证据，不再为导航任务调用画布快照或视觉模型。
- `AgentTaskPlan` 已把 `canExecuteTools` 与 `requiresTaskProgress` 分开：普通自然语言允许主 Agent 自主回答或调用可逆能力，但不会被 Harness 强迫调用 Tool；只有结构化续跑、已批准计划、已选 Runtime 身份或确定性 Skill 才签发真实进展义务。
- 普通 Agent 不再在模型前探测并抢跑阻断 Photoshop bridge；连接与文档状态保留 `true / false / unknown`，unknown 放行到真实 Tool 执行点，只有明确 false 才可阻断结构化 Photoshop owner。
- 模型 Provider 失败现在只在真实模型调用边界标记并集中分类；`402` / `Insufficient Balance` 归为 `billing`，不会再被泛化为“检查当前文档”。Tool 与运行时错误不走这条分类，避免把 Photoshop 故障误报成 Provider 故障。
- 模型首轮尚未产生 Tool call 即失败时也会保存失败 Run Record，并明确记录 `toolCallsStarted=false`、`photoshopWriteOccurred=false`；`autoFallback=false` 继续得到尊重，不会暗中切换模型。
- 设计团队协作不再由任务文本正则升级为 `required` 写入门禁；文本最多形成 advisory，只有结构化 `requiresDesignTeamConsultation` 能签发 pipeline 义务。
- `candidate_only` 允许回答与只读观察，但拒绝 Photoshop 写入、导出、外部生成和非只读状态变更；RecoveryQueue 复用同一可见性判据，不能把隐藏写工具重新放回。no-Skill、精确 Tool/Skill 名和 Photoshop 域禁令同时在候选面、按需激活和最终执行点保持 deny-wins；未知 source-dependent 能力在可见性阶段保持开放，真实调用时再按参数裁决。
- 公开计划确认已使用唯一 UUID `requestId` 与 `sourceMessageId` 双绑定；旧的无 `requestId` 计划不迁移、不从历史或固定字符串恢复执行身份。
- V0 执行信封已完成代码与核心验证；片内旧结果归属的实证退役、首条 Craft Recipe 的真实执行验证与后续实证扩展、唯一 Release Gate 和真实业务 E2E 尚未完成。

## 已核实（构建）

- 当前记录显示定向事务 / 取消 / R4 对账 / Completion / preflight 回归、Renderer/Main 类型检查、Agent production build 和 UXP production build 已通过。
- `maintenance:validate` 当前通过 14 个无 smoke 核心检查；这只证明对应静态、审计、构建和核心测试，不等于整体 Photoshop E2E 或设计质量通过。
- 本次文本 /移动 /锁定事务切片通过 UXP transaction ownership audit、UXP production build、Renderer/Main 类型检查、工具注册 /通用执行器 /规划审计、中文编码检查与 `maintenance:validate`；ownership audit 当前列出 5 个 migrated owners。
- R-040 containment 通过能力解析审计、Renderer/Main 类型检查和软硬阻断行为矩阵；`maintenance:validate` 当前仍通过 14 个无 smoke 核心检查。
- 本次 Provider 失败修复通过 Renderer/Main 类型检查、Renderer production build、定向分类契约检查、`git diff --check` 与上述 14 个核心检查。
- 本次 Agent-first / 延迟视觉观察修复通过 Renderer/Main 类型检查、Renderer production build、业务边界与通用执行器审计、简化棘轮、`git diff --check` 与上述 14 个无 smoke 核心检查。

## 已核实（手测）

- 两个 disposable Photoshop canary 真实验证了图层重命名和连续同父级编组的 History、层级顺序、未选兄弟、Pass Through、opacity 和无效目标零写入。
- canary 不含非平凡剪贴链；临时文档未保存关闭，原文档恢复为活动文档。
- `setTextStyle` canary 在 document `633` 验证了字号 `48→64`、多 range 结构与内容 /字体 /颜色 /tracking 保持、字号变化后的 bounds、幂等、错误 /非文本 /锁定目标零写入；另一文本层验证字号变化保持 `autoLeading=true`，显式 `leading=52` 后读回 `autoLeading=false`。临时文档不保存关闭后，原始 `详情页.psb` 仍为 document `182`、history `625`。
- `moveLayer` 在同一 disposable 文档验证了 layer `5` 从 `(60,265)` 移到 `(90,225)`，宽高保持 `224×90`，History `651→653`；同位置绝对移动为 `already_satisfied`，旧 revision 在写前拒绝且独立 bounds 读回未变化。
- `lockLayer` canary 在 document `654`、活动 layer `4` 的条件下，用显式目标 layer `3` 完成 `all` 锁定，History `662→663`；独立读回确认 layer `3` 锁定、layer `4` 未锁且活动图层未切换，重复调用为 `already_satisfied`。
- `lockLayer` canary 随后被另一个正在运行的 DesignEcho 任务并发写入 “A-2双装模板” 结构，History 继续变化到 `698`；旧 revision 请求被 Runner 正确拒绝。因新增内容可能属于用户任务，没有强行关闭并丢弃 document `654`，当前它仍作为活动临时文档保留。
- 2026-08-01 15:57 的“帮我打开SKU”失败已由日志定位：DeepSeek 在模型第 0 轮返回 `402 Insufficient Balance`，当时没有业务 Tool call、没有打开文件、没有 Photoshop 写入；文件、UXP、WebSocket 与 Agent-first 路由均不是根因。
- 修复后用同一句“帮我打开SKU”完成多次真实回放。2026-08-01 17:20 的最终构建回归从 `详情页.psb` 出发，由模型自主调用 `listDocuments`、`searchProjectResources`、`switchDocument`，约 23 秒完成；没有 `getCanvasSnapshot`、`getAnnotatedSnapshot`、MiMo 视觉调用或 Photoshop mutation。Run Record 为 `run-20260801092036-8d91e2a4-45a6.json`（3 轮、2 次 observation、1 次 control、0 次 mutation、无 blocker/warning），独立 Photoshop 读回为 `SKU.psb`（documentId 242，1500×1500、17 个图层）。

## 2026-08-04 合并图文字替换与主体感知置入：共享工艺收敛

- 用户提供了两个 V1 通用场景：把合并位图中的局部文字值替换为新文案，以及把明确图片置入后按视觉主体调整到合适大小与位置。它们被归属为 Design Kernel / Photoshop Craft 的共享能力，不建立 FEX、白底图、SKU、主图或详情页专属 Executor / Router /固定坐标分支。
- 根因审计确认现有 `placeImage` / `fitLayerSubjectToRegion` 原子能力已经存在，但 Tool 描述把可选参考测量和固定占比暗示成普遍前置；复合主体适配写入后又要求模型自行额外读取和计算，造成重复搜索、往返试探和预算消耗。合并图局部替换则缺少受治理的背景复杂度边界与同区域复核方法。
- `fitLayerSubjectToRegion` 现消费共享 `design-smart-scaling-policy`：模型只声明 designType、assetRole、intent 和 targetRegion，省略占比 /锚点时由共享预设产生首个 targetFill、anchor 与 visualBias；用户、模板或已选参考有明确约束时才覆盖。写入后在同一次复合调用内读取同一 layerId 的实际主体与图框，并输出实际占比、主体可见比例、锚点偏差、投影偏差和 `passed / needs_review / failed` 几何裁决。几何通过明确不代表审美、清晰度、无遮挡或 Release 通过。
- `placeImage`、`getCanvasSnapshot`、`createRectangle`、`createTextLayer` 的模型语义已收紧：已明确素材不得重新搜索；局部修订使用一次定位 +一个紧凑 region，并在写后只读同一区域；矩形只允许覆盖纯白或具有权威色值且局部均匀的背景；新文本 x/y 明确为可见 bounds 左上角文档像素坐标。纹理、渐变、照片或颜色不确定时禁止用平涂矩形伪造自然修复。
- 新增 `photoshop-craft.flattened-raster-text-replacement@1.0.0` 与 `photoshop-craft.subject-aware-image-placement@1.0.0`。二者声明必要观察、参数 authority、保护范围、真实 Tool 选项、结构 /像素读回、一次有依据修订上限、unknown /rollback 和能力边界；常规 Stage Context 与 `declareDesignIntent` 只返回紧凑索引，完整 Recipe 继续通过唯一 `searchDesignKnowledge` 按需读取，未建立 Recipe Runtime 或第二执行 Owner。
- 正式业务边界审计新增语义锚点与写后几何裁决正反例，并锁定两条通用 Recipe 与紧凑按需装载。Renderer/Main 类型检查、工具注册审计、通用 Executor 棘轮和业务边界审计均通过；完整 `maintenance:validate` 通过 15 个现行核心检查，包含规划 /仓库卫生 /编码、工具 /Handler /Skill /Capability /业务边界治理、Agent 核心测试、类型检查和 UXP production build，无 smoke 依赖。
- 当前没有新增 OCR 字框或像素取色 Tool。白色等已知均匀背景可按局部像素完成可逆遮盖；复杂背景仍需要可验证选区的修复 /生成填充能力，否则只能 `needs_review`。本轮没有启动 /关闭 Photoshop，也没有对用户真实 PSD 做无人值守写入；两条 Recipe 的真实 Provider + Photoshop 效率与设计质量仍待 V1 实机验证。
- 后续审计发现一个真实入口缺口：普通自然语言在 `declareDesignIntent` 前没有 taskType，旧 `buildPhotoshopCraftRecipeRuntimeItems` 因空身份返回空集合，导致最常用入口看不到已存在的通用 Recipe。现按 Recipe 自身 `design.generic.v1` 适用标记提供紧凑 fallback；它不选择 generic Manifest /Skill、不授予权限、不推进阶段，也不扩大交付物。索引同时提供最多四个有条件候选工艺，并明确“按观察选择最短可靠组合，不是逐项试探；目标 /素材明确时不重搜项目或参考”。
- 正式业务边界审计现用四种自然问法验证空 taskType 时 Recipe 集合完全一致，并锁定“可编辑文本→直接改文本内容；合并像素 +均匀背景→局部可逆遮盖 +可编辑新文字；纹理 /渐变 /照片且缺少可验证选区修复→needs_review”的能力边界。普通入口三条索引合计 2398 字符、单条最多 808 字符，审计上限分别固定为 2600 /900，避免能力可见性反向挤占执行预算。Renderer/Main 类型检查和完整 15 项 `maintenance:validate` 再次通过；没有启动可见应用或写入用户 PSD。
- 同 TaskRun 接续的代码审计进一步确认：taskRunId 来自 Runtime identity 的 sessionId，但当前主进程 Artifact 授权只能在 skillId/taskType 已知后签发 identity；现有 Capability Session 也没有运行中绑定 Manifest 的 API。因此不能在 `declareDesignIntent` 后只补一个 Renderer Session 或递归新建 Agent 假装接续。下一纵切必须由主进程先签发 plan-neutral identity，并在同一 identity 上原地绑定 Manifest /stage plan、Capability Session 与 Artifact 授权，同时保持请求写范围、document /revision、Tool log 和预算。

## 未核实 / 待验证

- 真实 Photoshop Host 取消、断链、丢响应和非平凡剪贴链。
- `setTextStyle` 的真正 mixed-property style range、写后验证失败注入与 rollback 真实读回；当前只验证了多 range 结构，不能外推为不同字体 /颜色混合样式已验证。
- 其余 legacy Photoshop 写工具的 Runner 迁移与旧 owner 退役。
- 自然语言“整理图层”经真实 Model →同一 TaskRun → R4 execution envelope → E1 → Electron → UXP → Photoshop →同目标 verification 的完整 E2E；当前只证明 v3/E1 确定性精确修改和最小写范围。
- Agent-first 路由对 SKU 色卡“禁用 Skill、保留原子 Tool”的真实 Provider → Photoshop E2E。
- Provider 已恢复，修复后的真实 `402` 用户提示分支尚未再次触发；当前证据是定向分类契约、类型/构建检查与失败边界审查，不能把成功打开 SKU 当成该错误提示分支的实机验证。
- 可挂起 TaskRun、revision-bound interaction resume、单文档写者身份和 capability-pack scoped 执行信封的真实 Provider + Photoshop 闭环。
- Task Semantic Binding、统一 Design Kernel context、Photoshop Craft Recipe、TaskRun liveness owner、Release Gate、无 Skill 通用单画布及主图 / SKU / 详情页真实 E2E、设计质量与真实效率指标。
- 合并图局部文字替换在纯白 /权威均匀背景上的真实定位精度、字体近似和同区域视觉复核；复杂背景选区修复仍是明确 capability gap。
- 主体感知置入在真实透明留白图、模特图、辅助细节图上的 Photoshop 写后读回、清晰度判断和一次修订收敛率。

## 当前风险

1. Runner 只迁移了 5 个 owner，legacy mutation 仍多；若继续用“全量迁移完成”作为全局阶段墙，会形成无边界水平工程，若直接开闸又会形成双 owner。当前改为按 capability pack 迁移并在同一纵切退役旧 owner。
2. 把语义 R4 全局翻成 executable，或让包外 Tool 绕过执行信封，会绕过目标绑定、事务和未知状态读回。
3. 清理历史时不能误删不可逆审批、schema / permission、target / revision、rollback 和 unknown readback。
4. 自动化核心检查、单个 canary 和 Tool success 不能升级为设计质量或交付完成。
5. no-Skill、精确修改写范围等任务级能力上限尚未全部由 TaskRun snapshot 跨暂停 /重启持久化；当前结构化 continuation 继续要求 revision-bound identity，裸“可以 /继续”不得恢复历史写权限。
6. 自主 Agent 尚无安全的运行时跨 Provider 故障转移；`autoFallback=false` 时不切换是正确行为，未来若支持自动回退，必须在单次模型请求边界切换且不得重放已经执行的 Photoshop Tool。
7. Provider provenance 尚未作为结构化字段跨 IPC 传递；当前已确保 `unknown` 不标记为 Provider，但少数包含明确 HTTP 状态或网络语义的本地异常仍有低概率误归因风险，后续应在主进程真实请求边界签发结构化来源。
8. Task Profile crosswalk 与阶段知识已在代码层收敛，但尚无真实无 Skill 设计 E2E 证明模型能稳定形成并执行高质量设计决策；不得以继续堆 Prompt 或知识条目替代 V1 实证。
9. TaskRun 已拥有 waiting /revision /writer /operation result 的最小状态，但 liveness、Recovery、Completion 与预算 owner 尚未全部收口；重复控制声明或观察仍可能消耗后续写入、读回和评价预算。
10. 未经 Release 和人工复核的运行若进入 Memory / Skill，会把失败或偶然成功固化为跨会话偏差；M7 前不得开启自动晋升。
11. R-040 当前生产评分、Completion、Verdict、Critic 与 Reflexion 已完成证据资格 containment，但 M5 尚未建立唯一 Release Gate，也未完成所有 legacy /外部 producer 的全量归一；新消费者仍必须由审计阻止回退到裸 severity。
12. TaskRun 已提供进程内单文档 writer claim 与结构化续跑 revision 校验，但两个真实任务竞争、应用重启和 legacy Tool 覆盖尚未验证；裸“继续”继续不得恢复历史 mutation。
13. `layer-properties.ts` 中 `setLayerOpacity`、`setBlendMode`、`setLayerFill` 等相邻旧写动作仍需审计；`lockLayer` 的实机事故证明“先 resolve layer，再用 DOM setter”并不等于稳定目标写入。
14. Task Profile / Manifest 若被误当成用户授权，会把精确修改扩张成更多交付物或 mutation；当前精确属性请求已 containment，但普通自然语言声明后进入同一 TaskRun / R4 的生产接续仍待实现和实机验证。
15. 普通自然语言现在能看到通用 Photoshop Craft 索引，但 Recipe 可见不等于实际局部选区 /修补能力、TaskRun /R4 绑定或真实设计质量通过；若把知识入口修复误报成执行完成，会再次掩盖 V0/V1 缺口。

## 下一步

1. 冻结已完成核心验证的 F1/F2 Task Profile /阶段 Context Owner 与三条 F3 Recipe；后续知识和 Recipe 缺口必须由真实任务证据驱动。
2. 保持本轮精确修改的请求级最小写范围，设计安全的自然语言 →同一 TaskRun / R4 接续；Task Profile / Manifest 只能装载语义和方法，不能扩大用户目标或 mutation。
3. 完成 X1 剩余实机项：用真实 Photoshop 验证同文档竞争、waiting /resume、stale revision、重复提交与应用重启边界；V0 pack 与生产接线不再列为待编码项。
4. 完成 X2/V0 实机：由真实 Provider 提交包内 Tool call，经 TaskRun → execution envelope → E1 → UXP → Photoshop → 同目标 verification，并以结果决定片内猜测式归属的退役范围。
5. V1：再迁移受限单画布所需 capability pack，使用已接入的 Photoshop Craft Recipe 完成真实多尺度复核与唯一 Release Gate 首条消费路径；局部文字替换和主体感知置入作为共享工艺用例验证，不先扩业务 Skill 或自动学习。
6. M5/M6：收敛唯一 Release 消费者，再对主图、SKU Template / Color Card / Batch 与详情页做多样本真实验收。

## 治理锚点

`AGENT-REACT-REFLEXION-GOVERNANCE-001` 仍是历史治理依据之一；业务 Skill 的当前边界由 `business-skill-design-governance` 和 `Plan.md` 的 `Skill / Tool 边界`共同约束。三类 Skill 不是三套 Agent。

## 2026-08-04 门禁定义手册与防漂移审计（gate governance）

- 已核实（静态审计，未改门禁代码）：盘点了 v3 主路径 + v5 演进下的 27 个门禁/策略，按 10 类（S 安全 / A 授权 / C 确定性约束 / D 设计纪律 / B 预算 / F 熔断 / E 能力 / V 视觉 / N 完成判定 / X 业务链路）建立定义手册 `docs/agent-gates-definitions.md`（B 层文档）：每个门禁含 ID、位置、拦截行为、设计理由、放行边界、出口、判据自检。维护规则：改门禁代码必须同步手册条目；新门禁必须先过手册第 5 节 Checklist。
- 已核实（审计发现，按影响排序）：(1)【高】视觉预算/非视觉模型 × 设计纪律互锁——截图 not_observed 后 visualReviewed 恒 false，block-2（连续写 3 次）与 block-7（导出前必看）永久锁死写入与保存导出，无降级出口，最终被 policy-gate-repeat-guard 以"出口不可达"熔断；(2)【中】多交付物长任务（主图+详情页+SKU）targetRole 单一 + block-5 防重复建档 → 同角色第二个文档建不出来；(3)【中】预算熔断后"继续"命中 unboundAck 降级为 candidate_only → 续跑失去写权限，且纪律状态不跨 run；(4)【低】agent-resume-execution-gate 的 photoshopWritesAllowed !== false 与 business-skill-execution-preflight-gate 的 contextState[key] !== true 是 unknown 折向否定残留。
- 已实现（静态审计）：新增 `scripts/audit-gates.cjs` + `npm run audit:gates`（已接入 `maintenance:preflight:core`）：校验手册引用的 21 个文件与标识符在代码中真实存在、ID 唯一、明细完整（单向漂移检查：手册不能指向空气）。`npm run audit:gates` 通过、`npm run check:repository-encoding` 通过（994 文件无乱码）。
- 未验证（真机）：预算×纪律死锁与多文档长任务未在真实 Photoshop 复现验证；修复方向已记录于手册 4.1~4.4（纪律降级 / 多目标授权 / resume token），待立项实施。

## 2026-08-04 门禁五处缺陷核对与修复（gate governance round 2）

- 已核实（代码核对，逐条验证）：(1)【成立·高】预算×纪律互锁——agent.ts no-visual-capability / 预算耗尽写 not_observed(reviewed:false)，纪律 applyDesignDisciplineProgress 只认 visualReviewed===true 重置，block-2/block-7 永久锁死；(2)【成立·中】多交付物任务——inferDesignDocumentRoleFromTaskText 先到先得单角色，rolesMatch 折 reuse 拦死第二个同角色 createDocument；(3)【成立·中】熔断×续跑——预算熔断后"继续"命中 unboundAck 降级 candidate_only，v3 普通路径无 reflexion handoff（v5 session 路径已有）；(4)【不成立】agent-resume-execution-gate 的 photoshopWritesAllowed !== false 是协议守卫（模型恢复计划不得自我授权写，唯一通过值=显式 false，出口可达），非三态误判；(5)【部分成立】business-skill-execution-preflight-gate 的 contextState[key] !== true——调用方恒传 boolean 当前不触发三态，属防御性写法隐患。
- 已修复（缺陷 1）：design-discipline-runtime 新增 isStructuralDesignReviewTool（观察工具集-纯图像快照）与 isRuntimeVisualReviewBlocked（not_observed reason 白名单）；executor 新增 resolveVisualReviewedForDiscipline 三处共用（进度记录/回填复核/run-record）——视觉复核运行时不可用时，成功结构读回计入复核证据，写入/导出不再永久锁死。
- 已修复（缺陷 2）：design-document-role 新增 inferDesignDocumentRolesFromTaskText 多角色集合；buildDesignDocumentRoleContext 传 targetRoles；resolveCurrentDocumentUseMode 多目标分支（用户明确就地修改仍 reuse，否则 separate_target → createDocument 放行 + block-5 trusted 生效）；多目标 agentInstruction 文案同步。
- 已缓解（缺陷 3，根治待立项）：预算熔断消息（agent.ts readPerformanceBudgetExhaustion）指导用户重新描述完整任务，明确"单独回复继续不会恢复写权限"；结构化 resume token 待立项。
- 已修正（缺陷 5）：business-skill-execution-preflight-gate 改为 === false（未传字段=unknown 放行）。
- 已核实（不修改）：缺陷 4 撤销，手册 X-5 重标为协议守卫。
- 验证：build:typecheck:renderer 通过；audit:gates 通过；check:repository-encoding 通过。未做真机验证（无 Photoshop 实测），修复语义已按现有代码路径推演。

## 2026-08-04 详情页真机运行诊断：慢、未完成、被手动操作干扰

- 已核实（会话 f2e9aaa3 + errors.log 实证）：三连任务首轮 plan_execution_mismatch（20 轮，只读未动手）；整理图层轮 provider 429（小米 MiMo 请求过于频繁，iter=2 失败）；详情页设计轮多次 awaiting_user_confirmation（视觉观察/事实复核卡 ×3）+ no_progress（19 轮，错误 No progress detected）。errors.log 显示 UXP WebSocket 反复断开（06:56-07:32 十余次），与用户手动操作 Photoshop 的时间窗口重合。
- 已定位（根因链）：用户手动操作 PS → UXP WebSocket 断开 → moveLayer 等工具失败（"移动图层没有全部成功，暂不能确认画面达到要求"= agent.ts tool_failures_in_round）→ 模型盲目重试画布工具 → 无进展 → no_progress 停机。慢的主因：429 限流 + 连接不稳定下的失败重试 + 等待确认卡人工在环。
- 已修复：agent.ts 工具失败分支新增 failedBecausePhotoshopDisconnected 识别（匹配 UXP 插件连接已断开/WebSocket disconnected），命中时 emitStep「Photoshop 连接断开」+ harness 控制消息明确指路：停止重试画布工具、提示用户检查 UXP 面板、本轮可用非 PS 能力——防空转消耗迭代（与 no-open-document 分支并列，断开优先）。
- 未修改：429 限流无自动退避（保留快速失败，用户可切换模型）；等待确认卡次数（产品流程）；UXP 侧 moveLayer 的 translate 不支持分支（PS 版本差异，风险高）。
- 验证：build:typecheck:renderer 通过；audit:gates 通过。未做真机复测（需真实 PS + 小米模型环境）。

## 2026-08-04 品类词条库归一（design-category-terms）

- 已实现：新增 `src/shared/design-category-terms.ts`（唯一词条数据源，6 类 51 词条 + SKU 边界模式 + 构造 helper buildCategoryTermPattern / buildCrossCategoryTermPattern）；5 个消费方替换为「子集声明 + helper 构造」，正则语义与原版逐字一致（design-document-role / agent-task-planning-contract / sku-intent-params / task-completion-contract / agent-intent-control-plane）。
- 关键事实（盘点结论）：各处品类词并非完全相同，而是各阶段裁剪过的子集（如 name 判定用 detail-page/product\s*detail 别名、意图判定用 长图）——因此不合并判定逻辑、只归一词条数据，消费方以子集声明保留各自语义。
- 已实现（对比验证）：新增 `scripts/verify-category-terms.cjs` + `npm run audit:category-terms`（已接入 `maintenance:preflight:core`）：(1) 词条库 51 词条全部在 git HEAD 旧代码存在（防行为扩张）；(2) 每个消费方子集声明词条在旧版对应文件存在（防抄错/漏抄）；(3) 子集词条必须登记在词条库（防漂移）。当前全部通过。
- 验证：build:typecheck:renderer 通过；audit:category-terms / audit:gates / check:repository-encoding 通过。未做真机；正则语义一致性由逐字构造 + 存在性验证保证（本轮为纯重构，无行为变化）。
- 基线修复（同轮）：verify-category-terms 基线由 git HEAD 改为「改动前版本」自动解析——当前文件与 HEAD 不同（未提交）取 HEAD 为旧基线；相同（已提交）取 HEAD~1，避免提交后守护退化为自洽检查。已验证 HEAD~1 基线可用。

## 2026-08-10 SKU 色卡 UXP 手动双模式入口

- 已实现：UXP 主面板新增「色卡制作」入口，用户可直接选择多张商品图、编辑权威颜色名、调整顺序、选择输出目录和 PSB 文件名，无需向 Agent 发起对话。
- 已实现：入口明确分为两条互斥链路。`INS 卡片色卡` 使用 `retouchMode=layout_only`，保留原图/场景并跳过抠图、形态统一和中性灰；`纯底精修色卡` 使用 `retouchMode=studio_retouch_required`，进入现有确定性抠图、形态统一、原影分离与中性灰修正链。
- 架构边界：手动入口通过 UXP → Main → Renderer 桥接直接复用既有 `executeSkuColorCardStrategy`，没有新增第二 SKU Skill、第二色卡执行器或通用 Agent 品类分支；Main 负责请求互斥、超时和进度转发，Renderer 只投影紧凑结果，不把快照/base64 回传给面板。
- 完成语义：面板成功只声明“可编辑色卡结构已生成”，明确提示用户在 Photoshop 中检查轮廓、裁切、特殊袜口、纹理与光影；未把结构写入成功伪装成专业精修或商业质量验收完成。
- 验证：`build:typecheck:renderer`、UXP production build、`audit:handlers`、`audit:tools`、`audit:skill-standard`、`audit:executor-generic`、WebView 内联脚本语法与静态 ID 重复检查均通过；当前环境没有可调用的 DesignEcho Photoshop MCP/Computer Use 实机通道，因此新手动入口的真实 Photoshop 文档写入仍未验证。

## 2026-08-10 多 Harness 控制权治理闭环

- 架构结论：当前不是多个互相独立的 Agent 产品，而是一个 Design Agent 运行系统中的多层 Harness。Task /Intent、Context /Knowledge、Runtime /TaskRun、Capability /Tool、Observation /Evidence、Aesthetic /Evaluation、Completion /Reflexion 与 Compound Budget 各有不同职责；治理目标是让它们共享同一身份、事实和控制边界，不是再造一个总管 Kernel。
- Runtime 原子绑定已闭合：自然语言在循环内声明 Task Profile 后，候选 Runtime Bundle、Capability Session、阶段 Context、Evaluation Profile、Artifact 授权、性能预算与 generation lineage 全部构造成功后再一次提交；动态 Context 从新 Bundle 重编，不沿用声明前空上下文，也不重启 Agent /TaskRun。
- Completion 与门禁已事实化：通用创意只硬校验真实写入、正确目标、最后写入后的同目标读回、显式 copy /no-copy 最终态与可验证文件交付；Evaluation Profile 不再绕过事实义务。审美、白底、极简、扁平、居中、标题和卖点不再作为通用写前权限配方；未知最终态降为 `needs_review`，不是伪造 pass 或 failed。
- 审美 Harness 已形成非授权闭环：终局 Judge 每 generation 有独立保留的 model /visual /candidate /90 秒时间窗口；score 是唯一数值权威，无分结果不污染覆盖率，文字专属断言可可靠 N/A，诊断按最低分 /严重度 /权重强制只保留 top 3。Profile 可选检查从评分和 Completion 门禁中排除，但仍保留在 verification digest 与 warnings；结构测量明确标为同历史的结构启发而非像素事实，背景默认态与 baseline-only 伪信号不再外发。
- 完成后审美改进不再硬化成失败：只有 `completed + final_response + 零 blocker + 同历史完整 VLM 批次 + 合法三层 diagnosis`，且 Runtime 声明 E2 时本轮已经取得新鲜结构化交付证据，Harness 才签发结构化 R5→R4 marker。v5 将其登记为 `needs_review → R4` 但保留用户任务 `completed`、不追加 blocker；外层只注入真实 diagnosis 且最多重入一次。普通 R5 失败仍保持 failed /needs_review 路径，marker 不授予 Tool 权限、不改变 DesignVerdict。
- Prompt /Context /检索做了减法：固定写前四步、阶段口令授权、自动外部参考检索与重复开场读取已移除或收窄；已知目标 /素材走最短证据路径，外部知识只在能改变决策时按需取用，缓存 /静态索引优先。Brief /Strategy /Evaluation Profile 编译为有界全局评价上下文并贯穿 Design Team 全阶段，补充上下文仍标记为不可信且不能授予权限或裁决。
- Design Team 预算不再绕过父 Agent：父运行在完整流水线真实启动前事前保留收尾额度，只向子级下发六字段 allowance；基础路线按角色真实最低成本加权（executor 为 4 model /3 tool），`needs_fix` 的完整修订 route + critic 复审一次性原子预留，额度不足时零修订并诚实返回 `qualityPassed:false / budgetExhausted:true`。取消、deadline 和阶段失败真实传播，未用额度不退款，也不按 `childAgentUsage` 事后倒扣。
- 三态与耦合债务收敛：能力 `unknown` 继续放行到真实执行，只有 `unsupported` 可阻断；三态折叠棘轮降至 29。品类词、SKU 子集和创意意图模式收回现有 `design-category-terms` Provider，业务耦合棘轮恢复到 22 /51，简化棘轮从 147 收回冻结基线 140，没有抬基线。
- 验证：`maintenance:validate` 完整通过 21 个核心检查，包含规划一致性、仓库卫生、1050 文件编码检查、163 Tool 注册、Handler、18 Skill、通用 Executor、Capability、Prompt、Gate、三态、品类词条、Design Intelligence、命题 /Store /Agent 测试、Main /Renderer 类型检查与 UXP production build；无临时 Smoke 依赖。
- 未验证：本轮没有启动真实 DesignEcho /Photoshop 生产会话，没有对用户 PSD 写入，也没有取得多任务样本的人工审美评分、首个有效写入延迟、重复观察率、返工收敛率或商业质量数据。代码闭环证明 Harness 不再按已知根因封印 Agent，不证明 Agent 已经稳定“设计得好”。

## 2026-08-10 SKU 问题发现与执行效率治理

- 从真实运行记录确认，旧路径不是“模型想太多”一个原因，而是首轮没有看见正确 SKU Workflow、纯文本追问没有形成结构化暂停、重复能力激活仍被当作进展、通用路径又重复读取文档 /截图 /模板目录。它最终只做了一次与目标无关的可见性修改，不能算 SKU 编排完成。
- 首轮现根据既有 Skill routing 声明生成唯一 Workflow recommendation；该信号仅用于导航和 schema 可见性，不绑定 Runtime、不授予权限，零候选或多候选时不猜。正确进入 `sku-batch` 后，已有组合确认卡继续负责“缺权威组合规格先暂停，确认后才生产”。
- 新增通用 `deterministic-consistency-verification` 与 SKU pack-count adapter。当前批次执行计划是 authoritative expectation；模板文件名只是元数据 observation；ordered slots 是结构 observation；可见文字层是 document-text observation。所有文档事实绑定 documentId + historyStateId，旧 revision 立即失效。
- `skuLayout.inspectTemplateLayout` 升级为 versioned inspection，在既有一次图层遍历中同时返回有界可见文字，不调用 OCR、不新增截图。SKU preflight 现在对计划 /文件名 /结构 /文字进行对账，并把报告 proofRef 投影到结果。
- 自动修复严格限于单点文字冲突：计划、文件名和 ordered-slot 结构均匹配，唯一可编辑文字层不匹配且观察未截断时，才允许 `setTextContent` 精确改数字。写入同时校验目标 document、history revision 和旧文字内容，完成后重新 inspect 与再验证；结构 +文字同时错误、多文字冲突、文档变化或证据不完整均不会自动改。
- 门禁保持局部和可恢复：观察不足不判失败；可修冲突只拦当前模板生产动作并开放 read /repair；证明确实无法安全修复时才跳过该规格，其余规格可继续并返回 partial。legacy region 模板的 region 数不再误当商品件数，文件名独自漂移只报 warning，不擅自重命名源文件。
- 效率侧移除了三类系统性浪费：`listDocuments` 轮询不再递归统计全部打开文档图层；模板 inventory 在单次 SKU run 中优先只扫描一次并本地派生规格；重复 capability 激活产生结构化 idempotent no-op，连续三轮无状态变化即停止。模板评分同时收为 main /renderer 共用的纯逻辑单一 owner，并固定用户规格模板、生成卡片兜底、备注模式、规格排除与 sourcePriority 语义，避免优化扫描时悄悄改变选中模板。正确 SKU Profile 视觉预算为 0，不再走通用 Agent 的多轮截图链。
- 保留了一个诚实边界：当前 annotated snapshot 没有完整图层 coverage provenance，不能冒充 fresh `getLayerHierarchy`。因此未通过降低证据要求来“优化”读取；真正缺强结构证据时只补一次定向 hierarchy，而不是启动整轮 Reflexion。
- 验证：3/3/3/4、3/3/4/4、4/3/4/4、无数量文字、revision 失效、legacy region、旧 inspection schema、截断文字、同层多个数量、隐藏文字与共享模板选择行为用例通过；`audit:agent-business-boundaries` 0 violation，`audit:tools` 163 项无漂移，补丁检查通过；全部复审修复完成后完整 `maintenance:validate` 再次通过 21 个现行核心检查和 UXP production build。
- 未验证：本轮没有启动真实 Provider /DesignEcho /Photoshop，也没有对用户 PSD 执行自动文字修复。首次有效动作延迟、模板扫描次数和真实 SKU 批次的 p50 /p95 仍需运行指标证明，不能仅凭静态检查声称性能目标已经达成。

## 2026-08-10 审美、选图与 Photoshop 合成纵切

- 根因已从“模型不会设计”拆成可治理责任：通用 `placeImage` 曾在缺素材时隐式检索白底产品图，自动模式又绕过分数 /差距；详情页 Ranker 只看粗分类并机械执行 top-1；`needsMatting` 没有执行消费者；置入结果用执行意图冒充真实 clipping /parent /smart-object 关系。因此用户看到的白底首屏通常不是可追溯的设计主张，而是工具默认和执行契约断线。
- 自动选图已改为显式且证据化：未声明 auto 时必须给唯一 source；显式 auto 必须有当前 design role、一次联系表真实视觉观察、直接使用适合度、source treatment、最低分和候选差距。metadata-only、用途未决、需去底重组、supporting-only、finished-design 与近分候选均不静默写入。模型 `force` 不能再用自填的用户 /项目来源和理由越权，当前仍按 `agent_judgment` 走相同视觉边界；只有未来非模型控制面签发的 Harness receipt 才能表达外部授权。
- 素材判断已任务化：详情首屏的白底 /纯色棚拍源进入 `matte_and_recompose`，透明主体进入容器，场景 /上身图在角色匹配时进入容器，细节 /材质图只作佐证，完成设计成品拒绝作为原始素材回流。白底、极简和剪切蒙版本身都没有被写成全局审美硬规则。
- 选图效率与来源边界已收敛：Resource Manager 先形成最多 12 个启发式短名单；定点 `placeImage` 默认同屏比较 5 张，详情页库存冷启动可在同一张编号联系表中比较最多 12 张，二者都只调用一次视觉模型；视觉结果权重 0.78，元数据权重 0.22。详情规划先消费与当前素材版本一致的新鲜缓存；冷缓存直接复用本轮预扫描库存，不再次递归扫描项目，单屏重建通过 Harness 签收的库存对象身份复用同一观察，模型 JSON 副本不能伪造候选路径，空库存也不按屏重复扫描。联系表新增并贯通 `assetNature`，参考图和已设计成品不会因 `designed_composite` 外观被自动剪切进非首屏。
- Photoshop 合成事实已接通既有详情填充路径：图片计划携带 source treatment、容器与预期关系；UXP 在写后读取真实 clipping、精确 base、parent group、smart object 与 Photoshop `userMaskEnabled`。FillPlan 内联 matting receipt 只保留兼容形状、不能证明去底已完成；需抠图、显式 deferred、缺失或找不到 clip base 的图片会形成可恢复的局部延期，不送入 filler，也不计为完成。已知关系不一致只让对应图片 /placement 失败，读不到则 `needs_review`；没有把未知折叠成失败，也没有封锁读取和修复出口。修复了 legacy 占位层作为剪切基底后又被删除的真实缺陷。
- 审美 Harness 已补充 `aesthetic-judgment` 与详情页 `imagery` 知识，并在完整详情页 Profile 增加 `craft.asset-integration` 软视觉断言，检查角色、裁切、矩形背景断裂、边缘、光影、透视、色彩和空间融合；最多三条可靠 diagnosis、最多一次有界改进，审美 finding 不授予 /撤销权限。
- 权限边界没有被绕过：安全审查拒绝给 create-new handoff 与 visual-repair allowlist 持久增加 `releaseClippingMask` / `moveLayerToGroup` 等结构写权限，因此本轮只修复既有 `fillDetailPage` 已授权事务。要让通用 create-new /视觉修复自主建立或重建 clip /group，仍需用户对这项权限扩张明确授权。
- 仍未完成：白底素材的异步 remove-background → apply-matting continuation 尚未接入详情 FillPlan 的自动续跑，因此当前能诚实阻止原白底矩形直贴，但在只有白底素材时还不能保证自主完成重组；通用 layer effects /mask /blend appearance plan 与完整读回也未建立。
- 验证：`maintenance:validate` 21 项全部通过，包含规划 /仓库卫生 /编码、163 Tool、18 Skill、Handler、通用 Executor、Capability /Prompt /Gate /三态 /品类词 /业务边界、Agent 测试、Main /Renderer 类型检查与 UXP production build；`git diff --check` 无错误。当前没有可调用的 DesignEcho Photoshop MCP 实机通道，所以没有把自动化结果冒充真实 PSD 设计质量、人工审美质量或耗时改善。

## 2026-08-11 行内多模态消息与编辑重发根修

- 根因：原实现把模型使用的 `【引用…】` 定位串直接写进 `Message.content`，编辑入口又只恢复纯文本，导致用户编辑重发时内部 marker 可见、附件结构和文本顺序丢失；同时默认 autonomous Agent 不经过 ChatPanel 的后置模型包装，实际仍把图片集中放在文本末尾。
- 已实现：新增有序 `ChatComposerContentPart` 作为消息规范载体，文本、上传图片、Eagle、项目素材和知识引用按编辑器位置保存。新富消息编辑时恢复同一 parts；旧消息只在有证据时精确恢复，否则移除 marker、保留可恢复文本 /图片并显示降级提示。会话标题和消息渲染都只消费安全自然语言 /引用标签，不显示 locator。
- Agent 接线：冻结 submission 同时生成持久 Message、Operating Context 和 Agent 初始输入；当前用户消息由 Harness provenance 定位。`currentUserContentParts → initialUserContentParts → Agent.buildUserMessage` 已贯通默认 v3，图片仍先过视觉候选预算，未获准图片只留下诚实的未附带说明，不通过 UI 顺序功能绕过预算。
- 输入效率与边界：粘贴只接受 `text/plain`，混合文本 /图片不再静默丢文本；多图 FileReader 先占位后回填，顺序不受完成时序和光标移动影响。5 张、单张 8 MB、总计 20 MB 同时在添加入口和发送边界校验；parser 不再对整段 Base64 `JSON.stringify` 哈希。
- 验证：`build:typecheck:renderer`、`build:renderer`、`audit:agent-business-boundaries`（新增多模态跨层检查，0 violation）、`audit:tools`、目标文件 `git diff --check` 与真实窗口审计脚本语法检查均通过。生产构建只有既有动态 /静态 import 与大 chunk 警告。
- 未伪装完成：消息提交后仍通过 2 秒防抖落盘，当前不是耐崩溃的磁盘 ACK 事务；跨轮历史图片尚未预算化重附给模型；旧消息若历史上从未保存附件二进制，系统无法凭 marker 恢复原图。最新编辑重发交互尚未在真实 Electron 窗口重新操作一遍，本轮结论来自类型、构建、行为 /静态审计与此前 Composer 视觉 QA。

## 2026-08-12 SKU Skill 自主模板与占位修复闭环

- 真实失败所有者已确认：裸“帮我做SKU”正确直达唯一 `sku-batch` Skill，但旧参数默认器为所有真实 SKU 出图注入组合确认，执行器又在无规格时静默退化为 2 双 5 组，因此在模板检查、占位创建和任何 Photoshop 写入前返回确认卡。停止与预算、Photoshop Host、Completion 或 Skill 路由无关。
- 普通 full 请求先使用 2 /3 /4 双非权威可逆草稿完成色卡、模板、占位符检查或补齐；候选组合准备好后默认展示结构化组合卡，确认后才批量生产。用户明确跳过确认或项目已有受信权威组合时可直接继续。模板库存只证明现有能力，不再反向拥有任务规格，未知规格 PSD 不得冒充 N 双模板。
- 缺失模板、缺失自选备注模板和可修复的既有模板占位 /布局问题，统一在同一个 SKU Skill 中产生声明式 repair handoff。Agent 可连续使用已有原子 Tool 读取参考、创建或切换文档、设计结构、创建 /调整占位、检查快照、另存新候选、精确读回，然后重入同一 Skill 继续批量生产；没有增加第二 SKU Skill 或 Agent /Harness 品类分支。
- 模板安全边界已收紧：不可靠或失败的 `inspectTemplateLayout` 不产生修复授权；聚合预检保持只读，结构全部可执行后才进行定点文字修复；旧源模板不得由模型布尔参数授权覆盖，repair 结果必须显式新路径并以 `fail_if_exists` 另存。
- 新版 `-DesignEcho候选` 只作为待验文件发现信号，不参与普通模板评分。SKU Skill 必须按精确路径打开并核对当前 documentId /historyStateId、v3 inspection、占位数量、layoutPlan 与可见规格文字；验证通过才优先于旧模板，验证失败不能再从普通 opened /project /local fallback 偷渡，从根因上消除“修完又选回旧坏模板”的循环。
- 通用 compact E1 continuation 增加 repair epoch 证据义务：同一轮可连续原子读、写、保存和切换文档，但 owner 在本轮无新 mutation 或任一目标 latest revision 未精确读回时隐藏且执行点拒绝。新的 handoff 保留同一 Runtime 绑定下的跨文档证据并把 epoch mutation 计数归零，不能清空旧证据、复用旧证据空转完成或用单文档读回冒充多文档完成。owner 最终 `completed` 并产生新 mutation 时进入通用 `ownerAccepted` 相位，只保留 latest exact readback；读回后同次闭合 E1，不再重跑 owner 或重复生产。
- 行为回归覆盖 success /nonFatal 两类 handoff、两轮 repair、owner 隐藏与恢复、双文档 stale /exact revision、最终 owner 的可信嵌套 mutation、`ownerAccepted` 后直接进入 R5、候选验证成功 /失败、未知规格模板拒绝以及源覆盖保护。组合交互决策已有纯函数回归：非权威候选默认弹卡，明确要求确认仍弹卡，明确跳过 /已确认 continuation /受信权威组合不重复弹卡。`maintenance:validate` 22 项、Runtime declaration、Agent business boundaries（0 violations）、Main /Renderer 类型检查、Agent /UXP production build 和补丁格式检查全部通过；最终 Renderer 于 17:57 重新生成。
- 诚实边界：当前非 watch Electron 实例在最终构建前已启动，尚未加载新 Renderer；本轮没有重启应用、没有写用户项目 `E:\WERKE\C-1245`，也没有取得真实 Provider → Photoshop 的 2 / 3 / 4 模板、占位、导出和人工视觉质量证据。代码闭环不等于商业设计质量完成。

## 2026-08-11 真实项目 SKU 2 / 3 / 4 双装基线与确定性修复

- 验证输入固定为用户已在当前桌面程序添加的 `C:\Users\12611\Desktop\测试\测试`；目标批次为 2 / 3 / 4 双装。项目商品目录已观察到三类真实产品外观，当前没有可据为权威组合规则的项目内表格文件，因此 4 双装只能作为 `agent_delegated_draft` 可逆草案，发布前仍需复核，不能伪造为表格权威事实。
- 验证集 `D:\A1 neveralone旗舰店` 只读：确认存在偏 INS /生活方式感和偏干净纯色卡两类成品，可用于人工 rubric 对照；未从该目录复制图片、PSD、配置、命名或组合逻辑，也未对该目录写入。
- 真实失败基线：同一当前程序运行约 20 分 33 秒，24 iterations、25 model calls、1 Reflexion，停机原因为 `tool_preflight_blocked`；重复读取后仍无 Photoshop write、无导出文件、无最终设计。该结果证明旧链路既慢又昂贵，且不能用“Tool 调用成功”冒充业务完成。
- 根因修复：UXP `arrangeDynamicSkuLayout` 不再把每张商品卡都缩放到整块共同区域后只做左 /中 /右移动；现在先把声明区域确定性拆成互不重叠子槽，使用共享 contain scale，再通过既有 auto-layout QA 校验实际复制后的完整卡片 bounds、间距、重叠和安全区。
- 结构真实性：复制后的 SKU 卡必须是新的可编辑顶层对象，直接子节点数和递归节点总数必须与源卡一致；缺 SKU 层、缺颜色组、复制复用旧层、结构缺失、bounds 无法读取或卡片数量不足均成为当前规格的失败，不再 `continue` 后伪装成功。
- 交付真实性：`executeComboLayout` /batch 只有所有请求规格均完整导出且写后 readback ready 才返回 completed /success；部分规格、缺文件路径、结构化导出回执畸形、读回阻断或布局 QA warning 均返回 partial /failed /blocked_export_readback。
- 正式验证：2 / 3 / 4 有界布局、实际 bounds QA、缺卡阻断、完整 /部分 /读回失败交付状态均进入既有 `audit-agent-business-boundaries`；UXP production build、Renderer typecheck 与完整 `maintenance:validate` 21 项核心检查全部通过。
- 运行边界：未启动新应用、未关闭或重启用户当前程序。核对时 Electron PID 59956 /56416 均响应正常，8765 /8766 /8767 均由 PID 59956 监听。当前实例是非 watch 运行且尚未自然加载新构建，所以没有再次用旧代码购买一轮高成本失败。
- 待完成：同一当前程序自然重载最新构建后，重新执行真实 2 / 3 / 4 双装，记录首次有效写入延迟、模型 /Tool /图像呈现次数、组合 provenance、document /history、输出文件与同版本读回，再对照只读验证集做人工视觉评审。取得这些证据前，不声明真实 Photoshop E2E、设计质量或商业质量已通过。
- 真实项目后续核对发现 20 张模特图 + 21 张平铺图，而旧 12 张 `visionCandidates` 会被模特图优先级占满；既有视觉缓存实际为 11 张模特 + 1 张平铺，且包含“小羊袜→蘑菇袜”的错误观察。根因在项目视觉候选池的同角色截断，不在模型提示词。
- 已修复：`project-asset-index` 在同一 12 张上限内按角色轮转；`project-visual-sampling` 在同一场景预算内按角色槽位选取。真实项目生产探针为候选池 6 模特 + 6 平铺、SKU 4 张为 3 平铺 + 1 模特、general 4 张为 2 + 2；没有增加图像呈现或模型调用次数。
- 正式审计新增 20 模特 + 21 平铺的真实分布用例，防止候选池重新塌缩为单一角色，并要求 SKU 优先覆盖商品款式且保留场景参考；`build:typecheck:renderer`、`audit:agent-business-boundaries`、完整 `maintenance:validate` 21 项与 Renderer production build 全部通过。
- 只读验证集盘点为 23,341 张图、1,025 个 PSD /PSB；跨货号主图联系表确认成熟成品同时包含生活方式 /INS 近景与干净纯底路线。验证标准固定为商品主体真实性、组合数量、裁切、比例、间距、标签、留白和商业完成度，不把验证集图片、模板或组合配置回流到当前项目。
- 当前唯一 Electron 主进程的 8768 MCP Host 已真实初始化；`system.status`、`photoshop.connection_status`、`photoshop.tools.list`、活动上下文和项目根目录只读通过。Photoshop UXP 在线但无打开文档；当前 MCP 无自主 Agent /Renderer reload 工具，所以保持“同一应用重载后再跑”，不以直接原子 Photoshop 调用绕过自主设计测试。

## 2026-08-14 主图商业质量链根修

- 截图审计确认用户看到的是中断后遗留的线框半成品：主体占比偏小、没有单一点击理由、默认文字层级、随机 UI 色块与可见空占位。淘宝样例的共同成熟度来自“主体优先 + 一个核心卖点 + 可验证证据 + 缩略图层级”，不是多加装饰。
- 运行记录确认后续两次“继续”都只进入 generic autonomous task，未绑定主图 Manifest、项目素材视觉理解、参考方法论或 R5；第一轮只增加两层默认黑字，第二轮零写入。普通运行跨重启的 durable active-task 恢复仍是独立 Harness 待办，本轮不以历史文本猜测或放宽写权限掩盖。
- 父 `ecommerce-socks-design` 已删除 legacy 主图 `product-disposable-live` 与 `approvedLiveExecution/approvedLiveAdapterRun/userCheckpointApproved=true` 默认铸权。主图、详情页、SKU 三个 controlled child 现在统一通过 `autonomous-agent + runtimeSelectedSkillHandoff + declaredSkillId/taskType/workMode` 进入各自 Manifest；父级不复制子业务知识。
- 父级完成语义已收紧：只有所有子报告显式 `canClaimOutputQuality=true` 才返回成功；`partial/needs_review` 或仅有 completed 状态但无子质量 owner 时返回失败/待复核，不能把半成品升级成整套完成。
- `renderLayout` 的主视觉无真实素材时仍允许写可逆灰色草稿，但同时记录 `placeholder=true/sourceKind=placeholder/main_image_placeholder_unresolved`，质量状态进入 needs_repair；后续必须以带真实素材的新布局和同版本读回替代，当前空块不能交付。
- 主图 Profile 新增 `req.brief-coverage` 与 `craft.asset-integration`；legacy-only `main_image_qa_report` 降为兼容提示，fresh structure、fresh visual 和 Profile assertions 继续拥有 canonical 完成权。主图 Artifact Runtime 改为注入完整点击、转化、卖点与 review 分面，不再只有 overview。
- 正式 `audit:agent-business-boundaries` 新增父子 Manifest 入口、禁止默认铸权、未验子质量不得父级成功、主图 Profile/知识与占位 finding 接线的行为/静态断言；当前 0 violations。Renderer/Main 类型检查和 diff check 已通过，完整核心预检与真实 Photoshop 商业质量复测待完成。
