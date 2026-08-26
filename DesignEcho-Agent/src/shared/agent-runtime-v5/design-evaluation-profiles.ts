/**
 * manifest-selected Evaluation Profile capability。
 *
 * Profile 只定义“评价什么、必须完成哪些验证检查、用哪组共享断言”，最终裁决仍由
 * DesignScorecard → buildDesignVerdict 单一路径完成。本模块纯逻辑，不调模型、
 * 不执行 Tool、不读图片、不授予权限，也不根据 task text 猜 Profile。
 */

import {
    DESIGN_ASSERTIONS,
    getVlmJudgeAssertions,
    isDesignQualityBlockerKind,
    isQualifiedDesignQualityHardBlocker,
    isValidDesignQualityProofRef,
    scoreDesignAssertions,
    type AssertionSeverity,
    type DesignAssertion,
    type DesignAssertionResult,
    type DesignQualityBlockerKind,
    type DesignQualityDimensionKey,
    type DesignScorecard
} from '../design-quality-assertion';
import type { DesignCriticIssueOwner } from '../types/design-team.types';
import { DESIGN_QUALITY_VERDICT_CAPABILITY_ID } from './capability-provider-identities';
import type { RuntimeCapabilityProviderIdentity } from './contracts/capability-resolution';
import {
    DESIGN_ART_DIRECTION_KNOWLEDGE_ID,
    DESIGN_CONTENT_STRATEGY_KNOWLEDGE_ID,
    DESIGN_LAYOUT_PLANNING_KNOWLEDGE_ID,
    DETAIL_PAGE_METHOD_KNOWLEDGE_ID,
    MAIN_IMAGE_METHOD_KNOWLEDGE_ID,
    SINGLE_CANVAS_VISUAL_METHOD_KNOWLEDGE_ID,
    SKU_COLOR_CARD_METHOD_KNOWLEDGE_ID,
    SKU_BATCH_METHOD_KNOWLEDGE_ID,
    listDesignMethodKnowledgeDefinitions
} from './design-method-knowledge';

export const MAIN_IMAGE_EVALUATION_PROFILE_ID = 'rubrics/main-image.v1' as const;
export const MAIN_IMAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID = 'rubrics/main-image-scoped-edit.v1' as const;
export const SINGLE_CANVAS_VISUAL_EVALUATION_PROFILE_ID = 'rubrics/single-canvas-visual.v1' as const;
export const SINGLE_CANVAS_VISUAL_SCOPED_EDIT_EVALUATION_PROFILE_ID = 'rubrics/single-canvas-visual-scoped-edit.v1' as const;
export const GENERAL_DESIGN_EVALUATION_PROFILE_ID = 'rubrics/general-design.v1' as const;
export const GENERAL_DESIGN_SCOPED_EDIT_EVALUATION_PROFILE_ID = 'rubrics/general-design-scoped-edit.v1' as const;
export const DETAIL_PAGE_EVALUATION_PROFILE_ID = 'rubrics/detail-page.v1' as const;
export const DETAIL_PAGE_CREATE_NEW_EVALUATION_PROFILE_ID = 'rubrics/detail-page-create-new.v1' as const;
export const DETAIL_PAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID = 'rubrics/detail-page-scoped-edit.v1' as const;
export const SKU_COLOR_CARD_EVALUATION_PROFILE_ID = 'rubrics/sku-color-card.v1' as const;
export const SKU_BATCH_EVALUATION_PROFILE_ID = 'rubrics/sku-batch.v1' as const;

export type DesignEvaluationProfileId =
    | typeof MAIN_IMAGE_EVALUATION_PROFILE_ID
    | typeof MAIN_IMAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID
    | typeof SINGLE_CANVAS_VISUAL_EVALUATION_PROFILE_ID
    | typeof SINGLE_CANVAS_VISUAL_SCOPED_EDIT_EVALUATION_PROFILE_ID
    | typeof GENERAL_DESIGN_EVALUATION_PROFILE_ID
    | typeof GENERAL_DESIGN_SCOPED_EDIT_EVALUATION_PROFILE_ID
    | typeof DETAIL_PAGE_EVALUATION_PROFILE_ID
    | typeof DETAIL_PAGE_CREATE_NEW_EVALUATION_PROFILE_ID
    | typeof DETAIL_PAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID
    | typeof SKU_COLOR_CARD_EVALUATION_PROFILE_ID
    | typeof SKU_BATCH_EVALUATION_PROFILE_ID;

export type DesignEvaluationVerificationStatus = 'passed' | 'failed' | 'needs_review';
export type DesignEvaluationVerificationSource =
    | 'task_contract'
    | 'runtime_observation'
    | 'quality_adapter'
    | 'human_review';

/**
 * 产物完成与发布审核是两个独立状态轴。前者只消费当前运行可机器验证的交付证据；
 * 后者允许消费与当前导出内容哈希绑定的人审记录，但绝不能反向阻断产物完成。
 */
export type DesignEvaluationCheckCompletionScope = 'artifact_completion' | 'publication_review';

export type DesignArtifactCompletionStatus = 'artifact_completed' | 'artifact_incomplete';

export type DesignPublicationReviewStatus =
    | 'publication_review_not_required'
    | 'publication_review_pending'
    | 'publication_review_approved'
    | 'publication_review_rejected';

export interface DesignEvaluationCompletionProjection {
    artifactStatus: DesignArtifactCompletionStatus;
    publicationReviewStatus: DesignPublicationReviewStatus;
    publicationReviewCheckCount: number;
    approvedPublicationReviewCheckCount: number;
    pendingPublicationReviewCheckKeys: string[];
    rejectedPublicationReviewCheckKeys: string[];
    boundaries: {
        artifactCompletionUsesPublicationReview: false;
        humanApprovalCanBeInferred: false;
    };
}

export interface DesignEvaluationVerificationRecord {
    key: string;
    status: DesignEvaluationVerificationStatus;
    source: DesignEvaluationVerificationSource;
    /** 只允许稳定验证记录 token，不保存路径、Prompt、图片或任意结果载荷。 */
    verificationRef: string;
}

export type DesignEvaluationRuntimeEvidence =
    | 'fresh_structure'
    | 'fresh_visual'
    | 'scoped_change'
    | 'declared_plan_closure';

export type DesignEvaluationRepairTrigger =
    | 'post_write_observation_missing'
    | 'declared_plan_incomplete';

export type DesignEvaluationRepairStage = 'R4' | 'R5';

export interface DesignEvaluationCheckRuntimePolicy {
    /** Harness 可直接生产的通用证据类型；不得编码业务 check key。 */
    evidence: DesignEvaluationRuntimeEvidence;
    /** 没有真实写入时，此检查不适用于当前运行。 */
    requiresMutation?: true;
    /** 证据缺失且触发条件成立时，可恢复到的既有 Runtime 阶段。 */
    repair?: {
        trigger: DesignEvaluationRepairTrigger;
        targetStage: DesignEvaluationRepairStage;
    };
}

export interface DesignEvaluationFinalReviewPolicy {
    surfaceMode: 'single_surface' | 'declared_multi_surface';
    /** 多画面 Profile 可声明 ReviewSet 中每个画面的来源种类。 */
    requiredSourceKind?: string;
    /**
     * 由 Profile 声明的真实观看情境。native_surface 对应 ReviewSet 原画面；
     * list_thumbnail 是由同一版本原画面派生的列表缩略视图。它只扩展评价证据，
     * 不声明固定构图、字号或主体比例。
     */
    requiredViews?: Array<'native_surface' | 'list_thumbnail'>;
}

export interface DesignEvaluationCheck {
    id: string;
    key: string;
    label: string;
    dimension: DesignQualityDimensionKey;
    weight: number;
    severity: AssertionSeverity;
    owner: DesignCriticIssueOwner;
    required: boolean;
    /** publication_review 只描述发布前人审，不参与 artifact/R5 产物完成裁决。 */
    completionScope: DesignEvaluationCheckCompletionScope;
    /** 只有确定性事实/结构检查可声明；必须和 failed verificationRef 一起签发。 */
    blockerKind?: DesignQualityBlockerKind;
    /** 哪类生产 owner 可以为此检查签发验证记录；调用方传入其它 source 必须忽略。 */
    allowedSources: DesignEvaluationVerificationSource[];
    /** 仅描述 Harness 如何生产/修复该检查证据，不选择 Skill 或业务流程。 */
    runtime?: DesignEvaluationCheckRuntimePolicy;
    expectedFix: string;
}

