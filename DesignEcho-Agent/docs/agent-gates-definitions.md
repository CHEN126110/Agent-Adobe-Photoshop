# DesignEcho Agent 门禁定义手册（Gate Definitions）

- 版本：v0（2026-08-04）
- 文档层级：B 层（门禁设计评审、门禁相关故障排查、新增前置检查前必读；不是日常开发入口）
- 维护规则：**修改任何门禁/策略代码时，必须同步更新本手册对应条目**；新增门禁必须先过第 5 节 Checklist
- 权威冲突：本手册与 `AGENTS.md`「workflow 与 agent 的分流判据」「第二条判据」冲突时，以 `AGENTS.md` 为准

## 1. 门禁总则（哲学）

所有门禁的共同出发点：**门禁是保护 Agent 做对，不是限制 Agent 做事**。每条门禁都必须能回答下面五个问题，答不出第 3、4 题的门禁不允许存在。

1. **判据一（唯一答案 vs 开放创意）**：这件事有没有唯一正确答案？
   - 有唯一答案（SKU 组合数量、导出命名、写入前读文档、layerId 有来源、不可逆动作）→ 确定性约束
   - 没有唯一答案（该做什么交付物、怎么做好看、措辞说明）→ 交给模型；硬拦就是重演 2026-07-31「49 次运行 0 次写入」
2. **判据二（确定做不到 vs 不知道能不能）**：拦「确定做不到」可以，拦「不知道能不能做到」不行。能力/状态字段是 `boolean | undefined` 三态：只有 `=== false`（明确否定）允许阻断，unknown 一律放行——预检并不比真实执行知道得更多
3. **出口可达性铁律**：每条拦截必须同时给出可执行的替代路径（改用什么 / 先做什么）。门禁给出的下一步指引必须能真正解除它自己的拦截条件（否则模型撞同一堵墙，被 F-1 熔断）
4. **代价不对称**：判否是彻底阻断且无从诊断；放行最坏只是一次带准确报文的失败。唯一该保守的是不可逆动作（删除、覆盖源文件）
5. **不拦措辞**：门禁禁止匹配「计划/准备/确认」这类关键词决定执行与否——措辞属于模型表达自由，只允许事后验收（warnings / 降级），不允许事前拦截

## 2. 分类与总览

| 分类 | 含义 | 典型成员 |
|------|------|----------|
| S 安全 | 不可逆动作保护 | S-1, S-2 |
| A 授权 | 执行授权 / 意图工具范围 | A-1 ~ A-4 |
| C 确定性约束 | 文档前置 / 读后写 / 目标守卫 / 能力面 | C-1 ~ C-8 |
| D 设计纪律 | 写后观察 / 防重复建档 / 方法论停机 | D-1 ~ D-7 |
| B 预算 | 模型调用 / 工具调用 / 视觉候选 / 时间 | B-1 ~ B-5 |
| F 熔断 | 撞墙停飞（防无限重试） | F-1 |
| E 能力 | 模型能力三态判定 | E-1 |
| V 视觉观察 | v5 视觉前置门禁（未接线） | V-1 |
| N 完成判定 | 降级宣称 / 补救指令（**不拦截执行**） | N-1, N-2 |
| X 业务链路 | 受控工作流内部门禁 / 结果附注 | X-1 ~ X-5 |

