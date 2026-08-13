/**
 * Design Intelligence · RetrievalService 抽象（Phase 0）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md §9
 * 职责：封装「知识 + 视觉资产」的混合检索流水线（结构化过滤 → 全文 → 语义 →
 *       关系扩展 → 视觉 → Rerank → Context 预算）。阶段一只做只读统一，
 *       不换数据库、不做重型 Rerank。
 *
 * 边界：品类属于检索参数，不属于工具身份；本服务不区分 main_image/detail_page/sku 专属路径。
 */

import type { KnowledgeSearchRequest, KnowledgeSearchResponse } from '../../../shared/design-intelligence/retrieval-contract';
import type { AssetSearchRequest, AssetSearchResponse } from './asset-service';

/** 混合检索请求：同时带知识查询与视觉查询条件。 */
export interface HybridRetrievalRequest {
    knowledge?: KnowledgeSearchRequest;
    visual?: AssetSearchRequest;
    limit?: number;
}

/** 混合检索响应：知识与视觉参考分开返回。 */
export interface HybridRetrievalResponse {
    knowledge: KnowledgeSearchResponse;
    visual: AssetSearchResponse;
    warnings: string[];
}

/**
 * RetrievalService 抽象接口。
 * 本阶段只读；为 Task Context Builder（Phase 1）提供统一取数入口。
 */
export interface RetrievalService {
    readonly kind: 'retrieval';
    searchKnowledge(request: KnowledgeSearchRequest): Promise<KnowledgeSearchResponse>;
    searchAssets(request: AssetSearchRequest): Promise<AssetSearchResponse>;
    hybrid(request: HybridRetrievalRequest): Promise<HybridRetrievalResponse>;
}