export interface DesignEvaluationProfile {
    version: 'design-evaluation-profile/v0';
    profileId: DesignEvaluationProfileId;
    skillId: string;
    taskType: string;
    /**
     * task_bound（缺省）只允许原 Skill /Task 使用；design_foundation 可被任意设计
     * artifact Manifest 显式复用。复用只共享评价方法，不选择业务流程、不授予 Tool，
     * 也不改变 artifact owner。
     */
    bindingPolicy?: 'task_bound' | 'design_foundation';
    capabilityGoal: string;
    /** 评价 Profile 必须与本 Skill 实际装载的方法知识保持可审计绑定。 */
    methodKnowledgeRefs: string[];
    assertionRefs: string[];
    checks: DesignEvaluationCheck[];
    /** 终审需要单画面还是 manifest 已声明的完整多画面集合。 */
    finalReview?: DesignEvaluationFinalReviewPolicy;
    scoring: {
        passThreshold: number;
        minCoverage: number;
    };
    outputType: 'design-scorecard';
    finalVerdictProvider: typeof DESIGN_QUALITY_VERDICT_CAPABILITY_ID;
    boundaries: {
        executesTools: false;
        callsModel: false;
        grantsPermission: false;
        selectsWorkflow: false;
        finalVerdictOwnedByProfile: false;
    };
}

export type DesignEvaluationProfileValidationIssueCode =
    | 'profile_id_invalid'
    | 'profile_identity_missing'
    | 'profile_binding_policy_invalid'
    | 'profile_goal_missing'
    | 'profile_method_knowledge_empty'
    | 'profile_method_knowledge_duplicate'
    | 'profile_method_knowledge_unknown'
    | 'profile_method_knowledge_scope_mismatch'
    | 'profile_assertions_empty'
    | 'profile_assertion_duplicate'
    | 'profile_assertion_unknown'
    | 'profile_checks_empty'
    | 'profile_check_duplicate'
    | 'profile_required_check_missing'
    | 'profile_check_invalid'
    | 'profile_check_blocker_evidence_invalid'
    | 'profile_check_source_policy_invalid'
    | 'profile_publication_review_policy_invalid'
    | 'profile_final_review_policy_invalid'
    | 'profile_check_runtime_policy_invalid'
    | 'profile_threshold_invalid'
    | 'profile_final_verdict_provider_invalid';

export interface DesignEvaluationProfileValidationIssue {
    code: DesignEvaluationProfileValidationIssueCode;
    target: string;
}

export interface DesignEvaluationProfileValidationResult {
    valid: boolean;
    issues: DesignEvaluationProfileValidationIssue[];
}

export type DesignEvaluationProfileIssueCode =
    | 'critical_check_missing'
    | 'critical_check_needs_review'
    | 'verification_explicitly_failed'
    | 'unsafe_verification_record_ignored'
    | 'verification_source_not_allowed'
    | 'verification_record_conflict';

export type DesignEvaluationProfileStatus =
    | 'passed'
    | 'failed'
    | 'needs_review'
    | 'incomplete_verification'
    | 'insufficient_observations';

export type DesignEvaluationScorecard = Omit<DesignScorecard, 'gate'> & {
    gate: DesignEvaluationProfileStatus;
};

export interface DesignEvaluationProfileResult {
    version: 'design-evaluation-profile-result/v0';
    profileId: DesignEvaluationProfileId;
    status: DesignEvaluationProfileStatus;
    scorecard: DesignEvaluationScorecard;
    completion: DesignEvaluationCompletionProjection;
    verification: {
        missingRequiredCheckKeys: string[];
        failedCheckKeys: string[];
        needsReviewCheckKeys: string[];
        requiredNeedsReviewCheckKeys: string[];
    };
    coverage: {
        requiredCheckCount: number;
        completedRequiredCheckCount: number;
        ratio: number;
    };
    issueCodes: DesignEvaluationProfileIssueCode[];
    boundaries: {
        usesSingleDesignScorecard: true;
        finalVerdictOwnedByProfile: false;
        defaultPassWhenChecksMissing: false;
        containsRawMeasurementPayloads: false;
    };
}

export interface DesignEvaluationProfileDigest {
    version: 'design-evaluation-profile-digest/v0';
    profileId: DesignEvaluationProfileId;
    status: DesignEvaluationProfileStatus;
    completion: DesignEvaluationCompletionProjection;
    overallScore: number;
    coverageRatio: number;
    requiredCheckCount: number;
    completedRequiredCheckCount: number;
    missingRequiredCheckCount: number;
    failedCheckCount: number;
    needsReviewCheckCount: number;
    /** 稳定检查 key 只用于确定返工阶段；不含测量、路径、Prompt 或图片载荷。 */
    missingRequiredCheckKeys: string[];
    failedCheckKeys: string[];
    needsReviewCheckKeys: string[];
    requiredNeedsReviewCheckKeys: string[];
    verificationCoverageRatio: number;
    issueCodes: DesignEvaluationProfileIssueCode[];
    boundaries: {
        digestOnly: true;
        notFinalVerdict: true;
    };
}

const SHARED_ASSERTION_BY_ID = new Map(DESIGN_ASSERTIONS.map((assertion) => [assertion.id, assertion]));
const METHOD_KNOWLEDGE_BY_ID = new Map(listDesignMethodKnowledgeDefinitions().map((definition) => (
    [definition.capabilityId, definition] as const
)));
const SAFE_TOKEN_PATTERN = /^[a-zA-Z0-9._:@/-]+$/;
const COMMON_METHOD_KNOWLEDGE_REFS = Object.freeze([
    DESIGN_CONTENT_STRATEGY_KNOWLEDGE_ID,
    DESIGN_ART_DIRECTION_KNOWLEDGE_ID,
    DESIGN_LAYOUT_PLANNING_KNOWLEDGE_ID
]);

function allowedVerificationSourcesForKey(key: string): DesignEvaluationVerificationSource[] {
    switch (key) {
        case 'fresh_structure_snapshot':
        case 'fresh_visual_evaluation':
        case 'requested_change_applied':
        case 'outside_scope_preserved':
        case 'whole_task_execution_closure':
            return ['runtime_observation'];
        case 'sku_product_truth':
        case 'sku_visual_consistency':
            return ['human_review'];
        default:
            return ['quality_adapter'];
    }
}

function verificationCheck(
    input: Omit<DesignEvaluationCheck, 'allowedSources' | 'completionScope'>
        & { completionScope?: DesignEvaluationCheckCompletionScope }
): DesignEvaluationCheck {
    return Object.freeze({
        completionScope: 'artifact_completion',
        ...input,
        allowedSources: allowedVerificationSourcesForKey(input.key)
    });
}

const PROFILE_BOUNDARIES: DesignEvaluationProfile['boundaries'] = Object.freeze({
    executesTools: false,
    callsModel: false,
    grantsPermission: false,
    selectsWorkflow: false,
    finalVerdictOwnedByProfile: false
});

const FRESH_STRUCTURE_RUNTIME: DesignEvaluationCheckRuntimePolicy = Object.freeze({
    evidence: 'fresh_structure',
    requiresMutation: true,
    repair: Object.freeze({
        trigger: 'post_write_observation_missing',
        targetStage: 'R5'
    })
});

const FRESH_VISUAL_RUNTIME: DesignEvaluationCheckRuntimePolicy = Object.freeze({
    evidence: 'fresh_visual',
    requiresMutation: true,
    repair: Object.freeze({
        trigger: 'post_write_observation_missing',
        targetStage: 'R5'
    })
});

const SCOPED_CHANGE_RUNTIME: DesignEvaluationCheckRuntimePolicy = Object.freeze({
    evidence: 'scoped_change'
});

const DECLARED_PLAN_CLOSURE_RUNTIME: DesignEvaluationCheckRuntimePolicy = Object.freeze({
    evidence: 'declared_plan_closure',
    repair: Object.freeze({
        trigger: 'declared_plan_incomplete',
        targetStage: 'R4'
    })
});

const DECLARED_MULTI_SURFACE_REVIEW: DesignEvaluationFinalReviewPolicy = Object.freeze({
    surfaceMode: 'declared_multi_surface',
    requiredSourceKind: 'detail-screen'
});

const MAIN_IMAGE_FINAL_REVIEW: DesignEvaluationFinalReviewPolicy = Object.freeze({
    surfaceMode: 'single_surface',
    requiredViews: [
        'native_surface' as const,
        'list_thumbnail' as const
    ]
});

