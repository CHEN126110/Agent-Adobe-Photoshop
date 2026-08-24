// 运行事实账本纯逻辑测试：工具日志 → 项目记忆 patch / 续跑摘要。
// 断言：①看过的素材进 materialAssets 且带观察备注；②图上卖点线索进 upsertFacts 且带素材来源；
// ③已完成设计成品上的文字不进事实；④Agent 版面签名进 layoutPlan（只在模型没写过时）；⑤新建画布进 canvasSize；
// ⑥导出文件进 deliveryFiles；⑦有写入且模型没记版本时追加版本；⑧纯只读运行不产生 patch；
// ⑨patch 经真实 applyDesignProjectStatePatch 合并后摘要能看到素材与线索；⑩运行档案 checkpoint.designSummary 存在且续跑摘要带「上次做到」；
// ⑪用户点名的每个交付物都需要独立收据；⑫未完成项写回现有 productionTasks，模型正文不能覆盖结构化未完成事实。
const path = require('path');
const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.main.json') });
const { buildDesignRunFactLedgerPatch } = require(path.join(root, 'src/shared/design-run-fact-ledger.ts'));
const { extractDesignRunToolLogFacts, describeDesignRunToolLogFacts } = require(path.join(root, 'src/shared/design-run-tool-log-facts.ts'));
const { applyDesignProjectStatePatch, buildDesignProjectStateSummary, createEmptyDesignProjectState } = require(path.join(root, 'src/shared/design-project-state.ts'));
const { buildAgentRunRecord } = require(path.join(root, 'src/shared/agent-run-record.ts'));
const { buildRunRecordResumeBrief } = require(path.join(root, 'src/shared/agent-run-resume.ts'));
const { extractUserDeclaredDeliverables } = require(path.join(root, 'src/shared/user-declared-deliverables.ts'));
const {
    collectUserDeliverableFileEvidence,
    projectUserDeliverableReceipts
} = require(path.join(root, 'src/shared/user-deliverable-receipts.ts'));
const {
    alignUserVisibleCompletionMessage,
    synchronizeLastAssistantCompletionMessage
} = require(path.join(root, 'src/shared/agent-completion-message-consistency.ts'));
const { buildTaskCompletionContract } = require(path.join(root, 'src/renderer/services/agent-runtime/task-completion-contract.ts'));

let failed = 0;
function check(condition, label, detail) {
    if (condition) {
        console.log(`  ✓ ${label}`);
        return;
    }
    failed += 1;
    console.error(`  ✗ ${label}${detail ? `：${detail}` : ''}`);
}

const productPath = 'E:\\WERKE\\C-1248\\原始图\\中筒袜-模特上身.jpg';
const finishedPath = 'E:\\WERKE\\C-1248\\主图\\旧主图-800.png';
const log = [
    { name: 'getDocumentInfo', arguments: {}, result: { success: true, documentName: '主图-1500.psd', width: 1500, height: 1500 } },
    {
        name: 'analyzeAssetContent',
        arguments: { imagePath: productPath },
        result: {
            success: true,
            analysis: {
                description: '模特穿中筒袜站立',
                assetNature: 'raw_photo',
                category: '产品图',
                mainSubject: '灰色中筒袜',
                shotType: 'on_model',
                subjectCoverageRatio: 'moderate',
                mainImageSuitability: 'suitable',
                sellingPointObservations: ['袜口有双层罗纹', '袜身有竖向针织纹理'],
                colors: ['#999999'],
                style: '简洁',
                suggestedPlacement: '右侧',
                suggestedEffects: []
            }
        }
    },
    {
        name: 'analyzeAssetContent',
        arguments: { imagePath: finishedPath },
        result: {
            success: true,
            analysis: {
                description: '旧主图成品',
                assetNature: 'finished_design',
                category: '设计成品',
                mainSubject: '带文案的主图',
                visibleText: '防滑硅胶 久穿不掉',
                sellingPointObservations: ['防滑硅胶'],
                colors: [],
                style: '',
                suggestedPlacement: '',
                suggestedEffects: []
            }
        }
    },
    {
        name: 'createDocument',
        arguments: { name: '主图-新', width: 1500, height: 1500 },
        result: { success: true, documentName: '主图-新', width: 1500, height: 1500 }
    },
    {
        name: 'renderLayout',
        arguments: {
            groupName: '主图首稿·轻薄透气',
            regions: [
                { id: 'title', role: 'title', content: '轻薄透气\n久穿不闷', bounds: { x: 0.08, y: 0.08, width: 0.38, height: 0.22 } },
                { id: 'subtitle', role: 'subtitle', content: '春夏中筒袜', bounds: { x: 0.08, y: 0.32, width: 0.32, height: 0.08 } },
                { id: 'subject', role: 'main-image', content: productPath, bounds: { x: 0.45, y: 0.08, width: 0.48, height: 0.82 } }
            ],
            visualStyle: { mode: 'model_authored' }
        },
        result: {
            success: true,
            stageGroupName: '主图首稿·轻薄透气',
            documentInfo: { documentName: '主图-新' }
        }
    },
    { name: 'quickExport', arguments: { outputPath: 'E:\\WERKE\\C-1248\\主图\\主图-新.jpg' }, result: { success: true, outputPath: 'E:\\WERKE\\C-1248\\主图\\主图-新.jpg' } }
];

