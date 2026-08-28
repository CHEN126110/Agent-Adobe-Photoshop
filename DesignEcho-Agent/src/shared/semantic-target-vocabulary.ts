/**
 * 语义抠图的目标词规范化（纯逻辑，主/渲染进程共用）
 *
 * 背景：开放词汇检测器（GroundingDINO）的文本骨干是英文 BERT，中文会被切成 [UNK]
 * （实测"袜子"→ [101, 100, 1816, 102]），语义直接丢失，所以必须先转成英文短语。
 *
 * 设计原则：**全程本地，不调用任何语言模型**。
 * 抠图是本地能力，把它挂到云端模型上会带来三种它本不该有的失败：网络不可达、
 * 模型额度耗尽、模型答非所问（真机：翻译"袜子、鞋子"时 deepseek 调用失败，
 * 整条抠图链路随之中断）。
 *
 * 解析分三层，逐层放宽，但绝不猜：
 * 1. 按分隔符拆成多个目标——检测器原生支持多短语，"袜子、鞋子"本就该是两个目标；
 * 2. 每个目标先整体查词表，再尝试「修饰词 + 主体词」组合（"白色袜子" → white sock）；
 * 3. 仍无法确定的，如实报未解析，并提示改用英文——绝不用子串近似去猜，
 *    因为猜错的代价是默默抠错东西，比直接失败更糟。
 */

export type TargetPhraseSource = 'direct' | 'mapped' | 'partial' | 'unresolved';

export interface ResolvedTargetPhrases {
    /** 用户实际点名的目标片段；用于核对是否全部进入检测。 */
    requested: string[];
    /** 送给检测器的英文短语，可能多个 */
    phrases: string[];
    /** 无法解析的原始片段，用于给出可操作的提示 */
    unresolved: string[];
    /** 存在多个合理视觉含义、不能由本地词表替用户决定的原始片段。 */
    ambiguous: string[];
    /** 能解析但超过单次检测上限、因此没有进入检测的原始片段。 */
    omitted: string[];
    source: TargetPhraseSource;
    /** 用户原始输入，用于回显和日志 */
    original: string;
}

/**
 * 常见电商品类的中英映射。
 *
 * 值取检测器友好的通用名词：GroundingDINO 用短语提示，太长或太生僻的词会稀释注意力。
 * 一词多译时给最通用的那个（"包"→bag 而非 handbag，后者会漏掉双肩包）。
 */
const TARGET_NOUN_MAP: Record<string, string> = {
    // 鞋袜
    袜子: 'sock', 袜: 'sock', 短袜: 'sock', 船袜: 'sock', 中筒袜: 'sock',
    长筒袜: 'stocking', 丝袜: 'stocking', 连裤袜: 'pantyhose', 打底裤: 'leggings',
    鞋: 'shoe', 鞋子: 'shoe', 运动鞋: 'sneaker', 板鞋: 'sneaker', 帆布鞋: 'canvas shoe',
    皮鞋: 'leather shoe', 高跟鞋: 'high heel shoe', 平底单鞋: 'flat shoe', 高跟单鞋: 'high heel shoe',
    短靴: 'ankle boot', 长靴: 'boot', 拖鞋: 'slipper', 凉鞋: 'sandal', 鞋带: 'shoelace',
    鞋底: 'shoe sole',

    // 服饰
    衣服: 'clothing', 上衣: 'shirt', 衬衫: 'shirt', 短袖: 't-shirt', T恤: 't-shirt',
    t恤: 't-shirt', 外套: 'coat', 大衣: 'coat', 风衣: 'trench coat', 羽绒服: 'down jacket',
    棉服: 'padded jacket', 夹克: 'jacket', 西装: 'suit', 毛衣: 'sweater', 针织衫: 'knitwear',
    卫衣: 'hoodie', 马甲: 'vest', 背心: 'tank top',
    裤子: 'pants', 牛仔裤: 'jeans', 短裤: 'shorts', 西裤: 'trousers', 运动裤: 'sweatpants',
    裙子: 'skirt', 半身裙: 'skirt', 连衣裙: 'dress', 长裙: 'long skirt',
    内衣: 'underwear', 文胸: 'bra', 睡衣: 'pajamas', 泳衣: 'swimsuit',
    帽子: 'hat', 鸭舌帽: 'cap', 针织帽: 'beanie', 围巾: 'scarf', 手套: 'glove',
    腰带: 'belt', 皮带: 'belt', 领带: 'tie', 领结: 'bow tie',

    // 箱包配饰
    包: 'bag', 包包: 'bag', 手提包: 'handbag', 单肩包: 'shoulder bag', 背包: 'backpack',
    双肩包: 'backpack', 斜挎包: 'crossbody bag', 钱包: 'wallet', 卡包: 'card holder',
    行李箱: 'suitcase', 手表: 'watch', 眼镜: 'glasses', 墨镜: 'sunglasses',
    项链: 'necklace', 戒指: 'ring', 耳环: 'earring', 手链: 'bracelet', 发夹: 'hair clip',

    // 人与身体
    人: 'person', 模特: 'person', 人物: 'person', 脸: 'face', 头发: 'hair',
    手: 'hand', 手臂: 'arm', 腿: 'leg', 脚: 'foot', 手指: 'finger',

    // 常见商品与道具
    瓶子: 'bottle', 杯子: 'cup', 马克杯: 'mug', 盒子: 'box', 包装盒: 'box',
    罐子: 'jar', 碗: 'bowl', 盘子: 'plate', 勺子: 'spoon', 叉子: 'fork',
    椅子: 'chair', 沙发: 'couch', 桌子: 'table', 床: 'bed', 枕头: 'pillow',
    植物: 'plant', 花: 'flower', 树: 'tree', 叶子: 'leaf',
    手机: 'cell phone', 电脑: 'laptop', 笔记本电脑: 'laptop', 纸质笔记本: 'notebook', 耳机: 'headphone',
    键盘: 'keyboard', 鼠标: 'mouse', 相机: 'camera', 书: 'book',
    玩具: 'toy', 娃娃: 'doll', 食物: 'food', 水果: 'fruit', 蛋糕: 'cake',
    吊牌: 'tag', 标签: 'label', logo: 'logo', 文字: 'text', 图案: 'pattern',
    箱子: 'box', 化妆品: 'cosmetics', 口红: 'lipstick', 香水: 'perfume'
};

