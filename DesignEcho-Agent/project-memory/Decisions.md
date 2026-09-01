# Decisions

本文件只保留仍约束当前实现的关键裁决。更早的 D-001～D-059 由 Git 历史保留。

## D-132 当前阶段先以业务 Skill 建立专业基线，真实用户标点与单图观察不得使 Agent 退化

- 状态：active；代码、专项回归与 fresh 65 阶段核心闸门已完成，同提示正常程序复测待完成。
- 当前低预期是先用主图、SKU、详情页三个 Skill 形成可重复、可归因的专业交付基线；无 Skill 的成熟设计师泛化继续保留为更高阶段目标。Skill 提供交付物特有的方法、生产容器与评价，Agent 仍拥有任务理解、是否采用候选 Skill、产品理解、选图、参考、创意、构图、文案和审美。Harness 只恢复候选可见性、事实、能力、事务与验证，不能因关键词直接绑定或执行 Skill；用户明确禁用 Skill 时仍走通用 Agent 原子能力。
- 正常主图诊断使用自然输入“帮我设计一张商品主图。”时没有调用 `declareDesignIntent` 或 `main-image-design`，而是进入未绑定通用工具链。首个确定性根因是 canonical production entry 只接受交付物后立即结束，正常句号、叹号、问号或成对引号使唯一 Skill recommendation 完全消失。修复只移除句末非语义包装，动作、交付物、词序与唯一候选仍必须由 Skill 自身声明完整命中；“你会做主图吗？”等能力问句继续不产生生产候选。测试必须保留用户真实标点，不能用删除标点后的开发句制造假通过。
- 候选联系表解决“有哪些”，单图观察解决“这一张细节是否合适”。`describeImage` 现在把已知本地素材像素直接交给同一个多模态 Agent，内部模型调用为 0，不排名、不选择、不写 Photoshop；`placeImage` 只表示把已选素材提交到构图，不能再被当作临时图片查看器。设计首轮用单图观察替代 `openProjectFile` 的 JPG 误用，PSD /PSB 打开仍在同一 Capability Session 按需可达。
- 同一 run 中参数不同但实际 presentation bytes 完全相同的画面只向主模型发送一次；新裁切、新文档版本或任意像素变化正常放行。该复用状态属于现有视觉 /性能模块，不进入 `agent.ts` 新分支、项目记忆、权限或质量结论；简化棘轮仍保持 12823 行与 137 个 legacy 正则点，不通过提高基线容纳新债务。
- 本裁决不证明主图 Skill 已被真实采用，也不证明设计质量提高。下一步必须用正常程序、同一短提示和新对话验证 Agent 是否主动绑定主图 Profile、是否使用 `prepare → 通用 Tool → finalize`、是否停止画布试图和重复像素读取；任何新首偏差都按病历停止并修复。

## D-131 礼貌问句不抹掉具体只读委托，文本 Tool 协议不能成为用户终稿

- 状态：active；代码、专项回归与 fresh 65 阶段核心闸门已完成，正常程序复测待完成。
- 正常程序 2026-09-01 10:46 的项目查看请求“你可以帮我看看这个项目都有什么”在约 4.4 秒内结束，但真实 Run 只有 1 次模型调用、0 Tool、`toolSchemaChars=2`，随后把 `<{"name":"list_directory","arguments":...}` 直接显示给用户。它不是效率改善，而是任务被提前终止：能力问句判据把“什么”的末字“么”当作语气词，先把礼貌委托降成 `chat_only`；对话出口又没有识别 angle + JSON 的文本 Tool 协议变体。
- 自然语言 owner 以完整语义和副作用为准，不以“你可以 /你能不能”开头就丢掉安全的查看目标。移除 Agent 能力句式后，若余下正文仍包含“帮我 /替我 /为我”等直接请求 cue，并构成项目 /文档 /SKU 的只读检查或参考检索，就按只读委托继续。涉及设计、修改、保存或导出的“你可以帮我……吗”仍是能力询问，不能静默获得写权限；明确“帮我设计 /请修改 /开始做”才形成执行授权。
- Provider 将 Tool call 写进正文时，无论是 DSML、`<tool_call>` 还是 `<{"name":...,"arguments":...}` 变体，都不能作为自然语言成功终稿。对话路径必须拒绝该候选并在同一次请求内做一次自然语言修复；仍失败则保留 `protocol / rejected_by_cleaner` 事实，不能显示内部 JSON、不能只留下“我先看看”后假装仍在运行。清洗器只作最后防泄漏，不拥有任务成功判定。
- 正常应用、测试用例 Runner 与 CDP 窗口检查不得竞争同一 Electron 单实例。正常程序诊断必须先验证唯一主进程和 8765–8769 /9223 的共同 owner；无参数 running-window 脚本会执行默认 Case，不得再把它当纯窗口探针。测试消息、测试停止条件和 Case 答案继续留在开发路径，不进入生产 Prompt、Project State 或 Agent 经验。

## D-130 Skill 的内部生产契约与模型可见设计接口必须分离

- 状态：active；主图首个纵切已实现并通过 fresh 65 阶段核心闸门，同提示正常程序复测待完成。
- 正常程序 Run 665 使用新普通项目与自然短提示后，Agent 已形成“穿着场景主视觉、四色平铺辅助”的合理方向，但约 15 分钟仍没有内容写入。10 次模型调用累计约 1,176,756 ms，14 次 Tool 仅约 11,527 ms；前三次 `main-image-design` 分别因不应在 prepare 阶段生效的 `supportRefs` 和 `executionScope` 失败，第四次才创建空工作文档。该运行在取得明确无进展证据后人工停止，不再把已知错误带入后续设计。
- 一个 Skill 可以保留完整内部参数供 Executor、卡片、兼容生产和交付事务使用，但模型工具 schema 只投影 Agent 拥有的业务 /设计决定。投影不得隐藏 required 参数，也不得把路径、support refs、执行范围、事务模式、收据或交付版本交给模型猜测。Runtime-owned 参数即使由模型伪造也在执行入口剥离；prepare 固定使用 disposable document scope，且不在不保存 /不导出的阶段校验交付字段。
- agentic 常驻上下文只注入当前任务特有的方法 overlay 与紧凑通用原则；Artifact 方法、Craft recipe 索引和深层知识保持可检索、可按需取得，不与 Tool 描述重复常驻。主图 Skill 模型 schema 已从约 11,007 字符降为 2,857，绑定后常驻方法上下文降为 2,236 字符，pre-bound Tool schema 从约 37,308 降为 32,785；`moveLayerToGroup` 作为基础图层卫生能力直接可达，不再先搜索能力。
- 竞争式控制的审计口径是“同一决定、事实或权限是否被 Prompt、Skill schema、Capability、Runtime 默认值和 Executor 多处同时表达”。只有唯一 owner 可以强制；其余位置只能引用、投影或按需提供。SKU 与详情页目前仍有 13,834 /7,989 字符的模型 schema 风险，但本轮没有证据证明它们发生了与 Run 665 相同的失败，不在主图修复中盲改；后续各用自身真实 Case 验证后再沿同一投影机制收敛。
- “发现问题即停止”属于开发诊断纪律：真实运行已出现可归因、无新信息的重复失败或长时间零有效进展时，停止当前 Attempt、保留完整病历、修复首个偏差后再用同一输入复测。该规则不得进入生产 Prompt、设计知识或测试答案，不能变成 Harness 替 Agent 决定设计步骤。

## D-129 创意 Agent 的模型可见工作台必须精简，高级能力按需可达

- 状态：active；首个模型可见面收敛由 `b10da18a` 实现并通过 fresh 65 阶段核心闸门，真实 Photoshop A/B 待完成。
- Run 663 /664 证明当前失配不只是模型慢：Run 663 的 31 次普通 Agent 回合累计约 197 万 input token，首轮 26 个 Tool schema 约 42.5k 字符，后期升到 45 个 /65.7k；53 次 Tool 中 30 次观察、8 次控制，却只形成一次置图、一次缩放和少量移动。Run 664 仍以 12 次观察、4 次 mutation 完成摄影图裁切，未检索 Eagle。复杂度已经进入模型认知路径，而设计增量没有同步增长。
- Harness 的 TaskRun、target /revision、执行授权、唯一 Photoshop 事务、读回、交付收据和外部文档保护保持后台强制，不因精简而删除。模型首轮只保留项目 /画面观察、图片、图形、可编辑文字和局部变换等原子手柄；`composeDesign`、隔离 `evaluateDesign` 与 `readSkillPlaybook` 仍在同一 Capability Session 中，但只有 Agent 明确需要时才装载。
- Agentic Manifest 已自动提供本任务方法知识，Skill 声明不得再要求开工重复读取同一手册。通用设计原则在 agentic 首轮只注入 overview、自检与落地摘要；构图、字体、工艺等深层知识继续由 Agent 按当前问题检索。当前审查棘轮为首轮不超过 24 个 Tool、序列化 schema 不超过 30k 字符；实测为 24 /29,154，紧凑原则 1,112 字符，全量 staged 原则仍保留 6,408 字符。
- 这项收敛不证明视觉质量已经改善。下一步必须在同模型、同素材与自然短提示下比较 Tool /Prompt 体量、首个有效设计动作、参考选择、设计增量和用户 /Eagle 盲化结果。若质量下降，按具体缺失能力逐项恢复，不得把完整大型工作台一次性塞回首轮。

## D-128 Main Image Skill 的正式交付必须由可持久化 workspace 与唯一 finalize 闭合

- 状态：active；正式 completion owner 已由 `36a1db51` 实现并通过 fresh 65 阶段核心闸门，workspace 持久化与重启 reconciliation 待完成。
- prepare workspace 必须成为同一 Runtime TaskRun 拥有的有界、可持久化、可 reconciliation 身份事实，至少绑定项目、task type /manifest、document、标准 group、prepared revision、创建收据和失效状态。它不授予 Tool、写入、设计或完成权限，也不复制到 Design Project State；应用重启后只能按当前 Host /文件事实校验恢复，不能凭旧内存信用续写。
- Agent 仍可自主调用通用保存 /导出作为原子工作动作，但一旦主图任务进入 prepare，这些调用不能签发 Main Image Skill 的正式 completion、不能替代同 workspace finalize，也不能把导出 JPG 再置入新文档后伪装成专业可编辑稿。正式交付只能由 finalize 对账唯一规格、同 TaskRun /document /revision、真实非空层级和 exact staged transaction 后闭合。
- 依据：Run 663 先交付 800 稿，再建 1440 文档并重置入 JPG，形成两套正式文件；Run 664 虽技术成功，最终 1440 PSD 仍只有 3 层。文件存在与评测通过都没有证明生产 owner、可编辑性或专业设计成立。
- 负面教训：为每次旁路增加“结果需要复核”、重复保存或新恢复卡只会在错误基础上叠加状态。根修位置是 completion authority 与 workspace 生命周期，不是 Agent 文案、固定工作流提示或额外设计规则。

## D-127 未完成 Run 的自动续跑只恢复 Runtime identity，不恢复执行权限

- 状态：active；代码、攻击回归与 fresh 65 阶段核心闸门已通过，由 `b4998b65` 提交推送，并经正常程序 Run 664 验证。
- 同分支未完成 Run 可以向下一次裸 continuation 提供结构化 task type /manifest /来源身份，使同一用户目标不因“继续”退化为通用任务；binding 不携带 Tool 白名单、写权限、交付信用、完成状态、设计判断或旧 Tool 参数。
- Runtime 必须重新走当前 Capability Resolver、Manifest 与执行点 preflight；畸形字段、permission escalation、来源分支不符或 manifest mismatch 均失败关闭。Harness 只恢复“正在做什么”，不恢复“可以怎么做”或“已经做成什么”。
- 正面经验：Run 664 的 `structured_run_resume` 让 Agent 在不重复询问的情况下恢复 `ecommerce.main_image.v1`。负面教训：从助手措辞、旧卡片或关键词猜任务身份会把续跑变成新任务，也会诱发重复交付。

## D-126 开放创意主图以 prepare / Agent 通用 Tool / finalize 交付，不把 Skill 扩成设计器

- 状态：active；代码、专项行为回归与 fresh 65 阶段完整核心闸门已通过，并由 `293dd3df` 提交推送；真实 Photoshop Attempt 待完成。
- `main-image-design` 对开放创意只拥有两段机械生产接缝。prepare 要求同一 Runtime TaskRun、当前项目和 Agent 明确选择的单一标准规格，只创建一份工作文档、锁定背景和 5+4 空组；不读取测试答案、不选素材、不放置元素、不保存、不导出。返回的 workspace 是有界、过期、容量受限的 identity-only 收据，绑定 TaskRun /project /创建收据 documentId /group layerId /prepared revision；它不授权 Tool，也不进入第二 Task Store。同一 TaskRun 内 Reflexion 只改变 runId /generation，workspace owner 使用稳定 sessionId；换 sessionId 才视为另一 TaskRun，项目 /文档 /组 /revision 仍分别精确核对。
- prepare 返回后控制权回到同一个多模态 Agent。Agent 使用现有 broad atomic Photoshop Tool 完成素材选择、多图关系、文字、形状、蒙版、层级、缩放与版式；Design Project State、Knowledge、Eagle 和模型先验仍只是可选上下文，不能替代当前像素观察或取得设计作者权。Skill 不新增第二套 DesignIR，也不规定图层数、文案、组件或审美配方。
- finalize 必须使用同一 workspace，并以实时 `getDocumentInfo + getLayerHierarchy` 证明同一项目、同一 TaskRun、同一 document /group 身份、prepared 后的新 revision 和至少一个含非 group 内容的标准子组。它不重新置图或变换，只把真实非空组编译为 exact export request，并复用现有 guarded executor、delivery authority、staging、文件 hash /大小、同 source revision、promotion 和 external commit。editable 写 staging 时必须 `asCopy=true`，不能让活动工作文档指向随后删除的临时路径。
- 成功 external commit 后 workspace 立即消费；文件已经 promotion 但 authority 收据未闭合时也必须失效，防止 Agent 在同一正式路径上循环重交。未修改、空组、错误 TaskRun、错误项目、错误文档、被替换组、过期 /伪造 ref 和重复 finalize 都在正式文件写入前失败关闭。背景层名称受 Photoshop 本地化影响，只能用 background role、locked 和 layerId 识别，不能强绑「背景」或 `Background` 文本。
- 正面经验：把“标准文件容器”“Agent 画面作者权”“文件事务”分成三段后，既能沿用用户 5+4 生产习惯，也允许 Agent 使用通用工具表达多层设计；同一 workspace 让 Harness 只做事实一致性而不决定画面。负面教训：把一张素材、一个矩形 placement 和一次导出包成完整 Skill，会让文件成功掩盖设计增量不足；在失败后追加修补动作只会重复错误，必须先改变执行接缝。
- 回滚点：新路径由显式 `mainImageProductionAction=prepare|finalize` 激活；若真实 Host 暴露缺陷，可独立回滚此入口和 workspace 模块，现有 `slotAssignments` 确定性入口、5+4 spec、guarded Tool 和 staging transaction 保持不变。不得回滚为 Harness 选图、默认填槽、固定版式或全局素材扇出。

## D-125 主图固定生产骨架、Agent 设计作者权与整组交付事务分离

