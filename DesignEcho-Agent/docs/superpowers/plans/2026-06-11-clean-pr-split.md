# Clean PR Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将本地无法推送的 `codex/agent-uxp` 总现场拆成可以推送、审查和验证的干净 PR 链。

**Architecture:** 保留原始总现场和安全快照，不重写或删除当前脏工作树。每个可审查 PR 都从 `origin/main` 或上一个干净 PR 分支创建独立 worktree，再用受控 pathspec 抽取源码、脚本、配置和文档，显式排除模型、日志、业务素材、生成物和旧后端归档。第一步先建立 `codex/v3-agent-clean` 作为后续详情页 Agent 接入和设计团队流水线的基线。

**Tech Stack:** Git worktree, Git pathspec, TypeScript, Node smoke scripts, Electron build checks, GitHub draft PR.

---

## Non-Negotiable Boundaries

- 不推送 `codex/agent-uxp`，因为该历史包含 GB 级素材对象。
- 不在原始工作树执行 `git reset --hard`、`git checkout --`、`git clean`、`git prune`。
- 不把这些路径带入任何 PR：
  - `C-*/**`
  - `_archived_python_backend/**`
  - `.venv/**`
  - `DesignEcho-Agent/models/**`
  - `DesignEcho-Agent/models_backup/**`
  - `DesignEcho-Agent/logs/**`
  - `DesignEcho-Agent/dist/**`
  - `DesignEcho-Agent/release/**`
  - `DesignEcho-Agent/knowledge-packs/**`
  - `DesignEcho-UXP/stats.json`
  - `DesignEcho-UXP/stats-utf8.json`
  - `*.psb`, `*.psd`, `*.tif`, `*.tiff`, `*.jpg`, `*.jpeg`, `*.png`, `Thumbs.db`
- PR 描述必须写清楚包含范围和排除范围。

## PR Chain

### PR 1: `codex/v3-agent-clean`

Purpose:

- 建立当前 Agent/UXP 源码基线。
- 去掉大素材和模型对象。
- 为后续更小的功能 PR 提供可合并基础。

Validation:

```powershell
npm install
npm run build:typecheck:renderer
```

If `build:typecheck:renderer` is unavailable in this baseline, run:

```powershell
npm run build:main
npx tsc -p tsconfig.json --noEmit
```

### PR 2: `codex/detail-page-agent-clean`

Base:

- `codex/v3-agent-clean`

Purpose:

- 增加详情页 Agent intake contract。
- 增加当前文档详情页模板预检路由。
- 修复 `agentMode=execute` 和 `inspectOnly=true` 的参数冲突。

Validation:

```powershell
npm run smoke:detail-page:agent-intake
npm run smoke:detail-page:document-preflight-routing
npm run smoke:detail-page:readiness-wiring
npm run smoke:detail-page:skill-readiness
npm run smoke:detail-page:agent-decision-boundary
npm run build:typecheck:renderer
```

### PR 3: `codex/design-team-pipeline-clean`

Base:

- `codex/v3-agent-clean`

Purpose:

- 增加设计团队共享 workspace。
- 增加角色感知模型选择。
- 增加 critic 结构化裁决解析。
- 增加 `runDesignTeamPipeline` 工具。

Validation:

```powershell
npm run smoke:design-team:pipeline
npm run smoke:agent:tool-execution-preflight
npm run smoke:agent:tool-decision-contract
npm run build:typecheck:renderer
```

### PR 4: `codex/uxp-sku-layout-clean`

Base:

- `codex/v3-agent-clean`

Purpose:

- 抽取 SKU 6.3 顺序占位替换逻辑。
- 抽取 UXP SKU 工具和验证 smoke。
- 明确禁止无占位自动避让作为默认路径。

Validation:

```powershell
npm run smoke:sku:auto-layout-executor-policy
npm run smoke:sku:configured-execution-plan
npm run smoke:sku:batch-executor-params
npm run build:typecheck:renderer
```

## Execution Checklist

- [x] Create safety branch: `snapshot/codex-agent-uxp-before-pr-split-20260611`.
- [x] Create clean worktree: `C:\Users\12611\.config\superpowers\worktrees\2.0\v3-agent-clean`.
- [x] Apply source/config/docs patch with exclusions for large assets and generated files.
- [x] Verify staged files do not include excluded paths.
- [ ] Install dependencies in `DesignEcho-Agent`.
- [ ] Run v3 baseline type checks.
- [ ] Commit v3 baseline.
- [ ] Push `codex/v3-agent-clean`.
- [ ] Open draft PR for v3 baseline.
- [ ] Rebase or recreate `codex/detail-page-agent-clean` from `codex/v3-agent-clean`.
- [ ] Apply detail-page Agent intake patch.
- [ ] Verify detail-page smoke suite.
- [ ] Commit, push, and open detail-page draft PR.

## Self-Review

- Scope is split by dependency order: v3 baseline first, feature PRs second.
- Large binary and generated assets are explicitly excluded.
- The plan does not require destructive cleanup of the original dirty workspace.
- Each PR has concrete validation commands and a clear base branch.
