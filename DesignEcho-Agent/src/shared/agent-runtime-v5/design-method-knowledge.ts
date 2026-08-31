/**
 * 由 Skill Manifest 激活的设计方法知识。
 *
 * 这里承载专业方法正文，不执行 Tool、不生成固定 Workflow，也不决定阶段推进。
 * 通用方法可被所有设计 Skill 复用；品类 overlay 只能被声明的 Skill 装载。
 */

import type { RuntimeStage } from './contracts';
import type { RuntimeCapabilityProviderIdentity } from './contracts/capability-resolution';
import type { RuntimeContextItem } from './runtime-context-compiler';
import { buildBundledKnowledgeArtifactRecord } from '../design-knowledge-governance';

export const DESIGN_CONTENT_STRATEGY_KNOWLEDGE_ID = 'knowledge:design.content-strategy/v1' as const;
export const DESIGN_ART_DIRECTION_KNOWLEDGE_ID = 'knowledge:design.art-direction/v1' as const;
export const DESIGN_LAYOUT_PLANNING_KNOWLEDGE_ID = 'knowledge:design.layout-planning/v1' as const;
export const MAIN_IMAGE_METHOD_KNOWLEDGE_ID = 'knowledge:ecommerce.main-image/v1' as const;
export const DETAIL_PAGE_METHOD_KNOWLEDGE_ID = 'knowledge:ecommerce.detail-page/v1' as const;
export const SINGLE_CANVAS_VISUAL_METHOD_KNOWLEDGE_ID = 'knowledge:design.single-canvas-visual/v1' as const;
export const SKU_COLOR_CARD_METHOD_KNOWLEDGE_ID = 'knowledge:ecommerce.sku-color-card/v1' as const;
export const SKU_TEMPLATE_METHOD_KNOWLEDGE_ID = 'knowledge:ecommerce.sku-template/v1' as const;
export const SKU_BATCH_METHOD_KNOWLEDGE_ID = 'knowledge:ecommerce.sku-batch/v1' as const;

export interface DesignMethodKnowledgeDefinition {
    capabilityId: string;
    title: string;
    applicableSkillIds: string[];
    applicableStages: RuntimeStage[];
    sourceRevision: string;
    objective: string;
    method: string[];
    expectedOutput: string;
    evaluationFocus: string[];
    /**
     * 任务本质（workflow vs agent 的核心轴，对齐 Anthropic「Building Effective Agents」）：
     * - 'structured'：规格明确的结构化生产（SKU 组合/色卡等），以用户确认的规格为准，尽快进入执行，
     *   不需要长时间创意 brief/strategy 推演；
     * - 'creative'：开放式创意设计（主图/详情页等），需要真正的设计规划。
     * 缺省（跨切面通用知识）不标注。结构化任务据此获得轻仪式引导，避免被创意声明仪式饿死。
     */
    productionNature?: 'structured' | 'creative';
}

export interface DesignMethodKnowledgeContext {
    version: 'design-method-knowledge-context/v0';
    manifestSkillId: string;
    selectedCapabilityIds: string[];
    sourceRefs: Array<{
        capabilityId: string;
        sourceRevision: string;
        snapshotFingerprint: string;
    }>;
    content: string;
    issues: string[];
    boundaries: {
        advisoryOnly: true;
        versionBound: true;
        lifecycleFiltered: true;
        grantsPermission: false;
        executesTools: false;
        advancesStage: false;
        declaresQualityPass: false;
    };
}

export interface DesignMethodKnowledgeRuntimeContext extends DesignMethodKnowledgeContext {
    items: RuntimeContextItem[];
}

