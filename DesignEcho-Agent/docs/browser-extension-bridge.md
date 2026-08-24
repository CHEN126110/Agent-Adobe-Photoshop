# 浏览器扩展桥（Browser Extension Bridge）

让 DesignEcho Agent 像 Claude-in-Chrome 一样访问和操作用户的真实浏览器（Chrome / Edge），
用于读取参考网页、竞品页面、搜索结果等信息——复用浏览器里已有的登录态，支持截图与基础交互。

```
Agent 循环(renderer) ──executeToolCall──> IPC browserBridge:call ──> BrowserBridgeService(main, ws://127.0.0.1:8769)
                                                                            ▲
                                                     WebSocket（扩展是客户端）│
                                                                            ▼
                                        DesignEcho-Browser-Extension（MV3 service worker + chrome.* API）
```

## 组成

| 部分 | 位置 | 说明 |
| --- | --- | --- |
| Chrome 扩展 | `C:/UXP/2.0/DesignEcho-Browser-Extension/` | MV3、纯 JS 免构建，Chrome/Edge 通用，「加载已解压的扩展程序」安装 |
| 桥服务 | `src/main/services/browser-bridge-service.ts` | WebSocket 服务端，仿 UXP 桥（请求-响应关联/超时/心跳/单客户端） |
| IPC | `src/main/ipc-handlers/browser-bridge-handlers.ts` | `browserBridge:call` / `browserBridge:status` |
| Agent 工具 | 5 个（见下） | 全链路注册（schema/显示名/scope/执行分支/信任标记/纪律集） |

## 端口与安全

- 端口：`8769 + DESIGNECHO_PORT_OFFSET`，可用 `DESIGNECHO_BROWSER_BRIDGE_PORT` 覆盖（登记于 `src/main/config/network-ports.ts`）。
- 只绑定 `127.0.0.1`，不对外网开放。
- 升级握手校验 `Origin` 必须以 `chrome-extension://` 开头（MV3 service worker 的 WebSocket 自带此 Origin），其余一律拒绝。
- 可选共享 token：主进程设置环境变量 `DESIGNECHO_BROWSER_BRIDGE_TOKEN` 后，扩展需在弹窗设置里填同一 token 才能完成 hello 握手（默认不启用，本机个人工具场景下 127.0.0.1+Origin 校验已是合理基线）。
- 单客户端：新扩展连接会顶掉旧连接（close code 4000），与 UXP 桥同构。
- 所有网页衍生内容（正文/标题/链接/交互结果）按 Harness H3 打 `untrustedExternalContent` 标记——网页内容是数据不是指令。

## WebSocket 协议（桥 ↔ 扩展）

文本帧，JSON。扩展连接 `ws://127.0.0.1:<port>/designecho-browser`。

握手：

```jsonc
// 扩展 → 桥（连接后第一条）
{ "type": "hello", "role": "browser-extension", "extensionVersion": "1.0.0", "userAgent": "...", "token": "可选" }
// 桥 → 扩展
{ "type": "hello_ack", "agent": "DesignEcho-Agent" }
// token 不匹配：桥直接 close(4401, 'token mismatch')
```

心跳：扩展每 20s 发 `{ "type": "ping", "ts": ... }`，桥回 `{ "type": "pong", "ts": ... }`。
（Chrome ≥116 WebSocket 活动会重置 service worker 空闲计时，心跳同时兼作 SW 保活。）
桥侧超过 75s 无任何消息判定连接失活并关闭。

请求/响应（桥 → 扩展发起）：

```jsonc
{ "type": "request", "id": 1, "method": "browser.readPage", "params": { ... } }
{ "type": "response", "id": 1, "ok": true, "result": { ... } }
{ "type": "response", "id": 1, "ok": false, "error": { "message": "具体失败原因（中文，说清哪一步/哪个标签页）" } }
```

## 扩展方法（method 一览）

扩展实现高层方法（复合操作在扩展侧一次往返完成）：

