/**
 * Design Intelligence · 组合式 KnowledgeService 实现（Phase 0）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md §3/§36
 * 职责：把现有两条只读知识通道（统一知识检索 searchDesignKnowledge、Eagle 只读检索）
 *       包进统一 KnowledgeService 契约，作为「Legacy → Knowledge Service」的 Adapter。
 *
 * 边界：
 * - 本实现是 Wrapper：不改原 Agent 行为，现有工具仍走原路径；只新增一条契约化入口。
 * - 只读；写回 / 候选 / Obsidian 见后续 Phase。
 * - 品类属于检索参数（taskType），不属于工具身份。
 */

import type { KnowledgeNode } from '../../../shared/design-intelligence/knowledge.types';
import type { EvidenceRef } from '../../../shared/design-intelligence/evidence.types';
import type { KnowledgeSearchRequest, KnowledgeSearchResponse, KnowledgeSearchHit } from '../../../shared/design-intelligence/retrieval-contract';
import type { DesignKnowledgeSourceType } from '../../../shared/design-knowledge-search';
import type { KnowledgeService, KnowledgeRelatedResponse } from './knowledge-service';
import { mapKnowledgeResultsToNodes } from './adapters/result-mapper';

/** 渲染侧运行时能力（window.designEcho 上已暴露的方法签名）。 */
export interface DesignIntelligenceRuntimeApi {
    searchDesignKnowledge?: (query: unknown, settings?: unknown) => Promise<{
        success: boolean;
        results?: unknown[];
        warnings?: string[];
        error?: string;
    }>;
}

/** 构造 KnowledgeService 的实现参数。 */
export interface CompositeKnowledgeServiceOptions {
    api: DesignIntelligenceRuntimeApi;
    /** 当前可用的索引版本（默认静态占位，后续接真实索引） */
    indexVersion?: string;
    /**
     * 限定这个适配器允许触发的知识来源。
     * 自动 TaskContext 用它约束为本地治理知识；显式搜索工具不经过此适配器，仍可联网。
     */
    sourceTypes?: DesignKnowledgeSourceType[];
}

/**
 * 组合式只读 KnowledgeService。
 * search() 把 query 透传给现有 searchDesignKnowledge，并把结果归一化为 KnowledgeNode。
 */
export class CompositeKnowledgeService implements KnowledgeService {
    readonly kind = 'knowledge' as const;
    private readonly api: DesignIntelligenceRuntimeApi;
    private readonly indexVersion: string;
    private readonly sourceTypes: DesignKnowledgeSourceType[] | undefined;

    constructor(options: CompositeKnowledgeServiceOptions) {
        this.api = options.api;
        this.indexVersion = options.indexVersion || 'phase0-v1';
        this.sourceTypes = options.sourceTypes ? [...options.sourceTypes] : undefined;
    }

    async search(request: KnowledgeSearchRequest): Promise<KnowledgeSearchResponse> {
        const api = this.api.searchDesignKnowledge;
        const warnings: string[] = [];
        const hits: KnowledgeSearchHit[] = [];

        if (!api) {
            warnings.push('当前桌面运行时未提供统一知识检索。');
            return { query: request.query, hits, warnings, indexVersion: this.indexVersion };
        }

        try {
            const query = {
                query: request.query,
                limit: request.limit || 8,
                sourceTypes: this.sourceTypes
            };
            const raw = await api(query, { enabled: true });
            if (!raw || !raw.success) {
                warnings.push(raw?.error || '统一知识检索没有返回可用结果。');
                return { query: request.query, hits, warnings, indexVersion: this.indexVersion };
            }

            const nodes = mapKnowledgeResultsToNodes(Array.isArray(raw.results) ? raw.results as never[] : []);
            for (const node of nodes) {
                hits.push({ node, reason: `命中「${request.query}」` });
            }
            warnings.push(...(raw.warnings || []));
        } catch (error) {
            warnings.push(`统一知识检索失败：${String(error)}`);
        }

        return {
            query: request.query,
            hits,
            warnings: Array.from(new Set(warnings.filter(Boolean))),
            indexVersion: this.indexVersion
        };
    }

    async get(request: { id: string }): Promise<KnowledgeNode | null> {
        // Phase 0 只读统一：单条精确获取暂由检索兜底（命中同 id 返回，否则 null）。
        const resp = await this.search({ query: request.id, limit: 8 });
        return resp.hits.find((hit) => hit.node.id === request.id)?.node || null;
    }

    async related(_request: { resourceId: string; relationTypes?: string[]; limit?: number }): Promise<KnowledgeRelatedResponse> {
        // 关系索引属 Phase 3（Visual-Semantic Linking）；阶段 0 返回空关系集。
        return { relations: [], related: [], warnings: ['关系索引尚未建立（Phase 3）。'] };
    }

    async evidence(nodeId: string): Promise<EvidenceRef[]> {
        const node = await this.get({ id: nodeId });
        return node ? node.sourceRefs : [];
    }
}
