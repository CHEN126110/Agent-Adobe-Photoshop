# 前端交互与视觉审计（2026-08-21）

审计范围：三个前端面——① Electron 渲染进程 React UI（ChatPanel / DesignAgentWorkbench 等）；② 8766 WebView（`public/webview/index.html`，UXP 面板的实际视觉面）；③ UXP 面板宿主层（`DesignEcho-UXP/src/core/webview-panel-layout.ts`，全屏 webview 容器）。

审计方式：**静态代码审读**（未真机运行验证）。每条缺陷标注证据位置与置信度：
- 【确认】代码逻辑可直接推出，不依赖运行时条件
- 【推断】代码强烈指向，但需真机复现确认体感

---

## 一、P0：直接伤害日常使用的交互缺陷

### 1. 消息区自动滚动无护栏，长任务期间用户被反复拽回底部【确认】

`ChatPanel.tsx:3844-3847`：

```tsx
useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
}, [messages]);
```

问题有两头：

- **想回看被拽走**：`messages` 每次流式更新（正文追加、卡片状态变化）都强制滚底。Agent 任务动辄跑几分钟，用户滚上去看早先的素材分析 / 任务卡，下一个流式块一到就被拽回底部。没有「用户已上滚则暂停跟随」的判据，也没有「回到底部」按钮。
- **想跟直播又不跟**：实时过程块（`thinkingSteps` / `liveActivity` / `liveTaskCard`，渲染在 `ChatPanel.tsx:7189-7211`）是独立 state，不在 `[messages]` 依赖里。工具连跑阶段没有新消息，过程条目持续增长但视口不跟随——直播块长出视口外。

修复方向：滚动容器记录 `isNearBottom`（阈值 ~80px），仅在贴底时跟随；跟随判据同时覆盖 messages 与 live 块的增长（可观察 `messagesEndRef` 前一个元素的 ResizeObserver）；上滚状态下出现悬浮「↓ 回到底部」按钮。这是聊天类 UI 的标准做法，工程量小、收益是每一次长任务。

### 2. 对话面板固定 340–400px 且不可调——Agent-first 产品的主交互面被钉死【确认】

`DesignAgentWorkbench.css:200`：`.workbench-agent-panel { width: clamp(340px, 24vw, 400px); }`，无任何拖拽分栏实现（全仓无 resizer 组件）。连锁约束：

- `DesignAgentWorkbench.css:299`：assistant 消息正文 `max-width: 286px`。
- `messages-container` padding 24px（ChatPanel 内联样式），进一步压缩内容宽度。

产品矛盾在于：按项目记忆和实际用法，用户的主要驱动方式是对话（「帮我做 SKU」「做主图」），设计产出图、任务卡、工具结果、导出贴回的成品图**全部在这条 ≤286px 的窄柱里呈现**——而中央最大的区域给了工作流画布（次要面）。4K 屏上对话面也只有 400px。ImageZoomOverlay 点击放大只是补救，不能替代合理的默认呈现宽度。

修复方向（两层，可分步）：
1. 最小改动：分栏可拖拽（persist 到 store），上限放宽到 ~40vw；消息正文 max-width 跟随容器而不是写死 286px。
2. 产品层：考虑「对话优先」布局模式——对话为中央主面、画布/素材为可切换侧面。这一步涉及信息架构取舍，属于用户可见行为变化，先做 1，2 需要你拍板。

### 3. 浅色主题结构性破损——设置里能选，选了大面积漏色【确认】

设置面板提供 light 主题（`SettingsModal.tsx:2928`），`App.tsx:64` 会把 `data-theme="light"` 打到根元素。但覆盖面：

| 文件 | 硬编码色值 | light 覆盖块 |
|------|-----------|-------------|
| `message/MessageRenderer.css`（3047 行） | 117 处 | 仅 5 处 |
| `EagleLibraryPage.css`（1969 行） | 148 处（自带 `--eagle-*` 纯深色调色板，`:root` 级） | 0 |
| `KnowledgeLibraryPage.css`（2229 行） | — | 0 |
| `SettingsModal.css`（2151 行） | 53 处 | 0 |
| `DesignAgentWorkbench.css` / `WorkflowBoard.css` / `ThinkingProcess.css` | — | 0 |