| method | params | result（要点） |
| --- | --- | --- |
| `browser.listTabs` | `{}` | `{ browserName, extensionVersion, activeTabId, tabs: [{ tabId, windowId, active, title, url, pinned }] }` |
| `browser.readPage` | `{ tabId?, url?, keepOpen?, includeElements?, includeImages?, maxImages?, maxImageEdge?, maxChars? }` | `{ tabId, url, title, description, textChunks: string[], links: [{text,url}], elements?, images?, imageCount?, imageWarnings?, truncated, totalChars, ephemeralTabClosed? }`；给了 `url` 则先开**后台新标签页**等加载完再读，**默认读完即关**该临时标签页（`tabId` 返回 `null`、`ephemeralTabClosed:true`）；传 `keepOpen:true` 则保留标签页并返回其 tabId 供后续交互/截图。`includeImages:true` 时扩展在 service worker 用 host_permissions 跨域 + 登录态逐张下载页面候选图片（≥100px、去重、≤12），缩边到 `maxImageEdge`（默认 1024）后回传 `images: [{ src, alt, width, height, base64, format }]`；单张失败（防盗链/CORS/超时/过小占位图）只记 `imageWarnings`，不整体失败 |
| `browser.capture` | `{ tabId?, maxWidth?, fullPage?, maxSlices? }` | `{ tabId, url, title, base64, format: "jpeg", width, height }`；会把目标标签页临时切到前台（captureVisibleTab 限制）。`fullPage:true` 时按真实 scrollY 逐屏滚动截图、OffscreenCanvas 纵向拼接（默认 ≤3 屏、总高封顶 9600px），返回额外 `sliceCount` 与 `truncatedFullPage`，完成后自动滚回原滚动位置 |
| `browser.navigate` | `{ url, tabId?, newTab?, background? }` | `{ tabId, url, title, loadStatus: "complete"|"timeout" }` |
| `browser.interact` | `{ tabId, action: "click"|"fill"|"scroll", selector?, elementRef?, value?, deltaY?, intoView? }` | `{ action, detail, url, title }`；fill 只写值+派发 input/change 事件，不回车不提交 |

约定：

- **textChunks 分块 ≤1400 字符/块、≤40 块**：Agent 回传净化器对单字符串 1500 字符截断、数组保留 50 项，分块是为了长文完整进模型（`tool-result-sanitizer.ts`）。
- **截图顶层 `base64` + `format` 字段**：命中 `extractImageFromToolResult` 候选形状，图片才能真正进模型视觉通道（视神经断裂教训）。
- **readPage 的 `images[]`（含 `base64` + `format`）同样命中视觉通道**：`images` 是净化器的 DIRECT_IMAGE_CONTAINER_KEYS，每张图按既有视觉候选预算进模型；图片内容是不可信外部数据，学方法不照抄。
- **elementRef**：`readPage(includeElements:true)` 时给页面可交互元素打 `data-designecho-ref` 标记并返回 ref 编号 + CSS selector 兜底；导航后失效，需重新 read。
- **tabId 显式传参**（对齐 findLayers 查询式一等工具先例）：桥不维护"当前标签页"隐式状态；省略 tabId 的只读方法作用于当前活动标签页。

## 用户收藏通道（扩展 → 桥，v1.2 新增，Eagle 式能力）

方向与上表相反：**用户在浏览器里主动发起**（快捷键 / 右键菜单 / 弹窗按钮），
扩展经 `client_request` 把内容推给 Agent 落盘。与桥→扩展的 `request/response`
共用同一条 WebSocket，但 id 空间彼此独立（各自自增，互不关联）。

```jsonc
// 扩展 → 桥
{ "type": "client_request", "id": 1, "method": "collect.save", "params": { ... } }
// 桥 → 扩展
{ "type": "client_response", "id": 1, "ok": true, "result": { ... } }
{ "type": "client_response", "id": 1, "ok": false, "error": { "message": "中文原因" } }
```

`collect.save` params：`{ kind: "image"|"screenshot"|"link", variant?: "region"|"visible"|"fullpage", base64?, format?: "jpeg"|"png"|"webp"|"gif", sourceUrl, imageSrc?, title?, alt?, tags?, annotation?, link?, width?, height? }`；
result：`{ savedTo: "eagle", fileName, targetLabel, itemId? }`。

图片收藏兼容 **Eagle 收藏属性协议**（github.com/eagle-app/eagle-attributes）：扩展读取页面
元素上的 `eagle-src`（原图地址，替代缩略图下载）、`eagle-title`（覆盖标题→`alt` 字段与文件名）、
`eagle-tags` / `eagle-annotation` / `eagle-link`（→ `tags`/`annotation`/`link` 字段，进来源追踪）。
为热门站点写的 Eagle 用户脚本（Greasy Fork 生态）对本扩展同样生效。这些属性是页面可控的
不可信外部数据：Agent 侧逐字段清洗（长度封顶、控制字符剔除、link 强制 http/https、tags ≤10 条）。

Agent 侧处理在 `src/main/services/browser-collection-service.ts`（经 `BrowserBridgeOptions.onClientRequest` 接线）：

