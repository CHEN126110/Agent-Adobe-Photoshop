/**
 * 只读工具结果的运行级缓存与重复调用护栏（纯逻辑、可由正式审计直接验证）。
 *
 * 背景（2026-07-25 实机）：单轮运行内"搜索项目资源×2、推荐素材×3"零产出重复——
 * 既有 loop guard 只拦"完全相同批次"和"连续失败"，对成功的重复调用零护栏。
 * 本模块给 Agent 循环一个按"工具名+规范化参数"签名的运行级缓存：
 * 命中即返回克隆结果（不重复执行），任何写类/切档成功后整体失效。
 *
 * 纪律：
 * - 只缓存幂等只读/检索调用；写类、导出、声明、切档一律不缓存且会使缓存失效；
 * - 命中结果是浅层克隆 + 结构化 cacheHit（上层不得把它计作新观察或任务进展）；
 * - 缓存只活一轮运行（Agent.run 内建、run 末弃），不持久化、不跨运行共享。
 */

/** 允许缓存的只读/检索工具（与执行分类无关，按工具名单维护）。 */
const CACHEABLE_READ_TOOLS: ReadonlySet<string> = new Set([
    'listProjectResources',
    'searchProjectResources',
    'getResourcesByCategory',
    'getDesignProjectState',
    'searchDesignKnowledge',
    'searchEagleReferences',
    'browseAssetCandidates',
    'recommendAssets',
    'describeImage',
    'parseDetailPageTemplate',
    'getDocumentInfo',
    'getLayerHierarchy',
    // 同一文档版本、同一参数的画布快照代价高，且重复回传会重复消耗视觉预算。
    // 任一写入、导出或切档成功都会清空整表；Harness 改后验收也显式绕过缓存。
    'getCanvasSnapshot',
    'getAnnotatedSnapshot',
    // 视觉理解类：单次几十秒，是准备阶段最大的时间开销，也最容易被重复调用。
    // 读的是磁盘素材 / Eagle 库 / 静态知识，同一次运行内必然同解；画面写入仍会
    // 令整表失效，所以"改后必看"不受影响（真机 374 秒的运行里，
    // analyzeProjectContactSheetOverview 被调两次白烧 59 秒）。
    'analyzeProjectContactSheetOverview',
    'analyzeEagleReference',
    'observeEagleAsset',
    'analyzeAssetContent',
    'analyzePsdDesignSource',
    'measureReferenceComposition',
    // 静态设计知识：每次返回同一份框架文本，没有重复请求的理由。
    'getDesignPrinciples',
    'getDesignKnowledge',
    'getMainImageDesignFramework',
    'getDetailPageDesignFramework',
    'searchDesigns'
]);

export interface AgentReadResultCacheEntry {
    signature: string;
    result: unknown;
    createdAt: number;
}

/** 结构化参数的稳定序列化（键排序，数组保序；函数/undefined 归一为 null）。 */
export function stableStringifyForReadCache(value: unknown): string {
    return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortValue);
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(record).sort()) {
            sorted[key] = sortValue(record[key]);
        }
        return sorted;
    }
    if (typeof value === 'function' || value === undefined) return null;
    return value ?? null;
}

export function buildReadCallSignature(toolName: string, params: unknown): string {
    return `${toolName}:${stableStringifyForReadCache(params ?? {})}`;
}

export function isCacheableReadTool(toolName: string): boolean {
    return CACHEABLE_READ_TOOLS.has(String(toolName || '').trim());
}

export interface AgentRevisionScopedReadCacheInput {
    args: unknown;
    photoshopDocumentObservation: boolean;
    documentBinding?: {
        status: string;
        expectedRevision: {
            documentId: number;
            historyStateId: number;
        };
    };
    freshResultRevision?: {
        documentId: number;
        historyStateId: number;
    };
}

/**
 * Photoshop 文档读取必须带可信 document/revision 作用域；正在 reobserve/conflict
 * 且尚无本次真实结果时禁止命中。项目资源、知识等非文档读取保持原参数签名。
 */
export function buildAgentRevisionScopedReadCacheParams(
    input: AgentRevisionScopedReadCacheInput
): unknown | null {
    if (!input.photoshopDocumentObservation) return input.args ?? {};
    const binding = input.documentBinding;
    if (!input.freshResultRevision
        && (!binding || binding.status === 'needs_reobserve' || binding.status === 'conflict')) {
        return null;
    }
    const revision = input.freshResultRevision || binding?.expectedRevision;
    if (!revision) return null;
    return {
        arguments: input.args ?? {},
        documentRevision: {
            documentId: revision.documentId,
            historyStateId: revision.historyStateId
        }
    };
}

export const AGENT_READ_RESULT_CACHE_HIT_VERSION = 'agent-read-result-cache-hit/v1' as const;

export interface AgentReadResultCacheHit {
    version: typeof AGENT_READ_RESULT_CACHE_HIT_VERSION;
    hit: true;
}

// 结构字段会进入模型上下文，但运行时信用只认本模块真实签发的对象身份；
// Tool/provider 伪造相同字段不能让观察、视觉预算或进展会计被跳过。
const issuedAgentReadResultCacheHits = new WeakSet<object>();

/** 命中缓存时返回的克隆结果：结构化标记为复用，不得计作新观察或任务进展。 */
export function buildCachedReadResult(entry: AgentReadResultCacheEntry): any {
    const source = entry.result && typeof entry.result === 'object'
        ? { ...(entry.result as Record<string, unknown>) }
        : { success: true, value: entry.result };
    const cachedResult = {
        ...source,
        readCache: {
            version: AGENT_READ_RESULT_CACHE_HIT_VERSION,
            hit: true
        } satisfies AgentReadResultCacheHit,
        cacheHit: true,
        countsAsObservation: false,
        countsAsTaskProgress: false,
        cacheNote: '本轮已调用过相同查询，以下是有界缓存结果（不是新观察）；只有目标或文档版本改变后才需要重新读取。'
    };
    issuedAgentReadResultCacheHits.add(cachedResult);
    return cachedResult;
}

export function isAgentReadResultCacheHit(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const result = value as Record<string, unknown>;
    const readCache = result.readCache as Partial<AgentReadResultCacheHit> | undefined;
    return issuedAgentReadResultCacheHits.has(value)
        && result.cacheHit === true
        && readCache?.version === AGENT_READ_RESULT_CACHE_HIT_VERSION
        && readCache.hit === true;
}

export class AgentReadResultCache {
    private readonly entries = new Map<string, AgentReadResultCacheEntry>();

    get(toolName: string, params: unknown): AgentReadResultCacheEntry | undefined {
        return this.entries.get(buildReadCallSignature(toolName, params));
    }

    set(toolName: string, params: unknown, result: unknown, now = Date.now()): void {
        // 运行级缓存不设容量焦虑，但同一工具最多保留 8 个签名，防止长尾参数膨胀。
        const signature = buildReadCallSignature(toolName, params);
        this.entries.set(signature, { signature, result, createdAt: now });
        const perTool = [...this.entries.values()].filter((entry) => entry.signature.startsWith(`${toolName}:`));
        if (perTool.length > 8) {
            const oldest = perTool.sort((a, b) => a.createdAt - b.createdAt)[0];
            this.entries.delete(oldest.signature);
        }
    }

    clear(): void {
        this.entries.clear();
    }

    get size(): number {
        return this.entries.size;
    }
}
