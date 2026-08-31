/**
 * 为一次视觉联系表选择有代表性的候选，而不是让单一高分来源垄断画面。
 *
 * 调用方可以传入已经排序的 Skill 候选，也可以传入按路径稳定排序的中性 Agent 候选；
 * 这里不替 Agent 评价图片好坏，只在同一批观察证据中轮转不同来源文件夹。项目没有
 * 目录差异时，再按横/竖/方画幅分散抽样。
 */

export interface AssetShortlistFileLike {
    path?: string;
    relativePath?: string;
    size?: number;
    modifiedTime?: Date | string | number;
    hasAlpha?: boolean;
    dimensions?: {
        width?: number;
        height?: number;
    };
}

export interface RankedAssetShortlistItem {
    file: AssetShortlistFileLike;
}

export interface NeutralAssetCandidatePage<T extends RankedAssetShortlistItem> {
    items: T[];
    /** 候选集合身份；与 G 序号合用，避免跨项目 /scope 把同号候选串在一起。 */
    candidateSetId: string;
    /** 候选在当前集合稳定顺序中的一基序号；集合内跨分页唯一，不随页内编号重置。 */
    itemOrdinals: number[];
    page: number;
    pageSize: number;
    totalCandidates: number;
    totalPages: number;
    hasMore: boolean;
    nextPage?: number;
    ordering: 'stable_source_aspect_span_round_robin';
    ranked: false;
    winnerSelected: false;
}

export function buildNeutralAssetCandidateId(value: unknown): string | undefined {
    const ordinal = Number(value);
    if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > 999_999) return undefined;
    return `G${String(ordinal).padStart(4, '0')}`;
}

function splitPathSegments(value: unknown): string[] {
    return String(value || '')
        .replace(/\\/g, '/')
        .split('/')
        .map((segment) => segment.trim())
        .filter(Boolean);
}

function readDirectorySegments(file: AssetShortlistFileLike): string[] {
    const relativeSegments = splitPathSegments(file.relativePath);
    if (relativeSegments.length > 1) return relativeSegments.slice(0, -1);
    const absoluteSegments = splitPathSegments(file.path);
    return absoluteSegments.length > 1 ? absoluteSegments.slice(0, -1) : [];
}

function findCommonDirectoryDepth(directories: readonly string[][]): number {
    if (directories.length === 0) return 0;
    const shortestLength = Math.min(...directories.map((segments) => segments.length));
    let depth = 0;
    while (depth < shortestLength) {
        const expected = directories[0][depth]?.toLowerCase();
        if (!directories.every((segments) => segments[depth]?.toLowerCase() === expected)) break;
        depth += 1;
    }
    return depth;
}

function resolveAspectFamily(file: AssetShortlistFileLike): string {
    const width = Number(file.dimensions?.width || 0);
    const height = Number(file.dimensions?.height || 0);
    if (width <= 0 || height <= 0) return 'unknown';
    const ratio = width / height;
    if (ratio > 1.2) return 'landscape';
    if (ratio < 0.83) return 'portrait';
    return 'square';
}

function buildSourceFamilies<T extends RankedAssetShortlistItem>(ranked: readonly T[]): string[] {
    const directories = ranked.map((item) => readDirectorySegments(item.file));
    const commonDepth = findCommonDirectoryDepth(directories);
    const directoryFamilies = directories.map((segments) => (
        segments.slice(commonDepth).join('/').toLowerCase() || 'root'
    ));
    if (new Set(directoryFamilies).size > 1) return directoryFamilies;
    return ranked.map((item) => resolveAspectFamily(item.file));
}

export function diversifyAssetRecommendationShortlist<T extends RankedAssetShortlistItem>(
    ranked: readonly T[],
    limit: number
): T[] {
    const boundedLimit = Math.max(0, Math.min(ranked.length, Math.floor(Number(limit) || 0)));
    if (boundedLimit === 0 || ranked.length === 0) return [];

    const families = buildSourceFamilies(ranked);
    const queues = new Map<string, T[]>();
    ranked.forEach((item, index) => {
        const family = families[index] || 'unknown';
        const queue = queues.get(family) || [];
        queue.push(item);
        queues.set(family, queue);
    });

    const selected: T[] = [];
    while (selected.length < boundedLimit) {
        let added = false;
        for (const queue of queues.values()) {
            const next = queue.shift();
            if (!next) continue;
            selected.push(next);
            added = true;
            if (selected.length >= boundedLimit) break;
        }
        if (!added) break;
    }
    return selected;
}

function normalizeStableAssetPath(file: AssetShortlistFileLike): string {
    return String(file.relativePath || file.path || '')
        .trim()
        .replace(/\\/g, '/')
        .toLowerCase();
}

