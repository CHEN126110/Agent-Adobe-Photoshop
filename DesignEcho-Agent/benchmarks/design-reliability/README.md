# Design Reliability 基准

> 文档类型：开发评测操作手册。
> 权威范围：主图、详情页、SKU 与参考复刻的固定案例、Attempt、运行证据、人工评审、失败归因与同案例版本对比。
> 不能覆盖：`project-memory/Prompt.md` 的 Agent / Harness / Skill owner 边界、生产 Runtime、Tool 权限、Skill 路由、任务完成判定或用户当前指令。

## 为什么需要这套基准

单条 Run Record 只能回答“这一轮发生了什么”，不能回答“某次治理是否提高了总体成功率”。一个完整 SKU 任务还可能跨越首次执行、确认卡、同一 TaskRun 续跑和复核；按消息轮次统计会同时制造假失败与重复样本。

本基准固定采用以下链路：

```text
Case（测什么）
→ Attempt（一次真实提交及其安全终态）
→ TaskRun Run Observation（有完整运行证据时，真实发生了什么）
→ Human Review（作品是否达到商业可用水平）
→ Attribution（问题为什么发生）
→ Cohort Report（同一组 Case 上是否真的改善）
→ Regression（失败案例长期保留）
```

五类记录通过 ID 引用连接，彼此不改写：

- `Case`：固定自然用户请求、Agent 可见输入、人工评审参考、交付要求和禁区。
- `Run Observation`：从一条或多条同 TaskRun 的 `agent-run-record/v0` 提取机器事实。
- `Human Review`：设计师基于真实结果截图、PSD 和参考进行评分；审美结论不由 Harness 生成。
- `Attribution`：工程人员把症状归因给 Agent、Harness、Skill、Tool、Provider、Photoshop 环境等 owner；可绑定 Run Observation，也可绑定已经提交但尚未形成 Run Observation 的 Attempt；默认只能是 hypothesis。
- `Cohort Report`：在相同 Case 集、相同 rubric 下统计分母、覆盖率、中位数和 P90。

## 成功口径

“Tool 返回 success”不等于设计成功。一个完整成功样本至少同时满足：

1. 实际绑定了目标 Skill；
2. Photoshop history transition 或 mutation commit 证明发生过真实写入；
3. 最后一次写入后有同任务的结构读回与视觉读回；
4. 可编辑 PSD 与栅格导出文件真实存在并记录 hash，且只把 Agent delivery receipt 明确声明的文件作为最终交付；
5. TaskRun 进入终态，没有未解决 blocker；
6. 人工评审认为无需推倒重做；
7. 没有错文档、覆盖源稿、跨 revision 写入或假完成。

主图、详情页、SKU 与参考复刻分开统计。纯分析、寒暄、素材查询和没有固定 Case 身份的历史 Run 不进入正式成功率分母。

## 质量优先级

当前阶段先证明“做得好”，再优化速度：

- 硬红线：错文档、覆盖原稿、跨 revision 写入、假完成均为 0。
- 第一阶段目标：技术交付率至少 80%；人工判断“无需推倒重做”至少 70%；完成样本的最终结构/视觉读回与 PSD/导出证据均为 100%。
- 效率先记录但不作为质量门禁：首次真实写入、首稿、总耗时、模型调用、Tool 调用、修订轮数、用户介入次数。
- 质量稳定以后，再以同 Case 的候选版本对基线版本做配对比较；不同 Case 集的平均分禁止直接比较。

## 数据边界

所有 `caseId`、`cohortId`、Git / build / model 实验身份、固定答案、评分、评审者、归因和聚合指标都只属于开发评测侧，禁止进入：

- 生产 Runtime / TaskRun / Project State；
- Agent Prompt、Skill 选择或 Tool 能力裁剪；
- Photoshop 写权限或完成判定；
- Design Learning 的自动晋升；
- 用户界面中的“已完成”声明。

