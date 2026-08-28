// 「让用户帮我选」纯逻辑测试：单问 / 多问归一、必须给倾向项、回复措辞、全自动口径。
const path = require('path');
const root = path.resolve(__dirname, '..');
require('ts-node').register({
    transpileOnly: true,
    project: path.join(root, 'tsconfig.main.json'),
    compilerOptions: { jsx: 'react-jsx' }
});
const {
    canAutoResolveUserChoiceRequest,
    canSubmitUserChoiceAnswers,
    normalizeUserChoiceRequest,
    formatUserChoiceReply,
    describeAutoDecision
} = require(path.join(root, 'src/shared/user-choice-request.ts'));
const {
    buildSkuComboEditorInteractiveCard,
    deriveSkuComboDecisionContext,
    validateSkuComboEditorValue
} = require(path.join(root, 'src/shared/sku-combo-interactive-card.ts'));
const {
    buildSkuComboConfirmationRequest
} = require(path.join(root, 'src/shared/sku-combo-confirmation-request.ts'));
const {
    buildInteractiveCardSubmissionFingerprint,
    buildInteractiveIntegrityFingerprint,
    isInteractiveCardSubmissionFingerprint,
    isInteractiveIntegrityFingerprint,
    stableInteractiveCardHash
} = require(path.join(root, 'src/shared/interactive-card-contract.ts'));
const {
    buildSkuTemplateDirectionCard,
    isApprovedSkuTemplateDirectionSubmission
} = require(path.join(root, 'src/shared/sku-template-direction-interactive-card.ts'));
const {
    listSkillInteractiveCardProviders,
    prepareSkillInteractiveCardSubmission,
    prepareSkillInteractiveReview
} = require(path.join(root, 'src/renderer/services/skill-executors/interaction-cards/registry.ts'));
const {
    buildInteractiveContinuationClaim,
    buildPendingInteractiveContinuation,
    resolveInteractiveContinuationOperationRequest
} = require(path.join(root, 'src/shared/pending-interactive-continuation.ts'));
const {
    buildClaimedInteractiveContinuationOperationRecord,
    validateInteractiveContinuationOperationRecord
} = require(path.join(root, 'src/shared/interactive-continuation-operation.ts'));
const {
    evaluateGenericBlockingCardOwner,
    evaluateRepeatedInteractionDecision
} = require(path.join(root, 'src/shared/agent-interaction-owner-policy.ts'));
const {
    canRenderSkillInteractiveCardPackage,
    skillInteractiveCardPackages
} = require(path.join(root, 'src/renderer/services/skill-executors/interaction-cards/packages.ts'));

let failed = 0;
function check(name, condition, detail) { if (condition) { console.log(`✅ ${name}`); return; } failed += 1; console.log(`❌ ${name}${detail ? ' — ' + detail : ''}`); }

const bad = normalizeUserChoiceRequest({
    decisionKind: 'preference', impact: 'material', question: '主图用哪种图？', why: '不同主体会改变画面表达',
    options: [{ label: '模特上脚' }]
});
check('只有一个选项被驳回', !bad.ok && bad.issues.some((i) => /至少给 2 个/.test(i)), JSON.stringify(bad.issues));
check('没给倾向项被驳回', !bad.ok && bad.issues.some((i) => /recommendedId/.test(i)));
check('没有问题类型被驳回', !normalizeUserChoiceRequest({ impact: 'material', question: '选哪个方向？', why: '方向会改变成稿', options: ['A', 'B'] }).ok);
check('没有实质影响声明被驳回', !normalizeUserChoiceRequest({ decisionKind: 'preference', question: '选哪个方向？', why: '方向会改变成稿', options: ['A', 'B'], recommendedId: 'A' }).ok);

const single = normalizeUserChoiceRequest({
    decisionKind: 'preference', impact: 'material',
    question: '主图用模特上脚图还是平铺图？', why: '主体选择会改变主图的视觉表达',
    options: [{ id: 'model', label: '模特上脚', detail: '有穿着感' }, { id: 'flat', label: '平铺', detail: '看清图案' }],
    recommendedId: 'flat'
});
check('单问归一成 1 题', single.ok && single.request.questions.length === 1 && single.request.questions[0].recommendedId === 'flat', JSON.stringify(single.issues));
check('recommended 也可按 label 匹配', normalizeUserChoiceRequest({ decisionKind: 'preference', impact: 'material', question: '用哪种方案？', why: '方案会改变最终构图方向', options: ['A 方案', 'B 方案'], recommendedId: 'B 方案' }).request.questions[0].recommendedId === 'opt-2');

