import type { UXPContext } from './types';
import {
    buildCopywritingContextChecklist,
    formatCopywritingFrameworkForPrompt
} from '../../shared/design-copywriting-framework';
import { buildCopywritingDesignAgentOsRecord } from '../../shared/design-agent-os-contracts';

type CreativeStyle = 'natural' | 'playful' | 'professional';

interface OptimizeTextParams {
    text?: string;
    layerId?: number;
    count?: number;
    creativeStyle?: string;
    targetAudience?: string;
    contentType?: string;
    copyRole?: string;
    forbiddenKeywords?: string;
    description?: string;
    /**
     * 本句要表达的重点（功能卖点或表达方向，如"不掉跟"）。
     *
     * 与 description（商品简报＝产品整体事实）分工不同：这条决定"这一句要完成什么任务"。
     * 没有它时，模型只有人群和商品简报可依，而原文语义又被明令禁止参考，
     * 结果只能往"通用好听"上写——同一个"不掉跟"能写出十几种方向，全凭它猜。
     */
    keyMessage?: string;
    revisionNote?: string;
    feedbackTags?: string[] | string;
    goals?: string[] | string;
    maxChars?: number;
    image?: string; // base64
    imageSource?: string;
    context?: unknown;
    charCount?: number;
    lineCount?: number;
    lineCharCounts?: number[];
    /** @deprecated 旧面板兼容；若提供，只允许等于当前 Agent 模型。 */
    modelId?: string;
}

interface ApplyOptimizeTextParams {
    layerId?: number;
    content?: string;
    baselineContent?: string;
}

interface NormalizedCandidate {
    text: string;
    style?: string;
    charCount?: number;
    reason?: string;
    lengthDiff?: number;
    fitStatus?: 'ok' | 'watch' | 'risk';
    fitLabel?: string;
    goals?: string[];
    risks?: string[];
    forbiddenHits?: string[];
}

function countContentChars(text: unknown): number {
    return normalizeText(text).replace(/[\r\n]/g, '').length;
}

function normalizeText(text: unknown): string {
    // \u88f8 \r \u4e5f\u8981\u5f52\u4e00\uff1aPhotoshop \u6587\u672c\u56fe\u5c42\u7684\u6362\u884c\u5c31\u662f \r\uff0c\u6f0f\u6389\u5b83\u4f1a\u8ba9"\u5019\u9009\u4e0e\u539f\u6587\u76f8\u540c"
    // \u8fd9\u7c7b\u6bd4\u8f83\u6c38\u8fdc\u4e0d\u6210\u7acb\uff0c\u5b57\u6570\u7edf\u8ba1\u4e5f\u4f1a\u628a\u6362\u884c\u7b97\u6210\u5b57\u7b26\u3002
    return String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\u00a0/g, ' ')
        .trim();
}

