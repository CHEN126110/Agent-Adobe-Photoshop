# 2026-08-03 DESIGN-HARNESS-VERTICAL-CONVERGENCE-001 / 当前状态

本文件只记录当前事实摘要。历史实施日志由 Git 承担；不能从历史日志反推当前完成度。

## 2026-08-13 运行恢复、事务读回与失败诊断改造

- 已先按当前共享工作树核对外部任务书，没有机械套用过期行号。T1 的 `ReadonlyArray` 已存在并通过类型检查，因此未重复修改。
- 真实运行诊断已从“仓库里只看到 2 条”恢复为默认发现 420 条 `agent-run-record/v0`；`--since 2026-08` 精确读取 202 条。扫描来源按显式项目、历史会话真实项目集合、仓库兜底排序并去重；档案现为列表、汇总、JSON 与 `--trace` 的主数据源，8 月口径复现 78 次成功、1919 次 Tool Call、193 次失败，不再回退为 73 条会话摘要。
- Skill 内部原子 Photoshop 调用新增一个 Harness-owned 串行 owner，复用现有 preflight 和 documentId / revision guard。`sku-color-card` 的写→读→写链不再直接调用 raw Tool executor；文档切换会失效旧目标，必须重新读取后再写。
- 失败写入恢复按 Host 事实分流：明确 `not_applied` 不阻断同一批次的独立后续写；`unknown` 只开放最多两种同文档读回能力，不自动重放；读回仍是原 revision 时可更换失败 provider，revision 已变化或无法确认时继续锁定现场。
- Provider 截断恢复使用 1× / 2× / 4× 输出窗口，模型硬上限始终生效；补偿轮仍记 Provider 调用但不重复扣普通模型轮预算。正式 Agent 行为回归验证 1200 / 2400 / 4800。
- 十个高频 UXP 操作工具均已核对并纳入严格读回：`moveLayer` 保留原有合格事务实现；create/group/reorder/place/duplicate/quickScale/createText/setText 等内容或结构写入补齐真实 ID、层级、bounds、文本、位置或比例核对并在失败时回滚；`selectLayer` 核对完整活动图层 ID 集合并拒绝部分选择。
- Agent 与 UXP 的公共失败边界现在补齐稳定机器码、具体原因和可行动下一步；已有 Tool code 不被公共层改写。目标文档或 revision 变化仍在写前中止，直接 UXP/MCP 调用也不再只返回裸 error。
- 正式 `maintenance:validate` 22 项全部通过：Main / Renderer 类型检查、真实 Agent Runtime 行为、业务边界、Capability / Executor / Tool / Skill 审计、Agent 测试和 UXP production build 均为绿色；最新 Renderer production bundle 另行构建成功。没有新增一次性 Smoke，也没有修改债务基线制造假绿。
- 当前 Electron 主进程于 10:26 启动，最新 Renderer 于 11:40 生成，UXP bundle 于 11:34 生成；现有桌面进程没有加载本轮最终代码。为避免打断用户正在使用的 Photoshop，本轮没有擅自重启 Electron、重载 UXP 或在旧运行时上制造无效真机结论。
- 尚未验证：真实 Photoshop Host 上的 `sku-color-card` 完整链、十个事务工具的故障注入/回滚、桌面 Agent 成功率和设计质量。自动验证只证明当前代码与正式契约一致，不能替代真机结论。
- T8 未自动处理：当前 `DesignEcho-Agent` 仍有 303 项共享脏改（248 修改、7 删除、48 未跟踪）。本轮没有暂存、提交、清理或恢复任何用户/其他 Agent 改动，后续必须由人工决定提交拆分。

## 2026-08-13 设计师体验与后台自动记账分离

- 用户明确取消产品 Agent 的“举证”职责：设计 Agent 应像设计师一样理解、制作、看效果和调整，不应背诵 Harness、Runtime、阶段、权限或验收协议，也不应把内部检查组织成用户可见报告。
- 架构边界已重新确认：后台仍自动记录目标文档 / revision、真实 Tool 结果、保存与导出状态，用于防止误报和误覆盖；这些事实不由模型自报、不进入设计方法，也默认不展示给用户。
- 生产模型提示、Capability 动态上下文、阶段与复盘提示已经收敛为设计语言：只查看影响下一步判断的信息，尽早制作可逆版本，查看效果并有限调整；Manifest、Profile、阶段编号、Provider 引用、权限解释和完成计数仍由 Runtime 私下处理。
- Skill 的原始结果只在进入模型前做白名单投影。模型只看到做了什么、当前问题、下一步和是否等待用户；原始 Tool 明细、Continuation、卡片 owner、操作账本与完整 Run Record 保持不变。普通日志也只保存浅摘要，避免再次序列化真实 SKU 运行中曾超过 40 万字符的工作流对象。
- 用户过程区只接受显式 `audience=user + visibility=user_process` 的投影；普通 Tool、Skill 包装、迭代计数、成本账本和后台完成数组不再旁路显示。任务计划按“查看素材、确定方向、制作、调整、交付”等设计动作投影，不显示模型声明的 Tool /阶段原文。
- Agent 的异常恢复、续做、交付收尾和改后复盘提示已进一步改成简短设计动作语言；模型不再接收长篇英文 Runtime 状态、阶段号、证明式要求或整块 JSON 复盘信封。安全边界仍在执行点生效。
- Runtime Context 与单轮 Message Context 的内部 trust / authority / source / Manifest 身份仍用于程序选择和隔离，但不再写进模型正文；模型只看到“项目现状、专业设计方法、实际观察、当前操作说明”等自然内容。外部参考和工具观察继续有明确边界，不会因此获得指令或权限。
- 最终用户结果由单一投影生成，只根据本轮实际修改、保存 /导出、外部素材生成、必要观察和是否看过改后画面说明“做出了什么 /有没有版本 /下一步”；`summaryText`、blockers、lastError 和内部验收数组不再由 UI 二次拼回用户卡片。
- “有可看版本”只接受 Photoshop Host 返回的真实改动，或真实保存 / 导出结果；写工具仅返回 success、完成计数增加或 UI 兜底都不能再声称画面已改变。普通自然追问与交互确认卡也已分开：前者保留 Agent 的实际问题，后者才显示卡片确认和绑定续跑。
- Provider、Runtime 和 Tool 的原始错误继续保存在运行记录和开发诊断中，但用户过程与最终回复只展示可理解、可行动的自然信息；没有可靠公开映射时使用中性说明，不把内部报文包装成“错误：原文”。
- SKU 已建立用户提示与私有诊断双通道：用户只看到具体规格、模板、排版或文件问题和下一步；能力版本、Photoshop 修订、排版 QA、导出读回及原始错误仍保留并继续决定任务是否完成，但不再直接展示或灌回设计模型。
- SKU 交互顺序已按用户最新要求校正：裸“帮我做 SKU”先检查或补齐色卡、模板和占位符，再生成 2 /3 /4 候选组合并显示一次组合卡；确认后直接批量生产。明确跳过组合确认、已确认 continuation 或项目已有受信权威组合时不重复弹卡。该规则只在 SKU Skill 内，不进入通用 Harness。
- SKU 模板设计交接给模型的是目标、版面与占位符要求、可编辑性和下一步；内部 allowlist、revision、精确读回与 owner 重入仍由同一 continuation 机制管理，没有把 SKU 流程写进通用 Harness。
- 正式 `maintenance:validate` 22 项全部通过，包括仓库卫生、UTF-8、162 Tool、18 Skill、Capability、Runtime 声明、Agent 业务边界、Prompt 治理、Main / Renderer 类型检查、Agent 核心测试与 UXP production build。第一次全量验证如实发现旧审计仍要求不可靠的写调用计数口径；生产行为没有回退，审计被迁移为真实 Host 改动或保存 / 导出边界后再次全量通过。
- 尚未验证：当前桌面应用加载新构建后的真实 Provider → Photoshop 设计体验、首次有效写入速度、SKU 色卡/模板/占位符/2-3-4 组合交付和人工审美质量。自动检查通过只说明代码边界没有已知回归，不代表 Agent 已经“很会设计”。

## 2026-08-12 简单 Agent → Skill / Tool 主链恢复

- 真实故障位于 Harness，而不是 Photoshop / UXP：旧链把 advisory SKU recommendation 变成必须先调用 `declareDesignIntent` 的硬门，并将首轮 Tool Schema 收窄；模型又按通用 Schema 给无模式 SKU Profile 携带 `workMode`，绑定失败后停留在 6 model / 10 tool / 8 iteration / 120 秒的小预算中。隐藏开场读取、控制 Tool 和普通观察共同耗尽额度，写入没有抵达 Host。
- 当前真实项目为 `E:\WERKE\C-1245`。失败 Run Record 证明 `declareDesignIntent`、`requestAgentCapabilities` 与只读调用均是真实模型 Tool Call；并非模型只说不做，也不是 Photoshop Tool 缺失。Completion 0/4 是零写入后的正确结果，不是根因。
- 当前主链已恢复为：Agent 理解需求；匹配注册 Skill 时直接调用 Skill；无匹配 Skill 时自主规划原子 Photoshop Tool；执行后读回、有限修正并交付。候选推荐只作提示，不授权、不拦截、不签发 mandatory control Tool。
- SKU 领域只有一个完整用户级入口 `sku-batch`。色卡、模板、组合规划、生产与恢复属于 Skill 内部；通用 Agent / Harness 不维护 SKU 阶段、占位数量、组合规则或专属工具笼。
- `declareDesignIntent` 保留为可选后台 Task Profile 绑定：精确 Profile 确实能提供专属方法、阶段、预算或评价时可调用；它不是分析、Skill 调用、Photoshop 写入或完成任务的许可，也不在默认启动基线中。
- 未绑定自主运行总上限已恢复为 16 model / 50 tool / 30 iteration / 420 秒；匹配 Skill 时仍应尽快调用，预算不是鼓励用完。未绑定运行不再提前购买一个最终不会执行的通用 VLM Judge reserve。
- Broad discovery 首轮同时暴露用户可见 Skill bridge 与最小充分设计 Tool：项目/文档观察、画布、置图、文字、变换、参考和快照。无匹配 Skill 的开放设计不会因缺 Runtime Profile 退化为只读循环。
- Skill nonFatal handoff 现在可通用激活其结构化声明的后续原子 Tool，只从当前 on-demand 候选且未被 deny / Manifest ceiling 禁止的集合中选择；不执行 Tool、不授予权限、不按品类分支。SKU 缺模板后可在同一 Agent 运行中继续完成可编辑设计。
- Harness 继续保留真正需要确定性的边界：documentId / revision、读后写、显式保护、不可逆操作确认、同目标写后读回、交付收据、Completion 与全局预算 ceiling。开放创意的文案、排版、风格和下一步不由 Harness 固定 DAG 接管。
- Runtime Profile Catalog 仍由 Manifest / Evaluation /权限安全边界派生。当前 16 个 Profile ready；详情页 `analyze_only` / `export_only` 两个能力尚未收窄的模式保持 blocked。SKU Template 复用通用设计 Evaluation，可声明但没有新增 SKU 专属评价 Owner。
- 自动验证通过：Main / Renderer 类型检查、`npm test`、Agent 业务边界、Capability Resolver、Runtime Declaration、Skill Package、Skill Standard、Skill Coupling、通用 Executor 与定向 `diff --check`。没有修改断言、吞错误或提高债务基线制造假绿。
- production bundle 于 14:50 生成，当前 Renderer 进程于 14:53 创建并已加载。DesignEcho Host 健康、Photoshop UXP 已连接、pending request 为 0、129 个实时 Tool 可见；项目根核验为 `E:\WERKE\C-1245`。
- 未验证：当前活动 `SKU.psb` 为 800×800、11 层且有未保存改动，本轮没有对该用户文档做写入。2/3/4 双装的首次真实写入、同目标读回、导出文件、跨 Run 续跑和相对 `D:\A1 neveralone旗舰店` 的人工审美质量仍需在一次可隔离的真实 Agent 回归中单独记账；自动测试通过不等于商业设计质量通过。

## 2026-08-11 真实项目 SKU 自主设计基线

- 已核实（手测）：通过当前已运行 DesignEcho 的既有调试桥提交普通用户 2/3/4 双装 SKU 交付请求，没有启动第二个 Electron / Photoshop 实例。当前项目为 `C:\Users\12611\Desktop\测试\测试`，基线时 41 张素材、Photoshop 无文档、SKU/PSD/输出目录无产物。
- 已核实（真实运行）：Agent 先做一次项目联系表视觉分析，随后仍宣称“从 41 张里抽取 12 张样本”并逐张调用视觉模型；前 7 个近看样本中 6 个来自模特目录。最终约 20 分 33 秒、24 iterations、25 model calls，0 Photoshop mutation、0 输出文件，以 `tool_preflight_blocked` 收尾。
- 已核实（代码）：`project-image-analysis.executor.ts` 将模型请求的 sampleSize 允许到 12；联系表选出素材后又用 `buildPreferredImages` 回填到 sampleSize，并逐项串行调用 `analyzeAssetContent`。数字文件名的 series 分组不能区分模特 /平铺目录，导致同类照片连续入选。
- 已核实（事实边界）：项目目录没有 CSV / XLSX，当前没有连接的 Excel workbook 会话；因此 4 双组合规则、颜色名和款式映射不能从本轮已知事实推断。后续必须从桌面应用现有项目数据源取得或精确报告缺失字段。
- 已修复（项目观察成本）：联系表输出成为语义覆盖证据，只对明确不确定的关键角色做少量、多角色近看；已有产品理解时不再追加模型总结调用。
- 已修复（执行入口）：`sku-batch` 可在无 Photoshop 文档时进入项目扫描与受控新建；缺模板时在同一 Workflow repair continuation 中自主创建、设计、看图、保存和读回，独立模板任务仍保留方向确认。
- 已修复（真实委托边界）：用户原文明确委托可逆组合判断时可继续生成 `agent_delegated_draft` 候选，但不取得权威业务事实信用；前置条件可用后默认展示组合卡，用户确认后再生产。“识别”中的“别”不再误判为撤销委托。
- 已修复（成本上限）：SKU 四阶段链从旧上限 26 模型 / 90 工具 / 50 iterations / 600 秒收敛为 16 / 50 / 30 / 420 秒，视觉上限 6 候选 / 2 分析。Renderer/Main 类型检查、Agent 业务边界、Capability、Skill Package、Tool Registry 和通用 Executor 审计全部通过。
- 未验证：当前已运行应用没有加载本轮新构建，且本轮遵守约束未重启、未新开、未杀进程；修复后的首次有效写入延迟、2/3/4 双组合正确性、PSD/PSB 可编辑结构、导出产物和与验证集相近的人工审美质量仍待该实例自然重载后复跑。