记录中不得保存原始 Tool arguments/result、完整模型 transcript、图片 base64、API Key、Authorization 或用户本机绝对路径。图片、PSD 和导出文件只保存相对引用与 SHA-256。

## Fixture 隔离

`cases/` 中只保存相对于一个本地 source fixture 的路径，不保存 `D:\...` 等绝对路径。准备测试目录时只复制 `agentVisibleInputs`；`reviewOnlyReferences`（用户成稿与 Eagle 参考）绝不能复制进 Agent 可见项目，否则 Agent 可能把成稿当模板或直接复用，测试失去意义。

当摄影图或 GBK 配置本身不足以表达商品事实、颜色编号等业务输入时，Case 可用
`fixtureGeneratedInputs` 写入一份冻结的 UTF-8 结构化事实说明。商品 claim 必须逐项带受控
provenance，禁止 claim、商品类型、颜色或映射字段夹带选图、构图、字号、配色、版式答案或本机路径；
准备脚本只把它写入一次性 fixture，不反写用户源项目。Fixture 中任何 symlink / junction 都会使
本次样本失效，避免扫描跳过的链接把外部文件带入评测。

正式 Attempt 安全账本、fixture 身份、Run、Review 与 Attribution 默认写入应用的仓库外持久目录
`<userData>/design-reliability/`（Windows 通常是 `%APPDATA%/designecho-agent/design-reliability/`），
不进入 Git，也不会被 `maintenance:repo-hygiene` 清除。仓库内旧 `tmp/design-reliability/` 只作历史报告兼容读取，
不再承担正式分母。真实输入原目录保持只读，Photoshop 只操作一次性 fixture 副本。DesignEcho 打开一次性项目后正常生成的
`.designecho/project.json` 作为 Workspace metadata 单独校验：只有当前 `ProjectConfig` 的精确字段、枚举、
规范时间和与 fixture realpath 完全一致的项目身份才允许存在，并且它不进入冻结输入摘要。其它
`.designecho/*`、历史 Run、Design Project State、旧 PSD 或旧导出仍会使 fixture 失效；绝不忽略整个目录。
其中 `folderMappings`、`imageClassifications` 与 `designPlan` 还会形成独立的
`workspaceSemanticDigest`：时间戳变化不制造新样本，语义状态变化必须改变 Attempt 身份。正式提交会把该摘要
带到 Debug Bridge，并由 `getProjectContext` 在构建 Agent 实际消费的上下文前后复核，最终把同一摘要写入完成收据；
不能用 `handleSend` 前的一次旁路读取或事后 Run 中补写旧摘要冒充真实上下文已经绑定。

正式 live 运行的质量优先预算由 Suite 固定为 900000ms。命令行只能显式重复同一个值，不能临时缩短或
放宽后仍混进同一 cohort；该 timeout 会进入 cohort fingerprint。

## 命令

```bash
# 校验固定 Case、rubric 与边界；已并入核心维护验证
npm run maintenance:design-reliability:validate

# 查看固定案例、真实运行、人工评审和失败归因的当前覆盖度
npm run maintenance:design-reliability:status

# 同一 Case / Rubric / fixture / Provider /模型 /timeout 条件下比较前后 cohort
node scripts/design-reliability.cjs compare --baseline-cohort <baseline> --candidate-cohort <candidate>

# 默认零落盘地只读检查 Debug Bridge、Photoshop MCP 与本地 fixture 是否具备实机条件；
# 需要保留报告时显式追加 --write-report，不再覆盖 latest.json
npm run maintenance:design-reliability:preflight

# fixture 已准备好时，用这个闸门判断能否安全开始下一次 Case；它不要求历史三 Skill 已经全部通过
npm run maintenance:design-reliability:require-capture-ready -- --case <case-id> --fixture-root <一次性目录> --provider <provider-id> --model <configured-model-id>

# 只有需要当前全部 active Case 任务族都具备真实完整证据时才使用；未执行绝不会被算成通过
npm run maintenance:business-skills-live-e2e:require-live
```