const STRUCTURAL_PUNCTUATION_PATTERN = /[，。！？、；：""''…—·,.!?;:"“”‘’（）()「」『』《》【】\-]/;

// watch 档字数容差：总字数偏差在此范围内的候选按原版式骨架重排后降档展示，
// 不再整条丢弃（模型精确数字数不可靠，全有全无的验收会把可用文案全部拒掉）。
const WATCH_CHAR_TOLERANCE = 2;

// base64 字节签名 → 图片类型。参考图来源多样（画布快照/剪贴板/粘贴压缩均为 jpeg，
// 本地小图可能是 png/webp），声明值可能缺失或说谎，字节才是 ground truth。
const IMAGE_BASE64_SIGNATURES: Array<{ prefix: string; mediaType: string }> = [
    { prefix: '/9j/', mediaType: 'image/jpeg' },
    { prefix: 'iVBOR', mediaType: 'image/png' },
    { prefix: 'UklGR', mediaType: 'image/webp' },
    { prefix: 'R0lGOD', mediaType: 'image/gif' }
];

function resolveImageMediaType(imageBase64: unknown): string {
    const normalized = String(imageBase64 || '').replace(/^data:image\/[^;]+;base64,/, '').trim();
    const match = IMAGE_BASE64_SIGNATURES.find(item => normalized.startsWith(item.prefix));
    return match?.mediaType || 'image/jpeg';
}

// 句末标点（用于修复候选结尾多余的收束标点）
const SENTENCE_FINAL_PUNCTUATION = /[。！？.!?]+$/;

// 分段分隔符：提示词让模型按「舒｜服｜是」逐字分段（数段比数字数可靠），解析时剥回正常文本。
// 同时识别半角 |。仅当原文本身不含这些字符时才启用分段机制，否则原文用竖线做视觉分隔
// （如「黑|白|灰」）会被误剥、模型分段又会吞掉正文里的竖线。
const SEGMENT_SEPARATOR_PATTERN = /[｜|]/;
const SEGMENT_SEPARATOR_GLOBAL = /[｜|]/g;

// 数字/规格语义标点：夹在字母数字之间承载含义（小数点 9.9、区间 S-M、比号 1:1），
// 不能当作模型多加的装饰标点剥掉，否则会把「9.9元」改成「99元」。
const SEMANTIC_PUNCTUATION_PATTERN = /[.,:/~-]/;
const ALNUM_PATTERN = /[0-9A-Za-z]/;
const CJK_PATTERN = /[一-龥]/;

interface PunctuationSlot {
    line: number;
    index: number;
    char: string;
}

function normalizeLineEndings(text: unknown): string {
    return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * 判断原文是否允许启用分段输出机制：原文本身不含竖线才启用，
 * 否则原文的竖线视觉分隔（如「黑|白|灰」）与分段分隔符冲突。
 */
function originalAllowsSegmentation(originalText: string): boolean {
    return !SEGMENT_SEPARATOR_PATTERN.test(String(originalText || ''));
}

/**
 * 还原分段输出：提示词要求模型按「舒｜服｜是」逐段书写（数段比数字数可靠）。
 * 启用时（原文无竖线）任何残留的 ｜/| 都是分段标记或走样，一律剥除还原为正文，
 * 绝不把带竖线的候选放给用户写进图层；未启用时原样返回，保留正文里合法的竖线。
 */
function stripCandidateSegmentation(text: string, enabled: boolean): string {
    if (!enabled) return String(text || '');
    return String(text || '').replace(SEGMENT_SEPARATOR_GLOBAL, '');
}

/**
 * 剥掉模型多加的装饰性标点（句末/分句标点），但保留承载语义的数字/规格标点。
 * 语义标点（. - : / ~ 夹在字母数字间、· 夹在中文间）不剥，让这类候选自然落
 * watch/risk，而不是被悄悄改写含义（如「9.9元」→「99元」）。
 */
function stripDecorativePunctuation(text: string): string {
    return splitTextLines(text).map(line => {
        const chars = Array.from(line);
        return chars.filter((ch, index) => {
            if (!STRUCTURAL_PUNCTUATION_PATTERN.test(ch)) return true;
            const prev = chars[index - 1] || '';
            const next = chars[index + 1] || '';
            if (SEMANTIC_PUNCTUATION_PATTERN.test(ch) && ALNUM_PATTERN.test(prev) && ALNUM_PATTERN.test(next)) {
                return true;
            }
            if (ch === '·' && CJK_PATTERN.test(prev) && CJK_PATTERN.test(next)) {
                return true;
            }
            return false;
        }).join('');
    }).join('\n');
}

/**
 * 确定性修复：不改文字内容，只处理装饰标点，把"差一点"的候选救活成版式全等。
 * - 原文没有任何标点：剥掉候选里模型多加的装饰标点（保留数字/规格语义标点）。
 * - 原文有标点但不以句末标点收尾：剥掉候选结尾多余的句末标点（模型爱补句号）。
 */
function repairCandidateToSkeleton(candidateText: string, originalText: string): string {
    const originalHasPunctuation = collectPunctuationSlots(originalText).length > 0;
    if (!originalHasPunctuation) {
        return stripDecorativePunctuation(candidateText);
    }
    if (!SENTENCE_FINAL_PUNCTUATION.test(normalizeLineEndings(originalText).trim())) {
        return candidateText.replace(SENTENCE_FINAL_PUNCTUATION, '');
    }
    return candidateText;
}

/**
 * 把骨架不匹配翻译成人话（同时喂给用户候选卡和重试提示词），
 * 去掉旧版"字数偏差 +1 / 字数必须等于 7 / 第1行必须 7 字"三条说同一件事的冗余。
 */
function describeSkeletonMismatch(candidateText: string, originalText: string): string[] {
    const messages: string[] = [];
    const candidateLines = splitTextLines(candidateText);
    const originalLines = splitTextLines(originalText);
    const candidateChars = countContentChars(candidateText);
    const originalChars = countContentChars(originalText);

    if (candidateChars !== originalChars) {
        const diff = candidateChars - originalChars;
        messages.push(`字数 ${candidateChars}，需 ${originalChars}（${diff > 0 ? '+' : ''}${diff}）`);
    }

    if (candidateLines.length !== originalLines.length) {
        messages.push(`行数 ${candidateLines.length}，需 ${originalLines.length}`);
    } else if (originalLines.length > 1) {
        for (let index = 0; index < originalLines.length; index += 1) {
            if (candidateLines[index].length !== originalLines[index].length) {
                messages.push(`第${index + 1}行 ${candidateLines[index].length} 字，需 ${originalLines[index].length} 字`);
            }
        }
    }

    const originalSlots = collectPunctuationSlots(originalText);
    const candidateSlots = collectPunctuationSlots(candidateText);
    if (!samePunctuationSlots(originalSlots, candidateSlots)) {
        // 按字符计数比对：同一标点数量不同（多一个逗号）也要如实说"多了/少了"，
        // 不能落入"位置不同"误导重试模型
        const tally = (slots: PunctuationSlot[]) => slots.reduce((map, slot) => {
            map.set(slot.char, (map.get(slot.char) || 0) + 1);
            return map;
        }, new Map<string, number>());
        const originalTally = tally(originalSlots);
        const candidateTally = tally(candidateSlots);
        const allChars = new Set<string>([...originalTally.keys(), ...candidateTally.keys()]);
        const added: string[] = [];
        const missing: string[] = [];
        for (const ch of allChars) {
            const originalNum = originalTally.get(ch) || 0;
            const candidateNum = candidateTally.get(ch) || 0;
            if (candidateNum > originalNum) added.push(ch);
            else if (originalNum > candidateNum) missing.push(ch);
        }
        if (added.length > 0) messages.push(`多了标点「${added.join('')}」`);
        if (missing.length > 0) messages.push(`缺少标点「${missing.join('')}」`);
        if (added.length === 0 && missing.length === 0) messages.push('标点位置与原文不同');
    }

    return messages;
}

function splitTextLines(text: unknown): string[] {
    return normalizeLineEndings(text).split('\n');
}

function collectPunctuationSlots(text: unknown): PunctuationSlot[] {
    const slots: PunctuationSlot[] = [];
    splitTextLines(text).forEach((line, lineIndex) => {
        line.split('').forEach((char, charIndex) => {
            if (STRUCTURAL_PUNCTUATION_PATTERN.test(char)) {
                slots.push({
                    line: lineIndex + 1,
                    index: charIndex + 1,
                    char
                });
            }
        });
    });
    return slots;
}

function samePunctuationSlots(a: PunctuationSlot[], b: PunctuationSlot[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((slot, index) => {
        const other = b[index];
        return Boolean(other)
            && slot.line === other.line
            && slot.index === other.index
            && slot.char === other.char;
    });
}

function buildLayoutSkeletonDescription(originalText: string): string {
    const lines = splitTextLines(originalText);
    const charCount = countContentChars(originalText);
    const lineCharCounts = lines.map(line => line.length);
    const punctuationSlots = collectPunctuationSlots(originalText);
    const punctuationDesc = punctuationSlots.length > 0
        ? punctuationSlots.map(slot => `第${slot.line}行第${slot.index}字=${slot.char}`).join('；')
        : '无标点';

    return [
        `总字数：${charCount}`,
        `行数：${lines.length}`,
        `每行字数：${lineCharCounts.map((count, index) => `第${index + 1}行${count}字`).join('，')}`,
        `标点骨架：${punctuationDesc}`
    ].join('\n');
}

function candidateMatchesLayoutSkeleton(candidateText: string, originalText: string): { ok: boolean; reasons: string[] } {
    const reasons: string[] = [];
    const originalLines = splitTextLines(originalText);
    const candidateLines = splitTextLines(candidateText);
    const originalCharCount = countContentChars(originalText);
    const candidateCharCount = countContentChars(candidateText);

    if (candidateCharCount !== originalCharCount) {
        reasons.push(`字数必须等于 ${originalCharCount}，当前 ${candidateCharCount}`);
    }

    if (candidateLines.length !== originalLines.length) {
        reasons.push(`行数必须等于 ${originalLines.length}，当前 ${candidateLines.length}`);
    }

    const lineCount = Math.min(candidateLines.length, originalLines.length);
    for (let index = 0; index < lineCount; index += 1) {
        if (candidateLines[index].length !== originalLines[index].length) {
            reasons.push(`第${index + 1}行必须 ${originalLines[index].length} 字，当前 ${candidateLines[index].length} 字`);
        }
    }

    const originalPunctuation = collectPunctuationSlots(originalText);
    const candidatePunctuation = collectPunctuationSlots(candidateText);
    if (!samePunctuationSlots(originalPunctuation, candidatePunctuation)) {
        reasons.push('标点位置或标点字符不一致');
    }

    return {
        ok: reasons.length === 0,
        reasons
    };
}

function normalizeCreativeStyle(style: unknown): CreativeStyle {
    if (style === 'playful' || style === 'professional') return style;
    return 'natural';
}

function normalizeKeywords(input: unknown): string[] {
    return String(input || '')
        .split(/[\n,，;；|]/)
        .map(item => item.trim())
        .filter(Boolean)
        .slice(0, 8);
}

function normalizeFeedbackTags(input: unknown): string[] {
    if (Array.isArray(input)) {
        return input
            .map(item => String(item || '').trim())
            .filter(Boolean)
            .slice(0, 8);
    }

    return String(input || '')
        .split(/[\n,，;；|]/)
        .map(item => item.trim())
        .filter(Boolean)
        .slice(0, 8);
}

const CONTENT_TYPE_LABELS: Record<string, string> = {
    auto: '自动判断',
    main_image: '主图',
    detail_page: '详情页',
    activity: '活动图',
    banner: 'Banner',
    brand_poster: '品牌海报',
    social_cover: '社媒封面'
};

const COPY_ROLE_LABELS: Record<string, string> = {
    auto: '自动判断',
    headline: '主标题',
    subheadline: '副标题',
    benefit: '卖点',
    description: '说明',
    cta: '行动按钮',
    price: '价格',
    slogan: '品牌口号'
};

const GOAL_LABELS: Record<string, string> = {
    clarity: '更清楚',
    conversion: '更有卖点',
    premium: '更高级',
    natural: '更自然',
    promotion: '更促销',
    visual: '更有画面感',
    shorter: '更短',
    risk_reduction: '降低风险',
    太广告: '降低广告感',
    太空: '减少空泛表达',
    不够自然: '更自然',
    更有画面感: '更有画面感',
    偏卖点一点: '更有卖点',
    更生活化: '更生活化'
};

function normalizeOptionLabel(input: unknown, labels: Record<string, string>): string {
    const value = String(input || 'auto').trim();
    if (!value || value === 'auto') return labels.auto || '自动判断';
    return labels[value] || value;
}

function normalizeGoalLabels(...inputs: unknown[]): string[] {
    const raw = inputs.flatMap(input => normalizeFeedbackTags(input));
    return Array.from(new Set(
        raw.map(item => GOAL_LABELS[item] || item).filter(Boolean)
    )).slice(0, 8);
}

function normalizeMaxChars(input: unknown): number | undefined {
    const value = Math.floor(Number(input));
    if (!Number.isFinite(value) || value <= 0) return undefined;
    return Math.min(120, value);
}

interface FailedCandidateSample {
    text: string;
    reasons: string[];
}

// 导出用于真机探针（scripts/probe-text-optimize-live.cjs）：
// 撰写文案的失败大多只在真实模型上复现，探针必须用与运行时完全相同的提示词，
// 否则"复现不了"只是提示词不一致造成的假象。
export function buildOptimizePrompt(
    originalText: string,
    params: OptimizeTextParams,
    count: number,
    strictLength = false,
    previousFailures: FailedCandidateSample[] = [],
    visionAvailable = true
): string {
    const creativeStyle = normalizeCreativeStyle(params.creativeStyle);
    const forbiddenKeywords = normalizeKeywords(params.forbiddenKeywords);
    const goalLabels = normalizeGoalLabels(params.goals, params.feedbackTags);
    const targetAudience = typeof params.targetAudience === 'string' ? params.targetAudience.trim() : '';
    const description = typeof params.description === 'string' ? params.description.trim() : '';
    const keyMessage = typeof params.keyMessage === 'string' ? params.keyMessage.trim() : '';
    const revisionNote = typeof params.revisionNote === 'string' ? params.revisionNote.trim() : '';
    const contentTypeLabel = normalizeOptionLabel(params.contentType, CONTENT_TYPE_LABELS);
    const copyRoleLabel = normalizeOptionLabel(params.copyRole, COPY_ROLE_LABELS);
    const extraContext = typeof params.context === 'string'
        ? params.context.trim()
        : params.context
            ? JSON.stringify(params.context, null, 2)
            : '';

    const charCount = params.charCount || countContentChars(originalText);
    const lineCount = params.lineCount || splitTextLines(originalText).length;
    const lineCharCounts = params.lineCharCounts || splitTextLines(originalText).map(line => line.length);
    const layoutSkeletonDesc = buildLayoutSkeletonDescription(originalText);

    // 分析原文的标点和格式结构
    const punctuationPattern = originalText.split('').filter(ch => /[，。！？、；：""''…—·\-,\.!?;:"]/.test(ch));
    const hasPunctuation = punctuationPattern.length > 0;
    const punctuationHint = hasPunctuation
        ? `原文使用的标点符号有：${[...new Set(punctuationPattern)].join(' ')}。输出必须保留相同的标点风格和位置模式。`
        : '原文没有标点符号，输出也不要添加标点。';

    // 骨架验收口径（含括号等所有结构标点），用于分段格式约束；
    // 与窄口径 hasPunctuation 区分：只含括号的原文骨架仍要求括号在场，不能说"无标点"。
    const originalHasStructuralPunctuation = collectPunctuationSlots(originalText).length > 0;
    // 原文本身含竖线时禁用分段机制，避免与视觉分隔冲突
    const allowSegmentation = originalAllowsSegmentation(originalText);

    const lineStructureDesc = lineCount > 1
        ? [
            `原文共 ${lineCount} 行，每行字数分别为 [${lineCharCounts.join(', ')}]。输出必须保持完全相同的行数、换行位置和每行字数。`,
            '换行同时是阅读节奏：断点必须落在词与词之间，一个词绝不能被拆到两行。',
            '例如「选用更优质新疆棉」不能断成「选用更优质新疆」+「棉」，「不掉跟」「抗菌」「10A」这类词也必须整体待在同一行。',
            '每一行都要能单独读通，不要让某一行以「的、和、也、就、被」这类字起头或收尾。',
            '先想好每行说什么，再凑字数；凑不出来就换一种说法，不要靠切词硬凑。'
        ].join('\n')
        : `原文为单行，共 ${charCount} 个字符。输出也必须为单行。`;

    // 分析结构骨架：哪些是标点/括号（固定位），哪些是内容（可替换位）
    const bracketPairs = [
        { open: '「', close: '」' },
        { open: '『', close: '』' },
        { open: '"', close: '"' },
        { open: '（', close: '）' },
        { open: '(', close: ')' },
    ];
    const hasBrackets = bracketPairs.some(p => originalText.includes(p.open) && originalText.includes(p.close));
    const bracketHint = hasBrackets
        ? '原文中的括号（如「」""（）等）是固定结构，必须原样保留在相同位置，只替换括号内外的文字内容。'
        : '';

    const styleHint = creativeStyle === 'playful'
        ? '表达可以更轻盈一点，但不要油腻，不要为了有趣而硬拗。'
        : creativeStyle === 'professional'
            ? '表达可以更克制、更稳，但不要写成产品说明书。'
            : '表达自然一点，像一句被提炼过的人话，不要像广告。';
    const copywritingContext = buildCopywritingContextChecklist({
        // 看不到图 = 没有画面事实，上下文完整性检查必须按"缺图"算，否则会放行本该更克制的表达
        hasImage: Boolean(params.image) && visionAvailable,
        hasTargetAudience: Boolean(targetAudience),
        hasAudienceInterest: Boolean(targetAudience || description),
        hasVisualAnchors: Boolean(description),
        // 用户点明了本句重点，等于给出了产品事实依据和"这一句要解决什么"，
        // 上下文完整性检查不能再判它"缺少卖点依据"而逼模型走克制通用表达。
        hasProductFacts: Boolean(description) || Boolean(keyMessage),
        hasUserScene: contentTypeLabel !== CONTENT_TYPE_LABELS.auto || Boolean(description),
        hasProductProblem: goalLabels.length > 0 || Boolean(description) || Boolean(keyMessage)
    });
    // 字数是不对称约束：少一个字只是留白，多一个字会把文案撑出画布。
    // 明确告诉模型"实在凑不到就宁可少"，比只喊"必须恰好"更能拿到可用候选。
    const lengthConstraint = [
        `1. 字数：每个方案必须恰好 ${charCount} 字，不允许多 1 字，也不允许少 1 字。`,
        `   实在凑不出恰好 ${charCount} 字时，宁可少 1-2 字，绝对不能多字——多出来的字会撑出画布，这样的候选会被直接丢弃。`,
        lineCount > 1
            ? '   每一行也同样：可以比原行短，绝不能比原行长。'
            : ''
    ].filter(Boolean).join('\n');

    const expertScene = contentTypeLabel === CONTENT_TYPE_LABELS.auto
        ? '电商视觉物料'
        : `电商${contentTypeLabel}`;
    const failureFeedback = previousFailures.length > 0
        ? [
            '【上一轮失败样本】以下候选已被版式验收拒绝，不要重复同样的错误：',
            ...previousFailures.slice(0, 3).map(item => `- 「${item.text.replace(/\n/g, '⏎')}」：${item.reasons.join('；')}`)
        ].join('\n')
        : '';

    return [
        `你是${expertScene}的文案撰写专家。`,
        '任务：根据目标人群、商品事实、图片可见信息和版式约束重新撰写文案，直接替换 Photoshop 文本图层。',
        '重要边界：当前文本只作为字数、行数、换行、标点和排版占位参考，不作为语义方向参考；不要围绕原文做同义改写。',
        '你不会看到当前文本的真实内容，只能看到它的版式骨架；不要猜测旧文案语义，也不要复用旧文案表达。',
        strictLength ? '本轮是严格重试：上一轮候选未通过版式骨架验收，这次必须先满足版式，再考虑表达。' : '',
        failureFeedback,
        '',
        // 本句重点必须放在任务开头，而不是混在背景信息里：
        // 它决定"这一句要完成什么任务"，是所有候选的共同出发点。
        keyMessage
            ? [
                '【本句必须表达的重点】',
                keyMessage,
                '所有候选都要围绕这个重点写，这是本次撰写的唯一任务。',
                '同一个重点可以有多种表达角度（用户感受、使用状态、场景、对比、设计意图等），',
                `请让 ${count} 个候选走不同角度，而不是同一句话换词。`,
                '不要把这个重点和其它卖点并列堆在一句里；重点之外的信息最多作为衬托。',
                '如果画面或已知事实不足以支撑这个重点，就写得更克制，但不得偏题去写别的卖点，也不得编造证据。'
            ].join('\n')
            : '【本次没有指定表达重点】用户未说明这一句要表达什么，只能依据人群、商品简报与画面写克制通用的表达，不要自行假设某个具体功能卖点。',
        '',
        '【优秀文案标准】',
        '0. 文案先从产品背后的人开始：先判断写给谁、他们在意什么、会被什么内容吸引。',
        '1. 文案要替画面说话，不要脱离图片自说自话。画面能证明的优先写，画面证明不了的少写或不写。',
        '2. 文案不是介绍产品参数，而是把产品特征翻译成用户能感受到的好处和情绪。',
        '3. 文案要自然、有表现力，像一句被提炼过的人话，不要像广告，也不要像说明书。',
        '4. 文案要有分寸感，不说太满，不绝对，不用推销腔，不制造购买压力。',
        '5. 文案要避免负面联想、低俗联想和奇怪比喻，不能让人产生不适。',
        '6. 一句文案只抓住这一屏最值得说的那个点，不要把卖点、功能、情绪、场景全部堆在一句里。',
        '',
        '【写作顺序】',
        '先判断目标人群，再判断兴趣方向，再看图上最明显的内容，最后把产品价值写成用户能感受到的生活瞬间。',
        '不要从当前文本推断卖点或情绪；当前文本只提供排版骨架。',
        '',
        '【绝对禁止】',
        '- 禁止广告腔、营销腔、喊口号、逼单、施压。',
        '- 禁止空泛大词，如“高级感”“品质生活”“时尚百搭”。',
        '- 禁止绝对化承诺，如“永不起球”“完全不勒”“任何人都适合”。',
        '- 禁止与脚、袜子、身体产生不适或廉价联想。',
        '- 禁止写成参数说明书，只讲属性不讲感受。',
        '',
        '【表达要求】',
        styleHint,
        '优先写用户能感受到的变化、搭配感、穿着状态、场景共鸣。',
        '如果图片有氛围、动作、配色、材质、细节，优先围绕这些可见内容展开。',
        '',
        '注意：下方框架中的模板例句自带标点和长度，只作内容方向参考；你输出的字数、行数和标点必须完全服从后面的版式骨架，不得照搬例句的标点习惯。',
        formatCopywritingFrameworkForPrompt(),
        '',
        '【上下文完整性检查】',
        copywritingContext.missing.length > 0
            ? `当前缺口：${copywritingContext.missing.join('；')}`
            : '当前已具备基础文案上下文，可以生成候选。',
        `执行规则：${copywritingContext.rules.join('；')}`,
        '如果缺少图片可见信息或产品事实，必须写得更克制；不得编造画面、功能、材质、场景或用户痛点。',
        '',
        // 视觉诚实：只有当前执行模型确实能读图时才说"已附带图片"。
        // 模型看不到图却让它"仔细观察画面"，只会逼出臆造的画面描述。
        params.image
            ? (visionAvailable
                ? '已附带参考图片，请仔细观察画面内容（产品外观、场景、模特动作等），文案必须与画面可互相印证。'
                : '用户提供了参考图片，但当前 Agent 模型不具备读图能力，这张图不会随本次请求传给你。禁止描述或猜测画面内容，只依据下方文字事实撰写。')
            : '',
        `版式骨架（只用于落版，不包含当前文本语义）：\n${layoutSkeletonDesc}`,
        targetAudience ? `目标人群与兴趣方向：${targetAudience}` : '目标人群与兴趣方向：未提供。只能写克制通用表达，不得假设具体身份或生活方式。',
        `内容场景：${contentTypeLabel}`,
        `文案角色：${copyRoleLabel}`,
        // 商品简报＝产品整体事实；本句重点＝这一句的任务。两者角色不同，不能混为一谈。
        description ? `商品简报（产品整体事实，供取材，不必全部写进这一句）：${description}` : '',
        keyMessage ? `再次强调：这一句的任务是表达「${keyMessage}」。` : '',
        goalLabels.length > 0 ? `本轮优化目标：${goalLabels.join('、')}。目标之间冲突时，优先保证自然、准确、可落版。` : '',
        revisionNote ? `用户对上一轮结果的具体反馈：${revisionNote}。这次必须针对这个问题修正。` : '',
        `需要 ${count} 个不同版本`,
        `风格倾向：${creativeStyle}`,
        forbiddenKeywords.length > 0 ? `禁止出现的词：${forbiddenKeywords.join('、')}` : '',
        extraContext ? `补充上下文：\n${extraContext}` : '',
        '',
        [
            '【硬约束 - 违反将被丢弃】',
            lengthConstraint,
            `2. 标点：原文有什么标点，输出就有什么标点，位置和数量一致。${punctuationHint}`,
            bracketHint,
            `3. 换行：${lineStructureDesc}`,
            '4. 版式：保持当前文本的视觉占位、行数、换行和标点骨架，但不要沿用当前文本的语义方向。',
            forbiddenKeywords.length > 0 ? `5. 禁用词：不得出现 ${forbiddenKeywords.join('、')}。` : '',
            '6. 禁止：不要为了好听硬造画面，不要写和图片无关的内容，不要把短语拆散成列举。',
            '',
            '【输出格式】',
            `直接输出 ${count} 个纯文案候选，候选之间用单独一行 "---" 分隔。不要加编号、标题、解释或字数统计。`,
            allowSegmentation
                ? '每个候选按分段格式书写：每个字、每个标点各占一段，段与段之间用「｜」分隔；原文有几行就写几行，每行单独分段。'
                : '',
            allowSegmentation
                ? '写完每一行先逐段清点：段数必须等于该行要求的字数，数不对就重写这一行再输出。'
                : '',
            allowSegmentation
                ? (originalHasStructuralPunctuation
                    ? '标点（含括号等）也占一段，必须落在与原文相同的段位上。'
                    : '原文没有标点：所有段都必须是文字，不允许出现标点段（包括句号）。')
                : '',
            allowSegmentation
                ? '格式示例（仅演示 4 字一行的分段写法，与内容无关）：如｜沐｜春｜风'
                : ''
        ].filter(Boolean).join('\n')
    ].filter(Boolean).join('\n');
}

function collectCandidateTexts(source: unknown): string[] {
    if (!source) return [];

    if (typeof source === 'string') {
        const trimmed = normalizeText(source);
        if (!trimmed) return [];

        const jsonMatch = trimmed.match(/```json\s*([\s\S]*?)\s*```/i);
        if (jsonMatch) {
            try {
                return collectCandidateTexts(JSON.parse(jsonMatch[1]));
            } catch {
                return [];
            }
        }

        // 优先按 "---" 分隔符拆分方案（保留每个方案内的换行）
        if (/^-{3,}\s*$/m.test(trimmed)) {
            const sections = trimmed
                .split(/^-{3,}\s*$/m)
                .map(s => s.trim())
                .filter(s => s.length >= 2);
            if (sections.length > 1) return sections;
        }

        // 按编号前缀拆分（如 "方案A：..." 或 "1. ..."），保留段落内换行
        const numberedPattern = /^(?:方案\s*[A-Za-z\d][\s:：.、]|[A-Za-z]\s*[.、:：]\s|\d+\s*[.)、:：]\s)/m;
        if (numberedPattern.test(trimmed)) {
            const sections = trimmed
                .split(/\n(?=方案\s*[A-Za-z\d][\s:：.、]|[A-Za-z]\s*[.、:：]\s|\d+\s*[.)、:：]\s)/)
                .map(s => s.replace(/^(?:方案\s*[A-Za-z\d][\s:：.、]|[A-Za-z]\s*[.、:：]\s|\d+\s*[.)、:：]\s)/, '').trim())
                .filter(s => s.length >= 2);
            if (sections.length > 1) return sections;
        }

        const lines = trimmed
            .split(/\n+/)
            .map(line => line.replace(/^\s*(?:[-*•]|\d+[.)、:：])\s*/, '').trim())
            .filter(Boolean)
            .filter(line => line.length >= 2);

        if (lines.length > 1) return lines;

        const sentenceParts = trimmed
            .split(/[；;]\s*|\n+/)
            .map(item => item.replace(/^\s*(?:[-*•]|\d+[.)、:：])\s*/, '').trim())
            .filter(Boolean);

        return sentenceParts.length > 1 ? sentenceParts : [trimmed];
    }

    if (Array.isArray(source)) {
        return source.flatMap(item => collectCandidateTexts(item));
    }

    if (typeof source === 'object') {
        const record = source as Record<string, unknown>;
        const priorityFields = [
            'suggestions',
            'candidates',
            'versions',
            'choices',
            'texts',
            'data',
            'result',
            'text',
            'content',
            'finalContent'
        ];

        for (const field of priorityFields) {
            if (field in record) {
                const values = collectCandidateTexts(record[field]);
                if (values.length > 0) return values;
            }
        }

        const inlineText = ['text', 'content', 'finalContent']
            .map(field => normalizeText(record[field]))
            .find(Boolean);
        return inlineText ? [inlineText] : [];
    }

    return [];
}

