/**
 * 交付物设计知识注册表（知识层单一入口）
 *
 * 解决的问题：设计方法论此前是「一个品类一个文件 + 一套 focus 类型 + 一个 build 函数 +
 * 一个专属知识工具」。新增品类要动 5 处代码，于是品类扩不动——真机实测「做个海报」
 * 「做个小红书封面」「设计个 logo」全都取不到任何方法论，Agent 只能凭空设计
 * （167 次运行里检索过设计知识的仅 12 次）。
 *
 * 这里把品类从「代码分支」变成「注册表数据」：新增一个交付物 = 加一条数据，
 * 不新建文件、不改检索路径、不加工具。
 *
 * 边界（与既有知识模块一致）：
 *  - 知识只作为上下文与评审依据，不授权写入、不代表任务完成；
 *  - 不允许把本注册表内容硬编码回运行时分支——让模型理解方法论后自主决策，
 *    而不是用关键词触发固定流程；
 *  - provenance 必须如实标注：用户权威方法论与通用行业实践不可混为一谈。
 */

import {
    MAIN_IMAGE_FRAMEWORK_SECTIONS,
    type MainImageFrameworkFocus
} from './main-image-framework';
import {
    DETAIL_PAGE_FRAMEWORK_SECTIONS,
    type DetailPageFrameworkFocus
} from './detail-page-framework';
import {
    resolveDesignTaskProfileArtifactKnowledgeId,
    resolveDesignTaskProfileRequestedArtifactKnowledgeId
} from '../design-task-types';
import type { RuntimeStage } from '../agent-runtime-v5/contracts';
import type { RuntimeContextItem } from '../agent-runtime-v5/runtime-context-compiler';

export const DESIGN_ARTIFACT_KNOWLEDGE_VERSION = 'design-artifact-knowledge/v1' as const;

/**
 * 知识来源。用户方法论是权威、可直接作为验收依据；
 * 通用实践是行业共识起点，模型可据此推进，但用户另有要求时以用户为准。
 */
export type DesignKnowledgeProvenance = 'user_methodology' | 'general_practice';

export interface DesignKnowledgeSection {
    focus: string;
    title: string;
    content: string;
}

/**
 * 前提输入的来源。这个区分是整份知识里最重要的一条：
 *  - observable：环境里查得到（项目素材、当前文档、图层结构）——**自己去看，不要问用户**；
 *  - designer_decision：根据目标与已观察事实做出的专业取舍——**Agent 先提出有依据的选择，
 *    不要默认把设计责任丢回用户**；
 *  - user_decision：只有用户或已有业务记录拥有的事实（已确认 SKU 组合、活动承诺、下游命名规范）
 *    ——**推不出来就问，绝不能用默认值编一套**。
 *
 * 真机 2026-07-31：用户只说「帮我规划设计主图详情页SKU」，没给任何 SKU 组合规格，
 * Agent 既没看项目也没问，直接编出 5 组配色组合开始排版。产出看着像在干活，全是虚构。
 */
export type DesignInputSource = 'observable' | 'designer_decision' | 'user_decision';

export type DesignTaskMode =
    | 'persuasive'
    | 'comparative'
    | 'explanatory'
    | 'expressive'
    | 'production'
    | 'general';

export interface DesignRequiredInput {
    key: string;
    label: string;
    source: DesignInputSource;
    /** 缺了它会导致什么——让模型自己判断该先查还是该先问，而不是被规则推着走。 */
    why: string;
}

export interface DesignArtifactKnowledge {
    artifactId: string;
    displayName: string;
    /** 用户可能的说法。仅用于知识检索匹配，不参与路由与执行授权判定。 */
    aliases: string[];
    /** 一句话说明这个交付物要解决什么问题，供模型快速判断是否相关。 */
    purpose: string;
    /** 评价重点；只影响知识解释，不选择 Skill、Tool、权限或 Runtime stage。 */
    taskMode: DesignTaskMode;
    provenance: DesignKnowledgeProvenance;
    /** 动手之前需要先弄清楚的事。知识层只陈述事实，不做门禁、不阻断执行。 */
    requiredInputs: DesignRequiredInput[];
    sections: DesignKnowledgeSection[];
}

function toSections(record: Record<string, { title: string; content: string }>): DesignKnowledgeSection[] {
    return Object.keys(record).map((focus) => ({
        focus,
        title: record[focus].title,
        content: record[focus].content
    }));
}