const multi = normalizeUserChoiceRequest({
    intro: '开工前三件事要你定',
    questions: [
        { id: 'ip', decisionKind: 'approval', impact: 'high', question: '能不能用 Hello Kitty 形象？', why: '涉及第三方形象授权，不能由 Agent 推断', options: [{ id: 'y', label: '能，有授权' }, { id: 'n', label: '不能，只用袜子本身' }] },
        { id: 'platform', decisionKind: 'required_fact', impact: 'high', question: '主图走哪个平台规格？', why: '交付平台决定画布尺寸和验收规格', options: ['淘宝 800', '拼多多 750', '抖音 1440'] },
        { decisionKind: 'preference', impact: 'material', question: '这轮先出几张？', why: '数量会改变本轮生产范围和耗时', options: ['1 张先看', '5 张一套'], recommendedId: '1 张先看' }
    ]
});
check('多问归一 3 题且 id 齐', multi.ok && multi.request.questions.length === 3 && multi.request.questions[2].id === 'q-3', JSON.stringify(multi.issues));
check('超过 3 题被驳回', !normalizeUserChoiceRequest({ questions: Array.from({ length: 4 }).map((_, i) => ({ decisionKind: 'preference', impact: 'material', question: `问题 ${i} 是什么？`, why: '这个选择会改变最终结果', options: ['a', 'b'], recommendedId: 'a' })) }).ok);
check('事实问题不能带模型推荐', !normalizeUserChoiceRequest({ decisionKind: 'required_fact', impact: 'high', question: '是否拥有品牌授权？', why: '授权事实只能由用户确认', options: ['有', '没有'], recommendedId: '有' }).ok);
check('纯偏好可由自动模式处理', canAutoResolveUserChoiceRequest(single.request));
check('事实或授权必须等待用户', !canAutoResolveUserChoiceRequest(multi.request));

const q = single.request;
check('回复措辞：选项', formatUserChoiceReply(q, [{ questionId: q.questions[0].id, optionId: 'model' }]) === '关于「主图用模特上脚图还是平铺图？」：我选「模特上脚」');
check('回复措辞：自由文本', /：用两张拼$/.test(formatUserChoiceReply(q, [{ questionId: q.questions[0].id, freeText: '用两张拼' }])));
check('回复措辞：交给它定', /你自己定$/.test(formatUserChoiceReply(q, [])));
const multiReply = formatUserChoiceReply(multi.request, [{ questionId: 'ip', optionId: 'n' }]);
check('多问回复逐题一行、未答事实不伪装成委托', multiReply.split('\n').length === 3 && /不能，只用袜子本身/.test(multiReply) && /未回答/.test(multiReply), multiReply);
check('事实与授权未回答时不能提交', !canSubmitUserChoiceAnswers(multi.request, [{ questionId: 'ip', optionId: 'n' }]));
check('事实与授权回答后可提交，偏好可留给 Agent', canSubmitUserChoiceAnswers(multi.request, [
    { questionId: 'ip', optionId: 'n' },
    { questionId: 'platform', optionId: 'opt-1' }
]));
check('全自动口径只按可自动处理的偏好倾向项', /「平铺」/.test(describeAutoDecision(q)));

