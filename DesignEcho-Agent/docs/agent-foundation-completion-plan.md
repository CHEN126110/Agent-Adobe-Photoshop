# Agent 基础设施收口计划

更新时间：2026-05-01

## 当前结论

`npm run maintenance:agent-architecture` 的当前结论是 `mvp_ready_not_complete`。

这表示 Agent 基础设施已经具备最小可用形态，但还不能说完整完成。现在应先补底座，再继续扩大业务能力，否则参考图复刻、详情页、主图、SKU、局部重绘都会继续被不稳定的路由、验收、知识和工具语义拖累。

## 已经进入 MVP 的底座

1. 意图与路由边界
   - 已有 task classifier、routing、design-agent engine。
   - 已有 `smoke:agent:intent-engine`。
   - 问模型、闲聊、解释类请求不会默认触发 Photoshop 工具。

2. Skill Runtime
   - 已有 `skill-declarations`、executor registry、executor types。
   - 核心能力已经进入 skill/executor 体系。
   - 仍需继续清理 skill 与 MCP/tool 的边界。

3. Runtime 防假成功
   - 已有 `executionSummary`。
   - 最大迭代、工具失败、验收失败、空转保护已有 smoke。
   - 这是目前最接近 ready 的 Agent 底座。

4. Photoshop 验收证据
   - 已有 snapshot/diff、tool evidence、live smoke。
   - 当前主要验证结构、bounds、字段读回，不验证视觉审美或像素相似。

5. Debug 与脱敏证据链
   - Debug Bridge / MCP debug session 默认脱敏。
   - 完整 session 需要 token。
   - 仍需真实开发流程验证。

6. 用户可见任务报告
   - ChatPanel / Message parser 已能展示任务报告。
   - 已具备隔离 Electron ChatPanel smoke，覆盖普通聊天、模型身份、安全文档操作和失败 `executionSummary` 任务报告样本；仍缺 live API / live Photoshop 质量验收。

7. 长任务项目记忆与边界治理
   - `project-memory`、master plan、cockpit、maintenance validate 已存在。
   - 这是继续长线开发的恢复底座。

8. 参考图复刻最小闭环
   - 已有解析、最小表示、blueprint、match、apply、QA、completion。
   - 仍不能宣称高保真复刻。

9. 多 Agent 最小体系
   - 已有 coordinator / registry / task / shared types。
   - 只是最小 teammate task，不是完整多 Agent 项目生命周期。

10. 知识层
   - 当前仍是 planned。
   - 已有网页搜索规划，但还没有统一 `DesignKnowledgeSearchService`。

## 必须补完的基础设施顺序

### F1：真实 UI 自动化验收

目标：证明 ChatPanel 真实窗口中的用户输入、任务报告、失败展示和脱敏行为稳定。

最小内容：
- 复用已存在的 ChatPanel test bridge。
- Electron 启动后提交普通聊天、模型身份问题、关闭文档、参考图复刻入口等样本。
- 验证用户页面不出现内部 debug JSON、不出现伪 thinking、不把失败说成完成。

验收：
- `smoke:chat-ui:electron-bridge` 不只是端口占用时跳过。
- 至少有一个真实窗口流可以稳定通过。

当前进展（2026-05-02）：
- 已支持测试实例使用独立 userData、独立端口段和一次性测试项目启动真实 Electron 窗口。
- `npm run smoke:chat-ui:electron-bridge` 在默认 8765 端口已被正常桌面端占用时仍能通过，不会清理或挤掉用户正在运行的 Agent/UXP 桥接。
- 当前真实窗口流覆盖：ChatPanel 挂载、稳定 selector、测试桥接 query、提交 `/help`、模型身份问题、普通设计聊天问题、`帮我关闭文档不保存`、`帮我把详情页文档保存到项目的PSD中`、失败验收任务报告样本、用户/助手消息追加、失败 `executionSummary` 不被乐观模型完成文案覆盖、无伪 thinking、无内部 debug bridge JSON 泄漏。
- 已通过 `DESIGNECHO_CHAT_TEST_FAKE_MODEL=1` 使用受控模型响应验证模型优先普通对话路径，不消耗 live API 额度。
- 已通过 `DESIGNECHO_CHAT_TEST_FAKE_PHOTOSHOP=1` 使用测试专用 Photoshop 工具桩验证高风险文档操作路由，不触碰真实 Photoshop 文档。
- 当前仍未覆盖：live API 模型质量、真实 Photoshop destructive 保存/关闭磁盘状态，以及更广泛的真实业务失败样本。

### F1a：全局流式输出与步骤可观测性

目标：让所有用户请求都有可观察的执行过程，包括阶段状态、工具调用、工具结果、验收证据和阻塞原因；普通聊天也应具备流式体验，避免用户只能等最终答案。

边界：
- 展示的是“可复核的执行步骤、状态摘要、工具调用和错误诊断”，不是模型私有链式思考。
- 不伪造 thinking；没有真实模型思考或阶段事件时，只能显示事实状态，例如“正在判断意图”“正在调用工具”“等待 Photoshop 返回”。
- provider 支持 token streaming 时再做最终回答 token 流；不支持时使用阶段级 step streaming，不用假流式掩盖 provider 能力差异。