/** 海报：以传播目标为中心，结构随媒介、内容与品牌语境变化。 */
const POSTER_SECTIONS: DesignKnowledgeSection[] = [
    {
        focus: 'overview',
        title: '海报总定义与取舍',
        content: [
            '海报要围绕明确的传播目标组织注意力，但不等于固定的“一个主视觉 + 一句话 + 一个行动理由”配方；品牌发布、文化活动、信息公告与促销海报可以有不同信息密度和焦点结构。',
            '先从受众、观看距离、媒介尺寸、停留时间与期望反应推导信息优先级；用户没有写全时先提出可解释假设，只有关键商业目标仍不确定且会改变交付物时再确认。',
            '海报通常比详情页更强调首屏识别，但“删到只剩一件事”只是短停留传播的常见策略，不适用于需要并列嘉宾、日程、系列信息或叙事层次的海报。'
        ].join('\n')
    },
    {
        focus: 'composition',
        title: '主视觉与视线动线',
        content: [
            '先确定注意力结构：短时传播常见单一主焦点；系列、对谈、双主角或比较主题可以使用多个有明确关系的同级锚点。判断标准是观众能否按目标顺序理解，而不是焦点数量。',
            '主体尺度应从真实展示尺寸、识别距离、素材完整性、文案密度与项目参考测量推导；40%–70% 只能作为少数强主体海报的探索区间，不能成为通过条件。',
            '对角线、三分、中心对称、模块网格、满版与留白型构图都是候选。先说明为何适合当前内容，再选择和贯彻关键关系；混合结构只要关系清楚也可以成立。',
            '留白和高密度都可以是有意选择。检查分组、节奏、边缘压力与阅读连续性，而不是把“更空”自动等同于更高级。'
        ].join('\n')
    },
    {
        focus: 'typography',
        title: '文案层级与字量',
        content: [
            '文字层级数量由真实信息结构决定：短促海报可能只有标题与署名，活动信息海报可以有更多分组。重点是同级一致、从属清楚和阅读顺序可扫读，不是固定三级。',
            '标题字数与断行要在真实版位中测试；短标题常更有力，但名称、主题或合规内容不能为了命中 8–12 字而改写事实或硬断词。',
            '字号、字重、字距和位置共同决定气质与层级。跳跃大小应匹配品牌、观看距离和内容关系，不把“跳得大=促销、跳得小=高端”当成固定结论。',
            '辅助和合规信息可以退后，但在最终展示尺寸下仍须清晰可辨。'
        ].join('\n')
    },
    {
        focus: 'review',
        title: '海报自检',
        content: [
            '眯眼测试：模糊状态下还能看出主体和主标题，说明层级成立。',
            '三秒测试：三秒内能否说出「这是什么、给我什么好处」。',
            '删减测试：任意删掉一个元素，若画面信息没有损失，那个元素本就不该在。',
            '硬性检查：主体不出血裁切到关键部位、文字不压在杂乱背景上、四周留白均衡、色彩不脏不溢。'
        ].join('\n')
    }
];

/** 横幅/banner：扁画幅与裁切适配通常比固定内容配方更关键。 */
const BANNER_SECTIONS: DesignKnowledgeSection[] = [
    {
        focus: 'overview',
        title: '横幅总定义与约束',
        content: [
            '横幅通常处于短停留、扁画幅和多端裁切环境，但站内头图、品牌横幅、活动轮播与信息公告的任务不同，不能统一成一个内容公式。',
            '产品、场景、利益点、品牌与入口暗示都是候选组件；根据本版位承担的识别、引导或说明任务选取，不要求三者同时出现。',
            '扁画幅限制纵向展开，但可以通过横向序列、模块节奏或连续轮播承载多段信息；单张横幅仍应保证关键信息在一次扫视内可定位。'
        ].join('\n')
    },
    {
        focus: 'composition',
        title: '扁画幅的版式处理',
        content: [
            '主体/文案左右分区是常见起点，不是默认答案；居中、满版、模块化或连续图形结构只要适合素材与裁切规则都可以成立。',
            '从版位安全区、主体朝向、文字长度和裁切变体推导重心与边距，不机械平分画布。',
            '要考虑不同终端的裁切：关键信息集中在中部安全区，边缘只放可被裁掉的装饰。'
        ].join('\n')
    },
    {
        focus: 'review',
        title: '横幅自检',
        content: [
            '缩小到实际展示尺寸再看一遍：主标题是否仍然可读，这是横幅最常见的失败点。',
            '一句话测试：能否用一句话说出它在卖什么、优惠是什么。',
            '硬性检查：文字与背景对比度足够、主体未被文案遮挡、安全区内无关键信息被裁。'
        ].join('\n')
    }
];

