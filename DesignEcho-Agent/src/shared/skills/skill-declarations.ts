import { SkillDeclaration } from '../types/skill.types';

const boolParam = (name: string, description: string, defaultValue?: boolean) => ({
    name,
    type: 'boolean' as const,
    description,
    required: false,
    ...(defaultValue === undefined ? {} : { default: defaultValue })
});

const strParam = (
    name: string,
    description: string,
    required = false,
    extra: Partial<{ enum: string[]; default: string; examples: any[] }> = {}
) => ({
    name,
    type: 'string' as const,
    description,
    required,
    ...extra
});

const numParam = (
    name: string,
    description: string,
    required = false,
    extra: Partial<{ default: number; examples: any[] }> = {}
) => ({
    name,
    type: 'number' as const,
    description,
    required,
    ...extra
});

const arrParam = (
    name: string,
    description: string,
    required = false,
    extra: Partial<{ examples: any[]; default: any[] }> = {}
) => ({
    name,
    type: 'array' as const,
    description,
    required,
    ...extra
});

const objParam = (name: string, description: string, required = false) => ({
    name,
    type: 'object' as const,
    description,
    required
});

export const MatteProductSkill: SkillDeclaration = {
    id: 'matte-product',
    name: 'Smart Matting',
    category: 'image',
    kind: 'operation',
    visibility: 'user-facing',
    description: 'Remove image background and extract the product subject.',
    whenToUse: [
        'User asks to remove background',
        'User asks to isolate product from a photo'
    ],
    whenNotToUse: [
        'Image already has transparent background',
        'User only asks for crop or resize'
    ],
    routing: {
        intentSignals: ['抠图', '去背景', '去背', 'remove background', 'matte'],
        negativeSignals: ['裁剪', '缩放', '详情页', '主图模板'],
        preconditions: ['需要当前图层、文件路径或项目资源作为输入'],
        supportedModes: ['execute'],
        parameterExtractionHints: ['抽取 sourceType、outputMode、filePath'],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['如果输入来源不明确，先问用户是当前图层还是指定文件'],
        routeStatusMessages: {
            deterministic: '检查当前图层和边缘情况，准备开始抠图。',
            autonomous: '检查当前图层和边缘情况后处理抠图。'
        }
    },
    parameters: [
        strParam('targetPrompt', 'Optional target description for subject extraction'),
        strParam('sourceType', 'Image source', true, {
            enum: ['current_layer', 'file_path', 'project_resource'],
            default: 'current_layer'
        }),
        strParam('filePath', 'Local file path when sourceType requires it'),
        strParam('outputMode', 'Output mode', false, {
            enum: ['new_layer', 'replace', 'mask'],
            default: 'new_layer'
        }),
        strParam('userIntent', 'Original user request')
    ],
    output: {
        type: 'layer',
        description: 'Matted transparent layer.'
    },
    requiredTools: ['removeBackground', 'getCanvasSnapshot', 'placeImage'],
    examples: [
        {
            userSays: '帮我抠图',
            parameters: { sourceType: 'current_layer', outputMode: 'new_layer' }
        }
    ],
    estimatedTime: 5,
    hasDecisionPoints: true
};

export const SmartLayoutSkill: SkillDeclaration = {
    id: 'smart-layout',
    name: 'Smart Layout',
    category: 'layout',
    kind: 'operation',
    visibility: 'user-facing',
    description: 'Reposition and resize a layer according to layout constraints.',
    whenToUse: ['User asks to center, align, or resize layer automatically'],
    parameters: [
        numParam('layerId', 'Target layer id'),
        numParam('fillRatio', 'Canvas fill ratio', false, { default: 0.85, examples: [0.75, 0.85, 0.9] }),
        strParam('alignment', 'Alignment mode', false, {
            enum: ['center', 'bottom-center', 'top-center'],
            default: 'center'
        }),
        strParam('productType', 'Optional product type')
    ],
    output: {
        type: 'layer',
        description: 'Updated layer layout.'
    },
    requiredTools: ['smartLayout', 'getLayerBounds', 'getDocumentInfo'],
    examples: [
        {
            userSays: '把产品居中并缩放到合适比例',
            parameters: { fillRatio: 0.85, alignment: 'center' }
        }
    ],
    estimatedTime: 2
};

export const SKUConfigSkill: SkillDeclaration = {
    id: 'sku-config',
    name: 'SKU Config Prep',
    category: 'batch',
    kind: 'operation',
    visibility: 'user-facing',
    description: 'Prepare SKU workflow by exporting colors and creating placeholders.',
    whenToUse: ['User asks to export color config or create SKU placeholders'],
    parameters: [
        strParam('action', 'SKU config action', true, {
            enum: ['exportColors', 'createPlaceholders', 'getPlaceholders']
        }),
        numParam('placeholderCount', 'Placeholder count for createPlaceholders'),
        strParam('layout', 'Placeholder layout', false, {
            enum: ['horizontal', 'vertical', 'grid'],
            default: 'horizontal'
        })
    ],
    output: {
        type: 'data',
        description: 'Color config or placeholder metadata.'
    },
    requiredTools: ['exportColorConfig', 'createSkuPlaceholders', 'getSkuPlaceholders'],
    examples: [
        {
            userSays: '导出颜色配置',
            parameters: { action: 'exportColors' }
        }
    ],
    estimatedTime: 2
};

export const SKUBatchSkill: SkillDeclaration = {
    id: 'sku-batch',
    name: 'SKU Batch',
    category: 'batch',
    kind: 'workflow',
    visibility: 'user-facing',
    description: 'Generate SKU combination images in batch.',
    whenToUse: ['User asks to create multi-color/multi-combo SKU images'],
    routing: {
        intentSignals: ['SKU', '批量配色', '批量出图', '批量生成', '组合图', '自选备注', '备注图', '双装', '单双装'],
        negativeSignals: ['详情页', '主图模板', '文档关闭'],
        preconditions: ['需要 SKU 源文件或组合模板'],
        supportedModes: ['execute'],
        parameterExtractionHints: ['抽取 comboSizes、countPerSize、specifiedColors、onlyNotes'],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['如果组合规格或颜色不明确，先问用户需要哪些组合'],
        decisionGuidance: [
            '如果用户只要自选备注或备注图，设置 onlyNotes=true。',
            '普通“帮我做 SKU”默认生成每规格 5 个组合，并同时生成对应自选备注。',
            '只有用户明确说“只要组合”“仅组合”“不需要自选备注”“不要备注图”时，才关闭 generateNotes。',
            '“我还需要对应的 SKU 自选备注”是补备注任务，设置 onlyNotes=true，不要把 SKU 这个领域词误判为新增颜色组合。',
            '如果用户说“2-3-4 的自选备注”之类，提取 comboSizes=[2,3,4]。',
            '1双/单双不生成自选备注，因为 1双 SKU 已经逐个覆盖全部颜色。',
            '如果用户是在已有 SKU 任务上追加组合，优先理解为追加而不是整体覆盖。'
        ],
        routeStatusMessages: {
            deterministic: '确认当前项目、SKU 文档和模板后处理 SKU。'
        }
    },
    parameters: [
        arrParam('comboSizes', 'Combination size list, e.g. [2,3,4]'),
        numParam('countPerSize', 'Combinations generated per size', false, { default: 5 }),
        boolParam('generateNotes', 'Whether to generate note images alongside SKU renders; defaults to true for normal SKU requests unless the user explicitly asks for combo-only output', true),
        boolParam('onlyNotes', 'Generate note images only without SKU layout', false),
        strParam('templateKeyword', 'Optional template keyword for combo layout'),
        strParam('skuFileKeyword', 'Keyword for SKU source files', false, { default: 'SKU' }),
        arrParam('specifiedColors', 'Optional explicit color combinations'),
        strParam('userIntent', 'Original user request')
    ],
    output: {
        type: 'files',
        description: 'Exported SKU images.'
    },
    requiredTools: ['skuLayout', 'listDocuments', 'quickExport', 'exportToSkuDir'],
    examples: [
        {
            userSays: '帮我批量做 SKU',
            parameters: { comboSizes: [2, 3], countPerSize: 2 }
        }
    ],
    estimatedTime: 30,
    hasDecisionPoints: true
};

