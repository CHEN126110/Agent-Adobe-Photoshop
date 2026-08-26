import {
    buildRuntimeSelectedSkillHandoff,
    type RuntimeSelectedSkillHandoff
} from './agent-runtime-v5/runtime-selected-skill-handoff';
import type { AgentIntentControlPlaneDecision } from './agent-intent-control-plane';
import { getSkillById, SKILL_REGISTRY } from './skills/skill-declarations';
import {
    isProjectIdentityConversationIntent,
    isProjectContextMainImageDeliveryIntent,
    isProjectImageAnalysisDeliveryIntent
} from './project-image-analysis-intent';
import { inferDesignDocumentRolesFromTaskText } from './design-document-role';
import type { SkillDeclaration } from './types/skill.types';

export interface SkillRoutingIntentMatch {
    skillId: string;
    mode?: string;
}

/**
 * 由 Skill 自身声明推导出的、仅供主 Agent 导航的唯一候选。
 *
 * 这不是 Runtime Skill 身份，也不执行 Skill、不授予任何权限。调用方可以据此预先
 * 暴露对应 schema，或让 Agent 按需装载；真正使用仍须经过既有 Tool/Skill 执行边界。
 */
export interface SkillRoutingRecommendation {
    version: 'skill-routing-recommendation/v0';
    skillId: string;
    capabilityId: string;
    mode?: string;
    source: 'unique_declared_routing_match';
    advisoryOnly: true;
    bindsRuntimeIdentity: false;
    grantsPermission: false;
}

export function isCanonicalSkillProductionEntry(skillId: string, requestText: string): boolean {
    const entries = getSkillById(skillId)?.routing?.canonicalProductionEntries;
    return buildCanonicalProductionEntryCandidates(requestText)
        .some((candidate) => textContainsAnyRoutingSignal(candidate, entries));
}

export interface FindSkillRoutingIntentOptions {
    excludeSkillIds?: string[];
    includeVisibilities?: SkillDeclaration['visibility'][];
    includeRouteClasses?: Array<NonNullable<SkillDeclaration['routeClass']>>;
    modelDirectExecution?: SkillDeclaration['modelDirectExecution'];
}

export const SKILL_ID_ALIASES: Record<string, string> = {
    'main-image': 'main-image-design',
    'detail-page': 'detail-page-design',
    'text-font': 'text-font-replace',
    'document': 'document-management',
    'layer': 'layer-management',
    'layers': 'layer-management',
    'sku-setup': 'sku-batch',
    'sku-config': 'sku-batch',
    'sku-color-card': 'sku-batch',
    'agent-panel': 'agent-panel-bridge',
    'save-template': 'save-current-template',
    'template-save': 'save-current-template'
};

export function normalizeSkillId(skillId?: string): string | undefined {
    const value = String(skillId || '').trim();
    if (!value) return undefined;
    return SKILL_ID_ALIASES[value] || value;
}

