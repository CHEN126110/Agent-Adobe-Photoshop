const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.main.json') });

const {
    collectDesignFinalCandidateSetReplays,
    collectDesignFinalDeclaredReferenceReplays,
    planDesignFinalComparisonEvidence,
    writeDesignFinalComparisonPresentationReplay
} = require(path.join(root, 'src/renderer/services/agent-runtime/design-final-comparison-evidence.ts'));
const {
    projectFinalQualityModelProtocolDigest
} = require(path.join(root, 'src/renderer/services/agent-runtime/final-quality-model-protocol.ts'));
const {
    projectDesignFinalReviewDerivedViewPayload
} = require(path.join(root, 'src/renderer/services/agent-runtime/design-final-review-evidence.ts'));
const {
    resolveAgentModelTransport
} = require(path.join(root, 'src/shared/agent-model-transport-policy.ts'));
const {
    buildModelVisualPresentationReceipt,
    projectSerializedVisualImageDataUrl
} = require(path.join(root, 'src/shared/model-visual-presentation-receipt.ts'));
const {
    collectImagesFromToolResult,
    compactPostWriteImagePayloadForRuntimeLog
} = require(path.join(root, 'src/renderer/services/agent-runtime/tool-result-sanitizer.ts'));
const {
    writeAgentVisualObservation,
    writeAgentVisualObservationPresentationDigest
} = require(path.join(root, 'src/renderer/services/agent-runtime/visual-observation-strategy.ts'));

let failed = 0;

function check(condition, label, detail) {
    if (condition) {
        console.log(`  ✓ ${label}`);
        return;
    }
    failed += 1;
    console.error(`  ✗ ${label}${detail ? `：${detail}` : ''}`);
}

function makeImage(seed) {
    return Buffer.from(String(seed).repeat(160), 'utf8').toString('base64');
}

function makeObservedToolCall(options) {
    const result = {
        success: options.success !== false,
        ...(options.result || {})
    };
    if (options.name === 'analyzeProjectContactSheetOverview'
        || options.name === 'browseAssetCandidates'
        || options.name === 'recommendAssets') {
        result.sheet = {
            imageData: options.imageData,
            mediaType: 'image/jpeg',
            width: 960,
            height: 720
        };
    } else {
        result.image = {
            imageData: options.imageData,
            mediaType: 'image/jpeg',
            sourceId: options.sourceId || 'one',
            sourceKind: options.sourceKind || 'reference'
        };
    }
    const image = collectImagesFromToolResult(result, 24, options.name).images[0];
    if (!image?.observationKey || !image.observationIdentity) {
        throw new Error('测试图像没有形成稳定 observationKey');
    }
    const observationKey = image.observationKey;
    const observation = writeAgentVisualObservation(result, {
        status: 'presented_to_primary',
        reviewed: false,
        observer: 'primary_model',
        strategy: 'primary-self',
        toolName: options.name,
        sourceId: image.sourceId,
        sourceKind: image.sourceKind,
        resultPath: image.resultPath,
        observationIdentity: image.observationIdentity,
        observationKey,
        presentedModelTurn: 1,
    });
    if (!observation) throw new Error('测试观察记录签发失败');
    const presentedImageData = options.presentedImageData || options.imageData;
    const digest = writeAgentVisualObservationPresentationDigest({
        toolResult: result,
        observationKey,
        presentedImageData
    });
    if (!digest) throw new Error('测试 presentation 摘要签发失败');
    const presentationCaptured = writeDesignFinalComparisonPresentationReplay({
        toolResult: result,
        toolName: options.name,
        observationKey,
        replayImage: {
            data: presentedImageData,
            mediaType: 'image/jpeg'
        }
    });
    if (['analyzeProjectContactSheetOverview', 'browseAssetCandidates', 'recommendAssets', 'analyzeEagleReference'].includes(options.name)
        && !presentationCaptured
        && options.allowPresentationCaptureFailure !== true) {
        throw new Error('测试终审 presentation 重放捕获失败');
    }
    if (options.consumed !== false) observation.consumedModelTurn = 2;
    if (options.structuredReview !== false) {
        observation.status = 'observed_by_primary';
        observation.reviewed = true;
        observation.reviewDecision = {
            version: 'visual-observation-review-decision/v1',
            observationKey,
            status: options.reviewStatus || 'passed',
            reviewer: 'primary_model',
            summary: '已比较画面中的可观察关系。',
            issues: []
        };
    }
    return {
        callId: options.callId || `call:${options.name}:${options.sourceId || 'one'}`,
        modelTurn: 0,
        name: options.name,
        arguments: options.arguments || {},
        result,
        origin: options.origin || 'model_tool_call'
    };
}

function makeReferenceBrief(refs) {
    return {
        version: 'runtime-reference-brief/v0',
        source: 'model_tool_call',
        workMode: 'create_new',
        requirement: 'reuse_or_optional',
        decision: 'reuse_existing',
        readiness: 'ready',
        sources: refs.map((item) => ({
            kind: item.kind,
            sourceRefs: [item.contextRef]
        })),
        insights: refs.map((item, index) => ({
            aspect: index % 2 === 0 ? 'composition' : 'color',
            observation: `参考观察 ${index + 1}`,
            application: `迁移关系 ${index + 1}`,
            observationRefs: [item.contextRef]
        })),
        limitations: [],
        boundaries: {
            modelAuthored: true,
            harnessValidatedOnly: true,
            skillPolicyIsSourceOfTruth: true,
            categoryNeutral: true,
            executesTools: false
        }
    };
}

function makeReferenceReplay(options = {}) {
    const imageData = options.imageData || makeImage(options.sourceId || 'eagle-one');
    const contextRef = options.contextRef || `context:reference_visual:${options.sourceId || 'eagle-one'}`;
    const kind = options.kind || 'eagle';
    return {
        contextRef,
        sourceKind: kind,
        sourceId: options.sourceId || 'eagle-one',
        toolCall: makeObservedToolCall({
            name: options.toolName || 'analyzeEagleReference',
            sourceId: options.sourceId || 'eagle-one',
            imageData,
            presentedImageData: options.presentedImageData,
            arguments: (options.toolName || 'analyzeEagleReference') === 'analyzeEagleReference'
                ? { itemId: options.sourceId || 'eagle-one' }
                : {},
            result: (options.toolName || 'analyzeEagleReference') === 'analyzeEagleReference'
                ? { item: { id: options.sourceId || 'eagle-one' } }
                : {},
            origin: options.origin,
            reviewStatus: options.reviewStatus,
            structuredReview: options.structuredReview,
            consumed: options.consumed
        }),
        replayImage: {
            data: options.replayImageData || imageData,
            mediaType: 'image/jpeg'
        }
    };
}