export const ShapeMorphingSkill: SkillDeclaration = {
    id: 'shape-morphing',
    name: 'Shape Morphing',
    category: 'morphing',
    kind: 'operation',
    visibility: 'system-only',
    description: 'Internal morphology-normalization operation used by the retouching panel, not a general user-facing agent skill.',
    whenToUse: ['Internal panel workflow triggers shape normalization with an explicit reference shape and product layer set'],
    whenNotToUse: [
        'User asks for general design help in chat',
        'Reference shape or target product layers are not explicitly selected',
        'Task is an open-ended design request rather than a constrained retouching operation'
    ],
    parameters: [
        numParam('targetShapeLayerId', 'Reference shape layer id', true),
        arrParam('sourceLayerIds', 'Source product layer ids for batch morphing', false),
        numParam('sourceLayerId', 'Single source product layer id', false),
        numParam('edgeBandWidth', 'Edge-band warp width in pixels', false, { default: 50 }),
        numParam('transitionWidth', 'Transition band width in pixels', false, { default: 30 }),
        numParam('patternProtection', 'Pattern protection strength 0-1', false, { default: 0.8 }),
        boolParam('detectPatterns', 'Detect patterned areas automatically', true),
        boolParam('detectLace', 'Detect lace/cuff structure automatically', true),
        strParam('alignmentMethod', 'Alignment strategy', false, {
            enum: ['centroid', 'boundingBox', 'auto'],
            default: 'auto'
        }),
        strParam('qualityPreset', 'Quality preset', false, {
            enum: ['fast', 'balanced', 'quality'],
            default: 'balanced'
        })
    ],
    output: {
        type: 'layers',
        description: 'Shape-normalized layers or a preparation result for the internal morphing pipeline.'
    },
    requiredTools: ['morphToShape', 'batchMorphToShape'],
    examples: [
        {
            userSays: '内部面板将多个袜子图层统一到一个参考形状',
            parameters: { targetShapeLayerId: 101, sourceLayerIds: [201, 202], qualityPreset: 'balanced' }
        }
    ],
    estimatedTime: 20,
    hasDecisionPoints: true
};

export const LayoutReplicationSkill: SkillDeclaration = {
    id: 'layout-replication',
    name: 'Layout Replication',
    category: 'replication',
    kind: 'workflow',
    visibility: 'user-facing',
    description: 'Replicate layout from a reference image to current canvas.',
    whenToUse: ['User asks to copy layout style or structure from sample design'],
    routing: {
        intentSignals: [
            '参考图',
            '复刻',
            '照着做',
            '按图做',
            '仿照',
            '同款版式',
            '参考海报',
            '参考图做设计',
            'reference image',
            'reference design',
            'attached reference',
            'use the attached reference',
            'copy layout',
            'replicate layout',
            'rebuild similar',
            'same layout',
            'design target'
        ],
        intentSignalGroups: [
            ['参考图', '样图', '海报', '版式', '布局', '风格', 'reference image', 'reference design', 'attached reference', 'design target', 'layout', 'style'],
            ['复刻', '照着做', '按图做', '仿照', '复现', '生成', 'replicate', 'copy layout', 'rebuild', 'similar', 'same layout']
        ],
        negativeSignals: ['关闭文档', '不保存', 'SKU', '抠图', '只问模型'],
        preconditions: ['需要用户提供参考图，或当前上下文已经附带参考图'],
        supportedModes: ['execute'],
        parameterExtractionHints: ['抽取 outputMode、templateApply、templateBlueprintOnly、projectPath、outputWidth、outputHeight、是否保持参考图尺寸'],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['如果没有参考图，明确提示需要提供参考图而不是假装继续执行'],
        routeStatusMessages: {
            deterministic: '分析参考图的布局和元素关系，并决定复刻到当前画布还是生成可编辑骨架。'
        }
    },
    parameters: [
        strParam('mode', 'Input mode', false, {
            enum: ['current', 'local', 'url'],
            default: 'current'
        }),
        strParam('filePath', 'Local reference image path'),
        strParam('url', 'Reference image url'),
        strParam('outputMode', 'Execution output mode', false, {
            enum: ['apply', 'template_blueprint', 'template_apply'],
            default: 'apply'
        }),
        boolParam('templateBlueprintOnly', 'Analyze reference and output detail template blueprint only', false),
        boolParam('templateApply', 'Analyze reference and apply editable detail template skeleton', false),
        boolParam('autoCreateDocument', 'Auto-create document when applying template and no doc is open', true),
        numParam('outputWidth', 'Explicit output canvas width when auto-creating document'),
        numParam('outputHeight', 'Explicit output canvas height when auto-creating document'),
        boolParam('preserveReferenceCanvasSize', 'Auto-create document using the reference image canvas size', false),
        boolParam('matchReferenceCanvasSize', 'Alias for preserveReferenceCanvasSize', false),
        strParam('projectPath', 'Project path used for auto image matching and filling after template apply'),
        boolParam('autoFillAfterApply', 'Auto match images and fill placeholders after template apply', true),
        numParam('minAutoFillPlanScore', 'Auto-fill minimum plan score threshold (0-1)', false, { default: 0.62 }),
        numParam('minAutoFillImageCoverage', 'Auto-fill minimum matched-image coverage threshold (0-1)', false, { default: 0.6 }),
        boolParam('allowLowConfidenceFill', 'Allow low-confidence auto-fill to place images directly', true),
        boolParam('copyTypography', 'Apply typography from reference', true),
        boolParam('copySpacing', 'Apply spacing from reference', true)
    ],
    output: {
        type: 'document',
        description: 'Canvas updated with replicated layout.'
    },
    requiredTools: [
        'getDocumentInfo',
        'createDocument',
        'getElementMapping',
        'createTextLayer',
        'createRectangle',
        'addStroke',
        'setLayerOpacity',
        'groupLayers',
        'matchDetailPageContent',
        'fillDetailPage'
    ],
    examples: [
        {
            userSays: '按这张图复刻布局',
            parameters: { mode: 'local', filePath: 'D:/ref/layout.jpg' }
        }
    ],
    estimatedTime: 8,
    hasDecisionPoints: true
};

export const DesignReferenceSearchSkill: SkillDeclaration = {
    id: 'design-reference-search',
    name: 'Design Reference Search',
    category: 'analysis',
    kind: 'operation',
    visibility: 'user-facing',
    description: 'Search and fetch design references for the requested style.',
    whenToUse: ['User asks for visual style references'],
    parameters: [
        strParam('query', 'Search query', true),
        strParam('mode', 'Search mode', false, {
            enum: ['search', 'fetchUrl'],
            default: 'search'
        }),
        strParam('url', 'URL to fetch when mode is fetchUrl'),
        numParam('limit', 'Result limit', false, { default: 8 })
    ],
    output: {
        type: 'data',
        description: 'Reference list and metadata.'
    },
    requiredTools: ['searchDesigns', 'fetchWebPageDesignContent'],
    examples: [
        {
            userSays: '找一些极简运动风参考图',
            parameters: { query: 'minimal sports ecommerce detail page', mode: 'search', limit: 8 }
        }
    ],
    estimatedTime: 5
};

export const VisualAnalysisSkill: SkillDeclaration = {
    id: 'visual-analysis',
    name: 'Visual Analysis',
    category: 'analysis',
    kind: 'operation',
    visibility: 'user-facing',
    description: 'Analyze style, color, composition and elements from image input.',
    whenToUse: ['User asks visual analysis for local image or current document'],
    parameters: [
        strParam('sourceType', 'Image source type', true, {
            enum: ['local_file', 'active_document', 'base64'],
            default: 'active_document'
        }),
        strParam('filePath', 'Local image path when sourceType is local_file'),
        strParam('analysisFocus', 'Analysis focus', false, {
            enum: ['general', 'style', 'color', 'layout', 'elements'],
            default: 'general'
        })
    ],
    output: {
        type: 'data',
        description: 'Visual analysis JSON report.'
    },
    requiredTools: ['getCanvasSnapshot', 'visual:analyzeLocalImage', 'visual:analyzeBase64Image'],
    examples: [
        {
            userSays: '分析这个海报的构图',
            parameters: { sourceType: 'local_file', filePath: 'D:/project/poster.jpg', analysisFocus: 'layout' }
        }
    ],
    estimatedTime: 5
};