| ID | 名称 | 位置 | 拦截点 | 出口 | 风险级 |
|----|------|------|--------|------|--------|
| S-1 | 破坏性工具安全策略 | `src/shared/tool-safety-policy.ts` | closeDocument(不保存)、浏览器 click | 带确认参数重试 / HITL 卡 | 低 |
| S-2 | 人类确认门（HITL） | `src/shared/pending-destructive-action-card.ts` | 同上，剥模型自证参数 | 确认卡重放原始调用 | 低 |
| A-1 | 意图控制面授权签发 | `src/shared/agent-intent-control-plane.ts` | 决定 toolScope / executionAuthorization | 模型重规划 | 中 |
| A-2 | 执行授权不足 | `src/shared/agent-tool-decision-contract.ts` | 写/外部生成工具在 candidate_only 下 | 改用只读工具 | 中（无升级出口） |
| A-3 | 意图范围不含工具 | 同上 | toolScope=none 时整批拦 | 文字回答 | 低（主路径已绕过） |
| A-4 | 裸确认降级 | `src/renderer/services/design-agent/engine.ts` | 裸「继续/开始/可以」写权限降为 candidate_only | 重新明确任务 | 中 |
| C-1 | PS 未连接 | `src/shared/agent-tool-decision-contract.ts` | 需 PS 工具但连接明确断开 | 非 PS 工具继续 | 低 |
| C-2 | 无目标文档 | 同上 | 需文档工具且 hasDocument===false | listDocuments / switchDocument / createDocument | 低 |
| C-3 | 工具未登记分类 / 不在本轮清单 | 同上 | unknown 分类或 unavailable | 换已登记工具 | 低 |
| C-4 | 私有目标守卫 | `src/renderer/services/skill-executors/autonomous-agent.executor.ts` | 写前携带的 documentId/layerId 无效 | 重新读取文档 | 低 |
| C-5 | 新建文档目标边界 | `src/shared/design-document-role.ts` | reuse 状态下 createDocument | 继续定位原目标 | 中（多文档任务） |
| C-6 | 文档写保护 | 同上 + executor | protected / separate_target 文档禁写 | switchDocument / createDocument / openProjectFile | 低 |
| C-7 | 技能可见性/开关 | `src/renderer/services/skill-executors/skill-tools.ts` | visibility 非 user-facing 或显式关闭 | 换能力 | 低 |
| C-8 | 抠图暂停开关 | executor | matte 工具在暂停开关下 | 用户恢复开关 | 低 |
| D-1 | stagePlan 硬校验 | `src/shared/design-discipline-runtime.ts` block-0 | renderLayout 缺合法 stagePlan | 补 stagePlan 重调 | 中（出口无 schema 样例） |
| D-2 | 方法论停机 | 同上 block-1 | 方法论工具重复读 | 自主选择下一步 | 低 |
| D-3 | 连续写入上限 | 同上 block-2 | 写 3 次未复核再写 | 先观察 | **高（非视觉/预算耗尽死锁）** |
| D-4 | 防重复建档 | 同上 block-5 | documentCreated 后再 createDocument | 在当前文档继续 | 中（多文档任务） |
| D-5 | 改后未观察不许导出 | 同上 block-7 | 有未复核改动就保存/导出 | 先针对性观察 | **高（同上死锁）** |
| D-6 | 编辑模式防旁建 | 同上 block-2.2b | 目标品类文档已打开时新建同类文档 | switchDocument 切回 | 低 |
| D-7 | 参考先行 | 同上 block-2.3 | 参考复刻类未消费参考就建画布 | analyzeAssetContent 等 | 低（默认未启用） |
| B-1 | 模型调用预算 | `src/shared/agent-performance-policy.ts` + agent.ts | maxModelCalls 耗尽 | 用户续跑 | 中 |
| B-2 | 工具调用预算 | 同上 | maxToolCalls 耗尽 | 用户续跑 | 低 |
| B-3 | 视觉候选/分析预算 | 同上 | 截图无法被读取 | **无豁免，纪律死锁** | **高** |
| B-4 | 软时间预算 | 同上 | 单 run 超时熔断 | 用户续跑 | 中 |
| B-5 | 迭代上限 | agent.ts maxIterations | 循环轮次耗尽 | 用户续跑 | 中 |
| F-1 | 撞墙熔断 | `src/shared/policy-gate-repeat-guard.ts` | 同一门禁 5 次 → 停止运行 | 如实告知门禁路径问题 | 低（兜底） |
| E-1 | 模型能力三态判定 | `src/shared/model-capability-verdict.ts` | 仅 unsupported 阻断 | 换模型 | 低 |
| V-1 | v5 视觉观察门禁 | `src/shared/agent-runtime-v5/visual-observation-gate.ts` | 无可信视觉观察 → blocked | 4 个恢复动作 | 未接线 |
| N-1 | 完成观察判定 | `src/shared/completion-observation-gate.ts` | mutation 零观察 → 降级 needs_review | 续接补读 | 不拦截 |
| N-2 | 完成契约 + 补救指令 | `src/renderer/services/agent-runtime/task-completion-contract.ts` + `src/renderer/services/agent-policies/design-task-policy.ts` | 缺项 → 补救指令催做 | 按指令继续 | 不拦截 |
| X-1 | 主图受控 QA gate | `src/shared/main-image-controlled-product-qa-gate.ts` | 受控流水线产物 QA 不通过 | 修复后重跑 | 业务链路 |
| X-2 | 袜子策略评审 gate | `src/shared/ecommerce-socks-child-strategy-review-gate.ts` | 子策略评审不通过 | 修订策略 | 业务链路 |
| X-3 | Eagle 写回 gate | `src/shared/eagle-writeback-gate.ts` | 设计学习写回记忆未过审 | 重跑评审 | 业务链路 |
| X-4 | 业务技能预检 gate | `src/shared/business-skill-execution-preflight-gate.ts` | 执行后结果附注（不 gate 执行） | 无 | 附注 |
| X-5 | 恢复执行 gate | `src/shared/agent-resume-execution-gate.ts` | 恢复计划缺白名单/读回/用户批准 | 补全后批准 | 窄链路 |

