#!/usr/bin/env node
/**
 * Design Intelligence · 命题状态机单元测试（Phase 6）
 *
 * 路线图依据：docs/design-intelligence-knowledge-system-roadmap-draft.md
 *   §18 Brainstorm / Knowledge Gap / Phase 6 External Signals & Brainstorm
 *
 * 职责：验证 Proposition Ledger 状态机（proposition-ledger.ts）从 unsupported 到
 *       user_confirmed 的流转是否正确，以及「外部信号不直接成为知识」的红线是否守得住。
 *
 * 运行方式：npm run test:proposition-ledger
 * 说明：无测试框架，自包含断言；require 的是 src/shared 下真实契约源，而非复制逻辑。
 */

const path = require('path');

require('ts-node').register({
    transpileOnly: true,
    project: path.resolve(__dirname, '..', 'tsconfig.main.json')
});

const { createPropositionFromSignals, advanceProposition, isConfirmable, canBuildCandidateFromProposition, buildCandidateFromConfirmedProposition, isWellFormedUserConfirmationReceipt } = require(
    path.resolve(__dirname, '..', 'src', 'shared', 'design-intelligence', 'proposition-ledger.ts')
);

const results = [];
function record(ok, label, detail) {
    results.push({ ok, label, detail });
}

const now = '2026-08-07T00:00:00.000Z';

// 主进程签发的「用户确认收据」（P0-4）：confirm 必须携带，否则被拒。
function receipt() {
    return {
        actor: 'user', sourceMessageId: 'msg-accept-1', issuedAt: now,
        propositionRevision: 1, token: 'one-time-token-1'
    };
}

