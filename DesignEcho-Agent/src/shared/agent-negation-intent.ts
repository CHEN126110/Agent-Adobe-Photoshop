/**
 * 任务否定意图判定（纯逻辑，无 IO，可 smoke）。
 *
 * 为什么需要它：关键词路由匹配的是名词，不理解句子。真机 2026-07-31 实测——
 *   「先不要做sku」→ isSkuIntent=true → 路由 sku-batch → 又弹一次 SKU 组合卡
 *   「不用做sku了」→ 同上
 *   「sku做错了」（抱怨）→ 同上
 * 而「别做主图」「取消sku」碰巧返回 null，只是因为那几个词没命中品类正则，
 * 不是因为系统理解了否定。也就是说：否定处理不是一项能力，是一串巧合。
 *
 * 这类句子是关键词路由代价最大的失败面——做了用户明确说不要做的事。而正确处理它需要
 * 上下文（取消的是哪个挂起操作？上一轮任务？只是某个属性不要？），恰恰是模型擅长、
 * 正则做不到的。所以判据只回答一个窄问题：**这句话是不是在叫停一个任务**；
 * 是，就把这一轮让给模型理解，确定性路由不得直接选技能。
 *
 * 判据刻意做窄，宁可漏判也不误伤：
 *  - 否定词必须修饰「执行动词」（做/搞/生成/设计…），不是修饰对象。
 *    「把不要的图层删掉」「标题不要太大」不算叫停。
 *  - 撤销词后面直接跟图层操作对象时属于原子操作，不算叫停。
 *    「取消编组」「取消显示」不算，「取消sku」算。
 */

export const AGENT_NEGATION_INTENT_VERSION = 'agent-negation-intent/v0' as const;

export type AgentNegationIntentKind = 'negated_action' | 'cancel_request' | 'none';

export interface AgentNegationIntentVerdict {
    version: typeof AGENT_NEGATION_INTENT_VERSION;
    kind: AgentNegationIntentKind;
    /** 是否应当阻止确定性路由直接选技能（true = 本轮交给模型理解）。 */
    blocksDeterministicRoute: boolean;
    /** 命中的原文片段，用于诊断留痕；不做二次解释。 */
    matchedText?: string;
}

/**
 * 叫停一个任务时使用的执行动词。只收「产出/推进交付物」的动作，不收属性动词（用/改/换）。
 * 刻意不收单字「画」：它会命中「画面」「画布」，把「只读取分析不要修改画面」这类
 * 只读限定误判成叫停（真机 smoke 实测拦下过一次）。
 */
const EXECUTION_VERBS = '做|搞|弄|处理|生成|制作|设计|执行|继续|开始|动手|出图|排版|跑';

/**
 * 正向任务动词。用于区分「叫停整件事」与「做某事但别动某处」：
 * 否定片段之前若已经出现正向任务，那这个否定是限定条件，不是叫停，
 * 关键词路由应当照常工作（例：「只读取分析不要修改画面」仍要路由到只读分析）。
 */
const POSITIVE_TASK_VERBS = '做|搞|弄|生成|制作|设计|画|排版|导出|整理|分析|检查|读取|看看|看一下|帮我|处理|执行|创建|新建|新增|添加|加上|插入|置入|写|填|输入|说明|列出|找|搜索|修改|调整|替换';

/** 否定前缀。要求后面紧跟执行动词，避免把「不要的图层」这种形容词用法算进来。 */
const NEGATION_PREFIXES = '不要|不用|不必|无需|别|先别|先不要|先不|暂时不|暂不|不再|别再|不想|不打算';

/** 独立的撤销/中止表达。 */
const CANCEL_WORDS = '取消|停止|中止|终止|撤销|作废|算了|不做了|别做了|停下|打住';

/**
 * 撤销词后面紧跟这些对象时是 Photoshop 原子操作，不是叫停任务。
 * 「取消编组」「取消显示」「取消选择」必须继续走原有路由。
 */
