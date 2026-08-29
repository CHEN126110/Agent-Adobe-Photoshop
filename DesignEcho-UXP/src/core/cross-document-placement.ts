/**
 * 跨文档置入的落位重算。
 *
 * 生成结果携带的 targetBounds / placementWidth 全部是**源文档的绝对像素**：
 * targetBounds 来自源图层的 boundsNoEffects（图生图）或选区外接框（局部重绘），
 * 落位工具则把图层左上角强行平移到该坐标（tools/image/inpainting.ts 的
 * translate 分支与 putPixels 分支都是如此），且全程不读目标画布尺寸、不做任何 clamp。
 *
 * 于是同一组坐标换一个文档就不再指向"原来那个位置"：目标画布更小时，
 * 整个图层会被甩到画布外——不报错、不裁切，用户看到的是"点了置入什么都没发生"。
 *
 * 这里不试图猜测"用户本来想放哪"（跨文档根本不存在对应位置），而是给一个
 * 唯一可预期的落点：**按目标画布居中**，放不下就等比缩到放得下。
 * 位置无法沿用是事实，明说它并给出确定的结果，比拒绝置入或静默错位都好。
 */

export type CrossDocumentPlacement = {
    /** 落位后占的宽高（目标文档像素） */
    placementWidth: number;
    placementHeight: number;
    /** 目标文档坐标系里的左上角 */
    targetBounds: { left: number; top: number };
    /** 是否因为放不下而等比缩过 */
    scaled: boolean;
    /** 不能缩放的路径上，结果比画布还大：已左上对齐，但会有部分落在画布外 */
    overflows: boolean;
};

function toPositiveInt(value: unknown): number {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return 0;
    return Math.floor(num);
}

/**
 * 算出结果图在目标文档里的落位。
 *
 * canScale 必须如实传，它决定这里能不能靠缩放来适应画布——落位工具的两条写入路径
 * 对 placementWidth 的处理并不一样：
 *  - placeEvent 路径（置入文件，isRawRgba=false）：先按 placementWidth 缩放图层，
 *    再平移到 targetBounds。这条路可以缩，canScale=true。
 *  - putPixels 路径（置入 raw RGBA，isRawRgba=true）：**完全不读 placementWidth**，
 *    按图像原始像素贴到 targetBounds；而且一旦传了 targetBounds，
 *    它自带的那个兜底缩放分支也会被跳过。这条路不能缩，canScale=false。
 * 如果在不能缩的路径上按"缩放后的尺寸"算居中坐标，实际贴的却是原始尺寸，
 * 图层就会大幅超出画布——坐标与尺寸必须来自同一套假设。
 *
 * 尺寸读不出来时返回 null——那种情况下任何落点都是猜的，
 * 调用方应当如实拒绝而不是随便贴一个位置（不可逆写入）。
 */
export function resolveCrossDocumentPlacement(input: {
    imageWidth: number;
    imageHeight: number;
    docWidth: number;
    docHeight: number;
    canScale: boolean;
}): CrossDocumentPlacement | null {
    const imageWidth = toPositiveInt(input.imageWidth);
    const imageHeight = toPositiveInt(input.imageHeight);
    const docWidth = toPositiveInt(input.docWidth);
    const docHeight = toPositiveInt(input.docHeight);

    if (!imageWidth || !imageHeight || !docWidth || !docHeight) {
        return null;
    }

    if (!input.canScale) {
        // 只能按原始尺寸贴。放不下时不居中——居中会算出负坐标，把图推到画布左上之外，
        // 用户连"它到底贴没贴上"都看不出来。改为左上对齐，至少一角可见、可拖动调整。
        const overflows = imageWidth > docWidth || imageHeight > docHeight;
        return {
            placementWidth: imageWidth,
            placementHeight: imageHeight,
            targetBounds: {
                left: Math.max(0, Math.round((docWidth - imageWidth) / 2)),
                top: Math.max(0, Math.round((docHeight - imageHeight) / 2))
            },
            scaled: false,
            overflows
        };
    }

    // 放得下就保持原始像素尺寸：跨文档已经损失了位置信息，
    // 不该再无谓地改变尺寸（缩放是有损的，而且用户可能正需要这个分辨率）。
    // 上限取 1，所以这里只会缩小、不会放大。
    const fitScale = Math.min(docWidth / imageWidth, docHeight / imageHeight, 1);
    const placementWidth = Math.max(1, Math.round(imageWidth * fitScale));
    const placementHeight = Math.max(1, Math.round(imageHeight * fitScale));

    return {
        placementWidth,
        placementHeight,
        targetBounds: {
            // 居中。奇数差值向下取整，偏差最多 1px，肉眼不可见
            left: Math.round((docWidth - placementWidth) / 2),
            top: Math.round((docHeight - placementHeight) / 2)
        },
        scaled: fitScale < 1,
        overflows: false
    };
}

/**
 * 跨文档置入后给用户的说明。
 *
 * 必须点名两个文档：只说"当前在 X"而不说"原本属于 Y"，用户就无从判断
 * 自己是不是切错了地方（这正是原先那条拒绝提示的毛病）。
 */
export function buildCrossDocumentPlacementNotice(input: {
    sourceDocumentName: string;
    activeDocumentName: string;
    placement: CrossDocumentPlacement;
    resultLabel: string;
    /**
     * 上一张结果留在了哪个文档（删不掉时）。
     * 并进这条提示而不是另发一条 toast：两条内容相关的警告叠在一起反而看不清，
     * 而且分开写日后很容易只改一处。
     */
    leftoverDocumentName?: string;
}): string {
    const from = input.sourceDocumentName ? `「${input.sourceDocumentName}」` : '另一个文档';
    const to = input.activeDocumentName ? `「${input.activeDocumentName}」` : '当前文档';
    const leftover = input.leftoverDocumentName
        ? `另外，上一张${input.resultLabel}还留在「${input.leftoverDocumentName}」里，`
            + `插件只能删当前文档的图层——切回那个文档再置入一次会自动收掉它。`
        : '';

    // 超出画布是必须说的：用户会看到图只露出一角，不说清楚就像是插件贴坏了
    if (input.placement.overflows) {
        return `${input.resultLabel}原本是为${from}生成的，已置入到${to}。`
            + `但它的尺寸（${input.placement.placementWidth}×${input.placement.placementHeight}）大于当前画布，`
            + `已按左上角对齐放置，超出画布的部分需要你自己缩放或移动。`
            + `需要原尺寸原位置请切回${from}再置入。${leftover}`;
    }
    const scaledPart = input.placement.scaled
        ? `，并等比缩小到 ${input.placement.placementWidth}×${input.placement.placementHeight} 以适应画布`
        : '';
    return `${input.resultLabel}原本是为${from}生成的，已置入到${to}并居中放置${scaledPart}。`
        + `原位置属于${from}，跨文档无法沿用——需要精确位置请切回${from}再置入。${leftover}`;
}
