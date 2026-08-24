# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 与 `AGENTS.md`（Codex 用）内容应保持同步：除首行标题、第 2 行身份说明句、以及互指对方文件名的行外，其余内容逐字节一致。改动本文件时，请同步 `AGENTS.md`。

## 项目概述

Agent + Adobe Photoshop UXP 电商设计自动化工作区（主分支线：`codex/agent-uxp`）：

- `DesignEcho-Agent/` — Electron 桌面应用：Agent 编排、模型路由、本地 ONNX 推理（BiRefNet/YOLO/SAM，DirectML）、知识库、React UI（DesignAgentWorkbench / ChatPanel）
- `DesignEcho-UXP/` — Photoshop UXP 插件（面板 280×620）：WebSocket 客户端，执行 Photoshop 原子工具
- `DesignEcho-CEP/` — PS 2019+ 老版本兼容层骨架（面板 iframe 装 Agent 界面 + ExtendScript 执行手，走同一条 MCP 线，Agent 零改动；13 工具子集，尚未真机验证，落地清单见其 README）
- `DesignEcho-Browser-Extension/` — Chrome MV3 扩展，配合主进程 8769 桥让 Agent 操作用户真实浏览器（含保存链接/批量收藏到 Eagle）
- 辅助目录：`DesignEcho-Agent-OpenSource/`（开源发布副本，带独立 CLAUDE/AGENTS 文档，别与主工程混改）、`eagle-skill/`（Eagle 素材库控制的 Claude 技能包）
- 通信：Agent 主进程 `ws://localhost:8765` 服务端 ← UXP 插件客户端；8766 WebView；8767 外部调试桥（实现见 `src/main/services/debug-bridge-service.ts`；`docs/debug-bridge.md` 在本分支已缺失，别按此路径找文档）；8768 MCP 宿主；8769 浏览器扩展桥。五个端口统一定义在 `src/main/config/network-ports.ts`（`DESIGNECHO_PORT_OFFSET` 可整体偏移）
- 仓库无 README.md（历史上有过，仅两行标题+一句 slogan，已删除且从未含安装/环境信息）；`CLAUDE.md` / `AGENTS.md` 是唯一的项目入口文档

## 技术决策责任（不得把专业选择题交给用户）

用户负责说明业务目标、优先级、验收口径和不可接受的结果；工程 Agent 负责技术路线、架构拆分、实现方式、兼容策略、迁移方案、测试方案与回滚方案。开发过程中不得把“选 A 还是 B”“要不要重构”“使用哪个框架、状态模型或存储方案”等专业选择题原样抛给用户拍板，也不得把“请用户确认技术方案”作为继续工作的默认门槛。

遇到多个可行方案时，Agent 必须：

1. 先检查现有代码、真实运行链、约束、历史债务和验证能力，再形成工程判断；不在信息不足时凭偏好列菜单。
2. 明确给出推荐方案，并在现有任务范围和已授权边界内直接推进。仅当取舍会显著影响用户可见行为、迁移成本、权限、安全、兼容或长期运维时，说明最关键备选及其主要代价；普通实现不展开技术菜单。
3. 优先选择根因清晰、职责单一、可验证、可回滚、与现有架构一致且长期维护成本更低的路线；不能只追求短期“能跑”或让检查变绿。
4. 对并发、持久化、权限、数据迁移、兼容性、缓存、失败恢复、跨版本行为等不易被界面暴露的技术决定，主动分析故障模式。在条件允许且成本、风险相称时，优先用测试、审计、读回或小范围可逆实验验证；暂时无法验证时，应缩小影响范围，选择更可逆的实现，并保留监测、失败检测和回滚点。
5. 证据用于提高判断可靠性，不是必须凑齐的形式。Agent 必须明确区分“已验证事实、合理推断、待验证假设、未知项”，禁止伪造日志、测试结果、运行状态、引用或来源，也不得把推断包装成已验证证据。涉及跨模块协议、持久化、迁移或兼容性的重大决定，应按现有文档治理规则记录关键假设、已经取得的验证、暂时无法验证的部分和回滚点，不能只留在聊天中。
6. 用户提出的技术建议应作为需求线索和约束候选进行验证，而不是未经检查就当成正确结论；若建议会增加系统性风险，应明确说明并采用更稳妥的工程方案。

