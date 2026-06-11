import { useAppStore } from '../../stores/app.store';
import { applySharedSkillParamDefaults } from '../../../shared/skill-param-defaults';
import {
    extractDocumentManagementRoutingParams,
    matchesSkillRoutingIntent,
    resolveSkillRoutingMode,
    normalizeSkillId as normalizeSharedSkillId
} from '../../../shared/skill-routing';
import {
    extractSkuComboSizesFromText,
    isSkuNoteOnlyText
} from '../../../shared/sku-intent-params';
import { extractEcommerceSocksDeliverables } from '../../../shared/ecommerce-socks-design';
import { getSkillById } from '../../../shared/skills/skill-declarations';
import {
    buildAgentIntentControlPlaneDecision,
    isAgentSkillCapabilityQuestion
} from '../../../shared/agent-intent-control-plane';
import type {
    AgentDecision,
    DeterministicSkillRoute,
    LightweightIntent
} from './types';

type DeterministicIntentMatch = {
    skillId: string;
    mode?: 'inspect' | 'execute';
    params?: Record<string, any>;
};

export interface DeterministicRouteOptions {
    hasAttachedImage?: boolean;
    detailPageTemplateDetected?: boolean;
    detailPageTemplateScreenCount?: number;
    detailPageTemplateIssueCodes?: string[];
}

const QUESTION_SAFE_DETERMINISTIC_SKILLS = new Set<string>([
    'document-management',
    'layer-management',
    'text-font-replace',
    'find-and-edit-element',
    'detail-page-template-authoring',
    'main-image-template-authoring',
    'save-current-template',
    'layout-replication'
]);

const CASUAL_SUFFIX_PATTERN = '[\\s!！?？,，.。~～]*$';
const GREETING_PATTERN = new RegExp(`^(\\u4f60\\u597d|\\u60a8\\u597d|hello|hi|hey|\\u5728\\u5417|\\u5728\\u4e0d\\u5728)(\\u554a|\\u5440|\\u54c8|\\u5462|\\u54e6|\\u5594|\\u5566|\\u54df|\\u963f)*${CASUAL_SUFFIX_PATTERN}`, 'i');
const THANKS_PATTERN = new RegExp(`^(\\u8c22\\u8c22|\\u611f\\u8c22|thanks|thank you|thx)(\\u554a|\\u5440|\\u54c8|\\u5462|\\u54e6|\\u5594|\\u5566)*${CASUAL_SUFFIX_PATTERN}`, 'i');
const ACK_PATTERN = new RegExp(`^(\\u597d\\u7684|\\u597d|ok|\\u6536\\u5230|\\u5f00\\u59cb|\\u53ef\\u4ee5)(\\u554a|\\u5440|\\u54c8|\\u5462|\\u54e6|\\u5594|\\u5566)*${CASUAL_SUFFIX_PATTERN}`, 'i');
const CONTINUATION_PATTERN = /^(好的|好|ok|收到|可以)?\s*(继续|接着|继续下一项|继续下一步|继续推进|按照计划继续|继续剩余|接着做|往下做|下一项|下一步)[\s!！?？,，.。~～]*$/i;
const SELF_INTRODUCTION_PATTERN = /(\u4f60\u662f\u8c01|\u4f60\u662f\u505a\u4ec0\u4e48|\u4ecb\u7ecd\u4e00\u4e0b\u4f60|\u4ecb\u7ecd\u4f60\u81ea\u5df1)/;
const CAPABILITY_QUESTION_PATTERN = /(\u4f60(\u90fd)?(\u53ef\u4ee5|\u80fd)(\u5e2e\u6211|\u4e3a\u6211)?\u505a\u4ec0\u4e48|\u4f60(\u90fd)?\u4f1a\u505a\u4ec0\u4e48|\u652f\u6301\u4ec0\u4e48|\u6709\u54ea\u4e9b\u80fd\u529b)/;
const ARCHITECTURE_DISCUSSION_PATTERN = /从.{0,12}(系统|架构|技术).{0,32}(准备|考虑|怎么|如何|哪些|什么)/i;
const GENERAL_CHAT_QUESTION_PATTERN = /(\?|\uff1f|\u4e3a\u4ec0\u4e48|\u600e\u4e48|\u5982\u4f55|\u804a\u804a|\u5728\u505a\u4ec0\u4e48|\u662f\u4ec0\u4e48|\u6709\u54ea\u4e9b|\u54ea\u4e9b|\u80fd\u4e0d\u80fd|\u80fd\u5426|\u53ef\u4ee5\u5417|\u4ece.{0,12}(\u7cfb\u7edf|\u67b6\u6784|\u6280\u672f).{0,24}(\u51c6\u5907|\u8003\u8651|\u600e\u4e48|\u5982\u4f55|\u54ea\u4e9b|\u4ec0\u4e48))/;
const PLAN_OR_DISCUSSION_QUESTION_PATTERN = /(\u662f\u5426|\u80fd\u4e0d\u80fd|\u80fd\u5426|\u53ef\u4e0d\u53ef\u4ee5|\u53ef\u4ee5\u4e0d\u53ef\u4ee5|\u53ef\u4ee5).{0,18}(\u5f00\u59cb|\u63a8\u8fdb|\u505a|\u8fdb\u5165|\u6267\u884c)|(\u5f00\u59cb|\u63a8\u8fdb|\u505a|\u8fdb\u5165|\u6267\u884c).{0,18}(\u662f\u5426|\u80fd\u4e0d\u80fd|\u80fd\u5426|\u53ef\u4e0d\u53ef\u4ee5|\u53ef\u4ee5\u5417)|(\u8fd8\u5dee|\u8fd8\u7f3a|\u8fd8\u5269|\u5269\u4f59|\u8ddd\u79bb).{0,24}(\u4ec0\u4e48|\u54ea\u4e9b|\u591a\u5c11|\u95ee\u9898)|(\u4ec0\u4e48|\u54ea\u4e9b|\u591a\u5c11|\u95ee\u9898).{0,24}(\u8fd8\u5dee|\u8fd8\u7f3a|\u8fd8\u5269|\u5269\u4f59)|(\u6700\u4f73\u5b9e\u8df5|\u600e\u4e48\u5904\u7406|\u600e\u4e48\u770b|\u5982\u4f55\u5904\u7406|\u662f\u4e0d\u662f|\u662f\u5426\u5e94\u8be5)/i;
const FOLLOW_UP_QUESTION_PATTERN = /^(\u6211)?\s*(\u8fd8\u6709|\u6709|再问|想问).{0,8}(\u95ee\u9898|\u4e2a\u95ee\u9898)[\s!！?？,，.。~～]*$/i;
const COLOR_LAYER_INSPECTION_PATTERN = /((几个|几种|多少个|多少种).{0,8}颜色|颜色图层)/i;
const LAYER_STATE_INSPECTION_PATTERN = /((几个|几种|多少个|多少种).{0,8}图层|隐藏.{0,12}图层|图层.{0,12}隐藏|看不到.{0,12}图层|图层.{0,12}看不到)/i;
const AMBIGUOUS_TEMPLATE_INSPECTION_PATTERNS = [
    /(?:看看|看一下|检查|检查一下|验收|复核|分析|识别).{0,16}(?:模板|结构|当前文档|这个文档|这个文件)/i,
    /(?:模板|结构|当前文档|这个文档|这个文件).{0,16}(?:有没有问题|是否正常|能不能用|可不可用|哪里不对|什么类型|是什么)/i,
    /(?:这个|当前).{0,8}(?:模板|文档|文件).{0,12}(?:看看|检查|验收|复核|分析|识别)/i
];
const TEMPLATE_INSPECTION_NEGATIVE_PATTERNS = [
    /(?:保存|另存|导出|关闭|新建|创建|制作|生成|加入|添加|放入|拖入|导入|删除|重命名|改名)/i,
    /(?:设计库|模板库|素材库)/i,
    /(?:sku|主图|抠图|去背|字体|图层顺序|置顶|置底)/i
];