function fitsTextConstraints(text: string, maxChars: number | undefined, forbiddenKeywords: string[]): boolean {
    if (maxChars && countContentChars(text) > maxChars) return false;
    return !forbiddenKeywords.some(keyword => keyword && text.includes(keyword));
}

function buildCandidateDetail(
    text: string,
    reason: string,
    originalText: string,
    forbiddenKeywords: string[],
    goalLabels: string[],
    maxChars?: number,
    protectedTerms: string[] = []
): NormalizedCandidate {
    const originalCharCount = countContentChars(originalText);
    const charCount = countContentChars(text);
    const lengthDiff = charCount - originalCharCount;
    const forbiddenHits = forbiddenKeywords.filter(keyword => keyword && text.includes(keyword));
    const layoutCheck = candidateMatchesLayoutSkeleton(text, originalText);
    const risks: string[] = [];

    if (maxChars && charCount > maxChars) {
        risks.push(`超过最多字数 ${maxChars}`);
    }
    if (!layoutCheck.ok) {
        risks.push(...describeSkeletonMismatch(text, originalText));
    }
    if (forbiddenHits.length > 0) {
        risks.push(`命中禁用词：${forbiddenHits.join('、')}`);
    }
    // 换行可读性：字数行数全对但把词切两半，读起来照样是坏文案，必须让用户看见
    const lineBreakIssues = describeLineBreakIssues(text, protectedTerms);
    risks.push(...lineBreakIssues);

    // 溢出风险：字数偏差是不对称的——少字只是留白多一点，多字会把文本撑宽/撑高，
    // 直接超出原图层占位甚至画布。所以"多"一律禁止替换，"少"仍按容差放行。
    const overflowIssues = describeOverflowRisks(text, originalText);
    risks.push(...overflowIssues);

    // 三档验收：ok=版式全等可直接替换；watch=小偏差（字数差在容差内且行数一致），
    // 允许替换但提示核对版面；risk=偏差过大或违反用户明示约束，展示但禁止替换。
    let fitStatus: NormalizedCandidate['fitStatus'];
    if (forbiddenHits.length > 0
        || (maxChars && charCount > maxChars)
        || overflowIssues.length > 0) {
        fitStatus = 'risk';
    } else if (layoutCheck.ok) {
        // 版式全等但换行读不通：不拦替换（版面是对的），但要降到 watch 并说清楚，
        // 否则候选卡会显示"约束检查已通过"，把断词问题盖过去。
        fitStatus = lineBreakIssues.length > 0 ? 'watch' : 'ok';
    } else if (Math.abs(lengthDiff) <= WATCH_CHAR_TOLERANCE
        && splitTextLines(text).length === splitTextLines(originalText).length) {
        fitStatus = 'watch';
    } else {
        fitStatus = 'risk';
    }

    const fitLabel = fitStatus === 'ok'
        ? '可直接替换'
        : fitStatus === 'watch'
            ? (layoutCheck.ok && lineBreakIssues.length > 0 ? '可替换 · 换行需确认' : '可替换 · 建议核对版面')
            : '不符合版式';

    return {
        text,
        charCount,
        lengthDiff,
        reason,
        fitStatus,
        fitLabel,
        goals: goalLabels,
        risks,
        forbiddenHits
    };
}

