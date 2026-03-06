/**
 * 文案处理子系统
 *
 * 负责文案的：
 * 1. 广告法合规净化（CopyGuard）
 * 2. 质量评审 + 回退改写（CopyReview）
 * 3. 排版适配：长度裁剪、换行、连贯性（CopyLayoutFit）
 *
 * 品类无关设计：候选文案由知识库 / AI 生成，本模块不内置品类模板。
 */

import type { FillPlan, CopyPlaceholder } from './detail-page.types';

// ==================== 类型 ====================

export interface CopyEvidence {
    keywords: string[];
    factHint: string;
    sceneHint: string;
}

export interface CopyQualityResult {
    score: number;
    adSenseScore: number;
    evidenceScore: number;
    safetyScore: number;
    expressiveScore: number;
    reasons: string[];
    hasNegativeAssociation: boolean;
}

export interface CopyReviewDecision {
    finalContent: string;
    originalContent: string;
    quality: CopyQualityResult;
    replaced: boolean;
    flagged: boolean;
    candidates: Array<{ text: string; score: number }>;
}

export interface CopyLayoutFitResult {
    text: string;
    changed: boolean;
    overflowRisk: boolean;
    lineCount: number;
}

export interface CopyReviewOptions {
    minScore: number;
    candidateCount: number;
    strategy: 'replace' | 'flag' | 'keep';
    screenType?: string;
    brandTone?: string;
    creativeStyle?: 'natural' | 'playful' | 'professional';
}

export interface CopyLayoutFitOptions {
    lineBreakStyle?: 'balanced' | 'compact';
    titleMaxLines?: number;
    subtitleMaxLines?: number;
    bodyMaxLines?: number;
}

// ==================== 常量 ====================

const AD_WORD_PATTERNS: RegExp[] = [
    /必买/, /闭眼入/, /冲就完事/, /全网最低/,
    /第一名/, /顶流/, /立省/, /错过再等/, /绝不后悔/,
];

const NEGATIVE_WORD_PATTERNS: RegExp[] = [
    /恶心/, /脏/, /臭/, /病菌/, /病毒/, /霉/,
];

const NEGATIVE_ASSOCIATIONS: Array<{ left: RegExp; right: RegExp }> = [
    { left: /脚|袜|足部/, right: /食物|蛋糕|面包|牛奶|饮料|水果|餐/ },
];

const BANNED_PATTERNS: Array<[RegExp, string]> = [
    [/国家级/g, ''], [/第一(?![线二三四五六七八九十])/g, ''],
    [/顶级/g, ''], [/永久/g, ''], [/包治/g, ''],
    [/无敌/g, ''], [/100%/g, ''],
];

const SOFTENER_PAIRS: Array<[RegExp, string]> = [
    [/最/g, '更'], [/绝对/g, '更'], [/必须/g, '建议'], [/保证/g, '尽量'],
];

const KEYWORD_BLACKLIST = new Set([
    'screen', 'type', 'image', 'copy', 'icon', 'detail', 'product', 'scene', 'plan', 'layer', 'group',
    '图片', '文案', '图层', '分组', '详情', '设计', '屏', '模板', '占位', '产品', '素材',
]);

// ==================== 文本工具 ====================

export function normalizeTextTokens(text: string): string[] {
    const matches = String(text || '').toLowerCase().match(/[\u4e00-\u9fa5a-z0-9]{2,}/g) || [];
    return Array.from(new Set(matches));
}

function estimateCharUnit(ch: string): number {
    if (/[\u4e00-\u9fa5]/.test(ch)) return 1;
    if (/[A-Z]/.test(ch)) return 0.72;
    if (/[a-z0-9]/.test(ch)) return 0.58;
    if (/[，,。\.；;：:、!！\?？]/.test(ch)) return 0.35;
    if (/\s/.test(ch)) return 0.28;
    return 0.8;
}

function estimateTextUnits(text: string): number {
    let sum = 0;
    for (const ch of String(text || '')) {
        if (ch === '\n') continue;
        sum += estimateCharUnit(ch);
    }
    return sum;
}

