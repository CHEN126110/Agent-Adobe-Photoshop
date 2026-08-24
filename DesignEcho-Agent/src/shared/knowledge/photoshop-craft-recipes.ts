import type { RuntimeContextItem } from '../agent-runtime-v5/runtime-context-compiler';
import type { RuntimeStage } from '../agent-runtime-v5/contracts';

export type PhotoshopCraftRecipeLifecycle = 'active' | 'deprecated' | 'withdrawn';

export interface PhotoshopCraftParameterSource {
    field: string;
    authority: 'user' | 'project_fact' | 'photoshop_observation' | 'designer_decision';
    rule: string;
}

export interface PhotoshopCraftToolOption {
    toolName: string;
    useWhen: string;
    doNotUseWhen: string;
    readback: string;
}

/**
 * Photoshop Craft Recipe 是受治理的设计知识，不是 Tool 调用计划或固定 Workflow。
 * Model 可以选择、裁剪或拒绝；只有 R4/Capability/preflight/TaskRun/Runner 才能授权并执行动作。
 */
export interface PhotoshopCraftRecipe {
    schemaVersion: 'photoshop-craft-recipe/v0';
    recipeId: string;
    version: string;
    title: string;
    visualIntent: string;
    applicableTaskTypes: string[];
    applicableStages: RuntimeStage[];
    useWhen: string[];
    doNotUseWhen: string[];
    requiredObservations: string[];
    stableTargets: string[];
    parameterSources: PhotoshopCraftParameterSource[];
    toolOptions: PhotoshopCraftToolOption[];
    preserve: string[];
    expectedStructure: string[];
    expectedPixels: string[];
    verification: {
        structure: string[];
        visual: string[];
        unknown: string;
        failure: string;
        rollback: string;
    };
    evaluationRefs: string[];
    provenance: {
        kind: 'bundled_curated';
        sourceRevision: string;
        lifecycle: PhotoshopCraftRecipeLifecycle;
        reviewedAt: string;
    };
    boundaries: {
        advisoryOnly: true;
        grantsPermission: false;
        executesTools: false;
        advancesStage: false;
        provesCompletion: false;
    };
}

