import type {
    AgentExecutionStatus,
    AgentToolCallLogEntry,
    TaskCompletionContext,
    TaskCompletionContract,
    TaskCompletionVerification,
    TaskCompletionKind,
    TaskCompletionReferenceObservation,
    TaskCompletionRequirement
} from './types';
import {
    readAgentVisualObservationOverflow,
    readAgentVisualObservation,
    readAgentVisualObservationReceipt,
    readAgentVisualObservations
} from './visual-observation-strategy';
import {
    buildVisualObservationKey,
    inspectVisualObservationBundles,
    readVisualObservationReviewDecision,
    readVisualObservationBundles,
    summarizeVisualObservationBundles
} from '../../../shared/visual-observation-bundle';
import type { VisualObservationBundle } from '../../../shared/visual-observation-bundle';
import type {
    DesignEvaluationCompletionProjection,
    DesignEvaluationProfile,
    DesignEvaluationProfileResult
} from '../../../shared/agent-runtime-v5/design-evaluation-profiles';
import { canonicalize } from '../../../shared/agent-runtime-v5/content-hash';
import { hasVerifiedEditableDocumentArtifact } from '../../../shared/agent-runtime-v5/runtime-delivery-receipt';
import { isQualifiedDesignQualityHardBlocker } from '../../../shared/design-quality-assertion';
import {
    buildAgentOperationDocumentTimeline,
    sameAgentOperationDocumentContext
} from '../../../shared/agent-operation-document-timeline';
import { buildAgentOperationLedger } from '../../../shared/agent-operation-ledger';
import {
    findObservedPhotoshopMutationProof,
    readPhotoshopHistoryStateRef,
    readPhotoshopMutationCommit,
    readPhotoshopSourceHistoryStateRef,
    samePhotoshopHistoryStateRef,
    type PhotoshopHistoryStateRef
} from '../../../shared/photoshop-history-state-ref';
import { readPhotoshopOperationResult } from '../../../shared/photoshop-operation-result';
import {
    isLayerOrganizationVisualEquivalenceProven,
    isLayerOrganizationVisualEquivalenceReceipt,
    type LayerOrganizationVisualEquivalenceReceipt
} from '../../../shared/layer-organization-visual-equivalence';
import {
    classifyAgentToolExecution,
    isAgentHarnessControlTool,
    isAgentPhotoshopDocumentObservation,
    parseExactPropertyReplacementRequest
} from '../../../shared/agent-tool-execution-preflight';
import { requiresAgentTaskDeliveryProgress } from '../../../shared/agent-task-planning-contract';
import { resolveAgentTaskSpeechAct } from '../../../shared/agent-task-progress-identity';
import { buildCreativeCompletionArtifactTargetPattern } from '../../../shared/design-category-terms';
import {
    collectUserDeliverableFileEvidence,
    projectUserDeliverableReceipts,
    type UserDeliverableEvidenceCandidate
} from '../../../shared/user-deliverable-receipts';
import {
    resolveRuntimeExecutionTarget,
    sameRuntimeExecutionDocument
} from '../../../shared/agent-runtime-v5/runtime-execution-target';
import {
    countTaskRunCreatedDocumentsForTarget,
    projectTaskRunCreatedDocumentLifecycle,
    type TaskRunDocumentCreationEvidence,
    type TaskRunCreatedDocumentDeliveryRequirement
} from '../../../shared/task-run-document-creation-evidence';

const INSPECTION_TOOLS = new Set([
    'getDocumentInfo',
    'getLayerHierarchy',
    'getAnnotatedSnapshot',
    'getAllTextLayers',
    'getTextContent',
    'getLayerBounds',
    'getLayerProperties',
    'getCanvasSnapshot',
    'getScreenSnapshots',
    'getScreenSnapshotsWithOverlay',
    'getAcceptanceSnapshot',
    'parseDetailPageTemplate',
    'describeImage',
    'listProjectResources',
    'searchProjectResources'
]);

const TEXT_MUTATION_TOOLS = new Set([
    'createTextLayer',
    'setTextContent',
    'setTextStyle',
    'moveLayer',
    'quickScale'
]);

const LAYER_ORDER_MUTATION_TOOLS = new Set([
    'reorderLayer'
]);

const LAYER_ORDER_VERIFICATION_TOOLS = new Set([
    'getLayerHierarchy',
    'getAcceptanceSnapshot'
]);

const LAYER_MANAGEMENT_MUTATION_TOOLS = new Set([
    'selectLayer',
    'renameLayer',
    'batchRenameLayers',
    'deleteLayer',
    'duplicateLayer',
    'groupLayersSafely',
    'groupLayers',
    'ungroupLayers',
    'createGroup',
    'setLayerOpacity',
    'setBlendMode',
    'setLayerVisibility',
    'lockLayer',
    // 真机病例（2026-07-07）：「置入到组内矩形+建剪切蒙版」被分类为图层管理，但置入/剪切/
    // 移动/排序都不在本集合——任务实际完成却判 0/3 未完成，触发无谓重跑并重复置入。
    // 图层关系操作全量补齐：完成检查必须覆盖该分类下真实会用到的写工具。
    'placeImage',
    'createClippingMask',
    'releaseClippingMask',
    'moveLayer',
    'moveLayerToGroup',
    'reorderLayer',
    'fitLayerSubjectToRegion'
]);

const LAYER_MANAGEMENT_VERIFICATION_TOOLS = new Set([
    'getLayerHierarchy',
    'getAnnotatedSnapshot',
    'getLayerProperties',
    'getAcceptanceSnapshot',
    // 剪切关系/边界/查找类读回同样是有效复核结果
    'getClippingMaskInfo',
    'getAllClippingMasks',
    'getLayerBounds',
    'findLayers',
    'getCanvasSnapshot'
]);

const LAYER_SEMANTIC_ORGANIZATION_MUTATION_TOOLS = new Set([
    'groupLayersSafely',
    'groupLayers',
    'ungroupLayers',
    'createGroup',
    'moveLayerToGroup'
]);

const LAYER_ORGANIZATION_VISUAL_VERIFICATION_TOOLS = new Set([
    'getAnnotatedSnapshot',
    'getCanvasSnapshot'
]);

const DOCUMENT_SAVE_TOOLS = new Set([
    'saveDocument',
    'quickExport',
    'exportDetailPageSlices',
    // 用户导出规范 4.0 移植（2026-07-07）：主图/详情页批量导出——完成契约必须认它为保存结果
    'exportMainImageDocuments'
]);

const DOCUMENT_CLOSE_TOOLS = new Set([
    'closeDocument'
]);

const DOCUMENT_VERIFICATION_TOOLS = new Set([
    'getDocumentInfo',
    'listDocuments',
    'getAcceptanceSnapshot'
]);

const REFERENCE_MUTATION_TOOLS = new Set([
    'createTextLayer',
    'setTextContent',
    'setTextStyle',
    'createRectangle',
    'createShape',
    'placeImage',
    'replaceLayerContent',
    'moveLayer',
    'quickScale',
    'fillDetailPage',
    'matchDetailPageContent'
]);

const TEXT_VERIFICATION_TOOLS = new Set([
    'getAllTextLayers',
    'getTextContent',
    'getLayerBounds',
    'getLayerProperties',
    'getAcceptanceSnapshot'
]);

const VISUAL_VERIFICATION_TOOLS = new Set([
    'getScreenSnapshotsWithOverlay',
    'getScreenSnapshots',
    'getCanvasSnapshot',
    'auditDetailPagePlacement'
]);

// 仅用于旧消息丢失 TaskPlan 时识别“发生过设计行为”的兼容 footprint；
// 这些工具类别不能反向成为新建画布、主体图或文案的完成义务。
// createDocument 可直接按成功写入计数；composeDesign 只有 document.mode=new 时才
// 算新建文档，且复合执行部分失败时必须同时有结构化回执与真实 Host 写入事实。
const DESIGN_CREATE_DOCUMENT_TOOLS = new Set([
    'createDocument'
]);

// 主视觉 = 置入真实素材图（产品/模特），形状/色块只算视觉元素不算主视觉。
const DESIGN_SUBJECT_IMAGE_TOOLS = new Set([
    'placeImage',
    'replaceLayerContent',
    'applyRasterImageResult',
    'composeDesign'
]);

const DESIGN_SHAPE_TOOLS = new Set([
    'renderLayout',
    'composeDesign',
    'createRectangle',
    'createEllipse',
    'createShape',
    'setLayerFill',
    'addGradientOverlay'
]);

const DESIGN_COPY_TOOLS = new Set([
    'renderLayout',
    'composeDesign',
    'createTextLayer',
    'setTextContent'
]);

const DESIGN_REVIEW_TOOLS = new Set([
    'getCanvasSnapshot',
    'getAnnotatedSnapshot',
    'getScreenSnapshots',
    'getScreenSnapshotsWithOverlay'
]);

const REFERENCE_ANALYSIS_TOOLS = new Set([
    'describeImage',
    'analyzeAssetContent'
]);

interface ContractInput {
    task: string;
    context?: TaskCompletionContext;
    toolCallLog: AgentToolCallLogEntry[];
    evaluationProfile?: DesignEvaluationProfile;
    evaluationProfileResult?: DesignEvaluationProfileResult;
}

interface StableTaskIdentity {
    task: string;
    skillId: string;
    intentMode: string;
}

interface AcceptanceCounts {
    verified: number;
    failed: number;
    needsReview: number;
    noDocumentChangeRisk: number;
}

interface CoverageVerification {
    expected: number;
    applied: number;
    failed: number;
    skipped: number;
    missingIds?: string[];
}

interface LayoutReplicationCompositeResult {
    createdDocumentCount: number;
    actionCount: number;
    failedActions: number;
    subjectCount: number;
    shapeCount: number;
    copyCount: number;
    visibleCopyCount: number;
}

type VisualVerification = NonNullable<TaskCompletionVerification['visual']>;

function toolSucceeded(entry: AgentToolCallLogEntry): boolean {
    return (entry as AgentToolCallLogEntry & { succeeded?: boolean }).succeeded !== false
        && entry.result?.success !== false;
}

function isSuccessfulWorkflowEnvelope(entry: AgentToolCallLogEntry): boolean {
    const role = (entry as AgentToolCallLogEntry & {
        operationLedgerProvenance?: { role?: string };
    }).operationLedgerProvenance?.role;
    return role === 'workflow_envelope' && entry.result?.success !== false;
}

function readCompletionMutationProof(entry: AgentToolCallLogEntry | undefined) {
    if (!entry
        || !toolSucceeded(entry)
        || classifyAgentToolExecution(entry.name, entry.arguments) !== 'photoshop_write') {
        return undefined;
    }
    const proof = findObservedPhotoshopMutationProof(entry.result);
    return proof?.toolActionCompleted === true ? proof : undefined;
}

function completionOperationSucceeded(entry: AgentToolCallLogEntry): boolean {
    if (!toolSucceeded(entry)) return false;
    if (classifyAgentToolExecution(entry.name, entry.arguments) !== 'photoshop_write') {
        return true;
    }
    return Boolean(readCompletionMutationProof(entry));
}

/** Completion 不把 Tool success 当成 Photoshop mutation；只消费 Host 版本证明。 */
function findLatestVerifiedPhotoshopMutationIndex(
    toolCallLog: AgentToolCallLogEntry[]
): number {
    for (let index = toolCallLog.length - 1; index >= 0; index -= 1) {
        if (readCompletionMutationProof(toolCallLog[index])) return index;
    }
    return -1;
}

function readAcceptanceHistoryStateRef(
    acceptance: any,
    phase: 'before' | 'after'
): PhotoshopHistoryStateRef | undefined {
    return readPhotoshopHistoryStateRef(acceptance?.[phase]);
}

function readExplicitReferenceObservation(
    context: TaskCompletionContext | undefined
): TaskCompletionReferenceObservation | undefined {
    const observation = context?.referenceObservation;
    if (observation?.version !== 'task-completion-reference-observation/v1'
        || observation.observed !== true
        || !Number.isFinite(observation.observationCount)
        || observation.observationCount <= 0) {
        return undefined;
    }
    return {
        version: 'task-completion-reference-observation/v1',
        observed: true,
        source: observation.source,
        observationCount: Math.round(observation.observationCount),
        ...(observation.toolName ? { toolName: observation.toolName } : {})
    };
}

function hasStructuredReferenceAnalysis(result: any): boolean {
    if (readAgentVisualObservation(result)?.reviewed === true) return true;
    const analysis = result?.analysis ?? result?.data?.analysis;
    if (typeof analysis === 'string') return analysis.trim().length > 0;
    return Boolean(analysis && typeof analysis === 'object' && Object.keys(analysis).length > 0);
}

function resolveReferenceObservation(
    input: ContractInput
): TaskCompletionReferenceObservation | undefined {
    const explicit = readExplicitReferenceObservation(input.context);
    if (explicit) return explicit;
    const toolObservation = input.toolCallLog.find((item) => (
        REFERENCE_ANALYSIS_TOOLS.has(item.name)
        && toolSucceeded(item)
        && hasStructuredReferenceAnalysis(item.result)
    ));
    if (!toolObservation) return undefined;
    return {
        version: 'task-completion-reference-observation/v1',
        observed: true,
        source: 'reference_analysis_tool',
        observationCount: 1,
        toolName: toolObservation.name
    };
}

function getAcceptance(result: any): any {
    return result?.acceptance || result?.data?.acceptance || null;
}

function hasVersionBoundVerifiedAcceptance(entry: AgentToolCallLogEntry, acceptance: any): boolean {
    if (!toolSucceeded(entry) || acceptance?.verified !== true) return false;
    const mutationProof = readCompletionMutationProof(entry);
    const acceptanceAfter = readAcceptanceHistoryStateRef(acceptance, 'after');
    return Boolean(
        mutationProof
        && acceptanceAfter
        && samePhotoshopHistoryStateRef(mutationProof.after, acceptanceAfter)
    );
}

function collectAcceptanceCounts(toolCallLog: AgentToolCallLogEntry[]): AcceptanceCounts {
    const counts: AcceptanceCounts = {
        verified: 0,
        failed: 0,
        needsReview: 0,
        noDocumentChangeRisk: 0
    };
    const timeline = buildAgentOperationDocumentTimeline(toolCallLog);
    const latestMutationByDocument = new Map<number, {
        index: number;
        revision: PhotoshopHistoryStateRef;
    }>();
    toolCallLog.forEach((item, index) => {
        const proof = readCompletionMutationProof(item);
        if (!proof) return;
        latestMutationByDocument.set(proof.after.documentId, {
            index,
            revision: proof.after
        });
    });

    for (let index = 0; index < toolCallLog.length; index += 1) {
        const item = toolCallLog[index];
        const acceptance = getAcceptance(item.result);
        if (!acceptance?.enabled) continue;
        if (hasVersionBoundVerifiedAcceptance(item, acceptance)) {
            counts.verified += 1;
        }
        const acceptanceAfter = readAcceptanceHistoryStateRef(acceptance, 'after');
        const latestMutation = acceptanceAfter
            ? latestMutationByDocument.get(acceptanceAfter.documentId)
            : undefined;
        const supersededRevision = Boolean(
            acceptanceAfter
            && latestMutation
            && latestMutation.index > index
            && !samePhotoshopHistoryStateRef(acceptanceAfter, latestMutation.revision)
        );
        const supersededOperation = hasLaterEquivalentSuccessfulOperation({
            toolCallLog,
            timeline,
            index
        });
        // Acceptance 是某一次操作、某一个 Host revision 的诊断。后续同义务已经成功，
        // 或同一文档已经进入更新的受信 revision 时，旧诊断仍保留在 Tool / Run Record，
        // 但不能继续冒充当前最终版本的 blocker。
        if (supersededRevision || supersededOperation) continue;
        if (acceptance.assertionStatus === 'failed') {
            counts.failed += 1;
        }
        if (acceptance.assertionStatus === 'needs_review'
            || acceptance.noDocumentChangeRisk === true
            || (acceptance.verified === false && acceptance.assertionStatus !== 'failed')) {
            counts.needsReview += 1;
        }
        if (acceptance.noDocumentChangeRisk === true) {
            counts.noDocumentChangeRisk += 1;
        }
    }

    return counts;
}

function resolveEvaluationCompletionProjection(
    profile: DesignEvaluationProfile,
    result: DesignEvaluationProfileResult
): DesignEvaluationCompletionProjection {
    if (result.completion) return result.completion;

    // 兼容旧的内存中 Profile result：缺少双轴投影时绝不从“未失败”推断人工通过。
    const publicationReviewChecks = profile.checks.filter((check) => (
        check.completionScope === 'publication_review'
    ));
    const failedCheckKeys = new Set(result.verification.failedCheckKeys);
    const requiredArtifactCheckKeys = profile.checks
        .filter((check) => check.required && check.completionScope === 'artifact_completion')
        .map((check) => check.key);
    const missingRequiredCheckKeys = new Set(result.verification.missingRequiredCheckKeys);
    const requiredNeedsReviewCheckKeys = new Set(result.verification.requiredNeedsReviewCheckKeys);
    const artifactChecksCompleted = requiredArtifactCheckKeys.length > 0
        ? requiredArtifactCheckKeys.every((key) => (
            !failedCheckKeys.has(key)
            && !missingRequiredCheckKeys.has(key)
            && !requiredNeedsReviewCheckKeys.has(key)
        ))
        // 旧内存结果没有 completion 双轴，也可能来自迁移前的无 checks Profile；只在这条
        // 明确兼容路径保留旧 passed 口径，新 Profile 一律由 artifact checks 决定。
        : result.status === 'passed';
    const rejectedPublicationReviewCheckKeys = publicationReviewChecks
        .filter((check) => failedCheckKeys.has(check.key))
        .map((check) => check.key);
    let publicationReviewStatus: DesignEvaluationCompletionProjection['publicationReviewStatus'] =
        'publication_review_not_required';
    if (publicationReviewChecks.length > 0) {
        publicationReviewStatus = rejectedPublicationReviewCheckKeys.length > 0
            ? 'publication_review_rejected'
            : 'publication_review_pending';
    }
    return {
        artifactStatus: artifactChecksCompleted ? 'artifact_completed' : 'artifact_incomplete',
        publicationReviewStatus,
        publicationReviewCheckCount: publicationReviewChecks.length,
        approvedPublicationReviewCheckCount: 0,
        pendingPublicationReviewCheckKeys: publicationReviewChecks
            .filter((check) => !failedCheckKeys.has(check.key))
            .map((check) => check.key),
        rejectedPublicationReviewCheckKeys,
        boundaries: {
            artifactCompletionUsesPublicationReview: false,
            humanApprovalCanBeInferred: false
        }
    };
}

function buildSkillEvaluationProfileContract(
    input: ContractInput,
    acceptance: AcceptanceCounts
): TaskCompletionContract | undefined {
    const profile = input.evaluationProfile;
    const result = input.evaluationProfileResult;
    if (!profile || !result || result.profileId !== profile.profileId) return undefined;
    const completion = resolveEvaluationCompletionProjection(profile, result);

    const missing = new Set(result.verification.missingRequiredCheckKeys);
    const failed = new Set(result.verification.failedCheckKeys);
    const needsReview = new Set(result.verification.needsReviewCheckKeys);
    const qualifiedHardFailureIds = new Set(
        result.scorecard.blockers
            .filter(isQualifiedDesignQualityHardBlocker)
            .map((assertion) => assertion.id)
    );
    const artifactChecks = profile.checks.filter((check) => (
        check.completionScope === 'artifact_completion'
    ));
    const required = artifactChecks
        .filter((check) => check.required)
        .map((check): TaskCompletionRequirement => {
            if (failed.has(check.key)) {
                const hardFailed = qualifiedHardFailureIds.has(check.id);
                return {
                    id: check.id,
                    label: check.label,
                    status: hardFailed ? 'failed' : 'needs_review',
                    reason: hardFailed
                        ? check.expectedFix
                        : `${check.label}的结构化检查明确未通过，${check.expectedFix}`
                };
            }
            if (missing.has(check.key)) {
                return {
                    id: check.id,
                    label: check.label,
                    status: 'needs_review',
                    reason: `缺少${check.label}，${check.expectedFix}`
                };
            }
            if (needsReview.has(check.key)) {
                return {
                    id: check.id,
                    label: check.label,
                    status: 'needs_review',
                    reason: `${check.label}仍需复核，${check.expectedFix}`
                };
            }
            return {
                id: check.id,
                label: check.label,
                status: 'passed'
            };
        });
    // Evaluation Profile 是当前任务视觉完成判定的唯一 owner。中间 composeDesign 可能
    // 携带用于当轮设计判断的 Bundle；它不是最终交付 ReviewSet，不能因为其中一张没有
    // 单独写回 reviewed=true，就在 canonical Final Judge 之外再造第二个完成门禁。
    // 旧 creative_design 路径仍在其各自契约中使用 collectVisualReviewCounts。
    const blockers = artifactChecks
        .filter((check) => check.required && qualifiedHardFailureIds.has(check.id))
        .map((check) => `${check.label}未通过：${check.expectedFix}`);
    const requiredWarnings = required
        .filter((requirement) => requirement.status === 'needs_review')
        .map((requirement) => requirement.reason || `${requirement.label}需要复核。`);
    const optionalWarnings = artifactChecks
        .filter((check) => !check.required && (needsReview.has(check.key) || failed.has(check.key)))
        .map((check) => (failed.has(check.key)
            ? `${check.label}是可选复核项，结构化记录明确未通过：${check.expectedFix}`
            : `${check.label}是可选复核项：${check.expectedFix}`));
    const publicationWarnings: string[] = [];
    let publicationSummary = '无需发布审核。';
    switch (completion.publicationReviewStatus) {
        case 'publication_review_pending':
            if (completion.artifactStatus === 'artifact_completed') {
                publicationWarnings.push(
                    `设计产物已完成机器验收；发布前仍有 ${completion.pendingPublicationReviewCheckKeys.length} 项人工审核待完成。`
                );
            } else {
                publicationWarnings.push('发布审核尚未完成；应先补齐产物机器验收，再进行人工发布复核。');
            }
            publicationSummary = '发布审核待人工完成。';
            break;
        case 'publication_review_rejected':
            publicationWarnings.push('当前产物的人工发布审核未通过；产物完成状态不变，但不能据此声明可发布。');
            publicationSummary = '发布审核未通过。';
            break;
        case 'publication_review_approved':
            publicationSummary = '当前产物的发布审核已通过。';
            break;
        default:
            break;
    }
    const warnings = [...new Set([...requiredWarnings, ...optionalWarnings, ...publicationWarnings])];
    let status: AgentExecutionStatus = 'completed';
    if (required.some((item) => item.status === 'failed')) {
        status = 'failed';
    } else if (requiredWarnings.length > 0
        || completion.artifactStatus !== 'artifact_completed') {
        status = 'needs_review';
    }
    const passedCount = required.filter((item) => item.status === 'passed').length;

    return {
        kind: 'skill_evaluation_profile',
        status,
        required,
        verification: {
            toolAcceptance: acceptance
        },
        blockers,
        warnings,
        completion: {
            ...completion,
            pendingPublicationReviewCheckKeys: [...completion.pendingPublicationReviewCheckKeys],
            rejectedPublicationReviewCheckKeys: [...completion.rejectedPublicationReviewCheckKeys],
            boundaries: { ...completion.boundaries }
        },
        summary: `${profile.capabilityGoal} 当前 ${passedCount}/${required.length} 项产物关键检查通过；${publicationSummary}`
    };
}