另有单点：欢迎页标题 `ChatPanel.tsx:7577` 渐变 `linear-gradient(135deg, #fff 0%, #0066ff 100%)` + 文字裁切——浅色底上白色段基本不可见。

判断：浅色主题当前是「设置里承诺了、实现上没兑现」的状态。两条路线：
- **短收口（推荐先做）**：设置里暂时隐藏 light 选项或标注「实验中」，止住承诺；
- **长治**：把各页面 CSS 的硬编码色收敛到 `--de-*` token（Eagle 页的 `--eagle-*` 映射到语义 token 上），这是一次系统性还债，建议独立排期。

---

## 二、P1：明确的交互质量问题

### 4. 附件（+）菜单无外点关闭、无 Esc、无焦点管理【确认】

`ChatPanel.tsx:7253-7347`：`showAttachMenu` 只有两个关闭路径——再点一次 + 按钮、或选中某项。点击页面其他位置菜单不收，Esc 无效，无焦点圈定。对照同仓库 `WorkspaceTabBar.tsx:97-113`（pointerdown 外点关闭 + Escape + requestAnimationFrame 聚焦首项）——同一产品里两个菜单交互标准不一致，且做得好的那个已经给出了现成模式，直接复用即可。

### 5. 隐藏的死 UI 与假快捷键承诺【确认】

- `Header.tsx:80-105` 渲染撤销/重做按钮，但 `Header.tsx:250` `.history-buttons { display: none; }`——按钮和两个 handler 是不可达代码；且 title 写着「撤销 (Ctrl+Z)」「重做 (Ctrl+Shift+Z)」，**全应用没有任何全局键盘绑定**（grep 无 keydown 处理器挂 App 层）。要么恢复按钮并真的绑定快捷键（PS 联动撤销对设计工具是高价值功能），要么删掉这段死代码。
- `Header.tsx:243` `.connection-hint { display: none; }`——「请在 PS 中打开插件面板」这条引导写了但永不展示。PS 未连接时用户只看到一个红点+灰字，不知道下一步做什么。
- `ChatPanel.tsx` 内联样式里 `.welcome-tips` / `.tip-card` 成套样式已无对应 JSX（快捷任务面板已移除），死样式。

### 6. 运行之外的操作失败是静默的——缺全局通知通道【确认】

全仓 renderer 无 toast/notification 系统（grep 无命中）。后果模式：`Header.tsx:33` undo 失败只 `console.error`，用户无任何感知。Agent 运行内的错误有聊天消息兜着，但**运行外**的操作（面板动作、连接波动、设置保存失败等）没有统一的呈现出口，各组件要么自建局部提示、要么吞掉。建议补一个轻量 toast 层（错误必须含「哪一步失败 + 关联对象 + 建议动作」，与项目错误信息规范一致），并把现有 console-only 的失败路径接上。

### 7. `window.confirm` 原生对话框破坏体验一致性【确认】

`ChatPanel.tsx:1915`：切换会话时用 `window.confirm(...)` 确认丢弃草稿。Electron 里这是操作系统原生模态：样式与应用完全脱节、阻塞渲染进程、文案不能富格式。应用内已有styled 卡片/浮层体系（FloatingLayer、UserChoiceCardView），换成应用内确认浮层成本低。

### 8. PS 未连接的反馈滞后——撞墙式而非前置式【推断】

连接状态只在 Header 显示（且提示文案被 display:none，见 #5）。用户在 PS 未连接时发一个设计任务，composer 照常接受，要等到 Agent 循环里工具预检（执行点契约）拦截才知道不行——这是正确的架构（执行点强制），但**前端可以在不拦截的前提下前置告知**：PS 未连接时 composer 上方出现一条可关闭的窄横幅（「Photoshop 未连接——涉及画布写入的任务将无法执行。请在 PS 中打开 DesignEcho 面板」），发送不阻断。这符合「前置提示不阻断 agentic 执行」的项目原则。