const MAIN_IMAGE_PROFILE: DesignEvaluationProfile = Object.freeze({
    version: 'design-evaluation-profile/v0',
    profileId: MAIN_IMAGE_EVALUATION_PROFILE_ID,
    skillId: 'ecommerce.main_image',
    taskType: 'ecommerce.main_image.v1',
    capabilityGoal: '评价电商主图在典型列表缩略图中是否建立商品识别与点击理由，以及主体、产品吸引力或卖点表达、信息层级、画面精度与真实操作结果。纯摄影可以成立，但商品完整陈列本身不自动等于完成点击目标，也不要求补文案、场景、装饰或固定风格。',
    methodKnowledgeRefs: [...COMMON_METHOD_KNOWLEDGE_REFS, MAIN_IMAGE_METHOD_KNOWLEDGE_ID],
    finalReview: MAIN_IMAGE_FINAL_REVIEW,
    assertionRefs: [
        'req.brief-coverage',
        'comp.subject-ratio',
        'comp.alignment',
        'color.contrast',
        'hier.type-scale',
        'craft.precision',
        'craft.structure-intent-coherence',
        'overall.above-baseline',
        'impact.squint',
        'sell.visualized',
        'comp.focal-balance',
        'color.scheme',
        'hier.three-level',
        'type.character',
        'craft.depth',
        'craft.asset-integration'
    ],
    checks: [
        verificationCheck({
            id: 'main-image.fresh-structure',
            key: 'fresh_structure_snapshot',
            label: '写后结构读回',
            dimension: 'craft',
            weight: 2,
            severity: 'major',
            owner: 'execution',
            required: true,
            runtime: FRESH_STRUCTURE_RUNTIME,
            expectedFix: '在最后一次写入后重新读取完整图层结构。'
        }),
        verificationCheck({
            id: 'main-image.fresh-visual',
            key: 'fresh_visual_evaluation',
            label: '写后视觉复核',
            dimension: 'overall',
            weight: 3,
            severity: 'major',
            owner: 'visual',
            required: true,
            runtime: FRESH_VISUAL_RUNTIME,
            expectedFix: '取得写后画面并完成 Profile 对应的视觉断言评价。'
        }),
        verificationCheck({
            id: 'main-image.qa-report',
            key: 'main_image_qa_report',
            label: '主图 QA 报告',
            dimension: 'overall',
            weight: 5,
            // legacy QA 报告只由旧 main-image executor 生产；canonical autonomous 路径的
            // 完成权属于 fresh structure + fresh visual + Profile assertions，缺旧报告只提示。
            severity: 'major',
            owner: 'requirement',
            required: false,
            expectedFix: '若当前路径提供旧版主图 QA 报告，则由适配器明确给出 passed / failed / needs_review。'
        })
    ],
    scoring: { passThreshold: 78, minCoverage: 0.75 },
    outputType: 'design-scorecard',
    finalVerdictProvider: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
    boundaries: PROFILE_BOUNDARIES
});

const SINGLE_CANVAS_VISUAL_PROFILE: DesignEvaluationProfile = Object.freeze({
    version: 'design-evaluation-profile/v0',
    profileId: SINGLE_CANVAS_VISUAL_EVALUATION_PROFILE_ID,
    skillId: 'design.single_canvas_visual',
    taskType: 'design.single_canvas_visual.v1',
    capabilityGoal: '评价单画布视觉成品的传播目标、信息层级、文字可读性、视觉焦点、画面平衡与真实写后结果。',
    methodKnowledgeRefs: [...COMMON_METHOD_KNOWLEDGE_REFS, SINGLE_CANVAS_VISUAL_METHOD_KNOWLEDGE_ID],
    assertionRefs: [
        'req.brief-coverage',
        'comp.subject-ratio',
        'comp.alignment',
        'color.contrast',
        'hier.type-scale',
        'craft.precision',
        'craft.structure-intent-coherence',
        'impact.squint',
        'comp.focal-balance',
        'color.scheme',
        'hier.three-level',
        'type.character',
        'craft.depth',
        'craft.asset-integration'
    ],
    checks: [
        verificationCheck({
            id: 'single-canvas-visual.fresh-structure',
            key: 'fresh_structure_snapshot',
            label: '写后结构读回',
            dimension: 'craft',
            weight: 3,
            severity: 'major',
            owner: 'execution',
            required: true,
            runtime: FRESH_STRUCTURE_RUNTIME,
            expectedFix: '在最后一次写入后重新读取完整图层结构、文字图层和目标文档状态。'
        }),
        verificationCheck({
            id: 'single-canvas-visual.fresh-visual',
            key: 'fresh_visual_evaluation',
            label: '写后单画布视觉复核',
            dimension: 'overall',
            weight: 5,
            severity: 'major',
            owner: 'visual',
            required: true,
            runtime: FRESH_VISUAL_RUNTIME,
            expectedFix: '取得同一 Photoshop 历史状态的最终画面，并完成本 Profile 全部视觉断言评价。'
        })
    ],
    scoring: { passThreshold: 80, minCoverage: 0.8 },
    outputType: 'design-scorecard',
    finalVerdictProvider: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
    boundaries: PROFILE_BOUNDARIES
});

const GENERAL_DESIGN_PROFILE: DesignEvaluationProfile = Object.freeze({
    version: 'design-evaluation-profile/v0',
    profileId: GENERAL_DESIGN_EVALUATION_PROFILE_ID,
    skillId: 'design.general',
    taskType: 'design.generic.v1',
    bindingPolicy: 'design_foundation',
    capabilityGoal: '评价通用单画布设计是否覆盖 Brief、保持信息层级与可读性，并具备真实写后结构和视觉证据。',
    methodKnowledgeRefs: [...COMMON_METHOD_KNOWLEDGE_REFS],
    assertionRefs: [
        'req.brief-coverage',
        'comp.subject-ratio',
        'comp.alignment',
        'color.contrast',
        'hier.type-scale',
        'craft.precision',
        'craft.structure-intent-coherence',
        'impact.squint',
        'comp.focal-balance',
        'color.scheme',
        'hier.three-level',
        'type.character',
        'craft.depth',
        'craft.asset-integration'
    ],
    checks: [
        verificationCheck({
            id: 'general-design.fresh-structure',
            key: 'fresh_structure_snapshot',
            label: '写后结构读回',
            dimension: 'craft',
            weight: 3,
            severity: 'major',
            owner: 'execution',
            required: true,
            runtime: FRESH_STRUCTURE_RUNTIME,
            expectedFix: '在最后一次写入后重新读取目标文档结构、文字和边界。'
        }),
        verificationCheck({
            id: 'general-design.fresh-visual',
            key: 'fresh_visual_evaluation',
            label: '写后视觉复核',
            dimension: 'overall',
            weight: 5,
            severity: 'major',
            owner: 'visual',
            required: true,
            runtime: FRESH_VISUAL_RUNTIME,
            expectedFix: '取得同一 Photoshop 历史状态的最终画面，并按 Brief 完成视觉断言评价。'
        })
    ],
    scoring: { passThreshold: 78, minCoverage: 0.75 },
    outputType: 'design-scorecard',
    finalVerdictProvider: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
    boundaries: PROFILE_BOUNDARIES
});

const DETAIL_PAGE_PROFILE: DesignEvaluationProfile = Object.freeze({
    version: 'design-evaluation-profile/v0',
    profileId: DETAIL_PAGE_EVALUATION_PROFILE_ID,
    skillId: 'ecommerce.detail_page',
    taskType: 'ecommerce.detail_page.v1',
    capabilityGoal: '评价详情页跨屏叙事、卖点事实支撑、版式层级、屏幕覆盖与落位质量。',
    methodKnowledgeRefs: [...COMMON_METHOD_KNOWLEDGE_REFS, DETAIL_PAGE_METHOD_KNOWLEDGE_ID],
    finalReview: DECLARED_MULTI_SURFACE_REVIEW,
    assertionRefs: [
        'comp.alignment',
        'color.contrast',
        'color.background-designed',
        'hier.type-scale',
        'craft.precision',
        'craft.structure-intent-coherence',
        'overall.above-baseline',
        'sell.visualized',
        'comp.focal-balance',
        'color.scheme',
        'hier.three-level',
        'type.character',
        'craft.depth',
        'craft.asset-integration'
    ],
    checks: [
        verificationCheck({
            id: 'detail-page.fresh-structure',
            key: 'fresh_structure_snapshot',
            label: '写后结构读回',
            dimension: 'craft',
            weight: 2,
            severity: 'major',
            owner: 'execution',
            required: true,
            runtime: FRESH_STRUCTURE_RUNTIME,
            expectedFix: '在最后一次写入后重新读取完整详情页结构。'
        }),
        verificationCheck({
            id: 'detail-page.fresh-visual',
            key: 'fresh_visual_evaluation',
            label: '跨屏视觉复核',
            dimension: 'overall',
            weight: 3,
            severity: 'major',
            owner: 'visual',
            required: true,
            runtime: FRESH_VISUAL_RUNTIME,
            expectedFix: '取得详情页写后屏幕快照并完成视觉断言评价。'
        }),
        verificationCheck({
            id: 'detail-page.screen-coverage',
            key: 'detail_page_screen_coverage',
            label: '计划屏覆盖',
            dimension: 'hierarchy',
            weight: 4,
            // 分档（用户决策 2026-07-24）：过程记录：适配器有没有核验屏覆盖不等于详情页没做；缺核验只提示。
            severity: 'major',
            owner: 'requirement',
            required: true,
            expectedFix: '由详情页 screen result 适配器核验计划屏、实际屏与缺失屏。'
        }),
        verificationCheck({
            id: 'detail-page.placement-audit',
            key: 'detail_page_placement_audit',
            label: '内容落位审计',
            dimension: 'craft',
            weight: 4,
            // 分档（用户决策 2026-07-24）：质量梯度：溢出/缺图属可改进项，应交付并标注，而不是判整单未完成。
            severity: 'major',
            owner: 'execution',
            required: true,
            expectedFix: '运行结构化 placement audit，修复溢出、缺图、缺文案或错误屏归属。'
        }),
        verificationCheck({
            id: 'detail-page.content-verification',
            key: 'detail_page_content_verification',
            label: '卖点内容核验',
            dimension: 'selling_point_visual',
            weight: 3,
            severity: 'major',
            owner: 'requirement',
            required: true,
            expectedFix: '把每屏卖点与真实商品事实、素材分析或市场洞察记录关联。'
        })
    ],
    scoring: { passThreshold: 76, minCoverage: 0.75 },
    outputType: 'design-scorecard',
    finalVerdictProvider: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
    boundaries: PROFILE_BOUNDARIES
});

