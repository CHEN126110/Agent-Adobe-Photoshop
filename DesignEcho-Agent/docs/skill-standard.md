# DesignEcho Skill Standard

> 文档类型：B 层 Skill Package 规范。
> 当前开发权限：可以指导 Skill 声明、Provider、交互、执行器和评价接入。
> 适用范围：可被 Agent 选择的业务 Skill，不包括原子 Tool 或通用 Agent 核心。
> 不能覆盖：Prompt、Design Agent OS、TaskRun、Capability、Tool preflight、Photoshop 事务和 Release owner。

## 目标

DesignEcho 的 skill 是 Agent 可选择的业务能力单元，不是固定模板脚本，也不是底层工具清单。

这套标准要解决三个问题：

1. Agent 知道什么时候该用 skill，什么时候不该用。
2. Skill 不越界替代 Agent 的观察、判断、复核和用户沟通。
3. Tool、MCP、Memory、Executor 各自保持边界，避免业务流程被硬编码成不可维护脚本。

## 外部技术基线

当前主流 Agent Skills 更接近“可复用工作流知识包”，不是传统语音助手里的应用入口，也不是单纯 tool calling。

DesignEcho 借鉴以下原则：

1. 渐进披露：先让 Agent 看到名称、描述和触发边界，命中后再读取详细流程。
2. 触发准确：`description`、`whenToUse`、`whenNotToUse` 必须共同减少误触发。
3. 脚本克制：脚本只承接确定性、易错、重复的步骤，不能替代 Agent 的设计判断。
4. 证据优先：执行前要有上下文证据，完成后要有真实结果证据。
5. 可评估：skill 要能做 should-trigger、should-not-trigger 和真实输出质量评估。

## 层级边界

| 层级 | 定义 | 不应该做 |
| --- | --- | --- |
| Agent | 理解目标、观察上下文、选择 skill、执行后复核真实结果 | 不把关键词命中当成执行授权 |
| Skill | 可复用业务能力声明，描述适用边界、输入、输出、证据和工具范围 | 不直接变成模板脚本，不私有化工具/MCP/记忆 |
| Executor | Skill 的具体执行实现 | 不决定全局路由，不伪造成功 |
| Tool / MCP | 底层动作、外部连接、Photoshop/文件/搜索等能力 | 不承载业务意图判断 |
| Memory / Context | 项目状态、历史偏好、素材索引、视觉证据 | 不替代当前任务的真实观察 |
| Evaluation | 触发测试、质量检查、真实结果验收 | 不只检查“脚本跑完” |

## Skill Package 组成与唯一 owner

`Skill Package` 是 Agent 可选择的一个用户级专业能力，不等于单个 Manifest，也不等于
一份 `SKILL.md`。当前代码不再新建 Package Registry；Package 由现有真相源按以下关系
只读组合：

| 内容 | 唯一 owner | 说明 |
| --- | --- | --- |
| 用户级入口、模型 Tool 名、简短适用边界和模型可写参数 | `SkillDeclaration` | 一个 Package 恰好一个 user-facing workflow entry。 |
| `task_type`、Manifest、入口 Skill、交付物知识和文档角色 crosswalk | Task Profile | 一个 Package 可以有多个 Profile；不能按 Manifest 注册顺序选第一个。 |
| 输入来源、execution model、work mode、Capability、预算、评价引用和交付契约 | 每个 Task Profile 对应的 Manifest | Manifest 是 Runtime 合同，不重复保存用户级入口说明。 |
| 专业工作法、生产经验和按需深读细则 | `skills/<playbookId>/SKILL.md` 与 `references/` | 只提供知识，不绑定 Runtime、不授予权限、不复制 Tool schema。 |
| 确定性实现与领域交互 | Executor / Skill Provider | 只实现已选 Profile；不做全局路由，不替 Agent 作开放设计判断。 |

主图与详情页当前各有一个入口和一个 `task_type` family；具体 Profile 还包含 Agent 明确
选择的 `workMode`（例如 `create_new`、`redesign`、`edit_existing`）。SKU 有一个入口，但
包含色卡、模板和批量生产三个 Artifact `task_type`。多 Profile Package 必须由模型根据完整
任务语义显式选择；任何 `.find()`、数组首项、文件名或关键词都不能成为 Profile owner。

