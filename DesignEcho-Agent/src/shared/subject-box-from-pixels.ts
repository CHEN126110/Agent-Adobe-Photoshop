/**
 * 主体框（纯像素统计，无模型、无 IO）。
 *
 * 用意：把「主体在哪」从画布上的实时识别（Photoshop 选择主体等黑盒）改成**素材本身的属性**——
 * 在文件上算一次、存进素材记忆，缩放和版式只吃这个相对框。这里是链条里零模型的两级：
 *  ① alpha 边界：已抠好的透明底图，主体 = 不透明像素外接框（确定）
 *  ② 纯色底裁边：白底 / 灰底产品图，主体 = 与边框底色差异明显的像素外接框（高置信）
 * 第三级（本地分割模型）在主进程 asset-subject-box-service 里，输出同一形状。
 *
 * 所有框都用 0–1 相对坐标表达（相对于图像 / 图层外框），置入 Photoshop 后按图层外框线性投影即可，
 * 与图层缩放、位置无关；PS 里不再需要任何识别。
 */

export interface PixelBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/** 相对框：x/y/width/height ∈ [0,1]，相对于图像（或图层外框）的宽高。 */
export interface RelativeSubjectBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export type SubjectBoxMethod = 'alpha' | 'trim' | 'matting' | 'frame';
export type SubjectBoxConfidence = 'certain' | 'high' | 'medium' | 'low';

export interface SubjectBoxResolution {
    box: RelativeSubjectBox;
    method: SubjectBoxMethod;
    confidence: SubjectBoxConfidence;
    /** 主体框面积占整图比例 */
    coverage: number;
    /** 人话：怎么得到的、该信几分 */
    note: string;
}

export interface RawPixelImage {
    data: Uint8Array | Uint8ClampedArray;
    width: number;
    height: number;
    /** 每像素通道数：3 = RGB，4 = RGBA */
    channels: 3 | 4;
}

const DEFAULT_ALPHA_THRESHOLD = 16;
/** 单通道最大差超过它才算「不是底色」（JPEG 压缩噪声通常在 ±6 以内） */
const DEFAULT_TRIM_TOLERANCE = 22;
/** 边框像素里落在底色容差内的比例至少要这么高，才认定「有均匀底色」 */
const MIN_BORDER_UNIFORMITY = 0.94;
/** 裁边后面积至少要缩到整图的这么多以下，否则视为没有可裁的边（整图都是内容） */
const MAX_TRIM_COVERAGE = 0.97;
/** 主体框小到这个比例以下当作噪点，不认 */
const MIN_MEANINGFUL_COVERAGE = 0.002;

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

function round4(value: number): number {
    return Math.round(value * 10000) / 10000;
}

export function pixelBoundsToRelativeBox(bounds: PixelBounds, width: number, height: number): RelativeSubjectBox {
    if (width <= 0 || height <= 0) return { x: 0, y: 0, width: 1, height: 1 };
    const x = clamp01(bounds.left / width);
    const y = clamp01(bounds.top / height);
    const right = clamp01((bounds.right + 1) / width);
    const bottom = clamp01((bounds.bottom + 1) / height);
    return {
        x: round4(x),
        y: round4(y),
        width: round4(Math.max(0, right - x)),
        height: round4(Math.max(0, bottom - y))
    };
}

/** 把相对框投影到 Photoshop 图层外框（文档坐标），得到主体的绝对框。 */
export function projectRelativeBoxOntoFrame(
    box: RelativeSubjectBox,
    frame: { left: number; top: number; right: number; bottom: number }
): { left: number; top: number; right: number; bottom: number } {
    const frameWidth = Math.max(0, Number(frame.right) - Number(frame.left));
    const frameHeight = Math.max(0, Number(frame.bottom) - Number(frame.top));
    const left = Number(frame.left) + box.x * frameWidth;
    const top = Number(frame.top) + box.y * frameHeight;
    return {
        left: Math.round(left),
        top: Math.round(top),
        right: Math.round(left + box.width * frameWidth),
        bottom: Math.round(top + box.height * frameHeight)
    };
}