const DETAIL_PAGE_CREATE_NEW_PROFILE: DesignEvaluationProfile = Object.freeze({
    version: 'design-evaluation-profile/v0',
    profileId: DETAIL_PAGE_CREATE_NEW_EVALUATION_PROFILE_ID,
    skillId: 'ecommerce.detail_page',
    taskType: 'ecommerce.detail_page.v1',
    capabilityGoal: '评价从零详情页是否完整覆盖 Brief、形成真实写后结构，并通过跨屏视觉质量复核。',
    methodKnowledgeRefs: [...COMMON_METHOD_KNOWLEDGE_REFS, DETAIL_PAGE_METHOD_KNOWLEDGE_ID],
    finalReview: DECLARED_MULTI_SURFACE_REVIEW,
    assertionRefs: [
        'req.brief-coverage',
        'comp.alignment',
        'color.contrast',
        'color.background-designed',
        'hier.type-scale',
        'craft.precision',
        'craft.structure-intent-coherence',
        'overall.above-baseline',
        'sell.visualized',
        'comp.focal-balance',
        'color.scheme',
        'hier.three-level',
        'type.character',
        'craft.depth',
        'craft.asset-integration'
    ],
    checks: [
        verificationCheck({
            id: 'detail-page-create-new.whole-task',
            key: 'whole_task_execution_closure',
            label: '整单执行覆盖',
            dimension: 'overall',
            weight: 5,
            severity: 'major',
            owner: 'requirement',
            required: true,
            runtime: DECLARED_PLAN_CLOSURE_RUNTIME,
            expectedFix: '补齐 R1 Brief 每项交付对应的生产与验证节点，不得用一屏或一次通用读回冒充整单。'
        }),
        verificationCheck({
            id: 'detail-page-create-new.fresh-structure',
            key: 'fresh_structure_snapshot',
            label: '写后结构读回',
            dimension: 'craft',
            weight: 3,
            severity: 'major',
            owner: 'execution',
            required: true,
            runtime: FRESH_STRUCTURE_RUNTIME,
            expectedFix: '在最后一次写入后重新读取完整长页结构和图层关系。'
        }),
        verificationCheck({
            id: 'detail-page-create-new.fresh-visual',
            key: 'fresh_visual_evaluation',
            label: '跨屏视觉复核',
            dimension: 'overall',
            weight: 5,
            severity: 'major',
            owner: 'visual',
            required: true,
            runtime: FRESH_VISUAL_RUNTIME,
            expectedFix: '取得与最终 Photoshop 历史状态一致的画面，并完成本 Profile 全部视觉断言评价。'
        })
    ],
    scoring: { passThreshold: 78, minCoverage: 0.8 },
    outputType: 'design-scorecard',
    finalVerdictProvider: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
    boundaries: PROFILE_BOUNDARIES
});

const DETAIL_PAGE_SCOPED_EDIT_PROFILE: DesignEvaluationProfile = Object.freeze({
    version: 'design-evaluation-profile/v0',
    profileId: DETAIL_PAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID,
    skillId: 'ecommerce.detail_page',
    taskType: 'ecommerce.detail_page.v1',
    capabilityGoal: '评价详情页局部修改是否准确落在目标范围、保持可编辑，并避免无关区域被意外改变。',
    methodKnowledgeRefs: [...COMMON_METHOD_KNOWLEDGE_REFS, DETAIL_PAGE_METHOD_KNOWLEDGE_ID],
    finalReview: DECLARED_MULTI_SURFACE_REVIEW,
    // 当前 Harness 没有可靠的目标区域裁剪与 changed-region provenance；用整张长页
    // 跑通用审美断言会把无关旧区域的风格问题误算成本轮返工义务。局部编辑先由
    // requested-change / outside-scope / fresh readback 这些有唯一答案的检查验收。
    assertionRefs: [],
    checks: [
        verificationCheck({
            id: 'detail-page-scoped-edit.requested-change',
            key: 'requested_change_applied',
            label: '目标修改参数与写后状态一致',
            dimension: 'craft',
            weight: 5,
            severity: 'blocker',
            owner: 'execution',
            required: true,
            blockerKind: 'required_artifact_missing',
            runtime: SCOPED_CHANGE_RUNTIME,
            expectedFix: '使用带显式目标的原子修改，并取得 before/after 验收断言，确认写后状态匹配声明的修改值。'
        }),
        verificationCheck({
            id: 'detail-page-scoped-edit.outside-scope',
            key: 'outside_scope_preserved',
            label: '无关图层保持不变',
            dimension: 'craft',
            weight: 5,
            severity: 'blocker',
            owner: 'execution',
            required: true,
            blockerKind: 'structural_damage',
            runtime: SCOPED_CHANGE_RUNTIME,
            expectedFix: '核对 before/after 图层差异，确保变化范围没有超出显式目标图层。'
        }),
        verificationCheck({
            id: 'detail-page-scoped-edit.fresh-structure',
            key: 'fresh_structure_snapshot',
            label: '目标修改写后结构读回',
            dimension: 'craft',
            weight: 5,
            severity: 'blocker',
            owner: 'execution',
            required: true,
            blockerKind: 'required_artifact_missing',
            runtime: FRESH_STRUCTURE_RUNTIME,
            expectedFix: '在最后一次局部写入后读回目标文字、图层结构或边界，确认修改真实存在。'
        }),
        verificationCheck({
            id: 'detail-page-scoped-edit.fresh-visual',
            key: 'fresh_visual_evaluation',
            label: '局部修改视觉复核',
            dimension: 'overall',
            weight: 2,
            severity: 'major',
            owner: 'visual',
            required: false,
            runtime: FRESH_VISUAL_RUNTIME,
            expectedFix: '在字体适配、换行或位置可能变化时查看写后目标区域。'
        }),
        verificationCheck({
            id: 'detail-page-scoped-edit.placement-audit',
            key: 'detail_page_placement_audit',
            label: '目标范围落位审计',
            dimension: 'craft',
            weight: 2,
            severity: 'major',
            owner: 'execution',
            required: false,
            expectedFix: '仅在局部修改改变布局时检查目标区域溢出、遮挡和屏归属。'
        })
    ],
    scoring: { passThreshold: 72, minCoverage: 0.6 },
    outputType: 'design-scorecard',
    finalVerdictProvider: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
    boundaries: PROFILE_BOUNDARIES
});

function buildScopedEditEvaluationProfile(input: {
    profileId: DesignEvaluationProfileId;
    skillId: string;
    taskType: string;
    checkIdPrefix: string;
    artifactLabel: string;
    methodKnowledgeRefs: string[];
}): DesignEvaluationProfile {
    return Object.freeze({
        version: 'design-evaluation-profile/v0',
        profileId: input.profileId,
        skillId: input.skillId,
        taskType: input.taskType,
        capabilityGoal: `评价${input.artifactLabel}局部修改是否准确落在目标范围、保持可编辑，并避免无关区域被意外改变。`,
        methodKnowledgeRefs: [...input.methodKnowledgeRefs],
        // 缺少 changed-region 的可靠裁剪 provenance 时，不能用整张旧画面的审美问题
        // 制造本轮返工义务。局部编辑只硬验收有唯一答案的目标、范围和写后读回。
        assertionRefs: [],
        checks: [
            verificationCheck({
                id: `${input.checkIdPrefix}.requested-change`,
                key: 'requested_change_applied',
                label: '目标修改参数与写后状态一致',
                dimension: 'craft',
                weight: 5,
                severity: 'blocker',
                owner: 'execution',
                required: true,
                blockerKind: 'required_artifact_missing',
                runtime: SCOPED_CHANGE_RUNTIME,
                expectedFix: '使用带显式目标的原子修改，并取得 before/after 验收断言，确认写后状态匹配声明的修改值。'
            }),
            verificationCheck({
                id: `${input.checkIdPrefix}.outside-scope`,
                key: 'outside_scope_preserved',
                label: '目标范围之外保持不变',
                dimension: 'craft',
                weight: 5,
                severity: 'blocker',
                owner: 'execution',
                required: true,
                blockerKind: 'structural_damage',
                runtime: SCOPED_CHANGE_RUNTIME,
                expectedFix: '核对 before/after 差异，确保变化范围没有超出显式目标图层。'
            }),
            verificationCheck({
                id: `${input.checkIdPrefix}.fresh-structure`,
                key: 'fresh_structure_snapshot',
                label: '目标修改写后结构读回',
                dimension: 'craft',
                weight: 5,
                severity: 'blocker',
                owner: 'execution',
                required: true,
                blockerKind: 'required_artifact_missing',
                runtime: FRESH_STRUCTURE_RUNTIME,
                expectedFix: '在最后一次局部写入后读回目标文字、图层结构或边界，确认修改真实存在。'
            }),
            verificationCheck({
                id: `${input.checkIdPrefix}.fresh-visual`,
                key: 'fresh_visual_evaluation',
                label: '局部修改视觉复核',
                dimension: 'overall',
                weight: 2,
                severity: 'major',
                owner: 'visual',
                required: false,
                runtime: FRESH_VISUAL_RUNTIME,
                expectedFix: '仅在字体适配、换行、位置或图像呈现可能变化时查看写后目标区域。'
            })
        ],
        scoring: { passThreshold: 72, minCoverage: 0.6 },
        outputType: 'design-scorecard',
        finalVerdictProvider: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
        boundaries: PROFILE_BOUNDARIES
    });
}