const COMMON_CONTENT_STRATEGY: DesignMethodKnowledgeDefinition = {
    capabilityId: DESIGN_CONTENT_STRATEGY_KNOWLEDGE_ID,
    title: '内容策略',
    applicableSkillIds: [],
    applicableStages: ['R3'],
    sourceRevision: 'design-method-content-strategy-v2',
    objective: '把用户目标、设计对象、用途、受众、素材角色和可靠证据转成可验证的设计机会与信息优先级。',
    method: [
        '区分已确认事实、用户主张与待验证假设，不用营销措辞替代真实来源。',
        '候选短名单只回答“在一个已声明需求或视觉角色下，哪些素材相对更合适”；它不等于对象理解，最高分也不能证明对象用途、目标受众、完整变体或项目中的全部素材角色。',
        '按当前任务需要建立对象模型：对象是什么及包含哪些部件或变体、如何被使用或观看、谁会在意什么、哪些观察支持这些判断、还有哪些未知会改变设计方向。这些是可组合的判断维度，不是开工表单。',
        '区分素材承担的角色，例如身份与外形、使用与动作、功能与细节证据、变体与体系、场景与情绪、背景与装饰、既有设计参考；某个角色没有进入短名单，不代表项目里不存在。',
        '把设计机会表达为“可观察证据 → 对受众或使用情境的意义 → 可采用的内容或视觉关系”；证据不足时保留为假设，不把品类常识冒充当前对象事实。',
        '下一次观察由信息增益决定：优先补足会改变概念、选材或表达的未知，证据已经足以支持一个连贯方向时即可继续，不按固定清单逐项扫描。',
        '为当前交付建立首要沟通目标，再组织主信息、支持信息和行动信息。',
        '按受众决策顺序安排信息，删除与目标无关或重复的内容。',
        '为每项关键文案保留来源、适用场景与不可夸大的边界。'
    ],
    expectedOutput: '可用判断包括对象与用途、受众问题、素材角色覆盖、可验证设计机会、关键未知、信息层级和来源引用；无需按固定格式公开。',
    evaluationFocus: ['对象理解有证据', '素材角色覆盖与缺口清楚', '设计机会可追溯', '信息优先级清晰', '目标与受众一致', '无来源不明的夸张']
};

const COMMON_ART_DIRECTION: DesignMethodKnowledgeDefinition = {
    capabilityId: DESIGN_ART_DIRECTION_KNOWLEDGE_ID,
    title: '视觉方向',
    applicableSkillIds: [],
    applicableStages: ['R3'],
    sourceRevision: 'design-method-art-direction-v4',
    objective: '把已理解的对象、用途、内容机会与媒介语境翻译为可执行的视觉语言。',
    method: [
        '从对象真实特征、使用情境和品牌约束提炼视觉关键词，不直接复制参考图表面风格。',
        '是否检索 Eagle 或其他参考资源由 Agent 按信息增益判断，不是固定动作：当对象、品类或媒介陌生，缺少可靠视觉基准，或当前方向只能停留在泛化风格词时，应主动查找能回答具体未知的参考；已有充分证据时可以不查。',
        '参考查询应绑定尚未解决的构图、色彩、字体、叙事或摄影角色问题，并结合已经观察到的对象与用途特征；元数据候选不等于看懂参考，只有真实观察后才能引用其视觉关系。',
        '参考只用于比较关系、机制和取舍，不照抄成品；一旦相关差异已经足以支撑当前方向即可停止，Eagle 离线或没有合适结果不阻断普通设计。候选顺序、历史评分和单一案例结论不能作为当前任务的设计事实。',
        '结构正确、干净、可编辑只是制作底线，不等于视觉方向已经成熟。面向正式使用的成品若只有“安全素材 + 常规标题 + 留白”而缺少与目标相关的识别度、张力、情绪或说服机制，应把它视为尚未解决的设计问题。',
        '优先质量时不要因为首稿可执行就停止：如果当前方向仍能无差别替换商品、重复近期安全版式，或主要依据只是候选第一项，应把差异化与选择依据视为未解决；由 Agent 自行选择相关参考、替代素材、缩略图比较或独立视觉批评中的一种或多种证据来挑战当前方案，再决定保留、局部修订或换方向。这是完成标准，不是固定工具顺序，也不强制使用某一个参考来源。',
        '明确色彩、光影、材质、构图、字体气质和图像处理原则。',
        '说明视觉选择如何服务信息目标，并列出需要避免的误导或风格冲突。',
        '优先建立可跨画面复用的规则，而不是给单个画面堆叠效果。'
    ],
    expectedOutput: '视觉关键词、色彩与光影方向、材质与字体原则、参考研究判断及其可迁移依据。',
    evaluationFocus: ['对象与语境一致', '视觉规则可执行', '不止于安全排版', '参考或批评具有信息增益', '参考经过真实观察且未被照抄']
};

