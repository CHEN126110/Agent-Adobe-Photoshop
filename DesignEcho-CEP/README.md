# DesignEcho CEP 兼容版（老 Photoshop 支持层）

给 **Photoshop 2019（20.x）～ 2023** 等装不了 UXP 版插件的老版本用的兼容面板。
装了 Photoshop 25.0+（2024 及以后）的机器请用 UXP 版（`DesignEcho-UXP/`），不要用这个。

## 它是什么

- **面板本身就是一个浏览器**：直接加载 DesignEcho Agent 应用的界面（`http://127.0.0.1:8766`），聊天、任务卡、素材面板与 UXP 版完全同一套 UI。
- **Photoshop 执行手是 ExtendScript**（`jsx/host.jsx`）：与 Agent 走同一条 MCP 协议线（`ws://localhost:8765`），Agent 不需要为 CEP 改任何协议。
- **前提**：这台电脑上 DesignEcho Agent 应用（Electron）已在运行。

## 能力分层（诚实版）

| 能力 | UXP 版 | CEP 版 | 说明 |
| --- | --- | --- | --- |
| 文档创建/切换/关闭/保存 | ✅ | ✅ | 保存支持 psd/jpg/png，目录不存在会自动创建 |
| 图层树读取（含 bounds） | ✅ | ✅ | |
| 文字图层创建/改文案 | ✅ | ✅ | 字体不存在时保持默认字体并在结果里说明 |
| 移动/等比缩放图层 | ✅ | ✅ | 移动带写后读回校验；缩放只支持等比百分比 |
| 置入图片（智能对象） | ✅ | ✅ | |
| 文档截图给 Agent 看 | ✅（imaging 像素接口，快） | ⚠️（复制文档→拼合→导出临时 JPEG，秒级、慢） | 功能等价但慢一个量级 |
| 像素级读取/主体框/抠图协作 | ✅ | ❌ | CEP 无像素接口 |
| 事务化读回 / 历史版本守卫 | ✅ | ❌ | ExtendScript 无 historyStateRef |
| 调整图层/蒙版/滤镜等高级工具 | ✅ | ❌（本版未实现） | Agent 调用时会收到明确错误+可用工具清单 |

共 **13 个工具**（与 UXP 版同名同参数）：getDocumentInfo、listDocuments、switchDocument、createDocument、getLayerHierarchy、createTextLayer、setTextContent、moveLayer、transformLayer、placeImage、saveDocument、getDocumentSnapshot、closeDocument。

Agent 请求了本版没有的工具时，桥会返回明确错误并列出可用清单，提示模型改用现有工具、做不到的部分如实告诉用户——**不猜、不静默降级、不冒充 UXP 版**。

## 安装（开发版，未签名）

1. 右键 `install-dev.ps1` → 使用 PowerShell 运行（复制扩展 + 打开 CSXS.9/10/11 的 PlayerDebugMode）。
2. 重启 Photoshop → 菜单 **窗口 → 扩展（旧版）→ DesignEcho**。
3. 先启动 DesignEcho Agent 应用，面板顶部状态条变绿即已连接。

## 已知限制

- **弹窗防线**：`host.jsx` 全程 `app.displayDialogs = DialogModes.NO`，但 ExtendScript 个别操作（如损坏字体）仍可能触发 PS 原生对话框，遇到请截图反馈。
- **截图慢**：每次 `getDocumentSnapshot` 都要复制并拼合整个文档，大文档可能要几秒到十几秒。
- **未真机验证**：本机没有装 PS 2019~2023，以上流程只做了协议/序列化/语法级验证，需要在装有老版本 Photoshop 的机器上实测（见下）。

## 真机验证清单（第一次装到老 PS 上时按此走）

1. 面板能打开，状态条显示「已连接（CEP 兼容版）」。
2. 聊天里说「新建一个 800×800 文档」→ 文档出现。
3. 「加一行文字：测试中文编码」→ 文字图层出现且中文不乱码。
4. 「看一下画面」→ Agent 能描述文档内容（截图链路通）。
5. 「保存到 D:\test\a.jpg」→ 文件生成且目录自动创建。
6. 整个过程 Photoshop **不弹任何对话框**。
