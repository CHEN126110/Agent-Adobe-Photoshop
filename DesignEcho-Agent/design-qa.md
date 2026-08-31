# Design QA

> 文档类型：D 层一次性 UI 验收记录。
> 当前开发权限：不能直接指导当前 UI，也不能证明当前构建通过；截图和 `passed` 只对应当时样本。
> 适用范围：追溯该次对话过程 UI 的人工验收。
> 不能覆盖：CurrentTask、Status、当前代码和新的可见画面。

historical_result: passed

## 验收对象

- 参考源：`C:\Users\12611\AppData\Local\Temp\codex-clipboard-dd4b281d-c957-4d9b-a5cc-4ae3b57c8365.png`（918 × 816）
- 实现范围：DesignEcho 对话消息中的公开处理过程、工具运行状态行、逐工具详情折叠与运行态反馈
- 实际应用截图：`tmp/running-window-chat/codex-ui-after-light.png`（1184 × 761）
- 前后对照图：`tmp/running-window-chat/codex-ui-design-qa-comparison.png`（1134 × 700）
- 验收状态：浅色主题、终态消息、假模型与假 Photoshop 隔离环境；本轮视觉验收没有执行真实 Photoshop 写入

## 视觉一致性

- 信息层级：处理正文默认直接展示，不再把完整过程藏在终态总折叠里；工具调用作为正文之间的次级状态行出现。
- 工具行：默认只显示终端图标、`已运行` / `正在运行` 状态、用户可读动作名和展开箭头，结果、说明与耗时在单行内部按需展开。
- 版式：移除时间线节点、连接线和卡片化工具块，保持连续段落和紧凑行距；窄面板中无横向溢出。
- 字体与颜色：继续使用项目现有系统字体和语义色变量；浅色主题单独提高正文与工具状态对比度，深色主题也已检查。
- 图标：参考图没有需要复用的品牌图像资产；实现沿用项目既有 Lucide 图标族，避免引入不一致的资源。
- 有意差异：参考图是宽内容区，DesignEcho 是约 339 px 的侧栏；实现保留同一信息优先级，但按窄面板缩短行距和字号，没有照搬宽屏尺寸。

## 交互与状态验证

- 初始 DOM：两个工具按钮的 `aria-expanded` 均为 `false`，详情节点数量为 0。
- 点击展开：成功工具行展开后显示工具说明、结构化结果和 `用时 0.9 秒`，`aria-expanded` 变为 `true`。
- 点击收起：再次点击后详情节点数量恢复为 0，`aria-expanded` 变回 `false`。
- 运行态：最末一条进行中工具行获得唯一 `is-live` 状态，计算样式确认使用 `de-action-shimmer`、2.4 秒线性无限动画；系统启用减少动态效果时会自动关闭扫光。
- 可访问性：工具行与总过程标题均使用原生 `button`，具有明确的展开/收起名称、焦点样式和 `aria-expanded` 状态。
- 稳定性：本地组件页无横向溢出；浏览器控制台 warning/error 数量为 0。

## 对照迭代记录

1. 基线问题：终态消息只显示“设计过程 N 步”，正文与工具过程整体不可见。
2. 第一轮：改为正文默认展开、工具详情逐行折叠，建立与参考图一致的正文优先层级。
3. 第二轮：移除整段错误红色强调，错误仅由对应文案和工具状态表达，避免正文被视觉噪声淹没。
4. 第三轮：提高浅色主题下正文和工具状态的对比度，并把快照操作改为原生按钮。
5. 最终复核：应用全视图、局部前后对照、真实点击展开/收起、运行态动画、溢出和控制台检查均通过。

## 工程验证

- `npm run build:typecheck:renderer`：通过。
- `npm run build`：通过；仅保留项目既有的 Vite 分包提示。
- `npm run check:repository-encoding`：通过，文件保持 UTF-8/LF 约束。
- `node --check scripts/report-change-boundaries.cjs` 与 `npm run maintenance:change-boundaries`：通过；`design-qa.md` 已登记为 `renderer-ui-shell` 验收产物。
- `npm run maintenance:validate`：在变更边界阶段被工作区中既有、与本 UI 任务无关的 `src/shared/model-provider-failure.ts` 和 `src/main/services/smile-ai-image-service.ts` 拦截；本轮没有修改或掩盖这两个文件。