export const ProjectImageAnalysisSkill: SkillDeclaration = {
    id: 'project-image-analysis',
    name: 'Project Image Analysis',
    category: 'analysis',
    kind: 'workflow',
    visibility: 'user-facing',
    description: 'Analyze images already scanned from the current project and summarize style, features, and detail-page direction.',
    whenToUse: [
        'User asks to understand project images or source photos',
        'User asks what style, features, or selling points can be inferred from project images',
        'User asks how the current project images can be used for detail-page design'
    ],
    whenNotToUse: [
        'User already uploaded a specific image and only wants single-image editing',
        'No project is loaded and no project images are available'
    ],
    routing: {
        intentSignals: [
            '项目中的图片',
            '项目里的图片',
            '项目图片',
            '项目素材',
            '这些图片',
            '这些图',
            '这些照片',
            '这些素材',
            '图片内容',
            '原图分析',
            '项目原图',
            '当前项目',
            '这个项目',
            '什么项目',
            '项目类型',
            '项目概况',
            '项目概览',
            '项目内容',
            '项目资源',
            '资源列表',
            '素材列表',
            '都有些什么',
            '有些什么',
            '都有啥',
            'regex:(?:当前|这个).{0,8}(?:项目|project)'
        ],
        intentSignalGroups: [
            ['项目中的图片', '项目里的图片', '项目图片', '项目素材', '项目原图', '原图', '文件夹图片', '图片资源', '图片内容', '项目内容', '项目资源', '资源列表', '素材列表', '这些图片', '这些图', '这些照片', '这些素材', '当前项目', '这个项目', 'regex:(?:当前|这个).{0,8}(?:项目|project)'],
            ['分析', '理解', '看一下', '看看', '描述', '总结', '内容', '识别', '判断', '款式', '特征', '卖点', '详情页', '可以做什么', '是什么', '什么项目', '项目类型', '项目概况', '项目概览', '项目内容', '项目资源', '都有什么', '都有些什么', '有些什么', '都有啥', '有什么', '有哪些', '包含什么', '包括什么', '文件夹', '目录结构', '项目结构', '品类', '类目', '风格']
        ],
        negativeSignals: ['上传图片', '单张图片编辑', '主图模板创建', '进度', '完成了吗', '还剩', '剩余', '下一步', '下一项', '代码', '仓库', '工程', '架构'],
        preconditions: ['需要当前项目已扫描到图片'],
        supportedModes: ['execute'],
        parameterExtractionHints: ['抽取 sampleSize、focus、directories'],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['如果项目上下文不存在，先问用户当前要分析哪个项目'],
        decisionGuidance: [
            '如果最近对话已经在讨论项目图片，后续关于款式、特征、卖点、详情页方向的问题仍继续路由到本 skill。',
            '当前项目已经有已扫描图片时，不要要求用户重新上传图片。'
        ],
        routeStatusMessages: {
            deterministic: '读取项目图片样本，分析款式、特征和后续可用于详情页的方向。',
            autonomous: '理解项目图片内容，判断款式特征和后续设计方向。'
        }
    },
    parameters: [
        numParam('sampleSize', 'How many project images to analyze', false, { default: 6 }),
        strParam('focus', 'Analysis focus', false, {
            enum: ['general', 'style-and-detail-page', 'style', 'detail-page', 'inventory'],
            default: 'style-and-detail-page'
        }),
        strParam('analysisMode', 'Analysis mode. Use inventory for fast project resource overview without visual model calls.', false, {
            enum: ['content', 'inventory'],
            default: 'content'
        }),
        arrParam('directories', 'Optional project directories to prioritize when selecting images'),
        strParam('userIntent', 'Original user request')
    ],
    output: {
        type: 'data',
        description: 'Aggregated project-image analysis and detail-page suggestions.'
    },
    requiredTools: ['analyzeAssetContent'],
    examples: [
        {
            userSays: '理解一下项目里的图片，看看这款是什么款式，有哪些特征，后续详情页可以怎么做',
            parameters: { sampleSize: 6, focus: 'style-and-detail-page' }
        }
    ],
    estimatedTime: 12,
    hasDecisionPoints: true
};

export const LayerManagementSkill: SkillDeclaration = {
    id: 'layer-management',
    name: 'Layer Management',
    category: 'layout',
    kind: 'operation',
    visibility: 'user-facing',
    description: 'Perform deterministic Photoshop layer management operations such as selecting, renaming, deleting, duplicating, grouping, and changing stack order.',
    whenToUse: [
        'User asks to select, rename, delete, duplicate, group, ungroup, or move existing Photoshop layers into a group',
        'User asks to move layers up/down/top/bottom or above/below another layer in the Photoshop layer stack',
        'User asks to sort color layers from light to dark or dark to light in layer panel order',
        'User asks how many product color layers exist in the current Photoshop document'
    ],
    whenNotToUse: [
        'User asks to move a layer on the canvas by x/y position',
        'User asks to create a whole design, detail page, main image, or SKU batch',
        'User asks to save, close, switch, or create documents'
    ],
    routing: {
        intentSignals: ['图层顺序', '图层层级', '调整图层', '选中图层', '选择图层', '重命名图层', '删除图层', '复制图层', '图层编组', '解除编组', '置顶', '置底', '上移图层', '下移图层', '移到上方', '移到下方', '从浅到深', '从深到浅', '几个颜色', '多少个颜色', '颜色图层', '几个图层', '隐藏图层', '看不到图层', 'layer order', 'rename layer', 'delete layer', 'duplicate layer', 'group layers'],
        negativeSignals: ['保存文档', '关闭文档', '详情页', '主图', 'SKU', '自选备注', '抠图', '形态统一'],
        preconditions: ['需要 Photoshop 当前文档存在，且目标图层可通过 layerId、layerName、当前选择或图层层级读取确定'],
        supportedModes: ['select', 'rename', 'delete', 'duplicate', 'group', 'ungroup', 'move-to-group', 'reorder', 'inspect'],
        modeSignals: {
            select: ['选中图层', '选择图层', '定位图层', 'focus layer', 'select layer'],
            rename: ['重命名图层', '图层改名', 'rename layer'],
            delete: ['删除图层', '删掉图层', 'delete layer'],
            duplicate: ['复制图层', '拷贝图层', 'duplicate layer'],
            group: ['图层编组', '编组图层', 'group layers'],
            ungroup: ['解除编组', '取消编组', 'ungroup'],
            'move-to-group': ['移动到组', '放到组内', '移入图层组', 'move into group'],
            reorder: ['图层顺序', '图层层级', '置顶', '置底', '上移图层', '下移图层', '移到上方', '移到下方', '从浅到深', '从深到浅', 'layer order'],
            inspect: ['几个颜色', '多少个颜色', '颜色图层', '几个图层', '隐藏图层', '看不到图层', '查看图层', '读取图层']
        },
        parameterExtractionHints: ['抽取 action、layerId、layerIds、layerName、targetLayerId、targetLayerName、newName、reorderAction、sortBy、sortDirection、inspectMode'],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['如果目标图层不明确，先返回候选图层让用户确认，不要盲改'],
        decisionGuidance: [
            '改变 Photoshop 图层面板堆叠顺序必须使用 reorderLayer，不要使用 moveLayer。',
            '改变父子层级、把图层放入某个组内时使用 moveLayerToGroup，不要使用 moveLayer。',
            'moveLayer 只用于画布 x/y 位置移动，不适用于“置顶/置底/上移/下移/从浅到深排序”。',
            '如果用户说“从浅到深/从深到浅”，先读取图层层级和图层属性，只在能从图层名称或属性推断明暗时执行。',
            '如果用户问当前文档有几个颜色，使用 inspectMode=color-layers，并读取隐藏图层；不要把背景、选区、蒙版、参考层计入商品颜色。',
            '如果用户追问隐藏图层或图层数量，仍然属于 Photoshop 状态读取，不应被普通聊天问答吞掉。'
        ],
        routeStatusMessages: {
            deterministic: '读取图层层级，按明确目标执行图层管理操作并复核。',
            autonomous: '读取图层层级后处理图层管理操作。'
        }
    },
    parameters: [
        strParam('action', 'Layer management action', true, {
            enum: ['select', 'rename', 'delete', 'duplicate', 'group', 'ungroup', 'move-to-group', 'reorder', 'inspect']
        }),
        numParam('layerId', 'Target layer id'),
        arrParam('layerIds', 'Target layer ids'),
        strParam('layerName', 'Target layer name'),
        strParam('targetDescription', 'Natural-language target layer description'),
        strParam('newName', 'New layer name for rename or duplicate'),
        strParam('reorderAction', 'Stack order action', false, {
            enum: ['up', 'down', 'top', 'bottom', 'above', 'below']
        }),
        numParam('targetLayerId', 'Reference layer id for above/below reorder'),
        numParam('targetGroupId', 'Target group id for move-to-group'),
        strParam('targetLayerName', 'Reference layer name for above/below reorder'),
        strParam('targetGroupName', 'Target group name for move-to-group'),
        strParam('sortBy', 'Sort strategy for reorder', false, {
            enum: ['lightness']
        }),
        strParam('sortDirection', 'Sort direction', false, {
            enum: ['light-to-dark', 'dark-to-light']
        }),
        strParam('inspectMode', 'Inspection mode for layer analysis', false, {
            enum: ['color-layers']
        }),
        strParam('userIntent', 'Original user request')
    ],
    output: {
        type: 'data',
        description: 'Layer management execution result with actual tool evidence.'
    },
    requiredTools: [
        'getDocumentInfo',
        'getLayerHierarchy',
        'getLayerProperties',
        'selectLayer',
        'renameLayer',
        'deleteLayer',
        'duplicateLayer',
        'groupLayers',
        'ungroupLayers',
        'moveLayerToGroup',
        'reorderLayer',
        'getAcceptanceSnapshot'
    ],
    examples: [
        {
            userSays: '把图层的颜色从浅到深，从上到下调整图层顺序',
            parameters: { action: 'reorder', sortBy: 'lightness', sortDirection: 'light-to-dark' }
        },
        {
            userSays: '把当前选中的图层置顶',
            parameters: { action: 'reorder', reorderAction: 'top' }
        },
        {
            userSays: '当前文档中的图层是几个颜色',
            parameters: { action: 'inspect', inspectMode: 'color-layers' }
        }
    ],
    estimatedTime: 4,
    hasDecisionPoints: false
};

