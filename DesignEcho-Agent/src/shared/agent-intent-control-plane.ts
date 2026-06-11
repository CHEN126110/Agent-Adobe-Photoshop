import { findSkillRoutingIntent } from './skill-routing';

export type AgentIntentControlPlaneVersion = 'agent-intent-control-plane/v0';

export type AgentIntentRequestKind =
    | 'chat_only'
    | 'plan_only'
    | 'clarify'
    | 'uxp_user_tool_only'
    | 'read_only_inspect'
    | 'execute_skill'
    | 'autonomous_execution';

export type AgentIntentToolScope =
    | 'none'
    | 'read_only'
    | 'write_photoshop';

export interface BuildAgentIntentControlPlaneInput {
    userInput: unknown;
    hasImageInput?: boolean;
    hasDocument?: boolean;
    photoshopConnected?: boolean;
}

export interface AgentIntentControlPlaneDecision {
    version: AgentIntentControlPlaneVersion;
    requestKind: AgentIntentRequestKind;
    toolScope: AgentIntentToolScope;
    shouldUseConversationalPath: boolean;
    allowsDeterministicRoute: boolean;
    allowsRouterModel: boolean;
    allowsAutonomousFallback: boolean;
    requiresClarificationBeforeTools: boolean;
    reason: string;
    userVisibleSummary: string;
    matchedSignals: string[];
}

const CASUAL_SUFFIX_PATTERN = '[\\s!！?？,，.。~～]*$';
const GREETING_PATTERN = new RegExp(`^(你好|您好|hello|hi|hey|在吗|在不在)(啊|呀|哈|呢|哦|喔|啦|哟|阿)*${CASUAL_SUFFIX_PATTERN}`, 'i');
const THANKS_PATTERN = new RegExp(`^(谢谢|感谢|thanks|thank you|thx)(啊|呀|哈|呢|哦|喔|啦)*${CASUAL_SUFFIX_PATTERN}`, 'i');
const ACK_PATTERN = new RegExp(`^(好的|好|ok|收到|明白|可以)(啊|呀|哈|呢|哦|喔|啦)*${CASUAL_SUFFIX_PATTERN}`, 'i');
const FOLLOW_UP_QUESTION_PATTERN = /^(我)?\s*(还有|有|再问|想问).{0,8}(问题|个问题)[\s!！?？,，.。~～]*$/i;

const CHAT_QUESTION_PATTERNS = [
    /你是(谁|什么模型|做什么的)/i,
    /你(都)?(可以|能)(帮我|为我)?做什么|你(都)?会做什么|支持什么|有哪些能力/i,
    /为什么|怎么理解|是什么|有哪些|聊聊|如何看/i,
    /SKU\s*是什么|sku\s*是什么/i
];

const BUSINESS_SKILL_CAPABILITY_TARGET_PATTERN = '(?:sku|主图|详情页|长图|自选备注|备注图|组合图|白底图|点击图|转化图)';
const SKILL_CAPABILITY_QUESTION_PATTERNS = [
    new RegExp(`(?:我问你|我想问|问一下|请问).{0,12}(?:你|agent|智能体|模型)?\\s*(?:会不会|会|能不能|能否|可不可以|可以不可以|可以|能|支持|支不支持|支持不支持)\\s*(?:帮我|给我|为我)?\\s*(?:做|生成|制作|设计|出|处理)?\\s*${BUSINESS_SKILL_CAPABILITY_TARGET_PATTERN}(?:.{0,8}(?:吗|嘛|么|\\?|？))?`, 'i'),
    new RegExp(`(?:你|agent|智能体|模型)?\\s*(?:会不会|能不能|能否|可不可以|可以不可以|支不支持|支持不支持)\\s*(?:帮我|给我|为我)?\\s*(?:做|生成|制作|设计|出|处理)?\\s*${BUSINESS_SKILL_CAPABILITY_TARGET_PATTERN}(?:.{0,8}(?:吗|嘛|么|\\?|？))?`, 'i'),
    new RegExp(`(?:你|agent|智能体|模型)?\\s*(?:会|可以|能|支持)\\s*(?:帮我|给我|为我)?\\s*(?:做|生成|制作|设计|出|处理)?\\s*${BUSINESS_SKILL_CAPABILITY_TARGET_PATTERN}.{0,8}(?:吗|嘛|么|\\?|？)`, 'i'),
    new RegExp(`${BUSINESS_SKILL_CAPABILITY_TARGET_PATTERN}.{0,8}(?:你|agent|智能体|模型)?\\s*(?:会不会|会|能不能|能否|可不可以|可以不可以|可以|能|支持|支不支持|支持不支持)\\s*(?:做|生成|制作|设计|出|处理)?(?:.{0,8}(?:吗|嘛|么|\\?|？))?`, 'i')
];

