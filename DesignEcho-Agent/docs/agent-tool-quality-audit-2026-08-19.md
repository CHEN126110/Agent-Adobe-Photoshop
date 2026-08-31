# Agent 工具全量体检（2026-08-19）

> 文档类型：D 层历史工具审计。
> 当前开发权限：不能直接指导当前 Tool 取舍；旧工具数量、调用率和失败率必须重新采样。
> 适用范围：2026-08-19 的工具面与运行档案。
> 不能覆盖：当前 Tool registry、preflight、Capability Session、当前代码和真实运行。

> 用户：「有工具不代表工具可以做得很好，我们需要优化工具，全量检查。」

数据来源：`tool-schemas.ts` 174 个模型可见工具 × 真实运行档案（08-01→08-19 共 281 次运行、84 个被调用工具；07-15 起共 92 个被调用）。方法：每个工具的调用量 / 失败率 / 最常见失败原因 / 用到它的运行数，再按设计师工作流（看素材 → 选图 → 置入定大小位置 → 排文字 → 效果 → 评审 → 导出）逐环看"能不能做好"。脚本：`scratchpad/tool-stats.cjs`。

## 一、三个总体事实

1. **174 个工具里 97 个自 07-15 起一次都没被模型调用**（56%）。其中一部分是设计上该用却用不到的（对齐 / 分布 / 蒙版 / 调整层 / 描边发光 / 高斯模糊），一部分是历史遗留重复品（smartLayout / batchRenderTemplate / fillDetailPage / applyRasterImageResult / morph 系列）。工具菜单越长，模型越只用它认识的那几个。
2. **失败的大头不是工具本身，是门禁**：createTextLayer 35% / placeImage 36% / setTextStyle 41% / transformLayer 14% 的失败几乎全是"必须先读取同一文档 / 版本已变化 / 请先观察"这类拦截，不是 Photoshop 写不进去。真正的工具缺陷集中在下面表 B。
3. **看图这一环最弱**：主模型不能看图 → 每张画面串行调视觉专家 60–80s（已关思考）；`describeImage`/`visual-analysis` 因格式（tif/psd）直接失败 58%；`getSubjectBounds` 对平铺袜子常给"置信度 low、框几乎盖满整图"，而"图放多大放哪"全靠它。

## 二、表 A：高频工具的真实表现（08-01 起）

| 工具 | 调用 | 失败率 | 最常见失败 | 判定 |
|---|---|---|---|---|
| getDocumentInfo | 417 | 1% | PS 忙 | 好；但被当"续命"读法调用过多（每轮一次） |
| getLayerHierarchy | 241 | 2% | — | 好 |
| getCanvasSnapshot / getDocumentSnapshot / getAnnotatedSnapshot | 182 / 79 / 139 | 1–4% | 观察预算拦截 | 工具好；慢在下游看图侧调用 |
| searchProjectResources / listProjectResources | 173 / 163 | 0% | — | 好；但只给文件名不给内容，模型据此瞎选图（已把总览图接进主模型） |
| requestAgentCapabilities | 107 | 9% | 「没有装载新的能力」不说哪个 id 错 | **已修**：逐 id 说原因 |
| sku-batch（技能） | 102 | **71%** | 文档版本变化守卫连撞 8 次 | 守卫出口没点名 + 熔断封唯一路（**已修**两处，并行会话在做技能内 rebinding） |
| analyzeAssetContent | 53 | 0% | — | 能用但 20s/张（已关思考）；一次只看一张 |
| createTextLayer | 51 | 35% | 门禁 | 工具本身好（事务化 + verified） |
| placeImage | 39 | 36% | 门禁 | 工具好；`置入的图片` 命名不带来源名（建议用文件名命名图层） |
| openProjectFile | 37 | **57%** | 「未找到包含 "2双装" 的文件」×5 | 项目里本来没有；工具只说"没有"不说"有什么"→ **已修**：交回相近文件名 |
| createDocument | 34 | 41% | 目标绑定门禁 | 门禁问题 |
| analyzePsdDesignSource | 32 | **38%** | .tif 不支持 ×12 | 参数描述没写清 → **已修**描述；下一步：把 .tif 结构读取路由到 PS 内 |
| renderLayout | 29 | 48% | 详情页要 stagePlan / visualStyle 校验驳回 | 表单门禁；车间已接管首稿 |
| moveLayer | 18 | **61%** | 「写后读回位置 (162,323) 目标 (162,283)」 | 疑似锁定/父组导致 translate 静默无效 → **已修**诊断：报出锁定状态、区分"没动"与"动错"；根因待真机复现 |
| document-management（技能） | 18 | 61% | 目标绑定门禁 | 门禁 |
| declareDesignBrief | 18 | 83% | 表单洁癖 | **已修**：降为提醒 |
| observeEagleAsset | 16 | 38% | 素材库未在本会话打开 | 环境前置；工具应自动打开或点名怎么打开 |
| sku-color-card（技能） | 13 | **100%** | moveLayer 守卫绑定 | 与 moveLayer / 守卫同源 |
| visual-analysis（技能） | 12 | 58% | Unsupported image format（tif/psd） | **已修**：走资源预览缩图再送视觉模型 |
| getScreenSnapshots | 4 | **100%** | `Cannot read 'width'`（模型没传 bounds） | **已修**：按 id 现读 bounds，读不到说清缺什么 |
| composeDesign | 7 | 57% | palette 必填 / canvas 缺 | palette 已宽容；canvas 仍必填（合理） |
| getSubjectBounds / fitLayerSubjectToRegion | 少量 | 0% | 但结果常"置信度 low、框盖满整图" | **最重要的质量缺口**，见表 B |