## 3. 明细定义

### 分类 S：安全（不可逆动作）

**S-1 破坏性工具安全策略**
- 位置：`src/shared/tool-safety-policy.ts`（TOOL_SAFETY_POLICY 表，仅 2 条）
- 拦截行为：`closeDocument` 且 `save !== true`（丢弃未保存修改）；`interactWithBrowserPage` 且 `action === 'click'`（真实浏览器点击可能触发支付/下单/删除/发布）。带对应确认参数（confirmDestructive / confirmSensitiveAction）则放行
- 设计理由：破坏性动作不能零守卫，安全必须全局最外层、与"是不是设计任务"无关（2026-07-08 治理审计）
- 放行边界：`save === true` 的关闭、fill/scroll 浏览器动作、已带确认参数
- 出口：拦截消息说明风险并允许带确认参数重试（自主循环内模型无法自证，见 S-2）
- 判据自检：拦「确定做不到」✅（不可逆，唯一该保守的类别）

**S-2 人类确认门（HITL）**
- 位置：`src/shared/pending-destructive-action-card.ts`（evaluateHumanConfirmationGate）
- 拦截行为：先剥离模型自带的确认参数再裁决——模型在自主循环内永远无法自我确认破坏性动作，命中必出确认卡暂停；用户点「确认执行」由确定性控制器从暂存 payload 重放原始调用（不读模型重建）
- 设计理由：勾选框曾被模型自补确认参数绕过（红线 A），确认目标曾与执行目标不符（红线 B）
- 出口：确认卡（CONFIRM_EXECUTE / CANCEL），出口可达 ✅

### 分类 A：授权

**A-1 意图控制面授权签发**
- 位置：`src/shared/agent-intent-control-plane.ts`（buildAgentIntentControlPlaneDecision）
- 拦截行为：正则分类器输出 requestKind / toolScope（none/read_only/write_photoshop）/ executionAuthorization（none/candidate_only/confirmed_tool_required）。**v3 主路径（有模型）已绕过**：engine 直接签发 autonomous_execution + confirmed（engine.ts buildAutonomousExecutionDecisionForEngine），本分类器只服务无模型降级路径与弱授权入口
- 放行边界：有模型主路径不经过本分类器
- 已知缺口：正则词表不完整（「删掉」漏判真机病例，代码注释自认），无模型路径下会收窄工具面
- 判据自检：⚠️ 词表误判属于「不知道能不能」被折向否定——仅影响降级路径，风险低

