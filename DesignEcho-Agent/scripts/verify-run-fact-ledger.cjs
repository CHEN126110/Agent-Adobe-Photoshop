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
const {
    buildAgentRunRecord,
    validateAgentRunRecordForPersist
} = require(path.join(root, 'src/shared/agent-run-record.ts'));
const {
    buildRuntimeAccountingDigest,
    cloneRuntimeAccountingLedger,
    createRuntimeAccountingLedger,
    recordRuntimeModelCall,
    recordRuntimePerformanceUsage,
    recordRuntimeToolCall
} = require(path.join(root, 'src/shared/agent-runtime-v5/runtime-accounting.ts'));
const {
    buildRuntimeSessionDigest,
    createRuntimeSession,
    createRuntimeSessionIdentity
} = require(path.join(root, 'src/shared/agent-runtime-v5/runtime-session.ts'));
const {
    extendTaskRunDocumentCreationEvidence
} = require(path.join(root, 'src/shared/task-run-document-creation-evidence.ts'));
const {
    MAIN_IMAGE_EVALUATION_PROFILE_ID,
    evaluateDesignEvaluationProfile,
    getDesignEvaluationProfileById
} = require(path.join(root, 'src/shared/agent-runtime-v5/design-evaluation-profiles.ts'));
const {
    ActiveRuntimeAccounting
} = require(path.join(root, 'src/renderer/services/agent-runtime/active-runtime-accounting.ts'));
const {
    buildRuntimeContractStatus
} = require(path.join(root, 'src/shared/agent-runtime-v5/runtime-selected-skill-handoff.ts'));
const { buildRunRecordResumeBrief } = require(path.join(root, 'src/shared/agent-run-resume.ts'));
const { extractUserDeclaredDeliverables } = require(path.join(root, 'src/shared/user-declared-deliverables.ts'));
const {
    collectUserDeliverableFileEvidence,
    projectUserDeliverableReceipts
} = require(path.join(root, 'src/shared/user-deliverable-receipts.ts'));
const {
    alignUserVisibleCompletionMessage,
    resolveAgentExecutionPresentationDisposition,
    synchronizeLastAssistantCompletionMessage
} = require(path.join(root, 'src/shared/agent-completion-message-consistency.ts'));
const { buildTaskCompletionContract } = require(path.join(root, 'src/renderer/services/agent-runtime/task-completion-contract.ts'));
const {
    detectDesignArtifactStructureConcerns
} = require(path.join(root, 'src/shared/design-artifact-structure-concerns.ts'));
const {
    buildDesignFinalReviewSupportingImagePayload,
    projectFinalSupportingSourceCarryover,
    projectDesignFinalReviewStructureVerification,
    selectFinalSupportingSourcePlacements
} = require(path.join(root, 'src/renderer/services/agent-runtime/design-final-review-evidence.ts'));
const {
    appendMutationBoundDesignIntent,
    formatMutationBoundDesignIntentForReview
} = require(path.join(root, 'src/renderer/services/agent-runtime/mutation-bound-design-intent.ts'));

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
        callId: 'compose-source-call-1',
        modelTurn: 6,
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
        result: {
            success: true,
            stageGroupName: '主图候选',
            documentId: 91,
            historyStateRef: { documentId: 91, historyStateId: 108 },
            photoLayerId: 501,
            backgroundLayerId: 502,
            imagePlacementReceipts: [
                { blockId: '防滑细节', layerId: 503 }
            ]
        }
    }
]);
const selectionTrace = selectionFacts.materialSelections[0];
check(selectionTrace && selectionTrace.selectedAssets.length === 3, '主体、独立图片与真实背景素材全部进入选图收据', JSON.stringify(selectionTrace));
check(selectionTrace && selectionTrace.explanationStatus === 'provided' && /穿着感/.test(selectionTrace.modelAuthoredReason), '模型选图依据原样保留');
check(selectionTrace && selectionTrace.currentRunCandidateEvidence.status === 'visually_compared' && selectionTrace.currentRunCandidateEvidence.evidenceIds.join('|') === 'A01|A02|A03', '候选联系表的真实编号与路径进入同一收据，失败项不混入');
check(selectionTrace && selectionTrace.selectedAssets.find((item) => item.path === contactSheetOnlyPath)?.evidenceStatus === 'matched_observed_candidate', '即使未进推荐短名单，最终主体仍能命中本轮联系表视觉证据');
check(selectionTrace && selectionTrace.selectedAssets.find((item) => item.path === backgroundPath)?.evidenceStatus === 'not_observed_in_run', '未命中候选只记事实，不伪造已观察');
check(selectionTrace && selectionTrace.boundaries.rankingDoesNotSelectWinner === true && selectionTrace.boundaries.doesNotRejectUnmatchedAsset === true, 'Harness 不用排名选赢家，也不因未命中候选拒绝素材');
function extractCallingAgentSelectionTrace(agentVisualObservations) {
    return extractDesignRunToolLogFacts([
        {
            name: 'recommendAssets',
            arguments: { requirement: '比较主视觉素材' },
            result: {
                success: true,
                comparisonItems: [
                    { id: 'A01', path: candidateHeroPath, status: 'rendered' },
                    { id: 'A02', path: candidateDetailPath, status: 'rendered' }
                ],
                visualComparison: {
                    status: 'metadata_only',
                    comparedCount: 0,
                    modelCallCount: 0,
                    rankingIsAdvisory: true,
                    agentSelectsFinalAsset: true
                },
                visualObservationHandoff: {
                    owner: 'calling_agent',
                    status: 'pixels_attached',
                    sourceKind: 'candidate_set'
                },
                sheet: {
                    sourceId: 'asset-shortlist:test-candidates',
                    sourceKind: 'candidate_set'
                },
                ...(agentVisualObservations ? { agentVisualObservations } : {})
            }
        },
        {
            name: 'composeDesign',
            arguments: {
                rationale: { materials: '选择 A01 作为主视觉。' },
                subject: { filePath: candidateHeroPath },
                layout: { mode: 'agent_authored', regions: [] }
            },
            result: { success: true }
        }
    ]).materialSelections[0];
}
const unconsumedCallingAgentTrace = extractCallingAgentSelectionTrace(undefined);
check(
    unconsumedCallingAgentTrace
        && unconsumedCallingAgentTrace.currentRunCandidateEvidence.status === 'not_available'
        && unconsumedCallingAgentTrace.selectedAssets[0]?.evidenceStatus === 'not_observed_in_run',
    'calling_agent 联系表未被成功模型回合消费时不能冒充已比较候选',
    JSON.stringify(unconsumedCallingAgentTrace)
);
const consumedCallingAgentTrace = extractCallingAgentSelectionTrace([{
    version: 'agent-visual-observation/v1',
    status: 'presented_to_primary',
    reviewed: false,
    observer: 'primary_model',
    strategy: 'primary-self',
    toolName: 'recommendAssets',
    sourceId: 'asset-shortlist:test-candidates',
    sourceKind: 'candidate_set',
    presentedModelTurn: 2,
    consumedModelTurn: 3
}]);
check(
    consumedCallingAgentTrace
        && consumedCallingAgentTrace.currentRunCandidateEvidence.status === 'visually_compared'
        && consumedCallingAgentTrace.currentRunCandidateEvidence.evidenceIds.join('|') === 'A01|A02'
        && consumedCallingAgentTrace.selectedAssets[0]?.evidenceStatus === 'matched_observed_candidate',
    'calling_agent 联系表只有在 primary-self 模型回合真实消费后才升级为已比较',
    JSON.stringify(consumedCallingAgentTrace)
);
const structuredMetadataOnlyTrace = extractDesignRunToolLogFacts([
    {
        name: 'recommendAssets',
        arguments: { requirement: '比较主视觉素材' },
        result: {
            success: true,
            comparisonItems: [
                { id: 'A01', path: candidateHeroPath, status: 'rendered' }
            ],
            visualComparison: {
                status: 'metadata_only',
                comparedCount: 0,
                modelCallCount: 0,
                rankingIsAdvisory: true,
                agentSelectsFinalAsset: true
            }
        }
    },
    {
        name: 'composeDesign',
        arguments: {
            subject: { filePath: candidateHeroPath },
            layout: { mode: 'agent_authored', regions: [] }
        },
        result: { success: true }
    }
]).materialSelections[0];
check(
    structuredMetadataOnlyTrace
        && structuredMetadataOnlyTrace.currentRunCandidateEvidence.status === 'not_available'
        && structuredMetadataOnlyTrace.selectedAssets[0]?.evidenceStatus === 'not_observed_in_run',
    'structured 候选分析失败为 metadata-only 时不能只凭 rendered manifest 冒充视觉证据',
    JSON.stringify(structuredMetadataOnlyTrace)
);
const composeSupportingSources = selectionFacts.supportingSourcePlacements;
check(
    composeSupportingSources.length === 3
        && composeSupportingSources.find((item) => item.sourceSlot === 'subject')?.layerId === 501
        && composeSupportingSources.find((item) => item.sourceSlot === 'background')?.layerId === 502
        && composeSupportingSources.find((item) => item.declaredRegionId === '防滑细节')?.layerId === 503,
    'composeDesign 只按成功结果投影主体、背景和独立图片的真实目标 layer',
    JSON.stringify(composeSupportingSources)
);
check(
    composeSupportingSources.every((item) => (
        item.documentId === 91
        && item.historyStateId === 108
        && item.callId === 'compose-source-call-1'
        && item.modelTurn === 6
    )),
    'composeDesign supporting source 保留有证据的 document/history 与模型调用来源',
    JSON.stringify(composeSupportingSources)
);
check(
    composeSupportingSources.every((item) => (
        item.usage === 'supporting_source'
        && item.boundaries.ranksCandidates === false
        && item.boundaries.selectsWinner === false
        && item.boundaries.countsAsFinalSurface === false
        && item.boundaries.countsAsDeliveryEvidence === false
    ))
        && selectionFacts.deliveryFiles.length === 0,
    'supporting source 不排序、不选赢家、不进入 DesignReviewSet final surface 或交付覆盖率'
);
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

