# 设计领域知识与参考图复刻实现计划

## 目的

本计划用于把“图片复刻设计”从想法收敛成可实施工程路线。

当前目标不是承诺一张参考图可以 100% 还原原作者 PSD，而是实现：

1. 用户提供参考图
2. Agent 理解设计类型、画布、模块、图文关系和视觉层级
3. 系统生成可编辑、可复核、可继续迭代的 Photoshop 设计稿

## 当前已落地的基础

当前不再把单个领域定义文件当成任务身份总控。真实 Owner 分工如下：

- `src/shared/design-task-types.ts`：唯一 Task Profile / crosswalk Owner，统一 task type、artifact knowledge、artifact-owner Manifest /兼容 Skill 与 document role 身份。
- `src/shared/knowledge/design-artifact-knowledge.ts`：主图、详情页、SKU Template / Color Card / Batch、通用单画布等交付物的方法与输入解释，保留 provenance；不拥有权限或 Runtime。
- `src/shared/agent-runtime-v5/design-method-knowledge.ts`：把 Manifest 方法引用转换为带 `applicableStages` 的运行时知识项。
- `src/shared/agent-runtime-v5/runtime-context-compiler.ts`：唯一上下文编译入口，按当前 Stage 渐进选择知识。
- `src/shared/knowledge/photoshop-craft-recipes.ts`：首条版本化单画布 Photoshop Craft Recipe，连接必要观察、参数来源、真实 Tool 语义、保持项与结构 /像素读回；只在 R4/R5 提供建议。
- `src/shared/design-domain-knowledge.ts` 与 `src/shared/design-knowledge-search.ts`：继续提供领域条目与检索能力，但不再承担 Task Profile 身份或阶段装载 Owner。

作用：

1. 让通用 Agent 即使不加载业务 Skill，也能从 Task Profile 取得主图、详情页、SKU 子类型和通用设计的基础语义，并在需要时深化检索
2. 不再只依赖模型本身的模糊常识
3. 后续可以继续把 Photoshop Craft Recipe、视觉案例和 benchmark 接入现有 Provider / Context 边界，不建立第二 Knowledge Store

领域知识不进入前置意图 Router，也不能授予 Skill、Tool、Stage、完成或 Release 权限；普通自然语言先进入通用 Agent，真实能力边界由执行点契约裁决。普通设计参考为按需输入，Eagle /外部检索离线或无命中不阻断；只有显式复刻、指定参考或品牌约束才可在相应任务 Contract 中成为必需输入。

上述基础已通过当前核心类型、业务边界、Capability、Prompt 与完整维护验证；它证明知识接线和治理边界，不证明真实 Photoshop 设计质量。下一步必须用无业务 Skill 的真实 Provider + Photoshop V1 纵切验证知识选择、设计判断、制作与写后复核是否有效。

## 为什么先做领域定义

如果 Agent 不清楚业务概念，就会出现这些问题：

1. 用户问普通问题却误执行 Photoshop
2. 用户要新建模板却走到现有文档填充
3. 主图、详情页、SKU、参考图复刻混在一起
4. 模型把“视觉建议”误当成“可执行设计计划”

因此第一阶段必须先解决概念边界，而不是直接上向量库。

## 知识库形态判断

当前不建议直接做重型多模态知识图谱。

原因：

1. 项目还没有稳定的设计 DSL
2. 项目还没有真实 benchmark 案例
3. 当前没有独立 embedding 模型配置和主链向量检索
4. 图片知识如果只存图片文件，对 Agent 帮助有限

更稳的顺序是：

1. 领域定义库
2. 设计规则库
3. 可执行 recipe 库
4. 视觉案例索引
5. benchmark 与评分卡
6. 再考虑 embedding / 向量检索 / 多模态检索

## 图片知识应该怎么存

图片不能只作为文件存入知识库。每张图至少要被解析为：

1. 原图路径
2. 缩略图路径
3. 画布尺寸
4. OCR 文案
5. 主色调
6. 构图类型
7. 模块列表
8. 元素位置
9. 风格标签
10. 适用场景
11. 人工评分或 benchmark 评分

也就是说，图片知识库的重点是“图片 + 结构化视觉分析”，不是纯图片文件夹。

## 图片复刻设计的真实链路

推荐链路：

```text
用户需求
  -> 领域概念判断
  -> 参考图视觉解析
  -> 设计中间表示 / DSL
  -> recipe 选择
  -> Photoshop 执行计划
  -> UXP 确定性执行
  -> 截图回读 / QA
  -> 修正或人工验收
```

## 当前瓶颈

### 1. 领域知识瓶颈

主图、详情页、SKU、模板、参考图复刻必须有项目内定义，不能完全靠模型常识。

### 2. DSL 瓶颈

当前参考图复刻已有最小表示，但还不能完整表达：

1. 字体层级
2. 颜色系统
3. 阴影和描边
4. 渐变和质感
5. 蒙版与剪贴关系
6. 视觉 recipe

### 3. Photoshop 执行瓶颈

UXP 能执行基础 Photoshop 操作，但复杂设计效果必须封装成稳定工具或 recipe，不能靠模型每次临场生成参数。

### 4. 评估瓶颈

当前仍缺少真实 benchmark 和视觉相似度 QA，无法证明设计能力稳定提升。

## 第一阶段验收标准

第一阶段不追求完整高保真复刻，只验收以下内容：

1. Agent 能正确区分主图、详情页、SKU、模板、参考图复刻
2. 参考图复刻不会被误描述为“已完成高保真能力”
3. 通用 Agent 能从 Design Foundation / Knowledge 取得项目内领域定义；这些定义不进入前置 Router，也不选择 Skill 或授予权限
4. 后续设计知识、recipe、视觉案例有明确挂载点
5. 构建通过

## 下一阶段建议

下一阶段应该补：

1. 用真实无 Skill 单画布任务验证首条 `PhotoshopCraftRecipe` 的选择、执行与读回有效性，再按证据补充工艺，不预先铺满 Recipe
2. `visual-case-index`
3. `reference-replication-plan` schema
4. 真实 benchmark case
5. 视觉 QA artifact：before / after / overlay

## 不做范围

当前阶段不做：

1. 重型知识图谱
2. 向量数据库主链
3. 100% PSD 还原承诺
4. 任意风格海报高保真复刻承诺
5. 没有 benchmark 的能力宣传