/**
 * 修饰词：能与主体词组合成检测器认得的短语（"white sock"）。
 * 只收对视觉定位真正有帮助的（颜色、材质、位置），不收"高级""百搭"这类营销词——
 * 它们对检测毫无作用，只会稀释注意力。
 */
const TARGET_MODIFIER_MAP: Record<string, string> = {
    白色: 'white', 白: 'white', 黑色: 'black', 黑: 'black', 红色: 'red', 红: 'red',
    蓝色: 'blue', 蓝: 'blue', 绿色: 'green', 绿: 'green', 黄色: 'yellow', 黄: 'yellow',
    灰色: 'gray', 灰: 'gray', 粉色: 'pink', 粉: 'pink', 紫色: 'purple', 紫: 'purple',
    棕色: 'brown', 棕: 'brown', 橙色: 'orange', 米色: 'beige', 米白: 'off-white',
    银色: 'silver', 金色: 'golden',
    皮: 'leather', 皮质: 'leather', 真皮: 'leather', 棉: 'cotton', 纯棉: 'cotton',
    毛: 'wool', 羊毛: 'wool', 丝: 'silk', 牛仔: 'denim', 麻: 'linen',
    左: 'left', 左边: 'left', 左侧: 'left', 右: 'right', 右边: 'right', 右侧: 'right'
};

/**
 * 没有上下文时存在多个常见视觉含义的词。
 *
 * 这些词不能为了“命中率”硬映射成一个英文概念；错误地抠出另一类物体比明确要求
 * 用户/Agent 给出更具体名称更糟。这里记录的是歧义说明，不是扩张业务分类器。
 */
const AMBIGUOUS_TARGET_MAP: Record<string, string> = {
    笔记本: '可能指笔记本电脑，也可能指纸质笔记本',
    单鞋: '可能指平底鞋，也可能指有跟单鞋'
};

/** 目标之间的分隔符：中英文标点与顿号都算 */
const TARGET_SEPARATOR = /[、,，;；/|和跟与]+/;

/** 最多同时检测几个目标：短语越多，检测器分给每个的注意力越少 */
const MAX_TARGETS = 4;

/** 纯 ASCII（英文/数字/常见标点）判定：这类输入可直接送检测器 */
function isAsciiPhrase(text: string): boolean {
    return /^[\x20-\x7E]+$/.test(text);
}

/** 剥掉不影响视觉定位的赘词，让"一只袜子"能命中"袜子" */
function stripFillers(text: string): string {
    return text
        .replace(/^(那个|这个|那只|这只|一只|一个|一双|一条|一件|的)/, '')
        .replace(/(的)$/, '')
        .trim();
}

function findAmbiguityDescription(raw: string): string | null {
    const text = stripFillers(raw.trim());
    if (!text) return null;
    if (AMBIGUOUS_TARGET_MAP[text]) return AMBIGUOUS_TARGET_MAP[text];

    const modifiers = Object.keys(TARGET_MODIFIER_MAP).sort((a, b) => b.length - a.length);
    for (const modifier of modifiers) {
        if (!text.startsWith(modifier)) continue;
        const rest = stripFillers(text.slice(modifier.length));
        if (AMBIGUOUS_TARGET_MAP[rest]) return AMBIGUOUS_TARGET_MAP[rest];
    }
    return null;
}

/**
 * 解析单个目标片段。
 *
 * 先整体查词表；不中再尝试「修饰词 + 主体词」；仍不中则返回 null——
 * 不做子串近似匹配（"长筒袜"含"袜"但语义不同，猜错会默默抠错东西）。
 */
