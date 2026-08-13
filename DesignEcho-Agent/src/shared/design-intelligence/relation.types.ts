/**
 * Design Intelligence · ResourceRelation 契约（Phase 0）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md §8
 * 职责：描述知识/证据/视觉资产之间的关系（相关、支撑、矛盾、正反例、派生、取代…）。
 *
 * 边界：
 * - 第一阶段用 SQLite Relation Table 即可，不引入 Neo4j 等重型 Graph DB。
 * - 前端「知识图谱」只是 Relation Index 的一种可视化；Graph 核心价值是知识追溯、
 *   关系扩展检索、冲突发现、案例关联、知识缺口发现。
 * - 纯契约，无 IO。
 */

/** 关系类型。 */
export type RelationType =
    | 'related'
    | 'supports'
    | 'contradicts'
    | 'example_of'
    | 'counterexample_of'
    | 'derived_from'
    | 'supersedes'
    | 'used_in'
    | 'learned_from';

/** 关系创建者：用户 / Agent / 系统。Agent 建立的关系在权限上受 Gate 约束。 */
export type RelationCreator = 'user' | 'agent' | 'system';

export interface ResourceRelation {
    id: string;
    fromId: string;
    toId: string;
    type: RelationType;
    /** 0~1 置信度，可选 */
    confidence?: number;
    createdBy: RelationCreator;
}

/** 从某个资源出发做「关系扩展检索」时，一次可扩展的关系类型集合（去重用）。 */
export const RELATION_TYPES: ReadonlyArray<RelationType> = [
    'related',
    'supports',
    'contradicts',
    'example_of',
    'counterexample_of',
    'derived_from',
    'supersedes',
    'used_in',
    'learned_from'
];
