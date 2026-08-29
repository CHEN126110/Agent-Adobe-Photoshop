# 电商单画布设计知识候选研究包（D-100）

- 文档类型：D 层研究参考 / 未发布知识候选
- 是否能直接指导当前开发：不能。只有 `project-memory/CurrentTask.md` 明确激活后，才可据此建立单变量实现切片
- 适用范围：电商单画布的信息层级、商品素材融合、中文标题排印和列表缩略图识别
- 不能覆盖：`AGENTS.md`、`project-memory/Prompt.md`、当前任务卡、Design Agent OS、现有 TaskRun / Capability / Evaluation / Experience Publisher / PhotoshopTransactionRunner owner
- 生命周期：`candidate`；未经过同模型、同预算、固定未见 Case 的盲化 A/B，生产 Prompt、正式 Knowledge、Craft Recipe、Skill 和 Evaluation 均不得消费
- 建立日期：2026-08-29

## 1. 研究裁决

现有 DesignEcho 并不缺“层级、缩略图、素材观察、构图、排版”这些概念。`design-method-knowledge.ts`、`design-artifact-knowledge.ts`、`photoshop-craft-recipes.ts` 和 `design-quality-assertion.ts` 已经覆盖大部分通用判断。继续补写“大标题、主体要大、留白舒服、配色统一”只会增加重复上下文，不能解释 r32 的具体失败。

本轮只保留三条有新增信息且可证伪的候选：

1. 中文多行标题必须遵守真实断行与标点关系，不能只看文本框没有溢出。
2. 商品照片进入画面前，Agent 必须选择“直接摄影 / 明确容器 / 无缝合成”中的表达模式；无缝合成才要求光向、影向、透视、尺度与色温统一，无法统一时应诚实使用容器关系，而不是制造半融合贴图。
3. 当任务明确指向某个颜色或变体时，列表缩略图中的目标变体必须可立即辨认；支持色系可以出现，但不能把家族展示冒充目标变体主图。

其它已存在且来源能够支持的内容只登记为“现有实现足够”，不重复进入生产知识。

## 2. 来源分级

| 类型 | 含义 | 能否直接变成生产规则 |
|---|---|---|
| `standard` | 正式标准或标准化组织的规范性要求 | 只在适用渠道与对象上进入确定性检查；仍需真实可观测输入 |
| `standards_note` | 标准化组织发布的需求说明或工作组 Note | 可作为强依据，但必须保留地域、书写方向与文档状态限制 |
| `research_fact` | 有公开研究方法或用户测试支持的行为事实 | 可形成业务启发，不能无条件外推到所有渠道 |
| `vendor_guidance` | 工具、平台或设计系统的官方实践 | 可迁移机制，不复制品牌 token 或产品专属数值 |
| `heuristic` | 由多条来源和项目案例推导的可撤销设计判断 | 必须经过固定 Case 盲化 A/B 才能发布 |
| `project_preference` | 用户成稿、项目方法论或明确反馈体现的项目取舍 | 只作用于相应项目/品牌，不升级为跨项目真理 |
| `case_observation` | 一次具体运行或作品的观察 | 只用于提出假设，不能单独发布知识 |

## 3. 可追溯来源

### S-01 W3C 中文排版需求