const directPlacedSourcePath = 'E:\\WERKE\\C-1248\\原始图\\模特场景\\IMG_09.jpg';
const directPlacementFacts = extractDesignRunToolLogFacts([
    {
        callId: 'place-source-call-1',
        modelTurn: 9,
        name: 'placeImage',
        arguments: {
            filePath: directPlacedSourcePath,
            sourcePath: directPlacedSourcePath,
            documentId: 999,
            name: '主视觉·模特上身'
        },
        result: {
            success: true,
            data: { layerId: 42 },
            historyStateRef: { documentId: 90, historyStateId: 97 }
        }
    },
    {
        callId: 'place-source-call-failed',
        modelTurn: 10,
        name: 'placeImage',
        arguments: { filePath: 'E:\\WERKE\\C-1248\\原始图\\失败.jpg' },
        result: { success: false, error: '置入失败' }
    }
]);
const directSupportingSource = directPlacementFacts.supportingSourcePlacements[0];
check(
    directPlacementFacts.supportingSourcePlacements.length === 1
        && directSupportingSource?.path === directPlacedSourcePath
        && directSupportingSource?.sourceTool === 'placeImage'
        && directSupportingSource?.sourceSlot === 'direct_placement'
        && directSupportingSource?.layerId === 42
        && directSupportingSource?.documentId === 90
        && directSupportingSource?.historyStateId === 97
        && directSupportingSource?.callId === 'place-source-call-1'
        && directSupportingSource?.modelTurn === 9,
    'placeImage 只从成功调用提取实际源图和 Host 目标；失败调用不混入',
    JSON.stringify(directPlacementFacts.supportingSourcePlacements)
);
check(
    directSupportingSource?.declaredRole === undefined
        && directSupportingSource?.boundaries.countsAsFinalSurface === false
        && directSupportingSource?.boundaries.countsAsDeliveryEvidence === false
        && directPlacementFacts.deliveryFiles.length === 0,
    'direct placement 不从图层名猜素材角色，也不能满足终审画面或文件交付'
);
const unboundDirectSupportingSource = extractDesignRunToolLogFacts([{
    callId: 'place-source-call-unbound',
    modelTurn: 11,
    name: 'placeImage',
    arguments: {
        filePath: directPlacedSourcePath,
        documentId: 777,
        layerId: 888
    },
    result: { success: true }
}]).supportingSourcePlacements[0];
check(
    unboundDirectSupportingSource?.path === directPlacedSourcePath
        && unboundDirectSupportingSource?.documentId === undefined
        && unboundDirectSupportingSource?.historyStateId === undefined
        && unboundDirectSupportingSource?.layerId === undefined,
    '调用参数不能补造 supporting source 的 Host document/history/layer 目标',
    JSON.stringify(unboundDirectSupportingSource)
);
const failedComposeSupportingSources = extractDesignRunToolLogFacts([{
    callId: 'compose-source-call-failed',
    modelTurn: 12,
    name: 'composeDesign',
    arguments: {
        subject: { filePath: candidateHeroPath },
        layout: { mode: 'agent_authored', regions: [] }
    },
    result: {
        success: false,
        documentId: 92,
        photoLayerId: 601,
        error: '候选没有完成'
    }
}]).supportingSourcePlacements;
check(
    failedComposeSupportingSources.length === 0,
    '失败 composeDesign 即使回传部分 document/layer 也不能登记为实际 supporting source'
);

const replacementPaths = {
    originalLayer: 'E:\\WERKE\\C-1248\\原始图\\替换前.jpg',
    replacedLayer: 'E:\\WERKE\\C-1248\\原始图\\替换后.png',
    originalPlaceholder: 'E:\\WERKE\\C-1248\\原始图\\占位前.jpg',
    replacedPlaceholder: 'E:\\WERKE\\C-1248\\原始图\\占位后.jpg',
    originalSmartObject: 'E:\\WERKE\\C-1248\\原始图\\智能对象前.jpg',
    replacedSmartObject: 'E:\\WERKE\\C-1248\\原始图\\智能对象后.jpg'
};
const replacementFacts = extractDesignRunToolLogFacts([
    {
        name: 'placeImage',
        arguments: { filePath: replacementPaths.originalLayer },
        result: {
            success: true,
            layerId: 40,
            historyStateRef: { documentId: 91, historyStateId: 120 }
        }
    },
    {
        callId: 'replace-layer-call',
        modelTurn: 13,
        name: 'replaceLayerContent',
        arguments: { layerId: 40, filePath: replacementPaths.replacedLayer },
        result: {
            success: true,
            data: { originalLayerId: 40, newLayerId: 41 },
            historyStateRef: { documentId: 91, historyStateId: 121 }
        }
    },
    {
        name: 'placeImage',
        arguments: { filePath: replacementPaths.originalPlaceholder },
        result: {
            success: true,
            layerId: 50,
            historyStateRef: { documentId: 91, historyStateId: 122 }
        }
    },
    {
        callId: 'replace-placeholder-call',
        modelTurn: 14,
        name: 'replaceImagePlaceholder',
        arguments: { targetLayerId: 50, imagePath: replacementPaths.replacedPlaceholder },
        result: {
            success: true,
            documentId: 91,
            layerId: 51,
            targetLayerId: 50,
            historyStateRef: { documentId: 91, historyStateId: 123 }
        }
    },
    {
        name: 'placeImage',
        arguments: { filePath: replacementPaths.originalSmartObject },
        result: {
            success: true,
            layerId: 60,
            historyStateRef: { documentId: 91, historyStateId: 124 }
        }
    },
    {
        callId: 'replace-smart-object-call',
        modelTurn: 15,
        name: 'replaceSmartObjectContents',
        arguments: { layerId: 60, filePath: replacementPaths.replacedSmartObject },
        result: {
            success: true,
            documentId: 91,
            layerId: 60,
            data: { layerId: 60, filePath: replacementPaths.replacedSmartObject },
            historyStateRef: { documentId: 91, historyStateId: 125 }
        }
    },
    {
        name: 'replaceSmartObjectContents',
        arguments: { layerId: 99, filePath: 'E:\\WERKE\\C-1248\\原始图\\无绑定替换.jpg' },
        result: { success: true, layerId: 99 }
    }
]);
check(
    replacementFacts.supportingSourcePlacements.length === 3
        && replacementFacts.supportingSourcePlacements.some((item) => (
            item.sourceTool === 'replaceLayerContent'
                && item.path === replacementPaths.replacedLayer
                && item.layerId === 41
                && item.documentId === 91
        ))
        && replacementFacts.supportingSourcePlacements.some((item) => (
            item.sourceTool === 'replaceImagePlaceholder'
                && item.path === replacementPaths.replacedPlaceholder
                && item.layerId === 51
                && item.documentId === 91
        ))
        && replacementFacts.supportingSourcePlacements.some((item) => (
            item.sourceTool === 'replaceSmartObjectContents'
                && item.path === replacementPaths.replacedSmartObject
                && item.layerId === 60
                && item.documentId === 91
        )),
    '三种替换工具只在真实 document/layer 结果存在时登记新来源',
    JSON.stringify(replacementFacts.supportingSourcePlacements)
);
check(
    !replacementFacts.supportingSourcePlacements.some((item) => (
        Object.values(replacementPaths).filter((value) => /前\.jpg$/u.test(value)).includes(item.path)
    ))
        && !replacementFacts.supportingSourcePlacements.some((item) => /无绑定替换/u.test(item.path)),
    '替换成功后旧图层来源失效，缺 document 绑定的替换结果不冒充新来源',
    JSON.stringify(replacementFacts.supportingSourcePlacements)
);

const finalSupportingSourceSnapshot = {
    success: true,
    hasDocument: true,
    historyStateRef: { documentId: 91, historyStateId: 200 },
    document: { id: 91, name: '主图终稿' },
    summary: {
        totalLayers: 5,
        selectedLayers: 0,
        hiddenLayers: 1,
        lockedLayers: 0,
        textLayers: 0,
        groupLayers: 2,
        smartObjectLayers: 3,
        shapeLayers: 0,
        pixelLayers: 0,
        truncated: false
    },
    layers: [
        { id: 41, name: '可见替换图', kind: 'smartObject', visible: true, locked: false, opacity: 100, depth: 0, index: 0, parentId: null, parentName: null, path: '可见替换图', selected: false },
        { id: 70, name: '隐藏组', kind: 'group', visible: false, locked: false, opacity: 100, depth: 0, index: 1, parentId: null, parentName: null, path: '隐藏组', selected: false },
        { id: 51, name: '隐藏组内替换图', kind: 'smartObject', visible: true, locked: false, opacity: 100, depth: 1, index: 0, parentId: 70, parentName: '隐藏组', path: '隐藏组/隐藏组内替换图', selected: false },
        { id: 71, name: '零透明度组', kind: 'group', visible: true, locked: false, opacity: 0, depth: 0, index: 2, parentId: null, parentName: null, path: '零透明度组', selected: false },
        { id: 60, name: '零透明度组内智能对象', kind: 'smartObject', visible: true, locked: false, opacity: 100, depth: 1, index: 0, parentId: 71, parentName: '零透明度组', path: '零透明度组/零透明度组内智能对象', selected: false }
    ],
    warnings: []
};
const replacementToolLogWithFinalSnapshot = [
    ...[
        {
            name: 'placeImage',
            arguments: { filePath: replacementPaths.originalLayer },
            result: { success: true, layerId: 40, historyStateRef: { documentId: 91, historyStateId: 120 } }
        },
        {
            name: 'replaceLayerContent',
            arguments: { layerId: 40, filePath: replacementPaths.replacedLayer },
            result: { success: true, data: { originalLayerId: 40, newLayerId: 41 }, historyStateRef: { documentId: 91, historyStateId: 121 } }
        },
        {
            name: 'placeImage',
            arguments: { filePath: replacementPaths.originalPlaceholder },
            result: { success: true, layerId: 50, historyStateRef: { documentId: 91, historyStateId: 122 } }
        },
        {
            name: 'replaceImagePlaceholder',
            arguments: { targetLayerId: 50, imagePath: replacementPaths.replacedPlaceholder },
            result: { success: true, documentId: 91, layerId: 51, targetLayerId: 50, historyStateRef: { documentId: 91, historyStateId: 123 } }
        },
        {
            name: 'placeImage',
            arguments: { filePath: replacementPaths.originalSmartObject },
            result: { success: true, layerId: 60, historyStateRef: { documentId: 91, historyStateId: 124 } }
        },
        {
            name: 'replaceSmartObjectContents',
            arguments: { layerId: 60, filePath: replacementPaths.replacedSmartObject },
            result: { success: true, documentId: 91, layerId: 60, historyStateRef: { documentId: 91, historyStateId: 125 } }
        }
    ],
    {
        name: 'getAcceptanceSnapshot',
        arguments: { includeHidden: true, maxLayers: 1000 },
        result: { success: true, snapshot: finalSupportingSourceSnapshot }
    }
];
const visibleSupportingSourceSelection = selectFinalSupportingSourcePlacements({
    toolCallLog: replacementToolLogWithFinalSnapshot,
    historyStateRef: { documentId: 91, historyStateId: 200 },
    maxImages: 1
});
check(
    visibleSupportingSourceSelection.coverage.status === 'complete'
        && visibleSupportingSourceSelection.coverage.finalVisibleSourceCount === 1
        && visibleSupportingSourceSelection.placements.length === 1
        && visibleSupportingSourceSelection.placements[0].path === replacementPaths.replacedLayer,
    '最终 supporting source 只保留当前文档内自身及全部父组均可见、opacity 大于 0 的真实图层绑定',
    JSON.stringify(visibleSupportingSourceSelection)
);

