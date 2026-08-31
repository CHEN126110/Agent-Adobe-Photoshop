import type {
    SkillDeclaration,
    SkillParameter,
    SkillParameterSchema
} from '../types/skill.types';
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
    extra: Partial<{
        default: number;
        examples: any[];
        minimum: number;
        maximum: number;
    }> = {}
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
    required: boolean,
    extra: {
        items: SkillParameterSchema;
    } & Partial<{
        examples: any[];
        default: any[];
        minItems: number;
        maxItems: number;
        uniqueItems: boolean;
    }>
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

function mainImagePlacementBoxSchema(name: string, description: string, required: boolean): SkillParameter {
    return {
        name,
        type: 'object',
        description,
        required,
        additionalProperties: false,
        properties: [
            numParam('x', '画布像素坐标 X。', true),
            numParam('y', '画布像素坐标 Y。', true),
            numParam('width', '区域像素宽度，必须大于 0。', true, { minimum: 1 }),
            numParam('height', '区域像素高度，必须大于 0。', true, { minimum: 1 })
        ]
    };
}

function mainImageSlotAssignmentsParam(): SkillParameter {
    const assetSchema: SkillParameter = {
        name: 'asset',
        type: 'object',
        description: 'Agent 为当前精确槽位选定的项目素材；不同槽复用同一文件也必须再次显式声明。',
        required: true,
        additionalProperties: false,
        properties: [
            strParam('id', '可选的项目素材身份。'),
            strParam('name', '素材文件名。'),
            strParam('path', '已观察并选定的素材绝对路径。', true),
            numParam('width', '源素材像素宽度。', true, { minimum: 1 }),
            numParam('height', '源素材像素高度。', true, { minimum: 1 })
        ]
    };
    const subjectBoundsSchema: SkillParameter = {
        name: 'subjectBounds',
        type: 'object',
        description: '与当前 asset 精确绑定的主体像素范围，不能复用另一张图的 bounds。',
        required: true,
        additionalProperties: false,
        properties: [
            numParam('left', '主体左边界。', true),
            numParam('top', '主体上边界。', true),
            numParam('right', '主体右边界。', true),
            numParam('bottom', '主体下边界。', true),
            numParam('width', '主体宽度。', true, { minimum: 1 }),
            numParam('height', '主体高度。', true, { minimum: 1 })
        ]
    };
    const presetSchema: SkillParameter = {
        name: 'preset',
        type: 'object',
        description: 'Agent 对当前槽位声明的完整缩放、锚点与裁切意图；Harness 不提供品类默认。',
        required: true,
        additionalProperties: false,
        properties: [
            strParam('scaleMode', '缩放方式。', true, { enum: ['contain', 'cover'] }),
            numParam('targetFill', '目标填充比例。', true, { minimum: 0.01 }),
            numParam('minFill', '最小填充比例。', true, { minimum: 0.01 }),
            numParam('maxFill', '最大填充比例。', true, { minimum: 0.01 }),
            strParam('anchor', '主体锚点。', true, {
                enum: ['center', 'top-center', 'bottom-center', 'left-center', 'right-center']
            }),
            strParam('cropPolicy', '裁切策略。', true, {
                enum: ['avoid-crop', 'protect-subject', 'allow-crop']
            }),
            numParam('visualBiasY', '垂直视觉偏移。', true),
            numParam('minScale', '最小缩放倍率。', true, { minimum: 0.01 }),
            numParam('maxScale', '最大缩放倍率。', true, { minimum: 0.01 })
        ]
    };
    const placementSchema: SkillParameter = {
        name: 'placement',
        type: 'object',
        description: 'Agent 对当前槽位声明的目标区域和完整缩放意图。',
        required: true,
        additionalProperties: false,
        properties: [
            mainImagePlacementBoxSchema('targetBox', '当前素材在工作画布中的目标区域。', true),
            mainImagePlacementBoxSchema('safeBox', '可选的安全边界；省略时只使用完整画布机械边界。', false),
            presetSchema,
            strParam('decisionReason', '为什么这张素材以该区域、锚点和裁切方式进入这个槽。', true)
        ]
    };
    const assignmentSchema: SkillParameterSchema = {
        type: 'object',
        description: '一个精确主图槽位的 Agent/用户作者化内容分配。',
        additionalProperties: false,
        properties: [
            strParam('sizeKey', '工作文档规格。', true, { enum: ['800', '750', '1200'] }),
            strParam('imageType', '槽位所属父组。', true, { enum: ['click', 'conversion'] }),
            strParam('slotName', '精确子组名，例如 800-1 或转化槽 2。', true),
            strParam('variantId', 'Agent 声明的当前方向稳定身份。', true),
            strParam('objective', '当前槽位要完成的设计目标。', true),
            strParam('visualHook', '可选的视觉重点。'),
            strParam('layoutFocus', '可选的版式重点。'),
            strParam('copyRole', '可选的文案角色；无文字设计可省略。'),
            assetSchema,
            subjectBoundsSchema,
            placementSchema
        ]
    };
    return arrParam(
        'slotAssignments',
        'Agent/用户对精确 size/imageType/slot 的内容、素材和几何分配。没有条目的槽保持空，不会被 Harness 按数组顺序自动填充。',
        false,
        { items: assignmentSchema, maxItems: 27 }
    );
}

function semanticMattingGuidanceParam(): SkillParameter {
    const pointSchema: SkillParameterSchema = {
        type: 'object',
        additionalProperties: false,
        properties: [
            numParam('x', '相对目标图层宽度的归一化 X 坐标（0 到 1）。', true, {
                minimum: 0,
                maximum: 1
            }),
            numParam('y', '相对目标图层高度的归一化 Y 坐标（0 到 1）。', true, {
                minimum: 0,
                maximum: 1
            })
        ]
    };
    return {
        name: 'semanticGuidance',
        type: 'object',
        description: '可选的 Agent 视觉引导。只有看过源图并能明确指出目标内部与非目标遮挡物时使用；Harness 不生成这些点。',
        required: false,
        additionalProperties: false,
        properties: [
            strParam('version', '固定契约版本。', true, {
                enum: ['semantic-matting-guidance/v1']
            }),
            strParam(
                'instanceSelectionMode',
                '实例选择方式。默认 refine_detected_candidates：引导点只精修已检测候选；只有 Agent 已观察画面并确认引导组就是全部目标实例时，才使用 exact_guided_instances。',
                false,
                { enum: ['refine_detected_candidates', 'exact_guided_instances'] }
            ),
            arrParam('sets', '逐目标实例的正负点集合；每组前景点必须落在同一个检测框内。', true, {
                minItems: 1,
                maxItems: 8,
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: [
                        arrParam('foregroundPoints', '确认属于目标的点。', true, {
                            minItems: 1,
                            maxItems: 4,
                            items: pointSchema
                        }),
                        arrParam('backgroundPoints', '确认不属于目标的遮挡物或背景点。', false, {
                            maxItems: 8,
                            items: pointSchema
                        })
                    ]
                }
            })
        ]
    };
}

function deliveryTargetConventionParam(
    name: 'editable' | 'raster',
    formats: string[]
): SkillParameter {
    return {
        name,
        type: 'object',
        description: `${name} 交付组织；只声明项目相对目录、文件夹/文件命名 pattern 与格式，不包含任何视觉设计参数。`,
        required: false,
        additionalProperties: false,
        properties: [
            strParam('projectRelativeRoot', '项目内相对目录；禁止盘符、UNC、绝对路径和 ..。', true),
            strParam('folderPattern', '可选单层文件夹 pattern；可用 {defaultName}/{index}/{size}/{colors}/{template}/{kind}/{row}/{name}/{version}/{screen}。'),
            strParam('fileNamePattern', '不含扩展名的文件名 pattern；可用 {defaultName}/{index}/{size}/{colors}/{template}/{kind}/{row}/{name}/{version}/{screen}。', true),
            strParam('format', '交付格式。', true, { enum: formats })
        ]
    };
}

function deliveryConventionParam(
    rasterFormats: string[] = ['jpg', 'jpeg', 'png']
): SkillParameter {
    return {
        name: 'deliveryConvention',
        type: 'object',
        description: '由 Agent 根据当前用户要求或已经查看的项目同类成品选定的交付组织约定。只控制目录、命名、可编辑稿/导出图配对与版本策略；Harness 不扫描目录替你选择，也不得在此声明选图、版式、颜色、字号或其他视觉决定。未提供时使用对应 Skill 的 fail-if-exists 兼容基线。',
        required: false,
        additionalProperties: false,
        properties: [
            strParam('version', '固定契约版本。', true, { enum: ['skill-delivery-convention/v0'] }),
            strParam('provenance', '本次模型选择的来源。当前模型入口只能使用 agent_selected；查看过样本也可以作为选择依据，但在没有 Runtime 观察收据前不得自报为已验证的 agent_examples。', true, {
                enum: ['agent_selected']
            }),
            arrParam('supportRefs', '稳定来源引用；禁止本机绝对路径。agent_selected/agent_examples 均需至少一项。', true, {
                items: { type: 'string' },
                maxItems: 12,
                uniqueItems: true
            }),
            deliveryTargetConventionParam('editable', ['psd', 'psb', 'tif']),
            deliveryTargetConventionParam('raster', rasterFormats),
            strParam('pairing', '可编辑稿与导出图的配对关系。', true, {
                enum: [
                    'editable_only',
                    'raster_only',
                    'one_editable_per_raster',
                    'one_master_many_rasters'
                ]
            }),
            strParam(
                'versionPolicy',
                '同名目标的版本/冲突策略。公开参数和缺省值都不能授权覆盖；new_version 需要明确版本化名称，目标仍存在时会停止而不是替换。',
                true,
                { enum: ['new_version', 'fail_if_exists'] }
            )
        ]
    };
}