function makeCandidateReplay(options = {}) {
    const imageData = options.imageData || makeImage(options.id || 'candidate-sheet');
    const paths = options.paths || ['C:\\project\\A.jpg', 'C:\\project\\B.jpg'];
    const displayedCandidateCount = options.displayedCandidateCount ?? paths.length;
    const attemptedCandidateCount = options.attemptedCandidateCount ?? displayedCandidateCount;
    const candidateUniverseCount = options.candidateUniverseCount ?? displayedCandidateCount;
    const entry = makeObservedToolCall({
        name: options.toolName || 'analyzeProjectContactSheetOverview',
        sourceId: options.id || 'candidate-sheet',
        sourceKind: 'candidate_set',
        imageData,
        presentedImageData: options.presentedImageData,
        origin: options.origin,
        reviewStatus: options.reviewStatus,
        structuredReview: options.structuredReview,
        consumed: options.consumed,
        allowPresentationCaptureFailure: attemptedCandidateCount !== displayedCandidateCount,
        result: {
            candidateCoverage: {
                version: 'project-contact-sheet-candidate-coverage/v0',
                candidateUniverseCount,
                attemptedCandidateCount,
                displayedCandidateCount,
                failedRenderCount: attemptedCandidateCount - displayedCandidateCount,
                samplingOmittedCandidateCount: candidateUniverseCount - attemptedCandidateCount,
                omittedCandidateCount: candidateUniverseCount - displayedCandidateCount,
                status: candidateUniverseCount > displayedCandidateCount ? 'sampled' : 'complete',
                universeScope: 'project_scan',
                doesNotRank: true,
                doesNotSelectWinner: true
            },
            contactSheet: {
                items: paths.map((itemPath, index) => ({
                    id: `A${index + 1}`,
                    path: itemPath,
                    status: index < displayedCandidateCount ? 'rendered' : 'failed'
                }))
            }
        }
    });
    const captured = collectDesignFinalCandidateSetReplays([entry])[0];
    return {
        toolCall: entry,
        ...(captured?.capturedCoverage
            ? { capturedCoverage: captured.capturedCoverage }
            : {}),
        replayImage: {
            data: options.replayImageData || imageData,
            mediaType: 'image/jpeg'
        }
    };
}

function makeRecommendCandidateReplay(options = {}) {
    const imageData = options.imageData || makeImage('recommend-shortlist');
    const paths = options.paths || ['C:\\project\\A.jpg', 'C:\\project\\B.jpg'];
    const toolCall = makeObservedToolCall({
            name: 'recommendAssets',
            sourceId: options.id || 'recommend-shortlist',
            sourceKind: 'candidate_set',
            imageData,
            result: {
                comparisonItems: paths.map((itemPath, index) => ({
                    id: `A${index + 1}`,
                    path: itemPath,
                    status: 'rendered'
                })),
                recommendations: paths.map((itemPath, index) => ({
                    file: { path: itemPath },
                    matchScore: 100 - index
                })),
                visualComparison: {
                    status: 'observed',
                    comparedCount: options.internalComparedCount ?? paths.length,
                    modelCallCount: 1,
                    rankingIsAdvisory: true,
                    agentSelectsFinalAsset: true
                }
            }
        });
    const captured = collectDesignFinalCandidateSetReplays([toolCall])[0];
    return {
        toolCall,
        capturedCoverage: captured?.capturedCoverage,
        replayImage: {
            data: imageData,
            mediaType: 'image/jpeg'
        }
    };
}

function makeBrowseCandidateReplay(options = {}) {
    const imageData = options.imageData || makeImage('neutral-candidate-page');
    const paths = options.paths || ['C:\\project\\A.jpg', 'C:\\project\\B.jpg'];
    const totalCandidates = options.totalCandidates ?? 6;
    const pageSize = options.pageSize ?? paths.length;
    const page = options.page ?? 1;
    const totalPages = options.totalPages ?? Math.ceil(totalCandidates / pageSize);
    const hasMore = options.hasMore ?? page < totalPages;
    const toolCall = makeObservedToolCall({
        name: 'browseAssetCandidates',
        sourceId: options.id || 'neutral-candidate-page',
        sourceKind: 'candidate_set',
        imageData,
        allowPresentationCaptureFailure: options.allowPresentationCaptureFailure === true,
        result: {
            comparisonItems: paths.map((itemPath, index) => ({
                id: `A${index + 1}`,
                path: itemPath,
                status: 'rendered'
            })),
            candidatePage: {
                version: 'asset-candidate-page/v1',
                candidateSetId: options.candidateSetId || 'candidate-set-v1-1234567890abcdef',
                page,
                pageSize,
                totalCandidates,
                totalPages,
                hasMore,
                ...(hasMore ? { nextPage: page + 1 } : {}),
                ordering: 'stable_source_aspect_span_round_robin',
                ranked: false,
                winnerSelected: false,
                explicitScope: {}
            }
        }
    });
    const captured = collectDesignFinalCandidateSetReplays([toolCall])[0];
    return {
        toolCall,
        capturedCoverage: captured?.capturedCoverage,
        replayImage: {
            data: imageData,
            mediaType: 'image/jpeg'
        }
    };
}