const reflexionChildSnapshotLog = [{
    name: 'getAcceptanceSnapshot',
    arguments: { includeHidden: true, maxLayers: 1000 },
    result: {
        success: true,
        snapshot: {
            ...finalSupportingSourceSnapshot,
            historyStateRef: { documentId: 91, historyStateId: 201 }
        }
    }
}];
const reflexionChildSourceSelection = selectFinalSupportingSourcePlacements({
    toolCallLog: reflexionChildSnapshotLog,
    historyStateRef: { documentId: 91, historyStateId: 201 },
    maxImages: 1,
    priorVerifiedPlacements: visibleSupportingSourceSelection.placements
});
check(
    reflexionChildSourceSelection.coverage.status === 'complete'
        && reflexionChildSourceSelection.placements.length === 1
        && reflexionChildSourceSelection.placements[0].path === replacementPaths.replacedLayer,
    'Reflexion 子代可复用父代已比较来源，但必须在子代同文档、同版本完整快照上重新验证图层',
    JSON.stringify(reflexionChildSourceSelection)
);
check(
    projectFinalSupportingSourceCarryover(
        reflexionChildSnapshotLog,
        { documentId: 91, historyStateId: 201 },
        visibleSupportingSourceSelection.placements,
        false
    ).length === 0,
    '没有进入父代 Final Judge 输入的来源不会被投影给 Reflexion 子代'
);
check(
    projectFinalSupportingSourceCarryover(
        reflexionChildSnapshotLog,
        { documentId: 91, historyStateId: 201 },
        visibleSupportingSourceSelection.placements,
        true
    )[0]?.path === replacementPaths.replacedLayer,
    '只有已进入父代 Final Judge 输入的实际 supporting source 才能形成有界跨代投影'
);

const reflexionReplacementPath = 'E:\\WERKE\\C-1248\\原始图\\子代替换来源.jpg';
const reflexionChildReplacementSelection = selectFinalSupportingSourcePlacements({
    toolCallLog: [
        {
            name: 'replaceSmartObjectContents',
            arguments: { layerId: 41, filePath: reflexionReplacementPath },
            result: {
                success: true,
                documentId: 91,
                layerId: 41,
                historyStateRef: { documentId: 91, historyStateId: 201 }
            }
        },
        {
            name: 'getAcceptanceSnapshot',
            arguments: { includeHidden: true, maxLayers: 1000 },
            result: {
                success: true,
                snapshot: {
                    ...finalSupportingSourceSnapshot,
                    historyStateRef: { documentId: 91, historyStateId: 202 }
                }
            }
        }
    ],
    historyStateRef: { documentId: 91, historyStateId: 202 },
    maxImages: 1,
    priorVerifiedPlacements: visibleSupportingSourceSelection.placements
});
check(
    reflexionChildReplacementSelection.coverage.status === 'complete'
        && reflexionChildReplacementSelection.placements.length === 1
        && reflexionChildReplacementSelection.placements[0].path === reflexionReplacementPath,
    'Reflexion 子代在同一图层真实替换来源时，本代成功 Tool 事实覆盖父代来源而不是继续比较旧图',
    JSON.stringify(reflexionChildReplacementSelection)
);

const secondVisibleSourcePath = 'E:\\WERKE\\C-1248\\原始图\\第二张可见来源.jpg';
const overflowSnapshot = {
    ...finalSupportingSourceSnapshot,
    summary: { ...finalSupportingSourceSnapshot.summary, totalLayers: 6, smartObjectLayers: 4 },
    layers: [
        ...finalSupportingSourceSnapshot.layers,
        { id: 80, name: '第二张可见来源', kind: 'smartObject', visible: true, locked: false, opacity: 100, depth: 0, index: 3, parentId: null, parentName: null, path: '第二张可见来源', selected: false }
    ]
};
const overflowSelection = selectFinalSupportingSourcePlacements({
    toolCallLog: [
        ...replacementToolLogWithFinalSnapshot.slice(0, -1),
        {
            name: 'placeImage',
            arguments: { filePath: secondVisibleSourcePath },
            result: { success: true, layerId: 80, historyStateRef: { documentId: 91, historyStateId: 126 } }
        },
        {
            name: 'getAcceptanceSnapshot',
            arguments: { includeHidden: true, maxLayers: 1000 },
            result: { success: true, snapshot: overflowSnapshot }
        }
    ],
    historyStateRef: { documentId: 91, historyStateId: 200 },
    maxImages: 1
});
check(
    overflowSelection.coverage.status === 'incomplete'
        && overflowSelection.coverage.reasonCodes.includes('visual_capacity_insufficient')
        && overflowSelection.coverage.finalVisibleSourceCount === 2
        && overflowSelection.coverage.projectedSourceCount === 0
        && overflowSelection.placements.length === 0,
    '最终可见来源超过视觉额度时返回 coverage incomplete，不倒序截一张冒充 selected source',
    JSON.stringify(overflowSelection)
);

const unboundSelection = selectFinalSupportingSourcePlacements({
    toolCallLog: [
        {
            name: 'placeImage',
            arguments: { filePath: directPlacedSourcePath },
            result: { success: true }
        },
        {
            name: 'getAcceptanceSnapshot',
            arguments: { includeHidden: true, maxLayers: 1000 },
            result: { success: true, snapshot: finalSupportingSourceSnapshot }
        }
    ],
    historyStateRef: { documentId: 91, historyStateId: 200 },
    maxImages: 3
});
check(
    unboundSelection.coverage.status === 'incomplete'
        && unboundSelection.coverage.reasonCodes.includes('source_binding_missing')
        && unboundSelection.coverage.ignoredUnboundPlacementCount === 1
        && unboundSelection.placements.length === 0,
    '缺 document/layer 绑定的成功置入不冒充当前终稿来源，并显式投影覆盖不完整',
    JSON.stringify(unboundSelection)
);

const mismatchedDocumentSelection = selectFinalSupportingSourcePlacements({
    toolCallLog: replacementToolLogWithFinalSnapshot,
    historyStateRef: { documentId: 92, historyStateId: 200 },
    maxImages: 3
});
check(
    mismatchedDocumentSelection.coverage.status === 'incomplete'
        && mismatchedDocumentSelection.coverage.reasonCodes.includes('acceptance_snapshot_missing')
        && mismatchedDocumentSelection.placements.length === 0,
    '终稿快照必须与当前 document/history 精确绑定，不能跨文档复用旧结构'
);

const supportingImagePayload = buildDesignFinalReviewSupportingImagePayload([{
    sourceId: 'supporting_source:1',
    sourceSlot: 'direct_placement',
    data: 'pixels',
    mediaType: 'image/jpeg'
}]);
check(
    supportingImagePayload.contentBlocks[0]?.type === 'text'
        && /type=final_bound_supporting_source/u.test(supportingImagePayload.contentBlocks[0].text)
        && !/type=selected_source/u.test(supportingImagePayload.contentBlocks[0].text),
    '终审支持图声明为最终可见层绑定来源，不再冒充 Harness 选出的 selected_source'
);

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

console.log('[5b] 同 TaskRun Reflexion 文档创建事实只对同目标生效');
const taskRunIdentity = createRuntimeSessionIdentity({
    now: '2026-08-24T12:00:00.000Z',
    nonce: 'completion-chain-parent'
});
// r9 真实链：父档案 createDocument 创建 documentId=159/history=160；
// 子档案在同一文档把 history 169→172 后保存并读回。
const createdDocumentId = 159;
const parentCreationLog = [{
    name: 'createDocument',
    arguments: { width: 1440, height: 1440 },
    result: {
        success: true,
        documentId: createdDocumentId,
        photoshopMutationCommit: {
            version: 'photoshop-mutation-commit/v1',
            basis: 'same_execute_as_modal',
            bindingStrength: 'unguarded',
            changeKind: 'document_creation',
            beforeOpenDocumentIds: [],
            createdDocumentId,
            after: {
                documentId: createdDocumentId,
                historyStateId: 160,
                activeLayerId: 1
            },
            toolActionCompleted: true,
            mutationObserved: true,
            documentChanged: true
        }
    }
}];
const taskRunCreationEvidence = extendTaskRunDocumentCreationEvidence({
    identity: taskRunIdentity,
    toolCallLog: parentCreationLog
});
const buildChildMutationLog = (documentId) => [{
    name: 'transformLayer',
    arguments: { layerId: 88, expectedDocumentId: documentId },
    result: {
        success: true,
        documentId,
        photoshopMutationCommit: {
            version: 'photoshop-mutation-commit/v1',
            basis: 'same_execute_as_modal',
            bindingStrength: 'document_revision',
            before: { documentId, historyStateId: 169, activeLayerId: 88 },
            after: { documentId, historyStateId: 172, activeLayerId: 88 },
            toolActionCompleted: true,
            mutationObserved: true,
            documentChanged: false
        }
    }
}, {
    name: 'getDocumentInfo',
    arguments: { expectedDocumentId: documentId },
    result: {
        success: true,
        documentId,
        historyStateRef: { documentId, historyStateId: 172 }
    }
}];
const mainImageProfile = getDesignEvaluationProfileById(MAIN_IMAGE_EVALUATION_PROFILE_ID);
const incompleteProfileResult = evaluateDesignEvaluationProfile({
    profile: mainImageProfile,
    assertionResults: [],
    verificationRecords: []
});
const profileContractContext = {
    agenticArtifactContract: {
        version: 'agentic-artifact-completion-contract/v0',
        skillId: 'main-image-design',
        taskType: 'main_image',
        workMode: 'create_new',
        deliveryOutputs: [],
        exitCriteria: []
    }
};
function buildProfileChildContract(documentId, taskRunDocumentCreation) {
    return buildTaskCompletionContract({
        task: '继续优化当前主图并保存',
        context: {
            ...profileContractContext,
            ...(taskRunDocumentCreation ? { taskRunDocumentCreation } : {})
        },
        toolCallLog: buildChildMutationLog(documentId),
        evaluationProfile: mainImageProfile,
        evaluationProfileResult: incompleteProfileResult
    });
}
function readProductionDocumentRequirement(contract) {
    return contract.required.find((requirement) => requirement.id === 'production-document');
}
const childWithoutChainEvidence = buildProfileChildContract(createdDocumentId);
check(
    readProductionDocumentRequirement(childWithoutChainEvidence).status === 'failed',
    '子 generation 单独看 createdDocumentCount=0 时可复现 production-document 误判'
);
const childWithSameTargetEvidence = buildProfileChildContract(createdDocumentId, {
    taskRunId: taskRunIdentity.sessionId,
    generation: taskRunIdentity.generation,
    evidence: taskRunCreationEvidence
});
const sameTargetProductionDocument = readProductionDocumentRequirement(childWithSameTargetEvidence);
check(
    sameTargetProductionDocument.status === 'passed'
        && sameTargetProductionDocument.actual.currentTaskRunCreatedDocumentCount === 0
        && sameTargetProductionDocument.actual.taskChainCreatedDocumentCount === 1,
    '同一授权 TaskRun、同一目标文档继承父 generation 的 Host 创建事实',
    JSON.stringify(sameTargetProductionDocument)
);
const childWithDifferentTarget = buildProfileChildContract(createdDocumentId + 1, {
    taskRunId: taskRunIdentity.sessionId,
    generation: taskRunIdentity.generation,
    evidence: taskRunCreationEvidence
});
check(
    readProductionDocumentRequirement(childWithDifferentTarget).status === 'failed',
    '父 generation 创建事实不能替另一个目标文档补 production-document'
);
const childWithDifferentTaskRun = buildProfileChildContract(createdDocumentId, {
    taskRunId: 'runtime-session-other-task',
    generation: taskRunIdentity.generation,
    evidence: taskRunCreationEvidence
});
check(
    readProductionDocumentRequirement(childWithDifferentTaskRun).status === 'failed',
    '父 generation 创建事实不能跨 TaskRun 复用'
);
const forgedEvidence = JSON.parse(JSON.stringify(taskRunCreationEvidence));
const childWithForgedEvidence = buildProfileChildContract(createdDocumentId, {
    taskRunId: taskRunIdentity.sessionId,
    generation: taskRunIdentity.generation,
    evidence: forgedEvidence
});
check(
    readProductionDocumentRequirement(childWithForgedEvidence).status === 'failed',
    '序列化 Run Record /项目记忆形状不能冒充 Runtime-owned 创建收据'
);
check(
    childWithSameTargetEvidence.status !== 'completed'
        && childWithSameTargetEvidence.completion.artifactStatus === 'artifact_incomplete',
    '创建事实修复不改写未通过的质量 Profile',
    JSON.stringify({
        status: childWithSameTargetEvidence.status,
        completion: childWithSameTargetEvidence.completion
    })
);