export const FindEditElementSkill: SkillDeclaration = {
    id: 'find-and-edit-element',
    name: 'Find And Edit Element',
    category: 'analysis',
    kind: 'workflow',
    visibility: 'user-facing',
    description: 'Locate canvas element by visual-language description and edit it safely.',
    whenToUse: [
        'User can see an element on canvas but does not know its layer path',
        'User asks to edit top-right text, center image, corner icon and similar visual targets'
    ],
    whenNotToUse: [
        'User already gives a concrete layerId and asks for direct single-tool operation',
        'User asks to generate whole design set instead of editing an existing element'
    ],
    routing: {
        intentSignals: ['右上角文案', '左上角文案', '顶部标题', '底部按钮', '中间图片', '画布上的文字', '页面上的价格', '把文案改成', '把文字改成', '替换图片', '选中这个元素', '定位这个元素'],
        negativeSignals: ['图层顺序', '图层层级', '置顶', '置底', '保存文档', '关闭文档', '详情页', '主图', 'SKU', '批量'],
        preconditions: ['需要 Photoshop 当前文档存在，并且 getElementMapping 能返回可编辑元素映射'],
        supportedModes: ['locate', 'select', 'setText', 'move', 'scale', 'setOpacity', 'setBlendMode', 'replaceImage'],
        modeSignals: {
            locate: ['定位', '找到', '看看哪个元素'],
            select: ['选中', '选择'],
            setText: ['改成', '改为', '替换成', '换成', '写成', '设置为', '修改为'],
            move: ['移动', '挪到'],
            scale: ['放大', '缩小', '缩放'],
            setOpacity: ['透明度', '不透明度'],
            setBlendMode: ['混合模式'],
            replaceImage: ['替换图片', '换图']
        },
        parameterExtractionHints: ['抽取 targetDescription、action、text、layerId、x、y、dx、dy、scalePercent、opacity、blendMode、filePath'],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['候选分数不足或候选差距过小时，先让用户确认候选，不要盲改'],
        decisionGuidance: [
            '用户描述的是画布视觉位置和元素语义时，优先用 getElementMapping 定位，而不是直接猜 layerId。',
            '用户说“改成/改为/替换成”并且目标是文案/文字/标题/价格时，action 应为 setText。',
            '用户说“图层顺序/置顶/置底/从浅到深”时不要使用本能力，应交给 layer-management。'
        ]
    },
    parameters: [
        strParam('targetDescription', 'Visual description of target element', true),
        strParam('action', 'Edit action', false, {
            enum: ['locate', 'select', 'setText', 'move', 'scale', 'setOpacity', 'setBlendMode', 'replaceImage'],
            default: 'locate'
        }),
        strParam('selectionMode', 'Candidate handling strategy', false, {
            enum: ['auto', 'suggest', 'force'],
            default: 'auto'
        }),
        numParam('layerId', 'Explicit target layer id if already known'),
        strParam('text', 'New text when action is setText'),
        numParam('x', 'Absolute x for move'),
        numParam('y', 'Absolute y for move'),
        numParam('dx', 'Relative move offset x'),
        numParam('dy', 'Relative move offset y'),
        numParam('scalePercent', 'Scale percent for scale action'),
        numParam('opacity', 'Opacity for setOpacity action'),
        strParam('blendMode', 'Blend mode for setBlendMode action'),
        strParam('filePath', 'Image path for replaceImage action')
    ],
    output: {
        type: 'data',
        description: 'Selected layer info, candidate list (if needed), and execution result.'
    },
    requiredTools: [
        'getElementMapping',
        'selectLayer',
        'setTextContent',
        'moveLayer',
        'transformLayer',
        'setLayerOpacity',
        'setBlendMode',
        'replaceLayerContent'
    ],
    examples: [
        {
            userSays: '把右上角价格文案改成 到手价 39',
            parameters: { targetDescription: '右上角价格文案', action: 'setText', text: '到手价 39' }
        }
    ],
    estimatedTime: 4,
    hasDecisionPoints: true
};

