export const SEMANTIC_MATTING_GUIDANCE_VERSION = 'semantic-matting-guidance/v1' as const;

export interface SemanticMattingNormalizedPoint {
    x: number;
    y: number;
}

export interface SemanticMattingGuidanceSet {
    foregroundPoints: SemanticMattingNormalizedPoint[];
    backgroundPoints: SemanticMattingNormalizedPoint[];
}

export interface SemanticMattingGuidance {
    version: typeof SEMANTIC_MATTING_GUIDANCE_VERSION;
    sets: SemanticMattingGuidanceSet[];
}

export interface SemanticMattingDetectionBox {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

export interface SemanticMattingProviderPoint {
    x: number;
    y: number;
    label: 0 | 1;
}

export type SemanticMattingGuidanceValidationResult =
    | { valid: true; guidance?: SemanticMattingGuidance }
    | { valid: false; code: 'SEMANTIC_GUIDANCE_INVALID'; error: string; issues: string[] };

export type SemanticMattingGuidanceBindingResult =
    | {
        valid: true;
        pointsByBox: SemanticMattingProviderPoint[][];
        guidedBoxIndexes: number[];
    }
    | {
        valid: false;
        code: 'SEMANTIC_GUIDANCE_BINDING_INVALID';
        error: string;
        issues: string[];
    };

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
    const allowedSet = new Set(allowed);
    return Object.keys(value).every(key => allowedSet.has(key));
}

function readNormalizedPoint(
    value: unknown,
    path: string,
    issues: string[]
): SemanticMattingNormalizedPoint | null {
    const record = asRecord(value);
    if (!record || !hasOnlyKeys(record, ['x', 'y'])) {
        issues.push(`${path} 必须只包含 x 与 y。`);
        return null;
    }

    if (typeof record.x !== 'number' || typeof record.y !== 'number') {
        issues.push(`${path} 的 x/y 必须是数值，不能使用字符串或隐式转换。`);
        return null;
    }
    const x = record.x;
    const y = record.y;
    if (!Number.isFinite(x) || x < 0 || x > 1
        || !Number.isFinite(y) || y < 0 || y > 1) {
        issues.push(`${path} 的 x/y 必须是 0 到 1 的有限数值。`);
        return null;
    }

    return { x, y };
}

function readPointList(
    value: unknown,
    path: string,
    minimum: number,
    maximum: number,
    issues: string[]
): SemanticMattingNormalizedPoint[] {
    if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
        issues.push(`${path} 的点数必须在 ${minimum} 到 ${maximum} 之间。`);
        return [];
    }

    const points: SemanticMattingNormalizedPoint[] = [];
    value.forEach((item, index) => {
        const point = readNormalizedPoint(item, `${path}[${index}]`, issues);
        if (point) points.push(point);
    });
    return points;
}

export function normalizeSemanticMattingGuidance(
    value: unknown
): SemanticMattingGuidanceValidationResult {
    if (value === undefined) return { valid: true };

    const issues: string[] = [];
    const record = asRecord(value);
    if (!record || !hasOnlyKeys(record, ['version', 'sets'])) {
        return {
            valid: false,
            code: 'SEMANTIC_GUIDANCE_INVALID',
            error: '语义引导必须是版本化的正负点集合。',
            issues: ['root_shape_invalid']
        };
    }
    if (record.version !== SEMANTIC_MATTING_GUIDANCE_VERSION) {
        issues.push(`version 必须是 ${SEMANTIC_MATTING_GUIDANCE_VERSION}。`);
    }
    if (!Array.isArray(record.sets) || record.sets.length < 1 || record.sets.length > 8) {
        issues.push('sets 必须包含 1 到 8 组目标引导。');
    }

    const sets: SemanticMattingGuidanceSet[] = [];
    if (Array.isArray(record.sets) && record.sets.length >= 1 && record.sets.length <= 8) {
        record.sets.forEach((rawSet, setIndex) => {
            const set = asRecord(rawSet);
            if (!set || !hasOnlyKeys(set, ['foregroundPoints', 'backgroundPoints'])) {
                issues.push(`sets[${setIndex}] 必须只包含 foregroundPoints 与 backgroundPoints。`);
                return;
            }
            const foregroundPoints = readPointList(
                set.foregroundPoints,
                `sets[${setIndex}].foregroundPoints`,
                1,
                4,
                issues
            );
            const backgroundPoints = set.backgroundPoints === undefined
                ? []
                : readPointList(
                    set.backgroundPoints,
                    `sets[${setIndex}].backgroundPoints`,
                    0,
                    8,
                    issues
                );
            sets.push({ foregroundPoints, backgroundPoints });
        });
    }

    if (issues.length > 0 || sets.length !== (Array.isArray(record.sets) ? record.sets.length : 0)) {
        return {
            valid: false,
            code: 'SEMANTIC_GUIDANCE_INVALID',
            error: '语义引导格式无效，抠图工作流没有启动。',
            issues
        };
    }

    return {
        valid: true,
        guidance: {
            version: SEMANTIC_MATTING_GUIDANCE_VERSION,
            sets
        }
    };
}