/** 社媒封面：平台、账号语气与内容类型共同决定结构。 */
const SOCIAL_COVER_SECTIONS: DesignKnowledgeSection[] = [
    {
        focus: 'overview',
        title: '社媒封面总定义',
        content: [
            '社媒封面需要在平台的真实信息流尺寸中建立识别，但教程、测评、品牌叙事、人物内容与纯视觉作品的停留理由不同，不统一成“强钩子 + 人群词”配方。',
            '可信画面、具体命题、人物情绪、品牌识别或系列一致性都可以成为入口；根据账号定位与内容承诺选择，不能用夸张钩子掩盖正文。',
            '3:4、1:1、9:16 或横版由平台和发布位决定。标题位置应避开平台遮挡并服从素材重心，上三分之一只是部分竖版封面的常见选择。'
        ].join('\n')
    },
    {
        focus: 'typography',
        title: '大字报式文案',
        content: [
            '有标题的封面要在缩略图尺寸保持核心文字可读；纯视觉、人物或系列封面也可以少字甚至无字，前提是符合内容与账号系统。',
            '数字、身份词和场景词在证据真实且与内容相关时可以增强具体性；不能为了点击编造身份、结果或测试周期。',
            '底衬、描边、留白区、明暗控制和调整素材位置都是保证可读性的候选手段，按画面选择，不要求所有文字都加效果。'
        ].join('\n')
    },
    {
        focus: 'review',
        title: '社媒封面自检',
        content: [
            '缩略图测试：缩到信息流实际尺寸，标题是否仍可读、画面是否仍可辨。',
            '人群测试：能否一眼看出这是给谁看的。',
            '真实感检查：过度修饰会削弱可信度，社媒场景下「真实」常比「精致」更有效。'
        ].join('\n')
    }
];

/** 通用设计交付物：没有专属方法论时的可迁移底座。 */
const GENERIC_SECTIONS: DesignKnowledgeSection[] = [
    {
        focus: 'overview',
        title: '通用交付物设计流程',
        content: [
            '没有专用品类知识时仍按设计主线推进：从当前请求和可用上下文框定交付目的 → 观察与任务相关的事实 → 提出有依据、可逆的视觉方向 → 制作 → 在真实使用尺寸下复核。',
            '目标、受众或场景没有被完整写出时，设计师应先从用户措辞、项目语境和媒介常识提出最小假设并继续可逆工作；只有不同答案会实质改变交付物，且答案属于用户业务决策时才询问。',
            '没有现成素材、PSD 或当前文档不等于不能设计：可以建立新的、获授权的视觉结构，但不得虚构产品事实、品牌资产或用户承诺。没有专属方法论时，按最接近的交付目的类比推导，并把推导当作可复核选择而非既定规范。'
        ].join('\n')
    },
    {
        focus: 'review',
        title: '通用自检',
        content: [
            '层级：眯眼看能否一眼抓到主体与核心信息。',
            '呼吸：留白是否为主体服务，画面是否拥挤。',
            '一致：色彩、字体、圆角、间距是否成体系，而不是逐个元素随机决定。',
            '事实：文案所述卖点是否有素材或参数支撑，不得凭空夸大。',
            '交付：尺寸、出血、命名与导出格式是否符合投放要求。'
        ].join('\n')
    }
];

const PRODUCT_ASSET_INPUT: DesignRequiredInput = {
    key: 'product_assets',
    label: '产品图与可用素材',
    source: 'observable',
    why: '没有真实素材就只能凭空编画面。先看项目里到底有什么，数量太少要先说清楚，而不是硬做。'
};

const CURRENT_DOCUMENT_INPUT: DesignRequiredInput = {
    key: 'current_document',
    label: '当前文档与图层结构',
    source: 'observable',
    why: '决定是套版、改稿还是新建。不看就动手容易改错文件或在存量画布旁另建空文档。'
};

const PROJECT_DESIGN_SOURCE_INPUT: DesignRequiredInput = {
    key: 'project_design_sources',
    label: '项目里已有的 PSD/PSB 设计源',
    source: 'observable',
    why: '这是了解这个产品和既有设计最可靠的信息源——里面有真实的颜色、图层命名、版式和字号档位。'
        + '只看文件名等于没看：搜到路径后用 analyzePsdDesignSource 打开看里面有什么，'
        + '比问用户或凭空推断都准。看完把要点写回项目状态，下次不必从零再来。'
};

const AUDIENCE_INPUT: DesignRequiredInput = {
    key: 'audience_and_positioning',
    label: '目标人群与产品定位',
    source: 'designer_decision',
    why: '先综合用户要求、产品事实、项目成品与渠道推导目标人群并明确假设；只有受众属于用户尚未表达的关键商业选择、且不同答案会实质改变交付物时才询问。'
};

