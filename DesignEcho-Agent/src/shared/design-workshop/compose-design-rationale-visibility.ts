/**
 * composeDesign 设计说明在执行结果与用户可见过程之间的最小投影契约。
 *
 * rationale.materials 是模型给出的选图依据：它可以缺失，不能参与写入许可或质量判定；
 * 一旦存在则保持原话返回。界面只按规范化后的内容判断本轮是否已经展示，避免把任意一段
 * 无关的长思考误当成“已经说明选图理由”。
 */

export interface ComposeDesignRationaleResultProjection {
    designRationaleText: string;
    materialSelectionReasonText?: string;
}

export interface MaterialSelectionReasonProjectionInput {
    reasonText: unknown;
    visibleContents: unknown[];
}

function normalizeVisibleReasonForComparison(value: unknown): string {
    return String(value || '')
        .normalize('NFKC')
        .replace(/[\s。！？!?,，、；;：:]+/g, '')
        .toLocaleLowerCase();
}

/**
 * 只整理输出字段，不校验完整性，也不决定素材是否合适。
 */
export function buildComposeDesignRationaleResultProjection(input: {
    text?: unknown;
    materials?: unknown;
}): ComposeDesignRationaleResultProjection {
    const designRationaleText = String(input.text || '').trim();
    const materialSelectionReasonText = String(input.materials || '').trim();
    return {
        designRationaleText,
        ...(materialSelectionReasonText ? { materialSelectionReasonText } : {})
    };
}

/**
 * 返回本轮仍需展示的模型原话。已有可见内容覆盖该理由时返回 undefined。
 */
export function resolveMaterialSelectionReasonProjection(
    input: MaterialSelectionReasonProjectionInput
): string | undefined {
    const reasonText = String(input.reasonText || '').trim();
    const reasonKey = normalizeVisibleReasonForComparison(reasonText);
    if (!reasonKey) return undefined;

    const alreadyVisible = input.visibleContents.some((content) => {
        const visibleKey = normalizeVisibleReasonForComparison(content);
        return visibleKey.includes(reasonKey);
    });
    return alreadyVisible ? undefined : reasonText;
}
