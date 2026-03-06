# DesignEcho Agent 功能梳理（基于代码）

更新时间：2026-03-04  
范围：`DesignEcho-Agent`（不含 `DesignEcho-UXP`）

## 1) 当前“主链路”能力（完整可用）

这些能力在代码里具备“入口 + 决策 + 执行”完整闭环：

- 对话式统一 Agent 主入口（`processWithUnifiedAgent`）  
  参考：`src/renderer/services/unified-agent.service.ts:896`
- 闲聊/身份/能力问答优先模型回复（非硬编码）  
  参考：`src/renderer/services/unified-agent.service.ts:145`, `:220`, `:910`
- 主业务 6 大技能均可被规则路由命中并执行：
  - `matte-product`（抠图）`unified-agent.service.ts:283`
  - `layout-replication`（参考图拆解/复刻）`unified-agent.service.ts:294`
  - `detail-page-design`（详情页）`unified-agent.service.ts:311`
  - `main-image-design`（主图）`unified-agent.service.ts:328`
  - `find-and-edit-element`（元素定位编辑）`unified-agent.service.ts:337`
  - `sku-batch`（SKU 批量）`unified-agent.service.ts:349`
- Chat 侧已走统一 Agent 执行  
  参考：`src/renderer/components/ChatPanel.tsx:1180`, `:1421`
- 基础工具层完整（工具声明 + 执行入口）  
  参考：`src/renderer/services/tool-executor.service.ts:29`, `:577`

## 2) 已实现但“非主链路优先”的能力（部分完成）

这些技能有 executor，但规则兜底不优先命中，更多依赖模型决策：

- `smart-layout`
- `shape-morphing`
- `visual-analysis`
- `design-reference-search`

依据：
- executor 已注册：`src/renderer/services/skill-executors/index.ts:34-50`
- 规则兜底只明确覆盖 6 个核心技能：`unified-agent.service.ts:283-349`

结论：功能本身在，但入口策略不统一，用户感知不稳定。

## 3) 残余能力（建议“废弃或补全二选一”）

`SKILL_REGISTRY` 里声明了，但没有对应 executor：

- `harmonize`
- `beautify-layout`
- `add-text`
- `sku-config`
- `diagnose-design`

依据：
- 声明位置：`src/shared/skills/skill-declarations.ts:98`, `:157`, `:181`, `:214`, `:376`
- registry 汇总：`src/shared/skills/skill-declarations.ts:596`
- 缺失时会直接报 `Skill executor not implemented`：`src/renderer/services/skill-executors/index.ts:101`

结论：这 5 个属于“对外可见但不可稳定执行”的残余项。

## 4) 架构残余（影响可维护性）

### 4.1 双决策体系并存（统一 Agent + 旧置信度路由）

- 统一 Agent 已作为主执行链路：`ChatPanel.tsx:1421`
- 但 `useChatActions` 仍保留大段“任务类型 + 置信度 + 模型路由”旧逻辑：  
  `src/renderer/hooks/useChatActions.ts:1498`, `:1609`, `:2317`, `:2327`

风险：逻辑重复、定位问题成本高、体验一致性差。

### 4.2 旧消息协议字段仍在

- `Message` 仍保留 `executionTrace/designPlan/designIntent`：  
  `src/renderer/stores/app.store.ts:53-55`
- 消息解析器仍保留“设计计划/执行追踪”块渲染逻辑：  
  `src/renderer/components/message/parser.ts:617`, `:685`, `:692`, `:776`

风险：技术化 UI 容易回流，后续维护成本高。

### 4.3 未被引用的 UI 组件（残留）

代码检索仅发现定义，未发现业务引用：

- `CustomSelect.tsx`
- `DesignerSettings.tsx`
- `MemorySettings.tsx`
- `SkillsPanel.tsx`

结论：可归档或删除，减少维护面。

## 5) 结构化清单（给“废除/完善”决策）

### A. 建议保留并继续完善（核心主链路）

- `matte-product`
- `main-image-design`
- `detail-page-design`
- `layout-replication`
- `sku-batch`
- `find-and-edit-element`

### B. 建议补到主链路或降级为内部能力

- `smart-layout`
- `shape-morphing`
- `visual-analysis`
- `design-reference-search`

### C. 二选一（尽快收口）

- 直接废弃：`harmonize`, `beautify-layout`, `add-text`, `sku-config`, `diagnose-design`
- 或补齐 executor 并补测试，再保留

## 6) 建议执行顺序（最小风险）

1. 先做“能力面收口”：确定 C 类是删还是补。  
2. 再做“架构收口”：合并/下线 `useChatActions` 的旧置信度决策逻辑。  
3. 最后做“协议收口”：彻底移除 `designPlan/executionTrace` 旧字段与渲染分支。  

