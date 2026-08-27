/**
 * 语义抠图候选物体契约（纯逻辑，主/渲染进程共用）
 *
 * 思路：先由分割模型给出"画面里有哪些前景物体"（连通域拆分），再让模型回答
 * "哪几个是袜子"。相比让模型直接画边界框，这样做有三个实质好处：
 * 1. 框来自真实分割结果，精度不依赖模型的坐标能力（通用对话模型画框普遍不准）；
 * 2. 模型只需回答编号，答案空间极小，弱定位能力的模型也能稳定完成；
 * 3. 候选自带精确蒙版，选中后可直接取像素，无需二次分割。
 *
 * 边界：本文件不做 IO、不感知模型。选定权归模型——这里只负责把画面拆成候选，
 * 绝不替模型决定"哪个是用户要的目标"。
 */

/** 一个候选物体 */
export interface SemanticCandidate {
    /** 从 1 开始的编号，用于标注图与模型作答 */
    id: number;
    /** 前景像素数 */
    area: number;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

export interface CandidateExtractionOptions {
    /** 判定前景的灰度阈值 */
    foregroundThreshold: number;
    /** 候选面积下限（占全图比例），过滤分割毛刺 */
    minAreaRatio: number;
    /** 最多保留几个候选：标注图上编号太多反而让模型难以作答 */
    maxCandidates: number;
}

/** 短到可以直接当作答案的回答长度：模型直接答"3"或"1,3"时才整段提取数字 */
const SHORT_ANSWER_MAX_LENGTH = 40;

export const DEFAULT_CANDIDATE_EXTRACTION: CandidateExtractionOptions = {
    foregroundThreshold: 128,
    minAreaRatio: 0.002,
    maxCandidates: 12
};

export interface CandidateExtractionResult {
    candidates: SemanticCandidate[];
    /**
     * 与蒙版等长的标记数组：labels[i] 是该像素所属候选的 id，0 表示背景。
     * 选中候选后据此取出精确蒙版。
     */
    labels: Int32Array;
}

/**
 * 4 邻域连通域拆分。
 *
 * 用显式栈而不是递归：整图连通的前景会让递归深度达到像素级，必然爆栈。
 */
export function extractMaskComponents(
    mask: Uint8Array | Buffer,
    width: number,
    height: number,
    options: CandidateExtractionOptions = DEFAULT_CANDIDATE_EXTRACTION
): CandidateExtractionResult {
    const total = width * height;
    const labels = new Int32Array(total);

    if (total <= 0 || mask.length < total) {
        return { candidates: [], labels };
    }

    const threshold = options.foregroundThreshold;
    const minArea = Math.max(1, Math.floor(total * options.minAreaRatio));
    const raw: SemanticCandidate[] = [];
    const stack: number[] = [];
    let nextLabel = 0;

    for (let seed = 0; seed < total; seed++) {
        if (mask[seed] < threshold || labels[seed] !== 0) continue;

        nextLabel++;
        let area = 0;
        let minX = width;
        let minY = height;
        let maxX = 0;
        let maxY = 0;

        labels[seed] = nextLabel;
        stack.push(seed);

        while (stack.length > 0) {
            const index = stack.pop() as number;
            const x = index % width;
            const y = (index - x) / width;

            area++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;

            if (x > 0) pushNeighbor(index - 1);
            if (x < width - 1) pushNeighbor(index + 1);
            if (y > 0) pushNeighbor(index - width);
            if (y < height - 1) pushNeighbor(index + width);
        }

        raw.push({ id: nextLabel, area, x1: minX, y1: minY, x2: maxX + 1, y2: maxY + 1 });
    }

    function pushNeighbor(neighbor: number): void {
        if (labels[neighbor] !== 0 || mask[neighbor] < threshold) return;
        labels[neighbor] = nextLabel;
        stack.push(neighbor);
    }

    // 按面积从大到小保留，再重新编号成 1..N：标注图上的编号必须连续，
    // 否则模型看到 1、3、7 这样的跳号容易答错。
    const kept = raw
        .filter(item => item.area >= minArea)
        .sort((a, b) => b.area - a.area)
        .slice(0, options.maxCandidates);

    const renumber = new Int32Array(nextLabel + 1);
    const candidates: SemanticCandidate[] = kept.map((item, index) => {
        renumber[item.id] = index + 1;
        return { ...item, id: index + 1 };
    });

    for (let i = 0; i < total; i++) {
        const label = labels[i];
        labels[i] = label > 0 ? renumber[label] : 0;
    }

    return { candidates, labels };
}

/** 在一个候选内部撒点的参数 */
export interface PointGridOptions {
    /** 期望的采样点总数，行列按候选的长宽比自动分配 */
    targetPoints: number;
}

/**
 * 按候选的长宽比分配网格行列。
 *
 * 固定行列会漏掉细长物体的两端：竖构图的腿部特写用 3 列 x 4 行时，
 * 四行落点都在腿和袜上，脚上的鞋一个点都没采到（真机复现过）。
 */
export function resolveGridShape(
    boxWidth: number,
    boxHeight: number,
    targetPoints: number
): { columns: number; rows: number } {
    const total = Math.max(2, targetPoints);
    if (boxWidth <= 0 || boxHeight <= 0) return { columns: 1, rows: total };

    const aspect = boxHeight / boxWidth;
    const rows = Math.max(1, Math.round(Math.sqrt(total * aspect)));
    const columns = Math.max(1, Math.round(total / rows));
    return { columns, rows };
}

/**
 * 在候选物体内部生成采样点。
 *
 * 只保留真正落在该候选像素上的点：落到背景或别的物体上的点会让分割模型
 * 切出无关区域（实测背景点会返回整块背景）。
 */
export function buildCandidatePointGrid(
    candidate: SemanticCandidate,
    labels: Int32Array,
    width: number,
    options: PointGridOptions
): Array<{ x: number; y: number }> {
    const points: Array<{ x: number; y: number }> = [];
    const boxWidth = candidate.x2 - candidate.x1;
    const boxHeight = candidate.y2 - candidate.y1;
    if (boxWidth <= 0 || boxHeight <= 0) return points;

    const { columns, rows } = resolveGridShape(boxWidth, boxHeight, options.targetPoints);

    for (let row = 1; row <= rows; row++) {
        for (let col = 1; col <= columns; col++) {
            const x = Math.round(candidate.x1 + (boxWidth * col) / (columns + 1));
            const y = Math.round(candidate.y1 + (boxHeight * row) / (rows + 1));
            if (labels[y * width + x] !== candidate.id) continue;
            points.push({ x, y });
        }
    }

    return points;
}

/**
 * 找出还没被任何部件覆盖的前景区域，在其中补一个采样点。
 *
 * 网格总会漏掉物体（细长的、偏在一角的）。补点按"最大未覆盖连通块的中心"来放，
 * 比继续加密网格更省推理次数。
 */
export function findUncoveredPoint(
    labels: Int32Array,
    candidateId: number,
    covered: Uint8Array,
    width: number,
    height: number,
    minAreaRatio: number,
    candidateArea: number
): { x: number; y: number; area: number } | null {
    const visited = new Uint8Array(width * height);
    const stack: number[] = [];
    let best: { x: number; y: number; area: number } | null = null;

    for (let seed = 0; seed < labels.length; seed++) {
        if (labels[seed] !== candidateId || covered[seed] === 1 || visited[seed] === 1) continue;

        let area = 0;
        let sumX = 0;
        let sumY = 0;
        const members: number[] = [];

        visited[seed] = 1;
        stack.push(seed);

        while (stack.length > 0) {
            const index = stack.pop() as number;
            const x = index % width;
            const y = (index - x) / width;
            area++;
            sumX += x;
            sumY += y;
            members.push(index);

            const neighbors = [
                x > 0 ? index - 1 : -1,
                x < width - 1 ? index + 1 : -1,
                y > 0 ? index - width : -1,
                y < height - 1 ? index + width : -1
            ];
            for (const n of neighbors) {
                if (n < 0 || visited[n] === 1) continue;
                if (labels[n] !== candidateId || covered[n] === 1) continue;
                visited[n] = 1;
                stack.push(n);
            }
        }

        if (area < candidateArea * minAreaRatio) continue;
        if (best && area <= best.area) continue;

        // 质心可能落在凹形区域之外，取块内离质心最近的像素
        const cx = Math.round(sumX / area);
        const cy = Math.round(sumY / area);
        let bestIndex = members[0];
        let bestDistance = Infinity;
        for (const index of members) {
            const x = index % width;
            const y = (index - x) / width;
            const distance = (x - cx) * (x - cx) + (y - cy) * (y - cy);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = index;
            }
        }

        const x = bestIndex % width;
        best = { x, y: (bestIndex - x) / width, area };
    }

