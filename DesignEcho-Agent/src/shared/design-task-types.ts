/**
 * 设计任务类型（data-driven design task types）
 *
 * 目标：把交付物语义、真实阻塞问题与素材入口做成数据，而不是硬编码进 Agent。
 * 屏数、模块与阅读顺序属于当前设计决策，应从按需方法知识和真实内容形成。自主设计循环在识别到某个设计
 * 任务类型后，用同一份 Profile 取得交付物语义、Manifest、知识与文档角色映射；
 * 它不规定固定脚本，也不把用户可逆的设计取舍升级为确认门禁。
 *
 * 新增一个设计任务身份 = 在 TASK_TYPE_REGISTRY 里加一条数据，不需要改 Agent 核心。
 * matchSignals 可以为空：这类身份只允许 R0 模型结构化声明，不通过本地关键词抢路由。
 * 这是「技能知识数据化、不渗透进 Agent」的落地基座。
 *
 * 纯逻辑、无 Photoshop / 无 renderer 依赖，可被 smoke 直接加载验证。
 */

import type { DesignAgentOsScenario } from './design-agent-os-contracts';
import type { DesignDocumentRole } from './design-document-role';
import { MAIN_IMAGE_DELIVERY_DOCUMENTS } from './main-image-production-spec';

export type DesignTaskTypeVersion = 'design-task-types/v0';

/** 默认结构里的一屏 / 一个版面单元 */
export interface DesignTaskTypeStructureItem {
    /** 稳定 id，例如 detail-01-kv */
    id: string;
    /** 屏 / 单元标题，例如「首屏 KV」 */
    title: string;
    /** 这一屏要解决什么，例如「第一眼建立产品认知与点击理由」 */
    purpose: string;
}

/** 开工前需要确认的一个问题（只问真正阻塞的） */
export interface DesignTaskTypeIntakeQuestion {
    /** 字段 key，例如 product / asset_source / platform_size */
    key: string;
    /** 问题文案 */
    question: string;
    /** 缺省处理：未提供时如何默认，例如「未指定则按 750px 宽电商详情页处理」 */
    defaultNote?: string;
    /**
     * 是否属于「没有就无法推进」的阻塞问题。
     * 非阻塞问题用 defaultNote 自动填入默认假设，不打断用户。
     */
    blocking: boolean;
}

/** 素材来源入口（界面上呈现为按钮） */
export interface DesignTaskTypeEntryOption {
    key: string;
    label: string;
}

export interface DesignTaskTypeSpec {
    /** 任务类型 id，例如 ecommerce.detail_page.v1 */
    id: string;
    /** 中文标签，例如「电商详情页」 */
    label: string;
    /** 供 R0 模型理解“何时声明此身份”的紧凑语义，不用于本地关键词匹配。 */
    declarationGuidance?: string;
    /** v3 兼容入口 Skill id；不拥有方法论、任务身份或执行权限。 */
    skillId?: string;
    /** v5 artifact-owner Manifest 的 skill_id；方法 Overlay 不登记在这里。 */
    manifestSkillId?: string;
    /**
     * 该交付物可使用的知识 id。第一个是默认知识；具体交付物种类已由结构化
     * artifactKind 明确时，可以在这个集合内选择。Task Profile 是这组 crosswalk 的唯一 Owner。
     */
    artifactKnowledgeIds: [string, ...string[]];
    /**
     * 任务身份对应的运行提示。它只帮助通用 Harness 选择预算与文档规范化，
     * 不承载 Skill 的方法论、工作流或工具白名单。
     */
    runtimeHints: {
        scenario: DesignAgentOsScenario;
        documentRole: DesignDocumentRole;
    };
    /** 命中该任务类型的正向关键词 */
    matchSignals: string[];
    /**
     * 负向关键词：命中即排除（这些是「检查现成模板 / 模板填充 / 导出 / 保存」
     * 等存量操作语义，不应被旧兼容匹配器误当成需要建立新视觉结构的任务）。
     */
    excludeSignals: string[];
    /** 默认画布宽度（电商常见尺寸），用作未指定时的合理默认 */
    defaultCanvasWidth?: number;
    /** Skill-owned production specification used by this Task Profile, when one exists. */
    productionSpecRef?: string;
    /** 默认结构（起点，需按产品与素材调整，不是死模板） */
    defaultStructure: DesignTaskTypeStructureItem[];
    /** 开工前需要确认的问题（阻塞的才问，非阻塞的使用默认值） */
    intakeQuestions: DesignTaskTypeIntakeQuestion[];
    /** 素材来源入口 */
    entryOptions: DesignTaskTypeEntryOption[];
    /**
     * 该品类的目标文档规范名（如「详情页」）。用于 createDocument 结果一致性校验
     * 与阶段计划 targetDocumentName 期望。无则不做文档名校验（多数品类可不设）。
     */
    canonicalDocumentName?: string;
    /**
     * 该品类是否提供 renderLayout 阶段计划 stagePlan 契约。
     * 开放创意只把它作为按需方法提示；规格化 staged 流程可在自身契约内强制。默认 false。
     */
    requiresStagePlanOnRender?: boolean;
    /**
     * 新建画布前是否必须先读取参考输入（searchEagleReferences / searchDesignKnowledge /
     * analyzeAssetContent 分析用户或项目内参考图 / 用户消息自带参考来源）。
     * 仅用于确有外部复制目标、没有参考就无法定义交付物的任务；默认 false。
     * 普通开放设计或模板设计不得仅因参考库离线而阻断，模型基础知识、项目事实和
     * 写后视觉复核仍应组成可执行路径。
     * 门禁在 design-discipline-runtime 执行点强制，只检查参考输入是否存在，不限定获取路径。
     */
    requiresReferenceInputBeforeDocument?: boolean;
}

