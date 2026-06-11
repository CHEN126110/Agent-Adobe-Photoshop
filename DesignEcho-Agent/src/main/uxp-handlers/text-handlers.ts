import type { UXPContext } from './types';
import {
    buildCopywritingContextChecklist,
    formatCopywritingFrameworkForPrompt
} from '../../shared/design-copywriting-framework';
import { buildCopywritingDesignAgentOsEvidence } from '../../shared/design-agent-os-contracts';

type CreativeStyle = 'natural' | 'playful' | 'professional';

interface OptimizeTextParams {
    text?: string;
    layerId?: number;
    count?: number;
    creativeStyle?: string;
    targetAudience?: string;
    contentType?: string;
    copyRole?: string;
    lockedKeywords?: string;
    forbiddenKeywords?: string;
    description?: string;
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
    preservedKeywords?: string[];
    missingKeywords?: string[];
    forbiddenHits?: string[];
}

function countContentChars(text: unknown): number {
    return normalizeText(text).replace(/[\r\n]/g, '').length;
}

function normalizeText(text: unknown): string {
    return String(text || '').replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').trim();
}

const STRUCTURAL_PUNCTUATION_PATTERN = /[，。！？、；：""''…—·,.!?;:"“”‘’（）()「」『』《》【】\-]/;

interface PunctuationSlot {
    line: number;
    index: number;
    char: string;
}

function normalizeLineEndings(text: unknown): string {
    return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
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

function buildOptimizePrompt(originalText: string, params: OptimizeTextParams, count: number, strictLength = false): string {
    const creativeStyle = normalizeCreativeStyle(params.creativeStyle);
    const lockedKeywords = normalizeKeywords(params.lockedKeywords);
    const forbiddenKeywords = normalizeKeywords(params.forbiddenKeywords);
    const goalLabels = normalizeGoalLabels(params.goals, params.feedbackTags);
    const targetAudience = typeof params.targetAudience === 'string' ? params.targetAudience.trim() : '';
    const description = typeof params.description === 'string' ? params.description.trim() : '';
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

    const lineStructureDesc = lineCount > 1
        ? `原文共 ${lineCount} 行，每行字数分别为 [${lineCharCounts.join(', ')}]。输出必须保持完全相同的行数、换行位置和每行字数。`
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
        hasImage: Boolean(params.image),
        hasTargetAudience: Boolean(targetAudience),
        hasAudienceInterest: Boolean(targetAudience || description),
        hasVisualAnchors: Boolean(description),
        hasProductFacts: lockedKeywords.length > 0 || Boolean(description),
        hasUserScene: contentTypeLabel !== CONTENT_TYPE_LABELS.auto || Boolean(description),
        hasProductProblem: goalLabels.length > 0 || Boolean(description)
    });
    const lengthConstraint = `1. 字数：每个方案必须恰好 ${charCount} 字，不允许多 1 字，也不允许少 1 字。`;

    return [
        '你是电商产品详情页的文案撰写专家。',
        '任务：根据目标人群、商品事实、图片证据和版式约束重新撰写文案，直接替换 Photoshop 文本图层。',
        '重要边界：当前文本只作为字数、行数、换行、标点和排版占位参考，不作为语义方向参考；不要围绕原文做同义改写。',
        '你不会看到当前文本的真实内容，只能看到它的版式骨架；不要猜测旧文案语义，也不要复用旧文案表达。',
        strictLength ? '本轮是严格重试：上一轮候选未通过版式骨架验收，这次必须先满足版式，再考虑表达。' : '',
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
        '如果图片有氛围、动作、配色、材质、细节，优先围绕这些可见证据展开。',
        '',
        formatCopywritingFrameworkForPrompt(),
        '',
        '【上下文完整性检查】',
        copywritingContext.missing.length > 0
            ? `当前缺口：${copywritingContext.missing.join('；')}`
            : '当前已具备基础文案上下文，可以生成候选。',
        `执行规则：${copywritingContext.rules.join('；')}`,
        '如果缺少图片证据或产品事实，必须写得更克制；不得编造画面、功能、材质、场景或用户痛点。',
        '',
        params.image ? '已附带参考图片，请仔细观察画面内容（产品外观、场景、模特动作等），文案必须与画面可互相印证。' : '',
        `版式骨架（只用于落版，不包含当前文本语义）：\n${layoutSkeletonDesc}`,
        targetAudience ? `目标人群与兴趣方向：${targetAudience}` : '目标人群与兴趣方向：未提供。只能写克制通用表达，不得假设具体身份或生活方式。',
        `内容场景：${contentTypeLabel}`,
        `文案角色：${copyRoleLabel}`,
        description ? `用户补充说明：${description}` : '',
        goalLabels.length > 0 ? `本轮优化目标：${goalLabels.join('、')}。目标之间冲突时，优先保证自然、准确、可落版。` : '',
        revisionNote ? `用户对上一轮结果的具体反馈：${revisionNote}。这次必须针对这个问题修正。` : '',
        `需要 ${count} 个不同版本`,
        `风格倾向：${creativeStyle}`,
        lockedKeywords.length > 0 ? `必须保留的关键词：${lockedKeywords.join('、')}` : '',
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
            `直接输出 ${count} 个纯文案，方案之间用 "---" 分隔。不要加编号、标题、解释或字数统计。`
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
    lockedKeywords: string[],
    forbiddenKeywords: string[],
    goalLabels: string[],
    maxChars?: number
): NormalizedCandidate {
    const originalCharCount = countContentChars(originalText);
    const charCount = countContentChars(text);
    const lengthDiff = charCount - originalCharCount;
    const preservedKeywords = lockedKeywords.filter(keyword => keyword && text.includes(keyword));
    const missingKeywords = lockedKeywords.filter(keyword => keyword && !text.includes(keyword));
    const forbiddenHits = forbiddenKeywords.filter(keyword => keyword && text.includes(keyword));
    const layoutCheck = candidateMatchesLayoutSkeleton(text, originalText);
    const risks: string[] = [];

    if (maxChars && charCount > maxChars) {
        risks.push(`超过最多字数 ${maxChars}`);
    }
    if (lengthDiff !== 0) {
        risks.push(`字数偏差 ${lengthDiff > 0 ? '+' : ''}${lengthDiff}`);
    }
    if (!layoutCheck.ok) {
        risks.push(...layoutCheck.reasons);
    }
    if (missingKeywords.length > 0) {
        risks.push(`缺少保留词：${missingKeywords.join('、')}`);
    }
    if (forbiddenHits.length > 0) {
        risks.push(`命中禁用词：${forbiddenHits.join('、')}`);
    }

    const fitStatus: NormalizedCandidate['fitStatus'] = forbiddenHits.length > 0
        || (maxChars && charCount > maxChars)
        || missingKeywords.length > 0
        || !layoutCheck.ok
        ? 'risk'
        : 'ok';

    const fitLabel = fitStatus === 'ok'
        ? '可直接替换'
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
        preservedKeywords,
        missingKeywords,
        forbiddenHits
    };
}

