/**
 * 语义抠图目标框契约（纯逻辑，主/渲染进程共用）
 *
 * 背景：抠图面板的"抠取目标"（如"袜子""鞋子"）需要先把自然语言转成图像上的
 * 像素边界框，再交给分割模型在框内精确分割。本文件只负责"文本 → 框"这一段的
 * 纯逻辑：解析模型返回、坐标反归一化、可信度校验、候选取舍。
 *
 * 坐标约定：
 * - 模型按 0..SEMANTIC_TARGET_GRID 的整数网格输出，与图像实际像素尺寸解耦，
 *   避免模型被大尺寸图层的真实像素值带偏；
 * - 统一使用 {x1,y1,x2,y2} 对象而非数组，避免 [x,y] 与 [y,x] 顺序歧义
 *   （不同模型家族的数组约定并不一致）。
 *
 * 边界：本文件不做任何网络或文件 IO，不感知具体模型；定位失败就如实返回失败，
 * 不退化成"全图分割"——那会让用户以为语义生效了，实际拿到的是显著性主体。
 */

/** 模型输出使用的归一化网格上限 */
export const SEMANTIC_TARGET_GRID = 1000;

/** 单个目标框（既用于归一化网格坐标，也用于反归一化后的像素坐标） */
export interface SemanticTargetBox {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    /** 模型给出的目标名称，用于回显给用户核对 */
    label: string;
    /** 模型自报置信度，0..1；模型未给出时为 0 */
    confidence: number;
}

/** 模型返回文本的解析结果 */
export interface SemanticTargetParseResult {
    /** 归一化网格坐标下的候选框（尚未反归一化） */
    boxes: SemanticTargetBox[];
    /** 模型明确表示图中没有该目标 */
    notFound: boolean;
    /** 解析失败原因；成功时为 undefined */
    parseError?: string;
}

/** 候选取舍参数 */
export interface SemanticTargetSelectionOptions {
    /** 最多返回几个目标 */
    maxTargets: number;
    /** 判定两框重复的 IoU 阈值 */
    duplicateIoU: number;
    /** 低于此置信度的候选直接丢弃；模型未给置信度（0）时不参与此过滤 */
    minConfidence: number;
}

export const DEFAULT_SEMANTIC_TARGET_SELECTION: SemanticTargetSelectionOptions = {
    maxTargets: 8,
    duplicateIoU: 0.75,
    minConfidence: 0.2
};

/** 目标框面积占全图比例的合理区间：过小多为误检点，过大等同于全图分割 */
const MIN_BOX_AREA_RATIO = 0.001;
const MAX_BOX_AREA_RATIO = 0.985;

/**
 * 括号配平提取顶层 JSON 对象候选。
 * 正则非贪婪匹配会在嵌套的 targets 数组处截断，不可用（与 design-team-verdict 同源教训）。
 */
function extractJsonObjectCandidates(text: string, requiredKey: string): string[] {
    const candidates: string[] = [];
    for (let i = 0; i < text.length; i++) {
        if (text[i] !== '{') continue;
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let j = i; j < text.length; j++) {
            const ch = text[j];
            if (inString) {
                if (escaped) {
                    escaped = false;
                } else if (ch === '\\') {
                    escaped = true;
                } else if (ch === '"') {
                    inString = false;
                }
                continue;
            }
            if (ch === '"') {
                inString = true;
            } else if (ch === '{') {
                depth++;
            } else if (ch === '}') {
                depth--;
                if (depth === 0) {
                    const candidate = text.slice(i, j + 1);
                    if (candidate.includes(requiredKey)) candidates.push(candidate);
                    i = j;
                    break;
                }
            }
        }
    }
    return candidates;
}

function readFiniteNumber(value: unknown): number | null {
    const num = typeof value === 'number' ? value : Number(String(value ?? '').trim());
    return Number.isFinite(num) ? num : null;
}

/** 归一化置信度：模型可能给 0..1、0..100 或不给 */
function normalizeConfidence(value: unknown): number {
    const num = readFiniteNumber(value);
    if (num === null || num <= 0) return 0;
    if (num > 1) return Math.min(1, num / 100);
    return num;
}