/** 已知上下文：用于过滤「已经知道的就不再问」 */
export interface DesignTaskKnownContext {
    hasPhotoshopDocument?: boolean;
    hasProjectAssets?: boolean;
    hasEagle?: boolean;
}

const DETAIL_PAGE_DESIGN_TASK_TYPE: DesignTaskTypeSpec = {
    id: 'ecommerce.detail_page.v1',
    label: '电商详情页',
    declarationGuidance: '主交付物是连续长页或分屏详情内容，需要把产品事实、用户问题、卖点证据和规格信息组织成有节奏的说服叙事。',
    skillId: 'detail-page-design',
    manifestSkillId: 'ecommerce.detail_page',
    artifactKnowledgeIds: ['detail-page'],
    runtimeHints: {
        scenario: 'detail-page',
        documentRole: 'detailPage'
    },
    matchSignals: ['详情页', '详情长图', '商品详情', '产品详情', '卖点页', '面料页', '参数页', 'detail page'],
    excludeSignals: [
        '看一下', '看看', '检查', '结构', '分析', '复核',
        '模板填充', '填充', '套版', '换图',
        '导出当前', '当前文档导出', '保存', '另存'
    ],
    defaultCanvasWidth: 750,
    // 详情页屏数与叙事结构必须由 Agent 根据产品、受众、事实和素材动态形成。
    defaultStructure: [],
    intakeQuestions: [
        { key: 'product', question: '产品是什么？', blocking: true },
        {
            key: 'asset_source',
            question: '素材从哪里获取？（当前 Photoshop 文档 / 从 Eagle 选择 / 本地上传）',
            blocking: true
        },
        {
            key: 'platform_size',
            question: '使用哪个平台尺寸？',
            defaultNote: '未指定则按 750px 宽电商详情页处理',
            blocking: false
        }
    ],
    entryOptions: [
        { key: 'current-photoshop', label: '使用当前 Photoshop 文档' },
        { key: 'eagle', label: '从 Eagle 选择素材' },
        { key: 'upload', label: '上传产品资料' }
    ],
    canonicalDocumentName: '详情页',
    requiresStagePlanOnRender: true
};

const MAIN_IMAGE_DESIGN_TASK_TYPE: DesignTaskTypeSpec = {
    id: 'ecommerce.main_image.v1',
    label: '电商主图',
    declarationGuidance: '主交付物是商品列表或首屏使用的主图。用户只委托一张泛称商品主图，且没有明确指定转化图、颜色/款式总览或比较图时，按搜索或推荐列表的点击入口理解：候选应比较哪种真实视觉关系能在缩略图中形成最清楚、最相关的进入理由。颜色/款式覆盖更全、构图更安全或更容易裁切只能作为证据，不能单独决定素材或方案赢家；用户明确指定其它角色时服从该角色。',
    skillId: 'main-image-design',
    manifestSkillId: 'ecommerce.main_image',
    artifactKnowledgeIds: ['main-image'],
    runtimeHints: {
        scenario: 'main-image',
        documentRole: 'mainImage'
    },
    matchSignals: ['主图', '首图', '主视觉', '点击图', 'main image'],
    excludeSignals: ['白底图', '自底图', '白底', 'sku', '模板填充', '看一下', '检查', '结构', '保存', '导出当前'],
    productionSpecRef: 'main-image-production-spec.ts#MAIN_IMAGE_DELIVERY_DOCUMENTS',
    // 用户委托一张或多张时按真实目标形成结构，不能把固定五图清单扩成默认交付范围。
    defaultStructure: [],
    intakeQuestions: [
        { key: 'product', question: '产品是什么？', blocking: true },
        {
            key: 'asset_source',
            question: '素材从哪里获取？（当前 Photoshop 文档 / 从 Eagle 选择 / 本地上传）',
            blocking: true
        },
        {
            key: 'platform_size',
            question: '使用哪个平台尺寸？',
            defaultNote: MAIN_IMAGE_DELIVERY_DOCUMENTS.every((document) => (
                document.platformUploadSizeStatus === 'unverified'
            ))
                ? '当前生产规范只确认工作文档结构，平台上传尺寸尚未验证；应以用户明确要求、渠道规范或当前交付目标为准。'
                : '按当前已验证的主图生产规范处理。',
            blocking: false
        }
    ],
    entryOptions: [
        { key: 'current-photoshop', label: '使用当前 Photoshop 文档' },
        { key: 'eagle', label: '从 Eagle 选择素材' },
        { key: 'upload', label: '上传产品资料' }
    ]
};

