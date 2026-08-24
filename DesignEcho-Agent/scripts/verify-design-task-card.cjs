// 设计任务卡纯逻辑测试：建卡校验 / 打勾要收据（fact 需观察或提问、deliverable 需成功写入）/ 带数量的 deliverable / 完成判定 / 文本渲染。
const path = require('path');
const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.main.json') });
const {
    createDesignTaskCard, applyDesignTaskItemUpdate, deriveDesignTaskCompletion, renderDesignTaskCardText
} = require(path.join(root, 'src/shared/design-task-card.ts'));
const {
    executePlanDesignTaskCard,
    executeUpdateDesignTaskCard,
    getActiveDesignTaskCard,
    noteToolForTaskCardEvidence,
    recordDesignTaskEvaluation,
    releaseDesignTaskCardSession
} = require(path.join(root, 'src/renderer/services/design-workshop/design-task-card.store.ts'));

let failed = 0;
function check(name, condition, detail) {
    if (condition) { console.log(`✅ ${name}`); return; }
    failed += 1; console.log(`❌ ${name}${detail ? ' — ' + detail : ''}`);
}
const noEvidence = { observedSinceLastUpdate: false, askedUserSinceLastUpdate: false, successfulWritesSinceLastUpdate: 0 };

const bad = createDesignTaskCard({ title: '', role: '短', judgment: '', items: [{ kind: 'x', text: '' }] });
check('缺项全部指出且可执行', !bad.ok && bad.issues.length >= 4 && bad.issues.every((i) => /：/.test(i)), bad.issues.join(' | '));

const created = createDesignTaskCard({
    title: '点击图', role: '流量入口，一眼抓住精准用户需求', judgment: 'ins 风格产品 ⇒ 网感版式、先找参考',
    items: [
        { kind: 'fact', text: '这是什么产品、卖点在哪' },
        { kind: 'decision', text: '主推哪个卖点' },
        { kind: 'deliverable', text: '5 个方案', count: 5 }
    ]
}, 1000);
check('建卡成功、id 稳定', created.ok && created.card.items.length === 3 && created.card.items[0].id.startsWith('1-'), JSON.stringify(created.issues));
let card = created.card;

let r = applyDesignTaskItemUpdate(card, { itemId: card.items[0].id, status: 'done', note: '中筒袜，卖点是木耳边' }, noEvidence, 2000);
check('fact 无观察不能打勾', !r.ok && r.issues.some((i) => /没有看过图/.test(i)), r.issues.join(' | '));
r = applyDesignTaskItemUpdate(card, { itemId: card.items[0].id, status: 'done', note: '中筒袜，卖点是木耳边' }, { ...noEvidence, observedSinceLastUpdate: true }, 2000);
check('fact 有观察 + note 可打勾并留收据', r.ok && r.card.items[0].status === 'done' && r.card.items[0].receipt.note.includes('木耳边'));
card = r.card;

r = applyDesignTaskItemUpdate(card, { itemId: card.items[1].id, status: 'done' }, noEvidence, 3000);
check('decision 缺 note 不打勾', !r.ok && r.issues.some((i) => /需要 note/.test(i)));
r = applyDesignTaskItemUpdate(card, { itemId: card.items[1].id, status: 'done', note: '主推木耳边花边袜口，差异化' }, noEvidence, 3000);
check('decision 有 note 即可打勾（不需观察）', r.ok);
card = r.card;

r = applyDesignTaskItemUpdate(card, { itemId: card.items[2].id, status: 'done', note: '方案 1 出图' }, noEvidence, 4000);
check('deliverable 无写入不能打勾', !r.ok && r.issues.some((i) => /没有任何成功写入/.test(i)));
const writeEvidence = { ...noEvidence, successfulWritesSinceLastUpdate: 1, lastWriteTool: 'composeDesign', lastWriteSeq: 9, lastWriteImageRef: 'x.jpg' };
r = applyDesignTaskItemUpdate(card, { itemId: card.items[2].id, status: 'done', note: '方案 1 出图' }, writeEvidence, 4000);
check('带数量的 deliverable 打勾一次后为 doing 1/5 且收据挂工具', r.ok && r.card.items[2].status === 'doing' && r.card.items[2].producedCount === 1 && r.card.items[2].receipt.toolName === 'composeDesign');
card = r.card;
let completion = deriveDesignTaskCompletion(card);
check('未完成：摘要指出还差什么', !completion.complete && /5 个方案（1\/5）/.test(completion.summary), completion.summary);
for (let i = 0; i < 4; i += 1) { r = applyDesignTaskItemUpdate(card, { itemId: card.items[2].id, status: 'done', note: `方案 ${i + 2}` }, writeEvidence, 5000 + i); card = r.card; }
completion = deriveDesignTaskCompletion(card);
check('5/5 后完成', completion.complete && card.items[2].status === 'done', completion.summary);

const text = renderDesignTaskCardText(card);
check('文本渲染含 想/做/完成 三段与勾号', /想 │/.test(text) && /做 │ ☑/.test(text) && /完成 │/.test(text), text);

