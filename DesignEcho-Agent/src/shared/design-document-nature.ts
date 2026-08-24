/**
 * 当前打开的文档是「设计文件」还是「一张图片」？——设计师一眼就分得清，模型常分不清。
 *
 * 真机 2026-08-17：活动文档是一张 AI 生图结果（image-to-image_….png，896×1200，只有一个锁定的
 * 「背景」栅格图层），模型把它当成「当前主图文档」，准备直接往上叠文案。设计师的做法是：这是素材，
 * 不是画布——新建符合规格的主图画布，把它作为主体置入，再排版。
 *
 * 判据全部是结构事实（文件名扩展名、图层数、是否只有锁定背景），不看品类词，纯逻辑、可测。
 * 结论只用于**提示**（附在 getDocumentInfo 结果里），不拦截任何写入——它拦的是「做错方向」的风险，
 * 但一句提示已足够让模型自己判断；真要在这张图上写字也是可逆的。
 */

export type DesignDocumentNatureKind =
    | 'source_image'
    | 'design_document'
    | 'blank_canvas'
    | 'unknown';

export interface DesignDocumentNature {
    kind: DesignDocumentNatureKind;
    /** 人话理由（给模型看）。 */
    reason: string;
    /** 设计师式建议（给模型看）；unknown 时为空。 */
    advice?: string;
}

const RASTER_IMAGE_EXTENSIONS = /\.(?:jpe?g|png|webp|gif|bmp|heic|avif)$/i;
const DESIGN_FILE_EXTENSIONS = /\.(?:psd|psb|psdt|tiff?)$/i;

export function describeDesignDocumentNature(input: {
    name?: unknown;
    layerCount?: unknown;
    width?: unknown;
    height?: unknown;
    /** 唯一图层是否为锁定背景（可选，来自图层结构）；未知时不参与判断。 */
    onlyLockedBackground?: boolean;
}): DesignDocumentNature {
    const name = String(input?.name || '').trim();
    const layerCount = Number(input?.layerCount);
    const width = Number(input?.width);
    const height = Number(input?.height);
    const size = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
        ? `${Math.round(width)}×${Math.round(height)}`
        : '';
    const looksLikeRasterFile = RASTER_IMAGE_EXTENSIONS.test(name);
    const looksLikeDesignFile = DESIGN_FILE_EXTENSIONS.test(name);
    const singleLayer = Number.isFinite(layerCount) && layerCount <= 1;

    if (looksLikeRasterFile && singleLayer) {
        return {
            kind: 'source_image',
            reason: `文件名是图片格式（${name}）且只有 ${Math.max(0, layerCount)} 个图层${input.onlyLockedBackground ? '（锁定背景）' : ''}${size ? `，${size}` : ''}——这是一张图片，不是设计文件。`,
            advice: '把它当素材：先新建符合交付规格的画布（或打开真正的设计文件），再把这张图作为主体置入并按主体缩放，然后在留白里排文字；不要直接在图片文件上叠字后当成品交付。'
        };
    }
    if (looksLikeRasterFile) {
        return {
            kind: 'source_image',
            reason: `文件名是图片格式（${name}），虽有 ${layerCount} 个图层，多半是打开的图片而不是设计工作文件。`,
            advice: '确认这是不是设计文件；若只是图片，请新建目标画布再置入它作为主体。'
        };
    }
    if (looksLikeDesignFile) {
        return {
            kind: 'design_document',
            reason: `文件名是设计文件格式（${name}）${Number.isFinite(layerCount) ? `，${layerCount} 个图层` : ''}。`,
            advice: '在这份文件上接着做：先看清已有结构，接手半成品，不推倒重来。'
        };
    }
    if (singleLayer && input.onlyLockedBackground) {
        return {
            kind: 'blank_canvas',
            reason: `只有一个锁定背景图层${size ? `（${size}）` : ''}，尚无设计内容。`,
            advice: '这是空画布或单张底图：确认尺寸符合交付规格后直接开始铺内容。'
        };
    }
    return {
        kind: 'unknown',
        reason: `无法仅凭文件名与图层数判断（${name || '未命名'}${Number.isFinite(layerCount) ? `，${layerCount} 个图层` : ''}）。`
    };
}
