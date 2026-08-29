export interface MattingDocumentBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

function readCoordinate(value: unknown): number {
    const candidate = value && typeof value === 'object' && '_value' in value
        ? (value as { _value?: unknown })._value
        : value;
    return Number(candidate);
}

function readBounds(value: unknown): MattingDocumentBounds | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    const left = readCoordinate(record.left);
    const top = readCoordinate(record.top);
    const width = readCoordinate(record.width);
    const height = readCoordinate(record.height);
    const right = record.right !== undefined
        ? readCoordinate(record.right)
        : left + width;
    const bottom = record.bottom !== undefined
        ? readCoordinate(record.bottom)
        : top + height;
    if (![left, top, right, bottom].every(Number.isFinite)
        || right <= left
        || bottom <= top) {
        return null;
    }
    return { left, top, right, bottom };
}

/**
 * `imaging.getPixels({ layerID })` 在没有显式 sourceBounds 时，返回的
 * `pixelResult.sourceBounds` 可能处于图层 / Provider 内部坐标系，不能当作文档坐标。
 * layer-full 导出的文档范围由同一 modal 中读到的图层 bounds 与画布交集唯一确定。
 */
export function resolveLayerFullDocumentSourceBounds(input: {
    layerBounds: unknown;
    documentWidth: unknown;
    documentHeight: unknown;
}): MattingDocumentBounds {
    const layerBounds = readBounds(input.layerBounds);
    const documentWidth = readCoordinate(input.documentWidth);
    const documentHeight = readCoordinate(input.documentHeight);
    if (!layerBounds) {
        throw new Error('整层取像失败：目标图层缺少有效的文档 bounds。');
    }
    if (!Number.isFinite(documentWidth) || documentWidth <= 0
        || !Number.isFinite(documentHeight) || documentHeight <= 0) {
        throw new Error('整层取像失败：当前文档尺寸无效。');
    }

    const clipped = {
        left: Math.max(0, layerBounds.left),
        top: Math.max(0, layerBounds.top),
        right: Math.min(documentWidth, layerBounds.right),
        bottom: Math.min(documentHeight, layerBounds.bottom)
    };
    if (clipped.right <= clipped.left || clipped.bottom <= clipped.top) {
        throw new Error('整层取像失败：目标图层与当前画布没有可见交集。');
    }
    return clipped;
}