const EDITABLE_SINGLE_CANVAS_COMPOSITION: PhotoshopCraftRecipe = {
    schemaVersion: 'photoshop-craft-recipe/v0',
    recipeId: 'photoshop-craft.editable-single-canvas-composition',
    version: '1.0.0',
    title: '可编辑单画布图文构成',
    visualIntent: '把真实商品素材、确定文案和视觉方向组织为层级明确、可继续编辑、可读回复核的单画布设计，而不是生成一张不可编辑的扁平成图。',
    applicableTaskTypes: [
        'design.generic.v1',
        'design.single_canvas_visual.v1',
        'ecommerce.main_image.v1',
        'ecommerce.sku_template.v1'
    ],
    applicableStages: ['R4', 'R5'],
    useWhen: [
        '需要建立或重构单张画布的背景、主视觉、标题、辅助信息和装饰层级。',
        '用户要求可编辑 PSD/PSB，且素材、文案、画布或允许的设计判断已有来源。',
        '业务 Skill 未启用，但通用 Agent 仍需把设计判断落实到 Photoshop。'
    ],
    doNotUseWhen: [
        '只是修改一个已明确图层的确定性属性；直接使用对应原子 Tool 并做同目标读回。',
        '任务是详情页多屏说服链、SKU 批量套版或参考图高相似复刻；应使用相应 Task Profile/Overlay/Recipe。',
        '当前没有稳定 document/revision、真实素材来源或必须逐字准确的文案。'
    ],
    requiredObservations: [
        '目标画布或现有文档的 documentId、尺寸、revision/history，以及需要保留的图层结构。',
        '候选商品素材的真实内容、主体位置/占比、边缘与清晰度；文件名和缩略印象不能替代视觉观察。',
        '用户或项目提供的逐字文案、商品/品牌事实、画布规格与交付格式。',
        '若使用参考，只提取与当前目标相关的构图、层级、色彩职责或工艺线索；没有看过像素不得声称参考具有什么效果。'
    ],
    stableTargets: [
        '所有写动作绑定当前 documentId 与 revision；已有图层使用当前读回得到的稳定 layerId。',
        '新建文档只用于确实需要新交付物的任务；修改类任务不得为了方便绕开现有目标。',
        '每次写后以返回的新 revision 继续，外部变化进入重新观察/等待/停止，不重放旧写入。'
    ],
    parameterSources: [
        {
            field: 'canvas.width / canvas.height / resolution',
            authority: 'user',
            rule: '优先使用用户或平台明确规格；项目权威规格可补充。两者都没有时才使用 Task Profile 的可解释默认值，并在交付中说明。'
        },
        {
            field: 'product facts / copy / price / SKU / claims',
            authority: 'project_fact',
            rule: '只能来自用户、已确认项目事实或可追溯素材；模型不得为了版面完整编造。'
        },
        {
            field: 'documentId / revision / layerId / current bounds',
            authority: 'photoshop_observation',
            rule: '只接受当前 Photoshop 读回；不得从历史消息、图层名称猜 ID 或默认依赖活动图层。'
        },
        {
            field: 'visual hierarchy / layout regions / spacing / color roles',
            authority: 'designer_decision',
            rule: '由 Agent 基于目标、素材、品牌/参考约束和真实观察形成；这是可撤销的专业判断，不要求用户逐项批准。'
        },
        {
            field: 'fontName',
            authority: 'photoshop_observation',
            rule: '写入前用字体解析结果确认真实可用字体；模糊建议不是可写 fontName。'
        }
    ],
    toolOptions: [
        {
            toolName: 'renderLayout',
            useWhen: '需要把角色、比例、对齐和图文关系转成可编辑图层结构，且当前视觉方向已经明确。',
            doNotUseWhen: '只是局部修改，或尚未观察素材/确定文案；它不是设计方向生成器，也不代表整稿完成。',
            readback: '按 suggestedObservation 查看真实局部像素，并读取层级/边界；质量 finding 进入有界修订。'
        },
        {
            toolName: 'placeImage',
            useWhen: '把有来源的商品或装饰素材作为可继续变换的置入层加入目标文档。',
            doNotUseWhen: '没有分析主视觉候选、只凭文件名选图，或目标文档身份不稳定。',
            readback: '记录返回 layerId，读取 bounds；检查清晰度、主体可见比例、裁切和与文案的空间关系。'
        },
        {
            toolName: 'transformLayer',
            useWhen: '需要把明确 layerId 等比适配到设计区域；优先使用 targetBounds/targetFit 表达意图。',
            doNotUseWhen: '缺少稳定 layerId，或用非等比缩放掩盖素材比例冲突。',
            readback: '读取同一 layerId 的真实 bounds，并在画面快照中检查主体视觉占比而不只看图层外框。'
        },
        {
            toolName: 'createTextLayer',
            useWhen: '逐字文案已确定，需要建立可编辑标题、辅助信息或说明文本。',
            doNotUseWhen: '文案仍是模型猜测，或只是修改已有文本层。',
            readback: '读取文本内容、bounds 与图层身份；检查截断、溢出、层级、对比与遮挡。'
        },
        {
            toolName: 'setTextStyle',
            useWhen: '已有明确文本 layerId，且只需 patch 已支持的字体、字号、字距或行距字段。',
            doNotUseWhen: '试图修改未声明的颜色、字重、对齐、文本框尺寸，或没有 resolveFontName 的精确字体结果。',
            readback: '依赖 Tool 的同 layerId 样式读回；继续用像素快照检查实际视觉层级和排版节奏。'
        },
        {
            toolName: 'createRectangle',
            useWhen: '需要建立可编辑色块、信息底板、角标或明确几何背景。',
            doNotUseWhen: '装饰没有服务层级/对比目的，或会遮挡商品与关键信息。',
            readback: '读取 shape layer 与 bounds，并在快照中检查色块职责、对比、遮挡和安全区。'
        },
        {
            toolName: 'groupLayersSafely',
            useWhen: '同一视觉模块已经形成，需要按语义组织背景、主视觉、标题、辅助信息或装饰层。',
            doNotUseWhen: '目标 layerId/父级关系未读回，或分组会改变剪贴、蒙版、图层顺序语义。',
            readback: '读取层级，确认只包含目标图层且视觉顺序、裁切/蒙版关系未被破坏。'
        },
        {
            toolName: 'getDocumentSnapshot',
            useWhen: '完成首稿或一次有意义的修订后，从真实像素评价焦点、层级、构图、对比和一致性。',
            doNotUseWhen: '把截图成功当成结构正确、质量通过或 Delivery 完成。',
            readback: '结合结构读回与任务目标只找影响最大的 1—3 个问题；无实质问题时停止微调。'
        },
        {
            toolName: 'saveDocument',
            useWhen: '结构、像素与逐字内容已经读回，且当前任务明确要求保存或导出。',
            doNotUseWhen: '用保存成功替代质量、交付物齐全或用户接受。',
            readback: '消费真实 Receipt/ArtifactRef；任何后续写入都会使旧交付收据失效，必须重新验证。'
        }
    ],
    preserve: [
        '用户提供的原始素材、逐字文案、品牌标识、商品颜色/规格和版权/合规边界。',
        '现有文档中不属于本轮目标的图层、蒙版、剪贴、智能对象与混合样式关系。',
        '可编辑性：文本保持文本、几何底板保持形状、置入素材保持可追溯；除非用户明确要求，不合并或栅格化整个设计。'
    ],
    expectedStructure: [
        '图层按视觉角色和模块语义命名，至少能区分背景、主视觉、主标题、辅助信息与装饰。',
        '同一模块可形成语义组；目标图层 ID、父级与顺序可由结构读回确认。',
        '交付文档保留可编辑文本、独立商品素材与必要的非破坏性结构。'
    ],
    expectedPixels: [
        '第一视觉焦点与任务目标一致；商品、标题和辅助信息的优先级可在缩略尺度辨认。',
        '主体没有意外裁切、拉伸、模糊或被装饰/文字遮挡；文案没有溢出、截断或不可读对比。',
        '色彩、留白、对齐和装饰服务于当前传播目的，而不是机械套用固定比例或效果。'
    ],
    verification: {
        structure: [
            '读取当前 document/revision、图层层级、目标 layerId、文本内容与 bounds。',
            '验证请求的结构变化已经发生，且范围外图层与关系保持。'
        ],
        visual: [
            '读取同一 revision 的真实像素快照，分别在整体缩略图和关键局部检查。',
            '对照本轮 Design Decision 检查焦点、层级、主体/文字关系、色彩职责与必须保留项。'
        ],
        unknown: '读回丢失、超时或返回不可归属时标记 unknown 并做同目标 reconciliation；禁止重放写动作或伪造成功。',
        failure: '目标/权限/确定性内容错误、结构损坏或必需交付缺失进入失败；一般审美问题进入 needs_review 或最多一次有依据的局部修订。',
        rollback: '只有 Runner 持有匹配 transaction/revision 的回滚能力时才能执行回滚；否则停止并报告真实应用状态与待复核范围。'
    },
    evaluationRefs: ['design-quality-verdict/v0'],
    provenance: {
        kind: 'bundled_curated',
        sourceRevision: 'photoshop-craft-recipes-2026-08-03',
        lifecycle: 'active',
        reviewedAt: '2026-08-03'
    },
    boundaries: {
        advisoryOnly: true,
        grantsPermission: false,
        executesTools: false,
        advancesStage: false,
        provesCompletion: false
    }
};