**A-2 执行授权不足**
- 位置：`src/shared/agent-tool-decision-contract.ts`（execution_authorization_required）
- 拦截行为：写/外部生成/有状态工具在 `executionAuthorization !== 'confirmed_tool_required'` 时拦截
- 触发入口：AMBIGUOUS_ACTION（"帮我处理一下"）、unrouted_task_like_input、unboundAck 降级后的循环
- 设计理由：弱授权不得升级为写权限（2026-07-07 拆牢笼：candidate_only 只决定"由谁决策"，不授予写权）
- 放行边界：confirmed_tool_required 下不拦截
- 出口：只读工具 + 重规划
- **已知缺陷：无授权升级出口**——模型被拦后没有出卡/确认通道，用户看到"转圈不干活"（见 4.3）

**A-3 意图范围不含工具**
- 位置：同 A-2（intent_scope_disallows_tools）
- 拦截行为：toolScope=none 时整批拦工具
- 放行边界：主路径已签发 write_photoshop，不触发
- 出口：文字回答

**A-4 裸确认降级**
- 位置：`src/renderer/services/design-agent/engine.ts`（unboundAcknowledgement，~3632）
- 拦截行为：detectLightweightIntent 判为 ack/continuation 或命中公开计划确认输入，且无结构化任务身份时，把 confirmed 降为 candidate_only（本轮不恢复历史写权限）
- 设计理由：裸「继续/开始/可以」没有 taskRunId/interactionId，不能凭空复活写权限（防误重放）
- 放行边界：句子带具体新指令（如"继续把标题改成春季新品"）不会被判为 ack——ACK/CONTINUATION 正则以 `$` 结尾
- **已知缺陷：预算熔断后用户最自然的"继续"恰好命中此降级**，长任务续跑即失去写权限（见 4.3）

### 分类 C：确定性约束

**C-1 PS 未连接**
- 位置：`src/shared/agent-tool-decision-contract.ts`
- 拦截行为：`photoshopConnected === false`（明确 false 才拦，unknown 放行）且工具依赖 PS 连接
- 放行边界：不依赖 PS 连接的工具（知识检索、外部生成）不受影响
- 出口：提示打开 UXP 面板建立连接，本轮先用非 PS 工具

**C-2 无目标文档**
- 位置：同 C-1
- 拦截行为：`hasDocument === false`（明确 false）且无文档观察记录，且工具不在指路白名单（createDocument/listDocuments/switchDocument）
- 出口：listDocuments 确认 → switchDocument 切换，或 createDocument 新建；拦截消息明确"读取失败≠没有文档"
- 放行边界：已完成的文档观察（completedToolCalls 里带文档 ID 的结果）可解锁

**C-3 工具未登记分类 / 不在本轮清单**
- 位置：同 C-1（unknown_tool_kind / tool_unavailable）
- 拦截行为：工具未在 `agent-tool-execution-preflight` 登记执行分类，或不在本轮 availableTools
- 设计理由：未登记 = 执行器无对应实现，属于"确定做不到"
- 出口：换已登记工具

**C-4 私有目标守卫（读后写）**
- 位置：`src/renderer/services/skill-executors/autonomous-agent.executor.ts`（readPrivateTargetGuard，~717）
- 拦截行为：写调用若携带 `_privateTargetGuard`，其 expectedDocumentId（正整数）、expectedActiveLayerId、expectedHistoryStateRef 必须来自真实观察工具的结果，否则拦截
- 设计理由：写前必须读过目标文档、layerId 必须有来源（AGENTS.md 核心纪律）
- 放行边界：只读工具、不携带守卫参数的正常调用不受影响；守卫参数在执行边界前剥离、不透传给用户可见层

