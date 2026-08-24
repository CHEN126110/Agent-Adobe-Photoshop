// 经验治理纯逻辑回归：候选隔离、用户校准发布、v1 迁移、作用域去重和生产读取出口。
const path = require('path');
const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.main.json') });
const {
    addDesignLearningCandidate,
    applyAutoPromotionRules,
    candidateFromUserVerdict,
    candidatesFromEvaluation,
    createDesignLearningLedger,
    decideDesignLearningCandidate,
    listPromotableCandidates,
    listPublishedEvaluationCalibrationSamples,
    listProvisionalExperienceNotes,
    curateProvisionalExperience,
    normalizeDesignLearningLedger,
    recordDesignRunOutcome,
    renderDesignLearningTimeline
} = require(path.join(root, 'src/shared/design-learning-candidates.ts'));
const {
    buildWorkshopReferenceLearningCandidate
} = require(path.join(root, 'src/shared/design-learning-experience.ts'));
const {
    reviewDesignLearningMemoryCandidate
} = require(path.join(root, 'src/shared/design-learning-memory-review.ts'));
const {
    designMemoryItemToKnowledgeResult
} = require(path.join(root, 'src/shared/design-memory-knowledge.ts'));

let failed = 0;
function check(name, condition, detail) {
    if (condition) {
        console.log(`✅ ${name}`);
        return;
    }
    failed += 1;
    console.log(`❌ ${name}${detail ? ` — ${detail}` : ''}`);
}

let ledger = createDesignLearningLedger(1);
let outcome = addDesignLearningCandidate(ledger, {
    kind: 'principle',
    text: '标题不要压住产品关键结构',
    evidence: 'run:1',
    origin: 'evaluation_model'
}, 2);
ledger = outcome.ledger;
check('新建候选带来源和项目作用域', (
    !outcome.merged
    && outcome.candidate.status === 'candidate'
    && outcome.candidate.origin === 'evaluation_model'
    && outcome.candidate.scope.kind === 'project'
));
outcome = addDesignLearningCandidate(ledger, {
    kind: 'principle',
    text: '标题不要压住产品关键结构。',
    evidence: 'run:2',
    origin: 'evaluation_model'
}, 3);
ledger = outcome.ledger;
check('同来源 / 作用域 / 文本合并 support 与证据', (
    outcome.merged
    && outcome.candidate.support === 2
    && outcome.candidate.evidence.length === 2
    && ledger.candidates.length === 1
));
check('重复观察只进入送审队列，不发布', (
    listPromotableCandidates(ledger).length === 1
    && listPublishedEvaluationCalibrationSamples(ledger).length === 0
));

const fromEvaluation = candidatesFromEvaluation({
    critiques: ['右上角色名标签与白袜零对比', '短'],
    runId: 'r9',
    deliverable: '点击图'
});
check('评审批评保留为 evaluation_finding，不伪装成通用原则', (
    fromEvaluation.length === 1
    && fromEvaluation[0].kind === 'evaluation_finding'
    && fromEvaluation[0].text === '右上角色名标签与白袜零对比'
    && fromEvaluation[0].origin === 'evaluation_model'
));

const fromUser = candidateFromUserVerdict({ verdict: 'revise', why: '主体太小', ref: 'a.jpg' });
check('用户 revise 结构化为 bad 校准', (
    fromUser
    && fromUser.kind === 'calibration_sample'
    && fromUser.origin === 'user_feedback'
    && fromUser.calibration.polarity === 'bad'
    && fromUser.evidence.includes('user')
));
check('用户没说为什么不建候选', candidateFromUserVerdict({ verdict: 'discard' }) === null);