function isSimplePhotoshopToolValidationTask(text: string): boolean {
    const hasValidationIntent =
        /(工具调用|工具链|处理步骤|小型工具|小工具).{0,16}(验证|测试|联调)|(?:验证|测试|联调).{0,16}(工具调用|工具链|处理步骤|小型工具|小工具)/.test(text)
        || /反馈.{0,24}(layerid|groupid|layer id|group id|图层\s*id|组\s*id)/i.test(text)
        || /(layerid|groupid|layer id|group id).{0,24}(反馈|返回|读取|读回)/i.test(text);
    if (!hasValidationIntent) return false;
    return /(photoshop|ps|文档|画布|图层组|图层|矩形|形状|文字图层|文本图层|文字|文本|group|layer|rectangle|text)/i.test(text);
}

/**
 * Completion 只能消费入口已签发的 TaskPlan 来识别本轮交付物，不能在公开计划确认、
 * 续跑或 Reflexion 后从“确认/继续执行”这类当前消息重新猜任务身份。没有计划时，
 * 保留旧任务文本与 runtime context 的兼容行为。
 */
function resolveStableTaskIdentity(input: ContractInput): StableTaskIdentity {
    const plan = input.context?.agentTaskPlan;
    const plannedGoal = String(plan?.designBrief?.goal || '').trim();
    if (plan && plannedGoal) {
        return {
            task: plannedGoal,
            skillId: plan.skillId || input.context?.skillId || '',
            intentMode: plan.mode || input.context?.intentMode || ''
        };
    }
    return {
        task: String(input.task || ''),
        skillId: input.context?.skillId || '',
        intentMode: input.context?.intentMode || ''
    };
}

function inferTaskKind(input: ContractInput): TaskCompletionKind | null {
    const { task, skillId, intentMode } = resolveStableTaskIdentity(input);
    const text = `${task} ${skillId} ${intentMode}`.toLowerCase();
    const toolNames = input.toolCallLog.map((item) => item.name);
    const hasTextMutation = toolNames.some((name) => TEXT_MUTATION_TOOLS.has(name));
    const hasExplicitLayerManagementIntent = skillId === 'layer-management'
        || /(?:图层|一层).{0,16}(整理|归组|组合|选中|选择|名字|名称|命名|改名|重命名|删除|复制|拷贝|编组|解除编组|透明度|混合模式|改成|改为|换成)|(?:整理|归组|组合|选中|选择|名字|名称|命名|改名|重命名|删除|复制|拷贝|编组|解除编组).{0,16}(?:图层|一层)/.test(text)
        || input.toolCallLog.some(isLayerOrganizationSkillEntry);
    const exactPropertyReplacement = parseExactPropertyReplacementRequest(task);
    const hasSuccessfulLayerManagementMutation = input.toolCallLog.some((item) =>
        LAYER_MANAGEMENT_MUTATION_TOOLS.has(item.name) && completionOperationSucceeded(item));
    const hasSuccessfulTextContentMutation = input.toolCallLog.some((item) =>
        item.name === 'setTextContent' && completionOperationSucceeded(item));
    const hasAnyMutationSuccess = input.toolCallLog.some((item) => (
        completionOperationSucceeded(item)
        && classifyAgentToolExecution(item.name, item.arguments) === 'photoshop_write'
    ));

    // 只读任务不套写类完成契约。优先消费入口 TaskPlan 的结构化只读身份；旧计划或
    // 路由误判时，用户明确禁止修改同样是请求级权限边界。两者都只在本轮确实零写入时
    // 生效：如果已经发生真实 mutation，仍按实际操作类型验收，不能借「别改原图」之类
    // 局部约束逃掉新文档/副本上的写后验证。
    const planIsReadOnly = input.context?.agentTaskPlan?.requestKind === 'read_only_inspect'
        || input.context?.agentTaskPlan?.allowedToolScope === 'read_only'
        || input.context?.agentTaskPlan?.executionPlan.mode === 'read_only';
    const userForbidsMutation = /(?:不要|不需|不用|禁止|别).{0,8}(?:修改|改动|编辑|写入|保存|导出|动(?:文件|文档|画面|图层))|(?:只读|仅查看|只查看|仅检查|只检查|仅分析|只分析|先只回答|只回答|仅回答)/.test(text);
    if ((planIsReadOnly || userForbidsMutation) && !hasAnyMutationSuccess) {
        return null;
    }
    if (planIsReadOnly && hasAnyMutationSuccess) {
        return 'creative_design';
    }

    // 兼容尚未签发结构化只读计划、但用「分析/查看 + 不改」表达的旧入口。关键词只用于
    // 缩窄到无写入兼容路径，不能授权或阻断 Tool。
    const isReadOnlyAnalysisIntent =
        /(评审|分析|审查|诊断|检查|查看|理解)/.test(text)
        && /(不要改|不改动|不修改|仅分析|只分析|先分析|评审通过前|不动画面|不会改动|只读)/.test(text);
    if (isReadOnlyAnalysisIntent && !hasAnyMutationSuccess) {
        return null;
    }

    // 小型工具/处理步骤验证不是「从零设计成品」：即使它调用 createDocument +
    // createRectangle + createTextLayer，也只需要按真实工具结果和读回层级汇报。
    // 不能套用创意设计完成契约，否则会把成功的工具链验证误报成「缺少主视觉/画面复核」。
    if (isSimplePhotoshopToolValidationTask(text)) {
        return null;
    }

    // response_only 是上游已经作出的结构化问答身份。它必须优先于下方基于“改/保存/
    // 关闭”等字样推断的原子执行契约；否则“你能把标题改成红色吗？”会被问答中的
    // 动词误判为一次失败的 Photoshop 修改。真实命令仍由 tool_execution Plan 或实际
    // Tool 记录进入下方防假完成契约。
    // 只有结构化 TaskPlan 已签发生产义务，或本轮真实尝试过交付动作，才允许把文本里的
    // “主图 / 详情页 / SKU”等成品词升级成高层创意生产身份。原子文字、图层、保存/关闭
    // 任务仍由下方各自的确定性契约识别，不能因为没有高层生产身份就撤掉防假完成检查。
    // 真实失败的写入尝试同样算生产事实，因此这里看调用分类而不是 success；Harness
    // 控制调用、只读观察和知识检索都不能铸造高层创意完成契约。
    const agenticArtifactContract = input.context?.agenticArtifactContract;
    const hasStructuredProductionObligation = requiresAgentTaskDeliveryProgress(
        input.context?.agentTaskPlan
    ) || agenticArtifactContract?.productionObligation === 'photoshop_mutation_with_readback';
    const hasAttemptedProductionOperation = input.toolCallLog.some((item) => {
        if (isAgentHarnessControlTool(item.name)) return false;
        const kind = classifyAgentToolExecution(item.name, item.arguments);
        return kind === 'photoshop_write'
            || kind === 'save_export'
            || kind === 'external_generation';
    });
    const hasTaskPlan = Boolean(input.context?.agentTaskPlan);
    const taskSpeechAct = hasTaskPlan ? undefined : resolveAgentTaskSpeechAct(task);
    const hasLegacyExplicitProductionIdentity = !hasTaskPlan
        && taskSpeechAct?.speechAct === 'explicit_execution';
    const hasProductionAuthority = hasStructuredProductionObligation
        || hasAttemptedProductionOperation
        || hasLegacyExplicitProductionIdentity;
    // Completion 不再维护自己的任务身份。主路径只消费 TaskPlan 或真实交付尝试；
    // 只有没有 TaskPlan 的旧入口才复用同一语用判定。这样字体方案、条件检查等
    // response-only 计划不会被下方“保存 / 删除 / 修改”等字样重新升级成执行失败。
    if ((input.context?.agentTaskPlan?.executionPlan.mode === 'none'
        && !hasAttemptedProductionOperation)
        || (hasTaskPlan
            && !hasStructuredProductionObligation
            && !hasAttemptedProductionOperation)
        || (!hasTaskPlan
            && !hasAttemptedProductionOperation
            && taskSpeechAct?.speechAct !== 'explicit_execution')) {
        return null;
    }

    // 创意设计成品（做主图/详情页/海报）的任务身份优先于实现方法：
    // “参考图/复刻 Skill”可以是海报的执行方法，但不能把海报交付物降级成纯参考复刻契约。
    // 必须优先于 layer_order/document/text/layer_management 等编辑类契约——设计过程中模型会调
    // reorderLayer/createTextLayer/saveDocument/setLayerOpacity 等原子工具，这些按 toolNames 命中会让
    // 编辑类契约抢先，把整个设计任务误判（实测被判「图层顺序编辑 0/3」「文字编辑 0/3」，措辞误导且
    // 判定标准不适用于设计成品）。只有没有明确成品身份的纯复刻任务才走 reference_replication。
    const compositeResult = collectLayoutReplicationCompositeResult(input.toolCallLog);
    const hasCreateDocumentSuccess = input.toolCallLog.some(
        (item) => item.name === 'createDocument' && completionOperationSucceeded(item)
    ) || compositeResult.createdDocumentCount > 0;
    const isReplicationTask = skillId === 'layout-replication'
        || /参考图|复刻|仿照|照着|还原|复现|临摹|同款(?:版式|设计|效果|画面)|(?:做|设计|制作|改).{0,8}同款/.test(text);
    const isDocumentManagementTask = skillId === 'document-management';
    const hasCreativeDesignIntent =
        /从零|从0|从头|凭空|创意设计|创作/.test(text)
        // SKU 系列（色卡/组合图/自选备注/批量出图）同样是「产出交付物」的执行类任务，
        // 必须与主图/详情页一样受完成契约约束。此前 subset 漏列，导致「帮我完成 SKU 编排」
        // 推断不出任务类型、直接 return null——没有契约就没有任何检查，真机因此出现
        // 零写入却报告「已完成」并把用户自己的成果描述成自身产出的假完成。
        || new RegExp(`(设计|做|画|制作|生成|创作|完成|编排|排版).{0,5}(一[张个版幅])?\\s*(${buildCreativeCompletionArtifactTargetPattern()})`).test(text);
    // 工具序列识别：建文档 + 视觉元素(图/形状) + 文案文本层，本身就是创意设计行为。
    // 公开计划确认后 currentTask 会变成「确认执行公开计划」、丢掉原 brief 的设计意图，
    // 此时 hasCreativeDesignIntent 文本判定会落空（实测被误判成 text_content_edit），用工具序列认出。
    const hasDesignToolFootprint =
        hasCreateDocumentSuccess
        && (countSuccessful(input.toolCallLog, DESIGN_SUBJECT_IMAGE_TOOLS) + compositeResult.subjectCount > 0
            || countSuccessful(input.toolCallLog, DESIGN_SHAPE_TOOLS) + compositeResult.shapeCount > 0)
        && countSuccessful(input.toolCallLog, DESIGN_COPY_TOOLS) + compositeResult.copyCount > 0;
    const hasUserDeclaredDeliverables = (
        input.context?.agentTaskPlan?.designBrief.userDeclaredDeliverables?.length || 0
    ) > 0;
    if (hasProductionAuthority && agenticArtifactContract && !isDocumentManagementTask) {
        return 'creative_design';
    }
    if (hasProductionAuthority && hasUserDeclaredDeliverables && !isDocumentManagementTask) {
        return 'creative_design';
    }
    if (hasProductionAuthority && hasCreativeDesignIntent && !isDocumentManagementTask) {
        return 'creative_design';
    }
    if (hasProductionAuthority
        && hasDesignToolFootprint
        && !isReplicationTask
        && !isDocumentManagementTask) {
        return 'creative_design';
    }

    // 复刻同样是高层任务，优先于原子编辑契约：复刻过程会调 reorderLayer/createTextLayer 等，
    // 否则被 layer_order/text 抢判（与 creative_design 同理）。只用明确复刻信号，不用裸「按.*图」
    // （会误命中「按从浅到深调整图层顺序」这类图层任务）。
    if (hasProductionAuthority && (isReplicationTask || /参考.*设计/.test(text))) {
        return 'reference_replication';
    }

    if (/图层.{0,12}(顺序|层级|排序|置顶|置底|上移|下移)|(?:顺序|层级|排序|置顶|置底|上移|下移).{0,12}图层|从浅到深|从深到浅|移到.*(?:上方|下方|顶层|底层)/.test(text)
        || toolNames.some((name) => LAYER_ORDER_MUTATION_TOOLS.has(name))) {
        return 'layer_order_edit';
    }

    if (skillId === 'document-management' && intentMode === 'close'
        || /关闭(?:当前)?文档|关掉(?:当前)?文档|close document|close file/.test(text)
        || toolNames.some((name) => DOCUMENT_CLOSE_TOOLS.has(name))) {
        return 'document_close';
    }

    if (skillId === 'document-management' && intentMode === 'save'
        || /保存文档|保存当前文档|导出当前文档|保存为|导出为|save document|export document|save psd|export png/.test(text)
        || toolNames.some((name) => DOCUMENT_SAVE_TOOLS.has(name))) {
        return 'document_save';
    }

    // 精确替换的属性 hint 已在执行预检中区分正向写入目标与“别改/保持不变”的负向约束。
    // 完成 Owner 必须复用同一解析结果，不能让“图层名字别改”把文字替换误判为图层管理。
    if (exactPropertyReplacement?.hint === 'text_content') {
        return 'text_content_edit';
    }
    if (exactPropertyReplacement?.hint === 'layer_name') {
        return 'layer_management';
    }

    // 图层名称里常含「标题 / 副标题 / 文案」等业务词。用户明确说的是图层名字或命名时，
    // 这些词不能让下方宽泛的文字内容规则抢走任务身份。真机自然问法曾连续 3 次正确执行
    // renameLayer 并取得 committed 读回，却被误判为 text_content_edit 0/3 而对用户宣告失败。
    if (hasExplicitLayerManagementIntent) {
        return 'layer_management';
    }

    // 对未写明属性的“A 改成 B”，执行预检已经用写前真实读回把 A 绑定到了唯一属性。
    // 完成 Owner 必须沿用真实 committed mutation 的属性身份，不能再被图层名称里的“标题/文案”
    // 等业务词抢判成文字编辑；否则会在正确重命名后误报 0/3 并重放任务。
    if (exactPropertyReplacement
        && hasSuccessfulLayerManagementMutation
        && !hasSuccessfulTextContentMutation) {
        return 'layer_management';
    }
    if (exactPropertyReplacement
        && hasSuccessfulTextContentMutation
        && !hasSuccessfulLayerManagementMutation) {
        return 'text_content_edit';
    }

    if (/字体|字号|字重|字距|行距|思源|黑体|宋体|微软雅黑|居中|对齐|换行|标点|文字排版|文本排版/.test(text)) {
        return 'text_typography_edit';
    }

    if (/(文字|文本|文案|标题|副标题|内容).{0,16}(改成|替换|修改|删除|添加|创建|输入|写入)|(?:改成|替换|修改|删除|添加|创建|输入|写入).{0,16}(文字|文本|文案|标题|副标题|内容)|删除.*字|添加.*字|创建.*字/.test(text)
        || hasTextMutation) {
        return 'text_content_edit';
    }

    if (toolNames.some((name) => LAYER_MANAGEMENT_MUTATION_TOOLS.has(name))) {
        return 'layer_management';
    }

    return null;
}

function firstSuccessfulIndex(toolCallLog: AgentToolCallLogEntry[], names: Set<string>): number {
    return toolCallLog.findIndex((item) => names.has(item.name) && completionOperationSucceeded(item));
}

function lastSuccessfulIndex(toolCallLog: AgentToolCallLogEntry[], names: Set<string>): number {
    for (let index = toolCallLog.length - 1; index >= 0; index -= 1) {
        const item = toolCallLog[index];
        if (item && names.has(item.name) && completionOperationSucceeded(item)) return index;
    }
    return -1;
}

function hasVerifiedAcceptanceAtOrAfter(
    toolCallLog: AgentToolCallLogEntry[],
    startIndex: number
): boolean {
    if (startIndex < 0) return false;
    const timeline = buildAgentOperationDocumentTimeline(toolCallLog);
    const mutationContext = timeline.entries[startIndex];
    const mutationProof = readCompletionMutationProof(toolCallLog[startIndex]);
    if (!mutationProof) return false;
    return toolCallLog.some((item, index) => index >= startIndex
        && toolSucceeded(item)
        && getAcceptance(item.result)?.verified === true
        && samePhotoshopHistoryStateRef(
            readAcceptanceHistoryStateRef(getAcceptance(item.result), 'after'),
            mutationProof.after
        )
        && sameAgentOperationDocumentContext(mutationContext, timeline.entries[index]));
}

function hasSuccessfulBefore(toolCallLog: AgentToolCallLogEntry[], names: Set<string>, beforeIndex: number): boolean {
    if (beforeIndex < 0) return false;
    const timeline = buildAgentOperationDocumentTimeline(toolCallLog);
    const mutationContext = timeline.entries[beforeIndex];
    const mutationProof = readCompletionMutationProof(toolCallLog[beforeIndex]);
    if (!mutationProof?.before) return false;
    return toolCallLog.some((item, index) => index < beforeIndex
        && names.has(item.name)
        && toolSucceeded(item)
        && isAgentPhotoshopDocumentObservation(item.name, item.arguments)
        && samePhotoshopHistoryStateRef(
            readPhotoshopHistoryStateRef(item.result),
            mutationProof.before
        )
        && sameAgentOperationDocumentContext(timeline.entries[index], mutationContext));
}

function hasSuccessfulAfter(toolCallLog: AgentToolCallLogEntry[], names: Set<string>, afterIndex: number): boolean {
    if (afterIndex < 0) return false;
    const timeline = buildAgentOperationDocumentTimeline(toolCallLog);
    const mutationContext = timeline.entries[afterIndex];
    const mutationProof = readCompletionMutationProof(toolCallLog[afterIndex]);
    if (!mutationProof) return false;
    return toolCallLog.some((item, index) => index > afterIndex
        && names.has(item.name)
        && toolSucceeded(item)
        && isAgentPhotoshopDocumentObservation(item.name, item.arguments)
        && samePhotoshopHistoryStateRef(
            readPhotoshopHistoryStateRef(item.result),
            mutationProof.after
        )
        && sameAgentOperationDocumentContext(mutationContext, timeline.entries[index]));
}

function countSuccessful(toolCallLog: AgentToolCallLogEntry[], names: Set<string>): number {
    return toolCallLog.filter((item) => names.has(item.name) && completionOperationSucceeded(item)).length;
}

function countCreatedDocuments(toolCallLog: AgentToolCallLogEntry[]): number {
    const timeline = buildAgentOperationDocumentTimeline(toolCallLog);
    const directCreateCount = countSuccessful(toolCallLog, DESIGN_CREATE_DOCUMENT_TOOLS);
    const composeCreateCount = toolCallLog.filter((item, index) => {
        if (item.name !== 'composeDesign') return false;
        const documentMode = String(item.arguments?.document?.mode || '').trim();
        if (documentMode !== 'new') return false;
        if (completionOperationSucceeded(item)) return true;
        return item.result?.data?.createdDocument === true
            && timeline.entries[index]?.photoshopMutationObserved === true;
    }).length;
    return directCreateCount + composeCreateCount;
}

function countPriorTaskRunCreatedDocumentsForMutation(
    context: TaskCompletionContext | undefined,
    mutationProof: ReturnType<typeof readCompletionMutationProof>
): number {
    const chain = context?.taskRunDocumentCreation;
    return countTaskRunCreatedDocumentsForTarget({
        evidence: chain?.evidence,
        taskRunId: chain?.taskRunId,
        generation: chain?.generation,
        targetDocumentId: mutationProof?.after.documentId
    });
}

function isSafeRejectedGroupingAttempt(entry: AgentToolCallLogEntry): boolean {
    if (entry.name !== 'groupLayersSafely' || toolSucceeded(entry)) return false;
    const operationResult = readPhotoshopOperationResult(entry.result);
    return Boolean(
        operationResult
        && operationResult.applicationStatus === 'not_applied'
        && operationResult.transactionState === 'rolled_back'
        && operationResult.rollback.attempted
        && operationResult.rollback.verified
    );
}

function countBlockingOperationFailures(
    toolCallLog: AgentToolCallLogEntry[],
    names: Set<string>
): number {
    return countUnresolvedFailedOperations(
        toolCallLog,
        names,
        (item) => !isSafeRejectedGroupingAttempt(item)
    );
}