只有下列情况才需要用户决定或补充信息：

- 业务目标、产品行为、验收口径彼此冲突，且代码与已有资料无法确定真实意图；
- 不同路线会产生不同的用户可见业务结果，且现有目标无法确定取舍；或需要新增预算、外部服务、交付承诺、长期运维责任等新授权；
- 涉及删除、覆盖、发布、生产数据迁移、付费、账号权限、安全边界等不可逆或需要新授权的动作；
- 缺少无法从项目和运行环境中取得、且继续处理会越出现有授权或业务边界的关键资料、凭据或业务事实；
- 用户明确要求参与技术路线决策。

即使必须询问，也应先给出专业推荐、依据和默认处理方式，把问题转换为用户能判断的业务影响，而不是要求用户判断底层实现优劣。能够通过现有权限内的只读检查、可逆实验或架构推导降低的技术不确定性，Agent 应自行处理并继续推进；暂时无法验证本身不是把技术选择题交给用户的理由，必须如实标为未知，不得为了继续推进或显得确定而虚构结论。只有继续处理会越出现有授权或业务边界时，才需要用户决定或补充信息。

## 代码地图（先读这里，再找文件）

文档里出现的裸模块名大多不在 `shared/`，而在 `renderer/services/` 下。常被引用的关键位置：

| 关注点 | 真实路径 |
|--------|----------|
| 引擎入口 `DesignAgentEngine` / `processWithUnifiedAgent` | `src/renderer/services/design-agent/engine.ts`（经 `agent-orchestration/index.ts` 与 `unified-agent.service.ts` 再导出，后者只是薄壳） |
| 编排层（路由/分类/对话/续跑/公开计划适配） | `src/renderer/services/agent-orchestration/`（`routing.ts`、`task-classifier.ts`、`conversational.ts`、`public-plan-photoshop-adapter.ts`…） |
| Agent 循环（原生工具调用、上下文、结果脱敏） | `src/renderer/services/agent-runtime/`（`agent.ts`、`tool-schemas.ts`、`context-manager.ts`、`tool-result-sanitizer.ts`） |
| Agent 策略层（任务失败后的补救指令，接在 task-completion-contract 之后） | `src/renderer/services/agent-policies/`（`design-task-policy.ts`） |
| 声明式布局引擎（"手"能力地基：模型只声明角色/比例/对齐，引擎算坐标+按角色定序，不让模型摆图层顺序） | `src/shared/layout/layout-engine.ts` + `render-layout-style.ts`，对应工具 `renderLayout`（`agent-runtime/tool-schemas.ts`） |
| 技能执行器 + 注册 + 技能工具映射 | `src/renderer/services/skill-executors/`（`registry.ts`、`index.ts`、`skill-tools.ts`、`*.executor.ts`） |
| 多智能体队友 | `src/renderer/services/design-teams/`（`registry.ts`、`coordinator.ts`、`state-sync.ts`） |
| 设计学习运行时 | `src/renderer/services/design-learning-runtime-*.service.ts` |
| v5 运行时（manifest 驱动，演进中） | `src/shared/agent-runtime-v5/`（`contracts/`、`manifests/`、`skill-runtime.ts`、`visual-observation-gate.ts`、`runtime-stage-plan.ts`） |
| 设计纪律运行时（D→B→A 治理产物；品类状态机已删，通用设计纪律的唯一家） | `src/shared/design-discipline-runtime.ts` |
| 各类执行点契约（纯逻辑、可被 smoke 测） | `src/shared/`（`agent-tool-decision-contract.ts`、`agent-tool-execution-preflight.ts`、`agent-parallel-execution-policy.ts`、`design-project-state.ts`、`business-skill-*.ts`…） |
| 技能声明（含 visibility） | `src/shared/skills/skill-declarations.ts` |
| 模型 provider 适配器 | `src/main/services/provider-adapters/`（`anthropic-adapter.ts` / `gemini-adapter.ts` / `openai-adapter.ts` / `ollama-adapter.ts` + `prompt-tool-parser.ts` 兜底无原生 function calling 的 provider）；ChatGPT 订阅通道是独立分支 `openai-codex`（`model-service.ts` → `codex-subscription-service.ts` + `codex-app-server-client.ts`，含 gpt-image-2 图像生成，不走 provider-adapters） |
| 主进程入口 / IPC / UXP / WebSocket | `src/main/index.ts`、`src/main/ipc-handlers/`、`src/main/uxp-handlers/`、`src/main/websocket/` |
| UXP 侧工具实现 | `DesignEcho-UXP/src/tools/registry.ts` + `tools/{canvas,image,layer,layout,text,sku,morphing}/` |
| 入口 UI | `src/renderer/components/ChatPanel.tsx`（约 8.5k 行，承载发送管线/续跑/卡片动作/v5 视觉观察接入） |