console.log('[1] 完整的 Agent 观察 + 声明 + 候选绑定进入同一次终审');
const referenceOne = makeReferenceReplay();
const candidateOne = makeCandidateReplay();
const completePlan = planDesignFinalComparisonEvidence({
    referenceBrief: makeReferenceBrief([{
        kind: 'eagle',
        contextRef: referenceOne.contextRef
    }]),
    declaredReferences: [referenceOne],
    candidateSets: [candidateOne],
    selectedSourcePaths: ['C:\\project\\A.jpg'],
    availableImageSlots: 2
});
check(
    completePlan.evidenceScope.declaredReferenceCompared
        && completePlan.evidenceScope.candidateSetCompared
        && completePlan.candidateCount === 2
        && completePlan.contentBlocks[0]?.text?.includes('候选联系表')
        && completePlan.contentBlocks[2]?.text?.includes('声明参考 1'),
    '两类证据整体进入，且按证据角色固定排布而非按分数排序',
    JSON.stringify(completePlan.coverage)
);

console.log('[2] 未声明参考不会因 Tool log 中存在而被 Harness 自动补入');
const undeclaredPlan = planDesignFinalComparisonEvidence({
    declaredReferences: [referenceOne],
    candidateSets: [candidateOne],
    selectedSourcePaths: ['C:\\project\\A.jpg'],
    availableImageSlots: 2
});
check(
    !undeclaredPlan.evidenceScope.declaredReferenceCompared
        && undeclaredPlan.evidenceScope.candidateSetCompared
        && undeclaredPlan.candidateCount === 1
        && undeclaredPlan.coverage.declaredReference.reasonCodes.includes('not_declared'),
    '未声明参考保持 unevaluated，候选集可独立评价',
    JSON.stringify(undeclaredPlan.coverage)
);

console.log('[3] searchEagleReferences 元数据不能冒充参考像素');
const metadataOnlyReference = makeReferenceReplay({ toolName: 'searchEagleReferences' });
const metadataPlan = planDesignFinalComparisonEvidence({
    referenceBrief: makeReferenceBrief([{
        kind: 'eagle',
        contextRef: metadataOnlyReference.contextRef
    }]),
    declaredReferences: [metadataOnlyReference],
    availableImageSlots: 1
});
check(
    !metadataPlan.evidenceScope.declaredReferenceCompared
        && metadataPlan.coverage.declaredReference.reasonCodes.includes('tool_not_allowed'),
    'Eagle 搜索命中只算元数据，不算视觉参考',
    JSON.stringify(metadataPlan.coverage.declaredReference)
);

console.log('[4] 序列化副本丢失 Runtime owner，不能伪造已观察');
const clonedReference = makeReferenceReplay({ sourceId: 'clone-test' });
clonedReference.toolCall.result = JSON.parse(JSON.stringify(clonedReference.toolCall.result));
const clonedPlan = planDesignFinalComparisonEvidence({
    referenceBrief: makeReferenceBrief([{
        kind: 'eagle',
        contextRef: clonedReference.contextRef
    }]),
    declaredReferences: [clonedReference],
    availableImageSlots: 1
});
check(
    !clonedPlan.evidenceScope.declaredReferenceCompared
        && clonedPlan.coverage.declaredReference.reasonCodes.includes('runtime_visual_observation_missing'),
    '克隆后的 Tool 结果不能命中 WeakSet owner',
    JSON.stringify(clonedPlan.coverage.declaredReference)
);

console.log('[5] 重放像素变化时 fail closed');
const changedReference = makeReferenceReplay({
    sourceId: 'changed',
    replayImageData: makeImage('different-pixels')
});
const changedPlan = planDesignFinalComparisonEvidence({
    referenceBrief: makeReferenceBrief([{
        kind: 'eagle',
        contextRef: changedReference.contextRef
    }]),
    declaredReferences: [changedReference],
    availableImageSlots: 1
});
check(
    !changedPlan.evidenceScope.declaredReferenceCompared
        && changedPlan.coverage.declaredReference.reasonCodes.includes('replay_pixel_changed'),
    '参考文件变化后不把新像素冒充旧观察',
    JSON.stringify(changedPlan.coverage.declaredReference)
);

console.log('[6] 候选联系表必须包含 Agent 最终真实选中的源图');
const missingSelectedSourcePlan = planDesignFinalComparisonEvidence({
    candidateSets: [candidateOne],
    selectedSourcePaths: ['C:\\project\\C.jpg'],
    availableImageSlots: 1
});
check(
    !missingSelectedSourcePlan.evidenceScope.candidateSetCompared
        && missingSelectedSourcePlan.coverage.candidateSet.reasonCodes.includes('candidate_set_binding_missing'),
    '不相关联系表不会被终审自动采用',
    JSON.stringify(missingSelectedSourcePlan.coverage.candidateSet)
);

console.log('[7] 多张联系表都包含选中源图时不由 Harness 挑一张');
const ambiguousCandidatePlan = planDesignFinalComparisonEvidence({
    candidateSets: [candidateOne, makeCandidateReplay({ id: 'candidate-sheet-2' })],
    selectedSourcePaths: ['C:\\project\\A.jpg'],
    availableImageSlots: 2
});
check(
    !ambiguousCandidatePlan.evidenceScope.candidateSetCompared
        && ambiguousCandidatePlan.coverage.candidateSet.reasonCodes.includes('candidate_set_binding_ambiguous'),
    '候选集绑定歧义时保持未评价，不按最新/分数代选',
    JSON.stringify(ambiguousCandidatePlan.coverage.candidateSet)
);

console.log('[8] 声明参考超过有界上限时不静默截取前几张');
const manyReferences = ['one', 'two', 'three', 'four'].map((id) => makeReferenceReplay({ sourceId: id }));
const manyReferencePlan = planDesignFinalComparisonEvidence({
    referenceBrief: makeReferenceBrief(manyReferences.map((item) => ({
        kind: 'eagle',
        contextRef: item.contextRef
    }))),
    declaredReferences: manyReferences,
    availableImageSlots: 4
});
check(
    !manyReferencePlan.evidenceScope.declaredReferenceCompared
        && manyReferencePlan.candidateCount === 0
        && manyReferencePlan.coverage.declaredReference.reasonCodes.includes('declared_reference_limit_exceeded'),
    '参考过多整组 unevaluated，不按数组前序伪装完整比较',
    JSON.stringify(manyReferencePlan.coverage.declaredReference)
);