const skuCard = buildSkuComboEditorInteractiveCard({
    colorSlots: [
        { slot: 1, colorIdentity: 'test-red', label: '红色' },
        { slot: 2, colorIdentity: 'test-blue', label: '蓝色' },
        { slot: 3, colorIdentity: 'test-white', label: '白色' }
    ],
    requiredSizes: [2],
    initialValue: {
        groups: [{ size: 2, combos: [[1, 2]] }],
        generateSelfSelectNotes: true
    }
});
const preparedSkuSubmission = prepareSkillInteractiveCardSubmission(
    skuCard,
    skuCard.payload.initialValue
);
const skuDecisionContext = deriveSkuComboDecisionContext(skuCard, skuCard.payload.initialValue);
check(
    'SKU 决定、候选和答案身份均为版本化 canonical SHA-256',
    /^sku-combo-decision-sha256-jcs-v1:[a-f0-9]{64}$/.test(skuDecisionContext.decisionFingerprint)
        && /^sku-combo-candidate-sha256-jcs-v1:[a-f0-9]{64}$/.test(skuDecisionContext.candidateFingerprint)
        && /^sku-combo-candidate-sha256-jcs-v1:[a-f0-9]{64}$/.test(skuDecisionContext.answerFingerprint)
        && /^sku-combo-card-sha256-jcs-v1:[a-f0-9]{64}$/.test(skuCard.id)
);
const skuTemplateDirectionCard = buildSkuTemplateDirectionCard({
    memoryScope: { type: 'project', id: 'project-sku-template-direction-audit' },
    comboSizes: [2, 3, 4],
    colorCount: 5,
    productLabel: '袜子',
    styleText: '干净、柔和'
});
const preparedSkuTemplateDirection = prepareSkillInteractiveCardSubmission(
    skuTemplateDirectionCard,
    skuTemplateDirectionCard.payload.initialValue,
    { expectedOwnerSkillId: 'sku-batch', requireExpectedOwner: true }
);
check(
    'SKU 模板方向卡经 Provider 提交后会被原 Skill 识别为已确认',
    preparedSkuTemplateDirection.status === 'ready'
        && isApprovedSkuTemplateDirectionSubmission({
            card: skuTemplateDirectionCard,
            submission: preparedSkuTemplateDirection.submission
        })
);
check(
    'SKU 组合卡由 Skill Provider 准备提交',
    preparedSkuSubmission.status === 'ready'
        && preparedSkuSubmission.submission.kind === 'sku_combo_editor'
        && preparedSkuSubmission.resumePolicy === 'required'
);
check(
    '未注册业务卡不会被通用提交器猜测处理',
    prepareSkillInteractiveCardSubmission({
        version: 'interactive-card/v0', id: 'unknown', kind: 'unknown_business_card', title: '未知', payload: {}
    }, {}).status === 'unsupported'
);
check(
    '业务卡提交必须与 continuation Skill owner 一致',
    prepareSkillInteractiveCardSubmission(
        skuCard,
        skuCard.payload.initialValue,
        { expectedOwnerSkillId: 'main-image-design', requireExpectedOwner: true }
    ).status === 'invalid'
);
check(
    '业务卡缺少 continuation owner 时失败关闭',
    prepareSkillInteractiveCardSubmission(
        skuCard,
        skuCard.payload.initialValue,
        { requireExpectedOwner: true }
    ).status === 'invalid'
);
check(
    '业务卡自身缺少 Provider owner 时不能只凭 kind/version 提交',
    prepareSkillInteractiveCardSubmission(
        { ...skuCard, interactionOwner: undefined },
        skuCard.payload.initialValue,
        { expectedOwnerSkillId: 'sku-batch', requireExpectedOwner: true }
    ).status === 'invalid'
);
check(
    '非空但不是 Provider 规范派生的决定指纹同样不能提交',
    prepareSkillInteractiveCardSubmission(
        { ...skuCard, decisionFingerprint: 'forged-non-empty-decision' },
        skuCard.payload.initialValue,
        { expectedOwnerSkillId: 'sku-batch', requireExpectedOwner: true }
    ).status === 'invalid'
);
const skuComboCardPackage = skillInteractiveCardPackages.find(
    (item) => item.provider.kind === 'sku_combo_editor'
);
check(
    '缺 owner 或缺决定指纹的业务卡不会渲染为可执行 UI',
    Boolean(skuComboCardPackage)
        && !canRenderSkillInteractiveCardPackage(
            { ...skuCard, interactionOwner: undefined },
            skuComboCardPackage.provider
        )
        && !canRenderSkillInteractiveCardPackage(
            { ...skuCard, decisionFingerprint: undefined },
            skuComboCardPackage.provider
        )
);
check(
    '产后复核卡自身缺少 Provider owner 时同样失败关闭',
    prepareSkillInteractiveReview({
        version: 'interactive-card/v0',
        id: 'ownerless-sku-review',
        kind: 'sku_human_review',
        title: '旧复核卡',
        payload: { version: 'sku-human-review-card/v0' }
    }, {}).status === 'invalid'
);
const sameSkuDecisionCard = buildSkuComboEditorInteractiveCard({
    title: '另一个展示标题',
    colorSlots: skuCard.payload.colorSlots,
    requiredSizes: [2],
    initialValue: {
        groups: [{ size: 2, combos: [[1, 2]] }],
        generateSelfSelectNotes: true
    }
});
const changedSkuDecisionCard = buildSkuComboEditorInteractiveCard({
    colorSlots: skuCard.payload.colorSlots,
    requiredSizes: [2],
    initialValue: {
        groups: [{ size: 2, combos: [[1, 3]] }],
        generateSelfSelectNotes: true
    }
});
const changedSkuSourceIdentityCard = buildSkuComboEditorInteractiveCard({
    colorSlots: skuCard.payload.colorSlots.map((slot, index) => (
        index === 0 ? { ...slot, colorIdentity: 'test-red-other-source' } : slot
    )),
    requiredSizes: [2],
    initialValue: {
        groups: [{ size: 2, combos: [[1, 2]] }],
        generateSelfSelectNotes: true
    }
});
const missingCandidateSkuCard = buildSkuComboEditorInteractiveCard({
    colorSlots: skuCard.payload.colorSlots,
    requiredSizes: [2]
});
check(
    'SKU 决定指纹不受卡片展示标题影响',
    sameSkuDecisionCard.decisionFingerprint === skuCard.decisionFingerprint
);
check(
    'SKU 候选变化不会伪装成另一项决定，但会产生新的候选指纹',
    changedSkuDecisionCard.decisionFingerprint === skuCard.decisionFingerprint
        && changedSkuDecisionCard.candidateFingerprint !== skuCard.candidateFingerprint
);
check(
    '同名颜色换成另一个真实来源时必须产生新的候选指纹',
    changedSkuSourceIdentityCard.candidateFingerprint !== skuCard.candidateFingerprint
);
check(
    'SKU 卡 Builder 不再用前 N 个颜色生成隐藏候选',
    missingCandidateSkuCard.payload.initialValue.groups.every((group) => group.combos.length === 0)
);
const warningSkuConfirmation = buildSkuComboConfirmationRequest({
    availableColorSources: [
        { label: '红色', stableSourceIdentity: 'test-source:red' },
        { label: '蓝色', stableSourceIdentity: 'test-source:blue' }
    ],
    requiredSizes: [2],
    combosBySize: { 2: [['红色', '红色']] },
    generateSelfSelectNotes: true
});
check(
    '影响用户判断的 SKU 候选警告会显示在专属卡片上',
    warningSkuConfirmation.status === 'pending_user_confirmation'
        && /同色多双/.test(warningSkuConfirmation.card?.description || '')
);
const previousHashCollisionSkuConfirmation = buildSkuComboConfirmationRequest({
    availableColorSources: [
        { label: '颜色 A', stableSourceIdentity: 'qu88uye07t7o3dvuclh6v' },
        { label: '颜色 B', stableSourceIdentity: 'oxts63ez4pa6q54arvq1jm' }
    ],
    requiredSizes: [2],
    combosBySize: { 2: [['颜色 A', '颜色 B']] },
    generateSelfSelectNotes: true
});
const previousCollisionHashLeft = stableInteractiveCardHash({
    version: 'sku-color-source/v1',
    stableSourceIdentity: 'qu88uye07t7o3dvuclh6v'
});
const previousCollisionHashRight = stableInteractiveCardHash({
    version: 'sku-color-source/v1',
    stableSourceIdentity: 'oxts63ez4pa6q54arvq1jm'
});
check(
    '旧 32 位哈希碰撞样例在 canonical SHA-256 下得到不同颜色身份',
    previousCollisionHashLeft === previousCollisionHashRight
        && buildInteractiveIntegrityFingerprint({
            version: 'sku-color-source/v1',
            stableSourceIdentity: 'qu88uye07t7o3dvuclh6v'
        }) !== buildInteractiveIntegrityFingerprint({
            version: 'sku-color-source/v1',
            stableSourceIdentity: 'oxts63ez4pa6q54arvq1jm'
        })
        && previousHashCollisionSkuConfirmation.status === 'pending_user_confirmation'
        && previousHashCollisionSkuConfirmation.card?.payload.colorSlots.length === 2
        && previousHashCollisionSkuConfirmation.card.payload.colorSlots[0].colorIdentity
            !== previousHashCollisionSkuConfirmation.card.payload.colorSlots[1].colorIdentity
        && previousHashCollisionSkuConfirmation.card.payload.colorSlots.every((slot) => (
            /^sku-color-source-sha256-jcs-v1:[a-f0-9]{64}$/.test(slot.colorIdentity)
        ))
);
const duplicateSlotSkuCard = buildSkuComboEditorInteractiveCard({
    colorSlots: [
        { slot: 1, colorIdentity: 'source-a', label: '颜色 A' },
        { slot: 1, colorIdentity: 'source-b', label: '颜色 B' }
    ],
    requiredSizes: [2],
    initialValue: { groups: [{ size: 2, combos: [[1, 1]] }] }
});
const duplicateSlotValidation = validateSkuComboEditorValue(
    duplicateSlotSkuCard.payload,
    duplicateSlotSkuCard.payload.initialValue
);
check(
    '重复颜色槽位不会被规范化静默删除，而是明确阻止提交',
    duplicateSlotSkuCard.payload.colorSlots.length === 2
        && !duplicateSlotValidation.canSubmit
        && duplicateSlotValidation.issues.some((issue) => issue.code === 'duplicate_payload_color_slot')
        && prepareSkillInteractiveCardSubmission(
            duplicateSlotSkuCard,
            duplicateSlotSkuCard.payload.initialValue
        ).status === 'invalid'
);
const duplicateIdentitySkuCard = buildSkuComboEditorInteractiveCard({
    colorSlots: [
        { slot: 1, colorIdentity: 'same-source', label: '颜色 A' },
        { slot: 2, colorIdentity: 'same-source', label: '颜色 B' }
    ],
    requiredSizes: [2],
    initialValue: { groups: [{ size: 2, combos: [[1, 2]] }] }
});
const duplicateIdentityValidation = validateSkuComboEditorValue(
    duplicateIdentitySkuCard.payload,
    duplicateIdentitySkuCard.payload.initialValue
);
check(
    '重复颜色来源身份不会被规范化静默删除，而是明确阻止提交',
    duplicateIdentitySkuCard.payload.colorSlots.length === 2
        && !duplicateIdentityValidation.canSubmit
        && duplicateIdentityValidation.issues.some((issue) => issue.code === 'duplicate_color_identity')
        && prepareSkillInteractiveCardSubmission(
            duplicateIdentitySkuCard,
            duplicateIdentitySkuCard.payload.initialValue
        ).status === 'invalid'
);
const duplicateSourceConfirmation = buildSkuComboConfirmationRequest({
    availableColorSources: [
        { label: '颜色 A', stableSourceIdentity: 'same-provider-source' },
        { label: '颜色 B', stableSourceIdentity: 'same-provider-source' }
    ],
    requiredSizes: [2],
    combosBySize: { 2: [['颜色 A', '颜色 B']] },
    generateSelfSelectNotes: true
});
check(
    '同一 Provider 来源不能生成可操作的 SKU 确认卡',
    duplicateSourceConfirmation.status === 'blocked_invalid_candidate'
        && !duplicateSourceConfirmation.card
        && duplicateSourceConfirmation.review.blockers.some((message) => /来源身份/.test(message))
);
let mismatchedContinuationRejected = false;
try {
    buildPendingInteractiveContinuation({
        skillId: 'main-image-design',
        params: {},
        result: { data: { interactiveCards: [skuCard] } },
        outcomeStatus: 'awaiting_confirmation'
    });
} catch {
    mismatchedContinuationRejected = true;
}
check('挂起操作拒绝另一 Skill 的 SKU Provider 卡', mismatchedContinuationRejected);
let ownerCardWithoutDecisionFingerprintRejected = false;
try {
    buildPendingInteractiveContinuation({
        skillId: 'sku-batch',
        params: {},
        result: {
            data: {
                interactiveCards: [{ ...skuCard, decisionFingerprint: undefined }]
            }
        },
        outcomeStatus: 'awaiting_confirmation'
    });
} catch {
    ownerCardWithoutDecisionFingerprintRejected = true;
}
check(
    'Provider-owned 阻塞卡缺决定指纹时不能创建可恢复等待点',
    ownerCardWithoutDecisionFingerprintRejected
);
const ownedSkuContinuation = buildPendingInteractiveContinuation({
    skillId: 'sku-batch',
    params: {},
    result: { data: { interactiveCards: [skuCard] } },
    outcomeStatus: 'awaiting_confirmation'
});
check(
    'SKU Provider 卡只绑定到 sku-batch continuation',
    ownedSkuContinuation?.operation?.skillId === 'sku-batch'
        && ownedSkuContinuation?.card?.interactionOwner?.skillId === 'sku-batch'
);
const integrityClaim = buildInteractiveContinuationClaim({
    ownerMessage: {
        id: 'sku-integrity-owner-message',
        interactiveCards: [skuCard],
        pendingInteractiveContinuation: ownedSkuContinuation,
        interactiveCardSubmissions: []
    },
    submission: preparedSkuSubmission.submission
});
check(
    '可执行 continuation 只签发版本化 SHA-256 卡片与提交完整性指纹',
    integrityClaim.status === 'accepted'
        && isInteractiveIntegrityFingerprint(
            String(ownedSkuContinuation?.id || '').replace(/^continuation-/, '')
        )
        && isInteractiveIntegrityFingerprint(integrityClaim.request.sourceCardFingerprint)
        && isInteractiveCardSubmissionFingerprint(integrityClaim.request.submissionFingerprint)
        && integrityClaim.request.submissionFingerprint
            === buildInteractiveCardSubmissionFingerprint(preparedSkuSubmission.submission)
);
const legacyCardFingerprintResolution = integrityClaim.status === 'accepted'
    ? resolveInteractiveContinuationOperationRequest({
        continuation: ownedSkuContinuation,
        submission: preparedSkuSubmission.submission,
        request: {
            ...integrityClaim.request,
            sourceCardFingerprint: stableInteractiveCardHash(skuCard)
        }
    })
    : undefined;
