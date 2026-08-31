# DesignEcho Agent 门禁定义手册

> 文档类型：B 层安全与执行边界说明。
> 当前开发权限：修改 preflight、Policy、事务、完成或 Release 约束时按需读取。
> 适用范围：模型能力、目标 / revision、权限、副作用、交互、交付和停止条件。
> 不能覆盖：Prompt、CurrentTask、Design Agent OS、当前代码和真实 Host 事实。

更新日期：2026-08-31

## 1. 门禁的职责

门禁只用于阻止可以明确证明的错误或不安全动作。它不负责：

- 理解开放设计目标；
- 选择 Skill、素材、构图、比例、文案或下一 Tool；
- 强迫所有任务执行固定观察 /规划 /评价顺序；
- 通过助手措辞判断任务是否完成；
- 用历史事故类比当前事实；
- 把模型的可逆专业判断升级为用户确认。

一个检查只有同时满足以下条件才能成为前置门禁：

1. 有明确 owner 和结构化输入；
2. 能证明放行会造成真实错误、越权或不可接受副作用；
3. 有可达恢复出口，或失败本身就是必须停止的安全边界；
4. 不依赖品类关键词、文件名、助手措辞或审美分数；
5. 不复制已有 TaskRun、Capability、Policy、Transaction、Verification 或 Release owner。

否则它应当是 warning、事后 Evaluation、开发诊断或删除候选。

## 2. unknown 必须按对象处理

“unknown 一律放行”与“unknown 一律阻断”都不正确。

| unknown 对象 | 默认处理 | 原因 |
|---|---|---|
| 模型或环境是否支持某个可逆能力 | 允许一次受控真实尝试 | 预检通常不比真实 Provider 更了解能力。 |
| Photoshop 写入目标、document / revision、授权、不可逆副作用 | 先观察、reconcile 或 fail closed | 错目标和未知写状态可能破坏用户数据。 |
| Tool 分类或 Provider identity | fail closed | 未知执行语义不能获得权限。 |
| 可选知识、参考、审美分数 | 降级或 warning | 缺少这些不等于不能制作首稿。 |
| 用户独占商品事实 /品牌取舍 | 必要时 `waiting_user` | Model 和 Harness 都不能代替用户补造。 |
| 已派发 mutation 的结果 | 一次 operation-specific reconciliation，禁止重放 | 可能已经产生真实副作用。 |

## 3. 当前门禁类别

| ID | 名称 | 位置 | 保护对象 | 拦截条件 | 恢复出口 |
|---|---|---|---|---|---|
| S-1 | 破坏性动作安全 | `src/shared/tool-safety-policy.ts` | 未保存文档、外部动作 | 缺真实用户批准 | 绑定目标的 HITL |
| S-2 | 确定性人工确认 | `src/shared/pending-destructive-action-card.ts` | 已暂存破坏性调用 | 模型自证或确认身份不匹配 | 用户确认后重放原调用 |
| C-1 | Tool 能力与执行预检 | `src/shared/agent-tool-execution-preflight.ts` | Tool 分类、权限、目标 | unknown Tool 或执行条件不成立 | 装载能力、补观察或停止 |
| C-2 | Capability Session | `src/renderer/services/agent-runtime/capability-session.ts` | 模型可见能力面 | 能力未激活、denied 或 unavailable | 精确能力请求 |
| X-1 | Photoshop 单一事务 | `../DesignEcho-UXP/src/core/photoshop-transaction-runner.ts` | Host mutation | stale target、取消、失败或验真不成立 | rollback / reconciliation |
| N-1 | 交互 owner 与无进展 | `src/shared/agent-interaction-owner-policy.ts` | revision-bound interaction | owner / fingerprint 不一致或重复提问 | 同 TaskRun 回到 Agent 重规划 |
| F-1 | 任务完成事实 | `src/renderer/services/agent-runtime/task-completion-contract.ts` | 执行、复核、交付义务 | 结构化义务未闭合 | 有界补做、待复核或诚实停止 |

**S-1 破坏性动作安全**

- 位置：`src/shared/tool-safety-policy.ts`
- 边界：只保护不可逆或高风险副作用，不接管设计路线。

**S-2 确定性人工确认**

- 位置：`src/shared/pending-destructive-action-card.ts`
- 边界：模型不能自行生成批准；确认必须绑定原始目标和 payload。

**C-1 Tool 能力与执行预检**

- 位置：`src/shared/agent-tool-execution-preflight.ts`
- 边界：unknown Tool /副作用失败关闭；可选设计知识 unknown 不在这里升级为执行阻断。

**C-2 Capability Session**

- 位置：`src/renderer/services/agent-runtime/capability-session.ts`
- 边界：只管理模型可见能力，不授予真实执行权限。

**X-1 Photoshop 单一事务**

- 位置：`../DesignEcho-UXP/src/core/photoshop-transaction-runner.ts`
- 边界：管理单次 Host mutation、读回、取消和回滚，不决定业务目标或审美。

