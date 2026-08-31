/**
 * Agent 核心类 — ReAct 循环
 *
 * 思考 → 调工具 → 观察结果 → 继续
 *
 * Agent 循环跑在 Renderer 进程：
 * - 70+ 工具已在 Renderer 的 executeToolCall() 中
 * - 模型调用通过 IPC 桥接到 Main 进程
 * - UI 回调天然在 Renderer
 */

import type {
    AgentConfig,
    AgentExecutionSummary,
    AgentMessage,
    AgentRunResult,
    AgentStepEvent,
    AgentStopReason,
    AgentThinkingEventMeta,
    AgentToolCallLogEntry,
    CallModelFn,
    ContentBlock,
    ExecuteToolFn,
    ImageAttachment,
    TaskCompletionContext,
    TaskCompletionContract,
    TaskCompletionReferenceObservation,
    ToolCall,
    ToolResult,
    ToolSchema
} from './types';
import { bindCanvasSnapshotExpectedDocumentId } from './canvas-snapshot-target-binding';
import {
    buildAgentUserResultProjectionFromToolLog,
    deriveAgentUserResultFacts,
    type UserResultProjection
} from './agent-user-result-projection';
import {
    buildAgentActionEventProjection
} from './agent-action-event-projection';
import {
    ensureFinalQualityCurrentReviewSet,
    isFinalQualityReviewedVisualSource,
    readFinalQualityCurrentHistoryStateRef,
    selectFinalQualityFullSurfaceToolName,
    selectFinalQualityReviewSet,
    type FinalQualityHostEvidenceContext,
    type FinalQualityReviewedVisualBinding
} from './final-quality-host-evidence';
import { resolveLatestClosedDesignQualityHistoryStateRef } from './quality-history-closure';
import {
    buildTerminalClosureQualityCache,
    buildDeliveryStageReflexionHandoff,
    describeActionableRequiredEvaluationCheck,
    evaluateNaturalFinalTerminalClosureCheckpoint,
    formatAgentExecutionSummaryText,
    guardTerminalRecoveryEarlyExit,
    inferTerminalReflexionTargetStage,
    projectTerminalClosureContinuationStep,
    projectReflexionHandoffStep,
    projectTerminalClosureStopStep,
    readActionableRequiredEvaluationCheckKeys,
    resolveAgentExecutionStatus,
    projectRecoverableTerminalClosureGap,
    reuseTerminalClosureQualityIfCurrent as reuseCachedTerminalClosureQuality,
    stopPreparedTerminalClosure,
    projectTerminalClosureRuntimeBoundary,
    resolveTerminalClosureStagePreparation,
    type AgentDeliveryStageEvidence, type AgentRunResultInput,
    type AgentTerminalClosureCheckpoint, type AgentTerminalClosureGap,
    type AgentTerminalClosureQualityCache,
    type PreparedAgentTerminalClosure
} from './terminal-closure-checkpoint';
import { guardRuntimeInteractiveReentryResult } from './runtime-interactive-reentry-result-guard';
import { normalizeAgentToolFailureResult } from './tool-failure-result-normalizer';
import type { ProviderNativeToolRequest } from '../../../shared/provider-native-tools';
import {
    buildPrimaryVisualObservationReviewInstruction,
    buildVisualExpertReviewBatchPrompt,
    clearProducerVisualRuntimeAnnotations,
    deriveAgentVisualObservationReceipt,
    hasAgentVisualDeliveryObservationCoverage,
    parseVisualExpertReviewBatch,
    reconcilePrimaryVisualObservationReviews,
    readAgentVisualObservation,
    readAgentVisualObservationReceipt,
    readAgentVisualObservations,
    resolveAgentVisualDeliveryReviewStatus,
    resolveVisualObservationStrategy,
    writeAgentVisualObservationOverflow,
    writeAgentVisualObservation,
    writeAgentVisualObservationPresentationDigest,
    writeAgentVisualObservationReceipt,
    VISUAL_EXPERT_INPUT_PROMPT,
    type AgentVisualObservation
} from './visual-observation-strategy';
import { buildCompletedReflexionWriteFreshnessBlock } from './reflexion-write-freshness';
import { buildAgentIterationFailureMessage, rethrowKnownModelProviderFailure } from './model-provider-failure-boundary';
import {
    buildAgentIntentControlPlaneDecision,
    isConfirmedToolRequiredIntent,
    type AgentIntentControlPlaneDecision
} from '../../../shared/agent-intent-control-plane';
import { buildAgentContextCapacityPlan } from '../../../shared/agent-context-allocation';
import { estimateToolSchemaTokens } from '../../../shared/context-window-usage';
import {
    canObservationEnterThinkingSteps,
    classifyAgentObservationChannel
} from '../../../shared/agent-observation-channels';
import {
    buildChatComposerReferenceMarker,
    normalizeChatComposerContentParts
} from '../../../shared/chat-composer-content';
import {
    requiresAgentTaskDeliveryProgress,
    requiresAgentTaskProgress,
    resolveAgentTaskProgressObligation
} from '../../../shared/agent-task-planning-contract';
import { projectAgentFinalOutcomeSignals } from '../../../shared/agent-final-outcome-signals';
import { buildAgentOperationLedger } from '../../../shared/agent-operation-ledger';
import {
    capabilityBlocksExecution,
    resolveDeclaredCapabilityVerdict
} from '../../../shared/model-capability-verdict';
import {
    AGENT_MODEL_REQUEST_TIMEOUT_MS,
    AGENT_GLOBAL_SKILL_BUDGET_LIMITS,
    buildDesignTeamChildExecutionReservation,
    buildDesignTeamSingleRoleExecutionReservation,
    resolveAgentModelCallCostControls,
    type DesignTeamChildExecutionReservation
} from '../../../shared/agent-performance-policy';
import { resolveProviderTruncationMaxTokens } from '../../../shared/agent-provider-truncation-recovery';
import {
    buildAgentTaskPlanPresentation,
    buildAgentTaskPlanPresentationFromStagePlan,
    type AgentTaskPlanPresentation
} from '../../../shared/agent-task-plan-presentation';
import {
    buildAgentToolDecisionContract,
    formatAgentToolDecisionContractBlocker,
    isAgentToolVisibleForIntentDecision,
    type AgentToolDecisionContract
} from '../../../shared/agent-tool-decision-contract';
import { buildAgentToolPreflightUserProcess } from '../../../shared/agent-user-visible-state';
import {
    buildAgentToolExecutionPreflight,
    classifyAgentToolExecution,
    DESIGN_ECHO_TARGET_GUARD_ARGUMENT,
    evaluateRuntimeWriteToolScope,
    isAgentReadCacheInvalidatingContext,
    isAgentHarnessControlTool,
    isAgentInputCollectionTool,
    isAgentPhotoshopDocumentObservation,
    isAgentToolExecutionGuarded,
    isReadOnlyAgentContextTool,
    normalizeExactPropertyReplacementToolCall,
    requiresUserVisiblePreActionRationaleForToolCalls,
    type AgentToolExecutionPreflight
} from '../../../shared/agent-tool-execution-preflight';
import { readRuntimeOwnedSkillDeliveryPlanDigest } from '../../../shared/agent-skill-atomic-tool-execution';
import { createRuntimeDeclarationSiblingTurn } from '../../../shared/runtime-declaration-sibling-policy';
import { classifyRunToolActivity } from '../../../shared/agent-run-record';
import { areEquivalentToolFailureReasons, buildRepeatedToolFailureBlocker, CONSECUTIVE_SAME_TOOL_FAILURE_LIMIT, firstToolFailureReason, hasRepeatedToolFailureExhausted } from './tool-failure-breaker';
import { decideStageIncompleteRecovery } from '../../../shared/agent-stage-incomplete-recovery';
import { buildAgentPreActionDisclosure } from '../../../shared/agent-pre-action-disclosure';
import {
    buildAgentRuntimeProgressKey,
    buildUnfinishedContinuationKey,
    decideAgentRuntimeLiveness,
    isBareAgentCompletionClaim
} from '../../../shared/agent-runtime-liveness-policy';
import {
    AgentReadResultCache,
    buildAgentRevisionScopedReadCacheParams,
    buildCachedReadResult,
    isAgentReadResultCacheHit,
    isCacheableReadTool
} from '../../../shared/agent-read-result-cache';
import { findLatestObservedPhotoshopMutationIndex } from '../../../shared/agent-operation-document-timeline';
import { resolveSkillExecutionOutcome } from '../../../shared/agent-react-observation-contract';
import { getSkillById } from '../../../shared/skills/skill-declarations';
import {
    advanceAgentWorkflowContinuationAfterRepair,
    bindAgentWorkflowContinuationRepairObservation,
    resolveCompactWorkflowOwnerFirst,
    evaluateAgentWorkflowExecuteHandoffFulfillment,
    evaluateAgentWorkflowContinuationToolAccess,
    buildAgentWorkflowContinuationBinding,
    buildRuntimeWorkflowDeliveryReentryOption,
    isDeclaredNonFatalAgentWorkflowHandoff,
    refreshAgentWorkflowContinuationVisualDelivery,
    resolveAgentWorkflowContinuationScopeUpdate,
    retainAgentWorkflowContinuationScope,
    selectAgentWorkflowContinuationToolNames,
    type AgentWorkflowContinuationBinding,
    type AgentWorkflowContinuationScope
} from '../../../shared/agent-workflow-continuation-scope';
import type {
    DesignTeamChildExecutionAllowance,
    DesignTeammateRole
} from '../../../shared/types/design-team.types';
import { evaluateCompletionObservationGate } from '../../../shared/completion-observation-gate';
import {
    buildIncomingReflexionObservationSection,
    buildIncomingReflexionPromptSection,
    isCompletedAestheticImprovementEligible,
    shouldStopWarningOnlyNeedsReviewReflexion
} from '../../../shared/reflexion-reentry-policy';
import {
    bindReflexionHandoffReviewEvidence,
    buildReflexionHandoffFromReviewReport,
    buildRuntimeEvolutionIntake,
    COMPLETED_AESTHETIC_IMPROVEMENT_TRIGGER,
    type ReflexionHandoff
} from '../../../shared/agent-runtime-v5/reflexion-contract';
import type {
    RuntimeDesignWorkMode,
    RuntimeStage
} from '../../../shared/agent-runtime-v5/contracts';
import { deriveDesignTaskCompletion } from '../../../shared/design-task-card';
import {
    compileRuntimeActionExecutionEnvelope,
    type RuntimeActionExecutionEnvelope
} from '../../../shared/agent-runtime-v5/runtime-action-execution-pack';
import {
    appendRuntimeSessionObservation,
    acknowledgeRuntimeSessionWorkflowDocumentReobservation,
    applyRuntimeSessionStageEvaluation,
    beginRuntimeSessionNodeExecution,
    bindRuntimeSessionActionPlan,
    buildRuntimeSessionDigest,
    claimRuntimeSessionDocumentWriter,
    releaseRuntimeTaskRunWriterBinding,
    createRuntimeSession,
    evaluateRuntimeSessionToolExecutionGate,
    finalizeRuntimeSession,
    observeRuntimeSessionDocumentRevision,
    projectRuntimeSessionCompletion,
    readRuntimeSessionPerformanceUsage,
    recordRuntimeSessionNodeResultUnbound,
    recordRuntimeSessionOperationResult,
    recordRuntimeSessionPerformanceUsage,
    reconcileRuntimeSessionDocumentRevision,
    replanRuntimeSessionAfterProviderFailure,
    replanRuntimeSessionAfterProviderHandoff,
    suspendRuntimeSessionForInteraction,
    synchronizeRuntimeSessionActionPlanNodes,
    type RuntimeSession
} from '../../../shared/agent-runtime-v5/runtime-session';
import type {
    RuntimeAccountingDigest,
    RuntimeContextPreparationShape,
    RuntimePerformanceUsage
} from '../../../shared/agent-runtime-v5/runtime-accounting';
import {
    attachArtifactRepositoryProjectionToRuntimeTaskSnapshot,
    buildRuntimeTaskSnapshot as buildRuntimeTaskSnapshotReadModel,
    type ReadableRuntimeTaskSnapshot,
    type RuntimeTaskSnapshot
} from '../../../shared/agent-runtime-v5/runtime-task-snapshot';
import {
    canAttachedImageObservationSatisfyRuntimeR2,
    isRuntimeStageToolVisible,
    resolveRuntimeStagePlanEffectiveContract,
    type RuntimeStagePlanEffectiveContract
} from '../../../shared/agent-runtime-v5/runtime-stage-plan';
import {
    LEGACY_TOOL_CAPABILITY_MAP,
    selectLegacyToolProvidersForCapabilities,
    selectPreferredLegacyToolsForCapabilities
} from '../../../shared/agent-runtime-v5/tool-capability-bridge';
import {
    resolveRuntimeInputExplorationRequest,
    type RuntimeInputExplorationRequest,
    type RuntimeInputObservationToolKind
} from '../../../shared/agent-runtime-v5/runtime-input-exploration';
import type { RuntimePlanningContextSeedDigest } from '../../../shared/agent-runtime-v5/runtime-planning-context-seed';
import {
    buildRuntimeStageTraceDigest,
    type RuntimeStageTrace,
    type RuntimeStageTraceEventInput
} from '../../../shared/agent-runtime-v5/runtime-stage-trace';
import {
    buildDeclareDesignBriefToolSchema,
    buildRuntimeDesignBriefDigest,
    describeRuntimeDesignBriefValidationIssues,
    isDesignBriefControlTool,
    resolveRuntimeDesignBriefInputs,
    validateRuntimeDesignBriefDeclaration,
    type RuntimeDesignBriefDeclaration,
    type RuntimeDesignBriefResolvedInput,
    type RuntimeDesignBriefWorkModeInputContracts
} from '../../../shared/agent-runtime-v5/runtime-design-brief-declaration';
import { buildObservedRuntimeInputSources } from '../../../shared/agent-runtime-v5/runtime-input-observation';
import {
    buildDeclareReferenceBriefToolSchema,
    buildRuntimeReferenceBriefDigest,
    getReferenceRequirement,
    hasRuntimeReferenceVisualObservation,
    isReferenceBriefControlTool,
    isRuntimeReferenceContextResolved,
    isRuntimeReferenceSearchTool,
    isRuntimeReferenceVisualTool,
    normalizeRuntimeReferenceContextObservation,
    validateRuntimeReferenceBriefDeclaration,
    type RuntimeReferenceBriefDeclaration
} from '../../../shared/agent-runtime-v5/runtime-reference-context';
import {
    buildAgentDesignBriefRequiredBlocker,
    buildAgentReferenceContextBlocker,
    buildAgentReferenceSearchBudgetBlocker,
    buildAgentRuntimeReferenceContextState,
    describeRuntimeReferenceStage,
    isFromScratchRuntimeDesignTask,
    isSuccessfulRuntimeToolObservation as isSuccessfulAgentRuntimeToolObservation,
    reconcileAgentReferenceFailureDispositions,
    requiresRuntimeReferenceContextResolution,
    resolveActiveReferencePolicy as resolveAgentActiveReferencePolicy,
    resolveActiveReferenceWorkMode as resolveAgentActiveReferenceWorkMode,
    resolveAgentReferenceFailureDisposition
} from './runtime-reference-adapter';
import {
    buildDeclareDesignStrategyToolSchema,
    buildRuntimeDesignStrategyDigest,
    isDesignStrategyControlTool,
    validateRuntimeDesignStrategyDeclaration,
    type RuntimeDesignStrategyDeclaration
} from '../../../shared/agent-runtime-v5/runtime-design-strategy-declaration';
import { isRuntimeActionPlanControlTool } from '../../../shared/agent-runtime-v5/runtime-action-plan-control';
import {
    DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME,
    isRuntimeActionPlanStepOperationCompatible,
    MAX_RUNTIME_ACTION_PLAN_STEPS,
    type RuntimeActionPlanCapabilityContext,
    type RuntimeActionPlanDeclaration
} from '../../../shared/agent-runtime-v5/runtime-action-plan-declaration';
import {
    filterRuntimeActionPlanCapabilityContext,
    findUnavailableFailedRuntimeActionCapabilities,
    inspectRuntimeActionRepairReadbackContent,
    resolveRuntimeActionMutationReadbackDisposition,
    resolveRuntimeActionProviderFailureDisposition,
    supportsRuntimeActionRepairReadback
} from '../../../shared/agent-runtime-v5/runtime-action-provider-recovery';
import { readRuntimeActionProviderHandoff } from '../../../shared/agent-runtime-v5/runtime-action-provider-handoff';
import {
    appendRuntimeActionPlanExecutionObservation,
    createRuntimeActionPlanExecutionJournal,
    type RuntimeActionPlanExecutionJournal,
    type RuntimeActionPlanExecutionObservation
} from '../../../shared/agent-runtime-v5/runtime-action-plan-observation';
import type { RuntimeActionPlanReconciliation } from '../../../shared/agent-runtime-v5/runtime-action-plan-reconciliation';
import {
    resolveRuntimeExecutionTarget,
    sameRuntimeExecutionDocument,
    type RuntimeExecutionTargetAnchor
} from '../../../shared/agent-runtime-v5/runtime-execution-target';
import { computeFastFingerprint } from '../../../shared/agent-runtime-v5/content-hash';
import {
    projectManifestBoundRuntimeDeliveryReceipt,
    readRuntimeDeliveryProofKinds,
    readRuntimeDeliveryReceipt,
    verifyRuntimeDelivery,
    type RuntimeDeliveryVerification
} from '../../../shared/agent-runtime-v5/runtime-delivery-receipt';
import {
    buildRuntimeContextEnvelope,
    compileRuntimeContext,
    selectRuntimeContextItemsForStage
} from '../../../shared/agent-runtime-v5/runtime-context-compiler';
import type { RuntimeActionPlanNoRedoShadowDecision } from '../../../shared/agent-runtime-v5/runtime-action-plan-no-redo-shadow';
import {
    buildDesignEvaluationProfileDigest,
    evaluateDesignEvaluationProfile,
    getDesignEvaluationProfileById,
    getDesignEvaluationProfileSharedAssertions,
    getDesignEvaluationProfileVlmAssertions,
    type DesignEvaluationProfile,
    type DesignEvaluationProfileDigest,
    type DesignEvaluationProfileResult
} from '../../../shared/agent-runtime-v5/design-evaluation-profiles';
import { adaptDesignEvaluationRecordsFromToolResults } from '../../../shared/agent-runtime-v5/design-evaluation-result-adapters';
import {
    buildRuntimeScopedChangeVerificationRecords,
    buildRuntimeScopedVisualReviewVerificationRecords
} from '../../../shared/agent-runtime-v5/runtime-scoped-change-records';
import {
    alignUserVisibleCompletionMessage, sanitizeUserVisibleAgentText,
    sanitizeUserVisibleDiagnosticText,
    sanitizeUserVisibleThinkingText,
    finalizeUserVisibleThinkingText, synchronizeLastAssistantCompletionMessage
} from '../../../shared/chat-response-cleaner';
import {
    containsDsmlToolCallMarkup,
    parseDsmlToolCallBatch,
    removeDsmlToolCallMarkup
} from '../../../shared/model-tool-call-markup';
import { splitAssistantReplyReasoningPrefix } from '../../../shared/assistant-reply-reasoning-split';
import { ActiveRuntimeAccounting } from './active-runtime-accounting';
import {
    buildProviderOutputFailurePresentation,
    buildProviderOutputContinuationPrompt,
    isProviderOutputTruncated,
    isProviderOutputBlocked,
    ProviderOutputRecoveryController,
    readCompleteProviderTextContent,
    requestWithProviderOutputRecoveryAccounting,
    settleProviderToolResponse
} from './provider-output-recovery';
import { ContextManager } from './context-manager';
import {
    isFinalQualityReviewStopReason,
    projectFinalQualityEvaluationRuntimeFailureOutcome,
    projectFinalQualityRevisionStaleOutcome,
    projectFinalQualityReviewOutcome,
    resolveFinalQualityJudgeModelId,
    runFinalQualityReviewRuntime,
    type PendingTrustedFinalComparisonWrite
} from './final-quality-review-runtime';
import { FINAL_QUALITY_TERMINAL_RESERVE_MS } from './final-quality-model-protocol';
import {
    AGENT_REPLY_OUTPUT_DISCIPLINE_PROMPT,
    AGENT_RUNTIME_MESSAGE_BOUNDARY_PROMPT,
    createAssistantHistoryMessage,
    createCurrentUserMessage,
    createHarnessControlMessage,
    createRuntimeObservationMessage,
    prepareAgentMessagesForModel,
    retireDeliveredAgentMessageImages
} from './message-context';
import {
    ModelCallAccountingRuntime,
    projectContextPreparationForAccounting,
    projectCurrentVisualInputForAccounting,
    registerRuntimeVisualPresentationBlock
} from './model-call-accounting';
import { buildTaskCompletionContract, buildTaskRunCreatedDocumentPreflightInput } from './task-completion-contract';
import { projectAgenticFinalDeliveryStageEvidence } from './agentic-final-delivery-evidence';
import {
    buildSummaryFromStatefulWrites as buildSummaryFromStatefulWritesFromModule,
    buildToolResultFallbackMessage as buildToolResultFallbackMessageFromModule,
    readOutputPathFromToolResult as readOutputPathFromToolResultFromModule,
    shouldRequestRicherFinalSummary as shouldRequestRicherFinalSummaryFromModule
} from './final-summary';
import {
    MAX_HARNESS_QUALITY_VERIFICATION_CALLS,
    applyPerformanceModelBudgetClassAllowance,
    buildPerformanceBudgetExhaustionMessage as buildPerformanceBudgetExhaustionMessageFromLedger,
    consumeHarnessQualityVerificationCallBudget as consumeHarnessQualityVerificationCallBudgetFromLedger,
    consumePerformanceModelCallUsage,
    consumePerformanceToolCallBudget as consumePerformanceToolCallBudgetFromLedger,
    createPerformanceLedgerState,
    isInMutationExecutionReserveZone as isInMutationExecutionReserveZoneFromLedger,
    projectPerformanceLedgerUsage,
    readPerformanceActiveElapsedMs as readPerformanceActiveElapsedMsFromLedger,
    readPerformanceBudgetExhaustion as readPerformanceBudgetExhaustionFromLedger,
    readPerformanceModelBudgetClassViolation,
    resetPerformanceLedgerStateForRun,
    shouldIssuePerformanceBudgetDisciplineDirective,
    restorePerformanceLedgerUsage,
    resolveRunLevelVisualPresentationCapacity,
    resolveExecutionSupplyReserve as resolveExecutionSupplyReserveFromLedger,
    takeObservationReserveAdvice as takeObservationReserveAdviceFromLedger,
    type PerformanceBudgetExhaustion,
    type PerformanceLedgerState,
    type PerformanceModelBudgetClass
} from './performance-ledger';
import { describeIncompletePerformanceBudgetStop, settlePerformanceBudgetTerminal } from './performance-budget-terminal-settlement';
import {
    resolvePerformanceVisionBudgetSnapshot,
    resolvePerformanceVisionCallCapacity as resolvePerformanceVisionCallCapacityFromPolicy,
    type PerformanceVisionBudgetSnapshot
} from './performance-vision-policy';
import {
    VISION_DEGRADED_CANDIDATE_ALLOWANCE,
    VISION_THUMBNAIL_MAX_EDGE,
    downscaleImageDataForVision
} from './vision-thumbnail';
import {
    buildDesignTaskContractRemediationDirective,
    buildObservedDesignDraftSummary
} from '../agent-policies/design-task-policy';
import {
    buildToolResultImageFromVisualObservationItem,
    compactPostWriteImagePayloadForRuntimeLog,
    collectImagesFromToolResult,
    projectSkillWorkflowOutputForModel,
    sanitizeToolOutputForModel,
    extractImageFromToolResult,
    extractImagesFromToolResult
} from './tool-result-sanitizer';
import type { ToolResultImage } from './tool-result-sanitizer';
import {
    attachRuntimeInteractiveCheckpointState, reconcileRuntimeSkillEffectBeforeAgentAction,
    releaseRuntimeSessionWriterAfterAgentFinalization,
    resolveRuntimeInteractiveAgentReentryState
} from './runtime-interactive-reentry-adapter';
import {
    buildRuntimePlanningContextPrompt,
    resolveRuntimePlanningContextSeedState
} from './runtime-planning-context-adapter';
import { partitionToolCallsForParallelExecution } from '../../../shared/agent-parallel-execution-policy';
import { buildTaskClosureCapabilityDirective, TaskClosureCapabilityRuntime } from './task-closure-capability-runtime';
import {
    attachRuntimeTaskRunBindingToPendingContinuation,
    findPendingInteractiveContinuation,
    resolvePendingInteractiveContinuationPauseRevision,
    type PendingInteractiveContinuation
} from '../../../shared/pending-interactive-continuation';
import { buildInteractiveIntegrityFingerprint } from '../../../shared/interactive-card-contract';
import { isPolicyGateResult } from '../../../shared/tool-safety-policy';
import {
    createPolicyGateRepeatState,
    recordPolicyGateBlockRound,
    type PolicyGateRepeatState
} from '../../../shared/policy-gate-repeat-guard';
import { normalizePhotoshopToolArguments } from '../../../shared/photoshop-tool-parameter-normalizer';
import {
    readPhotoshopOperationResult,
    requiresPhotoshopOperationReadback
} from '../../../shared/photoshop-operation-result';
import {
    getModelById
} from '../../../shared/config/models.config';
import {
    extractDesignSurfaceSnapshotFromToolResults,
    extractFreshDesignSurfaceSnapshotFromToolResults
} from '../../../shared/design-surface-snapshot-normalizer';
import {
    isFullSurfaceVisualJudgeObservationEntry,
    resolveDirectVisionCandidateCharge,
    resolveDesignReviewSetItemForDiagnosis,
    selectDesignReviewSetForFinalJudge
} from '../../../shared/design-visual-judge-observation';
import {
    buildDesignReviewSetFromBundle,
    buildDesignReviewSetFromSingleSurface,
    inspectVisualObservationBundles,
    type DesignReviewSet,
    type VisualObservationReceipt
} from '../../../shared/visual-observation-bundle';
import {
    findObservedPhotoshopMutationProof,
    readPhotoshopHistoryStateRef,
    readPhotoshopSourceHistoryStateRef,
    samePhotoshopHistoryStateRef,
    type PhotoshopHistoryStateRef
} from '../../../shared/photoshop-history-state-ref';
import { extractDesignQualityMeasurements } from '../../../shared/design-quality-measurement';
import {
    evaluateDeterministicAssertions,
    scoreDesignAssertions,
    getVlmJudgeAssertions,
    isReliableVlmJudgeBatchComplete,
    isActionableReliableVlmDiagnosisResult,
    buildDesignReflexionConstraints
} from '../../../shared/design-quality-assertion';
import { buildDesignQualityReflexionIssues } from '../../../shared/design-quality-reflexion';
import type {
    DesignAssertion,
    DesignAssertionResult,
    DesignScorecard, FinalQualityModelProtocolDigest
} from '../../../shared/design-quality-assertion';
import {
    buildDesignVerdict,
    isDesignVerdictDeliverable,
    type DesignVerdict
} from '../../../shared/design-quality-verdict-bundle';
import { getToolDisplayInfo } from '../tool-display-info';
import { isAgentCapabilityControlTool, isAgentCapabilityLoadTool } from './capability-session';
import {
    projectFinalSupportingSourceCarryover, reconcileDesignFinalReviewStructureVerificationRecords,
} from './design-final-review-evidence';
import {
    writeDesignFinalComparisonPresentationReplay
} from './design-final-comparison-evidence';
import {
    appendMutationBoundDesignIntent,
    type MutationBoundDesignIntent
} from './mutation-bound-design-intent';
import {
    readTrustedVisualReviewArtifact,
    writeTrustedFinalComparisonEvidenceAfterJudge,
    writeTrustedVisualReviewArtifact
} from './trusted-visual-review-artifact';

interface DesignVisualJudgeReviewSet {
    reviewSet: DesignReviewSet;
    images: ToolResultImage[];
    historyStateRef: PhotoshopHistoryStateRef;
    receipt: VisualObservationReceipt;
    sourceOutput: Record<string, unknown>;
}

interface RuntimeStageNeedsInputRecovery {
    needsInput: boolean;
    stage?: 'R1' | 'R3';
    blockingFields: string[];
    observableToolKinds: RuntimeInputObservationToolKind[];
    observationCapabilityIds: string[];
    photoshopObservationOnly: boolean;
    observationExhausted: boolean;
}

// ── Guard rails (all counters reset at the start of each run) ──
// These constants define when the Agent stops retrying and forces a different path.
// If you add a new guard, keep it in this block and expose a counter in the Guard state section.

// When remaining iterations drop to this threshold, inject a finalization nudge.
const FINALIZATION_NUDGE_REMAINING_ITERATIONS = 3;
// Same tool batch repeated this many times -> stop (model is stuck in a loop).
const REPEATED_TOOL_BATCH_LIMIT = 3;
// Consecutive rounds where all tools failed -> stop (environment is broken).
const CONSECUTIVE_FAILED_TOOL_ROUND_LIMIT = 3;
// 只调 Harness 控制工具（声明/能力请求）且整轮没有产生新状态的连续轮数上限。
// 控制工具被有意排除出普通失败会计（成功不算进展、失败不算工具失败），
// 但反向漏洞此前没堵：失败的声明，或 success=true 的幂等 no-op（例如重复请求已激活能力），
// 都能让运行烧到预算耗尽。真实首次激活会改变 schema，不属于 no-progress。
const CONSECUTIVE_CONTROL_TOOL_NO_PROGRESS_ROUND_LIMIT = 3;
// Tool preflight rejected; allow this many replan attempts before forcing continuation.
const MAX_TOOL_PREFLIGHT_REPLAN_ATTEMPTS = 3;
// 未完成任务返回纯文字时，按“连续无动作”而非全局迭代号给予有界续跑机会。
const MAX_UNFINISHED_TURN_CONTINUATION_ATTEMPTS = 2;
// Runtime 阶段连续调用不能推进 owner 时，下一轮收敛到最小阶段动作。
// E1 使用 Manifest 的 workflow owner / capability provider，不读取任务品类。
const RUNTIME_CONTROL_STAGE_STALL_LIMIT = 2;
// Contract not satisfied; allow this many remediation nudges before allowing early stop.
const MAX_CONTRACT_REMEDIATION_ATTEMPTS = 2;
const MAX_HARNESS_CONTROL_REPAIR_ATTEMPTS = 3;
// Runtime 身份声明只有一个正确 Profile 形状；给一次精确修正机会，禁止在 plan-neutral
// 启动预算里反复猜 taskType × workMode。
const MAX_RUNTIME_DESIGN_INTENT_REPAIR_ATTEMPTS = 1;
const MAX_LIVENESS_RECOVERY_ATTEMPTS_PER_PROGRESS_KEY = 2;
const MAX_RUNTIME_ACTION_PLAN_PROVIDER_REPLAN_ATTEMPTS = 2;
// 同一个输入缺口只允许有限的环境探索；超过预算后必须转为用户确认，不能循环读取。
const MAX_RUNTIME_INPUT_OBSERVATION_CALLS = 8;
// E1 是执行阶段，不是无限探索阶段。新事实最多获得两次进展信用；之后只有目标/版本、
// 计划节点、真实操作或阶段结果改变，才能继续刷新活性预算。
const MAX_RUNTIME_STAGE_NOVEL_FACT_PROGRESS_CREDITS = 2;
// 每轮只公开少量同 Capability 替代 provider，避免把完整 Tool inventory 倾倒给模型。
const MAX_RUNTIME_INPUT_OBSERVATION_PROVIDERS_PER_TURN = 4;
const MAX_RUNTIME_INPUT_OBSERVATION_CALLS_PER_PROVIDER = 2;

/** Provider 明确声明 unsupported 才禁止视觉；未声明能力时允许真实调用返回准确错误。 */
function canAttemptModelVision(model: { supportsVision?: boolean } | undefined): boolean {
    if (!model) return false;
    return !capabilityBlocksExecution(resolveDeclaredCapabilityVerdict({
        declared: model.supportsVision,
        subjectLabel: '当前模型'
    }, '读图'));
}

/**
 * 为阶段停滞判断提取“是否发现了新事实”的内存指纹。
 *
 * 不把调用次数当进展，也不保存原始名称/路径/内容；只投影有界的结构事实并对
 * 标识字符串先做不可逆快速指纹。两个不同查询若仍返回同一份或空结果，不会反复
 * 获得进展信用；确实发现不同资源、文档或尺寸时则允许 Agent 继续探索。
 */
function buildRuntimeNovelFactFingerprint(result: unknown): string | undefined {
    if (!result
        || typeof result !== 'object'
        || (result as any)?.success === false
        || isAgentReadResultCacheHit(result)) {
        return undefined;
    }
    const facts: string[] = [];
    let visitedNodeCount = 0;
    const materialKeyPattern = /^(?:id|ids|name|names|title|label|type|kind|count|width|height|size|format|mime|exists|found|available|ready|documents?|document_(?:id|ids|name|names)|layers?|layer_(?:id|ids|name|names)|files?|file_(?:id|ids|name|names)|resources?|resource_(?:id|ids|name|names)|assets?|asset_(?:id|ids|name|names))$/i;
    const narrativeKeyPattern = /(?:base64|imageData|binary|bytes|content|text|message|error|summary|description|prompt|payload)/i;
    const pathLikeKeyPattern = /(?:path|url|uri|directory|folder)/i;
    const volatileKeyPattern = /(?:^|_)(?:request|trace|event|call|session|timestamp|duration|elapsed|nonce|token)(?:$|_)/i;

    function normalizeFactKey(key: string): string {
        return String(key || '')
            .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
            .replace(/[^A-Za-z0-9_]+/g, '_')
            .toLowerCase();
    }

    function isMaterialFactKey(key: string): boolean {
        const normalizedKey = normalizeFactKey(key);
        return !volatileKeyPattern.test(normalizedKey) && materialKeyPattern.test(normalizedKey);
    }

    function appendOpaqueFact(key: string, value: string): void {
        const normalized = value.replace(/\s+/g, ' ').trim();
        if (!normalized) return;
        facts.push(`${key}=opaque:${computeFastFingerprint(normalized.slice(0, 512))}`);
    }

    function visit(value: unknown, key: string, depth: number): void {
        if (depth > 6 || visitedNodeCount >= 192 || facts.length >= 160) return;
        if (Array.isArray(value)) {
            visitedNodeCount += 1;
            if (value.length > 0 && isMaterialFactKey(key)) {
                facts.push(`${key}.length=${Math.min(value.length, 10000)}`);
            }
            for (const item of value.slice(0, 24)) {
                visit(item, `${key}[]`, depth + 1);
            }
            return;
        }
        if (value && typeof value === 'object') {
            visitedNodeCount += 1;
            for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>).slice(0, 64)) {
                if (narrativeKeyPattern.test(childKey)
                    || volatileKeyPattern.test(normalizeFactKey(childKey))) {
                    continue;
                }
                visit(childValue, childKey, depth + 1);
            }
            return;
        }
        if (typeof value === 'number') {
            if (Number.isFinite(value) && value > 0 && isMaterialFactKey(key)) {
                facts.push(`${key}=${Math.round(value * 1000) / 1000}`);
            }
            return;
        }
        if (typeof value === 'boolean') {
            if (value && isMaterialFactKey(key)) facts.push(`${key}=true`);
            return;
        }
        if (typeof value !== 'string') return;
        if (narrativeKeyPattern.test(key)) return;
        if (pathLikeKeyPattern.test(key) || isMaterialFactKey(key)) {
            appendOpaqueFact(key, value);
        }
    }

    visit(result, 'result', 0);
    if (facts.length === 0) return undefined;
    // 工具名只是证据来源，不是事实身份。同一文档事实经不同读取工具返回时，
    // 不能重复获得“新进展”信用。
    return computeFastFingerprint({ facts: facts.slice().sort() });
}

type RuntimeActionPlanModule = typeof import('../../../shared/agent-runtime-v5/runtime-action-plan-declaration');
const AGENT_AUXILIARY_MODEL_TIMEOUT_MS = 90_000;
const AGENT_FINAL_SUMMARY_TIMEOUT_MS = 90_000;
// Six related screens per visual call keeps a 30-screen detail page to five review calls
// while preserving per-screen observation keys and structured decisions.
const MAX_VISUAL_EXPERT_BATCH_IMAGES = 6;
// Same tool name failing consecutively -> block that specific tool at the shared breaker limit.
const PUBLIC_TOOL_PRECHECK_BLOCKED_MESSAGE = '当前条件还不够完整；本轮不会改动画面。';

interface ToolImageObservationSource {
    sourceId?: string | number;
    sourceName?: string;
    resultPath?: string;
    sourceKind?: string;
    observationIdentity?: AgentVisualObservation['observationIdentity'];
    observationKey?: string;
}

interface VisualExpertToolImageCandidate {
    output: any;
    image: ToolResultImage;
    toolName: string;
    observationSource: ToolImageObservationSource;
}

interface PendingRuntimeActionMutationReadback {
    kind?: 'mutation_proof' | 'operation_unknown';
    failedProviderName: string;
    failedStepId: string;
    mutationObservationSequence: number;
    target: RuntimeExecutionTargetAnchor;
    mutationAfter?: PhotoshopHistoryStateRef;
    /** Host 返回 unknown 时保留操作前版本；同文档读回仍等于 before 才能确定本次写入未生效。 */
    operationBefore?: PhotoshopHistoryStateRef;
    toolActionCompleted?: boolean;
    operationId?: string;
    /** operation_unknown 的通用读回次数；只控制恢复活性，不授予 mutation 完成信用。 */
    genericReadbackAttemptCount?: number;
    /** 已尝试的通用读回 provider；下一轮优先换一个观察面。 */
    genericReadbackToolNames?: string[];
    /** 有界通用读回已耗尽，但仍不足以证明 operation-specific 后置条件。 */
    genericReadbackExhausted?: boolean;
}

const MAX_OPERATION_UNKNOWN_GENERIC_READBACK_ATTEMPTS = 2;

const LAYER_ID_TARGET_RESOLUTION_TOOLS = new Set([
    'createClippingMask',
    'releaseClippingMask',
    'getClippingMaskInfo'
]);

const EXPLICIT_LAYER_TARGET_HINTS: Array<{
    producerTool: string;
    label: string;
    patterns: RegExp[];
}> = [
    {
        producerTool: 'addBrightnessContrastAdjustment',
        label: '亮度/对比度调整层',
        patterns: [/亮度\s*\/\s*对比度调整层/u, /亮度.{0,4}对比度调整/u, /Agent\s*BC/i]
    },
    {
        producerTool: 'addHueSaturationAdjustment',
        label: '色相/饱和度调整层',
        patterns: [/色相\s*\/\s*饱和度调整层/u, /色相.{0,4}饱和度调整/u, /Agent\s*HueSat/i]
    },
    {
        producerTool: 'addLevelsAdjustment',
        label: '色阶调整层',
        patterns: [/色阶调整层/u, /Agent\s*Levels/i]
    },
    {
        producerTool: 'addColorBalanceAdjustment',
        label: '色彩平衡调整层',
        patterns: [/色彩平衡调整层/u, /Agent\s*ColorBalance/i]
    },
    {
        producerTool: 'addVibranceAdjustment',
        label: '自然饱和度调整层',
        patterns: [/自然饱和度调整层/u, /Agent\s*Vibrance/i]
    },
    {
        producerTool: 'addPhotoFilterAdjustment',
        label: '照片滤镜调整层',
        patterns: [/照片滤镜调整层/u, /Agent\s*PhotoFilter/i]
    }
];

function stableStringify(value: any): string {
    if (value === null || typeof value !== 'object') {
        const serialized = JSON.stringify(value);
        return serialized === undefined ? 'undefined' : serialized;
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
        .join(',')}}`;
}

function buildToolBatchSignature(toolCalls: ToolCall[]): string {
    return toolCalls
        .filter((call) => !isAgentHarnessControlTool(call.name))
        .map((call) => `${call.name}:${stableStringify(call.arguments || {})}`)
        .join('|');
}

/**
 * Harness 控制工具可以成功处理请求，但没有改变任何运行状态。
 * 该信号必须来自执行器的结构化标记，不能从成功文案反推。
 */
function isIdempotentHarnessControlNoOpResult(value: unknown): boolean {
    if (value == null || typeof value !== 'object') return false;
    const data = (value as { data?: unknown }).data;
    if (data == null || typeof data !== 'object') return false;
    return (data as {
        idempotentNoOp?: unknown;
        noOpCode?: unknown;
    }).idempotentNoOp === true
        && String((data as { noOpCode?: unknown }).noOpCode || '').trim().length > 0;
}

function compactError(value: any): string {
    if (!value) return '';

    const success = value?.success !== false;
    const raw = success
        ? value?.error || value?.errorDetails?.message || value?.details?.error || ''
        : value?.error || value?.errorDetails?.message || value?.details?.error || value?.message || value?.details || '';
    let text = String(raw || '');
    // Strip internal error identifiers like "createDocument_result_mismatch:" prefix
    text = text.replace(/^[a-z][a-z0-9_]+(?=:\s)/gi, '').trim();
    return sanitizeUserVisibleDiagnosticText(text).slice(0, 240);
}

function summarizeToolArguments(args: any): string {
    if (!args || typeof args !== 'object') return '';
    const keys = Object.keys(args).filter((key) => !/api|key|token|secret|password/i.test(key));
    if (keys.length === 0) return '';
    return '已准备必要信息';
}

function stripPrivateTargetGuardArgument(args: any): Record<string, any> {
    const originalArguments = args && typeof args === 'object' ? args : {};
    const {
        [DESIGN_ECHO_TARGET_GUARD_ARGUMENT]: _untrustedModelGuard,
        ...businessArguments
    } = originalArguments;
    return businessArguments;
}
function buildPrivateTargetGuardExecutionArguments(
    call: ToolCall,
    preflight?: AgentToolExecutionPreflight
): Record<string, any> {
    const originalArguments = call.arguments && typeof call.arguments === 'object' ? call.arguments : {};
    const executionArguments = bindCanvasSnapshotExpectedDocumentId(call, stripPrivateTargetGuardArgument(originalArguments), preflight);
    // 该字段只由 Harness 根据 preflight 已读取状态签发。无论模型把它塞进写调用还是
    // 只读调用，都先剥离；只对 guarded + ready + 稳定目标重新注入可信副本。
    if (!isAgentToolExecutionGuarded(call.name, executionArguments)) return executionArguments;
    const targetGuard = preflight?.preconditions.targetGuard;
    if (preflight?.status !== 'ready' || preflight.ready !== true || !targetGuard) {
        return executionArguments;
    }

    const hasExplicitLayerId = Number.isSafeInteger(originalArguments.layerId)
        && Number(originalArguments.layerId) > 0;
    return {
        ...executionArguments,
        [DESIGN_ECHO_TARGET_GUARD_ARGUMENT]: {
            expectedDocumentId: targetGuard.expectedDocumentId,
            ...(!hasExplicitLayerId && targetGuard.expectedActiveLayerId !== undefined
                ? { expectedActiveLayerId: targetGuard.expectedActiveLayerId }
                : {}),
            ...(targetGuard.expectedHistoryStateRef
                ? { expectedHistoryStateRef: targetGuard.expectedHistoryStateRef }
                : {}),
            observationTool: targetGuard.observationTool
        }
    };
}

/**
 * User-friendly tool result summary, differentiated by tool type.
 * Replaces the old generic "工具返回成功/失败" with design-relevant descriptions.
 */
function summarizeToolResult(value: any, toolName?: string): string {
    if (value?.success === false) {
        const displayName = toolName ? getToolDisplayInfo(toolName).name : '这一步处理';
        return `${displayName}没有拿到可确认的完成结果。`;
    }

    // Differentiated success descriptions by tool type
    if (value?.success !== false) {
        switch (toolName) {
            case 'createDocument':
                return '已创建文档';
            case 'renderLayout':
                return '已生成当前阶段草稿';
            case 'placeImage':
                return '已置入图片';
            case 'saveDocument':
                return '文档已保存';
            case 'smartSave': return '已建立恢复点';
            case 'quickExport':
            case 'exportGroup':
            case 'exportDetailPageSlices':
            case 'exportMainImageDocuments':
                return '已导出文件';
            case 'createTextLayer':
            case 'setTextContent':
                return '已更新文字';
            case 'setTextStyle': {
                if (value?.outcome === 'unchanged_already_satisfied') {
                    return '目标文字样式原本已经符合要求，没有修改';
                }
                const changedProperties = Array.isArray(value?.changedProperties)
                    ? value.changedProperties.filter((property: unknown) => typeof property === 'string')
                    : [];
                const propertyLabels: Record<string, string> = {
                    fontName: '字体',
                    fontSize: '字号',
                    tracking: '字距',
                    leading: '行距'
                };
                const changedSummary = changedProperties.length > 0
                    ? `（${changedProperties.map((property: string) => propertyLabels[property] || property).join('、')}）`
                    : '';
                if (value?.verification?.status === 'passed') {
                    return `已按要求调整文字样式${changedSummary}，其他文字属性保持不变`;
                }
                return `已调整文字样式${changedSummary}，还需要重新查看文字结果`;
            }
            case 'createRectangle':
            case 'createEllipse':
                return '已创建形状';
            case 'createGroup':
            case 'groupLayers':
                return '已创建图层组';
            case 'createClippingMask':
                return '已创建剪切蒙版';
            case 'releaseClippingMask':
                return '已释放剪切蒙版';
            case 'deleteLayer':
                return '已删除图层';
            case 'duplicateLayer':
                return '已复制图层';
            case 'convertToSmartObject':
                return '已转换为智能对象';
            case 'duplicateSmartObject':
                return '已复制智能对象';
            case 'moveLayer':
            case 'reorderLayer':
            case 'moveLayerToGroup':
                return '已调整图层位置';
            case 'alignLayers':
            case 'distributeLayers':
                return '已对齐图层';
            case 'alignToReference':
                return '已对齐到参考位置';
            case 'transformLayer':
            case 'quickScale':
                return '已变换图层';
            case 'setLayerOpacity':
            case 'setBlendMode':
                return '已调整图层效果';
            case 'addDropShadow':
                return '已添加投影';
            case 'addStroke':
                return '已添加描边';
            case 'clearLayerEffects':
                return '已清除图层效果';
            case 'addGlow':
                return '已添加发光效果';
            case 'addGradientOverlay':
                return '已添加渐变叠加';
            case 'setLayerFill':
                return '已设置图层填充色';
            case 'addBrightnessContrastAdjustment':
                return '已添加亮度/对比度调整';
            case 'addHueSaturationAdjustment':
                return '已添加色相/饱和度调整';
            case 'addLevelsAdjustment':
                return '已添加色阶调整';
            case 'addColorBalanceAdjustment':
                return '已添加色彩平衡调整';
            case 'addVibranceAdjustment':
                return '已添加自然饱和度调整';
            case 'addPhotoFilterAdjustment':
                return '已添加照片滤镜调整';
            case 'renameLayer':
            case 'batchRenameLayers':
                return '已重命名图层';
            case 'getCanvasSnapshot':
            case 'getDocumentSnapshot':
            case 'getAnnotatedSnapshot':
                return '已获取画布截图';
            case 'getDocumentInfo':
                return '已读取文档信息';
            case 'diagnoseState':
                return '已诊断 Photoshop 状态';
            case 'getLayerHierarchy':
                return '已读取图层结构';
            case 'getTextContent':
                return '已读取文字内容';
            case 'getTextStyle':
                return '已读取文字样式';
            case 'getSmartObjectInfo':
                return '已读取智能对象信息';
            case 'getSmartObjectLayers':
                return '已读取智能对象图层信息';
            case 'searchDesignKnowledge':
                return '已检索设计参考';
            case 'getDesignPrinciples':
                return '已读取设计原理';
            case 'declareDesignIntent':
                return '已声明本轮设计意图';
            case 'getDetailPageDesignFramework':
            case 'getMainImageDesignFramework':
                return '已读取设计方法论';
            case 'undo':
                return '已撤销';
            case 'redo':
                return '已重做';
            case 'generateImage':
                return '已生成图片';
            default:
                break;
        }
    }

    const parts: string[] = [];
    parts.push(value?.success === false ? '处理未完成' : '已完成');
    return parts.join('；');
}

function readFailedToolAcceptance(result: any): any | null {
    const acceptance = result?.acceptance || result?.data?.acceptance;
    if (!acceptance || acceptance.enabled === false) return null;
    return acceptance.assertionStatus === 'failed' ? acceptance : null;
}

function makeSyntheticToolResult(
    call: ToolCall,
    error: string,
    code: string,
    extra?: Record<string, unknown>
): ToolResult {
    return {
        callId: call.id,
        success: false,
        output: {
            success: false,
            error,
            code,
            toolName: call.name,
            notExecuted: true,
            ...(extra || {})
        }
    };
}

function normalizeThinkingForUi(value: unknown): string {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/[?？]{3,}/.test(text)) return '';
    if (text.includes(String.fromCodePoint(0xFFFD))) return '';
    if (/^[?？.\s…!！,，:：;；-]+$/.test(text)) return '';
    if (/^\s*[{[]/.test(text)) return '';
    if (isBareAgentCompletionClaim(text)) return '';
    if (/^执行状态：/.test(text)) return '';
    return text.slice(0, 900);
}

/**
 * 收集会阻塞当前执行的确认卡。post_execution_review 表示产物完成后的发布审核，
 * 只展示、不暂停当前运行；其它 interactive-card/v0 缺省仍阻塞执行，避免自动确认。
 */
export function collectPendingInteractiveConfirmationCards(toolResults: ToolResult[]): any[] {
    const cards: any[] = [];
    const definitionById = new Map<string, string>();
    for (const result of toolResults) {
        const output = result?.output as any;
        const skillOutcome = output && typeof output === 'object'
            ? resolveSkillExecutionOutcome(output)
            : undefined;
        // 破坏性动作 HITL 卡（V1-7b）：executor 用 safetyBlock 结果携带待确认卡，且刻意 success:false
        // （破坏性动作尚未执行）。它必须被收集并触发暂停，否则会退回"硬错误 + 模型自补 confirm 重试"旧路。
        // 结构化 awaiting_confirmation 是正常暂停，不能先按兼容 success:false 丢掉卡片。
        if (result?.success === false
            && output?.safetyBlock !== true
            && skillOutcome?.status !== 'awaiting_confirmation') continue;
        // 交互确认卡可能出现在三处，必须全部识别，且与 UI 的读取口径对齐
        // （ChatPanel 读 data.interactiveCards + toolResults[].result.interactiveCards）：
        //   ① 顶层 output.interactiveCards           —— createInteractiveCard 直接产卡；
        //   ② output.data.interactiveCards           —— sku-batch / socks / autonomous 透传的技能结果（卡在这里）；
        //   ③ output.toolResults[].result.interactiveCards —— 技能内部逐工具结果携带的卡。
        // 此前闸门只读 ①，导致技能把待确认卡放在 ② 时闸门漏判、循环不停机，模型继续瞎跑
        // （SKU 出确认卡后仍在文档里建图层组的根因）。
        const nestedDataCards = Array.isArray(output?.data?.interactiveCards)
            ? output.data.interactiveCards
            : [];
        const nestedToolResultCards = Array.isArray(output?.toolResults)
            ? output.toolResults.flatMap((entry: any) =>
                Array.isArray(entry?.result?.interactiveCards) ? entry.result.interactiveCards : [])
            : [];
        const list = [
            ...(Array.isArray(output?.interactiveCards) ? output.interactiveCards : []),
            ...nestedDataCards,
            ...nestedToolResultCards
        ];
        for (const card of list) {
            if (card
                && card.version === 'interactive-card/v0'
                && card.runDisposition !== 'post_execution_review') {
                const id = typeof card.id === 'string' ? card.id : '';
                if (id) {
                    const definitionHash = buildInteractiveIntegrityFingerprint(card);
                    const previousHash = definitionById.get(id);
                    if (definitionById.has(id)) {
                        if (previousHash !== definitionHash) {
                            throw new Error(`检测到相同卡片 ID 的不同定义：${id}；本轮不会选择任一卡片版本。`);
                        }
                        continue;
                    }
                    definitionById.set(id, definitionHash);
                }
                cards.push(card);
            }
        }
    }
    return cards;
}

/**
 * Workflow 明确要求用户动作却没有产出卡片时，不能把 success/needs_decision 当作
 * 已执行，也不能继续重复调用 owner。该判断只读取结构化状态，不从自然语言猜意图。
 */
function toolResultRequestsUserInputWithoutCard(result: ToolResult | undefined): boolean {
    if (!result || collectPendingInteractiveConfirmationCards([result]).length > 0) return false;
    const output = result.output as any;
    if (!output || typeof output !== 'object') return false;
    const data = output.data && typeof output.data === 'object' ? output.data : {};
    const observation = data.agentReActObservation && typeof data.agentReActObservation === 'object'
        ? data.agentReActObservation
        : {};
    const statuses = [
        output.status,
        output.sourceStatus,
        data.status,
        data.sourceStatus,
        observation.status,
        observation.sourceStatus
    ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean);
    const nextAction = String(observation.nextAction || data.nextAction || output.nextAction || '')
        .trim()
        .toLowerCase();
    if (nextAction) {
        return nextAction === 'ask_user';
    }
    return output.requiresUserAction === true
        || data.requiresUserAction === true
        || statuses.some((status) => (
            /(?:confirmation|user_(?:input|selection|action)|decision)/.test(status)
            && /(?:awaiting|pending|required|blocked|needs)/.test(status)
        ));
}

export function collectPendingInteractiveContinuations(
    toolResults: ToolResult[]
): PendingInteractiveContinuation[] {
    const continuations: PendingInteractiveContinuation[] = [];
    const definitionById = new Map<string, string>();
    for (const result of toolResults) {
        const continuation = findPendingInteractiveContinuation(result?.output);
        if (!continuation) continue;
        const definitionHash = buildInteractiveIntegrityFingerprint(continuation);
        const previousHash = definitionById.get(continuation.id);
        if (definitionById.has(continuation.id)) {
            if (previousHash !== definitionHash) {
                throw new Error(
                    `检测到相同 continuation ID 的不同定义：${continuation.id}；本轮不会选择任一执行 owner。`
                );
            }
            continue;
        }
        definitionById.set(continuation.id, definitionHash);
        continuations.push(continuation);
    }
    return continuations;
}

export class Agent {
    private config: AgentConfig;
    private messages: AgentMessage[] = [];
    private iteration = 0;
    private toolCallLog: AgentToolCallLogEntry[] = [];
    /** Skill performance_profile 经 Agent 全局 ceiling 截断后的真实运行会计（单一 owner：performance-ledger）。 */
    private performanceLedger: PerformanceLedgerState = createPerformanceLedgerState();
    /** 本轮唯一生产 Session owner；统一身份、实时 Stage State 与白名单 Trace。 */
    private runtimeSession: RuntimeSession | undefined;
    private readonly runtimeAccounting = new ActiveRuntimeAccounting();
    private readonly modelCallAccounting = new ModelCallAccountingRuntime({
        readRuntimeGeneration: () => this.runtimeSession?.identity.generation
            ?? this.config.runtimeSessionIdentity?.generation,
        readRequestStartedActiveMs: (startedAtMs) => this.performanceLedger.runStartedAtMs > 0
            ? this.readPerformanceActiveElapsedMs(startedAtMs) : undefined,
        readDefaultReasoningEffort: () => this.config.reasoningEffort,
        readThinkingEnabled: () => this.resolveProviderThinkingEnabled(),
        callModel: (...args) => this.callModel(...args),
        readCallModelStream: () => this.config.callModelStream,
        settleResponse: settleProviderToolResponse,
        beginPerformanceModelCall: (...args) => {
            this.beginPerformanceModelCall(...args);
        },
        record: (record) => {
            this.runtimeSession = this.runtimeAccounting.recordModelCall(
                this.runtimeSession,
                record
            );
        },
        onRecordError: (error) => {
            console.warn('[Agent] Runtime Accounting 记录失败，Provider 结果保持不变。', error);
        }
    });
    /** 同一活动 Session 内的 Reflexion 规划上下文承接摘要；完整声明不持久化。 */
    private runtimePlanningContextSeedDigest: RuntimePlanningContextSeedDigest | undefined;
    private finalQualityModelProtocolDigest: FinalQualityModelProtocolDigest | undefined;
    /**
     * Final Judge 已真实返回后才形成的同 run WeakMap 写入意图。它不进入 Run Record；
     * current 保存本代实际 presentation，inherited 只承接已复验的父代 exact presentation。
     */
    private pendingTrustedFinalComparisonWrite: PendingTrustedFinalComparisonWrite | undefined;
    /** 最近一次通过 Harness 校验的模型 R1 Design Brief 声明。 */
    private runtimeDesignBriefDeclaration: RuntimeDesignBriefDeclaration | undefined;
    /** 最近一次通过 Skill reference_policy 与真实视觉观察校验的 R2 Reference Brief。 */
    private runtimeReferenceBriefDeclaration: RuntimeReferenceBriefDeclaration | undefined;
    /** 最近一次通过 Harness 校验的模型 R3 策略声明。 */
    private runtimeDesignStrategyDeclaration: RuntimeDesignStrategyDeclaration | undefined;
    /** 最近一次通过 Harness 校验的模型 R4 动态行动计划；只做影子对账。 */
    private runtimeActionPlanDeclaration: RuntimeActionPlanDeclaration | undefined;
    /** 只记录 ready 计划声明后的 Capability 级执行观察；不含 Tool 名、参数或结果。 */
    private runtimeActionPlanExecutionJournal: RuntimeActionPlanExecutionJournal | undefined;
    /** V0 pack 在真实 E1 派发点编译的有界信封；只活到对应 Tool result 归档。 */
    private runtimeActionExecutionEnvelopeByCallId = new Map<string, RuntimeActionExecutionEnvelope>();
    /** 同一 Runtime Session 内，provider 失败或主动交回后返回 R4 改写计划的有界次数。 */
    private runtimeActionPlanRevisionCount = 0;
    /** 本轮已真实失败的 Action provider；后续 R4 / E1 不再向模型暴露。 */
    private failedRuntimeActionProviderNames = new Set<string>();
    /** 失败 provider 当时承载的 Capability；仅在没有其他存活 provider 时从 R4 移除。 */
    private failedRuntimeActionCapabilityRefs = new Set<string>();
    /** 已主动把同一目标交回原子能力的 workflow owner；本轮不得重复执行，但不计失败。 */
    private handedOffRuntimeActionProviderNames = new Set<string>();
    /** 已交回 owner 当时承载的 Capability；用于从后续 R4 能力面移除已消费入口。 */
    private handedOffRuntimeActionCapabilityRefs = new Set<string>();
    /** 失败结果已经改动 Photoshop 时，先锁定到同文档读回，禁止盲目重放或换 provider。 */
    private pendingRuntimeActionMutationReadback: PendingRuntimeActionMutationReadback | undefined;
    /** 观察到失败后的真实变更后，只有可靠同文档读回或安全返回 R4 才能解除写锁。 */
    private runtimeActionMutationWriteLocked = false;
    /** 非 Runtime 普通 ReAct 批次内的瞬时写锁；只阻止同一模型响应继续盲写。 */
    private currentBatchMutationWriteLocked = false;
    /** Action provider 失败且没有实际可执行的替代能力时，阻止旧计划继续尝试无关写入。 */
    private runtimeActionProviderRecoveryBlocked = false;
    /** 最近一次真实观察到的活动文档匿名锚点；只服务本轮 mutation/readback 对账。 */
    private runtimeExecutionTarget: RuntimeExecutionTargetAnchor | undefined;
    /** 无 R4 的精简 Runtime 在 E1 记录最近一次真实动作目标，供后续同文档读回绑定。 */
    private runtimeDirectExecutionActionTarget: RuntimeExecutionTargetAnchor | undefined;
    /**
     * 精简 Runtime 中，Workflow owner 已声明尚需原子修复时的未闭合义务。
     * 原子写入与同文档读回只证明修复子动作，不得越过 owner 把整个 E1 提前推进到 R5。
     */
    private pendingDirectWorkflowHandoff: {
        workflowToolName: string;
        workflowCallId: string;
        binding: AgentWorkflowContinuationBinding;
        /** 当前 repair epoch 内已经发生的真实原子变更；旧 epoch 的证据不能替代它。 */
        currentEpochMutationCount: number;
        /** owner 已接受当前 repair；若其验收调用又产生变更，只等待 latest exact readback，不再重入 owner。 */
        ownerAccepted: boolean;
        mutationEvidence: Array<{
            target: RuntimeExecutionTargetAnchor;
            after: PhotoshopHistoryStateRef;
            verifiedReadback: boolean;
        }>;
    } | undefined;
    /** R4 schema/validator 只在 R3 ready 后加载，避免所有对话首屏承担大型规划契约。 */
    private runtimeActionPlanModulePromise: Promise<RuntimeActionPlanModule> | undefined;
    private runtimeActionPlanModule: RuntimeActionPlanModule | undefined;
    private currentInputImageCount = 0;
    /** 本轮真正进入主视觉模型或视觉专家的附件数；不得用原始附件总数冒充已观察数量。 */
    private observedInputImageCount = 0;
    /** 用户附件已由主视觉模型或视觉专家真实读取，可作为空文档设计任务的 R2 视觉观察。 */
    private attachedImageObservationAvailable = false;
    /** 主模型视觉附件已进入下一次请求；只有该请求成功返回后才转为可用观察。 */
    private initialImagesPendingPrimaryObservation = false;
    /** 附件或开工画布只需选择一份真实视觉观察推进 R2，避免同一阶段重复转移。 */
    private initialVisualObservationTraceRecorded = false;
    // ── Guard state (reset at the start of each run, see resetGuardState) ──
    /** 本轮由工具产出的视觉候选数；总候选上限由有效 performance profile 控制。 */
    private toolImageObservationCount = 0;
    /**
     * 当前 run 在日志压缩前复制出的最新完整终审像素集合。只在内存中存活，
     * 不进入 Tool log / Project State / RuntimeSession，也不拥有质量结论。
     */
    private latestDesignVisualJudgeBundleReviewSet: DesignVisualJudgeReviewSet | undefined;
    private latestDesignVisualJudgeSingleReviewSet: DesignVisualJudgeReviewSet | undefined;
    private finalQualityReviewedVisualBinding?: FinalQualityReviewedVisualBinding;
    /** 只保留与真实 Photoshop mutation 同回合的公开设计判断，供最终同一 Judge 对照。 */
    private mutationBoundDesignIntents: MutationBoundDesignIntent[] = [];
    /** 已送入主模型下一次请求、等待该请求真正读取的视觉观察。 */
    private pendingPrimaryVisualObservations: AgentVisualObservation[] = [];
    /** 已发给用户看的快照张数（独立于模型观察上限，cap = MAX_USER_SNAPSHOT_IMAGES）。 */
    private userSnapshotEmitCount = 0;
    /** 上一张发给用户的快照签名，用于跳过连续相同的画面，避免刷屏。 */
    private lastUserSnapshotSignature = '';
    /** 自然终稿后的同实例闭合次数；只覆盖终态审计新发现的可恢复事实缺口。 */
    private terminalClosureRecoveryAttempts = 0;
    private readonly taskClosureCapabilityRuntime: TaskClosureCapabilityRuntime;
    /** 上一次未闭合事实；同指纹再次出现即视为没有真实进展，异常早退也保留精确事实。 */
    private lastTerminalClosureGap: AgentTerminalClosureGap | undefined;
    /** E2 补交付期间复用的同 history 质量结论；任何新 mutation / Host 版本变化都会使其失效。 */
    private terminalClosureQualityCache: AgentTerminalClosureQualityCache | undefined;
    /** Contract-remediation nudges injected so far (cap = MAX_CONTRACT_REMEDIATION_ATTEMPTS). */
    private contractRemediationAttempts = 0;
    /** Repeated identical tool-batch count (cap = REPEATED_TOOL_BATCH_LIMIT). */
    private repeatedToolBatchCount = 0;
    /** Consecutive rounds where all tools failed (cap = CONSECUTIVE_FAILED_TOOL_ROUND_LIMIT). */
    private consecutiveFailedToolRounds = 0;
    /** 只调控制工具且整轮无状态变化的连续轮数（cap = CONSECUTIVE_CONTROL_TOOL_NO_PROGRESS_ROUND_LIMIT）。 */
    private consecutiveControlToolNoProgressRounds = 0;
    /** 同一策略门禁在本次 run 内的累计命中，防止“拦截→只读成功→原样重试”绕过普通失败会计。 */
    private policyGateRepeatState: PolicyGateRepeatState = createPolicyGateRepeatState();
    /**
     * 「阶段未完成」判定已推回模型的次数（cap = MAX_STAGE_INCOMPLETE_RECOVERY_ATTEMPTS）。
     * 刻意不因中途有动作而重置：否则模型可以在「做一点事 → 想收尾」之间无限横跳。
     */
    private stageIncompleteRecoveryAttempts = 0;
    /** Per-tool-name consecutive failure count; success clears it (cap = CONSECUTIVE_SAME_TOOL_FAILURE_LIMIT). */
    private consecutiveToolFailuresByName = new Map<string, number>();
    /** 每个工具最近一次失败原因，用于停机时给出可操作的诊断（不存原始载荷）。 */
    private lastToolFailureReasonByName = new Map<string, string>();
    /** 同一 Workflow 非致命交回的次数与交回时的成功写入计数：判定「反复交回却没推进」。 */
    private workflowHandoffRepeatsByName = new Map<string, number>();
    private mutationCountAtLastWorkflowHandoff = new Map<string, number>();
    /** Tool-preflight replan attempts (cap = MAX_TOOL_PREFLIGHT_REPLAN_ATTEMPTS). */
    private toolPreflightReplanAttempts = 0;
    /** Consecutive text-only turns while the TaskPlan or live Runtime Session still requires work. */
    private unfinishedTurnContinuationAttempts = 0;
    private unfinishedTurnContinuationKey = '';
    /** Consecutive Tool rounds that leave a declaration-owned Runtime stage unchanged. */
    private runtimeControlStageStallCount = 0;
    /** 每个 Runtime 阶段本轮已见过的隐私安全事实指纹；只用于区分新发现与重复空转。 */
    private runtimeStageNovelFactFingerprints = new Map<string, Set<string>>();
    /** Invalid R1/R2/R3/R4 declarations get bounded schema-focused repair instead of repeated context reads. */
    private harnessControlRepairAttemptsByName = new Map<string, number>();
    /** 同一稳定进展键下，Liveness Policy 已授予的额外恢复机会；阶段或事实推进后自然换键。 */
    private livenessRecoveryAttemptsByProgressKey = new Map<string, number>();
    private readonly providerOutputRecovery = new ProviderOutputRecoveryController<ToolSchema>();

    // ── Core state ──
    private currentTask = '';
    /** 本轮唯一 Intent Decision；生产入口消费上游签发值，缺失时只在 run() 开始降级推断一次。 */
    private runIntentControlPlaneDecision: AgentIntentControlPlaneDecision | undefined;
    private contextManager: ContextManager;
    private runtimeContextCharacterBudget: number;
    private callModel: CallModelFn;
    private executeTool: ExecuteToolFn;
    private lastToolBatchSignature = '';
    /** 幂等只读结果的运行级缓存：命中不重复执行；写/切档成功即整体失效。 */
    private readonly readResultCache = new AgentReadResultCache();

    /** Photoshop 文档读取必须绑定 TaskRun 已知的 documentId/historyStateId。 */
    private resolveReadResultCacheParams(
        toolName: string,
        args: unknown,
        freshResult?: unknown
    ): unknown | null {
        const binding = this.runtimeSession?.taskRun.documentBinding;
        const freshResultRevision = readPhotoshopHistoryStateRef(freshResult);
        return buildAgentRevisionScopedReadCacheParams({
            args,
            photoshopDocumentObservation: isAgentPhotoshopDocumentObservation(toolName, args),
            ...(binding ? {
                documentBinding: {
                    status: binding.status,
                    expectedRevision: { ...binding.expectedRevision }
                }
            } : {}),
            ...(freshResultRevision ? { freshResultRevision } : {})
        });
    }

    private normalizeToolFailureResult(name: string, result: unknown): unknown {
        return normalizeAgentToolFailureResult(name, result);
    }

    private async executeToolWithDiagnostics(
        name: string,
        args: any,
        options?: { budgetClass?: 'task' | 'harness_quality_verification' }
    ): Promise<any> {
        const result = await this.executeToolWithFailureBreaker(name, args, options);
        return this.normalizeToolFailureResult(name, result);
    }

    private async executeToolWithFailureBreaker(
        name: string,
        args: any,
        options?: { budgetClass?: 'task' | 'harness_quality_verification' }
    ): Promise<any> {
        if (this.config.signal?.aborted) {
            return {
                success: false,
                cancelled: true,
                error: '任务已取消'
            };
        }
        const attemptedToolKind = classifyAgentToolExecution(name, args);
        const workflowContinuationAccess = evaluateAgentWorkflowContinuationToolAccess({
            scope: this.readActiveWorkflowContinuationScope(),
            toolName: name,
            args
        });
        if (!workflowContinuationAccess.allowed
            && options?.budgetClass !== 'harness_quality_verification') {
            return {
                success: false,
                code: workflowContinuationAccess.code,
                policyGate: true,
                blockedTool: name,
                error: workflowContinuationAccess.reason,
                executesPhotoshop: false,
                grantsPermission: false,
                countsAsObservation: false,
                countsAsTaskProgress: false
            };
        }
        const pendingWorkflowHandoff = this.pendingDirectWorkflowHandoff;
        if (pendingWorkflowHandoff
            && name === pendingWorkflowHandoff.workflowToolName
            && !this.isPendingDirectWorkflowOwnerReentryReady()
            && options?.budgetClass !== 'harness_quality_verification') {
            let ownerReentryError = '当前 repair epoch 尚未发生新的真实 Photoshop 变更，不能复用上一轮证据重入 Workflow owner。';
            if (pendingWorkflowHandoff.ownerAccepted) {
                ownerReentryError = 'Workflow owner 已接受当前 repair；其最终 Photoshop 变更只需精确版本读回，不得再次执行 owner。';
            } else if (pendingWorkflowHandoff.currentEpochMutationCount > 0) {
                ownerReentryError = '当前 repair epoch 的最新 Photoshop 变更尚未全部完成精确版本读回，Workflow owner 暂不能重入。';
            }
            return {
                success: false,
                code: 'compact_workflow_repair_owner_reentry_not_ready',
                policyGate: true,
                blockedTool: name,
                error: ownerReentryError,
                executesPhotoshop: false,
                grantsPermission: false,
                countsAsObservation: false,
                countsAsTaskProgress: false
            };
        }
        if (pendingWorkflowHandoff?.ownerAccepted
            && !this.isPendingDirectWorkflowClosureReadbackTool(name, args)
            && options?.budgetClass !== 'harness_quality_verification') {
            return {
                success: false,
                code: 'compact_workflow_repair_closure_readback_only',
                policyGate: true,
                blockedTool: name,
                error: 'Workflow owner 已接受当前 repair；只允许完成最终 Photoshop 版本读回，不能在验收后继续写入或切换到无关动作。',
                executesPhotoshop: false,
                grantsPermission: false,
                countsAsObservation: false,
                countsAsTaskProgress: false
            };
        }
        if ((this.currentBatchMutationWriteLocked
            || this.runtimeActionMutationWriteLocked
            || this.runtimeActionProviderRecoveryBlocked)
            && (attemptedToolKind === 'photoshop_write'
                || attemptedToolKind === 'save_export')) {
            const requiresMutationReadback = this.currentBatchMutationWriteLocked
                || this.runtimeActionMutationWriteLocked;
            const operationSpecificReconciliationRequired =
                this.pendingRuntimeActionMutationReadback?.genericReadbackExhausted === true;
            let blockedCode = 'runtime_action_replacement_provider_unavailable';
            let blockedError = '当前计划的执行能力已经失败，并且没有可用替代能力；为避免执行无关操作，本轮不会继续写入或导出。';
            if (operationSpecificReconciliationRequired) {
                blockedCode = 'photoshop_operation_specific_reconciliation_required';
                blockedError = '已读取当前文档，但无法确认上一个未知写入的具体后置条件；在专用核对能力确认前不会继续写入或导出。';
            } else if (requiresMutationReadback) {
                blockedCode = 'runtime_action_mutation_readback_required';
                blockedError = '上一个动作失败后可能已改变 Photoshop，必须先可靠读取同一文档；在现场状态确认前不会继续写入或导出。';
            }
            return {
                success: false,
                code: blockedCode,
                ...(requiresMutationReadback
                    ? { blockedByRuntimeActionMutationReadback: true }
                    : { blockedByRuntimeActionProviderRecovery: true }),
                policyGate: true,
                blockedTool: name,
                error: blockedError,
                executesPhotoshop: false,
                grantsPermission: false,
                countsAsObservation: false,
                countsAsTaskProgress: false
            };
        }
        const runtimeWriteScope = evaluateRuntimeWriteToolScope({
            toolName: name,
            params: args,
            allowedWriteTools: this.config.runtimeWriteToolAllowlist
        });
        if (!runtimeWriteScope.allowed) {
            return {
                success: false,
                code: runtimeWriteScope.code,
                blockedByApprovedPlanScope: true,
                blockedTool: name,
                allowedWriteTools: runtimeWriteScope.allowedWriteTools,
                error: `操作 ${name} 超出用户已确认计划的写入范围，本轮已阻止执行。`,
                executesPhotoshop: false,
                grantsPermission: false,
                countsAsObservation: false,
                countsAsTaskProgress: false
            };
        }
        // 幂等只读调用命中运行级缓存：直接返回有界克隆，不重复执行、不占工具预算——
        // 消灭"搜索×2/推荐×3"这类零产出重复；写/切档成功时缓存整体失效（见尾部）。
        // Harness 质量闭环读取必须永远是真实读（验的就是 Host 当前状态），不走缓存。
        const requiresFreshMutationReadback = this.runtimeActionMutationWriteLocked
            && isAgentPhotoshopDocumentObservation(name, args)
            && supportsRuntimeActionRepairReadback(
                this.resolveRuntimeCapabilityRefsForTool(name),
                name
            );
        const readCacheParams = this.resolveReadResultCacheParams(name, args);
        if (readCacheParams !== null
            && isCacheableReadTool(name)
            && options?.budgetClass !== 'harness_quality_verification'
            && !requiresFreshMutationReadback) {
            const cached = this.readResultCache.get(name, readCacheParams);
            if (cached) {
                return buildCachedReadResult(cached);
            }
        }
        const isHarnessQualityVerification = options?.budgetClass === 'harness_quality_verification';
        const performanceBudgetBlocker = isHarnessQualityVerification
            ? this.consumeHarnessQualityVerificationCallBudget(name)
            : this.consumePerformanceToolCallBudget(name, args);
        if (performanceBudgetBlocker) return performanceBudgetBlocker;
        if (isDesignBriefControlTool(name)) {
            return this.executeDesignBriefDeclaration(args);
        }
        if (isReferenceBriefControlTool(name)) {
            if (this.requiresReadyDesignBrief() && this.runtimeDesignBriefDeclaration?.readiness !== 'ready') {
                return this.buildDesignBriefRequiredBlocker(name);
            }
            return this.executeReferenceBriefDeclaration(args);
        }
        if (isDesignStrategyControlTool(name)) {
            if (this.requiresReadyDesignBrief() && this.runtimeDesignBriefDeclaration?.readiness !== 'ready') {
                return this.buildDesignBriefRequiredBlocker(name);
            }
            if (this.requiresReferenceContextResolution()
                && !isRuntimeReferenceContextResolved(this.runtimeReferenceBriefDeclaration)) {
                return this.buildReferenceContextBlocker(name);
            }
            return this.executeDesignStrategyDeclaration(args);
        }
        if (isRuntimeActionPlanControlTool(name)) {
            return this.executeRuntimeActionPlanDeclaration(args);
        }
        if (this.requiresReadyDesignBrief()
            && this.runtimeDesignBriefDeclaration?.readiness !== 'ready'
            && !isAgentHarnessControlTool(name)) {
            const kind = classifyAgentToolExecution(name, args);
            if (kind !== 'read_only_observation'
                && kind !== 'knowledge_search'
                && !isAgentInputCollectionTool(name)) {
                return this.buildDesignBriefRequiredBlocker(name);
            }
        }
        if (this.runtimeSession
            && !isAgentHarnessControlTool(name)
            && !isAgentInputCollectionTool(name)) {
            const kind = classifyAgentToolExecution(name, args);
            this.runtimeSession = reconcileRuntimeSkillEffectBeforeAgentAction({ session: this.runtimeSession, reentry: this.config.runtimeInteractiveReentry, toolCallLog: this.toolCallLog, nextToolName: name, nextToolKind: kind, nextToolIsSkill: Boolean(getSkillById(name)), currentModelTurn: this.iteration });
            const runtimeGate = evaluateRuntimeSessionToolExecutionGate({
                session: this.runtimeSession,
                toolName: name,
                toolKind: kind,
                hasOpenDocument: this.config.toolDecisionContext?.hasDocument,
                taskRequiresOpenDocument: !this.isFromScratchDesignTask(),
                workflowOwnerFirst: this.resolveCompactWorkflowOwnerFirst()
            });
            if (!runtimeGate.allowed) {
                let error = '当前 Runtime Session 尚未由通过校验的 R4 计划进入 E1，已阻止状态变更。';
                if (runtimeGate.code === 'runtime_task_run_waiting_user') {
                    error = '任务正在等待绑定的用户交互；普通消息或旧工具调用不能取得写入权限。';
                } else if (runtimeGate.code === 'runtime_task_run_writer_conflict') {
                    error = '当前 Photoshop 文档仍由另一项活动任务持有写入身份；本轮不会启动第二次写入。';
                } else if (runtimeGate.code === 'runtime_task_run_side_effect_unknown') {
                    error = '上一次操作是否修改了 Photoshop 或其他外部状态还无法确定；完成专用对账前，不会继续叠加新写入。';
                } else if (runtimeGate.code === 'runtime_task_run_revision_reobserve_required') {
                    error = 'Photoshop 文档或历史版本已经变化；重新观察并明确决策前，不会自动重放旧写入。';
                } else if (runtimeGate.code === 'runtime_workflow_owner_first') {
                    error = `这类任务由工作流「${getToolDisplayInfo(String(runtimeGate.nextRequiredTool || '')).name}」负责读取来源、准备前置并给出确认；请先调用它，它交接出来的范围内再直接改画面。`;
                }
                return {
                    success: false,
                    code: runtimeGate.code,
                    blockedByRuntimeSession: true,
                    blockedTool: name,
                    ...(runtimeGate.nextRequiredTool ? { nextRequiredTool: runtimeGate.nextRequiredTool, nextRequiredToolOptions: [runtimeGate.nextRequiredTool] } : {}),
                    currentStage: runtimeGate.currentStage,
                    error,
                    executesPhotoshop: false,
                    grantsPermission: false,
                    countsAsObservation: false,
                    countsAsTaskProgress: false
                };
            }
            if (kind === 'photoshop_write') {
                const targetGuard = args?.[DESIGN_ECHO_TARGET_GUARD_ARGUMENT];
                const expectedRevision = readPhotoshopHistoryStateRef({
                    historyStateRef: targetGuard?.expectedHistoryStateRef
                });
                if (expectedRevision) {
                    const writerClaim = claimRuntimeSessionDocumentWriter({
                        session: this.runtimeSession,
                        expectedRevision
                    });
                    this.runtimeSession = writerClaim.session;
                    if (!writerClaim.decision.allowed) {
                        const error = writerClaim.decision.status === 'conflict'
                            ? '另一个 TaskRun 已持有当前 Photoshop 文档的写入身份；本轮不会并发写入。'
                            : '当前写入所依据的 Photoshop 历史版本已失效；重新观察前不会执行或重放。';
                        return {
                            success: false,
                            code: writerClaim.decision.code,
                            blockedByRuntimeSession: true,
                            blockedTool: name,
                            error,
                            executesPhotoshop: false,
                            grantsPermission: false,
                            countsAsObservation: false,
                            countsAsTaskProgress: false
                        };
                    }
                }
            }
        }
        const referenceSearchBudgetBlocker = this.buildReferenceSearchBudgetBlocker(name);
        if (referenceSearchBudgetBlocker) return referenceSearchBudgetBlocker;
        const failures = isHarnessQualityVerification ? 0 : (this.consecutiveToolFailuresByName.get(name) || 0);
        const failureBlocker = buildRepeatedToolFailureBlocker({
            toolName: name, failureCount: failures,
            lastFailureReason: this.lastToolFailureReasonByName.get(name)
        });
        if (failureBlocker) return failureBlocker;
        let result: any;
        try {
            const runtimeDesignBriefEffectiveContract = this.resolveRuntimeDesignBriefEffectiveContract();
            const runtimeDesignBriefRequiredInputKeys = runtimeDesignBriefEffectiveContract?.requiredInputs || [];
            const runtimeDesignBriefDigest = this.runtimeDesignBriefDeclaration
                ? buildRuntimeDesignBriefDigest({
                    declaration: this.runtimeDesignBriefDeclaration,
                    requiredInputKeys: runtimeDesignBriefRequiredInputKeys
                })
                : undefined;
            const runtimeDesignStrategyDigest = this.runtimeDesignStrategyDeclaration
                ? buildRuntimeDesignStrategyDigest(this.runtimeDesignStrategyDeclaration)
                : undefined;
            const runtimeReferenceBriefDigest = this.runtimeReferenceBriefDeclaration
                ? buildRuntimeReferenceBriefDigest({
                    declaration: this.runtimeReferenceBriefDeclaration,
                    context: this.buildReferenceContextState()
                })
                : undefined;
            let runtimeActionPlanDigest;
            if (this.runtimeActionPlanDeclaration && runtimeDesignStrategyDigest) {
                const actionPlanRuntime = await this.loadRuntimeActionPlanModule();
                runtimeActionPlanDigest = actionPlanRuntime.buildRuntimeActionPlanDigest({
                    declaration: this.runtimeActionPlanDeclaration,
                    strategyDigest: runtimeDesignStrategyDigest
                });
            }
            result = await this.executeTool(name, args, {
                runtimeDesignBriefDeclaration: this.runtimeDesignBriefDeclaration,
                runtimeDesignBriefDigest,
                runtimeDesignBriefRequiredInputKeys,
                runtimeReferenceBriefDeclaration: this.runtimeReferenceBriefDeclaration,
                runtimeReferenceBriefDigest,
                runtimeDesignStrategyDeclaration: this.runtimeDesignStrategyDeclaration,
                runtimeDesignStrategyDigest,
                runtimeActionPlanDeclaration: this.runtimeActionPlanDeclaration,
                runtimeActionPlanDigest,
                ...buildRuntimeWorkflowDeliveryReentryOption(this.readActiveWorkflowContinuationScope(), name, args),
                runtimeEvaluationProfile: this.resolveRuntimeEvaluationProfile()
            });
        } catch (e: any) {
            result = {
                success: false,
                code: e?.code || 'tool_execution_exception',
                error: e?.message || `工具「${name}」执行时发生异常，未返回具体原因。`
            };
        }
        if (this.config.signal?.aborted || result?.cancelled === true) {
            return {
                ...(result && typeof result === 'object' ? result : {}),
                success: false,
                cancelled: true,
                error: result?.error || '任务已取消'
            };
        }
        result = guardRuntimeInteractiveReentryResult({
            workflowToolName: name,
            result,
            reentry: this.config.runtimeInteractiveReentry,
            session: this.runtimeSession
        });
        result = this.normalizeToolFailureResult(name, result);
        // 策略否决/安全拦截是控制信号，不是工具执行失败：不计入连续失败熔断，
        // 否则纯策略重定向会把工具熔断（治理审计 2026-07-08，切断"策略否决→熔断"放大链）。
        if (isPolicyGateResult(result)) {
            return result;
        }
        const failedAcceptance = readFailedToolAcceptance(result);
        if (result?.success !== false && failedAcceptance) {
            const summaryText = String(failedAcceptance.summaryText || '').trim();
            result = {
                ...result,
                success: false,
                toolActionCompleted: true,
                acceptanceFailed: true,
                error: summaryText
                    || '操作已经执行，但结果检查未通过；请更换处理方法，不要重复相同动作。'
            };
        }
        result = this.normalizeToolFailureResult(name, result);
        // Harness 的收尾版本复核有独立且更小的调用配额，不得读取、累加或清除
        // 模型业务工具的连续失败状态；否则一次业务读取失败会阻止质量闭环，
        // 而一次 Harness 成功又会意外解除业务熔断。
        if (!isHarnessQualityVerification) {
            const isDeclaredWorkflowHandoff = isDeclaredNonFatalAgentWorkflowHandoff({
                workflowToolName: name,
                output: result
            });
            // 同一 Workflow 反复「非致命交回」而中间没有任何成功写入 = 原地打转（2026-08-18 真机：
            // sku-batch 每次都交回「先读模板再申请写入」，模型读一遍再调，无限循环）。
            // 交回第一次是移交控制权；从第二次起若期间没有推进，就按失败累计并把交回原因记下，
            // 让熔断器停下并把真实原因交给用户，而不是无限重入。
            const repeatedHandoffWithoutProgress = isDeclaredWorkflowHandoff
                && (this.workflowHandoffRepeatsByName.get(name) || 0) >= 1
                && this.mutationCountAtLastWorkflowHandoff.get(name) === this.countSuccessfulMutations();
            if (isDeclaredWorkflowHandoff) {
                this.workflowHandoffRepeatsByName.set(name, (this.workflowHandoffRepeatsByName.get(name) || 0) + 1);
                this.mutationCountAtLastWorkflowHandoff.set(name, this.countSuccessfulMutations());
            }
            if (result?.success === false && (!isDeclaredWorkflowHandoff || repeatedHandoffWithoutProgress)) {
                // 记录最近一次失败原因：停机时要能告诉用户「卡在什么上」，而不是只说"失败了"
                const failureReason = compactError(result);
                this.consecutiveToolFailuresByName.set(name, areEquivalentToolFailureReasons(this.lastToolFailureReasonByName.get(name), failureReason) ? failures + 1 : 1);
                if (failureReason) {
                    this.lastToolFailureReasonByName.set(name, repeatedHandoffWithoutProgress
                        ? `工作流反复交回控制权而没有任何推进（第 ${this.workflowHandoffRepeatsByName.get(name)} 次）：${failureReason}`
                        : failureReason);
                }
            } else {
                // 声明式 nonFatal handoff 是一次有效的控制权移交，不是“同一工具执行失败”。
                // 结果仍保持 success:false，不能取得写入、完成、缓存或质量信用；这里只重置
                // 连续失败熔断，允许 Agent 在完成声明的原子修复后重入同一 Workflow owner。
                this.consecutiveToolFailuresByName.delete(name);
                this.lastToolFailureReasonByName.delete(name);
                // 前提变了就该给一次新机会：真机 2026-08-18 sku-batch 因「文档版本已变化」连败，模型照守卫的话
                // 重新读了文档，熔断器却把它当第 N 次同样的失败永久封死——同一堵墙没有出口。
                // 一次成功的、带版本号的文档读取（getDocumentInfo / 快照）= 守卫要求的「重新观察」已完成，
                // 把此前只因目标守卫（文档 / 版本 / 图层变化）失败的工具计数清零，允许再试一次。
                if (result?.success !== false && readPhotoshopHistoryStateRef(result)) {
                    for (const [failedName, reason] of Array.from(this.lastToolFailureReasonByName.entries())) {
                        if (failedName !== name && /已在执行前中止|目标守卫|文档版本已变化|活动文档已变化|活动图层已变化/.test(reason)) {
                            this.consecutiveToolFailuresByName.delete(failedName);
                            this.lastToolFailureReasonByName.delete(failedName);
                        }
                    }
                }
            }
        }
        // 只读成功结果入运行级缓存（Harness 质量闭环读取除外，它只服务 Host 验证）；
        // 写类/导出/切档成功令缓存整体失效（验收未过的结果已在上面被改写为 success:false，不会误入缓存）。
        if (result?.success !== false) {
            if (isAgentReadCacheInvalidatingContext(name, args)) {
                this.readResultCache.clear();
            } else if (isCacheableReadTool(name)) {
                if (!isHarnessQualityVerification) {
                    const writeCacheParams = this.resolveReadResultCacheParams(name, args, result);
                    if (writeCacheParams !== null) {
                        this.readResultCache.set(name, writeCacheParams, result);
                    }
                }
            } else {
                const resultKind = classifyAgentToolExecution(name, args);
                if (resultKind === 'photoshop_write'
                    || resultKind === 'save_export') {
                    this.readResultCache.clear();
                }
            }
        }
        return result;
    }
    // ── Flow-control flags (non-guard) ──
    private finalizationNudgeSent = false;
    private visibleReasoningSent = false;
    /** 最近一次真实展示给用户的动手前说明；供写入 Preflight 复用，不作为任务事实或完成依据。 */
    private latestVisiblePreActionRationale = '';
    /** Workflow owner 未完成时的跨模型轮次最小能力范围；Stage/Session 改变后自动失效。 */
    private workflowContinuationScope: AgentWorkflowContinuationScope | undefined;
    constructor(
        config: AgentConfig,
        callModel: CallModelFn,
        executeTool: ExecuteToolFn
    ) {
        this.config = config;
        this.callModel = callModel;
        this.executeTool = executeTool;
        this.taskClosureCapabilityRuntime = new TaskClosureCapabilityRuntime(config);
        const contextCapacity = buildAgentContextCapacityPlan({
            windowTokens: config.contextWindowTokens,
            requestedOutputTokens: config.performanceBudget?.maxPrimaryOutputTokens
        });
        this.contextManager = new ContextManager({
            maxTokens: contextCapacity.contextTokenCeiling,
            keepRecentRounds: 6, includeReasoningContent: config.replayProviderReasoningContent === true
        });
        this.runtimeContextCharacterBudget = contextCapacity.runtimeContextCharacterCeiling;
    }
    private hasObservedTaskMutation(): boolean {
        return this.toolCallLog.some((entry) => (
            !isAgentHarnessControlTool(entry.name)
            && Boolean(findObservedPhotoshopMutationProof(entry.result))
        ));
    }

    /** 已观测到的成功写入次数：用来判断「工作流反复交回之间有没有推进」。 */
    private countSuccessfulMutations(): number {
        let count = 0;
        for (const entry of this.toolCallLog) {
            if (!isAgentHarnessControlTool(entry.name) && findObservedPhotoshopMutationProof(entry.result)) count += 1;
        }
        return count;
    }

    private buildPerformanceBudgetExhaustionMessage(
        dimension: 'model_calls' | 'tool_calls' | 'soft_time',
        limit: number,
        used: number
    ): string {
        return buildPerformanceBudgetExhaustionMessageFromLedger(
            deriveAgentUserResultFacts(this.toolCallLog).hasViewableDesignChange,
            dimension,
            limit,
            used
        );
    }

    private readPerformanceBudgetExhaustion(
        scope: 'all' | 'model' | 'tool' = 'all',
        budgetClass: PerformanceModelBudgetClass = 'task'
    ): PerformanceBudgetExhaustion | undefined {
        const budget = this.config.performanceBudget;
        if (!budget) return undefined;
        const exhaustion = readPerformanceBudgetExhaustionFromLedger({
            ledger: this.performanceLedger,
            budget,
            elapsedMs: this.readPerformanceActiveElapsedMs(),
            scope,
            hasViewableDesignChange: deriveAgentUserResultFacts(this.toolCallLog).hasViewableDesignChange
        });
        return applyPerformanceModelBudgetClassAllowance(
            this.performanceLedger,
            budgetClass,
            exhaustion
        );
    }

    private resolvePerformanceVisionBudget(): PerformanceVisionBudgetSnapshot {
        const requiresMultiSurface = this.resolveFinalReviewSetRequirements(
            this.resolveRuntimeEvaluationProfile()
        ).requireMultiSurface;
        return resolvePerformanceVisionBudgetSnapshot({
            ledger: this.performanceLedger,
            budget: this.config.performanceBudget,
            defaultMaxVisionCandidates: Agent.DEFAULT_MAX_VISION_CANDIDATES,
            requiresMultiSurface,
            reviewSet: this.findLatestDesignVisualJudgeReviewSet(requiresMultiSurface)?.reviewSet,
            visualAnalysisAlreadyPending: this.initialImagesPendingPrimaryObservation
                || this.pendingPrimaryVisualObservations.length > 0
        });
    }

    private getPerformanceVisionCandidateLimit(): number {
        return this.resolvePerformanceVisionBudget().candidateLimit;
    }

    private getPerformanceInitialVisionCandidateLimit(): number {
        return this.resolvePerformanceVisionBudget().initialCandidateLimit;
    }

    private resolvePerformanceVisionCallCapacity(
        visualAnalysis: boolean,
        budgetClass: PerformanceModelBudgetClass
    ): { hasFixedEventCapacity: boolean; remainingCandidateCount: number } {
        return resolvePerformanceVisionCallCapacityFromPolicy({
            ledger: this.performanceLedger,
            snapshot: this.resolvePerformanceVisionBudget(),
            visualAnalysis,
            budgetClass
        });
    }

    private hasPerformanceVisualAnalysisCapacity(
        budgetClass: PerformanceModelBudgetClass = 'task'
    ): boolean {
        const configured = this.config.performanceBudget?.maxVisualAnalyses;
        return typeof configured !== 'number'
            || !Number.isFinite(configured)
            || this.resolvePerformanceVisionCallCapacity(true, budgetClass).hasFixedEventCapacity;
    }

    private canQueuePrimaryVisualPresentation(): boolean {
        return this.resolvePerformanceVisionBudget().canQueuePrimaryVisualPresentation;
    }

    private synchronizeRuntimePerformanceUsage(): void {
        this.runtimeSession = this.runtimeAccounting.synchronizePerformanceUsage(
            this.runtimeSession,
            this.readRequestPerformanceUsageSnapshot()
        );
    }

    /**
     * 当前请求性能账本的只读、可序列化投影。plan-neutral Reflexion 用它把同一 TaskRun
     * 的已消费额度带到下一 Agent 实例；不暴露内部 Set，不携带权限或质量状态。
     */
    readRequestPerformanceUsageSnapshot(): RuntimePerformanceUsage {
        return projectPerformanceLedgerUsage(this.performanceLedger, this.iteration);
    }

    readRuntimeAccountingDigest(): RuntimeAccountingDigest | undefined {
        return this.runtimeAccounting.readDigest(this.runtimeSession);
    }

    private readPerformanceActiveElapsedMs(nowMs = Date.now()): number {
        return readPerformanceActiveElapsedMsFromLedger(this.performanceLedger, nowMs);
    }

    /** 收敛指标「首次成功写入延迟」的时序来源；账本未启动（run 外调用）时返回 undefined，不做推断。 */
    private readRunElapsedMsOrUndefined(nowMs = Date.now()): number | undefined {
        if (this.performanceLedger.runStartedAtMs <= 0) return undefined;
        return Math.max(0, Math.floor(nowMs - this.performanceLedger.runStartedAtMs));
    }

    private advancePerformanceIteration(nextIteration = this.iteration + 1): void {
        this.iteration = Math.max(this.iteration, Math.floor(nextIteration));
        this.synchronizeRuntimePerformanceUsage();
    }

    private consumePerformanceVisionCandidate(observationKey?: string, allowOverLimit = false): boolean {
        const normalizedKey = String(observationKey || '').trim();
        // allowOverLimit：候选额度用尽后的缩略图降级读入仍要记账（成本可追踪），但不再被上限拒绝。
        if (!allowOverLimit
            && this.performanceLedger.visionCandidateCount >= this.getPerformanceVisionCandidateLimit()) {
            return false;
        }
        // observationKey 相同只代表同一份证据；只要像素再次进入 provider 消息，
        // 就会再次产生图像输入费用，因此普通视觉附件也必须按 presentation 计数。
        this.performanceLedger.visionCandidateCount += 1;
        if (normalizedKey) this.performanceLedger.visionCandidateKeys.add(normalizedKey);
        this.synchronizeRuntimePerformanceUsage();
        return true;
    }

    private selectPerformanceVisionCandidates<T>(candidates: readonly T[]): T[] {
        const configuredAnalyses = this.config.performanceBudget?.maxVisualAnalyses;
        const visionBudget = this.resolvePerformanceVisionBudget();
        const candidateRemaining = Math.max(
            0,
            visionBudget.candidateLimit - this.performanceLedger.visionCandidateCount
        );
        const poolCapacity = typeof configuredAnalyses === 'number' && Number.isFinite(configuredAnalyses)
            ? resolveRunLevelVisualPresentationCapacity({
                limit: visionBudget.runLevelLimit,
                consumed: visionBudget.runLevelConsumed,
                visualAnalysisAlreadyPending: this.initialImagesPendingPrimaryObservation
                    || this.pendingPrimaryVisualObservations.length > 0
            })
            : candidateRemaining;
        const remaining = Math.min(candidateRemaining, poolCapacity);
        const selected = candidates.slice(0, remaining);
        this.performanceLedger.visionCandidateCount += selected.length;
        this.synchronizeRuntimePerformanceUsage();
        return selected;
    }

    private beginPerformanceModelCall(
        visualAnalysis = false,
        budgetClass: PerformanceModelBudgetClass = 'task',
        directVisionCandidateCount = 0,
        directVisionCandidateKeys: readonly string[] = [],
        billDirectVisionCandidatesByPresentation = false
    ): void {
        const directVisionCharge = resolveDirectVisionCandidateCharge({
            directVisionCandidateCount,
            directVisionCandidateKeys,
            billedObservationKeys: this.performanceLedger.visionCandidateKeys,
            billByProviderPresentation: billDirectVisionCandidatesByPresentation
        });
        const classViolation = readPerformanceModelBudgetClassViolation(
            this.performanceLedger,
            budgetClass,
            {
                candidateCount: directVisionCharge.billedCandidateCount,
                candidateKeys: directVisionCharge.normalizedObservationKeys
            }
        );
        if (classViolation) {
            const error = new Error(classViolation.message) as Error & { code?: string };
            error.code = classViolation.code;
            throw error;
        }
        const exhaustion = this.readPerformanceBudgetExhaustion('model', budgetClass);
        if (exhaustion) {
            const error = new Error(exhaustion.message) as Error & {
                code?: string;
                performanceBudgetExhaustion?: typeof exhaustion;
            };
            error.code = exhaustion.code;
            error.performanceBudgetExhaustion = exhaustion;
            throw error;
        }
        const visionCallCapacity = this.resolvePerformanceVisionCallCapacity(visualAnalysis, budgetClass);
        if ((visualAnalysis || budgetClass !== 'task')
            && !visionCallCapacity.hasFixedEventCapacity) {
            const error = new Error('已达到本轮视觉分析次数上限，不再发起新的读图判断。') as Error & {
                code?: string;
            };
            error.code = 'agent_visual_analysis_budget_exhausted';
            throw error;
        }
        const billedDirectVisionCandidateCount = directVisionCharge.billedCandidateCount;
        if (billedDirectVisionCandidateCount > visionCallCapacity.remainingCandidateCount) {
            const error = new Error('已达到本轮视觉候选上限，不再向模型发送新的图像候选。') as Error & {
                code?: string;
            };
            error.code = 'agent_vision_candidate_budget_exhausted';
            throw error;
        }
        consumePerformanceModelCallUsage(this.performanceLedger, budgetClass, {
            visualAnalysis,
            billedVisionCandidateCount: billedDirectVisionCandidateCount,
            visionCandidateKeys: directVisionCharge.normalizedObservationKeys
        });
        this.synchronizeRuntimePerformanceUsage();
    }

    /**
     * Keep ordinary turns bounded, but give a thinking-capable provider one larger
     * continuation window after it has already spent the first window reasoning.
     * The configured model output limit remains the hard ceiling.
     */
    private resolvePrimaryTurnProviderMaxTokens(): number {
        const configuredMaxTokens = Number(getModelById(this.config.modelId)?.maxTokens || 0);
        const performanceMaxTokens = Number(
            this.config.performanceBudget?.maxPrimaryOutputTokens || 0
        );
        const requestedMaxTokens = resolveProviderTruncationMaxTokens({
            baseMaxTokens: performanceMaxTokens > 0 ? performanceMaxTokens : 4096,
            configuredMaxTokens,
            performanceMaxTokens,
            recoveryAttempt: this.providerOutputRecovery.recoveryAttemptForTokenBudget
        });
        return Math.min(
            requestedMaxTokens,
            buildAgentContextCapacityPlan({
                windowTokens: this.config.contextWindowTokens,
                requestedOutputTokens: requestedMaxTokens
            }).outputReserveTokens
        );
    }

    private resolveProviderThinkingEnabled(): boolean | undefined {
        if (this.config.performanceBudget?.allowProviderThinking === false) return false;
        return this.config.thinkingEnabled;
    }

    /**
     * 预算将尽纪律：模型此前只在预算耗尽时被强制收尾，之前没有任何预算意识——
     * 容易把调用花在反复观察上，轮到写入时预算已空。剩余约 1/4 时提醒一次：
     * 停止新观察，优先用已取得信息完成最小可交付动作。
     */
    private maybePushBudgetDisciplineDirective(imminentModelCalls = 0): void {
        const budget = this.config.performanceBudget;
        if (!shouldIssuePerformanceBudgetDisciplineDirective({
            budget,
            ledger: this.performanceLedger,
            activeElapsedMs: this.readPerformanceActiveElapsedMs(),
            imminentModelCalls,
            requestTimeoutMs: AGENT_MODEL_REQUEST_TIMEOUT_MS
        })) return;
        this.performanceLedger.budgetDisciplineDirectiveIssued = true;
        const activeTaskClosureTools = this.taskClosureCapabilityRuntime.ensureVisible(this.toolCallLog);
        this.messages.push(createHarnessControlMessage([
            '这次制作已经进入收尾区。不要再启动新的独立评审、广泛检索或多版本探索；使用已经确认的信息完成当前版本。',
            '如仍需改动，只做现有画面证据支持的最小可逆调整，然后完成最后一次写后读回，并保存当前版本。',
            ...buildTaskClosureCapabilityDirective(activeTaskClosureTools),
            '如果无法做出版本，就如实说明还缺什么，不要向用户解释内部限制。'
        ].join('\n'), 'budget-discipline', 'performance-budget'));
    }

    private consumePerformanceToolCallBudget(
        toolName: string,
        toolArguments: Record<string, unknown> = {}
    ): Record<string, unknown> | undefined {
        const blocker = consumePerformanceToolCallBudgetFromLedger({
            ledger: this.performanceLedger,
            budget: this.config.performanceBudget,
            reserveContext: {
                authorizedMutationExpectation: this.hasAuthorizedMutationExpectation(),
                attemptedDeliveryAction: this.hasAttemptedTaskDeliveryAction(),
                hasObservedTaskMutation: this.hasObservedTaskMutation(),
                hasViewableDesignChange: deriveAgentUserResultFacts(this.toolCallLog).hasViewableDesignChange
            },
            toolName,
            toolArguments
        });
        if (blocker) return blocker;
        this.synchronizeRuntimePerformanceUsage();
        return undefined;
    }

    private consumeHarnessQualityVerificationCallBudget(
        toolName: string
    ): Record<string, unknown> | undefined {
        return consumeHarnessQualityVerificationCallBudgetFromLedger({
            ledger: this.performanceLedger,
            toolName
        });
    }

    private async buildPerformanceBudgetRunResult(
        exhaustion: NonNullable<ReturnType<Agent['readPerformanceBudgetExhaustion']>>,
        iterations: number
    ): Promise<AgentRunResult> {
        return settlePerformanceBudgetTerminal({
            exhaustion,
            iterations,
            maxIterations: this.config.maxIterations,
            modelCalls: this.performanceLedger.modelCallCount,
            toolCalls: this.performanceLedger.toolCallCount,
            elapsedMs: this.readPerformanceActiveElapsedMs(),
            prepareClosure: (resultInput) => this.prepareAgentTerminalClosure(resultInput),
            buildRunResult: (resultInput, closure) => this.buildRunResult(resultInput, closure),
            emitStep: (step) => this.emitStep(step),
            onProgress: this.config.callbacks.onProgress
        });
    }

    private emitStep(step: AgentStepEvent): void {
        const title = String(step.title || '').trim();
        if (!title) return;
        if (step.kind === 'warning'
            && /(?:retry|replan|recovery|repair)/i.test(String(step.issue || ''))) {
            this.runtimeSession = this.runtimeAccounting.recordRecoveryAttempt(this.runtimeSession);
        }
        this.config.callbacks.onStep?.({
            ...step,
            title,
            detail: step.detail ? String(step.detail).trim() : undefined,
            source: step.source || 'agent_runtime',
            audience: step.audience || 'agent'
        });
    }

    /**
     * 循环内 declareDesignIntent 成功后的完整 Runtime 激活入口。
     *
     * Agent 不解析 Manifest，也不签发身份/授权；executor 先通过现有 Bundle、TaskRun 与
     * Artifact owner 准备好同代绑定，再一次性交给这里。所有字段和 RuntimeSession 在下一次
     * 模型请求前同步切换，避免只补 stage plan、其余仍读取启动时 undefined 的半绑定状态。
     */
    activateRuntimeContractFromDeclaration(input: {
        runtimeSessionIdentity: NonNullable<AgentConfig['runtimeSessionIdentity']>;
        runtimeLoopContract: NonNullable<AgentConfig['runtimeLoopContract']>;
        runtimeStagePlan: NonNullable<AgentConfig['runtimeStagePlan']>;
        runtimeStageContextItems: NonNullable<AgentConfig['runtimeStageContextItems']>;
        runtimeDesignBriefAvailableInputSources: NonNullable<AgentConfig['runtimeDesignBriefAvailableInputSources']>;
        taskPlanPresentationScope: NonNullable<AgentConfig['taskPlanPresentationScope']>;
        toolCapabilityBridge: NonNullable<AgentConfig['toolCapabilityBridge']>;
        evaluationProfile: NonNullable<AgentConfig['evaluationProfile']>;
        getCapabilityResolution: NonNullable<AgentConfig['getCapabilityResolution']>;
        getActiveCapabilityIdsForTool: NonNullable<AgentConfig['getActiveCapabilityIdsForTool']>;
        getOnDemandActivatedCapabilityIds: NonNullable<AgentConfig['getOnDemandActivatedCapabilityIds']>;
        finalizeRuntimeArtifacts: NonNullable<AgentConfig['finalizeRuntimeArtifacts']>;
        performanceBudget: NonNullable<AgentConfig['performanceBudget']>;
        reasoningEffort?: AgentConfig['reasoningEffort'];
        maxIterations: number;
        runtimeActionPlanResumeFreshness?: AgentConfig['runtimeActionPlanResumeFreshness'];
    }): void {
        if (this.config.runtimeStagePlan || this.runtimeSession) {
            throw new Error('runtime_contract_already_active');
        }
        const currentIdentity = this.config.runtimeSessionIdentity;
        if (!currentIdentity) throw new Error('runtime_plan_neutral_identity_required');
        if (currentIdentity.sessionId !== input.runtimeSessionIdentity.sessionId
            || currentIdentity.runId !== input.runtimeSessionIdentity.runId
            || currentIdentity.generation !== input.runtimeSessionIdentity.generation) {
            throw new Error('runtime_declaration_identity_generation_mismatch');
        }
        if (input.runtimeSessionIdentity.skillId !== input.runtimeStagePlan.skillId
            || input.runtimeSessionIdentity.taskType !== input.runtimeStagePlan.taskType) {
            throw new Error('runtime_declaration_manifest_identity_mismatch');
        }
        if (!Number.isInteger(input.maxIterations) || input.maxIterations <= 0) {
            throw new Error('runtime_declaration_iteration_budget_invalid');
        }

        // 先完整构造 Session；校验失败时不触碰正在运行的 Agent 状态。
        let nextRuntimeSession = createRuntimeSession({
            identity: input.runtimeSessionIdentity,
            plan: input.runtimeStagePlan,
            ...(this.runtimeAccounting.readUnboundLedgerForTransfer()
                ? { accountingSeed: this.runtimeAccounting.readUnboundLedgerForTransfer() }
                : {})
        });
        // plan-neutral 首轮的真实调用、时长、usage 与 prompt shape 已通过 accountingSeed
        // 转移到同一个 Session owner；不再按调用次数补造 durationMs=0 的假样本。
        nextRuntimeSession = recordRuntimeSessionPerformanceUsage({
            session: nextRuntimeSession,
            usage: this.readRequestPerformanceUsageSnapshot()
        });
        this.config = {
            ...this.config,
            runtimeSessionIdentity: input.runtimeSessionIdentity,
            runtimeLoopContract: input.runtimeLoopContract,
            runtimeStagePlan: input.runtimeStagePlan,
            runtimeStageContextItems: input.runtimeStageContextItems,
            runtimeDesignBriefAvailableInputSources: input.runtimeDesignBriefAvailableInputSources,
            taskPlanPresentationScope: input.taskPlanPresentationScope,
            toolCapabilityBridge: input.toolCapabilityBridge,
            evaluationProfile: input.evaluationProfile,
            getCapabilityResolution: input.getCapabilityResolution,
            getActiveCapabilityIdsForTool: input.getActiveCapabilityIdsForTool,
            getOnDemandActivatedCapabilityIds: input.getOnDemandActivatedCapabilityIds,
            finalizeRuntimeArtifacts: input.finalizeRuntimeArtifacts,
            performanceBudget: input.performanceBudget,
            reasoningEffort: input.reasoningEffort,
            maxIterations: input.maxIterations,
            ...(input.runtimeActionPlanResumeFreshness
                ? { runtimeActionPlanResumeFreshness: input.runtimeActionPlanResumeFreshness }
                : {})
        };
        this.runtimeSession = nextRuntimeSession;
        this.runtimeAccounting.releaseUnboundLedgerAfterBinding();
        this.carryPlanNeutralObservationIntoBoundRuntime();
        // plan-neutral 使用当前 Agent 直接消费候选像素；staged Runtime 改为 Tool 内产出
        // 结构化观察。两种结果契约不能共用同一只读缓存条目。
        this.readResultCache.clear();
        // Capability/Stage 切换后，旧阶段生成的 continuation schema 不能跨边界复用。
        this.workflowContinuationScope = undefined;
        this.pendingDirectWorkflowHandoff = undefined;
        this.providerOutputRecovery.clearPending();
    }

    /**
     * agentic 执行模型（开放创意路径）在循环内声明任务类型时，原位接入 Manifest 的
     * 方法上下文、评价标准、执行预算与结构化交付义务。它不创建 Runtime Session，
     * 不推进 Stage、不裁剪 Capability，也不授予 Photoshop 写入权限。
     */
    activateAgenticRuntimeContractFromDeclaration(input: {
        artifactContract: NonNullable<AgentConfig['agenticArtifactContract']>;
        referencePolicy?: NonNullable<AgentConfig['agenticReferencePolicy']>;
        runtimeStageContextItems: NonNullable<AgentConfig['runtimeStageContextItems']>;
        evaluationProfile: NonNullable<AgentConfig['evaluationProfile']>;
        performanceBudget: NonNullable<AgentConfig['performanceBudget']>;
        reasoningEffort?: AgentConfig['reasoningEffort'];
        maxIterations: number;
    }): void {
        if (this.config.runtimeStagePlan || this.runtimeSession) {
            throw new Error('agentic_runtime_contract_cannot_replace_staged_runtime');
        }
        if (!Number.isInteger(input.maxIterations) || input.maxIterations <= 0) {
            throw new Error('agentic_runtime_iteration_budget_invalid');
        }
        this.config = {
            ...this.config,
            agenticArtifactContract: input.artifactContract,
            agenticReferencePolicy: input.referencePolicy,
            runtimeStageContextItems: input.runtimeStageContextItems,
            evaluationProfile: input.evaluationProfile,
            performanceBudget: input.performanceBudget,
            reasoningEffort: input.reasoningEffort,
            maxIterations: input.maxIterations
        };
        // Profile 已由模型在本轮主动声明；后续不再展示同一个声明入口，避免重复绑定空转。
        this.providerOutputRecovery.clearPending();
        this.refreshPrimarySystemMessage();
    }

    /**
     * late binding 前的开工只读结果仍属于同一 Agent run。只要绑定后当前阶段正是 R2、
     * 结果成功且没有发生写入，就把这份同 revision 事实承接给新 Session，避免为了阶段
     * 记账再次读取同一文档。它不承接模型声明、不授予写权限，也不能充当写后读回。
     */
    private carryPlanNeutralObservationIntoBoundRuntime(): void {
        if (!this.runtimeSession || !this.config.runtimeStagePlan || !this.isCurrentRuntimeStage('R2')) return;
        const observation = this.findLatestSuccessfulRuntimeR2Observation();
        if (!observation || this.initialVisualObservationTraceRecorded) return;
        const revision = readPhotoshopHistoryStateRef(observation.result);
        if (revision) {
            this.runtimeSession = reconcileRuntimeSessionDocumentRevision({
                session: this.runtimeSession,
                plan: this.config.runtimeStagePlan,
                revision
            });
        }
        const observedOutcomes = this.buildRuntimeR2Outcomes();
        this.appendStageTraceEvent({
            stage: 'R2',
            source: observation.origin === 'harness_opening_observation'
                ? 'opening_observation'
                : 'tool_result',
            outcome: 'passed',
            observedOutcomes,
            iteration: this.iteration + 1,
            toolName: observation.name,
            toolKind: 'read_only_observation'
        });
        this.evaluateRuntimeStage({
            stage: 'R2',
            outcome: 'passed',
            observedOutcomes,
            reason: 'Runtime 绑定前已取得同一运行、同一文档版本的结构化只读事实。'
        });
        this.initialVisualObservationTraceRecorded = true;
    }

    /**
     * 在 Design Team 真正启动前，由父 Agent 的单一预算账本做一次事前分区。
     * coordinator 只拿子 allowance；父总预算、实时计数与收尾 reserve 不下发。
     */
    reserveDesignTeamChildExecution(input: {
        plannedRoles?: readonly DesignTeammateRole[];
        maxRevisions?: number;
        singleRole?: DesignTeammateRole;
    }): DesignTeamChildExecutionReservation {
        const parentBudget = this.config.performanceBudget;
        if (!parentBudget || !this.runtimeSession) {
            const optionalSpecialistCount = new Set(input.plannedRoles || []);
            const requiredBaseAgentCalls = input.singleRole ? 1 : 4
                + (optionalSpecialistCount.has('market-researcher') ? 1 : 0)
                + (optionalSpecialistCount.has('copywriter') ? 1 : 0);
            const parsedRevisionCount = Number(input.maxRevisions ?? 1);
            const revisionCount = Number.isFinite(parsedRevisionCount)
                ? Math.max(0, Math.min(2, Math.floor(parsedRevisionCount)))
                : 1;
            return {
                status: 'blocked',
                code: 'parent_finalization_reserve_unavailable',
                reason: '父 Agent 尚未绑定可累计的 Runtime 预算；Design Team 未启动。',
                requiredBaseAgentCalls,
                plannedAgentCallCeiling: input.singleRole
                    ? 1
                    : requiredBaseAgentCalls + revisionCount * 4
            };
        }

        const parentUsage = {
            modelCalls: this.performanceLedger.modelCallCount,
            toolCalls: this.performanceLedger.toolCallCount,
            visualAnalyses: this.performanceLedger.visualAnalysisCount,
            visionCandidates: this.performanceLedger.visionCandidateCount,
            // 当前 Tool 所在的父模型回合尚未在循环尾部自增 iteration。
            iterations: this.iteration + 1
        };
        const reservation = input.singleRole
            ? buildDesignTeamSingleRoleExecutionReservation({
                parentBudget,
                parentMaxIterations: this.config.maxIterations,
                parentUsage,
                parentActiveElapsedMs: this.readPerformanceActiveElapsedMs(),
                role: input.singleRole
            })
            : buildDesignTeamChildExecutionReservation({
            parentBudget,
            parentMaxIterations: this.config.maxIterations,
            parentUsage,
            parentActiveElapsedMs: this.readPerformanceActiveElapsedMs(),
            plannedRoles: input.plannedRoles,
            maxRevisions: input.maxRevisions
        });
        if (reservation.status === 'blocked') return reservation;

        // Manifest 的 ceiling 是整个请求的总额，不能在这里再次缩小。子额度会在下面
        // 作为“已提交消费”写入同一 performance ledger；若同时收紧 ceiling，就会把
        // 同一笔 Team 成本扣两次，并把多画面 R5 的完整 ReviewSet 锁死。
        this.commitDesignTeamChildAllowance(reservation.allowance);
        return reservation;
    }

    private commitDesignTeamChildAllowance(
        allowance: DesignTeamChildExecutionAllowance
    ): void {
        if (!this.runtimeSession) return;
        const recorded = readRuntimeSessionPerformanceUsage(this.runtimeSession);
        this.performanceLedger.modelCallCount = Math.max(
            recorded.modelCalls,
            this.performanceLedger.modelCallCount
        ) + allowance.maxModelCalls;
        this.performanceLedger.toolCallCount = Math.max(
            recorded.toolCalls,
            this.performanceLedger.toolCallCount
        ) + allowance.maxToolCalls;
        this.iteration = Math.max(recorded.iterations, this.iteration + 1)
            + allowance.maxModelCalls;
        this.performanceLedger.visionCandidateCount = Math.max(
            recorded.visionCandidates,
            this.performanceLedger.visionCandidateCount
        ) + allowance.maxVisionCandidates;
        this.performanceLedger.visualAnalysisCount = Math.max(
            recorded.visualAnalyses,
            this.performanceLedger.visualAnalysisCount
        ) + allowance.maxVisualAnalyses;
        this.synchronizeRuntimePerformanceUsage();
    }

    private buildIterationProgressLabel(): string {
        if (this.iteration === 0) return '正在思考任务怎么做';
        const recent = [...this.toolCallLog]
            .reverse()
            .find((entry) => !isAgentHarnessControlTool(entry.name));
        if (!recent) return '正在继续处理';
        switch (classifyAgentToolExecution(recent.name, recent.arguments)) {
            case 'photoshop_write':
                return '正在调整画面';
            case 'save_export':
                return '正在保存和导出';
            case 'knowledge_search':
                return '正在查阅参考资料';
            case 'external_generation':
                return '正在生成素材';
            default:
                return '正在查看当前状况';
        }
    }

    private appendStageTraceEvent(event: RuntimeStageTraceEventInput): void {
        const plan = this.config.runtimeStagePlan;
        if (!plan || !this.runtimeSession) return;
        this.runtimeSession = appendRuntimeSessionObservation({
            plan,
            session: this.runtimeSession,
            event
        });
    }

    private evaluateRuntimeStage(event: {
        stage: RuntimeStageTraceEventInput['stage'];
        outcome: RuntimeStageTraceEventInput['outcome'];
        observedOutcomes: string[];
        reason?: string;
        verdict?: DesignVerdict;
        reflexionHandoff?: ReflexionHandoff;
    }): void {
        const plan = this.config.runtimeStagePlan;
        if (!plan || !this.runtimeSession) return;
        this.runtimeSession = applyRuntimeSessionStageEvaluation({
            plan,
            session: this.runtimeSession,
            event
        });
    }

    private isCurrentRuntimeStage(stage: RuntimeStageTraceEventInput['stage']): boolean {
        return this.runtimeSession?.stageState.currentStage === stage;
    }

    private requiresReadyDesignBrief(): boolean {
        return Boolean(this.config.runtimeStagePlan?.steps.some((step) => step.stage === 'R1'));
    }

    private resolveActiveReferencePolicy() {
        return resolveAgentActiveReferencePolicy(this.config);
    }

    private resolveActiveReferenceWorkMode(): RuntimeDesignWorkMode | undefined {
        return resolveAgentActiveReferenceWorkMode({
            config: this.config,
            designBrief: this.runtimeDesignBriefDeclaration
        });
    }

    private resolveReferenceFailureDisposition(
        toolName: string,
        result: unknown
    ): AgentToolCallLogEntry['failureDisposition'] {
        return resolveAgentReferenceFailureDisposition({
            config: this.config,
            designBrief: this.runtimeDesignBriefDeclaration,
            referenceBrief: this.runtimeReferenceBriefDeclaration,
            toolName,
            result
        });
    }

    private reconcileReferenceFailureDispositions(): void {
        reconcileAgentReferenceFailureDispositions({
            config: this.config,
            designBrief: this.runtimeDesignBriefDeclaration,
            referenceBrief: this.runtimeReferenceBriefDeclaration,
            toolCallLog: this.toolCallLog
        });
    }

    private requiresReferenceContextResolution(): boolean {
        return requiresRuntimeReferenceContextResolution({
            plan: this.config.runtimeStagePlan,
            designBrief: this.runtimeDesignBriefDeclaration
        });
    }

    private buildRuntimeR2Outcomes(): string[] {
        return [
            'project_context_observed',
            'visual_or_readback_observation',
            ...(!this.requiresReferenceContextResolution() && this.config.runtimeStagePlan?.referencePolicy
                ? ['reference_context_resolved']
                : [])
        ];
    }

    private buildReferenceContextState() {
        return buildAgentRuntimeReferenceContextState(this.toolCallLog);
    }

    private buildRuntimeReferenceStageReason(
        declaration: RuntimeReferenceBriefDeclaration | undefined
    ): string {
        return describeRuntimeReferenceStage(declaration);
    }

    private isSuccessfulRuntimeToolObservation(call: ToolCall, result: any): boolean {
        return isSuccessfulAgentRuntimeToolObservation(call, result);
    }

    private isFromScratchDesignTask(): boolean {
        return isFromScratchRuntimeDesignTask({
            plan: this.config.runtimeStagePlan,
            designBrief: this.runtimeDesignBriefDeclaration
        });
    }

    private buildReferenceContextBlocker(toolName: string): Record<string, unknown> {
        return buildAgentReferenceContextBlocker({
            toolName,
            plan: this.config.runtimeStagePlan,
            designBrief: this.runtimeDesignBriefDeclaration,
            referenceBrief: this.runtimeReferenceBriefDeclaration
        });
    }

    private buildReferenceSearchBudgetBlocker(toolName: string): Record<string, unknown> | undefined {
        const policy = this.resolveActiveReferencePolicy();
        const workMode = this.resolveActiveReferenceWorkMode();
        const context = this.buildReferenceContextState();
        return buildAgentReferenceSearchBudgetBlocker({
            toolName,
            policy,
            workMode,
            context
        });
    }

    private buildDesignBriefRequiredBlocker(toolName: string): Record<string, unknown> {
        const brief = this.runtimeDesignBriefDeclaration;
        const requiredInputKeys = this.resolveRuntimeDesignBriefEffectiveContract(brief)?.requiredInputs || [];
        return buildAgentDesignBriefRequiredBlocker({
            toolName,
            brief,
            requiredInputKeys
        });
    }

    private resolveRuntimeDesignBriefEffectiveContract(
        declaration: RuntimeDesignBriefDeclaration | undefined = this.runtimeDesignBriefDeclaration
    ): RuntimeStagePlanEffectiveContract | undefined {
        return resolveRuntimeStagePlanEffectiveContract(
            this.config.runtimeStagePlan,
            declaration?.payload.workMode
        );
    }

    private resolveRuntimeEvaluationProfile(): DesignEvaluationProfile | undefined {
        const reviewRubricRef = this.resolveRuntimeDesignBriefEffectiveContract()?.reviewRubricRef;
        if (reviewRubricRef) return getDesignEvaluationProfileById(reviewRubricRef);
        return this.config.evaluationProfile;
    }

    private resolveFinalReviewSetRequirements(profile?: DesignEvaluationProfile): {
        requireMultiSurface: boolean;
        requiredSourceKind?: string;
        requiredViews: Array<'native_surface' | 'list_thumbnail'>;
    } {
        const finalReview = profile?.finalReview;
        const requireMultiSurface = finalReview?.surfaceMode === 'declared_multi_surface';
        const requiredSourceKind = finalReview?.requiredSourceKind;
        return {
            requireMultiSurface,
            requiredViews: finalReview?.requiredViews
                ? [...finalReview.requiredViews]
                : ['native_surface'],
            ...(requireMultiSurface && requiredSourceKind
                ? { requiredSourceKind }
                : {})
        };
    }

    private buildDesignBriefContextRefs(): string[] {
        const refs = new Set<string>(['context:user_goal']);
        if (this.config.runtimeStagePlan) refs.add('context:skill_manifest');
        if (this.currentInputImageCount > 0) refs.add('context:attached_images');
        if (this.hasSuccessfulOpeningObservation()) {
            refs.add('context:opening_observation');
        }
        for (const entry of this.toolCallLog) {
            if (entry.result?.success === false || isAgentHarnessControlTool(entry.name)) continue;
            switch (classifyAgentToolExecution(entry.name, entry.arguments)) {
                case 'read_only_observation':
                    refs.add('context:readback');
                    break;
                case 'knowledge_search':
                    refs.add('context:knowledge');
                    break;
                case 'photoshop_write':
                    refs.add('context:document_change');
                    break;
                case 'save_export':
                    refs.add('context:delivery');
                    break;
                case 'external_generation':
                    refs.add('context:generated_asset');
                    break;
                case 'stateful_context':
                    refs.add('context:runtime_context');
                    break;
                default:
                    break;
            }
        }
        this.buildDesignBriefResolvedInputs().forEach((input) => refs.add(input.contextRef));
        return Array.from(refs);
    }

    private buildDesignBriefResolvedInputs(
        workMode: RuntimeDesignBriefDeclaration['payload']['workMode'] = (
            this.runtimeDesignBriefDeclaration?.payload.workMode
            || this.config.runtimeStagePlan?.expectedWorkMode
        )
    ): RuntimeDesignBriefResolvedInput[] {
        const plan = this.config.runtimeStagePlan;
        if (!plan) return [];
        const availableSources = [
            ...(this.config.runtimeDesignBriefAvailableInputSources || []),
            ...buildObservedRuntimeInputSources({
                task: this.currentTask,
                toolCalls: this.toolCallLog,
                workMode
            }),
            ...(this.currentTask.trim() ? [{ sourceKind: 'user_goal' as const }] : []),
            ...(this.currentInputImageCount > 0 ? [{ sourceKind: 'attached_image' as const }] : []),
            ...(this.config.toolDecisionContext?.hasDocument === true
                ? [{ sourceKind: 'photoshop_document' as const }]
                : [])
        ];
        return resolveRuntimeDesignBriefInputs({
            inputSources: plan.inputSources,
            availableSources
        });
    }

    private buildDesignStrategyContextRefs(): string[] {
        const refs = new Set(this.buildDesignBriefContextRefs());
        this.buildIncludedRuntimeContextRefs().forEach((ref) => refs.add(ref));
        if (this.runtimeDesignBriefDeclaration?.readiness === 'ready') {
            refs.add('context:design_brief');
        }
        if (isRuntimeReferenceContextResolved(this.runtimeReferenceBriefDeclaration)) {
            refs.add('context:reference_brief');
        }
        return Array.from(refs);
    }

    /**
     * 把本阶段真正进入模型上下文的数据项暴露成可引用 evidence ref。
     * 只引用 Context Compiler 的 includedItemIds；被预算、冲突或阶段规则拒绝的项不得被 R3 冒充为证据。
     */
    private buildIncludedRuntimeContextRefs(): string[] {
        const items = this.config.runtimeStageContextItems;
        const stage = this.runtimeSession?.stageState.currentStage;
        if (!Array.isArray(items) || items.length === 0) return [];
        const applicableItems = selectRuntimeContextItemsForStage(items, stage);
        const compiled = stage
            ? compileRuntimeContext({
                items: applicableItems,
                stage,
                maxTotalCharacters: this.runtimeContextCharacterBudget
            })
            : compileRuntimeContext({
                items: applicableItems,
                maxTotalCharacters: this.runtimeContextCharacterBudget
            });
        return compiled.includedItemIds.map((id) => `context:${id}`);
    }

    private buildActionPlanContextRefs(): string[] {
        const refs = new Set(this.buildDesignStrategyContextRefs());
        if (this.runtimeDesignStrategyDeclaration?.readiness === 'ready') {
            refs.add('context:design_strategy');
        }
        return Array.from(refs);
    }

    private loadRuntimeActionPlanModule(): Promise<RuntimeActionPlanModule> {
        if (!this.runtimeActionPlanModulePromise) {
            this.runtimeActionPlanModulePromise = import(
                '../../../shared/agent-runtime-v5/runtime-action-plan-declaration'
            ).then((module) => {
                this.runtimeActionPlanModule = module;
                return module;
            });
        }
        return this.runtimeActionPlanModulePromise;
    }

    private isToolVisibleAtRuntimeStage(
        stage: RuntimeStageTraceEventInput['stage'],
        tool: ToolSchema
    ): boolean {
        return isRuntimeStageToolVisible({
            stage,
            toolName: tool.name,
            toolKind: classifyAgentToolExecution(tool.name),
            harnessControl: isAgentHarnessControlTool(tool.name),
            hasOpenDocument: this.config.toolDecisionContext?.hasDocument,
            taskRequiresOpenDocument: !this.isFromScratchDesignTask()
        });
    }

    private upsertModelVisibleTool(modelVisibleTools: ToolSchema[], tool: ToolSchema): void {
        const index = modelVisibleTools.findIndex((candidate) => candidate.name === tool.name);
        if (index >= 0) modelVisibleTools.splice(index, 1);
        modelVisibleTools.push(tool);
    }

    private resolveRuntimeCapabilityRefsForTool(toolName: string): string[] {
        const activeCapabilityRefs = this.config.getActiveCapabilityIdsForTool?.(toolName) || [];
        const bridgedCapabilityRefs = Object.entries(LEGACY_TOOL_CAPABILITY_MAP)
            .filter(([, providerNames]) => providerNames.includes(toolName))
            .map(([capabilityRef]) => capabilityRef);
        return Array.from(new Set([
            ...activeCapabilityRefs,
            ...bridgedCapabilityRefs
        ]));
    }

    private buildCurrentRuntimeActionPlanCapabilityContext(
        actionPlanRuntime: RuntimeActionPlanModule
    ): RuntimeActionPlanCapabilityContext {
        const context = actionPlanRuntime.buildRuntimeActionPlanCapabilityContext(
            this.config.getCapabilityResolution?.()
        );
        const providers = this.config.tools.map((tool) => ({
            providerName: tool.name,
            capabilityRefs: this.resolveRuntimeCapabilityRefsForTool(tool.name),
            operationKind: classifyAgentToolExecution(tool.name)
        }));
        const operationKindsByCapabilityRef: NonNullable<
            RuntimeActionPlanCapabilityContext['operationKindsByCapabilityRef']
        > = {};
        const providerNamesByCapabilityRef: NonNullable<
            RuntimeActionPlanCapabilityContext['providerNamesByCapabilityRef']
        > = {};
        providers.forEach((provider) => {
            provider.capabilityRefs.forEach((capabilityRef) => {
                const operationKinds = operationKindsByCapabilityRef[capabilityRef] || [];
                operationKindsByCapabilityRef[capabilityRef] = Array.from(new Set([
                    ...operationKinds,
                    provider.operationKind
                ]));
                const providerNames = providerNamesByCapabilityRef[capabilityRef] || [];
                providerNamesByCapabilityRef[capabilityRef] = Array.from(new Set([
                    ...providerNames,
                    provider.providerName
                ]));
            });
        });
        const unavailableActionCapabilityRefs = findUnavailableFailedRuntimeActionCapabilities({
            failedCapabilityRefs: Array.from(new Set([
                ...this.failedRuntimeActionCapabilityRefs,
                ...this.handedOffRuntimeActionCapabilityRefs
            ])),
            failedProviderNames: Array.from(new Set([
                ...this.failedRuntimeActionProviderNames,
                ...this.handedOffRuntimeActionProviderNames
            ])),
            providers
        });
        return filterRuntimeActionPlanCapabilityContext({
            context: {
                ...context,
                operationKindsByCapabilityRef,
                providerNamesByCapabilityRef
            },
            unavailableActionCapabilityRefs
        });
    }

    private resolveCurrentManifestWorkflowCapabilityRefs(
        capabilityContext: RuntimeActionPlanCapabilityContext
    ): string[] {
        const availableActionCapabilityRefs = new Set([
            ...capabilityContext.activeActionCapabilityRefs,
            ...capabilityContext.onDemandActionCapabilityRefs
        ]);
        return Array.from(new Set(
            (this.config.toolCapabilityBridge?.workflowEntryTools || [])
                .map((toolName) => `skill.${String(toolName || '').trim()}`)
                .filter((ref) => ref !== 'skill.' && availableActionCapabilityRefs.has(ref))
        ));
    }

    private selectRuntimeActionMutationReadbackToolNames(): string[] {
        const bridgedToolNames = new Set(this.config.toolCapabilityBridge?.executableTools || []);
        const eligibleTools = this.config.tools
            .filter((tool) => (
                !this.isRuntimeActionProviderUnavailable(tool.name)
                && isAgentPhotoshopDocumentObservation(tool.name, {})
                && supportsRuntimeActionRepairReadback(
                    this.resolveRuntimeCapabilityRefsForTool(tool.name),
                    tool.name
                )
            ));
        const attemptedToolNames = new Set(
            this.pendingRuntimeActionMutationReadback?.kind === 'operation_unknown'
                ? this.pendingRuntimeActionMutationReadback.genericReadbackToolNames || []
                : []
        );
        const unattemptedTools = eligibleTools.filter((tool) => !attemptedToolNames.has(tool.name));
        return (unattemptedTools.length > 0 ? unattemptedTools : eligibleTools)
            .sort((left, right) => (
                Number(bridgedToolNames.has(right.name)) - Number(bridgedToolNames.has(left.name))
            ))
            .map((tool) => tool.name)
            .slice(0, 3);
    }

    private readActiveWorkflowContinuationScope(): AgentWorkflowContinuationScope | undefined {
        const previousScope = this.workflowContinuationScope;
        this.workflowContinuationScope = retainAgentWorkflowContinuationScope({
            scope: this.workflowContinuationScope,
            binding: buildAgentWorkflowContinuationBinding(this.runtimeSession)
        });
        if (previousScope && !this.workflowContinuationScope) {
            if (this.pendingDirectWorkflowHandoff?.workflowCallId === previousScope.workflowCallId) {
                this.pendingDirectWorkflowHandoff = undefined;
                this.runtimeDirectExecutionActionTarget = undefined;
            }
        }
        return this.workflowContinuationScope;
    }

    private constrainWorkflowContinuationTools(tools: ToolSchema[]): ToolSchema[] {
        const selectedToolNames = new Set(selectAgentWorkflowContinuationToolNames({
            scope: this.readActiveWorkflowContinuationScope(),
            availableToolNames: tools.map((tool) => tool.name)
        }));
        const pendingWorkflowHandoff = this.pendingDirectWorkflowHandoff;
        const ownerReentryReady = this.isPendingDirectWorkflowOwnerReentryReady();
        return tools.filter((tool) => (
            selectedToolNames.has(tool.name)
            && (!pendingWorkflowHandoff?.ownerAccepted
                || this.isPendingDirectWorkflowClosureReadbackTool(tool.name))
            && (!pendingWorkflowHandoff
                || tool.name !== pendingWorkflowHandoff.workflowToolName
                || ownerReentryReady)
        ));
    }

    /**
     * 续跑声明只能在当前 E1 Stage 已通过 Capability / Manifest 授权的完整能力面内取交集。
     * 这里不再根据 owner 身份或首轮顺序做第二次调度；purpose 与 allowlist 只防止
     * staged 工作流扩权，不能替 Agent 生成动作，也不进入开放式 agentic 路径。
     */
    private selectWorkflowContinuationCapabilityVisibleToolNames(
        iterationTools: ToolSchema[]
    ): string[] {
        const currentStage = this.runtimeSession?.stageState.currentStage;
        if (currentStage !== 'E1') {
            return this.filterIntentVisibleToolNames(
                (this.runtimeSession ? iterationTools : this.config.tools)
                    .filter((tool) => !this.isRuntimeActionProviderUnavailable(tool.name))
                    .map((tool) => tool.name)
            );
        }
        return this.filterIntentVisibleToolNames(this.config.tools
            .filter((tool) => (
                !this.isRuntimeActionProviderUnavailable(tool.name)
                && this.isToolVisibleAtRuntimeStage(currentStage, tool)
            ))
            .map((tool) => tool.name));
    }

    private async buildModelVisibleToolsForIteration(): Promise<ToolSchema[]> {
        const plan = this.config.runtimeStagePlan;
        if (!plan) {
            if (this.pendingRuntimeActionMutationReadback) {
                if (this.pendingRuntimeActionMutationReadback.genericReadbackExhausted) return [];
                const readbackToolNames = new Set(this.selectRuntimeActionMutationReadbackToolNames());
                return this.config.tools.filter((tool) => readbackToolNames.has(tool.name));
            }
            if (this.runtimeActionMutationWriteLocked || this.runtimeActionProviderRecoveryBlocked) {
                return [];
            }
            const modelVisibleTools = this.config.tools.filter((tool) => (
                !this.isRuntimeActionProviderUnavailable(tool.name)
                && (!this.config.agenticArtifactContract
                    || tool.name !== 'declareDesignIntent')
            ));
            // agentic 路径不建立 R2 Stage，也不把 Reference Brief 变成写入门票；但当
            // Agent 已主动取得真实参考视觉观察后，必须给它一个可选的结构化绑定出口，
            // 让终审知道哪些参考确实影响了本稿。没有观察时不暴露，避免固定参考仪式。
            const referencePolicy = this.resolveActiveReferencePolicy();
            const referenceWorkMode = this.resolveActiveReferenceWorkMode();
            const referenceContext = this.buildReferenceContextState();
            if (this.config.agenticArtifactContract
                && referencePolicy
                && referenceWorkMode
                && !this.runtimeReferenceBriefDeclaration
                && referenceContext.visualObservations.length > 0) {
                const referenceTool = buildDeclareReferenceBriefToolSchema({
                    policy: referencePolicy,
                    workMode: referenceWorkMode,
                    context: referenceContext
                }) as ToolSchema;
                this.upsertModelVisibleTool(modelVisibleTools, referenceTool);
            }
            return modelVisibleTools;
        }
        const currentStage = this.runtimeSession?.stageState.currentStage;
        if (!currentStage) return [];
        // 续跑 Seed 可以直接携带 ready R4 声明进入 E1；此路径没有经过声明工具执行，
        // 因此需在计算计划节点/provider 前补载对账模块，不能把合法计划误判成无 provider。
        if (currentStage === 'E1'
            && this.runtimeActionPlanDeclaration?.readiness === 'ready'
            && !this.runtimeActionPlanModule) {
            await this.loadRuntimeActionPlanModule();
        }
        const currentStep = plan.steps.find((step) => step.stage === currentStage);
        const stageCapabilityIds = Array.from(new Set([
            ...(currentStep?.allowedToolCapabilities || []),
            ...(this.config.getOnDemandActivatedCapabilityIds?.() || [])
        ]));
        const availableRuntimeTools = this.config.tools.filter((tool) => (
            !this.isRuntimeActionProviderUnavailable(tool.name)
        ));
        const preferredProviderNames = new Set(selectPreferredLegacyToolsForCapabilities({
            capabilityIds: stageCapabilityIds,
            executableToolNames: availableRuntimeTools.map((tool) => tool.name)
        }));
        const modelVisibleTools = availableRuntimeTools.filter((tool) => {
            if (!this.isToolVisibleAtRuntimeStage(currentStage, tool)) return false;
            // 能力装载只服务“发现下一步可执行动作”。R1/R2/R3 尚未形成行动计划时暴露它，
            // 会让模型得到“已装载”但又因 Stage 不可执行的冲突反馈，并挤占有限模型轮次。
            if (isAgentCapabilityControlTool(tool.name)
                && currentStage !== 'R4'
                && currentStage !== 'E1') {
                return false;
            }
            // E1 的 Stage / Capability / Manifest 已经完成能力裁剪。这里不能再用“首个工作流”
            // 建立第二层独占调度，否则创建/选择文档等前置能力会被隐藏并形成自锁。
            if (currentStage === 'E1') return true;
            return isAgentHarnessControlTool(tool.name)
                || preferredProviderNames.has(tool.name);
        });
        if (currentStage === 'E1' && this.pendingRuntimeActionMutationReadback) {
            if (this.pendingRuntimeActionMutationReadback.genericReadbackExhausted) return [];
            const readbackToolNames = new Set(this.selectRuntimeActionMutationReadbackToolNames());
            return modelVisibleTools.filter((tool) => readbackToolNames.has(tool.name));
        }
        if (currentStage === 'E1' && this.runtimeActionMutationWriteLocked) return [];
        if (currentStage === 'E1' && this.runtimeActionProviderRecoveryBlocked) return [];
        if (currentStage === 'R1') {
            const stableDeclaredWorkMode = this.runtimeDesignBriefDeclaration?.readiness === 'ready'
                ? this.runtimeDesignBriefDeclaration.payload.workMode
                : undefined;
            const expectedWorkMode = plan.expectedWorkMode
                || stableDeclaredWorkMode;
            const workModeInputContracts = plan.workModeContracts
                ? Object.fromEntries(Object.entries(plan.workModeContracts).flatMap(([workMode, contract]) => (
                    contract
                        ? [[workMode, {
                            requiredInputKeys: contract.required_inputs,
                            optionalInputKeys: contract.optional_inputs
                        }]]
                        : []
                ))) as RuntimeDesignBriefWorkModeInputContracts
                : undefined;
            const briefTool = buildDeclareDesignBriefToolSchema({
                requiredInputKeys: plan.requiredInputs,
                optionalInputKeys: plan.optionalInputs,
                allowedContextRefs: this.buildDesignBriefContextRefs(),
                inputSources: plan.inputSources,
                resolvedInputs: this.buildDesignBriefResolvedInputs(),
                workModeRequired: Boolean(plan.referencePolicy || plan.workModeContracts),
                ...(expectedWorkMode ? { expectedWorkMode } : {}),
                ...(workModeInputContracts ? { workModeInputContracts } : {})
            }) as ToolSchema;
            this.upsertModelVisibleTool(modelVisibleTools, briefTool);
            const stageNeedsInput = this.resolveRuntimeStageNeedsInputRecovery();
            if (stageNeedsInput.needsInput) {
                const observationTools = this.selectRuntimeInputObservationToolSchemas(stageNeedsInput);
                if (stageNeedsInput.observableToolKinds.length === 0
                    || observationTools.length === 0) {
                    // 环境来源已经不存在或探索已穷尽：撤掉声明 owner 与普通读取，给模型一个
                    // 无工具的提问回合（若有交互卡能力则保留卡片）。重复声明不会产生新观察。
                    return modelVisibleTools.filter((tool) => isAgentInputCollectionTool(tool.name));
                }
                observationTools.forEach((tool) => this.upsertModelVisibleTool(modelVisibleTools, tool));
                const focusedToolNames = new Set([
                    briefTool.name,
                    ...observationTools.map((tool) => tool.name),
                    ...modelVisibleTools
                        .filter((tool) => isAgentInputCollectionTool(tool.name))
                        .map((tool) => tool.name)
                ]);
                return modelVisibleTools.filter((tool) => focusedToolNames.has(tool.name));
            }
        }
        const workMode = this.runtimeDesignBriefDeclaration?.payload.workMode;
        if (currentStage === 'R2'
            && plan.referencePolicy
            && workMode
            && this.requiresReferenceContextResolution()
            && this.runtimeDesignBriefDeclaration?.readiness === 'ready') {
            const referenceTool = buildDeclareReferenceBriefToolSchema({
                policy: plan.referencePolicy,
                workMode,
                context: this.buildReferenceContextState()
            }) as ToolSchema;
            this.upsertModelVisibleTool(modelVisibleTools, referenceTool);
        }
        if (currentStage === 'R3'
            && this.runtimeDesignBriefDeclaration?.readiness === 'ready'
            && (!this.requiresReferenceContextResolution()
                || isRuntimeReferenceContextResolved(this.runtimeReferenceBriefDeclaration))) {
            const strategyTool = buildDeclareDesignStrategyToolSchema(
                this.buildDesignStrategyContextRefs()
            ) as ToolSchema;
            this.upsertModelVisibleTool(modelVisibleTools, strategyTool);
        }
        if (currentStage === 'R4'
            && this.runtimeDesignStrategyDeclaration?.readiness === 'ready') {
            const actionPlanRuntime = await this.loadRuntimeActionPlanModule();
            const capabilityContext = this.buildCurrentRuntimeActionPlanCapabilityContext(
                actionPlanRuntime
            );
            const workflowCapabilityRefs = this.resolveCurrentManifestWorkflowCapabilityRefs(
                capabilityContext
            );
            const requiresPhotoshopMutation = this.resolveRuntimeDesignBriefEffectiveContract()
                ?.productionObligation === 'photoshop_mutation_with_readback';
            const actionPlanTool = actionPlanRuntime.buildDeclareRuntimeActionPlanToolSchema({
                allowedContextRefs: this.buildActionPlanContextRefs(),
                discoveredCapabilityRefs: capabilityContext.discoveredCapabilityRefs,
                requiredDeliverables: this.runtimeDesignBriefDeclaration?.payload.deliverables || [],
                workflowCapabilityRefs,
                requiresPhotoshopMutation,
                verifiedCompletedStepIds: this.config.runtimeActionPlanResumeFreshness?.status === 'verified'
                    ? this.config.runtimeActionPlanResumeFreshness.verifiedCompletedStepIds || []
                    : []
            }) as ToolSchema;
            this.upsertModelVisibleTool(modelVisibleTools, actionPlanTool);
        }
        // R3 / R4 的声明是阶段 owner。R3 仍保留可与策略声明同轮提交的只读事实；
        // normalizeToolCallsBeforeExecution 会拒绝没有 owner 的单独探索，避免重复搜索空转。
        // R4 只保留行动计划与 Stage 已明确允许的同轮首稿动作（例如从零设计的
        // renderLayout bootstrap）；普通读取已由前序阶段完成，不再挤占执行预算。
        if (currentStage === 'R4' && !this.runtimeActionPlanDeclaration) {
            return modelVisibleTools.filter((tool) => {
                if (isRuntimeActionPlanControlTool(tool.name)) return true;
                if (isAgentCapabilityControlTool(tool.name)) return true;
                if (isAgentHarnessControlTool(tool.name) || isAgentInputCollectionTool(tool.name)) {
                    return false;
                }
                const kind = classifyAgentToolExecution(tool.name);
                return kind === 'photoshop_write' || kind === 'external_generation';
            });
        }
        if (currentStage === 'E1' && this.runtimeActionPlanDeclaration?.readiness === 'ready') {
            const plannedProviderNames = new Set(
                this.selectRuntimeE1ProgressToolNames(modelVisibleTools)
            );
            return this.constrainWorkflowContinuationTools(
                modelVisibleTools.filter((tool) => plannedProviderNames.has(tool.name))
            );
        }
        return currentStage === 'E1'
            ? this.constrainWorkflowContinuationTools(modelVisibleTools)
            : modelVisibleTools;
    }

    private executeDesignBriefDeclaration(value: unknown): any {
        const plan = this.config.runtimeStagePlan;
        const declarationInput = value && typeof value === 'object' && !Array.isArray(value)
            ? value as Record<string, unknown>
            : undefined;
        const effectiveContract = resolveRuntimeStagePlanEffectiveContract(
            plan,
            declarationInput?.workMode
        );
        const stableDeclaredWorkMode = this.runtimeDesignBriefDeclaration?.readiness === 'ready'
            ? this.runtimeDesignBriefDeclaration.payload.workMode
            : undefined;
        const expectedWorkMode = plan?.expectedWorkMode
            || stableDeclaredWorkMode;
        const validation = validateRuntimeDesignBriefDeclaration({
            value,
            requiredInputKeys: effectiveContract?.requiredInputs || [],
            optionalInputKeys: effectiveContract?.optionalInputs || [],
            allowedContextRefs: this.buildDesignBriefContextRefs(),
            inputSources: plan?.inputSources || {},
            resolvedInputs: this.buildDesignBriefResolvedInputs(
                declarationInput?.workMode as RuntimeDesignBriefDeclaration['payload']['workMode']
            ),
            workModeRequired: Boolean(plan?.referencePolicy || plan?.workModeContracts),
            ...(expectedWorkMode ? { expectedWorkMode } : {})
        });
        if (!validation.ok || !validation.declaration) {
            const firstIssue = validation.issues[0];
            const validationSummary = firstIssue
                ? `${firstIssue.code}${firstIssue.path ? ` (${firstIssue.path})` : ''}`
                : 'unknown_validation_issue';
            // 校验拒绝必须可执行：说清字段、限制值与允许集合，模型才能一次改对，而不是盲试。
            const actionableSummary = describeRuntimeDesignBriefValidationIssues(validation.issues, {
                allowedContextRefs: this.buildDesignBriefContextRefs(),
                ...(expectedWorkMode ? { allowedWorkModes: [expectedWorkMode] } : {})
            });
            return {
                success: false,
                code: 'runtime_design_brief_declaration_invalid',
                error: `runtime_design_brief_declaration_invalid: ${validationSummary}。请按以下提示修正后重新提交：${actionableSummary}`,
                message: `设计简报未通过校验，请修正后重新提交：${actionableSummary}`,
                issues: validation.issues,
                readiness: validation.readiness,
                executesPhotoshop: false,
                grantsPermission: false,
                autoActivatesCapabilities: false,
                countsAsObservation: false,
                countsAsTaskProgress: false
            };
        }
        // Brief 是 R3 / R4 的输入真相源；重新声明后旧策略和旧计划必须全部失效。
        this.runtimeDesignStrategyDeclaration = undefined;
        this.runtimeReferenceBriefDeclaration = undefined;
        this.runtimeActionPlanDeclaration = undefined;
        this.runtimeActionPlanExecutionJournal = undefined;
        this.runtimeActionExecutionEnvelopeByCallId.clear();
        this.runtimeDesignBriefDeclaration = validation.declaration;
        this.tightenPerformanceBudgetForDeclaredWorkMode(validation.declaration);
        return {
            success: true,
            readiness: validation.declaration.readiness,
            briefDigest: buildRuntimeDesignBriefDigest({
                declaration: validation.declaration,
                requiredInputKeys: effectiveContract?.requiredInputs || []
            }),
            executesPhotoshop: false,
            grantsPermission: false,
            autoActivatesCapabilities: false,
            countsAsObservation: false,
            countsAsTaskProgress: false
        };
    }

    private tightenPerformanceBudgetForDeclaredWorkMode(
        declaration: RuntimeDesignBriefDeclaration
    ): void {
        if (declaration.readiness !== 'ready') return;
        const workMode = declaration.payload.workMode;
        if (!workMode) return;
        const profile = this.config.runtimeStagePlan
            ?.workModeContracts?.[workMode]
            ?.performance_profile;
        if (!profile) return;

        function tightenLimit(current: number, declared: number): number {
            if (current < 0) return declared;
            return Math.min(current, declared);
        }

        const declaredBudget = profile.budget;
        const declaredModelControls = resolveAgentModelCallCostControls(
            profile.cost_profile.model_call_class
        );
        this.config.maxIterations = tightenLimit(
            this.config.maxIterations,
            declaredBudget.max_iterations
        );
        const currentBudget = this.config.performanceBudget;
        if (!currentBudget) {
            this.config.performanceBudget = {
                maxModelCalls: declaredBudget.max_model_calls,
                maxToolCalls: declaredBudget.max_tool_calls,
                maxVisionCandidates: declaredBudget.max_vision_candidates,
                maxInitialVisionCandidates: declaredBudget.max_initial_vision_candidates,
                maxVisualAnalyses: declaredBudget.max_visual_analyses,
                maxFullResolutionImageReads: declaredBudget.max_full_resolution_image_reads,
                softTimeBudgetMs: declaredBudget.soft_time_budget_ms,
                ...declaredModelControls
            };
            return;
        }
        this.config.performanceBudget = {
            maxModelCalls: tightenLimit(
                currentBudget.maxModelCalls,
                declaredBudget.max_model_calls
            ),
            maxToolCalls: tightenLimit(
                currentBudget.maxToolCalls,
                declaredBudget.max_tool_calls
            ),
            maxVisionCandidates: tightenLimit(
                currentBudget.maxVisionCandidates,
                declaredBudget.max_vision_candidates
            ),
            maxInitialVisionCandidates: tightenLimit(
                currentBudget.maxInitialVisionCandidates
                    ?? currentBudget.maxVisionCandidates,
                declaredBudget.max_initial_vision_candidates
                    ?? declaredBudget.max_vision_candidates
            ),
            maxVisualAnalyses: tightenLimit(
                currentBudget.maxVisualAnalyses,
                declaredBudget.max_visual_analyses
            ),
            maxFullResolutionImageReads: tightenLimit(
                currentBudget.maxFullResolutionImageReads,
                declaredBudget.max_full_resolution_image_reads
            ),
            softTimeBudgetMs: tightenLimit(
                currentBudget.softTimeBudgetMs,
                declaredBudget.soft_time_budget_ms
            ),
            maxPrimaryOutputTokens: tightenLimit(
                currentBudget.maxPrimaryOutputTokens ?? Number.MAX_SAFE_INTEGER,
                declaredModelControls.maxPrimaryOutputTokens
            ),
            allowProviderThinking: currentBudget.allowProviderThinking === false
                ? false
                : declaredModelControls.allowProviderThinking
        };
    }

    private executeReferenceBriefDeclaration(value: unknown): any {
        const policy = this.resolveActiveReferencePolicy();
        const workMode = this.resolveActiveReferenceWorkMode();
        if (!policy || !workMode) {
            return {
                success: false,
                code: 'runtime_reference_policy_or_work_mode_missing',
                error: '当前任务没有可用的 reference_policy 或工作模式，无法绑定参考上下文。',
                executesPhotoshop: false,
                grantsPermission: false,
                countsAsObservation: false,
                countsAsTaskProgress: false
            };
        }
        const context = this.buildReferenceContextState();
        const validation = validateRuntimeReferenceBriefDeclaration({
            value,
            policy,
            workMode,
            context
        });
        if (!validation.ok || !validation.declaration) {
            const firstIssue = validation.issues[0];
            const validationSummary = firstIssue
                ? `${firstIssue.code} (${firstIssue.path})`
                : 'unknown_validation_issue';
            return {
                success: false,
                code: 'runtime_reference_brief_declaration_invalid',
                error: `runtime_reference_brief_declaration_invalid: ${validationSummary}`,
                message: `Reference Brief 声明未通过结构校验：${validationSummary}`,
                issues: validation.issues,
                readiness: validation.readiness,
                executesPhotoshop: false,
                grantsPermission: false,
                countsAsObservation: false,
                countsAsTaskProgress: false
            };
        }
        // R2 参考决策是 R3 的输入；重新声明后旧策略和旧计划必须失效。
        this.runtimeDesignStrategyDeclaration = undefined;
        this.runtimeActionPlanDeclaration = undefined;
        this.runtimeActionPlanExecutionJournal = undefined;
        this.runtimeActionExecutionEnvelopeByCallId.clear();
        this.runtimeReferenceBriefDeclaration = validation.declaration;
        this.reconcileReferenceFailureDispositions();
        return {
            success: true,
            readiness: validation.declaration.readiness,
            referenceBriefDigest: buildRuntimeReferenceBriefDigest({
                declaration: validation.declaration,
                context
            }),
            executesPhotoshop: false,
            grantsPermission: false,
            countsAsObservation: false,
            countsAsTaskProgress: false
        };
    }

    private executeDesignStrategyDeclaration(value: unknown): any {
        const validation = validateRuntimeDesignStrategyDeclaration({
            value,
            allowedContextRefs: this.buildDesignStrategyContextRefs()
        });
        if (!validation.ok || !validation.declaration) {
            // 校验失败必须告诉模型错在哪——空错误信息只会让它带着同一缺陷反复重声明。
            const firstIssue = validation.issues[0];
            const validationSummary = firstIssue
                ? `${firstIssue.code} (${firstIssue.path})`
                : 'unknown_validation_issue';
            return {
                success: false,
                code: 'design_strategy_declaration_invalid',
                error: `design_strategy_declaration_invalid: ${validationSummary}`,
                message: `Design Strategy 声明未通过结构校验：${validationSummary}`,
                issues: validation.issues,
                readiness: validation.readiness,
                executesPhotoshop: false,
                grantsPermission: false,
                countsAsObservation: false,
                countsAsTaskProgress: false
            };
        }
        // 策略被重新声明后，已存 R4 计划锚定的旧策略即失效：必须作废计划，
        // 否则收尾 digest 会把计划配对到它从未校验过的策略（对抗核验 2026-07-10）。
        this.runtimeActionPlanDeclaration = undefined;
        this.runtimeActionPlanExecutionJournal = undefined;
        this.runtimeActionExecutionEnvelopeByCallId.clear();
        this.runtimeDesignStrategyDeclaration = validation.declaration;
        // 工具结果只回 digest：完整声明会经 thinkingSteps[].toolResult 落进对话长期档案，
        // 违反 digest-only 持久化红线；模型也不需要自己刚提交的 payload 原样回传。
        return {
            success: true,
            readiness: validation.declaration.readiness,
            strategyDigest: buildRuntimeDesignStrategyDigest(validation.declaration),
            executesPhotoshop: false,
            grantsPermission: false,
            countsAsObservation: false,
            countsAsTaskProgress: false
        };
    }

    private async executeRuntimeActionPlanDeclaration(value: unknown): Promise<any> {
        const actionPlanRuntime = await this.loadRuntimeActionPlanModule();
        const strategyDigest = this.runtimeDesignStrategyDeclaration
            ? buildRuntimeDesignStrategyDigest(this.runtimeDesignStrategyDeclaration)
            : undefined;
        const capabilityContext = this.buildCurrentRuntimeActionPlanCapabilityContext(
            actionPlanRuntime
        );
        const validation = actionPlanRuntime.validateRuntimeActionPlanDeclaration({
            value,
            strategyDigest,
            requiredDeliverables: this.runtimeDesignBriefDeclaration?.payload.deliverables || [],
            workflowCapabilityRefs: this.resolveCurrentManifestWorkflowCapabilityRefs(
                capabilityContext
            ),
            requiresPhotoshopMutation: this.resolveRuntimeDesignBriefEffectiveContract()
                ?.productionObligation === 'photoshop_mutation_with_readback',
            allowedContextRefs: this.buildActionPlanContextRefs(),
            capabilityContext,
            resumeFreshness: this.config.runtimeActionPlanResumeFreshness,
            forbiddenToolNames: this.config.tools.map((tool) => tool.name)
        });
        if (!validation.ok || !validation.declaration) {
            const firstIssue = validation.issues[0];
            const validationSummary = firstIssue
                ? `${firstIssue.code}${firstIssue.path ? ` (${firstIssue.path})` : ''}`
                : 'unknown_validation_issue';
            return {
                success: false,
                code: 'runtime_action_plan_declaration_invalid',
                error: `runtime_action_plan_declaration_invalid: ${validationSummary}`,
                message: `Action Plan 声明未通过结构校验：${validationSummary}`,
                issues: validation.issues,
                readiness: validation.readiness,
                executesPhotoshop: false,
                grantsPermission: false,
                autoActivatesCapabilities: false,
                schedulerAuthority: false,
                countsAsObservation: false,
                countsAsTaskProgress: false
            };
        }
        this.runtimeActionPlanDeclaration = validation.declaration;
        if (this.runtimeSession) {
            this.runtimeSession = bindRuntimeSessionActionPlan({
                session: this.runtimeSession,
                declaration: validation.declaration
            });
        }
        // 每次计划重新声明都开启新代次；旧计划观察不能污染新图。
        this.runtimeActionPlanExecutionJournal = validation.declaration.readiness === 'ready'
            ? createRuntimeActionPlanExecutionJournal()
            : undefined;
        this.runtimeActionExecutionEnvelopeByCallId.clear();
        // 工具结果只回 digest（同 R3）：完整声明仅保留在本轮有界 result data，
        // 不得经工具结果流入对话持久化通道。
        return {
            success: true,
            readiness: validation.declaration.readiness,
            missingCapabilityRefs: validation.declaration.missingCapabilityRefs,
            ...(strategyDigest
                ? {
                    actionPlanDigest: actionPlanRuntime.buildRuntimeActionPlanDigest({
                        declaration: validation.declaration,
                        strategyDigest
                    })
                }
                : {}),
            executesPhotoshop: false,
            grantsPermission: false,
            autoActivatesCapabilities: false,
            schedulerAuthority: false,
            countsAsObservation: false,
            countsAsTaskProgress: false
        };
    }

    private recordRuntimeStageNovelFacts(call: ToolCall, result: any): void {
        const stage = this.runtimeSession?.stageState.currentStage;
        // 当前只用于解决 E1 探索空转；R1-R4 各自已有声明/观察预算，不能因多读一种
        // 上下文就不断推迟阶段 owner。
        if (stage !== 'E1' || result?.success === false || isPolicyGateResult(result)) return;
        const toolKind = classifyAgentToolExecution(call.name, call.arguments);
        if (toolKind !== 'read_only_observation' && toolKind !== 'knowledge_search') return;
        const fingerprint = buildRuntimeNovelFactFingerprint(result);
        if (!fingerprint) return;
        const fingerprints = this.runtimeStageNovelFactFingerprints.get(stage) || new Set<string>();
        fingerprints.add(fingerprint);
        this.runtimeStageNovelFactFingerprints.set(stage, fingerprints);
    }

    private recordToolResultStageTrace(call: ToolCall, result: any): void {
        this.recordRuntimeStageNovelFacts(call, result);
        // 缓存复用只把既有结果返回模型，不能改变目标、推进 Stage 或满足 R2 重观察。
        if (isAgentReadResultCacheHit(result)) return;
        this.updateRuntimeExecutionTarget(call, result);
        const observedToolKind = classifyAgentToolExecution(call.name, call.arguments);
        const observedRevision = result?.success !== false
            && observedToolKind === 'read_only_observation'
            ? readPhotoshopHistoryStateRef(result)
            : undefined;
        if (this.runtimeSession && observedRevision) {
            this.runtimeSession = this.config.runtimeStagePlan
                ? reconcileRuntimeSessionDocumentRevision({
                    session: this.runtimeSession,
                    plan: this.config.runtimeStagePlan,
                    revision: observedRevision
                })
                : observeRuntimeSessionDocumentRevision({
                    session: this.runtimeSession,
                    revision: observedRevision
                });
        }
        if (isDesignBriefControlTool(call.name)) {
            const declaration = result?.success !== false ? this.runtimeDesignBriefDeclaration : undefined;
            const outcome = result?.success !== false && declaration
                ? (declaration.readiness === 'ready' ? 'passed' : 'needs_review')
                : 'failed';
            const observedOutcomes = result?.success !== false && declaration
                ? ['required_inputs_checked', 'blocking_inputs_identified']
                : [];
            this.appendStageTraceEvent({
                stage: 'R1',
                source: 'brief_declaration',
                outcome,
                observedOutcomes,
                iteration: this.iteration + 1,
                toolName: call.name,
                toolKind: 'stateful_context'
            });
            this.evaluateRuntimeStage({
                stage: 'R1',
                outcome,
                observedOutcomes,
                reason: 'R1 Design Brief 已通过专用 validator 形成结构化评价。'
            });
            const hasAttachedImageObservation = this.attachedImageObservationAvailable
                && canAttachedImageObservationSatisfyRuntimeR2(this.config.runtimeStagePlan);
            // R1 只允许读取和声明，不可能修改 Photoshop。因此同一 Session
            // 在 Brief 前已经取得的结构化 readback 仍然是新鲜的 R2 事实，不应强迫模型
            // 重复读取。过去只认 harness 开工快照，会使禁用视觉预算的 Skill 卡死在 R2。
            const priorReadbackObservation = this.findLatestSuccessfulRuntimeR2Observation();
            if (result?.success !== false
                && declaration
                && declaration.readiness === 'ready'
                && (hasAttachedImageObservation || priorReadbackObservation)
                && !this.initialVisualObservationTraceRecorded) {
                let source: RuntimeStageTraceEventInput['source'] = 'tool_result';
                let reason = 'R1 期间已取得同一 Session 的结构化读回，直接承接为 R2 事实。';
                if (hasAttachedImageObservation) {
                    source = 'attached_image_observation';
                    reason = '用户附件已由视觉模型真实读取，可作为当前设计任务的视觉观察。';
                } else if (priorReadbackObservation?.origin === 'harness_opening_observation') {
                    source = 'opening_observation';
                    reason = '已取得开工画布的结构化观察结果。';
                }
                const r2Outcomes = this.buildRuntimeR2Outcomes();
                this.appendStageTraceEvent({
                    stage: 'R2',
                    source,
                    outcome: 'passed',
                    observedOutcomes: r2Outcomes,
                    iteration: this.iteration + 1,
                    ...(hasAttachedImageObservation || !priorReadbackObservation
                        ? {}
                        : {
                            toolName: priorReadbackObservation.name,
                            toolKind: 'read_only_observation' as const
                        })
                });
                this.evaluateRuntimeStage({
                    stage: 'R2',
                    outcome: 'passed',
                    observedOutcomes: r2Outcomes,
                    reason
                });
                this.initialVisualObservationTraceRecorded = true;
            }
            return;
        }
        if (isReferenceBriefControlTool(call.name)) {
            const declaration = result?.success !== false ? this.runtimeReferenceBriefDeclaration : undefined;
            const outcome = result?.success !== false && declaration
                ? (declaration.readiness === 'degraded' ? 'needs_review' : 'passed')
                : 'failed';
            const observedOutcomes = result?.success !== false && declaration
                ? ['reference_context_resolved']
                : [];
            this.appendStageTraceEvent({
                stage: 'R2',
                source: 'reference_brief_declaration',
                outcome,
                observedOutcomes,
                iteration: this.iteration + 1,
                toolName: call.name,
                toolKind: 'stateful_context'
            });
            this.evaluateRuntimeStage({
                stage: 'R2',
                outcome,
                observedOutcomes,
                reason: this.buildRuntimeReferenceStageReason(declaration)
            });
            return;
        }
        if (isDesignStrategyControlTool(call.name)) {
            // 工具结果不携带完整声明（digest-only）；成功调用后声明一定已写入内部状态。
            const declaration = result?.success !== false ? this.runtimeDesignStrategyDeclaration : undefined;
            const outcome = result?.success !== false && declaration
                ? (declaration.readiness === 'ready' ? 'passed' : 'needs_review')
                : 'failed';
            const observedOutcomes = result?.success !== false && declaration
                ? ['design_strategy_recorded', 'stage_goal_defined']
                : [];
            this.appendStageTraceEvent({
                stage: 'R3',
                source: 'strategy_declaration',
                outcome,
                observedOutcomes,
                iteration: this.iteration + 1,
                toolName: call.name,
                toolKind: 'stateful_context'
            });
            this.evaluateRuntimeStage({
                stage: 'R3',
                outcome,
                observedOutcomes,
                reason: 'R3 Design Strategy 已通过专用 validator 形成结构化评价。'
            });
            return;
        }
        if (isRuntimeActionPlanControlTool(call.name)) {
            // 同 R3：从内部状态取声明，工具结果只含 digest。
            const declaration = result?.success !== false ? this.runtimeActionPlanDeclaration : undefined;
            const outcome = result?.success !== false && declaration
                ? (declaration.readiness === 'ready' ? 'passed' : 'needs_review')
                : 'failed';
            const observedOutcomes = result?.success !== false && declaration
                ? ['preview_or_action_plan', 'stage_output_candidate']
                : [];
            this.appendStageTraceEvent({
                stage: 'R4',
                source: 'action_plan_declaration',
                outcome,
                observedOutcomes,
                iteration: this.iteration + 1,
                toolName: call.name,
                toolKind: 'stateful_context'
            });
            this.evaluateRuntimeStage({
                stage: 'R4',
                outcome,
                observedOutcomes,
                reason: 'R4 Action Plan 已通过专用 validator 与 Capability 校验。'
            });
            if (outcome === 'passed' && declaration?.readiness === 'ready') {
                this.emitTaskPlanPresentation();
            }
            return;
        }
        const executionEnvelope = this.runtimeActionExecutionEnvelopeByCallId.get(call.id);
        this.runtimeActionExecutionEnvelopeByCallId.delete(call.id);
        const operationResult = readPhotoshopOperationResult(result);
        const operationResultMatchesEnvelope = !executionEnvelope
            || operationResult?.toolName === executionEnvelope.providerName;
        const planStepRunObservation = operationResultMatchesEnvelope
            ? this.recordActionPlanExecutionObservation(call, result)
            : undefined;
        if (this.runtimeSession && operationResult && operationResultMatchesEnvelope) {
            const reconciliation = planStepRunObservation
                ? this.reconcileRuntimeActionPlanExecution()
                : undefined;
            const attribution = planStepRunObservation
                ? reconciliation?.attributions.find((candidate) => (
                    candidate.observationSequence === planStepRunObservation.sequence
                    && candidate.outcome === 'attributed'
                ))
                : undefined;
            let operationNodeId = attribution?.stepId;
            if (executionEnvelope?.nodeId) operationNodeId = executionEnvelope.nodeId;
            this.runtimeSession = recordRuntimeSessionOperationResult({
                session: this.runtimeSession,
                result,
                ...(operationNodeId ? { nodeId: operationNodeId } : {})
            });
        } else if (this.runtimeSession && executionEnvelope) {
            this.runtimeSession = recordRuntimeSessionNodeResultUnbound({
                session: this.runtimeSession,
                nodeId: executionEnvelope.nodeId,
                knownNotExecuted: !operationResult
                    && (isPolicyGateResult(result) || result?.executesPhotoshop === false),
                reason: operationResult ? 'provider_mismatch' : 'missing'
            });
        }
        if (isAgentHarnessControlTool(call.name) || isPolicyGateResult(result)) return;
        const toolKind = classifyAgentToolExecution(call.name, call.arguments);
        if (toolKind === 'knowledge_search' || toolKind === 'stateful_context' || toolKind === 'unknown') return;
        this.capturePhotoshopOperationReadbackRequirement(
            call,
            result,
            planStepRunObservation
        );
        if (toolKind === 'read_only_observation'
            && this.handlePendingRuntimeActionMutationReadback(
                call,
                result,
                planStepRunObservation
            )) {
            return;
        }
        const succeeded = toolKind === 'read_only_observation'
            ? this.isSuccessfulRuntimeToolObservation(call, result)
            : result?.success !== false;
        // Stage Trace 是阶段裁决账本，不是原始 Tool 日志。只记录当前 owner
        // 真正消费的结果；否则 R1 每次读取都会预写 R2/E1，造成无 transition
        // 的未来事件，并可能错配后续阶段。R1 的新鲜读回由 Brief 成功后的 carry-forward 记账。
        if (toolKind === 'read_only_observation' && this.isCurrentRuntimeStage('R2')) {
            // 从零设计的死锁解法：无文档（documentState:'absent' / errorCode:'no_active_document'）不是
            // 「观察失败」，而是「已确认空画布起点」。建画布能力(createDocument)在 E1，若因无文档卡死在 R2
            // 就永远到不了 E1、无进展被杀（真机详情页从零设计即此）。只对「不需要已打开文档的从零任务」放行，
            // 让 R2→R3→R4→E1 后再建画布；edit_existing/redesign 等需文档的 workMode 仍记 failed，保留先观察纪律。
            // 只改 R2 阶段裁决，不动写入门与可见性门——E1 写权限仍由执行门(currentStage==='E1')独家把守。
            const observedEmptyCanvasFromScratch = !succeeded
                && (result?.documentState === 'absent' || result?.errorCode === 'no_active_document')
                && this.isFromScratchDesignTask();
            const r2Passed = succeeded || observedEmptyCanvasFromScratch;
            const r2Outcomes = r2Passed
                ? this.buildRuntimeR2Outcomes()
                : [];
            const documentBinding = this.runtimeSession?.taskRun.documentBinding;
            if (succeeded
                && observedRevision
                && this.runtimeSession
                && this.config.runtimeStagePlan
                && isAgentPhotoshopDocumentObservation(call.name, call.arguments)
                && (documentBinding?.status === 'needs_reobserve'
                    || documentBinding?.status === 'conflict')
                && !this.config.runtimeStagePlan.steps.some((step) => step.stage === 'R4')) {
                this.runtimeSession = acknowledgeRuntimeSessionWorkflowDocumentReobservation({
                    session: this.runtimeSession,
                    plan: this.config.runtimeStagePlan,
                    observedRevision
                });
            }
            this.appendStageTraceEvent({
                stage: 'R2',
                source: 'tool_result',
                outcome: r2Passed ? 'passed' : 'failed',
                observedOutcomes: r2Outcomes,
                iteration: this.iteration + 1,
                toolName: call.name,
                toolKind
            });
            this.evaluateRuntimeStage({
                stage: 'R2',
                outcome: r2Passed ? 'passed' : 'failed',
                observedOutcomes: r2Outcomes,
                reason: observedEmptyCanvasFromScratch
                    ? '从零设计已确认当前无文档（空画布起点），进入创建阶段后先建画布。'
                    : '当前 R2 阶段取得结构化只读观察。'
            });
        }
        if (this.isCurrentRuntimeStage('E1')) {
            const e1Credit = this.resolveRuntimeE1VerificationCredit(
                call,
                result,
                planStepRunObservation,
                succeeded
            );
            const providerHandoff = this.resolveRuntimeActionProviderHandoff(
                call,
                result,
                planStepRunObservation
            );
            const e1Outcomes = e1Credit.observedOutcomes;
            const e1Outcome = providerHandoff ? 'needs_review' : e1Credit.outcome;
            const e1Reason = providerHandoff
                ? `当前复合能力已明确交回同一目标以拆解执行：${providerHandoff.reason}`
                : e1Credit.reason;
            this.appendStageTraceEvent({
                stage: 'E1',
                source: 'tool_result',
                outcome: e1Outcome,
                observedOutcomes: e1Outcomes,
                iteration: this.iteration + 1,
                toolName: call.name,
                toolKind
            });
            if (providerHandoff
                && planStepRunObservation
                && this.replanRuntimeActionAfterProviderHandoff(
                    call,
                    planStepRunObservation,
                    e1Reason
                )) {
                return;
            }
            if (e1Outcome === 'failed'
                && this.replanRuntimeActionAfterProviderFailure(
                    call,
                    result,
                    planStepRunObservation,
                    e1Reason
                )) {
                return;
            }
            this.evaluateRuntimeStage({
                stage: 'E1',
                outcome: e1Outcome,
                observedOutcomes: e1Outcomes,
                reason: e1Reason
            });
        }
        if (planStepRunObservation) {
            this.emitTaskPlanPresentation(this.reconcileRuntimeActionPlanExecution());
        }
    }

    private updateRuntimeExecutionTarget(call: ToolCall, result: any): void {
        if (result?.success === false || isAgentHarnessControlTool(call.name) || isPolicyGateResult(result)) return;
        const toolKind = classifyAgentToolExecution(call.name, call.arguments);
        if (toolKind !== 'read_only_observation'
            && toolKind !== 'photoshop_write'
            && toolKind !== 'save_export'
            && toolKind !== 'stateful_context') {
            return;
        }
        const target = resolveRuntimeExecutionTarget({
            arguments: call.arguments,
            result,
            previous: this.runtimeExecutionTarget
        });
        if (target) this.runtimeExecutionTarget = target;
    }

    private recordActionPlanExecutionObservation(
        call: ToolCall,
        result: any
    ): RuntimeActionPlanExecutionObservation | undefined {
        if (this.runtimeActionPlanDeclaration?.readiness !== 'ready'
            || !this.runtimeActionPlanExecutionJournal
            || isAgentHarnessControlTool(call.name)
            || isPolicyGateResult(result)) {
            return undefined;
        }
        const toolKind = classifyAgentToolExecution(call.name, call.arguments);
        const capabilityRefs = this.resolveRuntimeCapabilityRefsForTool(call.name);
        const target = resolveRuntimeExecutionTarget({
            arguments: call.arguments,
            result,
            previous: this.runtimeExecutionTarget
        });
        const mutationProof = toolKind === 'photoshop_write'
            ? findObservedPhotoshopMutationProof(result)
            : undefined;
        const operationResult = toolKind === 'photoshop_write'
            ? readPhotoshopOperationResult(result)
            : undefined;
        const operationApplied = operationResult?.applicationStatus === 'applied';
        const pendingMutationSequence = toolKind === 'read_only_observation'
            && target
            && sameRuntimeExecutionDocument(
                this.pendingRuntimeActionMutationReadback?.target,
                target
            )
            ? this.pendingRuntimeActionMutationReadback?.mutationObservationSequence
            : undefined;
        const readbackOfMutationSequence = toolKind === 'read_only_observation' && target
            ? pendingMutationSequence
                || [...this.runtimeActionPlanExecutionJournal.observations].reverse().find((entry) => (
                    entry.operationKind === 'photoshop_write'
                    && entry.outcome === 'succeeded'
                    && entry.target?.documentRef === target.documentRef
                ))?.sequence
            : undefined;
        this.runtimeActionPlanExecutionJournal = appendRuntimeActionPlanExecutionObservation({
            journal: this.runtimeActionPlanExecutionJournal,
            observation: {
                capabilityRefs,
                toolKind,
                outcome: result?.success === false
                    && mutationProof?.toolActionCompleted !== true
                    ? 'failed'
                    : 'succeeded',
                executionRef: call.id,
                ...(mutationProof || operationApplied
                    ? { stateChangeObserved: true }
                    : {}),
                iteration: this.iteration + 1,
                ...(target ? { target } : {}),
                ...(readbackOfMutationSequence ? { readbackOfMutationSequence } : {})
            }
        });
        return this.runtimeActionPlanExecutionJournal.observations[
            this.runtimeActionPlanExecutionJournal.observations.length - 1
        ];
    }

    private rememberFailedRuntimeActionProvider(
        call: ToolCall,
        observation: RuntimeActionPlanExecutionObservation
    ): void {
        this.failedRuntimeActionProviderNames.add(call.name);
        observation.capabilityRefs.forEach((capabilityRef) => (
            this.failedRuntimeActionCapabilityRefs.add(capabilityRef)
        ));
    }

    private rememberHandedOffRuntimeActionProvider(
        call: ToolCall,
        observation: RuntimeActionPlanExecutionObservation
    ): void {
        this.handedOffRuntimeActionProviderNames.add(call.name);
        observation.capabilityRefs.forEach((capabilityRef) => (
            this.handedOffRuntimeActionCapabilityRefs.add(capabilityRef)
        ));
    }

    private isRuntimeActionProviderUnavailable(providerName: string): boolean {
        return this.failedRuntimeActionProviderNames.has(providerName)
            || this.handedOffRuntimeActionProviderNames.has(providerName);
    }

    private resolveRuntimeActionProviderHandoff(
        call: ToolCall,
        result: any,
        observation: RuntimeActionPlanExecutionObservation | undefined
    ): ReturnType<typeof readRuntimeActionProviderHandoff> {
        if (!observation
            || observation.operationKind !== 'photoshop_write'
            || this.config.toolCapabilityBridge?.workflowEntryTools.includes(call.name) !== true
            || findObservedPhotoshopMutationProof(result)) {
            return undefined;
        }
        return readRuntimeActionProviderHandoff(result);
    }

    private replanRuntimeActionAfterProviderHandoff(
        call: ToolCall,
        observation: RuntimeActionPlanExecutionObservation,
        reason: string
    ): boolean {
        this.rememberHandedOffRuntimeActionProvider(call, observation);
        return this.returnRuntimeActionPlanToR4({
            providerName: call.name,
            planStepId: this.reconcileRuntimeActionPlanExecution()?.attributions.find((entry) => (
                entry.observationSequence === observation.sequence
            ))?.stepId || 'unattributed-provider-handoff',
            reason,
            disposition: 'handed_off'
        });
    }

    /**
     * 写入结果是否「已落地且已被证明」：Host 报 verified，或报 applied 且同一 modal 的
     * history 前进证明（mutation commit / history transition）确认动作完成。
     *
     * 只有这类结果**不**需要模型再花一轮读回：写入事实已经在工具结果里（before/after
     * historyStateId），再让模型读一遍是把同一件事买两次。unknown / verification_failed /
     * applied 却拿不出证明的结果仍按未决处理。真机 2026-08-17 run 469：每次成功 placeImage
     * 后都被迫多花一轮 getDocumentInfo，14 轮只写了 6 层就预算耗尽。
     */
    private isPhotoshopOperationOutcomeSettled(result: unknown): boolean {
        const operation = readPhotoshopOperationResult(result);
        if (!operation) return false;
        if (operation.status === 'verified') return true;
        if (operation.status !== 'applied') return false;
        const proof = findObservedPhotoshopMutationProof(result);
        return Boolean(proof && proof.toolActionCompleted);
    }

    /**
     * 串行写调用先执行、再统一记录 Stage Trace。首个写调用若留下未决 Host 状态，
     * 必须立刻建立本轮写锁，确保同一模型响应中的后续写调用不会抢在结果记账前继续。
     * 已被证明落地的成功写入不建立写锁——串行执行本身已保证后续写调用的预检能看到它的结果。
     */
    private lockFollowingBatchWritesAfterRuntimeActionFailure(
        call: ToolCall,
        result: any
    ): void {
        if (isPolicyGateResult(result)
            || classifyAgentToolExecution(call.name, call.arguments) !== 'photoshop_write') {
            return;
        }
        const operationResult = readPhotoshopOperationResult(result);
        // Host 已明确确认命令未触及文档时，没有现场需要保护，也不能把同批后续
        // 独立写入误判为“替代 provider 不可用”。unknown / applied 仍走下方读回锁。
        if (operationResult?.applicationStatus === 'not_applied') {
            return;
        }
        const mutationProof = findObservedPhotoshopMutationProof(result);
        const operationRequiresReadback = requiresPhotoshopOperationReadback(result)
            && !this.isPhotoshopOperationOutcomeSettled(result);
        if (mutationProof) {
            // 文档已变化：旧只读缓存全部过期；是否锁写取决于结果是否已被证明。
            this.readResultCache.clear();
        }
        if (operationRequiresReadback || (mutationProof && result?.success === false)) {
            this.readResultCache.clear();
            this.currentBatchMutationWriteLocked = true;
        }
        if (result?.success !== false) return;
        if (!this.runtimeSession
            || this.runtimeSession.stageState.currentStage !== 'E1'
            || this.runtimeActionPlanDeclaration?.readiness !== 'ready'
            || !this.runtimeActionPlanExecutionJournal) {
            return;
        }
        if (mutationProof || operationRequiresReadback) {
            return;
        }
        this.runtimeActionProviderRecoveryBlocked = true;
    }

    /**
     * PhotoshopOperationResult 是 Host 执行事实的唯一入口。任何 unknown / applied-but-
     * unverified 结果都建立同一个运行级读回义务；v3 与 v5 共用，不再各自猜测是否可重试。
     */
    private capturePhotoshopOperationReadbackRequirement(
        call: ToolCall,
        result: any,
        observation: RuntimeActionPlanExecutionObservation | undefined
    ): void {
        const toolKind = classifyAgentToolExecution(call.name, call.arguments);
        if ((toolKind !== 'photoshop_write' && toolKind !== 'save_export')
            || !requiresPhotoshopOperationReadback(result)
            || this.pendingRuntimeActionMutationReadback) {
            return;
        }
        // 已被同一 modal history 前进证明落地的 applied 写入不建立读回义务：事实已在结果里，
        // 模型不必为它再花一轮读回（读回义务只留给真正未决的结果）。
        if (this.isPhotoshopOperationOutcomeSettled(result)) {
            this.readResultCache.clear();
            return;
        }
        const operation = readPhotoshopOperationResult(result);
        this.readResultCache.clear();
        const operationDocumentId = operation?.after?.documentId || operation?.before?.documentId;
        const target = observation?.target
            || resolveRuntimeExecutionTarget({
                arguments: call.arguments,
                result,
                previous: this.runtimeExecutionTarget
            })
            || (operationDocumentId
                ? resolveRuntimeExecutionTarget({ result: { documentId: operationDocumentId } })
                : undefined)
            || this.runtimeExecutionTarget;
        const readbackToolNames = this.selectRuntimeActionMutationReadbackToolNames();
        const mutationObservationSequence = observation?.sequence
            ?? Math.max(1, this.toolCallLog.length);
        const failedStepId = `operation-readback-${mutationObservationSequence}`;
        if (target && readbackToolNames.length > 0) {
            this.pendingRuntimeActionMutationReadback = {
                kind: 'operation_unknown',
                failedProviderName: call.name,
                failedStepId,
                mutationObservationSequence,
                target,
                ...(operation?.before ? { operationBefore: operation.before } : {}),
                ...(operation?.operationId ? { operationId: operation.operationId } : {})
            };
            // unknown provider 在本轮不得自动重放；若后续证明 history 未变化，
            // 只恢复其他可用写法，而不是重新开放同一个 provider。
            this.failedRuntimeActionProviderNames.add(call.name);
            this.runtimeActionMutationWriteLocked = true;
        } else {
            // 没有可靠目标或读回 provider 时进入显式终止态，不能留下“有锁、无义务”
            // 的孤儿状态，也不能在下一轮重新开放写入。
            this.runtimeActionProviderRecoveryBlocked = true;
        }

        this.messages.push(createHarnessControlMessage([
            '刚才的 Photoshop 操作结果还不明确。先不要重复修改，也不要换一种写法覆盖现场。',
            target && readbackToolNames.length > 0
                ? '只查看当前文档，确认画面实际变成了什么。'
                : '当前无法可靠查看同一文档，请保留现场并如实说明这一步尚未确认。'
        ].join('\n'), 'photoshop-operation-readback', `photoshop-operation-readback:${operation?.operationId || failedStepId}`));
        this.emitStep({
            kind: 'warning',
            title: '正在核对 Photoshop 实际状态',
            detail: target && readbackToolNames.length > 0
                ? '写入结果尚不能安全判定，已锁定后续修改，只允许读取当前文档。'
                : '写入结果尚不能安全判定，且无法绑定可靠读回目标；已停止后续修改。',
            status: target && readbackToolNames.length > 0 ? 'running' : 'error',
            iteration: this.iteration + 1,
            maxIterations: this.config.maxIterations,
            toolName: call.name,
            toolCallId: call.id,
            issue: 'photoshop_operation_readback_required',
            audience: 'user',
            visibility: 'user_process'
        });
    }

    private returnRuntimeActionPlanToR4(input: {
        providerName: string;
        planStepId: string;
        reason: string;
        disposition: 'failed' | 'handed_off';
        toolCallId?: string;
    }): boolean {
        const plan = this.config.runtimeStagePlan;
        const session = this.runtimeSession;
        if (!plan
            || !session
            || this.runtimeActionPlanRevisionCount >= MAX_RUNTIME_ACTION_PLAN_PROVIDER_REPLAN_ATTEMPTS) {
            return false;
        }
        let replannedSession: RuntimeSession;
        if (input.disposition === 'handed_off') {
            replannedSession = replanRuntimeSessionAfterProviderHandoff({
                session,
                plan,
                replanPolicy: 'replan',
                targetStage: 'R4',
                handoffEvent: {
                    stage: 'E1',
                    outcome: 'needs_review',
                    observedOutcomes: [],
                    reason: input.reason
                }
            });
        } else {
            replannedSession = replanRuntimeSessionAfterProviderFailure({
                session,
                plan,
                failurePolicy: 'replan',
                targetStage: 'R4',
                failedEvent: {
                    stage: 'E1',
                    outcome: 'failed',
                    observedOutcomes: [],
                    reason: input.reason
                }
            });
        }
        if (replannedSession.stageState.currentStage !== 'R4') return false;

        this.runtimeSession = replannedSession;
        this.runtimeActionPlanRevisionCount += 1;
        this.runtimeActionPlanDeclaration = undefined;
        this.runtimeActionPlanExecutionJournal = undefined;
        this.runtimeActionExecutionEnvelopeByCallId.clear();
        this.pendingRuntimeActionMutationReadback = undefined;
        this.runtimeActionMutationWriteLocked = false;
        this.runtimeActionProviderRecoveryBlocked = false;
        let controlMessage = [
            `刚才的执行方式没有完成「${input.planStepId}」。`,
            `保持原设计目标和当前文档不变，调用 ${DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME} 重新安排一次最小可执行方案。`,
            `不要再用 ${input.providerName}；改用当前可用的其他方法，或拆成可撤回的小步操作。`,
            '修改后查看同一文档，再决定是否继续。'
        ].join('\n');
        let controlOrigin = 'runtime-action-provider-replan';
        let controlKey = `runtime-action-provider-replan:${input.planStepId}`;
        let stepKind: AgentStepEvent['kind'] = 'warning';
        let stepTitle = '改用可组合的 Photoshop 操作';
        let stepDetail = '当前动作没有可靠完成，正在保留同一目标并重新规划可验证的操作。';
        let stepIssue = 'runtime_action_provider_replan';
        if (input.disposition === 'handed_off') {
            controlMessage = [
                `「${input.planStepId}」需要改用更细的 Photoshop 操作继续完成。`,
                `保持原设计目标和当前文档不变，调用 ${DECLARE_RUNTIME_ACTION_PLAN_TOOL_NAME} 安排一次最小方案。`,
                `不要重新调用 ${input.providerName}；使用当前可用的操作完成调整。`,
                '调整后重新查看同一文档。'
            ].join('\n');
            controlOrigin = 'runtime-action-provider-handoff';
            controlKey = `runtime-action-provider-handoff:${input.planStepId}`;
            stepKind = 'observation';
            stepTitle = '转入可组合的 Photoshop 操作';
            stepDetail = '复合能力已把同一设计目标交回，正在重新规划可验证的原子动作。';
            stepIssue = 'runtime_action_provider_handoff';
        }
        this.messages.push(createHarnessControlMessage(
            controlMessage,
            controlOrigin,
            controlKey
        ));
        this.emitStep({
            kind: stepKind,
            title: stepTitle,
            detail: stepDetail,
            status: 'running',
            iteration: this.iteration + 1,
            maxIterations: this.config.maxIterations,
            toolName: input.providerName,
            ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
            issue: stepIssue,
            audience: 'user',
            visibility: 'user_process'
        });
        return true;
    }

    private handlePendingRuntimeActionMutationReadback(
        call: ToolCall,
        result: any,
        observation: RuntimeActionPlanExecutionObservation | undefined
    ): boolean {
        const pending = this.pendingRuntimeActionMutationReadback;
        if (!pending) return false;
        const isPhotoshopReadback = classifyAgentToolExecution(
            call.name,
            call.arguments
        ) === 'read_only_observation'
            && isAgentPhotoshopDocumentObservation(call.name, call.arguments)
            && supportsRuntimeActionRepairReadback(
                this.resolveRuntimeCapabilityRefsForTool(call.name),
                call.name
            );
        const readback = result?.success !== false && isPhotoshopReadback
            ? readPhotoshopHistoryStateRef(result)
            : undefined;
        if (pending.kind === 'operation_unknown') {
            const readbackTarget = result?.success !== false && isPhotoshopReadback
                ? resolveRuntimeExecutionTarget({
                    arguments: call.arguments,
                    result
                })
                : undefined;
            const sameDocumentReadback = Boolean(
                readbackTarget
                && sameRuntimeExecutionDocument(pending.target, readbackTarget)
            );
            const unchangedFromOperationBefore = Boolean(
                sameDocumentReadback
                && readback
                && pending.operationBefore
                && samePhotoshopHistoryStateRef(readback, pending.operationBefore)
            );
            if (unchangedFromOperationBefore) {
                const returnedToR4 = this.returnRuntimeActionPlanToR4({
                    providerName: pending.failedProviderName,
                    planStepId: pending.failedStepId,
                    reason: '同一 Photoshop 文档的历史版本仍与失败动作开始前一致；该动作未写入，改用其他 Capability provider。',
                    disposition: 'failed',
                    toolCallId: call.id
                });
                if (!returnedToR4) {
                    this.pendingRuntimeActionMutationReadback = undefined;
                    this.runtimeActionMutationWriteLocked = false;
                    this.runtimeActionProviderRecoveryBlocked = false;
                    this.messages.push(createHarnessControlMessage([
                        '已经重新读取同一 Photoshop 文档，历史版本与刚才动作开始前完全一致。',
                        `可以确认 ${pending.failedProviderName} 没有写入；不要重试同一动作，请使用其他可验证的方法继续。`
                    ].join('\n'), 'photoshop-operation-not-applied', `photoshop-operation-not-applied:${pending.operationId || pending.failedStepId}`));
                }
                this.emitStep({
                    kind: 'observation',
                    title: '已确认上一步没有写入',
                    detail: returnedToR4
                        ? '同文档版本未变化，正在返回执行计划并改用其他可验证方法。'
                        : '同文档版本未变化，已解除写入锁；原失败动作不会自动重试。',
                    status: 'success',
                    iteration: this.iteration + 1,
                    maxIterations: this.config.maxIterations,
                    toolName: call.name,
                    toolCallId: call.id,
                    issue: 'photoshop_operation_not_applied',
                    audience: 'user',
                    visibility: 'user_process'
                });
                return true;
            }
            const genericReadbackAttemptCount = Math.min(
                MAX_OPERATION_UNKNOWN_GENERIC_READBACK_ATTEMPTS,
                (pending.genericReadbackAttemptCount || 0) + (isPhotoshopReadback ? 1 : 0)
            );
            const nextPending: PendingRuntimeActionMutationReadback = {
                ...pending,
                genericReadbackAttemptCount,
                genericReadbackToolNames: Array.from(new Set([
                    ...(pending.genericReadbackToolNames || []),
                    ...(isPhotoshopReadback ? [call.name] : [])
                ]))
            };
            this.pendingRuntimeActionMutationReadback = nextPending;
            this.runtimeActionMutationWriteLocked = true;
            const nextReadbackToolNames = this.selectRuntimeActionMutationReadbackToolNames();
            if (genericReadbackAttemptCount < MAX_OPERATION_UNKNOWN_GENERIC_READBACK_ATTEMPTS
                && nextReadbackToolNames.length > 0) {
                return true;
            }
            this.pendingRuntimeActionMutationReadback = {
                ...nextPending,
                genericReadbackExhausted: true
            };
            this.runtimeActionProviderRecoveryBlocked = true;
            this.messages.push(createHarnessControlMessage([
                sameDocumentReadback
                    ? '已经从两个观察面重新查看当前文档，但仍无法确定刚才的修改是否完整生效。'
                    : '有界读回仍未取得同一 Photoshop 文档的可靠现场。',
                '不要重复修改或换一种写法覆盖现场；保留当前版本，并如实说明这一步尚未确认。'
            ].join('\n'), 'photoshop-operation-readback-insufficient', `photoshop-operation-readback-insufficient:${pending.operationId || pending.failedStepId}`));
            this.emitStep({
                kind: 'warning',
                title: 'Photoshop 写入结果仍无法确认',
                detail: sameDocumentReadback
                    ? '已完成有界的同文档读回，但通用观察仍不足以确认这次具体修改；不会重复写入或改用其他写法。'
                    : '有界读回未能可靠绑定到同一文档；不会重复写入或改用其他写法。',
                status: 'error',
                iteration: this.iteration + 1,
                maxIterations: this.config.maxIterations,
                toolName: call.name,
                toolCallId: call.id,
                issue: 'photoshop_operation_specific_reconciliation_required',
                audience: 'user',
                visibility: 'user_process'
            });
            return true;
        }
        if (!pending.mutationAfter || typeof pending.toolActionCompleted !== 'boolean') {
            return true;
        }
        const disposition = resolveRuntimeActionMutationReadbackDisposition({
            mutationAfter: pending.mutationAfter,
            toolActionCompleted: pending.toolActionCompleted,
            readback,
            readbackContent: inspectRuntimeActionRepairReadbackContent({
                toolName: call.name,
                result
            })
        });
        if (disposition === 'verified_complete' && observation?.readbackOfMutationSequence) {
            this.pendingRuntimeActionMutationReadback = undefined;
            this.runtimeActionMutationWriteLocked = false;
            return false;
        }
        if (disposition === 'replan_repair') {
            this.returnRuntimeActionPlanToR4({
                providerName: pending.failedProviderName,
                planStepId: pending.failedStepId,
                reason: '失败动作已由同一 Photoshop 文档读回；当前状态需要重新规划修复。',
                disposition: 'failed',
                toolCallId: call.id
            });
            return true;
        }
        return true;
    }

    /**
     * Action provider 真实失败后由 Harness 决定安全恢复路径：
     * - 零 mutation 且仍有其他 provider：返回 R4，不依赖模型碰巧选择 replan；
     * - 已有 mutation proof：只允许同文档读回，确认后才完成或返回 R4 修复；
     * - 没有替代 provider：保持失败并诚实停止，不伪造 ready plan。
     */
    private replanRuntimeActionAfterProviderFailure(
        call: ToolCall,
        result: any,
        observation: RuntimeActionPlanExecutionObservation | undefined,
        reason: string
    ): boolean {
        const plan = this.config.runtimeStagePlan;
        const session = this.runtimeSession;
        const declaration = this.runtimeActionPlanDeclaration;
        if (!plan
            || !session
            || !declaration
            || declaration.readiness !== 'ready'
            || result?.success !== false
            || !observation
            || observation.operationKind !== 'photoshop_write'
            || session.stageState.currentStage !== 'E1'
            || !plan.steps.some((step) => step.stage === 'R4')) {
            return false;
        }
        const mutationProof = findObservedPhotoshopMutationProof(result);
        const operationResult = readPhotoshopOperationResult(result);
        this.rememberFailedRuntimeActionProvider(call, observation);
        if (!mutationProof
            && operationResult
            && requiresPhotoshopOperationReadback(result)) {
            // 未决 Host 状态已由 capturePhotoshopOperationReadbackRequirement 统一接管。
            // v5 这里只终止旧计划的普通失败分支，不能创建第二个恢复 owner。
            return true;
        }
        if (mutationProof) {
            // 工具虽然返回失败，但 Host 已确认文档发生变化。旧只读缓存此时全部过期，
            // 后续恢复读取必须真实访问 Photoshop，不能拿变更前快照决定修复路径。
            this.readResultCache.clear();
        }
        const reconciliation = this.reconcileRuntimeActionPlanExecution();
        const attribution = reconciliation?.attributions.find((entry) => (
            entry.observationSequence === observation.sequence
            && entry.outcome === 'attributed'
            && Boolean(entry.stepId)
        ));
        const failedStep = attribution?.stepId
            ? declaration.payload.steps.find((step) => step.stepId === attribution.stepId)
            : undefined;
        const singleResumeStepId = reconciliation?.resumeStepIds.length === 1
            ? reconciliation.resumeStepIds[0]
            : undefined;
        const failedStepId = failedStep?.stepId
            || singleResumeStepId
            || `unattributed-e1-action-${observation.sequence}`;
        if (observation.capabilityRefs.length === 0) {
            const conservativeStep = failedStep
                || declaration.payload.steps.find((step) => step.stepId === singleResumeStepId);
            conservativeStep?.capabilityRefs.forEach((capabilityRef) => (
                this.failedRuntimeActionCapabilityRefs.add(capabilityRef)
            ));
        }
        const actionPlanRuntime = this.runtimeActionPlanModule;
        const capabilityContext = actionPlanRuntime
            ? this.buildCurrentRuntimeActionPlanCapabilityContext(actionPlanRuntime)
            : undefined;
        const readyActionCapabilityRefs = new Set([
            ...(capabilityContext?.activeActionCapabilityRefs || []),
            ...(capabilityContext?.onDemandActionCapabilityRefs || [])
        ]);
        const replacementCapabilityRefs = new Set(
            failedStep?.capabilityRefs || observation.capabilityRefs
        );
        const hasReadyReplacementProvider = failedStep
            ? this.config.tools.some((tool) => {
                const kind = classifyAgentToolExecution(tool.name);
                return !this.isRuntimeActionProviderUnavailable(tool.name)
                    && (this.consecutiveToolFailuresByName.get(tool.name) || 0) === 0
                    && isRuntimeActionPlanStepOperationCompatible(failedStep.kind, kind)
                    && this.resolveRuntimeCapabilityRefsForTool(tool.name)
                        .some((capabilityRef) => (
                            readyActionCapabilityRefs.has(capabilityRef)
                            && replacementCapabilityRefs.has(capabilityRef)
                        ));
            })
            : false;
        // 同节点等价 provider 可直接支持重新规划；若模型在 R4 明确声明 replan，
        // 也允许回到 R4 重新选择能力。两者都不会在 E1 偷换成无关写工具，
        // 且 R4 的重新声明仍受 Capability/operation validator 与修订次数上限约束。
        const allowsPlanRevision = failedStep?.failurePolicy === 'replan';
        const disposition = resolveRuntimeActionProviderFailureDisposition({
            mutationProofObserved: Boolean(mutationProof),
            hasReadyReplacementProvider: hasReadyReplacementProvider || allowsPlanRevision
        });
        if (disposition === 'readback_required' && mutationProof) {
            const target = resolveRuntimeExecutionTarget({
                result: { documentId: mutationProof.after.documentId }
            }) || observation.target;
            const readbackToolNames = this.selectRuntimeActionMutationReadbackToolNames();
            if (!target) {
                this.runtimeActionProviderRecoveryBlocked = true;
                this.messages.push(createHarnessControlMessage([
                    'Photoshop 已经发生变化，但无法确认改动属于哪份文档。',
                    '停止继续修改，保留现场并说明当前结果尚未确认。'
                ].join('\n'), 'runtime-action-mutation-lock', `runtime-action-mutation-lock:${failedStepId}`));
                return true;
            }
            if (readbackToolNames.length === 0) {
                this.runtimeActionProviderRecoveryBlocked = true;
                this.messages.push(createHarnessControlMessage([
                    'Photoshop 已经发生变化，但当前无法重新查看这份文档。',
                    '停止继续修改，保留现场并说明当前结果尚未确认。'
                ].join('\n'), 'runtime-action-readback-unavailable', `runtime-action-readback-unavailable:${failedStepId}`));
                this.emitStep({
                    kind: 'warning',
                    title: '等待可靠的 Photoshop 读回能力',
                    detail: '画面已经发生变化，但当前没有可验证现场的结构或视觉读取能力；为避免盲目覆盖，已锁定后续写入。',
                    status: 'error',
                    iteration: this.iteration + 1,
                    maxIterations: this.config.maxIterations,
                    toolName: call.name,
                    toolCallId: call.id,
                    issue: 'runtime_action_readback_unavailable',
                    audience: 'user',
                    visibility: 'user_process'
                });
                return true;
            }
            this.pendingRuntimeActionMutationReadback = {
                kind: 'mutation_proof',
                failedProviderName: call.name,
                failedStepId,
                mutationObservationSequence: observation.sequence,
                target,
                mutationAfter: mutationProof.after,
                toolActionCompleted: mutationProof.toolActionCompleted
            };
            this.runtimeActionMutationWriteLocked = true;
            this.messages.push(createHarnessControlMessage([
                '刚才的操作虽然报错，但 Photoshop 画面已经变化。',
                '先不要重复修改或换一种写法；只重新查看同一文档，再根据实际画面决定是否修正。'
            ].join('\n'), 'runtime-action-mutation-readback', `runtime-action-mutation-readback:${failedStepId}`));
            return true;
        }
        if (disposition === 'stop') {
            this.runtimeActionProviderRecoveryBlocked = true;
            this.messages.push(createHarnessControlMessage([
                '当前这一步没有完成，而且暂时没有合适的替代方法。',
                '不要继续做无关修改；保留现状并说明还缺哪一步。'
            ].join('\n'), 'runtime-action-provider-unavailable', `runtime-action-provider-unavailable:${failedStepId}`));
            this.emitStep({
                kind: 'warning',
                title: '没有可用的替代执行能力',
                detail: '当前动作没有改动画面，但原执行能力已失败，且没有可用替代能力；已停止后续写入，避免偏离用户目标。',
                status: 'error',
                iteration: this.iteration + 1,
                maxIterations: this.config.maxIterations,
                toolName: call.name,
                toolCallId: call.id,
                issue: 'runtime_action_replacement_provider_unavailable',
                audience: 'user',
                visibility: 'user_process'
            });
            return true;
        }
        if (disposition !== 'replan') return false;
        return this.returnRuntimeActionPlanToR4({
            providerName: call.name,
            planStepId: failedStepId,
            reason,
            disposition: 'failed',
            toolCallId: call.id
        });
    }

    private resolveRuntimeE1VerificationCredit(
        call: ToolCall,
        result: any,
        observation: RuntimeActionPlanExecutionObservation | undefined,
        toolSucceeded: boolean
    ): {
        outcome: 'passed' | 'failed' | 'missing_required_outcomes';
        observedOutcomes: string[];
        reason: string;
    } {
        const hasActionPlanStage = Boolean(
            this.config.runtimeStagePlan?.steps.some((step) => step.stage === 'R4')
        );
        if (!hasActionPlanStage && this.pendingDirectWorkflowHandoff) {
            return this.resolveDirectRuntimeE1VerificationCredit(call, result);
        }
        if (!toolSucceeded) {
            return {
                outcome: 'failed',
                observedOutcomes: [],
                reason: 'E1 动作或读回失败，未形成可归属结果。'
            };
        }
        if (!hasActionPlanStage) {
            return this.resolveDirectRuntimeE1VerificationCredit(call, result);
        }
        if (!observation) {
            return {
                outcome: 'missing_required_outcomes',
                observedOutcomes: [],
                reason: 'E1 结果尚未绑定到当前 R4 计划与目标文档。'
            };
        }
        const reconciliation = this.reconcileRuntimeActionPlanExecution();
        if (!reconciliation) {
            return {
                outcome: 'missing_required_outcomes',
                observedOutcomes: [],
                reason: 'E1 结果尚未绑定到当前 R4 计划与目标文档。'
            };
        }
        const attribution = reconciliation.attributions.find((entry) => (
            entry.observationSequence === observation.sequence
        ));
        if (observation.operationKind === 'photoshop_write') {
            const credited = Boolean(
                observation.target
                && attribution?.outcome === 'attributed'
                && attribution.stepId
                && attribution.observedOutcomes.includes('document_change')
            );
            return {
                outcome: 'missing_required_outcomes',
                observedOutcomes: credited ? ['tool_action_result'] : [],
                reason: credited
                    ? 'E1 写入已唯一归属到 R4 节点和目标文档；仍需同目标后续读回。'
                    : 'E1 写入缺少唯一计划节点或目标文档归属，不能记为有效动作结果。'
            };
        }
        if (observation.operationKind === 'read_only_observation') {
            const binding = reconciliation.verificationBindings.find((entry) => (
                entry.readbackObservationSequence === observation.sequence
            ));
            const executionClosure = this.runtimeActionPlanDeclaration
                ? this.runtimeActionPlanModule?.projectRuntimeActionPlanExecutionClosure({
                    declaration: this.runtimeActionPlanDeclaration,
                    reconciliation
                })
                : undefined;
            const executionComplete = Boolean(binding && executionClosure?.complete);
            let reason = '本次读取未与当前 R4 变更节点及同一目标文档绑定，不能通过 E1。';
            if (executionComplete) {
                reason = 'E1 的全部计划执行节点与 Brief 交付覆盖均已闭合，并完成同目标后续读回。';
            } else if (binding) {
                const pendingSteps = (executionClosure?.pendingStepIds || [])
                    .slice(0, 4)
                    .join('、');
                reason = `本次读回已绑定目标，但行动计划仍有未闭合节点：${
                    pendingSteps || '交付覆盖尚未闭合'
                }。`;
            }
            return {
                outcome: executionComplete ? 'passed' : 'missing_required_outcomes',
                observedOutcomes: binding ? ['tool_observation_recorded'] : [],
                reason
            };
        }
        if (observation.operationKind === 'save_export') {
            const executionClosure = this.runtimeActionPlanDeclaration
                ? this.runtimeActionPlanModule?.projectRuntimeActionPlanExecutionClosure({
                    declaration: this.runtimeActionPlanDeclaration,
                    reconciliation
                })
                : undefined;
            const deliveryAttributed = attribution?.outcome === 'attributed'
                && attribution.observedOutcomes.includes('delivery_record');
            const requiresMutationReadback = this.runtimeActionPlanDeclaration?.payload.steps
                .some((step) => step.kind === 'mutate') === true;
            const hasRequiredReadback = !requiresMutationReadback
                || reconciliation.verificationBindings.length > 0;
            const executionComplete = Boolean(
                deliveryAttributed
                && hasRequiredReadback
                && executionClosure?.complete
            );
            return {
                outcome: executionComplete ? 'passed' : 'missing_required_outcomes',
                observedOutcomes: executionComplete
                    ? ['tool_action_result', 'tool_observation_recorded']
                    : [],
                reason: executionComplete
                    ? 'R4 已声明的全部制作、读回与交付节点均已闭合。'
                    : '交付动作尚未与完整制作计划及必要写后读回共同闭合。'
            };
        }
        return {
            outcome: 'missing_required_outcomes',
            observedOutcomes: [],
            reason: '当前结果不是可绑定的 Photoshop 变更或后续读回。'
        };
    }

    private isPendingDirectWorkflowMutationEvidenceVerified(): boolean {
        const pendingWorkflowHandoff = this.pendingDirectWorkflowHandoff;
        return Boolean(
            pendingWorkflowHandoff
            && pendingWorkflowHandoff.currentEpochMutationCount > 0
            && pendingWorkflowHandoff.mutationEvidence.length > 0
            && pendingWorkflowHandoff.mutationEvidence.every((entry) => entry.verifiedReadback)
        );
    }

    private isPendingDirectWorkflowClosureReadbackTool(
        toolName: string,
        args: any = {}
    ): boolean {
        return isAgentPhotoshopDocumentObservation(toolName, args)
            || isReadOnlyAgentContextTool(toolName);
    }

    private isPendingDirectWorkflowOwnerReentryReady(): boolean {
        return this.pendingDirectWorkflowHandoff?.ownerAccepted !== true
            && this.isPendingDirectWorkflowMutationEvidenceVerified();
    }

    /**
     * 记录 compact Workflow repair epoch 的最新文档变更。
     *
     * 同一文档只保留最后一次 after revision；新的写入会使该文档此前的读回失效。
     * 不同文档的 latest evidence 并存，且跨 owner repair epoch 保留。epoch 计数只证明
     * 当前 owner handoff 后确实又发生过变更，避免复用上一轮证据空转完成。
     */
    private recordPendingDirectWorkflowMutation(
        result: any
    ): RuntimeExecutionTargetAnchor | undefined {
        const pendingWorkflowHandoff = this.pendingDirectWorkflowHandoff;
        if (!pendingWorkflowHandoff) return undefined;
        const mutationProof = findObservedPhotoshopMutationProof(result);
        const mutationTarget = mutationProof
            ? resolveRuntimeExecutionTarget({
                result: { documentId: mutationProof.after.documentId }
            })
            : undefined;
        if (!mutationProof?.toolActionCompleted || !mutationTarget) return undefined;

        const documentKey = String(mutationProof.after.documentId);
        const mutationEvidence = pendingWorkflowHandoff.mutationEvidence
            .filter((entry) => String(entry.after.documentId) !== documentKey);
        mutationEvidence.push({
            target: mutationTarget,
            after: mutationProof.after,
            verifiedReadback: false
        });
        this.pendingDirectWorkflowHandoff = {
            ...pendingWorkflowHandoff,
            currentEpochMutationCount: pendingWorkflowHandoff.currentEpochMutationCount + 1,
            mutationEvidence
        };
        return mutationTarget;
    }

    /**
     * 精简阶段链（没有 R4）的 E1 仍必须满足“真实动作 + 后续读回”，只是不能要求
     * 一个该 Manifest 根本没有的 R4 计划节点。动作 owner 来自 Capability bridge；
     * 文档身份仍使用匿名 target anchor 对账，不因 Skill 成功就直接冒充质量通过。
     */
    private resolveDirectRuntimeE1VerificationCredit(
        call: ToolCall,
        result: any
    ): {
        outcome: 'passed' | 'failed' | 'missing_required_outcomes';
        observedOutcomes: string[];
        reason: string;
    } {
        const toolKind = classifyAgentToolExecution(call.name, call.arguments);
        const pendingWorkflowHandoff = this.pendingDirectWorkflowHandoff;
        if (pendingWorkflowHandoff) {
            const isPendingWorkflowOwner = call.name === pendingWorkflowHandoff.workflowToolName;
            if (result?.success === false && !isPendingWorkflowOwner) {
                return {
                    outcome: 'failed',
                    observedOutcomes: [],
                    reason: 'Workflow 原子修复动作或读回失败；未形成可归属证据，E1 保持未闭合。'
                };
            }
            if (isPendingWorkflowOwner) {
                const workflowOutcome = resolveSkillExecutionOutcome(result);
                const workflowAcceptedRepair = workflowOutcome.status === 'completed';
                // owner 返回新的 repair handoff 时，applyWorkflowContinuationScope 已经开启
                // count=0 的新 epoch。即使该 owner 调用自身带有 mutation proof，也不能把
                // handoff 之前发生的动作倒灌成“新 epoch 已执行”；下一步仍必须有新的原子变更。
                if (!workflowAcceptedRepair) {
                    return {
                        outcome: 'missing_required_outcomes',
                        observedOutcomes: [],
                        reason: `Workflow 重入状态为 ${workflowOutcome.status}；修复尚未被 owner 接受，E1 保持未闭合。`
                    };
                }
                const ownerMutationTarget = this.recordPendingDirectWorkflowMutation(result);
                if (ownerMutationTarget) {
                    this.pendingDirectWorkflowHandoff = {
                        ...this.pendingDirectWorkflowHandoff!,
                        ownerAccepted: true
                    };
                    return {
                        outcome: 'missing_required_outcomes',
                        observedOutcomes: [],
                        reason: 'Workflow owner 已接受 repair 并产生最终 Photoshop 变更；只等待该 latest revision 的精确读回，不再重入 owner。'
                    };
                }
                const mutationEvidenceComplete = this.isPendingDirectWorkflowMutationEvidenceVerified();
                if (workflowAcceptedRepair
                    && mutationEvidenceComplete) {
                    const latestMutation = pendingWorkflowHandoff.mutationEvidence[
                        pendingWorkflowHandoff.mutationEvidence.length - 1
                    ];
                    this.pendingDirectWorkflowHandoff = undefined;
                    this.runtimeDirectExecutionActionTarget = latestMutation.target;
                    return {
                        outcome: 'passed',
                        observedOutcomes: ['tool_action_result', 'tool_observation_recorded'],
                        reason: '声明式原子修复已发生真实变更并完成对应变更版本读回；Workflow owner 重入后接受该结果，精简 E1 闭合。'
                    };
                }
                return {
                    outcome: 'missing_required_outcomes',
                    observedOutcomes: [],
                    reason: 'Workflow owner 虽返回 completed，但当前 repair epoch 尚无新的真实变更或仍缺精确版本读回；E1 保持未闭合。'
                };
            } else if (toolKind === 'photoshop_write') {
                const mutationTarget = this.recordPendingDirectWorkflowMutation(result);
                return {
                    outcome: 'missing_required_outcomes',
                    observedOutcomes: [],
                    reason: mutationTarget
                        ? '已记录 Workflow 交接后的真实原子修复；仍需同文档读回并重入 owner，不能把子动作冒充整个 E1 完成。'
                        : 'Workflow 交接后的写入没有可验证 mutation proof；E1 保持未闭合。'
                };
            } else if (toolKind === 'read_only_observation') {
                const readbackRevision = isAgentPhotoshopDocumentObservation(call.name, call.arguments)
                    ? readPhotoshopHistoryStateRef(result)
                    : undefined;
                const matchingMutationIndex = pendingWorkflowHandoff.mutationEvidence.findIndex((entry) => (
                    samePhotoshopHistoryStateRef(entry.after, readbackRevision)
                ));
                const targetMatches = matchingMutationIndex >= 0;
                if (targetMatches) {
                    const mutationEvidence = pendingWorkflowHandoff.mutationEvidence.map((entry, index) => (
                        index === matchingMutationIndex
                            ? { ...entry, verifiedReadback: true }
                            : entry
                    ));
                    this.pendingDirectWorkflowHandoff = {
                        ...pendingWorkflowHandoff,
                        mutationEvidence
                    };
                    if (pendingWorkflowHandoff.ownerAccepted
                        && this.isPendingDirectWorkflowMutationEvidenceVerified()) {
                        const latestMutation = mutationEvidence[mutationEvidence.length - 1];
                        this.pendingDirectWorkflowHandoff = undefined;
                        this.runtimeDirectExecutionActionTarget = latestMutation.target;
                        return {
                            outcome: 'passed',
                            observedOutcomes: ['tool_action_result', 'tool_observation_recorded'],
                            reason: 'Workflow owner 已接受 repair；其最终 Photoshop 变更完成 exact latest readback，精简 E1 直接闭合。'
                        };
                    }
                }
                let readbackReason = '当前读取没有绑定到 Workflow 原子修复后的确切文档版本；E1 保持未闭合。';
                if (targetMatches) {
                    readbackReason = pendingWorkflowHandoff.ownerAccepted
                        ? 'Workflow owner 已接受 repair；仍有其它 latest mutation 等待精确版本读回，owner 保持关闭。'
                        : '原子修复已由对应 Photoshop 变更版本读回；等待 Workflow owner 重入验收，E1 暂不推进。';
                }
                return {
                    outcome: 'missing_required_outcomes',
                    observedOutcomes: [],
                    reason: readbackReason
                };
            } else {
                return {
                    outcome: 'missing_required_outcomes',
                    observedOutcomes: [],
                    reason: 'Workflow 原子修复义务仍未闭合；当前动作不能替代真实变更、同文档读回和 owner 重入。'
                };
            }
        }
        if (toolKind === 'photoshop_write') {
            const isWorkflowOwner = this.config.toolCapabilityBridge?.workflowEntryTools
                ?.includes(call.name) === true;
            if (isWorkflowOwner) {
                const workflowOutcome = resolveSkillExecutionOutcome(result);
                // 普通 Workflow owner 可在已经产生真实 mutation proof 后进入像素复核；
                // needs_review / executed 只取得“动作已发生”信用，不能闭合上方 pending repair。
                const workflowActionReadyForReadback = workflowOutcome.status === 'completed'
                    || workflowOutcome.status === 'executed'
                    || workflowOutcome.status === 'needs_review';
                if (!workflowActionReadyForReadback) {
                    return {
                        outcome: 'missing_required_outcomes',
                        observedOutcomes: [],
                        reason: `Workflow 当前状态为 ${workflowOutcome.status}；部分完成、待确认、受阻或失败不能记为 E1 已执行动作。`
                    };
                }
            }
            const mutationProof = findObservedPhotoshopMutationProof(result);
            const actionTarget = mutationProof
                ? resolveRuntimeExecutionTarget({
                    result: { documentId: mutationProof.after.documentId }
                })
                : undefined;
            if (!mutationProof || !mutationProof.toolActionCompleted || !actionTarget) {
                return {
                    outcome: 'missing_required_outcomes',
                    observedOutcomes: [],
                    reason: mutationProof && !mutationProof.toolActionCompleted
                        ? 'Photoshop 文档发生过变更，但本次动作没有完整结束；需先修复或继续执行，不能记为 E1 完成动作。'
                        : '本次结果没有可重算的 Photoshop 写前/写后变更事实，不能记为 E1 真实动作。'
                };
            }
            this.runtimeDirectExecutionActionTarget = actionTarget;
            return {
                outcome: 'missing_required_outcomes',
                observedOutcomes: ['tool_action_result'],
                reason: '精简 E1 已记录真实 Photoshop 变更；仍需同一文档的后续读回。'
            };
        }

        if (toolKind === 'read_only_observation') {
            if (!isAgentPhotoshopDocumentObservation(call.name, call.arguments)) {
                return {
                    outcome: 'missing_required_outcomes',
                    observedOutcomes: [],
                    reason: '项目资源、Memory 或其他上下文读取不能替代 Photoshop 改后读回。'
                };
            }
            const stage = this.runtimeSession?.stageState.stages.find((item) => item.stage === 'E1');
            const hasActionResult = stage?.observedOutcomes.includes('tool_action_result') === true;
            // 同文档读回只能信任 Host 返回身份；模型参数不能掩盖返回了另一文档或没有文档。
            const readbackTarget = resolveRuntimeExecutionTarget({ result });
            const targetMatches = sameRuntimeExecutionDocument(
                this.runtimeDirectExecutionActionTarget,
                readbackTarget
            );
            if (hasActionResult && targetMatches) {
                return {
                    outcome: 'passed',
                    observedOutcomes: ['tool_observation_recorded'],
                    reason: '精简 E1 的真实变更已由同一 Photoshop 文档的后续读回闭合。'
                };
            }
            return {
                outcome: 'missing_required_outcomes',
                observedOutcomes: [],
                reason: hasActionResult
                    ? '本次读取没有绑定到已执行动作的目标文档。'
                    : 'E1 尚未发生真实动作；继续读取不能替代执行。'
            };
        }

        if (toolKind === 'external_generation') {
            return {
                outcome: 'missing_required_outcomes',
                observedOutcomes: [],
                reason: '外部生成需要生成资产回执与对应资产读回，不能由 Photoshop 文档读取闭合。'
            };
        }

        return {
            outcome: 'missing_required_outcomes',
            observedOutcomes: [],
            reason: '当前结果不是精简 E1 可接受的真实动作或后续读回。'
        };
    }

    private reconcileRuntimeActionPlanExecution(): RuntimeActionPlanReconciliation | undefined {
        if (!this.runtimeActionPlanDeclaration
            || !this.runtimeActionPlanExecutionJournal
            || !this.runtimeActionPlanModule) {
            return undefined;
        }
        const reconciliation = this.runtimeActionPlanModule.reconcileRuntimeActionPlanExecution({
            declaration: this.runtimeActionPlanDeclaration,
            journal: this.runtimeActionPlanExecutionJournal
        });
        if (this.runtimeSession) {
            this.runtimeSession = synchronizeRuntimeSessionActionPlanNodes({
                session: this.runtimeSession,
                steps: reconciliation.steps.map((step) => ({
                    stepId: step.stepId,
                    status: step.status
                }))
            });
        }
        return reconciliation;
    }

    /**
     * 只在 V0 pack 被 R4 通过一对一叶子 Capability 显式选择时生效。
     * pack 外调用返回 undefined，继续走既有 v3/E1 路径；pack 内调用必须先把
     * R4 node、schema-bound 参数、preflight revision 与 TaskRun writer 原子绑定。
     */
    private prepareRuntimeActionExecutionEnvelope(
        call: ToolCall,
        preflight: AgentToolExecutionPreflight | undefined
    ): any | undefined {
        if (!this.runtimeActionPlanDeclaration
            || !this.runtimeSession
            || !preflight) {
            return undefined;
        }
        const reconciliation = this.reconcileRuntimeActionPlanExecution();
        if (!reconciliation) return undefined;
        const providerSchema = this.config.tools.find((tool) => tool.name === call.name);
        const decision = compileRuntimeActionExecutionEnvelope({
            declaration: this.runtimeActionPlanDeclaration,
            reconciliation,
            session: this.runtimeSession,
            providerCall: {
                id: call.id,
                name: call.name,
                arguments: stripPrivateTargetGuardArgument(call.arguments)
            },
            providerSchema,
            activeCapabilityRefs: this.config.getActiveCapabilityIdsForTool?.(call.name) || [],
            preflight
        });
        if (decision.status === 'not_applicable') return undefined;
        if (!decision.allowed || !decision.envelope) {
            return {
                success: false,
                policyGate: true,
                code: decision.code,
                blockedByRuntimeActionExecutionPack: true,
                blockedTool: call.name,
                error: decision.reason,
                executesPhotoshop: false,
                grantsPermission: false,
                countsAsObservation: false,
                countsAsTaskProgress: false
            };
        }
        const envelope = decision.envelope;
        const started = beginRuntimeSessionNodeExecution({
            session: this.runtimeSession,
            nodeId: envelope.nodeId,
            planRevision: envelope.planRevision,
            planFingerprint: envelope.planFingerprint,
            expectedRevision: {
                documentId: envelope.target.documentId,
                historyStateId: envelope.target.historyStateId
            },
            executionRef: {
                envelopeId: envelope.envelopeId,
                packVersion: envelope.packVersion,
                packId: envelope.packId,
                capabilityRef: envelope.capabilityRef,
                providerName: envelope.providerName,
                providerCallId: envelope.providerCallId,
                argumentFingerprint: envelope.argumentFingerprint,
                planRevision: envelope.planRevision,
                target: {
                    documentId: envelope.target.documentId,
                    historyStateId: envelope.target.historyStateId
                },
                compiledAt: envelope.compiledAt
            }
        });
        this.runtimeSession = started.session;
        if (!started.decision.allowed) {
            return {
                success: false,
                policyGate: true,
                code: started.decision.code || 'runtime_task_run_node_execution_binding_invalid',
                blockedByRuntimeActionExecutionPack: true,
                blockedTool: call.name,
                error: '当前 TaskRun 节点、文档 revision 或 writer 身份已变化；重新观察前不会派发该写入。',
                executesPhotoshop: false,
                grantsPermission: false,
                countsAsObservation: false,
                countsAsTaskProgress: false
            };
        }
        this.runtimeActionExecutionEnvelopeByCallId.set(call.id, envelope);
        return undefined;
    }

    private emitTaskPlanPresentation(
        reconciliation?: RuntimeActionPlanReconciliation
    ): void {
        const callback = this.config.callbacks.onTaskPlanPresentation;
        const scope = this.config.taskPlanPresentationScope;
        if (!callback || !scope) return;
        try {
            const snapshot = this.buildRuntimeTaskSnapshot(reconciliation);
            const presentation = snapshot
                ? buildAgentTaskPlanPresentation({
                    runtimeTaskSnapshot: snapshot,
                    conversationId: scope.conversationId,
                    projectId: scope.projectId
                })
                : undefined;
            if (presentation) {
                callback(presentation);
                return;
            }
            // R4 行动计划声明缺席时退到阶段计划投影：用户至少能看到「打算做什么、做到哪一步」。
            // 实测正式来源 105 次运行 0 次命中，没有这条降级，计划面板等于常年不存在。
            const fallback = this.buildStagePlanFallbackPresentation();
            if (fallback) callback(fallback);
        } catch (error) {
            console.warn('[Agent] 任务计划 UI 投影失败（不影响任务执行）:', error);
        }
    }

    /** 阶段计划降级投影：数据来自 Manifest 复制的 runtimeStagePlan，不依赖模型声明成功。 */
    private buildStagePlanFallbackPresentation(): AgentTaskPlanPresentation | undefined {
        const scope = this.config.taskPlanPresentationScope;
        const plan = this.config.runtimeStagePlan;
        const session = this.runtimeSession;
        if (!scope || !plan || !session) return undefined;
        return buildAgentTaskPlanPresentationFromStagePlan({
            stagePlan: {
                displayName: plan.displayName,
                steps: plan.steps
            },
            currentStage: session.stageState?.currentStage,
            identity: {
                sessionId: session.identity?.sessionId,
                runId: session.identity?.runId,
                generation: session.identity?.generation
            },
            goal: this.config.agentTaskPlan?.designBrief?.goal,
            conversationId: scope.conversationId,
            projectId: scope.projectId
        });
    }

    private buildRuntimeTaskSnapshot(
        reconciliation?: RuntimeActionPlanReconciliation,
        executionSummary?: AgentExecutionSummary,
        runtimeDeliveryVerification?: RuntimeDeliveryVerification
    ): RuntimeTaskSnapshot | undefined {
        if (!this.runtimeSession) return undefined;
        return buildRuntimeTaskSnapshotReadModel({
            runtimeSession: this.runtimeSession,
            ...(this.config.agentTaskPlan ? { taskPlan: this.config.agentTaskPlan } : {}),
            ...(this.runtimeDesignBriefDeclaration
                ? { runtimeDesignBrief: this.runtimeDesignBriefDeclaration }
                : {}),
            ...(this.runtimeActionPlanDeclaration
                ? { runtimeActionPlan: this.runtimeActionPlanDeclaration }
                : {}),
            ...(reconciliation ? { runtimeActionPlanReconciliation: reconciliation } : {}),
            ...(executionSummary ? { executionStatus: executionSummary.status } : {}),
            ...(executionSummary?.designVerdict
                ? { designVerdict: executionSummary.designVerdict }
                : {}),
            ...(runtimeDeliveryVerification ? { runtimeDeliveryVerification } : {})
        });
    }

    private projectDeliveryStageEvidence(
        summary: AgentExecutionSummary
    ): AgentDeliveryStageEvidence {
        const verdictAllowsDeliveryEvidence = summary.designVerdict?.status === 'passed'
            || (summary.status === 'completed'
                && summary.blockers.length === 0
                && (summary.designVerdict?.blockers.length || 0) === 0);
        // E2 evidence is a delivery fact, not a quality verdict. A factually completed
        // design with soft aesthetic findings may still prove that its current reviewed
        // history was saved; the Runtime applies E2 only after the relevant R5 route closes.
        if (!summary.designVerdict || !verdictAllowsDeliveryEvidence) {
            return { deliveryEvidencePassed: false };
        }
        const effectiveContract = this.resolveRuntimeDesignBriefEffectiveContract();
        const requiredOutputs = effectiveContract?.deliveryOutputs || [];
        const findReviewedPreview = (
            target?: RuntimeExecutionTargetAnchor,
            sourceHistoryStateRef?: PhotoshopHistoryStateRef
        ): {
            target: RuntimeExecutionTargetAnchor;
            historyStateRef: PhotoshopHistoryStateRef;
        } | undefined => {
            for (let previewIndex = this.toolCallLog.length - 1; previewIndex >= 0; previewIndex--) {
                const previewEntry = this.toolCallLog[previewIndex];
                if (!previewEntry
                    || previewEntry.result?.success === false
                    || !isFullSurfaceVisualJudgeObservationEntry(previewEntry)) {
                    continue;
                }
                const candidateTarget = resolveRuntimeExecutionTarget({
                    arguments: previewEntry.arguments,
                    result: previewEntry.result
                });
                const candidateHistoryStateRef = readPhotoshopHistoryStateRef(previewEntry.result);
                const finalJudgeReviewed = isFinalQualityReviewedVisualSource({
                    binding: this.finalQualityModelProtocolDigest?.judgeStatus === 'completed'
                        ? this.finalQualityReviewedVisualBinding : undefined,
                    sourceOutput: previewEntry.result,
                    historyStateRef: candidateHistoryStateRef
                });
                if (!candidateTarget
                    || !candidateHistoryStateRef
                    || (readAgentVisualObservation(previewEntry.result)?.reviewed !== true
                        && !finalJudgeReviewed)
                    || (target && !sameRuntimeExecutionDocument(target, candidateTarget))
                    || (sourceHistoryStateRef
                        && !samePhotoshopHistoryStateRef(
                            sourceHistoryStateRef,
                            candidateHistoryStateRef
                        ))) {
                    continue;
                }
                return {
                    target: candidateTarget,
                    historyStateRef: candidateHistoryStateRef
                };
            }
            return undefined;
        };
        const agenticEvidence = projectAgenticFinalDeliveryStageEvidence({ contract: this.config.agenticArtifactContract, summary,
            toolCallLog: this.toolCallLog, reviewedPreview: findReviewedPreview(), iteration: this.iteration + 1
        });
        if (agenticEvidence) return agenticEvidence;
        if (requiredOutputs.length === 0) {
            const savedDelivery = [...this.toolCallLog].reverse().find((entry) => (
                entry.result?.success !== false
                && !isAgentHarnessControlTool(entry.name)
                && classifyAgentToolExecution(entry.name, entry.arguments) === 'save_export'
            ));
            if (!savedDelivery) return { deliveryEvidencePassed: false };
            const sourceHistoryStateRef = readPhotoshopSourceHistoryStateRef(savedDelivery.result);
            const savedDeliveryTarget = resolveRuntimeExecutionTarget({
                arguments: savedDelivery.arguments,
                result: savedDelivery.result
            });
            if (!sourceHistoryStateRef || !savedDeliveryTarget) {
                return { deliveryEvidencePassed: false };
            }
            const reviewedSourceVersion = findReviewedPreview(
                savedDeliveryTarget,
                sourceHistoryStateRef
            );
            if (!reviewedSourceVersion) return { deliveryEvidencePassed: false };
            return {
                deliveryEvidencePassed: true,
                stageTraceEvent: {
                    stage: 'E2',
                    source: 'delivery_result',
                    outcome: 'passed',
                    observedOutcomes: ['user_confirmation_or_delivery_record'],
                    iteration: this.iteration + 1,
                    toolName: savedDelivery.name,
                    toolKind: 'save_export'
                },
                ...(savedDelivery.callId ? { finalDeliveryResultRefs: [savedDelivery.callId] } : {})
            };
        }
        let latestDeliveryVerification: RuntimeDeliveryVerification | undefined;
        const manifestHasAtomicDeliveryBindings = Boolean(
            effectiveContract?.deliveryOutputBindings
            && Object.keys(effectiveContract.deliveryOutputBindings).length > 0
        );
        const latestReviewedPreviewForReceipt = findReviewedPreview();
        for (let receiptIndex = this.toolCallLog.length - 1;
            !manifestHasAtomicDeliveryBindings && receiptIndex >= 0;
            receiptIndex--) {
            const receiptEntry = this.toolCallLog[receiptIndex];
            if (!receiptEntry || receiptEntry.result?.success === false) continue;
            const receipt = readRuntimeDeliveryReceipt(receiptEntry.result);
            if (!receipt) continue;
            const laterEntries = this.toolCallLog.slice(receiptIndex + 1);
            const laterSaveExportExists = laterEntries.some((entry) => (
                entry.result?.success !== false
                && !isAgentHarnessControlTool(entry.name)
                && classifyAgentToolExecution(entry.name, entry.arguments) === 'save_export'
            ));
            const laterContentMutationExists = findLatestObservedPhotoshopMutationIndex(laterEntries) >= 0;
            const laterMutationExists = receipt.settlementScope === 'multi_document_task'
                ? laterContentMutationExists
                : laterSaveExportExists || laterContentMutationExists;
            if (laterMutationExists) continue;
            const receiptTarget = resolveRuntimeExecutionTarget({
                arguments: receiptEntry.arguments,
                result: receiptEntry.result
            });
            if (receipt.settlementScope === 'single_document_revision' && !receiptTarget) continue;

            const multiDocumentTaskBound = receipt.settlementScope === 'multi_document_task'
                && Boolean(receiptEntry.callId)
                && Boolean(getSkillById(receiptEntry.name))
                && receiptIndex === findLatestObservedPhotoshopMutationIndex(this.toolCallLog)
                && receipt.resultRefs.length > 0
                && receipt.resultRefProofs.length === receipt.resultRefs.length
                && receipt.resultRefs.every((resultRef) => (
                    receipt.resultRefProofs.some((proof) => (
                        proof.resultRef === resultRef && proof.effect === 'save_export'
                    ))
                ));

            const reviewedPreview = receipt.settlementScope === 'single_document_revision'
                && latestReviewedPreviewForReceipt
                && sameRuntimeExecutionDocument(
                    receiptTarget,
                    latestReviewedPreviewForReceipt.target
                )
                && samePhotoshopHistoryStateRef(
                    receipt.sourceHistoryStateRef,
                    latestReviewedPreviewForReceipt.historyStateRef
                )
                ? latestReviewedPreviewForReceipt
                : undefined;
            const deliveryVerification = verifyRuntimeDelivery({
                requiredOutputs,
                receipt,
                receiptTarget,
                reviewedPreviewTarget: reviewedPreview?.target,
                reviewedPreviewHistoryStateRef: reviewedPreview?.historyStateRef,
                multiDocumentTaskBound,
                deliveryPlanBindingRequired: effectiveContract?.deliveryPlanBindingRequired === true,
                expectedDeliveryPlanDigest: readRuntimeOwnedSkillDeliveryPlanDigest(receiptEntry.result)
            });
            if (!latestDeliveryVerification) latestDeliveryVerification = deliveryVerification;
            if (deliveryVerification.status !== 'passed') continue;
            return {
                verification: deliveryVerification,
                deliveryEvidencePassed: true,
                stageTraceEvent: {
                    stage: 'E2',
                    source: 'delivery_result',
                    outcome: 'passed',
                    observedOutcomes: ['user_confirmation_or_delivery_record'],
                    iteration: this.iteration + 1
                },
                finalDeliveryResultRefs: [...receipt.resultRefs]
            };
        }

        const reconciliation = this.reconcileRuntimeActionPlanExecution();
        const deliverStepIds = new Set(
            this.runtimeActionPlanDeclaration?.payload.steps
                .filter((step) => step.kind === 'deliver')
                .map((step) => step.stepId)
            || []
        );
        const observationBySequence = new Map(
            (this.runtimeActionPlanExecutionJournal?.observations || []).map((observation) => (
                [observation.sequence, observation]
            ))
        );
        const observationByExecutionRef = new Map(
            (this.runtimeActionPlanExecutionJournal?.observations || []).flatMap((observation) => (
                observation.executionRef ? [[observation.executionRef, observation] as const] : []
            ))
        );
        const attributedDeliveryExecutionRefs = new Set(
            (reconciliation?.attributions || []).flatMap((attribution) => {
                if (attribution.outcome !== 'attributed'
                    || attribution.executionOutcome !== 'succeeded'
                    || !attribution.stepId
                    || !deliverStepIds.has(attribution.stepId)
                    || !attribution.observedOutcomes.includes('delivery_record')) {
                    return [];
                }
                const executionRef = observationBySequence.get(
                    attribution.observationSequence
                )?.executionRef;
                return executionRef ? [executionRef] : [];
            })
        );
        const attributedDeliveryProofs = this.toolCallLog.flatMap((entry) => {
            if (!entry.callId
                || !attributedDeliveryExecutionRefs.has(entry.callId)
                || entry.result?.success === false
                || classifyAgentToolExecution(entry.name, entry.arguments) !== 'save_export') {
                return [];
            }
            const sourceHistoryStateRef = readPhotoshopSourceHistoryStateRef(entry.result);
            const target = resolveRuntimeExecutionTarget({
                arguments: entry.arguments,
                result: entry.result
            });
            const proofKinds = readRuntimeDeliveryProofKinds(entry.result);
            if (!sourceHistoryStateRef || !target || proofKinds.length === 0) return [];
            const executionObservation = observationByExecutionRef.get(entry.callId);
            if (!executionObservation) return [];
            return [{
                resultRef: entry.callId,
                capabilityRefs: [...(executionObservation.capabilityRefs || [])],
                proofKinds,
                sourceHistoryStateRef,
                target
            }];
        });
        // 只能使用本轮最终一张已审全图。若交付后又修改并复核了新版本，旧 save/export
        // 不得通过反向挑选旧截图重新取得 E2 信用。
        const latestReviewedPreview = findReviewedPreview();
        const manifestProjection = projectManifestBoundRuntimeDeliveryReceipt({
            requiredOutputs,
            outputBindings: effectiveContract?.deliveryOutputBindings,
            proofs: attributedDeliveryProofs,
            reviewedPreviewTarget: latestReviewedPreview?.target,
            reviewedPreviewHistoryStateRef: latestReviewedPreview?.historyStateRef
        });
        if (manifestProjection) {
            const deliveryVerification = verifyRuntimeDelivery({
                requiredOutputs,
                receipt: manifestProjection.receipt,
                receiptTarget: manifestProjection.receiptTarget,
                reviewedPreviewTarget: latestReviewedPreview?.target,
                reviewedPreviewHistoryStateRef: latestReviewedPreview?.historyStateRef
            });
            if (!latestDeliveryVerification) latestDeliveryVerification = deliveryVerification;
            if (deliveryVerification.status === 'passed') {
                return {
                    verification: deliveryVerification,
                    deliveryEvidencePassed: true,
                    stageTraceEvent: {
                        stage: 'E2',
                        source: 'delivery_result',
                        outcome: 'passed',
                        observedOutcomes: ['user_confirmation_or_delivery_record'],
                        iteration: this.iteration + 1
                    },
                    finalDeliveryResultRefs: [...manifestProjection.receipt.resultRefs]
                };
            }
        }
        return {
            verification: latestDeliveryVerification || verifyRuntimeDelivery({
                requiredOutputs,
                receipt: undefined,
                receiptTarget: undefined,
                reviewedPreviewTarget: latestReviewedPreview?.target,
                reviewedPreviewHistoryStateRef: latestReviewedPreview?.historyStateRef
            }),
            deliveryEvidencePassed: false
        };
    }

    private appendCompleteToolResultsForAssistantToolCalls(input: {
        assistantToolCalls: ToolCall[];
        toolResults?: ToolResult[];
        fallbackError: string;
        fallbackCode: string;
        fallbackOutput?: Record<string, unknown>;
    }): ToolResult[] {
        const assistantToolCalls = Array.isArray(input.assistantToolCalls) ? input.assistantToolCalls : [];
        const byCallId = new Map<string, ToolResult>();
        for (const result of input.toolResults || []) {
            const callId = String(result?.callId || '').trim();
            if (!callId || byCallId.has(callId)) continue;
            byCallId.set(callId, result);
        }

        const completedResults = assistantToolCalls.map((call) => {
            const existing = byCallId.get(call.id);
            if (existing) return existing;
            return makeSyntheticToolResult(
                call,
                input.fallbackError,
                input.fallbackCode,
                input.fallbackOutput
            );
        });

        const missingCount = completedResults.filter((result) => result.output?.notExecuted === true).length;
        if (missingCount > 0) {
            this.emitStep({
                kind: 'warning',
                title: '已记录未执行步骤',
                detail: `本轮有 ${missingCount} 个步骤没有实际执行，已记录原因并保持上下文完整。`,
                status: 'running',
                iteration: this.iteration + 1,
                maxIterations: this.config.maxIterations,
                issue: input.fallbackCode
            });
        }

        this.messages.push({
            role: 'tool_result',
            toolResults: completedResults.map((item) => ({
                ...item,
                output: this.buildModelToolObservationOutput(
                    assistantToolCalls.find((call) => call.id === item.callId)?.name || 'unknown',
                    item.output
                )
            }))
        });
        return completedResults;
    }

    private buildModelToolObservationOutput(toolName: string, output: unknown): unknown {
        const skill = getSkillById(toolName);
        const sanitized = skill
            ? projectSkillWorkflowOutputForModel(toolName, output, {
                includeDetailedResult: skill.kind === 'operation'
            })
            : sanitizeToolOutputForModel(output);
        const record = sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
            ? sanitized as Record<string, unknown>
            : undefined;
        if (record?.contextEnvelope) return sanitized;
        const untrustedExternal = record?.untrustedExternalContent === true;
        const contextEnvelope = buildRuntimeContextEnvelope({
            source: `${untrustedExternal ? 'external-tool' : 'tool'}:${String(toolName || '').trim().slice(0, 80) || 'unknown'}`,
            trust: untrustedExternal ? 'untrusted_external' : 'tool_observation',
            slot: 'tool_observation'
        });
        if (record) return { ...record, contextEnvelope };
        return { value: sanitized, contextEnvelope };
    }

    /**
     * 确保消息历史中每个 assistant(tool_calls) 都有对应的 tool_result。
     *
     * 400 错误根因："An assistant message with 'tool_calls' must be followed by
     * tool messages responding to each 'tool_call_id'."
     *
     * 这个检查在每轮 callModel 之前执行，不依赖 contextManager.trim 是否触发。
     * 如果发现孤立的 assistant(tool_calls)（后面没有覆盖所有 callId 的 tool_result），
     * 补齐 synthetic tool_result，防止 API 拒绝请求。
     */
    private ensureToolCallProtocolIntegrity(): void {
        for (let i = 0; i < this.messages.length; i++) {
            const msg = this.messages[i];
            if (msg.role !== 'assistant' || !Array.isArray(msg.toolCalls) || msg.toolCalls.length === 0) {
                continue;
            }

            // 查找紧随其后的 tool_result 消息
            const next = this.messages[i + 1];
            if (next && next.role === 'tool_result' && Array.isArray(next.toolResults)) {
                const expectedIds = new Set(
                    msg.toolCalls.map((c) => String(c?.id || '').trim()).filter(Boolean)
                );
                const actualIds = new Set(
                    next.toolResults.map((r) => String(r?.callId || '').trim()).filter(Boolean)
                );
                // 如果所有 callId 都被覆盖，无需修复
                let allCovered = true;
                for (const id of expectedIds) {
                    if (!actualIds.has(id)) {
                        allCovered = false;
                        break;
                    }
                }
                if (allCovered) continue;
            }

            // 没有找到完整的 tool_result：补齐
            // 收集已有的 tool_result 条目（可能在 next 中）
            const existingResults = new Map<string, ToolResult>();
            if (next && next.role === 'tool_result' && Array.isArray(next.toolResults)) {
                for (const r of next.toolResults) {
                    const callId = String(r?.callId || '').trim();
                    if (callId) existingResults.set(callId, r);
                }
            }

            const completedResults: ToolResult[] = msg.toolCalls.map((call) => {
                const existing = existingResults.get(String(call.id || '').trim());
                if (existing) return existing;
                return {
                    callId: call.id,
                    success: false,
                    output: {
                        success: false,
                        error: '本轮工具未执行，已补齐为未执行结果以维持对话协议完整性。',
                        notExecuted: true
                    }
                };
            });

            if (next && next.role === 'tool_result') {
                // 替换不完整的 tool_result
                this.messages[i + 1] = {
                    role: 'tool_result',
                    toolResults: completedResults.map((item) => ({
                        ...item,
                        output: this.buildModelToolObservationOutput(
                            msg.toolCalls?.find((call) => call.id === item.callId)?.name || 'unknown',
                            item.output
                        )
                    }))
                };
            } else {
                // 插入缺失的 tool_result
                this.messages.splice(i + 1, 0, {
                    role: 'tool_result',
                    toolResults: completedResults.map((item) => ({
                        ...item,
                        output: this.buildModelToolObservationOutput(
                            msg.toolCalls?.find((call) => call.id === item.callId)?.name || 'unknown',
                            item.output
                        )
                    }))
                });
            }

            console.warn(
                `[Agent] ensureToolCallProtocolIntegrity: 在消息 ${i} 处补齐了 ` +
                `${completedResults.filter((r) => r.output?.notExecuted).length} 个缺失的 tool_result`
            );
        }
    }

    /**
     * Reset all guard-rail counters to their initial state.
     * Called at the start of each run and whenever a fresh context is needed.
     */
    private resetGuardState(): void {
        this.repeatedToolBatchCount = 0;
        this.consecutiveFailedToolRounds = 0;
        this.consecutiveControlToolNoProgressRounds = 0;
        this.policyGateRepeatState = createPolicyGateRepeatState();
        this.stageIncompleteRecoveryAttempts = 0;
        this.consecutiveToolFailuresByName = new Map();
        this.lastToolFailureReasonByName = new Map();
        this.contractRemediationAttempts = 0;
        this.performanceLedger.reserveZoneObservationCalls = 0;
        this.toolPreflightReplanAttempts = 0;
        this.unfinishedTurnContinuationAttempts = 0;
        this.unfinishedTurnContinuationKey = '';
        this.runtimeControlStageStallCount = 0;
        this.runtimeStageNovelFactFingerprints = new Map();
        this.harnessControlRepairAttemptsByName = new Map();
        this.livenessRecoveryAttemptsByProgressKey = new Map();
        this.providerOutputRecovery.reset();
        this.workflowContinuationScope = undefined;
        this.toolImageObservationCount = 0;
        this.latestDesignVisualJudgeBundleReviewSet = undefined;
        this.latestDesignVisualJudgeSingleReviewSet = undefined;
        this.finalQualityReviewedVisualBinding = undefined;
        this.mutationBoundDesignIntents = [];
        this.pendingPrimaryVisualObservations = [];
        this.userSnapshotEmitCount = 0;
        this.lastUserSnapshotSignature = '';
        this.terminalClosureRecoveryAttempts = 0;
        this.lastTerminalClosureGap = undefined;
        this.terminalClosureQualityCache = undefined;
    }

    private buildSystemPromptWithRuntimeContract(): string {
        const sections = [
            this.config.systemPrompt,
            this.config.getDynamicOperatingContext?.(),
            AGENT_RUNTIME_MESSAGE_BOUNDARY_PROMPT,
            AGENT_REPLY_OUTPUT_DISCIPLINE_PROMPT,
            this.buildRuntimeLoopContractPromptSection(),
            this.buildIncomingImageObservationPromptSection(),
            this.buildRuntimeStagePlanPromptSection(),
            this.buildRuntimeStageContextPromptSection(),
            buildRuntimePlanningContextPrompt({
                digest: this.runtimePlanningContextSeedDigest,
                brief: this.runtimeDesignBriefDeclaration,
                referenceBrief: this.runtimeReferenceBriefDeclaration,
                strategy: this.runtimeDesignStrategyDeclaration,
                actionPlan: this.runtimeActionPlanDeclaration
            }),
            this.buildToolCapabilityBridgePromptSection(),
            buildIncomingReflexionPromptSection(this.config.reflexionHandoff)
        ].filter((section) => String(section || '').trim());
        return sections.join('\n\n');
    }

    private buildRuntimeStageContextPromptSection(): string {
        const items = this.config.runtimeStageContextItems;
        const stage = this.runtimeSession?.stageState.currentStage;
        if (!Array.isArray(items) || items.length === 0) return '';
        // plan-neutral 只接收无阶段限定的 Project State / reviewed memory；R1/R3/R4
        // 方法知识必须等 Runtime 真正绑定后再按当前 Stage 渐进装载。
        const applicableItems = selectRuntimeContextItemsForStage(items, stage);
        if (applicableItems.length === 0) return '';
        const compiled = stage
            ? compileRuntimeContext({
                items: applicableItems,
                stage,
                maxTotalCharacters: this.runtimeContextCharacterBudget
            })
            : compileRuntimeContext({
                items: applicableItems,
                maxTotalCharacters: this.runtimeContextCharacterBudget
            });
        const unexpectedIssues = compiled.issues.filter((issue) => (
            !issue.endsWith(':stage_not_applicable')
        ));
        if (unexpectedIssues.length > 0) {
            console.warn('[Agent] 阶段化知识上下文存在无效项，已忽略对应内容：', unexpectedIssues);
        }
        return compiled.prompt;
    }

    /** RuntimeSession 推进后，下一轮模型只接收当前阶段适用的知识，而不是整份方法论。 */
    private refreshPrimarySystemMessage(): void {
        const systemMessage = this.messages.find((message) => message.role === 'system');
        if (!systemMessage) return;
        systemMessage.content = this.buildSystemPromptWithRuntimeContract();
    }

    private buildIncomingImageObservationPromptSection(): string {
        if (this.currentInputImageCount <= 0) return '';
        const initiallyPresentedCount = Math.min(
            this.currentInputImageCount,
            this.getPerformanceInitialVisionCandidateLimit()
        );
        return [
            `用户这次提供了 ${this.currentInputImageCount} 张图片，当前最多先查看其中 ${initiallyPresentedCount} 张。`,
            '没有实际看到的图片不能描述成已经看过；需要时再查看下一张真正相关的图片。'
        ].join('\n');
    }

    private buildRuntimeLoopContractPromptSection(): string {
        const contract = this.config.runtimeLoopContract;
        if (!contract) return '';
        const selectedMethod = getSkillById(contract.r0.skillId);
        const methodName = String(selectedMethod?.displayName || selectedMethod?.name || '').trim();

        return [
            methodName ? `当前任务可以使用「${methodName}」完成规则明确的部分。` : '',
            '先决定最小的下一步，需要时在 Photoshop 中制作，然后查看实际结果再继续。',
            '当前工具列表就是现在可用的动作；缺少下一步动作时只加入最少的相关能力。',
            '当前效果还没有达到目标时，找出影响最大的缺口并继续调整，不要提前说已经完成。'
        ].filter(Boolean).join('\n');
    }

    private buildToolCapabilityBridgePromptSection(): string {
        const bridge = this.config.toolCapabilityBridge;
        if (!bridge) return '';
        const workflowEntries = (bridge.workflowEntryTools || []).filter(Boolean);
        return [
            workflowEntries.length > 0
                ? '规则明确的生产步骤可以优先使用当前列表中的完整设计方法。'
                : '',
            '只从当前工具列表中选择实际动作；更宽泛的能力名称不是可以直接调用的动作。'
        ].filter(Boolean).join('\n');
    }

    private buildRuntimeStagePlanPromptSection(): string {
        const plan = this.config.runtimeStagePlan;
        if (!plan) return '';
        const declaredWorkMode = this.runtimeDesignBriefDeclaration?.payload.workMode;
        const effectiveWorkMode = plan.expectedWorkMode || declaredWorkMode;
        const currentStage = this.runtimeSession?.stageState.currentStage
            || plan.steps[0]?.stage;
        const stageInstruction: Record<string, string> = {
            R0: '确认当前任务与最合适的工作方法。',
            R1: '把目标、交付内容和已知约束整理清楚；只有真正影响设计方向的输入缺失时才继续查看或提问。',
            R2: '查看当前决定所需的项目素材与画面，得到足够信息后停止读取。',
            R3: '形成清楚的视觉方向、信息层级和版式关系。',
            R4: '把方向整理成可以直接制作的紧凑步骤。',
            E1: '开始制作可编辑版本，并保持每次修改都落在当前目标上。',
            R5: '查看当前效果，只调整最影响目标的几个问题。',
            E2: '保存或导出用户要求的交付物。'
        };
        const waitingForWorkMode = Boolean(
            Object.keys(plan.workModeContracts || {}).length > 0
            && !effectiveWorkMode
        );
        // 紧凑工作流「owner 先行」：owner 自己会读取来源、准备前置并给确认卡；模型在它之前逐层查看只是在替它做功课
        //（真机 08-18：三次同类任务都先看了 6–10 轮才轮到 owner）。R2/E1 期间明说「直接调用它」，写入门禁同口径。
        const ownerFirst = this.resolveCompactWorkflowOwnerFirst();
        const ownerFirstLine = ownerFirst?.pending && currentStage === 'E1'
            ? `这类任务由工作流「${getToolDisplayInfo(ownerFirst.ownerToolName).name}」负责读取来源、准备前置并在需要时给出确认卡：开工文档信息已经足够，直接调用它，不要先逐层查看；它交接出来的范围内再自己动手。`
            : ownerFirst?.pending && currentStage === 'R2'
                ? `工作流「${getToolDisplayInfo(ownerFirst.ownerToolName).name}」会自己读取来源文档并准备前置；这一步只确认开工信息，不要逐层查看图层、文字或智能对象。`
                : '';
        const lines = [
            '当前设计进度：',
            waitingForWorkMode
                ? '先选择与用户任务一致的工作方式，不要套用其他方式的输入要求。'
                : stageInstruction[String(currentStage || '')] || '从当前目标继续完成下一步。',
            ...(ownerFirstLine ? [ownerFirstLine] : []),
            '当前工具列表已经按这一步准备好；直接选择最合适的动作，不用向用户解释内部阶段。'
        ];
        if (plan.referencePolicy && currentStage === 'R2') {
            const referenceRequirement = effectiveWorkMode
                ? getReferenceRequirement(plan.referencePolicy, effectiveWorkMode)
                : undefined;
            lines.push(referenceRequirement === 'not_required'
                ? '当前工作方式不需要额外参考，依据项目和当前画面继续。'
                : '只有参考能实质帮助当前方向时才查看；看到候选名称不等于已经理解其画面。');
        }
        return lines.join('\n');
    }

    private emitRuntimeLoopContractStep(): void {
        const contract = this.config.runtimeLoopContract;
        if (!contract) return;
        this.emitStep({
            kind: 'observation',
            title: '工作流程已接入',
            detail: [
                `${contract.r0.skillId} / ${contract.r0.taskType}`,
                '循环：判断 / 处理 / 观察 / 复核',
                `最终复核失败后进入 ${contract.qualityGate.failTarget}`
            ].join('\n'),
            status: 'running',
            iteration: this.iteration + 1,
            maxIterations: this.config.maxIterations,
            audience: 'agent'
        });
    }

    /**
     * 开工观察分两层：廉价文档身份与昂贵画布像素。
     * 默认不预取；只有结构化 owner 显式选择时，Harness 才在首轮模型调用前观察。
     *
     * 红线（graceful 降级）：无打开文档 / UXP 未连接 / 读取失败
     * → 一律静默跳过，绝不抛错、绝不阻塞任务。主循环照常开始。
     */
    private async injectOpeningCanvasObservation(): Promise<void> {
        try {
            const observationMode = this.config.openingCanvasObservationMode || 'none';
            if (observationMode === 'none') return;

            // 有可靠的「无文档 / 未连接」信号就提前跳过；拿不到可靠信号则不假设。
            // 先读取当前文档身份。R1 的目标依据必须绑定到本次运行内已确认的文档，
            // 不能让一张没有文档锚点的快照承担跨文档事实。
            const decisionContext = this.config.toolDecisionContext;
            if (capabilityBlocksExecution(resolveDeclaredCapabilityVerdict({
                declared: decisionContext?.photoshopConnected,
                subjectLabel: '当前 Photoshop 运行时'
            }, '连接能力'))) return;
            if (capabilityBlocksExecution(resolveDeclaredCapabilityVerdict({
                declared: decisionContext?.hasDocument,
                subjectLabel: '当前 Photoshop 运行时'
            }, '活动文档'))) return;
            if (decisionContext?.intentControlPlane?.toolScope === 'none'
                || this.runIntentControlPlaneDecision?.toolScope === 'none') return;
            if (decisionContext?.currentDocumentUse === 'none') return;
            if (decisionContext?.currentDocumentUse === 'protected') return;
            if (decisionContext?.currentDocumentUse === 'separate_target') return;

            const documentInfoStartedAtMs = Date.now();
            const documentInfoResult = await this.executeToolWithDiagnostics('getDocumentInfo', {});
            this.runtimeSession = this.runtimeAccounting.recordToolCall(this.runtimeSession, {
                durationMs: Date.now() - documentInfoStartedAtMs,
                succeeded: documentInfoResult?.success !== false
            });
            if (!documentInfoResult || documentInfoResult.success === false) return;
            const openingRevision = readPhotoshopHistoryStateRef(documentInfoResult);
            if (this.runtimeSession && openingRevision) {
                this.runtimeSession = observeRuntimeSessionDocumentRevision({
                    session: this.runtimeSession,
                    revision: openingRevision
                });
            }
            const openingDocumentElapsedMs = this.readRunElapsedMsOrUndefined();
            this.toolCallLog.push({
                name: 'getDocumentInfo',
                arguments: {},
                result: documentInfoResult,
                origin: 'harness_opening_observation',
                ...(openingDocumentElapsedMs !== undefined ? { elapsedMs: openingDocumentElapsedMs } : {})
            });
            if (documentInfoResult?.documentState === 'absent') return;

            const documentIdentity = sanitizeToolOutputForModel({
                documentState: documentInfoResult.documentState,
                document: documentInfoResult.document,
                historyStateRef: documentInfoResult.historyStateRef,
                activeDocumentId: documentInfoResult.activeDocumentId,
                activeDocumentName: documentInfoResult.activeDocumentName
            });
            this.messages.push(createRuntimeObservationMessage(
                `（开工只读确认的当前 Photoshop 文档身份：${JSON.stringify(documentIdentity)}。`
                    + '该结构已经包含文档名、尺寸、分辨率、颜色模式、图层数和当前活动图层等基础字段；只要 historyStateRef 没有变化，直接复用这些字段，不要再次请求同一份文档基本信息。'
                    + '这仍只证明活动文档及其历史状态，尚未读取画面像素；不要据此描述或评价视觉效果。）',
                'opening-document-identity',
                { scope: 'current-document-identity' }
            ));
            this.emitStep({
                kind: 'observation',
                title: '已确认当前 Photoshop 文档',
                detail: '已读取活动文档身份；是否查看画面由当前任务需要决定。',
                status: 'success',
                iteration: this.iteration + 1,
                maxIterations: this.config.maxIterations,
                audience: 'agent'
            });

            if (observationMode !== 'canvas_visual') return;

            // 文档身份是 R1 目标事实的 Host 锚点，不属于视觉分析预算；即使本轮不允许
            // 读取像素，也必须保留这次只读身份观察。只有截图本身受视觉预算限制。
            if (this.getPerformanceVisionCandidateLimit() === 0
                && !this.hasPerformanceVisualAnalysisCapacity()) return;

            // getAnnotatedSnapshot 同时返回截图（imageData）+ 图层结构（elements[]）。
            // 走带止损护栏的执行入口，args 用默认（工具 schema 自带默认尺寸/过滤）。
            const startedAtMs = Date.now();
            const result = await this.executeToolWithDiagnostics('getAnnotatedSnapshot', {});
            this.runtimeSession = this.runtimeAccounting.recordToolCall(this.runtimeSession, {
                durationMs: Date.now() - startedAtMs,
                succeeded: result?.success !== false
            });
            if (!result || result.success === false) return;

            const image = extractImageFromToolResult(result);
            const layers = Array.isArray(result.elements)
                ? result.elements
                : (Array.isArray(result.layers) ? result.layers : []);

            // 既没有可用图像、也没有图层结构：没有任何可观察内容，静默跳过。
            if (!image && layers.length === 0) return;

            // 开工预取不是模型显式 Tool call，但它是一次真实、可追溯的只读观察。
            // 进入同一工具日志后，完成检查、任务计划和 UI 计数才能看到同一事实；
            // origin 则保证它不会被误算成模型主动选 Tool 或业务写入进展。
            const openingSnapshotElapsedMs = this.readRunElapsedMsOrUndefined();
            this.toolCallLog.push({
                name: 'getAnnotatedSnapshot',
                arguments: {},
                result,
                origin: 'harness_opening_observation',
                ...(openingSnapshotElapsedMs !== undefined ? { elapsedMs: openingSnapshotElapsedMs } : {})
            });

            // 注入截图：复用已有的视觉观察通道（按视觉策略处理——主模型能读图→直接喂图；
            // 否则→视觉专家转述文字；都没有→如实告知不假装看过）。开工这次占 1 张观察图，
            // 在当前 Skill 的视觉候选预算内可接受。
            if (image) {
                await this.attachToolImageObservations([
                    { callId: 'opening-observation', success: true, output: result }
                ]);
            }

            // 注入结构：把图层结构作为一条 user 文本消息注入，措辞点明这是开工自动观察结果。
            // 结构可能很大，用 sanitizeToolOutputForModel 压一下（超长字段/数组/深度截断），
            // 避免把超长 JSON 原样塞进上下文。
            if (layers.length > 0) {
                const structure = sanitizeToolOutputForModel({
                    document: documentInfoResult?.document,
                    historyStateRef: documentInfoResult?.historyStateRef,
                    documentSize: result.documentSize,
                    snapshotSize: result.snapshotSize,
                    summary: result.summary,
                    layers
                });
                this.messages.push(createRuntimeObservationMessage(
                    decisionContext?.currentDocumentUse === 'observe_only'
                        ? `（开工自动观察到的当前 Photoshop 画布图层结构，仅作为只读上下文；`
                            + `不要修改、保存或导出这个文档：\n${JSON.stringify(structure)}）`
                        : `（开工自动观察到的当前 Photoshop 画布图层结构，供你在此基础上设计/修改，`
                            + `不要假设画布是空白或凭空重建：\n${JSON.stringify(structure)}）`,
                    'opening-canvas-observation',
                    { scope: 'current-canvas-structure' }
                ));
                this.emitStep({
                    kind: 'observation',
                    title: '开工先观察当前画布',
                    detail: `已读取当前文档 ${layers.length} 个图层的结构，随首轮判断一并交给模型。`,
                    status: 'success',
                    iteration: this.iteration + 1,
                    maxIterations: this.config.maxIterations,
                    audience: 'agent'
                });
            }
        } catch (error: any) {
            // graceful：开工观察失败绝不阻塞任务，最多记一句日志后正常返回，主循环照常开始。
            console.info('[agent] 开工自动观察已跳过（不影响任务）：', error?.message || error);
        }
    }

    /**
     * 运行 Agent
     *
     * @param task 用户任务描述
     * @param images 可选的图片附件
     */
    async run(task: string, images?: ImageAttachment[]): Promise<AgentRunResult> {
        this.currentTask = task;
        this.runIntentControlPlaneDecision = this.config.toolDecisionContext?.intentControlPlane
            || buildAgentIntentControlPlaneDecision({
                userInput: task,
                hasImageInput: Array.isArray(images) && images.length > 0,
                hasDocument: this.config.toolDecisionContext?.hasDocument,
                photoshopConnected: this.config.toolDecisionContext?.photoshopConnected
            });
        const requireInitialToolCall = this.shouldRequireInitialToolCallForCurrentTask();
        this.iteration = 0;
        this.toolCallLog = [];
        this.finalQualityModelProtocolDigest = undefined;
        this.pendingTrustedFinalComparisonWrite = undefined;
        this.readResultCache.clear();
        const runStartedAtMs = Date.now();
        resetPerformanceLedgerStateForRun(this.performanceLedger, runStartedAtMs);
        this.currentInputImageCount = Array.isArray(images) ? images.length : 0;
        this.observedInputImageCount = 0;
        this.attachedImageObservationAvailable = false;
        this.initialImagesPendingPrimaryObservation = false;
        this.initialVisualObservationTraceRecorded = false;
        this.runtimeDesignBriefDeclaration = undefined;
        this.runtimeReferenceBriefDeclaration = undefined;
        this.runtimeDesignStrategyDeclaration = undefined;
        this.runtimeActionPlanDeclaration = undefined;
        this.runtimeActionPlanExecutionJournal = undefined;
        this.runtimeActionExecutionEnvelopeByCallId.clear();
        this.runtimeActionPlanRevisionCount = 0;
        this.failedRuntimeActionProviderNames = new Set();
        this.failedRuntimeActionCapabilityRefs = new Set();
        this.handedOffRuntimeActionProviderNames = new Set();
        this.handedOffRuntimeActionCapabilityRefs = new Set();
        this.pendingRuntimeActionMutationReadback = undefined;
        this.runtimeActionMutationWriteLocked = false;
        this.currentBatchMutationWriteLocked = false;
        this.runtimeActionProviderRecoveryBlocked = false;
        this.runtimeExecutionTarget = undefined;
        this.runtimeDirectExecutionActionTarget = undefined;
        this.pendingDirectWorkflowHandoff = undefined;
        if (this.config.runtimeStagePlan && this.config.runtimeSessionSeed) {
            if (this.config.runtimeSessionSeed.finalized) {
                throw new Error('runtime_session_seed_already_finalized');
            }
            if (this.config.runtimeSessionIdentity
                && this.config.runtimeSessionSeed.identity.runId !== this.config.runtimeSessionIdentity.runId) {
                throw new Error('runtime_session_seed_identity_mismatch');
            }
            this.runtimeSession = this.config.runtimeSessionSeed;
            if (this.runtimeSession.identity.generation > 1
                && !this.config.runtimePlanningContextSeed
                && !this.config.runtimeInteractiveReentry) {
                throw new Error('runtime_planning_context_seed_required');
            }
        } else if (this.config.runtimeStagePlan && this.config.runtimeSessionIdentity) {
            if (this.config.runtimeSessionIdentity.generation > 1) {
                throw new Error('runtime_session_generation_seed_required');
            }
            this.runtimeSession = createRuntimeSession({
                identity: this.config.runtimeSessionIdentity,
                plan: this.config.runtimeStagePlan
            });
        } else if (this.config.runtimeStagePlan) {
            throw new Error('runtime_session_identity_required');
        } else {
            this.runtimeSession = undefined;
        }
        this.runtimeAccounting.beginRun(runStartedAtMs, this.runtimeSession);
        this.runtimePlanningContextSeedDigest = undefined;
        const planningSeedState = resolveRuntimePlanningContextSeedState({
            seed: this.config.runtimePlanningContextSeed,
            session: this.runtimeSession,
            plan: this.config.runtimeStagePlan
        });
        if (planningSeedState) Object.assign(this, planningSeedState);
        const interactiveReentryState = resolveRuntimeInteractiveAgentReentryState({
            config: this.config,
            session: this.runtimeSession
        });
        if (interactiveReentryState) Object.assign(this, interactiveReentryState.planning);
        if (this.runtimeDesignBriefDeclaration) {
            this.tightenPerformanceBudgetForDeclaredWorkMode(this.runtimeDesignBriefDeclaration);
        }
        if (this.config.requestPerformanceUsageSeed && !this.config.runtimeSessionIdentity) {
            throw new Error('request_performance_usage_seed_requires_task_run_identity');
        }
        if (this.config.requestPerformanceUsageSeed && this.config.runtimeSessionSeed) {
            throw new Error('request_performance_usage_seed_conflicts_with_runtime_session_seed');
        }
        ({ ledger: this.performanceLedger, iterations: this.iteration } = restorePerformanceLedgerUsage(this.performanceLedger, this.iteration, this.config.requestPerformanceUsageSeed));
        if (this.config.runtimeSessionSeed && this.runtimeSession) {
            const accounting = this.runtimeSession.accounting;
            const performanceUsage = readRuntimeSessionPerformanceUsage(this.runtimeSession);
            const hasDedicatedPerformanceUsage = Boolean(
                (accounting as typeof accounting & { performanceUsage?: unknown }).performanceUsage
            );
            ({ ledger: this.performanceLedger, iterations: this.iteration } = restorePerformanceLedgerUsage(this.performanceLedger, this.iteration, {
                ...performanceUsage,
                modelCalls: hasDedicatedPerformanceUsage
                    ? performanceUsage.modelCalls
                    : accounting.modelCallCount,
                toolCalls: hasDedicatedPerformanceUsage
                    ? performanceUsage.toolCalls
                    : accounting.toolCallCount
            }));
        }
        // Session 与规划上下文必须先通过校验，再进入模型 system prompt；不能先把未校验 seed 暴露给模型。
        const primaryModelSupportsVision = canAttemptModelVision(getModelById(this.config.modelId));
        const primaryModelImages = primaryModelSupportsVision
            && this.hasPerformanceVisualAnalysisCapacity()
            ? this.selectPerformanceVisionCandidates(
                (images || []).slice(0, this.getPerformanceInitialVisionCandidateLimit())
            )
            : [];
        this.initialImagesPendingPrimaryObservation = primaryModelImages.length > 0;
        this.messages = [
            { role: 'system', content: this.buildSystemPromptWithRuntimeContract() },
            // 纯文本主模型不接收无法消费的图片块；视觉模型会在下方先读取并转成结构化观察。
            this.buildUserMessage(task, primaryModelImages, buildIncomingReflexionObservationSection(this.config.reflexionHandoff))
        ];
        this.lastToolBatchSignature = '';
        this.resetGuardState();
        if (interactiveReentryState) Object.assign(this, interactiveReentryState.runtime);
        this.finalizationNudgeSent = false;
        this.taskClosureCapabilityRuntime.reset();
        this.visibleReasoningSent = false;
        this.latestVisiblePreActionRationale = '';
        this.emitStep({
            kind: 'task_started',
            title: '开始处理任务',
            detail: images?.length ? `包含 ${images.length} 张图片输入` : '无图片输入',
            status: 'running',
            percent: 0,
            audience: 'user',
            visibility: 'user_process'
        });
        this.config.callbacks.onProgress?.('开始处理...', 0);
        this.emitRuntimeLoopContractStep();
        await this.attachInitialImageObservations(task, images);

        // 通用 Agent 默认不读 Photoshop；getDocumentInfo 仍在首轮能力中，由模型按需选择。
        await this.injectOpeningCanvasObservation();

        agentLoop:
        while (this.iteration < this.config.maxIterations) {
            // 检查取消
            if (this.config.signal?.aborted) {
                this.emitStep({
                    kind: 'stopped',
                    title: '任务已取消',
                    status: 'error',
                    iteration: this.iteration,
                    maxIterations: this.config.maxIterations
                });
                return this.buildRunResult({
                    success: false,
                    message: '任务已取消',
                    iterations: this.iteration,
                    cancelled: true,
                    stopReason: 'cancelled'
                });
            }
            this.taskClosureCapabilityRuntime.ensureVisible(this.toolCallLog);
            const providerTruncationRecoveryRequest = this.providerOutputRecovery.hasPendingRequest;
            let performanceBudgetExhaustion = this.readPerformanceBudgetExhaustion();
            // Provider 截断恢复是同一个模型回合的传输补偿，不再占用任务模型调用配额；
            // 例外只覆盖 model_calls。软时限和工具配额仍必须按原规则终止。
            if (providerTruncationRecoveryRequest
                && performanceBudgetExhaustion?.dimension === 'model_calls') {
                performanceBudgetExhaustion = this.readPerformanceBudgetExhaustion('tool');
            }
            if (performanceBudgetExhaustion) {
                return this.buildPerformanceBudgetRunResult(
                    performanceBudgetExhaustion,
                    this.iteration
                );
            }

            this.addFinalizationNudgeIfNeeded();
            this.refreshPrimarySystemMessage();
            const progressPercent = Math.round(
                (this.iteration / this.config.maxIterations) * 100
            );
            const iterationTools = await this.consumeToolsForIteration();
            const iterationProviderMaxTokens = this.resolvePrimaryTurnProviderMaxTokens();
            const iterationReservedTokens = estimateToolSchemaTokens(iterationTools) + iterationProviderMaxTokens;
            const runtimeStageProgressKeyAtIterationStart = this.readRuntimeStageProgressKey();
            this.config.callbacks.onProgress?.(
                this.buildIterationProgressLabel(),
                progressPercent
            );
            this.emitStep({
                kind: 'iteration_started',
                title: `第 ${this.iteration + 1} 步：判断下一步`,
                detail: `正在处理，已完成 ${this.toolCallLog.length} 个步骤`,
                status: 'running',
                iteration: this.iteration + 1,
                maxIterations: this.config.maxIterations,
                percent: progressPercent
            });
            try {
                if (this.shouldForceFinalResponse()) {
                    return await this.requestForcedFinalResponse();
                }

                // 1. 调模型（带 tools）
                //    先确保消息历史中每个 assistant(tool_calls) 都有对应的 tool_result，
                //    防止 API 400 错误（insufficient tool messages following tool_calls message）
                this.ensureToolCallProtocolIntegrity();
                // 系统提示、动态运行上下文、历史、Tool schema 与输出共用模型窗口。
                // 每次调用前按当前动态工具面重新核算；能力按需扩展后也不能绕过容量治理。
                const contextPreparationDiagnostics = this.contextManager.prepareWithDiagnostics(
                    this.messages,
                    iterationReservedTokens
                );
                this.messages = contextPreparationDiagnostics.messages;
                const contextPreparation = projectContextPreparationForAccounting(
                    contextPreparationDiagnostics
                );
                // 占位纪律（2026-08-23 用户指正）：只陈述可观察事实（带图 / 在等模型），不代笔思考内容——真实思考由流式 thinking 显示；真机模型回合常跑 40–110 秒，无状态显示用户会以为卡住。
                const modelTurnLooksAtImages = this.pendingPrimaryVisualObservations.length > 0
                    || this.initialImagesPendingPrimaryObservation;
                this.emitStep({
                    kind: 'model_request',
                    // 与当前进度标签同口径：用户可见处不出现内部轮次计数。
                    // detail 会被实时活动直接展示给用户（优先于 title），必须是产品语言：
                    // 说「在做什么」，不解释系统机制（2026-08-23 截图病例：「模型推理中，
                    // 结束后展示它的判断和动作」是在向用户讲解架构，不是产品在说话）。
                    title: this.iteration === 0 ? '正在思考任务怎么做' : '正在思考下一步',
                    detail: modelTurnLooksAtImages
                        ? '正在查看画面，这一步会稍慢'
                        : undefined,
                    status: 'running',
                    iteration: this.iteration + 1,
                    maxIterations: this.config.maxIterations,
                    audience: 'user',
                    visibility: 'user_process'
                });
                const response = await requestWithProviderOutputRecoveryAccounting({
                    recoveryRequest: providerTruncationRecoveryRequest,
                    onRecoveryAttempt: () => {
                        this.runtimeSession = this.runtimeAccounting
                            .recordProviderOutputRecoveryAttempt(this.runtimeSession);
                    },
                    onRecoveryOutcome: (outcome) => {
                        this.runtimeSession = this.runtimeAccounting
                            .recordProviderOutputRecoveryOutcome(this.runtimeSession, outcome);
                    },
                    request: () => this.requestModelWithOptionalStream(
                        this.config.modelId,
                        this.messages,
                        iterationTools,
                        {
                            maxTokens: iterationProviderMaxTokens,
                            temperature: 0.7,
                            timeoutMs: AGENT_MODEL_REQUEST_TIMEOUT_MS
                        },
                        providerTruncationRecoveryRequest
                            ? 'provider_output_recovery'
                            : 'agent_turn',
                        contextPreparation
                    )
                });
                if (isProviderOutputTruncated(response.stopReason)) {
                    if (this.providerOutputRecovery.canSchedule()) {
                        this.emitStep({
                            kind: 'warning',
                            title: 'Provider 输出截断，后台续接',
                            detail: '丢弃本次未提交内容并重新请求完整结果；残缺 Tool 调用不会执行。',
                            status: 'running',
                            iteration: this.iteration + 1,
                            maxIterations: this.config.maxIterations,
                            issue: 'provider_output_truncated',
                            source: 'agent_runtime',
                            audience: 'debug'
                        });
                        // Provider 截断时 content、reasoning 与 tool_calls 都属于同一份未提交输出。
                        // 整份丢弃，不能把半截推理单独写回历史；DeepSeek 只要求回放已经形成
                        // 完整 Tool call 的 reasoning_content，残缺 Tool 参数不具备该资格。
                        this.providerOutputRecovery.schedule(iterationTools);
                        // 真机 2026-08-19：模型给 sku-batch 传 20 条绝对路径的 sources，参数把输出撑到上限，
                        // 「继续完成当前判断」的提示让它原样再发一遍，截断循环 5 次。截断发生在工具调用上时，
                        // 必须点名是参数太长、怎么缩：文件名 / 相对路径 / 目录级参数 / 分批。
                        const visibleToolNames = new Set(iterationTools.map((tool) => tool.name));
                        const truncatedToolNames = Array.from(new Set(
                            (response.incompleteToolCallNames || [])
                                .map((name) => String(name || '').trim())
                                .filter((name) => visibleToolNames.has(name))
                        ));
                        const requiresRealAction = this.hasUnfinishedExecutionObligation()
                            || requireInitialToolCall;
                        this.messages.push(createHarnessControlMessage(
                            buildProviderOutputContinuationPrompt({
                                truncatedToolNames,
                                requiresRealAction
                            }),
                            'provider-truncation-recovery',
                            'provider-output-recovery'
                        ));
                        continue;
                    }
                    retireDeliveredAgentMessageImages(this.messages);
                    this.pendingPrimaryVisualObservations = [];
                    this.initialImagesPendingPrimaryObservation = false;
                    return await this.buildProviderOutputFailureResult(this.iteration, 'truncated', {
                        phase: 'agent_turn',
                        recoveryAttempts: this.providerOutputRecovery.recoveryAttempts,
                        recoveryAttemptsInRun: this.providerOutputRecovery.recoveryAttemptsInRun
                    });
                }
                if (isProviderOutputBlocked(response.stopReason)) {
                    this.pendingPrimaryVisualObservations = [];
                    this.initialImagesPendingPrimaryObservation = false;
                    return await this.buildProviderOutputFailureResult(this.iteration, 'blocked');
                }
                if (this.config.signal?.aborted) continue agentLoop;
                // This is a consecutive transport-recovery counter, not a run-global allowance.
                // A complete provider response starts a fresh streak for later Agent turns.
                this.providerOutputRecovery.markComplete();
                interactiveReentryState?.adoptAfterSuccessfulModelResponse();
                if (!response.toolCalls?.length) {
                    const recoveredToolCalls = this.recoverTextEncodedToolCalls(response.content, iterationTools);
                    if (recoveredToolCalls.length > 0) {
                        response.toolCalls = recoveredToolCalls;
                        response.content = this.stripTextEncodedToolCallBlocks(response.content);
                        this.emitStep({
                            kind: 'warning',
                            title: '继续执行真实动作',
                            detail: recoveredToolCalls.map((call) => getToolDisplayInfo(call.name).name).join('、'),
                            status: 'running',
                            iteration: this.iteration + 1,
                            maxIterations: this.config.maxIterations,
                            issue: 'text_encoded_tool_call_recovered'
                        });
                    }
                }
                if (response.toolCalls?.length) {
                    response.toolCalls = this.normalizeToolCallsBeforeExecution(response.toolCalls, response.content);
                }
                const visualReview = reconcilePrimaryVisualObservationReviews({
                    observations: this.pendingPrimaryVisualObservations,
                    modelTurn: this.iteration,
                    response
                });
                response.content = visualReview.content;
                const primaryVisualInputConsumed = visualReview.consumedVisualInput;
                // 像素已在刚完成的 provider 请求中一次性投递。未返回结构化 decision 的
                // observation 保持 reviewed=false，但不能为了等待下一轮而继续重传同一 Base64。
                this.pendingPrimaryVisualObservations = [];
                const visualDeliveryScopeRefreshed =
                    this.refreshWorkflowVisualDeliveryContinuation();
                if (this.initialImagesPendingPrimaryObservation) {
                    this.attachedImageObservationAvailable = primaryVisualInputConsumed;
                    this.observedInputImageCount = primaryVisualInputConsumed
                        ? primaryModelImages.length
                        : 0;
                    this.initialImagesPendingPrimaryObservation = false;
                }

                // 2. 如果模型返回可读的思考摘要，通知 UI；损坏/乱码内容不展示也不伪造。
                // 注：provider 原始思考按渠道策略属 hidden_diagnostic（私有诊断），
                // 面向用户的说明走下方 model_visible_reasoning 那条公开摘要通道。
                const modelThinking = normalizeThinkingForUi(response.thinking);
                if (!response.toolCalls?.length && modelThinking) {
                    this.emitVisibleReasoning(modelThinking, { source: 'provider_final_thinking' });
                }

                // 3. 如果没有 tool_calls
                if (!response.toolCalls?.length) {
                    if (visualDeliveryScopeRefreshed) {
                        this.advancePerformanceIteration();
                        continue;
                    }
                    this.emitStep({
                        kind: 'model_response',
                        title: '正在整理回复',
                        detail: response.content
                            ? `返回文本 ${String(response.content).trim().length} 字`
                            : '没有返回可展示文本',
                        status: response.content ? 'success' : 'error',
                        issue: response.content ? undefined : 'empty_model_response',
                        iteration: this.iteration + 1,
                        maxIterations: this.config.maxIterations
                    });
                    console.log(`[Agent] Iteration ${this.iteration}: no tool calls, stopReason=${response.stopReason}, content=${(response.content || '').substring(0, 100)}`);

                    const unfinishedTurnContinues = this.applyUnfinishedTurnContinuation({
                        response,
                        iterationTools,
                        requireInitialToolCall
                    });
                    if (unfinishedTurnContinues) {
                        this.advancePerformanceIteration();
                        continue;
                    }

                    // AgentTaskPlan 已明确本轮必须读取、执行工具或运行受控能力时，零业务动作不能
                    // 被模型的一段最终话术升级为完成。Harness 控制声明也不算任务进展。
                    const unfinishedExecutionObligation = this.resolveUnfinishedExecutionObligation();
                    // 卡在「只有用户能给的信息」上时，允许把问题说清楚后体面收尾——
                    // 这不是失败，是等你回答。否则模型会被「必须动手」推着反复空转（真机 SKU：43 步 0 产出）。
                    const blockingUserInput = unfinishedExecutionObligation
                        ? this.resolveBlockingUserInputQuestion()
                        : undefined;
                    if (blockingUserInput) {
                        const question = sanitizeUserVisibleAgentText(
                            String(response.content || '')
                        ).trim();
                        const askMessage = question
                            || `继续之前需要你确认：${blockingUserInput.blockingFields.join('、')}。`;
                        const waitingDetail = blockingUserInput.reason === 'environment_exhausted'
                            ? `已检查当前 Photoshop 文档，但仍无法唯一确认：${blockingUserInput.blockingFields.join('、')}。`
                            : `缺少只有你能提供的信息：${blockingUserInput.blockingFields.join('、')}。`;
                        this.emitStep({
                            kind: 'observation',
                            title: '需要你确认后再继续',
                            detail: waitingDetail,
                            status: 'running',
                            iteration: this.iteration + 1,
                            maxIterations: this.config.maxIterations,
                            issue: 'awaiting_user_input',
                            audience: 'user',
                            visibility: 'user_process'
                        });
                        this.config.callbacks.onMessage?.(askMessage);
                        this.messages.push({ role: 'assistant', content: askMessage });
                        return this.buildRunResult({
                            success: true,
                            message: askMessage,
                            iterations: this.iteration + 1,
                            stopReason: 'awaiting_user_input'
                        });
                    }
                    if (unfinishedExecutionObligation) {
                        // 「还没做完」以前会直接终止运行：真机 C-1234 停在 E1/awaiting_outcomes 时
                        // iterations 才 26（预算 60），是判定把任务杀了而不是预算耗尽；而且终止前
                        // 已经把提示 push 进 messages，模型根本没机会消费。这里改成有界推回：
                        // 带着具体缺口让它继续做，反复补不上才交回用户。
                        const nextStageRecoveryAttempt = this.stageIncompleteRecoveryAttempts + 1;
                        const runtimeTaskRun = this.runtimeSession?.taskRun;
                        const runtimeDocumentBinding = runtimeTaskRun?.documentBinding;
                        const stageRecovery = decideStageIncompleteRecovery({
                            obligation: unfinishedExecutionObligation,
                            stageState: this.runtimeSession?.stageState,
                            runtimeState: {
                                taskRunStatus: runtimeTaskRun?.status,
                                documentBindingStatus: runtimeDocumentBinding?.status,
                                documentConflictKind: runtimeDocumentBinding?.conflict?.kind,
                                hasPendingInteraction: Boolean(runtimeTaskRun?.pendingInteraction),
                                hasAgentHandoff: Boolean(this.pendingDirectWorkflowHandoff)
                            },
                            attempt: nextStageRecoveryAttempt
                        });

                        if (stageRecovery.countsAsRecoveryAttempt) {
                            this.stageIncompleteRecoveryAttempts = nextStageRecoveryAttempt;
                        }

                        if (stageRecovery.disposition === 'defer_to_structural_owner') {
                            this.messages.push({ role: 'assistant', content: stageRecovery.deferredMessage });
                            return this.buildRunResult({
                                success: false,
                                message: stageRecovery.deferredMessage,
                                iterations: this.iteration + 1,
                                stopReason: 'tool_preflight_blocked',
                                error: stageRecovery.structuralBlockerCode
                                    || 'structural_runtime_owner_required'
                            });
                        }

                        if (stageRecovery.shouldRetry) {
                            this.emitStep({
                                kind: 'warning',
                                title: '还差一步没做完',
                                detail: stageRecovery.modelDirective,
                                // 推回不是失败：任务仍在进行，用 running 避免过程面板误报红
                                status: 'running',
                                iteration: this.iteration + 1,
                                maxIterations: this.config.maxIterations,
                                issue: unfinishedExecutionObligation
                            });
                            this.messages.push({
                                role: 'user',
                                content: stageRecovery.modelDirective
                            });
                            this.advancePerformanceIteration();
                            continue;
                        }

                        this.emitStep({
                            kind: 'warning',
                            title: '实际处理尚未发生',
                            detail: stageRecovery.escalationMessage,
                            status: 'error',
                            iteration: this.iteration + 1,
                            maxIterations: this.config.maxIterations,
                            issue: unfinishedExecutionObligation
                        });
                        this.config.callbacks.onMessage?.(stageRecovery.escalationMessage);
                        this.messages.push({
                            role: 'assistant',
                            content: stageRecovery.escalationMessage
                        });
                        return this.buildRunResult({
                            success: false,
                            message: stageRecovery.escalationMessage,
                            iterations: this.iteration + 1,
                            stopReason: 'plan_execution_mismatch',
                            error: unfinishedExecutionObligation
                        });
                    }

                    // 已执行过工具或零业务动作时，模型想给出最终回答收尾。但若成品契约判定关键
                    // 产物缺失（有动作但缺产物，如做完背景+图没写文案；或已授权写入却零动作——
                    // 完成所有权前移治理），不直接收尾，而是把缺失项作为强制反馈注入让模型补做
                    // （限次数 + 留迭代余量防死循环）。只拦「确定没做到」：零动作分支还要求
                    // 写入已授权且完成契约明确缺失执行；聊天、只读分析、计划类请求不会命中。
                    const earlyStopRemediation = this.hasTaskProgressToolCalls()
                        ? this.buildContractRemediationDirective()
                        : this.buildZeroProgressContractRemediationDirective();
                    if (
                        earlyStopRemediation
                        && this.contractRemediationAttempts < MAX_CONTRACT_REMEDIATION_ATTEMPTS
                        && this.iteration < this.config.maxIterations - 2
                    ) {
                        this.contractRemediationAttempts += 1;
                        this.emitStep({
                            kind: 'model_response',
                            title: this.hasTaskProgressToolCalls()
                                ? '正在完成交付收尾'
                                : '正在开始实际制作',
                            detail: earlyStopRemediation.shortReason,
                            status: 'running',
                            iteration: this.iteration + 1,
                            maxIterations: this.config.maxIterations
                        });
                        this.messages.push(createAssistantHistoryMessage(response));
                        this.messages.push(createHarnessControlMessage(
                            earlyStopRemediation.directive,
                            'task-contract-remediation',
                            'task-completion-remediation'
                        ));
                        this.advancePerformanceIteration();
                        continue;
                    }
                    // 零业务动作且成品契约推回已用尽：诚实停止，不把「只理解没动手」吞成 final_response。
                    if (!this.hasTaskProgressToolCalls() && earlyStopRemediation) {
                        const escalationMessage = '这轮还没有真正动手完成设计就停下来了，不能把口头说明当作成品。你可以让我继续把它做完，或先看看当前文档的状态。';
                        this.emitStep({
                            kind: 'warning',
                            title: '尚未真正动手',
                            detail: escalationMessage,
                            status: 'error',
                            iteration: this.iteration + 1,
                            maxIterations: this.config.maxIterations,
                            issue: 'zero_progress_completion_remediation_exhausted'
                        });
                        this.config.callbacks.onMessage?.(escalationMessage);
                        this.messages.push({ role: 'assistant', content: escalationMessage });
                        return this.buildRunResult({
                            success: false,
                            message: escalationMessage,
                            iterations: this.iteration + 1,
                            stopReason: 'plan_execution_mismatch',
                            error: 'completion_contract_unsatisfied_zero_progress'
                        });
                    }

                    // 已执行过工具 → 最终回答，结束
                    let finalMessage = sanitizeUserVisibleAgentText(String(response.content || '')).trim();
                    if (!finalMessage) {
                        // 模型干完活却沉默（实测：把设计方向写进项目 State 后直接停止，
                        // 用户看到的是「未完成」而成果其实已产生）。强制一轮中文总结补救，
                        // 仍为空才按空回复失败处理。
                        finalMessage = await this.requestFinalSummaryAfterSilentStop();
                        if (!finalMessage) {
                            return this.buildEmptyFinalResponseResult();
                        }
                    }
                    if (this.shouldRequestRicherFinalSummary(finalMessage)) {
                        const richerFinalMessage = await this.requestRicherFinalSummaryAfterToolRun(finalMessage);
                        if (richerFinalMessage) {
                            finalMessage = richerFinalMessage;
                        }
                    }
                    const terminalClosureCheckpoint = await this.prepareNaturalFinalResponseCheckpoint(
                        finalMessage
                    );
                    if (terminalClosureCheckpoint.continueLoop) {
                        continue;
                    }
                    return this.finishAgentTextResponse(
                        finalMessage,
                        terminalClosureCheckpoint.preparedClosure
                    );
                }
                // 4. 有 tool_calls：记录 assistant 消息
                response.toolCalls = response.toolCalls.map((call) => ({
                    ...call,
                    arguments: stripPrivateTargetGuardArgument(call.arguments)
                }));
                const runtimeDeclarationTurn = createRuntimeDeclarationSiblingTurn(response.toolCalls, {
                    readVisibleToolsAfterBinding: () => this.buildModelVisibleToolsForIteration(),
                    readExecutionModelAfterBinding: () => { if (this.config.agenticArtifactContract) return 'agentic'; if (this.runtimeSession && this.config.runtimeStagePlan) return 'staged'; return undefined; },
                    isCapabilityControlTool: isAgentCapabilityControlTool,
                    decisionContext: {
                        userInput: this.currentTask, intentControlPlane: this.runIntentControlPlaneDecision,
                        completedToolCalls: this.toolCallLog,
                        runtime: { photoshopConnected: this.config.toolDecisionContext?.photoshopConnected, hasDocument: this.config.toolDecisionContext?.hasDocument }
                    }
                });
                response.toolCalls = runtimeDeclarationTurn.orderedCalls;
                const runtimeDeclarationControlCall = runtimeDeclarationTurn.declarationCall;
                const toolCallsForCurrentControlTurn = runtimeDeclarationControlCall ? [runtimeDeclarationControlCall] : response.toolCalls;
                this.emitStep({
                    kind: 'model_response',
                    title: `准备处理 ${toolCallsForCurrentControlTurn.length} 项内容`,
                    detail: toolCallsForCurrentControlTurn
                        .map((call) => getToolDisplayInfo(call.name).name)
                        .join('、'),
                    status: 'success',
                    iteration: this.iteration + 1,
                    maxIterations: this.config.maxIterations
                });
                // 工具回合与纯 reasoning 截断回合共用同一历史构造器，防止任何续跑分支
                // 丢失 provider-native reasoning_content 或制造 role-only assistant 消息。
                this.messages.push(createAssistantHistoryMessage(response));

                // 真机诊断 2026-08-06：原判据只在「本轮含受守卫工具（写入/破坏性）」时要求
                // 面向用户的说明。但 Agent 绝大多数轮次都在观察（getLayerHierarchy /
                // searchProjectResources / getDocumentSnapshot…），一个 guarded 都没有，
                // 于是全程沉默——用户看到的是一个反复查看却不说话的黑箱，不知道它理解成了
                // 什么、在找什么。设计师看素材时也会说「我先看看项目里有什么」。
                // 这里只补最关键的一处：本轮还没跟用户说过任何话时，第一次调工具前必须说清楚。
                // 不改 shared 判据（「守卫工具需要理由」的语义本身是对的），也不要求每轮观察
                // 都发言——那会把过程区变成噪音。
                const requireUserVisiblePreActionRationale =
                    this.shouldRequireUserVisiblePreActionRationaleForToolCalls(toolCallsForCurrentControlTurn)
                    || !this.visibleReasoningSent;
                if (requireUserVisiblePreActionRationale) {
                    this.emitVisibleReasoning(response.content, { source: 'model_visible_reasoning' });
                }
                this.emitDeterministicPreActionDisclosureBeforeFirstToolResult(
                    toolCallsForCurrentControlTurn,
                    requireUserVisiblePreActionRationale
                );
                const preflightAssistantContent = [
                    String(response.content || '').trim(),
                    this.latestVisiblePreActionRationale
                ].filter(Boolean).join('\n');

                const toolDecisionContract = buildAgentToolDecisionContract({
                    userInput: this.currentTask,
                    intentControlPlane: this.runIntentControlPlaneDecision,
                    toolCalls: toolCallsForCurrentControlTurn,
                    completedToolCalls: this.toolCallLog,
                    runtime: {
                        availableTools: iterationTools.map((tool) => tool.name),
                        photoshopConnected: this.config.toolDecisionContext?.photoshopConnected,
                        hasDocument: this.config.toolDecisionContext?.hasDocument
                    }
                });
                if (toolDecisionContract.status === 'blocked') {
                    const blockedMessage = formatAgentToolDecisionContractBlocker(toolDecisionContract)
                        || PUBLIC_TOOL_PRECHECK_BLOCKED_MESSAGE;
                    if (toolDecisionContract.nextAction === 'model_replan_with_allowed_tools') {
                        const allowedToolNames = this.buildAllowedToolNameSetForContract(toolDecisionContract);
                        if (allowedToolNames.size > 0) {
                            this.emitStep({
                                kind: 'warning',
                                title: '工具选择需重规划',
                                detail: `上一轮动作不符合当前权限或环境事实；仍有 ${allowedToolNames.size} 个已授权能力可由 Agent 重新选择。`,
                                status: 'running',
                                iteration: this.iteration + 1,
                                maxIterations: this.config.maxIterations,
                                issue: 'tool_decision_replan_with_allowed_tools'
                            });
                            this.appendCompleteToolResultsForAssistantToolCalls({
                                assistantToolCalls: response.toolCalls,
                                fallbackError: blockedMessage,
                                fallbackCode: 'agent_tool_decision_replan_with_allowed_tools',
                                fallbackOutput: { toolDecisionContract }
                            });
                            this.messages.push(createHarnessControlMessage(
                                this.buildToolDecisionReplanDirective(allowedToolNames, toolDecisionContract),
                                'tool-decision-replan',
                                'tool-decision-recovery'
                            ));
                            this.advancePerformanceIteration();
                            continue;
                        }
                        // 无可继续的工具（如本轮全是无文档下不可用的画布工具），但此前已有成功结果：
                        // 引导模型基于已收集信息直接输出结论收尾，而不是把任务判失败丢回用户。
                        const hasPriorResult = this.toolCallLog.some((entry) => (
                            !isAgentHarnessControlTool(entry.name)
                            && entry.result?.success !== false
                        ));
                        if (hasPriorResult) {
                            this.emitStep({
                                kind: 'warning',
                                title: '改为基于已有信息收尾',
                                detail: '当前没有更多可用工具，改用已取得的操作结果直接输出结论。',
                                status: 'running',
                                iteration: this.iteration + 1,
                                maxIterations: this.config.maxIterations,
                                issue: 'tool_decision_finalize_with_results'
                            });
                            this.appendCompleteToolResultsForAssistantToolCalls({
                                assistantToolCalls: response.toolCalls,
                                fallbackError: blockedMessage,
                                fallbackCode: 'agent_tool_decision_finalize_with_results',
                                fallbackOutput: { toolDecisionContract }
                            });
                            this.messages.push(createHarnessControlMessage([
                                    '刚才请求的工具在当前条件下不可用（例如没有打开的 Photoshop 文档时无法读取画布）。',
                                    '不要再调用这些工具。请基于此前已经成功获取的信息，直接、完整地输出最终结论。',
                                    '不要提到内部流程、状态码或调试内容。'
                                ].join('\n'), 'tool-decision-finalize', 'tool-decision-recovery'));
                            this.advancePerformanceIteration();
                            continue;
                        }
                    }
                    if (toolDecisionContract.nextAction === 'model_replan_without_tools'
                        || toolDecisionContract.nextAction === 'answer_without_tools') {
                        this.appendCompleteToolResultsForAssistantToolCalls({
                            assistantToolCalls: response.toolCalls,
                            fallbackError: blockedMessage,
                            fallbackCode: 'agent_tool_decision_replan_without_tools',
                            fallbackOutput: { toolDecisionContract }
                        });
                        const replannedResult = await this.requestNoToolReplanAfterToolDecisionBlocked(
                            toolDecisionContract,
                            blockedMessage
                        );
                        if (replannedResult) {
                            return replannedResult;
                        }
                    }
                    if (toolDecisionContract.nextAction === 'respect_system_boundary') {
                        // 系统边界（提交时 Photoshop 插件未连接、批内没有免 PS 工具可继续）：
                        // 用明确、可操作的原因收尾，不落进笼统的"处理条件未满足"。
                        const boundaryMessage = 'Photoshop 连接不可用：需要 Photoshop 的操作已停止。请在 Photoshop 中打开 DesignEcho UXP 插件面板建立连接后，重新发送需求；本轮未改动画面。';
                        this.emitStep({
                            kind: 'warning',
                            title: 'Photoshop 连接不可用',
                            detail: boundaryMessage,
                            status: 'error',
                            iteration: this.iteration + 1,
                            maxIterations: this.config.maxIterations,
                            issue: 'respect_system_boundary'
                        });
                        this.appendCompleteToolResultsForAssistantToolCalls({
                            assistantToolCalls: response.toolCalls,
                            fallbackError: boundaryMessage,
                            fallbackCode: 'respect_system_boundary',
                            fallbackOutput: { toolDecisionContract }
                        });
                        this.config.callbacks.onProgress?.('Photoshop 连接不可用，本轮没有改动画面', 100);
                        return this.buildRunResult({
                            success: false,
                            message: boundaryMessage,
                            iterations: this.iteration + 1,
                            error: 'respect_system_boundary',
                            stopReason: 'tool_preflight_blocked',
                            data: {
                                agentToolDecisionContract: toolDecisionContract
                            }
                        });
                    }
                    const blockedIssue = 'agent_tool_decision_contract_blocked';
                    this.emitStep({
                        kind: 'warning',
                        title: '处理条件未满足',
                        detail: blockedMessage,
                        status: 'error',
                        iteration: this.iteration + 1,
                        maxIterations: this.config.maxIterations,
                        issue: blockedIssue
                    });
                    this.appendCompleteToolResultsForAssistantToolCalls({
                        assistantToolCalls: response.toolCalls,
                        fallbackError: blockedMessage,
                        fallbackCode: blockedIssue,
                        fallbackOutput: { toolDecisionContract }
                    });
                    this.config.callbacks.onProgress?.('当前条件不满足，本轮没有改动画面', 100);
                    return this.buildRunResult({
                        success: false,
                        message: blockedMessage,
                        iterations: this.iteration + 1,
                        error: blockedIssue,
                        stopReason: 'tool_preflight_blocked',
                        data: {
                            agentToolDecisionContract: toolDecisionContract
                        }
                    });
                }

                // 5. 执行 tool_call：连续的并行安全调用（只读/检索/只读子 Agent）并发执行，
                //    写类/状态类严格串行且保序——写调用预检始终能看到此前全部读取与执行结果
                const toolResults: ToolResult[] = [];
                const executionBatches = partitionToolCallsForParallelExecution(response.toolCalls);
                let workflowContinuationScopeApplied = false;
                this.currentBatchMutationWriteLocked = false;
                const sourceTextForToolTargetResolution = [this.currentTask, String(response.content || '')]
                    .filter(Boolean)
                    .join('\n');
                // 只限制会改变下一轮 schema 的装载；纯目录搜索不消费此预算。
                let capabilityLoadCallExecutedThisIteration = false;
                const shouldDeferForRuntimeDeclaration = runtimeDeclarationTurn.shouldDefer;
                const executeCallWithIterationCapabilityBudget = async (
                    call: ToolCall,
                    toolExecutionPreflight?: AgentToolExecutionPreflight
                ): Promise<any> => {
                    const startedAtMs = Date.now();
                    let output: any;
                    if (shouldDeferForRuntimeDeclaration(call)) {
                        output = {
                            success: false,
                            code: 'tool_deferred_after_runtime_declaration',
                            error: '任务类型及其专业上下文刚刚完成绑定；这项有副作用的操作是在绑定前生成的，因此尚未执行。请结合现在可见的方法、事实和只读结果重新判断，并由你重新发起真正需要的动作；不要把原调用当成已经完成。',
                            deferredByRuntimeDeclaration: true,
                            policyGate: true,
                            executesPhotoshop: false,
                            grantsPermission: false,
                            countsAsObservation: false,
                            countsAsTaskProgress: false,
                            countsAsRuntimeToolCall: false
                        };
                    }
                    // Runtime 绑定后的第二重能力面检查：staged Profile 可能原地收紧 activeTools，
                    // 绑定后不可见调用须重规划；agentic 新增方法 /评价上下文时，绑定前写同样延后，只承接只读观察 /知识检索。
                    // Harness 控制工具（含 declareDesignIntent）恒可用。
                    if (output === undefined
                        && !isAgentHarnessControlTool(call.name)
                        && !isAgentCapabilityControlTool(call.name)
                        && !this.config.tools.some((tool) => tool.name === call.name)) {
                        output = {
                            success: false,
                            code: 'tool_schema_stale_after_runtime_binding',
                            error: `工具「${call.name}」已不在本轮 Runtime 的可用能力中，未执行；请按当前能力边界在下一次规划中重新选择。`,
                            executesPhotoshop: false,
                            grantsPermission: false,
                            countsAsObservation: false,
                            countsAsTaskProgress: false
                        };
                    }
                    if (output === undefined && isAgentCapabilityLoadTool(call.name)) {
                        if (capabilityLoadCallExecutedThisIteration) {
                            output = {
                                success: false,
                                code: 'capability_request_round_budget_exceeded',
                                error: '同一模型轮次只允许一次能力装载请求；请在下一轮继续请求当前步骤仍需要的能力。',
                                changesModelVisibleSchemasOnly: true,
                                executesPhotoshop: false,
                                grantsPermission: false,
                                countsAsObservation: false,
                                countsAsTaskProgress: false
                            };
                        } else {
                            capabilityLoadCallExecutedThisIteration = true;
                        }
                    }
                    if (output === undefined) {
                        output = this.prepareRuntimeActionExecutionEnvelope(
                            call,
                            toolExecutionPreflight
                        );
                    }
                    if (output === undefined) {
                        const executionArguments = buildPrivateTargetGuardExecutionArguments(
                            call,
                            toolExecutionPreflight
                        );
                        output = buildCompletedReflexionWriteFreshnessBlock({
                            handoff: this.config.reflexionHandoff,
                            executionKind: classifyAgentToolExecution(call.name, call.arguments),
                            executionArguments,
                            hasGenerationMutation: this.hasObservedTaskMutation(),
                            currentVisualReview: this.findLatestDesignVisualJudgeReviewSet(
                                this.resolveFinalReviewSetRequirements(this.resolveRuntimeEvaluationProfile()).requireMultiSurface
                            ),
                            toolName: call.name
                        });
                        if (output === undefined) {
                            output = await this.executeToolWithDiagnostics(call.name, executionArguments);
                        }
                    }
                    await runtimeDeclarationTurn.recordResult(call, output);
                    if (output?.countsAsRuntimeToolCall !== false) {
                        this.runtimeSession = this.runtimeAccounting.recordToolCall(this.runtimeSession, {
                            durationMs: Date.now() - startedAtMs,
                            succeeded: output?.success !== false
                        });
                    }
                    return output;
                };

                for (const batch of executionBatches) {
                    batch.calls = batch.calls.map((call) => {
                        const normalizedTargetCall = this.normalizeLayerTargetToolCallBeforeExecution(
                            call,
                            sourceTextForToolTargetResolution,
                            []
                        );
                        return normalizeExactPropertyReplacementToolCall({
                            userRequest: this.currentTask,
                            exactPropertyScope: this.config.runtimeExactPropertyScope,
                            toolCall: normalizedTargetCall,
                            completedToolCalls: this.toolCallLog
                        });
                    });
                    const executionPreflightByCallId = new Map<string, AgentToolExecutionPreflight>();

                    // 5.1 批内逐个预检（轻量同步逻辑；阻断语义与串行版一致）
                    for (const call of batch.calls) {
                        if (shouldDeferForRuntimeDeclaration(call)) continue;
                        const toolExecutionPreflight = buildAgentToolExecutionPreflight({
                            userRequest: this.currentTask,
                            assistantContent: preflightAssistantContent,
                            toolCalls: [call],
                            verificationToolCalls: toolCallsForCurrentControlTurn,
                            requiresUserVisiblePreActionRationale: requireUserVisiblePreActionRationale,
                            ...buildTaskRunCreatedDocumentPreflightInput(this.currentTask, this.buildTaskCompletionContext(), this.toolCallLog)
                        });
                        executionPreflightByCallId.set(call.id, toolExecutionPreflight);
                        if (!toolExecutionPreflight.ready && toolExecutionPreflight.status === 'blocked') {
                            if (toolExecutionPreflight.clarification) {
                                const question = toolExecutionPreflight.clarification.question;
                                this.appendCompleteToolResultsForAssistantToolCalls({
                                    assistantToolCalls: response.toolCalls,
                                    toolResults: [
                                        ...toolResults,
                                        {
                                            callId: call.id,
                                            success: false,
                                            output: {
                                                success: false,
                                                code: 'awaiting_user_input',
                                                reason: toolExecutionPreflight.clarification.reason,
                                                message: question,
                                                preflight: toolExecutionPreflight
                                            }
                                        }
                                    ],
                                    fallbackError: '需要用户确认后再继续。',
                                    fallbackCode: 'awaiting_user_input',
                                    fallbackOutput: { preflight: toolExecutionPreflight }
                                });
                                this.emitStep({
                                    kind: 'observation',
                                    title: '需要你确认后再继续',
                                    detail: question,
                                    status: 'running',
                                    iteration: this.iteration + 1,
                                    maxIterations: this.config.maxIterations,
                                    toolName: call.name,
                                    toolCallId: call.id,
                                    issue: 'awaiting_user_input',
                                    audience: 'user',
                                    visibility: 'user_process'
                                });
                                this.config.callbacks.onMessage?.(question);
                                this.messages.push({ role: 'assistant', content: question });
                                return this.buildRunResult({
                                    success: true,
                                    message: question,
                                    iterations: this.iteration + 1,
                                    stopReason: 'awaiting_user_input'
                                });
                            }
                            const blockedMessage = PUBLIC_TOOL_PRECHECK_BLOCKED_MESSAGE;
                            if (this.applyToolPreflightReplanDirective({
                                call,
                                preflight: toolExecutionPreflight,
                                blockedMessage,
                                assistantToolCalls: response.toolCalls,
                                completedToolResults: toolResults
                            })) {
                                this.advancePerformanceIteration();
                                continue agentLoop;
                            }
                            this.emitStep({
                                kind: 'warning',
                                title: '处理条件未满足',
                                detail: blockedMessage,
                                status: 'error',
                                iteration: this.iteration + 1,
                                maxIterations: this.config.maxIterations,
                                toolName: call.name,
                                toolCallId: call.id,
                                issue: toolExecutionPreflight.issue || 'agent_tool_execution_preflight_blocked'
                            });
                            this.appendCompleteToolResultsForAssistantToolCalls({
                                assistantToolCalls: response.toolCalls,
                                toolResults: [
                                    ...toolResults,
                                    {
                                        callId: call.id,
                                        success: false,
                                        output: {
                                            success: false,
                                            error: blockedMessage,
                                            code: toolExecutionPreflight.issue || 'agent_tool_execution_preflight_blocked',
                                            preflight: toolExecutionPreflight
                                        }
                                    }
                                ],
                                fallbackError: '前序工具预检未通过，本轮剩余工具未执行。',
                                fallbackCode: 'agent_tool_execution_preflight_blocked_skipped',
                                fallbackOutput: { preflight: toolExecutionPreflight }
                            });
                            this.config.callbacks.onProgress?.('当前条件不满足，本轮没有改动画面', 100);
                            return this.buildRunResult({
                                success: false,
                                message: blockedMessage,
                                iterations: this.iteration + 1,
                                error: toolExecutionPreflight.issue || 'agent_tool_execution_preflight_blocked',
                                stopReason: 'tool_preflight_blocked'
                            });
                        }
                    }

                    // 5.2 取消检查（批为粒度）
                    if (this.config.signal?.aborted) {
                        this.emitStep({
                            kind: 'stopped',
                            title: '任务已取消',
                            detail: `取消时正在处理工具: ${batch.calls.map((c) => c.name).join(', ')}`,
                            status: 'error',
                            iteration: this.iteration + 1,
                            maxIterations: this.config.maxIterations,
                            toolName: batch.calls[0]?.name,
                            toolCallId: batch.calls[0]?.id
                        });
                        this.appendCompleteToolResultsForAssistantToolCalls({
                            assistantToolCalls: response.toolCalls,
                            toolResults,
                            fallbackError: '任务已取消，本轮剩余工具未执行。',
                            fallbackCode: 'cancelled_before_tool_batch'
                        });
                        return this.buildRunResult({
                            success: false,
                            message: '任务已取消（工具执行中）',
                            iterations: this.iteration + 1,
                            cancelled: true,
                            stopReason: 'cancelled'
                        });
                    }

                    // 5.3 发射 planned/started 步骤
                    const userVisibleBatchCalls = batch.calls.filter((call) => (
                        !isAgentHarnessControlTool(call.name)
                        && !shouldDeferForRuntimeDeclaration(call)
                    ));
                    if (batch.parallel && userVisibleBatchCalls.length > 1) {
                        // 「分析素材内容、分析素材内容」这种同名并列读起来像卡了：同名合并计数（分析素材内容 ×2）
                        const batchNameCounts = new Map<string, number>();
                        for (const call of userVisibleBatchCalls) {
                            const label = getToolDisplayInfo(call.name).name;
                            batchNameCounts.set(label, (batchNameCounts.get(label) || 0) + 1);
                        }
                        this.emitStep({
                            kind: 'observation',
                            title: `同时检查 ${userVisibleBatchCalls.length} 项设计信息`,
                            detail: Array.from(batchNameCounts.entries())
                                .map(([label, count]) => (count > 1 ? `${label} ×${count}` : label))
                                .join('、'),
                            status: 'success', // 一次性通知：running 无人收尾会被 UI 兜底判「未完成」
                            iteration: this.iteration + 1,
                            maxIterations: this.config.maxIterations,
                            audience: 'user',
                            visibility: 'user_process'
                        });
                    }
                    for (const call of batch.calls) {
                        if (shouldDeferForRuntimeDeclaration(call)) continue;
                        const displayName = getToolDisplayInfo(call.name).name;
                        const isHarnessControl = isAgentHarnessControlTool(call.name);
                        this.emitStep({
                            kind: 'tool_planned',
                            title: `准备处理：${displayName}`,
                            detail: summarizeToolArguments(call.arguments),
                            status: 'pending',
                            iteration: this.iteration + 1,
                            maxIterations: this.config.maxIterations,
                            toolName: call.name,
                            toolCallId: call.id,
                            audience: isHarnessControl ? 'debug' : 'user',
                            visibility: isHarnessControl ? undefined : 'user_process'
                        });
                        this.emitStep({
                            kind: 'tool_started',
                            title: `正在处理：${displayName}`,
                            detail: summarizeToolArguments(call.arguments),
                            status: 'running',
                            iteration: this.iteration + 1,
                            maxIterations: this.config.maxIterations,
                            toolName: call.name,
                            toolCallId: call.id,
                            audience: isHarnessControl ? 'debug' : 'user',
                            visibility: isHarnessControl ? undefined : 'user_process'
                        });
                        if (!isHarnessControl) {
                            this.config.callbacks.onToolStart?.(call.name);
                        }
                    }

                    // 5.4 执行（并行批 Promise.all；串行批顺序执行，行为与旧实现一致）
                    const batchOutputs: any[] = batch.parallel && batch.calls.length > 1
                        ? await Promise.all(batch.calls.map((call) => executeCallWithIterationCapabilityBudget(
                            call,
                            executionPreflightByCallId.get(call.id)
                        )))
                        : await (async () => {
                            const outputs: any[] = [];
                            const completedBatchEntries: AgentToolCallLogEntry[] = [];
                            for (let callIndex = 0; callIndex < batch.calls.length; callIndex += 1) {
                                let call = batch.calls[callIndex];
                                if (this.config.signal?.aborted) {
                                    outputs.push({
                                        success: false,
                                        cancelled: true,
                                        error: '任务已取消'
                                    });
                                    break;
                                }
                                const resolvedCall = this.normalizeLayerTargetToolCallBeforeExecution(
                                    call,
                                    sourceTextForToolTargetResolution,
                                    completedBatchEntries
                                );
                                if (resolvedCall !== call) {
                                    batch.calls[callIndex] = resolvedCall;
                                    call = resolvedCall;
                                }
                                const output = await executeCallWithIterationCapabilityBudget(
                                    call,
                                    executionPreflightByCallId.get(call.id)
                                );
                                outputs.push(output);
                                this.lockFollowingBatchWritesAfterRuntimeActionFailure(call, output);
                                completedBatchEntries.push({
                                    name: call.name,
                                    arguments: call.arguments,
                                    result: output
                                });
                                if (output?.cancelled === true || this.config.signal?.aborted) {
                                    break;
                                }
                            }
                            return outputs;
                        })();
                    const normalizedBatchOutputs = batch.calls.map((call, index) => batchOutputs[index] || {
                        success: false,
                        cancelled: true,
                        error: `任务已取消，未继续执行 ${call.name}`
                    });

                    const normalizedBatchToolResults: ToolResult[] = batch.calls.map((call, index) => ({
                        callId: call.id,
                        success: normalizedBatchOutputs[index]?.success !== false,
                        output: normalizedBatchOutputs[index]
                    }));

                    // 5.5 先记录真实调用结果，再绑定经校验的 Workflow continuation（须在 E1 记账前生效，
                    // 否则同批 repair handoff 会被当普通失败/成功处理，原子写+读回可能越过 owner 提前推进 R5）。
                    batch.calls.forEach((call, index) => {
                        const result = normalizedBatchOutputs[index];
                        const success = result?.success !== false;
                        const displayName = getToolDisplayInfo(call.name).name;
                        const isHarnessControl = isAgentHarnessControlTool(call.name);
                        const isRuntimeDeclarationDeferred = result?.code
                            === 'tool_deferred_after_runtime_declaration';
                        const isInternalControlResult = isHarnessControl || isRuntimeDeclarationDeferred;
                        const hasPendingInteractiveConfirmation = collectPendingInteractiveConfirmationCards([{
                            callId: call.id,
                            success,
                            output: result
                        }]).length > 0;
                        const actionEvent = buildAgentActionEventProjection({
                            toolName: call.name,
                            result,
                            isInternalControl: isInternalControlResult,
                            isRuntimeDeclarationDeferred,
                            hasPendingInteractiveConfirmation
                        });
                        this.emitStep({
                            kind: 'tool_completed',
                            title: `${actionEvent.titlePrefix}：${displayName}`,
                            detail: summarizeToolResult(result, call.name),
                            status: actionEvent.status,
                            iteration: this.iteration + 1,
                            maxIterations: this.config.maxIterations,
                            toolName: call.name,
                            toolCallId: call.id,
                            // 原始错误完整保留在 toolCallLog；用户过程事件只携带稳定原因码，
                            // 避免 Provider / Runtime 原文再次穿透到普通界面。
                            issue: actionEvent.issue,
                            audience: actionEvent.userVisible ? 'user' : 'debug',
                            visibility: actionEvent.userVisible ? 'user_process' : undefined
                        });
                        toolResults.push({
                            callId: call.id,
                            success,
                            output: result
                        });
                        const toolCallElapsedMs = this.readRunElapsedMsOrUndefined();
                        let failureDispositionFields: Pick<AgentToolCallLogEntry, 'failureDisposition'> | Record<string, never> = {};
                        if (actionEvent.failureDisposition) {
                            failureDispositionFields = {
                                failureDisposition: actionEvent.failureDisposition
                            };
                        } else if (actionEvent.countsAsUnresolvedFailure) {
                            const referenceDisposition = this.resolveReferenceFailureDisposition(call.name, result);
                            if (referenceDisposition) {
                                failureDispositionFields = { failureDisposition: referenceDisposition };
                            }
                        }
                        this.toolCallLog.push({
                            callId: call.id,
                            name: call.name,
                            arguments: call.arguments,
                            result,
                            origin: 'model_tool_call', modelTurn: this.iteration,
                            ...(toolCallElapsedMs !== undefined ? { elapsedMs: toolCallElapsedMs } : {}),
                            ...failureDispositionFields
                        });
                    });
                    workflowContinuationScopeApplied = this.applyWorkflowContinuationScope(
                        batch.calls,
                        normalizedBatchToolResults,
                        iterationTools
                    ) || workflowContinuationScopeApplied;
                    batch.calls.forEach((call, index) => {
                        const result = normalizedBatchOutputs[index];
                        const isHarnessControl = isAgentHarnessControlTool(call.name);
                        const isRuntimeDeclarationDeferred = result?.code
                            === 'tool_deferred_after_runtime_declaration';
                        const isInternalControlResult = isHarnessControl || isRuntimeDeclarationDeferred;
                        this.recordToolResultStageTrace(call, result);
                        if (!isInternalControlResult) {
                            this.config.callbacks.onToolComplete?.(call.name, result);
                        }
                    });

                    if (this.config.signal?.aborted || normalizedBatchOutputs.some((output) => output?.cancelled === true)) {
                        this.emitStep({
                            kind: 'stopped',
                            title: '任务已取消',
                            detail: '已停止当前工具链，不再继续发送 Photoshop 操作。',
                            status: 'error',
                            iteration: this.iteration + 1,
                            maxIterations: this.config.maxIterations,
                            issue: 'cancelled'
                        });
                        this.appendCompleteToolResultsForAssistantToolCalls({
                            assistantToolCalls: response.toolCalls,
                            toolResults,
                            fallbackError: '任务已取消，本轮剩余工具未执行。',
                            fallbackCode: 'cancelled_during_tool_batch'
                        });
                        return this.buildRunResult({
                            success: false,
                            message: '任务已取消',
                            iterations: this.iteration + 1,
                            cancelled: true,
                            stopReason: 'cancelled'
                        });
                    }

                    // 5.55 Agent 遇到真正由用户掌握的事实、授权或实质偏好时，列选项并暂停本轮。
                    // UI 提交后通过来源消息和 Runtime 身份恢复原任务，不把答案当作新任务重新路由。
                    const userChoiceRequest = toolResults
                        .map((item) => item.output?.userChoiceRequest)
                        .find((request) => request && request.version === 'user-choice-request/v2');
                    if (userChoiceRequest) {
                        this.appendCompleteToolResultsForAssistantToolCalls({
                            assistantToolCalls: response.toolCalls,
                            toolResults,
                            fallbackError: '正在等用户选择，本轮后续工具未执行。',
                            fallbackCode: 'awaiting_user_choice_skipped'
                        });
                        const questionLine = (Array.isArray(userChoiceRequest.questions) ? userChoiceRequest.questions : [])
                            .map((question: any) => String(question?.question || '')).filter(Boolean).join('；');
                        const askText = String(response.content || '').trim() || String(userChoiceRequest.intro || questionLine);
                        this.emitStep({
                            kind: 'observation',
                            title: '等你选一个',
                            detail: questionLine,
                            status: 'running',
                            iteration: this.iteration + 1,
                            maxIterations: this.config.maxIterations,
                            issue: 'awaiting_user_input',
                            audience: 'user',
                            visibility: 'user_process'
                        });
                        this.messages.push({ role: 'assistant', content: askText });
                        return this.buildRunResult({
                            success: true,
                            message: askText,
                            iterations: this.iteration + 1,
                            stopReason: 'awaiting_user_input',
                            data: { userChoiceRequest }
                        });
                    }

                    // 5.6 用户确认是执行边界，不是整轮执行后的展示状态。
                    // 每个保序批次完成后立即检查；命中后为尚未执行的 tool_call 补齐合成结果并返回，
                    // 绝不让同一模型轮后续的写调用越过确认点。
                    const pendingConfirmationCards = collectPendingInteractiveConfirmationCards(toolResults);
                    if (pendingConfirmationCards.length > 0) {
                        const pendingContinuations = collectPendingInteractiveContinuations(toolResults);
                        this.appendCompleteToolResultsForAssistantToolCalls({
                            assistantToolCalls: response.toolCalls,
                            toolResults,
                            fallbackError: '正在等待用户确认，本轮后续工具未执行。',
                            fallbackCode: 'awaiting_user_confirmation_skipped'
                        });
                        if (pendingContinuations.length > 1) {
                            const message = '一次模型轮生成了多个可执行确认操作，无法安全判断卡片归属；本轮已停止且没有继续写入。';
                            this.emitStep({
                                kind: 'warning',
                                title: '确认卡片归属不明确',
                                detail: message,
                                status: 'error',
                                iteration: this.iteration + 1,
                                maxIterations: this.config.maxIterations,
                                issue: 'ambiguous_interactive_continuation_ownership'
                            });
                            return this.buildRunResult({
                                success: false,
                                message,
                                iterations: this.iteration + 1,
                                stopReason: 'error',
                                error: 'ambiguous_interactive_continuation_ownership'
                            });
                        }
                        let pendingInteractiveContinuation = pendingContinuations[0];
                        if (
                            pendingInteractiveContinuation
                            && !pendingConfirmationCards.some((card) => card.id === pendingInteractiveContinuation.card.id)
                        ) {
                            const message = '确认卡片与原挂起操作不一致；本轮已停止且没有继续写入。';
                            this.emitStep({
                                kind: 'warning',
                                title: '确认卡片无法绑定',
                                detail: message,
                                status: 'error',
                                iteration: this.iteration + 1,
                                maxIterations: this.config.maxIterations,
                                issue: 'interactive_continuation_card_mismatch'
                            });
                            return this.buildRunResult({
                                success: false,
                                message,
                                iterations: this.iteration + 1,
                                stopReason: 'error',
                                error: 'interactive_continuation_card_mismatch'
                            });
                        }
                        if (pendingInteractiveContinuation && this.runtimeSession) {
                            const pauseRevision = resolvePendingInteractiveContinuationPauseRevision(
                                pendingInteractiveContinuation
                            );
                            const runtimeRevision = this.runtimeSession.taskRun.documentBinding?.expectedRevision;
                            const continuationDocumentId = Number(
                                pendingInteractiveContinuation.scope.photoshopDocumentId || 0
                            );
                            const compatibleRuntimeRevision = runtimeRevision
                                && (continuationDocumentId <= 0
                                    || runtimeRevision.documentId === continuationDocumentId)
                                ? runtimeRevision
                                : undefined;
                            const legacyRuntimeRevision = pendingInteractiveContinuation.scopeObservation
                                ? undefined
                                : compatibleRuntimeRevision;
                            const suspension = suspendRuntimeSessionForInteraction({
                                session: this.runtimeSession,
                                interactionId: pendingInteractiveContinuation.id,
                                continuationId: pendingInteractiveContinuation.id,
                                cardId: pendingInteractiveContinuation.card.id,
                                nodeId: this.runtimeSession.taskRun.currentNodeId,
                                expectedRevision: pauseRevision || legacyRuntimeRevision,
                                inheritSessionExpectedRevision: false
                            });
                            this.runtimeSession = suspension.session;
                            pendingInteractiveContinuation = attachRuntimeTaskRunBindingToPendingContinuation({
                                continuation: pendingInteractiveContinuation,
                                binding: suspension.binding
                            });
                        }
                        this.emitStep({
                            kind: 'finalizing',
                            title: '等待你确认',
                            detail: '已创建确认卡片，需要你确认后才会继续执行。',
                            status: 'success',
                            iteration: this.iteration + 1,
                            maxIterations: this.config.maxIterations,
                            audience: 'user',
                            visibility: 'user_process'
                        });
                        return this.buildRunResult({
                            success: true,
                            message: '我正在等待你的确认；提交卡片后会自动继续执行。',
                            iterations: this.iteration + 1,
                            stopReason: 'awaiting_user_confirmation',
                            data: {
                                interactiveCards: pendingConfirmationCards,
                                awaitingUserConfirmation: true,
                                ...(pendingInteractiveContinuation
                                    ? { pendingInteractiveContinuation }
                                    : {})
                            }
                        });
                    }
                }
                this.mutationBoundDesignIntents = appendMutationBoundDesignIntent({
                    current: this.mutationBoundDesignIntents,
                    modelTurn: this.iteration,
                    publicText: sanitizeUserVisibleAgentText(String(response.content || '')),
                    toolCalls: response.toolCalls,
                    toolResults
                });
                this.currentBatchMutationWriteLocked = false;

                // 6. 添加 tool_result 消息（回填模型的副本做超长字段截断；
                //    toolCallLog 保留原始结果供守卫与验收使用）
                for (const item of toolResults) {
                    clearProducerVisualRuntimeAnnotations(item.output);
                }
                this.messages.push({
                    role: 'tool_result',
                    toolResults: toolResults.map((item) => ({
                        ...item,
                        output: this.buildModelToolObservationOutput(
                            response.toolCalls?.find((call: ToolCall) => call.id === item.callId)?.name || 'unknown',
                            item.output
                        )
                    }))
                });

                // 6.1 快照观察：主模型支持视觉则自己看；否则视觉槽专家替它看并注入判断；都没有则如实告知无法核对
                await this.attachToolImageObservations(toolResults);
                // 终审必须在日志压缩删除大像素前复制同版本完整证据。该副本仅存活于当前 run；
                // 后续真实 mutation 会立即使旧集合失效，不能跨版本拼屏或拿旧图打分。
                this.captureLatestDesignVisualJudgeReviewSet(toolResults);
                // 图片已经完成用户预览与视觉模型观察；toolResults 和 toolCallLog 共享结果对象，
                // 此时释放 renderLayout 自动截图的 base64，保留几何、Host 身份和观察裁决。
                for (const item of toolResults) {
                    compactPostWriteImagePayloadForRuntimeLog(item.output);
                }

                const deferredTaskCallIds = new Set(toolResults
                    .filter((result) => result.output?.deferredByRuntimeDeclaration === true)
                    .map((result) => result.callId));
                const taskToolCalls = response.toolCalls.filter((call) => (
                    !isAgentHarnessControlTool(call.name)
                    && !deferredTaskCallIds.has(call.id)
                ));
                const taskToolCallIds = new Set(taskToolCalls.map((call) => call.id));
                const taskToolResults = toolResults.filter((result) => taskToolCallIds.has(result.callId));
                const failedTaskResults = taskToolResults.filter((result) => !result.success && (result.output as any)?.nonFatal !== true); // nonFatal=站间交接，是推进不是失败：不进复核红条与失败会计
                if (taskToolCalls.length > 0 && failedTaskResults.length > 0) {
                    const failedCallIds = new Set(failedTaskResults.map((result) => result.callId));
                    const failedToolNames = taskToolCalls
                        .filter((call) => failedCallIds.has(call.id))
                        .map((call) => call.name);
                    const attemptedToolNames = Array.from(new Set(
                        failedToolNames.map((name) => getToolDisplayInfo(name).name)
                    ));
                    const toolLabel = attemptedToolNames.slice(0, 4).join('、');
                    // 只读上下文工具（如超大文档的 getLayerHierarchy 读不动整棵层级树）失败不阻断任务：
                    // 一次「没读到」不等于「画面达不到要求」。给它套写后验证的话术，会让模型把读取失败
                    // 误判成「不能动手」而整单放弃（真机 SKU 病例即此）。这里把决定权还给模型——
                    // 给一条更轻的取数路（findLayers / rootLayerId）或允许按已确认信息继续，而不是判失败。
                    // 判据必须是「执行分类为只读观察」（getDocumentInfo / getLayerHierarchy 等），
                    // 不是 isReadOnlyAgentContextTool——后者只含 requestAgentCapabilities/switchDocument/
                    // selectLayer/focusLayer 四个上下文控制工具，用它会让本分支永不命中（已在真机复现）。
                    const allFailuresOrdinaryReadOnly = failedToolNames.length > 0
                        && failedToolNames.every((name) => (
                            !isRuntimeReferenceSearchTool(name)
                            && !isRuntimeReferenceVisualTool(name)
                            && (
                                classifyAgentToolExecution(name, {}) === 'read_only_observation'
                                || isReadOnlyAgentContextTool(name)
                            )
                        ));
                    const failedLogEntries = this.toolCallLog.filter((entry) => (
                        Boolean(entry.callId) && failedCallIds.has(String(entry.callId))
                    ));
                    const allFailuresExplicitlyNonBlocking = failedTaskResults.length > 0
                        && failedTaskResults.length === failedLogEntries.length
                        && failedLogEntries.every((entry) => (
                            entry.failureDisposition === 'non_blocking_observation'
                        ));
                    // 「Photoshop 连接断开」是运行环境问题，不是任务/模型问题：反复重试画布工具
                    // 只会空转到无进展停机（真机 2026-08-04：用户手动操作 PS 导致 UXP WebSocket
                    // 断开后，模型盲目重试 moveLayer 直到迭代耗尽，详情页任务停在"移动图层没有
                    // 全部成功"）。识别后明确指路：停止重试，提示用户检查 UXP 面板。
                    const failedBecausePhotoshopDisconnected = failedTaskResults.some((item) => {
                        const raw = item.output as any;
                        const candidates = [raw, raw?.data, raw?.result].filter(Boolean);
                        return candidates.some((node: any) => (
                            /UXP 插件连接已断开|UXP 插件连接已被新连接替换|WebSocket disconnected/i
                                .test(String(node?.error || node?.message || ''))
                        ));
                    });
                    if (failedBecausePhotoshopDisconnected) {
                        this.emitStep({
                            kind: 'warning',
                            title: 'Photoshop 连接断开',
                            detail: 'UXP 插件连接已断开，本轮画布工具无法执行。请检查 Photoshop 里的 DesignEcho 插件面板是否正常连接，恢复后继续；本轮不会改动画面。',
                            status: 'error',
                            iteration: this.iteration + 1,
                            maxIterations: this.config.maxIterations,
                            issue: 'photoshop_connection_lost',
                            audience: 'user',
                            visibility: 'user_process'
                        });
                        this.messages.push(createHarnessControlMessage(
                            [
                                'Photoshop 连接已经断开，这不是设计内容本身的问题。',
                                '不要继续重试画布操作。可以保留已经完成的分析，但需要告诉用户先在 Photoshop 中恢复 DesignEcho UXP 连接，之后才能继续制作。'
                            ].join('\n'), 'photoshop-connection-lost', 'environment-recovery'));
                    } else if (allFailuresOrdinaryReadOnly || allFailuresExplicitlyNonBlocking) {
                    // 「没有打开的文档」是确定性事实，不是读取故障：反复重读只会空转到无进展停机。
                    // 结构化字段优先；结果可能被包一层（data/result）或只回错误文本，故同时接受
                    // errorCode / documentState 与错误文案，避免识别落空（真机曾显示通用文案致模型空转重读）。
                    const failedBecauseNoOpenDocument = failedTaskResults.some((item) => {
                        const raw = item.output as any;
                        const candidates = [raw, raw?.data, raw?.result].filter(Boolean);
                        return candidates.some((node: any) => (
                            node?.documentState === 'absent'
                            || node?.errorCode === 'no_active_document'
                            || /没有打开的文档|没有活动文档|no active document/i.test(String(node?.error || ''))
                        ));
                    });
                    // 无打开的文档分支（读失败/无文档）与「连接断开」互斥，后者优先。
                    if (!failedBecauseNoOpenDocument) {
                            const nonBlockingCallIds = new Set(
                                failedTaskResults.map((result) => result.callId)
                            );
                            this.toolCallLog.forEach((entry) => {
                                if (entry.callId && nonBlockingCallIds.has(entry.callId)) {
                                    if (isRuntimeReferenceSearchTool(entry.name)
                                        || isRuntimeReferenceVisualTool(entry.name)) {
                                        const disposition = this.resolveReferenceFailureDisposition(
                                            entry.name,
                                            entry.result
                                        );
                                        if (disposition) entry.failureDisposition = disposition;
                                    } else {
                                        entry.failureDisposition = 'non_blocking_observation';
                                    }
                                }
                            });
                        }
                        this.emitStep({
                            kind: 'observation',
                            title: failedBecauseNoOpenDocument ? '当前没有打开的文档' : '这一步没读到',
                            detail: failedBecauseNoOpenDocument
                                ? '当前 Photoshop 没有打开的文档。要从零设计就先新建画布再开始；不用反复读取。'
                                : `${toolLabel}没有读到可用结果。可以换一种相关的查看方式，或基于已经确认的信息继续。`,
                            status: 'running',
                            iteration: this.iteration + 1,
                            maxIterations: this.config.maxIterations,
                            issue: failedBecauseNoOpenDocument
                                ? 'no_open_document_start_from_scratch'
                                : 'read_only_context_read_failed_non_blocking',
                            audience: 'user',
                            visibility: 'user_process'
                        });
                        this.messages.push(createHarnessControlMessage(failedBecauseNoOpenDocument
                            ? [
                                '当前 Photoshop 没有打开的文档，不要重复检查。',
                                '如果是从零设计，就按交付尺寸新建画布后开始；如果必须编辑现有文件，就请用户打开目标文件。'
                            ].join('\n')
                            : [
                                '这次没有读到可用内容。',
                                '这不代表画面不合格，也不代表整个任务失败。不要在同一目标上重复读取；只有仍缺少关键事实时才换一种有效方式查看，否则使用已确认的信息继续设计。'
                            ].join('\n'), 'read-only-context-read-recovery', 'read-only-context-recovery'));
                    } else {
                        const firstFailureReason = firstToolFailureReason(failedTaskResults).slice(0, 180);
                        // 单轮 Tool 失败是尝试级事实，不是任务终态。它仍进入 Debug / Tool log，
                        // 并原样回填模型用于下一轮重规划；只有最终 Outcome Ledger 仍未闭合时，
                        // 用户才会在终态看到真实阻塞。过去这里每轮投影红色“结果需要复核”，
                        // 即使下一轮已改走其它 Tool 完成交付也永久留在界面，制造假未完成。
                        this.emitStep({
                            kind: 'observation',
                            title: '工具尝试未闭合',
                            detail: `${toolLabel}${firstFailureReason ? `：${firstFailureReason}` : '返回了失败结果。'}`,
                            status: 'error',
                            iteration: this.iteration + 1,
                            maxIterations: this.config.maxIterations,
                            issue: 'tool_failures_in_round',
                            source: 'agent_runtime',
                            audience: 'debug'
                        });
                    }
                }

                  const harnessControlRepairApplied = this.applyInvalidHarnessControlRepairDirective(
                      response.toolCalls,
                      toolResults
                  );
                const runtimeStageRecoveryApplied = this.applyRuntimeControlStageStallRecovery({
                    progressKeyAtIterationStart: runtimeStageProgressKeyAtIterationStart,
                    iterationTools,
                    toolCalls: response.toolCalls,
                    toolResults
                });
                const noProgressMessage = this.updateLoopGuards(response.toolCalls, toolResults, {
                    suppressConsecutiveFailedRound: harnessControlRepairApplied
                        || workflowContinuationScopeApplied
                        || runtimeStageRecoveryApplied,
                    stageProgressChanged: this.readRuntimeStageProgressKey()
                        !== runtimeStageProgressKeyAtIterationStart
                });
                if (noProgressMessage) {
                    const livenessRecoveryApplied = await this.applyLoopGuardLivenessRecovery({
                        message: noProgressMessage,
                        toolCalls: response.toolCalls,
                        toolResults
                    });
                    if (!livenessRecoveryApplied) {
                        this.emitStep({
                            kind: 'stopped',
                            title: '检测到无进展循环，停止执行',
                            detail: noProgressMessage.split('\n')[0],
                            status: 'error',
                            iteration: this.iteration + 1,
                            maxIterations: this.config.maxIterations,
                            issue: 'no_progress'
                        });
                        this.config.callbacks.onProgress?.('检测到重复或失败循环，已停止', 100);
                        return this.buildRunResult({
                            success: false,
                            message: noProgressMessage,
                            iterations: this.iteration + 1,
                            error: 'No progress detected',
                            stopReason: 'no_progress'
                        });
                    }
                }

                // 7. 上下文管理（按本轮 Tool schema + 输出预留压缩旧结果；下一次调用前还会复核）。
                this.messages = this.contextManager.trim(
                    this.messages,
                    iterationReservedTokens
                );

                // 8. 通知迭代完成
                const completedIteration = this.iteration + 1;
                this.config.callbacks.onIterationComplete?.(
                    completedIteration,
                    this.config.maxIterations
                );

                this.advancePerformanceIteration(completedIteration);

                if (this.iteration >= this.config.maxIterations) {
                    return await this.requestForcedFinalResponse(this.iteration);
                }

            } catch (error: any) {
                console.error(`[Agent] Iteration ${this.iteration} error:`, error);
                rethrowKnownModelProviderFailure(this.config.modelId, error);
                const performanceBudgetExhaustion = error?.performanceBudgetExhaustion
                    || this.readPerformanceBudgetExhaustion();
                if (performanceBudgetExhaustion) {
                    return this.buildPerformanceBudgetRunResult(
                        performanceBudgetExhaustion,
                        this.iteration
                    );
                }

                // 模型调用失败：尝试恢复一次
                if (this.iteration > 0) {
                    return this.buildRunResult({
                        success: false,
                        message: buildAgentIterationFailureMessage(error),
                        iterations: this.iteration,
                        error: buildAgentIterationFailureMessage(error),
                        stopReason: 'error'
                    });
                }

                // 第一轮就失败：直接抛出
                throw error;
            }
        }

        // 达到最大迭代次数
        this.config.callbacks.onProgress?.('达到最大迭代次数，任务未确认完成', 100);
        return this.buildRunResult({
            success: false,
            message: this.buildMaxIterationsMessage(),
            iterations: this.iteration,
            error: 'Max iterations reached',
            stopReason: 'max_iterations'
        });
    }

    /**
     * 构建用户消息
     * 有图片时返回带 contentBlocks 的 multimodal 消息
     */
    /** 未注入 Skill performance_profile 时的兼容上限；生产任务以有效 profile 为准。 */
    private static readonly DEFAULT_MAX_VISION_CANDIDATES = 5;
    /** 单个复合 Tool 结果最多登记的画面；超出视觉预算的画面也要留下“未观察”记录。 */
    private static readonly MAX_TOOL_RESULT_IMAGE_CANDIDATES =
        AGENT_GLOBAL_SKILL_BUDGET_LIMITS.maxVisionCandidates;
    /** 发给用户看的快照张数上限（防刷屏；独立于喂模型的观察上限）。 */
    private static readonly MAX_USER_SNAPSHOT_IMAGES = 8;

    /** 把用户附件交给当前唯一 Agent 模型；模型无视觉能力时如实停止视觉观察。 */
    private async attachInitialImageObservations(task: string, images?: ImageAttachment[]): Promise<void> {
        if (!images?.length) return;

        const primaryModel = getModelById(this.config.modelId);
        const expertModelId = '';
        const strategy = resolveVisualObservationStrategy({
            primaryModelSupportsVision: canAttemptModelVision(primaryModel)
        });
        if (strategy === 'primary-self') {
            if (!this.initialImagesPendingPrimaryObservation) {
                this.messages.push(createRuntimeObservationMessage(
                    '（本轮视觉候选或视觉分析预算为 0，上传图片未进入模型判断；不要声称已查看图片。）',
                    'attached-image-visual-budget',
                    { scope: 'attached-image-visual-status', origin: 'visual_observation' }
                ));
                this.emitStep({
                    kind: 'warning',
                    title: '用户图片未纳入本轮判断',
                    detail: '当前 Skill 的视觉预算不允许继续读取附件，已保留文字任务继续处理。',
                    status: 'error',
                    iteration: 0,
                    maxIterations: this.config.maxIterations,
                    issue: 'initial_image_visual_budget_exhausted'
                });
            }
            return;
        }

        if (strategy === 'no-visual-capability') {
            this.messages.push(createRuntimeObservationMessage(
                '（用户上传了图片，但当前主模型不支持读图，且没有配置可用的视觉模型。图片内容尚未被真实读取；不要臆造画面信息，应先说明视觉观察不可用。）',
                'attached-image-no-visual-capability',
                { scope: 'attached-image-visual-status', origin: 'visual_observation' }
            ));
            this.emitStep({
                kind: 'warning',
                title: '用户图片暂时无法读取',
                detail: '主模型无视觉能力，且视觉模型未配置或不支持读图。',
                status: 'error',
                iteration: 0,
                maxIterations: this.config.maxIterations,
                issue: 'initial_image_no_visual_capability'
            });
            return;
        }

        if (!this.hasPerformanceVisualAnalysisCapacity()) {
            this.messages.push(createRuntimeObservationMessage(
                '（本轮视觉分析预算已用尽，上传图片尚未被真实读取；不要臆造图片内容。）',
                'attached-image-analysis-budget',
                { scope: 'attached-image-visual-status', origin: 'visual_observation' }
            ));
            this.emitStep({
                kind: 'warning',
                title: '用户图片未纳入本轮判断',
                detail: '已达到当前 Skill 的视觉分析次数上限。',
                status: 'error',
                iteration: 0,
                maxIterations: this.config.maxIterations,
                issue: 'initial_image_visual_analysis_budget_exhausted'
            });
            return;
        }

        const visibleImages = this.selectPerformanceVisionCandidates(
            images.slice(0, this.getPerformanceInitialVisionCandidateLimit())
        );
        if (visibleImages.length === 0) {
            this.messages.push(createRuntimeObservationMessage(
                '（本轮视觉候选预算已用尽，上传图片尚未被真实读取；不要臆造图片内容。）',
                'attached-image-candidate-budget',
                { scope: 'attached-image-visual-status', origin: 'visual_observation' }
            ));
            return;
        }
        const prompt = [
            VISUAL_EXPERT_INPUT_PROMPT,
            '',
            `用户目标：${task}`,
            `本次提供 ${visibleImages.length} 张图片${images.length > visibleImages.length ? `（另有 ${images.length - visibleImages.length} 张未纳入本次视觉预算）` : ''}。`
        ].join('\n');

        try {
            const response = await this.modelCallAccounting.callAgentProvider(
                expertModelId,
                [{
                    role: 'user',
                    content: prompt,
                    contentBlocks: [
                        { type: 'text', text: prompt },
                        ...visibleImages.map((image) => ({
                            type: 'image' as const,
                            data: image.data,
                            mediaType: image.mediaType
                        }))
                    ]
                }],
                [],
                {
                    maxTokens: 1600,
                    temperature: 0.2,
                    timeoutMs: AGENT_MODEL_REQUEST_TIMEOUT_MS
                },
                {
                    callKind: 'visual_observation',
                    requestMode: 'non_stream',
                    agentIteration: this.iteration + 1,
                    visualAnalysis: true
                }
            );
            const observation = readCompleteProviderTextContent(response).content.trim();
            if (!observation) {
                throw new Error('视觉模型没有返回完整结果');
            }
            this.messages.push(createRuntimeObservationMessage(
                `（视觉模型 ${expertModelId} 已读取用户上传图片。以下是可验证的视觉观察，供你规划；最终判断仍由你负责：\n${observation}）`,
                'attached-image-visual-expert',
                { scope: 'attached-image-visual-status', origin: 'visual_observation' }
            ));
            this.attachedImageObservationAvailable = true;
            this.observedInputImageCount = visibleImages.length;
            this.emitStep({
                kind: 'observation',
                title: '视觉模型已读取用户图片',
                detail: `${visibleImages.length} 张图片已转为结构化视觉观察并交回主 Agent。`,
                status: 'success',
                iteration: 0,
                maxIterations: this.config.maxIterations
            });
        } catch (error: any) {
            this.messages.push(createRuntimeObservationMessage(
                '（视觉模型读取用户图片失败，图片内容未经确认。不要臆造画面信息，应根据现有文字与工具结果谨慎继续。）',
                'attached-image-visual-expert-failed',
                { scope: 'attached-image-visual-status', origin: 'visual_observation' }
            ));
            this.emitStep({
                kind: 'warning',
                title: '用户图片读取失败',
                detail: `视觉模型 ${expertModelId} 调用失败：${error?.message || '未知错误'}。`,
                status: 'error',
                iteration: 0,
                maxIterations: this.config.maxIterations,
                issue: 'initial_image_visual_expert_failed'
            });
        }
    }

    /**
     * 把本轮工具产生的画面快照转发到用户对话，让用户看到「Agent 看到的是什么」。
     * 独立于「喂给模型」的视觉观察上限；连续相同画面去重 + 张数封顶，避免刷屏。
     */
    private emitUserVisibleSnapshots(
        toolResults: Array<{ callId: string; success: boolean; output: any }>
    ): void {
        const onSnapshotImage = this.config.callbacks?.onSnapshotImage;
        if (!onSnapshotImage) return;
        const recentLog = this.toolCallLog.slice(-toolResults.length);
        for (let i = 0; i < toolResults.length; i++) {
            if (this.userSnapshotEmitCount >= Agent.MAX_USER_SNAPSHOT_IMAGES) return;
            const item = toolResults[i];
            if (!item) continue;
            if (isAgentReadResultCacheHit(item.output)) continue;
            const toolName = recentLog[i]?.name || 'snapshot';
            const images = extractImagesFromToolResult(
                item.output,
                Agent.MAX_USER_SNAPSHOT_IMAGES - this.userSnapshotEmitCount,
                toolName
            );
            for (let imageIndex = 0; imageIndex < images.length; imageIndex++) {
                const image = images[imageIndex];
                if (this.userSnapshotEmitCount >= Agent.MAX_USER_SNAPSHOT_IMAGES) return;
                if (!image.data) continue;
                const signature = [
                    image.observationKey || image.resultPath || String(image.sourceId ?? ''),
                    image.data.length,
                    image.data.slice(0, 48),
                    image.data.slice(-48)
                ].join(':');
                if (signature === this.lastUserSnapshotSignature) continue; // 跳过与上一张完全相同的画面
                this.lastUserSnapshotSignature = signature;
                this.userSnapshotEmitCount++;
                const sourceLabel = image.sourceName || image.sourceId;
                const snapshotToolName = images.length > 1
                    ? `${toolName} ${sourceLabel ? `· ${sourceLabel}` : `· 画面 ${imageIndex + 1}`}`
                    : toolName;
                try {
                    onSnapshotImage({
                        data: image.data,
                        mediaType: image.mediaType,
                        toolName: snapshotToolName,
                        index: this.userSnapshotEmitCount
                    });
                } catch {
                    // 转发用户快照失败不影响主循环
                }
            }
        }
    }

    /**
     * 在 ToolResult 像素被运行日志压缩前，复制当前版本可供 R5 使用的完整画面集合。
     * Runtime 签发的视觉回执负责证明 producer 与 Photoshop 版本；ReviewSet 只保存像素证据，
     * 不保存评分或完成状态。
     */
    private captureLatestDesignVisualJudgeReviewSet(
        toolResults: Array<{ callId: string; success: boolean; output: any }>
    ): void {
        const recentLog = this.toolCallLog.slice(-toolResults.length);
        for (let index = 0; index < toolResults.length; index += 1) {
            const item = toolResults[index];
            const logEntry = recentLog[index];
            if (!item || !logEntry || isAgentReadResultCacheHit(item.output)) continue;

            const trustedArtifact = readTrustedVisualReviewArtifact(item.output);
            if (trustedArtifact) {
                this.latestDesignVisualJudgeBundleReviewSet = undefined;
                this.latestDesignVisualJudgeSingleReviewSet = undefined;
                const images = trustedArtifact.reviewSet.items
                    .map((reviewItem) => buildToolResultImageFromVisualObservationItem({
                        identity: reviewItem.identity,
                        image: reviewItem.image
                    }))
                    .filter((image): image is ToolResultImage => Boolean(image?.data))
                    .map((image) => ({
                        ...image,
                        data: String(image.data),
                        ...(image.observationIdentity
                            ? { observationIdentity: { ...image.observationIdentity } }
                            : {})
                    }));
                if (images.length !== trustedArtifact.reviewSet.expectedObservationCount) continue;
                const candidate: DesignVisualJudgeReviewSet = {
                    reviewSet: trustedArtifact.reviewSet,
                    images,
                    historyStateRef: { ...trustedArtifact.historyStateRef },
                    receipt: { ...trustedArtifact.receipt },
                    // WeakMap 已验证 outer owner；这里仅保留 owner 供本代继续投影，不扫描其字段。
                    sourceOutput: item.output
                };
                if (trustedArtifact.reviewSet.source === 'visual_observation_bundle') {
                    this.latestDesignVisualJudgeBundleReviewSet = candidate;
                } else {
                    this.latestDesignVisualJudgeSingleReviewSet = candidate;
                }
                continue;
            }

            // 先清旧证据，再检查同一复合 Skill 结果里是否包含写后的完整 Bundle。
            // 这允许“写入 + 写后全屏观察”成为新候选，又不会把写前截图留到终审。
            if (findObservedPhotoshopMutationProof(item.output)) {
                this.latestDesignVisualJudgeBundleReviewSet = undefined;
                this.latestDesignVisualJudgeSingleReviewSet = undefined;
            }
            if (!item.success || item.output?.success === false) continue;

            const receipt = readAgentVisualObservationReceipt(item.output);
            const historyStateRef = readPhotoshopHistoryStateRef(item.output);
            if (!receipt || !historyStateRef
                || String(historyStateRef.documentId) !== receipt.document
                || String(historyStateRef.historyStateId) !== receipt.history) {
                continue;
            }

            const bundleScan = inspectVisualObservationBundles(item.output, logEntry.name);
            if (!bundleScan.truncated && bundleScan.invalidBundleCount === 0) {
                for (const bundle of bundleScan.bundles) {
                    const built = buildDesignReviewSetFromBundle(bundle);
                    if (built.status !== 'ready'
                        || built.reviewSet.document !== receipt.document
                        || built.reviewSet.history !== receipt.history) {
                        continue;
                    }
                    const orderedImages = built.reviewSet.items
                        .map((reviewItem) => buildToolResultImageFromVisualObservationItem({
                            identity: reviewItem.identity,
                            image: reviewItem.image
                        }))
                        .filter((image): image is ToolResultImage => Boolean(image?.data))
                        .map((image) => ({
                            ...image,
                            data: String(image.data),
                            ...(image.observationIdentity
                                ? { observationIdentity: { ...image.observationIdentity } }
                                : {})
                        }));
                    if (orderedImages.length !== built.reviewSet.expectedObservationCount) continue;
                    const currentSet = this.latestDesignVisualJudgeBundleReviewSet?.reviewSet;
                    if (currentSet?.source === 'visual_observation_bundle'
                        && currentSet.document === built.reviewSet.document
                        && currentSet.history === built.reviewSet.history
                        && currentSet.expectedObservationCount > built.reviewSet.expectedObservationCount) {
                        continue;
                    }
                    this.latestDesignVisualJudgeBundleReviewSet = {
                        reviewSet: built.reviewSet,
                        images: orderedImages,
                        historyStateRef: { ...historyStateRef },
                        receipt: { ...receipt },
                        sourceOutput: item.output
                    };
                }
            }

            // Bundle 与全画布分开保留：详情页终局选完整 Bundle，主图/单画布
            // 任务选最新 full-canvas。通用捕获层不再假设“任何 Bundle 都比全画布强”。
            if (!isFullSurfaceVisualJudgeObservationEntry(logEntry)) continue;
            const image = extractImageFromToolResult(item.output);
            if (!image?.data) continue;
            const built = buildDesignReviewSetFromSingleSurface({
                identity: {
                    outer: logEntry.name,
                    resultPath: '$',
                    document: receipt.document,
                    history: receipt.history,
                    sourceKind: 'canvas',
                    sourceId: `document:${receipt.document}`
                },
                image: {
                    base64: image.data,
                    mediaType: image.mediaType,
                    format: image.mediaType.replace(/^image\//u, '')
                }
            });
            if (built.status !== 'ready') continue;
            this.latestDesignVisualJudgeSingleReviewSet = {
                reviewSet: built.reviewSet,
                images: [{ ...image, data: String(image.data) }],
                historyStateRef: { ...historyStateRef },
                receipt: { ...receipt },
                sourceOutput: item.output
            };
        }
    }

    /**
     * 把本 Agent 在日志压缩前取得的最新完整 ReviewSet 签到返回对象上，并单独记录
     * 真正 reviewed 的 observationKey 子集。像素完整性与评审覆盖分离，二者都不授予
     * 质量通过结论。
     */
    private writeTrustedVisualReviewArtifactForRunResult(owner: AgentRunResult): void {
        const evaluationProfile = this.resolveRuntimeEvaluationProfile();
        const candidate = this.findLatestDesignVisualJudgeReviewSet(
            this.resolveFinalReviewSetRequirements(evaluationProfile).requireMultiSurface
        );
        if (!candidate) return;
        const observations = readAgentVisualObservations(candidate.sourceOutput);
        const reviewedKeys = new Set(observations
            .filter((observation) => observation.reviewed === true)
            .map((observation) => String(observation.observationKey || '').trim())
            .filter(Boolean));
        const observationKeys = candidate.reviewSet.items.map((item) => item.observationKey);
        const coreArtifactWritten = writeTrustedVisualReviewArtifact(owner, {
            receipt: candidate.receipt,
            reviewSet: candidate.reviewSet,
            historyStateRef: candidate.historyStateRef,
            observationKeys,
            reviewedObservationKeys: observationKeys.filter((key) => reviewedKeys.has(key)),
            fullyReviewed: false,
            supportingSourcePlacements: projectFinalSupportingSourceCarryover(
                this.toolCallLog, candidate.historyStateRef, readTrustedVisualReviewArtifact(this.config.reflexionHandoff)?.supportingSourcePlacements,
                this.finalQualityModelProtocolDigest?.evidenceScope.selectedSourceCompared === true
            )
        });
        if (!coreArtifactWritten || this.finalQualityModelProtocolDigest?.judgeStatus !== 'completed'
            || !this.pendingTrustedFinalComparisonWrite) return;
        writeTrustedFinalComparisonEvidenceAfterJudge({
            targetOwner: owner,
            ...this.pendingTrustedFinalComparisonWrite
        });
    }

    /**
     * 快照类工具结果的图像以 user 图像消息回传给视觉模型。
     * 非视觉模型跳过（工具结果文本中保留截断说明）；按运行级预算封顶。
     */
    private async attachToolImageObservations(toolResults: Array<{ callId: string; success: boolean; output: any }>): Promise<void> {
        for (const item of toolResults) {
            if (isAgentReadResultCacheHit(item.output)
                || readTrustedVisualReviewArtifact(item.output)) continue;
            clearProducerVisualRuntimeAnnotations(item.output);
        }
        // 先把本轮快照发到用户对话（让用户看到 Agent 在看什么），独立于“喂模型”的观察上限。
        this.emitUserVisibleSnapshots(toolResults);

        const primaryModel = getModelById(this.config.modelId);
        const expertModelId = '';
        const strategy = resolveVisualObservationStrategy({
            primaryModelSupportsVision: canAttemptModelVision(primaryModel)
        });

        // toolCallLog 与本轮 toolResults 同序追加，取尾部对应名称
        const recentLog = this.toolCallLog.slice(-toolResults.length);
        const visualExpertCandidates: VisualExpertToolImageCandidate[] = [];
        for (let i = 0; i < toolResults.length; i++) {
            const item = toolResults[i];
            // 缓存快照只把既有文字结果回填模型，不再次发图、不重新写观察回执，
            // 也不消耗用户预览或视觉模型预算。
            if (isAgentReadResultCacheHit(item.output)) continue;
            const trustedArtifact = readTrustedVisualReviewArtifact(item.output);
            if (trustedArtifact) {
                // 子 Critic 已在父预算事前提交的 allowance 内真实读过这些画面。父 Agent 继承
                // observationKey 只用于证据关联，不把同一像素再次塞进普通 Tool-image 消息；
                // 终局 Profile Judge 若再次发送完整 ReviewSet，仍按全部图像 presentation 计费。
                for (const observationKey of trustedArtifact.reviewedObservationKeys) {
                    this.performanceLedger.visionCandidateKeys.add(observationKey);
                }
                this.synchronizeRuntimePerformanceUsage();
                this.messages.push(createRuntimeObservationMessage(
                    `（Design Team 已传回 ${trustedArtifact.observationKeys.length} 个同版本画面，其中 Critic 真实复核 ${trustedArtifact.reviewedObservationKeys.length} 个；本轮复用该 ReviewSet，不重复发送普通截图。）`,
                    'design-team-trusted-visual-review-reused',
                    { scope: 'design-team-visual-review', origin: 'visual_observation' }
                ));
                continue;
            }
            const baseToolName = recentLog[i]?.name || 'snapshot';
            const runtimeVisualObservationReceipt = deriveAgentVisualObservationReceipt({
                toolResult: item.output,
                outerToolName: baseToolName,
                isTrustedObservationTool: (toolName) => (
                    classifyAgentToolExecution(toolName) === 'read_only_observation'
                    && isAgentPhotoshopDocumentObservation(toolName)
                )
            });
            if (runtimeVisualObservationReceipt) {
                writeAgentVisualObservationReceipt(item.output, runtimeVisualObservationReceipt);
            }
            const imageCollection = collectImagesFromToolResult(
                item.output,
                Agent.MAX_TOOL_RESULT_IMAGE_CANDIDATES,
                baseToolName
            );
            const images = imageCollection.images;
            if (imageCollection.overflow) {
                writeAgentVisualObservationOverflow(item.output, {
                    outer: baseToolName,
                    expectedCount: imageCollection.overflow.expectedCount,
                    extractedCount: imageCollection.overflow.extractedCount,
                    omittedCount: imageCollection.overflow.omittedCount,
                    reason: imageCollection.overflow.reason
                });
            }
            if (images.length === 0) continue;
            for (let imageIndex = 0; imageIndex < images.length; imageIndex++) {
                let image = images[imageIndex];
                const sourceLabel = image.sourceName || image.sourceId;
                const toolName = images.length > 1
                    ? `${baseToolName} ${sourceLabel ? `· ${sourceLabel}` : `· 画面 ${imageIndex + 1}`}`
                    : baseToolName;
                const observationSource = {
                    ...(image.sourceId !== undefined ? { sourceId: image.sourceId } : {}),
                    ...(image.sourceName ? { sourceName: image.sourceName } : {}),
                    ...(image.resultPath ? { resultPath: image.resultPath } : {}),
                    ...(image.sourceKind ? { sourceKind: image.sourceKind } : {}),
                    ...(image.observationIdentity ? { observationIdentity: image.observationIdentity } : {}),
                    ...(image.observationKey ? { observationKey: image.observationKey } : {})
                };

                // A primary-model image is not a complete budget event by itself: the next
                // provider request must still have one visual-analysis slot. Reserve both
                // atomically before queuing pixels, including the degraded-thumbnail path.
                if (strategy === 'primary-self' && !this.canQueuePrimaryVisualPresentation()) {
                    writeAgentVisualObservation(item.output, {
                        status: 'not_observed',
                        reviewed: false,
                        observer: 'none',
                        strategy,
                        toolName,
                        ...observationSource,
                        reason: 'visual_analysis_budget_exhausted'
                    });
                    this.messages.push(createRuntimeObservationMessage(
                        `（${toolName} 产生了画布图像，但剩余视觉预算不足以同时发送这张图并完成下一次读图判断，因此这张画面没有被真实读取。不要基于臆想描述画面；请使用已有读回事实继续完成保存或如实说明待复核。）`,
                        'tool-image-visual-presentation-budget-exhausted',
                        { scope: `tool-visual:${toolName}`, origin: 'visual_observation' }
                    ));
                    continue;
                }

                const visionCandidateLimit = this.getPerformanceVisionCandidateLimit();
                // 设计路径宪法：候选额度用尽不等于失明。主模型自己能看图时，超额部分改为缩略图读入
                // （≤512px，成本约全图 1/6），只用于判断整体；再超过防失控硬顶或缩图失败才走下面的诚实路径。
                let degradedForBudget = false;
                if (this.performanceLedger.visionCandidateCount >= visionCandidateLimit
                    && strategy === 'primary-self'
                    && this.performanceLedger.visionCandidateCount
                        < visionCandidateLimit + VISION_DEGRADED_CANDIDATE_ALLOWANCE) {
                    const thumbnail = await downscaleImageDataForVision(image, VISION_THUMBNAIL_MAX_EDGE);
                    if (thumbnail) {
                        image = { ...image, data: thumbnail.data, mediaType: 'image/jpeg' };
                        degradedForBudget = true;
                    }
                }
            // 预算耗尽时必须**告诉模型**它这次没看见。此前只写一条内部记录就 continue，
            // 模型看到截图工具返回 success、上下文里既没有图也没有提示，于是自信地描述
            // 一张它根本没读过的画面——比"看得少"更危险。写法对齐下方 no-visual-capability 分支。
                if (!degradedForBudget && this.performanceLedger.visionCandidateCount >= visionCandidateLimit) {
                writeAgentVisualObservation(item.output, {
                    status: 'not_observed',
                    reviewed: false,
                    observer: 'none',
                    strategy,
                    toolName,
                    ...observationSource,
                    reason: 'vision_candidate_budget_exhausted'
                });
                this.messages.push(createRuntimeObservationMessage(
                    `（${toolName} 产生了画布图像，但本轮可读取的画面数量已用尽，这张画面没有被真实读取。不要基于臆想描述画面；如果必须确认视觉效果，请如实说明这一步没能核对。）`,
                    'tool-image-vision-candidate-budget-exhausted',
                    { scope: `tool-visual:${toolName}`, origin: 'visual_observation' }
                ));
                    continue;
                }

                if (!degradedForBudget
                    && strategy !== 'no-visual-capability'
                    && !this.hasPerformanceVisualAnalysisCapacity()) {
                writeAgentVisualObservation(item.output, {
                    status: 'not_observed',
                    reviewed: false,
                    observer: 'none',
                    strategy,
                    toolName,
                    ...observationSource,
                    reason: 'visual_analysis_budget_exhausted'
                });
                this.messages.push(createRuntimeObservationMessage(
                    `（${toolName} 产生了画布图像，但本轮视觉分析预算已用尽，这张画面没有被真实读取。不要基于臆想描述画面；如果必须确认视觉效果，请如实说明这一步没能核对。）`,
                    'tool-image-visual-analysis-budget-exhausted',
                    { scope: `tool-visual:${toolName}`, origin: 'visual_observation' }
                ));
                    continue;
                }

                if (!this.consumePerformanceVisionCandidate(image.observationKey, degradedForBudget)) continue;

            // 主模型支持视觉：图直接回传，主模型自己看
                if (strategy === 'primary-self') {
                this.toolImageObservationCount++;
                const observation = writeAgentVisualObservation(item.output, {
                    status: 'presented_to_primary', presentedModelTurn: this.iteration + 1,
                    reviewed: false,
                    observer: 'primary_model',
                    strategy,
                    toolName,
                    ...observationSource
                });
                if (observation) {
                    this.pendingPrimaryVisualObservations.push(observation);
                    if (observation.observationKey) {
                        const presentedPixelDigest = writeAgentVisualObservationPresentationDigest({
                            toolResult: item.output,
                            observationKey: observation.observationKey,
                            // image 已经过当前预算的真实缩图处理；摘要必须绑定即将加入
                            // Provider contentBlocks 的最终 bytes，不能回看 Tool 原图。
                            presentedImageData: image.data
                        });
                        if (presentedPixelDigest) {
                            // Tool log 会在本轮末尾释放大像素；只为候选集/显式参考保留本 run
                            // 的 Runtime-owned presentation 重放副本。该缓存不持久化、不排名，
                            // 且必须与刚签发的主模型实际 presentation digest 完全一致。
                            writeDesignFinalComparisonPresentationReplay({
                                toolResult: item.output,
                                toolName,
                                observationKey: observation.observationKey,
                                replayImage: {
                                    data: image.data,
                                    mediaType: image.mediaType
                                }
                            });
                        }
                    }
                }
                this.messages.push(createRuntimeObservationMessage('', 'tool-image-observation', {
                    scope: `tool-visual:${toolName}`,
                    origin: 'visual_observation',
                    contentBlocks: [
                        {
                            type: 'text',
                            text: [
                                degradedForBudget
                                    ? `（${toolName} 返回的画布图像已超出本轮画面读取额度，这张按缩略图（≤${VISION_THUMBNAIL_MAX_EDGE}px）读入：只用于判断整体构图与层级，不要据此断言细节文字是否清晰；确需核对细节请说明并只截取局部小区域。）`
                                    : `（${toolName} 返回的画布图像，供你核对实际状态；本次运行视觉候选 ${this.performanceLedger.visionCandidateCount}/${visionCandidateLimit}）`,
                                image.observationKey
                                    ? buildPrimaryVisualObservationReviewInstruction(
                                        image.observationKey,
                                        image.sourceName || String(image.sourceId || toolName),
                                        image.sourceKind
                                    )
                                    : ''
                            ].filter(Boolean).join('\n')
                        },
                        registerRuntimeVisualPresentationBlock(
                            { type: 'image', data: image.data, mediaType: image.mediaType },
                            observation?.observationKey
                        )
                    ]
                }));
                this.emitStep({
                    kind: 'observation',
                    title: '画布图像已回传模型',
                    detail: `${toolName} 的图像作为视觉观察进入对话（候选 ${this.performanceLedger.visionCandidateCount}/${visionCandidateLimit}）。`,
                    status: 'success',
                    iteration: this.iteration + 1,
                    maxIterations: this.config.maxIterations
                });
                    continue;
                }

            // 主模型无视觉、也没有可用视觉模型：如实告知，不假装看过
                if (strategy === 'no-visual-capability') {
                this.toolImageObservationCount++;
                writeAgentVisualObservation(item.output, {
                    status: 'not_observed',
                    reviewed: false,
                    observer: 'none',
                    strategy,
                    toolName,
                    ...observationSource,
                    reason: 'no_visual_capability'
                });
                this.messages.push(createRuntimeObservationMessage(
                    `（${toolName} 产生了画布图像，但当前主模型不支持读图、且没有可用的视觉分析模型，无法核对画面真实状态。请基于工具的结构化结果谨慎判断，不要假装已确认视觉效果。）`,
                    'tool-image-no-visual-capability',
                    { scope: `tool-visual:${toolName}`, origin: 'visual_observation' }
                ));
                this.emitStep({
                    kind: 'warning',
                    title: '无法核对画面',
                    detail: `主模型无视觉能力且未配置视觉分析模型，${toolName} 的画面未经真实核对。`,
                    status: 'error',
                    iteration: this.iteration + 1,
                    maxIterations: this.config.maxIterations,
                    issue: 'visual_observation_no_capability'
                });
                    continue;
                }

            // 主模型无视觉，但配了视觉槽模型：先跨 Tool 聚合候选，随后每批最多 3 张调用一次。
            // 批处理只节约 model call；观察记录仍按 observationKey 独立回写和验收。
                this.toolImageObservationCount++;
                if (!image.observationKey) {
                    writeAgentVisualObservation(item.output, {
                        status: 'not_observed',
                        reviewed: false,
                        observer: 'visual_expert',
                        strategy,
                        toolName,
                        ...observationSource,
                        reason: 'visual_expert_invalid_review'
                    });
                    this.messages.push(createRuntimeObservationMessage(
                        `（${toolName} 缺少稳定 observationKey，视觉专家不能安全回写该画面的复核结果；该图保持未复核。）`,
                        'tool-image-visual-expert-empty',
                        { scope: `tool-visual:${toolName}`, origin: 'visual_observation' }
                    ));
                    continue;
                }
                visualExpertCandidates.push({
                    output: item.output,
                    image,
                    toolName,
                    observationSource
                });
            }
        }
        if (visualExpertCandidates.length > 0) {
            await this.reviewToolImagesWithVisualExpert(visualExpertCandidates, expertModelId);
        }
    }

    private async reviewToolImagesWithVisualExpert(
        candidates: readonly VisualExpertToolImageCandidate[],
        expertModelId: string
    ): Promise<void> {
        for (
            let batchStart = 0;
            batchStart < candidates.length;
            batchStart += MAX_VISUAL_EXPERT_BATCH_IMAGES
        ) {
            const batchCandidates = candidates.slice(
                batchStart,
                batchStart + MAX_VISUAL_EXPERT_BATCH_IMAGES
            );
            if (!this.hasPerformanceVisualAnalysisCapacity()) {
                const remaining = candidates.slice(batchStart);
                for (const candidate of remaining) {
                    writeAgentVisualObservation(candidate.output, {
                        status: 'not_observed',
                        reviewed: false,
                        observer: 'none',
                        strategy: 'visual-expert',
                        toolName: candidate.toolName,
                        ...candidate.observationSource,
                        reason: 'visual_analysis_budget_exhausted'
                    });
                }
                this.messages.push(createRuntimeObservationMessage(
                    `（本轮视觉分析次数已用尽，后续 ${remaining.length} 张画面没有被视觉专家真实读取；这些观察记录保持未复核。）`,
                    'tool-image-visual-analysis-budget-exhausted',
                    { scope: 'tool-visual:expert-batch', origin: 'visual_observation' }
                ));
                this.emitStep({
                    kind: 'warning',
                    title: '部分画面未进入视觉复核',
                    detail: `视觉专家批复核预算已用尽，仍有 ${remaining.length} 张画面未读取。`,
                    status: 'error',
                    iteration: this.iteration + 1,
                    maxIterations: this.config.maxIterations,
                    issue: 'visual_observation_analysis_budget_exhausted'
                });
                return;
            }

            const promptItems = batchCandidates.map((candidate) => ({
                observationKey: candidate.image.observationKey!,
                label: candidate.image.sourceName
                    || String(candidate.image.sourceId || candidate.toolName),
                sourceKind: candidate.image.sourceKind
            }));
            const expertPrompt = buildVisualExpertReviewBatchPrompt(promptItems);
            const contentBlocks: ContentBlock[] = [{ type: 'text', text: expertPrompt }];
            for (let index = 0; index < batchCandidates.length; index += 1) {
                const candidate = batchCandidates[index];
                const promptItem = promptItems[index];
                contentBlocks.push({
                    type: 'text',
                    text: `图片 ${index + 1}：${promptItem.label}；observationKey=${promptItem.observationKey}`
                });
                contentBlocks.push({
                    type: 'image',
                    data: candidate.image.data,
                    mediaType: candidate.image.mediaType
                });
            }

            try {
                // 视觉专家只做「看图 → 按清单返回 JSON」，不需要长思考。真机 2026-08-19（run 498）：
                // 默认开着思考的 mimo-v2.5 每张快照要 60–80 秒，且常把 1800 token 全花在思考上、正文为空
                // （finish_reason=length）——67 秒白等一场，画面还是「未复核」。这里明确关思考，
                // 与评审器 / analyzeAssetContent 同一口径；主循环模型的思考不受影响。
                const expertResponse = await this.modelCallAccounting.callAgentProvider(
                    expertModelId,
                    [{
                        role: 'user',
                        content: expertPrompt,
                        contentBlocks
                    }],
                    [],
                    {
                        maxTokens: 1800,
                        temperature: 0.2,
                        timeoutMs: AGENT_MODEL_REQUEST_TIMEOUT_MS,
                        thinkingEnabled: false
                    },
                    {
                        callKind: 'visual_observation',
                        requestMode: 'non_stream',
                        agentIteration: this.iteration + 1,
                        visualAnalysis: true
                    }
                );
                const judgment = readCompleteProviderTextContent(expertResponse).content.trim();
                if (!judgment) throw new Error('视觉模型没有返回完整结果');
                const reviewBatch = parseVisualExpertReviewBatch(
                    judgment,
                    promptItems.map((item) => item.observationKey)
                );
                const decisionsByKey = new Map(
                    (reviewBatch?.decisions || []).map((decision) => [decision.observationKey, decision])
                );
                const reviewedLines: string[] = [];
                const missingLabels: string[] = [];
                for (let index = 0; index < batchCandidates.length; index += 1) {
                    const candidate = batchCandidates[index];
                    const promptItem = promptItems[index];
                    const reviewDecision = decisionsByKey.get(promptItem.observationKey);
                    if (reviewDecision) {
                        writeAgentVisualObservation(candidate.output, {
                            status: 'observed_by_visual_expert',
                            reviewed: true,
                            observer: 'visual_expert',
                            strategy: 'visual-expert',
                            toolName: candidate.toolName,
                            ...candidate.observationSource,
                            reviewDecision
                        });
                        const issueText = reviewDecision.issues?.length
                            ? `；问题：${reviewDecision.issues.join('；')}`
                            : '';
                        reviewedLines.push(
                            `${promptItem.label}=${reviewDecision.status}：${reviewDecision.summary}${issueText}`
                        );
                        continue;
                    }

                    writeAgentVisualObservation(candidate.output, {
                        status: 'not_observed',
                        reviewed: false,
                        observer: 'visual_expert',
                        strategy: 'visual-expert',
                        toolName: candidate.toolName,
                        ...candidate.observationSource,
                        reason: judgment
                            ? 'visual_expert_invalid_review'
                            : 'visual_expert_empty'
                    });
                    missingLabels.push(promptItem.label);
                }

                const reviewedText = reviewedLines.length > 0
                    ? `已取得逐图结构化结论：${reviewedLines.join('\n')}`
                    : '本批没有取得任何可验证的逐图结构化结论。';
                const missingText = missingLabels.length > 0
                    ? `\n未有效复核：${missingLabels.join('、')}。这些画面仍保持未复核。`
                    : '';
                this.messages.push(createRuntimeObservationMessage(
                    `（视觉专家模型 ${expertModelId} 批量查看了 ${batchCandidates.length} 张画面。${reviewedText}${missingText}）`,
                    missingLabels.length > 0
                        ? 'tool-image-visual-expert-partial'
                        : 'tool-image-visual-expert',
                    { scope: 'tool-visual:expert-batch', origin: 'visual_observation' }
                ));
                this.emitStep({
                    kind: missingLabels.length > 0 ? 'warning' : 'observation',
                    title: missingLabels.length > 0 ? '视觉专家批复核不完整' : '视觉专家已批量看图',
                    detail: missingLabels.length > 0
                        ? `${batchCandidates.length} 张中有 ${missingLabels.length} 张没有有效结构化结论。`
                        : `${batchCandidates.length} 张画面已在一次视觉分析中逐图复核。`,
                    status: missingLabels.length > 0 ? 'error' : 'success',
                    iteration: this.iteration + 1,
                    maxIterations: this.config.maxIterations,
                    ...(missingLabels.length > 0
                        ? { issue: 'visual_observation_expert_partial' }
                        : {})
                });
            } catch (error: any) {
                for (const candidate of batchCandidates) {
                    writeAgentVisualObservation(candidate.output, {
                        status: 'not_observed',
                        reviewed: false,
                        observer: 'visual_expert',
                        strategy: 'visual-expert',
                        toolName: candidate.toolName,
                        ...candidate.observationSource,
                        reason: 'visual_expert_failed'
                    });
                }
                this.messages.push(createRuntimeObservationMessage(
                    `（视觉专家模型核对本批 ${batchCandidates.length} 张画面失败，这些观察记录均保持未复核。）`,
                    'tool-image-visual-expert-failed',
                    { scope: 'tool-visual:expert-batch', origin: 'visual_observation' }
                ));
                this.emitStep({
                    kind: 'warning',
                    title: '视觉专家批复核失败',
                    detail: `视觉模型 ${expertModelId} 调用失败：${error?.message || '未知错误'}。`,
                    status: 'error',
                    iteration: this.iteration + 1,
                    maxIterations: this.config.maxIterations,
                    issue: 'visual_observation_expert_failed'
                });
            }
        }
    }

    private buildUserMessage(task: string, images?: ImageAttachment[], observationSection = ''): AgentMessage {
        const content = [task, observationSection].filter(Boolean).join('\n\n');
        const orderedParts = normalizeChatComposerContentParts(
            this.config.initialUserContentParts || []
        );
        if (orderedParts.length === 0 && !images?.length) {
            return createCurrentUserMessage({ content });
        }
        if (orderedParts.length > 0) {
            const blocks: ContentBlock[] = [];
            const imagesById = new Map(
                (images || [])
                    .filter((image) => Boolean(image.id))
                    .map((image) => [String(image.id), image])
            );
            const usedImages = new Set<ImageAttachment>();
            let referenceIndex = 0;

            function pushText(text: string): void {
                if (!text) return;
                const last = blocks[blocks.length - 1];
                if (last?.type === 'text') {
                    last.text = `${last.text || ''}${text}`;
                    return;
                }
                blocks.push({ type: 'text', text });
            }

            for (const part of orderedParts) {
                if (part.type === 'text') {
                    pushText(part.text);
                    continue;
                }
                referenceIndex += 1;
                const marker = buildChatComposerReferenceMarker(part.reference, referenceIndex);
                if (part.reference.source.kind !== 'uploaded_image') {
                    pushText(marker);
                    continue;
                }
                const image = imagesById.get(part.reference.source.imageId);
                pushText(marker);
                if (!image) {
                    pushText('【图片未附带在本轮初始主模型消息中】');
                    continue;
                }
                blocks.push({
                    type: 'image',
                    data: image.data,
                    mediaType: image.mediaType
                });
                usedImages.add(image);
            }
            for (const image of images || []) {
                if (usedImages.has(image)) continue;
                referenceIndex += 1;
                pushText(`【引用${referenceIndex}：${image.name || '未命名图片'}；来源=图片附件】`);
                blocks.push({
                    type: 'image',
                    data: image.data,
                    mediaType: image.mediaType
                });
            }
            if (!orderedParts.some((part) => part.type === 'text' && part.text.trim())) {
                pushText('请结合这些图片处理我的当前请求。');
            }
            if (observationSection) {
                pushText(`\n\n${observationSection}`);
            }
            return createCurrentUserMessage({ content, contentBlocks: blocks });
        }
        const blocks: ContentBlock[] = [
            { type: 'text', text: content },
            ...(images || []).map(img => ({
                type: 'image' as const,
                data: img.data,
                mediaType: img.mediaType
            }))
        ];
        return createCurrentUserMessage({ content, contentBlocks: blocks });
    }

    private addFinalizationNudgeIfNeeded(): void {
        const remainingIterations = this.config.maxIterations - this.iteration;
        if (this.finalizationNudgeSent
            || !this.hasTaskProgressToolCalls()
            || Boolean(this.pendingRuntimeActionMutationReadback)
            || remainingIterations > FINALIZATION_NUDGE_REMAINING_ITERATIONS) {
            return;
        }

        this.finalizationNudgeSent = true;
        this.emitStep({
            kind: 'warning',
            title: '本轮处理时间接近上限',
            detail: '正在收尾，已完成的部分会保留，未完成的部分需要后续补充。',
            status: 'error',
            iteration: this.iteration + 1,
            maxIterations: this.config.maxIterations,
            issue: 'tool_budget_near_limit'
        });
        this.messages.push(createHarnessControlMessage([
                '这次制作时间接近上限，不要再扩展观察或重复操作。',
                '只在下一步能直接完成设计或查看最终效果时继续；否则就基于真实进度说明已经做出的版本和还没完成的部分。'
            ].join('\n'), 'iteration-budget-near-limit', 'finalization-control'));
    }

    private shouldForceFinalResponse(): boolean {
        const remainingIterations = this.config.maxIterations - this.iteration;
        if (this.pendingRuntimeActionMutationReadback) {
            return false;
        }
        return this.finalizationNudgeSent
            && this.hasTaskProgressToolCalls()
            && remainingIterations <= 1;
    }

    private async buildProviderOutputFailureResult(
        iterations: number,
        kind: 'truncated' | 'blocked',
        input: {
            phase: 'agent_turn' | 'forced_final_summary';
            recoveryAttempts: number;
            recoveryAttemptsInRun?: number;
        } = { phase: 'agent_turn', recoveryAttempts: 0 }
    ): Promise<AgentRunResult> {
        const hasPhotoshopMutation = this.hasObservedTaskMutation();
        const presentation = buildProviderOutputFailurePresentation({
            kind,
            ...input,
            recoveryAttemptsInRun: input.recoveryAttemptsInRun
                ?? this.providerOutputRecovery.recoveryAttemptsInRun,
            taskProgressPreserved: this.hasTaskProgressToolCalls(),
            hasPhotoshopMutation
        });
        this.emitStep({
            kind: 'stopped',
            title: presentation.title,
            detail: presentation.message,
            status: 'error',
            iteration: iterations,
            maxIterations: this.config.maxIterations,
            issue: presentation.issue,
            audience: 'user',
            visibility: 'user_process'
        });
        this.config.callbacks.onProgress?.(presentation.progress, 100);
        return this.buildRunResult({
            success: false,
            message: presentation.message,
            iterations,
            error: presentation.issue,
            stopReason: presentation.stopReason,
            data: presentation.data
        });
    }

    private async requestForcedFinalResponse(iterations = this.iteration + 1): Promise<AgentRunResult> {
        this.emitStep({
            kind: 'finalizing',
            title: '先做到这里',
            detail: '正在基于已有处理结果说明完成情况和待复核内容。',
            status: 'running',
            iteration: iterations,
            maxIterations: this.config.maxIterations,
            percent: 98
        });
        this.config.callbacks.onProgress?.('正在整理这稿', 98);
        this.messages.push(createHarnessControlMessage([
                '这次已经不能继续操作工具。',
                '请用简洁中文说明现在实际做出了什么；没有可看的版本就直接说明，没有完成的部分也不要说成已经完成。'
            ].join('\n'), 'tool-budget-exhausted', 'finalization-control'));

        let response: Awaited<ReturnType<CallModelFn>>;
        let terminalContent: ReturnType<typeof readCompleteProviderTextContent>;
        const forcedFinalMessages = prepareAgentMessagesForModel(this.messages);
        try {
            response = await this.modelCallAccounting.callAgentProvider(
                this.config.modelId,
                forcedFinalMessages,
                [],
                {
                    maxTokens: Math.min(2048, this.resolvePrimaryTurnProviderMaxTokens()),
                    temperature: 0.2,
                    timeoutMs: AGENT_FINAL_SUMMARY_TIMEOUT_MS,
                    thinkingEnabled: this.resolveProviderThinkingEnabled()
                },
                {
                    callKind: 'forced_final_response',
                    requestMode: 'non_stream',
                    agentIteration: this.iteration + 1,
                    visualInput: projectCurrentVisualInputForAccounting(
                        forcedFinalMessages,
                        this.pendingPrimaryVisualObservations
                    ),
                    visualAnalysis: this.initialImagesPendingPrimaryObservation
                        || this.pendingPrimaryVisualObservations.length > 0
                }
            );
            terminalContent = readCompleteProviderTextContent(response);
            const visualReview = terminalContent.complete
                ? reconcilePrimaryVisualObservationReviews({
                    observations: this.pendingPrimaryVisualObservations,
                    modelTurn: this.iteration,
                    response
                })
                : undefined;
            if (visualReview) response.content = visualReview.content;
            const primaryVisualInputConsumed = visualReview?.consumedVisualInput === true;
            this.pendingPrimaryVisualObservations = [];
            if (this.initialImagesPendingPrimaryObservation) {
                this.attachedImageObservationAvailable = primaryVisualInputConsumed;
                if (primaryVisualInputConsumed) {
                    this.observedInputImageCount = Math.max(
                        this.observedInputImageCount,
                        Math.min(this.currentInputImageCount, this.getPerformanceInitialVisionCandidateLimit())
                    );
                }
            }
            this.initialImagesPendingPrimaryObservation = false;
        } catch (error) {
            this.initialImagesPendingPrimaryObservation = false;
            this.pendingPrimaryVisualObservations = [];
            return this.buildForcedFinalResponseFallbackResult(iterations, error);
        } finally {
            retireDeliveredAgentMessageImages(this.messages);
        }
        if (!terminalContent.complete) {
            if (isProviderOutputBlocked(response.stopReason)) {
                return this.buildForcedFinalResponseFallbackResult(
                    iterations,
                    new Error('agent_final_summary_provider_blocked')
                );
            }
            return this.buildForcedFinalResponseFallbackResult(
                iterations,
                new Error('agent_final_summary_provider_truncated')
            );
        }

        const modelThinking = normalizeThinkingForUi(response.thinking);
        if (modelThinking) {
            this.emitVisibleReasoning(modelThinking, { source: 'provider_final_thinking' });
        }

        let finalMessage = sanitizeUserVisibleAgentText(terminalContent.content).trim();
        if (!finalMessage) {
            finalMessage = buildObservedDesignDraftSummary(this.toolCallLog)
                || this.buildSummaryFromStatefulWrites()
                || this.buildToolResultFallbackMessage();
        }
        if (!finalMessage) {
            this.emitStep({
                kind: 'stopped',
                title: '模型没有给出最终可展示结果',
                status: 'error',
                iteration: iterations,
                maxIterations: this.config.maxIterations,
                issue: 'empty_final_response'
            });
            return this.buildEmptyFinalResponseResult(iterations);
        }

        this.messages.push({
            role: 'assistant',
            content: finalMessage
        });

        return this.buildRunResult({
            success: false,
            message: finalMessage,
            iterations,
            stopReason: 'tool_budget_final_response'
        });
    }

    private async buildForcedFinalResponseFallbackResult(iterations: number, error: unknown): Promise<AgentRunResult> {
        const detail = sanitizeUserVisibleDiagnosticText(error instanceof Error ? error.message : String(error || ''));
        this.emitStep({
            kind: 'warning',
            title: '最终说明生成异常',
            detail: detail || '模型未能生成最终说明，已改用结构化结果摘要。',
            status: 'error',
            iteration: iterations,
            maxIterations: this.config.maxIterations,
            issue: 'agent_final_summary_timeout_or_error',
            source: 'agent_runtime',
            audience: 'debug'
        });

        const finalMessage = this.buildToolResultFallbackMessage()
            || this.buildSummaryFromStatefulWrites()
            || '已保留本轮真实处理记录。';

        return this.buildRunResult({
            success: false,
            message: finalMessage,
            iterations,
            stopReason: 'tool_budget_final_response',
            error: detail ? `agent_final_summary_timeout_or_error: ${detail}` : 'agent_final_summary_timeout_or_error',
            data: {
                finalSummaryFallback: true,
                finalSummaryError: detail || 'unknown'
            }
        });
    }

    private emitVisibleReasoning(value: unknown, meta: AgentThinkingEventMeta): void {
        const rawText = normalizeThinkingForUi(value);
        // 从回复正文里切出来的自我分析不再过 sanitizeUserVisibleThinkingText：那套判据（"用户让我/我需要确保"
        // 等）正是为识别这类叙述而写的，一过就会被整段判空——而这条路径的目的是把它挪到过程区，不是删掉它。
        // 它进来前已经过正文清洗（内部泄漏/路由载荷/罐头菜单照常拦），所以这里只做空值保护。
        const text = this.resolveVisibleReasoningTextForSource(rawText, meta.source);
        if (!text) return;
        const channelPolicy = classifyAgentObservationChannel({
            source: meta.source,
            content: text
        });
        if (!canObservationEnterThinkingSteps(channelPolicy)) return;
        this.visibleReasoningSent = true;
        this.latestVisiblePreActionRationale = text;
        this.config.callbacks.onThinking?.(text, meta);
    }

    private resolveVisibleReasoningTextForSource(
        rawText: string,
        source: AgentThinkingEventMeta['source']
    ): string {
        switch (source) {
            case 'provider_thinking_delta':
            // 流式增量必须按句子边界收口：半句话（"这款袜子要做主"）过整段清洗器会被
            // 十道判空关卡里的多条命中而丢弃，结果就是流式什么都推不出来。
            case 'model_visible_reasoning_delta':
                return finalizeUserVisibleThinkingText(rawText, { requireSentenceBoundary: true });
            case 'model_reply_reasoning_prefix':
                return String(rawText || '').trim();
            default:
                return sanitizeUserVisibleThinkingText(rawText);
        }
    }

    /**
     * Harness 控制面与自动开工观察都保留在统一账本，但不能伪装成模型主动选择的业务动作。
     * 开工观察仍由完成契约和 observation 计数直接消费。
     */
    private isTaskCreditBearingToolCall(entry: AgentToolCallLogEntry): boolean {
        return !readRuntimeActionProviderHandoff(entry.result)
            && !isAgentReadResultCacheHit(entry.result)
            && entry.failureDisposition !== 'control_turn_deferred';
    }

    private hasTaskProgressToolCalls(): boolean {
        return this.toolCallLog.some((entry) => (
            !isAgentHarnessControlTool(entry.name)
            && entry.origin !== 'harness_opening_observation'
            && entry.origin !== 'harness_quality_verification'
            && this.isTaskCreditBearingToolCall(entry)
        ));
    }

    /** 质量收尾读取只证明 Host 版本闭合，不能替业务任务完成读回。 */
    private getTaskCompletionToolCallLog(): AgentToolCallLogEntry[] {
        return this.toolCallLog.filter((entry) => (
            entry.origin !== 'harness_quality_verification'
            && this.isTaskCreditBearingToolCall(entry)
        ));
    }

    private hasSuccessfulOpeningObservation(): boolean {
        return this.toolCallLog.some((entry) => (
            entry.origin === 'harness_opening_observation'
            && entry.name === 'getAnnotatedSnapshot'
            && entry.result?.success !== false
        ));
    }

    /**
     * R1 期间的只读工具结果可在 Brief ready 后承接给 R2。
     * R1 执行点不允许状态变更，所以同一 Session 内的该观察不会被写入使其过期。
     */
    private findLatestSuccessfulRuntimeR2Observation(): AgentToolCallLogEntry | undefined {
        return [...this.toolCallLog].reverse().find((entry) => {
            if (entry.origin === 'harness_quality_verification'
                || isAgentHarnessControlTool(entry.name)
                || entry.result?.success === false
                || isAgentReadResultCacheHit(entry.result)) {
                return false;
            }
            if (classifyAgentToolExecution(entry.name, entry.arguments) !== 'read_only_observation') {
                return false;
            }
            if (!isRuntimeReferenceVisualTool(entry.name)) return true;
            return Boolean(normalizeRuntimeReferenceContextObservation(
                'runtime-r2-carry-forward-observation',
                entry.result?.observation
            ));
        });
    }

    private hasAttemptedTaskDeliveryAction(): boolean {
        // 计划可能来自自然语言早期投影，不能完整预知模型随后选择的动作。
        // 一旦模型真实尝试过交付类工具，本轮就已经形成“要产生交付”的运行时事实；
        // 此时全部写入失败不能被若干成功读取冲掉，更不能以 completed 收尾。
        return this.toolCallLog.some((entry) => {
            if (isAgentHarnessControlTool(entry.name)
                || entry.origin === 'harness_opening_observation'
                || entry.origin === 'harness_quality_verification'
                || !this.isTaskCreditBearingToolCall(entry)) {
                return false;
            }
            const kind = classifyAgentToolExecution(entry.name, entry.arguments);
            return kind === 'photoshop_write'
                || kind === 'save_export'
                || kind === 'external_generation';
        });
    }

    private hasSuccessfulTaskDeliveryAction(): boolean {
        return this.toolCallLog.some((entry) => {
            if (isAgentHarnessControlTool(entry.name)
                || entry.origin === 'harness_opening_observation'
                || entry.origin === 'harness_quality_verification'
                || entry.result?.success === false
                || !this.isTaskCreditBearingToolCall(entry)) {
                return false;
            }
            const kind = classifyAgentToolExecution(entry.name, entry.arguments);
            return kind === 'photoshop_write'
                || kind === 'save_export'
                || kind === 'external_generation';
        });
    }

    private resolveTaskPlanObligationGap(): 'task_progress_missing' | 'delivery_action_missing' | undefined {
        const plan = this.config.agentTaskPlan;
        const taskProgressObligation = resolveAgentTaskProgressObligation(plan);
        const runtimeBriefRequiresDelivery = this.runtimeDesignBriefDeclaration?.readiness === 'ready'
            && this.resolveRuntimeDesignBriefEffectiveContract()
                ?.productionObligation === 'photoshop_mutation_with_readback';
        const hasAttemptedDeliveryAction = this.hasAttemptedTaskDeliveryAction();
        if (!requiresAgentTaskProgress(plan)
            && !runtimeBriefRequiresDelivery
            && !hasAttemptedDeliveryAction) {
            return undefined;
        }
        const openingObservationSatisfiesReadOnlyPlan = (plan?.executionPlan.mode === 'read_only'
            || taskProgressObligation === 'observation')
            && this.hasSuccessfulOpeningObservation();
        const successfulTaskCalls = this.toolCallLog.filter((entry) => (
            !isAgentHarnessControlTool(entry.name)
            && entry.origin !== 'harness_opening_observation'
            && entry.origin !== 'harness_quality_verification'
            && entry.result?.success !== false
            && this.isTaskCreditBearingToolCall(entry)
        ));
        if (successfulTaskCalls.length === 0 && !openingObservationSatisfiesReadOnlyPlan) {
            return 'task_progress_missing';
        }

        const requiresDeliveryAction = runtimeBriefRequiresDelivery
            || hasAttemptedDeliveryAction
            || plan?.executionPlan.mode === 'controlled_skill'
            || (taskProgressObligation !== 'observation'
                && plan?.executionPlan.mode === 'tool_execution'
                && plan?.allowedToolScope === 'write_photoshop');
        if (!requiresDeliveryAction) return undefined;
        const hasSuccessfulDeliveryAction = this.hasSuccessfulTaskDeliveryAction();
        return hasSuccessfulDeliveryAction ? undefined : 'delivery_action_missing';
    }

    private buildRuntimeStageInputProgressProjection(): string[] {
        if (this.runtimeSession?.stageState.currentStage !== 'R1') return [];
        const requiredInputKeys = this.resolveRuntimeDesignBriefEffectiveContract()?.requiredInputs || [];
        const resolvedInputs = this.buildDesignBriefResolvedInputs();
        const sourceKindsByInputKey = new Map<string, Set<string>>();
        resolvedInputs.forEach((input) => {
            const sourceKinds = sourceKindsByInputKey.get(input.inputKey) || new Set<string>();
            sourceKinds.add(input.sourceKind);
            sourceKindsByInputKey.set(input.inputKey, sourceKinds);
        });
        return requiredInputKeys
            .slice()
            .sort()
            .map((inputKey) => {
                const sourceKinds = Array.from(sourceKindsByInputKey.get(inputKey) || []).sort();
                return `input=${inputKey}:${sourceKinds.join(',') || 'unresolved'}`;
            });
    }

    private readRuntimeStageProgressKey(): string {
        if (!this.runtimeSession) return '';
        const state = this.runtimeSession.stageState;
        const taskRun = this.runtimeSession.taskRun;
        const documentBinding = taskRun.documentBinding;
        const currentStageState = state.stages.find((stage) => stage.stage === state.currentStage);
        const novelFactCount = state.currentStage
            ? this.runtimeStageNovelFactFingerprints.get(state.currentStage)?.size || 0
            : 0;
        return buildAgentRuntimeProgressKey({
            currentStage: state.currentStage,
            taskRunStatus: taskRun.status,
            planRevision: taskRun.planRevision,
            currentNodeId: taskRun.currentNodeId,
            ...(documentBinding ? {
                documentBinding: {
                    documentId: documentBinding.documentId,
                    expectedHistoryStateId: documentBinding.expectedRevision.historyStateId,
                    status: documentBinding.status,
                    ...(documentBinding.conflict?.observedRevision ? {
                        observedDocumentId: documentBinding.conflict.observedRevision.documentId,
                        observedHistoryStateId:
                            documentBinding.conflict.observedRevision.historyStateId
                    } : {})
                }
            } : {}),
            operationResultCount: taskRun.operationResults.length,
            novelFactCount,
            maxNovelFactProgressCredits: MAX_RUNTIME_STAGE_NOVEL_FACT_PROGRESS_CREDITS,
            inputProgressProjection: this.buildRuntimeStageInputProgressProjection(),
            observedOutcomes: currentStageState?.observedOutcomes || []
        });
    }

    private resolveUnfinishedExecutionObligation():
        | 'task_progress_missing'
        | 'delivery_action_missing'
        | 'runtime_stage_incomplete'
        | undefined {
        const taskPlanGap = this.resolveTaskPlanObligationGap();
        if (taskPlanGap) return taskPlanGap;
        const state = this.runtimeSession?.stageState;
        if (!state || this.runtimeSession?.finalized) return undefined;
        if (state.status !== 'active' && state.status !== 'awaiting_outcomes') return undefined;
        // R5 的无 Tool 回复是质量收尾入口；此前阶段的文字只能是中间响应。
        if (!state.currentStage || state.currentStage === 'R5') return undefined;
        return 'runtime_stage_incomplete';
    }

    private hasUnfinishedExecutionObligation(): boolean {
        return Boolean(this.resolveUnfinishedExecutionObligation());
    }

    /**
     * 本轮是否卡在「只有用户能给的信息」上。
     *
     * 判据只认已有的结构化声明（brief / strategy / action plan 的 readiness === 'needs_input'
     * 且缺口 severity === 'blocking'），不做任何关键词或文本猜测。
     *
     * 背景（真机）：用户说「帮我做SKU，我目前没有模板有色卡」，模型读文档、读结构、截图后
     * 准确判断出「需要向用户确认色卡与组合」——但自主 Agent 结构上没有「问用户」的动作
     * （createInteractiveCard 的能力被 denylist 排除），同时零业务动作又会被判「未完成、请重试」，
     * 于是它用 10 多个关键词反复搜项目资源，43 步空转 35 秒。
     *
     * 这里只解一件事：**允许它体面地停下来把问题说清楚**，而不是被推着继续空转。
     * 用户回答后由正常对话进入下一轮，不需要任何新的续跑机制。
     */
    private resolveBlockingUserInputQuestion(): {
        blockingFields: string[];
        reason: 'user_owned' | 'environment_exhausted';
    } | undefined {
        const stageNeedsInput = this.resolveRuntimeStageNeedsInputRecovery();
        if ((stageNeedsInput.stage === 'R1' || stageNeedsInput.stage === 'R3')
            && stageNeedsInput.needsInput
            && stageNeedsInput.blockingFields.length > 0) {
            if (stageNeedsInput.observableToolKinds.length > 0) return undefined;
            return {
                blockingFields: stageNeedsInput.blockingFields,
                reason: stageNeedsInput.observationExhausted
                    ? 'environment_exhausted'
                    : 'user_owned'
            };
        }
        const declarations = [
            this.runtimeDesignBriefDeclaration,
            this.runtimeDesignStrategyDeclaration,
            this.runtimeActionPlanDeclaration
        ];
        const blockingFields: string[] = [];
        let needsInput = false;
        for (const declaration of declarations) {
            if ((declaration as any)?.readiness !== 'needs_input') continue;
            needsInput = true;
            const missing = ((declaration as any)?.payload?.missingInputs || []) as any[];
            for (const item of missing) {
                if (item?.severity !== 'blocking') continue;
                const field = String(item?.field || item?.inputId || '').trim();
                if (field) blockingFields.push(field);
            }
        }
        if (!needsInput || blockingFields.length === 0) return undefined;
        return {
            blockingFields: Array.from(new Set(blockingFields)).slice(0, 5),
            reason: 'user_owned'
        };
    }

    private selectRuntimeStageProgressToolNames(tools: ToolSchema[]): string[] {
        const stage = this.runtimeSession?.stageState.currentStage;
        if (!stage) return [];
        switch (stage) {
            case 'R1':
                return tools.filter((tool) => isDesignBriefControlTool(tool.name)).map((tool) => tool.name);
            case 'R2': {
                const referenceBriefToolNames = tools
                    .filter((tool) => isReferenceBriefControlTool(tool.name))
                    .map((tool) => tool.name);
                if (referenceBriefToolNames.length > 0) return referenceBriefToolNames;

                // 并非每个 Skill 都要求 Reference Brief。若 R1 前也没有可承接的读回，
                // R2 必须收敛到一次真实观察，而不是返回空动作后重复“继续”。
                // iterationTools 已按当前阶段和 Capability 过滤；保留首个提供者可避免
                // 恢复轮再次扩散读取，同时不把任何品类逻辑写进通用 Agent。
                const observationTool = tools.find((tool) => (
                    classifyAgentToolExecution(tool.name) === 'read_only_observation'
                ));
                return observationTool ? [observationTool.name] : [];
            }
            case 'R3':
                return tools.filter((tool) => isDesignStrategyControlTool(tool.name)).map((tool) => tool.name);
            case 'R4':
                return tools.filter((tool) => isRuntimeActionPlanControlTool(tool.name)).map((tool) => tool.name);
            case 'E1':
                return this.selectRuntimeE1ProgressToolNames(tools);
            default:
                return [];
        }
    }

    /**
     * E1 的恢复目标来自当前 Manifest / Capability bridge，而不是任务关键词：
     * - 已有真实动作时，只保留一个后续读回 provider；
     * - 尚未动作时，优先 R4 当前待执行步骤声明的 Capability provider；
     * - 已失败的 provider 不在旧计划下偷换为无归属原子动作，而是由失败策略返回 R4；
     * - 只有计划显式选择 workflow Skill 时才回到 workflow owner；
     * - 仅无 R4 的精简 Runtime 才直接回退到 Manifest 声明的原子写入 provider。
     */
    private selectRuntimeE1ProgressToolNames(tools: ToolSchema[]): string[] {
        if (this.pendingRuntimeActionMutationReadback) {
            if (this.pendingRuntimeActionMutationReadback.genericReadbackExhausted) return [];
            const visibleToolNames = new Set(tools.map((tool) => tool.name));
            return this.selectRuntimeActionMutationReadbackToolNames()
                .filter((toolName) => visibleToolNames.has(toolName));
        }
        if (this.runtimeActionMutationWriteLocked) return [];
        if (this.runtimeActionProviderRecoveryBlocked) return [];
        const bridge = this.config.toolCapabilityBridge;
        const visibleToolNames = new Set(tools.map((tool) => tool.name));
        const e1State = this.runtimeSession?.stageState.stages.find((item) => item.stage === 'E1');
        const hasActionResult = e1State?.observedOutcomes.includes('tool_action_result') === true;
        const hasReadback = e1State?.observedOutcomes.includes('tool_observation_recorded') === true;

        const reconciliation = this.reconcileRuntimeActionPlanExecution();
        const plannedSteps = this.runtimeActionPlanDeclaration?.payload.steps || [];
        const stepById = new Map(plannedSteps.map((step) => [step.stepId, step]));
        const resumeStepIds = reconciliation?.resumeStepIds || [];
        for (const stepId of resumeStepIds) {
            const step = stepById.get(stepId);
            if (!step) continue;
            const plannedCapabilityRefs = new Set(step.capabilityRefs);
            const matchingProviders = tools.filter((tool) => {
                if (isAgentHarnessControlTool(tool.name) || isAgentInputCollectionTool(tool.name)) {
                    return false;
                }
                if ((this.consecutiveToolFailuresByName.get(tool.name) || 0) > 0) {
                    return false;
                }
                if (!isRuntimeActionPlanStepOperationCompatible(
                    step.kind,
                    classifyAgentToolExecution(tool.name)
                )) {
                    return false;
                }
                return this.resolveRuntimeCapabilityRefsForTool(tool.name)
                    .some((capabilityId) => plannedCapabilityRefs.has(capabilityId));
            });
            if (matchingProviders.length > 0) {
                return matchingProviders.map((tool) => tool.name);
            }
        }

        const plannedCapabilityRefs = new Set(
            resumeStepIds.flatMap((stepId) => stepById.get(stepId)?.capabilityRefs || [])
        );
        const resumableSteps = resumeStepIds
            .map((stepId) => stepById.get(stepId))
            .filter((step): step is NonNullable<typeof step> => !!step);
        const workflowEntries = (bridge?.workflowEntryTools || [])
            .filter((toolName) => (
                visibleToolNames.has(toolName)
                && (this.consecutiveToolFailuresByName.get(toolName) || 0) === 0
                && plannedCapabilityRefs.has(`skill.${toolName}`)
                && resumableSteps.some((step) => (
                    step.capabilityRefs.includes(`skill.${toolName}`)
                    && isRuntimeActionPlanStepOperationCompatible(
                        step.kind,
                        classifyAgentToolExecution(toolName)
                    )
                ))
            ));
        if (workflowEntries.length > 0) {
            return workflowEntries;
        }
        if (hasActionResult && !hasReadback) {
            const pendingReadbackSteps = resumableSteps.filter((step) => (
                step.kind === 'observe' || step.kind === 'verify'
            ));
            if (pendingReadbackSteps.length > 0) {
                // 当前计划明确声明了后续观察节点，但它的 provider 尚未可用。
                // 不得退化为任意读取并制造无法归属的“已复核”记录。
                return [];
            }
            const bridgedToolNames = new Set(bridge?.executableTools || []);
            const bridgedReadbacks = tools.filter((tool) => (
                bridgedToolNames.has(tool.name)
                && isAgentPhotoshopDocumentObservation(tool.name, {})
            ));
            const readback = bridgedReadbacks[0] || tools.find((tool) => (
                isAgentPhotoshopDocumentObservation(tool.name, {})
            ));
            return readback ? [readback.name] : [];
        }
        const hasActionPlanStage = Boolean(
            this.config.runtimeStagePlan?.steps.some((step) => step.stage === 'R4')
        );
        if (hasActionPlanStage && this.runtimeActionPlanDeclaration) {
            return [];
        }

        const bridgedToolNames = new Set(bridge?.executableTools || []);
        const isExecutionAction = (tool: ToolSchema): boolean => {
            if (isAgentHarnessControlTool(tool.name) || isAgentInputCollectionTool(tool.name)) {
                return false;
            }
            const kind = classifyAgentToolExecution(tool.name);
            return kind === 'photoshop_write';
        };
        const compactWorkflowEntries = (bridge?.workflowEntryTools || [])
            .filter((toolName) => {
                const tool = tools.find((candidate) => candidate.name === toolName);
                return Boolean(tool)
                    && (this.consecutiveToolFailuresByName.get(toolName) || 0) === 0
                    && isExecutionAction(tool as ToolSchema);
            });
        if (!hasActionPlanStage && compactWorkflowEntries.length > 0) {
            return compactWorkflowEntries;
        }
        const bridgedActions = tools.filter((tool) => (
            bridgedToolNames.has(tool.name)
            && (this.consecutiveToolFailuresByName.get(tool.name) || 0) === 0
            && isExecutionAction(tool)
        ));
        if (bridgedActions.length > 0) {
            return bridgedActions.map((tool) => tool.name);
        }
        return tools
            .filter((tool) => (
                (this.consecutiveToolFailuresByName.get(tool.name) || 0) === 0
                && isExecutionAction(tool)
            ))
            .map((tool) => tool.name);
    }

    private resolveCompactWorkflowOwnerFirst(): { ownerToolName: string; pending: boolean } | undefined {
        return resolveCompactWorkflowOwnerFirst({
            runtimeStages: this.config.runtimeStagePlan?.steps.map((step) => step.stage) || [],
            workflowEntryTools: this.config.toolCapabilityBridge?.workflowEntryTools || [],
            attemptedToolNames: this.toolCallLog.map((entry) => entry.name),
            hasActiveContinuation: Boolean(this.readActiveWorkflowContinuationScope())
        });
    }

    private applyUnfinishedTurnContinuation(input: {
        response: Awaited<ReturnType<CallModelFn>>;
        iterationTools: ToolSchema[];
        requireInitialToolCall: boolean;
    }): boolean {
        // 用户专属输入，或环境读取已经有界穷尽时，交给 awaiting_user_input 收尾。
        // 继续注入“必须推进”只会把提问回合重新推回声明/读取循环。
        if (this.resolveBlockingUserInputQuestion()) return false;
        const openingObservationSatisfiesReadOnlyPlan = this.config.agentTaskPlan?.executionPlan.mode === 'read_only'
            && this.hasSuccessfulOpeningObservation();
        const obligation = this.resolveUnfinishedExecutionObligation()
            || (input.requireInitialToolCall
                && !openingObservationSatisfiesReadOnlyPlan
                && !this.hasTaskProgressToolCalls()
                ? 'task_progress_missing'
                : undefined);
        if (!obligation || this.iteration >= this.config.maxIterations - 1) return false;

        const continuationKey = buildUnfinishedContinuationKey({
            obligation,
            runtimeProgressKey: this.readRuntimeStageProgressKey()
        });
        if (continuationKey !== this.unfinishedTurnContinuationKey) {
            this.unfinishedTurnContinuationKey = continuationKey;
            this.unfinishedTurnContinuationAttempts = 0;
        }
        if (this.unfinishedTurnContinuationAttempts >= MAX_UNFINISHED_TURN_CONTINUATION_ATTEMPTS) {
            return false;
        }
        this.unfinishedTurnContinuationAttempts += 1;

        const baseProgressToolNames = this.selectRuntimeStageProgressToolNames(input.iterationTools);
        const stageNeedsInput = this.resolveRuntimeStageNeedsInputRecovery();
        const inputCollectionToolNames = input.iterationTools
            .filter((tool) => isAgentInputCollectionTool(tool.name))
            .map((tool) => tool.name);
        let progressToolNames = baseProgressToolNames;
        if (stageNeedsInput.needsInput && stageNeedsInput.observableToolKinds.length > 0) {
            progressToolNames = this.expandRecoveryToolsForObservableInputs(
                baseProgressToolNames,
                input.iterationTools,
                stageNeedsInput.observableToolKinds,
                stageNeedsInput.photoshopObservationOnly
            );
        } else if (stageNeedsInput.needsInput && inputCollectionToolNames.length > 0) {
            progressToolNames = inputCollectionToolNames;
        }
        let continuationInstruction = [
            'The task is still incomplete according to the observed execution facts.',
            'Re-evaluate the full currently available capability set and choose the smallest action that advances the user goal.',
            'If a user decision is genuinely required, use the structured confirmation action.'
        ].join(' ');
        if (stageNeedsInput.needsInput && stageNeedsInput.observableToolKinds.length > 0) {
            continuationInstruction = [
                `The ${stageNeedsInput.stage} declaration still lacks observable inputs (${stageNeedsInput.blockingFields.join('；') || 'see the current declaration'}).`,
                'Gather only those inputs with the currently allowed observation providers, then re-declare the stage owner. Do not repeat unrelated project or reference searches.'
            ].join(' ');
        } else if (stageNeedsInput.needsInput) {
            continuationInstruction = [
                `The ${stageNeedsInput.stage} declaration lacks user-owned inputs (${stageNeedsInput.blockingFields.join('；') || 'see the current declaration'}).`,
                'Use the structured confirmation action for exactly those inputs; do not repeat the stage owner.'
            ].join(' ');
        }
        this.emitStep({
            kind: 'warning',
            title: '继续推进当前任务',
            detail: progressToolNames.length > 0
                ? '初步判断已保留；Agent 将根据完整已授权能力面重新选择推进动作。'
                : '初步判断已保留，任务仍会继续执行或进入明确的用户确认。',
            status: 'running',
            iteration: this.iteration + 1,
            maxIterations: this.config.maxIterations,
            issue: 'unfinished_turn_continuation_recovery',
            audience: 'agent'
        });
        this.messages.push(createAssistantHistoryMessage(input.response));
        this.messages.push(createHarnessControlMessage([
                '这项设计还没有完成，把上一段文字当作中间判断，不要当作最终结果。',
                continuationInstruction,
                '不要重新调查已经确认的内容；继续完成最小必要动作，并在修改后查看当前画面。'
            ].filter(Boolean).join('\n'), 'unfinished-turn-continuation', 'runtime-stage-recovery'));
        return true;
    }

    private resolveCurrentRuntimeStageCapabilityIds(): string[] {
        const stage = this.runtimeSession?.stageState.currentStage;
        const currentStep = this.config.runtimeStagePlan?.steps.find((step) => step.stage === stage);
        return Array.from(new Set([
            ...(currentStep?.allowedToolCapabilities || []),
            ...(this.config.getOnDemandActivatedCapabilityIds?.() || [])
        ]));
    }

    /**
     * 当当前声明仍缺环境来源时，从“已经激活”的 Capability 中有界公开替代 provider。
     *
     * 这里不根据任务措辞选择 Tool，也不会扩大 Capability 或写权限。常规阶段仍只公开
     * 每项 Capability 的首选 provider；只有真实 needs_input 缺口存在时才进入本路径。
     */
    private selectRuntimeInputObservationToolSchemas(
        recovery: Pick<
            RuntimeStageNeedsInputRecovery,
            'observationCapabilityIds' | 'observableToolKinds' | 'photoshopObservationOnly'
        >
    ): ToolSchema[] {
        if (recovery.observableToolKinds.length === 0
            || recovery.observationCapabilityIds.length === 0) {
            return [];
        }
        const stage = this.runtimeSession?.stageState.currentStage;
        if (!stage) return [];
        const executableTools = this.config.tools.filter((tool) => (
            !this.isRuntimeActionProviderUnavailable(tool.name)
            && this.isToolVisibleAtRuntimeStage(stage, tool)
        ));
        const providerNames = selectLegacyToolProvidersForCapabilities({
            capabilityIds: recovery.observationCapabilityIds,
            executableToolNames: executableTools.map((tool) => tool.name)
        });
        const allowedKinds = new Set(recovery.observableToolKinds);
        const executableToolByName = new Map(executableTools.map((tool) => [tool.name, tool]));
        const candidateTools = providerNames.flatMap((providerName) => {
            const tool = executableToolByName.get(providerName);
            if (!tool) return [];
            const kind = classifyAgentToolExecution(tool.name);
            if (!allowedKinds.has(kind as RuntimeInputObservationToolKind)) return [];
            if (recovery.photoshopObservationOnly
                && !isAgentPhotoshopDocumentObservation(tool.name, {})) {
                return [];
            }
            if ((this.consecutiveToolFailuresByName.get(tool.name) || 0)
                >= CONSECUTIVE_SAME_TOOL_FAILURE_LIMIT) {
                return [];
            }
            return [tool];
        });
        const candidateNameSet = new Set(candidateTools.map((tool) => tool.name));
        const attemptsByProvider = new Map<string, number>();
        this.toolCallLog.forEach((entry) => {
            if (!candidateNameSet.has(entry.name)) return;
            attemptsByProvider.set(entry.name, (attemptsByProvider.get(entry.name) || 0) + 1);
        });
        const totalObservationCalls = Array.from(attemptsByProvider.values())
            .reduce((total, count) => total + count, 0);
        const remainingCallBudget = MAX_RUNTIME_INPUT_OBSERVATION_CALLS - totalObservationCalls;
        if (remainingCallBudget <= 0) return [];

        const untried = candidateTools.filter((tool) => !attemptsByProvider.has(tool.name));
        const narrowerRetry = candidateTools.filter((tool) => {
            const attempts = attemptsByProvider.get(tool.name) || 0;
            return attempts > 0 && attempts < MAX_RUNTIME_INPUT_OBSERVATION_CALLS_PER_PROVIDER;
        });
        return Array.from(new Map(
            [...untried, ...narrowerRetry].map((tool) => [tool.name, tool])
        ).values()).slice(
            0,
            Math.min(MAX_RUNTIME_INPUT_OBSERVATION_PROVIDERS_PER_TURN, remainingCallBudget)
        );
    }

    private resolveRuntimeStageNeedsInputRecovery(): RuntimeStageNeedsInputRecovery {
        const stage = this.runtimeSession?.stageState.currentStage;
        if (stage === 'R1' && this.runtimeDesignBriefDeclaration?.readiness === 'needs_input') {
            const requiredInputKeys = this.resolveRuntimeDesignBriefEffectiveContract()?.requiredInputs || [];
            const resolvedInputKeys = new Set(
                this.buildDesignBriefResolvedInputs().map((input) => input.inputKey)
            );
            const blockingFields = requiredInputKeys
                .filter((inputKey) => !resolvedInputKeys.has(inputKey))
                .slice(0, 5);
            const explorationRequest = resolveRuntimeInputExplorationRequest({
                missingInputKeys: blockingFields,
                inputSources: this.config.runtimeStagePlan?.inputSources || {},
                activeCapabilityIds: this.resolveCurrentRuntimeStageCapabilityIds()
            });
            const provisionalRecovery: RuntimeStageNeedsInputRecovery = {
                needsInput: blockingFields.length > 0,
                stage,
                blockingFields,
                observableToolKinds: explorationRequest.toolKinds,
                observationCapabilityIds: explorationRequest.capabilityIds,
                photoshopObservationOnly: explorationRequest.photoshopObservationOnly,
                observationExhausted: false
            };
            const observationExhausted = explorationRequest.toolKinds.length > 0
                && this.selectRuntimeInputObservationToolSchemas(provisionalRecovery).length === 0;
            return {
                ...provisionalRecovery,
                observableToolKinds: observationExhausted ? [] : explorationRequest.toolKinds,
                observationExhausted
            };
        }
        if (stage === 'R3' && this.runtimeDesignStrategyDeclaration?.readiness === 'needs_input') {
            const blockingFields = (this.runtimeDesignStrategyDeclaration?.payload.missingInputs || [])
                .filter((item) => item?.severity === 'blocking')
                .map((item) => String(item?.field || item?.inputId || '').trim())
                .filter(Boolean)
                .slice(0, 4);
            // R3 契约已经把 blocking 定义为「只能由用户提供」。可自行观察/检索的输入必须在
            // declareDesignStrategy 之前取得，不能在这里被第二套恢复逻辑重新解释成继续搜索。
            // 否则模型把一项执行能力误报为素材缺口后，Harness 会替它无限扩张项目检索与参考检索，
            // 最终以 awaiting_user_input 或预算耗尽结束，却从未进入 E1。
            return {
                needsInput: blockingFields.length > 0,
                stage,
                blockingFields,
                observableToolKinds: [],
                observationCapabilityIds: [],
                photoshopObservationOnly: false,
                observationExhausted: false
            };
        }
        return {
            needsInput: false,
            blockingFields: [],
            observableToolKinds: [],
            observationCapabilityIds: [],
            photoshopObservationOnly: false,
            observationExhausted: false
        };
    }

    /**
     * 缺失输入可自行取得时，恢复范围不能只锁声明工具——放行只读观察与检索，
     * 否则模型只能反复重声明同一个缺口（实机 R3 死锁，no_progress 收尾）。
     */
    private expandRecoveryToolsForObservableInputs(
        progressToolNames: string[],
        iterationTools: ToolSchema[],
        observableToolKinds: ReadonlyArray<RuntimeInputObservationToolKind> = [
            'read_only_observation',
            'knowledge_search'
        ],
        photoshopObservationOnly = false
    ): string[] {
        const allowedKinds = new Set(observableToolKinds);
        const stageNeedsInput = this.resolveRuntimeStageNeedsInputRecovery();
        const observationTools = this.selectRuntimeInputObservationToolSchemas({
            observationCapabilityIds: stageNeedsInput.observationCapabilityIds,
            observableToolKinds: Array.from(allowedKinds),
            photoshopObservationOnly
        });
        return Array.from(new Set([
            ...progressToolNames,
            ...[...iterationTools, ...observationTools]
                .filter((tool) => {
                    const kind = classifyAgentToolExecution(tool.name);
                    if (photoshopObservationOnly) {
                        return kind === 'read_only_observation'
                            && isAgentPhotoshopDocumentObservation(tool.name, {});
                    }
                    return allowedKinds.has(kind as RuntimeInputObservationToolKind);
                })
                .map((tool) => tool.name)
        ]));
    }

    private applyRuntimeControlStageStallRecovery(input: {
        progressKeyAtIterationStart: string;
        iterationTools: ToolSchema[];
        toolCalls: ToolCall[];
        toolResults: ToolResult[];
    }): boolean {
        const runtimeStatus = this.runtimeSession?.stageState.status;
        if (runtimeStatus !== 'active' && runtimeStatus !== 'awaiting_outcomes') {
            this.runtimeControlStageStallCount = 0;
            return false;
        }
        const progressKeyNow = this.readRuntimeStageProgressKey();
        if (!progressKeyNow || progressKeyNow !== input.progressKeyAtIterationStart) {
            this.runtimeControlStageStallCount = 0;
            this.unfinishedTurnContinuationAttempts = 0;
            this.unfinishedTurnContinuationKey = '';
            return false;
        }
        const baseProgressToolNames = this.selectRuntimeStageProgressToolNames(input.iterationTools);
        if (baseProgressToolNames.length === 0) {
            this.runtimeControlStageStallCount = 0;
            return false;
        }
        const inputCollectionToolNames = input.iterationTools
            .filter((tool) => isAgentInputCollectionTool(tool.name))
            .map((tool) => tool.name);
        const ownerRequestedUserInputWithoutCard = input.toolCalls.some((call) => {
            if (!baseProgressToolNames.includes(call.name)) return false;
            const result = input.toolResults.find((item) => item.callId === call.id);
            return toolResultRequestsUserInputWithoutCard(result);
        });
        const stageNeedsInput = this.resolveRuntimeStageNeedsInputRecovery();
        const needsUserOwnedInputCard = stageNeedsInput.needsInput
            && stageNeedsInput.observableToolKinds.length === 0;
        if (needsUserOwnedInputCard && inputCollectionToolNames.length === 0) {
            this.runtimeControlStageStallCount = 0;
            const reason = stageNeedsInput.observationExhausted
                ? '已经用完合适的查看方式，仍无法确定唯一答案。'
                : '剩下的信息只能由用户提供。';
            this.messages.push(createHarnessControlMessage([
                reason,
                `只针对这些仍未确定的内容问一个简短问题：${stageNeedsInput.blockingFields.join('、') || '当前关键选择'}。`,
                '不要继续重复查看；这是等待用户选择，不是任务失败。'
            ].join('\n'), 'runtime-input-await-user', 'runtime-stage-recovery'));
            return true;
        }
        const needsMissingCardRepair = (ownerRequestedUserInputWithoutCard || needsUserOwnedInputCard)
            && inputCollectionToolNames.length > 0;
        this.runtimeControlStageStallCount += 1;
        if (!needsMissingCardRepair
            && this.runtimeControlStageStallCount < RUNTIME_CONTROL_STAGE_STALL_LIMIT) {
            return false;
        }
        this.runtimeControlStageStallCount = 0;
        let progressToolNames = baseProgressToolNames;
        if (needsMissingCardRepair) {
            progressToolNames = inputCollectionToolNames;
        } else if (stageNeedsInput.needsInput && stageNeedsInput.observableToolKinds.length > 0) {
            progressToolNames = this.expandRecoveryToolsForObservableInputs(
                baseProgressToolNames,
                input.iterationTools,
                stageNeedsInput.observableToolKinds,
                stageNeedsInput.photoshopObservationOnly
            );
        }
        let recoveryMessage = [
            '目前已有足够信息，但设计还没有往前推进。',
            progressToolNames.length > 0
                ? `当前阶段可用的推进能力包括：${progressToolNames.join('、')}。`
                : '请重新检查当前阶段事实与完整已授权能力面。',
            '由你根据用户目标选择最小有效动作；如果确实缺少只能由用户决定的信息，只询问那一个具体选择。'
        ].join('\n');
        if (needsMissingCardRepair) {
            recoveryMessage = [
                '当前需要用户选择，但还没有可提交的确认卡。',
                '只把已经指出的那个选择生成确认卡；不要重新运行前一步，也不要增加新的要求。'
            ].join('\n');
        } else if (stageNeedsInput.needsInput) {
            recoveryMessage = [
                `当前还缺少这些能从项目或画面中确认的信息：${stageNeedsInput.blockingFields.join('、') || '当前未确定内容'}。`,
                '只补齐这些信息后继续；只有确实无法从项目、画面或素材中得到的选择才询问用户。'
            ].join('\n');
        }
        this.messages.push(createHarnessControlMessage(
            recoveryMessage,
            'runtime-stage-stall',
            'runtime-stage-recovery'
        ));
        this.emitStep({
            kind: 'warning',
            title: needsMissingCardRepair ? '补全确认入口' : '收敛到当前阶段动作',
            detail: needsMissingCardRepair
                ? '当前流程需要你的选择，但没有生成可提交卡片；正在补全确认入口，不会重复执行同一步。'
                : '已有读取结果足够支撑下一步；Agent 将基于完整已授权能力面重新选择。',
            status: 'running',
            iteration: this.iteration + 1,
            maxIterations: this.config.maxIterations,
            issue: needsMissingCardRepair
                ? 'runtime_missing_confirmation_card_recovery'
                : 'runtime_stage_progress_recovery',
            audience: needsMissingCardRepair ? 'user' : 'agent',
            ...(needsMissingCardRepair ? { visibility: 'user_process' as const } : {})
        });
        return true;
    }

    private async applyLoopGuardLivenessRecovery(input: {
        message: string;
        toolCalls: ToolCall[];
        toolResults: ToolResult[];
    }): Promise<boolean> {
        if (hasRepeatedToolFailureExhausted(input.toolCalls, input.toolResults, this.consecutiveToolFailuresByName)) return false;
        const progressKey = this.readRuntimeStageProgressKey() || 'no-runtime-stage';
        const incidentClass = input.message.split('\n')[0].slice(0, 120);
        const recoveryKey = `loop_guard|${progressKey}|${incidentClass}`;
        const recoveryAttempts = this.livenessRecoveryAttemptsByProgressKey.get(recoveryKey) || 0;
        const hasNextIteration = this.iteration < this.config.maxIterations - 1;
        let alternativeCapabilityCount = 0;
        if (hasNextIteration) {
            const visibleTools = await this.buildModelVisibleToolsForIteration();
            const failedToolNames = new Set(
                input.toolCalls
                    .filter((call) => {
                        const result = input.toolResults.find((item) => item.callId === call.id);
                        return result?.success === false;
                    })
                    .map((call) => call.name)
            );
            alternativeCapabilityCount = visibleTools.filter((tool) => (
                !failedToolNames.has(tool.name)
                && (this.consecutiveToolFailuresByName.get(tool.name) || 0)
                    < CONSECUTIVE_SAME_TOOL_FAILURE_LIMIT
            )).length;
        }

        const livenessDecision = decideAgentRuntimeLiveness({
            incident: 'loop_guard',
            cancelled: this.config.signal?.aborted === true,
            userOwnedInputRequired: Boolean(this.resolveBlockingUserInputQuestion()),
            completionSatisfied: false,
            unfinishedObligation: this.hasUnfinishedExecutionObligation(),
            budgetExhausted: Boolean(this.readPerformanceBudgetExhaustion()),
            unknownMutationRequiresReadback: Boolean(this.pendingRuntimeActionMutationReadback),
            pendingRecoveryActionCount: this.pendingRuntimeActionMutationReadback ? 1 : 0,
            alternativeCapabilityCount,
            recoveryAttempts,
            maxRecoveryAttempts: MAX_LIVENESS_RECOVERY_ATTEMPTS_PER_PROGRESS_KEY
        });
        if (livenessDecision.kind !== 'continue') return false;

        this.livenessRecoveryAttemptsByProgressKey.set(recoveryKey, recoveryAttempts + 1);
        this.messages.push(createHarnessControlMessage([
            '刚才这一轮没有产生新的执行结果或新事实。',
            `当前仍有 ${alternativeCapabilityCount} 个已授权能力可用；请从完整能力面重新判断，不要原样重复上一批动作。`,
            'Harness 不指定下一工具；由你根据用户目标、当前事实和失败结果选择新的最小推进动作。'
        ].join('\n'), 'runtime-liveness-recovery', 'runtime-stage-recovery'));

        // 一旦 Liveness Owner 已明确给予下一轮恢复机会，本轮的局部熔断器只能清除
        // 自己的批次/轮次计数，不能再在同一轮终止 Agent。具体 Tool failure 计数保留，
        // 防止恢复重新放行已经连续失败的 provider。
        this.lastToolBatchSignature = '';
        this.repeatedToolBatchCount = 0;
        this.consecutiveFailedToolRounds = 0;
        this.emitStep({
            kind: 'warning',
            title: '重新判断处理路径',
            detail: '当前动作没有推进任务；Agent 将从完整已授权能力面重新选择，不会由 Harness 指定下一工具。',
            status: 'running',
            iteration: this.iteration + 1,
            maxIterations: this.config.maxIterations,
            issue: `runtime_liveness_${livenessDecision.reason}`,
            audience: 'user',
            visibility: 'user_process'
        });
        return true;
    }

    private filterIntentVisibleToolNames(toolNames: Iterable<string>): string[] {
        const configuredToolNames = new Set(this.config.tools.map((tool) => tool.name));
        return Array.from(new Set(Array.from(toolNames)
            .map((toolName) => String(toolName || '').trim())
            .filter(Boolean)))
            .filter((toolName) => (
                configuredToolNames.has(toolName)
                && isAgentToolVisibleForIntentDecision(
                    toolName,
                    this.runIntentControlPlaneDecision
                )
            ));
    }

    /**
     * 无参数、幂等只读 Tool 已有本轮新鲜结果时，不再让模型为同一事实多付一轮 Tool call。
     *
     * 结果仍由现有 ReadResultCache 持有；任一写入、导出或切档成功都会清空缓存，Tool 会在
     * 下一轮自动恢复可见。mutation unknown 的强制读回必须取得真实 Host 新鲜值，因此不隐藏。
     */
    private async consumeToolsForIteration(): Promise<ToolSchema[]> {
        const providerContinuationTools = this.providerOutputRecovery.consumePendingTools();
        let modelVisibleTools = providerContinuationTools
            ? providerContinuationTools.map((tool) => ({
                ...tool,
                inputSchema: tool.inputSchema
            }))
            : await this.buildModelVisibleToolsForIteration();
        // candidate_only 仍可回答、观察和声明 Harness 状态，但不应先把确定会被执行点拒绝的
        // 写入/外部生成工具展示给模型。执行点契约保留为纵深防御，防 provider 幻觉调用隐藏工具。
        modelVisibleTools = modelVisibleTools.filter((tool) => (
            isAgentToolVisibleForIntentDecision(tool.name, this.runIntentControlPlaneDecision)
        ));
        // 刻意不再按「本轮已有新鲜读取结果」把工具从清单里摘掉。
        // 防重复读取已由执行层完成：可缓存读取工具命中 readResultCache 时直接返回
        // buildCachedReadResult，根本不执行（见 executeToolCall 的缓存短路）。
        // 而工具清单是提示词的**第一段**（渲染顺序 tools → system → messages），
        // 逐轮增删工具会让前缀缓存从第 0 字节失效——各家 provider 的缓存都是前缀匹配。
        // 代价对比：重复调用一次已缓存读取 ≈ 一次内存查找；工具清单每轮变化 ≈ 整轮输入
        // 全部按未缓存计价，且 ReAct 每轮重发全部历史，成本随轮次呈平方级放大。
        return modelVisibleTools;
    }

    private applyInvalidHarnessControlRepairDirective(
        toolCalls: ToolCall[],
        toolResults: ToolResult[]
    ): boolean {
        for (const result of toolResults) {
            if (result.success) continue;
            const call = toolCalls.find((item) => item.id === result.callId);
            if (!call || !isAgentHarnessControlTool(call.name)) continue;
            const output = result.output && typeof result.output === 'object' ? result.output : {};
            const code = String(output.code || '').trim();
            if (code === 'runtime_design_intent_configuration_error') {
                const profileId = String(output.runtimeProfileId || '').trim();
                this.messages.push(createHarnessControlMessage([
                    '当前设计方法的内部配置不可用。',
                    '停止继续操作，不要改用更宽的权限或继续重复读取；只需自然说明这次无法继续制作。'
                ].join('\n'), 'runtime-profile-configuration-error', 'harness-control-repair:declareDesignIntent'));
                this.emitStep({
                    kind: 'warning',
                    title: '设计 Runtime 配置未发布',
                    detail: profileId || '当前 Profile 未通过发布校验',
                    status: 'error',
                    iteration: this.iteration + 1,
                    maxIterations: this.config.maxIterations,
                    toolName: call.name,
                    toolCallId: call.id,
                    issue: code
                });
                return true;
            }
            if (![
                'runtime_design_intent_declaration_invalid',
                'runtime_design_brief_declaration_invalid',
                'runtime_reference_brief_declaration_invalid',
                'design_strategy_declaration_invalid',
                'runtime_action_plan_declaration_invalid'
            ].includes(code)) continue;

            const issues: Array<{ code: string; path: string }> = Array.isArray(output.issues)
                ? output.issues.slice(0, 12).map((issue: any) => ({
                    code: String(issue?.code || 'invalid'),
                    path: String(issue?.path || '')
                }))
                : [];
            const designBriefSourceGap = isDesignBriefControlTool(call.name)
                && issues.some((issue) => (
                    issue.code === 'provided_input_source_missing'
                    || issue.code === 'context_ref_not_available'
                ));
            const referenceSourceGapCodes = new Set([
                'context_ref_not_available',
                'reference_visual_observation_required',
                'reference_observation_content_missing',
                'reference_ready_requires_visual_insight',
                'required_reference_cannot_be_waived',
                'reference_search_budget_not_exhausted',
                'reference_degraded_without_failed_reference_attempt'
            ]);
            const referenceSourceGap = isReferenceBriefControlTool(call.name)
                && issues.some((issue) => referenceSourceGapCodes.has(issue.code));
            const strategySourceGap = isDesignStrategyControlTool(call.name)
                && issues.some((issue) => issue.code === 'context_ref_not_available');
            const isObservableInputSourceGap = designBriefSourceGap
                || referenceSourceGap
                || strategySourceGap;
            const attempts = this.harnessControlRepairAttemptsByName.get(call.name) || 0;
            const maxRepairAttempts = call.name === 'declareDesignIntent'
                ? MAX_RUNTIME_DESIGN_INTENT_REPAIR_ATTEMPTS
                : MAX_HARNESS_CONTROL_REPAIR_ATTEMPTS;
            if (attempts >= maxRepairAttempts) {
                this.messages.push(createHarnessControlMessage([
                        '当前设计准备信息连续无法提交成功。',
                        '停止继续尝试，保留已经确认的内容，并自然说明这次无法继续制作。'
                    ].join('\n'), 'harness-control-repair-limit', `harness-control-repair:${call.name}`));
                return true;
            }
            this.harnessControlRepairAttemptsByName.set(call.name, attempts + 1);
            if (isObservableInputSourceGap) {
                const missingInputPaths = issues
                    .filter((issue) => (
                        issue.code === 'provided_input_source_missing'
                        || issue.code === 'context_ref_not_available'
                        || referenceSourceGapCodes.has(issue.code)
                    ))
                    .map((issue) => issue.path)
                    .filter(Boolean);
                this.messages.push(createHarnessControlMessage([
                        `还缺少这些可从项目或画面中确认的信息：${missingInputPaths.join('、') || '当前设计依据'}。`,
                        '先使用已经取得的上下文；确实没看过的内容只做一次必要观察，然后重新提交。不要原样重试。',
                        '只有无法从当前文档、项目素材或已有信息中得到的用户选择，才询问用户。'
                    ].join('\n'), 'harness-control-input-source-repair', `harness-control-repair:${call.name}`));
            } else {
                let schemaRepairInstruction: string;
                if (call.name === 'declareDesignIntent') {
                    const declarableTaskTypes = Array.isArray(output.declarableTaskTypes)
                        ? output.declarableTaskTypes.slice(0, 20)
                        : [];
                    const supportedWorkModes = Array.isArray(output.supportedWorkModes)
                        ? output.supportedWorkModes.slice(0, 10)
                        : [];
                    schemaRepairInstruction = [
                        `可声明 taskTypeId：${JSON.stringify(declarableTaskTypes)}`,
                        `当前 taskType 支持的 workMode：${JSON.stringify(supportedWorkModes)}`,
                        `修正形状：${JSON.stringify(output.correctedShape || {})}`,
                        '如果修正形状要求 omit，则完全删除 workMode 字段；不要把空字符串或 null 当作省略。'
                    ].join('\n');
                } else if (isDesignBriefControlTool(call.name)) {
                    schemaRepairInstruction = '严格填写当前工具 schema 的 required 字段；inputCoverage 只提交 inputKey、status 和可选的语义 note，不要写工具名、图层 ID、坐标或内部输入引用。';
                } else {
                    schemaRepairInstruction = '严格填写当前工具 schema 的所有 required 字段；嵌套 contextRefs 必须同时出现在顶层 contextRefs。';
                }
                this.messages.push(createHarnessControlMessage([
                        '当前设计准备信息的结构不完整。',
                        `工具结果已经给出 ${call.name} 的修正形状；请结合完整已授权能力面判断是修正声明、补充事实还是如实停止。`,
                        schemaRepairInstruction
                    ].join('\n'), 'harness-control-schema-repair', `harness-control-repair:${call.name}`));
            }
            this.emitStep({
                kind: 'warning',
                title: isObservableInputSourceGap ? '补齐阶段输入来源' : '修正阶段声明',
                detail: isObservableInputSourceGap
                    ? `先取得缺失的只读依据，再重新提交 ${call.name}`
                    : `第 ${attempts + 1}/${maxRepairAttempts} 次修正 ${call.name}`,
                status: 'running',
                iteration: this.iteration + 1,
                maxIterations: this.config.maxIterations,
                toolName: call.name,
                toolCallId: call.id,
                issue: code
            });
            return true;
        }
        return false;
    }

    private applyWorkflowContinuationScope(
        toolCalls: ToolCall[],
        toolResults: ToolResult[],
        iterationTools: ToolSchema[]
    ): boolean {
        // 开放式 agentic 任务只消费 Skill 的工作结果与实际问题，不接受 Skill 回传的
        // allowedToolNames 作为下一轮计划或权限。只有显式 staged Runtime 的版本化
        // continuation contract 才能约束规格化生产范围。
        if (!this.runtimeSession || !this.config.runtimeStagePlan) return false;
        const activeScope = this.readActiveWorkflowContinuationScope();
        const validatedRepairWrites = toolResults.flatMap((result) => {
            if (result.success !== true) return [];
            const mutationProof = findObservedPhotoshopMutationProof(result.output);
            if (!mutationProof?.toolActionCompleted) return [];
            return [{
                callId: result.callId,
                documentId: String(mutationProof.after.documentId),
                historyStateId: String(mutationProof.after.historyStateId)
            }];
        });
        const postRepairObservationScope = advanceAgentWorkflowContinuationAfterRepair({
            scope: activeScope,
            toolCalls,
            toolResults,
            validatedRepairWrites
        });
        if (activeScope && postRepairObservationScope !== activeScope) {
            this.workflowContinuationScope = postRepairObservationScope;
            this.messages.push(createHarnessControlMessage([
                '刚才的局部调整已经写入。不要重新运行整套方法，以免覆盖这次调整。',
                '下一步只重新查看刚才修改的目标；看清新画面之前不要继续修改、保存或导出。'
            ].join('\n'), 'workflow-post-repair-observation', 'runtime-stage-recovery'));
            this.emitStep({
                kind: 'observation',
                title: '修复完成，重新验收',
                detail: '目标内原子修复已经写入；接下来只重新读取同一目标的新画面，不会重跑生产工作流。',
                status: 'running',
                iteration: this.iteration + 1,
                maxIterations: this.config.maxIterations,
                issue: 'workflow_post_repair_observation'
            });
            return true;
        }
        const validatedReviewObservations = activeScope?.visualDelivery?.awaitingRepairObservation
            ? toolResults.flatMap((result) => {
                if (result.success !== true) return [];
                const call = toolCalls.find((item) => item.id === result.callId);
                const receipt = readAgentVisualObservationReceipt(result.output);
                if (!call
                    || !receipt
                    || !hasAgentVisualDeliveryObservationCoverage(
                        result.output,
                        call.name,
                        activeScope.visualDelivery!.targetObservationIds
                    )) {
                    return [];
                }
                return [{
                    callId: result.callId,
                    documentId: receipt.document,
                    historyStateId: receipt.history
                }];
            })
            : [];
        const boundRepairObservationScope = bindAgentWorkflowContinuationRepairObservation({
            scope: activeScope,
            toolCalls,
            toolResults,
            validatedReviewObservations
        });
        if (activeScope && boundRepairObservationScope !== activeScope) {
            this.workflowContinuationScope = boundRepairObservationScope;
            this.messages.push(createHarnessControlMessage([
                '已经取得调整后的完整目标画面。',
                '只根据这张新画面判断效果；完成判断前不要重新运行整套方法、重复截图、继续修改、保存或导出。'
            ].join('\n'), 'workflow-post-repair-review', 'runtime-stage-recovery'));
            this.emitStep({
                kind: 'observation',
                title: '已取得修复后的目标画面',
                detail: '目标屏与文档版本均已核对，正在基于新画面完成视觉复验。',
                status: 'running',
                iteration: this.iteration + 1,
                maxIterations: this.config.maxIterations,
                issue: 'workflow_post_repair_review'
            });
            return true;
        }
        const visualDeliveryStatusByCallId = Object.fromEntries(toolResults.map((result) => {
            const call = toolCalls.find((item) => item.id === result.callId);
            return [
                result.callId,
                call
                    ? resolveAgentVisualDeliveryReviewStatus(result.output, call.name)
                    : 'pending'
            ];
        }));
        const visualDeliveryIdentityByCallId = Object.fromEntries(toolResults.flatMap((result) => {
            const receipt = readAgentVisualObservationReceipt(result.output);
            return receipt
                ? [[result.callId, {
                    documentId: receipt.document,
                    historyStateId: receipt.history
                }] as const]
                : [];
        }));
        const update = resolveAgentWorkflowContinuationScopeUpdate({
            workflowEntryTools: this.config.toolCapabilityBridge?.workflowEntryTools || [],
            toolCalls,
            toolResults,
            availableToolNames: this.selectWorkflowContinuationCapabilityVisibleToolNames(
                iterationTools
            ),
            binding: buildAgentWorkflowContinuationBinding(this.runtimeSession),
            visualDeliveryStatusByCallId,
            visualDeliveryIdentityByCallId
        });
        if (update.kind === 'none') return false;
        if (update.kind === 'clear') {
            const compactRepairObligationStillOpen = this.runtimeSession?.stageState.currentStage === 'E1'
                && Boolean(this.pendingDirectWorkflowHandoff)
                && activeScope?.workflowCallId === this.pendingDirectWorkflowHandoff?.workflowCallId;
            if (compactRepairObligationStillOpen) {
                return true;
            }
            this.workflowContinuationScope = undefined;
            return false;
        }
        const scope = update.scope;
        this.workflowContinuationScope = scope;
        const hasActionPlanStage = this.config.runtimeStagePlan?.steps
            .some((step) => step.stage === 'R4') === true;
        const bindsCompactRuntimeRepairObligation = !hasActionPlanStage
            && this.runtimeSession?.stageState.currentStage === 'E1'
            && scope.source === 'declared'
            && scope.purpose === 'repair'
            && !scope.visualDelivery;
        if (bindsCompactRuntimeRepairObligation) {
            const previousPending = this.pendingDirectWorkflowHandoff;
            const preservesBoundWorkflowEvidence = previousPending?.workflowToolName
                === scope.workflowToolName
                && previousPending.binding.sessionId === scope.binding.sessionId
                && previousPending.binding.runId === scope.binding.runId
                && previousPending.binding.generation === scope.binding.generation
                && previousPending.binding.stage === scope.binding.stage;
            this.pendingDirectWorkflowHandoff = {
                workflowToolName: scope.workflowToolName,
                workflowCallId: scope.workflowCallId,
                binding: scope.binding,
                currentEpochMutationCount: 0,
                ownerAccepted: false,
                mutationEvidence: preservesBoundWorkflowEvidence
                    ? previousPending.mutationEvidence
                    : []
            };
            this.runtimeDirectExecutionActionTarget = undefined;
        }
        this.messages.push(createHarnessControlMessage([
            `「${scope.workflowToolName}」还留下了需要继续完成的部分。`,
            scope.allowedToolNames.length > 0
                ? `只在当前方法和这些相关动作中继续：${scope.allowedToolNames.join('、')}。`
                : '当前没有安全的后续动作，不要切换到无关操作。',
            scope.reason ? `还需要处理：${scope.reason}` : ''
        ].join('\n'), 'workflow-continuation-recovery', 'runtime-stage-recovery'));
        this.emitStep({
            kind: 'observation',
            title: '按工作流交接继续',
            detail: scope.source === 'declared'
                ? '已持续收敛到当前工作流明确要求的下一步，不会跳到无关原子操作。'
                : '工作流没有给出有效交接范围，已保持失败关闭，只允许安全恢复。',
            status: 'running',
            iteration: this.iteration + 1,
            maxIterations: this.config.maxIterations,
            issue: 'workflow_continuation_recovery'
        });
        return true;
    }

    private refreshWorkflowVisualDeliveryContinuation(): boolean {
        const scope = this.readActiveWorkflowContinuationScope();
        if (!scope?.visualDelivery) return false;
        const reviewResultCallId = scope.visualDelivery.reviewResultCallId;
        const resultEntry = [...this.toolCallLog]
            .reverse()
            .find((entry) => (
                reviewResultCallId
                    ? entry.callId === reviewResultCallId
                        && entry.name === scope.visualDelivery?.reviewResultToolName
                    : entry.name === scope.workflowToolName
            ));
        if (!resultEntry) return false;
        const visualStatus = resolveAgentVisualDeliveryReviewStatus(
            resultEntry.result,
            resultEntry.name,
            {
                targetObservationIds: scope.visualDelivery.targetObservationIds
            }
        );
        const refreshed = refreshAgentWorkflowContinuationVisualDelivery({
            scope,
            visualStatus,
            availableToolNames: this.selectWorkflowContinuationCapabilityVisibleToolNames(
                this.config.tools
            ),
            workflowEntryTools: this.config.toolCapabilityBridge?.workflowEntryTools || []
        });
        if (!refreshed) return false;
        const previousSignature = [
            scope.purpose,
            ...scope.allowedToolNames
        ].join('|');
        const refreshedSignature = [
            refreshed.purpose,
            ...refreshed.allowedToolNames
        ].join('|');
        if (previousSignature === refreshedSignature) return false;

        this.workflowContinuationScope = refreshed;
        const visualCompletionReady = visualStatus === 'passed'
            && refreshed.visualDelivery?.completeOnVisualPass === true;
        let visualStatusMessage = '当前画面还需要继续调整。';
        let visualNextActionMessage = refreshed.allowedToolNames.length > 0
            ? `只从这些相关动作中继续：${refreshed.allowedToolNames.join('、')}。`
            : '当前没有合适的后续动作。';
        let visualSafetyMessage = '如果用户要求交付文件，要等保存或导出实际完成后再说明结果。';
        let visualStepTitle = '画面需要继续处理';
        let visualStepDetail = '交付仍锁定，正在按视觉问题继续修复或重新观察。';
        let visualStepIssue = 'workflow_visual_delivery_repair';
        if (visualCompletionReady) {
            visualStatusMessage = '当前画面已经达到这项任务的要求，且用户没有要求保存或导出。';
            visualNextActionMessage = '可以直接整理最终说明，不要额外增加保存、导出或无关修改。';
            visualSafetyMessage = '';
            visualStepTitle = '画面复核通过，准备完成';
            visualStepDetail = '已真实看过候选画面；本任务未要求保存或导出，可以进入最终完成判断。';
            visualStepIssue = 'workflow_visual_completion_ready';
        } else if (visualStatus === 'passed') {
            visualStatusMessage = '当前画面已经达到要求，可以继续完成交付。';
            visualStepTitle = '画面复核通过，准备交付';
            visualStepDetail = '已真实看过候选画面，只开放本任务声明的交付动作。';
            visualStepIssue = 'workflow_visual_delivery_ready';
        }
        this.messages.push(createHarnessControlMessage([
            visualStatusMessage,
            visualNextActionMessage,
            visualSafetyMessage
        ].join('\n'), 'workflow-visual-delivery', 'runtime-stage-recovery'));
        this.emitStep({
            kind: visualStatus === 'passed' ? 'observation' : 'warning',
            title: visualStepTitle,
            detail: visualStepDetail,
            status: 'running',
            iteration: this.iteration + 1,
            maxIterations: this.config.maxIterations,
            issue: visualStepIssue
        });
        return true;
    }

    private applyToolPreflightReplanDirective(input: {
        call: ToolCall;
        preflight: AgentToolExecutionPreflight;
        blockedMessage: string;
        assistantToolCalls: ToolCall[];
        completedToolResults: ToolResult[];
    }): boolean {
        const { call, preflight, blockedMessage, assistantToolCalls, completedToolResults } = input;
        if (this.toolPreflightReplanAttempts >= MAX_TOOL_PREFLIGHT_REPLAN_ATTEMPTS) {
            return false;
        }

        this.toolPreflightReplanAttempts += 1;
        const blockers = preflight.blockers
            .map((item) => String(item || '').trim())
            .filter(Boolean);
        const userProcess = buildAgentToolPreflightUserProcess({
            toolDisplayName: getToolDisplayInfo(call.name).name,
            blockers
        });

        this.emitStep({
            kind: 'warning',
            title: userProcess.title,
            // 撞墙需要可见，但只投影设计师正在核对的对象与原因；原始 blocker 完整留在
            // Harness control message 和运行档案，不能靠术语替换后直接端给用户。
            detail: userProcess.detail,
            status: 'running',
            iteration: this.iteration + 1,
            maxIterations: this.config.maxIterations,
            toolName: call.name,
            toolCallId: call.id,
            issue: preflight.issue || 'agent_tool_execution_preflight_replan',
            // 被拦的尝试必须进用户可见过程面板：否则用户看到"只读现状没动手"的假相，
            // 实际是在反复撞预检门槛（实测：模型调用 sku-batch 被拦 10+ 轮不可见）。
            audience: 'user',
            visibility: 'user_process'
        });

        this.appendCompleteToolResultsForAssistantToolCalls({
            assistantToolCalls,
            toolResults: [
                ...completedToolResults,
                {
                    callId: call.id,
                    success: false,
                    output: {
                        success: false,
                        error: blockedMessage,
                        code: preflight.issue || 'agent_tool_execution_preflight_replan',
                        preflight
                    }
                }
            ],
            fallbackError: '本轮进入重规划，后续工具未执行。',
            fallbackCode: 'agent_tool_execution_preflight_replan_skipped',
            fallbackOutput: { preflight }
        });
        this.messages.push(createHarnessControlMessage([
                `刚才准备执行「${call.name}」，但还不能确定目标文档或对象。`,
                blockers.length > 0 ? `缺少的前置条件：${blockers.join('；')}` : '',
                '这些是执行事实，不是下一工具指令；请从完整已授权能力面选择最小方式补齐信息或改走其他安全路线。',
                requiresUserVisiblePreActionRationaleForToolCalls(assistantToolCalls)
                    ? '如果下一步仍会修改文档，同时安排一次修改后的画面查看。'
                    : '使用已经取得的对象和文档信息，选择最小的下一步继续。',
                '从零设计就先建立目标画布；编辑现有文件就先确认当前文档和目标图层。'
            ].filter(Boolean).join('\n'), 'tool-preflight-replan', 'tool-preflight-recovery'));
        this.config.callbacks.onProgress?.(
            '重新判断下一步',
            Math.min(95, Math.round(((this.iteration + 1) / this.config.maxIterations) * 100))
        );
        return true;
    }

    private buildAllowedToolNameSetForContract(contract: AgentToolDecisionContract): Set<string> {
        if (contract.blockers.some((item) => item.code === 'execution_authorization_required')) {
            const authorizationSafeTools = new Set<string>();
            for (const tool of this.config.tools) {
                if (isAgentToolVisibleForIntentDecision(tool.name, this.runIntentControlPlaneDecision)) {
                    authorizationSafeTools.add(tool.name);
                }
            }
            return authorizationSafeTools;
        }

        const allowed = new Set<string>();
        for (const tool of this.config.tools) {
            const kind = classifyAgentToolExecution(tool.name);
            if (kind === 'unknown') continue;
            if (contract.intentToolScope === 'read_only') {
                if (kind === 'read_only_observation'
                    || (kind === 'stateful_context' && /^(switchDocument|selectLayer|focusLayer)$/.test(tool.name))) {
                    allowed.add(tool.name);
                }
                continue;
            }
            if (contract.intentToolScope === 'knowledge_search') {
                if (
                    kind === 'knowledge_search'
                    || (kind === 'stateful_context' && isAgentCapabilityControlTool(tool.name))
                ) {
                    allowed.add(tool.name);
                }
                continue;
            }
            if (contract.intentToolScope === 'write_photoshop') {
                if (kind === 'read_only_observation'
                    || kind === 'knowledge_search'
                    || kind === 'photoshop_write'
                    || kind === 'save_export'
                    || kind === 'external_generation'
                    || kind === 'stateful_context') {
                    allowed.add(tool.name);
                }
            }
        }
        return allowed;
    }

    private buildToolDecisionReplanDirective(
        allowedToolNames: Set<string>,
        contract?: { blockers?: Array<{ code?: string; unlockOptions?: string[] }> }
    ): string {
        const toolNames = Array.from(allowedToolNames).filter(Boolean);
        // GATE-SIMPLIFY-008：授权不足类拦截带结构化解锁出口，直连进重规划指令，
        // 取代「条件不完整」式无出路空转（gates-definitions 4.3 病例）。
        const authorizationBlocker = contract?.blockers?.find(
            (item) => item.code === 'execution_authorization_required'
        );
        const unlockLines = authorizationBlocker?.unlockOptions?.length
            ? [
                'Ways to unlock the blocked action: '
                + authorizationBlocker.unlockOptions.map((item) => String(item).trim()).filter(Boolean).join('; ') + '.'
            ]
            : [];
        return [
            'Observation for the next step:',
            'The attempted tool step was not executed because the current action was not sufficiently tied to the user request and available document state.',
            toolNames.length > 0
                ? `The currently authorized capability set includes: ${toolNames.join(', ')}.`
                : 'No compatible tool is currently available.',
            'Choose the next action yourself from the complete currently authorized capability set; this feedback does not select a Tool for you.',
            ...unlockLines,
            'Do not mention internal check names, status codes, or diagnostics to the user.',
            'If a write action is still needed, satisfy the concrete target-identity and object-source blockers, then pair the write with an appropriate readback. User-visible wording is not execution permission.',
            'If the user only requested inspection, use read-only tools only.'
        ].join('\n');
    }

    private recoverTextEncodedToolCalls(content: unknown, iterationTools: ToolSchema[]): ToolCall[] {
        const text = String(content || '').trim();
        if (!text || !containsDsmlToolCallMarkup(text)) return [];

        const allowedToolNames = new Set(iterationTools.map((tool) => tool.name));
        if (allowedToolNames.size === 0) return [];

        const dsmlBatch = parseDsmlToolCallBatch(text);
        if (!dsmlBatch.valid) return [];
        const calls = dsmlBatch.candidates.map((candidate, index): ToolCall | undefined => {
            const toolName = String(candidate.name || '').trim();
            const args = candidate.arguments;
            if (!toolName || !allowedToolNames.has(toolName) || !this.isPlainObject(args)) return undefined;
            return {
                id: `text-recovered-${this.iteration}-${index}-${toolName}`,
                name: toolName,
                arguments: args
            };
        });
        return calls.length <= 4 && calls.every(Boolean) ? calls as ToolCall[] : [];
    }

    private stripTextEncodedToolCallBlocks(content: unknown): string {
        const text = removeDsmlToolCallMarkup(content);
        const stripped = text
            .replace(/执行步骤如下[:：]?/g, '')
            .replace(/^\s*[-*]?\s*$/gm, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        return sanitizeUserVisibleAgentText(stripped);
    }

    private isPlainObject(value: unknown): value is Record<string, any> {
        return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    }

    private getStageDeclarationKind(toolName: string): string | undefined {
        if (isDesignBriefControlTool(toolName)) return 'design_brief';
        if (isReferenceBriefControlTool(toolName)) return 'reference_brief';
        if (isDesignStrategyControlTool(toolName)) return 'design_strategy';
        if (isRuntimeActionPlanControlTool(toolName)) return 'runtime_action_plan';
        return undefined;
    }

    private enforceRuntimeStageOwnerToolCalls(toolCalls: ToolCall[]): ToolCall[] {
        const stage = this.runtimeSession?.stageState.currentStage;
        if (stage === 'R3'
            && !this.runtimeDesignStrategyDeclaration
            && !toolCalls.some((call) => isDesignStrategyControlTool(call.name))) {
            return toolCalls.filter((call) => isDesignStrategyControlTool(call.name));
        }
        if (stage === 'R4'
            && !this.runtimeActionPlanDeclaration) {
            const capabilityCalls = toolCalls.filter((call) => (
                isAgentCapabilityControlTool(call.name)
            ));
            const ownerCalls = toolCalls.filter((call) => isRuntimeActionPlanControlTool(call.name));
            if (ownerCalls.length === 0) return capabilityCalls;
            // 同一模型响应先装载计划所需 Capability，再执行 R4 owner；首稿 bootstrap
            // 必须排在 owner 之后。声明工具先把 Session 推进 E1，后续写入仍逐个经过
            // 真实执行门，不能靠模型返回顺序绕过。
            return [
                ...capabilityCalls,
                ...ownerCalls,
                ...toolCalls.filter((call) => (
                    !isAgentCapabilityControlTool(call.name)
                    && !isRuntimeActionPlanControlTool(call.name)
                ))
            ];
        }
        return toolCalls;
    }

    private normalizeToolCallsBeforeExecution(toolCalls: ToolCall[], assistantContent: unknown): ToolCall[] {
        const sourceText = [this.currentTask, String(assistantContent || '')].filter(Boolean).join('\n');
        const createdDocumentNames = this.getCreatedDocumentNamesFromLog();
        const seenStageDeclarationKinds = new Set<string>();
        const kept: ToolCall[] = [];
        const stageOwnedToolCalls = this.enforceRuntimeStageOwnerToolCalls(toolCalls);
        for (const call of stageOwnedToolCalls) {
            const normalizedCall = {
                ...call,
                arguments: normalizePhotoshopToolArguments(call.name, call.arguments, { sourceText })
            };
            const stageDeclarationKind = this.getStageDeclarationKind(normalizedCall.name);
            if (stageDeclarationKind) {
                if (seenStageDeclarationKinds.has(stageDeclarationKind)) continue;
                seenStageDeclarationKinds.add(stageDeclarationKind);
            }
            if (normalizedCall.name === 'createDocument') {
                const documentName = this.readCreateDocumentName(normalizedCall);
                if (documentName && createdDocumentNames.has(documentName)) {
                    this.emitStep({
                        kind: 'warning',
                        title: '继续使用已创建文档',
                        detail: `已存在本轮创建的文档「${documentName}」，不会重复新建同名文档。`,
                        status: 'running',
                        iteration: this.iteration + 1,
                        maxIterations: this.config.maxIterations,
                        issue: 'duplicate_create_document_skipped'
                    });
                    continue;
                }
                if (documentName) createdDocumentNames.add(documentName);
            }
            kept.push(normalizedCall);
        }
        return kept;
    }

    private getCreatedDocumentNamesFromLog(): Set<string> {
        const names = new Set<string>();
        for (const entry of this.toolCallLog) {
            if (entry.name !== 'createDocument' || entry.result?.success === false) continue;
            const name = String(
                entry.arguments?.name
                || entry.result?.documentName
                || entry.result?.document?.name
                || entry.result?.name
                || ''
            ).trim();
            if (name) names.add(name);
        }
        return names;
    }

    private readCreateDocumentName(call: ToolCall): string {
        return String(call.arguments?.name || '').trim();
    }

    private normalizeLayerTargetToolCallBeforeExecution(
        call: ToolCall,
        sourceText: string,
        completedBatchEntries: AgentToolCallLogEntry[]
    ): ToolCall {
        if (!LAYER_ID_TARGET_RESOLUTION_TOOLS.has(call.name)) return call;
        if (!this.isPlainObject(call.arguments)) return call;

        const requestedLayerId = Number(call.arguments.layerId);
        if (!Number.isFinite(requestedLayerId)) return call;

        const completedEntries = [...this.toolCallLog, ...completedBatchEntries];
        const explicitTarget = this.resolveExplicitLayerTargetFromTask(sourceText, completedEntries);
        if (!explicitTarget || explicitTarget.layerId === requestedLayerId) return call;

        const requestedLayerIsKnown = completedEntries.some((entry) => (
            entry.result?.success !== false
            && this.readLayerIdFromLogEntry(entry) === requestedLayerId
        ));
        if (!requestedLayerIsKnown) return call;

        this.emitStep({
            kind: 'warning',
            title: '改用已确认目标图层',
            detail: `当前任务指定 ${explicitTarget.label}，已使用对应的已确认图层。`,
            status: 'running',
            iteration: this.iteration + 1,
            maxIterations: this.config.maxIterations,
            toolName: call.name,
            toolCallId: call.id,
            issue: 'ground_layer_id_from_named_target'
        });

        return {
            ...call,
            arguments: {
                ...call.arguments,
                layerId: explicitTarget.layerId
            }
        };
    }

    private resolveExplicitLayerTargetFromTask(
        sourceText: string,
        completedEntries: AgentToolCallLogEntry[]
    ): { layerId: number; label: string; producerTool: string } | null {
        const taskText = String(sourceText || '').replace(/\s+/g, ' ').trim();
        if (!taskText || !/(剪切|剪贴|clipping|clip)/i.test(taskText)) return null;

        const targetSentences = taskText
            .split(/[。！？!?；;\n]/u)
            .map((item) => item.trim())
            .filter((sentence) => /(使用|用|同一个|目标|创建|释放|剪切|剪贴|clipping|clip)/i.test(sentence));
        const targetText = targetSentences.length > 0 ? targetSentences.join('\n') : taskText;

        for (const hint of EXPLICIT_LAYER_TARGET_HINTS) {
            if (!hint.patterns.some((pattern) => pattern.test(targetText))) continue;
            const entry = [...completedEntries].reverse().find((item) => (
                item.name === hint.producerTool
                && item.result?.success !== false
                && typeof this.readLayerIdFromLogEntry(item) === 'number'
            ));
            const layerId = entry ? this.readLayerIdFromLogEntry(entry) : undefined;
            if (typeof layerId === 'number' && Number.isFinite(layerId)) {
                return { layerId, label: hint.label, producerTool: hint.producerTool };
            }
        }

        return null;
    }

    private readLayerIdFromLogEntry(entry: AgentToolCallLogEntry): number | undefined {
        const result = entry?.result && typeof entry.result === 'object' ? entry.result : {};
        const candidates = [
            result.layerId,
            result.id,
            result.layer?.id,
            result.data?.layerId,
            result.data?.layer?.id,
            result.properties?.id
        ];
        for (const value of candidates) {
            if (typeof value === 'number' && Number.isFinite(value)) return value;
        }
        return undefined;
    }

    private readToolResultRecoveryOptions(output: any): string[] {
        if (!output || typeof output !== 'object') return [];
        const candidates = [
            ...(Array.isArray(output.nextRequiredToolOptions) ? output.nextRequiredToolOptions : []),
            ...(Array.isArray(output.data?.nextRequiredToolOptions)
                ? output.data.nextRequiredToolOptions
                : []),
            output.nextRequiredTool,
            output.requiredNextTool,
            output.requiredTool,
            output.data?.nextRequiredTool,
            output.data?.requiredNextTool,
            output.data?.requiredTool
        ];
        const toolNames: string[] = [];
        for (const candidate of candidates) {
            const toolName = String(candidate || '').trim();
            if (toolName && !toolNames.includes(toolName)) toolNames.push(toolName);
        }
        return toolNames;
    }

    private async requestModelWithOptionalStream(
        modelId: string,
        messages: AgentMessage[],
        tools: ToolCall[] | any[],
        options: {
            maxTokens?: number;
            temperature?: number;
            nativeTools?: ProviderNativeToolRequest[];
            timeoutMs?: number;
            reasoningEffort?: AgentConfig['reasoningEffort'];
        },
        callKind: 'agent_turn' | 'provider_output_recovery',
        contextPreparation: RuntimeContextPreparationShape
    ): ReturnType<CallModelFn> {
        if (callKind !== 'provider_output_recovery') {
            // The directive must be added before message governance snapshots the request.
            // Counting the imminent call avoids the former one-turn delay at the threshold.
            this.maybePushBudgetDisciplineDirective(1);
        }
        const governedMessages = prepareAgentMessagesForModel(messages);
        const visualAnalysis = this.initialImagesPendingPrimaryObservation
            || this.pendingPrimaryVisualObservations.length > 0;
        const visualInput = projectCurrentVisualInputForAccounting(
            governedMessages,
            this.pendingPrimaryVisualObservations
        );
        try {
            const response = await this.modelCallAccounting.callPrimaryProvider({
                modelId,
                messages: governedMessages,
                tools: tools as ToolSchema[],
                requestedOptions: options,
                callKind,
                agentIteration: this.iteration + 1,
                contextPreparation,
                visualInput,
                beforeRequest: callKind === 'provider_output_recovery'
                    ? undefined
                    : () => { this.beginPerformanceModelCall(visualAnalysis); }
            });
            if (!isProviderOutputTruncated(response.stopReason)) retireDeliveredAgentMessageImages(messages);
            return response;
        } catch (error) {
            retireDeliveredAgentMessageImages(messages);
            this.initialImagesPendingPrimaryObservation = false;
            this.pendingPrimaryVisualObservations = [];
            throw error;
        }
    }

    private async requestNoToolReplanAfterToolDecisionBlocked(
        contract: AgentToolDecisionContract,
        blockedMessage: string
    ): Promise<AgentRunResult | null> {
        this.emitStep({
            kind: 'model_request',
            title: '改为直接回复',
            detail: '这个请求不需要动手操作，正在整理回复',
            status: 'running',
            iteration: this.iteration + 1,
            maxIterations: this.config.maxIterations
        });

        const lightweight = this.config.performanceBudget?.allowProviderThinking === false;
        const maxAttempts = lightweight ? 1 : 2;

        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            try {
                const response = await this.modelCallAccounting.callAgentProvider(
                    this.config.modelId,
                    [
                        {
                            role: 'system',
                            content: [
                                this.config.systemPrompt,
                                '',
                                '上一轮模型请求了工具，但系统判断当前用户请求不应该执行工具。',
                                '请直接回答用户问题。',
                                '不要调用工具，不要输出 JSON/XML，不要提到内部流程、状态码或调试内容。',
                                '如果用户在问能力范围，就按当前产品能力用自然中文简洁说明。',
                                attempt > 0
                                    ? '上一轮直接回复像固定能力菜单或内部模板，不能展示给用户。请重新用自然中文回答这个具体问题，不要列完整能力菜单，不要复述固定下一步。'
                                    : ''
                            ].filter(Boolean).join('\n')
                        },
                        {
                            role: 'user',
                            content: this.currentTask
                        }
                    ],
                    [],
                    {
                        maxTokens: 1200,
                        temperature: attempt > 0 ? 0.45 : 0.3,
                        timeoutMs: AGENT_AUXILIARY_MODEL_TIMEOUT_MS
                    },
                    { callKind: 'no_tool_replan', requestMode: 'non_stream', agentIteration: this.iteration + 1 }
                );

                if (response.toolCalls?.length) {
                    this.emitStep({
                        kind: 'warning',
                        title: '直接回复重试仍返回工具请求',
                        detail: '模型重试后仍请求工具，系统继续阻止执行。',
                        status: attempt + 1 < maxAttempts ? 'running' : 'error',
                        iteration: this.iteration + 1,
                        maxIterations: this.config.maxIterations,
                        issue: 'no_tool_replan_returned_tool_call'
                    });
                    if (attempt + 1 < maxAttempts) continue;
                    return null;
                }

                const finalMessage = sanitizeUserVisibleAgentText(readCompleteProviderTextContent(response).content).trim();
                if (!finalMessage) {
                    this.emitStep({
                        kind: 'warning',
                        title: '直接回复需要重新表达',
                        detail: sanitizeUserVisibleDiagnosticText(blockedMessage || contract.blockers[0]?.message || ''),
                        status: attempt + 1 < maxAttempts ? 'running' : 'error',
                        iteration: this.iteration + 1,
                        maxIterations: this.config.maxIterations,
                        issue: 'empty_no_tool_replan_response'
                    });
                    if (attempt + 1 < maxAttempts) continue;
                    return null;
                }

                this.emitStep({
                    kind: 'model_response',
                    title: '已改为直接回复',
                    detail: `返回文本 ${finalMessage.length} 字，未执行工具。`,
                    status: 'success',
                    iteration: this.iteration + 1,
                    maxIterations: this.config.maxIterations
                });
                return this.finishAgentTextResponse(finalMessage);
            } catch (error) {
                this.emitStep({
                    kind: 'warning',
                    title: '直接回复重试失败',
                    detail: sanitizeUserVisibleDiagnosticText(error instanceof Error ? error.message : String(error)),
                    status: attempt + 1 < maxAttempts ? 'running' : 'error',
                    iteration: this.iteration + 1,
                    maxIterations: this.config.maxIterations,
                    issue: 'no_tool_replan_failed'
                });
                if (attempt + 1 < maxAttempts) continue;
                return null;
            }
        }

        return null;
    }

    private async prepareNaturalFinalResponseCheckpoint(
        finalMessage: string
    ): Promise<AgentTerminalClosureCheckpoint> {
        const checkpoint = await evaluateNaturalFinalTerminalClosureCheckpoint({
            finalMessage,
            unsupportedBareCompletionClaim: isBareAgentCompletionClaim(finalMessage)
                && !this.hasSuccessfulTaskDeliveryAction(),
            iteration: this.iteration,
            lastGapFingerprint: this.lastTerminalClosureGap?.fingerprint || '',
            recoveryAttempts: this.terminalClosureRecoveryAttempts,
            prepareClosure: (input) => this.prepareAgentTerminalClosure(input),
            projectGap: (prepared) => this.buildRecoverableTerminalClosureGap(prepared),
            projectRuntimeBoundary: (gap) => projectTerminalClosureRuntimeBoundary({
                gap,
                signalAborted: this.config.signal?.aborted === true,
                hasUnsettledWriteState: Boolean(this.pendingRuntimeActionMutationReadback || this.runtimeActionProviderRecoveryBlocked),
                session: this.runtimeSession
            }),
            budgetBoundaryAllows: () => this.iteration < this.config.maxIterations
                && !this.readPerformanceBudgetExhaustion()
        });
        if (checkpoint.stopReason) {
            this.emitStep(projectTerminalClosureStopStep({
                reason: checkpoint.stopReason,
                iteration: this.iteration + 1,
                maxIterations: this.config.maxIterations
            }));
        }
        if (!checkpoint.continueLoop || !checkpoint.gap || !checkpoint.preparedClosure) {
            return checkpoint;
        }
        const stagePreparation = resolveTerminalClosureStagePreparation({
            gap: checkpoint.gap,
            currentStage: this.runtimeSession?.stageState.currentStage,
            designVerdictStatus: checkpoint.preparedClosure.executionSummary.designVerdict?.status
        });
        if (stagePreparation === 'advance_r5') {
            const verdict = checkpoint.preparedClosure.executionSummary.designVerdict;
            if (verdict) this.evaluateRuntimeStage({
                stage: 'R5', outcome: 'passed', observedOutcomes: ['quality_gate_report', 'stage_evaluation'],
                reason: verdict.summary, verdict
            });
        }
        if (stagePreparation === 'blocked'
            || (stagePreparation === 'advance_r5' && !this.isCurrentRuntimeStage('E2'))) {
            this.emitStep(projectTerminalClosureStopStep({
                reason: 'stage_mismatch',
                iteration: this.iteration + 1,
                maxIterations: this.config.maxIterations
            }));
            return {
                continueLoop: false,
                preparedClosure: stopPreparedTerminalClosure(
                    checkpoint.preparedClosure,
                    checkpoint.gap,
                    'stage_mismatch'
                )
            };
        }
        this.terminalClosureRecoveryAttempts += 1;
        this.lastTerminalClosureGap = checkpoint.gap;
        this.terminalClosureQualityCache = checkpoint.gap.kind === 'delivery_evidence'
            ? buildTerminalClosureQualityCache({
                historyStateRef: this.readLatestClosedQualityHistoryStateRef(),
                latestMutationIndex: findLatestObservedPhotoshopMutationIndex(this.toolCallLog),
                preparedClosure: checkpoint.preparedClosure
            })
            : undefined;
        this.messages.push({ role: 'assistant', content: finalMessage });
        this.messages.push(createHarnessControlMessage(
            checkpoint.gap.message,
            'terminal-closure-recovery',
            `terminal-closure:${checkpoint.gap.fingerprint}`
        ));
        this.emitStep(projectTerminalClosureContinuationStep({
            gap: checkpoint.gap,
            iteration: this.iteration + 1,
            maxIterations: this.config.maxIterations
        }));
        this.synchronizeRuntimePerformanceUsage();
        return { continueLoop: true };
    }

    private buildRecoverableTerminalClosureGap(
        preparedClosure: PreparedAgentTerminalClosure
    ): AgentTerminalClosureGap | undefined {
        const summary = preparedClosure.executionSummary;
        const evaluationProfile = this.resolveRuntimeEvaluationProfile();
        const reviewCandidate = this.findLatestDesignVisualJudgeReviewSet(
            this.resolveFinalReviewSetRequirements(evaluationProfile).requireMultiSurface
        );
        return projectRecoverableTerminalClosureGap({
            summary,
            evaluationProfile,
            currentHistoryStateRef: this.readLatestClosedQualityHistoryStateRef(),
            reviewHistoryStateRef: reviewCandidate?.historyStateRef,
            finalQualityJudgeAvailable: Boolean(resolveFinalQualityJudgeModelId(this.config.modelId)),
            reflexionHandoff: preparedClosure.reflexionHandoff,
            deliveryVerification: preparedClosure.runtimeDeliveryVerification
        });
    }

    /**
     * 两条纯文本出口共用同一结果真实性结算：未知任务仍可直接交付完整正文；
     * 只有完成宣称时才要求真实交付动作。纯读取与失败写入都不能替“已完成”背书，
     * 检查任务应直接给出真实观察结果，而不是只说“检查完成”。
     */
    private finishAgentTextResponse(
        finalMessage: string,
        preparedClosure?: PreparedAgentTerminalClosure
    ): Promise<AgentRunResult> {
        const unsupportedCompletionClaim = isBareAgentCompletionClaim(finalMessage)
            && !this.hasSuccessfulTaskDeliveryAction();
        const userVisibleFinalMessage = unsupportedCompletionClaim
            ? '这次只给出一句完成声明，没有真正做出内容，也没有给出可以查看的结果，所以不能算完成。'
            : finalMessage;
        // 这里的正文仍只是模型候选终稿：buildRunResult 尚未完成 Final Judge、
        // Photoshop history 收尾、完成话术对齐和 Reflexion handoff。它可以进入
        // Agent 内部历史供结算使用，但不能经 onMessage 提前成为用户可见进展；
        // ChatPanel 只在外层自主执行（含可能的 Reflexion）返回最终 result.message 后交付正文。
        this.messages.push({
            role: 'assistant',
            content: userVisibleFinalMessage
        });
        return this.buildRunResult({
            success: !unsupportedCompletionClaim,
            message: userVisibleFinalMessage,
            iterations: this.iteration + 1,
            stopReason: unsupportedCompletionClaim
                ? 'plan_execution_mismatch'
                : 'final_response',
            ...(unsupportedCompletionClaim
                ? { error: 'unsupported_bare_completion_claim' }
                : {})
        }, preparedClosure);
    }

    private emitDeterministicPreActionDisclosureBeforeFirstToolResult(
        toolCalls: ToolCall[],
        required: boolean
    ): void {
        if (!required || this.hasTaskProgressToolCalls() || this.visibleReasoningSent) {
            return;
        }

        const plannedTools = toolCalls.map((call) => call.name).filter(Boolean);
        const plannedActions = Array.from(new Set(
            plannedTools.map((toolName) => getToolDisplayInfo(toolName).name)
        )).slice(0, 3);
        const normalizedTask = String(this.currentTask || '').replace(/\s+/g, ' ').trim();
        const taskSummary = normalizedTask.length > 72
            ? `${normalizedTask.slice(0, 72)}…`
            : normalizedTask;
        const actionDisclosure = buildAgentPreActionDisclosure(plannedActions).message;
        const disclosure = taskSummary
            ? `围绕用户目标“${taskSummary}”，${actionDisclosure}`
            : actionDisclosure;
        this.visibleReasoningSent = true;
        this.latestVisiblePreActionRationale = disclosure;
        this.emitStep({
            kind: 'observation',
            title: '准备执行并复核',
            detail: disclosure,
            status: 'running',
            iteration: this.iteration + 1,
            maxIterations: this.config.maxIterations,
            issue: 'harness_pre_action_disclosure',
            audience: 'user',
            visibility: 'user_process'
        });
    }

    private shouldRequireUserVisiblePreActionRationaleForToolCalls(toolCalls: ToolCall[]): boolean {
        return requiresUserVisiblePreActionRationaleForToolCalls(toolCalls);
    }

    private shouldRequireInitialToolCallForCurrentTask(): boolean {
        if (this.config.requireInitialToolCall === false) return false;
        if (this.config.agentTaskPlan) {
            return requiresAgentTaskProgress(this.config.agentTaskPlan);
        }
        const toolDecisionContext = this.config.toolDecisionContext;
        if (!toolDecisionContext?.intentControlPlane) return false;
        const intentControlPlane = this.runIntentControlPlaneDecision;
        if (!intentControlPlane) return false;

        if (!isConfirmedToolRequiredIntent(intentControlPlane)
            || intentControlPlane.toolScope === 'knowledge_search') {
            return false;
        }

        return intentControlPlane.toolScope !== 'none'
            && intentControlPlane.requestKind !== 'chat_only'
            && intentControlPlane.requestKind !== 'plan_only'
            && intentControlPlane.requestKind !== 'clarify'
            && intentControlPlane.requestKind !== 'uxp_user_tool_only';
    }

    private updateLoopGuards(
        toolCalls: ToolCall[],
        toolResults: ToolResult[],
        options: {
            suppressConsecutiveFailedRound?: boolean;
            stageProgressChanged?: boolean;
        } = {}
    ): string | null {
        const toolCallById = new Map(toolCalls.map((call) => [call.id, call]));
        const toolNameByCallId = new Map(toolCalls.map((call) => [call.id, call.name]));
        const repeatedPolicyGate = recordPolicyGateBlockRound(
            this.policyGateRepeatState,
            toolResults.map((result) => ({
                toolName: toolNameByCallId.get(result.callId) || 'unknown',
                result: result.output
            }))
        );
        // 与 consecutiveFailedToolRounds / consecutiveControlToolNoProgressRounds 同一条豁免：
        // Harness 主动介入的修复是有界重试（自己会在预算内收尾），不能被这个通用出口抢先掐断。
        //
        // 但豁免本身必须有界（真机 [491]，2026-08-18）：模型每轮夹一次 requestAgentCapabilities
        // 触发 liveness recovery，suppressConsecutiveFailedRound 每轮都为真，
        // 同一堵墙（photoshop_target_changed_before_execution）撞满 14 次一次都没停机。
        // 原注释「下一轮即触发」的前提是豁免不会每轮成立——真机证伪。
        // 现在由账本自己判定还能不能宽限：verdict.suppressible 为 false 即无条件停机。
        if (repeatedPolicyGate
            && (!options.suppressConsecutiveFailedRound || !repeatedPolicyGate.suppressible)) {
            return repeatedPolicyGate.message;
        }

        // 写前观察超限（账本单一 owner）：不再作为 loop guard 触发 liveness 收窄工具面，
        // 只给模型一条一次性提醒——观察调用照常执行、照常回填。设计路径宪法：拦「看多了」
        // 必须降级为提示，工具面收窄留给真正的死循环与安全事件。
        const observationReserveAdvice = takeObservationReserveAdviceFromLedger(this.performanceLedger);
        if (observationReserveAdvice) {
            this.messages.push(createHarnessControlMessage(
                observationReserveAdvice,
                'observation-reserve-advice',
                'observation-reserve-advice'
            ));
        }

        const batchSignature = buildToolBatchSignature(toolCalls);
        if (options.stageProgressChanged) {
            this.lastToolBatchSignature = batchSignature;
            this.repeatedToolBatchCount = batchSignature ? 1 : 0;
        } else if (batchSignature && batchSignature === this.lastToolBatchSignature) {
            this.repeatedToolBatchCount += 1;
        } else {
            this.lastToolBatchSignature = batchSignature;
            this.repeatedToolBatchCount = batchSignature ? 1 : 0;
        }

        // policyGate 结果是策略/安全控制信号，不是工具执行失败：排除出 no_progress 会计，
        // 否则一轮纯策略重定向会被当"整轮失败"，几轮内误停整个任务（治理审计 2026-07-08）。
        // Harness 控制工具（声明/能力请求）同样排除：它们成功不算任务进展、失败不算工具失败，
        // 否则全失败运行中每轮附带一次合法声明（载荷可微调）就能把停机守卫永远重置，
        // 拖到 maxIterations 才停（对抗核验 2026-07-10）。
        const controlToolCallIds = new Set(
            toolCalls
                .filter((call) => isAgentHarnessControlTool(call.name))
                .map((call) => call.id)
        );
        const failureAccountingResults = toolResults.filter((result) =>
            !isPolicyGateResult(result.output) && !controlToolCallIds.has(result.callId)
        );
        const allFailed = failureAccountingResults.length > 0 && failureAccountingResults.every((result) => !result.success);
        if (allFailed) {
            if (!options.suppressConsecutiveFailedRound) {
                this.consecutiveFailedToolRounds += 1;
            }
        } else if (failureAccountingResults.length > 0) {
            this.consecutiveFailedToolRounds = 0;
        }

        const anySuccessfulTool = failureAccountingResults.some((result) => (
            result.success
            && !isAgentReadResultCacheHit(result.output)
            && result.output?.countsAsTaskProgress !== false
        ));
        const madeDurableExecutionProgress = failureAccountingResults.some((result) => {
            if (!result.success
                || isAgentReadResultCacheHit(result.output)
                || result.output?.countsAsTaskProgress === false) {
                return false;
            }
            const call = toolCallById.get(result.callId);
            if (!call) return false;
            const kind = classifyAgentToolExecution(call.name, call.arguments);
            return kind === 'photoshop_write'
                || kind === 'save_export'
                || kind === 'external_generation'
                || (kind === 'stateful_context' && !isReadOnlyAgentContextTool(call.name));
        });
        if (options.stageProgressChanged || madeDurableExecutionProgress) {
            this.unfinishedTurnContinuationAttempts = 0;
            this.unfinishedTurnContinuationKey = '';
        }

        // 控制工具（声明/能力请求）的独立停机会计。
        // 上面刻意把控制工具排除出普通失败会计，但只做了单向保护：控制工具成功不会被当成进展。
        // 反向漏洞有两种——反复失败的声明，以及 success=true 但明确标记为 idempotent no-op 的
        // 重复能力请求。两者都没有改变 Harness 状态，不能因为 success=true 永远清零守卫。
        const controlToolResults = toolResults.filter((result) =>
            !isPolicyGateResult(result.output) && controlToolCallIds.has(result.callId)
        );
        const onlyControlToolsThisRound = controlToolResults.length > 0
            && failureAccountingResults.length === 0;
        const idempotentControlNoOps = controlToolResults.filter((result) => (
            isIdempotentHarnessControlNoOpResult(result.output)
        ));
        const controlRoundMadeNoProgress = onlyControlToolsThisRound
            && controlToolResults.every((result) => (
                !result.success || isIdempotentHarnessControlNoOpResult(result.output)
            ));
        if (controlRoundMadeNoProgress) {
            // 与 consecutiveFailedToolRounds 同一条豁免：Harness 主动介入的修复是有界重试
            // （自己会在预算内收尾），不能被这个通用出口抢先掐断。幂等 no-op 不受该豁免：
            // 已激活能力无法靠同一请求变得“更激活”，继续放行只会重复成功空转。
            if (!options.suppressConsecutiveFailedRound || idempotentControlNoOps.length > 0) {
                this.consecutiveControlToolNoProgressRounds += 1;
            }
        } else if (controlToolResults.some((result) => (
            result.success && !isIdempotentHarnessControlNoOpResult(result.output)
        )) || anySuccessfulTool) {
            this.consecutiveControlToolNoProgressRounds = 0;
        }

        if (this.consecutiveControlToolNoProgressRounds >= CONSECUTIVE_CONTROL_TOOL_NO_PROGRESS_ROUND_LIMIT) {
            const stuckControlTools = Array.from(new Set(
                toolCalls
                    .filter((call) => isAgentHarnessControlTool(call.name))
                    .map((call) => call.name)
            ));
            const reasons = stuckControlTools
                .map((toolName) => {
                    const reason = this.lastToolFailureReasonByName.get(toolName);
                    return reason ? `${toolName}：${reason}` : '';
                })
                .filter(Boolean);
            const repeatedIdempotentNoOp = idempotentControlNoOps.length > 0;
            return [
                repeatedIdempotentNoOp
                    ? '任务准备阶段反复请求已经可用的能力，已停止以避免空转。'
                    : '任务准备阶段反复没有通过校验，已停止以避免空转。',
                `连续 ${this.consecutiveControlToolNoProgressRounds} 轮只在重复没有改变运行状态的准备动作。`,
                ...(repeatedIdempotentNoOp
                    ? ['所需能力已经激活；下一步应调用具体动作，而不是再次请求同一能力。']
                    : []),
                ...reasons.slice(0, 2),
                `已处理 ${this.toolCallLog.length} 步。`
            ].filter(Boolean).join('\n');
        }

        const exhaustedToolName = toolCalls.find((call) => {
            if (isAgentHarnessControlTool(call.name)) return false;
            const result = toolResults.find((item) => item.callId === call.id);
            return result?.success === false
                && (this.consecutiveToolFailuresByName.get(call.name) || 0) >= CONSECUTIVE_SAME_TOOL_FAILURE_LIMIT;
        })?.name;
        if (exhaustedToolName) {
            return [
                '这稿还没有做出来。',
                '同一种方案连续几次没有通过完整性检查，我已停止继续尝试；这是设计助手需要重新整理的问题，不需要你填写技术参数。',
                this.buildLastToolSummary()
            ].filter(Boolean).join('\n');
        }

        if (this.repeatedToolBatchCount >= REPEATED_TOOL_BATCH_LIMIT) {
            return [
                '这稿还没有做出来。',
                '刚才的处理方式没有带来新结果，我已经停下，避免反复修改同一个地方。',
                this.buildLastToolSummary()
            ].filter(Boolean).join('\n');
        }

        if (this.consecutiveFailedToolRounds >= CONSECUTIVE_FAILED_TOOL_ROUND_LIMIT) {
            return [
                '这稿还没有做出来。',
                '连续几次调整都没有得到有效结果，我已经停下，避免继续消耗时间或误改画面。',
                this.buildLastToolSummary()
            ].filter(Boolean).join('\n');
        }

        return null;
    }

    private buildLastToolSummary(): string {
        const last = this.toolCallLog[this.toolCallLog.length - 1];
        if (!last) return '尚未开始处理。';

        const error = sanitizeUserVisibleDiagnosticText(compactError(last.result));
        return error ? `当前卡点：${error}` : '';
    }

    private buildMaxIterationsMessage(): string {
        return [
            '这稿这次没做完，先停一下。',
            this.buildLastToolSummary(),
            '你可以让我从没做完的地方接着做。'
        ].filter(Boolean).join('\n');
    }

    /**
     * 成品契约未达成时的补做引导。只针对「能在当前画布上继续补做」的明确缺失
     * （创意设计缺主视觉/文案）返回强制继续指令；其它契约或无法补救的失败返回 null，
     * 不强行拉回（避免对不可补救的失败死循环）。配合早停门禁让模型把成品补完整。
     */
    private buildContractRemediationDirective(): { directive: string; shortReason: string } | null {
        return buildDesignTaskContractRemediationDirective({
            task: this.currentTask,
            context: this.buildTaskCompletionContext(),
            toolCallLog: this.toolCallLog
        });
    }

    /**
     * 本轮是否已授权期待真实 Photoshop 交付（切片 1/2 共用授权口径，单一 owner）。
     * 只认结构化信号：write_photoshop 意图或结构化交付义务；不读用户文本、不猜品类。
     */
    private hasAuthorizedMutationExpectation(): boolean {
        const intentControlPlane = this.runIntentControlPlaneDecision;
        const writeAuthorized = Boolean(
            intentControlPlane
            && isConfirmedToolRequiredIntent(intentControlPlane)
            && intentControlPlane.toolScope === 'write_photoshop'
        );
        return writeAuthorized || requiresAgentTaskDeliveryProgress(this.config.agentTaskPlan);
    }

    /**
     * 执行供给预留（切片 2）：为「至少一次写入 + 同目标读回 + 评价」保留的尾部工具调用数。
     * 取固定上限与预算 20% 的较小值，预算未配置时为零（不设闸）。
     */
    private resolveExecutionSupplyReserve(): number {
        return resolveExecutionSupplyReserveFromLedger(this.config.performanceBudget);
    }

    private isInMutationExecutionReserveZone(): boolean {
        return isInMutationExecutionReserveZoneFromLedger({
            ledger: this.performanceLedger,
            budget: this.config.performanceBudget,
            authorizedMutationExpectation: this.hasAuthorizedMutationExpectation()
        });
    }

    /**
     * 零业务动作停话时的完成契约补救（治理切片 1：完成所有权前移）。
     *
     * 只有本轮已授权 Photoshop 写入（write_photoshop 意图或结构化交付义务），
     * 且完成契约仍要求真实设计动作时成立。聊天、只读分析、计划类请求不会命中——
     * 它们没有写入授权，或推断不出设计执行契约（inferTaskKind 对只读计划 /
     * 禁改表述 / 问答语用一律返回 null）。
     */
    private buildZeroProgressContractRemediationDirective(): { directive: string; shortReason: string } | null {
        if (!this.hasAuthorizedMutationExpectation()) {
            return null;
        }
        const directive = this.buildContractRemediationDirective();
        if (!directive) return null;
        const contract = buildTaskCompletionContract({
            task: this.currentTask,
            context: this.buildTaskCompletionContext(),
            toolCallLog: this.getTaskCompletionToolCallLog()
        });
        if (!contract || contract.status === 'completed') return null;
        if (contract.kind === 'creative_design') {
            const missingExecution = contract.required.some((item) => (
                item.id === 'creative-execution'
                && (item.status === 'failed' || item.status === 'needs_review')
            ));
            if (!missingExecution) return null;
        }
        return directive;
    }

    private buildTaskCompletionContext(): TaskCompletionContext {
        const base = this.config.taskCompletionContext || {};
        let referenceObservation: TaskCompletionReferenceObservation | undefined;
        if (this.attachedImageObservationAvailable && this.observedInputImageCount > 0) {
            referenceObservation = {
                version: 'task-completion-reference-observation/v1',
                observed: true,
                source: 'attached_image_observation',
                observationCount: this.observedInputImageCount
            };
        } else if (hasRuntimeReferenceVisualObservation(this.runtimeReferenceBriefDeclaration)) {
            referenceObservation = {
                version: 'task-completion-reference-observation/v1',
                observed: true,
                source: 'runtime_reference_brief',
                observationCount: Math.max(1, this.runtimeReferenceBriefDeclaration?.insights.length || 0)
            };
        } else {
            referenceObservation = base.referenceObservation;
        }
        return {
            ...base,
            ...(this.config.agentTaskPlan ? { agentTaskPlan: this.config.agentTaskPlan } : {}),
            ...(this.config.agenticArtifactContract
                ? { agenticArtifactContract: this.config.agenticArtifactContract }
                : {}),
            ...(referenceObservation ? { referenceObservation } : {})
        };
    }

    /**
     * 静默收尾补救：模型完成工具调用后给出空回复时，追加一轮纯文本总结请求
     * （不带工具），把已完成的工作整理成用户可读结论。失败/仍为空返回空串。
     */
    private async requestFinalSummaryAfterSilentStop(): Promise<string> {
        // 精简工具结果摘要（每条限长）而非塞回完整 this.messages：大工具结果叠加会
        // 撑爆部分模型（如 MiMo）的上下文，导致总结轮返回空 content（实测 C-1188
        // 设计方向任务：3 个大工具结果后模型沉默）。聚焦结果 + 结构化要求 + 重试更稳。
        const toolResultsSummary = this.toolCallLog.slice(-8).map((item) => {
            const ok = item.result?.success !== false;
            if (!ok) return `## ${item.name}（失败）\n${compactError(item.result)}`;
            const compact = JSON.stringify(this.buildModelToolObservationOutput(item.name, item.result) ?? {}).slice(0, 1000);
            return `## ${item.name}（成功）\n${compact}`;
        }).join('\n\n');

        const maxAttempts = 2;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            try {
                const response = await this.modelCallAccounting.callAgentProvider(
                    this.config.modelId,
                    [
                        { role: 'system', content: this.config.systemPrompt },
                        {
                            role: 'user',
                            content: [
                                `用户任务：${this.currentTask}`,
                                '',
                                '你已经通过以下工具收集到所需信息：',
                                toolResultsSummary,
                                '',
                                '现在请基于以上已收集的信息，用简体中文输出完整的最终结论与成果报告，覆盖用户要求的全部要点。',
                                '只输出面向用户的正文文本，不要调用任何工具，不要输出 JSON/XML，不要提到内部检查或工具名，不要留空。',
                                attempt > 0 ? '上一轮没有输出有效内容，请务必这次给出完整结论，不要沉默。' : ''
                            ].filter(Boolean).join('\n')
                        }
                    ],
                    [],
                    {
                        temperature: attempt > 0 ? 0.5 : 0.3,
                        maxTokens: Math.min(2600, this.resolvePrimaryTurnProviderMaxTokens()),
                        timeoutMs: AGENT_FINAL_SUMMARY_TIMEOUT_MS,
                        thinkingEnabled: this.resolveProviderThinkingEnabled()
                    },
                    {
                        callKind: 'silent_final_summary',
                        requestMode: 'non_stream',
                        agentIteration: this.iteration + 1
                    }
                );
                const text = sanitizeUserVisibleAgentText(readCompleteProviderTextContent(response).content).trim();
                if (text) return text;
            } catch (error: any) {
                console.warn(`[Agent] 静默收尾补救第 ${attempt + 1} 次失败：${error?.message || error}`);
            }
        }
        // 模型始终沉默但已有可验证产物时，从真实执行记录重建阶段报告。
        // 这不是声明设计质量通过，只把“已创建/已观察到的草稿”还给上层继续判断。
        return this.buildSummaryFromStatefulWrites()
            || buildObservedDesignDraftSummary(this.toolCallLog);
    }

    private shouldRequestRicherFinalSummary(message: string): boolean {
        return shouldRequestRicherFinalSummaryFromModule({
            message,
            hasTaskProgressToolCalls: this.hasTaskProgressToolCalls(),
            allowProviderThinking: this.config.performanceBudget?.allowProviderThinking,
            toolScope: this.config.toolDecisionContext?.intentControlPlane?.toolScope
        });
    }

    private async requestRicherFinalSummaryAfterToolRun(currentMessage: string): Promise<string> {
        const toolResultsSummary = this.toolCallLog.slice(-8).map((item) => {
            const ok = item.result?.success !== false;
            const compact = ok
                ? JSON.stringify(this.buildModelToolObservationOutput(item.name, item.result) ?? {}).slice(0, 1000)
                : compactError(item.result);
            return `## ${item.name}（${ok ? '成功' : '未完成'}）\n${compact}`;
        }).join('\n\n');

        try {
            const response = await this.modelCallAccounting.callAgentProvider(
                this.config.modelId,
                [
                    { role: 'system', content: this.config.systemPrompt },
                    {
                        role: 'user',
                        content: [
                            `用户任务：${this.currentTask}`,
                            '',
                            `模型刚才给出的结束语：${currentMessage || '（空）'}`,
                            '',
                            '这条结束语太薄，不能只说“完成”。请基于下面真实工具结果，重新输出面向用户的简短总结：',
                            toolResultsSummary,
                            '',
                            '要求：',
                            '1. 简体中文，2 到 4 句。',
                            '2. 说明做了什么、看到或复核到什么、是否还需要用户看一眼结果。',
                            '3. 不要输出 JSON/XML，不要提到内部工具名、状态码或调试内容。',
                            '4. 不能夸大质量；如果读取结果只能说明画面有变化，就说“还需要看最终视觉位置”。'
                        ].join('\n')
                    }
                ],
                [],
                {
                    temperature: 0.3,
                    maxTokens: Math.min(900, this.resolvePrimaryTurnProviderMaxTokens()),
                    timeoutMs: AGENT_FINAL_SUMMARY_TIMEOUT_MS,
                    thinkingEnabled: this.resolveProviderThinkingEnabled()
                },
                {
                    callKind: 'richer_final_summary',
                    requestMode: 'non_stream',
                    agentIteration: this.iteration + 1
                }
            );
            const text = sanitizeUserVisibleAgentText(readCompleteProviderTextContent(response).content).trim();
            return this.shouldRequestRicherFinalSummary(text) ? '' : text;
        } catch (error: any) {
            console.warn(`[Agent] 工具执行后总结补充失败：${error?.message || error}`);
            return '';
        }
    }

    /**
     * 模型把结构化成果写进 updateDesignProjectState 后沉默时，从其调用参数重建用户可读成果。
     * 不依赖模型再次发声，确保已产生的成果能展示。纯逻辑在 final-summary.ts。
     */
    private buildSummaryFromStatefulWrites(): string {
        return buildSummaryFromStatefulWritesFromModule(this.toolCallLog);
    }

    private buildToolResultFallbackMessage(): string {
        return buildToolResultFallbackMessageFromModule({
            toolCallLog: this.toolCallLog
        });
    }

    private readOutputPathFromToolResult(result: any): string {
        return readOutputPathFromToolResultFromModule(result);
    }

    private async buildEmptyFinalResponseResult(iterations = this.iteration + 1): Promise<AgentRunResult> {
        return this.buildRunResult({
            success: false,
            message: this.buildToolResultFallbackMessage()
                || this.buildSummaryFromStatefulWrites()
                || '已保留本轮真实处理记录。',
            iterations,
            error: 'Empty final response',
            stopReason: 'empty_final_response'
        });
    }

    private readActionableRequiredEvaluationCheckKeys(summary: AgentExecutionSummary): string[] {
        const profile = this.resolveRuntimeEvaluationProfile();
        const reconciliation = this.reconcileRuntimeActionPlanExecution();
        const reconciliationDigest = summary.runtimeActionPlanReconciliationDigest;
        return readActionableRequiredEvaluationCheckKeys({
            summary,
            profile,
            reconciliationStatus: reconciliation?.status || reconciliationDigest?.status,
            resumeStepIds: reconciliation?.resumeStepIds || reconciliationDigest?.resumeStepIds || []
        });
    }

    private isActionableVlmDiagnosisForLatestReviewSet(result: DesignAssertionResult): boolean {
        if (!isActionableReliableVlmDiagnosisResult(result)) return false;
        const evaluationProfile = this.resolveRuntimeEvaluationProfile();
        const reviewSet = this.findLatestDesignVisualJudgeReviewSet(
            this.resolveFinalReviewSetRequirements(evaluationProfile).requireMultiSurface
        )?.reviewSet;
        if (!reviewSet) return false;
        // 单画布只有一个合法目标，可把全局诊断确定性绑定到该画布；多屏必须由 Judge
        // 原样返回 sourceId / observationKey，不能靠“第七屏附近”等自然语言猜目标。
        if (reviewSet.items.length === 1) return true;
        return Boolean(resolveDesignReviewSetItemForDiagnosis(
            reviewSet,
            result.diagnosis?.visualFinding.target
        ));
    }

    private filterScorecardToActionableReviewTargets(scorecard: DesignScorecard): DesignScorecard {
        const isActionable = (result: DesignAssertionResult): boolean => (
            this.isActionableVlmDiagnosisForLatestReviewSet(result)
        );
        return {
            ...scorecard,
            blockers: scorecard.blockers.filter(isActionable),
            failedAssertions: scorecard.failedAssertions.filter(isActionable),
            needsReview: scorecard.needsReview.filter(isActionable),
            results: scorecard.results.filter(isActionable)
        };
    }

    private buildQualityGateReflexionHandoff(
        summary: AgentExecutionSummary,
        deliveryEvidencePassed: boolean
    ): ReflexionHandoff | undefined {
        const actionableRequiredCheckKeys = this.readActionableRequiredEvaluationCheckKeys(summary);
        const hasActionableRequiredProfileIssue = actionableRequiredCheckKeys.length > 0;
        // 旧的“写后零观察”本身仍不能重放原任务；但 Manifest Profile 已明确指出缺少必需
        // 写后结构/全图复核时，Runtime 可以只回到对应核验阶段补读，而不是把成果永久停住。
        if (summary.downgradedByObservationGate && !hasActionableRequiredProfileIssue) {
            return undefined;
        }
        // R0 已声明必须执行、E1 却连续零工具，是计划/执行所有权不一致，不是产物质量问题。
        // 质量 Reflexion 无权重新规划原任务；应保留失败事实并交还 planning owner。
        if (summary.stopReason === 'plan_execution_mismatch') {
            return undefined;
        }
        // A resource ceiling is a terminal cost boundary, not an invitation to buy another
        // generation. Preserve the unfinished result for the user, but never manufacture a
        // quality handoff that could restart the same task with a fresh budget.
        if (['performance_budget', 'tool_budget_final_response', 'max_iterations'].includes(
            String(summary.stopReason || '').trim()
        )) {
            return undefined;
        }
        // Reflexion 是 R5 质量复核的输出，不是任意阶段失败的通用重试包装。
        // R1-R4 / E1 尚未完成时保留 live stage，由同一 ReAct 循环继续；不得伪造一次 R5 评价
        // 再让外层重启整条任务，否则会丢失阶段身份并重复读取或写入。
        if (this.config.runtimeStagePlan
            && this.runtimeSession?.stageState.currentStage !== 'R5') {
            return undefined;
        }
        const hasActionableVlmDiagnosis = Boolean(summary.designScorecard?.results.some((result) => (
            this.isActionableVlmDiagnosisForLatestReviewSet(result)
        )));
        const evaluationProfile = this.resolveRuntimeEvaluationProfile();
        const expectedVlmAssertions = evaluationProfile
            ? getDesignEvaluationProfileVlmAssertions(evaluationProfile)
            : getVlmJudgeAssertions();
        const scorecardVlmResults = summary.designScorecard?.results.filter((result) => (
            result.method === 'vlm_judge'
        )) || [];
        const activeVisualReview = this.findLatestDesignVisualJudgeReviewSet(
            this.resolveFinalReviewSetRequirements(evaluationProfile).requireMultiSurface
        );
        const visualHistoryStateRef = activeVisualReview?.historyStateRef;
        const closedQualityHistoryStateRef = this.readLatestClosedQualityHistoryStateRef();
        const runtimeDeliveryStageRequired = Boolean(
            this.config.runtimeStagePlan?.steps.some((step) => step.stage === 'E2')
        );
        const completedAestheticImprovementEligible = isCompletedAestheticImprovementEligible({
            summary,
            reviewedRevisionMatches: Boolean(visualHistoryStateRef && closedQualityHistoryStateRef
                && samePhotoshopHistoryStateRef(visualHistoryStateRef, closedQualityHistoryStateRef)),
            reliableJudgeComplete: isReliableVlmJudgeBatchComplete(scorecardVlmResults, expectedVlmAssertions),
            hasActionableVlmDiagnosis,
            hasActionableRequiredProfileIssue,
            runtimeDeliveryStageRequired,
            deliveryEvidencePassed
        });
        // 取消/停在用户确认点不做 Reflexion。事实交付已 completed 通常也应收尾；但可靠终局 VLM
        // 已给出合法三层诊断时，completed 只证明交付事实闭合，不等于审美已经做好。此处仅生成
        // R4 审美观察；外层可在同一授权 TaskRun 内唤醒 Agent 一次，让 Agent 自主决定是否和如何
        // 调整，但观察本身不是写入/保存权限，也不能由 Harness 直接执行修改。
        if ((summary.status === 'completed' && !completedAestheticImprovementEligible)
            || summary.status === 'cancelled'
            || summary.status === 'awaiting_confirmation') {
            return undefined;
        }
        // 只有 warning、没有 blocker 的 needs_review 是“保留现有成果并等待复核”，不是失败返工。
        // 即使可靠 VLM 给出了合法三层诊断，它也只证明存在审美改进空间，不能把已交付版本升级成
        // “重放原任务”的失败恢复授权。Profile 只描述“缺什么”，不能签发恢复路线；只有已声明
        // 计划未闭合或写后观察门禁留下的明确补证动作可例外续跑。
        // 外层重入会创建新 Agent 且不会继承上一轮工具日志；此时重放原任务既不能补齐读取结果，
        // 还可能重复写入并用后续失败覆盖首轮成功结果。
        if (shouldStopWarningOnlyNeedsReviewReflexion({
            status: summary.status,
            blockers: summary.blockers,
            hasActionableVlmDiagnosis,
            hasActionableRequiredProfileIssue,
            completedAestheticImprovementEligible
        })) {
            return undefined;
        }

        // 有 runtimeLoopContract 时走 manifest 感知的质量门禁（电商详情页/主图等）
        // 没有时走通用 Reflexion：基于工具调用结果和失败状态生成 handoff，
        // 让非电商任务（如"修改文字+导出"）也能触发 Reflexion 重跑。
        const aestheticReflexion = hasActionableVlmDiagnosis && summary.designScorecard
            ? buildDesignReflexionConstraints(
                this.filterScorecardToActionableReviewTargets(summary.designScorecard), {
                onlyActionableReliableDiagnoses: true
                }
            )
            : undefined;
        const actionableProfileIssues = actionableRequiredCheckKeys.map((key) => (
            describeActionableRequiredEvaluationCheck(key, evaluationProfile)
        ));
        const inferredTargetStage = inferTerminalReflexionTargetStage({
            hasTaskProgress: this.hasTaskProgressToolCalls(),
            summary,
            actionableRequiredCheckKeys,
            profile: evaluationProfile
        });
        const hasOperationalFailure = inferredTargetStage === 'R0'
            || inferredTargetStage === 'E1';
        const targetStage = hasActionableVlmDiagnosis && !hasOperationalFailure
            ? 'R4'
            : inferredTargetStage;
        const activeReviewSet = activeVisualReview?.reviewSet;
        const actionableAestheticIssues = buildDesignQualityReflexionIssues(
            (summary.designScorecard?.results || [])
                .filter((result) => this.isActionableVlmDiagnosisForLatestReviewSet(result)),
            activeReviewSet
        );
        // completed aesthetic improvement 只把同一 reviewSet/history 上的可靠三层 diagnosis
        // 交回 Agent。summary.warnings 已由同一结果再次投影，继续拼入会把 2 个问题扩成
        // 4 条重复且更命令式的约束。其它失败/待复核路径仍保留原 warning 语义。
        const reflexionSummaryWarningIssues = completedAestheticImprovementEligible
            && actionableAestheticIssues.length > 0
            ? []
            : summary.warnings.map((item) => ({
                description: String(item || '').trim(),
                expectedFix: `下一轮需要复核：${item}`,
                blocker: false
            }));
        const issueRecords = [
            ...(!hasOperationalFailure ? actionableAestheticIssues : []),
            ...summary.blockers.map((item) => ({
                description: String(item || '').trim(),
                expectedFix: `下一轮必须处理：${item}`,
                blocker: true
            })),
            ...(hasActionableRequiredProfileIssue
                ? actionableProfileIssues.map((item) => ({
                    description: item,
                    expectedFix: `下一轮必须处理：${item}`,
                    blocker: false
                }))
                : reflexionSummaryWarningIssues)
        ].filter((item) => Boolean(item.description));
        if (issueRecords.length === 0) {
            issueRecords.push({
                description: '本轮最终复核未通过，不能确认任务完成。',
                expectedFix: '下一轮必须补齐可验证结果，再重新复核。',
                blocker: false
            });
        }
        const requiredFixes = issueRecords.map((item) => item.expectedFix);
        const suggestedFixes = [
            ...(hasOperationalFailure
                ? actionableAestheticIssues.map((item) => `操作问题闭合后再处理：${item.expectedFix}`)
                : []),
            ...(aestheticReflexion?.strategyAdjustments || [])
        ];

        const reflexionHandoff = buildReflexionHandoffFromReviewReport({
            payload: {
                qualityPassed: false,
                gateStatus: 'failed',
                issues: issueRecords.map((issue, index) => ({
                    issueId: `agent-runtime-quality-${index + 1}`,
                    severity: issue.blocker ? 'blocker' : 'major',
                    owner: targetStage,
                    description: issue.description,
                    expectedFix: issue.expectedFix,
                    ...('sourceId' in issue && issue.sourceId ? { sourceId: issue.sourceId } : {}),
                    ...('observationKey' in issue && issue.observationKey ? { observationKey: issue.observationKey } : {})
                })),
                requiredFixes,
                suggestedFixes,
                rollbackTarget: {
                    runtimeUnit: targetStage,
                    reason: this.describeReflexionRollbackReason(summary)
                }
            }
        });
        const boundReflexionHandoff = bindReflexionHandoffReviewEvidence({
            handoff: reflexionHandoff, historyStateRef: visualHistoryStateRef,
            observationKeys: activeReviewSet?.items.map((item) => item.observationKey)
        });
        if (!completedAestheticImprovementEligible) return boundReflexionHandoff || reflexionHandoff;
        // completed 自动返工必须带 ReviewSet provenance，description 文本不能冒充版本事实。
        if (!boundReflexionHandoff) return undefined;
        return {
            ...boundReflexionHandoff,
            trigger: COMPLETED_AESTHETIC_IMPROVEMENT_TRIGGER
        };
    }

    private describeReflexionRollbackReason(summary: AgentExecutionSummary): string {
        if (summary.blockers[0]) return summary.blockers[0];
        if (summary.warnings[0]) return summary.warnings[0];
        return `最终复核状态为 ${summary.status}，需要带着约束重新处理。`;
    }

    private buildRuntimeResultData(
        existingData: Record<string, unknown> | undefined,
        reflexionHandoff: ReflexionHandoff | undefined,
        runtimeStageState: AgentExecutionSummary['runtimeStageState'],
        runtimeStageTrace: RuntimeStageTrace | undefined,
        runtimeDesignBriefDeclaration: RuntimeDesignBriefDeclaration | undefined,
        runtimeReferenceBriefDeclaration: RuntimeReferenceBriefDeclaration | undefined,
        runtimeDesignStrategyDeclaration: RuntimeDesignStrategyDeclaration | undefined,
        runtimeActionPlanDeclaration: RuntimeActionPlanDeclaration | undefined,
        runtimeActionPlanReconciliation: RuntimeActionPlanReconciliation | undefined,
        runtimeActionPlanNoRedoShadow: RuntimeActionPlanNoRedoShadowDecision | undefined,
        runtimeTaskSnapshot: ReadableRuntimeTaskSnapshot | undefined
    ): Record<string, unknown> | undefined {
        const data: Record<string, unknown> = { ...(existingData || {}) };
        // Snapshot / Repository 投影只能由 Harness owner 回填；普通 result.data 不得夹带。
        delete data.runtimeTaskSnapshot;
        delete data.artifactRepositoryReadProjection;
        delete data.finalDeliveryArtifactRequestId;
        delete data.finalDeliveryArtifactPaths;
        const contract = this.config.runtimeLoopContract;
        if (contract) {
            data.runtimeLoopContract = {
                version: contract.version,
                skillId: contract.r0.skillId,
                taskType: contract.r0.taskType,
                phases: contract.reactLoop.phases.map((phase) => phase.phase),
                qualityGateFailTarget: contract.qualityGate.failTarget
            };
        }
        if (this.config.runtimeStagePlan) {
            const effectiveContract = this.resolveRuntimeDesignBriefEffectiveContract(
                runtimeDesignBriefDeclaration
            );
            data.runtimeStagePlan = {
                version: this.config.runtimeStagePlan.version,
                skillId: this.config.runtimeStagePlan.skillId,
                taskType: this.config.runtimeStagePlan.taskType,
                requiredInputs: effectiveContract?.requiredInputs || this.config.runtimeStagePlan.requiredInputs,
                optionalInputs: effectiveContract?.optionalInputs || this.config.runtimeStagePlan.optionalInputs,
                deliveryOutputs: effectiveContract?.deliveryOutputs || this.config.runtimeStagePlan.deliveryOutputs,
                contractSource: effectiveContract?.source || 'manifest-default',
                ...(effectiveContract?.workMode ? { workMode: effectiveContract.workMode } : {}),
                ...(this.config.runtimeStagePlan.referencePolicy
                    ? { referencePolicy: this.config.runtimeStagePlan.referencePolicy }
                    : {}),
                stages: this.config.runtimeStagePlan.steps.map((step) => step.stage),
                exitCriteria: effectiveContract?.exitCriteria || this.config.runtimeStagePlan.exitCriteria
            };
        }
        if (this.config.toolCapabilityBridge) {
            data.toolCapabilityBridge = this.config.toolCapabilityBridge;
        }
        if (reflexionHandoff) {
            data.reflexionHandoff = reflexionHandoff;
        }
        if (reflexionHandoff && this.runtimeSession) {
            const runtimeEvolutionIntake = buildRuntimeEvolutionIntake({
                sessionId: this.runtimeSession.identity.sessionId,
                runId: this.runtimeSession.identity.runId,
                generation: this.runtimeSession.identity.generation,
                skillId: this.runtimeSession.skillId,
                taskType: this.runtimeSession.taskType,
                traceEventCount: this.runtimeSession.stageTrace.events.length,
                reflexionHandoff
            });
            if (runtimeEvolutionIntake) {
                data.runtimeEvolutionIntake = runtimeEvolutionIntake;
            }
        }
        if (runtimeStageState) {
            data.runtimeStageState = runtimeStageState;
        }
        if (runtimeStageTrace) {
            data.runtimeStageTrace = runtimeStageTrace;
        }
        if (this.runtimeSession && this.config.runtimeStagePlan) {
            data.runtimeSession = this.runtimeSession;
            data.runtimeSessionDigest = buildRuntimeSessionDigest({
                session: this.runtimeSession,
                plan: this.config.runtimeStagePlan
            });
        }
        if (this.runtimePlanningContextSeedDigest) {
            data.runtimePlanningContextSeedDigest = this.runtimePlanningContextSeedDigest;
        }
        if (runtimeDesignBriefDeclaration) {
            data.runtimeDesignBriefDeclaration = runtimeDesignBriefDeclaration;
        }
        if (runtimeReferenceBriefDeclaration) {
            data.runtimeReferenceBriefDeclaration = runtimeReferenceBriefDeclaration;
        }
        if (runtimeDesignStrategyDeclaration) {
            data.runtimeDesignStrategyDeclaration = runtimeDesignStrategyDeclaration;
        }
        if (runtimeActionPlanDeclaration) {
            data.runtimeActionPlanDeclaration = runtimeActionPlanDeclaration;
        }
        attachRuntimeInteractiveCheckpointState({ data, actionPlanExecutionJournal: this.runtimeActionPlanExecutionJournal, workflowContinuationScope: this.readActiveWorkflowContinuationScope() });
        if (runtimeActionPlanReconciliation) {
            data.runtimeActionPlanReconciliation = runtimeActionPlanReconciliation;
        }
        if (runtimeActionPlanNoRedoShadow) {
            data.runtimeActionPlanNoRedoShadow = runtimeActionPlanNoRedoShadow;
        }
        if (runtimeTaskSnapshot) {
            data.runtimeTaskSnapshot = runtimeTaskSnapshot;
        }
        return Object.keys(data).length ? data : undefined;
    }
    private async prepareAgentTerminalClosure(
        input: AgentRunResultInput
    ): Promise<PreparedAgentTerminalClosure> {
        // 所有提前返回都汇聚到这里；用单调快照补记本轮，避免 no-progress、预检阻断
        // 等终态少算最后一次迭代，下一 generation 又重新获得这笔额度。
        this.advancePerformanceIteration(input.iterations);
        // 每次 closure 先撤销上一轮摘要；只有本轮新评审或 exact revision 复验才能恢复它。
        this.finalQualityModelProtocolDigest = undefined;
        let vlmAssertions: DesignAssertionResult[] | null = null;
        if (!input.cancelled) {
            const qualityReuseResult = await reuseCachedTerminalClosureQuality({
                cache: this.terminalClosureQualityCache,
                stopReason: input.stopReason,
                latestMutationIndex: findLatestObservedPhotoshopMutationIndex(this.toolCallLog),
                readCurrentHistoryStateRef: () => (
                    this.readCurrentPhotoshopHistoryStateRefForQualityVerification('final_summary')
                ),
                readReviewHistoryStateRef: () => {
                    const profile = this.resolveRuntimeEvaluationProfile();
                    return this.findLatestDesignVisualJudgeReviewSet(
                        this.resolveFinalReviewSetRequirements(profile).requireMultiSurface
                    )?.historyStateRef;
                }
            });
            this.terminalClosureQualityCache = qualityReuseResult.cache;
            const qualityReuse = qualityReuseResult.reuse;
            if (qualityReuse.status === 'not_available') {
                try {
                    vlmAssertions = await this.evaluateDesignQualityVlmAssertions(input.stopReason);
                } catch (error) {
                    this.recordFinalQualityEvaluationInterruption(error instanceof Error ? error.message : String(error));
                }
            } else if (qualityReuse.status === 'reused') {
                vlmAssertions = qualityReuse.vlmAssertions;
                this.finalQualityModelProtocolDigest = qualityReuse.protocolDigest;
            } else if (qualityReuse.status === 'stale') {
                this.recordFinalQualityEvaluationInterruption('交付复入期间 Photoshop 当前版本与已评价版本不一致。', true);
            } else {
                this.recordFinalQualityEvaluationInterruption('交付复入期间无法读取 Photoshop 当前版本。');
            }
            if (this.shouldCloseDesignQualityHistoryState(input.stopReason)
                && qualityReuse.status !== 'unavailable'
                && !this.readLatestClosedQualityHistoryStateRef()) {
                try {
                    await this.readCurrentPhotoshopHistoryStateRefForQualityVerification('final_summary');
                } catch {
                    // Host 收尾读取失败时由质量摘要 fail closed；诊断读取本身不能阻断任务结果。
                }
            }
        }
        const executionSummary = this.buildExecutionSummary(input.stopReason, input.iterations, vlmAssertions);
        const deliveryStageEvidence = this.projectDeliveryStageEvidence(executionSummary);
        const runtimeDeliveryVerification = deliveryStageEvidence.verification;
        if (deliveryStageEvidence.finalDeliveryResultRefs?.length) {
            executionSummary.runtimeDeliveryResultRefs = Array.from(new Set(
                deliveryStageEvidence.finalDeliveryResultRefs
                    .map((value) => String(value || '').trim())
                    .filter(Boolean)
            ));
        }
        const reflexionHandoff = input.reflexionHandoff
            || this.buildQualityGateReflexionHandoff(
                executionSummary,
                deliveryStageEvidence.deliveryEvidencePassed
            )
            || buildDeliveryStageReflexionHandoff({
                summary: executionSummary,
                verification: runtimeDeliveryVerification,
                runtimeDeliveryStageRequired: Boolean(
                    this.config.runtimeStagePlan?.steps.some((step) => step.stage === 'E2')
                )
            });
        return {
            executionSummary,
            deliveryStageEvidence,
            ...(runtimeDeliveryVerification ? { runtimeDeliveryVerification } : {}),
            ...(reflexionHandoff ? { reflexionHandoff } : {}),
            vlmAssertions
        };
    }

    private async buildRunResult(
        input: AgentRunResultInput,
        preparedClosure?: PreparedAgentTerminalClosure
    ): Promise<AgentRunResult> {
        const closure = guardTerminalRecoveryEarlyExit({
            preparedClosure: preparedClosure || await this.prepareAgentTerminalClosure(input),
            gap: this.lastTerminalClosureGap,
            recoveryAttempts: this.terminalClosureRecoveryAttempts,
            stopReason: input.stopReason,
            preparedByNaturalCheckpoint: Boolean(preparedClosure)
        });
        const executionSummary = closure.executionSummary;
        const runtimeDeliveryVerification = closure.runtimeDeliveryVerification;
        const reflexionHandoff = closure.reflexionHandoff;
        if (closure.deliveryStageEvidence.stageTraceEvent) {
            this.appendStageTraceEvent(closure.deliveryStageEvidence.stageTraceEvent);
        }
        if (reflexionHandoff) {
            executionSummary.reflexionHandoff = reflexionHandoff;
            const handoffStep = projectReflexionHandoffStep({ handoff: reflexionHandoff, iteration: this.iteration + 1, maxIterations: this.config.maxIterations });
            if (handoffStep) this.emitStep(handoffStep);
        }
        // Judge、最终 history 复核和摘要构建都发生在入口 checkpoint 之后；在收尾前
        // 同步一次累计性能用量。plan-neutral 写入 unbound ledger，staged 写入 Session ledger。
        this.synchronizeRuntimePerformanceUsage();
        if (this.config.runtimeStagePlan && this.runtimeSession) {
            this.runtimeSession = finalizeRuntimeSession({
                plan: this.config.runtimeStagePlan,
                session: this.runtimeSession,
                executionSummary,
                ...(reflexionHandoff ? { reflexionHandoff } : {})
            });
        }
        const runtimeStageState = this.runtimeSession?.stageState;
        const runtimeStageTrace = this.runtimeSession?.stageTrace;
        if (runtimeStageState) {
            executionSummary.runtimeStageState = runtimeStageState;
            if (this.config.runtimeStagePlan && this.runtimeSession) {
                const runtimeSessionDigest = buildRuntimeSessionDigest({
                    plan: this.config.runtimeStagePlan,
                    session: this.runtimeSession
                });
                executionSummary.runtimeSessionDigest = runtimeSessionDigest;
                if (this.runtimePlanningContextSeedDigest) {
                    executionSummary.runtimePlanningContextSeedDigest = this.runtimePlanningContextSeedDigest;
                }
                executionSummary.runtimeStageTraceDigest = buildRuntimeStageTraceDigest({
                    plan: this.config.runtimeStagePlan,
                    trace: this.runtimeSession.stageTrace,
                    state: runtimeStageState,
                    transitionSequenceFloor: this.runtimeSession.generationStartTransitionCount
                });
            }
            const completionProjection = projectRuntimeSessionCompletion({
                executionStatus: executionSummary.status,
                stageState: runtimeStageState,
                sideEffectState: this.runtimeSession?.taskRun.sideEffectState?.status,
                ...(reflexionHandoff ? { reflexionHandoff } : {})
            });
            executionSummary.status = completionProjection.status;
            if (completionProjection.blocker) {
                executionSummary.blockers = Array.from(new Set([
                    ...executionSummary.blockers,
                    completionProjection.blocker
                ]));
            }
            if (completionProjection.summaryText) {
                executionSummary.summaryText = completionProjection.summaryText;
            }
        }
        if (!this.runtimeSession) {
            executionSummary.runtimeAccountingDigest = this.runtimeAccounting.readDigest();
        }
        const runtimeDesignBriefEffectiveContract = this.resolveRuntimeDesignBriefEffectiveContract();
        const runtimeDesignBriefDigest = this.runtimeDesignBriefDeclaration
            ? buildRuntimeDesignBriefDigest({
                declaration: this.runtimeDesignBriefDeclaration,
                requiredInputKeys: runtimeDesignBriefEffectiveContract?.requiredInputs || []
            })
            : undefined;
        if (runtimeDesignBriefDigest) {
            executionSummary.runtimeDesignBriefDigest = runtimeDesignBriefDigest;
        }
        const runtimeReferenceBriefDigest = this.runtimeReferenceBriefDeclaration
            ? buildRuntimeReferenceBriefDigest({
                declaration: this.runtimeReferenceBriefDeclaration,
                context: this.buildReferenceContextState()
            })
            : undefined;
        if (runtimeReferenceBriefDigest) {
            executionSummary.runtimeReferenceBriefDigest = runtimeReferenceBriefDigest;
        }
        const runtimeDesignStrategyDigest = this.runtimeDesignStrategyDeclaration
            ? buildRuntimeDesignStrategyDigest(this.runtimeDesignStrategyDeclaration)
            : undefined;
        if (runtimeDesignStrategyDigest) {
            executionSummary.runtimeDesignStrategyDigest = runtimeDesignStrategyDigest;
        }
        let runtimeActionPlanReconciliation: RuntimeActionPlanReconciliation | undefined;
        let runtimeActionPlanNoRedoShadow: RuntimeActionPlanNoRedoShadowDecision | undefined;
        if (this.runtimeActionPlanDeclaration && runtimeDesignStrategyDigest) {
            const actionPlanRuntime = await this.loadRuntimeActionPlanModule();
            executionSummary.runtimeActionPlanDigest = actionPlanRuntime.buildRuntimeActionPlanDigest({
                declaration: this.runtimeActionPlanDeclaration,
                strategyDigest: runtimeDesignStrategyDigest
            });
            if (this.runtimeActionPlanExecutionJournal) {
                runtimeActionPlanReconciliation = actionPlanRuntime.reconcileRuntimeActionPlanExecution({
                    declaration: this.runtimeActionPlanDeclaration,
                    journal: this.runtimeActionPlanExecutionJournal
                });
                executionSummary.runtimeActionPlanReconciliationDigest = (
                    actionPlanRuntime.buildRuntimeActionPlanReconciliationDigest(
                        runtimeActionPlanReconciliation
                    )
                );
            }
            if (this.config.runtimeActionPlanResumeFreshness) {
                runtimeActionPlanNoRedoShadow = actionPlanRuntime.buildRuntimeActionPlanNoRedoShadowDecision({
                    freshness: this.config.runtimeActionPlanResumeFreshness,
                    declaration: this.runtimeActionPlanDeclaration,
                    reconciliation: runtimeActionPlanReconciliation
                });
                executionSummary.runtimeActionPlanNoRedoShadowDigest = (
                    actionPlanRuntime.buildRuntimeActionPlanNoRedoShadowDigest(
                        runtimeActionPlanNoRedoShadow
                    )
                );
            }
        }
        const baseRuntimeTaskSnapshot = this.buildRuntimeTaskSnapshot(
            runtimeActionPlanReconciliation,
            executionSummary,
            runtimeDeliveryVerification
        );
        let runtimeTaskSnapshot: ReadableRuntimeTaskSnapshot | undefined = baseRuntimeTaskSnapshot;
        if (baseRuntimeTaskSnapshot && this.runtimeSession && this.config.finalizeRuntimeArtifacts) {
            try {
                const artifactProjection = await this.config.finalizeRuntimeArtifacts({
                    runtimeSession: this.runtimeSession,
                    ...(this.runtimeDesignBriefDeclaration
                        ? { runtimeDesignBriefDeclaration: this.runtimeDesignBriefDeclaration }
                        : {}),
                    ...(this.runtimeDesignStrategyDeclaration
                        ? { runtimeDesignStrategyDeclaration: this.runtimeDesignStrategyDeclaration }
                        : {}),
                    ...(this.runtimeActionPlanDeclaration
                        ? { runtimeActionPlanDeclaration: this.runtimeActionPlanDeclaration }
                        : {}),
                    ...(executionSummary.designVerdict
                        ? { designVerdict: executionSummary.designVerdict }
                        : {}),
                    ...(runtimeDeliveryVerification ? { runtimeDeliveryVerification } : {})
                });
                if (artifactProjection) {
                    runtimeTaskSnapshot = attachArtifactRepositoryProjectionToRuntimeTaskSnapshot(
                        baseRuntimeTaskSnapshot,
                        artifactProjection
                    ) || baseRuntimeTaskSnapshot;
                }
            } catch (error) {
                console.warn('[Agent] Artifact Repository 收尾失败，本轮保留未连接 Snapshot：', error);
            }
        }
        const resultData = this.buildRuntimeResultData(
            input.data,
            reflexionHandoff,
            runtimeStageState,
            runtimeStageTrace,
            this.runtimeDesignBriefDeclaration,
            this.runtimeReferenceBriefDeclaration,
            this.runtimeDesignStrategyDeclaration,
            this.runtimeActionPlanDeclaration,
            runtimeActionPlanReconciliation,
            runtimeActionPlanNoRedoShadow,
            runtimeTaskSnapshot
        );
        // 卡片确认与自然语言追问都是正常暂停，但二者不能混为同一展示通道：
        // 前者依赖交互卡恢复，后者必须保留 Agent 已经问出的真实问题正文。
        const awaitingInteractiveConfirmation = input.stopReason === 'awaiting_user_confirmation';
        const awaitingUserInput = input.stopReason === 'awaiting_user_input';
        const awaitingUserResponse = awaitingInteractiveConfirmation || awaitingUserInput;
        // 任务卡是工作笔记；未同步只进 Debug，不能否决已经闭合的 canonical completion。
        const engagedTaskCardThisRun = this.toolCallLog.some((entry) => /^(planDesignTaskCard|updateDesignTaskCard|getDesignTaskCard)$/.test(String(entry.name || '')));
        if (executionSummary.status === 'completed' && !awaitingUserResponse && engagedTaskCardThisRun) {
            try {
                const cardStore = await import('../design-workshop/design-task-card.store');
                const activeCard = cardStore.getActiveDesignTaskCard(this.config.taskCardScope || '');
                if (activeCard) {
                    const completion = deriveDesignTaskCompletion(activeCard);
                    if (!completion.complete) {
                        this.emitStep({
                            kind: 'observation',
                            title: '任务卡状态未同步',
                            detail: completion.summary,
                            status: 'running',
                            iteration: input.iterations,
                            maxIterations: this.config.maxIterations,
                            issue: 'task_card_projection_stale',
                            source: 'agent_runtime',
                            audience: 'debug'
                        });
                    }
                }
            } catch {
                // 任务卡账本不可用时不影响收尾
            }
        }
        // 工具预算只表示不能再请求新 Tool，不代表任务一定没完成。若结构化完成契约、
        // 最终质量裁决和当前证据已经把任务闭合，最终说明生成失败不能把真实交付降成
        // false negative；正文可由现有收据生成中性摘要。其它非终态错误仍不得升级。
        const verifiedForcedFinalCompletion = (input.stopReason === 'tool_budget_final_response'
            || input.stopReason === 'performance_budget'
            || input.stopReason === 'empty_final_response')
            && executionSummary.status === 'completed';
        const success = (input.success || verifiedForcedFinalCompletion)
            && (executionSummary.status === 'completed' || awaitingUserResponse);
        // 停在确认点时不再补一条结果步骤：上一步已经发过"等待你确认"，重复收尾会遮住真正的交互卡。
        //
        // 同理，本轮一个业务动作都没有时不发"已完成"验收结论：验收的对象是本轮做出的设计动作，
        // 没有动作就没有可验收的东西。真机 2026-08-04：用户只发了一句"在不"，模型只是反问一句就收尾，
        // 过程区却出现"任务验收结论：已完成：这稿做好了"——用户没提任何稿子，这条结论既无依据也无所指。
        // 只豁免 completed：非完成状态（失败/取消/需复核）必须照常告知，哪怕没有动作。
        const unsupportedBareCompletionClaim = input.error === 'unsupported_bare_completion_claim';
        const hasNothingToAccept = unsupportedBareCompletionClaim
            || (executionSummary.status === 'completed' && !this.hasTaskProgressToolCalls());

        // 正文里混着的自我分析在验收结论之前搬到过程区，保证过程区的时间顺序仍然是「先想后收尾」。
        // 只搬不删：切分失败或会掏空正文时原样交付（见 assistant-reply-reasoning-split 的红线）。
        const userResultProjection = buildAgentUserResultProjectionFromToolLog({
            summary: executionSummary,
            toolCallLog: this.toolCallLog
        });
        executionSummary.userVisibleSummary = userResultProjection.summary;
        if (userResultProjection.nextStep) {
            executionSummary.userVisibleNextStep = userResultProjection.nextStep;
        }
        // 2026-08-18 用户拍板：用户看到的正文永远是模型自己的话；不再用 Harness 的状态口播
        //（「本轮已经在 Photoshop 中做出实际画面…当前版本…下一步…」）替换或垫底。
        // 投影只进 executionSummary（诊断用）；模型没说话时仅补中性短句，避免空回复和状态口播。
        let rawVisibleMessage = String(input.message || '').trim()
            || userResultProjection.message
            || '这一轮没有新的画面改动。';
        const replySplit = splitAssistantReplyReasoningPrefix(rawVisibleMessage);
        if (replySplit.split) {
            this.emitVisibleReasoning(replySplit.reasoning, { source: 'model_reply_reasoning_prefix' });
        }

        // 过程区的收尾步骤只在真正完成时留一句；未完成的状态不再刷「⚠ 本轮已经…还需要查看…」
        //（与结果卡是同一段话，用户 2026-08-18 明确不想看到）。未完成的事实由任务卡与运行档案承担。
        if (!awaitingUserResponse && !hasNothingToAccept && executionSummary.status === 'completed') {
            const verificationStepSucceeded = executionSummary.status === 'completed'
                || executionSummary.status === 'needs_review';
            this.emitStep({
                kind: 'finalizing',
                title: userResultProjection.title,
                detail: this.buildVerificationStepDetail(userResultProjection),
                status: verificationStepSucceeded ? 'success' : 'error',
                iteration: input.iterations,
                maxIterations: this.config.maxIterations,
                percent: 100,
                issue: executionSummary.status === 'completed' ? undefined : executionSummary.stopReason,
                audience: 'user',
                visibility: 'user_process'
            });
        }
        // adopt 后由 Agent 成为 writer 生命周期唯一 owner；但只有结构化终态证明可安全释放时
        // 才交还 claim。needs_reobserve / operation unknown / 未知 mutation 继续由原 TaskRun 承接。
        releaseRuntimeSessionWriterAfterAgentFinalization({
            session: this.runtimeSession,
            awaitingUserResponse,
            executionStatus: executionSummary.status,
            successfulMutationCalls: executionSummary.successfulMutationCalls
        });
        const alignedVisibleMessage = alignUserVisibleCompletionMessage({ message: replySplit.body, executionStatus: executionSummary.status, requirements: executionSummary.taskCompletion?.required, designVerdict: executionSummary.designVerdict, terminalClosureOutcome: executionSummary.terminalClosureOutcome });
        const publicMessages = synchronizeLastAssistantCompletionMessage({ messages: this.messages, originalMessage: rawVisibleMessage, alignedMessage: alignedVisibleMessage });
        const runResult: AgentRunResult = {
            success,
            message: alignedVisibleMessage,
            messages: publicMessages,
            iterations: input.iterations,
            toolCallLog: this.toolCallLog,
            cancelled: input.cancelled,
            error: input.error,
            stopReason: input.stopReason,
            executionSummary,
            ...(resultData ? { data: resultData } : {})
        };
        this.writeTrustedVisualReviewArtifactForRunResult(runResult);
        return runResult;
    }

    private buildVerificationStepDetail(projection: UserResultProjection): string {
        return projection.detail;
    }

    private summarizeRecoveredToolFailures(): { recovered: number; unresolved: number } {
        let recovered = 0;
        let unresolved = 0;
        for (let index = 0; index < this.toolCallLog.length; index += 1) {
            const entry = this.toolCallLog[index];
            if (isAgentHarnessControlTool(entry.name)
                || entry.origin === 'harness_opening_observation'
                || entry.origin === 'harness_quality_verification') continue;
            if (entry.result?.success !== false) continue;
            if (entry.failureDisposition) continue;
            const recoveryToolOptions = this.readToolResultRecoveryOptions(entry.result);
            const hasLaterRecovery = this.toolCallLog.slice(index + 1).some((later) => {
                if (isAgentHarnessControlTool(later.name)
                    || later.origin === 'harness_opening_observation'
                    || later.origin === 'harness_quality_verification') return false;
                if (later.result?.success === false) return false;
                return later.name === entry.name || recoveryToolOptions.includes(later.name);
            });
            if (hasLaterRecovery) recovered += 1;
            else unresolved += 1;
        }
        return { recovered, unresolved };
    }

    private findLatestDesignVisualJudgeReviewSet(
        requireMultiSurface = false
    ): DesignVisualJudgeReviewSet | null {
        return selectFinalQualityReviewSet({
            bundle: this.latestDesignVisualJudgeBundleReviewSet,
            single: this.latestDesignVisualJudgeSingleReviewSet,
            requireMultiSurface
        });
    }
    private buildFinalQualityHostEvidenceContext(): FinalQualityHostEvidenceContext {
        return {
            executeTool: (name, args) => this.executeToolWithDiagnostics(name, args, {
                budgetClass: 'harness_quality_verification'
            }),
            recordToolCall: (durationMs, succeeded) => {
                this.runtimeSession = this.runtimeAccounting.recordToolCall(this.runtimeSession, {
                    durationMs, succeeded
                });
            },
            appendToolCall: (entry) => this.toolCallLog.push(entry),
            readElapsedMs: () => this.readRunElapsedMsOrUndefined()
        };
    }
    private async readCurrentPhotoshopHistoryStateRefForQualityVerification(
        phase: 'pre_judge' | 'post_judge' | 'final_summary'
    ): Promise<PhotoshopHistoryStateRef | undefined> {
        return readFinalQualityCurrentHistoryStateRef({
            context: this.buildFinalQualityHostEvidenceContext(),
            phase
        });
    }
    private readLatestClosedQualityHistoryStateRef(): PhotoshopHistoryStateRef | undefined {
        return resolveLatestClosedDesignQualityHistoryStateRef(this.toolCallLog);
    }
    private canRunDesignQualityVerification(): boolean {
        return this.hasTaskProgressToolCalls()
            && isAgentToolVisibleForIntentDecision(
                'getDocumentInfo',
                this.runIntentControlPlaneDecision
            );
    }

    private shouldCloseDesignQualityHistoryState(stopReason: AgentStopReason): boolean {
        if (stopReason === 'tool_preflight_blocked'
            || stopReason === 'awaiting_user_confirmation'
            || stopReason === 'awaiting_user_input') {
            return false;
        }
        if (!this.canRunDesignQualityVerification()) return false;
        if (this.resolveRuntimeEvaluationProfile()) return true;
        const taskCompletion = buildTaskCompletionContract({
            task: this.currentTask,
            context: this.buildTaskCompletionContext(),
            toolCallLog: this.getTaskCompletionToolCallLog()
        });
        return taskCompletion?.kind === 'creative_design';
    }

    private emitStaleDesignQualityObservation(detail: string): void {
        this.emitStep({
            kind: 'warning',
            title: '视觉质量判定未采用',
            detail,
            status: 'error',
            iteration: this.iteration + 1,
            maxIterations: this.config.maxIterations,
            audience: 'agent',
            issue: 'design_quality_vlm_stale'
        });
    }

    private recordFinalQualityEvaluationInterruption(detail: string, stale = false): void {
        const { protocolDigest, step } = stale ? projectFinalQualityRevisionStaleOutcome(detail)
            : projectFinalQualityEvaluationRuntimeFailureOutcome(detail);
        this.finalQualityModelProtocolDigest = protocolDigest;
        this.emitStep({ ...step, iteration: this.iteration + 1, maxIterations: this.config.maxIterations, source: 'agent_runtime', audience: 'debug' });
    }
    private async evaluateDesignQualityVlmAssertions(
        stopReason: AgentStopReason
    ): Promise<DesignAssertionResult[] | null> {
        if (this.config.signal?.aborted) return null;
        // 用户明确禁用全部工具，或本轮根本没有真实业务动作时，不得为了“设计质量收尾”
        // 额外读取 Photoshop。任务文本像设计请求不等于已经产生了可评价的设计结果。
        // 仅在「产出了可判画面」的收尾态做昂贵视觉判定：完成/到预算/超限/无进展（后两者也利于 reflexion）；
        // 阻断/出错/取消/未成形/待用户确认等态不判（无可判产物或不应耗费模型调用）。
        if (!isFinalQualityReviewStopReason(stopReason)) return null;
        const evaluationProfile = this.resolveRuntimeEvaluationProfile();
        if (!this.canRunDesignQualityVerification()) {
            if (evaluationProfile && this.hasTaskProgressToolCalls()) this.recordFinalQualityEvaluationInterruption('最终视觉评价缺少可执行的同目标 Host 事实读取能力。');
            return null;
        }
        // 有 manifest-selected Evaluation Profile 时由 Skill 自己定义是否需要视觉断言；
        // 未迁移任务才回退旧 creative_design 完成契约。这里不再从任务文本重判已选 Skill。
        if (!evaluationProfile) {
            const taskCompletion = buildTaskCompletionContract({
                task: this.currentTask,
                context: this.buildTaskCompletionContext(),
                toolCallLog: this.getTaskCompletionToolCallLog()
            });
            if (taskCompletion?.kind !== 'creative_design') return null;
        }

        // 最终视觉裁决继续使用同一个 Agent 模型；目录未明确 supportsVision=true 时诚实跳过。
        const judgeModelId = resolveFinalQualityJudgeModelId(this.config.modelId);
        if (!judgeModelId) return null;

        const pending = evaluationProfile
            ? getDesignEvaluationProfileVlmAssertions(evaluationProfile)
            : getVlmJudgeAssertions();
        if (pending.length === 0) return null;

        // getLayerHierarchy 提供层结构，画布尺寸来自 getDocumentInfo；二者都必须与终审截图
        // 处于同一 Photoshop history。不能假定 Agent 在最后一次写入后已经自行读取其中任一项：
        // pre_judge 先取得完整事实包并核对当前版本，再提取结构快照。这只是事实闭环，
        // 不替 Agent 评价画面，也不要求 Agent 固定调用 evaluateDesign。
        const preJudgeHistoryStateRef = await this.readCurrentPhotoshopHistoryStateRefForQualityVerification(
            'pre_judge'
        );
        if (!preJudgeHistoryStateRef) {
            this.recordFinalQualityEvaluationInterruption('最终视觉评价没有取得同一 Photoshop 文档版本的写后事实。');
            return null;
        }
        const finalReviewRequirements = this.resolveFinalReviewSetRequirements(evaluationProfile);
        const readReviewSet = () => this.findLatestDesignVisualJudgeReviewSet(
            finalReviewRequirements.requireMultiSurface
        );
        const reviewCandidate = await ensureFinalQualityCurrentReviewSet({
            context: this.buildFinalQualityHostEvidenceContext(),
            currentReviewSet: readReviewSet(),
            currentHistoryStateRef: preJudgeHistoryStateRef,
            requireMultiSurface: finalReviewRequirements.requireMultiSurface,
            fullSurfaceToolName: selectFinalQualityFullSurfaceToolName({
                availableToolNames: this.config.tools.map((tool) => tool.name),
                isVisible: (name) => isAgentToolVisibleForIntentDecision(
                    name,
                    this.runIntentControlPlaneDecision
                )
            }),
            captureReviewSet: (results) => this.captureLatestDesignVisualJudgeReviewSet(results),
            readReviewSet
        });
        if (!reviewCandidate) {
            this.emitStaleDesignQualityObservation(
                '终审画面集合不完整或与 Photoshop 当前版本不一致，已停止本次判定。'
            );
            this.recordFinalQualityEvaluationInterruption('最终视觉评价没有取得与当前 Photoshop 版本一致的完整画面集合。');
            return null;
        }
        // 与 buildExecutionSummary 同口径：没有"新鲜"的结构化产物（最后一次写操作之后的
        // getLayerHierarchy 等）时，确定性裁决整体缺席，vlm 断言也无处并入，故此处不空调视觉模型
        // ——避免白评 + 结果被丢弃；并要求结构读与像素图来自同一 Host 历史版本。
        const surfaceSnapshot = extractFreshDesignSurfaceSnapshotFromToolResults(this.toolCallLog, {
            requiredHistoryStateRef: preJudgeHistoryStateRef
        });
        const finalReviewRuntime = await runFinalQualityReviewRuntime({
            task: this.currentTask,
            toolCallLog: this.toolCallLog,
            reviewCandidate,
            preJudgeHistoryStateRef,
            surfaceSnapshot: surfaceSnapshot || undefined,
            pendingAssertions: pending,
            evaluationProfile,
            finalReviewRequirements: this.resolveFinalReviewSetRequirements(evaluationProfile),
            designBrief: this.runtimeDesignBriefDeclaration,
            designStrategy: this.runtimeDesignStrategyDeclaration,
            referenceBrief: this.runtimeReferenceBriefDeclaration,
            mutationBoundDesignIntents: this.mutationBoundDesignIntents,
            remainingVisionCandidates: this.resolvePerformanceVisionCallCapacity(
                true,
                'final_quality_judge'
            ).remainingCandidateCount,
            taskRunId: String(this.config.runtimeSessionIdentity?.sessionId || '').trim(),
            reflexionHandoff: this.config.reflexionHandoff,
            configuredSoftTimeBudgetMs: this.config.performanceBudget?.softTimeBudgetMs,
            terminalQualityReserveMs: FINAL_QUALITY_TERMINAL_RESERVE_MS,
            maxRequestTimeoutMs: AGENT_MODEL_REQUEST_TIMEOUT_MS,
            readActiveElapsedMs: () => this.readPerformanceActiveElapsedMs(),
            callModel: async (budgetClass, { messages, ...requestOptions }, presentation) => {
                const response = await this.modelCallAccounting.callAgentProvider(
                    judgeModelId,
                    messages,
                    [],
                    requestOptions,
                    {
                        callKind: budgetClass === 'final_quality_judge'
                            ? 'final_quality_judge'
                            : 'final_quality_diagnosis_repair',
                        requestMode: 'non_stream',
                        agentIteration: this.iteration + 1,
                        visualAnalysis: true,
                        visualInput: {
                            observationKeys: presentation.candidateKeys,
                            photoshopRevisions: [reviewCandidate.historyStateRef]
                        },
                        budgetClass,
                        directVisionCandidateCount: presentation.candidateCount,
                        directVisionCandidateKeys: presentation.candidateKeys,
                        billDirectVisionCandidatesByPresentation: true
                    }
                );
                const terminalContent = readCompleteProviderTextContent(response);
                if (!terminalContent.complete) {
                    throw new Error('视觉评审模型没有返回可消费的完整终态');
                }
                return { ...response, content: terminalContent.content };
            },
            readPostModelHistoryStateRef: () => (
                this.readCurrentPhotoshopHistoryStateRefForQualityVerification('post_judge')
            ),
            isActionableDiagnosis: (result) => (
                this.isActionableVlmDiagnosisForLatestReviewSet(result)
            ),
            getResourcePreview: typeof window !== 'undefined'
                ? window.designEcho?.getResourcePreview
                : undefined
        }, judgeModelId);
        const reviewOutcome = projectFinalQualityReviewOutcome({
            runtimeResult: finalReviewRuntime,
            judgeModelId,
            pendingAssertionCount: pending.length
        });
        if (reviewOutcome.protocolDigest) {
            this.finalQualityModelProtocolDigest = reviewOutcome.protocolDigest;
        } else if (reviewOutcome.results === null) this.recordFinalQualityEvaluationInterruption(reviewOutcome.staleDetail || '最终视觉评价在 Judge 调度前没有形成可消费的完整证据。');
        if (reviewOutcome.protocolDigest?.judgeStatus === 'completed'
            && reviewOutcome.protocolDigest.evidenceScope.finalArtifactObserved) {
            this.finalQualityReviewedVisualBinding = {
                historyStateRef: { ...reviewCandidate.historyStateRef },
                sourceOutput: reviewCandidate.sourceOutput
            };
        }
        if (reviewOutcome.pendingTrustedComparisonWrite) {
            this.pendingTrustedFinalComparisonWrite =
                reviewOutcome.pendingTrustedComparisonWrite;
        }
        if (reviewOutcome.staleDetail) {
            this.emitStaleDesignQualityObservation(reviewOutcome.staleDetail);
        }
        for (const step of reviewOutcome.steps) {
            this.emitStep({
                ...step,
                iteration: this.iteration + 1,
                maxIterations: this.config.maxIterations,
                audience: 'agent'
            });
        }
        return reviewOutcome.results;
    }

    private buildExecutionSummary(
        stopReason: AgentStopReason,
        iterations: number,
        vlmAssertions?: DesignAssertionResult[] | null
    ): AgentExecutionSummary {
        const businessToolCalls = this.toolCallLog.filter((entry) => (
            !isAgentHarnessControlTool(entry.name)
            && entry.origin !== 'harness_opening_observation'
            && entry.origin !== 'harness_quality_verification'
        ));
        const creditBearingBusinessToolCalls = businessToolCalls.filter((entry) => (
            this.isTaskCreditBearingToolCall(entry)
        ));
        const harnessActionCount = this.toolCallLog.filter((entry) => (
            isAgentHarnessControlTool(entry.name)
            || entry.origin === 'harness_opening_observation'
            || entry.origin === 'harness_quality_verification'
        )).length;
        const completionToolCallLog = this.getTaskCompletionToolCallLog();
        const toolCallCount = businessToolCalls.length;
        // 用户可见的"已查看 N 项"用独立口径：本次成功的观察类工具总数（素材总览、参考分析、
        // 项目资源检索、画面读取），与运行档案 activityClass==='observation' 同源。
        // 它与 successfulObservationCalls 是两回事——后者是完成观察门禁的安全判据
        // （只算最后一次写入之后、模型自己做的文档读回，Harness 质量复核不得计入），
        // 绝不能合并：真机上看了 11 次显示 0，是因为把门禁口径当成了展示口径。
        const observedToolCallCount = this.toolCallLog.filter((entry) => {
            if (entry.result?.success === false || isAgentReadResultCacheHit(entry.result)) return false;
            const activity = classifyRunToolActivity(
                entry.name,
                classifyAgentToolExecution(entry.name, entry.arguments),
                entry.origin
            );
            return activity === 'observation';
        }).length;
        let successfulToolCalls = 0;
        let acceptanceVerified = 0;
        let acceptanceFailed = 0;
        let acceptanceNeedsReview = 0;
        let noDocumentChangeRisks = 0;

        for (const item of creditBearingBusinessToolCalls) {
            const result = item.result || {};
            const toolSucceeded = result?.success !== false;
            if (toolSucceeded) {
                successfulToolCalls += 1;
            }

            const acceptance = result?.acceptance;
            if (!acceptance?.enabled) continue;
            if (acceptance.verified === true) {
                acceptanceVerified += 1;
            }
            if (acceptance.assertionStatus === 'failed') {
                acceptanceFailed += 1;
            }
            if (acceptance.assertionStatus === 'needs_review'
                || acceptance.noDocumentChangeRisk === true
                || (acceptance.verified === false && acceptance.assertionStatus !== 'failed')) {
                acceptanceNeedsReview += 1;
            }
            if (acceptance.noDocumentChangeRisk === true) {
                noDocumentChangeRisks += 1;
            }
        }
        const recoveredFailures = this.summarizeRecoveredToolFailures();
        const attemptFailedToolCalls = recoveredFailures.unresolved;
        successfulToolCalls += recoveredFailures.recovered;

        const lastTaskCall = creditBearingBusinessToolCalls[creditBearingBusinessToolCalls.length - 1];
        const lastSkillOutcomeStatus = String(lastTaskCall?.result?.skillOutcome?.status || '').trim();
        const terminalSkillOutcomeFailed = lastSkillOutcomeStatus === 'failed'
            || lastSkillOutcomeStatus === 'blocked'
            || lastSkillOutcomeStatus === 'cancelled';
        let terminalSkillOutcomeUnverified = lastSkillOutcomeStatus === 'executed'
            || lastSkillOutcomeStatus === 'partial'
            || lastSkillOutcomeStatus === 'needs_review'
            || lastSkillOutcomeStatus === 'awaiting_confirmation';

        const last = lastTaskCall;
        const lastError = last ? compactError(last.result) : undefined;
        const evaluationProfile = this.resolveRuntimeEvaluationProfile();
        let taskCompletion: TaskCompletionContract | undefined = evaluationProfile
            ? undefined
            : buildTaskCompletionContract({
                task: this.currentTask,
                context: this.buildTaskCompletionContext(),
                toolCallLog: completionToolCallLog
            });
        const completionOperationLedger = buildAgentOperationLedger(completionToolCallLog)
            .filter((entry) => entry.operationLedgerProvenance.role !== 'workflow_envelope');
        const completionObservationGate = evaluateCompletionObservationGate(
            completionOperationLedger.map((entry) => ({
                name: entry.name,
                arguments: entry.arguments,
                result: entry.result,
                succeeded: typeof entry.succeeded === 'boolean' ? entry.succeeded : (entry.result as any)?.success !== false
            }))
        );
        const hasViewableDesignChange = deriveAgentUserResultFacts(this.toolCallLog).hasViewableDesignChange;
        const performanceBudgetIncompleteMessage = describeIncompletePerformanceBudgetStop(hasViewableDesignChange);
        const taskPlanObligationGap = this.resolveTaskPlanObligationGap();
        const taskProgressMissing = Boolean(taskPlanObligationGap);
        const blockers: string[] = [];
        const warnings: string[] = [];
        const isAwaitingConfirmationSummary = stopReason === 'awaiting_user_confirmation'
            || stopReason === 'awaiting_user_input';

        // 用户可见文案一律设计师口吻：说设计做到哪一步、下一步怎么办；
        // 不出现「本轮/上限/判断次数/处理动作/验收/Skill 行动」等 harness / 测试话术。
        if (stopReason === 'max_iterations') {
            blockers.push('这稿这次没做完，可以让我接着做。');
        } else if (stopReason === 'provider_output_truncated') {
            blockers.push(hasViewableDesignChange
                ? '这次没有拿到完整结果；前面的真实改动已保留，但还没完成。'
                : '这次没有拿到完整结果，这次还没开始动手。');
        } else if (stopReason === 'provider_output_blocked') {
            blockers.push(hasViewableDesignChange
                ? '模型服务没有返回可用结果；前面的真实改动已保留，但还没完成。'
                : '模型服务没有返回可用结果，这次还没开始动手。');
        } else if (stopReason === 'no_progress') {
            blockers.push('这次卡住了、没能往前推进，先停下来。');
        } else if (stopReason === 'tool_preflight_blocked') {
            blockers.push(hasViewableDesignChange
                ? '这稿已经改了一部分，但后面暂时做不下去了，你先看看现在的。'
                : PUBLIC_TOOL_PRECHECK_BLOCKED_MESSAGE);
        } else if (stopReason === 'error') {
            blockers.push('这次出了点问题，没能完成。');
        }

        if (!isAwaitingConfirmationSummary) {
            if (taskPlanObligationGap === 'delivery_action_missing') {
                blockers.push('我先看了一下现状，但还没开始动手改。');
            } else if (taskPlanObligationGap === 'task_progress_missing') {
                blockers.push('这次还没真正开始做。');
            }
            if (terminalSkillOutcomeFailed) blockers.push('最后一步没做成。');
            if (toolCallCount > 0 && successfulToolCalls === 0) blockers.push('这次还没做出有效的东西。');
        }
        // 停在用户确认点时，任务本就未完成（taskCompletion 会判 failed/needs_review），但这是正常暂停，
        // 不应把"完成条件未满足"当成阻断/警告展示——否则验收详情会误显示"未完成原因"。
        // 有 manifest-selected Evaluation Profile 的业务 Skill 由 Profile checks 定义完成条件；
        // 未迁移任务才保留旧 creative_design 契约。两者最终都进入同一个 DesignVerdict，不并行拼裁决。
        let designQualityHardBlocked = false;
        let designScorecard: DesignScorecard | undefined;
        let designVerdict: DesignVerdict | undefined;
        let designEvaluationProfileDigest: DesignEvaluationProfileDigest | undefined;
        let designEvaluationProfileResult: DesignEvaluationProfileResult | undefined;
        let hasFreshVisualEvaluation = false;
        if ((evaluationProfile || taskCompletion?.kind === 'creative_design')
            && stopReason !== 'tool_preflight_blocked'
            && !isAwaitingConfirmationSummary) {
            const finalReviewRequirements = this.resolveFinalReviewSetRequirements(evaluationProfile);
            const visualReviewSet = this.findLatestDesignVisualJudgeReviewSet(
                finalReviewRequirements.requireMultiSurface
            );
            const visualHistoryStateRef = visualReviewSet?.historyStateRef;
            const verifiedCurrentHistoryStateRef = this.readLatestClosedQualityHistoryStateRef();
            const expectedVlmAssertions = evaluationProfile
                ? getDesignEvaluationProfileVlmAssertions(evaluationProfile)
                : getVlmJudgeAssertions();
            const finalReviewSetSelection = verifiedCurrentHistoryStateRef && visualReviewSet
                ? selectDesignReviewSetForFinalJudge(visualReviewSet.reviewSet, {
                    currentVersion: {
                        document: String(verifiedCurrentHistoryStateRef.documentId),
                        history: String(verifiedCurrentHistoryStateRef.historyStateId)
                    },
                    ...finalReviewRequirements
                })
                : undefined;
            hasFreshVisualEvaluation = Boolean(
                verifiedCurrentHistoryStateRef
                && samePhotoshopHistoryStateRef(visualHistoryStateRef, verifiedCurrentHistoryStateRef)
                && finalReviewSetSelection?.status === 'ready'
                && Array.isArray(vlmAssertions)
                && isReliableVlmJudgeBatchComplete(vlmAssertions, expectedVlmAssertions)
            );
            const surfaceSnapshot = verifiedCurrentHistoryStateRef
                ? extractFreshDesignSurfaceSnapshotFromToolResults(this.toolCallLog, {
                    requiredHistoryStateRef: verifiedCurrentHistoryStateRef
                })
                : null;
            const assertionResults = [
                ...(surfaceSnapshot
                    ? evaluateDeterministicAssertions(
                        extractDesignQualityMeasurements(surfaceSnapshot),
                        evaluationProfile
                            ? getDesignEvaluationProfileSharedAssertions(evaluationProfile)
                            : undefined
                    )
                    : []),
                ...(vlmAssertions || [])
            ];
            if (evaluationProfile) {
                const lastMutationIndex = findLatestObservedPhotoshopMutationIndex(this.toolCallLog);
                // 零写入运行没有"写后"可言：写后检查（写后结构读回/跨屏视觉复核）不适用——
                // 不能要求一个没有写入的运行补写后读回；完成性由交付义务门禁另行裁定，不靠这条警告。
                const effectiveEvaluationProfile = lastMutationIndex >= 0
                    ? evaluationProfile
                    : {
                        ...evaluationProfile,
                        checks: evaluationProfile.checks.filter((check) => (
                            check.runtime?.requiresMutation !== true
                        ))
                    };
                const adaptedBusinessResults = adaptDesignEvaluationRecordsFromToolResults({
                    profile: effectiveEvaluationProfile,
                    toolResults: this.toolCallLog,
                    lastMutationIndex
                });
                const profileCheckKeys = new Set(effectiveEvaluationProfile.checks.map((check) => check.key));
                const freshVisualChecks = effectiveEvaluationProfile.checks.filter((check) => (
                    check.runtime?.evidence === 'fresh_visual'
                ));
                const scopedChangeChecks = effectiveEvaluationProfile.checks.filter((check) => (
                    check.runtime?.evidence === 'scoped_change'
                ));
                const declaredPlanClosureChecks = effectiveEvaluationProfile.checks.filter((check) => (
                    check.runtime?.evidence === 'declared_plan_closure'
                ));
                const evaluatesScopedChanges = scopedChangeChecks.length > 0;
                const wholeTaskExecutionClosure = declaredPlanClosureChecks.length > 0
                    && this.runtimeActionPlanDeclaration
                    && this.runtimeActionPlanModule
                    ? this.runtimeActionPlanModule.projectRuntimeActionPlanExecutionClosure({
                        declaration: this.runtimeActionPlanDeclaration,
                        reconciliation: this.reconcileRuntimeActionPlanExecution()
                            || this.runtimeActionPlanModule.reconcileRuntimeActionPlanExecution({
                                declaration: this.runtimeActionPlanDeclaration,
                                journal: createRuntimeActionPlanExecutionJournal()
                            })
                    })
                    : undefined;
                const verificationRecords = reconcileDesignFinalReviewStructureVerificationRecords(this.toolCallLog, effectiveEvaluationProfile, Boolean(surfaceSnapshot && !evaluatesScopedChanges), [
                        ...(hasFreshVisualEvaluation ? freshVisualChecks.map((check) => ({
                            key: check.key,
                            status: 'passed' as const,
                            source: 'runtime_observation' as const,
                            verificationRef: 'runtime:profile-vlm-evaluation'
                        })) : []),
                        ...(evaluatesScopedChanges
                            ? buildRuntimeScopedChangeVerificationRecords(this.toolCallLog, {
                                exactPropertyScope: this.config.runtimeExactPropertyScope,
                                requiredHistoryStateRef: verifiedCurrentHistoryStateRef
                            }).filter((record) => profileCheckKeys.has(record.key))
                            : []),
                        ...(evaluatesScopedChanges
                            ? buildRuntimeScopedVisualReviewVerificationRecords(this.toolCallLog, {
                                hasFreshVisualEvaluation
                            }).filter((record) => profileCheckKeys.has(record.key))
                            : []),
                        ...(wholeTaskExecutionClosure ? declaredPlanClosureChecks.map((check) => ({
                            key: check.key,
                            status: wholeTaskExecutionClosure.complete
                                ? 'passed' as const
                                : 'needs_review' as const,
                            source: 'runtime_observation' as const,
                            verificationRef: wholeTaskExecutionClosure.complete
                                ? 'runtime:whole-task-execution-closure:passed'
                                : 'runtime:whole-task-execution-closure:pending'
                        })) : []),
                        ...adaptedBusinessResults.records
                ]);
                designEvaluationProfileResult = evaluateDesignEvaluationProfile({
                    profile: effectiveEvaluationProfile,
                    assertionResults,
                    verificationRecords
                });
                designScorecard = designEvaluationProfileResult.scorecard;
                designEvaluationProfileDigest = buildDesignEvaluationProfileDigest(designEvaluationProfileResult);
                taskCompletion = buildTaskCompletionContract({
                    task: this.currentTask,
                    context: this.buildTaskCompletionContext(),
                    toolCallLog: completionToolCallLog,
                    evaluationProfile: effectiveEvaluationProfile,
                    evaluationProfileResult: designEvaluationProfileResult
                });
                designVerdict = buildDesignVerdict({
                    contract: taskCompletion,
                    scorecard: designScorecard,
                    designKinds: ['skill_evaluation_profile']
                });
            } else if (surfaceSnapshot) {
                designScorecard = scoreDesignAssertions(assertionResults);
                designVerdict = buildDesignVerdict({ contract: taskCompletion, scorecard: designScorecard });
            } else if (extractDesignSurfaceSnapshotFromToolResults(this.toolCallLog)) {
                warnings.push('设计质量：未评分——最后一次写入后没有取得同一文档版本的完整结构读取，不能拿旧画面判断当前结果；请重新读取当前结构后再复核。');
            }

            if (!designVerdict && taskCompletion) {
                designVerdict = buildDesignVerdict({ contract: taskCompletion });
            }
            if (designVerdict?.source === 'contract+scorecard') {
                for (const blocker of designVerdict.blockers) blockers.push(`设计质量：${blocker}`);
                for (const warning of designVerdict.warnings) warnings.push(`设计质量：${warning}`);
                designQualityHardBlocked = designVerdict.blockers.length > 0;
            }
        }

        // 所有显式包含 R5 的 Runtime 都必须产出同一个机读 DesignVerdict。没有专属
        // Evaluation Profile 的任务（例如 reference_replication）复用它已经完成的
        // TaskCompletionContract；该契约仍要求真实参考观察、完整覆盖率和“模型已看图”
        // 收据，因此这里只补齐裁决桥，不把“存在截图”放宽成“质量已通过”。
        const runtimeRequiresQualityVerdict = Boolean(
            this.config.runtimeStagePlan?.steps.some((step) => step.stage === 'R5')
        );
        if (!designVerdict
            && taskCompletion
            && runtimeRequiresQualityVerdict
            && stopReason !== 'tool_preflight_blocked'
            && !isAwaitingConfirmationSummary) {
            designVerdict = buildDesignVerdict({
                contract: taskCompletion,
                // R5 已由 Manifest 明确选择质量裁决范围；动态使用当前契约身份，避免在
                // 通用 Agent 核心继续堆 creative/reference/新品类分支。
                designKinds: [taskCompletion.kind]
            });
        }

        const executeHandoffFulfillment = evaluateAgentWorkflowExecuteHandoffFulfillment({
            toolCallLog: businessToolCalls,
            workflowEntryTools: this.config.toolCapabilityBridge?.workflowEntryTools || [],
            taskCompletionStatus: taskCompletion?.status,
            hasFreshVisualPass: hasFreshVisualEvaluation,
            runtimeRequiresQualityVerdict,
            designVerdictStatus: designVerdict?.status
        });
        if (executeHandoffFulfillment.status === 'pending') {
            terminalSkillOutcomeUnverified = true;
        } else if (executeHandoffFulfillment.status === 'fulfilled') {
            terminalSkillOutcomeUnverified = false;
        }
        const qualityClosureSatisfied = !runtimeRequiresQualityVerdict
            || Boolean(designVerdict && isDesignVerdictDeliverable(designVerdict));
        if (!terminalSkillOutcomeFailed
            && terminalSkillOutcomeUnverified
            && !isAwaitingConfirmationSummary
            && taskCompletion?.status === 'completed'
            && qualityClosureSatisfied) {
            // 后续完整 Completion + Quality 事实应闭合动作级 Skill 非终态。
            terminalSkillOutcomeUnverified = false;
        }
        if (!terminalSkillOutcomeFailed
            && terminalSkillOutcomeUnverified
            && !isAwaitingConfirmationSummary) {
            warnings.push('最后一步做了，但我还没确认效果好不好。');
        }

        if (stopReason !== 'tool_preflight_blocked' && !isAwaitingConfirmationSummary) {
            if (taskCompletion?.status === 'failed' && blockers.length === 0) {
                blockers.push(hasViewableDesignChange
                    ? '当前版本还有内容没完成，我先不把它当成成品交付。'
                    : '这次还没有形成可以看的设计版本。');
            } else if (taskCompletion?.status === 'needs_review' && warnings.length === 0) {
                warnings.push(hasViewableDesignChange
                    ? '当前版本已经形成，整体画面还需要再看一眼。'
                    : '这次还没有形成可以看的设计版本。');
            }
        }

        // 完成观察门禁（治幻觉式完成，红线1-3）：改了画面/文件却整轮零观察 → 不得宣称 completed。
        // 口径与 mutation 判定一致——用 classifyAgentToolExecution(name, arguments)（带参数），
        // 否则 inspect 模式技能（layer-management action:'inspect'、skuLayout action:'listLayerSets'）
        // 会被漏算为观察。窄范围豁免（export-only、单个简单机械 mutation）由门禁模块内实现。
        // 先按既有判据算基础状态；仅当它本会判 completed 时才允许门禁降级——绝不把 failed/cancelled
        // 等既有裁决改判，也就不会误抑制真正失败任务的 reflexion 返工。
        const finalOutcomeSignals = projectAgentFinalOutcomeSignals({
            stopReason,
            taskCompletionStatus: taskCompletion?.status,
            designVerdictDeliverable: designVerdict
                ? isDesignVerdictDeliverable(designVerdict)
                : undefined,
            designQualityHardBlocked,
            terminalSkillOutcomeFailed,
            terminalSkillOutcomeUnverified,
            attempt: {
                failedToolCalls: attemptFailedToolCalls,
                acceptanceFailed,
                acceptanceNeedsReview,
                noDocumentChangeRisks
            }
        });
        const failedToolCalls = finalOutcomeSignals.completionBlocking.failedToolCalls;
        const completionBlockingAcceptanceFailed = finalOutcomeSignals.completionBlocking.acceptanceFailed;
        const completionBlockingAcceptanceNeedsReview = finalOutcomeSignals.completionBlocking.acceptanceNeedsReview;
        const completionBlockingNoDocumentChangeRisks = finalOutcomeSignals.completionBlocking.noDocumentChangeRisks;
        if (completionBlockingAcceptanceFailed > 0) {
            blockers.push('有几处我看着还不到位，想再调一下。');
        }
        if (failedToolCalls > 0 && successfulToolCalls > 0) {
            warnings.push(`有 ${failedToolCalls} 项尝试仍影响当前结果。`);
        }
        if (completionBlockingAcceptanceNeedsReview > 0) {
            warnings.push(`当前结果还有 ${completionBlockingAcceptanceNeedsReview} 项验证没有闭合。`);
        }
        if (completionBlockingNoDocumentChangeRisks > 0) {
            warnings.push(`有 ${completionBlockingNoDocumentChangeRisks} 次处理尚未证明已经落到当前画面。`);
        }
        const baseStatus = resolveAgentExecutionStatus({
            stopReason,
            toolCallCount,
            successfulToolCalls,
            failedToolCalls,
            acceptanceFailed: completionBlockingAcceptanceFailed,
            acceptanceNeedsReview: completionBlockingAcceptanceNeedsReview,
            noDocumentChangeRisks: completionBlockingNoDocumentChangeRisks,
            taskCompletionStatus: taskCompletion?.status,
            designVerdictStatus: designVerdict?.status,
            designQualityHardBlocked,
            taskProgressMissing,
            terminalSkillOutcomeFailed,
            terminalSkillOutcomeUnverified
        });
        const downgradedByObservationGate = baseStatus === 'completed' && completionObservationGate.downgrade;
        const status: AgentExecutionSummary['status'] = downgradedByObservationGate ? 'needs_review' : baseStatus;
        if (stopReason === 'performance_budget' && status !== 'completed') {
            blockers.push(performanceBudgetIncompleteMessage);
        }
        if (stopReason === 'tool_budget_final_response' && status !== 'completed') {
            warnings.push('这稿先做到这里，你看看。');
        }
        if (lastError && (
            failedToolCalls > 0
            || completionBlockingAcceptanceFailed > 0
            || completionBlockingAcceptanceNeedsReview > 0
            || completionBlockingNoDocumentChangeRisks > 0
            || terminalSkillOutcomeFailed
            || terminalSkillOutcomeUnverified
        )) {
            warnings.push(`当前卡点：${sanitizeUserVisibleDiagnosticText(lastError)}`);
        }
        if (downgradedByObservationGate) {
            warnings.push('画面已经发生变化，但我还没看到修改后的最终效果；需要先看一下当前画面再收尾。');
        }

        return {
            status,
            stopReason,
            iterations,
            businessActionCount: toolCallCount,
            harnessActionCount,
            toolCallCount,
            successfulToolCalls,
            failedToolCalls: attemptFailedToolCalls,
            completionBlockingFailedToolCalls: failedToolCalls,
            successfulMutationCalls: completionObservationGate.mutationCount,
            successfulObservationCalls: completionObservationGate.observationCount,
            observedToolCallCount,
            acceptanceVerified,
            acceptanceFailed,
            acceptanceNeedsReview,
            noDocumentChangeRisks,
            completionBlockingAcceptanceFailed,
            completionBlockingAcceptanceNeedsReview,
            completionBlockingNoDocumentChangeRisks,
            ...(finalOutcomeSignals.supersededByVerifiedTerminalEvidence
                ? { attemptSignalsSupersededByTerminalEvidence: true }
                : {}),
            lastToolName: last?.name,
            lastError,
            blockers,
            warnings,
            taskCompletion,
            ...(downgradedByObservationGate ? { downgradedByObservationGate: true } : {}),
            ...(designScorecard ? { designScorecard } : {}),
            ...(designEvaluationProfileDigest ? { designEvaluationProfileDigest } : {}),
            ...(designVerdict ? { designVerdict } : {}),
            ...(this.finalQualityModelProtocolDigest ? { finalQualityModelProtocolDigest: this.finalQualityModelProtocolDigest } : {}),
            summaryText: stopReason === 'tool_preflight_blocked'
                ? (hasViewableDesignChange
                    ? '这稿已经改了一部分，但后面暂时做不下去了，你先看看现在的。'
                    : `这稿还没做完：${PUBLIC_TOOL_PRECHECK_BLOCKED_MESSAGE}`)
                : isAwaitingConfirmationSummary
                    ? '有地方想先跟你确认，确认后我接着做。'
                    : formatAgentExecutionSummaryText(status, {
                    blockers,
                    warnings
                })
        };
    }

}