/** 反向：已知主体绝对框与图层外框，求相对框（用于把一次检测结果变成可复用属性）。 */
export function relativeBoxFromFrame(
    subject: { left: number; top: number; right: number; bottom: number },
    frame: { left: number; top: number; right: number; bottom: number }
): RelativeSubjectBox | undefined {
    const frameWidth = Number(frame.right) - Number(frame.left);
    const frameHeight = Number(frame.bottom) - Number(frame.top);
    if (!(frameWidth > 0) || !(frameHeight > 0)) return undefined;
    const x = clamp01((Number(subject.left) - Number(frame.left)) / frameWidth);
    const y = clamp01((Number(subject.top) - Number(frame.top)) / frameHeight);
    const right = clamp01((Number(subject.right) - Number(frame.left)) / frameWidth);
    const bottom = clamp01((Number(subject.bottom) - Number(frame.top)) / frameHeight);
    if (right <= x || bottom <= y) return undefined;
    return { x: round4(x), y: round4(y), width: round4(right - x), height: round4(bottom - y) };
}

export function relativeBoxCoverage(box: RelativeSubjectBox): number {
    return round4(clamp01(box.width) * clamp01(box.height));
}

function isValidImage(image: RawPixelImage): boolean {
    return image.width > 0
        && image.height > 0
        && (image.channels === 3 || image.channels === 4)
        && image.data.length >= image.width * image.height * image.channels;
}

/**
 * ① 透明底：不透明像素外接框。整图不透明（或没有 alpha 通道）返回 undefined。
 */
export function computeAlphaSubjectBox(
    image: RawPixelImage,
    options: { alphaThreshold?: number } = {}
): SubjectBoxResolution | undefined {
    if (!isValidImage(image) || image.channels !== 4) return undefined;
    const threshold = options.alphaThreshold ?? DEFAULT_ALPHA_THRESHOLD;
    const { data, width, height } = image;
    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    let opaqueCount = 0;
    for (let y = 0; y < height; y += 1) {
        const rowOffset = y * width * 4;
        for (let x = 0; x < width; x += 1) {
            if (data[rowOffset + x * 4 + 3] <= threshold) continue;
            opaqueCount += 1;
            if (x < left) left = x;
            if (x > right) right = x;
            if (y < top) top = y;
            if (y > bottom) bottom = y;
        }
    }
    if (right < 0 || bottom < 0) return undefined;
    const total = width * height;
    // 几乎全不透明 = 这不是抠好的图，alpha 说明不了主体在哪
    if (opaqueCount / total > 0.985) return undefined;
    const box = pixelBoundsToRelativeBox({ left, top, right, bottom }, width, height);
    const coverage = relativeBoxCoverage(box);
    if (coverage < MIN_MEANINGFUL_COVERAGE) return undefined;
    return {
        box,
        method: 'alpha',
        confidence: 'certain',
        coverage,
        note: '透明底图：主体 = 不透明像素范围'
    };
}