## 2026-08-11 自主设计能力研究与实施切换

- 用户目标已明确为默认自主的专业设计 Agent，而不是更多工具调用或更多人工确认：Agent 应自行理解、设计、落地、看结果、诊断和有界修正；人工只处理用户独占事实、不可逆风险、能力真实缺失或返工超限。
- 代码审计确认现有能力不是空白：Task Profile、R1/R3/R4、Design Kernel 方法知识、Project State、reviewed memory、Eagle、Photoshop Tool、逐图视觉观察、Evaluation Profile、DesignVerdict 与 Reflexion 都有真实生产接线。核心问题是这些组件没有成为主图/详情页/开放设计默认必经的一条质量闭环。
- 已确认两个首要生产断点：普通自然语言晚绑定 Manifest 后不会回补启动时缺失的 reviewed memory，Reflexion 新 Agent 继续复用启动时的 Project State / Memory；详情页虽已有同 history 的全部屏截图和逐屏 review，终局 R5 Judge 仍只消费一张完整画布，无法证明跨屏叙事和全部屏质量。
- 已确认 Candidate 断点：现有 variant/composition 多为文字策略或固定首选，没有“真实预览 → 同 rubric 比较 → 选择胜者 → 只生产胜者”的通用 CandidateSet。该能力按下一纵切实施，不用更多 Prompt、更多队友或品类 Skill 替代。
- 当前进入 `AUTONOMOUS-DESIGN-KERNEL-V1`：先在唯一 Context Compiler、现有 VisualObservationBundle、Evaluation/DesignVerdict 与 Reflexion Owner 上闭合 generation-scoped 上下文和完整视觉集合评价，再做 CandidateSet / DesignIR。尚未改写完成事实，也未取得真实 Provider → Photoshop 或人工质量证据。
- 已完成请求复杂度成本纵切：自然语言设计通过结构化 `taskType + workMode` 选择模式级阶段、Capability ceiling、模型 token/thinking 策略与 Evaluation Profile；精确文字替换只开放文档身份、完整 acceptance snapshot、`setTextContent` 和必要读回，不进入 Eagle、Design Team、完整策略或全画布 VLM。
- 已完成精确文字可信闭环：Engine 签名 scope → 全文档唯一目标 → 原文/文档/history CAS → Photoshop 写入 → 完整 acceptance diff → 最终 Host history。错误 layer/value、目标歧义、快照截断、外层失败但 Host 已证明越界、最终 history 缺失或后续 mutation 均不能取得 scoped 完成信用；合法长文案与 Photoshop CR 多行文字已纳入正式回归。
- 已完成跨 generation /复合 Agent 成本治理：Runtime 累计模型、工具、迭代、视觉候选、视觉分析与活跃时长；预算耗尽不再 Reflexion 重购，Design Team allowance 启动前全额预记且不退款；Provider 图片一次消费后退休历史像素，终局 ReviewSet 按真实 presentation 数量计费。
- 已验证完整 `maintenance:validate` 21 项全部通过，含 Main/Renderer 类型检查、UXP production build、Agent 业务边界、Tool/Skill/Capability/Prompt/Gate/三态/设计智能审计、中文编码、仓库卫生和核心测试。尚未验证真实 Provider → Photoshop 的改单字端到端耗时/费用，也未证明主图/详情页已达到稳定商业审美质量；下一纵切仍是 CandidateSet / Preview / DesignIR 与真实样本基准。

## 2026-08-11 Agent 重复观察与行动活性治理

- 已核实真实运行根因：附件只引用 `2双自选备注.jpg`，旧 Agent 文本恢复却用裸 `jpg/png` 正则生成“用户要求导出”的虚假义务；任意成功读取会刷新未完成续跑；同一事实经不同 Tool 返回仍被算作新进展；快照 cache hit 虽不再访问 Host，却仍会重复发送给视觉模型；RuntimeSession 进入 `needs_reobserve` 后缺少接受新 revision 的重新规划状态转换。
- 已退役从任务正文、附件扩展名和模型措辞猜导出 /关闭动作的第二恢复 owner。结构化 TaskPlan / Runtime 继续拥有真实交付义务；只读 Tool 失败保留原始精确原因，不再泛化为无证据的大文档或格式结论。
- 已将 `getDocumentInfo`、`getLayerHierarchy`、模板解析及 Canvas /Annotated Snapshot 全部绑定可信 `documentId@historyStateId`。Runtime 以对象身份签发 cache hit，伪造或复制字段不能取得运行时信用；缓存图不再重复显示、不进入视觉观察、不消耗视觉候选，缓存复用也不更新执行目标、不满足 R2、不进入 Stage Trace 或用户可见观察 /成功计数。权威文档屏障（含打开项目 /模板、进入智能对象、autoOpen）、活动图层、undo /redo、项目状态和资源变化统一清缓存。
- 已把未完成续跑和阶段 liveness 改为语义进展：TaskRun status、plan revision、current node、target document /revision /binding、成功 operation result、输入与 outcome 才构成稳定进展；成功读取总数不再刷新 key，跨 Tool 同义事实也不凭 Tool 名续命，novel fact credit 有界。
- 已复用现有 RuntimeSession / Runtime Stage reducer 闭合文档变化：外部或用户修改触发 `needs_reobserve` 并使旧 plan 失效；完整创意链只有在 R4 绑定 observed revision 的新 plan 才释放同一 TaskRun writer；无 R4 的 `sku-batch` / `sku-color-card` 则由 R2 真实文档观察精确确认 conflict revision 后恢复 E1。连续 11→12→13 漂移会再次退回 R2并清空旧观察，旧 revision mutation 仍被拒绝且不自动重放。
- 已验证：`build:typecheck:renderer`、`audit:agent-business-boundaries`、`audit:simplification-ratchet` 均通过；完整 `maintenance:validate` 21 项全部通过，含 Main / Renderer 类型检查、Agent 行为与业务边界、Tool / Skill / Handler / Prompt / Gate /三态 /设计智能审计、仓库卫生和 UXP production build。简化棘轮从 24 收紧到 22，没有提高债务基线或修改断言制造假绿。
- 当前边界：本轮证明通用运行时契约和接线，不证明真实 Provider 已更果断，也不证明投诉中的 JPG 已修好。实际 `SKU.psb` 是完整可编辑色卡源；自选备注 4 色进入 2 区时的 `arrangeDynamic` 多卡同区缩放、复制后结构 /bounds 验收，以及导出读回 blocked 仍可能顶层 `success:true`，属于独立 SKU 确定性业务缺陷，必须在后续切片单独修复和回归。
- 未验证：重启后同一 SKU 纠错对话的首次有效 mutation 延迟、重复结构 /视觉观察率、新 revision 重新规划后的真实写入、同目标读回，以及最终自选备注色卡质量。

## 2026-08-09 SKU 纯底素材精修与色卡闭环

- 已在唯一用户侧 `sku-batch` Skill 内接入 `prepareSkuRetouchAssets` 原子工具，没有新增第二个 SKU Skill，也没有向通用 Agent executor 增加 SKU 品类分支。
- 主进程新增版本化精修服务：BiRefNet 主体蒙版、批次中位形态基准、中心线与逐行宽度轮廓受约束归一、独立标准棚拍阴影、批次低频亮度统计及可编辑 Soft Light 中性灰修正图。旧 `optimized-displacement` 因坐标空间、轮廓顺序和位移场尺寸契约不一致，未作为生产主路径。
- SKU 色卡执行器在建文档前自动分类纯底/场景；纯底智能对象写入隐藏原图备份、主体、阴影和中性灰层并读回智能对象、剪贴、混合模式、边界和最终快照；场景图跳过纯底精修，保留给场景设计方向。
- 真实五色 4480×6720 原素材已用 DirectML BiRefNet 回归：五张自动判定为 `studio`，置信度 0.74–0.88，自动参考为黑色；输出统一为 828×1337，五项报告检查全部 `passed`。形态残差由 0.0165–0.0290 降到 0.0046–0.0081（参考图为 0），光影残差由 0.0104–0.1053 降到 0.0035–0.0343。首次运行约 44.5 秒，版本化缓存复用为 4 ms。
- 真实预览已人工检查白色、黑色、奶白、浅灰和深灰：通道步长错误造成的周期条纹已按根因修复，产品颜色与针织高频纹理保留，阴影不再提取原 JPEG 背景噪声。
- 已通过 Main/Renderer 类型检查、163 Tool 注册审计、18 Skill 声明审计、8 Skill package 契约、Handler、通用 executor、默认 5/5 形态回归、UXP production build 与 `git diff --check`。完整 `maintenance:validate` 只在本切片未修改的 legacy/fallback 意图简化棘轮 `147 > 140` 处失败；没有修改基线、断言或并行代码制造假绿。
- 旧 `exam:sku:card` 是只读候选诊断器，只读取路径、尺寸和视觉缓存，不消费新精修工具；对只有五张图片、没有视觉缓存的目录仍报告 `blocked_missing_execution_assets`。生产闭环由 Agent 观察/选择来源后进入统一 SKU Skill 与新工具，二者不能混称同一验收。
- 未验证：本轮环境没有暴露 DesignEcho Photoshop MCP 运行时工具，因此尚未在真实 Photoshop 文档中完成 `createDocument → 智能对象分层写入 → 同文档读回 → 保存 PSB` 实机 E2E；也未用多款袜型和人工精修基准证明稳定商业质量。

## 2026-08-08 Eagle-first 设计知识审计、Task Context 修复与知识库 UI 重构

- 产品定义已收敛：DesignEcho 不做第二个 Eagle、Obsidian 或 SiYuan。Eagle 继续拥有原图、文件夹和标签；DesignEcho 只拥有经来源约束、审核和任务用途约束的设计判断。素材被 Agent 看过不等于已成为正式知识，`Task Context / Candidate / Validated Knowledge` 保持分层。
- Phase 0 审计结论为 `core_validated / partial_runtime_consumer`：KnowledgeNode、Evidence、Relation、TaskContext、Candidate、LearningEvent、检索与写回契约存在，42 项专项审计通过；但现有全部 knowledge tool 并未统一迁移到新 Service，不能宣称完整 Foundation runtime 收口。
- Phase 1 审计结论为 `runtime_integrated_partial / live_agent_unverified`：TaskContextBuilder 已由 autonomous Agent executor 实例化并注入 loop，聊天可展示只读 Context 卡；本轮修复了“只有 id/标题、没有真实知识内容”的根因，新增有界 excerpt、来源、生命周期与选入理由，外部 Eagle/Web 保持 observation/candidate，不再冒充 validated。普通任务不自动检索 Eagle，空 Context 不再注入或展示。尚未用真实 Provider 证明每轮 Agent 的实际消费与决策质量，Context 审计事件也仍只是诊断日志。
- Phase 2 审计结论为 `contract_only`：Obsidian parser/hash/atomic write、watcher、vault service 和 Candidate Gate 纯逻辑存在；但主进程产品入口、IPC/preload 和知识 UI 没有实例化这些 Owner，`KnowledgeSyncStore` 仍是内存 Map。确认收据只校验形状，没有主进程签发、过期与一次性消费 Owner。当前可见“待我审核”继续使用既有 `MemoryService` 生产路径，不能把它冒充为新 Candidate Gate / Obsidian 双向闭环。
- Phase 3 审计结论为 `core_validated_isolated_io`：视觉关系构造、正反例反查与 RelationStore 真实临时文件 IO 已通过；但 Store 只被专项脚本实例化，没有产品 IPC、UI 关联动作或 Context Builder 的 Rule + Positive + Negative 运行时检索，因此不满足路线图退出条件。
- Phase 4 审计结论为 `contract_only_with_isolated_store`：重复、冲突、freshness、health 和 merge 纯逻辑通过，KnowledgeIndexStore 独立 IO 通过；没有运行中的 Steward、陈旧复核调度或面向用户的冲突处理闭环。
- Phase 5 审计结论为 `existing_learning_owner_live / new_contract_not_integrated`：既有 MemoryService 候选复核是当前产品 Owner；新 LearningEventStore 与重复模式检测仅在临时文件脚本中通过，尚未接 TaskRun、用户反馈、before/after、Accepted Revision 和版本证据，不能宣称 Design Feedback Learning Loop 完成。
- Phase 6 审计结论为 `pure_state_machine_only`：16 项命题状态机测试通过，External Signal 不能直接成为知识；但没有 Web/PDF/Video ingestion、Brainstorm Session、Proposition Store/UI 和真实用户确认收据 Owner，所以不是产品功能。
- “运行时持久化层完成”声明已纠正：IntelligenceDb 的原子写、重开、损坏隔离以及 Relation/KnowledgeIndex/LearningEvent Store 的 8 项真实 IO 测试通过，证明 Store 实现可工作；仓库产品代码没有导入或实例化这些 Store。专项脚本现已明确标注“独立 IO 测试，不代表产品运行时已接线”。盲目接入会与现有 MemoryService 形成第二知识/学习 Owner，本轮没有这样做。
- 知识库 UI 已重构：导航只保留“知识总览 / 可用知识 / 待我审核”；总览解释“收集素材 → 看图提炼 → 人工审核 → 加入任务”，展示正式知识、候选、任务固定引用、最近使用和 Eagle 双通道；可用知识页把内部 recipeId、长 Runtime 契约和 Tool 标签收起为一句设计意图，按使用方式说明“Agent 按需取用 / 可固定到任务 / 审核后可用”；审核页移除了会误导用户的自动学习设置，明确只有人工批准后才会复用。
- 知识检索后端已把统一知识与 Eagle MCP 两个独立来源并行，避免外部等待串行叠加。Electron 假运行时中“构图”全来源检索约 0.34 秒返回 2 条内置方法与 1 条 Eagle 候选；这只证明页面交互和来源降级，不代表真实 Eagle 用户库的速度或语义质量。
- 可见 UI 回归已通过：在隔离 Electron debug 窗口检查 1200×800 与宽屏，总览按内容容器自适应，无横向溢出；知识检索、审核空态、键盘焦点、Eagle 页面入口和双通道说明可见。截图保存在 `output/playwright/knowledge-ui/`，属于开发验证产物。
- 已验证：Main/Renderer 类型检查、Agent production build、42 项 Design Intelligence 审计、16 项命题状态机、8 项 Store 独立 IO、Agent 默认测试、Capability、Skill Package、Prompt、Gate、UXP production build 与 `git diff --check` 通过。
- 完整 `maintenance:validate` 未形成全绿，原因是共享工作树中本切片未修改的三组债务棘轮：`agent-intent-control-plane.ts` 新增 7 个 `new RegExp`，使简化计数 `147 > 140`；业务边界中的 `agent-intent-control-plane.ts 28 > 22`、`agent-task-planning-contract.ts 58 > 51`；`task-completion-contract.ts` 的 SKU 子集出现 8 个旧版未登记词。规划、卫生、编码、Tool、Handler、Skill、通用 Executor 等此前 7 项已通过。没有回退这些并行改动，也没有抬高基线、改断言或跳过失败来制造假绿。
- 未验证：真实 Eagle 用户库与 MCP 实机、素材移动/删除后的稳定引用、真实 Provider 对 Task Context 的消费、候选确认收据主进程 Owner、Obsidian 双向同步、Phase 3–6 产品闭环、Agent→Photoshop 主图/详情页设计质量与商业稳定性。