export const MatteProductSkill: SkillDeclaration = {
    id: 'matte-product',
    name: 'Smart Matting',
    displayName: '智能抠图白底',
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
        strParam('targetPrompt', 'Optional Agent-selected semantic target; omit for general foreground matting'),
        strParam('sourceType', 'Image source', true, {
            enum: ['current_layer', 'file_path', 'project_resource'],
            default: 'current_layer'
        }),
        strParam('filePath', 'Local file path when sourceType requires it'),
        strParam('outputMode', 'Output mode', false, {
            enum: ['new_layer', 'replace', 'mask'],
            default: 'new_layer'
        }),
        semanticMattingGuidanceParam(),
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
    displayName: '智能布局',
    category: 'layout',
    kind: 'operation',
    visibility: 'user-facing',
    description: 'Reposition and resize a layer according to layout constraints.',
    whenToUse: [
        'User asks to center, align, fit, or resize a specific product/layer automatically',
        'User has a current selection or layer id and asks for a direct layout adjustment'
    ],
    whenNotToUse: [
        'User asks for open-ended page, main-image, detail-page, or SKU design',
        'User asks to change layer order, names, visibility, grouping, or selection state',
        'No target layer/current selection/layer id is available'
    ],
    routing: {
        intentSignalGroups: [
            ['产品', '商品', '主体', '当前图层', '选中图层', '目标图层', '图层', 'layer', 'subject'],
            ['居中', '对齐', '缩放', '放大', '缩小', '自适应', '铺满', '填充画布', 'center', 'resize', 'fit', 'align']
        ],
        negativeSignals: ['详情页', '主图', 'SKU', '复刻', '参考图', '图层顺序', '置顶', '置底', '重命名', '删除', '只讨论', '只说明'],
        preconditions: ['需要当前文档和可定位的目标图层，或用户明确提供 layerId'],
        supportedModes: ['execute'],
        parameterExtractionHints: ['抽取 layerId、fillRatio、alignment；fillRatio 与 alignment 必须来自用户明确要求或 Agent 对当前画面的判断，Harness 不补默认值；没有目标图层时先澄清'],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['如果没有当前选中图层或明确 layerId，先确认要调整哪个图层'],
        decisionGuidance: [
            'Smart Layout 是单图层几何调整能力，不处理整页设计、主图策略、详情页模板或 SKU 生产。',
            '图层顺序、重命名、删除、编组等请求应交给 layer-management。',
            '用户只是讨论布局方法或询问建议时，不要执行写入。'
        ],
        routeStatusMessages: {
            deterministic: '确认目标图层和画布尺寸后调整位置与比例。'
        }
    },
    parameters: [
        numParam('layerId', 'Target layer id'),
        numParam('fillRatio', 'Agent- or user-declared canvas fill ratio; no Harness default is supplied'),
        strParam('alignment', 'Alignment mode', false, {
            enum: ['center', 'bottom-center', 'top-center']
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
            userSays: '把产品居中并缩放到画布的 78%',
            parameters: { fillRatio: 0.78, alignment: 'center' }
        }
    ],
    estimatedTime: 2
};

export const SKUSkill: SkillDeclaration = {
    id: 'sku-batch',
    playbookId: 'sku-production',
    name: 'SKU Design and Production',
    displayName: 'SKU 设计与生产',
    userFacingSummary: '从项目摄影图到成套 SKU 组合图：建色卡、做模板、按确认的组合批量出图',
    category: 'batch',
    kind: 'workflow',
    visibility: 'user-facing',
    visualSamplingScenario: 'sku',
    runtimeRequirements: {
        photoshop: 'required',
        document: 'not_required'
    },
    // SKU 是一个完整 Skill：领域流程归 Skill，通用 Agent/Harness 不复制 SKU 业务分支。
    // controlledRouteEntry 只要求它在自主 ReAct 循环内运行，不把 Skill 退化成脚本直调。
    controlledRouteEntry: 'autonomous-react-loop',
    routeClass: 'business-workflow',
    // 模型路由不得直执（用户拍板红线，smoke-skill-route-guard-declaration 钉桩）：
    // sku-batch 必须经 Agent 自主 ReAct 循环，防止退回脚本直调。
    modelDirectExecution: 'forbidden',
    description: 'SKU 生产能力：工作法包是 sku-production，可用 readSkillPlaybook("sku-production") 按需读取。可创建和验证可编辑色卡源、规格模板与多色组合成品，并对数量、槽位、命名、文件身份和导出完整性做确定性校验。先根据用户目标与当前真实项目状态判断缺少什么，再自行选择最有效的观察、设计和执行方式；只有当前判断需要时才读取工作法或参考，不把色卡、模板、组合写成固定开工顺序。文件名或画面文字不能单独证明文档身份，应以必要的结构或画面事实为准。素材选择、模板版式、视觉层级、色彩组合和是否需要参考由 Agent 或用户决定；缺少创意模板时返回可继续设计的候选与事实，不由 Harness 注入固定版式。',
    whenToUse: [
        'User asks the Agent to make, design, complete, improve, or batch-produce SKU deliverables, including a bare execution request such as "帮我做 SKU".',
        'User asks for an editable SKU color card, SKU card template, combination image, pack-size variant, self-select note, or a complete 2/3/4-pack SKU set.',
        'User asks to continue an existing SKU task, use confirmed combinations, or produce/export from an authoritative project configuration, CSV, or confirmation result.',
        'User asks to inspect and repair missing SKU production prerequisites as part of an actual delivery task.',
        'User asks to export SKU configuration or perform an explicit SKU placeholder/configuration action.'
    ],
    whenNotToUse: [
        'User asks whether the Agent can do SKU work or what SKU abilities are supported.',
        'User asks how SKU should be made, what SKU means, or wants a design/planning explanation only.',
        'User asks to inspect, list, or check SKU materials/configuration without producing anything.',
        'SKU is only an input/source for a different requested deliverable such as a main image, detail page, or white-background image.',
        'User explicitly says to only explain, only discuss, or not execute tools.'
    ],
    routing: {
        // 业务匹配由 Skill 自身声明；通用 Skill matcher 不再维护 SKU 专属正则或权限分支。
        intentSignals: [
            'regex:(做|制作|设计|生成|完成|优化|调整|修复|批量|导出|产出).{0,16}(SKU|sku)',
            'regex:(SKU|sku).{0,16}(做|制作|设计|生成|完成|优化|调整|修复|色卡|颜色卡|模板|组合图|组合编排|编排|排版|双装|备注图|自选备注|批量|导出)',
            'regex:(按|根据|基于|使用).{0,12}(已确认|确认过|现有|项目配置|配置表|CSV|csv|组合表|确认卡).{0,24}(SKU|sku)',
            'regex:(补|追加|继续).{0,8}(SKU|sku).{0,8}(组合图|自选备注|备注图)',
            '帮我做 SKU',
            'SKU 编排',
            'SKU 色卡',
            'SKU 模板',
            'SKU 组合图'
        ],
        negativeSignals: ['regex:(你|agent|模型).{0,6}(会|能|可以)(?!帮我|给我|替我|为我).{0,6}(做|处理).{0,4}sku', 'regex:(怎么|如何).{0,8}(做|制作|生成).{0,4}sku', 'regex:sku.{0,6}(能力|支持哪些|是什么|什么意思)', 'regex:^(帮我|请|给我)?\\s*(做|做个|做一下|进行)?\\s*(个)?\\s*(SKU|sku).{0,16}(分析|素材盘点|模板检查|可行性评估|规划|说明).{0,16}$', '说明理解', '不执行工具', '不要执行', '只讨论', '只说明', '仅查看', '只查看', '仅检查', '只检查', 'SKU 素材做主图', 'SKU 素材做详情页', 'SKU 素材导出白底图', '文档关闭'],
        preconditions: ['需要能定位当前项目。产品事实、正式色名和发布规格必须有用户、项目或视觉证据；缺少 Photoshop 文档、色卡或模板不是开工阻断，Skill 应先观察并在同一任务内准备可编辑前置产物'],
        supportedModes: ['inspect', 'execute'],
        modeSignals: {
            inspect: ['查看', '检查', '分析', '盘点', '评估', '复核', '审核', '验收', '评审', '审查', '说明', '了解'],
            execute: ['做', '完成', '创建', '新建', '生成', '制作', '设计', '修复', '调整', '修改', '优化', '处理', '出图', '导出', '批量生成', '批量出图', '开始', '执行']
        },
        canonicalProductionEntries: [
            'regex:^(?:请|麻烦)?\\s*(?:帮我|给我|替我|为我)?\\s*(?:继续\\s*)?(?:(?:批量)?(?:做|制作|设计|生成|完成|修复|改|修改|调整|优化|处理|导出|出图|出))\\s*(?:一下子|一下|下|这个|当前|一个|一套|一组|一批|个)?\\s*(?:SKU|sku)(?:\\s*(?:色卡|模板|组合图|组合编排|编排|排版|自选备注|备注图))?$'
        ],
        parameterExtractionHints: [
            '根据用户真正要交付的 SKU 产物抽取 stage：完整 SKU/组合图/备注图或裸执行请求使用 full；独立色卡使用 color-card；独立模板设计或修复使用 template；纯配置动作使用 config。',
            '先读取项目事实、当前文档和既有 TaskRun；已有规格直接复用，缺失的可逆前置设计由 Agent 在 Skill 内完成。候选组合准备好后默认交给结构化组合卡确认，不得用 Harness 默认值或模型参数伪装成用户确认事实。',
            'stage=full 抽取 comboSizes、countPerSize、specifiedColors、onlyNotes 和 Agent/用户选定的 deliveryConvention；stage=color-card 抽取 sources/sourcePaths/colorNames、版面参数和 retouchMode/sourceMode；stage=config 抽取 configAction、placeholderCount、placeholderLayout。组合确认只由真实用户原文或结构化 continuation 决定，不接受模型布尔参数授权。'
        ],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['先用项目、文档与视觉观察消解任务；只有交付物类型或商品事实仍有多个会实质改变结果的解释时，才请求一个最小澄清。用户委托 Agent 后，色卡、模板和组合候选应自主准备；组合卡属于准备完成后的单次生产确认，不是开工前澄清。'],
        decisionGuidance: [
            'sku-batch 是完整 SKU Skill 的兼容 ID，拥有从项目理解、色卡/模板设计、组合规划到生产、导出和读回复核的领域流程；通用 Agent/Harness 不得复制这些业务阶段。',
            'Skill 运行在通用 Agent 的自主 ReAct 循环中：模型负责文案、排版、风格、视觉层级和可逆设计判断，确定性代码只负责组合数量、槽位、命名、目标、导出数量和读回证据。',
            '裸“帮我做 SKU”进入 stage=full。先观察真实项目、当前文档、已有色卡/模板和项目状态；已有有效颜色组的色卡立即登记为只读来源并复用，不得当成模板改造。规格/组合仍非权威时只显示一次 SKU Provider 组合卡，确认后自主补齐缺失模板并直接批量生产。不能只给方案，也不能弹“如何处理色卡/模板”的通用卡片。',
            '能力问答、术语解释、做法说明、只读检查、规划讨论必须停留在对话或只读能力，不要调用 sku-batch。',
            'stage=color-card / template 既可作为完整 SKU 流程内部阶段，也可响应明确的独立 SKU 色卡/模板交付；它们必须产出可编辑结构并由 Agent 看图复核，不能用机械占位脚本冒充设计完成。',
            '缺色卡、缺模板或缺占位符时在同一 SKU Skill 中登记 prerequisite、完成设计、写入、读回并继续生产；不要把任务抛回用户，也不要要求用户重新描述完整需求。',
            '如果用户只要自选备注或备注图，设置 onlyNotes=true。',
            '组合数量、具体颜色组合和是否生成自选备注必须来自用户消息、项目配置/CSV 或结构化确认卡；裸“帮我做 SKU”可以生成候选，但默认必须经组合卡确认后才批量生产，不得填入每规格 5 组或默认备注。',
            '已有、现成、已经准备好的 SKU 色卡素材/源文件应优先复用；不要在批量生产中重新选择图片或制作第二份色卡。',
            '上游已经确认颜色素材映射、但缺少可生产色卡资产时，stage=color-card 可用 retouchMode=auto 只为适用的纯底棚拍素材抠出透明主体，保持真实版型并等比缩放到同批统一尺度；场景图自动跳过该链并保留给通用设计方向。当前阶段不做形态变形、独立阴影或光影修正，不要把场景图强制改成纯底。',
            '“完成后只说明结果/保存路径”是执行后的汇报约束，不等同于“只说明、不执行”。',
            '“我还需要对应的 SKU 自选备注”是补备注任务，设置 onlyNotes=true，不要把 SKU 这个领域词误判为新增颜色组合。',
            '如果用户说“2-3-4 的自选备注”之类，提取 comboSizes=[2,3,4]。',
            '1双/单双不生成自选备注，因为 1双 SKU 已经逐个覆盖全部颜色。',
            '如果用户是在已有 SKU 任务上追加组合，优先理解为追加而不是整体覆盖。',
            'SKU 模板有两种受治理的放置方法，必须先用 skuLayout.inspectTemplateLayout 读取真实图层类型、面板顺序与 bounds，再选择方法；不得凭文件名或规格名猜。',
            'ordered_slots 对应 6.3 顺序替换：模板中“占位/占位符/占位组/placeholders”等容器下的一级图层组，按 Photoshop 图层面板从上到下一槽一色，占位组数量必须等于配色数量。',
            'region_composition 对应 6.0 矩形区域排版：一个矩形区域可以容纳多个颜色，多个区域按 Photoshop 图层面板顺序消费显式 regionCapacities；例如 4 双装上方大区放 3 双、下方小区放 1 双，计划为 [3,1]。',
            'TemplateLayoutPlan 可以根据矩形面积比例或名称中的“容量N”形成容量建议；只有高置信计划才可直接执行，中低置信必须先用截图复核。执行器只消费计划，不在写入时临场猜容量。',
            '配色表达式先被解析为有序颜色列表；“|”只可作为旧配置的区域提示，最终仍需由模板检查形成显式 regionCapacities，不允许把分隔符本身当成执行授权。',
            '不要主动要求 autoLayoutWithoutPlaceholders、无占位符自动避让、自动元素避开或隐式智能分区；模板无法识别时应修正模板、调整占位符或更换模板。',
            '调整既有占位符时，先从 inspectTemplateLayout 取得目标 layerId/bounds，用 transformLayer 修改该层，再次 inspectTemplateLayout 复验；不要叠加创建第二套占位结构。',
            '缺少或不匹配色卡源文档时，stage=color-card 基于真实项目素材完成素材选择、版式设计、写入和读回复核，再把可编辑结果交给后续组合生产。',
            '缺少目标规格模板时，可用 stage=template 承接 Agent 已形成的设计意图并制作可编辑模板；模板的文案、排版、风格和视觉层级由 Agent 决定，Harness 只校验后续生产所需的显式占位结构。',
            '模板方向 checkpoint 只从真实用户原文或受信结构化续跑读取；不要让模型布尔参数制造人工确认点。',
            '用户明确委托 Agent 做可逆组合选择时，允许以 agent_proposal 身份完成候选设计，但这不等于 user_confirmed；默认仍展示组合卡，确认后再生产。只有用户明确说跳过组合确认时，才允许继续非权威草稿，并保持发布前复核状态。',
            '卡片式 SKU 源文档和模板只能使用当前项目素材与已观察事实；参考成品只用于质量评估，不能复制其素材、模板、文案或项目事实，也不能把局部特写、模特图、多只合照擅自认定为颜色组源图。'
        ],
        routeStatusMessages: {
            deterministic: '校验已确认组合、生产文档和结构化前置条件后执行 SKU 批量生产。'
        }
    },
    parameters: [
        strParam('stage', 'Required internal SKU workflow selector. "full" = complete end-to-end SKU design and production; "color-card" = create or improve an editable color-card source; "template" = create or repair an editable SKU card template; "config" = export configuration or execute an explicit placeholder action. Bare execution requests default to full inside this Skill.', true, {
            enum: ['full', 'color-card', 'template', 'config'],
            default: 'full'
        }),
        deliveryConventionParam(['jpg']),
        arrParam(
            'comboSizes',
            'Explicit combination size list from the user, a trusted structured continuation, or an Agent proposal. This declaration has no global default: full production may form its own non-authoritative draft after stage resolution, while template production requires concrete sizes before any write.',
            false,
            {
                items: { type: 'number' }
            }
        ),
        numParam('countPerSize', 'Candidate combination count per size. Use only when supplied by the user/project or when building a confirmation card; it is never final production authority by itself.'),
        boolParam('generateNotes', 'Generate note images only when explicitly requested by the user, selected in the structured confirmation card, or required by an authoritative project configuration'),
        boolParam('onlyNotes', 'Generate note images only without SKU layout', false),
        strParam('templateKeyword', 'Optional template keyword for combo layout'),
        strParam('skuFileKeyword', 'Keyword for SKU source files', false, { default: 'SKU' }),
        arrParam('specifiedColors', 'Optional explicit color combinations, as an array of color-name arrays: [["双层边","木耳边"],["水晶丝","花苞"]] (each inner array is one combo). NOT objects like {size,colors}. Usually leave this unset: when resuming after the user confirmed combos on the card, combos are parsed automatically from the task text.', false, {
            items: {
                type: 'array',
                description: 'One combo: a non-empty list of color names.',
                minItems: 1,
                items: { type: 'string' }
            }
        }),
        arrParam('sources', 'stage=color-card only: 色卡源清单 [{filePath,colorName}]，顺序 = 色卡顺序。filePath 可以只写文件名或项目内相对路径（项目里唯一同名图会自动解析成完整路径）——别写 20 条盘符绝对路径，会把调用撑到输出上限被截断。', false, {
            items: {
                type: 'object',
                description: '单个色卡源条目。',
                properties: [
                    strParam('filePath', '源素材路径；可以只写文件名或项目内相对路径。', true),
                    strParam('colorName', '该源的权威颜色名；缺省时按色名来源规则回退。'),
                    strParam('relativePath', '可选的项目内相对路径。'),
                    strParam('assetId', '可选的项目素材身份。')
                ]
            }
        }),
        strParam('sourceDirectory', 'stage=color-card：不递归扫描目录；文件名只作待确认色名，同名素材要求 Agent 改用 sources 选定。'),
        arrParam('sourcePaths', 'stage=color-card only: ordered local image paths when sources is not provided.', false, {
            items: { type: 'string' }
        }),
        arrParam('colorNames', 'stage=color-card only: ordered authoritative color names aligned with sourcePaths.', false, {
            items: { type: 'string' }
        }),
        strParam('projectPath', 'stage=color-card only: active project root; defaults to current project context.'),
        strParam('outputPath', 'stage=color-card only: explicit absolute PSB output path.'),
        strParam('outputRelativePath', 'stage=color-card only: project-relative output path.', false, { default: 'PSD/SKU.psb' }),
        {
            name: 'colorCardDesignSpec',
            type: 'object',
            description: 'Agent 首次写入前的色卡设计声明；缺少时零写入并返回完整字段清单。',
            required: false,
            additionalProperties: false,
            properties: [
                strParam('provenance', '必须为 agent_authored，表示这些视觉参数是本轮 Agent 的设计判断。', true, { enum: ['agent_authored'] }),
                strParam('presentationMode', '视觉结构：flat 为无卡片壳平铺，card 为卡片式结构。必须由 Agent 根据任务和素材明确选择，素材精修结果不会替 Agent 改写。', true, {
                    enum: ['flat', 'card']
                }),
                arrParam('sourceAssetIds', '完整 SKU 缺少源文档时，从本次 handoff 候选中由 Agent 选定的 assetId，数组顺序就是色卡顺序；直接 stage=color-card 并显式传 sources 时可省略。', false, {
                    items: { type: 'string' },
                    minItems: 1,
                    maxItems: 10,
                    uniqueItems: true
                }),
                numParam('canvasWidth', '色卡源文档画布宽度（px）。', true),
                numParam('canvasHeight', '色卡源文档画布高度（px）。', true),
                strParam('canvasBackground', '画布底色。', true, {
                    enum: ['white', 'black', 'transparent']
                }),
                numParam('cardWidth', '单个色卡区域宽度（px）。', true),
                numParam('cardHeight', '单个色卡区域高度（px）。', true),
                numParam('cardCornerRadius', '卡片圆角（px，可为 0）。', true),
                numParam('columns', '列数，由当前素材数量和构图方向决定。', true),
                numParam('columnGap', '列间距（px，可为 0）。', true),
                numParam('rowGap', '行间距（px，可为 0）。', true),
                {
                    name: 'gridAlignment',
                    type: 'object',
                    description: '网格对齐。',
                    required: true,
                    additionalProperties: false,
                    properties: [
                        strParam('horizontal', '水平。', true, { enum: ['start', 'center', 'end'] }),
                        strParam('vertical', '垂直。', true, { enum: ['start', 'center', 'end'] }),
                        strParam('lastRow', '末行。', true, { enum: ['start', 'center', 'end'] })
                    ]
                },
                {
                    name: 'showIndexNumbers',
                    type: 'boolean',
                    description: '是否显示仅供输入顺序核对的参考序号。',
                    required: true
                },
                strParam('cardFillColorHex', '卡片底色，6 位十六进制，例如 #F4EFE8。', true),
                strParam('labelFillColorHex', '色名标签底色，6 位十六进制。', true),
                strParam('labelTextColorHex', '色名文字颜色，6 位十六进制。', true),
                {
                    name: 'internalLabel',
                    type: 'object',
                    description: '色名标签在单个卡片内部的归一化位置与字号关系。',
                    required: true,
                    additionalProperties: false,
                    properties: [
                        numParam('xRatio', '标签左边相对卡片宽度的比例 0-1。', true),
                        numParam('yRatio', '标签上边相对卡片高度的比例 0-1。', true),
                        numParam('widthRatio', '标签宽度相对卡片宽度的比例。', true),
                        numParam('heightRatio', '标签高度相对卡片高度的比例。', true),
                        numParam('cornerRadiusToWidthRatio', '标签圆角相对卡片宽度的比例。', true),
                        numParam('fontSizeToHeightRatio', '文字字号相对标签高度的比例。', true)
                    ]
                },
                {
                    name: 'labelTypography',
                    type: 'object',
                    description: '可复现的色名排版。',
                    required: true,
                    additionalProperties: false,
                    properties: [
                        strParam('fontName', '字体名。', true),
                        numParam('tracking', '字距。', true),
                        numParam('leadingToFontSizeRatio', '行距/字号。', true),
                        strParam('alignment', '水平对齐。', true, { enum: ['left', 'center', 'right'] }),
                        numParam('horizontalPaddingRatio', '水平内边距/标签宽。', true),
                        numParam('verticalPaddingRatio', '垂直内边距/标签高。', true)
                    ]
                },
                {
                    name: 'indexStyle',
                    type: 'object',
                    description: '启用序号时必填的样式与位置。',
                    required: false,
                    additionalProperties: false,
                    properties: [
                        strParam('colorHex', '颜色。', true),
                        strParam('fontName', '字体。', true),
                        numParam('tracking', '字距。', true),
                        numParam('leadingToFontSizeRatio', '行距/字号。', true),
                        numParam('fontSizeToCardWidthRatio', '字号/卡宽。', true),
                        numParam('xRatio', 'x/卡宽。', true),
                        numParam('yRatio', 'y/卡高，可为负。', true),
                        strParam('alignment', '对齐。', true, { enum: ['left', 'center', 'right'] })
                    ]
                },
                {
                    name: 'imagePlacement',
                    type: 'object',
                    description: '商品主体在卡片区域中的首次落位意图；Skill 只求解几何。',
                    required: true,
                    additionalProperties: false,
                    properties: [
                        numParam('subjectFillRatio', '主体 contain 占比 0.1-1，由 Agent 根据素材和构图选择。', true),
                        strParam('anchor', '主体视觉锚点。', true, {
                            enum: ['center', 'top-center', 'bottom-center', 'left-center', 'right-center']
                        })
                    ]
                }
            ]
        },
        strParam('retouchMode', 'stage=color-card only: auto classifies studio vs scene and prepares transparent studio subjects on a shared uniform scale without warping; layout_only preserves legacy layout-only behavior; studio_retouch_required fails when the sources are not suitable studio images.', false, {
            enum: ['auto', 'layout_only', 'studio_retouch_required'],
            default: 'auto'
        }),
        strParam('sourceMode', 'stage=color-card only: optional source classification override. Prefer auto unless the user or a verified observation explicitly establishes studio/scene.', false, {
            enum: ['auto', 'studio', 'scene'],
            default: 'auto'
        }),
        strParam('referenceSourcePath', 'stage=color-card only: optional explicit uniform-scale reference source; when omitted the batch medoid is selected automatically.'),
        numParam('retouchMaxLongEdge', 'stage=color-card only: deterministic retouch working long edge 1024~3072; default 2048.'),
        boolParam('forceRetouch', 'stage=color-card only: ignore an existing versioned asset cache and rebuild it.', false),
        strParam('configAction', 'stage=config only: exact preparation action.', false, {
            enum: ['exportColors', 'createPlaceholders']
        }),
        numParam('placeholderCount', 'stage=config/createPlaceholders only: explicit positive placeholder count; never inferred from a default.'),
        strParam('placeholderLayout', 'stage=config/createPlaceholders only: placeholder layout.', false, {
            enum: ['horizontal', 'vertical', 'grid'],
            default: 'horizontal'
        }),
        strParam('userIntent', 'Original user request')
    ],
    output: {
        type: 'data',
        description: 'Stage-specific SKU result: editable color-card/template documents, configuration data, or verified production exports.'
    },
    requiredTools: ['skuLayout', 'prepareSkuRetouchAssets', 'listDocuments', 'switchDocument', 'getDocumentInfo', 'getLayerHierarchy', 'createDocument', 'createRectangle', 'createTextLayer', 'setTextContent', 'createGroup', 'placeImage', 'setLayerVisibility', 'setBlendMode', 'moveLayerToGroup', 'createSkuPlaceholders', 'getSkuPlaceholders', 'exportColorConfig', 'convertToSmartObject', 'editSmartObjectContents', 'createClippingMask', 'getClippingMaskInfo', 'getLayerBounds', 'getLayerProperties', 'setTextStyle', 'moveLayer', 'closeDocument', 'getSmartObjectInfo', 'getCanvasSnapshot', 'fitLayerSubjectToRegion', 'transformLayer', 'saveDocument', 'getAcceptanceSnapshot', 'quickExport', 'exportToSkuDir'],
    internalTools: [
        'skuLayout',
        'prepareSkuRetouchAssets',
        'createSkuPlaceholders',
        'getSkuPlaceholders',
        'exportColorConfig',
        'exportToSkuDir'
    ],
    interactionOwner: 'skill-provider',
    examples: [
        {
            userSays: '按我确认的卡其+浅紫、灰+红两组做 2 双装 SKU，不要备注图',
            parameters: {
                stage: 'full',
                comboSizes: [2],
                specifiedColors: [['卡其', '浅紫'], ['灰', '红']],
                generateNotes: false
            }
        },
        {
            userSays: '继续上次已确认的 2-3-4 双装任务，只补对应的 SKU 自选备注',
            parameters: { stage: 'full', comboSizes: [2, 3, 4], onlyNotes: true, generateNotes: true }
        },
        {
            userSays: '导出当前 SKU 颜色配置',
            parameters: { stage: 'config', configAction: 'exportColors' }
        }
    ],
    estimatedTime: 30,
    hasDecisionPoints: true
};

export const ShapeMorphingSkill: SkillDeclaration = {
    id: 'shape-morphing',
    name: 'Shape Morphing',
    displayName: '形态变形',
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
        arrParam('sourceLayerIds', 'Source product layer ids for batch morphing', false, {
            items: { type: 'number' }
        }),
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
    displayName: '版式复刻',
    userFacingSummary: '按参考图分析版式结构，在 Photoshop 里重建为可编辑的图层版式',
    category: 'replication',
    kind: 'workflow',
    visibility: 'user-facing',
    routeClass: 'business-workflow',
    visualSamplingScenario: 'reference-replication',
    controlledRouteEntry: 'autonomous-react-loop',
    modelDirectExecution: 'forbidden',
    runtimeRequirements: {
        photoshop: 'required',
        document: 'not_required'
    },
    description: 'Analyze and rebuild the editable visual structure of a concrete reference image. The requested deliverable type remains the primary task identity.',
    whenToUse: ['User explicitly asks to replicate, recreate, trace, or copy the layout structure of a concrete reference image'],
    whenNotToUse: [
        'User only asks to search for references or inspiration instead of using a specific reference image',
        'User asks for a finished poster, main image, banner, or other creative deliverable and only says the image is a reference; the full task must stay in the autonomous design loop',
        'User asks for open-ended creative design without a provided reference layout',
        'User asks for SKU production, detail-page content filling, document save/export, or single-layer edits without explicit reference replication'
    ],
    routing: {
        intentSignals: [
            '参考图复刻',
            '复刻',
            '照着做',
            '按图做',
            '仿照',
            '同款版式',
            'copy layout',
            'replicate layout',
            'recreate layout',
            'same layout'
        ],
        intentSignalGroups: [
            ['参考图', '样图', '海报', '版式', '布局', 'reference image', 'reference design', 'attached reference', 'layout'],
            ['复刻', '照着做', '按图做', '仿照', '复现', '还原', '临摹', '同款', 'replicate', 'copy layout', 'recreate', 'same layout']
        ],
        negativeSignals: ['关闭文档', '不保存', 'SKU', '抠图', '只问模型'],
        preconditions: ['需要用户提供参考图，或当前上下文已经附带参考图'],
        supportedModes: ['execute'],
        parameterExtractionHints: ['抽取 artifactKind、outputMode、templateApply、templateBlueprintOnly、projectPath、outputWidth、outputHeight、是否保持参考图尺寸；artifactKind 只能来自用户明确交付物（poster/banner/main-image/detail-page），不能由 templateApply 推断成详情页'],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['如果没有参考图，明确提示需要提供参考图而不是假装继续执行'],
        decisionGuidance: [
            'Layout Replication 需要具体参考图或已附带参考画面；只有“找参考/找灵感”时应使用 design-reference-search。',
            '“做什么”优先于“怎么做”：海报/主图/横幅/详情页是交付物身份，复刻只是实现方法，不能用本 Skill 覆盖交付物身份。',
            '用户说“参考这张图做海报”时保持完整海报任务进入自主设计循环；循环可把本 Skill 作为参考结构分析与可编辑骨架能力调用。',
            'template_apply 只是写入方式，不代表详情页。只有 artifactKind=detail-page 才允许多屏详情页结构与详情页自动填充。',
            '如果用户只要求单个图层移动、缩放、重命名或顺序调整，不要调用本 skill。'
        ],
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
        strParam('artifactKind', 'Explicit target deliverable identity', false, {
            enum: ['generic', 'poster', 'banner', 'main-image', 'detail-page']
        }),
        boolParam('templateBlueprintOnly', 'Analyze reference and output an artifact-aware editable blueprint only', false),
        boolParam('templateApply', 'Analyze reference and apply an artifact-aware editable skeleton', false),
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
    displayName: '设计参考检索',
    category: 'analysis',
    kind: 'operation',
    visibility: 'user-facing',
    runtimeRequirements: {
        photoshop: 'not_required'
    },
    description: 'Search and fetch design references for the requested style.',
    whenToUse: ['User asks for visual style references'],
    whenNotToUse: [
        'User provides a concrete reference image and asks to replicate or rebuild its layout',
        'User asks to edit, fill, export, or save the current Photoshop document',
        'User asks for SKU production, background removal, or single-image visual analysis'
    ],
    routing: {
        intentSignalGroups: [
            ['搜索', '搜一下', '查找', '检索', '找一些', '找一下', '找', 'search', 'find'],
            ['参考', '参考图', '设计参考', '视觉参考', '参考案例', '灵感', '竞品', '竞店', '对标', '同款', '同类', '相似风格', '类似风格', '设计方案', '视觉方案', 'reference', 'inspiration']
        ],
        negativeSignals: ['复刻', '照着做', '按图做', '同款版式', 'copy layout', 'replicate', 'recreate', '抠图', 'SKU 组合图'],
        preconditions: ['用户给出参考检索主题，或上下文中存在上一轮明确的参考检索目标'],
        supportedModes: ['execute'],
        parameterExtractionHints: ['抽取 query、mode=search、limit；保留产品、材质、风格和平台关键词'],
        clarificationHints: ['如果没有检索主题，询问要搜索的产品、风格或设计方向'],
        decisionGuidance: [
            '搜索参考、找灵感、找视觉案例时使用本 skill。',
            '不要把“找参考”误路由为参考图复刻；复刻需要用户提供具体参考图。',
            '这是外部/知识检索，不需要 Photoshop 文档写入。'
        ],
        routeStatusMessages: {
            deterministic: '检索相关设计参考，并整理可用于设计判断的视觉方向。'
        }
    },
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
    displayName: '视觉分析',
    category: 'analysis',
    kind: 'operation',
    visibility: 'user-facing',
    runtimeRequirements: {
        photoshop: 'source_dependent',
        photoshopFreeSourceTypes: ['attached_image', 'base64', 'local_file']
    },
    description: 'Analyze style, color, composition and elements from image input, active document, or a specific Photoshop layer.',
    whenToUse: [
        'User asks to analyze style, color, composition, or elements in a specific image/current document',
        'User names a Photoshop layer and asks what the image inside that layer contains',
        'User asks for read-only visual understanding before deciding a design direction'
    ],
    whenNotToUse: [
        'User asks to search external references or inspiration',
        'User asks to replicate a reference layout into Photoshop',
        'User asks to analyze an entire project image set or inventory',
        'User asks to edit, generate, export, or save design outputs'
    ],
    routing: {
        intentSignalGroups: [
            ['这个图', '这张图', '图片', '海报', '画面', '当前画面', '当前文档', 'image', 'poster', 'canvas'],
            ['分析', '看一下', '看看', '识别', '理解', '构图', '颜色', '风格', '元素', 'composition', 'color', 'style', 'analyze']
        ],
        negativeSignals: ['搜索', '找参考', '参考图', '灵感', '竞品', '复刻', '按图做', '照着做', '项目图片', '项目素材', '项目资源', 'SKU', '主图', '详情页', '导出', '保存', '生成'],
        preconditions: ['需要本轮附件图片、当前文档截图、目标图层名称/ID，或用户提供的本地图片路径'],
        supportedModes: ['inspect'],
        parameterExtractionHints: ['抽取 sourceType、filePath、layerName、layerId、analysisFocus；本轮有附件且用户说“这张图/图片”时 sourceType=attached_image；用户明确说某个图层里的图片时 sourceType=layer，传 layerName 或 layerId；明确说当前画面/当前文档时 sourceType=active_document'],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['如果没有当前文档或图片输入，先让用户提供要分析的图片'],
        decisionGuidance: [
            'Visual Analysis 是只读视觉理解能力，不写入 Photoshop。',
            '指定图层分析必须先定位图层并导出该图层图像，再分析图层内容；不要退回整张画布截图。',
            '项目级素材理解使用 project-image-analysis，不要用单图分析替代项目分析。',
            '搜索外部参考使用 design-reference-search；复刻具体参考图使用 layout-replication。'
        ],
        routeStatusMessages: {
            deterministic: '读取目标画面后分析构图、颜色和视觉元素。'
        }
    },
    parameters: [
        strParam('sourceType', 'Image source type', true, {
            enum: ['attached_image', 'local_file', 'active_document', 'layer'],
            default: 'active_document'
        }),
        strParam('filePath', 'Local image path when sourceType is local_file'),
        strParam('layerName', 'Photoshop layer name when sourceType is layer'),
        numParam('layerId', 'Photoshop layer ID when sourceType is layer'),
        strParam('analysisFocus', 'Analysis focus', false, {
            enum: ['general', 'style', 'color', 'layout', 'elements'],
            default: 'general'
        }),
        strParam('exportMode', 'Optional layer export mode when sourceType is layer', false, {
            enum: ['imaging', 'native-png'],
            default: 'imaging'
        }),
        strParam('exportFormat', 'Optional layer export image format when sourceType is layer and exportMode is imaging', false, {
            enum: ['jpeg', 'png'],
            default: 'jpeg'
        })
    ],
    output: {
        type: 'data',
        description: 'Visual analysis JSON report.'
    },
    requiredTools: ['getCanvasSnapshot', 'findLayers', 'getLayerBounds', 'exportLayerAsBase64', 'visual:analyzeLocalImage', 'visual:analyzeBase64Image'],
    examples: [
        {
            userSays: '分析这个海报的构图',
            parameters: { sourceType: 'local_file', filePath: 'D:/project/poster.jpg', analysisFocus: 'layout' }
        },
        {
            userSays: '帮我看看图层 2026-05-10 090013 这张图片里面是什么内容',
            parameters: { sourceType: 'layer', layerName: '2026-05-10 090013', analysisFocus: 'elements' }
        }
    ],
    estimatedTime: 5
};

export const ProjectImageAnalysisSkill: SkillDeclaration = {
    id: 'project-image-analysis',
    name: 'Project Image Analysis',
    displayName: '项目图片分析',
    category: 'analysis',
    kind: 'workflow',
    visibility: 'user-facing',
    routeClass: 'open-design',
    runtimeRequirements: {
        photoshop: 'not_required'
    },
    // 模型路由不得直执：项目图片分析要在 Agent 循环里根据观察结果逐步推进，不由模型路由一跳到底。
    modelDirectExecution: 'forbidden',
    description: 'Analyze images already scanned from the current project and summarize style, features, and detail-page direction.',
    whenToUse: [
        'User asks to understand project images or source photos',
        'User asks what style, features, or selling points can be inferred from project images',
        'User asks how the current project images can be used for detail-page design'
    ],
    whenNotToUse: [
        'User already uploaded a specific image and only wants single-image editing',
        'User asks to create, generate, export, or deliver a main image, detail page, SKU image, or other finished design from project assets',
        'No project is loaded and no project images are available'
    ],
    routing: {
        intentSignals: [
            '项目中的图片',
            '项目里的图片',
            'regex:(?:当前|这个|本)?项目(?:内|里|中)?(?:都)?(?:有什么|有哪些|包含什么|包括什么)',
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
            'regex:(?:分析|理解|看看|看一下|检查)(?:一下)?(?:当前|这个)?(?:项目|project)',
            'regex:(?:当前|这个).{0,8}(?:项目|project)'
        ],
        intentSignalGroups: [
            ['项目中的图片', '项目里的图片', 'regex:(?:当前|这个|本)?项目(?:内|里|中)?(?:都)?(?:有什么|有哪些|包含什么|包括什么)', '项目图片', '项目素材', '项目原图', '原图', '文件夹图片', '图片资源', '图片内容', '项目内容', '项目资源', '资源列表', '素材列表', '这些图片', '这些图', '这些照片', '这些素材', '当前项目', '这个项目', 'regex:(?:分析|理解|看看|看一下|检查)(?:一下)?(?:当前|这个)?(?:项目|project)', 'regex:(?:当前|这个).{0,8}(?:项目|project)'],
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
            '如果用户要求完成、生成、导出或验收主图、详情页、SKU 等成品，项目图片理解只是前置观察阶段，不能停在本 skill。',
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
        arrParam('directories', 'Optional project directories to prioritize when selecting images', false, {
            items: { type: 'string' }
        }),
        strParam('userIntent', 'Original user request')
    ],
    output: {
        type: 'data',
        description: 'Aggregated project-image analysis and detail-page suggestions.'
    },
    requiredTools: ['analyzeProjectContactSheetOverview', 'analyzeAssetContent'],
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
    displayName: '图层管理',
    category: 'layout',
    kind: 'operation',
    visibility: 'user-facing',
    controlledRouteEntry: 'autonomous-react-loop',
    description: 'Inspect an existing Photoshop design, let the model declare semantic screen/module memberships from current visual and layer observations, and safely organize or perform deterministic layer operations.',
    whenToUse: [
        'User asks to organize a messy Photoshop layer panel by visual screen, module, or element relationship',
        'User asks to select, rename, delete, duplicate, group, ungroup, or move existing Photoshop layers into a group',
        'User asks to move layers up/down/top/bottom or above/below another layer in the Photoshop layer stack',
        'User asks to sort color layers from light to dark or dark to light in layer panel order',
        'User asks how many product color layers exist in the current Photoshop document',
        'User asks which text layer contains a specific copy string, or where that text layer is positioned'
    ],
    whenNotToUse: [
        'User asks to move a layer on the canvas by x/y position',
        'User asks to create a whole design, detail page, main image, or SKU batch',
        'User asks to save, close, switch, or create documents'
    ],
    routing: {
        intentSignals: ['整理图层', '图层整理', '组合图层', '图层组合', '按屏归组', '按模块归组', 'regex:(整理|归组|组合).{0,8}(图层|编组)', 'regex:(图层|编组).{0,8}(整理|组合)', 'regex:(调整|移动|放).{0,12}图层组', '图层顺序', '图层层级', '调整图层', '选中图层', '选择图层', '重命名图层', '删除图层', '复制图层', '图层编组', '解除编组', '移动到图层组', '移入图层组', '放到组内', '置顶', '置底', '上移图层', '下移图层', '移到上方', '移到下方', 'regex:(图层|颜色层|层级).{0,12}(从浅到深|从深到浅)', 'regex:(从浅到深|从深到浅).{0,10}(排序|排列|图层)', '几个颜色', '多少个颜色', '颜色图层', '几个图层', '隐藏图层', '看不到图层', '文案文本在哪个图层', '文本在哪个位置', '哪个图层', '所在图层', 'organize layers', 'layer order', 'rename layer', 'delete layer', 'duplicate layer', 'group layers'],
        negativeSignals: ['保存文档', '关闭文档', '自选备注', '抠图', '形态统一'],
        preconditions: ['需要 Photoshop 当前文档存在，且目标图层可通过 layerId、layerName、当前选择或图层层级读取确定'],
        supportedModes: ['select', 'rename', 'delete', 'duplicate', 'organize', 'group', 'ungroup', 'move-to-group', 'reorder', 'inspect'],
        modeSignals: {
            select: ['选中图层', '选择图层', '定位图层', 'focus layer', 'select layer'],
            rename: ['重命名图层', '图层改名', 'rename layer'],
            delete: ['删除图层', '删掉图层', 'delete layer'],
            duplicate: ['复制图层', '拷贝图层', 'duplicate layer'],
            organize: ['整理图层', '图层整理', '组合图层', '图层组合', '按屏归组', '按模块归组', 'regex:(整理|归组|组合).{0,8}(图层|编组)', 'regex:(图层|编组).{0,8}(整理|组合)', 'regex:(调整|移动|放).{0,12}图层组', 'organize layers'],
            group: ['图层编组', '编组图层', 'group layers'],
            ungroup: ['解除编组', '取消编组', 'ungroup'],
            'move-to-group': ['移动到组', '放到组内', '移入图层组', '移动到目标图层组', 'move into group'],
            reorder: ['图层顺序', '图层层级', '置顶', '置底', '上移图层', '下移图层', '移到上方', '移到下方', 'regex:(图层|颜色层|层级).{0,12}(从浅到深|从深到浅)', 'regex:(从浅到深|从深到浅).{0,10}(排序|排列|图层)', 'layer order'],
            inspect: ['几个颜色', '多少个颜色', '颜色图层', '几个图层', '隐藏图层', '看不到图层', '查看图层', '读取图层', '文案在哪', '文本在哪', '哪个图层', '所在图层']
        },
        parameterExtractionHints: ['抽取 action、documentId、layerId、layerIds、layerName、targetLayerId、targetLayerName、newName、reorderAction、sortBy、sortDirection、inspectMode、textContent；organize 必须由模型先观察画面和层树，再提供 groups:[{name,layerIds,confidence,rationale}]、intentionallyUnassignedLayerIds，并回传 observationDocumentId / observationHistoryStateId 绑定首次观察版本'],
        retryPolicy: 'inherit_previous',
        clarificationHints: [
            'organize 不把内部语义计划、隐藏层、空组或低置信图层交给用户决策：默认原位保留不确定项，并执行其余可撤回的安全归组。只有 select/rename/delete 等原子操作无法唯一定位目标时才询问。'
        ],
        decisionGuidance: [
            '改变 Photoshop 图层面板堆叠顺序必须使用 reorderLayer，不要使用 moveLayer。',
            '“整理图层/按屏或模块归组”使用 organize：先读标注画面与带 bounds 的完整层树，由模型判断视觉模块；Harness 不按第几屏或品类关键词猜成员。',
            '用户说“帮我整理/组合图层”已经授权执行目标范围内可通过 Photoshop History 撤回的归组操作；语义计划是 Agent 内部工具参数，不是发给用户审批的方案。',
            'organize 首轮返回 awaiting_semantic_plan 后，下一步必须立即用同一 observationDocumentId / observationHistoryStateId 再调用 layer-management(action=organize, groups=...)；不能用文字建议、问题清单或“你确认后我再做”收尾。',
            '隐藏层、空组、锁定层和低置信成员默认保持原状并列入 intentionallyUnassignedLayerIds；“整理/组合”不得擅自扩大为删除、重命名或改变现有设计内容，也不得因此阻断其余安全归组。',
            'organize 的每个 groups 项必须包含语义名称、明确 layerIds、0–1 confidence 和判断理由；所有非 group 图层必须进入一个语义组，或显式列入 intentionallyUnassignedLayerIds，少量子集不能声明完成。',
            '安全归组只接受同一父级的连续兄弟层与完整剪贴蒙版链；unsupportedStructuralGroups 不能原样重试，应重新划分同父级连续成员或显式保留，不要退化成 createGroup + moveLayerToGroup × N。',
            'organize 写入前后必须按同一 region 比较未叠加标注的原始画布指纹；像素变化或无法证明等价时，撤销本轮新建组并验证恢复，不能用模型的审美判断代替等价证明。',
            '改变父子层级、把图层放入某个组内时使用 moveLayerToGroup，不要使用 moveLayer。',
            '源图层和目标组已经明确时，move-to-group 默认放入组内即可；不要额外追问顶部、底部或大小位置，除非用户明确要求组内排序或画布坐标调整。',
            'moveLayer 只用于画布 x/y 位置移动，不适用于“置顶/置底/上移/下移/从浅到深排序”。',
            '如果用户说“从浅到深/从深到浅”，先读取图层层级和图层属性，只在能从图层名称或属性推断明暗时执行。',
            '如果用户问当前文档有几个颜色，使用 inspectMode=color-layers，并读取隐藏图层；不要把背景、选区、蒙版、参考层计入商品颜色。',
            '如果用户问某段文案或文本在哪个图层、哪个位置，使用 inspectMode=text-layer-location，并用 textContent 传入要查找的文本内容。',
            '如果用户追问隐藏图层或图层数量，仍然属于 Photoshop 状态读取，不应被普通聊天问答吞掉。'
        ],
        routeStatusMessages: {
            deterministic: '读取图层层级，按明确目标执行图层管理操作并复核。',
            autonomous: '读取图层层级后处理图层管理操作。'
        }
    },
    parameters: [
        strParam('action', 'Layer management action', true, {
            enum: ['select', 'rename', 'delete', 'duplicate', 'group', 'organize', 'ungroup', 'move-to-group', 'reorder', 'inspect']
        }),
        numParam('documentId', 'Optional opened Photoshop document id to switch before inspecting or editing layers'),
        numParam('layerId', 'Target layer id'),
        arrParam('layerIds', 'Target layer ids', false, {
            items: { type: 'number' }
        }),
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
        strParam('textContent', 'Text content to locate in Photoshop text layers'),
        strParam('inspectMode', 'Inspection mode for layer analysis', false, {
            enum: ['color-layers', 'text-layer-location']
        }),
        arrParam(
            'groups',
            'For action=organize: exhaustive semantic group plans. Membership must come from the current annotated visual and hierarchy readback.',
            false,
            {
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: [
                        {
                            name: 'name',
                            type: 'string',
                            description: 'Non-empty semantic screen or module group name.',
                            required: true,
                            minLength: 1
                        },
                        {
                            name: 'layerIds',
                            type: 'array',
                            description: 'Positive integer layer ids assigned to this group.',
                            required: true,
                            minItems: 1,
                            uniqueItems: true,
                            items: {
                                type: 'integer',
                                minimum: 1
                            }
                        },
                        {
                            name: 'confidence',
                            type: 'number',
                            description: 'Semantic grouping confidence from 0 to 1.',
                            required: true,
                            minimum: 0,
                            maximum: 1
                        },
                        {
                            name: 'rationale',
                            type: 'string',
                            description: 'Non-empty visual and structural reason for the grouping.',
                            required: true,
                            minLength: 1
                        }
                    ]
                }
            }
        ),
        arrParam(
            'intentionallyUnassignedLayerIds',
            'For action=organize: explicit positive integer IDs of non-group layers intentionally kept unchanged. Together with groups, this must cover every non-group layer in the observed hierarchy.',
            false,
            {
                uniqueItems: true,
                items: {
                    type: 'integer',
                    minimum: 1
                }
            }
        ),
        boolParam('preserveUnassigned', 'For action=organize: must remain true; only intentionallyUnassignedLayerIds may stay outside a declared semantic group.', true),
        numParam('observationDocumentId', 'For action=organize: document id returned by the hierarchy observation used to build groups.'),
        numParam('observationHistoryStateId', 'For action=organize: Photoshop history-state id returned by the hierarchy observation used to build groups.'),
        strParam('userIntent', 'Original user request')
    ],
    output: {
        type: 'data',
        description: 'Layer management execution result with actual tool results.'
    },
    requiredTools: [
        'listDocuments',
        'switchDocument',
        'getDocumentInfo',
        'getAnnotatedSnapshot',
        'getLayerHierarchy',
        'getAllTextLayers',
        'getLayerBounds',
        'getLayerProperties',
        'selectLayer',
        'renameLayer',
        'deleteLayer',
        'duplicateLayer',
        'groupLayers',
        'groupLayersSafely',
        'undo',
        'ungroupLayers',
        'moveLayerToGroup',
        'reorderLayer',
        'getAcceptanceSnapshot'
    ],
    examples: [
        {
            userSays: '帮我理解当前详情页每一屏的元素关系并整理图层',
            parameters: {
                action: 'organize',
                groups: [
                    {
                        name: '01 首屏',
                        layerIds: [101, 102, 103],
                        confidence: 0.92,
                        rationale: '三个连续兄弟层在画布顶部形成同一视觉模块'
                    }
                ],
                intentionallyUnassignedLayerIds: [],
                observationDocumentId: 42,
                observationHistoryStateId: 765,
                preserveUnassigned: true
            }
        },
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
        },
        {
            userSays: '“波浪边缘，增添法式感。”这段文案在哪个图层、什么位置',
            parameters: { action: 'inspect', inspectMode: 'text-layer-location', textContent: '波浪边缘，增添法式感。' }
        }
    ],
    estimatedTime: 4,
    hasDecisionPoints: true
};

export const FindEditElementSkill: SkillDeclaration = {
    id: 'find-and-edit-element',
    name: 'Find And Edit Element',
    displayName: '查找并编辑元素',
    category: 'analysis',
    kind: 'workflow',
    visibility: 'user-facing',
    // 模型路由不得直执（真机病例 2026-07-07）：「改一下详情页的文案」被直执后，多候选
    // 分支以一句「候选图层不唯一」终结任务。定位/消歧必须在 Agent 循环里进行——多候选
    // 结果作为 observation 回给模型消歧或向用户展示清单，工作流输出不能当终局答案。
    modelDirectExecution: 'forbidden',
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
        intentSignals: ['右上角文案', '左上角文案', '顶部标题', '底部按钮', '中间图片', '画布上的文字', '页面上的价格', '把文案改成', '把文字改成', '替换图片', '选中这个元素', '定位这个元素', '去除色卡编号', '隐藏色卡顺序编号'],
        negativeSignals: ['图层顺序', '图层层级', '置顶', '置底', '保存文档', '关闭文档', '详情页', '主图', 'SKU', '批量'],
        preconditions: ['需要 Photoshop 当前文档存在，并且 getElementMapping 能返回可编辑元素映射'],
        supportedModes: ['locate', 'select', 'setText', 'move', 'scale', 'setOpacity', 'setBlendMode', 'replaceImage', 'hide'],
        modeSignals: {
            locate: ['定位', '找到', '看看哪个元素'],
            select: ['选中', '选择'],
            setText: ['改成', '改为', '替换成', '换成', '写成', '设置为', '修改为'],
            move: ['移动', '挪到'],
            scale: ['放大', '缩小', '缩放'],
            setOpacity: ['透明度', '不透明度'],
            setBlendMode: ['混合模式'],
            replaceImage: ['替换图片', '换图'],
            hide: ['去除', '去掉', '移除', '隐藏', '不显示', '取消显示', '拿掉']
        },
        parameterExtractionHints: ['抽取 targetDescription、action、text、layerId、x、y、dx、dy、scalePercent、opacity、blendMode、filePath'],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['候选分数不足或候选差距过小时，先让用户确认候选，不要盲改'],
        decisionGuidance: [
            '用户描述的是画布视觉位置和元素语义时，优先用 getElementMapping 定位，而不是直接猜 layerId。',
            '用户说“改成/改为/替换成”并且目标是文案/文字/标题/价格时，action 应为 setText。',
            '用户说“去除/隐藏”某个画布元素时，默认用 hide 做可逆隐藏；如果识别到同一类色卡编号，可以作为一组处理。',
            '用户说“图层顺序/置顶/置底/从浅到深”时不要使用本能力，应交给 layer-management。'
        ]
    },
    parameters: [
        strParam('targetDescription', 'Visual description of target element', true),
        strParam('action', 'Edit action', false, {
            enum: ['locate', 'select', 'setText', 'move', 'scale', 'setOpacity', 'setBlendMode', 'replaceImage', 'hide'],
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
    displayName: '面板操作桥接',
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
        arrParam('reproSteps', 'Minimal reproduction steps', false, {
            items: { type: 'string' }
        }),
        arrParam('constraints', 'Restrictions and guardrails', false, {
            items: { type: 'string' }
        }),
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
    displayName: '文档管理',
    category: 'document',
    kind: 'operation',
    visibility: 'user-facing',
    // 模型路由不得直执：文档写操作需要循环内读后写纪律与上下文核对，不由模型路由直接落地。
    modelDirectExecution: 'forbidden',
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
    displayName: '保存当前模板',
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
        arrParam('tags', 'Optional tags for template retrieval', false, {
            items: { type: 'string' }
        }),
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
    displayName: '文字字体替换',
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
            '如果当前消息只是“再改一下/没改成功”之类的续作反馈，应优先继续上一条字体修改任务。',
            '字体替换后必须复核字号、字距、行距和文本边界变化；不能只因 fontName 写入成功就声明版面效果完成。'
        ],
        routeStatusMessages: {
            deterministic: '读取当前文档文本图层，批量替换字体并逐层验证结果。',
            autonomous: '读取文本图层，批量替换字体并验证。'
        }
    },
    parameters: [
        strParam('fontName', 'Target font family or PostScript name', true),
        arrParam('layerIds', 'Optional explicit text layer ids to update', false, {
            items: { type: 'number' }
        }),
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
    displayName: '电商袜品设计编排',
    category: 'ecommerce',
    kind: 'workflow',
    visibility: 'user-facing',
    // 模型路由不得直执：父级编排工作流必须经 Agent 自主循环协调子任务与评审。
    modelDirectExecution: 'forbidden',
    description: 'Coordinate and execute a full socks e-commerce delivery as one parent workflow. Main image, detail page, and SKU remain Manifest-owned child deliverables; the parent only dispatches them and aggregates verified child results.',
    whenToUse: [
        'User asks to complete an overall socks e-commerce design delivery',
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
            [
                '电商袜子设计',
                '袜子电商设计',
                '整套',
                '全套',
                '一套',
                '整体',
                '全链路',
                '全案',
                '完整',
                '全部',
                '全盘',
                '跑完',
                '自主跑完',
                '三个skill',
                '三个 skill',
                '三个技能',
                '主图详情页SKU',
                '主图 详情页 SKU',
                '主图、详情页和SKU',
                '主图、SKU、详情页',
                '详情页、SKU、主图',
                '主图+详情页+SKU',
                '主图+SKU+详情页',
                '主图/详情页/SKU',
                '主图/SKU/详情页',
                'main image detail page sku',
                'full set',
                'whole project'
            ]
        ],
        negativeSignals: ['只做SKU', '只做 SKU', '只做主图', '只做详情页', '临时详情页草稿', '临时主图草稿', '保存文档', '关闭文档', '改字体', '图层顺序'],
        preconditions: ['需要项目上下文、当前 Photoshop 文档或用户明确指定交付范围'],
        supportedModes: ['plan', 'execute'],
        parameterExtractionHints: [
            '抽取 deliverables: main-image/detail-page/sku 与 projectPath；用户要求“完成/设计/制作整套”时由父 workflow 下发子交付',
            '主图、详情页、SKU 的专业流程、能力和质量验收分别归各自 Manifest；父 workflow 不复制或替代子 Skill 的设计逻辑',
            '只有用户明确要求规划、不执行时才设置 executeChildren=false；普通整套制作请求不重复询问是否开始',
            'enableChildDispatch/runChildDispatch/executeRealChildDispatch 只用于显式停用或测试，不能成为普通请求的隐藏门槛'
        ],
        retryPolicy: 're-evaluate',
        clarificationHints: ['如果用户没有明确是整套设计还是单项交付，先确认交付范围'],
        decisionGuidance: [
            '这是父 workflow 入口：负责按用户交付范围下发并汇总，不直接改写主图、详情页、SKU 的业务策略。',
            '用户明确只做单项 SKU、主图或详情页时，保持现有子 skill 路由。',
            '用户提出整套袜子电商设计或同时包含主图/详情页/SKU 时，优先使用本 skill，并让每个子项进入自己的声明式 Runtime。'
        ],
        routeStatusMessages: {
            deterministic: '整理电商袜品设计目标，并按主图、详情页和 SKU 各自的 Runtime 下发与验收。'
        }
    },
    parameters: [
        strParam('userIntent', 'Original user request'),
        arrParam('deliverables', 'Requested child deliverables: main-image, detail-page, sku', false, {
            items: { type: 'string' }
        }),
        strParam('projectPath', 'Optional project path for socks assets'),
        boolParam('executeChildren', 'Whether parent skill may dispatch child skills; default is false', false),
        boolParam('confirmChildDispatch', 'Explicit confirmation that child skill dispatch is allowed', false),
        // 刻意不给默认值：applySharedSkillParamDefaults 会把 default 实际填进 params，
        // 于是「没传」和「显式传 false」在执行器里无法区分——父 Skill 的直接下发改造
        // 因此长期失效（真机 2026-07-31：授权已 approved，仍报 child_dispatch_checkpoint_not_implemented）。
        // 现在缺省即 undefined，由执行器 resolveChildDispatchEnabled 决定默认放行；显式 false 仍可关闭。
        boolParam('enableChildDispatch', 'Switch for real child executor calls; omit to use the executor default (enabled), pass false to disable'),
        boolParam('dryRunChildDispatch', 'Report child dispatch order without calling child executors', false),
        arrParam('childReports', 'Optional existing child reports for parent aggregation', false, {
            items: {
                type: 'object',
                description: 'One child dispatch report object produced by a previous child skill run.'
            }
        })
    ],
    output: {
        type: 'data',
        description: 'Parent orchestration context for main-image, detail-page, and SKU child skills.'
    },
    requiredTools: [],
    examples: [
        {
            userSays: '帮我完成一套电商袜子设计，包含主图、详情页和SKU',
            parameters: { deliverables: ['main-image', 'detail-page', 'sku'] }
        }
    ],
    estimatedTime: 3,
    hasDecisionPoints: true
};

export const MainImageSkill: SkillDeclaration = {
    id: 'main-image-design',
    playbookId: 'main-image-design',
    name: 'Main Image Design',
    displayName: '主图设计',
    userFacingSummary: '电商主图从目标理解到可编辑交付：由 Agent 选图、定方向、构图并根据真实质量结论修订',
    category: 'ecommerce',
    kind: 'workflow',
    visibility: 'user-facing',
    visualSamplingScenario: 'main-image',
    // 该声明拥有主图交付物的 Runtime 身份。Agent 在自主循环中完成看图、选图、创意、
    // 构图和逐槽决定；显式绑定 ecommerce.main_image Manifest 后，这个唯一 workflow
    // entry 只把 Agent 已提交的 slotAssignments 编译为标准文档、保存与导出。
    controlledRouteEntry: 'autonomous-react-loop',
    routeClass: 'business-workflow',
    // legacy/deterministic 路由不得跳过 Agent 循环直执；Manifest 绑定后的同一 Agent
    // 可以把自己的逐槽决定提交给这个受控 production entry。
    modelDirectExecution: 'forbidden',
    description: '开工先用 readSkillPlaybook("main-image-design") 读取主图用途、店铺规格分文档体系和交付边界。手册不规定主素材角色、图层数量、版式、文案或组件组合；这些设计判断由 Agent 基于当前任务与真实像素完成。Runtime owner for e-commerce main-image delivery. For open creative work, call prepare with one explicit size to create the standard empty Photoshop workspace, use general Photoshop tools to author the layered design, then call finalize with the returned workspace reference. Finalize exports only groups proven non-empty by live Photoshop readback. The legacy slotAssignments submission remains available for deterministic one-placement production. This Skill never chooses assets, copy, layout, or aesthetic direction.',
    whenToUse: [
        'User explicitly delegates a main-image, cover, or first-image design deliverable',
        'User asks for a white background image (白底图)',
        'User asks for a click image or conversion image with e-commerce spec rules',
        'User asks to export main images in standard sizes (800/750/1200) from SKU/project material'
    ],
    whenNotToUse: [
        'User asks for detail page generation',
        '用户只要求浏览或分析项目素材，没有委托主图交付物'
    ],
    routing: {
        // 宽泛 intentSignals 只服务白底图/点击图等规格化候选；创意主图只通过下面完整、
        // 锚定的 canonical entry 绑定 Manifest，并由自主循环真实设计，不直调旧规格 executor。
        // 白底图含省略写法「白底」与错别字「自底图/自底」（SKU 素材白底图生产），一并覆盖。
        intentSignals: ['白底图', '白底', '自底图', '自底', '点击图', '转化图', 'white background', 'white-bg'],
        negativeSignals: ['项目图片分析'],
        preconditions: ['通常需要当前文档或主图素材'],
        supportedModes: ['inspect', 'execute'],
        modeSignals: {
            inspect: ['查看', '检查', '分析', '评估', '复核', '审核', '验收', '评审', '审查', '说明', '了解'],
            execute: ['导出', '生成', '制作', '处理', '保存', '出图']
        },
        canonicalProductionEntries: [
            'regex:^(?:请|麻烦)?\\s*(?:帮我|给我|替我|为我)?\\s*(?:继续\\s*)?(?:设计|做|制作|出|生成|完成|导出|修复|改|修改|调整|优化|处理)\\s*(?:一张|一个|一版|这个|当前)?\\s*(?:(?:新的?|创意|电商|商品)\\s*){0,3}(?:白底图|点击图|转化图|主图|首图|封面)$'
        ],
        parameterExtractionHints: ['抽取 size、sizes、imageType、sourceAssetKind、outputDirPolicy、backgroundPrompt、outputDir，以及 Agent/用户已选定的 deliveryConvention；versionPolicy=new_version 时还必须抽取明确 deliveryVersion，且文件夹或文件名实际使用 {version}。开放创意主图使用两段式交付：先以 mainImageProductionAction=prepare 和一个由 Agent 明确选择的 size 创建空工作文档；拿到 mainImageWorkspaceRef 后，使用通用 Photoshop 工具完成多图、文字、形状、蒙版与排版；至少一个标准子组真实非空后，以 mainImageProductionAction=finalize 和同一 workspaceRef 保存/导出。不要把 prepare 当设计完成，不要在 finalize 重新置图。未显式指定规格时先查看当前项目已确认或重复出现的同类交付习惯，再由 Agent 选择；Harness 不代选规格。三个标准文档都保留 5 个点击槽和 4 个转化槽。legacy 确定性生产仍可用 slotAssignments 逐槽提交单次 placement；没有 slotAssignments 时不得从候选第一项、selectedAsset、旧计划或文件名补位。用户明确只要空骨架文件时才设置 createEmptySkeleton=true。调用是否可写由 Harness 签发的 guarded executor 与交付 authority 决定，模型参数不能自行批准执行。白底图能力定义为 main-image.white-bg-from-sku-material：sourceAssetKind=project-sku-material、outputDirPolicy=project-main-image-dir、PSD/SKU.psb -> 主图/白底.jpg；用户只是讨论、询问或规划时可显式设置 strategy-only；不要从 outputDir、selectedAsset、enableVisionPreflight 单独推断真实 Photoshop 写入；用户明确要求理解/分析所选项目图时可设置 enableVisionPreflight=true；不要默认批量分析项目图片，maxVisionCandidates 默认 1'],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['如果用户同时提到模板和现有主图优化，先问是新建模板还是处理当前画面'],
        decisionGuidance: [
            '如果用户是在处理现有主图的优化、导出或排版，使用这个 skill，而不是模板创建 skill。',
            '普通“做主图”未给规格时，先让 Agent 从当前项目的同类成品与已确认 delivery 规则中选择交付规格；800/750/1200 是无更可靠项目证据时的 Skill 基线，不能由早期参数默认器抢先冻结。',
            '800/750/1200 都保留点击图和转化图容器；槽位是否填充由当前 Agent/用户决定，空槽不导出。白底图是 SKU 源文件导出，不从点击图或转化图裁切。',
            '先判断用户是在询问/规划还是明确要求生成文件；工具边界负责限制写入范围，不要用固定规则禁止模型根据任务选择工具。',
            '普通创意主图先由 Agent 自主形成设计判断；需要落入标准生产结构时，由 Agent 将逐槽决定提交给当前 Manifest 的唯一 production entry。明确的 SKU 白底图导出请求属于确定性素材生产，可使用同一受控入口。'
        ],
        routeStatusMessages: {
            deterministic: '判断主图任务类型、素材来源和执行边界，再选择规划或受控导出路径。',
            autonomous: '由 Agent 根据当前目标，自主选择需要读取的画面、图层、素材与项目事实并规划主图。'
        }
    },
    parameters: [
        deliveryConventionParam(),
        strParam('deliveryVersion', 'Agent- or user-selected safe version label required when deliveryConvention.versionPolicy=new_version; it must be rendered through {version} in both editable and raster targets.'),
        strParam('size', 'Output size preset', false, {
            enum: ['800', '750', '1200', 'custom']
        }),
        objParam('customSize', 'Custom size object {width,height}'),
        objParam('agentDesignDecision', 'Agent-authored main-image direction; no Harness default visual plan is supplied'),
        strParam('mainImageProductionAction', 'Two-step open-creative production action: prepare one standard workspace, then finalize the same Agent-authored workspace', false, {
            enum: ['prepare', 'finalize']
        }),
        strParam('mainImageWorkspaceRef', 'Opaque workspace reference returned by prepare; required unchanged for finalize'),
        mainImageSlotAssignmentsParam(),
        boolParam('createEmptySkeleton', '只创建并保存当前规格的标准空骨架（白底文档、2 个父组、5+4 空槽），不置入素材或导出 raster；仅在用户明确要求空骨架时设置 true。'),
        numParam('desiredClickImageCount', 'Agent- or user-declared number of authored click directions, capped by authored directions and five structural slots'),
        numParam('desiredConversionImageCount', 'Agent- or user-declared number of authored conversion directions, capped by authored directions and four structural slots'),
        numParam('productScale', 'Agent- or user-declared subject scale ratio; no Harness default is supplied'),
        strParam('outputDir', 'Output directory'),
        strParam('imageType', 'Main image type', false, {
            enum: ['click', 'conversion', 'white-bg']
        }),
        strParam('sourceAssetKind', 'Main-image source asset boundary', false, {
            enum: ['project-sku-material', 'selected-project-image', 'active-document']
        }),
        strParam('outputDirPolicy', 'Main-image output directory policy', false, {
            enum: ['project-main-image-dir', 'explicit-output-dir']
        }),
        strParam('mainImageCapability', 'Stable main-image business capability id'),
        strParam('whiteBackgroundSourceDocumentPath', 'White background source document path'),
        strParam('whiteBackgroundOutputRelativePath', 'White background export relative path'),
        arrParam('sizes', 'Batch output sizes list; each entry is a size preset key such as "800", "750", "1200" or a delivery ratio key', false, {
            items: { type: 'string' }
        }),
        strParam('mainImageExecutionMode', 'Controlled execution mode for the main-image executor', false, {
            enum: ['strategy-only', 'product-disposable-live']
        }),
        strParam('executionScope', 'Controlled Photoshop execution scope', false, {
            enum: ['disposable-document', 'active-document', 'project-document'],
            default: 'disposable-document'
        }),
        boolParam('enableVisionPreflight', 'Explicitly analyze the selected project image before main-image planning; default false to avoid hidden model cost', false),
        numParam('maxVisionCandidates', 'Maximum project-image candidates to analyze when enableVisionPreflight is true; capped by executor, default 1', false, { default: 1 }),
        strParam('backgroundPrompt', 'Optional AI background prompt'),
        strParam('userIntent', 'Original user request')
    ],
    output: {
        type: 'files',
        description: 'Main-image production plan and, when the Runtime supplies guarded execution authority, exact editable documents and assigned-group exports.'
    },
    requiredTools: ['getSubjectBounds', 'smartLayout', 'transformLayer', 'moveLayer', 'exportGroup', 'saveDocument'],
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
            parameters: {
                imageType: 'white-bg',
                sourceAssetKind: 'project-sku-material',
                outputDirPolicy: 'project-main-image-dir',
                mainImageExecutionMode: 'strategy-only'
            }
        },
        {
            userSays: '帮我使用SKU素材做白底图导出到主图目录下',
            parameters: {
                imageType: 'white-bg',
                sourceAssetKind: 'project-sku-material',
                outputDirPolicy: 'project-main-image-dir',
                mainImageCapability: 'main-image.white-bg-from-sku-material',
                mainImageExecutionMode: 'product-disposable-live',
                executionScope: 'disposable-document'
            }
        }
    ],
    estimatedTime: 10,
    hasDecisionPoints: false
};

