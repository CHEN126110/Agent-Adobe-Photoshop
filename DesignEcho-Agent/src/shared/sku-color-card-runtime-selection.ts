import type { SkuColorCardSourceInput } from './sku-color-card-skill';

const SKU_COLOR_CARD_SELECTION_RECEIPT_BRAND = Symbol(
    'sku-color-card-runtime-selection-receipt'
);

export interface SkuColorCardRuntimeSelectionInput {
    assetId: string;
    filePath: string;
    relativePath?: string;
}

export interface SkuColorCardRuntimeSelectionReceipt {
    readonly [SKU_COLOR_CARD_SELECTION_RECEIPT_BRAND]: true;
    readonly selections: ReadonlyArray<Readonly<SkuColorCardRuntimeSelectionInput>>;
}

export interface SkuColorCardRuntimeSelectionBinding {
    applied: boolean;
    sources: SkuColorCardSourceInput[];
    blockers: string[];
}

function clean(value: unknown): string {
    return String(value || '').trim();
}

function normalizePath(value: unknown): string {
    return clean(value).replace(/\//g, '\\').replace(/[\\]+$/, '').toLocaleLowerCase('zh-Hans-CN');
}

export function createSkuColorCardRuntimeSelectionReceipt(
    selections: SkuColorCardRuntimeSelectionInput[]
): SkuColorCardRuntimeSelectionReceipt {
    const normalized = selections.map((selection) => Object.freeze({
        assetId: clean(selection.assetId),
        filePath: clean(selection.filePath),
        ...(clean(selection.relativePath) ? { relativePath: clean(selection.relativePath) } : {})
    }));
    return Object.freeze({
        [SKU_COLOR_CARD_SELECTION_RECEIPT_BRAND]: true as const,
        selections: Object.freeze(normalized)
    });
}

function isTrustedReceipt(value: unknown): value is SkuColorCardRuntimeSelectionReceipt {
    return Boolean(value)
        && typeof value === 'object'
        && (value as SkuColorCardRuntimeSelectionReceipt)[SKU_COLOR_CARD_SELECTION_RECEIPT_BRAND] === true;
}

/**
 * 把模型声明的 assetId 顺序绑定回 Runtime 已签发的精确路径。
 *
 * Receipt 带不可序列化 Symbol，不能由 Tool JSON 构造。绑定失败时保留零写入 blocker，
 * 不回退到文件名、色名或候选分数重新选择素材。
 */
export function bindSkuColorCardRuntimeSelection(
    sources: SkuColorCardSourceInput[],
    receipt?: SkuColorCardRuntimeSelectionReceipt
): SkuColorCardRuntimeSelectionBinding {
    if (!receipt) {
        return { applied: false, sources, blockers: [] };
    }
    if (!isTrustedReceipt(receipt)) {
        return {
            applied: true,
            sources: [],
            blockers: ['SKU 色卡素材选择收据无效，已停止写入。']
        };
    }
    if (sources.length !== receipt.selections.length) {
        return {
            applied: true,
            sources: [],
            blockers: ['SKU 色卡素材选择数量与 Runtime 收据不一致，已停止写入。']
        };
    }

    const blockers: string[] = [];
    const boundSources = sources.map((source, index) => {
        const selected = receipt.selections[index];
        const assetId = clean(source.assetId);
        if (!assetId || assetId !== selected.assetId) {
            blockers.push(`第 ${index + 1} 个 SKU 色卡素材身份与 Runtime 收据不一致。`);
        }
        if (!selected.filePath || normalizePath(source.filePath) !== normalizePath(selected.filePath)) {
            blockers.push(`第 ${index + 1} 个 SKU 色卡素材路径与 Runtime 收据不一致。`);
        }
        return {
            ...source,
            assetId: selected.assetId,
            filePath: selected.filePath,
            ...(selected.relativePath ? { relativePath: selected.relativePath } : {})
        };
    });

    return {
        applied: true,
        sources: blockers.length > 0 ? [] : boundSources,
        blockers
    };
}