const REGISTRY: DesignArtifactKnowledge[] = [
    {
        artifactId: 'main-image',
        displayName: '主图',
        aliases: ['主图', '电商主图', '点击图', '转化图', 'main image', 'hero image'],
        purpose: '在搜索与推荐场景赢得点击，并说服用户产品值得买。',
        taskMode: 'persuasive',
        provenance: 'user_methodology',
        requiredInputs: [
            PRODUCT_ASSET_INPUT,
            PROJECT_DESIGN_SOURCE_INPUT,
            CURRENT_DOCUMENT_INPUT,
            AUDIENCE_INPUT,
            {
                key: 'hero_selling_point',
                label: '本次主推的核心卖点',
                source: 'designer_decision',
                why: '设计师应先从可靠产品事实、项目内容与渠道目标中提出主推建议并说明依据；只有它属于未表达的关键商业优先级且不同答案会改变投放策略时才询问。'
            },
            {
                key: 'output_spec',
                label: '尺寸与输出规格',
                source: 'designer_decision',
                why: '用户已指定时必须服从；否则先从当前文档、渠道与项目惯例推导，采用可说明的规格。只有多个规格都会成立且会产生不同交付物时再确认。'
            }
        ],
        sections: toSections(MAIN_IMAGE_FRAMEWORK_SECTIONS as Record<MainImageFrameworkFocus, { title: string; content: string }>)
    },
    {
        artifactId: 'detail-page',
        displayName: '详情页',
        aliases: ['详情页', '商品详情长图', '详情长图', '长详情', 'detail page'],
        purpose: '用有逻辑的分屏叙事完成从留住第一眼到下单的说服。',
        taskMode: 'explanatory',
        provenance: 'user_methodology',
        requiredInputs: [
            PRODUCT_ASSET_INPUT,
            PROJECT_DESIGN_SOURCE_INPUT,
            CURRENT_DOCUMENT_INPUT,
            AUDIENCE_INPUT,
            {
                key: 'product_facts',
                label: '产品硬性参数与事实',
                source: 'observable',
                why: '材质、尺码、成分这些是可信度地基，能从项目资料或文档读到就不要编。'
            },
            {
                key: 'existing_source_context',
                label: '现有模板、设计源与当前文档是否适用于本次目标',
                source: 'observable',
                why: '先观察项目和当前文档中的模板、设计源与保留关系，再决定复用、改造或建立新结构；这是目标与保护上下文，不是独立任务类型。'
            }
        ],
        sections: toSections(DETAIL_PAGE_FRAMEWORK_SECTIONS as Record<DetailPageFrameworkFocus, { title: string; content: string }>)
    },
    {
        artifactId: 'sku-template',
        displayName: 'SKU 组合模板',
        aliases: ['sku模板', 'sku 模板', 'sku template', 'sku组合模板', 'sku 组合模板', 'sku 2双装模板', 'sku 3双装模板', 'sku 4双装模板', 'sku自选备注模板'],
        purpose: '建立可复用的 SKU 组合展示系统，让 2/3/4 双和自选备注在同一视觉语法中清楚、可比、可编辑。',
        taskMode: 'comparative',
        provenance: 'general_practice',
        requiredInputs: [
            PROJECT_DESIGN_SOURCE_INPUT,
            CURRENT_DOCUMENT_INPUT,
            {
                key: 'sku_card_sources',
                label: '真实色卡、产品智能对象与现有组件结构',
                source: 'observable',
                why: '先检查实际 PSD/PSB、图层组、智能对象链接方式、原始比例和颜色命名；这决定哪些视觉身份与可编辑关系必须保留。'
            },
            {
                key: 'template_variants',
                label: '本次需要覆盖的组合变体',
                source: 'designer_decision',
                why: '用户已明确 2/3/4 双或自选备注时直接沿用；未明确时根据任务目标提出最小可复用变体集，只有变体数量会实质改变交付范围时再确认。'
            },
            {
                key: 'template_delivery_spec',
                label: '画布、备注区与可编辑交付要求',
                source: 'designer_decision',
                why: '先从当前文档和项目惯例推导画布、安全区、备注槽位、图层命名与派生方式；不得在有现成源文档时凭空另建不相干模板。'
            }
        ],
        sections: [
            {
                focus: 'overview',
                title: 'SKU 组合模板的设计任务',
                content: [
                    'SKU 组合模板是比较型、系统型设计，不是“把几张色卡摆上去”，也不是 SKU 批量导出。它需要建立可复用的组件、间距、编号、备注和变体规则。',
                    '所有色卡是同级候选项，设计重点是组合数量一眼可数、颜色与编号一一对应、跨模板保持一致，而不是强造一个唯一视觉主角。',
                    '参考图和知识库用于扩大方案依据，但不可用时不能让任务永久停在检索；应以模型设计知识、项目事实和真实写后观察继续推进，并如实标记缺失的外部参考。'
                ].join('\n')
            },
            {
                focus: 'system',
                title: '组件系统与变体关系',
                content: [
                    '先定义共同 token：画布安全区、卡片比例、主体尺度、横纵间距、编号样式、标签位置、备注区和图层命名，再派生 2/3/4 双变体。',
                    '2 双装通常强调一对同权关系；3 双装要避免中间项被误读为主推，除非业务确实要求；4 双装可在单排与 2×2 间依据缩略图识别和画布比例选择。它们是候选结构，不是固定坐标。',
                    '变体之间应保留相同卡片尺寸体系和视觉语言；当数量变化时调整网格与留白，不要每张重新发明一套样式。'
                ].join('\n')
            },
            {
                focus: 'photoshop',
                title: 'Photoshop 可编辑结构',
                content: [
                    '先确认嵌入式与链接智能对象的共享关系：复制实例、缩放外层组与编辑智能对象内容的影响范围不同，不能边猜边改。',
                    '每个变体使用稳定图层组；卡片、编号、标签、备注槽位和导出辅助层分组命名。主体替换应通过智能对象或明确占位槽位完成。',
                    '优先保存副本或独立模板文档，避免覆盖色卡源文件；写入后读回图层结构和画面，确认智能对象仍可替换、隐藏层没有误入最终输出。'
                ].join('\n')
            },
            {
                focus: 'review',
                title: 'SKU 模板复核',
                content: [
                    '比较性：每个同级卡片在缩略图下都可识别，视觉重量一致，数量关系不会误读。',
                    '系统性：变体间卡片、间距、编号、标签与备注规则一致；没有临时坐标造成的漂移。',
                    '真实性：颜色、主体比例和编号来自真实源，不用近似色或占位内容冒充。',
                    '可编辑性：图层组、智能对象、命名和槽位支持后续替换；保存读回后结构仍完整。'
                ].join('\n')
            }
        ]
    },
    {
        artifactId: 'sku-color-card',
        displayName: 'SKU 色卡',
        aliases: ['sku色卡', 'sku 色卡', 'sku颜色卡', 'sku 颜色卡', 'sku色卡源文档', 'sku 色卡源文档'],
        purpose: '为每个真实颜色建立准确、可编辑、来源可追溯且尺度一致的视觉单元。',
        taskMode: 'comparative',
        provenance: 'general_practice',
        requiredInputs: [
            PRODUCT_ASSET_INPUT,
            CURRENT_DOCUMENT_INPUT,
            {
                key: 'color_truth',
                label: '颜色名称、顺序与真实来源',
                source: 'observable',
                why: '优先从用户给定名称、项目配置、已确认表格或既有图层读取。只有带明确业务语义且映射唯一的文件名才可作为最终名称证据；时间戳、流水号、相机文件名与视觉猜测只能生成 provisional 标签，不得冒充颜色真值。'
            },
            {
                key: 'card_usage',
                label: '色卡将用于模板、上架选择还是内部资产',
                source: 'designer_decision',
                why: '先从用户任务和项目结构判断用途；用途决定裁切、标签和画布系统，仍不明确且会改变交付结构时再确认。'
            }
        ],
        sections: [
            {
                focus: 'overview',
                title: 'SKU 色卡的设计任务',
                content: [
                    '色卡是可靠素材单元，不是组合模板也不是批量套版。它首先保证每一种真实颜色可识别、可追溯、可替换。',
                    '同批色卡保持主体尺度、裁切、背景、标签和顺序一致；不要为了“丰富画面”给不同颜色添加不同风格。'
                ].join('\n')
            },
            {
                focus: 'review',
                title: 'SKU 色卡复核',
                content: [
                    '核对颜色名、顺序与文件来源；核对主体没有拉伸、关键部位没有被裁掉、同批尺度一致。',
                    '核对标签在目标尺寸下可读、智能对象或源图层仍可编辑、保存后没有丢失颜色资产。'
                ].join('\n')
            }
        ]
    },
    {
        artifactId: 'sku-batch',
        displayName: 'SKU 批量生产',
        aliases: ['sku批量', 'sku 批量', '批量sku', 'sku批量出图', 'sku 批量出图', 'sku组合出图', 'sku 组合出图', 'sku batch'],
        purpose: '消费已确认的组合、模板与真实色卡，准确生成、命名、保存、导出并核对全部交付物。',
        taskMode: 'production',
        provenance: 'general_practice',
        requiredInputs: [
            {
                key: 'combination_spec',
                label: '已确认的组合规格',
                source: 'user_decision',
                why: '做哪些组合属于业务事实。若项目 CSV、确认记录或用户消息已有明确规格就直接使用；没有任何权威来源时不得编造。'
            },
            {
                key: 'approved_template_and_cards',
                label: '可用模板与真实色卡',
                source: 'observable',
                why: '先读取项目和当前文档，确认模板槽位、颜色资产和智能对象映射；缺模板时不能拿临时占位稿冒充正式生产。'
            },
            {
                key: 'notes_needed',
                label: '是否包含自选备注交付物',
                source: 'user_decision',
                why: '它会改变交付物数量；从既有规格可确认时不重复询问，否则需要用户决定。'
            },
            {
                key: 'output_naming',
                label: '导出命名与目录规范',
                source: 'user_decision',
                why: '先沿用项目已有规范；没有规范且文件将进入上架流程时再确认，不能静默发明命名。'
            }
        ],
        sections: [
            {
                focus: 'overview',
                title: 'SKU 批量生产的任务边界',
                content: [
                    '批量生产不是原创模板设计。输入应是已确认组合、可用模板和真实色卡；输出重点是映射准确、数量完整、命名可核对。',
                    '如果模板本身还未设计完成，应把它识别为上游缺口并先完成模板设计，不能在批量循环里临时拼一个不可维护版式。'
                ].join('\n')
            },
            {
                focus: 'review',
                title: 'SKU 批量交付复核',
                content: [
                    '数量核对：确认组合数、每组项数、备注交付物、漏项与重复项。',
                    '映射核对：每个颜色和编号来自正确源资产，模板槽位没有错位或串色。',
                    '交付核对：文件名、目录、尺寸、格式、保存结果和导出列表与约定一致；不得残留占位符或辅助层。'
                ].join('\n')
            }
        ]
    },
    {
        artifactId: 'sku',
        displayName: 'SKU 统一生产',
        aliases: ['sku'],
        purpose: 'SKU 由一个统一 Skill 承接；Agent 根据用户目标与项目现状选择色卡、模板/占位符、配置或完整生产方法，并在完整生产中自动补齐缺件。',
        taskMode: 'general',
        provenance: 'general_practice',
        requiredInputs: [
            CURRENT_DOCUMENT_INPUT,
            {
                key: 'sku_stage',
                label: 'SKU 当前阶段',
                source: 'designer_decision',
                why: '先根据用户动作、当前 PSD/PSB 与项目文件选择内部方法。完整生产请求不得因为缺色卡或模板而降级成子阶段；只有证据仍不足且会改变最终交付物时才询问。'
            }
        ],
        sections: [
            {
                focus: 'overview',
                title: '一个 SKU Skill，四种内部方法',
                content: [
                    'stage=color-card：建立真实、统一、可编辑、来源可追溯的颜色单元。',
                    'stage=template：建立 2/3/4 双与自选备注等可复用组件和版式系统，包含可解析占位结构。',
                    'stage=config：只执行明确的颜色配置导出或占位符配置动作。',
                    'stage=full：消费已确认组合并完成色卡/模板缺件修复、映射、命名、保存、导出和复核。',
                    '这些是一个 SKU Skill 的不同方法，不是需要用户或 Agent 再次选择的多个 Skill。用户要完整成品时始终保持 full。'
                ].join('\n')
            }
        ]
    },
    {
        artifactId: 'poster',
        displayName: '海报',
        aliases: ['海报', '宣传海报', '活动海报', 'poster', '活动主视觉', '品牌主视觉', 'kv海报'],
        purpose: '用一个主视觉和一句话说清一件事并促成行动。',
        taskMode: 'expressive',
        provenance: 'general_practice',
        requiredInputs: [
            PRODUCT_ASSET_INPUT,
            {
                key: 'single_message',
                label: '这张图只说的那一件事',
                source: 'designer_decision',
                why: '设计师应根据用户目标、可靠内容与投放场景提出单一命题；只有多个商业主张都成立且会改变活动策略时再确认。'
            },
            {
                key: 'placement_context',
                label: '投放场景与尺寸',
                source: 'user_decision',
                why: '手机信息流、店铺首页和线下物料的构图与字号完全不同。'
            }
        ],
        sections: POSTER_SECTIONS
    },
    {
        artifactId: 'banner',
        displayName: '横幅',
        aliases: ['banner', '横幅', '店铺头图', '活动横幅', '轮播图'],
        purpose: '在极短停留时间内传达单一利益点并引导进入。',
        taskMode: 'persuasive',
        provenance: 'general_practice',
        requiredInputs: [
            PRODUCT_ASSET_INPUT,
            {
                key: 'single_benefit',
                label: '唯一要传达的利益点',
                source: 'designer_decision',
                why: '先从活动目标、产品事实与项目内容提出唯一利益点；只有它属于尚未表达的商业优先级且会改变投放策略时再确认。'
            },
            {
                key: 'banner_size',
                label: '版位尺寸',
                source: 'user_decision',
                why: '扁画幅比例直接决定版式与安全区，尺寸不明就无法排版。'
            }
        ],
        sections: BANNER_SECTIONS
    },
    {
        artifactId: 'social-cover',
        displayName: '社媒封面',
        aliases: ['小红书封面', '小红书', '种草封面', '种草图', '朋友圈配图', '社媒封面', '信息流封面'],
        purpose: '在信息流里用强钩子和人群指向换取一次停顿。',
        taskMode: 'expressive',
        provenance: 'general_practice',
        requiredInputs: [
            PRODUCT_ASSET_INPUT,
            {
                key: 'hook_and_audience',
                label: '钩子与目标人群',
                source: 'designer_decision',
                why: '设计师应综合用户目标、产品事实、账号风格与平台语境提出钩子和受众假设；关键商业定位仍不明确且会改变内容方向时再确认。'
            }
        ],
        sections: SOCIAL_COVER_SECTIONS
    },
    {
        artifactId: 'generic',
        displayName: '通用设计交付物',
        aliases: [],
        purpose: '没有专属方法论时的可迁移设计底座。',
        taskMode: 'general',
        provenance: 'general_practice',
        requiredInputs: [
            {
                key: 'relevant_available_context',
                label: '与本任务相关的现有素材、文档与项目事实',
                source: 'observable',
                why: '先检查与本任务相关的可用内容并记录“存在或不存在”；没有现成资产时仍可建立新结构，不能把资产缺失自动升级为阻塞。'
            },
            {
                key: 'goal_and_audience',
                label: '交付目标、受众与使用场景假设',
                source: 'designer_decision',
                why: '先从用户请求、现有上下文和媒介常识提出最小可解释假设；只有关键商业定位仍无权威答案且会改变交付物时再询问。'
            },
            {
                key: 'delivery_spec',
                label: '交付规格',
                source: 'designer_decision',
                why: '用户已指定时服从；否则根据媒介、当前文档和项目惯例提出可说明的规格。只有多个规格都会成立并产生不同交付物时再确认。'
            }
        ],
        sections: GENERIC_SECTIONS
    }
];

