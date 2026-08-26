const path = require('path');

const root = path.resolve(__dirname, '..');
require('ts-node').register({ transpileOnly: true, project: path.join(root, 'tsconfig.main.json') });

const {
    buildDesignReviewSetFromSingleSurface
} = require(path.join(root, 'src/shared/visual-observation-bundle.ts'));
const {
    projectTrustedFinalComparisonEvidenceForReflexion,
    readTrustedVisualReviewArtifact,
    transferTrustedVisualReviewArtifact,
    writeTrustedFinalComparisonEvidenceAfterJudge,
    writeTrustedFinalComparisonEvidence,
    writeTrustedVisualReviewArtifact
} = require(path.join(root, 'src/renderer/services/agent-runtime/trusted-visual-review-artifact.ts'));

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
    return Buffer.from(String(seed).repeat(180), 'utf8').toString('base64');
}

const parentHistory = { documentId: 71, historyStateId: 801 };
const childHistory = { documentId: 71, historyStateId: 802 };
const selectedSourceA = 'C:\\project\\raw\\A.jpg';
const selectedSourceB = 'C:\\project\\raw\\B.jpg';
const candidatePixels = makeImage('candidate-contact-sheet');
const eaglePixels = makeImage('eagle-reference');
const projectReferencePixels = makeImage('project-reference');

function createCoreArtifactOwner(historyStateRef = parentHistory) {
    const owner = {};
    const finalPixels = makeImage('final-artifact');
    const built = buildDesignReviewSetFromSingleSurface({
        identity: {
            outer: 'getCanvasSnapshot',
            resultPath: '$.snapshot',
            document: String(historyStateRef.documentId),
            history: String(historyStateRef.historyStateId),
            sourceKind: 'canvas',
            sourceId: 'final-canvas'
        },
        image: {
            base64: finalPixels,
            mediaType: 'image/jpeg',
            format: 'jpeg'
        }
    });
    if (built.status !== 'ready') throw new Error(`ReviewSet fixture invalid: ${built.reasons.join(',')}`);
    const observationKey = built.reviewSet.items[0].observationKey;
    const written = writeTrustedVisualReviewArtifact(owner, {
        receipt: {
            version: 'visual-observation-receipt/v1',
            document: String(historyStateRef.documentId),
            history: String(historyStateRef.historyStateId),
            sourceTool: 'getCanvasSnapshot'
        },
        reviewSet: built.reviewSet,
        historyStateRef,
        observationKeys: [observationKey],
        reviewedObservationKeys: [observationKey],
        fullyReviewed: false
    });
    if (!written) throw new Error('核心 TrustedVisualReviewArtifact fixture 写入失败');
    return owner;
}

function candidateImage(data = candidatePixels) {
    return {
        evidenceId: 'final_comparison:candidate_set:fixture',
        sourceKind: 'candidate_set',
        sourceId: 'final_comparison:candidate_set:fixture',
        image: { data, mediaType: 'image/jpeg' }
    };
}

function eagleReference(data = eaglePixels, sourceId = 'eagle:ITEM-001') {
    return {
        evidenceId: 'final_comparison:declared_reference:eagle',
        sourceKind: 'eagle',
        sourceId,
        observationSourceId: sourceId,
        image: { data, mediaType: 'image/jpeg' }
    };
}

function projectReference(
    data = projectReferencePixels,
    sourceId = 'C:\\project\\reference\\approved.jpg'
) {
    return {
        evidenceId: 'final_comparison:declared_reference:project',
        sourceKind: 'project_case',
        sourceId,
        observationSourceId: sourceId,
        image: { data, mediaType: 'image/jpeg' }
    };
}

function candidateManifest() {
    return [
        { slotId: 'A01', path: selectedSourceA },
        { slotId: 'A02', path: selectedSourceB }
    ];
}

function fullEvidenceInput() {
    return {
        taskRunId: 'task-run-r13-fixture',
        parentHistoryStateRef: parentHistory,
        judgeStatus: 'completed',
        evidenceScope: {
            declaredReferenceCompared: true,
            candidateSetCompared: true
        },
        candidateSet: {
            selectedSourcePaths: [selectedSourceA],
            sourceManifest: candidateManifest(),
            image: candidateImage()
        },
        declaredReferences: [eagleReference(), projectReference()],
        referenceContext: '参考决策：reuse_existing/ready；参考洞察：迁移主体关系与视觉层级，不复制表面内容。'
    };
}

function fullReplayInput() {
    return {
        taskRunId: 'task-run-r13-fixture',
        expectedParentHistoryStateRef: parentHistory,
        currentHistoryStateRef: childHistory,
        currentSelectedSourcePaths: ['c:/PROJECT/raw/A.jpg']
    };
}

