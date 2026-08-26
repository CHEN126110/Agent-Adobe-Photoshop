# Agent + Harness 成功率评测闭环

> 文档类型：方法说明。真实 Case、Rubric、命令和数据边界以
> `benchmarks/design-reliability/README.md`、`benchmarks/design-reliability/suites.manifest.json`
> 与 `scripts/design-reliability.cjs` 为唯一操作真相源。本文件不建立第二套评测 Runtime。

## 目标

低预期是先让 `main-image-design`、详情页和 SKU 三类 Skill 在固定摄影输入上稳定完成真实 Photoshop 交付，视觉结果与 Eagle 参考及本地用户作品中对应人工成稿处于可比较的商业水平。真实素材根目录由本地 Fixture 参数提供，公开文档不记录用户机器绝对路径。

高预期不是多写几个固定流程，而是让 Agent 逐步表现出成熟设计师的判断：能理解商品与交付物目的，比较素材和参考，形成方向，发现诸如字号、层级、裁切、比例、留白、光影或元素必要性等真实问题，并自主完成有界修订。Harness 只保证上下文、事实、工具、目标、收据、预算和评价输入可靠，不替 Agent 写审美答案。

## 为什么不能继续按截图逐个修

端到端成功率是多段链路共同作用的结果：

```text
任务理解
→ 项目与 Photoshop 事实扎根
→ Skill / Capability 可达
→ 素材观察与选择
→ 设计策略
→ Photoshop 写入
→ 同目标读回
→ 保存与导出
→ 视觉评价
→ 诚实完成
```

只修最后一次截图里最显眼的问题，会混淆 Agent 判断、Harness 控制、Skill 知识、Tool 实现、Provider 和 Photoshop 环境的责任，也无法证明总体成功率提高。因此正式调试必须采用固定 Case 回放和同 Case 对比。

## 唯一闭环

```text
Case
→ 隔离 Fixture
→ Live Run
→ Run Observation
→ Human Review
→ Attribution
→ Cohort Report
→ Regression
```

各对象职责如下：

- `Case` 固定自然用户请求、Agent 可见输入、只供评审的参考、交付证据和禁止行为。
- `Fixture` 只复制 Agent 可见摄影输入；人工成稿和 Eagle 参考不得混入项目。
- `Live Run` 必须经当前 DesignEcho Agent → Provider → Photoshop 真实链执行，开发脚本不代替 Agent 设计。
- `Run Observation` 从同一 TaskRun 的 Run Record 链提取 Skill 绑定、真实 mutation、读回、交付、错误和耗时事实。
- `Human Review` 由人基于成品、PSD、用户作品和 Eagle 参考判断 `pass / needs_fix / unscorable`；Harness 不生成审美真相。
- `Attribution` 将已观察症状标记为 `hypothesis / confirmed / rejected`，并绑定证据；未证实原因不得写成结论。
- `Cohort Report` 只比较相同 Case、Rubric、重复次数和实验身份下的结果。
- `Regression` 保留失败 Case；修复后重跑同一输入，而不是换一个更容易的例子。

## 当前固定套件

当前 `business-skills-quality-v1` 只包含四个可审计 Case：

- `main-image-c1163-v1`：已知商品主图基线。
- `main-image-pink-coffee-unseen-v1`：用户提供的“粉咖微压直板（加厚款木耳边）”未见摄影目录，用于验证跨商品选图与主图设计。
- `detail-page-c1163-v1`：同商品多屏详情页。
- `sku-c1163-v1`：以已经完成的颜色源卡制作 2 / 3 / 4 双组合，验证不会把完成色卡当成待设计模板。

这四个 Case 只能证明当前窄基线，不能证明“已经具备专业设计师的全场景能力”。套件要求每个任务族至少五次正式运行；样本不足时状态必须显示“正式成功率不可用”。

## 成功判据

技术交付与审美可用必须分开统计。完整成功至少满足：

1. 正确绑定目标 Skill / Runtime 任务身份；
2. Photoshop Host 收据证明真实写入；
3. 最后一次写入后取得同目标结构和视觉读回；
4. 可编辑 PSD 与栅格导出真实存在并有证据；
5. 没有未解决 blocker、错文档、覆盖源稿、跨 revision 写入或假完成；
6. 人工评审认为无需推倒重做。

当前质量优先门槛由 Suite Manifest 固定：技术交付率至少 80%，人工可用率至少 70%，完成样本的读回与产物证据覆盖率 100%，假完成率和错文档 /覆盖源稿次数为 0。速度先记录，不先充当质量门禁。

## 失败归因

每个失败可以有多个症状，但每条确认归因必须使用现有受控 owner 与 failure mode，并附证据：

- Owner：`case_fixture`、`model_judgment`、`harness_context`、`harness_control`、`skill`、`tool_contract`、`tool_implementation`、`photoshop_environment`、`model_provider`、`evaluation`、`user_input`、`unknown`。
- Failure mode：`task_understanding`、`fact_grounding`、`reference_grounding`、`asset_selection`、`design_strategy`、`geometry`、`execution`、`readback`、`recovery`、`interaction`、`delivery`、`provider`、`measurement`、`unknown`。

例如“没有产出图片”不是根因；它可能分别来自 Provider 停滞、Harness 误拦、Skill 不可达、Photoshop 写失败或 Agent 没有选择动作。只有 Run Record、Provider 日志、Host 收据、图像与代码链能把 hypothesis 晋升为 confirmed。

## 每一刀的执行纪律

1. 先选固定 Case 和 cohort，记录当前基线，不以历史散乱 Run 充当当前 HEAD 的严格基线。
2. 一次治理批次只声明一个主要因果变量，同时保留替代解释、证伪条件和回滚点。
3. 修复后先跑核心静态 /行为回归，再对同一 Fixture、同一句自然请求做 Live Run。
4. 机器证据通过后再做人工作品对照；没有 PSD/JPG 时不评价审美，没有人工 Review 时不声称商业质量达标。
5. 将失败原因作为 attribution 记录，而不是在本次运行中不断追加未经排序的补丁。
6. 用 cohort 报告比较“技术交付、人工可用、假完成、读回覆盖、首次写入、总耗时、模型 /Tool 调用和用户介入”的变化。
7. 只有同 Case 多次结果稳定，才把结论推广到新的商品或新的设计任务。

## 命令

```bash
# 校验 Case、Rubric、digest 与开发/生产边界
npm run maintenance:design-reliability:validate

# 查看 Case、Run、Review、Attribution 和 cohort 覆盖
npm run maintenance:design-reliability:status

# 只读检查 Debug Bridge、Photoshop MCP 和 fixture
npm run maintenance:design-reliability:preflight

# 完整参数与录制方式
node scripts/design-reliability.cjs --help
```

真实输入目录、Run Record、人工成稿和 Eagle 参考都保持各自 owner。所有 sidecar 默认写入 `tmp/design-reliability/`，append-only，不反写生产 Runtime、Prompt、Skill、Project State、Tool 权限或完成判定。
