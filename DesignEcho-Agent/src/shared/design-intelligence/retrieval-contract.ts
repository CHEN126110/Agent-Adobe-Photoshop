/**
 * Design Intelligence · Retrieval Contract（Phase 0）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md §9
 * 职责：统一「检索」的输入输出契约，把 结构化过滤 / 全文 / 语义 / 关系扩展 /
 *       视觉检索 / Rerank / Context 预算 封装成一条可复用的 Pipeline。
 *
 * 边界：
 * - 第一阶段不换数据库、不做重型 Rerank，先封装统一接口。
 * - 品类（main_image / detail_page / sku）属于结构化过滤参数，不属于工具身份。
 * - 纯契约，无 IO。
 */

import type { KnowledgeNode } from './knowledge.types';
import type { KnowledgeStatus } from './knowledge.types';
import type { KnowledgeKind } from './knowledge.types';

/** 检索输入的结构化过滤条件。 */
export interface KnowledgeSearchFilter {
    taskType?: string;
    productCategory?: string;
    brand?: string;
    statuses?: KnowledgeStatus[];
    kinds?: KnowledgeKind[];
    domains?: string[];
    tags?: string[];
}

/** 检索请求。 */
export interface KnowledgeSearchRequest {
    /** 查询文本（语义 + 全文共用） */
    query: string;
    filter?: KnowledgeSearchFilter;
    /** 返回上限 */
    limit?: number;
    /** 是否需要视觉参考（Eagle 相关） */
    requireVisualReferences?: boolean;
}

/** 检索命中的一条知识，附带排序依据（用于可追溯）。 */
export interface KnowledgeSearchHit {
    node: KnowledgeNode;
    /** 命中原因 / 排序依据摘要，供 Task Context 记录「为什么检索到」 */
    reason: string;
    score?: number;
}

/** 检索响应。 */
export interface KnowledgeSearchResponse {
    query: string;
    hits: KnowledgeSearchHit[];
    /** 检索过程警告（来源降级等），不阻断 */
    warnings: string[];
    /** 采用的索引版本 */
    indexVersion: string;
}
