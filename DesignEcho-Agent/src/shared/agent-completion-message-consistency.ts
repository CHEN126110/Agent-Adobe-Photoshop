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
    contractStatus?: unknown;
}

interface TerminalClosureOutcomeLike {
    publicSummary?: unknown;
}

const UNVERIFIED_DESIGN_QUALITY_NOTICE = '文件已经交付；本轮质量检查没有取得完整结论，因此没有把它标为“质量已通过”。';
const DELIVERED_NEEDS_REVIEW_DESIGN_QUALITY_NOTICE = '当前产物已经保存并形成交付结果；设计质量尚未通过，仍有明确问题需要调整，不能把这版称为专业完成。';
const NEEDS_REVIEW_DESIGN_QUALITY_NOTICE = '已有执行结果可以保留，但当前设计质量尚未通过，仍有明确问题需要调整，不能把这版称为专业完成。';
const COMPLETED_RESULT_ALIGNMENT = '本次结果已经完成。';

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

function textExplicitlyStatesDesignQualityUncertainty(value: string): boolean {
    return /(?:设计质量|视觉质量|审美质量|画面质量|成品质量|效果质量|设计|视觉|审美|画面|成品|效果)[^，,。！？!?；;\n]{0,16}(?:尚未|还未|还没|没有|不能|不可|仍需|需要|待)[^，,。！？!?；;\n]{0,10}(?:复核|评审|评价|审核|确认|通过|商用|发布|上架|投放)/u.test(value)
        || /(?:尚未|还未|还没|没有|不能|不可|仍需|需要|待)[^，,。！？!?；;\n]{0,10}(?:专业|最终)?(?:设计|视觉|审美|画面|成品|效果|质量)(?:复核|评审|评价|审核|确认|通过)/u.test(value);
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
        // “主图已完成复核并交付”这类短句没有“视觉/质量”等限定词；质量裁决仍为
        // needs_review 时只保留已经发生的交付事实，不能让 plain `复核` 漏过事实对齐。
        replaceClaim(
            /(?:已经|已)完成(?:最终)?(?:(?:视觉|画面|设计|质量|成品))?复核(?:完成|完毕|通过)?[ \t]*(?:并|且)[ \t]*(?:已经|已)?(?=交付)/gu,
            '已'
        );
        replaceClaim(
            /((?:已|已经)?(?:全部|整体)?(?:完成|做好|做完|制作完成|处理完成))(?:了)?[ \t]*(?:并|且|、)[ \t]*(?:已经|已)?(?:完成)?(?:最终)?(?:视觉|画面|设计|质量|成品)?复核(?:完成|完毕|通过)?(?=[ \t]*(?:$|并|且|同时|因此|所以|:|：))/gu,
            (_match, completedClaim) => String(completedClaim || '')
        );
        replaceClaim(
            /(?:已经|已)(?:完成)?(?:最终)?(?:视觉|画面|设计|质量|成品)复核(?:完成|完毕|通过)?(?=[ \t]*(?:$|并|且|同时|因此|所以|:|：))/gu,
            ''
        );
        replaceClaim(
            /(?:最终)?(?:视觉|画面|设计|质量|成品)复核(?:已经|已)?(?:完成|完毕|通过)(?=[ \t]*(?:$|并|且|同时|因此|所以|:|：))/gu,
            ''
        );
        replaceClaim(/(?:最终)?复核(?:已经|已)?通过(?=[ \t]*(?:$|:|：))/gu, '');
        replaceClaim(
            /(?:经|经过)(?:最终)?(?:视觉|画面|设计|质量|成品)复核(?:确认|检查|通过)?(?=[ \t]*(?:$|并|且|同时|因此|所以|:|：))/gu,
            ''
        );
        replaceClaim(
            /(?:专业)?(?:设计|视觉|审美|成品|画面|效果)?质量(?:已经|已)?(?:检查)?(?:通过|达标|合格|符合(?:要求|标准)?)/gu,
            ''
        );
        replaceClaim(
            /(?:质量检查(?:记录了)?[ \t]*)?(?:可继续优化的建议|质量建议(?:仅作为可选优化)?)/gu,
            ''
        );
        replaceClaim(
            /(?:但[ \t]*)?不影响(?:本次)?交付(?:状态)?/gu,
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

function clauseStatesConcreteUnresolvedFact(clause: string): boolean {
    return /(?:失败|中断|超时|报错|错误|缺少|丢失|阻断|冲突|不可用|未(?:保存|导出|写入|生成|创建|找到|连接)|没有(?:保存|导出|写入|生成|创建|找到|连接))/u.test(clause)
        || /\b(?:error|failed|failure|timeout|unavailable|blocked)\b/iu.test(clause);
}

function cleanRemovedUnderclaimPunctuation(value: string): string {
    const prefix = value.match(/^[ \t]*(?:(?:[-*+]\s+|\d+[.)]\s+|#{1,6}\s+))?/u)?.[0] || '';
    const body = value.slice(prefix.length)
        .replace(/[ \t]+([，,。！？!?；;])/gu, '$1')
        .replace(/^[ \t]*[，,。！？!?；;]+[ \t]*/gu, '')
        .replace(/[ \t]*[，,；;]+[ \t]*$/gu, '')
        .replace(/([，,；;])[ \t]*(?:但|也|并且|且|同时|因此|所以)?[ \t]*(?=[，,。！？!?；;])/gu, '')
        .replace(/([，,。！？!?；;]){2,}/gu, '$1')
        .replace(/[ \t]+$/gu, '');
    const meaningfulBody = body.replace(/[，,。！？!?；;\s]/gu, '');
    return meaningfulBody ? `${prefix}${body}` : '';
}

function alignCompletedUnderclaimInEditableSpan(
    value: string,
    alignQualityUnderclaim: boolean
): { text: string; changed: boolean } {
    let changed = false;
    const aligned = value.replace(/[^，,。！？!?；;\n]+/gu, (rawClause) => {
        if (clauseStatesConcreteUnresolvedFact(rawClause)) return rawClause;
        const semanticClause = rawClause
            .replace(/^[ \t]*(?:[-*+]\s+|\d+[.)]\s+|#{1,6}\s+)/u, '')
            .trim();
        if (/^(?:(?:本轮|本次|这次|当前)?(?:任务|结果|设计|处理|版本)?[ \t]*)?(?:未完成|尚未完成|还没完成|这还不是最终完成状态)$/u.test(semanticClause)) {
            changed = true;
            return '';
        }
        let nextClause = rawClause.replace(
            /(?:(?:(?:本轮|本次|这次|当前)(?:任务|结果|版本|处理|设计)?|任务|结果|当前版本)[ \t]*(?:还没|尚未|仍未|未能|没有)(?:全部)?(?:完成|做完|结束)|(?:本轮|本次|这次|当前)?[ \t]*(?:还)?不能算(?:全部)?完成|(?:(?:本轮|本次|这次|当前)(?:任务|结果|版本)?|任务|结果)[ \t]*(?:仍然?|还)?(?:需要|需|待)(?:继续)?(?:人工|专业|最终)?复核)/gu,
            () => {
                changed = true;
                return '';
            }
        );
        if (alignQualityUnderclaim) {
            nextClause = nextClause.replace(
                /(?:(?:本轮|本次|这次|当前)?(?:设计质量|画面质量))[ \t]*(?:仍然?|还)?(?:需要|需|待)(?:继续)?(?:人工|专业|最终)?复核/gu,
                () => {
                    changed = true;
                    return '';
                }
            );
        }
        return nextClause;
    });
    return {
        text: changed ? cleanRemovedUnderclaimPunctuation(aligned) : aligned,
        changed
    };
}

function alignCompletedUnderclaimOutsideProtectedSpans(
    line: string,
    alignQualityUnderclaim: boolean
): { text: string; changed: boolean } {
    let cursor = 0;
    let changed = false;
    const parts: string[] = [];
    INLINE_PROTECTED_SPAN_PATTERN.lastIndex = 0;
    let match = INLINE_PROTECTED_SPAN_PATTERN.exec(line);
    while (match) {
        const editable = alignCompletedUnderclaimInEditableSpan(
            line.slice(cursor, match.index),
            alignQualityUnderclaim
        );
        parts.push(editable.text, match[0]);
        changed = changed || editable.changed;
        cursor = match.index + match[0].length;
        match = INLINE_PROTECTED_SPAN_PATTERN.exec(line);
    }
    const tail = alignCompletedUnderclaimInEditableSpan(line.slice(cursor), alignQualityUnderclaim);
    parts.push(tail.text);
    return { text: parts.join(''), changed: changed || tail.changed };
}

function hasConcreteUnresolvedFactOutsideProtectedSpans(line: string): boolean {
    let cursor = 0;
    INLINE_PROTECTED_SPAN_PATTERN.lastIndex = 0;
    let match = INLINE_PROTECTED_SPAN_PATTERN.exec(line);
    while (match) {
        if (clauseStatesConcreteUnresolvedFact(line.slice(cursor, match.index))) return true;
        cursor = match.index + match[0].length;
        match = INLINE_PROTECTED_SPAN_PATTERN.exec(line);
    }
    return clauseStatesConcreteUnresolvedFact(line.slice(cursor));
}

/**
 * canonical completed 已经由结构化完成契约签发。模型散文若只笼统少报“还没完成 / 结果待复核”，
 * 将它校正为完成并把质量建议降回可选优化；具体失败事实、引用、代码块和文件说明保持原样。
 */
function alignCompletedResultUnderclaim(
    message: string,
    alignQualityUnderclaim: boolean,
    completionAlignment: string
): string {
    let activeFenceMarker = '';
    let changed = false;
    let hasConcreteUnresolvedFact = false;
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
        hasConcreteUnresolvedFact = hasConcreteUnresolvedFact
            || hasConcreteUnresolvedFactOutsideProtectedSpans(part);
        const result = alignCompletedUnderclaimOutsideProtectedSpans(part, alignQualityUnderclaim);
        changed = changed || result.changed;
        return result.text;
    }).join('');
    if (!changed
        || hasConcreteUnresolvedFact
        || !completionAlignment
        || aligned.includes(completionAlignment)) {
        return aligned;
    }
    return [aligned.trim(), completionAlignment].filter(Boolean).join('\n\n');
}

/**
 * `passed_unverified` 与 `needs_review` 都不提供专业质量或发布适用性证明。
 * 这里只校正模型正文里的事实等级；不评分、不决定审美，也不改变交付状态。
 */
function alignUnprovenDesignQualityClaims(
    message: string,
    notice: string,
    appendGenericNotice = true
): string {
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
    if (!appendGenericNotice) return aligned;
    if (aligned.includes(notice)) return aligned;
    // 正则只能清理已知的冲突措辞，不能穷举“审核完毕 / 检查结束 / 已看过”等自然语言。
    // 结构化 verdict 才是事实源：只要正文没有诚实说明质量仍待确认，就追加一次状态事实。
    // 这样新措辞最多形成“模型说完成 + 系统明确待复核”的可见冲突，不会继续静默假完成。
    const requiresExplicitQualityNonPass = notice === DELIVERED_NEEDS_REVIEW_DESIGN_QUALITY_NOTICE
        || notice === NEEDS_REVIEW_DESIGN_QUALITY_NOTICE;
    if (!changed
        && !requiresExplicitQualityNonPass
        && textExplicitlyStatesDesignQualityUncertainty(String(message || ''))) return message;
    return [aligned, notice].filter(Boolean).join('\n\n');
}

function resolveUnprovenDesignQualityNotice(
    status: unknown,
    contractStatus: unknown
): string | undefined {
    if (status === 'passed_unverified') return UNVERIFIED_DESIGN_QUALITY_NOTICE;
    if (status === 'needs_review') {
        // Artifact 完成只证明文件交付闭合；Evaluation needs_review 仍表示设计质量
        // 没有通过。两个 owner 必须同时诚实投影，不能用“不影响交付”把质量问题降级。
        return contractStatus === 'completed'
            ? DELIVERED_NEEDS_REVIEW_DESIGN_QUALITY_NOTICE
            : NEEDS_REVIEW_DESIGN_QUALITY_NOTICE;
    }
    return undefined;
}

function readTerminalClosurePublicSummary(outcome: TerminalClosureOutcomeLike | null | undefined): string {
    return String(outcome?.publicSummary || '').trim();
}

function appendUniqueTerminalClosureSummary(message: string, publicSummary: string): string {
    const messageKey = String(message || '').replace(/\s+/gu, ' ').trim();
    const summaryKey = publicSummary.replace(/\s+/gu, ' ').trim();
    if (!summaryKey) return message;
    if (messageKey.includes(summaryKey)) return message;
    return [String(message || '').trim(), publicSummary].filter(Boolean).join('\n\n');
}

export type AgentExecutionPresentationDisposition = 'result' | 'failure';

/**
 * UI 展示优先消费结构化执行状态，不能把 `needs_review` 因顶层
 * `success=false` 误排成故障消息。这个函数只决定展示通道，不改写
 * Run 的 success、blocker、质量裁决或完成事实。
 */
export function resolveAgentExecutionPresentationDisposition(input: {
    resultSuccess: boolean;
    executionStatus?: unknown;
}): AgentExecutionPresentationDisposition {
    switch (input.executionStatus) {
        case 'completed':
        case 'awaiting_confirmation':
        case 'needs_review':
            return 'result';
        case 'failed':
        case 'cancelled':
            return 'failure';
        default:
            return input.resultSuccess ? 'result' : 'failure';
    }
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
    terminalClosureOutcome?: TerminalClosureOutcomeLike | null;
}): string {
    const originalMessage = String(input.message || '');
    // DesignVerdict 只描述已经形成的结果质量；等待用户、失败和取消各有自己的结构化终态。
    // 旧逻辑先看 verdict 再看 executionStatus，会把历史/中间 quality verdict 投影到等待或
    // 失败正文，制造“正在等确认，但结果仍待复核”这种互相冲突的用户状态。
    const canProjectDesignQuality = input.executionStatus === 'completed'
        || input.executionStatus === 'needs_review';
    const unprovenDesignQualityNotice = canProjectDesignQuality
        ? resolveUnprovenDesignQualityNotice(
            input.designVerdict?.status,
            input.designVerdict?.contractStatus
        )
        : undefined;
    const rawTerminalClosureSummary = readTerminalClosurePublicSummary(input.terminalClosureOutcome);
    const terminalClosureSummary = rawTerminalClosureSummary && unprovenDesignQualityNotice
        ? alignUnprovenDesignQualityClaims(
            rawTerminalClosureSummary,
            unprovenDesignQualityNotice,
            false
        ).trim()
        : rawTerminalClosureSummary;
    const hasTerminalClosureSummary = Boolean(terminalClosureSummary);
    const qualityAlignedMessage = unprovenDesignQualityNotice
        ? alignUnprovenDesignQualityClaims(
            originalMessage,
            unprovenDesignQualityNotice,
            !hasTerminalClosureSummary
        )
        : originalMessage;
    if (hasTerminalClosureSummary) {
        const terminalAlignedMessage = alignCompletedResultUnderclaim(
            qualityAlignedMessage,
            true,
            ''
        );
        return appendUniqueTerminalClosureSummary(terminalAlignedMessage, terminalClosureSummary);
    }
    const requirements = Array.isArray(input.requirements) ? input.requirements : [];
    const hasUnresolvedStructuredRequirement = requirements.some((requirement) => {
        const status = String(requirement.status || '').trim();
        return status !== 'passed' && status !== 'not_applicable';
    });
    const designQualityNeedsReview = input.designVerdict?.status === 'needs_review';
    const message = input.executionStatus === 'completed'
        && !hasUnresolvedStructuredRequirement
        && !designQualityNeedsReview
        ? alignCompletedResultUnderclaim(
            qualityAlignedMessage,
            false,
            COMPLETED_RESULT_ALIGNMENT
        )
        : qualityAlignedMessage;
    if (input.executionStatus === 'completed'
        || input.executionStatus === 'awaiting_confirmation') {
        return message;
    }
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