const FLATTENED_RASTER_TEXT_REPLACEMENT: PhotoshopCraftRecipe = {
    schemaVersion: 'photoshop-craft-recipe/v0',
    recipeId: 'photoshop-craft.flattened-raster-text-replacement',
    version: '1.0.0',
    title: '合并图局部文字替换',
    visualIntent: '在旧文字已经进入合并像素、无法直接编辑文本内容时，只修复目标字形区域并叠加新的可编辑文字，保护相邻标签、背景和其它像素。',
    applicableTaskTypes: [
        'design.generic.v1',
        'design.single_canvas_visual.v1',
        'ecommerce.main_image.v1',
        'ecommerce.detail_page.v1',
        'ecommerce.sku_template.v1',
        'ecommerce.sku_color_card.v1'
    ],
    applicableStages: ['R4', 'R5'],
    useWhen: [
        '结构读回确认目标可见文字不属于可编辑文本图层，而是已合并到位图或智能对象像素中。',
        '旧字区域可在文档像素坐标中稳定定位，新文案逐字确定，且只需要局部非破坏性修订。',
        '旧字位于纯白背景，或背景色值已有用户/项目权威来源并且局部像素视觉上均匀。'
    ],
    doNotUseWhen: [
        '目标是可编辑文本图层；应直接 setTextContent，并保持现有样式。',
        '旧字覆盖纹理、渐变、照片、阴影或边缘，平涂色块会产生补丁痕迹；应使用可验证选区的修复/生成填充，当前没有选区能力时进入 needs_review。',
        '只凭缩略图猜旧字范围、背景色或基线，或者新文案会挤压相邻字段但没有可用空间。'
    ],
    requiredObservations: [
        '读取 documentId、revision、图层层级和文本图层内容，先证明目标文字确实已经合并，不把图层名、可见文字和文本内容混为一谈。',
        '位置未知时只做一次全图定位；随后读取一个包含旧字、同一行标签和少量上下文的紧凑 getCanvasSnapshot region，并固定其文档像素映射。',
        '在局部像素中识别旧字可见墨迹边界、相邻标签右边界、同一行基线/字高、可用水平空间以及背景是否真正均匀。',
        '新文字内容、大小写、空格和必须保留的前缀必须来自用户当前指令；例如只替换值时不得遮掉字段标签。'
    ],
    stableTargets: [
        '所有写入绑定当前 documentId/revision；目标栅格层和新建修复层的 layerId 均来自当前 TaskRun。',
        '遮盖范围只取旧字可见墨迹边界加最小抗锯齿余量，不扩张到相邻标签、标点或下一行。',
        '写后只重读同一个局部 region；结果 unknown 时做同目标 reconciliation，不重放遮盖和建字动作。'
    ],
    parameterSources: [
        {
            field: 'replacement content / preserved prefix',
            authority: 'user',
            rule: '逐字沿用用户当前指令；只替换值时，字段名、冒号和其它相邻字符必须保持。'
        },
        {
            field: 'old glyph bounds / baseline / available width',
            authority: 'photoshop_observation',
            rule: '来自紧凑局部快照的文档像素映射；不得从整图缩略图或历史消息猜坐标。'
        },
        {
            field: 'cover fill color',
            authority: 'project_fact',
            rule: '纯白可使用 #FFFFFF；其它颜色必须有用户/项目权威色值并由局部像素确认均匀。没有可靠色值时不执行平涂遮盖。'
        },
        {
            field: 'font / fontSize / tracking / text position',
            authority: 'designer_decision',
            rule: '以同一行相邻文字的可见字高、基线、粗细和可用宽度为视觉约束；字体不可确认时选可用近似字体并如实标记，优先保证基线、字高和字重关系。'
        }
    ],
    toolOptions: [
        {
            toolName: 'getLayerHierarchy',
            useWhen: '确认目标文档结构和目标可见文字是否存在对应文本图层。',
            doNotUseWhen: '反复读取没有变化的层级，或用图层名称代替可见文字判断。',
            readback: '记录目标栅格层、已有文本层和稳定 document/revision。'
        },
        {
            toolName: 'getCanvasSnapshot',
            useWhen: '定位旧字并读取一个足以判断墨迹边界、背景、基线和邻接关系的紧凑局部。',
            doNotUseWhen: '对同一未变化区域反复截图，或用全图缩略图估算几个像素宽的修复范围。',
            readback: '保留 region 的文档像素坐标；写后用完全相同的 region 只复核一次。'
        },
        {
            toolName: 'createRectangle',
            useWhen: '旧字位于已确认的纯白或权威已知色值均匀背景，需建立可编辑遮盖层。',
            doNotUseWhen: '背景有纹理、渐变、照片、阴影、边缘或颜色不确定。',
            readback: '读取遮盖层 bounds；同区域像素中不得残留旧墨迹、出现色差接缝或遮住相邻标签。'
        },
        {
            toolName: 'createTextLayer',
            useWhen: '新文案逐字确定，且遮盖范围和同一行排版基准已经观察。',
            doNotUseWhen: '文案仍不确定，或可用空间无法容纳且会覆盖下一字段。',
            readback: '读取新文本内容、layerId 与 bounds；同区域检查基线、字高、粗细、间距和完整显示。'
        },
        {
            toolName: 'groupLayersSafely',
            useWhen: '遮盖层与新文字层均已读回且需要作为一个可撤销的局部修复模块交付。',
            doNotUseWhen: '层级/顺序未确认，或分组可能改变剪贴和蒙版关系。',
            readback: '确认修复组只包含本次遮盖与新文字，视觉顺序正确。'
        }
    ],
    preserve: [
        '目标值之外的字段标签、冒号、相邻文字、原图其它像素以及原始栅格层。',
        '可撤销性：原始合并图不直接擦除；遮盖和新文字保持独立、可隐藏、可编辑。',
        '用户逐字内容，不自动改写品牌名、大小写、标点或空格。'
    ],
    expectedStructure: [
        '原始合并图保持不变；新增一个最小遮盖 shape layer 和一个可编辑 text layer。',
        '修复层名称表达“局部文字修复/新文字”职责，必要时形成单独语义组。',
        '新文字层位于遮盖层之上，且两者不影响范围外图层。'
    ],
    expectedPixels: [
        '旧字墨迹和抗锯齿边缘完全消失，背景没有可见色差、矩形接缝或意外遮挡。',
        '新文字与同一行标签在基线、可见字高、粗细和间距上协调，完整显示且不挤压下一字段。',
        '整体缩略尺度下局部修改不应形成新的视觉焦点；放大局部仍能辨认修复边界自然。'
    ],
    verification: {
        structure: [
            '读取新建 shape/text layer 的 layerId、文本内容、bounds、顺序和所属组。',
            '确认原始栅格层仍存在且范围外图层、蒙版和文案未改变。'
        ],
        visual: [
            '在与写前完全相同的 region 检查旧字残留、背景接缝、新字基线/字高/粗细、左右安全距离和完整显示。',
            '只允许一次有明确依据的局部校正；仍无法确认字体或背景自然度时停止并标记 needs_review。'
        ],
        unknown: '局部快照、写入回执或同目标读回不可归属时标记 unknown，禁止重放；只进行 reconciliation。',
        failure: '遮盖侵入相邻内容、旧字仍可见、背景出现补丁、文字溢出或文案不准确即失败；近似字体但整体协调属于 needs_review，不得伪称完全复刻。',
        rollback: '只在 Runner 持有匹配 revision 的回滚能力时回滚；否则保留独立修复层并如实报告可隐藏/删除的 layerId。'
    },
    evaluationRefs: ['design-quality-verdict/v0', 'photoshop-local-raster-text-replacement/v0'],
    provenance: {
        kind: 'bundled_curated',
        sourceRevision: 'photoshop-craft-recipes-2026-08-04',
        lifecycle: 'active',
        reviewedAt: '2026-08-04'
    },
    boundaries: {
        advisoryOnly: true,
        grantsPermission: false,
        executesTools: false,
        advancesStage: false,
        provesCompletion: false
    }
};

