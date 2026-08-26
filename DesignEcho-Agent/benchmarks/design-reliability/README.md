# Design Reliability 基准

> 文档类型：开发评测操作手册。
> 权威范围：主图、详情页、SKU 的固定案例、运行证据、人工评审、失败归因与同案例版本对比。
> 不能覆盖：`project-memory/Prompt.md` 的 Agent / Harness / Skill owner 边界、生产 Runtime、Tool 权限、Skill 路由、任务完成判定或用户当前指令。

## 为什么需要这套基准

单条 Run Record 只能回答“这一轮发生了什么”，不能回答“某次治理是否提高了总体成功率”。一个完整 SKU 任务还可能跨越首次执行、确认卡、同一 TaskRun 续跑和复核；按消息轮次统计会同时制造假失败与重复样本。

本基准固定采用以下链路：

```text
Case（测什么）
→ TaskRun Run Observation（真实发生了什么）
→ Human Review（作品是否达到商业可用水平）
→ Attribution（问题为什么发生）
→ Cohort Report（同一组 Case 上是否真的改善）
→ Regression（失败案例长期保留）
```

五类记录通过 ID 引用连接，彼此不改写：

- `Case`：固定自然用户请求、Agent 可见输入、人工评审参考、交付要求和禁区。
- `Run Observation`：从一条或多条同 TaskRun 的 `agent-run-record/v0` 提取机器事实。
- `Human Review`：设计师基于真实结果截图、PSD 和参考进行评分；审美结论不由 Harness 生成。
- `Attribution`：工程人员把症状归因给 Agent、Harness、Skill、Tool、Provider、Photoshop 环境等 owner；默认只能是 hypothesis。
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

主图、详情页、SKU 分开统计。纯分析、寒暄、素材查询和没有固定 Case 身份的历史 Run 不进入正式成功率分母。

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
不再承担正式分母。真实输入原目录保持只读，Photoshop 只操作一次性 fixture 副本。

## 命令

```bash
# 校验固定 Case、rubric 与边界；已并入核心维护验证
npm run maintenance:design-reliability:validate

# 查看固定案例、真实运行、人工评审和失败归因的当前覆盖度
npm run maintenance:design-reliability:status

# 默认零落盘地只读检查 Debug Bridge、Photoshop MCP 与本地 fixture 是否具备实机条件；
# 需要保留报告时显式追加 --write-report，不再覆盖 latest.json
npm run maintenance:design-reliability:preflight

# fixture 已准备好时，用这个闸门判断能否安全开始下一次 Case；它不要求历史三 Skill 已经全部通过
npm run maintenance:design-reliability:require-capture-ready -- --case <case-id> --fixture-root <一次性目录> --provider <provider-id> --model <configured-model-id>

# 只有需要三类 Skill 都具备真实完整证据时才使用；未执行绝不会被算成通过
npm run maintenance:business-skills-live-e2e:require-live
```

正式 Case 推荐使用隔离 Debug userData，并在启动时冻结已配置的模型 ID；`--model` 只改复制出来的
临时状态，不改用户正常 DesignEcho 配置，也不会输出 Provider 凭据：

```bash
node scripts/launch-chat-ui-debug-window.cjs --port auto --use-default-runtime-ports --seed-user-state --model codex-subscription-gpt-5-6-sol --project <一次性目录>
```

`preflight` 会从 Renderer 实时读回脱敏的 provider、内部 model ID、API model ID、项目和 busy 状态；
不匹配会在 Attempt `armed` 之前阻止 `run-live`，不会先写入 Photoshop 再报告模型用错。

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

具体录制、评审和归因参数使用：

```bash
node scripts/design-reliability.cjs --help
```

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
- `sku-c1163-v1`：一句自然请求，把六张已完成的颜色源卡作为源素材完成 2/3/4 双组合；不得把源卡当“待设计模板”覆盖。

四个 Case 的用户成稿与 Eagle 参考只供盲评，不进入 Agent 项目。C-1163 是已知基线，“粉咖微压直板”是首个 unseen/generalization Case；这仍不代表全部设计泛化能力。
