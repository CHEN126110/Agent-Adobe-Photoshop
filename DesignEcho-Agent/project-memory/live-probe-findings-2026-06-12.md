# 真实项目全链路摸底报告（2026-06-12）

任务来源：用户指令「把设计 Agent 开发到可用（包括整体前后端）」→ 第一步全链路摸底，暴露真实断点清单。
摸底方式：经 8768 MCP HTTP 端点直驱真实 Photoshop；经 CDP 9223 + ChatPanel test bridge 直驱真实聊天链路；Eagle MCP 直连探测。
环境：Photoshop 已打开真实项目（详情页.psb 1440×29999、232 图层等 5 个文档）；项目 C-1163（D:\A1 neveralone旗舰店\C-1163）。

## 一、环境健康（摸底①）✅ 通过（一处外部断点）

- Photoshop 桥：8768 MCP ready，UXP 插件连接健康（ping/pong 正常），27 个 MCP 工具 + 112 个 PS 原子工具可达。
- Eagle MCP：服务在线（Eagle 4.0.0 build 23，库 E:\Software\未闻花名.library）。我们协议层与真实 API 全部匹配（端点 /api/tools/call、body {tool, params}、item_query 用 query 字段、12 工具名单全部在 availableTools 中）。
- **断点 E1（Eagle 侧）**：所有触库工具挂死无响应（item_query / item_get_selected / ai_search_status 在 15s/45s 超时内无任何返回），仅 get_app_info 等元工具秒回。我们服务端 8s 超时会优雅降级（设计如此），但功能事实不可用。Eagle 的 ai-search python 服务进程在跑（监听 38765/38766）。需在 Eagle 侧诊断：库过大 / AI 索引未建 / Eagle MCP Server 实现缺陷。

## 二、只读链路实测（摸底②）✅ 9/9 全通

经 `scripts/probe-readonly-live.cjs`（本次新增，PS 原子工具走 photoshop.tools.call 包装器）：
listDocuments、getDocumentInfo、getLayerHierarchy、getAllTextLayers、photoshop.acceptance_snapshot（含图）、analyzeLayout、runtime.get_active_context、system.status 全部通过，最慢 3.4s。
详情页解析：detail.get_template_graph 在真实 29999px PSB 上 8.8s 识别 11 屏 + 文案占位 + 字号字体。detail.audit_placement 需先传 placements（正常契约）。
报告：tmp/probe-readonly-live/report.json。

## 三、模型决策与业务链路实测（摸底③）——核心断点都在这里

### D0（头号断点）：运行线与 v3 手术是两条未合流的架构线

- 运行中的应用构建自主工作区 `codex/agent-uxp`（engine.ts 2638 行：intent control plane + modelDecision 路由拓扑，clarification/direct_response/skill_execution 在自主循环之前分流）。
- v3 手术成果（engine.ts 1814 行：模型自主循环为默认路径，规则只提示不拦截）在 worktree 分支 `claude/v3-on-codex`，从未合并进运行线。
- 实测后果（真实聊天驱动，PS 已连接、最新构建）：
  - **B5**：「帮我去 Eagle 里找一些袜子详情页的设计参考」→ router 判 clarification_needed → 循环外直接回复「我目前没有直接访问 Eagle 素材库的能力」。回复元数据：origin=model_repaired，source=model-router:clarification，no_tools。searchEagleReferences 在默认工具集（tool-schemas.ts DEFAULT_AGENT_TOOL_NAMES），但只有进自主循环模型才能看到工具列表——router 的决策上下文没有工具能力清单，按自己的世界观否认了系统真实具备的能力。
  - **B6**：「看一下当前 Photoshop 打开的详情页文档，告诉我有几屏」→ origin=conversational:chat → 回复「我先读取当前 Photoshop 打开的文档结构，帮你看看」→ 零工具调用直接结束。无行动能力的对话路径生成了承诺行动的文本。
- 结构性规律：新增任何工具能力（Eagle、State、未来的 SKU 等），router 都不知道，都会被循环外路径漏判。这正是「Agent 看起来不聪明」的机制性根源。
- 对照：「你现在能连上 Photoshop 吗？」7 秒直答正确——简单对话路径本身没问题，问题在「该进循环的请求进不了循环」。