console.log('[1] 事实提取');
const facts = extractDesignRunToolLogFacts(log);
check(facts.assets.length === 2, '看过 2 张素材', JSON.stringify(facts.assets.map((a) => a.path)));
const productAsset = facts.assets.find((a) => a.path === productPath);
check(Boolean(productAsset && /灰色中筒袜/.test(productAsset.observation)), '产品图带观察备注', productAsset && productAsset.observation);
check(Boolean(productAsset && productAsset.usedInLayout), '版面主体标记 usedInLayout');
const finishedAsset = facts.assets.find((a) => a.path === finishedPath);
check(Boolean(finishedAsset && finishedAsset.sellingPointObservations.length === 0), '设计成品上的文字不进卖点观察');
check(facts.layouts.length === 1 && /^regions:title@/.test(facts.layouts[0].layoutSignature), 'Agent 版面签名已提取');
check(facts.document.created && facts.document.created.width === 1500, '新建画布已提取');
check(facts.deliveryFiles.length === 1, '导出文件已提取');
check(facts.successfulMutationCount === 3, '写入计数 = createDocument + renderLayout + quickExport', String(facts.successfulMutationCount));

console.log('[1.1] 选图证据：看过谁、用了谁、为什么');
const candidateHeroPath = 'E:\\WERKE\\C-1248\\原始图\\模特场景\\IMG_01.jpg';
const candidateDetailPath = 'E:\\WERKE\\C-1248\\原始图\\平铺细节\\IMG_02.jpg';
const contactSheetOnlyPath = 'E:\\WERKE\\C-1248\\原始图\\模特场景\\IMG_03.jpg';
const backgroundPath = 'E:\\WERKE\\C-1248\\背景\\paper.jpg';
const selectionFacts = extractDesignRunToolLogFacts([
    {
        name: 'recommendAssets',
        arguments: { requirement: '比较主视觉素材' },
        result: {
            success: true,
            comparisonItems: [
                { id: 'A01', path: candidateHeroPath, status: 'rendered' },
                { id: 'A02', path: candidateDetailPath, status: 'rendered' },
                { id: 'A03', path: contactSheetOnlyPath, status: 'rendered' },
                { id: 'A04', path: 'E:\\WERKE\\C-1248\\原始图\\坏图.jpg', status: 'failed' }
            ],
            recommendations: [
                {
                    file: { path: candidateHeroPath },
                    visualObserved: true,
                    visualEvidenceId: 'A01',
                    reason: '模特穿着关系清楚',
                    assetNature: 'raw_photo'
                },
                {
                    file: { path: candidateDetailPath },
                    visualObserved: true,
                    visualEvidenceId: 'A02',
                    reason: '防滑纹理可见',
                    assetNature: 'raw_photo'
                }
            ]
        }
    },
    {
        name: 'composeDesign',
        arguments: {
            rationale: { materials: '选择模特图建立穿着感，并用细节图补充可见纹理。' },
            document: { mode: 'new', name: '主图候选' },
            canvas: { width: 1440, height: 1440 },
            subject: { filePath: contactSheetOnlyPath },
            background: { kind: 'asset', filePath: backgroundPath },
            layout: {
                mode: 'agent_authored',
                groupName: '主图候选',
                regions: [
                    { id: '穿着主视觉', role: 'main-image', content: 'subject', bounds: { x: 0, y: 0, width: 0.7, height: 1 } },
                    { id: '防滑细节', role: 'decoration', content: candidateDetailPath, bounds: { x: 0.72, y: 0.62, width: 0.24, height: 0.28 } }
                ]
            }
        },
        result: { success: true, stageGroupName: '主图候选' }
    }
]);
const selectionTrace = selectionFacts.materialSelections[0];
check(selectionTrace && selectionTrace.selectedAssets.length === 3, '主体、独立图片与真实背景素材全部进入选图收据', JSON.stringify(selectionTrace));
check(selectionTrace && selectionTrace.explanationStatus === 'provided' && /穿着感/.test(selectionTrace.modelAuthoredReason), '模型选图依据原样保留');
check(selectionTrace && selectionTrace.currentRunCandidateEvidence.status === 'visually_compared' && selectionTrace.currentRunCandidateEvidence.evidenceIds.join('|') === 'A01|A02|A03', '候选联系表的真实编号与路径进入同一收据，失败项不混入');
check(selectionTrace && selectionTrace.selectedAssets.find((item) => item.path === contactSheetOnlyPath)?.evidenceStatus === 'matched_observed_candidate', '即使未进推荐短名单，最终主体仍能命中本轮联系表视觉证据');
check(selectionTrace && selectionTrace.selectedAssets.find((item) => item.path === backgroundPath)?.evidenceStatus === 'not_observed_in_run', '未命中候选只记事实，不伪造已观察');
check(selectionTrace && selectionTrace.boundaries.rankingDoesNotSelectWinner === true && selectionTrace.boundaries.doesNotRejectUnmatchedAsset === true, 'Harness 不用排名选赢家，也不因未命中候选拒绝素材');
const overviewSelectionTrace = extractDesignRunToolLogFacts([
    {
        name: 'analyzeProjectContactSheetOverview',
        arguments: { maxImages: 24 },
        result: {
            success: true,
            contactSheet: {
                items: [
                    { id: 'A17', path: candidateHeroPath, status: 'rendered' },
                    { id: 'A20', path: contactSheetOnlyPath, status: 'rendered' },
                    { id: 'A21', path: 'E:\\WERKE\\C-1248\\原始图\\坏图.jpg', status: 'failed' }
                ]
            }
        }
    },
    {
        name: 'composeDesign',
        arguments: {
            rationale: { materials: '选择 A17 与 A20 比较商品集合和上身语境。' },
            subject: { filePath: contactSheetOnlyPath },
            layout: { mode: 'agent_authored', regions: [] }
        },
        result: { success: true }
    }
]).materialSelections[0];
check(
    overviewSelectionTrace
        && overviewSelectionTrace.currentRunCandidateEvidence.evidenceIds.join('|') === 'A17|A20'
        && overviewSelectionTrace.selectedAssets[0]?.evidenceStatus === 'matched_observed_candidate',
    'Agent 从项目总览直接选图时也绑定编号与真实路径，不只认 recommendAssets',
    JSON.stringify(overviewSelectionTrace)
);
const missingReasonTrace = extractDesignRunToolLogFacts([
    {
        name: 'composeDesign',
        arguments: {
            subject: { filePath: candidateHeroPath },
            layout: { mode: 'agent_authored', regions: [] }
        },
        result: { success: true }
    }
]).materialSelections[0];
check(missingReasonTrace && missingReasonTrace.explanationStatus === 'missing', '缺少选图说明只标记 missing，不阻断写入');