/** 单画布视觉设计任务类型 id；与 v5 single-canvas-visual Manifest.task_type 保持一致。 */
export const SINGLE_CANVAS_VISUAL_DESIGN_TASK_TYPE_ID = 'design.single_canvas_visual.v1';

const SINGLE_CANVAS_VISUAL_DESIGN_TASK_TYPE: DesignTaskTypeSpec = {
    id: SINGLE_CANVAS_VISUAL_DESIGN_TASK_TYPE_ID,
    label: '单画布视觉设计',
    declarationGuidance: '主交付物是海报、活动 KV、社媒封面、Banner 或其它单页传播视觉；版式与工具顺序需要动态设计。',
    skillId: 'design.single_canvas_visual',
    manifestSkillId: 'design.single_canvas_visual',
    artifactKnowledgeIds: ['generic', 'poster', 'banner', 'social-cover'],
    runtimeHints: {
        scenario: 'general-design',
        documentRole: 'unknown'
    },
    // 只接受 R0 模型按主交付物声明；Harness 不用「海报 / Banner」关键词替模型做决定。
    matchSignals: [],
    excludeSignals: [],
    defaultCanvasWidth: 1080,
    // 单画布只规定设计问题和验收，不规定元素槽位；结构必须由模型按目标、内容与素材动态生成。
    defaultStructure: [],
    intakeQuestions: [
        {
            key: 'goal',
            question: '这个单画布设计要让谁在什么场景看到，并首先理解或感受到什么？',
            blocking: true
        },
        {
            key: 'artifact_kind',
            question: '交付物是海报、活动 KV、社媒封面、Banner，还是其他单画布视觉？',
            defaultNote: '用户已经明确交付物时直接沿用，不重复追问',
            blocking: false
        },
        {
            key: 'canvas_size',
            question: '成图尺寸和使用渠道是什么？',
            defaultNote: '未指定时先从渠道、现有文档或素材比例推断；仍无法判断再询问',
            blocking: false
        }
    ],
    entryOptions: [
        { key: 'current-photoshop', label: '使用当前 Photoshop 文档' },
        { key: 'eagle', label: '从 Eagle 选择素材' },
        { key: 'upload', label: '上传素材与文案' }
    ]
};

/** SKU 模板设计任务类型 id（单一来源：移交契约 / 控制面信号映射 / 纪律激活共用，勿散落字面量）。 */
export const SKU_TEMPLATE_DESIGN_TASK_TYPE_ID = 'ecommerce.sku_template.v1';

/** SKU 色卡设计任务类型 id；与 v5 sku-color-card Manifest.task_type 保持一致。 */
export const SKU_COLOR_CARD_DESIGN_TASK_TYPE_ID = 'ecommerce.sku_color_card.v1';

/** SKU 批量生产任务类型 id；与 v5 sku-batch Manifest.task_type 保持一致。 */
export const SKU_BATCH_DESIGN_TASK_TYPE_ID = 'ecommerce.sku_batch.v1';