项目级 Claude 技能：`DesignEcho-Agent/.claude/skills/`（`bfl-api` / `flux-best-practices`）——图像生成默认走 BFL FLUX，改图像生成相关代码前先看这两个技能。

### 二级约束与项目记忆（改 `DesignEcho-Agent/` 前必读）

- `DesignEcho-Agent/AGENTS.md`（Claude 也适用）：默认只读子项目规则、`project-memory/Prompt.md` 与 `project-memory/CurrentTask.md`；只有架构、排期、既有验证或历史决策确实相关时，才按需读取 OS、Plan、Status、Decisions、Risks 或专项文档。根规则定义工作区共同边界，子项目规则只能细化、不能否定根规则
- `docs/long-horizon/`（`Prompt.md`/`Collaboration.md`/`Plan.md`/`Implement.md`/`Documentation.md`）是另一套借鉴 OpenAI 长程工作流博客的记忆脚手架，与 `project-memory/` 并存但**不是同一套**、也没有文档说明二者关系——改前先确认改的是哪一套，别记混
- Agent / Harness / Design Kernel / Skill 的 owner 边界以 `project-memory/Prompt.md`「2026-08-21 Agent + Harness 边界裁决」为当前生效真相源（8 个语义 owner 表）；`docs/agent-harness-boundary-verdict-2026-08-18.md` 已自标历史稿，别再引用。该边界由 `npm run test:design-authorship-boundary`（60+ 条源码断言，已并入 maintenance:validate）自动守护

## 常用命令

```bash
cd DesignEcho-Agent
npm run dev                       # clean + build + electron（已含 chcp 65001 防中文乱码）
npm run dev:watch                 # vite build --watch + tsc --watch 并行，比 dev 更适合边改边看类型错误
npm run build:main                # tsc -p tsconfig.main.json（主进程）
npm run build:typecheck:renderer  # build:main + tsc -p tsconfig.json（渲染进程类型检查，vite build 不查类型）
npm run build                     # clean + build:main + build:renderer(vite)
npm run clean                     # 清空 dist；npm run pack（electron-builder --dir，快速验证产物）/ npm run dist（正式安装包）

npm test                          # audit:handlers + test:morphing（默认套件，很薄）
npm run audit:handlers            # WebSocket handler 重复注册拦截
npm run audit:tools               # 工具单一注册表漂移校验
npm run audit:skill-standard      # 技能声明规范校验
npm run audit:executor-generic    # 通用执行器护栏（债务棘轮：品类专属耦合只许减不许增；已并入 maintenance:validate）
                                   # 本仓库未接入 ESLint/Prettier，build:typecheck:renderer 是唯一静态检查手段

# 核心验证（真实回归闸门）
npm run maintenance:validate              # = maintenance:preflight:core，35 阶段：规划/卫生/编码 + 静态审计群 + test:* 纯逻辑功能测试群 + npm test + renderer 类型检查 + UXP 构建（阶段清单见 scripts/run-core-validation.cjs）
npm run maintenance:repo-hygiene[:check]  # 仓库卫生检查（含清理被 gitignore 的临时文件）
npm run test:design-authorship-boundary   # 设计作者权边界：60+ 条源码断言钉死「Harness 不替 Agent 做设计判断」
npm run audit:entry-doc-sync              # 入口文档同步：CLAUDE.md/AGENTS.md 正文逐字节一致 + 文档引用的 npm 命令/文件路径真实存在（已并入 maintenance:validate）
npm run debug:runs                        # 真机运行病历诊断（debug:runs:failed 只看失败）——smoke 已退役后的日常诊断入口

cd DesignEcho-UXP
npm run build                     # build:typecheck（tsc --noEmit）+ webpack production（配合 PS UXP Developer Tool 加载）
npm run dev / npm run watch       # development 构建（不含类型检查）
npm run generate:icons            # 生成插件图标，依赖 Python 环境
npm run audit:photoshop-transaction-ownership  # Photoshop 事务唯一 owner 审计
                                   # npm run test 只是占位符（打印一行提示），不是真测试
```