function trimByUnits(text: string, maxUnits: number): string {
    if (maxUnits <= 0) return '';
    let used = 0;
    let out = '';
    for (const ch of String(text || '')) {
        const next = used + estimateCharUnit(ch);
        if (next > maxUnits) break;
        out += ch;
        used = next;
    }
    return out.trim();
}

export function tokenOverlapRatio(a: string, b: string): number {
    const aSet = new Set(normalizeTextTokens(a));
    const bSet = new Set(normalizeTextTokens(b));
    if (aSet.size === 0 || bSet.size === 0) return 0;
    let inter = 0;
    aSet.forEach(token => { if (bSet.has(token)) inter++; });
    return inter / Math.min(aSet.size, bSet.size);
}

function basenameWithoutExt(filePath: string): string {
    const normalized = String(filePath || '').replace(/\\/g, '/');
    const base = normalized.split('/').pop() || normalized;
    return base.replace(/\.[a-z0-9]+$/i, '');
}

// ==================== 1. CopyGuard — 广告法合规净化 ====================

export function applyCopyGuard(
    text: string,
    options?: { screenType?: string; brandTone?: string }
): string {
    const raw = (text || '').trim();
    if (!raw) return raw;

    let guarded = raw.replace(/[!！]{2,}/g, '！').replace(/\s+/g, ' ').trim();

    for (const [pattern] of BANNED_PATTERNS) {
        guarded = guarded.replace(pattern, '');
    }
    for (const [pattern, replacement] of SOFTENER_PAIRS) {
        guarded = guarded.replace(pattern, replacement);
    }

    const maxLength = options?.screenType?.toLowerCase?.().includes('hero') ? 18 : 24;
    if (guarded.length > maxLength) {
        guarded = guarded.slice(0, maxLength);
    }

    if (options?.brandTone === 'professional') {
        guarded = guarded.replace(/[！!]+$/g, '');
    }

    guarded = guarded.replace(/[，,]{2,}/g, '，').replace(/[。\.]{2,}/g, '。').trim();
    return guarded || raw;
}

// ==================== 2. CopyReview — 质量评审 ====================

function inferSceneHint(screenType: string): string {
    const t = String(screenType || '').toLowerCase();
    if (t.includes('首屏') || t.includes('hero') || t.includes('kv')) return '品牌展示';
    if (t.includes('穿搭') || t.includes('outfit')) return '搭配场景';
    if (t.includes('面料') || t.includes('fabric') || t.includes('材质')) return '材质细节';
    if (t.includes('痛点') || t.includes('solution')) return '用户痛点';
    if (t.includes('参数') || t.includes('spec')) return '规格对比';
    return '日常场景';
}

export function buildCopyEvidence(plan: FillPlan): CopyEvidence {
    const keywordSeed: string[] = [];
    keywordSeed.push(plan.screenType || '');
    keywordSeed.push(plan.screenName || '');
    for (const image of plan.images || []) {
        if (image.imagePath) keywordSeed.push(basenameWithoutExt(image.imagePath));
        keywordSeed.push(String((image as any).assetType || ''));
        keywordSeed.push(String(image.zone || ''));
    }

    const tokens = normalizeTextTokens(keywordSeed.join(' ')).filter(t => !KEYWORD_BLACKLIST.has(t));
    const factHint = tokens.find(t => t.length >= 2) || '细节设计';
    const sceneHint = inferSceneHint(plan.screenType);
    return { keywords: tokens.slice(0, 18), factHint, sceneHint };
}

