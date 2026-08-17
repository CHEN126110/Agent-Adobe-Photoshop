---
name: evolve-designecho-skills
description: 从经过验证的 DesignEcho TaskRun、Reflexion handoff、runtime-evolution-intake/v0 和明确用户反馈中诊断根因，将可复用经验路由到 Memory、Skill、Tool schema、Workflow、Context Manager、Model Router、Evaluation 或 Policy，并准备经过前向验证、人工批准且可回滚的变更。用于复盘运行、沉淀经验、创建或改进 DesignEcho Skill、处理演进候选、防止同类故障复发；不用于普通功能开发、单次 bug 修复、设计执行或未经审核的自动自修改。
---

# DesignEcho Skill 受控演进

## 目标

把真实执行经验转化为有证据、可验证、可撤销的能力改进。先生成候选，再评测和审核；不要把模型自评、单次工具成功或聊天措辞直接写成长期规则。

把“跨会话动态模型”实现为经评审的偏好、Memory、recipe 和版本化 Skill overlay 的组合，不要宣称训练或修改了基础模型权重。

把本 Skill 当作开发与治理层的 meta-skill，不要把它当作 DesignEcho 产品运行时的 `SkillRuntimeManifest`。它可以准备受审 patch，但不拥有 TaskRun、Photoshop、Policy、阶段推进或完成裁决权。

## 必守边界

- 保持 `candidate first`。没有明确人工批准时，只输出候选、评测结果和 diff，不发布变更。
- 服从 `runtime-evolution-intake/v0` 的现有边界：需要根因、回归评测、人工批准和回滚版本；禁止自动应用或由 Agent 修改 Policy。
- 让当前用户指令、当前项目事实和真实环境读回优先于所有旧经验。
- 让一条经验只有一个权威 owner。不要同时复制到 Memory、Knowledge、Skill 和 Prompt。
- 不保存 chain-of-thought、密钥、完整 Tool payload、base64、原始图片或无界会话历史。
- 不用学习内容掩盖代码缺陷、Tool 缺口、连接故障、目标身份漂移或错误权限设计。定位根因并路由到正确模块。
- 不根据 Skill 被加载或查看的次数判断有效性。使用真实任务结果、回归、质量评价和用户反馈。
- 保留工作树中的既有改动。不要用 reset、checkout 或整文件覆盖处理并行修改。

## 开始工作

1. 读取当前工作区根 `AGENTS.md`。若要修改 `DesignEcho-Agent/`，再完整读取其 `AGENTS.md` 指定的项目记忆与架构真相源。
2. 检查工作树状态、目标文件的当前 diff、上游触发、唯一 owner、下游消费者和兼容边界。
3. 确定请求模式：`diagnose`、`propose`、`evaluate`、`implement-approved-patch`、`promote` 或 `rollback`。
4. 按任务加载参考文件：
   - 需要判断经验归属时，读取 [capability-routing.md](references/capability-routing.md)。
   - 需要建立候选、评测、晋级或回滚时，读取 [evidence-and-promotion.md](references/evidence-and-promotion.md)。
   - 需要验证 Skill 泛化和触发行为时，读取 [forward-tests.md](references/forward-tests.md)。

## 受控演进流程

### 1. 收集真实证据

优先使用以下可追溯输入：

- TaskRun / Runtime Session 身份与阶段事实；
- `runtime-evolution-intake/v0` 和 Reflexion handoff；
- 目标绑定的 operation result、写后读回和 ArtifactRef；
- R5 Evaluation、DesignVerdict、Delivery Receipt；
- 明确的用户纠正、选择、撤销或专业评审；
- 可复现测试、smoke、构建和真实 Photoshop E2E 结果。

如果只有猜测、自然语言总结或缺少目标身份的旧结果，将状态保持为 `blocked_insufficient_evidence`，不要补造事实。

### 2. 诊断根因并选择 owner

区分“当前任务怎样修正”和“未来系统是否需要改变”。先回答：

1. 失败发生在 Model、Context、Knowledge、Skill、Tool、Workflow、Evaluation、Policy 还是运行时 owner？
2. 这是可复现的确定性缺陷、受作用域约束的偏好，还是可跨任务复用的方法？
3. 改动应进入当前代码 owner、Memory/Knowledge、开发助手 `SKILL.md`，还是产品 v5 manifest？

按 [capability-routing.md](references/capability-routing.md) 路由。不要为了“让 Agent 学会”而把所有问题塞进 Skill。

### 3. 形成最小候选

为候选记录：

- 稳定候选 ID、版本、目标和作用域；
- 原始证据引用与根因；
- 计划修改的唯一 owner 和最小 diff；
- 必须保持的不变量、相邻风险和反例；
- 基线、训练样本、留出样本、评价指标和停止条件；
- 审核人、回滚版本和生命周期状态；
- `doesNotGrantToolPermission=true`、`doesNotChangeTaskResult=true`。

允许一个真实事件创建候选，但不要仅凭一次开放式设计结果晋级全局 Skill。对于可复现的确定性缺陷，可以用一次稳定复现加针对性回归证明根因；证据要求应随风险增加，而不是按固定会话次数触发。

候选变体默认保持少量，最多比较 3 个。每个变体只改变一个可解释假设，避免同时改 Prompt、Tool、Policy 和 Runtime 后无法归因。

### 4. 比较基线与候选

- 把用于提出候选的样本与留出评测分开，防止把当前案例写死。
- 对唯一正确答案使用确定性测试、schema 校验、smoke 和类型检查。
- 对开放设计使用真实视觉证据、成对比较、专业 finding、用户反馈和失败归属，不用单一总分掩盖阻断问题。
- 同时检查目标问题、相邻路径、失败路径、旧行为和成本/延迟变化。
- 候选没有显著收益、发生语义漂移或引入关键回归时，标记 `rejected`；不要因为已经投入时间而晋级。

### 5. 审核与发布

仅在用户明确授权实施或晋级时修改目标文件。发布前必须：

1. 展示证据摘要、根因、候选 diff、前后评测和未消除风险。
2. 取得明确人工批准；模型自评不能充当批准。
3. 固定版本、来源、适用范围、失效条件和可恢复的上一版本。
4. 对开发助手 Skill 运行结构校验和独立 forward-test。
5. 对产品运行时 Skill 另外通过 v5 Skill Package、Capability、Evaluation、preflight 和真实 E2E 门禁；不要把文件存在写成 `runtime_integrated`。

不要在后台任务中直接提交、推送、发布或改写生产 Skill。需要外部状态变更时，遵守用户授权和项目发布流程。

### 6. 监测、取代与回滚

使用实际交付通过率、用户返工/撤销、critic finding、回归结果、失败率和回滚率观察新版本。将过期、撤回、被取代或作用域不匹配的经验停止注入。

发生回归时，优先恢复已知良好版本并保留失败证据，再启动新的候选；不要在错误版本上连续叠加补丁。

## 输出格式

以“演进报告”交付，至少包含：

1. 请求模式和当前状态；
2. 证据引用与缺口；
3. 根因及唯一 owner；
4. Memory / Skill / Tool / Workflow / Evaluation / Policy 路由结论；
5. 最小候选与影响面；
6. 基线、留出评测、结果和反例；
7. 审核、发布和回滚计划；
8. 已执行修改、验证证据和仍未验证事项。

使用诚实状态：`intake_only`、`candidate`、`needs_review`、`approved_for_patch`、`published`、`rejected`、`superseded`、`rolled_back` 或 `blocked_insufficient_evidence`。不要把 `contract_ready`、`bridge_ready` 或文件制品完成写成 Photoshop E2E 已完成。