console.log('[9] 两类证据均就绪但总额度不足时，不由 Harness 选择证据赢家');
const capacityPlan = planDesignFinalComparisonEvidence({
    referenceBrief: makeReferenceBrief([{
        kind: 'eagle',
        contextRef: referenceOne.contextRef
    }]),
    declaredReferences: [referenceOne],
    candidateSets: [candidateOne],
    selectedSourcePaths: ['C:\\project\\A.jpg'],
    availableImageSlots: 1
});
check(
    !capacityPlan.evidenceScope.declaredReferenceCompared
        && !capacityPlan.evidenceScope.candidateSetCompared
        && capacityPlan.candidateCount === 0
        && capacityPlan.coverage.declaredReference.reasonCodes.includes('visual_capacity_insufficient')
        && capacityPlan.coverage.candidateSet.reasonCodes.includes('visual_capacity_insufficient'),
    '整体视觉额度不足时两组统一退为 unevaluated',
    JSON.stringify(capacityPlan.coverage)
);

console.log('[10] 抽样候选可如实比较已显示集合，但不得伪装成完整项目库存');
const sampledCandidate = makeCandidateReplay({
    id: 'sampled',
    candidateUniverseCount: 8,
    attemptedCandidateCount: 2,
    displayedCandidateCount: 2
});
const sampledPlan = planDesignFinalComparisonEvidence({
    candidateSets: [sampledCandidate],
    selectedSourcePaths: ['C:\\project\\B.jpg'],
    availableImageSlots: 1
});
check(
    sampledPlan.evidenceScope.candidateSetCompared
        && sampledPlan.contentBlocks[0]?.text?.includes('coverage=sampled')
        && sampledPlan.contentBlocks[0]?.text?.includes('universe=8')
        && sampledPlan.contentBlocks[0]?.text?.includes('omitted=6'),
    'candidateSetCompared 只指实际展示集合，覆盖范围原样披露',
    JSON.stringify(sampledPlan.coverage.candidateSet)
);

console.log('[11] 联系表渲染缺失不能被剩余缩略图掩盖');
const partialCandidate = makeCandidateReplay({
    id: 'partial',
    paths: ['C:\\project\\A.jpg', 'C:\\project\\B.jpg'],
    candidateUniverseCount: 2,
    attemptedCandidateCount: 2,
    displayedCandidateCount: 1
});
const partialPlan = planDesignFinalComparisonEvidence({
    candidateSets: [partialCandidate],
    selectedSourcePaths: ['C:\\project\\A.jpg'],
    availableImageSlots: 1
});
check(
    !partialPlan.evidenceScope.candidateSetCompared
        && partialPlan.coverage.candidateSet.reasonCodes.includes('candidate_set_coverage_invalid'),
    '渲染不完整的候选联系表不进入比较',
    JSON.stringify(partialPlan.coverage.candidateSet)
);

console.log('[12] Harness-origin 观察与 unreadable 观察都不能升级为 Agent 已比较');
const harnessReference = makeReferenceReplay({ sourceId: 'harness', origin: 'harness_quality_verification' });
const unreadableReference = makeReferenceReplay({ sourceId: 'unreadable', reviewStatus: 'unreadable' });
const harnessPlan = planDesignFinalComparisonEvidence({
    referenceBrief: makeReferenceBrief([{
        kind: 'eagle',
        contextRef: harnessReference.contextRef
    }]),
    declaredReferences: [harnessReference],
    availableImageSlots: 1
});
const unreadablePlan = planDesignFinalComparisonEvidence({
    referenceBrief: makeReferenceBrief([{
        kind: 'eagle',
        contextRef: unreadableReference.contextRef
    }]),
    declaredReferences: [unreadableReference],
    availableImageSlots: 1
});
check(
    !harnessPlan.evidenceScope.declaredReferenceCompared
        && harnessPlan.coverage.declaredReference.reasonCodes.includes('tool_not_model_selected')
        && !unreadablePlan.evidenceScope.declaredReferenceCompared
        && unreadablePlan.coverage.declaredReference.reasonCodes.includes('runtime_visual_observation_missing'),
    '只有模型主动且可读的视觉观察才有比较资格',
    JSON.stringify({ harness: harnessPlan.coverage, unreadable: unreadablePlan.coverage })
);

console.log('[13] 预算降级时摘要绑定实际缩图，不把 Tool 原图冒充 Agent 所见像素');
const originalPixels = makeImage('original-reference-pixels');
const thumbnailPixels = makeImage('degraded-thumbnail-pixels');
const degradedReference = makeReferenceReplay({
    sourceId: 'degraded',
    imageData: originalPixels,
    presentedImageData: thumbnailPixels,
    replayImageData: originalPixels
});
const degradedBrief = makeReferenceBrief([{
    kind: 'eagle',
    contextRef: degradedReference.contextRef
}]);
const wrongPresentationPlan = planDesignFinalComparisonEvidence({
    referenceBrief: degradedBrief,
    declaredReferences: [degradedReference],
    availableImageSlots: 1
});
degradedReference.replayImage.data = thumbnailPixels;
const exactPresentationPlan = planDesignFinalComparisonEvidence({
    referenceBrief: degradedBrief,
    declaredReferences: [degradedReference],
    availableImageSlots: 1
});
check(
    !wrongPresentationPlan.evidenceScope.declaredReferenceCompared
        && wrongPresentationPlan.coverage.declaredReference.reasonCodes.includes('replay_pixel_changed')
        && exactPresentationPlan.evidenceScope.declaredReferenceCompared,
    '只有与实际 provider presentation 相同的缩图可进入终审重放',
    JSON.stringify({ wrong: wrongPresentationPlan.coverage, exact: exactPresentationPlan.coverage })
);

console.log('[14] declaration ref 还必须与 Tool 实际 item 精确一致');
const mismatchedSourceReference = makeReferenceReplay({ sourceId: 'actual-eagle-item' });
mismatchedSourceReference.sourceId = 'different-eagle-item';
const mismatchedSourcePlan = planDesignFinalComparisonEvidence({
    referenceBrief: makeReferenceBrief([{
        kind: 'eagle',
        contextRef: mismatchedSourceReference.contextRef
    }]),
    declaredReferences: [mismatchedSourceReference],
    availableImageSlots: 1
});
check(
    !mismatchedSourcePlan.evidenceScope.declaredReferenceCompared
        && mismatchedSourcePlan.coverage.declaredReference.reasonCodes.includes('declared_reference_source_mismatch'),
    '调用方不能把一张已观察像素重新标成另一条 Eagle 参考',
    JSON.stringify(mismatchedSourcePlan.coverage.declaredReference)
);