const SUBJECT_AWARE_IMAGE_PLACEMENT: PhotoshopCraftRecipe = {
    schemaVersion: 'photoshop-craft-recipe/v0',
    recipeId: 'photoshop-craft.subject-aware-image-placement',
    version: '1.0.0',
    title: '主体感知图片置入与视觉定尺',
    visualIntent: '把明确来源的图片作为可编辑层置入目标区域，并按真实主体而不是透明留白或图片外框确定视觉大小、重心和可见性。',
    applicableTaskTypes: [
        'design.generic.v1',
        'design.single_canvas_visual.v1',
        'ecommerce.main_image.v1',
        'ecommerce.detail_page.v1',
        'ecommerce.sku_template.v1',
        'ecommerce.sku_color_card.v1'
    ],
    applicableStages: ['R4', 'R5'],
    useWhen: [
        '用户、项目或当前 Design Decision 已明确要置入的图片以及它在画面中的职责。',
        '图片自身留白使外框 contain/cover 不能代表主体真实视觉大小。',
        '目标区域可由当前画布、布局结果、模板槽位或已确认构图明确表达。'
    ],
    doNotUseWhen: [
        '素材来源仍不明确；这时只做有预算的候选分析，不先置入任意图片。',
        '任务只是替换已有智能对象内容且目标变换应保持；优先 replaceLayerContent。',
        '把主体检测和几何通过当作最终审美、清晰度或无遮挡证明。'
    ],
    requiredObservations: [
        '当前 documentId、revision、画布尺寸、目标区域以及相邻文字/元素的真实空间关系。',
        '图片内容、真实主体、透明/画面留白、清晰度和用途；已明确来源时禁止重新搜索同一素材。',
        'Agent 根据本稿目的、素材内容与邻接元素显式声明主体占比和锚点；Harness 不从任务类型推导视觉答案。',
        '若用户明确要求匹配某张已选参考，才测量该参考；没有参考不阻断普通置入和设计判断。'
    ],
    stableTargets: [
        '置入返回的真实 layerId、当前 documentId/revision 和明确 targetRegion。',
        '同一次 fitLayerSubjectToRegion 内完成写后主体/图框读回；几何结果 unknown 时不重放缩放。',
        '视觉复核最多触发一次有依据的 transform/move 修订，避免多轮 5% 试探。'
    ],
    parameterSources: [
        {
            field: 'image source',
            authority: 'user',
            rule: '用户指定文件或当前明确素材优先；只有来源确实未决时才按项目事实分析候选。'
        },
        {
            field: 'targetRegion / safe area / nearby bounds',
            authority: 'photoshop_observation',
            rule: '来自当前画布、renderLayout 结果、模板槽位或稳定图层边界，不从聊天截图猜 Photoshop 坐标。'
        },
        {
            field: 'subjectFillRatio / anchor',
            authority: 'designer_decision',
            rule: '由 Agent 根据交付物目的、真实素材和当前构图显式声明；不能让 Harness 用品类预设代填。'
        },
        {
            field: 'referenceComposition',
            authority: 'project_fact',
            rule: '只有用户、项目标准或已选参考给出明确约束时使用；不能为了填参数任意搜索参考。'
        }
    ],
    toolOptions: [
        {
            toolName: 'placeImage',
            useWhen: '图片来源和目标文档明确，需要先建立可编辑置入层。',
            doNotUseWhen: '已明确来源却再次自动搜索，或没有稳定目标文档。',
            readback: '消费返回 layerId/source/初始 bounds；contain/cover 只作为首个几何落位。'
        },
        {
            toolName: 'fitLayerSubjectToRegion',
            useWhen: '图片外框不能代表主体视觉大小，且 targetRegion、subjectFillRatio（或已选参考实测）与 anchor 已明确。',
            doNotUseWhen: '自己先算缩放百分比，或把 measureReferenceComposition 当成通用前置。',
            readback: '消费同一次调用返回的 subjectAfter、frameAfter 与 geometryVerification；failed 才做有依据修订，unknown 不重放。'
        },
        {
            toolName: 'getCanvasSnapshot',
            useWhen: '主体适配完成后检查构图平衡、清晰度、遮挡、文案关系和视觉焦点。',
            doNotUseWhen: '几何未变化时反复截图，或仅凭 snapshot 成功声称设计完成。',
            readback: '优先观察包含目标区域和关键邻接元素的局部；有实质审美问题时只修最大问题一次。'
        },
        {
            toolName: 'transformLayer',
            useWhen: '写后像素观察发现明确的构图问题，且一次校正可由 targetBounds/targetFit 或可解释变换表达。',
            doNotUseWhen: '进行无依据的 5% 往返试探，或通过非等比拉伸解决素材比例冲突。',
            readback: '读取同 layerId bounds 并观察同一区域；一次修订后进入裁决，不无限微调。'
        }
    ],
    preserve: [
        '素材原始宽高比、主体完整性、清晰度和可追溯来源。',
        '相邻文案、Logo、安全区和现有版式关系；除非构图明确允许，不让主体遮挡关键信息。',
        '可编辑置入层/智能对象，不因方便而合并整稿。'
    ],
    expectedStructure: [
        '置入图片保留独立 layerId、可识别名称和来源；位于正确语义组与图层顺序。',
        '目标区域、设计语义、主体检测方式和几何验收结果可在 Tool Receipt 中追溯。',
        '若做一次视觉校正，仍作用于同一 layerId 和同一 TaskRun。'
    ],
    expectedPixels: [
        '主体视觉大小符合主次职责：主视觉有足够存在感，辅助图不抢焦点，网格同级元素节奏一致。',
        '主体没有意外裁切、拉伸、低清放大或被关键文案遮挡，视觉重心与目标区域关系自然。',
        '外框留白不会让主体显得异常小，也不会仅为“铺满”而挤压呼吸空间。'
    ],
    verification: {
        structure: [
            '确认置入 layerId、来源、同 document/revision 的 frameAfter/subjectAfter、图层顺序和所属组。',
            '检查 geometryVerification 的实际占比、可见比例、锚点偏差和投影偏差；它只证明几何。'
        ],
        visual: [
            '观察真实像素中的视觉大小、清晰度、重心、裁切、遮挡和与文案/留白的关系。',
            '若存在明确问题，只做一次可解释修订；无实质问题就停止，不为追求假精确反复微调。'
        ],
        unknown: '写后主体读回或 revision 不可归属时进入 reconciliation，禁止重放变换；视觉质量保持 unknown/needs_review。',
        failure: '主体大面积出界、比例明显偏离、错误图层被变换、非等比拉伸或清晰度不可接受即失败；一般审美分歧进入 needs_review。',
        rollback: '只有 Runner 持有匹配 transaction/revision 时才回滚；否则报告同 layerId 的真实应用状态并停止。'
    },
    evaluationRefs: ['design-quality-verdict/v0', 'subject-aware-image-placement/v0'],
    provenance: {
        kind: 'bundled_curated',
        sourceRevision: 'photoshop-craft-recipes-2026-08-04',
        lifecycle: 'active',
        reviewedAt: '2026-08-04'
    },
    boundaries: {
        advisoryOnly: true,
        grantsPermission: false,
        executesTools: false,
        advancesStage: false,
        provesCompletion: false
    }
};