- 状态：active；基础生产骨架已随 `3cb1594e` 提交并推送。当前增量已通过 Renderer 类型检查、Runtime 声明、Skill Package、Capability、作者权和业务边界专项验证，以及一轮 fresh 65 阶段 `maintenance:validate`；fresh 正常程序 Photoshop Attempt 待完成。
- 用户的 800 /750 /1200 空骨架与 `4.0主图导出所有主图文档.jsx` 只证明当前店铺的生产容器与批量导出惯例：三份工作画布分别为 1500×1500、1500×2000、1440×2160，均为 72 ppi RGB/8；每份含点击图 5 槽、转化图 2～5 四槽；结构非空子组按子组名导出到 `主图/{规格}`，且工作画布不缩放。它们不能证明哪些槽必须填、平台最终上传尺寸、子组内部版式、素材、文案或审美答案。
- Main Image Skill 拥有唯一生产事实源、文档 /槽位 /路径 /命名、空槽容量、交付配对和导出隔离。Agent /用户通过一等 `slotAssignments` 逐槽拥有 `sizeKey / imageType / slotName / variantId / objective / asset / subjectBounds / targetBox / safeBox / scaling preset / decisionReason`；同素材跨槽或跨规格复用也必须逐条明示。Harness 只能验证来源、几何、安全边界、事务、预算与读回，不得用 variant 数组下标、全局 selectedAsset、项目首图、关键词或默认构图替 Agent 入槽。
- 空骨架是可执行的 editable-only 任务：3 份文档 ×（建档 +11 组 +保存）=39 步；没有 place /transform /raster。满 27 槽是 120 步冻结计划，默认预算按真实计划提升，用户显式更低预算则失败关闭；不能用历史 80 步常量误杀合法任务，也不能静默扩大用户上限。
- Photoshop 层级不能只验证 Tool 返回 success。父组创建后必须归文档根级，子组归对应父组；读回精确绑定当前 documentId、createDocument 返回的 Background id /role /locked、父子路径以及 production spec 的独立面板顺序。导出必须隔离同父组兄弟内容并保留完整工作画布；文件存在、可解码、尺寸和 hash 仍由独立文件探针验证。
- 正面经验：把“固定空容器”和“Agent 本轮填充决定”分开后，Skill 可以稳定交付用户习惯，同时保留模型的选图、构图和审美作者权。JSX 可作为生产证据，但应逐条提取可证事实，并修正其中的兄弟可见性污染和 JPEG 最低质量注释错误，而不是忠实复制缺陷。
- 负面教训：历史测试把 1440×1440 /1440×1920 /1440×2560、固定 2+2、1200 禁转化和同一素材扇出固化成 Runtime 答案；随后即使强模型有不同判断，也只能反复产出相似方案。测试必须验证不变量与负向边界，不能把 fixture 的具体答案、旧 Project State、固定 DSL /文案 /recipe 送回生产 Agent。
- agentic Runtime 无论在进入 Agent 前已绑定，还是由 Agent 循环内显式声明，都必须用同一个绑定投影提供 Manifest 输入来源、交付义务和唯一 workflow owner；它保留 broad atomic Tool，不执行 Skill、不授予写权限，也不把 `user_goal`、随消息图片或当前 Photoshop 文档误报为缺失。
- 生产提交只展开 `slotAssignments` 实际涉及的工作文档；一张 800 槽位不能顺带创建 750 /1200 文档。写入必须同时持有同一 guarded executor 与由其签发的 Runtime delivery authority；保存 /导出先写绑定冻结计划的 staging，精确文件集合、大小和摘要全部对账后再整组提交。调用参数只表示请求路径，实际 Tool result /文件探针才是写入路径证据。
- 当前 `slotAssignments` 是生产交接格式，不是完整 DesignIR：它只能表达每槽单素材与几何，尚不能承载文字、形状、蒙版、多图和层内排版。后续采用 `prepare 标准文档 /槽位并返回 TaskRun + document /group /revision 收据 → Agent 使用现有通用 Tool 在准确槽位内完成分层设计 → finalize 对账同一收据并整组保存导出`；不得在 Main Image Skill 内复制第二套完整设计 DSL。
- 后续边界：自定义尺寸需要自己的第一等 document /slot schema，不能恢复全局素材兜底；每个 assignment 还需绑定逐素材视觉观察收据，不能用路径存在和图片尺寸冒充“模型已经看过”。

## D-124 测试与 Benchmark 必须处在生产 Runtime 之外的物理隔离信封

- 状态：active；默认调试项目、userData、Main 项目 realpath 与 CDP 信封已实现并通过正负行为回归，fresh 正常程序 Attempt 待验证。
- Benchmark、fake model、fake Photoshop、Debug fixture、开发验收上下文和测试项目状态只能存在于开发启动器、测试目录与运行档案；不得进入生产 Prompt、Tool 权限、项目状态、完成判定、学习发布或普通用户项目。调试启动器每次创建新的临时项目与 OS-temp userData；Main 最终执行点通过纯 resolver 独立重验项目 /userData realpath、旧 `.designecho`、目录重叠、打包状态、Bridge 与 CDP 信封，不能把启动器检查当成安全 owner。
- 正面经验：测试不是“更严格的产品配置”，而是独立观察环境。固定输入、Case ID 和评测答案应由测试 Runner 注入并在退出时消失；生产 Agent 只消费当前用户指令、真实项目事实、当前 Photoshop 状态和受审知识。
- 负面教训：把默认 MCP 调试命令直接指向 `D:\A1 neveralone旗舰店` 会让 `.designecho` 状态、历史选图和测试运行相互污染；随后即使模型每次选择相同素材，也无法区分是模型判断、项目记忆还是测试夹具挂定。不得再用真实用户项目充当可复用 fixture。
- 回滚边界：若隔离启动器影响实机调试，只能修正一次性项目 /userData 的传递与端口所有权，不能恢复硬编码用户项目或让生产入口接受测试环境变量。

## D-123 Artifact 完成与设计质量终态分轴，文件保存不能抹平 `needs_review`

- 状态：active；终态聚合、用户可见投影和一次有界返修资格已实现并通过行为回归，fresh 正常程序 Attempt 待验证。
- 可编辑源稿和栅格文件同 revision 保存完成时，Artifact owner 继续记录 `artifact_completed`；Final Judge 返回 `needs_review` 时，Evaluation owner 保留明确问题，整体终态必须是 `needs_review`，不得因文件存在改成 `completed`、可直接使用、可选优化或“不影响交付”。
- 已闭合 Artifact 的真实保存事实不能被质量失败删除。只有同 TaskRun、同 revision、可靠 ReviewSet、带“视觉发现 → 设计原因 → 修法”且仍有足够模型 /Tool /时间预算时，现有 Reflexion 才可让 Agent 自主返修一次；Harness 不选择修法，也不在预算不足时启动注定无法闭合的新 generation。
- 正面经验：把“做出来了”和“做得好”分开后，系统既不会丢失真实产物，也不会用技术成功冒充专业完成。
- 负面教训：`artifact_completed + 88 分 + 两个 major needs_review` 曾被聚合成整体 completed，并在用户文案里软化为建议；这是终态 owner 混淆，不是模型措辞问题，不能只靠提示词要求模型谦虚。

## D-122 生产知识只消费受审用途；模型、测试桥和单次运行不能在线发布经验

- 状态：active；新候选写入、在线发布入口和旧 `published/promoted` 迁移旁路均已关闭并通过伪 publisher 攻击回归。独立用户审核发布 UI 尚未实现，因此正式发布保持 fail closed。
- `benchmark_case` 无论来自旧持久化、外部 Provider 还是导入文件，都只能作为 `benchmark_seed`；不能伪装 `prompt_context` 或 `user_reference`。真实任务要使用某个案例时，必须以非 benchmark 的明确视觉参考身份重新提供并经过现有来源治理。
- `recordDesignVerdict`、Skill 改进提案和运行复盘只能产生待审核候选。模型 Tool、测试桥、时间线读取和普通 Renderer IPC 均不能把候选改成 `published`，不能直接改写 `SKILL.md` 或评价校准；正式发布未来必须由独立用户审核、版本、Canary 和回滚 owner 完成。
- 正面经验：负面样本可以形成缺陷候选，单次成功可以形成待审方法候选，但两者都不是生产知识。先保留来源、用途和生命周期，才能避免“测试通过一次”变成 Agent 的固定答案。
- 负面教训：历史 H3 /盲评规则、窄样本素材角色和 4 层版式示例曾进入主图方法 /Skill，强模型会因此表现得像在复读旧测试答案；这类污染必须在 Knowledge /Skill 发布边界删除，不能用更多提示词抵消。

## D-121 素材观察提供中性可比较集合；Harness 排序、历史状态和文件顺序都不拥有选定权

- 状态：active；主 Agent 中性分页、候选集合 /文件版本身份、项目摘要隔离与旧推荐能力拒绝已完成限定攻击审计，fresh 正常程序 Attempt 待验证。
- 主 Agent 只使用 `browseAssetCandidates` 观察显式 scope 下的中性分页：不解析用户 requirement 猜类别、不计算适配分、不返回推荐理由 /赢家、不自动选择第一项、不自动置入。`candidateSetId + G 编号` 共同绑定候选身份，G 只在同一集合内跨页唯一；来源 /画幅与桶内跨度只扩大第一页观察覆盖，不表达优先级。
- 旧 `recommendAssets` 仅保留给 Skill-owned 非 Agent 兼容路径；不能出现在主 Agent Schema、默认能力或按需 Capability 中。Provider 幻觉旧 Tool 也必须在 `availableTools` 边界失败关闭。
- 自动项目摘要只投影全局适用的已确认规则、已确认事实、明确标注的待核候选和历史记录数量；旧选图、版式、文案、评审、版本原因及旧 `taskType/platform` 不自动成为当前方案或 scoped rule 的适用上下文。明确续做同一版本时再按需读取并核对当前画面。
- 正面经验：候选覆盖、身份稳定和来源事实属于 Harness；比较什么、为什么选择、如何用于设计属于 Agent。负面教训是“规则排序第一名 + A01 标签 + 旧项目版式摘要”会共同形成检索诱导，即使没有硬编码 `candidates[0]`，仍能让模型多次做出相同安全选择。

## D-120 Debug 最终交付引用必须保留来源三态，清洗不能销毁非法事实

- 状态：active；Debug receipt v5、生产投影、consumer 与回归已完成，fresh sidecar Attempt 待验证。
- Runtime 没有声明最终交付、声明了合法交付、声明内容非法是三种不同事实，必须分别投影为 `absent / valid / invalid`。只有 `absent + []` 可以作为可信但交付不完整的收据；`invalid`、缺状态、状态 /集合矛盾、项目外路径、目录穿越、畸形值、超量或大小写等价重复都使整张收据不可信。
- Runtime Debug collector 必须从 E2/resultRef 精确绑定处保留 own-property 原始逻辑候选，Sidecar 再有界传递到唯一 normalizer；任何一层都不得先过滤、去重或截成合法上限后让下游猜原因。canonical `collectRuntimeFinalArtifactPaths` 继续拥有生产完成所需的规范 `string[]`，Debug raw projection 不取得完成权。consumer 不扫描目录、不用文件存在补造 Manifest；合法空集合仍不能取得技术交付信用。
- 依据：独立审查证明旧 normalizer 会把 unsafe、overflow 与未声明都压成 `[]`，导致下游即使严格校验也无法恢复真实来源状态。

## D-119 Final Quality 运行故障归 Evaluation，不得伪装成主 Agent 缺少一次看图

- 状态：active；代码与专项回归完成，fresh Photoshop 实机待验证。
- Final Quality 的 Host 事实取得、ReviewSet 装配、Judge 调度和 Provider 协议属于现有 Evaluation owner。任一步骤在模型协议形成前失败时，必须在同一个有界 `finalQualityModelProtocolDigest` 中记录 `unavailable / evaluation_runtime_failed`；不得吞成 `null` 后再推断“主 Agent 还没看图”。
- 显式 Evaluation 故障不能触发普通 `agent_turn`、重复截图或设计写入。当前稿件、Photoshop revision、save/export 与失败事实继续保留；没有可靠视觉断言时只能诚实保持质量未通过，不能签发最终交付引用。
- 交付复入缓存不是环境真相：每次 terminal closure 必须先撤销 ambient Judge 摘要；只有重新读取 Host 并证明当前 revision 与 ReviewSet 精确相同，才能恢复缓存的 `completed`。已知版本变化记录 `stale`，Host 不可读记录 `unavailable / evaluation_runtime_failed`，二者都不能继承旧完成信用或唤醒普通 Agent。
- Harness 只在确有“必须由 Agent 产生新设计事实”的缺口上恢复主循环；Evaluation 自己的证据或协议故障由 Evaluation 内部有界处理或终止。该裁决不新增第二评价器、第二状态机或主图专属恢复分支。
- 依据：`main-image-pink-coffee-unseen-v1` revision 5 的真实运行已有同 revision 画面和保存导出，却没有任何 `final_quality_judge` 调用；原裸 catch 将异常压成 0/16，terminal closure 又启动无图普通 Agent 回合并遭遇 Provider capacity，属于错误 owner 转嫁。

## D-118 具有副作用的调用必须由当前有效模型上下文生成

- 状态：active；代码与专项回归完成，fresh Photoshop 实机待验证。
- 结构化 Task Profile 声明会改变模型可见的任务语义、Skill 方法、评价标准或 Capability 面。同一模型响应中在声明前上下文下生成的 Photoshop 写入、保存导出、外部生成、状态写入或未知副作用调用，不得在声明执行后被事后追认为“已消费绑定后上下文”。
- 声明同轮的只读观察与知识检索可以继续，其真实结果与新绑定的专业上下文一起进入下一模型轮；Agent 随后自行决定重发、改写、先找参考、换方向或放弃原动作。Harness 不修改原参数、不选择素材、不强制 Eagle，也不把 Brief / Strategy / Plan 变成 agentic 写入门票。
- 这是一条上下文因果一致性约束，不是固定设计 Workflow。专项回归必须证明：绑定前系统提示不含品类方法，绑定后提示真实包含对应方法，只有绑定后模型轮生成的写参数进入执行器，延后调用不计任务进展或普通失败。
- 依据：revision 5 真实运行的第 2 次模型响应在约 10k system chars 下同时生成 `declareDesignIntent + composeDesign`，第 3 次才在约 20k system chars 下取得主图方法；旧 sibling policy 会直接执行前一轮作者化参数。

## D-117 上传附件先取得请求级可执行来源句柄；通用 CLI 是受控 Provider，不是附件断链补丁

- 状态：active；根因与 owner 已完成代码审计，进入 `INTAKE-091` 规划，尚未实现或实机验证。
- 触发事实：用户上传一张明确命名的商品图并要求“置入 Photoshop 中抠图”时，Agent 能看到文件名和图片像素，却只搜索当前项目两次，随后要求用户再次提供本机路径。当前 `DesignImageInput` 只保存 `id / data / mediaType / source / name`，聊天引用只保留 `imageId`；`placeImage` 只接受 `filePath / UXP fileToken / imageData`，通用 Agent 没有把已选 `imageId` 解析成可执行字节的请求级 Provider。模型不应复制 Base64，Renderer 也不能伪造 UXP session token。
- 根因归属：这是 Input Asset / Attachment Provider 与 Tool dispatch 的来源绑定缺口，不是模型缺少设计经验，也不是当前项目搜索不够深。详情页单附件分支能直接注入已有字节，只证明底层置入能力存在；不得把该 Skill 专用旁路继续复制到主图、SKU 或通用 Agent。
- P0 决定：在用户提交时由 Harness 请求边界登记不可变附件，签发不透明 `attachmentRef`，绑定当前请求 / TaskRun、原始文件名、媒体类型、字节数、内容摘要、TTL 与消费状态。模型看到图片后显式选择 `attachmentRef`；`placeImage` 等声明支持附件的 Tool 在 dispatch 时解析为真实字节并携带来源身份，Harness 只解析和校验，不替 Agent 选图，也不把本地绝对路径或原始 Base64写进 Prompt、对话或长期状态。
- 外部文件决定：用户明确给出路径或通过系统选择器授权目录时，由 File Capability Provider 签发有界 scope；只读搜索、元数据、读取和显式复制按 scope、路径身份、大小、扩展名、摘要、超时与收据执行。没有 scope 时不得全盘搜索，也不能因为同名文件命中就认定它等于上传字节。
- CLI 决定：通用系统命令属于 Harness 的 Tool / Capability Provider，Skill 只能声明依赖或调用，不能各自内置一套 shell。建设顺序为只读环境观察 → 受控文件操作 → argv 化受控命令 → 必要时桌面输入。命令必须绑定 TaskRun、cwd、可见目录、可执行程序策略、环境变量脱敏、超时 /取消、输出上限、副作用分类与写后读回；默认不提供管理员权限、任意 `cmd /c` 字符串、跨 scope 文件访问或隐藏后台常驻进程。
- 负面教训：已经收到附件时，“搜索项目 → 搜不到 → 让用户搬文件或报路径”是在把 Harness 的输入断链转嫁给用户；直接开放任意 CLI 则会用更大的权限面掩盖同一断链。两者都不是根因修复。
- 验收：上传、拖拽和剪贴板图片都能生成不同、不可伪造的 `attachmentRef`；同一 TaskRun 中 Agent 可选中它并完成 `placeImage → removeBackground → 结构 /视觉读回`；跨 TaskRun、过期、摘要不匹配、媒体类型不支持和改写 ref 均 fail closed；附件未被模型选择时不得自动置入。外部目录与 CLI 分别用 scope 内通过、scope 外拒绝、取消 /超时和副作用收据夹具验证。
- 回滚点：P0 只扩展通用输入来源绑定与已支持 Tool 的解析，不改变项目资源搜索、Photoshop 事务、设计作者权或业务 Skill。若来源生命周期有误，可独立关闭 `attachmentRef` Provider，现有图片视觉输入仍保留；不得回退为 Skill 专属注入或任意 shell。