console.log('[1] 现有 WeakMap owner 原地增加有界 Final Judge comparison evidence');
const owner = createCoreArtifactOwner();
check(
    writeTrustedFinalComparisonEvidence(owner, fullEvidenceInput()),
    '父代实际 comparison input 可写入现有 Artifact owner'
);
const trusted = readTrustedVisualReviewArtifact(owner);
const serialized = JSON.stringify(trusted?.finalComparisonEvidence || {});
check(
    trusted?.finalComparisonEvidence?.evidenceScope.candidateSetCompared === true
        && trusted.finalComparisonEvidence.evidenceScope.declaredReferenceCompared === true
        && trusted.finalComparisonEvidence.declaredReferences?.length === 2
        && trusted.finalComparisonEvidence.referenceContext?.includes('迁移主体关系')
        && trusted.finalComparisonEvidence.candidateSet?.sourceManifest.length === 2
        && trusted.finalComparisonEvidence.boundaries.noToolLog === true
        && trusted.finalComparisonEvidence.boundaries.budgetOwnedByCaller === true
        && trusted.finalComparisonEvidence.boundaries.requiresPostJudgeWrite === true,
    'scope、像素和 source binding 有界保存，不新增第二状态 owner',
    serialized.slice(0, 1000)
);
check(
    !serialized.includes('C:\\project')
        && !serialized.includes('ITEM-001')
        && !serialized.includes('approved.jpg'),
    'Artifact 只保存规范化路径 / source identity 摘要，不保存明文文件身份',
    serialized.slice(0, 1000)
);

console.log('[2] 同 TaskRun 子代在新 history 上复验 selected-source 并承接父代 exact presentation');
const completeProjection = projectTrustedFinalComparisonEvidenceForReflexion(
    owner,
    fullReplayInput()
);
check(
    completeProjection.evidenceScope.candidateSetCompared
        && completeProjection.evidenceScope.declaredReferenceCompared
        && completeProjection.requiredImageCount === 3
        && completeProjection.declaredReferences?.length === 2,
    '当前文档同一、history 已推进且 selected-source 未变时完整继承父代所见证据',
    JSON.stringify(completeProjection)
);
check(
    !Object.prototype.hasOwnProperty.call(completeProjection, 'maxImages')
        && completeProjection.requiredImageCount === 3,
    'Artifact 返回完整合格集合，预算和裁剪继续归调用方',
    JSON.stringify(completeProjection)
);

console.log('[3] candidate selected-source 集合变化只使候选证据失效，reference 可独立继承');
const changedSelectionReplay = fullReplayInput();
changedSelectionReplay.currentSelectedSourcePaths = [selectedSourceB];
const changedSelectionProjection = projectTrustedFinalComparisonEvidenceForReflexion(
    owner,
    changedSelectionReplay
);
check(
    !changedSelectionProjection.evidenceScope.candidateSetCompared
        && changedSelectionProjection.evidenceScope.declaredReferenceCompared
        && changedSelectionProjection.reasonCodes.includes('candidate_selected_source_mismatch'),
    'candidate 不跨最终源图集合复用，reference 不受候选选择变化污染',
    JSON.stringify(changedSelectionProjection)
);

console.log('[4] Artifact 内 Axx→path manifest 被篡改时不能重新签给另一个 owner');
const forgedManifestArtifact = readTrustedVisualReviewArtifact(owner);
const firstManifestPathDigest = forgedManifestArtifact.finalComparisonEvidence
    .candidateSet.sourceManifest[0].pathDigest;
forgedManifestArtifact.finalComparisonEvidence.candidateSet.sourceManifest[0].pathDigest =
    forgedManifestArtifact.finalComparisonEvidence.candidateSet.sourceManifest[1].pathDigest;
forgedManifestArtifact.finalComparisonEvidence.candidateSet.sourceManifest[1].pathDigest =
    firstManifestPathDigest;
const forgedManifestOwner = {};
check(
    !writeTrustedVisualReviewArtifact(forgedManifestOwner, forgedManifestArtifact)
        && !readTrustedVisualReviewArtifact(forgedManifestOwner),
    '联系表像素不能配一份被换位的候选身份清单'
);

console.log('[5] Artifact 内 candidate presentation 像素变化时拒绝伪造继承');
const forgedCandidateArtifact = readTrustedVisualReviewArtifact(owner);
forgedCandidateArtifact.finalComparisonEvidence.candidateSet.image.image.data =
    makeImage('changed-candidate');
