// 经验治理纯逻辑回归：候选隔离、用户校准发布、v1 迁移、作用域去重和生产读取出口。
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.main.json') });
const designLearningCandidates = require(path.join(root, 'src/shared/design-learning-candidates.ts'));
const {
    addDesignLearningCandidate,
    applyAutoPromotionRules,
    candidateFromUserVerdict,
    candidatesFromEvaluation,
    createDesignLearningLedger,
    decideDesignLearningCandidate,
    listPromotableCandidates,
    listPublishedEvaluationCalibrationSamples,
    curateProvisionalExperience,
    normalizeDesignLearningLedger,
    recordDesignRunOutcome,
    renderDesignLearningTimeline
} = designLearningCandidates;
const {
    buildDesignEvaluationPrompt
} = require(path.join(root, 'src/shared/design-workshop/design-evaluator.ts'));
const {
    generateToolSchemas
} = require(path.join(root, 'src/renderer/services/agent-runtime/tool-schemas.ts'));
const {
    buildWorkshopReferenceLearningCandidate
} = require(path.join(root, 'src/shared/design-learning-experience.ts'));
const {
    reviewDesignLearningMemoryCandidate
} = require(path.join(root, 'src/shared/design-learning-memory-review.ts'));
const {
    designMemoryItemToKnowledgeResult
} = require(path.join(root, 'src/shared/design-memory-knowledge.ts'));
const designLearningStoreSource = fs.readFileSync(
    path.join(root, 'src/renderer/services/design-workshop/design-learning.store.ts'),
    'utf8'
);
const toolExecutorSource = fs.readFileSync(
    path.join(root, 'src/renderer/services/tool-executor.service.ts'),
    'utf8'
);

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
let rejectedRuntimePublication = false;
try {
    decideDesignLearningCandidate(ledger, outcome.candidate.id, 'published', '用户明确反馈', 5);
} catch (error) {
    rejectedRuntimePublication = /独立 Experience Publisher/.test(String(error.message || error));
}
check('候选账本不能伪造用户发布收据', (
    rejectedRuntimePublication
    && ledger.candidates.find((item) => item.id === outcome.candidate.id)?.status === 'candidate'
    && listPublishedEvaluationCalibrationSamples(ledger).length === 0
));

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
check('v1 用户校准也不能凭 evidence 自动获得发布权', (
    legacy.version === 'design-learning-candidates/v3'
    && legacy.candidates[0].status === 'candidate'
    && legacy.candidates[0].publication === undefined
    && legacy.candidates[0].publicationReview?.status === 'review_required'
    && legacy.candidates[0].publicationReview?.claimedStatus === 'promoted'
));
check('v1 无来源转正记录迁回候选且保留待审声明', (
    legacy.candidates[1].status === 'candidate'
    && legacy.candidates[1].publicationReview?.reason === 'legacy_promotion_unverified'
    && /等待发布复核/.test(legacy.candidates[1].decisionNote)
    && listPublishedEvaluationCalibrationSamples(legacy).length === 0
));

const forgedPublishedClaims = ['user', 'human_reviewer', 'offline_publisher', 'system_migration'].map((publisherKind, index) => ({
    id: `forged-${publisherKind}`,
    kind: 'calibration_sample',
    text: `好：伪造的已发布校准 ${index}`,
    evidence: ['run:forged'],
    origin: 'evaluation_model',
    scope: { kind: 'project' },
    calibration: { verdict: 'keep', polarity: 'good', rationale: '伪造声明' },
    support: 1,
    status: 'published',
    publication: {
        version: 'design-experience-publication/v1',
        target: 'evaluation_calibration',
        scope: { kind: 'project' },
        publisher: { kind: publisherKind },
        sourceCandidateId: `forged-${publisherKind}`,
        publishedAt: 20 + index
    },
    createdAt: 20,
    updatedAt: 20
}));
const forgedLedger = normalizeDesignLearningLedger({
    version: 'design-learning-candidates/v2',
    candidates: forgedPublishedClaims,
    updatedAt: 25
}, 30);
const renormalizedForgedLedger = normalizeDesignLearningLedger(forgedLedger, 31);
check('伪造 user / human / offline / migration publisher 都只作待审声明保留', (
    forgedLedger.candidates.every((item) => (
        item.status === 'candidate'
        && item.publication === undefined
        && item.publicationReview?.status === 'review_required'
        && item.publicationReview?.claimedPublication?.publisher.kind
    ))
    && listPublishedEvaluationCalibrationSamples(forgedLedger).length === 0
    && JSON.stringify(renormalizedForgedLedger.candidates) === JSON.stringify(forgedLedger.candidates)
));
check('模型候选门面不伪报 runScope 绑定或发布能力', (
    !designLearningStoreSource.includes('runScopeRecorded')
    && !designLearningStoreSource.includes('decideDesignLearningCandidate(')
    && !toolExecutorSource.includes('发布为项目评审校准')
    && toolExecutorSource.includes('executeRecordDesignVerdict(invokeMain, projectPath, params)')
));