    return best;
}

/** 两张二值蒙版的交并比，用于判断两个点是否切到了同一个物体 */
export function maskIoU(
    a: Uint8Array | Buffer,
    b: Uint8Array | Buffer,
    threshold: number
): number {
    const length = Math.min(a.length, b.length);
    let intersection = 0;
    let union = 0;

    for (let i = 0; i < length; i++) {
        const inA = a[i] >= threshold;
        const inB = b[i] >= threshold;
        if (inA && inB) intersection++;
        if (inA || inB) union++;
    }

    return union > 0 ? intersection / union : 0;
}

export interface CandidateSelectionResult {
    /** 模型选中的候选编号 */
    selected: number[];
    /** 模型明确表示没有一个是目标 */
    noneMatched: boolean;
    /** 解析失败原因 */
    parseError?: string;
}

/** 括号配平提取含指定键的顶层 JSON 对象 */
function extractJsonCandidates(text: string, requiredKey: string): string[] {
    const found: string[] = [];
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
                    const slice = text.slice(i, j + 1);
                    if (slice.includes(requiredKey)) found.push(slice);
                    i = j;
                    break;
                }
            }
        }
    }
    return found;
}

function normalizeIds(values: unknown[], validIds: number[]): number[] {
    const valid = new Set(validIds);
    const picked: number[] = [];
    for (const value of values) {
        const num = typeof value === 'number' ? value : Number(String(value ?? '').trim());
        if (!Number.isInteger(num) || !valid.has(num)) continue;
        if (!picked.includes(num)) picked.push(num);
    }
    return picked.sort((a, b) => a - b);
}

