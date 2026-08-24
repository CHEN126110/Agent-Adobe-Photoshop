/**
 * 设计源蒸馏（L0-b 归一 + L0-c 提纯）——把逐文件的 PSD 观测炼成「每店一页纸」。
 *
 * 与 psd-design-source.ts 的分工：那边是 L0-a 提取（一份文件 → 一份档案），本身只是转码；
 * 本模块把多份档案**归一成关系**、再**按证据强度提纯**成可迁移的规律。
 *
 * 为什么必须归一（真机语料实测，见 docs/asset-distillation-knowledge-feasibility-2026-08-19.md §1.2）：
 * SKU 画布 4480x6720、详情页 1440x29999、主图 1500x2000 差十几倍，直接统计原始数值会把
 * 同一条规律拆成三条互相矛盾的「规范」（SKU 417px vs 详情页 59px）。数值绑死画布，关系才能迁移。
 *
 * 边界（钉进代码，不是口头承诺）：
 * - 纯逻辑：不读文件、不调模型、不落盘（落盘由知识库服务负责）；
 * - 每条结论都是**假设**不是事实：必带证据、反例与证伪条件——没有证伪条件的不是假设，是信念；
 * - 判不了的一律标 unknown 并**放行**，绝不因不确定而丢弃或阻断（与 model-capability-verdict
 *   的三态红线同构：只有明确否定才允许阻断，unknown 一律放行，因为代价不对称）；
 * - 证据以**不同源文件数**计，不以出现次数计——一份文件里重复 100 次不是 100 份证据。
 */

import type { PsdDesignSourceProfile } from './psd-design-source';

export const DESIGN_SOURCE_ONE_PAGER_VERSION = 'design-source-one-pager/v0' as const;

/** 证据强度三档；unknown 不在此列——不确定的是因果，不是强度。 */
export type DistillationConfidence = 'high' | 'medium' | 'low';

/** 因果判定：这条规律是设计选择，还是外部强加的？unknown 必须放行。 */
export type DistillationCausality = 'taste' | 'external_constraint' | 'unknown';

export interface DistillationEvidence {
    /** 不同源文件数——证据强度的主口径 */
    sourceFileCount: number;
    /** 总出现次数（辅助口径，单独不足以支撑结论） */
    occurrenceCount: number;
    /** 跨了哪些任务类型；跨品类出现是强信号 */
    taskTypes: string[];
    /** 最近一次出现的文件 mtime，用于时间问 */
    latestMtime?: number;
}

/** 一条蒸馏假设：命题 + 证据 + 反例 + 证伪条件，缺一不可。 */
export interface DistilledHypothesis {
    claim: string;
    evidence: DistillationEvidence;
    /** 反例描述；空数组表示未发现反例（不等于"不存在反例"） */
    counterExamples: string[];
    confidence: DistillationConfidence;
    /** 什么情况下这条作废——没有它就不是假设 */
    falsifiedBy: string;
    causality: DistillationCausality;
}

/** 蒸馏输入：一份文件的档案 + 它的身份与时间 */
export interface DesignSourceObservation {
    profile: PsdDesignSourceProfile;
    filePath: string;
    /** 任务类型，按文件名判定（实测：PSD 全在 PSD/ 目录下，文件名才是标签） */
    taskType: string;
    /** 文件修改时间，用于断层检测 */
    mtime: number;
}

/** 字体规范的时间断层：现行 vs 已被取代 */
export interface TypefaceTimeline {
    current: string[];
    superseded: string[];
    /** 断层发生的大致时间；检测不到断层时为 undefined（不臆造） */
    shiftedAt?: number;
    note: string;
}

/** 每店一页纸——蒸馏的最终产物，必须小到能常驻上下文 */
export interface DesignSourceOnePager {
    version: typeof DESIGN_SOURCE_ONE_PAGER_VERSION;
    shopId: string;
    coverage: {
        fileCount: number;
        taskTypes: string[];
        earliestMtime?: number;
        latestMtime?: number;
    };
    /** 字号层级关系（归一后） */
    typography: DistilledHypothesis[];
    /** 色板 */
    palette: DistilledHypothesis[];
    /** 字体的现行与废弃 */
    typeface: TypefaceTimeline;
    /** 版心等版面度量（归一后的比例） */
    metrics: DistilledHypothesis[];
    warnings: string[];
}

const MIN_SOURCE_FILES_FOR_CLAIM = 2;
const HIGH_CONFIDENCE_SOURCE_FILES = 5;
const MEDIUM_CONFIDENCE_SOURCE_FILES = 3;
/** 字体断层判定窗口：最近这个比例的文件算「新规范」 */
const TYPEFACE_RECENT_WINDOW_RATIO = 0.4;

/**
 * 字号归一化的基准长度——把绝对 px 换算成跨画布可比的比例。
 *
 * 这是本模块唯一的设计判断点：不同品类画布差十几倍，除以什么才能让「详情页 59px」
 * 和「SKU 417px」落到同一把尺子上，取决于这些交付物**实际是怎么被看的**。
 */