const MATTE_PATTERNS = [/\u62a0\u56fe/i, /\u53bb\u80cc/i, /\u53bb\u80cc\u666f/i, /remove background/i, /matte/i];
const AGENT_MATTING_PAUSED_MESSAGE = '抠图能力当前暂不从 Agent 对话端执行；UXP 面板里的图像处理工具仍可保留给人工测试。';
const SKU_PATTERNS = [
    /sku/i,
    /\u6279\u91cf\u914d\u8272/i,
    /\u6279\u91cf\u51fa\u56fe/i,
    /\u7ec4\u5408\u56fe/i,
    /\u6279\u91cf\u751f\u6210/i,
    /\u81ea\u9009\u5907\u6ce8/i,
    /\u5907\u6ce8\u56fe/i,
    /\u53cc\u88c5/i,
    /\u5355\u53cc(?:\u88c5)?/i,
    /\u4e00\s*\u53cc(?:\u88c5)?/i
];
const ECOMMERCE_SOCKS_DESIGN_PATTERNS = [
    /电商.{0,8}袜子.{0,8}设计/i,
    /袜子.{0,8}电商.{0,8}设计/i,
    /(整套|全套|一套).{0,12}(袜子|袜).{0,12}(电商|主图|详情页|sku)/i,
    /(主图).{0,8}(详情页).{0,8}(sku)/i,
    /(主图).{0,8}(sku).{0,8}(详情页)/i,
    /(详情页).{0,8}(主图).{0,8}(sku)/i,
    /socks\s+ecommerce\s+design/i
];
const TEMPLATE_SAVE_PATTERNS = [/\u4fdd\u5b58.*\u6a21\u677f/i, /\u53e6\u5b58.*\u6a21\u677f/i, /\u52a0\u5165.*\u8bbe\u8ba1\u5e93/i, /\u5f53\u524d\u6587\u6863.*\u6a21\u677f/i, /save.*template/i, /template.*library/i];
const AGENT_PANEL_PATTERNS = [/agent\u9762\u677f/i, /\u667a\u80fd\u4f53\u9762\u677f/i, /\u6865\u63a5\u8c03\u8bd5/i, /mcp\u8c03\u8bd5/i, /\u8054\u8c03/i, /\u56de\u4f20/i];
const DEBUG_PATTERNS = [/\u8c03\u8bd5/i, /\u6392\u67e5/i, /\u8bca\u65ad/i, /\u5b9a\u4f4d\u95ee\u9898/i, /\u590d\u73b0/i, /\u8054\u8c03/i, /debug/i, /\u6d4b\u8bd5/i, /\u9a8c\u8bc1/i];
const DETAIL_TEMPLATE_AUTHORING_PATTERNS = [
    /\u65b0\u5efa.*\u8be6\u60c5\u9875.*\u6587\u6863/i,
    /\u521b\u5efa.*\u8be6\u60c5\u9875.*\u6587\u6863/i,
    /(\u5236\u4f5c|\u65b0\u5efa|\u521b\u5efa|\u642d\u5efa|\u642d|build|create|make).*\u8be6\u60c5\u9875.*(\u6a21\u677f|template)/i,
    /\u4ece\u96f6.*\u8be6\u60c5\u9875/i,
    /\u7a7a\u767d.*\u8be6\u60c5\u9875/i
];
const MAIN_IMAGE_PATTERNS = [/\u4e3b\u56fe/i, /main image/i, /conversion/i, /click\u56fe/i, /\u767d\u5e95\u56fe/i, /\u70b9\u51fb\u56fe/i, /\u8f6c\u5316\u56fe/i];
const MAIN_IMAGE_TEMPLATE_AUTHORING_PATTERNS = [
    /\u65b0\u5efa.*\u4e3b\u56fe.*\u6587\u6863/i,
    /\u521b\u5efa.*\u4e3b\u56fe.*\u6587\u6863/i,
    /(\u5236\u4f5c|\u65b0\u5efa|\u521b\u5efa|\u642d\u5efa|\u642d|build|create|make).*\u4e3b\u56fe.*(\u6a21\u677f|template)/i,
    /\u4ece\u96f6.*\u4e3b\u56fe/i,
    /\u7a7a\u767d.*\u4e3b\u56fe/i
];
const ATTACHED_REFERENCE_REPLICATION_PATTERNS = [
    /复刻/i,
    /复现/i,
    /还原/i,
    /仿照/i,
    /照着/i,
    /按.{0,8}(图|图片|参考|这个|这张|其中|内容)/i,
    /(这个|这张|其中|内容).{0,8}(做|复刻|复现|还原|生成)/i,
    /replicate|recreate|rebuild|copy\s+layout|same\s+layout/i
];
const TEXT_FONT_REPLACE_PATTERNS = [
    /\u628a.*\u5b57\u4f53.*\u6539\u6210/i,
    /\u5b57\u4f53.*\u6539\u6210/i,
    /font.*change/i,
    /replace.*font/i,
    /(\u5168\u90e8|\u6240\u6709).*(\u5b57\u4f53|\u6587\u5b57|\u6587\u672c|\u6587\u6848)/i
];
const LAYER_MANAGEMENT_PATTERNS = [
    /\u56fe\u5c42.{0,12}(\u987a\u5e8f|\u5c42\u7ea7|\u6392\u5e8f|\u7f6e\u9876|\u7f6e\u5e95|\u4e0a\u79fb|\u4e0b\u79fb|\u91cd\u547d\u540d|\u5220\u9664|\u590d\u5236|\u62f7\u8d1d|\u7f16\u7ec4|\u89e3\u9664\u7f16\u7ec4|\u9009\u4e2d|\u9009\u62e9)/i,
    /(\u9009\u4e2d|\u9009\u62e9|\u91cd\u547d\u540d|\u6539\u540d|\u5220\u9664|\u5220\u6389|\u590d\u5236|\u62f7\u8d1d|\u7f16\u7ec4|\u89e3\u9664\u7f16\u7ec4|\u53d6\u6d88\u7f16\u7ec4|\u7f6e\u9876|\u7f6e\u5e95|\u4e0a\u79fb|\u4e0b\u79fb).{0,12}(\u5f53\u524d|\u9009\u4e2d|\u5df2\u9009\u4e2d|\u76ee\u6807)?.{0,8}\u56fe\u5c42/i,
    /(\u9009\u4e2d|\u9009\u62e9|\u91cd\u547d\u540d|\u6539\u540d|\u5220\u9664|\u5220\u6389|\u590d\u5236|\u62f7\u8d1d|\u7f16\u7ec4|\u89e3\u9664\u7f16\u7ec4|\u53d6\u6d88\u7f16\u7ec4|\u7f6e\u9876|\u7f6e\u5e95|\u4e0a\u79fb|\u4e0b\u79fb).{0,12}\u5f53\u524d(?:\u7684)?(?:\u7ec4|\u56fe\u5c42\u7ec4|\u5c42)/i,
    /\u56fe\u5c42.{0,20}(\u79fb\u5230|\u79fb\u52a8\u5230|\u653e\u5230|\u632a\u5230).{0,20}(\u4e0a\u65b9|\u4e0b\u65b9|\u4e0a\u9762|\u4e0b\u9762)/i,
    /(\u987a\u5e8f|\u5c42\u7ea7|\u6392\u5e8f|\u7f6e\u9876|\u7f6e\u5e95|\u4e0a\u79fb|\u4e0b\u79fb|\u79fb\u5230.*(?:\u4e0a\u65b9|\u4e0b\u65b9|\u9876\u5c42|\u5e95\u5c42)).{0,12}\u56fe\u5c42/i,
    /\u4ece\u6d45\u5230\u6df1/i,
    /\u4ece\u6df1\u5230\u6d45/i,
    /(\u51e0\u4e2a|\u51e0\u79cd|\u591a\u5c11\u4e2a|\u591a\u5c11\u79cd).{0,8}\u56fe\u5c42/i,
    /(\u51e0\u4e2a|\u51e0\u79cd|\u591a\u5c11\u4e2a|\u591a\u5c11\u79cd).{0,8}\u989c\u8272/i,
    /\u989c\u8272\u56fe\u5c42/i,
    /\u9690\u85cf.{0,12}\u56fe\u5c42|\u56fe\u5c42.{0,12}\u9690\u85cf|\u770b\u4e0d\u5230.{0,12}\u56fe\u5c42|\u56fe\u5c42.{0,12}\u770b\u4e0d\u5230/i,
    /layer\s+(order|stack|rename|delete|duplicate|group|select)/i
];
const CANVAS_ELEMENT_TARGET_PATTERNS = [
    /(?:左上角|右上角|左下角|右下角|顶部|底部|中间|中心|左侧|右侧|上方|下方).{0,18}(?:文案|文字|文本|标题|副标题|价格|按钮|图片|图标|元素)/i,
    /(?:文案|文字|文本|标题|副标题|价格|按钮|图片|图标|元素).{0,18}(?:左上角|右上角|左下角|右下角|顶部|底部|中间|中心|左侧|右侧|上方|下方)/i,
    /(?:这个|这个画面|当前画面|画布上|页面上|海报上).{0,18}(?:文案|文字|文本|标题|价格|按钮|图片|图标|元素)/i
];
const CANVAS_ELEMENT_ACTION_PATTERNS = [
    /(?:改成|改为|替换成|换成|写成|设置为|修改为|改一下|替换|选中|选择|定位|移动|挪到|放大|缩小|缩放|透明度|不透明度|混合模式|换图|替换图片)/i,
    /(?:set|change|replace|select|locate|move|scale|opacity|blend)/i
];
const RETRY_FEEDBACK_PATTERNS = [
    /\u518d\u6539\u4e00\u4e0b/i,
    /\u91cd\u65b0\u6539/i,
    /\u6ca1\u6539\u6210\u529f/i,
    /\u6ca1\u6709\u6539\u6210\u529f/i,
    /\u597d\u50cf\u6ca1\u6709\u6539\u6210\u529f/i,
    /\u8fd8\u662f\u4e0d\u5bf9/i,
    /\u8fd8\u662f\u6ca1\u6539/i,
    /\u6ca1\u751f\u6548/i,
    /\u518d\u505a\u4e00\u4e0b/i,
    /\u91cd\u8bd5/i
];
const MODEL_IDENTITY_PATTERNS = [
    /\u4f60\u662f\u4ec0\u4e48\u6a21\u578b/i,
    /\u4f60\u7528\u7684\u662f\u4ec0\u4e48\u6a21\u578b/i,
    /\u7528\u7684.*\u6a21\u578b/i,
    /\u54ea\u4e2a\u6a21\u578b/i,
    /what model are you/i,
    /which model are you/i,
    /what model do you use/i
];
const MODEL_COMPARISON_PATTERNS = [
    /(gemini|gpt|claude|qwen|deepseek|doubao|glm|kimi).*(\u54ea\u4e2a|\u54ea\u4e2a\u66f4\u5f3a|\u66f4\u5f3a|\u66f4\u597d|\u5bf9\u6bd4|\u533a\u522b)/i,
    /(\u54ea\u4e2a|\u54ea\u4e2a\u66f4\u5f3a|\u66f4\u5f3a|\u66f4\u597d|\u5bf9\u6bd4|\u533a\u522b).*(gemini|gpt|claude|qwen|deepseek|doubao|glm|kimi)/i,
    /(gemini|gpt|claude|qwen|deepseek|doubao|glm|kimi).*(vs|versus|compare)/i,
    /compare.*(gemini|gpt|claude|qwen|deepseek|doubao|glm|kimi)/i
];
const TASK_SUMMARY_PATTERNS = [
    /(回顾|总结|复盘).{0,16}(上次|刚才|之前|我们的任务|任务|进度|工作|聊天|对话)/i,
    /(上次|刚才|之前).{0,16}(任务|工作|修改|做了什么|完成了什么|进度).{0,16}(总结|回顾|复盘|汇报)?/i,
    /(汇报|报告|说一下|告诉我).{0,10}(进度|剩余内容|完成情况|当前状态|还有多少)/i,
    /(项目|任务|开发).{0,10}(进度|剩余内容|完成情况|当前状态|还有多少)/i,
    /(agent|意图|基础设施|项目|任务|开发|规划|主线|当前|我们).{0,16}(完成了吗|算完成|完成了没|还剩|剩余|进度|百分之几|多少事情|多少没有完成|还需要做哪些|还需要做什么|下一步|下一项)/i,
    /(距离|离).{0,16}(还需要|还差|剩余|哪些|什么)/i
];