export function listDesignArtifactKnowledge(): readonly DesignArtifactKnowledge[] {
    return REGISTRY;
}

export function listDesignArtifactIds(): string[] {
    return REGISTRY.map((item) => item.artifactId);
}

/** 只归一知识注册表自身的 id 拼写；Task/Manifest/文档角色映射由 Task Profile 拥有。 */
function normalizeArtifactKey(value: unknown): string {
    let key = String(value || '').trim();
    if (!key) return '';
    key = key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    return key.replace(/_/g, '-');
}

/** 这些短语只有在同一段文本已明确出现 SKU 领域时才具有品类含义。 */
const SKU_CONTEXTUAL_ALIASES: Readonly<Record<string, readonly string[]>> = Object.freeze({
    'sku-template': ['组合模板', '2双装模板', '3双装模板', '4双装模板', '自选备注模板'],
    'sku-color-card': ['颜色卡', '色卡源文档', '颜色卡源文档'],
    'sku-batch': ['批量出图', '组合出图', '批量生成', '自选备注', '备注图']
});

export function getDesignArtifactKnowledge(artifactId: unknown): DesignArtifactKnowledge | undefined {
    const raw = String(artifactId || '').trim();
    if (!raw) return undefined;
    const direct = REGISTRY.find((item) => item.artifactId === raw.toLowerCase());
    if (direct) return direct;
    const profileArtifactId = resolveDesignTaskProfileArtifactKnowledgeId(raw);
    if (profileArtifactId) {
        return REGISTRY.find((item) => item.artifactId === profileArtifactId);
    }
    const normalized = normalizeArtifactKey(raw);
    if (!normalized) return undefined;
    return REGISTRY.find((item) => item.artifactId === normalized);
}