**N-1 交互 owner 与无进展**

- 位置：`src/shared/agent-interaction-owner-policy.ts`
- 边界：验证交互身份和停滞事实，不替 Agent 选择下一步。

**F-1 任务完成事实**

- 位置：`src/renderer/services/agent-runtime/task-completion-contract.ts`
- 边界：只消费结构化义务和结果，不能从助手乐观措辞补造完成。

### 3.1 能力与 Provider

- Capability 必须已登记、类型匹配并在当前 Session 可见；
- 可见不等于授权，真正执行继续经过 preflight；
- 未知 Tool 分类不执行；
- 模型可用性未知可以做不扩大权限的可逆探针；
- Skill Provider / interaction owner 不匹配时失败关闭，通用卡不能旁路。

### 3.2 用户授权与不可逆动作

- 关闭未保存文档、覆盖文件、外部发布、支付、删除和其它不可逆动作需要明确批准；
- 模型不能通过参数自证用户已经确认；
- 确认必须绑定真实 payload、目标身份和 expected revision；
- 用户确认后确定性重放暂存动作，不让模型重建另一个动作。

### 3.3 Photoshop 目标与 revision

- mutation 必须绑定有效 document / layer 与写前 revision；
- 外部变化使 revision 失效时重新观察、等待、显式接管或停止；
- 不能从文档名、文件名、活动图层位置或历史回复猜目标；
- 外部 dirty 文档可以存在，但不能获得写入、保存或关闭授权；
- 同一文档的第二写者必须等待或被拒绝。

### 3.4 Transaction 与 unknown write

- Photoshop 写入只经唯一 `PhotoshopTransactionRunner` 或仍未迁移的明确 legacy 边界；
- 新工具不得另建 modal、重试、rollback 或跨调用事务 owner；
- 已 applied 但 verification 失败不等于未执行；
- ambiguous mutation 只允许一次同操作 reconciliation，禁止自动重放；
- 失败不能在半完成状态上继续叠加写入。

### 3.5 staged 生产契约

- staged Skill 可以要求确定性 Brief、规格、卡片和节点；
- 阶段推进只能来自模型声明经 validator 校验、真实观察、operation result、DesignVerdict 和真实交付；
- 普通 Tool success、UI 卡片、assistant 文本或关键词不能推进阶段；
- agentic 不受 R1 / R3 / R4 写入门票约束，仍受所有通用执行安全约束。

### 3.6 无进展和预算

- 重复读取、重复 Knowledge、同一快照、换标题和换理由不算进展；
- 同一 blocker + progress key 的恢复必须有次数上限；
- 预算不得在需要 mutation 的任务中耗尽至少一次写后读回和最终评价所需供给；
- 只读 /建议任务不能因执行供给策略被强迫写入；
- 无恢复路径时 checkpoint、waiting、abort 或诚实停止，不持续换措辞重试。

### 3.7 完成、质量和交付

- `executionApplied`、`executionVerified`、`designVerdict`、`deliveryReady` 和 `userAccepted` 分别记账；
- Tool success、文件存在、模型文本和自动高分都不能补造其它层；
- 审美 finding 通常进入有界修订或 `review_required`，不成为 agentic 首稿写入门票；
- 目标 /权限 /事实 /结构 /必需交付物的确定性错误可以拒绝 Release；
- 用户接受只能来自用户明确动作。

## 4. Interaction Gate

只有以下情况可以打断用户：

1. 信息只能由用户提供；
2. 不同答案会实质改变用户可见结果；
3. 当前环境和项目中无法安全取得；
4. 不是低影响、可逆的专业判断；
5. staged Skill 明确声明该生产输入为确定性必需项。

Agent 已回答的同一 `decisionFingerprint` 在没有 plan、mutation、revision 或其它真实进展时不得再次询问。Harness 只报告 `interaction_no_progress`，下一路线仍由 Agent 重规划。

## 5. 新增或修改门禁 Checklist

1. 它防止的错误是否可以被结构化证明？
2. owner 是否已经存在？
3. unknown 的对象到底是什么？
4. 是否误用关键词、文件名、模型措辞或审美分数？
5. 是否会阻止安全、可逆的 Agent 尝试？
6. 是否有明确恢复出口？
7. 是否同时覆盖成功、失败、unknown、stale revision 和重复提交？
8. 是否会把 staged 规则扩散到 agentic？
9. 是否新增第二状态、第二事务或第二完成 owner？
10. 删除该检查后，哪个真实错误会失去保护？如果回答不出来，应删除而不是强化。

## 6. 验证

门禁修改至少需要：

```text
npm run test:design-authorship-boundary
npm run audit:agent-business-boundaries
npm run maintenance:validate
```

自动验证只能证明规则与代码边界。真实 Photoshop 目标、弹窗、unknown write、等待恢复和用户交互仍需要隔离 E2E。
