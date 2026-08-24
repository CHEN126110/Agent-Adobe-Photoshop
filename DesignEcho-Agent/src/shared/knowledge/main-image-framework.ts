/**
 * 电商主图设计结构化框架（知识模块）
 *
 * 来源：用户方法论（docs/main-image-design-framework.md，权威）。
 * 消费方式：getMainImageDesignFramework 知识工具按需检索；
 * 角色提示可注入精简摘要。知识只作为上下文与评审依据，不直接授权写入，
 * 也不允许把本模块内容硬编码进 Agent 运行时分支。
 */

export type MainImageFrameworkFocus = 'overview' | 'click' | 'conversion' | 'selling-points' | 'review';

const OVERVIEW = [
    '主图 = 点击图 + 转化图。点击图负责吸引（解决"为什么点"，目标点击率）；转化图负责说服（解决"为什么买"，目标转化率）。',
    '设计判断需要同时考虑产品、用户、出现位置、真实素材、差异化与可信证据；这些是需要回答的问题，不是固定执行顺序。',
    '点击与转化可以依靠摄影、构图、色彩、文字、对比、场景或信任中的不同组合完成，不要求每稿把所有元素填满。'
].join('\n');

const CLICK_IMAGE = [
    '点击图核心任务：在用户快速滑动时给出一个明确点击理由。',
    '设计公式：点击图 = 产品主体 + 一个核心钩子 + 一个差异点 + 适度信任。具体钩子、差异点与信任信息必须来自当前项目事实、真实素材观察或用户确认；方法论中的品类案例不能直接改写成当前商品文案。',
    '内容组成：图片管产品识别与质感场景，文案管点击理由，元素管卖点强化与视线引导。',
    '判断要点：用户场景（搜索/推荐流/货架页）、用户兴趣（价格/颜值/功能/痛点/场景/稀缺感）、与竞品相比的点击理由、一眼能否看懂卖什么、画面识别度与对比。',
    '选图不能只比较“是否清楚、是否好放、是否一次展示更多颜色”。当项目同时有产品平铺、动作场景、功能细节和变体体系时，应比较哪种素材关系最能形成当前点击理由；最安全的集合图只完成品类识别时，仍然是目录图，不自动等于点击图。',
    // 2026-08-23 实证（H3 普查：人做的成品 PSD 零调整层、光影全部来自摄影本身；对照盲评中场景摄影稿全面胜出平铺稿）
    '主视觉素材优先级：真人穿着 / 使用场景的摄影图自带光影、质感与场景带入，通常比平铺静物更能形成点击理由；画面的光影氛围应优先来自摄影本身，而不是后期特效。项目里有场景 / 模特摄影时先认真比较它们，平铺图更适合变体展示或辅助位；带吊牌、未整理的原始素材不能直接当主视觉。',
    '版式判断：先确认本稿最重要的识别对象和点击理由，再决定主体尺度、信息量、层级手段、留白、叠压与对比。主体不一定永远最大，文字也不必永远避开主体；选择必须与真实画面、可读性和传播目的相符。',
    '首稿做法：用 composeDesign 执行 Agent 已完成的设计声明。Agent 负责素材选择、鲜明角度、信息层级、regions、model_authored 视觉样式、栅格档位和语义图层组名；Harness 只负责素材处理、坐标换算、图层排序、安全校验和写后读回。',
    '微调时先读取真实主体框和当前画面，再按本稿目标调整。不要套固定字号比例、主体占比或“文字永不叠压”的统一答案；叠压可行时要保证识别、对比与遮挡关系可解释。',
    '错误做法：不了解主体与素材就落字；把未经确认的卖点写成事实；因为有一个历史模板就重复同一构图。'
].join('\n');