function applyOriginalLineBreakSkeleton(candidateText: string, originalText: string): string {
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
        const take = Math.min(desiredLength, maxSafeTake);
        rebuilt.push(compactCandidate.slice(cursor, cursor + take));
        cursor += take;
    }

    while (rebuilt.length < targetLineLengths.length) {
        rebuilt.push('');
    }

    return rebuilt.join('\n');
}

function normalizeCandidates(
    rawResult: unknown,
    originalText: string,
    count: number,
    keywords: string[],
    maxChars?: number,
    forbiddenKeywords: string[] = [],
    goalLabels: string[] = []
): {
    candidates: string[];
    candidateDetails: NormalizedCandidate[];
    degraded: boolean;
} {
    const original = normalizeText(originalText);
    const origCharCount = countContentChars(original);
    const allExtracted = Array.from(new Set(
        collectCandidateTexts(rawResult)
            .map(item => normalizeText(item))
            .map(item => countContentChars(item) === origCharCount
                ? applyOriginalLineBreakSkeleton(item, originalText)
                : item)
            .filter(Boolean)
            .filter(item => item !== original)
            .filter(item => fitsTextConstraints(item, maxChars, forbiddenKeywords))
    ));

    const validCandidates = allExtracted
        .filter(text => candidateMatchesLayoutSkeleton(text, originalText).ok);

    const ranked = validCandidates
        .map(text => ({ text, diff: Math.abs(countContentChars(text) - origCharCount) }))
        .sort((a, b) => a.diff - b.diff);

    const finalCandidates = ranked
        .map(item => item.text)
        .slice(0, Math.max(1, count));

    return {
        candidates: finalCandidates,
        candidateDetails: finalCandidates.map((text, index) => buildCandidateDetail(
            text,
            `严格版式方案 ${index + 1}`,
            originalText,
            keywords,
            forbiddenKeywords,
            goalLabels,
            maxChars
        )),
        degraded: finalCandidates.length < count
    };
}