const bogus = applyDesignTaskItemUpdate(card, { itemId: 'nope', status: 'done', note: 'x' }, noEvidence);
check('未知 itemId 报可选列表', !bogus.ok && /可选：/.test(bogus.issues[0]));

// decision 留白不阻断完成
const c2 = createDesignTaskCard({ title: 'SKU', role: '转化最后一环', judgment: 'ins 风格 ⇒ 不抠图', items: [{ kind: 'decision', text: '要不要重做模板' }, { kind: 'deliverable', text: '出图' }] }, 1).card;
const c2r = applyDesignTaskItemUpdate(c2, { itemId: c2.items[1].id, status: 'done', note: '模板出图' }, writeEvidence);
check('decision 未决不阻断完成但会列出', deriveDesignTaskCompletion(c2r.card).complete && /留白/.test(deriveDesignTaskCompletion(c2r.card).summary));

const sessionCard = {
    title: '多任务隔离验证',
    role: '当前请求自己的设计清单',
    judgment: '每个 TaskRun 只能消费自己的工具收据',
    items: [{ kind: 'deliverable', text: '形成一版设计' }]
};
const scopeA = 'test-task-run-a';
const scopeB = 'test-task-run-b';
executePlanDesignTaskCard(scopeA, sessionCard);
executePlanDesignTaskCard(scopeB, sessionCard);
const itemA = getActiveDesignTaskCard(scopeA).items[0];
const itemB = getActiveDesignTaskCard(scopeB).items[0];
noteToolForTaskCardEvidence(scopeA, 'createRectangle', {}, { success: true });
const updateA = executeUpdateDesignTaskCard(scopeA, { itemId: itemA.id, status: 'done', note: 'A 的真实写入' });
const updateB = executeUpdateDesignTaskCard(scopeB, { itemId: itemB.id, status: 'done', note: '不能借用 A 的写入' });
check('不同 TaskRun 的任务卡与写入收据严格隔离', updateA.success === true && updateB.success === false, JSON.stringify({ updateA, updateB }));

const firstEvaluation = recordDesignTaskEvaluation(scopeA, '首轮评审', {
    historyStateRef: { documentId: 41, historyStateId: 100 },
    topCritique: '标题压住袜口',
    verdict: 'revise'
});
const sameRevisionEvaluation = recordDesignTaskEvaluation(scopeA, '同一版本再次评审', {
    historyStateRef: { documentId: 41, historyStateId: 100 },
    topCritique: '标题压住袜口',
    verdict: 'revise'
});
const nextRevisionEvaluation = recordDesignTaskEvaluation(scopeA, '修改后再次评审', {
    historyStateRef: { documentId: 41, historyStateId: 101 },
    topCritique: '标题压住袜口',
    verdict: 'revise'
});
const otherTaskEvaluation = recordDesignTaskEvaluation(scopeB, '另一个任务的首轮评审', {
    historyStateRef: { documentId: 41, historyStateId: 102 },
    topCritique: '标题压住袜口',
    verdict: 'revise'
});
const otherDocumentEvaluation = recordDesignTaskEvaluation(scopeA, '同任务另一文档的首轮评审', {
    historyStateRef: { documentId: 42, historyStateId: 101 },
    topCritique: '标题压住袜口',
    verdict: 'revise'
});
const missingIdentityEvaluation = recordDesignTaskEvaluation(scopeA, '外部图片评审', {
    topCritique: '标题压住袜口',
    verdict: 'revise'
});
check('同任务同文档同一修订不伪称“改了但没解决”', firstEvaluation.repeatedTopCritique === false && sameRevisionEvaluation.repeatedTopCritique === false);
check('只有同任务同文档的新修订重复首要问题才提示原地打转', nextRevisionEvaluation.repeatedTopCritique === true);
check('评审批评不跨 TaskRun 或 Photoshop 文档污染', otherTaskEvaluation.repeatedTopCritique === false && otherDocumentEvaluation.repeatedTopCritique === false);
check('缺少文档修订身份时不猜重复问题', missingIdentityEvaluation.repeatedTopCritique === false);

recordDesignTaskEvaluation(scopeA, '问题已经解决', {
    historyStateRef: { documentId: 41, historyStateId: 102 },
    topCritique: '',
    verdict: 'pass'
});
const critiqueAfterPass = recordDesignTaskEvaluation(scopeA, '后续版本出现问题', {
    historyStateRef: { documentId: 41, historyStateId: 103 },
    topCritique: '标题压住袜口',
    verdict: 'revise'
});
check('质量通过会清除该文档旧批评，后续重新出现不冒充连续未解决', critiqueAfterPass.repeatedTopCritique === false);

releaseDesignTaskCardSession(scopeA);
releaseDesignTaskCardSession(scopeB);
check('任务卡会话可显式释放', getActiveDesignTaskCard(scopeA) === null && getActiveDesignTaskCard(scopeB) === null);

if (failed > 0) { console.log(`\n${failed} 项失败`); process.exit(1); }
console.log('\n全部通过');