export const PHOTOSHOP_CRAFT_RECIPES: readonly PhotoshopCraftRecipe[] = [
    EDITABLE_SINGLE_CANVAS_COMPOSITION,
    FLATTENED_RASTER_TEXT_REPLACEMENT,
    SUBJECT_AWARE_IMAGE_PLACEMENT
];

function normalizeText(value: unknown): string {
    return String(value || '').trim().toLowerCase();
}

export function listPhotoshopCraftRecipes(): PhotoshopCraftRecipe[] {
    return PHOTOSHOP_CRAFT_RECIPES.map((recipe) => ({
        ...recipe,
        applicableTaskTypes: [...recipe.applicableTaskTypes],
        applicableStages: [...recipe.applicableStages],
        useWhen: [...recipe.useWhen],
        doNotUseWhen: [...recipe.doNotUseWhen],
        requiredObservations: [...recipe.requiredObservations],
        stableTargets: [...recipe.stableTargets],
        parameterSources: recipe.parameterSources.map((source) => ({ ...source })),
        toolOptions: recipe.toolOptions.map((option) => ({ ...option })),
        preserve: [...recipe.preserve],
        expectedStructure: [...recipe.expectedStructure],
        expectedPixels: [...recipe.expectedPixels],
        verification: {
            ...recipe.verification,
            structure: [...recipe.verification.structure],
            visual: [...recipe.verification.visual]
        },
        evaluationRefs: [...recipe.evaluationRefs],
        provenance: { ...recipe.provenance },
        boundaries: { ...recipe.boundaries }
    }));
}

