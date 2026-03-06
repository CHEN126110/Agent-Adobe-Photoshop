# Layout Skills 实施技术文档（V2，基于当前代码）

## 1. 文档目标

本文档用于指导 **详情页（detail-page-design）** 与 **主图（main-image-design）** 的持续开发与完善，严格基于当前仓库可运行代码，不引入与现有链路冲突的并行协议。

适用范围：

- `DesignEcho-Agent`（主进程 + 渲染进程）
- `DesignEcho-UXP`（Photoshop UXP 执行层）


## 2. 当前真实实现基线

### 2.1 技能与执行器（已存在）

- 详情页 skill：`detail-page-design`
- 主图 skill：`main-image-design`
- 执行器注册：`src/renderer/services/skill-executors/index.ts`
- 技能声明：`src/shared/skills/skill-declarations.ts`

关键原则：

- 保持现有 skill ID，不新增平行 ID（如 `generate_pdp_layout`）来替代主链路。
- 新能力以“增强现有执行器”为主，减少迁移成本和决策分叉。

### 2.2 端到端执行链路（当前）

1. 用户意图进入 `unified-agent.service.ts`
2. 路由到 `executeSkillWithExecutor(skillId, params)`
3. 执行器内部调用 `executeToolCall(toolName, params)`
4. 渲染侧通过 `window.designEcho.sendToPlugin`/`invoke` 进入主进程
5. 主进程 `ws:send` 转发到 UXP WebSocket
6. UXP `toolRegistry` 分发到具体 Tool 执行

### 2.3 详情页当前步骤（已落地）

- `parseDetailPageTemplate`
- `matchDetailPageContent`
- `fillDetailPage`
- `exportDetailPageSlices`
- 可选结构修复：`detectLayerIssues` + `fixLayerIssues`

### 2.4 主图当前步骤（已落地）

- `getDocumentInfo`
- `getSubjectBounds`
- `smartLayout`
- `transformLayer` / `moveLayer`
- `quickExport`
- 可选增强：`harmonizeLayer`


## 3. 本次技术方案的“正确参考项”与“修正项”

## 3.1 可参考（保留）

- “规划（Plan）→ 填充（Resolve）→ 执行（Execute）→ 质检（QA）”的分层思想。
- 详情页与主图分开建模，不强行合并为单一流程。
- 低置信度标记与人工复核机制。

### 3.2 必须修正（与当前代码对齐）

- 不替换现有 skill ID：继续使用 `detail-page-design`、`main-image-design`。
- 不引入与当前执行器接口不兼容的泛型签名。
- 不假设尚未存在的 IPC 通道已可用（例如 `layout:*` 需按阶段落地）。
- 不直接照搬未验证的 UXP 伪 API，必须走现有 `toolRegistry` 和已实现工具能力。


## 4. 目标架构（增量式）

本方案采用“兼容增强”，不是重写：

### 4.1 渲染层

- 保留：
  - `detail-page.executor.ts`
  - `main-image.executor.ts`
- 增强：
  - 在执行器中引入统一 `layoutPlan` 中间对象（仅内部数据结构）
  - 增加 QA 阶段结果回传（issues/fixCount/confidence）

### 4.2 主进程

- 新增建议：
  - `src/main/services/layout-planner.service.ts`
  - `src/main/services/layout-resolver.service.ts`
  - `src/main/services/layout-qa.service.ts`
- 设计方式：
  - 先作为“可选服务”接入，不破坏现有工具调用路径
  - 对外先提供轻量 IPC（如 `layout:qa`），再逐步扩大

### 4.3 UXP 层

- 保留现有 `tools/layout/*` 工具并复用。
- 新能力优先扩展现有工具参数，不优先新增过多新 Tool 名称。


## 5. 分阶段开发计划（详情页 + 主图）

## Phase A：统一数据契约（低风险，优先）

目标：

- 补齐共享类型，统一详情页/主图的中间状态表达。

建议文件：

- 新增 `src/shared/types/layout.types.ts`

包含类型：

- `LayoutPlan`（屏幕、slot、layer 结构）
- `LayoutResolution`（图片/文案/置信度）
- `LayoutQAResult`（问题列表、自动修复统计）

验收标准：

- 编译通过；
- `detail-page.executor.ts` 与 `main-image.executor.ts` 能引用类型但不改变功能。

## Phase B：详情页流程增强（主链优先）