const SKU_COLOR_CARD_DESIGN_TASK_TYPE: DesignTaskTypeSpec = {
    id: SKU_COLOR_CARD_DESIGN_TASK_TYPE_ID,
    label: 'SKU 色卡',
    declarationGuidance: '为每个真实颜色建立准确、可编辑、来源可追溯的色卡单元；不是 2/3/4 双组合模板，也不是批量套版导出。',
    skillId: 'sku-batch',
    manifestSkillId: 'ecommerce.sku_color_card',
    artifactKnowledgeIds: ['sku-color-card'],
    runtimeHints: {
        scenario: 'sku',
        documentRole: 'sku'
    },
    matchSignals: ['sku色卡', 'sku 色卡', 'sku颜色卡', 'sku 颜色卡', 'sku色卡源文档', 'sku 色卡源文档'],
    excludeSignals: ['模板', '模版', '组合图', '批量导出', '自选备注', '只说明', '只讨论', '怎么做', '如何做'],
    defaultCanvasWidth: 1500,
    defaultStructure: [
        { id: 'sku-card-product', title: '商品图', purpose: '清楚展示当前颜色对应的商品主体' },
        { id: 'sku-card-label', title: '色名标签', purpose: '优先使用用户、项目配置或既有图层确认的颜色名；普通文件名仅作 provisional 可编辑标签' },
        { id: 'sku-card-order', title: '参考序号', purpose: '只辅助查看编排顺序，不进入正式颜色资产组' }
    ],
    intakeQuestions: [
        { key: 'color_card_sources', question: '需要使用哪些颜色图片，顺序是什么？', blocking: true },
        {
            key: 'canvas_size',
            question: '色卡画布尺寸是多少？',
            defaultNote: '未指定则按 1500×1500 处理',
            blocking: false
        }
    ],
    entryOptions: [
        { key: 'current-project', label: '使用当前项目同名图片' },
        { key: 'current-photoshop', label: '使用当前 Photoshop 文档' },
        { key: 'upload', label: '上传颜色图片' }
    ],
    canonicalDocumentName: 'SKU'
};

const SKU_BATCH_DESIGN_TASK_TYPE: DesignTaskTypeSpec = {
    id: SKU_BATCH_DESIGN_TASK_TYPE_ID,
    label: 'SKU 批量生产',
    declarationGuidance: '消费已确认的组合规格、色卡与模板，完成映射、生成、命名、保存、导出和数量核对；不负责原创模板方向。',
    skillId: 'sku-batch',
    manifestSkillId: 'ecommerce.sku_batch',
    artifactKnowledgeIds: ['sku-batch'],
    runtimeHints: {
        scenario: 'sku',
        documentRole: 'sku'
    },
    // 只允许模型按真实目标结构化声明；不在 Harness 中新增 SKU 关键词路由。
    matchSignals: [],
    excludeSignals: [],
    defaultCanvasWidth: 1500,
    defaultStructure: [],
    intakeQuestions: [
        { key: 'combination_spec', question: '需要生产哪些已确认的 SKU 组合？', blocking: true },
        {
            key: 'asset_source',
            question: '模板与真实色卡从哪里获取？',
            defaultNote: '优先检查当前 Photoshop 文档和项目内既有源文件，找不到再询问',
            blocking: false
        },
        {
            key: 'output_naming',
            question: '导出目录和命名规范是什么？',
            defaultNote: '项目已有明确规范时沿用；没有规范且会影响下游上架时再确认',
            blocking: false
        }
    ],
    entryOptions: [
        { key: 'current-project', label: '使用当前项目模板与色卡' },
        { key: 'current-photoshop', label: '使用当前 Photoshop 文档' },
        { key: 'upload', label: '上传组合规格与素材' }
    ],
    canonicalDocumentName: 'SKU'
};

const SKU_TEMPLATE_DESIGN_TASK_TYPE: DesignTaskTypeSpec = {
    id: SKU_TEMPLATE_DESIGN_TASK_TYPE_ID,
    label: 'SKU 模板',
    declarationGuidance: '设计 2/3/4 双组合与自选备注等可复用版式系统，重点是同级卡片关系、跨模板一致性和 Photoshop 可编辑结构；不是颜色配置或批量出图。',
    skillId: 'sku-batch',
    manifestSkillId: 'ecommerce.sku_template',
    artifactKnowledgeIds: ['sku-template'],
    runtimeHints: {
        scenario: 'sku',
        documentRole: 'sku'
    },
    matchSignals: ['sku模板', 'sku 模板', 'sku模版', 'sku 模版', 'sku组合模板', 'sku 组合模板', 'sku template'],
    // 批量出图 / 看检查 / 导出 等属于 SKU 批量生产或只读路径，不进入 SKU 模板设计语义
    excludeSignals: ['批量', '出图', '看一下', '看看', '检查', '导出当前', '保存', '填充'],
    defaultCanvasWidth: 800,
    // 规格与占位数量可校验，但视觉区域、层级和阅读顺序由 Agent 动态设计。
    defaultStructure: [],
    intakeQuestions: [
        {
            key: 'template_variants',
            question: '这套 SKU 组合模板需要覆盖哪些变体（如 2/3/4 双与自选备注）？',
            defaultNote: '先从用户请求、当前 SKU.psb、既有模板与项目规格推导最小可复用变体集；只有交付数量仍会实质变化时再询问',
            blocking: false
        },
        {
            key: 'asset_source',
            question: '素材从哪里获取？',
            defaultNote: '优先检查项目里现有的 SKU.psb / 色卡素材，找不到再问',
            blocking: false
        }
    ],
    entryOptions: [
        { key: 'current-photoshop', label: '使用当前 Photoshop 文档' },
        { key: 'eagle', label: '从 Eagle 选择素材' },
        { key: 'upload', label: '上传产品资料' }
    ]
};