const MAX_OPERATION_OBLIGATION_ARGUMENT_CHARS = 4096;

function buildOperationObligationArgumentsKey(value: unknown): string | undefined {
    const normalized = canonicalize(value ?? {});
    return normalized.length <= MAX_OPERATION_OBLIGATION_ARGUMENT_CHARS
        ? normalized
        : undefined;
}

/**
 * 只承认“同 Tool、同参数、同 Photoshop 文档上下文”的后续成功为同义务修复。
 * 这是刻意保守的：不同目标或不同参数可能是另一项工作，不能仅因使用了同一种 Tool
 * 就抹去失败；无法生成有界参数身份时同样不做 supersession。
 */
function hasLaterEquivalentSuccessfulOperation(input: {
    toolCallLog: AgentToolCallLogEntry[];
    timeline: ReturnType<typeof buildAgentOperationDocumentTimeline>;
    index: number;
}): boolean {
    const failed = input.toolCallLog[input.index];
    if (!failed || completionOperationSucceeded(failed)) return false;
    const failedArgumentsKey = buildOperationObligationArgumentsKey(failed.arguments);
    if (!failedArgumentsKey) return false;
    const failedContext = input.timeline.entries[input.index];
    return input.toolCallLog.some((candidate, candidateIndex) => (
        candidateIndex > input.index
        && candidate.name === failed.name
        && completionOperationSucceeded(candidate)
        && buildOperationObligationArgumentsKey(candidate.arguments) === failedArgumentsKey
        && sameAgentOperationDocumentContext(
            failedContext,
            input.timeline.entries[candidateIndex]
        )
    ));
}

function countUnresolvedFailedOperations(
    toolCallLog: AgentToolCallLogEntry[],
    names: Set<string>,
    includeFailure: (entry: AgentToolCallLogEntry) => boolean = () => true
): number {
    const timeline = buildAgentOperationDocumentTimeline(toolCallLog);
    return toolCallLog.filter((item, index) => (
        names.has(item.name)
        && !completionOperationSucceeded(item)
        && includeFailure(item)
        && !hasLaterEquivalentSuccessfulOperation({
            toolCallLog,
            timeline,
            index
        })
    )).length;
}

function isKnownVisualObservationIdentityPart(value: string, allowRootPath = false): boolean {
    const normalized = String(value || '').trim();
    if (!normalized || normalized === 'unknown') return false;
    return allowRootPath || normalized !== '$';
}

function readEntryVisualObservationReceipt(entry: AgentToolCallLogEntry) {
    return readAgentVisualObservationReceipt(entry.result);
}

function isCompleteVersionBoundVisualObservationBundle(
    entry: AgentToolCallLogEntry,
    bundle: VisualObservationBundle,
    entryContext?: ReturnType<typeof buildAgentOperationDocumentTimeline>['entries'][number]
): boolean {
    if (bundle.expectedObservationCount <= 0
        || bundle.items.length !== bundle.expectedObservationCount) {
        return false;
    }

    const receipt = readEntryVisualObservationReceipt(entry);
    if (!receipt) return false;
    const receiptTarget = resolveRuntimeExecutionTarget({
        result: { documentId: receipt.document }
    });
    if (entryContext?.target
        && (!receiptTarget || !sameRuntimeExecutionDocument(entryContext.target, receiptTarget))) {
        return false;
    }
    let expectedDocument = '';
    let expectedHistory = '';
    const observationKeys = new Set<string>();
    for (const item of bundle.items) {
        const identity = item.identity;
        if (identity.outer !== entry.name
            || !isKnownVisualObservationIdentityPart(identity.resultPath)
            || !isKnownVisualObservationIdentityPart(identity.document, true)
            || !isKnownVisualObservationIdentityPart(identity.history, true)
            || !isKnownVisualObservationIdentityPart(identity.sourceKind, true)
            || !isKnownVisualObservationIdentityPart(identity.sourceId, true)) {
            return false;
        }
        if (!expectedDocument) {
            expectedDocument = identity.document;
            expectedHistory = identity.history;
        } else if (identity.document !== expectedDocument || identity.history !== expectedHistory) {
            return false;
        }
        observationKeys.add(buildVisualObservationKey(identity));
    }
    return observationKeys.size === bundle.expectedObservationCount
        && expectedDocument === receipt.document
        && expectedHistory === receipt.history;
}

function hasVersionBoundVisualObservationBundle(
    entry: AgentToolCallLogEntry,
    entryContext?: ReturnType<typeof buildAgentOperationDocumentTimeline>['entries'][number]
): boolean {
    const bundles = readVisualObservationBundles(entry.result, entry.name);
    return bundles.some((bundle) => (
        isCompleteVersionBoundVisualObservationBundle(entry, bundle, entryContext)
    ));
}

function collectVisualReviewCounts(
    toolCallLog: AgentToolCallLogEntry[],
    names: Set<string>,
    latestMutationIndex: number = -1,
    scope?: {
        endExclusive?: number;
        acceptsObservation?: (entry: AgentToolCallLogEntry, index: number) => boolean;
    }
): {
    expectedCount: number;
    capturedCount: number;
    reviewedCount: number;
    passedCount: number;
    needsFixCount: number;
    unreadableCount: number;
    unreviewedCount: number;
    overflowCount: number;
    allPassed: boolean;
} {
    const timeline = buildAgentOperationDocumentTimeline(toolCallLog);
    const mutationContext = latestMutationIndex >= 0
        ? timeline.entries[latestMutationIndex]
        : undefined;
    const latestCompositeLayoutIndex = toolCallLog.reduce((latest, item, index) => (
        item.name === 'renderLayout'
            && completionOperationSucceeded(item)
            && item.result?.postWriteObservation?.captured === true
            && item.result?.postWriteObservation?.verifiedSameDocumentVersion === true
            ? index
            : latest
    ), -1);
    const captured = toolCallLog.filter((item, index) => {
        if (scope?.endExclusive !== undefined && index >= scope.endExclusive) return false;
        if (scope?.acceptsObservation && !scope.acceptsObservation(item, index)) return false;
        if (!toolSucceeded(item) && !isSuccessfulWorkflowEnvelope(item)) return false;
        const isStandaloneObservation = names.has(item.name)
            && (latestMutationIndex < 0
                || (index > latestMutationIndex
                    && sameAgentOperationDocumentContext(mutationContext, timeline.entries[index])));
        if (isStandaloneObservation) return true;

        // 复合 Skill 可以通过通用 visualObservationBundle/v1 返回内部写后多图观察记录。
        // 只认可绑定了 document + history 的观察记录；按 outer/resultPath/document/history/
        // sourceKind/sourceId 聚合，不把任何具体业务 Skill 名加入白名单。
        const bundleScan = inspectVisualObservationBundles(item.result, item.name);
        const bundles = bundleScan.bundles;
        const hasVersionBoundBundle = hasVersionBoundVisualObservationBundle(
            item,
            timeline.entries[index]
        );
        // 结构无效的候选也进入计数器，随后以 unreadable 失败关闭；不能静默丢掉坏包，
        // 否则同一轮里另一张合法截图可能掩盖跨文档、跨版本或缺失身份的观察记录。
        const hasBundledObservationCandidate = (
            hasVersionBoundBundle
            || bundles.length > 0
            || bundleScan.truncated
            || bundleScan.invalidBundleCount > 0
        )
            && (latestMutationIndex < 0
                || index === latestMutationIndex
                || (index > latestMutationIndex
                    && sameAgentOperationDocumentContext(mutationContext, timeline.entries[index])));
        if (hasBundledObservationCandidate) return true;

        // renderLayout 是复合写操作：其 postWriteObservation 在内部最后一次写入之后捕获，
        // 但在顶层日志中与 mutation 共用一个索引。只认可 Harness 明确标记 captured 的
        // 同一条复合收据；普通写结果或 mutation 前的图片不能借此冒充写后复核。
        return item.name === 'renderLayout'
            && (latestMutationIndex < 0
                ? index === latestCompositeLayoutIndex
                : index === latestMutationIndex)
            && item.result?.postWriteObservation?.captured === true
            && item.result?.postWriteObservation?.verifiedSameDocumentVersion === true;
    });
    const effectiveCaptured = captured.filter((item, position) => {
        const bundles = readVisualObservationBundles(item.result, item.name);
        if (bundles.length === 0) return true;
        const logicalKeys = new Set(bundles.flatMap((bundle) => (
            bundle.items.map((observation) => [
                observation.identity.outer,
                observation.identity.document,
                observation.identity.sourceKind,
                observation.identity.sourceId
            ].join('|'))
        )));
        if (logicalKeys.size === 0) return true;
        return !captured.slice(position + 1).some((later) => {
            const laterKeys = new Set(readVisualObservationBundles(later.result, later.name)
                .flatMap((bundle) => bundle.items.map((observation) => [
                    observation.identity.outer,
                    observation.identity.document,
                    observation.identity.sourceKind,
                    observation.identity.sourceId
                ].join('|'))));
            return Array.from(logicalKeys).every((key) => laterKeys.has(key));
        });
    });
    let expectedCount = 0;
    let capturedCount = 0;
    let reviewedCount = 0;
    let passedCount = 0;
    let needsFixCount = 0;
    let unreadableCount = 0;
    let overflowCount = 0;
    for (const item of effectiveCaptured) {
        const itemIndex = toolCallLog.indexOf(item);
        const observations = readAgentVisualObservations(item.result);
        const bundleScan = inspectVisualObservationBundles(item.result, item.name);
        const bundles = bundleScan.bundles;
        if (bundles.length > 0 || bundleScan.invalidBundleCount > 0 || bundleScan.truncated) {
            const invalidBundleCount = bundleScan.invalidBundleCount + bundles.filter((bundle) => (
                !isCompleteVersionBoundVisualObservationBundle(
                    item,
                    bundle,
                    itemIndex >= 0 ? timeline.entries[itemIndex] : undefined
                )
            )).length;
            const summary = summarizeVisualObservationBundles(
                bundles,
                observations.flatMap((observation) => (
                    observation.reviewDecision ? [observation.reviewDecision] : []
                ))
            );
            const runtimeOverflow = readAgentVisualObservationOverflow(item.result);
            expectedCount += Math.max(
                summary.expectedCount,
                runtimeOverflow?.expectedCount || 0,
                invalidBundleCount > 0 || bundleScan.truncated ? 1 : 0
            );
            capturedCount += summary.capturedCount;
            reviewedCount += summary.reviewedCount;
            passedCount += summary.passedCount;
            needsFixCount += summary.needsFixCount;
            unreadableCount += summary.unreadableCount + invalidBundleCount;
            overflowCount += Math.max(
                summary.overflowCount,
                runtimeOverflow?.omittedCount || 0,
                bundleScan.truncated ? 1 : 0
            );
            continue;
        }

        const fallbackObservation = observations.length === 0
            ? readAgentVisualObservation(item.result)
            : undefined;
        const legacyObservations = observations.length > 0
            ? observations
            : (fallbackObservation ? [fallbackObservation] : []);
        const legacyCapturedCount = Math.max(1, legacyObservations.length);
        const legacyDecisions = legacyObservations
            .map((observation) => readVisualObservationReviewDecision(
                observation.reviewDecision,
                observation.observationKey
            ))
            .filter((decision): decision is NonNullable<typeof decision> => Boolean(decision));
        const runtimeOverflow = readAgentVisualObservationOverflow(item.result);
        expectedCount += Math.max(legacyCapturedCount, runtimeOverflow?.expectedCount || 0);
        capturedCount += legacyCapturedCount;
        reviewedCount += legacyDecisions.length;
        passedCount += legacyDecisions.filter((decision) => decision.status === 'passed').length;
        needsFixCount += legacyDecisions.filter((decision) => decision.status === 'needs_fix').length;
        unreadableCount += legacyDecisions.filter((decision) => decision.status === 'unreadable').length;
        overflowCount += runtimeOverflow?.omittedCount || 0;
    }
    const unreviewedCount = Math.max(0, expectedCount - reviewedCount);
    return {
        expectedCount,
        capturedCount,
        reviewedCount,
        passedCount,
        needsFixCount,
        unreadableCount,
        unreviewedCount,
        overflowCount,
        allPassed: expectedCount > 0
            && passedCount >= expectedCount
            && needsFixCount === 0
            && unreadableCount === 0
            && overflowCount === 0
    };
}

function resolveVisualReviewMode(
    visualReview: ReturnType<typeof collectVisualReviewCounts>
): 'none' | 'captured_only' | 'screenshot' {
    if (visualReview.allPassed) return 'screenshot';
    if (visualReview.capturedCount > 0) return 'captured_only';
    return 'none';
}

function buildCreativeVisualReviewReason(
    visualReview: ReturnType<typeof collectVisualReviewCounts>
): string | undefined {
    if (visualReview.allPassed) return undefined;
    if (visualReview.overflowCount > 0) {
        return `仍有 ${visualReview.overflowCount} 张画面因视觉预算或生产端限制未进入复核，不能把部分画面冒充整体验收。`;
    }
    if (visualReview.needsFixCount > 0) {
        return `视觉复核明确发现 ${visualReview.needsFixCount} 张画面需要修订，修订并重新看图后才能通过。`;
    }
    if (visualReview.unreadableCount > 0) {
        return `仍有 ${visualReview.unreadableCount} 张画面无法读取，不能确认排版与可读性。`;
    }
    if (visualReview.capturedCount > 0) {
        return '已取得画面截图，但尚未由主模型或视觉专家逐张完成显式结构化复核，不能确认排版与可读性。';
    }
    return '设计完成后缺少画面截图复核（getAnnotatedSnapshot / getCanvasSnapshot），无法确认排版与可读性。';
}

function isRenderLayoutSubjectRole(value: unknown): boolean {
    return /^(main-image|hero-image|product-image|model-image|product|model)$/i.test(String(value || '').trim());
}

function countRenderLayoutSubjectImages(toolCallLog: AgentToolCallLogEntry[]): number {
    let count = 0;
    for (const item of toolCallLog) {
        if (item.name !== 'renderLayout' || !completionOperationSucceeded(item)) continue;
        const argumentBlocks = Array.isArray(item.arguments?.blocks) ? item.arguments.blocks : [];
        const createdBlocks = Array.isArray(item.result?.created) ? item.result.created : [];
        const argumentSubjectCount = argumentBlocks.filter((block: any) => {
            if (!isRenderLayoutSubjectRole(block?.role)) return false;
            return Boolean(block?.imagePath || block?.filePath || block?.sourcePath || block?.assetPath || block?.image);
        }).length;
        const createdSubjectCount = createdBlocks.filter((block: any) => isRenderLayoutSubjectRole(block?.role)).length;
        count += Math.max(argumentSubjectCount, createdSubjectCount);
    }
    return count;
}

interface RenderLayoutQualityState {
    qualityState: 'passed' | 'needs_review' | 'needs_repair' | 'failed';
    unresolved: boolean;
    findings: any[];
    suggestedObservation?: any;
    layoutLogIndex: number;
    repairActionCount: number;
    verifiedClosureCount: number;
    unresolvedFindingCount: number;
    reviewedObservationCount: number;
    criticClosureCount: number;
    ownerCount: number;
    unresolvedOwnerCount: number;
}

function isLayoutQualityOwnerEntry(entry: AgentToolCallLogEntry): boolean {
    return entry.name === 'renderLayout' || entry.name === 'composeDesign';
}

interface LatestRenderLayoutQualityOwner {
    ownerId: string;
    stageId: string;
    unscoped: boolean;
    layoutLogIndex: number;
    layoutResult: any;
    documentContext: ReturnType<typeof buildAgentOperationDocumentTimeline>['entries'][number];
    visualTarget?: { x: number; y: number; width: number; height: number };
}

function normalizeRenderLayoutVisualTarget(
    target: { x: number; y: number; width: number; height: number } | undefined
): { x: number; y: number; width: number; height: number } | undefined {
    if (!target) return undefined;
    const normalize = (value: number): number => Math.round(value * 1000) / 1000;
    return {
        x: normalize(target.x),
        y: normalize(target.y),
        width: normalize(target.width),
        height: normalize(target.height)
    };
}

function readRenderLayoutOwnerIdentity(entry: AgentToolCallLogEntry): {
    stageId: string;
    visualTarget?: { x: number; y: number; width: number; height: number };
    unscoped: boolean;
} {
    const receipt = entry.result?.ownerReceipt && typeof entry.result.ownerReceipt === 'object'
        ? entry.result.ownerReceipt
        : undefined;
    const stageId = String(receipt?.stageId || entry.arguments?.stagePlan?.currentStage?.id || '').trim();
    const receiptTarget = readVisualCoverageRect(receipt?.screenRegion);
    const rawScreenRegion = entry.arguments?.screenRegion;
    const canvasWidth = Number(entry.arguments?.canvas?.width);
    const screenY = Number(rawScreenRegion?.y);
    const screenHeight = Number(rawScreenRegion?.height);
    const argumentTarget = Number.isFinite(canvasWidth) && canvasWidth > 0
        && Number.isFinite(screenY) && screenY >= 0
        && Number.isFinite(screenHeight) && screenHeight > 0
        ? { x: 0, y: screenY, width: canvasWidth, height: screenHeight }
        : undefined;
    const visualTarget = normalizeRenderLayoutVisualTarget(receiptTarget || argumentTarget);
    return {
        stageId,
        visualTarget,
        unscoped: !stageId && !visualTarget
    };
}

function sameRenderLayoutVisualTarget(
    left: LatestRenderLayoutQualityOwner['visualTarget'],
    right: LatestRenderLayoutQualityOwner['visualTarget']
): boolean {
    if (!left || !right) return !left && !right;
    return left.x === right.x
        && left.y === right.y
        && left.width === right.width
        && left.height === right.height;
}

function sameScopedRenderLayoutOwner(
    owner: LatestRenderLayoutQualityOwner,
    identity: ReturnType<typeof readRenderLayoutOwnerIdentity>,
    documentContext: LatestRenderLayoutQualityOwner['documentContext']
): boolean {
    if (owner.unscoped || identity.unscoped) return false;
    return owner.stageId === identity.stageId
        && sameRenderLayoutVisualTarget(owner.visualTarget, identity.visualTarget)
        && sameAgentOperationDocumentContext(owner.documentContext, documentContext);
}

function unscopedRenderProvesPreviousDraftRetired(
    owner: LatestRenderLayoutQualityOwner,
    nextEntry: AgentToolCallLogEntry
): boolean {
    const previousLayerIds = Array.isArray(owner.layoutResult?.createdLayerIds)
        ? owner.layoutResult.createdLayerIds
            .map((value: unknown) => Number(value))
            .filter((value: number) => Number.isFinite(value) && value > 0)
        : [];
    if (previousLayerIds.length === 0) return false;
    const retiredLayerIds = new Set(
        (Array.isArray(nextEntry.result?.stageRefreshActions) ? nextEntry.result.stageRefreshActions : [])
            .filter((action: any) => action?.success !== false && /^delete/i.test(String(action?.action || '')))
            .map((action: any) => Number(action?.layerId))
            .filter((value: number) => Number.isFinite(value) && value > 0)
    );
    return previousLayerIds.every((layerId: number) => retiredLayerIds.has(layerId));
}

function paramsContainExpected(actual: unknown, expected: unknown): boolean {
    if (expected === null || typeof expected !== 'object') {
        return actual === expected;
    }
    if (Array.isArray(expected)) {
        if (!Array.isArray(actual) || actual.length !== expected.length) return false;
        return expected.every((item, index) => paramsContainExpected(actual[index], item));
    }
    if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
    return Object.entries(expected as Record<string, unknown>).every(([key, value]) =>
        paramsContainExpected((actual as Record<string, unknown>)[key], value));
}

function findExactFindingActionIndex(input: {
    toolCallLog: AgentToolCallLogEntry[];
    afterIndex: number;
    finding: any;
}): number {
    const action = input.finding?.recommendedAction;
    if (!action || typeof action.toolName !== 'string' || !action.params || typeof action.params !== 'object') {
        return -1;
    }
    const timeline = buildAgentOperationDocumentTimeline(input.toolCallLog);
    const findingContext = timeline.entries[input.afterIndex];
    return input.toolCallLog.findIndex((entry, index) =>
        index > input.afterIndex
        && entry.name === action.toolName
        && completionOperationSucceeded(entry)
        && sameAgentOperationDocumentContext(findingContext, timeline.entries[index])
        && paramsContainExpected(entry.arguments || {}, action.params));
}

function collectLatestRenderLayoutQualityOwners(
    toolCallLog: AgentToolCallLogEntry[]
): LatestRenderLayoutQualityOwner[] {
    const timeline = buildAgentOperationDocumentTimeline(toolCallLog);
    const owners: LatestRenderLayoutQualityOwner[] = [];
    for (let index = 0; index < toolCallLog.length; index += 1) {
        const entry = toolCallLog[index];
        if (!isLayoutQualityOwnerEntry(entry)) continue;
        if (!entry.result?.qualityState) continue;
        const documentContext = timeline.entries[index];
        const identity = readRenderLayoutOwnerIdentity(entry);
        let owner: LatestRenderLayoutQualityOwner | undefined;
        for (let ownerIndex = owners.length - 1; ownerIndex >= 0; ownerIndex -= 1) {
            const candidate = owners[ownerIndex];
            if (identity.unscoped) {
                if (candidate.unscoped
                    && sameAgentOperationDocumentContext(candidate.documentContext, documentContext)
                    && unscopedRenderProvesPreviousDraftRetired(candidate, entry)) {
                    owner = candidate;
                    break;
                }
                continue;
            }
            if (sameScopedRenderLayoutOwner(candidate, identity, documentContext)) {
                owner = candidate;
                break;
            }
        }
        if (owner) {
            owner.layoutLogIndex = index;
            owner.layoutResult = entry.result;
            owner.documentContext = documentContext;
            owner.visualTarget = identity.visualTarget;
            continue;
        }
        owners.push({
            ownerId: identity.unscoped ? `unscoped:${index}` : `scoped:${index}`,
            stageId: identity.stageId,
            unscoped: identity.unscoped,
            layoutLogIndex: index,
            layoutResult: entry.result,
            documentContext,
            visualTarget: identity.visualTarget
        });
    }
    return owners;
}

