/**
 * Design Intelligence · RelationStore（Phase 3 运行时持久化）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md
 *   §8 Relation Graph / §16 Visual Evidence / §24.2 knowledge_relations / Phase 3
 *
 * 职责：把「知识 ↔ 视觉案例」关系（ResourceRelation）持久化，并基于 IntelligenceDb
 *       事务 + visual-linking 纯逻辑提供双向反查：
 *       - 知识 → 视觉案例（正例/反例/参考/反例）
 *       - 视觉案例 → 关联知识
 *
 * 边界：
 * - 写关系属 Safe Write（add_ai_relation），仍需过 Writeback Gate 语义约束；
 *   本 Store 只做持久化，不裁决权限。
 * - 关系数据落在 IntelligenceDb 的 'relations' 集合。
 */

import { IntelligenceDb } from './intelligence-db';
import type { ResourceRelation } from '../../../shared/design-intelligence/relation.types';
import {
    buildVisualLink,
    expandKnowledgeToVisualExamples,
    expandVisualAssetToKnowledge,
    type VisualLinkInput,
    type KnowledgeVisualExamples,
    type VisualAssetKnowledgeLink
} from '../../../shared/design-intelligence/visual-linking';

const RELATIONS_COLLECTION = 'relations';

export class RelationStore {
    private readonly db: IntelligenceDb;

    constructor(db: IntelligenceDb) {
        this.db = db;
    }

    /** 新增一条视觉链接关系（幂等：同 id 覆盖）。 */
    async addVisualLink(input: VisualLinkInput): Promise<ResourceRelation> {
        const relation = buildVisualLink(input);
        await this.db.transaction(async (tx) => {
            const relations = tx.getCollection<ResourceRelation>(RELATIONS_COLLECTION);
            const rest = relations.filter((r) => r.id !== relation.id);
            tx.setCollection(RELATIONS_COLLECTION, [...rest, relation]);
        });
        return relation;
    }

    /** 删除一条关系。 */
    async removeRelation(relationId: string): Promise<void> {
        await this.db.transaction(async (tx) => {
            const relations = tx.getCollection<ResourceRelation>(RELATIONS_COLLECTION);
            tx.setCollection(RELATIONS_COLLECTION, relations.filter((r) => r.id !== relationId));
        });
    }

    /** 列出全部关系。 */
    async listRelations(): Promise<ResourceRelation[]> {
        return this.db.readCollections().then((c) => c[RELATIONS_COLLECTION] as ResourceRelation[] ?? []);
    }

    /** 知识 → 视觉案例 反查（Phase 3 Exit Criteria 之一）。 */
    async knowledgeToVisualExamples(knowledgeId: string): Promise<KnowledgeVisualExamples> {
        const relations = await this.listRelations();
        return expandKnowledgeToVisualExamples(relations, knowledgeId);
    }

    /** 视觉案例 → 知识 反查（Phase 3 Exit Criteria 之二）。 */
    async visualAssetToKnowledge(assetId: string): Promise<VisualAssetKnowledgeLink[]> {
        const relations = await this.listRelations();
        return expandVisualAssetToKnowledge(relations, assetId);
    }
}