**C-5 新建文档目标边界**
- 位置：`src/shared/design-document-role.ts`（evaluateCreateDocumentTargetBoundary）
- 拦截行为：当前文档 use 为 reuse（任务目标已绑定当前文档）时 createDocument 被拦（防把同一任务分叉到错误画布）
- 放行边界：none / observe_only / protected / separate_target 均可建
- 出口：继续定位并修改原目标
- **已知缺陷：多交付物长任务（主图+详情页+SKU）targetRole 单一，同角色第二个文档必被拦**（见 4.2）

**C-6 文档写保护**
- 位置：`src/shared/design-document-role.ts`（resolveCurrentDocumentUseMode）
- 位置：`src/renderer/services/skill-executors/autonomous-agent.executor.ts`（current_document_write_protected）
- 拦截行为：用户明确要求保护（protected）或目标角色冲突（separate_target）时禁写当前文档
- 出口：createDocument / switchDocument / openProjectFile 三选一（2026-07-31 修复：observe_only 不再禁写，listDocuments 不再作为指路——曾造成「13 次查看 0 次改动」死锁）

**C-7 技能可见性/开关**
- 位置：`src/renderer/services/skill-executors/skill-tools.ts`
- 拦截行为：`enabled !== false` 才启用（缺省启用 ✅）；visibility 非 user-facing 不暴露
- 出口：无（能力面筛选，模型换能力）

**C-8 抠图暂停开关**
- 位置：executor（isAgentMattingPaused）
- 拦截行为：用户关闭抠图暂停开关时 matte 类工具返回 policyGate
- 出口：用户恢复开关
- 判据自检：用户显式指令，合理 ✅

### 分类 D：设计纪律（通用设计纪律运行时）

- 位置：`src/shared/design-discipline-runtime.ts`（evaluateDesignToolStateGuard，8 条声明式规则）
- 前置：纪律只在设计任务激活（resolveDesignDisciplineContext）；观察类工具永远放行（OBSERVATION 集合）

**D-1 stagePlan 硬校验（block-0）**
- 拦截：renderLayout 未携带通过 validateCreativeStagePlan 校验的 stagePlan（仅 requiresStagePlan 品类：详情页从零设计）
- 理由：让模型声明阶段计划而非直接摆图层（声明式布局引擎纪律）
- 出口：补齐 stagePlan 后同一次 renderLayout 重调
- **已知缺陷：出口消息未附合法 schema 样例**，模型靠猜补格式（见 4.4）

**D-2 方法论停机（block-1）**
- 拦截：方法论工具（getDetailPageDesignFramework 等）读满 1 次后禁止重复读
- 理由：停机约束（读一次别重复读，防空耗）
- 出口：基于已有知识自主选择下一步（指路：getCanvasSnapshot / getDesignProjectState）

**D-3 连续写入上限（block-2）**
- 拦截：needsObservationAfterMutation 且 repairAttemptCount ≥ maxRepairAttempts（3）时拦截所有写工具
- 理由：「不无限微调」——连续写必须停下来看真实画面
- 出口：先做针对性观察（getAnnotatedSnapshot / getCanvasSnapshot）
- **已知缺陷：视觉复核（visualReviewed）是唯一重置路径；非视觉模型或视觉预算耗尽时永不重置 → 写入永久锁死**（见 4.1）

**D-4 防重复建档（block-5）**
- 拦截：documentCreated=true 后再次 createDocument（除非 trustedCreateDocumentAuthorization）
- 理由：幂等保护，防旁建空文档
- 出口：getDocumentInfo 后在当前文档继续
- **已知缺陷：多交付物长任务需建多个文档，被本规则拦截**（见 4.2）