渐进披露顺序是：先看用户级入口和可忽略候选；模型确认 `task_type + workMode` 后绑定精确
Profile；再取得该 Profile 的方法、Skill 和 Capability；深度 reference 只在当前设计问题
确实需要时读取。文本候选只能减少模型比较身份的认知成本，不能裁剪 Agent 原子 Tool 面、
绑定身份、执行 Skill 或授予 Tool 权限；只读和 no-tool 请求不得被生产 Profile 选择牵引。

以下重复属于标准化缺陷：

1. 在 Playbook、Prompt 或 Executor 再维护一份 Manifest 输入、预算、权限或交付合同；
2. 在 Manifest 中写固定素材选择、版式、文案或审美答案；
3. 同一模型参数同时由 Agent 与 Runtime 拥有；
4. 一个多 Profile Package 没有显式选择，却依赖注册顺序进入其中一个 Profile；
5. 为修一次触发问题继续增加品类专属 Agent / Harness 分支。

## 标准字段

每个 skill 至少必须具备：

1. `id`：稳定、唯一、只使用小写字母、数字和连字符。
2. `name`：人和 Agent 都能理解的名称。
3. `category`：业务分类。
4. `kind`：`workflow`、`operation` 或 `debug`。
5. `visibility`：`user-facing`、`internal-debug` 或 `system-only`。
6. `description`：一句话说明能力边界，不夸大，不暗示万能。
7. `whenToUse`：什么时候用。
8. `whenNotToUse`：什么时候不用。用户可见工作流和高风险业务 skill 必须有。
9. `routing`：仅作兼容或模型候选提示的元数据；不得用关键词、文件名或正则自动绑定 Skill、裁剪能力面、创建等待点或取得执行权。
10. `parameters`：输入参数契约。
11. `output`：输出类型和输出说明。
12. `requiredTools`：允许依赖的底层工具清单，可以为空数组，但不能缺失。
13. `examples`：至少一个正向示例。

## 什么时候用

`whenToUse` 必须描述真实用户意图，而不是只写关键词。

好的写法：

- 用户明确要求生成、导出或补充 SKU 组合图。
- 用户要求基于现有详情页模板检查结构、填充内容或导出切片。
- 用户要求用 SKU 素材生成白底图并保存到主图目录。

不好的写法：

- 出现“SKU”就使用。
- 出现“详情页”就执行。
- 用户问“你能做什么”也进入生产流程。

## 什么时候不用

`whenNotToUse` 是防滥用的核心，不是可选注释。

必须覆盖：

1. 能力问答：用户只是问能不能做、怎么做、支持什么。
2. 规划讨论：用户只想讨论方向，不要求执行。
3. 只读检查：用户只是看一下、分析一下、列一下。
4. 相邻业务：例如主图、详情页、SKU 互相误触发。
5. 从零创意：如果 skill 依赖现成模板或规格化生产，不能接管开放式设计。
6. 用户明确说不执行工具、只说明、先别动。

## 前置证据

Skill 被调用前，Agent 至少要判断当前任务需要哪些证据。

常见前置证据：

1. 用户目标：交付物、范围、是否执行。
2. 当前 Photoshop 状态：文档、画布、选区、图层。
3. 项目上下文：项目目录、素材类型、输出目录。
4. 素材证据：SKU 源文件、详情页模板、参考图、当前选择图片。
5. 视觉证据：截图、缩略图、视觉洞察缓存或实时模型观察。
6. 用户确认：只有用户独占事实、会改变用户可见业务结果的取舍、不可逆动作、覆盖或新增付费授权才需要；普通已委托的可逆 Photoshop 写入和常规导出不重复确认。

缺少关键证据时，skill 应该返回可诊断的阻塞或澄清需求，而不是补默认值制造假成功。

## 工具边界

`requiredTools` 只说明 skill 可能使用哪些底层能力，不代表 Agent 已经获得执行授权。

