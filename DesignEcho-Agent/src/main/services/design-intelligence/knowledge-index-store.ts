/**
 * Design Intelligence · KnowledgeIndexStore（Phase 4 运行时持久化）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md
 *   §12 Knowledge Steward / §14 Knowledge Health / §24.2 knowledge_registry / Phase 4
 *
 * 职责：把知识注册表（KnowledgeNode 索引）持久化，供 Knowledge Steward 在其上运行
 *       健康度 / 重复 / 冲突检测（纯逻辑消费真实持久化数据）。
 *
 * 边界：
 * - 本 Store 是知识「索引/注册表」的持久化，不是 Obsidian 源文件的真相源；
 *   源文件真相源仍在 Obsidian Vault（Human Authoring Source）。
 * - 不在此处直接做升级/合并/删除正式知识——那类写仍过 Knowledge Write Gate。
 */

import { IntelligenceDb } from './intelligence-db';
import type { KnowledgeNode } from '../../../shared/design-intelligence/knowledge.types';

const KNOWLEDGE_COLLECTION = 'knowledge_index';

export class KnowledgeIndexStore {
    private readonly db: IntelligenceDb;

    constructor(db: IntelligenceDb) {
        this.db = db;
    }

    /** 全量替换知识索引（供从 Obsidian/内置源重建）。 */
    async replaceAll(nodes: KnowledgeNode[]): Promise<void> {
        await this.db.transaction(async (tx) => {
            tx.setCollection<KnowledgeNode>(KNOWLEDGE_COLLECTION, nodes.map((n) => ({ ...n })));
        });
    }

    /** 按 id 覆盖或新增一条。 */
    async upsert(node: KnowledgeNode): Promise<void> {
        await this.db.transaction(async (tx) => {
            const nodes = tx.getCollection<KnowledgeNode>(KNOWLEDGE_COLLECTION);
            const rest = nodes.filter((n) => n.id !== node.id);
            tx.setCollection<KnowledgeNode>(KNOWLEDGE_COLLECTION, [...rest, { ...node }]);
        });
    }

    /** 列出全部知识索引。 */
    async list(): Promise<KnowledgeNode[]> {
        const collections = await this.db.readCollections();
        return (collections[KNOWLEDGE_COLLECTION] as KnowledgeNode[] | undefined) ?? [];
    }
}