export function evaluateCopyQuality(text: string, evidence: CopyEvidence): CopyQualityResult {
    const normalized = String(text || '').trim();
    if (!normalized) {
        return {
            score: 0, adSenseScore: 0.4, evidenceScore: 0, safetyScore: 1,
            expressiveScore: 0.2, reasons: ['文案为空'], hasNegativeAssociation: false,
        };
    }

    const tokens = normalizeTextTokens(normalized);

    // 广告感评估
    let adPenalty = 0;
    for (const pattern of AD_WORD_PATTERNS) {
        if (pattern.test(normalized)) adPenalty += 0.2;
    }
    adPenalty += Math.min(0.2, ((normalized.match(/[!！]/g) || []).length) * 0.08);
    if (normalized.length > 28) adPenalty += 0.08;
    const adSenseScore = Math.max(0, 1 - adPenalty);

    // 图文证据
    let overlap = 0;
    for (const token of evidence.keywords) {
        if (tokens.includes(token)) overlap++;
    }
    const evidenceScore = evidence.keywords.length > 0
        ? Math.min(1, (overlap / Math.min(6, evidence.keywords.length)) + (normalized.includes(evidence.factHint) ? 0.12 : 0))
        : 0.6;

    // 安全性
    let hasNegativeAssociation = false;
    for (const pair of NEGATIVE_ASSOCIATIONS) {
        if (pair.left.test(normalized) && pair.right.test(normalized)) {
            hasNegativeAssociation = true;
            break;
        }
    }
    const hasNegativeWords = NEGATIVE_WORD_PATTERNS.some(p => p.test(normalized));
    const safetyScore = (hasNegativeAssociation || hasNegativeWords) ? 0 : 1;

    // 表现力（通用动词/形容词/场景）
    let expressiveScore = 0.45;
    if (/[\u4e00-\u9fa5]{2,}/.test(normalized) && normalized.length >= 4) expressiveScore += 0.15;
    if (normalized.length >= 6 && normalized.length <= 20) expressiveScore += 0.12;
    if (/[，,；;：:]/.test(normalized)) expressiveScore += 0.08;
    expressiveScore = Math.min(1, expressiveScore);

    const score = Math.max(0, Math.min(1,
        adSenseScore * 0.3 + evidenceScore * 0.35 + safetyScore * 0.2 + expressiveScore * 0.15
    ));

    const reasons: string[] = [];
    if (adSenseScore < 0.65) reasons.push('广告感偏强');
    if (evidenceScore < 0.5) reasons.push('图文证据弱');
    if (safetyScore < 1) reasons.push('存在负面联想风险');
    if (expressiveScore < 0.55) reasons.push('表现力不足');

    return { score, adSenseScore, evidenceScore, safetyScore, expressiveScore, reasons, hasNegativeAssociation };
}

/**
 * 生成候选文案（基于 evidence 构建通用结构，不绑定特定品类）
 */
export function buildCopyCandidates(
    evidence: CopyEvidence,
    count: number,
    options?: {
        screenType?: string;
        brandTone?: string;
        creativeStyle?: 'natural' | 'playful' | 'professional';
    }
): string[] {
    const fact = evidence.factHint || '细节设计';
    const scene = evidence.sceneHint || '日常场景';
    const style = options?.creativeStyle || (options?.brandTone === 'playful' ? 'playful' : options?.brandTone === 'professional' ? 'professional' : 'natural');
    const sceneLabel = scene.replace(/场景|展示|说明/g, '').trim() || scene;

    const naturalSeed = [
        `${fact}，让${sceneLabel}更舒服`,
        `看得见的${fact}，用起来更安心`,
        `${fact}不抢戏，体验却更到位`,
        `${fact}在细节里，感受会更明显`,
        `把${fact}做好，日常自然更顺手`,
    ];
    const playfulSeed = [
        `${fact}认真在线，可爱和效率一起加分`,
        `看着乖，跑起来也不掉链子`,
        `${fact}拿捏住了，今天也能轻松开跑`,
        `别看低调，${fact}这块真的很会`,
        `${fact}不喧哗，舒服却很有存在感`,
    ];
    const professionalSeed = [
        `${fact}清晰可见，${sceneLabel}更稳定`,
        `${fact}与结构协同，体验更可靠`,
        `以${fact}为支点，${sceneLabel}表现更均衡`,
        `${fact}支撑日常强度，细节更经得起看`,
        `${fact}聚焦实际体验，表达更克制`,
    ];

    const styleSeed = style === 'playful' ? playfulSeed : (style === 'professional' ? professionalSeed : naturalSeed);
    const fallbackSeed = [...naturalSeed, ...playfulSeed, ...professionalSeed];
    const dedup = Array.from(new Set([...styleSeed, ...fallbackSeed])).slice(0, Math.max(1, count));
    return dedup.map(item => applyCopyGuard(item, options));
}

