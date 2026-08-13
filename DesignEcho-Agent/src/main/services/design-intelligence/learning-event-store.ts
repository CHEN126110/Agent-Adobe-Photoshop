/**
 * Design Intelligence · LearningEventStore（Phase 5 运行时持久化）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md
 *   §17 Post-Task Learning / §24.2 learning_events / Phase 5
 *
 * 职责：持久化 LearningEvent，供 repeated-pattern 纯逻辑在其上做重复模式检测
 *       （「最近 N 个任务出现 M 次相同修改」→ 生成 pending 候选）。
 *
 * 边界：
 * - 只存事件，不写正式知识；候选生成后仍是 pending，须经 Review Gate。
 * - 本 Store 持久化到 IntelligenceDb 的 'learning_events' 集合。
 */

import { IntelligenceDb } from './intelligence-db';
import type { LearningEvent } from '../../../shared/design-intelligence/learning-event.types';
import {
    detectRepeatedPatterns,
    type RepeatedPatternOptions,
    type RepeatedPattern
} from '../../../shared/design-intelligence/repeated-pattern';

const EVENTS_COLLECTION = 'learning_events';

export class LearningEventStore {
    private readonly db: IntelligenceDb;

    constructor(db: IntelligenceDb) {
        this.db = db;
    }

    /** 记录一条学习事件（同 id 覆盖）。 */
    async add(event: LearningEvent): Promise<void> {
        await this.db.transaction(async (tx) => {
            const events = tx.getCollection<LearningEvent>(EVENTS_COLLECTION);
            const rest = events.filter((e) => e.id !== event.id);
            tx.setCollection<LearningEvent>(EVENTS_COLLECTION, [...rest, { ...event }]);
        });
    }

    /** 列出全部学习事件。 */
    async list(): Promise<LearningEvent[]> {
        const collections = await this.db.readCollections();
        return (collections[EVENTS_COLLECTION] as LearningEvent[] | undefined) ?? [];
    }

    /** 在持久化事件上运行重复模式检测（Phase 5）。 */
    async detectPatterns(options: RepeatedPatternOptions = {}): Promise<RepeatedPattern[]> {
        const events = await this.list();
        return detectRepeatedPatterns(events, options);
    }
}