/**
 * 解析模型对候选的选择。
 *
 * 优先 JSON；模型不肯给 JSON 时才从文本兜底提取编号——这个兜底之所以安全，
 * 是因为答案空间被 validIds 限死，且要求命中"选择"语境的关键词。
 * （坐标不能这样兜底：从自然语言里捞出的数字当成像素坐标会直接抠错位置。）
 */
export function parseCandidateSelection(
    responseText: string,
    validIds: number[]
): CandidateSelectionResult {
    const text = String(responseText || '').trim();
    if (!text) {
        return { selected: [], noneMatched: false, parseError: '选择模型返回了空文本' };
    }

    const jsonCandidates = extractJsonCandidates(text, '"selected"');
    for (let i = jsonCandidates.length - 1; i >= 0; i--) {
        let parsed: any;
        try {
            parsed = JSON.parse(jsonCandidates[i]);
        } catch {
            continue;
        }
        if (!Array.isArray(parsed?.selected)) continue;

        const selected = normalizeIds(parsed.selected, validIds);
        return { selected, noneMatched: selected.length === 0 };
    }

    // 兜底：模型用自然语言作答（订阅通道的模型尤其容易这样）。
    // 这里必须收紧——真机上模型回了一整段图片描述，宽松地"提取全文所有数字"
    // 把 1..5 全捞了出来，等于全选，用户白等 25 秒还拿到整个前景。
    const selected = extractIdsFromProse(text, validIds);
    if (selected.length > 0) {
        // 兜底提取出"全部候选"几乎一定是误读：模型逐个描述编号时会依次提到每个数字。
        // 真要全选，模型会给出 JSON（走上面的分支），不会靠散文表达。
        if (validIds.length >= 3 && selected.length === validIds.length) {
            return {
                selected: [],
                noneMatched: false,
                parseError: '模型没有按要求给出编号，回答里逐个提到了全部候选，无法判断它到底选了哪个。'
                    + `模型回答：${text.slice(0, 120)}`
            };
        }
        return { selected, noneMatched: false };
    }

    // 没能读出任何编号时，才看模型是不是在说"一个都不是"。
    // 这个判断必须排在提取之后：真机上模型答过"我选择 2 和 4……其余都不是"，
    // 先查"都不是"会把一次有效选择整个吞掉。
    if (/没有|都不是|均不是|none|no match/i.test(text)) {
        return { selected: [], noneMatched: true };
    }

    return {
        selected: [],
        noneMatched: false,
        parseError: `无法从模型回答中读出候选编号。模型回答：${text.slice(0, 120)}`
    };
}

/**
 * 从自然语言回答里提取候选编号。
 *
 * 按可信度分三档，避免把散文里的数字当成选择：
 * 1. 决定性措辞（"我选择 2 和 4"、"selected: 3"）——直接采信；
 * 2. 中性措辞（"编号 3"）——只有全文出现一次才采信。真机上模型逐条描述
 *    "编号 1 是模特的腿，编号 2 是袜筒…"，多次出现说明它在讲图而不是在作答；
 * 3. 整条回答很短（模型直接答"3"）——整段提数字。
 */
function extractIdsFromProse(text: string, validIds: number[]): number[] {
    const decisive = text.match(/(?:selected|选中|选择|答案|挑选|pick)\s*(?:的?是|为|:|：)?\s*([\d\s,，、和与]+)/i);
    if (decisive) {
        const picked = normalizeIds(
            Array.from(decisive[1].matchAll(/\d+/g)).map(item => Number(item[0])),
            validIds
        );
        if (picked.length > 0) return picked;
    }

    // 短回答优先整段提数字：文本短就没有描述的余地，而按"编号"逐个匹配
    // 反而会漏掉并列项（"编号 1 和 3" 只会匹配到 1）。
    if (text.length <= SHORT_ANSWER_MAX_LENGTH) {
        const ids = Array.from(text.matchAll(/\d+/g)).map(item => Number(item[0]));
        const picked = normalizeIds(ids, validIds);
        if (picked.length > 0) return picked;
    }

    const neutral = Array.from(text.matchAll(/(?:编号|number|#)\s*(?:是|为|:|：)?\s*(\d+)/gi));
    if (neutral.length === 1) {
        return normalizeIds([Number(neutral[0][1])], validIds);
    }

    return [];
}