export function reviewCopyWithFallback(
    originalText: string,
    evidence: CopyEvidence,
    options: CopyReviewOptions
): CopyReviewDecision {
    const guardedOriginal = applyCopyGuard(originalText, { screenType: options.screenType, brandTone: options.brandTone });
    const originalQuality = evaluateCopyQuality(guardedOriginal, evidence);
    const candidatesRaw = buildCopyCandidates(
        evidence, options.candidateCount,
        { screenType: options.screenType, brandTone: options.brandTone, creativeStyle: options.creativeStyle }
    );

    const candidateScores = candidatesRaw
        .map(text => ({ text, score: evaluateCopyQuality(text, evidence).score }))
        .sort((a, b) => b.score - a.score);

    const bestCandidate = candidateScores[0];
    let finalContent = guardedOriginal;
    let finalQuality = originalQuality;
    let replaced = false;

    const needsAction = originalQuality.score < options.minScore || originalQuality.hasNegativeAssociation;
    if (needsAction && options.strategy === 'replace' && bestCandidate) {
        if (bestCandidate.score >= finalQuality.score + 0.03) {
            finalContent = bestCandidate.text;
            finalQuality = evaluateCopyQuality(finalContent, evidence);
            replaced = true;
        }
    }

    const flagged = finalQuality.score < options.minScore || finalQuality.hasNegativeAssociation;
    return {
        finalContent,
        originalContent: originalText,
        quality: finalQuality,
        replaced,
        flagged: options.strategy !== 'keep' && flagged,
        candidates: candidateScores.slice(0, options.candidateCount),
    };
}

// ==================== 3. CopyLayoutFit — 排版适配 ====================

function compactCopyForCapacity(text: string, maxUnits: number): string {
    let compacted = String(text || '')
        .replace(/\s+/g, ' ')
        .replace(/这个|真的|非常|比较|有点|一种|可以|能够|让你|让人/g, '')
        .replace(/[，,]{2,}/g, '，')
        .replace(/[。\.]{2,}/g, '。')
        .replace(/\s*([，,。；;：:、])\s*/g, '$1')
        .replace(/\s{2,}/g, ' ')
        .trim();

    if (estimateTextUnits(compacted) <= maxUnits) return compacted;

    compacted = compacted.replace(/\s+/g, '').replace(/，/g, '').replace(/。/g, '').trim();
    if (estimateTextUnits(compacted) <= maxUnits) return compacted;
    return trimByUnits(compacted, maxUnits);
}