function readBoxFromEntry(entry: any): { x1: number; y1: number; x2: number; y2: number } | null {
    const source = entry?.box && typeof entry.box === 'object' && !Array.isArray(entry.box)
        ? entry.box
        : entry;

    if (Array.isArray(entry?.box) && entry.box.length === 4) {
        const values = entry.box.map(readFiniteNumber);
        if (values.some((v: number | null) => v === null)) return null;
        return { x1: values[0], y1: values[1], x2: values[2], y2: values[3] };
    }

    const x1 = readFiniteNumber(source?.x1 ?? source?.left);
    const y1 = readFiniteNumber(source?.y1 ?? source?.top);
    const x2 = readFiniteNumber(source?.x2 ?? source?.right);
    const y2 = readFiniteNumber(source?.y2 ?? source?.bottom);
    if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
    return { x1, y1, x2, y2 };
}

/**
 * 解析定位模型返回的文本。
 *
 * 期望结构：{"found":true,"targets":[{"label":"袜子","x1":120,"y1":300,"x2":480,"y2":760,"confidence":0.9}]}
 * 模型常见的额外解释文字会被括号配平提取跳过。
 */
export function parseSemanticTargetResponse(
    responseText: string,
    grid: number = SEMANTIC_TARGET_GRID
): SemanticTargetParseResult {
    const text = String(responseText || '').trim();
    if (!text) {
        return { boxes: [], notFound: false, parseError: '定位模型返回了空文本' };
    }

    const candidates = extractJsonObjectCandidates(text, '"targets"');
    if (candidates.length === 0) {
        return {
            boxes: [],
            notFound: false,
            parseError: `定位模型未按约定返回 JSON（缺少 targets 字段）。原始返回片段：${text.slice(0, 200)}`
        };
    }

    // 从最后一个候选往前试：模型常先解释、最后给结论
    for (let i = candidates.length - 1; i >= 0; i--) {
        let parsed: any;
        try {
            parsed = JSON.parse(candidates[i]);
        } catch {
            continue;
        }

        const rawTargets = Array.isArray(parsed?.targets) ? parsed.targets : [];
        const boxes: SemanticTargetBox[] = [];

        for (const entry of rawTargets) {
            const box = readBoxFromEntry(entry);
            if (!box) continue;
            boxes.push({
                x1: Math.min(box.x1, box.x2),
                y1: Math.min(box.y1, box.y2),
                x2: Math.max(box.x1, box.x2),
                y2: Math.max(box.y1, box.y2),
                label: String(entry?.label || entry?.name || '').trim(),
                confidence: normalizeConfidence(entry?.confidence ?? entry?.score)
            });
        }

        const explicitNotFound = parsed?.found === false || parsed?.notFound === true;
        if (boxes.length === 0) {
            return { boxes: [], notFound: explicitNotFound || rawTargets.length === 0 };
        }

        // 网格越界说明模型没遵守坐标系约定，按解析失败处理而不是硬裁剪，
        // 否则会把"模型理解错了"伪装成"定位成功"
        const outOfGrid = boxes.some(
            b => b.x1 < -1 || b.y1 < -1 || b.x2 > grid + 1 || b.y2 > grid + 1
        );
        if (outOfGrid) {
            return {
                boxes: [],
                notFound: false,
                parseError: `定位模型返回的坐标超出 0..${grid} 网格，无法换算到图像像素`
            };
        }

        return { boxes, notFound: false };
    }

    return {
        boxes: [],
        notFound: false,
        parseError: `定位模型返回的 JSON 无法解析。原始返回片段：${text.slice(0, 200)}`
    };
}

/** 把归一化网格坐标换算成图像像素坐标 */
export function denormalizeSemanticTargetBoxes(
    boxes: SemanticTargetBox[],
    imageWidth: number,
    imageHeight: number,
    grid: number = SEMANTIC_TARGET_GRID
): SemanticTargetBox[] {
    const scaleX = imageWidth / grid;
    const scaleY = imageHeight / grid;
    return boxes.map(box => ({
        label: box.label,
        confidence: box.confidence,
        x1: Math.max(0, Math.round(box.x1 * scaleX)),
        y1: Math.max(0, Math.round(box.y1 * scaleY)),
        x2: Math.min(imageWidth, Math.round(box.x2 * scaleX)),
        y2: Math.min(imageHeight, Math.round(box.y2 * scaleY))
    }));
}