## D-116 性能先按物理请求归因，再做同 Case 单变量优化；诊断不得取得 Agent 控制权

- 状态：active；归因与视觉恢复已提交为 `83a651be` 并通过 fresh 65 阶段核心验证；fixed Case revision 5 与一次性 fixture 已冻结，fresh profiling 尚待完成，当前不能宣称已经提速。
- 触发事实：r35 / r38 中模型调用约占墙钟 92% / 93%，普通 Agent 回合为 35 / 29 次，截图与 transform 只占少量时间；但旧 `promptShapeSamples` 没有调用用途、上下文来源、输出形态或逐调用视觉 revision，因此“删上下文、降 reasoning、减少看图、移除 Final Judge”都不是已证明的根因修复。历史 run 602 进一步显示 22 次模型调用约 604 秒、Tool 约 67 秒、历史增长到约 15.9 万字，但它仍只是旧版本个案。
- 决定：现有 Runtime Accounting 是物理模型 attempt 的唯一 observation-only owner。生产调用必须显式声明有限 `callKind`，并记录 stream 模式、iteration /generation、requested reasoning、transport attempt、上下文压缩和有限来源桶、输出体量；视觉输入只从本次真实 presentation 与 Runtime-owned observation / ReviewSet revision 投影为 run-scoped SHA-256。旧 v0 缺字段保持 unknown，不从内容、阶段或相邻事件猜测。
- Tool owner：Tool name、origin、activity、Host revision 与 mutation 事实继续留在既有 AgentRunRecord / Tool log；Runtime Accounting 只保留原有聚合。当前记录没有单次 Tool duration 时，诊断必须显示 instrumentation unavailable，禁止用累计 `elapsedMs` 相减或复制第二 Tool 账本。若未来需要覆盖 Skill / Design Team 内部物理 Tool，应在真实 dispatch-settled 边界补回原 owner，并明确聚合是否计数，不能扫描 Skill 返回对象补造。
- 行为边界：性能字段不进入 Prompt、Tool 可用性、预算准入、权限、Stage、Completion、DesignVerdict、Evaluation 或学习写回；Harness 不因“慢”替 Agent 选择素材、构图、减少必要观察或跳过写后读回。归因适配只能计时、测量、脱敏和交给现有 ledger，调用用途与是否请求模型仍由 Agent /既有质量 owner 决定。
- 视觉恢复裁决：若一个真实携带像素的主模型请求以 `max_tokens / stream_incomplete` 截断，残缺输出没有观察信用；语义 recovery 必须重发同一像素，直到取得完整终态或达到既有恢复上限。它不重复扣普通任务模型 /视觉预算，但每个物理请求、图片块和同 revision presentation 都进入 Runtime Accounting。若完整、blocked、异常或恢复耗尽，Runtime 必须退休像素并清空 pending，不能留下无像素 review 入口。
- 优化方法：先在相同代码、模型、reasoning、素材、预算和 fixture 上取得 fixed Case 基线，找出最慢五个调用、call kind、输出长度、上下文来源和同 revision 重复视觉 presentation；然后一次只改一个可逆变量做配对。没有同 Case 结果，不用总体平均或旧单例宣称改善；质量与技术成功率显著退化时回滚。两种不同优化仍无法改善同一首个偏差时触发 GMR，换根因假设而不是继续叠加提示词或 retry。
- 正面经验：把“模型为什么被调用、当时看了什么、输入如何增长、输出了多少”和“Tool 实际做了什么”按现有 owner 对齐，才能区分必要设计思考、Provider 输出恢复、辅助总结、终审固定成本和低增量循环；测量基础设施本身不应成为新的工作流。
- 负面教训与禁止反例：不得用降低模型、关闭主 Agent reasoning、减少必要视觉样本、跳过终审、缩短到无法完成的预算或隐藏等待状态制造速度；不得保存 Prompt /reasoning 正文、Tool 参数 /结果、路径、Base64、原始 observation key 或 Photoshop ID；不得给新增调用默认为 `agent_turn`；不得把 transport retry 的同像素重发误报为 Agent 重复设计循环。
- 回滚点：本切片只扩展现有 Runtime Accounting /诊断投影、ContextManager 计数和品类中立模型会计适配。若真实运行证明记录时钟、视觉归因或旧档案兼容有误，可独立回滚 D-116；回滚不影响 S1 的交付引用、Evaluation authority、Photoshop 事务或设计作者权修复。

## D-115 当前文档使用单一投影，长期路线使用分阶段 SMART，不再保存并行历史主线

- 状态：active
- 决定：`Prompt.md` 只保存稳定目标与边界；`CurrentTask.md` 只保留一张当前任务卡；`Plan.md` 只保留一个激活阶段；`Status.md` 与 `project-state.json` 只保存当前事实投影；跨阶段目标统一进入 `docs/project-master-plan.md` 的 SMART 路线。
- 原因：整理前 CurrentTask、Plan、Status 和 project-state 分别指向不同任务，现有检查只 warning，历史流水账已经成为第二计划系统并误导后续开发。
- 执行边界：SMART 是研发治理方法，不进入 Agent Prompt、Runtime Stage、Harness Gate 或固定设计流程；历史由 Git / Run Record 查询。仍被源码引用的研究稿先降级并抽取稳定 Contract，不因文档过大直接删除。
- 验收：CurrentTask / Plan 各 1 个 H2；CurrentTask、Plan、activeRequest、activePlan ID 一致；当前权威文档命令真实存在；规划漂移直接失败。
- 取代：旧 Plan / CurrentTask / Status 中按日期累积的多个“当前主线”和 project-state 历史 `*Slice` 投影。

## D-114 首写对象 revision 不变事实由 baseline owner 计算并贯穿 v2 收据

- 状态：active；实现与验证已进入当前提交历史，r35 已完成官方 reconciliation；修复后的 fresh 正式 Case 仍待在 S1 可靠性阶段统一复验。
- 触发事实：r35 的 D-113 生命周期、同 revision PSD/JPG、内部 Completion 与 6 个用户文档保护均真实通过，但外层 Reliability 报“首次 Photoshop 写入隔离基线收据与对象级文档归属或 Runtime Build 事实不一致”。源码对账证明 assessment 已计算 `preexistingDocumentRevisionsUnchanged`，receipt producer 没有序列化，而 consumer 强制要求 passed 值为 true。
- 决定：在现有 `GuardedPhotoshopExecutionBaseline` 中保存 assessment 的布尔事实，并由 `readGuardedPhotoshopExecutionBaselineReceipt()` 原样投影。错误首写工具在 Host dispatch 前可恢复时清空该值并重新观察；真实对象 revision 漂移投影 false 并保持 blocked。v2 版本不升级，因为 consumer 与既有手写 v2 fixture 已把该字段视为 intended contract；本修复是在 producer 补齐既有契约，不改变语义。
- 测试裁决：不能再只分别测试 producer 和 consumer。Design Reliability 必须用 producer 实际生成且完成对账的 receipt 直接调用 consumer validator，并保留 true /false 攻击断言。手写 receipt 只覆盖其它协议组合，不得作为本字段唯一绿色证据。
- 不做：不删除或放宽 consumer 断言，不用默认 true，不从请求 /模型 /文件名补值，不新增第二基线账本，也不把 r35 视觉问题混进 Harness 收据修复。
- 回滚点：若字段导致非正式路径行为变化，可回退 D-114；回退后正式采集 passed 首写会再次恒失败，因此不能把回退版本用于 Reliability 发布结论。

## D-113 本 TaskRun 新建文档按对象逐个结算，Harness 不替 Agent 关闭或改稿

- 状态：active；实现已进入当前提交历史，r35 后续证明单文档生命周期与同版本 PSD/JPG 可以闭合；多候选、失败恢复和商业质量继续由 S1 / S2 多样本验证。
- 触发事实：r34 的 DeepSeek Agent 创建 v1 后发现对比度问题，又调用 `composeDesign(document.mode=new)` 创建 v2；v2 的同 revision PSD/JPG 与 Profile Completion 均通过，但 v1 仍未保存、dirty，使外层 Attempt 正确失败。D-112 paired delivery 没有失效，缺口是 Completion 只看最终目标，没有核对本 TaskRun 创建集合。
- 决定：同一 TaskRun 的每个受信任 `document_creation` 对象必须在再次新建或完成前进入终态：按当前交付范围取得与最新内容 revision 对应的真实保存 /导出收据，或由 Agent 显式 `closeDocument(documentId)` 成功关闭。前一对象未结算时，通用执行 preflight 拒绝下一次 `createDocument` /`composeDesign(new)`；`composeDesign(active)` 与结算后的后续新建不受阻。
- 作者权与安全：Harness 只报告对象未结算事实，不自动调用关闭、不从文件名 /品类 /助手文字选择弃稿、不把 `new` 改成 `active`。破坏性关闭继续使用既有 HITL；模型决定原地修订、交付当前候选或请求关闭。多文档任务按顺序逐个结算，不被全局单文档上限误伤。
- Owner：现有 TaskRun 创建证据负责跨 Reflexion 保存 document/revision 与部分交付 /关闭终态；`agent-tool-execution-preflight` 负责第二次新建前的执行事实；现有 creative /Profile Completion 负责最终集合核对。Photoshop Provider、TransactionRunner、Safety Policy、E2 和 Evaluation owner 均不复制。
- 回滚点：D-113 只扩展通用创建证据、执行 preflight、Completion 投影与可复用测试；若 r35 证明模型无法从 blocker 回到当前文档修订，先回滚写前阻断而保留 Completion 终态核对，再依据真实 Tool 选择调整模型可见说明，禁止改成自动 close 或静默参数重写。
- 验证边界：r34 已证明问题形态和外层拒绝；尚未证明新 preflight 会让真实 DeepSeek 选择 `active`，也未证明跨 Reflexion、显式单格式和顺序多文档的全部结果形态。r35 技术通过仍不代表商业质量通过。

## D-097 固定 JSON 的终局视觉 Judge 不消费 Provider 原生思考预算

- 状态：已采用并形成独立可回滚提交；专项 `audit:runtime-declaration`、Main /Renderer 类型检查、Agent production build 与完整核心闸门 58/58 已通过。r33 DeepSeek 真机待完成。
- 触发事实：r32 普通重发的最后一次 Final Judge 是 3 图、0 Tool，输出恰好 4,320 tokens；代码对 12 项断言也只分配 4,320 tokens。Provider accounting 没有调用失败，但 Final Judge 因非完整终态变成 `judge_unavailable`。RunRecord 未保存原始 `finish_reason`，因此 `max_tokens` 仍是待 r33 证实的最强解释，不写成已验证真机事实。
- 排除项：DeepSeek 的视觉出站回执在当前运行线是 `optional`，只有 Codex 订阅通道是 `required`；在没有证据时扩展回执协议会改错 owner。简单抬高 token 上限也会把隐藏思考成本永久化，不能解决同类结构化辅助调用的预算竞争。
- 决定：`FinalQualityModelRequest.thinkingEnabled` 固定为 literal `false`，首次 Judge 与 diagnosis-only repair 都显式关闭 Provider 原生思考。主 Agent 的思考偏好保持不变；没有按 DeepSeek 型号新增 Runtime 分支，未实现关闭语义的 Provider 继续按既有适配能力处理。
- 不变量：仍只采信 `end_turn`；`max_tokens`、残缺 JSON、部分评分、Tool Call、历史漂移和 Codex 回执缺失 /错位继续失败关闭。4,320 token 上限、一次 Judge、最多一次 diagnosis repair、ReviewSet 与同 Photoshop revision 校验均未放宽。
- 回滚点：生产改动只在 `final-quality-model-protocol.ts` 的辅助请求契约和两处请求构造；若 r33 证明关闭思考显著降低评审质量或仍不能取得完整终态，可独立回滚 D-097，再依据持久化运行事实调整结构化输出契约，而不是修改主 Agent 或 Photoshop 链。
- 验证边界：现有审计已证明 r32 形态仍为 12 项 /4,320 token，Judge 与 repair 均传 `thinkingEnabled=false`，DeepSeek adapter 实际生成 `thinking:{type:'disabled'}` 且不残留 `reasoning_effort=high`。这不等于真实 DeepSeek 已返回 `end_turn`，也不等于设计质量通过。

## D-096 正式 Design Reliability 采集与官方 UXP loader 必须竞争同一开发期 Runtime 租约

- 状态：已采用并在独立 D-096 worktree 形成可回滚提交；专项纯逻辑、loader self-test、真实双进程拒绝 canary、相邻审计、Main /Renderer 类型检查、Agent /UXP production build、完整核心闸门 58/58 与提交后 clean identity 已通过。r32 reconciliation 和 r33 真机待完成。
- 触发事实：r32 提交时 Photoshop UXP 是 D-094 clean build，正式 DeepSeek Run 期间却被另一开发会话替换为旧 dirty build。现有三处 Runtime binding 能安全拒绝漂移，但只能在昂贵运行已经发生后报告失败；官方 loader 没有跨 worktree 互斥。
- 反证结论：r32 在失败 Attempt 后出现的第二 Run 不是自动 Reflexion 逃逸。它在 Attempt 终止约 25 秒后从同一 conversationId 的新 branchId 启动；生产代码只有“编辑已发送消息并重发”会更换 branchId。它属于新的显式顶层交互，不允许用代际 guard 或延长旧 Debug lease 阻断正常用户重发。
- 决定：仓库外 canonical Design Reliability data root 只保留一个版本化 Photoshop Runtime lease。`run-live` 以 `formal_capture` 取得后再次核对完整 UXP binding，并在任何 Attempt Event、模型提交或 Photoshop 写入前失败关闭；官方 UXP loader 以 `uxp_loader` 在连接 UDT 和任何 load /unload 前取得同一租约。二者都在 `finally` 精确释放。
- 陈旧与所有权：租约绑定随机 leaseId、有限 owner、PID、进程起始 /取得 /预期到期时间。只要 owner 进程仍存活就不得因 TTL 到点删除；owner 已退出时后继者可回收。释放必须匹配当前 leaseId，旧 owner 不得删除新 owner。没有 force 参数。
- Owner 与边界：该租约只拥有开发评测期间的合作式 loader 互斥，不拥有 Photoshop 权限、TaskRun、Runtime binding、事务、完成判断或设计答案。用户手动 UDT reload 与第三方直连仍可能绕过，因此既有提交 /首次写 /完成 binding 必须保留为安全权威。
- 回滚点：D-096 只新增一个 `scripts/lib` 租约模块，并接入 `design-reliability.cjs` 与官方 loader；若出现开发 loader 无法恢复的误阻断，可独立回滚本切片，D-095 /D-094 与三处完整 Runtime binding 不受影响。
- 验证边界：双进程 canary 已证明持有正式采集租约时 loader 在 UDT 连接前返回 `runtime_capture_lease_active`，随后原 owner 成功释放且全局无残留。尚未完成真实 `run-live` 全窗口、持有进程崩溃后的真实 loader 回收和 r33，不能宣称环境漂移已完全消失。