const PLAN_ONLY_PATTERNS = [
    /(是否|能不能|能否|可不可以|可以不可以|可以).{0,18}(开始|推进|做|进入|执行)/i,
    /(开始|推进|做|进入|执行).{0,18}(是否|能不能|能否|可不可以|可以吗)/i,
    /(还差|还缺|还剩|剩余|距离|离).{0,24}(什么|哪些|多少|问题|完成)/i,
    /(什么|哪些|多少|问题).{0,24}(还差|还缺|还剩|剩余)/i,
    /(最佳实践|怎么处理|怎么做|怎么推进|怎么规划|怎么安排|如何处理|如何推进|如何规划|是否应该)/i,
    /(系统|架构|方案|规划|计划|路线|阶段|进度).{0,24}(准备|考虑|怎么|如何|哪些|什么|是否|能否)/i,
    /(当前|这个|项目|agent|意图|主图|详情页|sku).{0,24}(完成了吗|算完成|完成了没|还剩|剩余|进度|百分之几|多少没有完成|还需要做哪些|还需要做什么|下一步|下一项)/i
];

const READ_ONLY_INSPECT_PATTERNS = [
    /(看看|看一下|检查|检查一下|验收|复核|分析|识别|理解).{0,20}(当前文档|这个文档|文档结构|详情页结构|模板结构|项目中的图片|项目图片|图片|图层|颜色图层|隐藏图层)/i,
    /(当前文档|这个文档|文档结构|详情页结构|模板结构|图层|颜色图层|隐藏图层|项目图片|项目中的图片).{0,20}(看看|检查|验收|复核|分析|识别|理解|有没有问题|是否正常|能不能用|可不可用|哪里不对|什么类型|是什么|有几个|多少个|几种|多少种)/i,
    /(看看|看一下|检查|检查一下|验收|复核|分析|识别|理解).{0,20}(当前|这个)?.{0,8}(项目|project).{0,20}(是什么|什么项目|项目类型|概况|概览|情况|信息|素材|图片|款式|品类|类目|风格|卖点|特征)?/i,
    /(当前|这个)?.{0,8}(项目|project).{0,20}(是什么|什么项目|项目类型|概况|概览|情况|信息|素材|图片|款式|品类|类目|风格|卖点|特征)/i,
    /(当前|这个).{0,8}(是什么|什么).{0,8}(项目|project)/i,
    /(几个|几种|多少个|多少种).{0,10}(图层|颜色|颜色图层)/i,
    /(隐藏|看不到).{0,12}图层|图层.{0,12}(隐藏|看不到)/i,
    /检查.{0,12}(结构|状态|问题|画面|版式)/i
];

const READ_ONLY_NEGATIVE_PATTERNS = [
    /(保存|另存|导出|关闭|新建|创建|制作|生成|加入|添加|放入|拖入|导入|删除|重命名|改名|置顶|置底|上移|下移|排序|调整|修改|替换|换成|改成)/i
];