check(
    '旧 32 位来源卡指纹不能恢复一次性 continuation',
    legacyCardFingerprintResolution?.status === 'rejected'
        && legacyCardFingerprintResolution.code
            === 'interactive_continuation_source_card_fingerprint_version_unsupported'
);
const legacySubmissionFingerprintResolution = integrityClaim.status === 'accepted'
    ? resolveInteractiveContinuationOperationRequest({
        continuation: ownedSkuContinuation,
        submission: preparedSkuSubmission.submission,
        request: {
            ...integrityClaim.request,
            submissionFingerprint: stableInteractiveCardHash(preparedSkuSubmission.submission)
        }
    })
    : undefined;
check(
    '旧 32 位提交指纹不能恢复一次性 continuation',
    legacySubmissionFingerprintResolution?.status === 'rejected'
        && legacySubmissionFingerprintResolution.code
            === 'interactive_continuation_submission_fingerprint_version_unsupported'
);
const strongOperationRecord = integrityClaim.status === 'accepted'
    ? buildClaimedInteractiveContinuationOperationRecord({
        claim: {
            ...integrityClaim.request,
            submission: preparedSkuSubmission.submission,
            continuation: ownedSkuContinuation,
            sourceCard: skuCard
        },
        now: '2026-08-27T00:00:00.000Z'
    })
    : undefined;