## 2026-08-04 模糊委托、新建文档死锁与假完成根因修复

- 已核实（真实 Run Record）：自然请求“再新建一个文档，尺寸随意都行”首次在 Tool 前停止的直接原因是 DeepSeek HTTP 503 `Service is too busy`，不是 API Key、用户措辞或 Photoshop 门禁；服务恢复后的同一请求又被 `create_document_target_unresolved` 重复拦截，`listDocuments` 无法改变门禁输入，最终 20 轮、0 mutation 却被标成 completed。这是两个独立根因。
- 已修复（设计判断 ownership）：用户说“随意、你决定、看着办、按常用规格、合适就行”视为把可逆专业选择委托给 Agent，而不是缺少输入。该规则是品类中立的设计决策原则，没有新增新建文档 /白底图 /SKU 关键词 Router 或专属状态机。
- 已修复（目标边界）：`observe_only` 表示当前文档只是只读上下文，不再以未知角色阻断建立独立目标；只有用户明确绑定继续修改当前文档形成 `reuse` 时，`createDocument` 仍会因防分叉被拦。
- 已修复（完成与验收）：一旦模型真实尝试 Photoshop 写入、导出或外部生成，零成功交付不能再由成功读取抵消为 completed；`createDocument` 允许合法的 before 无活动文档，并用写后 documentId、名称、尺寸和分辨率验证结果，规格不一致仍失败。
- 已修复（Provider 瞬时故障）：`service_unavailable / network / timeout` 只在本次模型请求尚未产生任何流式内容或 Tool proposal 时同模型重试一次；不切换模型，不重放 Photoshop Tool。仍失败时用户会看到“服务繁忙 /网络 /超时”的真实分类和正式 failed execution summary，不再误导检查 API Key。
- 已接入（现有 loop guard owner）：同一 policyGate 在一次 Run 内累计命中 5 次时停止原样重试；不同门禁分开记账，等待用户确认的 HITL 卡不计入。同步修复旧 loop guard 在 `ToolResult` 包装外层读取 `policyGate` 的错层问题，统一读取真实 `output`；停机文案明确这是系统门禁路径问题，不把责任推回用户描述。
- 已验证（代码）：四种自然用户问法、合法“无文档→新文档”、尺寸不一致、重复门禁与 HITL 排除均已进入正式 `audit:agent-business-boundaries`；Main /Renderer 类型检查和完整 15 项 `maintenance:validate` 通过，其中包括规划 /卫生 /编码、162 Tool、20 Skill、Capability、8 Skill Package、Prompt、5/5 核心测试和 UXP production build。
- 未验证（真实结果）：本轮遵守共享窗口约束，没有启动或关闭 DesignEcho /Photoshop，也没有写入用户 PSD；因此最新构建下的真实 Provider → createDocument → Photoshop 写后读回、多问法稳定性和设计质量仍待一次性文档可见回归。

## 2026-08-03 标准设计 Agent 最短专业路径：R3 与能力自知根因修复

- 已核实（真实运行）：Run Record `run-20260803115420027-31eea942.json` 的用户目标是从项目选择图片、置入、抠图并制作 800×800 白底图。运行共 11 轮，读取了文档、资源、Project State、缩略图和图层但没有 Photoshop mutation，最终错误地把“透明商品素材”声明为唯一 blocker 并进入 `waiting_user`。这不是白底图 Skill 缺失，而是通用 Runtime 误判。
- 已修复（R3 所有权）：`resolveRuntimeStageNeedsInputRecovery` 不再把 R3 `blocking` missing input 转成 observation / knowledge recovery。R3 blocking 现在只表达用户独占输入；可观察事实必须先观察，Agent 已有工艺必须进入执行，不再用重复项目检索代替动作或澄清。
- 已修复（能力自知）：结构化 Intent Control Plane 已签发 `write_photoshop + confirmed_tool_required` 时，普通自然语言设计请求也会取得通用设计执行 Capability 基线，不必先猜中 SKU /主图 /详情页身份；基础集合补齐 `photoshop.write.removeBackground`。这只改变模型可见能力，不扩大 Tool 权限、请求写范围、TaskRun 或 revision 边界。
- 已删除（第二执行 Owner）：移除了从 assistant 回复文字正则猜测 `createTextLayer / moveLayer / export` 等 Tool 并强制重规划的恢复链。没有真实 schema-bound Tool call 时，系统不再用猜出来的动作掩盖 Provider /Runtime 失败；后续统一由 TaskRun 结构化 liveness / no-progress 收口。
- 已固化（减法棘轮）：Agent loop 复杂度基线由 33 收紧到 24；Capability 审计要求基础设计会话知道 `removeBackground`、R3 blocking 保持 user-owned，并禁止 prose-based Tool recovery 回归。`audit:simplification-ratchet` 已纳入 `maintenance:validate`，核心检查由 14 项增至 15 项。
- 已验证（代码）：Main /Renderer 类型检查、Capability resolver、Agent business boundary、generic executor、simplification ratchet、UXP production build 与完整 15 项 `maintenance:validate` 全部通过；`git diff --check` 通过。没有启动或关闭 DesignEcho /Photoshop，没有写入用户 PSD。
- 未验证（真实结果）：新构建尚未在重启后的真实 Provider + Photoshop 中复跑白底图；同 TaskRun 自然语言接续、V0 execution envelope、双 TaskRun /恢复、原 SKU 同会话、V1 无 Skill 设计与唯一 Release 仍按既定顺序待完成。因此本轮只证明系统性阻塞已修复并受审计约束，不证明 Agent 已会高质量设计。

## 本轮项目记忆维护

- 已核实（代码）：项目记忆从约 1.8 MB 压缩到 62 KB，保留当前主线、40 个未完成/暂停 Intake 项、关键决策、现实风险和自动校验锚点。
- 已核实（构建/脚本）：最新 `maintenance:validate` 的 15 个无 smoke 核心检查、Main /Renderer 类型检查、UXP production build、语义约束矩阵和 `git diff --check` 通过。
- 当前验证体系不再创建、恢复、运行或依赖 smoke；质量结论只引用现行核心检查、构建、审计和真实 E2E 证据。

## 2026-08-03 模型设置与 Provider 失败来源治理

- 已核实截图对应的真实请求：Run Record `run-20260803074300-3478c19d-811c.json` 在工具调用前结束，同时间主进程日志保留 Ollama Cloud `HTTP 403` 和 `this model requires a subscription, upgrade for access`。这是模型订阅 /访问权失败，不是 API Key 认证失败。
- 已修复共享分类口径：401 /明确认证证据才归为 `auth`；403 无更具体证据时归为 `model_access`；订阅、计费、限流、超时、网络、上游 5xx、协议和 unknown 保持独立。普通模型正文不再被 UI 字符串扫描为当前失败。
- Ollama Cloud 设置页已连通真实主进程测试：对当前选中模型发起最小 `/api/chat`，以同一真实请求区分成功、401 认证失败、403 订阅 /模型访问失败与其他故障；移除了该 Provider 原先的长度检查假成功。Ollama 官方的 `/api/tags` 只用于列出模型，不被当作 Key 认证证据。
- 新 Provider 失败 Run Record 保存脱敏有界摘要，日后可直接审计 `kind / basis / modelId / status / providerCode / diagnostic`，不保存 Key、Authorization 或完整响应载荷。
- 未对订阅 /权限失败增加自动重试；这类确定性失败不会因重试恢复。`build:typecheck:renderer`、新增 Provider 边界核心审计和完整 14 项 `maintenance:validate` 通过；应用重启后真实设置页测试与可用模型切换尚待 live 确认。

## 当前主线

- 当前切片：X2/V0 `R4-EXECUTABLE-V0-VERTICAL-001`，服务总主线 `DESIGN-HARNESS-VERTICAL-CONVERGENCE-001`
- 当前里程碑：F1/F2、动态 Task Profile + Capability 作业模型、F3 首条 Craft Recipe、X1 TaskRun owner、X2/V0 执行信封与精确属性请求最小写范围均已完成代码接线和核心验证；Photoshop 原生 `get` 弹窗根因也已修复并实机读回。下一步仍是真实 Provider + TaskRun + Photoshop V0 纵切、同文档并发 /等待恢复和 SKU 同会话复跑。
- 状态：`architecture_consolidated / product_boundary_defined / foundation_core_validated / capability_operating_model_core_validated / taskrun_owner_code_complete_core_validated / v0_mutation_pack_code_complete_core_validated / x2_execution_envelope_code_complete_core_validated / exact_property_write_scope_core_validated / uxp_native_get_modal_root_fixed_live_verified / five_runner_owners / r4_semantic_shadow_preserved / live_v0_photoshop_e2e_unverified / release_gate_not_implemented / live_no_skill_design_e2e_unverified`
- 当前规划结论：只读 Foundation 可以与 X1 owner 收敛并行；任一 Photoshop 写节点仍必须同时满足 TaskRun、Capability、execution preflight、稳定 target / revision 和该动作的 TransactionRunner owner。

## 2026-08-03 自然语言 Harness 去重、只读完成与专业判断 ownership

- 已核实（历史上下文）：旧 assistant 回复以 Runtime 事实级信任进入新一轮，导致模型继续沿用“抠图方法、用途和同商品候选交给运营决定”的错误答案。当前历史 assistant 输出降为 `untrusted_external` 草稿；用户明确要求抛开旧答案重新独立判断时不再注入旧 assistant 文本，历史 user 目标仍可有界承接。
- 已核实（重复读取）：开场 `getDocumentInfo` 已带 document / revision /画布 /模式 /图层事实，但模型仍重复调用同一零参数 Tool。当前 Run 会复用同 revision 的基础读取并从下一轮候选面移除；任何 mutation、文档切换、缓存失效或 unknown reconciliation 后会重新开放，不形成跨 revision 陈旧缓存。
- 已核实（Completion 误判）：自然用户请求“不要修改，也不要找参考，只回答当前 Photoshop 文档名、画布尺寸、颜色模式和图层数量”曾正确回答后被图层管理 0/3 判失败；“同款产品实拍”也曾因裸 `同款` 被判为参考复刻 0/4。当前结构化只读计划或明确禁止写入且零 mutation 的运行不再取得写入完成契约；真实复刻需要明确参考 /复刻动作或版式 /效果 /画面语义。
- 已验证（真实只读实机）：修复前同一问法耗时 61.7 秒并在开场观察后再次读取；中间版本 Run `run-20260803132644-cab1eb3b-a2b7.json` 已做到单次读取却被错误完成契约阻断；最终 Run `run-20260803133253-cab1eb3b-a2b7.json` 约 3 秒、1 轮、仅 `harness_opening_observation:getDocumentInfo`、0 mutation、无 blocker /warning，正确返回当前 `绿色.jpg` 的 4284×4284、300 dpi、RGB、1 个背景图层。测试没有修改或关闭 Photoshop 文档。
- 已验证（契约与核心）：独立重判会排除旧 assistant；“同款产品实拍”不构成复刻，“照着参考图复刻同款版式”仍构成复刻。Renderer/Main 类型检查、Renderer build、UXP production build、通用执行器棘轮及完整 15 项 `maintenance:validate` 通过。
- 仍未核实：决定 ownership 的最终可见模型输出尚未在最新构建上用不同自然问法复跑；此前窗口出现用户输入并被最小化，本轮遵守不抢占 /不关闭可见应用的约束停止操作。V0 写入、X1 并发恢复、V1 设计质量、Release 和业务多样本状态均不因此升级。

## 2026-08-03 晚间 V0 实机审计、授权范围 containment 与原生弹窗修复

- 已核实（真实 Provider + Photoshop，非 TaskRun V0）：在同一 disposable PSD 上使用自然用户表达验证了三种确定性修改。明确“改图层名称”只调用 `renameLayer` 且可见文字保持不变；明确“改画面文字”只调用 `setTextContent` 且图层名称保持不变；旧值同时匹配图层名与可见文字时零写入并向用户澄清。三者走 v3/E1 + UXP + PhotoshopTransactionRunner，不包含 TaskRun / R4 execution envelope，不能外推为 V0 完成。
- 已核实（事故与恢复）：一次实验性 `declareDesignIntent` →结构化 Runtime 重入把精确重命名扩张成整张海报创作。已立即停止、撤回 `runtime_selection_handoff` 实验接线，并通过 18 次真实 undo 与独立结构读回把 disposable 文档恢复到 historyStateId `3757`、2 个图层、文字层名称 `待修改标题`、可见内容 `V0 CANARY`。用户文档未被修改。
- 已实现（确定性授权范围）：Task Profile / Manifest 不再被当作 mutation 授权。对只有一个明确属性替换且没有第二 mutation /保存 /导出要求的请求，Engine 复用现有 `runtimeAllowedWriteTools`：图层名称仅 `renameLayer`，画面文字仅 `setTextContent`，属性待观察时仅两者候选。该范围同时过滤模型可见写能力，并由 Agent Runtime 最终执行点二次拒绝；Skill bridge、别名、Task Profile 和后续模型声明都不能扩张。复合请求保持未收窄，交回完整计划。
- 已核实（Photoshop 原生弹窗根因）：UXP `getHistoryInfo` 过去对 `historyState` 请求不存在的 `count` 属性，Photoshop 因 Action `get` 描述符无效弹出“命令‘获取’当前不可用”，同时阻塞 UXP 线程并造成上游超时。当前改用 `document.historyStates.length + activeHistoryState.id`；其它原生 `get` 均要求 `_options.dialogOptions='dontDisplay'`。
- 已核实（实机与构建）：修复后的 `getHistoryInfo` 多次真实返回且无弹窗，UXP 连接 `connected=true`、`pendingRequestCount=0`、`lastError=null`；Tool audit 报告 `UXP 原生 get 弹窗风险: 0`。业务边界审计新增 6 个自然语言范围样本并通过，Main /Renderer 类型检查、Tool /Capability /Prompt /Skill 审计、Agent 测试、UXP production build 与完整 14 项 `maintenance:validate` 全部通过。
- 仍未核实：普通自然语言如何在不创建新任务、不扩大目标的前提下接续同一 TaskRun / R4 节点并取得 V0 execution envelope；因此本轮只关闭精确请求范围扩张和原生弹窗两个 P0，不宣称 V0 E2E 完成。