console.log('[15] agentic 联系表单消费者；staged grounding 与 Eagle 参考证据链保持原语义');
const toolExecutorText = fs.readFileSync(
    path.join(root, 'src/renderer/services/tool-executor.service.ts'),
    'utf8'
);
const autonomousExecutorText = fs.readFileSync(
    path.join(root, 'src/renderer/services/skill-executors/autonomous-agent.executor.ts'),
    'utf8'
);
const contactSheetCaseStart = toolExecutorText.indexOf("case 'analyzeProjectContactSheetOverview':");
const contactSheetCaseEnd = toolExecutorText.indexOf("case 'prepareSkuRetouchAssets':", contactSheetCaseStart);
const contactSheetCase = toolExecutorText.slice(contactSheetCaseStart, contactSheetCaseEnd);
const recommendAssetsCaseStart = toolExecutorText.indexOf("case 'recommendAssets':");
const recommendAssetsCaseEnd = toolExecutorText.indexOf("case 'measureReferenceComposition':", recommendAssetsCaseStart);
const recommendAssetsCase = toolExecutorText.slice(recommendAssetsCaseStart, recommendAssetsCaseEnd);
const eagleCaseStart = toolExecutorText.indexOf("case 'analyzeEagleReference':");
const eagleCaseEnd = toolExecutorText.indexOf("case 'getDesignKnowledge':", eagleCaseStart);
const eagleCase = toolExecutorText.slice(eagleCaseStart, eagleCaseEnd);
const eaglePixelHelperStart = toolExecutorText.indexOf('async function loadEagleReferencePixelsForCallingAgent');
const eaglePixelHelperEnd = toolExecutorText.indexOf('/**\n * 执行资源工具', eaglePixelHelperStart);
const eaglePixelHelper = toolExecutorText.slice(eaglePixelHelperStart, eaglePixelHelperEnd);
check(
    contactSheetCaseStart >= 0
        && contactSheetCaseEnd > contactSheetCaseStart
        && contactSheetCase.includes("options.visualConsumptionOwner === 'calling_agent'")
        && contactSheetCase.includes('designEcho.createProjectContactSheetOverview')
        && contactSheetCase.includes('designEcho.analyzeProjectContactSheetOverview')
        && contactSheetCase.indexOf('designEcho.createProjectContactSheetOverview')
            < contactSheetCase.indexOf('designEcho.analyzeProjectContactSheetOverview')
        && contactSheetCase.includes("owner: 'calling_agent'")
        && contactSheetCase.includes("status: presentationSheet?.imageData ? 'pixels_attached' : 'pixels_unavailable'")
        && contactSheetCase.includes("sourceKind: 'candidate_set'")
        && contactSheetCase.includes("buildCandidateSetObservationSourceId(\n                                'project-contact-sheet'")
        && !autonomousExecutorText.includes('() => !runtimeContractBundle')
        && autonomousExecutorText.includes("visualConsumptionOwner: 'calling_agent'")
        && recommendAssetsCaseStart >= 0
        && recommendAssetsCaseEnd > recommendAssetsCaseStart
        && recommendAssetsCase.includes('resolveToolVisualConsumptionOwner(')
        && recommendAssetsCase.includes("visualConsumptionOwner === 'calling_agent'")
        && recommendAssetsCase.includes("visualConsumptionOwner: 'calling_agent' as const")
        && recommendAssetsCase.includes("visualConsumptionOwner !== 'calling_agent'")
        && recommendAssetsCase.includes("buildCandidateSetObservationSourceId(\n                            'asset-shortlist'")
        && recommendAssetsCase.includes("owner: 'calling_agent'")
        && eagleCaseStart >= 0
        && eagleCaseEnd > eagleCaseStart
        && eagleCase.includes("options.visualConsumptionOwner !== 'calling_agent'")
        && eagleCase.indexOf("designKnowledge:analyzeEagleReference")
            < eagleCase.indexOf("options.visualConsumptionOwner !== 'calling_agent'")
        && eagleCase.includes('loadEagleReferencePixelsForCallingAgent(')
        && eaglePixelHelperStart >= 0
        && eaglePixelHelperEnd > eaglePixelHelperStart
        && eaglePixelHelper.includes('designKnowledge:getEagleReferenceImageForEvaluation')
        && eaglePixelHelper.includes("sourceKind: 'reference'")
        && eaglePixelHelper.includes("status: 'attached_to_primary_agent'")
        && eaglePixelHelper.includes("status: 'unavailable'")
        && eaglePixelHelper.includes('localPathRedacted: true')
        && !eagleCase.includes('localImagePath'),
    'agentic 项目总览与候选联系表只由当前模型消费；staged 与 Eagle 证据链保持原语义，预览不暴露本地路径',
    JSON.stringify({
        contactSheetCase: contactSheetCase.slice(0, 500),
        recommendAssetsCase: recommendAssetsCase.slice(0, 500),
        eagleCase: eagleCase.slice(0, 500),
        eaglePixelHelper: eaglePixelHelper.slice(0, 500)
    })
);

console.log('[16] recommendAssets 只按 Agent 真看过的 shortlist 评价，不伪装完整项目 universe');
const recommendCandidatePlan = planDesignFinalComparisonEvidence({
    candidateSets: [makeRecommendCandidateReplay()],
    selectedSourcePaths: ['C:\\project\\A.jpg'],
    availableImageSlots: 1
});
check(
    recommendCandidatePlan.evidenceScope.candidateSetCompared
        && recommendCandidatePlan.contentBlocks[0]?.text?.includes('coverage=shortlist')
        && recommendCandidatePlan.contentBlocks[0]?.text?.includes('universe=unknown')
        && recommendCandidatePlan.contentBlocks[0]?.text?.includes('omitted=unknown')
        && !recommendCandidatePlan.contextMessage.includes('matchScore'),
    '上游 advisory 排名不进入终审 payload，覆盖未知保持未知',
    JSON.stringify(recommendCandidatePlan.coverage.candidateSet)
);