function medianOf(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

/**
 * ② 纯色底裁边：以边框像素的中位色作底色，找出与底色差异超过容差的像素外接框。
 * 边框不够均匀（不是纯色底）或裁不掉多少（整图都是内容）时返回 undefined。
 */
export function computeUniformBorderSubjectBox(
    image: RawPixelImage,
    options: { tolerance?: number; borderThickness?: number } = {}
): SubjectBoxResolution | undefined {
    if (!isValidImage(image)) return undefined;
    const tolerance = options.tolerance ?? DEFAULT_TRIM_TOLERANCE;
    const { data, width, height, channels } = image;
    if (width < 8 || height < 8) return undefined;
    const thickness = Math.max(1, Math.min(options.borderThickness ?? Math.max(2, Math.round(Math.min(width, height) * 0.01)), 8));

    const reds: number[] = [];
    const greens: number[] = [];
    const blues: number[] = [];
    const pushPixel = (x: number, y: number): void => {
        const offset = (y * width + x) * channels;
        if (channels === 4 && data[offset + 3] <= DEFAULT_ALPHA_THRESHOLD) return;
        reds.push(data[offset]);
        greens.push(data[offset + 1]);
        blues.push(data[offset + 2]);
    };
    for (let y = 0; y < height; y += 1) {
        const onEdgeRow = y < thickness || y >= height - thickness;
        for (let x = 0; x < width; x += 1) {
            if (onEdgeRow || x < thickness || x >= width - thickness) pushPixel(x, y);
        }
    }
    if (reds.length === 0) return undefined;
    const borderColor = { r: medianOf(reds), g: medianOf(greens), b: medianOf(blues) };
    let withinTolerance = 0;
    for (let index = 0; index < reds.length; index += 1) {
        const diff = Math.max(
            Math.abs(reds[index] - borderColor.r),
            Math.abs(greens[index] - borderColor.g),
            Math.abs(blues[index] - borderColor.b)
        );
        if (diff <= tolerance) withinTolerance += 1;
    }
    const uniformity = withinTolerance / reds.length;
    if (uniformity < MIN_BORDER_UNIFORMITY) return undefined;

    let left = width;
    let top = height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const offset = (y * width + x) * channels;
            if (channels === 4 && data[offset + 3] <= DEFAULT_ALPHA_THRESHOLD) continue;
            const diff = Math.max(
                Math.abs(data[offset] - borderColor.r),
                Math.abs(data[offset + 1] - borderColor.g),
                Math.abs(data[offset + 2] - borderColor.b)
            );
            if (diff <= tolerance) continue;
            if (x < left) left = x;
            if (x > right) right = x;
            if (y < top) top = y;
            if (y > bottom) bottom = y;
        }
    }
    if (right < 0 || bottom < 0) return undefined;
    const box = pixelBoundsToRelativeBox({ left, top, right, bottom }, width, height);
    const coverage = relativeBoxCoverage(box);
    if (coverage > MAX_TRIM_COVERAGE || coverage < MIN_MEANINGFUL_COVERAGE) return undefined;
    const hex = `#${[borderColor.r, borderColor.g, borderColor.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    return {
        box,
        method: 'trim',
        confidence: 'high',
        coverage,
        note: `纯色底（${hex}）裁边：主体 = 与底色差异明显的像素范围`
    };
}

/** 分割模型给出的绝对框 → 统一形状；按覆盖率给置信度（框占整图过大 = 模型可能把背景也算进去了）。 */
export function resolveMattingSubjectBox(
    bounds: PixelBounds,
    width: number,
    height: number
): SubjectBoxResolution | undefined {
    if (width <= 0 || height <= 0) return undefined;
    const box = pixelBoundsToRelativeBox(bounds, width, height);
    const coverage = relativeBoxCoverage(box);
    if (coverage < MIN_MEANINGFUL_COVERAGE) return undefined;
    const confidence: SubjectBoxConfidence = coverage > 0.9 ? 'low' : 'medium';
    return {
        box,
        method: 'matting',
        confidence,
        coverage,
        note: confidence === 'low'
            ? '本地分割模型给出的框几乎覆盖整图，主体不明显或场景复杂，请看画面确认'
            : '本地分割模型（显著主体）给出的框；复杂场景里「最显眼」未必是产品，请看画面确认'
    };
}

/** 兜底：主体 = 整个图框（contain 适配），明说是低置信。 */
export function frameSubjectBox(): SubjectBoxResolution {
    return {
        box: { x: 0, y: 0, width: 1, height: 1 },
        method: 'frame',
        confidence: 'low',
        coverage: 1,
        note: '没有可用的主体检测，按整张图片外框适配；文字区域仍由版面结构避开，主体尺度请看画面确认'
    };
}