export const AgentPanelBridgeSkill: SkillDeclaration = {
    id: 'agent-panel-bridge',
    name: 'Agent Panel Bridge',
    category: 'analysis',
    kind: 'debug',
    visibility: 'internal-debug',
    description: 'Bridge debugging with agent panel and produce structured MCP-oriented actions.',
    whenToUse: [
        'User asks to debug with agent panel interaction',
        'User cannot describe issue clearly and needs guided troubleshooting workflow'
    ],
    whenNotToUse: [
        'Single straightforward tool execution without iterative debugging',
        'Pure casual chat without implementation or diagnosis task'
    ],
    routing: {
        intentSignals: ['agent 面板', '智能体面板', '桥接调试', 'MCP 调试', '联调', 'websocket'],
        negativeSignals: ['关闭文档', '切换文档', '改字体', '详情页模板', '主图模板'],
        preconditions: ['需要明确是在调试桌面端、面板、MCP 或桥接链路'],
        supportedModes: ['execute'],
        parameterExtractionHints: ['抽取 goal、symptom、expectedResult、reproSteps、constraints'],
        retryPolicy: 're-evaluate',
        clarificationHints: ['如果调试目标不明确，先问用户当前现象和期望结果'],
        decisionGuidance: [
            '只有在用户明确提到面板、MCP、bridge、websocket 或联调时，才路由到这个 internal-debug skill。',
            '普通 Photoshop 操作不能路由到这个 skill。'
        ],
        routeStatusMessages: {
            deterministic: '检查桌面端、面板和工具链路以定位问题。',
            autonomous: '检查桌面端、面板和工具链路以定位问题。'
        }
    },
    parameters: [
        strParam('goal', 'Primary goal to implement or debug', true),
        strParam('symptom', 'Observed issue or failure symptom'),
        strParam('expectedResult', 'Expected successful outcome'),
        arrParam('reproSteps', 'Minimal reproduction steps'),
        arrParam('constraints', 'Restrictions and guardrails'),
        boolParam('needMcpTools', 'Whether to retrieve MCP tool list first', true),
        strParam('mcpToolName', 'Optional MCP tool name to call directly'),
        objParam('mcpArguments', 'Arguments for mcpToolName')
    ],
    output: {
        type: 'data',
        description: 'Structured bridge message, MCP context, verification criteria, and next-step checklist.'
    },
    requiredTools: ['mcp:tools:list', 'mcp:tools:call'],
    examples: [
        {
            userSays: '帮我和面板一起调试详情页文案溢出',
            parameters: { goal: '定位并修复详情页文案溢出', needMcpTools: true }
        }
    ],
    estimatedTime: 3,
    hasDecisionPoints: true
};

export const DocumentManagementSkill: SkillDeclaration = {
    id: 'document-management',
    name: 'Document Management',
    category: 'document',
    kind: 'operation',
    visibility: 'user-facing',
    description: 'Perform deterministic Photoshop document operations such as listing, switching, creating, saving, or closing documents.',
    whenToUse: [
        'User asks to save or export the current Photoshop document',
        'User asks to save a document as PSD/PSB or into the current project',
        'User asks to close the current document',
        'User asks to close a document without saving',
        'User asks to switch to another already-open document',
        'User asks to list the currently open Photoshop documents',
        'User asks to create a new plain document'
    ],
    whenNotToUse: [
        'User asks to save the current document as a reusable template',
        'User asks to debug the desktop panel or MCP chain',
        'User asks to build a design template such as detail-page or main-image template'
    ],
    routing: {
        intentSignals: ['保存文档', '保存当前文档', '保存到项目', '保存为 PSD', '保存PSD', '存一下', '保存一下', '导出当前文档', '当前文档导出', '文档导出', '导出为 PNG', '导出PNG', '导出成PNG', '导出为 JPG', '导出JPG', '导出成JPG', '导出为 PDF', '导出PDF', '导出成PDF', '关闭文档', '关掉文档', '切换文档', '列出文档', '列出当前文档', '查看文档列表', '有哪些文档', '新建文档', 'save document', 'save psd', 'export document', 'export png', 'export jpg', 'export pdf', 'close document', 'switch document', 'list documents', 'create document'],
        negativeSignals: ['保存模板', '加入模板库', '加入设计库', '另存为模板', '详情页模板', '主图模板', '面板调试', 'MCP 调试'],
        preconditions: ['save/close/switch/list 需要 Photoshop 已连接；save/close/switch 需要目标文档存在'],
        supportedModes: ['save', 'close', 'switch', 'list', 'create'],
        modeSignals: {
            save: ['保存文档', '保存当前文档', '保存到项目', '保存为 PSD', '保存PSD', '存一下', '保存一下', '导出当前文档', '当前文档导出', '文档导出', '导出为 PNG', '导出PNG', '导出成PNG', '导出为 JPG', '导出JPG', '导出成JPG', '导出为 PDF', '导出PDF', '导出成PDF', 'save document', 'save psd', 'export document', 'export png', 'export jpg', 'export pdf'],
            close: ['关闭文档', '关掉文档', 'close document', 'close file'],
            switch: ['切换文档', '切到文档', 'switch document'],
            list: ['列出文档', '列出当前文档', '查看文档列表', '有哪些文档', 'list documents'],
            create: ['新建文档', '创建文档', 'create document']
        },
        parameterExtractionHints: ['抽取 action、documentName、documentId、save、format、path、saveAs、preset、width、height、name'],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['如果要关闭或切换但目标文档不明确，先问用户具体文档名'],
        decisionGuidance: [
            '“保存详情页文档到项目的 PSD 中”之类的请求是文档保存，详情页只是文档对象上下文，不能路由到 detail-page-design。',
            '“关闭文档不保存”之类的请求应提取 action=close 且 save=false。',
            '这类普通文档操作不能路由到 agent-panel-bridge。'
        ],
        routeStatusMessages: {
            deterministic: '确认当前打开的文档后执行文档操作。',
            autonomous: '确认当前文档状态后处理文档操作。'
        }
    },
    parameters: [
        strParam('action', 'Document action', true, {
            enum: ['list', 'switch', 'close', 'create', 'save']
        }),
        strParam('documentName', 'Target document name for switch or close'),
        numParam('documentId', 'Target document id for close'),
        boolParam('save', 'Whether to save changes before close'),
        strParam('format', 'Save format for action=save', false, {
            enum: ['psd', 'psb', 'png', 'jpg', 'jpeg', 'tiff', 'pdf']
        }),
        strParam('path', 'Absolute save path for action=save'),
        strParam('projectSubdir', 'Optional current-project subdirectory for action=save, for example PSD'),
        boolParam('saveAs', 'Whether action=save should create a project save-as copy'),
        strParam('preset', 'Optional document preset for create'),
        numParam('width', 'Document width for create'),
        numParam('height', 'Document height for create'),
        strParam('name', 'New document name for create'),
        strParam('userIntent', 'Original user request')
    ],
    output: {
        type: 'data',
        description: 'Document operation result and current document state.'
    },
    requiredTools: ['listDocuments', 'switchDocument', 'closeDocument', 'createDocument', 'getDocumentInfo', 'saveDocument'],
    examples: [
        {
            userSays: '帮我把详情页文档保存到项目的PSD中',
            parameters: { action: 'save', format: 'psd', saveAs: true }
        },
        {
            userSays: '帮我关闭文档不保存',
            parameters: { action: 'close', save: false }
        }
    ],
    estimatedTime: 3,
    hasDecisionPoints: false
};

export const SaveCurrentTemplateSkill: SkillDeclaration = {
    id: 'save-current-template',
    name: 'Save Current Template',
    category: 'ecommerce',
    kind: 'operation',
    visibility: 'user-facing',
    description: 'Save the current Photoshop document into the reusable template library.',
    whenToUse: [
        'User asks to save the current document as a template',
        'User asks to add the active Photoshop document into template library'
    ],
    whenNotToUse: [
        'No Photoshop document is open',
        'User asks to save a single element instead of whole document'
    ],
    routing: {
        intentSignals: ['保存模板', '加入设计库', '加入模板库', '另存为模板'],
        negativeSignals: ['详情页模板创建', '主图模板创建', '单图层'],
        preconditions: ['需要当前存在打开的 Photoshop 文档'],
        supportedModes: ['execute'],
        parameterExtractionHints: ['抽取 type、description、tags、templateIntent'],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['如果模板类型不明确，可先按当前文档内容询问用户归类'],
        routeStatusMessages: {
            deterministic: '整理当前文档内容，准备存入设计库。',
            autonomous: '整理当前文档和资源，准备存入设计库。'
        }
    },
    parameters: [
        strParam('type', 'Template type', false, {
            enum: ['sku', 'detail-page', 'banner', 'main-image', 'other'],
            default: 'other'
        }),
        strParam('description', 'Optional template description for reuse'),
        arrParam('tags', 'Optional tags for template retrieval'),
        strParam('templateIntent', 'Original user intent used for template type inference')
    ],
    output: {
        type: 'data',
        description: 'Saved template metadata.'
    },
    requiredTools: ['listDocuments'],
    examples: [
        {
            userSays: '把当前文档添加为模板',
            parameters: { type: 'other' }
        }
    ],
    estimatedTime: 2
};