console.log('[5c] Completion 只消费当前未闭合义务，旧尝试保留但不污染终态');
const completionDocumentId = 915;
function completionHistoryState(historyStateId) {
    return { documentId: completionDocumentId, historyStateId, activeLayerId: 42 };
}
function completionTextRead(historyStateId) {
    return {
        name: 'getTextContent',
        arguments: { layerId: 42, expectedDocumentId: completionDocumentId },
        result: {
            success: true,
            documentId: completionDocumentId,
            historyStateRef: completionHistoryState(historyStateId),
            text: '新品上市'
        }
    };
}
function completionTextMutation(input) {
    const result = input.success
        ? {
            success: true,
            documentId: completionDocumentId,
            photoshopMutationCommit: {
                version: 'photoshop-mutation-commit/v1',
                basis: 'same_execute_as_modal',
                bindingStrength: 'document_revision',
                before: completionHistoryState(input.before),
                after: completionHistoryState(input.after),
                toolActionCompleted: true
            },
            ...(input.acceptance ? { acceptance: input.acceptance } : {})
        }
        : {
            success: false,
            documentId: completionDocumentId,
            error: 'fixture write rejected',
            ...(input.acceptance ? { acceptance: input.acceptance } : {})
        };
    return {
        name: 'setTextContent',
        arguments: {
            layerId: input.layerId || 42,
            expectedDocumentId: completionDocumentId,
            text: input.text
        },
        result
    };
}
function completionAcceptance(input) {
    return {
        enabled: true,
        toolName: 'setTextContent',
        status: 'collected',
        verified: input.status === 'passed',
        noDocumentChangeRisk: input.noDocumentChangeRisk === true,
        before: { historyStateRef: completionHistoryState(input.before) },
        after: { historyStateRef: completionHistoryState(input.after) },
        assertionStatus: input.status,
        warnings: []
    };
}
function buildTextCompletion(toolCallLog) {
    return buildTaskCompletionContract({
        task: '把标题文字改成新品上市',
        toolCallLog
    });
}

const retryArguments = {
    layerId: 42,
    expectedDocumentId: completionDocumentId,
    text: '新品上市'
};
const repairedRetryContract = buildTextCompletion([
    completionTextRead(10),
    {
        name: 'setTextContent',
        arguments: retryArguments,
        result: {
            success: false,
            documentId: completionDocumentId,
            error: 'first attempt failed',
            acceptance: completionAcceptance({ before: 10, after: 10, status: 'failed' })
        }
    },
    completionTextMutation({
        success: true,
        before: 10,
        after: 11,
        text: retryArguments.text
    }),
    completionTextRead(11)
]);
check(
    repairedRetryContract.status === 'completed'
        && repairedRetryContract.required.every((item) => item.status === 'passed')
        && repairedRetryContract.blockers.length === 0,
    '同 Tool、同参数、同文档的后续成功取代早期失败，最终读回后完成',
    JSON.stringify(repairedRetryContract)
);

const differentTargetFailureContract = buildTextCompletion([
    completionTextRead(20),
    completionTextMutation({ success: false, layerId: 41, text: '另一个标题' }),
    completionTextMutation({ success: true, before: 20, after: 21, layerId: 42, text: '新品上市' }),
    completionTextRead(21)
]);
check(
    differentTargetFailureContract.status === 'failed'
        && differentTargetFailureContract.blockers.some((item) => /文字修改工具失败/.test(item)),
    '不同目标的后续成功不能抹去另一项未解决失败',
    JSON.stringify(differentTargetFailureContract)
);

const supersededAcceptanceContract = buildTextCompletion([
    completionTextRead(30),
    completionTextMutation({
        success: true,
        before: 30,
        after: 31,
        text: '草稿标题',
        acceptance: completionAcceptance({ before: 30, after: 31, status: 'failed' })
    }),
    completionTextMutation({
        success: true,
        before: 31,
        after: 32,
        text: '新品上市',
        acceptance: completionAcceptance({ before: 31, after: 32, status: 'passed' })
    }),
    completionTextRead(32)
]);
check(
    supersededAcceptanceContract.status === 'completed'
        && supersededAcceptanceContract.verification.toolAcceptance.failed === 0,
    '旧 Photoshop revision 的 acceptance 仍留在日志，但不阻断最新已验证 revision',
    JSON.stringify(supersededAcceptanceContract)
);