console.log('[2] 生成 patch');
const outcome = buildDesignRunFactLedgerPatch({ toolCallLog: log, currentState: null, goal: '帮我做主图吧', now: '2026-08-18T01:00:00.000Z' });
check(Boolean(outcome.patch), '有可记事实 → 有 patch');
const patch = outcome.patch || {};
check(Array.isArray(patch.set && patch.set.materialAssets) && patch.set.materialAssets.length === 2, 'materialAssets 2 条');
check(Array.isArray(patch.upsertFacts) && patch.upsertFacts.length === 2, '卖点线索 2 条（成品文字未混入）', JSON.stringify(patch.upsertFacts));
check(Boolean(patch.upsertFacts && patch.upsertFacts.every((f) => f.source && f.source.kind === 'project_asset_observation' && /^asset:[0-9a-f]{8}$/.test(f.source.sourceRef))), '每条线索带素材来源指纹');
check(Boolean(patch.set && /Agent 版面签名/.test(patch.set.layoutPlan) && patch.set.layoutPlan.startsWith('[自动记录]')), 'layoutPlan 自动记录', patch.set && patch.set.layoutPlan);
check(Boolean(patch.set && patch.set.canvasSize && patch.set.canvasSize.width === 1500), 'canvasSize 记录');
check(Boolean(patch.set && patch.set.deliveryFiles && patch.set.deliveryFiles.length === 1), 'deliveryFiles 记录');
check(Boolean(patch.appendVersion && /写入 3 处/.test(patch.appendVersion.reason)), '追加版本', patch.appendVersion && patch.appendVersion.reason);
check(patch.updatedBy === 'harness-run-ledger', 'updatedBy = harness-run-ledger');