function main() {
    const signal = {
        id: 'sig-1', kind: 'web', title: 'AI 模型能力趋势', summary: '模型能力快速演进',
        domains: ['ai'], applicableTaskTypes: [], capturedAt: now
    };

    // 1. 初始状态：由外部信号建命题 → unsupported，且不可直接生成候选
    const p0 = createPropositionFromSignals('prop-1', 'AI 模型能力一年内大幅提升', [signal], now);
    record(
        p0.state === 'unsupported'
            && p0.signalRefs.length === 1
            && p0.evidenceRefs.length === 0,
        '创建命题初始为 unsupported（信号只登记为 signalRefs，未提前包装成证据）',
        `state=${p0.state} signals=${p0.signalRefs.length} evidence=${p0.evidenceRefs.length}`
    );
    record(
        isConfirmable(p0.state) === false
            && canBuildCandidateFromProposition(p0) === false
            && buildCandidateFromConfirmedProposition(p0) === null,
        'unsupported 不可确认、不可成候选（外部信号不直接成知识）',
        'confirmable=false candidate=null'
    );

    // 2. P0-4：无用户确认收据的 confirm 一律拒绝（不能被任意调用者伪造 user_confirmed）
    let threw = false;
    try {
        advanceProposition(p0, 'confirm', now);
    } catch (e) {
        threw = String(e && e.message).includes('proposition_confirm_requires_user_receipt');
    }
    record(threw === true, '无收据 confirm 被拒（P0-4 防伪造）', 'advanceProposition(confirm, 无收据) 抛错');
    record(
        isWellFormedUserConfirmationReceipt(receipt()) === true
            && isWellFormedUserConfirmationReceipt({ actor: 'agent' }) === false,
        '收据形状校验：完整收据通过、缺 actor 拒绝',
        'wellformed=true'
    );

    // 3. 主路径：unsupported →(found_evidence)→ supported →(confirm)→ user_confirmed
    const p1 = advanceProposition(p0, 'found_evidence', now);
    record(p1.state === 'supported', 'found_evidence → supported', `state=${p1.state}`);
    record(
        isConfirmable(p1.state) === true
            && canBuildCandidateFromProposition(p1) === false
            && buildCandidateFromConfirmedProposition(p1) === null,
        'supported 可确认，但仍未确认 → 不产出候选',
        'confirmable=true candidate=null'
    );
    const p2 = advanceProposition(p1, 'confirm', now, receipt());
    record(
        p2.state === 'user_confirmed'
            && isConfirmable(p2.state) === false
            && canBuildCandidateFromProposition(p2) === true,
        'supported + confirm(带收据) → user_confirmed（终止态不可再确认，可产候选）',
        `state=${p2.state}`
    );
    const cand1 = buildCandidateFromConfirmedProposition(p2);
    record(
        cand1 !== null
            && cand1.decision === 'pending'
            && cand1.generatedFrom === 'external_source'
            && cand1.proposedKind === 'research',
        'user_confirmed 生成 pending 候选（仍需 Review Gate，Agent 无权自升级）',
        `decision=${cand1 && cand1.decision} origin=${cand1 && cand1.generatedFrom}`
    );

    // 4. 分支路径：unsupported →(found_gaps)→ supported_with_gaps →(confirm)→ user_confirmed
    const p3 = advanceProposition(p0, 'found_gaps', now);
    record(
        p3.state === 'supported_with_gaps'
            && isConfirmable(p3.state) === true,
        'found_gaps → supported_with_gaps，可确认',
        `state=${p3.state}`
    );
    const p4 = advanceProposition(p3, 'confirm', now, receipt());
    record(p4.state === 'user_confirmed', 'supported_with_gaps + confirm → user_confirmed', `state=${p4.state}`);

    // 5. 修订路径：unsupported →(found_evidence)→ supported →(revise)→ revised →(confirm)→ user_confirmed
    const p5 = advanceProposition(advanceProposition(p0, 'found_evidence', now), 'revise', now);
    record(
        p5.state === 'revised' && isConfirmable(p5.state) === true,
        'revise → revised，可确认',
        `state=${p5.state}`
    );
    const p6 = advanceProposition(p5, 'confirm', now, receipt());
    record(p6.state === 'user_confirmed', 'revised + confirm → user_confirmed', `state=${p6.state}`);

    // 6. 矛盾路径：conflicting 状态下 confirm 不生效（必须先把矛盾解决）
    const p7 = advanceProposition(p0, 'found_conflict', now);
    record(
        p7.state === 'conflicting' && isConfirmable(p7.state) === false,
        'found_conflict → conflicting，不可确认',
        `state=${p7.state} confirmable=${isConfirmable(p7.state)}`
    );
    const p8 = advanceProposition(p7, 'confirm', now, receipt());
    record(
        p8.state === 'conflicting',
        'conflicting + confirm(带收据) 不生效（不能强行确认）',
        `state=${p8.state}（保持 conflicting）`
    );
    // 矛盾解决：revise 后再确认
    const p9 = advanceProposition(advanceProposition(p7, 'revise', now), 'confirm', now, receipt());
    record(p9.state === 'user_confirmed', 'conflicting →(revise)→ revised →(confirm)→ user_confirmed', `state=${p9.state}`);

    // 7. 拒绝路径：reject 回到 unsupported
    const p10 = advanceProposition(p0, 'reject', now);
    record(
        p10.state === 'unsupported'
            && buildCandidateFromConfirmedProposition(p10) === null,
        'reject → unsupported，不产出候选',
        `state=${p10.state}`
    );

    // 输出
    let failed = false;
    console.log('Design Intelligence · 命题状态机单元测试：');
    for (const row of results) {
        console.log(`  [${row.ok ? 'PASS' : 'FAIL'}] ${row.label}${row.detail ? ` — ${row.detail}` : ''}`);
        if (!row.ok) failed = true;
    }
    if (failed) {
        console.error('\n[FAIL] 命题状态机单元测试未通过。');
        process.exitCode = 1;
    } else {
        console.log(`\n[OK] 命题状态机单元测试通过（${results.length} 项）。`);
    }
}

main();