**D-5 改后未观察不许导出（block-7）**
- 拦截：needsObservationAfterMutation 时 saveDocument/quickExport/exportDetailPageSlices/exportMainImageDocuments 等
- 理由：「改后必看」是交付门槛，未复核不许导出
- 出口：针对性观察后再决定保存/重排
- **已知缺陷：同 D-3，非视觉/预算耗尽时导出永久锁死**（见 4.1）

**D-6 编辑模式防旁建（block-2.2b）**
- 拦截：目标品类文档已在前台打开（activeDocumentName 含 canonicalDocumentName）时 createDocument，且无 Harness 结构化授权
- 理由：真机病例（116 层存量详情页旁另建空文档）
- 出口：switchDocument 切回既有文档

**D-7 参考先行（block-2.3）**
- 拦截：requiresReferenceInput 品类（复刻类）未成功消费参考内容就 createDocument
- 理由：外部参考是任务输入，先看参考再开画布（治理 2026-08-01：搜索候选/通用知识不算观察，只认成功消费参考的工具结果）
- 出口：analyzeAssetContent 等参考消费工具
- 放行边界：默认未启用（无品类声明 requiresReferenceInputBeforeDocument）

### 分类 B：预算

- 位置：`src/shared/agent-performance-policy.ts`（profile 默认值）+ `src/renderer/services/agent-runtime/agent.ts`（readPerformanceBudgetExhaustion）
- 档位：detail-page 30 模型调用/70 迭代/30 视觉候选/10 分析/10min；main-image 22/35/4/3/10min；sku-batch 26/50/0/0/10min；general-design 24/60/6/3/10min；默认 skill-workflow 24/120/60 迭代/6/2/6min

**B-1 模型调用预算**：maxModelCalls 耗尽 → `agent_model_call_budget_exhausted`，返回"这稿先做到这里"，任务截断
**B-2 工具调用预算**：maxToolCalls 耗尽，同上
**B-3 视觉候选/分析预算**：`vision_candidate_budget_exhausted` / `visual_analysis_budget_exhausted` → 截图标记 not_observed，**不喂模型**；且预算 0 时整条观察链路跳过（agent.ts ~4866）
**B-4 软时间预算**：softTimeBudgetMs 耗尽 → `agent_soft_time_budget_exhausted`
**B-5 迭代上限**：maxIterations 收紧循环

- **已知缺陷：预算耗尽与设计纪律（D-3/D-5）互锁**——预算限制"能看几次"，纪律强制"必须看"，预算耗尽后观察永不 reviewed，纪律永久锁死写入/导出，无任何豁免机制（见 4.1）

### 分类 F：熔断

**F-1 撞墙熔断**
- 位置：`src/shared/policy-gate-repeat-guard.ts`（POLICY_GATE_REPEAT_BLOCK_LIMIT = 5）
- 拦截行为：同一门禁签名（工具+归一化消息）累计 5 次 → 停止运行并如实告知"门禁给出的下一步指引无法解除拦截条件（出口不可达）"，不把 0 产出包装成完成
- 设计理由：切断"策略否决 → 重试 → 预算空耗"的死循环；把门禁路径问题显式暴露，而不是让模型无限撞墙
- 放行边界：HITL 等待确认（safetyBlock）不算撞墙；真实工具失败不算
- 判据自检：它本身不拦任务，只是暴露"其它门禁出口不可达"——**F-1 每触发一次，都应当被当作上游门禁出口缺陷的报警**（4.5）

### 分类 E：能力

**E-1 模型能力三态判定**
- 位置：`src/shared/model-capability-verdict.ts`（capabilityBlocksExecution）
- 拦截行为：仅 `status === 'unsupported'`（有依据的否定）阻断；unknown 一律放行
- 理由：2026-08-01 四次真机同型事故（能力/连接/写保护/文本误判）根因是 unknown 被折向否定；代价不对称（判否=彻底阻断且无日志，放行=一次带准确报文的失败）
- 唯一出口：capabilityBlocksExecution，禁止调用点自行写 `=== false`
- 放行边界：不可逆动作不走本模块（走 S 类）