正式 Case 推荐使用隔离 Debug userData，并在启动时冻结已配置的模型 ID；`--model` 只改复制出来的
临时状态，不改用户正常 DesignEcho 配置，也不会输出 Provider 凭据：

```bash
node scripts/launch-chat-ui-debug-window.cjs --port auto --use-default-runtime-ports --seed-user-state --reuse-codex-subscription-session --model codex-subscription-gpt-5-6-sol --project <一次性目录>
```

`--reuse-codex-subscription-session` 只允许用于已经停止普通 DesignEcho Runtime 的隔离实机窗口：
Renderer 项目、对话和偏好仍位于 OS Temp，订阅模型则直接使用正常 DesignEcho 已有的安全会话目录，
不会复制、输出或写入明文凭据。隔离 seed 会保留经过字段白名单清洗的设计尺寸，避免固定 Case
在 1440×1440 预期下退回 800×800 默认值。

`preflight` 会从 Renderer 实时读回脱敏的 provider、内部 model ID、API model ID、项目和 busy 状态；
不匹配会在 Attempt `armed` 之前阻止 `run-live`，不会先写入 Photoshop 再报告模型用错。
正式运行前的 `maintenance:photoshop-uxp-plugin:load:check` 会按 UXP Developer Tools 的
plugin session 身份先卸载当前同 ID 实例、再从当前 checkout 加载并核对 live build identity；
不能把“load 命令返回成功”误当成 Photoshop 已经换到新代码。

当套件包含多个独立输入源时，准备或检查 fixture 必须显式指定 `--case` 或 `--fixture-id`，避免把两个商品目录混成一个测试项目。
如果同一个 `fixtureId` 被主图、详情页、SKU 等多个 Case 共用，`prepare-fixture` 必须使用
单个 `--case`：正式 live 会按 Case 检查零额外文件，联合目录既会污染输入边界，也无法形成可用样本。

严格人工评审中的比较证据不能由评审者自由写标记：候选必须同时属于当前 Run 的已验证
`raster_export` 和 Agent 声明的 `finalArtifactManifest`，用户成稿和 Eagle 条目必须逐项来自当前 Case 的
`reviewOnlyReferences`，并匹配 Case revision 冻结的 SHA-256。格式正确但内容摘要不属于当前 Run / Case 的文件会被拒绝。
不同比较证据不能复用同一内容，参考锚点也不能指向候选成稿。`record-review` 仍只产生
`bound_self_reported` 诊断评审，不能靠自报的 `blindedToCandidateOrigin` 进入正式成功率。
正式评审必须先用 `prepare-review-packet` 生成随机匿名公开包与物理分离的 sealed mapping，再由另一位评审者
完成全部匿名项评分和全部无序 pair；`record-anonymous-review` 会重算包、映射、响应和所有资产哈希，只有完整
canonical verification bundle 才能让 `anonymous_packet_verified` 进入 strict 指标。持久化 Review 中的
`verifiedPacketProof` 只是可审计索引，不能自行授予 strict 身份；每次 `status` 都会从私有 bundle 磁盘回读并重新验证。
Review v2 同时绑定 Rubric 内容摘要；Cohort 只有在 Case、
Rubric 与 fixture 摘要一致时才能比较。旧 v1 评审保留为历史诊断证据，但不会按新协议冒充正式样本。
同一个 reviewer 对同一个 Run 重复提交会成为评审冲突，不能通过重复高分或低分改变 Run 级中位数。
审美指标先按 Run 聚合，再按 cohort 聚合；每个 Case 达到 Suite 发布门槛推导出的最低可评分成稿数之前，
只能输出 survivor diagnostic，不能声明正式 `designQualityComparable`。技术失败率仍以全部 submitted Attempt 为分母。

具体录制、评审和归因参数使用：

```bash
node scripts/design-reliability.cjs --help
```

归因必须且只能选择一个对象：`--run-observation <run.json>` 或 `--attempt-id <attempt-id>`。后者只接受
canonical Attempt 账本中属于当前 Suite、已经真实提交并形成唯一终态的身份；不会新建第二套失败库。