export function normalizeRoutingText(text?: string): string {
    return String(text || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

function compactRoutingText(text?: string): string {
    return normalizeRoutingText(text).replace(/\s+/g, '');
}

const CANONICAL_PRODUCTION_POLITE_SUFFIX_PATTERN = /[，,\s]*(?:可以|行|好)吗[？?]?$/i;
const CANONICAL_PRODUCTION_LEADING_MODIFIER_PATTERN =
    /^((?:(?:请|麻烦(?:你)?)\s*)?(?:(?:帮我|给我|替我|为我)\s*)?)(?:直接|现在|马上|立即|开始)\s*/i;
/**
 * canonical 只接受声明本身和极窄的非语义包装。未知说法回普通 Agent，绝不因
 * “没有命中白名单”而撤销权限或停止任务；也不在 Harness 继续维护中文改写器。
 */
function buildCanonicalProductionEntryCandidates(requestText: string): string[] {
    const original = String(requestText || '').trim();
    if (!original) return [];

    const candidates = new Set<string>([original]);
    const withoutPoliteSuffix = original.replace(CANONICAL_PRODUCTION_POLITE_SUFFIX_PATTERN, '').trim();
    if (withoutPoliteSuffix && withoutPoliteSuffix !== original) {
        candidates.add(withoutPoliteSuffix);
    }

    for (const candidate of [...candidates]) {
        let commandWithoutLeadingModifiers = candidate;
        for (let index = 0; index < 3; index += 1) {
            const next = commandWithoutLeadingModifiers.replace(
                CANONICAL_PRODUCTION_LEADING_MODIFIER_PATTERN,
                '$1'
            );
            if (next === commandWithoutLeadingModifiers) break;
            commandWithoutLeadingModifiers = next;
        }
        const normalizedCommand = commandWithoutLeadingModifiers
            .replace(CANONICAL_PRODUCTION_POLITE_SUFFIX_PATTERN, '')
            .trim();
        if (normalizedCommand) candidates.add(normalizedCommand);
    }

    return [...candidates];
}

const DOCUMENT_TARGET_PATTERNS = [
    /(?:切换到|切到|切回|切换回)\s*([^\n，。!！？?]+?)\s*(?:文档|文件)?(?:并且|然后|$)/i,
    /(?:关闭|关掉)\s*([^\n，。!！？?]+?)\s*(?:文档|文件)?(?:不保存|别保存|不要保存|保存后关闭|先保存再关闭|并且|然后|$)/i
];

const DOCUMENT_SAVE_FALSE_PATTERNS = [
    /不保存/i,
    /别保存/i,
    /不要保存/i,
    /without saving/i
];

const DOCUMENT_SAVE_TRUE_PATTERNS = [
    /保存后关闭/i,
    /保存并关闭/i,
    /先保存再关闭/i,
    /save and close/i,
    /close after saving/i
];

const DOCUMENT_SAVE_FORMATS = ['psd', 'psb', 'png', 'jpg', 'jpeg', 'tif', 'tiff', 'pdf'];
const DOCUMENT_CREATE_PATTERNS = [
    /(?:新建|创建|建立|create)(?!的).{0,24}(?:文档|文件|画布|document|canvas)/i,
    /(?:文档|文件|画布|document|canvas).{0,24}(?:新建|创建|建立|create)/i
];
const DOCUMENT_LIST_PATTERNS = [
    /列出.{0,24}(?:文档|文件|document|file)/i,
    /查看.{0,24}(?:文档|文件|document|file).{0,12}(?:列表|状态|名称|路径|信息)?/i,
    /(?:有哪些|有什么).{0,12}(?:文档|文件|document|file)/i,
    /list.{0,12}(?:documents|files)/i
];
const DOCUMENT_READ_ONLY_HINT_PATTERN = /只读|read[-_\s]?only/i;
const DOCUMENT_NEGATED_MUTATION_PATTERN = /(?:不要|别|无需|不用|禁止|避免|不能|不)\s*(?:直接)?\s*(?:新建|创建|建立|create|修改|改动|写入|modify|write)/i;
const FRESH_CREATIVE_DESIGN_DRAFT_PATTERNS = [
    /(?:从零|从0|从头|凭空).{0,24}(?:设计|做|画|创作|制作|搭|创建|建立|生成).{0,24}(?:主图|详情页|长图|海报|banner|横幅|场景图|宣传图|首图|封面|落地页)/i,
    /(?:完成|交付|产出).{0,48}(?:主图|详情页|长图|海报|banner|横幅|场景图|宣传图|首图|封面|落地页)/i,
    /可验收.{0,36}(?:主图|详情页|长图|海报|banner|横幅|场景图|宣传图|首图|封面|落地页)/i,
    /(?:主图|详情页|长图|海报|banner|横幅|场景图|宣传图|首图|封面|落地页).{0,24}(?:可验收|完成|交付|产出)/i,
    /(?:帮我|请|麻烦|需要|直接)?\s*(?:做|制作|生成|搭建|设计).{0,32}(?:主图|详情页|长图|海报|banner|横幅|场景图|宣传图|首图|封面|落地页)(?:.{0,24}(?:模板|画布|版面|视觉|设计稿|首屏|canvas|page))?/i,
    /(?:新建|创建|建立|做|制作|生成|搭建).{0,32}(?:主图|详情页|长图|海报|banner|横幅|场景图|宣传图|首图|封面|落地页).{0,24}(?:草稿|画布|版面|视觉|设计稿|首屏|临时)/i,
    /(?:新建|创建|建立|做|制作|生成|搭建).{0,32}(?:草稿|画布|版面|视觉|设计稿|首屏|临时).{0,24}(?:主图|详情页|长图|海报|banner|横幅|场景图|宣传图|首图|封面|落地页)/i,
    /(?:主图|详情页|长图|海报|banner|横幅|场景图|宣传图|首图|封面|落地页).{0,24}(?:草稿|画布|版面|视觉|设计稿)/i
];
// 上数组第 5 条（裸「做/制作/生成/设计 + 主图/详情页等」）单独命名：对主图是从零设计信号；
// 但 detail-page-design 的声明范围本身含从零路径，裸「做详情页」应归该技能而非通用循环，
// 对该技能判定时要摘掉这条 catch-all（见 isFreshCreativeDesignDraftText 的 excludeCatchAll）。
const FRESH_CREATIVE_DESIGN_CATCHALL_PATTERN = FRESH_CREATIVE_DESIGN_DRAFT_PATTERNS[4];
// 逃生舱：识别"已有模板/已打开文档"的自然说法——打开了/打开着/已打开不再强制"的"，
// 作为模板/当模板用不再要求与处理动词相邻。
const EXISTING_TEMPLATE_WORKFLOW_HINT_PATTERN = /(?:当前|这个|这份|打开了|打开的|打开着|已打开|已有|现成).{0,12}(?:模板|详情页|长图)|(?:作为|当作|当成|用作)模板|以.{0,4}为模板|套版|(?:模板).{0,16}(?:解析|检查|填充|套用|换图|导出)|(?:解析|检查|填充|套用|换图|导出).{0,16}(?:模板)/i;
function trimRoutingCapture(value?: string): string {
    return String(value || '')
        .trim()
        .replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, '')
        .replace(/[.,，。!！？?]+$/g, '')
        .trim();
}

export function sanitizeDocumentTarget(value: string): string | undefined {
    const trimmed = trimRoutingCapture(value);
    if (!trimmed) return undefined;
    if (/^(文档|当前文档|当前打开(?:的)?文档|当前打开|当前|这个文档|该文档|这个文件|该文件|这个psd|当前这个psd|当前这个文档)$/i.test(trimmed)) {
        return undefined;
    }
    return trimmed;
}

function extractDocumentTarget(text: string): string | undefined {
    for (const pattern of DOCUMENT_TARGET_PATTERNS) {
        const match = String(text || '').match(pattern);
        const target = sanitizeDocumentTarget(String(match?.[1] || ''));
        if (target) return target;
    }
    return undefined;
}

function inferCloseSavePreference(text: string): boolean | undefined {
    if (DOCUMENT_SAVE_FALSE_PATTERNS.some((pattern) => pattern.test(text))) {
        return false;
    }
    if (DOCUMENT_SAVE_TRUE_PATTERNS.some((pattern) => pattern.test(text))) {
        return true;
    }
    return undefined;
}

function extractCreateDocumentParams(text: string): Record<string, any> {
    const params: Record<string, any> = {};
    const sizeMatch = String(text || '').match(/(\d{2,5})\s*[x×*]\s*(\d{2,5})/i);
    if (sizeMatch) {
        const width = Number(sizeMatch[1]);
        const height = Number(sizeMatch[2]);
        if (Number.isFinite(width) && width > 0) params.width = width;
        if (Number.isFinite(height) && height > 0) params.height = height;
    }

    const namePatterns = [
        /(?:名字叫|名称叫|命名为|名称为|名称是|名字为|名字是|叫做|叫)\s*[:：=]?\s*([^\n，。!！？?]+)/i,
        /(?:名称|名字)\s*[:：=]\s*([^\n，。!！？?]+)/i,
        /(?:名称|名字)\s+([^\n，。!！？?]+)/i
    ];
    const nameMatch = namePatterns.map((pattern) => String(text || '').match(pattern)).find(Boolean);
    const name = trimRoutingCapture(String(nameMatch?.[1] || '')).replace(/\s*的文档$/i, '').trim();
    if (name) {
        params.name = name;
    }

    const presetMatch = String(text || '').match(/(?:预设|preset)\s*([^\n，。!！？?]+)/i);
    const preset = trimRoutingCapture(String(presetMatch?.[1] || ''));
    if (preset) {
        params.preset = preset;
    }

    return params;
}

function isDocumentCreateIntentText(text: string): boolean {
    const value = String(text || '');
    const hasCreateSignal = DOCUMENT_CREATE_PATTERNS.some((pattern) => pattern.test(value));
    if (!hasCreateSignal) return false;

    const hasListSignal = DOCUMENT_LIST_PATTERNS.some((pattern) => pattern.test(value));
    const hasReadOnlyHint = DOCUMENT_READ_ONLY_HINT_PATTERN.test(value);
    const hasNegatedMutation = DOCUMENT_NEGATED_MUTATION_PATTERN.test(value);
    if (hasNegatedMutation && (hasListSignal || hasReadOnlyHint)) return false;

    return true;
}

function isFreshCreativeDesignDraftText(text: string, options?: { excludeCatchAll?: boolean }): boolean {
    const value = String(text || '').trim();
    if (!value) return false;
    if (EXISTING_TEMPLATE_WORKFLOW_HINT_PATTERN.test(value)) return false;
    return FRESH_CREATIVE_DESIGN_DRAFT_PATTERNS.some((pattern) => {
        if (options?.excludeCatchAll && pattern === FRESH_CREATIVE_DESIGN_CATCHALL_PATTERN) return false;
        return pattern.test(value);
    });
}

function normalizeSaveFormat(format?: string): string | undefined {
    const value = String(format || '').trim().toLowerCase();
    if (!value) return undefined;
    if (value === 'tif') return 'tiff';
    if (DOCUMENT_SAVE_FORMATS.includes(value)) return value;
    return undefined;
}

function inferDocumentSaveFormat(text: string): string | undefined {
    const value = String(text || '');
    const extensionMatch = value.match(/\.(psd|psb|png|jpe?g|tiff?|pdf)\b/i);
    const fromExtension = normalizeSaveFormat(extensionMatch?.[1]);
    if (fromExtension) return fromExtension;

    if (/\bpsb\b/i.test(value) || /大型文档/i.test(value)) return 'psb';
    if (/\bpsd\b/i.test(value) || /PSD/i.test(value)) return 'psd';
    if (/\bpng\b/i.test(value)) return 'png';
    if (/\b(?:jpg|jpeg)\b/i.test(value)) return 'jpg';
    if (/\b(?:tif|tiff)\b/i.test(value)) return 'tiff';
    if (/\bpdf\b/i.test(value)) return 'pdf';
    return undefined;
}

function extractExplicitSavePath(text: string): string | undefined {
    const value = String(text || '');
    const quotedMatch = value.match(/["“”'‘’]([^"“”'‘’\n]+\.(?:psd|psb|png|jpe?g|tiff?|pdf))["“”'‘’]/i);
    const quotedPath = trimRoutingCapture(String(quotedMatch?.[1] || ''));
    if (quotedPath) return quotedPath;

    const windowsPathMatch = value.match(/[a-zA-Z]:[\\/][^\n，。!！？?]+?\.(?:psd|psb|png|jpe?g|tiff?|pdf)/i);
    const windowsPath = trimRoutingCapture(String(windowsPathMatch?.[0] || ''));
    if (windowsPath) return windowsPath;

    return undefined;
}

export function extractRequestedOutputPathParams(text: string): Record<string, string> {
    const value = String(text || '').trim();
    if (!/(?:另存为|保存为|存为|保存到|输出到|导出到|save\s+as|output\s+to|export\s+to)/i.test(value)) {
        return {};
    }

    const explicitPath = extractExplicitSavePath(value);
    const cuePathMatch = value.match(
        /(?:另存为|保存为|存为|保存到|输出到|导出到|save\s+as|output\s+to|export\s+to)\s*[:：]?\s*[“"'‘’]?([^\n，。!！?？；;]+?\.(?:psd|psb|png|jpe?g|tiff?|pdf))[”"'‘’]?\s*(?:$|[，。!！?？；;])/i
    );
    const requestedPath = trimRoutingCapture(
        explicitPath || String(cuePathMatch?.[1] || '')
    );
    if (!requestedPath) return {};

    if (/^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(requestedPath)) {
        return { outputPath: requestedPath };
    }

    return { outputRelativePath: requestedPath };
}

function extractSaveDocumentParams(text: string): Record<string, any> {
    const params: Record<string, any> = {};
    const value = String(text || '');
    const format = inferDocumentSaveFormat(text);
    if (format) {
        params.format = format;
    }

    const path = extractExplicitSavePath(text);
    if (path) {
        params.path = path;
        params.saveAs = true;
        const pathFormat = inferDocumentSaveFormat(path);
        if (pathFormat) params.format = pathFormat;
    } else if (/保存到项目|项目(?:的)?\s*(?:PSD|psd)|另存|导出|export|save as/i.test(value)) {
        params.saveAs = true;
    }

    if (/项目(?:的)?\s*(?:PSD|psd)|(?:PSD|psd)\s*(?:中|目录|文件夹)/i.test(value)) {
        params.projectSubdir = 'PSD';
        params.saveAs = true;
        if (!params.format) params.format = 'psd';
    }

    return params;
}

export function extractDocumentManagementRoutingParams(
    text: string,
    action?: string
): Record<string, any> {
    const normalizedAction = String(action || '').trim().toLowerCase();
    if (!normalizedAction) return {};

    const params: Record<string, any> = { action: normalizedAction };

    if (normalizedAction === 'switch' || normalizedAction === 'close') {
        const documentName = extractDocumentTarget(text);
        if (documentName) {
            params.documentName = documentName;
        }
    }

    if (normalizedAction === 'close') {
        const save = inferCloseSavePreference(text);
        if (typeof save === 'boolean') {
            params.save = save;
        }
    }

    if (normalizedAction === 'save') {
        Object.assign(params, extractSaveDocumentParams(text));
    }

    if (normalizedAction === 'create') {
        Object.assign(params, extractCreateDocumentParams(text));
    }

    return params;
}

export function textContainsRoutingSignal(text: string, signal: string): boolean {
    const rawSignal = String(signal || '').trim();
    if (rawSignal.startsWith('regex:')) {
        const source = rawSignal.slice('regex:'.length).trim();
        if (!source) return false;
        try {
            return new RegExp(source, 'i').test(normalizeRoutingText(text));
        } catch {
            return false;
        }
    }

    const normalizedSignal = normalizeRoutingText(signal);
    if (!normalizedSignal) return false;

    const normalizedText = normalizeRoutingText(text);
    const compactText = compactRoutingText(text);
    const compactSignal = compactRoutingText(signal);

    return normalizedText.includes(normalizedSignal)
        || (!!compactSignal && compactText.includes(compactSignal));
}

export function textContainsAnyRoutingSignal(text: string, signals?: string[]): boolean {
    if (!Array.isArray(signals) || signals.length === 0) return false;
    return signals.some((signal) => textContainsRoutingSignal(text, signal));
}

export function textMatchesAllRoutingSignalGroups(text: string, signalGroups?: string[][]): boolean {
    if (!Array.isArray(signalGroups) || signalGroups.length === 0) return false;

    return signalGroups.every((group) => (
        Array.isArray(group)
        && group.length > 0
        && textContainsAnyRoutingSignal(text, group)
    ));
}

export function matchesSkillRoutingIntent(skillId: string, text: string): boolean {
    const normalizedSkillId = normalizeSkillId(skillId);
    const skill = getSkillById(skillId);
    const routing = skill?.routing;
    if (textContainsAnyRoutingSignal(text, routing?.negativeSignals)) return false;
    if (normalizedSkillId && isCanonicalSkillProductionEntry(normalizedSkillId, text)) return true;
    const isMainImageDesignSkill = normalizedSkillId === 'main-image-design';
    // main-image-design 的宽泛 signals 仍只服务白底图/点击图等规格化生产；只有上面的
    // canonical entry 可以把常见创意主图委托绑定到 main-image Manifest。legacy alias
    // 仅用于解析 Manifest，不会把旧规格 executor 暴露给模型。
    if (isMainImageDesignSkill
        && isFreshCreativeDesignDraftText(text)
        && !textContainsAnyRoutingSignal(text, routing?.intentSignals)) {
        return false;
    }
    if (isMainImageDesignSkill && isProjectContextMainImageDeliveryIntent(text)) {
        return true;
    }
    if (normalizedSkillId === 'document-management' && isFreshCreativeDesignDraftText(text)) {
        return false;
    }
    if (normalizedSkillId === 'document-management' && isDocumentCreateIntentText(text)) {
        return true;
    }
    if (normalizedSkillId === 'document-management' && DOCUMENT_LIST_PATTERNS.some((pattern) => pattern.test(text))) {
        return true;
    }
    if (normalizedSkillId === 'project-image-analysis' && isProjectIdentityConversationIntent(text)) {
        return false;
    }
    if (normalizedSkillId === 'project-image-analysis' && isProjectImageAnalysisDeliveryIntent(text)) {
        return false;
    }

    const hasGroupedSignals = Array.isArray(routing?.intentSignalGroups) && routing.intentSignalGroups.length > 0;
    const hasIntentSignals = Array.isArray(routing?.intentSignals) && routing.intentSignals.length > 0;

    if (!hasGroupedSignals && !hasIntentSignals) return false;

    if (hasGroupedSignals) {
        if (!textMatchesAllRoutingSignalGroups(text, routing?.intentSignalGroups)) {
            return false;
        }
    } else if (!textContainsAnyRoutingSignal(text, routing?.intentSignals)) {
        return false;
    }

    return true;
}

export function findSkillRoutingIntent(
    text: string,
    options: FindSkillRoutingIntentOptions = {}
): SkillRoutingIntentMatch | undefined {
    return findSkillRoutingIntents(text, options)[0];
}

/**
 * 返回所有由 Skill 声明自身路由元数据命中的候选。
 *
 * 该函数只做能力归属识别，不执行 Skill、不授予工具权限。调用方需要在存在多个
 * 候选时继续交给模型消歧，不能沿用注册顺序把第一个候选伪装成唯一结论。
 */
export function findSkillRoutingIntents(
    text: string,
    options: FindSkillRoutingIntentOptions = {}
): SkillRoutingIntentMatch[] {
    const includeVisibilities = new Set(options.includeVisibilities || ['user-facing']);
    const includeRouteClasses = options.includeRouteClasses
        ? new Set(options.includeRouteClasses)
        : undefined;
    const excludeSkillIds = new Set(
        (options.excludeSkillIds || [])
            .map((skillId) => normalizeSkillId(skillId))
            .filter((skillId): skillId is string => Boolean(skillId))
    );

    const matches: SkillRoutingIntentMatch[] = [];
    for (const skill of SKILL_REGISTRY) {
        const skillId = normalizeSkillId(skill.id);
        if (!skillId || excludeSkillIds.has(skillId)) continue;
        if (!includeVisibilities.has(skill.visibility)) continue;
        if (includeRouteClasses && (!skill.routeClass || !includeRouteClasses.has(skill.routeClass))) continue;
        if (options.modelDirectExecution !== undefined
            && skill.modelDirectExecution !== options.modelDirectExecution) continue;
        if (!matchesSkillRoutingIntent(skillId, text)) continue;

        matches.push({
            skillId,
            mode: resolveSkillRoutingMode(skillId, text)
        });
    }

    return matches;
}

/**
 * 只有一个声明候选时才返回能力归属；零个或多个都保持未选择。
 * 这是 Harness 的可插拔能力解析，不是业务流程路由：新增 Skill 只需维护自己的
 * declaration，Agent 核心不出现品类名称或专属关键词。
 */
export function findUniqueSkillRoutingIntent(
    text: string,
    options: FindSkillRoutingIntentOptions = {}
): SkillRoutingIntentMatch | undefined {
    // 多交付物属于 DAG 规划问题，不能把其中某个品类词提升成唯一 Runtime Owner。
    // 这里复用 Planner 已有的文档角色投影，只做“是否唯一”的失败关闭，不解析来源
    // 句法、不决定目标，也不授予权限。
    if (inferDesignDocumentRolesFromTaskText(text).length > 1) return undefined;
    const matches = findSkillRoutingIntents(text, options);
    const canonicalProductionMatches = matches.filter((match) => (
        isCanonicalSkillProductionEntry(match.skillId, text)
    ));
    // Runtime Owner 必须同时满足“只有一个声明候选”和“该候选完整命中 canonical
    // production entry”。来源词命中另一个 Skill（用详情页素材做主图）或一个请求包含
    // 多个交付物（先做主图再做详情页）时，即使其中一个 canonical 命中也保持未选择；
    // 由主 Agent 后续通过 declareDesignIntent 拆分/绑定，不能让宽泛领域词抢 Owner。
    if (canonicalProductionMatches.length > 0) {
        if (canonicalProductionMatches.length === 1 && matches.length === 1) {
            return canonicalProductionMatches[0];
        }
        return undefined;
    }
    return matches.length === 1 ? matches[0] : undefined;
}

export function buildSkillRoutingRecommendation(
    text: string,
    options: FindSkillRoutingIntentOptions = {}
): SkillRoutingRecommendation | undefined {
    const match = findUniqueSkillRoutingIntent(text, options);
    if (!match) return undefined;
    return {
        version: 'skill-routing-recommendation/v0',
        skillId: match.skillId,
        capabilityId: `skill.${match.skillId}`,
        ...(match.mode ? { mode: match.mode } : {}),
        source: 'unique_declared_routing_match',
        advisoryOnly: true,
        bindsRuntimeIdentity: false,
        grantsPermission: false
    };
}

export function isSkillRoutingRecommendation(
    value: unknown
): value is SkillRoutingRecommendation {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<SkillRoutingRecommendation>;
    const skillId = normalizeSkillId(candidate.skillId);
    if (!skillId) return false;
    return candidate.version === 'skill-routing-recommendation/v0'
        && candidate.skillId === skillId
        && candidate.capabilityId === `skill.${skillId}`
        && candidate.source === 'unique_declared_routing_match'
        && candidate.advisoryOnly === true
        && candidate.bindsRuntimeIdentity === false
        && candidate.grantsPermission === false
        && Boolean(getSkillById(skillId));
}

/**
 * 用户在输入框 Skill 选择器里显式指定技能时的 selection-only handoff（codex 式）。
 * 用户点击本身就是权威，跳过文本正则与 mode 推断（derivedFromTaskText: false）；
 * 安全 gate 全部保留——非生产语境（问句/寒暄）、
 * 禁用 Skill bridge、只读上限时不产生 handoff，选择静默不生效。
 * 该交接不执行 Skill，也不授予 Tool 权限。
 */
export function buildRuntimeSelectedSkillHandoffFromUserSelection(input: {
    userSelectedSkillId?: string;
    intentControlPlane?: Pick<
        AgentIntentControlPlaneDecision,
        'requestKind' | 'toolScope' | 'executionAuthorization'
    >;
    skillBridgePolicy?: 'allow' | 'forbid';
    deniedToolDomains?: readonly string[];
    toolScopeCeiling?: 'none' | 'knowledge_search' | 'read_only' | 'write_photoshop';
}): RuntimeSelectedSkillHandoff | undefined {
    const skillId = normalizeSkillId(input.userSelectedSkillId);
    if (!skillId) return undefined;
    if (input.skillBridgePolicy === 'forbid') return undefined;
    if (input.toolScopeCeiling === 'none' || input.toolScopeCeiling === 'read_only') return undefined;
    if (input.deniedToolDomains?.includes('photoshop')) return undefined;

    const intentControlPlane = input.intentControlPlane;
    if (intentControlPlane?.requestKind !== 'autonomous_execution') return undefined;
    if (intentControlPlane.toolScope !== 'write_photoshop') return undefined;
    if (intentControlPlane.executionAuthorization !== 'confirmed_tool_required') return undefined;

    const skill = getSkillById(skillId);
    if (skill?.routeClass !== 'business-workflow') return undefined;
    if (skill.modelDirectExecution !== 'forbidden') return undefined;

    return buildRuntimeSelectedSkillHandoff({
        skillId,
        source: 'user_explicit_selection',
        routeClass: skill.routeClass,
        directExecution: skill.modelDirectExecution
    });
}

export function resolveSkillRoutingMode(skillId: string, text: string): string | undefined {
    const normalizedSkillId = normalizeSkillId(skillId);
    if (normalizedSkillId === 'document-management' && isDocumentCreateIntentText(text)) {
        return 'create';
    }
    if (normalizedSkillId === 'document-management' && DOCUMENT_LIST_PATTERNS.some((pattern) => pattern.test(text))) {
        return 'list';
    }
    if (normalizedSkillId && isCanonicalSkillProductionEntry(normalizedSkillId, text)) return 'execute';

    const skill = getSkillById(skillId);
    const modeSignals = skill?.routing?.modeSignals;
    if (!modeSignals || typeof modeSignals !== 'object') return undefined;

    for (const [mode, signals] of Object.entries(modeSignals)) {
        if (textContainsAnyRoutingSignal(text, signals)) {
            return mode;
        }
    }

    return undefined;
}