## 标准设计 Agent 架构收敛

- 已确认产品身份：DesignEcho 是专业视觉设计与 Photoshop 生产 Agent，不是通用聊天助手、任意电脑控制 Agent 或 Photoshop 命令行外壳。该身份由 `Prompt.md` 与 Design Agent OS 定义，不实现为新的 Runtime Contract 或分类器。
- 已撤销 F0 代码化方向：不新增 `standard-design-agent-role-contract`、scope /六任务族枚举、`standard-design-task-contract` 或 `standard-design-outcome`。这些概念会与 Task Profile、Capability、TaskRun、Verification、DesignVerdict、Release 和 Delivery 重复。
- 已确认“从零创作”属于 Design Kernel 的本身设计能力，不是独立 Task Type、Skill、Executor、Workflow 或通用 WorkMode 路由。现有 `workMode=create_new` 只在业务兼容边界表达目标状态与保护关系。
- 已在 OS 固定唯一生产链与 Owner 矩阵：Task Profile → Context Compiler → RuntimeSession/TaskRun → R4 → Capability/preflight → TransactionRunner → operation result/verification → DesignVerdict → Release/Delivery → reviewed learning candidate。
- F1/F2 已完成 Task Profile crosswalk 与阶段化 Design Context 的 Owner 接线，F3 已落地首条受治理的单画布 Photoshop Craft Recipe。TaskRun 最小 owner、V0 五动作认证包和 X2 执行信封已接入现有 Agent /E1；当前真正缺口转为真实并发 /恢复、V0 Provider→Photoshop 纵切和真实设计纵切。Runner 仍仅迁移 5 个 owner，Recipe 尚未被 V1 实机验证，唯一 Release 尚未完成，无业务 Skill 的真实设计 E2E 未验证。
- 本切片修改了明确列出的 F1/F2 生产 Owner、既有业务边界审计与项目记忆，没有回退、暂存或提交并行会话改动。
- 本切片完整 `maintenance:validate`（14 个现行核心检查、无 smoke）和定向 `git diff --check` 均通过；验证覆盖 43 个 Intake、1037 个仓库文件、162 个 Tool、20 个 Skill、8 个 Runtime Skill Package、Main / Renderer 类型检查和 UXP production build，但不证明真实 Photoshop V0 E2E 或设计质量。

## 2026-08-03 X2/V0 执行信封纵切

- 已冻结 `photoshop.mutation.v0`：只包含 `renameLayer`、`groupLayersSafely`、`moveLayer`、`lockLayer`、`setTextStyle` 五个已由唯一 `PhotoshopTransactionRunner` 持有的 provider；每个动作新增一对一叶子 Capability，映射仍由既有 `LEGACY_TOOL_CAPABILITY_MAP` 单一拥有。
- 已保持语义 R4 的正确边界：Model 只声明设计步骤与依赖，`runtime-action-plan-declaration` 继续 `shadowOnly / executable=false / schedulerAuthority=false`；Tool 名、参数、layerId、坐标和目标 revision 不被塞入语义计划。
- 已在现有 E1 逐调用接缝编译一次性执行信封：同时校验 active leaf Capability、唯一 ready mutation node、TaskRun 当前 node /plan revision、Tool schema /参数、execution preflight、document /history revision 和单文档 writer。编译器不执行 Tool、不授予权限、不拥有调度 /重试 /完成。
- 已让 TaskRun 在派发前原子记录 node `in_progress` 与有界 execution ref；真实 `PhotoshopOperationResult` 必须与信封 provider 一致后按同一 nodeId 回写。缺失或错配转为 `unknown / needs_reobserve`，禁止盲目重放；包外 Tool 保持现有 v3/E1 路径。
- 已扩展既有 Capability 审计，静态证明 V0 默认收窄、broad Capability 不入包、五个 provider 均调用现有 Runner、Agent 只有一个生产编译接缝。完整 `maintenance:validate` 通过 14 个核心检查；没有创建、恢复或运行 smoke。
- 未验证：真实 Provider 是否选择并提交正确包内调用、Bridge /UXP /Photoshop 写入、同目标 verification、双 TaskRun 竞争、waiting /resume 与应用重启。以上未完成前不能把本切片描述为 V0 E2E 或“Agent 已会设计”。

## 2026-08-03 X1 TaskRun 与专业能力作业模型

- 已实现（唯一 Owner）：`runtime-session.ts` 原地持有 `taskRunId`、plan revision、nodes /cursor、非终态 `waiting_user`、pending interaction、document /history revision、单文档 writer claim 与 Host `PhotoshopOperationResult` refs；没有新增 Runtime、Task Store、DAG、continuation ledger、Completion 或 writer registry 模块。
- 已实现（真实执行点）：Agent 普通 Photoshop 写入在 dispatch 前保留 `expectedHistoryStateRef` 并声明 TaskRun writer；Engine 的确认卡续跑从现有持久化 continuation ledger 读取冻结 envelope，校验 `taskRunId / runId / generation / interactionId / planRevision / expectedRevision` 后才直接承接原 leaf operation。裸“继续 /可以”不恢复写权限。
- 已实现（诚实状态）：`awaiting_confirmation` 返回 `finalized=false / waiting_user`；stale revision、第二 TaskRun 与 `unknown` operation 转为明确拒绝或 `needs_reobserve`，不自动重放。语义 R4 继续 `shadowOnly / executable=false / schedulerAuthority=false`；只有 X2/V0 一次性执行信封可进入现有 E1。
- 已修复（原链路缺陷）：普通自主 Tool adapter 过去会在转交 UXP 前丢弃 private target guard 中的 `expectedHistoryStateRef`；现在完整保留并校验 document/revision。
- 已实现（成熟设计师式作业上下文）：Task Profile 声明后不再只停留在一次性 Tool result，下一轮起持续进入每轮 system context；Capability Session 每轮动态区分 active / on-demand / denied / unavailable，复用真实 provider Tool 的 Photoshop 前置条件、副作用和验收语义，并明确禁止随机 Tool 探索与重复失败尝试。
- 已验证（非实机）：Main/Renderer 类型检查、Capability 审计、Agent 业务边界审计通过；一次性 TaskRun reducer 行为检查覆盖等待、匹配 /stale 恢复、第二写者、OperationResult 节点归属和 unknown 防重放；一次性 Capability 行为检查覆盖装载前后实时投影及 legacy alias 语义继承。临时验证文件已删除，未创建或恢复 smoke。
- 未验证：两个真实 DesignEcho 任务竞争同一 Photoshop 文档、等待期间外部修改、应用重启后确认卡恢复、V0 执行信封的真实 Provider + Photoshop 闭环，以及无 Skill 设计效率与质量。

## 2026-08-03 近期改动复盘与重规划验证

- 已核实（Git /工作树）：当前分支最新提交早于 8 月 1 日，近期实现全部位于共享未提交工作树；本切片没有 reset、checkout、批量清理、stage 或 commit，并保持其它会话改动原状。
- 已核实（执行 owner）：Transaction ownership audit 仍报告 5 个 migrated owners；UXP `src/` 有 52 个包含 `executeAsModal` 的文件，不能把文件数量直接等同于 52 个 Agent mutation，但足以证明“全量迁移后再做 TaskRun / Foundation”没有稳定边界。
- 已核实（TaskRun / R4）：`runtime-session/v0` 的兼容外壳现内含 `runtime-task-run-state/v0`，拥有 plan revision、节点 cursor、pending interaction、operation result 和进程内单文档写者身份；`awaiting_confirmation` 不再 finalization。语义 R4 仍是 `shadowOnly / non-executable / no scheduler authority`，V0 通过后续 schema-bound Tool call 编译的独立执行信封取得单次派发资格。
- 已核实（Design Foundation）：`design-task-types.ts` 已成为 task type、artifact knowledge、Manifest /旧 Skill 与 document role 的唯一 crosswalk Owner；交付物知识和 Manifest 方法论通过唯一 Context Compiler 按当前 Runtime Stage 装载。无业务 Skill 路径声明合法 Task Profile 后，动态 operating context 会在后续每轮持续提供对应作业语义；Capability Session 也同步提供实时能力自我模型。
- 已采用 D-072：Runner 与 TaskRun 改为纵向会合依赖，Foundation 与执行 owner 分两条安全车道推进；未迁移 Tool 不进入 R4 capability pack，写入安全边界没有放宽。
- 已核实（验证）：`maintenance:planning-check`、完整 `maintenance:validate`（14 个现行核心检查、无 smoke）与全工作树 `git diff --check` 通过；这些结果不证明真实 Photoshop 无 Skill 设计 E2E 或设计质量。

## 本轮知识库重构研究（M4 前置）

- 已完成对内置方法论、统一知识检索、Memory、Project State、Eagle、Web、模板 /PSD、v3 Tool、v5 knowledge provider、Context Compiler 和知识库 UI 的代码级审计，并形成 `docs/design-knowledge-system-reconstruction-report.md`。
- 结论不是建设“大一统向量库”，而是建设 provider-neutral 的 Design Knowledge Plane：主进程唯一 Catalog Repository、可重建派生索引、唯一 Query Gateway、唯一 Context Compiler、证据中心的可视化和独立 Eval。
- 关键词保留为 exact /FTS /BM25 检索信号；它不拥有自然语言意图、Skill /Tool 选择、权限、写入门禁或完成裁决。开放式任务由模型理解，确定性边界仍在真实执行点校验。
- 已核实当前 Agent 与 UI 对“统一搜索”的覆盖和去重不一致；Agent Tool 描述声称包含 Eagle，但真实 Agent 聚合链未包含 Eagle。当前本地检索主要是 `includes()` 与固定 `sourceRank`，没有正式 FTS /BM25 /vector index 或独立检索质量 baseline。
- 已核实 Memory 将完整 state 写入 renderer `localStorage`，且视觉案例可携带无可靠字节上限的 `previewDataUrl`；目标方案要求 renderer 不再拥有 canonical knowledge，视觉二进制改为受治理的 artifact /thumbnail ref。
- Manifest knowledge identity、正文可达、Tool 可见与 Context 选入仍是四个不同状态；本切片已让现有 `applicableStages` 真正驱动结构化运行的阶段装载，并继续复用唯一 `runtime-context-compiler.ts`。
- K0 研究仍是知识系统长期参考；其中映射到 F1/F2 的只读 Owner / crosswalk /阶段装载已经实施。Catalog /索引 /检索评测等 K1—K6 其余内容未据此宣称完成，Knowledge 仍不得取得 Tool、Stage 或完成权限。
- 本轮文档变更已通过 `maintenance:planning-check`、1030 个仓库文件的 UTF-8 /行尾检查和 `git diff --check`；这些检查证明文档治理与补丁完整性，不证明 Knowledge Runtime 已实现。

## Harness 治理计划（目标已确认，基础层实施中）

- 用户目标已收敛为有效 Design Harness：Agent 即使不加载业务 Skill，也必须理解主图、详情页、SKU 子类型与开放式设计，使用真实项目 /PSD /知识来源形成设计判断，并把视觉意图通过 Adobe Photoshop 落成可编辑、可读回、可评价的结果。
- `Prompt.md` 与 Design Agent OS 已明确 Task Semantic Binding、Knowledge 优先级、常驻 Design Kernel、Photoshop Craft Recipe、TaskRun liveness、生产结果分层和执行内环 /经验外环；这些是目标治理，不是当前 Runtime 已实现事实。
- `Plan.md` 已移除 F0 角色 Runtime 合约，把产品边界留在 Prompt / OS；两车道纵向会合保持不变：F1/F2/F3 收敛现有 Task Profile、阶段化 Context 与 Craft Recipe，X1/X2 收敛最小 TaskRun、纵切 TransactionRunner capability pack 与 R4 节点直执行，随后先 V0 操作闭环、再 V1 无 Skill 设计闭环，并把 V1 接入唯一 Release 首条路径。
- Hermes 只作为渐进加载、Patch 优先、来源 /版本 /归档 /回滚的外部机制参考；不采用调用次数触发学习、纯模型自评或后台直写正式 Skill。
- 旧 M3-A 的全量迁移不再拥有后续全部工作的总门禁。Runner 仍唯一拥有单次 mutation 事务；TaskRun 最小 owner 已取得跨节点、跨等待与进程内单文档写者身份；V0 pack 与执行信封已完成代码和核心验证。当前仍没有完成 V0 实机纵切、Craft Recipe 的真实执行验证、Release Gate 或真实无 Skill 设计 E2E；代码完成不能替代这些执行证据。

## 通用设计判断与公开表达根因修复（已完成的 Foundation 部分）

