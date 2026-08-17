/**
 * Design Intelligence · Duplicate Detection（Phase 4）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md
 *   §12 Knowledge Steward Agent / Phase 4（Duplicate Detection / Candidate Merge）
 *
 * 职责：纯逻辑检测「可能重复」的知识条目（基于标题/范围/标签的文本相似度），
 *       供 Steward Agent 提出「这三个案例可能属于同一 Pattern」这类合并建议。
 *
 * 边界：
 * - 只产出「疑似重复」候选（pair + 相似度 + 依据），不做自动合并；
 *   合并必须经 Candidate Review Gate 且写入走 Knowledge Write Gate。
 * - 用可复现的确定性相似度（Jaccard over tokens），不依赖第三方 embedding。
 */

import type { KnowledgeNode } from './knowledge.types';

/** 一条疑似重复的候选。 */
export interface DuplicateCandidate {
    /** 两条知识的 id（顺序按输入顺序） */
    aId: string;
    bId: string;
    /** 0~1 相似度 */
    similarity: number;
    /** 相似依据摘要（人话，供 Steward 向用户解释） */
    basis: string;
}

/** 把文本切成小写 token 集合（去停用词，保留中文/词）。 */
export function tokenize(text: string): Set<string> {
    const tokens = new Set<string>();
    const lower = text.toLowerCase();
    // 中文字符逐字 + 英文/数字按词
    for (const m of lower.match(/[\u4e00-\u9fa5]|[a-z0-9]+/g) ?? []) {
        tokens.add(m);
    }
    return tokens;
}

/** Jaccard 相似度（0~1）。 */
export function jaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 1;
    let inter = 0;
    for (const t of a) if (b.has(t)) inter += 1;
    const union = a.size + b.size - inter;
    return union === 0 ? 1 : inter / union;
}

/** 计算两条知识之间的相似度（标题 + scope 加权）。 */
export function knowledgeSimilarity(a: KnowledgeNode, b: KnowledgeNode): number {
    const aTokens = tokenize(`${a.title} ${a.scope ?? ''}`);
    const bTokens = tokenize(`${b.title} ${b.scope ?? ''}`);
    return jaccard(aTokens, bTokens);
}

const DEFAULT_DUPLICATE_THRESHOLD = 0.55;

/**
 * 在一批知识中检测疑似重复（两两比较，跳过已废弃/自身）。
 * @param nodes 知识列表
 * @param threshold 相似度阈值，默认 0.55
 */
export function detectDuplicates(
    nodes: readonly KnowledgeNode[],
    threshold = DEFAULT_DUPLICATE_THRESHOLD
): DuplicateCandidate[] {
    const result: DuplicateCandidate[] = [];
    for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        if (a.status === 'deprecated') continue;
        for (let j = i + 1; j < nodes.length; j++) {
            const b = nodes[j];
            if (b.status === 'deprecated') continue;
            const sim = knowledgeSimilarity(a, b);
            if (sim >= threshold) {
                result.push({
                    aId: a.id,
                    bId: b.id,
                    similarity: sim,
                    basis: `标题/范围重叠度 ${Math.round(sim * 100)}%`
                });
            }
        }
    }
    return result;
}
