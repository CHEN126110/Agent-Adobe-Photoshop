# Adobe Photoshop MCP 工具清单对比

## 📊 工具统计

| 分类 | UXP 实际注册 | Agent 声明 | 状态 |
|------|--------------|------------|------|
| **总计** | **85+** | **63** | ⚠️ 部分不同步 |

---

## ✅ 已完整实现的工具分类

### 1. **文本工具** (4个)
| 工具名 | Agent | UXP | 说明 |
|--------|-------|-----|------|
| getTextContent | ✅ | ✅ | 获取文本内容 |
| setTextContent | ✅ | ✅ | 设置文本内容 |
| getTextStyle | ✅ | ✅ | 获取文本样式 |
| setTextStyle | ✅ | ✅ | 设置文本样式 |

### 2. **图层管理** (13个)
| 工具名 | Agent | UXP | 说明 |
|--------|-------|-----|------|
| selectLayer | ✅ | ✅ | 选中图层 |
| getLayerHierarchy | ✅ | ✅ | 获取图层层级 |
| getAllTextLayers | ✅ | ✅ | 获取所有文本图层 |
| getLayerBounds | ✅ | ✅ | 获取图层边界 |
| moveLayer | ✅ | ✅ | 移动图层 |
| alignLayers | ✅ | ✅ | 对齐图层 |
| distributeLayers | ✅ | ✅ | 分布图层 |
| renameLayer | ✅ | ✅ | 重命名图层 |
| groupLayers | ✅ | ✅ | 编组图层 |
| ungroupLayers | ✅ | ✅ | 解散图层组 |
| reorderLayer | ✅ | ✅ | 调整图层顺序 |
| createClippingMask | ✅ | ✅ | 创建剪切蒙版 |
| releaseClippingMask | ✅ | ✅ | 释放剪切蒙版 |

### 3. **画布/文档操作** (9个)
| 工具名 | Agent | UXP | 说明 |
|--------|-------|-----|------|
| createDocument | ✅ | ✅ | 创建新文档 |
| listDocuments | ✅ | ✅ | 列出所有文档 |
| switchDocument | ✅ | ✅ | 切换文档 |
| closeDocument | ✅ | ✅ | 关闭文档（不保存） |
| getDocumentInfo | ✅ | ✅ | 获取文档信息 |
| diagnoseState | ✅ | ✅ | 诊断状态 |
| saveDocument | ✅ | ✅ | 保存文档 |
| quickExport | ✅ | ✅ | 快速导出 |
| getDocumentSnapshot | ✅ | ✅ | 获取文档快照 |

### 4. **图层属性工具** (7个)
| 工具名 | Agent | UXP | 说明 |
|--------|-------|-----|------|
| setLayerOpacity | ✅ | ✅ | 设置不透明度 |
| setBlendMode | ✅ | ✅ | 设置混合模式 |
| setLayerFill | ✅ | ✅ | 设置填充颜色 |
| duplicateLayer | ✅ | ✅ | 复制图层 |
| deleteLayer | ✅ | ✅ | 删除图层 |
| lockLayer | ✅ | ✅ | 锁定图层 |
| getLayerProperties | ✅ | ✅ | 获取图层属性 |

### 5. **图层效果工具** (5个)
| 工具名 | Agent | UXP | 说明 |
|--------|-------|-----|------|
| addDropShadow | ✅ | ✅ | 添加投影 |
| addStroke | ✅ | ✅ | 添加描边 |
| addGlow | ✅ | ✅ | 添加发光 |
| addGradientOverlay | ✅ | ✅ | 添加渐变叠加 |
| clearLayerEffects | ✅ | ✅ | 清除图层效果 |

### 6. **视觉分析工具** (3个)
| 工具名 | Agent | UXP | 说明 |
|--------|-------|-----|------|
| getCanvasSnapshot | ✅ | ✅ | 获取画布快照 |
| getElementMapping | ✅ | ✅ | 获取元素映射 |
| analyzeLayout | ✅ | ✅ | 分析布局 |

### 7. **历史记录** (3个)
| 工具名 | Agent | UXP | 说明 |
|--------|-------|-----|------|
| undo | ✅ | ✅ | 撤销 |
| redo | ✅ | ✅ | 重做 |
| getHistoryInfo | ✅ | ✅ | 获取历史信息 |