export function resolveFontSizeBaseline(
    canvas: { width: number; height: number },
    taskType: string
): number {
    // TODO(human)
    return canvas.width;
}

/** 把绝对字号换算成占基准的千分比（保留一位小数，避免浮点噪声） */
export function normalizeFontSize(
    fontSizePx: number,
    canvas: { width: number; height: number },
    taskType: string
): number {
    const baseline = resolveFontSizeBaseline(canvas, taskType);
    if (!Number.isFinite(baseline) || baseline <= 0) return 0;
    return Math.round((fontSizePx / baseline) * 10000) / 10;
}

function confidenceOf(sourceFileCount: number, taskTypeCount: number): DistillationConfidence {
    if (sourceFileCount >= HIGH_CONFIDENCE_SOURCE_FILES) return 'high';
    if (sourceFileCount >= MEDIUM_CONFIDENCE_SOURCE_FILES) return 'medium';
    // 跨品类出现能救回低频但真实的规律（如点缀用的品牌色，频次天然低）
    if (taskTypeCount >= 2 && sourceFileCount >= MIN_SOURCE_FILES_FOR_CLAIM) return 'medium';
    return 'low';
}

function buildHypothesis(input: {
    claim: string;
    evidence: DistillationEvidence;
    counterExamples?: string[];
    falsifiedBy: string;
    causality?: DistillationCausality;
}): DistilledHypothesis {
    return {
        claim: input.claim,
        evidence: input.evidence,
        counterExamples: input.counterExamples || [],
        confidence: confidenceOf(input.evidence.sourceFileCount, input.evidence.taskTypes.length),
        falsifiedBy: input.falsifiedBy,
        // 因果判定需要跨店对照或公共知识；本模块是单店纯逻辑，判不了就标 unknown 放行，不阻断
        causality: input.causality || 'unknown'
    };
}

function uniqueStrings(values: Array<string | undefined>): string[] {
    const seen = new Set<string>();
    for (const value of values) {
        const text = String(value || '').trim();
        if (text) seen.add(text);
    }
    return Array.from(seen);
}