### 分类 V：视觉观察（未接线）

**V-1 v5 视觉观察门禁**
- 位置：`src/shared/agent-runtime-v5/visual-observation-gate.ts`（evaluateVisualObservationGate）
- 拦截行为（设计语义）：详情页规划前无可信视觉观察（provenance 齐全 + 素材集指纹匹配）→ planningMode=blocked，不调规划模型
- 现状：**无生产调用方**（仅纯逻辑 + smoke），不影响当前执行
- 未来接入注意：legacy_unverified（有缓存缺 provenance）一律 blocked，存量项目旧缓存全不过门禁；恢复动作（4 个按钮）需确认 UI 完整接线

### 分类 N：完成判定（不拦截执行）

**N-1 完成观察判定**：`src/shared/completion-observation-gate.ts`——有 mutation 但零观察 → 把"宣称完成"降级为 needs_review（终态，不重放任务）；豁免：export-only、单个自验证机械 mutation。只降级宣称，不拦执行
**N-2 完成契约 + 补救指令**：`src/renderer/services/agent-runtime/task-completion-contract.ts`（按任务类型判定缺项）+ `src/renderer/services/agent-policies/design-task-policy.ts`（缺什么催什么：主视觉/文案/复核/交付）。是"推着做"不是"拦"

### 分类 X：业务链路（受控工作流）

**X-1 主图受控 QA gate**
- 位置：`src/shared/main-image-controlled-product-qa-gate.ts`
- 拦截行为：主图受控流水线产物 QA 不通过
- 出口：修复后重跑

**X-2 袜子策略评审 gate**
- 位置：`src/shared/ecommerce-socks-child-strategy-review-gate.ts`
- 拦截行为：ecommerce-socks 编排的子策略评审不通过
- 出口：修订策略

**X-3 Eagle 写回 gate**
- 位置：`src/shared/eagle-writeback-gate.ts`
- 拦截行为：设计学习记忆写回需过审
- 出口：重跑评审

**X-4 业务技能预检 gate**
- 位置：`src/shared/business-skill-execution-preflight-gate.ts`（buildBusinessSkillExecutionPreflightGate）
- 拦截行为：**执行后**结果附注（registry.ts 先执行后 attach），不 gate 执行
- 放行边界：2026-08-04 已把 `contextState[key] !== true` 修正为 `=== false`（未传字段视为 unknown 放行），杜绝未来调用方漏传字段时折向否定
- 出口：无（附注）

**X-5 恢复执行 gate**
- 位置：`src/shared/agent-resume-execution-gate.ts`（buildAgentResumeExecutionGate）
- 拦截行为：恢复计划需白名单+读回目标+用户批准才能执行
- 放行边界：`photoshopWritesAllowed !== false` 是**协议守卫而非三态误判**（2026-08-04 核对结论）：模型恢复计划不得自我授权写入，唯一通过值是显式 false；出口可达（重出计划后由用户批准）。不授予写权限，不影响常规执行
- 出口：补全计划后批准

## 4. 门禁之间的交互与已知问题

### 4.1 【高】预算 × 纪律互锁（B-3 × D-3/D-5）——已修复（2026-08-04）
非视觉模型（无视觉专家）或视觉预算耗尽时：截图标记 not_observed → visualReviewed 恒 false → needsObservationAfterMutation 永不重置 → 写入第 4 次起被 D-3 永久拦截、保存/导出被 D-5 永久拦截，无降级出口。最终由 F-1 以"出口不可达"熔断。
**修复（2026-08-04）**：运行层视觉复核确实不可用（not_observed 且 reason ∈ {no_visual_capability / vision_candidate_budget_exhausted / visual_analysis_budget_exhausted / visual_expert_invalid_review / visual_expert_failed}）时，成功调用结构复核工具（`isStructuralDesignReviewTool`：图层/文本/蒙版/布局读回等，排除纯图像快照）也计入复核证据，纪律据此重置写后观察状态——结构读回是无视觉运行时模型唯一可用的复核手段，纪律不应把写入/导出永久锁死。实现：`shared/design-discipline-runtime.ts`（isStructuralDesignReviewTool / isRuntimeVisualReviewBlocked）+ `autonomous-agent.executor.ts`（resolveVisualReviewedForDiscipline，三处共用）。