export const DetailPageDesignSkill: SkillDeclaration = {
    id: 'detail-page-design',
    playbookId: 'detail-page-design',
    name: 'Detail Page Design',
    displayName: '详情页设计',
    userFacingSummary: '电商详情页整页制作：套用你的模板或从零设计，逐屏完成并导出切片',
    category: 'ecommerce',
    kind: 'workflow',
    visibility: 'user-facing',
    visualSamplingScenario: 'detail-page',
    // 详情页（含模板套版）不再内嵌固定流水线：受控路由命中也交给 Agent 自主循环，
    // detail-page-design 作为循环内可选技能工具（模板解析/填充能力仍在），不由引擎直执脚本。
    controlledRouteEntry: 'autonomous-react-loop',
    routeClass: 'business-workflow',
    // 模型路由不得直执：详情页设计必须经 Agent 自主 ReAct 循环（先看图后规划的视觉观察纪律在循环内强制）。
    modelDirectExecution: 'forbidden',
    description: '开工先用 readSkillPlaybook("detail-page-design") 读工作法手册（店铺逐屏叙事框架/1440 规格/组名带理由的命名习惯）。项目级详情页设计任务说明：先摸索项目、读取素材和当前文档，再判断走模板套版还是纯设计；模板优先但不是硬前提，复核未通过时调整策略后继续推进。',
    whenToUse: [
        '用户只说“做详情页 / 设计详情页 / 生成详情页 / 整理详情页”时，先进入本 Skill 的项目级 Agent 循环，不要先要求用户指定模板路径。',
        '项目或当前 Photoshop 文档里可能有详情页模板时，优先检查并理解模板，再决定是否套版。',
        '用户明确要求检查、解析、填充、替换内容或导出现有详情页模板/文档时，使用模板套版路径。套版两条纪律：版式主权（用户模板的占位框位置/尺寸/样式一律不动，只换文案与图片，版式问题报告用户不擅自改）；内容发挥（文案基于素材中可读取的卖点事实、市场洞察和文案框架撰写，选图按构图字段择优，不机械照抄占位符示意原文）。',
        '没有模板、模板不可用或用户要求纯设计时，继续走从零设计路径：理解素材、提炼卖点、规划阶段、创建画布、排版、观察、调整和复核。'
    ],
    whenNotToUse: [
        'User asks only single-layer manual edit',
        'User asks only to save/export the currently open document without changing detail-page content',
        'User asks for matting, background removal, or unrelated Photoshop maintenance work'
    ],
    routing: {
        intentSignals: ['详情页', '长图', '卖点页', '参数页', '面料页', 'detail page'],
        // 详情页 Skill 是任务说明书，不是模板解析器。模板是优先路径，找不到模板仍可继续纯设计。
        negativeSignals: ['保存文档', '保存当前文档', '保存到项目', '保存为 PSD', '保存PSD', '存一下', '保存一下', '导出当前文档', '当前文档导出', '文档导出', '详情页文档导出', '导出为 PNG', '导出PNG', '导出成PNG', '导出为 JPG', '导出JPG', '导出成JPG', '导出为 PDF', '导出PDF', '导出成PDF', 'save document', 'save psd', 'export document', 'export png', 'export jpg', 'export pdf', '仅改单个图层'],
        preconditions: ['需要能读取项目资源、当前 Photoshop 文档或用户提供素材中的至少一种上下文；找不到模板不是阻塞项，而是进入从零设计路径。'],
        supportedModes: ['inspect', 'execute'],
        modeSignals: {
            inspect: ['结构', '模板', '分析', '检查', '看一下', '复核', '审核', '验收', '评审', '审查', '可以吗', 'structure', 'analyze', 'inspect', 'review'],
            execute: ['做', '设计', '填充', '生成', '制作', '整理', '处理', '套版', '套成', '套用', '修复', '优化', '修改', '调整', '导出', '出图', '排版', '换图', 'design', 'fill', 'generate', 'export']
        },
        canonicalProductionEntries: [
            'regex:^(?:请|麻烦)?\\s*(?:帮我|给我|替我|为我)?\\s*(?:继续\\s*)?(?:做|制作|设计|生成|完成|套版|套用|修复|改|修改|调整|优化|处理|排版|出)\\s*(?:这个|当前|一个|个|一套|一版)?\\s*(?:详情页|详情长图|商品详情长图)(?:\\s*套版)?$'
        ],
        parameterExtractionHints: [
            '抽取 workMode、inspectOnly、autoFix、structureMode、visualValidation、projectPath、outputDir、deliveryVersion。',
            'template_fill 必须传 contentSource；有用户附件时 contentSource=attached_image，不要再强求 projectPath。',
            'edit_existing 必须传 targetScope、requestedChange 与结构化 editContentMode；editContentMode 只能是 image_only、copy_only 或 both，禁止 Harness 根据关键词猜测。',
            'targetScope 使用明确屏名/第N屏/图层名；同名屏或同名图层有歧义时必须补充第N屏或 ID，禁止省略或多目标兜底。'
        ],
        retryPolicy: 'inherit_previous',
        clarificationHints: ['只有在项目和当前文档都无法提供素材、模板或产品信息时，才询问用户补充素材或项目路径。'],
        decisionGuidance: [
            '先形成阶段判断：项目摸索、模板判断、素材理解、执行路径、结果复核。',
            '循环推进时先判断当前是模板套版、模板修复后套版，还是无模板从零设计；再处理项目、视觉分析、预览或 Photoshop 画面，随后读回结果并判断是否达到当前阶段目标。',
            '模板优先：若项目或当前文档里有可理解的详情页模板，先读取完整图层关系、文案框、图片占位符、icon、矩形占位符和屏组结构，再套版。',
            '套版时只替换内容并检查标准：文案尽可能控制在原文字数/字符数附近，不主动改变字体、字号、位置和间距；模板不规范不是失败理由，设计助手应基于图层关系继续理解并必要时优化改善。',
            '图片置入时要基于用户或项目摄影图理解卖点，选择合适图片放入占位符，建立剪切蒙版，并根据版式气质调整缩放、裁切和主体位置。',
            '没有模板、模板不可用或用户要求纯设计时，继续从零设计：读取设计方法论和参考，理解素材，提炼卖点，创建详情页画布，按阶段渲染草稿，截图复核并调整。',
            'edit_existing 是局部编辑契约：只处理 targetScope 对应屏，并按 editContentMode 只写图片、只写文案或同时写二者；写后只审计目标屏，并核对目标外屏未变化；不得调用整页重填作为兜底。',
            '结果复核未通过时，不输出硬成功；分析失败原因、定位问题阶段、生成下一轮约束，再继续处理。'
        ],
        routeStatusMessages: {
            deterministic: '先摸索项目、模板和素材，再判断详情页走套版还是从零设计。',
            autonomous: '进入详情页设计循环，边观察项目内容边推进设计。'
        }
    },
    parameters: [
        deliveryConventionParam(),
        strParam('deliveryAction', 'Internal delivery phase. Use commit only when the active Runtime continuation explicitly reopens this same Skill after visual review; the parameter alone never grants delivery permission.', false, {
            enum: ['prepare', 'commit'],
            default: 'prepare'
        }),
        strParam('workMode', 'Detail-page work mode selected from the manifest contract', false, {
            enum: ['create_new', 'redesign', 'template_fill', 'edit_existing', 'analyze_only', 'export_only']
        }),
        strParam('contentSource', 'Content source for template_fill; use attached_image when user attachments provide the content'),
        strParam('existingDocument', 'Existing Photoshop detail-page document reference for edit_existing'),
        strParam('targetScope', 'Explicit edit_existing target such as 第4屏, a screen name, or a layer name/id'),
        strParam('requestedChange', 'Exact local change requested for edit_existing'),
        strParam('editContentMode', 'Required structured write kind for edit_existing; do not infer it in Harness', false, {
            enum: ['image_only', 'copy_only', 'both']
        }),
        strParam('agentMode', 'Bounded Agent handoff mode for detail-page work', false, {
            enum: ['auto', 'inspect', 'execute', 'export'],
            default: 'auto'
        }),
        strParam('reviewPolicy', 'Post-execution review policy for Agent handoff', false, {
            enum: ['review_required', 'stop_on_blocker'],
            default: 'review_required'
        }),
        strParam('projectPath', 'Project path for assets and export'),
        strParam('outputDir', 'Export directory'),
        strParam('deliveryVersion', 'Explicit version label when deliveryConvention uses the {version} token'),
        boolParam('exportSlices', 'Whether this work mode owes a complete slice set. The intake derives the default from Runtime workMode; edit_existing enables it only for an explicit slice request.'),
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
        'listProjectResources',
        'searchProjectResources',
        'analyzeAssetContent',
        'getDetailPageDesignFramework',
        'parseDetailPageTemplate',
        'detectLayerIssues',
        'fixLayerIssues',
        'matchDetailPageContent',
        'fillDetailPage',
        'createDocument',
        'renderLayout',
        'placeImage',
        'setTextContent',
        'setTextStyle',
        'getCanvasSnapshot',
        'exportDetailPageSlices'
    ],
    examples: [
        {
            userSays: '帮我做详情页',
            parameters: { agentMode: 'auto', autoFix: true, structureMode: 'guided' }
        },
        {
            userSays: '用当前详情页模板套版并导出',
            parameters: { agentMode: 'execute', autoFix: true, structureMode: 'guided' }
        }
    ],
    estimatedTime: 30,
    hasDecisionPoints: true
};