console.log('[3] 不覆盖模型写的内容 / 只读运行不写');
const modelState = { ...createEmptyDesignProjectState(), layoutPlan: '模型自己写的版式规划', materialAssets: [{ path: productPath, note: '用户挑的主图' }] };
const outcome2 = buildDesignRunFactLedgerPatch({ toolCallLog: log, currentState: modelState, goal: 'x', now: '2026-08-18T01:00:00.000Z' });
check(Boolean(outcome2.patch && (!outcome2.patch.set || outcome2.patch.set.layoutPlan === undefined)), '模型写的 layoutPlan 不被覆盖');
const merged2 = outcome2.patch && outcome2.patch.set && outcome2.patch.set.materialAssets;
check(Boolean(merged2 && merged2.find((a) => a.path === productPath).note === '用户挑的主图'), '模型/用户写的素材备注保留');
const readOnly = buildDesignRunFactLedgerPatch({ toolCallLog: [{ name: 'getDocumentInfo', arguments: {}, result: { success: true } }, { name: 'listDocuments', arguments: {}, result: { success: true } }], currentState: null });
check(readOnly.patch === undefined, '纯只读运行不产生 patch');
const modelWroteState = buildDesignRunFactLedgerPatch({ toolCallLog: [...log, { name: 'updateDesignProjectState', arguments: { appendVersion: { reason: 'v1' } }, result: { success: true } }], currentState: null });
check(Boolean(modelWroteState.patch && !modelWroteState.patch.appendVersion), '模型自己记过状态时不重复追加版本');

console.log('[4] 真实合并 + 摘要可见');
const applied = applyDesignProjectStatePatch(createEmptyDesignProjectState(), patch);
const summary = buildDesignProjectStateSummary(applied);
check(/已看过的素材/.test(summary) && /中筒袜-模特上身\.jpg/.test(summary), '摘要有「已看过的素材」', summary);
check(/素材上看到的卖点线索/.test(summary) && /双层罗纹/.test(summary), '摘要有「素材上看到的卖点线索」');
check(!/防滑硅胶/.test(summary), '摘要里没有成品文字');
check(/最新版本/.test(summary), '摘要有最新版本');

