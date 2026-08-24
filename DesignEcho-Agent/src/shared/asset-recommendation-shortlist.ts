/**
 * 为一次视觉联系表选择有代表性的候选，而不是让单一高分来源垄断画面。
 *
 * 输入已经按任务相关度排序；这里不替 Agent 评价图片好坏，只在同一批观察证据中
 * 轮转不同来源文件夹。项目没有目录差异时，再按横/竖/方画幅分散抽样。
 */

export interface AssetShortlistFileLike {
    path?: string;
    relativePath?: string;
    dimensions?: {
        width?: number;
        height?: number;
    };
}

export interface RankedAssetShortlistItem {
    file: AssetShortlistFileLike;
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