## 三、表 B：按设计师工作流看"能不能做好"

| 环节 | 现在靠什么 | 差在哪 | 建议 |
|---|---|---|---|
| 看素材 / 选图 | contactSheet（总览图，已接进主模型）、analyzeAssetContent（20s/张）、recommendAssets | 主模型看不到图 → 靠专家转述；单张分析慢 | 换能看图的主模型是根治；工具侧：contactSheet 加"每格标 A01…编号 + 文件名"已有；analyzeAssetContent 支持一次多张（批 4 张一调） |
| 置入 + 定大小定位置（最难） | placeImage → getSubjectBounds（alpha → 纯色底裁边 → 本地分割）→ planPhotoFullBleedPlacement / fitLayerSubjectToRegion | 平铺照片有阴影 / 渐变底时"纯色底裁边"失效、分割给整图框；结果是产品占比不准、文字压到产品 | 主体框补一层"明度/饱和度差异裁边"（背景灰度方差小的区域视为底）+ 把置信度低时的"整图框"改为返回失败让模型换图/手给框；主体框写进素材记忆一次算多次用 |
| 排文字 | renderLayout（配方 / regions）+ createTextLayer + resolveFontName + setTextStyle | 字体气质只靠 fontName；没有"字距 / 行距 / 字重"的刻度建议；文字与主体的避让靠区域不相交 | renderLayout 返回"文字块实际 bounds + 与主体框的最小距离"，让评审能量；给模型一个 `listFonts(气质)` 而不是让它猜 PostScript 名 |
| 效果 | addDropShadow（车间用）、addStroke/Glow/GradientOverlay/调整层（**从没被调过**） | 工具存在但模型不知道何时用 | 收进车间参数（subject.shadow 已有；加 `text.effect: stroke/none`、`photo.tone: 调整层预设`），原子工具从菜单里退到二级 |
| 排版对齐 | alignLayers / distributeLayers / alignToReference（**从没被调过**） | 同上 | 同上：由 renderLayout 保证；原子工具退二级 |
| 评审 | evaluateDesign（视觉模型） | 只给分数与批评，不量几何；主体占比、文字距边、对比度可以量却没量 | 评审前跑一次几何测量（主体框占比、文字块最小边距、文字底色对比度）作为硬项传入 hardFindings |
| 导出 | smartSave / quickExport / exportGroup | 好 | — |
| 抠图 | prepareSubjectCutout（车间内）/ removeBackground（模型从没调） | birefnet 对上脚图会抠腿；无"只保留产品"选项 | 抠图工具加 `keep: 'product' | 'all'`，配合主体框裁到产品再抠 |
| 去杂物 / 修补 | inpainting（UXP 内有）但模型面没有工具 | run 499 评审说"纸屑必须清除"，模型只能缩放 | 暴露 `removeObjects(region)`（走已有 inpainting）；这是白底图 / 精修的刚需 |

## 四、表 C：97 个从未被调用的工具怎么处理

- **该用但用不到（收进车间 / 引擎，菜单退二级）**：addStroke / addGlow / addGradientOverlay / 9 个调整层 / clearLayerEffects / alignLayers / distributeLayers / alignToReference / createClippingMask / createLayerMask / gaussianBlurLayer / setBlendMode / setLayerOpacity / setLayerFill / quickScale / convertToSmartObject。
- **需要但从没露面（先接线再评估）**：askUserToChoose（今天新加）、studyReference / learnTasteFromEagle / recordDesignVerdict / getDesignLearningTimeline（学习闭环，靠脚本跑过）、removeBackground、describeImage、webSearch / fetchWebPageDesignContent、浏览器 5 件套。
- **疑似遗留 / 重复（下一轮确认后退役）**：smartLayout、batchRenderTemplate、fillDetailPage、replaceTextPlaceholder / replaceLayerContent / replaceSmartObjectContents / updateSmartObject 四件重叠、applyRasterImageResult / applyMattingResult / applyMultiMattingResult / getMattingImage / getOptimizedImage（管线内部件不该给模型）、morphToShape / batchMorphToShape / applyMorphedImage、extractShapePath / getLayerContour、exportMainImageDocuments / exportToSkuDir / exportWhiteBgFromSkuMaterial（品类专属导出，违背"不是品类机器"）、prepareSkuRetouchAssets、sockLayoutConfig、runDesignTeamPipeline / delegateToAgent、undo / redo / lockLayer / getHistoryInfo / diagnoseState。

## 五、本轮已落地

- getScreenSnapshots：缺 bounds 不再整批崩，按 id 现读、读不到说清。
- openProjectFile：找不到时交回相近文件名，不再让模型盲猜五次。
- visual-analysis / describeImage：tif / psd / bmp 走资源预览缩图再送视觉模型。
- analyzePsdDesignSource：参数描述点名 .tif 不支持、该走哪条路。
- moveLayer：失败时报出锁定状态、区分"没动"与"动错"。
- requestAgentCapabilities：失败逐 id 说原因（上一轮）。
- 视觉侧调用关思考、总览图进主模型、任务卡账本按项（上一轮）。

## 六、下一步（按对"做得好"的贡献排序）

1. 主体框：加明度差异裁边 + 低置信度不给整图框（置入定大小定位置的地基）。
2. 暴露 `removeObjects`（走 UXP inpainting）与 `listFonts(气质)`。
3. 评审前几何测量进 hardFindings（主体占比 / 文字边距 / 对比度）。
4. 车间收进效果与对齐参数，97 个未用工具菜单退二级或退役（模型上下文瘦身，也是效率）。
5. moveLayer 真机复现一次锁定假设。
