# DesignEcho MCP 现状与能力缺口分析

**分析时间**: 2026-02-26  
**基于**: 实际代码库扫描

---

## 一、架构概览

```
┌─────────────────────┐     WebSocket      ┌─────────────────────┐
│  DesignEcho Agent   │ ◄────────────────► │  DesignEcho UXP     │
│  (Electron)         │                    │  (Photoshop 插件)   │
│                     │                    │                     │
│  ・tool-executor   │   tool.xxx         │  ・ToolRegistry     │
│  ・RESOURCE_TOOLS  │   (UXP 工具)       │  ・MCPProtocol      │
│  ・Agent 端工具    │                    │  ・tools/list       │
└─────────────────────┘                    └─────────────────────┘
```

- **Agent 端工具**: 不经过 UXP，由 Electron 主进程处理（如 `openProjectFile`、`searchProjectResources`、`listProjectResources` 等）
- **UXP 工具**: 通过 WebSocket 发送 `tool.xxx` 到 UXP 插件执行

---

## 二、UXP 实际注册工具清单（共 86 个）

从 `registry.ts` 统计：

| 分类 | 工具数量 | 工具名称 |
|------|----------|----------|
| 文本 | 4 | getTextContent, setTextContent, getTextStyle, setTextStyle |
| 布局/图层 | 18 | selectLayer, getLayerHierarchy, getAllTextLayers, getLayerBounds, moveLayer, alignLayers, distributeLayers, renameLayer, batchRenameLayers, reorderLayer, groupLayers, ungroupLayers, createClippingMask, releaseClippingMask, getClippingMaskInfo, getAllClippingMasks, createGroup, createTextLayer |
| 画布/文档 | 9 | createDocument, listDocuments, switchDocument, closeDocument, getDocumentInfo, getDocumentSnapshot, createRectangle, createEllipse, getCanvasSnapshot |
| 历史/诊断 | 5 | undo, redo, getHistoryInfo, diagnoseState, getElementMapping |
| 保存/导出 | 5 | saveDocument, quickExport, batchExport, smartSave, analyzeLayout |
| 图像处理 | 12 | removeBackground, applyMattingResult, applyMultiMattingResult, placeImage, getSelectionMask, applyInpaintingResult, getSelectionBounds, transformLayer, quickScale, replaceLayerContent, getOptimizedImage, getMattingImage |
| 图层属性 | 7 | setLayerOpacity, setBlendMode, setLayerFill, duplicateLayer, deleteLayer, lockLayer, getLayerProperties |
| 图层效果 | 5 | addDropShadow, addStroke, addGlow, addGradientOverlay, clearLayerEffects |
| 形态变形 | 9 | extractShapePath, getLayerContour, morphToShape, batchMorphToShape, applyMorphedImage, warpExplorer, exportLayerAsBase64, getSubjectBounds, applyDisplacement |
| SKU | 5 | skuLayout, exportColorConfig, createSkuPlaceholders, getSkuPlaceholders, exportToSkuDir |
| 智能布局 | 2 | smartLayout, alignToReference |
| 模板 | 5 | openTemplate, getTemplateStructure, replaceImagePlaceholder, replaceTextPlaceholder, batchRenderTemplate |
| 图像协调 | 2 | harmonize_layer, quick_harmonize |
| 详情页 | 5 | parseDetailPageTemplate, detectLayerIssues, fixLayerIssues, fillDetailPage, exportDetailPageSlices |
| 智能对象 | 8 | getSmartObjectInfo, convertToSmartObject, editSmartObjectContents, replaceSmartObjectContents, updateSmartObject, getSmartObjectLayers, duplicateSmartObject, rasterizeSmartObject |

---

## 三、Agent 声明 vs UXP 实际 对比

### 3.1 已同步（Agent 声明且可正确调用 UXP）

| Agent 工具名 | UXP 工具名 | 备注 |
|--------------|------------|------|
| harmonizeLayer | harmonize_layer | 通过 TOOL_NAME_ALIASES 映射 |
| quickHarmonize | quick_harmonize | 同上 |

### 3.2 Agent 未声明（UXP 有，Agent 无法被 AI 直接调用）