console.log('[16.1] browseAssetCandidates 中性分页保留真实 universe 与单页覆盖');
const neutralCandidatePagePlan = planDesignFinalComparisonEvidence({
    candidateSets: [makeBrowseCandidateReplay()],
    selectedSourcePaths: ['C:\\project\\B.jpg'],
    availableImageSlots: 1
});
check(
    neutralCandidatePagePlan.evidenceScope.candidateSetCompared
        && neutralCandidatePagePlan.contentBlocks[0]?.text?.includes('coverage=sampled')
        && neutralCandidatePagePlan.contentBlocks[0]?.text?.includes('universe=6')
        && neutralCandidatePagePlan.contentBlocks[0]?.text?.includes('displayed=2')
        && neutralCandidatePagePlan.contentBlocks[0]?.text?.includes('omitted=4'),
    '中性候选页只证明 Agent 真看过的本页，同时诚实披露尚未展示的候选数量',
    JSON.stringify(neutralCandidatePagePlan.coverage.candidateSet)
);
const invalidNeutralCandidatePage = makeBrowseCandidateReplay({
    totalPages: 2,
    allowPresentationCaptureFailure: true
});
const invalidNeutralCandidatePagePlan = planDesignFinalComparisonEvidence({
    candidateSets: [invalidNeutralCandidatePage],
    selectedSourcePaths: ['C:\\project\\A.jpg'],
    availableImageSlots: 1
});
check(
    !invalidNeutralCandidatePagePlan.evidenceScope.candidateSetCompared
        && invalidNeutralCandidatePagePlan.coverage.candidateSet.reasonCodes
            .includes('candidate_set_coverage_invalid'),
    '中性候选页的 page/totalPages 不一致时 fail closed，不能伪造候选比较覆盖',
    JSON.stringify(invalidNeutralCandidatePagePlan.coverage.candidateSet)
);
const invalidNeutralCandidateSetIdentity = makeBrowseCandidateReplay({
    candidateSetId: 'G0001-is-not-a-set',
    allowPresentationCaptureFailure: true
});
const invalidNeutralCandidateSetIdentityPlan = planDesignFinalComparisonEvidence({
    candidateSets: [invalidNeutralCandidateSetIdentity],
    selectedSourcePaths: ['C:\\project\\A.jpg'],
    availableImageSlots: 1
});
check(
    !invalidNeutralCandidateSetIdentityPlan.evidenceScope.candidateSetCompared
        && invalidNeutralCandidateSetIdentityPlan.coverage.candidateSet.reasonCodes
            .includes('candidate_set_coverage_invalid'),
    '中性候选页缺少集合级身份时 fail closed，裸 G 编号不能跨 scope 冒充同一候选',
    JSON.stringify(invalidNeutralCandidateSetIdentityPlan.coverage.candidateSet)
);

console.log('[17] Agent 主动发起的 requirement shortlist 与宽项目总览同时存在时按证据角色消歧');
const roleBoundCandidatePlan = planDesignFinalComparisonEvidence({
    candidateSets: [candidateOne, makeRecommendCandidateReplay()],
    selectedSourcePaths: ['C:\\project\\A.jpg'],
    availableImageSlots: 1
});
check(
    roleBoundCandidatePlan.evidenceScope.candidateSetCompared
        && roleBoundCandidatePlan.contentBlocks[0]?.text?.includes('coverage=shortlist'),
    'shortlist 是 Agent 针对当前选材问题主动建立的比较集，宽总览不会制造假歧义',
    JSON.stringify(roleBoundCandidatePlan.coverage.candidateSet)
);

console.log('[18] evidenceScope 只在 Final Judge 真正完成或取得版本绑定响应时置真');
const digestPresentationKeys = [
    'final-artifact',
    'selected-source',
    'candidate-set',
    'declared-reference'
];
const digestPresentationBlocks = digestPresentationKeys.map((key) => ({
    type: 'image',
    data: makeImage(`digest-${key}`),
    mediaType: 'image/jpeg'
}));
const digestPresentationReceipt = buildModelVisualPresentationReceipt({
    provider: 'openai-codex',
    attemptId: 'a'.repeat(64),
    candidateKeys: digestPresentationKeys,
    serializedImages: digestPresentationBlocks.map((block) => (
        projectSerializedVisualImageDataUrl(
            `data:${block.mediaType};base64,${block.data}`
        )
    ))
});
if (!digestPresentationReceipt) throw new Error('测试视觉回执构造失败');
const digestPresentationTransportReceiptRef = {
    attemptId: digestPresentationReceipt.attemptId,
    manifestSha256: digestPresentationReceipt.manifestSha256
};
const completedDigest = projectFinalQualityModelProtocolDigest({
    status: 'completed',
    results: [],
    diagnosisRepairStatus: 'not_required',
    diagnosisRepairTargetCount: 0,
    judgeVisualPresentationReceipt: digestPresentationReceipt,
    judgeVisualPresentationTransportReceiptRef: digestPresentationTransportReceiptRef
}, 0, true, true, {
    declaredReferenceCompared: true,
    candidateSetCompared: true
}, {
    candidateKeys: digestPresentationKeys,
    contentBlocks: digestPresentationBlocks
});
const unavailableDigest = projectFinalQualityModelProtocolDigest({
    status: 'judge_unavailable',
    results: null,
    error: new Error('offline'),
    diagnosisRepairStatus: 'not_run',
    diagnosisRepairTargetCount: 0
}, 0, true, true, {
    declaredReferenceCompared: true,
    candidateSetCompared: true
}, {
    candidateKeys: digestPresentationKeys,
    contentBlocks: digestPresentationBlocks
});
const mismatchedReceiptDigest = projectFinalQualityModelProtocolDigest({
    status: 'completed',
    results: [],
    diagnosisRepairStatus: 'not_required',
    diagnosisRepairTargetCount: 0,
    judgeVisualPresentationReceipt: digestPresentationReceipt,
    judgeVisualPresentationTransportReceiptRef: digestPresentationTransportReceiptRef
}, 0, true, true, {
    declaredReferenceCompared: true,
    candidateSetCompared: true
}, {
    candidateKeys: [...digestPresentationKeys].reverse(),
    contentBlocks: digestPresentationBlocks
});
const receiptWithoutSuccessfulTransportDigest = projectFinalQualityModelProtocolDigest({
    status: 'completed',
    results: [],
    diagnosisRepairStatus: 'not_required',
    diagnosisRepairTargetCount: 0,
    judgeVisualPresentationReceipt: digestPresentationReceipt
}, 0, true, true, {
    declaredReferenceCompared: true,
    candidateSetCompared: true
}, {
    candidateKeys: digestPresentationKeys,
    contentBlocks: digestPresentationBlocks
});
check(
    completedDigest.evidenceScope.declaredReferenceCompared
        && completedDigest.evidenceScope.candidateSetCompared
        && !unavailableDigest.evidenceScope.finalArtifactObserved
        && !unavailableDigest.evidenceScope.selectedSourceCompared
        && !unavailableDigest.evidenceScope.declaredReferenceCompared
        && !unavailableDigest.evidenceScope.candidateSetCompared
        && !mismatchedReceiptDigest.evidenceScope.finalArtifactObserved
        && !mismatchedReceiptDigest.evidenceScope.selectedSourceCompared
        && !mismatchedReceiptDigest.evidenceScope.declaredReferenceCompared
        && !mismatchedReceiptDigest.evidenceScope.candidateSetCompared
        && !receiptWithoutSuccessfulTransportDigest.evidenceScope.finalArtifactObserved
        && !receiptWithoutSuccessfulTransportDigest.evidenceScope.selectedSourceCompared
        && !receiptWithoutSuccessfulTransportDigest.evidenceScope.declaredReferenceCompared
        && !receiptWithoutSuccessfulTransportDigest.evidenceScope.candidateSetCompared,
    '只有首次 Judge 成功 attempt 的 exact ordered outgoing receipt 才能补绿',
    JSON.stringify({
        completed: completedDigest,
        unavailable: unavailableDigest,
        mismatched: mismatchedReceiptDigest,
        receiptWithoutSuccessfulTransport: receiptWithoutSuccessfulTransportDigest
    })
);