check(
    '新持久操作记录通过版本化完整性校验，旧 v0 弱指纹记录得到明确拒绝原因',
    Boolean(strongOperationRecord)
        && validateInteractiveContinuationOperationRecord(strongOperationRecord) === undefined
        && /旧版或未知算法/.test(validateInteractiveContinuationOperationRecord({
            ...strongOperationRecord,
            submissionFingerprint: stableInteractiveCardHash(preparedSkuSubmission.submission)
        }) || '')
);
check(
    '设计执行未选择 Task Profile 时通用阻塞卡失败关闭',
    evaluateGenericBlockingCardOwner({
        skillBridgesForbidden: false,
        requiresResolvedOwner: true
    }).code === 'interactive_owner_unresolved'
);
check(
    'Task Profile 的 Skill Provider 拥有交互时通用卡不能旁路',
    evaluateGenericBlockingCardOwner({
        skillBridgesForbidden: false,
        requiresResolvedOwner: true,
        resolvedTaskType: 'ecommerce.sku_batch.v1',
        providerOwnerSkillIds: ['sku-batch']
    }).code === 'skill_provider_interaction_owner_required'
);
check(
    '用户明确禁用 Skill 时保留通用卡验证通道',
    evaluateGenericBlockingCardOwner({
        skillBridgesForbidden: true,
        requiresResolvedOwner: true,
        providerOwnerSkillIds: ['sku-batch']
    }).status === 'allowed'
);
check(
    '同一 TaskRun 的同一决定在零副作用下重发会被识别为无进展',
    evaluateRepeatedInteractionDecision({
        previousDecisionFingerprint: skuCard.decisionFingerprint,
        previousAnswerFingerprint: preparedSkuSubmission.submission.decisionContext?.answerFingerprint,
        nextDecisionFingerprint: sameSkuDecisionCard.decisionFingerprint,
        nextCandidateFingerprint: sameSkuDecisionCard.candidateFingerprint,
        skillEffect: 'none',
        mutationCount: 0,
        revisionCount: 0
    }).code === 'interaction_no_progress'
);
check(
    '同一决定出现不同于用户答案的新候选时允许进入新的确认点',
    evaluateRepeatedInteractionDecision({
        previousDecisionFingerprint: skuCard.decisionFingerprint,
        previousAnswerFingerprint: preparedSkuSubmission.submission.decisionContext?.answerFingerprint,
        nextDecisionFingerprint: changedSkuDecisionCard.decisionFingerprint,
        nextCandidateFingerprint: changedSkuDecisionCard.candidateFingerprint,
        skillEffect: 'none',
        mutationCount: 0,
        revisionCount: 0
    }).status === 'allowed'
);
const editedSkuSubmission = prepareSkillInteractiveCardSubmission(
    skuCard,
    changedSkuDecisionCard.payload.initialValue
);
check(
    'Skill 把用户刚编辑的答案重新当候选时仍会被识别为无进展',
    editedSkuSubmission.status === 'ready'
        && evaluateRepeatedInteractionDecision({
            previousDecisionFingerprint: skuCard.decisionFingerprint,
            previousAnswerFingerprint: editedSkuSubmission.submission.decisionContext?.answerFingerprint,
            nextDecisionFingerprint: changedSkuDecisionCard.decisionFingerprint,
            nextCandidateFingerprint: changedSkuDecisionCard.candidateFingerprint,
            skillEffect: 'none',
            mutationCount: 0,
            revisionCount: 0
        }).code === 'interaction_no_progress'
);
check(
    '同一决定在已有真实写入时不被误判为停滞',
    evaluateRepeatedInteractionDecision({
        previousDecisionFingerprint: skuCard.decisionFingerprint,
        nextDecisionFingerprint: sameSkuDecisionCard.decisionFingerprint,
        skillEffect: 'applied',
        mutationCount: 1,
        revisionCount: 1
    }).status === 'allowed'
);

