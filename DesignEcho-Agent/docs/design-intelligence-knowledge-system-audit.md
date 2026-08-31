# Design Intelligence 知识系统独立审计与 Provider 路线建议

> 文档类型：D 层历史专项审计。
> 当前开发权限：不能直接指导当前开发；问题须按当前代码重新核实。
> 适用范围：知识系统早期 Phase 0–6 声明与 Provider 路线评估。
> 不能覆盖：Prompt、CurrentTask、Plan、Status、Design Agent OS 和当前生产事实。

结论很明确：**不能接受 Trae CN 当前“Phase 0–6 已完成”的说法。**

更准确的工程状态是：

> 已搭出一批契约、适配器、纯函数和自证型测试，但尚未形成生产级知识系统闭环；其中至少有 4 个高风险问题会造成知识治理绕过、审计数据失真或 Markdown 知识文件被覆盖。

我这次保持了只读审计，没有修改 Trae 的任何代码。

## 先澄清 Obsidian 的定位

你的修正判断是合理的，但不需要因此放弃 Obsidian。

官方信息可以确认：

- Obsidian 桌面应用采用专有许可，不是开源桌面应用；官方保留应用代码权利。[Obsidian 许可说明](https://obsidian.md/license)
- 但 Vault 数据默认保存在本地，内容归用户所有，并且官方明确强调使用开放文件格式，防止数据被产品锁定。[Obsidian Manifesto](https://obsidian.md/about)
- Obsidian 还公开了插件 API 类型和示例插件，适合作为扩展性很好的个人知识编辑器。[官方示例插件](https://github.com/obsidianmd/obsidian-sample-plugin)

因此我建议把路线定成：

```text
Markdown + YAML + 本地附件
        │
        │ 开放知识协议 / Human Source of Truth
        ▼
DesignEcho Markdown Vault Provider
        │
        ├── Obsidian：默认推荐编辑器
        ├── VS Code：可替代编辑器
        ├── Typora：可替代编辑器
        └── 其他 Markdown 工具
```

也就是说：

- 不把 DesignEcho 绑定到 Obsidian 应用内部；
- 不依赖 Obsidian 私有数据库或未公开实现；
- 兼容 Obsidian 的目录、Markdown、YAML、双链和附件约定；
- Obsidian 是优秀的默认个人知识管理界面，但不是 DesignEcho Runtime；
- DesignEcho 维护的索引、Task Context、使用轨迹、候选知识都必须是可重建投影，不是第二份知识正文真相源。

这其实比原路线图更稳妥。原路线图自己也提出了“Source of Truth 与 Runtime Projection 分离”，见[路线图第 6 行](C:/UXP/2.0/DesignEcho-Agent/docs/design-intelligence-knowledge-system-roadmap-draft.md:6)和[Obsidian Source → Runtime Projection](C:/UXP/2.0/DesignEcho-Agent/docs/design-intelligence-knowledge-system-roadmap-draft.md:188)。

不过，仓库当前更权威的知识重构报告已经进一步明确：应该建设 **provider-neutral Knowledge Plane**，而不是 Obsidian 专属知识系统，见[重构报告的实施边界](C:/UXP/2.0/DesignEcho-Agent/docs/design-knowledge-system-reconstruction-report.md:6)、[唯一 Catalog Repository](C:/UXP/2.0/DesignEcho-Agent/docs/design-knowledge-system-reconstruction-report.md:532)和[明确禁止第二 Context Compiler](C:/UXP/2.0/DesignEcho-Agent/docs/design-knowledge-system-reconstruction-report.md:1077)。

## 审计总评级

| 模块 | Trae 声明 | 实际审计状态 | 判断 |
|---|---|---|---|
| Phase 0 契约地基 | 完成 | 类型和纯契约较齐，但未收敛到现有唯一 Owner | 部分完成 |
| Phase 1 Task Context Builder | 完成 | 已接运行时，但建立了第二条上下文链；正文、固定引用、硬约束均未真正接入 | 不通过 |
| Phase 2 Markdown/Obsidian 适配 | 完成 | 有解析、监听、原子写函数，但存在覆盖已有文件风险，且没有生产初始化和双向同步闭环 | 不通过 |
| Candidate Gate | 完成 | 只是调用者传字符串声明身份，无法证明用户真的确认过 | 不通过 |
| Phase 3–6 纯逻辑契约 | 完成 | 只能算原型；多处判断逻辑与注释、路线图目标不一致 | 原型阶段 |
| 命题状态机测试 | 完成 | 测试通过，但测试直接替用户执行 `confirm`，没有验证授权来源 | 假闭环 |
| Runtime 持久化 | 完成 | Store 能在测试临时目录落盘，但没有被主进程、IPC、Agent 或 UI 实际初始化 | 未接入 |
| 新知识库 UI | 计划优化 | 页面仍使用旧数据结构和旧 Service，没有消费新的 KnowledgeNode、Candidate、Store | 尚未开始真实接线 |

仓库共享状态其实已经明确写了：当前只是 M4 前置研究，Catalog、索引、检索评测等 K1–K6 **不能宣称完成**，见[Status.md 的知识库重构状态](C:/UXP/2.0/DesignEcho-Agent/project-memory/Status.md:103)和[尚未完成的边界](C:/UXP/2.0/DesignEcho-Agent/project-memory/Status.md:111)。

因此 Trae 这次还有一个流程问题：**在权威 Plan 尚未激活 K1–K6 生产实施前，直接把 Draft 路线图的 Phase 0–6 代码塞进了生产路径。**

## P0：必须先修复的问题

### 1. 新增了第二条 Context Compiler 路径

这是最严重的架构问题。

现有正确链路已经具备：

- 用户显式选择知识；
- `sourceRevision`；
- `contentFingerprint`；
- `freshness`；
- `allowedUses`；
- 有界正文摘要；
- 用途边界；
- 提交时重新校验。

这些字段都在[KnowledgeSelectionReference](C:/UXP/2.0/DesignEcho-Agent/src/shared/knowledge-selection-context.ts:107)中，创建引用时会经过治理选择，见[createKnowledgeSelectionReference](C:/UXP/2.0/DesignEcho-Agent/src/shared/knowledge-selection-context.ts:180)。最终由现有 Operating Context 注入正文、版本和用途边界，见[operating-context-snapshot.ts](C:/UXP/2.0/DesignEcho-Agent/src/shared/agent-runtime-v5/operating-context-snapshot.ts:685)。

Trae 新增的路径却是：

```text
autonomous-agent.executor
    → TaskContextBuilder
    → CompositeKnowledgeService
    → result-mapper
    → 直接构造 RuntimeContextItem
    → 注入 autonomous loop
```

接入点在[autonomous-agent.executor.ts:3091](C:/UXP/2.0/DesignEcho-Agent/src/renderer/services/skill-executors/autonomous-agent.executor.ts:3091)。

这条路径存在三个问题：

1. 绕过唯一 Context Compiler；
2. 丢失原知识结果的治理绑定；
3. 又在执行器里把结果标成 `governed_knowledge + current`。

尤其危险的是，映射器把所有结果无条件映射成 `validated`，见[result-mapper.ts:35](C:/UXP/2.0/DesignEcho-Agent/src/renderer/services/design-intelligence/adapters/result-mapper.ts:35)，然后把所有 Provider 又统一标成 `builtin`，见[result-mapper.ts:65](C:/UXP/2.0/DesignEcho-Agent/src/renderer/services/design-intelligence/adapters/result-mapper.ts:65)。

这会丢掉：

- 原始 Provider 身份；
- 来源版本；
- 内容 fingerprint；
- 生命周期；
- `allowedUses`；
- usage snapshot；
- Web/Eagle 的时效与撤回信息。

随后执行器又把这个降级后的摘要声明成：

```ts
trust: 'governed_knowledge',
freshness: 'current'
```

见[autonomous-agent.executor.ts:3108](C:/UXP/2.0/DesignEcho-Agent/src/renderer/services/skill-executors/autonomous-agent.executor.ts:3108)。

这不是简单的“字段没完善”，而是**把已经被弱化的结果重新宣称为受治理知识**。

修复方向不是再加字段兜底，而是：

- 取消执行器里的直接 Task Context 注入；
- 让 Task Context 作为现有 `runtime-context-compiler.ts` 的一个 Provider；
- 复用现有 `KnowledgeSelectionReference` 或未来唯一 Catalog binding；
- Agent、UI、Manifest、用户固定引用都只能消费同一个版本绑定。

### 2. Task Context 没有把知识正文交给模型

`knowledgeToContextItem()` 只保存：

- `resourceId`
- `node.title`

见[task-context-builder.ts:77](C:/UXP/2.0/DesignEcho-Agent/src/renderer/services/design-intelligence/task-context-builder.ts:77)。

虽然 `result-mapper` 把 `result.summary` 暂时放入 `node.scope`，但 Builder 没有使用它。最终注入摘要只是：

```text
- 资源 ID：知识标题
```

见[compileTaskContextSummary](C:/UXP/2.0/DesignEcho-Agent/src/renderer/services/design-intelligence/task-context-builder.ts:114)。

因此当前所谓“Task Context 已接入知识”实际上只让模型看到知识 ID 和标题，没有看到：

- 知识正文；
- 为什么适用；
- 不适用边界；
- 证据；
- 版本；
- 来源；
- 用户声明的用途；
- 已复核洞察。

这无法达到 Phase 1 的目标。UI 卡片可能会显示“已经使用知识”，但模型实际上没有读到那条知识。

### 3. Task Context 没接现有用户固定引用，也没有硬约束

执行器调用 Builder 时写死：

```ts
pinnedReferenceIds: undefined
```

见[autonomous-agent.executor.ts:3100](C:/UXP/2.0/DesignEcho-Agent/src/renderer/services/skill-executors/autonomous-agent.executor.ts:3100)。

但现有 Workbench 已经维护了用户显式选择的引用，见[DesignAgentWorkbench.tsx:99](C:/UXP/2.0/DesignEcho-Agent/src/renderer/components/DesignAgentWorkbench.tsx:99)。

同时快照里又把：

```ts
hardConstraints: []
```

写死，见[task-context-builder.ts:196](C:/UXP/2.0/DesignEcho-Agent/src/renderer/services/design-intelligence/task-context-builder.ts:196)。

结果是：

- 页面上用户确实选了知识；
- 现有 Operating Context 能看到；
- 新 Task Context 卡片却可能显示没有用户固定内容；
- 新 Task Context 自己检索的内容又会自动注入；
- 同一次任务存在两个不同版本的“本次任务知识上下文”。

这是典型的多真相源问题。

### 4. 所有 Agent 任务都会自动先搜索知识和 Eagle

Builder 每次都会并行执行：

```ts
knowledge.search(...)
assets.search(...)
```

见[task-context-builder.ts:159](C:/UXP/2.0/DesignEcho-Agent/src/renderer/services/design-intelligence/task-context-builder.ts:159)。

Eagle 适配器还强制传入 `{ enabled: true }`，见[eagle-library-asset-service.ts:67](C:/UXP/2.0/DesignEcho-Agent/src/renderer/services/design-intelligence/eagle-library-asset-service.ts:67)，默认超时是 8 秒，见[eagle-readonly-knowledge.ts:114](C:/UXP/2.0/DesignEcho-Agent/src/shared/eagle-readonly-knowledge.ts:114)。

这意味着：

- 普通寒暄；
- 只读查询；
- 已经有明确素材的机械任务；
- 不需要参考的简单生产任务；

都可能在模型启动前多等一次 Eagle 调用。

这直接违反当前项目的核心任务约束：参考、知识、项目搜索只能在能改变当前决策时使用，不能成为所有任务的统一前置，见[CurrentTask.md:33](C:/UXP/2.0/DesignEcho-Agent/project-memory/CurrentTask.md:33)和[CurrentTask.md:47](C:/UXP/2.0/DesignEcho-Agent/project-memory/CurrentTask.md:47)。

正确做法是：

- 用户显式固定的知识始终进入；
- Task Profile/Manifest 声明必需知识时进入；
- 模型或 Planner 判断需要参考时才检索；
- 无需参考的任务不调用 Eagle；
- 检索失败不能阻断明确可执行任务。

### 5. Markdown/Obsidian 写回存在覆盖已有文件的数据丢失风险

冲突判定代码是：

```ts
if (!input.expectedHash || input.expectedHash === input.diskHash) {
    return { conflict: false, reason: 'no_change' };
}
```

见[obsidian-vault-adapter.ts:166](C:/UXP/2.0/DesignEcho-Agent/src/shared/design-intelligence/obsidian/obsidian-vault-adapter.ts:166)。

这意味着：

```text
磁盘已有同名文件
+ 调用者没有传 expectedHash
= 判定无冲突
= 原子 rename 覆盖原文件
```

我直接调用真实纯函数复现，结果是：

```json
{"conflict":false,"reason":"no_change"}
```

测试输入是：

```ts
{
  diskExists: true,
  diskHash: 'external-note-hash',
  expectedHash: undefined
}
```

这与路线图“新文件必须是磁盘不存在；磁盘已存在且无法证明基线一致必须冲突”的要求相反。

更危险的是实际写入层随后直接临时文件加 rename，见[obsidian-vault-service.ts:82](C:/UXP/2.0/DesignEcho-Agent/src/main/services/design-intelligence/obsidian-vault-service.ts:82)。

应改成：

- `diskExists=true && expectedHash缺失`：拒绝写入，返回 `baseline_required`；
- 新建文件必须使用独占创建语义，避免 TOCTOU；
- 更新必须有读取时的 revision/hash；
- 写前重新读取并验证；
- 冲突只允许进入 Diff/Review，不自动覆盖；
- `readNote` 的权限错误、编码错误不能伪装成“文件不存在”。

### 6. 注释声称 SHA-256，实际只是 32 位哈希

代码注释写的是：

> 稳定 contentHash（SHA-256 十六进制）

见[obsidian-vault-adapter.ts:143](C:/UXP/2.0/DesignEcho-Agent/src/shared/design-intelligence/obsidian/obsidian-vault-adapter.ts:143)。

实际实现却返回 8 位十六进制字符串，本质是一个截断到 32 位的 FNV 风格哈希：

```ts
return (hash >>> 0).toString(16).padStart(8, '0');
```

见[obsidian-vault-adapter.ts:147](C:/UXP/2.0/DesignEcho-Agent/src/shared/design-intelligence/obsidian/obsidian-vault-adapter.ts:147)。

它不适合承担文件冲突、版本完整性和正文身份判断。这里应该使用 Node `crypto.createHash('sha256')`，并明确 canonicalization 规则。

## P1：生产闭环没有成立

### 7. Candidate Gate 可以被任意调用者伪造

Candidate Review 请求由调用者直接传：

```ts
reviewer: 'user' | 'authorized_controller' | 'agent'
```

见[candidate-review.ts:20](C:/UXP/2.0/DesignEcho-Agent/src/shared/design-intelligence/candidate-review.ts:20)。

函数只检查这个字符串：

```ts
if (reviewer === 'agent') ...
```

见[candidate-review.ts:46](C:/UXP/2.0/DesignEcho-Agent/src/shared/design-intelligence/candidate-review.ts:46)。

任何调用者都可以传：

```ts
reviewer: 'user'
```

函数无法证明：

- 用户是否真的点击了接受；
- UI 事件属于哪条 Candidate；
- Candidate revision 是否仍然相同；
- 是否来自合法窗口；
- 是否存在一次性确认凭证；
- 是否已经被其他任务修改。

`candidateCanReachValidated()` 更是只检查可变对象上的：

```ts
candidate.decision === 'accepted'
```

见[candidate-review.ts:85](C:/UXP/2.0/DesignEcho-Agent/src/shared/design-intelligence/candidate-review.ts:85)。

正确 Gate 必须由主进程 Owner 执行，并消费不可伪造的确认收据，例如：

```text
candidateId
candidateRevision
decision
actor=user
sourceMessageId / UI action id
issuedAt
consumedAt
one-time token
```

模型和 renderer 只能提交“请求复核”，不能自行构造“用户已确认”的事实。

### 8. 命题状态机的 `user_confirmed` 同样没有用户身份

`PropositionDecision` 里只有：

```ts
'confirm'
```

没有 actor、confirmation receipt 或 revision，见[proposition-ledger.ts:45](C:/UXP/2.0/DesignEcho-Agent/src/shared/design-intelligence/proposition-ledger.ts:45)。

任何调用者执行：

```ts
advanceProposition(prop, 'confirm', now)
```

就能得到 `user_confirmed`，见[proposition-ledger.ts:55](C:/UXP/2.0/DesignEcho-Agent/src/shared/design-intelligence/proposition-ledger.ts:55)。

现有测试也是直接调用 `confirm`，然后断言“用户确认后生成候选”，并没有真实用户动作。

另外，`createPropositionFromSignals()` 在命题刚建立时就把 External Signal 映射成 `EvidenceRef`，见[proposition-ledger.ts:123](C:/UXP/2.0/DesignEcho-Agent/src/shared/design-intelligence/proposition-ledger.ts:123)。这削弱了路线图自己强调的：

```text
Signal → Evidence → Candidate → Review → Knowledge
```

因为现在 Signal 在进入命题时已经被包装成 Evidence，没有独立的证据验证阶段。

### 9. Context 审计把“检索到”误记成“实际使用”

视觉结果只要被 Builder 检索出来，就立即产生：

```ts
type: 'visual_reference_used'
```

见[context-audit.ts:53](C:/UXP/2.0/DesignEcho-Agent/src/shared/design-intelligence/context-audit.ts:53)。

而这些事件在 Agent 正式执行前就被记录，见[autonomous-agent.executor.ts:3122](C:/UXP/2.0/DesignEcho-Agent/src/renderer/services/skill-executors/autonomous-agent.executor.ts:3122)。

所以未来指标会错误地认为：

- 检索到 = 被模型读过；
- 被模型读过 = 进入策略；
- 进入策略 = 影响设计结果。

至少应拆成：

```text
retrieved
eligible
selected_for_context
content_loaded
used_in_plan
used_in_execution
cited_in_output
user_pinned
```

只有真实有消费者证据时才能记为 `used`。

### 10. Task Context 的审计身份可能全部坍缩成 `task`

Builder 使用：

```ts
runtimeParams.taskRunId || runtimeParams.runId || 'task'
```

见[autonomous-agent.executor.ts:3100](C:/UXP/2.0/DesignEcho-Agent/src/renderer/services/skill-executors/autonomous-agent.executor.ts:3100)。

但稳定的 TaskRun identity 在更后面才签发，见[autonomous-agent.executor.ts:3348](C:/UXP/2.0/DesignEcho-Agent/src/renderer/services/skill-executors/autonomous-agent.executor.ts:3348)。

实际上 ChatPanel 已经为每次请求传入稳定 `requestId`，见[ChatPanel.tsx:4477](C:/UXP/2.0/DesignEcho-Agent/src/renderer/components/ChatPanel.tsx:4477)，但新 Builder 没有使用它。

结果可能是多个普通首轮任务都得到：

```text
taskId = task
snapshotId = tc-task
```

未来使用轨迹、Context Inspector 和 Eval 会串任务。

### 11. Runtime 持久化层还不是 Runtime

`IntelligenceDb`、`KnowledgeIndexStore`、`RelationStore`、`LearningEventStore` 和 `KnowledgeSyncStore` 目前只有类定义和测试。

我检查了生产代码引用：

- 没有主进程实例初始化；
- 没有 IPC handler；
- 没有 preload API；
- 没有 Agent 消费；
- 没有 UI 消费；
- 没有与 Markdown Vault 扫描器联动；
- 没有与 Task Context Builder 联动。

因此“运行时持久化层完成”更准确的表达应是：

> 已实现可单独测试的 Store 原型，但尚未进入应用 Runtime。

而且当前 Store 只覆盖了少数集合，路线图要求的以下状态仍未落盘：

- Candidate Knowledge；
- Task Context；
- Context Items；
- Knowledge Usage Events；
- External Signals；
- Proposition Ledger；
- 持久化 Sync State；
- Index State。

### 12. 持久化文件损坏时会静默清空并覆盖

`IntelligenceDb.read()` 遇到 JSON 解析或读取错误时：

```ts
return {};
```

见[intelligence-db.ts:86](C:/UXP/2.0/DesignEcho-Agent/src/main/services/design-intelligence/intelligence-db.ts:86)。

随后下一次事务会把这个空对象重新写回，见[intelligence-db.ts:59](C:/UXP/2.0/DesignEcho-Agent/src/main/services/design-intelligence/intelligence-db.ts:59)。

也就是说：

```text
运行时 JSON 部分损坏
→ 记录 warning
→ 假装数据库为空
→ 下一次写操作覆盖原文件
```

正确做法应是：

- 读取失败进入 `corrupt` 状态；
- 原文件隔离到带时间戳的 quarantine；
- 禁止普通事务继续覆盖；
- 如果全部数据都是可重建投影，则明确执行 rebuild；
- Candidate、Review、使用轨迹等不可重建数据必须单独恢复；
- 文件 schema 必须带版本和迁移策略。

### 13. Sync State 只在内存里

`KnowledgeSyncStore` 使用：

```ts
private readonly entries = new Map(...)
```

见[knowledge-sync-store.ts:33](C:/UXP/2.0/DesignEcho-Agent/src/main/services/design-intelligence/knowledge-sync-store.ts:33)。

应用重启后：

- `lastSeenHash` 丢失；
- `pendingContent` 丢失；
- 无法判断磁盘文件是新文件、外部修改还是本端待写；
- 双向同步的冲突基线失效。

这与“Runtime 持久化层已经完成”矛盾。

### 14. 文件监听器不能可靠区分新增、删除和重命名

类型声明了：

```ts
create | change | delete | rename
```

但实际只发出：

```ts
rename | change
```

见[obsidian-file-watcher.ts:55](C:/UXP/2.0/DesignEcho-Agent/src/main/services/design-intelligence/obsidian-file-watcher.ts:55)。

同时递归监听失败时只监听根目录一层，见[obsidian-file-watcher.ts:65](C:/UXP/2.0/DesignEcho-Agent/src/main/services/design-intelligence/obsidian-file-watcher.ts:65)，而推荐 Vault 本身就是多级目录。

正确实现不能只依赖 `fs.watch` 的事件名称，应当：

- 监听事件只作为“目录可能发生变化”的提示；
- 去抖后对受影响路径或目录重新 stat/rescan；
- 通过前后 Catalog snapshot 判断 create/change/delete/rename；
- 应用启动、恢复焦点、监听溢出时支持全量 reconciliation；
- `.obsidian`、临时文件、附件和受控目录有明确过滤规则。

## P2：Phase 3–6 的纯逻辑仍有明显业务错误

### Candidate Merge

`isMergeable()` 的注释说“同 kind、同任务领域”，实际却返回：

```ts
sameKind || taskOverlap
```

见[candidate-merge.ts:33](C:/UXP/2.0/DesignEcho-Agent/src/shared/design-intelligence/candidate-merge.ts:33)。

问题包括：

- `domains` 完全没参与判断；
- 任务类型通过标题或正文是否包含字符串判断；
- 使用 `OR`，而不是注释表达的复合约束；
- `planCandidateMerge()` 没有调用 `isMergeable()`；
- 可以直接为 pending/rejected 候选生成合并计划；
- KnowledgeNode 没有正式正文，只能拿 `title + scope` 拼“合并正文”，可能丢掉原知识内容。

### Conflict Detection

所谓推断冲突只是检查一条是否包含：

```text
禁止 / 不得 / 避免 / must not / never
```

另一条是否不包含，见[conflict-detection.ts:53](C:/UXP/2.0/DesignEcho-Agent/src/shared/design-intelligence/conflict-detection.ts:53)。

`thresholdRatio` 参数没有实际使用。

这会把大量不相关但同任务、同领域的规则误判成冲突。按路线图分工，代码只应做：

- 显式 `contradicts` 关系；
- 作用域交集；
- 版本冲突；
- 同一 ID/revision 矛盾；
- 确定性结构冲突。

语义上“这两条规则是否真正矛盾”应交给模型生成候选，再由用户确认，不能靠是否包含否定词。

### Repeated Pattern

注释声称“被接受且重复发生才沉淀”，实际代码只排除了 `accepted === false`，因此 `accepted === undefined` 也会进入统计，见[repeated-pattern.ts:56](C:/UXP/2.0/DesignEcho-Agent/src/shared/design-intelligence/repeated-pattern.ts:56)。

另外：

- 同一 Task 的多个事件会被当成多个独立任务；
- 没有按 `taskId` 去重；
- 规范化几乎是完整中文短语精确匹配，轻微换词就不能合并；
- ID 使用 `Date.now()`，纯函数不再确定；
- 文件中已经定义了 `isAccepted()`，但实际没有调用，说明实现和意图发生了漂移。

## 为什么测试全绿仍然不可信

我运行了：

- `npm run audit:design-intelligence`：41 项通过；
- `npm run test:proposition-ledger`：14 项通过；
- `npm run test:intelligence-stores`：7 项通过；
- `npm run build:typecheck:renderer`：主进程和渲染进程类型检查通过。

这些结果证明：

- 文件可编译；
- 纯函数能按作者当前写法运行；
- Store 能在临时目录完成基本读写。

但不证明运行闭环正确。

具体漏测包括：

1. Obsidian 冲突测试只覆盖“hash 相同”和“hash 不同”，没有覆盖“磁盘存在但 expectedHash 缺失”，见[audit-design-intelligence.cjs:282](C:/UXP/2.0/DesignEcho-Agent/scripts/audit-design-intelligence.cjs:282)。
2. Context Audit 的测试反而要求检索结果产生 `visual_reference_used`，把错误语义写成了通过条件，见[audit-design-intelligence.cjs:210](C:/UXP/2.0/DesignEcho-Agent/scripts/audit-design-intelligence.cjs:210)。
3. Candidate Gate 测试自己传 `reviewer: 'user'`，没有验证用户身份来源，见[audit-design-intelligence.cjs:305](C:/UXP/2.0/DesignEcho-Agent/scripts/audit-design-intelligence.cjs:305)。
4. 命题状态机测试自己调用 `confirm`，没有确认凭据，见[audit-design-intelligence.cjs:455](C:/UXP/2.0/DesignEcho-Agent/scripts/audit-design-intelligence.cjs:455)。
5. Store 测试只覆盖正常写入和重开读取，没有覆盖损坏恢复、跨实例并发、进程崩溃、schema migration。
6. `test:proposition-ledger` 和 `test:intelligence-stores` 没有进入核心验证，只纳入了 `audit:design-intelligence`，见[run-core-validation.cjs:13](C:/UXP/2.0/DesignEcho-Agent/scripts/run-core-validation.cjs:13)。

因此这批测试更像“作者实现自洽检查”，不是“产品验收测试”。

## UI 审计结论

UI 目前不能开始“最终重设计”，因为数据层还没有收敛。

### 现有页面值得保留的部分

从代码结构看，现有知识库已经有一些正确基础：

- 来源筛选；
- current/review/disabled/superseded/expired 生命周期；
- 修订、剔除、恢复；
- 显式加入本次任务；
- 加入时声明“构图、风格、配色、文案、商品事实、强制规则、禁止项”等用途；
- 版本、新鲜度和来源显示；
- Eagle 参考明确提示“元数据候选不等于 Agent 已看过原图”。

例如现有用户任务引用区在[KnowledgeLibraryPage.tsx:417](C:/UXP/2.0/DesignEcho-Agent/src/renderer/components/KnowledgeLibraryPage.tsx:417)，用途选择器在[KnowledgeLibraryPage.tsx:477](C:/UXP/2.0/DesignEcho-Agent/src/renderer/components/KnowledgeLibraryPage.tsx:477)。

这些不应该推倒重做。

### 当前页面仍使用旧模型

页面的数据源仍然是：

- `DesignMemoryItem`
- `DesignKnowledgeResult`
- `KnowledgeLibraryService`
- `MemoryService`

见[KnowledgeLibraryPage.tsx:27](C:/UXP/2.0/DesignEcho-Agent/src/renderer/components/KnowledgeLibraryPage.tsx:27)和[KnowledgeLibraryPage.tsx:109](C:/UXP/2.0/DesignEcho-Agent/src/renderer/components/KnowledgeLibraryPage.tsx:109)。

它没有消费 Trae 新增的：

- `KnowledgeNode`
- `CandidateKnowledge`
- `IntelligenceDb`
- `KnowledgeIndexStore`
- `RelationStore`
- `KnowledgeSyncStore`
- `Proposition`
- `ExternalSignal`

当前导航也只有：

```text
知识资产
复核中心
```

见[KnowledgeLibraryPage.tsx:57](C:/UXP/2.0/DesignEcho-Agent/src/renderer/components/KnowledgeLibraryPage.tsx:57)。

所以现在重画 UI 只会出现一个结果：**新界面外壳继续读取旧 Service，而新 Runtime Store 继续没有消费者。**

### Task Context 卡片不是 Context Inspector

Task Context 卡片在任务执行完成后才作为 `interactiveCards` 返回，见[autonomous-agent.executor.ts:3798](C:/UXP/2.0/DesignEcho-Agent/src/renderer/services/skill-executors/autonomous-agent.executor.ts:3798)。

组件只渲染只读列表，见[TaskContextCardView.tsx:31](C:/UXP/2.0/DesignEcho-Agent/src/renderer/components/message/blocks/TaskContextCardView.tsx:31)。

虽然 Props 里有 `onAction`，但组件没有使用。用户不能：

- 在执行前检查本次上下文；
- 查看原始来源；
- 固定或移除条目；
- 修改用途；
- 查看为什么命中；
- 区分 retrieved 和 used；
- 发现版本过期或冲突。

它目前只是一个“事后收据”，还不是路线图要求的 Context Inspector。

### 推荐的信息架构

等唯一 Catalog 和 Query Gateway 接通后，知识库 UI 建议收敛为五个一级入口：

1. **探索**

   视觉案例和知识资产的统一浏览入口。默认视觉网格/瀑布流，支持任务、设计维度、品牌、品类、来源、状态和版权筛选。

2. **本次任务上下文**

   在 Agent 执行前展示用户固定内容、自动候选、硬约束、项目状态和排除项。用户可固定、移除、改用途，并看到“为什么进入/为什么没进入”。

3. **复核收件箱**

   审核 Candidate、重复经验、External Signal 和 Proposition。必须展示来源 TaskRun、revision、原始证据、模型提炼、观察/推断区分、适用边界以及接受/修改/拒绝/合并/替代结果。

4. **来源与同步**

   管理 Markdown Vault、Obsidian 兼容状态、Eagle、内置知识、Web Provider。展示同步状态、最后扫描、冲突、失效源和重建进度。

5. **健康与评测**

   展示过期、撤回、重复、冲突、孤立节点、缺少审核、索引待重建，以及版本化 Query Set 的 Recall/Precision/NDCG。

关系图只放在单条知识的 Inspector 里作为局部二级视图，不要把全库关系图做成首页。仓库已有重构报告也明确给出了同样结论，见[UI 当前缺口](C:/UXP/2.0/DesignEcho-Agent/docs/design-knowledge-system-reconstruction-report.md:319)、[关系图只做二级视图](C:/UXP/2.0/DesignEcho-Agent/docs/design-knowledge-system-reconstruction-report.md:812)和[Review Inbox 要求](C:/UXP/2.0/DesignEcho-Agent/docs/design-knowledge-system-reconstruction-report.md:824)。

### UI 视觉审计证据限制

本轮尝试通过本地浏览器预览进入知识库页面，但浏览器预览没有 Electron 项目上下文，只停留在项目欢迎页；没有创建项目或修改用户数据来绕过这个边界。因此：

1. **进入知识库页面：阻塞**

   健康度：未完成实机视觉验收。缺少 Electron 项目状态，无法获得本轮有效截图。

2. **搜索和筛选：仅代码审计**

   健康度：结构较完整，但没有验证真实焦点顺序、加载状态、键盘操作和不同结果密度。

3. **加入本次任务：仅代码审计**

   健康度：现有用途选择和移除语义较好，但与新 Task Context 不一致。

4. **Candidate Review / Markdown 同步：未形成可操作流程**

   健康度：不通过。新 Candidate Gate、冲突 Diff、来源同步和 Health 没有接入现有页面。

因此我不会凭历史截图宣称完成了当前版本的视觉、响应式或可访问性审计。完整审计输出就在本条回复中，本轮没有创建额外审计文件。

## 建议的修复顺序

### 第一阶段：先止住数据和治理风险

必须先修：

- 已有 Markdown 文件在缺失 expectedHash 时禁止覆盖；
- 内容哈希改为 SHA-256；
- 读取失败不能伪装成文件不存在；
- Runtime 文件损坏不能静默清空；
- Candidate/User Confirmation 改成主进程签发和消费的确认收据；
- `retrieved` 与 `used` 分离。

### 第二阶段：收敛唯一知识 Owner

建立：

```text
Markdown Vault / Eagle / Builtin / Web / Memory View
                    │
                    ▼
          Main Process CatalogRepository
                    │
                    ▼
             Knowledge Query Gateway
              │                  │
              ▼                  ▼
        Agent Context       Knowledge UI
              │
              ▼
      唯一 Runtime Context Compiler
```

删除或改造当前的第二条直接注入链：

```text
TaskContextBuilder
→ autonomous-agent.executor
→ RuntimeContextItem
```

Task Context Builder 可以保留，但必须变成唯一 Context Compiler 的 Provider，而不是第二个 Compiler。

### 第三阶段：完成 Markdown Vault 纵切

先只证明一条真实链：

```text
用户在 Obsidian / VS Code 修改 Markdown
→ Watcher / Reconciliation 检出
→ Catalog revision 更新
→ Query Gateway 返回相同 stable ID/revision
→ UI 看见新版本
→ Agent 取得同一 revision
→ Task Context 记录 content_loaded / selected / used
```

同时验证：

- 外部修改不覆盖；
- 文件删除会撤回 Catalog；
- 应用重启不丢 Sync State；
- Projection 可全部重建；
- Candidate/Review/Usage 等不可重建数据不会随索引重建丢失。

### 第四阶段：再接 Candidate、关系和学习循环

Candidate、Proposition、Repeated Pattern 只有在以下条件成立后再进入生产：

- 有真实持久化 Store；
- 有主进程 Owner；
- 有 IPC；
- 有 Review Inbox；
- 有 actor/revision/receipt；
- 有冲突和撤回；
- 有真实 TaskRun evidence；
- 有核心验证和端到端测试。

### 第五阶段：最后重设计 UI

此时 UI 才能成为 Catalog 和 Query Gateway 的薄客户端，而不是再维护一份 React/localStorage 真相。

验收条件至少应包括：

- Agent 和 UI 对同一查询得到同一个 ID、revision、lifecycle；
- 已撤回、过期、superseded、invalid 知识进入 Planner 的数量为 0；
- 用户固定知识和自动检索知识在 Task Context 中明确区分；
- 不需要知识或 Eagle 的任务不发生自动搜索；
- 每条“使用过的知识”都有 `content_loaded` 和实际消费者证据；
- Markdown 外部修改绝不静默覆盖；
- UI 能定位原始文件、revision、命中原因和排除原因；
- 新测试全部进入核心验证，而不是作为单独可选命令存在。

下一步请先让 Trae 停止继续扩张 Phase 3–6 和知识库 UI，按上述 P0 顺序提交一条“Markdown Vault → 主进程 Catalog → 唯一 Context Compiler → Agent/UI 同一 revision”的真实纵切；这条纵切通过前，不接受“知识库改造已完成”的声明。



------------------------------------------------------------


关于借鉴 SiYuan


我的建议很明确：

> **借鉴 SiYuan，但不要把 SiYuan 作为 DesignEcho 知识库的技术底座；同时也不能保持 Trae 当前实现原样不动。**
>
> 正确路线是：继续建设 DesignEcho 自己的 provider-neutral Knowledge Plane，以开放的 Markdown/YAML 作为第一种作者源；学习 SiYuan 的块级组织、反向链接、历史版本、属性视图和交互方式；未来再把 SiYuan 做成可选 Provider。

这不是折中，而是对你们项目风险和目标最合理的选择。

## 为什么“SiYuan 开源”不等于“更适合做底座”

SiYuan 确实很值得研究：

- 完全开源，许可证为 AGPL-3.0；
- Go Kernel + TypeScript 前端，前后端边界清楚；
- 本地优先；
- 块级引用、双向链接、反向链接；
- 属性视图/数据库；
- SQLite/FTS 搜索；
- 文档、块、属性、SQL、搜索都有本地 HTTP API；
- API 默认运行在 `127.0.0.1:6806`，支持 Token 鉴权；
- 可以导出标准 Markdown；
- 有版本、历史、同步、插件和命令行能力。

这些都可以从[SiYuan 官方仓库](https://github.com/siyuan-note/siyuan)和[官方 API 文档](https://github.com/siyuan-note/siyuan/blob/master/API.md)确认。

但它有一个关键点：**SiYuan 的原生知识数据并不是普通 Markdown 文件。**

官方 FAQ 明确说明，文档实际存储在 `.sy` 文件中，数据格式是 JSON；Markdown 是编辑语法和导出格式，不是原生持久化真相源。[SiYuan 数据存储说明](https://github.com/siyuan-note/siyuan#how-does-siyuan-store-data)

这意味着：

```text
Obsidian
闭源应用 + 开放 Markdown 数据

SiYuan
开源应用 + 与 SiYuan Kernel 深度耦合的 .sy JSON 数据
```

所以不能简单得出：

> SiYuan 开源，因此比 Obsidian 更适合成为 DesignEcho 知识库底层。

对 DesignEcho 而言，真正重要的不是“编辑器代码是否开源”，而是：

- 知识数据是否长期可读；
- 是否能脱离第三方应用继续使用；
- 是否有稳定 ID、revision 和来源；
- 能否被 DesignEcho 自己重建索引；
- 是否允许 UI、Agent、后台任务共享同一份知识版本；
- 是否会引入许可证和产品耦合。

在这些方面，直接把 SiYuan Kernel 或 `.sy` 数据库作为 DesignEcho 核心，并不优于 Markdown Vault。

## 我不建议直接集成或复用 SiYuan 源代码

SiYuan 使用 AGPL-3.0。AGPL 是强 copyleft 许可证，对修改、组合和网络交互场景有额外源代码提供要求。[GNU AGPL 官方说明](https://www.gnu.org/licenses/agpl)

如果把 SiYuan 的前端组件、Kernel、编辑器实现直接复制、链接或深度集成进 DesignEcho，可能触发较大的许可证合规问题。具体是否形成组合程序是法律问题，通常与链接方式、进程边界和数据交换深度有关；GNU FAQ 也明确区分了“独立程序通过标准管道/API 通信”和“共享复杂内部结构形成一个组合程序”。[GNU 许可证 FAQ](https://www.gnu.org/licenses/gpl-faq.en.html)

因此，我的工程建议是：

- 可以学习产品设计和公开架构；
- 可以按自身需求重新实现相同类型的交互；
- 可以未来通过公开 HTTP API 连接用户独立运行的 SiYuan；
- 不复制 SiYuan 源码；
- 不把 SiYuan 前端直接嵌入 DesignEcho；
- 不把 SiYuan Kernel 打包成 DesignEcho 的内部依赖；
- 不直接读写 `.sy` 文件；
- 若将来确实要深度集成，先做正式许可证评估。

这不是说 AGPL 不能用，而是你们当前 DesignEcho 的发布模式和商业目标尚未明确到足以承担这个依赖。

## 哪些 SiYuan 能力非常值得借鉴

### 1. 块级稳定身份

SiYuan 最值得借鉴的不是界面，而是“内容块有稳定 ID”。

DesignEcho 的知识不应只有：

```ts
{
  title: string;
  summary: string;
}
```

更合理的是：

```ts
interface KnowledgeBlock {
    blockId: string;
    assetId: string;
    blockType: 'claim' | 'rule' | 'method_step' | 'boundary' | 'example' | 'counterexample';
    content: string;
    sourceRevision: string;
    parentBlockId?: string;
    evidenceRefs: string[];
}
```

这样才能做到：

- 引用具体规则，而不是整篇文档；
- 只更新某个边界条件；
- 追踪 Agent 真正加载了哪个内容块；
- 将正例、反例、方法步骤和限制条件分开；
- 生成可靠的引用轨迹和变更 Diff。

但我不建议第一阶段把 DesignEcho 做成完整块编辑器。

更合理的是：

```text
作者仍编辑 Markdown 文档
        ↓
DesignEcho 解析标题、列表、标记块
        ↓
生成稳定的派生 KnowledgeBlock
```

也就是说，块是 DesignEcho 的运行时派生表示，不强迫用户接受全新的文件格式。

### 2. 双向链接和反向引用

SiYuan 的反向链接非常适合知识系统，但 DesignEcho 应把关系限制在有业务价值的类型：

```text
supports
contradicts
supersedes
example_of
counterexample_of
applies_to
requires_observation
derived_from
used_by_task
```

UI 里打开一条知识时，可以显示：

- 哪些案例支持它；
- 哪些反例限制它；
- 哪个新版本替代它；
- 哪些任务实际使用过它；
- 哪些设计结果因它被修改；
- 哪些候选正在尝试更新它。

不需要第一期复制 SiYuan 的全库知识图谱。你们仓库已有重构报告也明确建议关系图只做选中知识的二级视图，见[design-knowledge-system-reconstruction-report.md](C:/UXP/2.0/DesignEcho-Agent/docs/design-knowledge-system-reconstruction-report.md:812)。

### 3. 属性视图

SiYuan 的 Attribute View/Database 很适合借鉴到 DesignEcho 的复核界面。

Candidate Review 不应该只是卡片流，可以有表格视图：

| 候选 | 来源任务 | 类型 | 状态 | 证据 | 适用范围 | 操作 |
|---|---|---|---|---|---|---|
| 主体占比规则 | TaskRun A | 规则更新 | 待复核 | 4 条 | 主图 | 接受/修改/合并 |
| 字号层级经验 | TaskRun B | 重复模式 | 继续观察 | 2 条 | 详情页 | 查看证据 |
| 平台规范变更 | 外部信号 | 研究命题 | 有冲突 | 3 个来源 | 小红书 | 解决冲突 |

这比现在单纯的“复核卡片”更适合管理规模化知识。

### 4. 文档、块、搜索、索引分层

SiYuan 的架构中，编辑器、Kernel、索引、API 是分开的。这个思想应该借鉴。

DesignEcho 应收敛为：

```text
Markdown Vault / Builtin / Eagle / Web / Memory View
                         │
                         ▼
              Catalog Repository
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
       派生块与关系索引        版本和治理元数据
              │                     │
              └──────────┬──────────┘
                         ▼
               Knowledge Query Gateway
                  │                │
                  ▼                ▼
             Agent Context      Knowledge UI
```

这和你们仓库已有的 provider-neutral 方案一致，见[唯一 Catalog 的建议](C:/UXP/2.0/DesignEcho-Agent/docs/design-knowledge-system-reconstruction-report.md:532)。

### 5. 本地 Kernel/API 思路

SiYuan 通过本地 API 暴露块、属性、搜索、SQL 等能力，这个边界值得学习。

DesignEcho 也应该由主进程提供窄接口：

```text
searchKnowledge
getKnowledge
getKnowledgeRevision
listBacklinks
listCandidates
reviewCandidate
getSyncStatus
resolveConflict
```

Renderer 不直接读文件，也不自己维护 canonical knowledge。

但是不要照搬 SiYuan 的通用 SQL API给模型。DesignEcho 的 Agent 不应该直接查询任意 SQLite 表，而应该只调用语义稳定的 Knowledge Service。

## 哪些部分绝对不要借鉴

以下内容我不建议从 SiYuan 搬到 DesignEcho：

### 不采用 `.sy` 作为知识真相源

因为它会让知识数据绑定 SiYuan Kernel。即使代码开源，DesignEcho 仍然需要理解和追随 SiYuan 内部数据模型的升级。

### 不复制完整块编辑器

DesignEcho 是 Photoshop 设计 Agent，不是第二个通用笔记软件。完整块编辑器会严重扩大维护范围：

- 光标和选区；
- 输入法；
- 表格；
- 嵌套列表；
- Undo/Redo；
- 粘贴；
- Markdown 转换；
- 协同；
- 插件；
- 移动端；
- 复杂排版。

这些不会直接提高 Agent 的设计能力。

### 不复制同步和版本仓库

SiYuan 官方明确不建议用第三方同步盘直接同步其工作区，否则可能造成数据损坏。这也说明它的工作区不是普通独立 Markdown 文件集合。[SiYuan 数据同步说明](https://github.com/siyuan-note/siyuan#does-it-support-data-synchronization-through-a-third-party-sync-disk)

DesignEcho 不需要重做一套类似 SiYuan 的同步仓库。第一阶段只需要：

- 本地文件；
- revision/hash；
- 原子写；
- 冲突 Diff；
- 历史快照；
- 可重建索引；
- 用户手动备份或 Git 兼容。

### 不采用它的通用 AI 问答层

SiYuan 的 AI 面向通用个人知识管理；DesignEcho 的知识必须进入：

- 当前设计任务；
- Task Profile；
- Photoshop 当前文档；
- Product Truth；
- Design Strategy；
- Execution Plan；
- Verification。

你们真正需要的是“知识怎样影响设计决策”，不是“针对笔记问答”。

## 是否应该保留现在的实现

不能原样保留。

但也不需要全部推倒。

### 可以保留

- `KnowledgeNode` 等通用契约的思路；
- `EvidenceRef`；
- Typed Relations；
- Candidate 概念；
- Markdown/YAML 解析器；
- Task Context Snapshot 类型；
- Store 的接口形式；
- 现有知识库 UI 的视觉风格和生命周期展示；
- 原子写、文件监听的总体方向。

### 必须重做或收敛

- `TaskContextBuilder` 直接注入 autonomous executor；
- 所有任务自动检索 Eagle；
- `CompositeKnowledgeService` 丢失治理字段；
- 所有结果自动标记 `validated/current`；
- Obsidian 特定命名和架构绑定；
- 缺少 expectedHash 仍允许覆盖；
- 伪 SHA-256；
- 调用者自报 `reviewer: 'user'`；
- `confirm` 没有用户确认凭据；
- JSON Store 损坏后静默清空；
- 与主进程、IPC、UI 完全没有接线的“Runtime Store”；
- 检索即记为已使用。

## 我建议的最终技术定位

命名上也建议调整。

不要叫：

```text
Obsidian Knowledge System
```

也不要叫：

```text
SiYuan Knowledge System
```

应当叫：

```text
DesignEcho Knowledge Plane
```

Provider 结构可以是：

```ts
interface KnowledgeSourceProvider {
    readonly providerId: string;
    readonly capabilities: {
        read: boolean;
        write: boolean;
        watch: boolean;
        history: boolean;
    };

    scan(): Promise<SourceAssetRevision[]>;
    getAsset(assetId: string): Promise<SourceAssetRevision | null>;
    search(query: KnowledgeQuery): Promise<SourceSearchResult[]>;
}
```

第一阶段实现：

```text
MarkdownVaultProvider
BuiltinKnowledgeProvider
ReviewedMemoryProvider
EagleEvidenceProvider
```

未来可选增加：

```text
SiYuanProvider
ObsidianEnhancedProvider
WebSnapshotProvider
```

其中：

### MarkdownVaultProvider

- 是第一优先的 Human Authoring Source；
- 兼容 Obsidian；
- 也可用 VS Code、Typora 编辑；
- DesignEcho 自己能够完整读取和写回；
- 不依赖某个笔记软件运行。

### SiYuanProvider

将来可以作为用户主动启用的可选 Provider，通过 SiYuan 本地 HTTP API访问：

- 文档；
- 块；
-属性；
- 反向链接；
- 搜索；
- Kramdown/Markdown 内容。

SiYuan API支持 Token 鉴权和块级查询/更新，技术上可以实现。[SiYuan API](https://github.com/siyuan-note/siyuan/blob/master/API.md)

但建议第一版：

- 只读；
- 用户手动配置 `endpoint + token`；
- 不直接读取 `.sy` 文件；
- 不调用任意 SQL；
- 不写 SiYuan；
- 不依赖 SiYuan 才能启动；
- 离线时正常降级；
- SiYuan 返回内容仍要进入 Catalog revision/governance；
- 不把 SiYuan 搜索结果直接标成已验证知识。

等只读检索稳定后，再单独评估写回。

## UI 应该如何借鉴 SiYuan

我建议借鉴 SiYuan 的交互结构，而不是复制它的界面。

### 左侧：知识空间与来源

```text
设计知识
├── 设计原则
├── 方法与流程
├── 版式模式
├── 案例
├── 品牌与产品
├── 评审标准
└── 研究与趋势

来源
├── Markdown Vault
├── 内置知识
├── Eagle
├── SiYuan（可选）
└── Web 快照
```

### 中间：知识浏览器

支持两种切换：

```text
视觉网格
列表/属性视图
```

视觉案例默认网格，规则和方法默认列表。

### 右侧：Knowledge Inspector

显示：

- 正文和内容块；
- 来源；
- revision；
- lifecycle；
- 证据；
- 正例/反例；
- 相关知识；
- 反向引用；
- 实际使用记录；
- 为什么命中；
- 为什么没有进入当前任务；
- 修改历史和 Diff。

### Agent 侧：本次任务上下文

这一点必须比 SiYuan 更专业，因为它是 DesignEcho 的核心差异：

```text
用户固定
自动检索候选
最终选入
已加载正文
进入策略
用于执行
用于评审
被排除及原因
```

用户能够在执行前：

- 固定；
- 移除；
- 改用途；
- 查看来源；
- 查看版本；
- 查看适用边界。

这才是你们真正应该超越普通个人知识库的地方。

## 最终决策

我的最终主张是：

| 选择 | 建议 |
|---|---|
| 把 SiYuan 作为 DesignEcho 核心数据库 | 不建议 |
| 使用 `.sy` 作为知识文件格式 | 不建议 |
| 复制 SiYuan 前端或 Kernel 源码 | 不建议 |
| 继续保留 Trae 当前实现不动 | 不建议 |
| 借鉴 SiYuan 的块级 ID、反向链接、属性视图、历史版本 | 强烈建议 |
| 以 Markdown/YAML 作为首个开放作者源 | 建议 |
| Obsidian 作为默认推荐编辑器 | 建议 |
| SiYuan 作为未来可选只读 Provider | 建议 |
| DesignEcho 建立唯一 Catalog/Query Gateway/Context Compiler | 必须 |
| UI 按 DesignEcho 设计任务重新实现 | 必须 |

一句话概括：

> **学习 SiYuan 的知识组织能力，保留 Markdown 的数据开放性，避免继承 SiYuan 的数据格式、完整编辑器和 AGPL 集成风险；DesignEcho 自己只建设与设计 Agent 真正相关的 Catalog、Context、Review 和证据界面。**

下一步应先把现有“Obsidian Adapter”抽象改名为“Markdown Vault Provider”，收敛到唯一 Catalog 和 Context Compiler，等这条主链稳定后再增加只读 `SiYuanProvider`，不要现在同时维护两套外部知识源写回。