### 8. **图像处理** (3个)
| 工具名 | Agent | UXP | 说明 |
|--------|-------|-----|------|
| removeBackground | ✅ | ✅ | 抠图 |
| placeImage | ✅ | ✅ | 置入图片 |
| transformLayer | ✅ | ✅ | 变换图层 |
| quickScale | ✅ | ✅ | 快速缩放 |

### 9. **创建工具** (4个)
| 工具名 | Agent | UXP | 说明 |
|--------|-------|-----|------|
| createRectangle | ✅ | ✅ | 创建矩形 |
| createEllipse | ✅ | ✅ | 创建椭圆 |
| createTextLayer | ✅ | ✅ | 创建文本图层 |
| createGroup | ✅ | ✅ | 创建图层组 |

---

## ⚠️ UXP 已实现但 Agent 未声明的工具

### 高级功能（Agent 端需要补充声明）

| 工具名 | 分类 | 说明 | 建议 |
|--------|------|------|------|
| **batchRenameLayers** | 图层管理 | 批量重命名图层 | ✅ 应添加到 Agent |
| **batchExport** | 导出 | 批量导出 | ✅ 应添加到 Agent |
| **smartSave** | 保存 | 智能保存 | ✅ 应添加到 Agent |
| **replaceLayerContent** | 图层操作 | 替换图层内容 | ✅ 应添加到 Agent |
| **getClippingMaskInfo** | 剪切蒙版 | 获取剪切蒙版信息 | ✅ 应添加到 Agent |
| **getAllClippingMasks** | 剪切蒙版 | 获取所有剪切蒙版 | ✅ 应添加到 Agent |

### 形态变形工具（专业功能）

| 工具名 | 说明 | Agent 声明 |
|--------|------|------------|
| extractShapePath | 提取形状路径 | ❌ |
| getLayerContour | 获取图层轮廓 | ❌ |
| morphToShape | 形态变形 | ❌ |
| batchMorphToShape | 批量形态变形 | ❌ |
| applyMorphedImage | 应用变形图像 | ❌ |
| warpExplorer | 扭曲探索 | ❌ |
| exportLayerAsBase64 | 导出为 Base64 | ❌ |
| getSubjectBounds | 获取主体边界 | ❌ |
| applyDisplacement | 应用位移 | ❌ |

### SKU 排版工具

| 工具名 | 说明 | Agent 声明 |
|--------|------|------------|
| skuLayout | SKU 排版（核心） | ❌ |
| exportColorConfig | 导出颜色配置 | ❌ |
| createSkuPlaceholders | 创建 SKU 占位符 | ❌ |
| getSkuPlaceholders | 获取 SKU 占位符 | ❌ |
| exportToSkuDir | 导出到 SKU 目录 | ❌ |

### 模板渲染工具

| 工具名 | 说明 | Agent 声明 |
|--------|------|------------|
| openTemplate | 打开模板 | ❌ |
| getTemplateStructure | 获取模板结构 | ❌ |
| replaceImagePlaceholder | 替换图片占位符 | ❌ |
| replaceTextPlaceholder | 替换文本占位符 | ❌ |
| batchRenderTemplate | 批量渲染模板 | ❌ |

### 智能布局引擎

| 工具名 | 说明 | Agent 声明 |
|--------|------|------------|
| smartLayout | 智能布局（核心） | ❌ |
| alignToReference | 对齐到参考 | ❌ |

### 图像协调工具

| 工具名 | 说明 | Agent 声明 |
|--------|------|------------|
| harmonizeLayer | 图像协调（核心） | ❌ |
| quickHarmonize | 快速协调 | ❌ |

### 智能对象工具

| 工具名 | 说明 | Agent 声明 |
|--------|------|------------|
| getSmartObjectInfo | 获取智能对象信息 | ❌ |
| convertToSmartObject | 转换为智能对象 | ❌ |
| editSmartObjectContents | 编辑智能对象内容 | ❌ |
| replaceSmartObjectContents | 替换智能对象内容 | ❌ |
| updateSmartObject | 更新智能对象 | ❌ |
| getSmartObjectLayers | 获取智能对象图层 | ❌ |
| duplicateSmartObject | 复制智能对象 | ❌ |
| rasterizeSmartObject | 栅格化智能对象 | ❌ |