const OPERATION_OBJECTS_AFTER_CANCEL = '编组|群组|分组|选择|选中|显示|隐藏|锁定|链接|蒙版|图层样式|填充|描边|裁剪|选区';

const NEGATED_ACTION_PATTERN = new RegExp(
    `(?:${NEGATION_PREFIXES})[^，,。！？!?；;\\n]{0,6}(?:${EXECUTION_VERBS})`
);

const CANCEL_PATTERN = new RegExp(`(?:${CANCEL_WORDS})`);

const CANCEL_OPERATION_PATTERN = new RegExp(
    `(?:${CANCEL_WORDS})\\s*(?:${OPERATION_OBJECTS_AFTER_CANCEL})`
);

const POSITIVE_TASK_PATTERN = new RegExp(`(?:${POSITIVE_TASK_VERBS})`);

/**
 * 叫停片段必须出现在句首附近才算叫停。
 *
 * 叫停指令天然开门见山——「先不要做sku」「算了」「取消sku」，否定词就在最前面，
 * 前面至多是「好的」「那」这类承接词。反过来，出现在句子中后段的否定几乎都是限定：
 *   「请在当前文档新增标题…并停止；不要新建文档」——主任务在前，否定只约束边界
 *   「只读取分析不要修改画面」——同上
 *
 * 这条位置判据比「前面有没有正向动词」稳健：后者依赖动词表完整性，表永远补不全，
 * 真机就漏过「新增/说明」而误伤了一条正常请求。位置判据不依赖词表。
 * 越界的情况再用正向动词兜一层，双保险；宁可漏判（退回现状）也不误伤（拦住正常请求）。
 */
const STOP_INSTRUCTION_HEAD_LIMIT = 6;

function isStopInstructionAtHead(text: string, matchIndex: number): boolean {
    if (matchIndex <= STOP_INSTRUCTION_HEAD_LIMIT) return true;
    return !POSITIVE_TASK_PATTERN.test(text.slice(0, matchIndex));
}

function normalize(value: unknown): string {
    return String(value || '').replace(/\s+/g, '').trim();
}

function matchText(pattern: RegExp, text: string): string | undefined {
    const matched = text.match(pattern);
    return matched ? matched[0] : undefined;
}

function noneVerdict(): AgentNegationIntentVerdict {
    return {
        version: AGENT_NEGATION_INTENT_VERSION,
        kind: 'none',
        blocksDeterministicRoute: false
    };
}

/**
 * 判定用户这句话是不是在叫停一个任务。
 * 命中即要求本轮交给模型理解——不解释用户想改成什么，那是模型的活。
 */
export function resolveAgentNegationIntent(userInput: unknown): AgentNegationIntentVerdict {
    const text = normalize(userInput);
    if (!text) return noneVerdict();

    const negatedActionMatch = text.match(NEGATED_ACTION_PATTERN);
    if (negatedActionMatch && isStopInstructionAtHead(text, negatedActionMatch.index ?? 0)) {
        return {
            version: AGENT_NEGATION_INTENT_VERSION,
            kind: 'negated_action',
            blocksDeterministicRoute: true,
            matchedText: negatedActionMatch[0]
        };
    }

    // 撤销词命中，但整句只是「取消编组」这类原子操作时不算叫停任务。
    const cancelMatch = text.match(CANCEL_PATTERN);
    if (
        cancelMatch
        && !CANCEL_OPERATION_PATTERN.test(text)
        && isStopInstructionAtHead(text, cancelMatch.index ?? 0)
    ) {
        return {
            version: AGENT_NEGATION_INTENT_VERSION,
            kind: 'cancel_request',
            blocksDeterministicRoute: true,
            matchedText: cancelMatch[0]
        };
    }

    return noneVerdict();
}

/** 便捷判定：确定性路由是否必须让位给模型理解。 */
export function blocksDeterministicRouteByNegation(userInput: unknown): boolean {
    return resolveAgentNegationIntent(userInput).blocksDeterministicRoute;
}
