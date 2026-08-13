/**
 * 从回复正文里切出开头的自我分析段落。
 *
 * 背景：模型的推理有两条出口——provider 原生 reasoning 通道，和回复正文。前者在
 * agent-observation-channels 里被判为私有诊断永不展示，用户看到的过程区内容来自另一次
 * 单独的「公开判断摘要」调用；而那次调用只在有工具调用时才触发。所以零工具回合里，模型
 * 的分析只剩正文一个出口，就出现了「用户只发了一个「在不」…我不应该猜测任务…」这种把
 * 思考过程当答复发出去的正文（真机 2026-08-04）。
 *
 * 这里的处理是**搬家，不是删除**：把正文开头的自我分析切给过程区，剩下的才是答复。
 * 之所以不在正文清洗器里加词表直接删，是因为 chat-response-cleaner 里记着的那次事故——
 * MiMo 与 DeepSeek 两种措辞的优质回复被整段判死，用户侧显示成「当前模型没有生成面向
 * 用户的判断」。删是不可逆的；搬家最坏只是位置不对，用户仍能看到全部内容。
 *
 * 纯逻辑，不读任务文本以外的任何状态，可被 smoke 直接测。
 */

export type AssistantReplyReasoningSplitVersion = 'assistant-reply-reasoning-split/v0';

export interface AssistantReplyReasoningSplit {
    version: AssistantReplyReasoningSplitVersion;
    /** 切出的自我分析段落，送过程区显示；未切分时为空串。 */
    reasoning: string;
    /** 真正给用户看的答复正文；未切分时等于清洗后的原文。 */
    body: string;
    split: boolean;
    /** 机读判断依据，便于影子诊断与 smoke 断言，不面向用户。 */
    reason: string;
}

/**
 * 只扫描开头这几段。自我分析出现在正文中段或末尾时不动它：
 * 那时它多半是有意写给用户的说明（"这里之所以留白，是因为…"），切走反而破坏答复。
 */
const MAX_SCANNED_PREFIX_PARAGRAPHS = 3;

export function splitAssistantReplyReasoningPrefix(content: string): AssistantReplyReasoningSplit {
    const text = String(content || '').trim();
    if (!text) {
        return buildSplit({ reasoning: '', body: text, split: false, reason: 'empty_content' });
    }

    const paragraphs = text
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean);

    // 单段回复永不切分：切了就等于改写用户能看到的唯一一段话，判据一旦误判就是直接毁答复。
    // 混排的自我分析几乎总是独立成段（模型会先写一段分析再另起一段答复），单段场景收益极低。
    if (paragraphs.length < 2) {
        return buildSplit({ reasoning: '', body: text, split: false, reason: 'single_paragraph_never_split' });
    }

    let prefixCount = 0;
    while (
        prefixCount < paragraphs.length
        && prefixCount < MAX_SCANNED_PREFIX_PARAGRAPHS
        && looksLikeSelfNarrationParagraph(paragraphs[prefixCount])
    ) {
        prefixCount += 1;
    }

    if (prefixCount === 0) {
        return buildSplit({ reasoning: '', body: text, split: false, reason: 'no_self_narration_prefix' });
    }

    // 红线：正文不能被掏空。整段回复都被判成自我分析时，说明判据过宽或这本来就是一段
    // 有意写给用户的说明——两种情况都必须原样交付，宁可让用户看到过程，也不能让他看到空回复。
    if (prefixCount >= paragraphs.length) {
        return buildSplit({ reasoning: '', body: text, split: false, reason: 'body_would_be_empty' });
    }

    return buildSplit({
        reasoning: paragraphs.slice(0, prefixCount).join('\n\n'),
        body: paragraphs.slice(prefixCount).join('\n\n'),
        split: true,
        reason: `split_self_narration_prefix:${prefixCount}`
    });
}

/**
 * 判断一个段落是不是「模型在自述处理过程」，而不是在对用户说话。
 *
 * 真机样本（应判 true）：
 *   「用户只发了一个「在不」，这是个不完整的输入，没有具体任务。我不应该猜测任务或调用工具。」
 *   「当前没有明确的设计任务或指令，我先确认你在，并简短询问你要做什么。」
 *
 * 正当正文（必须判 false）：
 *   「在的。你想做什么？是要继续做白底图（800×800 产品图），还是有别的新任务？」
 *   「我先看一下你的素材再给方案。」   ← 第一人称但是在对用户说话
 *   「主图已经做好了，导出在项目根目录。下一步建议补详情页首屏。」
 */
export function looksLikeSelfNarrationParagraph(paragraph: string): boolean {
    const text = String(paragraph || '').replace(/\s+/g, ' ').trim();
    if (!text) return false;

    // TODO(human)
    return false;
}

function buildSplit(
    input: Omit<AssistantReplyReasoningSplit, 'version'>
): AssistantReplyReasoningSplit {
    return {
        version: 'assistant-reply-reasoning-split/v0',
        ...input
    };
}