function containsAny(input: string, patterns: RegExp[]): boolean {
    return patterns.some((pattern) => pattern.test(input));
}

function normalizeInput(input: string): string {
    return String(input || '').trim().toLowerCase();
}

export function isAgentMattingPaused(): boolean {
    return true;
}

export function getAgentMattingPausedMessage(): string {
    return AGENT_MATTING_PAUSED_MESSAGE;
}

function isColorLayerInspectionRequest(input: string): boolean {
    return COLOR_LAYER_INSPECTION_PATTERN.test(input);
}

function isLayerStateInspectionRequest(input: string): boolean {
    return LAYER_STATE_INSPECTION_PATTERN.test(input);
}

export function isAmbiguousTemplateInspectionIntent(input: string): boolean {
    const normalized = normalizeInput(input);
    if (!normalized) return false;
    if (containsAny(normalized, TEMPLATE_INSPECTION_NEGATIVE_PATTERNS)) return false;
    if (isDocumentManagementIntent(normalized)
        || isDetailTemplateAuthoringIntent(normalized)
        || isMainImageTemplateAuthoringIntent(normalized)
        || isSkuIntent(normalized)
        || isTemplateSaveIntent(normalized)
        || isLayerManagementIntent(normalized)) {
        return false;
    }
    return containsAny(normalized, AMBIGUOUS_TEMPLATE_INSPECTION_PATTERNS);
}

