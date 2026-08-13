/**
 * 设计品类词条库（design-category-terms）
 *
 * 治理目标（2026-08-04）：主图/详情页/SKU/海报/banner 等品类的关键词此前在至少 6 处
 * 独立书写（design-document-role / agent-task-planning-contract / sku-intent-params /
 * task-completion-contract / agent-intent-control-plane），各阶段是「裁剪过的子集」
 * 而非完全相同——强行统一为一个正则会改变行为。本模块把词条做成**唯一数据源**，
 * 普通消费方用子集声明 + 构造 helper 生成自己的正则；Agent 核心决策层必须改用
 * 本文件提供的具名语义投影，避免在核心重复登记品类 id 与词条（语义保持逐字一致）。
 *
 * 使用规则：
 * - 新增品类词 → 只改本文件词条；消费方若需使用，在其子集声明中引用
 * - 消费方子集声明 = 该阶段"为什么用这些词"的显式记录，不要无差别引用全量
 * - 词条是**正则片段**（已含转义，如 'main\\s*image'），拼接时不再转义
 * - 行为一致性由 scripts/verify-category-terms.cjs 守护（新旧词条存在性对比）
 */

export type DesignCategoryId =
    | 'mainImage'
    | 'detailPage'
    | 'sku'
    | 'poster'
    | 'banner'
    | 'generalArtifact';

/**
 * 品类词条（正则片段，含转义）。
 * generalArtifact = 通用设计成品词（海报之外的落地页/封面/KV 等），跨品类联合使用。
 */
export const DESIGN_CATEGORY_TERMS: Record<DesignCategoryId, readonly string[]> = {
    mainImage: [
        '主图',
        '点击图',
        '转化图',
        '白底图',
        '白底',
        'main\\s*image',
        'main-image',
        'hero\\s*image'
    ],
    detailPage: [
        '详情页',
        '商品详情',
        '产品详情',
        '详情长图',
        '长详情',
        '长图',
        'detail\\s*page',
        'detail-page',
        'product\\s*detail'
    ],
    sku: [
        'SKU',
        'sku',
        'SKU\\s*备注',
        'sku\\s*备注',
        '规格备注',
        '自选备注',
        '备注图',
        '组合图',
        '规格图',
        '色卡',
        'SKU组合',
        'sku组合',
        '批量配色',
        '批量出图',
        '批量生成',
        '双装',
        '单双装',
        '单双(?:装)?',
        '一\\s*双(?:装)?',
        '\\d{1,2}\\s*双'
    ],
    poster: ['海报', '宣传图', '活动图', 'poster'],
    banner: ['banner', '横幅', '店铺头图', '活动横幅'],
    generalArtifact: ['首图', '封面', '落地页', 'KV', '视觉稿', '场景图']
};

/**
 * SKU 的边界写法（`(^|[^a-z0-9])sku([^a-z0-9]|$)`），多个消费方共用。
 * 原写法区分大小写由调用方决定（正则加 /i 或词条显式列 SKU|sku）。
 */
export const SKU_NAME_BOUNDARY_PATTERN = '(^|[^a-z0-9])sku([^a-z0-9]|$)';

/**
 * 由品类词条构造正则片段。默认不包裹 (?:)，与原「裸词条」写法逐字一致。
 * 需要包裹时传 wrap: true（如 SKU_DOMAIN_TERM_PATTERN 的 (?:...) 形式）。
 */
export function buildCategoryTermPattern(
    id: DesignCategoryId,
    options?: { subset?: readonly string[]; wrap?: boolean }
): string {
    const pool = DESIGN_CATEGORY_TERMS[id];
    const selected = options?.subset
        ? options.subset.filter((term) => pool.includes(term))
        : [...pool];
    const joined = selected.join('|');
    return options?.wrap ? `(?:${joined})` : joined;
}

/**
 * 跨品类联合构造（如创意设计成品判定同时认主图/详情页/海报/banner）。
 * 子集为空数组时返回 ''（调用方负责拼接时跳过）。
 */
export function buildCrossCategoryTermPattern(
    ids: readonly DesignCategoryId[],
    options?: { subset?: readonly string[]; wrap?: boolean }
): string {
    const pool = ids.flatMap((id) => [...DESIGN_CATEGORY_TERMS[id]]);
    const selected = options?.subset
        ? options.subset.filter((term) => pool.includes(term))
        : pool;
    if (selected.length === 0) return '';
    const joined = selected.join('|');
    return options?.wrap ? `(?:${joined})` : joined;
}

/** Agent 控制面询问“是否支持某业务能力”时识别的既有目标集合。 */
export function buildBusinessCapabilityTargetPattern(): string {
    return buildCrossCategoryTermPattern(
        ['sku', 'mainImage', 'detailPage'],
        {
            subset: ['sku', '主图', '详情页', '长图', '自选备注', '备注图', '组合图', '白底图', '点击图', '转化图'],
            wrap: true
        }
    );
}