const warningOnlyContract = buildTextCompletion([
    completionTextRead(40),
    completionTextMutation({
        success: true,
        before: 40,
        after: 41,
        text: '新品上市',
        acceptance: completionAcceptance({
            before: 40,
            after: 41,
            status: 'needs_review',
            noDocumentChangeRisk: true
        })
    }),
    completionTextRead(41)
]);
check(
    warningOnlyContract.status === 'completed'
        && warningOnlyContract.required.every((item) => item.status === 'passed')
        && warningOnlyContract.warnings.length > 0,
    'warning 保留诊断信息，但没有结构化未完成 requirement 时不单独降级终态',
    JSON.stringify(warningOnlyContract)
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
        && /质量检查没有取得完整结论/.test(unverifiedQualityMessage)
        && !/仍需复核|仍待复核|结果需要复核/.test(unverifiedQualityMessage),
    '产物完成但质量未评价时保留设计说明，移除质量误报，也不把检查缺口伪装成人工复核终态',
    unverifiedQualityMessage
);
const deliverableSoftQualityMessage = alignUserVisibleCompletionMessage({
    message: 'PSD 与 JPEG 已保存，质量通过，这版已经可以直接用了。',
    executionStatus: 'completed',
    requirements: [],
    designVerdict: { status: 'needs_review' }
});
check(
    /PSD 与 JPEG 已保存/.test(deliverableSoftQualityMessage)
        && !/质量通过|可以直接用/.test(deliverableSoftQualityMessage.split('\n\n')[0])
        && /可继续优化的建议/.test(deliverableSoftQualityMessage)
        && /不影响本次交付/.test(deliverableSoftQualityMessage)
        && !/仍需复核|仍待复核|结果需要复核/.test(deliverableSoftQualityMessage),
    '已闭合交付上的非阻断质量 finding 只投影为可选改进，不重新制造待复核终态',
    deliverableSoftQualityMessage
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
check(
    resolveAgentExecutionPresentationDisposition({
        resultSuccess: false,
        executionStatus: 'needs_review'
    }) === 'result'
        && resolveAgentExecutionPresentationDisposition({
            resultSuccess: true,
            executionStatus: 'failed'
        }) === 'failure'
        && resolveAgentExecutionPresentationDisposition({
            resultSuccess: false
        }) === 'failure',
    'UI 以结构化执行状态区分待复核结果与真实失败，不用顶层 success 抹平语义'
);
const nonResultQualityProjectionCases = [
    {
        executionStatus: 'awaiting_confirmation',
        message: '正在等待你确认规格。'
    },
    {
        executionStatus: 'failed',
        message: 'Photoshop 连接中断，本轮没有写入画面。'
    },
    {
        executionStatus: 'cancelled',
        message: '任务已按你的要求停止。'
    }
];
check(
    nonResultQualityProjectionCases.every((item) => (
        alignUserVisibleCompletionMessage({
            message: item.message,
            executionStatus: item.executionStatus,
            requirements: [],
            designVerdict: { status: 'needs_review' }
        }) === item.message
    )),
    '等待确认、真实失败与取消只投影各自结构化终态，不混入旧质量裁决的待复核文案'
);
const failedWithMissingDeliverableMessage = alignUserVisibleCompletionMessage({
    message: 'Photoshop 连接中断，本轮没有写入画面。',
    executionStatus: 'failed',
    requirements: [{
        id: 'user-deliverable:main-image',
        status: 'failed',
        expected: { label: '主图' }
    }],
    designVerdict: { status: 'passed_unverified' }
});
check(
    failedWithMissingDeliverableMessage.includes('“主图”还没有逐项取得可核对的交付结果')
        && !/仍需复核|仍待复核|专业设计质量评价/.test(failedWithMissingDeliverableMessage),
    '真实失败仍保留结构化缺失交付物，但不被历史质量状态改写成待复核'
);
const colonNeedsReviewQualityMessage = alignUserVisibleCompletionMessage({
    message: '主图已完成视觉复核：PSD 和 JPG 已保存。',
    executionStatus: 'needs_review',
    requirements: [],
    designVerdict: { status: 'needs_review' }
});
check(
    !/已完成视觉复核/.test(colonNeedsReviewQualityMessage)
        && /PSD 和 JPG 已保存/.test(colonNeedsReviewQualityMessage)
        && /当前设计质量仍待复核/.test(colonNeedsReviewQualityMessage),
    'needs_review 能清理中文冒号后的无依据复核声明，同时保留真实文件事实',
    colonNeedsReviewQualityMessage
);
const deliveredNeedsReviewQualityMessage = alignUserVisibleCompletionMessage({
    message: '主图已完成复核并交付：可编辑 PSD 与高质量 JPEG 均已保存。',
    executionStatus: 'needs_review',
    requirements: [],
    designVerdict: { status: 'needs_review' }
});
check(
    deliveredNeedsReviewQualityMessage.includes('主图已交付：可编辑 PSD 与高质量 JPEG 均已保存')
        && !deliveredNeedsReviewQualityMessage.includes('完成复核')
        && /当前设计质量仍待复核/.test(deliveredNeedsReviewQualityMessage),
    'needs_review 对齐“完成复核并交付”，只保留真实交付事实并说明质量仍待复核',
    deliveredNeedsReviewQualityMessage
);
for (const unrecognizedCompletionClaim of [
    '主图复核工作已经结束，PSD 已保存。',
    '主图审核完毕，文件已经交付。',
    '我已检查完最终画面并交付。',
    '主图处理好了，已经复核并交付。'
]) {
    const alignedUnknownClaim = alignUserVisibleCompletionMessage({
        message: unrecognizedCompletionClaim,
        executionStatus: 'needs_review',
        requirements: [],
        designVerdict: { status: 'needs_review' }
    });
    check(
        /当前设计质量仍待复核/.test(alignedUnknownClaim)
            && /尚不能据此确认画面质量通过或可直接使用/.test(alignedUnknownClaim),
        '未被正则枚举的新完成措辞仍必须附带结构化待复核事实',
        alignedUnknownClaim
    );
}
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
    const alignedPreservedMessage = alignUserVisibleCompletionMessage({
        message: preservedMessage,
        executionStatus: 'completed',
        designVerdict: { status: 'passed_unverified' }
    });
    check(
        alignedPreservedMessage.includes(preservedMessage),
        '技术复核、限定用途、引语与文件名不被误删；必要时只追加结构化质量状态',
        alignedPreservedMessage
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
        && alignedMixedQualityMessage.includes('质量检查没有取得完整结论'),
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
        && alignedQualifiedThenUnconditionalMessage.includes('质量检查没有取得完整结论'),
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

let unboundAccounting = createRuntimeAccountingLedger('2026-08-24T00:00:00.000Z');
unboundAccounting = recordRuntimeModelCall({
    ledger: unboundAccounting,
    durationMs: 1200,
    succeeded: true,
    usage: { inputTokens: 321, outputTokens: 45 },
    promptShape: {
        systemChars: 100,
        historyChars: 200,
        messageCount: 3,
        imageBlocks: 1,
        toolCount: 2,
        toolSchemaChars: 300
    },
    now: '2026-08-24T00:00:01.200Z'
});
unboundAccounting = recordRuntimeModelCall({
    ledger: unboundAccounting,
    durationMs: 300,
    succeeded: false,
    promptShape: {
        systemChars: 100,
        historyChars: 240,
        messageCount: 4,
        imageBlocks: 0,
        toolCount: 2,
        toolSchemaChars: 300
    },
    now: '2026-08-24T00:00:01.500Z'
});
unboundAccounting = recordRuntimeToolCall({
    ledger: unboundAccounting,
    durationMs: 80,
    succeeded: true,
    now: '2026-08-24T00:00:01.580Z'
});
unboundAccounting = recordRuntimePerformanceUsage({
    ledger: unboundAccounting,
    usage: {
        modelCalls: 2,
        toolCalls: 1,
        iterations: 2,
        visionCandidates: 1,
        visualAnalyses: 1,
        activeElapsedMs: 1580,
        observationKeys: ['visual:test-1']
    },
    now: '2026-08-24T00:00:01.580Z'
});
const unboundAccountingDigest = buildRuntimeAccountingDigest({
    ledger: unboundAccounting,
    now: '2026-08-24T00:00:01.580Z'
});
const clonedUnboundAccounting = cloneRuntimeAccountingLedger(unboundAccounting);
clonedUnboundAccounting.stageBuckets[0].modelCallCount = 999;
clonedUnboundAccounting.performanceUsage.observationKeys.push('visual:clone-only');
clonedUnboundAccounting.promptShapeSamples[0].systemChars = 999;
check(
    unboundAccounting.stageBuckets[0].modelCallCount === 2
        && !unboundAccounting.performanceUsage.observationKeys.includes('visual:clone-only')
        && unboundAccounting.promptShapeSamples[0].systemChars === 100,
    'Runtime Accounting 转移使用深拷贝，不让旧 owner 与新 Session 并行共享可变引用'
);
const accountingSeedIdentity = createRuntimeSessionIdentity({
    now: '2026-08-24T00:00:01.580Z',
    nonce: 'accounting-seed-test',
    skillId: 'accounting-test-skill',
    taskType: 'design.generic'
});
const accountingSeedPlan = {
    version: 'runtime-stage-plan/v0',
    skillId: 'accounting-test-skill',
    taskType: 'design.generic',
    requiredInputs: [],
    optionalInputs: [],
    inputSources: {},
    deliveryOutputs: [],
    steps: [{
        stage: 'R0',
        owner: 'R0',
        objective: '绑定测试 Runtime',
        requiredOutcomes: [],
        allowedToolCapabilities: [],
        failureTarget: 'continue_react'
    }],
    onDemandCapabilityExpansionAllowed: true,
    exitCriteria: []
};
const accountingSeedSession = createRuntimeSession({
    identity: accountingSeedIdentity,
    plan: accountingSeedPlan,
    accountingSeed: unboundAccounting
});
check(
    accountingSeedSession.accounting.modelCallCount === 2
        && accountingSeedSession.accounting.modelDurationMs === 1500
        && accountingSeedSession.accounting.promptShapeSamples?.[0]?.stage === 'unscoped',
    'plan-neutral 会计作为同类型 seed 转移到 staged Session，不补造 0ms 调用'
);

const activeAccounting = new ActiveRuntimeAccounting();
activeAccounting.beginRun(Date.parse('2026-08-24T00:01:00.000Z'), undefined);
activeAccounting.recordModelCall(undefined, {
    durationMs: 420,
    succeeded: true,
    usage: { inputTokens: 40, outputTokens: 8 },
    promptShape: {
        systemChars: 20,
        historyChars: 60,
        messageCount: 2,
        imageBlocks: 0,
        toolCount: 1,
        toolSchemaChars: 90
    }
});
const lifecycleTransferSeed = activeAccounting.readUnboundLedgerForTransfer();
const lifecycleIdentity = createRuntimeSessionIdentity({
    now: '2026-08-24T00:01:00.420Z',
    nonce: 'active-accounting-lifecycle',
    skillId: 'accounting-test-skill',
    taskType: 'design.generic'
});
let lifecycleSession = createRuntimeSession({
    identity: lifecycleIdentity,
    plan: accountingSeedPlan,
    accountingSeed: lifecycleTransferSeed
});
activeAccounting.releaseUnboundLedgerAfterBinding();
lifecycleSession = activeAccounting.recordModelCall(lifecycleSession, {
    durationMs: 75,
    succeeded: false
});
lifecycleSession = activeAccounting.recordToolCall(lifecycleSession, {
    durationMs: 25,
    succeeded: true
});
const lifecycleDigest = activeAccounting.readDigest(lifecycleSession);
check(
    lifecycleTransferSeed?.modelCallCount === 1
        && lifecycleTransferSeed.toolCallCount === 0
        && activeAccounting.readUnboundLedgerForTransfer() === undefined
        && lifecycleSession?.accounting.modelCallCount === 2
        && lifecycleSession.accounting.modelFailureCount === 1
        && lifecycleSession.accounting.toolCallCount === 1
        && lifecycleDigest?.modelDurationMs === 495
        && lifecycleDigest.toolDurationMs === 25,
    'ActiveRuntimeAccounting 完成 unbound → late-bind → release 生命周期且绑定后只写 Session owner'
);

const longObservationKey = `visual:C:\\project\\${'deep-directory\\'.repeat(32)}product.png@history-123`;
let longObservationLedger = createRuntimeAccountingLedger('2026-08-24T00:02:00.000Z');
longObservationLedger = recordRuntimePerformanceUsage({
    ledger: longObservationLedger,
    usage: {
        visionCandidates: 1,
        observationKeys: [longObservationKey]
    },
    now: '2026-08-24T00:02:00.010Z'
});
const longObservationDigest = buildRuntimeAccountingDigest({
    ledger: longObservationLedger,
    now: '2026-08-24T00:02:00.010Z'
});
const projectedObservationKey = longObservationDigest.performanceUsage.observationKeys[0];
check(
    longObservationKey.length > 240
        && longObservationLedger.performanceUsage.observationKeys[0] === longObservationKey
        && /^runtime-observation-sha256-v1:[0-9a-f]{64}$/.test(projectedObservationKey)
        && projectedObservationKey !== longObservationKey,
    '超长视觉去重键只在 digest 边界稳定哈希，活动预算账本仍保留原键'
);
const unboundAccountingRecord = buildAgentRunRecord({
    now: '2026-08-24T00:00:01.580Z',
    goal: '普通开放设计任务',
    result: {
        success: false,
        iterations: 2,
        stopReason: 'error',
        toolCallLog: [],
        executionSummary: {
            status: 'failed',
            blockers: [],
            warnings: [],
            runtimeAccountingDigest: unboundAccountingDigest
        }
    }
});
check(
    unboundAccountingRecord.runtimeAccounting?.modelCallCount === 2
        && unboundAccountingRecord.runtimeAccounting?.modelFailureCount === 1
        && unboundAccountingRecord.runtimeAccounting?.modelDurationMs === 1500
        && unboundAccountingRecord.runtimeAccounting?.toolDurationMs === 80
        && unboundAccountingRecord.runtimeAccounting?.unreportedUsageCallCount === 1
        && unboundAccountingRecord.runtimeAccounting?.promptShapeSamples?.length === 2
        && unboundAccountingRecord.boundaries.runtimeAccountingDigestOnly === true
        && !unboundAccountingRecord.runtimeSession,
    'plan-neutral Run Record 持久化 observation-only Runtime Accounting'
);
check(
    validateAgentRunRecordForPersist(unboundAccountingRecord).ok,
    '合法的 plan-neutral Runtime Accounting 通过持久化校验'
);

const resolvedAgenticRuntimeContractStatus = buildRuntimeContractStatus({
    selectedTaskType: 'ecommerce.main_image.v1',
    manifestSkillId: 'ecommerce.main_image',
    selectionSource: 'explicit_runtime_declaration',
    selectionExpected: true
});
const agenticManifestBoundRecord = buildAgentRunRecord({
    now: '2026-08-24T00:00:01.590Z',
    goal: '普通自然语言声明后制作商品主图',
    controlPlane: {
        requestKind: 'autonomous_execution',
        route: 'autonomous_agent'
    },
    runtimeContractStatus: resolvedAgenticRuntimeContractStatus,
    result: {
        success: false,
        iterations: 2,
        stopReason: 'error',
        toolCallLog: [],
        executionSummary: {
            status: 'failed',
            blockers: [],
            warnings: [],
            runtimeAccountingDigest: unboundAccountingDigest
        }
    }
});
check(
    agenticManifestBoundRecord.runtimeContractStatus?.status === 'resolved'
        && agenticManifestBoundRecord.runtimeContractStatus?.selectedTaskType === 'ecommerce.main_image.v1'
        && agenticManifestBoundRecord.runtimeContractStatus?.manifestSkillId === 'ecommerce.main_image'
        && agenticManifestBoundRecord.runtimeContractStatus?.selectionSource === 'explicit_runtime_declaration'
        && agenticManifestBoundRecord.boundaries.runtimeContractStatusDigestOnly === true
        && agenticManifestBoundRecord.runtimeAccounting?.stageBuckets.every((bucket) => bucket.stage === 'unscoped')
        && !agenticManifestBoundRecord.runtimeSession
        && agenticManifestBoundRecord.decision?.skillId === undefined
        && validateAgentRunRecordForPersist(agenticManifestBoundRecord).ok,
    'agentic resolved Manifest 身份与 unscoped accounting 同时持久化且不改 initial decision'
);

const agenticBindingWithoutBoundary = JSON.parse(JSON.stringify(agenticManifestBoundRecord));
delete agenticBindingWithoutBoundary.boundaries.runtimeContractStatusDigestOnly;
check(
    !validateAgentRunRecordForPersist(agenticBindingWithoutBoundary).ok,
    'runtimeContractStatus 缺 digest-only 边界时拒绝持久化'
);

const agenticBindingWithPermissionEscalation = JSON.parse(JSON.stringify(agenticManifestBoundRecord));
agenticBindingWithPermissionEscalation.runtimeContractStatus.boundaries.doesNotGrantToolPermission = false;
check(
    !validateAgentRunRecordForPersist(agenticBindingWithPermissionEscalation).ok,
    'runtimeContractStatus 试图取得 Tool 权限时拒绝持久化'
);

const agenticBindingWithRawPayload = JSON.parse(JSON.stringify(agenticManifestBoundRecord));
agenticBindingWithRawPayload.runtimeContractStatus.payload = { task: '不应进入运行档案' };
check(
    !validateAgentRunRecordForPersist(agenticBindingWithRawPayload).ok,
    'runtimeContractStatus 出现未声明正文载荷时拒绝持久化'
);

const stagedFailureRecord = buildAgentRunRecord({
    now: '2026-08-24T00:00:01.580Z',
    goal: '已绑定 Runtime 后 Provider 失败',
    runtimeSessionIdentity: accountingSeedIdentity,
    result: {
        success: false,
        iterations: 2,
        stopReason: 'error',
        toolCallLog: [],
        executionSummary: {
            status: 'failed',
            blockers: [],
            warnings: [],
            runtimeAccountingDigest: unboundAccountingDigest
        }
    }
});
check(
    stagedFailureRecord.runId === accountingSeedIdentity.runId
        && stagedFailureRecord.runtimeAccounting?.modelCallCount === 2
        && stagedFailureRecord.boundaries.runtimeAccountingDigestOnly === true
        && !stagedFailureRecord.runtimeSession
        && validateAgentRunRecordForPersist(stagedFailureRecord).ok,
    'staged identity 已签发但 Session digest 缺失时，失败档案保留顶层 Runtime Accounting'
);

const accountingSeedSessionDigest = buildRuntimeSessionDigest({
    session: accountingSeedSession,
    plan: accountingSeedPlan
});
const stagedDigestRecord = buildAgentRunRecord({
    now: '2026-08-24T00:00:01.580Z',
    goal: '已有完整 Runtime Session digest',
    runtimeSessionIdentity: accountingSeedIdentity,
    result: {
        success: false,
        iterations: 2,
        stopReason: 'error',
        toolCallLog: [],
        executionSummary: {
            status: 'failed',
            blockers: [],
            warnings: [],
            runtimeSessionDigest: accountingSeedSessionDigest,
            runtimeAccountingDigest: unboundAccountingDigest
        }
    }
});
check(
    stagedDigestRecord.runtimeSession?.accounting.modelCallCount === 2
        && !stagedDigestRecord.runtimeAccounting
        && stagedDigestRecord.boundaries.runtimeAccountingDigestOnly !== true
        && validateAgentRunRecordForPersist(stagedDigestRecord).ok,
    '已有 runtimeSession.accounting 时忽略顶层候选，持久化 owner 保持互斥'
);

const longObservationRecord = buildAgentRunRecord({
    now: '2026-08-24T00:02:00.010Z',
    goal: '复杂视觉路径计量',
    result: {
        success: false,
        iterations: 0,
        stopReason: 'error',
        toolCallLog: [],
        executionSummary: {
            status: 'failed',
            blockers: [],
            warnings: [],
            runtimeAccountingDigest: longObservationDigest
        }
    }
});
check(
    validateAgentRunRecordForPersist(longObservationRecord).ok
        && !JSON.stringify(longObservationRecord).includes(longObservationKey),
    '超长视觉观察键不会让 Run Record 丢失，也不会把原始路径写入长期档案'
);

const accountingWithoutBoundary = JSON.parse(JSON.stringify(unboundAccountingRecord));
delete accountingWithoutBoundary.boundaries.runtimeAccountingDigestOnly;
check(
    !validateAgentRunRecordForPersist(accountingWithoutBoundary).ok,
    'runtimeAccounting 缺 digest-only 边界时拒绝持久化'
);

const accountingWithRawContent = JSON.parse(JSON.stringify(unboundAccountingRecord));
accountingWithRawContent.runtimeAccounting.prompt = '不应进入运行档案';
check(
    !validateAgentRunRecordForPersist(accountingWithRawContent).ok,
    'runtimeAccounting 出现未声明正文或诊断字段时拒绝持久化'
);

const accountingWithInvalidTruthBoundary = JSON.parse(JSON.stringify(unboundAccountingRecord));
accountingWithInvalidTruthBoundary.runtimeAccounting.boundaries.enforcesBudget = true;
check(
    !validateAgentRunRecordForPersist(accountingWithInvalidTruthBoundary).ok,
    'runtimeAccounting 试图取得预算权时拒绝持久化'
);

function buildRolledBackLayerOperationResult(toolName, layerId, historyStateId) {
    return {
        version: 'photoshop-operation-result/v1',
        operationId: `${toolName}:fixture:${layerId}:${historyStateId}`,
        toolName,
        status: 'failed',
        applicationStatus: 'not_applied',
        transactionState: 'rolled_back',
        effect: 'rolled_back',
        rollback: { attempted: true, verified: true },
        before: { documentId: 90, historyStateId, activeLayerId: layerId },
        after: { documentId: 90, historyStateId, activeLayerId: layerId }
    };
}

const r7StructureToolLog = [
    {
        name: 'placeImage',
        arguments: { sourcePath: 'C:\\Users\\example\\Desktop\\private-source.jpg' },
        result: { success: true, layerId: 2, historyStateRef: { documentId: 90, historyStateId: 1 } }
    },
    {
        name: 'createTextLayer',
        arguments: { content: '花边短袜', fontSize: 96 },
        result: { success: true, layerId: 3, historyStateRef: { documentId: 90, historyStateId: 2 } }
    },
    {
        name: 'createTextLayer',
        arguments: { content: '柔和多色 · 花边袜口', fontSize: 40 },
        result: { success: true, layerId: 4, historyStateRef: { documentId: 90, historyStateId: 3 } }
    },
    {
        name: 'setTextContent',
        arguments: { layerId: 4, content: '' },
        result: {
            success: false,
            code: 'photoshop_operation_verification_failed',
            error: '写后逐层读回不一致',
            historyStateRef: { documentId: 90, historyStateId: 3 },
            photoshopOperationResult: buildRolledBackLayerOperationResult(
                'setTextContent',
                4,
                3
            )
        }
    },
    {
        name: 'setTextStyle',
        arguments: { layerId: 4, fontSize: 1 },
        result: {
            success: true,
            layerId: 4,
            historyStateRef: { documentId: 90, historyStateId: 4 }
        }
    }
];
const r7AcceptanceSnapshot = {
    success: true,
    hasDocument: true,
    historyStateRef: { documentId: 90, historyStateId: 4 },
    document: { id: 90, name: '主图', width: 1440, height: 1440 },
    summary: {
        totalLayers: 4,
        selectedLayers: 1,
        hiddenLayers: 0,
        lockedLayers: 1,
        textLayers: 2,
        groupLayers: 0,
        smartObjectLayers: 1,
        shapeLayers: 0,
        pixelLayers: 1,
        truncated: false
    },
    layers: [
        {
            id: 3,
            name: '标题·花边短袜',
            kind: 'text',
            visible: true,
            locked: false,
            opacity: 100,
            depth: 0,
            index: 0,
            parentId: null,
            parentName: null,
            path: '标题·花边短袜',
            selected: false,
            bounds: { left: 90, top: 90, right: 600, bottom: 210, width: 510, height: 120 },
            text: { content: '花边短袜', length: 4, style: { fontSize: 96 } }
        },
        {
            id: 4,
            name: '说明·柔和多色花边袜口',
            kind: 'text',
            visible: true,
            locked: false,
            opacity: 100,
            depth: 0,
            index: 1,
            parentId: null,
            parentName: null,
            path: '说明·柔和多色花边袜口',
            selected: true,
            bounds: { left: 90, top: 225, right: 100, bottom: 227, width: 10, height: 2 },
            text: { content: '柔和多色 · 花边袜口', length: 11, style: { fontSize: 1 } }
        },
        {
            id: 2,
            name: '主体摄影',
            kind: 'smartObject',
            visible: true,
            locked: false,
            opacity: 100,
            depth: 0,
            index: 2,
            parentId: null,
            parentName: null,
            path: '主体摄影',
            selected: false,
            bounds: { left: 0, top: 0, right: 1440, bottom: 1440, width: 1440, height: 1440 }
        },
        {
            id: 1,
            name: '背景',
            kind: 'background',
            visible: true,
            locked: true,
            opacity: 100,
            depth: 0,
            index: 3,
            parentId: null,
            parentName: null,
            path: '背景',
            selected: false,
            bounds: { left: 0, top: 0, right: 1440, bottom: 1440, width: 1440, height: 1440 }
        }
    ],
    warnings: []
};
const r7StructureConcernReport = detectDesignArtifactStructureConcerns({
    toolCallLog: r7StructureToolLog,
    acceptanceSnapshot: r7AcceptanceSnapshot
});
const r7AbandonedTextConcern = r7StructureConcernReport.concerns.find((concern) => (
    concern.kind === 'abandoned-visible-content-after-failed-clear'
));
check(
    r7StructureConcernReport.coverage.status === 'complete'
        && r7StructureConcernReport.concerns.length === 1
        && r7AbandonedTextConcern?.status === 'needs_review'
        && r7AbandonedTextConcern?.evidenceId === 'structure:abandoned-visible-content-after-failed-clear:document-90:layer-4'
        && r7AbandonedTextConcern?.layerRef?.documentId === 90
        && r7AbandonedTextConcern?.layerRef?.id === 4
        && r7AbandonedTextConcern?.facts.includes('clear_attempt_failed')
        && r7AbandonedTextConcern?.facts.includes('same_layer_style_changed_after_failure')
        && r7AbandonedTextConcern?.measurements?.createdFontSize === 40
        && r7AbandonedTextConcern?.measurements?.latestRequestedFontSize === 1
        && r7AbandonedTextConcern?.measurements?.requestedToCreatedFontScaleRatio === 0.025
        && r7AbandonedTextConcern?.measurements?.finalBounds?.width === 10
        && r7AbandonedTextConcern?.measurements?.finalBoundsAreaToCanvasRatio > 0
        && r7AbandonedTextConcern?.measurements?.canvas?.width === 1440,
    'r7 同层创建→清空失败→继续改样式→最终仍可见非空的关系链产生 needs_review concern',
    JSON.stringify(r7StructureConcernReport)
);
check(
    r7StructureConcernReport.boundaries.doesNotMutateDocument === true
        && r7StructureConcernReport.boundaries.doesNotChooseDesignOutcome === true
        && r7StructureConcernReport.boundaries.requiresJudgeInterpretation === true
        && !JSON.stringify(r7StructureConcernReport).includes('private-source.jpg')
        && !JSON.stringify(r7StructureConcernReport).includes('柔和多色 · 花边袜口'),
    '结构 concern 只输出有界事实，不泄露素材绝对路径、文字正文或取得自动修改权'
);

const unboundStructureConcernReport = detectDesignArtifactStructureConcerns({
    toolCallLog: r7StructureToolLog.map((entry) => ({
        ...entry,
        result: {
            ...entry.result,
            documentId: undefined,
            historyStateRef: undefined,
            photoshopOperationResult: undefined
        }
    })),
    acceptanceSnapshot: r7AcceptanceSnapshot
});
check(
    !unboundStructureConcernReport.concerns.some((concern) => (
        concern.kind === 'abandoned-visible-content-after-failed-clear'
            || concern.kind === 'concealed-content-after-failed-clear'
    )),
    '历史动作缺少 Host 文档身份时不得只按 layerId 与最终结构做确定性关联',
    JSON.stringify(unboundStructureConcernReport)
);

const missingHostLayerProofReport = detectDesignArtifactStructureConcerns({
    toolCallLog: r7StructureToolLog.map((entry) => (
        entry.name === 'setTextContent'
            ? {
                ...entry,
                result: {
                    ...entry.result,
                    photoshopOperationResult: undefined
                }
            }
            : entry
    )),
    acceptanceSnapshot: r7AcceptanceSnapshot
});
check(
    missingHostLayerProofReport.coverage.status === 'incomplete'
        && missingHostLayerProofReport.coverage.unresolvedLayerIdentityCount === 1
        && missingHostLayerProofReport.coverage.reasonCodes.includes(
            'tool_layer_identity_unavailable'
        )
        && !missingHostLayerProofReport.concerns.some((concern) => (
            concern.kind === 'abandoned-visible-content-after-failed-clear'
                || concern.kind === 'concealed-content-after-failed-clear'
        )),
    '工具结果只有 Host 文档版本、没有 Host 图层证明时不信模型 layerId，结构覆盖明确降级',
    JSON.stringify(missingHostLayerProofReport)
);

const crossDocumentStructureConcernReport = detectDesignArtifactStructureConcerns({
    toolCallLog: r7StructureToolLog.map((entry) => (
        entry.name === 'createTextLayer' && entry.result?.layerId === 4
            ? {
                ...entry,
                result: {
                    ...entry.result,
                    historyStateRef: { documentId: 91, historyStateId: 3 }
                }
            }
            : entry
    )),
    acceptanceSnapshot: r7AcceptanceSnapshot
});
check(
    !crossDocumentStructureConcernReport.concerns.some((concern) => (
        concern.kind === 'abandoned-visible-content-after-failed-clear'
            || concern.kind === 'concealed-content-after-failed-clear'
    )),
    '不同 Photoshop 文档的同号 layerId 不得被串成同一个失败清除关系链',
    JSON.stringify(crossDocumentStructureConcernReport)
);

const duplicateConcernToolLog = [
    ...r7StructureToolLog,
    {
        name: 'createTextLayer',
        arguments: { content: '第二个遗留文字', fontSize: 32 },
        result: { success: true, layerId: 5, historyStateRef: { documentId: 90, historyStateId: 5 } }
    },
    {
        name: 'setTextContent',
        arguments: { layerId: 5, content: '' },
        result: {
            success: false,
            historyStateRef: { documentId: 90, historyStateId: 5 },
            photoshopOperationResult: buildRolledBackLayerOperationResult(
                'setTextContent',
                5,
                5
            )
        }
    },
    {
        name: 'setTextStyle',
        arguments: { layerId: 5, fontSize: 1 },
        result: {
            success: true,
            layerId: 5,
            historyStateRef: { documentId: 90, historyStateId: 6 }
        }
    }
];
const duplicateConcernSnapshot = {
    ...r7AcceptanceSnapshot,
    historyStateRef: { documentId: 90, historyStateId: 6 },
    summary: { ...r7AcceptanceSnapshot.summary, totalLayers: 5, textLayers: 3 },
    layers: [
        ...r7AcceptanceSnapshot.layers,
        {
            id: 5,
            name: '第二个遗留文字',
            kind: 'text',
            visible: true,
            locked: false,
            opacity: 100,
            depth: 0,
            index: 4,
            parentId: null,
            parentName: null,
            path: '第二个遗留文字',
            selected: false,
            bounds: { left: 120, top: 260, right: 132, bottom: 263, width: 12, height: 3 },
            text: { content: '第二个遗留文字', length: 7, style: { fontSize: 1 } }
        }
    ]
};
const duplicateConcernReport = detectDesignArtifactStructureConcerns({
    toolCallLog: duplicateConcernToolLog,
    acceptanceSnapshot: duplicateConcernSnapshot
});
const duplicateLayerConcerns = duplicateConcernReport.concerns.filter((concern) => (
    concern.kind === 'abandoned-visible-content-after-failed-clear'
));
check(
    duplicateLayerConcerns.length === 2
        && new Set(duplicateLayerConcerns.map((concern) => concern.evidenceId)).size === 2
        && duplicateLayerConcerns.every((concern) => concern.layerRef?.documentId === 90),
    '同类 concern 按 documentId+layerId 生成实例唯一 evidenceId，Judge 必须逐项消费',
    JSON.stringify(duplicateLayerConcerns)
);

const overflowConcernToolLog = [];
const overflowConcernLayers = [];
for (let index = 0; index < 13; index += 1) {
    const layerId = 100 + index;
    const historyStateId = 10 + (index * 3);
    const content = `结构关系样本${index + 1}`;
    overflowConcernToolLog.push(
        {
            name: 'createTextLayer',
            arguments: { content, fontSize: 40 },
            result: {
                success: true,
                documentId: 90,
                layerId,
                historyStateRef: { documentId: 90, historyStateId }
            }
        },
        {
            name: 'setTextContent',
            arguments: { layerId, content: '' },
            result: {
                success: false,
                documentId: 90,
                historyStateRef: { documentId: 90, historyStateId },
                photoshopOperationResult: buildRolledBackLayerOperationResult(
                    'setTextContent',
                    layerId,
                    historyStateId
                )
            }
        },
        {
            name: 'setTextStyle',
            arguments: { layerId, fontSize: 1 },
            result: {
                success: true,
                documentId: 90,
                layerId,
                historyStateRef: { documentId: 90, historyStateId: historyStateId + 1 }
            }
        }
    );
    overflowConcernLayers.push({
        id: layerId,
        name: `结构关系样本${index + 1}`,
        kind: 'text',
        visible: true,
        locked: false,
        opacity: 100,
        depth: 0,
        index,
        parentId: null,
        parentName: null,
        path: `结构关系样本${index + 1}`,
        selected: index === 12,
        bounds: {
            left: 100,
            top: 100 + (index * 5),
            right: 110,
            bottom: 102 + (index * 5),
            width: 10,
            height: 2
        },
        text: { content, length: content.length, style: { fontSize: 1 } }
    });
}
const overflowConcernReport = detectDesignArtifactStructureConcerns({
    toolCallLog: overflowConcernToolLog,
    acceptanceSnapshot: {
        success: true,
        hasDocument: true,
        historyStateRef: { documentId: 90, historyStateId: 49 },
        document: { id: 90, name: '第13条结构关系', width: 1440, height: 1440 },
        summary: {
            totalLayers: 13,
            selectedLayers: 1,
            hiddenLayers: 0,
            lockedLayers: 0,
            textLayers: 13,
            groupLayers: 0,
            smartObjectLayers: 0,
            shapeLayers: 0,
            pixelLayers: 0,
            truncated: false
        },
        layers: overflowConcernLayers,
        warnings: []
    }
});
const overflowConcernVerification = projectDesignFinalReviewStructureVerification(
    overflowConcernReport
);
check(
    overflowConcernReport.coverage.status === 'incomplete'
        && overflowConcernReport.coverage.detectedConcernCount === 13
        && overflowConcernReport.coverage.reportedConcernCount === 11
        && overflowConcernReport.coverage.concernsTruncated === true
        && overflowConcernReport.coverage.reasonCodes.includes('concern_list_truncated')
        && overflowConcernReport.concerns.length === 12
        && overflowConcernReport.concerns[0]?.kind === 'structure-observation-incomplete'
        && new Set(overflowConcernReport.concerns.map((concern) => concern.evidenceId)).size === 12
        && overflowConcernVerification.status === 'needs_review',
    '第13条 concern 触发显式报告截断，fresh_structure 保持 needs_review 而非假 complete',
    JSON.stringify({
        coverage: overflowConcernReport.coverage,
        verification: overflowConcernVerification,
        concernCount: overflowConcernReport.concerns.length
    })
);

function buildConcealmentConcern(action, layerPatch) {
    const report = detectDesignArtifactStructureConcerns({
        toolCallLog: [...r7StructureToolLog.slice(0, 4), action],
        acceptanceSnapshot: {
            ...r7AcceptanceSnapshot,
            historyStateRef: { documentId: 90, historyStateId: 4 },
            layers: r7AcceptanceSnapshot.layers.map((layer) => (
                layer.id === 4 ? { ...layer, ...layerPatch } : layer
            ))
        }
    });
    return report.concerns.find((concern) => concern.kind === 'concealed-content-after-failed-clear');
}

const hiddenAfterFailedClearConcern = buildConcealmentConcern({
    name: 'setLayerVisibility',
    arguments: { layerIds: [4], visible: false },
    result: {
        success: true,
        documentId: 90,
        visible: false,
        changed: [{ id: 4, name: '说明·柔和多色花边袜口' }],
        historyStateRef: { documentId: 90, historyStateId: 4 }
    }
}, { visible: false });
const transparentAfterFailedClearConcern = buildConcealmentConcern({
    name: 'setLayerOpacity',
    arguments: { layerId: 4, opacity: 0 },
    result: {
        success: true,
        documentId: 90,
        layerId: 4,
        historyStateRef: { documentId: 90, historyStateId: 4 }
    }
}, { opacity: 0 });
const outsideCanvasAfterFailedClearConcern = buildConcealmentConcern({
    name: 'moveLayer',
    arguments: { layerId: 4, x: 1600, y: 1600 },
    result: {
        success: true,
        documentId: 90,
        layerId: 4,
        historyStateRef: { documentId: 90, historyStateId: 4 }
    }
}, {
    bounds: { left: 1600, top: 1600, right: 1610, bottom: 1602, width: 10, height: 2 }
});
check(
    hiddenAfterFailedClearConcern?.status === 'needs_review'
        && hiddenAfterFailedClearConcern?.facts.includes('same_layer_hidden_after_failure')
        && hiddenAfterFailedClearConcern?.facts.includes('final_layer_hidden')
        && transparentAfterFailedClearConcern?.status === 'needs_review'
        && transparentAfterFailedClearConcern?.facts.includes('same_layer_zero_opacity_after_failure')
        && transparentAfterFailedClearConcern?.facts.includes('final_layer_fully_transparent')
        && outsideCanvasAfterFailedClearConcern?.status === 'needs_review'
        && outsideCanvasAfterFailedClearConcern?.facts.includes('same_layer_moved_after_failure')
        && outsideCanvasAfterFailedClearConcern?.facts.includes('final_layer_outside_canvas'),
    '失败清除后隐藏、全透明或移出画布只形成事实 concern，保持 needs_review 且不自动判坏',
    JSON.stringify({
        hiddenAfterFailedClearConcern,
        transparentAfterFailedClearConcern,
        outsideCanvasAfterFailedClearConcern
    })
);

const purePhotographySnapshot = {
    ...r7AcceptanceSnapshot,
    summary: {
        ...r7AcceptanceSnapshot.summary,
        totalLayers: 2,
        textLayers: 0
    },
    layers: r7AcceptanceSnapshot.layers.filter((layer) => (
        layer.kind === 'smartObject' || layer.kind === 'background'
    ))
};
const purePhotographyConcernReport = detectDesignArtifactStructureConcerns({
    toolCallLog: [{
        name: 'placeImage',
        arguments: { sourcePath: 'C:\\Users\\example\\Desktop\\clean-photo.jpg' },
        result: { success: true, layerId: 2 }
    }],
    acceptanceSnapshot: purePhotographySnapshot
});
check(
    purePhotographyConcernReport.coverage.status === 'complete'
        && purePhotographyConcernReport.concerns.length === 0,
    '完整的纯摄影智能对象加背景、无文字且无失败清空链时不产生结构 concern',
    JSON.stringify(purePhotographyConcernReport)
);

const isolatedTinyTextReport = detectDesignArtifactStructureConcerns({
    toolCallLog: [{
        name: 'createTextLayer',
        arguments: { content: '合法微型标识', fontSize: 1 },
        result: { success: true, layerId: 4 }
    }],
    acceptanceSnapshot: r7AcceptanceSnapshot
});
check(
    !isolatedTinyTextReport.concerns.some((concern) => (
        concern.kind === 'abandoned-visible-content-after-failed-clear'
    )),
    '单独出现小字号不会触发 concern，检测依据是失败清空后的同层关系链而非绝对字号阈值'
);

const failedClearWithoutScaleReductionReport = detectDesignArtifactStructureConcerns({
    toolCallLog: r7StructureToolLog.map((entry) => (
        entry.name === 'setTextStyle'
            ? { ...entry, arguments: { layerId: 4, fontSize: 48 } }
            : entry
    )),
    acceptanceSnapshot: {
        ...r7AcceptanceSnapshot,
        layers: r7AcceptanceSnapshot.layers.map((layer) => (
            layer.id === 4
                ? { ...layer, text: { ...layer.text, style: { fontSize: 48 } } }
                : layer
        ))
    }
});
check(
    !failedClearWithoutScaleReductionReport.concerns.some((concern) => (
        concern.kind === 'abandoned-visible-content-after-failed-clear'
    )),
    '失败清空后普通放大不会被误称为尺度收缩遗留，关系链需要同层相对缩小'
);

const truncatedPhotographyReport = detectDesignArtifactStructureConcerns({
    toolCallLog: [],
    acceptanceSnapshot: {
        ...purePhotographySnapshot,
        summary: {
            ...purePhotographySnapshot.summary,
            truncated: true
        },
        warnings: ['图层数量超过 maxLayers=2，验收快照已截断。']
    }
});
check(
    truncatedPhotographyReport.coverage.status === 'incomplete'
        && truncatedPhotographyReport.coverage.truncated === true
        && truncatedPhotographyReport.coverage.reasonCodes.includes('layer_list_truncated')
        && truncatedPhotographyReport.concerns.some((concern) => (
            concern.kind === 'structure-observation-incomplete'
                && concern.evidenceId === 'structure:structure-observation-incomplete:document-90:incomplete'
                && concern.status === 'needs_review'
        )),
    '验收快照截断时明确产出覆盖不完整 concern，不用部分图层清单声明没有问题',
    JSON.stringify(truncatedPhotographyReport)
);

console.log('[7] 终审公开设计意图按 Host 文档目标绑定');
const singleDocumentIntent = appendMutationBoundDesignIntent({
    current: [],
    modelTurn: 2,
    publicText: '我只调整当前成品的主标题层级。',
    toolCalls: [
        { id: 'write-current', name: 'setTextStyle', arguments: { layerId: 4, fontSize: 96 } }
    ],
    toolResults: [{
        callId: 'write-current',
        success: true,
        output: {
            success: true,
            photoshopHistoryTransition: {
                version: 'photoshop-history-transition/v1',
                basis: 'acceptance_snapshot_pair',
                before: { documentId: 90, historyStateId: 97 },
                after: { documentId: 90, historyStateId: 98 },
                mutationObserved: true,
                documentChanged: false
            }
        }
    }]
});
const mixedDocumentIntent = appendMutationBoundDesignIntent({
    current: singleDocumentIntent,
    modelTurn: 3,
    publicText: '这一轮同时调整了两个文档，说明不能归给任一单个成品。',
    toolCalls: [
        { id: 'write-doc-90', name: 'setTextStyle', arguments: { layerId: 4, fontSize: 92 } },
        { id: 'write-doc-91', name: 'setTextStyle', arguments: { layerId: 8, fontSize: 88 } }
    ],
    toolResults: [{
        callId: 'write-doc-90',
        success: true,
        output: {
            success: true,
            photoshopHistoryTransition: {
                version: 'photoshop-history-transition/v1',
                basis: 'acceptance_snapshot_pair',
                before: { documentId: 90, historyStateId: 98 },
                after: { documentId: 90, historyStateId: 99 },
                mutationObserved: true,
                documentChanged: false
            }
        }
    }, {
        callId: 'write-doc-91',
        success: true,
        output: {
            success: true,
            photoshopHistoryTransition: {
                version: 'photoshop-history-transition/v1',
                basis: 'acceptance_snapshot_pair',
                before: { documentId: 91, historyStateId: 20 },
                after: { documentId: 91, historyStateId: 21 },
                mutationObserved: true,
                documentChanged: false
            }
        }
    }]
});
const currentDocumentIntentForReview = formatMutationBoundDesignIntentForReview(
    mixedDocumentIntent,
    90
);
check(
    mixedDocumentIntent[1]?.committedCalls.length === 2
        && mixedDocumentIntent[1]?.committedCalls[0]?.target.documentId === 90
        && mixedDocumentIntent[1]?.committedCalls[0]?.target.historyStateId === 99
        && mixedDocumentIntent[1]?.committedCalls[1]?.target.documentId === 91
        && mixedDocumentIntent[1]?.committedCalls[1]?.target.historyStateId === 21,
    '每个真实提交调用都保留 Host after document/history 目标',
    JSON.stringify(mixedDocumentIntent[1])
);
check(
    currentDocumentIntentForReview.includes('只调整当前成品的主标题层级')
        && !currentDocumentIntentForReview.includes('同时调整了两个文档')
        && formatMutationBoundDesignIntentForReview(mixedDocumentIntent, 91) === '',
    '终审只消费完整绑定当前文档的公开意图，跨文档混合说明不污染任一成品',
    currentDocumentIntentForReview
);

console.log('[8] Final Judge 协议摘要只进入 execution / RunRecord 诊断');
const finalQualityProtocolDigest = {
    judgeStatus: 'completed',
    diagnosisRepairStatus: 'repaired',
    diagnosisRepairTargetCount: 2,
    actionableDiagnosisCount: 2,
    evidenceScope: {
        finalArtifactObserved: true,
        selectedSourceCompared: true,
        declaredReferenceCompared: false,
        candidateSetCompared: false
    }
};
const finalQualityProtocolRecord = buildAgentRunRecord({
    now: '2026-08-25T12:00:00.000Z',
    goal: '完成商品主图并进行终局视觉复核',
    result: {
        success: true,
        stopReason: 'final_response',
        iterations: 6,
        toolCallLog: [],
        executionSummary: {
            status: 'needs_review',
            blockers: [],
            warnings: ['当前版本仍有可改进项。'],
            finalQualityModelProtocolDigest: finalQualityProtocolDigest
        }
    }
});
check(
    finalQualityProtocolRecord.quality?.executionStatus === 'needs_review'
        && JSON.stringify(finalQualityProtocolRecord.quality?.finalQualityModelProtocol)
            === JSON.stringify(finalQualityProtocolDigest)
        && validateAgentRunRecordForPersist(finalQualityProtocolRecord).ok,
    '有界协议与 evidenceScope 进入既有 quality 诊断且不改写 executionStatus',
    JSON.stringify(finalQualityProtocolRecord.quality)
);
const pollutedFinalQualityProtocolRecord = JSON.parse(JSON.stringify(finalQualityProtocolRecord));
pollutedFinalQualityProtocolRecord.quality.finalQualityModelProtocol.actionableDiagnosisCount = 4;
check(
    !validateAgentRunRecordForPersist(pollutedFinalQualityProtocolRecord).ok,
    'RunRecord 拒绝超出 top-3 边界的 Final Judge 协议摘要'
);
const rawEvidenceFinalQualityProtocolRecord = JSON.parse(JSON.stringify(finalQualityProtocolRecord));
rawEvidenceFinalQualityProtocolRecord.quality.finalQualityModelProtocol.evidenceScope.sourcePath = 'C:/secret/source.jpg';
check(
    !validateAgentRunRecordForPersist(rawEvidenceFinalQualityProtocolRecord).ok,
    'evidenceScope 拒绝路径或四个布尔范围字段以外的内容'
);

if (failed > 0) {
    console.error(`\n[FAIL] 运行事实账本：${failed} 项断言失败`);
    process.exit(1);
}
console.log('\n[OK] 运行事实账本纯逻辑测试通过');