/** 设计任务类型注册表（新增具体品类只需在此加数据） */
export const DESIGN_TASK_TYPE_REGISTRY: readonly DesignTaskTypeSpec[] = Object.freeze([
    DETAIL_PAGE_DESIGN_TASK_TYPE,
    MAIN_IMAGE_DESIGN_TASK_TYPE,
    SINGLE_CANVAS_VISUAL_DESIGN_TASK_TYPE,
    SKU_COLOR_CARD_DESIGN_TASK_TYPE,
    SKU_BATCH_DESIGN_TASK_TYPE,
    SKU_TEMPLATE_DESIGN_TASK_TYPE
]);

/**
 * 通用设计兜底类型——**不进 DESIGN_TASK_TYPE_REGISTRY、不被关键词匹配**（matchSignals 为空，
 * 故 resolveDesignTaskTypeSpec 永远不会返回它；非设计文本仍判 undefined 的语义不变）。
 *
 * 仅作为 resolveDesignDisciplineContext 的兜底：当确定是创意设计意图（isCreativeDesignIntent，
 * 来自控制面而非关键词）但不匹配任何具体品类时启用，让海报 / 小红书 / Banner / 任意新设计也继承
 * 通用设计不变量（事实来源、目标与对象身份、可逆执行、真实读回），但**不套**任何
 * 品类专属结构 / 阶段计划 / 文档名校验（无 canonicalDocumentName、无 requiresStagePlanOnRender、
 * 只用通用核心工具集）。这是"扩品类覆盖面"的正解：靠通用兜底而非逐品类堆关键词（理解优于硬编码）。
 */
export const GENERIC_DESIGN_TASK_TYPE: DesignTaskTypeSpec = {
    id: 'design.generic.v1',
    label: '通用设计',
    // 措辞修复 2026-08-06：原文"只有当……时使用"把本类型写成了勉强兜底，与
    // declareDesignIntent 描述里的"不确定就别声明"叠加，真机结果是 0 次声明、
    // 设计流程从未启动。开放式设计本就是它的主场，不是退而求其次。
    declarationGuidance: '要产出视觉设计成品、但请求跨多个交付物或没有更具体的品类身份时，就声明本类型——这是开放式设计的正常归属，不是兜底。海报、Banner、小红书、多交付物的整套设计都属于这里。',
    manifestSkillId: 'design.general',
    artifactKnowledgeIds: ['generic', 'poster', 'banner', 'social-cover'],
    runtimeHints: {
        scenario: 'general-design',
        documentRole: 'unknown'
    },
    matchSignals: [],
    excludeSignals: [],
    defaultCanvasWidth: 1080,
    defaultStructure: [],
    intakeQuestions: [
        { key: 'goal', question: '这个设计要达成什么目标、用在什么场景？', blocking: true },
        {
            key: 'asset_source',
            question: '素材从哪里获取？（当前 Photoshop 文档 / 从 Eagle 选择 / 本地上传）',
            blocking: true
        },
        {
            key: 'canvas_size',
            question: '成图尺寸是多少？',
            defaultNote: '未指定则按 1080px 通用画布处理',
            blocking: false
        }
    ],
    entryOptions: [
        { key: 'current-photoshop', label: '使用当前 Photoshop 文档' },
        { key: 'eagle', label: '从 Eagle 选择素材' },
        { key: 'upload', label: '上传素材' }
    ]
};

/**
 * 可由结构化控制面声明的任务类型。
 *
 * 通用设计只加入声明目录，不加入文本匹配注册表：模型可在 R0 明确声明它，
 * 但本地 Harness 不会因为“海报 / Banner”等关键词替模型推断通用设计意图。
 */
const DECLARABLE_DESIGN_TASK_TYPE_SPECS: readonly DesignTaskTypeSpec[] = Object.freeze([
    ...DESIGN_TASK_TYPE_REGISTRY,
    GENERIC_DESIGN_TASK_TYPE
]);

function normalizeTaskText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function textIncludesAny(text: string, signals: string[]): boolean {
    return signals.some((signal) => signal && text.includes(signal.toLowerCase()));
}

export function getDesignTaskTypeSpec(id?: string): DesignTaskTypeSpec | undefined {
    if (!id) return undefined;
    return DECLARABLE_DESIGN_TASK_TYPE_SPECS.find((spec) => spec.id === id);
}