function shouldRouteQuestionToDeterministicSkill(match: DeterministicIntentMatch | null): boolean {
    return Boolean(match?.skillId && QUESTION_SAFE_DETERMINISTIC_SKILLS.has(match.skillId));
}

function isGeneralChatQuestion(input: string): boolean {
    return !isMatteIntent(input) && GENERAL_CHAT_QUESTION_PATTERN.test(input);
}

function isPlanOrDiscussionQuestion(input: string): boolean {
    const normalized = normalizeInput(input);
    if (!normalized) return false;
    if (FOLLOW_UP_QUESTION_PATTERN.test(normalized)) return true;
    if (PLAN_OR_DISCUSSION_QUESTION_PATTERN.test(normalized)) return true;
    return false;
}

function isActionableBusinessRequest(input: string): boolean {
    const normalized = normalizeInput(input);
    if (!normalized) return false;
    if (isAgentSkillCapabilityQuestion(input)) return false;
    if (!/(帮我|请|做|生成|处理|出图|规划|整理|制作|创建|新建|调整|修改|执行|需要|一起|整体)/i.test(normalized)) {
        return false;
    }
    return isSkuIntent(normalized)
        || isEcommerceSocksDesignIntent(normalized)
        || isProjectImageAnalysisIntent(normalized)
        || isDetailTemplateAuthoringIntent(normalized)
        || isMainImageTemplateAuthoringIntent(normalized)
        || isLayoutReplicationIntent(normalized)
        || matchesSkillRoutingIntent('detail-page-design', normalized)
        || containsAny(normalized, MAIN_IMAGE_PATTERNS);
}