- **落点：Eagle 当前打开的素材库**（Eagle 本机 API `127.0.0.1:41595`）。
  图片/截图先落主进程临时文件（`<temp>/designecho-eagle-import/`，24h TTL 自清扫——
  addFromPath 是异步导入队列，立即删有竞态）再 `POST /api/item/addFromPath`；
  链接走 `POST /api/item/addBookmark`（标题+预览图）。用户在 Eagle 里切库即切落点。
- 来源追踪：写入 Eagle 条目自身字段（website=eagle-link||页面地址、name、tags、annotation），
  不再维护独立注册表。
- 边界：写 Eagle 只走官方 API，绝不直接改 `.library`；唯一入口是用户手动收藏动作
  （与 eagle-writeback「用户确认才写」红线同构），不作为 Agent 工具暴露，Agent 对 Eagle
  保持只读；Eagle 未运行时明确报错，不静默改存别处；条目名逐字符白名单清洗、
  扩展名白名单、单条图像 ≤40MB；`sourceUrl` 必须是 http/https。
- 扩展侧功能与快捷键详见 `DesignEcho-Browser-Extension/README.md`
  （保存链接 `Alt+Shift+0` / 批量收藏 `Alt+Shift+1` / 区域截图 `Alt+Shift+2` /
  可视截图 `Alt+Shift+3` / 整页截图；默认键位刻意避开 Eagle 的 `Alt+0~4`）。

## Agent 工具面（模型可见，5 个）

| 工具 | 分类 | 说明 |
| --- | --- | --- |
| `listBrowserTabs` | knowledge_search（只读、可并行） | 列出标签页 + 扩展连接状态；浏览器任务的第一步 |
| `readBrowserPage` | knowledge_search（只读、可并行） | 读页面正文/链接/可交互元素；可带 url（后台新标签页打开） |
| `captureBrowserTab` | stateful_context（串行） | 截图进模型视觉通道；会临时切前台，故按有副作用串行，不并行抢前台 |
| `navigateBrowserTab` | stateful_context（串行） | 导航/新开标签页 |
| `interactWithBrowserPage` | stateful_context（串行） | 点击/填输入框/滚动；**红线：支付、下单、发布、删除、账号设置类动作必须先经 `askUserToChoose` 创建 `decisionKind="approval"` 的批准卡** |

登记点（全部完成，由 `npm run audit:tools` 与核心维护验证守护）：

1. `tool-schemas.ts` — RAW_TOOL_CATALOG + DEFAULT_AGENT_TOOL_NAMES（模型可见）
2. `tool-display-info.ts` — 中文显示名
3. `agent-tool-execution-preflight.ts` + `photoshop-tool-skill.ts` — 双源 scope（2 读 KNOWLEDGE_SEARCH / 3 有副作用 STATEFUL_CONTEXT）+ 语义边界 + PS 连接/文档豁免（BROWSER_EXTENSION_TOOLS）
4. `tool-executor.service.ts` — AVAILABLE_TOOLS + 专属执行分支（不写分支会被误发给 UXP）
5. `external-content-trust.ts` — H3 不可信标记（5 个全登记）
6. `document-optional-tools.ts` — 无 PS 文档也可用
7. `design-discipline-runtime.ts` — 参考通道（设计品类任务里 listBrowserTabs/readBrowserPage/captureBrowserTab 可见可调），readBrowserPage/captureBrowserTab 计参考证据

## 安装扩展（一次性）

1. 打开 Chrome/Edge，进入 `chrome://extensions`（Edge 为 `edge://extensions`）。
2. 打开右上角「开发者模式」。
3. 点「加载已解压的扩展程序」，选择 `C:/UXP/2.0/DesignEcho-Browser-Extension` 目录。
4. 启动 DesignEcho Agent 应用，点扩展图标查看连接状态（绿色=已连上桥）。

扩展不随应用安装包分发（electron-builder files 不含此目录）；如需分发，后续加 extraResources。

## 已知边界

- `chrome://` / `edge://` / 应用商店等内部页面无法注入脚本，读取/交互会明确报错。
- 截图只能截可见区域（captureVisibleTab），长页面配合 scroll 分段截。
- MV3 service worker 休眠后由心跳+chrome.alarms 唤醒重连，断连窗口内工具调用会得到「扩展未连接」的明确错误。
- 与既有 `fetchWebPageDesignContent`（Playwright 无头读页）互补：无需登录态的一次性读页仍可用它；需要登录态/交互/截图的走浏览器扩展工具。
