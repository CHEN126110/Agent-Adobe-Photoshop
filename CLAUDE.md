# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 与 `AGENTS.md`（Codex 用）内容应保持同步：除首行标题、第 2 行身份说明句、以及互指对方文件名的行外，其余内容逐字节一致。改动本文件时，请同步 `AGENTS.md`。

## 项目概述

Agent + Adobe Photoshop UXP 电商设计自动化工作区（主分支线：`codex/agent-uxp`）：

- `DesignEcho-Agent/` — Electron 桌面应用：Agent 编排、模型路由、本地 ONNX 推理（BiRefNet/YOLO/SAM，DirectML）、知识库、React UI（DesignAgentWorkbench / ChatPanel）
- `DesignEcho-UXP/` — Photoshop UXP 插件（面板 280×620）：WebSocket 客户端，执行 Photoshop 原子工具
- 通信：Agent 主进程 `ws://localhost:8765` 服务端 ← UXP 插件客户端；8766 WebView；8767 外部调试桥（实现见 `src/main/services/debug-bridge-service.ts`；`docs/debug-bridge.md` 在本分支已缺失，别按此路径找文档）
- 仓库无 README.md（历史上有过，仅两行标题+一句 slogan，已删除且从未含安装/环境信息）；`CLAUDE.md` / `AGENTS.md` 是唯一的项目入口文档

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
| 设计纪律运行时（详情页/主图设计能力治理 D→B→A 的 D 阶段产物，通用化后的设计纪律） | `src/shared/design-discipline-runtime.ts` |
| 各类执行点契约（纯逻辑、可被 smoke 测） | `src/shared/`（`agent-tool-decision-contract.ts`、`agent-tool-execution-preflight.ts`、`agent-parallel-execution-policy.ts`、`design-project-state.ts`、`business-skill-*.ts`…） |
| 技能声明（含 visibility） | `src/shared/skills/skill-declarations.ts` |
| 模型 provider 适配器 | `src/main/services/provider-adapters/`（`anthropic-adapter.ts` / `gemini-adapter.ts` / `openai-adapter.ts` / `ollama-adapter.ts` + `prompt-tool-parser.ts` 兜底无原生 function calling 的 provider） |
| 主进程入口 / IPC / UXP / WebSocket | `src/main/index.ts`、`src/main/ipc-handlers/`、`src/main/uxp-handlers/`、`src/main/websocket/` |
| UXP 侧工具实现 | `DesignEcho-UXP/src/tools/registry.ts` + `tools/{canvas,image,layer,layout,text,sku,morphing}/` |
| 入口 UI | `src/renderer/components/ChatPanel.tsx`（约 7.2k 行，承载发送管线/续跑/卡片动作/v5 视觉观察接入） |

项目级 Claude 技能：`DesignEcho-Agent/.claude/skills/`（`bfl-api` / `flux-best-practices`）——图像生成默认走 BFL FLUX，改图像生成相关代码前先看这两个技能。

### 二级约束与项目记忆（改 `DesignEcho-Agent/` 前必读）

- `DesignEcho-Agent/AGENTS.md`（48 行，Claude 也适用）：中大型改动前要求先读 `project-memory/README.md`→`Prompt.md`→`CurrentTask.md`→`docs/documentation-governance.md`→`docs/design-agent-operating-system.md`→`Plan.md`→`Status.md`（路径均相对 `DesignEcho-Agent/`）；定义各文件角色（`Prompt.md`=目标/约束/范围真相源、`CurrentTask.md`=本轮对齐卡、`documentation-governance.md`=文档权限分层真相源、`design-agent-operating-system.md`=顶层架构真相源、`Plan.md`=当前阶段里程碑、`Status.md`=共享审计日志、`Intake.md`/`Backlog.md`=需求池/可执行待办、`project-state.json`=与 `Status.md` 一致的机器可读状态）；并给出 v3/v5/bridge/legacy 运行线术语的权威定义——与本文件「架构大图」冲突时以它为准
- `docs/long-horizon/`（`Prompt.md`/`Collaboration.md`/`Plan.md`/`Implement.md`/`Documentation.md`）是另一套借鉴 OpenAI 长程工作流博客的记忆脚手架，与 `project-memory/` 并存但**不是同一套**、也没有文档说明二者关系——改前先确认改的是哪一套，别记混

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
npm run maintenance:validate              # 核心验证：构建、类型、审计、规划和仓库卫生
npm run maintenance:preflight:core        # 同上，显式核心预检入口
npm run maintenance:repo-hygiene[:check]  # 仓库卫生检查（含清理被 gitignore 的临时文件）