export interface DesignTaskProfileCrosswalk {
    taskTypeId: string;
    label: string;
    legacySkillIds: string[];
    manifestSkillId?: string;
    artifactKnowledgeIds: string[];
    defaultArtifactKnowledgeId: string;
    scenario: DesignAgentOsScenario;
    documentRole: DesignDocumentRole;
}

function toDesignTaskProfileCrosswalk(spec: DesignTaskTypeSpec): DesignTaskProfileCrosswalk {
    return {
        taskTypeId: spec.id,
        label: spec.label,
        legacySkillIds: spec.skillId ? [spec.skillId] : [],
        ...(spec.manifestSkillId ? { manifestSkillId: spec.manifestSkillId } : {}),
        artifactKnowledgeIds: [...spec.artifactKnowledgeIds],
        defaultArtifactKnowledgeId: spec.artifactKnowledgeIds[0],
        scenario: spec.runtimeHints.scenario,
        documentRole: spec.runtimeHints.documentRole
    };
}

/** Task Profile / Manifest / 知识 / 文档角色的唯一 crosswalk 投影。 */
export function listDesignTaskProfileCrosswalks(): DesignTaskProfileCrosswalk[] {
    return DECLARABLE_DESIGN_TASK_TYPE_SPECS.map(toDesignTaskProfileCrosswalk);
}

export function getDesignTaskProfileCrosswalk(
    taskTypeId?: unknown
): DesignTaskProfileCrosswalk | undefined {
    const spec = getDesignTaskTypeSpec(String(taskTypeId || '').trim());
    return spec ? toDesignTaskProfileCrosswalk(spec) : undefined;
}

export function getDesignTaskProfileCrosswalkByManifestSkillId(
    manifestSkillId?: unknown
): DesignTaskProfileCrosswalk | undefined {
    const normalized = String(manifestSkillId || '').trim();
    if (!normalized) return undefined;
    const spec = DECLARABLE_DESIGN_TASK_TYPE_SPECS.find((item) => (
        item.manifestSkillId === normalized
    ));
    return spec ? toDesignTaskProfileCrosswalk(spec) : undefined;
}

/**
 * 把仓库既有的 taskType / Manifest skill / v3 Skill / documentRole 口径收敛为知识 id。
 * 该函数只做已声明身份的 crosswalk，不读取用户文本、不做路由，也不授予执行权限。
 */
export function resolveDesignTaskProfileArtifactKnowledgeId(
    identity?: unknown
): string | undefined {
    const normalized = String(identity || '').trim();
    if (!normalized) return undefined;
    const byTaskType = getDesignTaskTypeSpec(normalized);
    if (byTaskType) return byTaskType.artifactKnowledgeIds[0];
    const bySkill = DECLARABLE_DESIGN_TASK_TYPE_SPECS.find((spec) => (
        spec.manifestSkillId === normalized || spec.skillId === normalized
    ));
    if (bySkill) return bySkill.artifactKnowledgeIds[0];
    const byDocumentRole = DECLARABLE_DESIGN_TASK_TYPE_SPECS.filter((spec) => (
        String(spec.runtimeHints.documentRole).toLowerCase() === normalized.toLowerCase()
    ));
    if (byDocumentRole.length === 1) return byDocumentRole[0].artifactKnowledgeIds[0];
    if (byDocumentRole.length > 1 && normalized.toLowerCase() === 'sku') return 'sku';
    if (['unknown', 'design-generic', 'general-design'].includes(normalized.toLowerCase())) {
        return GENERIC_DESIGN_TASK_TYPE.artifactKnowledgeIds[0];
    }
    return undefined;
}

/** 校验结构化 artifactKind 是否属于当前 Task Profile；不合法时回到 Profile 默认知识。 */
export function resolveDesignTaskProfileRequestedArtifactKnowledgeId(input: {
    taskTypeId?: unknown;
    manifestSkillId?: unknown;
    requestedArtifactId?: unknown;
}): string | undefined {
    const crosswalk = getDesignTaskProfileCrosswalk(input.taskTypeId)
        || getDesignTaskProfileCrosswalkByManifestSkillId(input.manifestSkillId);
    if (!crosswalk) return undefined;
    const requested = String(input.requestedArtifactId || '').trim().toLowerCase();
    return requested && crosswalk.artifactKnowledgeIds.includes(requested)
        ? requested
        : crosswalk.defaultArtifactKnowledgeId;
}

/**
 * 通过现有 Skill 声明入口查找任务类型。仅用于兼容 v3 的结构化 skillId 提示；
 * 完整 Skill 能力解析最终由 v5 manifest / Capability resolver 负责。
 */