## D-095 写前已拒绝且无 Host 副作用的错误首选可恢复，事实风险继续永久锁死

- 状态：已采用并形成独立提交 `d8ce40ef`；纯逻辑攻击测试、相邻审计、Main /Renderer 类型检查、Agent /UXP production build 和完整核心闸门 58/58 已通过，r33 真机待完成。
- 触发事实：r32 的首个写尝试 `placeImage` 被 D-094 在 dispatch 前正确拒绝，RunRecord 明确 `mutationObserved=false`。模型下一轮已经改用正确 `createDocument`，但 `blockBaseline()` 把整个 TaskRun 永久置为 blocked，导致 5 次 `createDocument`、2 次 `composeDesign` 继续撞墙，最终 24 次模型调用累计 1,764,991 input tokens 且成功 mutation 为 0。
- 决定：`first_mutation_must_create_task_document` 只表达当前工具选择错误，不表达 Photoshop 环境已经不安全。该调用仍返回失败且不派发；baseline 清除本次首写候选并回到 pending。下一次受保护写调用必须重新读取完整 Runtime identity 与文档 inventory，只有 `createDocument` 且所有前置对象 identity /revision 仍匹配时才可进入 passed。
- 永久阻断边界：Runtime 身份缺失 /漂移、文档 inventory 缺失、fixture 文档已打开、前置对象缺失 /身份 /revision 变化、新外部文档出现等仍调用唯一 `blockBaseline()`；一旦 blocked，同一 TaskRun 不因后续状态看似恢复而解锁。被拒绝的原工具本身不可自动重试，也不会取得权限。
- Owner：仍是现有 `guarded-photoshop-execution-baseline` 与唯一低层 Photoshop dispatch gate。Tool 结果只增加结构化 `retryableWithinTaskRun / nextRequiredTool=createDocument`，不新增恢复 Runtime、第二 Gate、Task Store、事务 owner 或设计决策逻辑。
- 回滚点：D-095 是建立在 `eb40a93c` 上的独立提交；若真实行为证明恢复会导致非 `createDocument` 派发或放宽 Runtime /revision 风险，可单独回滚 D-095，D-094 的对象保护和永久失败关闭仍保留。
- 验证边界：纯逻辑已覆盖错误首选拒绝、正确首写重新观察并通过、两次之间 revision 漂移永久阻断以及 blocked 后不得恢复。类型检查通过不等于 r33 真机完成；共享 UXP session 漂移另列风险，不由本决定掩盖。

## D-094 正式从零创作按 TaskRun 前置对象 revision 隔离，不要求文档先有磁盘路径

- 状态：已采用为 D-093 的收敛切片；专项攻击测试、Main /Renderer 与 UXP 类型检查、工具注册、设计作者权、UXP 行为、唯一事务 owner 审计、Agent /UXP production build 和完整核心闸门 58/58 通过。独立提交、提交后双 Runtime identity 与 r32 真机待完成。
- 触发事实：真实 Photoshop 中存在未保存的 `800` 用户工作稿。D-093 因它没有路径而阻断 r32，但缺路径只说明无法计算项目目录亲和性，不等于该对象必须成为本轮写目标。执行链已经能从 `createDocument` mutation commit 取得新文档 ID，并为后续写入签发私有 target /revision guard。
- 决定：正式从零创作请求在提交时冻结所有已打开文档的 `documentId/historyStateId`。提交前已存在且 revision 可读的非 fixture 对象，无论 saved /unsaved /path unavailable，都属于受保护 TaskRun 前置对象；它们不获得写入、保存、关闭或素材选定权。首个 Photoshop mutation 必须是 `createDocument`，首次写前不得已有后来打开的 fixture 文档。任务完成前再次读取同一集合，要求每个前置对象仍打开且名称、pathState、editState、projectAffinity 和 revision 均未变化；新增外部对象、缺 revision 或任何漂移均失败关闭。
- Owner：仍由 `guarded-photoshop-execution-baseline` 拥有提交、首次 mutation 与完成对账；`listDocuments` 只提供 Host 文档 /历史事实；既有 Agent preflight、私有 target guard 与唯一 PhotoshopTransactionRunner 继续拥有每次真实写入。完成对账进入同一 baseline receipt，不新增 Runtime、Task Store、事务日志或 Release owner。
- 禁止反例：不得把所有 unsaved 文档一律放行；没有稳定 revision 仍阻断。不得允许先打开 fixture 输入图再把它当首次写目标；不得只检查首次 mutation 而省略完成对账；不得通过保存 /关闭用户文档、移除 dirty 检查或相信模型自报“没有碰外部文档”来让 r32 变绿。
- 回滚点：本切片升级 `guarded-photoshop-execution-baseline` /receipt 到 v2、Debug submit receipt 到 v4、文档 inventory 到 v1，并给 `listDocuments` 增加 revision 事实。若真实 Photoshop 不能稳定读取非活动文档的 history，可独立回滚 D-094；回滚后保留 D-093 对路径明确外部文档的支持，不退回全局 `none_open`。
- 验证边界：纯逻辑已覆盖未保存 +revision 放行、无 revision 阻断、前置对象缺失 /身份变化 /revision 变化、完成时新增外部对象和首写目标污染；Adobe UXP 官方契约支持文档 ID 在打开生命周期内有效、HistoryState ID 与文档 ID 共同表示历史状态。真机 `listDocuments` revision 读回、完整闸门和 r32 尚未完成，因此当前只声明代码与专项边界。

## D-093 Photoshop 隔离按对象身份与写入目标判断，禁止 `none_open` 全局锁

- 状态：已采用并形成独立 Git 提交；Design Reliability 专项行为验证、完整核心闸门 58/58、Agent /UXP production build 均已通过，带外部 dirty 文档的正式真机 Attempt 待完成；远端发布状态由 Git 记录，不进入产品运行状态。
- 触发事实：D-092 已让产品 Runtime 区分 `pathState`、`editState`、`projectAffinity` 和 TaskRun mutation 所有权，reconciliation 也允许路径明确且位于原 fixture 外的 dirty 文档继续打开；但正式 Attempt 与首次 mutation baseline 仍要求 `none_open`，导致开发 Harness 继续要求用户关闭无关 `SKU.psb`，与产品事实模型和低人工介入目标矛盾。
- 决定：正式受控请求在提交时冻结完整文档清单。已有文档只有在路径状态已解析且属于 fixture 外部时才可保留，`dirty` 事实照实记录但不产生保存、关闭或写入授权；提交时已有 fixture 文档、路径未知 /未保存文档继续失败关闭。首次 Photoshop mutation 前重新读取清单：新出现的外部文档阻断；外部活动文档不能承接普通写入；`createDocument` 可以在外部文档仍打开时建立新的 TaskRun 目标；同一请求随后打开并激活的 fixture 文档可以承接精确写入。后续 mutation 继续经过现有 TaskRun、target /revision 与 Provider preflight，不由该基线取得额外权限。
- Owner：`guarded-photoshop-execution-baseline` 只拥有正式 Debug 请求的两次对象级隔离事实和收据；`photoshop-document-inventory` 继续拥有路径 /项目归属投影；TaskRun 与 Photoshop execution preflight 继续拥有真实写目标，Agent 继续决定复用、切换或新建哪个合法对象。
- 正面经验：环境安全应比较“哪个对象、属于谁、哪项动作会碰它”，而不是把应用全局状态压成一个布尔值。这样既能保护用户未保存工作，也不会让无关文档拖慢或阻塞新任务。
- 禁止反例：不得恢复“有任意文档打开就阻断”、不得因 `dirty` 自动保存 /关闭、不得把 fixture 外部文档设为当前写目标、不得用文件名或活动标签猜所有权，也不得把 benchmark 洁净条件写回普通产品 Harness。
- 回滚点：协议版本分别升级为 `guarded-photoshop-execution-baseline/v1`、`guarded-photoshop-execution-baseline-receipt/v1` 和 `debug-bridge-chat-submit-receipt/v3`；若真机发现目标归属误判，可独立回滚 D-093，但不得退回全局 `none_open`，应保留 D-092 的四类事实并收紧具体对象条件。
- 验证边界：纯逻辑已覆盖外部 dirty 文档 + `createDocument` 通过、直接写外部活动文档阻断、提交后新外部文档阻断、同请求打开 fixture 文档后写入通过、未知文档和提交时已有 fixture 文档阻断；完整核心闸门 58/58 与 Agent /UXP production build 已通过。尚未用提交后新构建在真实 Photoshop 中完成 r32，因此不能宣称真机低介入率已提高。

## D-091 文件交付 revision 只能由拥有该 revision 的 Host 协议闭合

- 状态：已采用；受控前后对照真机探针、定向回归、顺序化 Main /Renderer 类型检查、完整核心闸门 58/58 与 Agent /UXP production build 已通过，提交推送和 r26 正式 Attempt 尚待完成。
- 触发事实：r25 已完成同 history PSD/JPG、7/7 结构化完成和正确 full-canvas Judge，但 `runtimeDeliveryResultRefs` 仍为空。真实 renderer 探针显示 PSD `saveDocument` 带 UXP `sourceHistoryStateRef`，而 `quickExport` → `saveDocument` 重定向写出的 JPG 只有路径和成功状态，没有源 revision。
- 根因：JSX 桥在 `saveAs` 后读取 ExtendScript history；该值真机会丢失。把读取提前后又证实 ExtendScript history id 与 UXP history id 不是同一身份空间，不能直接比较或包装成 UXP `PhotoshopHistoryStateRef`。宽松 `production-delivery` 只按格式统计文件，严格 E2 则正确拒绝无同版本来源的 JPG。
- 决定：JSX 只负责在文件写入前核对自己实际选中的 `sourceDocumentId`，防止同名文档导错；UXP 是 Photoshop revision 的唯一 owner，在派发前冻结 source history，导出后重新读取并要求同文档 /同 history，再把该 UXP ref 写入 `saveDocument`、`quickExport` 与 `batchExport` 收据。任何一环缺失或变化都返回失败，不将文件路径、成功文案或跨协议数字补成可靠交付。
- Owner：`core/jsx-bridge.saveDocumentViaJsx` 拥有 JSX 文档身份前置核对；`tools/canvas/save-document` 的 revision helper 拥有 UXP 写前 /写后源版本闭合；Agent `agentic-final-delivery-evidence` 继续只消费完整收据，不扫描文件、不推断来源。
- 替代项：不采用放宽 E2、目录扫描、按扩展名补 ref、相信 `redirectedTo=saveDocument`、把 ExtendScript history id 视为 UXP history，或只给 r25 /主图加兼容分支。这些方案都会重新制造双重真相或错误文件归属。
- 回滚点：D-091 只改变 JSX 保存返回身份、三个 raster 导出工具的源 revision 收据和既有回归；若旧 Photoshop 兼容性受影响，可独立回滚本切片，但不得保留伪造 UXP history 的旧转换。
- 验证边界：前置探针已复现 JPG 成功但缺 ref；错误的跨协议 history 比较在写前失败且未生成文件；最终探针返回 `documentId=4492`、`sourceHistoryStateRef=4492:4497`，导出后仍为 `4492:4497`。这证明 Provider 收据链修复，不替代 r26 从 Agent Final Judge 到非空 `finalArtifactRefs` 的正式端到端验证。

## D-090 ReviewSet 类型是终局证据身份，禁止单画布与 Bundle 相互降级

- 状态：已采用并以 `1521c504` 推送；提交后 Agent /UXP identity 已验证。r25 证明自动 full-canvas 与 Judge 对象正确；后续空 `finalArtifactRefs` 已定位为独立的 D-091 raster revision 收据缺口。
- 触发事实：r24 最终 Photoshop 画面包含完整主体、标题和四色陈列，但 Final Judge 却描述无文字、大片留白和偏小商品群；同一 Run 又同时记录 `finalArtifactObserved=true`、生产交付检查通过与安全 `finalArtifactRefs` 为空。Tool trace 没有 Harness 全画布调用，证明 D-089 的自动采集被已有候选短路。
- 根因：`selectFinalQualityReviewSet` 在单画布路径使用 `single || bundle`。document/history 只证明时间一致，不能证明 Bundle 里的像素就是完整成品；素材候选、局部裁切和声明多屏即使同版本、数量完整，也不能替代 `single_surface`。
- 决定：Evaluation Profile 的 `requireMultiSurface` 同时决定 ReviewSet source。单画布只能选择 `single_surface`，缺失 /陈旧时由 D-089 的 Host evidence 采集一次无 region 全画布；多画面只能选择完整 `visual_observation_bundle`，不得降级成单图。Final Judge、E2 reviewed-source binding 与运行结果中的可信视觉 Artifact 必须调用同一选择 Owner，不能各自偏好不同证据。
- Owner：`final-quality-host-evidence.selectFinalQualityReviewSet` 是类型选择的唯一纯逻辑 Owner；`Agent.findLatestDesignVisualJudgeReviewSet` 负责注入当前单图 /Bundle 候选；Host evidence 只补缺失事实，模型继续拥有视觉评价与修订决定。
- 替代项：不采用“Bundle 优先”“同 history 就可用”“让 Prompt 提醒 Judge 哪张是成品”或 E2 扫描文件兜底。这些路线不能消除对象身份歧义，还会制造 Judge、交付与恢复三套真相。
- 回滚点：代码改动仅涉及 ReviewSet 选择和可信 Artifact 投影；若多画面回归受影响，可独立回滚 D-090，不撤销 D-089 的只读全画布采集、Provider 逐图收据或交付同 revision 约束。
- 验证边界：现有核心行为回归注入合法、同 document/history、结构完整的误导素材 Bundle；旧实现会直接选择它，新实现必须返回无单画布候选、触发自动 full-canvas、让 Judge 第一张图为该 Host 结果、排除误导图，并把可信运行 Artifact 写成 `single_surface`。代码验证不替代 r25 真实 Debug Bridge `finalArtifactRefs` 和视觉盲评。

## D-089 局部观察与完整终审分权：Harness 可补只读证据，模型继续拥有审美判断

- 状态：已采用并以 `329a650e` 推送；完整 58 阶段核心闸门、Agent /UXP production build 与提交后身份均已验证。r24 证明 Host 全画布采集能力本身可用，但同时发现 selector 会让同 history Bundle 短路该采集；该后续根因由 D-090 收口，因此仍不能宣称正式成功率已提高。
- Agent 在设计过程中自主决定看全图还是局部、如何裁切和如何修订；局部 `region` 观察可以支持对应局部判断，但不能冒充完整交付面的终审 ReviewSet。Harness 不应要求 Agent 用固定工具顺序设计，也不能因局部图看起来正常就自签质量通过。
- 当 Agent 已进入自然终稿、当前任务需要视觉质量结算、结构读回确认了精确 Photoshop revision，而单画布完整 ReviewSet 缺失或过期时，Harness 可以执行一次有界的全画布只读观察。该动作只补事实：优先使用带 `expectedDocumentId` 且不带 `region` 的 `getCanvasSnapshot`，无该能力时才使用完整文档快照；结果必须与结构读回同 revision，否则丢弃。
- 多画面任务不适用单画布替代：详情页等声明式多画面 Profile 必须继续提供完整 Bundle、目标覆盖和同 history 证明，不能为了提高成功率退化为一张缩略全图。
- 审美断言仍由当前唯一多模态 Agent 模型的 Final Judge 产生。只有 Provider 逐图出站收据与实际 ReviewSet 完全匹配、Judge 完成且 Host revision 未变化时，Runtime 才记录“该精确像素结果已被终审”。这项绑定可以供 E2 验证同版本交付，但不伪造普通主模型的 `reviewDecision`，不执行修订，也不授予写权限。
- E2 只消费上述终审绑定与真实 save/export 收据；不能扫描目录猜最终文件，也不能因为磁盘上存在 PSD /JPG 就补造 `finalArtifactRefs`。用户可见过程只说明“核对最终画面 /交付文件是否一致”，具体缺口和协议诊断留在 Run Record。

### 正面经验