const COMMON_LAYOUT_PLANNING: DesignMethodKnowledgeDefinition = {
    capabilityId: DESIGN_LAYOUT_PLANNING_KNOWLEDGE_ID,
    title: '布局规划',
    applicableSkillIds: [],
    applicableStages: ['R4'],
    sourceRevision: 'design-method-layout-planning-v1',
    objective: '把信息与视觉策略转成有层级、阅读路径和可验证目标的布局计划。',
    method: [
        '先定义画布、安全区、主要阅读路径和视觉焦点，再安排元素。',
        '用角色、比例、对齐、间距和区域关系描述布局，不依赖模型猜测绝对坐标。',
        '为文字、产品、装饰和背景定义层级与遮挡关系，保留必要留白。',
        '把每个写入动作绑定到目标对象与写后读回检查。'
    ],
    expectedOutput: '区域结构、元素角色、比例与对齐、层级顺序、动作依赖和验证要求。',
    evaluationFocus: ['阅读路径明确', '信息层级稳定', '留白与对齐一致', '动作可验证']
};

const MAIN_IMAGE_OVERLAY: DesignMethodKnowledgeDefinition = {
    capabilityId: MAIN_IMAGE_METHOD_KNOWLEDGE_ID,
    title: '主图方法 overlay',
    applicableSkillIds: ['ecommerce.main_image'],
    applicableStages: ['R3', 'R4'],
    sourceRevision: 'design-method-main-image-v5',
    objective: '在首屏注意力有限的条件下，建立产品主体、核心卖点与渠道约束的单画面决策。',
    method: [
        '先区分点击图与转化图：点击图负责在列表缩略图中让商品、穿着结果或风格钩子被一眼识别，可以由一张成立的摄影主视觉独立完成；转化图负责回答“为什么值得买”，只围绕一个主卖点组织证明画面和必要辅助信息。场景、平铺、细节和变体只是可比较的素材角色，不预设谁必须做主视觉或辅助位。',
        '优先保护产品形态、纹理、颜色和比例真实性；先判断现有摄影能否直接承担主视觉，再决定使用全出血、容器裁切或去底重组，不把所有素材强制做成同一种合成方式。',
        '主体姿态、鞋袜或使用关系形成的斜线与纵向动势可以承担注意力；文案应进入真实负空间，不能压住关键识别部位，也不能用描边和投影硬救错误落位。',
        '只保留支撑首要沟通目标的卖点，避免品牌、促销、材质、功能、颜色和规格同时争夺第一层级；平台活动条应作为可拆卸临时层，不沉淀成长期品牌视觉。',
        '同时检查正常尺寸和平台缩略图：主体、首要信息和整体气质在缩小后仍可辨；无文字摄影方向与克制留白只要完成点击目标就应保留，不得为了“像电商图”补造文案。',
        '每个辅助图、角标、装饰或文字都必须在真实观看尺寸下增加产品识别、点击理由或可信证据；没有增加就应删除。发现问题时由 Agent 比较保留微调、删除、替换和换方向，选择副作用最小但能解决根因的方案，不在错误元素上连续叠加局部修补。',
        '同一套主图的字体、色彩、圆角和图像处理规则保持一致，但第 2–5 张转化图可按证明类型切换场景、材质微距、结构细节、对比或参数，不把五张图做成重复换图。',
        '变体之间保持品牌和构图规则一致，同时让真实的商品、颜色、主卖点或摄影方向差异可辨；先比较候选关系再选择，不把启发式排序第一名当作视觉定稿。',
        '如果当前方向与未被用户认可的历史尝试实质相似，或只想得出一个安全方向，先识别这种重复，再由 Agent 选择信息增益最高的一步：扩大素材比较、查看项目成稿或 Eagle 等参考、改变点击假设，或说明为什么有证据继续沿用。参考不是固定前置；但不能在没有比较和理由时把旧素材、旧版式或旧文案当作默认答案。'
    ],
    expectedOutput: '主视觉焦点、主体策略、卖点层级、缩略图可读性与变体一致性要求。',
    evaluationFocus: ['点击/转化目标匹配', '主体识别', '产品真实性', '核心卖点聚焦', '元素必要性', '文案与负空间关系', '缩略图可读性', '主图体系一致且不重复'],
    productionNature: 'creative'
};

