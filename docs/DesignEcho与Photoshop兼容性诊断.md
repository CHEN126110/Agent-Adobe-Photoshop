# DesignEcho 与 Adobe Photoshop 兼容性诊断

**问题**：DesignEcho 启动后影响 Photoshop 运行，如文字工具报错 80ca06.156 等。

---

## 一、错误 80ca06.156 的已知原因（Adobe 官方）

该错误通常与**字体系统**相关：

| 原因 | 处理方式 |
|------|----------|
| 字体缓存损坏 | 删除 `%AppData%\Adobe\Adobe Photoshop [版本]\CT Font Cache` |
| 字体预览冲突 | 编辑 → 首选项 → 文字 → 取消「字体预览」 |
| 问题字体 | 移除 Myriad Web Pro、Myriad Pro 等已知冲突字体 |
| 系统字体缓存 | 删除 `%Windows%\ServiceProfiles\LocalService\AppData\Local\*FNTCACHE*.DAT` |

---

## 二、DesignEcho 可能的影响点

### 2.1 WebView 加载外部字体（高嫌疑）

**现象**：UXP 插件 WebView 从 `http://127.0.0.1:8766` 加载页面，该页面引用 Google Fonts：

```html
<link href="https://fonts.googleapis.com/css2?family=Inter&family=JetBrains+Mono&family=Space+Grotesk&display=swap" rel="stylesheet">
```

**影响**：在 UXP/CEP 中，WebView 可能与宿主共享字体环境。加载 Inter、JetBrains Mono、Space Grotesk 等外部字体时，可能：

- 触发字体缓存更新
- 干扰 Photoshop 文字引擎初始化
- 引发 80ca06.156 等错误

**缓解**：改用系统字体，移除对 Google Fonts 的引用。

### 2.2 forceRefreshCanvas 的 hide/show 操作

**位置**：`DesignEcho-UXP/src/index.ts` 第 96–137 行

**逻辑**：抠图、形态统一、局部重绘完成后，对当前图层执行 `hide` → `show` 强制刷新画布。

**风险**：若用户正在编辑文字，此时执行 hide/show 可能打断文字编辑状态，导致异常。

### 2.3 executeAsModal 阻塞

**现象**：插件大量使用 `core.executeAsModal` 执行 batchPlay，会阻塞 Photoshop 主线程。

**风险**：长时间或频繁的 modal 执行可能影响工具切换、文字编辑等交互。

### 2.4 createTextLayer 的 tryExitModalState

**位置**：`create-text-layer.ts` 第 11–22 行

**逻辑**：创建文字前通过 `select` 强制退出模态状态。

**风险**：若 Photoshop 处于特殊模态（如正在编辑文字），强制 select 可能破坏内部状态。

---

## 三、其他潜在隐患

| 类型 | 说明 |
|------|------|
| 内存 | Agent + UXP 插件 + WebView 同时运行，内存占用较高 |
| 网络 | WebSocket、HTTP 请求可能影响系统稳定性 |
| 并发 | Agent 与用户操作并发时，batchPlay 可能与用户操作冲突 |

---

## 四、诊断步骤

1. **隔离测试**
   - 仅启动 Agent，不打开 Photoshop → 观察是否异常
   - 仅打开 Photoshop 和 DesignEcho 面板，不启动 Agent → 观察是否异常
   - 两者都启动并连接 → 观察是否异常

2. **字体相关**
   - 按 Adobe 建议清理字体缓存、关闭字体预览
   - 在 DesignEcho 中移除 WebView 的外部字体引用后，再测试

3. **操作顺序**
   - 记录文字工具报错前的操作（如：刚完成抠图、刚执行形态统一等）
   - 确认是否与 `forceRefreshCanvas` 的调用时机相关

---

## 五、已实施的缓解措施

- [x] 移除 WebView 页面对 Google Fonts 的引用，改用系统字体（`index.html`）
- [ ] 在 `forceRefreshCanvas` 中增加「当前是否处于文字编辑」的检测，必要时跳过
- [ ] 评估 `tryExitModalState` 的调用时机与安全性