const forgedCandidateOwner = {};
check(
    !writeTrustedVisualReviewArtifact(forgedCandidateOwner, forgedCandidateArtifact)
        && !readTrustedVisualReviewArtifact(forgedCandidateOwner),
    '候选联系表像素变化不能继承旧摘要'
);

console.log('[6] Artifact 内 declared reference 的身份摘要或像素变化时拒绝伪造继承');
const forgedReferencePixelsArtifact = readTrustedVisualReviewArtifact(owner);
forgedReferencePixelsArtifact.finalComparisonEvidence.declaredReferences[0].image.data =
    makeImage('changed-eagle');
const forgedReferenceIdentityArtifact = readTrustedVisualReviewArtifact(owner);
forgedReferenceIdentityArtifact.finalComparisonEvidence.declaredReferences[0]
    .sourceIdentityDigest = '0'.repeat(64);
const forgedReferenceKindArtifact = readTrustedVisualReviewArtifact(owner);
forgedReferenceKindArtifact.finalComparisonEvidence.declaredReferences[0].sourceKind = 'web';
const forgedReferenceMediaArtifact = readTrustedVisualReviewArtifact(owner);
forgedReferenceMediaArtifact.finalComparisonEvidence.declaredReferences[0]
    .image.mediaType = 'image/png';
const forgedReferencePixelsOwner = {};
const forgedReferenceIdentityOwner = {};
const forgedReferenceKindOwner = {};
const forgedReferenceMediaOwner = {};
check(
    !writeTrustedVisualReviewArtifact(
        forgedReferencePixelsOwner,
        forgedReferencePixelsArtifact
    )
        && !writeTrustedVisualReviewArtifact(
            forgedReferenceIdentityOwner,
            forgedReferenceIdentityArtifact
        )
        && !writeTrustedVisualReviewArtifact(
            forgedReferenceKindOwner,
            forgedReferenceKindArtifact
        )
        && !writeTrustedVisualReviewArtifact(
            forgedReferenceMediaOwner,
            forgedReferenceMediaArtifact
        )
        && projectTrustedFinalComparisonEvidenceForReflexion(
            owner,
            fullReplayInput()
        ).evidenceScope.declaredReferenceCompared,
    '另一 source identity 或另一组像素不能冒充父代声明参考'
);

console.log('[7] TaskRun、父 history、当前 document/history 任一不一致时全部 fail closed');
const wrongTaskReplay = fullReplayInput();
wrongTaskReplay.taskRunId = 'another-task-run';
const wrongTaskProjection = projectTrustedFinalComparisonEvidenceForReflexion(owner, wrongTaskReplay);
const wrongParentReplay = fullReplayInput();
wrongParentReplay.expectedParentHistoryStateRef = { ...parentHistory, historyStateId: 999 };
const wrongParentProjection = projectTrustedFinalComparisonEvidenceForReflexion(owner, wrongParentReplay);
const wrongDocumentReplay = fullReplayInput();
wrongDocumentReplay.currentHistoryStateRef = { documentId: 72, historyStateId: 802 };
const wrongDocumentProjection = projectTrustedFinalComparisonEvidenceForReflexion(owner, wrongDocumentReplay);
const missingHistoryReplay = fullReplayInput();
missingHistoryReplay.currentHistoryStateRef = { documentId: 71, historyStateId: 0 };
const missingHistoryProjection = projectTrustedFinalComparisonEvidenceForReflexion(owner, missingHistoryReplay);
const sameHistoryReplay = fullReplayInput();
sameHistoryReplay.currentHistoryStateRef = parentHistory;
const sameHistoryProjection = projectTrustedFinalComparisonEvidenceForReflexion(owner, sameHistoryReplay);
check(
    wrongTaskProjection.reasonCodes.includes('task_run_mismatch')
        && wrongTaskProjection.requiredImageCount === 0
        && wrongParentProjection.reasonCodes.includes('parent_history_mismatch')
        && wrongParentProjection.requiredImageCount === 0
        && wrongDocumentProjection.reasonCodes.includes('current_document_mismatch')
        && wrongDocumentProjection.requiredImageCount === 0
        && missingHistoryProjection.reasonCodes.includes('current_history_missing')
        && missingHistoryProjection.requiredImageCount === 0
        && sameHistoryProjection.requiredImageCount === 3,
    '跨任务、错父版本、换文档和未知当前版本不能借旧图；同 history 的纯复评明确允许',
    JSON.stringify({ wrongTaskProjection, wrongParentProjection, wrongDocumentProjection, missingHistoryProjection })
);

