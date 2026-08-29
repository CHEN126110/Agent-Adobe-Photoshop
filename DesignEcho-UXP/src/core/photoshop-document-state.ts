export type PhotoshopDocumentEditState = 'clean' | 'dirty' | 'unknown';

export interface PhotoshopDocumentEditStateObservation {
    editState: PhotoshopDocumentEditState;
    editStateReason?: string;
}

/**
 * Photoshop Document.saved 只回答“自上次保存后是否发生过修改”，与文档是否已经
 * 拥有本地路径是两个不同事实。调用方必须继续单独读取 pathState，不能用 saved
 * 推断文件位置，也不能把 dirty 当成当前 TaskRun 拥有该文档。
 */
export function observePhotoshopDocumentEditState(
    document: unknown
): PhotoshopDocumentEditStateObservation {
    if (!document || typeof document !== 'object') {
        return {
            editState: 'unknown',
            editStateReason: 'Photoshop 文档对象不可用，无法判断保存后的修改状态。'
        };
    }

    try {
        const saved = (document as { saved?: unknown }).saved;
        if (typeof saved === 'boolean') {
            return { editState: saved ? 'clean' : 'dirty' };
        }
        return {
            editState: 'unknown',
            editStateReason: '当前 Photoshop Runtime 未返回 Document.saved。'
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            editState: 'unknown',
            editStateReason: `Photoshop 无法读取 Document.saved。${message ? ` ${message}` : ''}`
        };
    }
}
