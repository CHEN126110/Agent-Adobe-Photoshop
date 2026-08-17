# 证据、候选与晋级

## 目录

- [Hermes 启发与 DesignEcho 取舍](#hermes-启发与-designecho-取舍)
- [候选最小契约](#候选最小契约)
- [证据充分性](#证据充分性)
- [评测设计](#评测设计)
- [晋级矩阵](#晋级矩阵)
- [生命周期与回滚](#生命周期与回滚)

## Hermes 启发与 DesignEcho 取舍

Hermes 值得借鉴三点：Skill 与 Memory 分离、按需加载的渐进披露，以及将执行轨迹用于候选改进。其官方离线 self-evolution 方案也采用“生成变体 → 约束门禁 → 测试/benchmark → 人工 PR 审核”。

参考：

- <https://github.com/NousResearch/hermes-agent/blob/main/website/docs/guides/work-with-skills.md>
- <https://github.com/NousResearch/hermes-agent-self-evolution>
- <https://hermes-agent.nousresearch.com/docs/user-guide/features/curator>

不要照搬固定轮次触发、“多数会话都应更新”的偏置、加载次数即有效性或后台直接改写生产 Skill。DesignEcho 的 Photoshop 写入、项目事实和质量裁决风险更高，必须把复盘写入限制在候选层。

## 候选最小契约

下面的 `SkillEvolutionCandidate/v0` 是建议契约，不是当前 Runtime 已接入类型。候选至少包含：

```yaml
candidate_id: stable-id
version: skill-evolution-candidate/v0
target:
  kind: developer_skill | runtime_skill
  skill_id: stable-skill-id
  base_version: semver-or-revision
  base_hash: content-hash
scope:
  type: user | project | brand | task_type | global
  id: optional-stable-scope-id
change:
  kind: knowledge_recipe | reference_policy | trigger_examples | evaluation_profile | manifest_overlay | prompt_patch | executor_code_request | tool_schema_request | policy_change_request
  patch: reviewable-diff
evidence:
  source_run_ids: []
  source_artifact_refs: []
  human_diff_refs: []
  positive_count: 0
  negative_count: 0
diagnosis:
  root_cause_owner: canonical-owner
  summary: reproducible-cause
  alternatives_rejected: []
capabilities:
  required_refs: []
  adds_no_tool_or_permission: true
evaluation:
  trigger_cases: []
  regression_cases: []
  golden_cases: []
  baseline_metrics: {}
  challenger_metrics: {}
  status: pending
governance:
  status: draft
  human_approval_required: true
  auto_apply_allowed: false
  does_not_change_task_result: true
  rollback_version: version-or-hash
lineage:
  supersedes: null
  created_at: iso-8601
  created_by: agent-or-human-id
```

只保存必要摘要和稳定引用，不复制原始图片、完整 Prompt、敏感路径或无界 Tool 返回。

首个产品切片只允许 `knowledge_recipe`、`reference_policy`、`trigger_examples`、`evaluation_profile` 和纯声明式 `manifest_overlay` 进入 Publisher。`prompt_patch` 需要稳定金标和留出集后再开放；`executor_code_request`、`tool_schema_request`、`policy_change_request` 只能生成开发任务，不能被自动发布或执行。

## 证据充分性

不要采用固定“出现 N 次才算经验”的单一规则。按风险和可复现性判断：

- 确定性代码缺陷：一次稳定复现、明确根因和能先失败后通过的回归即可支撑代码修复，但不能自动变成全局 Skill。
- 用户偏好：一次明确陈述可以形成 user-scoped 候选；推断行为必须保持 `needs_review`，不得覆盖当前指令。
- 开放式设计方法：至少需要独立留出任务、真实视觉评价和反例；单次成功或模型自评不足以晋级。
- Policy、权限、完成裁决：无论证据多少都需要专门人工审查，Agent 不得自主发布。
- 产品 Skill：除契约与离线评测外，还需要真实 Provider、Photoshop 写入、同目标读回、Evaluation 和 Delivery 验证，才能声明 E2E。

## 评测设计

1. 固定当前版本为 baseline，不在候选提出后改写基线。
2. 将根因样本用于 development，把未参与改写的案例作为 holdout。
3. 每个候选只改变一个主要假设，并记录 lineage。
4. 对确定性能力检查成功率、错误分类、状态转换、幂等和回滚。
5. 对开放设计检查关键 finding、成对偏好、用户返工、真实性、可编辑性和成本/延迟。
6. 同时运行反例：候选不应在不相关任务触发，也不应扩大权限。
7. 未显著优于 baseline 或产生关键回归时拒绝候选。

## 晋级矩阵

| 目标 | 晋级前最低要求 | 发布方式 |
| --- | --- | --- |
| user/project Memory | 作用域明确、来源可追溯、必要用户确认、可撤销 | 走现有 review/writeback；不改 Skill |
| reviewed recipe / Knowledge | provenance、allowedUses、freshness、反例和检索消费者可用 | 评审后激活；过期/撤回可拒绝 |
| 项目开发 Skill | `quick_validate`、正反/模糊触发测试、独立 forward-test、人工 diff 批准 | 版本化文件 patch，保留上一版本 |
| 产品 v5 Skill | Skill Package audit、Capability 引用、Evaluation Profile、Policy、真实 E2E | 单独 Runtime 集成切片；不得后台直写 |
| Tool / Context / Router / Runtime | 根因回归、影响矩阵、类型检查和目标 smoke | 正常代码评审流程 |
| Evaluation | 与专业/用户结果校准、误通过和漏报可量化 | 复用唯一 DesignVerdict/Release Gate |
| Policy | 威胁模型、权限审查、负向测试和人工批准 | 禁止 Agent 自主晋级 |

## 生命周期与回滚

使用清晰状态：

```text
intake_only → candidate → needs_review → approved_for_patch → published
                         ├→ rejected
published → superseded | rolled_back
```

- `intake_only` 只说明值得诊断，不代表根因成立。
- `candidate` 不进入生产 Prompt，不授予权限。
- `approved_for_patch` 只批准指定 diff 和版本，不批准后续自由改写。
- `published` 只说明制品发布；产品运行状态仍需另行标记。
- 回滚必须恢复已知良好版本并保留失败版本、触发证据和处置结果。

不要把不活跃自动解释为低质量，也不要自动删除。使用 `stale/archived` 只做库卫生；质量取代必须有真实评测依据。
