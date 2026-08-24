// 评审器纯逻辑测试：提示词含四标准 / 设计说明 / 硬伤 / 校准样本；解析加权总分与 verdict；坏输出不伪造分数。
const path = require('path');
const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.main.json') });
const { buildDesignEvaluationPrompt, parseDesignEvaluation, summarizeDesignEvaluation } = require(path.join(root, 'src/shared/design-workshop/design-evaluator.ts'));
const { buildDesignVerdict, isDesignVerdictDeliverable } = require(path.join(root, 'src/shared/design-quality-verdict-bundle.ts'));
const { executeEvaluateDesign } = require(path.join(root, 'src/renderer/services/design-workshop/evaluate-design.executor.ts'));
const { executePlanDesignTaskCard, releaseDesignTaskCardSession } = require(path.join(root, 'src/renderer/services/design-workshop/design-task-card.store.ts'));

let failed = 0;
function check(name, condition, detail) { if (condition) { console.log(`✅ ${name}`); return; } failed += 1; console.log(`❌ ${name}${detail ? ' — ' + detail : ''}`); }

const prompt = buildDesignEvaluationPrompt({
    rationale: '目的：淘宝搜索页点击图\n主张：春日薄款透气',
    deliverable: '点击图',
    hardFindings: ['文案「1双小花+1双条纹」不是本品词'],
    calibration: [{ kind: 'good', why: '留白多、主体大、字少' }, { kind: 'bad', why: '紫色渐变加大字堆砌' }]
});
check('提示含四标准与 verdict', /整体感/.test(prompt) && /原创性/.test(prompt) && /工艺/.test(prompt) && /功能/.test(prompt) && /pivot/.test(prompt));
check('提示含设计说明 / 硬伤 / 校准', /春日薄款透气/.test(prompt) && /1双小花/.test(prompt) && /紫色渐变/.test(prompt));
check('提示要求只返回 JSON', /只返回 JSON/.test(prompt));
check('提示明确独立评审不拥有交付裁决权', /不代表正式质量通过或可交付/.test(prompt) && !/pass（可交付）/.test(prompt));

const good = parseDesignEvaluation('```json\n{"criteria":{"coherence":{"score":8,"note":"统一暖调"},"originality":{"score":6,"note":"配方感"},"craft":{"score":9,"note":""},"function":{"score":9,"note":""}},"verdict":"revise","critiques":["标题压袜口，下移到左上留白","卖点列没有标记，加细线"],"nextMoves":["保留背景","先移标题"],"intentAlignment":"一致"}\n```', 'test-model');
check('解析四项分数与加权总分', good.criteria.length === 4 && Math.abs(good.overall - (8 * 0.35 + 6 * 0.3 + 9 * 0.2 + 9 * 0.15)) < 0.11, String(good.overall));
check('verdict / critiques / nextMoves 解析', good.verdict === 'revise' && good.critiques.length === 2 && good.nextMoves[0] === '保留背景');
check('独立视觉评审结构化标注为 advisory', good.authority === 'advisory_visual_critique');
check('摘要含总分与首要问题', /评审 \d+(\.\d+)?\/10/.test(summarizeDesignEvaluation(good)) && /标题压袜口/.test(summarizeDesignEvaluation(good)), summarizeDesignEvaluation(good));

const bad = parseDesignEvaluation('这张图不错哦', 'm');
check('无法解析时不伪造分数', bad.criteria.length === 0 && bad.overall === 0 && /无法解析/.test(bad.critiques[0]));

const clamped = parseDesignEvaluation('{"criteria":{"coherence":{"score":14},"originality":{"score":-3},"craft":{"score":"7.26"},"function":{}},"verdict":"pass"}');
check('分数夹紧到 0–10 且缺项为 0', clamped.criteria[0].score === 10 && clamped.criteria[1].score === 0 && clamped.criteria[2].score === 7.3 && clamped.criteria[3].score === 0 && clamped.verdict === 'pass');
check(
    'advisory pass 不向任务卡宣布可交付或 canonical 质量通过',
    /暂无明确修改建议/.test(summarizeDesignEvaluation(clamped))
        && /不代表正式质量通过/.test(summarizeDesignEvaluation(clamped))
        && !/可交付/.test(summarizeDesignEvaluation(clamped)),
    summarizeDesignEvaluation(clamped)
);

const contractOnlyVerdict = buildDesignVerdict({
    contract: {
        kind: 'creative_design',
        status: 'completed',
        required: [{ id: 'creative-delivery', status: 'passed' }],
        blockers: [],
        warnings: [],
        summary: '交付义务已完成。'
    }
});
check(
    '只有完成契约时明确标为专业质量未评价，不冒充 passed',
    contractOnlyVerdict.status === 'passed_unverified'
        && contractOnlyVerdict.source === 'contract'
        && /专业设计质量尚未评价/.test(contractOnlyVerdict.summary),
    JSON.stringify(contractOnlyVerdict)
);
check(
    '专业质量未评价保持非阻断，不把主观评分变成写入门禁',
    contractOnlyVerdict.blockers.length === 0 && isDesignVerdictDeliverable(contractOnlyVerdict),
    JSON.stringify(contractOnlyVerdict)
);

async function verifyExecutorRevisionIdentity() {
    const scope = 'test-evaluator-revision-scope';
    executePlanDesignTaskCard(scope, {
        title: '评审修订隔离',
        role: '验证当前设计版本是否解决首要问题',
        judgment: '只比较同一任务与文档的不同 Photoshop 修订',
        items: [{ kind: 'deliverable', text: '形成一版设计' }]
    });
    let historyStateId = 200;
    const deps = {
        taskCardScope: scope,
        executeToolCall: async () => ({
            success: true,
            imageData: 'ZmFrZS1pbWFnZQ==',
            historyStateRef: { documentId: 51, historyStateId }
        }),
        invokeMain: async () => ({
            success: true,
            modelId: 'test-vision',
            text: '{"criteria":{"coherence":{"score":6},"originality":{"score":6},"craft":{"score":5},"function":{"score":7}},"verdict":"revise","critiques":["标题压住袜口"],"nextMoves":["移动标题"]}'
        })
    };
    const first = await executeEvaluateDesign({}, deps);
    const sameRevision = await executeEvaluateDesign({}, deps);
    historyStateId = 201;
    const nextRevision = await executeEvaluateDesign({}, deps);
    check(
        'evaluateDesign 使用快照的文档修订身份，不把重复调用冒充修改失败',
        first.repeatedTopCritique === false
            && sameRevision.repeatedTopCritique === false
            && nextRevision.repeatedTopCritique === true,
        JSON.stringify({ first: first.repeatedTopCritique, sameRevision: sameRevision.repeatedTopCritique, nextRevision: nextRevision.repeatedTopCritique })
    );
    check(
        'evaluateDesign 返回值明确不证明专业质量或可交付',
        first.evaluationAuthority === 'advisory_visual_critique'
            && first.provesProfessionalQuality === false
            && first.provesDeliverability === false,
        JSON.stringify(first)
    );
    releaseDesignTaskCardSession(scope);
}

verifyExecutorRevisionIdentity()
    .then(() => {
        if (failed > 0) { console.log(`\n${failed} 项失败`); process.exit(1); }
        console.log('\n全部通过');
    })
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
