#!/usr/bin/env node
'use strict';

/**
 * Design Intelligence · 契约地基审计（Phase 0 退出准则）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md
 *  - §38 Phase 0 Exit Criteria：「contract 有 smoke / audit」「Runtime 不出现品类专属知识分支」
 *
 * 职责（真实验证，非假绿）：
 *  1. 八个共享契约文件存在且能从统一出口导出。
 *  2. 纯逻辑守卫函数行为正确（知识可用性判定 / 写回 Gate / 候选接受判定）。
 *  3. 现有知识结果 → KnowledgeNode 的映射函数可运行且产物满足契约（不空、status 合法）。
 *  4. 不允许出现品类专属知识工具/分支（searchSockKnowledge 等）——守卫「品类属于参数」原则。
 *
 * 零行为改动、纯静态 + 纯函数验证，供 maintenance:validate / CI 常态运行。
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

require('ts-node').register({
    transpileOnly: true,
    project: path.join(root, 'tsconfig.main.json')
});

const CONTRACT_FILES = [
    'knowledge.types.ts',
    'evidence.types.ts',
    'relation.types.ts',
    'task-context.types.ts',
    'candidate.types.ts',
    'learning-event.types.ts',
    'retrieval-contract.ts',
    'knowledge-writeback-contract.ts',
    'index.ts'
];

const CATEGORY_SPECIFIC_KNOWLEDGE_TOOLS = [
    /searchSock/i,
    /searchMainImage/i,
    /searchDetailPage/i,
    /searchSku/i
];

function readTs(relPath) {
    const abs = path.join(root, relPath);
    if (!fs.existsSync(abs)) {
        throw new Error(`缺失契约文件：${relPath}`);
    }
    return abs;
}

const results = [];
function record(ok, label, detail) {
    results.push({ ok, label, detail });
}

function main() {
    // 1. 契约文件存在性 + 统一出口可用
    const diDir = path.join(root, 'src', 'shared', 'design-intelligence');
    for (const file of CONTRACT_FILES) {
        const exists = fs.existsSync(path.join(diDir, file));
        record(exists, `契约文件存在：${file}`, exists ? '' : `缺失 ${path.join(diDir, file)}`);
    }

    // 2. 纯逻辑守卫（真实运行，验证行为）
    const contract = require(path.join(diDir, 'index.ts'));
    const {
        isKnowledgeUsable,
        isCandidateAccepted,
        requiresUserConfirmation,
        requiresKnowledgeGate,
        isHardOrPinnedContext
    } = contract;

    record(
        isKnowledgeUsable({ status: 'validated' }) === true
            && isKnowledgeUsable({ status: 'candidate' }) === false,
        'isKnowledgeUsable 行为',
        'validated 可用 / candidate 不可用'
    );
    record(
        isCandidateAccepted({ decision: 'accepted' }) === true
            && isCandidateAccepted({ decision: 'pending' }) === false,
        'isCandidateAccepted 行为',
        '仅 accepted 可写回'
    );
    record(
        requiresUserConfirmation('delete') === true
            && requiresUserConfirmation('add_ai_relation') === false,
        'requiresUserConfirmation 行为',
        'delete/overwrite 需用户确认'
    );
    record(
        requiresKnowledgeGate('update_knowledge') === true
            && requiresKnowledgeGate('propose_candidate') === false,
        'requiresKnowledgeGate 行为',
        '改正式知识需 Gate / 提候选不需'
    );
    record(
        isHardOrPinnedContext({ pinned: true, selectedBy: 'agent' }) === true
            && isHardOrPinnedContext({ pinned: false, selectedBy: 'agent' }) === false,
        'isHardOrPinnedContext 行为',
        'pinned 或 user 选为硬上下文'
    );

    // 3. 现有知识结果 → KnowledgeNode 映射（真实运行）
    const { mapKnowledgeResultsToNodes } = require(path.join(
        root, 'src', 'renderer', 'services', 'design-intelligence', 'adapters', 'result-mapper.ts'
    ));
    const sampleResults = [
        {
            id: 'main-image-framework:test',
            title: '主图视觉权重',
            intent: 'main_image',
            sourceType: 'manual_rule',
            summary: '主体突出、层级清晰',
            sourceNotes: [],
            tags: ['composition'],
            allowedUses: ['prompt_context'],
            sourceLevel: 'curated_rule',
            sourceRank: 1
        },
        {
            id: 'eagle:asset-123',
            title: 'Eagle 参考',
            intent: 'visual_reference',
            sourceType: 'eagle_library',
            summary: '画面构图参考',
            sourceNotes: [],
            tags: ['eagle'],
            allowedUses: ['user_reference'],
            sourceLevel: 'local_case',
            sourceRank: 2
        }
    ];
    const nodes = mapKnowledgeResultsToNodes(sampleResults);
    record(
        nodes.length === 2
            && nodes.every((node) => node.id && node.title && node.sourceRefs.length >= 1),
        'mapKnowledgeResultsToNodes 映射',
        `映射 ${nodes.length} 条，sourceRefs 齐全`
    );
    record(
        nodes[0].status === 'validated'
            && nodes[1].status === 'observation'
            && nodes[1].provider.type === 'runtime',
        '外部来源不冒充正式知识',
        `内置规则=${nodes[0].status} Eagle=${nodes[1].status}`
    );

    // 4. 品类属于参数，不属于工具身份：扫共享契约与设计智能目录，禁止品类专属知识工具
    let categoryLeak = 0;
    const scanRoot = path.join(root, 'src', 'shared', 'design-intelligence');
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const abs = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(abs); continue; }
            if (!/\.ts$/.test(entry.name)) continue;
            const text = fs.readFileSync(abs, 'utf8');
            for (const pattern of CATEGORY_SPECIFIC_KNOWLEDGE_TOOLS) {
                if (pattern.test(text)) {
                    categoryLeak += 1;
                    record(false, `发现品类专属知识分支`, `${path.relative(root, abs)} 命中 ${pattern}`);
                }
            }
        }
    };
    walk(scanRoot);
    if (categoryLeak === 0) {
        record(true, '无品类专属知识分支', 'Design Intelligence 层未新增 searchSock/searchMainImage 等品类工具');
    }

    // 5. Task Context Builder 只读 V1（DI-008）：compileTaskContextSummary 纯函数行为
    const { compileTaskContextSummary } = require(path.join(
        root, 'src', 'renderer', 'services', 'design-intelligence', 'task-context-builder.ts'
    ));
    const sampleSnapshot = {
        id: 'tc-sample',
        taskId: 'task-sample',
        hardConstraints: [],
        pinnedItems: [{ resourceId: 'ref-1', resourceType: 'reference', reason: '用户固定参考', priority: 'high', selectedBy: 'user', pinned: true }],
        retrievedKnowledge: [{ resourceId: 'dk-1', resourceType: 'knowledge', title: '主图视觉权重', excerpt: '主体突出、层级清晰', sourceLabel: '内置方法论', lifecycle: 'verified', reason: '命中当前构图任务', priority: 'normal', selectedBy: 'agent', pinned: false }],
        visualReferences: [{ resourceId: 'eagle-1', resourceType: 'visual_reference', title: '留白构图案例', excerpt: '仅元数据候选', sourceLabel: 'Eagle 素材库', lifecycle: 'candidate', reason: '构图参考', priority: 'normal', selectedBy: 'agent', pinned: false }],
        projectStateRefs: [{ resourceId: '/proj', resourceType: 'project_state', reason: '当前项目', priority: 'normal', selectedBy: 'agent', pinned: false }],
        createdAt: '2026-01-01T00:00:00.000Z',
        knowledgeIndexVersion: 'phase1-v1'
    };
    const tcSummary = compileTaskContextSummary(sampleSnapshot);
    record(
        typeof tcSummary === 'string' && tcSummary.length > 0
            && tcSummary.includes('用户固定参考') && tcSummary.includes('ref-1')
            && tcSummary.includes('主体突出、层级清晰') && tcSummary.includes('已验证'),
        'compileTaskContextSummary 摘要',
        `生成 ${tcSummary.length} 字符，含有界正文、来源与生命周期标记`
    );
    const emptySummary = compileTaskContextSummary({
        id: 'tc-empty', taskId: 't', hardConstraints: [], pinnedItems: [],
        retrievedKnowledge: [], visualReferences: [], projectStateRefs: [],
        createdAt: '2026-01-01T00:00:00.000Z', knowledgeIndexVersion: 'phase1-v1'
    });
    record(
        typeof emptySummary === 'string' && emptySummary.length > 0,
        'compileTaskContextSummary 空快照',
        '空快照仍返回可读占位摘要（不空、不抛错）'
    );
    // 6. Task Context 注入未引入品类专属分支（复用上面的 walk 已覆盖 renderer 侧不在扫描范围，
    //    这里仅确认 Builder 本身以 taskType 为参数而非品类分支）
    const builderSrc = fs.readFileSync(
        path.join(root, 'src', 'renderer', 'services', 'design-intelligence', 'task-context-builder.ts'), 'utf8'
    );
    const builderCategoryLeak = CATEGORY_SPECIFIC_KNOWLEDGE_TOOLS.filter((p) => p.test(builderSrc)).length;
    record(builderCategoryLeak === 0, 'TaskContextBuilder 无品类分支', '以 taskType/productCategory 参数检索，非品类专属路径');

    const builderFactorySrc = fs.readFileSync(
        path.join(root, 'src', 'renderer', 'services', 'design-intelligence', 'task-context-builder-factory.ts'), 'utf8'
    );
    const compositeKnowledgeSrc = fs.readFileSync(
        path.join(root, 'src', 'renderer', 'services', 'design-intelligence', 'composite-knowledge-service.ts'), 'utf8'
    );
    const knowledgeSearchServiceSrc = fs.readFileSync(
        path.join(root, 'src', 'main', 'services', 'design-knowledge-search-service.ts'), 'utf8'
    );
    record(
        builderFactorySrc.includes('AUTOMATIC_TASK_CONTEXT_SOURCE_TYPES')
            && builderFactorySrc.includes("'local_recipe'")
            && builderFactorySrc.includes("'manual_rule'")
            && builderFactorySrc.includes("'local_case'")
            && compositeKnowledgeSrc.includes('sourceTypes: this.sourceTypes')
            && knowledgeSearchServiceSrc.includes('shouldUseXiaomiWebForQuery(query)'),
        '自动 TaskContext 不隐式联网',
        '启动上下文仅请求本地治理知识；显式搜索仍可请求 mimo_web_search / web_page'
    );

    // 7. Context 使用审计（DI-010）：deriveContextAuditEvents / summarizeContextAudit 纯函数行为
    const { deriveContextAuditEvents, summarizeContextAudit } = require(path.join(
        root, 'src', 'shared', 'design-intelligence', 'context-audit.ts'
    ));
    const auditEvents = deriveContextAuditEvents(sampleSnapshot);
    record(
        auditEvents.length >= 4
            && auditEvents.some((e) => e.type === 'visual_reference_selected')
            && !auditEvents.some((e) => e.type === 'visual_reference_used')
            && auditEvents.some((e) => e.pinned === true),
        'deriveContextAuditEvents 审计事件',
        `展开 ${auditEvents.length} 条，含 visual_reference_selected 与 pinned 标记（P0-5：选入≠已使用）`
    );
    const auditSummary = summarizeContextAudit(auditEvents);
    record(
        auditSummary.total === auditEvents.length
            && auditSummary.visualReferences >= 1
            && auditSummary.pinned >= 1,
        'summarizeContextAudit 汇总',
        `total=${auditSummary.total} visual=${auditSummary.visualReferences} pinned=${auditSummary.pinned}`
    );

    // 8. Task Context 展示卡片（DI-009）：buildTaskContextCardView 领域→展示单向映射
    const { buildTaskContextCardView, buildTaskContextCard } = require(path.join(
        root, 'src', 'shared', 'design-intelligence', 'task-context-card.ts'
    ));
    const cardView = buildTaskContextCardView(sampleSnapshot);
    record(
        cardView.taskId === 'task-sample'
            && Array.isArray(cardView.pinned)
            && cardView.pinned.length === 1
            && Array.isArray(cardView.retrievedKnowledge)
            && cardView.retrievedKnowledge.length === 1
            && cardView.retrievedKnowledge[0].pinned === false,
        'buildTaskContextCardView 只读映射',
        `pinned=${cardView.pinned.length} knowledge=${cardView.retrievedKnowledge.length}`
    );
    const taskContextCard = buildTaskContextCard(sampleSnapshot);
    record(
        taskContextCard.kind === 'design-intelligence.task-context'
            && taskContextCard.version === 'interactive-card/v0'
            && taskContextCard.memoryPolicy?.enabled === false
            && !!taskContextCard.payload,
        'buildTaskContextCard 卡片契约',
        `kind=${taskContextCard.kind} version=${taskContextCard.version} 只读无记忆策略`
    );

    // 9. Obsidian 解析 + frontmatter（Phase 2）：parseObsidianNote / parseObsidianFrontmatter
    const obsidian = require(path.join(
        root, 'src', 'shared', 'design-intelligence', 'obsidian', 'obsidian-vault-adapter.ts'
    ));
    const note = obsidian.parseObsidianNote(
        '---\nid: dk_01\ntype: design_rule\nstatus: validated\nconfidence: 0.91\n' +
        'domains:\n  - ecommerce\n  - composition\ntasks:\n  - main_image\nversion: 3\n---\n\n主体占画布视觉权重。',
        'design-rules/main-image.md'
    );
    record(
        note.frontmatter.includes('id: dk_01') && note.body.includes('视觉权重'),
        'parseObsidianNote 拆分',
        `frontmatter 含 id，正文 = ${note.body.length} 字符`
    );
    const fm = obsidian.parseObsidianFrontmatter(note.frontmatter);
    record(
        fm.id === 'dk_01'
            && fm.type === 'design_rule'
            && fm.status === 'validated'
            && fm.confidence === 0.91
            && Array.isArray(fm.domains) && fm.domains.length === 2
            && fm.version === 3,
        'parseObsidianFrontmatter 解析',
        `id=${fm.id} type=${fm.type} domains=${fm.domains.length} version=${fm.version}`
    );

    // 10. contentHash + 冲突检测（Phase 2 · §25.1）
    const noteA = { path: 'a.md', frontmatter: 'id: x', body: '正文' };
    const noteB = { path: 'a.md', frontmatter: 'id: x', body: '正文' };
    const noteC = { path: 'a.md', frontmatter: 'id: x', body: '改过' };
    const hashA = obsidian.contentHash(noteA);
    record(
        hashA === obsidian.contentHash(noteB) && hashA !== obsidian.contentHash(noteC) && hashA.length > 0,
        'contentHash 稳定',
        `同内容同 hash，改内容 hash 变化`
    );
    const conflict = obsidian.checkObsidianWriteConflict({
        expectedHash: hashA, diskHash: obsidian.contentHash(noteC), diskExists: true
    });
    const noConflict = obsidian.checkObsidianWriteConflict({
        expectedHash: hashA, diskHash: hashA, diskExists: true
    });
    record(
        conflict.conflict === true && conflict.reason === 'changed_externally'
            && noConflict.conflict === false,
        'checkObsidianWriteConflict 冲突检测',
        '磁盘 hash 不同 → 冲突；相同 → 可安全写'
    );

    // 11. Candidate Review Gate（Phase 2）：Candidate 无法绕过 Gate 变 Validated
    const cr = require(path.join(root, 'src', 'shared', 'design-intelligence', 'candidate-review.ts'));
    const candidate = {
        id: 'cand-1', proposedKind: 'design_rule', proposedTitle: 't', proposedContent: 'c',
        evidenceRefs: [], generatedFrom: 'task_feedback', confidence: 0.8,
        decision: 'pending'
    };
    const agentSelfAccept = cr.reviewCandidate({
        candidate, decision: 'accepted', reviewer: 'agent', writeAction: 'upgrade_status'
    });
    record(
        agentSelfAccept.ok === false && agentSelfAccept.code === 'agent_cannot_self_accept',
        'Candidate 禁止 Agent 自行升级',
        'Agent 接受候选 → 被 Gate 拦下'
    );
    const validReceipt = {
        actor: 'user', sourceMessageId: 'msg-1', issuedAt: new Date().toISOString(),
        propositionRevision: 1, token: 'one-time-token-1'
    };
    const userAcceptNoReceipt = cr.reviewCandidate({
        candidate, decision: 'accepted', reviewer: 'user', writeAction: 'upgrade_status'
    });
    const userAcceptWithReceipt = cr.reviewCandidate({
        candidate, decision: 'accepted', reviewer: 'user', writeAction: 'upgrade_status', confirmationReceipt: validReceipt
    });
    const unGatedAccept = cr.reviewCandidate({
        candidate, decision: 'accepted', reviewer: 'user', writeAction: 'propose_candidate', confirmationReceipt: validReceipt
    });
    record(
        userAcceptNoReceipt.ok === false && userAcceptNoReceipt.code === 'user_accept_requires_receipt'
            && userAcceptWithReceipt.ok === true && userAcceptWithReceipt.decision === 'accepted'
            && unGatedAccept.ok === false && unGatedAccept.code === 'accepted_requires_gated_write',
        'Candidate 接受需用户确认收据 + Knowledge Write Gate',
        'P0-4：无收据 → 拒；有收据 + gated → 放行；有收据但无 gated → 拦下'
    );

    // 12. Visual-Semantic Linking（Phase 3）：双向反查 + 角色分组
    const vl = require(path.join(root, 'src', 'shared', 'design-intelligence', 'visual-linking.ts'));
    const rel1 = vl.buildVisualLink({ knowledgeId: 'dk-rule-1', assetId: 'eagle-0821', role: 'positive_example', confidence: 0.9, createdBy: 'user' });
    const rel2 = vl.buildVisualLink({ knowledgeId: 'dk-rule-1', assetId: 'eagle-0330', role: 'counterexample', createdBy: 'agent' });
    const rel3 = vl.buildVisualLink({ knowledgeId: 'dk-rule-2', assetId: 'eagle-0821', role: 'reference', createdBy: 'system' });
    record(
        rel1.type === 'example_of' && rel1.fromId === 'dk-rule-1' && rel1.toId === 'eagle-0821'
            && vl.isVisualLink(rel1) === true,
        'buildVisualLink 关系构造',
        `type=${rel1.type} role 映射正确`
    );
    const kExamples = vl.expandKnowledgeToVisualExamples([rel1, rel2, rel3], 'dk-rule-1');
    record(
        kExamples.positive_example.length === 1 && kExamples.positive_example[0] === 'eagle-0821'
            && kExamples.counterexample.length === 1 && kExamples.counterexample[0] === 'eagle-0330',
        '知识→视觉反查',
        `正例=${kExamples.positive_example.length} 反例=${kExamples.counterexample.length}`
    );
    const assetLinks = vl.expandVisualAssetToKnowledge([rel1, rel2, rel3], 'eagle-0821');
    record(
        assetLinks.length === 2
            && assetLinks.some((l) => l.knowledgeId === 'dk-rule-1' && l.role === 'positive_example')
            && assetLinks.some((l) => l.knowledgeId === 'dk-rule-2' && l.role === 'reference'),
        '视觉→知识反查',
        `资产关联 ${assetLinks.length} 条知识，含正例与参考`
    );
    record(
        vl.hasVisualEvidence(kExamples) === true,
        'hasVisualEvidence 退出准则信号',
        '规则已具备可反查的视觉案例'
    );

    // 13. Knowledge Health + Stale Review（Phase 4）
    const kh = require(path.join(root, 'src', 'shared', 'design-intelligence', 'knowledge-health.ts'));
    const healthNodes = [
        { id: 'k1', kind: 'rule', title: '视觉权重', status: 'validated', applicableTaskTypes: ['main_image'], domains: ['composition'], tags: [], sourceRefs: [], relatedIds: [], freshness: { mode: 'volatile', lastVerifiedAt: undefined, reviewAfter: '2025-01-01T00:00:00.000Z' }, provider: { type: 'builtin', locator: 'x' }, version: 1, contentHash: 'a' },
        { id: 'k2', kind: 'principle', title: '对比原则', status: 'core', applicableTaskTypes: ['main_image'], domains: ['composition'], tags: [], sourceRefs: [], relatedIds: [], freshness: { mode: 'stable', lastVerifiedAt: '2026-07-01T00:00:00.000Z', reviewAfter: undefined }, provider: { type: 'builtin', locator: 'y' }, version: 1, contentHash: 'b' },
        { id: 'k3', kind: 'rule', title: '过期候选', status: 'candidate', applicableTaskTypes: [], domains: [], tags: [], sourceRefs: [], relatedIds: [], freshness: { mode: 'medium', lastVerifiedAt: undefined, reviewAfter: '2024-06-01T00:00:00.000Z' }, provider: { type: 'obsidian', locator: 'z' }, version: 1, contentHash: 'c' }
    ];
    const health = kh.computeKnowledgeHealth(healthNodes, '2026-08-07T00:00:00.000Z');
    record(
        health.total === 3 && health.usable === 2 && health.byStatus.candidate === 1
            && health.stale.some((s) => s.node.id === 'k1' && s.reason === 'overdue_review')
            && health.hasMaintenanceActions === true,
        'computeKnowledgeHealth 健康度',
        `total=${health.total} usable=${health.usable} stale=${health.stale.length}`
    );
    record(
        kh.defaultReviewAfterDays('stable') === null
            && kh.defaultReviewAfterDays('volatile') === 30,
        'defaultReviewAfterDays 复审间隔',
        'stable 不排期 / volatile 30 天'
    );

    // 14. Duplicate Detection（Phase 4）
    const dd = require(path.join(root, 'src', 'shared', 'design-intelligence', 'duplicate-detection.ts'));
    const dupNodes = [
        { id: 'd1', kind: 'rule', title: '主体视觉权重 主图', status: 'validated', applicableTaskTypes: ['main_image'], domains: ['composition'], tags: [], sourceRefs: [], relatedIds: [], freshness: { mode: 'stable' }, provider: { type: 'builtin', locator: 'a' }, version: 1, contentHash: 'x', scope: '主图主体应突出占视觉权重' },
        { id: 'd2', kind: 'rule', title: '主图主体视觉权重', status: 'validated', applicableTaskTypes: ['main_image'], domains: ['composition'], tags: [], sourceRefs: [], relatedIds: [], freshness: { mode: 'stable' }, provider: { type: 'builtin', locator: 'b' }, version: 1, contentHash: 'y', scope: '主图主体应突出' },
        { id: 'd3', kind: 'method', title: 'SKU 导出命名', status: 'validated', applicableTaskTypes: ['sku'], domains: ['production'], tags: [], sourceRefs: [], relatedIds: [], freshness: { mode: 'medium' }, provider: { type: 'builtin', locator: 'c' }, version: 1, contentHash: 'z' }
    ];
    const dups = dd.detectDuplicates(dupNodes, 0.5);
    record(
        dups.some((c) => (c.aId === 'd1' && c.bId === 'd2') || (c.aId === 'd2' && c.bId === 'd1'))
            && !dups.some((c) => c.aId === 'd3'),
        'detectDuplicates 重复检测',
        `发现 ${dups.length} 组疑似重复`
    );

    // 15. Conflict Detection（Phase 4）
    const cd = require(path.join(root, 'src', 'shared', 'design-intelligence', 'conflict-detection.ts'));
    const conflictNodes = [
        { id: 'c1', kind: 'rule', title: '主图主体必须大', status: 'core', applicableTaskTypes: ['main_image'], domains: ['composition'], tags: [], sourceRefs: [], relatedIds: [], freshness: { mode: 'stable' }, provider: { type: 'builtin', locator: 'a' }, version: 1, contentHash: 'a', scope: '主体必须占满画布' },
        { id: 'c2', kind: 'rule', title: '主图留白原则', status: 'core', applicableTaskTypes: ['main_image'], domains: ['composition'], tags: [], sourceRefs: [], relatedIds: [], freshness: { mode: 'stable' }, provider: { type: 'builtin', locator: 'b' }, version: 1, contentHash: 'b', scope: '主体避免占满画布，需留白' }
    ];
    const inferred = cd.detectInferredConflicts(conflictNodes);
    const explicitRel = [{ id: 'r', fromId: 'c1', toId: 'c2', type: 'contradicts', createdBy: 'agent' }];
    const allConflicts = cd.detectAllConflicts(conflictNodes, explicitRel);
    record(
        allConflicts.some((c) => c.basis === 'explicit_relation')
            && allConflicts.length >= 1,
        'detectAllConflicts 冲突检测',
        `共 ${allConflicts.length} 条冲突候选`
    );

    // 16. Candidate Merge（Phase 4）
    const cm = require(path.join(root, 'src', 'shared', 'design-intelligence', 'candidate-merge.ts'));
    const mergeTarget = {
        id: 'm1', kind: 'rule', title: '主图视觉权重', status: 'validated', applicableTaskTypes: ['main_image'], domains: ['composition'], tags: [], sourceRefs: [], relatedIds: [], freshness: { mode: 'stable' }, provider: { type: 'obsidian', locator: 'p' }, version: 2, contentHash: 'h', scope: '主体应突出'
    };
    const mergeCandidate = {
        id: 'cand-m', proposedKind: 'rule', proposedTitle: '主图主体应占视觉权重', proposedContent: '主体应占画布视觉权重约 60%', evidenceRefs: [], generatedFrom: 'task_feedback', confidence: 0.8, decision: 'accepted'
    };
    const mergePlan = cm.planCandidateMerge(mergeTarget, mergeCandidate);
    record(
        mergePlan.targetKnowledgeId === 'm1'
            && mergePlan.nextVersion === 3
            && mergePlan.mergedContent.includes('60%'),
        'planCandidateMerge 合并草稿',
        `nextVersion=${mergePlan.nextVersion}，产出可审查合并草稿`
    );

    // 17. Repeated Pattern → Candidate（Phase 5）
    const rp = require(path.join(root, 'src', 'shared', 'design-intelligence', 'repeated-pattern.ts'));
    const now = '2026-08-07T00:00:00.000Z';
    const feedbackEvents = [];
    for (let i = 0; i < 6; i++) {
        feedbackEvents.push({
            id: `ev-${i}`, taskId: `task-${i}`, source: 'user_feedback',
            description: '用户要求统一 SKU 卡片字号', accepted: true, evidenceRefs: [], createdAt: now, status: 'captured'
        });
    }
    feedbackEvents.push({ id: 'ev-6', taskId: 'task-6', source: 'user_feedback', description: '用户要求调整配色', accepted: true, evidenceRefs: [], createdAt: now, status: 'captured' });
    const patterns = rp.detectRepeatedPatterns(feedbackEvents, { minCount: 3, minRatio: 0.4 });
    record(
        patterns.length >= 1
            && patterns[0].proposedCandidate.generatedFrom === 'task_feedback'
            && patterns[0].proposedCandidate.decision === 'pending',
        'detectRepeatedPatterns 重复模式',
        `6/7 相同修改 → 生成 ${patterns.length} 条 pending 候选`
    );

    // 18. Proposition Ledger（Phase 6）：外部信号不直接成知识，须用户确认
    const pl = require(path.join(root, 'src', 'shared', 'design-intelligence', 'proposition-ledger.ts'));
    const sig = { id: 'sig-1', kind: 'web', title: 'AI 模型能力趋势', summary: '模型能力快速演进', domains: ['ai'], applicableTaskTypes: [], capturedAt: now };
    const prop = pl.createPropositionFromSignals('prop-1', 'AI 模型能力一年内大幅提升', [sig], now);
    const unsupportedCandidate = pl.buildCandidateFromConfirmedProposition(prop);
    record(
        prop.state === 'unsupported'
            && unsupportedCandidate === null,
        '外部信号不直接成为知识',
        'unsupported 命题不能生成候选'
    );
    const supported = pl.advanceProposition(prop, 'found_evidence', now);
    let threwNoReceipt = false;
    try {
        pl.advanceProposition(supported, 'confirm', now);
    } catch (e) {
        threwNoReceipt = String(e && e.message).includes('proposition_confirm_requires_user_receipt');
    }
    const confirmReceipt = {
        actor: 'user', sourceMessageId: 'msg-confirm-1', issuedAt: now,
        propositionRevision: 1, token: 'one-time-token-1'
    };
    const confirmed = pl.advanceProposition(supported, 'confirm', now, confirmReceipt);
    const confirmedCandidate = pl.buildCandidateFromConfirmedProposition(confirmed);
    record(
        threwNoReceipt
            && confirmed.state === 'user_confirmed'
            && confirmedCandidate !== null
            && confirmedCandidate.decision === 'pending',
        '用户确认（需收据）后生成候选',
        'P0-4：无收据 confirm 被拒；带收据 confirm → user_confirmed → pending 候选，仍需 Review Gate'
    );

    // 输出
    let failed = false;
    console.log('Design Intelligence 契约地基审计：');
    for (const row of results) {
        console.log(`  [${row.ok ? 'PASS' : 'FAIL'}] ${row.label}${row.detail ? ` — ${row.detail}` : ''}`);
        if (!row.ok) failed = true;
    }

    if (failed) {
        console.error('\n[FAIL] Design Intelligence 契约地基审计未通过。');
        process.exitCode = 1;
    } else {
        console.log(`\n[OK] 契约地基审计通过（${results.length} 项）。`);
    }
}

main();