// 不宜起行的虚词/助词：一行以它们开头，说明断点切在词中间或句子承接处。
const BAD_LINE_START_CHARS = '的了着过和与也都就而但在是被把给让对从向往到于其之所等吗呢吧啊嘛呀';
// 不宜结行的字：以它们收尾同样说明词被切开。
const BAD_LINE_END_CHARS = '的和与又或者且很更最不没被把让给对从向往到于之其所每该另在是像用有为也就都还再才把将';
// 常做词尾、几乎不会起行的字（服饰电商高频构词成分）。
// 用户没打过的词（如"肌肤"）靠保护词表兜不住，这类字能补上一层：
// 真机实测出现过「…贴着肌 / 肤走路时…」这种断法。命中只降档提示、不拒绝候选，
// 所以偶有误判的代价很小（多一句"换行需确认"），漏判的代价是产出读不通的文案。
const SUFFIX_LIKE_LINE_START_CHARS = '肤棉绒丝袜跟口边袖领腰纹感度性层型款装料线扣缝';

// 虚词/功能字：含这些字的片段不算"词"，否则"在脚""的柔"这种组合会被当成词保护起来，
// 断点无处可落、提示满屏噪音。
const FUNCTION_CHARS = '的了着过和与也都就而但在是被把给让对从向往到于其之所等吗呢吧啊很更最不没每该另或者且又将把';