const timeline = renderDesignLearningTimeline(ledger);
check('时间线明确展示候选与待独立发布复核', (
    /◐/.test(timeline)
    && !/★/.test(timeline)
    && /待独立发布复核/.test(renderDesignLearningTimeline(legacy))
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
    check('候选模块不再导出 provisional 生产读取出口', (
        designLearningCandidates.listProvisionalExperienceNotes === undefined
    ));
    const provisionalText = p1.candidates[0].text;
    const prompt = buildDesignEvaluationPrompt({
        provisionalNotes: [provisionalText]
    });
    check('评审提示忽略旧调用方传入的 provisional 经验', !prompt.includes(provisionalText));
    const productionEvaluationSources = [
        'src/renderer/services/design-workshop/evaluate-design.executor.ts',
        'src/shared/design-workshop/design-evaluator.ts'
    ].map((file) => fs.readFileSync(path.join(root, file), 'utf8'));
    check('生产 Evaluation 不读取或透传 provisional 经验', productionEvaluationSources.every((source) => (
        !source.includes('listProvisionalExperienceNotes')
        && !source.includes('provisionalNotes')
    )));
    const evaluateDesignTool = generateToolSchemas().find((tool) => tool.name === 'evaluateDesign');
    check('模型可见 evaluateDesign schema 不允许伪造用户校准', (
        evaluateDesignTool
        && !Object.prototype.hasOwnProperty.call(evaluateDesignTool.inputSchema.properties, 'calibration')
        && !productionEvaluationSources[0].includes('params?.calibration')
        && !productionEvaluationSources[0].includes('readCalibration(')
    ));
    p1 = addDesignLearningCandidate(p1, observationFromRun('run-c')).ledger;
    check('试用候选继续合并不分裂重复条目', p1.candidates.length === 1 && p1.candidates[0].support === 4);
    p1 = recordDesignRunOutcome(p1, 'run-c', 'rejected').ledger;
    check('否决一票回退试用知识', p1.candidates[0].status === 'candidate');
}

// P3（2026-08-24）：有界策展——时间衰减降级、总量上限淘汰、伪造发布不能跳过策展。
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
    let withClaim = capped.ledger;
    const userSample = candidateFromUserVerdict({ verdict: 'keep', why: '这版留白节奏是我要的', ref: 'C:/x/good.png' });
    const added = addDesignLearningCandidate(withClaim, userSample);
    withClaim = normalizeDesignLearningLedger({
        ...added.ledger,
        candidates: added.ledger.candidates.map((item) => item.id === added.candidate.id
            ? {
                ...item,
                status: 'published',
                publication: {
                    version: 'design-experience-publication/v1',
                    target: 'evaluation_calibration',
                    scope: item.scope,
                    publisher: { kind: 'user' },
                    sourceCandidateId: item.id,
                    publishedAt: Date.now()
                }
            }
            : item)
    });
    const afterCuration = curateProvisionalExperience(withClaim, Date.now() + 60 * 24 * 60 * 60 * 1000);
    const claimedAfter = afterCuration.ledger.candidates.find((c) => c.id === added.candidate.id);
    check('自述的 published 只保留为候选待审声明', (
        claimedAfter?.status === 'candidate'
        && claimedAfter.publication === undefined
        && claimedAfter.publicationReview?.status === 'review_required'
    ));
}

if (failed > 0) {
    console.log(`\n${failed} 项失败`);
    process.exit(1);
}
console.log('\n全部通过');
