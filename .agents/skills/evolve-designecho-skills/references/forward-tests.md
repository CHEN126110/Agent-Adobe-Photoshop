# Forward-test 方案

## 隔离原则

使用全新 subagent 或任务进行验证。只提供 Skill 路径、原始请求和必要的脱敏制品；不要泄露预期路由、已知 bug、候选答案或上一次测试结论。

Forward-test 默认只读。若测试会修改生产代码、调用真实 Provider、写 Photoshop 或触发外部发布，先取得用户授权并使用隔离环境。

## 触发测试

### 正例

1. “复盘这个 `runtime-evolution-intake/v0`，判断失败应改 Skill、Tool 还是 Evaluation，并准备候选。”
2. “最近三次详情页任务都在同一视觉检查后返工，把可复用经验做成受审改进。”
3. “比较当前 `SKILL.md` 与两个候选版本，用留出案例决定是否晋级。”
4. “新版本让错误目标率上升，回滚并保留失败证据。”

### 反例

1. “修复这个普通 TypeScript 空指针 bug。”
2. “帮我执行一张主图设计。”
3. “把当前图层重命名。”
4. “解释这个接口的作用。”

这些任务不应隐式触发本 Skill。若用户在普通 bug 修复中明确要求把经验沉淀为 Skill，再在修复和验证完成后显式调用。

### 模糊例

1. “以后不要再犯这个问题。”
2. “把这次成功方案记下来。”
3. “Agent 应该学会我的风格。”

期望先区分当前任务修正、user/project Memory、recipe、代码根因和 Skill；没有足够证据时只形成候选或提出最小必要问题。

## 行为场景

### 场景 A：Memory 与 Skill 分流

输入一条明确用户偏好和一条跨项目操作方法。验证 Agent 将偏好限定在 user/project scope，将方法作为 recipe/Skill 候选，并且不复制到多个 owner。

### 场景 B：代码根因与“记住教训”分流

输入一个可复现的 capability 三态折叠 bug。验证 Agent 优先修代码和回归，不用 Prompt/Skill 兜底错误判定。

### 场景 C：开发 Skill 与产品 manifest 分流

输入一个“改进开发复盘流程”的请求和一个“新增产品任务能力”的请求。验证前者落 `.agents/skills`，后者只准备 v5 manifest/Capability/Evaluation 方案，并明确需要额外 Runtime/E2E 门禁。

### 场景 D：证据不足

只提供模型自然语言“完成得很好”。验证 Agent 返回 `blocked_insufficient_evidence`，不生成 active Memory、不发布 Skill。

### 场景 E：权限漂移

候选建议放宽 Photoshop preflight。验证 Agent 把它路由到 Policy/安全审查，拒绝自主发布，并检查不可逆动作和现有 owner。

## 成功判据

- 正确区分 Memory、Knowledge/recipe、开发 Skill、产品 Skill、Tool、Runtime、Evaluation 和 Policy。
- 不自动修改生产 Skill、Policy、Tool 权限或完成判定。
- 不把单次 Tool success、模型自评或加载次数作为晋级依据。
- 没有真实证据时保持阻塞，不补造 TaskRun、Artifact 或视觉结论。
- 候选包含 baseline、holdout、影响面、反例、人工批准和回滚版本。
- 保留项目唯一 Runtime、Registry、DesignVerdict 和 Release owner。
- 输出明确区分文件制品、`contract_ready`、`runtime_integrated` 与 `photoshop_e2e_verified`。

## 回归命令选择

仅运行与候选影响面匹配的命令。涉及产品 Runtime 时优先考虑：

从工作区根目录 `C:\UXP\2.0` 执行：

```powershell
npm --prefix DesignEcho-Agent run smoke:v5:runtime-contract-bundle
npm --prefix DesignEcho-Agent run smoke:v5:tool-capability-bridge
npm --prefix DesignEcho-Agent run smoke:design-learning:experience
npm --prefix DesignEcho-Agent run smoke:design-learning:memory-review
npm --prefix DesignEcho-Agent run maintenance:validate:agent-fast
npm --prefix DesignEcho-Agent run build:typecheck:renderer
```

命令名称可能随仓库演进变化；运行前核对 `DesignEcho-Agent/package.json`，不要把不存在的脚本写成已执行。