export function getPhotoshopCraftRecipe(recipeId: string): PhotoshopCraftRecipe | undefined {
    const normalized = normalizeText(recipeId);
    return listPhotoshopCraftRecipes().find((recipe) => normalizeText(recipe.recipeId) === normalized);
}

export function listPhotoshopCraftRecipesForTaskType(taskTypeId: string): PhotoshopCraftRecipe[] {
    const normalized = normalizeText(taskTypeId);
    if (!normalized) return [];
    return listPhotoshopCraftRecipes().filter((recipe) => (
        recipe.provenance.lifecycle === 'active'
        && recipe.applicableTaskTypes.some((taskType) => normalizeText(taskType) === normalized)
    ));
}

/**
 * Ordinary natural-language runs do not have a taskType before the model has understood and
 * declared the task. They still need the compact, category-neutral Photoshop craft foundation;
 * otherwise the most common entry path has less professional knowledge than a structured Skill
 * run and is forced to rediscover Photoshop technique through Tool trial and error.
 *
 * `design.generic.v1` is the data-owned applicability marker. This fallback does not guess a
 * business type, select a Skill, grant execution authority, or create a default Runtime manifest.
 */
export function listGeneralPhotoshopCraftRecipes(): PhotoshopCraftRecipe[] {
    return listPhotoshopCraftRecipes().filter((recipe) => (
        recipe.provenance.lifecycle === 'active'
        && recipe.applicableTaskTypes.some((taskType) => normalizeText(taskType) === 'design.generic.v1')
    ));
}