console.log('[5] 运行档案 designSummary + 续跑摘要');
const conversationScope = { conversationId: 'conv-ledger-test', branchId: 'branch-1' };
const record = buildAgentRunRecord({ now: '2026-08-18T01:00:00.000Z', goal: '帮我做主图吧', projectPath: 'E:\\WERKE\\C-1248', conversationScope, result: { success: false, stopReason: 'soft_time', iterations: 5, toolCallLog: log } });
check(typeof record.checkpoint.designSummary === 'string' && /Agent 版面签名「regions:title@/.test(record.checkpoint.designSummary), 'checkpoint.designSummary 含版面', record.checkpoint.designSummary);
check(record.checkpoint.designSummary.length <= 600, 'designSummary ≤ 600 字');
const partialComposeRecord = buildAgentRunRecord({
    now: '2026-08-18T01:02:00.000Z',
    goal: '帮我用项目里的素材做一张主图',
    projectPath: 'E:\\WERKE\\C-1248',
    conversationScope,
    result: {
        success: false,
        stopReason: 'tool_failed',
        iterations: 1,
        toolCallLog: [{
            name: 'composeDesign',
            arguments: { document: { mode: 'new', name: '主图首稿' } },
            result: {
                success: false,
                error: '排版步骤未完成',
                data: {
                    version: 'compose-design-execution/v1',
                    createdDocument: true,
                    layoutRendered: false,
                    partialMutation: true,
                    documentId: 3587
                },
                photoshopHistoryTransition: {
                    version: 'photoshop-history-transition/v1',
                    basis: 'acceptance_snapshot_pair',
                    before: { documentId: 3580, historyStateId: 10 },
                    after: { documentId: 3587, historyStateId: 12 },
                    mutationObserved: true,
                    documentChanged: true
                }
            }
        }]
    }
});
check(partialComposeRecord.checkpoint.documentCreated === true, '复合工具部分失败仍如实记录已新建文档');
check(partialComposeRecord.checkpoint.layoutRendered === false, '排版未完成时不会伪造 layoutRendered');
const brief = buildRunRecordResumeBrief({ records: [record], nowMs: Date.parse('2026-08-18T01:05:00.000Z'), conversationScope });
check(brief.applicable === true && /上次做到：/.test(brief.brief), '续跑摘要带「上次做到」', brief.reason);
check(/先只查看会影响下一步的目标文档/.test(brief.brief) || /直接从尚未完成的部分继续/.test(brief.brief), '续跑指引没被挤掉');
const reflexionChildRecord = buildAgentRunRecord({
    now: '2026-08-18T01:00:00.000Z',
    goal: '帮我做主图吧',
    projectPath: 'E:\\WERKE\\C-1248',
    conversationScope,
    parentRunId: record.runId,
    result: { success: false, stopReason: 'quality_reflexion', iterations: 6, toolCallLog: log }
});
check(
    reflexionChildRecord.runId !== record.runId
        && reflexionChildRecord.parentRunId === record.runId,
    'plan-neutral Reflexion 即使同秒且工具序列相同也生成独立 parentRunId 档案',
    JSON.stringify({ parent: record.runId, child: reflexionChildRecord.runId })
);
console.log('\n' + describeDesignRunToolLogFacts(facts));

console.log('[6] 用户点名交付物：逐项收据 + 续跑状态');
const naturalRequestDeliverables = extractUserDeclaredDeliverables(
    '完成必要的素材观察，然后继续设计、保存和最终验证'
);
check(naturalRequestDeliverables.length === 0, '普通过程句不会被 Harness 提升成字面交付物', JSON.stringify(naturalRequestDeliverables));
const simpleDesignRequestDeliverables = extractUserDeclaredDeliverables('帮我用项目里的素材做一张主图');
check(simpleDesignRequestDeliverables.length === 0, '一句自然设计需求交给模型理解，不要求用户填写工程化交付清单');
const explicitDeliverables = extractUserDeclaredDeliverables('交付物：主图、详情页、SKU色卡');
check(
    explicitDeliverables.map((item) => item.label).join('|') === '主图|详情页|SKU色卡',
    '只有显式交付物字段生成逐项字面义务',
    JSON.stringify(explicitDeliverables)
);
const declaredDeliverables = ['主图', '详情页', 'SKU'].map((label, index) => ({
    id: `user-deliverable-${index + 1}`,
    label,
    sourceText: '完成主图、详情页、SKU并保存',
    source: 'explicit_user_list'
}));
const deliveryLog = declaredDeliverables.map((deliverable) => ({
    name: 'saveDocument',
    arguments: { outputPath: `E:\\WERKE\\C-1248\\${deliverable.label}\\${deliverable.label}.psd` },
    result: { success: true, savedPath: `E:\\WERKE\\C-1248\\${deliverable.label}\\${deliverable.label}.psd` }
}));
const fileEvidence = collectUserDeliverableFileEvidence(deliveryLog);
const receiptProjection = projectUserDeliverableReceipts({
    deliverables: declaredDeliverables,
    candidates: fileEvidence,
    requiredKind: 'file'
});
check(receiptProjection.length === 3 && receiptProjection.every((item) => item.status === 'passed'), '三个点名交付物各自取得独立文件收据', JSON.stringify(receiptProjection));
const argumentsOnlyEvidence = collectUserDeliverableFileEvidence([{
    name: 'saveDocument',
    arguments: { outputPath: 'E:\\WERKE\\C-1248\\主图\\主图.psd' },
    result: { success: true }
}]);
check(argumentsOnlyEvidence.length === 0, '只有调用参数、没有 Tool 结果路径时不能伪造落盘收据');
const recoveryEvidence = collectUserDeliverableFileEvidence([{
    name: 'smartSave',
    arguments: {},
    result: {
        success: true,
        recoveryPath: 'E:\\WERKE\\C-1248\\.designecho\\recovery\\主图-恢复.psd',
        internalCheckpoint: true,
        countsAsDelivery: false
    }
}]);
check(recoveryEvidence.length === 0, '内部恢复点不能冒充最终交付文件收据');
const ambiguousProjection = projectUserDeliverableReceipts({
    deliverables: declaredDeliverables.slice(0, 2),
    candidates: [{
        id: 'ambiguous-file',
        kind: 'file',
        reference: 'E:\\WERKE\\C-1248\\主图详情页.psd',
        toolName: 'saveDocument',
        logIndex: 0
    }],
    requiredKind: 'file'
});
check(ambiguousProjection.every((item) => item.status === 'needs_review'), '一个模糊文件不能同时证明两个交付物', JSON.stringify(ambiguousProjection));

