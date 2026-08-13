# Step 2A 验收报告（v5 契约基础设施）

> 日期：2026-06-24 · 分支：codex/agent-uxp · 评审方：网页 GPT（架构）· 实现方：Claude Code
> 结论：GPT 评审通过，Step 2A 可标 `real_passed`（仅限契约基础设施；运行时/审批服务/垂直链路/PS 执行仍 `not_implemented`）。

## 能力矩阵（GPT 限定）

| 能力 | 状态 |
| --- | --- |
| v5_contract_layer | real_passed |
| v5_schema_validation | real_passed |
| v5_artifact_repository_memory | real_passed |
| v5_artifact_repository_file | real_passed |
| v5_approval_contract | real_passed |
| v5_approval_service | not_implemented |
| v5_main_workflow_runtime | not_implemented |
| v5_vertical_agent_chain | not_implemented |
| v5_photoshop_execution | not_implemented |

契约基础设施真实完成 ≠ 运行时工作流/审批服务已完成。

## 代码路径

- 契约（TS 单一事实来源）：`src/shared/agent-runtime-v5/contracts/`
  - `common.ts`（含 ArtifactMeta / ArtifactDraft / PublishedArtifact / NormalizedRect / LayoutRegion / ElementPlan）
  - `context-snapshot.ts` `creative-strategy.ts` `detail-page-plan.ts` `preview-scene.ts` `review-report.ts` `approval-record.ts`（含 isApprovalValid）
  - `index.ts`（V5_ARTIFACT_TYPES / V5_CONTRACT_OWNERSHIP 所有权表 / isContractWriter）
- 内容哈希：`src/shared/agent-runtime-v5/content-hash.ts`
  - `computeAuthoritativeContentHash`（权威，SHA-256，前缀 `sha256-jcs-v1:`）
  - `computeFastFingerprint`（FNV-1a，仅 UI dirty-check）
  - `sha256Hex` / `canonicalize` / `AUTHORITATIVE_HASH_VERSION`
- 仓库：`src/shared/agent-runtime-v5/repositories/`
  - `artifact-repository.ts`（IArtifactRepository 接口 + 共享发布决策 buildStoredArtifact/decidePublish + artifactId 路径安全）
  - `in-memory-artifact-repository.ts`（test/dev adapter）
  - `src/main/services/v5-workflow/repositories/file-artifact-repository.ts`（生产，原子写 + cleanupStaleTempFiles）
- 审批策略：`src/shared/agent-runtime-v5/approval-policy.ts`（canIssueApproval / isApprovalApplicableForScope）
- 业务 Validator：`src/shared/agent-runtime-v5/validators/contract-validators.ts`
- Schema 校验器：`src/main/services/v5-workflow/schema-validator.ts`（ajv 2020）
- 组装入口：`src/main/services/v5-workflow/composition-root.ts`（生产只能选 File）

## Schema 清单（schemas/v5/，Draft 2020-12 + additionalProperties:false 全层级）

common-definitions / context-snapshot / creative-strategy / detail-page-plan / preview-scene / review-report / approval-record（共 7 个）。

## Validator 清单

- 结构：JSON Schema（字段/类型/范围/枚举/additionalProperties:false）
- 业务（schema 表达不了的跨字段）：x+width<=1、y+height<=1、regionId/elementId 唯一、ElementPlan.regionId 必须存在、zIndex 非负、禁像素坐标、transform 数值有限、styleTokenRefs∈Theme Registry（传入即校验）、上游 ref 必填（R3/R4/R5）

## Smoke / Typecheck（复现命令与结果）

```
node scripts/smoke-agent-runtime-v5-contracts.cjs   → 42/42
node scripts/smoke-agent-runtime-v5.cjs             → 10/10（既有，未受影响）
node scripts/smoke-design-task-types.cjs            → 13/13（既有，未受影响）
npm run build:main                                  → passed（主进程 tsc）
npx tsc -p tsconfig.json --noEmit                   → 0 error（渲染 typecheck）
```

## Step 2A 加固（GPT 评审后）

- 哈希算法版本冻结：`AUTHORITATIVE_HASH_VERSION = "sha256-jcs-v1"`，前缀 `sha256-jcs-v1:<64hex>`
- 权威哈希只由 Repository 计算；调用方传 ArtifactDraft，伪造 contentHash 被忽略
- artifactId 路径安全（白名单 + 禁 `..`）：防写出目录
- FileArtifactRepository.cleanupStaleTempFiles()：清理崩溃残留 .tmp
- Validator 有限数校验（禁 NaN/Infinity）
- InMemory 标注 test/dev adapter + composition-root 保证生产只选 File（smoke 守护）

## 待办（已与 GPT 对齐，进 Step 1 处理）

- Schema `$id` 版本化（采纳，随 Step 1 schema 注册一并带版本，旧 $id 不原地改）
- per-artifact mutex（V1 记录写入模型为 single-process / single-writer）

## SHA-256 一致性

见同目录 `sha256-golden-vectors.json`；smoke 内已断言 `sha256Hex` 与 `node:crypto` 全等。