console.log('[19] 生产集成收集器只重放模型主动观察且被声明精确绑定的像素');
const collectedCandidateSets = collectDesignFinalCandidateSetReplays([
    candidateOne.toolCall
]);
const collectedDeclaredReferences = collectDesignFinalDeclaredReferenceReplays({
    declaration: makeReferenceBrief([{
        kind: 'eagle',
        contextRef: referenceOne.contextRef
    }]),
    toolCallLog: [referenceOne.toolCall]
});
check(
    collectedCandidateSets.length === 1
        && collectedCandidateSets[0].replayImage?.data === candidateOne.replayImage.data
        && collectedDeclaredReferences.length === 1
        && collectedDeclaredReferences[0].sourceKind === 'eagle'
        && collectedDeclaredReferences[0].sourceId === 'eagle:eagle-one',
    'Tool log collector 不扫描项目、不搜索 Eagle，也不从未声明记录补造证据',
    JSON.stringify({
        candidateCount: collectedCandidateSets.length,
        referenceCount: collectedDeclaredReferences.length
    })
);

console.log('[20] Runtime 日志压缩后仍从私有 presentation 重放而不是 Tool 原图取像素');
const compactedCandidate = makeCandidateReplay({ id: 'compacted-candidate' });
const compactedReference = makeReferenceReplay({ sourceId: 'compacted-reference' });
compactPostWriteImagePayloadForRuntimeLog(compactedCandidate.toolCall.result);
compactPostWriteImagePayloadForRuntimeLog(compactedReference.toolCall.result);
const compactedCandidateCollection = collectDesignFinalCandidateSetReplays([
    compactedCandidate.toolCall
]);
const compactedReferenceBrief = makeReferenceBrief([{
    kind: 'eagle',
    contextRef: compactedReference.contextRef
}]);
const compactedReferenceCollection = collectDesignFinalDeclaredReferenceReplays({
    declaration: compactedReferenceBrief,
    toolCallLog: [compactedReference.toolCall]
});
const compactedLifecyclePlan = planDesignFinalComparisonEvidence({
    referenceBrief: compactedReferenceBrief,
    candidateSets: compactedCandidateCollection,
    declaredReferences: compactedReferenceCollection,
    selectedSourcePaths: ['C:\\project\\A.jpg'],
    availableImageSlots: 2
});
check(
    !collectImagesFromToolResult(
        compactedCandidate.toolCall.result,
        24,
        compactedCandidate.toolCall.name
    ).images.length
        && !collectImagesFromToolResult(
            compactedReference.toolCall.result,
            24,
            compactedReference.toolCall.name
        ).images.length
        && compactedLifecyclePlan.evidenceScope.candidateSetCompared
        && compactedLifecyclePlan.evidenceScope.declaredReferenceCompared,
    '大像素按日志卫生释放后，终审只复用已送入主模型的 Runtime-owned presentation',
    JSON.stringify(compactedLifecyclePlan.coverage)
);

console.log('[21] top-level sourceId 不能覆盖 observation identity 冒充另一条参考');
const reboundReference = makeReferenceReplay({ sourceId: 'identity-source-a' });
const reboundObservation = reboundReference.toolCall.result.agentVisualObservations[0];
reboundObservation.sourceId = 'eagle:identity-source-b';
reboundReference.toolCall.arguments.itemId = 'identity-source-b';
reboundReference.toolCall.result.item.id = 'identity-source-b';
reboundReference.sourceId = 'eagle:identity-source-b';
const reboundReferencePlan = planDesignFinalComparisonEvidence({
    referenceBrief: makeReferenceBrief([{
        kind: 'eagle',
        contextRef: reboundReference.contextRef
    }]),
    declaredReferences: [reboundReference],
    availableImageSlots: 1
});
check(
    !reboundReferencePlan.evidenceScope.declaredReferenceCompared
        && reboundReferencePlan.coverage.declaredReference.reasonCodes
            .includes('runtime_visual_observation_missing'),
    '像素身份、observationKey 与顶层 source 不是同一来源时 fail closed',
    JSON.stringify(reboundReferencePlan.coverage.declaredReference)
);