const taskPlan = {
    requestKind: 'autonomous_execution',
    allowedToolScope: 'photoshop_write',
    requiresTaskProgress: true,
    taskProgressObligation: 'delivery',
    executionPlan: { mode: 'tool_execution', canExecuteTools: true },
    designBrief: {
        goal: '完成主图、详情页、SKU并保存到项目目录',
        deliverables: ['saved_document'],
        userDeclaredDeliverables: declaredDeliverables,
        workMode: 'create_new'
    }
};
const completionContract = buildTaskCompletionContract({
    task: taskPlan.designBrief.goal,
    context: { agentTaskPlan: taskPlan },
    toolCallLog: []
});
const userReceiptRequirements = completionContract.required.filter((item) => item.id.startsWith('user-deliverable:'));
check(completionContract.kind === 'creative_design' && completionContract.status === 'failed', '点名生产任务即使没命中品类词也进入通用创意完成契约');
check(userReceiptRequirements.length === 3 && userReceiptRequirements.every((item) => item.status === 'failed'), '零交付不能用一次聚合完成声明掩盖三项缺失');

const progressOutcome = buildDesignRunFactLedgerPatch({
    toolCallLog: [],
    currentState: {
        ...createEmptyDesignProjectState(),
        productionTasks: [{ title: '主图', status: 'pending', note: '用户自己写的说明' }]
    },
    userDeclaredDeliverableProgress: [
        { deliverableId: 'user-deliverable-1', label: '主图', status: 'passed', evidenceReference: 'E:\\WERKE\\C-1248\\主图\\主图.psd' },
        { deliverableId: 'user-deliverable-2', label: '详情页', status: 'failed', reason: '尚未取得真实文件收据。' }
    ],
    now: '2026-08-21T01:00:00.000Z'
});
const productionTasks = progressOutcome.patch && progressOutcome.patch.set && progressOutcome.patch.set.productionTasks;
check(Array.isArray(productionTasks) && productionTasks.length === 2, '未完成交付物写回现有 productionTasks，不新建第二套状态');
check(productionTasks[0].status === 'done' && productionTasks[0].note === '用户自己写的说明', '更新确定性状态但保留用户任务说明');
check(productionTasks[1].status === 'pending' && /^\[自动收据\]/.test(productionTasks[1].note), '缺失项保持 pending，供下一轮续跑');

const alignedMessage = alignUserVisibleCompletionMessage({
    message: '三个设计都已经完成并保存好了。',
    executionStatus: completionContract.status,
    requirements: completionContract.required
});
check(/不能算全部完成/.test(alignedMessage) && /主图/.test(alignedMessage) && /详情页/.test(alignedMessage) && /SKU/.test(alignedMessage), '模型误报完成时追加结构化未完成事实', alignedMessage);