console.log('[8] 现有 transfer 复制完整受验证 Artifact；序列化 owner 仍无法命中 WeakMap');
const transferredOwner = {};
check(
    transferTrustedVisualReviewArtifact(owner, transferredOwner),
    'Artifact transfer 成功'
);
const transferredProjection = projectTrustedFinalComparisonEvidenceForReflexion(
    transferredOwner,
    fullReplayInput()
);
const serializedOwner = JSON.parse(JSON.stringify(owner));
const serializedOwnerProjection = projectTrustedFinalComparisonEvidenceForReflexion(
    serializedOwner,
    fullReplayInput()
);
const occupiedDifferentTarget = createCoreArtifactOwner({ documentId: 71, historyStateId: 999 });
check(
    transferredProjection.requiredImageCount === 3
        && serializedOwnerProjection.requiredImageCount === 0
        && serializedOwnerProjection.reasonCodes.includes('artifact_missing')
        && !transferTrustedVisualReviewArtifact(owner, occupiedDifferentTarget),
    'RunResult→新 handoff 可承接，JSON 克隆不能伪造，已有不同 lineage target 不被覆盖',
    JSON.stringify({ transferredProjection, serializedOwnerProjection })
);

console.log('[9] 非法 comparison evidence 不覆盖既有可信内容');
const beforeInvalidWrite = readTrustedVisualReviewArtifact(owner)?.finalComparisonEvidence?.parentJudgeInputDigest;
const missingGroupInput = fullEvidenceInput();
delete missingGroupInput.candidateSet;
const sourceMismatchInput = fullEvidenceInput();
sourceMismatchInput.declaredReferences = [
    {
        ...eagleReference(),
        observationSourceId: 'eagle:OTHER'
    }
];
const missingManifestBindingInput = fullEvidenceInput();
missingManifestBindingInput.candidateSet.selectedSourcePaths = ['C:\\project\\raw\\C.jpg'];
const tooManyReferencesInput = fullEvidenceInput();
tooManyReferencesInput.declaredReferences = [
    eagleReference(),
    projectReference(),
    {
        ...projectReference(projectReferencePixels, 'C:\\project\\reference\\second.jpg'),
        evidenceId: 'final_comparison:declared_reference:project-2'
    },
    {
        ...projectReference(projectReferencePixels, 'C:\\project\\reference\\third.jpg'),
        evidenceId: 'final_comparison:declared_reference:project-3'
    }
];
const differentValidEvidenceInput = fullEvidenceInput();
differentValidEvidenceInput.candidateSet.image = candidateImage(makeImage('another-valid-candidate'));
const mixedInvalidSelectedPathsInput = fullEvidenceInput();
mixedInvalidSelectedPathsInput.candidateSet.selectedSourcePaths = [
    selectedSourceA,
    'https://example.com/not-a-local-source.jpg'
];
check(
    !writeTrustedFinalComparisonEvidence(owner, missingGroupInput)
        && !writeTrustedFinalComparisonEvidence(owner, sourceMismatchInput)
        && !writeTrustedFinalComparisonEvidence(owner, missingManifestBindingInput)
        && !writeTrustedFinalComparisonEvidence(owner, tooManyReferencesInput)
        && !writeTrustedFinalComparisonEvidence(owner, differentValidEvidenceInput)
        && !writeTrustedFinalComparisonEvidence(owner, mixedInvalidSelectedPathsInput)
        && readTrustedVisualReviewArtifact(owner)?.finalComparisonEvidence?.parentJudgeInputDigest
            === beforeInvalidWrite,
    '缺 group、来源错、非法 selected 成员、超上限或第二份不同合法事实均拒绝覆盖'
);

console.log('[10] 读取结果是深拷贝，调用方修改像素或 scope 不污染 WeakMap 内部值');
const mutableRead = readTrustedVisualReviewArtifact(owner);
mutableRead.finalComparisonEvidence.candidateSet.image.image.data = makeImage('mutated-read');
mutableRead.finalComparisonEvidence.evidenceScope.candidateSetCompared = false;
const rereadProjection = projectTrustedFinalComparisonEvidenceForReflexion(owner, fullReplayInput());
check(
    rereadProjection.evidenceScope.candidateSetCompared
        && rereadProjection.evidenceScope.declaredReferenceCompared
        && rereadProjection.requiredImageCount === 3,
    '外部 mutation 不会改写内部 Artifact'
);

console.log('[11] 没有核心 Artifact 或父代 scope 全 false 时不创建 comparison-only 第二真相源');
const emptyOwner = {};
const noScopeInput = fullEvidenceInput();
noScopeInput.evidenceScope = {
    declaredReferenceCompared: false,
    candidateSetCompared: false
};
delete noScopeInput.candidateSet;
delete noScopeInput.declaredReferences;
check(
    !writeTrustedFinalComparisonEvidence(emptyOwner, fullEvidenceInput())
        && !writeTrustedFinalComparisonEvidence(owner, noScopeInput),
    'comparison evidence 只能附着既有 Review Artifact，且至少有一项父代实际比较 scope'
);