1. “Agent 是否需要看哪里”与“系统能否证明最终交付被完整看过”是两种所有权。前者属于设计判断，后者属于 Harness 完成验真；把它们混成一句“请再看画面”既降低自主性，也不能保证取得正确证据。
2. 结构读回、完整像素、Provider 出站收据和保存 /导出源 revision 串成一条链后，Final Judge 可以既不替 Agent 设计，又可靠证明它实际评价了哪一版。
3. 用 Profile 的 `single surface / multi surface` 语义决定证据形状，比按“主图 /详情页 /SKU”关键词分支更通用，也不会把业务流程写回 Agent 核心。
4. 先让真实 Attempt 失败，再从首个偏差修 owner，比扫描到文件后补绿更能提高成功率；r23 的文件存在但正式失败是有效证据，不是评测器应隐藏的噪声。

### 负面教训与禁止反例

1. **把局部 `region` 截图当完整成品**：它只能证明局部像素，不能评价全局层级、平衡、留白或列表缩略效果。
2. **同一缺口只重复提示“检查当前画面”**：模型可以再次选择同一局部区域，形成 `same_gap`；Harness 应补自己拥有的只读终审事实，而不是把协议知识转嫁给模型猜。
3. **给自动快照伪造 `reviewed=true`**：读取像素不等于模型已看过。必须由真实 Final Judge 请求和逐图出站收据建立精确绑定。
4. **看到 PSD /JPG 后扫描目录补 `finalArtifactRefs`**：这会绕过同 revision、最终版本与 Agent 交付声明，制造假成功。
5. **用单画布快照替代详情页完整 Bundle**：这会把多屏覆盖缺失隐藏成通过，属于降低证据要求，不是通用化。

## D-088 完成态可选 generation 必须在启动前证明能够独立闭合

- 状态：已采用并以 `f148d512` 推送；提交后 Agent /UXP identity 与 r23 写前环境已核实。r23 没有再创建 0 调用空子代，说明该故障形态已消失；但 r23 因 D-089 所述终审证据缺口仍未取得正式技术成功，不能把单一故障消失外推为整体成功率或商业视觉质量改善。
- `stopReason` 只描述上一 generation 为什么结束，不代表下一 generation 的资源状态。完成态可选审美改进必须读取同一 TaskRun 的真实累计 `RuntimePerformanceUsage`，并与本次请求实际生效的预算比较；不能从 `final_response`、质量分数、文件存在或助手措辞推断还有余量。
- 可选下一代必须至少容纳三次主模型回合（定向修订、同版本读回 /交付、终态结算）、四次 Tool Call（mutation、结构 /画面读回、保存、导出）、三次迭代、一个视觉候选、一次视觉分析和三个主模型 inactivity window 的活动时间。任一维度不足或调用方无法提供容量证明时 fail closed 为 `resource_budget_exhausted`，保留当前完成结果。
- 模型请求 timeout、收尾回合数和完成态重入最小容量由共享 `agent-performance-policy` 单点定义；`reflexion-reentry-policy` 是是否重入的唯一决策 owner，Executor 只传同一份只读累计快照和有效预算。容量检查不消费额度、不延长 deadline、不选择修法、不执行 Tool、不授予 Photoshop 权限。
- 迭代余量必须使用请求当前实际生效的 `maxIterations`，不能用 Manifest 或全局 ceiling 的较宽值冒充可用额度。plan-neutral 重入继续以同一快照播种下一 Agent；不得为可选改进创建第二性能账本或新 TaskRun。
- 容量不足的决定必须发生在父代 Run Record 中间提交、Debug 交付 sidecar 清空和新 Agent 构造之前。因此“注定 0 调用的空子代覆盖已完成父代”不能再作为正常失败路径出现。

### 正面经验

1. generation 本身是一段需要完整供给的生命周期事务；启动条件应证明它有机会闭合，而不是启动后再让普通预算器立即杀死。
2. 同一累计账本同时用于准入判断和下一代恢复，能避免检查一份、执行另一份造成新的 TOCTOU。
3. 用模型、Tool、迭代、视觉和时间的多维最小包表达“能做完一段返工”，比只看时间或只看 stopReason 更接近真实执行条件，也不涉及任何审美答案。
4. 在代际切换前停止，可以自然保留父代的结构化完成事实和交付引用，无需事后用 fallback 拼回成功结果。

### 负面教训与禁止反例

1. **把 `final_response` 当剩余预算证明**：r22 父代在终局质量预留内完成，活动时长已超过普通软预算；外层仍启动子代，导致它 0 模型 /0 Tool 即停止。
2. **先清空交付引用再判断子代能否运行**：这让一个没有执行任何工作的空代覆盖真实 PSD /JPG，是 Harness 自己破坏完成真相。
3. **只增加 retry / timeout**：它不能证明模型、Tool、迭代和视觉额度同时足够，只会把相同代际错误推迟或转移到另一维度。
4. **按主图、83 分或某个模型增加例外**：根因属于所有完成态可选 generation；业务词、质量阈值和样例文件不得进入容量策略。
5. **让 Harness 根据容量不足选择“最小修法”**：容量策略只能停或允许 Agent 判断，不能借节省预算之名接管设计作者权。

## D-087 模型回合、交付能力、终局预算与完成事实必须按同一生命周期闭合

- 状态：已采用；通用实现、定向回归、Agent production build 与完整核心闸门 58/58 已通过并以 `4549a846` 推送。r22 已证明父代交付链能够闭合，同时暴露的下一 generation 容量缺口由 D-088 继续治理；正式 Attempt 仍未通过，因此不代表真实成功率或视觉质量已经达标。
- 模型回合在预算允许时取得一次性结算租约。该回合返回的 Tool Call 不再被已经流逝的普通软时钟二次否决；硬 Tool 上限、Capability deny、执行权限、目标 /revision、事务、preflight 与 unknown-write 安全边界全部继续生效。软预算仍可拒绝下一次模型调用。
- 通用交付能力以“当前 TaskRun 已形成可看设计内容”为生命周期信号，在同一个 Capability Session 中幂等开放已声明的 `delivery.*` schema。空白建档不触发；此动作不执行 Tool、不选择路径 /格式、不绑定 Stage，也不扩张原有 deny ceiling，设计与交付决定继续归模型。
- 质量优先任务在普通软预算内预留有限的终局模型回合；Final Judge 与 diagnosis 共享同一个绝对终局质量截止时间。预留用于闭合既有任务，不允许开始新的设计方向，也不是无限延长 timeout。
- 停止原因与任务终态分轴：`performance_budget` 先走统一 Terminal Closure，再由结构化产物、目标、写后读回、质量与交付收据结算 completed / unfinished。预算到点不能把已经完成的同 revision 事实改写成失败。
- agentic 最终交付证据是同一最后内容 mutation 之后、同一 document /history、通过 `production-delivery` 验证的完整回执集合；必须按输出契约同时满足可编辑稿和光栅预览，不能用最后一次 save/export Tool Call 代表全部产物。
- 以上规则是任务生命周期基础设施，不属于主图、详情页、SKU 或任何 Skill。禁止按品类关键词激活、写进固定工作流、自动调用保存 Tool，或为单个事故增加第二套 completion /delivery 状态。

### 正面经验

1. 把模型回合视为“准入后可结算的工作单元”，能消除预算边界上的 TOCTOU，同时保留下一回合的硬停止能力。
2. 用已发生的结构化产物事实驱动 Capability 渐进披露，比用意图关键词或品类流程更通用，也不会替模型做设计选择。
3. 将停止原因、产物完成、视觉质量和用户可见回复分轴后，系统可以诚实停止而不伪造失败或成功。
4. 把交付视为同 revision 的集合，才能可靠绑定 PSD /PSB、预览图和最终视觉复核，避免“最后一张回执覆盖前一张”。

### 负面教训与禁止反例

1. **回合前允许、回合后按软时钟拒绝动作**：这是 Harness 自己制造的无进展，不得归因给模型慢或 Agent 不执行。
2. **成稿后仍要求模型搜索通用保存能力**：这浪费终局上下文与时间；应开放 schema，但不能替模型发出调用。
3. **把 timeout 延长当修复**：没有终局预留和统一结算，只会把同一失败推迟发生。
4. **`performance_budget` 无条件映射 failed**：停止原因不能覆盖结构化完成事实，也不能隐藏真实未完成义务。
5. **只取最后一次交付调用**：会让 PSD 与预览图无法共同证明同一版本，正式成功判定必然失真。

## D-086 设计可靠性只保留一条 Attempt → Run → Review → Attribution 证据链

- 状态：已采用；统一契约、固定 Fixture / workspace 语义身份、质量优先 timeout、Attempt 归因、可信参考像素提交与 cohort 比较已完成代码和纯逻辑验证；首条真实跨商品参考复刻 Case 与隔离 Fixture已建立，但 SKU 私有交互 actor、Photoshop 重复样本和严格盲评仍待后续里程碑，不能由本裁决补造成已完成。
- 正式分母由 canonical `submission_started` Attempt 拥有。Run Observation 只在能够从同一 TaskRun 取得完整运行证据时生成；提交后在 Provider、Harness 或环境层提前失败的 Attempt 仍必须保留终态并可使用同一个 Attribution schema 归因，不能因为没有 Run 而从成功率和根因统计中消失。
- Attribution 使用严格 subject union：新记录只允许 `{ runObservationId }` 或 `{ attemptId }` 二选一；旧顶层 `runObservationId` 只作兼容读取。归因仍是开发 sidecar，不建立 Failure Store，不进入 Runtime、Prompt、权限或完成判定。
- Fixture Input Snapshot 与 Workspace Runtime Metadata 分轴。只有精确 `.designecho/project.json`、现行完整 schema、合法枚举 /时间以及和 fixture realpath 完全一致的项目身份可以存在，且不进入输入摘要；整个 `.designecho` 不得被忽略，历史 Run、Project State、旧 PSD、旧导出和其它 metadata 仍是污染。
- Workspace metadata 中会影响 Agent 判断的 `folderMappings / imageClassifications / designPlan` 形成独立语义摘要，并绑定 Attempt、Run、fixture identity、cohort 和 Agent 实际消费的 `ProjectContext` 快照。`lastOpenedAt` 等易变字段不制造假漂移；上下文构建前后或最终消费摘要不一致则在模型与 Photoshop 写入前停止，不能用 `handleSend` 前的一次旁路读取冒充上下文已经冻结。
- 正式 live timeout 是 Suite 控制维度，不是隐藏 CLI 默认值。当前质量优先预算固定为 900000ms，显式覆盖只有完全相同时才接受，并进入 cohort fingerprint；不同预算不能混入同质 cohort。质量稳定前不以缩短超时换取表面成功率。
- 参考复刻进入同一 Design Reliability 契约。用户明确给 Agent 的目标参考属于 `agentVisibleReferences`，复制进 fixture 前后必须核对冻结内容摘要；Main 随后真解码并规范化为不可变视觉载荷。Debug-only 租约只存在于 `handleSend` 与实际模型 IPC 的临时作用域，不进入 Agent Context /Prompt /TaskRun；Main 重新核对租约、binding、消息像素与 Provider 出站事实，成功返回后才签发收据，Renderer 不能自签或覆盖。收据必须早于首次 Photoshop mutation，避免设计后补看参考。只供盲评的用户成稿 / Eagle 锚点属于 `reviewOnlyReferences`；目标参考在评审包中作为显式 context，不与匿名商业质量锚点混组。两者 ref 或内容相同即拒绝，旧 synthetic reference benchmark 只保留几何诊断价值，不再拥有 live 或商业质量结论。
- SKU 自主质量与 SKU 必要业务确认是两种不同实验协议。带权威规格的 Case 测 `autonomous_zero_correction`；需要专属卡的 draft Case 公开部分不保存规格、答案、输出数量、语义文件名或盲评锚点，只绑定一个同时拥有答案、输出期望与评审来源的不可变私有 manifest。未来 actor 必须经真实 Skill Provider 和同一 TaskRun continuation 回放；capability 只能用一个实际执行并验证完整协议的 `dispatchProtocol` 注册，不能用 metadata 或分散的占位 hook 拼成已具备能力。必要业务确认计协议交互，不计设计纠错；Harness 不自动选第一项、不按标题猜卡、不把 waiting_user 改写成成功。
- SKU 专属卡的颜色槽位必须携带由 Provider 从同一次稳定 Photoshop 观察派生的 `colorIdentity`，至少绑定 `documentId / historyStateId / layerId / layerPath`。展示标签允许修正，身份不随“身肤 /深肤”等文案变化；`candidateFingerprint` 覆盖来源身份，卡片与 actor 不再把槽位序号当素材真相。该运行态身份不冒充跨关闭 /重开的源 PSD 内容 SHA-256 血缘，因此私有 actor 在完整 source lineage 前保持未激活。
- 所有会恢复或执行操作的交互完整性身份必须使用版本化 canonical SHA-256：来源卡、提交、continuation、TaskRun binding 与持久 operation record 使用同一强指纹家族；32 位 `stableInteractiveCardHash` 只允许 UI dirty-check /渲染去抖 /非权威缓存。旧弱指纹记录不得静默兼容为新记录，必须给出明确拒绝原因并要求重新提交或重新发起。
- Cohort Compare 必须重算 Attempt 身份并校验所有计数范围、rate 算术、逐 Case /逐任务族求和、fixture 与控制维度。全部失败或每 Case 仅有一个幸存成稿时仍可输出技术诊断，但在每个 Case 达到最低严格盲评成稿数前不得形成正式设计质量结论；同一 reviewer 重复评同一 Run 视为冲突，不得加权中位数。

### 正面经验

1. 先冻结 Attempt 身份，再按是否取得完整 TaskRun 证据生成 Run，可以让 Provider 失败、超时和提交后中断进入真实分母，同时继续保持 Photoshop unknown-write 的安全对账边界。
2. 把应用正常产生的 Workspace metadata 作为受控第二轴校验，比把所有额外文件一概判脏或忽略整个目录都更准确；前者会自我阻塞，后者会吞掉真实污染。
3. timeout、Case 集、Rubric、模型、构建、fixture 与交互协议都属于实验身份。把它们写进 fingerprint 后，同 Case 前后对比才有因果意义，不能用不同条件的总体平均值制造改善。
4. Agent 可见参考和评审隐藏锚点分开后，既能测试“模型是否读懂参考”，又不会把目标商品最终答案直接送进项目；内容摘要校验比仅检查相对路径更能防止静默替换。
5. 必要业务确认与设计纠错分开计数，才能同时保留 SKU 专属卡的高价值体验和“尽量减少人工介入”的真实指标。
6. “请求里带过路径”与“模型真的在首次写入前收到像素”是三件不同的事。由 Main 冻结图像字节、以不进入 Runtime 的临时 IPC 租约绑定实际 Provider turn，并把成功时间与首次 mutation 比较，才能把参考复刻失败归因给 Agent 判断而不是附件链路或晚到 QA。
7. 聚合报告本身也是不可信输入。只有重新校验范围、分母、逐 Case /逐任务族求和和最低审美样本量，才能防止一个幸存结果或手工改过的 JSON 制造质量提升。

### 负面教训与禁止反例