function mergeBestCandidates(originalText: string, count: number, ...candidateGroups: string[][]): string[] {
    const originalCharCount = countContentChars(originalText);
    const ranked = Array.from(new Set(candidateGroups.flat().filter(Boolean)))
        .filter(text => candidateMatchesLayoutSkeleton(text, originalText).ok)
        .map((text, index) => ({
            text,
            index,
            diff: Math.abs(countContentChars(text) - originalCharCount)
        }))
        .sort((a, b) => a.diff - b.diff || a.index - b.index);

    return ranked.slice(0, Math.max(1, count)).map(item => item.text);
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
            const lockedKeywords = normalizeKeywords(params.lockedKeywords);
            const forbiddenKeywords = normalizeKeywords(params.forbiddenKeywords);
            const maxChars = normalizeMaxChars(params.maxChars);
            const goalLabels = normalizeGoalLabels(params.goals, params.feedbackTags);

            let rawResult: unknown = null;
            let retryResult: unknown = null;
            const layoutSkeleton = buildLayoutSkeletonDescription(textContent);
            if (taskOrchestrator) {
                const taskInput: any = {
                    text: buildOptimizePrompt(textContent, params, count, false),
                    context: {
                        source: 'uxp-text-optimize',
                        layoutSkeleton,
                        layerId,
                        count,
                        creativeStyle: normalizeCreativeStyle(params.creativeStyle),
                        targetAudience: normalizeText(params.targetAudience),
                        contentType: normalizeOptionLabel(params.contentType, CONTENT_TYPE_LABELS),
                        copyRole: normalizeOptionLabel(params.copyRole, COPY_ROLE_LABELS),
                        lockedKeywords,
                        forbiddenKeywords,
                        goals: goalLabels,
                        maxChars: maxChars || null,
                        imageSource: normalizeText(params.imageSource),
                        revisionNote: normalizeText(params.revisionNote)
                    }
                };
                if (params.image) {
                    taskInput.image = {
                        data: params.image,
                        mediaType: 'image/png'
                    };
                }
                rawResult = await taskOrchestrator.execute('text-optimize', taskInput);
            }

            let normalized = normalizeCandidates(rawResult, textContent, count, lockedKeywords, maxChars, forbiddenKeywords, goalLabels);

            if (taskOrchestrator && normalized.candidates.length < count) {
                const retryInput: any = {
                    text: buildOptimizePrompt(textContent, params, count, true),
                    context: {
                        source: 'uxp-text-optimize-retry',
                        layoutSkeleton,
                        layerId,
                        count,
                        creativeStyle: normalizeCreativeStyle(params.creativeStyle),
                        targetAudience: normalizeText(params.targetAudience),
                        contentType: normalizeOptionLabel(params.contentType, CONTENT_TYPE_LABELS),
                        copyRole: normalizeOptionLabel(params.copyRole, COPY_ROLE_LABELS),
                        lockedKeywords,
                        forbiddenKeywords,
                        goals: goalLabels,
                        maxChars: maxChars || null,
                        imageSource: normalizeText(params.imageSource),
                        revisionNote: normalizeText(params.revisionNote),
                        retryReason: '候选必须严格匹配版式骨架'
                    }
                };
                if (params.image) {
                    retryInput.image = {
                        data: params.image,
                        mediaType: 'image/png'
                    };
                }
                retryResult = await taskOrchestrator.execute('text-optimize', retryInput);
                const retryNormalized = normalizeCandidates(retryResult, textContent, count, lockedKeywords, maxChars, forbiddenKeywords, goalLabels);
                const mergedCandidates = mergeBestCandidates(
                    textContent,
                    count,
                    retryNormalized.candidates,
                    normalized.candidates
                );
                normalized = {
                    candidates: mergedCandidates,
                    candidateDetails: mergedCandidates.map((text, index) => buildCandidateDetail(
                        text,
                        retryNormalized.candidates.includes(text) ? `严格版式方案 ${index + 1}` : `AI 方案 ${index + 1}`,
                        textContent,
                        lockedKeywords,
                        forbiddenKeywords,
                        goalLabels,
                        maxChars
                    )),
                    degraded: mergedCandidates.length === 0
                };
            }

            const buildDesignAgentOs = (success: boolean, error?: string) => buildCopywritingDesignAgentOsEvidence({
                userInput: normalizeText(params.description) || normalizeText(params.revisionNote) || '撰写文案',
                originalText: textContent,
                layerId: layerId || null,
                candidates: normalized.candidateDetails,
                success,
                degraded: normalized.degraded,
                error,
                hasImage: Boolean(params.image),
                targetAudience: normalizeText(params.targetAudience),
                productBrief: normalizeText(params.description),
                contentType: normalizeOptionLabel(params.contentType, CONTENT_TYPE_LABELS),
                copyRole: normalizeOptionLabel(params.copyRole, COPY_ROLE_LABELS),
                lockedKeywords,
                forbiddenKeywords,
                goals: goalLabels
            });

            if (normalized.candidates.length === 0) {
                const error = '未生成满足原字数、原行数、每行字数和标点骨架的候选。请补充商品简报、目标人群或参考图片后重试。';
                return {
                    success: false,
                    error,
                    layerId: layerId || null,
                    originalText: textContent,
                    candidates: [],
                    candidateDetails: [],
                    degraded: true,
                    designAgentOs: buildDesignAgentOs(false, error),
                    data: retryResult ? { initial: rawResult, retry: retryResult } : rawResult
                };
            }

            return {
                success: true,
                layerId: layerId || null,
                originalText: textContent,
                candidates: normalized.candidates,
                candidateDetails: normalized.candidateDetails,
                degraded: normalized.degraded,
                designAgentOs: buildDesignAgentOs(true),
                data: retryResult ? { initial: rawResult, retry: retryResult } : rawResult
            };
        } catch (error: any) {
            logService?.logAgent('error', `[UXP Handler] 文案撰写失败: ${error.message}`);
            return {
                success: false,
                error: error.message
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