/**
 * 按用户说法找交付物知识。命中不了不猜品类，返回 generic 底座——
 * 「没有专属方法论」是事实，用通用流程推进好过硬套一个不相干的品类框架。
 */
export function resolveDesignArtifactKnowledgeByText(text: unknown): DesignArtifactKnowledge {
    const normalized = String(text || '').toLowerCase();
    if (!normalized) return getDesignArtifactKnowledge('generic') as DesignArtifactKnowledge;

    const containsSkuDomain = normalized.includes('sku');
    const matched = REGISTRY.filter((item) =>
        item.artifactId !== 'generic'
        && (
            item.aliases.some((alias) => alias && normalized.includes(alias.toLowerCase()))
            || (
                containsSkuDomain
                && (SKU_CONTEXTUAL_ALIASES[item.artifactId] || [])
                    .some((alias) => normalized.includes(alias.toLowerCase()))
            )
        )
    );
    const specific = matched.filter((item) => item.artifactId !== 'sku');
    if (specific.length === 1) return specific[0];
    if (specific.length > 1) {
        const allSkuArtifacts = specific.every((item) => item.artifactId.startsWith('sku-'));
        if (allSkuArtifacts) return getDesignArtifactKnowledge('sku') as DesignArtifactKnowledge;
        return getDesignArtifactKnowledge('generic') as DesignArtifactKnowledge;
    }
    if (matched.some((item) => item.artifactId === 'sku')) {
        return getDesignArtifactKnowledge('sku') as DesignArtifactKnowledge;
    }
    return getDesignArtifactKnowledge('generic') as DesignArtifactKnowledge;
}