cd DesignEcho-UXP
npm run build                     # webpack production（配合 PS UXP Developer Tool 加载）
npm run dev / npm run watch       # development 构建
npm run generate:icons            # 生成插件图标，依赖 Python 环境
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

- 目标：**代码控制的设计工作流运行时**——R0 编排按 `task_type` 找到 manifest，按 `manifest.runtime_stages` 驱动；R1 确定性意图采集；Project State owner-patch。新增能力 = 新增一份 manifest（`manifests/*.manifest.ts`），不改 Orchestrator 核心（`skill-runtime.ts`）
- 现状：以**契约、清单与阶段上下文**为主（`contracts/`、`validators/`、`visual-observation-gate.ts`、`runtime-stage-plan.ts`、`runtime-contract-bundle.ts`），尚未取代 v3 主循环。已接入 ChatPanel 的部分：v5 视觉观察上下文与详情页卡片控制器（`detail-page-card-controller.ts`、`visual-observation-card.ts`）；卡片动作走确定性控制器，**不重入发送管线、不重跑 v5**
- 真实视觉上下文是设计规划的 P0 前置条件：详情页/主图在“真看过图”之前不得把图像推断当成事实；缺失上下文只转成待补输入与建议动作，不授予或阻断 executor。写入权限仍由 Tool preflight 与 Policy 负责（见 `business-skill-visual-observation-*.ts` 与 v5 `visual-observation*.ts`）
- 专属 smoke：`smoke:v5:chatpanel-boundary` / `smoke:v5:runtime-contract-bundle` / `smoke:v5:tool-capability-bridge`

### workflow 与 agent 的分流判据（改任何约束前先读这条）

仓库里同时存在两套方向相反的架构主张，混用是 2026-07-31 真机「49 次运行、完成且真有写入 = 0 次」的根因：

- **workflow 路线**（`docs` 外部技术方案与 v5 阶段编排主张）：固定阶段、确定性优先、最小权限、不许自行宣布完成
- **agent 路线**（本文件「v3 拓扑核心原则」）：模型自主循环是默认路径，本地规则不拦截、不抢跑、不否决模型

**两条都对，但适用面不同。判据只有一句：这件事有没有唯一正确答案？**

| 有唯一答案 → 确定性约束 | 没有唯一答案 → 交给模型 |
|---|---|
| SKU 组合数量对不对、导出命名规范 | 该做什么交付物、怎么做好看 |
| 写入前读过目标文档、有可校验 documentId、layerId 有来源 | 要不要问用户、先做哪一步 |
| 不可逆动作（删图层/覆盖源文件）需人确认 | 措辞、表达、说明是否到位 |

**误用的代价是不对称的**：把确定性约束加到开放创意路径上，模型会被锁死（0/49）；漏加在批量生产上，只是产出需要复核。所以**新增任何前置检查前，先问它拦的是「做错」还是「说错」**——拦做错可以，拦说错必须降级为事后验收（`warnings`），否则会重演 2026-07-31 的写入门禁事故：模型读完文档准备动手，却因措辞没命中 `计划/准备/确认` 这类关键词被整批拦回，重试到预算耗尽。

**第二条判据：拦「确定做不到」可以，拦「不知道能不能做到」不行。**