### B2：素材视觉分析 JSON 裸解析炸裂

resource-manager-service.ts analyzeAssetContent（约 1556-1558 行）：贪婪正则抓 JSON 后裸 JSON.parse。实测 3 张图全部「分析失败: Bad escaped character in JSON at position 95 (line 3 column 24)」。无容错修复层（坏转义/围栏/尾注释）。

### B3：素材视觉分析硬编码模型列表 + 图像疑似未送达

resource-handlers.ts（约 118 行，resource:analyzeAsset）：硬编码 visionModels=['gemini-3-flash','ollama-llava:13b','ollama-llava:7b']，无视用户配置的 visualAnalyze（xiaomi-mimo-v2.5）。三张不同图片的解析错误 position 完全相同 → 模型输出几乎相同 → 强烈怀疑 image_url 内容块未被适配器真正送达模型，模型只能照抄提示词模板（成功的 3 张返回的全是「简要描述」等占位符）。需查 modelService.chat 对 content 块数组中 image_url 的适配。

### B4：同工具失败重试无止损

实测一次运行内 analyzeAssetContent 连续调用 6 次（3 次失败标注「未完成」），总耗时 218.6s。循环层缺「同工具连续失败 N 次强制换路/收口」护栏。

### D2：UXP 插件端点硬编码

DesignEcho-UXP/src/index.ts:68 `ws://localhost:8765` 固定——调试/验收实例（端口偏移）永远接不到真实 PS，live 验证必须由持有 8765 的实例承担。

### D4：聊天运行时无持久化决策证据

调试桥 8767 /sessions 只有 2026-03 的旧 demo；本次只能靠 CDP 读 test bridge snapshot + UI 截图取证。运行时决策 trace（route、工具调用、reply origin）未接入证据通道。

## 四、本次环境操作记录（如实声明）

- 为加载今日构建并打通驱动通道，已停止旧实例（PID 18052 主应用 06:48 启动、PID 57044 调试窗 11:12 启动——两者均早于今日 15:33/16:20 构建，跑的是旧代码），用官方 launcher `--use-default-runtime-ports --port 9223` 重启。
- 新实例（PID 64808）：最新构建 + 默认端口 8765-8768 + CDP 9223 三要素合一；UXP 插件 20 秒内自动重连成功。聊天历史在 userData 持久化，无丢失。
- 实测全程只读（零 Photoshop 写入、零保存导出、零文档创建）。

## 五、可复用的实测驱动模式（本次建立）

1. PS 原子工具直驱：POST 8768/mcp JSON-RPC tools/call，PS 工具经 `photoshop.tools.call` 包装器（scripts/probe-readonly-live.cjs 可复跑）。
2. 真实聊天驱动：launcher `--use-default-runtime-ports` 启动 → inspect-chat-ui-running-window.cjs 发 prompt → CDP `window.__DESIGNECHO_CHAT_TEST_BRIDGE__.getSnapshot()` 读 assistantReplyOrigin / toolResultCount / visibleTextPreview 取证。
3. Eagle 直探：POST 127.0.0.1:41596/api/tools/call，body {tool, params}。

## 六、修复主线建议（按依赖序）

1. **合流 v3 与 codex 控制面**（D0）：不合流，Eagle/State 等一切新能力在真实入口处都是死的。两边 engine.ts 大改（1814 vs 2638）需专门合并会话；建议以 v3「循环默认」为骨架，保留 codex 线的 route boundary / reply origin / 真实窗口验证等控制面资产。
2. B2+B3：素材分析链路修复（JSON 容错解析层；模型选择尊重用户配置走统一 resolve 逻辑；核查 image_url 适配器链路）。
3. B4：循环止损护栏（同工具连续失败阈值）。
4. E1：Eagle 侧诊断（用户操作：检查 Eagle AI 索引状态/库体检；我方可加探测工具区分「服务在线但触库挂死」与「离线」两种降级文案）。
5. D4：运行时决策证据接入调试桥（让验收/摸底可机读取证，不再靠截图）。
6. 写入类业务链路（详情页填充/导出/主图生成）的 live 验收：建议在 v3 合流后做——旧拓扑下入口不可达（B5/B6 模式），写入实测只会重复同一断点。