function formatList(label: string, values: readonly string[]): string {
    return `${label}：\n${values.map((value) => `- ${value}`).join('\n')}`;
}

export function formatPhotoshopCraftRecipeForKnowledge(recipe: PhotoshopCraftRecipe): string {
    return [
        `【Photoshop Craft Recipe｜${recipe.title}】`,
        `recipeId=${recipe.recipeId}；version=${recipe.version}；sourceRevision=${recipe.provenance.sourceRevision}；lifecycle=${recipe.provenance.lifecycle}`,
        `视觉意图：${recipe.visualIntent}`,
        '选择边界：这是可选择、裁剪或拒绝的设计工艺知识，不是固定工作流，也不授予任何 Tool、Stage、写入、完成或 Release 权限。',
        formatList('适用条件', recipe.useWhen),
        formatList('不适用条件', recipe.doNotUseWhen),
        formatList('必要观察', recipe.requiredObservations),
        formatList('稳定目标', recipe.stableTargets),
        `参数来源：\n${recipe.parameterSources.map((source) => (
            `- ${source.field} ← ${source.authority}：${source.rule}`
        )).join('\n')}`,
        `可选 Photoshop 工艺：\n${recipe.toolOptions.map((option) => (
            `- ${option.toolName}｜用在：${option.useWhen}｜不用在：${option.doNotUseWhen}｜读回：${option.readback}`
        )).join('\n')}`,
        formatList('必须保持', recipe.preserve),
        formatList('预期结构', recipe.expectedStructure),
        formatList('预期像素', recipe.expectedPixels),
        formatList('结构验证', recipe.verification.structure),
        formatList('视觉验证', recipe.verification.visual),
        `unknown：${recipe.verification.unknown}`,
        `失败：${recipe.verification.failure}`,
        `回滚：${recipe.verification.rollback}`,
        `Evaluation：${recipe.evaluationRefs.join(' / ')}`
    ].join('\n\n');
}

