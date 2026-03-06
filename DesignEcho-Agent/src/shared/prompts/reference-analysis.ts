/**
 * 参考图分析提示词
 * 
 * 用于分析参考图的布局结构，生成可执行的布局指令
 */

/**
 * 参考图布局分析结果
 */
export interface ReferenceLayoutAnalysis {
    /** 布局类型 */
    layoutType: 'center' | 'left-right' | 'top-bottom' | 'grid' | 'custom';
    /** 画布尺寸（推测） */
    canvasSize: {
        width: number;
        height: number;
        aspectRatio: string;  // 如 "1:1", "3:4", "16:9"
    };
    /** 检测到的元素 */
    elements: LayoutElement[];
    /** 对齐组 */
    alignmentGroups: AlignmentGroup[];
    /** 布局建议 */
    suggestions: string[];
}

export interface LayoutElement {
    /** 元素ID（用于后续匹配） */
    id: string;
    /** 元素类型 */
    type: 'main-title' | 'sub-title' | 'body-text' | 'cta' | 'product-image' | 'background' | 'decoration' | 'logo' | 'tag';
    /** 推测内容 */
    content?: string;
    /** 相对位置（百分比） */
    position: {
        x: number;  // 0-100
        y: number;  // 0-100
        width: number;  // 0-100
        height: number;  // 0-100
    };
    /** 样式信息 */
    style?: {
        fontSize?: 'large' | 'medium' | 'small';
        fontWeight?: 'bold' | 'normal';
        color?: string;
        alignment?: 'left' | 'center' | 'right';
    };
    /** 层级（z-index 参考） */
    zIndex: number;
}

export interface AlignmentGroup {
    /** 对齐类型 */
    type: 'horizontal-center' | 'vertical-center' | 'left-align' | 'right-align' | 'top-align' | 'bottom-align';
    /** 包含的元素 ID */
    elementIds: string[];
}

/**
 * 构建参考图分析提示词
 */
export const buildReferenceAnalysisPrompt = (): string => {
    return `你是一位资深电商设计分析专家。请仔细分析这张参考图的布局结构。

## 分析要求

请提取以下信息并以 JSON 格式返回：

### 1. 布局类型 (layoutType)
- "center": 居中对称布局
- "left-right": 左右分栏布局
- "top-bottom": 上下分栏布局  
- "grid": 网格布局
- "custom": 自定义/不规则布局

### 2. 画布尺寸推测 (canvasSize)
根据内容比例推测：
- 电商主图通常 800x800 (1:1)
- 详情图通常 750x1000+ (3:4 或更长)
- Banner 通常 1920x600 (16:5)

### 3. 元素列表 (elements)
识别画面中的每个设计元素：

| 类型 | 说明 |
|------|------|
| main-title | 主标题，字号最大 |
| sub-title | 副标题/卖点 |
| body-text | 正文/说明文字 |
| cta | 行动号召按钮（如"立即购买"） |
| product-image | 产品主图 |
| background | 背景元素 |
| decoration | 装饰元素（标签、图标等） |
| logo | 品牌 Logo |
| tag | 促销标签（如"限时特惠"） |

### 4. 对齐组 (alignmentGroups)
哪些元素是对齐的？

### 5. 布局建议 (suggestions)
这个布局的特点和优势

## 输出格式

请严格按照以下 JSON 格式输出：

\`\`\`json
{
    "layoutType": "center",
    "canvasSize": {
        "width": 800,
        "height": 800,
        "aspectRatio": "1:1"
    },
    "elements": [
        {
            "id": "el-1",
            "type": "main-title",
            "content": "推测的文案内容",
            "position": { "x": 50, "y": 20, "width": 80, "height": 10 },
            "style": { "fontSize": "large", "fontWeight": "bold", "alignment": "center" },
            "zIndex": 10
        }
    ],
    "alignmentGroups": [
        { "type": "horizontal-center", "elementIds": ["el-1", "el-2"] }
    ],
    "suggestions": [
        "主标题居中突出，层级清晰",
        "产品图占据画面主体，视觉冲击强"
    ]
}
\`\`\`

现在，请分析这张参考图：`;
};

/**
 * 构建布局复刻指令生成提示词（增强版）
 */