function normalizeCandidateModifiedTime(value: AssetShortlistFileLike['modifiedTime']): number {
    if (value instanceof Date) {
        const dateTime = value.getTime();
        return Number.isFinite(dateTime) ? dateTime : 0;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeCandidateIdentity(file: AssetShortlistFileLike): string {
    const absolutePath = String(file.path || '').trim().replace(/\\/g, '/').toLowerCase();
    const relativePath = String(file.relativePath || '').trim().replace(/\\/g, '/').toLowerCase();
    const width = Number(file.dimensions?.width || 0);
    const height = Number(file.dimensions?.height || 0);
    const modifiedTime = normalizeCandidateModifiedTime(file.modifiedTime);
    const fileSize = Number.isFinite(Number(file.size)) ? Number(file.size) : 0;
    const alphaState = typeof file.hasAlpha === 'boolean' ? String(file.hasAlpha) : 'unknown';
    return `${absolutePath}|${relativePath}|${width}x${height}|${fileSize}|${modifiedTime}|${alphaState}`;
}

function createStableCandidateSetId(scope: unknown, candidates: readonly RankedAssetShortlistItem[]): string {
    const value = JSON.stringify({
        scope: String(scope || '').trim(),
        candidates: candidates.map((candidate) => normalizeCandidateIdentity(candidate.file))
    });
    let left = 0x811c9dc5;
    let right = 0x9e3779b9;
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        left = Math.imul(left ^ code, 0x01000193) >>> 0;
        right = Math.imul(right ^ code, 0x85ebca6b) >>> 0;
    }
    return `candidate-set-v1-${left.toString(16).padStart(8, '0')}${right.toString(16).padStart(8, '0')}`;
}

function orderNeutralBucketAcrossSpan<T>(bucket: readonly T[]): T[] {
    if (bucket.length <= 1) return [...bucket];
    const ordered: T[] = [];
    const ranges: Array<{ start: number; end: number }> = [{ start: 0, end: bucket.length - 1 }];
    while (ranges.length > 0) {
        const range = ranges.shift();
        if (!range || range.start > range.end) continue;
        const middle = Math.floor((range.start + range.end) / 2);
        ordered.push(bucket[middle]);
        if (range.start <= middle - 1) ranges.push({ start: range.start, end: middle - 1 });
        if (middle + 1 <= range.end) ranges.push({ start: middle + 1, end: range.end });
    }
    return ordered;
}

function buildNeutralSourceSpanOrdering<T extends RankedAssetShortlistItem>(stable: readonly T[]): T[] {
    const families = buildSourceFamilies(stable);
    const buckets = new Map<string, T[]>();
    stable.forEach((item, index) => {
        const family = families[index] || 'unknown';
        const bucket = buckets.get(family) || [];
        bucket.push(item);
        buckets.set(family, bucket);
    });
    const queues = Array.from(buckets.values(), (bucket) => orderNeutralBucketAcrossSpan(bucket));
    const ordered: T[] = [];
    while (ordered.length < stable.length) {
        let added = false;
        for (const queue of queues) {
            const next = queue.shift();
            if (!next) continue;
            ordered.push(next);
            added = true;
        }
        if (!added) break;
    }
    return ordered;
}

/**
 * 为主 Agent 构造稳定、中性的候选分页。路径只用于去重和稳定身份；来源文件夹 /画幅
 * 与桶内跨度只用于扩大观察覆盖，避免第一页退化为目录 first-N。它不读取 requirement、
 * 不计算适配分、不产生推荐第一名。
 */
export function buildNeutralAssetCandidatePage<T extends RankedAssetShortlistItem>(
    candidates: readonly T[],
    input: { page?: unknown; pageSize?: unknown; candidateSetScope?: unknown } = {}
): NeutralAssetCandidatePage<T> {
    const requestedPage = Number(input.page);
    const requestedPageSize = Number(input.pageSize);
    const page = Number.isFinite(requestedPage)
        ? Math.max(1, Math.min(100_000, Math.floor(requestedPage)))
        : 1;
    const pageSize = Number.isFinite(requestedPageSize)
        ? Math.max(1, Math.min(12, Math.floor(requestedPageSize)))
        : 5;
    const stableRows = candidates
        .map((item, index) => ({ item, index, path: normalizeStableAssetPath(item.file) }))
        .filter((row) => Boolean(row.path))
        .sort((left, right) => {
            if (left.path < right.path) return -1;
            if (left.path > right.path) return 1;
            return left.index - right.index;
        });
    const seen = new Set<string>();
    const uniqueRows = stableRows.filter((row) => {
        if (seen.has(row.path)) return false;
        seen.add(row.path);
        return true;
    });
    const ordered = buildNeutralSourceSpanOrdering(uniqueRows.map((row) => row.item));
    const candidateSetId = createStableCandidateSetId(input.candidateSetScope, ordered);
    const totalCandidates = ordered.length;
    const totalPages = totalCandidates > 0 ? Math.ceil(totalCandidates / pageSize) : 0;
    const offset = (page - 1) * pageSize;
    const items = ordered.slice(offset, offset + pageSize);
    const itemOrdinals = items.map((_item, index) => offset + index + 1);
    const hasMore = page < totalPages;
    return {
        items,
        candidateSetId,
        itemOrdinals,
        page,
        pageSize,
        totalCandidates,
        totalPages,
        hasMore,
        ...(hasMore ? { nextPage: page + 1 } : {}),
        ordering: 'stable_source_aspect_span_round_robin',
        ranked: false,
        winnerSelected: false
    };
}