匿名评审的 `source-bindings.json` 是开发侧一次性绑定文件，格式为：

```json
[
  { "evidenceRef": "candidate:主图/成稿.jpg@sha256:<Run冻结摘要>", "sourcePath": "<候选成稿绝对路径>" },
  { "evidenceRef": "user-design:主图/800/800-1.jpg@sha256:<Case冻结摘要>", "sourcePath": "<用户成稿绝对路径>" },
  { "evidenceRef": "eagle:item:<item-id>@sha256:<Case冻结摘要>", "sourcePath": "<Eagle 条目文件绝对路径>" }
]
```

随后执行：

```bash
node scripts/design-reliability.cjs prepare-review-packet --case <case-id> --run-observation <run.json> --reviewer-packet-dir <公开包目录> --source-bindings-json <bindings.json> --allow-create
node scripts/design-reliability.cjs record-anonymous-review --case <case-id> --run-observation <run.json> --packet-id <prepare返回的packetId> --reviewer-packet-dir <公开包目录> --reviewer-response <评审响应.json>
```

公开包可以交给评审者；sealed mapping 由 CLI 按 packetId 自动保存到 owner-only 的 canonical 私有目录，
不会返回或打印路径，bindings 与原始路径也不得交给评审者。所有公开图片先真解码、应用方向并统一重编码为
无源元数据的 sRGB PNG；即使候选有多张输出，也会与锚点一样拆成单文件匿名项，避免通过组大小、扩展名或
EXIF/XMP/Photoshop 导出信息泄漏来源。`--data-root` 与旧 tmp 中自造的 proof 只能作为诊断记录，不能进入 strict。

## 当前固定案例

- `main-image-c1163-v1`：一句自然请求，从多个摄影素材中自主选择并制作 800×800 商品主图。
- `main-image-pink-coffee-unseen-v1`：用户新提供的“粉咖微压直板（加厚款木耳边）”完整 JPG 摄影目录；同时包含处理成片与相机原图，用来验证去重、选图、构图和跨商品迁移，不包含任何完成设计稿。
- `detail-page-c1163-v1`：一句自然请求，基于同一商品素材完成多屏详情页。
- `sku-c1163-v1`：自主零纠错质量 Case；权威 CSV 与颜色映射完整提供，把六张已完成颜色源卡制作成 2/3/4 双组合，不需要再弹确认卡。
- `reference-replication-c1163-from-c1164-v1`：把 C-1164 的跨商品用户主图作为 Agent 可见视觉方向，用 C-1163 摄影素材重新设计；同商品用户成稿和 Eagle 品类图只供匿名盲评。

除 reference-replication Case 明确声明的一张跨商品目标参考外，其余用户成稿与 Eagle 参考只供盲评，不进入 Agent 项目。C-1163 是已知基线，“粉咖微压直板”是首个 unseen/generalization Case；这仍不代表全部设计泛化能力。

## 参考复刻归属

统一契约已经支持 `taskFamily=reference_replication`。这类 Case 必须把用户明确交给 Agent 的目标参考放在
`task.agentVisibleReferences`，准备 fixture 时复制并核对冻结 SHA-256；只供最终盲评的用户成稿或 Eagle
锚点继续放在 `task.reviewOnlyReferences`。两者出现相同 ref 或相同内容摘要时 Case 直接失效，避免把答案
泄漏给 Agent。

目标参考不能只以路径 marker 进入对话。Debug Bridge 的 Main 进程会在项目 realpath 内重新读取源文件、
核对源 SHA-256、真实解码、应用方向并规范化为有界 sRGB JPEG；这些不可变像素按原顺序进入同一个当前用户
消息的视觉块。Renderer 只在 Debug `handleSend` Promise 生命周期内持有 Main 签发的临时传输租约；它不进入
Agent Context、Prompt、TaskRun 或业务状态。Main 重新核对租约、binding 与实际消息像素，Provider 成功返回且
出站视觉回执 /序列化请求仍匹配后才签发 binding receipt；Renderer 同名字段会被丢弃。评测还要求该收据的
`committedAt` 不晚于首次 Photoshop mutation 基线，避免设计完成后才补看参考。原样回显路径、digest、入站图片
或 UI 自签收据均不能证明模型在设计前看过参考。