function median(values: number[]): number {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

/**
 * 字号层级：把各文件归一后的字号聚成「正文档」与「标题档」，输出两者的倍率关系。
 * 样本不足时如实降级为 low 置信，而不是不出结论——不丢信息。
 */
function distillTypography(observations: DesignSourceObservation[]): DistilledHypothesis[] {
    const normalized: Array<{ value: number; taskType: string; filePath: string; mtime: number }> = [];
    for (const observation of observations) {
        const { canvas } = observation.profile;
        for (const level of observation.profile.typography.fontSizeLevels) {
            const value = normalizeFontSize(level, canvas, observation.taskType);
            if (value > 0) {
                normalized.push({
                    value,
                    taskType: observation.taskType,
                    filePath: observation.filePath,
                    mtime: observation.mtime
                });
            }
        }
    }
    if (normalized.length < 2) return [];

    const sorted = [...normalized].sort((a, b) => a.value - b.value);
    const half = Math.max(1, Math.floor(sorted.length / 2));
    const bodyValue = median(sorted.slice(0, half).map((item) => item.value));
    const headingValue = median(sorted.slice(half).map((item) => item.value));
    const evidence: DistillationEvidence = {
        sourceFileCount: uniqueStrings(normalized.map((item) => item.filePath)).length,
        occurrenceCount: normalized.length,
        taskTypes: uniqueStrings(normalized.map((item) => item.taskType)),
        latestMtime: Math.max(...normalized.map((item) => item.mtime))
    };

    const results: DistilledHypothesis[] = [];
    results.push(buildHypothesis({
        claim: `正文字号约为基准长度的 ${bodyValue}‰`,
        evidence,
        falsifiedBy: '若后续文件的正文归一字号中位数偏离该值超过 20%，本条作废'
    }));
    if (bodyValue > 0) {
        const ratio = Math.round((headingValue / bodyValue) * 100) / 100;
        results.push(buildHypothesis({
            claim: `标题字号约为正文的 ${ratio} 倍`,
            evidence,
            falsifiedBy: '若后续文件的标题/正文倍率偏离该值超过 30%，本条作废'
        }));
    }
    return results;
}

/** 色板：按出现的源文件数排序；跨品类出现优先（点缀色频次天然低，靠跨品类救回） */
function distillPalette(observations: DesignSourceObservation[]): DistilledHypothesis[] {
    const byColor = new Map<string, { files: Set<string>; taskTypes: Set<string>; count: number; latestMtime: number }>();
    for (const observation of observations) {
        for (const color of observation.profile.palette.textColors) {
            const key = String(color || '').trim().toUpperCase();
            if (!key) continue;
            const entry = byColor.get(key)
                || { files: new Set<string>(), taskTypes: new Set<string>(), count: 0, latestMtime: 0 };
            entry.files.add(observation.filePath);
            entry.taskTypes.add(observation.taskType);
            entry.count += 1;
            entry.latestMtime = Math.max(entry.latestMtime, observation.mtime);
            byColor.set(key, entry);
        }
    }
    return Array.from(byColor.entries())
        .map(([color, entry]) => buildHypothesis({
            claim: `使用 ${color}`,
            evidence: {
                sourceFileCount: entry.files.size,
                occurrenceCount: entry.count,
                taskTypes: Array.from(entry.taskTypes),
                latestMtime: entry.latestMtime
            },
            falsifiedBy: `若最近的文件不再出现 ${color}，本条转为 superseded`
        }))
        .sort((a, b) => (
            b.evidence.sourceFileCount - a.evidence.sourceFileCount
            || b.evidence.taskTypes.length - a.evidence.taskTypes.length
        ));
}

/**
 * 字体断层检测：按 mtime 排序，看某字体是否在较新的文件里彻底消失。
 * 不拍衰减系数——断层是从真实文件里读出来的，而且断层本身就是一条知识。
 */
function distillTypeface(observations: DesignSourceObservation[]): TypefaceTimeline {
    const sorted = [...observations].sort((a, b) => a.mtime - b.mtime);
    if (!sorted.length) {
        return { current: [], superseded: [], note: '无样本' };
    }

    const splitIndex = Math.min(Math.floor(sorted.length * (1 - TYPEFACE_RECENT_WINDOW_RATIO)), sorted.length - 1);
    const recent = sorted.slice(splitIndex);
    const earlier = sorted.slice(0, splitIndex);
    const recentFonts = uniqueStrings(recent.flatMap((item) => item.profile.typography.fontFamilies));
    const earlierFonts = uniqueStrings(earlier.flatMap((item) => item.profile.typography.fontFamilies));
    const superseded = earlierFonts.filter((font) => !recentFonts.includes(font));

    if (!earlier.length) {
        return { current: recentFonts, superseded: [], note: '样本时间跨度不足，未做断层判定' };
    }
    if (!superseded.length) {
        return { current: recentFonts, superseded: [], note: '未检测到字体断层，规范稳定' };
    }
    return {
        current: recentFonts,
        superseded,
        shiftedAt: recent[0]?.mtime,
        note: `检测到字体断层：${superseded.join('、')} 已不出现在较新文件中`
    };
}

/** 版心：文字左缘占画布宽的比例（psd-design-source 已给出 safeMarginRatio） */
function distillMetrics(observations: DesignSourceObservation[]): DistilledHypothesis[] {
    const byTaskType = new Map<string, { ratios: number[]; files: Set<string>; latestMtime: number }>();
    for (const observation of observations) {
        const ratio = observation.profile.metrics.safeMarginRatio;
        if (typeof ratio !== 'number' || !Number.isFinite(ratio)) continue;
        const entry = byTaskType.get(observation.taskType)
            || { ratios: [], files: new Set<string>(), latestMtime: 0 };
        entry.ratios.push(ratio);
        entry.files.add(observation.filePath);
        entry.latestMtime = Math.max(entry.latestMtime, observation.mtime);
        byTaskType.set(observation.taskType, entry);
    }
    return Array.from(byTaskType.entries()).map(([taskType, entry]) => buildHypothesis({
        claim: `${taskType} 版心左边距约占画布宽 ${Math.round(median(entry.ratios) * 1000) / 10}%`,
        evidence: {
            sourceFileCount: entry.files.size,
            occurrenceCount: entry.ratios.length,
            taskTypes: [taskType],
            latestMtime: entry.latestMtime
        },
        falsifiedBy: '若后续该品类文件的版心比例中位数偏离超过 5 个百分点，本条作废'
    }));
}

/** 蒸馏主入口：多份档案 → 一页纸。 */
export function distillDesignSourceOnePager(
    shopId: string,
    observations: DesignSourceObservation[]
): DesignSourceOnePager {
    const warnings: string[] = [];
    if (!observations.length) {
        warnings.push('没有可用的设计源档案，未产出任何结论。');
    }
    const mtimes = observations
        .map((item) => item.mtime)
        .filter((value) => Number.isFinite(value) && value > 0);

    return {
        version: DESIGN_SOURCE_ONE_PAGER_VERSION,
        shopId,
        coverage: {
            fileCount: observations.length,
            taskTypes: uniqueStrings(observations.map((item) => item.taskType)),
            earliestMtime: mtimes.length ? Math.min(...mtimes) : undefined,
            latestMtime: mtimes.length ? Math.max(...mtimes) : undefined
        },
        typography: distillTypography(observations),
        palette: distillPalette(observations),
        typeface: distillTypeface(observations),
        metrics: distillMetrics(observations),
        warnings
    };
}
