/**
 * Design Intelligence · KnowledgeService 抽象（Phase 0）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md §3/§26/§32
 * 职责：对外暴露意图稳定的知识能力（search / get / related），隐藏底层
 *       Provider 格式（Obsidian YAML / builtin 硬编码 / Eagle metadata）。
 *
 * 边界（§32）：
 * - 工具层只暴露 search / get / relate / propose / review，不暴露文件系统格式。
 * - 本阶段为只读 + 候选提案；写回一律走 knowledge-writeback-contract 的 Gate。
 * - Adapter 实现由各 Provider 提供（见 adapters/）。
 */

import type {
    KnowledgeNode,
    KnowledgeStatus,
    KnowledgeKind
} from '../../../shared/design-intelligence/knowledge.types';
import type { EvidenceRef } from '../../../shared/design-intelligence/evidence.types';
import type { ResourceRelation } from '../../../shared/design-intelligence/relation.types';
import type {
    KnowledgeSearchRequest,
    KnowledgeSearchResponse
} from '../../../shared/design-intelligence/retrieval-contract';

/** 知识检索的结构化过滤条件（与 retrieval-contract 对齐）。 */
export interface KnowledgeSearchFilterContract {
    taskType?: string;
    productCategory?: string;
    brand?: string;
    statuses?: KnowledgeStatus[];
    kinds?: KnowledgeKind[];
    domains?: string[];
    tags?: string[];
}

/** 按 id 获取单条知识。 */
export interface KnowledgeGetRequest {
    id: string;
}

/** 关系扩展检索：给定资源 id，取与之相关的知识/证据/资产。 */
export interface KnowledgeRelatedRequest {
    resourceId: string;
    /** 可选，限定关系类型集合 */
    relationTypes?: string[];
    limit?: number;
}

export interface KnowledgeRelatedResponse {
    relations: ResourceRelation[];
    related: KnowledgeNode[];
    warnings: string[];
}

/**
 * KnowledgeService 抽象接口。
 * 所有方法为只读 + 关系查询；写回通过 KnowledgeWritebackService（后续 Phase）。
 */
export interface KnowledgeService {
    readonly kind: 'knowledge';
    search(request: KnowledgeSearchRequest): Promise<KnowledgeSearchResponse>;
    get(request: KnowledgeGetRequest): Promise<KnowledgeNode | null>;
    related(request: KnowledgeRelatedRequest): Promise<KnowledgeRelatedResponse>;
    /** 列出某条知识关联的证据链（Provenance） */
    evidence(nodeId: string): Promise<EvidenceRef[]>;
}