---

## 三、P2：视觉与工程一致性（影响长期维护与品质感）

### 9. 样式体系四轨并行，两套设计 token【确认】

当前同时存在四种样式通道：
1. Tailwind（`index.css` 引入了三条 directive，但仅 7 个文件在用 utility 类）；
2. 组件级 `.css` 文件（20 个，14601 行）；
3. 组件内联 `<style>{...}` 块（7 个文件，ChatPanel 内约 970 行、AssetGallery ~700 行、Header 200 行）；
4. `style={{}}` props（SettingsModal 110 处）。

同一个概念在不同轨道重复定义（如 message 布局同时活在 ChatPanel 内联块和 MessageRenderer.css）。此外 **renderer 与 webview 是两套割裂的 token**：

| | renderer | webview |
|---|---|---|
| primary | `#3b82f6` | `#0066ff` |
| 背景 | `#0e1013` 平色 | `#0a0a12` 渐变 + 毛玻璃 |
| 滚动条 | 6px | 10px |
| 字体渲染 | 明确禁用 antialiased（Windows ClearType 决策，`index.css:79-83` 有完整论证） | `-webkit-font-smoothing: antialiased`（`webview/index.html:12`，与上述决策直接抵触） |

webview 的 antialiased 一条是明确 bug 性质的不一致：renderer 侧已论证过 Windows 下会让小字号发虚，webview 恰恰是小字号最密集（10–12px）的面。

收敛方向：不建议大重构，建议定死规则——新代码只走「组件 CSS 文件 + `--de-*` token」一轨；webview 侧先修 antialiased、滚动条与 primary 对齐可另议（webview 深色是有意为之，与 PS 环境匹配，不必强行同色）。

### 10. `'Space Grotesk'` 字体引用了但从未加载【确认】

`ChatPanel.tsx:7573` 欢迎标题指定 `font-family: 'Space Grotesk'`，全仓无 @font-face、无字体文件、无外链——永远回退到 sans-serif。要么打包该字体，要么删引用（欢迎页标题本来也该用系统栈）。

### 11. 字号刻度散乱【确认】

现存字号至少：9.5 / 10 / 10.5 / 11 / 12 / 13 / 14 / 16 / 18 / 28px（Header 的 project-context 甚至 9.5px）。无 type scale token。9.5–10.5px 在 Windows 非高分屏上可读性堪忧。建议收敛到 5 档（如 11/12/13/14/16 + 展示级），以 token 落地，与 #9 同一次还债。

### 12. ChatPanel 巨石化是交互 bug 的温床【确认】

8437 行、20 个 useState、10 个 useEffect、约 970 行内联 CSS。历史病历（UI 双状态源、停止后发不出、思考期假死）全部发生在这类状态高密度区。当前发送管线/续跑/卡片动作/编辑态/附件/拖拽全在一个组件闭包里。建议按已经自然成形的边界拆：composer（含附件菜单/拖拽）、消息列表（含滚动管理）、运行时状态桥（live 块）各自成组件+hook。**这属于结构性重构，不必一次做完，但每次改交互 bug 时顺势外迁相关块。**

### 13. 消息列表无虚拟化【推断】

`messages.map` 直接渲染全量（`ChatPanel.tsx:7066`）。块级 React.memo 已做（MessageRenderer.tsx），但长会话（几百条消息 + 大量图片块/任务卡）DOM 总量仍会拖慢滚动与切换会话。优先级不高——先修 #1 滚动护栏，虚拟化等真机测到卡顿再上（虚拟化会和滚动跟随、图片高度不定互相牵制，不要提前引入复杂度）。

### 14. webview 单文件 10947 行【确认】