export function normalizeSkillId(skillId?: string): string | undefined {
    return normalizeSharedSkillId(skillId);
}

export function isSkillEnabled(skillId?: string): boolean {
    const normalized = normalizeSkillId(skillId);
    if (!normalized) return false;
    const integrationSettings = useAppStore.getState().integrationSettings;
    return integrationSettings?.skills?.[normalized]?.enabled !== false;
}

export function isSkuIntent(input: string): boolean {
    const normalized = normalizeInput(input);
    return matchesSkillRoutingIntent('sku-batch', normalized)
        || containsAny(normalized, SKU_PATTERNS);
}

export function isEcommerceSocksDesignIntent(input: string): boolean {
    const normalized = normalizeInput(input);
    if (!normalized) return false;
    return matchesSkillRoutingIntent('ecommerce-socks-design', normalized)
        || containsAny(normalized, ECOMMERCE_SOCKS_DESIGN_PATTERNS);
}

export function isProjectImageAnalysisIntent(input: string): boolean {
    const normalized = normalizeInput(input);
    return matchesSkillRoutingIntent('project-image-analysis', normalized);
}

function isProjectInventoryOverviewIntent(input: string): boolean {
    const normalized = normalizeInput(input);
    if (!normalized || !isProjectImageAnalysisIntent(normalized)) return false;
    if (/(款式|特征|卖点|风格|描述|总结|识别|判断|构图|详情页|这些图片是什么|图片是什么)/.test(normalized)) {
        return false;
    }
    return /(都有什么|都有些什么|都有啥|有些什么|有什么|有哪些|包含什么|包括什么|项目内容|项目资源|素材列表|资源列表|目录结构|项目结构|文件夹)/.test(normalized);
}

function extractProjectImageAnalysisRoutingParams(input: string): Record<string, any> {
    if (isProjectInventoryOverviewIntent(input)) {
        return {
            analysisMode: 'inventory',
            sampleSize: 0,
            focus: 'inventory'
        };
    }

    return {};
}

export function isSkuNoteOnlyIntent(input: string): boolean {
    return isSkuNoteOnlyText(input);
}

function extractSkuSizesFromInput(input: string): number[] {
    return extractSkuComboSizesFromText(input);
}

export function isTemplateSaveIntent(input: string): boolean {
    const normalized = normalizeInput(input);
    return matchesSkillRoutingIntent('save-current-template', normalized)
        || containsAny(normalized, TEMPLATE_SAVE_PATTERNS);
}

export function isAgentPanelDebugIntent(input: string): boolean {
    const normalized = normalizeInput(input);
    return matchesSkillRoutingIntent('agent-panel-bridge', normalized)
        || containsAny(normalized, AGENT_PANEL_PATTERNS)
        || (containsAny(normalized, DEBUG_PATTERNS) && /agent|mcp|\u5de5\u5177\u94fe\u8def|websocket|\u8fde\u63a5|\u9762\u677f|panel/.test(normalized));
}

export function isDetailTemplateAuthoringIntent(input: string): boolean {
    const normalized = normalizeInput(input);
    return matchesSkillRoutingIntent('detail-page-template-authoring', normalized)
        || containsAny(normalized, DETAIL_TEMPLATE_AUTHORING_PATTERNS);
}

export function isMainImageTemplateAuthoringIntent(input: string): boolean {
    const normalized = normalizeInput(input);
    return matchesSkillRoutingIntent('main-image-template-authoring', normalized)
        || (containsAny(normalized, MAIN_IMAGE_PATTERNS)
            && containsAny(normalized, MAIN_IMAGE_TEMPLATE_AUTHORING_PATTERNS));
}

export function isTextFontReplaceIntent(input: string): boolean {
    const normalized = normalizeInput(input);
    return matchesSkillRoutingIntent('text-font-replace', normalized)
        || containsAny(normalized, TEXT_FONT_REPLACE_PATTERNS);
}

export function isLayerManagementIntent(input: string): boolean {
    const normalized = normalizeInput(input);
    return matchesSkillRoutingIntent('layer-management', normalized)
        || containsAny(normalized, LAYER_MANAGEMENT_PATTERNS);
}

export function isFindEditElementIntent(input: string): boolean {
    const normalized = normalizeInput(input);
    if (!matchesSkillRoutingIntent('find-and-edit-element', normalized)
        && !(containsAny(normalized, CANVAS_ELEMENT_TARGET_PATTERNS) && containsAny(normalized, CANVAS_ELEMENT_ACTION_PATTERNS))) {
        return false;
    }
    if (/图层.{0,8}(顺序|层级|置顶|置底|上移|下移|编组|解除编组|重命名|删除|复制)/i.test(normalized)) {
        return false;
    }
    if (isDocumentManagementIntent(normalized)
        || isDetailTemplateAuthoringIntent(normalized)
        || isMainImageTemplateAuthoringIntent(normalized)
        || isSkuIntent(normalized)) {
        return false;
    }
    return true;
}

export function isMatteIntent(input: string): boolean {
    const normalized = normalizeInput(input);
    return matchesSkillRoutingIntent('matte-product', normalized)
        || containsAny(normalized, MATTE_PATTERNS);
}

function isAttachedReferenceReplicationIntent(
    input: string,
    options?: DeterministicRouteOptions
): boolean {
    if (!options?.hasAttachedImage) return false;
    const normalized = normalizeInput(input);
    if (!containsAny(normalized, ATTACHED_REFERENCE_REPLICATION_PATTERNS)) return false;
    if (isSkuIntent(normalized) || isMatteIntent(normalized) || isLayerManagementIntent(normalized)) return false;
    return true;
}

export function isLayoutReplicationIntent(
    input: string,
    options?: DeterministicRouteOptions
): boolean {
    const normalized = normalizeInput(input);
    return matchesSkillRoutingIntent('layout-replication', normalized)
        || isAttachedReferenceReplicationIntent(normalized, options);
}