const CONVERSION_IMAGE = [
    '转化图核心任务：让已点进来的用户相信产品值得买。',
    '设计公式：转化图 = 痛点 + 解决方案 + 卖点说明 + 场景展示 + 信任背书（用户问题 → 产品卖点 → 事实说明 → 使用场景 → 下单理由）。',
    '需求层级（由低到高思考）：功能（能不能用）→ 安全（靠不靠谱）→ 便捷（方不方便）→ 舒适（用着舒服吗）→ 审美（好不好看）→ 情绪/身份（符合我想要的状态吗）。',
    '内容结构由用户疑问、素材证据与页面位置决定。痛点、核心卖点、产品事实、体验、场景、信任和购买理由是候选内容，不是固定七张顺序，也不要求全部出现。',
    '判断要点：用户需求、过去踩过的坑（痛点）、犹豫原因（顾虑）、产品如何解决、卖点的事实依据、隐性需求、与竞品差异。',
    '错误做法：卖点堆砌、没有事实支持。'
].join('\n');

const SELLING_POINTS = [
    '有效卖点 = 产品优势 + 用户在意 + 竞品不突出。产品有但用户不关心，不算强卖点；竞品都有，不能作为核心差异化。',
    '提炼六问：产品有什么（材质/结构/功能/工艺/颜色/款式）？用户在意什么（体验/审美/价格/耐用/安全/便利）？用户担心哪些可验证的失败、体验风险或使用成本？竞品在强调什么？我们怎么更具体、更真实、更有画面感？这个卖点能否用图片/对比/特写视觉化？',
    '点击图只抓一个核心卖点；转化图多卖点分层展开。'
].join('\n');

const REVIEW_CHECKLIST = [
    '点击图检查：用户能不能一眼看懂卖什么？有没有一个明确点击理由？画面有没有对比和吸引力？文案是否短而有力？产品是否足够突出？',
    '首稿检查：这张图是否利用了当前产品或素材独有的机会？如果把商品和标题替换后版式仍完全成立，说明它可能只是安全排版，还需要比较参考、替代素材或独立批评后再决定是否完成。',
    '转化图检查：有没有解决用户需求？有没有讲清楚用户痛点？卖点是否有事实支持？有没有体现差异化？有没有降低用户下单顾虑？',
    '两者区别速查：点击图信息量少/文案短强直接/视觉抢注意力/只抓一个核心点；转化图信息量多/文案有逻辑有证明/视觉建立信任/多卖点分层。'
].join('\n');

export const MAIN_IMAGE_FRAMEWORK_SECTIONS: Record<MainImageFrameworkFocus, { title: string; content: string }> = {
    overview: { title: '主图总定义与分析流程', content: OVERVIEW },
    click: { title: '点击图结构与版式原则', content: CLICK_IMAGE },
    conversion: { title: '转化图结构与内容顺序', content: CONVERSION_IMAGE },
    'selling-points': { title: '卖点提炼结构', content: SELLING_POINTS },
    review: { title: '主图评审检查标准', content: REVIEW_CHECKLIST }
};

/**
 * 按焦点取主图框架内容；不传焦点返回全量（带小标题）。
 */
export function buildMainImageFrameworkSummary(focus?: MainImageFrameworkFocus | 'all'): string {
    if (focus && focus !== 'all' && MAIN_IMAGE_FRAMEWORK_SECTIONS[focus]) {
        const section = MAIN_IMAGE_FRAMEWORK_SECTIONS[focus];
        return `## ${section.title}\n${section.content}`;
    }
    return (Object.keys(MAIN_IMAGE_FRAMEWORK_SECTIONS) as MainImageFrameworkFocus[])
        .map((key) => `## ${MAIN_IMAGE_FRAMEWORK_SECTIONS[key].title}\n${MAIN_IMAGE_FRAMEWORK_SECTIONS[key].content}`)
        .join('\n\n');
}

export const MAIN_IMAGE_FRAMEWORK_FOCUS_VALUES: Array<MainImageFrameworkFocus | 'all'> = [
    'all', 'overview', 'click', 'conversion', 'selling-points', 'review'
];