function splitCopyLines(text: string, unitsPerLine: number, maxLines: number): string[] {
    if (!text) return [''];
    if (maxLines <= 1) return [text.replace(/\n+/g, '').trim()];

    const source = text.replace(/\n+/g, ' ').replace(/\t+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    const lines: string[] = [];
    let current = '';
    let currentUnits = 0;
    let lastBreakPos = -1;
    let processedIndex = -1;

    for (let i = 0; i < source.length; i++) {
        const ch = source[i];
        processedIndex = i;
        const unit = estimateCharUnit(ch);
        current += ch;
        currentUnits += unit;

        if (/[，,。；;：:、\s]/.test(ch) && currentUnits > unitsPerLine * 0.45) {
            lastBreakPos = current.length;
        }

        if (currentUnits > unitsPerLine) {
            if (lastBreakPos > 1) {
                lines.push(current.slice(0, lastBreakPos).trim());
                current = current.slice(lastBreakPos).trim();
                currentUnits = estimateTextUnits(current);
            } else {
                lines.push(current.slice(0, -1).trim());
                current = ch;
                currentUnits = unit;
            }
            lastBreakPos = -1;
            if (lines.length >= maxLines - 1) break;
        }
    }

    const remaining = processedIndex >= 0 ? source.slice(processedIndex + 1) : source;
    const tail = `${current}${remaining}`.trim();
    if (tail) lines.push(tail);
    return lines.filter(Boolean).slice(0, maxLines);
}

function rebalanceCopyLines(lines: string[], unitsPerLine: number): string[] {
    if (lines.length !== 2) return lines;
    const merged = `${lines[0]}${lines[1]}`.trim();
    if (!merged) return lines;

    const totalUnits = estimateTextUnits(merged);
    const target = totalUnits / 2;
    let bestLeft = lines[0];
    let bestRight = lines[1];
    let bestDiff = Math.abs(estimateTextUnits(bestLeft) - target) + Math.abs(estimateTextUnits(bestRight) - target);

    for (let i = 2; i < merged.length - 1; i++) {
        const left = merged.slice(0, i).trim();
        const right = merged.slice(i).trim();
        if (!left || !right) continue;
        const leftUnits = estimateTextUnits(left);
        const rightUnits = estimateTextUnits(right);
        if (leftUnits > unitsPerLine * 1.04 || rightUnits > unitsPerLine * 1.04) continue;
        const boundaryBonus = /[，,。；;：:、\s]/.test(merged[i - 1] || '') ? 0.12 : 0;
        const diff = Math.abs(leftUnits - target) + Math.abs(rightUnits - target) - boundaryBonus;
        if (diff + 0.05 < bestDiff) {
            bestDiff = diff;
            bestLeft = left;
            bestRight = right;
        }
    }

    return [bestLeft, bestRight];
}

export function fitCopyForLayout(
    text: string,
    placeholder: CopyPlaceholder | undefined,
    options?: CopyLayoutFitOptions
): CopyLayoutFitResult {
    const raw = String(text || '').trim();
    if (!raw) return { text: raw, changed: false, overflowRisk: false, lineCount: 0 };

    const role = String(placeholder?.role || 'unknown').toLowerCase();
    const style = options?.lineBreakStyle || 'balanced';
    const width = Number(placeholder?.bounds?.width || 320);
    const fontSize = Number(placeholder?.fontSize || (role === 'title' ? 42 : role === 'subtitle' ? 30 : 24));
    const widthPerLine = Math.max(6, Math.min(26,
        Math.floor(width / Math.max(12, fontSize * (style === 'compact' ? 0.82 : 0.9)))
    ));

    const titleLines = Math.max(1, Math.min(3, Math.round(Number(options?.titleMaxLines) || 2)));
    const subtitleLines = Math.max(1, Math.min(3, Math.round(Number(options?.subtitleMaxLines) || 2)));
    const bodyLines = Math.max(1, Math.min(5, Math.round(Number(options?.bodyMaxLines) || 3)));
    let maxLines = bodyLines;
    if (role === 'title') maxLines = titleLines;
    else if (role === 'subtitle') maxLines = subtitleLines;
    else if (role === 'label') maxLines = 1;
    else if (role === 'unknown') maxLines = 2;

    const maxUnits = widthPerLine * maxLines;
    const compacted = compactCopyForCapacity(raw, maxUnits);
    let lines = splitCopyLines(compacted, widthPerLine, maxLines);
    if (style === 'balanced') lines = rebalanceCopyLines(lines, widthPerLine);

    const joined = lines.join('');
    if (estimateTextUnits(joined) > maxUnits * 1.05 || lines.length > maxLines) {
        const strict = trimByUnits(joined, maxUnits);
        lines = splitCopyLines(strict, widthPerLine, maxLines);
        if (style === 'balanced') lines = rebalanceCopyLines(lines, widthPerLine);
    }

    const finalText = lines.join('\n').trim();
    const overflowRisk = lines.some(line => estimateTextUnits(line) > widthPerLine * 1.08);
    return { text: finalText, changed: finalText !== raw, overflowRisk, lineCount: lines.length };
}
