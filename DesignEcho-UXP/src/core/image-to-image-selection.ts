export type ImageToImageSelectionPayload = {
    documentName: string;
    /** 图层 id 只在文档内唯一，判断"还是不是同一个目标"时必须带上文档一起看 */
    documentId: number | null;
    width: number;
    height: number;
    selectionState: 'none' | 'multiple' | 'single';
    hasSelectedLayer: boolean;
    selectedLayerId: number | null;
    selectedLayerName: string;
    selectedLayerWidth: number;
    selectedLayerHeight: number;
};

/**
 * 把 Photoshop 的文档/图层 id 收敛成数字。
 *
 * 同一个 id 在不同调用路径上拿到的可能是数字也可能是数字字符串（仓库里多处已经在写 `Number(document.id)`）。
 * 记录一次、比较一次的两端若走了不同路径，直接比就会恒不相等——判断会静默失效而不是报错。
 */
export function toPhotoshopEntityId(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const id = Number(value);
    return Number.isFinite(id) ? id : null;
}

/**
 * 文档的显示名。
 *
 * title 优先、name 兜底：UXP 里 title 是标签页上那个名字，也是用户认得的那个；
 * 但类型声明只覆盖了 name，所以按运行时能力取值。
 * 读不到时返回空串，由调用方决定怎么措辞——不在这里编一个假名字充数。
 *
 * 逐项做类型判断而不是 `String(doc?.title || doc?.name || '')`：后者会把任何非字符串值
 * （UXP 属性访问器在文档已关闭时可能返回意外类型）转成 "[object Object]" 这种假名字，
 * 直接塞进给用户看的提示里。
 */
export function documentDisplayName(doc: any): string {
    if (!doc) return '';
    const title = typeof doc.title === 'string' ? doc.title.trim() : '';
    if (title) return title;
    return typeof doc.name === 'string' ? doc.name.trim() : '';
}

export function buildImageToImageSelectionPayload(doc: any): ImageToImageSelectionPayload {
    const activeLayers = Array.isArray(doc?.activeLayers) ? doc.activeLayers : [];

    const basePayload: ImageToImageSelectionPayload = {
        documentName: documentDisplayName(doc) || '当前文档',
        documentId: toPhotoshopEntityId(doc?.id),
        width: Number(doc?.width) || 0,
        height: Number(doc?.height) || 0,
        selectionState: 'none',
        hasSelectedLayer: false,
        selectedLayerId: null,
        selectedLayerName: '',
        selectedLayerWidth: 0,
        selectedLayerHeight: 0
    };

    if (!doc) {
        return basePayload;
    }

    if (activeLayers.length !== 1) {
        return {
            ...basePayload,
            selectionState: activeLayers.length > 1 ? 'multiple' : 'none'
        };
    }

    const selectedLayer = activeLayers[0];
    const selectedLayerBounds = selectedLayer?.boundsNoEffects || selectedLayer?.bounds || null;
    const selectedLayerWidth = selectedLayerBounds
        ? Math.max(0, Number(selectedLayerBounds.right) - Number(selectedLayerBounds.left))
        : 0;
    const selectedLayerHeight = selectedLayerBounds
        ? Math.max(0, Number(selectedLayerBounds.bottom) - Number(selectedLayerBounds.top))
        : 0;

    return {
        ...basePayload,
        selectionState: 'single',
        hasSelectedLayer: true,
        selectedLayerId: selectedLayer?.id ?? null,
        selectedLayerName: selectedLayer?.name || '',
        selectedLayerWidth,
        selectedLayerHeight
    };
}

/** 一批候选图所归属的位置：生成时所在的文档与源图层，以及候选被置入后产生的结果图层 */
export type ImageToImageCandidateOwnership = {
    sourceDocumentId: number | null;
    sourceLayerId: number | null;
    appliedLayerId: number | null;
};

/**
 * 当前选中的图层是否仍属于这批候选。
 *
 * 置入候选会新建图层并让它成为选中图层——这个变化是插件自己写出来的，不是用户改了目标；
 * 用户点回源图层对照原图同理。把这两种情况当作"换了目标图层"去清空候选区，
 * 会把同一批里还没被挑中的图直接抹掉，而那些图已经按次计费生成过了。
 *
 * 文档要一起比：图层 id 是文档内编号，换个文档很容易撞上同一个号，
 * 只比图层就会把"用户切到别的文档"错认成"还在本批候选里"。
 * 但只有在两个文档 id 都读到、且确实不同时才据此否定——读不到 id 属于"不知道"，
 * 把不知道当成"不属于本批"就会退回清空候选的破坏性行为，而清掉的图是重新花钱才能拿回来的。
 */
export function isSelectionOwnedByCandidateRun(
    selection: Pick<ImageToImageSelectionPayload, 'documentId' | 'selectedLayerId'>,
    ownership: ImageToImageCandidateOwnership | null
): boolean {
    if (!ownership) {
        return false;
    }

    const selectionDocumentId = toPhotoshopEntityId(selection.documentId);
    const candidateDocumentId = toPhotoshopEntityId(ownership.sourceDocumentId);
    const inDifferentDocument =
        selectionDocumentId !== null &&
        candidateDocumentId !== null &&
        selectionDocumentId !== candidateDocumentId;
    if (inDifferentDocument) {
        return false;
    }

    const layerId = toPhotoshopEntityId(selection.selectedLayerId);
    if (layerId === null) {
        return false;
    }

    return layerId === toPhotoshopEntityId(ownership.sourceLayerId)
        || layerId === toPhotoshopEntityId(ownership.appliedLayerId);
}

/**
 * 轮询用的选中态指纹：变了才把新状态推给面板。
 *
 * 文档必须进指纹，理由和本文件顶部 documentId 那条注释是同一条——图层 id 只在文档内唯一。
 * 漏掉文档时，"在文档 A 选中图层 2"和"切到文档 B 也选中图层 2"会算出同一个指纹，
 * 轮询直接判定无变化返回，面板于是完全不知道用户已经换了文档：
 * 它继续显示 A 的文档名和目标图层，用户以为一切正常，点置入却被"这批结果属于另一个文档"拦下。
 * 新建文档的首个图层 id 撞号是常态，所以这不是理论情况。
 * documentName 一并进指纹：另存为改名后，面板上显示的文档名不该停在旧名字上。
 */
export function buildImageToImageSelectionSignature(payload: ImageToImageSelectionPayload): string {
    return [
        payload.documentId ?? 'nodoc',
        payload.documentName,
        payload.selectionState,
        payload.selectedLayerId ?? 'none',
        payload.selectedLayerName,
        payload.selectedLayerWidth,
        payload.selectedLayerHeight
    ].join('|');
}