export const TextFontReplaceSkill: SkillDeclaration = {
    id: 'text-font-replace',
    name: 'Text Font Replace',
    category: 'text',
    kind: 'workflow',
    visibility: 'user-facing',
    description: 'Replace the font for all text layers or target text layers and verify the result.',
    whenToUse: [
        'User asks to change all fonts to a specific typeface',
        'User asks to replace text-layer fonts in the active document'
    ],
    whenNotToUse: [
        'User asks only to edit text content',
        'No Photoshop document is open'
    ],
    routing: {
        intentSignals: ['改字体', '换字体', '全部字体', '字体全部', '字体改成', '字体改为', 'replace font', 'change font'],
        negativeSignals: ['改文案内容', '改标题文案', '面板调试'],
        preconditions: ['需要当前文档存在文本图层'],
        supportedModes: ['execute'],
        parameterExtractionHints: ['抽取 fontName、includeHidden、layerIds'],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['如果目标字体名不明确，先问用户要改成哪种字体'],
        decisionGuidance: [
            '如果用户明确给出了字体名称，返回 skillParams.fontName。',
            '如果当前消息只是“再改一下/没改成功”之类的续作反馈，应优先继续上一条字体修改任务。'
        ],
        routeStatusMessages: {
            deterministic: '读取当前文档文本图层，批量替换字体并逐层验证结果。',
            autonomous: '读取文本图层，批量替换字体并验证。'
        }
    },
    parameters: [
        strParam('fontName', 'Target font family or PostScript name', true),
        arrParam('layerIds', 'Optional explicit text layer ids to update'),
        boolParam('includeHidden', 'Include hidden text layers', false),
        strParam('userIntent', 'Original user request')
    ],
    output: {
        type: 'data',
        description: 'Per-layer font update result with verification details.'
    },
    requiredTools: ['getAllTextLayers', 'setTextStyle'],
    examples: [
        {
            userSays: '帮我把字体全部改成思源黑体',
            parameters: { fontName: '思源黑体', includeHidden: false }
        }
    ],
    estimatedTime: 4,
    hasDecisionPoints: false
};

export const EcommerceSocksDesignSkill: SkillDeclaration = {
    id: 'ecommerce-socks-design',
    name: 'E-commerce Socks Design',
    category: 'ecommerce',
    kind: 'workflow',
    visibility: 'user-facing',
    description: 'Plan e-commerce socks design work as one parent skill, with main image, detail page, and SKU as child skills.',
    whenToUse: [
        'User asks for an overall socks e-commerce design plan',
        'User asks to coordinate main image, detail page, and SKU work for a socks project',
        'User asks for a full set of socks e-commerce deliverables'
    ],
    whenNotToUse: [
        'User only asks for a single existing child skill before the parent dispatch checkpoint',
        'User only asks to manage documents, layers, fonts, or templates',
        'User asks for generic design theory without execution planning'
    ],
    routing: {
        intentSignals: [
            '电商袜子设计',
            '袜子电商设计',
            '整套袜子设计',
            '一套袜子设计',
            '全套袜子电商',
            '主图详情页SKU',
            '主图 详情页 SKU',
            'socks ecommerce design'
        ],
        intentSignalGroups: [
            ['袜子', '袜', 'socks'],
            ['电商', '主图', '详情页', 'SKU', '整套', '全套', '一套', 'ecommerce']
        ],
        negativeSignals: ['只做SKU', '只做 SKU', '只做主图', '只做详情页', '保存文档', '关闭文档', '改字体', '图层顺序'],
        preconditions: ['需要项目上下文、当前 Photoshop 文档或用户明确指定交付范围'],
        supportedModes: ['plan', 'execute'],
        parameterExtractionHints: [
            '抽取 deliverables: main-image/detail-page/sku；抽取 projectPath；默认只输出父 skill 编排计划',
            '只有用户明确要求执行整套子任务时才设置 executeChildren=true',
            '只有开发者验收或用户明确确认执行时才设置 confirmChildDispatch=true',
            'enableChildDispatch/runChildDispatch/executeRealChildDispatch 是真实子调度开关，不能从普通计划请求中推断'
        ],
        retryPolicy: 're-evaluate',
        clarificationHints: ['如果用户没有明确是整套设计还是单项交付，先确认交付范围'],
        decisionGuidance: [
            '当前阶段这是父 skill 入口，不直接改写主图、详情页、SKU 的业务策略。',
            '用户明确只做单项 SKU、主图或详情页时，保持现有子 skill 路由。',
            '用户提出整套袜子电商设计或同时包含主图/详情页/SKU 时，优先使用本 skill。'
        ],
        routeStatusMessages: {
            deterministic: '整理电商袜子设计目标，规划主图、详情页和 SKU 子能力的执行边界。'
        }
    },
    parameters: [
        strParam('userIntent', 'Original user request'),
        arrParam('deliverables', 'Requested child deliverables: main-image, detail-page, sku'),
        strParam('projectPath', 'Optional project path for socks assets'),
        boolParam('executeChildren', 'Whether parent skill may dispatch child skills; default is false', false),
        boolParam('confirmChildDispatch', 'Explicit confirmation that child skill dispatch is allowed', false),
        boolParam('enableChildDispatch', 'Developer-controlled switch that enables real child executor calls', false),
        boolParam('dryRunChildDispatch', 'Report child dispatch order without calling child executors', false),
        arrParam('childReports', 'Optional existing child reports for parent aggregation')
    ],
    output: {
        type: 'data',
        description: 'Parent orchestration evidence for main-image, detail-page, and SKU child skills.'
    },
    requiredTools: [],
    examples: [
        {
            userSays: '帮我规划一套电商袜子设计，包含主图、详情页和SKU',
            parameters: { deliverables: ['main-image', 'detail-page', 'sku'] }
        }
    ],
    estimatedTime: 3,
    hasDecisionPoints: true
};