const chatPanelSource = require('fs').readFileSync(path.join(root, 'src/renderer/components/ChatPanel.tsx'), 'utf8');
const cardHostSource = require('fs').readFileSync(path.join(root, 'src/renderer/components/message/blocks/InteractiveCardBlock.tsx'), 'utf8');
const toolExecutorSource = require('fs').readFileSync(path.join(root, 'src/renderer/services/tool-executor.service.ts'), 'utf8');
const toolSchemaSource = require('fs').readFileSync(path.join(root, 'src/renderer/services/agent-runtime/tool-schemas.ts'), 'utf8');
const skillCardRegistrySource = require('fs').readFileSync(path.join(root, 'src/renderer/services/skill-executors/interaction-cards/registry.ts'), 'utf8');
const skillCardPackagesSource = require('fs').readFileSync(path.join(root, 'src/renderer/services/skill-executors/interaction-cards/packages.ts'), 'utf8');
const skuBatchExecutorSource = require('fs').readFileSync(path.join(root, 'src/renderer/services/skill-executors/sku-batch.executor.ts'), 'utf8');
const uxpSkuLayoutSource = require('fs').readFileSync(path.resolve(root, '../DesignEcho-UXP/src/tools/layout/sku-layout-tool.ts'), 'utf8');
const skuTemplateDirectionCardSource = require('fs').readFileSync(path.join(root, 'src/shared/sku-template-direction-interactive-card.ts'), 'utf8');
const autonomousExecutorSource = require('fs').readFileSync(path.join(root, 'src/renderer/services/skill-executors/autonomous-agent.executor.ts'), 'utf8');
const capabilityBridgeSource = require('fs').readFileSync(path.join(root, 'src/shared/agent-runtime-v5/tool-capability-bridge.ts'), 'utf8');
check('ChatPanel 不再导入 SKU 组合卡领域代码', !/sku-combo-interactive-card|SkuComboEditor|validateSkuComboEditorValue/.test(chatPanelSource));
check(
    'SKU 图层清单在同一次稳定观察里返回 documentId、historyStateRef 与真实 layerId',
    /observeActiveDocumentAtHistoryState\(\{/.test(uxpSkuLayoutSource)
        && /documentId:\s*historyStateRef\.documentId/.test(uxpSkuLayoutSource)
        && /historyStateRef,/.test(uxpSkuLayoutSource)
        && /layerId,/.test(uxpSkuLayoutSource)
);
check(
    'SKU 执行器核验真实切换收据与唯一图层身份后才构建颜色来源',
    /callbacks\?\.onToolComplete\?\.\('switchDocument', switchResult\)/.test(skuBatchExecutorSource)
        && /switchedDocumentId !== expectedSkuDocumentId/.test(skuBatchExecutorSource)
        && /matches\.length !== 1/.test(skuBatchExecutorSource)
        && /historyDocumentId !== observedDocumentId/.test(skuBatchExecutorSource)
        && /blocked_sku_color_source_identity_unavailable/.test(skuBatchExecutorSource)
);
check('ChatPanel 不再处理 SKU 专属卡片动作', !/submitSkuHumanReviewCard|sku-human-review-card|isSkuHumanReviewCard/.test(chatPanelSource));
check('通用卡片 Host 不再包含 SKU 业务渲染分支', !/sku_combo_editor|sku_human_review|SkuCombo|SkuHumanReview/.test(cardHostSource));
check('通用卡片 Tool 不再包含 SKU 类型特判', !/cardKind\s*===\s*['"]sku_combo_editor['"]/.test(toolExecutorSource));
check('不稳定的空泛确认卡类型已关闭', !/generic_confirmation/.test(toolSchemaSource) && !/generic_confirmation/.test(toolExecutorSource));
check(
    '短选择卡和多字段通用卡共用同一交互 owner 闸门',
    /toolName === 'askUserToChoose' \|\| toolName === 'createInteractiveCard'/.test(autonomousExecutorSource)
        && /isGenericBlockingInteractionTool\(toolName\)/.test(autonomousExecutorSource)
);
check(
    'SKU 组合与人工复核卡从同一个 Interaction Package 清单注册语义和渲染',
    /skillInteractiveCardPackages/.test(skillCardRegistrySource)
        && /skuComboInteractiveCardProvider/.test(skillCardPackagesSource)
        && /skuHumanReviewInteractiveCardProvider/.test(skillCardPackagesSource)
        && /skuTemplateDirectionInteractiveCardProvider/.test(skillCardPackagesSource)
        && /SkuComboEditorCardView/.test(skillCardPackagesSource)
        && /SkuHumanReviewCardView/.test(skillCardPackagesSource)
        && /EditableConfirmationCardView/.test(skillCardPackagesSource)
);
check(
    '未知卡片只显示失效说明且不执行卡片自带 action',
    /当前版本无法识别这张确认卡/.test(cardHostSource)
        && !/onClick=\{\(\) => handleAction\(card\.submitAction/.test(cardHostSource)
);
check(
    '产后业务复核只接受来源消息中完全一致的原卡片',
    /buildInteractiveIntegrityFingerprint\(sourceCard\)[\s\S]*=== buildInteractiveIntegrityFingerprint\(actionCard\)/.test(chatPanelSource)
        && /sourceMessage\?\.interactiveCards\?\.filter/.test(chatPanelSource)
);
const earlyConfirmationBranchStart = skuBatchExecutorSource.indexOf('if (draftComboConfirmationBeforeTemplateDesign)');
const templateHandoffBranchStart = skuBatchExecutorSource.indexOf(
    "if (designGateUnresolvableTargets.length > 0 && skuTemplatePreparationRoute.route === 'agent_design_handoff')",
    earlyConfirmationBranchStart
);
const earlyConfirmationBranch = earlyConfirmationBranchStart >= 0 && templateHandoffBranchStart > earlyConfirmationBranchStart
    ? skuBatchExecutorSource.slice(earlyConfirmationBranchStart, templateHandoffBranchStart)
    : '';
check(
    '模板前必需的 SKU 组合候选无效时失败关闭而不绕过确认',
    earlyConfirmationBranch.includes("status: 'blocked_invalid_sku_combo_confirmation_candidate'")
        && earlyConfirmationBranch.includes('我不会绕过这一步先设计模板')
        && !earlyConfirmationBranch.includes('先进入模板设计；组合会在模板齐备后再确认')
);
const templateDirectionCardBuilderStart = skuBatchExecutorSource.indexOf(
    'function buildSkuCardTemplateDesignConfirmationCard('
);
const templateDirectionCardBuilderEnd = skuBatchExecutorSource.indexOf(
    '// ==================== SKU 执行器 ====================',
    templateDirectionCardBuilderStart
);
const templateDirectionCardBuilder = templateDirectionCardBuilderStart >= 0
    && templateDirectionCardBuilderEnd > templateDirectionCardBuilderStart
    ? skuBatchExecutorSource.slice(templateDirectionCardBuilderStart, templateDirectionCardBuilderEnd)
    : '';
check(
    'SKU Skill 内的模板方向卡同样携带 owner 与领域决定指纹',
    templateDirectionCardBuilder.includes('return buildSkuTemplateDirectionCard({')
        && skuTemplateDirectionCardSource.includes("kind: 'sku_template_direction'")
        && skuTemplateDirectionCardSource.includes("skillId: 'sku-batch'")
        && skuTemplateDirectionCardSource.includes("decisionFingerprint: 'sku-template-direction/v0'")
        && skuTemplateDirectionCardSource.includes('candidateFingerprint: buildEditableConfirmationValueFingerprint(')
);
const skillCardProviders = listSkillInteractiveCardProviders();
check(
    '每个 SKU 业务卡 Provider 都声明 Skill owner',
    skillCardProviders.length === 3
        && skillCardProviders.every((provider) => provider.ownerSkillId === 'sku-batch'),
    JSON.stringify(skillCardProviders)
);
check(
    '业务卡 Provider 的 kind/version 注册键唯一',
    new Set(skillCardProviders.map((provider) => `${provider.kind}@${provider.payloadVersion}`)).size === skillCardProviders.length
);
check(
    '确认能力映射到选择卡而不是可编辑草稿卡',
    /'agent\.interaction\.requestConfirmation': \['askUserToChoose'\]/.test(capabilityBridgeSource)
        && !/'agent\.interaction\.requestConfirmation': \['createInteractiveCard'\]/.test(capabilityBridgeSource)
);
check(
    '浏览器导航和交互是独立的按需 Provider 能力',
    /'web\.navigatePage': \['navigateBrowserTab'\]/.test(capabilityBridgeSource)
        && /'web\.interactPage': \['interactWithBrowserPage'\]/.test(capabilityBridgeSource)
);
check('选择卡提交通过结构化内部恢复', /kind:\s*['"]user_choice_submitted['"]/.test(chatPanelSource) && /internalResumeRequest:\s*request/.test(chatPanelSource));

if (failed > 0) { console.log(`\n${failed} 项失败`); process.exit(1); }
console.log('\n全部通过');