const EXPLICIT_SKILL_EXECUTION_PATTERNS = [
    /(关闭|保存|另存|导出|新建|创建).{0,20}(文档|psd|png|jpg|jpeg|模板)/i,
    /(主图|详情页).{0,24}(模板|文档|制作|创建|新建|生成|导出|保存)/i,
    /(制作|创建|新建|生成|导出|保存).{0,24}(主图|详情页|模板|文档)/i,
    /sku|自选备注|批量配色|批量出图|组合图|双装|单双装/i,
    /(加|添加|加入|新增|创建|放入).{0,16}(字体|文字|文本|文案|备注)/i,
    /(字体|文字|文本|文案|备注).{0,16}(加|添加|加入|新增|创建|放入)/i,
    /(字体|文字|文本|文案).{0,16}(改成|改为|替换|换成|设置为|修改为)/i,
    /(改成|改为|替换|换成|设置为|修改为).{0,16}(字体|文字|文本|文案)/i,
    /(图层).{0,20}(顺序|层级|排序|置顶|置底|上移|下移|重命名|改名|删除|复制|拷贝|编组|解除编组|选中|选择)/i,
    /(选中|选择|重命名|改名|删除|复制|拷贝|编组|解除编组|置顶|置底|上移|下移).{0,18}(当前|选中|目标)?.{0,10}(图层|组|层)/i,
    /从浅到深|从深到浅/i,
    /(参考图|照着|复刻|复现|还原|仿照|同款版式|copy layout|same layout|replicate|recreate)/i,
    /(调试|排查|诊断|定位问题|复现|联调).{0,24}(agent|面板|桥接|mcp|详情页|主图|工具)/i
];

const UXP_USER_TOOL_ONLY_PATTERNS = [
    /(抠图|去背|去背景|remove background|matte)/i
];

const RETRY_EXECUTION_PATTERN = /(再改一下|重新改|没改成功|没有改成功|没有改|没生效|重试|再做一下)/i;

const OPEN_AUTONOMOUS_EXECUTION_PATTERNS = [
    /(根据|基于|按).{0,16}(当前画面|这个画面|画面|当前文档|参考|素材).{0,24}(设计|整理|优化|调整|重做|做一版|出一版|更高级|更好看|提升)/i,
    /(把|将).{0,16}(当前画面|这个画面|画面|当前文档).{0,24}(整理|优化|调整|设计|重做).{0,24}(高级|好看|视觉重点|质感|商业|电商)/i,
    /(做|出).{0,8}(一版|一个).{0,24}(更高级|更好看|商业感|电商感|设计|视觉)/i
];

const AMBIGUOUS_ACTION_PATTERNS = [
    /^(帮我|请|麻烦你)?\s*(处理|弄|搞|优化|调整|改|做|整理)(一下|下)?[\s!！?？,，.。~～]*$/i,
    /^(帮我|请|麻烦你)?\s*(处理|弄|搞|优化|调整|改|做|整理)(一下|下)?.{0,12}(这个|这里|图层|画面|它)[\s!！?？,，.。~～]*$/i,
    /(改好看一点|弄好看一点|处理一下这个图层|把这里改好看一点)/i
];

const CONTROL_PLANE_SKILL_ROUTING_EXCLUDES = [
    'matte-product',
    'autonomous-agent'
];

