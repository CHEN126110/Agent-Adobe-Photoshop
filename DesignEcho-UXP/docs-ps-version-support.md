# Photoshop 最低版本支持（2026-08-20 下探）

`manifest.json`：`manifestVersion: 5`，`host.minVersion: "25.0.0"`（原 26.0.0）。

## 版本门槛证据（Adobe 官方文档 / changelog）
| 依赖 | 最低版本 | 出处 |
|---|---|---|
| WebView 用于 Panel | PS 24.1（UXP 6.4） | UXP changelog「WebView for Panels」；UXP↔PS 版本表 |
| postMessage 消息桥（enableMessageBridge=localAndRemote，远程内容） | ≤PS 24.4（UXP 7.1 文档已含） | HTMLWebViewElement 7.1 期文档 |
| fs getEntryWithUrl | PS 24.1（UXP 6.5） | UXP changelog v6.5 |
| imaging（getPixels/putPixels/encodeImageData，15 个文件重度使用） | Beta=24.2；24.4 时仍只在 Beta build；**无 GA 公告 → 稳妥取 25.0** | Photoshop API changelog 24.2 / 24.4 |
| executeAsModal 的 timeOut 选项 | 25.10 新增；更早版本忽略该字段（不致命，只是无超时） | Photoshop API changelog 25.10 |
| ResizeObserver | PS 26.1（UXP 8.1）——已改为按能力选路（无则 window resize） | UXP changelog v8.1 |
| webview.allowLocalRendering | PS 26.0（UXP 8.0）——**已从 manifest 删除**（我们加载 http://127.0.0.1:8766 远程内容，不需要它） | HTMLWebViewElement 文档 |

## 为什么不是 24.x
imaging 模块是本插件命脉（截图 / 导出 / 抠图 / 变形全靠它），Photoshop 官方 changelog 只记到「24.4 起在 Beta build 可用」，从未宣布 retail GA 版本号；25.0（2023-09）起社区与官方示例均默认可用。往 24.x 压需要在真实 24.6 retail 上验证 imaging 存在，验过再降。

## 已知差异（25.0–25.9 vs 26+）
- executeAsModal 无 timeOut：文档观察在极端卡死时不会自行超时（行为差异，非故障）。
- 无 ResizeObserver：WebView 尺寸随窗口 resize 同步（面板拖动分栏时的实时跟随略钝）。

## 验证状态
- PS 26.x：日常真机在用。
- PS 25.x：**未实测**（本机无 25.x）。装 25.x 后重点验：面板 WebView 显示与消息桥、getDocumentSnapshot（imaging）、saveDocument、色卡站①。