| UXP 工具名 | 说明 | 优先级 |
|------------|------|--------|
| **extractShapePath** | 提取形状路径 | P2 |
| **getLayerContour** | 获取图层轮廓 | P2 |
| **morphToShape** | 形态变形 | P1 |
| **batchMorphToShape** | 批量形态变形 | P2 |
| **applyMorphedImage** | 应用变形图像 | P1 |
| **warpExplorer** | 扭曲探索 | P2 |
| **exportLayerAsBase64** | 导出图层为 Base64 | P1 |
| **getSubjectBounds** | 获取主体边界 | P1 |
| **applyDisplacement** | 应用位移 | P2 |
| **exportColorConfig** | 导出颜色配置 | P2 |
| **createSkuPlaceholders** | 创建 SKU 占位符 | P2 |
| **getSkuPlaceholders** | 获取 SKU 占位符 | P2 |
| **exportToSkuDir** | 导出到 SKU 目录 | P2 |
| **getTemplateStructure** | 获取模板结构 | P1 |
| **replaceImagePlaceholder** | 替换图片占位符 | P1 |
| **replaceTextPlaceholder** | 替换文本占位符 | P1 |
| **batchRenderTemplate** | 批量渲染模板 | P1 |
| **parseDetailPageTemplate** | 解析详情页模板 | P1 |
| **detectLayerIssues** | 检测图层问题 | P1 |
| **fixLayerIssues** | 修复图层问题 | P1 |
| **fillDetailPage** | 填充详情页 | P1 |
| **exportDetailPageSlices** | 导出详情页切片 | P1 |
| **getSelectionMask** | 获取选区蒙版 | P1 |
| **applyInpaintingResult** | 应用重绘结果 | P1 |
| **getSelectionBounds** | 获取选区边界 | P1 |
| **getOptimizedImage** | 优化图像传输（用于 AI 视觉） | P1 |
| **getMattingImage** | 优化抠图图像传输 | P1 |
| **getAnnotatedSnapshot** | 获取带标注的文档快照 | P2 |

### 3.3 Agent 声明但 Agent 端处理（非 UXP）

| 工具名 | 实现位置 | 说明 |
|--------|----------|------|
| listProjectResources | tool-executor.executeResourceTool | 调用 designEcho.scanDirectory |
| searchProjectResources | 同上 | 调用 designEcho.searchResources |
| openProjectFile | 同上 | 搜索 + 系统打开 |
| getProjectStructure | 同上 | designEcho.getResourceStructure |
| getResourceSummary | 同上 | designEcho.getResourceSummary |
| getAssetPreview | 同上 | designEcho.getResourcePreview |
| generateImage | 同上 | BFL FLUX AI 生成 |

**注**: `analyzeAssetContent`、`recommendAssets`、`getResourcesByCategory` 在 Agent 声明但可能未完整实现。

---

## 四、能力缺口汇总

### 4.1 Agent 工具声明缺口（P0/P1）

**形态变形相关**（袜子形态统一等场景）:
- morphToShape
- applyMorphedImage
- getSubjectBounds
- exportLayerAsBase64

**详情页设计**:
- parseDetailPageTemplate
- detectLayerIssues
- fixLayerIssues
- fillDetailPage
- exportDetailPageSlices

**局部重绘**:
- getSelectionMask
- applyInpaintingResult
- getSelectionBounds

**模板渲染**:
- getTemplateStructure
- replaceImagePlaceholder
- replaceTextPlaceholder
- batchRenderTemplate

**图像传输优化**（AI 视觉分析链路）:
- getOptimizedImage
- getMattingImage

### 4.2 MCP 协议能力缺口

| 能力 | 现状 | 缺口 |
|------|------|------|
| **tools/list** | 从 ToolRegistry 动态获取 | 已完整 |
| **tools/call** | 支持工具调用 | 已完整 |
| **resources/list** | 仅当前文档+图层 | 无项目资源、无选区资源 |
| **resources/read** | document、layer、document/layers | 无选区、无历史记录 |
| **resources/templates** | 2 个模板 | 已扩展 document/layers |
| **prompts** | 7 个（含 sku-batch-analyze 等） | 可增加更多设计工作流 |
| **logging** | 占位 | 未实现级别控制 |

### 4.3 素材库管理缺口

Agent 已声明但实现不完整或依赖外部 API：
- getProjectStructure
- getResourcesByCategory
- getResourceSummary
- analyzeAssetContent
- recommendAssets

---

## 五、建议优先级

| 优先级 | 行动 | 预期收益 |
|--------|------|----------|
| **P0** | 补充 Agent 声明：形态变形、详情页、局部重绘、getOptimizedImage/getMattingImage | AI 可直接调用完整设计链路 |
| **P1** | 补充模板渲染、getAnnotatedSnapshot 声明 | 模板工作流、标注分析 |
| **P2** | 补充 SKU 配置、形态变形进阶工具声明 | 专业 SKU 与形态能力 |
| **P3** | 完善 MCP resources（项目资源、选区） | 外部 MCP 客户端可访问更多资源 |
| **P4** | 实现 analyzeAssetContent、recommendAssets | 智能素材推荐 |

---

## 六、工具名映射表（Agent → UXP）

| Agent 工具名 | UXP 工具名 |
|--------------|------------|
| harmonizeLayer | harmonize_layer |
| quickHarmonize | quick_harmonize |

其余工具名与 UXP 一致，无需映射。