const DETAIL_PAGE_OVERLAY: DesignMethodKnowledgeDefinition = {
    capabilityId: DETAIL_PAGE_METHOD_KNOWLEDGE_ID,
    title: '详情页方法 overlay',
    applicableSkillIds: ['ecommerce.detail_page'],
    applicableStages: ['R3', 'R4'],
    sourceRevision: 'design-method-detail-page-v2',
    objective: '把消费者决策问题组织成连续叙事，并让每屏承担明确且不重复的沟通职责。',
    method: [
        '按定位、兴趣、理解、信任和行动的消费者决策顺序组织信息，而不是套固定屏数；每屏先写清要回答的一个问题，再选择能回答它的素材与版式。',
        '每屏只设一个首要论点，并区分感受、机理和证明三层：场景或情绪让用户感知利益，材质/结构解释原因，参数、对比、细节或检测记录提供可核对支撑；没有来源的证明不得补造。',
        '首屏、场景、材质微距、结构细节、证据/参数和颜色款式应按当前产品需要交替出现，利用图片密度、留白和文字量的变化建立阅读节奏；连续多屏使用相同构图或重复同一卖点应视为叙事问题。',
        '产品事实、场景收益、细节说明和规格信息必须与真实视觉观察匹配；参考中的品牌、文案、模特和独特资产不可复制，只迁移构图、层级、色彩、证据类型和节奏关系。',
        '长页面共享少量稳定 token：版心、安全区、标题层级、正文行长、圆角/边线、色彩职责和图片处理；重点屏可以改变构图与密度，但不能像切换到另一套品牌。',
        '每屏写后查看实际画面，最终再以整页缩略总览检查首屏钩子、段落承接、重复、视觉断裂与收尾；占位文字、未替换素材、孤立屏和只完成局部画面都不能冒充完整长页。'
    ],
    expectedOutput: '叙事顺序、逐屏目标、支持信息类型、屏间承接和全局视觉一致性规则。',
    evaluationFocus: ['叙事连贯', '逐屏职责清晰', '感受/机理/证明关系', '内容与来源匹配', '跨屏视觉系统', '长页节奏与密度变化', '占位与重复清零'],
    productionNature: 'creative'
};

const SINGLE_CANVAS_VISUAL_OVERLAY: DesignMethodKnowledgeDefinition = {
    capabilityId: SINGLE_CANVAS_VISUAL_METHOD_KNOWLEDGE_ID,
    title: '单画布视觉设计方法 overlay',
    applicableSkillIds: ['design.single_canvas_visual'],
    applicableStages: ['R3', 'R4'],
    sourceRevision: 'design-method-single-canvas-visual-v1',
    objective: '在海报、活动 KV、社媒封面或 Banner 等单一画布中，用明确焦点、信息层级和视觉节奏让目标受众快速理解并记住首要信息。',
    method: [
        '先确认传播目标、受众、观看场景和必须出现的内容；没有来源的活动信息、价格、日期或品牌主张不得补造。',
        '根据 artifact_kind、内容与素材选择最合适的构图、字体、色彩和图像语言，不把某个固定模板当成默认答案。',
        '建立一个第一视觉焦点和清晰的阅读顺序，让标题、主体、支持信息与品牌信息形成有意的尺度差和空间关系。',
        '同时检查正常观看与缩略观看：正常尺寸保证文字可读，缩略尺寸仍能识别主题、焦点和主要情绪。',
        '装饰、质感和效果只用于强化主题；不得遮挡关键信息、破坏素材真实性或替代内容判断。',
        '每轮修改都保留需要守住的内容与视觉关系，并在同一 Photoshop 历史状态下重新观察后再裁决。'
    ],
    expectedOutput: '传播目标、内容层级、视觉方向、动态布局计划、必须保留项、写后复核与交付记录。',
    evaluationFocus: ['传播目标清晰', '信息层级与阅读顺序', '焦点和画面平衡', '文字可读性', '内容来源准确', '视觉完成度'],
    productionNature: 'creative'
};

