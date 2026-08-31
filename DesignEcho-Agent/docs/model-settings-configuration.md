# 模型设置与配置说明

> 文档类型：B 层当前操作说明。
> 当前开发权限：可以指导模型配置与设置页维护。
> 适用范围：Agent 主模型、Provider、能力元数据、思考强度和旧配置迁移。
> 不能覆盖：`src/shared/config/models.config.ts`、真实 Provider 返回和当前用户选择。

更新日期：2026-08-31

## 1. 当前模型结构

DesignEcho Agent 当前只有一个运行模型：`primaryModel`。

该模型必须是可用于对话、支持视觉输入并符合当前 Agent 运行要求的多模态模型。目标理解、图片观察、设计判断、Tool 使用和写后视觉复核由同一个模型完成，不再维护独立的文本主模型与视觉专家模型。

代码真相源：

- `src/shared/config/models.config.ts`

相关规则：

1. `visualModel` 是旧双模型配置的兼容镜像；归一化后始终等于 `primaryModel`。新代码不得把它作为第二选择源。
2. `preferredCloudModels` / `preferredLocalModels` 中的 `layoutAnalysis / textOptimize / visualAnalyze` 只为历史设置迁移保留，不是当前三个任务模型桶。
3. 图片生成、Embedding、重排、音频或视频模型可以作为专门 Provider / Tool 使用，但不能被选为 Agent 主模型，除非模型目录明确声明它具备当前所需的对话和视觉能力。
4. 模型名称不能自动授予视觉、Tool Calling 或思考强度能力；以模型目录和真实 Provider 能力为准。

## 2. 设置页行为

设置页的 Agent 模型选择只写入 `primaryModel`，同时同步兼容字段 `visualModel`，防止旧版本读取到另一模型。

选择模型时应显示：

- Provider；
- 是否为对话模型；
- 是否支持视觉；
- 是否支持 Tool Calling；
- 是否允许用户选择 reasoning effort；
- 缺少凭据或当前不可用的真实原因。

“已登记”“已安装”“能够出现在下拉列表”不等于实际可调用。设置页测试必须使用当前选择的精确模型和对应 Provider，不得回退到另一模型后宣称成功。

## 3. 思考模式与强度

`reasoningEnabled` 表示是否启用当前模型支持的思考能力；`reasoningEffort` 只在模型目录明确声明可选档位时下发。

- 没有声明档位的模型忽略 `reasoningEffort`；
- Provider 私有 thinking 不直接展示给用户；
- 用户可见过程应是简短设计判断和真实动作，不是内部推理转储；
- 固定 JSON、严格评审等特殊调用是否关闭思考，由对应调用契约决定，不能按模型名称散落分支。

## 4. Provider 与密钥

每个 Provider 只使用自己的凭据和 endpoint。缺少 Key、模型无访问权、额度不足、协议失败和网络错误必须分别报告，不能统一包装成“模型不可用”。

ChatGPT 订阅模型走独立的 Codex subscription 通道；普通 OpenAI-compatible Provider 走各自 adapter。订阅通道不是其它 Provider 的隐式 fallback。

图片生成 Provider 的 Key 与 Agent 对话模型 Key 可以独立存在。图像生成成功也不证明 Agent 主模型具备视觉理解或 Tool Calling。

## 5. 旧配置迁移

加载历史设置时按以下规则归一化：

1. 有合法 `primaryModel` 时保留它；
2. 没有 primary 时，可以从旧 `visualModel` 或旧视觉偏好中选择一个已确认可用于 Agent 的多模态对话模型；
3. 归一化后同时写入相同的 `primaryModel` / `visualModel`；
4. 旧三桶偏好继续保存只为兼容，不参与当前运行时模型路由；
5. 明确不合格、下线或非对话模型不能因为历史偏好被恢复为主模型。

## 6. 修改后的验证

模型配置、设置页或 Provider dispatch 变更后至少执行：

```text
npm run test:model-usage-classification
npm run build:typecheck:renderer
npm run maintenance:validate
```

外部 Provider 可用性必须用明确授权的真实只读探针另行验证。自动测试、目录元数据和设置保存成功不等于当前账号真实可用。
