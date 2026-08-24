/**
 * 视觉预算耗尽时的降级：把画面缩成缩略图再给模型看，而不是让它「失明」。
 *
 * 设计路径宪法（2026-08-17）：预算是安全网，不是终止器。真机病例：主图任务中途「画面读取额度
 * 已用尽」，模型只能宣布「无法核验文字可读性」——一个看不见画面的设计师什么都做不完。
 * 每张图的成本主要随像素走：512px 缩略图约是 1280px 全图的 1/6，足以判断整体构图与层级
 * （不足以核对细节文字，消息里会如实说明）。
 *
 * 只在渲染进程（有 DOM）里生效；无 DOM（审计脚本 / 主进程）时返回 null，调用方走原有诚实路径。
 */

export const VISION_THUMBNAIL_MAX_EDGE = 512;
/** 超出候选上限后，还允许以缩略图形式读入的画面数量（防失控的硬顶，不是常规额度）。 */
export const VISION_DEGRADED_CANDIDATE_ALLOWANCE = 12;

export interface VisionImageData {
    data: string;
    mediaType: string;
}

function hasBrowserImagePipeline(): boolean {
    return typeof document !== 'undefined'
        && typeof document.createElement === 'function'
        && typeof Image !== 'undefined';
}

/**
 * 缩到最长边 ≤ maxEdge 并统一重编码为 JPEG（本来就不大的图也重编码，保证输出类型单一）；
 * 任何失败返回 null（由调用方决定退路）。
 */
export async function downscaleImageDataForVision(
    input: VisionImageData,
    maxEdge: number = VISION_THUMBNAIL_MAX_EDGE
): Promise<VisionImageData | null> {
    if (!hasBrowserImagePipeline()) return null;
    const data = String(input?.data || '').trim();
    if (!data) return null;
    const mediaType = String(input.mediaType || 'image/png');
    const source = data.startsWith('data:') ? data : `data:${mediaType};base64,${data}`;
    const image = new Image();
    const loaded = await new Promise<boolean>((resolve) => {
        image.onload = () => resolve(true);
        image.onerror = () => resolve(false);
        image.src = source;
    });
    if (!loaded || !image.naturalWidth || !image.naturalHeight) return null;
    const longest = Math.max(image.naturalWidth, image.naturalHeight);
    const scale = Math.min(1, maxEdge / longest);
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    const commaIndex = dataUrl.indexOf(',');
    if (commaIndex < 0) return null;
    return { data: dataUrl.slice(commaIndex + 1), mediaType: 'image/jpeg' };
}