实机联调：`npm run dev:chat-ui:debug-window*`（带 CDP 9223 调试窗口；`:fake` 用假模型/假 PS，`:default-mcp` 连默认运行时端口）。

## 架构大图

当前有**两条并行运行时**：v3（默认执行路径，已上线）与 v5（manifest 驱动，演进中，部分接入）。

### v3 端到端链路（默认路径）

```
用户输入 → ChatPanel → processWithUnifiedAgent → DesignAgentEngine.run()
  （renderer/services/design-agent/engine.ts）
  ├─ 保留闸门：取消 / 抠图暂停开关 / 历史公开计划确认 / 承接上一轮任务
  ├─ 无模型 → runWithoutModel 显式降级（本地寒暄 / 确定性规则执行，明确标注）
  └─ 默认路径：autonomous-agent 执行器（skill-executors/autonomous-agent.executor.ts）
       → Agent 循环（agent-runtime/agent.ts）+ chatWithTools 原生工具调用（流式）
       → 工具分发：技能 id → skill-tools.ts → 技能执行器；其余 → executeToolCall
       → preload window.designEcho → IPC → WebSocket 8765 → UXP ToolRegistry
```

### v3 拓扑核心原则（改动决策层前必读）

- **模型自主循环是默认路径**。本地规则（`fastDeterministicRoute` 等）只作为路线提示传给循环（`params.skillId` 建议），**不拦截、不抢跑、不否决模型**
- **约束在执行点强制，不靠关键词预判**：循环内每轮过「工具决策契约」（`shared/agent-tool-decision-contract.ts`）——读后写纪律、PS 连接/文档检查、工具可用性；技能开关与抠图暂停在 `skill-tools.ts` 执行点检查
- 引擎进入循环时显式签发 `autonomous_execution` 决策（`buildAutonomousExecutionDecisionForEngine`），避免循环内用正则反推意图
- 技能以工具形式暴露给模型（描述带【技能·多步工作流】，schema 从 `SkillDeclaration.parameters` 生成）；新技能注册后自动进入循环工具集
- 不要往 `engine.run()` 重新加关键词路由/意图分类闸门——这是 v3 明确移除的（曾导致"Agent 不聪明"），历史版本见 `snapshot/pre-v3-surgery` 分支
- 已知债务：`agent-orchestration/` 与 `agent-intent-control-plane.ts`、`engine.ts` 存在多套重叠的正则意图分类器（仅作提示，未做闸门），与"理解优于硬编码"相悖，是解耦目标——别再扩张，优先收敛

### v5 运行时（`shared/agent-runtime-v5/`，演进中）