能力/状态字段多是 `boolean | undefined`，实际承载三件事：声明支持、声明不支持、**provider 或环境压根没说**。用 `=== true` / `=== false` 收敛时第三种会被静默折向否定，下游据此阻断——2026-08-01 一天内在四个互不相干的模块撞见同一形态：模型能力（未声明→判不支持→`no_usable_model`，用户在设置里选得到却用不了）、Photoshop 连接（快照不新鲜→判未连接，而界面绿灯正亮着）、文档写保护（`observe_only` 识别不出角色→硬禁写，模型 13 次查看 0 次改动）、回复文本误判（正文里一个裸 `401`→整条好回复被换成「当前模型没有通过认证」）。

方向永远折向否定，是因为「保守=安全」的直觉——但在 Agent 系统里这个直觉是反的，**代价严重不对称**：判否是彻底阻断且事后无从诊断（主进程连错误日志都没有）；放行则最坏只是一次带 provider 准确报文的失败。这些预检都在猜一件**后面会被真实执行验证**的事，它们并不比执行知道得更多，只是提前下了结论。

落地：能力判定一律走 `shared/model-capability-verdict.ts`（三态 `status` + 判断依据 `basis` + 人话 `reason`），**只有 `unsupported` 允许阻断，`unknown` 一律放行**；`capabilityBlocksExecution()` 是唯一出口，不要在调用点自己写 `=== false`。唯一该保守的是不可逆动作（删除、覆盖源文件）。形状参照仓库既有样板 `agent-provider-observation-capabilities.ts`，由核心审计和真实执行结果共同校验。

外部技术方案文档（`Agent-System-Development-Guide.md`、`Adobe-Photoshop-Sock-Design-Agent-Technical-Concept.md` 等）的原则**只适用于规格化生产链路**（SKU 批量、白底图导出、模板套版）；开放创意（海报/品牌/"帮我看看能做什么"）走自主循环，不要把那些原则往 agent 路径上搬。

### 进行中的重构（"局部重构"上下文）

1. **`main/index.ts` 拆解**：已基本达标——当前 771 行（`ipc-handlers/` 34 个文件、`uxp-handlers/` 14 个文件），内联 `wsServer.on('action',…)` handler 已清空。过时的 `src/main/REFACTOR-PLAN.md` 已删除；不要按其历史快照中的“当前 5457 行”、`binary-protocol-service.ts` 等目标寻找不存在的文件，后续以代码现状和本节为准
2. **v3 → v5 收口**：把命令式 v3 循环逐步替换为 v5 manifest 驱动的 stage plan。新写业务工作流优先落到 v5 manifest/契约，而非往 v3 执行器堆专属分支
3. **设计能力治理（D→B→A，进行中）**：把详情页 `freshDetailPage*` 状态机编码的设计纪律（先读方法论→取得项目视觉观察→改后必看→不无限微调，本身正确）从执行器下沉到数据/契约层，让所有设计任务（含海报/小红书等新品类）通用继承，executor 回归通用。顺序：**D** 护栏（文档校准 + `audit:executor-generic` 棘轮，已落地）→ **B** 数据基座（`design-task-types.ts` 扩品类 + 收为设计路径统一入口）→ **A** 治本（删状态机、纪律迁到 B + v5 门禁）。D 阶段的通用化产物是 `shared/design-discipline-runtime.ts`（已接入 `autonomous-agent.executor.ts` 与 `detail-page-creative-stage-plan.ts`）。别再往执行器加品类分支——会被棘轮拦下

### 多智能体（design-teams，`renderer/services/design-teams/`）

- **概念蓝图**：`docs/design-agent-blueprint-a0-a9.md`（用户脑图导入，权威）——长期 1 总控 + 9 专业共 10 个逻辑 Agent，第一阶段合并为 6 个执行模块，共享 Design Project State，评审按退回规则路由。扩展角色前先读它
- 4 个队友角色（scene-analyst / design-strategist / executor / critic），定义在 `design-teams/registry.ts`（系统提示 + 工具白名单 + 写权限 + 预算）；分析/评审角色自动优先视觉模型（`coordinator.resolveModelForRole`）
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
- 快照类结果的图像由 `Agent.attachToolImageObservations` 以 user 图像消息回传：仅视觉模型、每次运行最多 3 张；主循环与全部子 Agent（design-teams）共用此机制

