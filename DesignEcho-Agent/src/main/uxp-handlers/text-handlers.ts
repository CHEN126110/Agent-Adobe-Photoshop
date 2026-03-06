import type { UXPContext } from './types';

type CreativeStyle = 'natural' | 'playful' | 'professional';

interface OptimizeTextParams {
    text?: string;
    layerId?: number;
    count?: number;
    creativeStyle?: string;
    lockedKeywords?: string;
    context?: unknown;
}

interface ApplyOptimizeTextParams {
    layerId?: number;
    content?: string;
}

interface NormalizedCandidate {
    text: string;
    style?: string;
    charCount?: number;
    reason?: string;
}

function normalizeText(text: unknown): string {
    return String(text || '').replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').trim();
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

function buildOptimizePrompt(originalText: string, params: OptimizeTextParams, count: number): string {
    const creativeStyle = normalizeCreativeStyle(params.creativeStyle);
    const lockedKeywords = normalizeKeywords(params.lockedKeywords);
    const extraContext = typeof params.context === 'string'
        ? params.context.trim()
        : params.context
            ? JSON.stringify(params.context, null, 2)
            : '';

    return [
        '请基于下面这段设计文案，输出适合电商详情页或主图直接落版的候选文案。',
        `原文：${originalText}`,
        `版本数：${count}`,
        `风格：${creativeStyle}`,
        lockedKeywords.length > 0 ? `必须尽量保留这些关键词：${lockedKeywords.join('、')}` : '',
        extraContext ? `补充上下文：\n${extraContext}` : '',
        '要求：短句优先，避免硬广、夸张承诺和空泛形容；画面可佐证；尽量可直接替换到文本图层。'
    ].filter(Boolean).join('\n\n');
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

function fallbackCandidates(originalText: string, count: number, keywords: string[]): string[] {
    const base = normalizeText(originalText)
        .replace(/[!！]{2,}/g, '！')
        .replace(/[~～]{2,}/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!base) return [];

    const compact = base
        .replace(/非常|真的|超级|立即|马上|赶紧/g, '')
        .replace(/[!！]/g, '')
        .replace(/\s+/g, '')
        .trim() || base;

    const firstClause = compact.split(/[，,。.!！？?]/).map(item => item.trim()).find(Boolean) || compact;
    const keywordHint = keywords.length > 0 ? `${keywords.slice(0, 2).join('、')}更突出` : `${firstClause}更聚焦`;

    return Array.from(new Set([base, compact, firstClause, keywordHint])).slice(0, Math.max(1, count));
}

function normalizeCandidates(
    rawResult: unknown,
    originalText: string,
    count: number,
    keywords: string[]
): {
    candidates: string[];
    candidateDetails: NormalizedCandidate[];
    degraded: boolean;
} {
    const original = normalizeText(originalText);
    const extracted = Array.from(new Set(
        collectCandidateTexts(rawResult)
            .map(item => normalizeText(item))
            .filter(Boolean)
            .filter(item => item !== original)
    ));

    const finalCandidates = extracted.length > 0
        ? extracted.slice(0, Math.max(1, count))
        : fallbackCandidates(originalText, count, keywords);

    return {
        candidates: finalCandidates,
        candidateDetails: finalCandidates.map((text, index) => ({
            text,
            charCount: text.length,
            reason: extracted.length > 0 ? `AI 方案 ${index + 1}` : `降级候选 ${index + 1}`
        })),
        degraded: extracted.length === 0
    };
}

export function registerTextHandlers(context: UXPContext): void {
    const { wsServer, taskOrchestrator, logService } = context;

    wsServer.registerHandler('optimize-text', async (params: OptimizeTextParams = {}) => {
        logService?.logAgent('info', '[UXP Handler] 收到文案优化请求');

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

            let rawResult: unknown = null;
            if (taskOrchestrator) {
                rawResult = await taskOrchestrator.execute('text-optimize', {
                    text: buildOptimizePrompt(textContent, params, count),
                    context: {
                        source: 'uxp-text-optimize',
                        originalText: textContent,
                        layerId,
                        count,
                        creativeStyle: normalizeCreativeStyle(params.creativeStyle),
                        lockedKeywords
                    }
                });
            }

            const normalized = normalizeCandidates(rawResult, textContent, count, lockedKeywords);

            return {
                success: true,
                layerId: layerId || null,
                originalText: textContent,
                candidates: normalized.candidates,
                candidateDetails: normalized.candidateDetails,
                degraded: normalized.degraded,
                data: rawResult
            };
        } catch (error: any) {
            logService?.logAgent('error', `[UXP Handler] 文案优化失败: ${error.message}`);
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
                content
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
