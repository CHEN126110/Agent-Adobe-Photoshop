export type ToolDisplayInfo = {
    name: string;
    icon: string;
    description: string;
};

export const TOOL_NAME_MAP: Record<string, ToolDisplayInfo> = {
    createDocument: { name: '创建文档', icon: '[D]', description: '创建新的 Photoshop 文档。' },
    getDocumentInfo: { name: '读取文档信息', icon: '[D]', description: '读取当前文档的尺寸和基础信息。' },
    listDocuments: { name: '查看文档列表', icon: '[D]', description: '查看当前打开的文档。' },
    switchDocument: { name: '切换文档', icon: '[D]', description: '切换到指定文档。' },
    diagnoseState: { name: '检查 Photoshop 状态', icon: '[S]', description: '检查当前 Photoshop 运行状态。' },

    selectLayer: { name: '选择图层', icon: '[L]', description: '选中指定图层。' },
    getLayerHierarchy: { name: '读取图层结构', icon: '[L]', description: '读取当前文档的图层层级。' },
    getAllTextLayers: { name: '读取文本图层', icon: '[T]', description: '读取当前文档中的文本图层。' },
    getLayerBounds: { name: '读取图层边界', icon: '[L]', description: '读取图层的位置和尺寸。' },
    getLayerProperties: { name: '读取图层属性', icon: '[L]', description: '读取指定图层的属性信息。' },
    moveLayer: { name: '移动图层', icon: '[L]', description: '调整图层位置。' },
    alignLayers: { name: '对齐图层', icon: '[L]', description: '对齐多个图层。' },
    distributeLayers: { name: '分布图层', icon: '[L]', description: '均匀分布多个图层。' },

    getTextContent: { name: '读取文本', icon: '[T]', description: '读取文本图层内容。' },
    setTextContent: { name: '修改文本', icon: '[T]', description: '修改文本图层内容。' },
    getTextStyle: { name: '读取文本样式', icon: '[T]', description: '读取字体、字重、字色等样式。' },
    resolveFontName: { name: '解析字体名称', icon: '[T]', description: '只读解析 Photoshop 可用字体。' },
    setTextStyle: { name: '设置文本样式', icon: '[T]', description: '修改文本图层样式。' },
    createTextLayer: { name: '创建文本图层', icon: '[T]', description: '创建新的文本图层。' },

    renameLayer: { name: '重命名图层', icon: '[L]', description: '修改图层名称。' },
    groupLayers: { name: '编组图层', icon: '[G]', description: '将多个图层编组。' },
    ungroupLayers: { name: '取消编组', icon: '[G]', description: '解散图层组。' },
    reorderLayer: { name: '调整图层顺序', icon: '[L]', description: '调整图层前后顺序。' },
    moveLayerToGroup: { name: '移动到图层组', icon: '[G]', description: '把图层或图层组移动到目标组内。' },
    createClippingMask: { name: '创建剪切蒙版', icon: '[M]', description: '创建剪切蒙版。' },
    releaseClippingMask: { name: '释放剪切蒙版', icon: '[M]', description: '释放剪切蒙版。' },
    createGroup: { name: '创建图层组', icon: '[G]', description: '创建新的图层组。' },

    getCanvasSnapshot: { name: '读取画布快照', icon: '[C]', description: '获取当前画布快照。' },
    getAcceptanceSnapshot: { name: '读取验收快照', icon: '[C]', description: '获取用于验收的画布快照。' },
    getDocumentSnapshot: { name: '读取文档快照', icon: '[C]', description: '获取当前文档快照。' },
    getElementMapping: { name: '分析页面元素', icon: '[A]', description: '识别当前画面中的元素。' },
    analyzeLayout: { name: '分析布局', icon: '[A]', description: '分析当前页面布局结构。' },
    getAnnotatedSnapshot: { name: '读取标注快照', icon: '[C]', description: '获取带标注的画布快照。' },

    removeBackground: { name: '智能抠图', icon: '[I]', description: '移除图片背景。' },
    placeImage: { name: '置入图片', icon: '[I]', description: '把图片放入当前文档。' },

    createRectangle: { name: '创建矩形', icon: '[S]', description: '绘制矩形形状。' },
    createEllipse: { name: '创建椭圆', icon: '[S]', description: '绘制椭圆形状。' },

    undo: { name: '撤销', icon: '[H]', description: '撤销上一步操作。' },
    redo: { name: '重做', icon: '[H]', description: '重做上一步操作。' },
    getHistoryInfo: { name: '读取历史记录', icon: '[H]', description: '查看历史记录。' },

    saveDocument: { name: '保存文档', icon: '[D]', description: '保存当前文档。' },
    quickExport: { name: '快速导出', icon: '[E]', description: '快速导出当前结果。' },
    exportGroup: { name: '导出图层组', icon: '[E]', description: '将指定图层组导出为 PNG 文件。' },
    batchExport: { name: '批量导出', icon: '[E]', description: '批量导出多个结果。' },

    listProjectResources: { name: '查看项目资源', icon: '[R]', description: '查看项目中的资源文件。' },
    searchProjectResources: { name: '搜索项目资源', icon: '[R]', description: '搜索项目资源。' },
    getProjectStructure: { name: '读取项目结构', icon: '[R]', description: '查看项目目录结构。' },
    getResourcesByCategory: { name: '分类资源', icon: '[R]', description: '按类别查看项目资源。' },

    skuLayout: { name: 'SKU 排版', icon: '[K]', description: '生成 SKU 排版。' },
    openProjectFile: { name: '打开项目文件', icon: '[F]', description: '从项目中打开文件。' }
};

export const getToolDisplayInfo = (toolName: string): ToolDisplayInfo => {
    return TOOL_NAME_MAP[toolName] || {
        name: toolName,
        icon: '[*]',
        description: '执行当前操作。'
    };
};