1. **把 `.designecho/project.json` 当普通额外文件**：评测器会在应用成功绑定 fixture 后立刻判定 fixture 被污染，导致合法测试永远无法启动。必须校验精确 schema 与根身份，而不是按目录名猜。
2. **用五分钟隐藏默认值测试质量优先设计**：历史正常深度运行已经超过该时间；过早中断会把评测器预算错误伪装成模型能力失败。预算必须显式、冻结、可比较。
3. **Attribution 只允许绑定 Run**：提交后尚未形成 Run 的失败已经进入分母，却没有 owner，最终只剩“成功率低”而无法指导根因治理。Attempt 与 Run 必须共享同一归因对象，不另造库。
4. **把参考复刻留在第二套 live /质量脚本**：双 Case、双状态、双评分与过期命令会产生互不一致的结论。合成像素探针只能做组件诊断，真实设计质量统一进入 Design Reliability。
5. **同一 SKU Case 同时要求零人工和确认卡**：协议自相矛盾，任何结果都可被解释成失败。自主完成和必要确认必须拆 Case、拆指标，但继续复用同一 Runtime /TaskRun /Provider。
6. **硬编码 `userInterventionCount=0` 或自动点击首个候选**：前者把未知伪造成零，后者让 Harness 替用户做业务决定。计数只能来自真实 Provider /operation 收据；无法证明时保持 unknown。
7. **Renderer 原样回显参考数组或在 UI 调用前自签“已看图”证明**：这只能证明字符串 /内存块经过 UI，不能证明源文件可解码、内容未漂移或像素经过适配器进入 Provider。必须由 Main 生成有界视觉载荷，并在真实模型传输成功后以实际请求块签发收据；Main 完成端忽略 Renderer 同名字段。
8. **公开交互 Case 留下规格、数量或语义文件名**：删除 `answer` 字段仍可从 `requiredSizes`、输出数量、评审路径或另一公开 CSV 恢复答案。公开 Case 只能保存高熵私有 manifest 身份，且未来命令工具必须对 fixture 做能力沙箱。
9. **Actor capability 只登记名字或分散占位 hook**：验证通过后仍走固定自然请求，会把“有能力记录”误当成“实际执行了交互 actor”。Registry 项必须拥有一个端到端 `dispatchProtocol`，由它实际完成执行、私有解析与收据验证；`run-live` 只消费这个闭合结果。
10. **用一个幸存成稿代表五次设计质量**：商业可用率可以诚实记为 1/5，但这不足以形成审美分布。必须另设每 Case 最低可评分成稿数，未达到时只报告 survivor diagnostic。
11. **用 32 位快速哈希绑定确认与恢复**：UI hash 的碰撞可以让不同来源、提交或 continuation 看起来相同。所有可执行交互必须使用版本化 canonical SHA-256；旧记录明确失效，不能以兼容名义继续获得执行权。
12. **Provider 收据在流式 Tool call 之后才校验**：即使最终判样本无效，Renderer 也可能已经承接 Tool 写入。带参考租约的 Debug 流必须先完成非流式 Provider 收据闭环，再发布唯一 terminal /可执行 Tool 结果；取消、丢图或 adapter 丢字段绝不签收。

## D-085 动作事实、交互等待、产物完成、设计质量与任务终态必须分轴结算

- 状态：已采用；代码、定向回归与本提交 50 项整仓核心验证已完成，固定 Fixture 实机验收继续以 `CurrentTask.md` 为准。
- 单次 Tool / Skill 尝试是不可改写的历史事实，但不是任务终态。`success:false` 必须先按结构化 disposition 区分真实失败、可恢复失败、workflow handoff、等待用户、取消和未知副作用；只有终态投影可以判断整个 TaskRun 是否失败。
- Task Completion 只消费当前尚未闭合的结构化义务与同目标 operation ledger。相同 Tool、参数和文档上的后续成功可以结清较早失败；不同参数、不同目标、未知写状态和仍缺收据的失败继续保留。旧 revision 的验收不能推翻已经在更新 revision 上完成并读回的结果；后续无副作用的预算拒绝也不能撤销同 revision 已取得的质量闭合证据。
- `artifactStatus` 只表达必需产物、目标、写后读回和交付收据；DesignVerdict 另行表达专业质量。只有携带合格 blocker kind 与 proofRef 的确定性质量问题可以阻断交付；普通审美 finding 保留为改进建议，不能把 `artifact_completed` 改写成“结果需要复核”。
- 等待确认和 workflow handoff 是控制流，不是失败；Task Card 是工作笔记，不是第二 Completion owner；模型最终正文和总结 Provider 只是展示层，不得从措辞反推完成，也不得因总结超时、空回复或半句输出推翻已闭合的结构化结果。
- 模型准备结束但仍缺当前版本读回、正确目标或显式文件交付时，现有同一 Agent 实例在保留完整 Tool Log 的情况下接收缺失事实并继续收尾。Harness 不指定截图、保存 Tool 或设计修法；Agent 自行选能力。只有真正的视觉质量修订才进入 Reflexion，等待用户、预算耗尽、未知副作用或 writer 冲突不得被恢复逻辑升级成写权限。
- 自然终稿先进入“准备闭合”，再进入不可逆提交：准备阶段只评估 Completion、同版本图层结构 / 画面证据与 Delivery 投影，不 finalize Session / Artifact、不 release writer，也不提前推进 E2。只有确定不需要继续收尾时，commit 路径才附加 E2 trace 并发布结果。
- 终态闭合已开始后，任何 `no_progress` / preflight / budget / cancel / waiting / writer conflict / unknown write / needs reobserve / stage mismatch 早退都必须在同一 Agent 实例结算并清除 outer Reflexion handoff；不得通过外层新建 Agent 丢掉原 Tool Log、恢复次数与已知失败事实。同一 gap fingerprint 重复或达到有界次数时诚实停止，但对用户只投影具体对象与缺失事实，不再回落到通用“结果需要复核”。

### 正面经验

1. 把 attempt、action disposition、control flow、artifact completion、quality verdict 和 task outcome 分开后，可以同时做到“不隐藏真实失败”和“不让历史失败污染最终版本”；单一 `success` 布尔无法表达这些语义。
2. 使用同一个 canonical operation ledger，并以 Tool 参数、Host document /history、mutation 与 delivery receipt 精确关联，可以让 Skill 内嵌原子调用和普通 Agent Tool 共享完成口径，不需要为 SKU、主图或详情页各造一套补丁。
3. “最新可验证版本”优先于“最后一条日志”。后来的真实写入会使旧观察失效，但同版本的无副作用拒绝、诊断或预算提示不能撤销已经成功的读回。
4. 产物轴与审美轴拆开后，Agent 可以继续消费具体审美建议做有界改进，同时已保存、已导出、已读回的事实不会被笼统 quality gate 抹掉；软 finding 对用户投影为可选优化，不再变成待复核终态。
5. 用户展示按精确 `toolCallId` 收束过程行：Debug completion 可以关闭对应“处理中”步骤，但不生成红色失败；真正任务终态只来自结构化 Completion。这样并行同名调用、workflow handoff 和重规划不会留下悬空红条。
6. 最终正文生成失败时使用结构化中性摘要，比“回复未完整，继续补全”或根据模型措辞猜状态更可靠；失败诊断仍进入 Run Record，不冒充用户结果。
7. 同实例收尾只反馈“缺什么事实”，不反馈“必须调用哪个 Tool”。这既提高自动闭合率，又保持 Agent 对方法和下一步的作者权。
8. 最终事实只有一份，但可以有多个过程投影：Task Card、Action Plan、legacy public-plan 与 Skill 前置视觉提示都必须服从 canonical Completion。完成后尚未同步的工作笔记可以被压制，但等待、取消、真实失败和未知写状态必须继续显示。
9. Skill 前置刷新改变了实际执行参数后，结果只能从 executor 真正消费的最终参数重建上下文。执行前的 stale context 不能附回成功结果；`assetPath` / `sourcePath` / `sources[].filePath` 等当前调用的显式来源必须被识别，但它们只证明“有来源素材”，不伪造“已完成视觉理解”。
10. 精确 terminal closure outcome 必须同时服务用户与调试：用户只看自然的缺口名称与停止原因；Run Record 只保存 gap kind、reason、证据类别、数量和 document / history 锚点的有界 digest。两边都不保存 public prose、绝对路径、fingerprint、manifest token 或原始缺失项。这样 `debug:runs` 能看到真正 owner，普通对话不会暴露工程术语。

### 负面教训与禁止反例

1. **把 `success:false` 直接变成任务失败**：等待确认、workflow handoff 和可恢复动作会被 UI 提前终态化，随后 Agent 即使成功也留下“未完成”。必须先解析 disposition，再由 Task Completion 结算。
2. **最后一次尝试获胜**：最后一条如果只是重复观察的预算拒绝，会抹掉此前同 revision 的成功读回。正确规则是最新有效状态变化获胜，不是数组最后一项获胜。
3. **历史失败永久计债**：早期失败后同目标已成功，仍按累计失败数阻断最终状态，会诱发重复制作。历史计数保留诊断，完成阻断只看尚未被可信后续证据结清的义务。
4. **旧 revision 验收污染新版本**：旧画面的待复核或失败不能自动迁移到新 revision；新版本必须有自己的观察，而旧结论只保留为历史。
5. **质量状态覆盖产物状态**：把 scorecard 的 `needs_review` 直接写成 artifact incomplete，会让一个审美建议否定真实 PSD /导出图和交付收据。两条轴必须独立，只有 qualified blocker 才阻断。
6. **Task Card、助手正文或 warning 成为第二完成判定器**：卡片没同步、总结没生成、正文写了“还需检查”都不能推翻 operation /receipt；反过来，正文说“已完成”也不能补造收据。
7. **把历史 handoff 伪装成当前失败 Tool Log**：人工合成 `success:false` 复入记录会制造并不存在的新失败，并污染当前 generation。恢复身份应通过结构化 continuation /session 传递。
8. **通用“结果需要复核”兜底**：它混淆缺质量结论、软性改进、真实产物缺口与未知写状态，还把系统未闭合的责任转给用户。必须分别给出精确事实；可自动补齐的在同实例内补齐，软建议不阻断，真实危险才停止。
9. **过程开始公开、Debug 完成被过滤**：只显示 `tool_started`，却丢掉同一 `toolCallId` 的 Debug completion，会留下永久红色“未完成”。过滤内容不能破坏过程生命周期。
10. **重启应用作为验收前置动作**：`pending=0` 不证明 Agent、Provider 或用户 Photoshop 工作空闲；有未保存文档时重启可能中断用户任务。先只读核对 Runtime 与文档，再决定是否需要重启。
11. **只在自然 final response 上加同实例守卫**：收尾后的 Tool 若从 no-progress / preflight 等早退，旧 handoff 仍会逃到外层新建 Agent。“同实例”必须是 terminal-recovery mode 的整个生命周期不变量，不是某一个返回点的补丁。
12. **prepare 阶段提前写 E2 trace**：即使还没 finalize Artifact 或 release writer，提前推进 Stage 也会让后续继续运行面对一个伪终态 Session。审计与提交必须分离，不能只拆出一部分副作用。
13. **把可恢复证据写死为 `fresh_visual`**：Profile 已用 runtime repair metadata 声明 `fresh_structure` 与 `fresh_visual` 都可回到 R5 补证，核心若再按证据名称分支，会重新产生品类式硬编码。应消费既有声明，不在 Agent 内复制方法。
14. **先追加 generic needs-review，再追加精确原因**：这会让用户同时看到“质量仍待复核”与真实缺口，表面有更多信息，实际仍有两份终态。Completion consistency 必须直接消费 typed outcome 作为唯一精确说明，不能在事后用字符串删词。
15. **只修当前传入源字段**：SKU 常用 `sources[].filePath`，其他调用可能用 `sourcePath` / `sourcePaths`。应归一化“明确来源”语义并用真实 Skill 输入形状回归，不要每出现一个字段就在 UI 再补一层压制。

## D-084 交互 owner 与外部能力采用 Agent / Harness Kernel / Skill Package / Tool-Capability Provider + Host 四层边界

- 状态：已采用；本裁决定义当前实现不变量，具体代码接线、构建和真机状态继续以当前代码、`CurrentTask.md` 与 `Status.md` 为准，不能由文档补造成已验证完成。
- Agent / Model 拥有目标理解、Task Profile / Skill 选择、设计取舍、开放任务中的可选澄清和失败后的重规划；已选 staged Skill 可以按确定性生产契约要求必要的领域确认点，Agent 不能绕过，但候选内容和设计判断仍归 Agent /用户。Harness Kernel 只拥有同一 TaskRun、Context、Capability Resolution、跨调用调度、target /revision 绑定、授权 /preflight、reconciliation、验真、完成判定、幂等、预算与停机，不从品类关键词、文件名、旧 route hint 或 `routing recommendation` 补造 owner。推荐只是模型可以忽略的候选，不能抢占 Skill、交互卡、Capability 或恢复路径。
- Skill Package 拥有领域方法、确定性生产规格、卡片 schema、候选语义、校验、提交消费、评价引用，以及按领域 schema 派生的 `decisionFingerprint / candidateFingerprint / answerFingerprint`。三者分别表示稳定决定、本次候选和规范化用户答案；Harness 只做精确判等和 TaskRun /owner 绑定，不解释组合、颜色、版式或其它领域内容，也不以相似度猜“这是同一个决定”。
- Tool / Capability Provider + Host 可以由内置模块、UXP /浏览器扩展桥或插件承载，拥有 Photoshop、项目文件、Eagle、浏览器和桌面观察等跨 Skill 原子能力的协议、schema、Host 连接、Provider-local 取消 /超时、原始读取结果与原始 mutation receipt；受控命令是条件性扩展目标，不是当前已完成事实。Photoshop 写入的唯一 mutation 事务 owner 是 `PhotoshopTransactionRunner`；Provider / Host 不另建跨调用事务、revision 或完成判断。Skill 只声明依赖，Harness 决定能力可见性与一次调用授权并消费原始收据做 reconciliation；Provider 已安装、已登记或 Host 可达均不等于模型可见、已授权、已执行或任务完成。
- 领域卡的 Provider、Renderer、type guard、owner 与版本必须由同一个 Skill package registration 派生。通用 ChatPanel /卡片 Host 只能提交品类中立的短选择或多字段草稿，不能复制 SKU /主图 /详情页字段、默认候选或确认状态来旁路 Skill Provider。未知 kind /版本、缺 owner、owner 不匹配或未注册卡必须 fail closed，并显示不可操作说明；不得使用通用“确认”按钮执行卡片自带 action。
- 同一 TaskRun 已消费一个领域决定后，冻结的决定 /候选 /答案身份必须穿过直接 Skill 续跑与 Agent reentry；如果下一张卡仍是同一决定、候选等于刚确认答案，且期间没有 plan、mutation 或 Photoshop revision 等真实进展，这不是“用户还没说清楚”，而是 Skill /Agent 没有推进。Harness 只报告 `interaction_no_progress` 并保留原 TaskRun；重复只读调用、换标题、换 card id 或把答案写回 initialValue 不能冒充进展。Agent 应重新观察、换方法、调用其它已授权能力或诚实停止，不得再次询问同一问题、重发用户文本创建新任务，或让 Harness 根据 routing recommendation 指定下一 Skill /Tool。

### 正面经验

1. 用 `owner + kind + payloadVersion + decision / candidate / answer fingerprints + TaskRun identity` 做精确绑定，可以在 Harness 完全不理解 SKU 字段的情况下阻止跨 Skill 恢复、旧卡重放和无进展重问；通用安全性来自稳定身份，不来自更多品类正则。
2. 把专属 Provider 与 Renderer 放回同一 Skill package，既能保留 SKU 拖拽、增删、排序和人工复核等高价值体验，又能让通用 UI 保持品类中立。可插拔不等于把业务卡降级成通用字段表，而是让领域体验可安装、可移除、可版本化且不污染 Agent 核心。
3. Harness 只比较 Skill 签发的决定指纹、检查 owner /scope /revision 和真实副作用；Agent 负责理解失败并重新规划。这个分工同时减少重复人工确认和 Harness 对模型下一步的劫持。
4. Tool / Capability Provider + Host 作为跨 Skill 原子能力层，可以让 Photoshop、Eagle、浏览器和桌面观察复用同一 Capability /preflight 安全边界，并为未来受控命令保留相同接入方式，避免每个 Skill 各复制一套电脑控制实现；内置与 plugin-backed 只是部署方式，不改变 owner。
5. 复杂度棘轮应该促成真实拆分，而不是在功能通过后抬高基线。本轮把交互复入停滞、工具 /用户结果投影、质量历史闭合和最终结果信号迁出 `agent.ts`，主循环从 12936 行降到 12845 行，再把新低点锁回棘轮；这比在巨型循环里增加一个“通用 guard”更能保护后续泛化能力。

### 负面教训与禁止反例