export function formatPhotoshopCraftRecipeIndexEntry(recipe: PhotoshopCraftRecipe): string {
    const selectableActions = recipe.toolOptions
        .slice(0, 4)
        .map((option) => `${option.toolName}（${option.useWhen}）`)
        .join('；');
    return [
        `【Photoshop Craft Recipe 索引｜${recipe.title}】`,
        `recipeId=${recipe.recipeId}；version=${recipe.version}`,
        `视觉意图：${recipe.visualIntent}`,
        `适用：${recipe.useWhen.slice(0, 2).join('；')}`,
        `不适用：${recipe.doNotUseWhen.slice(0, 2).join('；')}`,
        `候选工艺：${selectableActions}`,
        '先根据真实对象类型、局部像素与当前能力选择最短可靠组合；这不是必须逐项调用的试探顺序。目标和素材已经明确时，不为寻找方法重新搜索项目或参考。',
        '这是选择提示，不是固定工作流。当前任务确实需要该工艺细节时，使用 searchDesignKnowledge，intents=["recipe"]、sourceTypes=["local_recipe"]，并以 recipeId 或具体工艺问题检索完整 Recipe；不需要时直接继续。'
    ].join('\n');
}

export function buildPhotoshopCraftRecipeRuntimeItems(input: {
    taskTypeId?: string;
}): RuntimeContextItem[] {
    const taskTypeId = normalizeText(input.taskTypeId);
    const recipes = taskTypeId
        ? listPhotoshopCraftRecipesForTaskType(taskTypeId)
        : listGeneralPhotoshopCraftRecipes();
    return recipes.map((recipe) => ({
        id: `knowledge.recipe.${recipe.recipeId}`,
        kind: 'knowledge',
        source: `${recipe.recipeId}@${recipe.version}:${recipe.provenance.sourceRevision}`,
        trust: 'governed_knowledge',
        slot: 'knowledge_context',
        // 阶段上下文只注入紧凑索引；完整 Recipe 通过现有 searchDesignKnowledge 按需读取，
        // 避免每个设计任务无条件携带全部工艺正文并消耗模型预算。
        content: formatPhotoshopCraftRecipeIndexEntry(recipe),
        applicableStages: [...recipe.applicableStages],
        priority: 94,
        freshness: 'reviewed'
    }));
}