const SKU_BATCH_OVERLAY: DesignMethodKnowledgeDefinition = {
    capabilityId: SKU_BATCH_METHOD_KNOWLEDGE_ID,
    title: 'SKU 批量图方法 overlay',
    applicableSkillIds: ['ecommerce.sku_batch'],
    applicableStages: ['R1', 'R3', 'R4'],
    sourceRevision: 'design-method-sku-batch-v3',
    objective: '在批量一致性与单个 SKU 真实性之间建立可重复、可检查的生产规则。',
    method: [
        '先读取当前项目和 Photoshop 文档，确认已有色卡源、模板与配置；文件名只用于定位，文档角色以真实结构观察和 Skill 角色回执为准。已完成且含有效颜色组的色卡必须登记为只读来源并复用，绝不能当成待改造模板。',
        '若项目和用户都没有给出 SKU 组合（颜色×规格/双装），在完成上述最小盘点后，用 SKU Provider 的同一张组合卡一次性收集或确认规格、组合与命名；不要用通用卡片询问如何处理色卡或模板，也不要为 SKU 反复声明创意 brief/strategy。',
        '先核对 SKU 组合、素材映射和命名依据，不用占位或推断补齐缺失变体。',
        '先检查真实模板结构：ordered_slots 使用一槽一色；region_composition 允许一个矩形区域容纳多色，并用显式容量计划连接区域与颜色顺序。',
        '多区域容量只能来自模板命名或几何检查；中低置信分配必须经视觉复核，执行阶段不得临场猜测。',
        '固定画布、主体尺度、对齐、留白和导出规则，只让真实差异发生变化。',
        '颜色、纹理和组合关系以源素材为准，调整不能破坏产品真实性。',
        '批量输出逐项保留身份、变体、导出和视觉复核记录。'
    ],
    expectedOutput: 'SKU 映射、TemplateLayoutPlan、区域容量或槽位规则、允许变化字段、逐项验证与导出清单。',
    evaluationFocus: ['模板方法识别正确', '区域容量来源明确', '批量一致性', 'SKU 映射正确', '颜色纹理真实', '逐项可追溯'],
    productionNature: 'structured'
};

const SKU_TEMPLATE_OVERLAY: DesignMethodKnowledgeDefinition = {
    capabilityId: SKU_TEMPLATE_METHOD_KNOWLEDGE_ID,
    title: 'SKU 组合模板方法 overlay',
    applicableSkillIds: ['ecommerce.sku_template'],
    applicableStages: ['R1', 'R3', 'R4'],
    sourceRevision: 'design-method-sku-template-v1',
    objective: '把已确认的商品来源和交易信息组织成可比较、可复用、跨规格一致且具有项目视觉语言的 SKU 模板系统。',
    method: [
        '先确认模板要帮助用户比较什么：件数、颜色、款式、尺寸、袜筒长度、自选/固定组合或随机发货。SKU 的第一目标是消除交易歧义，宣传语不能压过商品身份、色名和数量。',
        '根据真实素材选择一种主展示语法：场景卡保留穿着结果和环境光影，纯底/透明商品强调统一角度与轮廓；同一模板变体中不要无依据混用两套摄影、背景和阴影语言。',
        '先定义跨 2/3/4 件变体共用的安全区、卡片比例、商品光学尺度、标签位置、字体、色彩、圆角/边界、间距档位和备注区，再按数量重排；数量增加时优先减少次要文字，不把所有元素等比缩小。',
        '比较项必须在姿态、尺度、重心、光线、阴影和色彩基准上保持等权。三件装不能无业务依据把中间项做成主推；四件装在单排与 2×2 之间按真实展示尺寸的可辨性与留白平衡选择。',
        '白色、奶油色或浅色商品在白底上容易丢失轮廓，应通过有依据的浅灰/暖白背景、轻微接触阴影、边缘对比或局部色块分离；不得为了辨识擅自改变商品颜色。',
        '自选备注图必须同时看清可选颜色、色名、件数和选择/随机发货规则；支持场景或卖点图只能作为从属证据，不能让用户数不清商品。',
        '参考研究应比较多张同任务样本的共同关系与差异，不从单张参考复制品牌、文案、模特或具体坐标；已有项目模板与用户作品优先用于确定项目视觉语言。',
        '最终在缩略图下检查件数是否瞬间可数、同级商品是否可比、浅色轮廓是否可见、标签是否可读，再读回占位符、命名、卡片同级关系和可编辑结构。'
    ],
    expectedOutput: '交易信息优先级、展示语法、跨规格 token、2/3/4 件重排规则、浅色分离策略、可编辑占位结构与缩略图复核。',
    evaluationFocus: ['件数与选择无歧义', '商品真实性', '同级光学一致', '跨规格视觉系统', '浅色轮廓可辨', '标签与备注可读', '结构可编辑'],
};