function containsPoint(box: SemanticMattingDetectionBox, point: SemanticMattingProviderPoint): boolean {
    return point.x >= box.x1 && point.x <= box.x2
        && point.y >= box.y1 && point.y <= box.y2;
}

export function bindSemanticMattingGuidanceToDetectionBoxes(input: {
    guidance?: SemanticMattingGuidance;
    boxes: SemanticMattingDetectionBox[];
    outputWidth: number;
    outputHeight: number;
    baseRegionInOutput: SemanticMattingDetectionBox;
    detectWidth: number;
    detectHeight: number;
}): SemanticMattingGuidanceBindingResult {
    const pointsByBox = input.boxes.map((): SemanticMattingProviderPoint[] => []);
    if (!input.guidance) {
        return { valid: true, pointsByBox, guidedBoxIndexes: [] };
    }

    const baseWidth = input.baseRegionInOutput.x2 - input.baseRegionInOutput.x1;
    const baseHeight = input.baseRegionInOutput.y2 - input.baseRegionInOutput.y1;
    if (!Number.isFinite(input.outputWidth) || !(input.outputWidth > 0)
        || !Number.isFinite(input.outputHeight) || !(input.outputHeight > 0)
        || !Number.isFinite(input.detectWidth) || !(input.detectWidth > 0)
        || !Number.isFinite(input.detectHeight) || !(input.detectHeight > 0)
        || !Number.isFinite(baseWidth) || !(baseWidth > 0)
        || !Number.isFinite(baseHeight) || !(baseHeight > 0)
        || input.boxes.length === 0) {
        return {
            valid: false,
            code: 'SEMANTIC_GUIDANCE_BINDING_INVALID',
            error: '缺少可验证的检测坐标系，无法绑定语义引导。',
            issues: ['guidance_coordinate_space_invalid']
        };
    }

    function mapPoint(point: SemanticMattingNormalizedPoint, label: 0 | 1): SemanticMattingProviderPoint {
        const outputX = point.x * input.outputWidth;
        const outputY = point.y * input.outputHeight;
        return {
            x: ((outputX - input.baseRegionInOutput.x1) / baseWidth) * input.detectWidth,
            y: ((outputY - input.baseRegionInOutput.y1) / baseHeight) * input.detectHeight,
            label
        };
    }

    const issues: string[] = [];
    const guidedBoxIndexes: number[] = [];
    const usedBoxes = new Set<number>();

    input.guidance.sets.forEach((set, setIndex) => {
        const foregroundPoints = set.foregroundPoints.map(point => mapPoint(point, 1));
        const backgroundPoints = set.backgroundPoints.map(point => mapPoint(point, 0));
        const candidateIndexes = input.boxes
            .map((_box, boxIndex) => boxIndex)
            .filter(boxIndex => foregroundPoints.every(point => containsPoint(input.boxes[boxIndex], point)));

        if (candidateIndexes.length !== 1) {
            issues.push(
                candidateIndexes.length === 0
                    ? `sets[${setIndex}] 的前景点没有共同落入一个检测框。`
                    : `sets[${setIndex}] 的前景点同时匹配多个检测框，归属不唯一。`
            );
            return;
        }

        const boxIndex = candidateIndexes[0];
        if (usedBoxes.has(boxIndex)) {
            issues.push(`sets[${setIndex}] 与另一组引导绑定了同一个检测框。`);
            return;
        }
        if (!backgroundPoints.every(point => containsPoint(input.boxes[boxIndex], point))) {
            issues.push(`sets[${setIndex}] 的背景点必须位于其前景点绑定的同一检测框内。`);
            return;
        }

        usedBoxes.add(boxIndex);
        guidedBoxIndexes.push(boxIndex);
        pointsByBox[boxIndex] = [...foregroundPoints, ...backgroundPoints];
    });

    if (issues.length > 0 || guidedBoxIndexes.length !== input.guidance.sets.length) {
        return {
            valid: false,
            code: 'SEMANTIC_GUIDANCE_BINDING_INVALID',
            error: '语义引导无法唯一绑定到检测到的目标，本轮没有修改图层。',
            issues
        };
    }

    return { valid: true, pointsByBox, guidedBoxIndexes };
}