outcome = addDesignLearningCandidate(ledger, fromUser, 4);
ledger = outcome.ledger;
check('未发布的用户校准仍不进入评审器', listPublishedEvaluationCalibrationSamples(ledger).length === 0);
ledger = decideDesignLearningCandidate(ledger, outcome.candidate.id, 'published', '用户明确反馈', 5);
const samples = listPublishedEvaluationCalibrationSamples(ledger);
check('用户校准发布后成为评审器唯一可读样本', (
    samples.length === 1
    && samples[0].kind === 'bad'
    && samples[0].why === '主体太小'
    && samples[0].ref === 'a.jpg'
));
const published = ledger.candidates.find((item) => item.id === outcome.candidate.id);
check('发布记录包含目标、作用域、发布者和来源候选', (
    published.status === 'published'
    && published.publication.target === 'evaluation_calibration'
    && published.publication.scope.kind === 'project'
    && published.publication.publisher.kind === 'user'
    && published.publication.sourceCandidateId === published.id
));

let rejectedUnsafePublication = false;
try {
    decideDesignLearningCandidate(ledger, ledger.candidates[0].id, 'published', '在线转正', 6);
} catch (error) {
    rejectedUnsafePublication = /离线评测与人审发布器/.test(String(error.message || error));
}
check('在线运行拒绝把模型观察发布成正式原则', rejectedUnsafePublication);

const legacy = normalizeDesignLearningLedger({
    version: 'design-learning-candidates/v1',
    updatedAt: 10,
    candidates: [
        {
            id: 'legacy-user', kind: 'calibration_sample', text: '好：留白清楚', evidence: ['user'],
            support: 1, status: 'promoted', createdAt: 8, updatedAt: 9
        },
        {
            id: 'legacy-auto', kind: 'principle', text: '避免：多用留白', evidence: ['run:8'],
            support: 3, status: 'promoted', createdAt: 8, updatedAt: 9
        }
    ]
}, 11);
check('v1 用户校准安全迁移为发布记录', (
    legacy.version === 'design-learning-candidates/v2'
    && legacy.candidates[0].status === 'published'
    && legacy.candidates[0].publication.publisher.kind === 'system_migration'
));
check('v1 无来源转正记录迁回候选，不污染生产', (
    legacy.candidates[1].status === 'candidate'
    && /迁回候选/.test(legacy.candidates[1].decisionNote)
    && listPublishedEvaluationCalibrationSamples(legacy).length === 1
));

const timeline = renderDesignLearningTimeline(ledger);
check('时间线明确展示候选 / 已发布与发布目标', (
    /◐/.test(timeline)
    && /★/.test(timeline)
    && /evaluation_calibration\/project/.test(timeline)
), timeline);

const workshopCandidate = buildWorkshopReferenceLearningCandidate({
    title: '电商主图参考学习',
    summary: '主体占比明确，利益点和商品不争抢视觉中心。',
    whatLooksGood: ['商品轮廓完整', '信息层级清楚'],
    whyItWorks: ['视觉动线从商品进入利益点'],
    reusableHeuristics: ['首先保证商品识别，再增加卖点信息'],
    suitableScenarios: ['电商主图'],
    userCuratedReference: true,
    now: '2026-08-21T00:00:00.000Z'
});
check('参考图解读只生成人工待审长期记忆候选', (
    workshopCandidate
    && workshopCandidate.status === 'needs_review'
    && workshopCandidate.sourceRank === 0
    && designMemoryItemToKnowledgeResult(workshopCandidate) === undefined
));
const approvedWorkshopMemory = reviewDesignLearningMemoryCandidate({
    candidate: workshopCandidate,
    decision: 'approved',
    reviewer: 'human-reviewer',
    notes: ['已核对参考图与解读，仅作方法参考。'],
    reviewedAt: '2026-08-21T01:00:00.000Z'
}).reviewedItem;
check('人工审核后才能进入可检索长期知识', (
    approvedWorkshopMemory.status === 'active'
    && designMemoryItemToKnowledgeResult(approvedWorkshopMemory)?.id === `local-memory:${approvedWorkshopMemory.id}`
));