- 目标：**manifest 驱动的运行契约层**——R0 按 `task_type` 找到 manifest，再由 `execution_model` 分流。只有 `staged` 使用 `runtime_stages`、确定性阶段状态和恢复；`agentic` 只消费任务语义、知识与预算画像，继续由自主循环执行，不建立阶段写入门禁。新增能力优先新增 manifest（`manifests/*.manifest.ts`），不把品类分支堆进 Orchestrator 核心（`skill-runtime.ts`）
- 现状：以**契约、清单与 staged 阶段上下文**为主（`contracts/`、`validators/`、`visual-observation-gate.ts`、`runtime-stage-plan.ts`、`runtime-contract-bundle.ts`），尚未取代 v3 主循环，也不以“取代自主循环”为 agentic 路径目标。已接入 ChatPanel 的部分包括 v5 视觉观察上下文与详情页卡片控制器；卡片动作走确定性控制器，**不重入发送管线、不重跑 v5**
- 真实视觉上下文是设计规划的 P0 前置条件：详情页/主图在“真看过图”之前不得把图像推断当成事实；缺失上下文只转成待补输入与建议动作，不授予或阻断 executor。写入权限仍由 Tool preflight 与 Policy 负责（见 `business-skill-visual-observation-*.ts` 与 v5 `visual-observation*.ts`）

### 项目执行优先级（workflow / agent 分流）

1. **目标、事实、实现各归其主**：当前用户指令决定业务目标、优先级和用户可见取舍；当前代码、真实运行状态与 Tool 读回决定事实；工程 Agent 负责技术实现。
2. **按答案性质分流**：开放创意走 `agentic`；有唯一可校验答案的规格化生产走 `staged`。`SkillRuntimeManifest.execution_model` 是代码真相源。agentic 的 Brief / Strategy / Plan 只是可选工作笔记，不得成为写入门票或工具裁剪依据；staged 可对组合数量、命名、模板结构和导出完整性做确定性校验。
3. **未知按对象处理**：模型能力或环境支持度未知时，允许可逆真实尝试并以真实结果为准；写入目标、权限、副作用或未知写状态未明时，先观察、校验或 reconciliation；可选知识与审美信息未知只降级为未验证或 warning。只有明确不支持、未授权、目标/协议无效或不安全的相应动作可以被阻断。
4. **前置拦截必须有具体错误事实和可达恢复出口**：不得依赖助手措辞、可选表单、审美分数或历史事故类比阻断 agentic 执行；无法证明会阻止实际错误的检查应是事后验收或提示。
5. **验证与风险相称**：明确区分已验证、合理推断和未知，绝不伪造；缺少非关键验证不等于失败，也不要求向用户提交“证据报告”。历史任务、旧指标和事故复盘进入 Git、Decisions 或按需状态记录，不作为当前指令常驻加载。

模型能力判定统一走 `shared/model-capability-verdict.ts` 与 `capabilityBlocksExecution()`；工具副作用分类仍由 `shared/agent-tool-execution-preflight.ts` fail closed，两种 `unknown` 不得混用。外部 workflow 技术方案只约束规格化生产链路，不得覆盖开放创意的 agentic 路径。

### 进行中的重构（"局部重构"上下文）

1. **`main/index.ts` 拆解**：已基本达标——当前约 940 行（`ipc-handlers/` 38 个文件、`uxp-handlers/` 14 个文件），内联 `wsServer.on('action',…)` handler 已清空。过时的 `src/main/REFACTOR-PLAN.md` 已删除；不要按其历史快照中的“当前 5457 行”、`binary-protocol-service.ts` 等目标寻找不存在的文件，后续以代码现状和本节为准
2. **v3 / v5 按执行模型收口**：v5 manifest 统一任务身份、知识、预算与契约；`staged` 生产链逐步接入 stage plan，`agentic` 创意链保留 v3 自主循环并消费 manifest bundle。新写业务能力优先落到 manifest / Provider / 数据契约，而非往通用执行器堆专属分支；不得把“收口”解释为让所有任务阶段化
3. **设计能力治理（D→B→A，执行器侧已完成）**：详情页 `freshDetailPage*` 状态机的通用设计知识与复核方法已从执行器下沉到数据、知识和评价契约层；**A 阶段（删除品类状态机）已完成**——executor 内品类符号清零（源码残余仅 `design-discipline-runtime.ts` 头注等历史注释），通用化产物是 `shared/design-discipline-runtime.ts`。只有 `staged` 生产链使用确定性阶段门禁，`agentic` 的观察和复核按风险与真实进展触发，不因固定措辞、次数或审美分数阻断写入。别再往执行器加品类分支；后续治理重心是能力质量（视觉观察覆盖率、评审校准），不是继续做边界减法