export function isDocumentManagementIntent(input: string): boolean {
    const normalized = normalizeInput(input);
    return matchesSkillRoutingIntent('document-management', normalized);
}

export function isRetryFeedbackIntent(input: string): boolean {
    return containsAny(normalizeInput(input), RETRY_FEEDBACK_PATTERNS);
}

function extractQuotedValue(input: string): string | undefined {
    const match = String(input || '').match(/["“”'‘’]([^"“”'‘’\n]+)["“”'‘’]/);
    const value = String(match?.[1] || '').trim();
    return value || undefined;
}

function extractLayerName(input: string): string | undefined {
    const quoted = extractQuotedValue(input);
    if (quoted) return quoted;

    const isGenericLayerReference = (value: string): boolean => (
        /^(当前|选中|选中的|已选中|当前选中|当前选中的|目标|这个|该|的|颜色|顺序|层级|排序|置顶|置底|上移|下移|组|图层组|编组|取消编组|解除编组)$/.test(value)
    );

    const patterns = [
        /(?:图层|层)\s*(?:叫|名为|名称为|名称是)?\s*([A-Za-z0-9_\-\u4e00-\u9fa5 ]+?)(?:\s*(?:置顶|置底|上移|下移|删除|重命名|改名|复制|拷贝|编组|移到|$))/i,
        /(?:选中|选择|删除|复制|拷贝|重命名|改名)\s*([A-Za-z0-9_\-\u4e00-\u9fa5 ]+?)\s*(?:图层|层)/i
    ];
    for (const pattern of patterns) {
        const match = String(input || '').match(pattern);
        const value = String(match?.[1] || '').trim().replace(/[，。,.!！?？]+$/g, '').trim();
        if (value && !isGenericLayerReference(value)) return value;
    }
    return undefined;
}

function extractTargetLayerName(input: string): string | undefined {
    const raw = String(input || '');
    const patterns = [
        /(?:移到|移动到|放到|挪到)\s*(?:图层|层)?\s*([A-Za-z0-9_\-\u4e00-\u9fa5 ]+?)\s*(?:的)?(?:上方|下面|下方|上面)/i,
        /(?:above|below)\s+([A-Za-z0-9_\-\u4e00-\u9fa5 ]+)/i
    ];

    for (const pattern of patterns) {
        const match = raw.match(pattern);
        const value = String(match?.[1] || '')
            .trim()
            .replace(/[，。,.!！?？]+$/g, '')
            .trim();
        if (value && !/^(当前|选中|目标|这个|该|的|上方|下方|下面|上面)$/.test(value)) return value;
    }
    return undefined;
}

function extractLayerManagementRoutingParams(input: string): Record<string, any> {
    const normalized = normalizeInput(input);
    const params: Record<string, any> = { userIntent: input };

    if (isColorLayerInspectionRequest(normalized)) {
        return { ...params, action: 'inspect', inspectMode: 'color-layers' };
    }

    if (isLayerStateInspectionRequest(normalized)) {
        return { ...params, action: 'inspect' };
    }

    const layerName = extractLayerName(input);
    if (layerName) params.layerName = layerName;
    if (/当前选中|当前选择|选中的|已选中|当前图层/.test(normalized)) {
        params.useCurrentSelection = true;
    }

    const idMatch = String(input || '').match(/(?:layerId|图层\s*ID|图层id|id)\s*[:：=]?\s*(\d+)/i);
    const layerId = Number(idMatch?.[1]);
    if (Number.isFinite(layerId)) params.layerId = layerId;

    if (/从浅到深/.test(normalized)) {
        return { ...params, action: 'reorder', sortBy: 'lightness', sortDirection: 'light-to-dark' };
    }
    if (/从深到浅/.test(normalized)) {
        return { ...params, action: 'reorder', sortBy: 'lightness', sortDirection: 'dark-to-light' };
    }
    if (/置顶|顶层|bring.*front|to\s*top/i.test(normalized)) {
        return { ...params, action: 'reorder', reorderAction: 'top' };
    }
    if (/置底|底层|send.*back|to\s*bottom/i.test(normalized)) {
        return { ...params, action: 'reorder', reorderAction: 'bottom' };
    }
    if (/上移|向上|move\s*up/i.test(normalized)) {
        return { ...params, action: 'reorder', reorderAction: 'up' };
    }
    if (/下移|向下|move\s*down/i.test(normalized)) {
        return { ...params, action: 'reorder', reorderAction: 'down' };
    }
    if (/移到.*上方|above/i.test(normalized)) {
        const targetLayerName = extractTargetLayerName(input);
        return { ...params, action: 'reorder', reorderAction: 'above', ...(targetLayerName ? { targetLayerName } : {}) };
    }
    if (/移到.*下方|below/i.test(normalized)) {
        const targetLayerName = extractTargetLayerName(input);
        return { ...params, action: 'reorder', reorderAction: 'below', ...(targetLayerName ? { targetLayerName } : {}) };
    }
    if (/重命名|改名|rename/i.test(normalized)) {
        const newNameMatch = String(input || '').match(/(?:重命名为|改名为|名称改为|rename\s+to)\s*([^\n，。!！？?]+)/i);
        const newName = String(newNameMatch?.[1] || '').trim();
        return { ...params, action: 'rename', ...(newName ? { newName } : {}) };
    }
    if (/删除|删掉|delete/i.test(normalized)) {
        return { ...params, action: 'delete' };
    }
    if (/复制|拷贝|duplicate|copy/i.test(normalized)) {
        return { ...params, action: 'duplicate' };
    }
    if (/解除.*编组|取消.*编组|ungroup/i.test(normalized)) {
        return { ...params, action: 'ungroup' };
    }
    if (/编组|group/i.test(normalized)) {
        return { ...params, action: 'group' };
    }
    if (/选中|选择|定位|select|focus/i.test(normalized)) {
        return { ...params, action: 'select' };
    }
    return { ...params, action: 'inspect' };
}

