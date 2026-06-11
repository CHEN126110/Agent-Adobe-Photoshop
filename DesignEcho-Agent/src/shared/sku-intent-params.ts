export type SkuIntentParams = {
    comboSizes?: number[];
    countPerSize?: number;
    generateNotes?: boolean;
    onlyNotes?: boolean;
};

function isReasonableSkuSize(value: number): boolean {
    return Number.isInteger(value) && value >= 1 && value <= 50;
}

function uniqueSorted(values: number[]): number[] {
    return Array.from(new Set(values.filter(isReasonableSkuSize))).sort((a, b) => a - b);
}

export function extractSkuComboSizesFromText(input: string): number[] {
    const text = String(input || '');
    const matched: number[] = [];

    const explicitDuals = text.match(/(\d{1,2})\s*双/g) || [];
    for (const token of explicitDuals) {
        const value = Number(String(token).match(/\d+/)?.[0] || 0);
        if (isReasonableSkuSize(value)) matched.push(value);
    }

    const grouped = text.match(/\d+(?:\s*[-/、，,]\s*\d+)+/g) || [];
    for (const token of grouped) {
        const parts = token.match(/\d+/g) || [];
        for (const part of parts) {
            const value = Number(part);
            if (isReasonableSkuSize(value)) matched.push(value);
        }
    }

    if (/(?:单|一)\s*双(?:装|自选备注|备注|sku|SKU)?/.test(text)) {
        matched.push(1);
    }

    return uniqueSorted(matched);
}

export function hasSkuNoteRequest(input: string): boolean {
    const text = String(input || '');
    return /自选备注|备注图/.test(text);
}

export function hasSkuNoteDisableIntent(input: string): boolean {
    const text = String(input || '');
    return /不需要自选备注|不要自选备注|无需自选备注|不用自选备注|不生成(?:自选)?备注|仅组合|只要组合|不要备注图/.test(text);
}

function hasSkuComboWorkRequest(input: string): boolean {
    const text = String(input || '');
    if (!text.trim()) return false;

    if (/组合图|颜色组合|配色组合|SKU组合|sku组合|组合|批量配色|批量出图|批量生成/.test(text)) {
        return true;
    }

    if (/每(?:个规格|规格|个|款)?(?:需要|生成|做|出)?\s*\d{1,3}\s*(?:个|组|张|款)/.test(text)) {
        return true;
    }

    if (/(?:做|生成|制作|处理|跑|出).{0,8}(?:SKU|sku)(?!\s*(?:自选备注|备注图))/.test(text)) {
        return true;
    }

    if (/(?:SKU|sku).{0,12}(?:批量|组合|配色|出图|每个规格|每规格)/.test(text)) {
        return true;
    }

    return false;
}

function hasGenericSkuBatchIntent(input: string): boolean {
    const text = String(input || '');
    if (!/(?:SKU|sku|批量配色|批量出图|组合图|双装|单双(?:装)?|一\s*双(?:装)?|\d{1,2}\s*双)/.test(text)) {
        return false;
    }
    return !isSkuNoteOnlyText(text);
}

export function isSkuNoteOnlyText(input: string): boolean {
    const text = String(input || '');
    if (!hasSkuNoteRequest(text)) return false;
    if (hasSkuNoteDisableIntent(text)) return false;
    const hasComboWork = hasSkuComboWorkRequest(text);
    const explicitOnly = /(?:只|仅|单独)(?:做|生成|要)?(?:\s*\d+(?:\s*[-/、，,]\s*\d+)*\s*双?)?(?:的)?(?:SKU|sku)?(?:自选备注|备注图)|(?:补|补一下|补充|还需要|还要|需要|再补|再做|再生成|对应)(?:.{0,16})?(?:SKU|sku)?(?:自选备注|备注图)/.test(text);
    if (hasComboWork) return false;
    if (explicitOnly) return true;
    return /(?:自选备注|备注图)$/.test(text);
}

export function extractSkuCountPerSizeFromText(input: string): number | undefined {
    const text = String(input || '');
    const patterns = [
        /每(?:个规格|个|规格|款|双)?(?:需要|生成|做|出)?\s*(\d{1,3})\s*(?:个|组|张|款)/,
        /(?:需要|生成|做|出)\s*(\d{1,3})\s*(?:个|组|张|款)/
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (!match) continue;
        const value = Number(match[1]);
        if (Number.isFinite(value) && value > 0) {
            return Math.max(1, Math.floor(value));
        }
    }

    return undefined;
}

export function inferSkuIntentParamsFromText(input: string): SkuIntentParams {
    const text = String(input || '');
    const comboSizes = extractSkuComboSizesFromText(text);
    const countPerSize = extractSkuCountPerSizeFromText(text);
    const noteRequested = hasSkuNoteRequest(text);
    const noteDisabled = hasSkuNoteDisableIntent(text);
    const onlyNotes = isSkuNoteOnlyText(text);
    const genericSkuBatch = hasGenericSkuBatchIntent(text);

    return {
        ...(comboSizes.length > 0 ? { comboSizes } : {}),
        ...(typeof countPerSize === 'number' ? { countPerSize } : {}),
        generateNotes: !noteDisabled && (noteRequested || genericSkuBatch),
        onlyNotes
    };
}