- 类型：`standards_note`
- 来源：[Requirements for Chinese Text Layout](https://www.w3.org/TR/clreq/)
- 当前状态：W3C Internationalization Working Group Draft Note；不是可以忽略上下文直接套用的通用美学公式
- 可迁移事实：
  - 中文行首行尾存在标点禁则；basic 级别不允许点号、结束引号/括号等出现在行首，也不允许开始引号/括号等出现在行尾。
  - 成对或占两个字宽的标点组合不应任意拆到两行。
  - 简体、繁体、横排、直排和地区规则可能不同，不能把一个地域的实现写成所有中文排版真理。
- 对 DesignEcho 的限制：只有实际行分割可观察时才能做确定性验证；仅有字符串、文本框 bounds 或 VLM 印象时不能伪造断行事实。

### S-02 W3C WCAG 2.2 文字对比

- 类型：`standard`
- 来源：[WCAG 2.2 — 1.4.3 Contrast (Minimum)](https://www.w3.org/TR/WCAG22/#contrast-minimum)
- 可迁移事实：普通文字最低 4.5:1，大字最低 3:1；Logo 和纯装饰等有明确例外。
- 对 DesignEcho 的限制：这是适用于 Web 可访问性交付的渠道合规标准，不是所有电商视觉的审美评分尺。未声明可访问性要求的主图不能因为低于某个固定比值自动判为“设计差”；如果渠道或用户明确要求 WCAG，则由 Evaluation / Delivery overlay 做确定性检查。

### S-03 Figma Layout Guides

- 类型：`vendor_guidance`
- 来源：[Create layout guides](https://help.figma.com/hc/en-us/articles/360040450513-Create-layout-grids-with-grids-columns-and-rows)
- 可迁移机制：uniform grid、columns、rows、margin、gutter 和 offset 用于建立一致关系并减少重复布局决策。
- 对 DesignEcho 的限制：Guide 是视觉辅助，不是自动设计答案。不能据此恢复固定 12 栏、自动吸附所有元素或 `task-preset` 网格；Agent 仍决定是否使用严格网格、光学对齐、自由拼贴或有意 breakout。

### S-04 IBM Carbon Typography

- 类型：`vendor_guidance`
- 来源：[Carbon Typography](https://carbondesignsystem.com/elements/typography/overview/)
- 可迁移机制：排版系统以角色化 type token 组织字号、字重和行高；productive 与 expressive 场景使用不同的层级策略。
- 对 DesignEcho 的限制：不能复制 IBM Plex、Carbon token 名或数值。可迁移的是“同类信息共享角色、营销表达和信息任务使用不同强度”的机制。现有 DesignEcho 已表达这项原则，本轮不新增生产知识。

### S-05 Adobe Photoshop 合成指导

- 类型：`vendor_guidance`
- 来源：[What makes amazing creative compositing](https://www.adobe.com/learn/photoshop/web/photography-effects)
- 可迁移机制：无缝合成需要同时考虑光线方向、影子方向、光质、透视、尺度和画面 framing；明显不一致会暴露拼接。
- 对 DesignEcho 的限制：并非所有照片都必须无缝合成。白底摄影、全出血场景图和明确边界的图片容器都可以成立；只有 Agent 声明了 seamless composite，才要求完整合成一致性。

### S-06 Shopify 商品摄影

- 类型：`vendor_guidance`
- 来源：[Taking product photographs](https://help.shopify.com/en/manual/products/product-media/product-photography)、[Photography workflow](https://www.shopify.com/blog/streamline-product-photography-workflow)
- 可迁移机制：商品摄影通过一致的机位、光线和 framing 建立信任；不同角度、细节、生活场景和尺度比较承担不同信息角色；白底是突出商品的一种方案，不是唯一方案。
- 对 DesignEcho 的限制：摄影一致性属于素材角色与系列关系，不应被 Harness 转成“先白底、再场景”的固定顺序。

### S-07 Baymard 商品列表缩略图与变体研究

- 类型：`research_fact`
- 来源：[Product listing information](https://baymard.com/blog/product-listing-information)、[Color and variation searches](https://baymard.com/blog/color-and-variation-searches)
- 可迁移事实：用户在商品列表中会高度依赖缩略图识别和比较商品；当搜索/选择指向颜色变体时，缩略图不匹配会降低相关性理解和比较效率。
- 对 DesignEcho 的限制：Baymard 研究针对商品列表 UX，不等于每张品牌 KV 都必须突出一个 SKU。只有任务目标明确为某个变体的列表主图时才适用。

## 4. 现有知识差异审查

| 主题 | 当前实现 | 来源支持后的裁决 | 本轮动作 |
|---|---|---|---|
| 信息层级 | 已按主从、同级、分组、阅读顺序评价，拒绝固定三级 | Carbon、CLReq 支持角色层级而非固定比率 | 保留，不重复写入 |
| 网格与对齐 | 已允许严格网格、光学对齐、自由拼贴和不对称 | Figma 支持 Guide 作为辅助，不支持固定网格成为答案 | 不新增 Grid DSL / Gate |
| 正常尺寸 + 缩略尺寸 | 主图与单画布方法已要求双尺度复核 | Baymard 支持列表缩略图的重要性 | 保留，补变体特定候选 |
| 商品真实性 | 已保护形态、纹理、颜色、比例 | Shopify 与 Baymard 支持 | 保留 |
| 素材融合 | Evaluation 已检查背景断层、边缘、光向、透视、色温和接触关系 | Adobe 支持，但 Recipe 对“表达模式选择”仍不够明确 | 建立 C-02 候选 |
| 中文标题断行 | 只评价可读性、字重、字距、位置和溢出 | CLReq 提供明确行首/行尾和标点组合要求 | 建立 C-01 候选 |
| 对比度 | 当前以任务相对的 VLM 判断为主 | WCAG 有明确渠道标准但非通用美学 | 后置为渠道 overlay，不改通用断言 |
| 目标变体主导 | 主图方法只说变体差异可辨 | r32 与 Baymard 研究表明“目标变体”和“色系展示”仍可能混淆 | 建立 C-03 候选 |

## 5. 候选 C-01：中文标题断行完整性

- `candidateId`：`design-knowledge.cn-title-line-integrity/v0`
- 类型：`standards_note → candidate`
- 目标 owner：Design Kernel typography Knowledge；实际行分割可观测后可由 Evaluation 读取
- 不属于：Harness、Tool preflight、固定 Workflow、Photoshop Transaction

候选主张：

> 当简体中文横排标题被手动或自动分成多行时，Agent 应在真实渲染结果中检查行首行尾标点、成对标点与语义单元是否完整；不能只因为文本层未溢出就判定排印完成。开始引号/括号等不应孤立在行尾，点号和结束引号/括号等不应孤立在行首；地域或书写方向不同则按相应规则处理。

适用条件：

- 中文标题或辅助信息实际分成两行及以上；
- 包含标点、括号、引号、书名号或中西文混排；
- 当前画面能读取真实行分割，或通过同 revision 局部像素可靠观察。

不适用：

- 单行短标题；
- Logo、艺术字图形或用户明确要求的实验性拆字；
- 只知道字符串、不知道 Photoshop 实际断行。

可能的未来最小补丁：

- 在现有 single-canvas / main-image typography knowledge 中增加一条条件性观察；
- 在 `type.character` 的 Judge criterion 中增加“真实多行中文断行”分支；
- 不新增 Tool。若现有 Photoshop 读回拿不到行分割，保持 VLM `needs_review`，不伪造 deterministic pass/fail。

## 6. 候选 C-02：商品照片表达模式与合成一致性

- `candidateId`：`photoshop-craft.product-image-integration-mode/v0`
- 类型：`vendor_guidance + heuristic → candidate`
- 目标 owner：Photoshop Craft Recipe + `craft.asset-integration` Evaluation
- 设计答案 owner：Agent

候选主张：

> Agent 在把商品摄影加入单画布前，应先声明它采用哪种视觉关系：`native_photography`（照片自身承担画面）、`explicit_frame`（把照片作为有意容器/版块）或 `seamless_composite`（去底或多源重组为同一空间）。三种都可以成立，但不能以矩形断层、局部抠图和假阴影混成未完成的第四种状态。只有选择 `seamless_composite` 时，才要求光向、影向/接触、光质与色温、透视、尺度和 framing 共同一致；现有素材无法满足时，应改用有意容器或更匹配的素材，而不是连续叠加效果掩盖。

这是由 Adobe 合成指导和 r32 病例推导的启发式，不是标准。`explicit_frame` 不是失败回退，而是可以主动成立的设计语言；`native_photography` 也不要求抠图。

适用条件：

- 单画布包含一张以上外部摄影；
- 照片边界、去底、场景融合或多源组合会影响成品关系；
- Agent 需要决定直接使用、容器裁切还是去底重组。

不适用：

- 纯文字/几何设计；
- 用户明确要求保持原摄影且不做合成；
- SKU 等权矩阵中每张图本就使用一致的明确槽位。

未来最小补丁必须只修改现有 Recipe / Evaluation 文本，不新增 mode Gate。Agent 可以不显式输出枚举，只要设计意图和实际像素关系足以判断采用了哪种模式。

## 7. 候选 C-03：目标变体的缩略图显著性

- `candidateId`：`design-knowledge.target-variant-thumbnail-salience/v0`
- 类型：`research_fact + project_preference + case_observation → candidate`
- 目标 owner：主图 Skill overlay + main-image Evaluation
- 不属于：通用 Design Kernel 的所有任务规则

候选主张：

> 当用户、SKU 或投放目标明确指向一个颜色/变体时，目标变体应在列表缩略图中成为可立即辨认的商品身份。其它颜色可以作为支持信息，但不能与目标变体等权到让用户无法判断当前卖的是哪一款。若任务本来是“全色系/多色可选”的家族主图，则应明确采用家族展示目标，不套用单变体显著性。

适用条件：

- 目标、文件夹、已确认 SKU 或交付计划明确绑定单个变体；
- 输出用于搜索、推荐或货架列表缩略图。

不适用：

- 整个颜色家族主图；
- SKU 对比、色卡或组合装等同级展示；
- 变体信息仍是未知，且用户/项目没有权威来源。

未来最小补丁应扩充现有主图 overlay 中的变体句和 Evaluation criterion，不创建关键词路由或按文件名自动选择颜色。

## 8. 真实视觉校准

### 8.1 r32 低质量成稿

- 路径：`C:\Users\12611\Desktop\DesignEcho-可靠性基线\粉咖微压直板（加厚款木耳边）-input-r32\主图\粉咖微压直板加厚木耳边-主图.jpg`
- 类型：`case_observation`
- 已观察问题：
  - 四色平铺摄影以大矩形直接嵌入，与周围奶油底色形成未被解释的照片边界。
  - “粉咖”是目标语义，但棕、白、粉、灰四款等权，目标变体没有成为缩略图身份。
  - 三个大胶囊卖点与产品争夺下半区注意力；文案存在但没有用穿着、细节或场景证明核心利益。
- 不能推出：所有多色主图都错误、所有矩形照片都必须抠图、所有胶囊标签都应删除。

### 8.2 Eagle 冻结参考

| Eagle ID | 可迁移关系 | 禁止照抄 |
|---|---|---|
| `LAKLHIYBNKNWN` | 手持近景把木耳边、纹理和色系同时放到主视觉；文字退居支持位置 | 原文案、配色、摄影资产和版式坐标 |
| `LAKLE0ETHZ6AF` | 穿着效果是主证据，色系缩略图是支持证据；主从关系清楚 | 原品牌文案、字体和画面结构 |
| `MK6GJVHBBCK6F` | 单一穿着场景承担气质与使用证明，标签和标题分层，不用多块照片拼贴 | 原模特、鞋履、标签、文案和粉色场景 |

这些参考只能说明“关系机制可能有效”，不能证明其商业结果，也不能作为生产 Agent 的隐藏输入。正式 A/B 中它们只进入盲评参考侧，不进入 B0/B1 Agent 上下文。

### 8.3 用户成稿样本

观察范围：

- `D:\A1 neveralone旗舰店\C-1204\主图\800\`
- `D:\A1 neveralone旗舰店\C-1105\主图\800\`

可迁移的项目取舍：

- 每张图围绕一个可见利益或证据组织，而不是把所有卖点堆进同一画面。
- 穿着、拉伸、网眼、鞋内关系和材质特写让文案有画面证据。
- 标题通常形成一个紧凑文字组，支持说明与数据另有区域；文字强弱来自角色关系，不依赖大量标签容器。
- 摄影本身常承担完整背景与空间，不为了“设计感”强制抠图；需要文字时利用真实负空间。

限制：这是项目样本，不是所有品牌的美学标准；其中个别低对比白字、夸张数据或旧平台风格也必须接受独立质量审查，不能因为“用户成稿”身份自动发布为通用知识。

## 9. 首个可执行盲化 A/B

### 9.1 Case

- `caseId`：`main-image-c1105-airy-ruffle-unseen-v1`
- 来源项目：`D:\A1 neveralone旗舰店\C-1105`
- Fixture 只复制：`超薄镂空蝴蝶结木耳边` 下的原始摄影与颜色图，以及经人工冻结的最小产品事实。
- Fixture 必须排除：`主图`、`PSD`、`SKU`、`images`、模板、TM、`800-1.jpg`、用户成稿、Eagle ID、研究文档和任何参考答案。
- 固定自然语言需求：`用这些摄影图做一张 800×800 商品主图，重点让人看出网眼轻薄、蝴蝶结木耳边和穿鞋效果；交付可编辑 PSD 和 JPG。`
- 模型：DeepSeek V4 Flash Vision；B0/B1 使用相同模型、thinking、预算、Tool surface、初始 Photoshop 状态和素材 digest。

### 9.2 单变量

- B0：共同父提交，使用当前已发布 Design Kernel /主图知识。
- B1：只加入 C-02“表达模式与合成一致性”候选；不得同时加入 C-01 或 C-03。
- 两个分支均不得把用户成稿或 Eagle 参考交给 Agent。

### 9.3 验收轴

技术轴保持现有 Design Reliability 口径：

- 外部文档零变化；
- 新任务文档目标绑定；
- 同 revision PSD/JPG；
- 可编辑文字、图片与语义图层；
- 零人工设计纠偏；
- unknown write 为零且账本闭合。

视觉轴采用匿名成对比较：

- 商品和网眼/木耳边/穿鞋效果是否立即可辨；
- 摄影采用的表达模式是否明确且完成，没有半融合矩形断层；
- 第一焦点、标题与支持信息是否形成清楚阅读顺序；
- 中文标题是否自然断行且没有标点孤立；
- 正常尺寸和列表缩略图是否都能识别首要信息；
- 结果是否利用了当前商品的独特机会，而不是可替换商品的通用模板。

盲评材料包含 B0、B1、用户成稿和冻结 Eagle 参考，但隐藏来源、分支、模型输出顺序和候选名称。

### 9.4 晋升与撤回

第一次 canary 只决定“是否值得继续”，不能发布：

- 每个 arm 至少重复 2 次；
- B1 两次均满足技术轴，人工介入不增加；
- 独立盲评者在两次成对比较中都以多数意见偏好 B1，且没有同一项重大质量退化；
- 模型调用、输入 token 或耗时增加时必须如实记录，不能用性能回退换无法确认的轻微审美差异。

进入 `validated` 至少需要 3 个未见商品 Case × 每个 arm 2 次：

- 6 对中 B1 至少赢 4 对，且同一 Case 不得连续两次都输；
- 视觉总分中位数相对 B0 提高至少 5 分，技术成功率、可编辑结构、同 revision 交付和人工介入均不回退；
- 没有出现新关键词路由、固定模板、品类分支或第二 Evaluation owner。

只有 Experience Publisher 形成带 source revision、适用范围、canary 结果和回滚点的发布记录后，候选才可进入 `published`。失败、无差异或代价不成比例时，撤回候选 commit；研究文档保留为负结果，不改断言制造假绿。

## 10. 明确不做

- 不把三条候选一起塞入 Prompt 后跑一次图。
- 不给 Harness 增加 `integrationMode` 写入门禁或颜色关键词判断。
- 不把 CLReq 规则扩张成所有语言的排版 Gate。
- 不把 WCAG 比值当通用审美分数。
- 不把 Eagle 参考、用户成稿或研究结论暴露给正式未见 Case 的 Agent。
- 不新增 Memory Engine、Knowledge Registry、Evaluator Gate、A/B Runtime 或研究专用完成状态。
- 不因这份文档完成而声称 DesignEcho 的专业设计质量已提高。

## 11. 下一实现切片的最小边界

若 r33 技术链闭合且 C-02 被明确激活，下一切片只允许：

1. 从共同父提交建立 B0/B1 两个隔离 worktree。
2. B1 只修改现有 `photoshop-craft.editable-single-canvas-composition` 与 `craft.asset-integration` 的必要文本，不新增 schema、Tool 或 Runtime 状态。
3. 扩展现有可复用设计知识 /作者权审计，证明知识不授予权限、不选择工作流、不成为写入门票。
4. 先跑专项、类型 /构建和一次完整核心闸门，再用隔离 Photoshop 执行固定 Case。
5. canary 不通过则直接撤回 B1；不在失败候选上叠加 C-01/C-03 补丁。
