# Risks

## 使用规则

这里只保留有证据的当前风险；历史已缓解风险和详细事故记录由 Git 保留。风险必须区分“当前成立”和“观察项”，不能因为讨论次数多就升级为结论。

## 当前高风险

### R-055 非 Codex 主模型也在启动期拉起 Codex model-bridge Runtime

- 事实：普通 PID 36604 的正式模型是 DeepSeek，但应用启动 21 秒后出现受限 `codex.exe app-server`。Main /Renderer 都会无条件恢复 ChatGPT 订阅目录，而状态读取内部执行 `ensureStarted()`；因此未调用 Codex 模型也会创建进程。第二个 image-generation Runtime 是数分钟后的显式能力路径，不属于本次冷启动 owner。
- 影响：非 Codex 用户承担额外进程、初始化和潜在故障面；同时“正式模型是 DeepSeek”与进程列表中的 Codex 容易造成模型边界误判。仅隐藏进程或删除订阅 Provider 会破坏真实功能，都不是根因修复。
- 处理：D-108 用共享模型 ID 契约把 Main /Renderer 启动恢复绑定到当前 Codex 主模型；设置、登录、目录、订阅对话 /生图继续显式按需启动。同构无凭据 canary 已证明 DeepSeek 为 0 个 Codex 子进程、显式 Codex 为 1 个 model-bridge 子进程；专项、唯一完整核心 63/63、独立提交 `16db25ec` 与 exact clean packaged identity 已通过。
- 关闭条件：D-108 完整核心、独立提交与 exact clean packaged identity 通过；普通用户下次自然重启加载新构建后，DeepSeek 状态在稳定窗口内无 model-bridge Codex 子进程；显式打开订阅设置或选择订阅主模型仍能启动并取得真实账户状态。启动耗时 /内存改善若要声明，必须另做重复测量，不能由进程数推断。

### R-054 Electron /OpenAI SDK 基线已迁移，Provider /图像 /构建链动态安全债务尚未收口