export function listDesignArtifactFocusValues(artifactId: unknown): string[] {
    const knowledge = getDesignArtifactKnowledge(artifactId);
    if (!knowledge) return [];
    return ['all', ...knowledge.sections.map((section) => section.focus)];
}

function formatProvenance(provenance: DesignKnowledgeProvenance): string {
    return provenance === 'user_methodology'
        ? '来源：用户权威方法论。'
        : '来源：通用行业实践（非用户既定规范；用户另有要求时以用户为准）。';
}

function formatTaskMode(taskMode: DesignTaskMode): string {
    const labels: Record<DesignTaskMode, string> = {
        persuasive: '说服型',
        comparative: '比较型',
        explanatory: '解释型',
        expressive: '表达型',
        production: '规格化生产型',
        general: '待结合交付目的判断'
    };
    return `任务模式：${labels[taskMode]}。评价重点随任务模式变化，不得把营销主图启发式当作所有设计的硬规则。`;
}

/**
 * 前提输入清单。刻意写成「陈述事实」而不是「必须先完成 X」——
 * 这是给模型判断用的信息，不是执行门禁：模型看完自己决定先查哪些、先问哪些。
 */
function formatRequiredInputs(inputs: DesignRequiredInput[]): string {
    if (inputs.length === 0) return '';
    const observable = inputs.filter((item) => item.source === 'observable');
    const designerDecision = inputs.filter((item) => item.source === 'designer_decision');
    const userDecision = inputs.filter((item) => item.source === 'user_decision');
    const lines: string[] = ['## 动手前需要弄清楚的事'];
    if (observable.length > 0) {
        lines.push('这些在项目和当前文档里查得到，自己看，不要拿去问用户：');
        for (const item of observable) {
            lines.push(`· ${item.label} —— ${item.why}`);
        }
    }
    if (designerDecision.length > 0) {
        lines.push('这些属于设计师的专业判断：先根据已观察事实提出有依据的选择并说明假设，不要默认把决定丢回用户：');
        for (const item of designerDecision) {
            lines.push(`· ${item.label} —— ${item.why}`);
        }
    }
    if (userDecision.length > 0) {
        lines.push('这些属于用户拥有的业务事实；从项目记录或用户消息找不到权威答案时再问，用默认值顶替等于凭空编造：');
        for (const item of userDecision) {
            lines.push(`· ${item.label} —— ${item.why}`);
        }
    }
    lines.push('信息不齐时可以先做能确定的部分，但要说清楚缺什么、缺的部分为什么没做，不要拿猜测填补。');
    return lines.join('\n');
}