export const buildLayoutReplicationPrompt = (
    referenceAnalysis: ReferenceLayoutAnalysis,
    currentElements: { name: string; type: string; bounds: any; id?: number; textContent?: string }[]
): string => {
    const canvasWidth = referenceAnalysis.canvasSize.width;
    const canvasHeight = referenceAnalysis.canvasSize.height;
    
    // 计算当前文档的尺寸（取最大边界）
    let docWidth = canvasWidth;
    let docHeight = canvasHeight;
    if (currentElements.length > 0) {
        const maxRight = Math.max(...currentElements.map(e => (e.bounds?.right || 0)));
        const maxBottom = Math.max(...currentElements.map(e => (e.bounds?.bottom || 0)));
        if (maxRight > 0) docWidth = maxRight;
        if (maxBottom > 0) docHeight = maxBottom;
    }
    
    return `你是 Photoshop 布局复刻专家。根据参考图的布局结构，将当前文档的元素调整到相应位置。

## 📐 参考图布局信息

- **布局类型**：${referenceAnalysis.layoutType}
- **参考图尺寸**：${canvasWidth} × ${canvasHeight} px
- **当前文档尺寸**：约 ${docWidth} × ${docHeight} px

### 参考图元素（${referenceAnalysis.elements.length} 个）
${referenceAnalysis.elements.map(el => `
**[${el.id}]** ${el.type}${el.content ? ` - "${el.content}"` : ''}
  └ 位置: X ${el.position.x}% Y ${el.position.y}% | 尺寸: ${el.position.width}% × ${el.position.height}%${el.style ? ` | 样式: ${el.style.fontSize || ''} ${el.style.alignment || ''}` : ''} | 层级: z-${el.zIndex}`).join('\n')}

## 📄 当前文档图层（${currentElements.length} 个）
${currentElements.map((el, i) => `
**${i + 1}. ${el.name}** [ID: ${el.id || 'N/A'}] (${el.type})
  └ 位置: [${el.bounds?.left || 0}, ${el.bounds?.top || 0}] | 尺寸: ${el.bounds?.width || 0} × ${el.bounds?.height || 0}${el.textContent ? ` | 文本: "${el.textContent.slice(0, 30)}..."` : ''}`).join('\n')}

## 🎯 任务流程

### 1️⃣ 元素智能匹配
根据类型和特征匹配：
| 参考图元素类型 | 应匹配的图层类型 | 匹配依据 |
|--------------|-----------------|---------|
| main-title | text | 最大字号文本 |
| sub-title | text | 次大字号文本 |
| body-text | text | 较小字号文本 |
| product-image | pixel/smartObject | 最大面积图像 |
| background | pixel/smartObject | 底层/全画布图像 |
| decoration/tag | shape/text | 小面积装饰元素 |
| cta | text/shape | 按钮样式元素 |
| logo | smartObject/pixel | Logo相关命名 |

### 2️⃣ 坐标转换计算
将参考图的**百分比位置**转换为当前文档的**像素位置**：

\`\`\`
目标 X = (参考图 X% / 100) × 当前文档宽度(${docWidth})
目标 Y = (参考图 Y% / 100) × 当前文档高度(${docHeight})
\`\`\`

### 3️⃣ 可用工具列表

| 工具 | 用途 | 参数示例 |
|------|------|---------|
| selectLayer | 选中图层 | \`{ "layerName": "标题" }\` 或 \`{ "layerId": 123 }\` |
| moveLayer | 移动图层 | \`{ "x": 400, "y": 160, "relative": false }\` |
| setTextStyle | 设置文字样式 | \`{ "fontSize": 48, "alignment": "center" }\` |
| alignLayers | 对齐图层 | \`{ "alignment": "center" }\` (需先多选) |
| reorderLayer | 调整层级 | \`{ "layerId": 123, "position": "front" }\` |

## 📋 输出要求

请输出严格的 JSON 格式：

\`\`\`json
{
    "matching": [
        {
            "referenceElement": "el-1",
            "currentLayerName": "主标题",
            "currentLayerId": 123,
            "confidence": "high",
            "reason": "类型匹配(text→main-title)且位置相近"
        }
    ],
    "actions": [
        {
            "step": 1,
            "tool": "selectLayer",
            "params": { "layerName": "主标题" },
            "description": "选中主标题图层"
        },
        {
            "step": 2,
            "tool": "moveLayer",
            "params": { "x": 400, "y": 80, "relative": false },
            "description": "移动到 X=50%×${docWidth}=400, Y=10%×${docHeight}=80"
        }
    ],
    "summary": "匹配了 N 个元素，生成了 M 个操作步骤"
}
\`\`\`

## ⚠️ 关键规则

1. **每个移动操作前必须先 selectLayer**
2. **使用 relative: false** 进行绝对定位
3. **优先使用 layerId**（更准确），其次 layerName
4. **处理顺序**：背景 → 主图 → 标题 → 装饰元素
5. **跳过无法匹配的元素**，不要强行匹配

现在请分析并生成布局复刻指令：`;
};

/**
 * 解析布局分析结果
 */
export const parseLayoutAnalysis = (response: string): ReferenceLayoutAnalysis | null => {
    try {
        // 尝试提取 JSON 代码块
        const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[1]);
        }
        
        // 尝试直接解析
        const startIndex = response.indexOf('{');
        const endIndex = response.lastIndexOf('}');
        if (startIndex !== -1 && endIndex !== -1) {
            return JSON.parse(response.substring(startIndex, endIndex + 1));
        }
        
        return null;
    } catch (error) {
        console.error('[parseLayoutAnalysis] 解析失败:', error);
        return null;
    }
};

/**
 * 解析复刻指令（增强版）
 */
export const parseReplicationActions = (response: string): { tool: string; params: any }[] => {
    try {
        const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
            const data = JSON.parse(jsonMatch[1]);
            
            // 支持新格式的 actions（包含 step 和 description）
            if (data.actions && Array.isArray(data.actions)) {
                return data.actions.map((action: any) => ({
                    tool: action.tool,
                    params: action.params,
                    description: action.description  // 保留描述用于日志
                }));
            }
            return data.actions || [];
        }
        return [];
    } catch (error) {
        console.error('[parseReplicationActions] 解析失败:', error);
        return [];
    }
};