### 工具 vs 技能

- **工具**：原子操作，schema 在 `agent-runtime/tool-schemas.ts`（约 80 个，以 `audit:tools` 为准）；UXP 侧实现在 `DesignEcho-UXP/src/tools/registry.ts`，新增需两边同步；执行分类（读/写/导出/外部生成）在 `shared/agent-tool-execution-preflight.ts`——**新增工具必须在此登记分类**，否则被契约按 unknown 拦截
- **技能**：声明 `shared/skills/skill-declarations.ts`（含 visibility），执行器 `skill-executors/*.executor.ts`，注册 `skill-executors/index.ts`；新技能 id 同时要在 execution-preflight 的分类逻辑确认（默认按 photoshop_write）
- **技能不渗透进 Agent（不变量，当前有欠债）**：autonomous-agent 执行器应是通用 ReAct 入口，不为任何品类维护专属工具表 / 正则意图 / 提示分支。工作流知识的家：技能声明（→自动成为技能工具描述）+ 原子工具描述中的链路位置说明 + 数据层（`shared/design-task-types.ts` 结构/intake、v5 `visual-observation-gate.ts` 看图前置条件）。**现状欠债**：详情页「从零设计」在执行器里长出了一整套硬编码状态机（`freshDetailPage*`，约 160 处品类符号 + `evaluateFreshDetailPageToolStateGuard` 顺序门禁 + `selectToolsForContext` 详情页工具白名单 + SKU 提示分支），是该不变量当前最大违例，正在治理（见下「设计能力治理」）。`npm run audit:executor-generic` 以债务棘轮守护：品类耦合只许减不许增
- `template-authoring` 系执行器/技能已删除（`detail-page-template-authoring.executor.ts`、`main-image-template-authoring.executor.ts` 等，见 commit `8ee68190`），但 `isDetailTemplateAuthoringIntent` / `isMainImageTemplateAuthoringIntent`（`agent-orchestration/routing.ts`）仍在，且被 `engine.ts`、`autonomous-agent.executor.ts`、`agent-route-boundary-policy.ts` 调用——这是有意保留的旧措辞重定向（把老说法逼回自主循环，不是指向已不存在的技能），不是残留死代码，别顺手清理
- 工具身份分散在约 10 处（schema / UXP registry / preflight 分类 / 显示名 / scope 等），漏一处会让能力"半隐身"——以 `audit:tools` 为单一校验口径
- 模型调用：`window.designEcho.chatWithTools / chatWithToolsStream` → `model-service.ts`（`provider-adapters/` 适配各家原生 function calling）

### 验证现状

旧的 smoke 脚本、package 命令和分层验证器已经退役并删除，历史需要时由 Git 提供恢复能力。默认回归只走 `maintenance:validate`，由构建、类型检查、静态审计、规划/仓库卫生检查和可复用的真实功能测试组成。不得因为某个功能缺少测试脚本就临时补一份，更不得修改断言、吞掉错误或把假绿当作完成依据。

## 重要约束

### 中文编码（高危）

- 所有文件 **UTF-8 无 BOM**；行尾按 `.gitattributes`：**源码（`.ts/.tsx/.js/.json/.md/.css/.yml` 等）一律 LF**，仅 Windows 脚本（`.bat/.cmd/.ps1`）为 CRLF。本机 `core.autocrlf=true`，但 `.gitattributes` 已把源码钉死为 LF——别在文档里再说"全部 CRLF"
- 终端用 `chcp 65001`（dev/start 脚本已内置）
- 部分历史文档是「UTF-8 被按 GBK 误解码后回存」的乱码（如 `docs/project-status.md`），引用时注意内容不可靠；不要在不处理编码链路的情况下批量重写中文文件
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