function readVisualCoverageRect(value: unknown): { x: number; y: number; width: number; height: number } | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    const x = Number(record.x);
    const y = Number(record.y);
    const width = Number(record.width);
    const height = Number(record.height);
    if (!Number.isFinite(x) || !Number.isFinite(y)
        || !Number.isFinite(width) || width <= 0
        || !Number.isFinite(height) || height <= 0) {
        return undefined;
    }
    return { x, y, width, height };
}

function visualCoverageContains(
    coverage: { x: number; y: number; width: number; height: number },
    target: { x: number; y: number; width: number; height: number }
): boolean {
    return coverage.x <= target.x
        && coverage.y <= target.y
        && coverage.x + coverage.width >= target.x + target.width
        && coverage.y + coverage.height >= target.y + target.height;
}

function observationCoversRenderLayoutOwner(
    entry: AgentToolCallLogEntry,
    index: number,
    owner: LatestRenderLayoutQualityOwner
): boolean {
    if (isLayoutQualityOwnerEntry(entry)) return index === owner.layoutLogIndex;
    if (entry.name === 'getCanvasSnapshot' || entry.name === 'getAnnotatedSnapshot') {
        const coverage = readVisualCoverageRect(entry.arguments?.region || entry.result?.region);
        if (!coverage) return true;
        return Boolean(owner.visualTarget && visualCoverageContains(coverage, owner.visualTarget));
    }
    if (entry.name === 'getScreenSnapshots' || entry.name === 'getScreenSnapshotsWithOverlay') {
        const target = owner.visualTarget;
        if (!target) return false;
        const screens = Array.isArray(entry.arguments?.screens) ? entry.arguments.screens : [];
        return screens.some((screen: any) => {
            const coverage = readVisualCoverageRect(screen?.bounds || screen?.region || screen);
            return Boolean(coverage && visualCoverageContains(coverage, target));
        });
    }
    return false;
}

function collectRenderLayoutOwnerVisualReviewCounts(
    toolCallLog: AgentToolCallLogEntry[],
    owner: LatestRenderLayoutQualityOwner,
    afterIndex: number
): ReturnType<typeof collectVisualReviewCounts> {
    const timeline = buildAgentOperationDocumentTimeline(toolCallLog);
    let endExclusive = toolCallLog.length;
    for (let index = afterIndex + 1; index < toolCallLog.length; index += 1) {
        const entry = toolCallLog[index];
        if (!isLayoutQualityOwnerEntry(entry) || !timeline.entries[index]?.photoshopMutationObserved) continue;
        const identity = readRenderLayoutOwnerIdentity(entry);
        const sameOwner = sameScopedRenderLayoutOwner(owner, identity, timeline.entries[index]);
        if (!sameOwner) {
            endExclusive = index;
            break;
        }
    }

    // 同 owner 的旧裁决只对当时 revision 有效。精确修复后若又发生同文档写入，
    // 必须从最新 mutation 之后重新看图；这样 needs_fix → 修正 → passed 可以闭合，
    // 同时不会把修正前的失败裁决永久累计到最终状态。
    let latestRelevantMutationIndex = afterIndex;
    for (let index = afterIndex + 1; index < endExclusive; index += 1) {
        if (timeline.entries[index]?.photoshopMutationObserved
            && sameAgentOperationDocumentContext(owner.documentContext, timeline.entries[index])) {
            latestRelevantMutationIndex = index;
        }
    }

    return collectVisualReviewCounts(
        toolCallLog,
        DESIGN_REVIEW_TOOLS,
        latestRelevantMutationIndex,
        {
            endExclusive,
            acceptsObservation: (entry, index) => (
                observationCoversRenderLayoutOwner(entry, index, owner)
            )
        }
    );
}

function hasSameDocumentComparativeVisualReviewPass(
    toolCallLog: AgentToolCallLogEntry[],
    owner: LatestRenderLayoutQualityOwner,
    afterIndex: number
): boolean {
    const timeline = buildAgentOperationDocumentTimeline(toolCallLog);
    let endExclusive = toolCallLog.length;
    for (let index = afterIndex + 1; index < toolCallLog.length; index += 1) {
        const entry = toolCallLog[index];
        if (!isLayoutQualityOwnerEntry(entry) || !timeline.entries[index]?.photoshopMutationObserved) continue;
        const identity = readRenderLayoutOwnerIdentity(entry);
        if (!sameScopedRenderLayoutOwner(owner, identity, timeline.entries[index])) {
            endExclusive = index;
            break;
        }
    }

    let latestRelevantMutationIndex = afterIndex;
    for (let index = afterIndex + 1; index < endExclusive; index += 1) {
        if (timeline.entries[index]?.photoshopMutationObserved
            && sameAgentOperationDocumentContext(owner.documentContext, timeline.entries[index])) {
            latestRelevantMutationIndex = index;
        }
    }
    const latestMutationProof = readCompletionMutationProof(toolCallLog[latestRelevantMutationIndex]);
    const expectedRevision = latestMutationProof?.after
        || readPhotoshopHistoryStateRef(toolCallLog[latestRelevantMutationIndex]?.result);
    if (!expectedRevision) return false;

    for (let index = latestRelevantMutationIndex + 1; index < endExclusive; index += 1) {
        const entry = toolCallLog[index];
        if (!DESIGN_REVIEW_TOOLS.has(entry.name)
            || !completionOperationSucceeded(entry)
            || !sameAgentOperationDocumentContext(owner.documentContext, timeline.entries[index])
            || !observationCoversRenderLayoutOwner(entry, index, owner)) {
            continue;
        }
        const receipt = readAgentVisualObservationReceipt(entry.result);
        if (!receipt
            || receipt.document !== String(expectedRevision.documentId)
            || receipt.history !== String(expectedRevision.historyStateId)) {
            continue;
        }
        const hasModelReason = readAgentVisualObservations(entry.result).some((observation) => {
            const decision = readVisualObservationReviewDecision(
                observation.reviewDecision,
                observation.observationKey
            );
            return decision?.status === 'passed'
                && decision.reviewer === 'primary_model'
                && Boolean(String(decision.comparisonReason || '').trim());
        });
        if (hasModelReason) return true;
    }
    return false;
}

function collectRenderLayoutOwnerQualityState(
    toolCallLog: AgentToolCallLogEntry[],
    owner: LatestRenderLayoutQualityOwner
): RenderLayoutQualityState {
    const { layoutLogIndex, layoutResult } = owner;
    const rawState = String(layoutResult.qualityState || '');
    const qualityState: RenderLayoutQualityState['qualityState'] =
        rawState === 'needs_repair' || rawState === 'needs_review' || rawState === 'failed'
            ? rawState
            : 'passed';
    const findings = Array.isArray(layoutResult.qualityFindings) ? layoutResult.qualityFindings : [];
    let repairActionCount = 0;
    let verifiedClosureCount = 0;
    let unresolvedFindingCount = 0;
    let reviewedObservationCount = 0;
    let criticClosureCount = 0;

    for (const finding of findings) {
        const closureKind = String(finding?.closureKind || (
            finding?.recommendedAction ? 'mutation' : 'replan'
        ));
        if (closureKind === 'replan') {
            unresolvedFindingCount += 1;
            continue;
        }
        if (closureKind === 'visual') {
            const visual = collectRenderLayoutOwnerVisualReviewCounts(toolCallLog, owner, layoutLogIndex);
            reviewedObservationCount += visual.reviewedCount;
            if (visual.allPassed) verifiedClosureCount += 1;
            else unresolvedFindingCount += 1;
            continue;
        }
        if (closureKind === 'comparison') {
            const visual = collectRenderLayoutOwnerVisualReviewCounts(toolCallLog, owner, layoutLogIndex);
            reviewedObservationCount += visual.reviewedCount;
            if (visual.allPassed
                && hasSameDocumentComparativeVisualReviewPass(toolCallLog, owner, layoutLogIndex)) {
                verifiedClosureCount += 1;
            } else {
                unresolvedFindingCount += 1;
            }
            continue;
        }

        const actionIndex = findExactFindingActionIndex({
            toolCallLog,
            afterIndex: layoutLogIndex,
            finding
        });
        if (actionIndex < 0) {
            unresolvedFindingCount += 1;
            continue;
        }
        repairActionCount += 1;
        if (closureKind === 'observation') {
            verifiedClosureCount += 1;
            continue;
        }
        const visual = collectRenderLayoutOwnerVisualReviewCounts(toolCallLog, owner, actionIndex);
        reviewedObservationCount += visual.reviewedCount;
        if (visual.allPassed) verifiedClosureCount += 1;
        else unresolvedFindingCount += 1;
    }

    if (findings.length === 0 && qualityState === 'needs_review') {
        const visual = collectRenderLayoutOwnerVisualReviewCounts(toolCallLog, owner, layoutLogIndex);
        reviewedObservationCount += visual.reviewedCount;
        if (!visual.allPassed) unresolvedFindingCount += 1;
    }

    const unresolved = qualityState === 'failed'
        || ((qualityState === 'needs_repair' || qualityState === 'needs_review') && unresolvedFindingCount > 0);

    return {
        qualityState,
        unresolved,
        findings,
        suggestedObservation: layoutResult.suggestedObservation,
        layoutLogIndex,
        repairActionCount,
        verifiedClosureCount,
        unresolvedFindingCount,
        reviewedObservationCount,
        criticClosureCount,
        ownerCount: 1,
        unresolvedOwnerCount: unresolved ? 1 : 0
    };
}

function collectLatestRenderLayoutQualityState(
    toolCallLog: AgentToolCallLogEntry[]
): RenderLayoutQualityState | undefined {
    const ownerStates = collectLatestRenderLayoutQualityOwners(toolCallLog)
        .map((owner) => collectRenderLayoutOwnerQualityState(toolCallLog, owner));
    if (ownerStates.length === 0) return undefined;

    const qualityRank: Record<RenderLayoutQualityState['qualityState'], number> = {
        passed: 0,
        needs_review: 1,
        needs_repair: 2,
        failed: 3
    };
    const qualityState = ownerStates.reduce((strongest, current) => (
        qualityRank[current.qualityState] > qualityRank[strongest]
            ? current.qualityState
            : strongest
    ), 'passed' as RenderLayoutQualityState['qualityState']);
    const unresolvedOwners = ownerStates.filter((state) => state.unresolved);
    const latestState = ownerStates.reduce((latest, current) => (
        current.layoutLogIndex > latest.layoutLogIndex ? current : latest
    ));
    const latestUnresolvedState = unresolvedOwners.length > 0
        ? unresolvedOwners.reduce((latest, current) => (
            current.layoutLogIndex > latest.layoutLogIndex ? current : latest
        ))
        : undefined;

    return {
        qualityState,
        unresolved: unresolvedOwners.length > 0,
        findings: ownerStates.flatMap((state) => state.findings),
        suggestedObservation: (latestUnresolvedState || latestState).suggestedObservation,
        layoutLogIndex: latestState.layoutLogIndex,
        repairActionCount: ownerStates.reduce((sum, state) => sum + state.repairActionCount, 0),
        verifiedClosureCount: ownerStates.reduce((sum, state) => sum + state.verifiedClosureCount, 0),
        unresolvedFindingCount: ownerStates.reduce((sum, state) => sum + state.unresolvedFindingCount, 0),
        reviewedObservationCount: ownerStates.reduce((sum, state) => sum + state.reviewedObservationCount, 0),
        criticClosureCount: ownerStates.reduce((sum, state) => sum + state.criticClosureCount, 0),
        ownerCount: ownerStates.length,
        unresolvedOwnerCount: unresolvedOwners.length
    };
}

function taskRequestsDelivery(input: ContractInput): boolean {
    const { task, skillId, intentMode } = resolveStableTaskIdentity(input);
    const text = `${task} ${skillId} ${intentMode}`;
    const plannedDeliverables = input.context?.agentTaskPlan?.designBrief.deliverables || [];
    const runtimeDeliveryOutputs = input.context?.agenticArtifactContract?.deliveryOutputs || [];
    const hasPlannedFileDelivery = plannedDeliverables.some((value) => (
        /(?:^|_)(?:exports?|export_file|delivery_file|saved_document|main_image_psd|editable_source_file)(?:$|_)/i
            .test(String(value || ''))
    ));
    return runtimeDeliveryOutputs.some(isRuntimeFileDeliveryOutput)
        || hasPlannedFileDelivery
        || /导出|保存|交付.{0,8}(?:文件|图片|源文件)|输出.*文件|生成.*文件|存到|保存到|导出到|export|save/i
            .test(text);
}

function taskRequestsRasterDelivery(input: ContractInput): boolean {
    const { task, skillId, intentMode } = resolveStableTaskIdentity(input);
    const text = `${task} ${skillId} ${intentMode}`.toLowerCase();
    const plannedDeliverables = input.context?.agentTaskPlan?.designBrief.deliverables || [];
    const runtimeDeliveryOutputs = input.context?.agenticArtifactContract?.deliveryOutputs || [];
    if (/(?:不需要|无需|不要|不导出|别导出).{0,10}(?:jpg|jpeg|png|webp|预览图)/
        .test(text)) {
        return false;
    }
    if (runtimeDeliveryOutputs.some(isRuntimeRasterDeliveryOutput)) return true;
    if (plannedDeliverables.some((value) => (
        /(?:^|_)(?:exports?|raster|png|jpe?g|webp)(?:$|_)/i.test(String(value || ''))
    ))) {
        return true;
    }
    if (/长图|图片|图像|jpg|jpeg|png|webp|预览图|上传|导出|输出|export/.test(text)) {
        return true;
    }
    if (/\b(?:psd|psb)\b|源文件|可编辑文件|工程文件/.test(text)) return false;
    return false;
}

function taskRequestsEditableDelivery(input: ContractInput): boolean {
    const { task, skillId, intentMode } = resolveStableTaskIdentity(input);
    const text = `${task} ${skillId} ${intentMode}`.toLowerCase();
    const plannedDeliverables = input.context?.agentTaskPlan?.designBrief.deliverables || [];
    const runtimeDeliveryOutputs = input.context?.agenticArtifactContract?.deliveryOutputs || [];
    if (/(?:不需要|无需|不要|不保存|别保存).{0,10}(?:psd|psb|源文件|源稿|可编辑文件|工程文件)/
        .test(text)) {
        return false;
    }
    if (runtimeDeliveryOutputs.some(isRuntimeEditableDeliveryOutput)) return true;
    if (plannedDeliverables.some((value) => (
        /(?:^|_)(?:psd|psb|saved_document|editable_source_file)(?:$|_)/i.test(String(value || ''))
    ))) {
        return true;
    }
    return /\b(?:psd|psb)\b|源文件|可编辑文件|工程文件|保存(?:当前)?文档|save\s+(?:document|psd|psb|source|editable)/
        .test(text);
}

export function isRuntimeEditableDeliveryOutput(value: unknown): boolean {
    const outputRef = String(value || '').trim().toLowerCase();
    if (!outputRef) return false;
    return /(?:^|_)(?:psd|psb)(?:$|_)/.test(outputRef)
        || /(?:^|_)editable(?:$|_)/.test(outputRef)
        || /(?:^|_)(?:saved|source)_document(?:$|_)/.test(outputRef);
}

export function isRuntimeRasterDeliveryOutput(value: unknown): boolean {
    const outputRef = String(value || '').trim().toLowerCase();
    if (!outputRef) return false;
    return /(?:^|_)(?:preview|raster|png|jpe?g|webp|slices?|images?)(?:$|_)/.test(outputRef);
}

function isRuntimeFileDeliveryOutput(value: unknown): boolean {
    return isRuntimeEditableDeliveryOutput(value) || isRuntimeRasterDeliveryOutput(value);
}

const CREATED_DOCUMENT_PAIRED_DELIVERY_BASIS = 'created_document_final_revision_pair' as const;
const CREATED_DOCUMENT_PAIRED_DELIVERY_OUTPUTS = [
    'editable_document',
    'raster_preview'
] as const;

interface CreatedDocumentPairedDeliveryProjection {
    basis: typeof CREATED_DOCUMENT_PAIRED_DELIVERY_BASIS;
    documentId: number;
    sourceHistoryStateRef: PhotoshopHistoryStateRef;
    rasterDeliveryCount: number;
    editableDeliveryCount: number;
}

function explicitlyRequestsSingleFormatDelivery(input: ContractInput): boolean {
    const workMode = String(
        input.context?.agenticArtifactContract?.workMode
        || input.context?.agentTaskPlan?.designBrief.workMode
        || ''
    ).trim();
    if (workMode === 'export_only') return true;
    const { task } = resolveStableTaskIdentity(input);
    const text = String(task || '').toLowerCase();
    const rasterOnly = /(?:只|仅).{0,10}(?:jpg|jpeg|png|webp)/i.test(text)
        || /(?:不需要|无需|不要|不导出|别导出).{0,10}(?:jpg|jpeg|png|webp|预览图)/i.test(text);
    const editableOnly = /(?:只|仅).{0,10}(?:psd|psb|源文件|源稿|可编辑文件|工程文件)/i.test(text)
        || /(?:不需要|无需|不要|不保存|别保存).{0,10}(?:psd|psb|源文件|源稿|可编辑文件|工程文件)/i
            .test(text);
    return rasterOnly || editableOnly;
}

/**
 * 新建文档的结算格式只来自当前 Task / Manifest 的既有交付 owner。
 * 未绑定开放创意沿用 D-112 的源稿 + 预览默认；用户明确单格式时保持原范围。
 */
export function resolveTaskRunCreatedDocumentDeliveryRequirement(input: {
    task: string;
    context?: TaskCompletionContext;
}): TaskRunCreatedDocumentDeliveryRequirement {
    const contractInput: ContractInput = {
        task: input.task,
        context: input.context,
        toolCallLog: []
    };
    const explicitSingleFormat = explicitlyRequestsSingleFormatDelivery(contractInput);
    if (!input.context?.agenticArtifactContract && !explicitSingleFormat) {
        return { rasterRequired: true, editableRequired: true };
    }
    const rasterRequired = taskRequestsRasterDelivery(contractInput);
    const editableRequired = taskRequestsEditableDelivery(contractInput);
    if (!rasterRequired && !editableRequired) {
        return { rasterRequired: true, editableRequired: true };
    }
    return { rasterRequired, editableRequired };
}

export function buildTaskRunCreatedDocumentPreflightInput(
    task: string,
    context: TaskCompletionContext,
    toolCallLog: AgentToolCallLogEntry[]
): {
    completedToolCalls: AgentToolCallLogEntry[];
    taskRunCreatedDocumentLifecycle: {
        taskRunId?: string;
        generation?: number;
        previous?: TaskRunDocumentCreationEvidence;
        deliveryRequirement: TaskRunCreatedDocumentDeliveryRequirement;
        toolCallLog: AgentToolCallLogEntry[];
    };
} {
    const chain = context.taskRunDocumentCreation;
    return {
        completedToolCalls: toolCallLog,
        taskRunCreatedDocumentLifecycle: {
            previous: chain?.evidence,
            taskRunId: chain?.taskRunId,
            generation: chain?.generation,
            toolCallLog: buildAgentOperationLedger(toolCallLog) as unknown as AgentToolCallLogEntry[],
            deliveryRequirement: resolveTaskRunCreatedDocumentDeliveryRequirement({ task, context })
        }
    };
}

function buildTaskRunCreatedDocumentLifecycleRequirement(
    input: ContractInput,
    log: AgentToolCallLogEntry[],
    id: string
): TaskCompletionRequirement | undefined {
    const chain = input.context?.taskRunDocumentCreation;
    const deliveryRequirement = resolveTaskRunCreatedDocumentDeliveryRequirement({
        task: input.task,
        context: input.context
    });
    const lifecycle = projectTaskRunCreatedDocumentLifecycle({
        previous: chain?.evidence,
        taskRunId: chain?.taskRunId,
        generation: chain?.generation,
        toolCallLog: log,
        deliveryRequirement
    });
    if (lifecycle.createdDocumentCount === 0) return undefined;
    const status: TaskCompletionRequirement['status'] = lifecycle.unsettledDocumentCount === 0
        ? 'passed'
        : 'failed';
    return {
        id,
        label: '结算本 TaskRun 创建的全部文档',
        status,
        expected: {
            everyCreatedDocumentSettled: true,
            rasterRequired: deliveryRequirement.rasterRequired,
            editableRequired: deliveryRequirement.editableRequired
        },
        actual: {
            createdDocumentCount: lifecycle.createdDocumentCount,
            settledDocumentCount: lifecycle.settledDocumentCount,
            deliveredDocumentCount: lifecycle.deliveredDocumentCount,
            closedDocumentCount: lifecycle.closedDocumentCount,
            unsettledDocumentCount: lifecycle.unsettledDocumentCount,
            unsettledDocumentIds: lifecycle.unsettledDocumentIds,
            documents: lifecycle.documents
        },
        reason: status === 'passed'
            ? undefined
            : `本 TaskRun 新建的 Photoshop 文档 ${lifecycle.unsettledDocumentIds.join(', ')} 尚未按当前交付范围取得最新 revision 文件收据，也没有由 Agent 通过精确 documentId 显式关闭。请在当前文档继续修订、完成交付，或在需要放弃候选时请求关闭确认；不能留下未结算文档后直接完成。`,
        ...qualifiedCompletionFailure(status, 'required_artifact_missing', id)
    };
}

function collectCurrentTaskRunCreatedDocumentIds(
    log: AgentToolCallLogEntry[]
): Set<number> {
    const documentIds = new Set<number>();
    for (const entry of log) {
        if (!completionOperationSucceeded(entry)) continue;
        const commit = readPhotoshopMutationCommit(entry.result);
        if (commit?.changeKind !== 'document_creation'
            || !Number.isSafeInteger(commit.createdDocumentId)
            || Number(commit.createdDocumentId) <= 0) {
            continue;
        }
        documentIds.add(Number(commit.createdDocumentId));
    }
    return documentIds;
}