export function getDesignTaskTypeSpecBySkillId(skillId?: string): DesignTaskTypeSpec | undefined {
    const normalized = String(skillId || '').trim();
    if (!normalized) return undefined;
    return DECLARABLE_DESIGN_TASK_TYPE_SPECS.find((spec) => (
        spec.skillId === normalized || spec.manifestSkillId === normalized
    ));
}

/**
 * 已注册的合法设计任务类型 id 枚举（结构化数据，非对用户措辞做关键词匹配）。
 *
 * 用途（V2「意图交给 Agent 理解」）：让模型能**准确声明**本轮 task_type——把这份合法 id 目录注入
 * 声明工具的 description / 校验失败信息，模型据此声明、拼错即安全降级为不激活（getDesignTaskTypeSpec
 * 对未注册 id 返回 undefined）。通用设计在这里是可声明身份，但仍不进入文本匹配注册表；
 * 具体品类则必须先进入 DESIGN_TASK_TYPE_REGISTRY 才能被声明和匹配。
 */
export function listDesignTaskTypeIds(): string[] {
    return DECLARABLE_DESIGN_TASK_TYPE_SPECS.map((spec) => spec.id);
}

/** R0 路由所需的最小语义目录；只提供身份说明，不包含固定流程或关键词规则。 */
export function listDesignTaskTypeCatalog(): Array<{
    id: string;
    label: string;
    declarationGuidance?: string;
}> {
    return DECLARABLE_DESIGN_TASK_TYPE_SPECS.map((spec) => ({
        id: spec.id,
        label: spec.label,
        ...(spec.declarationGuidance ? { declarationGuidance: spec.declarationGuidance } : {})
    }));
}

/** 判定一个 id 是否为已注册的合法设计任务类型（供 design-intent-signal 等做纵深校验，不引入模块环依赖）。 */
export function isRegisteredDesignTaskTypeId(id?: unknown): boolean {
    return typeof id === 'string' && DECLARABLE_DESIGN_TASK_TYPE_SPECS.some((spec) => spec.id === id);
}

/**
 * 从用户文本解析设计任务类型。
 * 命中正向关键词且不命中负向关键词时返回对应 spec；否则返回 undefined
 * （非设计任务、或属于「检查现成模板 / 填充 / 导出」等结构化路径）。
 */
export function resolveDesignTaskTypeSpec(text: unknown): DesignTaskTypeSpec | undefined {
    const normalized = normalizeTaskText(text);
    if (!normalized) return undefined;
    for (const spec of DESIGN_TASK_TYPE_REGISTRY) {
        if (textIncludesAny(normalized, spec.excludeSignals)) continue;
        if (textIncludesAny(normalized, spec.matchSignals)) return spec;
    }
    return undefined;
}

/**
 * 文本是否命中任一已注册品类的负向信号（检查 / 填充 / 套版 / 换图 / 导出 / 保存 / 批量出图 等
 * 只读、维护或规格化生产语义）。
 * 通用设计兜底（GENERIC_DESIGN_TASK_TYPE）用它做安全网：即便控制面判为创意意图，命中这些信号也
 * 不进入开放设计纪律——这些属只读 / 模板填充 / 导出路径，应由对应结构化路径处理。
 */
export function hitsAnyDesignTaskExcludeSignal(text: unknown): boolean {
    const normalized = normalizeTaskText(text);
    if (!normalized) return false;
    return DESIGN_TASK_TYPE_REGISTRY.some((spec) => textIncludesAny(normalized, spec.excludeSignals));
}

/** 过滤掉「已知上下文已能回答」的阻塞问题，避免重复追问 */
function filterBlockingQuestions(
    spec: DesignTaskTypeSpec,
    known: DesignTaskKnownContext
): DesignTaskTypeIntakeQuestion[] {
    return spec.intakeQuestions.filter((question) => {
        if (!question.blocking) return false;
        if (question.key === 'asset_source' && (known.hasPhotoshopDocument || known.hasProjectAssets || known.hasEagle)) {
            // 已经有可用素材来源，则素材来源不再是阻塞问题
            return false;
        }
        return true;
    });
}

/** 结构化 intake（供界面渲染入口卡片 / 结构预览使用） */
export interface DesignTaskTypeIntake {
    version: DesignTaskTypeVersion;
    taskTypeId: string;
    label: string;
    skillId?: string;
    blockingQuestions: DesignTaskTypeIntakeQuestion[];
    deferredQuestions: DesignTaskTypeIntakeQuestion[];
    defaultStructure: DesignTaskTypeStructureItem[];
    entryOptions: DesignTaskTypeEntryOption[];
}