// ===== 自主沉淀 P1：行为事实验证与保守自动晋升（2026-08-23）=====
{
    let p1 = createDesignLearningLedger();
    const observationFromRun = (runId) => candidatesFromEvaluation({
        critiques: ['主体太小，放大到画面 60% 以上'],
        runId
    })[0];
    p1 = addDesignLearningCandidate(p1, observationFromRun('run-a')).ledger;
    p1 = addDesignLearningCandidate(p1, observationFromRun('run-b')).ledger;
    p1 = addDesignLearningCandidate(p1, observationFromRun('run-b')).ledger;
    check('无交付结局时不自动晋升（重复观察不是资格）', applyAutoPromotionRules(p1).promoted.length === 0);
    check('结局回写只作用于 run 标记匹配的候选', recordDesignRunOutcome(p1, 'run-x', 'delivered').touched === 0);
    p1 = recordDesignRunOutcome(p1, 'run-a', 'delivered').ledger;
    const promotion = applyAutoPromotionRules(p1);
    p1 = promotion.ledger;
    check(
        '行为事实达标（3 观察 / 2 运行 / 1 交付 / 0 否决）自动进入试用',
        promotion.promoted.length === 1 && p1.candidates[0].status === 'provisional'
    );
    check('试用知识不进入评审校准消费面', listPublishedEvaluationCalibrationSamples(p1).length === 0);
    // P2（2026-08-24）：试用经验有且只有 listProvisionalExperienceNotes 一个消费出口（上限+仅 provisional）。
    check('试用经验经专用出口进入评审观察线索', listProvisionalExperienceNotes(p1).length === 1);
    check('试用经验出口上限生效', listProvisionalExperienceNotes(p1, 0).length === 0);
    p1 = addDesignLearningCandidate(p1, observationFromRun('run-c')).ledger;
    check('试用候选继续合并不分裂重复条目', p1.candidates.length === 1 && p1.candidates[0].support === 4);
    p1 = recordDesignRunOutcome(p1, 'run-c', 'rejected').ledger;
    check('否决一票回退试用知识', p1.candidates[0].status === 'candidate');
}

// P3（2026-08-24）：有界策展——时间衰减降级、总量上限淘汰、published 永不被自动策展。
{
    let p3 = createDesignLearningLedger();
    const seed = (runId, text) => {
        for (const c of candidatesFromEvaluation({ critiques: [text], runId })) {
            p3 = addDesignLearningCandidate(p3, c).ledger;
        }
    };
    const makeProvisional = (text, idx) => {
        seed(`r-${idx}-a`, text); seed(`r-${idx}-b`, text); seed(`r-${idx}-b`, text);
        p3 = recordDesignRunOutcome(p3, `r-${idx}-a`, 'delivered').ledger;
        p3 = applyAutoPromotionRules(p3).ledger;
    };
    makeProvisional('留白不足画面拥挤需要放大呼吸感', 1);
    const staleCuration = curateProvisionalExperience(p3, Date.now() + 31 * 24 * 60 * 60 * 1000);
    check('试用超 30 天无更新自动降回候选', staleCuration.demoted.length === 1
        && staleCuration.ledger.candidates.every((c) => c.status !== 'provisional'));
    for (let i = 2; i <= 12; i++) makeProvisional(`观察条目第${i}号内容各不相同避免合并`, i);
    const provisionalCount = p3.candidates.filter((c) => c.status === 'provisional').length;
    const capped = curateProvisionalExperience(p3);
    const remaining = capped.ledger.candidates.filter((c) => c.status === 'provisional').length;
    check('试用总量超上限按支持度淘汰最弱', provisionalCount > 10 && remaining === 10);
    let withPub = capped.ledger;
    const userSample = candidateFromUserVerdict({ verdict: 'keep', why: '这版留白节奏是我要的', ref: 'C:/x/good.png' });
    const added = addDesignLearningCandidate(withPub, userSample);
    withPub = decideDesignLearningCandidate(added.ledger, added.candidate.id, 'published', '用户拍板');
    const afterCuration = curateProvisionalExperience(withPub, Date.now() + 60 * 24 * 60 * 60 * 1000);
    const pubAfter = afterCuration.ledger.candidates.find((c) => c.id === added.candidate.id);
    check('published（用户拍板）永不被自动策展', pubAfter?.status === 'published');
}

if (failed > 0) {
    console.log(`\n${failed} 项失败`);
    process.exit(1);
}
console.log('\n全部通过');