function projectCreatedDocumentPairedDelivery(
    input: ContractInput,
    log: AgentToolCallLogEntry[]
): CreatedDocumentPairedDeliveryProjection | undefined {
    if (input.context?.agenticArtifactContract || explicitlyRequestsSingleFormatDelivery(input)) {
        return undefined;
    }
    const createdDocumentIds = collectCurrentTaskRunCreatedDocumentIds(log);
    if (createdDocumentIds.size === 0) return undefined;
    const latestMutationIndex = findLatestVerifiedPhotoshopMutationIndex(log);
    const finalMutationProof = readCompletionMutationProof(log[latestMutationIndex]);
    const sourceHistoryStateRef = finalMutationProof?.after;
    if (!sourceHistoryStateRef || !createdDocumentIds.has(sourceHistoryStateRef.documentId)) {
        return undefined;
    }
    const sameFinalRevision = (entry: AgentToolCallLogEntry): boolean => (
        samePhotoshopHistoryStateRef(
            readPhotoshopSourceHistoryStateRef(entry.result),
            sourceHistoryStateRef
        )
    );
    return {
        basis: CREATED_DOCUMENT_PAIRED_DELIVERY_BASIS,
        documentId: sourceHistoryStateRef.documentId,
        sourceHistoryStateRef,
        rasterDeliveryCount: log.filter((entry) => (
            isRasterDeliveryEntry(entry) && sameFinalRevision(entry)
        )).length,
        editableDeliveryCount: log.filter((entry) => (
            isEditableDeliveryEntry(entry) && sameFinalRevision(entry)
        )).length
    };
}

export function readTaskCompletionRequiredDeliveryOutputs(
    contract: Pick<TaskCompletionContract, 'required'> | undefined
): string[] {
    const pairedRequirement = contract?.required.find((requirement) => {
        const actual = requirement.actual;
        return Boolean(actual)
            && typeof actual === 'object'
            && !Array.isArray(actual)
            && (actual as Record<string, unknown>).deliveryBasis
                === CREATED_DOCUMENT_PAIRED_DELIVERY_BASIS;
    });
    return pairedRequirement
        ? [...CREATED_DOCUMENT_PAIRED_DELIVERY_OUTPUTS]
        : [];
}

function buildDeclaredDeliveryRequirement(
    input: ContractInput,
    log: AgentToolCallLogEntry[],
    id: string,
    options: { pairCreatedCreativeDocument?: boolean } = {}
): TaskCompletionRequirement | undefined {
    const pairedDelivery = options.pairCreatedCreativeDocument
        ? projectCreatedDocumentPairedDelivery(input, log)
        : undefined;
    if (!taskRequestsDelivery(input) && !pairedDelivery) return undefined;
    const rasterRequired = Boolean(pairedDelivery) || taskRequestsRasterDelivery(input);
    const editableRequired = Boolean(pairedDelivery) || taskRequestsEditableDelivery(input);
    const rasterDeliveryCount = pairedDelivery?.rasterDeliveryCount ?? countRasterDelivery(log);
    const editableDeliveryCount = pairedDelivery?.editableDeliveryCount ?? countEditableDelivery(log);
    const deliveryPassed = (!rasterRequired || rasterDeliveryCount > 0)
        && (!editableRequired || editableDeliveryCount > 0)
        && (rasterRequired || editableRequired
            ? true
            : rasterDeliveryCount + editableDeliveryCount > 0);
    const status: TaskCompletionRequirement['status'] = deliveryPassed ? 'passed' : 'failed';
    let reason: string | undefined;
    if (!deliveryPassed && pairedDelivery) {
        reason = '本轮新建设计文档需要交付同一最终版本的可编辑源稿与预览图片，但当前没有同时取得该 document/history 的 PSD/PSB 保存和 JPG/PNG/WebP 导出收据。';
    } else if (!deliveryPassed && rasterRequired && editableRequired) {
        reason = '交付要求包含可编辑文档和预览图片，但当前没有同时取得成功的文档保存与图片导出收据。';
    } else if (!deliveryPassed && rasterRequired) {
        reason = '交付要求包含预览图片，但没有检测到成功的 JPG、PNG 或 WebP 导出收据。';
    } else if (!deliveryPassed && editableRequired) {
        reason = '交付要求包含可编辑文档，但没有检测到成功的 PSD 或 PSB 保存收据。';
    } else if (!deliveryPassed) {
        reason = '当前任务要求交付文件，但没有检测到成功的保存或导出收据。';
    }
    return {
        id,
        label: pairedDelivery
            ? '保存新建设计的可编辑源稿与预览图片'
            : (rasterRequired && editableRequired
                ? '保存可编辑文档与预览图片'
                : (rasterRequired ? '导出预览图片' : '保存可编辑文档')),
        status,
        expected: {
            rasterRequired,
            editableRequired,
            deliveryOutputs: input.context?.agenticArtifactContract?.deliveryOutputs || []
        },
        actual: {
            rasterDeliveryCount,
            editableDeliveryCount,
            ...(pairedDelivery ? {
                deliveryBasis: pairedDelivery.basis,
                documentId: pairedDelivery.documentId,
                sourceHistoryStateRef: pairedDelivery.sourceHistoryStateRef
            } : {})
        },
        reason,
        ...qualifiedCompletionFailure(status, 'required_artifact_missing', id)
    };
}