/** 取出内容性 n-gram（跳过含虚词的片段），用于"哪几个字是一个词"的判断。 */
function extractContentNGrams(text: unknown, minSize = 2, maxSize = 4): string[] {
    const grams: string[] = [];
    const normalized = normalizeText(text);
    if (!normalized) return grams;
    // 换行是硬边界：一个词不可能跨行存在。抹平换行再取 n-gram，会把原文自己断点
    // 两侧的字（如「棉花」+「柔软」→「花柔」）当成词，于是连正常断行的候选也被误报。
    for (const chunk of normalized.split(/[\n\s，。、；：！？,.;:!?（）()「」【】]+/)) {
        const cleaned = chunk.trim();
        if (cleaned.length < minSize) continue;
        for (let size = minSize; size <= maxSize; size += 1) {
            for (let start = 0; start + size <= cleaned.length; start += 1) {
                const gram = cleaned.slice(start, start + size);
                if (Array.from(gram).some(ch => FUNCTION_CHARS.includes(ch))) continue;
                grams.push(gram);
            }
        }
    }
    return grams;
}

/**
 * 用同一批候选互相当词典：一个字组合如果在两条以上候选里都**完整**出现过，
 * 它就是个词——那么把它拆到两行的那一条，就是断错了。
 *
 * 这是本轮的关键手段：中文没有分词器，靠内置字表永远补不全（真机上「菱格」
 * 就漏掉了），而模型自己写的其它候选恰好提供了免费且贴合当前品类的证据。
 */
export function buildConsensusLexicon(candidateTexts: string[], minSupport = 2): string[] {
    const support = new Map<string, number>();
    for (const text of candidateTexts) {
        // 同一条候选内部重复出现不算多个证据，按候选去重
        for (const gram of new Set(extractContentNGrams(text))) {
            support.set(gram, (support.get(gram) || 0) + 1);
        }
    }
    return Array.from(support.entries())
        .filter(([, count]) => count >= minSupport)
        .map(([gram]) => gram);
}

/**
 * 从用户填的「本句重点」和「商品简报」里取出要保护的词。
 *
 * 中文没有空格，判断"哪几个字是一个词"需要分词器；但用户自己打出来的字串本身就是
 * 最可靠的词典——他写了"新疆棉"，这三个字就不该被换行拆开。取 2-5 字的连续片段，
 * 只用于"断点避让"和"如实提示"，不作为硬性拒绝条件，误判成本很低。
 */
export function buildProtectedTerms(...inputs: unknown[]): string[] {
    const terms = new Set<string>();
    for (const input of inputs) {
        const text = normalizeText(input);
        if (!text) continue;
        // 按标点/空白切成语义片段，再取 n-gram
        for (const chunk of text.split(/[\s，。、；：！？,.;:!?（）()「」【】\n]+/)) {
            const cleaned = chunk.trim();
            if (cleaned.length < 2) continue;
            for (let size = 2; size <= 5; size += 1) {
                for (let start = 0; start + size <= cleaned.length; start += 1) {
                    terms.add(cleaned.slice(start, start + size));
                }
            }
        }
    }
    return Array.from(terms);
}

/** 候选里哪些受保护的词被换行切断了（压平后还在、带换行就没了＝被切开）。 */
function findLineBrokenTerms(text: string, protectedTerms: string[]): string[] {
    const normalized = normalizeLineEndings(text);
    if (!normalized.includes('\n')) return [];
    const compact = normalized.replace(/\n/g, '');
    return protectedTerms.filter(term => compact.includes(term) && !normalized.includes(term));
}

/**
 * 结构性的坏断行（不依赖任何词表）：
 * - 孤字行：整行只有一个字，几乎一定是词被切剩下的尾巴（"…更优质新疆 / 棉"）
 * - 虚词起行 / 虚词收行：断点落在词或句子承接处
 * - 数字、字母串被切断：型号规格被拦腰砍（10A、S-M、9.9）
 */