const SKU_COLOR_CARD_OVERLAY: DesignMethodKnowledgeDefinition = {
    capabilityId: SKU_COLOR_CARD_METHOD_KNOWLEDGE_ID,
    title: 'SKU 色卡方法 overlay',
    applicableSkillIds: ['ecommerce.sku_color_card'],
    applicableStages: ['R3', 'R4'],
    sourceRevision: 'design-method-sku-color-card-v1',
    objective: '把已确认的颜色图片整理成可编辑、可复用、名称准确且结构一致的 SKU 色卡文档。',
    method: [
        '输入顺序就是颜色编排顺序；色名优先使用用户或项目确认值。缺少权威色名时可用文件名建立 provisional 可编辑草稿，但不得把时间戳或资产编号宣称为已确认颜色名，也不按颜色关键词重新排序。',
        '每个颜色建立独立同名图层组；卡片主体必须是可编辑智能对象，不能栅格化成不可追溯结果。',
        '商品图先以 contain 生成安全结构草稿并剪切到圆角底；固定 cover/contain 都不是最终设计，不能替代 Agent 的视觉判断。',
        '结构草稿后逐卡打开智能对象看图：模型判断主体大小、重心和裁切。主体检测可靠时由 fitLayerSubjectToRegion 求解缩放与位移；检测失败或超时时，模型依据画面用 transformLayer/moveLayer 小步调整。两条路径都必须在每次调整后再次看图。',
        '白色色名标签和文字位于智能对象内部；标签比例按真实内部文档尺寸换算，文字再依据 Photoshop 真实 bounds 缩放并水平、垂直居中。',
        '逐卡读回剪切关系与智能对象状态；最终读回主文档尺寸、图层结构和保存结果。'
    ],
    expectedOutput: '颜色来源映射、色卡布局计划、逐卡智能对象/剪切检查记录、最终 PSB 路径与结构验收报告。',
    evaluationFocus: ['颜色名称准确', '输入覆盖完整', '智能对象可编辑', '剪切结构正确', '主体视觉尺度与裁切', '文字适配与居中', '布局一致', '写后检查完整'],
    productionNature: 'structured'
};

const DEFINITIONS: readonly DesignMethodKnowledgeDefinition[] = Object.freeze([
    COMMON_CONTENT_STRATEGY,
    COMMON_ART_DIRECTION,
    COMMON_LAYOUT_PLANNING,
    MAIN_IMAGE_OVERLAY,
    DETAIL_PAGE_OVERLAY,
    SINGLE_CANVAS_VISUAL_OVERLAY,
    SKU_COLOR_CARD_OVERLAY,
    SKU_TEMPLATE_OVERLAY,
    SKU_BATCH_OVERLAY
]);

function clean(value: unknown): string {
    return String(value || '').trim();
}

function formatDefinition(definition: DesignMethodKnowledgeDefinition): string {
    return [
        `### ${definition.title} · ${definition.capabilityId} · revision=${definition.sourceRevision}`,
        `目标：${definition.objective}`,
        ...(definition.productionNature === 'structured'
            ? ['任务本质：结构化生产——以用户确认的规格/组合为准，尽快进入执行；不做长时间创意 brief/strategy 推演，缺规格时先用交互卡片收集再执行。']
            : definition.productionNature === 'creative'
                ? ['任务本质：开放式创意设计——需要真实的设计规划与视觉判断。']
                : []),
        '方法：',
        ...definition.method.map((item) => `- ${item}`),
        `输出：${definition.expectedOutput}`,
        `评价关注：${definition.evaluationFocus.join('；')}`
    ].join('\n');
}

export function listDesignMethodKnowledgeDefinitions(): DesignMethodKnowledgeDefinition[] {
    return DEFINITIONS.map((definition) => ({
        ...definition,
        applicableSkillIds: [...definition.applicableSkillIds],
        applicableStages: [...definition.applicableStages],
        method: [...definition.method],
        evaluationFocus: [...definition.evaluationFocus]
    }));
}