export const MainImageSkill: SkillDeclaration = {
    id: 'main-image-design',
    name: 'Main Image Design',
    category: 'ecommerce',
    kind: 'workflow',
    visibility: 'user-facing',
    description: 'Plan e-commerce main-image deliverables: 800/750/1200 production documents, click/conversion rules, and SKU-sourced white background output.',
    whenToUse: [
        'User asks to design or export e-commerce main images',
        'User asks for click image, conversion image, or white background image'
    ],
    whenNotToUse: ['User asks for detail page generation'],
    routing: {
        intentSignals: ['主图', '点击图', '白底图', '转化图', 'main image'],
        negativeSignals: ['详情页', '详情页模板', '项目图片分析'],
        preconditions: ['通常需要当前文档或主图素材'],
        supportedModes: ['execute'],
        parameterExtractionHints: ['抽取 size、sizes、imageType、preferredStyle、backgroundPrompt、outputDir；未显式指定 size/sizes 时默认规划 800/750/1200 三规格；普通主图交付包含点击图和转化图规则，1200 只出点击图不出转化图；白底图来自 PSD/SKU.psb -> 主图/白底.jpg；默认 mainImageExecutionMode=strategy-only，不要从 outputDir、selectedAsset、enableVisionPreflight 推断真实 Photoshop 写入；用户明确要求理解/分析所选项目图时可设置 enableVisionPreflight=true；不要默认批量分析项目图片，maxVisionCandidates 默认 1'],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['如果用户同时提到模板和现有主图优化，先问是新建模板还是处理当前画面'],
        decisionGuidance: [
            '如果用户是在处理现有主图的优化、导出或排版，使用这个 skill，而不是模板创建 skill。',
            '普通“做主图”默认规划 800/750/1200 三个交付文档，不要退化成单 800 点击图。',
            '1200/9:16 只允许点击图，不能生成转化图；白底图是 SKU 源文件导出，不从点击图或转化图裁切。',
            '普通用户请求只能进入 strategy-only 规划路径；真实 disposable Photoshop 执行必须显式提供 product-disposable-live、executionScope=disposable-document、approvedLiveExecution=true 和 approvedLiveAdapterRun=true。',
            '旧的当前文档写入路径只能由内部受控调用显式设置 legacy-active-document，不允许从自然语言中默认推断。'
        ],
        routeStatusMessages: {
            deterministic: '整理主图三规格、白底图和执行边界，先生成 strategy-only 计划。',
            autonomous: '查看当前画面、图层和素材后规划主图。'
        }
    },
    parameters: [
        strParam('size', 'Output size preset', false, {
            enum: ['800', '750', '1200', 'custom']
        }),
        objParam('customSize', 'Custom size object {width,height}'),
        numParam('productScale', 'Subject scale ratio', false, { default: 0.65 }),
        numParam('verticalOffset', 'Vertical offset ratio', false, { default: -0.03 }),
        strParam('outputDir', 'Output directory'),
        strParam('imageType', 'Main image type', false, {
            enum: ['click', 'conversion', 'white-bg']
        }),
        arrParam('sizes', 'Batch output sizes list'),
        strParam('preferredStyle', 'Preferred style', false, {
            enum: ['minimal', 'rich', 'elegant', 'bold'],
            default: 'minimal'
        }),
        strParam('mainImageExecutionMode', 'Controlled execution mode for the main-image executor', false, {
            enum: ['strategy-only', 'product-disposable-live', 'legacy-active-document'],
            default: 'strategy-only'
        }),
        strParam('executionScope', 'Controlled Photoshop execution scope', false, {
            enum: ['disposable-document', 'active-document', 'project-document'],
            default: 'disposable-document'
        }),
        boolParam('approvedLiveExecution', 'Explicit approval to run the disposable live executor', false),
        boolParam('approvedLiveAdapterRun', 'Explicit approval to connect the guarded Photoshop adapter', false),
        boolParam('enableVisionPreflight', 'Explicitly analyze the selected project image before main-image planning; default false to avoid hidden model cost', false),
        numParam('maxVisionCandidates', 'Maximum project-image candidates to analyze when enableVisionPreflight is true; capped by executor, default 1', false, { default: 1 }),
        strParam('backgroundPrompt', 'Optional AI background prompt'),
        strParam('userIntent', 'Original user request')
    ],
    output: {
        type: 'files',
        description: 'Main-image production plan and, after explicit live approval, exported main-image files.'
    },
    requiredTools: ['getSubjectBounds', 'smartLayout', 'transformLayer', 'moveLayer', 'quickExport'],
    examples: [
        {
            userSays: '帮我做主图',
            parameters: { sizes: ['800', '750', '1200'], mainImageExecutionMode: 'strategy-only' }
        },
        {
            userSays: '做一张 800 点击图',
            parameters: { size: '800', imageType: 'click', mainImageExecutionMode: 'strategy-only' }
        },
        {
            userSays: '帮我做白底图',
            parameters: { imageType: 'white-bg', mainImageExecutionMode: 'strategy-only' }
        }
    ],
    estimatedTime: 10,
    hasDecisionPoints: false
};

export const MainImageTemplateAuthoringSkill: SkillDeclaration = {
    id: 'main-image-template-authoring',
    name: 'Main Image Template Authoring',
    category: 'ecommerce',
    kind: 'workflow',
    visibility: 'user-facing',
    description: 'Create a new main-image document and build a reusable editable template skeleton.',
    whenToUse: [
        'User asks to create a new main-image document from scratch',
        'User asks to build a reusable main-image template'
    ],
    whenNotToUse: [
        'User only asks to optimize an existing main image',
        'User asks for detail-page template creation'
    ],
    routing: {
        intentSignals: ['新建主图文档', '创建主图模板', '主图模板', '从零做主图模板'],
        negativeSignals: ['优化现有主图', '详情页模板', '项目图片分析'],
        preconditions: ['不要求当前已有模板文档'],
        supportedModes: ['authoring'],
        parameterExtractionHints: ['抽取 imageType、size、productTheme、density'],
        retryPolicy: 're-evaluate',
        clarificationHints: ['如果尺寸或主图类型不明确，先问用户要做哪种主图规格'],
        decisionGuidance: ['只有当用户明确要新建主图文档、从零搭模板或建立可复用主图骨架时，才使用这个 skill。'],
        routeStatusMessages: {
            deterministic: '规划主图模板蓝图，新建文档并创建可编辑的主图骨架。',
            autonomous: '规划主图模板骨架后创建新文档。'
        }
    },
    parameters: [
        strParam('userIntent', 'Original user request for template authoring'),
        strParam('imageType', 'Main image type', false, {
            enum: ['click', 'conversion', 'white-bg'],
            default: 'click'
        }),
        strParam('size', 'Output size preset', false, {
            enum: ['800', '750', '1200', '3:4'],
            default: '800'
        }),
        strParam('productTheme', 'Optional product theme or category'),
        strParam('density', 'Template density preference', false, {
            enum: ['minimal', 'standard', 'rich'],
            default: 'standard'
        })
    ],
    output: {
        type: 'document',
        description: 'A newly created main-image template document with editable placeholders.'
    },
    requiredTools: ['createDocument', 'createRectangle', 'createEllipse', 'createTextLayer', 'createGroup', 'getDocumentInfo'],
    examples: [
        {
            userSays: '帮我创建主图文档 并且建立主图模板',
            parameters: { size: '800', imageType: 'click', density: 'standard' }
        }
    ],
    estimatedTime: 10,
    hasDecisionPoints: true
};