const unverifiedQualityMessage = alignUserVisibleCompletionMessage({
    message: '商品主图已完成并复核，质量通过，可用于商品主图，也可直接商用。主体放在右侧，标题保留了足够留白。',
    executionStatus: 'completed',
    requirements: [],
    designVerdict: { status: 'passed_unverified' }
});
check(
    /已完成/.test(unverifiedQualityMessage)
        && /主体放在右侧/.test(unverifiedQualityMessage)
        && !/完成并复核|质量通过|可用于商品主图|可直接商用/.test(unverifiedQualityMessage)
        && /没有完成专业设计质量评价/.test(unverifiedQualityMessage)
        && /是否用于正式发布仍需复核/.test(unverifiedQualityMessage),
    '产物完成但质量未评价时保留设计说明，并移除复核/质量通过/直接商用误报',
    unverifiedQualityMessage
);
const needsReviewQualityMessage = alignUserVisibleCompletionMessage({
    message: 'PSD 已保存到“E:/project/主图/候选稿.psd”，已完成最终画面复核，质量通过，这版已经可以直接用了。',
    executionStatus: 'needs_review',
    requirements: [],
    designVerdict: { status: 'needs_review' }
});
const needsReviewQualityBody = needsReviewQualityMessage.split('\n\n')[0];
check(
    needsReviewQualityMessage.includes('PSD 已保存到“E:/project/主图/候选稿.psd”')
        && !/已完成最终画面复核|质量通过|可以直接用/.test(needsReviewQualityBody)
        && /当前设计质量仍待复核/.test(needsReviewQualityMessage)
        && /尚不能据此确认画面质量通过或可直接使用/.test(needsReviewQualityMessage),
    'needs_review 保留真实保存事实，移除无依据的终审/质量/直接使用声明并给出中性说明',
    needsReviewQualityMessage
);
const alreadyHonestNeedsReviewMessage = 'PSD 已保存，当前设计质量仍待复核。';
check(
    alignUserVisibleCompletionMessage({
        message: alreadyHonestNeedsReviewMessage,
        executionStatus: 'needs_review',
        designVerdict: { status: 'needs_review' }
    }) === alreadyHonestNeedsReviewMessage,
    'needs_review 正文已经诚实时不重复追加质量说明'
);
const alreadyHonestQualityMessage = '商品主图已经形成，但专业设计质量尚未评价，不可直接商用。';
check(
    alignUserVisibleCompletionMessage({
        message: alreadyHonestQualityMessage,
        executionStatus: 'completed',
        designVerdict: { status: 'passed_unverified' }
    }) === alreadyHonestQualityMessage,
    '正文已诚实说明质量未知时不重复追加 Harness 文案'
);
const verifiedQualityMessage = '商品主图已完成并复核，质量通过。';
check(
    alignUserVisibleCompletionMessage({
        message: verifiedQualityMessage,
        executionStatus: 'completed',
        designVerdict: { status: 'passed' }
    }) === verifiedQualityMessage,
    '真实 passed 质量裁决不被未验证态校正逻辑改写'
);

const markdownQualityMessage = [
    '商品主图已完成并复核。',
    '',
    '- 设计说明',
    '  - 主体右置',
    '    - 保留留白',
    '',
    '```js',
    '  const quotedClaim = "可直接商用";',
    '```',
    '',
    '> 用户原话：可直接商用'
].join('\n');
const alignedMarkdownQualityMessage = alignUserVisibleCompletionMessage({
    message: markdownQualityMessage,
    executionStatus: 'completed',
    designVerdict: { status: 'passed_unverified' }
});
check(
    alignedMarkdownQualityMessage.includes('- 设计说明\n  - 主体右置\n    - 保留留白')
        && alignedMarkdownQualityMessage.includes('```js\n  const quotedClaim = "可直接商用";\n```')
        && alignedMarkdownQualityMessage.includes('> 用户原话：可直接商用')
        && !alignedMarkdownQualityMessage.includes('完成并复核'),
    '校正无条件质量承诺时保持 Markdown、列表、代码与引用原样',
    alignedMarkdownQualityMessage
);