- 已修复新消息的推理来源边界：`provider_thinking_delta` / `provider_final_thinking` 现在属于隐藏诊断，不可进入普通思考面板、不可持久化为公开判断，也不可占用写前公开说明状态；Provider reasoning 字段仍保留给协议连续性。
- Agent 的公开摘要只消费专门模型调用的 `content`，该调用显式关闭 Provider Thinking；进入 `visibleReasoningSent` 和写前 rationale 前再次执行共享通道策略。ChatPanel 不再把 Provider 的流式 thinking 直接投影到 UI，新公开摘要以 `decision / 判断` 呈现，而不是“思考日记”。
- 通用设计原则已改为任务目的条件化：区分说服、比较、解释、表达、规格化生产和局部修订。单焦点、主体 40%~60%、60-30-10、三级层次、复杂背景与投影都被降为特定场景启发式；白底、扁平、对称和多同权焦点不再被全局判失败。
- SKU 已拆成三个不同语义：`sku-template` 是比较型组件系统设计，`sku-color-card` 是真实、可编辑的颜色资产，`sku-batch` 是消费既有模板与组合规格的确定性生产。笼统 `sku` 只返回辨析知识，不选择 Skill、权限或 Runtime。
- `ecommerce.sku_batch.v1` 已加入 canonical 设计任务类型目录并与现有 `sku-batch` Skill /v5 Manifest 对齐；`ecommerce.sku_template.v1` 已解除错误的 `sku-config` 绑定，在没有专用 Skill Overlay 时明确回到通用设计能力。
- SKU Template 不再要求 Eagle /知识检索 /参考分析任一成功后才允许建画布。参考仍是有价值的设计依据，但参考服务离线不能再形成“确定做不到”的硬门禁；Agent 应继续使用模型基础知识、项目 /PSD 事实与写后视觉复核推进。
- 默认设计质量目录已改为任务中性断言，确定性检查、VLM 待评目录与最终评分保持同源；显式 Evaluation Profile 继续携带主图、详情页、SKU 等任务规则，避免把营销图启发式重新扩散为跨品类硬门禁。
- SKU 用户授权已从模型参数中剥离：组合、模板与占位回退的模型字段只能表达候选，不能伪造用户确认。结构化确认必须经过 Engine 对 continuation ledger、owner、card、fingerprint 与 scope 的校验后，通过独立 trusted continuation 通道进入 Skill；模型 schema 拒绝未声明顶层字段并剥离 Runtime-owned card/continuation 字段。
- 色名来源已保真：文件名回退与视觉/模型推断保持 provisional，并进入 `needs_review`；普通资源 `name` 不再自动等同于用户提供色名。SKU 备注也不再默认生成，只有用户、权威项目配置或可信交互确认明确要求时才进入交付范围。
- 在上述最终代码状态下，`build:typecheck:renderer`、`audit:capability-resolver`、`audit:executor-generic`、`audit:skill-standard`、`audit:agent-business-boundaries` 与完整 `maintenance:validate` 均通过；完整验证覆盖 14 个现行核心检查、Main/Renderer 类型、工具/Handler/Skill/通用执行器/业务边界/Capability/Skill Package/Prompt 治理、Agent 核心测试与 UXP production build，`git diff --check` 通过。
- 当前已实现最小 TaskRun owner、动态能力作业模型、V0 mutation pack 与 pack-scoped 执行信封，但没有完成 V0 /Craft Recipe 的真实执行闭环或 Release Gate，也没有运行真实 Provider + Photoshop 设计 E2E；因此不能据此宣称 Agent 已能稳定“把设计做好”。
- F1/F2 的静态退出条件已由业务边界审计和阶段编译断言覆盖：8 个 artifact-owner Manifest 均回到唯一 Task Profile，R3/R4 只装载适用方法知识，普通参考为按需输入；真实任务上的选择质量仍待 V1/M6 验证。
- 首条 `photoshop-craft.editable-single-canvas-composition@1.0.0` 已绑定真实 Tool 名、必要观察、稳定 document/layer 目标、参数 authority、保持项、结构 /像素读回、unknown 与 rollback；统一知识检索可召回，无 Skill Task Profile 声明可回填，Stage Context 在 R3 排除、R4/R5 装载。它不授权执行，真实工艺有效性仍待 V1。

## 2026-08-03 SKU 真机运行 60：任务语义续接与局部恢复

- 已核实（真实运行）：同一会话此前已明确需要制作 `2双装.tif / 3双装.tif / 4双装.tif / 自选备注模板`，且先修改占位符避免色卡重叠；当前短指令“帮我做SKU”却被自主 Agent 当成无历史的新任务。Run Record [60] 共 9 轮，完成摘要为 12 次 Tool（11 成功、1 失败）、`successfulMutationCalls=0`，最终没有 Photoshop 写入。
- 已核实（根因）：Engine 持有 `conversationHistory`，现有 `agent-conversation-context.ts` 也已提供有界、data-only、当前指令优先的历史编译器，但自主执行器没有把它交给 Agent；模型只能从当前四个字和项目资源重新猜交付物。Task Plan 因而保持中性 `agent_resolved_result`，没有承接此前明确的 SKU Template 目标。
- 已核实（次生问题）：`measureReferenceComposition` 的 Tool 描述把可选参考测量表达成普遍置图前置，模型在已经读过目标文档与画面后仍搜索参考并调用它；调用失败后虽收到“不阻断继续”的恢复指令，最终失败会计仍把它算成未恢复项。0 写入的 `needs_review` 默认文案又错误声称“已经生成当前版本”。
- 已实现（通用 Harness）：自主 Agent 复用唯一会话上下文编译器，注入当前输入之外最近 8 条 /6400 字符的有界历史；新增任务落地纪律要求先绑定具体交付物、能从同会话唯一承接时直接续接、仍不唯一时只问一个决定执行方向的问题，禁止用反复搜素材代替澄清。没有新增 SKU 关键词 Router、Executor 状态机、Memory Store 或权限通道。
- 已实现（完成义务）：模型一旦用 ready Runtime Design Brief 声明 `photoshop_mutation_with_readback`，现有任务义务门禁就要求真实写入 /交付动作；只读、打开、解释和分析任务不受影响。可选只读观察失败继续在 Trace 中保真，但可标记为 `non_blocking_observation`，不再独自把后续有效交付降级。
- 已实现（诚实输出）：没有成功 Photoshop 写入、导出或外部生成的 `needs_review` 不再声称已有版本；返回“只完成现状读取、没有可供复核的设计版本”。参考构图测量只在已经明确选中相关参考且需要复现数值时使用，没有参考或测量失败必须按当前画布、组件边界与设计原理继续。
- 已验证（非实机）：Renderer/Main 类型检查、`audit:agent-business-boundaries` 与完整 `maintenance:validate` 通过；完整验证仍为 14 个现行核心检查、无 smoke，并包含 UXP production build。修复后的同会话 SKU 复跑尚未执行，首次有效写入延迟、交付物正确率和设计质量仍未验证。

## 已核实（代码）

- `PhotoshopTransactionRunner` 已承接 `renameLayer`、`groupLayersSafely`、`setTextStyle`、`moveLayer` 与 `lockLayer`。后四者均绑定 document /revision；`setTextStyle` 按稳定 ID 逐 range patch，`moveLayer` 读回位置与几何，`lockLayer` 以显式 `_id` 的 `applyLocking` 取代会落到活动图层的 DOM setter。
- R-040 最小 containment 已实施：只有 `fail + severity=blocker + deterministic + 合法 blockerKind + 安全 proofRef` 能形成质量硬阻断；通用审美、VLM coverage 与 above-baseline 缺陷只进入 finding / `needs_review`。Completion、DesignVerdict、Critic 与 Reflexion 使用同一资格谓词；M5 的唯一 Release Gate 与全量旁路消费者归一仍未完成。
- 普通 `setTextContent` 已停止复用隐式旧样式 descriptor；显式候选文案基线按 documentId+layerId 隔离。Agent 外层 acceptance 现在会把改字号时的字体/内容漂移、改文案时的样式漂移判为失败或需复核，而不是只看请求字段。
- `groupLayersSafely` 的 Host unknown 与 transport unknown 只通过一次严格层级读回分类为 `applied / not_applied / ambiguous`，不重放写入；mutation proof reader 只读取声明式 `toolResults[].result`。
- 当前实现区分 `pre_dispatch` 与 `dispatched`，并保留 `verified / failed / unknown` 的 operation result 语义。
- 普通自然语言现直接进入通用 Agent；前置 `task-classifier` 模块与 Router 专属 helper 已退役，不再为同一请求先付出一次分类模型调用。关键词不再决定回复、澄清、Skill、Tool 或写权限，只保留无模型兼容提示和用户明确给出的 deny-only 能力边界。
- 普通 `autonomous-agent` 请求的规划场景不再从用户文本推导主图、详情页或 SKU 类型；只有结构化 `skillId` / `taskTypeId` / Runtime bundle 能绑定确定性工作流。模型可在运行中通过 `declareDesignIntent` 声明设计任务类型，声明结果会写回本轮纪律上下文与最终 Run Record。
- 自然语言 Agent 的开场观察已改为文档身份级 `getDocumentInfo`；只有结构化 Runtime 明确需要像素时才预取画布。文档打开/切换以文档列表、documentId 与切换读回为充分证据，不再为导航任务调用画布快照或视觉模型。
- `AgentTaskPlan` 已把 `canExecuteTools` 与 `requiresTaskProgress` 分开：普通自然语言允许主 Agent 自主回答或调用可逆能力，但不会被 Harness 强迫调用 Tool；只有结构化续跑、已批准计划、已选 Runtime 身份或确定性 Skill 才签发真实进展义务。
- 普通 Agent 不再在模型前探测并抢跑阻断 Photoshop bridge；连接与文档状态保留 `true / false / unknown`，unknown 放行到真实 Tool 执行点，只有明确 false 才可阻断结构化 Photoshop owner。
- 模型 Provider 失败现在只在真实模型调用边界标记并集中分类；`402` / `Insufficient Balance` 归为 `billing`，不会再被泛化为“检查当前文档”。Tool 与运行时错误不走这条分类，避免把 Photoshop 故障误报成 Provider 故障。
- 模型首轮尚未产生 Tool call 即失败时也会保存失败 Run Record，并明确记录 `toolCallsStarted=false`、`photoshopWriteOccurred=false`；`autoFallback=false` 继续得到尊重，不会暗中切换模型。
- 设计团队协作不再由任务文本正则升级为 `required` 写入门禁；文本最多形成 advisory，只有结构化 `requiresDesignTeamConsultation` 能签发 pipeline 义务。
- `candidate_only` 允许回答与只读观察，但拒绝 Photoshop 写入、导出、外部生成和非只读状态变更；RecoveryQueue 复用同一可见性判据，不能把隐藏写工具重新放回。no-Skill、精确 Tool/Skill 名和 Photoshop 域禁令同时在候选面、按需激活和最终执行点保持 deny-wins；未知 source-dependent 能力在可见性阶段保持开放，真实调用时再按参数裁决。
- 公开计划确认已使用唯一 UUID `requestId` 与 `sourceMessageId` 双绑定；旧的无 `requestId` 计划不迁移、不从历史或固定字符串恢复执行身份。
- V0 执行信封已完成代码与核心验证；片内旧结果归属的实证退役、首条 Craft Recipe 的真实执行验证与后续实证扩展、唯一 Release Gate 和真实业务 E2E 尚未完成。

## 已核实（构建）

- 当前记录显示定向事务 / 取消 / R4 对账 / Completion / preflight 回归、Renderer/Main 类型检查、Agent production build 和 UXP production build 已通过。
- `maintenance:validate` 当前通过 14 个无 smoke 核心检查；这只证明对应静态、审计、构建和核心测试，不等于整体 Photoshop E2E 或设计质量通过。
- 本次文本 /移动 /锁定事务切片通过 UXP transaction ownership audit、UXP production build、Renderer/Main 类型检查、工具注册 /通用执行器 /规划审计、中文编码检查与 `maintenance:validate`；ownership audit 当前列出 5 个 migrated owners。
- R-040 containment 通过能力解析审计、Renderer/Main 类型检查和软硬阻断行为矩阵；`maintenance:validate` 当前仍通过 14 个无 smoke 核心检查。
- 本次 Provider 失败修复通过 Renderer/Main 类型检查、Renderer production build、定向分类契约检查、`git diff --check` 与上述 14 个核心检查。
- 本次 Agent-first / 延迟视觉观察修复通过 Renderer/Main 类型检查、Renderer production build、业务边界与通用执行器审计、简化棘轮、`git diff --check` 与上述 14 个无 smoke 核心检查。

## 已核实（手测）

- 两个 disposable Photoshop canary 真实验证了图层重命名和连续同父级编组的 History、层级顺序、未选兄弟、Pass Through、opacity 和无效目标零写入。
- canary 不含非平凡剪贴链；临时文档未保存关闭，原文档恢复为活动文档。
- `setTextStyle` canary 在 document `633` 验证了字号 `48→64`、多 range 结构与内容 /字体 /颜色 /tracking 保持、字号变化后的 bounds、幂等、错误 /非文本 /锁定目标零写入；另一文本层验证字号变化保持 `autoLeading=true`，显式 `leading=52` 后读回 `autoLeading=false`。临时文档不保存关闭后，原始 `详情页.psb` 仍为 document `182`、history `625`。
- `moveLayer` 在同一 disposable 文档验证了 layer `5` 从 `(60,265)` 移到 `(90,225)`，宽高保持 `224×90`，History `651→653`；同位置绝对移动为 `already_satisfied`，旧 revision 在写前拒绝且独立 bounds 读回未变化。
- `lockLayer` canary 在 document `654`、活动 layer `4` 的条件下，用显式目标 layer `3` 完成 `all` 锁定，History `662→663`；独立读回确认 layer `3` 锁定、layer `4` 未锁且活动图层未切换，重复调用为 `already_satisfied`。
- `lockLayer` canary 随后被另一个正在运行的 DesignEcho 任务并发写入 “A-2双装模板” 结构，History 继续变化到 `698`；旧 revision 请求被 Runner 正确拒绝。因新增内容可能属于用户任务，没有强行关闭并丢弃 document `654`，当前它仍作为活动临时文档保留。
- 2026-08-01 15:57 的“帮我打开SKU”失败已由日志定位：DeepSeek 在模型第 0 轮返回 `402 Insufficient Balance`，当时没有业务 Tool call、没有打开文件、没有 Photoshop 写入；文件、UXP、WebSocket 与 Agent-first 路由均不是根因。
- 修复后用同一句“帮我打开SKU”完成多次真实回放。2026-08-01 17:20 的最终构建回归从 `详情页.psb` 出发，由模型自主调用 `listDocuments`、`searchProjectResources`、`switchDocument`，约 23 秒完成；没有 `getCanvasSnapshot`、`getAnnotatedSnapshot`、MiMo 视觉调用或 Photoshop mutation。Run Record 为 `run-20260801092036-8d91e2a4-45a6.json`（3 轮、2 次 observation、1 次 control、0 次 mutation、无 blocker/warning），独立 Photoshop 读回为 `SKU.psb`（documentId 242，1500×1500、17 个图层）。

## 2026-08-04 合并图文字替换与主体感知置入：共享工艺收敛