export const AutonomousAgentSkill: SkillDeclaration = {
    id: 'autonomous-agent',
    name: '自主智能体',
    displayName: '自主设计执行',
    category: 'analysis',
    kind: 'workflow',
    visibility: 'system-only',
    routeClass: 'open-design',
    visualSamplingScenario: 'general-design',
    description: '自主处理复杂多步任务：观察真实结果、选择下一步动作，并在未达成目标时调整策略继续推进。',
    whenToUse: [
        'Complex tasks requiring multiple observed actions and reasoning',
        'User explicitly requests autonomous or fully-automatic mode',
        'Tasks that span observation, analysis, and execution phases'
    ],
    parameters: [
        strParam('userTask', 'The task description from user', true),
        strParam('modelId', 'Override model ID for agent'),
        numParam('maxIterations', 'Max autonomous loop iterations', false, { default: 25 }),
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
    SKUSkill,
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
    DetailPageDesignSkill,
    AutonomousAgentSkill
];

export function getSkillById(id: string): SkillDeclaration | undefined {
    return SKILL_REGISTRY.find((s) => s.id === id);
}

/**
 * 查询领域原子工具的声明式 owner。通用 Runtime 只消费该映射，不维护品类名单。
 */
export function getSkillInternalToolOwnerIds(toolName: string): string[] {
    const normalizedToolName = String(toolName || '').trim();
    if (!normalizedToolName) return [];
    return SKILL_REGISTRY
        .filter((skill) => skill.internalTools?.includes(normalizedToolName))
        .map((skill) => skill.id);
}

/** 全部需要 Runtime owner 的领域原子工具名。 */
export function getSkillInternalToolNames(): string[] {
    return Array.from(new Set(
        SKILL_REGISTRY.flatMap((skill) => skill.internalTools || [])
    ));
}

/** 业务交互卡是否由 Skill Provider 构造。 */
export function isSkillProviderInteractionOwner(skillId: string): boolean {
    return getSkillById(skillId)?.interactionOwner === 'skill-provider';
}

export function getSkillsByCategory(category: string): SkillDeclaration[] {
    return SKILL_REGISTRY.filter((s) => s.category === category);
}

/**
 * 该技能在受控技能路由命中后是否应交给 Agent 自主 ReAct 循环（而非引擎直执固定流水线）。
 * 单一声明来源：SkillDeclaration.controlledRouteEntry === 'autonomous-react-loop'。
 */
export function isControlledRouteAutonomousEntrySkill(id: string): boolean {
    return getSkillById(id)?.controlledRouteEntry === 'autonomous-react-loop';
}

/** 全部声明为「受控路由命中→自主循环」的技能 id（声明式派生，供路由/收敛复用）。 */
export function getControlledRouteAutonomousEntrySkillIds(): string[] {
    return SKILL_REGISTRY
        .filter((s) => s.controlledRouteEntry === 'autonomous-react-loop')
        .map((s) => s.id);
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