function resolveSingleTarget(raw: string): string | null {
    const text = stripFillers(raw.trim());
    if (!text) return null;

    if (isAsciiPhrase(text)) return text.toLowerCase();

    const direct = TARGET_NOUN_MAP[text] || TARGET_NOUN_MAP[text.toLowerCase()];
    if (direct) return direct;

    // 修饰词 + 主体词：按修饰词长度从长到短试，避免"米白"被"米"抢先匹配
    const modifiers = Object.keys(TARGET_MODIFIER_MAP).sort((a, b) => b.length - a.length);
    for (const modifier of modifiers) {
        if (!text.startsWith(modifier)) continue;
        const rest = stripFillers(text.slice(modifier.length));
        if (!rest) continue;
        const noun = TARGET_NOUN_MAP[rest];
        if (noun) return `${TARGET_MODIFIER_MAP[modifier]} ${noun}`;
    }

    return null;
}

/**
 * 把用户输入的目标词解析成检测器可用的英文短语。
 *
 * 全程本地：命中即用，不中就如实说不认识，不调用任何语言模型。
 */
export function resolveTargetPhrases(input: string): ResolvedTargetPhrases {
    const original = String(input || '').trim();
    if (!original) {
        return {
            requested: [],
            phrases: [],
            unresolved: [],
            ambiguous: [],
            omitted: [],
            source: 'unresolved',
            original
        };
    }

    // 纯英文输入整体直通：里面的空格是短语的一部分（"red hand bag"），不能当分隔符
    if (isAsciiPhrase(original)) {
        const parts = original.split(TARGET_SEPARATOR).map(p => p.trim()).filter(Boolean);
        const uniqueParts = parts.filter((part, index) => parts.indexOf(part) === index);
        const accepted = uniqueParts.slice(0, MAX_TARGETS);
        const omitted = uniqueParts.slice(MAX_TARGETS);
        return {
            requested: parts,
            phrases: accepted.map(p => p.toLowerCase()),
            unresolved: [],
            ambiguous: [],
            omitted,
            source: omitted.length > 0 ? 'partial' : 'direct',
            original
        };
    }

    const segments = original.split(TARGET_SEPARATOR).map(s => s.trim()).filter(Boolean);
    const resolvedTargets: Array<{ raw: string; phrase: string }> = [];
    const unresolved: string[] = [];
    const ambiguous: string[] = [];

    for (const segment of segments) {
        if (findAmbiguityDescription(segment)) {
            ambiguous.push(segment);
            // 仍纳入 unresolved 计数，使既有生命周期在检测前 fail closed。
            unresolved.push(segment);
            continue;
        }
        const resolved = resolveSingleTarget(segment);
        if (resolved) {
            if (!resolvedTargets.some((target) => target.phrase === resolved)) {
                resolvedTargets.push({ raw: segment, phrase: resolved });
            }
        } else {
            unresolved.push(segment);
        }
    }

    if (resolvedTargets.length === 0) {
        return {
            requested: segments,
            phrases: [],
            unresolved,
            ambiguous,
            omitted: [],
            source: 'unresolved',
            original
        };
    }

    const acceptedTargets = resolvedTargets.slice(0, MAX_TARGETS);
    const omitted = resolvedTargets.slice(MAX_TARGETS).map((target) => target.raw);

    return {
        requested: segments,
        phrases: acceptedTargets.map((target) => target.phrase),
        unresolved,
        ambiguous,
        omitted,
        source: unresolved.length > 0 || omitted.length > 0 ? 'partial' : 'mapped',
        original
    };
}

/** 无法解析时给出可操作的提示，而不是笼统的"不支持" */
export function buildUnresolvedTargetHint(result: ResolvedTargetPhrases): string {
    const issues: string[] = [];
    const ambiguous = Array.isArray(result.ambiguous) ? result.ambiguous : [];
    for (const word of ambiguous) {
        const description = findAmbiguityDescription(word) || '存在多个常见含义';
        issues.push(`「${word}」${description}。请换成更具体的名称。`);
    }
    const unresolved = result.unresolved.filter(word => !ambiguous.includes(word));
    if (unresolved.length > 0) {
        const words = unresolved.map(w => `「${w}」`).join('、');
        issues.push(
            `暂时不认识${words}这个说法。`,
            '可以换成更通用的品类词，或直接使用英文（例如 sock、shoe、handbag、bottle）。'
        );
    }
    if (result.omitted.length > 0) {
        const words = result.omitted.map(w => `「${w}」`).join('、');
        issues.push(`一次最多处理 ${MAX_TARGETS} 种目标，${words}还没有进入本次处理；请拆成下一次请求。`);
    }
    if (issues.length === 0) {
        issues.push(`暂时无法把「${result.original}」转换成可定位的目标。`);
    }
    issues.push('本轮不会只处理其中一部分，也不会在没有完整目标清单时修改图层。');
    return issues.join('\n\n');
}