for (const preservedMessage of [
    'PSD 已完成，经复核已成功保存；图层结构可继续编辑。',
    'PSD 已导出，可用于商品主图设计的后续人工复核。',
    '用户原话是“可直接商用”，但专业质量尚未评价。',
    '文件名是 `可直接商用.psd`，请勿改名。',
    '如果专业评审通过，这张图可直接商用。',
    '经人工复核后可直接商用。',
    'PSD 已保存，可直接用 Photoshop 打开继续编辑；当前设计质量仍待复核。'
]) {
    check(
        alignUserVisibleCompletionMessage({
            message: preservedMessage,
            executionStatus: 'completed',
            designVerdict: { status: 'passed_unverified' }
        }) === preservedMessage,
        '技术复核、限定用途、引语与文件名不被误删',
        preservedMessage
    );
}

const mixedQualityMessage = '质量通过，但导出文件仍需技术复核。';
const alignedMixedQualityMessage = alignUserVisibleCompletionMessage({
    message: mixedQualityMessage,
    executionStatus: 'completed',
    designVerdict: { status: 'passed_unverified' }
});
check(
    !alignedMixedQualityMessage.includes('质量通过')
        && alignedMixedQualityMessage.includes('导出文件仍需技术复核')
        && alignedMixedQualityMessage.includes('没有完成专业设计质量评价'),
    '限定另一对象不掩盖同句中的无条件质量承诺',
    alignedMixedQualityMessage
);

const qualifiedThenUnconditionalMessage = '如果专业评审通过，可用于商品主图；但当前质量通过。';
const alignedQualifiedThenUnconditionalMessage = alignUserVisibleCompletionMessage({
    message: qualifiedThenUnconditionalMessage,
    executionStatus: 'completed',
    designVerdict: { status: 'passed_unverified' }
});
check(
    alignedQualifiedThenUnconditionalMessage.includes('如果专业评审通过，可用于商品主图')
        && !alignedQualifiedThenUnconditionalMessage.includes('当前质量通过')
        && alignedQualifiedThenUnconditionalMessage.includes('没有完成专业设计质量评价'),
    '限定语只保护紧邻声明，不掩盖后续独立质量承诺',
    alignedQualifiedThenUnconditionalMessage
);

const whitespaceSensitiveMessage = '\n- 质量通过\n  - 主体右置  \n';
const alignedWhitespaceSensitiveMessage = alignUserVisibleCompletionMessage({
    message: whitespaceSensitiveMessage,
    executionStatus: 'completed',
    designVerdict: { status: 'passed_unverified' }
});
check(
    alignedWhitespaceSensitiveMessage.startsWith('\n- ')
        && alignedWhitespaceSensitiveMessage.includes('\n  - 主体右置  \n'),
    '校正不归一全文首尾空白或 Markdown 硬换行',
    JSON.stringify(alignedWhitespaceSensitiveMessage)
);

const rawCompletionHistory = [
    { role: 'system', content: '系统提示' },
    { role: 'assistant', content: markdownQualityMessage },
    { role: 'tool_result', content: '内部收尾记录' }
];
const synchronizedCompletionHistory = synchronizeLastAssistantCompletionMessage({
    messages: rawCompletionHistory,
    originalMessage: markdownQualityMessage,
    alignedMessage: alignedMarkdownQualityMessage
});
check(
    synchronizedCompletionHistory !== rawCompletionHistory
        && synchronizedCompletionHistory[1].content === alignedMarkdownQualityMessage
        && rawCompletionHistory[1].content === markdownQualityMessage
        && synchronizedCompletionHistory[2] === rawCompletionHistory[2],
    '公开 completion history 同步 canonical 正文且不修改内部原数组'
);
const whitespaceHistory = [{ role: 'assistant', content: '  原文  ' }];
check(
    synchronizeLastAssistantCompletionMessage({
        messages: whitespaceHistory,
        originalMessage: '原文',
        alignedMessage: '校正正文'
    }) === whitespaceHistory,
    '公开 history 只按精确原文同步，不用 trim 误命中另一版本'
);

if (failed > 0) {
    console.error(`\n[FAIL] 运行事实账本：${failed} 项断言失败`);
    process.exit(1);
}
console.log('\n[OK] 运行事实账本纯逻辑测试通过');