function collectDeliveryFormats(entry: AgentToolCallLogEntry): string[] {
    const result = entry.result || {};
    const values = [
        entry.arguments?.format,
        result.format,
        result.outputFormat,
        result.saveFormat
    ];
    const paths = [
        entry.arguments?.outputPath,
        entry.arguments?.savePath,
        result.outputPath,
        result.savePath,
        result.filePath,
        result.savedPath,
        ...(Array.isArray(result.exportedFiles) ? result.exportedFiles : [])
    ];
    for (const pathValue of paths) {
        const match = String(pathValue || '').match(/\.([a-z0-9]+)(?:$|[?#])/i);
        if (match?.[1]) values.push(match[1]);
    }
    return values.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
}

function isRasterDeliveryEntry(entry: AgentToolCallLogEntry): boolean {
    if (!DOCUMENT_SAVE_TOOLS.has(entry.name) || !toolSucceeded(entry)) return false;
    if (entry.name === 'quickExport' || entry.name === 'exportDetailPageSlices') return true;
    const formats = collectDeliveryFormats(entry);
    return formats.some((format) => /^(?:jpg|jpeg|png|webp|gif|tif|tiff)$/.test(format));
}

function countRasterDelivery(toolCallLog: AgentToolCallLogEntry[]): number {
    return toolCallLog.filter(isRasterDeliveryEntry).length;
}

function isEditableDeliveryEntry(entry: AgentToolCallLogEntry): boolean {
    if (!DOCUMENT_SAVE_TOOLS.has(entry.name) || !toolSucceeded(entry)) return false;
    const resultRecords = [entry.result, entry.result?.data]
        .filter((value): value is Record<string, unknown> => (
            Boolean(value) && typeof value === 'object' && !Array.isArray(value)
        ));
    if (resultRecords.some(hasVerifiedEditableDocumentArtifact)) return true;

    // 工具名、输入 format 或“success=true”都不能证明真实产生了可编辑源文件。
    // 这里只接受工具返回结果中的 PSD/PSB 路径；路径扩展名同时证明了格式与保存目标。
    return resultRecords.some((record) => {
        const returnedPaths = [
            record.savedPath,
            record.filePath,
            record.outputPath
        ];
        return returnedPaths.some((value) => /\.(?:psd|psb)(?:$|[?#])/i.test(String(value || '').trim()));
    });
}

function countEditableDelivery(toolCallLog: AgentToolCallLogEntry[]): number {
    return toolCallLog.filter(isEditableDeliveryEntry).length;
}

function normalizeCoverage(value: any): CoverageVerification | null {
    if (!value || typeof value !== 'object') return null;
    const expected = Number(value.expected);
    const applied = Number(value.applied ?? value.successCount ?? value.matched);
    const failed = Number(value.failed ?? value.failCount ?? 0);
    const skipped = Number(value.skipped ?? 0);
    if (!Number.isFinite(expected) || !Number.isFinite(applied)) return null;
    return {
        expected,
        applied,
        failed: Number.isFinite(failed) ? failed : 0,
        skipped: Number.isFinite(skipped) ? skipped : 0,
        missingIds: Array.isArray(value.missingIds) ? value.missingIds.map(String) : undefined
    };
}

function readCompletionVerification(result: any): any {
    return result?.completionContract?.verification
        || result?.data?.completionContract?.verification;
}

function findCoverageVerification(toolCallLog: AgentToolCallLogEntry[]): CoverageVerification | undefined {
    for (const item of toolCallLog) {
        const result = item.result || {};
        const candidates = [
            readCompletionVerification(result)?.coverage,
            result?.data?.coverage,
            result?.coverage
        ];
        for (const candidate of candidates) {
            const coverage = normalizeCoverage(candidate);
            if (coverage) return coverage;
        }
    }
    return undefined;
}

function readNestedSkillToolResults(result: any): Array<{ toolName: string; result: any }> {
    const values = Array.isArray(result?.toolResults)
        ? result.toolResults
        : Array.isArray(result?.data?.toolResults)
            ? result.data.toolResults
            : [];
    return values
        .filter((item: any) => item && typeof item === 'object')
        .map((item: any) => ({
            toolName: String(item.toolName || item.name || ''),
            result: item.result
        }));
}

function isLayerOrganizationSkillEntry(entry: AgentToolCallLogEntry): boolean {
    if (entry.name !== 'layer-management') return false;
    const action = String(entry.arguments?.action || '').trim().toLowerCase();
    const mode = String(entry.arguments?.mode || '').trim().toLowerCase();
    return action === 'organize' || mode === 'organize';
}

function readLayerOrganizationSourceStatus(toolCallLog: AgentToolCallLogEntry[]): string {
    for (let index = toolCallLog.length - 1; index >= 0; index -= 1) {
        const entry = toolCallLog[index];
        if (!entry || !isLayerOrganizationSkillEntry(entry)) continue;
        const candidates = [
            entry.result?.skillOutcome?.sourceStatus,
            entry.result?.data?.sourceStatus,
            entry.result?.sourceStatus
        ];
        const sourceStatus = candidates
            .map((value) => String(value || '').trim())
            .find(Boolean);
        if (sourceStatus) return sourceStatus;
    }
    return '';
}

function readLayerOrganizationVisualEquivalenceReceipt(
    toolCallLog: AgentToolCallLogEntry[]
): LayerOrganizationVisualEquivalenceReceipt | undefined {
    for (let index = toolCallLog.length - 1; index >= 0; index -= 1) {
        const entry = toolCallLog[index];
        if (!entry || !isLayerOrganizationSkillEntry(entry)) continue;
        const candidates = [
            entry.result?.data?.visualEquivalenceReceipt,
            entry.result?.visualEquivalenceReceipt
        ];
        const receipt = candidates.find(isLayerOrganizationVisualEquivalenceReceipt);
        if (receipt) return receipt;
    }
    return undefined;
}

function findHistoryBoundHierarchy(
    toolCallLog: AgentToolCallLogEntry[],
    predicate: (index: number) => boolean,
    expectedHistoryStateRef?: PhotoshopHistoryStateRef
): PhotoshopHistoryStateRef | undefined {
    for (let index = toolCallLog.length - 1; index >= 0; index -= 1) {
        const entry = toolCallLog[index];
        if (!entry
            || !predicate(index)
            || entry.name !== 'getLayerHierarchy'
            || !toolSucceeded(entry)) {
            continue;
        }
        const historyStateRef = readPhotoshopHistoryStateRef(entry.result);
        if (!historyStateRef) continue;
        if (!expectedHistoryStateRef
            || samePhotoshopHistoryStateRef(historyStateRef, expectedHistoryStateRef)) {
            return historyStateRef;
        }
    }
    return undefined;
}

function findMutationCommitAt(
    toolCallLog: AgentToolCallLogEntry[],
    index: number
): ReturnType<typeof readPhotoshopMutationCommit> {
    if (index < 0) return undefined;
    const entry = toolCallLog[index];
    if (!entry || !toolSucceeded(entry)) return undefined;
    return readPhotoshopMutationCommit(entry.result);
}

function hasVisualReviewBoundToHistory(
    toolCallLog: AgentToolCallLogEntry[],
    expectedHistoryStateRef: PhotoshopHistoryStateRef | undefined
): boolean {
    if (!expectedHistoryStateRef) return false;
    const timeline = buildAgentOperationDocumentTimeline(toolCallLog);
    return toolCallLog.some((entry, index) => {
        if (!toolSucceeded(entry) && !isSuccessfulWorkflowEnvelope(entry)) return false;
        const receipt = readEntryVisualObservationReceipt(entry);
        if (!receipt
            || receipt.document !== String(expectedHistoryStateRef.documentId)
            || receipt.history !== String(expectedHistoryStateRef.historyStateId)) {
            return false;
        }

        const bundles = readVisualObservationBundles(entry.result, entry.name);
        if (bundles.length > 0) {
            return hasVersionBoundVisualObservationBundle(entry, timeline.entries[index]);
        }
        if (!LAYER_ORGANIZATION_VISUAL_VERIFICATION_TOOLS.has(entry.name)) return false;
        const observations = readAgentVisualObservations(entry.result);
        return observations.length > 0
            && observations.every((observation) => (
                observation.reviewed === true
                && observation.reviewDecision?.status === 'passed'
                && observation.observationIdentity?.document === receipt.document
                && observation.observationIdentity?.history === receipt.history
            ));
    });
}

function isRealCompositeCopy(value: unknown): boolean {
    const text = String(value || '').trim();
    if (!text) return false;
    return !/^\[(?:文案|文字)(?:占位)?\]/.test(text);
}

function isVisibleCreativeText(value: unknown): boolean {
    return Boolean(String(value || '').trim());
}

function collectLayoutReplicationCompositeResult(
    toolCallLog: AgentToolCallLogEntry[]
): LayoutReplicationCompositeResult {
    const compositeResult: LayoutReplicationCompositeResult = {
        createdDocumentCount: 0,
        actionCount: 0,
        failedActions: 0,
        subjectCount: 0,
        shapeCount: 0,
        copyCount: 0,
        visibleCopyCount: 0
    };

    for (const item of toolCallLog) {
        if (item.name !== 'layout-replication') continue;
        if (!readCompletionMutationProof(item)) continue;
        const result = item.result || {};
        const nestedToolResults = readNestedSkillToolResults(result);
        const createDocumentResult = nestedToolResults.find((nested) => nested.toolName === 'createDocument')?.result;
        if (result?.data?.createdDocument === true || createDocumentResult?.success === true) {
            compositeResult.createdDocumentCount += 1;
        }

        const applyResult = result?.data?.applyResult
            || nestedToolResults.find((nested) => nested.toolName === 'layout-template-apply')?.result;
        const generatedScreens = Array.isArray(applyResult?.generatedScreens)
            ? applyResult.generatedScreens
            : [];
        const copyPlaceholders = generatedScreens.flatMap((screen: any) =>
            Array.isArray(screen?.copyPlaceholders) ? screen.copyPlaceholders : []);
        const imagePlaceholders = generatedScreens.flatMap((screen: any) =>
            Array.isArray(screen?.imagePlaceholders) ? screen.imagePlaceholders : []);
        compositeResult.copyCount += copyPlaceholders.filter((placeholder: any) =>
            isRealCompositeCopy(placeholder?.currentText)).length;
        compositeResult.visibleCopyCount += copyPlaceholders.filter((placeholder: any) =>
            isVisibleCreativeText(placeholder?.currentText)).length;
        compositeResult.shapeCount += imagePlaceholders.length;

        const autoFillResult = result?.data?.autoFillResult
            || nestedToolResults.find((nested) => nested.toolName === 'layout-template-autofill')?.result;
        compositeResult.subjectCount += Math.max(0, Number(autoFillResult?.filledImages || 0));

        const elementResults = Array.isArray(applyResult?.elementResults)
            ? applyResult.elementResults
            : [];
        const appliedElements = elementResults.filter((element: any) => element?.status === 'applied').length;
        const failedElements = elementResults.filter((element: any) => element?.status === 'failed').length;
        const nestedMatchResult = nestedToolResults.find((nested) => nested.toolName === 'layout-replication')?.result;
        const coverage = findCoverageVerification([item]);
        compositeResult.actionCount += Math.max(
            appliedElements,
            Math.max(0, Number(coverage?.applied || 0)),
            Math.max(0, Number(nestedMatchResult?.successCount || 0)),
            Math.max(0, Number(applyResult?.createdLayers || 0))
        );
        compositeResult.failedActions += Math.max(
            failedElements,
            Math.max(0, Number(coverage?.failed || 0)),
            Math.max(0, Number(nestedMatchResult?.failCount || 0)),
            Math.max(0, Number(applyResult?.failedOps || 0))
        );
    }

    return compositeResult;
}

function hasLayoutReplicationCompositeMutation(entry: AgentToolCallLogEntry): boolean {
    return collectLayoutReplicationCompositeResult([entry]).actionCount > 0;
}

function getVisualVerification(toolCallLog: AgentToolCallLogEntry[], latestMutationIndex: number): VisualVerification {
    const timeline = buildAgentOperationDocumentTimeline(toolCallLog);
    const mutationContext = timeline.entries[latestMutationIndex];
    const afterMutation = toolCallLog.filter((item, index) => index > latestMutationIndex
        && toolSucceeded(item)
        && sameAgentOperationDocumentContext(mutationContext, timeline.entries[index]));
    const overlayCount = afterMutation.filter((item) => item.name === 'getScreenSnapshotsWithOverlay').length;
    const visualReview = collectVisualReviewCounts(toolCallLog, DESIGN_REVIEW_TOOLS, latestMutationIndex);
    const screenshotCount = visualReview.capturedCount;
    const modelReviewCount = afterMutation.filter((item) => item.name === 'auditDetailPagePlacement').length;
    const boundsCount = afterMutation.filter((item) => item.name === 'getLayerBounds' || item.name === 'getLayerProperties').length;

    if (modelReviewCount > 0) {
        return {
            mode: 'model_review',
            snapshotCount: screenshotCount,
            overlayCount,
            reviewedCount: visualReview.reviewedCount,
            unreviewedCount: visualReview.unreviewedCount
        };
    }
    if (visualReview.allPassed && overlayCount > 0) {
        return {
            mode: 'overlay',
            snapshotCount: screenshotCount,
            overlayCount,
            reviewedCount: visualReview.reviewedCount,
            unreviewedCount: visualReview.unreviewedCount
        };
    }
    if (visualReview.allPassed) {
        return {
            mode: 'screenshot',
            snapshotCount: screenshotCount,
            overlayCount,
            reviewedCount: visualReview.reviewedCount,
            unreviewedCount: visualReview.unreviewedCount
        };
    }
    if (screenshotCount > 0) {
        return {
            mode: 'captured_only',
            snapshotCount: screenshotCount,
            overlayCount,
            reviewedCount: 0,
            unreviewedCount: visualReview.unreviewedCount
        };
    }
    if (boundsCount > 0) {
        return { mode: 'bounds_only', snapshotCount: 0, overlayCount: 0 };
    }
    return { mode: 'none', snapshotCount: 0, overlayCount: 0 };
}

function resolveStatus(requirements: TaskCompletionRequirement[], blockers: string[]): AgentExecutionStatus {
    if (blockers.length > 0 || requirements.some((item) => item.status === 'failed')) {
        return 'failed';
    }
    // warning 是诊断和改进建议，不是第二套隐藏完成门禁。真正会影响终态的未知项
    // 必须以结构化 requirement=needs_review 表达，不能只靠自由文本 warning 降级。
    if (requirements.some((item) => item.status === 'needs_review')) {
        return 'needs_review';
    }
    return 'completed';
}

function buildSummary(kind: TaskCompletionKind, status: AgentExecutionStatus, requirements: TaskCompletionRequirement[]): string {
    const kindText: Record<TaskCompletionKind, string> = {
        skill_evaluation_profile: '当前设计能力',
        reference_replication: '参考图复刻',
        creative_design: '创意设计',
        text_content_edit: '文字内容编辑',
        text_typography_edit: '文字排版/字体编辑',
        layer_order_edit: '图层顺序编辑',
        layer_management: '图层管理',
        document_save: '文档保存/导出',
        document_close: '文档关闭'
    };
    const statusText: Record<AgentExecutionStatus, string> = {
        completed: '已完成',
        needs_review: '需复核',
        failed: '未完成',
        cancelled: '已取消',
        // 任务完成契约本身不会产出该状态（等待确认属于运行级暂停），此处仅为满足类型穷举。
        awaiting_confirmation: '等待确认'
    };
    const passed = requirements.filter((item) => item.status === 'passed').length;
    return `${kindText[kind]}完成契约：${statusText[status]}，${passed}/${requirements.length} 项通过。`;
}

function buildOperationContract(
    kind: 'layer_management' | 'document_save' | 'document_close',
    input: ContractInput,
    acceptance: AcceptanceCounts,
    mutationTools: Set<string>,
    verificationTools: Set<string>,
    labels: { context: string; mutation: string; verification: string }
): TaskCompletionContract {
    const operationToolCallLog = input.toolCallLog;
    const firstMutation = firstSuccessfulIndex(operationToolCallLog, mutationTools);
    const lastSuccessfulMutation = lastSuccessfulIndex(operationToolCallLog, mutationTools);
    const lastMutation = Math.max(
        lastSuccessfulMutation,
        findLatestVerifiedPhotoshopMutationIndex(operationToolCallLog)
    );
    const actionCount = countSuccessful(operationToolCallLog, mutationTools);
    const failedActions = countBlockingOperationFailures(operationToolCallLog, mutationTools);
    let inspectedBeforeMutation = firstMutation >= 0
        && hasSuccessfulBefore(operationToolCallLog, INSPECTION_TOOLS, firstMutation);
    let verifiedAfterMutation = lastMutation >= 0 && (
        hasSuccessfulAfter(operationToolCallLog, verificationTools, lastMutation)
        || hasVerifiedAcceptanceAtOrAfter(operationToolCallLog, lastMutation)
    );
    const { task, intentMode } = resolveStableTaskIdentity(input);
    const hasSemanticOrganizationMutation = operationToolCallLog.some((entry) => (
        completionOperationSucceeded(entry)
        && LAYER_SEMANTIC_ORGANIZATION_MUTATION_TOOLS.has(entry.name)
    ));
    const requiresOrganizationVisualReadback = kind === 'layer_management'
        && (
            input.toolCallLog.some(isLayerOrganizationSkillEntry)
            || (
                /整理|归组|organize/i.test(`${task} ${intentMode}`)
                && hasSemanticOrganizationMutation
            )
        );
    let organizationVisualReview: ReturnType<typeof collectVisualReviewCounts> | undefined;
    let organizationVisualVersionBound = false;
    let organizationVisualEquivalenceReceipt:
        LayerOrganizationVisualEquivalenceReceipt | undefined;
    let organizationVisualEquivalenceProven = false;
    let idempotentOrganizationStructureVerified = false;
    let organizationStructureVerified = false;
    let expectedOrganizationHistoryStateRef: PhotoshopHistoryStateRef | undefined;
    if (requiresOrganizationVisualReadback) {
        const idempotentOrganizationDeclared = readLayerOrganizationSourceStatus(input.toolCallLog)
            === 'already_organized_verified';
        const firstCommit = findMutationCommitAt(operationToolCallLog, firstMutation);
        const lastCommit = findMutationCommitAt(operationToolCallLog, lastSuccessfulMutation);
        const preHierarchyHistoryStateRef = firstCommit?.before
            ? findHistoryBoundHierarchy(
                operationToolCallLog,
                (index) => index < firstMutation,
                firstCommit.before
            )
            : undefined;
        const postHierarchyHistoryStateRef = lastCommit?.after
            ? findHistoryBoundHierarchy(
                operationToolCallLog,
                (index) => index > lastSuccessfulMutation,
                lastCommit.after
            )
            : undefined;
        organizationStructureVerified = Boolean(
            actionCount > 0
            && firstCommit?.before
            && lastCommit?.after
            && preHierarchyHistoryStateRef
            && postHierarchyHistoryStateRef
        );

        if (actionCount === 0 && idempotentOrganizationDeclared) {
            const hierarchyReads = operationToolCallLog
                .map((entry) => (
                    entry.name === 'getLayerHierarchy' && toolSucceeded(entry)
                        ? readPhotoshopHistoryStateRef(entry.result)
                        : undefined
                ))
                .filter((historyStateRef): historyStateRef is PhotoshopHistoryStateRef => (
                    Boolean(historyStateRef)
                ));
            const firstHierarchy = hierarchyReads[0];
            const finalHierarchy = hierarchyReads[hierarchyReads.length - 1];
            idempotentOrganizationStructureVerified = hierarchyReads.length >= 2
                && samePhotoshopHistoryStateRef(firstHierarchy, finalHierarchy);
            if (idempotentOrganizationStructureVerified) {
                inspectedBeforeMutation = true;
                organizationStructureVerified = true;
                expectedOrganizationHistoryStateRef = finalHierarchy;
            }
        } else {
            inspectedBeforeMutation = Boolean(preHierarchyHistoryStateRef);
            expectedOrganizationHistoryStateRef = lastCommit?.after;
        }

        organizationVisualEquivalenceReceipt =
            readLayerOrganizationVisualEquivalenceReceipt(input.toolCallLog);
        if (isLayerOrganizationVisualEquivalenceProven(
            organizationVisualEquivalenceReceipt
        )) {
            const expectedBeforeHistoryStateRef = actionCount > 0
                ? firstCommit?.before
                : expectedOrganizationHistoryStateRef;
            organizationVisualEquivalenceProven = samePhotoshopHistoryStateRef(
                organizationVisualEquivalenceReceipt.beforeHistoryStateRef,
                expectedBeforeHistoryStateRef
            ) && samePhotoshopHistoryStateRef(
                organizationVisualEquivalenceReceipt.afterHistoryStateRef,
                expectedOrganizationHistoryStateRef
            );
        }

        const topLevelMutationIndex = findLatestVerifiedPhotoshopMutationIndex(input.toolCallLog);
        organizationVisualReview = collectVisualReviewCounts(
            input.toolCallLog,
            LAYER_ORGANIZATION_VISUAL_VERIFICATION_TOOLS,
            topLevelMutationIndex
        );
        organizationVisualVersionBound = hasVisualReviewBoundToHistory(
            input.toolCallLog,
            expectedOrganizationHistoryStateRef
        );
        verifiedAfterMutation = organizationStructureVerified
            && organizationVisualEquivalenceProven
            && organizationVisualReview.allPassed
            && organizationVisualVersionBound;
    }
    const idempotentMutationSatisfied = requiresOrganizationVisualReadback
        && actionCount === 0
        && idempotentOrganizationStructureVerified;
    const mutationSatisfied = actionCount > 0 || idempotentMutationSatisfied;
    let verificationReason: string | undefined;
    if (requiresOrganizationVisualReadback) {
        if (!organizationStructureVerified) {
            verificationReason = '缺少与写入提交版本一致的操作前/后图层层级读回。';
        } else if (!organizationVisualEquivalenceProven) {
            verificationReason = organizationVisualEquivalenceReceipt?.status === 'changed'
                ? '整理前后原始画布像素不一致，不能把结构调整声明为安全完成。'
                : '缺少与本轮写入前后版本绑定的原始画布等价证明。';
        } else if (organizationVisualReview && !organizationVisualReview.allPassed) {
            verificationReason = buildCreativeVisualReviewReason(organizationVisualReview);
        } else if (!organizationVisualVersionBound) {
            verificationReason = '视觉复核未绑定到最终 Photoshop 文档与历史版本。';
        }
    } else if (!verifiedAfterMutation) {
        verificationReason = '缺少操作后的状态复核或工具验收结果。';
    }

    const requirements: TaskCompletionRequirement[] = [
        {
            id: 'operation-context-read',
            label: labels.context,
            status: inspectedBeforeMutation || kind === 'document_close' ? 'passed' : 'needs_review',
            reason: inspectedBeforeMutation || kind === 'document_close' ? undefined : '缺少操作前上下文读取结果。'
        },
        {
            id: 'operation-mutated',
            label: labels.mutation,
            status: mutationSatisfied ? 'passed' : 'failed',
            actual: {
                actionCount,
                failedActions,
                ...(idempotentMutationSatisfied ? { idempotent: true } : {})
            },
            reason: mutationSatisfied
                ? undefined
                : '没有检测到成功的目标工具调用，也没有取得可验证的已整理幂等结果。'
        },
        {
            id: 'operation-verified',
            label: labels.verification,
            status: verifiedAfterMutation ? 'passed' : 'needs_review',
            ...(requiresOrganizationVisualReadback && organizationVisualReview ? {
                actual: {
                    structureVerified: organizationStructureVerified,
                    visualReview: {
                        expectedCount: organizationVisualReview.expectedCount,
                        capturedCount: organizationVisualReview.capturedCount,
                        reviewedCount: organizationVisualReview.reviewedCount,
                        passedCount: organizationVisualReview.passedCount,
                        needsFixCount: organizationVisualReview.needsFixCount,
                        unreadableCount: organizationVisualReview.unreadableCount,
                        overflowCount: organizationVisualReview.overflowCount
                    },
                    visualEquivalence: {
                        status: organizationVisualEquivalenceReceipt?.status || 'missing',
                        proven: organizationVisualEquivalenceProven,
                        expectedRegionCount:
                            organizationVisualEquivalenceReceipt?.expectedRegionCount || 0,
                        comparedRegionCount:
                            organizationVisualEquivalenceReceipt?.comparedRegionCount || 0
                    },
                    versionBound: organizationVisualVersionBound,
                    expectedHistoryStateRef: expectedOrganizationHistoryStateRef
                }
            } : {}),
            reason: verifiedAfterMutation ? undefined : verificationReason
        }
    ];

    const blockers: string[] = [];
    const warnings: string[] = [];
    if (failedActions > 0) {
        blockers.push(`存在 ${failedActions} 个目标工具失败。`);
    }
    if (acceptance.failed > 0) {
        blockers.push(`存在 ${acceptance.failed} 个工具验收失败。`);
    }
    if (!inspectedBeforeMutation && kind !== 'document_close') {
        warnings.push('缺少修改前上下文读取，无法确认目标是否正确。');
    }
    if (!verifiedAfterMutation) {
        warnings.push('缺少修改后复核，不能只凭模型口头结论判定完成。');
    }
    if (acceptance.needsReview > 0 || acceptance.noDocumentChangeRisk > 0) {
        warnings.push(`工具验收仍有 ${acceptance.needsReview} 项需要复核，${acceptance.noDocumentChangeRisk} 项存在无变化风险。`);
    }

    let organizationVisualMode: 'none' | 'captured_only' | 'screenshot' = 'none';
    if (verifiedAfterMutation) {
        organizationVisualMode = 'screenshot';
    } else if ((organizationVisualReview?.capturedCount || 0) > 0) {
        organizationVisualMode = 'captured_only';
    }
    const status = resolveStatus(requirements, blockers);
    return {
        kind,
        status,
        required: requirements,
        verification: {
            toolAcceptance: acceptance,
            ...(requiresOrganizationVisualReadback && organizationVisualReview ? {
                visual: {
                    mode: organizationVisualMode,
                    snapshotCount: organizationVisualReview.capturedCount,
                    reviewedCount: organizationVisualReview.reviewedCount,
                    unreviewedCount: organizationVisualReview.unreviewedCount,
                    blockers: [
                        ...(organizationVisualReview.needsFixCount > 0
                            ? [`${organizationVisualReview.needsFixCount} 张整理后画面明确需要修订。`]
                            : []),
                        ...(organizationVisualReview.unreadableCount > 0
                            ? [`${organizationVisualReview.unreadableCount} 张整理后画面无法读取。`]
                            : []),
                        ...(organizationVisualReview.unreviewedCount > 0
                            ? [`${organizationVisualReview.unreviewedCount} 张整理后画面没有有效的结构化复核决定。`]
                            : []),
                        ...(!organizationVisualVersionBound
                            ? ['整理后画面复核未绑定到最终 Photoshop 历史版本。']
                            : []),
                        ...(!organizationVisualEquivalenceProven
                            ? ['整理前后原始画布像素等价尚未得到 Harness 证明。']
                            : [])
                    ]
                }
            } : {})
        },
        blockers,
        warnings,
        summary: buildSummary(kind, status, requirements)
    };
}

function buildLayerOrderContract(input: ContractInput, acceptance: AcceptanceCounts): TaskCompletionContract {
    const firstMutation = firstSuccessfulIndex(input.toolCallLog, LAYER_ORDER_MUTATION_TOOLS);
    const lastMutation = Math.max(
        lastSuccessfulIndex(input.toolCallLog, LAYER_ORDER_MUTATION_TOOLS),
        findLatestVerifiedPhotoshopMutationIndex(input.toolCallLog)
    );
    const actionCount = countSuccessful(input.toolCallLog, LAYER_ORDER_MUTATION_TOOLS);
    const failedActions = countUnresolvedFailedOperations(
        input.toolCallLog,
        LAYER_ORDER_MUTATION_TOOLS
    );
    const inspectedBeforeMutation = firstMutation >= 0 && hasSuccessfulBefore(input.toolCallLog, INSPECTION_TOOLS, firstMutation);
    const verifiedAfterMutation = lastMutation >= 0 && (
        hasSuccessfulAfter(input.toolCallLog, LAYER_ORDER_VERIFICATION_TOOLS, lastMutation)
        || hasVerifiedAcceptanceAtOrAfter(input.toolCallLog, lastMutation)
    );

    const requirements: TaskCompletionRequirement[] = [
        {
            id: 'layer-context-read',
            label: '读取图层层级上下文',
            status: inspectedBeforeMutation ? 'passed' : 'needs_review',
            reason: inspectedBeforeMutation ? undefined : '缺少排序前的图层层级读取结果。'
        },
        {
            id: 'layer-order-mutated',
            label: '执行图层顺序调整',
            status: actionCount > 0 ? 'passed' : 'failed',
            actual: { actionCount, failedActions },
            reason: actionCount > 0 ? undefined : '没有检测到成功的 reorderLayer 调用。'
        },
        {
            id: 'layer-order-verified',
            label: '复核图层顺序',
            status: verifiedAfterMutation ? 'passed' : 'needs_review',
            reason: verifiedAfterMutation ? undefined : '缺少排序后的图层层级或验收快照。'
        }
    ];

    const blockers: string[] = [];
    const warnings: string[] = [];
    if (failedActions > 0) {
        blockers.push(`存在 ${failedActions} 个图层顺序调整工具失败。`);
    }
    if (acceptance.failed > 0) {
        blockers.push(`存在 ${acceptance.failed} 个工具验收失败。`);
    }
    if (!inspectedBeforeMutation) {
        warnings.push('图层顺序任务缺少修改前层级读取，无法确认目标集合是否正确。');
    }
    if (!verifiedAfterMutation) {
        warnings.push('图层顺序任务缺少修改后复核，不能只凭模型口头结论判定完成。');
    }
    if (acceptance.needsReview > 0 || acceptance.noDocumentChangeRisk > 0) {
        warnings.push(`工具验收仍有 ${acceptance.needsReview} 项需要复核，${acceptance.noDocumentChangeRisk} 项存在无变化风险。`);
    }

    const status = resolveStatus(requirements, blockers);
    return {
        kind: 'layer_order_edit',
        status,
        required: requirements,
        verification: {
            toolAcceptance: acceptance
        },
        blockers,
        warnings,
        summary: buildSummary('layer_order_edit', status, requirements)
    };
}

function buildTextContract(
    kind: 'text_content_edit' | 'text_typography_edit',
    input: ContractInput,
    acceptance: AcceptanceCounts
): TaskCompletionContract {
    const firstMutation = firstSuccessfulIndex(input.toolCallLog, TEXT_MUTATION_TOOLS);
    const lastMutation = Math.max(
        lastSuccessfulIndex(input.toolCallLog, TEXT_MUTATION_TOOLS),
        findLatestVerifiedPhotoshopMutationIndex(input.toolCallLog)
    );
    const actionCount = countSuccessful(input.toolCallLog, TEXT_MUTATION_TOOLS);
    const failedActions = countUnresolvedFailedOperations(
        input.toolCallLog,
        TEXT_MUTATION_TOOLS
    );
    const inspectedBeforeMutation = firstMutation >= 0 && hasSuccessfulBefore(input.toolCallLog, INSPECTION_TOOLS, firstMutation);
    const verifiedAfterMutation = lastMutation >= 0 && (
        hasSuccessfulAfter(input.toolCallLog, TEXT_VERIFICATION_TOOLS, lastMutation)
        || hasVerifiedAcceptanceAtOrAfter(input.toolCallLog, lastMutation)
    );

    const requirements: TaskCompletionRequirement[] = [
        {
            id: 'context-read',
            label: '读取文本/图层上下文',
            status: inspectedBeforeMutation ? 'passed' : 'needs_review',
            reason: inspectedBeforeMutation ? undefined : '缺少修改前的文本或图层读取结果。'
        },
        {
            id: 'text-mutated',
            label: '执行文字修改',
            status: actionCount > 0 ? 'passed' : 'failed',
            actual: { actionCount, failedActions },
            reason: actionCount > 0 ? undefined : '没有检测到成功的文字修改工具调用。'
        },
        {
            id: 'text-verified',
            label: '复核文字字段或图层状态',
            status: verifiedAfterMutation ? 'passed' : 'needs_review',
            reason: verifiedAfterMutation ? undefined : '缺少修改后的文本字段、图层边界或验收快照。'
        }
    ];

    const blockers: string[] = [];
    const warnings: string[] = [];
    if (failedActions > 0) {
        blockers.push(`存在 ${failedActions} 个文字修改工具失败。`);
    }
    if (acceptance.failed > 0) {
        blockers.push(`存在 ${acceptance.failed} 个工具验收失败。`);
    }
    if (!inspectedBeforeMutation) {
        warnings.push('文字任务缺少修改前上下文读取，无法确认目标集合是否正确。');
    }
    if (!verifiedAfterMutation) {
        warnings.push('文字任务缺少修改后复核，不能只凭模型口头结论判定完成。');
    }
    if (acceptance.needsReview > 0 || acceptance.noDocumentChangeRisk > 0) {
        warnings.push(`工具验收仍有 ${acceptance.needsReview} 项需要复核，${acceptance.noDocumentChangeRisk} 项存在无变化风险。`);
    }

    const status = resolveStatus(requirements, blockers);
    return {
        kind,
        status,
        required: requirements,
        verification: {
            toolAcceptance: acceptance
        },
        blockers,
        warnings,
        summary: buildSummary(kind, status, requirements)
    };
}

function buildReferenceContract(input: ContractInput, acceptance: AcceptanceCounts): TaskCompletionContract {
    const compositeResult = collectLayoutReplicationCompositeResult(input.toolCallLog);
    let latestMutation = -1;
    for (let index = 0; index < input.toolCallLog.length; index += 1) {
        const item = input.toolCallLog[index];
        if ((completionOperationSucceeded(item) && REFERENCE_MUTATION_TOOLS.has(item.name))
            || hasLayoutReplicationCompositeMutation(item)) {
            latestMutation = index;
        }
    }
    latestMutation = Math.max(
        latestMutation,
        findLatestVerifiedPhotoshopMutationIndex(input.toolCallLog)
    );
    const actionCount = countSuccessful(input.toolCallLog, REFERENCE_MUTATION_TOOLS)
        + compositeResult.actionCount;
    const failedActions = countUnresolvedFailedOperations(
        input.toolCallLog,
        REFERENCE_MUTATION_TOOLS
    )
        + compositeResult.failedActions;
    const referenceObservation = resolveReferenceObservation(input);
    const hasReferenceInput = Boolean(referenceObservation);
    const visual = latestMutation >= 0 ? getVisualVerification(input.toolCallLog, latestMutation) : { mode: 'none' as const, snapshotCount: 0, overlayCount: 0 };
    const coverage = findCoverageVerification(input.toolCallLog);
    const visualVerified = visual.mode === 'screenshot' || visual.mode === 'overlay' || visual.mode === 'model_review';
    const coveragePassed = Boolean(coverage && coverage.expected > 0 && coverage.applied >= coverage.expected && coverage.failed === 0);

    const requirements: TaskCompletionRequirement[] = [
        {
            id: 'reference-understood',
            label: '读取或理解参考图',
            status: hasReferenceInput ? 'passed' : 'needs_review',
            actual: referenceObservation,
            reason: hasReferenceInput
                ? undefined
                : '缺少参考图已被视觉模型或专用分析 Tool 真实读取后的观察结果；附件存在本身不代表已经理解。'
        },
        {
            id: 'editable-layout-created',
            label: '创建可编辑设计元素',
            status: actionCount > 0 ? 'passed' : 'failed',
            actual: { actionCount, failedActions },
            reason: actionCount > 0 ? undefined : '没有检测到成功的文字、形状或图片创建/放置工具调用。'
        },
        {
            id: 'visual-verified',
            label: '复核生成结果画面',
            status: visualVerified ? 'passed' : 'needs_review',
            actual: visual,
            reason: visualVerified ? undefined : '缺少生成后的截图、overlay 或视觉复核结果。'
        },
        {
            id: 'reference-coverage',
            label: '参考元素覆盖率',
            status: coveragePassed ? 'passed' : 'needs_review',
            expected: coverage ? { expected: coverage.expected } : undefined,
            actual: coverage || undefined,
            reason: coveragePassed ? undefined : '缺少参考元素 expected/applied 覆盖率，不能确认复刻是否覆盖关键元素。'
        }
    ];

    const blockers: string[] = [];
    const warnings: string[] = [];
    if (failedActions > 0) {
        blockers.push(`存在 ${failedActions} 个参考图复刻相关工具失败。`);
    }
    if (acceptance.failed > 0) {
        blockers.push(`存在 ${acceptance.failed} 个工具验收失败。`);
    }
    if (!hasReferenceInput) {
        warnings.push('参考图复刻缺少参考图观察结果。');
    }
    if (!visualVerified) {
        warnings.push('参考图复刻缺少生成后画面复核。');
    }
    if (!coveragePassed) {
        warnings.push('参考图复刻缺少关键元素覆盖率检查。');
    }
    if (acceptance.needsReview > 0 || acceptance.noDocumentChangeRisk > 0) {
        warnings.push(`工具验收仍有 ${acceptance.needsReview} 项需要复核，${acceptance.noDocumentChangeRisk} 项存在无变化风险。`);
    }

    const status = resolveStatus(requirements, blockers);
    return {
        kind: 'reference_replication',
        status,
        required: requirements,
        verification: {
            toolAcceptance: acceptance,
            visual,
            coverage,
            referenceObservation
        },
        blockers,
        warnings,
        summary: buildSummary('reference_replication', status, requirements)
    };
}

function resolveCreativeReferenceGuidance(input: ContractInput): {
    guided: boolean;
    strictReplication: boolean;
} {
    const { task, skillId } = resolveStableTaskIdentity(input);
    const normalizedTask = task.toLowerCase();
    const strictReplication = /复刻|复现|还原|仿照|照着|临摹|同款(?:版式|设计|效果|画面)|(?:做|设计|制作|改).{0,8}同款|按.{0,8}(图|图片|参考|版式)|replicate|recreate|copy\s+layout/.test(normalizedTask);
    const hasReferenceLanguage = /参考(?:这|该|附|上|下|图|图片|样图|海报|版式|风格)|reference/.test(normalizedTask);
    return {
        guided: skillId === 'layout-replication'
            || strictReplication
            || (hasReferenceLanguage && (input.context?.imageCount || 0) > 0),
        strictReplication
    };
}

interface CreativeTaskObligations {
    currentDocumentOnly: boolean;
    requiresNewDocument: boolean;
    forbidsMutation: boolean;
    forbidsCopy: boolean;
    requiresCopy: boolean;
    workMode?: string;
}

function resolveCreativeTaskObligations(input: ContractInput): CreativeTaskObligations {
    const { task } = resolveStableTaskIdentity(input);
    const workMode = input.context?.agenticArtifactContract?.workMode
        || input.context?.agentTaskPlan?.designBrief.workMode;
    const normalizedTask = task.toLowerCase();
    const plan = input.context?.agentTaskPlan;
    const forbidsMutation = plan?.requestKind === 'read_only_inspect'
        || plan?.allowedToolScope === 'read_only'
        || plan?.executionPlan.mode === 'read_only';
    const currentDocumentOnly = ['edit_existing', 'redesign', 'template_fill'].includes(String(workMode || ''))
        || /(?:当前|现有|原有|已有)(?:画布|文档|海报|设计|图片)|(?:不要|无需|不需要|别|禁止)新建|不新建|直接在.{0,10}(?:画布|文档).{0,8}(?:修改|编辑|调整)/i
            .test(normalizedTask);
    const requiresNewDocument = !currentDocumentOnly
        && (workMode === 'create_new'
            || /(?:新建|创建|从零(?:开始)?).{0,10}(?:画布|文档|海报|设计稿)|(?:画布|文档).{0,8}(?:新建|创建)/i
                .test(normalizedTask));
    const forbidsCopy = /(?:不要|无需|不需要|不使用|禁止|别|不加|不放|去掉|移除|删除)(?:任何)?(?:文字|文案|标题|副标题|卖点|口号)|(?:无字|纯图|no[- ]?text|without\s+text)/i
        .test(normalizedTask);
    const typographyOnly = /纯(?:文字|文本|排版)|(?:文字|字体|文本)排版海报|排版海报|只(?:使用|保留|要).{0,8}(?:文字|文本|字体)|typography[- ]?only|text[- ]?only/i
        .test(normalizedTask);
    const explicitCopyRequest = /(?:必须|需要|要求|请|添加|加入|包含|保留|使用|写上|写入|显示).{0,14}(?:文字|文案|标题|副标题|卖点|口号|slogan)|(?:文字|文案|标题|副标题|卖点|口号|slogan)\s*[：:“"']/i
        .test(normalizedTask);
    return {
        currentDocumentOnly,
        requiresNewDocument,
        forbidsMutation,
        forbidsCopy,
        requiresCopy: !forbidsCopy && (typographyOnly || explicitCopyRequest),
        workMode
    };
}

function qualifiedCompletionFailure(
    status: TaskCompletionRequirement['status'],
    blockerKind: NonNullable<TaskCompletionRequirement['blockerKind']>,
    requirementId: string
): Pick<TaskCompletionRequirement, 'method' | 'blockerKind' | 'proofRef'> | Record<string, never> {
    if (status !== 'failed') return {};
    return {
        method: 'deterministic',
        blockerKind,
        proofRef: `task-completion:${requirementId}:task-run`
    };
}

interface CreativeCopyCountEvidence {
    copyCount: number;
    visibleCopyCount: number;
    unknownTextLayerCount: number;
    source: 'final_readback' | 'task_run_mutation';
    /** 只有同目标、最后一次写入后的文本感知读回才能证明最终文字状态。 */
    finalStateVerified: boolean;
}

function countSuccessfulCreativeCopyMutationEvidence(
    toolCallLog: AgentToolCallLogEntry[]
): Omit<CreativeCopyCountEvidence, 'source' | 'unknownTextLayerCount' | 'finalStateVerified'> {
    let copyCount = 0;
    let visibleCopyCount = 0;
    for (const item of toolCallLog) {
        if (!completionOperationSucceeded(item)) continue;
        if (item.name === 'createTextLayer' || item.name === 'setTextContent') {
            const candidates = [
                item.arguments?.text,
                item.arguments?.content,
                item.arguments?.newText,
                item.arguments?.value,
                item.result?.text,
                item.result?.content
            ];
            if (candidates.some(isRealCompositeCopy)) copyCount += 1;
            if (candidates.some(isVisibleCreativeText)) visibleCopyCount += 1;
            continue;
        }
        if (item.name !== 'renderLayout') continue;
        const blocks = [
            ...(Array.isArray(item.arguments?.blocks) ? item.arguments.blocks : []),
            ...(Array.isArray(item.result?.created) ? item.result.created : [])
        ];
        for (const block of blocks) {
            const candidates = [block?.text, block?.content, block?.currentText, block?.value];
            if (candidates.some(isRealCompositeCopy)) copyCount += 1;
            if (candidates.some(isVisibleCreativeText)) visibleCopyCount += 1;
        }
    }
    return { copyCount, visibleCopyCount };
}

function readCreativeCopyCountFromObservation(
    entry: AgentToolCallLogEntry
): Omit<CreativeCopyCountEvidence, 'source' | 'finalStateVerified'> | undefined {
    if (!toolSucceeded(entry) || entry.name !== 'getAllTextLayers') {
        return undefined;
    }
    const result = entry.result || {};
    const candidates = [result.textLayers, result.layers, result.data?.textLayers, result.data?.layers];
    const layers = candidates.find(Array.isArray);
    if (!Array.isArray(layers)) {
        const declaredCount = Number(result.textLayerCount ?? result.data?.textLayerCount);
        return Number.isFinite(declaredCount) && declaredCount >= 0
            ? {
                copyCount: 0,
                visibleCopyCount: 0,
                unknownTextLayerCount: Math.round(declaredCount)
            }
            : undefined;
    }
    let copyCount = 0;
    let visibleCopyCount = 0;
    let unknownTextLayerCount = 0;
    for (const layer of layers) {
        if (typeof layer === 'string') {
            if (isRealCompositeCopy(layer)) copyCount += 1;
            if (isVisibleCreativeText(layer)) visibleCopyCount += 1;
            continue;
        }
        const kind = String(layer?.kind || layer?.type || layer?.layerKind || '').trim();
        const textCandidates = [
            layer?.text,
            layer?.content,
            layer?.currentText,
            layer?.value,
            layer?.textItem?.contents,
            layer?.properties?.text
        ];
        if (textCandidates.some(isRealCompositeCopy)) copyCount += 1;
        if (textCandidates.some(isVisibleCreativeText)) visibleCopyCount += 1;
        if (/text|文字|文本/i.test(kind) && textCandidates.every((value) => value == null)) {
            unknownTextLayerCount += 1;
        }
    }
    return { copyCount, visibleCopyCount, unknownTextLayerCount };
}

function resolveCreativeCopyEvidence(
    toolCallLog: AgentToolCallLogEntry[],
    latestMutation: number,
    mutationCounts: Omit<CreativeCopyCountEvidence, 'source' | 'unknownTextLayerCount' | 'finalStateVerified'>
): CreativeCopyCountEvidence {
    if (latestMutation >= 0) {
        const timeline = buildAgentOperationDocumentTimeline(toolCallLog);
        const mutationContext = timeline.entries[latestMutation];
        const mutationProof = readCompletionMutationProof(toolCallLog[latestMutation]);
        for (let index = toolCallLog.length - 1; index > latestMutation; index -= 1) {
            const counts = readCreativeCopyCountFromObservation(toolCallLog[index]);
            if (!counts
                || !mutationProof
                || !samePhotoshopHistoryStateRef(
                    readPhotoshopHistoryStateRef(toolCallLog[index]?.result),
                    mutationProof.after
                )
                || !sameAgentOperationDocumentContext(mutationContext, timeline.entries[index])) {
                continue;
            }
            return { ...counts, source: 'final_readback', finalStateVerified: true };
        }
    }
    return {
        ...mutationCounts,
        unknownTextLayerCount: 0,
        source: 'task_run_mutation',
        finalStateVerified: false
    };
}

function resolveRequiredCopyStatus(
    evidence: CreativeCopyCountEvidence
): TaskCompletionRequirement['status'] {
    if (!evidence.finalStateVerified) return 'needs_review';
    return evidence.copyCount > 0 ? 'passed' : 'failed';
}

function buildRequiredCopyReason(status: TaskCompletionRequirement['status']): string | undefined {
    if (status === 'passed') return undefined;
    if (status === 'needs_review') {
        return '用户明确要求画面包含非空文字，但最后一次写入后缺少同目标的文本感知读回；写工具调用不能单独证明最终文字仍然存在。此项只验证非空文字存在，不验证具体文案是否正确。';
    }
    return '用户明确要求画面包含非空文字或纯排版交付，但最终文本读回没有非空文字；只补用户要求的文字，不得擅自增加额外卖点。具体文案正确性仍由精确文字编辑契约或 Brief 质量检查负责。';
}

function resolveForbiddenCopyStatus(
    evidence: CreativeCopyCountEvidence
): TaskCompletionRequirement['status'] {
    if (!evidence.finalStateVerified) return 'needs_review';
    if (evidence.visibleCopyCount > 0) return 'failed';
    if (evidence.unknownTextLayerCount > 0) return 'needs_review';
    return 'passed';
}

function buildForbiddenCopyReason(
    status: TaskCompletionRequirement['status'],
    evidence: CreativeCopyCountEvidence
): string | undefined {
    if (status === 'passed') return undefined;
    if (status === 'failed') {
        return '用户明确要求无字/不要文案，但当前 TaskRun 或最终读回存在非空文本；不得用通用标题卖点配方覆盖用户约束。';
    }
    if (!evidence.finalStateVerified) {
        return '用户明确要求无字/不要文案，但最后一次写入后缺少同目标的文本感知读回；没有新增文字不等于最终画面没有文字。';
    }
    return '读回发现文本图层，但结果没有返回实际文本内容；需要读取文本后确认无字约束，未知状态不能直接判失败。';
}

// 通用 creative Completion 只投影 TaskPlan / 用户显式义务和本次 TaskRun 的可证明事实。
// 主体图、标题卖点、背景复杂度等开放设计选择不在这里形成硬配方；审美由质量断言与视觉复核负责。
function buildCreativeDesignContract(input: ContractInput, acceptance: AcceptanceCounts): TaskCompletionContract {
    const log = input.toolCallLog;
    const compositeResult = collectLayoutReplicationCompositeResult(log);
    const obligations = resolveCreativeTaskObligations(input);
    const timeline = buildAgentOperationDocumentTimeline(log);
    const latestMutation = findLatestVerifiedPhotoshopMutationIndex(log);
    const latestMutationProof = readCompletionMutationProof(log[latestMutation]);
    const currentTaskRunCreatedDocumentCount = countCreatedDocuments(log)
        + compositeResult.createdDocumentCount;
    const taskChainCreatedDocumentCount = countPriorTaskRunCreatedDocumentsForMutation(
        input.context,
        latestMutationProof
    );
    const createdDocumentCount = currentTaskRunCreatedDocumentCount
        + taskChainCreatedDocumentCount;
    const createdDocument = createdDocumentCount > 0;
    const mutationCopyEvidence = countSuccessfulCreativeCopyMutationEvidence(log);
    const copyEvidence = resolveCreativeCopyEvidence(log, latestMutation, {
        copyCount: mutationCopyEvidence.copyCount + compositeResult.copyCount,
        visibleCopyCount: mutationCopyEvidence.visibleCopyCount + compositeResult.visibleCopyCount
    });
    const copyCount = copyEvidence.copyCount;
    const visibleCopyCount = copyEvidence.visibleCopyCount;
    const mutationEntry = latestMutation >= 0 ? timeline.entries[latestMutation] : undefined;
    const mutationApplied = Boolean(mutationEntry?.photoshopMutationObserved);
    const mutationTargetKnown = Boolean(mutationEntry?.target);
    const currentDocumentViolation = obligations.currentDocumentOnly && createdDocument;
    const sameTargetReadback = mutationApplied
        && mutationTargetKnown
        && (hasSuccessfulAfter(log, INSPECTION_TOOLS, latestMutation)
            || hasVerifiedAcceptanceAtOrAfter(log, latestMutation));
    const visualReview = collectVisualReviewCounts(log, DESIGN_REVIEW_TOOLS, latestMutation);
    const reviewCount = visualReview.passedCount;
    const referenceGuidance = resolveCreativeReferenceGuidance(input);
    const referenceObservation = referenceGuidance.guided
        ? resolveReferenceObservation(input)
        : undefined;
    const hasReferenceInput = Boolean(referenceObservation);
    const coverage = referenceGuidance.guided ? findCoverageVerification(log) : undefined;
    const referenceCoveragePassed = Boolean(
        coverage
        && coverage.expected > 0
        && coverage.applied > 0
        && coverage.failed === 0
        && (!referenceGuidance.strictReplication || coverage.applied >= coverage.expected)
    );
    const deliveryRequirement = buildDeclaredDeliveryRequirement(
        input,
        log,
        'creative-delivery',
        { pairCreatedCreativeDocument: true }
    );
    const documentLifecycleRequirement = buildTaskRunCreatedDocumentLifecycleRequirement(
        input,
        log,
        'creative-document-lifecycle'
    );
    const renderLayoutQuality = collectLatestRenderLayoutQualityState(log);
    const unresolvedComparisonFinding = Boolean(
        renderLayoutQuality?.unresolved
        && renderLayoutQuality.findings.some((finding) => finding?.closureKind === 'comparison')
    );
    let layoutQualityReason: string | undefined;
    if (renderLayoutQuality?.unresolved && unresolvedComparisonFinding) {
        layoutQualityReason = '候选发生了结构性变化，但当前只有变化事实，没有更优证据。需要主 Agent 在同文档最新画面上给出明确比较理由；advisory 评审只能提供修改建议，不能代替设计作者关闭完成条件。不要把删减本身当成好坏结论。';
    } else if (renderLayoutQuality?.unresolved) {
        layoutQualityReason = 'renderLayout 的结构化质量发现尚未按 finding 指定的同一工具、图层与参数完成闭环；写类修订后还必须有真实局部视觉复核，不能把任意成功动作当作问题已解决。';
    }
    const independentCriticReviewCount = renderLayoutQuality?.criticClosureCount || 0;
    const creativeReviewPassed = visualReview.allPassed || independentCriticReviewCount > 0;

    const executionStatus: TaskCompletionRequirement['status'] = mutationApplied ? 'passed' : 'failed';
    const targetStatus: TaskCompletionRequirement['status'] = !mutationApplied
        ? 'needs_review'
        : (currentDocumentViolation || !mutationTargetKnown ? 'failed' : 'passed');
    const readbackStatus: TaskCompletionRequirement['status'] = !mutationApplied
        ? 'needs_review'
        : (sameTargetReadback ? 'passed' : 'failed');
    const requirements: TaskCompletionRequirement[] = [{
        id: 'creative-execution',
        label: '产生真实设计写入',
        status: executionStatus,
        actual: {
            mutationApplied,
            mutationIndex: latestMutation,
            mutationTool: mutationEntry?.operation.name
        },
        reason: mutationApplied
            ? undefined
            : '当前 TaskRun 没有可证明的 Photoshop 文档写入，不能把分析、搜索、计划或工具口述当成交付。',
        ...qualifiedCompletionFailure(executionStatus, 'required_artifact_missing', 'creative-execution')
    }];

    if (obligations.forbidsMutation) {
        const readOnlyStatus: TaskCompletionRequirement['status'] = mutationApplied ? 'failed' : 'passed';
        requirements.push({
            id: 'creative-read-only-constraint',
            label: '遵守只读 TaskPlan',
            status: readOnlyStatus,
            expected: { photoshopMutationCount: 0 },
            actual: {
                mutationApplied,
                mutationIndex: latestMutation,
                mutationTool: mutationEntry?.operation.name
            },
            reason: mutationApplied
                ? '入口 TaskPlan 明确限定为只读，但当前 TaskRun 已发生 Photoshop 写入；该写入不能从完成记录中消失。'
                : undefined,
            ...qualifiedCompletionFailure(readOnlyStatus, 'permission_denied', 'creative-read-only-constraint')
        });
    }

    if (obligations.requiresNewDocument) {
        const documentStatus: TaskCompletionRequirement['status'] = createdDocument ? 'passed' : 'failed';
        requirements.push({
            id: 'creative-document',
            label: '创建用户要求的新文档',
            status: documentStatus,
            expected: { workMode: obligations.workMode || 'explicit_create_new' },
            actual: {
                createdDocumentCount,
                currentTaskRunCreatedDocumentCount,
                taskChainCreatedDocumentCount
            },
            reason: createdDocument
                ? undefined
                : 'TaskPlan 或用户明确要求新建设计文档，但当前 TaskRun 没有成功的 createDocument 事实。',
            ...qualifiedCompletionFailure(documentStatus, 'required_artifact_missing', 'creative-document')
        });
    }

    requirements.push(
        {
            id: 'creative-target',
            label: '写入正确目标文档',
            status: targetStatus,
            expected: {
                currentDocumentOnly: obligations.currentDocumentOnly,
                workMode: obligations.workMode
            },
            actual: {
                mutationTargetKnown,
                createdDocumentCount,
                currentTaskRunCreatedDocumentCount,
                taskChainCreatedDocumentCount,
                target: mutationEntry?.target
            },
            reason: !mutationApplied
                ? '尚无设计写入，目标文档将在执行后校验。'
                : (currentDocumentViolation
                    ? '用户或 TaskPlan 要求编辑当前/现有文档，但当前 TaskRun 新建了文档；不能把错误目标上的写入算成交付。'
                    : (!mutationTargetKnown
                        ? '设计写入缺少可校验的 documentId/目标锚点，无法证明改在了正确文档。'
                        : undefined)),
            ...qualifiedCompletionFailure(
                targetStatus,
                currentDocumentViolation ? 'target_mismatch' : 'required_artifact_missing',
                'creative-target'
            )
        },
        {
            id: 'creative-readback',
            label: '同目标写后读回',
            status: readbackStatus,
            actual: {
                mutationIndex: latestMutation,
                mutationTargetKnown,
                sameTargetReadback
            },
            reason: !mutationApplied
                ? '尚无设计写入，读回义务将在执行后校验。'
                : (sameTargetReadback
                    ? undefined
                    : '最后一次写入后缺少同一 documentId/目标锚点上的真实读回，不能仅凭写工具返回宣告完成。'),
            ...qualifiedCompletionFailure(readbackStatus, 'required_artifact_missing', 'creative-readback')
        }
    );

    if (referenceGuidance.guided) {
        requirements.push(
            {
                id: 'creative-reference-understood',
                label: '读取并理解参考图',
                status: hasReferenceInput ? 'passed' : 'needs_review',
                actual: referenceObservation,
                reason: hasReferenceInput
                    ? undefined
                    : '任务要求参考具体画面，但缺少视觉模型或专用分析 Tool 的真实观察结果；附件数量不足以确认已经理解。'
            },
            {
                id: 'creative-reference-coverage',
                label: referenceGuidance.strictReplication ? '参考元素覆盖率' : '参考结构落地',
                status: referenceCoveragePassed ? 'passed' : 'needs_review',
                expected: coverage ? { expected: coverage.expected } : undefined,
                actual: coverage || undefined,
                reason: referenceCoveragePassed
                    ? undefined
                    : (referenceGuidance.strictReplication
                        ? '缺少完整的参考元素 expected/applied 覆盖率，不能确认复刻要求已落实。'
                        : '缺少参考结构落地检查，不能确认成品确实使用了用户提供的参考画面。')
            }
        );
    }

    if (obligations.requiresCopy) {
        const copyStatus = resolveRequiredCopyStatus(copyEvidence);
        requirements.push({
            id: 'creative-copy',
            label: '最终画面存在非空文字',
            status: copyStatus,
            actual: {
                copyCount,
                unknownTextLayerCount: copyEvidence.unknownTextLayerCount,
                evidenceSource: copyEvidence.source,
                finalStateVerified: copyEvidence.finalStateVerified,
                contentCorrectnessVerified: false
            },
            reason: buildRequiredCopyReason(copyStatus),
            ...qualifiedCompletionFailure(copyStatus, 'required_artifact_missing', 'creative-copy')
        });
    } else if (obligations.forbidsCopy) {
        const noCopyStatus = resolveForbiddenCopyStatus(copyEvidence);
        requirements.push({
            id: 'creative-copy-constraint',
            label: '遵守无字/无文案约束',
            status: noCopyStatus,
            expected: { copyCount: 0 },
            actual: {
                visibleCopyCount,
                unknownTextLayerCount: copyEvidence.unknownTextLayerCount,
                evidenceSource: copyEvidence.source,
                finalStateVerified: copyEvidence.finalStateVerified
            },
            reason: buildForbiddenCopyReason(noCopyStatus, copyEvidence),
            ...qualifiedCompletionFailure(noCopyStatus, 'proven_fact_error', 'creative-copy-constraint')
        });
    }

    requirements.push({
            id: 'creative-review',
            label: '画面复核',
            status: creativeReviewPassed ? 'passed' : 'needs_review',
            actual: {
                expectedCount: visualReview.expectedCount,
                reviewCount,
                independentCriticReviewCount,
                snapshotCount: visualReview.capturedCount,
                unreviewedCount: visualReview.unreviewedCount,
                needsFixCount: visualReview.needsFixCount,
                unreadableCount: visualReview.unreadableCount,
                overflowCount: visualReview.overflowCount
            },
            reason: creativeReviewPassed ? undefined : buildCreativeVisualReviewReason(visualReview)
    });

    if (renderLayoutQuality) {
        requirements.push({
            id: 'creative-layout-quality',
            label: '修复布局与图片落位异常',
            status: renderLayoutQuality.unresolved ? 'needs_review' : 'passed',
            actual: {
                qualityState: renderLayoutQuality.qualityState,
                repairActionCount: renderLayoutQuality.repairActionCount,
                verifiedClosureCount: renderLayoutQuality.verifiedClosureCount,
                criticClosureCount: renderLayoutQuality.criticClosureCount,
                unresolvedFindingCount: renderLayoutQuality.unresolvedFindingCount,
                reviewedObservationCount: renderLayoutQuality.reviewedObservationCount,
                ownerCount: renderLayoutQuality.ownerCount,
                unresolvedOwnerCount: renderLayoutQuality.unresolvedOwnerCount,
                findings: renderLayoutQuality.findings,
                suggestedObservation: renderLayoutQuality.suggestedObservation
            },
            reason: layoutQualityReason
        });
    }

    if (documentLifecycleRequirement) requirements.push(documentLifecycleRequirement);
    if (deliveryRequirement) requirements.push(deliveryRequirement);

    const blockers: string[] = [];
    const warnings: string[] = [];
    if (acceptance.failed > 0) {
        warnings.push(`有 ${acceptance.failed} 个工具步骤失败，需要判断是否影响最终成品。`);
    }
    if (acceptance.needsReview > 0 || acceptance.noDocumentChangeRisk > 0) {
        warnings.push(`工具验收仍有 ${acceptance.needsReview} 项需要复核，${acceptance.noDocumentChangeRisk} 项存在无变化风险。`);
    }
    if (referenceGuidance.guided && !hasReferenceInput) {
        warnings.push('参考引导的创意任务缺少参考图观察结果。');
    }
    if (referenceGuidance.guided && !referenceCoveragePassed) {
        warnings.push(
            referenceGuidance.strictReplication
                ? '创意成品缺少完整的参考元素覆盖率检查。'
                : '创意成品缺少参考结构落地检查。'
        );
    }

    const status = resolveStatus(requirements, blockers);
    return {
        kind: 'creative_design',
        status,
        required: requirements,
        verification: {
            toolAcceptance: acceptance,
            visual: {
                mode: resolveVisualReviewMode(visualReview),
                snapshotCount: visualReview.capturedCount,
                reviewedCount: visualReview.reviewedCount,
                unreviewedCount: visualReview.unreviewedCount,
                blockers: [
                    ...(visualReview.needsFixCount > 0
                        ? [`${visualReview.needsFixCount} 张画面明确需要修订。`]
                        : []),
                    ...(visualReview.unreadableCount > 0
                        ? [`${visualReview.unreadableCount} 张画面无法读取。`]
                        : []),
                    ...(visualReview.unreviewedCount > 0
                        ? [`${visualReview.unreviewedCount} 张画面没有有效的结构化复核决定。`]
                        : []),
                    ...(visualReview.overflowCount > 0
                        ? [`${visualReview.overflowCount} 张画面因视觉预算或生产端限制未进入复核。`]
                        : [])
                ]
            },
            coverage,
            referenceObservation
        },
        blockers,
        warnings,
        summary: buildSummary('creative_design', status, requirements)
    };
}

type ProfileProductionEvidenceMode = 'read_only' | 'delivery_only' | 'mutation_with_readback';

function resolveProfileProductionEvidenceMode(input: ContractInput): ProfileProductionEvidenceMode {
    const plan = input.context?.agentTaskPlan;
    const workMode = String(
        input.context?.agenticArtifactContract?.workMode
        || plan?.designBrief.workMode
        || ''
    ).trim();
    if (plan?.requestKind === 'read_only_inspect'
        || plan?.allowedToolScope === 'read_only'
        || plan?.executionPlan.mode === 'read_only'
        || workMode === 'analyze_only') {
        return 'read_only';
    }
    if (workMode === 'export_only') return 'delivery_only';
    return 'mutation_with_readback';
}

function hasSameTargetPhotoshopObservationAfter(
    toolCallLog: AgentToolCallLogEntry[],
    afterIndex: number
): boolean {
    if (afterIndex < 0) return false;
    const timeline = buildAgentOperationDocumentTimeline(toolCallLog);
    const mutationContext = timeline.entries[afterIndex];
    const mutationProof = readCompletionMutationProof(toolCallLog[afterIndex]);
    if (!mutationProof) return false;
    return toolCallLog.some((item, index) => index > afterIndex
        && toolSucceeded(item)
        && isAgentPhotoshopDocumentObservation(item.name, item.arguments)
        && samePhotoshopHistoryStateRef(
            readPhotoshopHistoryStateRef(item.result),
            mutationProof.after
        )
        && sameAgentOperationDocumentContext(mutationContext, timeline.entries[index]));
}

/**
 * 已绑定 Evaluation Profile 的任务只叠加跨品类的生产事实。
 *
 * Profile 是设计质量的唯一 owner；这里不再从任务文本、品类关键词或业务 Tool 名推断
 * “应该做成什么”。它只消费结构化 TaskPlan 与本次 TaskRun 的 Photoshop 证据，防止
 * Profile 通过后仍被另一套业务分类器推翻，同时保留零写入、错目标和缺读回的硬失败。
 */
function buildProfileProductionEvidenceContract(
    input: ContractInput,
    acceptance: AcceptanceCounts
): TaskCompletionContract {
    const log = input.toolCallLog;
    const plan = input.context?.agentTaskPlan;
    const workMode = String(
        input.context?.agenticArtifactContract?.workMode
        || plan?.designBrief.workMode
        || ''
    ).trim();
    const evidenceMode = resolveProfileProductionEvidenceMode(input);
    const timeline = buildAgentOperationDocumentTimeline(log);
    const latestMutation = findLatestVerifiedPhotoshopMutationIndex(log);
    const mutationEntry = latestMutation >= 0 ? timeline.entries[latestMutation] : undefined;
    const latestMutationProof = readCompletionMutationProof(log[latestMutation]);
    const mutationApplied = Boolean(mutationEntry?.photoshopMutationObserved);
    const mutationTargetKnown = Boolean(mutationEntry?.target);
    const sameTargetReadback = mutationApplied
        && mutationTargetKnown
        && (hasSameTargetPhotoshopObservationAfter(log, latestMutation)
            || hasVerifiedAcceptanceAtOrAfter(log, latestMutation));
    const currentTaskRunCreatedDocumentCount = countCreatedDocuments(log)
        + collectLayoutReplicationCompositeResult(log).createdDocumentCount;
    const taskChainCreatedDocumentCount = countPriorTaskRunCreatedDocumentsForMutation(
        input.context,
        latestMutationProof
    );
    const createdDocumentCount = currentTaskRunCreatedDocumentCount
        + taskChainCreatedDocumentCount;
    const currentDocumentOnly = ['edit_existing', 'redesign', 'template_fill'].includes(workMode);
    const currentDocumentViolation = currentDocumentOnly && createdDocumentCount > 0;
    const requirements: TaskCompletionRequirement[] = [];

    if (evidenceMode === 'read_only') {
        const status: TaskCompletionRequirement['status'] = mutationApplied ? 'failed' : 'passed';
        requirements.push({
            id: 'production-read-only-constraint',
            label: '遵守结构化只读范围',
            status,
            expected: { photoshopMutationCount: 0, workMode: workMode || 'read_only' },
            actual: {
                mutationApplied,
                mutationIndex: latestMutation,
                mutationTool: mutationEntry?.operation.name
            },
            reason: mutationApplied
                ? '结构化 TaskPlan 明确限定为只读，但当前 TaskRun 已发生 Photoshop 写入。'
                : undefined,
            ...qualifiedCompletionFailure(status, 'permission_denied', 'production-read-only-constraint')
        });
    } else if (evidenceMode === 'mutation_with_readback') {
        const executionStatus: TaskCompletionRequirement['status'] = mutationApplied ? 'passed' : 'failed';
        const targetStatus: TaskCompletionRequirement['status'] = !mutationApplied
            ? 'needs_review'
            : (currentDocumentViolation || !mutationTargetKnown ? 'failed' : 'passed');
        const readbackStatus: TaskCompletionRequirement['status'] = !mutationApplied
            ? 'needs_review'
            : (sameTargetReadback ? 'passed' : 'failed');
        requirements.push(
            {
                id: 'production-execution',
                label: '产生真实 Photoshop 写入',
                status: executionStatus,
                actual: {
                    mutationApplied,
                    mutationIndex: latestMutation,
                    mutationTool: mutationEntry?.operation.name
                },
                reason: mutationApplied
                    ? undefined
                    : '当前 TaskRun 没有可证明的 Photoshop 文档写入，设计评价结果不能替代真实产物。',
                ...qualifiedCompletionFailure(executionStatus, 'required_artifact_missing', 'production-execution')
            },
            {
                id: 'production-target',
                label: '写入结构化目标文档',
                status: targetStatus,
                expected: { currentDocumentOnly, workMode: workMode || undefined },
                actual: {
                    mutationTargetKnown,
                    createdDocumentCount,
                    currentTaskRunCreatedDocumentCount,
                    taskChainCreatedDocumentCount,
                    target: mutationEntry?.target
                },
                reason: !mutationApplied
                    ? '尚无设计写入，目标文档将在执行后校验。'
                    : (currentDocumentViolation
                        ? '结构化 workMode 要求编辑现有文档，但当前 TaskRun 新建了文档。'
                        : (!mutationTargetKnown
                            ? '设计写入缺少可校验的 documentId 目标锚点。'
                            : undefined)),
                ...qualifiedCompletionFailure(
                    targetStatus,
                    currentDocumentViolation ? 'target_mismatch' : 'required_artifact_missing',
                    'production-target'
                )
            },
            {
                id: 'production-readback',
                label: '同目标写后读回',
                status: readbackStatus,
                actual: {
                    mutationIndex: latestMutation,
                    mutationTargetKnown,
                    sameTargetReadback
                },
                reason: !mutationApplied
                    ? '尚无设计写入，读回义务将在执行后校验。'
                    : (sameTargetReadback
                        ? undefined
                        : '最后一次写入后缺少同一 documentId 上的真实 Photoshop 读回。'),
                ...qualifiedCompletionFailure(readbackStatus, 'required_artifact_missing', 'production-readback')
            }
        );

        if (workMode === 'create_new') {
            const documentStatus: TaskCompletionRequirement['status'] = createdDocumentCount > 0
                ? 'passed'
                : 'failed';
            requirements.push({
                id: 'production-document',
                label: '创建结构化计划要求的新文档',
                status: documentStatus,
                expected: { workMode },
                actual: {
                    createdDocumentCount,
                    currentTaskRunCreatedDocumentCount,
                    taskChainCreatedDocumentCount
                },
                reason: createdDocumentCount > 0
                    ? undefined
                    : '结构化 workMode=create_new，但当前 TaskRun 没有成功的新建文档事实。',
                ...qualifiedCompletionFailure(documentStatus, 'required_artifact_missing', 'production-document')
            });
        }
    }

    // staged Runtime 的文件交付继续由 E2 receipt owner 校验；这里只补 agentic
    // Manifest 原先丢失的产物义务，避免 Profile 评价通过后绕过 PSD / 预览交付。
    const deliveryRequirement = input.context?.agenticArtifactContract
        ? buildDeclaredDeliveryRequirement(input, log, 'production-delivery')
        : undefined;
    const documentLifecycleRequirement = buildTaskRunCreatedDocumentLifecycleRequirement(
        input,
        log,
        'production-document-lifecycle'
    );
    if (documentLifecycleRequirement) requirements.push(documentLifecycleRequirement);
    if (deliveryRequirement) requirements.push(deliveryRequirement);

    const blockers = requirements
        .filter((requirement) => requirement.status === 'failed')
        .map((requirement) => requirement.reason || `${requirement.label}未通过。`);
    const warnings = requirements
        .filter((requirement) => requirement.status === 'needs_review')
        .map((requirement) => requirement.reason || `${requirement.label}需要复核。`);
    const status = resolveStatus(requirements, blockers);

    return {
        kind: 'skill_evaluation_profile',
        status,
        required: requirements,
        verification: { toolAcceptance: acceptance },
        blockers,
        warnings,
        summary: evidenceMode === 'delivery_only'
            ? '结构化模式不要求 Photoshop 内容写入；交付事实由真实保存或导出收据验证。'
            : `通用生产证据 ${requirements.filter((item) => item.status === 'passed').length}/${requirements.length} 项通过。`
    };
}

const DOCUMENT_RESULT_CONTAINER_KEYS = new Set([
    'document',
    'documentInfo',
    'activeDocument',
    'targetDocument',
    'documents',
    'results',
    'data'
]);

function collectDocumentNames(value: unknown, into: Set<string>, depth: number): void {
    if (!value || depth > 4 || into.size >= 32) return;
    if (Array.isArray(value)) {
        for (const item of value) collectDocumentNames(item, into, depth + 1);
        return;
    }
    if (typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    for (const key of ['documentName', 'activeDocumentName', 'targetDocumentName']) {
        const name = typeof record[key] === 'string' ? record[key].trim() : '';
        if (name) into.add(name);
    }
    for (const [key, nested] of Object.entries(record)) {
        if (DOCUMENT_RESULT_CONTAINER_KEYS.has(key)) collectDocumentNames(nested, into, depth + 1);
    }
}

function collectUserDeliverableDocumentWriteEvidence(
    log: AgentToolCallLogEntry[]
): UserDeliverableEvidenceCandidate[] {
    const timeline = buildAgentOperationDocumentTimeline(log);
    const candidates: UserDeliverableEvidenceCandidate[] = [];
    for (const entry of timeline.entries) {
        if (entry.kind !== 'photoshop_write' || !entry.photoshopMutationObserved) continue;
        const names = new Set<string>();
        collectDocumentNames(entry.operation.arguments, names, 0);
        collectDocumentNames(entry.operation.result, names, 0);
        if (entry.operation.name === 'createDocument') {
            const operationArguments = entry.operation.arguments;
            if (operationArguments
                && typeof operationArguments === 'object'
                && !Array.isArray(operationArguments)) {
                const name = String((operationArguments as Record<string, unknown>).name || '').trim();
                if (name) names.add(name);
            }
        }
        let nameIndex = 0;
        for (const name of names) {
            candidates.push({
                id: `document:${entry.index}:${nameIndex}`,
                kind: 'document_write',
                reference: name,
                toolName: String(entry.operation.name || ''),
                logIndex: entry.index
            });
            nameIndex += 1;
        }
    }
    return candidates;
}

function applyUserDeclaredDeliverableReceipts(
    input: ContractInput,
    contract: TaskCompletionContract
): TaskCompletionContract {
    const deliverables = input.context?.agentTaskPlan?.designBrief.userDeclaredDeliverables || [];
    if (deliverables.length === 0) return contract;

    const requiresFiles = taskRequestsDelivery(input);
    const candidates = requiresFiles
        ? collectUserDeliverableFileEvidence(input.toolCallLog)
        : collectUserDeliverableDocumentWriteEvidence(input.toolCallLog);
    const projections = projectUserDeliverableReceipts({
        deliverables,
        candidates,
        requiredKind: requiresFiles ? 'file' : 'document_write'
    });
    const receiptRequirements = projections.map((projection): TaskCompletionRequirement => {
        const requirementId = `user-deliverable:${projection.deliverableId}`;
        return {
            id: requirementId,
            label: `交付用户点名的“${projection.label}”`,
            status: projection.status,
            expected: {
                label: projection.label,
                evidenceKind: requiresFiles ? 'file' : 'document_write'
            },
            actual: projection.receipt
                ? {
                    toolName: projection.receipt.toolName,
                    logIndex: projection.receipt.logIndex,
                    reference: projection.receipt.reference
                }
                : { matchingCandidateIds: projection.matchingCandidateIds },
            reason: projection.reason,
            ...qualifiedCompletionFailure(
                projection.status,
                'required_artifact_missing',
                requirementId
            )
        };
    });
    const requiredById = new Map<string, TaskCompletionRequirement>();
    for (const requirement of [...contract.required, ...receiptRequirements]) {
        requiredById.set(requirement.id, requirement);
    }
    const required = [...requiredById.values()];
    const receiptBlockers = receiptRequirements
        .filter((requirement) => requirement.status === 'failed')
        .map((requirement) => requirement.reason || `${requirement.label}缺少收据。`);
    const receiptWarnings = receiptRequirements
        .filter((requirement) => requirement.status === 'needs_review')
        .map((requirement) => requirement.reason || `${requirement.label}的收据归属需要复核。`);
    const blockers = [...new Set([...contract.blockers, ...receiptBlockers])];
    const warnings = [...new Set([...contract.warnings, ...receiptWarnings])];
    let status = contract.status;
    if (receiptBlockers.length > 0) {
        status = 'failed';
    } else if (status === 'completed' && receiptWarnings.length > 0) {
        status = 'needs_review';
    }
    const passedCount = receiptRequirements.filter((requirement) => requirement.status === 'passed').length;
    const completion = contract.completion
        ? {
            ...contract.completion,
            artifactStatus: status === 'completed'
                ? contract.completion.artifactStatus
                : 'artifact_incomplete' as const,
            pendingPublicationReviewCheckKeys: [
                ...contract.completion.pendingPublicationReviewCheckKeys
            ],
            rejectedPublicationReviewCheckKeys: [
                ...contract.completion.rejectedPublicationReviewCheckKeys
            ],
            boundaries: { ...contract.completion.boundaries }
        }
        : undefined;

    return {
        ...contract,
        status,
        required,
        blockers,
        warnings,
        ...(completion ? { completion } : {}),
        summary: `${contract.summary} 用户点名交付物 ${passedCount}/${receiptRequirements.length} 项取得独立${requiresFiles ? '文件' : '文档写入'}收据。`
    };
}

function mergeEvaluationProfileWithProductionEvidence(
    profileContract: TaskCompletionContract,
    factualContract: TaskCompletionContract
): TaskCompletionContract {
    const requiredById = new Map<string, TaskCompletionRequirement>();
    for (const requirement of [...factualContract.required, ...profileContract.required]) {
        requiredById.set(requirement.id, requirement);
    }
    const required = [...requiredById.values()];
    const blockers = [...new Set([
        ...factualContract.blockers,
        ...profileContract.blockers
    ])];
    const warnings = [...new Set([
        ...factualContract.warnings,
        ...profileContract.warnings
    ])];
    let status: AgentExecutionStatus = 'completed';
    if (factualContract.status === 'failed' || profileContract.status === 'failed') {
        status = 'failed';
    } else if (factualContract.status === 'needs_review' || profileContract.status === 'needs_review') {
        status = 'needs_review';
    }
    const completion = profileContract.completion
        ? {
            ...profileContract.completion,
            artifactStatus: status === 'completed'
                ? profileContract.completion.artifactStatus
                : 'artifact_incomplete' as const,
            pendingPublicationReviewCheckKeys: [
                ...profileContract.completion.pendingPublicationReviewCheckKeys
            ],
            rejectedPublicationReviewCheckKeys: [
                ...profileContract.completion.rejectedPublicationReviewCheckKeys
            ],
            boundaries: { ...profileContract.completion.boundaries }
        }
        : undefined;

    return {
        kind: 'skill_evaluation_profile',
        status,
        required,
        verification: {
            ...factualContract.verification,
            ...profileContract.verification,
            visual: profileContract.verification.visual || factualContract.verification.visual,
            coverage: factualContract.verification.coverage || profileContract.verification.coverage,
            referenceObservation: factualContract.verification.referenceObservation
                || profileContract.verification.referenceObservation
        },
        blockers,
        warnings,
        ...(completion ? { completion } : {}),
        summary: `${factualContract.summary} ${profileContract.summary}`
    };
}

export function buildTaskCompletionContract(input: ContractInput): TaskCompletionContract | undefined {
    const operationInput: ContractInput = {
        ...input,
        toolCallLog: buildAgentOperationLedger(input.toolCallLog) as unknown as AgentToolCallLogEntry[]
    };
    const acceptance = collectAcceptanceCounts(operationInput.toolCallLog);
    const profileContract = buildSkillEvaluationProfileContract(operationInput, acceptance);
    if (profileContract) {
        const factualContract = buildProfileProductionEvidenceContract(operationInput, acceptance);
        return applyUserDeclaredDeliverableReceipts(
            operationInput,
            mergeEvaluationProfileWithProductionEvidence(profileContract, factualContract)
        );
    }

    const kind = inferTaskKind(operationInput);
    if (!kind) return undefined;
    let contract: TaskCompletionContract | undefined;
    if (kind === 'reference_replication') {
        contract = buildReferenceContract(operationInput, acceptance);
    } else if (kind === 'creative_design') {
        contract = buildCreativeDesignContract(operationInput, acceptance);
    } else if (kind === 'layer_order_edit') {
        contract = buildLayerOrderContract(operationInput, acceptance);
    } else if (kind === 'layer_management') {
        contract = buildOperationContract(kind, operationInput, acceptance, LAYER_MANAGEMENT_MUTATION_TOOLS, LAYER_MANAGEMENT_VERIFICATION_TOOLS, {
            context: '读取图层上下文',
            mutation: '执行图层管理操作',
            verification: '复核图层状态'
        });
    } else if (kind === 'document_save') {
        contract = buildOperationContract(kind, operationInput, acceptance, DOCUMENT_SAVE_TOOLS, DOCUMENT_VERIFICATION_TOOLS, {
            context: '读取文档状态',
            mutation: '执行文档保存或导出',
            verification: '复核文档保存结果'
        });
    } else if (kind === 'document_close') {
        contract = buildOperationContract(kind, operationInput, acceptance, DOCUMENT_CLOSE_TOOLS, DOCUMENT_VERIFICATION_TOOLS, {
            context: '确认待关闭文档',
            mutation: '执行文档关闭',
            verification: '复核文档关闭结果'
        });
    } else if (kind === 'text_content_edit' || kind === 'text_typography_edit') {
        contract = buildTextContract(kind, operationInput, acceptance);
    }
    return contract
        ? applyUserDeclaredDeliverableReceipts(operationInput, contract)
        : undefined;
}
