/**
 * Design Intelligence · Visual-Semantic Linking（Phase 3）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md
 *   §8 Relation Graph / §16 Visual Evidence / Phase 3 Visual-Semantic Linking
 *
 * 职责：把「设计方法论」与「Eagle 视觉案例」关联起来（正例 / 反例 / 参考 / 反例），
 *       并支持双向反查（Phase 3 Exit Criteria）：
 *       - 任意核心设计规则可反查视觉案例；
 *       - 任意 Eagle 案例可反查关联知识。
 *
 * 边界：
 * - 纯逻辑 + 契约，无 IO。关系数据由上层 Relation 存储提供（第一阶段用 SQLite Relation Table）。
 * - 本文件只做「关系 → 双向反查结果」的确定性推导，不负责写关系（写走 Writeback Gate）。
 * - Agent 建立关系属 Safe Write（add_ai_relation），但仍受 Gate 约束，见 knowledge-writeback-contract.ts。
 */

import type { RelationType, ResourceRelation, RelationCreator } from './relation.types';

/** 视觉案例在一条知识下扮演的角色。 */
export type VisualExampleRole =
    | 'positive_example'
    | 'negative_example'
    | 'reference'
    | 'counterexample';

/** 视觉角色 → 关系类型映射（决定关系如何建、如何反查）。 */
export const VISUAL_LINK_ROLE_TO_RELATION: Readonly<Record<VisualExampleRole, RelationType>> = {
    positive_example: 'example_of',
    negative_example: 'counterexample_of',
    reference: 'related',
    counterexample: 'contradicts'
};

/** 关系类型 → 视觉角色 反向映射（用于反查时归位）。 */
export const VISUAL_LINK_RELATION_TO_ROLE: Readonly<Partial<Record<RelationType, VisualExampleRole>>> = {
    example_of: 'positive_example',
    counterexample_of: 'negative_example',
    related: 'reference',
    contradicts: 'counterexample'
};

/** 判断一条关系是否属于「知识 ↔ 视觉案例」链接。 */
export function isVisualLink(relation: Pick<ResourceRelation, 'type'>): boolean {
    return VISUAL_LINK_RELATION_TO_ROLE[relation.type] !== undefined;
}

/** 构造视觉链接关系的输入。 */
export interface VisualLinkInput {
    /** 知识节点 id */
    knowledgeId: string;
    /** 视觉资产 id（Eagle asset_id 等） */
    assetId: string;
    role: VisualExampleRole;
    confidence?: number;
    createdBy: RelationCreator;
}

/** 构造一条知识 ↔ 视觉案例 的 ResourceRelation（确定性 id，便于幂等）。 */
export function buildVisualLink(input: VisualLinkInput): ResourceRelation {
    return {
        id: `${input.knowledgeId}::${VISUAL_LINK_ROLE_TO_RELATION[input.role]}::${input.assetId}`,
        fromId: input.knowledgeId,
        toId: input.assetId,
        type: VISUAL_LINK_ROLE_TO_RELATION[input.role],
        ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
        createdBy: input.createdBy
    };
}

/** 按角色分组的视觉案例 id。 */
export interface KnowledgeVisualExamples {
    positive_example: string[];
    negative_example: string[];
    reference: string[];
    counterexample: string[];
}

const EMPTY_EXAMPLES: KnowledgeVisualExamples = {
    positive_example: [],
    negative_example: [],
    reference: [],
    counterexample: []
};

/** 知识 → 视觉案例 反查：给定关系集，取出某条知识关联的全部视觉资产并按角色分组。 */
export function expandKnowledgeToVisualExamples(
    relations: readonly ResourceRelation[],
    knowledgeId: string
): KnowledgeVisualExamples {
    const result: KnowledgeVisualExamples = {
        positive_example: [],
        negative_example: [],
        reference: [],
        counterexample: []
    };
    for (const rel of relations) {
        if (rel.fromId !== knowledgeId) continue;
        const role = VISUAL_LINK_RELATION_TO_ROLE[rel.type];
        if (!role) continue;
        result[role].push(rel.toId);
    }
    return result;
}

/** 视觉案例 → 知识 反查：给定关系集，取出某资产关联的全部知识（含角色）。 */
export interface VisualAssetKnowledgeLink {
    knowledgeId: string;
    role: VisualExampleRole;
    confidence?: number;
}

export function expandVisualAssetToKnowledge(
    relations: readonly ResourceRelation[],
    assetId: string
): VisualAssetKnowledgeLink[] {
    const result: VisualAssetKnowledgeLink[] = [];
    for (const rel of relations) {
        if (rel.toId !== assetId) continue;
        const role = VISUAL_LINK_RELATION_TO_ROLE[rel.type];
        if (!role) continue;
        result.push({
            knowledgeId: rel.fromId,
            role,
            ...(rel.confidence !== undefined ? { confidence: rel.confidence } : {})
        });
    }
    return result;
}

/** 判断一条知识是否已具备 Phase 3 退出准则所需的「至少一个正例或参考」。
 *  Exit Criteria：任意核心设计规则可反查视觉案例。 */
export function hasVisualEvidence(examples: KnowledgeVisualExamples): boolean {
    return (
        examples.positive_example.length > 0 ||
        examples.reference.length > 0 ||
        examples.negative_example.length > 0 ||
        examples.counterexample.length > 0
    );
}

export { EMPTY_EXAMPLES };