### 多智能体（design-teams，`renderer/services/design-teams/`）

- **概念蓝图**：`docs/design-agent-blueprint-a0-a9.md`（用户脑图导入，权威）——长期 1 总控 + 9 专业共 10 个逻辑 Agent，第一阶段合并为 6 个执行模块，共享 Design Project State，评审按退回规则路由。扩展角色前先读它
- 4 个队友角色（scene-analyst / design-strategist / executor / critic），定义在 `design-teams/registry.ts`（系统提示 + 工具白名单 + 写权限 + 预算）；2026-08-22 起全部角色与主循环共用当前唯一的多模态 Agent 模型（`dispatchPlan.selectedModelId`），不再按角色挑选第二个视觉模型（旧 `resolveModelForRole` 已删）
- 主循环两种用法：`delegateToAgent`（单个聚焦子任务）和 `runDesignTeamPipeline`（完整流水线：分析→策略→执行→评审→不通过自动修订，最多 2 轮）
- 同一次自主运行内的多次委派共享 `DesignTeamWorkspace`（黑板）：队友产出自动注入后续队友的系统提示，不依赖主模型转述
- critic 末尾输出机读裁决 JSON（`{"verdict":"pass"|"needs_fix","issues":[...]}`），解析在 `shared/design-team-verdict.ts`（括号配平提取，**不要改回非贪婪正则**——嵌套 issues 会截断）；解析失败按 unparseable 如实处理，不伪造裁决

### Design Project State（共享设计项目记忆）

- 契约 `shared/types/design-project-state.types.ts`（v0，蓝图 17 字段），纯逻辑 `shared/design-project-state.ts`（合并/封顶/摘要），持久化 `<项目>/.designecho/design-state.json`（原子写，UTF-8 无 BOM）
- 模型通过 `getDesignProjectState` / `updateDesignProjectState` 工具读写（通用项目记忆机制，不是技能专属）；主循环开始时自动注入状态摘要；队友产出按 `design-teams/state-sync.ts` 映射写穿（design_plan→layoutPlan、review_report→reviewResult 含裁决解析、execution_report→追加版本）
- 红线：State 保存共享项目上下文与记忆，不是权限系统；旧状态不覆盖用户当前指令；set 不允许触碰 schemaVersion/learnings/versionHistory（追加用专用字段）
- 设计方法论知识走知识工具检索（如 `getMainImageDesignFramework`，源 `shared/knowledge/main-image-framework.ts` + `docs/main-image-design-framework.md`），不硬编码进 Agent
- **Eagle 创意参考**：`searchEagleReferences` 工具（knowledge_search）→ IPC → `eagle-readonly-knowledge-service`（MCP 协议，端点 127.0.0.1:41596，需 Eagle 4.0+ 启用 MCP Server）。R0 边界：只读、结果标注来源、防照抄、原始图像字段清洗（`shared/eagle-readonly-knowledge.ts`）；离线优雅降级。研究类角色可用，执行类角色不开放

### 主要业务子系统（技能 + 契约 + 核心验证）

- **主图（main-image）**：完整生产管线——策略→生产结构→执行计划→executor handoff→live Photoshop 工具适配器→截图 QA。executor 在 `skill-executors/main-image*.ts`，质量由结果 QA 和人工复核确认。
- **SKU 批量**：ReAct 风格，配色降级为工具 + 模型微调 + 交互卡片确认；executor `sku-batch.executor.ts` / `sku-config.executor.ts`，质量由真实执行结果确认。
- **详情页（detail-page）**：模板解析（`parseDetailPageTemplate`，工具描述里写明工作流顺序）+ 布局分析；executor `detail-page.executor.ts` + `detail-page-*.ts`，质量由真实 Photoshop 读回确认。
- **参考复刻（reference-replication）**：基准/评测管线，`benchmark:reference-replication:*`；质量声明有 gate（`check-reference-quality-claim-gate.cjs`）。
- **设计学习（design-learning）**：按 cadence 从 Eagle 参考中学习，写记忆需过 review/writeback gate；`design-learning-runtime-*.service.ts`。
- **electron socks 设计编排（ecommerce-socks-design）**：父→子策略下发/评审/聚合流水线，`ecommerce-socks-design.executor.ts`。