袜子排版、手动 SKU 色卡、模板库、图生图等多个面板 + 全部 CSS + JS 在一个 HTML 里。功能上没发现结构性交互缺陷（下述亮点不少），但每次改动的定位成本和回归风险在涨。低优先级，提及备案。

### 15. 文档漂移：UXP 面板尺寸【确认】

根 CLAUDE.md 写「面板 280×620」，`DesignEcho-UXP/manifest.json` 实际 `minimumSize 320×700 / preferredDocked 360×760`。改文档时顺带修正。

---

## 四、后端能力 → 前端呈现的适配缺口（产品视角）

这部分不是「缺陷」，是**后端已有、前端没表达或表达不足**的能力：

1. **运行轮次与预算**：Agent 循环内部有轮次计数与预算（budget/rounds），前端 live 块只显示当前动作与耗时。长任务时用户最大的焦虑是「它还要跑多久、是不是卡死了」——把「第 N 轮 / 预算 M」或阶段进度带进 live 块头部，是低成本高感知的改进。（需核对 agent-runtime 事件里是否已带轮次字段——若没带，是主进程一行事件扩展。）
2. **停止后的续跑入口**：后端有续跑摘要与「上次做到」账本（H2），前端停止终态消息是否给出「继续上次任务」的动作按钮，值得核对；若没有，这是一个明确的动作出口缺失。
3. **运行档案 / 病历入口**：`debug:runs` 与运行档案是纯 CLI 能力。设计师用户遇到「刚才为什么失败」只能问下一轮。把最近一次运行的执行摘要（successfulMutationCalls、失败点）做成消息尾部可展开区，能把诊断能力交到用户手上。
4. **连接状态的能力语义**：前端只有「PS 已连接/未连接」一个布尔；后端其实分层（WS 连接 / 有无打开文档 / 文档是否受保护）。任务卡与 composer 横幅（#8）按层级提示，比一个红点信息量大得多。

---

## 五、值得保护的现有优点（别在优化时误伤）

- `WorkspaceTabBar`：完整的 tablist 语义、方向键导航、关闭后焦点回退——是全仓交互标准的标杆，新菜单类组件照它抄。
- `ThinkingProcess` 的相邻同工具步骤合并（含收紧的合并条件注释）——真实解决了「看起来卡在原地重复劳动」的观感问题。
- 用户气泡走中性灰的决策及其注释（`index.css:33-38`）、Windows 字体渲染决策注释（`index.css:79-83`）——这类「为什么」注释正是防止后人回退的正确做法。
- webview 袜子排版面板：五态色点、执行进度条、6 秒确认倒计时条、`prefers-reduced-motion` 适配、停止按钮用中性灰而非红色（含理由注释）——交互密度和分寸感都好。
- 消息块级 React.memo、tool-result sanitizer 截断、ImageZoomOverlay。

---

## 六、建议执行顺序

| 批次 | 内容 | 性质 |
|------|------|------|
| ① 立即 | #1 滚动护栏 + 回到底部按钮；#4 附件菜单收口（抄 WorkspaceTabBar 模式）；#5 死 UI 清理或复活决策；#10 字体引用清理 | 小改动、纯收益 |
| ② 短期 | #2 分栏可拖拽 + 消息宽度跟随；#6 toast 层；#7 应用内确认浮层；#8 连接横幅；#3 短收口（隐藏 light 选项） | 中等改动 |
| ③ 排期 | #3 长治（token 收敛）＋ #9/#11（样式轨道与字号刻度，同一次还债）；四中的适配项按价值逐个接 | 系统性还债 |
| ④ 持续 | #12 ChatPanel 逐步拆分（随交互 bug 修复顺势外迁）；#13 视真机表现决定 | 结构性 |

未验证声明:本轮为静态审计,#1/#2/#3/#4/#5/#7/#9/#10 从代码可直接确认;#8/#13 及第四节的体感与字段存在性需真机运行或进一步核对后再定案。