- 用户提供了两个 V1 通用场景：把合并位图中的局部文字值替换为新文案，以及把明确图片置入后按视觉主体调整到合适大小与位置。它们被归属为 Design Kernel / Photoshop Craft 的共享能力，不建立 FEX、白底图、SKU、主图或详情页专属 Executor / Router /固定坐标分支。
- 根因审计确认现有 `placeImage` / `fitLayerSubjectToRegion` 原子能力已经存在，但 Tool 描述把可选参考测量和固定占比暗示成普遍前置；复合主体适配写入后又要求模型自行额外读取和计算，造成重复搜索、往返试探和预算消耗。合并图局部替换则缺少受治理的背景复杂度边界与同区域复核方法。
- `fitLayerSubjectToRegion` 现消费共享 `design-smart-scaling-policy`：模型只声明 designType、assetRole、intent 和 targetRegion，省略占比 /锚点时由共享预设产生首个 targetFill、anchor 与 visualBias；用户、模板或已选参考有明确约束时才覆盖。写入后在同一次复合调用内读取同一 layerId 的实际主体与图框，并输出实际占比、主体可见比例、锚点偏差、投影偏差和 `passed / needs_review / failed` 几何裁决。几何通过明确不代表审美、清晰度、无遮挡或 Release 通过。
- `placeImage`、`getCanvasSnapshot`、`createRectangle`、`createTextLayer` 的模型语义已收紧：已明确素材不得重新搜索；局部修订使用一次定位 +一个紧凑 region，并在写后只读同一区域；矩形只允许覆盖纯白或具有权威色值且局部均匀的背景；新文本 x/y 明确为可见 bounds 左上角文档像素坐标。纹理、渐变、照片或颜色不确定时禁止用平涂矩形伪造自然修复。
- 新增 `photoshop-craft.flattened-raster-text-replacement@1.0.0` 与 `photoshop-craft.subject-aware-image-placement@1.0.0`。二者声明必要观察、参数 authority、保护范围、真实 Tool 选项、结构 /像素读回、一次有依据修订上限、unknown /rollback 和能力边界；常规 Stage Context 与 `declareDesignIntent` 只返回紧凑索引，完整 Recipe 继续通过唯一 `searchDesignKnowledge` 按需读取，未建立 Recipe Runtime 或第二执行 Owner。
- 正式业务边界审计新增语义锚点与写后几何裁决正反例，并锁定两条通用 Recipe 与紧凑按需装载。Renderer/Main 类型检查、工具注册审计、通用 Executor 棘轮和业务边界审计均通过；完整 `maintenance:validate` 通过 15 个现行核心检查，包含规划 /仓库卫生 /编码、工具 /Handler /Skill /Capability /业务边界治理、Agent 核心测试、类型检查和 UXP production build，无 smoke 依赖。
- 当前没有新增 OCR 字框或像素取色 Tool。白色等已知均匀背景可按局部像素完成可逆遮盖；复杂背景仍需要可验证选区的修复 /生成填充能力，否则只能 `needs_review`。本轮没有启动 /关闭 Photoshop，也没有对用户真实 PSD 做无人值守写入；两条 Recipe 的真实 Provider + Photoshop 效率与设计质量仍待 V1 实机验证。
- 后续审计发现一个真实入口缺口：普通自然语言在 `declareDesignIntent` 前没有 taskType，旧 `buildPhotoshopCraftRecipeRuntimeItems` 因空身份返回空集合，导致最常用入口看不到已存在的通用 Recipe。现按 Recipe 自身 `design.generic.v1` 适用标记提供紧凑 fallback；它不选择 generic Manifest /Skill、不授予权限、不推进阶段，也不扩大交付物。索引同时提供最多四个有条件候选工艺，并明确“按观察选择最短可靠组合，不是逐项试探；目标 /素材明确时不重搜项目或参考”。
- 正式业务边界审计现用四种自然问法验证空 taskType 时 Recipe 集合完全一致，并锁定“可编辑文本→直接改文本内容；合并像素 +均匀背景→局部可逆遮盖 +可编辑新文字；纹理 /渐变 /照片且缺少可验证选区修复→needs_review”的能力边界。普通入口三条索引合计 2398 字符、单条最多 808 字符，审计上限分别固定为 2600 /900，避免能力可见性反向挤占执行预算。Renderer/Main 类型检查和完整 15 项 `maintenance:validate` 再次通过；没有启动可见应用或写入用户 PSD。
- 同 TaskRun 接续的代码审计进一步确认：taskRunId 来自 Runtime identity 的 sessionId，但当前主进程 Artifact 授权只能在 skillId/taskType 已知后签发 identity；现有 Capability Session 也没有运行中绑定 Manifest 的 API。因此不能在 `declareDesignIntent` 后只补一个 Renderer Session 或递归新建 Agent 假装接续。下一纵切必须由主进程先签发 plan-neutral identity，并在同一 identity 上原地绑定 Manifest /stage plan、Capability Session 与 Artifact 授权，同时保持请求写范围、document /revision、Tool log 和预算。

## 未核实 / 待验证

- 真实 Photoshop Host 取消、断链、丢响应和非平凡剪贴链。
- `setTextStyle` 的真正 mixed-property style range、写后验证失败注入与 rollback 真实读回；当前只验证了多 range 结构，不能外推为不同字体 /颜色混合样式已验证。
- 其余 legacy Photoshop 写工具的 Runner 迁移与旧 owner 退役。
- 自然语言“整理图层”经真实 Model →同一 TaskRun → R4 execution envelope → E1 → Electron → UXP → Photoshop →同目标 verification 的完整 E2E；当前只证明 v3/E1 确定性精确修改和最小写范围。
- Agent-first 路由对 SKU 色卡“禁用 Skill、保留原子 Tool”的真实 Provider → Photoshop E2E。
- Provider 已恢复，修复后的真实 `402` 用户提示分支尚未再次触发；当前证据是定向分类契约、类型/构建检查与失败边界审查，不能把成功打开 SKU 当成该错误提示分支的实机验证。
- 可挂起 TaskRun、revision-bound interaction resume、单文档写者身份和 capability-pack scoped 执行信封的真实 Provider + Photoshop 闭环。
- Task Semantic Binding、统一 Design Kernel context、Photoshop Craft Recipe、TaskRun liveness owner、Release Gate、无 Skill 通用单画布及主图 / SKU / 详情页真实 E2E、设计质量与真实效率指标。
- 合并图局部文字替换在纯白 /权威均匀背景上的真实定位精度、字体近似和同区域视觉复核；复杂背景选区修复仍是明确 capability gap。
- 主体感知置入在真实透明留白图、模特图、辅助细节图上的 Photoshop 写后读回、清晰度判断和一次修订收敛率。

## 当前风险

1. Runner 只迁移了 5 个 owner，legacy mutation 仍多；若继续用“全量迁移完成”作为全局阶段墙，会形成无边界水平工程，若直接开闸又会形成双 owner。当前改为按 capability pack 迁移并在同一纵切退役旧 owner。
2. 把语义 R4 全局翻成 executable，或让包外 Tool 绕过执行信封，会绕过目标绑定、事务和未知状态读回。
3. 清理历史时不能误删不可逆审批、schema / permission、target / revision、rollback 和 unknown readback。
4. 自动化核心检查、单个 canary 和 Tool success 不能升级为设计质量或交付完成。
5. no-Skill、精确修改写范围等任务级能力上限尚未全部由 TaskRun snapshot 跨暂停 /重启持久化；当前结构化 continuation 继续要求 revision-bound identity，裸“可以 /继续”不得恢复历史写权限。
6. 自主 Agent 尚无安全的运行时跨 Provider 故障转移；`autoFallback=false` 时不切换是正确行为，未来若支持自动回退，必须在单次模型请求边界切换且不得重放已经执行的 Photoshop Tool。
7. Provider provenance 尚未作为结构化字段跨 IPC 传递；当前已确保 `unknown` 不标记为 Provider，但少数包含明确 HTTP 状态或网络语义的本地异常仍有低概率误归因风险，后续应在主进程真实请求边界签发结构化来源。
8. Task Profile crosswalk 与阶段知识已在代码层收敛，但尚无真实无 Skill 设计 E2E 证明模型能稳定形成并执行高质量设计决策；不得以继续堆 Prompt 或知识条目替代 V1 实证。
9. TaskRun 已拥有 waiting /revision /writer /operation result 的最小状态，但 liveness、Recovery、Completion 与预算 owner 尚未全部收口；重复控制声明或观察仍可能消耗后续写入、读回和评价预算。
10. 未经 Release 和人工复核的运行若进入 Memory / Skill，会把失败或偶然成功固化为跨会话偏差；M7 前不得开启自动晋升。
11. R-040 当前生产评分、Completion、Verdict、Critic 与 Reflexion 已完成证据资格 containment，但 M5 尚未建立唯一 Release Gate，也未完成所有 legacy /外部 producer 的全量归一；新消费者仍必须由审计阻止回退到裸 severity。
12. TaskRun 已提供进程内单文档 writer claim 与结构化续跑 revision 校验，但两个真实任务竞争、应用重启和 legacy Tool 覆盖尚未验证；裸“继续”继续不得恢复历史 mutation。
13. `layer-properties.ts` 中 `setLayerOpacity`、`setBlendMode`、`setLayerFill` 等相邻旧写动作仍需审计；`lockLayer` 的实机事故证明“先 resolve layer，再用 DOM setter”并不等于稳定目标写入。
14. Task Profile / Manifest 若被误当成用户授权，会把精确修改扩张成更多交付物或 mutation；当前精确属性请求已 containment，但普通自然语言声明后进入同一 TaskRun / R4 的生产接续仍待实现和实机验证。
15. 普通自然语言现在能看到通用 Photoshop Craft 索引，但 Recipe 可见不等于实际局部选区 /修补能力、TaskRun /R4 绑定或真实设计质量通过；若把知识入口修复误报成执行完成，会再次掩盖 V0/V1 缺口。

## 下一步

1. 冻结已完成核心验证的 F1/F2 Task Profile /阶段 Context Owner 与三条 F3 Recipe；后续知识和 Recipe 缺口必须由真实任务证据驱动。
2. 保持本轮精确修改的请求级最小写范围，设计安全的自然语言 →同一 TaskRun / R4 接续；Task Profile / Manifest 只能装载语义和方法，不能扩大用户目标或 mutation。
3. 完成 X1 剩余实机项：用真实 Photoshop 验证同文档竞争、waiting /resume、stale revision、重复提交与应用重启边界；V0 pack 与生产接线不再列为待编码项。
4. 完成 X2/V0 实机：由真实 Provider 提交包内 Tool call，经 TaskRun → execution envelope → E1 → UXP → Photoshop → 同目标 verification，并以结果决定片内猜测式归属的退役范围。
5. V1：再迁移受限单画布所需 capability pack，使用已接入的 Photoshop Craft Recipe 完成真实多尺度复核与唯一 Release Gate 首条消费路径；局部文字替换和主体感知置入作为共享工艺用例验证，不先扩业务 Skill 或自动学习。
6. M5/M6：收敛唯一 Release 消费者，再对主图、SKU Template / Color Card / Batch 与详情页做多样本真实验收。

## 治理锚点

`AGENT-REACT-REFLEXION-GOVERNANCE-001` 仍是历史治理依据之一；业务 Skill 的当前边界由 `business-skill-design-governance` 和 `Plan.md` 的 `Skill / Tool 边界`共同约束。三类 Skill 不是三套 Agent。

## 2026-08-04 门禁定义手册与防漂移审计（gate governance）

- 已核实（静态审计，未改门禁代码）：盘点了 v3 主路径 + v5 演进下的 27 个门禁/策略，按 10 类（S 安全 / A 授权 / C 确定性约束 / D 设计纪律 / B 预算 / F 熔断 / E 能力 / V 视觉 / N 完成判定 / X 业务链路）建立定义手册 `docs/agent-gates-definitions.md`（B 层文档）：每个门禁含 ID、位置、拦截行为、设计理由、放行边界、出口、判据自检。维护规则：改门禁代码必须同步手册条目；新门禁必须先过手册第 5 节 Checklist。
- 已核实（审计发现，按影响排序）：(1)【高】视觉预算/非视觉模型 × 设计纪律互锁——截图 not_observed 后 visualReviewed 恒 false，block-2（连续写 3 次）与 block-7（导出前必看）永久锁死写入与保存导出，无降级出口，最终被 policy-gate-repeat-guard 以"出口不可达"熔断；(2)【中】多交付物长任务（主图+详情页+SKU）targetRole 单一 + block-5 防重复建档 → 同角色第二个文档建不出来；(3)【中】预算熔断后"继续"命中 unboundAck 降级为 candidate_only → 续跑失去写权限，且纪律状态不跨 run；(4)【低】agent-resume-execution-gate 的 photoshopWritesAllowed !== false 与 business-skill-execution-preflight-gate 的 contextState[key] !== true 是 unknown 折向否定残留。
- 已实现（静态审计）：新增 `scripts/audit-gates.cjs` + `npm run audit:gates`（已接入 `maintenance:preflight:core`）：校验手册引用的 21 个文件与标识符在代码中真实存在、ID 唯一、明细完整（单向漂移检查：手册不能指向空气）。`npm run audit:gates` 通过、`npm run check:repository-encoding` 通过（994 文件无乱码）。
- 未验证（真机）：预算×纪律死锁与多文档长任务未在真实 Photoshop 复现验证；修复方向已记录于手册 4.1~4.4（纪律降级 / 多目标授权 / resume token），待立项实施。

## 2026-08-04 门禁五处缺陷核对与修复（gate governance round 2）