/**
 * 取某个交付物的方法论文本。focus 省略或为 all 时返回全量。
 * 输出带来源标注，避免模型把通用实践当成用户的既定规范。
 */
export function buildDesignArtifactKnowledgeSummary(artifactId: unknown, focus?: unknown): string {
    const knowledge = getDesignArtifactKnowledge(artifactId);
    if (!knowledge) {
        const available = listDesignArtifactIds().join(' / ');
        return `没有登记「${String(artifactId || '')}」的设计方法论。可用交付物：${available}。`;
    }
    const focusKey = String(focus || 'all').trim().toLowerCase();
    const header = `# ${knowledge.displayName}设计方法论\n${knowledge.purpose}\n${formatTaskMode(knowledge.taskMode)}\n${formatProvenance(knowledge.provenance)}`;
    const picked = focusKey && focusKey !== 'all'
        ? knowledge.sections.filter((section) => section.focus.toLowerCase() === focusKey)
        : knowledge.sections;
    const body = (picked.length > 0 ? picked : knowledge.sections)
        .map((section) => `## ${section.title}\n${section.content}`)
        .join('\n\n');
    // 前提输入始终随方法论一起给出：取任一分面都能看到「还缺什么」，
    // 不必再多调一次工具才发现自己少了关键信息。
    const inputs = formatRequiredInputs(knowledge.requiredInputs);
    return inputs ? `${header}\n\n${inputs}\n\n${body}` : `${header}\n\n${body}`;
}

/** 单独取前提输入（不含版式方法论），用于只想确认「还缺什么」的场合。 */
export function listDesignRequiredInputs(artifactId: unknown): DesignRequiredInput[] {
    return getDesignArtifactKnowledge(artifactId)?.requiredInputs || [];
}

/**
 * 为现有 Runtime Context Compiler 生成阶段化知识项。它只交付 data-only/advisory 内容，
 * 不创建新 Context Runtime，也不把知识变成执行门禁。
 */
export function buildDesignArtifactKnowledgeRuntimeItem(input: {
    taskTypeId?: unknown;
    manifestSkillId?: unknown;
    requestedArtifactId?: unknown;
    applicableStages?: RuntimeStage[];
}): RuntimeContextItem | undefined {
    const artifactId = resolveDesignTaskProfileRequestedArtifactKnowledgeId({
        taskTypeId: input.taskTypeId,
        manifestSkillId: input.manifestSkillId,
        requestedArtifactId: input.requestedArtifactId
    });
    if (!artifactId) return undefined;
    const knowledge = getDesignArtifactKnowledge(artifactId);
    if (!knowledge) return undefined;
    return {
        id: `knowledge.artifact.${knowledge.artifactId}`,
        kind: 'knowledge',
        source: `design-artifact-knowledge:${DESIGN_ARTIFACT_KNOWLEDGE_VERSION}`,
        trust: 'governed_knowledge',
        slot: 'knowledge_context',
        content: buildDesignArtifactKnowledgeSummary(knowledge.artifactId, 'overview'),
        applicableStages: input.applicableStages || ['R1', 'R3', 'R4', 'R5'],
        priority: 95,
        freshness: 'current'
    };
}