console.log('[22] 候选 slot→path manifest 与 presentation 同时冻结，后改 metadata 不能补造候选');
const mutatedManifestCandidate = makeCandidateReplay({ id: 'manifest-before-mutation' });
mutatedManifestCandidate.toolCall.result.contactSheet.items[1].path = 'C:\\project\\C.jpg';
const mutatedManifestCollected = collectDesignFinalCandidateSetReplays([
    mutatedManifestCandidate.toolCall
]);
const mutatedManifestPlan = planDesignFinalComparisonEvidence({
    candidateSets: mutatedManifestCollected,
    selectedSourcePaths: ['C:\\project\\C.jpg'],
    availableImageSlots: 1
});
check(
    mutatedManifestCollected.length === 1
        && !mutatedManifestPlan.evidenceScope.candidateSetCompared
        && mutatedManifestPlan.coverage.candidateSet.reasonCodes
            .includes('candidate_set_binding_missing'),
    '终审使用模型当时所见的 A01/A02 清单，不读取事后可变 metadata',
    JSON.stringify(mutatedManifestPlan.coverage.candidateSet)
);

console.log('[23] 内部推荐 JSON 少解析一格不能否决主 Agent 真正看过的完整 shortlist');
const partialAdvisoryParseCandidate = makeRecommendCandidateReplay({
    internalComparedCount: 1
});
const partialAdvisoryParsePlan = planDesignFinalComparisonEvidence({
    candidateSets: [partialAdvisoryParseCandidate],
    selectedSourcePaths: ['C:\\project\\B.jpg'],
    availableImageSlots: 1
});
check(
    partialAdvisoryParsePlan.evidenceScope.candidateSetCompared
        && partialAdvisoryParsePlan.contentBlocks[0]?.text?.includes('displayed=2'),
    '候选覆盖以冻结的 rendered slots 与主模型真实消费为准，不受内部 advisory parse 漏项劫持',
    JSON.stringify(partialAdvisoryParsePlan.coverage.candidateSet)
);

console.log('[24] 已呈现且被成功模型回合消费的比较图，不因缺少额外 XML 自评而丢失');
const consumedCandidate = makeCandidateReplay({
    id: 'consumed-without-structured-review',
    structuredReview: false
});
const consumedReference = makeReferenceReplay({
    sourceId: 'consumed-without-structured-review',
    structuredReview: false
});
const consumedPlan = planDesignFinalComparisonEvidence({
    referenceBrief: makeReferenceBrief([{
        kind: 'eagle',
        contextRef: consumedReference.contextRef
    }]),
    declaredReferences: [consumedReference],
    candidateSets: [consumedCandidate],
    selectedSourcePaths: ['C:\\project\\A.jpg'],
    availableImageSlots: 2
});
const notConsumedReference = makeReferenceReplay({
    sourceId: 'presented-but-not-consumed',
    structuredReview: false,
    consumed: false
});
const notConsumedPlan = planDesignFinalComparisonEvidence({
    referenceBrief: makeReferenceBrief([{
        kind: 'eagle',
        contextRef: notConsumedReference.contextRef
    }]),
    declaredReferences: [notConsumedReference],
    availableImageSlots: 1
});
check(
    consumedPlan.evidenceScope.candidateSetCompared
        && consumedPlan.evidenceScope.declaredReferenceCompared
        && consumedPlan.contentBlocks.some((block) => (
            block.type === 'text' && block.text?.includes('agent_consumed_candidate_set')
        ))
        && consumedCandidate.toolCall.result.agentVisualObservations[0].reviewed === false
        && !notConsumedPlan.evidenceScope.declaredReferenceCompared
        && notConsumedPlan.coverage.declaredReference.reasonCodes
            .includes('runtime_visual_observation_missing'),
    '真实 presentation + consumed turn 可进终审，但不伪造 reviewed；未消费的图继续 fail closed',
    JSON.stringify({ consumed: consumedPlan.coverage, notConsumed: notConsumedPlan.coverage })
);

console.log('[25] Evaluation Profile 声明的列表缩略视图作为独立像素进入终审');
const thumbnailProjection = projectDesignFinalReviewDerivedViewPayload({
    requiredViews: ['native_surface', 'list_thumbnail'],
    thumbnail: { data: makeImage('profile-list-thumbnail'), mediaType: 'image/jpeg' },
    sourceObservationKey: 'review-set:current-document'
});
const missingThumbnailProjection = projectDesignFinalReviewDerivedViewPayload({
    requiredViews: ['native_surface', 'list_thumbnail'],
    thumbnail: null,
    sourceObservationKey: 'review-set:current-document'
});
check(
    thumbnailProjection.status === 'ready'
        && thumbnailProjection.candidateCount === 1
        && thumbnailProjection.candidateKeys[0]
            === 'review-set:current-document:review_view:list_thumbnail:240'
        && thumbnailProjection.contentBlocks[0]?.text?.includes('profile_required_review_view')
        && thumbnailProjection.contentBlocks[1]?.type === 'image'
        && missingThumbnailProjection.status === 'unavailable',
    '缩略图有独立 candidateKey 与出站图块，生成失败时不用原图冒充',
    JSON.stringify({ thumbnailProjection, missingThumbnailProjection })
);

console.log('[26] tools=[] 的视觉终审仍必须走统一 provider adapter');
const visualTransport = resolveAgentModelTransport({
    messages: [{
        role: 'user',
        contentBlocks: [
            { type: 'text' },
            { type: 'image' }
        ]
    }],
    toolCount: 0,
    hasProviderNativeTools: false
});
const textTransport = resolveAgentModelTransport({
    messages: [
        { role: 'system' },
        { role: 'user' }
    ],
    toolCount: 0,
    hasProviderNativeTools: false
});
check(
    visualTransport === 'provider_adapter' && textTransport === 'plain_chat',
    '视觉 payload 不再进入会删图或错误处理 system role 的 provider 私有 plain chat',
    JSON.stringify({ visualTransport, textTransport })
);

if (failed > 0) {
    console.error(`\nFinal Judge 比较证据测试失败：${failed} 项`);
    process.exit(1);
}

console.log('\nFinal Judge 比较证据测试通过。');