function normalizeText(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function includesAny(input: string, patterns: RegExp[]): boolean {
    return patterns.some((pattern) => pattern.test(input));
}

function isReadOnlyInspectRequest(input: string): boolean {
    return includesAny(input, READ_ONLY_INSPECT_PATTERNS) && !includesAny(input, READ_ONLY_NEGATIVE_PATTERNS);
}

function findControlledSkillRoutingIntent(input: string) {
    return findSkillRoutingIntent(input, {
        excludeSkillIds: CONTROL_PLANE_SKILL_ROUTING_EXCLUDES,
        includeVisibilities: ['user-facing', 'internal-debug']
    });
}

export function isAgentSkillCapabilityQuestion(value: unknown): boolean {
    const text = normalizeText(value);
    if (!text) return false;
    if (!/[?？吗嘛么]|会不会|能不能|能否|可不可以|可以不可以|支不支持|支持不支持|我问你|我想问|问一下|请问/.test(text)) {
        return false;
    }
    return includesAny(text, SKILL_CAPABILITY_QUESTION_PATTERNS);
}

function makeDecision(
    requestKind: AgentIntentRequestKind,
    input: {
        reason: string;
        userVisibleSummary: string;
        matchedSignals: string[];
    }
): AgentIntentControlPlaneDecision {
    const toolScope: AgentIntentToolScope = requestKind === 'read_only_inspect'
        ? 'read_only'
        : requestKind === 'execute_skill' || requestKind === 'autonomous_execution'
            ? 'write_photoshop'
            : 'none';

    return {
        version: 'agent-intent-control-plane/v0',
        requestKind,
        toolScope,
        shouldUseConversationalPath: requestKind === 'chat_only' || requestKind === 'plan_only',
        allowsDeterministicRoute: requestKind === 'read_only_inspect'
            || requestKind === 'execute_skill'
            || requestKind === 'autonomous_execution',
        allowsRouterModel: requestKind === 'read_only_inspect'
            || requestKind === 'execute_skill'
            || requestKind === 'autonomous_execution',
        allowsAutonomousFallback: requestKind === 'autonomous_execution',
        requiresClarificationBeforeTools: requestKind === 'clarify',
        reason: input.reason,
        userVisibleSummary: input.userVisibleSummary,
        matchedSignals: input.matchedSignals
    };
}

export function buildAgentIntentControlPlaneDecision(
    input: BuildAgentIntentControlPlaneInput
): AgentIntentControlPlaneDecision {
    const text = normalizeText(input.userInput);
    const normalized = text.toLowerCase();

    if (!normalized) {
        return makeDecision('clarify', {
            reason: '用户输入为空，无法判断执行目标。',
            userVisibleSummary: '需要先明确你希望我处理什么。',
            matchedSignals: ['empty_input']
        });
    }

    if (GREETING_PATTERN.test(normalized) || THANKS_PATTERN.test(normalized) || ACK_PATTERN.test(normalized)) {
        return makeDecision('chat_only', {
            reason: '输入是寒暄、确认或感谢，不需要工具。',
            userVisibleSummary: '按对话模型处理，工具执行保持关闭。',
            matchedSignals: ['casual_conversation']
        });
    }

    if (FOLLOW_UP_QUESTION_PATTERN.test(normalized)) {
        return makeDecision('chat_only', {
            reason: '用户表示还有问题，这是继续提问的会话意图。',
            userVisibleSummary: '这是继续提问，不会触发 Photoshop 工具。',
            matchedSignals: ['follow_up_question']
        });
    }

    if (isAgentSkillCapabilityQuestion(text)) {
        return makeDecision('chat_only', {
            reason: '用户在询问 Agent 是否具备某个业务 skill 能力，不是在授权执行该 skill。',
            userVisibleSummary: '这是能力询问，不会触发 Photoshop 工具。',
            matchedSignals: ['skill_capability_question']
        });
    }

    if (includesAny(normalized, PLAN_ONLY_PATTERNS)) {
        return makeDecision('plan_only', {
            reason: '用户在询问进度、准备度、方案或剩余工作，不是执行指令。',
            userVisibleSummary: '这是规划或状态讨论，不会直接调用 Photoshop 工具。',
            matchedSignals: ['plan_or_status_question']
        });
    }

    if (isReadOnlyInspectRequest(normalized)) {
        return makeDecision('read_only_inspect', {
            reason: '用户要求查看、检查、理解或统计上下文，只允许只读检查。',
            userVisibleSummary: '这是只读检查请求，只允许读取上下文，不允许写入修改。',
            matchedSignals: ['read_only_inspection']
        });
    }

    if (includesAny(normalized, CHAT_QUESTION_PATTERNS)) {
        return makeDecision('chat_only', {
            reason: '用户在询问知识、能力或模型身份，不需要工具执行。',
            userVisibleSummary: '这是对话咨询，不会触发 Photoshop 工具。',
            matchedSignals: ['chat_question']
        });
    }

    if (includesAny(normalized, UXP_USER_TOOL_ONLY_PATTERNS)) {
        return makeDecision('uxp_user_tool_only', {
            reason: '抠图能力属于 UXP 面板用户工具，不向 Agent 对话端提供执行许可。',
            userVisibleSummary: '抠图属于 UXP 面板用户工具，Agent 不会调用该工具。',
            matchedSignals: ['uxp_user_tool_only']
        });
    }

    const skillRoutingIntent = findControlledSkillRoutingIntent(normalized);
    if (skillRoutingIntent) {
        return makeDecision('execute_skill', {
            reason: '用户输入命中了共享技能路由元数据，允许进入受控技能路由，由确定性路由或模型路由继续判断具体执行方式。',
            userVisibleSummary: '这是可路由的业务技能请求，可以进入受控技能路由。',
            matchedSignals: [`shared_skill_routing:${skillRoutingIntent.skillId}`]
        });
    }

    if (includesAny(normalized, AMBIGUOUS_ACTION_PATTERNS)) {
        return makeDecision('clarify', {
            reason: '用户表达了动作意愿，但缺少明确目标、动作边界或交付结果。',
            userVisibleSummary: '需要先明确目标、动作和交付要求，才能安全执行。',
            matchedSignals: ['ambiguous_action']
        });
    }

    if (RETRY_EXECUTION_PATTERN.test(normalized) || includesAny(normalized, EXPLICIT_SKILL_EXECUTION_PATTERNS)) {
        return makeDecision('execute_skill', {
            reason: '用户给出了明确业务能力、Photoshop 操作或可路由技能目标。',
            userVisibleSummary: '这是明确执行请求，可以进入受控技能路由。',
            matchedSignals: ['explicit_skill_execution']
        });
    }

    if (includesAny(normalized, OPEN_AUTONOMOUS_EXECUTION_PATTERNS)) {
        return makeDecision('autonomous_execution', {
            reason: '用户要求开放式设计处理，需要模型明确判断后才允许自主工具循环。',
            userVisibleSummary: '这是开放式设计执行请求，需要模型明确放行后才能进入工具循环。',
            matchedSignals: ['open_autonomous_execution']
        });
    }

    if (/[?？]/.test(normalized)) {
        return makeDecision('chat_only', {
            reason: '输入是问题形态，且没有命中可安全执行的 Photoshop 动作。',
            userVisibleSummary: '按对话模型处理，工具执行保持关闭。',
            matchedSignals: ['unrouted_question']
        });
    }

    if (/(帮我|请|需要|想让你|麻烦你|做|处理|生成|执行|修改|调整|优化|整理)/i.test(normalized)) {
        return makeDecision('clarify', {
            reason: '输入看起来像任务请求，但没有足够证据授权读写工具。',
            userVisibleSummary: '需要先明确目标和交付结果，不能默认执行工具。',
            matchedSignals: ['unrouted_task_like_input']
        });
    }

    return makeDecision('chat_only', {
        reason: '未命中执行、只读检查或自主设计许可，默认按对话处理。',
        userVisibleSummary: '按对话模型处理，工具执行保持关闭。',
        matchedSignals: ['default_chat']
    });
}

export function buildAgentIntentControlPlaneClarificationMessage(
    decision: AgentIntentControlPlaneDecision
): string {
    if (decision.requestKind === 'autonomous_execution') {
        return '这个请求属于开放式设计执行，但当前缺少模型明确放行或足够路由证据。需要先明确设计目标、允许修改的范围，以及是否基于当前 Photoshop 文档执行。';
    }

    return '需要先明确要处理的目标、具体动作和交付结果，然后我才能安全执行 Photoshop 工具。请补充：要处理哪个图层或画面、想达到什么效果、是否允许修改当前文档。';
}
