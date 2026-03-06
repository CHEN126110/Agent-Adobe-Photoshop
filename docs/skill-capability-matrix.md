# DesignEcho 技能能力真值表

> 更新时间: `2026-03-06`
> 目标: 作为“是否保留 / 是否下线 / 是否继续补齐”的统一依据

## 1. 结论摘要

当前技能系统不能只看 `skill-declarations.ts`。

真实可用性要同时满足 4 层：

1. 已声明 skill
2. 有 executor
3. 能被 unified-agent 稳定路由到
4. 底层工具或 IPC 能完成执行

基于当前代码，结论如下：

1. 已声明技能: `12`
2. 已有 executor 的技能: `12`
3. 有规则级直接路由兜底的技能: `7`
4. 本轮已从技能层下线的技能: `4`

补充说明：

1. 模型路由层会看到全部 `SKILL_REGISTRY`，因为 [unified-agent.service.ts](/C:/UXP/2.0/DesignEcho-Agent/src/renderer/services/unified-agent.service.ts) 会把全部 skills 注入系统提示词。
2. 但如果 skill 没有 executor，模型即使选中了，也会在执行阶段失败。
3. 本轮已修正一批 `requiredTools` 元数据，后续判断应以当前文件和 executor 为准。

## 2. 真值表

| Skill ID | 已声明 | Executor | 规则路由 | 工具支撑 | 当前判断 | 建议 |
|------|------|------|------|------|------|------|
| `matte-product` | 是 | 是 | 是 | 完整 | 核心闭环 | 保留 |
| `smart-layout` | 是 | 是 | 否 | 完整 | 可用但非主链路 | 保留，先作为内部能力 |
| `sku-config` | 是 | 是 | 否 | 完整 | 可用但偏预处理 | 保留，限制为准备动作 |
| `sku-batch` | 是 | 是 | 是 | 完整 | 核心闭环 | 保留 |
| `shape-morphing` | 是 | 是 | 否 | 完整 | 条件可用 | 保留 |
| `layout-replication` | 是 | 是 | 是 | 完整，链路较复杂 | 关键能力，链路较复杂 | 保留 |
| `design-reference-search` | 是 | 是 | 否 | 完整 | 可用但非主链路 | 保留为内部辅助能力 |
| `visual-analysis` | 是 | 是 | 否 | 完整，主要走 IPC | 条件可用 | 保留 |
| `find-and-edit-element` | 是 | 是 | 是 | 完整 | 核心闭环 | 保留 |
| `agent-panel-bridge` | 是 | 是 | 是 | 主要走 IPC/MCP | 调试专用闭环 | 保留，但不应作为普通用户功能 |
| `main-image-design` | 是 | 是 | 是 | 完整 | 核心闭环，待测试加强 | 保留 |
| `detail-page-design` | 是 | 是 | 是 | 完整，含特殊工具链 | 核心闭环，链路最复杂 | 保留 |

## 3. 核心技能

下面这些技能已经具备“声明 + executor + 路由 + 底层执行”的主闭环：

1. `matte-product`
2. `sku-batch`
3. `find-and-edit-element`
4. `main-image-design`
5. `detail-page-design`

补充：

1. `layout-replication` 也已进入规则路由，但它依赖分析、模板蓝图、自动填充等复杂链路，维护风险比上面 5 个更高。
2. `agent-panel-bridge` 是调试链路，不应和普通业务技能混看。

## 4. 已下线技能

以下技能已在本轮从 `SKILL_REGISTRY` 中移除，不再对模型层暴露：

1. `harmonize`
2. `beautify-layout`
3. `add-text`
4. `diagnose-design`

说明：

1. 下线的是 skill 声明层，不是底层工具层。
2. 像 `harmonizeLayer` 这类底层能力仍然保留，供其他核心闭环技能复用。
3. 如果未来要恢复，必须先补齐 executor，再重新注册到技能层。

## 5. 本轮已修正的元数据

以下 4 个技能的 `requiredTools` 已在本轮按真实执行路径修正：

1. `shape-morphing`
   - `shapeMorphing` -> `morphToShape`
2. `layout-replication`
   - 从旧的抽象工具名改为当前真实执行链
3. `design-reference-search`
   - `searchDesignReferences` / `fetchDesignReference`
   - 修正为 `searchDesigns` / `fetchWebPageDesignContent`
4. `visual-analysis`
   - 修正为 `getCanvasSnapshot` + `visual:*` IPC 分析入口

后续如果 executor 再变化，必须同步更新声明层元数据。

## 6. 路由现状

在 [unified-agent.service.ts](/C:/UXP/2.0/DesignEcho-Agent/src/renderer/services/unified-agent.service.ts) 中，当前有明确规则级兜底的技能主要是：

1. `matte-product`
2. `agent-panel-bridge`
3. `main-image-design`
4. `layout-replication`
5. `detail-page-design`
6. `find-and-edit-element`
7. `sku-batch`

这意味着：

1. 其余技能更多依赖模型决策，而不是稳定规则命中。
2. 非主链路技能在实际使用中的稳定性会明显弱于上面这 7 项。

## 7. 第一批动作建议

建议按下面顺序执行，而不是直接拆大文件：

1. 把 `smart-layout`、`sku-config`、`visual-analysis`、`design-reference-search` 标记为“内部辅助能力”，不要和核心闭环技能混为一谈
2. 回写 `docs/project-status.md`，让状态和代码一致
3. 后续如需恢复已下线技能，必须遵循“先 executor，后声明”的顺序

## 8. 推荐分组

### A. 核心保留

1. `matte-product`
2. `sku-batch`
3. `find-and-edit-element`
4. `main-image-design`
5. `detail-page-design`
6. `layout-replication`

### B. 内部辅助

1. `smart-layout`
2. `sku-config`
3. `shape-morphing`
4. `visual-analysis`
5. `design-reference-search`
6. `agent-panel-bridge`

### C. 已下线

1. `harmonize`
2. `beautify-layout`
3. `add-text`
4. `diagnose-design`