function extractFindEditElementRoutingParams(input: string): Record<string, any> {
    const raw = String(input || '').trim();
    const normalized = normalizeInput(raw);
    const params: Record<string, any> = {
        userIntent: raw,
        selectionMode: 'auto'
    };

    const idMatch = raw.match(/(?:layerId|图层\s*ID|图层id|id)\s*[:：=]?\s*(\d+)/i);
    const layerId = Number(idMatch?.[1]);
    if (Number.isFinite(layerId)) params.layerId = layerId;

    const setTextMatch = raw.match(/(?:改成|改为|替换成|换成|写成|设置为|修改为)\s*[“"']?([^“”"'\n。！？]+)[”"']?/i);
    if (setTextMatch?.[1]) {
        params.action = 'setText';
        params.text = setTextMatch[1].trim().replace(/[。！？]+$/g, '');
    } else if (/换图|替换图片|replace.*image/i.test(normalized)) {
        params.action = 'replaceImage';
    } else if (/放大|缩小|缩放|scale/i.test(normalized)) {
        params.action = 'scale';
        const scaleMatch = raw.match(/(\d+(?:\.\d+)?)\s*%/);
        if (scaleMatch?.[1]) params.scalePercent = Number(scaleMatch[1]);
    } else if (/透明度|不透明度|opacity/i.test(normalized)) {
        params.action = 'setOpacity';
        const opacityMatch = raw.match(/(\d+(?:\.\d+)?)\s*%?/);
        if (opacityMatch?.[1]) params.opacity = Number(opacityMatch[1]);
    } else if (/混合模式|blend/i.test(normalized)) {
        params.action = 'setBlendMode';
    } else if (/移动|挪到|move/i.test(normalized)) {
        params.action = 'move';
    } else if (/选中|选择|定位|select|locate/i.test(normalized)) {
        params.action = /选中|选择|select/i.test(normalized) ? 'select' : 'locate';
    } else {
        params.action = 'locate';
    }

    const targetPart = raw
        .replace(/帮我|请|把|将/g, '')
        .split(/(?:改成|改为|替换成|换成|写成|设置为|修改为|移动|挪到|放大|缩小|缩放|透明度|不透明度|混合模式|换图|替换图片|选中|选择|定位)/i)[0]
        ?.trim()
        .replace(/[，,。.!！?？]+$/g, '');
    params.targetDescription = targetPart || raw;

    return params;
}

function matchDeterministicIntent(
    input: string,
    options?: DeterministicRouteOptions
): DeterministicIntentMatch | null {
    const normalized = normalizeInput(input);
    if (isAgentSkillCapabilityQuestion(input)) return null;

    if (isProjectImageAnalysisIntent(normalized)) {
        return {
            skillId: 'project-image-analysis',
            params: extractProjectImageAnalysisRoutingParams(input)
        };
    }

    if (isAgentPanelDebugIntent(normalized)) {
        return { skillId: 'agent-panel-bridge' };
    }

    if (isDetailTemplateAuthoringIntent(normalized)) {
        return { skillId: 'detail-page-template-authoring' };
    }

    if (isMainImageTemplateAuthoringIntent(normalized)) {
        return { skillId: 'main-image-template-authoring' };
    }

    if (isTextFontReplaceIntent(normalized)) {
        return { skillId: 'text-font-replace' };
    }

    if (isLayerManagementIntent(normalized)) {
        return {
            skillId: 'layer-management',
            params: extractLayerManagementRoutingParams(input)
        };
    }

    if (isFindEditElementIntent(normalized)) {
        return {
            skillId: 'find-and-edit-element',
            params: extractFindEditElementRoutingParams(input)
        };
    }

    if (isDocumentManagementIntent(normalized)) {
        const action = resolveSkillRoutingMode('document-management', normalized);
        if (!action) return null;
        return {
            skillId: 'document-management',
            params: extractDocumentManagementRoutingParams(input, action)
        };
    }

    if (isLayoutReplicationIntent(normalized, options)) {
        return {
            skillId: 'layout-replication',
            params: {
                outputMode: 'apply',
                autoCreateDocument: true,
                preserveReferenceCanvasSize: true,
                userIntent: input
            }
        };
    }

    if (isEcommerceSocksDesignIntent(normalized)) {
        return {
            skillId: 'ecommerce-socks-design',
            params: {
                deliverables: extractEcommerceSocksDeliverables(input),
                userIntent: input
            }
        };
    }

    if (options?.detailPageTemplateDetected && isAmbiguousTemplateInspectionIntent(normalized)) {
        return {
            skillId: 'detail-page-design',
            mode: 'inspect',
            params: {
                inspectOnly: true,
                autoFix: false,
                structureMode: 'inspect',
                visualValidation: false,
                inferredFromCurrentDocument: true,
                templatePreflightSource: 'current-document-structure',
                detailPageTemplateScreenCount: options.detailPageTemplateScreenCount,
                detailPageTemplateIssueCodes: Array.isArray(options.detailPageTemplateIssueCodes)
                    ? options.detailPageTemplateIssueCodes
                    : [],
                userIntent: input
            }
        };
    }

    if (matchesSkillRoutingIntent('detail-page-design', normalized)) {
        return {
            skillId: 'detail-page-design',
            mode: resolveSkillRoutingMode('detail-page-design', normalized) === 'inspect'
                ? 'inspect'
                : 'execute'
        };
    }

    if (matchesSkillRoutingIntent('main-image-design', normalized)) {
        return {
            skillId: 'main-image-design',
            mode: 'execute'
        };
    }

    if (isMatteIntent(normalized) && !isAgentMattingPaused()) {
        return { skillId: 'matte-product' };
    }

    if (isSkuNoteOnlyIntent(normalized)) {
        return {
            skillId: 'sku-batch',
            params: {
                onlyNotes: true,
                comboSizes: extractSkuSizesFromInput(input)
            }
        };
    }

    if (isSkuIntent(normalized)) {
        return { skillId: 'sku-batch' };
    }

    if (isTemplateSaveIntent(normalized)) {
        return { skillId: 'save-current-template' };
    }

    return null;
}