- 已核实（代码核对，逐条验证）：(1)【成立·高】预算×纪律互锁——agent.ts no-visual-capability / 预算耗尽写 not_observed(reviewed:false)，纪律 applyDesignDisciplineProgress 只认 visualReviewed===true 重置，block-2/block-7 永久锁死；(2)【成立·中】多交付物任务——inferDesignDocumentRoleFromTaskText 先到先得单角色，rolesMatch 折 reuse 拦死第二个同角色 createDocument；(3)【成立·中】熔断×续跑——预算熔断后"继续"命中 unboundAck 降级 candidate_only，v3 普通路径无 reflexion handoff（v5 session 路径已有）；(4)【不成立】agent-resume-execution-gate 的 photoshopWritesAllowed !== false 是协议守卫（模型恢复计划不得自我授权写，唯一通过值=显式 false，出口可达），非三态误判；(5)【部分成立】business-skill-execution-preflight-gate 的 contextState[key] !== true——调用方恒传 boolean 当前不触发三态，属防御性写法隐患。
- 已修复（缺陷 1）：design-discipline-runtime 新增 isStructuralDesignReviewTool（观察工具集-纯图像快照）与 isRuntimeVisualReviewBlocked（not_observed reason 白名单）；executor 新增 resolveVisualReviewedForDiscipline 三处共用（进度记录/回填复核/run-record）——视觉复核运行时不可用时，成功结构读回计入复核证据，写入/导出不再永久锁死。
- 已修复（缺陷 2）：design-document-role 新增 inferDesignDocumentRolesFromTaskText 多角色集合；buildDesignDocumentRoleContext 传 targetRoles；resolveCurrentDocumentUseMode 多目标分支（用户明确就地修改仍 reuse，否则 separate_target → createDocument 放行 + block-5 trusted 生效）；多目标 agentInstruction 文案同步。
- 已缓解（缺陷 3，根治待立项）：预算熔断消息（agent.ts readPerformanceBudgetExhaustion）指导用户重新描述完整任务，明确"单独回复继续不会恢复写权限"；结构化 resume token 待立项。
- 已修正（缺陷 5）：business-skill-execution-preflight-gate 改为 === false（未传字段=unknown 放行）。
- 已核实（不修改）：缺陷 4 撤销，手册 X-5 重标为协议守卫。
- 验证：build:typecheck:renderer 通过；audit:gates 通过；check:repository-encoding 通过。未做真机验证（无 Photoshop 实测），修复语义已按现有代码路径推演。

## 2026-08-04 详情页真机运行诊断：慢、未完成、被手动操作干扰

- 已核实（会话 f2e9aaa3 + errors.log 实证）：三连任务首轮 plan_execution_mismatch（20 轮，只读未动手）；整理图层轮 provider 429（小米 MiMo 请求过于频繁，iter=2 失败）；详情页设计轮多次 awaiting_user_confirmation（视觉观察/事实复核卡 ×3）+ no_progress（19 轮，错误 No progress detected）。errors.log 显示 UXP WebSocket 反复断开（06:56-07:32 十余次），与用户手动操作 Photoshop 的时间窗口重合。
- 已定位（根因链）：用户手动操作 PS → UXP WebSocket 断开 → moveLayer 等工具失败（"移动图层没有全部成功，暂不能确认画面达到要求"= agent.ts tool_failures_in_round）→ 模型盲目重试画布工具 → 无进展 → no_progress 停机。慢的主因：429 限流 + 连接不稳定下的失败重试 + 等待确认卡人工在环。
- 已修复：agent.ts 工具失败分支新增 failedBecausePhotoshopDisconnected 识别（匹配 UXP 插件连接已断开/WebSocket disconnected），命中时 emitStep「Photoshop 连接断开」+ harness 控制消息明确指路：停止重试画布工具、提示用户检查 UXP 面板、本轮可用非 PS 能力——防空转消耗迭代（与 no-open-document 分支并列，断开优先）。
- 未修改：429 限流无自动退避（保留快速失败，用户可切换模型）；等待确认卡次数（产品流程）；UXP 侧 moveLayer 的 translate 不支持分支（PS 版本差异，风险高）。
- 验证：build:typecheck:renderer 通过；audit:gates 通过。未做真机复测（需真实 PS + 小米模型环境）。

## 2026-08-04 品类词条库归一（design-category-terms）

- 已实现：新增 `src/shared/design-category-terms.ts`（唯一词条数据源，6 类 51 词条 + SKU 边界模式 + 构造 helper buildCategoryTermPattern / buildCrossCategoryTermPattern）；5 个消费方替换为「子集声明 + helper 构造」，正则语义与原版逐字一致（design-document-role / agent-task-planning-contract / sku-intent-params / task-completion-contract / agent-intent-control-plane）。
- 关键事实（盘点结论）：各处品类词并非完全相同，而是各阶段裁剪过的子集（如 name 判定用 detail-page/product\s*detail 别名、意图判定用 长图）——因此不合并判定逻辑、只归一词条数据，消费方以子集声明保留各自语义。
- 已实现（对比验证）：新增 `scripts/verify-category-terms.cjs` + `npm run audit:category-terms`（已接入 `maintenance:preflight:core`）：(1) 词条库 51 词条全部在 git HEAD 旧代码存在（防行为扩张）；(2) 每个消费方子集声明词条在旧版对应文件存在（防抄错/漏抄）；(3) 子集词条必须登记在词条库（防漂移）。当前全部通过。
- 验证：build:typecheck:renderer 通过；audit:category-terms / audit:gates / check:repository-encoding 通过。未做真机；正则语义一致性由逐字构造 + 存在性验证保证（本轮为纯重构，无行为变化）。
- 基线修复（同轮）：verify-category-terms 基线由 git HEAD 改为「改动前版本」自动解析——当前文件与 HEAD 不同（未提交）取 HEAD 为旧基线；相同（已提交）取 HEAD~1，避免提交后守护退化为自洽检查。已验证 HEAD~1 基线可用。

## 2026-08-10 SKU 色卡 UXP 手动双模式入口

- 已实现：UXP 主面板新增「色卡制作」入口，用户可直接选择多张商品图、编辑权威颜色名、调整顺序、选择输出目录和 PSB 文件名，无需向 Agent 发起对话。
- 已实现：入口明确分为两条互斥链路。`INS 卡片色卡` 使用 `retouchMode=layout_only`，保留原图/场景并跳过抠图、形态统一和中性灰；`纯底精修色卡` 使用 `retouchMode=studio_retouch_required`，进入现有确定性抠图、形态统一、原影分离与中性灰修正链。
- 架构边界：手动入口通过 UXP → Main → Renderer 桥接直接复用既有 `executeSkuColorCardStrategy`，没有新增第二 SKU Skill、第二色卡执行器或通用 Agent 品类分支；Main 负责请求互斥、超时和进度转发，Renderer 只投影紧凑结果，不把快照/base64 回传给面板。
- 完成语义：面板成功只声明“可编辑色卡结构已生成”，明确提示用户在 Photoshop 中检查轮廓、裁切、特殊袜口、纹理与光影；未把结构写入成功伪装成专业精修或商业质量验收完成。
- 验证：`build:typecheck:renderer`、UXP production build、`audit:handlers`、`audit:tools`、`audit:skill-standard`、`audit:executor-generic`、WebView 内联脚本语法与静态 ID 重复检查均通过；当前环境没有可调用的 DesignEcho Photoshop MCP/Computer Use 实机通道，因此新手动入口的真实 Photoshop 文档写入仍未验证。

## 2026-08-10 多 Harness 控制权治理闭环

- 架构结论：当前不是多个互相独立的 Agent 产品，而是一个 Design Agent 运行系统中的多层 Harness。Task /Intent、Context /Knowledge、Runtime /TaskRun、Capability /Tool、Observation /Evidence、Aesthetic /Evaluation、Completion /Reflexion 与 Compound Budget 各有不同职责；治理目标是让它们共享同一身份、事实和控制边界，不是再造一个总管 Kernel。
- Runtime 原子绑定已闭合：自然语言在循环内声明 Task Profile 后，候选 Runtime Bundle、Capability Session、阶段 Context、Evaluation Profile、Artifact 授权、性能预算与 generation lineage 全部构造成功后再一次提交；动态 Context 从新 Bundle 重编，不沿用声明前空上下文，也不重启 Agent /TaskRun。
- Completion 与门禁已事实化：通用创意只硬校验真实写入、正确目标、最后写入后的同目标读回、显式 copy /no-copy 最终态与可验证文件交付；Evaluation Profile 不再绕过事实义务。审美、白底、极简、扁平、居中、标题和卖点不再作为通用写前权限配方；未知最终态降为 `needs_review`，不是伪造 pass 或 failed。
- 审美 Harness 已形成非授权闭环：终局 Judge 每 generation 有独立保留的 model /visual /candidate /90 秒时间窗口；score 是唯一数值权威，无分结果不污染覆盖率，文字专属断言可可靠 N/A，诊断按最低分 /严重度 /权重强制只保留 top 3。Profile 可选检查从评分和 Completion 门禁中排除，但仍保留在 verification digest 与 warnings；结构测量明确标为同历史的结构启发而非像素事实，背景默认态与 baseline-only 伪信号不再外发。
- 完成后审美改进不再硬化成失败：只有 `completed + final_response + 零 blocker + 同历史完整 VLM 批次 + 合法三层 diagnosis`，且 Runtime 声明 E2 时本轮已经取得新鲜结构化交付证据，Harness 才签发结构化 R5→R4 marker。v5 将其登记为 `needs_review → R4` 但保留用户任务 `completed`、不追加 blocker；外层只注入真实 diagnosis 且最多重入一次。普通 R5 失败仍保持 failed /needs_review 路径，marker 不授予 Tool 权限、不改变 DesignVerdict。
- Prompt /Context /检索做了减法：固定写前四步、阶段口令授权、自动外部参考检索与重复开场读取已移除或收窄；已知目标 /素材走最短证据路径，外部知识只在能改变决策时按需取用，缓存 /静态索引优先。Brief /Strategy /Evaluation Profile 编译为有界全局评价上下文并贯穿 Design Team 全阶段，补充上下文仍标记为不可信且不能授予权限或裁决。
- Design Team 预算不再绕过父 Agent：父运行在完整流水线真实启动前事前保留收尾额度，只向子级下发六字段 allowance；基础路线按角色真实最低成本加权（executor 为 4 model /3 tool），`needs_fix` 的完整修订 route + critic 复审一次性原子预留，额度不足时零修订并诚实返回 `qualityPassed:false / budgetExhausted:true`。取消、deadline 和阶段失败真实传播，未用额度不退款，也不按 `childAgentUsage` 事后倒扣。
- 三态与耦合债务收敛：能力 `unknown` 继续放行到真实执行，只有 `unsupported` 可阻断；三态折叠棘轮降至 29。品类词、SKU 子集和创意意图模式收回现有 `design-category-terms` Provider，业务耦合棘轮恢复到 22 /51，简化棘轮从 147 收回冻结基线 140，没有抬基线。
- 验证：`maintenance:validate` 完整通过 21 个核心检查，包含规划一致性、仓库卫生、1050 文件编码检查、163 Tool 注册、Handler、18 Skill、通用 Executor、Capability、Prompt、Gate、三态、品类词条、Design Intelligence、命题 /Store /Agent 测试、Main /Renderer 类型检查与 UXP production build；无临时 Smoke 依赖。
- 未验证：本轮没有启动真实 DesignEcho /Photoshop 生产会话，没有对用户 PSD 写入，也没有取得多任务样本的人工审美评分、首个有效写入延迟、重复观察率、返工收敛率或商业质量数据。代码闭环证明 Harness 不再按已知根因封印 Agent，不证明 Agent 已经稳定“设计得好”。

## 2026-08-10 SKU 问题发现与执行效率治理

- 从真实运行记录确认，旧路径不是“模型想太多”一个原因，而是首轮没有看见正确 SKU Workflow、纯文本追问没有形成结构化暂停、重复能力激活仍被当作进展、通用路径又重复读取文档 /截图 /模板目录。它最终只做了一次与目标无关的可见性修改，不能算 SKU 编排完成。
- 首轮现根据既有 Skill routing 声明生成唯一 Workflow recommendation；该信号仅用于导航和 schema 可见性，不绑定 Runtime、不授予权限，零候选或多候选时不猜。正确进入 `sku-batch` 后，已有组合确认卡继续负责“缺权威组合规格先暂停，确认后才生产”。
- 新增通用 `deterministic-consistency-verification` 与 SKU pack-count adapter。当前批次执行计划是 authoritative expectation；模板文件名只是元数据 observation；ordered slots 是结构 observation；可见文字层是 document-text observation。所有文档事实绑定 documentId + historyStateId，旧 revision 立即失效。
- `skuLayout.inspectTemplateLayout` 升级为 versioned inspection，在既有一次图层遍历中同时返回有界可见文字，不调用 OCR、不新增截图。SKU preflight 现在对计划 /文件名 /结构 /文字进行对账，并把报告 proofRef 投影到结果。
- 自动修复严格限于单点文字冲突：计划、文件名和 ordered-slot 结构均匹配，唯一可编辑文字层不匹配且观察未截断时，才允许 `setTextContent` 精确改数字。写入同时校验目标 document、history revision 和旧文字内容，完成后重新 inspect 与再验证；结构 +文字同时错误、多文字冲突、文档变化或证据不完整均不会自动改。
- 门禁保持局部和可恢复：观察不足不判失败；可修冲突只拦当前模板生产动作并开放 read /repair；证明确实无法安全修复时才跳过该规格，其余规格可继续并返回 partial。legacy region 模板的 region 数不再误当商品件数，文件名独自漂移只报 warning，不擅自重命名源文件。
- 效率侧移除了三类系统性浪费：`listDocuments` 轮询不再递归统计全部打开文档图层；模板 inventory 在单次 SKU run 中优先只扫描一次并本地派生规格；重复 capability 激活产生结构化 idempotent no-op，连续三轮无状态变化即停止。模板评分同时收为 main /renderer 共用的纯逻辑单一 owner，并固定用户规格模板、生成卡片兜底、备注模式、规格排除与 sourcePriority 语义，避免优化扫描时悄悄改变选中模板。正确 SKU Profile 视觉预算为 0，不再走通用 Agent 的多轮截图链。
- 保留了一个诚实边界：当前 annotated snapshot 没有完整图层 coverage provenance，不能冒充 fresh `getLayerHierarchy`。因此未通过降低证据要求来“优化”读取；真正缺强结构证据时只补一次定向 hierarchy，而不是启动整轮 Reflexion。
- 验证：3/3/3/4、3/3/4/4、4/3/4/4、无数量文字、revision 失效、legacy region、旧 inspection schema、截断文字、同层多个数量、隐藏文字与共享模板选择行为用例通过；`audit:agent-business-boundaries` 0 violation，`audit:tools` 163 项无漂移，补丁检查通过；全部复审修复完成后完整 `maintenance:validate` 再次通过 21 个现行核心检查和 UXP production build。
- 未验证：本轮没有启动真实 Provider /DesignEcho /Photoshop，也没有对用户 PSD 执行自动文字修复。首次有效动作延迟、模板扫描次数和真实 SKU 批次的 p50 /p95 仍需运行指标证明，不能仅凭静态检查声称性能目标已经达成。

## 2026-08-10 审美、选图与 Photoshop 合成纵切