### 4.2 【中】多交付物长任务 × 防重复建档（C-5/D-4）——已修复（2026-08-04）
"做主图+详情页+SKU"三连：targetRole 单一（inferDesignDocumentRoleFromTaskText 先到先得）→ 同角色第二个文档 createDocument 必被拦。
**修复（2026-08-04）**：新增 `inferDesignDocumentRolesFromTaskText` 多角色集合；多交付物任务（集合 >1）中，当前文档不再按单一 targetRole 收敛为 reuse——除非用户明确"就地修改当前文档"，一律按 separate_target 处理（createDocumentTargetBoundary 放行 + block-5 trusted 授权随之生效），每个新建文档都是独立交付目标。实现：`shared/design-document-role.ts`（targetRoles 贯穿 resolveCurrentDocumentUseMode / buildDocumentRoleInstruction）。

### 4.3 【中】预算熔断 × 续跑降级（B-1/B-4 × A-4）——文案缓解，根治待立项
熔断后用户说"继续" → A-4 把写权限降为 candidate_only → 续跑写不了；且纪律状态不跨 run 保留。
**缓解（2026-08-04）**：预算熔断消息（agent.ts readPerformanceBudgetExhaustion）明确指导用户"重新描述完整任务"而非单独回复"继续"（单独"继续"不会恢复本轮写入权限）。v5 runtime session 路径已有 reflexion handoff 续跑机制（buildPerformanceBudgetContinuationHandoff），v3 普通路径暂无。
**根治方向（待立项）**：熔断输出结构化 resume token（纪律状态 + confirmed 授权），"继续"消费它恢复执行。

### 4.4 【中】D-1 出口缺 schema 样例
stagePlan 格式校验失败后，拦截消息没有给出合法 schema 示例，模型靠猜补格式 → 反复撞墙 → F-1 熔断。**修复方向：出口消息附合法 stagePlan 样例**

### 4.5 【低】F-1 是其它门禁出口缺陷的报警
F-1 每触发一次都代表上游某条门禁"出口不可达"。排查流程：从 F-1 消息里的 toolName+门禁说明 → 找到上游门禁 → 检查其出口是否真的能解除拦截条件。

## 5. 新增/修改门禁的评审 Checklist

新增任何前置检查前，逐条回答（全部通过才允许合入）：

1. [ ] 拦的是「做错」还是「说错」？拦说错 → 降级为事后验收（warnings），不许事前拦截
2. [ ] 有没有唯一正确答案？没有 → 交给模型，不设确定性约束
3. [ ] 状态字段是三态吗？`=== true / === false` 收敛时第三种是否被折向否定？unknown 一律放行
4. [ ] 拦截的下一步指引能否解除它自己的拦截条件？（出口可达性）
5. [ ] 与预算（B 类）是否互锁？预算耗尽后这条门禁会不会永久锁死？
6. [ ] 与长任务（多交付物）是否冲突？会不会拦掉合理流程中的第 2 个目标？
7. [ ] 被拦后模型/用户有没有可执行的恢复路径（重试、换路、确认卡）？
8. [ ] 拦截结果是否带 machine-readable code + 人话 reason + 关联对象？（错误可诊断性）
9. [ ] 是否更新本手册对应条目？
10. [ ] 是否跑过 `npm run maintenance:validate` 与相关 smoke？