export const DetailPageDesignSkill: SkillDeclaration = {
    id: 'detail-page-design',
    name: 'Detail Page Design',
    category: 'ecommerce',
    kind: 'workflow',
    visibility: 'user-facing',
    description: 'Plan screen roles, match content, fill detail-page layers, and export slices.',
    whenToUse: ['User asks to design, fill, or export product detail page'],
    whenNotToUse: ['User asks only single-layer manual edit', 'User asks to create a detail-page template from scratch'],
    routing: {
        intentSignals: ['详情页', '长图', '卖点页', '参数页', '面料页', 'detail page'],
        negativeSignals: ['保存文档', '保存当前文档', '保存到项目', '保存为 PSD', '保存PSD', '存一下', '保存一下', '导出当前文档', '当前文档导出', '文档导出', '详情页文档导出', '导出为 PNG', '导出PNG', '导出成PNG', '导出为 JPG', '导出JPG', '导出成JPG', '导出为 PDF', '导出PDF', '导出成PDF', 'save document', 'save psd', 'export document', 'export png', 'export jpg', 'export pdf', '新建详情页模板', '空白详情页文档', '仅改单个图层'],
        preconditions: ['通常需要当前详情页文档或现成模板'],
        supportedModes: ['inspect', 'execute'],
        modeSignals: {
            inspect: ['结构', '模板', '分析', '检查', '看一下', '可以吗', 'structure', 'analyze', 'inspect', 'review'],
            execute: ['设计', '填充', '生成', '制作', '整理', '处理', '导出', '出图', '排版', '换图', 'design', 'fill', 'generate', 'export']
        },
        parameterExtractionHints: ['抽取 inspectOnly、autoFix、structureMode、visualValidation、projectPath、outputDir'],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['如果不清楚用户是要检查现有模板还是实际填充详情页，先问清楚'],
        decisionGuidance: [
            '如果用户要检查、分析、复核当前详情页结构，使用 inspect 模式。',
            '如果用户要设计、填充、生成、导出详情页，使用 execute 模式。'
        ],
        routeStatusMessages: {
            deterministic: '检查当前详情页模板结构、项目素材和可自动化程度后处理详情页。',
            autonomous: '分析当前详情页和项目素材后整理详情页内容。'
        }
    },
    parameters: [
        strParam('projectPath', 'Project path for assets and export'),
        strParam('outputDir', 'Export directory'),
        boolParam('inspectOnly', 'Only inspect current detail-page structure without filling', false),
        boolParam('autoFix', 'Auto-fix detected layer issues', true),
        strParam('structureMode', 'Structure constraint mode', false, {
            enum: ['inspect', 'guided', 'strict', 'ignore'],
            default: 'guided'
        }),
        boolParam('visualValidation', 'Enable visual quality validation', true),
        boolParam('aiCopyGeneration', 'Generate copy when no knowledge hit', true),
        boolParam('copyReview', 'Enable copy review', true),
        numParam('copyMinScore', 'Copy quality minimum score threshold (0-1)', false, { default: 0.72 }),
        numParam('copyCandidateCount', 'Fallback candidate count for low-score copy', false, { default: 3 }),
        strParam('copyCreativeStyle', 'Copy creative style preference', false, {
            enum: ['natural', 'playful', 'professional'],
            default: 'natural'
        }),
        strParam('lowScoreCopyStrategy', 'Low-score copy handling strategy', false, {
            enum: ['replace', 'flag', 'keep'],
            default: 'replace'
        }),
        boolParam('copyLayoutFit', 'Enable layout-aware copy fitting', true),
        strParam('copyLineBreakStyle', 'Line break style for copy fitting', false, {
            enum: ['balanced', 'compact'],
            default: 'balanced'
        }),
        numParam('copyTitleMaxLines', 'Max lines for title copy', false, { default: 2 }),
        numParam('copySubtitleMaxLines', 'Max lines for subtitle copy', false, { default: 2 }),
        numParam('copyBodyMaxLines', 'Max lines for body copy', false, { default: 3 }),
        boolParam('copyOnly', 'Only optimize or fill copy and keep existing images', false),
        boolParam('planGuard', 'Guard low-confidence plans to avoid risky image replacement', false),
        boolParam('allowLowConfidenceFill', 'Allow low-confidence plans to fill images directly', true),
        numParam('minPlanConfidence', 'Minimum plan score threshold (0-1)', false, { default: 0.62 }),
        numParam('minImageCoverage', 'Minimum matched-image coverage threshold (0-1)', false, { default: 0.6 }),
        strParam('brandTone', 'Brand tone', false, {
            default: 'professional',
            examples: ['professional', 'playful', 'luxury', 'casual']
        }),
        strParam('exportFormat', 'Export format', false, {
            enum: ['jpeg', 'png'],
            default: 'jpeg'
        }),
        numParam('exportQuality', 'JPEG export quality 1-12', false, { default: 10 }),
        strParam('userIntent', 'Original user request')
    ],
    output: {
        type: 'files',
        description: 'Exported detail page slices.'
    },
    requiredTools: [
        'parseDetailPageTemplate',
        'detectLayerIssues',
        'fixLayerIssues',
        'matchDetailPageContent',
        'fillDetailPage',
        'exportDetailPageSlices'
    ],
    examples: [
        {
            userSays: '帮我设计详情页并导出',
            parameters: { autoFix: true, structureMode: 'guided' }
        }
    ],
    estimatedTime: 30,
    hasDecisionPoints: true
};

export const DetailPageTemplateAuthoringSkill: SkillDeclaration = {
    id: 'detail-page-template-authoring',
    name: 'Detail Page Template Authoring',
    category: 'ecommerce',
    kind: 'workflow',
    visibility: 'user-facing',
    description: 'Create a new detail-page document and build a reusable template skeleton with screen groups and placeholders.',
    whenToUse: [
        'User asks to create a detail-page document from scratch',
        'User asks to make a detail-page template',
        'User asks to build a reusable detail-page skeleton before filling content'
    ],
    whenNotToUse: [
        'User already has a detail-page PSD template and only needs inspect/fill/export',
        'User asks only to check current detail-page structure'
    ],
    routing: {
        intentSignals: ['新建详情页文档', '创建详情页模板', '详情页模板', '从零做详情页', '搭详情页模板'],
        negativeSignals: ['检查详情页结构', '分析当前详情页', '填充现有详情页'],
        preconditions: ['不要求当前已有详情页模板'],
        supportedModes: ['authoring'],
        parameterExtractionHints: ['抽取 productTheme、screenCount、density、width'],
        retryPolicy: 're-evaluate',
        clarificationHints: ['如果屏数、宽度或风格密度不明确，先问用户想做的页数或信息密度'],
        decisionGuidance: ['只有当用户明确要新建详情页文档、从零搭模板或建立可复用骨架时，才使用这个 skill。'],
        routeStatusMessages: {
            deterministic: '规划详情页模板蓝图，新建文档并创建每一屏的占位骨架。',
            autonomous: '规划详情页模板屏结构和占位骨架后创建新文档。'
        }
    },
    parameters: [
        strParam('userIntent', 'Original user request for template authoring'),
        strParam('productTheme', 'Optional product theme or category'),
        numParam('screenCount', 'Optional requested screen count', false, { default: 6 }),
        numParam('width', 'Optional document width override', false, { default: 790 }),
        strParam('density', 'Template density preference', false, {
            enum: ['compact', 'standard', 'rich'],
            default: 'standard'
        })
    ],
    output: {
        type: 'document',
        description: 'A newly created detail-page template document with reusable screen groups and placeholders.'
    },
    requiredTools: ['createDocument', 'createRectangle', 'createEllipse', 'createTextLayer', 'createGroup', 'getDocumentInfo'],
    examples: [
        {
            userSays: '帮我新建一个详情页文档然后帮我制作一个详情页模板吧',
            parameters: { screenCount: 6, density: 'standard' }
        }
    ],
    estimatedTime: 15,
    hasDecisionPoints: true
};

export const AutonomousAgentSkill: SkillDeclaration = {
    id: 'autonomous-agent',
    name: '自主智能体',
    category: 'analysis',
    kind: 'workflow',
    visibility: 'system-only',
    description: 'Autonomous ReAct agent that thinks, uses tools, and iterates to complete complex multi-step tasks.',
    whenToUse: [
        'Complex tasks requiring multiple tool calls and reasoning',
        'User explicitly requests autonomous or fully-automatic mode',
        'Tasks that span observation, analysis, and execution phases'
    ],
    parameters: [
        strParam('userTask', 'The task description from user', true),
        strParam('modelId', 'Override model ID for agent'),
        numParam('maxIterations', 'Max ReAct loop iterations', false, { default: 25 }),
    ],
    output: {
        type: 'data',
        description: 'Agent execution result with tool call log'
    },
    requiredTools: [],
    examples: [
        {
            userSays: '分析当前文档结构并撰写文案',
            parameters: { userTask: '分析当前文档结构并撰写文案' }
        }
    ],
    estimatedTime: 60
};

export const SKILL_REGISTRY: SkillDeclaration[] = [
    MatteProductSkill,
    SmartLayoutSkill,
    SKUConfigSkill,
    SKUBatchSkill,
    ShapeMorphingSkill,
    LayoutReplicationSkill,
    DesignReferenceSearchSkill,
    VisualAnalysisSkill,
    ProjectImageAnalysisSkill,
    LayerManagementSkill,
    FindEditElementSkill,
    AgentPanelBridgeSkill,
    DocumentManagementSkill,
    SaveCurrentTemplateSkill,
    TextFontReplaceSkill,
    EcommerceSocksDesignSkill,
    MainImageSkill,
    MainImageTemplateAuthoringSkill,
    DetailPageDesignSkill,
    DetailPageTemplateAuthoringSkill,
    AutonomousAgentSkill
];

export function getSkillById(id: string): SkillDeclaration | undefined {
    return SKILL_REGISTRY.find((s) => s.id === id);
}

export function getSkillsByCategory(category: string): SkillDeclaration[] {
    return SKILL_REGISTRY.filter((s) => s.category === category);
}

export function getUserFacingSkills(): SkillDeclaration[] {
    return SKILL_REGISTRY.filter((skill) => skill.visibility === 'user-facing');
}

export function getInternalDebugSkills(): SkillDeclaration[] {
    return SKILL_REGISTRY.filter((skill) => skill.visibility === 'internal-debug');
}

export function getSkillVisibility(id: string) {
    return getSkillById(id)?.visibility;
}