规则：

1. Tool/MCP 只做动作，不做业务决策。
2. Skill 可以声明需要哪些工具，但不能把工具细节暴露给普通用户回复。
3. Photoshop 写入、批量导出、覆盖文件必须有明确执行范围。
4. 只读检查和写入执行必须分开。
5. Executor 不能因为缺工具就伪造成功。

## 执行模式

Skill 支持的模式以 Manifest /参数契约为准；`routing.supportedModes` 只作兼容提示，不是生产权限或执行 owner。

推荐模式：

| 模式 | 含义 |
| --- | --- |
| `inspect` | 只观察、检查、分析，不写入 |
| `plan` | 输出执行方案或设计策略，不写入 |
| `execute` | 按已知范围执行写入或生成 |
| `export` | 导出文件或切片 |
| `review` | 基于真实证据复核结果 |

开放式创意设计不应该被硬塞进只会填模板的 skill。它应该走 Agent 的观察、计划、执行、读回、复核循环。

## 输出契约

Skill 的输出必须能被 Agent 继续判断，不只是“完成了”。

至少包含：

1. 成功或阻塞状态。
2. 真实产物或证据位置。
3. 执行过的关键动作。
4. 未完成项或需要用户确认的事项。
5. 可用于复核的截图、图层、文件或报告证据。

禁止：

1. 没有真实证据却声称设计质量达标。
2. 脚本执行完就直接说成果满意。
3. 用空对象、默认值、静默失败掩盖缺失上下文。
4. 把内部工具名、JSON 协议、Executor 细节直接写给普通用户。

## 触发评估

每个可自动触发的 user-facing skill 都需要可复跑的触发评估。

至少分四类：

1. should-trigger：应该命中该 skill 的真实用户说法。
2. should-not-trigger：相似关键词但不应该命中的说法。
3. ambiguous：应该澄清或保持只读的说法。
4. continuation：用户说“继续”“再补一下”时，是否继承上一轮任务。

触发评估不能只测关键词，要测用户真实意图。

## 真实结果验收

Skill 标准化不能停在声明完整。最终验收以真实效果为准。

验收优先级：

1. 真实 Photoshop 输出、截图、图层或文件证据。
2. 可复核的导出结果和报告。
3. 用户可见回复是否符合真实使用视角。
4. 自动 smoke 只作为回归保护，不替代真实效果验收。

## 高风险业务 skill

当前重点保护三类：

1. `main-image-design`
2. `detail-page-design`
3. `sku-batch`

这些 skill 必须更严格：

1. 必须有 `whenNotToUse`。
2. 必须有正向触发信号和负向触发信号。
3. 必须有前置证据说明。
4. 必须有模式边界。
5. 必须有决策提示，说明相邻业务如何区分。
6. 修改会改变用户可见业务结果、默认交付规格或接受阈值的策略前，遵守 `docs/business-skill-design-governance.md` 的业务 checkpoint；技术路线、内部重构和保持输出不变的根因修复由工程 Agent负责，不把专业选择题交给用户。

## 反模式

禁止以下模式：

1. 关键词命中即执行。
2. 把 skill 写成固定模板脚本。
3. Agent 不观察、不复核，只调用脚本。
4. 为了防误触发不断叠加负向补丁，但不修正底层路由标准。
5. Skill 私自定义一套工具、记忆、视觉缓存或 Photoshop 边界。
6. 用户只是问能力，系统却开始生产。
7. 用户要求从零创意，系统却套旧模板。
8. 对用户输出内部技术过程、JSON 协议、Executor 名称或工具栈细节。
9. 没有真实证据却宣布完成。

## 推进方式

标准化分三步做：

1. 审计：用脚本列出 blocker 和 warning，不马上重构全部旧 skill。
2. 收敛：优先修 `main-image-design`、`detail-page-design`、`sku-batch` 的边界和触发测试。
3. 深化：再决定哪些 operation wrapper 应该保留为 skill，哪些应下沉为 Tool/MCP 能力。

当前阶段的机器检查入口是：

```bash
npm run audit:skill-standard
```