目标：

- 在现有详情页流程中增加“计划可视化 + 质量闭环”。

改造点：

- `detail-page.executor.ts`
  - 在 parse/match 后构建 `LayoutPlan`
  - 在 fill 前做可执行性校验（coverage、confidence）
  - 在 export 后执行 QA（结构/文本/裁切）并输出结果摘要

复用能力：

- `detectLayerIssues` / `fixLayerIssues`
- `copyReview` 与现有文案守护逻辑

验收标准：

- 现有详情页命令不变；
- 失败提示更清晰；
- 产出含 QA 指标（至少：问题数、修复数、低置信度位点）。

## Phase C：主图流程增强（并行）

目标：

- 固化主图“类型模板 + 自适应布局 + 导出策略”。

改造点：

- `main-image.executor.ts`
  - 统一 800/750/1200 与 custom 的输出策略
  - 将 `imageType` 映射到固定布局策略（click/conversion/white-bg）
  - 对 `getSubjectBounds` 异常增加回退（默认中心布局）
  - 在导出前增加最小可读性检查（主文案位置与主体遮挡风险）

复用能力：

- `smartLayout`
- `transformLayer`、`moveLayer`
- `quickExport`

验收标准：

- 单尺寸与批量尺寸都可稳定导出；
- 主体检测失败时仍可完成可用图；
- 执行日志包含每张图的布局策略与导出结果。

## Phase D：轻量 QA 服务接入（主进程）

目标：

- 将 QA 从执行器内逻辑抽到主进程服务，统一规则和可观测性。

新增建议：

- `src/main/services/layout-qa.service.ts`
- `src/main/ipc-handlers/layout-qa-handlers.ts`

建议 IPC：

- `layout:qa`：输入布局结果或文档快照，返回 `LayoutQAResult`

验收标准：

- QA 可独立调用；
- 执行器与 QA 服务可解耦；
- 日志可追踪到每次 QA 结论。


## 6. 文件级实施清单（建议）

修改：

- `src/renderer/services/skill-executors/detail-page.executor.ts`
- `src/renderer/services/skill-executors/main-image.executor.ts`
- `src/renderer/services/skill-executors/design-plan.ts`
- `src/shared/skills/skill-declarations.ts`（仅参数/描述增强，不改 skill ID）
- `src/main/ipc-handlers/index.ts`（注册新增 QA handler）

新增：

- `src/shared/types/layout.types.ts`
- `src/main/services/layout-qa.service.ts`
- `src/main/ipc-handlers/layout-qa-handlers.ts`

可选新增（后续）：

- `src/main/services/layout-planner.service.ts`
- `src/main/services/layout-resolver.service.ts`


## 7. 兼容性约束

- 不变更 `main-image-design` 与 `detail-page-design` 的 skill ID。
- 不移除现有工具名：`parseDetailPageTemplate`、`fillDetailPage`、`smartLayout`、`quickExport` 等。
- 新增字段必须保持向后兼容（默认值兜底）。
- 新增 IPC 仅增不改，先并存后收敛。


## 8. 测试与验收策略

### 8.1 详情页回归

- 用现有模板执行：parse -> match -> fill -> export 全链路
- 覆盖 `autoFix=true/false`、`copyOnly=true/false`
- 验证输出目录、切片数量、关键文本层填充率

### 8.2 主图回归

- 覆盖尺寸：`800/750/1200/custom`
- 覆盖类型：`click/conversion/white-bg`
- 验证主体在画布安全区、导出文件存在且可打开

### 8.3 质量指标

- 任务成功率
- 自动修复命中率
- 低置信度 slot 占比
- 平均执行耗时（按技能分类）


## 9. 实施顺序建议

1. 先做 Phase A（类型统一）与 Phase B（详情页增强）
2. 再做 Phase C（主图增强）
3. 最后做 Phase D（主进程 QA 服务化）

理由：

- 详情页链路更长，先稳定可最大化收益；
- 主图链路清晰，第二阶段改造风险低；
- QA 服务化放最后，避免前期过早抽象。


## 10. 最终交付定义

满足以下条件即视为“详情页/主图实现完善”：

- 两个现有 skill 在不改 ID 的前提下功能增强完成；
- 文案/结构/导出具备可观测的 QA 结果；
- 新增能力全部向后兼容；
- 代码路径清晰，后续可继续演进到 Planner/Resolver 全服务化架构。