/** Agent 控制面识别开放创意成品时使用的既有目标集合。 */
export function buildCreativeArtifactTargetPattern(includeLongFormAlias = false): string {
    const subset = includeLongFormAlias
        ? ['主图', '详情页', '长图', '海报', 'banner', '横幅', '场景图', '宣传图', '首图', '封面', '落地页']
        : ['主图', '详情页', '海报', 'banner', '横幅', '场景图', '宣传图', '首图', '封面', '落地页'];
    return buildCrossCategoryTermPattern(
        ['mainImage', 'detailPage', 'poster', 'banner', 'generalArtifact'],
        { subset }
    );
}

/**
 * 控制面兼容层识别“明确创建一个设计成品”时使用的完整语义投影。
 *
 * 动词、距离和品类子集共同构成同一条兼容语义；由词条 Provider 统一编译后，
 * legacy control-plane 只消费具名判断数据，不再自行拼接七份动态正则。
 * 本函数只做识别，不授予 Skill 身份、Tool 权限或写入授权。
 */
export function buildExplicitCreativeDesignIntentPatterns(): RegExp[] {
    const targetTerms = buildCreativeArtifactTargetPattern();
    const targetTermsWithLongFormAlias = buildCreativeArtifactTargetPattern(true);
    return [
        new RegExp(`(从零|从0|从头|凭空).{0,16}(设计|做|画|创作|搭|创建|建立|生成|制作).{0,24}(${targetTermsWithLongFormAlias})`, 'i'),
        new RegExp(`(设计|做|画|创作|制作)\\s*(一张|一个|一版|一幅|个|张)?\\s*(${targetTerms})`, 'i'),
        new RegExp(`(完成|交付|产出).{0,48}(${targetTermsWithLongFormAlias})`, 'i'),
        new RegExp(`可验收.{0,36}(${targetTermsWithLongFormAlias})`, 'i'),
        new RegExp(`(${targetTermsWithLongFormAlias}).{0,24}(可验收|完成|交付|产出)`, 'i'),
        new RegExp(`(新建|创建|做|制作|生成|搭建|建立).{0,24}(${targetTerms}).{0,18}(草稿|画布|版面|视觉|设计稿)`, 'i'),
        new RegExp(`(${targetTerms}).{0,18}(草稿|画布|版面|视觉|设计稿)`, 'i')
    ];
}

/**
 * Completion 层识别“要求产出一个设计成品”的目标集合。
 * SKU 色卡、组合、规格与批量出图同样属于生产型交付；这里只负责识别完成契约范围，
 * 不授予 Skill 身份、Tool 权限或写入授权。
 */
export function buildCreativeCompletionArtifactTargetPattern(): string {
    return buildCrossCategoryTermPattern(
        ['mainImage', 'detailPage', 'poster', 'banner', 'generalArtifact', 'sku'],
        {
            subset: [
                '主图', '详情页', '海报', 'banner', '横幅', '场景图', '宣传图', '首图', '封面', '落地页',
                'SKU', 'sku', '色卡', '组合图', '规格图', '自选备注', '批量出图', '批量配色'
            ]
        }
    );
}

/** 兼容规划层的 SKU 信号子集；只识别，不授予任务身份或执行权限。 */
export function buildPlanningSkuSignalPattern(): string {
    return buildCategoryTermPattern('sku', {
        subset: ['sku', 'SKU', '自选备注', '组合图', '双装', '单双装']
    });
}

/** 兼容规划层的电商长页信号子集；只识别，不替代结构化 Task Profile。 */
export function buildPlanningLongFormSignalPattern(): string {
    return buildCategoryTermPattern('detailPage', {
        subset: ['详情页', '详情长图', '长详情', '长图']
    });
}

/** 兼容规划层的首屏商品视觉信号子集。 */
export function buildPlanningPrimaryVisualSignalPattern(): string {
    return buildCategoryTermPattern('mainImage', {
        subset: ['主图', '白底图', '白底', '点击图', '转化图']
    });
}

/** 兼容规划层的白底交付信号子集。 */
export function buildPlanningWhiteBackgroundSignalPattern(): string {
    return buildCategoryTermPattern('mainImage', {
        subset: ['白底图', '白底']
    });
}

/** 兼容规划层的通用视觉成品集合，整体包裹以保持正则拼接优先级。 */
export function buildPlanningGeneralArtifactPattern(): string {
    return buildCrossCategoryTermPattern(
        ['poster', 'banner', 'generalArtifact'],
        { wrap: true }
    );
}