/** 像素框是否落在合理范围：有实际面积、不退化成全图 */
export function isPlausibleSemanticTargetBox(
    box: SemanticTargetBox,
    imageWidth: number,
    imageHeight: number
): boolean {
    if (!Number.isFinite(imageWidth)
        || !Number.isFinite(imageHeight)
        || imageWidth <= 0
        || imageHeight <= 0
        || ![box.x1, box.y1, box.x2, box.y2].every(Number.isFinite)
        || box.x1 < 0
        || box.y1 < 0
        || box.x2 > imageWidth
        || box.y2 > imageHeight) {
        return false;
    }
    const width = box.x2 - box.x1;
    const height = box.y2 - box.y1;
    if (width <= 1 || height <= 1) return false;

    const imageArea = imageWidth * imageHeight;
    const areaRatio = (width * height) / imageArea;
    return areaRatio >= MIN_BOX_AREA_RATIO && areaRatio <= MAX_BOX_AREA_RATIO;
}

/** 两框交并比 */
export function semanticTargetBoxIoU(a: SemanticTargetBox, b: SemanticTargetBox): number {
    const interX1 = Math.max(a.x1, b.x1);
    const interY1 = Math.max(a.y1, b.y1);
    const interX2 = Math.min(a.x2, b.x2);
    const interY2 = Math.min(a.y2, b.y2);
    const interW = interX2 - interX1;
    const interH = interY2 - interY1;
    if (interW <= 0 || interH <= 0) return 0;

    const interArea = interW * interH;
    const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
    const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
    const union = areaA + areaB - interArea;
    return union > 0 ? interArea / union : 0;
}

interface RankedSemanticTargetBox {
    box: SemanticTargetBox;
    sourceIndex: number;
}

function normalizeSelectionOptions(
    options: SemanticTargetSelectionOptions
): SemanticTargetSelectionOptions {
    const maxTargets = Number.isFinite(options.maxTargets) && options.maxTargets > 0
        ? Math.min(64, Math.floor(options.maxTargets))
        : DEFAULT_SEMANTIC_TARGET_SELECTION.maxTargets;
    const duplicateIoU = Number.isFinite(options.duplicateIoU)
        ? Math.min(1, Math.max(0, options.duplicateIoU))
        : DEFAULT_SEMANTIC_TARGET_SELECTION.duplicateIoU;
    const minConfidence = Number.isFinite(options.minConfidence)
        ? Math.min(1, Math.max(0, options.minConfidence))
        : DEFAULT_SEMANTIC_TARGET_SELECTION.minConfidence;
    return { maxTargets, duplicateIoU, minConfidence };
}

function compareRankedSemanticTargetBoxes(
    left: RankedSemanticTargetBox,
    right: RankedSemanticTargetBox
): number {
    const leftHasConfidence = left.box.confidence > 0;
    const rightHasConfidence = right.box.confidence > 0;
    if (leftHasConfidence !== rightHasConfidence) return leftHasConfidence ? -1 : 1;
    if (left.box.confidence !== right.box.confidence) {
        return right.box.confidence - left.box.confidence;
    }
    return left.sourceIndex - right.sourceIndex;
}

/**
 * 从定位模型给出的候选框中选出真正要分割的目标。
 * 这是纯机械的候选卫生：边界/面积与置信度过滤、稳定排序、IoU 去重和数量封顶；
 * 不按标签或品类替模型补框，也不把未知置信度（0）伪装成低置信失败。
 */
export function selectSemanticTargetBoxes(
    candidates: SemanticTargetBox[],
    imageWidth: number,
    imageHeight: number,
    options: SemanticTargetSelectionOptions = DEFAULT_SEMANTIC_TARGET_SELECTION
): SemanticTargetBox[] {
    const normalizedOptions = normalizeSelectionOptions(options);
    const ranked = candidates
        .map((box, sourceIndex) => ({ box, sourceIndex }))
        .filter(({ box }) => (
            isPlausibleSemanticTargetBox(box, imageWidth, imageHeight)
            && (box.confidence === 0 || box.confidence >= normalizedOptions.minConfidence)
        ))
        .sort(compareRankedSemanticTargetBoxes);
    const selected: SemanticTargetBox[] = [];
    for (const candidate of ranked) {
        const duplicate = selected.some((accepted) => {
            const overlap = semanticTargetBoxIoU(candidate.box, accepted);
            return overlap > 0 && overlap >= normalizedOptions.duplicateIoU;
        });
        if (duplicate) continue;
        selected.push(candidate.box);
        if (selected.length >= normalizedOptions.maxTargets) break;
    }
    return selected;
}
