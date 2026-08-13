#!/usr/bin/env node
/**
 * Design Intelligence · 持久化 Store 独立 IO 测试（Phase 3-5）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md
 *   §8 / §12 / §17 / §24.2 / §31 / Phase 3-6
 *
 * 职责：用真实文件 IO（临时目录）验证 Store 实现本身：
 *   - IntelligenceDb：JSON 原子写 + 独占事务
 *   - RelationStore：Phase 3 关系持久化 + 双向反查
 *   - KnowledgeIndexStore：Phase 4 知识索引持久化
 *   - LearningEventStore：Phase 5 事件持久化 + 重复模式检测
 *
 * 运行方式：npm run test:intelligence-stores
 * 说明：无测试框架，自包含断言；require 的是 src 下真实实现，非复制逻辑。
 * 本脚本不启动 Electron、不经过 IPC，也不证明这些 Store 已被产品运行时实例化或消费。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const { IntelligenceDb } = require(path.resolve(
    __dirname, '..', 'src', 'main', 'services', 'design-intelligence', 'intelligence-db.ts'
));
const { RelationStore } = require(path.resolve(
    __dirname, '..', 'src', 'main', 'services', 'design-intelligence', 'relation-store.ts'
));
const { KnowledgeIndexStore } = require(path.resolve(
    __dirname, '..', 'src', 'main', 'services', 'design-intelligence', 'knowledge-index-store.ts'
));
const { LearningEventStore } = require(path.resolve(
    __dirname, '..', 'src', 'main', 'services', 'design-intelligence', 'learning-event-store.ts'
));

const results = [];
function record(ok, label, detail) {
    results.push({ ok, label, detail });
}

async function main() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'di-stores-'));
    const dbFile = path.join(tmpDir, 'intelligence-runtime.json');

    try {
        // 1. IntelligenceDb：事务写 → 落盘 → 重新打开可读（真实 IO）
        const db = new IntelligenceDb({ filePath: dbFile });
        await db.transaction(async (tx) => {
            tx.setCollection('probe', [{ id: 'a' }, { id: 'b' }]);
        });
        const onDisk = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
        record(
            onDisk.schemaVersion === 1
                && Array.isArray(onDisk.collections?.probe) && onDisk.collections.probe.length === 2,
            'IntelligenceDb 原子写落盘',
            `schemaVersion=${onDisk.schemaVersion}，probe 集合 ${onDisk.collections?.probe?.length} 条已持久化到 ${path.basename(dbFile)}`
        );
        const reopened = new IntelligenceDb({ filePath: dbFile });
        const probe = await reopened.readCollections();
        record(
            Array.isArray(probe.probe) && probe.probe.length === 2,
            'IntelligenceDb 重开可读',
            '重新实例化后仍能读到已落盘集合'
        );

        // 1b. P0-3：数据文件损坏 → 隔离到 quarantine + 进入 corrupt 拒绝写（不静默清空覆盖）
        // 用独立文件，避免污染上方共享 dbFile 供后续 Store 继续使用。
        const corruptFile = path.join(tmpDir, 'corrupt-runtime.json');
        await fs.promises.writeFile(corruptFile, '{"schemaVersion":1,"collections":{}}', 'utf8');
        const corruptDb = new IntelligenceDb({ filePath: corruptFile });
        await fs.promises.writeFile(corruptFile, '{ not valid json', 'utf8');
        let corruptReadThrew = false;
        try {
            await corruptDb.readCollections();
        } catch (e) {
            corruptReadThrew = String(e && e.name).includes('IntelligenceDbCorruptError');
        }
        let corruptWriteBlocked = false;
        try {
            await corruptDb.transaction(async (tx) => { tx.setCollection('x', [{ id: '1' }]); });
        } catch (e) {
            corruptWriteBlocked = String(e && e.name).includes('IntelligenceDbCorruptError');
        }
        const quarantined = fs.readdirSync(tmpDir).filter((f) => /^corrupt-runtime\.json\.corrupt-\d+$/.test(f));
        record(
            corruptReadThrew && corruptWriteBlocked && quarantined.length >= 1,
            'IntelligenceDb 损坏防护（P0-3）',
            `损坏读抛错=${corruptReadThrew} 写被禁=${corruptWriteBlocked} 隔离文件=${quarantined.join(',')}`
        );

        // 2. RelationStore：Phase 3 关系持久化 + 双向反查
        const relations = new RelationStore(db);
        await relations.addVisualLink({ knowledgeId: 'dk-rule-1', assetId: 'eagle-0821', role: 'positive_example', confidence: 0.9, createdBy: 'user' });
        await relations.addVisualLink({ knowledgeId: 'dk-rule-1', assetId: 'eagle-0330', role: 'counterexample', createdBy: 'agent' });
        await relations.addVisualLink({ knowledgeId: 'dk-rule-2', assetId: 'eagle-0821', role: 'reference', createdBy: 'system' });

        const storedRelations = await relations.listRelations();
        record(
            storedRelations.length === 3,
            'RelationStore 关系持久化',
            `已持久化 ${storedRelations.length} 条关系`
        );
        const kExamples = await relations.knowledgeToVisualExamples('dk-rule-1');
        record(
            kExamples.positive_example.includes('eagle-0821')
                && kExamples.counterexample.includes('eagle-0330'),
            'RelationStore 知识→视觉反查',
            `正例=${kExamples.positive_example.join(',')} 反例=${kExamples.counterexample.join(',')}`
        );
        const assetLinks = await relations.visualAssetToKnowledge('eagle-0821');
        record(
            assetLinks.length === 2
                && assetLinks.some((l) => l.knowledgeId === 'dk-rule-1' && l.role === 'positive_example'),
            'RelationStore 视觉→知识反查',
            `资产关联 ${assetLinks.length} 条知识`
        );

        // 3. KnowledgeIndexStore：Phase 4 知识索引持久化
        const knowledge = new KnowledgeIndexStore(db);
        const now = '2026-08-07T00:00:00.000Z';
        await knowledge.upsert({
            id: 'k1', kind: 'rule', title: '主图主体视觉权重', status: 'validated', applicableTaskTypes: ['main_image'],
            domains: ['composition'], tags: [], sourceRefs: [], relatedIds: [],
            freshness: { mode: 'stable', lastVerifiedAt: now, reviewAfter: undefined },
            provider: { type: 'builtin', locator: 'x' }, version: 1, contentHash: 'a'
        });
        await knowledge.upsert({
            id: 'k2', kind: 'rule', title: '主图主体视觉权重', status: 'core', applicableTaskTypes: ['main_image'],
            domains: ['composition'], tags: [], sourceRefs: [], relatedIds: [],
            freshness: { mode: 'stable', lastVerifiedAt: now, reviewAfter: undefined },
            provider: { type: 'builtin', locator: 'y' }, version: 1, contentHash: 'b'
        });
        const listed = await knowledge.list();
        record(
            listed.length === 2 && listed.some((n) => n.id === 'k1'),
            'KnowledgeIndexStore 知识索引持久化',
            `索引 ${listed.length} 条`
        );

        // 4. LearningEventStore：Phase 5 事件持久化 + 重复模式检测
        const learning = new LearningEventStore(db);
        for (let i = 0; i < 6; i++) {
            await learning.add({
                id: `ev-${i}`, taskId: `task-${i}`, source: 'user_feedback',
                description: '用户要求统一 SKU 卡片字号', accepted: true, evidenceRefs: [],
                createdAt: now, status: 'captured'
            });
        }
        const patterns = await learning.detectPatterns({ minCount: 3, minRatio: 0.4 });
        record(
            patterns.length >= 1
                && patterns[0].proposedCandidate.decision === 'pending',
            'LearningEventStore 重复模式检测',
            `持久化事件检测出 ${patterns.length} 条 pending 候选`
        );
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    // 输出
    let failed = false;
    console.log('Design Intelligence · 持久化 Store 独立 IO 测试（不代表产品运行时已接线）：');
    for (const row of results) {
        console.log(`  [${row.ok ? 'PASS' : 'FAIL'}] ${row.label}${row.detail ? ` — ${row.detail}` : ''}`);
        if (!row.ok) failed = true;
    }
    if (failed) {
        console.error('\n[FAIL] 持久化 Store 独立 IO 测试未通过。');
        process.exitCode = 1;
    } else {
        console.log(`\n[OK] 持久化 Store 独立 IO 测试通过（${results.length} 项）。`);
    }
}

main().catch((err) => {
    console.error('持久化 Store 独立 IO 测试崩溃：', err);
    process.exitCode = 1;
});