function describeStructuralLineBreakIssues(text: string): string[] {
    const lines = splitTextLines(text);
    if (lines.length <= 1) return [];
    const issues: string[] = [];

    lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        if (index > 0 && Array.from(trimmed).length === 1) {
            issues.push(`第${index + 1}行只有「${trimmed}」一个字，像是把词拆断了`);
            return;
        }
        if (index > 0 && BAD_LINE_START_CHARS.includes(trimmed[0])) {
            issues.push(`第${index + 1}行以「${trimmed[0]}」起行，读起来断在词中间`);
        } else if (index > 0 && SUFFIX_LIKE_LINE_START_CHARS.includes(trimmed[0])) {
            const tail = lines[index - 1].trim().slice(-1);
            issues.push(`第${index + 1}行以「${trimmed[0]}」起行，「${tail}${trimmed[0]}」像是被换行拆开的词`);
        }
        if (index < lines.length - 1) {
            const lastChar = trimmed[trimmed.length - 1];
            if (BAD_LINE_END_CHARS.includes(lastChar)) {
                issues.push(`第${index + 1}行以「${lastChar}」收尾，读起来没断干净`);
            }
            const nextLine = (lines[index + 1] || '').trim();
            if (nextLine && ALNUM_PATTERN.test(lastChar) && ALNUM_PATTERN.test(nextLine[0])) {
                issues.push(`第${index + 1}行末尾的「${lastChar}${nextLine[0]}」被换行切开了`);
            }
        }
    });

    return Array.from(new Set(issues));
}

/**
 * 溢出风险：只看"比原文多"的方向。
 *
 * 点文字的行宽由该行字数决定，段落文字的高度由总字数决定——两种情况下"多字"都会
 * 把文案撑出原来的占位甚至画布，而"少字"最多是留白多一点。所以这里不做对称容差：
 * 任何一行比原版长、或总字数比原版多，都算溢出风险，禁止直接替换。
 */
function describeOverflowRisks(candidateText: string, originalText: string): string[] {
    const issues: string[] = [];
    const candidateLines = splitTextLines(candidateText);
    const originalLines = splitTextLines(originalText);

    // 文本块的宽度由**最长的那一行**决定，不是每一行各自决定。
    // 逐行比对会把「第1行少1字、第2行多1字」这种整体更窄的候选也拦掉——
    // 真机上「堆堆袜口松松搭在脚踝 / 菱格低调不抢镜」就是这种：读得通、也没变宽。
    const candidateWidest = Math.max(...candidateLines.map(line => line.length), 0);
    const originalWidest = Math.max(...originalLines.map(line => line.length), 0);
    if (candidateWidest > originalWidest) {
        issues.push(`最长一行 ${candidateWidest} 字，比原版最宽的一行多 ${candidateWidest - originalWidest} 字，会变宽甚至超出画布`);
    }

    // 高度由行数决定
    if (candidateLines.length > originalLines.length) {
        issues.push(`行数 ${candidateLines.length}，比原版多 ${candidateLines.length - originalLines.length} 行，会往下顶`);
    }

    return issues;
}

/** 综合的换行可读性问题描述（结构性 + 用户词被拆）。 */
function describeLineBreakIssues(text: string, protectedTerms: string[]): string[] {
    const issues = describeStructuralLineBreakIssues(text);
    const brokenTerms = findLineBrokenTerms(text, protectedTerms);
    if (brokenTerms.length > 0) {
        // 只报最长的那个，避免 n-gram 把同一处问题报成一串
        const longest = brokenTerms.sort((a, b) => b.length - a.length)[0];
        issues.push(`换行把「${longest}」拆到了两行`);
    }
    return issues;
}

/** 某个断点位置是否可接受（不制造孤字、不切断词、不切断数字串）。 */
function isAcceptableBreakPosition(
    compact: string,
    position: number,
    protectedTerms: string[]
): boolean {
    if (position <= 0 || position >= compact.length) return false;
    const before = compact[position - 1];
    const after = compact[position];
    if (BAD_LINE_START_CHARS.includes(after)) return false;
    if (SUFFIX_LIKE_LINE_START_CHARS.includes(after)) return false;
    if (BAD_LINE_END_CHARS.includes(before)) return false;
    if (ALNUM_PATTERN.test(before) && ALNUM_PATTERN.test(after)) return false;
    // 落在受保护词内部就不能断
    return !protectedTerms.some(term => {
        const start = position - 1;
        for (let offset = Math.max(0, start - term.length + 1); offset <= start; offset += 1) {
            if (compact.startsWith(term, offset) && offset + term.length > position) return true;
        }
        return false;
    });
}

// 断点允许偏离原版式的字数（越界会让版式验收降档，所以只给很小的余量）
const LINE_BREAK_SEARCH_TOLERANCE = 2;

/**
 * 在目标断点附近找一个读得通的位置：先试原位置，再按"离得越近越优先"向两侧找。
 * 全都不合适就用原位置——宁可保持版式全等并如实标注，也不擅自改变行长。
 */
function findReadableBreakTake(input: {
    compact: string;
    cursor: number;
    idealTake: number;
    maxSafeTake: number;
    protectedTerms: string[];
}): number {
    const { compact, cursor, idealTake, maxSafeTake, protectedTerms } = input;
    if (idealTake <= 0) return idealTake;

    // 顺序有讲究：先原位置（版式全等），再往左（行更短＝不会撑宽），最后才往右。
    // 往右会让这一行比原版更长，点文字会直接变宽、超出画布，所以放在最后并由验收标注。
    const candidates: number[] = [idealTake];
    for (let delta = 1; delta <= LINE_BREAK_SEARCH_TOLERANCE; delta += 1) {
        candidates.push(idealTake - delta);
    }
    for (let delta = 1; delta <= LINE_BREAK_SEARCH_TOLERANCE; delta += 1) {
        candidates.push(idealTake + delta);
    }

    for (const take of candidates) {
        if (take <= 0 || take > maxSafeTake) continue;
        if (isAcceptableBreakPosition(compact, cursor + take, protectedTerms)) return take;
    }
    return idealTake;
}