人工评审中的目标参考属于明确标注的 `target_reference_context`，用于解释用户要求；候选成稿、同商品用户成稿
和 Eagle 质量锚点仍在独立匿名组中随机化。目标参考不参与“候选与商业质量锚点”的 pairwise，避免把“是否读懂
用户方向”和“是否达到同品类专业水平”混成一个分数。

当前首条 active 真实 Case 是 `reference-replication-c1163-from-c1164-v1`。它已经冻结一张跨商品目标参考、
八张待设计商品摄影图、同商品隐藏用户成稿和一个 Eagle 品类锚点；只能证明这一条跨商品主图迁移基线，
在完成至少五次正式 Attempt 与严格盲评前仍没有可用成功率。旧 `benchmarks/reference-replication/` 只保留
合成几何、像素探针和历史机制材料，不再承担 live Attempt、商业质量或发布结论。

## SKU 交互协议 Case

`sku-c1163-interaction-v1` 已作为 `draft` 接入同一 Case schema，但在 dev user actor 与交互收据完成前不会
进入正式分母。它不向初始 Agent Context 提供组合 CSV，也不在公开 Case 中保存规格、组合、答案派生数量、
语义输出文件名或盲评锚点。公开协议只绑定一个高熵、不可变的私有评测 manifest 身份；该 manifest 将同时拥有
预声明用户答案、所需规格、预期输出、评审 source binding 和 actor 协议，不能再维护相互可能漂移的“答案绑定”
与“输出绑定”。未来只有真实 `sku-batch` Provider 卡出现后，评测 actor 才能解析私有 manifest、核对卡片 owner、
TaskRun、决定 /候选指纹与稳定颜色来源身份，再经 Provider 提交并沿现有同一 TaskRun continuation 恢复。
私有 manifest 的答案必须与公开自主 Case / CSV 不同，且 Agent 的文件或命令能力必须被限制在一次性 fixture；
否则“隐藏文件路径”无法阻止同一用户身份下运行的 Agent 读取答案。

Actor capability 不是登记一个名字就算接入。注册项必须提供一个实际执行并验证完整协议的 `dispatchProtocol`；
`run-live` 不再接受“执行函数 + 若干可为空的验证 hook”拼成能力。当前只注册自主零纠错 dispatcher，交互 Case
即使被误改为 active 也会在 fixture / Photoshop 前失败关闭；只有私有 manifest 解析、Provider 交互收据验证、
同一 TaskRun 恢复与介入指标派生形成一个可验证 dispatcher 后才能激活。SKU 专属卡的每个颜色槽位同时携带
Provider 从真实 Photoshop 文档与图层组派生的 `colorIdentity`；展示标签可以修正“身肤 / 深肤”等文案，但不能
改变素材身份，候选指纹会覆盖该身份，不能再只靠 1、2、3 槽位序号猜颜色。当前身份可靠绑定本次打开期间的
`documentId + historyStateId + layerId + layerPath`，但还不是跨关闭 /重开的源 PSD 内容 SHA-256 血缘；在该血缘
以及私有 actor 完成前，本 Case 继续保持 draft。通用卡片的来源卡、提交、continuation 与持久操作绑定也统一使用
版本化 canonical SHA-256；旧 32 位快速哈希只允许用于 UI/cache，旧弱指纹操作明确拒绝恢复。

自主 Case 与交互 Case 不能混算：前者信息完整，弹卡即失败；后者允许必要业务确认，但该确认只计
`protocolInteractionCount`，不计 `userDesignCorrectionCount`。当前 Debug 协议还没有这两类真实收据，因此
live Run 的介入指标保持 unknown，不能用硬编码 0 通过发布门槛。
