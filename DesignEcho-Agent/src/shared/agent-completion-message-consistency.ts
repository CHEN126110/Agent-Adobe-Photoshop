/**
 * 将模型正文与用户点名交付物的结构化完成事实对齐。
 * 只追加最小事实说明，不改写模型的设计判断，也不从正文反推完成状态。
 */

interface CompletionRequirementLike {
    id?: unknown;
    status?: unknown;
    expected?: unknown;
}

interface DesignVerdictLike {
    status?: unknown;
}

const UNVERIFIED_DESIGN_QUALITY_NOTICE = '产物已经形成，但本轮没有完成专业设计质量评价；是否用于正式发布仍需复核。';
const NEEDS_REVIEW_DESIGN_QUALITY_NOTICE = '已有执行结果可以保留，但当前设计质量仍待复核，尚不能据此确认画面质量通过或可直接使用。';

const INLINE_PROTECTED_SPAN_PATTERN = /`[^`\n]*`|“[^”\n]*”|「[^」\n]*」|『[^』\n]*』|《[^》\n]*》|【[^】\n]*】|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|!?\[[^\]\n]*\](?:\([^\n)]*\))?|https?:\/\/[^\s]+/gu;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function uniqueLabels(requirements: readonly CompletionRequirementLike[]): string[] {
    return Array.from(new Set(requirements.map((requirement) => {
        if (!isRecord(requirement.expected)) return '';
        return String(requirement.expected.label || '').trim();
    }).filter(Boolean)));
}

function textFramesQualityClaimAsConditionalOrAttributed(value: string): boolean {
    return /(?:如果|若|假如|倘若|假设|例如|比如|用户(?:说|表示|要求|写的是)|用户原话|原文|引用)[^。！？!?；;\n]{0,48}(?:复核|评审|评价|审核|确认|批准|质量|商用|商业使用|发布|上架|投放)/u.test(value)
        || /(?:人工|专业|最终)?(?:复核|评审|评价|审核|确认|批准)(?:完成|通过)?后[^。！？!?；;\n]{0,32}(?:商用|商业使用|发布|上架|投放)/u.test(value);
}

function precedingClauseFramesQualityClaim(value: string, clauseOffset: number): boolean {
    const preceding = value.slice(0, clauseOffset).slice(-96);
    return /(?:(?:如果|若|假如|倘若|假设)[^，,。！？!?；;\n]{0,48}|(?:人工|专业|最终)?(?:复核|评审|评价|审核|确认|批准)(?:完成|通过)?后|用户(?:说|表示|要求|写的是)|用户原话|原文|引用)[，,:：；;][ \t]*$/u.test(preceding);
}

function clauseAlreadyStatesQualityUncertainty(clause: string): boolean {
    return /(?:尚未|还未|还没|没有|不能|不可|不应|并非|不是|不代表|仍需|需要|待)[^，,。！？!?；;\n]{0,18}(?:复核|评审|评价|质量|商用|商业使用|发布|上架|投放)/u.test(clause)
        || /(?:质量|效果|画面|设计)[^，,。！？!?；;\n]{0,12}(?:尚未|还未|还没|没有|仍需|需要|待)(?:复核|评审|评价|确认|通过)/u.test(clause)
        || textFramesQualityClaimAsConditionalOrAttributed(clause)
        || /[?？吗么嘛呢]\s*$/u.test(clause);
}

function cleanRemovedClaimPunctuationWithinSpan(value: string): string {
    const prefix = value.match(/^[ \t]*(?:(?:[-*+]\s+|\d+[.)]\s+|#{1,6}\s+))?/u)?.[0] || '';
    const body = value.slice(prefix.length)
        .replace(/[ \t]+([，,。！？!?；;])/gu, '$1')
        .replace(/([，,；;])[ \t]*(?:也|并且|且|同时|因此|所以)?[ \t]*(?=[，,。！？!?；;])/gu, '')
        .replace(/([，,；;]){2,}/gu, '$1')
        .replace(/[，,；;]+([。！？!?])/gu, '$1')
        .replace(/^[ \t]*[，,；;]+[ \t]*/gu, '')
        .replace(/[ \t]*[，,；;]+[ \t]*$/gu, '')
        .replace(/([。！？!?]){2,}/gu, '$1')
        .replace(/[ \t]+$/gu, '');
    const meaningfulBody = body.replace(/[，,。！？!?；;\s]/gu, '');
    if (!meaningfulBody) return prefix ? `${prefix}${UNVERIFIED_DESIGN_QUALITY_NOTICE}` : '';
    return `${prefix}${body}`;
}

function alignUnverifiedClaimsInEditableSpan(value: string): { text: string; changed: boolean } {
    let changed = false;
    const aligned = value.replace(/[^，,。！？!?；;\n]+/gu, (rawClause, clauseOffset: number) => {
        if (clauseAlreadyStatesQualityUncertainty(rawClause)
            || precedingClauseFramesQualityClaim(value, clauseOffset)) {
            return rawClause;
        }
        let clause = rawClause;
        const replaceClaim = (
            pattern: RegExp,
            replacement: string | ((...matches: any[]) => string)
        ): void => {
            clause = clause.replace(pattern, (...matches: any[]) => {
                changed = true;
                return typeof replacement === 'function'
                    ? replacement(...matches)
                    : replacement;
            });
        };

        // 只处理以句末、并列连接词或标点闭合的明确声明，避免把文件名、用途说明或限定表达当承诺。
        replaceClaim(
            /((?:已|已经)?(?:全部|整体)?(?:完成|做好|做完|制作完成|处理完成))(?:了)?[ \t]*(?:并|且|、)[ \t]*(?:已经|已)?(?:完成)?(?:最终)?(?:视觉|画面|设计|质量|成品)?复核(?:完成|完毕|通过)?(?=[ \t]*(?:$|并|且|同时|因此|所以))/gu,
            (_match, completedClaim) => String(completedClaim || '')
        );
        replaceClaim(
            /(?:已经|已)(?:完成)?(?:最终)?(?:视觉|画面|设计|质量|成品)复核(?:完成|完毕|通过)?(?=[ \t]*(?:$|并|且|同时|因此|所以))/gu,
            ''
        );
        replaceClaim(
            /(?:最终)?(?:视觉|画面|设计|质量|成品)复核(?:已经|已)?(?:完成|完毕|通过)(?=[ \t]*(?:$|并|且|同时|因此|所以))/gu,
            ''
        );
        replaceClaim(/(?:最终)?复核(?:已经|已)?通过(?=[ \t]*$)/gu, '');
        replaceClaim(
            /(?:经|经过)(?:最终)?(?:视觉|画面|设计|质量|成品)复核(?:确认|检查|通过)?(?=[ \t]*(?:$|并|且|同时|因此|所以))/gu,
            ''
        );
        replaceClaim(
            /(?:专业)?(?:设计|视觉|审美|成品|画面|效果)?质量(?:已经|已)?(?:检查)?(?:通过|达标|合格|符合(?:要求|标准)?)/gu,
            ''
        );
        replaceClaim(
            /(?:设计|视觉|审美|成品|画面|效果)(?:已经|已)?(?:通过|达到)(?:最终)?(?:质量)?(?:评审|评价|验收|标准)/gu,
            ''
        );
        replaceClaim(
            /(?:可(?:以)?|适合)(?:直接)?(?:用于|用作|作为)[ \t]*[^，,。！？!?；;\n]{0,24}?(?:商品主图|详情页|SKU(?:色卡)?|正式发布|上架|投放|商用|商业使用)(?:投入使用|使用|展示|发布)?(?=[ \t]*(?:$|也|并|且|同时))/giu,
            ''
        );
        replaceClaim(
            /(?:可(?:以)?|适合)(?:直接)?(?:商用|商业使用|上架|投放|正式发布)(?=[ \t]*(?:$|也|并|且|同时))/gu,
            ''
        );
        replaceClaim(
            /(?:已经|已)?达到(?:可)?(?:直接)?(?:商用|商业使用|上架|投放|正式发布|交付)(?:标准|要求)?(?=[ \t]*(?:$|也|并|且|同时))/gu,
            ''
        );
        replaceClaim(
            /(?:(?:这|该)(?:张|稿|版)|当前(?:设计|画面|版本|成品)|设计稿|成品|画面)?[ \t]*(?:(?:已经|已)[ \t]*)?(?:达到[ \t]*)?(?:可(?:以)?|能)[ \t]*(?:直接)?[ \t]*(?:使用|投入使用|用(?:了)?)(?=[ \t]*(?:$|也|并|且|同时))/gu,
            ''
        );
        replaceClaim(/\b(?:production[- ]ready|commercial[- ]ready|quality approved)\b(?=[ \t]*$)/giu, '');
        return clause;
    });
    return {
        text: changed ? cleanRemovedClaimPunctuationWithinSpan(aligned) : value,
        changed
    };
}

function alignUnverifiedClaimsOutsideProtectedSpans(line: string): { text: string; changed: boolean } {
    let cursor = 0;
    let changed = false;
    const parts: string[] = [];
    INLINE_PROTECTED_SPAN_PATTERN.lastIndex = 0;
    let match = INLINE_PROTECTED_SPAN_PATTERN.exec(line);
    while (match) {
        const editable = alignUnverifiedClaimsInEditableSpan(line.slice(cursor, match.index));
        parts.push(editable.text, match[0]);
        changed = changed || editable.changed;
        cursor = match.index + match[0].length;
        match = INLINE_PROTECTED_SPAN_PATTERN.exec(line);
    }
    const tail = alignUnverifiedClaimsInEditableSpan(line.slice(cursor));
    parts.push(tail.text);
    return { text: parts.join(''), changed: changed || tail.changed };
}

function isIndentedMarkdownCodeLine(line: string): boolean {
    return /^(?: {4}|\t)(?!\s*(?:[-*+]\s+|\d+[.)]\s+))/u.test(line);
}

/**
 * `passed_unverified` 与 `needs_review` 都不提供专业质量或发布适用性证明。
 * 这里只校正模型正文里的事实等级；不评分、不决定审美，也不改变交付状态。
 */
function alignUnprovenDesignQualityClaims(message: string, notice: string): string {
    let changed = false;
    let activeFenceMarker = '';
    const aligned = String(message || '').split(/(\r?\n)/u).map((part) => {
        if (/^\r?\n$/u.test(part)) return part;
        const fence = part.match(/^[ \t]*(`{3,}|~{3,})/u)?.[1] || '';
        if (fence) {
            const marker = fence[0];
            if (!activeFenceMarker) activeFenceMarker = marker;
            else if (activeFenceMarker === marker) activeFenceMarker = '';
            return part;
        }
        if (activeFenceMarker || /^[ \t]*>/u.test(part) || isIndentedMarkdownCodeLine(part)) return part;
        const line = alignUnverifiedClaimsOutsideProtectedSpans(part);
        changed = changed || line.changed;
        return line.text;
    }).join('');
    if (!changed) return message;

    if (aligned.includes(notice)) return aligned;
    return [aligned, notice].filter(Boolean).join('\n\n');
}