const MAIN_IMAGE_SCOPED_EDIT_PROFILE = buildScopedEditEvaluationProfile({
    profileId: MAIN_IMAGE_SCOPED_EDIT_EVALUATION_PROFILE_ID,
    skillId: 'ecommerce.main_image',
    taskType: 'ecommerce.main_image.v1',
    checkIdPrefix: 'main-image-scoped-edit',
    artifactLabel: '电商主图',
    methodKnowledgeRefs: [...COMMON_METHOD_KNOWLEDGE_REFS, MAIN_IMAGE_METHOD_KNOWLEDGE_ID]
});

const SINGLE_CANVAS_VISUAL_SCOPED_EDIT_PROFILE = buildScopedEditEvaluationProfile({
    profileId: SINGLE_CANVAS_VISUAL_SCOPED_EDIT_EVALUATION_PROFILE_ID,
    skillId: 'design.single_canvas_visual',
    taskType: 'design.single_canvas_visual.v1',
    checkIdPrefix: 'single-canvas-visual-scoped-edit',
    artifactLabel: '单画布视觉设计',
    methodKnowledgeRefs: [...COMMON_METHOD_KNOWLEDGE_REFS, SINGLE_CANVAS_VISUAL_METHOD_KNOWLEDGE_ID]
});

const GENERAL_DESIGN_SCOPED_EDIT_PROFILE = buildScopedEditEvaluationProfile({
    profileId: GENERAL_DESIGN_SCOPED_EDIT_EVALUATION_PROFILE_ID,
    skillId: 'design.general',
    taskType: 'design.generic.v1',
    checkIdPrefix: 'general-design-scoped-edit',
    artifactLabel: '通用视觉设计',
    methodKnowledgeRefs: [...COMMON_METHOD_KNOWLEDGE_REFS]
});

const SKU_BATCH_PROFILE: DesignEvaluationProfile = Object.freeze({
    version: 'design-evaluation-profile/v0',
    profileId: SKU_BATCH_EVALUATION_PROFILE_ID,
    skillId: 'ecommerce.sku_batch',
    taskType: 'ecommerce.sku_batch.v1',
    capabilityGoal: '评价 SKU 变体覆盖、商品真实性、标签可读性、批量一致性与导出读回。',
    methodKnowledgeRefs: [...COMMON_METHOD_KNOWLEDGE_REFS, SKU_BATCH_METHOD_KNOWLEDGE_ID],
    // 规格化批量生产由下面的结构化覆盖、真实性、一致性与导出读回检查验收。
    // Manifest 的 bounded vision 只服务缺模板首稿与写后观察；规格化 SKU 终局仍由结构化
    // 覆盖、真实性、一致性与导出读回验收，不额外挂通用 VLM 审美断言制造天然失败。
    assertionRefs: [],
    checks: [
        verificationCheck({
            id: 'sku.fresh-structure',
            key: 'fresh_structure_snapshot',
            label: '写后结构读回',
            dimension: 'craft',
            weight: 2,
            severity: 'major',
            owner: 'execution',
            required: true,
            runtime: FRESH_STRUCTURE_RUNTIME,
            expectedFix: '在批量写入后读取结构，确认图层与规格仍可编辑。'
        }),
        verificationCheck({
            id: 'sku.variant-coverage',
            key: 'sku_variant_coverage',
            label: 'SKU 变体覆盖',
            dimension: 'overall',
            weight: 5,
            // 分档（用户决策 2026-07-24）：过程记录：覆盖清单核对缺失只提示，实际产出仍交付。
            severity: 'major',
            owner: 'requirement',
            required: true,
            expectedFix: '用组合计划与实际完成清单核对规格、颜色、组合和备注覆盖。'
        }),
        verificationCheck({
            id: 'sku.product-truth',
            key: 'sku_product_truth',
            label: '商品真实性',
            dimension: 'selling_point_visual',
            weight: 5,
            severity: 'blocker',
            owner: 'requirement',
            required: true,
            completionScope: 'publication_review',
            blockerKind: 'proven_fact_error',
            expectedFix: '确认每个 SKU 只改变允许变化的颜色或组合，不破坏真实纹理与形态。'
        }),
        verificationCheck({
            id: 'sku.export-readback',
            key: 'sku_export_readback',
            label: '导出读回',
            dimension: 'craft',
            weight: 5,
            severity: 'blocker',
            owner: 'execution',
            required: true,
            blockerKind: 'required_artifact_missing',
            expectedFix: '对全部预期导出执行文件、尺寸和脱敏 visualMetrics 读回。'
        }),
        verificationCheck({
            id: 'sku.visual-consistency',
            key: 'sku_visual_consistency',
            label: '批量视觉一致性',
            dimension: 'overall',
            weight: 3,
            severity: 'major',
            owner: 'visual',
            required: true,
            completionScope: 'publication_review',
            expectedFix: '由结构化批量视觉复核确认主体大小、位置、文字与留白一致。'
        })
    ],
    scoring: { passThreshold: 80, minCoverage: 0.8 },
    outputType: 'design-scorecard',
    finalVerdictProvider: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
    boundaries: PROFILE_BOUNDARIES
});

const SKU_COLOR_CARD_PROFILE: DesignEvaluationProfile = Object.freeze({
    version: 'design-evaluation-profile/v0',
    profileId: SKU_COLOR_CARD_EVALUATION_PROFILE_ID,
    skillId: 'ecommerce.sku_color_card',
    taskType: 'ecommerce.sku_color_card.v1',
    capabilityGoal: '评价 SKU 色卡的来源覆盖、色名准确、可编辑智能对象结构、剪切关系与布局一致性。',
    methodKnowledgeRefs: [...COMMON_METHOD_KNOWLEDGE_REFS, SKU_COLOR_CARD_METHOD_KNOWLEDGE_ID],
    assertionRefs: [
        'comp.alignment',
        'craft.precision',
        'craft.structure-intent-coherence',
        'color.scheme',
        'hier.three-level',
        'type.character'
    ],
    checks: [
        verificationCheck({
            id: 'sku-color-card.fresh-structure',
            key: 'fresh_structure_snapshot',
            label: '写后结构读回',
            dimension: 'craft',
            weight: 3,
            severity: 'major',
            owner: 'execution',
            required: true,
            runtime: FRESH_STRUCTURE_RUNTIME,
            expectedFix: '在最后一次色卡写入后读回主文档图层、文字和边界。'
        }),
        verificationCheck({
            id: 'sku-color-card.final-structure',
            key: 'sku_color_card_final_structure',
            label: '色卡业务结构检查',
            dimension: 'craft',
            weight: 4,
            // 分档（用户决策 2026-07-24）：质量梯度：结构瑕疵标注待改进，不吞掉已产出的色卡。
            severity: 'major',
            owner: 'execution',
            required: true,
            expectedFix: '修复色卡执行报告中的最终结构错误，并重新完成业务结构读回。'
        }),
        verificationCheck({
            id: 'sku-color-card.source-coverage',
            key: 'sku_color_card_source_coverage',
            label: '颜色来源覆盖',
            dimension: 'overall',
            weight: 5,
            // 分档（用户决策 2026-07-24）：过程记录：来源与颜色组一一对应的核对缺失只提示。
            severity: 'major',
            owner: 'requirement',
            required: true,
            expectedFix: '核对每个已确认来源都对应且只对应一个同名颜色组。'
        }),
        verificationCheck({
            id: 'sku-color-card.smart-object-editability',
            key: 'sku_color_card_smart_object_editability',
            label: '智能对象可编辑性',
            dimension: 'craft',
            weight: 5,
            severity: 'blocker',
            owner: 'execution',
            required: true,
            blockerKind: 'structural_damage',
            expectedFix: '逐卡读回智能对象类型，禁止以栅格化结果冒充可编辑色卡。'
        }),
        verificationCheck({
            id: 'sku-color-card.clipping-structure',
            key: 'sku_color_card_clipping_structure',
            label: '商品图裁切结构适用性',
            dimension: 'craft',
            weight: 5,
            // 分档（用户决策 2026-07-24）：质量梯度：剪切结构不理想属可改进项，交付并标注。
            severity: 'major',
            owner: 'execution',
            required: true,
            expectedFix: 'card 模式确认每张商品图在智能对象内部剪切到圆角底；flat 模式确认其无剪切结构，不得补造剪切关系。'
        }),
        verificationCheck({
            id: 'sku-color-card.label-text-fit',
            key: 'sku_color_card_label_text_fit',
            label: '色名文字适配与居中',
            dimension: 'craft',
            weight: 4,
            severity: 'major',
            owner: 'execution',
            required: true,
            expectedFix: '读取白底和文字的真实 bounds，缩小超宽文字并验证水平、垂直居中。'
        }),
        verificationCheck({
            id: 'sku-color-card.visual-consistency',
            key: 'sku_color_card_visual_consistency',
            label: '色卡视觉一致性',
            dimension: 'overall',
            weight: 3,
            severity: 'major',
            owner: 'visual',
            required: true,
            expectedFix: '基于写后快照评价商品主体大小、重心、裁切，以及卡片、标签和编号的一致性；必要时调整后再次观察。'
        })
    ],
    scoring: { passThreshold: 80, minCoverage: 0.8 },
    outputType: 'design-scorecard',
    finalVerdictProvider: DESIGN_QUALITY_VERDICT_CAPABILITY_ID,
    boundaries: PROFILE_BOUNDARIES
});

