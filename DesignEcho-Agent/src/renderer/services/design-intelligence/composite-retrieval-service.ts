/**
 * Design Intelligence · 组合式 RetrievalService 实现（Phase 0）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md §9
 * 职责：统一「知识 + 视觉资产」混合检索入口，供未来 Task Context Builder（Phase 1）取数。
 *
 * 边界：
 * - 阶段 0 只做只读统一（结构化过滤 → 检索），不做重型 Rerank / 换数据库。
 * - 品类属于检索参数，不属于工具身份；不新增品类专属检索路径。
 */

import type { KnowledgeSearchRequest, KnowledgeSearchResponse } from '../../../shared/design-intelligence/retrieval-contract';
import type { AssetSearchRequest, AssetSearchResponse } from './asset-service';
import type { KnowledgeService } from './knowledge-service';
import type { AssetService } from './asset-service';
import type { HybridRetrievalRequest, HybridRetrievalResponse, RetrievalService } from './retrieval-service';

/** 构造组合式 RetrievalService 的参数。 */
export interface CompositeRetrievalServiceOptions {
    knowledge: KnowledgeService;
    assets: AssetService;
}

/** 组合式只读 RetrievalService：知识 + 视觉并行取数。 */
export class CompositeRetrievalService implements RetrievalService {
    readonly kind = 'retrieval' as const;
    private readonly knowledge: KnowledgeService;
    private readonly assets: AssetService;

    constructor(options: CompositeRetrievalServiceOptions) {
        this.knowledge = options.knowledge;
        this.assets = options.assets;
    }

    async searchKnowledge(request: KnowledgeSearchRequest): Promise<KnowledgeSearchResponse> {
        return this.knowledge.search(request);
    }

    async searchAssets(request: AssetSearchRequest): Promise<AssetSearchResponse> {
        return this.assets.search(request);
    }

    async hybrid(request: HybridRetrievalRequest): Promise<HybridRetrievalResponse> {
        const knowledgePromise: Promise<KnowledgeSearchResponse> = request.knowledge
            ? this.knowledge.search(request.knowledge)
            : Promise.resolve({ query: '', hits: [], warnings: [], indexVersion: 'none' });

        const visualPromise: Promise<AssetSearchResponse> = request.visual
            ? this.assets.search(request.visual)
            : Promise.resolve({ query: '', results: [], warnings: [] });

        const [knowledgeResp, visualResp] = await Promise.all([knowledgePromise, visualPromise]);

        return {
            knowledge: knowledgeResp,
            visual: visualResp,
            warnings: Array.from(new Set([
                ...knowledgeResp.warnings,
                ...visualResp.warnings
            ]))
        };
    }
}