- 根因已从“模型不会设计”拆成可治理责任：通用 `placeImage` 曾在缺素材时隐式检索白底产品图，自动模式又绕过分数 /差距；详情页 Ranker 只看粗分类并机械执行 top-1；`needsMatting` 没有执行消费者；置入结果用执行意图冒充真实 clipping /parent /smart-object 关系。因此用户看到的白底首屏通常不是可追溯的设计主张，而是工具默认和执行契约断线。
- 自动选图已改为显式且证据化：未声明 auto 时必须给唯一 source；显式 auto 必须有当前 design role、一次联系表真实视觉观察、直接使用适合度、source treatment、最低分和候选差距。metadata-only、用途未决、需去底重组、supporting-only、finished-design 与近分候选均不静默写入。模型 `force` 不能再用自填的用户 /项目来源和理由越权，当前仍按 `agent_judgment` 走相同视觉边界；只有未来非模型控制面签发的 Harness receipt 才能表达外部授权。
- 素材判断已任务化：详情首屏的白底 /纯色棚拍源进入 `matte_and_recompose`，透明主体进入容器，场景 /上身图在角色匹配时进入容器，细节 /材质图只作佐证，完成设计成品拒绝作为原始素材回流。白底、极简和剪切蒙版本身都没有被写成全局审美硬规则。
- 选图效率与来源边界已收敛：Resource Manager 先形成最多 12 个启发式短名单；定点 `placeImage` 默认同屏比较 5 张，详情页库存冷启动可在同一张编号联系表中比较最多 12 张，二者都只调用一次视觉模型；视觉结果权重 0.78，元数据权重 0.22。详情规划先消费与当前素材版本一致的新鲜缓存；冷缓存直接复用本轮预扫描库存，不再次递归扫描项目，单屏重建通过 Harness 签收的库存对象身份复用同一观察，模型 JSON 副本不能伪造候选路径，空库存也不按屏重复扫描。联系表新增并贯通 `assetNature`，参考图和已设计成品不会因 `designed_composite` 外观被自动剪切进非首屏。
- Photoshop 合成事实已接通既有详情填充路径：图片计划携带 source treatment、容器与预期关系；UXP 在写后读取真实 clipping、精确 base、parent group、smart object 与 Photoshop `userMaskEnabled`。FillPlan 内联 matting receipt 只保留兼容形状、不能证明去底已完成；需抠图、显式 deferred、缺失或找不到 clip base 的图片会形成可恢复的局部延期，不送入 filler，也不计为完成。已知关系不一致只让对应图片 /placement 失败，读不到则 `needs_review`；没有把未知折叠成失败，也没有封锁读取和修复出口。修复了 legacy 占位层作为剪切基底后又被删除的真实缺陷。
- 审美 Harness 已补充 `aesthetic-judgment` 与详情页 `imagery` 知识，并在完整详情页 Profile 增加 `craft.asset-integration` 软视觉断言，检查角色、裁切、矩形背景断裂、边缘、光影、透视、色彩和空间融合；最多三条可靠 diagnosis、最多一次有界改进，审美 finding 不授予 /撤销权限。
- 权限边界没有被绕过：安全审查拒绝给 create-new handoff 与 visual-repair allowlist 持久增加 `releaseClippingMask` / `moveLayerToGroup` 等结构写权限，因此本轮只修复既有 `fillDetailPage` 已授权事务。要让通用 create-new /视觉修复自主建立或重建 clip /group，仍需用户对这项权限扩张明确授权。
- 仍未完成：白底素材的异步 remove-background → apply-matting continuation 尚未接入详情 FillPlan 的自动续跑，因此当前能诚实阻止原白底矩形直贴，但在只有白底素材时还不能保证自主完成重组；通用 layer effects /mask /blend appearance plan 与完整读回也未建立。
- 验证：`maintenance:validate` 21 项全部通过，包含规划 /仓库卫生 /编码、163 Tool、18 Skill、Handler、通用 Executor、Capability /Prompt /Gate /三态 /品类词 /业务边界、Agent 测试、Main /Renderer 类型检查与 UXP production build；`git diff --check` 无错误。当前没有可调用的 DesignEcho Photoshop MCP 实机通道，所以没有把自动化结果冒充真实 PSD 设计质量、人工审美质量或耗时改善。

## 2026-08-11 行内多模态消息与编辑重发根修

- 根因：原实现把模型使用的 `【引用…】` 定位串直接写进 `Message.content`，编辑入口又只恢复纯文本，导致用户编辑重发时内部 marker 可见、附件结构和文本顺序丢失；同时默认 autonomous Agent 不经过 ChatPanel 的后置模型包装，实际仍把图片集中放在文本末尾。
- 已实现：新增有序 `ChatComposerContentPart` 作为消息规范载体，文本、上传图片、Eagle、项目素材和知识引用按编辑器位置保存。新富消息编辑时恢复同一 parts；旧消息只在有证据时精确恢复，否则移除 marker、保留可恢复文本 /图片并显示降级提示。会话标题和消息渲染都只消费安全自然语言 /引用标签，不显示 locator。
- Agent 接线：冻结 submission 同时生成持久 Message、Operating Context 和 Agent 初始输入；当前用户消息由 Harness provenance 定位。`currentUserContentParts → initialUserContentParts → Agent.buildUserMessage` 已贯通默认 v3，图片仍先过视觉候选预算，未获准图片只留下诚实的未附带说明，不通过 UI 顺序功能绕过预算。
- 输入效率与边界：粘贴只接受 `text/plain`，混合文本 /图片不再静默丢文本；多图 FileReader 先占位后回填，顺序不受完成时序和光标移动影响。5 张、单张 8 MB、总计 20 MB 同时在添加入口和发送边界校验；parser 不再对整段 Base64 `JSON.stringify` 哈希。
- 验证：`build:typecheck:renderer`、`build:renderer`、`audit:agent-business-boundaries`（新增多模态跨层检查，0 violation）、`audit:tools`、目标文件 `git diff --check` 与真实窗口审计脚本语法检查均通过。生产构建只有既有动态 /静态 import 与大 chunk 警告。
- 未伪装完成：消息提交后仍通过 2 秒防抖落盘，当前不是耐崩溃的磁盘 ACK 事务；跨轮历史图片尚未预算化重附给模型；旧消息若历史上从未保存附件二进制，系统无法凭 marker 恢复原图。最新编辑重发交互尚未在真实 Electron 窗口重新操作一遍，本轮结论来自类型、构建、行为 /静态审计与此前 Composer 视觉 QA。

## 2026-08-12 SKU Skill 自主模板与占位修复闭环

- 真实失败所有者已确认：裸“帮我做SKU”正确直达唯一 `sku-batch` Skill，但旧参数默认器为所有真实 SKU 出图注入组合确认，执行器又在无规格时静默退化为 2 双 5 组，因此在模板检查、占位创建和任何 Photoshop 写入前返回确认卡。停止与预算、Photoshop Host、Completion 或 Skill 路由无关。
- 普通 full 请求先使用 2 /3 /4 双非权威可逆草稿完成色卡、模板、占位符检查或补齐；候选组合准备好后默认展示结构化组合卡，确认后才批量生产。用户明确跳过确认或项目已有受信权威组合时可直接继续。模板库存只证明现有能力，不再反向拥有任务规格，未知规格 PSD 不得冒充 N 双模板。
- 缺失模板、缺失自选备注模板和可修复的既有模板占位 /布局问题，统一在同一个 SKU Skill 中产生声明式 repair handoff。Agent 可连续使用已有原子 Tool 读取参考、创建或切换文档、设计结构、创建 /调整占位、检查快照、另存新候选、精确读回，然后重入同一 Skill 继续批量生产；没有增加第二 SKU Skill 或 Agent /Harness 品类分支。
- 模板安全边界已收紧：不可靠或失败的 `inspectTemplateLayout` 不产生修复授权；聚合预检保持只读，结构全部可执行后才进行定点文字修复；旧源模板不得由模型布尔参数授权覆盖，repair 结果必须显式新路径并以 `fail_if_exists` 另存。
- 新版 `-DesignEcho候选` 只作为待验文件发现信号，不参与普通模板评分。SKU Skill 必须按精确路径打开并核对当前 documentId /historyStateId、v3 inspection、占位数量、layoutPlan 与可见规格文字；验证通过才优先于旧模板，验证失败不能再从普通 opened /project /local fallback 偷渡，从根因上消除“修完又选回旧坏模板”的循环。
- 通用 compact E1 continuation 增加 repair epoch 证据义务：同一轮可连续原子读、写、保存和切换文档，但 owner 在本轮无新 mutation 或任一目标 latest revision 未精确读回时隐藏且执行点拒绝。新的 handoff 保留同一 Runtime 绑定下的跨文档证据并把 epoch mutation 计数归零，不能清空旧证据、复用旧证据空转完成或用单文档读回冒充多文档完成。owner 最终 `completed` 并产生新 mutation 时进入通用 `ownerAccepted` 相位，只保留 latest exact readback；读回后同次闭合 E1，不再重跑 owner 或重复生产。
- 行为回归覆盖 success /nonFatal 两类 handoff、两轮 repair、owner 隐藏与恢复、双文档 stale /exact revision、最终 owner 的可信嵌套 mutation、`ownerAccepted` 后直接进入 R5、候选验证成功 /失败、未知规格模板拒绝以及源覆盖保护。组合交互决策已有纯函数回归：非权威候选默认弹卡，明确要求确认仍弹卡，明确跳过 /已确认 continuation /受信权威组合不重复弹卡。`maintenance:validate` 22 项、Runtime declaration、Agent business boundaries（0 violations）、Main /Renderer 类型检查、Agent /UXP production build 和补丁格式检查全部通过；最终 Renderer 于 17:57 重新生成。
- 诚实边界：当前非 watch Electron 实例在最终构建前已启动，尚未加载新 Renderer；本轮没有重启应用、没有写用户项目 `E:\WERKE\C-1245`，也没有取得真实 Provider → Photoshop 的 2 / 3 / 4 模板、占位、导出和人工视觉质量证据。代码闭环不等于商业设计质量完成。

## 2026-08-11 真实项目 SKU 2 / 3 / 4 双装基线与确定性修复

- 验证输入固定为用户已在当前桌面程序添加的 `C:\Users\12611\Desktop\测试\测试`；目标批次为 2 / 3 / 4 双装。项目商品目录已观察到三类真实产品外观，当前没有可据为权威组合规则的项目内表格文件，因此 4 双装只能作为 `agent_delegated_draft` 可逆草案，发布前仍需复核，不能伪造为表格权威事实。
- 验证集 `D:\A1 neveralone旗舰店` 只读：确认存在偏 INS /生活方式感和偏干净纯色卡两类成品，可用于人工 rubric 对照；未从该目录复制图片、PSD、配置、命名或组合逻辑，也未对该目录写入。
- 真实失败基线：同一当前程序运行约 20 分 33 秒，24 iterations、25 model calls、1 Reflexion，停机原因为 `tool_preflight_blocked`；重复读取后仍无 Photoshop write、无导出文件、无最终设计。该结果证明旧链路既慢又昂贵，且不能用“Tool 调用成功”冒充业务完成。
- 根因修复：UXP `arrangeDynamicSkuLayout` 不再把每张商品卡都缩放到整块共同区域后只做左 /中 /右移动；现在先把声明区域确定性拆成互不重叠子槽，使用共享 contain scale，再通过既有 auto-layout QA 校验实际复制后的完整卡片 bounds、间距、重叠和安全区。
- 结构真实性：复制后的 SKU 卡必须是新的可编辑顶层对象，直接子节点数和递归节点总数必须与源卡一致；缺 SKU 层、缺颜色组、复制复用旧层、结构缺失、bounds 无法读取或卡片数量不足均成为当前规格的失败，不再 `continue` 后伪装成功。
- 交付真实性：`executeComboLayout` /batch 只有所有请求规格均完整导出且写后 readback ready 才返回 completed /success；部分规格、缺文件路径、结构化导出回执畸形、读回阻断或布局 QA warning 均返回 partial /failed /blocked_export_readback。
- 正式验证：2 / 3 / 4 有界布局、实际 bounds QA、缺卡阻断、完整 /部分 /读回失败交付状态均进入既有 `audit-agent-business-boundaries`；UXP production build、Renderer typecheck 与完整 `maintenance:validate` 21 项核心检查全部通过。
- 运行边界：未启动新应用、未关闭或重启用户当前程序。核对时 Electron PID 59956 /56416 均响应正常，8765 /8766 /8767 均由 PID 59956 监听。当前实例是非 watch 运行且尚未自然加载新构建，所以没有再次用旧代码购买一轮高成本失败。
- 待完成：同一当前程序自然重载最新构建后，重新执行真实 2 / 3 / 4 双装，记录首次有效写入延迟、模型 /Tool /图像呈现次数、组合 provenance、document /history、输出文件与同版本读回，再对照只读验证集做人工视觉评审。取得这些证据前，不声明真实 Photoshop E2E、设计质量或商业质量已通过。
- 真实项目后续核对发现 20 张模特图 + 21 张平铺图，而旧 12 张 `visionCandidates` 会被模特图优先级占满；既有视觉缓存实际为 11 张模特 + 1 张平铺，且包含“小羊袜→蘑菇袜”的错误观察。根因在项目视觉候选池的同角色截断，不在模型提示词。
- 已修复：`project-asset-index` 在同一 12 张上限内按角色轮转；`project-visual-sampling` 在同一场景预算内按角色槽位选取。真实项目生产探针为候选池 6 模特 + 6 平铺、SKU 4 张为 3 平铺 + 1 模特、general 4 张为 2 + 2；没有增加图像呈现或模型调用次数。
- 正式审计新增 20 模特 + 21 平铺的真实分布用例，防止候选池重新塌缩为单一角色，并要求 SKU 优先覆盖商品款式且保留场景参考；`build:typecheck:renderer`、`audit:agent-business-boundaries`、完整 `maintenance:validate` 21 项与 Renderer production build 全部通过。
- 只读验证集盘点为 23,341 张图、1,025 个 PSD /PSB；跨货号主图联系表确认成熟成品同时包含生活方式 /INS 近景与干净纯底路线。验证标准固定为商品主体真实性、组合数量、裁切、比例、间距、标签、留白和商业完成度，不把验证集图片、模板或组合配置回流到当前项目。
- 当前唯一 Electron 主进程的 8768 MCP Host 已真实初始化；`system.status`、`photoshop.connection_status`、`photoshop.tools.list`、活动上下文和项目根目录只读通过。Photoshop UXP 在线但无打开文档；当前 MCP 无自主 Agent /Renderer reload 工具，所以保持“同一应用重载后再跑”，不以直接原子 Photoshop 调用绕过自主设计测试。