1. **场景关键词补丁**：为了修复“帮我做一下 SKU”之类单句漏路由而继续扩充正则，只会形成更多互相竞争的分类器。关键词可以帮助召回候选，不能拥有 Task Profile、Skill、交互或执行选择权。
2. **推荐抢 owner**：把 `routing recommendation` 当成已选择 Skill，会让 Harness 在模型判断前裁工具面、拦通用交互或恢复错误 workflow。只有结构化用户 /模型选择可以成为 owner；推荐不产生权限或等待点。
3. **默认首 N 色**：卡片 Builder 缺候选时自动取前 N 个颜色，看似提供“可用默认”，实际替模型 /用户生成 SKU 业务决定，并使不同任务反复得到相同结果。Builder 只能规范化与校验，候选必须由 Agent /用户 /Skill 显式提供；空候选应诚实为空或失败，不得暗选。
4. **通用卡复制领域语义**：用 `editable_confirmation` 复制 SKU 组合字段，会绕过领域校验、记忆、恢复消费与专属体验，并让 ChatPanel 重新认识 SKU。领域交互必须由已选 Skill Provider 生产；通用卡只解决真正通用的选择和草稿。
5. **Provider /Renderer 双注册**：语义 Provider 和视觉 Renderer 分别维护 kind /version 列表，会产生“可提交但不可渲染”或“可渲染但由错误 Provider 消费”的漂移。必须从同一 package registration 派生。
6. **未知卡仍可点击**：未知卡落入通用确认按钮并执行自带 action，把兼容兜底变成未注册执行入口。未知、损坏和版本不支持必须不可操作；兼容只能通过显式迁移或 legacy alias，不得通过任意 action 兜底。
7. **无进展重复询问**：已经收到同一决定的答案，却因 Skill 没有副作用或 revision 变化而再次弹同一张卡，会提高人工介入率并掩盖真实执行 /规划缺陷。正确恢复是把无进展事实交给 Agent 重规划，而不是继续要求用户确认或由 Harness 代选下一步。
8. **把候选摘要当决定身份或把读取次数当进展**：候选稍有变化就生成新 `decisionFingerprint`，会让 Skill 通过改 initialValue 绕过停滞检测；把任意 operationResult /只读调用数量增长视为进展，则会形成“读一次同样现场再问一次”的旁路。稳定决定、候选内容和用户答案必须分开签名，进展只接受计划推进、真实 mutation 或 Photoshop revision 等受治理事实。
9. **审计写死源码形状**：测试只寻找某个文件里的旧字段、旧 helper 或某一行精确调用文本，会在 owner 正确下沉后制造假失败，并诱使维护者恢复重复实现。行为测试应覆盖真实 TaskRun /Provider /事务结果；静态审计只钉 owner、边界、危险旁路与不可缺少的语义链。实现迁移时可以同步更新源码定位，但不得删除或放宽原语义保证。
10. **半成品先接生产**：函数已经被真实服务调用，却仍保留 TODO、忽略声明的过滤 /去重 /封顶参数，比“功能尚未开发”更危险，因为上层会把它当完成能力。本轮语义目标选择器就是反例；生产接线前必须完成最小闭环，或保持不可达，不能让注释替代实现。
11. **有测试但不在核心链**：新增测试脚本若没有进入唯一 `maintenance:validate`，会制造“核心全绿但新能力从未执行”的假安全。本轮已把语义目标框、语义候选和变更边界分类并入核心清单；以后任何 production capability 的长期测试必须同步进入该清单，不能留成旁路命令。
12. **文档把不同粒度写成同一个 owner**：笼统说 Harness 和 Provider 都“拥有事务 /读回”，会让后续实现各建一套真相源。必须分别写清跨调用编排与 reconciliation、原子 Host 调用与原始收据、以及唯一 mutation transaction owner；同样，开放澄清归 Agent，不等于 staged Skill 不能声明必要生产确认点。

## D-083 性能预算账本抽取与静态审计同步维护（agent.ts 拆分批次 1）

- 状态：已采用；代码完成，完整 22 项核心验证进行中；真实 Photoshop E2E 与收敛指标对照待验证。
- `agent.ts` 的运行级预算状态（模型/工具/视觉候选/视觉分析/终局 Judge/质量复核/预留区观察计数与活跃时长）收敛为单一 `performanceLedger` 状态对象；纯记账函数（预算耗尽判定、执行供给预留、质量复核上限、活跃时长）迁入新模块 `src/renderer/services/agent-runtime/performance-ledger.ts`。Agent 侧保留薄包装，注入运行态事实（授权期望、交付动作尝试、终局 Judge 预留、画面改动观察），单一 owner 不变。
- 行为零变化：耗尽判定顺序、终局 Judge 预留口径、切片 2 执行供给预留与质量复核上限语义原样保留；新模块不读 Photoshop、不读模型能力、不写消息历史。
- 静态审计的 agent.ts 文本断言随标识符改名同步迁移：`audit-agent-business-boundaries` 4 处、`audit-capability-resolver` 1 处、`audit-runtime-declaration-resolver` 行为测试 1 处、`audit-tool-registry` 负向正则 1 处。断言语义不变，只跟随唯一 owner 的新位置；任何后续移除对应模式仍会失败，不构成放宽。
- 本裁决不新增 Runtime、不改变预算上限语义，不把审计迁移当作行为验证；真机结论与收敛指标仍单独声明。

## D-082 历史回答不是事实，专业判断由 Agent 承担，只读任务不借写入契约证明完成

- 状态：已采用；代码、纯契约检查、只读自然语言实机与 15 项核心验证完成，专业判断 ownership 的不同问法可见回归待窗口空闲后补齐。
- 历史 user 消息可用于承接仍有效目标；历史 assistant prose 只是 `untrusted_external` 草稿，不能证明事实、进展、授权、质量或阻塞。用户明确要求抛开 /不参考旧答案重新独立判断时，本轮上下文排除旧 assistant 文本，避免模型自我引用形成伪共识。
- 不确定性只有三类：环境中可观察的事实由 Agent 读取；可撤销的构图、选图、抠图、边缘、排版和 Photoshop 工艺由 Agent 依据专业标准决定、执行并复核；只有用户独占的商品 /SKU /权威文案 /合规事实或不可逆风险才询问用户。
- 同商品存在多个可用素材不是天然业务歧义。Agent 应按真实性、清晰度、完整度、代表性、构图潜力和交付适配度排序后选择；“怕选错”“都差不多”或个人偏好不能单独形成等待。
- 开场基础观察是当前 Run 的结构化 Runtime 事实。同 document / revision 下已满足的零参数读取不重复暴露给模型；mutation、文档切换、revision 变化或 unknown reconciliation 会使其失效并重新开放。
- 结构化只读计划或用户明确禁止修改且当前 Run 没有成功 mutation 时，不签发 Photoshop 写入完成契约。`同款产品` 只描述商品关系；只有明确复刻 /照着做 /参考图，或同款版式 /效果 /画面等动作语义才进入 reference replication。
- 以上规则复用会话 Context、Run 内读取缓存、TaskPlan 和现有 Completion Contract，不新增品类 Router、专业路径状态机、Guard、Registry、Runtime 或第二 Completion owner。

## D-081 基础设计工艺按结构化写入委托可见，R3 blocking 只表达用户独占输入

- 状态：已采用；代码与 15 项核心验证完成，重启后的真实 Provider + Photoshop 白底图回归待验证。
- 普通自然语言设计请求继续直接进入同一个自主 Agent。只要现有 Intent Control Plane 已签发 `write_photoshop + confirmed_tool_required`，Capability Session 就应提供通用设计执行基础能力；不要求模型先猜中主图、白底图、SKU 或详情页品类，也不从任务文字建立快速通道。
- `removeBackground` 属于通用 Photoshop 制作工艺，与置入、变换、文字、背景等一起构成 Agent 对自己“能怎么做”的基础认知。Capability 可见只帮助模型选择方法，不授予写权限；TaskRun、请求级写范围、E1 preflight、document / revision 和 TransactionRunner 仍是执行边界。
- R3 `blocking` 的语义是“只有用户才能提供的输入”。项目、画布或 Tool 能自行观察的事实必须在声明前取得；已经具备的 Photoshop 工艺必须进入 R4 执行，不能被重新解释成需要用户补透明素材并转入项目检索循环。
- Assistant 回复中的“我将创建 /移动 /导出”等自然语言永远不是执行来源。不得再用正则从回复文案猜 Tool 并建立第二套 recovery / allowlist；Provider 没有形成 schema-bound Tool call 时，应由同一 TaskRun 的结构化 liveness / no-progress 事实处理并保留真实失败。
- 参考检索是按需的设计信息来源，不是确定性生产任务的默认前置阶段。白底图、尺寸变更、抠图、置入等目标明确且能力已知的工作应走最短专业链：最少必要观察 → 真实制作 → 同目标读回 → 质量 /交付分层；只有真实缺失用户独占素材、规格或取舍时才等待用户。
- 本裁决不新增任务类型、Skill、Executor、Router、Fast Path、权限 Owner 或 Completion。其目标是删掉重复决策点、让隐性 Provider /Tool /Runtime 失败直接暴露，并以不同自然问法的真实 canary 验证稳定性。

## D-079 Task Profile 只绑定语义，用户请求级写范围是不可扩大的执行上限

- 状态：已采用；精确属性请求 containment 已完成代码和核心验证，普通自然语言接续同一 TaskRun / R4 仍待 V0 实机。
- Task Profile、Manifest、Skill、Design Kernel 和 Craft Recipe 可以补充交付物语义、方法、Capability 候选与评价标准，但不得扩大当前用户要求的交付物、mutation、目标文档或文件范围。模型声明任务类型不是新的用户授权，也不能隐式把 edit_existing 变成 create_new。
- 对只有一个明确 Photoshop 属性替换且没有第二 mutation、保存或导出要求的请求，复用既有 `runtimeAllowedWriteTools` 作为最小 deny-wins 上限：图层名称仅 `renameLayer`，可见文字仅 `setTextContent`，属性尚未消歧时仅开放两者。只读观察与 Harness control 保持可用。
- 范围必须同时作用于 Capability 候选面和最终 Tool 执行点；只隐藏 schema、Prompt 提醒、Task Profile 文案或 Skill denylist 均不能单独成为安全边界。Skill bridge 和 shared legacy provider alias 必须服从同一上限。
- 局部解析器只对单一、可确定的属性替换签发范围。用户同时明确要求其它 mutation、保存或导出时返回未收窄，由完整目标与计划处理；不得为了安全把复合请求误降成单步，也不得从任务品类关键词创建范围。
- 自然语言声明后进入结构化 Runtime 必须保持同一个 TaskRun，并继承原始用户目标、允许交付物、写范围、document /revision、Tool log 和预算。禁止递归创建新的 autonomous task 或用 Task Profile 默认交付物覆盖原请求。

## D-080 UXP 原生 `get` 必须静默执行，History 位置使用 DOM 真相源

- 状态：已采用；代码、真实 Photoshop 读回、Tool audit、UXP build 与完整维护验证通过。
- History 位置读取使用 `document.historyStates.length` 与 `document.activeHistoryState.id`，不得向 Action `get` 请求不存在的 `historyState.count` 属性。
- 必须使用 Action `get` 的其它 UXP 描述符统一携带 `_options.dialogOptions='dontDisplay'`。此选项只阻止原生 UI 弹窗，不吞掉 Tool error；错误仍以结构化失败返回上游。
- `audit:tools` 是该回归的静态门禁：无效 history count 或缺少 `dontDisplay` 的 native `get` 必须使维护验证失败。Host 请求因原生模态阻塞而超时时禁止自动重放写入。

## D-078 403 不等于认证失败，Provider 失败必须由真实请求边界归因

- 状态：已采用；代码与核心验证完成，应用重启后的 Ollama Cloud 设置页 live 复测待完成。
- 只有 HTTP 401、Provider 明确认证 code/type 或无歧义的认证失败消息可归为 `auth`。HTTP 403 表示服务已理解请求但拒绝访问；没有更具体认证证据时必须归为 `model_access`，不得诱导用户更换正确 Key。
- 模型设置页的“测试”必须是真实 Provider 请求。Key 连接验证与当前模型的订阅 /访问权验证是两个不同结论；长度、格式、已保存或模型列表可见都不能代替指定模型调用成功。
- Provider 失败只在请求抛错边界或显式 failure envelope 分类。UI、Engine 和 Agent 不得从模型正常回复正文、历史错误文案或裸 `401 / 403` 数字反推当前请求失败。
- Run Record 只保存脱敏、有界的失败来源摘要；原始 Key、Authorization、图像或完整 Provider 载荷不入档。失败摘要不授权重试、不改写 TaskRun 成功状态，也不是第二个 Error Store。
- 认证、订阅 /权限、计费和协议错误默认不自动重试。任何未来的暂态重试也必须有明确 retryable 证据、严格上限，且仅允许发生在无 Tool call、无 Photoshop mutation 的请求边界内。

## D-077 R4 语义计划保持非执行，V0 通过一次性执行信封取得派发资格

- 状态：已采用；V0 代码接线与核心验证完成，真实 Provider + Photoshop 纵切待验证。
- Model 继续拥有 R3 设计方向和 R4 语义步骤，只回答“为什么做、做什么、依赖什么”；`runtime-action-plan-declaration` 保持 `shadowOnly / executable=false / schedulerAuthority=false`，不得携带 Tool 名、参数、layerId、坐标或执行权限。
- 首批 `photoshop.mutation.v0` 只认证已经由唯一 `PhotoshopTransactionRunner` 持有的 `renameLayer`、`groupLayersSafely`、`moveLayer`、`lockLayer`、`setTextStyle`。每个动作使用一对一叶子 Capability；broad manage /write alias 和包外 Tool 不取得该资格。
- Model 随后提交真实 schema-bound Tool call 时，现有 E1 派发接缝才可编译一次性执行信封。信封必须绑定 TaskRun /run、plan revision /fingerprint、当前 node、active leaf Capability、provider、参数 fingerprint、document 与 history revision，并再次通过既有 execution preflight 和单文档 writer ownership。
- 执行信封只证明该次调用已满足派发资格，不是第二 DAG、Scheduler、Capability Registry、权限 Owner、TransactionRunner、Completion 或 Release。合法调用仍交给现有 `executeToolWithFailureBreaker`、UXP 和 `PhotoshopTransactionRunner`；包外调用保持现有 v3/E1 路径。
- 真实 `PhotoshopOperationResult` 必须与信封 provider 一致并直接归属其 node。缺失或 provider 不匹配时 TaskRun 转为 `unknown / needs_reobserve`，禁止事后猜归属和自动重放；shadow reconciliation 只保留为独立语义 /观察审计。
- 该裁决只完成代码和核心验证。未经真实 Provider 生成调用、Photoshop 写入、同目标读回以及并发 /恢复验证，不得宣称 V0 E2E、设计质量或标准设计师能力已经完成。

## D-076 自主任务语义续接复用有界会话上下文，生产义务以结构化 Brief 为准

- 状态：已采用；代码接线与核心验证完成，真实 SKU 同会话复跑待验证。
- 当前用户指令仍是最高优先级；最近有界历史只用于解析指代、承接同一会话已经明确且尚未完成的交付物、避免重复探索。历史是 data-only Runtime Context，不授予 Tool、Stage、mutation、完成或 Release 权限，也不能覆盖实时项目 /Photoshop 事实。
- 普通自然语言入口保持中性 Task Plan，不用关键词、品类正则或历史文件名预造 SKU /主图 /详情页身份。主 Agent 在运行中声明 Task Profile / Runtime Design Brief；如果当前短指令结合有界历史仍不能唯一确定交付物，只问一个会改变执行方向的用户问题，不用反复项目搜索代替澄清。
- ready Runtime Design Brief 若声明 `photoshop_mutation_with_readback`，现有完成义务必须要求真实写入或交付动作；合法只读、打开、解释和分析任务继续按自己的交付类型完成，不为满足统计而制造 mutation。
- 只读观察失败必须区分“确定性环境事实”和“可选上下文没读到”。前者可阻断或要求用户动作；后者保留失败 Trace，但不得独自冒充交付失败，Agent 应在同一 TaskRun 内用更轻读取、当前画布 /组件边界、设计原理或其它存活能力局部重规划。
- 没有成功 Photoshop 写入、导出或外部生成时，任何 `needs_review` 输出都不得声称已有“当前版本”。诚实输出必须说明只完成了读取、尚无可复核设计结果。
- 该裁决复用 `agent-conversation-context.ts`、Runtime Context Compiler、Runtime Design Brief、现有 Completion 会计和 Tool Trace；不新增 Conversation Memory Store、关键词 Router、品类 Executor 状态机、第二 Completion 或第二权限通道。