export function inferSkillHint(input: string): string | undefined {
    const deterministicMatch = matchDeterministicIntent(input);
    if (deterministicMatch?.skillId) return deterministicMatch.skillId;

    const normalized = normalizeInput(input);
    if (containsAny(normalized, MAIN_IMAGE_PATTERNS)) return 'main-image-design';
    return undefined;
}

export function detectLightweightIntent(input: string): LightweightIntent {
    const text = normalizeInput(input);
    if (!text) return 'none';

    if (GREETING_PATTERN.test(text)) return 'greeting';
    if (THANKS_PATTERN.test(text)) return 'thanks';
    if (CONTINUATION_PATTERN.test(text)) return 'continuation';
    if (ACK_PATTERN.test(text)) return 'ack';
    if (SELF_INTRODUCTION_PATTERN.test(text)) return 'identity';
    if (containsAny(text, MODEL_COMPARISON_PATTERNS)) return 'model_compare';
    if (containsAny(text, MODEL_IDENTITY_PATTERNS)) return 'identity';
    if (CAPABILITY_QUESTION_PATTERN.test(text)) return 'capability';
    if (isAgentSkillCapabilityQuestion(input)) return 'chat';
    if (containsAny(text, TASK_SUMMARY_PATTERNS)) return 'task_summary';
    if (ARCHITECTURE_DISCUSSION_PATTERN.test(text)) return 'chat';
    const intentControlPlane = buildAgentIntentControlPlaneDecision({ userInput: text });
    if (intentControlPlane.shouldUseConversationalPath) return 'chat';
    if (intentControlPlane.requiresClarificationBeforeTools
        || intentControlPlane.requestKind === 'read_only_inspect'
        || intentControlPlane.requestKind === 'execute_skill'
        || intentControlPlane.requestKind === 'autonomous_execution'
        || intentControlPlane.requestKind === 'uxp_user_tool_only') {
        return 'none';
    }
    if (isPlanOrDiscussionQuestion(text)) return 'chat';
    if (isProjectImageAnalysisIntent(text)) return 'none';
    if (isActionableBusinessRequest(text)) return 'none';
    const deterministicMatch = matchDeterministicIntent(text);
    if (shouldRouteQuestionToDeterministicSkill(deterministicMatch)) return 'none';
    if (isGeneralChatQuestion(text)) return 'chat';
    return 'none';
}

export function isModelFirstConversationalIntent(intent: LightweightIntent): boolean {
    return intent !== 'none';
}

export function isLocalFirstConversationalIntent(intent: LightweightIntent): boolean {
    void intent;
    return false;
}

function resolveSkillThinkingMessage(
    skillId: string,
    phase: 'deterministic' | 'autonomous'
): string | undefined {
    const skill = getSkillById(skillId);
    const message = skill?.routing?.routeStatusMessages?.[phase];
    return typeof message === 'string' && message.trim() ? message.trim() : undefined;
}

export function buildDeterministicIntentMessage(skillId: string, input: string): string {
    if (normalizeSkillId(skillId) === 'matte-product' && isAgentMattingPaused()) {
        return getAgentMattingPausedMessage();
    }

    if (skillId === 'sku-batch' && isSkuNoteOnlyIntent(input)) {
        return '确认当前项目、SKU 文档和自选备注模板后生成备注。';
    }

    if (skillId === 'project-image-analysis' && isProjectInventoryOverviewIntent(input)) {
        return '读取项目资源索引，汇总文件夹、图片和素材类型。';
    }

    const sharedMessage = resolveSkillThinkingMessage(skillId, 'deterministic');
    if (sharedMessage) {
        return sharedMessage;
    }

    return '确认目标和当前上下文后执行。';
}

export function buildAutonomousIntentMessage(input: string, skillHint?: string): string {
    const resolvedSkillHint = skillHint || inferSkillHint(input);

    if (normalizeSkillId(resolvedSkillHint) === 'matte-product' && isAgentMattingPaused()) {
        return getAgentMattingPausedMessage();
    }

    if (resolvedSkillHint) {
        const sharedMessage = resolveSkillThinkingMessage(resolvedSkillHint, 'autonomous');
        if (sharedMessage) {
            return sharedMessage;
        }
    }

    return '理解用户需求、当前画面和可用素材后处理。';
}

export function fastDeterministicRoute(
    input: string,
    options?: DeterministicRouteOptions
): DeterministicSkillRoute | null {
    const match = matchDeterministicIntent(input, options);
    if (!match?.skillId) return null;

    return {
        skillId: match.skillId,
        skillParams: applySharedSkillParamDefaults({
            skillId: match.skillId,
            userInput: input,
            mode: match.mode,
            params: match.params
        }),
        thinking: buildDeterministicIntentMessage(match.skillId, input)
    };
}

export function debugInferDecisionFromText(userInput: string): AgentDecision {
    const intent = detectLightweightIntent(userInput);
    if (intent !== 'none') {
        return {
            type: 'direct_response',
            directResponse: '这条输入会直接走对话回复，不会触发桌面端智能体执行。',
            reasoning: `lightweight:${intent}`
        };
    }

    const route = fastDeterministicRoute(userInput);
    if (route) {
        return {
            type: 'skill_execution',
            skillId: route.skillId,
            skillParams: route.skillParams,
            reasoning: route.thinking
        };
    }

    return {
        type: 'skill_execution',
        skillId: 'autonomous-agent',
        skillParams: {
            userTask: userInput,
            skillId: inferSkillHint(userInput)
        },
        reasoning: buildAutonomousIntentMessage(userInput, inferSkillHint(userInput))
    };
}