console.log('[12] candidate=current、reference=parent 的混合组统一重签并可进入第三代');
const mixedChildOwnerA = createCoreArtifactOwner(childHistory);
const currentCandidateOnlyInput = fullEvidenceInput();
currentCandidateOnlyInput.parentHistoryStateRef = childHistory;
currentCandidateOnlyInput.evidenceScope = {
    candidateSetCompared: true,
    declaredReferenceCompared: false
};
delete currentCandidateOnlyInput.declaredReferences;
delete currentCandidateOnlyInput.referenceContext;
const mixedCandidateCurrentWritten = writeTrustedFinalComparisonEvidenceAfterJudge({
    targetOwner: mixedChildOwnerA,
    taskRunId: 'task-run-r13-fixture',
    currentHistoryStateRef: childHistory,
    judgeStatus: 'completed',
    evidenceScope: {
        candidateSetCompared: true,
        declaredReferenceCompared: true
    },
    origins: {
        candidateSet: 'current_run',
        declaredReference: 'trusted_parent'
    },
    currentInput: currentCandidateOnlyInput,
    trustedParentOwner: owner,
    trustedParentReplay: fullReplayInput()
});
const mixedAThirdGeneration = projectTrustedFinalComparisonEvidenceForReflexion(
    mixedChildOwnerA,
    {
        taskRunId: 'task-run-r13-fixture',
        expectedParentHistoryStateRef: childHistory,
        currentHistoryStateRef: { documentId: 71, historyStateId: 803 },
        currentSelectedSourcePaths: [selectedSourceA]
    }
);
check(
    mixedCandidateCurrentWritten
        && mixedAThirdGeneration.evidenceScope.candidateSetCompared
        && mixedAThirdGeneration.evidenceScope.declaredReferenceCompared
        && mixedAThirdGeneration.requiredImageCount === 3,
    '本代候选与父代参考在当前 history 形成一份新 Artifact，第三代不丢组',
    JSON.stringify(mixedAThirdGeneration)
);

console.log('[13] candidate=parent、reference=current 的反向混合组同样可进入第三代');
const childHistoryB = { documentId: 71, historyStateId: 804 };
const mixedChildOwnerB = createCoreArtifactOwner(childHistoryB);
const currentReferenceOnlyInput = fullEvidenceInput();
currentReferenceOnlyInput.parentHistoryStateRef = childHistoryB;
currentReferenceOnlyInput.evidenceScope = {
    candidateSetCompared: false,
    declaredReferenceCompared: true
};
delete currentReferenceOnlyInput.candidateSet;
const mixedReferenceCurrentWritten = writeTrustedFinalComparisonEvidenceAfterJudge({
    targetOwner: mixedChildOwnerB,
    taskRunId: 'task-run-r13-fixture',
    currentHistoryStateRef: childHistoryB,
    judgeStatus: 'completed',
    evidenceScope: {
        candidateSetCompared: true,
        declaredReferenceCompared: true
    },
    origins: {
        candidateSet: 'trusted_parent',
        declaredReference: 'current_run'
    },
    currentInput: currentReferenceOnlyInput,
    trustedParentOwner: owner,
    trustedParentReplay: {
        ...fullReplayInput(),
        currentHistoryStateRef: childHistoryB
    }
});
const mixedBThirdGeneration = projectTrustedFinalComparisonEvidenceForReflexion(
    mixedChildOwnerB,
    {
        taskRunId: 'task-run-r13-fixture',
        expectedParentHistoryStateRef: childHistoryB,
        currentHistoryStateRef: { documentId: 71, historyStateId: 805 },
        currentSelectedSourcePaths: [selectedSourceA]
    }
);
check(
    mixedReferenceCurrentWritten
        && mixedBThirdGeneration.evidenceScope.candidateSetCompared
        && mixedBThirdGeneration.evidenceScope.declaredReferenceCompared
        && mixedBThirdGeneration.requiredImageCount === 3,
    '父代候选与本代参考在当前 history 形成一份新 Artifact，第三代不丢组',
    JSON.stringify(mixedBThirdGeneration)
);

if (failed > 0) {
    console.error(`\nTrusted Final Comparison Evidence 测试失败：${failed} 项`);
    process.exit(1);
}

console.log('\nTrusted Final Comparison Evidence 测试通过。');