function applyOriginalLineBreakSkeleton(
    candidateText: string,
    originalText: string,
    protectedTerms: string[] = []
): string {
    const original = String(originalText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const originalLines = original.split('\n');
    if (originalLines.length <= 1) {
        return String(candidateText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '');
    }

    const compactCandidate = String(candidateText || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\n/g, '');

    const targetLineLengths = originalLines.map(line => line.length);
    const rebuilt: string[] = [];
    let cursor = 0;

    for (let index = 0; index < targetLineLengths.length; index += 1) {
        const remainingLines = targetLineLengths.length - index - 1;
        const remainingChars = Math.max(0, compactCandidate.length - cursor);

        if (index === targetLineLengths.length - 1) {
            rebuilt.push(compactCandidate.slice(cursor));
            break;
        }

        const desiredLength = targetLineLengths[index];
        const maxSafeTake = Math.max(0, remainingChars - remainingLines);
        const idealTake = Math.min(desiredLength, maxSafeTake);
        // 按字数下刀会把"新疆棉"切成"新疆 / 棉"。允许断点在目标位置附近浮动 ±2 字，
        // 优先选一个不拆词、不留孤字的位置；找不到就退回原位置，由验收如实标注。
        const take = findReadableBreakTake({
            compact: compactCandidate,
            cursor,
            idealTake,
            maxSafeTake,
            protectedTerms
        });
        rebuilt.push(compactCandidate.slice(cursor, cursor + take));
        cursor += take;
    }

    while (rebuilt.length < targetLineLengths.length) {
        rebuilt.push('');
    }

    return rebuilt.join('\n');
}

const FIT_TIER_RANK: Record<'ok' | 'watch' | 'risk', number> = { ok: 0, watch: 1, risk: 2 };

interface CandidateStats {
    collected: number;
    extracted: number;
    ok: number;
    watch: number;
    risk: number;
}

// 同样导出给真机探针：探针要报的是"这次用户能拿到几个可用候选"，
// 而不是"模型说了什么"，所以必须走与运行时同一套归一化与版式验收。
export function normalizeCandidates(
    rawResult: unknown,
    originalText: string,
    count: number,
    maxChars?: number,
    forbiddenKeywords: string[] = [],
    goalLabels: string[] = [],
    protectedTerms: string[] = []
): {
    candidates: string[];
    candidateDetails: NormalizedCandidate[];
    degraded: boolean;
    stats: CandidateStats;
    failureSamples: NormalizedCandidate[];
} {
    const original = normalizeText(originalText);
    const origCharCount = countContentChars(original);
    const segmentationEnabled = originalAllowsSegmentation(originalText);
    const collected = collectCandidateTexts(rawResult)
        .map(item => stripCandidateSegmentation(String(item || ''), segmentationEnabled))
        .map(item => normalizeText(item))
        .filter(Boolean);
    // 断词判定的词典：用户填的词 + 本批候选互证出的词 + 原文里的词。
    // 原文是人写的同品类文案，它用过的组合同样可信；这里只用它的"字组合"做断点判断，
    // 不涉及语义，不违反"原文只作版式骨架"的边界。
    const repaired = collected
        .map(item => repairCandidateToSkeleton(item, originalText))
        .map(item => normalizeText(item))
        .filter(Boolean);
    const lexicon = Array.from(new Set([
        ...protectedTerms,
        ...buildConsensusLexicon([...repaired, original])
    ]));

    const allExtracted = Array.from(new Set(
        repaired
            .map(item => Math.abs(countContentChars(item) - origCharCount) <= WATCH_CHAR_TOLERANCE
                ? applyOriginalLineBreakSkeleton(item, originalText, lexicon)
                : item)
            .filter(Boolean)
            .filter(item => item !== original)
            .filter(item => fitsTextConstraints(item, maxChars, forbiddenKeywords))
    ));

    // 分档排序：先按验收档位（ok -> watch -> risk），同档按字数偏差从小到大
    const evaluated = allExtracted
        .map(text => buildCandidateDetail(text, '', originalText, forbiddenKeywords, goalLabels, maxChars, lexicon))
        .sort((a, b) => {
            const tierDiff = FIT_TIER_RANK[a.fitStatus || 'risk'] - FIT_TIER_RANK[b.fitStatus || 'risk'];
            if (tierDiff !== 0) return tierDiff;
            return Math.abs(a.lengthDiff || 0) - Math.abs(b.lengthDiff || 0);
        });

    // risk 档不凑数：有可用候选（ok/watch）时只展示可用的；
    // 只在没有任何可用候选时才把最接近的 risk 候选作为诊断兜底展示
    const usableCandidates = evaluated.filter(item => item.fitStatus !== 'risk');
    const pickedSource = usableCandidates.length > 0 ? usableCandidates : evaluated;

    const picked = pickedSource
        .slice(0, Math.max(1, count))
        .map((detail, index) => ({
            ...detail,
            reason: detail.fitStatus === 'ok'
                ? `版式全等方案 ${index + 1}`
                : detail.fitStatus === 'watch'
                    ? `近版式方案 ${index + 1}`
                    : `版式外方案 ${index + 1}`
        }));

    const stats: CandidateStats = {
        collected: collected.length,
        extracted: allExtracted.length,
        ok: evaluated.filter(item => item.fitStatus === 'ok').length,
        watch: evaluated.filter(item => item.fitStatus === 'watch').length,
        risk: evaluated.filter(item => item.fitStatus === 'risk').length
    };

    // 重试失败样本取自全部非全等候选（含被 risk 不凑数规则排除出 picked 的那些），
    // 这些恰恰是最有信息量的"错在哪"——若只从 picked 取，会漏掉最典型的失败案例。
    const failureSamples = evaluated
        .filter(item => item.fitStatus !== 'ok')
        .slice(0, 3);

    return {
        candidates: picked.map(item => item.text),
        candidateDetails: picked,
        degraded: usableCandidates.length < count,
        stats,
        failureSamples
    };
}

export function registerTextHandlers(context: UXPContext): void {
    const { wsServer, taskOrchestrator, logService } = context;

    wsServer.registerHandler('optimize-text', async (params: OptimizeTextParams = {}) => {
        logService?.logAgent('info', '[UXP Handler] 收到文案撰写请求');

        try {
            let textContent = normalizeText(params.text);
            let layerId = Number(params.layerId) || undefined;

            if ((!textContent || !layerId) && wsServer.isPluginConnected()) {
                const textResult = await wsServer.sendRequest('getTextContent', layerId ? { layerId } : {});
                textContent = textContent || normalizeText(textResult?.text || textResult?.content);
                layerId = layerId || Number(textResult?.layerId) || undefined;
            }

            if (!textContent) {
                return {
                    success: false,
                    error: '未找到文本内容。请先在 Photoshop 中选中一个文本图层。'
                };
            }

            const count = Math.max(1, Math.min(5, Number(params.count) || 3));
            const forbiddenKeywords = normalizeKeywords(params.forbiddenKeywords);
            const maxChars = normalizeMaxChars(params.maxChars);
            const goalLabels = normalizeGoalLabels(params.goals, params.feedbackTags);

            let rawResult: unknown = null;
            let retryResult: unknown = null;
            // 模型调用的真实失败原因：候选为空时要如实告诉用户是哪一步失败，
            // 不能一律说成"模型输出格式异常"（那是猜测，用户照着猜测无法排查）。
            let modelFailureReason = '';
            // 旧面板可能仍携带历史文案模型。服务端必须拒绝不同模型，不能靠新版 UI 保证边界。
            const requestedModelId = normalizeText(params.modelId);
            if (requestedModelId && taskOrchestrator) {
                const resolved = taskOrchestrator.resolveTaskModelOverride(requestedModelId);
                if (!resolved.ok) {
                    return {
                        success: false,
                        error: `Agent 模型不一致：${resolved.error}`,
                        layerId: layerId || null,
                        originalText: textContent,
                        candidates: [],
                        candidateDetails: [],
                        degraded: true
                    };
                }
            }
            const visionSupport = taskOrchestrator
                ? taskOrchestrator.getTaskVisionSupport('text-optimize')
                : { modelId: '', modelName: '', supportsVision: false };
            // 只在"用户自己挂了参考图"时提示被忽略：自动截取的当前画面是系统行为，
            // 每次生成都弹一条警告只会变成噪音。
            const imageFromUser = Boolean(params.image) && normalizeText(params.imageSource) !== 'canvas-auto';
            const imageIgnored = imageFromUser && !visionSupport.supportsVision;
            const imageIgnoredReason = imageIgnored
                ? `当前 Agent 模型（${visionSupport.modelName || visionSupport.modelId || '未知'}）不支持读图，本次参考图片没有参与撰写；文案只依据文字信息生成。`
                : '';
            const layoutSkeleton = buildLayoutSkeletonDescription(textContent);
            // 让模型多产几个候选：版式验收有损耗，按需求数请求会经常不够挑。
            const generationCount = Math.min(10, count + 5);
            const buildTaskContext = (source: string, extra: Record<string, unknown> = {}) => ({
                source,
                layoutSkeleton,
                layerId,
                count,
                creativeStyle: normalizeCreativeStyle(params.creativeStyle),
                targetAudience: normalizeText(params.targetAudience),
                contentType: normalizeOptionLabel(params.contentType, CONTENT_TYPE_LABELS),
                copyRole: normalizeOptionLabel(params.copyRole, COPY_ROLE_LABELS),
                forbiddenKeywords,
                goals: goalLabels,
                maxChars: maxChars || null,
                imageSource: normalizeText(params.imageSource),
                keyMessage: normalizeText(params.keyMessage),
                revisionNote: normalizeText(params.revisionNote),
                ...extra
            });

            if (taskOrchestrator) {
                // systemPromptOverride：撰写指令直接作为系统提示，
                // 不再叠加编排器的默认文案提示词（两套输出格式约定互相矛盾）。
                const taskInput: any = {
                    systemPromptOverride: buildOptimizePrompt(
                        textContent,
                        params,
                        generationCount,
                        false,
                        [],
                        visionSupport.supportsVision
                    ),
                    context: buildTaskContext('uxp-text-optimize')
                };
                // 模型读不了图就不要发图：编排器最终也会丢掉它，白白多传一份 base64
                if (params.image && visionSupport.supportsVision) {
                    taskInput.image = {
                        data: params.image,
                        mediaType: resolveImageMediaType(params.image)
                    };
                }
                try {
                    rawResult = await taskOrchestrator.execute('text-optimize', taskInput);
                } catch (error: any) {
                    // 首轮失败不直接抛：下面的严格重试仍可能拿到候选，
                    // 真的两轮都失败时再把这里的真实原因报给用户。
                    modelFailureReason = error?.message || String(error);
                    logService?.logAgent('error', `[UXP Handler] 文案撰写首轮模型调用失败: ${modelFailureReason}`);
                }
            } else {
                modelFailureReason = 'Agent 任务调度器未初始化，无法调用 Agent 模型。请重启 Agent 后重试。';
            }

            // 保护词来自用户自己打的字：他写了「新疆棉」，换行就不该把这三个字拆开
            const protectedTerms = buildProtectedTerms(params.keyMessage, params.description);

            let normalized = normalizeCandidates(rawResult, textContent, count, maxChars, forbiddenKeywords, goalLabels, protectedTerms);

            // 重试门槛提到"版式全等数不足"：用户要的是符合版式的候选，watch 只是退而求其次
            if (taskOrchestrator && normalized.stats.ok < count) {
                // 重试时把上一轮最接近的失败候选和具体违规原因喂回给模型，
                // 只说"没通过"而不说错在哪，模型只会换个方式再错一遍。
                // 取 failureSamples（含被 risk 不凑数排除出 picked 的候选），信息量最全。
                const previousFailures: FailedCandidateSample[] = normalized.failureSamples
                    .map(item => ({
                        text: item.text,
                        reasons: item.risks && item.risks.length > 0 ? item.risks : ['未通过版式骨架验收']
                    }));
                // 首轮压根没拿到候选（模型调用失败）时不能自称"严格重试"，
                // 那句"上一轮候选未通过版式验收"会给模型一个不存在的前提。
                const strictRetry = normalized.stats.collected > 0;
                const retryInput: any = {
                    systemPromptOverride: buildOptimizePrompt(
                        textContent,
                        params,
                        generationCount,
                        strictRetry,
                        previousFailures,
                        visionSupport.supportsVision
                    ),
                    context: buildTaskContext('uxp-text-optimize-retry', {
                        retryReason: '候选必须严格匹配版式骨架'
                    })
                };
                if (params.image && visionSupport.supportsVision) {
                    retryInput.image = {
                        data: params.image,
                        mediaType: resolveImageMediaType(params.image)
                    };
                }
                try {
                    retryResult = await taskOrchestrator.execute('text-optimize', retryInput);
                } catch (error: any) {
                    // 重试失败不能连累首轮：此前这里直接抛，会把首轮已经拿到的可用候选一起丢掉。
                    modelFailureReason = modelFailureReason || error?.message || String(error);
                    logService?.logAgent('error', `[UXP Handler] 文案撰写严格重试失败: ${error?.message || error}`);
                }
                // 两轮候选合并后统一分档挑选，保留各轮里最接近版式的结果。
                normalized = normalizeCandidates(
                    [rawResult, retryResult].filter(Boolean),
                    textContent,
                    count,
                    maxChars,
                    forbiddenKeywords,
                    goalLabels,
                    protectedTerms
                );
            }

            const buildDesignAgentOs = (success: boolean, error?: string) => buildCopywritingDesignAgentOsRecord({
                // 本句重点最能代表"用户这次想要什么"，作为运行档案的首选输入描述
                userInput: normalizeText(params.keyMessage)
                    || normalizeText(params.description)
                    || normalizeText(params.revisionNote)
                    || '撰写文案',
                originalText: textContent,
                layerId: layerId || null,
                candidates: normalized.candidateDetails,
                success,
                degraded: normalized.degraded,
                error,
                // 运行档案要记录"模型实际看到了图"，而不是"用户挂了图"
                hasImage: Boolean(params.image) && visionSupport.supportsVision,
                targetAudience: normalizeText(params.targetAudience),
                productBrief: normalizeText(params.description),
                contentType: normalizeOptionLabel(params.contentType, CONTENT_TYPE_LABELS),
                copyRole: normalizeOptionLabel(params.copyRole, COPY_ROLE_LABELS),
                forbiddenKeywords,
                goals: goalLabels
            });

            if (normalized.candidates.length === 0) {
                // 按真实失败环节给出可行动的错误信息，不把版式验收失败误导成上下文缺失。
                // 模型调用本身失败时，把 provider 的真实原因原样带出来——
                // 「可能是输出格式异常或调用失败」这种猜测会让用户无从下手。
                const error = normalized.stats.collected === 0
                    ? (modelFailureReason
                        ? `Agent 模型调用失败：${modelFailureReason}`
                        : '模型返回的内容里没有可解析的候选文案。请重试；若连续失败，请在设置中确认 Agent 模型可用。')
                    : `模型返回的 ${normalized.stats.collected} 个候选全部被过滤：候选命中了禁用词或与原文完全相同。请调整禁用词或重试。`;
                return {
                    success: false,
                    error,
                    imageIgnored,
                    imageIgnoredReason,
                    visionSupported: visionSupport.supportsVision,
                    modelUsed: { id: visionSupport.modelId, name: visionSupport.modelName },
                    layerId: layerId || null,
                    originalText: textContent,
                    candidates: [],
                    candidateDetails: [],
                    degraded: true,
                    stats: normalized.stats,
                    designAgentOs: buildDesignAgentOs(false, error),
                    data: retryResult ? { initial: rawResult, retry: retryResult } : rawResult
                };
            }

            // degraded 时给出与实际形态匹配的提示，避免"全是全等候选却说有偏差""全 risk 却说部分偏差"
            const shownFitStatuses = normalized.candidateDetails.map(item => item.fitStatus);
            const hasCompliant = shownFitStatuses.includes('ok');
            const allRisk = shownFitStatuses.length > 0 && shownFitStatuses.every(status => status === 'risk');
            const degradedMessage = !normalized.degraded
                ? ''
                : allRisk
                    ? '未能生成符合版式的候选，下方为最接近的参考，替换前请务必逐字核对版面。'
                    : hasCompliant
                        ? `已生成 ${normalized.stats.ok} 个符合版式的候选，数量少于 ${count} 个，可直接使用。`
                        : '候选与原版式有偏差，替换前请核对候选卡上的提示。';

            return {
                success: true,
                layerId: layerId || null,
                originalText: textContent,
                candidates: normalized.candidates,
                candidateDetails: normalized.candidateDetails,
                degraded: normalized.degraded,
                degradedMessage,
                imageIgnored,
                imageIgnoredReason,
                visionSupported: visionSupport.supportsVision,
                modelUsed: { id: visionSupport.modelId, name: visionSupport.modelName },
                keyMessage: normalizeText(params.keyMessage),
                stats: normalized.stats,
                designAgentOs: buildDesignAgentOs(true),
                data: retryResult ? { initial: rawResult, retry: retryResult } : rawResult
            };
        } catch (error: any) {
            logService?.logAgent('error', `[UXP Handler] 文案撰写失败: ${error.message}`);
            return {
                success: false,
                error: `文案生成失败：${error.message || '未知错误'}。请重试；若连续失败，请检查 Agent 模型设置。`
            };
        }
    });

    // 兼容旧面板的清单协议；只回传当前唯一 Agent 模型，不再提供独立文案模型选择。
    wsServer.registerHandler('list-copywriting-models', async (params: { query?: string; limit?: number } = {}) => {
        if (!taskOrchestrator) {
            return {
                success: false,
                error: 'Agent 任务调度器未初始化，暂时读不到可用模型清单。请重启 Agent 后重试。'
            };
        }
        try {
            const catalog = taskOrchestrator.listTaskModelCatalog({
                query: params.query,
                limit: params.limit
            });
            return { success: true, ...catalog };
        } catch (error: any) {
            logService?.logAgent('error', `[UXP Handler] 读取文案模型清单失败: ${error?.message || error}`);
            return {
                success: false,
                error: `读取模型清单失败：${error?.message || '未知错误'}`
            };
        }
    });

    wsServer.registerHandler('optimize-text-apply', async (params: ApplyOptimizeTextParams = {}) => {
        logService?.logAgent('info', '[UXP Handler] 收到文案应用请求');

        try {
            const layerId = Number(params.layerId);
            const content = normalizeText(params.content);
            const baselineContent = normalizeText(params.baselineContent);

            if (!layerId || !content) {
                return {
                    success: false,
                    error: '缺少 layerId 或 content，无法应用文案。'
                };
            }

            if (!wsServer.isPluginConnected()) {
                return {
                    success: false,
                    error: 'Photoshop UXP 未连接，无法写入文本图层。'
                };
            }

            const applyResult = await wsServer.sendRequest('setTextContent', {
                layerId,
                content,
                baselineContent
            });

            if (!applyResult?.success) {
                return {
                    success: false,
                    error: applyResult?.error || '文本图层写入失败'
                };
            }

            return {
                success: true,
                data: applyResult
            };
        } catch (error: any) {
            logService?.logAgent('error', `[UXP Handler] 文案应用失败: ${error.message}`);
            return {
                success: false,
                error: error.message
            };
        }
    });
}