function resolveUnprovenDesignQualityNotice(status: unknown): string | undefined {
    if (status === 'passed_unverified') return UNVERIFIED_DESIGN_QUALITY_NOTICE;
    if (status === 'needs_review') return NEEDS_REVIEW_DESIGN_QUALITY_NOTICE;
    return undefined;
}

export function synchronizeLastAssistantCompletionMessage<T extends { role?: unknown; content?: unknown }>(input: {
    messages: T[];
    originalMessage: string;
    alignedMessage: string;
}): T[] {
    const originalMessage = String(input.originalMessage || '');
    const alignedMessage = String(input.alignedMessage || '');
    if (!originalMessage.trim() || !alignedMessage.trim() || originalMessage === alignedMessage) return input.messages;

    for (let index = input.messages.length - 1; index >= 0; index -= 1) {
        const message = input.messages[index];
        if (message?.role !== 'assistant' || typeof message.content !== 'string') continue;
        if (message.content !== originalMessage) continue;
        const synchronized = input.messages.slice();
        synchronized[index] = { ...message, content: alignedMessage };
        return synchronized;
    }
    return input.messages;
}

export function alignUserVisibleCompletionMessage(input: {
    message: string;
    executionStatus: string;
    requirements?: readonly CompletionRequirementLike[];
    designVerdict?: DesignVerdictLike;
}): string {
    const originalMessage = String(input.message || '');
    const unprovenDesignQualityNotice = resolveUnprovenDesignQualityNotice(input.designVerdict?.status);
    const message = unprovenDesignQualityNotice
        ? alignUnprovenDesignQualityClaims(originalMessage, unprovenDesignQualityNotice)
        : originalMessage;
    if (input.executionStatus === 'completed'
        || input.executionStatus === 'awaiting_confirmation') {
        return message;
    }
    const requirements = Array.isArray(input.requirements) ? input.requirements : [];
    const incomplete = requirements.filter((requirement) => (
        String(requirement.id || '').startsWith('user-deliverable:')
        && requirement.status !== 'passed'
    ));
    const labels = uniqueLabels(incomplete);
    if (labels.length === 0) return message;

    const labelText = labels.map((label) => `“${label}”`).join('、');
    const notice = `这次还不能算全部完成：${labelText}还没有逐项取得可核对的交付结果。`;
    if (message.includes(notice)) return message;
    return [message, notice].filter(Boolean).join('\n\n');
}