- 事实：D-106 已把 Electron 28.3.3 /Node 18 单变量迁移到 [Electron 44.0.0](https://releases.electronjs.org/release/v44.0.0) /Node 24.18.1，并通过 clean install、ClipboardItem /sRGB Runtime 契约、preload、production build、旧 builder x64 打包及 source /app.asar 隔离启动。Electron npm 二进制显式安装和 3 个 Main runtime import 漏声明均已按根因修复；新增 import→manifest 审计防止 dev 子树偶然满足生产依赖。
- 事实：D-107 已升级 OpenAI SDK 7.8.0、ws 8.21.3 与 undici 7.29.0，保留 Zod 4.4.3 并删除旧 override；OpenAI 7 的 Fetch dispatcher 迁移通过本地真实代理、DeepSeek 扩展 /Tool /stream cache /timeout /abort、现有模型边界、production build、最小真实 exact-model DeepSeek Tool canary 与 dirty app.asar 启动。OpenAI SDK 不再依赖未声明的 Zod 兼容 seam。
- 事实：D-109 已把根 Axios 升到 1.20.0，并以两个官方 SDK 子树的显式安全覆盖取得 OpenAPI JSON/multipart、TOS putObject、protobuf /UUID 本地协议证据；Volcengine/TOS/Axios/protobuf/UUID/form-data/lodash/proxy finding 已为 0。唯一完整核心 64/64、独立提交 `45e15560`、clean identities 和 exact clean app.asar 均完成。
- 事实：D-110 已把 Sharp 0.34.5 升到 0.35.4 /libvips 8.18.6，按原语义迁移 13 处已删除参数和 7 个服务的 ESM named types；fast-uri 3.1.6、picomatch 2.3.2 与 once 2.0.1 同时在合法 semver 内更新。真实原生 codec /operation 与相邻图像链专项通过，生产 audit 6→2，当前只剩 ONNX/adm-zip；全量构建链仍为 23 项，UXP 仍为 7 项。
- 影响：核心闸门绿色只能证明当前冻结 lock 的工程一致性，不能证明没有已知安全风险。整体执行 `npm audit fix --force` 会同时跨 Electron Runtime、Provider、图像处理与构建系统抬 major，破坏真实应用兼容和回滚边界；继续长期不处理则让用户输入图像、本地 WebSocket、Provider 凭据、打包与 Electron 漏洞暴露面累积。
- 处理：① Electron Runtime `6a37acb9`、OpenAI /Zod `f3742497`、Volcengine /TOS `45e15560` 已分别用独立提交和 clean app.asar 收口；② D-110 Sharp 片保持参数语义，真实 libvips 专项、Agent /UXP production build、dirty packaged Sharp 探针 /启动与唯一完整核心 65/65 已通过，待提交与 clean identity；③ 默认端口若继续空闲，D-110 后优先回到 r32；否则下一片治理 ONNX/adm-zip，之后才独立处理 Agent /UXP 构建链。每片只改自己的 package /lock 与必要适配，不以 audit 数量归零代替运行证据。
- 关闭条件：当前直接生产依赖的 high /critical finding 均已被安全版本消除、证明不可达并形成可审计 containment，或由上游无修复事实明确接受；Electron 运行于仍受支持的 Node /Chromium 线；OpenAI /Zod 不再依赖未声明兼容 override；两仓 clean install、构建、桌面启动、DeepSeek 正式模型链和 Photoshop E2E 均无回退。动态公告会变化，关闭必须绑定当时 lock 与 audit 时间戳。

### R-053 共享 Photoshop 的 UXP plugin session 可被其它开发会话替换

- 事实：r32 提交时 UXP 为 clean D-094 build `designecho-uxp-production-eb40a93c9b17-35053c988e2a`，但运行到 05:04:18 后变成旧工作树 `designecho-uxp-production-de628ade831d-77193162309f-dirty`。同一时段还有其它 Codex 任务在共享 `C:\UXP\2.0` 启动 DesignEcho 调试窗口；当前机器只有一个 Photoshop /UXP Host，插件 ID 也唯一。现有 runtime binding 在完成态正确拒绝漂移，但不能阻止外部 UDT load 替换当前 session。
- 影响：正式 Attempt 即使 Agent 与 Photoshop 动作正确，也会因运行时代际变化成为 unknown write state；继续在共享加载会话上盲重跑会反复消耗模型与 fixture，且可能把另一个开发任务的文档活动混进基线。
- 处理：D-096 已把正式 `run-live` 与官方 `load-photoshop-uxp-plugin.cjs` 接到仓库外同一合作式 Runtime lease；采集在任何 Attempt Event 前取得租约并复验 binding，loader 在连接 UDT 与任何 load /unload 前取得，冲突时结构化拒绝。存活 owner 不因 TTL 被误删，死亡 owner 可回收，释放必须匹配 leaseId。现有提交 /首次写 /完成 binding 继续 fail closed，因为用户在 UDT UI 手动 reload 或第三方直连仍无法由脚本租约阻止。
- 关闭条件：完整核心闸门和独立提交通过；r33 全窗口内另一 worktree 的官方 loader 确实被拒绝；模拟持有进程崩溃后下一次 loader 能回收；手动 UDT reload 仍被完整 binding 识别并诚实终止。当前专项与双进程 canary 只证明合作式脚本路径，风险仍为部分缓解。

### R-052 终局视觉证据类型偷换导致 Judge 看错图、交付无法闭合

- 事实：r24 的真实 Photoshop 成品包含完整主体、标题和四色陈列，但 Final Judge 的文字诊断描述成了平铺素材；Trace 中不存在 Harness 全画布采集，同时 `finalArtifactObserved=true`、生产交付检查通过和安全 `finalArtifactRefs` 为空并存。代码核对确认单画布 selector 仍使用 `single || bundle`，与同文件“单画布选 full-canvas”的注释和 E2 full-surface 要求矛盾。
- 影响：模型可能准确评价了错误图片，视觉分数、诊断、Reflexion 和跨代恢复 Artifact 全部失真；磁盘文件虽真实存在，技术 Attempt 仍无法形成可信交付。若只改 Prompt 或补文件扫描，会隐藏对象身份错误并扩大多套真相。
- 处理：按 D-090 把 ReviewSet source 设为终局身份，单画布与多画面互不降级；Judge、E2 和可信 Artifact 共用唯一选择 Owner。攻击型回归、边界审计、Renderer 类型检查、完整核心闸门 58/58 与 Agent production build 已通过。关闭本风险仍需提交后 r25 真实证明自动 full-canvas Tool entry、Judge 精确出站收据、同 revision PSD/JPG 与非空安全 `finalArtifactRefs`；未完成前不得把 r24 的错误 69 分当真实视觉评价。

### R-051 R3 把 Agent 自有工艺误报为用户输入，导致确定性任务盲搜和零写入

- 事实：真实白底图 Run Record `run-20260803115420027-31eea942.json` 中，用户已经要求从项目选择一张图片、置入、抠图并输出 800×800 白底图；Agent 在 11 轮内反复读取文档、项目资源、Project State、缩略图和图层，0 次 mutation，最终把“透明商品素材”误报为唯一 blocker 并进入 `waiting_user`。根因不是缺少白底图 Skill，而是 R3 runtime 把 blocking missing input 再次开放成 observation / knowledge recovery、普通写入请求首轮未稳定获得通用设计工艺能力，以及基于回复文案猜 Tool 的第二 recovery owner。
- 影响：目标明确、Agent 实际具备能力的任务仍可能被系统解释为“需要更多研究”，预算消耗在项目检查与参考检索上；真实 Provider 没有提交 Tool call 的问题被 recovery 文案掩盖，用户只能看到低效等待而看不到真实故障。
- 处理：R3 blocking 只接受用户独占输入，不再授予环境检索恢复；结构化 `write_photoshop + confirmed_tool_required` 请求取得通用设计执行能力基线，并补齐 `removeBackground`；已退役从 assistant prose 猜 Tool 的恢复 Owner。`audit:capability-resolver` 与 `audit:simplification-ratchet` 防止回退。关闭本风险需要重启后用多种自然问法在 disposable 项目完成真实 Provider → Photoshop 制作 →同目标读回，证明不会重开无关检索、不会误报透明素材缺口，并记录首次有效写入前轮次。

### R-049 Task Profile 身份不能扩大用户授权；精确修改已 containment，通用接续仍待 V0

- 事实：实验性把 `declareDesignIntent` 作为结构化 Runtime 重入触发时，模型把“只改一个图层名称”扩张成整张海报创作。危险接线已撤回，临时文档已真实恢复。当前对没有第二写入要求的精确属性替换，已复用 `runtimeAllowedWriteTools` 在候选面和最终执行点双重限制；图层名 /画面文字分别只能使用对应原子 Tool，复合请求不会被局部解析器误收窄。最新代码审计进一步确认：普通自然语言执行器只有在启动前已有 `runtimeContractBundle` 时才创建 `RuntimeSession / TaskRun`；循环中的 `declareDesignIntent` 当前只绑定 Task Profile、知识与设计纪律，不会原地附加 Runtime plan。taskRunId 又来自 Runtime identity 的 sessionId，而主进程 Artifact 授权当前只能在 skillId/taskType 已知后签发 identity；Capability Session 也没有运行中绑定 Manifest 的 API。因而“声明后接续同一 TaskRun”不能靠递归重启 Agent、Renderer 临时造 Session，或默认套用 `design.generic.v1` 假装完成。
- 影响：精确 V0 canary 已不再能被 Task Profile、Manifest 或 Skill bridge 扩成其它写入，但普通开放设计的“自然语言声明后如何进入同一 TaskRun / R4”仍没有生产接续。若直接恢复递归重入或另建任务，会丢失原请求目标、revision、预算和授权范围；若继续留在 v3，则不能证明 execution envelope 主链。
- 处理：Task Profile 只绑定语义；请求级写范围继续作为 deny-wins 上限。下一步扩展既有主进程 identity /Artifact 授权 owner，使 plan-neutral TaskRun identity 在普通自主运行开始时即存在；再为同一 Capability Session 增加受控 Manifest 重绑定，并由 Agent 在模型结构化声明通过后原地绑定 stage plan /RuntimeSession，不创建新任务。必须保留原始用户目标、允许交付物、mutation 上限、document /revision、既有 Tool log 与预算。不得递归启动新的自主任务，也不得用 generic Manifest 的默认交付物或固定八阶段扩大 /拖慢简单请求。关闭本风险需要 V0 真实证明绑定前后 `taskRunId` 不变、写范围不扩大、E2 授权仍有效，并覆盖复合请求不误收窄。

### R-050 Photoshop 原生 Action `get` 弹窗已修复，但新描述符必须持续受静态门禁

- 事实：`historyState.count` 是无效 Action descriptor，会触发 Photoshop 原生模态错误并阻塞 UXP 请求。当前已改用 DOM history state，既有原生 `get` 已补齐 `dontDisplay`，真实读回无弹窗，Tool audit 风险计数为 0。
- 影响：当前根因已关闭；但未来新增没有 `dontDisplay` 的原生 `get`，或重新引入 `historyState.count`，仍可能让 Agent 看起来像网络超时、重复重试并耗尽预算。
- 处理：`audit:tools` 持续禁止无效 history count 与缺 `dontDisplay` 的 native `get`；Host 超时且窗口存在时保持 `photoshop_native_modal_suspected` 诊断，不自动重放 mutation。本风险为已 containment 的回归风险，不再阻塞当前 V0。

### R-048 模型设置真实测试已接线，但当前 Ollama Cloud 模型的订阅访问权仍不可用

- 事实：截图对应的 Provider 原始证据是 Ollama Cloud `HTTP 403: this model requires a subscription, upgrade for access`，不是 Key 认证失败。代码已分离 `auth / model_access`，设置页也已接入当前模型的最小真实 chat 测试；未选中具体 Ollama Cloud 模型时不声称 Key 已验证。当前应用进程必须重启才会加载新 preload / IPC；当前账号的订阅状态也不由本地代码改变。
- 影响：重启前旧 UI 仍可能显示错误文案；重启后继续选择 `deepseek-v4-flash-0731` 会得到准确的订阅 /访问权失败，但不会让该模型自动可用。如果把“文案修正”误当成“Provider 已恢复”，Agent 仍会在首次模型调用前停止。
- 处理：重启 DesignEcho 后在设置页运行 Ollama Cloud 真实测试。若结果仍是 `model_access`，只有升级对应订阅或切换到当前账号真正可调用的模型才能恢复；不重生 Key、不盲目重试。关闭本风险需要重启后 Key 测试、具体模型测试与一次普通 Agent 回复均成功。

### R-047 V0 执行信封已通过核心验证但真实 Photoshop 纵切仍未证明

- 事实：`photoshop.mutation.v0` 五动作包、叶子 Capability、执行信封、TaskRun 派发记录和 OperationResult 精确节点绑定已完成代码接线，完整 `maintenance:validate` 通过。当前证据仍是静态审计、类型 /构建与既有单 Tool canary，没有真实 Provider 在受约束 TaskRun 中生成包内调用并完成同目标读回，也没有双 TaskRun、waiting /resume 和应用重启验证。
- 影响：代码可以阻止 broad Capability、错误参数、stale revision、越序节点和结果错绑，但不能证明模型会及时选择正确叶子能力、Bridge /UXP 实际链路能稳定闭环，或恢复时不会形成零写入和预算耗尽。若现在直接扩 V1 或业务 Skill，会把执行问题误诊成设计知识不足。
- 处理：先使用 disposable PSD 完成真实 Provider → TaskRun → execution envelope → E1 → UXP → `PhotoshopTransactionRunner` → 同目标 verification；同时覆盖第二写者、外部 revision 变化、缺失 /不匹配 OperationResult 和 waiting /resume。记录首次有效写入前轮次与 Tool 数；未通过前不扩 V1 pack、不宣称可执行 Harness 已完成。

### R-046 短指令丢失同会话交付语义导致盲搜与零写入

- 事实：真实 Run Record [60] 的当前输入为“帮我做SKU”，同一会话此前已明确 2/3/4 双装与自选备注模板及占位符修改，但自主执行器没有消费现有有界会话上下文；运行重新搜索资源、文档和参考，9 轮后 0 次成功 mutation。代码已接入有界历史、任务落地纪律、ready Design Brief 的生产义务与非阻断观察失败会计，尚未完成修复后的真实复跑。
- 影响：若仅依赖当前短句，模型会把成熟设计师应当承接的已知交付物重新当成未知问题，用项目搜索和可选观察试探流程；预算消耗在读取上，最终既无作品又可能给出误导性的复核文案。
- 处理：按 D-076 保持当前指令和实时事实最高优先级，只用有界历史解决指代与未完成交付续接；生产 Brief ready 后 0 写入必须失败。下一次真实 SKU 回归必须观察是否正确声明 `ecommerce.sku_template.v1`、是否在必要观察后进入首次有效写入、是否避免无关参考测量，并由真实 PSD/TIF 读回和人工设计复核决定是否关闭本风险。

### R-045 能力自我模型已接线但成熟设计师效率尚未实证

- 事实：Task Profile 过去主要作为一次性声明结果和结构化 Stage 知识存在，Capability Prompt 过去只列 on-demand 目录且装载后可能保留旧文本；这会让模型从 Tool schema 反推能力并用调用试探流程。本轮已改为每轮动态 Task Profile + Capability self-model，并补齐 legacy capability alias 对真实 Photoshop Tool 语义的复用。
- 影响：代码能让 Agent 看见“会什么、不能什么、怎么验收”，但不能证明模型已经会在真实“一套图”需求中一次形成高质量方案，也不能证明工具选择、耗时和返工率已达到成熟设计师水平。
- 处理：保持 D-075 的 Owner 边界；在 V0/V1/M6 分别记录任务语义声明正确率、无效 Tool 尝试、首次有效写入前模型 /Tool 次数、局部重规划次数和最终人工设计评价。只有多样本证据显示方法或能力说明仍缺失，才修改 Task Profile、Tool 语义或 Knowledge；不向通用 Agent 加品类状态机。

### R-044 把产品身份继续代码化会制造新的重复控制层

- 事实：标准设计 Agent 的产品身份已经能由 `Prompt.md` 与 Design Agent OS 清楚表达；近期规划又把它展开为角色 Contract、scope 枚举、六任务族、Task Contract 与 Outcome Contract。它们会与 Task Profile、Capability、TaskRun、Verification、DesignVerdict、Release 和 Delivery 重复表达同一责任。
- 影响：继续实现会新增分类、映射和状态同步点，使自然设计语言更容易被错误门禁；反过来完全不定义产品边界又会让通用代办污染设计能力与预期。
- 处理：按 D-073 把产品身份保留为行为和治理边界，不做 Runtime 对象。Model 依据完整上下文理解设计请求；现有生产 Owner 承担结构化责任，关键词 Router、角色级 Tool 白名单、六任务族枚举与额外 Task / Outcome Contract 均不实施。

### R-043 全量 mutation 迁移形成水平阶段墙

- 事实：`PhotoshopTransactionRunner` 当前迁移 5 个 owner；UXP `src/` 仍有 52 个包含 `executeAsModal` 的文件，混合 mutation、读取、面板和内部动作。旧计划要求 M3-A 全量退出后才启动 TaskRun 和 M4，而真实同文档并发写已证明 TaskRun writer ownership 本身是继续安全迁移的前置能力。
- 影响：若坚持全量水平迁移，范围会不断扩张，TaskRun、R4、无 Skill 设计和 Release 长期得不到真实纵切；若为赶进度整体开闸，又会让未迁移 Tool 绕过事务 owner。
- 处理：按 D-072 采用 F/X 两车道与 capability-pack scoped R4。只读 Foundation 可并行；每个写节点仍严格要求 TaskRun、Capability、preflight、target / revision 和 TransactionRunner，并在同一切片退役旧 owner。

### R-042 同一 Photoshop 文档存在并发写者

- 事实：上述真实并发事故仍成立。本轮现有 RuntimeSession 已原地增加 TaskRun document /revision binding 与进程内单文档 writer claim，Agent 普通写入和结构化确认续跑会拒绝其它 TaskRun 或 stale revision；尚未完成两个真实运行任务的实机竞争、应用重启后的等待恢复和未迁移 legacy Tool 覆盖验证。
- 影响：已迁移 /接线写入具备明确拒绝路径，但不能据此宣称全项目已消除并发写者；legacy active-target Tool 和进程重启边界仍可能依赖 revision guard 事后拒绝。
- 处理：冻结 V0 capability pack 后做同文档双 TaskRun、等待期间外部修改、应用重启后确认卡恢复三类实机验证；未迁移 Tool 不进入 X2 R4，任何 unknown 或 mismatch 均重新观察且禁止自动重放。

### R-041 相邻 DOM setter 可能仍有 active-target 漂移

- 事实：旧 `lockLayer` 虽先按 `layerId` 找到对象，但 Photoshop DOM 锁属性 setter 实机仍作用于活动图层；已改为显式 `_id` 的 `applyLocking` 并验证。`setLayerOpacity`、`setBlendMode`、`setLayerFill` 等相邻旧写动作尚未完成同形审计。
- 影响：Agent 传递正确 layerId 仍可能改到当前选择对象，造成“Tool success 但改错图层”，后续截图或门禁无法可靠补救。
- 处理：按 M3-A 垂直切片迁移到 Runner，以显式 document/layer ID 写入、同目标读回和 rollback 验证替代 DOM active-target setter；禁止 selection fallback 和隐式重试。

### R-040 审美 hard block 已最小 containment，完整 Release 收口仍待 M5

- 事实：当前生产 Scorecard、Completion、DesignVerdict、Critic 与 Reflexion 已统一要求 `fail + blocker + deterministic + 合法 blockerKind + 安全 proofRef`；`overall.above-baseline` 与 VLM brief coverage 已降为 major finding。M5 唯一 Release Gate 和所有 legacy /外部 producer 的全量归一尚未完成。
- 影响：当前主链不再因裸审美 severity 直接 hard failed，但未来新增消费者或旧外部 payload 仍可能绕开资格函数，重新触发无动作返工和预算耗尽。
- 处理：现有 capability audit 维持 containment；M5 建立唯一 Release Gate，并把所有质量 hard-block consumer 归零到同一结构化资格入口。不得把本轮 containment 宣称为 M5 完成。

### R-039 未验证经验污染正式 Knowledge / Skill

- 事实：设计学习、Project State、Memory 与 Skill 维护已有局部基础，但真实质量收益、版本晋升和回滚尚未形成统一门禁。
- 影响：失败轨迹、模型自评或偶然成功可能被固化，后续跨会话重复放大错误设计习惯。
- 处理：M7 前只允许记录真实运行事实；经验必须由终态 TaskRun 生成隔离候选，经来源核对、离线对比、人工批准、Canary 和回滚准备后才可晋升。

### R-038 无进展恢复和探索耗尽执行预算

- 事实：TaskRun 现已拥有 waiting /revision /writer /operation result 的最小状态，Capability self-model 也禁止把随机 Tool 调用当能力探索；但 liveness、Recovery、Completion 和预算责任仍有迁移期重叠。
- 影响：Agent 可能重复控制声明、观察或修改措辞，最终被门禁或总预算终止，尚未完成一次真实写入与验收。
- 处理：M3-D 由 TaskRun reducer 成为唯一 liveness owner；相同 progress key 的恢复有界，并仅为已获授权且交付要求 mutation 的任务保留同目标读回和最终 Evaluation 预算。

### R-038 专业判断 ownership 已接入，但模型在不同问法下的遵循仍待实机确认

- 事实：历史 assistant 自我锚定、同 revision 重复基础读取、只读任务误入写入 /复刻完成契约的代码根因已经修复；只读自然语言实机已从重复读取和错误 0/3 收敛为 1 轮、仅开场读取、0 mutation 并成功完成。此前可见模型回答仍曾把“多个同质量候选”错误推回用户；最后一轮强制独立重判又被旧复刻 Completion 覆盖，因此尚没有修复后不同自然问法的完整可见输出证据。
- 影响：静态规则和 Prompt 已正确表达成熟设计师责任，但 Provider 可能仍以“尊重偏好”为由制造无必要澄清；如果直接进入写入 canary，会把模型遵循问题与 Photoshop 执行问题混在一起。
- 处理：窗口空闲后先用至少三种不含 Runtime /Tool 术语的真实运营问法做零写入可见回归，要求 Agent 自主承担可观察事实与可撤销专业判断，只把用户独占事实列为阻塞。该检查只校准决策表达，不替代 V0/V1 写入和质量验收，也不因单次偏差新增品类规则。

### R-037 Task Profile 与阶段知识已接线，但真实设计可用性尚未验证

- 事实：F1/F2 已使 `design-task-types.ts` 成为唯一 crosswalk Owner，并让方法知识与交付物知识通过唯一 Context Compiler 按当前 Stage 装载；普通参考缺失也不再硬阻断。F3 首条单画布 Craft Recipe 也已作为 R4/R5 的受治理知识接入。当前证据来自类型、检索 /边界审计和完整维护验证，尚未运行真实 Provider + Photoshop 的无 Skill 设计纵切。
- 影响：代码可以正确提供知识，不等于模型一定能在真实素材上形成优秀设计判断；如果下一步继续加 Prompt 或知识条目而不先做 V1 真实设计，可能把执行、观察、工艺或评价缺陷误诊成“知识不足”。
- 处理：冻结 crosswalk、Context Owner 与首条 Recipe 结构；先完成 X1/X2/V0 与 V1，用真实任务分别观察语义声明、知识选择、设计决策、Photoshop 落地和写后评价。只有可重复证据显示某类方法确实缺失，才补 Artifact Knowledge /Craft Recipe，不向通用 Agent 核心加品类状态机。

### R-036 TaskRun / Transaction / R4 切换形成双 owner

- 事实：RuntimeSession、continuation、Recovery、Completion、shadow 和多个 Photoshop 写工具仍有迁移期责任。
- 影响：可能重复调度、错误恢复或把 applied + verification_failed 改写成未执行。
- 处理：按 X1/X2 capability pack 纵向迁移；TaskRun 与 Runner 是会合依赖而非全仓先后关系。每片定义替代 owner、正反回归和负代码预算，同步退役对应旧责任；未迁移 Tool 不进入该 R4 切片。

### R-034 工作树缺少新鲜、可归属的完整基线

- 事实：当前工作树包含多类历史 Runtime、UI、UXP 和文档改动。
- 影响：整体 clean / reset / checkout 或混合回退可能误伤用户改动。
- 处理：保持分批验证，不执行整体清理；本轮只修改明确列出的 F1/F2 生产 Owner 与项目记忆，不回退、暂存或提交其它会话改动。

### R-031 没有唯一 Release Gate owner

- 事实：DesignVerdict、Delivery Receipt、Runtime 收尾和兼容路径仍有部分重叠。
- 影响：Tool success、离线结构通过和设计交付可能被混为一谈。
- 处理：V1 直接建立同一个 canonical Release Gate owner 的首条真实消费路径；M5 继续迁移全部旧消费者。Gate 不得早于 V1 伪造下层事实，也不得另建临时第二 Gate。

### R-030 项目记忆与机器快照曾指向不同主线

- 事实：历史任务、计划、状态日志和机器数组曾同时作为当前入口。
- 影响：恢复时可能从旧动作选择错误下一步。
- 处理：本次压缩只保留单一当前视图；历史由 Git 承担，`Status.md` 与 `project-state.json` 同步。

### R-029 续跑目标身份漂移

- 事实：生产确认卡现已携带并校验结构化 `taskRunId / runId / generation / interactionId / expectedRevision`，Engine 直接承接原挂起 leaf operation；裸自然语言“继续”仍不会恢复历史写权限。跨应用重启与多次连续确认的完整 TaskRun 状态恢复尚未实机验证。
- 影响：普通裸续跑的主要误授权路径已封闭，但不能把一次结构化 continuation 接线外推为完整跨会话 TaskRun 持久化。
- 处理：V0 实机覆盖等待、正确恢复、stale revision、重复提交和应用重启；在真实证据前保持 continuation ledger 为唯一持久化操作账本，不新增第二 Task Store。

### R-001 能力描述提前外推

- 事实：已有 Skill、Tool 或 Photoshop canary 容易被表述成完整设计能力。
- 影响：路线、用户预期和验收口径失真。
- 处理：所有状态拆分为代码、构建、手测和未验证；真实 Provider + Photoshop + 读回 + Evaluation + Delivery 才能升级。

### R-001A Benchmark 被误当成产品能力

- 事实：benchmark、fixture、单张截图只能验证局部能力。
- 影响：项目可能围绕样例硬编码，错误宣称设计质量或速度。
- 处理：开发验证与生产 Runtime 隔离，任何 benchmark 不得推动阶段跳级。

### R-009 清理项目误伤已可用功能

- 事实：旧项目记忆中存在大量有效边界和回归事实，但历史正文不应继续作为当前指挥链。
- 影响：过度清理可能删掉不可逆审批、目标绑定、权限、回滚或 unknown readback 约束。
- 处理：本次只压缩文档，不改代码；Git 保留旧内容，精简版显式保留边界级不变量。