const DESIGN_EVALUATION_PROFILES: readonly DesignEvaluationProfile[] = Object.freeze([
    MAIN_IMAGE_PROFILE,
    MAIN_IMAGE_SCOPED_EDIT_PROFILE,
    SINGLE_CANVAS_VISUAL_PROFILE,
    SINGLE_CANVAS_VISUAL_SCOPED_EDIT_PROFILE,
    GENERAL_DESIGN_PROFILE,
    GENERAL_DESIGN_SCOPED_EDIT_PROFILE,
    DETAIL_PAGE_PROFILE,
    DETAIL_PAGE_CREATE_NEW_PROFILE,
    DETAIL_PAGE_SCOPED_EDIT_PROFILE,
    SKU_COLOR_CARD_PROFILE,
    SKU_BATCH_PROFILE
]);

/**
 * Profile 的适用性由评价层声明，不由 taskType 关键词或业务 Executor 猜测。
 * 通用 Design Foundation 可以被 artifact Manifest 显式引用；task-bound Profile
 * 仍要求 Skill 与 Task 身份同时精确匹配。
 */
export function isDesignEvaluationProfileApplicableToTask(
    profile: DesignEvaluationProfile,
    target: { skillId: string; taskType: string }
): boolean {
    if (profile.skillId === target.skillId && profile.taskType === target.taskType) return true;
    return profile.bindingPolicy === 'design_foundation';
}