### 详情页设计工具（新）

| 工具名 | 说明 | Agent 声明 |
|--------|------|------------|
| parseDetailPageTemplate | 解析详情页模板 | ❌ |
| detectLayerIssues | 检测图层问题 | ❌ |
| fixLayerIssues | 修复图层问题 | ❌ |
| fillDetailPage | 填充详情页 | ❌ |
| exportDetailPageSlices | 导出详情页切片 | ❌ |

### 局部重绘工具

| 工具名 | 说明 | Agent 声明 |
|--------|------|------------|
| getSelectionMask | 获取选区蒙版 | ❌ |
| applyInpaintingResult | 应用重绘结果 | ❌ |
| getSelectionBounds | 获取选区边界 | ❌ |

### 优化传输工具

| 工具名 | 说明 | Agent 声明 |
|--------|------|------------|
| optimizedImageTransfer | 优化图像传输 | ❌ |
| optimizedMattingImage | 优化抠图图像 | ❌ |

---

## ❌ Agent 声明但 UXP 未实现的工具

### 素材库管理工具（计划中）

| 工具名 | 说明 | 状态 |
|--------|------|------|
| listProjectResources | 列出项目素材 | 🚧 待实现 |
| searchProjectResources | 搜索项目素材 | 🚧 待实现 |
| getProjectStructure | 获取项目结构 | 🚧 待实现 |
| getResourcesByCategory | 按类别获取素材 | 🚧 待实现 |
| getResourceSummary | 获取素材摘要 | 🚧 待实现 |
| getAssetPreview | 获取素材预览 | 🚧 待实现 |
| analyzeAssetContent | 分析素材内容 | 🚧 待实现 |
| recommendAssets | 推荐素材 | 🚧 待实现 |

**注**：这些工具在 Agent 端已声明，但 UXP 端尚未实现。建议优先级：P1（后续迭代）

---

## 📋 改进建议

### 1. **同步 Agent 工具声明** (优先级: P0)

需要在 `useChatActions.ts` 的 `AVAILABLE_TOOLS` 中补充以下工具：

```typescript
// === SKU 排版工具 ===
{ name: 'skuLayout', description: 'SKU 批量排版和导出', params: '{ action, sizes, colors, ... }' },

// === 智能布局工具 ===
{ name: 'smartLayout', description: '智能布局引擎', params: '{ ... }' },
{ name: 'alignToReference', description: '对齐到参考形状', params: '{ ... }' },

// === 图像协调工具 ===
{ name: 'harmonizeLayer', description: '图像色彩协调', params: '{ ... }' },
{ name: 'quickHarmonize', description: '快速协调', params: '{ ... }' },

// === 智能对象工具 ===
{ name: 'getSmartObjectInfo', description: '获取智能对象信息', params: '{ ... }' },
// ... (其他 7 个智能对象工具)

// === 详情页设计工具 ===
{ name: 'parseDetailPageTemplate', description: '解析详情页模板', params: '{ ... }' },
// ... (其他 4 个详情页工具)
```

### 2. **实现素材库管理工具** (优先级: P1)

在 UXP 端实现以下工具：
- `listProjectResources`
- `searchProjectResources`
- `getResourcesByCategory`
- `getAssetPreview`

### 3. **补充辅助工具** (优先级: P2)

- `batchRenameLayers` - 批量重命名
- `batchExport` - 批量导出
- `smartSave` - 智能保存
- `getClippingMaskInfo` - 剪切蒙版信息

---

## 🎯 总结

### 当前状态
- ✅ **基础工具：完整** (文本、图层、画布、效果等)
- ✅ **核心功能：完整** (SKU、智能布局、详情页设计等)
- ⚠️ **声明同步：不完整** (UXP 实现了 85+ 工具，Agent 仅声明了 63 个)
- 🚧 **素材管理：待实现** (Agent 已声明 8 个工具，UXP 未实现)

### 建议行动
1. **立即**：同步 Agent 工具声明，补充缺失的 20+ 工具
2. **本周**：实现素材库管理工具（用户作品索引需要）
3. **下周**：补充批量操作和高级功能工具

---

**文档生成时间**: 2026-02-04  
**版本**: v2.0