## D-075 Agent 的能力自我模型由现有 Task Profile 与 Capability Session 实时投影

- 状态：已采用；代码接线与核心验证完成，真实设计效率和选择质量待 V0/V1/M6 实机验证。
- 成熟设计师式作业不是新增角色状态机，而是让主 Agent 在每个模型轮次看见稳定的交付物语义和真实能力边界。Task Profile 继续拥有“要做什么”；Capability Session 继续拥有“当前能用什么、还能装载什么、明确不能用什么”；Tool 语义继续拥有前置条件、副作用与验收方式。
- `declareDesignIntent` 形成合法 Task Profile 后，下一轮及后续轮次持续注入对应交付物责任、默认结构与阻塞输入；不能只把知识作为一次性 Tool result 返回后依赖模型自行记住。
- Capability self-model 每轮重新投影 active / on-demand / denied / unavailable。legacy capability alias 复用其真实 provider Tool 的已审核语义，但 alias、语义和 schema 均不授予执行权限。
- Agent 先明确交付物与完成标准，再区分已有事实、可观察事实和用户独占取舍，并选择最短可靠能力链；只有下一步 schema 缺失时才装载最小能力集。随机调用、遍历 Tool、重复失败 provider 都不是能力发现机制。
- 这一裁决不引入新的 Capability Registry、Context Compiler、Task Runtime、Workflow 或角色级 Tool 白名单；动态上下文是现有 Owner 的只读 projection。

## D-074 Task Profile 统一知识身份，设计知识按 Stage 渐进装载，参考默认按需

- 状态：已采用；F1/F2 代码接线与核心验证已完成，真实 Provider + Photoshop 设计质量仍待 V1/M6 验证。
- `design-task-types.ts` 是 task type、artifact knowledge、artifact-owner Manifest /兼容 Skill 与 document role 的唯一 crosswalk Owner。Artifact Knowledge 只拥有交付物方法、输入解释和 provenance；Manifest 只拥有结构化生产声明与 Capability 引用；两者不得反向创建任务身份或权限。
- 设计方法和交付物知识作为 `RuntimeContextItem` 进入唯一 `runtime-context-compiler.ts`。结构化运行按当前 Runtime Stage 在每轮模型调用前重新编译；不适用知识不装载。无业务 Skill 运行在合法 Task Profile 声明后也能取得同一带治理记录的基础知识。
- Skill 是受控生产 Overlay，不是 Agent 懂主图、详情页、SKU 或通用设计的前提，也不是唯一方法来源。SKU Template 拥有 artifact-owner Manifest，但不为此新增业务 Executor；它使用通用设计能力、现有原子 Tool 与统一运行约束。
- 首条 `photoshop-craft.editable-single-canvas-composition@1.0.0` 作为现有 Knowledge provider 的版本化记录落地：只为通用单画布、主图与 SKU Template 提供视觉意图到真实 Photoshop Tool 语义、参数来源、保持项和读回方法的候选映射；R3 不装载，R4/R5 可选用。它不是 Recipe Registry、执行计划或成功证明。
- 普通设计参考默认 `reuse_or_optional`：仅在能实质降低设计不确定性时读取项目 /品牌资料、Eagle 或外部来源，离线 /无命中不阻断执行。用户明确要求复刻、指定参考或品牌约束时，相关任务 Contract 可以把它提升为必需输入。
- Knowledge、Reference、Memory 和模型先验均为 data-only；不能覆盖用户当前目标与 ProductTruth，不能证明看过图片，不能授予 Tool /Stage /完成 /Release 权限。

## D-073 DesignEcho 收紧为标准专业视觉设计 Agent，但不新增角色 Runtime 层

- 状态：已采用；产品边界已经由 `Prompt.md` 与 Design Agent OS 定义完成，不存在待实现的 F0 角色合约里程碑。
- 权威身份：DesignEcho Agent 把用户设计目标、有来源事实和真实素材转化为可编辑 Photoshop 设计交付物，通过同目标读回与专业 Evaluation 有界修订，并只依据 Release 事实报告完成、待复核或无法继续。它不是通用助手、任意电脑控制 Agent 或 Photoshop 命令行外壳。
- 产品身份是行为边界，不是生产数据 Owner。不得新增 `standard-design-agent-role-contract`、六任务族枚举、角色级 Intent Router、永久 Tool 白名单、`standard-design-task-contract` 或 `standard-design-outcome`。
- Model 依据完整目标和上下文理解是否属于设计工作；设计知识与 Photoshop 工艺说明可以直接回答，与视觉设计无关的通用代办不进入生产执行。关键词、文件名、Tool 名或本地正则不得抢先接受 /拒绝、选择 Skill 或授予权限。
- 生产责任继续由现有 Owner 分担：Task Profile 表达交付物语义；Capability Session 与 Policy 管理能力 /权限；TaskRun 拥有活动任务；operation result 与 Verification 拥有执行事实；DesignVerdict 拥有质量裁决；Release 与 Delivery 投影结果。需要统一输出时只做只读 projection，不再新建 Contract 链。
- “从零创作”是 Design Kernel 的内在设计能力，不是独立 Task Type、Skill、Executor、Workflow 或通用 WorkMode 路由。代码只表达目标状态、保护关系、执行要求和交付规格；创意判断由模型结合 Kernel、知识、参考与真实观察完成。
- 所有真实设计保持四项职业责任：事实与观察扎根、专业设计判断、可编辑 Photoshop 落地、同目标复核与诚实交付。它们是行为要求，不是固定 Workflow 或逐项状态字段。

## D-072 Harness 采用两车道纵向会合，不再以全量 mutation 迁移作为总阶段墙

- 状态：已采用，按 F1/F2/F3、X1/X2、V0/V1、M5～M7 实施。
- 旧 M3-A → M3-B → M3-C → M3-D 的安全依赖仍适用于每个真实写节点，但不再解释为“全仓所有 legacy mutation 迁移完成后才能启动 TaskRun 或只读 Design Foundation”。
- F 车道只收敛现有 Task Profile / crosswalk、阶段化 Context 与 Photoshop Craft Recipe Knowledge；不选择 Skill、不授予 Tool、不推进 Stage、不形成完成或发布结论，可以与 X1 并行。
- X 车道把现有 RuntimeSession 原地升级为最小 TaskRun，并按当前纵切需要的 capability pack 迁移 TransactionRunner。TaskRun 拥有 plan revision、节点状态、waiting interaction、operation result、document / revision 和单文档写者身份；Runner 拥有单次 mutation 的 modal、取消、commit、unknown readback 与 rollback。
- 语义 R4 不取得 scheduler authority；只对同时满足 TaskRun、叶子 Capability、Tool schema、execution preflight、稳定 target / revision 和 TransactionRunner owner 的真实 Tool call 编译一次性执行信封。未迁移 legacy Tool 不进入该切片；每个切片按实证退役对应 reconciliation、retry、continuation 和 completion 重推断，避免长期双 owner。
- V0 只证明“看准、写准、读回准”；V1 才证明无业务 Skill 的受限真实设计闭环。V1 直接消费同一个 canonical Release Gate owner 的首条实现，不建立临时第二 Gate。
- 依据：Runner 当前仅迁移 5 个 owner，而 UXP `src/` 有 52 个包含 `executeAsModal` 的文件；另一方面同文档并发写已经证明 TaskRun writer ownership 不能继续排在全量迁移之后，且近期只读 Design Foundation 已部分落地。水平全量阶段会同时延迟安全 owner 和设计结果。

## D-071 生产结果、设计质量、交付与用户接受分层

- 状态：已采用，待 M5 完整实施。
- `executionApplied`、`executionVerified`、`designVerdict`、`deliveryReady` 与 `userAccepted` 分别由现有执行、读回、Evaluation、Delivery 和用户动作 owner 产生；任何上层状态不得补造下层事实。
- Tool success 不等于同目标验证，同目标验证不等于设计质量通过，设计质量通过不等于交付齐全，交付齐全不等于用户接受。
- TaskRun / Release Profile 必须显式区分 `mutation_required` 与 `mutation_not_required`；合法只读、建议和分析任务用匹配交付类型的 Observation / Artifact 验证，不被迫制造 Photoshop mutation。
- Release 输出使用 `release_ready / review_required / release_rejected`，不复用 transaction `commit`。硬拒绝只接受带 `blockerKind + proofRef` 的目标 / revision / permission、不可逆动作未批准、确定性事实错误、必需产物缺失或结构损坏；裸 `severity=blocker` 没有发布权威。
- 构图、色彩、排版、对比、工艺、总体观感、VLM coverage 和 `above-baseline` 都属于质量 finding；没有独立的 OCR /结构 /事实 proof 时只能进入 `review_required`。`passed_unverified / needs_review` 不自动返工，`not_applicable` 不能为设计任务提供通过信用，`userAccepted` 始终是正交状态。
- `designVerdict.blockers / scorecard.blockers / designQualityHardBlocked / summary.blockers` 等迁移字段不得由 Runtime、Reflexion、Completion、UI 或 Run Record 在 Gate 前直接消费为硬终止；M5 退出要求旁路消费者为 0。

## D-070 Design Harness 以常驻 Kernel 为底座，Hermes 仅作受审经验机制参考

- 状态：已采用，按 M4～M7 分阶段实施。
- 主图、详情页、SKU 批量 /色卡 /模板与开放式单画布的基本语义属于 Task Semantics / Design Kernel；不依赖业务 Skill 才能理解。Skill 只提供品类、渠道或交付物特有 overlay，不拥有 TaskRun、Tool 权限、PhotoshopTransactionRunner 或 Release Gate。
- Task Semantic Binding 与 Skill 选择分离：前者只保存交付物语义和 Kernel profile 引用，由唯一 Context Compiler 消费；它不装配上下文、不授予权限、不推进阶段，也不得由关键词、文件名或旧路由提示补造。
- Photoshop Craft Recipe 负责把视觉意图、适用条件、参数来源、非破坏性工艺、保持项和结构 /像素验收连接起来；Recipe 是 Knowledge / Kernel provider，不是 Tool 或固定 Workflow。
- 普通自然语言在尚未声明 taskType 时，允许按 Recipe 自身的 `design.generic.v1` applicability marker 注入紧凑通用索引，使 Agent 先拥有品类中立的 Photoshop 工艺知识；该 fallback 不得选择 `design.general` Manifest /Skill、预造交付物、授予 Tool、推进 Stage 或成为完成依据。索引只描述有条件候选工艺和最短选择原则，不能变成逐项试 Tool 的固定流程。
- 任务执行内环与经验演进外环分离。在线运行只完成当前 TaskRun 并最多写隔离候选；设计方法 /Recipe /Skill 收益候选要求真实 operation result、同目标读回、DesignVerdict 与相应 Delivery /人工反馈，失败或中止运行只能生成缺陷、负向 finding 或 Evaluation-gap 候选，不能证明方法收益。
- Task Semantic Binding 只作语义身份一致性校验，不激活 Skill；Capability / Skill 激活继续由结构化 R0 选择、当前 stage、Capability / Policy owner 与模型在合法候选内的判断共同决定，不能只让模型看短描述后独自选择。
- 借鉴 Hermes 的渐进加载、事实 /程序分离、Patch 优先、来源与生命周期、归档和回滚；不采用调用计数即学习、纯 LLM 自评、任何在线路径直接改 canonical Skill、usage 等同质量或平面 Memory 充当项目 /PSD 真相源。
- 当前用户指令和真实项目 /Photoshop 状态永远高于历史 Memory；M7 前不启用生产经验自动化，M7 内只实施受审候选与人工生命周期，更进一步的自动优化在 M7 退出后另行决策。
- 外部依据（2026-08-01 核对）：[Hermes Agent 主仓](https://github.com/NousResearch/hermes-agent)提供在线记忆 /Skill 管理机制；[Hermes Agent Self-Evolution](https://github.com/NousResearch/hermes-agent-self-evolution)是独立离线演进仓库，不能把后者的目标能力写成主仓或 DesignEcho 已实现事实。

## D-068 RuntimeSession 原地演进为单一 TaskRun

- 状态：已采用；TaskRun reducer 与 Agent /交互恢复生产接线已完成代码和核心验证，V0 capability pack 与真实并发 /恢复验证仍在实施中。
- TaskRun 唯一拥有任务身份、plan revision、节点状态、目标、交互等待、operation result、复核和终态；不创建第三 Runtime、第二 Task Store、第二 DAG 或第二 Verdict。
- Photoshop mutation 的 TaskRun snapshot 必须固化 document /revision，并成为单文档并发写者身份 owner；同一文档被其它 TaskRun 或外部操作改动时，只能重新观察、等待、显式接管或终止，不能依赖活动文档、自动切换目标或重放旧写入。
- `waiting_user` 是非终态，恢复必须绑定 `taskRunId / interactionId / expectedRevision`。

## D-069 彻底退役 smoke 验证体系

- 状态：已采用，已完成。
- 后续不再新增、维护或依赖 `smoke-*` 脚本；“某个功能没有 smoke”不是新增一次性测试的理由。
- smoke 在本项目规模下造成脚本和 package 命令膨胀，容易出现重复断言、假绿通过和验证债务，最终增加 BUG 风险。
- 默认质量依据改为构建、类型检查、静态审计、规划/仓库卫生检查和可复用的真实功能测试；验证失败必须保留真实失败，不得删断言或吞错。
- 旧 smoke 文件、package 命令和分层调度器在本次迁移中删除；包含额外乱码/卫生护栏的旧历史实现暂不从磁盘删除，但不被任何活动命令调用，历史细节由 Git 保留，不建立新测试框架替代它。

## D-067 第四设计 Skill 采用通用单画布能力

- 状态：已采用。
- 海报是 canary，不创建固定 poster 流程、关键词路由或专用 Agent 核心；Skill 只提供 overlay。

## D-066 R1 语义由模型声明，精确来源由 Harness 绑定

- 状态：已采用。
- 模型只声明 inputKey / status；Harness 绑定真实来源。没有来源的 provided 必须失败关闭。

## D-065 人工落盘与 Agent 承接分开幂等

- 状态：已采用。
- 确认卡不能通过重新发送自然语言创建新任务；内部承接必须绑定来源运行和结构化 Runtime identity。

## D-064 业务 card.id 与渲染实例身份分离

- 状态：已采用。
- 内容定义 id 用于 stale 校验，重复提交使用 source message / block / card 的渲染实例键。

## D-063 Provider 截断续跑保留原生 Assistant 回合

- 状态：已采用。
- 保留 content、tool calls 和 reasoning；禁止发送 role-only assistant 历史或重放 Photoshop 写入。

## D-062 设计首轮只加载最小执行供给

- 状态：已采用。
- R4 只投影计划 schema，E1 才执行；视觉复核必须消费实际图像和同一 revision。

## D-061 复核卡安全让出，来源精确承接

- 状态：已采用。
- 通用 continuation 不拥有业务写入；恢复通过精确来源和结构化 owner 完成。

## D-060 破坏性确认与普通续跑分离

- 状态：已采用。
- 不可逆动作保留真实审批；可撤销且目标明确的 Photoshop 操作不以无必要确认替代执行。

## D-059 缺输入时开放“可自行取得”的只读路径

- 状态：已采用。
- 不把 Harness 缺失的环境事实推回用户；只有真实歧义、不可取得的用户独占信息或不可逆边界才等待。

## D-057 瞬时读取失败保持中性

- 状态：已采用。
- “没有打开的文档”等结论必须来自结构化证据；瞬时失败可重试，不能被写成确定性否定。

## D-054 Artifact 由主进程 Repository 发布

- 状态：已采用。
- Renderer 只能提交受限收尾声明；Project State、Runtime Snapshot 和 Run Record 不复制 Artifact 正文。