export function listDesignMethodKnowledgeProviderIdentities(): RuntimeCapabilityProviderIdentity[] {
    return DEFINITIONS.map((definition) => ({
        capabilityId: definition.capabilityId,
        kind: 'knowledge',
        providerId: `runtime:${definition.capabilityId}`,
        source: 'runtime_contract',
        exposure: 'runtime_context',
        exposedAsToolSchema: false,
        ...(definition.applicableSkillIds.length > 0
            ? { applicableSkillIds: [...definition.applicableSkillIds] }
            : {})
    }));
}

export function buildDesignMethodKnowledgeContext(input: {
    knowledgeRefs: readonly string[];
    manifestSkillId: string;
}): DesignMethodKnowledgeContext {
    const manifestSkillId = clean(input.manifestSkillId);
    const byId = new Map(DEFINITIONS.map((definition) => [definition.capabilityId, definition]));
    const selected: DesignMethodKnowledgeDefinition[] = [];
    const sourceRefs: DesignMethodKnowledgeContext['sourceRefs'] = [];
    const issues: string[] = [];
    const seen = new Set<string>();

    for (const rawReference of input.knowledgeRefs) {
        const reference = clean(rawReference);
        if (!reference || seen.has(reference)) continue;
        seen.add(reference);
        const definition = byId.get(reference);
        if (!definition) continue;
        if (definition.applicableSkillIds.length > 0
            && !definition.applicableSkillIds.includes(manifestSkillId)) {
            issues.push(`${reference}:skill_scope_mismatch`);
            continue;
        }
        const artifactRecord = buildBundledKnowledgeArtifactRecord({
            id: definition.capabilityId,
            title: definition.title,
            summary: formatDefinition(definition),
            sourceRevision: definition.sourceRevision
        });
        if (artifactRecord.usageSnapshot.counts.usable !== 1) {
            issues.push(`${reference}:knowledge_not_current_or_usable`);
            continue;
        }
        selected.push(definition);
        sourceRefs.push({
            capabilityId: definition.capabilityId,
            sourceRevision: artifactRecord.governance.sourceRevision,
            snapshotFingerprint: artifactRecord.usageSnapshot.snapshotFingerprint
        });
    }

    return {
        version: 'design-method-knowledge-context/v0',
        manifestSkillId,
        selectedCapabilityIds: selected.map((definition) => definition.capabilityId),
        sourceRefs,
        content: selected.length > 0
            ? [
                '以下内容是当前 Skill Manifest 激活的专业方法建议。它不授予工具权限，不替代当前用户目标、项目事实、执行 Policy 或 Evaluation。',
                ...selected.map(formatDefinition)
            ].join('\n\n')
            : '',
        issues,
        boundaries: {
            advisoryOnly: true,
            versionBound: true,
            lifecycleFiltered: true,
            grantsPermission: false,
            executesTools: false,
            advancesStage: false,
            declaresQualityPass: false
        }
    };
}

function toRuntimeContextItem(definition: DesignMethodKnowledgeDefinition): RuntimeContextItem {
    const safeCapabilityId = definition.capabilityId.replace(/[^A-Za-z0-9_.:-]/g, '_');
    return {
        id: `knowledge.method.${safeCapabilityId}`,
        kind: 'knowledge',
        source: `${definition.capabilityId}@${definition.sourceRevision}`,
        trust: 'governed_knowledge',
        slot: 'knowledge_context',
        content: formatDefinition(definition),
        applicableStages: [...definition.applicableStages],
        priority: definition.applicableSkillIds.length > 0 ? 92 : 88,
        freshness: 'current'
    };
}

/**
 * 把 Manifest 选择的方法论保留为独立、带 applicableStages 的 RuntimeContextItem。
 * 调用方必须交给现有 Runtime Context Compiler 按 RuntimeSession.currentStage 编译，
 * 不得再次把 items 预先拼成一段静态系统提示。
 */
export function buildDesignMethodKnowledgeRuntimeContext(input: {
    knowledgeRefs: readonly string[];
    manifestSkillId: string;
}): DesignMethodKnowledgeRuntimeContext {
    const context = buildDesignMethodKnowledgeContext(input);
    const selectedIds = new Set(context.selectedCapabilityIds);
    return {
        ...context,
        items: DEFINITIONS
            .filter((definition) => selectedIds.has(definition.capabilityId))
            .map(toRuntimeContextItem)
    };
}
