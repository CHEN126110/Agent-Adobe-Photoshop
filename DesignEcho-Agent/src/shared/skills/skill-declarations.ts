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
    description: 'Remove image background and extract the product subject.',
    whenToUse: [
        'User asks to remove background',
        'User asks to isolate product from a photo'
    ],
    whenNotToUse: [
        'Image already has transparent background',
        'User only asks for crop or resize'
    ],
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
        })
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
    description: 'Generate SKU combination images in batch.',
    whenToUse: ['User asks to create multi-color/multi-combo SKU images'],
    parameters: [
        arrParam('comboSizes', 'Combination size list, e.g. [2,3,4]'),
        numParam('countPerSize', 'Combinations generated per size', false, { default: 1 }),
        strParam('templateKeyword', 'Optional template keyword for combo layout'),
        strParam('skuFileKeyword', 'Keyword for SKU source files', false, { default: 'SKU' }),
        arrParam('specifiedColors', 'Optional explicit color combinations')
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
    description: 'Normalize product silhouette using a reference shape.',
    whenToUse: ['User asks to unify shape consistency across product images'],
    parameters: [
        strParam('referenceMode', 'Reference mode', false, {
            enum: ['auto', 'manual'],
            default: 'auto'
        }),
        strParam('scope', 'Morph scope', false, {
            enum: ['full', 'partial'],
            default: 'full'
        }),
        numParam('strength', 'Morph strength 0-1', false, { default: 0.6 })
    ],
    output: {
        type: 'layers',
        description: 'Shape-morphed layers.'
    },
    requiredTools: ['morphToShape'],
    examples: [
        {
            userSays: '统一这几张图的外轮廓',
            parameters: { referenceMode: 'auto', scope: 'full' }
        }
    ],
    estimatedTime: 20,
    hasDecisionPoints: true
};

export const LayoutReplicationSkill: SkillDeclaration = {
    id: 'layout-replication',
    name: 'Layout Replication',
    category: 'replication',
    description: 'Replicate layout from a reference image to current canvas.',
    whenToUse: ['User asks to copy layout style or structure from sample design'],
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

export const FindEditElementSkill: SkillDeclaration = {
    id: 'find-and-edit-element',
    name: 'Find And Edit Element',
    category: 'analysis',
    description: 'Locate canvas element by visual-language description and edit it safely.',
    whenToUse: [
        'User can see an element on canvas but does not know its layer path',
        'User asks to edit top-right text, center image, corner icon and similar visual targets'
    ],
    whenNotToUse: [
        'User already gives a concrete layerId and asks for direct single-tool operation',
        'User asks to generate whole design set instead of editing an existing element'
    ],
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
    description: 'Bridge debugging with agent panel and produce structured MCP-oriented actions.',
    whenToUse: [
        'User asks to debug with agent panel interaction',
        'User cannot describe issue clearly and needs guided troubleshooting workflow'
    ],
    whenNotToUse: [
        'Single straightforward tool execution without iterative debugging',
        'Pure casual chat without implementation or diagnosis task'
    ],
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

export const MainImageSkill: SkillDeclaration = {
    id: 'main-image-design',
    name: 'Main Image Design',
    category: 'ecommerce',
    description: 'Design e-commerce main images with subject placement and export presets.',
    whenToUse: ['User asks to design or export click or conversion main image'],
    whenNotToUse: ['User asks for detail page generation'],
    parameters: [
        strParam('size', 'Output size preset', false, {
            enum: ['800', '750', '1200', 'custom'],
            default: '800'
        }),
        objParam('customSize', 'Custom size object {width,height}'),
        numParam('productScale', 'Subject scale ratio', false, { default: 0.65 }),
        numParam('verticalOffset', 'Vertical offset ratio', false, { default: -0.03 }),
        strParam('outputDir', 'Output directory'),
        strParam('imageType', 'Main image type', false, {
            enum: ['click', 'conversion', 'white-bg'],
            default: 'click'
        }),
        arrParam('sizes', 'Batch output sizes list'),
        strParam('preferredStyle', 'Preferred style', false, {
            enum: ['minimal', 'rich', 'elegant', 'bold'],
            default: 'minimal'
        }),
        strParam('backgroundPrompt', 'Optional AI background prompt')
    ],
    output: {
        type: 'files',
        description: 'Exported main images.'
    },
    requiredTools: ['getSubjectBounds', 'smartLayout', 'transformLayer', 'moveLayer', 'quickExport'],
    examples: [
        {
            userSays: '做一张 800 主图',
            parameters: { size: '800', imageType: 'click' }
        }
    ],
    estimatedTime: 10,
    hasDecisionPoints: false
};

export const DetailPageDesignSkill: SkillDeclaration = {
    id: 'detail-page-design',
    name: 'Detail Page Design',
    category: 'ecommerce',
    description: 'Parse template, match content, fill layers, and export detail page slices.',
    whenToUse: ['User asks to design, fill, or export product detail page'],
    whenNotToUse: ['User asks only single-layer manual edit'],
    parameters: [
        strParam('projectPath', 'Project path for assets and export'),
        strParam('outputDir', 'Export directory'),
        boolParam('autoFix', 'Auto-fix detected layer issues', true),
        strParam('structureMode', 'Structure constraint mode', false, {
            enum: ['guided', 'strict', 'ignore'],
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
        numParam('exportQuality', 'JPEG export quality 1-12', false, { default: 10 })
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
    hasDecisionPoints: false
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
    FindEditElementSkill,
    AgentPanelBridgeSkill,
    MainImageSkill,
    DetailPageDesignSkill
];

export function getSkillById(id: string): SkillDeclaration | undefined {
    return SKILL_REGISTRY.find((s) => s.id === id);
}

export function getSkillsByCategory(category: string): SkillDeclaration[] {
    return SKILL_REGISTRY.filter((s) => s.category === category);
}