export function buildDesignTaskTypeIntake(
    spec: DesignTaskTypeSpec,
    known: DesignTaskKnownContext = {}
): DesignTaskTypeIntake {
    const blockingQuestions = filterBlockingQuestions(spec, known);
    const deferredQuestions = spec.intakeQuestions.filter(
        (question) => !blockingQuestions.includes(question)
    );
    return {
        version: 'design-task-types/v0',
        taskTypeId: spec.id,
        label: spec.label,
        skillId: spec.skillId,
        blockingQuestions,
        deferredQuestions,
        defaultStructure: spec.defaultStructure,
        entryOptions: spec.entryOptions
    };
}

/**
 * 生成注入自主设计循环系统提示词的数据驱动指导段。
 * 任务语义只帮助主 Agent 理解交付物、检查上下文和形成设计方向，不要求向用户播报
 * 内部 taskType / Skill，也不把所有设计强制成“先问卷、再确认、才动手”的固定脚本。
 */
export function buildDesignTaskTypePromptSection(
    spec: DesignTaskTypeSpec,
    known: DesignTaskKnownContext = {},
    options: { withoutTools?: boolean } = {}
): string {
    const intake = buildDesignTaskTypeIntake(spec, known);
    const lines: string[] = [];

    lines.push('【任务语义与设计责任（内部上下文，不向用户播报类型或能力名）】');
    lines.push(`${spec.label}：${spec.declarationGuidance}`);
    lines.push('设计知识属于通用 Agent / Harness 知识层；业务 Skill 只是可选的受控执行 Overlay，不是专业方法的唯一来源。面向用户只说明交付物、设计目标、有依据的判断和下一步。');
    // 任务声明是当前语义假设，不是硬路线。若真实观察表明用户要操作既有文件而非建立新结构，
    // 模型应按可观察事实修正计划，不得被声明标签锁死。
    lines.push(
        '当前任务语义不锁死路线。如果用户其实要导出、编辑、检查或复用现有文件，先读取目标文档与项目事实，' +
        '再按真实意图推进；不要为存量任务另建空白画布，也不要把内部改道过程讲给用户。'
    );
    if (options.withoutTools) {
        // 纯对话/思考阶段：没有工具可调，不要提示模型去"读取"工具，否则会把工具调用吐成文本。
        lines.push('先在心里理清「已知信息」和「缺失信息」（本轮不调用任何工具，只做理解与规划）。');
    } else {
        lines.push(
            '先读取当前设计判断真正需要的上下文：项目状态与资源、目标 Photoshop 文档或用户提供的内容。' +
            '只有外部知识或参考能实质降低不确定性时再检索，不要为了走流程依次调用所有来源。'
        );
    }

    if (intake.blockingQuestions.length) {
        const questionText = intake.blockingQuestions
            .map((question, index) => `${index + 1}. ${question.question}`)
            .join('\n');
        lines.push(
            `只问真正属于用户且会改变交付物的阻塞问题（最多 ${intake.blockingQuestions.length} 个）。` +
            `可逆的设计取舍由你基于观察先做；用户业务事实不得用默认值编造：\n${questionText}`
        );
    } else {
        lines.push('已有可用上下文时不要重复追问，直接用已知信息和合理默认值推进。');
    }

    const deferredWithDefault = intake.deferredQuestions.filter((question) => question.defaultNote);
    if (deferredWithDefault.length) {
        const defaultsText = deferredWithDefault
            .map((question) => `- ${question.question} ${question.defaultNote}`)
            .join('\n');
        lines.push(`以下信息缺失时使用默认值，不必打断用户：\n${defaultsText}`);
    }

    if (intake.defaultStructure.length > 0) {
        const structureText = intake.defaultStructure
            .map((item, index) => `${String(index + 1).padStart(2, '0')} ${item.title}——${item.purpose}`)
            .join('\n');
        lines.push(
            `默认结构（起点，可根据产品和素材调整，不是死模板，禁止照搬到不匹配的产品）：\n${structureText}`
        );
    } else {
        lines.push('该任务没有固定元素槽位或默认模板；请根据目标、内容、素材和渠道动态生成结构与阅读顺序。');
    }

    const entryText = intake.entryOptions.map((option) => `[${option.label}]`).join('  ');
    lines.push(`素材来源可向用户提供这几个入口：${entryText}。`);

    lines.push(
        '完整新交付物在写入前应形成足以执行的结构或 storyboard，并由 Agent 对照目标、素材和视觉观察自检；局部编辑、导出或检查不需要补做一套完整 storyboard。' +
        '用户未要求逐步确认、品牌方向没有关键缺口且操作可逆时，直接在目标或沙盒文档中按阶段落地并观察真实结果；只有缺少会改变方案的用户业务决策或存在不可逆风险时才暂停确认。'
    );

    return lines.join('\n');
}