当前进展（2026-05-05）：
- Agent runtime 已新增结构化 `onStep` 事件，覆盖任务开始、迭代、模型请求/响应、工具计划、工具开始、工具完成、观察、验收和停止。
- ChatPanel 已把结构化 step 事件映射到 Pondering，并保留旧 executor 的 `onProgress / onStatus / onToolStart / onToolComplete`。
- Pondering 和历史消息解析已允许展示 `status` 步骤，不再只显示空的 thinking 占位。
- 已新增 `smoke:agent:step-events`，验证 step 事件链路和敏感参数脱敏。

未完成：
- 普通聊天最终答案的 provider token streaming 尚未统一接入。
- 部分确定性 skill executor 仍只发通用 status，缺少领域阶段事件，例如参考图解析、网格推断、文本落位、截图 QA。
- 真实失败 Photoshop 任务还需要手测确认：用户在最终任务报告前能看到阻塞原因。

验收：
- 普通聊天、模型身份问题、参考图复刻、文档操作、失败 Photoshop 任务都能显示事实步骤，而不是空等。
- 工具调用必须显示开始、完成、失败和摘要结果。
- 不暴露 API key、token、完整原始工具 JSON、base64 截图和私有 chain-of-thought。
- 有 smoke 覆盖 step 事件、UI 渲染、失败任务报告和脱敏边界。

### F2：截图级 QA 最小闭环

目标：从 bounds-only 进入截图证据，至少能在用户可读报告中显示“计划框/实际框/截图证据”。

最小内容：
- 保持 overlay live 为显式命令，不进默认 preflight。
- 将截图摘要和 blocker/warning 进入普通任务报告。
- 不暴露 base64 到模型上下文。

验收：
- overlay contract + visual QA smoke 保持通过。
- 至少一个真实 Photoshop case 具备截图证据和人工结论。

### F3：工具语义底座扩展

目标：从文本工具扩展到移动/对齐/图像放置/形状/样式这几个高频工具。

最小内容：
- 每个工具有参数 schema、失败条件、可验收证据、性能风险。
- 不直接新增大业务功能，只让 Agent 明白工具边界。

验收：
- `PhotoshopToolSemantics` 增加非文本工具条目。
- 对应 smoke 覆盖关键字段。

当前进展（2026-05-01）：
- 已新增非文本语义：移动/对齐/基础变换、图片置入/替换、形状容器、基础图层样式。
- `basic-layer-style` 保持 `planned`，因为 style recipe 和截图级验证尚未完成。
- 已通过 `npm run smoke:photoshop-tool-semantics`，只证明语义目录与 Agent 可见 schema 对齐，不证明真实 Photoshop 视觉质量。

### F4：设计网格 DSL 与任务网格预设

目标：把排版约束从“模型猜 x/y”推进到 liveArea、margin、gutter、column span、baseline、spacing token。

最小内容：
- 先新增 Grid DSL 和任务预设，不直接修改执行器效果。
- 任务预设至少覆盖：reference-replication、text-certificate、sku、detail-page、main-image。
- 只输出计划与 smoke，不宣称排版质量已提升。

验收：
- 存在 `DesignGridSpec` 真相源。
- 有 smoke 验证预设、spacing scale、参考图网格推断输入输出边界。

当前进展（2026-05-01）：
- 已新增 `src/shared/design-grid-dsl.ts`，包含 `DesignGridSpec`、`GridPlacementConstraint`、任务预设、列框计算、最近列 span 推断和 `gridFitScore` 评估。
- 已新增 `npm run smoke:design-grid-dsl`，覆盖 text-certificate、sku、detail-page、main-image、reference-replication 五类预设。
- smoke 显式断言 Grid DSL 尚未接入 `layout-replication-apply`，防止半成品影响现有排版执行器。
- 当前仍未完成参考图自动网格推断、Photoshop guide 可视化、截图级 QA 和执行器 snap。

### F5：统一设计知识入口

目标：让网页搜索、设计参考、趋势感知、本地 recipe 入口统一成可追踪结果，而不是分散工具各说各话。

最小内容：
- 定义 `DesignKnowledgeResult`。
- 统一来源、引用、获取时间、用途边界、置信度。
- 小米 Web Search 作为 provider-native tool 规划接入，不塞进通用 function tool。

验收：
- 有 service/schema smoke。
- 非小米模型不会收到小米专属 tool。

### F6：多 Agent 任务生命周期

目标：把当前 teammate task 从“可调用”推进到“可恢复、可汇总、可验收”。

最小内容：
- 定义任务生命周期：planned / running / blocked / needs_review / done / failed。
- 子 Agent 输出必须有 evidence 和 boundary。
- Critic 必须消费 Photoshop 验收证据，而不是只做文字评价。

验收：
- coordinator smoke 覆盖状态流转和 Critic 证据要求。

## 当前不做的事

1. 不把 Grid DSL 直接接入执行器改变排版结果。
2. 不把网页搜索结果直接变成 Photoshop 动作。
3. 不宣传多 Agent 已经完整工作流。
4. 不把 bounds-only QA 说成截图级或审美级 QA。
5. 不用 prompt 硬编码替代意图判断和工具语义。
6. 不把全局流式输出做成伪思考或暴露模型私有链式思考。

## 当前下一步

优先做 F1/F1a/F3/F4 的准备工作：

1. 将 Grid DSL 纳入 master plan 和 project-state。
2. 将全局流式输出纳入所有 Agent 路径，先补 step 事件和失败可观测，再研究 provider token streaming。
3. 回看 `maintenance:agent-architecture` 中的未完成 gate。
4. 下一轮代码实现优先选择一个“小而可验收”的底座项，例如 Grid DSL 真相源、真实 UI 自动化 smoke 或领域 executor step 事件，而不是继续扩大业务功能。