function unique(values: readonly string[]): string[] {
    return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function isSafeToken(value: unknown): boolean {
    const text = String(value || '').trim();
    return Boolean(text)
        && text.length <= 160
        && SAFE_TOKEN_PATTERN.test(text)
        && !text.includes('..')
        && !text.includes('://')
        && !/api[_-]?key|access[_-]?token|secret/i.test(text);
}

export function validateDesignEvaluationProfile(
    profile: DesignEvaluationProfile
): DesignEvaluationProfileValidationResult {
    const issues: DesignEvaluationProfileValidationIssue[] = [];
    const add = (code: DesignEvaluationProfileValidationIssueCode, target: string): void => {
        issues.push({ code, target });
    };

    if (!isSafeToken(profile.profileId)) add('profile_id_invalid', 'profileId');
    if (!String(profile.skillId || '').trim() || !String(profile.taskType || '').trim()) {
        add('profile_identity_missing', 'skillId/taskType');
    }
    if (profile.bindingPolicy
        && profile.bindingPolicy !== 'task_bound'
        && profile.bindingPolicy !== 'design_foundation') {
        add('profile_binding_policy_invalid', 'bindingPolicy');
    }
    if (profile.finalReview) {
        const multiSurface = profile.finalReview.surfaceMode === 'declared_multi_surface';
        const singleSurface = profile.finalReview.surfaceMode === 'single_surface';
        const sourceKind = profile.finalReview.requiredSourceKind;
        const requiredViews = profile.finalReview.requiredViews || ['native_surface'];
        const viewsValid = requiredViews.length > 0
            && unique(requiredViews).length === requiredViews.length
            && requiredViews.every((view) => (
                view === 'native_surface' || view === 'list_thumbnail'
            ))
            && requiredViews.includes('native_surface')
            && (!requiredViews.includes('list_thumbnail') || singleSurface);
        if ((!multiSurface && !singleSurface)
            || (multiSurface && !isSafeToken(sourceKind))
            || (singleSurface && sourceKind !== undefined)
            || !viewsValid) {
            add('profile_final_review_policy_invalid', 'finalReview');
        }
    }
    if (!String(profile.capabilityGoal || '').trim()) add('profile_goal_missing', 'capabilityGoal');
    if (!Array.isArray(profile.methodKnowledgeRefs) || profile.methodKnowledgeRefs.length === 0) {
        add('profile_method_knowledge_empty', 'methodKnowledgeRefs');
    }
    if (unique(profile.methodKnowledgeRefs).length !== profile.methodKnowledgeRefs.length) {
        add('profile_method_knowledge_duplicate', 'methodKnowledgeRefs');
    }
    profile.methodKnowledgeRefs.forEach((capabilityId) => {
        const definition = METHOD_KNOWLEDGE_BY_ID.get(capabilityId);
        if (!definition) {
            add('profile_method_knowledge_unknown', capabilityId);
            return;
        }
        if (profile.bindingPolicy === 'design_foundation'
            && definition.applicableSkillIds.length > 0) {
            add('profile_method_knowledge_scope_mismatch', capabilityId);
            return;
        }
        if (definition.applicableSkillIds.length > 0
            && !definition.applicableSkillIds.includes(profile.skillId)) {
            add('profile_method_knowledge_scope_mismatch', capabilityId);
        }
    });
    // check-only Profile 是合法形态：规格化生产可只依赖有唯一答案的业务验证，
    // 不应为满足形式要求强行挂载通用 VLM 审美断言。
    if (!Array.isArray(profile.assertionRefs)) add('profile_assertions_empty', 'assertionRefs');
    if (unique(profile.assertionRefs).length !== profile.assertionRefs.length) {
        add('profile_assertion_duplicate', 'assertionRefs');
    }
    profile.assertionRefs.forEach((assertionId) => {
        if (!SHARED_ASSERTION_BY_ID.has(assertionId)) add('profile_assertion_unknown', assertionId);
    });
    if (!Array.isArray(profile.checks) || profile.checks.length === 0) {
        add('profile_checks_empty', 'checks');
    }
    const checkIds = profile.checks.map((check) => check.id);
    const checkKeys = profile.checks.map((check) => check.key);
    if (unique(checkIds).length !== checkIds.length || unique(checkKeys).length !== checkKeys.length) {
        add('profile_check_duplicate', 'checks');
    }
    if (!profile.checks.some((check) => check.required)) {
        add('profile_required_check_missing', 'checks');
    }
    profile.checks.forEach((check) => {
        if (!isSafeToken(check.id)
            || !isSafeToken(check.key)
            || !String(check.label || '').trim()
            || !String(check.expectedFix || '').trim()
            || !Number.isFinite(check.weight)
            || check.weight <= 0
            || check.weight > 10) {
            add('profile_check_invalid', check.id || check.key || 'unknown');
        }
        const blockerEvidenceShapeValid = check.severity === 'blocker'
            ? check.required && isDesignQualityBlockerKind(check.blockerKind)
            : check.blockerKind === undefined;
        if (!blockerEvidenceShapeValid) {
            add('profile_check_blocker_evidence_invalid', check.id || check.key || 'unknown');
        }
        if (!Array.isArray(check.allowedSources)
            || check.allowedSources.length === 0
            || unique(check.allowedSources).length !== check.allowedSources.length
            || check.allowedSources.some((source) => ![
                'task_contract',
                'runtime_observation',
                'quality_adapter',
                'human_review'
            ].includes(source))) {
            add('profile_check_source_policy_invalid', check.id || check.key || 'unknown');
        }
        let publicationReviewPolicyValid = false;
        if (check.completionScope === 'publication_review') {
            publicationReviewPolicyValid = check.required
                && check.allowedSources.length === 1
                && check.allowedSources[0] === 'human_review';
        } else if (check.completionScope === 'artifact_completion') {
            publicationReviewPolicyValid = !check.allowedSources.includes('human_review');
        }
        if (!publicationReviewPolicyValid) {
            add('profile_publication_review_policy_invalid', check.id || check.key || 'unknown');
        }
        if (check.runtime) {
            const evidenceValid = [
                'fresh_structure',
                'fresh_visual',
                'scoped_change',
                'declared_plan_closure'
            ].includes(check.runtime.evidence);
            const mutationPolicyValid = check.runtime.requiresMutation === undefined
                || check.runtime.requiresMutation === true;
            const repair = check.runtime.repair;
            const repairValid = !repair || (
                ['post_write_observation_missing', 'declared_plan_incomplete'].includes(repair.trigger)
                && ['R4', 'R5'].includes(repair.targetStage)
            );
            if (!evidenceValid || !mutationPolicyValid || !repairValid) {
                add('profile_check_runtime_policy_invalid', check.id || check.key || 'unknown');
            }
        }
    });
    if (!Number.isFinite(profile.scoring.passThreshold)
        || profile.scoring.passThreshold <= 0
        || profile.scoring.passThreshold > 100
        || !Number.isFinite(profile.scoring.minCoverage)
        || profile.scoring.minCoverage <= 0
        || profile.scoring.minCoverage > 1) {
        add('profile_threshold_invalid', 'scoring');
    }
    if (profile.finalVerdictProvider !== DESIGN_QUALITY_VERDICT_CAPABILITY_ID) {
        add('profile_final_verdict_provider_invalid', 'finalVerdictProvider');
    }
    return { valid: issues.length === 0, issues };
}

function assertBuiltinProfilesValid(): void {
    DESIGN_EVALUATION_PROFILES.forEach((profile) => {
        const validation = validateDesignEvaluationProfile(profile);
        if (!validation.valid) {
            throw new Error(`Evaluation Profile ${profile.profileId} 非法: ${JSON.stringify(validation.issues)}`);
        }
    });
}

assertBuiltinProfilesValid();

export function listDesignEvaluationProfiles(): readonly DesignEvaluationProfile[] {
    return DESIGN_EVALUATION_PROFILES;
}

export function getDesignEvaluationProfileById(
    profileId: string | undefined
): DesignEvaluationProfile | undefined {
    const normalized = String(profileId || '').trim();
    return DESIGN_EVALUATION_PROFILES.find((profile) => profile.profileId === normalized);
}

export function listDesignEvaluationProfileCapabilityProviders(): RuntimeCapabilityProviderIdentity[] {
    return DESIGN_EVALUATION_PROFILES.map((profile) => {
        const taskScope = profile.bindingPolicy === 'design_foundation'
            ? {}
            : {
                applicableSkillIds: [profile.skillId],
                applicableTaskTypes: [profile.taskType]
            };
        return {
            capabilityId: profile.profileId,
            kind: 'evaluation',
            providerId: `evaluation-profile:${profile.profileId}`,
            source: 'runtime_contract',
            exposure: 'evaluation_gate',
            exposedAsToolSchema: false,
            ...taskScope
        };
    });
}

function buildVerificationAssertion(check: DesignEvaluationCheck): DesignAssertion {
    return {
        id: check.id,
        dimension: check.dimension,
        label: check.label,
        weight: check.weight,
        severity: check.severity,
        method: 'deterministic',
        owner: check.owner,
        expectedFix: check.expectedFix
    };
}

/**
 * Profile 的完整诊断目录，供检查展示与兼容读取使用。数值评分不得消费此联合目录；
 * 评分调用方必须使用 getDesignEvaluationProfileScoringAssertions。
 */
export function getDesignEvaluationProfileAssertions(
    profile: DesignEvaluationProfile
): DesignAssertion[] {
    return [
        ...getDesignEvaluationProfileSharedAssertions(profile),
        ...profile.checks
            .filter((check) => check.completionScope === 'artifact_completion')
            .map(buildVerificationAssertion)
    ];
}

/**
 * Profile 的唯一审美评分目录。结构、读回和发布检查只负责验证覆盖与完成门禁，
 * 不得通过确定性 pass 分数抬高 overallScore、dimensionScores 或审美覆盖率。
 */
export function getDesignEvaluationProfileScoringAssertions(
    profile: DesignEvaluationProfile
): DesignAssertion[] {
    return getDesignEvaluationProfileSharedAssertions(profile);
}

export function getDesignEvaluationProfileSharedAssertions(
    profile: DesignEvaluationProfile
): DesignAssertion[] {
    return profile.assertionRefs
        .map((assertionId) => SHARED_ASSERTION_BY_ID.get(assertionId))
        .filter((assertion): assertion is DesignAssertion => Boolean(assertion));
}

export function getDesignEvaluationProfileVlmAssertions(
    profile: DesignEvaluationProfile
): DesignAssertion[] {
    return getVlmJudgeAssertions(getDesignEvaluationProfileScoringAssertions(profile));
}

function buildUnevaluatedResult(assertion: DesignAssertion, rationale: string): DesignAssertionResult {
    return {
        id: assertion.id,
        dimension: assertion.dimension,
        status: 'uneval',
        method: assertion.method,
        severity: assertion.severity,
        owner: assertion.owner,
        rationale,
        expectedFix: assertion.expectedFix
    };
}

function buildVerificationResult(
    check: DesignEvaluationCheck,
    verification: DesignEvaluationVerificationRecord | undefined
): DesignAssertionResult {
    const assertion = buildVerificationAssertion(check);
    if (!verification) {
        return buildUnevaluatedResult(assertion, `缺少结构化验证记录 ${check.key}，不能评价。`);
    }
    if (verification.status === 'passed') {
        return {
            ...buildUnevaluatedResult(assertion, `验证记录 ${verification.verificationRef} 已通过。`),
            status: 'pass'
        };
    }
    if (verification.status === 'failed') {
        const blockerEvidence = check.severity === 'blocker'
            && check.required
            && isDesignQualityBlockerKind(check.blockerKind)
            && isValidDesignQualityProofRef(verification.verificationRef)
            ? {
                blockerKind: check.blockerKind,
                proofRef: verification.verificationRef
            }
            : {};
        return {
            ...buildUnevaluatedResult(assertion, `验证记录 ${verification.verificationRef} 明确失败。`),
            status: 'fail',
            ...blockerEvidence
        };
    }
    return {
        ...buildUnevaluatedResult(assertion, `验证记录 ${verification.verificationRef} 需要复核。`),
        status: 'needs_review'
    };
}

function mergeRequiredVerificationFindings(
    scorecard: DesignEvaluationScorecard,
    results: readonly DesignAssertionResult[]
): DesignEvaluationScorecard {
    const uniqueById = (items: readonly DesignAssertionResult[]): DesignAssertionResult[] => (
        Array.from(new Map(items.map((item) => [item.id, item])).values())
    );
    const failed = results.filter((result) => result.status === 'fail');
    const needsReview = results.filter((result) => result.status === 'needs_review');
    const blockers = failed.filter(isQualifiedDesignQualityHardBlocker);
    return {
        ...scorecard,
        blockers: uniqueById([...scorecard.blockers, ...blockers]),
        failedAssertions: uniqueById([...scorecard.failedAssertions, ...failed]),
        needsReview: uniqueById([...scorecard.needsReview, ...needsReview]),
        results: uniqueById([...scorecard.results, ...results])
    };
}

function applyVerificationGate(input: {
    scorecard: DesignEvaluationScorecard;
    scoringAssertionCount: number;
    missingRequiredCheckKeys: readonly string[];
    failedRequiredCheckKeys: readonly string[];
    requiredNeedsReviewCheckKeys: readonly string[];
}): DesignEvaluationScorecard {
    if (input.failedRequiredCheckKeys.length > 0) {
        return {
            ...input.scorecard,
            gate: 'failed',
            passed: false,
            summary: `Evaluation Profile 有 ${input.failedRequiredCheckKeys.length} 项必需验证检查明确失败。`
        };
    }
    if (input.scorecard.gate === 'failed') return input.scorecard;
    if (input.missingRequiredCheckKeys.length > 0) {
        return {
            ...input.scorecard,
            gate: 'incomplete_verification',
            passed: false,
            summary: `Evaluation Profile 缺少 ${input.missingRequiredCheckKeys.length} 项必需验证检查，不能声明通过。`
        };
    }
    if (input.requiredNeedsReviewCheckKeys.length > 0
        && (input.scorecard.gate === 'passed' || input.scoringAssertionCount === 0)) {
        return {
            ...input.scorecard,
            gate: 'needs_review',
            passed: false,
            summary: 'Evaluation Profile 的必需验证检查仍需复核，不能声明通过。'
        };
    }
    if (input.scoringAssertionCount === 0) {
        return {
            ...input.scorecard,
            gate: 'passed',
            passed: true,
            summary: 'Evaluation Profile 未声明审美评分断言；必需验证检查均已通过。'
        };
    }
    return input.scorecard;
}

function normalizeVerificationRecords(
    input: readonly DesignEvaluationVerificationRecord[],
    checks: readonly DesignEvaluationCheck[]
): {
    byKey: Map<string, DesignEvaluationVerificationRecord>;
    unsafeCount: number;
    sourceViolationCount: number;
    conflictCount: number;
} {
    const byKey = new Map<string, DesignEvaluationVerificationRecord>();
    const checkByKey = new Map(checks.map((check) => [check.key, check]));
    let unsafeCount = 0;
    let sourceViolationCount = 0;
    let conflictCount = 0;
    const statusPriority: Record<DesignEvaluationVerificationStatus, number> = {
        passed: 1,
        needs_review: 2,
        failed: 3
    };
    input.forEach((record) => {
        if (!isSafeToken(record.key)
            || !isSafeToken(record.verificationRef)
            || !Object.prototype.hasOwnProperty.call(statusPriority, record.status)) {
            unsafeCount += 1;
            return;
        }
        const check = checkByKey.get(record.key);
        if (!check) return;
        if (!check.allowedSources.includes(record.source)) {
            sourceViolationCount += 1;
            return;
        }
        const existing = byKey.get(record.key);
        if (!existing) {
            byKey.set(record.key, record);
            return;
        }
        if (existing.status !== record.status) conflictCount += 1;
        if (statusPriority[record.status] > statusPriority[existing.status]) {
            byKey.set(record.key, record);
        }
    });
    return { byKey, unsafeCount, sourceViolationCount, conflictCount };
}

function normalizeScorecard(scorecard: DesignScorecard): DesignEvaluationScorecard {
    switch (scorecard.gate) {
        case 'passed':
        case 'failed':
        case 'needs_review':
            return { ...scorecard, gate: scorecard.gate };
        default:
            return {
                ...scorecard,
                gate: 'insufficient_observations',
                passed: false,
                summary: '当前观察覆盖不足，不能声明质量检查已通过。'
            };
    }
}

export function evaluateDesignEvaluationProfile(input: {
    profile: DesignEvaluationProfile;
    assertionResults: readonly DesignAssertionResult[];
    verificationRecords?: readonly DesignEvaluationVerificationRecord[];
}): DesignEvaluationProfileResult {
    const scoringAssertions = getDesignEvaluationProfileScoringAssertions(input.profile);
    const baseResultById = new Map(input.assertionResults.map((result) => [result.id, result]));
    const verificationState = normalizeVerificationRecords(
        input.verificationRecords || [],
        input.profile.checks
    );
    const scoringResults: DesignAssertionResult[] = [];

    input.profile.assertionRefs.forEach((assertionId) => {
        const assertion = SHARED_ASSERTION_BY_ID.get(assertionId);
        if (!assertion) return;
        scoringResults.push(baseResultById.get(assertionId)
            || buildUnevaluatedResult(assertion, `Profile 未取得断言 ${assertionId} 的评价结果。`));
    });
    let scorecard = normalizeScorecard(scoreDesignAssertions(scoringResults, {
        passThreshold: input.profile.scoring.passThreshold,
        minCoverage: input.profile.scoring.minCoverage,
        assertions: scoringAssertions
    }));
    const requiredChecks = input.profile.checks.filter((check) => (
        check.required && check.completionScope === 'artifact_completion'
    ));
    const requiredVerificationResults = requiredChecks.map((check) => (
        buildVerificationResult(check, verificationState.byKey.get(check.key))
    ));
    scorecard = mergeRequiredVerificationFindings(scorecard, requiredVerificationResults);
    const publicationReviewChecks = input.profile.checks.filter((check) => (
        check.completionScope === 'publication_review'
    ));
    const missingRequiredCheckKeys = requiredChecks
        .filter((check) => !verificationState.byKey.has(check.key))
        .map((check) => check.key);
    const failedCheckKeys = input.profile.checks
        .filter((check) => verificationState.byKey.get(check.key)?.status === 'failed')
        .map((check) => check.key);
    const failedRequiredCheckKeys = requiredChecks
        .filter((check) => verificationState.byKey.get(check.key)?.status === 'failed')
        .map((check) => check.key);
    const needsReviewCheckKeys = input.profile.checks
        .filter((check) => verificationState.byKey.get(check.key)?.status === 'needs_review')
        .map((check) => check.key);
    const requiredNeedsReviewCheckKeys = requiredChecks
        .filter((check) => verificationState.byKey.get(check.key)?.status === 'needs_review')
        .map((check) => check.key);
    const approvedPublicationReviewCheckCount = publicationReviewChecks.filter((check) => (
        verificationState.byKey.get(check.key)?.status === 'passed'
    )).length;
    const rejectedPublicationReviewCheckKeys = publicationReviewChecks
        .filter((check) => verificationState.byKey.get(check.key)?.status === 'failed')
        .map((check) => check.key);
    const pendingPublicationReviewCheckKeys = publicationReviewChecks
        .filter((check) => {
            const status = verificationState.byKey.get(check.key)?.status;
            return status === undefined || status === 'needs_review';
        })
        .map((check) => check.key);

    scorecard = applyVerificationGate({
        scorecard,
        scoringAssertionCount: scoringAssertions.length,
        missingRequiredCheckKeys,
        failedRequiredCheckKeys,
        requiredNeedsReviewCheckKeys
    });

    const issueCodes: DesignEvaluationProfileIssueCode[] = [];
    if (missingRequiredCheckKeys.length > 0) issueCodes.push('critical_check_missing');
    if (requiredNeedsReviewCheckKeys.length > 0) issueCodes.push('critical_check_needs_review');
    if (failedCheckKeys.length > 0) issueCodes.push('verification_explicitly_failed');
    if (verificationState.unsafeCount > 0) issueCodes.push('unsafe_verification_record_ignored');
    if (verificationState.sourceViolationCount > 0) issueCodes.push('verification_source_not_allowed');
    if (verificationState.conflictCount > 0) issueCodes.push('verification_record_conflict');

    const completedRequiredCheckCount = requiredChecks.length - missingRequiredCheckKeys.length;
    const verificationCoverageRatio = requiredChecks.length > 0
        ? completedRequiredCheckCount / requiredChecks.length
        : 0;

    let publicationReviewStatus: DesignPublicationReviewStatus = 'publication_review_not_required';
    if (publicationReviewChecks.length > 0) {
        if (rejectedPublicationReviewCheckKeys.length > 0) {
            publicationReviewStatus = 'publication_review_rejected';
        } else if (approvedPublicationReviewCheckCount === publicationReviewChecks.length) {
            publicationReviewStatus = 'publication_review_approved';
        } else {
            publicationReviewStatus = 'publication_review_pending';
        }
    }
    const completion: DesignEvaluationCompletionProjection = {
        artifactStatus: scorecard.gate === 'passed' ? 'artifact_completed' : 'artifact_incomplete',
        publicationReviewStatus,
        publicationReviewCheckCount: publicationReviewChecks.length,
        approvedPublicationReviewCheckCount,
        pendingPublicationReviewCheckKeys,
        rejectedPublicationReviewCheckKeys,
        boundaries: {
            artifactCompletionUsesPublicationReview: false,
            humanApprovalCanBeInferred: false
        }
    };

    return {
        version: 'design-evaluation-profile-result/v0',
        profileId: input.profile.profileId,
        status: scorecard.gate,
        scorecard,
        completion,
        verification: {
            missingRequiredCheckKeys,
            failedCheckKeys,
            needsReviewCheckKeys,
            requiredNeedsReviewCheckKeys
        },
        coverage: {
            requiredCheckCount: requiredChecks.length,
            completedRequiredCheckCount,
            ratio: verificationCoverageRatio
        },
        issueCodes: unique(issueCodes) as DesignEvaluationProfileIssueCode[],
        boundaries: {
            usesSingleDesignScorecard: true,
            finalVerdictOwnedByProfile: false,
            defaultPassWhenChecksMissing: false,
            containsRawMeasurementPayloads: false
        }
    };
}

export function buildDesignEvaluationProfileDigest(
    result: DesignEvaluationProfileResult
): DesignEvaluationProfileDigest {
    return {
        version: 'design-evaluation-profile-digest/v0',
        profileId: result.profileId,
        status: result.status,
        completion: {
            ...result.completion,
            pendingPublicationReviewCheckKeys: [...result.completion.pendingPublicationReviewCheckKeys],
            rejectedPublicationReviewCheckKeys: [...result.completion.rejectedPublicationReviewCheckKeys],
            boundaries: { ...result.completion.boundaries }
        },
        overallScore: result.scorecard.overallScore,
        coverageRatio: result.scorecard.coverage.ratio,
        requiredCheckCount: result.coverage.requiredCheckCount,
        completedRequiredCheckCount: result.coverage.completedRequiredCheckCount,
        missingRequiredCheckCount: result.verification.missingRequiredCheckKeys.length,
        failedCheckCount: result.verification.failedCheckKeys.length,
        needsReviewCheckCount: result.verification.needsReviewCheckKeys.length,
        missingRequiredCheckKeys: [...result.verification.missingRequiredCheckKeys],
        failedCheckKeys: [...result.verification.failedCheckKeys],
        needsReviewCheckKeys: [...result.verification.needsReviewCheckKeys],
        requiredNeedsReviewCheckKeys: [...result.verification.requiredNeedsReviewCheckKeys],
        verificationCoverageRatio: result.coverage.ratio,
        issueCodes: [...result.issueCodes],
        boundaries: {
            digestOnly: true,
            notFinalVerdict: true
        }
    };
}