### 工具并行执行（agent-runtime）

- 模型一轮内多个工具调用按 `shared/agent-parallel-execution-policy.ts` 切分保序批次：连续的只读/检索/外部生成调用并发（单批上限 3），**写类/save_export/stateful_context/unknown 一律串行**——写调用预检必须能看到此前全部工具结果与状态变化，不要放宽
- `delegateToAgent` 只在只读队友（scene-analyst/design-strategist/critic）时可并发；策略中的角色集合与 registry 的 `canWriteToPhotoshop` 由核心静态审计交叉校验防漂移
- WebSocket 层 `sendRequest` 以自增 ID + pendingRequests Map 关联响应，支持并发在途请求；Photoshop 侧由 executeAsModal 排队

### 循环内视觉观察（agent-runtime）

- 工具结果回填模型前经 `tool-result-sanitizer.ts` 截断超长字段（快照 base64 曾以完整 JSON 文本进上下文——不要移除这层截断）
- 快照类结果的图像由 `Agent.attachToolImageObservations` 以 user 图像消息回传。2026-08-22「统一单一多模态模型」裁决（commit `d646658d`）后：画面由同一个 Agent 模型直接观察，能力未确认时如实标记未观察，**不再转交第二个视觉专家模型**（`visual-expert` 仅保留在历史观察记录类型里做兼容读取，见 `agent-runtime/visual-observation-strategy.ts` 头注）；观察张数由技能 performance_profile 预算决定（无 profile 兼容默认 5，发给用户看的快照上限 8）；主循环与全部子 Agent（design-teams）共用此机制

### 工具 vs 技能

- **工具**：原子操作，schema 在 `agent-runtime/tool-schemas.ts`（约 175 个，以 `audit:tools` 为准）；UXP 侧实现在 `DesignEcho-UXP/src/tools/registry.ts`，新增需两边同步；执行分类（读/写/导出/外部生成）在 `shared/agent-tool-execution-preflight.ts`——**新增工具必须在此登记分类**，否则被契约按 unknown 拦截
- **技能**：声明 `shared/skills/skill-declarations.ts`（含 visibility），执行器 `skill-executors/*.executor.ts`，注册 `skill-executors/index.ts`；新技能 id 同时要在 execution-preflight 的分类逻辑确认（默认按 photoshop_write）
- **技能不渗透进 Agent（不变量）**：autonomous-agent 执行器是通用 ReAct 入口，不为任何品类维护专属工具表 / 正则意图 / 提示分支。工作流知识的家：技能声明（→自动成为技能工具描述）+ 原子工具描述中的链路位置说明 + 数据层（`shared/design-task-types.ts` 结构/intake、v5 `visual-observation-gate.ts` 看图前置条件）。历史最大违例（详情页 `freshDetailPage*` 硬编码状态机，曾约 160 处品类符号 + 顺序门禁 + 详情页工具白名单）已于 2026-08 清零：设计纪律统一由 `shared/design-discipline-runtime.ts` 的品类无关守卫承担（executor 经 `resolveDesignDisciplineContext` / `evaluateDesignToolStateGuard` 调用），`selectToolsForContext` 只是能力会话渐进披露的薄封装。`npm run audit:executor-generic` 保留为防回归棘轮：品类耦合只许减不许增
- **素材选定权归模型/用户（排序≠选定）**：Harness 侧启发式评分（`shared/main-image-asset-selection.ts`、`skill-executors/detail-page-asset-ranker.ts`、`shared/sku-card-asset-candidates.ts`）只产候选列表与 `requiresModelAssetDecision` / `needsVisualConfirmation` 标记；主图不把规则排序第一名自动当选定素材（只有用户明确指定/面板选中才是权威选定），详情页 `matchDetailPageContent` 返回的 plans 是机械候选、fill 前须模型复核替换。别改回 `candidates[0]` 直选；该边界已由 `test:design-authorship-boundary` 断言守护
- `template-authoring` 系执行器/技能已删除（`detail-page-template-authoring.executor.ts`、`main-image-template-authoring.executor.ts` 等，见 commit `8ee68190`），但 `isDetailTemplateAuthoringIntent` / `isMainImageTemplateAuthoringIntent`（`agent-orchestration/routing.ts`）仍在，且被 `engine.ts`、`autonomous-agent.executor.ts`、`agent-route-boundary-policy.ts` 调用——这是有意保留的旧措辞重定向（把老说法逼回自主循环，不是指向已不存在的技能），不是残留死代码，别顺手清理
- 工具身份分散在约 10 处（schema / UXP registry / preflight 分类 / 显示名 / scope 等），漏一处会让能力"半隐身"——以 `audit:tools` 为单一校验口径
- 模型调用：`window.designEcho.chatWithTools / chatWithToolsStream` → `model-service.ts`（`provider-adapters/` 适配各家原生 function calling）

