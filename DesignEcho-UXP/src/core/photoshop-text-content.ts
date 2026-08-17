/**
 * Photoshop 文本内容的换行口径（唯一来源）。
 *
 * Photoshop 文本图层用 \r 作硬回车：读回来的 textItem.contents 是 \r，
 * 写进 textKey 的也必须是 \r。用 \n 写入不会报错，但多行会被拼成一行——
 * 真机实测（2026-08-06）：两行文字图层高 61px，用 \n 写入后掉到 27px、宽度从 146 涨到 303。
 *
 * 这条规则原先只写在 createTextLayer 里，setTextContent 没有，于是"新建的文字是多行、
 * 替换之后变一行"。放在这里由两边共用，避免第三个写文本的工具再踩一次。
 */

/**
 * 归一成 \n：内部比对、切行、算字数统一用它。
 * 不做 trim——首尾空白是否有意义由调用方决定。
 */
export function normalizePhotoshopTextContent(content: unknown): string {
    return String(content || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
}

/** 写回 Photoshop（textKey / textItem.contents）前把换行还原成硬回车 \r。 */
export function toPhotoshopTextKey(content: unknown): string {
    return normalizePhotoshopTextContent(content).replace(/\n/g, '\r');
}

/** 按 Photoshop 的换行口径切行（裸 \r、\n、\r\n 都算换行）。 */
export function splitPhotoshopTextLines(content: unknown): string[] {
    return normalizePhotoshopTextContent(content).split('\n');
}
