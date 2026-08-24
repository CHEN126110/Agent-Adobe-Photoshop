export interface UserDeclaredDeliverable {
    id: string;
    label: string;
    sourceText: string;
    source: 'explicit_user_list';
}

const EXPLICIT_DELIVERABLE_CUE_PATTERN = /(?:交付物|交付文件|最终文件|输出文件)\s*(?:包括|包含|为|是|[:：])\s*([^。！？!?；;\n]{1,240})/gu;
const SPLIT_LIST_PATTERN = /\s*(?:、|,|，|\+|＋|\/|以及|和)\s*/u;
const NON_DELIVERABLE_TAIL_PATTERN = /^(?:保存到|存到|放到|位于|目录|路径|然后|随后|接着|继续|用于)/u;

function cleanDeliverableLabel(value: string): string {
    return value
        .replace(/^\s*(?:[-*•]|\d+[.)、])\s*/u, '')
        .replace(/^[“”"'‘’《》【】\[\]()（）]+|[“”"'‘’《》【】\[\]()（）]+$/gu, '')
        .trim()
        .slice(0, 48);
}

function collectListMatch(
    match: RegExpExecArray,
    labels: Array<{ label: string; sourceText: string }>,
    seen: Set<string>
): void {
    const sourceText = String(match[0] || '').trim();
    const listText = String(match[1] || '').trim();
    const rawItems = listText.split(SPLIT_LIST_PATTERN);
    for (const rawItem of rawItems) {
        const label = cleanDeliverableLabel(rawItem);
        if (NON_DELIVERABLE_TAIL_PATTERN.test(label)) break;
        const key = label.toLocaleLowerCase();
        if (!label || label.length > 48 || seen.has(key)) continue;
        seen.add(key);
        labels.push({ label, sourceText });
    }
}

function collectMatches(
    pattern: RegExp,
    text: string,
    labels: Array<{ label: string; sourceText: string }>,
    seen: Set<string>
): void {
    pattern.lastIndex = 0;
    let match = pattern.exec(text);
    while (match) {
        collectListMatch(match, labels, seen);
        match = pattern.exec(text);
    }
}

/**
 * 只保留用户放在“交付物 / 交付文件 / 最终文件 / 输出文件”字段后的字面名称。
 * 普通自然语言里的“设计、保存、验证”等过程动词不能被提升为交付义务；其余需求理解交给模型。
 */
export function extractUserDeclaredDeliverables(input: unknown): UserDeclaredDeliverable[] {
    const text = String(input || '').replace(/\s+/g, ' ').trim();
    if (!text) return [];

    const labels: Array<{ label: string; sourceText: string }> = [];
    const seen = new Set<string>();
    collectMatches(EXPLICIT_DELIVERABLE_CUE_PATTERN, text, labels, seen);
    return labels.slice(0, 12).map((item, index) => ({
        id: `user-deliverable-${index + 1}`,
        label: item.label,
        sourceText: item.sourceText,
        source: 'explicit_user_list'
    }));
}
