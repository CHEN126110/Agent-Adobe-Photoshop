/**
 * SKU 领域产物角色回执。
 *
 * 文件名只能用于定位候选，不能证明它是色卡、模板或成品。角色必须由 SKU Skill 在
 * 读取真实文档结构后签发；通用 Harness 只传递回执和执行只读/写入边界，不解释 SKU。
 */

export type SkuArtifactRole =
    | 'color_card_source'
    | 'layout_template'
    | 'production_output';

export interface SkuArtifactRoleReceipt {
    version: 'sku-artifact-role-receipt/v0';
    role: SkuArtifactRole;
    identity: {
        documentName: string;
        documentId?: number;
        filePath?: string;
        projectRelativePath?: string;
    };
    evidence: {
        sourceTool: string;
        observedColorCount?: number;
        observedColorNames?: string[];
    };
    lifecycle: {
        state: 'observed' | 'prepared' | 'verified';
        reusable: boolean;
        mutationPolicy: 'read_only_source' | 'editable_target' | 'delivery_only';
    };
}

export interface BuildSkuColorCardSourceReceiptInput {
    documentName: unknown;
    documentId?: unknown;
    filePath?: unknown;
    projectRelativePath?: unknown;
    observedColorNames: readonly string[];
}

function cleanText(value: unknown): string {
    return String(value || '').trim();
}

function readPositiveInteger(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * 只有真实读取到颜色组后才签发色卡源角色；空观察不会被文件名“SKU.psb”升级成事实。
 */
export function buildSkuColorCardSourceReceipt(
    input: BuildSkuColorCardSourceReceiptInput
): SkuArtifactRoleReceipt | undefined {
    const documentName = cleanText(input.documentName);
    const observedColorNames = Array.from(new Set(
        input.observedColorNames.map(cleanText).filter(Boolean)
    ));
    if (!documentName || observedColorNames.length === 0) return undefined;

    const documentId = readPositiveInteger(input.documentId);
    const filePath = cleanText(input.filePath);
    const projectRelativePath = cleanText(input.projectRelativePath);
    return {
        version: 'sku-artifact-role-receipt/v0',
        role: 'color_card_source',
        identity: {
            documentName,
            ...(documentId !== undefined ? { documentId } : {}),
            ...(filePath ? { filePath } : {}),
            ...(projectRelativePath ? { projectRelativePath } : {})
        },
        evidence: {
            sourceTool: 'skuLayout.listLayerSets',
            observedColorCount: observedColorNames.length,
            observedColorNames
        },
        lifecycle: {
            state: 'verified',
            reusable: true,
            mutationPolicy: 'read_only_source'
        }
    };
}