### 验证现状

旧的 smoke 脚本、package 命令和分层验证器已经退役并删除，历史需要时由 Git 提供恢复能力。默认回归只走 `maintenance:validate`，由构建、类型检查、静态审计、规划/仓库卫生检查和可复用的真实功能测试组成。不得因为某个功能缺少测试脚本就临时补一份，更不得修改断言、吞掉错误或把假绿当作完成依据。

## 重要约束

### 中文编码（高危）

- 所有文件 **UTF-8 无 BOM**；行尾按 `.gitattributes`：**源码（`.ts/.tsx/.js/.json/.md/.css/.yml` 等）一律 LF**，仅 Windows 脚本（`.bat/.cmd/.ps1`）为 CRLF。本机 `core.autocrlf=true`，但 `.gitattributes` 已把源码钉死为 LF——别在文档里再说"全部 CRLF"
- 终端用 `chcp 65001`（dev/start 脚本已内置）
- 历史上出现过「UTF-8 被按 GBK 误解码后回存」的乱码文档（如已删除的 `docs/project-status.md`），引用旧文档时先确认内容可靠；不要在不处理编码链路的情况下批量重写中文文件
- 用户可见字符串一律简体中文；错误信息要指明哪一步失败、关联对象、建议动作

### 代码风格（原 `.cursor/rules/code-simplifier.md` 规则已内联于本节，对本仓库通用）

- TypeScript 顶层函数优先用 `function` 关键字而非箭头函数，且要写显式返回类型
- React 组件走显式 Props 类型
- 错误处理尽量避免 try/catch（比"别用 try/catch 吞错误"更进一步，是能不用就不用）
- 禁止嵌套三元表达式，多条件判断用 switch 或 if/else 链
- ES modules import 按规范排序，带扩展名

### 其他

- 开发验收记录、smoke、benchmark 与调试导出只能存在于开发路径；不得进入生产 Runtime 类型、业务状态、模型上下文、Tool 权限、完成判定或用户界面。
- 本地模型文件（`DesignEcho-Agent/models/`，约 1.7G）与素材目录（`C-649/` 等）不入 Git
- `project-memory/` 是项目运行记忆，文件角色规范见上文「二级约束与项目记忆」，保持结构化更新，不要批量重写其中文内容
- `playwright`、本机 VC++ 运行时曾出过环境问题：onnxruntime 加载失败先查 `System32\msvcp140.dll` 版本是否被旧安装程序覆盖（修复方式：VC++ 2015-2022 redist `/repair`）
- WebSocket handler 重复注册靠 `npm run audit:handlers` 拦截；工具注册漂移靠 `npm run audit:tools`
